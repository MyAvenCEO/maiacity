//! The engine's own hash, `AVENDB_ENGINE`: of every source file under `src/`, by its path, in order. What a device
//! seals on its shelf of what it worked out (`lab::Warm`) holds for this engine alone: any other build works it out
//! again.

use std::fs;
use std::path::{Path, PathBuf};

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

fn main() {
    println!("cargo:rerun-if-changed=src");
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
}
