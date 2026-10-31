//! The allowlist against Lean's vectors (README rule 10 of aven/DB2): every tree in `spec/vectors/tree.json` with the
//! model's verdict and its encoding, and every face's tree in `face.json` with the model's `check`.

use aven_runtimes_tree::{Node, TREE_LIMITS, check, encode};
use serde_json::Value;

/// The vectors of `file`. Their trees nest deeper than serde_json's default limit of 128, so it is lifted.
fn vectors(file: &str) -> Vec<Value> {
    let path = format!("{}/../spec/vectors/{file}", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let mut de = serde_json::Deserializer::from_str(&text);
    de.disable_recursion_limit();
    serde::Deserialize::deserialize(&mut de).unwrap()
}

/// A tree as the vectors write it: `{"text"}` or `{"tag", "attrs": [[k, v]], "kids"}`.
fn node(v: &Value) -> Node {
    if let Some(t) = v.get("text") {
        return Node::Text(t.as_str().unwrap().into());
    }
    Node::El {
        tag: v["tag"].as_str().unwrap().into(),
        attrs: v["attrs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| (a[0].as_str().unwrap().into(), a[1].as_str().unwrap().into()))
            .collect(),
        kids: v["kids"].as_array().unwrap().iter().map(node).collect(),
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[test]
fn trees() {
    let vs = vectors("tree.json");
    assert!(vs.len() >= 27);
    for v in vs {
        let name = v["name"].as_str().unwrap();
        let t = node(&v["input"]["tree"]);
        assert_eq!(
            check(TREE_LIMITS, &t),
            v["expected"].as_bool().unwrap(),
            "{name}"
        );
        let mut out = Vec::new();
        encode(&t, &mut out);
        assert_eq!(
            hex(&out),
            v["input"]["cbor"].as_str().unwrap(),
            "{name}: encoding"
        );
        assert_eq!(aven_core::encode(&t.value()), out, "{name}: as a Value");
        assert_eq!(
            Node::of_value(&t.value(), 1000),
            Some(t.clone()),
            "{name}: read back"
        );
    }
}

#[test]
fn faces() {
    let vs = vectors("face.json");
    assert!(!vs.is_empty());
    for v in vs {
        let name = v["name"].as_str().unwrap();
        assert_eq!(
            check(TREE_LIMITS, &node(&v["input"]["tree"])),
            v["expected"]["check"].as_bool().unwrap(),
            "{name}"
        );
    }
}

/// A tree a million deep is refused without recursing: the check keeps its own stack.
#[test]
fn deep() {
    let mut t = Node::Text("deep".into());
    for _ in 0..1_000_000 {
        t = Node::El {
            tag: "div".into(),
            attrs: vec![],
            kids: vec![t],
        };
    }
    assert!(!check(TREE_LIMITS, &t));
    // dropping it must not recurse either
    let mut stack = vec![t];
    while let Some(n) = stack.pop() {
        if let Node::El { kids, .. } = n {
            stack.extend(kids);
        }
    }
}
