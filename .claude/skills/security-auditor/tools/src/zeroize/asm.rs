//! `sec zeroize-asm`: Rust assembly read for STACK_RETENTION and REGISTER_SPILL in the functions of sensitive types.
//! Finds the architecture from the text and runs its checks: x86-64 (AT&T syntax) or AArch64 (EXPERIMENTAL, every
//! finding needs a manual check). Port of check_rust_asm.py with its backends check_rust_asm_x86.py and
//! check_rust_asm_aarch64.py; it demangles in process (no rustfilt needed) and finds demangled function labels.
//!
//!   sec zeroize-asm --asm <crate>.O2.s --secrets <sensitive-objects.json> --out <asm-findings.json>
//! exit 0 ran (findings may be empty, or an ANALYSIS_SKIPPED entry for another architecture), 1 input or secrets
//! unreadable (an ANALYSIS_ERROR entry is written), 2 argument error

use crate::obj;
use crate::util::{Args, pad4, py_path, py_repr, read_text, req, splitlines_keepends, write_json};
use indexmap::IndexMap;
use regex::{Captures, Regex};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// One finding before ids are given: category, severity, symbol, detail and the evidence line.
#[derive(Clone)]
pub struct Raw {
    category: &'static str,
    severity: &'static str,
    symbol: String,
    detail: String,
    evidence: String,
}

type Lines<'a> = [(usize, &'a str)];

fn num(s: &str) -> u64 {
    s.parse().unwrap_or(u64::MAX)
}

fn detect_architecture(asm: &str) -> &'static str {
    // x86-64: AT&T 64-bit register names
    if Regex::new(r"%r(?:sp|bp|ax|bx|cx|dx|si|di)\b").unwrap().is_match(asm) {
        return "x86_64";
    }
    // AArch64: prologue, zero-register or SIMD forms (ARM GNU syntax), then bare xN operands
    if Regex::new(r"stp\s+x29|str\s+xzr|stp\s+xzr|movi\s+v\d+\.\w+").unwrap().is_match(asm) || Regex::new(r"\b(?:x1[0-9]|x2[0-9]|x[0-9]),").unwrap().is_match(asm) {
        return "aarch64";
    }
    "unknown"
}

/// Every Rust symbol demangled, legacy (`_ZN...E`) and v0 (`_R...`), hashes left out: what `rustfilt` prints, done
/// in process with the crate rustfilt uses. The original ran rustfilt when installed and otherwise only cut legacy
/// symbols to their paths, which left today's v0 symbols mangled.
fn demangle(asm: &str) -> String {
    Regex::new(r"_(ZN|R)[\$\._[:alnum:]]*").unwrap().replace_all(asm, |m: &Captures| format!("{:#}", rustc_demangle::demangle(&m[0]))).into_owned()
}

/// The listing split into functions: ELF `.type sym,@function` names, else (Mach-O) `.globl` names, else every
/// label; the compiler's own labels (LBB0_1, Ltmp0, .Ltmp0) never start one. A name seen twice keeps its first
/// place and its last body. A line that is exactly a known name and a colon starts that function: demangled names
/// (`zt::checksum:`, `<T as Drop>::drop:`) are no plain label, and the original, missing them (and every name with
/// a space), found no function in real demangled output.
fn parse_functions<'a>(lines: &[&'a str]) -> IndexMap<String, Vec<(usize, &'a str)>> {
    // a demangled name may hold spaces and commas (`<(A, B) as T>::f`): the name runs to the last `,@function`
    let func_type = Regex::new(r"\.type\s+(.+),\s*@function").unwrap();
    let globl = Regex::new(r"\.globl\s+(.+)").unwrap();
    let label_re = Regex::new(r"^([A-Za-z_\$][A-Za-z0-9_\$@.]*):").unwrap();
    let internal = Regex::new(r"^\.?L[A-Z_]").unwrap();
    let mut names: HashSet<String> = lines.iter().filter_map(|l| func_type.captures(l).map(|m| m[1].trim().to_string())).collect();
    if names.is_empty() {
        names = lines.iter().filter_map(|l| globl.captures(l).map(|m| m[1].trim().to_string())).collect();
    }
    let mut functions = IndexMap::new();
    let mut current: Option<(String, Vec<(usize, &str)>)> = None;
    for (i, line) in lines.iter().enumerate() {
        let lineno = i + 1;
        let stripped = line.trim();
        let exact = stripped.strip_suffix(':').filter(|n| names.contains(*n));
        if let Some(label) = exact.or_else(|| label_re.captures(stripped).map(|m| m.get(1).unwrap().as_str())) {
            if exact.is_none() && internal.is_match(label) {
                if let Some((_, body)) = current.as_mut() {
                    body.push((lineno, *line));
                }
                continue;
            }
            if names.is_empty() || names.contains(label) {
                if let Some((name, body)) = current.take() {
                    functions.insert(name, body);
                }
                current = Some((label.to_string(), vec![(lineno, *line)]));
                continue;
            }
        }
        if let Some((_, body)) = current.as_mut() {
            body.push((lineno, *line));
        }
    }
    if let Some((name, body)) = current {
        functions.insert(name, body);
    }
    functions
}

/// The Rust sensitive objects' names; None when the file is not valid JSON (missing is an empty list).
fn load_secrets(path: &str) -> Option<Vec<String>> {
    let text = match std::fs::read(path) {
        Ok(b) => String::from_utf8_lossy(&b).into_owned(),
        Err(_) => return Some(Vec::new()),
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(v) => Some(
            v.as_array()
                .map(|objs| objs.iter().filter(|o| o.get("language").and_then(Value::as_str) == Some("rust")).filter_map(|o| o.get("name").and_then(Value::as_str)).filter(|n| !n.is_empty()).map(String::from).collect())
                .unwrap_or_default(),
        ),
        Err(e) => {
            eprintln!("[check_rust_asm] ERROR: corrupt secrets JSON at {}: {e}", py_repr(path));
            None
        }
    }
}

/// the demangled function name mentions a sensitive type
fn is_sensitive_function(name: &str, sensitive: &[String]) -> bool {
    let lower = name.to_lowercase();
    sensitive.iter().any(|n| lower.contains(&n.to_lowercase()))
}

/// drop_in_place::<T> with no call to a wipe (x86-64 `call` or AArch64 `bl`): MISSING_SOURCE_ZEROIZE as corroboration
fn check_drop_glue(name: &str, lines: &Lines) -> Option<Raw> {
    if !name.to_lowercase().contains("drop_in_place") {
        return None;
    }
    let wipe = Regex::new(r"(?:call|bl)\s+.*(?:memset|volatile_set_memory|zeroize)").unwrap();
    if lines.iter().any(|(_, l)| wipe.is_match(l) || l.to_lowercase().contains("zeroize")) {
        return None;
    }
    Some(Raw {
        category: "MISSING_SOURCE_ZEROIZE",
        severity: "medium",
        symbol: name.into(),
        detail: format!("drop_in_place for '{name}' has no zeroize/volatile-store calls — sensitive type may not be wiped on drop"),
        evidence: format!("No zeroize call found in {name} drop glue ({} lines)", lines.len()),
    })
}

// ---- x86-64 (System V ABI) -----------------------------------------------------------------------------------------

mod x86 {
    use super::{Lines, Raw, num, py_repr};
    use regex::Regex;
    use std::collections::HashSet;

    const CALLER_SAVED: &[&str] = &[
        "rax", "rcx", "rdx", "rsi", "rdi", "r8", "r9", "r10", "r11",
        // XMM 0–15 are all caller-saved (System V AMD64 ABI §3.2.1)
        "xmm0", "xmm1", "xmm2", "xmm3", "xmm4", "xmm5", "xmm6", "xmm7", "xmm8", "xmm9", "xmm10", "xmm11", "xmm12", "xmm13", "xmm14", "xmm15",
    ];
    const CALLEE_SAVED: &[&str] = &["rbx", "r12", "r13", "r14", "r15", "rbp"];

    struct Re {
        frame_alloc: Regex,
        zero: Vec<Regex>,
        memset: Regex,
        simd_zero: Regex,
        spill: Regex,
        ret: Regex,
        red_zone: Regex,
    }

    fn re() -> Re {
        Re {
            frame_alloc: Regex::new(r"subq\s+\$(\d+),\s+%rsp").unwrap(),
            // zero stores of every width that can clear secret bytes
            zero: ["movq", "movl", "movw", "movb"].iter().map(|m| Regex::new(&format!(r"{m}\s+\$0,\s+-?\d+\(%r[sb]p\)")).unwrap()).collect(),
            memset: Regex::new(r"call\s+.*(?:memset|volatile_set_memory|zeroize)").unwrap(),
            // xorps/pxor/vpxor %regN, %regN zeroes a register, usually just before the store that wipes
            simd_zero: Regex::new(r"(?:xorps|xorpd|pxor|vpxor)\s+%(\w+),\s+%(\w+)").unwrap(),
            spill: Regex::new(r"mov(?:q|dqa|ups|aps)\s+%(\w+),\s+(-?\d+)\(%r[sb]p\)").unwrap(),
            ret: Regex::new(r"\bret[ql]?\b").unwrap(),
            // stores to -N(%rsp), N ≤ 128, in leaf functions with no subq
            red_zone: Regex::new(r"mov(?:q|l|b|w)\s+%\w+,\s+-(\d+)\(%rsp\)").unwrap(),
        }
    }

    /// a zero store, a wipe call or a SIMD self-XOR on this line (comment stripped)
    fn zeroes(r: &Re, code: &str) -> bool {
        r.zero.iter().any(|z| z.is_match(code)) || r.memset.is_match(code) || r.simd_zero.captures(code).is_some_and(|m| m[1] == m[2])
    }

    /// the code before an AT&T `#` comment, so `# retq` or `# movq $0, ...` in a comment never counts
    fn code(line: &str) -> &str {
        line.split('#').next().unwrap_or("")
    }

    /// a frame allocated (subq $N, %rsp) and never zeroed before return
    fn stack_retention(r: &Re, name: &str, lines: &Lines) -> Option<Raw> {
        let (mut alloc, mut size, mut zeroed, mut ret): (Option<(usize, String)>, u64, bool, Option<usize>) = (None, 0, false, None);
        for (n, line) in lines {
            let c = code(line);
            if let Some(m) = r.frame_alloc.captures(c) {
                if alloc.is_none() {
                    alloc = Some((*n, line.trim().to_string()));
                    size = num(&m[1]);
                }
            }
            zeroed |= zeroes(r, c);
            if r.ret.is_match(c) {
                ret = Some(*n);
            }
        }
        let ((at, text), ret) = (alloc?, ret?);
        if zeroed || size == 0 {
            return None;
        }
        Some(Raw {
            category: "STACK_RETENTION",
            severity: "high",
            symbol: name.into(),
            detail: format!("Stack frame of {size} bytes allocated at line {at} ({}) but no zero-store found before return at line {ret}", py_repr(&text)),
            evidence: format!("{text} at line {at}; no volatile wipe before retq at line {ret}"),
        })
    }

    /// registers spilled to the stack, one finding per register
    fn register_spill(r: &Re, name: &str, lines: &Lines) -> Vec<Raw> {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for (n, line) in lines {
            let Some(m) = r.spill.captures(line) else { continue };
            let reg = m[1].to_string();
            let class = if CALLER_SAVED.contains(&reg.as_str()) {
                "caller-saved"
            } else if CALLEE_SAVED.contains(&reg.as_str()) {
                "callee-saved"
            } else {
                continue;
            };
            if seen.insert(reg.clone()) {
                out.push(Raw {
                    category: "REGISTER_SPILL",
                    severity: if class == "callee-saved" { "high" } else { "medium" },
                    symbol: name.into(),
                    detail: format!("Register %{reg} ({class}) spilled to stack at line {n} in function '{name}' — may expose secret value"),
                    evidence: format!("{} at line {n}", line.trim()),
                });
            }
        }
        out
    }

    /// A leaf function (no subq frame) storing into the 128-byte red zone below %rsp without zeroing it: the ABI
    /// lets it use that space unannounced, and what it leaves there stays after return.
    fn red_zone(r: &Re, name: &str, lines: &Lines) -> Option<Raw> {
        if lines.iter().any(|(_, l)| r.frame_alloc.is_match(l)) {
            return None;
        }
        let (mut depth, mut zeroed, mut has_ret) = (0u64, false, false);
        for (_, line) in lines {
            let c = code(line);
            if let Some(m) = r.red_zone.captures(c) {
                let offset = num(&m[1]);
                if offset <= 128 {
                    depth = depth.max(offset);
                }
            }
            zeroed |= zeroes(r, c);
            has_ret |= r.ret.is_match(c);
        }
        if depth == 0 || !has_ret || zeroed {
            return None;
        }
        Some(Raw {
            category: "STACK_RETENTION",
            severity: "high",
            symbol: name.into(),
            detail: format!("Leaf function '{name}' stores {depth} bytes in the x86-64 red zone (below %rsp) without zeroing before return — sensitive data may persist in the 128-byte region below %rsp"),
            evidence: format!("red zone depth -{depth}(%rsp); no mov[qwlb] $0 or memset/zeroize call before retq"),
        })
    }

    pub fn analyze_function(name: &str, lines: &Lines) -> Vec<Raw> {
        let r = re();
        let mut out: Vec<Raw> = stack_retention(&r, name, lines).into_iter().collect();
        out.extend(register_spill(&r, name, lines));
        out.extend(red_zone(&r, name, lines));
        out
    }
}

// ---- AArch64 (AAPCS64), EXPERIMENTAL -------------------------------------------------------------------------------
// Known limits: x29/x30 are saved by every prologue (`stp x29, x30, [sp, #-N]!`) and so always show as callee-saved
// spills, almost never holding a secret; `dc zva` is not seen as a zero store; AArch64 has no red zone.

mod aarch64 {
    use super::{Lines, Raw, num, py_repr};
    use regex::Regex;
    use std::collections::HashSet;

    fn caller_saved(reg: &str) -> bool {
        // x0–x17, v0–v7 and v16–v31
        let n = |p: &str| reg.strip_prefix(p).filter(|d| !d.is_empty() && d.chars().all(|c| c.is_ascii_digit()) && (d.len() == 1 || !d.starts_with('0'))).map(|d| d.parse::<u32>().unwrap_or(u32::MAX));
        matches!(n("x"), Some(0..=17)) || matches!(n("v"), Some(0..=7) | Some(16..=31))
    }
    fn callee_saved(reg: &str) -> bool {
        // x19–x28, x29 (fp), x30 (lr), and the low 64 bits of v8–v15
        let n = |p: &str| reg.strip_prefix(p).filter(|d| !d.is_empty() && d.chars().all(|c| c.is_ascii_digit()) && (d.len() == 1 || !d.starts_with('0'))).map(|d| d.parse::<u32>().unwrap_or(u32::MAX));
        matches!(n("x"), Some(19..=30)) || matches!(n("v"), Some(8..=15))
    }

    struct Re {
        frame_stp: Regex,
        frame_sub: Regex,
        zero: Vec<Regex>,
        ret: Regex,
        str_spill: Regex,
        stp_spill: Regex,
        q: Regex,
    }

    fn re() -> Re {
        Re {
            // the usual prologue, a pre-index pair store of fp/lr that lowers sp, or an explicit sub
            frame_stp: Regex::new(r"stp\s+x29,\s+x30,\s+\[sp,\s+#-(\d+)\]!").unwrap(),
            frame_sub: Regex::new(r"sub\s+sp,\s+sp,\s+#(\d+)").unwrap(),
            zero: vec![
                // str xzr/wzr and stp xzr, xzr to the stack
                Regex::new(r"\bstr\s+[xw]zr,\s+\[sp(?:,\s*#-?\d+)?\]").unwrap(),
                Regex::new(r"\bstp\s+[xw]zr,\s+[xw]zr,\s+\[sp(?:,\s*#-?\d+)?\]").unwrap(),
                // movi vN.*, #0 (before a stp qN) and a call to a wipe
                Regex::new(r"\bmovi\s+v\d+\.\w+,\s+#0\b").unwrap(),
                Regex::new(r"\bbl\s+.*(?:memset|volatile_set_memory|zeroize)").unwrap(),
            ],
            ret: Regex::new(r"\bret\b").unwrap(),
            str_spill: Regex::new(r"\bstr\s+(x\d+|v\d+|q\d+),\s+\[sp(?:,\s*#-?\d+)?\]").unwrap(),
            // pairs, SIMD q pairs too
            stp_spill: Regex::new(r"\bstp\s+((?:x|q)\d+),\s+((?:x|q)\d+),\s+\[sp(?:,\s*#-?\d+)?\]").unwrap(),
            q: Regex::new(r"^q(\d+)$").unwrap(),
        }
    }

    /// a frame allocated and never zeroed before return; stp and sub frames add up
    fn stack_retention(r: &Re, name: &str, lines: &Lines) -> Option<Raw> {
        let (mut alloc, mut size, mut zeroed, mut ret): (Option<(usize, String)>, u64, bool, Option<usize>) = (None, 0, false, None);
        for (n, line) in lines {
            for frame in [&r.frame_stp, &r.frame_sub] {
                if let Some(m) = frame.captures(line) {
                    if alloc.is_none() {
                        alloc = Some((*n, line.trim().to_string()));
                    }
                    size = size.saturating_add(num(&m[1]));
                }
            }
            zeroed |= r.zero.iter().any(|z| z.is_match(line));
            if r.ret.is_match(line) {
                ret = Some(*n);
            }
        }
        let ((at, text), ret) = (alloc?, ret?);
        if zeroed || size == 0 {
            return None;
        }
        Some(Raw {
            category: "STACK_RETENTION",
            severity: "high",
            symbol: name.into(),
            detail: format!("[EXPERIMENTAL] AArch64 stack frame of {size} bytes allocated at line {at} ({}) but no zero-store (str xzr / stp xzr,xzr / movi+stp / zeroize call) found before return at line {ret}", py_repr(&text)),
            evidence: format!("{text} at line {at}; no str/stp xzr or zeroize call before ret at line {ret}"),
        })
    }

    /// registers stored to the stack, one finding per register (x29/x30 from every prologue among them)
    fn register_spill(r: &Re, name: &str, lines: &Lines) -> Vec<Raw> {
        let mut spills: Vec<(usize, String, String)> = Vec::new();
        for (n, line) in lines {
            if let Some(m) = r.str_spill.captures(line) {
                let reg = &m[1];
                // a q register is the 128-bit view of a v register; all of them count
                if callee_saved(reg) || caller_saved(reg) || r.q.is_match(reg) {
                    spills.push((*n, reg.to_string(), line.trim().to_string()));
                }
            }
            if let Some(m) = r.stp_spill.captures(line) {
                for reg in [&m[1], &m[2]] {
                    if reg != "xzr" && (callee_saved(reg) || caller_saved(reg) || r.q.is_match(reg)) {
                        spills.push((*n, reg.to_string(), line.trim().to_string()));
                    }
                }
            }
        }
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for (n, reg, text) in spills {
            if !seen.insert(reg.clone()) {
                continue;
            }
            let (class, severity) = if callee_saved(&reg) {
                ("callee-saved", "high")
            } else if r.q.captures(&reg).is_some_and(|m| (8..16).contains(&num(&m[1]))) {
                // q8–q15: their low 64 bits are callee-saved
                ("callee-saved (partial)", "high")
            } else {
                ("caller-saved", "medium")
            };
            out.push(Raw {
                category: "REGISTER_SPILL",
                severity,
                symbol: name.into(),
                detail: format!("[EXPERIMENTAL] AArch64 register {reg} ({class}) spilled to stack at line {n} in function '{name}' — may expose secret value"),
                evidence: format!("{text} at line {n}"),
            });
        }
        out
    }

    pub fn analyze_function(name: &str, lines: &Lines) -> Vec<Raw> {
        let r = re();
        let mut out: Vec<Raw> = stack_retention(&r, name, lines).into_iter().collect();
        out.extend(register_spill(&r, name, lines));
        out
    }
}

// ---- entry ---------------------------------------------------------------------------------------------------------

pub fn main(argv: &[String]) -> i32 {
    let a = Args::parse("sec zeroize-asm", argv, &[req("asm"), req("secrets"), req("out")], 0);
    let (asm_path, out_arg) = (py_path(a.str("asm")), a.str("out").to_string());
    let out = Path::new(&out_arg);
    let write = |v: &Value| {
        if let Err(e) = write_json(out, v) {
            eprintln!("[check_rust_asm] ERROR: cannot write {out_arg}: {e}");
        }
    };
    let fail = |message: String| -> i32 {
        write(&Value::Array(vec![obj! {
            "id" => "F-RUST-ASM-ERROR",
            "category" => "ANALYSIS_ERROR",
            "severity" => "info",
            "detail" => message,
            "location" => obj! { "file" => asm_path.clone(), "line" => 0 },
        }]));
        1
    };
    if !Path::new(&asm_path).exists() {
        eprintln!("[check_rust_asm] ERROR: assembly file not found: {asm_path}");
        return fail(format!("Assembly file not found: {asm_path}"));
    }
    let text = match read_text(Path::new(&asm_path)) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[check_rust_asm] ERROR: cannot read assembly file: {e}");
            return fail(format!("Cannot read assembly file: {e}"));
        }
    };
    let arch = detect_architecture(&text);
    let analyze: fn(&str, &Lines) -> Vec<Raw> = match arch {
        "x86_64" => x86::analyze_function,
        "aarch64" => {
            eprintln!("[check_rust_asm] NOTE: AArch64 support is EXPERIMENTAL. Findings require manual verification before inclusion in a report.");
            aarch64::analyze_function
        }
        _ => {
            eprintln!("[check_rust_asm] WARNING: unsupported assembly architecture '{arch}'. Writing skipped finding.");
            write(&Value::Array(vec![obj! {
                "id" => "F-RUST-ASM-SKIP-0001",
                "category" => "ANALYSIS_SKIPPED",
                "severity" => "info",
                "confidence" => "confirmed",
                "detail" => format!("Unsupported assembly architecture '{arch}' -- no analysis performed"),
                "location" => obj! { "file" => asm_path.clone(), "line" => 0 },
            }]));
            return 0;
        }
    };
    let demangled = demangle(&text);
    let Some(sensitive) = load_secrets(a.str("secrets")) else {
        eprintln!("[check_rust_asm] ERROR: aborting due to corrupt secrets file");
        return fail("Aborting due to corrupt secrets file".into());
    };
    if sensitive.is_empty() {
        eprintln!("[check_rust_asm] WARNING: no Rust sensitive objects found in secrets file");
    }
    let lines: Vec<&str> = splitlines_keepends(&demangled).into_iter().map(|l| l.trim_end_matches('\n')).collect();
    let functions = parse_functions(&lines);

    // monomorphized instances of one generic function collapse into one finding, counted
    let hash = Regex::new(r"::h[0-9a-f]{16}$").unwrap();
    let params = Regex::new(r"::<[^>]+>").unwrap();
    let key = |r: &Raw, base: &str| (r.category, base.to_string(), if r.category == "REGISTER_SPILL" { r.evidence.clone() } else { String::new() });
    let mut counts: HashMap<(&str, String, String), usize> = HashMap::new();
    let mut kept: Vec<(Raw, String)> = Vec::new();
    for (name, body) in &functions {
        if !is_sensitive_function(name, &sensitive) {
            continue;
        }
        let base = params.replace_all(&hash.replace(name, ""), "").into_owned();
        let mut found = analyze(name, body);
        found.extend(check_drop_glue(name, body));
        for r in found {
            let k = key(&r, &base);
            let n = counts.entry(k).or_insert(0);
            *n += 1;
            if *n == 1 {
                kept.push((r, base.clone()));
            }
        }
    }
    let output: Vec<Value> = kept
        .iter()
        .enumerate()
        .map(|(i, (r, base))| {
            let count = counts.get(&key(r, base)).copied().unwrap_or(1);
            let evidence = if count > 1 { format!("{} (seen in {count} monomorphized instances)", r.evidence) } else { r.evidence.clone() };
            obj! {
                "id" => format!("F-RUST-ASM-{}", pad4(i + 1)),
                "language" => "rust",
                "category" => r.category,
                "severity" => r.severity,
                "symbol" => r.symbol.clone(),
                "detail" => r.detail.clone(),
                "evidence" => vec![obj! { "source" => "asm", "detail" => evidence }],
                "evidence_files" => vec![asm_path.clone()],
            }
        })
        .collect();
    write(&Value::Array(output.clone()));
    eprintln!("[check_rust_asm] {} finding(s) written to {out_arg}", output.len());
    0
}
