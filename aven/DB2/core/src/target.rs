//! Targets and steps (`Aven.Core.Target`, `Aven.Core.TargetCbor`, A8, A32). One target grammar for what a cap covers,
//! what a want asks for and what a query ranges over, in three forms: a Doc, with what it spawned or what it lists, or
//! neither; a vault's Docs; and a vault's Docs of one root type, each with the vaults below it or not. Whether a Doc is
//! in a target is read from what its genesis fixes ([`Facts`]), never from its content. Who governs whom, which actor
//! spawned which and what a collection lists come from avenID, the actors and the collections, so they are
//! parameters.
//!
//! In CBOR a target is a map with the keys caps writes, each form keys no other has:
//! `{"doc", "reach"}`, `{"below", "vault"}`, `{"type", "below", "vault"}`.

use alloc::string::String;
use alloc::vec;
use alloc::vec::Vec;

use aven_codec::Value;
use aven_codec::{DocId, Hash};

/// What a Doc's genesis fixes, which is all a target reads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Facts {
    pub id: DocId,
    pub vault: String,
    pub r#type: DocId,
}

/// What a Doc target reaches besides the Doc itself: nothing more (`self`), every actor it spawned, or every Doc it
/// lists, a collection.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Reach {
    Itself,
    Spawned,
    Lists,
}

impl Reach {
    /// As caps writes it.
    pub fn name(self) -> &'static str {
        match self {
            Reach::Itself => "self",
            Reach::Spawned => "spawned",
            Reach::Lists => "lists",
        }
    }

    pub fn of_name(s: &str) -> Option<Reach> {
        match s {
            "self" => Some(Reach::Itself),
            "spawned" => Some(Reach::Spawned),
            "lists" => Some(Reach::Lists),
            _ => None,
        }
    }

    /// A reach within another: the Doc alone is within either (`Reach.le`).
    pub fn le(self, other: Reach) -> bool {
        matches!(
            (self, other),
            (Reach::Itself, _) | (Reach::Spawned, Reach::Spawned) | (Reach::Lists, Reach::Lists)
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Target {
    /// One Doc, and with its reach the actors it spawned or the Docs it lists.
    Doc { doc: DocId, reach: Reach },
    /// Every Doc of a vault, and with `below` every Doc of the vaults it governs.
    Vault { vault: String, below: bool },
    /// A vault's Docs of one root type, a type Doc.
    VaultType {
        vault: String,
        r#type: DocId,
        below: bool,
    },
}

fn doc_id(v: Value) -> Option<DocId> {
    Hash::of_value(&v).map(DocId)
}

impl Target {
    /// Whether the Doc with these facts is in the target (`Target.coversB`). `gov(v, w)`: vault `v` governs vault `w`;
    /// `spawned(a, b)`: actor `a` spawned actor `b`; `lists(c, d)`: collection `c` lists Doc `d`.
    pub fn covers(
        &self,
        gov: impl Fn(&str, &str) -> bool,
        spawned: impl Fn(&DocId, &DocId) -> bool,
        lists: impl Fn(&DocId, &DocId) -> bool,
        f: &Facts,
    ) -> bool {
        let in_vault = |v: &str, below: bool| f.vault == v || (below && gov(v, &f.vault));
        match self {
            Target::Doc {
                doc,
                reach: Reach::Itself,
            } => f.id == *doc,
            Target::Doc {
                doc,
                reach: Reach::Spawned,
            } => f.id == *doc || spawned(doc, &f.id),
            Target::Doc {
                doc,
                reach: Reach::Lists,
            } => f.id == *doc || lists(doc, &f.id),
            Target::Vault { vault, below } => in_vault(vault, *below),
            Target::VaultType {
                vault,
                r#type,
                below,
            } => f.r#type == *r#type && in_vault(vault, *below),
        }
    }

    /// `self` is a narrowing of `other`, read from the two targets alone (`Target.le`): what it covers, `other` covers
    /// (`Target.le_sound`).
    pub fn le(&self, other: &Target) -> bool {
        match (self, other) {
            (Target::Vault { vault: v, below: b }, Target::Vault { vault: w, below: c })
            | (
                Target::VaultType {
                    vault: v, below: b, ..
                },
                Target::Vault { vault: w, below: c },
            ) => v == w && (!b || *c),
            (
                Target::VaultType {
                    vault: v,
                    r#type: t,
                    below: b,
                },
                Target::VaultType {
                    vault: w,
                    r#type: u,
                    below: c,
                },
            ) => v == w && t == u && (!b || *c),
            (Target::Doc { doc: d, reach: r }, Target::Doc { doc: e, reach: s }) => {
                d == e && Reach::le(*r, *s)
            }
            _ => false,
        }
    }

    /// Its CBOR (`Target.value`).
    pub fn value(&self) -> Value {
        match self {
            Target::Doc { doc, reach } => Value::Map(vec![
                ("doc".into(), doc.0.value()),
                ("reach".into(), Value::Text(reach.name().into())),
            ]),
            Target::Vault { vault, below } => Value::Map(vec![
                ("below".into(), Value::Bool(*below)),
                ("vault".into(), Value::Text(vault.clone())),
            ]),
            Target::VaultType {
                vault,
                r#type,
                below,
            } => Value::Map(vec![
                ("type".into(), r#type.0.value()),
                ("below".into(), Value::Bool(*below)),
                ("vault".into(), Value::Text(vault.clone())),
            ]),
        }
    }

    /// Read back from [`Target::value`] (`Target.ofValue?`), a Doc or type id as its 32 bytes.
    pub fn of_value(v: Value) -> Option<Target> {
        let Value::Map(kvs) = v else { return None };
        let mut kvs = kvs.into_iter();
        let (a, b, c) = (kvs.next(), kvs.next(), kvs.next());
        if kvs.next().is_some() {
            return None;
        }
        match (a, b, c) {
            (Some((ka, d)), Some((kb, Value::Text(r))), None) if ka == "doc" && kb == "reach" => {
                Some(Target::Doc {
                    doc: doc_id(d)?,
                    reach: Reach::of_name(&r)?,
                })
            }
            (Some((ka, Value::Bool(below))), Some((kb, Value::Text(vault))), None)
                if ka == "below" && kb == "vault" =>
            {
                Some(Target::Vault { vault, below })
            }
            (Some((ka, t)), Some((kb, Value::Bool(below))), Some((kc, Value::Text(vault))))
                if ka == "type" && kb == "below" && kc == "vault" =>
            {
                Some(Target::VaultType {
                    vault,
                    r#type: doc_id(t)?,
                    below,
                })
            }
            _ => None,
        }
    }
}

/// A write step's verb: a put of a Record that didn't exist at the envelope's base, or of one that did; a patch, a
/// remove, or an edit of a text, list or tree.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum StepVerb {
    PutNew,
    PutReplace,
    Patch,
    Remove,
    Edit,
}

impl StepVerb {
    /// As caps writes it.
    pub fn name(self) -> &'static str {
        match self {
            StepVerb::PutNew => "put-new",
            StepVerb::PutReplace => "put-replace",
            StepVerb::Patch => "patch",
            StepVerb::Remove => "remove",
            StepVerb::Edit => "edit",
        }
    }
}

/// One lowered step of a write: the type (a type Doc), its verb, and the fields it writes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Step {
    pub r#type: DocId,
    pub verb: StepVerb,
    pub fields: Vec<String>,
}
