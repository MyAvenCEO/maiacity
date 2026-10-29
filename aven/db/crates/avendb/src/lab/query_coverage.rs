//! A query's coverage (`spec/AvenDB/Coverage.lean`): one answer, the same on every read of the same state.
use super::*;
use crate::cast::{document, human_on};
use serde_json::{json, Value};

fn read(lab: &Lab, d: SignerId, q: &Value) -> Value {
    crate::engine::read(lab, d, q)
}

#[test]
fn entries_whose_header_is_unread_wait_and_the_rest_answers_at_once() {
    let mut w = crate::cast::world();
    let mut entries = Vec::new();
    for n in 0..12 {
        entries.push(w.lab.create(w.mac_a, w.alice, w.alice, "note", &[],
            document(&format!("Note {n:02}"), "body", w.mac_a)).unwrap());
    }
    // The device holds the first four and their keys, but hasn't read their headers yet: they may be notes.
    entries.sort();
    let readings = w.lab.held(w.mac_a).readings.clone();
    let creations: Vec<_> = entries[..4].iter().map(|e| w.lab.held(w.mac_a).view().entry(*e).unwrap().creation).collect();
    {
        let r = &mut w.lab.stores.get_mut(&w.mac_a).unwrap().readings;
        for c in &creations { r.headers.remove(c); }
        for ids in r.typed.values_mut() { ids.retain(|c| !creations.contains(c)); }
        r.untyped.extend(entries[..4].iter().copied());
        w.lab.stores.get_mut(&w.mac_a).unwrap().recontext();
    }
    for entry in &entries[..4] { assert!(w.lab.meaning(w.mac_a, *entry).is_none()); }
    let query = json!({"op":"query","vault":w.alice.to_hex(),"where":{"type":["note"]},"depth":1,"select":[],"limit":1});
    let result = read(&w.lab, w.mac_a, &query);
    assert_eq!(result["ok"]["count"], 8);
    let coverage = &result["ok"]["coverage"];
    assert_eq!(coverage["state"], "partial");
    assert_eq!(coverage["have"], 8);
    assert_eq!(coverage["known"], 12);
    assert_eq!(coverage["logs"], 0);
    let waiting: BTreeSet<_> = coverage["waiting"].as_array().unwrap().iter()
        .map(|w| (w["entry"].as_str().unwrap().to_string(), w["on"].as_str().unwrap().to_string())).collect();
    assert_eq!(waiting, entries[..4].iter().map(|e| (e.to_hex(), "semantics".to_string())).collect());
    assert_eq!(result, read(&w.lab, w.mac_a, &query), "the same state answers the same");
    assert_eq!(result, crate::engine::full_query_oracle(&w.lab, w.mac_a, &query), "the index misses none that waits");
    // Once the headers are read, nothing waits.
    w.lab.stores.get_mut(&w.mac_a).unwrap().readings = readings;
    w.lab.stores.get_mut(&w.mac_a).unwrap().recontext();
    let arrived = read(&w.lab, w.mac_a, &query);
    assert_eq!(arrived["ok"]["count"], 12);
    assert_eq!(arrived["ok"]["coverage"], json!({"state":"complete"}));
}

#[test]
fn a_cold_restored_device_answers_the_exact_page_in_one_read() {
    let mut lab = Lab::new();
    let owner = lab.passkey("Cold query");
    let device = lab.device_of(owner, "Mac");
    let vault = human_on(&mut lab, owner, &[device]);
    for n in 0..16 {
        lab.create(device, vault, vault, "note", &[], document(&format!("Note {n:02}"), "body", device)).unwrap();
    }
    let queries = [
        json!({"op":"query","vault":vault.to_hex(),"where":{"type":["note"]},"depth":1,"select":[],"limit":1,"offset":2}),
        json!({"op":"query","vault":vault.to_hex(),"where":{"all":[{"type":["note"]},{"path":["title"],"eq":"Note 07"}]},
            "depth":1,"select":["title"],"limit":3,"order":[["created","desc"]]}),
    ];
    let expected: Vec<_> = queries.iter().map(|q| crate::engine::full_query_oracle(&lab, device, q)).collect();
    let backup = lab.backup(device);
    let count = backup.signed.len();
    let receipt = lab.warming(device, count, Some([91; 40])).unwrap();
    let warm = Warm { queries: vec![], ..Warm::of(&receipt) };
    lab.warmed(device, receipt);
    for (query, expected) in queries.into_iter().zip(expected) {
        lab.restore_warm(device, backup.clone(), Some(([91; 40], count)), &warm);
        let first = read(&lab, device, &query);
        assert_eq!(first, expected, "no time budget: the first read is the exact page");
        assert_eq!(first["ok"]["coverage"], json!({"state":"complete"}));
    }
}

#[test]
fn pages_by_cursor_concatenate_to_the_whole_answer() {
    let mut lab = Lab::new();
    let owner = lab.passkey("Paging");
    let device = lab.device_of(owner, "Mac");
    let vault = human_on(&mut lab, owner, &[device]);
    for n in 0..11 {
        lab.create(device, vault, vault, "note", &[], document(&format!("Note {:02}", (n * 7) % 11), "body", device)).unwrap();
    }
    let rows = |v: &Value| v["ok"]["rows"].as_array().unwrap().iter().map(|r| r["entry"].clone()).collect::<Vec<_>>();
    for order in [json!([]), json!([["created","desc"]]), json!([[["title"],"asc"]])] {
        let whole = read(&lab, device, &json!({"op":"query","vault":vault.to_hex(),"order":order}));
        assert_eq!(whole["ok"]["next"], Value::Null);
        let mut paged = vec![];
        let mut after = Value::Null;
        for _ in 0..8 {
            let mut q = json!({"op":"query","vault":vault.to_hex(),"order":order,"limit":3});
            if !after.is_null() { q["after"] = after.clone(); }
            let page = read(&lab, device, &q);
            assert_eq!(page["ok"]["count"], 11);
            paged.extend(rows(&page));
            after = page["ok"]["next"].clone();
            if after.is_null() { break; }
        }
        assert_eq!(paged, rows(&whole), "order {order}");
    }
    let refused = read(&lab, device, &json!({"op":"query","vault":vault.to_hex(),"after":"nonsense"}));
    assert!(refused["refused"].is_string() || refused.get("why").is_some(), "{refused}");
}

#[test]
fn a_vault_without_standing_is_denied() {
    let mut w = crate::cast::world();
    w.lab.create(w.mac_a, w.alice, w.alice, "note", &[], document("Private", "body", w.mac_a)).unwrap();
    w.lab.sync_all(0);
    let q = json!({"op":"query","vault":w.alice.to_hex()});
    assert_eq!(read(&w.lab, w.mac_a, &q)["ok"]["coverage"], json!({"state":"complete"}));
    let theirs = read(&w.lab, w.mac_b, &q);
    assert_eq!(theirs["ok"]["coverage"]["state"], "denied", "{theirs}");
    assert_eq!(theirs["ok"]["count"], 0);
}

/// `LiveQuery.lean` `indexed_eq_scan`: a query that names its types reads its candidates off the index by type and
/// answers exactly what the scan of every entry answers.
#[test]
fn the_type_index_answers_what_the_full_scan_answers() {
    let mut w = crate::cast::world();
    let library = crate::cast::library(&mut w);
    let (me, vault) = (w.mac_a, w.alice);
    for n in 0..64 {
        w.lab.create(me, vault, vault, "unrelated", &[], crate::doc::Item::document(&format!("Noise {n}"), me)).unwrap();
    }
    w.lab.tag(me, vault, library.seeds, &["work"], &["home"]).unwrap();
    let plan = crate::ops::Where::of_json(&json!({"type":["todo"]})).unwrap().plan();
    assert_eq!(w.lab.query_candidates(me, Some(vault), &plan).len(), 3, "only the todos reach meaning");
    let cases = [
        json!({"type":["todo"]}),
        json!({"all":[{"type":["todo"]},{"tag":"work"}]}),
        json!({"any":[{"type":["todo"]},{"tag":"work"}]}),
        json!({"any":[{"type":["todo"]},{"entry":[library.seeds.to_hex()]}]}),
        json!({"noTag":["home"]}),
        json!({"not":{"type":["todo"]}}),
        json!({"entry":[library.seeds.to_hex()]}),
        json!({"all":[{"type":["todo"]},{"path":["status"],"eq":"open"}]}),
    ];
    for where_ in cases {
        for order in [json!([]), json!([[["title"],"desc"]])] {
            for vault in [Some(vault), None] {
                let mut q = json!({"op":"query","where":where_,"order":order,"limit":2,"offset":1});
                if let Some(v) = vault { q["vault"] = v.to_hex().into(); }
                assert_eq!(read(&w.lab, me, &q), crate::engine::full_query_oracle(&w.lab, me, &q), "{q}");
            }
        }
    }
    w.lab.sync_all(0);
    let q = json!({"op":"query","where":{"type":["todo"]}});
    assert_eq!(read(&w.lab, w.mac_b, &q), crate::engine::full_query_oracle(&w.lab, w.mac_b, &q));
}

/// `LiveQuery.lean` `untouched_query_unchanged`: a change names the entries it touched, and a query that selects none
/// of them answers as before, so the page needn't run it again.
#[test]
fn a_change_names_what_it_touched_and_untouched_queries_stay() {
    let mut w = crate::cast::world();
    let (me, vault) = (w.mac_a, w.alice);
    let todo = w.lab.create(me, vault, vault, "todo", &[], document("Todo", "body", me)).unwrap();
    let todos = json!({"op":"query","vault":vault.to_hex(),"where":{"type":["todo"]}});
    let notes = json!({"op":"query","vault":vault.to_hex(),"where":{"type":["note"]}});
    let before = (read(&w.lab, me, &todos), read(&w.lab, me, &notes));
    let start = read(&w.lab, me, &json!({"op":"touched","since":[0, 0]}));
    assert_eq!(start["ok"]["all"], true, "without what its log let go, a change may have taken edits out");
    let since = start["ok"]["since"].clone();
    let note = w.lab.create(me, vault, vault, "note", &[], document("Note", "body", me)).unwrap();
    let touched = read(&w.lab, me, &json!({"op":"touched","since":since}));
    assert_eq!(touched["ok"]["all"], false, "{touched}");
    assert_eq!(touched["ok"]["entries"], json!([note.to_hex()]));
    assert_eq!(touched["ok"]["vaults"], json!([vault.to_hex()]));
    // The todos query selects nothing the change touched: its answer is the same.
    assert_eq!(read(&w.lab, me, &todos), before.0);
    assert_ne!(read(&w.lab, me, &notes), before.1);
    // Nothing since: nothing touched.
    let again = read(&w.lab, me, &json!({"op":"touched","since":touched["ok"]["since"]}));
    assert_eq!((again["ok"]["all"].clone(), again["ok"]["entries"].clone()), (json!(false), json!([])));
    // A change of standing may change any read.
    let since = again["ok"]["since"].clone();
    w.lab.tag(me, vault, todo, &["work"], &[]).unwrap();
    let tagged = read(&w.lab, me, &json!({"op":"touched","since":since}));
    assert_eq!(tagged["ok"]["entries"], json!([todo.to_hex()]), "a tag is the entry's own edit");
    let since = tagged["ok"]["since"].clone();
    let group = w.lab.define_group(me, vault, rules::CapGroup {
        name: "Readers".into(), caps: vec![rules::Cap { op: rules::Op::Read, slice: Selector::All }], includes: vec![],
    }).unwrap();
    w.lab.issue_group(me, &[me], GroupShare {
        over: vault, who: Who::Vault(w.bob), name: "Readers".into(),
        select: crate::cast::by_id(todo), group, level: Level::Read, parent: None, issuer: vault,
    }).unwrap();
    assert_eq!(read(&w.lab, me, &json!({"op":"touched","since":since}))["ok"]["all"], true);
}

/// What a stamp costs where a device holds as much beside its log as a large vault does: run with
/// `cargo test -p avendb --features test-fixtures --lib the_stamp_of -- --ignored --nocapture`.
#[test]
#[ignore]
fn the_stamp_of_a_large_vault() {
    use crate::id::{EditId, EntryId, ShareId};
    let mut w = crate::cast::world();
    let me = w.mac_a;
    let at = w.lab.at(me);
    let store = w.lab.stores.get_mut(&at).unwrap();
    let (shares, groups, untyped) = (2_000u64, 500u64, 20_000u64);
    for n in 0..shares {
        store.readings.selectors.insert(ShareId::from_u64(n), crate::slice::Selector::AnyOf(vec![]));
        store.unreadable.insert(ShareId::from_u64(shares + n));
    }
    for n in 0..groups {
        store.readings.defines.insert(EditId::from_u64(n), crate::rules::CapGroup { name: String::new(), caps: vec![], includes: vec![] });
    }
    store.readings.untyped.extend((0..untyped).map(EntryId::from_u64));
    let runs = 200;
    let start = std::time::Instant::now();
    for _ in 0..runs {
        store.recontext();
    }
    let change = start.elapsed() / runs;
    let start = std::time::Instant::now();
    for _ in 0..runs {
        std::hint::black_box(w.lab.query_view_stamp(me));
    }
    let read = start.elapsed() / runs;
    eprintln!("{shares} shares and {shares} unreadable, {groups} cap groups, {untyped} headers unread: {change:?} a change, {read:?} a read");
}
