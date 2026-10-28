//! The names of the engine and of its rules, set for the code at build time.
//!
//! `AVENDB_ENGINE` is the engine's own hash: of every source file under `src/`, by its path, in order. What another
//! build of the engine worked out and sealed to it (avendb-net's edit summaries, handed views) holds for this build
//! alone.
//!
//! `AVENDB_VIEW_RULES` is the number of the replay rules (`viewRules` in `spec/AvenDB/ViewRules.lean`): a stored view
//! (`lab::Warm`) is sealed to it, not to the engine's hash, so a release that keeps the rules keeps every device's
//! stored view, and one that changes them replays again.
//!
//! `AVENDB_SHOW_RULES` is the number of the show rules (`showRules` in `spec/AvenDB/ShowRules.lean`): a pack of kept
//! showings (`lab::Warm::shown`) is sealed to it, not to the engine's hash, so a release that keeps the rules keeps every
//! device's kept showings, and one that changes them judges every entry again.
//!
//! `AVENDB_READ_RULES` is the number of the read rules (`readRules` in `spec/AvenDB/StoredReadings.lean`): what a stored
//! view holds of what its device read (`lab::Readings`) opens under it alone, so a release that changes what a body
//! reads as reads every body again.

use std::fs;
use std::path::{Path, PathBuf};

const VIEW_RULES: &str = "../../spec/AvenDB/ViewRules.lean";
const SHOW_RULES: &str = "../../spec/AvenDB/ShowRules.lean";
const READ_RULES: &str = "../../spec/AvenDB/StoredReadings.lean";

fn files(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir).expect("src/").map(|e| e.expect("an entry").path()).collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            files(&path, out);
        } else {
            out.push(path);
        }
    }
}

/// The number `def <name> : Nat := <n>` names in the Lean spec file `path`. A build without the spec beside it (a
/// dependency layer of the server's image builds our crates without their files) names none: nothing sealed under a
/// number opens under it, and nothing it seals opens under a numbered build, so such a build only works things out anew.
fn rules(path: &str, name: &str) -> String {
    let Ok(lean) = fs::read_to_string(path) else {
        println!("cargo:warning=no {path}: what is sealed to {name} is sealed to no rules");
        return "none".into();
    };
    let line = format!("def {name} : Nat :=");
    let n = lean.lines().find_map(|l| l.trim().strip_prefix(line.as_str())).unwrap_or_else(|| panic!("{line} <n>"));
    n.trim().parse::<u64>().unwrap_or_else(|_| panic!("{name} is a number")).to_string()
}

fn main() {
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed={VIEW_RULES}");
    println!("cargo:rerun-if-changed={SHOW_RULES}");
    println!("cargo:rerun-if-changed={READ_RULES}");
    let mut all = vec![];
    files(Path::new("src"), &mut all);
    let mut h = blake3::Hasher::new();
    for path in &all {
        println!("cargo:rerun-if-changed={}", path.display());
        h.update(path.to_string_lossy().as_bytes());
        h.update(&[0]);
        h.update(&fs::read(path).expect("a source file"));
        h.update(&[0]);
    }
    println!("cargo:rustc-env=AVENDB_ENGINE={}", h.finalize().to_hex());
    println!("cargo:rustc-env=AVENDB_VIEW_RULES={}", rules(VIEW_RULES, "viewRules"));
    println!("cargo:rustc-env=AVENDB_SHOW_RULES={}", rules(SHOW_RULES, "showRules"));
    println!("cargo:rustc-env=AVENDB_READ_RULES={}", rules(READ_RULES, "readRules"));
}
