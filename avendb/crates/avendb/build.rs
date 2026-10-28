//! Two names of the engine, set for the code at build time.
//!
//! `AVENDB_ENGINE` is the engine's own hash: of every source file under `src/`, by its path, in order. What another
//! build of the engine worked out and sealed to it (avendb-net's edit summaries, handed views) holds for this build
//! alone.
//!
//! `AVENDB_VIEW_RULES` is the number of the replay rules (`viewRules` in `spec/AvenDB/ViewRules.lean`): a stored view
//! (`lab::Warm`) is sealed to it, not to the engine's hash, so a release that keeps the rules keeps every device's
//! stored view, and one that changes them replays again.

use std::fs;
use std::path::{Path, PathBuf};

const VIEW_RULES: &str = "../../spec/AvenDB/ViewRules.lean";

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

/// The number `def viewRules : Nat := <n>` names in the Lean spec. A build without the spec beside it (a dependency
/// layer of the server's image builds our crates without their files) names none: no stored view opens under it, and
/// none it seals opens under a numbered build, so such a build only replays.
fn view_rules() -> String {
    let Ok(lean) = fs::read_to_string(VIEW_RULES) else {
        println!("cargo:warning=no {VIEW_RULES}: stored views are sealed to no replay rules");
        return "none".into();
    };
    let n = lean.lines().find_map(|l| l.trim().strip_prefix("def viewRules : Nat :=")).expect("def viewRules : Nat := <n>");
    n.trim().parse::<u64>().expect("viewRules is a number").to_string()
}

fn main() {
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed={VIEW_RULES}");
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
    println!("cargo:rustc-env=AVENDB_VIEW_RULES={}", view_rules());
}
