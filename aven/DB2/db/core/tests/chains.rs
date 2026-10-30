//! The chat's chains against Lean's traces (`db/spec/vectors/chats.json`, README rule 10): lines arriving at peers and
//! peers catching up; after each step the answers, the peer's heads, loose lines, forks and what its chat shows are
//! the model's. The model names lines by labels; here each is a real blob, named by its real BLAKE3, its previous
//! line's label replaced by that line's hash. The signature is the model's, taken as sound, as in `tests/chat.rs`.

use std::collections::BTreeMap;
use std::path::PathBuf;

use aven_db_core::chain::{Answer, Keeper, Line, missing};
use serde_json::{Value, json};

fn vectors(file: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../spec/vectors")
        .join(file);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// A signature as the model knows one: the key that made it and the bytes it signed.
fn signature(signer: &str, signed: &str) -> String {
    format!("{signer}\n{signed}")
}

fn verify(key: &str, body: &str, sig: &str) -> bool {
    sig == signature(key, body)
}

/// The model's line as a real one: its previous line by hash, signed over its real body unless the model's was
/// tampered with.
fn line(l: &Value, prev: Option<String>) -> Line {
    let text = |k: &str| l[k].as_str().unwrap().to_string();
    let mut line = Line {
        network: text("network"),
        device: text("device"),
        seq: l["seq"].as_u64().unwrap(),
        prev,
        at: l["at"].as_u64().unwrap(),
        sig: String::new(),
        text: text("text"),
    };
    let model = Line {
        prev: l["prev"].as_str().map(str::to_string),
        ..line.clone()
    };
    line.sig = if model.body() == text("signed") {
        signature(&text("signer"), &line.body())
    } else {
        signature(&text("signer"), "tampered")
    };
    line
}

/// Every label of a trace, with its real line and hash. A label only named as a previous line, never heard, stands for
/// a line nobody holds: its hash is the label's.
struct Labels {
    lines: BTreeMap<String, Value>,
    named: BTreeMap<String, (Line, String)>,
}

impl Labels {
    fn resolve(&mut self, label: &str) -> String {
        if let Some((_, id)) = self.named.get(label) {
            return id.clone();
        }
        let Some(l) = self.lines.get(label).cloned() else {
            return blake3::hash(label.as_bytes()).to_hex().to_string();
        };
        let prev = l["prev"].as_str().map(|p| self.resolve(p));
        let line = line(&l, prev);
        let id = blake3::hash(&line.blob()).to_hex().to_string();
        assert_eq!(Line::parse(&line.blob()).unwrap(), line);
        self.named.insert(label.to_string(), (line, id.clone()));
        id
    }

    fn get(&mut self, label: &str) -> (Line, String) {
        self.resolve(label);
        self.named[label].clone()
    }
}

fn answer(a: &Answer, label: &BTreeMap<String, String>) -> Value {
    match a {
        Answer::Moved(ids) => json!({ "moved": ids.iter().map(|i| &label[i]).collect::<Vec<_>>() }),
        Answer::Known => json!("known"),
        Answer::Gap => json!("gap"),
        Answer::Fork => json!("fork"),
        Answer::Refused(why) => json!({ "refused": why.name() }),
    }
}

#[test]
fn bodies_follow_the_vectors() {
    let all: Vec<Value> = vectors("chats.json")
        .into_iter()
        .filter(|v| v["input"].get("line").is_some())
        .collect();
    assert!(!all.is_empty());
    for v in all {
        let l = &v["input"]["line"];
        let line = line(l, l["prev"].as_str().map(str::to_string));
        assert_eq!(json!({ "body": line.body() }), v["expected"], "{}", v["name"]);
    }
}

#[test]
fn chains_follow_the_vectors() {
    let all: Vec<Value> = vectors("chats.json")
        .into_iter()
        .filter(|v| v["input"].get("steps").is_some())
        .collect();
    assert!(all.len() >= 60, "{} traces", all.len());
    for v in all {
        let network = v["input"]["network"].as_str().unwrap();
        let members: Vec<&str> = v["input"]["members"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m.as_str().unwrap())
            .collect();
        let member = |k: &str| members.contains(&k);
        let steps = v["input"]["steps"].as_array().unwrap();
        let mut labels = Labels {
            lines: steps
                .iter()
                .filter_map(|s| s.get("hear"))
                .map(|l| (l["id"].as_str().unwrap().to_string(), l.clone()))
                .collect(),
            named: BTreeMap::new(),
        };
        let all: Vec<String> = labels.lines.keys().cloned().collect();
        let label: BTreeMap<String, String> = all
            .iter()
            .map(|l| (labels.get(l).1, l.clone()))
            .collect();
        let mut peers: BTreeMap<String, Keeper> = BTreeMap::new();
        for (step, want) in steps.iter().zip(v["expected"].as_array().unwrap()) {
            let peer = step["peer"].as_str().unwrap().to_string();
            let mut answers = vec![];
            if let Some(l) = step.get("hear") {
                let (line, id) = labels.get(l["id"].as_str().unwrap());
                let k = peers.entry(peer.clone()).or_default();
                answers.push(k.receive(network, member, verify, id, line));
            } else {
                let src = peers
                    .get(step["catchUp"].as_str().unwrap())
                    .cloned()
                    .unwrap_or_default();
                let k = peers.entry(peer.clone()).or_default();
                for (device, _) in src.heads() {
                    for h in missing(src.chain(&device), k.chain(&device)).into_iter().cloned().collect::<Vec<_>>() {
                        answers.push(k.receive(network, member, verify, h.id, h.line));
                    }
                }
            }
            let k = peers.entry(peer.clone()).or_default();
            let got = json!({
                "peer": peer,
                "answers": answers.iter().map(|a| answer(a, &label)).collect::<Vec<_>>(),
                "heads": k.heads().iter().map(|(d, i)| json!([d, label[i]])).collect::<Vec<_>>(),
                "loose": k.loose().iter().map(|h| &label[&h.id]).collect::<Vec<_>>(),
                "forks": k.forks().iter().map(|i| &label[i]).collect::<Vec<_>>(),
                "shown": k.shown().iter().map(|h| &label[&h.id]).collect::<Vec<_>>(),
            });
            assert_eq!(&got, want, "{}", v["name"]);
        }
    }
}
