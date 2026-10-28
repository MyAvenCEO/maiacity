//! The integration tests of `avendb-device`, one program: each file in this folder is one of its modules, so they build
//! and link once (W4, 2026-10-28: each file was a program of its own). One file's tests:
//!
//!   cargo test -p avendb-device --features test-fixtures --test all -- <file>::

mod device;

/// A file in this folder that no `mod` line above names never builds, and none of its tests runs.
#[test]
fn every_file_is_a_module() {
    avendb_testkit::every_file_a_module(include_str!("main.rs"), concat!(env!("CARGO_MANIFEST_DIR"), "/tests/all"));
}
