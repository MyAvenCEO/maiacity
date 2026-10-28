//! The fixture of the phone-class row of avenDB's bench (`avendb-browser`'s `bench` feature,
//! `aven/ops/ci/avendb-bench-phone.mjs`): every signed edit Alice's Mac holds once it wrote `AVENDB_PHONE_EDITS` edits
//! (2,000 if unset) into the coop, written to `AVENDB_PHONE_FIXTURE`, each its length in 4 bytes, big-endian, then its
//! wire bytes. Synthetic: the scenarios' cast and their fixed keys, no one's data.
//!
//!   AVENDB_PHONE_FIXTURE=/tmp/phone.bin cargo test -p avendb --features test-fixtures --test phone_fixture -- --ignored

use avendb::cast::*;
use avendb::wire::Wire;

/// The entries the edits go to, in turn.
const ENTRIES: u64 = 8;

#[test]
#[ignore]
fn phone_fixture() {
    let Ok(path) = std::env::var("AVENDB_PHONE_FIXTURE") else { return };
    let edits: usize = std::env::var("AVENDB_PHONE_EDITS").ok().and_then(|n| n.parse().ok()).unwrap_or(2000);
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let mac = w.mac_a;
    let mut entries = vec![];
    for i in 0..ENTRIES {
        let doc = document(&format!("Bench {i}"), "the phone bench", mac);
        entries.push(w.lab.create(mac, coop, coop, "doc", &[], doc).expect("an entry"));
    }
    for k in 0..edits.saturating_sub(ENTRIES as usize) {
        let entry = entries[k % entries.len()];
        let text = format!("edit {k} of the phone bench");
        w.lab.edit(mac, coop, entry, |item| item.push_block(paragraph(100 + k as u64, &text))).expect("an edit");
    }
    let mut out = vec![];
    let backup = w.lab.backup(mac);
    for s in backup.signed() {
        let bytes = s.to_wire();
        out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        out.extend_from_slice(&bytes);
    }
    std::fs::write(&path, &out).expect("the fixture written");
    println!("PHONEFIXTURE edits={} bytes={}", backup.signed().len(), out.len());
}
