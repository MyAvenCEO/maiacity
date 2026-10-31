//! A cap's bytes (`Aven.ID.CapsCbor`, A2). A cap is a Value, encoded by Core's deterministic CBOR, its targets as
//! Core writes them. Its **body** is everything but its signature and approvals:
//!
//! ```text
//! {"form", "role", "grant": [line…], "share", "holder", "issuer", "parent", "conditions": {"own", "uses", "approve",
//!  "expires", "history", "branches", "notBefore"}}
//! line:   {"op": op id, "doc": target, "params": {param: [value…] or null, …}}
//! holder: {"vault": v}   {"group": Doc}   "public"   {"ticket": key}
//! ```
//!
//! A cap's id is the BLAKE3 name of its body ([`Cap::digest`]), which its issuer's owners approve. Its issuing device
//! signs the body under the label `avenID cap 1` ([`Cap::signing`]), so the signature can't be read as anything
//! else's, and since the form is in the body, a signature over an attenuation is never one over a grant.

use aven_core::{Hash, Value, encode, name_of, signing_bytes};

use super::chain::Cap;
use super::conditions::{Branches, Conditions, Holder};
use super::line::Line;

/// What a cap's issuing device signs it under.
pub const CAP_LABEL: &str = "avenID cap 1";

fn text(s: &str) -> Value {
    Value::Text(s.into())
}

fn map(kvs: Vec<(&str, Value)>) -> Value {
    Value::Map(kvs.into_iter().map(|(k, v)| (k.into(), v)).collect())
}

fn opt_text(s: &Option<String>) -> Value {
    s.as_deref().map_or(Value::Null, text)
}

fn opt_nat(n: Option<u64>) -> Value {
    n.map_or(Value::Null, Value::Uint)
}

impl Line {
    /// `Line.value`.
    pub fn value(&self) -> Value {
        map(vec![
            ("op", Value::Bytes(self.op.0.to_vec())),
            ("doc", self.doc.value()),
            (
                "params",
                Value::Map(
                    self.params
                        .iter()
                        .map(|(p, b)| (p.clone(), b.value()))
                        .collect(),
                ),
            ),
        ])
    }
}

impl Holder {
    /// `Holder.value`.
    pub fn value(&self) -> Value {
        match self {
            Holder::Vault(v) => map(vec![("vault", text(v))]),
            Holder::Group(g) => map(vec![("group", Value::Bytes(g.0.0.to_vec()))]),
            Holder::Public => text("public"),
            Holder::Ticket(k) => map(vec![("ticket", text(k))]),
        }
    }
}

impl Branches {
    /// `Branches.value`.
    pub fn value(&self) -> Value {
        match self {
            Branches::Any => text("any"),
            Branches::Main => text("main"),
            Branches::Proposals => text("proposals"),
            Branches::One(b) => map(vec![("branch", text(b))]),
        }
    }
}

impl Conditions {
    /// `Conditions.value`.
    pub fn value(&self) -> Value {
        map(vec![
            ("own", Value::Bool(self.own)),
            ("uses", opt_nat(self.uses)),
            ("approve", Value::Uint(self.approve)),
            ("expires", opt_nat(self.expires)),
            ("history", text(self.history.name())),
            ("branches", self.branches.value()),
            ("notBefore", Value::Uint(self.not_before)),
        ])
    }
}

impl Cap {
    /// What a cap says, without its signature and approvals (`Cap.body`).
    pub fn body(&self) -> Value {
        map(vec![
            ("form", text(self.form.name())),
            ("role", opt_text(&self.role)),
            (
                "grant",
                Value::Array(self.grant.iter().map(Line::value).collect()),
            ),
            ("share", Value::Uint(self.share)),
            ("holder", self.holder.value()),
            ("issuer", text(&self.issuer)),
            ("parent", opt_text(&self.parent)),
            ("conditions", self.conditions.value()),
        ])
    }

    /// Its bytes: its body's one encoding (`Cap.bytes`).
    pub fn bytes(&self) -> Vec<u8> {
        encode(&self.body())
    }

    /// Its id: the name of its body, which its issuer's owners approve (`Cap.digest`).
    pub fn digest(&self) -> Hash {
        name_of(&self.body())
    }

    /// What its issuing device signs (`Cap.signing`).
    pub fn signing(&self) -> Vec<u8> {
        signing_bytes(CAP_LABEL, &self.body())
    }
}
