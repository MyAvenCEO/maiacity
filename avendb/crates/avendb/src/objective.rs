//! Objectives: what an AIP must deliver, measured (`docs/ARCHITECTURE.md` §8, "AIPs"; the model is
//! `spec/AvenDB/Objective.lean`, and `spec/vectors/objectives.json` holds this engine to it).
//!
//! An objective is a file of Lean against `AvenDB.Objective`: metrics, each a name and a goal over readings, numbers
//! an AIP records while it is worked on (`aip_measure`). This module reads the subset of Lean such a file is written
//! in and checks its metrics against readings, as the model does, so every device answers alike:
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
//!   "name" (goal)`, `def x : Expr := expr`, and `def objective : List Metric := [x, …]`, the metrics in their order
//!   (without it, every metric in file order). A doc comment `/-- … -/` above a metric is its note; `--` and `/- … -/`
//!   (nested) are comments.
//! - **Goals**: `atLeast e t`, `atMost e t`, `between e lo hi`, `equals e t`, each argument a number, a name of an
//!   earlier `Expr`, or an expression in parentheses, as Lean applies functions.
//! - **Expressions**: plain decimals (`1500`, `0.8`), `reading "name"`, `min a b`, `max a b`, `-x`, `* /` then `+ -`,
//!   left to right, as Lean's precedences read them (`-` binds tighter than `*`).
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
/// The most nodes a metric's goal holds once every name is put in.
pub const MAX_NODES: usize = 4096;
/// How deep parentheses and operators may nest.
pub const MAX_DEPTH: usize = 64;

/// An expression a metric measures (`Expr` in the model).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Expr {
    Num(Dec),
    Reading(String),
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

impl Expr {
    /// Its value where every reading it names is in `env`, and nothing on the way leaves the bound (`Expr.eval`).
    pub fn eval(&self, env: &dyn Fn(&str) -> Option<Dec>) -> Option<Dec> {
        let two = |a: &Expr, b: &Expr| Some((a.eval(env)?, b.eval(env)?));
        match self {
            Expr::Num(m) => ok(*m),
            Expr::Reading(n) => env(n).and_then(ok),
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
            Expr::Num(_) | Expr::Reading(_) => 1,
            Expr::Neg(a) => 1 + a.nodes(),
            Expr::Add(a, b) | Expr::Sub(a, b) | Expr::Mul(a, b) | Expr::Div(a, b) | Expr::Min(a, b) | Expr::Max(a, b) => {
                1 + a.nodes() + b.nodes()
            }
        }
    }

    /// The readings it names, each once, in the order it names them.
    pub fn readings(&self, out: &mut Vec<String>) {
        match self {
            Expr::Num(_) => {}
            Expr::Reading(n) => {
                if !out.contains(n) {
                    out.push(n.clone());
                }
            }
            Expr::Neg(a) => a.readings(out),
            Expr::Add(a, b) | Expr::Sub(a, b) | Expr::Mul(a, b) | Expr::Div(a, b) | Expr::Min(a, b) | Expr::Max(a, b) => {
                a.readings(out);
                b.readings(out);
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
    /// This metric against readings `rs` (`Metric.check`).
    pub fn check(&self, rs: &Readings) -> Checked {
        let g = &self.goal;
        let value = g.measured().eval(&|n| newest(rs, n));
        let baseline = g.measured().eval(&|n| first(rs, n));
        let targets: Vec<Option<Dec>> = g.targets().iter().map(|t| t.eval(&|n| newest(rs, n))).collect();
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

pub fn check(metrics: &[Metric], rs: &Readings) -> Summary {
    let results: Vec<Checked> = metrics.iter().map(|m| m.check(rs)).collect();
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

/// The objective as JSON, for the pages and the agents: each metric `{id, name, note, goal, readings, value,
/// baseline, targets, met, progress}`, numbers as people read them and progress from 0 to 1, then how many are met,
/// of how many, and the mean progress.
pub fn summary_json(metrics: &[Metric], rs: &Readings) -> Value {
    let s = check(metrics, rs);
    let fraction = |p: Dec| number(p);
    let opt = |d: Option<Dec>| d.map_or(Value::Null, number);
    let items: Vec<Value> = metrics
        .iter()
        .zip(&s.results)
        .map(|(m, r)| {
            let mut names = vec![];
            m.goal.measured().readings(&mut names);
            for t in m.goal.targets() {
                t.readings(&mut names);
            }
            json!({
                "id": m.id,
                "name": m.name,
                "note": m.note,
                "goal": m.goal.kind(),
                "readings": names,
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
const RESERVED: [&str; 18] = [
    "def", "import", "open", "namespace", "end", "metric", "reading", "min", "max", "atLeast", "atMost", "between",
    "equals", "Metric", "Expr", "List", "theorem", "where",
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

    /// `reading "x"`, `min a b`, `max a b`, or an argument.
    fn app(&mut self, depth: usize) -> Result<Expr, Error> {
        match self.peek() {
            Some(Tok::Ident(w)) if w == "reading" => {
                self.at += 1;
                let n = self.string()?;
                if n.is_empty() {
                    return self.fail("a reading needs a name");
                }
                Ok(Expr::Reading(n))
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

/// The metrics of an objective file, in their order: `Error` with where and why for anything else.
pub fn parse(src: &str) -> Result<Vec<Metric>, Error> {
    if src.len() > MAX_LEN {
        return err(1, 1, format!("an objective of at most {MAX_LEN} bytes"));
    }
    let toks = lex(src)?;
    let end = toks.last().map_or((1, 1), |t| (t.line, t.col));
    let mut p = Parser { toks, at: 0, exprs: HashMap::new(), end };
    let mut metrics: Vec<Metric> = vec![];
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
                        return p.fail(format!("a def here is a Metric, an Expr or `objective`, never a {ty}"));
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
    Ok(metrics)
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
