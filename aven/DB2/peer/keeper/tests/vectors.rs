//! A keeper's arrivals against Lean's traces (`peer/spec/vectors/keeper.json`, README rule 10): uploads from devices to
//! a keeper, one Doc, from an empty store; after each, the items held, the next number and the pages of what came after
//! each asked number are the model's. Every state is also stored and restored, as a keeper reads its ref back.

use std::path::PathBuf;

use std::collections::BTreeSet;

use aven_peer_keeper::{Arrivals, Item, PAGE, Put, Reader};
use serde_json::Value;

fn vectors(file: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../peer/spec/vectors")
        .join(file);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn put(p: &Value) -> Put<u64> {
    Put {
        hash: p["hash"].as_u64().unwrap(),
        bytes: p["bytes"].as_u64().unwrap(),
        covers: p["covers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c.as_u64().unwrap())
            .collect(),
    }
}

fn item(i: &Value) -> Item<u64> {
    Item {
        n: i["n"].as_u64().unwrap(),
        hash: i["hash"].as_u64().unwrap(),
        bytes: i["bytes"].as_u64().unwrap(),
        uploaders: i["uploaders"]
            .as_array()
            .unwrap()
            .iter()
            .map(|u| u.as_str().unwrap().to_string())
            .collect(),
    }
}

fn pairs(q: &Value) -> Vec<(u64, u64)> {
    q.as_array()
        .unwrap()
        .iter()
        .map(|e| (e[0].as_u64().unwrap(), e[1].as_u64().unwrap()))
        .collect()
}

#[test]
fn arrivals_are_the_models() {
    let vs = vectors("keeper.json");
    assert!(vs.len() > 60, "the examples and the generated cases");
    for v in vs {
        let name = v["name"].as_str().unwrap();
        let asks: Vec<u64> = v["input"]["after"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a.as_u64().unwrap())
            .collect();
        let mut s = Arrivals::<u64>::default();
        for (u, want) in v["input"]["uploads"]
            .as_array()
            .unwrap()
            .iter()
            .zip(v["expected"].as_array().unwrap())
        {
            let ps: Vec<_> = u["puts"].as_array().unwrap().iter().map(put).collect();
            let device = u["device"].as_str().unwrap();
            let took = s.upload(device, &ps);
            // every put is held after its own upload's put, with its uploader on it (`put_held`)
            assert_eq!(took.len(), ps.len(), "{name}");
            let items: Vec<_> = want["items"].as_array().unwrap().iter().map(item).collect();
            assert_eq!(
                s.items().cloned().collect::<Vec<_>>(),
                items,
                "{name}: the items"
            );
            assert_eq!(
                s.next(),
                want["next"].as_u64().unwrap(),
                "{name}: the next number"
            );
            for (n, pages) in asks.iter().zip(want["after"].as_array().unwrap()) {
                let pages: Vec<_> = pages.as_array().unwrap().iter().map(pairs).collect();
                assert_eq!(s.after(*n), pages, "{name}: after {n}");
                // one page at a time, as the frames go, walks the same pages
                let (mut at, mut walked) = (*n, Vec::new());
                loop {
                    let (page, more) = s.page(at);
                    if page.is_empty() {
                        assert!(!more);
                        break;
                    }
                    assert!(page.len() <= PAGE);
                    at = page.last().unwrap().0;
                    walked.push(page);
                    if !more {
                        break;
                    }
                }
                assert_eq!(walked, pages, "{name}: paged after {n}");
            }
            // a device at each asked number, holding 11 and 12, catches up a page at a time
            for (n, want) in asks.iter().zip(want["caughtUp"].as_array().unwrap()) {
                let mut r = Reader { at: *n };
                let mut held: Vec<u64> = vec![11, 12];
                loop {
                    let (page, more) = s.page(r.at);
                    if page.is_empty() {
                        break;
                    }
                    let have: BTreeSet<u64> = held.iter().copied().collect();
                    held.extend(Reader::lacks(&page, |h| have.contains(h)));
                    assert!(r.land(&page), "{name}: every page moves the device forward");
                    if !more {
                        break;
                    }
                }
                assert_eq!(
                    r.at,
                    want["at"].as_u64().unwrap(),
                    "{name}: caught up from {n}"
                );
                let want_held: Vec<u64> = want["held"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|h| h.as_u64().unwrap())
                    .collect();
                assert_eq!(held, want_held, "{name}: held after catching up from {n}");
                assert!(
                    s.after_all(r.at).is_empty(),
                    "{name}: nothing after where it caught up to"
                );
            }
            // what the keeper stores reads back as the same arrivals
            assert_eq!(
                Arrivals::restore(s.next(), items).as_ref(),
                Some(&s),
                "{name}: restored"
            );
        }
    }
}

#[test]
fn restore_refuses_what_no_keeper_holds() {
    let i = |n, hash, up: &[&str]| Item {
        n,
        hash,
        bytes: 1,
        uploaders: up.iter().map(|u| u.to_string()).collect(),
    };
    assert!(Arrivals::<u64>::restore(3, vec![i(1, 10, &["a"]), i(2, 11, &["b"])]).is_some());
    // numbers not rising, one at or past next, a hash twice, an item without uploaders
    assert!(Arrivals::<u64>::restore(3, vec![i(2, 10, &["a"]), i(1, 11, &["b"])]).is_none());
    assert!(Arrivals::<u64>::restore(2, vec![i(1, 10, &["a"]), i(2, 11, &["b"])]).is_none());
    assert!(Arrivals::<u64>::restore(3, vec![i(1, 10, &["a"]), i(2, 10, &["b"])]).is_none());
    assert!(Arrivals::<u64>::restore(3, vec![i(1, 10, &[])]).is_none());
}
