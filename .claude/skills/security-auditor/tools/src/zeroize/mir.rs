//! `sec zeroize-mir`: MIR text patterns of missing or incorrect zeroization. Reads a MIR file (from
//! `sec zeroize-emit-mir`) and the sensitive-objects JSON; regex based, no MIR parser. Port of check_mir_patterns.py.
//!
//!   sec zeroize-mir --mir <path.mir> --secrets <sensitive-objects.json> --out <findings.json>
//! exit 0 ran (findings may be empty), 1 input file not found, 2 argument error

use super::{fancy_hit, finding, write_findings};
use crate::util::{Args, pad4, py_path, py_repr, py_repr_list, py_str, re_escape, read_text, req, splitlines, truthy};
use fancy_regex::Regex as Fancy;
use indexmap::{IndexMap, IndexSet};
use regex::Regex;
use serde_json::Value;
use std::path::Path;

// a keyword not touching another letter, so secret_key, private_key and auth_token match and monkey or tokenize don't
const SENSITIVE_LOCAL: &str = r"(?i)(?<![a-zA-Z])(key|secret|password|token|nonce|seed|priv|master|credential)(?![a-zA-Z])";

struct Fn<'a> {
    name: String,
    lines: Vec<&'a str>,
    start: usize,
}

/// MIR split into functions at each top-level `fn <name>(`; what precedes the first is `<top>`.
fn split_into_functions(text: &str) -> Vec<Fn<'_>> {
    let fn_re = Regex::new(r"^fn\s+(\S+)\s*\(").unwrap();
    let mut out = Vec::new();
    let mut cur = Fn { name: "<top>".into(), lines: Vec::new(), start: 0 };
    let mut depth: i64 = 0;
    for (i, line) in splitlines(text).into_iter().enumerate() {
        let lineno = i + 1;
        let opens = line.matches('{').count() as i64 - line.matches('}').count() as i64;
        match fn_re.captures(line.trim()).filter(|_| depth == 0) {
            Some(m) => {
                let next = Fn { name: m[1].to_string(), lines: vec![line], start: lineno };
                let done = std::mem::replace(&mut cur, next);
                if !done.lines.is_empty() {
                    out.push(done);
                }
                depth = opens;
            }
            None => {
                cur.lines.push(line);
                depth += opens;
                if depth < 0 {
                    eprintln!("check_mir_patterns.py: warning: negative brace depth at line {lineno} in {} — MIR may be malformed", py_repr(&cur.name));
                    depth = 0;
                }
            }
        }
    }
    if !cur.lines.is_empty() {
        out.push(cur);
    }
    out
}

struct Ctx<'a> {
    f: &'a Fn<'a>,
    /// local slot → its debug name, in the order the slots were first named
    debug: IndexMap<String, String>,
    file: &'a str,
    sensitive: &'a Fancy,
}

impl Ctx<'_> {
    fn is_sensitive(&self, slot: &str) -> bool {
        fancy_hit(self.sensitive, self.debug.get(slot).map(String::as_str).unwrap_or(""))
    }
    fn name_of(&self, slot: &str) -> String {
        self.debug.get(slot).cloned().unwrap_or_else(|| slot.to_string())
    }
    fn any_line(&self, re: &str) -> bool {
        let re = Regex::new(re).unwrap();
        self.f.lines.iter().any(|l| re.is_match(l))
    }
    /// the first three sensitive locals' names, as Python lists them
    fn sensitive_names(&self) -> Vec<String> {
        self.debug.keys().filter(|s| self.is_sensitive(s)).take(3).map(|s| self.debug[s].clone()).collect()
    }
}

struct Out {
    counter: usize,
    findings: Vec<Value>,
}

impl Out {
    fn add(&mut self, category: &str, severity: &str, detail: &str, file: &str, line: usize, symbol: &str) {
        self.counter += 1;
        self.findings.push(finding(format!("F-RUST-MIR-{}", pad4(self.counter)), category, severity, "likely", detail, symbol, file, line, "mir_text"));
    }
}

/// drop(_X) with no StorageDead(_X) for a sensitive local: it may stay on the stack after the drop
fn drop_before_storagedead(c: &Ctx, o: &mut Out) {
    let drop_re = Regex::new(r"\bdrop\(_(\d+)\)").unwrap();
    let dead_re = Regex::new(r"StorageDead\(_(\d+)\)").unwrap();
    let (mut dropped, mut dead) = (IndexSet::new(), IndexSet::new());
    for line in &c.f.lines {
        dropped.extend(drop_re.captures_iter(line).map(|m| format!("_{}", &m[1])));
        dead.extend(dead_re.captures_iter(line).map(|m| format!("_{}", &m[1])));
    }
    let has_return = c.any_line(r"\breturn\b");
    for slot in dropped.iter().filter(|s| !dead.contains(*s)) {
        if !c.is_sensitive(slot) {
            continue;
        }
        let shown = py_repr(c.debug.get(slot).map(String::as_str).unwrap_or("?"));
        let fname = &c.f.name;
        // path-sensitive NOT_ON_ALL_PATHS rather than both it and the generic finding for the same slot
        if has_return {
            o.add("NOT_ON_ALL_PATHS", "high", &format!("Secret local {slot} ({shown}) is dropped but not StorageDead on explicit return path(s) in '{fname}'"), c.file, c.f.start, &c.name_of(slot));
        } else {
            o.add("MISSING_SOURCE_ZEROIZE", "medium", &format!("Secret local {slot} ({shown}) is dropped without StorageDead in '{fname}' — verify zeroize call in drop glue"), c.file, c.f.start, &c.name_of(slot));
        }
    }
}

/// a `resume` (unwind/panic path) with sensitive locals in scope
fn resume_with_live_secrets(c: &Ctx, o: &mut Out) {
    if !c.any_line(r"\bresume\b") {
        return;
    }
    let names = c.sensitive_names();
    if let Some(first) = names.first() {
        let detail = format!("Panic/unwind path (resume) in '{}' with sensitive locals {} in scope — verify these locals are dropped (and zeroed) on the unwind path", c.f.name, py_repr_list(&names));
        o.add("MISSING_SOURCE_ZEROIZE", "medium", &detail, c.file, c.f.start, first);
    }
}

/// `_Y = TypeName { field: move _X }` with _X sensitive and TypeName not a Zeroizing wrapper
fn aggregate_move_non_zeroizing(c: &Ctx, o: &mut Out) {
    let agg = Regex::new(r"(_\d+)\s*=\s*(\w[\w:]*)\s*\{[^}]*move\s+(_\d+)").unwrap();
    let zeroizing = Regex::new(r"(?i)(Zeroiz|ZeroizeOnDrop|SecretBox|Zeroizing)").unwrap();
    for (i, line) in c.f.lines.iter().enumerate() {
        let Some(m) = agg.captures(line) else { continue };
        let (type_name, src) = (&m[2], &m[3]);
        if c.is_sensitive(src) && !zeroizing.is_match(type_name) {
            let name = c.name_of(src);
            o.add("SECRET_COPY", "medium", &format!("Secret local '{name}' moved into non-Zeroizing aggregate '{type_name}' in '{}' — copy now untracked", c.f.name), c.file, c.f.start + i, &name);
        }
    }
}

/// a closure or async state capturing a sensitive local by move
fn closure_capture_secret(c: &Ctx, o: &mut Out) {
    let closure = Regex::new(r"(?i)(_\d+)\s*=\s*.*(?:closure|async|generator|Coroutine).*move\s+(_\d+)").unwrap();
    for (i, line) in c.f.lines.iter().enumerate() {
        let Some(m) = closure.captures(line) else { continue };
        if c.is_sensitive(&m[2]) {
            let name = c.name_of(&m[2]);
            o.add("SECRET_COPY", "high", &format!("Sensitive local '{name}' is captured by move into a closure/async state in '{}' — copy may outlive intended wipe scope", c.f.name), c.file, c.f.start + i, &name);
        }
    }
}

/// drop glue (drop_in_place / _drop_impl) that drops but never calls zeroize::
fn drop_glue_without_zeroize(c: &Ctx, o: &mut Out) {
    if !Regex::new(r"(drop_in_place|_drop_impl)").unwrap().is_match(&c.f.name) {
        return;
    }
    if c.any_line(r"\bdrop\(_\d+\)") && !c.any_line(r"\bzeroize::") {
        o.add("MISSING_SOURCE_ZEROIZE", "high", &format!("Drop glue '{}' calls drop() but no call to zeroize:: found — secret not wiped on drop", c.f.name), c.file, c.f.start, &c.f.name);
    }
}

/// a sensitive local passed to a call whose path looks like FFI (::c_, _ffi_, _sys_, extern)
fn ffi_call_with_secret(c: &Ctx, o: &mut Out) {
    let call = Regex::new(r"\bcall\s+(\S+)\s*\(([^)]*)\)").unwrap();
    let slot_re = Regex::new(r"_(\d+)").unwrap();
    let ffi = Regex::new(r"(?i)(::c_|_ffi_|_sys_|extern)").unwrap();
    for (i, line) in c.f.lines.iter().enumerate() {
        let Some(m) = call.captures(line) else { continue };
        let callee = &m[1];
        for s in slot_re.captures_iter(&m[2]) {
            let slot = format!("_{}", &s[1]);
            if !c.is_sensitive(&slot) || callee.to_lowercase().contains("zeroize") || !ffi.is_match(callee) {
                continue;
            }
            let name = c.name_of(&slot);
            o.add("SECRET_COPY", "high", &format!("Secret local '{name}' passed to potential FFI call '{callee}' in '{}' — zeroization guarantees lost in callee", c.f.name), c.file, c.f.start + i, &name);
        }
    }
}

/// a Yield (async/coroutine state machine) with sensitive locals that may be live across it
fn yield_with_live_secret(c: &Ctx, o: &mut Out) {
    if !c.any_line(r"\byield\b") {
        return;
    }
    let names = c.sensitive_names();
    if let Some(first) = names.first() {
        let detail = format!("Coroutine/async fn '{}' has Yield terminator with sensitive locals {} potentially live at suspension point — secrets stored in heap-allocated Future state machine; ZeroizeOnDrop covers stack variables only", c.f.name, py_repr_list(&names));
        o.add("NOT_ON_ALL_PATHS", "high", &detail, c.file, c.f.start, first);
    }
}

/// an `Err(...)` path while sensitive locals are still in scope
fn result_err_path_with_secret(c: &Ctx, o: &mut Out) {
    if !c.any_line(r"\bErr\s*\(") {
        return;
    }
    let names = c.sensitive_names();
    if let Some(first) = names.first() {
        let detail = format!("Potential Result::Err early-return path in '{}' with sensitive locals {} still in scope — verify cleanup on all error exits", c.f.name, py_repr_list(&names));
        o.add("NOT_ON_ALL_PATHS", "high", &detail, c.file, c.f.start, first);
    }
}

fn analyze(text: &str, objects: &[Value], file: &str) -> Vec<Value> {
    let extra: Vec<String> = objects.iter().filter_map(|o| o.get("name")).filter(|n| truthy(Some(n))).map(py_str).collect();
    // each sensitive object's name joins the keyword pattern, as a whole word
    let pattern = if extra.is_empty() { SENSITIVE_LOCAL.to_string() } else { format!("{SENSITIVE_LOCAL}|{}", extra.iter().map(|n| format!(r"\b{}\b", re_escape(n))).collect::<Vec<_>>().join("|")) };
    let sensitive = Fancy::new(&pattern).unwrap();
    let debug_re = Regex::new(r"debug\s+(\w+)\s*=>\s*(_\d+)").unwrap();
    let mut o = Out { counter: 0, findings: Vec::new() };
    let functions = split_into_functions(text);
    for f in &functions {
        let mut debug = IndexMap::new();
        for line in &f.lines {
            if let Some(m) = debug_re.captures(line) {
                debug.insert(m[2].to_string(), m[1].to_string());
            }
        }
        let c = Ctx { f, debug, file, sensitive: &sensitive };
        drop_before_storagedead(&c, &mut o);
        resume_with_live_secrets(&c, &mut o);
        aggregate_move_non_zeroizing(&c, &mut o);
        closure_capture_secret(&c, &mut o);
        drop_glue_without_zeroize(&c, &mut o);
        ffi_call_with_secret(&c, &mut o);
        yield_with_live_secret(&c, &mut o);
        result_err_path_with_secret(&c, &mut o);
    }
    o.findings
}

pub fn main(argv: &[String]) -> i32 {
    let a = Args::parse("sec zeroize-mir", argv, &[req("mir"), req("secrets"), req("out")], 0);
    let (mir, secrets) = (py_path(a.str("mir")), py_path(a.str("secrets")));
    if !Path::new(&mir).exists() {
        eprintln!("check_mir_patterns.py: MIR file not found: {mir}");
        return 1;
    }
    if !Path::new(&secrets).exists() {
        eprintln!("check_mir_patterns.py: secrets file not found: {secrets}");
        return 1;
    }
    let text = match read_text(Path::new(&mir)) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("check_mir_patterns.py: failed to read MIR: {e}");
            return 1;
        }
    };
    let objects = match read_text(Path::new(&secrets)).map_err(|e| e.to_string()).and_then(|t| serde_json::from_str::<Value>(&t).map_err(|e| e.to_string())) {
        Ok(Value::Array(v)) => v,
        Ok(_) => {
            eprintln!("check_mir_patterns.py: failed to parse secrets JSON: expected a list of sensitive objects");
            return 1;
        }
        Err(e) => {
            eprintln!("check_mir_patterns.py: failed to parse secrets JSON: {e}");
            return 1;
        }
    };
    let findings = analyze(&text, &objects, &mir);
    let out = py_path(a.str("out"));
    if let Err(e) = write_findings(&out, &findings) {
        eprintln!("check_mir_patterns.py: cannot write {out}: {e}");
        return 1;
    }
    println!("check_mir_patterns.py: {} finding(s) written to {out}", findings.len());
    0
}
