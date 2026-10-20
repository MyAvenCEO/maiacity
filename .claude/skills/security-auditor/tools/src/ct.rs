//! `sec ct`: the constant-time analyzer. Compiles a Rust file to assembly (rustc --emit=asm) or reads a JavaScript
//! file's V8 bytecode (node --print-bytecode), and reports the variable-time instructions in it (division, square
//! root, and with --warnings the branches, comparisons, keyed lookups and encodings that leak when a secret reaches
//! them). It has no data flow: a FAILED report is a worklist the skill triages, never a verdict. Ported from Trail of
//! Bits' constant-time-analysis ct_analyzer/analyzer.py and script_analyzers.py (trailofbits/skills, CC-BY-SA 4.0),
//! kept to the languages we write (Rust, JavaScript) plus `--assembly` for any listed architecture; the rules are
//! unchanged.
//!
//!   sec ct [--warnings] [--json|--github] [--arch x86_64|arm64|...] [--opt-level O2] [--func <regex>]
//!          [--compiler rustc] [-X <rustc flag>]... <file.rs|file.js|file.mjs|file.cjs>
//!   sec ct --assembly --arch arm64 [--warnings] <file.s>
//!   sec ct --list-arch

use crate::obj;
use regex::Regex;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const ERROR: &str = "error";
const WARNING: &str = "warning";

/// A target without a hardware divider calls a helper, which loops over its operands: worse than the instruction.
const DIVISION_HELPERS: &[&str] = &[
    // Arm EABI
    "__aeabi_idiv", "__aeabi_uidiv", "__aeabi_idivmod", "__aeabi_uidivmod", "__aeabi_ldivmod", "__aeabi_uldivmod",
    // libgcc / compiler-rt, by operand width
    "__divsi3", "__udivsi3", "__modsi3", "__umodsi3", "__divdi3", "__udivdi3", "__moddi3", "__umoddi3", "__divti3", "__udivti3", "__modti3",
    "__umodti3",
];

const BRANCH: &str = "conditional branch may leak timing information if condition depends on secret data";

type Table = Vec<(String, String)>;

struct Arch {
    name: &'static str,
    errors: Table,
    warnings: Table,
}

fn each(names: &[&str], reason: impl Fn(&str) -> String) -> Table {
    names.iter().map(|n| (n.to_string(), reason(n))).collect()
}
fn fixed(pairs: &[(&str, &str)]) -> Table {
    pairs.iter().map(|(n, r)| (n.to_string(), r.to_string())).collect()
}
fn branches(names: &[&str]) -> Table {
    each(names, |_| BRANCH.into())
}
fn data_dep(n: &str) -> String {
    format!("{} has data-dependent timing; execution time varies based on operand values", n.to_uppercase())
}
fn early_term(n: &str) -> String {
    format!("{} has early termination optimization; execution time depends on operand values", n.to_uppercase())
}
fn cat(parts: Vec<Table>) -> Table {
    parts.into_iter().flatten().collect()
}

/// The variable-time instructions of each architecture (Trail of Bits' research and the cryptocoding guidelines).
fn dangerous_instructions() -> Vec<Arch> {
    vec![
        Arch {
            name: "x86_64",
            errors: cat(vec![
                each(&["div", "idiv", "divb", "divw", "divl", "divq", "idivb", "idivw", "idivl", "idivq"], data_dep),
                fixed(&[
                    ("divss", "DIVSS (scalar single FP division) has variable latency"),
                    ("divsd", "DIVSD (scalar double FP division) has variable latency"),
                    ("divps", "DIVPS (packed single FP division) has variable latency"),
                    ("divpd", "DIVPD (packed double FP division) has variable latency"),
                    ("vdivss", "VDIVSS (AVX scalar single FP division) has variable latency"),
                    ("vdivsd", "VDIVSD (AVX scalar double FP division) has variable latency"),
                    ("vdivps", "VDIVPS (AVX packed single FP division) has variable latency"),
                    ("vdivpd", "VDIVPD (AVX packed double FP division) has variable latency"),
                ]),
                each(&["sqrtss", "sqrtsd", "sqrtps", "sqrtpd", "vsqrtss", "vsqrtsd", "vsqrtps", "vsqrtpd"], |n| format!("{} has variable latency based on operand values", n.to_uppercase())),
            ]),
            warnings: branches(&["je", "jne", "jz", "jnz", "ja", "jae", "jb", "jbe", "jg", "jge", "jl", "jle", "jo", "jno", "js", "jns", "jp", "jnp", "jc", "jnc"]),
        },
        Arch {
            name: "arm64",
            errors: cat(vec![
                // even with DIT enabled, division is not constant-time; Plan 9 syntax (Go's assembler) puts the width in the mnemonic
                each(&["udiv", "sdiv", "udivw", "sdivw"], early_term),
                fixed(&[
                    ("fdiv", "FDIV (FP division) has variable latency based on operand values"),
                    ("fdivs", "FDIVS (FP division) has variable latency based on operand values"),
                    ("fdivd", "FDIVD (FP division) has variable latency based on operand values"),
                    ("fsqrt", "FSQRT has variable latency based on operand values"),
                    ("fsqrts", "FSQRTS has variable latency based on operand values"),
                    ("fsqrtd", "FSQRTD has variable latency based on operand values"),
                ]),
            ]),
            warnings: cat(vec![
                branches(&["b.eq", "b.ne", "b.cs", "b.cc", "b.mi", "b.pl", "b.vs", "b.vc", "b.hi", "b.ls", "b.ge", "b.lt", "b.gt", "b.le"]),
                branches(&["beq", "bne", "bcs", "bcc", "bmi", "bpl", "bvs", "bvc", "bhi", "bls", "bge", "blt", "bgt", "ble"]),
                fixed(&[
                    ("cbz", "compare-and-branch may leak timing information if value depends on secret data"),
                    ("cbnz", "compare-and-branch may leak timing information if value depends on secret data"),
                    ("tbz", "test-bit-and-branch may leak timing information if value depends on secret data"),
                    ("tbnz", "test-bit-and-branch may leak timing information if value depends on secret data"),
                ]),
            ]),
        },
        Arch {
            name: "arm",
            errors: cat(vec![
                each(&["udiv", "sdiv"], early_term),
                fixed(&[
                    ("vdiv.f32", "VDIV.F32 has variable latency"),
                    ("vdiv.f64", "VDIV.F64 has variable latency"),
                    ("vsqrt.f32", "VSQRT.F32 has variable latency"),
                    ("vsqrt.f64", "VSQRT.F64 has variable latency"),
                ]),
            ]),
            warnings: branches(&["beq", "bne", "bcs", "bcc", "bmi", "bpl", "bvs", "bvc", "bhi", "bls", "bge", "blt", "bgt", "ble"]),
        },
        Arch {
            name: "riscv64",
            errors: cat(vec![
                each(&["div", "divu", "divw", "divuw", "rem", "remu", "remw", "remuw"], |n| format!("{} has variable-time execution based on operand values", n.to_uppercase())),
                fixed(&[
                    ("fdiv.s", "FDIV.S has variable latency"),
                    ("fdiv.d", "FDIV.D has variable latency"),
                    ("fsqrt.s", "FSQRT.S has variable latency"),
                    ("fsqrt.d", "FSQRT.D has variable latency"),
                ]),
            ]),
            warnings: branches(&["beq", "bne", "blt", "bge", "bltu", "bgeu"]),
        },
        Arch {
            name: "ppc64le",
            errors: cat(vec![
                each(&["divw", "divwu", "divd", "divdu", "divwe", "divweu", "divde", "divdeu"], |n| format!("{} has variable-time execution", n.to_uppercase())),
                fixed(&[("fdiv", "FDIV has variable latency"), ("fdivs", "FDIVS has variable latency"), ("fsqrt", "FSQRT has variable latency"), ("fsqrts", "FSQRTS has variable latency")]),
            ]),
            warnings: branches(&["beq", "bne", "blt", "bge", "bgt", "ble"]),
        },
        Arch {
            name: "s390x",
            errors: fixed(&[
                ("d", "D (divide) has variable-time execution"),
                ("dr", "DR (divide register) has variable-time execution"),
                ("dl", "DL (divide logical) has variable-time execution"),
                ("dlr", "DLR (divide logical register) has variable-time execution"),
                ("dlg", "DLG (divide logical 64-bit) has variable-time execution"),
                ("dlgr", "DLGR (divide logical register 64-bit) has variable-time execution"),
                ("dsg", "DSG (divide single 64-bit) has variable-time execution"),
                ("dsgr", "DSGR (divide single register 64-bit) has variable-time execution"),
                ("dsgf", "DSGF (divide single 64x32) has variable-time execution"),
                ("dsgfr", "DSGFR (divide single register 64x32) has variable-time execution"),
                ("ddb", "DDB (divide FP) has variable latency"),
                ("ddbr", "DDBR (divide FP register) has variable latency"),
                ("sqdb", "SQDB (square root FP) has variable latency"),
                ("sqdbr", "SQDBR (square root FP register) has variable latency"),
            ]),
            warnings: branches(&["je", "jne", "jh", "jl", "jhe", "jle", "jo", "jno", "jp", "jnp", "jm", "jnm", "jz", "jnz"]),
        },
        Arch {
            name: "i386",
            errors: cat(vec![
                fixed(&[
                    ("div", "DIV has data-dependent timing; execution time varies based on operand values"),
                    ("idiv", "IDIV has data-dependent timing; execution time varies based on operand values"),
                ]),
                each(&["divb", "divw", "divl", "idivb", "idivw", "idivl"], |n| format!("{} has data-dependent timing", n.to_uppercase())),
                each(&["fdiv", "fdivp", "fidiv", "fdivr", "fdivrp", "fidivr", "fsqrt"], |n| format!("{} has variable latency", n.to_uppercase())),
            ]),
            warnings: branches(&["je", "jne", "jz", "jnz", "ja", "jae", "jb", "jbe", "jg", "jge", "jl", "jle"]),
        },
    ]
}

fn lookup<'a>(t: &'a Table, k: &str) -> Option<&'a str> {
    t.iter().find(|(n, _)| n == k).map(|(_, r)| r.as_str())
}

fn normalize_arch(a: &str) -> String {
    let l = a.to_lowercase();
    let alias = match l.as_str() {
        "amd64" | "x64" => "x86_64",
        "aarch64" => "arm64",
        "armv7" | "armhf" => "arm",
        "386" | "x86" => "i386",
        "ppc64" => "ppc64le",
        "riscv" => "riscv64",
        _ => return l,
    };
    alias.into()
}

fn native_arch() -> String {
    normalize_arch(match std::env::consts::ARCH {
        "powerpc64" => "ppc64le",
        other => other,
    })
}

fn detect_language(file: &str) -> &'static str {
    let ext = Path::new(file).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    match ext.as_str() {
        "rs" => "rust",
        "js" | "mjs" | "cjs" => "javascript",
        _ => "unknown",
    }
}

#[derive(Clone)]
struct Violation {
    function: String,
    file: String,
    line: Option<usize>,
    address: String,
    instruction: String,
    mnemonic: String,
    reason: String,
    severity: &'static str,
}

impl Violation {
    fn json(&self) -> Value {
        obj! {
            "function" => self.function.clone(),
            "file" => self.file.clone(),
            "line" => self.line.map(Value::from).unwrap_or(Value::Null),
            "address" => self.address.clone(),
            "instruction" => self.instruction.clone(),
            "mnemonic" => self.mnemonic.clone(),
            "reason" => self.reason.clone(),
            "severity" => self.severity,
        }
    }
}

struct Func {
    name: String,
    instructions: usize,
}

struct Parsed {
    functions: Vec<Func>,
    violations: Vec<Violation>,
}

fn report(architecture: &str, compiler: &str, optimization: &str, source_file: &str, p: Parsed) -> Value {
    let errors = p.violations.iter().filter(|v| v.severity == ERROR).count();
    obj! {
        "architecture" => architecture,
        "compiler" => compiler,
        "optimization" => optimization,
        "source_file" => source_file,
        "total_functions" => p.functions.len(),
        "total_instructions" => p.functions.iter().map(|f| f.instructions).sum::<usize>(),
        "error_count" => errors,
        "warning_count" => p.violations.len() - errors,
        "passed" => errors == 0,
        "violations" => p.violations.iter().map(Violation::json).collect::<Vec<_>>(),
    }
}

// ---- assembly ------------------------------------------------------------------------------------------------------

/// the functions an assembly listing defines (with their instruction counts) and its dangerous instructions
fn parse_assembly(text: &str, arch: &str, include_warnings: bool) -> Parsed {
    let arch = normalize_arch(arch);
    let all = dangerous_instructions();
    let table = all.iter().find(|a| a.name == arch);
    if table.is_none() {
        let names: Vec<&str> = all.iter().map(|a| a.name).collect();
        eprintln!("Warning: Architecture '{arch}' is not supported. Supported architectures: {}. No timing violations will be detected.", names.join(", "));
    }
    let empty = Table::new();
    let (errors, warnings) = table.map(|t| (&t.errors, &t.warnings)).unwrap_or((&empty, &empty));
    let file_line = Regex::new(r"#\s*([^:]+):(\d+)").unwrap();
    let label = Regex::new(r"^([a-zA-Z_][a-zA-Z0-9_]*):$").unwrap();
    let plan9 = Regex::new(r"^TEXT\s+([^\s(]+)\(SB\)").unwrap();
    let elf_type = Regex::new(r"^\.type\s+([a-zA-Z_][a-zA-Z0-9_]*),\s*@function").unwrap();
    let addr_re = Regex::new(r"0x([0-9a-fA-F]+)").unwrap();
    let hex_bytes = Regex::new(r"^[0-9a-fA-F]{2,}$").unwrap();

    let mut functions = Vec::new();
    let mut violations = Vec::new();
    let mut current: Option<String> = None;
    let (mut file, mut line): (Option<String>, Option<usize>) = (None, None);
    let mut count = 0;
    for raw in text.split('\n') {
        let l = raw.trim();
        if l.is_empty() || l.starts_with('#') || l.starts_with("//") || l.starts_with(';') {
            if let Some(m) = file_line.captures(l) {
                file = Some(m[1].to_string());
                line = m[2].parse().ok();
            }
            continue;
        }
        if let Some(m) = label.captures(l).or_else(|| plan9.captures(l)).or_else(|| elf_type.captures(l)) {
            if let Some(name) = current.take() {
                functions.push(Func { name, instructions: count });
            }
            current = Some(m[1].to_string());
            count = 0;
            continue;
        }
        if l.starts_with('.') {
            continue;
        }
        let address = addr_re.captures(l).map(|m| format!("0x{}", &m[1])).unwrap_or_default();
        // the first token that is not an address, hex bytes or a file:line reference
        let mut mnemonic = String::new();
        for part in l.split_whitespace() {
            if part.starts_with("0x") || hex_bytes.is_match(part) {
                continue;
            }
            if part.contains(':') && !part.ends_with(':') {
                continue;
            }
            mnemonic = part.to_lowercase().trim_end_matches(':').to_string();
            break;
        }
        if mnemonic.is_empty() {
            continue;
        }
        count += 1;
        let at = |mnemonic: String, reason: String, severity: &'static str| Violation {
            function: current.clone().unwrap_or_else(|| "<unknown>".into()),
            file: file.clone().unwrap_or_default(),
            line,
            address: address.clone(),
            instruction: l.to_string(),
            mnemonic,
            reason,
            severity,
        };
        if let Some(h) = DIVISION_HELPERS.iter().find(|h| l.contains(*h)) {
            violations.push(at(h.to_uppercase().trim_start_matches('_').to_string(), format!("{h} performs division in software; it loops over the operands, so its execution time depends on their values"), ERROR));
        } else if let Some(r) = lookup(errors, &mnemonic) {
            violations.push(at(mnemonic.to_uppercase(), r.into(), ERROR));
        } else if let Some(r) = lookup(warnings, &mnemonic).filter(|_| include_warnings) {
            violations.push(at(mnemonic.to_uppercase(), r.into(), WARNING));
        }
    }
    if let Some(name) = current {
        functions.push(Func { name, instructions: count });
    }
    Parsed { functions, violations }
}

const RUST_TARGETS: &[(&str, &str)] = &[
    ("x86_64", "x86_64-unknown-linux-gnu"),
    ("i386", "i686-unknown-linux-gnu"),
    ("arm64", "aarch64-unknown-linux-gnu"),
    ("arm", "armv7-unknown-linux-gnueabihf"),
    ("riscv64", "riscv64gc-unknown-linux-gnu"),
    ("ppc64le", "powerpc64le-unknown-linux-gnu"),
    ("s390x", "s390x-unknown-linux-gnu"),
];

fn available(cmd: &str) -> bool {
    Command::new(cmd).arg("--version").output().is_ok_and(|o| o.status.success())
}

/// rustc to assembly; a file without `fn main` is a library (crypto lives in libraries)
fn rust_to_assembly(source: &Path, out: &Path, arch: &str, optimization: &str, extra: &[String], rustc: &str) -> Result<(), String> {
    let Some((_, target)) = RUST_TARGETS.iter().find(|(a, _)| *a == arch) else {
        let mut names: Vec<&str> = RUST_TARGETS.iter().map(|(a, _)| *a).collect();
        names.sort();
        return Err(format!("{rustc} cannot target {arch} here; supported: {}", names.join(", ")));
    };
    let opt = match optimization {
        "O0" => "0",
        "O1" => "1",
        "O3" => "3",
        "Os" => "s",
        "Oz" => "z",
        _ => "2",
    };
    // an unreadable file compiles as a library
    let text = fs::read_to_string(source).unwrap_or_default();
    let crate_type = if Regex::new(r"(?m)^\s*(pub\s+)?fn\s+main\s*\(").unwrap().is_match(&text) { "bin" } else { "lib" };
    let r = Command::new(rustc)
        .args(["--emit=asm", &format!("--crate-type={crate_type}"), "-C", &format!("opt-level={opt}"), "--target", target])
        .args(extra)
        .arg(source)
        .arg("-o")
        .arg(out)
        .output()
        .map_err(|_| format!("Rustc not found: {rustc}"))?;
    if r.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&r.stderr).into_owned()) }
}

fn filter_by(pattern: Option<&str>, p: Parsed) -> Result<Parsed, String> {
    let Some(pattern) = pattern.filter(|p| !p.is_empty()) else { return Ok(p) };
    let re = Regex::new(pattern).map_err(|e| format!("Invalid regular expression: /{pattern}/: {e}"))?;
    Ok(Parsed { functions: p.functions.into_iter().filter(|f| re.is_match(&f.name)).collect(), violations: p.violations.into_iter().filter(|v| re.is_match(&v.function)).collect() })
}

fn analyze_assembly(file: &str, arch: &str, include_warnings: bool, func: Option<&str>) -> Result<Value, String> {
    let arch = normalize_arch(arch);
    let text = fs::read_to_string(file).map_err(|e| format!("{e}, open '{file}'"))?;
    let parsed = filter_by(func, parse_assembly(&text, &arch, include_warnings))?;
    Ok(report(&arch, "unknown", "unknown", file, parsed))
}

// ---- JavaScript (V8 bytecode plus a source scan) -------------------------------------------------------------------

const CONDITIONAL_JUMP: &str = "Conditional jump may leak timing if condition depends on secret data";
const KEYED: &str = "Array/property access may leak timing via cache if index depends on secrets";

fn js_bytecode_errors() -> Table {
    fixed(&[
        ("div", "Div bytecode has variable-time execution based on operand values"),
        ("mod", "Mod bytecode has variable-time execution based on operand values"),
        ("divsmi", "DivSmi (division by small integer) has variable-time execution"),
        ("modsmi", "ModSmi (modulo by small integer) has variable-time execution"),
    ])
}

fn js_bytecode_warnings() -> Table {
    cat(vec![
        each(&["jumpiftrue", "jumpiffalse", "jumpiftobooleanfalse", "jumpiftobooleantrue", "jumpifundefined", "jumpifnull"], |_| CONDITIONAL_JUMP.into()),
        fixed(&[
            ("testequal", "Equality test may early-terminate on secret data"),
            ("testequalstrict", "Strict equality test may early-terminate on secret data"),
            // keyed access only: a named access has a constant property name, never a secret
            ("getkeyedproperty", KEYED),
            ("setkeyedproperty", KEYED),
            ("ldakeyedproperty", KEYED),
            ("stakeyedproperty", KEYED),
            ("getkeyed", "Array access may leak timing via cache if index depends on secrets"),
            ("setkeyed", "Array access may leak timing via cache if index depends on secrets"),
            ("shiftleft", "Left shift may leak timing if shift amount depends on secrets"),
            ("shiftright", "Right shift may leak timing if shift amount depends on secrets"),
            ("shiftrightsmi", "Right shift by constant may still leak timing in some contexts"),
            ("shiftleftsmi", "Left shift by constant may still leak timing in some contexts"),
            ("bitwiseand", "Bitwise AND timing may vary based on operands"),
            ("bitwiseor", "Bitwise OR timing may vary based on operands"),
            ("bitwisexor", "Bitwise XOR timing may vary based on operands"),
        ]),
    ])
}

const JS_FUNCTION_ERRORS: &[(&str, &str)] = &[
    ("math.sqrt", "Math.sqrt() has variable latency based on operand values"),
    ("math.pow", "Math.pow() has variable latency based on operand values"),
    ("eval", "eval() has unpredictable timing characteristics"),
    ("math.random", "Math.random() is predictable; use crypto.getRandomValues() instead"),
];

const JS_FUNCTION_WARNINGS: &[(&str, &str)] = &[
    ("localecompare", "localeCompare() has variable-time execution"),
    ("indexof", "indexOf() has early-terminating behavior"),
    ("includes", "includes() has early-terminating behavior"),
    ("startswith", "startsWith() has early-terminating behavior"),
    ("endswith", "endsWith() has early-terminating behavior"),
    ("search", "search() has variable-time execution"),
    ("match", "match() has variable-time execution"),
    ("textencoder", "TextEncoder may leak data length via timing; ensure fixed-length output"),
    ("textdecoder", "TextDecoder may leak data length via timing; ensure fixed-length input"),
    ("json.stringify", "JSON.stringify() produces variable-length output that may leak information"),
    ("json.parse", "JSON.parse() timing may vary based on input length/structure"),
    ("btoa", "btoa() produces variable-length output based on input"),
    ("atob", "atob() timing may vary based on input length"),
    ("encodeuricomponent", "encodeURIComponent() produces variable-length output"),
    ("decodeuricomponent", "decodeURIComponent() timing may vary based on input"),
];

/// Comment bodies blanked to spaces, offsets and line breaks kept, string literals left alone (a comment marker in a
/// string is not a comment). A regex, not a lexer: regex literals like `/=/` are not modelled.
fn blank_comments(source: &str) -> String {
    let re = Regex::new(r#""""(?:\\.|[^\\])*?"""|'''(?:\\.|[^\\])*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`|//[^\n]*|/\*[\s\S]*?\*/"#).unwrap();
    re.replace_all(source, |m: &regex::Captures| {
        let s = &m[0];
        if s.starts_with(['"', '\'', '`']) { s.to_string() } else { s.chars().map(|c| if c == '\n' { '\n' } else { ' ' }).collect() }
    })
    .into_owned()
}

const JS_KEYWORDS: &[&str] = &["if", "for", "while", "switch", "catch", "do", "else", "return", "typeof", "function", "class", "new", "await", "yield"];

/// the names a file declares, to drop node's own functions from V8's dump (names are all V8 gives us)
fn declared_function_names(source: &str) -> HashSet<String> {
    let blanked = blank_comments(source);
    let patterns = [
        r"\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)",
        r"\bclass\s+([A-Za-z_$][\w$]*)",
        r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=",
        r"([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:function|\()",
        // method shorthand, anywhere on a line; over-capture is the safer error
        r"(?:static\s+|async\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{",
    ];
    let mut names = HashSet::new();
    for p in patterns {
        for m in Regex::new(p).unwrap().captures_iter(&blanked) {
            if !JS_KEYWORDS.contains(&&m[1]) {
                names.insert(m[1].to_string());
            }
        }
    }
    names
}

/// the line of a character offset (V8 counts characters, not bytes), or None past the end
fn line_of_offset(source: &str, offset: usize) -> Option<usize> {
    let mut lines = 1;
    let mut seen = 0;
    for c in source.chars() {
        if seen == offset {
            return Some(lines);
        }
        if c == '\n' {
            lines += 1;
        }
        seen += 1;
    }
    (seen == offset).then_some(lines)
}

fn line_at(source: &str, byte: usize) -> usize {
    source[..byte].matches('\n').count() + 1
}

fn parse_v8_bytecode(output: &str, file: &str, include_warnings: bool, func: Option<&str>, compiled: Option<&str>, map_positions: bool) -> Result<Parsed, String> {
    let mut functions: Vec<Func> = Vec::new();
    let mut violations = Vec::new();
    let mut current: Option<String> = None;
    let mut in_section = false;
    let filter = match func.filter(|f| !f.is_empty()) {
        Some(f) => Some(Regex::new(f).map_err(|e| format!("Invalid regular expression: /{f}/: {e}"))?),
        None => None,
    };
    // None = the compiled file could not be read, which is not "declares nothing": nothing is filtered then
    let declared = match compiled {
        None => {
            eprintln!("Note: could not read the compiled JavaScript, so node-internal functions cannot be filtered out of the bytecode findings");
            None
        }
        Some(c) => Some(declared_function_names(c)),
    };
    let header = Regex::new(r"^\[generated bytecode for function:\s*([^\s(]+)").unwrap();
    //    67 E> 0x17461d981ece @   14 : 3e 03 04          Div a0, [4]
    let bytecode = Regex::new(r"^(?:(\d+)\s+[SE]>\s*)?(?:0x[0-9a-fA-F]+\s*@\s*)?(\d+)\s*:\s*(?:(?:[0-9a-f]{2}\s+)+)?([A-Za-z][A-Za-z0-9]*)\s*(.*)").unwrap();
    let (errors, warnings) = (js_bytecode_errors(), js_bytecode_warnings());
    for raw in output.split('\n') {
        let l = raw.trim();
        if let Some(m) = header.captures(l) {
            let name = m[1].trim().to_string();
            if !name.is_empty() && !name.starts_with("__") {
                if declared.as_ref().is_some_and(|d| !d.contains(&name)) {
                    current = None;
                    in_section = false;
                    continue;
                }
                current = Some(name.clone());
                functions.push(Func { name, instructions: 0 });
                in_section = true;
            }
            continue;
        }
        if l.starts_with('[') && l.to_lowercase().contains("bytecode") {
            in_section = false;
            continue;
        }
        if !in_section {
            continue;
        }
        if ["Bytecode length:", "Parameter count", "Register count", "Frame size", "Constant pool", "Handler Table"].iter().any(|x| l.starts_with(x)) {
            continue;
        }
        let Some(bm) = bytecode.captures(l) else { continue };
        // V8's position is an offset into the compiled file, turned into a line only when that file is the source
        let source_line = match (map_positions, compiled, bm.get(1)) {
            (true, Some(c), Some(p)) if !c.is_empty() => p.as_str().parse().ok().and_then(|o| line_of_offset(c, o)),
            _ => None,
        };
        let (offset, instruction, operands) = (&bm[2], &bm[3], bm[4].trim());
        if let Some(f) = functions.last_mut() {
            f.instructions += 1;
        }
        if let (Some(re), Some(cur)) = (&filter, &current) {
            if !re.is_match(cur) {
                continue;
            }
        }
        let lower = instruction.to_lowercase();
        let at = |reason: &str, severity: &'static str| Violation {
            function: current.clone().unwrap_or_else(|| "<anonymous>".into()),
            file: file.into(),
            line: source_line,
            address: offset.into(),
            instruction: format!("{instruction} {operands}").trim().to_string(),
            mnemonic: instruction.to_uppercase(),
            reason: reason.into(),
            severity,
        };
        if let Some(r) = lookup(&errors, &lower) {
            violations.push(at(r, ERROR));
        } else if let Some(r) = lookup(&warnings, &lower).filter(|_| include_warnings) {
            violations.push(at(r, WARNING));
        }
    }
    Ok(Parsed { functions, violations })
}

/// calls and operators found in the source (V8's bytecode doesn't name callees)
fn detect_dangerous_calls(file: &str, include_warnings: bool) -> Vec<Violation> {
    let mut out = Vec::new();
    let Ok(text) = fs::read_to_string(file) else { return out };
    let source = blank_comments(&text);
    let at = |out: &mut Vec<Violation>, index: usize, instruction: &str, mnemonic: String, reason: &str, severity: &'static str| {
        out.push(Violation { function: "<source>".into(), file: file.into(), line: Some(line_at(&source, index)), address: String::new(), instruction: instruction.into(), mnemonic, reason: reason.into(), severity });
    };
    for (name, reason) in JS_FUNCTION_ERRORS {
        for m in Regex::new(&format!(r"(?i)\b{}\s*\(", regex::escape(name))).unwrap().find_iter(&source) {
            at(&mut out, m.start(), m.as_str(), name.to_uppercase().replace('.', "_"), reason, ERROR);
        }
    }
    let line_of = |index: usize| -> &str {
        let start = source[..index].rfind('\n').map(|i| i + 1).unwrap_or(0);
        let end = source[index..].find('\n').map(|i| index + i).unwrap_or(source.len());
        source[start..end].trim()
    };
    // a / b and a % b, not // comments or /= and %=
    for m in Regex::new(r"[^/]\s*/\s*[^/=*]").unwrap().find_iter(&source) {
        let l = line_of(m.start());
        if l.starts_with("//") || l.starts_with('*') {
            continue;
        }
        at(&mut out, m.start(), "/", "DIV_OP".into(), "Division operator has variable-time execution", ERROR);
    }
    for m in Regex::new(r"\s%\s*[^=]").unwrap().find_iter(&source) {
        let l = line_of(m.start());
        if l.starts_with("//") || l.starts_with('*') {
            continue;
        }
        at(&mut out, m.start(), "%", "MOD_OP".into(), "Modulo operator has variable-time execution", ERROR);
    }
    if include_warnings {
        for (name, reason) in JS_FUNCTION_WARNINGS {
            // `(?:\.|\b)`: method calls and globals both
            for m in Regex::new(&format!(r"(?i)(?:\.|\b){}\s*\(", regex::escape(name))).unwrap().find_iter(&source) {
                at(&mut out, m.start(), m.as_str(), name.to_uppercase(), reason, WARNING);
            }
        }
    }
    out
}

fn analyze_javascript(file: &str, include_warnings: bool, func: Option<&str>) -> Result<Value, String> {
    let node = "node";
    let mut cmd = Command::new(node);
    cmd.args(["--no-lazy", "--print-bytecode"]);
    if let Some(f) = func {
        cmd.args(["--print-bytecode-filter", f]);
    }
    let r = cmd.arg(file).output().map_err(|_| format!("Failed to get V8 bytecode: Node.js not found: {node}"))?;
    let compiled = fs::read_to_string(file).ok();
    let Parsed { functions, mut violations } = parse_v8_bytecode(&String::from_utf8_lossy(&r.stdout), file, include_warnings, func, compiled.as_deref(), true)?;
    // The two passes name one operator differently (DIV vs DIV_OP): a source finding on a line the bytecode already
    // reported is dropped, keeping the one that names its function.
    let equivalents = |m: &str| -> &'static [&'static str] {
        match m {
            "DIV_OP" => &["DIV", "DIVSMI"],
            "MOD_OP" => &["MOD", "MODSMI"],
            _ => &[],
        }
    };
    let existing: HashSet<(Option<usize>, String)> = violations.iter().map(|v| (v.line, v.mnemonic.clone())).collect();
    for v in detect_dangerous_calls(file, include_warnings) {
        if existing.contains(&(v.line, v.mnemonic.clone())) {
            continue;
        }
        if v.line.is_some() && equivalents(&v.mnemonic).iter().any(|m| existing.contains(&(v.line, m.to_string()))) {
            continue;
        }
        violations.push(v);
    }
    Ok(report("v8", "node", "default", file, Parsed { functions, violations }))
}

// ---- entry ---------------------------------------------------------------------------------------------------------

/// Node's path.resolve(): absolute and `.`/`..` folded, symlinks left as they are
fn abs_path(p: &str) -> PathBuf {
    let path = Path::new(p);
    let abs = if path.is_absolute() { path.to_path_buf() } else { std::env::current_dir().unwrap().join(path) };
    let mut out = PathBuf::new();
    for c in abs.components() {
        match c {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

struct Opts {
    file: Option<String>,
    arch: Option<String>,
    compiler: Option<String>,
    opt: String,
    warnings: bool,
    func: Option<String>,
    format: &'static str,
    assembly: bool,
    list_arch: bool,
    extra: Vec<String>,
}

fn analyze_source(a: &Opts, file: &str) -> Result<Value, String> {
    if !Path::new(file).exists() {
        return Err(format!("Source file not found: {file}"));
    }
    let language = detect_language(file);
    if language == "javascript" {
        return analyze_javascript(&abs_path(file).display().to_string(), a.warnings, a.func.as_deref());
    }
    if language != "rust" {
        return Err(format!("No analyzer available for language: {language} (this copy covers Rust and JavaScript; pass --assembly for a listing)"));
    }
    let arch = normalize_arch(&a.arch.clone().unwrap_or_else(native_arch));
    let rustc = a.compiler.as_deref().unwrap_or("rustc");
    if !available(rustc) {
        return Err(format!("Compiler not available: {rustc}"));
    }
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("ct-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let result = (|| {
        let asm = dir.join("out.s");
        rust_to_assembly(&abs_path(file), &asm, &arch, &a.opt, &a.extra, rustc).map_err(|e| format!("Compilation failed: {e}"))?;
        let text = fs::read_to_string(&asm).map_err(|e| e.to_string())?;
        let parsed = filter_by(a.func.as_deref(), parse_assembly(&text, &arch, a.warnings))?;
        // the binary that ran, not its family
        Ok(report(&arch, rustc, &a.opt, file, parsed))
    })();
    let _ = fs::remove_dir_all(&dir);
    result
}

fn format_report(r: &Value, format: &str) -> String {
    let s = |k: &str| r[k].as_str().unwrap_or("").to_string();
    let n = |k: &str| r[k].as_u64().unwrap_or(0);
    let violations = r["violations"].as_array().cloned().unwrap_or_default();
    let line_of = |v: &Value| v["line"].as_u64().filter(|l| *l != 0);
    if format == "json" {
        return crate::util::pretty(r);
    }
    if format == "github" {
        return violations
            .iter()
            .map(|v| {
                let file = v["file"].as_str().unwrap_or("");
                format!(
                    "::{} {}{}::{} in {}: {}",
                    if v["severity"] == ERROR { "error" } else { "warning" },
                    if file.is_empty() { String::new() } else { format!("file={file}") },
                    line_of(v).map(|l| format!(",line={l}")).unwrap_or_default(),
                    v["mnemonic"].as_str().unwrap_or(""),
                    v["function"].as_str().unwrap_or(""),
                    v["reason"].as_str().unwrap_or("")
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
    }
    let rule = "=".repeat(60);
    let dash = "-".repeat(40);
    let mut lines = vec![rule.clone(), "Constant-Time Analysis Report".into(), rule];
    lines.extend([
        format!("Source: {}", s("source_file")),
        format!("Architecture: {}", s("architecture")),
        format!("Compiler: {}", s("compiler")),
        format!("Optimization: {}", s("optimization")),
        format!("Functions analyzed: {}", n("total_functions")),
        format!("Instructions analyzed: {}", n("total_instructions")),
        String::new(),
    ]);
    if violations.is_empty() {
        lines.push("No violations found.".into());
    } else {
        lines.extend(["VIOLATIONS FOUND:".to_string(), dash.clone()]);
        for v in &violations {
            let g = |k: &str| v[k].as_str().unwrap_or("").to_string();
            lines.push(format!("[{}] {}", if v["severity"] == ERROR { "ERROR" } else { "WARN" }, g("mnemonic")));
            lines.push(format!("  Function: {}", g("function")));
            if !g("file").is_empty() {
                lines.push(format!("  File: {}{}", g("file"), line_of(v).map(|l| format!(":{l}")).unwrap_or_default()));
            }
            if !g("address").is_empty() {
                lines.push(format!("  Address: {}", g("address")));
            }
            lines.push(format!("  Reason: {}", g("reason")));
            lines.push(String::new());
        }
    }
    lines.extend([dash, format!("Result: {}", if r["passed"] == true { "PASSED" } else { "FAILED" }), format!("Errors: {}, Warnings: {}", n("error_count"), n("warning_count"))]);
    lines.join("\n")
}

fn parse_args(argv: &[String]) -> Result<Opts, String> {
    let mut a = Opts { file: None, arch: None, compiler: None, opt: "O2".into(), warnings: false, func: None, format: "text", assembly: false, list_arch: false, extra: Vec::new() };
    let mut i = 0;
    while i < argv.len() {
        let (x, inline) = match argv[i].split_once('=').filter(|_| argv[i].starts_with("--")) {
            Some((k, v)) => (k.to_string(), Some(v.to_string())),
            None => (argv[i].clone(), None),
        };
        let mut value = || -> Result<String, String> {
            if let Some(v) = inline.clone() {
                return Ok(v);
            }
            i += 1;
            argv.get(i).cloned().ok_or(format!("{x} needs a value"))
        };
        match x.as_str() {
            "--arch" | "-a" => a.arch = Some(value()?),
            "--compiler" | "-c" => a.compiler = Some(value()?),
            "--opt-level" | "-O" => a.opt = value()?,
            "--func" | "-f" => a.func = Some(value()?),
            "--extra-flags" | "-X" => a.extra.push(value()?),
            "--warnings" | "-w" => a.warnings = true,
            "--json" => a.format = "json",
            "--github" => a.format = if a.format == "json" { "json" } else { "github" },
            "--assembly" => a.assembly = true,
            "--list-arch" => a.list_arch = true,
            o if o.starts_with('-') => return Err(format!("unknown option {o}")),
            _ => a.file = Some(argv[i].clone()),
        }
        i += 1;
    }
    if a.file.is_none() && !a.list_arch {
        return Err("usage: sec ct [options] <source_file>".into());
    }
    Ok(a)
}

const HELP: &str = "usage: sec ct [options] <source_file>

Variable-time instructions in a Rust file's assembly (built with rustc), a JavaScript file's V8 bytecode (with a
source scan), or an assembly listing.

options:
  -a, --arch <arch>          target architecture (x86_64, arm64, arm, riscv64, ppc64le, s390x, i386; default: native)
  -c, --compiler <path>      the rustc to build with (default: rustc)
  -O, --opt-level <level>    O0, O1, O2, O3, Os or Oz (default: O2)
  -w, --warnings             also report warning-severity findings (branches, comparisons, lookups, encoding)
  -f, --func <regex>         only functions whose name matches
  -X, --extra-flags <flag>   an extra compiler flag (repeatable)
      --json                 JSON output
      --github               GitHub Actions annotations
      --assembly             read <source_file> as an assembly listing (needs --arch)
      --list-arch            list the architectures and their instruction counts
  -h, --help                 show this help";

pub fn main(argv: &[String]) -> i32 {
    if argv.iter().any(|x| x == "-h" || x == "--help") {
        println!("{HELP}");
        return 0;
    }
    let a = match parse_args(argv) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            return 2;
        }
    };
    if a.list_arch {
        println!("Supported Architectures:\n{}", "=".repeat(40));
        for t in dangerous_instructions() {
            println!("\n{}:\n  Errors: {}\n  Warnings: {}", t.name, t.errors.len(), t.warnings.len());
        }
        return 0;
    }
    let file = a.file.clone().unwrap_or_default();
    let result = if a.assembly {
        let Some(arch) = &a.arch else {
            eprintln!("Error: --arch is required when analyzing assembly files");
            return 1;
        };
        analyze_assembly(&file, arch, a.warnings, a.func.as_deref())
    } else {
        analyze_source(&a, &file)
    };
    match result {
        Ok(r) => {
            println!("{}", format_report(&r, a.format));
            if r["passed"] == true { 0 } else { 1 }
        }
        Err(e) => {
            if a.format == "json" {
                // json.dumps' separators
                println!("{{\"error\": {}}}", serde_json::to_string(&e).unwrap());
            } else {
                eprintln!("Error: {e}");
            }
            1
        }
    }
}
