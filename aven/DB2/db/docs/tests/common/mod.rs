//! What the Doc tests share: devices, a genesis, the built-in `version` type, and an authorization that allows all.
#![allow(dead_code)]

use aven_core::{DocId, Envelope, Hash, Value, blake3};
use aven_db_docs::schema::{Kind, Schema, builtin_type};
use aven_db_docs::{
    Act, Authorize, Body, Device, Doc, EpochKey, Genesis, Limits, Record, RecordWrite, Snapshot,
    Version,
};
use aven_id::{Secret, TestEntropy};
use std::sync::Arc;

pub fn device(name: &str) -> Device {
    let mut e = TestEntropy::new(name);
    Device::from_seeds(&Secret::generate(&mut e), &Secret::generate(&mut e))
}

/// Caps' answer in the tests: every signer reaches the Doc, and `F` says who is authorized.
pub struct When<F>(pub F);

impl<F: Fn(&Envelope, &Body) -> bool> Authorize for When<F> {
    fn reaches(&self, _: &Genesis, _: &[u8]) -> bool {
        true
    }

    fn authorized(
        &self,
        _: &Genesis,
        e: &Envelope,
        body: &Body,
        _: &aven_db_docs::Past<'_>,
    ) -> bool {
        (self.0)(e, body)
    }
}

/// Everyone reaches the Doc and is authorized.
pub struct Allow;

impl Authorize for Allow {
    fn reaches(&self, _: &Genesis, _: &[u8]) -> bool {
        true
    }

    fn authorized(&self, _: &Genesis, _: &Envelope, _: &Body, _: &aven_db_docs::Past<'_>) -> bool {
        true
    }
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

pub fn todo_type() -> Version {
    Version {
        r#type: DocId(blake3(b"the todo type Doc")),
        schema: Some(todo().hash()),
    }
}

/// The todo type Doc as a reader holds it: one `schema` Record, a version holding the todo schema.
pub fn todo_type_doc() -> Arc<Snapshot> {
    let fields = [
        ("at".to_string(), Value::Array(vec![])),
        ("name".to_string(), Value::Text("v1".into())),
        ("schema".to_string(), todo().value()),
    ];
    Arc::new(Snapshot {
        version: vec![],
        records: [(
            "v1".to_string(),
            Record {
                r#type: builtin_type("schema"),
                fields: fields.into_iter().collect(),
            },
        )]
        .into_iter()
        .collect(),
    })
}

/// The type Docs a reader holds: the todo type's.
pub fn types(t: &DocId) -> Option<Arc<Snapshot>> {
    (*t == todo_type().r#type).then(todo_type_doc)
}

/// A type Doc's version: the `schema` built-in.
pub fn schema_type() -> Version {
    Version {
        r#type: builtin_type("schema"),
        schema: None,
    }
}

pub fn version_type() -> Version {
    Version {
        r#type: builtin_type("version"),
        schema: None,
    }
}

pub fn genesis(_by: &Device) -> Genesis {
    Genesis::new(
        b"alice's vault",
        todo_type().r#type,
        &[(todo_type().r#type, todo().hash())],
        [5; 32],
    )
}

pub fn open(g: &Genesis) -> Doc {
    Doc::open(g.clone(), types, Limits::DEFAULTS).expect("opens")
}

pub fn put(id: &str, version: Version, set: Vec<(&str, Value)>) -> RecordWrite {
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
    doc.commit(d, 0, batch, "2026-10-31T12:00:00Z", Act::default(), &Allow)
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
