//! `sec zeroize-toolchain`: the Rust track's preflight. cargo and its nightly toolchain are required; cargo-expand
//! (macro debugging) is optional; with --manifest the crate must also pass `cargo +nightly check`. Port of
//! validate_rust_toolchain.sh, without its uv and script checks (every analysis is a command of this binary, so
//! there is no interpreter or script to find) and without rustfilt (`sec zeroize-asm` demangles symbols itself).
//!
//!   sec zeroize-toolchain [--manifest <Cargo.toml>] [--json]
//! exit 0 ready (warnings may remain), 1 blocked, 2 argument error

use crate::obj;
use crate::util::pretty;
use serde_json::{Map, Value};
use std::path::Path;
use std::process::Command;

const TOOLS: &[(&str, bool, &str)] = &[("cargo", true, ""), ("cargo-expand", false, "macro expansion debugging")];

/// (present, the first line of `--version`, or None when it failed)
fn version(cmd: &str, args: &[&str]) -> (bool, Option<String>) {
    match Command::new(cmd).args(args).output() {
        Err(_) => (false, None),
        Ok(o) if o.status.success() => (true, Some(String::from_utf8_lossy(&o.stdout).lines().next().unwrap_or("").to_string())),
        Ok(_) => (true, None),
    }
}

pub fn main(argv: &[String]) -> i32 {
    let (mut manifest, mut json) = (String::new(), false);
    let mut i = 0;
    while i < argv.len() {
        match argv[i].as_str() {
            "--manifest" => match argv.get(i + 1).filter(|v| !v.is_empty()) {
                Some(v) => {
                    manifest = v.clone();
                    i += 1;
                }
                None => {
                    eprintln!("validate_rust_toolchain.sh: missing value for --manifest");
                    return 2;
                }
            },
            "--json" => json = true,
            "--help" | "-h" => {
                println!("Usage:\n  sec zeroize-toolchain [options]\n\nOptions:\n  --manifest <Cargo.toml>  Check that the manifest exists and the crate builds\n  --json                   Output machine-readable JSON (default: human-readable)\n  --help                   Show this help text\n\nChecks (required):\n  - cargo on PATH\n  - cargo +nightly available\n\nChecks (optional, warning only):\n  - cargo-expand on PATH (for macro expansion debugging)\n\nIf --manifest is provided, additionally:\n  - Manifest file exists\n  - cargo check passes for the crate");
                return 0;
            }
            other => {
                eprintln!("validate_rust_toolchain.sh: unknown argument: {other}");
                return 2;
            }
        }
        i += 1;
    }

    let (mut errors, mut warnings): (Vec<String>, Vec<String>) = (Vec::new(), Vec::new());
    let mut tools = Map::new();
    let mut cargo_present = false;
    for (name, required, purpose) in TOOLS {
        let (present, ver) = version(name, &["--version"]);
        if present {
            if ver.is_none() {
                warnings.push(format!("{name} is present but '--version' failed — tool may be broken"));
            }
        } else if *required {
            errors.push(format!("{name} is required but not found on PATH"));
        } else {
            warnings.push(format!("{name} is not found on PATH (optional: {purpose})"));
        }
        if *name == "cargo" {
            cargo_present = present;
        }
        let version = if present { ver.unwrap_or_else(|| "(version check failed)".into()) } else { "unknown".into() };
        tools.insert(name.to_string(), obj! { "status" => if present { "present" } else { "missing" }, "version" => version });
    }

    let (mut nightly, mut nightly_version) = ("unavailable", "unknown".to_string());
    if cargo_present {
        match version("cargo", &["+nightly", "--version"]) {
            (true, Some(v)) => {
                nightly = "available";
                nightly_version = v;
            }
            _ => errors.push("cargo +nightly is required but the nightly toolchain is not installed (run: rustup toolchain install nightly)".into()),
        }
    }

    let (mut manifest_status, mut build) = ("not_checked", "not_checked");
    if !manifest.is_empty() {
        if Path::new(&manifest).is_file() {
            manifest_status = "present";
            if nightly == "available" {
                // stderr kept to report the first 20 lines
                match Command::new("cargo").args(["+nightly", "check", "--manifest-path", &manifest]).output() {
                    Ok(o) if o.status.success() => build = "pass",
                    result => {
                        build = "fail";
                        let err = result.map(|o| String::from_utf8_lossy(&o.stderr).into_owned()).unwrap_or_default();
                        let snippet: String = err.lines().take(20).map(|l| format!("{l} ")).collect();
                        errors.push(format!("cargo check failed for {manifest}: {}", if snippet.is_empty() { "see stderr".into() } else { snippet }));
                    }
                }
            } else {
                build = "skipped";
                warnings.push("cargo check skipped (nightly not available)".into());
            }
        } else {
            manifest_status = "missing";
            errors.push(format!("manifest not found: {manifest}"));
        }
    }

    let status = if errors.is_empty() { "ready" } else { "blocked" };
    if json {
        println!(
            "{}",
            pretty(&obj! {
                "status" => status,
                "tools" => Value::Object(tools),
                "nightly" => obj! { "status" => nightly, "version" => nightly_version },
                "manifest" => obj! { "status" => manifest_status, "build" => build },
                "errors" => errors,
                "warnings" => warnings,
            })
        );
    } else {
        println!("=== Rust Toolchain Validation ===\n\nTools:");
        for (name, _, _) in TOOLS {
            let t = &tools[*name];
            if t["status"] == "present" {
                println!("  [OK]   {name} ({})", t["version"].as_str().unwrap_or(""));
            } else {
                println!("  [MISS] {name}");
            }
        }
        println!("\nNightly: {nightly} ({nightly_version})");
        if !manifest.is_empty() {
            println!("\nManifest: {manifest} ({manifest_status})\nBuild:    {build}");
        }
        if !errors.is_empty() {
            println!("\nERRORS:");
            errors.iter().for_each(|e| println!("  - {e}"));
        }
        if !warnings.is_empty() {
            println!("\nWARNINGS:");
            warnings.iter().for_each(|w| println!("  - {w}"));
        }
        println!("\nOverall: {status}");
    }
    if status == "ready" { 0 } else { 1 }
}
