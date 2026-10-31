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

fn field<'a>(kvs: &'a [(String, Value)], k: &str) -> Option<&'a Value> {
    kvs.iter().find(|(x, _)| x == k).map(|(_, v)| v)
}

fn as_map(v: &Value) -> Option<&[(String, Value)]> {
    match v {
        Value::Map(kvs) => Some(kvs),
        _ => None,
    }
}

fn as_text(v: &Value) -> Option<&str> {
    match v {
        Value::Text(t) => Some(t),
        _ => None,
    }
}

fn as_opt_text(v: &Value) -> Option<Option<String>> {
    match v {
        Value::Null => Some(None),
        Value::Text(t) => Some(Some(t.clone())),
        _ => None,
    }
}

fn as_opt_nat(v: &Value) -> Option<Option<u64>> {
    match v {
        Value::Null => Some(None),
        Value::Uint(n) => Some(Some(*n)),
        _ => None,
    }
}

fn as_nat(v: &Value) -> Option<u64> {
    match v {
        Value::Uint(n) => Some(*n),
        _ => None,
    }
}

/// A map with exactly these keys.
fn keys_are(kvs: &[(String, Value)], keys: &[&str]) -> bool {
    kvs.len() == keys.len() && keys.iter().all(|k| field(kvs, k).is_some())
}

impl Line {
    /// The inverse of [`Line::value`].
    pub fn of_value(v: &Value) -> Option<Line> {
        let kvs = as_map(v)?;
        if !keys_are(kvs, &["op", "doc", "params"]) {
            return None;
        }
        let op = match field(kvs, "op")? {
            Value::Bytes(b) => Hash(b.as_slice().try_into().ok()?),
            _ => return None,
        };
        let doc = aven_core::Target::of_value(field(kvs, "doc")?.clone())?;
        let params = as_map(field(kvs, "params")?)?
            .iter()
            .map(|(p, b)| Some((p.clone(), aven_core::Bound::of_value(b.clone())?)))
            .collect::<Option<_>>()?;
        Some(Line { op, doc, params })
    }
}

impl Holder {
    /// The inverse of [`Holder::value`].
    pub fn of_value(v: &Value) -> Option<Holder> {
        if as_text(v) == Some("public") {
            return Some(Holder::Public);
        }
        let kvs = as_map(v)?;
        let [(k, x)] = kvs else { return None };
        match (k.as_str(), x) {
            ("vault", Value::Text(t)) => Some(Holder::Vault(t.clone())),
            ("ticket", Value::Text(t)) => Some(Holder::Ticket(t.clone())),
            ("group", Value::Bytes(b)) => Some(Holder::Group(aven_core::DocId(Hash(
                b.as_slice().try_into().ok()?,
            )))),
            _ => None,
        }
    }
}

impl Branches {
    /// The inverse of [`Branches::value`].
    pub fn of_value(v: &Value) -> Option<Branches> {
        match v {
            Value::Text(t) if t == "any" => Some(Branches::Any),
            Value::Text(t) if t == "main" => Some(Branches::Main),
            Value::Text(t) if t == "proposals" => Some(Branches::Proposals),
            Value::Map(kvs) => match kvs.as_slice() {
                [(k, Value::Text(b))] if k == "branch" => Some(Branches::One(b.clone())),
                _ => None,
            },
            _ => None,
        }
    }
}

impl Conditions {
    /// The inverse of [`Conditions::value`].
    pub fn of_value(v: &Value) -> Option<Conditions> {
        let kvs = as_map(v)?;
        let keys = [
            "own",
            "uses",
            "approve",
            "expires",
            "history",
            "branches",
            "notBefore",
        ];
        if !keys_are(kvs, &keys) {
            return None;
        }
        Some(Conditions {
            not_before: as_nat(field(kvs, "notBefore")?)?,
            expires: as_opt_nat(field(kvs, "expires")?)?,
            approve: as_nat(field(kvs, "approve")?)?,
            uses: as_opt_nat(field(kvs, "uses")?)?,
            own: match field(kvs, "own")? {
                Value::Bool(b) => *b,
                _ => return None,
            },
            branches: Branches::of_value(field(kvs, "branches")?)?,
            history: match as_text(field(kvs, "history")?)? {
                "all" => super::conditions::History::All,
                "from-now" => super::conditions::History::FromNow,
                _ => return None,
            },
        })
    }
}

impl Cap {
    /// A cap read from its bytes, with the id, signer and verified approvals that travel beside them: the inverse of
    /// [`Cap::bytes`]. Bytes that aren't the one encoding of a cap's body are none: Core's `decode` refuses anything
    /// non-canonical, and a body is read back only when it writes back as itself.
    pub fn from_bytes(
        bytes: &[u8],
        id: String,
        signer: String,
        approvals: Vec<super::approve::Sig>,
    ) -> Option<Cap> {
        let body = aven_core::decode(bytes)?;
        let kvs = as_map(&body)?;
        let keys = [
            "form",
            "role",
            "grant",
            "share",
            "holder",
            "issuer",
            "parent",
            "conditions",
        ];
        if !keys_are(kvs, &keys) {
            return None;
        }
        let grant = match field(kvs, "grant")? {
            Value::Array(ls) => ls.iter().map(Line::of_value).collect::<Option<_>>()?,
            _ => return None,
        };
        let cap = Cap {
            id,
            issuer: as_text(field(kvs, "issuer")?)?.into(),
            holder: Holder::of_value(field(kvs, "holder")?)?,
            parent: as_opt_text(field(kvs, "parent")?)?,
            form: super::conditions::Form::parse(as_text(field(kvs, "form")?)?)?,
            grant,
            role: as_opt_text(field(kvs, "role")?)?,
            share: as_nat(field(kvs, "share")?)?,
            conditions: Conditions::of_value(field(kvs, "conditions")?)?,
            signer,
            approvals,
        };
        (cap.bytes() == bytes).then_some(cap)
    }
}
