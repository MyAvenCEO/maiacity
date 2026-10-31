//! What the Doc tests share: devices, a genesis, the built-in `version` type, and an authorization that allows all.
#![allow(dead_code)]

use aven_core::{Envelope, Hash, TypeId, Value, blake3};
use aven_db_docs::schema::{Kind, Schema, builtin_type, builtins};
use aven_db_docs::{Act, Body, Device, Doc, EpochKey, Genesis, Limits, RecordWrite};
use aven_id::{Secret, TestEntropy};

pub fn device(name: &str) -> Device {
    let mut e = TestEntropy::new(name);
    Device::from_seeds(&Secret::generate(&mut e), &Secret::generate(&mut e))
}

pub fn allow(_: &Envelope, _: &Body) -> bool {
    true
}

/// A todo type, pinned by the genesis: a title, and a count of at most 100.
pub fn todo() -> Schema {
    Schema {
        title: "todo".into(),
        fields: vec![
            ("title".into(), Kind::Text, true),
            ("count".into(), Kind::Uint(100), false),
        ],
        closed: true,
    }
}

pub fn todo_type() -> TypeId {
    TypeId {
        r#type: aven_core::DocId(blake3(b"the todo type Doc")),
        schema: todo().hash(),
    }
}

pub fn version_type() -> TypeId {
    builtins()
        .into_iter()
        .find(|(t, _)| t.r#type == builtin_type("version"))
        .unwrap()
        .0
}

pub fn genesis(by: &Device) -> Genesis {
    Genesis::new(
        by,
        b"alice's vault",
        todo_type().r#type,
        vec![todo_type()],
        [5; 32],
    )
}

pub fn open(g: &Genesis) -> Doc {
    Doc::open(g.clone(), &[todo()], Limits::DEFAULTS).expect("opens")
}

pub fn put(id: &str, version: TypeId, set: Vec<(&str, Value)>) -> RecordWrite {
    RecordWrite {
        id: id.into(),
        version,
        set: set.into_iter().map(|(k, v)| (k.to_string(), v)).collect(),
        unset: vec![],
        gone: false,
    }
}

pub fn todo_put(id: &str, title: &str) -> RecordWrite {
    put(id, todo_type(), vec![("title", Value::Text(title.into()))])
}

pub fn commit(doc: &mut Doc, d: &Device, batch: &[RecordWrite]) -> Vec<u8> {
    doc.commit(d, 0, batch, "2026-10-31T12:00:00Z", Act::default(), &allow)
        .expect("commits")
}

pub fn epoch(name: &str) -> EpochKey {
    let mut e = TestEntropy::new(name);
    EpochKey {
        name: blake3(name.as_bytes()),
        key: Secret::generate(&mut e),
    }
}

pub fn hash(s: &str) -> Hash {
    blake3(s.as_bytes())
}
