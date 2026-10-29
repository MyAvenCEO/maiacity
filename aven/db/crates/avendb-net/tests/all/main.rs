//! The integration tests of `avendb-net`, one program: each file in this folder is one of its modules, so they build
//! and link once (W4, 2026-10-28: each file was a program of its own). The tests that need the process to themselves
//! are the program in `tests/memory/`. One file's tests:
//!
//!   cargo test -p avendb-net --features test-fixtures --test all -- <file>::

#[path = "../common/mod.rs"]
mod common;

mod backup;
mod bucket;
mod files;
mod holdings;
mod lifecycle;
mod link;
mod live;
mod local_reads;
mod packet_transport;
mod resume;
mod revisions;
mod run;
mod server;
mod sim;
mod slow_link;
mod spill_save;
mod statements;
mod store;
mod stub_holdings;
mod sync_bench;
mod transport_control;
mod webrtc_route;
mod webtransport;

/// A file in this folder that no `mod` line above names never builds, and none of its tests runs.
#[test]
fn every_file_is_a_module() {
    avendb_testkit::every_file_a_module(include_str!("main.rs"), concat!(env!("CARGO_MANIFEST_DIR"), "/tests/all"));
}
