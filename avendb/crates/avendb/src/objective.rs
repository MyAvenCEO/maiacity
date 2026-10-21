//! Objectives: what an AIP must deliver, measured (`docs/ARCHITECTURE.md` §8, "AIPs"; the model is
//! `spec/AvenDB/Objective.lean`, and `spec/vectors/objectives.json` holds this engine to it).
//!
//! An objective is a file of Lean against `AvenDB.Objective`: metrics, each a name and a goal over readings, numbers
//! an AIP records while it is worked on (`aip_measure`), those of them a Measurer of its vault wrote (`measured
//! "name"`, `spec/AvenDB/Measurers.lean`), and over the numbers its proposal itself puts in records (`proposed "path"`,
//! against what main holds there, `current "path"`), and names the measuring logic a Measurer runs on its proposal
//! (`def sim : Measure := logic "valley-sim"`). This module reads the subset of Lean such a file is written in and
//! checks its metrics against those inputs (`Inputs`), as the model does, so every device answers alike:
//!
//! ```lean
//! import AvenDB.Objective
//! open AvenDB.Objective
//!
//! /-- At least 50 frames a second while walking. -/
//! def fps : Metric := metric "Frames per second" (atLeast (reading "fps") 50)
//!
//! def objective : List Metric := [fps]
//! ```
//!
//! - **Items**: `import AvenDB.Objective`, `open AvenDB.Objective`, `namespace N` … `end N`, `def x : Metric := metric
//!   "name" (goal)`, `def x : Expr := expr`, `def x : Measure := logic "name"`, and `def objective : List Metric :=
//!   [x, …]`, the metrics in their order (without it, every metric in file order). A doc comment `/-- … -/` above a
//!   metric is its note, above any other def a comment; `--` and `/- … -/` (nested) are comments.
//! - **Goals**: `atLeast e t`, `atMost e t`, `between e lo hi`, `equals e t`, each argument a number, a name of an
//!   earlier `Expr`, or an expression in parentheses, as Lean applies functions.
//! - **Expressions**: plain decimals (`1500`, `0.8`), `reading "name"`, `measured "name"`, `proposed "path"`, `current
//!   "path"`, `min a b`, `max a b`, `-x`, `* /` then `+ -`, left to right, as Lean's precedences read them (`-` binds
//!   tighter than `*`).
//! - **Paths** (`proposed`, `current`): field names split by dots, `#n` the row of a list whose id is n
//!   (`params.#1.default`), optionally after the first 8 or more hex digits of an entry's id and a slash
//!   (`1a2b3c4d/params.#1.default`), which picks that entry's line of the AIP (`at_path`).
//! - **Measures** (`Measure` in the model): `logic "name"`, the logic module on the vault's main line tagged
//!   `ref:logic/measures/<name>` that a Measurer runs on the AIP's lines; at most `MAX_MEASURES`, each name 1 to 64 of
//!   a-z, 0-9 and `-` (`Measure.named`). Checking never runs one: its numbers come back as readings.
//! - **Numbers** are millionths in an `i128` (`Dec`): six places, the rest cut toward zero; a value beyond 10^24 units
//!   is none, as the model's `bound`.
//!
//! It is total and bounded: no loops, no recursion a file controls beyond `MAX_DEPTH`, no more than `MAX_NODES` per
//! metric once names are put in, at most `MAX_METRICS` metrics in `MAX_LEN` bytes. An objective is data: nothing in
//! it can reach the device that reads it.

use std::collections::HashMap;

use serde_json::{Value, json};

/// A decimal, in millionths.
pub type Dec = i128;

/// One, in millionths.
pub const ONE: Dec = 1_000_000;

/// The largest magnitude a value may reach, in millionths (10^24 units), the model's `bound`.
pub const BOUND: Dec = 1_000_000_000_000_000_000_000_000_000_000;

/// The longest objective file, in bytes.
pub const MAX_LEN: usize = 20_000;
/// The most metrics an objective holds.
pub const MAX_METRICS: usize = 32;
/// The most measuring logic an objective names.
pub const MAX_MEASURES: usize = 8;
/// The most nodes a metric's goal holds once every name is put in.
pub const MAX_NODES: usize = 4096;
/// How deep parentheses and operators may nest.
pub const MAX_DEPTH: usize = 64;

/// An expression a metric measures (`Expr` in the model).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Expr {
    Num(Dec),
    Reading(String),
    /// The newest reading of a name a Measurer of the AIP's vault wrote, never its author.
    Measured(String),
    /// The number the AIP's lines would put at a path; at the baseline, what main holds there.
    Proposed(String),
    /// The number main holds at a path.
    Current(String),
    Add(Box<Expr>, Box<Expr>),
    Sub(Box<Expr>, Box<Expr>),
    Mul(Box<Expr>, Box<Expr>),
    Div(Box<Expr>, Box<Expr>),
    Neg(Box<Expr>),
    Min(Box<Expr>, Box<Expr>),
    Max(Box<Expr>, Box<Expr>),
}

/// What meets a metric (`Goal` in the model).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Goal {
    AtLeast(Expr, Expr),
    AtMost(Expr, Expr),
    Between(Expr, Expr, Expr),
    Equals(Expr, Expr),
}

/// A metric: the name of its `def`, its name as people read it, its doc comment, and its goal.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Metric {
    pub id: String,
    pub name: String,
    pub note: Option<String>,
    pub goal: Goal,
}

/// Why a file is no objective, and where: line and column from 1.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub line: usize,
    pub col: usize,
    pub why: String,
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "line {}, column {}: {}", self.line, self.col, self.why)
    }
}

fn ok(x: Dec) -> Option<Dec> {
    (-BOUND..=BOUND).contains(&x).then_some(x)
}

/// Where an expression's names read from (`Env` in the model): readings, measured readings, the proposal's numbers,
/// main's numbers.
pub struct Env<'a> {
    pub reading: &'a dyn Fn(&str) -> Option<Dec>,
    pub measured: &'a dyn Fn(&str) -> Option<Dec>,
    pub proposed: &'a dyn Fn(&str) -> Option<Dec>,
    pub current: &'a dyn Fn(&str) -> Option<Dec>,
}

impl Expr {
    /// Its value where every name it reads is in `env`, and nothing on the way leaves the bound (`Expr.eval`).
    pub fn eval(&self, env: &Env) -> Option<Dec> {
        let two = |a: &Expr, b: &Expr| Some((a.eval(env)?, b.eval(env)?));
        match self {
            Expr::Num(m) => ok(*m),
            Expr::Reading(n) => (env.reading)(n).and_then(ok),
            Expr::Measured(n) => (env.measured)(n).and_then(ok),
            Expr::Proposed(p) => (env.proposed)(p).and_then(ok),
            Expr::Current(p) => (env.current)(p).and_then(ok),
            Expr::Add(a, b) => two(a, b).and_then(|(x, y)| ok(x + y)),
            Expr::Sub(a, b) => two(a, b).and_then(|(x, y)| ok(x - y)),
            // a product beyond i128 is beyond the bound once cut: none either way
            Expr::Mul(a, b) => two(a, b).and_then(|(x, y)| ok(x.checked_mul(y)? / ONE)),
            Expr::Div(a, b) => two(a, b).and_then(|(x, y)| if y == 0 { None } else { ok(x * ONE / y) }),
            Expr::Neg(a) => a.eval(env).and_then(|x| ok(-x)),
            Expr::Min(a, b) => two(a, b).map(|(x, y)| x.min(y)),
            Expr::Max(a, b) => two(a, b).map(|(x, y)| x.max(y)),
        }
    }

    /// As the model's vectors write it.
    pub fn to_json(&self) -> Value {
        let two = |k: &str, a: &Expr, b: &Expr| json!({ k: [a.to_json(), b.to_json()] });
        match self {
            Expr::Num(m) => json!({ "num": serde_json::Number::from_i128(*m).map_or(Value::Null, Value::Number) }),
            Expr::Reading(n) => json!({ "reading": n }),
            Expr::Measured(n) => json!({ "measured": n }),
            Expr::Proposed(p) => json!({ "proposed": p }),
            Expr::Current(p) => json!({ "current": p }),
            Expr::Add(a, b) => two("add", a, b),
            Expr::Sub(a, b) => two("sub", a, b),
            Expr::Mul(a, b) => two("mul", a, b),
            Expr::Div(a, b) => two("div", a, b),
            Expr::Neg(a) => json!({ "neg": a.to_json() }),
            Expr::Min(a, b) => two("min", a, b),
            Expr::Max(a, b) => two("max", a, b),
        }
    }

    fn nodes(&self) -> usize {
        match self {
            Expr::Num(_) | Expr::Reading(_) | Expr::Measured(_) | Expr::Proposed(_) | Expr::Current(_) => 1,
            Expr::Neg(a) => 1 + a.nodes(),
            Expr::Add(a, b) | Expr::Sub(a, b) | Expr::Mul(a, b) | Expr::Div(a, b) | Expr::Min(a, b) | Expr::Max(a, b) => {
                1 + a.nodes() + b.nodes()
            }
        }
    }

    /// The readings it names, by `reading` or `measured`, each once, in the order it names them.
    pub fn readings(&self, out: &mut Vec<String>) {
        self.names(&mut |e| match e {
            Expr::Reading(n) | Expr::Measured(n) if !out.contains(n) => out.push(n.clone()),
            _ => {}
        })
    }

    /// The readings it names by `measured`, each once, in the order it names them.
    pub fn measured(&self, out: &mut Vec<String>) {
        self.names(&mut |e| match e {
            Expr::Measured(n) if !out.contains(n) => out.push(n.clone()),
            _ => {}
        })
    }

    /// The paths it reads, by `proposed` or `current`, each once, in the order it names them.
    pub fn paths(&self, out: &mut Vec<String>) {
        self.names(&mut |e| match e {
            Expr::Proposed(p) | Expr::Current(p) if !out.contains(p) => out.push(p.clone()),
            _ => {}
        })
    }

    /// Each leaf, in the order written.
    fn names(&self, f: &mut dyn FnMut(&Expr)) {
        match self {
            Expr::Num(_) | Expr::Reading(_) | Expr::Measured(_) | Expr::Proposed(_) | Expr::Current(_) => f(self),
            Expr::Neg(a) => a.names(f),
            Expr::Add(a, b) | Expr::Sub(a, b) | Expr::Mul(a, b) | Expr::Div(a, b) | Expr::Min(a, b) | Expr::Max(a, b) => {
                a.names(f);
                b.names(f);
            }
        }
    }
}

impl Goal {
    /// What it measures.
    pub fn measured(&self) -> &Expr {
        match self {
            Goal::AtLeast(e, _) | Goal::AtMost(e, _) | Goal::Between(e, _, _) | Goal::Equals(e, _) => e,
        }
    }

    /// Its targets, in the order written.
    pub fn targets(&self) -> Vec<&Expr> {
        match self {
            Goal::AtLeast(_, t) | Goal::AtMost(_, t) | Goal::Equals(_, t) => vec![t],
            Goal::Between(_, lo, hi) => vec![lo, hi],
        }
    }

    /// Its kind's name, as Lean writes it.
    pub fn kind(&self) -> &'static str {
        match self {
            Goal::AtLeast(..) => "atLeast",
            Goal::AtMost(..) => "atMost",
            Goal::Between(..) => "between",
            Goal::Equals(..) => "equals",
        }
    }

    /// How far `v` is from what meets it, its targets `ts` as they read (`Goal.distance`).
    fn distance(&self, v: Dec, ts: &[Dec]) -> Option<Dec> {
        match (self, ts) {
            (Goal::AtLeast(..), [t]) => Some((t - v).max(0)),
            (Goal::AtMost(..), [t]) => Some((v - t).max(0)),
            (Goal::Equals(..), [t]) => Some((v - t).abs()),
            (Goal::Between(..), [lo, hi]) => Some(if v < *lo { lo - v } else if *hi < v { v - hi } else { 0 }),
            _ => None,
        }
    }

    pub fn to_json(&self) -> Value {
        let all: Vec<Value> = std::iter::once(self.measured()).chain(self.targets()).map(Expr::to_json).collect();
        json!({ self.kind(): all })
    }

    fn nodes(&self) -> usize {
        self.measured().nodes() + self.targets().iter().map(|t| t.nodes()).sum::<usize>()
    }

    /// Every expression in it, the measured one first.
    fn exprs(&self) -> impl Iterator<Item = &Expr> {
        std::iter::once(self.measured()).chain(self.targets())
    }
}

/// A metric as its readings read (`Result` in the model).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Checked {
    pub value: Option<Dec>,
    pub baseline: Option<Dec>,
    pub targets: Vec<Option<Dec>>,
    pub met: bool,
    pub progress: Dec,
}

/// Readings, each a name and a value, in the order recorded.
pub type Readings = [(String, Dec)];

/// Numbers by path, as the engine found them in records (`Fields` in the model).
pub type Fields = [(String, Dec)];

/// What a metric is checked against (`Inputs` in the model): the readings recorded, those of them a Measurer wrote,
/// and the numbers found at the paths the objective names, in the AIP's proposed lines and on main.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Inputs {
    pub readings: Vec<(String, Dec)>,
    pub measured: Vec<(String, Dec)>,
    pub proposed: Vec<(String, Dec)>,
    pub current: Vec<(String, Dec)>,
}

fn get(fs: &Fields, p: &str) -> Option<Dec> {
    fs.iter().find(|(k, _)| k == p).map(|(_, v)| *v)
}

fn first(rs: &Readings, n: &str) -> Option<Dec> {
    rs.iter().find(|(k, _)| k == n).map(|(_, v)| *v)
}

fn newest(rs: &Readings, n: &str) -> Option<Dec> {
    rs.iter().rev().find(|(k, _)| k == n).map(|(_, v)| *v)
}

/// `progressOf`: `ONE` once met; else the distance now against the distance at the baseline, clamped to `0..=ONE`,
/// `0` where either is unmeasured or the baseline was no farther.
fn progress_of(met: bool, now: Option<Dec>, base: Option<Dec>) -> Dec {
    match (met, now, base) {
        (true, ..) => ONE,
        (false, Some(d), Some(d0)) if d0 > d => (ONE - d * ONE / d0).clamp(0, ONE),
        _ => 0,
    }
}

impl Metric {
    /// This metric against inputs `i` (`Metric.check`): now, the newest readings and the proposal's numbers; at the
    /// baseline, the first readings and main's numbers where the proposal's would be.
    pub fn check(&self, i: &Inputs) -> Checked {
        let (rs, ms, p, c) = (&i.readings[..], &i.measured[..], &i.proposed[..], &i.current[..]);
        let now = Env {
            reading: &|n| newest(rs, n),
            measured: &|n| newest(ms, n),
            proposed: &|x| get(p, x),
            current: &|x| get(c, x),
        };
        let base = Env {
            reading: &|n| first(rs, n),
            measured: &|n| first(ms, n),
            proposed: &|x| get(c, x),
            current: &|x| get(c, x),
        };
        let g = &self.goal;
        let value = g.measured().eval(&now);
        let baseline = g.measured().eval(&base);
        let targets: Vec<Option<Dec>> = g.targets().iter().map(|t| t.eval(&now)).collect();
        let ts: Option<Vec<Dec>> = targets.iter().copied().collect();
        let now = ts.as_ref().and_then(|ts| g.distance(value?, ts));
        let base = ts.as_ref().and_then(|ts| g.distance(baseline?, ts));
        let met = now == Some(0);
        Checked { value, baseline, targets, met, progress: progress_of(met, now, base) }
    }
}

/// An objective against readings: each metric's result, how many are met, and their mean progress (`check`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Summary {
    pub results: Vec<Checked>,
    pub met: usize,
    pub total: usize,
    pub progress: Dec,
}

pub fn check(metrics: &[Metric], i: &Inputs) -> Summary {
    let results: Vec<Checked> = metrics.iter().map(|m| m.check(i)).collect();
    let total = results.len();
    let sum: Dec = results.iter().map(|r| r.progress).sum();
    let met = results.iter().filter(|r| r.met).count();
    Summary { results, met, total, progress: if total == 0 { 0 } else { sum / total as Dec } }
}

/// A decimal as a JSON number, for people: exact where it fits an f64's digits.
pub fn number(d: Dec) -> Value {
    let units = d / ONE;
    let rest = (d % ONE).abs();
    if rest == 0 {
        if let Ok(n) = i64::try_from(units) {
            return n.into();
        }
    }
    let text = match rest {
        0 => format!("{units}"),
        _ => {
            let sign = if d < 0 && units == 0 { "-" } else { "" };
            format!("{sign}{units}.{}", format!("{rest:06}").trim_end_matches('0'))
        }
    };
    text.parse::<f64>().ok().and_then(|f| serde_json::Number::from_f64(f).map(Value::Number)).unwrap_or(Value::Null)
}

/// A reading's value, a JSON number, in millionths: its shortest decimal, six places kept and the rest cut toward
/// zero, as a literal reads; none beyond the bound, or for a value that is no finite number.
pub fn dec_of(v: &Value) -> Option<Dec> {
    match v {
        Value::Number(n) if n.is_i64() => ok((n.as_i64()? as Dec).checked_mul(ONE)?),
        Value::Number(n) if n.is_u64() => ok((n.as_u64()? as Dec).checked_mul(ONE)?),
        Value::Number(n) => {
            let f = n.as_f64().filter(|f| f.is_finite())?;
            decimal(&format!("{f}"))
        }
        _ => None,
    }
}

/// A plain decimal's text (`-12.5`, `0.000001`), in millionths, six places kept, the rest cut toward zero.
fn decimal(text: &str) -> Option<Dec> {
    let (neg, body) = match text.strip_prefix('-') {
        Some(b) => (true, b),
        None => (false, text),
    };
    let (whole, frac) = body.split_once('.').unwrap_or((body, ""));
    if whole.is_empty() || !whole.bytes().all(|b| b.is_ascii_digit()) || !frac.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let mut m: Dec = 0;
    for b in whole.bytes() {
        m = m.checked_mul(10)?.checked_add((b - b'0') as Dec)?;
        if m > BOUND {
            return None;
        }
    }
    m = m.checked_mul(ONE)?;
    let mut place = ONE / 10;
    for b in frac.bytes().take(6) {
        m += (b - b'0') as Dec * place;
        place /= 10;
    }
    ok(if neg { -m } else { m })
}

/// The paths an objective's metrics read, by `proposed` or `current`, each once, in the order written: what the
/// engine looks up in the AIP's lines and on main to make its `Inputs`.
pub fn paths(metrics: &[Metric]) -> Vec<String> {
    let mut out = vec![];
    for e in metrics.iter().flat_map(|m| m.goal.exprs()) {
        e.paths(&mut out);
    }
    out
}

/// The objective as JSON, for the pages and the agents: each metric `{id, name, note, goal, readings, measured, paths,
/// value, baseline, targets, met, progress}`, `measured` the readings it counts only as a Measurer wrote them, numbers
/// as people read them and progress from 0 to 1, then how many are met, of how many, and the mean progress.
pub fn summary_json(metrics: &[Metric], i: &Inputs) -> Value {
    let s = check(metrics, i);
    let fraction = |p: Dec| number(p);
    let opt = |d: Option<Dec>| d.map_or(Value::Null, number);
    let items: Vec<Value> = metrics
        .iter()
        .zip(&s.results)
        .map(|(m, r)| {
            let (mut names, mut measured, mut paths) = (vec![], vec![], vec![]);
            for e in m.goal.exprs() {
                e.readings(&mut names);
                e.measured(&mut measured);
                e.paths(&mut paths);
            }
            json!({
                "id": m.id,
                "name": m.name,
                "note": m.note,
                "goal": m.goal.kind(),
                "readings": names,
                "measured": measured,
                "paths": paths,
                "value": opt(r.value),
                "baseline": opt(r.baseline),
                "targets": r.targets.iter().map(|t| opt(*t)).collect::<Vec<_>>(),
                "met": r.met,
                "progress": fraction(r.progress),
            })
        })
        .collect();
    json!({ "metrics": items, "met": s.met, "total": s.total, "progress": fraction(s.progress) })
}

/// A path's entry, where it names one: the hex before its slash (`1a2b3c4d/params.#1.default`), then the rest.
pub fn entry_of(path: &str) -> (Option<&str>, &str) {
    match path.split_once('/') {
        Some((hex, rest)) => (Some(hex), rest),
        None => (None, path),
    }
}

/// What a record holds at `path` (its entry, if named, cut off first: `entry_of`): field names split by dots, `#n`
/// the row of a list whose id is n. `None` where it holds nothing there.
pub fn at_path<'a>(record: &'a Value, path: &str) -> Option<&'a Value> {
    let (_, path) = entry_of(path);
    path.split('.').try_fold(record, |at, seg| match seg.strip_prefix('#') {
        Some(id) => {
            let id: i64 = id.parse().ok()?;
            at.as_array()?.iter().find(|row| row.get("id").and_then(Value::as_i64) == Some(id))
        }
        None => at.as_object()?.get(seg),
    })
}

/// The number a record holds at `path` (`at_path`), in millionths: none where it holds no number there.
pub fn number_at(record: &Value, path: &str) -> Option<Dec> {
    at_path(record, path).and_then(dec_of)
}

/// Why `path` is no path (`Parser::path`), if it isn't one.
fn bad_path(path: &str) -> Option<String> {
    let (entry, rest) = entry_of(path);
    if path.is_empty() {
        return Some("a path needs a field name, such as params.#1.default".into());
    }
    if let Some(hex) = entry {
        if hex.len() < 8 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Some(format!("{hex} is no entry: the first 8 or more hex digits of its id, then /"));
        }
    }
    for seg in rest.split('.') {
        match seg.strip_prefix('#') {
            _ if seg.is_empty() => return Some(format!("\"{path}\" has an empty field: names split by single dots")),
            Some(id) if id.parse::<i64>().is_err() => {
                return Some(format!("{seg} is no row: # then its id, a whole number"));
            }
            _ if seg.contains('/') => return Some(format!("\"{path}\" has more than one /")),
            _ => {}
        }
    }
    None
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the Lean subset

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Ident(String),
    Str(String),
    Num(Dec),
    Sym(&'static str),
    Doc(String),
}

#[derive(Clone, Debug)]
struct Token {
    tok: Tok,
    line: usize,
    col: usize,
}

fn err<T>(line: usize, col: usize, why: impl Into<String>) -> Result<T, Error> {
    Err(Error { line, col, why: why.into() })
}

fn lex(src: &str) -> Result<Vec<Token>, Error> {
    let chars: Vec<char> = src.chars().collect();
    let (mut i, mut line, mut col) = (0usize, 1usize, 1usize);
    let mut out = vec![];
    let step = |i: &mut usize, line: &mut usize, col: &mut usize| {
        if chars[*i] == '\n' {
            *line += 1;
            *col = 1;
        } else {
            *col += 1;
        }
        *i += 1;
    };
    while i < chars.len() {
        let c = chars[i];
        let (l, k) = (line, col);
        let at = |j: usize| chars.get(j).copied();
        if c.is_whitespace() {
            step(&mut i, &mut line, &mut col);
        } else if c == '-' && at(i + 1) == Some('-') {
            while i < chars.len() && chars[i] != '\n' {
                step(&mut i, &mut line, &mut col);
            }
        } else if c == '/' && at(i + 1) == Some('-') {
            let doc = at(i + 2) == Some('-') && at(i + 3) != Some('/');
            step(&mut i, &mut line, &mut col);
            step(&mut i, &mut line, &mut col);
            if doc {
                step(&mut i, &mut line, &mut col);
            }
            let (mut depth, start) = (1, i);
            loop {
                if i >= chars.len() {
                    return err(l, k, "a comment that never ends: close it with -/");
                }
                if chars[i] == '/' && at(i + 1) == Some('-') {
                    depth += 1;
                    step(&mut i, &mut line, &mut col);
                } else if chars[i] == '-' && at(i + 1) == Some('/') {
                    depth -= 1;
                    if depth == 0 {
                        let text: String = chars[start..i].iter().collect();
                        step(&mut i, &mut line, &mut col);
                        step(&mut i, &mut line, &mut col);
                        if doc {
                            let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
                            out.push(Token { tok: Tok::Doc(text), line: l, col: k });
                        }
                        break;
                    }
                    step(&mut i, &mut line, &mut col);
                }
                step(&mut i, &mut line, &mut col);
            }
        } else if c == '"' {
            step(&mut i, &mut line, &mut col);
            let mut s = String::new();
            loop {
                match at(i) {
                    None | Some('\n') => return err(l, k, "a string that never ends: close it with \""),
                    Some('"') => break,
                    Some('\\') => {
                        let e = match at(i + 1) {
                            Some('"') => '"',
                            Some('\\') => '\\',
                            Some('n') => '\n',
                            Some('t') => '\t',
                            _ => return err(line, col, "an escape a string may not hold: only \\\" \\\\ \\n \\t"),
                        };
                        s.push(e);
                        step(&mut i, &mut line, &mut col);
                    }
                    Some(ch) => s.push(ch),
                }
                step(&mut i, &mut line, &mut col);
            }
            step(&mut i, &mut line, &mut col);
            if s.chars().count() > 160 {
                return err(l, k, "a name of at most 160 characters");
            }
            out.push(Token { tok: Tok::Str(s), line: l, col: k });
        } else if c.is_ascii_digit() {
            let start = i;
            while at(i).is_some_and(|c| c.is_ascii_digit() || c == '.') {
                step(&mut i, &mut line, &mut col);
            }
            if at(i).is_some_and(|c| c.is_alphanumeric() || c == '_') {
                return err(l, k, "a plain decimal, such as 1500 or 0.8: no exponents, no letters in numbers");
            }
            let text: String = chars[start..i].iter().collect();
            if text.ends_with('.') || text.matches('.').count() > 1 {
                return err(l, k, format!("{text} is no decimal"));
            }
            let Some(m) = decimal(&text) else { return err(l, k, format!("{text} is beyond 10^24")) };
            out.push(Token { tok: Tok::Num(m), line: l, col: k });
        } else if c.is_alphabetic() || c == '_' {
            let start = i;
            while at(i).is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '\'' || c == '.') {
                step(&mut i, &mut line, &mut col);
            }
            let text: String = chars[start..i].iter().collect();
            if text.ends_with('.') || text.contains("..") {
                return err(l, k, format!("{text} is no name"));
            }
            out.push(Token { tok: Tok::Ident(text), line: l, col: k });
        } else {
            let two: String = chars[i..chars.len().min(i + 2)].iter().collect();
            let sym = match (two.as_str(), c) {
                (":=", _) => ":=",
                (_, ':') => ":",
                (_, '(') => "(",
                (_, ')') => ")",
                (_, '[') => "[",
                (_, ']') => "]",
                (_, ',') => ",",
                (_, '+') => "+",
                (_, '-') => "-",
                (_, '*') => "*",
                (_, '/') => "/",
                _ => return err(l, k, format!("'{c}' has no meaning in an objective")),
            };
            for _ in 0..sym.len() {
                step(&mut i, &mut line, &mut col);
            }
            out.push(Token { tok: Tok::Sym(sym), line: l, col: k });
        }
    }
    Ok(out)
}

/// Words an objective's names may not take.
const RESERVED: [&str; 23] = [
    "def", "import", "open", "namespace", "end", "metric", "reading", "measured", "proposed", "current", "min", "max",
    "atLeast", "atMost", "between", "equals", "Metric", "Expr", "List", "theorem", "where", "logic", "Measure",
];

struct Parser {
    toks: Vec<Token>,
    at: usize,
    exprs: HashMap<String, Expr>,
    end: (usize, usize),
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.at).map(|t| &t.tok)
    }

    fn here(&self) -> (usize, usize) {
        self.toks.get(self.at).map_or(self.end, |t| (t.line, t.col))
    }

    fn fail<T>(&self, why: impl Into<String>) -> Result<T, Error> {
        let (l, c) = self.here();
        err(l, c, why)
    }

    fn next(&mut self) -> Option<Tok> {
        let t = self.toks.get(self.at).map(|t| t.tok.clone());
        self.at += 1;
        t
    }

    fn sym(&mut self, s: &'static str) -> Result<(), Error> {
        match self.peek() {
            Some(Tok::Sym(x)) if *x == s => {
                self.at += 1;
                Ok(())
            }
            _ => self.fail(format!("expected {s}")),
        }
    }

    fn word(&mut self, w: &str) -> Result<(), Error> {
        match self.peek() {
            Some(Tok::Ident(x)) if x == w => {
                self.at += 1;
                Ok(())
            }
            _ => self.fail(format!("expected {w}")),
        }
    }

    fn ident(&mut self) -> Result<String, Error> {
        match self.peek() {
            Some(Tok::Ident(x)) => {
                let x = x.clone();
                self.at += 1;
                Ok(x)
            }
            _ => self.fail("expected a name"),
        }
    }

    fn string(&mut self) -> Result<String, Error> {
        match self.peek() {
            Some(Tok::Str(x)) => {
                let x = x.clone();
                self.at += 1;
                Ok(x)
            }
            _ => self.fail("expected a string in quotes"),
        }
    }

    /// A path in quotes (`bad_path`).
    fn path(&mut self) -> Result<String, Error> {
        let p = self.string()?;
        if let Some(why) = bad_path(&p) {
            self.at -= 1;
            return self.fail(why);
        }
        Ok(p)
    }

    fn deep(&self, depth: usize) -> Result<(), Error> {
        match depth > MAX_DEPTH {
            true => self.fail(format!("nested more than {MAX_DEPTH} deep")),
            false => Ok(()),
        }
    }

    /// `+` and `-`, left to right.
    fn expr(&mut self, depth: usize) -> Result<Expr, Error> {
        self.deep(depth)?;
        let mut e = self.term(depth + 1)?;
        while let Some(Tok::Sym(s @ ("+" | "-"))) = self.peek() {
            let s = *s;
            self.at += 1;
            let r = self.term(depth + 1)?;
            e = if s == "+" { Expr::Add(e.into(), r.into()) } else { Expr::Sub(e.into(), r.into()) };
        }
        Ok(e)
    }

    /// `*` and `/`, left to right.
    fn term(&mut self, depth: usize) -> Result<Expr, Error> {
        self.deep(depth)?;
        let mut e = self.unary(depth + 1)?;
        while let Some(Tok::Sym(s @ ("*" | "/"))) = self.peek() {
            let s = *s;
            self.at += 1;
            let r = self.unary(depth + 1)?;
            e = if s == "*" { Expr::Mul(e.into(), r.into()) } else { Expr::Div(e.into(), r.into()) };
        }
        Ok(e)
    }

    fn unary(&mut self, depth: usize) -> Result<Expr, Error> {
        self.deep(depth)?;
        if let Some(Tok::Sym("-")) = self.peek() {
            self.at += 1;
            return Ok(Expr::Neg(self.unary(depth + 1)?.into()));
        }
        self.app(depth + 1)
    }

    /// `reading "x"`, `measured "x"`, `proposed "path"`, `current "path"`, `min a b`, `max a b`, or an argument.
    fn app(&mut self, depth: usize) -> Result<Expr, Error> {
        match self.peek() {
            Some(Tok::Ident(w)) if w == "reading" || w == "measured" => {
                let measured = w == "measured";
                self.at += 1;
                let n = self.string()?;
                if n.is_empty() {
                    return self.fail("a reading needs a name");
                }
                Ok(if measured { Expr::Measured(n) } else { Expr::Reading(n) })
            }
            Some(Tok::Ident(w)) if w == "proposed" || w == "current" => {
                let proposed = w == "proposed";
                self.at += 1;
                let p = self.path()?;
                Ok(if proposed { Expr::Proposed(p) } else { Expr::Current(p) })
            }
            Some(Tok::Ident(w)) if w == "min" || w == "max" => {
                let min = w == "min";
                self.at += 1;
                let a = self.arg(depth + 1)?;
                let b = self.arg(depth + 1)?;
                Ok(if min { Expr::Min(a.into(), b.into()) } else { Expr::Max(a.into(), b.into()) })
            }
            _ => self.arg(depth),
        }
    }

    /// A number, the name of an earlier `Expr`, or an expression in parentheses.
    fn arg(&mut self, depth: usize) -> Result<Expr, Error> {
        self.deep(depth)?;
        match self.peek().cloned() {
            Some(Tok::Num(m)) => {
                self.at += 1;
                Ok(Expr::Num(m))
            }
            Some(Tok::Sym("(")) => {
                self.at += 1;
                let e = self.expr(depth + 1)?;
                self.sym(")")?;
                Ok(e)
            }
            Some(Tok::Ident(x)) => match self.exprs.get(&x) {
                Some(e) => {
                    self.at += 1;
                    Ok(e.clone())
                }
                None if RESERVED.contains(&x.as_str()) => {
                    self.fail(format!("{x} takes its arguments: put it in parentheses here"))
                }
                None => self.fail(format!("{x} is no Expr defined above")),
            },
            Some(Tok::Sym("-")) => self.fail("a negative argument goes in parentheses, as in Lean: (-5)"),
            _ => self.fail("expected a number, a name or an expression in parentheses"),
        }
    }

    fn goal(&mut self) -> Result<Goal, Error> {
        let w = self.ident()?;
        let mut arg = || self.arg(1);
        Ok(match w.as_str() {
            "atLeast" => Goal::AtLeast(arg()?, arg()?),
            "atMost" => Goal::AtMost(arg()?, arg()?),
            "equals" => Goal::Equals(arg()?, arg()?),
            "between" => Goal::Between(arg()?, arg()?, arg()?),
            _ => {
                self.at -= 1;
                return self.fail(format!("{w} is no goal: atLeast, atMost, between or equals"));
            }
        })
    }
}

/// An objective file as it reads: its metrics, in their order, and the measuring logic it names, in file order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Objective {
    pub metrics: Vec<Metric>,
    pub measures: Vec<String>,
}

/// Whether `name` may name a measuring logic, the last part of a ref (`Measure.named`): 1 to 64 of a-z, 0-9 and `-`.
pub fn measure_named(name: &str) -> bool {
    (1..=64).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// The key of objective `src`, its Lean as written: the first 16 hex digits of its BLAKE3 hash. A Lean verdict on it
/// is a Measurer's reading named for it (`verdict_name`), so a verdict counts for the objective it was made on alone.
pub fn key(src: &str) -> String {
    blake3::hash(src.as_bytes()).to_hex()[..16].to_string()
}

/// The name of a Lean verdict's reading on the objective keyed `key` (`Measurers.lean`'s `verdictName`).
pub fn verdict_name(key: &str) -> String {
    format!("lean:{key}")
}

/// Of the readings a vault's Measurers wrote, oldest first, each its name and value: the verdict on the objective keyed
/// `key`, the newest reading named for it, whether it is one (`Measurers.lean`'s `leanVerdict`, L1 to L3).
pub fn lean_verdict<'a>(measured: impl DoubleEndedIterator<Item = (&'a str, Dec)>, key: &str) -> Option<bool> {
    let name = verdict_name(key);
    measured.rev().find(|(n, _)| *n == name).map(|(_, v)| v == ONE)
}

/// The metrics of an objective file, in their order: `Error` with where and why for anything else (`read`).
pub fn parse(src: &str) -> Result<Vec<Metric>, Error> {
    read(src).map(|o| o.metrics)
}

/// An objective file, its metrics and the measuring logic it names: `Error` with where and why for anything else.
pub fn read(src: &str) -> Result<Objective, Error> {
    if src.len() > MAX_LEN {
        return err(1, 1, format!("an objective of at most {MAX_LEN} bytes"));
    }
    let toks = lex(src)?;
    let end = toks.last().map_or((1, 1), |t| (t.line, t.col));
    let mut p = Parser { toks, at: 0, exprs: HashMap::new(), end };
    let mut metrics: Vec<Metric> = vec![];
    let mut measures: Vec<String> = vec![];
    let mut order: Option<Vec<String>> = None;
    let mut spaces: Vec<String> = vec![];
    let mut names: Vec<String> = vec![];
    while let Some(tok) = p.peek().cloned() {
        let doc = match tok {
            Tok::Doc(d) => {
                p.at += 1;
                match p.peek() {
                    Some(Tok::Ident(w)) if w == "def" => Some(d),
                    _ => return p.fail("a doc comment /-- … -/ stands above a def"),
                }
            }
            _ => None,
        };
        let w = p.ident()?;
        match w.as_str() {
            "import" | "open" => {
                if p.next() != Some(Tok::Ident("AvenDB.Objective".into())) {
                    p.at -= 1;
                    return p.fail(format!("an objective may {w} AvenDB.Objective alone"));
                }
            }
            "namespace" => spaces.push(p.ident()?),
            "end" => {
                let n = p.ident()?;
                if spaces.pop().as_ref() != Some(&n) {
                    p.at -= 1;
                    return p.fail(format!("end {n} closes no namespace {n}"));
                }
            }
            "def" => {
                let name = p.ident()?;
                if RESERVED.contains(&name.as_str()) || name.contains('.') {
                    p.at -= 1;
                    return p.fail(format!("{name} can't be the name of a def here"));
                }
                if names.contains(&name) {
                    p.at -= 1;
                    return p.fail(format!("{name} is defined twice"));
                }
                p.sym(":")?;
                let ty = p.ident()?;
                match ty.as_str() {
                    "Metric" => {
                        p.sym(":=")?;
                        p.word("metric")?;
                        let label = p.string()?;
                        p.sym("(")?;
                        let goal = p.goal()?;
                        p.sym(")")?;
                        if goal.nodes() > MAX_NODES {
                            return p.fail(format!("a metric of at most {MAX_NODES} parts"));
                        }
                        if metrics.len() == MAX_METRICS {
                            return p.fail(format!("an objective of at most {MAX_METRICS} metrics"));
                        }
                        metrics.push(Metric { id: name.clone(), name: label, note: doc, goal });
                    }
                    "Expr" => {
                        p.sym(":=")?;
                        let e = p.expr(1)?;
                        if e.nodes() > MAX_NODES {
                            return p.fail(format!("an expression of at most {MAX_NODES} parts"));
                        }
                        p.exprs.insert(name.clone(), e);
                    }
                    "Measure" => {
                        p.sym(":=")?;
                        p.word("logic")?;
                        let logic = p.string()?;
                        if !measure_named(&logic) {
                            p.at -= 1;
                            return p.fail(format!("{logic:?} names no logic: 1 to 64 of a-z, 0-9 and -"));
                        }
                        if measures.contains(&logic) {
                            p.at -= 1;
                            return p.fail(format!("logic {logic:?} is named twice"));
                        }
                        if measures.len() == MAX_MEASURES {
                            return p.fail(format!("an objective names at most {MAX_MEASURES} measuring logic"));
                        }
                        measures.push(logic);
                    }
                    "List" => {
                        p.word("Metric")?;
                        if name != "objective" {
                            p.at -= 1;
                            return p.fail("the one List Metric is `objective`, the metrics in their order");
                        }
                        p.sym(":=")?;
                        p.sym("[")?;
                        let mut list = vec![];
                        while !matches!(p.peek(), Some(Tok::Sym("]"))) {
                            if !list.is_empty() {
                                p.sym(",")?;
                            }
                            let m = p.ident()?;
                            if !metrics.iter().any(|x| x.id == m) {
                                p.at -= 1;
                                return p.fail(format!("{m} is no Metric defined above"));
                            }
                            list.push(m);
                        }
                        p.sym("]")?;
                        order = Some(list);
                    }
                    _ => {
                        p.at -= 1;
                        let why = format!("a def here is a Metric, an Expr, a Measure or `objective`, never a {ty}");
                        return p.fail(why);
                    }
                }
                names.push(name);
            }
            _ => {
                p.at -= 1;
                return p.fail(format!("{w}: an objective holds defs of metrics alone"));
            }
        }
    }
    if let Some(n) = spaces.pop() {
        return err(p.end.0, p.end.1, format!("namespace {n} never ends"));
    }
    let metrics = match order {
        Some(list) => list.iter().filter_map(|id| metrics.iter().find(|m| &m.id == id).cloned()).collect(),
        None => metrics,
    };
    if metrics.is_empty() {
        return err(p.end.0, p.end.1, "an objective holds at least one metric");
    }
    Ok(Objective { metrics, measures })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimals_cut_toward_zero() {
        assert_eq!(decimal("1500"), Some(1_500 * ONE));
        assert_eq!(decimal("0.8"), Some(800_000));
        assert_eq!(decimal("-0.0000019"), Some(-1));
        assert_eq!(dec_of(&json!(0.1)), Some(100_000));
        assert_eq!(dec_of(&json!(-12.5)), Some(-12_500_000));
        assert_eq!(dec_of(&json!(1e30)), None);
        assert_eq!(number(-500_000), json!(-0.5));
        assert_eq!(number(1_250_000), json!(1.25));
    }

    #[test]
    fn refuses_what_is_no_objective() {
        let bad = |src: &str| parse(src).unwrap_err().why;
        assert!(bad("").contains("at least one metric"));
        assert!(bad("import Mathlib").contains("AvenDB.Objective alone"));
        assert!(bad("#eval 1").contains("no meaning"));
        assert!(bad("def x : Metric := metric \"x\" (atLeast (reading \"a\") -1)").contains("parentheses"));
        assert!(bad("def x : Metric := metric \"x\" (above (reading \"a\") 1)").contains("no goal"));
        assert!(bad("def x : Metric := metric \"x\" (atLeast y 1)").contains("no Expr"));
        assert!(bad("def x : Metric := metric \"x\" (atLeast (reading \"a\") 1e3)").contains("plain decimal"));
        assert!(bad("def x : Nat := 1").contains("never a Nat"));
        assert!(bad("theorem x : True := trivial").contains("defs of metrics alone"));
        assert!(bad("/- open").contains("never ends"));
        assert!(bad("namespace A\ndef x : Metric := metric \"x\" (atLeast 1 1)").contains("never ends"));
        let deep = format!("def x : Expr := {}1{}", "(".repeat(200), ")".repeat(200));
        assert!(bad(&deep).contains("nested"));
        let mut wide = String::from("def e0 : Expr := reading \"a\"\n");
        for i in 1..20 {
            wide += &format!("def e{i} : Expr := e{} + e{}\n", i - 1, i - 1);
        }
        assert!(bad(&wide).contains("parts"));
        assert!(bad("def x : Metric := metric \"x\" (atLeast (proposed \"\") 1)").contains("field name"));
        assert!(bad("def x : Metric := metric \"x\" (atLeast (proposed \"a..b\") 1)").contains("empty field"));
        assert!(bad("def x : Metric := metric \"x\" (atLeast (current \"rows.#x\") 1)").contains("no row"));
        assert!(bad("def x : Metric := metric \"x\" (atLeast (current \"1a2b/a\") 1)").contains("no entry"));
        assert!(bad("def x : Metric := metric \"x\" (atLeast (current \"1a2b3c4d/a/b\") 1)").contains("one /"));
        assert!(bad("def proposed : Expr := 1").contains("can't be the name"));
        assert!(bad("def measured : Expr := 1").contains("can't be the name"));
        assert!(bad("def x : Metric := metric \"x\" (atLeast (measured \"\") 1)").contains("needs a name"));
    }

    #[test]
    fn reads_paths_in_records() {
        let r = json!({"engine": {"version": 4}, "params": [{"id": 2, "default": 0.6}, {"id": 1, "default": "tall"}]});
        assert_eq!(number_at(&r, "engine.version"), Some(4 * ONE));
        assert_eq!(number_at(&r, "1a2b3c4d/params.#2.default"), Some(600_000));
        assert_eq!(number_at(&r, "params.#1.default"), None);
        assert!(at_path(&r, "params.#1.default").is_some());
        assert_eq!(at_path(&r, "params.#3.default"), None);
        assert_eq!(at_path(&r, "engine.version.major"), None);
        assert_eq!(entry_of("1a2b3c4d/a.b"), (Some("1a2b3c4d"), "a.b"));
        let ms = parse("def x : Metric := metric \"x\" (atLeast (proposed \"a.#1.b\" - current \"c\") (reading \"d\"))")
            .unwrap();
        assert_eq!(paths(&ms), ["a.#1.b", "c"]);
        let ms = parse("def x : Metric := metric \"x\" (atLeast (measured \"fps\" + reading \"cpu\") 1)").unwrap();
        let (mut all, mut measured) = (vec![], vec![]);
        ms[0].goal.measured().readings(&mut all);
        ms[0].goal.measured().measured(&mut measured);
        assert_eq!((all, measured), (vec!["fps".to_string(), "cpu".into()], vec!["fps".to_string()]));
    }

    #[test]
    fn reads_the_measuring_logic_it_names() {
        let head = "import AvenDB.Objective\nopen AvenDB.Objective\n";
        let fps = "def fps : Metric := metric \"F\" (atLeast (measured \"fps\") 50)\n";
        let sim = "/-- The sim. -/\ndef sim : Measure := logic \"valley-sim\"\n";
        let src = format!("{head}{sim}{fps}def b : Measure := logic \"b2\"");
        let o = read(&src).unwrap();
        assert_eq!(o.measures, vec!["valley-sim".to_string(), "b2".into()]);
        assert_eq!(o.metrics.len(), 1);
        assert_eq!(read(&format!("{head}{fps}")).unwrap().measures, Vec::<String>::new());
        for bad in ["Valley", "", "a/b", "a b", &"x".repeat(65)] {
            let src = format!("{head}{fps}def sim : Measure := logic {bad:?}");
            assert!(read(&src).unwrap_err().why.contains("names no logic"), "{bad}");
        }
        let twice = format!("{head}{fps}def a : Measure := logic \"s\"\ndef b : Measure := logic \"s\"");
        assert!(read(&twice).unwrap_err().why.contains("twice"));
        let many: String = (0..=MAX_MEASURES).map(|i| format!("def m{i} : Measure := logic \"m{i}\"\n")).collect();
        assert!(read(&format!("{head}{fps}{many}")).unwrap_err().why.contains("at most"));
        assert!(read(&format!("{head}def sim : Measure := logic \"s\"")).unwrap_err().why.contains("one metric"));
        assert!(read(&format!("{head}{fps}def logic : Expr := 1")).is_err());
    }

    #[test]
    fn reads_notes_and_order() {
        let src = "/-- second -/\ndef b : Metric := metric \"B\" (atMost (reading \"b\") 1)\n\
                   def a : Metric := metric \"A\" (equals 1 1)\ndef objective : List Metric := [a, b]";
        let ms = parse(src).unwrap();
        assert_eq!(ms.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(ms[1].note.as_deref(), Some("second"));
        let e = parse("def x : Metric := metric \"x\" (atLeast (1 - 2 - 3) (-reading \"a\" * 2))").unwrap();
        let Goal::AtLeast(l, r) = &e[0].goal else { panic!() };
        assert_eq!(l.to_json(), json!({"sub": [{"sub": [{"num": 1_000_000}, {"num": 2_000_000}]}, {"num": 3_000_000}]}));
        assert_eq!(r.to_json(), json!({"mul": [{"neg": {"reading": "a"}}, {"num": 2_000_000}]}));
    }
}
