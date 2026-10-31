//! Reading Lean's vectors: every expected value comes from `db/spec/vectors`, written by `lake exe vectors`; these
//! tests write none of their own. JSON is only the readable form (`Aven.Core.Json`, `Engine.Examples`): a Value as
//! Core's vectors write it, a Doc id as `d:<hex>`. Lean writes an object's keys sorted, so rows and fields are
//! compared as maps.

#![allow(dead_code)]

use std::path::PathBuf;

use aven_core::{DocId, Value};
use aven_db_engine::{Cell, Cmp, NewId, Op, Query, Rec, Record, Tuple};
use serde_json::{Map, Value as Json};

pub fn vectors(file: &str) -> Vec<Json> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../spec/vectors")
        .join(file);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
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

/// A Value from its readable form: integers are numbers, text a string, `{"bytes": hex}` a byte string.
pub fn value(j: &Json) -> Value {
    match j {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => {
            let s = n.to_string();
            match s.parse::<u64>() {
                Ok(u) => Value::Uint(u),
                Err(_) => {
                    let n: i128 = s.parse().unwrap();
                    Value::Nint((-1 - n) as u64)
                }
            }
        }
        Json::String(s) => Value::Text(s.clone()),
        Json::Array(xs) => Value::Array(xs.iter().map(value).collect()),
        Json::Object(o) if o.len() == 1 && o.get("bytes").is_some_and(Json::is_string) => {
            Value::Bytes(unhex(o["bytes"].as_str().unwrap()))
        }
        Json::Object(o) => Value::Map(o.iter().map(|(k, v)| (k.clone(), value(v))).collect()),
    }
}

/// A Value in its readable form.
pub fn json(v: &Value) -> Json {
    match v {
        Value::Uint(n) => Json::from(*n),
        Value::Nint(n) => serde_json::from_str(&(-1 - *n as i128).to_string()).unwrap(),
        Value::Bytes(b) => serde_json::json!({ "bytes": hex(b) }),
        Value::Text(s) => Json::String(s.clone()),
        Value::Array(xs) => Json::Array(xs.iter().map(json).collect()),
        Value::Map(kvs) => Json::Object(kvs.iter().map(|(k, v)| (k.clone(), json(v))).collect()),
        Value::Bool(b) => Json::Bool(*b),
        Value::Null => Json::Null,
    }
}

pub fn doc(j: &Json) -> DocId {
    DocId::parse(j.as_str().unwrap()).unwrap_or_else(|| panic!("a Doc id: {j}"))
}

pub fn doc_json(d: &DocId) -> Json {
    Json::String(d.text())
}

pub fn text(j: &Json) -> String {
    j.as_str().unwrap().to_owned()
}

pub fn tuple(j: &Json) -> Tuple {
    j.as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.clone(), value(v)))
        .collect()
}

/// A row as Lean writes it: an object, so a column named twice keeps its last value.
pub fn tuple_json(t: &Tuple) -> Json {
    let mut m = Map::new();
    for (k, v) in t {
        m.insert(k.clone(), json(v));
    }
    Json::Object(m)
}

pub fn list<T>(j: &Json, f: impl Fn(&Json) -> T) -> Vec<T> {
    j.as_array().unwrap().iter().map(f).collect()
}

pub fn rec(j: &Json) -> Rec {
    Rec {
        doc: doc(&j["doc"]),
        r#type: doc(&j["type"]),
        fields: tuple(&j["fields"]),
    }
}

fn cmp(s: &str) -> Cmp {
    [Cmp::Eq, Cmp::Ne, Cmp::Lt, Cmp::Le]
        .into_iter()
        .find(|c| c.name() == s)
        .unwrap()
}

pub fn query(j: &Json) -> Query {
    let (kind, b) = j.as_object().unwrap().iter().next().unwrap();
    let q = |k: &str| Box::new(query(&b[k]));
    let col = |k: &str| text(&b[k]);
    match kind.as_str() {
        "scan" => Query::Scan(doc(b)),
        "filter" => Query::Filter {
            col: col("column"),
            cmp: cmp(b["cmp"].as_str().unwrap()),
            value: value(&b["value"]),
            query: q("query"),
        },
        "project" => Query::Project {
            cols: list(&b["columns"], text),
            query: q("query"),
        },
        "join" => Query::Join {
            left: q("left"),
            right: q("right"),
            lcol: col("leftColumn"),
            rcol: col("rightColumn"),
        },
        "leftJoin" => Query::LeftJoin {
            left: q("left"),
            right: q("right"),
            lcol: col("leftColumn"),
            rcol: col("rightColumn"),
        },
        "anti" => Query::Anti {
            left: q("left"),
            right: q("right"),
            lcol: col("leftColumn"),
            rcol: col("rightColumn"),
        },
        "order" => Query::Order {
            col: col("column"),
            query: q("query"),
        },
        "group" => Query::Group {
            col: col("column"),
            query: q("query"),
        },
        "limit" => Query::Limit {
            n: b["n"].as_u64().unwrap(),
            query: q("query"),
        },
        other => panic!("a query: {other}"),
    }
}

pub fn new_id(j: &Json) -> NewId {
    NewId {
        writer: j["writer"].as_u64().unwrap(),
        counter: j["counter"].as_u64().unwrap(),
        index: j["index"].as_u64().unwrap(),
    }
}

pub fn new_id_json(i: &NewId) -> Json {
    serde_json::json!({ "writer": i.writer, "counter": i.counter, "index": i.index })
}

pub fn record(j: &Json) -> Record {
    Record {
        id: new_id(&j["id"]),
        r#type: doc(&j["type"]),
        fields: tuple(&j["fields"]),
    }
}

pub fn record_json(r: &Record) -> Json {
    serde_json::json!({ "id": new_id_json(&r.id), "type": doc_json(&r.r#type), "fields": tuple_json(&r.fields) })
}

fn cell(j: &Json) -> Cell {
    match j.as_object() {
        Some(o) if o.len() == 1 && o.get("ref").is_some_and(Json::is_u64) => {
            Cell::Ref(o["ref"].as_u64().unwrap())
        }
        _ => Cell::Lit(value(j)),
    }
}

pub fn op(j: &Json) -> Op {
    let (kind, b) = j.as_object().unwrap().iter().next().unwrap();
    let ty = doc(&b["type"]);
    match kind.as_str() {
        "put" => Op::Put {
            r#type: ty,
            fields: b["fields"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(k, v)| (k.clone(), cell(v)))
                .collect(),
        },
        "patch" => Op::Patch {
            r#type: ty,
            r#where: tuple(&b["where"]),
            set: tuple(&b["set"]),
        },
        "remove" => Op::Remove {
            r#type: ty,
            r#where: tuple(&b["where"]),
        },
        "edit" => Op::Edit {
            r#type: ty,
            id: new_id(&b["id"]),
            field: text(&b["field"]),
            value: value(&b["value"]),
        },
        other => panic!("an op: {other}"),
    }
}

pub fn target(j: &Json) -> Option<aven_core::Target> {
    use aven_core::{Reach, Target};
    if j.is_null() {
        return None;
    }
    Some(if let Some(d) = j.get("doc") {
        Target::Doc {
            doc: doc(d),
            reach: Reach::of_name(j["reach"].as_str().unwrap()).unwrap(),
        }
    } else if let Some(t) = j.get("type") {
        Target::VaultType {
            vault: aven_core::Hash::parse(&text(&j["vault"])).unwrap(),
            r#type: doc(t),
            below: j["below"].as_bool().unwrap(),
        }
    } else {
        Target::Vault {
            vault: aven_core::Hash::parse(&text(&j["vault"])).unwrap(),
            below: j["below"].as_bool().unwrap(),
        }
    })
}

pub fn facts(j: &Json) -> aven_core::Facts {
    aven_core::Facts {
        id: doc(&j["id"]),
        vault: aven_core::Hash::parse(&text(&j["vault"])).unwrap(),
        r#type: doc(&j["type"]),
    }
}

pub fn step_json(s: &aven_core::Step) -> Json {
    serde_json::json!({ "type": doc_json(&s.r#type), "verb": s.verb.name(), "fields": s.fields })
}

pub fn answer_json(a: &aven_db_engine::Answer) -> Json {
    use aven_db_engine::{Answer, Completeness};
    match a {
        Answer::Refused => Json::String("refused".into()),
        Answer::Rows(st, rows) => serde_json::json!({
            "status": match st {
                Completeness::Complete => Json::String("complete".into()),
                Completeness::Short(m) => serde_json::json!({ "short": m.iter().map(doc_json).collect::<Vec<_>>() }),
            },
            "rows": rows.iter().map(tuple_json).collect::<Vec<_>>(),
        }),
    }
}

pub fn hex_of(b: &[u8]) -> String {
    hex(b)
}

pub fn step(j: &Json) -> aven_core::Step {
    use aven_core::StepVerb;
    let verb = [
        StepVerb::PutNew,
        StepVerb::PutReplace,
        StepVerb::Patch,
        StepVerb::Remove,
        StepVerb::Edit,
    ]
    .into_iter()
    .find(|v| v.name() == j["verb"].as_str().unwrap())
    .unwrap();
    aven_core::Step {
        r#type: doc(&j["type"]),
        verb,
        fields: list(&j["fields"], text),
    }
}

pub fn call(j: &Json) -> aven_core::Call {
    aven_core::Call {
        op: aven_core::Hash::parse(j["op"].as_str().unwrap()).unwrap(),
        params: list(&j["params"], |p| (text(&p[0]), value(&p[1]))),
    }
}

pub fn json_value(v: &Value) -> Json {
    json(v)
}
