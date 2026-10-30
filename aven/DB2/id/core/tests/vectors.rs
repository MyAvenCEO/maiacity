//! aven-id against Lean's vectors (README rule 10): every expected value here comes from `id/spec`, written by
//! `lake exe vectors`; this file writes none of its own.

mod common;

use aven_id::{Tree, test_signer};
use common::{answer, parse, result, sign_error, vectors};
use serde_json::{Value, json};

const CAST: &str = include_str!("../../../sandbox/cast.json");

fn cast() -> Tree {
    Tree::from_cast(CAST).expect("the cast is a well-formed tree")
}

#[test]
fn trees_answer_as_the_model_does() {
    let all = vectors("trees.json");
    assert!(all.len() >= 100, "{} tree vectors", all.len());
    for v in &all {
        let input = &v["input"];
        let queries = input["queries"].as_array().unwrap();
        let got = match parse(input) {
            Ok((keys, vaults)) => result(&keys, &vaults, queries),
            // the model's reason is its own text: what must agree is that this is no tree
            Err(_) => json!({ "format": v["expected"]["format"] }),
        };
        assert_eq!(got, v["expected"], "{}", v["name"]);
    }
}

/// The model's cast is `sandbox/cast.json`'s: the same keys, vaults, kinds and owners, in the same order.
#[test]
fn the_models_cast_is_the_casts() {
    let all = vectors("trees.json");
    let lean = all
        .iter()
        .find(|v| v["name"] == "the cast: every query")
        .expect("the cast's vector");
    let t = cast();
    let keys: Vec<String> = t.keys().map(|(id, _)| id.to_string()).collect();
    let mut ours = common::case(&keys, t.vaults());
    ours["queries"] = lean["input"]["queries"].clone();
    assert_eq!(ours, lean["input"]);
    // and the cast read from its file answers as the model does, keys with their real public halves
    let queries = lean["input"]["queries"].as_array().unwrap();
    let answers: Vec<Value> = queries.iter().map(|q| answer(&t, q)).collect();
    assert_eq!(json!({ "wf": true, "answers": answers }), lean["expected"]);
}

/// The cast's devices sign with their real keys; the model says what each statement is for and whether it holds.
#[test]
fn statements_hold_as_the_model_says() {
    let t = cast();
    for v in vectors("statements.json") {
        let i = &v["input"];
        let text = |key: &str| i[key].as_str().unwrap();
        let body = text("body").as_bytes();
        let got = match t.sign(text("device"), &test_signer(text("key")), body) {
            Err(e) => json!({ "signs": sign_error(&e), "holds": null }),
            Ok(mut s) => {
                let signs = json!({ "vault": s.vault });
                for change in i["changes"].as_array().unwrap() {
                    let to = change[1].as_str().unwrap();
                    match change[0].as_str().unwrap() {
                        "device" => s.device = to.into(),
                        "vault" => s.vault = to.into(),
                        "body" => s.body = to.as_bytes().to_vec(),
                        // another key's signature over the same body
                        "resign" => {
                            s.signature = t.sign(to, &test_signer(to), body).unwrap().signature
                        }
                        other => panic!("unknown change {other}"),
                    }
                }
                let holds = match i["target"].as_str() {
                    Some(target) => t.acts_on(&s, target).map(|b| json!(b)),
                    None => t.verify(&s).map(|()| json!(true)),
                };
                json!({ "signs": signs, "holds": holds.unwrap_or_else(|e| sign_error(&e)) })
            }
        };
        assert_eq!(got, v["expected"], "{}", v["name"]);
    }
}
