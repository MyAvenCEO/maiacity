//! The Lean's formats, byte for byte: `db/spec/vectors/genesis.json`, `bodies.json`, `segments.json`, `heads.json`,
//! `loro.json`, and avenID's `id/spec/vectors/seals.json` (`Aven.DB.Docs.Genesis`, `Body`, `Segment`, `Head`,
//! `loroAgrees`; `Aven.ID.Seal`).

use std::collections::BTreeMap;

use aven_core::{DocId, Envelope, Hash, Value, decode, encode};
use aven_db_docs::schema::{BUILTIN_NAMES, builtin_type, is_builtin};
use aven_db_docs::seal::{
    Kind, Sealed, aad, cipher_key, commit, kind_of, open, pad, padme, seal_with_nonce, unpad,
};
use aven_db_docs::{
    Body, Call, EpochKey, Genesis, Head, Limits, OpId, Segment, Version, loro_agrees,
};
use aven_id::Secret;
use serde_json::Value as Json;

fn vectors(path: &str) -> Vec<Json> {
    let path = format!("{}/../../{path}", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let Json::Array(vs) = serde_json::from_str(&text).unwrap() else {
        panic!("{path}: not an array")
    };
    assert!(!vs.is_empty(), "{path}: no vectors");
    vs
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn s(j: &Json) -> &str {
    j.as_str().unwrap()
}

fn h32(j: &Json) -> [u8; 32] {
    unhex(s(j)).try_into().unwrap()
}

fn hash(j: &Json) -> Hash {
    Hash::parse(s(j)).unwrap()
}

#[test]
fn seals() {
    for v in vectors("id/spec/vectors/seals.json") {
        let (name, i, x) = (s(&v["name"]), &v["input"], &v["expected"]);
        if let Some(rest) = name.strip_prefix("Padmé of ") {
            let l: usize = rest.parse().unwrap();
            assert_eq!(padme(l) as u64, x.as_u64().unwrap(), "{name}");
            continue;
        }
        if name.starts_with("unpad: ") {
            let got = unpad(&unhex(s(i)));
            assert_eq!(got.map(|b| hex(&b)), x.as_str().map(String::from), "{name}");
            continue;
        }
        if name.starts_with("matching no kind: ") {
            let outside = unhex(s(&i["outside"]));
            let sealed = Sealed::decode(&outside, 1 << 20).unwrap();
            let ek = EpochKey {
                name: sealed.epoch,
                key: Secret::take(&mut h32(&i["epochKey"])),
            };
            assert!(x["kind"].is_null(), "{name}");
            assert_eq!(kind_of(&ek, &outside, 1 << 20), None, "{name}");
            continue;
        }
        let kind = Kind::parse(s(&i["kind"])).unwrap();
        let key = h32(&i["epochKey"]);
        let doc = DocId::parse(s(&i["doc"])).unwrap();
        let epoch = Hash(h32(&i["epoch"]));
        let nonce: [u8; 24] = unhex(s(&i["nonce"])).try_into().unwrap();
        let pt = unhex(s(&i["plaintext"]));
        let a = aad(kind, &doc, &epoch);
        assert_eq!(
            hex(&cipher_key(kind, &key)),
            s(&x["cipherKey"]),
            "{name}: cipher key"
        );
        assert_eq!(
            hex(&aven_db_docs::seal::commit_key(kind, &key)),
            s(&x["commitKey"]),
            "{name}: commit key"
        );
        assert_eq!(hex(&a), s(&x["aad"]), "{name}: aad");
        assert_eq!(
            hex(&commit(kind, &key, &a, &nonce)),
            s(&x["commit"]),
            "{name}: commit"
        );
        assert_eq!(hex(&pad(&pt)), s(&x["padded"]), "{name}: padded");
        // the outside's bytes, with the vector's fixture ciphertext
        let fixture = Sealed {
            ct: unhex(s(&i["ct"])),
            doc,
            epoch,
            nonce,
            commit: commit(kind, &key, &a, &nonce),
        };
        assert_eq!(hex(&fixture.encode()), s(&x["outside"]), "{name}: outside");
        assert_eq!(
            Sealed::decode(&fixture.encode(), 1 << 20),
            Some(fixture.clone())
        );
        // and a real seal with XChaCha20-Poly1305: the same frame, the padded length plus its tag, and it opens
        let ek = EpochKey {
            name: epoch,
            key: Secret::take(&mut key.clone()),
        };
        let real = seal_with_nonce(kind, &ek, &doc, &pt, nonce);
        assert_eq!(
            real.ct.len(),
            fixture.ct.len(),
            "{name}: the ciphertext's length"
        );
        assert_eq!(real.commit, fixture.commit);
        // the kind a reader finds by the commitment alone, on the fixture and on the real seal
        let found = Kind::parse(s(&x["kind"]));
        assert_eq!(found, Some(kind), "{name}: the kind found");
        assert_eq!(
            kind_of(&ek, &fixture.encode(), 1 << 20),
            found,
            "{name}: kind_of"
        );
        assert_eq!(
            kind_of(&ek, &real.encode(), 1 << 20),
            found,
            "{name}: kind_of, sealed"
        );
        assert_eq!(
            open(kind, &ek, &real.encode(), 1 << 20),
            Some((doc, pt.clone())),
            "{name}: opens"
        );
        let other = [Kind::Envelope, Kind::Segment, Kind::Snapshot]
            .into_iter()
            .find(|k| *k != kind)
            .unwrap();
        assert_eq!(
            open(other, &ek, &real.encode(), 1 << 20),
            None,
            "{name}: another kind's keys don't open it"
        );
    }
}

fn genesis_of(i: &Json) -> Genesis {
    let pins: Vec<(DocId, Hash)> = i["pins"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|p| {
            let t = DocId::parse(s(&p[0])).unwrap();
            p[1].as_array().unwrap().iter().map(move |h| (t, hash(h)))
        })
        .collect();
    Genesis::new(
        &unhex(s(&i["vault"])),
        DocId::parse(s(&i["type"])).unwrap(),
        &pins,
        h32(&i["nonce"]),
    )
}

#[test]
fn genesis() {
    for v in vectors("db/spec/vectors/genesis.json") {
        let (name, i, x) = (s(&v["name"]), &v["input"], &v["expected"]);
        if name == "the built-in types" {
            let names: Vec<&str> = i.as_array().unwrap().iter().map(s).collect();
            assert_eq!(names, BUILTIN_NAMES);
            let ids: Vec<String> = BUILTIN_NAMES
                .iter()
                .map(|n| builtin_type(n).text())
                .collect();
            let want: Vec<&str> = x.as_array().unwrap().iter().map(s).collect();
            assert_eq!(ids, want);
            continue;
        }
        let g = genesis_of(i);
        assert_eq!(hex(&g.encode()), s(&x["value"]), "{name}: value");
        assert_eq!(g.id().text(), s(&x["id"]), "{name}: id");
        assert_eq!(g.ok(is_builtin), x["ok"].as_bool().unwrap(), "{name}: ok");
        assert_eq!(Genesis::decode(&g.encode()), Some(g), "{name}: reads back");
    }
}

#[test]
fn bodies() {
    for v in vectors("db/spec/vectors/bodies.json") {
        let (name, i, x) = (s(&v["name"]), &v["input"], &v["expected"]);
        if name.starts_with("refused: ") {
            let val = decode(&unhex(s(i))).unwrap();
            assert_eq!(
                Body::of_value(&val).is_some(),
                x.as_bool().unwrap(),
                "{name}"
            );
            continue;
        }
        let b = Body {
            acks: i["acks"].as_array().unwrap().iter().map(hash).collect(),
            at: s(&i["at"]).into(),
            calls: i["calls"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| Call::of_value(&decode(&unhex(s(c))).unwrap()).unwrap())
                .collect(),
            cap: i["cap"].as_str().map(|c| Hash::parse(c).unwrap()),
            changes: unhex(s(&i["changes"])),
            generation: i["generation"].as_u64().unwrap(),
            from: i["from"].as_u64().unwrap(),
            to: i["to"].as_u64().unwrap(),
            records: i["records"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| {
                    let v = Version {
                        r#type: DocId::parse(s(&r[1])).unwrap(),
                        schema: r[2].as_str().map(|h| Hash::parse(h).unwrap()),
                    };
                    (s(&r[0]).to_string(), v)
                })
                .collect(),
            genesis: i["genesis"]
                .as_str()
                .map(|g| Genesis::decode(&unhex(g)).unwrap()),
        };
        let bytes = encode(&b.value());
        assert_eq!(hex(&bytes), s(&x["value"]), "{name}: value");
        assert_eq!(b.message(), s(&x["message"]), "{name}: message");
        assert_eq!(
            Body::of_value(&decode(&bytes).unwrap()),
            Some(b),
            "{name}: reads back"
        );
    }
}

#[test]
fn segments() {
    for v in vectors("db/spec/vectors/segments.json") {
        let (name, i, x) = (s(&v["name"]), &v["input"], &v["expected"]);
        let seg = Segment {
            doc: DocId(Hash([0; 32])),
            epoch: Hash([0; 32]),
            branch: s(&i["branch"]).into(),
            writer: i["writer"].as_u64().unwrap(),
            generation: i["generation"].as_u64().unwrap(),
            from: i["from"].as_u64().unwrap(),
            to: i["to"].as_u64().unwrap(),
            prev: i["prev"].as_str().map(|p| Hash::parse(p).unwrap()),
            envelopes: i["envelopes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|e| unhex(s(e)))
                .collect(),
        };
        assert_eq!(hex(&encode(&seg.body())), s(&x["value"]), "{name}: value");
        assert_eq!(seg.name().text(), s(&x["name"]), "{name}: name");
        assert_eq!(
            seg.run(&Limits::DEFAULTS).is_some(),
            x["ok"].as_bool().unwrap(),
            "{name}: ok"
        );
        let back = Segment::of_body(seg.doc, seg.epoch, &seg.body(), &Limits::DEFAULTS);
        assert_eq!(back, Some(seg), "{name}: reads back");
    }
}

#[test]
fn heads() {
    for v in vectors("db/spec/vectors/heads.json") {
        let (name, i, x) = (s(&v["name"]), &v["input"], &v["expected"]);
        let logs: BTreeMap<u64, Hash> = i["logs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| (l[0].as_u64().unwrap(), hash(&l[1])))
            .collect();
        let head = Head {
            doc: DocId::parse(s(&i["doc"])).unwrap(),
            logs,
        };
        assert_eq!(hex(&encode(&head.value())), s(&x["value"]), "{name}");
        assert!(x["ok"].as_bool().unwrap());
    }
}

fn op(j: &Json) -> OpId {
    (j[0].as_u64().unwrap(), j[1].as_u64().unwrap())
}

#[test]
fn loro() {
    for v in vectors("db/spec/vectors/loro.json") {
        let (name, i, x) = (s(&v["name"]), &v["input"], &v["expected"]);
        let held: Vec<(Hash, OpId)> = i["held"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| (hash(&h["name"]), op(&h["last"])))
            .collect();
        let named: Vec<Hash> = i["named"].as_array().unwrap().iter().map(hash).collect();
        let frontier: Vec<OpId> = i["frontier"].as_array().unwrap().iter().map(op).collect();
        let (w, start) = (i["writer"].as_u64().unwrap(), i["start"].as_u64().unwrap());
        let carried = aven_db_docs::carried_deps(&frontier, w, start);
        let want: Option<Vec<OpId>> = x["carried"].as_array().map(|c| c.iter().map(op).collect());
        assert_eq!(carried, want, "{name}: carried");
        assert_eq!(
            loro_agrees(&held, w, start, &named, &frontier).text(),
            s(&x["verdict"]),
            "{name}"
        );
    }
    let _ = Envelope::decode;
    let _ = Value::Null;
}

#[test]
fn placements() {
    for v in vectors("db/spec/vectors/placements.json") {
        let (name, i, x) = (s(&v["name"]), &v["input"], &v["expected"]);
        if let Some(doc) = i.get("doc") {
            // `genesisOk`: the genesis a first envelope carries names the envelope's Doc
            let g = Genesis::decode(&unhex(s(&i["genesis"]))).unwrap();
            assert_eq!(
                g.id().text() == s(doc),
                x["ok"].as_bool().unwrap(),
                "{name}"
            );
            continue;
        }
        let first = i["seq"].as_u64() == Some(1)
            && !i["prev"].as_bool().unwrap()
            && i["deps"].as_u64() == Some(0);
        assert_eq!(first, x["first"].as_bool().unwrap(), "{name}: first");
        let placed = i["genesis"].as_bool().unwrap() == first;
        assert_eq!(placed, x["placed"].as_bool().unwrap(), "{name}: placed");
    }
}

#[test]
fn builtins() {
    use aven_db_docs::{BuiltinFit, DocsBuiltins};
    for v in vectors("db/spec/vectors/builtins.json") {
        let (name, i, x) = (s(&v["name"]), &v["input"], &v["expected"]);
        let t = DocId::parse(s(&i["type"])).unwrap();
        let Some(rec) = i.get("record") else {
            assert_eq!(
                DocsBuiltins.check(&t, &Value::Map(vec![])).is_some(),
                x.as_bool().unwrap(),
                "{name}"
            );
            continue;
        };
        let record = decode(&unhex(s(rec))).unwrap();
        assert_eq!(
            DocsBuiltins.check(&t, &record),
            x["fits"].as_bool(),
            "{name}"
        );
    }
}

#[test]
fn held() {
    for v in vectors("db/spec/vectors/held.json") {
        let (name, i, x) = (s(&v["name"]), &v["input"], &v["expected"]);
        if let Some(bytes) = i.as_str() {
            assert_eq!(
                aven_db_docs::HeldPage::of_value(&decode(&unhex(bytes)).unwrap()).is_some(),
                x.as_bool().unwrap(),
                "{name}"
            );
            continue;
        }
        let page = aven_db_docs::HeldPage {
            doc: DocId::parse(s(&i["doc"])).unwrap(),
            envelopes: i["envelopes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| (hash(&p[0]), hash(&p[1])))
                .collect(),
        };
        assert_eq!(hex(&encode(&page.value())), s(&x["value"]), "{name}");
        assert_eq!(
            aven_db_docs::HeldPage::of_value(&page.value()).is_some(),
            x["reads"].as_bool().unwrap(),
            "{name}"
        );
    }
}
