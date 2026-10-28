//! The tests of `avendb-net` that need the process to themselves, one program: they count the bytes its allocator holds
//! (`avendb_testkit::memory`), which another test's allocations in the same process would change. Each takes the
//! process for itself first (`memory::alone`), so `cargo test` runs them one at a time; nextest runs each in a process
//! of its own anyway. One file's tests:
//!
//!   cargo test -p avendb-net --features test-fixtures --test memory -- <file>::

#[global_allocator]
static COUNTING: avendb_testkit::memory::Counting = avendb_testkit::memory::Counting;

#[path = "../common/mod.rs"]
mod common;

mod unlock_memory;

/// A file in this folder that no `mod` line above names never builds, and none of its tests runs.
#[test]
fn every_file_is_a_module() {
    let _alone = avendb_testkit::memory::alone();
    avendb_testkit::every_file_a_module(include_str!("main.rs"), concat!(env!("CARGO_MANIFEST_DIR"), "/tests/memory"));
}
