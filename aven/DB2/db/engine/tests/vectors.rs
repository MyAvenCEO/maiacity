//! aven-db-engine against Lean's vectors (README rule 10): `queries.json` and `mutations.json`
//! (`Aven.DB.Engine.Query`, `Mutate`, `Footprint`).

mod common;

use aven_core::DocId;
use aven_db_engine::{Refused, apply, bound, commit, cost};
use common::*;
use serde_json::{Value as Json, json};

/// How many Records of each type the database has at all: the counts a query's bound and cost come from (`counts`).
fn counts(db: &[aven_db_engine::Rec]) -> impl Fn(&DocId) -> u64 + '_ {
    move |ty| db.iter().filter(|r| r.r#type == *ty).count() as u64
}

fn refused_json(e: Refused) -> Json {
    match e {
        Refused::BadRef(i) => json!({ "badRef": i }),
        Refused::Missing(i) => json!({ "missing": i }),
    }
}

#[test]
fn queries_bound_and_cost() {
    let all = vectors("queries.json");
    assert!(all.len() >= 60);
    for v in all {
        let name = &v["name"];
        let db = list(&v["input"]["records"], rec);
        let q = query(&v["input"]["query"]);
        assert_eq!(
            json!(bound(&counts(&db), &q)),
            v["expected"]["bound"],
            "{name}: bound"
        );
        assert_eq!(
            json!(cost(&counts(&db), &q)),
            v["expected"]["cost"],
            "{name}: cost"
        );
    }
}

#[test]
fn mutations_commit() {
    let all = vectors("mutations.json");
    assert!(all.len() >= 60);
    for v in all {
        let name = &v["name"];
        let i = &v["input"];
        let (w, c) = (
            i["writer"].as_u64().unwrap(),
            i["counter"].as_u64().unwrap(),
        );
        let s = list(&i["records"], record);
        let ops = list(&i["ops"], op);
        let expected = &v["expected"]["commit"];
        match commit(w, c, &s, &ops) {
            Ok(after) => {
                let got: Vec<Json> = after.iter().map(record_json).collect();
                assert_eq!(json!(got), expected["ok"], "{name}: the Records after");
                assert_eq!(apply(w, c, &s, &ops), after, "{name}: apply");
            }
            Err(e) => {
                assert_eq!(
                    json!({ "refused": refused_json(e) }),
                    *expected,
                    "{name}: refused"
                );
                assert_eq!(
                    apply(w, c, &s, &ops),
                    s,
                    "{name}: a refused commit changes nothing"
                );
            }
        }
    }
}
