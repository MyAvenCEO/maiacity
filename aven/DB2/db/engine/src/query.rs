//! Queries: scope, operators, bounds (`Engine.Query`; engine README, "Queries"; ARCHITECTURE.md, A8).
//!
//! A query reads tables of Records by type and nothing else. Its rows come only from the Records of held Docs inside
//! its scope ([`in_scope`]); the answer is `complete` exactly when every Doc of the scope is held, and `short`,
//! naming the missing ones, otherwise ([`answer_over`]). Each operator has a [`bound`] on the rows it can yield and a
//! [`cost`] on the [`work`] it can do, known from per-type counts before it runs.
//!
//! Counts are `u64`, where Lean's are unbounded: a bound or cost past `u64::MAX` saturates there, which is past any
//! device's limit, so the query is refused all the same.

use alloc::boxed::Box;
use alloc::string::String;
use alloc::vec;
use alloc::vec::Vec;

use aven_core::{DocId, Facts, Target, Value};

use crate::value;

/// A row as queries see it: columns by name, a Record's fields or joined Records' fields side by side (`Tuple`).
pub type Tuple = Vec<(String, Value)>;

/// A Record as the engine reads it from a Doc: where it lives, its type (a type Doc), its fields (`Rec`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rec {
    pub doc: DocId,
    pub r#type: DocId,
    pub fields: Tuple,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cmp {
    Eq,
    Ne,
    Lt,
    Le,
}

impl Cmp {
    /// As the vectors write it.
    pub fn name(self) -> &'static str {
        match self {
            Cmp::Eq => "eq",
            Cmp::Ne => "ne",
            Cmp::Lt => "lt",
            Cmp::Le => "le",
        }
    }

    /// `Cmp.holds`.
    pub fn holds(self, a: &Value, b: &Value) -> bool {
        match self {
            Cmp::Eq => value::eq(a, b),
            Cmp::Ne => !value::eq(a, b),
            Cmp::Lt => value::lt(a, b),
            Cmp::Le => value::eq(a, b) || value::lt(a, b),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Query {
    /// Every Record of a type, in the query's scope.
    Scan(DocId),
    /// The rows whose column compares to a value.
    Filter {
        col: String,
        cmp: Cmp,
        value: Value,
        query: Box<Query>,
    },
    /// Only these columns, in this order; where a joined row has a column twice, the left one.
    Project {
        cols: Vec<String>,
        query: Box<Query>,
    },
    /// Rows of both sides whose columns are equal, side by side.
    Join {
        left: Box<Query>,
        right: Box<Query>,
        lcol: String,
        rcol: String,
    },
    /// The same, keeping a left row without a match on its own.
    LeftJoin {
        left: Box<Query>,
        right: Box<Query>,
        lcol: String,
        rcol: String,
    },
    /// The left rows without a match.
    Anti {
        left: Box<Query>,
        right: Box<Query>,
        lcol: String,
        rcol: String,
    },
    /// Sorted by a column.
    Order { col: String, query: Box<Query> },
    /// One row per value of a column, with its count.
    Group { col: String, query: Box<Query> },
    /// At most `n` rows.
    Limit { n: u64, query: Box<Query> },
}

/// A column's value: the first with that name (`get`, a `lookup`).
pub fn get<'a>(t: &'a [(String, Value)], col: &str) -> Option<&'a Value> {
    t.iter().find(|(c, _)| c == col).map(|(_, v)| v)
}

/// Two rows match when both columns are there and equal; a missing column matches nothing (`pairs`).
fn pairs(lcol: &str, rcol: &str, a: &Tuple, b: &Tuple) -> bool {
    match (get(a, lcol), get(b, rcol)) {
        (Some(x), Some(y)) => value::eq(x, y),
        _ => false,
    }
}

/// Each value once, at its last place (`dedup`).
fn dedup(vs: Vec<&Value>) -> Vec<&Value> {
    let mut out: Vec<&Value> = Vec::new();
    for v in vs.into_iter().rev() {
        if !out.iter().any(|o| value::eq(v, o)) {
            out.push(v);
        }
    }
    out.reverse();
    out
}

/// Lean's `List.mergeSort`, step for step: the first half takes the odd one out, and a tie keeps the left first.
fn merge_sort<T>(xs: Vec<T>, le: &impl Fn(&T, &T) -> bool) -> Vec<T> {
    if xs.len() < 2 {
        return xs;
    }
    let mut xs = xs;
    let right = xs.split_off(xs.len().div_ceil(2));
    let (l, r) = (merge_sort(xs, le), merge_sort(right, le));
    let mut out = Vec::with_capacity(l.len() + r.len());
    let (mut l, mut r) = (l.into_iter().peekable(), r.into_iter().peekable());
    loop {
        match (l.peek(), r.peek()) {
            (Some(x), Some(y)) => {
                if le(x, y) {
                    out.extend(l.next());
                } else {
                    out.extend(r.next());
                }
            }
            _ => {
                out.extend(l);
                out.extend(r);
                return out;
            }
        }
    }
}

/// Rows sorted by a column; rows without it go first (`sortBy`).
fn sort_by(col: &str, rs: Vec<Tuple>) -> Vec<Tuple> {
    merge_sort(
        rs,
        &|a: &Tuple, b: &Tuple| match (get(a, col), get(b, col)) {
            (None, _) => true,
            (Some(_), None) => false,
            (Some(x), Some(y)) => !value::lt(y, x),
        },
    )
}

/// The rows a query yields, given the rows of each type in its scope (`eval`).
pub fn eval(src: &impl Fn(&DocId) -> Vec<Tuple>, q: &Query) -> Vec<Tuple> {
    match q {
        Query::Scan(ty) => src(ty),
        Query::Filter {
            col,
            cmp,
            value,
            query,
        } => eval(src, query)
            .into_iter()
            .filter(|t| get(t, col).is_some_and(|x| cmp.holds(x, value)))
            .collect(),
        Query::Project { cols, query } => eval(src, query)
            .into_iter()
            .map(|t| {
                cols.iter()
                    .filter_map(|c| get(&t, c).map(|v| (c.clone(), v.clone())))
                    .collect()
            })
            .collect(),
        Query::Join {
            left,
            right,
            lcol,
            rcol,
        } => {
            let rs = eval(src, right);
            let mut out = Vec::new();
            for a in eval(src, left) {
                for b in rs.iter().filter(|b| pairs(lcol, rcol, &a, b)) {
                    out.push(a.iter().chain(b).cloned().collect());
                }
            }
            out
        }
        Query::LeftJoin {
            left,
            right,
            lcol,
            rcol,
        } => {
            let rs = eval(src, right);
            let mut out = Vec::new();
            for a in eval(src, left) {
                let ms: Vec<&Tuple> = rs.iter().filter(|b| pairs(lcol, rcol, &a, b)).collect();
                if ms.is_empty() {
                    out.push(a);
                } else {
                    for b in ms {
                        out.push(a.iter().chain(b).cloned().collect());
                    }
                }
            }
            out
        }
        Query::Anti {
            left,
            right,
            lcol,
            rcol,
        } => {
            let rs = eval(src, right);
            eval(src, left)
                .into_iter()
                .filter(|a| !rs.iter().any(|b| pairs(lcol, rcol, a, b)))
                .collect()
        }
        Query::Order { col, query } => sort_by(col, eval(src, query)),
        Query::Group { col, query } => {
            let rs = eval(src, query);
            dedup(rs.iter().filter_map(|t| get(t, col)).collect())
                .into_iter()
                .map(|k| {
                    let n = rs
                        .iter()
                        .filter(|t| get(t, col).is_some_and(|x| value::eq(x, k)))
                        .count();
                    vec![
                        (col.clone(), k.clone()),
                        (String::from("count"), value::count(n)),
                    ]
                })
                .collect()
        }
        Query::Limit { n, query } => {
            let mut rs = eval(src, query);
            rs.truncate(usize::try_from(*n).unwrap_or(usize::MAX));
            rs
        }
    }
}

/// How complete an answer is: every Doc of the scope held, or the ones still missing (`Completeness`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Completeness {
    Complete,
    Short(Vec<DocId>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Answer {
    /// No target: refused before anything runs.
    Refused,
    Rows(Completeness, Vec<Tuple>),
}

/// The rows of a type among some Docs: Records of that type in those Docs that this device holds (`inScope`).
pub fn in_scope(
    db: &[Rec],
    docs: &[DocId],
    held: &impl Fn(&DocId) -> bool,
    ty: &DocId,
) -> Vec<Tuple> {
    db.iter()
        .filter(|r| r.r#type == *ty && docs.contains(&r.doc) && held(&r.doc))
        .map(|r| r.fields.clone())
        .collect()
}

/// The answer over some Docs: `complete` when all are held, else `short` with the missing ones (`answerOver`).
pub fn answer_over(
    docs: &[DocId],
    held: &impl Fn(&DocId) -> bool,
    db: &[Rec],
    q: &Query,
) -> Answer {
    let missing: Vec<DocId> = docs.iter().filter(|d| !held(d)).copied().collect();
    let status = if missing.is_empty() {
        Completeness::Complete
    } else {
        Completeness::Short(missing)
    };
    Answer::Rows(status, eval(&|ty: &DocId| in_scope(db, docs, held, ty), q))
}

/// A query as stored and run: its target, and its body (`Spec`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Spec {
    pub target: Option<Target>,
    pub body: Query,
}

/// Who governs whom, which actor spawned which and what a collection lists: avenID's, the actors' and the
/// collections' own signed listings, given as tests (`Target.coversB`'s parameters).
pub struct Relations<'a> {
    pub gov: &'a dyn Fn(&str, &str) -> bool,
    pub spawned: &'a dyn Fn(&DocId, &DocId) -> bool,
    pub lists: &'a dyn Fn(&DocId, &DocId) -> bool,
}

/// The Docs a target resolves to, among those a directory lists (`resolve`).
pub fn resolve(rel: &Relations, dir: &[Facts], t: &Target) -> Vec<DocId> {
    dir.iter()
        .filter(|f| t.covers(rel.gov, rel.spawned, rel.lists, f))
        .map(|f| f.id)
        .collect()
}

/// Run a stored query over the Docs its target resolves to in a directory; without a target it is refused before
/// anything runs (`run`).
pub fn run(
    rel: &Relations,
    dir: &[Facts],
    held: &impl Fn(&DocId) -> bool,
    db: &[Rec],
    s: &Spec,
) -> Answer {
    match &s.target {
        None => Answer::Refused,
        Some(t) => answer_over(&resolve(rel, dir, t), held, db, &s.body),
    }
}

/// The most rows a query can yield, from the most rows each type can have (`bound`).
pub fn bound(n: &impl Fn(&DocId) -> u64, q: &Query) -> u64 {
    match q {
        Query::Scan(ty) => n(ty),
        Query::Filter { query, .. }
        | Query::Project { query, .. }
        | Query::Order { query, .. }
        | Query::Group { query, .. } => bound(n, query),
        Query::Limit { n: k, query } => (*k).min(bound(n, query)),
        Query::Join { left, right, .. } => bound(n, left).saturating_mul(bound(n, right)),
        Query::LeftJoin { left, right, .. } => {
            bound(n, left).saturating_mul(bound(n, right).max(1))
        }
        Query::Anti { left, .. } => bound(n, left),
    }
}

/// The work a query does as it runs: rows read, pairs compared, comparisons while sorting, counted as n² (`work`).
pub fn work(src: &impl Fn(&DocId) -> Vec<Tuple>, q: &Query) -> u64 {
    let len = |q: &Query| eval(src, q).len() as u64;
    match q {
        Query::Scan(ty) => src(ty).len() as u64,
        Query::Filter { query, .. } | Query::Project { query, .. } | Query::Group { query, .. } => {
            work(src, query).saturating_add(len(query))
        }
        Query::Order { query, .. } => {
            let l = len(query);
            work(src, query).saturating_add(l.saturating_mul(l))
        }
        Query::Limit { query, .. } => work(src, query),
        Query::Join { left, right, .. }
        | Query::LeftJoin { left, right, .. }
        | Query::Anti { left, right, .. } => work(src, left)
            .saturating_add(work(src, right))
            .saturating_add(len(left).saturating_mul(len(right))),
    }
}

/// The most work a query may do, known before it runs (`cost`). A query whose cost exceeds the device's limit is
/// refused with its cost in the answer.
pub fn cost(n: &impl Fn(&DocId) -> u64, q: &Query) -> u64 {
    match q {
        Query::Scan(ty) => n(ty),
        Query::Filter { query, .. } | Query::Project { query, .. } | Query::Group { query, .. } => {
            cost(n, query).saturating_add(bound(n, query))
        }
        Query::Order { query, .. } => {
            let b = bound(n, query);
            cost(n, query).saturating_add(b.saturating_mul(b))
        }
        Query::Limit { query, .. } => cost(n, query),
        Query::Join { left, right, .. }
        | Query::LeftJoin { left, right, .. }
        | Query::Anti { left, right, .. } => cost(n, left)
            .saturating_add(cost(n, right))
            .saturating_add(bound(n, left).saturating_mul(bound(n, right))),
    }
}
