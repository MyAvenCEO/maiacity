//! Docs in the Peers against the model (`Aven.Peer.DocSync`, README rule 10): each epoch key's topic
//! (`peer/spec/vectors/topics.json`), and on every generated world of two readers, each reader's tips, what each answers
//! the other's with, the splits each holds and how many names each holds after one exchange
//! (`peer/spec/vectors/doc-sync.json`); and what sifting a page that crashed the judge marks unfit (`judge.json`).

use std::collections::BTreeSet;

use aven_core::Hash;
use aven_peer::docs::{Entry, Live, Run, Sifting, Tip, beyond, group_topic, split, tips, version};
use serde_json::Value;

fn vectors(file: &str) -> Vec<Value> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../spec/vectors")
        .join(file);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
        .lines()
        .map(|l| serde_json::from_str(l).expect("a vector"))
        .collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex"))
        .collect()
}

fn hash(v: &Value) -> Hash {
    Hash::parse(v.as_str().expect("a name")).expect("b3:<hex>")
}

fn entry(v: &Value) -> Entry {
    Entry {
        name: hash(&v["name"]),
        writer: v["writer"].as_u64().expect("writer"),
        seq: v["seq"].as_u64().expect("seq"),
        prev: (!v["prev"].is_null()).then(|| hash(&v["prev"])),
        deps: v["deps"]
            .as_array()
            .expect("deps")
            .iter()
            .map(hash)
            .collect(),
    }
}

fn tip(v: &Value) -> Tip {
    Tip {
        writer: v["writer"].as_u64().expect("writer"),
        seq: v["seq"].as_u64().expect("seq"),
        name: hash(&v["name"]),
    }
}

fn names(es: &[&Entry]) -> Vec<String> {
    es.iter().map(|e| e.name.text()).collect()
}

fn held(entries: &[Entry], v: &Value) -> Vec<Entry> {
    entries
        .iter()
        .zip(v.as_array().expect("held"))
        .filter(|(_, h)| h.as_bool().expect("a bool"))
        .map(|(e, _)| e.clone())
        .collect()
}

#[test]
fn topics_are_the_models() {
    let vs = vectors("topics.json");
    assert!(!vs.is_empty());
    for v in vs {
        let key: [u8; 32] = unhex(v["input"]["key"].as_str().unwrap())
            .try_into()
            .unwrap();
        let want = unhex(v["expected"]["topic"].as_str().unwrap());
        let wire = v["input"]["wire"].as_u64().unwrap();
        assert_eq!(group_topic(wire, &key).to_vec(), want, "{}", v["name"]);
    }
}

#[test]
fn sync_is_the_models() {
    let vs = vectors("doc-sync.json");
    assert!(vs.len() >= 60);
    for v in vs {
        let name = &v["name"];
        let entries: Vec<Entry> = v["input"]["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(entry)
            .collect();
        let a = held(&entries, &v["input"]["a"]);
        let b = held(&entries, &v["input"]["b"]);
        let x = &v["expected"];
        let want = |k: &str| x[k].as_array().unwrap().iter().map(tip).collect::<Vec<_>>();
        assert_eq!(tips(&a), want("tipsA"), "{name}: A's tips");
        assert_eq!(tips(&b), want("tipsB"), "{name}: B's tips");
        assert_eq!(
            version(&tips(&a)),
            hash(&x["versionA"]),
            "{name}: A's version"
        );
        assert_eq!(
            version(&tips(&b)),
            hash(&x["versionB"]),
            "{name}: B's version"
        );
        let mut backwards = tips(&a);
        backwards.reverse();
        assert_eq!(
            version(&backwards),
            hash(&x["versionA"]),
            "{name}: one version, any order"
        );
        let to_b = beyond(&a, &tips(&b));
        let to_a = beyond(&b, &tips(&a));
        let answer = |k: &str| {
            x[k].as_array()
                .unwrap()
                .iter()
                .map(|n| n.as_str().unwrap().to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(names(&to_b), answer("aAnswersB"), "{name}: A's answer");
        assert_eq!(names(&to_a), answer("bAnswersA"), "{name}: B's answer");
        for (w, s) in x["splitA"].as_object().unwrap() {
            assert_eq!(
                split(&a, w.parse().unwrap()),
                s.as_bool().unwrap(),
                "{name}: A's split in {w}"
            );
        }
        for (w, s) in x["splitB"].as_object().unwrap() {
            assert_eq!(
                split(&b, w.parse().unwrap()),
                s.as_bool().unwrap(),
                "{name}: B's split in {w}"
            );
        }
        let count = |mine: &[Entry], got: &[&Entry]| {
            mine.iter()
                .map(|e| e.name)
                .chain(got.iter().map(|e| e.name))
                .collect::<BTreeSet<_>>()
                .len() as u64
        };
        assert_eq!(
            count(&a, &to_a),
            x["heldA"].as_u64().unwrap(),
            "{name}: what A holds after"
        );
        assert_eq!(
            count(&b, &to_b),
            x["heldB"].as_u64().unwrap(),
            "{name}: what B holds after"
        );
    }
}

#[test]
fn live_is_the_models() {
    let vs = vectors("live.json");
    assert!(vs.len() >= 10);
    for v in vs {
        let name = &v["name"];
        if v["expected"].is_null() {
            let bytes = unhex(v["input"]["bytes"].as_str().unwrap());
            assert_eq!(Live::decode(&bytes), None, "{name}");
            continue;
        }
        let live = if v["input"]["version"].is_string() {
            let h = |k: &str| Hash(unhex(v["input"][k].as_str().unwrap()).try_into().unwrap());
            Live::Version {
                doc: h("doc"),
                version: h("version"),
            }
        } else {
            let sealed = unhex(v["input"]["sealed"].as_str().unwrap());
            Live::of(aven_core::blake3(&[1]), &sealed)
        };
        let kind = match live {
            Live::Sealed(_) => "sealed",
            Live::Hash { .. } => "hash",
            Live::Version { .. } => "version",
        };
        assert_eq!(kind, v["expected"]["kind"], "{name}");
        let bytes = unhex(v["expected"]["bytes"].as_str().unwrap());
        assert_eq!(live.encode(), bytes, "{name}");
        assert_eq!(Live::decode(&bytes), Some(live), "{name}: read back");
    }
}

#[test]
fn sifting_is_the_models() {
    let vs = vectors("judge.json");
    assert!(vs.len() >= 6);
    let nums = |v: &Value| -> Vec<u64> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|n| n.as_u64().unwrap())
            .collect()
    };
    for v in vs {
        let page = nums(&v["input"]["page"]);
        let kills = nums(&v["input"]["kills"]);
        let when: Vec<(u64, u64)> = v["input"]["when"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| (p[0].as_u64().unwrap(), p[1].as_u64().unwrap()))
            .collect();
        let mut s = Sifting::new(page);
        while let Some(e) = s.trying() {
            let crashes =
                kills.contains(&e) || when.iter().any(|(x, a)| *x == e && s.held().contains(a));
            s.report(if crashes { Run::Crashed } else { Run::Done });
        }
        assert_eq!(
            s.unfit().to_vec(),
            nums(&v["expected"]["unfit"]),
            "{}",
            v["name"]
        );
    }
}
