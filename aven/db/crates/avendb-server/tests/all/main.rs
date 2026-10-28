//! The integration tests of `avendb-server`, one program: each file in this folder is one of its modules, so they build
//! and link once (W4, 2026-10-28: each file was a program of its own). One file's tests:
//!
//!   cargo test -p avendb-server --features test-fixtures --test all -- <file>::

#[path = "../../../avendb-net/tests/common/mod.rs"]
mod common;

mod backup;
mod bounded;
mod first_view_gate;
mod lane_rate;
mod relay;
mod relay_bench;
mod transport_activation;
mod webtransport;

/// A file in this folder that no `mod` line above names never builds, and none of its tests runs.
#[test]
fn every_file_is_a_module() {
    avendb_testkit::every_file_a_module(include_str!("main.rs"), concat!(env!("CARGO_MANIFEST_DIR"), "/tests/all"));
}
