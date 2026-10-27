//! The Lean model's freshness vectors (`avendb/spec/vectors/freshness.json`, written by `lake exe vectors` from
//! `FreshnessVectors.lean`): what a device hears against each kind of coverage. Each case's coverage is written as a
//! read answers it (`Coverage::to_json`), stamped the way every read is (`add_freshness`), and must give the model's
//! freshness, action and sheet: the 27 Oct iPhone (three peers, 2,778 logs behind) never current, its approval sheet
//! never opening.

use avendb::engine::coverage::{add_freshness, Freshness, Heard};
use avendb_testkit::{num as n, vectors};
use serde_json::{json, Value};

/// The read answer the case's coverage stands for, and the logs the node counted for its scope.
fn answer(coverage: &Value) -> (Value, usize) {
    match coverage["state"].as_str().unwrap() {
        "complete" => (json!({ "ok": { "count": 0, "coverage": { "state": "complete" } } }), 0),
        "denied" => (json!({ "ok": { "count": 0, "coverage": { "state": "denied", "why": "no standing" } } }), 0),
        "partial" => {
            let (have, known, waits, logs) = (n(&coverage["have"]), n(&coverage["known"]), n(&coverage["waits"]), n(&coverage["logs"]));
            let waiting: Vec<Value> = (0..waits).map(|i| json!({ "entry": format!("{i:064x}"), "on": "record" })).collect();
            let coverage = json!({ "state": "partial", "have": have, "known": known, "waiting": waiting, "logs": logs });
            (json!({ "ok": { "count": have, "coverage": coverage } }), logs as usize)
        }
        other => panic!("a coverage state, not {other}"),
    }
}

#[test]
fn every_read_is_stamped_as_the_model_says() {
    let cases = vectors("freshness");
    let cases = cases.as_array().expect("cases");
    assert_eq!(cases.len(), 20);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let heard = Heard { live: n(&case["live"]) as usize, unheard: n(&case["unheard"]) as usize, as_of: n(&case["asOf"]) };
        let (mut read, logs) = answer(&case["coverage"]);
        let fresh = add_freshness(&mut read, heard, logs).expect("a read answer is stamped");
        assert_eq!(read["fresh"], case["fresh"], "{name}: freshness");
        assert_eq!(fresh.act().name(), case["act"].as_str().unwrap(), "{name}: action");
        assert_eq!(fresh.opens(false), case["pops"].as_bool().unwrap(), "{name}: sheet by itself");
        assert_eq!(fresh.opens(true), case["asked"].as_bool().unwrap(), "{name}: sheet when asked");
    }
}

/// A read with no coverage of its own (`aips`, `get`, …) is stamped by the logs the node counted for its scope alone.
#[test]
fn a_read_without_coverage_is_behind_by_its_scope() {
    let heard = Heard { live: 3, unheard: 0, as_of: 0 };
    let mut aips = json!({ "ok": [{ "number": 29, "stage": "proposed" }] });
    assert_eq!(add_freshness(&mut aips, heard, 2778), Some(Freshness::Behind { logs: 2778, waits: 0, unheard: 0 }));
    assert!(!Freshness::Behind { logs: 2778, waits: 0, unheard: 0 }.opens(true));
    let mut done = json!({ "ok": [] });
    assert_eq!(add_freshness(&mut done, heard, 0), Some(Freshness::Current));
    let mut refused = json!({ "refused": "bad_op", "why": "x" });
    assert_eq!(add_freshness(&mut refused, heard, 0), None);
    assert!(refused.get("fresh").is_none());
}
