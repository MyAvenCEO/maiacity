//! `sec zeroize-diff-mir`: MIR from several optimization levels, normalized (source locations, scopes and comments
//! dropped) and diffed pair by pair with `diff -u`; with three or more files, a summary of the first level at which the
//! zeroize calls or the drop glue disappear. Port of diff_rust_mir.sh.
//!
//!   sec zeroize-diff-mir <O0.mir> <O2.mir>
//!   sec zeroize-diff-mir <O0.mir> <O1.mir> <O2.mir> [<O3.mir> ...]
//! exit 0 identical after normalization (or patterns present at every level), 1 a diff or a pattern that disappears,
//! 2 argument error

use regex::Regex;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

const USAGE: &str = "Usage:
  diff_rust_mir.sh <baseline.mir> <file2.mir> [<file3.mir> ...]

Compares Rust MIR files across optimization levels. Normalizes away noisy
metadata (source locations, scope info, storage annotations) and diffs
the semantic content. Detects disappearance of zeroize-related patterns.

Examples:
  diff_rust_mir.sh crate.O0.mir crate.O2.mir
  diff_rust_mir.sh crate.O0.mir crate.O1.mir crate.O2.mir crate.O3.mir";

/// the original's sed: WARNING and `MIR for` header lines out, scope and source locations replaced, `// ` comments
/// cut, blank lines out
fn norm(text: &str) -> String {
    let scope = Regex::new(r"scope [0-9]+ at [^ ]+:[0-9]+:[0-9]+").unwrap();
    let loc = Regex::new(r"at [^ ]+\.rs:[0-9]+:[0-9]+").unwrap();
    let mut out = String::new();
    let mut lines: Vec<&str> = text.split('\n').collect();
    // sed sees no line after a final newline, and keeps a last line that has none without one
    let open_end = !text.ends_with('\n');
    if !open_end {
        lines.pop();
    }
    let last = lines.len().saturating_sub(1);
    for (n, line) in lines.into_iter().enumerate() {
        if line.starts_with("// WARNING:") || line.starts_with("// MIR for") {
            continue;
        }
        let a = scope.replace_all(line, "scope N at <loc>");
        let b = loc.replace_all(&a, "at <loc>").into_owned();
        let c = match b.find("// ") {
            Some(i) => b[..i].to_string(),
            None => b,
        };
        if c.trim().is_empty() {
            continue;
        }
        out.push_str(&c);
        if !(open_end && n == last) {
            out.push('\n');
        }
    }
    out
}

fn has_zeroize_pattern(text: &str) -> bool {
    Regex::new(r"zeroize::|Zeroize::zeroize|volatile_set_memory|ptr::write_bytes|drop_in_place.*[Kk]ey|drop_in_place.*[Ss]ecret|drop_in_place.*[Pp]assword|drop_in_place.*[Tt]oken|drop_in_place.*[Nn]once|drop_in_place.*[Ss]eed|drop_in_place.*[Pp]riv|Zeroizing|ZeroizeOnDrop").unwrap().is_match(text)
}

fn has_drop_glue(text: &str) -> bool {
    Regex::new(r"drop_in_place|drop\(_[0-9]+\)").unwrap().is_match(text)
}

fn basename(p: &str) -> String {
    Path::new(p).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.to_string())
}

/// `diff -u`, its output passed straight through; its exit code (2 = diff itself failed)
fn diff(a: &Path, b: &Path, labels: Option<(&str, &str)>) -> i32 {
    let _ = std::io::stdout().flush();
    let mut cmd = Command::new("diff");
    cmd.arg("-u");
    if let Some((la, lb)) = labels {
        cmd.args(["--label", la, "--label", lb]);
    }
    cmd.arg(a).arg(b).status().ok().and_then(|s| s.code()).unwrap_or(2)
}

pub fn main(argv: &[String]) -> i32 {
    if argv.len() < 2 {
        println!("{USAGE}");
        return 2;
    }
    if let Some(f) = argv.iter().find(|f| !Path::new(f).is_file()) {
        eprintln!("diff_rust_mir.sh: missing file: {f}");
        return 2;
    }
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let tmp = std::env::temp_dir().join(format!("za-mir-{}-{nanos}", std::process::id()));
    if let Err(e) = fs::create_dir_all(&tmp) {
        eprintln!("diff_rust_mir.sh: cannot create a temporary folder: {e}");
        return 1;
    }
    let code = run(argv, &tmp);
    // the temporary folder holds only the normalized copies made above, as the original's EXIT trap removes
    let _ = fs::remove_dir_all(&tmp);
    code
}

fn run(files: &[String], tmp: &Path) -> i32 {
    let mut normed: Vec<(PathBuf, String)> = Vec::new();
    for (i, f) in files.iter().enumerate() {
        let text = String::from_utf8_lossy(&fs::read(f).unwrap_or_default()).into_owned();
        let n = norm(&text);
        let p = tmp.join(format!("norm_{i}.mir"));
        if let Err(e) = fs::write(&p, &n) {
            eprintln!("diff_rust_mir.sh: cannot write {}: {e}", p.display());
            return 1;
        }
        normed.push((p, n));
    }

    // two files: one diff, no summary
    if files.len() == 2 {
        let rc = diff(&normed[0].0, &normed[1].0, None);
        if rc == 2 {
            eprintln!("diff_rust_mir.sh: diff failed (internal error)");
            return 1;
        }
        return rc;
    }

    let mut any_diff = 0;
    for i in 0..files.len() - 1 {
        let j = i + 1;
        let (a, b) = (basename(&files[i]), basename(&files[j]));
        println!("=== DIFF File {} ({a}) vs File {} ({b}) ===", i + 1, j + 1);
        if diff(&normed[i].0, &normed[j].0, Some((&a, &b))) != 0 {
            any_diff = 1;
        }
        println!();
    }

    println!("=== ZEROIZE PATTERN SUMMARY ===");
    let mut first_absent = None;
    for (i, (_, text)) in normed.iter().enumerate() {
        let label = basename(&files[i]);
        if has_zeroize_pattern(text) {
            println!("  File {} ({label}): ZEROIZE CALLS PRESENT", i + 1);
        } else {
            println!("  File {} ({label}): ZEROIZE CALLS ABSENT", i + 1);
            first_absent.get_or_insert(i);
        }
    }
    println!();

    println!("=== DROP GLUE SUMMARY ===");
    let mut first_drop_absent = None;
    for (i, (_, text)) in normed.iter().enumerate() {
        let label = basename(&files[i]);
        if has_drop_glue(text) {
            println!("  File {} ({label}): DROP GLUE PRESENT", i + 1);
        } else {
            println!("  File {} ({label}): DROP GLUE ABSENT", i + 1);
            first_drop_absent.get_or_insert(i);
        }
    }
    println!();

    if let Some(i) = first_absent {
        println!("WARNING: Zeroize patterns first disappear at File {} ({}).", i + 1, basename(&files[i]));
        println!("  Evidence: OPTIMIZED_AWAY_ZEROIZE — zeroize calls present at lower opt level(s) but absent here.");
        any_diff = 1;
    } else if let Some(i) = first_drop_absent {
        println!("WARNING: Drop glue first disappears at File {} ({}).", i + 1, basename(&files[i]));
        println!("  Evidence: Drop glue present at lower opt level(s) but absent here — sensitive type drop may be inlined or elided.");
        any_diff = 1;
    } else {
        println!("OK: Zeroize patterns and drop glue present at all opt levels analyzed.");
    }
    any_diff
}
