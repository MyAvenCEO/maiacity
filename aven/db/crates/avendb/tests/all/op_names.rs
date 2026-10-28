//! The page's names of the ops that change nothing (aven/db/page/op-names.js) are the engine's (`engine::READS`,
//! `engine::ASKS`), written from them and never by hand: an op the engine reads that the page didn't know went down the
//! page's change path, `current` and the passkey's ceremony, for nothing. This test fails where the two differ;
//! `AVENDB_WRITE_OPS=1 cargo test -p avendb --test all op_names::` writes the page's file again.

use avendb::engine;
use serde_json::json;

const PAGE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../page/op-names.js");

fn list(names: &[&str]) -> String {
    names.iter().map(|n| format!("\t'{n}'")).collect::<Vec<_>>().join(",\n")
}

/// The page's file, as the engine's lists write it.
fn page() -> String {
    format!(
        "// WRITTEN FROM avenDB's ENGINE, NOT BY HAND: aven/db/crates/avendb/src/engine.rs `READS` and `ASKS`.\n\
         // `AVENDB_WRITE_OPS=1 cargo test -p avendb --test all op_names::` (in aven/db/) writes it again; CI fails where it differs.\n\
         \n\
         /** The ops that only read what the device holds, and `api_pass`, which signs a pass and keeps nothing. */\n\
         export const READS = [\n{}\n];\n\
         \n\
         /** The ops that change nothing but ask what changes would do, by dry runs: `may`, and `shares`. */\n\
         export const ASKS = [\n{}\n];\n",
        list(&engine::READS),
        list(&engine::ASKS)
    )
}

#[test]
fn the_page_names_the_engines_reads_and_asks() {
    let want = page();
    if std::env::var_os("AVENDB_WRITE_OPS").is_some() {
        std::fs::write(PAGE, &want).expect("the page's op names are written");
        return;
    }
    let got = std::fs::read_to_string(PAGE).expect("the page's op names are there");
    assert!(
        got == want,
        "aven/db/page/op-names.js differs from the engine's READS and ASKS: \
         run `AVENDB_WRITE_OPS=1 cargo test -p avendb --test all op_names::` in aven/db/ and commit it"
    );
}

#[test]
fn every_listed_name_is_an_op_the_engine_runs() {
    for name in engine::READS.iter().chain(&engine::ASKS) {
        let op = json!({ "op": name });
        assert_eq!(engine::name(&op), Some(*name), "{name} is an op the engine runs");
        assert_eq!(engine::reads(&op), engine::READS.contains(name), "{name}");
        assert_eq!(engine::asks(&op), engine::ASKS.contains(name), "{name}");
    }
    assert!(engine::READS.iter().all(|n| !engine::ASKS.contains(n)), "an op reads or asks, never both");
}
