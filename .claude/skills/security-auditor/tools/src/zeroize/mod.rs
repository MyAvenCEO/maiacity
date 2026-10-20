//! The zeroize skill's Rust track: source, MIR, LLVM IR, assembly and rustdoc checks for secrets that are never wiped
//! or are copied where no wipe reaches them, and the tools that emit and compare those artifacts. Ports of Trail of
//! Bits' zeroize-audit tools (trailofbits/skills, CC-BY-SA 4.0); each keeps its original's rules, finding ids and
//! messages (the messages still name the original script, so its docs read the same).

pub mod apis;
pub mod asm;
pub mod diff_mir;
pub mod emit;
pub mod gates;
pub mod llvm;
pub mod mir;
pub mod semantic;
pub mod toolchain;

use crate::obj;
use serde_json::Value;
use std::path::Path;

/// The finding shape the source, MIR and IR scans share; `source` names the evidence (source_grep, mir_text, llvm_ir).
#[allow(clippy::too_many_arguments)]
pub fn finding(id: String, category: &str, severity: &str, confidence: &str, detail: &str, symbol: &str, file: &str, line: usize, source: &str) -> Value {
    obj! {
        "id" => id,
        "language" => "rust",
        "category" => category,
        "severity" => severity,
        "confidence" => confidence,
        "detail" => detail,
        "symbol" => symbol,
        "location" => obj! { "file" => file, "line" => line },
        "evidence" => vec![obj! { "source" => source, "detail" => detail }],
    }
}

/// `out_path.parent.mkdir(parents=True); out_path.write_text(json.dumps(findings, indent=2))`
pub fn write_findings(out: &str, findings: &[Value]) -> std::io::Result<()> {
    crate::util::write_json(Path::new(out), &Value::Array(findings.to_vec()))
}

/// A fancy (lookaround) regex's search, which only fails on a pathological backtrack: then no match.
pub fn fancy_hit(re: &fancy_regex::Regex, text: &str) -> bool {
    re.is_match(text).unwrap_or(false)
}
