//! face-runtime against Lean's vectors: `face-runtime.json` (the runtime, byte for byte), `face.json` (a face's
//! rules read from their Values, its checks, issues, every text's look and its CSS), `contrast.json` (the table and the ratios) and `markup.json` (what markup draws).

use aven_core::{Value, decode, encode};
use aven_runtimes_contract::result;
use aven_runtimes_face::face::{self, LINEAR, reaches};
use aven_runtimes_face::style::{BASE, Look, issues};
use aven_runtimes_face::{FaceOut, Key, Markup, Rgb, Rule, Src, draw, eval, face_ok, face_run};
use aven_runtimes_tree::{Node, TREE_LIMITS, check};
use serde_json::Value as Json;

fn vectors(file: &str) -> Vec<Json> {
    let path = format!("{}/../spec/vectors/{file}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}")))
        .unwrap()
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

fn rgb(s: &str) -> Rgb {
    let b = unhex(&s[1..]);
    Rgb {
        r: b[0],
        g: b[1],
        b: b[2],
    }
}

fn node(v: &Json) -> Node {
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

/// A Value in the one JSON form of a Value (`Aven.Core.Json`): bytes as `{"bytes": hex}`, integers of either sign.
fn cvalue(j: &Json) -> Value {
    match j {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => match n.as_u64() {
            Some(u) => Value::Uint(u),
            None => Value::Nint((-1 - n.as_i64().unwrap()) as u64),
        },
        Json::String(s) => Value::Text(s.clone()),
        Json::Array(xs) => Value::Array(xs.iter().map(cvalue).collect()),
        Json::Object(o) if o.len() == 1 && o.contains_key("bytes") => {
            Value::Bytes(unhex(o["bytes"].as_str().unwrap()))
        }
        Json::Object(o) => Value::Map(o.iter().map(|(k, v)| (k.clone(), cvalue(v))).collect()),
    }
}

/// A rule from its Value, as the face-runtime reads it.
fn rule(v: &Json) -> Rule {
    let r = Rule::of_value(&cvalue(v)).unwrap();
    assert_eq!(r.value(), cvalue(v), "a rule reads back to its own Value");
    r
}

/// The runtime itself, from the bytes of its part and data to the bytes of its result.
#[test]
fn runtime() {
    let vs = vectors("face-runtime.json");
    assert_eq!(vs.len(), 8);
    for v in vs {
        let name = v["name"].as_str().unwrap();
        let part = decode(&unhex(v["input"]["part"].as_str().unwrap())).unwrap();
        let data = decode(&unhex(v["input"]["data"].as_str().unwrap())).unwrap();
        let r = eval(&part, &data);
        assert_eq!(
            hex(&encode(&result(&r))),
            v["expected"]["result"].as_str().unwrap(),
            "{name}"
        );
        if let Ok(o) = &r {
            let Value::Map(kvs) = o else { panic!("{name}") };
            let tree =
                Node::of_value(&kvs.iter().find(|(k, _)| k == "tree").unwrap().1, 64).unwrap();
            assert!(check(TREE_LIMITS, &tree), "{name}");
        }
    }
}

#[test]
fn faces() {
    for v in vectors("face.json") {
        let name = v["name"].as_str().unwrap();
        let o = FaceOut {
            tree: node(&v["input"]["tree"]),
            style: v["input"]["style"]
                .as_array()
                .unwrap()
                .iter()
                .map(rule)
                .collect(),
        };
        let e = &v["expected"];
        assert_eq!(
            face_ok(TREE_LIMITS, &o),
            e["ok"].as_bool().unwrap(),
            "{name}: ok"
        );
        assert_eq!(
            check(TREE_LIMITS, &o.tree),
            e["check"].as_bool().unwrap(),
            "{name}: check"
        );
        let i = issues(&o);
        assert_eq!(
            i.unnamed as u64,
            e["unnamed"].as_u64().unwrap(),
            "{name}: unnamed"
        );
        assert_eq!(
            i.no_role as u64,
            e["noRole"].as_u64().unwrap(),
            "{name}: noRole"
        );
        assert_eq!(
            i.no_alt as u64,
            e["noAlt"].as_u64().unwrap(),
            "{name}: noAlt"
        );
        let bad: Vec<u64> = e["badRules"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_u64().unwrap())
            .collect();
        assert_eq!(
            i.bad_rules.iter().map(|&n| n as u64).collect::<Vec<_>>(),
            bad,
            "{name}: badRules"
        );
        assert_eq!(
            i.small as u64,
            e["small"].as_u64().unwrap(),
            "{name}: small"
        );
        assert_eq!(
            i.low_contrast as u64,
            e["lowContrast"].as_u64().unwrap(),
            "{name}: lowContrast"
        );
        let texts: Vec<(Look, String)> = o.texts();
        let want = e["texts"].as_array().unwrap();
        assert_eq!(texts.len(), want.len(), "{name}: texts");
        for ((l, t), w) in texts.iter().zip(want) {
            let c = &w[0];
            assert_eq!(
                (l.fg, l.bg, l.size.px_at(), l.weight, t.as_str()),
                (
                    rgb(c["fg"].as_str().unwrap()),
                    rgb(c["bg"].as_str().unwrap()),
                    c["px"].as_i64().unwrap(),
                    c["weight"].as_u64().unwrap(),
                    w[1].as_str().unwrap()
                ),
                "{name}: a text"
            );
        }
        let css: Vec<String> = o.style.iter().map(Rule::css).collect();
        let want: Vec<String> = e["css"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c.as_str().unwrap().into())
            .collect();
        assert_eq!(css, want, "{name}: css");
        assert_eq!(
            hex(&encode(&face_value(&o))),
            v["input"]["cbor"].as_str().unwrap(),
            "{name}: cbor"
        );
    }
}

/// `FaceOut.value`: `{"tree", "style"}`.
fn face_value(o: &FaceOut) -> Value {
    Value::Map(vec![
        ("tree".into(), o.tree.value()),
        (
            "style".into(),
            Value::Array(o.style.iter().map(Rule::value).collect()),
        ),
    ])
}

#[test]
fn contrast() {
    let vs = vectors("contrast.json");
    let table: Vec<u64> = vs[0]["linear"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_u64().unwrap())
        .collect();
    assert_eq!(table, LINEAR);
    for v in &vs[1..] {
        let name = v["name"].as_str().unwrap();
        let (fg, bg) = (
            rgb(v["input"]["fg"].as_str().unwrap()),
            rgb(v["input"]["bg"].as_str().unwrap()),
        );
        assert_eq!(
            fg.luminance(),
            v["expected"]["fg"].as_u64().unwrap(),
            "{name}"
        );
        assert_eq!(
            bg.luminance(),
            v["expected"]["bg"].as_u64().unwrap(),
            "{name}"
        );
        assert_eq!(
            reaches(fg, bg, 9, 2),
            v["expected"]["normal"].as_bool().unwrap(),
            "{name}"
        );
        assert_eq!(
            reaches(fg, bg, 3, 1),
            v["expected"]["large"].as_bool().unwrap(),
            "{name}"
        );
    }
    assert_eq!(BASE.fg, face::BLACK);
}

/// A Value from its readable form (`Aven.Core.Json`).
fn value(j: &Json) -> Value {
    match j {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => Value::Uint(n.as_u64().unwrap()),
        Json::String(s) => Value::Text(s.clone()),
        Json::Array(xs) => Value::Array(xs.iter().map(value).collect()),
        Json::Object(o) => Value::Map(o.iter().map(|(k, v)| (k.clone(), value(v))).collect()),
    }
}

fn path(j: &Json) -> Vec<Key> {
    j.as_array()
        .unwrap()
        .iter()
        .map(|k| match k {
            Json::String(s) => Key::Field(s.clone()),
            Json::Number(n) => Key::Index(n.as_u64().unwrap() as usize),
            _ => panic!(),
        })
        .collect()
}

fn src(j: &Json) -> Src {
    if let Some(s) = j.get("lit") {
        Src::Lit(s.as_str().unwrap().into())
    } else if let Some(p) = j.get("$") {
        Src::Data(path(p))
    } else {
        Src::Item(path(&j["$$"]))
    }
}

/// Markup in `markup.json`'s form. Attributes are a JSON object there, so their order is not the markup's: trees are
/// compared with each node's attributes sorted (`face-runtime.json` holds the exact bytes, order included).
fn markup(j: &Json) -> Markup {
    if let Some(s) = j.get("text") {
        return Markup::Text(src(s));
    }
    if let Some(c) = j.get("$use") {
        return Markup::Use {
            place: j["place"].as_str().unwrap().into(),
            component: c.as_str().unwrap().into(),
            props: j["props"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(k, s)| (k.clone(), src(s)))
                .collect(),
        };
    }
    if let Some(p) = j.get("$each") {
        return Markup::Each {
            list: path(p),
            key: path(&j["key"]),
            body: Box::new(markup(&j["body"])),
        };
    }
    Markup::El {
        tag: j["tag"].as_str().unwrap().into(),
        attrs: j["attrs"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, s)| (k.clone(), src(s)))
            .collect(),
        on: j["$on"].as_str().map(String::from),
        kids: j["kids"].as_array().unwrap().iter().map(markup).collect(),
    }
}

fn sorted(n: &Node) -> Node {
    match n {
        Node::Text(s) => Node::Text(s.clone()),
        Node::El { tag, attrs, kids } => {
            let mut attrs = attrs.clone();
            attrs.sort();
            Node::El {
                tag: tag.clone(),
                attrs,
                kids: kids.iter().map(sorted).collect(),
            }
        }
    }
}

/// A tree in `markup.json`'s form: text, or `[tag, [[k, v]], kids]`.
fn tree(j: &Json) -> Node {
    match j {
        Json::String(s) => Node::Text(s.clone()),
        Json::Array(xs) => Node::El {
            tag: xs[0].as_str().unwrap().into(),
            attrs: xs[1]
                .as_array()
                .unwrap()
                .iter()
                .map(|a| (a[0].as_str().unwrap().into(), a[1].as_str().unwrap().into()))
                .collect(),
            kids: xs[2].as_array().unwrap().iter().map(tree).collect(),
        },
        _ => panic!(),
    }
}

#[test]
fn markups() {
    for v in vectors("markup.json") {
        let name = v["name"].as_str().unwrap();
        let m = markup(&v["input"]["markup"]);
        let data = value(&v["input"]["data"]);
        let (ns, pls) = draw(&data, &Value::Null, "", &m);
        let want: Vec<Node> = v["expected"]["tree"]
            .as_array()
            .unwrap()
            .iter()
            .map(tree)
            .collect();
        assert_eq!(
            ns.iter().map(sorted).collect::<Vec<_>>(),
            want.iter().map(sorted).collect::<Vec<_>>(),
            "{name}"
        );
        let want_pls = v["expected"]["placements"].as_array().unwrap();
        assert_eq!(pls.len(), want_pls.len(), "{name}");
        for (p, w) in pls.iter().zip(want_pls) {
            assert_eq!(p.place, w["place"].as_str().unwrap(), "{name}");
            assert_eq!(p.component, w["component"].as_str().unwrap(), "{name}");
            let mut props = p.props.clone();
            props.sort();
            let want: Vec<(String, String)> = w["props"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(k, x)| (k.clone(), x.as_str().unwrap().into()))
                .collect();
            assert_eq!(props, want, "{name}");
        }
        let fp = aven_runtimes_face::FacePart {
            markup: m,
            style: vec![],
        };
        assert_eq!(
            face_run(&fp, &data).is_some(),
            v["expected"]["faceRun"].as_bool().unwrap(),
            "{name}"
        );
    }
}
