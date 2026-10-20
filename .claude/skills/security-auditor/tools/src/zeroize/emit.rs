//! `sec zeroize-emit-mir`, `zeroize-emit-ir`, `zeroize-emit-asm`: a crate's MIR, LLVM IR or assembly at one
//! optimization level, built by `cargo +nightly rustc` and written to one file (or, for MIR and assembly, copied
//! into a folder). Ports of emit_rust_mir.sh, emit_rust_ir.sh and emit_rust_asm.sh.
//!
//!   sec zeroize-emit-mir --manifest <Cargo.toml> --out <file.mir|dir> [--opt O0] [--crate <pkg>] [--bin <t>|--lib] [--target-dir <dir>] [-- <cargo rustc args>]
//!   sec zeroize-emit-ir  --manifest <Cargo.toml> --out <file.ll>      [--opt O2] ...
//!   sec zeroize-emit-asm --manifest <Cargo.toml> --out <file.s|dir>   [--opt O2] [--target <triple>] [--intel-syntax] ...
//! exit 0 written, 1 build or output failure, 2 argument error
//!
//! Two changes from the originals. They built each run in a fresh `$TMPDIR/zeroize_rust_*` folder, every dependency
//! again, and left it there (33 MB a run for a one-file crate, gigabytes for avenDB); here every run shares one
//! folder, the crate's own `<target>/zeroize` unless --target-dir names another, so dependencies are built once and
//! only the crate itself again. And they gathered every file of the kind under that folder, which in today's cargo
//! layout is the output plus the incremental cache's copy, so IR and assembly came out twice over; here rustc writes
//! the output straight to `<folder>/zeroize-emit/<kind>-O<n>-<settings hash>.<ext>`, one path per set of settings,
//! so a unit cargo finds fresh still has its own output there.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Mir,
    Ir,
    Asm,
}

impl Kind {
    fn script(self) -> &'static str {
        match self {
            Kind::Mir => "emit_rust_mir.sh",
            Kind::Ir => "emit_rust_ir.sh",
            Kind::Asm => "emit_rust_asm.sh",
        }
    }
    fn ext(self) -> &'static str {
        match self {
            Kind::Mir => "mir",
            Kind::Ir => "ll",
            Kind::Asm => "s",
        }
    }
    fn usage(self) -> String {
        let s = self.script();
        match self {
            Kind::Mir => format!("Usage:\n  {s} --manifest <Cargo.toml> --out <path> [options] [-- <extra cargo rustc args>]\n\nOptions:\n  --manifest <file>        Cargo manifest path (required)\n  --out <path>             Output .mir file or directory (required)\n  --opt <O0|O1|O2|O3>      Opt level (default: O0)\n  --crate <pkg>            Workspace package (-p)\n  --bin <target>           Build only a specific bin target\n  --lib                    Build only the lib target\n  --target-dir <dir>       Build folder, shared by every run (default: <target>/zeroize)\n  --help                   Show this help text"),
            Kind::Ir => format!("Usage:\n  {s} --manifest <Cargo.toml> --out <path> [options] [-- <extra cargo rustc args>]\n\nOptions:\n  --manifest <file>        Cargo manifest path (required)\n  --out <path>             Output .ll file (required)\n  --opt <O0|O1|O2|O3>      Opt level (default: O2)\n  --crate <pkg>            Workspace package (-p)\n  --bin <target>           Build only a specific bin target\n  --lib                    Build only the lib target\n  --target-dir <dir>       Build folder, shared by every run (default: <target>/zeroize)\n  --help                   Show this help text"),
            Kind::Asm => format!("Usage:\n  {s} --manifest <Cargo.toml> --out <path> [options] [-- <extra cargo rustc args>]\n\nOptions:\n  --manifest <file>        Cargo manifest path (required)\n  --out <path>             Output .s file or directory (required)\n  --opt <O0|O1|O2|O3>      Opt level (default: O2)\n  --crate <pkg>            Workspace package (-p)\n  --bin <target>           Build only a specific bin target\n  --lib                    Build only the lib target\n  --target <triple>        Cross-compile target (e.g. x86_64-unknown-linux-gnu)\n  --intel-syntax           Emit Intel syntax instead of AT&T (default: AT&T)\n  --target-dir <dir>       Build folder, shared by every run (default: <target>/zeroize)\n  --help                   Show this help text"),
        }
    }
}

/// FNV-1a, 64 bits: a name for a set of settings that stays the same from one run and one build of this tool to the next
fn fnv(parts: &[String]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in parts.join("\0").bytes() {
        h = (h ^ b as u64).wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// cargo's target folder for this manifest (CARGO_TARGET_DIR and cargo's config included), the package's name and its
/// lib target's name (rustdoc names its JSON after that), both with `-` as `_`
fn metadata(manifest: &str, crate_: &str) -> Result<(String, String, String), String> {
    let o = Command::new("cargo").args(["metadata", "--no-deps", "--format-version", "1", "--manifest-path", manifest]).output().map_err(|e| format!("cannot run cargo metadata: {e}"))?;
    if !o.status.success() {
        return Err(format!("cargo metadata failed: {}", String::from_utf8_lossy(&o.stderr).trim()));
    }
    let v: serde_json::Value = serde_json::from_slice(&o.stdout).map_err(|e| format!("cargo metadata: {e}"))?;
    let target = v["target_directory"].as_str().ok_or("cargo metadata named no target folder")?.to_string();
    let here = fs::canonicalize(manifest).ok();
    let packages = v["packages"].as_array().cloned().unwrap_or_default();
    let package = packages.iter().find(|p| if crate_.is_empty() { here.is_some() && p["manifest_path"].as_str().and_then(|m| fs::canonicalize(m).ok()) == here } else { p["name"] == crate_ });
    let name = package.and_then(|p| p["name"].as_str()).unwrap_or(if crate_.is_empty() { "crate" } else { crate_ }).replace('-', "_");
    let lib = package
        .and_then(|p| p["targets"].as_array())
        .and_then(|ts| ts.iter().find(|t| t["kind"].as_array().is_some_and(|k| k.iter().any(|k| k.as_str().is_some_and(|k| k.ends_with("lib") || k == "proc-macro")))))
        .and_then(|t| t["name"].as_str())
        .map(|n| n.replace('-', "_"))
        .unwrap_or_else(|| name.clone());
    Ok((target, name, lib))
}

fn run(kind: Kind, argv: &[String]) -> Result<(), (i32, String)> {
    let script = kind.script();
    let arg = |m: String| (2, m);
    let fail = |m: String| (1, m);
    let (mut manifest, mut out, mut crate_, mut bin, mut lib, mut triple, mut intel, mut target_dir) = (String::new(), String::new(), String::new(), String::new(), false, String::new(), false, String::new());
    let mut opt = if kind == Kind::Mir { "O0".to_string() } else { "O2".to_string() };
    let mut extra: Vec<String> = Vec::new();
    let mut i = 0;
    while i < argv.len() {
        let x = argv[i].as_str();
        let mut value = || -> Result<String, (i32, String)> {
            match argv.get(i + 1).filter(|v| !v.is_empty()) {
                Some(v) => {
                    i += 2;
                    Ok(v.clone())
                }
                None => Err(arg(format!("missing value for {x}"))),
            }
        };
        match x {
            "--manifest" => manifest = value()?,
            "--out" => out = value()?,
            "--opt" => opt = value()?,
            "--crate" => crate_ = value()?,
            "--bin" => bin = value()?,
            "--target" if kind == Kind::Asm => triple = value()?,
            "--target-dir" => target_dir = value()?,
            "--lib" => {
                lib = true;
                i += 1;
            }
            "--intel-syntax" if kind == Kind::Asm => {
                intel = true;
                i += 1;
            }
            "--help" | "-h" => {
                println!("{}", kind.usage());
                std::process::exit(0);
            }
            "--" => {
                extra = argv[i + 1..].to_vec();
                break;
            }
            other => return Err(arg(format!("unknown argument: {other}"))),
        }
    }
    if manifest.is_empty() {
        return Err(arg("--manifest is required".into()));
    }
    if out.is_empty() {
        return Err(arg("--out is required".into()));
    }
    if !Path::new(&manifest).is_file() {
        return Err(fail(format!("manifest not found: {manifest}")));
    }
    if !bin.is_empty() && lib {
        return Err(arg("--bin and --lib are mutually exclusive".into()));
    }
    let level = match opt.as_str() {
        "O0" => "0",
        "O1" => "1",
        "O2" => "2",
        "O3" => "3",
        _ => return Err(arg(format!("unsupported opt level: {opt} (use O0, O1, O2, O3)"))),
    };
    if kind == Kind::Ir && !out.ends_with(".ll") {
        return Err(arg("--out must be a .ll file path".into()));
    }
    let out_is_file = match kind {
        Kind::Mir => out.ends_with(".mir"),
        Kind::Ir => true,
        Kind::Asm => out.ends_with(".s") || out.ends_with(".asm"),
    };
    let out_path = Path::new(&out);
    let made = if out_is_file { out_path.parent().filter(|p| !p.as_os_str().is_empty()).map(fs::create_dir_all).unwrap_or(Ok(())) } else { fs::create_dir_all(out_path) };
    made.map_err(|e| fail(format!("cannot create the output folder: {e}")))?;

    let (cargo_target, name, _) = metadata(&manifest, &crate_).map_err(fail)?;
    let target_dir = PathBuf::from(if target_dir.is_empty() { format!("{cargo_target}/zeroize") } else { target_dir });
    let emit_dir = target_dir.join("zeroize-emit");
    fs::create_dir_all(&emit_dir).map_err(|e| fail(format!("cannot create {}: {e}", emit_dir.display())))?;
    let emit_dir = fs::canonicalize(&emit_dir).unwrap_or(emit_dir);

    let mut cargo: Vec<String> = ["+nightly", "rustc", "--manifest-path", &manifest].map(String::from).to_vec();
    for (flag, v) in [("-p", &crate_), ("--bin", &bin)] {
        if !v.is_empty() {
            cargo.extend([flag.to_string(), v.clone()]);
        }
    }
    if lib {
        cargo.push("--lib".into());
    }
    if !triple.is_empty() {
        cargo.extend(["--target".to_string(), triple.clone()]);
    }
    cargo.extend(extra.iter().cloned());
    let mut rustc_flags = vec!["-C".to_string(), format!("opt-level={level}")];
    if intel {
        rustc_flags.extend(["-C".to_string(), "llvm-args=-x86-asm-syntax=intel".into()]);
    }
    // the path names every setting, the manifest's place included, so it is this unit's alone: when cargo finds the
    // unit fresh, the file its last build wrote there is still the right one
    let here = fs::canonicalize(&manifest).map(|p| p.display().to_string()).unwrap_or_else(|_| manifest.clone());
    let ext = kind.ext();
    let flavour = match kind {
        Kind::Mir => "mir",
        Kind::Ir => "llvm-ir",
        Kind::Asm => "asm",
    };
    let emitted = emit_dir.join(format!("{flavour}-{opt}-{}.{ext}", fnv(&[&[here], &cargo[..], &rustc_flags[..]].concat())));
    rustc_flags.insert(0, format!("--emit={flavour}={}", emitted.display()));

    println!("=== {script} ===");
    println!("manifest: {manifest}");
    println!("opt:      {opt}");
    println!("target:   {}", target_dir.display());
    println!("output:   {out}");
    if !triple.is_empty() {
        println!("triple:   {triple}");
    }
    if intel {
        println!("syntax:   intel");
    }

    let ok = Command::new("cargo").args(&cargo).arg("--").args(&rustc_flags).env("CARGO_TARGET_DIR", &target_dir).status().is_ok_and(|s| s.success());
    if !ok {
        return Err(fail(format!("cargo rustc failed for opt={opt}")));
    }
    if !emitted.is_file() {
        return Err(fail(format!("no .{ext} file at {} (cargo found the crate fresh but its last output is gone; pass --target-dir with a new folder)", emitted.display())));
    }
    let dest = if out_is_file { out_path.to_path_buf() } else { out_path.join(format!("{}.{opt}.{ext}", if bin.is_empty() { name } else { bin.replace('-', "_") })) };
    fs::copy(&emitted, &dest).map_err(|e| fail(format!("cannot copy {} to {}: {e}", emitted.display(), dest.display())))?;
    if out_is_file && fs::metadata(&dest).map(|m| m.len()).unwrap_or(0) == 0 {
        let what = match kind {
            Kind::Mir => "MIR",
            Kind::Ir => "IR",
            Kind::Asm => "assembly",
        };
        return Err(fail(format!("emitted {what} is empty: {out}")));
    }
    Ok(())
}

fn main_for(kind: Kind, argv: &[String]) -> i32 {
    match run(kind, argv) {
        Ok(()) => 0,
        Err((code, message)) => {
            eprintln!("{}: {message}", kind.script());
            code
        }
    }
}

pub fn mir_main(argv: &[String]) -> i32 {
    main_for(Kind::Mir, argv)
}
pub fn ir_main(argv: &[String]) -> i32 {
    main_for(Kind::Ir, argv)
}
pub fn asm_main(argv: &[String]) -> i32 {
    main_for(Kind::Asm, argv)
}

const RUSTDOC_USAGE: &str = "Usage:
  sec zeroize-emit-rustdoc --manifest <Cargo.toml> --out <file.json> [options] [-- <extra cargo rustdoc args>]

The crate's rustdoc JSON (private items included), built by `cargo +nightly rustdoc` in the same shared build folder as
the MIR, IR and assembly, then copied to --out; the input of `sec zeroize-semantic`.

Options:
  --manifest <file>        Cargo manifest path (required)
  --out <path>             Output .json file (required)
  --crate <pkg>            Workspace package (-p)
  --bin <target>           Document a specific bin target
  --lib                    Document the lib target
  --target-dir <dir>       Build folder, shared by every run (default: <target>/zeroize)
  --help                   Show this help text";

/// `sec zeroize-emit-rustdoc`: no original; upstream ran `cargo +nightly rustdoc` by hand into the crate's own target
/// folder (with `--document-private-items` before the `--`, where cargo refuses it)
pub fn rustdoc_main(argv: &[String]) -> i32 {
    let fail = |code: i32, m: String| {
        eprintln!("sec zeroize-emit-rustdoc: {m}");
        code
    };
    let (mut manifest, mut out, mut crate_, mut bin, mut lib, mut target_dir) = (String::new(), String::new(), String::new(), String::new(), false, String::new());
    let mut extra: Vec<String> = Vec::new();
    let mut i = 0;
    while i < argv.len() {
        let x = argv[i].as_str();
        let slot = match x {
            "--manifest" => Some(&mut manifest),
            "--out" => Some(&mut out),
            "--crate" => Some(&mut crate_),
            "--bin" => Some(&mut bin),
            "--target-dir" => Some(&mut target_dir),
            _ => None,
        };
        if let Some(slot) = slot {
            match argv.get(i + 1).filter(|v| !v.is_empty()) {
                Some(v) => *slot = v.clone(),
                None => return fail(2, format!("missing value for {x}")),
            }
            i += 2;
            continue;
        }
        match x {
            "--lib" => lib = true,
            "--help" | "-h" => {
                println!("{RUSTDOC_USAGE}");
                return 0;
            }
            "--" => {
                extra = argv[i + 1..].to_vec();
                break;
            }
            other => return fail(2, format!("unknown argument: {other}")),
        }
        i += 1;
    }
    if manifest.is_empty() || out.is_empty() {
        return fail(2, format!("--{} is required", if manifest.is_empty() { "manifest" } else { "out" }));
    }
    if !bin.is_empty() && lib {
        return fail(2, "--bin and --lib are mutually exclusive".into());
    }
    if !Path::new(&manifest).is_file() {
        return fail(1, format!("manifest not found: {manifest}"));
    }
    let (cargo_target, _, lib_name) = match metadata(&manifest, &crate_) {
        Ok(m) => m,
        Err(e) => return fail(1, e),
    };
    let target_dir = PathBuf::from(if target_dir.is_empty() { format!("{cargo_target}/zeroize") } else { target_dir });
    let mut cargo: Vec<String> = ["+nightly", "rustdoc", "--manifest-path", &manifest].map(String::from).to_vec();
    for (flag, v) in [("-p", &crate_), ("--bin", &bin)] {
        if !v.is_empty() {
            cargo.extend([flag.to_string(), v.clone()]);
        }
    }
    if lib {
        cargo.push("--lib".into());
    }
    cargo.extend(extra);
    println!("=== sec zeroize-emit-rustdoc ===\nmanifest: {manifest}\ntarget:   {}\noutput:   {out}", target_dir.display());
    let ok = Command::new("cargo")
        .args(&cargo)
        .args(["--", "--document-private-items", "-Z", "unstable-options", "--output-format", "json"])
        .env("CARGO_TARGET_DIR", &target_dir)
        .status()
        .is_ok_and(|s| s.success());
    if !ok {
        return fail(1, "cargo rustdoc failed".into());
    }
    let json = target_dir.join("doc").join(format!("{}.json", if bin.is_empty() { lib_name } else { bin.replace('-', "_") }));
    if !json.is_file() {
        return fail(1, format!("no rustdoc JSON at {}", json.display()));
    }
    let dest = Path::new(&out);
    if let Some(parent) = dest.parent().filter(|p| !p.as_os_str().is_empty()) {
        let _ = fs::create_dir_all(parent);
    }
    match fs::copy(&json, dest) {
        Ok(_) => 0,
        Err(e) => fail(1, format!("cannot copy {} to {out}: {e}", json.display())),
    }
}
