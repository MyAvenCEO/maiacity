//! What every tool shares: Python's line splitting and repr(), a small argparse, JSON written as `json.dumps(indent=2)`
//! wrote it, and the file helpers the Python tools used, so each port reads and writes exactly as its original did.

use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// `str.splitlines()`: every line break Python knows, no trailing empty line.
pub fn splitlines(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        let brk = matches!(c, '\n' | '\r' | '\x0b' | '\x0c' | '\x1c' | '\x1d' | '\x1e' | '\u{85}' | '\u{2028}' | '\u{2029}');
        if brk {
            out.push(&text[start..i]);
            let mut next = i + c.len_utf8();
            if c == '\r' {
                if let Some(&(j, '\n')) = chars.peek() {
                    chars.next();
                    next = j + 1;
                }
            }
            start = next;
        }
    }
    if start < text.len() {
        out.push(&text[start..]);
    }
    out
}

/// Python's `repr()` of a str: the quote it picks and its escapes.
pub fn py_repr(s: &str) -> String {
    let q = if s.contains('\'') && !s.contains('"') { '"' } else { '\'' };
    let mut out = String::new();
    out.push(q);
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c == q => {
                out.push('\\');
                out.push(c);
            }
            c if (c as u32) < 0x20 || c as u32 == 0x7f => out.push_str(&format!("\\x{:02x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push(q);
    out
}

/// Python's repr() of a list of str.
pub fn py_repr_list<S: AsRef<str>>(items: &[S]) -> String {
    format!("[{}]", items.iter().map(|s| py_repr(s.as_ref())).collect::<Vec<_>>().join(", "))
}

/// `re.escape()`: the characters a pattern treats as syntax, escaped.
pub fn re_escape(s: &str) -> String {
    regex::escape(s)
}

/// `Path.read_text(encoding="utf-8", errors="replace")`: invalid UTF-8 replaced and every line ending read as `\n`
/// (universal newlines).
pub fn read_text(path: &Path) -> std::io::Result<String> {
    let text = String::from_utf8_lossy(&fs::read(path)?).into_owned();
    Ok(if text.contains('\r') { text.replace("\r\n", "\n").replace('\r', "\n") } else { text })
}

/// `str(Path(s))`: repeated slashes and `.` parts folded, no trailing slash, `.` for nothing.
pub fn py_path(s: &str) -> String {
    let root = if s.starts_with("//") && !s.starts_with("///") { "//" } else if s.starts_with('/') { "/" } else { "" };
    let parts: Vec<&str> = s.split('/').filter(|p| !p.is_empty() && *p != ".").collect();
    let out = format!("{root}{}", parts.join("/"));
    if out.is_empty() { ".".into() } else { out }
}

/// `str.splitlines(keepends=True)`.
pub fn splitlines_keepends(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if matches!(c, '\n' | '\r' | '\x0b' | '\x0c' | '\x1c' | '\x1d' | '\x1e' | '\u{85}' | '\u{2028}' | '\u{2029}') {
            let mut next = i + c.len_utf8();
            if c == '\r' {
                if let Some(&(j, '\n')) = chars.peek() {
                    chars.next();
                    next = j + 1;
                }
            }
            out.push(&text[start..next]);
            start = next;
        }
    }
    if start < text.len() {
        out.push(&text[start..]);
    }
    out
}

/// JSON written as `json.dumps(value, indent=2)` wrote it, its folder made first.
pub fn write_json(path: &Path, value: &Value) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    fs::write(path, pretty(value))
}

pub fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).expect("JSON")
}

/// `Path.rglob("*<ext>")`, sorted as Python sorts paths (by their parts).
pub fn rglob(dir: &Path, ext: &str) -> Vec<PathBuf> {
    fn walk(d: &Path, ext: &str, out: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(d) else { return };
        for e in entries.flatten() {
            let p = e.path();
            let Ok(t) = e.file_type() else { continue };
            if t.is_dir() {
                walk(&p, ext, out);
            } else if p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(ext)) {
                out.push(p);
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, ext, &mut out);
    out.sort_by(|a, b| a.components().cmp(b.components()));
    out
}

/// Python's `"%04d" % n`.
pub fn pad4(n: usize) -> String {
    format!("{n:04}")
}

/// One option of a command: a value, a repeatable value, a value list (`nargs="+"`) or a switch.
#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Value,
    Many,
    List,
    Switch,
}

pub struct Opt {
    pub name: &'static str,
    pub kind: Kind,
    pub required: bool,
    pub default: Option<&'static str>,
}

pub const fn opt(name: &'static str) -> Opt {
    Opt { name, kind: Kind::Value, required: false, default: None }
}
pub const fn req(name: &'static str) -> Opt {
    Opt { name, kind: Kind::Value, required: true, default: None }
}
pub const fn def(name: &'static str, default: &'static str) -> Opt {
    Opt { name, kind: Kind::Value, required: false, default: Some(default) }
}
pub const fn switch(name: &'static str) -> Opt {
    Opt { name, kind: Kind::Switch, required: false, default: None }
}
pub const fn many(name: &'static str) -> Opt {
    Opt { name, kind: Kind::Many, required: false, default: None }
}
pub const fn list(name: &'static str) -> Opt {
    Opt { name, kind: Kind::List, required: false, default: None }
}

/// The parsed command line: options by name (without `--`), switches, and positionals.
pub struct Args {
    values: HashMap<String, Vec<String>>,
    switches: HashMap<String, bool>,
    pub positional: Vec<String>,
}

impl Args {
    /// argparse, the part we use: an unknown option or a missing required one prints usage and exits 2.
    pub fn parse(prog: &str, argv: &[String], spec: &[Opt], positionals: usize) -> Args {
        let mut a = Args { values: HashMap::new(), switches: HashMap::new(), positional: Vec::new() };
        let usage = |msg: &str| -> ! {
            let names: Vec<String> = spec.iter().map(|o| format!("--{}", o.name)).collect();
            eprintln!("usage: {prog} {}\n{prog}: error: {msg}", names.join(" "));
            std::process::exit(2);
        };
        // as argparse, -h or --help anywhere prints the usage and stops
        if argv.iter().any(|x| x == "-h" || x == "--help") {
            let names: Vec<String> = spec.iter().map(|o| format!("--{}", o.name)).collect();
            println!("usage: {prog} {}", names.join(" "));
            std::process::exit(0);
        }
        let mut i = 0;
        while i < argv.len() {
            let x = &argv[i];
            if let Some(body) = x.strip_prefix("--").filter(|b| !b.is_empty()) {
                let (name, inline) = match body.split_once('=') {
                    Some((n, v)) => (n, Some(v.to_string())),
                    None => (body, None),
                };
                let Some(o) = spec.iter().find(|o| o.name == name) else { usage(&format!("unrecognized arguments: {x}")) };
                match o.kind {
                    Kind::Switch => {
                        a.switches.insert(name.into(), true);
                    }
                    Kind::List => {
                        let mut vals: Vec<String> = inline.into_iter().collect();
                        while i + 1 < argv.len() && !argv[i + 1].starts_with("--") {
                            i += 1;
                            vals.push(argv[i].clone());
                        }
                        if vals.is_empty() {
                            usage(&format!("argument --{name}: expected at least one argument"));
                        }
                        a.values.entry(name.into()).or_default().extend(vals);
                    }
                    Kind::Value | Kind::Many => {
                        let v = match inline {
                            Some(v) => v,
                            None => {
                                i += 1;
                                match argv.get(i) {
                                    Some(v) => v.clone(),
                                    None => usage(&format!("argument --{name}: expected one argument")),
                                }
                            }
                        };
                        let e = a.values.entry(name.into()).or_default();
                        if o.kind == Kind::Value {
                            e.clear();
                        }
                        e.push(v);
                    }
                }
            } else {
                a.positional.push(x.clone());
            }
            i += 1;
        }
        for o in spec {
            if o.required && !a.values.contains_key(o.name) {
                usage(&format!("the following arguments are required: --{}", o.name));
            }
            if let (Some(d), false) = (o.default, a.values.contains_key(o.name)) {
                a.values.insert(o.name.into(), vec![d.into()]);
            }
        }
        if a.positional.len() < positionals {
            usage("the following arguments are required: positional argument(s)");
        }
        if a.positional.len() > positionals {
            usage(&format!("unrecognized arguments: {}", a.positional[positionals..].join(" ")));
        }
        a
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.values.get(name).and_then(|v| v.last()).map(String::as_str)
    }
    pub fn str(&self, name: &str) -> &str {
        self.get(name).unwrap_or("")
    }
    pub fn all(&self, name: &str) -> Vec<String> {
        self.values.get(name).cloned().unwrap_or_default()
    }
    pub fn has(&self, name: &str) -> bool {
        self.values.contains_key(name)
    }
    pub fn on(&self, name: &str) -> bool {
        self.switches.get(name).copied().unwrap_or(false)
    }
    pub fn path(&self, name: &str) -> PathBuf {
        PathBuf::from(self.str(name))
    }
}

/// A `serde_json` object from key/value pairs, in order.
#[macro_export]
macro_rules! obj {
    ($($k:expr => $v:expr),* $(,)?) => {{
        let mut m = serde_json::Map::new();
        $( m.insert(($k).to_string(), serde_json::Value::from($v)); )*
        serde_json::Value::Object(m)
    }};
}

/// Python truthiness of a JSON value.
pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
        Some(Value::Number(n)) => n.as_f64() != Some(0.0),
    }
}

/// Python's `str()` of a JSON value as the Python tools held it (True/False/None, lists as their repr).
pub fn py_str(v: &Value) -> String {
    match v {
        Value::Null => "None".into(),
        Value::Bool(b) => if *b { "True" } else { "False" }.into(),
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Array(a) => format!("[{}]", a.iter().map(py_repr_value).collect::<Vec<_>>().join(", ")),
        Value::Object(o) => format!("{{{}}}", o.iter().map(|(k, v)| format!("{}: {}", py_repr(k), py_repr_value(v))).collect::<Vec<_>>().join(", ")),
    }
}

pub fn py_repr_value(v: &Value) -> String {
    match v {
        Value::String(s) => py_repr(s),
        other => py_str(other),
    }
}
