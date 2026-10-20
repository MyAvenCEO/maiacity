//! `sec zeroize-gates`: the report's confidence gates applied mechanically. An OPTIMIZED_AWAY_ZEROIZE finding with no
//! IR/ASM compiler evidence, a STACK_RETENTION or REGISTER_SPILL finding whose evidence never names assembly, and
//! (with --require-mcp-for-advanced and no --mcp-available) a SECRET_COPY, MISSING_ON_ERROR_PATH or
//! NOT_DOMINATING_EXITS finding are each marked needs_review, the reason added to their evidence. Port of
//! mcp/apply_confidence_gates.py.
//!
//!   sec zeroize-gates --input <output.json> --out <gated.json> [--mcp-available] [--require-mcp-for-advanced]

use crate::util::{Args, Opt, pretty, req, switch, truthy};
use serde_json::Value;
use std::path::Path;

const ADVANCED_MCP: &[&str] = &["SECRET_COPY", "MISSING_ON_ERROR_PATH", "NOT_DOMINATING_EXITS"];
const ASM_REQUIRED: &[&str] = &["STACK_RETENTION", "REGISTER_SPILL"];

fn has_compiler_evidence(f: &Value) -> bool {
    f.get("compiler_evidence").and_then(Value::as_object).is_some_and(|ce| ["o0", "o2", "diff_summary"].iter().any(|k| truthy(ce.get(*k))))
}

fn gate(f: &mut Value, reason: &str) -> Result<(), String> {
    // the original adds the reason to `evidence` as it stands, so only a string or no evidence at all can take it
    let evidence = match f.get("evidence") {
        None => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(_) => return Err("a finding's evidence is not a string".into()),
    };
    f["needs_review"] = Value::Bool(true);
    f["evidence"] = Value::String(format!("{evidence} {reason}").trim().to_string());
    Ok(())
}

fn apply(report: &mut Value, mcp_available: bool, require_mcp: bool) -> Result<(), String> {
    let mut none = Vec::new();
    let findings = match report.get_mut("findings") {
        None => &mut none,
        Some(Value::Array(a)) => a,
        // an empty string or object holds no findings, as the original iterates it
        Some(v @ (Value::String(_) | Value::Object(_))) if !truthy(Some(v)) => &mut none,
        Some(_) => return Err("findings is not a list".into()),
    };
    for f in findings.iter_mut() {
        if !f.is_object() {
            return Err("a finding is not an object".into());
        }
        let category = f.get("category").and_then(Value::as_str).unwrap_or("").to_string();
        // the gates read the evidence as it came in, before any reason is added
        let evidence = match f.get("evidence") {
            Some(Value::String(s)) => s.to_lowercase(),
            v if truthy(v) => return Err("a finding's evidence is not a string".into()),
            _ => String::new(),
        };
        if category == "OPTIMIZED_AWAY_ZEROIZE" && !has_compiler_evidence(f) {
            gate(f, "[gated: missing IR/ASM evidence for optimized-away claim]")?;
        }
        if ASM_REQUIRED.contains(&category.as_str()) && !evidence.contains("asm") {
            gate(f, "[gated: missing assembly evidence]")?;
        }
        if require_mcp && !mcp_available && ADVANCED_MCP.contains(&category.as_str()) {
            gate(f, "[gated: MCP unavailable for advanced semantic finding]")?;
        }
    }
    let count = findings.len();
    if let Some(summary) = report.get_mut("summary").and_then(Value::as_object_mut) {
        summary.insert("issues_found".into(), count.into());
    }
    Ok(())
}

pub fn main(argv: &[String]) -> i32 {
    const SPEC: [Opt; 4] = [req("input"), req("out"), switch("mcp-available"), switch("require-mcp-for-advanced")];
    let a = Args::parse("sec zeroize-gates", argv, &SPEC, 0);
    let input = a.str("input");
    let mut report: Value = match std::fs::read_to_string(input).map_err(|e| e.to_string()).and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string())) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Error: cannot read {input}: {e}");
            return 1;
        }
    };
    if !report.is_object() {
        let kind = match report {
            Value::Array(_) => "list",
            Value::String(_) => "str",
            Value::Bool(_) => "bool",
            Value::Number(ref n) if n.is_f64() => "float",
            Value::Number(_) => "int",
            _ => "NoneType",
        };
        eprintln!("Error: expected JSON object in {input}, got {kind}");
        return 1;
    }
    if let Err(e) = apply(&mut report, a.on("mcp-available"), a.on("require-mcp-for-advanced")) {
        eprintln!("Error: {e}");
        return 1;
    }
    let out = Path::new(a.str("out"));
    if let Some(parent) = out.parent().filter(|p| !p.as_os_str().is_empty()) {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(out, pretty(&report) + "\n") {
        eprintln!("Error: cannot write {}: {e}", out.display());
        return 1;
    }
    println!("OK: wrote gated report to {}", crate::util::py_path(a.str("out")));
    0
}
