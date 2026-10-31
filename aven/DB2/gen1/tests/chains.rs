//! The chat's chains against Lean's traces (`db/spec/vectors/chats.json`, README rule 10): lines arriving at peers and
//! peers catching up; after each step the answers, the peer's heads, loose lines, forks and what its chat shows are
//! the model's. The model names lines by labels; here each is a real blob, named by its real BLAKE3, its previous
//! line's label replaced by that line's hash. The signature is the model's, taken as sound, as in `tests/chat.rs`.

use std::collections::BTreeMap;
use std::path::PathBuf;

use aven_gen1::chain::{Answer, Body, Keeper, Line, Retraction, missing};
use aven_gen1::files::Announcement;
use serde_json::{Value, json};

fn vectors(file: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../db/spec/vectors")
        .join(file);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// A signature as the model knows one: the key that made it and the bytes it signed, hashed, so it fits on the
/// blob's `sig` line.
fn signature(signer: &str, signed: &str) -> String {
    blake3::hash(format!("{signer}\n{signed}").as_bytes())
        .to_hex()
        .to_string()
}

fn verify(key: &str, signs: &str, sig: &str) -> bool {
    sig == signature(key, signs)
}

/// The model's body; a retraction's line and previous line by `name` (a label's real hash in a trace).
fn body(b: &Value, name: &mut impl FnMut(&str) -> String) -> Body {
    if let Some(t) = b.get("retract") {
        return Body::Retract(Retraction {
            target: name(t.as_str().unwrap()),
            device: b["device"].as_str().unwrap().to_string(),
            seq: b["seq"].as_u64().unwrap(),
            prev: b["prev"].as_str().map(&mut *name),
            at: b["at"].as_u64().unwrap(),
        });
    }
    match b.get("text") {
        Some(t) => Body::Text(t.as_str().unwrap().to_string()),
        None => Body::File(Announcement {
            file: b["file"].as_str().unwrap().to_string(),
            size: b["size"].as_u64().unwrap(),
            name: b["name"].as_str().unwrap().to_string(),
            kind: b["type"].as_str().unwrap().to_string(),
        }),
    }
}

/// The model's line as a real one: its previous line (and a retraction's lines) by hash, signed over what it really
/// signs unless the model's was tampered with.
fn line(l: &Value, prev: Option<String>, name: &mut impl FnMut(&str) -> String) -> Line {
    let text = |k: &str| l[k].as_str().unwrap().to_string();
    let mut line = Line {
        network: text("network"),
        device: text("device"),
        seq: l["seq"].as_u64().unwrap(),
        prev,
        at: l["at"].as_u64().unwrap(),
        sig: String::new(),
        body: body(&l["body"], name),
    };
    let model = Line {
        prev: l["prev"].as_str().map(str::to_string),
        body: body(&l["body"], &mut |s: &str| s.to_string()),
        ..line.clone()
    };
    line.sig = if model.signs() == text("signed") {
        signature(&text("signer"), &line.signs())
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
    /// labels never heard, by their stand-in hash: lines only named, by a previous line or a retraction
    unheard: BTreeMap<String, String>,
}

impl Labels {
    fn resolve(&mut self, label: &str) -> String {
        if let Some((_, id)) = self.named.get(label) {
            return id.clone();
        }
        let Some(l) = self.lines.get(label).cloned() else {
            let id = blake3::hash(label.as_bytes()).to_hex().to_string();
            self.unheard.insert(id.clone(), label.to_string());
            return id;
        };
        let prev = l["prev"].as_str().map(|p| self.resolve(p));
        let line = line(&l, prev, &mut |p: &str| self.resolve(p));
        let id = blake3::hash(&line.blob()).to_hex().to_string();
        // a well-formed line reads back as itself, field by field; one whose type breaks the line can't, which is why
        // it is refused. The model's labels aren't hex, so the canonical reading has vectors of its own (`read`)
        if line.body.check().is_ok() {
            assert_eq!(
                Line::read_kept(&line.blob()).map(|(l, _)| l),
                Some(line.clone()),
                "{}",
                String::from_utf8_lossy(&line.blob())
            );
        }
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
fn what_a_line_signs_follows_the_vectors() {
    let all: Vec<Value> = vectors("chats.json")
        .into_iter()
        .filter(|v| v["input"].get("line").is_some())
        .collect();
    assert!(!all.is_empty());
    for v in all {
        let l = &v["input"]["line"];
        let line = line(l, l["prev"].as_str().map(str::to_string), &mut |s: &str| {
            s.to_string()
        });
        assert_eq!(
            json!({ "signs": line.signs() }),
            v["expected"],
            "{}",
            v["name"]
        );
    }
}

/// A blob read as a line, or refused as not canonical, as Lean reads it (`Aven.DB.Chains.read`); a line taken renders
/// back to exactly its bytes.
#[test]
fn reads_follow_the_vectors() {
    let all: Vec<Value> = vectors("chats.json")
        .into_iter()
        .filter(|v| v["input"].get("read").is_some())
        .collect();
    assert!(all.len() > 10);
    for v in all {
        let blob = v["input"]["read"].as_str().unwrap().as_bytes();
        let got = match Line::parse(blob) {
            Ok(l) => {
                assert_eq!(l.blob(), blob, "{}", v["name"]);
                let mut fields = json!({
                    "network": l.network, "device": l.device, "seq": l.seq, "prev": l.prev, "at": l.at,
                    "sig": l.sig,
                });
                fields["body"] = match &l.body {
                    Body::Text(t) => json!({ "text": t }),
                    Body::File(f) => {
                        json!({ "file": f.file, "size": f.size, "name": f.name, "type": f.kind })
                    }
                    Body::Retract(r) => json!({ "retract": r.target, "device": r.device,
                        "seq": r.seq, "prev": r.prev, "at": r.at }),
                    Body::Redacted => json!({ "redacted": true }),
                };
                json!({ "line": fields })
            }
            Err(why) => json!({ "refused": why.name() }),
        };
        assert_eq!(got, v["expected"], "{}", v["name"]);
    }
}

#[test]
fn a_blob_that_is_no_utf8_is_not_canonical() {
    assert_eq!(
        Line::parse(b"avenDB line 1\nnetwork \xff"),
        Err(aven_gen1::chain::Refusal::NotCanonical)
    );
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
        let vaults = &v["input"]["vaults"];
        let author = |d: &str| vaults[d].as_str().unwrap_or(d).to_string();
        let steps = v["input"]["steps"].as_array().unwrap();
        let mut labels = Labels {
            lines: steps
                .iter()
                .filter_map(|s| s.get("hear"))
                .map(|l| (l["id"].as_str().unwrap().to_string(), l.clone()))
                .collect(),
            named: BTreeMap::new(),
            unheard: BTreeMap::new(),
        };
        let all: Vec<String> = labels.lines.keys().cloned().collect();
        let mut label: BTreeMap<String, String> =
            all.iter().map(|l| (labels.get(l).1, l.clone())).collect();
        label.extend(labels.unheard.clone());
        let files = |k: &Keeper| -> std::collections::BTreeSet<String> {
            k.all()
                .filter_map(|h| match &h.line.body {
                    Body::File(f) => Some(f.file.clone()),
                    _ => None,
                })
                .collect()
        };
        let mut peers: BTreeMap<String, Keeper> = BTreeMap::new();
        for (step, want) in steps.iter().zip(v["expected"].as_array().unwrap()) {
            let peer = step["peer"].as_str().unwrap().to_string();
            let mut answers = vec![];
            let dropped: Vec<String>;
            if let Some(l) = step.get("hear") {
                let (line, id) = labels.get(l["id"].as_str().unwrap());
                let k = peers.entry(peer.clone()).or_default();
                let (answer, settled) = k.take(network, member, verify, &author, id, line);
                answers.push(answer);
                dropped = settled.dropped;
            } else {
                let src = peers
                    .get(step["catchUp"].as_str().unwrap())
                    .cloned()
                    .unwrap_or_default();
                let k = peers.entry(peer.clone()).or_default();
                let before = files(k);
                // a line held without its text goes as the retraction that counts for it
                let all: Vec<_> = src
                    .heads()
                    .iter()
                    .flat_map(|(device, _)| missing(src.chain(device), k.chain(device)))
                    .filter_map(|h| src.stand_in(&author, h))
                    .collect();
                // the retractions first (`Aven.DB.Chains.Keeper.catchUpAll`)
                let (first, rest): (Vec<_>, Vec<_>) = all
                    .into_iter()
                    .partition(|h| matches!(h.line.body, Body::Retract(_)));
                for h in first.into_iter().chain(rest) {
                    answers.push(k.take(network, member, verify, &author, h.id, h.line).0);
                }
                dropped = before.difference(&files(k)).cloned().collect();
            }
            let k = peers.entry(peer.clone()).or_default();
            let got = json!({
                "peer": peer,
                "answers": answers.iter().map(|a| answer(a, &label)).collect::<Vec<_>>(),
                "heads": k.heads().iter().map(|(d, i)| json!([d, label[i]])).collect::<Vec<_>>(),
                "loose": k.loose().iter().map(|h| &label[&h.id]).collect::<Vec<_>>(),
                "forks": k.forks().iter().map(|i| &label[i]).collect::<Vec<_>>(),
                "shown": k.shown().iter().map(|h| &label[&h.id]).collect::<Vec<_>>(),
                "deleted": k.shown().iter().filter(|h| k.deleted(&author, h)).map(|h| &label[&h.id])
                    .collect::<Vec<_>>(),
                "dropped": dropped,
            });
            assert_eq!(&got, want, "{}", v["name"]);
        }
    }
}
