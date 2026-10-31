//! avenID's Records in a Doc against Lean's vectors (`access.json`, `Aven.ID.AccessRecords`): each Value fits its
//! type or not as the model says, a Record that fits is named as the model names it, and writes back as itself.

mod common;

use aven_core::{DocId, encode};
use aven_id::caps::{IdRecord, id_builtin_fit};
use common::{core_value, hex, vectors};
use serde_json::json;

#[test]
fn records_fit_as_the_model_says() {
    let all = vectors("access.json");
    assert!(all.len() >= 25, "{} access vectors", all.len());
    let (mut fit, mut unfit, mut foreign) = (0, 0, 0);
    for v in &all {
        let t = DocId::parse(v["input"]["type"].as_str().unwrap()).unwrap();
        let value = core_value(&v["input"]["value"]);
        let got = match id_builtin_fit(&t, &value) {
            None => {
                foreign += 1;
                json!({ "fits": null })
            }
            Some(None) => {
                unfit += 1;
                json!({ "fits": false })
            }
            Some(Some(r)) => {
                fit += 1;
                let (name, back) = match &r {
                    IdRecord::Cap(c) => (c.cap.id.clone(), c.value()),
                    IdRecord::Revoke(x) => (x.revocation.id.text(), x.value()),
                    IdRecord::Epoch(e) => (format!("b3:{}", hex(&e.epoch.name())), e.value()),
                };
                assert_eq!(encode(&back), encode(&value), "{}", v["name"]);
                json!({ "fits": true, "name": name })
            }
        };
        assert_eq!(got, v["expected"], "{}", v["name"]);
    }
    assert!(fit >= 10 && unfit >= 10 && foreign >= 2, "{fit} fit, {unfit} unfit, {foreign} foreign");
}
