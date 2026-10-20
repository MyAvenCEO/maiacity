//! `sec zeroize-apis`: a source-text scan of .rs files for the Rust APIs that bypass zeroization (mem::forget,
//! Box::leak, ptr::write_bytes, ...) and for async fns that keep a secret-named local across an .await. Needs no
//! compilation. Port of find_dangerous_apis.py.
//!
//!   sec zeroize-apis --src <source_dir> --out <findings.json>
//! exit 0 ran (findings may be empty), 1 source directory not found, 2 argument error

use super::{fancy_hit, finding, write_findings};
use crate::util::{Args, pad4, py_path, read_text, req, rglob, splitlines};
use fancy_regex::Regex as Fancy;
use regex::Regex;
use serde_json::Value;
use std::path::Path;

// PascalCase type names use \b; lowercase keywords use letter lookarounds so snake_case names like secret_key match
// and words like monkey or tokenize don't.
const SENSITIVE_NAME: &str = r"(?i)(?:\b(Key|PrivateKey|SecretKey|SigningKey|MasterKey|HmacKey|Password|Passphrase|Pin|Token|AuthToken|BearerToken|ApiKey|Secret|SharedSecret|PreSharedKey|Nonce|Seed|Entropy|Credential|SessionKey|DerivedKey)\b|(?<![a-zA-Z])(key|secret|password|token|nonce|seed|private|master|credential)(?![a-zA-Z]))";

// regex, category, severity, detail
const PATTERNS: &[(&str, &str, &str, &str)] = &[
    (r"\bmem::forget\s*\(", "MISSING_SOURCE_ZEROIZE", "critical", "mem::forget() prevents Drop/ZeroizeOnDrop from running — secret never wiped"),
    (r"\bManuallyDrop\s*::\s*new\s*\(", "MISSING_SOURCE_ZEROIZE", "critical", "ManuallyDrop::new() suppresses automatic drop — secret not wiped unless drop() called explicitly"),
    (r"\bBox\s*::\s*leak\s*\(", "MISSING_SOURCE_ZEROIZE", "critical", "Box::leak() — leaked allocation is never dropped or zeroed"),
    (r"\bBox\s*::\s*into_raw\s*\(", "MISSING_SOURCE_ZEROIZE", "high", "Box::into_raw() — raw pointer escapes Drop; must call Box::from_raw() + zeroize to reclaim"),
    (r"\bptr\s*::\s*write_bytes\s*\(", "OPTIMIZED_AWAY_ZEROIZE", "high", "ptr::write_bytes() is non-volatile — LLVM may eliminate as dead store. Use zeroize crate or add compiler_fence(SeqCst) after"),
    // turbofish (transmute::<T, U>(v)) and inferred (transmute(v)) both
    (r"\bmem\s*::\s*transmute\b", "SECRET_COPY", "high", "mem::transmute creates a bitwise copy — original and transmuted value both exist on stack"),
    (r"\bslice\s*::\s*from_raw_parts\s*\(", "SECRET_COPY", "medium", "slice::from_raw_parts creates a slice alias over raw memory — may alias a secret buffer"),
    (r"\bmem\s*::\s*take\s*\(", "MISSING_SOURCE_ZEROIZE", "medium", "mem::take() replaces the value in-place without zeroing the original location"),
    (r"\bmem\s*::\s*uninitialized\s*\(", "MISSING_SOURCE_ZEROIZE", "critical", "mem::uninitialized() is deprecated and unsafe — may expose prior secret bytes from stack memory"),
];

struct Scan {
    sensitive: Fancy,
    counter: usize,
    findings: Vec<Value>,
}

impl Scan {
    fn add(&mut self, category: &str, severity: &str, detail: &str, file: &str, line: usize, confidence: &str) {
        self.counter += 1;
        self.findings.push(finding(format!("F-RUST-SRC-{}", pad4(self.counter)), category, severity, confidence, detail, "", file, line, "source_grep"));
    }

    /// a sensitive name within `window` lines of the 0-based index `center`
    fn sensitive_context(&self, lines: &[&str], center: usize) -> bool {
        let start = center.saturating_sub(15);
        let end = (center + 15 + 1).min(lines.len());
        fancy_hit(&self.sensitive, &lines[start..end].join("\n"))
    }

    fn patterns(&mut self, file: &str, lines: &[&str]) {
        for (re, category, severity, detail) in PATTERNS {
            let re = Regex::new(re).unwrap();
            // reset per pattern pass
            let mut in_block = false;
            for (i, line) in lines.iter().enumerate() {
                let skip;
                (skip, in_block) = commented_out(line, in_block);
                if skip || !re.is_match(line) {
                    continue;
                }
                let confidence = if self.sensitive_context(lines, i) { "likely" } else { "needs_review" };
                self.add(category, severity, detail, file, i + 1, confidence);
            }
        }
    }

    /// an async fn body where a secret-named local is bound before an .await: NOT_ON_ALL_PATHS (high)
    fn async_suspension(&mut self, file: &str, lines: &[&str]) {
        let async_fn = Regex::new(r"\basync\s+fn\s+\w+").unwrap();
        let let_binding = Regex::new(r"\blet\s+(?:mut\s+)?(\w+)\s*[=:]").unwrap();
        let await_re = Regex::new(r"\.await\b").unwrap();
        let mut i = 0;
        while i < lines.len() {
            if !async_fn.is_match(lines[i]) {
                i += 1;
                continue;
            }
            let mut body: Vec<(usize, &str)> = Vec::new();
            let (mut depth, mut in_body, mut closed) = (0i64, false, false);
            for j in i..(i + 500).min(lines.len()) {
                // braces counted outside string literals and line comments
                let t: Vec<char> = lines[j].chars().collect();
                let (mut in_str, mut k) = (false, 0);
                while k < t.len() {
                    let ch = t[k];
                    if in_str {
                        if ch == '\\' && k + 1 < t.len() {
                            k += 2;
                            continue;
                        } else if ch == '"' {
                            in_str = false;
                        }
                    } else if ch == '"' {
                        in_str = true;
                    } else if ch == '/' && t.get(k + 1) == Some(&'/') {
                        break;
                    } else if ch == '{' {
                        depth += 1;
                        in_body = true;
                    } else if ch == '}' {
                        depth -= 1;
                    }
                    k += 1;
                }
                if in_body {
                    body.push((j + 1, lines[j]));
                }
                if in_body && depth == 0 {
                    i = j + 1;
                    closed = true;
                    break;
                }
            }
            if !closed {
                i += 1;
                continue;
            }
            let secrets: Vec<(usize, String)> = body
                .iter()
                .filter_map(|(n, line)| let_binding.captures(line).map(|m| (*n, m[1].to_string())))
                .filter(|(_, name)| fancy_hit(&self.sensitive, name))
                .collect();
            for (bind_line, name) in secrets {
                // one finding per binding is enough
                if body.iter().any(|(n, line)| *n > bind_line && await_re.is_match(line)) {
                    let detail = format!("Secret local '{name}' is live across an .await suspension point in an async fn — stored in the heap-allocated Future state machine; ZeroizeOnDrop covers stack variables only");
                    self.add("NOT_ON_ALL_PATHS", "high", &detail, file, bind_line, "likely");
                }
            }
        }
    }
}

/// (skip this line, inside a block comment after it); a line that only opens a comment mid-way is still scanned
fn commented_out(line: &str, in_block: bool) -> (bool, bool) {
    let stripped = line.trim();
    if in_block {
        return if line.contains("*/") { (true, false) } else { (true, true) };
    }
    if stripped.starts_with("//") {
        return (true, false);
    }
    if stripped.starts_with("/*") {
        return if line.contains("*/") { (true, false) } else { (true, true) };
    }
    if stripped.contains("/*") && !stripped.contains("*/") {
        return (false, true);
    }
    (false, false)
}

pub fn main(argv: &[String]) -> i32 {
    let a = Args::parse("sec zeroize-apis", argv, &[req("src"), req("out")], 0);
    let src = py_path(a.str("src"));
    if !Path::new(&src).is_dir() {
        eprintln!("find_dangerous_apis.py: source directory not found: {src}");
        return 1;
    }
    let mut scan = Scan { sensitive: Fancy::new(SENSITIVE_NAME).unwrap(), counter: 0, findings: Vec::new() };
    for file in rglob(Path::new(&src), ".rs") {
        let name = py_path(&file.display().to_string());
        let source = match read_text(&file) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("find_dangerous_apis.py: warning: cannot read {name}: {e}");
                continue;
            }
        };
        let lines = splitlines(&source);
        scan.patterns(&name, &lines);
        scan.async_suspension(&name, &lines);
    }
    let out = py_path(a.str("out"));
    if let Err(e) = write_findings(&out, &scan.findings) {
        eprintln!("find_dangerous_apis.py: cannot write {out}: {e}");
        return 1;
    }
    println!("find_dangerous_apis.py: {} finding(s) written to {out}", scan.findings.len());
    0
}
