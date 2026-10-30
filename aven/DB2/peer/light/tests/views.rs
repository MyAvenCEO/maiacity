//! The views the Peer-Light pushes to avenOS, against Lean's vectors (README rule 10): every query on every tree in
//! `id/spec/vectors/trees.json`, and what avenOS shows on the cast in `avenos.json`, answered by looking up the
//! snapshot as the page does (`os/web/id.svelte.js`). This replaces aven-id's own wasm check: the views now come from
//! the Peer-Light. No expected value is written here.

use std::path::PathBuf;

use aven_peer_light::views;
use serde_json::{Map, Value, json};

const CAST: &str = include_str!("../../../sandbox/cast.json");

fn vectors(file: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../id/spec/vectors")
        .join(file);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap()
}

/// A snapshot, read as the page reads it: an unknown vault has no name, kind or device it serves, and no lists.
struct Shown(Value);

impl Shown {
    fn vault(&self, id: &str) -> Option<&Value> {
        self.0["vaults"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == id)
    }

    fn field(&self, id: &str, field: &str) -> Value {
        self.vault(id).map_or(Value::Null, |v| v[field].clone())
    }

    fn list(&self, id: &str, field: &str) -> Vec<String> {
        self.vault(id).map_or_else(Vec::new, |v| {
            v[field]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| s.as_str().unwrap().to_string())
                .collect()
        })
    }

    fn may_act_on(&self, device: &str, vault: &str) -> bool {
        match self.field(device, "actsFor").as_str() {
            Some(serves) => {
                serves == vault || self.list(serves, "governs").iter().any(|v| v == vault)
            }
            None => false,
        }
    }
}

/// A vector's tree as a cast: the model knows keys by id, so each gets a real public half. A cast's vaults are an
/// object, so a tree with two vaults of one id has none.
fn as_cast(input: &Value) -> Option<String> {
    let cast: Value = serde_json::from_str(CAST).unwrap();
    let some_key = cast["keys"]
        .as_object()
        .unwrap()
        .values()
        .next()
        .unwrap()
        .clone();
    let keys: Map<String, Value> = input["keys"]
        .as_array()?
        .iter()
        .map(|k| Some((k.as_str()?.to_string(), some_key.clone())))
        .collect::<Option<_>>()?;
    let mut vaults = Map::new();
    for v in input["vaults"].as_array()? {
        let id = v["id"].as_str()?.to_string();
        let vault = json!({ "name": v["name"], "kind": v["kind"], "owners": v["owners"] });
        if vaults.insert(id, vault).is_some() {
            return None;
        }
    }
    Some(json!({ "keys": keys, "vaults": vaults }).to_string())
}

#[test]
fn every_tree_shows_what_the_model_answers() {
    let (mut answered, mut refused, mut skipped) = (0, 0, 0);
    for v in vectors("trees.json") {
        let (name, input, expected) = (&v["name"], &v["input"], &v["expected"]);
        let Some(cast) = as_cast(input) else {
            skipped += 1;
            continue;
        };
        let shown = match views::of_cast(&cast, None) {
            Ok(snapshot) => Shown(snapshot),
            Err(why) => {
                assert_ne!(
                    expected["wf"], true,
                    "{name}: refused ({why}), but the model answers for it"
                );
                refused += 1;
                continue;
            }
        };
        assert_eq!(
            expected["wf"], true,
            "{name}: shown, but the model refuses it"
        );
        for (q, want) in input["queries"]
            .as_array()
            .unwrap()
            .iter()
            .zip(expected["answers"].as_array().unwrap())
        {
            let arg = |i: usize| q[i].as_str().unwrap_or_default();
            let got = match arg(0) {
                "name" | "kind" | "actsFor" => shown.field(arg(1), arg(0)),
                "owners" | "owned" | "governs" | "chain" | "actsThrough" | "sees" => {
                    json!(shown.list(arg(1), arg(0)))
                }
                // whom a host may act as is its own snapshot's: the device it is, or the box's own view
                "accounts" => views::of_cast(&cast, q[1].as_str()).unwrap()["accounts"].clone(),
                "mayActOn" => json!(shown.may_act_on(arg(1), arg(2))),
                other => panic!("{name}: unknown query {other}"),
            };
            assert_eq!(&got, want, "{name}: {q}");
            answered += 1;
        }
    }
    assert!(
        answered > 1000 && refused > 0,
        "{answered} answers, {refused} refusals, {skipped} skipped"
    );
}

/// What avenOS shows on the cast (`Aven.ID.OS`): whom each host may act as, each Control Room, each Vault, whom each
/// Peer-Light serves and every vault's name, read from the snapshot the host's Peer-Light pushes.
#[test]
fn avenos_shows_what_the_model_says() {
    let cast: Value = serde_json::from_str(CAST).unwrap();
    // the device a host is: a Peer-Light's origin, or none for the box's own view
    let device = |host: &str| {
        cast["peers"]
            .as_object()
            .unwrap()
            .iter()
            .find(|(_, p)| p["origin"] == host)
            .map(|(id, _)| id.clone())
    };
    let snapshot = |device: Option<&str>| Shown(views::of_cast(CAST, device).unwrap());
    let the_box = snapshot(None);
    let mut seen = 0;
    for v in vectors("avenos.json") {
        let (input, want) = (&v["input"], &v["expected"]);
        let got = if let Some(host) = input["accounts"].as_str() {
            match (host, device(host)) {
                (_, Some(d)) => snapshot(Some(&d)).0["accounts"].clone(),
                ("localhost", None) => the_box.0["accounts"].clone(),
                // a visitor's host runs no Peer-Light, so it gets no views and may act as nobody
                _ => json!([]),
            }
        } else if let Some(vault) = input["sees"].as_str() {
            json!(the_box.list(vault, "sees"))
        } else if let Some(vault) = input["vault"].as_str() {
            let target = input["target"].as_str().unwrap_or(vault);
            let opens = if the_box.list(vault, "governs").iter().any(|v| v == target) {
                target
            } else {
                vault
            };
            let mut tree = vec![opens.to_string()];
            tree.extend(the_box.list(opens, "governs"));
            json!({ "actsThrough": the_box.list(opens, "actsThrough"), "opens": opens, "tree": tree })
        } else if input.get("names").is_some() {
            let names: Map<String, Value> = the_box.0["vaults"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| (v["id"].as_str().unwrap().to_string(), v["name"].clone()))
                .collect();
            Value::Object(names)
        } else if let Some(light) = input["serves"].as_str() {
            snapshot(Some(light)).field(light, "actsFor")
        } else {
            panic!("{}: an unknown view", v["name"]);
        };
        assert_eq!(&got, want, "{}", v["name"]);
        seen += 1;
    }
    assert!(seen >= 15, "{seen} views");
}

/// A snapshot is stamped with the head it is correct at: the same tree the same stamp, any change a new one.
#[test]
fn a_snapshot_names_the_tree_it_is_correct_at() {
    let at = |cast: &str| {
        views::of_cast(cast, None).unwrap()["at"]
            .as_str()
            .unwrap()
            .to_string()
    };
    assert_eq!(at(CAST), at(CAST));
    assert_eq!(at(CAST).len(), 64);
    let renamed = CAST.replace("\"Maia City\"", "\"Maia Town\"");
    assert_ne!(renamed, CAST);
    assert_ne!(at(&renamed), at(CAST));
}
