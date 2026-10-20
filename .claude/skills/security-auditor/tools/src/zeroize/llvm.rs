//! `sec zeroize-llvm`: LLVM IR compared across optimization levels for wipes that dead-store elimination removed,
//! stack slots freed unwiped, and secrets left in argument or return registers. Port of check_llvm_patterns.py.
//!
//!   sec zeroize-llvm --o0 <file.O0.ll> --o2 <file.O2.ll> [--o1 <file.O1.ll>] [--o3 <file.O3.ll>] --out <findings.json>
//! exit 0 ran (findings may be empty), 1 input file not found, 2 argument error

use super::{finding, write_findings};
use crate::util::{Args, opt, pad4, py_path, read_text, req, splitlines};
use indexmap::{IndexMap, IndexSet};
use regex::Regex;
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::path::Path;

/// alloca sizes in bytes that match common key sizes
const SECRET_ALLOCA_SIZES: [u64; 7] = [16, 24, 32, 48, 64, 96, 128];
const SECRET_WORDS: &str = "key|secret|password|token|nonce|seed|priv|master|credential";

struct Out {
    counter: usize,
    findings: Vec<Value>,
}

impl Out {
    fn add(&mut self, category: &str, severity: &str, detail: &str, file: &str, line: usize, symbol: &str) {
        self.counter += 1;
        self.findings.push(finding(format!("F-RUST-IR-{}", pad4(self.counter)), category, severity, "likely", detail, symbol, file, line, "llvm_ir"));
    }
}

fn count_volatile_stores(ir: &str) -> usize {
    Regex::new(r"\bstore volatile\b").unwrap().find_iter(ir).count()
}

/// volatile stores counted by their destination: `store volatile i8 0, ptr %key`
fn volatile_stores_by_target(ir: &str) -> BTreeMap<String, usize> {
    let re = Regex::new(r"\bstore volatile\b[^,]*,\s*(?:ptr|i\d+\*)\s+%([\w\.\-]+)").unwrap();
    let mut out = BTreeMap::new();
    for m in re.captures_iter(ir) {
        *out.entry(m[1].to_string()).or_insert(0) += 1;
    }
    out
}

/// `%name = alloca [N x i8]`: name → N, in the order first seen
fn allocas(ir: &str) -> IndexMap<String, u64> {
    let re = Regex::new(r"%(\w+)\s*=\s*alloca\s+\[(\d+)\s*x\s*i8\]").unwrap();
    let mut out = IndexMap::new();
    for m in re.captures_iter(ir) {
        out.insert(m[1].to_string(), m[2].parse().unwrap_or(u64::MAX));
    }
    out
}

fn lifetime_ends(ir: &str) -> HashSet<String> {
    let re = Regex::new(r"call void @llvm\.lifetime\.end[^(]*\([^,]+,\s*(?:ptr|i8\*)\s+%(\w+)").unwrap();
    re.captures_iter(ir).map(|m| m[1].to_string()).collect()
}

/// non-volatile @llvm.memset calls (not the unordered.atomic variant, no `i1 true` volatile flag)
fn nonvolatile_memsets(ir: &str) -> Vec<(usize, String)> {
    let volatile_flag = Regex::new(r"i1\s+true").unwrap();
    splitlines(ir)
        .into_iter()
        .enumerate()
        .filter(|(_, l)| l.contains("call void @llvm.memset.") && !l.contains("unordered.atomic") && !volatile_flag.is_match(l))
        .map(|(i, l)| (i + 1, l.trim().to_string()))
        .collect()
}

fn secret_returns(ir: &str) -> Vec<(usize, String)> {
    let re = Regex::new(&format!(r"(?i)\bret\s+[^%]*%(\w*(?:{SECRET_WORDS})\w*)")).unwrap();
    splitlines(ir).into_iter().enumerate().filter_map(|(i, l)| re.captures(l).map(|m| (i + 1, m[1].to_string()))).collect()
}

/// calls that seem to pass an aggregate holding secret-named values by value (a conservative heuristic)
fn secret_aggregate_passes(ir: &str) -> Vec<(usize, String)> {
    let call = Regex::new(r"\bcall\s+\S+\s+@\w+\s*\(([^)]*)\)").unwrap();
    let secret = Regex::new(&format!(r"(?i)%\w*(?:{SECRET_WORDS})\w*")).unwrap();
    let mut out = Vec::new();
    for (i, l) in splitlines(ir).into_iter().enumerate() {
        let Some(m) = call.captures(l) else { continue };
        let args = &m[1];
        if secret.is_match(args) && (args.contains('{') || args.contains("byval")) {
            out.push((i + 1, args.chars().take(120).collect()));
        }
    }
    out
}

/// `%secret = load ...` followed by a call that takes `%secret`: (line, name, callee)
fn arg_load_calls(ir: &str) -> Vec<(usize, String, String)> {
    let load = Regex::new(r"(?i)(%\w*(?:key|secret|password|token|nonce|seed)\w*)\s*=\s*load\b").unwrap();
    let call = Regex::new(r"call\s+\S+\s+(@\w+)\s*\(([^)]*)\)").unwrap();
    let mut loaded: IndexSet<String> = IndexSet::new();
    let mut out = Vec::new();
    for (i, line) in splitlines(ir).into_iter().enumerate() {
        // loads are tracked per function, so one function's load never matches another's call
        if line.starts_with("define") && line[6..].starts_with(char::is_whitespace) {
            loaded.clear();
            continue;
        }
        if let Some(m) = load.captures(line) {
            loaded.insert(m[1].to_string());
            continue;
        }
        let Some(mc) = call.captures(line) else { continue };
        let callee = &mc[1];
        if callee.to_lowercase().contains("zeroize") || callee.to_lowercase().contains("memset") {
            continue;
        }
        for var in &loaded {
            if mc[2].contains(var.as_str()) {
                out.push((i + 1, var.trim_start_matches('%').to_string(), callee.to_string()));
            }
        }
    }
    out
}

/// `levels`: O0 and O2 always, O1 and O3 when given; each (file, text)
fn analyze(levels: &BTreeMap<&str, (String, String)>) -> Vec<Value> {
    let mut o = Out { counter: 0, findings: Vec::new() };
    let ((_, o0), (o2_file, o2)) = (&levels["O0"], &levels["O2"]);

    // 1. volatile stores dropped O0 → O2 overall; line 0 = the whole file
    let (o0_count, o2_count) = (count_volatile_stores(o0), count_volatile_stores(o2));
    if o0_count > o2_count {
        let detail = format!("Volatile store count dropped from {o0_count} (O0) to {o2_count} (O2) — {} volatile wipe(s) eliminated by dead-store elimination", o0_count - o2_count);
        o.add("OPTIMIZED_AWAY_ZEROIZE", "high", &detail, o2_file, 0, "");
    }

    // 1b. per target, the hard evidence by symbol
    let (o0_by, o2_by) = (volatile_stores_by_target(o0), volatile_stores_by_target(o2));
    for (target, n0) in &o0_by {
        let n2 = o2_by.get(target).copied().unwrap_or(0);
        if *n0 > n2 {
            o.add("OPTIMIZED_AWAY_ZEROIZE", "high", &format!("Volatile stores to %{target} dropped from {n0} (O0) to {n2} (O2) — symbol-specific wipe elimination detected"), o2_file, 0, target);
        }
    }

    // 2. non-volatile memsets at O2
    for (line, text) in nonvolatile_memsets(o2) {
        let ir: String = text.chars().take(80).collect();
        o.add("OPTIMIZED_AWAY_ZEROIZE", "high", &format!("Non-volatile @llvm.memset in O2 IR — DSE-eligible, may be removed at higher optimization. Use zeroize crate or volatile memset. IR: {ir}"), o2_file, line, "");
    }

    // 3. a key-sized alloca whose lifetime ends with no volatile store to it
    let (o2_allocas, o2_ends) = (allocas(o2), lifetime_ends(o2));
    for (name, size) in &o2_allocas {
        if SECRET_ALLOCA_SIZES.contains(size) && o2_ends.contains(name) && !o2_by.contains_key(name) {
            o.add("STACK_RETENTION", "high", &format!("alloca [{size} x i8] %{name} has @llvm.lifetime.end but no volatile store — stack bytes not wiped before slot is freed"), o2_file, 0, name);
        }
    }

    // 4. SROA/mem2reg: a wiped key-sized alloca at O0 that O2 no longer has
    for (name, size) in &allocas(o0) {
        if SECRET_ALLOCA_SIZES.contains(size) && !o2_allocas.contains_key(name) && o0_by.contains_key(name) {
            o.add("OPTIMIZED_AWAY_ZEROIZE", "high", &format!("alloca [{size} x i8] %{name} present at O0 but absent at O2 — SROA/mem2reg promoted it to registers; any volatile stores targeting this alloca are now unreachable"), o2_file, 0, name);
        }
    }

    // 5. a secret loaded into an argument register for a call
    for (line, var, callee) in arg_load_calls(o2) {
        o.add("REGISTER_SPILL", "medium", &format!("Secret-named SSA value '%{var}' loaded and passed directly to '{callee}' — value in argument register may not be cleared after call"), o2_file, line, &var);
    }

    // 6. a secret returned, left in the return registers
    for (line, var) in secret_returns(o2) {
        o.add("REGISTER_SPILL", "medium", &format!("Secret-named SSA value '%{var}' is returned directly — value may persist in return registers after function exit"), o2_file, line, &var);
    }

    // 7. secret aggregates passed by value
    for (line, snippet) in secret_aggregate_passes(o2) {
        o.add("SECRET_COPY", "medium", &format!("Potential by-value aggregate call argument contains secret-named data; copy may escape zeroization tracking. Args: {snippet}"), o2_file, line, "");
    }

    // 8. adjacent levels (O0→O1→O2, O2→O3); O0→O2 with no O1 between is 1/1b's, and a target 1b reported is not
    // reported again
    let reported: HashSet<&String> = o0_by.iter().filter(|(t, n)| **n > o2_by.get(*t).copied().unwrap_or(0)).map(|(t, _)| t).collect();
    let present: Vec<&str> = ["O0", "O1", "O2", "O3"].into_iter().filter(|l| levels.contains_key(l)).collect();
    for pair in present.windows(2) {
        let (from, to) = (pair[0], pair[1]);
        if from == "O0" && to == "O2" {
            continue;
        }
        let ((_, from_ir), (to_file, to_ir)) = (&levels[from], &levels[to]);
        let (from_by, to_by) = (volatile_stores_by_target(from_ir), volatile_stores_by_target(to_ir));
        for (target, nf) in &from_by {
            if reported.contains(target) {
                continue;
            }
            let nt = to_by.get(target).copied().unwrap_or(0);
            if *nf > nt {
                o.add("OPTIMIZED_AWAY_ZEROIZE", "high", &format!("Volatile stores to %{target} dropped from {nf} ({from}) to {nt} ({to})"), to_file, 0, target);
            }
        }
    }
    o.findings
}

pub fn main(argv: &[String]) -> i32 {
    let a = Args::parse("sec zeroize-llvm", argv, &[req("o0"), req("o2"), opt("o1"), opt("o3"), req("out")], 0);
    // checked in the original's order: O0, O2, then O1 and O3
    let mut paths: Vec<(&str, String)> = vec![("O0", py_path(a.str("o0"))), ("O2", py_path(a.str("o2")))];
    for (level, flag) in [("O1", "o1"), ("O3", "o3")] {
        if let Some(p) = a.get(flag).filter(|p| !p.is_empty()) {
            paths.push((level, py_path(p)));
        }
    }
    if let Some((_, p)) = paths.iter().find(|(_, p)| !Path::new(p).exists()) {
        eprintln!("check_llvm_patterns.py: IR file not found: {p}");
        return 1;
    }
    let mut levels = BTreeMap::new();
    for (level, p) in paths {
        match read_text(Path::new(&p)) {
            Ok(text) => {
                levels.insert(level, (p, text));
            }
            Err(e) => {
                eprintln!("check_llvm_patterns.py: failed to read IR: {e}");
                return 1;
            }
        }
    }
    let findings = analyze(&levels);
    let out = py_path(a.str("out"));
    if let Err(e) = write_findings(&out, &findings) {
        eprintln!("check_llvm_patterns.py: cannot write {out}: {e}");
        return 1;
    }
    println!("check_llvm_patterns.py: {} finding(s) written to {out}", findings.len());
    0
}
