//! The fetch gate against Lean's cases (`peer/spec/vectors/fetch.json`, README rule 10): what a peer holds for which Doc,
//! the Docs proven on a connection, a fetch; the answer; and items' parts.

use std::path::PathBuf;

use aven_peer_keeper::fetch::{Assembly, Dropped, PART_BYTES, answer, parts};
use serde_json::Value;

fn vectors(file: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../peer/spec/vectors")
        .join(file);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn nums(v: &Value) -> Vec<u64> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_u64().unwrap())
        .collect()
}

#[test]
fn answers_and_parts_are_the_models() {
    let vs = vectors("fetch.json");
    assert!(vs.len() > 60);
    for v in vs {
        let name = v["name"].as_str().unwrap();
        let input = &v["input"];
        if let Some(n) = input.get("bytes") {
            let bytes = vec![0u8; n.as_u64().unwrap() as usize];
            let got: Vec<(u64, u64)> = parts(&bytes)
                .iter()
                .map(|p| (p.at, p.bytes.len() as u64))
                .collect();
            let want: Vec<(u64, u64)> = v["expected"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| (p[0].as_u64().unwrap(), p[1].as_u64().unwrap()))
                .collect();
            assert_eq!(got, want, "{name}");
            // parts go back together into the item
            let mut a = Assembly::default();
            let ps = parts(&bytes);
            for (i, p) in ps.iter().enumerate() {
                assert_eq!(a.add(*p), Ok(i + 1 == ps.len()), "{name}");
            }
            assert_eq!(a.finish(&bytes.len(), |b| b.len()), Ok(bytes), "{name}");
            continue;
        }
        let doc = input["doc"].as_str().unwrap();
        let held: Vec<(u64, String, u64)> = input["held"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| {
                (
                    h["hash"].as_u64().unwrap(),
                    h["doc"].as_str().unwrap().to_string(),
                    h["bytes"].as_u64().unwrap(),
                )
            })
            .collect();
        let proven = input["proven"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d.as_str() == Some(doc));
        // the hash→Doc map: the first entry for a hash, as the model's lookup
        let got = answer(proven, &nums(&input["hashes"]), |h| {
            held.iter()
                .find(|(x, _, _)| x == h)
                .filter(|(_, d, _)| d == doc)
                .map(|(_, _, n)| *n)
        });
        let e = &v["expected"];
        if e.get("refused").is_some() {
            assert_eq!(got, None, "{name}");
        } else {
            let a = got.unwrap_or_else(|| panic!("{name}: refused"));
            assert_eq!(a.served, nums(&e["served"]), "{name}: served");
            assert_eq!(a.missing, nums(&e["missing"]), "{name}: missing");
            assert_eq!(a.later, nums(&e["later"]), "{name}: later");
        }
    }
}

#[test]
fn a_receiver_drops_what_doesnt_fit_or_hash() {
    let bytes = vec![7u8; PART_BYTES + 10];
    let ps = parts(&bytes);
    // out of order, another length, past the end
    assert_eq!(Assembly::default().add(ps[1]), Err(Dropped::Out));
    let mut a = Assembly::default();
    a.add(ps[0]).unwrap();
    let mut other = ps[1];
    other.total += 1;
    assert_eq!(a.clone().add(other), Err(Dropped::Out));
    // whole, but hashing to something else: dropped, never stored
    a.add(ps[1]).unwrap();
    assert_eq!(a.clone().finish(&0usize, |b| b.len()), Err(Dropped::Hash));
    // not whole yet
    let mut b = Assembly::default();
    b.add(ps[0]).unwrap();
    assert_eq!(b.finish(&bytes.len(), |b| b.len()), Err(Dropped::Out));
}
