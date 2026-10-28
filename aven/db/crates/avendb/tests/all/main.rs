//! The integration tests of `avendb`, one program: each file in this folder is one of its modules, so they build and
//! link once (W4, 2026-10-28: each file was a program of its own). The tests that need the process to themselves are
//! the program in `tests/memory/`. One file's tests:
//!
//!   cargo test -p avendb --features test-fixtures --test all -- <file>::

#[path = "../common/mod.rs"]
mod common;
#[path = "../records/mod.rs"]
mod records;

mod actor_move;
mod actors;
mod aip;
mod aips_scale;
mod assets;
mod audience_logs;
mod batch;
mod batch_durability;
mod bench_gates;
mod box_stubs;
mod cap_groups;
mod caps;
mod catch_up_steps;
mod checkpoint;
mod code;
mod devices;
mod documents;
mod draft_frontier;
mod drafts;
mod engine;
mod entry_files;
mod entry_state;
mod first_sync_moves;
mod freshness_vectors;
mod fuzz;
mod gate;
mod handed_view;
mod kept_shown;
mod key_tree_vectors;
mod keys;
mod late_past_moves;
mod lazy_boxes;
mod legacy;
mod link;
mod log_revision;
mod moves_step_on;
mod nested;
mod objective;
mod op_names;
mod ops;
mod phone_fixture;
mod probes;
mod properties;
mod provenance;
mod replay_rungs;
mod replay_scale;
mod replay_tail;
mod rooms;
mod rules;
mod scale_turns;
mod scenarios;
mod schemas;
mod scoped_reply;
mod seed;
mod sessions;
mod show_rules;
mod snapshot;
mod split;
mod step_costs;
mod stored_view;
mod sync;
mod todos;
mod touch_id;
mod types;
mod unlock_phone;
mod vault_ops;
mod vaults;
mod vectors;
mod warm_cap_groups;
mod warming;
mod wire_batches;
mod work_metrics;

/// A file in this folder that no `mod` line above names never builds, and none of its tests runs.
#[test]
fn every_file_is_a_module() {
    avendb_testkit::every_file_a_module(include_str!("main.rs"), concat!(env!("CARGO_MANIFEST_DIR"), "/tests/all"));
}
