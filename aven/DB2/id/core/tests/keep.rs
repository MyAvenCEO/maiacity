//! Keepers against Lean's vectors (`keep.json`, `Aven.ID.Keep`): the fetch keys a keeper takes, its current key, its
//! flags and whether a fork is unsettled; which proofs it serves; what it keeps under its keep caps and offers; and how
//! much it keeps for each vault. Every expected value is the model's. The bill and admission cases are the keeper's
//! now (`Aven.Peer.Serve`), so they aren't replayed here.

mod common;

use aven_id::keep::{Books, Choice, FetchLink, Keep, KeepOrder, Listing, Order, Proof};
use common::caps::{Context, Names};
use common::vectors;
use serde_json::{Value, json};

type K = u64;

fn keep(v: &Value) -> Keep<String, u64, K> {
    let link = |l: &Value| FetchLink {
        doc: l["doc"].as_str().unwrap().into(),
        n: l["n"].as_u64().unwrap(),
        epoch: l["epoch"].as_u64().unwrap(),
        key: l["key"].as_u64().unwrap(),
        prev: l["prev"].as_u64().unwrap(),
        signer: l["signer"].as_u64().unwrap(),
    };
    Keep {
        doc: v["doc"].as_str().unwrap().into(),
        genesis: v["genesis"].as_u64().unwrap(),
        links: v["links"].as_array().unwrap().iter().map(link).collect(),
        issuer: v["issuer"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().into())
            .collect(),
        choices: v["choices"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| Choice {
                depth: c["depth"].as_u64().unwrap(),
                fork: c["fork"].as_u64().unwrap(),
                branch: c["branch"].as_u64().unwrap(),
                signer: c["signer"].as_str().unwrap().into(),
            })
            .collect(),
    }
}

fn proof(v: &Value) -> Proof<K, String> {
    Proof {
        device: v["device"].as_str().unwrap().into(),
        vault: v["vault"].as_str().unwrap().into(),
        key: v["key"].as_u64().unwrap(),
        exporter: v["exporter"].as_str().unwrap().into(),
    }
}

/// Pairs of depth and key, each once, in order (`keepResult`).
fn pairs(mut ps: Vec<(u64, K)>) -> Value {
    ps.sort();
    ps.dedup();
    Value::Array(
        ps.into_iter()
            .map(|(d, k)| json!({ "depth": d, "key": k }))
            .collect(),
    )
}

fn keep_result(k: &Keep<String, u64, K>) -> Value {
    let kept = (0..=k.depth())
        .flat_map(|i| k.level(i).into_iter().map(move |key| (i, key)))
        .collect();
    json!({ "kept": pairs(kept), "current": k.current(), "flags": pairs(k.flags()), "unsettled": k.unsettled() })
}

/// A keeper's books on a context, as the vectors write them.
fn with_books<T>(v: &Value, f: impl FnOnce(&Books<'_, K>, &Names) -> T) -> T {
    let names = Names::default();
    // the books' tree, threshold and groups, read as a caps context reads them
    let ctx = Context::of(
        &names,
        &json!({ "tree": v["tree"], "threshold": v["threshold"], "groups": v["groups"], "roles": [], "docs": [] }),
    );
    let listings = v["listings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| Listing {
            cap: names.cap(&l["cap"]),
            docs: l["docs"]
                .as_array()
                .unwrap()
                .iter()
                .map(|d| {
                    (
                        names.doc(d["doc"].as_str().unwrap()),
                        d["fetchKey"].as_u64().unwrap(),
                    )
                })
                .collect(),
        })
        .collect();
    let orders = v["orders"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| KeepOrder {
            order: match o.get("withdraw") {
                Some(c) => Order::Withdraw(c.as_str().unwrap().into()),
                None => Order::Delete(names.doc(o["delete"].as_str().unwrap())),
            },
            signer: o["signer"].as_str().unwrap().into(),
        })
        .collect();
    let offers = v["offers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| names.cap(o))
        .collect();
    ctx.with(|x| {
        let b = Books {
            keeper: v["keeper"].as_str().unwrap().into(),
            tree: x.tree,
            threshold: x.threshold,
            listings,
            orders,
            offers,
            in_group: x.in_group,
        };
        f(&b, &names)
    })
}

#[test]
fn keepers_answer_as_the_model_does() {
    let all = vectors("keep.json");
    let mut replayed = 0;
    for v in &all {
        let input = &v["input"];
        let got = if input.get("proof").is_some() {
            let k = keep(&input["keep"]);
            json!({ "served": k.serves(&input["exporter"].as_str().unwrap().to_string(), &proof(&input["proof"])) })
        } else if input.get("books").is_some() && input.get("docs").is_some() {
            with_books(&input["books"], |b, names| {
                let kept: Vec<String> = input["docs"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|d| d.as_str().unwrap())
                    .filter(|d| b.keeps(&names.doc(d)))
                    .map(str::to_string)
                    .collect();
                json!({ "kept": kept })
            })
        } else if input.get("books").is_some() && input.get("vaults").is_some() {
            with_books(&input["books"], |b, _| {
                let quota: serde_json::Map<String, Value> = input["vaults"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|w| {
                        let w = w.as_str().unwrap();
                        (w.to_string(), json!(b.quota(w)))
                    })
                    .collect();
                json!({ "quota": quota })
            })
        } else if input.get("uploads").is_some() {
            // bills and admission are the keeper's (`Aven.Peer.Serve`)
            continue;
        } else {
            keep_result(&keep(&input["keep"]))
        };
        assert_eq!(got, v["expected"], "{}", v["name"]);
        replayed += 1;
    }
    assert!(replayed >= 60, "{replayed} keep vectors replayed");
}
