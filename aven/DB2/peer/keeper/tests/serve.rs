//! A keeper serving a connection against Lean's traces (`peer/spec/vectors/serve.json`, README rule 10): a gate given by
//! its verdicts (which proof of which Doc it serves, for which vault; each vault's quota) and asks on one connection;
//! each reply is the model's. avenID's gate (`Aven.ID.Keep`) implements [`Gate`] for real; this one is its verdicts.

use std::collections::BTreeMap;
use std::path::PathBuf;

use aven_peer_keeper::Put;
use aven_peer_keeper::serve::{Conn, Gate, Keeper, Reply, UploadRefused};
use serde_json::{Value, json};

fn vectors(file: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../peer/spec/vectors")
        .join(file);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// The gate by the model's verdicts.
struct Verdicts {
    serves: Vec<(String, u64, String)>,
    quotas: BTreeMap<String, u64>,
}

impl Gate<String> for Verdicts {
    type Proof = u64;
    type Vault = String;
    fn serves(&self, doc: &String, _exporter: &[u8; 32], proof: &u64) -> Option<String> {
        self.serves
            .iter()
            .find(|(d, p, _)| d == doc && p == proof)
            .map(|(_, _, v)| v.clone())
    }
    fn quota(&self, vault: &String) -> u64 {
        self.quotas.get(vault).copied().unwrap_or(0)
    }
}

fn nums(v: &Value) -> Vec<u64> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_u64().unwrap())
        .collect()
}

fn pair(e: &[u64]) -> Value {
    json!([e[0], e[1]])
}

fn reply(r: &Reply<u64>, doc: &str) -> Value {
    match r {
        Reply::Proven => json!({"reply": "proven", "doc": doc}),
        Reply::ProveRefused => json!({"reply": "prove_refused", "doc": doc}),
        Reply::Took(ns) => {
            json!({"reply": "took", "doc": doc, "numbers": ns.iter().map(|(h, n)| pair(&[*h, *n])).collect::<Vec<_>>()})
        }
        Reply::UploadRefused(UploadRefused::Quota) => {
            json!({"reply": "upload_refused", "doc": doc, "why": "quota"})
        }
        Reply::Arrived { entries, more } => json!({"reply": "arrived", "doc": doc,
            "entries": entries.iter().map(|(n, h)| pair(&[*n, *h])).collect::<Vec<_>>(), "more": more}),
        Reply::Fetched(a) => {
            json!({"reply": "fetched", "doc": doc, "served": a.served, "missing": a.missing, "later": a.later})
        }
        Reply::Refused => json!({"reply": "refused", "doc": doc}),
    }
}

#[test]
fn replies_are_the_models() {
    let vs = vectors("serve.json");
    assert!(vs.len() > 60);
    for v in vs {
        let name = v["name"].as_str().unwrap();
        let input = &v["input"];
        let gate = Verdicts {
            serves: input["serves"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| {
                    (
                        s["doc"].as_str().unwrap().into(),
                        s["proof"].as_u64().unwrap(),
                        s["vault"].as_str().unwrap().into(),
                    )
                })
                .collect(),
            quotas: input["quotas"]
                .as_array()
                .unwrap()
                .iter()
                .map(|q| {
                    (
                        q["vault"].as_str().unwrap().into(),
                        q["quota"].as_u64().unwrap(),
                    )
                })
                .collect(),
        };
        let quotas: Vec<String> = gate.quotas.keys().cloned().collect();
        let mut k = Keeper::<String, u64, _>::new(gate);
        let mut conns: BTreeMap<String, Conn<String, String>> = BTreeMap::new();
        let asks = input["asks"].as_array().unwrap();
        let wants = v["expected"]["replies"].as_array().unwrap();
        for (i, (a, want)) in asks.iter().zip(wants).enumerate() {
            let doc = a["doc"].as_str().unwrap().to_string();
            let device = a["device"].as_str().unwrap();
            let c = conns
                .entry(device.to_string())
                .or_insert_with(|| Conn::new(device, [0; 32]));
            let r = match a["ask"].as_str().unwrap() {
                "prove" => k.prove(c, &doc, &a["proof"].as_u64().unwrap()),
                "upload" => {
                    let puts: Vec<Put<u64>> = a["puts"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|p| Put {
                            hash: p["hash"].as_u64().unwrap(),
                            bytes: p["bytes"].as_u64().unwrap(),
                            covers: nums(&p["covers"]),
                        })
                        .collect();
                    k.upload(c, &doc, &puts)
                }
                "after" => k.after(c, &doc, a["n"].as_u64().unwrap()),
                "fetch" => k.fetch(c, &doc, &nums(&a["hashes"])),
                other => panic!("{name}: an ask {other}"),
            };
            assert_eq!(reply(&r, &doc), *want, "{name}: ask {i}");
        }
        for vault in quotas {
            assert_eq!(
                json!(k.bill(&vault)),
                v["expected"]["bills"][&vault],
                "{name}: {vault}'s bill"
            );
        }
    }
}
