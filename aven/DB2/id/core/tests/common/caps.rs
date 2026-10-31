//! Caps as the vectors write them (`Aven.ID.CapsJson`): caps, lines, targets and contexts, read and written back.

use std::cell::RefCell;
use std::collections::HashMap;

use super::{core_value, hex, unhex};
use aven_core::{Bound, DocId, Facts, Hash, Reach, Target, blake3};
use aven_id::Tree;
use aven_id::caps::Branches;
use aven_id::caps::{Cap, ChainError, Conditions, Ctx, Form, History, Holder, Line, Role, Sig};
use serde_json::{Value, json};

pub const CAST: &str = include_str!("../../../../sandbox/cast.json");

/// Docs as the vectors name them. The cast's examples name some by short byte strings, which a 32-byte `DocId`
/// can't hold: those map to the hash of their bytes, and back when an answer names them.
#[derive(Default)]
pub struct Names {
    back: RefCell<HashMap<DocId, String>>,
}

impl Names {
    pub fn doc(&self, s: &str) -> DocId {
        let bytes = unhex(s.strip_prefix("d:").unwrap());
        let id = match <[u8; 32]>::try_from(bytes.as_slice()) {
            Ok(h) => DocId(Hash(h)),
            Err(_) => DocId(blake3(&bytes)),
        };
        self.back.borrow_mut().insert(id, s.into());
        id
    }

    pub fn text(&self, d: &DocId) -> String {
        self.back
            .borrow()
            .get(d)
            .cloned()
            .unwrap_or_else(|| d.text())
    }

    /// Every Doc named holds its full 32 bytes, so a cap's bytes can be the model's.
    pub fn all_full(&self) -> bool {
        self.back.borrow().values().all(|s| s.len() == 2 + 64)
    }

    pub fn target(&self, v: &Value) -> Target {
        if let Some(d) = v["doc"].as_str() {
            Target::Doc {
                doc: self.doc(d),
                reach: Reach::of_name(v["reach"].as_str().unwrap()).unwrap(),
            }
        } else {
            let vault = v["vault"].as_str().unwrap().to_string();
            let below = v["below"].as_bool().unwrap();
            match v["type"].as_str() {
                Some(t) => Target::VaultType {
                    vault,
                    r#type: self.doc(t),
                    below,
                },
                None => Target::Vault { vault, below },
            }
        }
    }

    pub fn target_json(&self, t: &Target) -> Value {
        match t {
            Target::Doc { doc, reach } => json!({ "doc": self.text(doc), "reach": reach.name() }),
            Target::Vault { vault, below } => json!({ "vault": vault, "below": below }),
            Target::VaultType {
                vault,
                r#type,
                below,
            } => json!({ "vault": vault, "type": self.text(r#type), "below": below }),
        }
    }

    pub fn line(&self, v: &Value) -> Line {
        Line {
            op: Hash::parse(v["op"].as_str().unwrap()).unwrap(),
            doc: self.target(&v["doc"]),
            params: v["params"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(p, b)| {
                    let b = match b {
                        Value::Null => Bound::Any,
                        Value::Array(vs) => Bound::OneOf(vs.iter().map(core_value).collect()),
                        _ => panic!("not a bound: {b}"),
                    };
                    (p.clone(), b)
                })
                .collect(),
        }
    }

    pub fn line_json(&self, l: &Line) -> Value {
        let params: serde_json::Map<String, Value> = l
            .params
            .iter()
            .map(|(p, b)| {
                let b = match b {
                    Bound::Any => Value::Null,
                    Bound::OneOf(vs) => Value::Array(vs.iter().map(value_json).collect()),
                };
                (p.clone(), b)
            })
            .collect();
        json!({ "op": l.op.text(), "doc": self.target_json(&l.doc), "params": params })
    }

    pub fn cap(&self, v: &Value) -> Cap {
        let c = &v["conditions"];
        let holder = match &v["holder"] {
            Value::String(s) if s == "public" => Holder::Public,
            h if h.get("vault").is_some() => Holder::Vault(h["vault"].as_str().unwrap().into()),
            h => Holder::Group(self.doc(h["group"].as_str().unwrap())),
        };
        Cap {
            id: v["id"].as_str().unwrap().into(),
            issuer: v["issuer"].as_str().unwrap().into(),
            holder,
            parent: v["parent"].as_str().map(str::to_string),
            form: Form::parse(v["form"].as_str().unwrap()).unwrap(),
            grant: v["grant"]
                .as_array()
                .unwrap()
                .iter()
                .map(|l| self.line(l))
                .collect(),
            role: v["role"].as_str().map(str::to_string),
            share: v["share"].as_u64().unwrap(),
            conditions: Conditions {
                not_before: c["notBefore"].as_u64().unwrap(),
                expires: c["expires"].as_u64(),
                approve: c["approve"].as_u64().unwrap(),
                uses: c["uses"].as_u64(),
                own: c["own"].as_bool().unwrap(),
                branches: branches(&c["branches"]),
                history: match c["history"].as_str().unwrap() {
                    "all" => History::All,
                    _ => History::FromNow,
                },
            },
            signer: v["signer"].as_str().unwrap().into(),
            approvals: v["approvals"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| Sig::new(s["key"].as_str().unwrap(), s["digest"].as_str().unwrap()))
                .collect(),
        }
    }

    /// A cap as the vectors write it, without its bytes.
    pub fn cap_json(&self, c: &Cap) -> Value {
        let holder = match &c.holder {
            Holder::Vault(v) => json!({ "vault": v }),
            Holder::Group(g) => json!({ "group": self.text(g) }),
            Holder::Public => json!("public"),
        };
        let k = &c.conditions;
        let branches = match &k.branches {
            Branches::Any => json!("any"),
            Branches::Main => json!("main"),
            Branches::Proposals => json!("proposals"),
            Branches::One(b) => json!({ "branch": b }),
        };
        json!({
            "id": c.id, "issuer": c.issuer, "holder": holder, "parent": c.parent, "form": c.form.name(),
            "grant": c.grant.iter().map(|l| self.line_json(l)).collect::<Vec<_>>(), "role": c.role,
            "share": c.share,
            "conditions": {
                "notBefore": k.not_before, "expires": k.expires, "approve": k.approve, "uses": k.uses, "own": k.own,
                "branches": branches, "history": k.history.name(),
            },
            "signer": c.signer,
            "approvals": c.approvals.iter().map(|a| json!({ "key": a.key, "digest": a.digest })).collect::<Vec<_>>(),
        })
    }

    pub fn error_json(&self, e: &ChainError) -> Value {
        let mut out = json!({ "rule": e.rule() });
        if let Some(c) = e.cap() {
            out["cap"] = json!(c);
        }
        if let ChainError::Authority(_, l) = e {
            out["line"] = self.line_json(l);
        }
        out
    }
}

/// A Core Value as Core's vectors write it.
pub fn value_json(v: &aven_core::Value) -> Value {
    use aven_core::Value as V;
    match v {
        V::Uint(n) => json!(n),
        V::Nint(n) => json!(-1 - *n as i64),
        V::Bytes(b) => json!({ "bytes": hex(b) }),
        V::Text(t) => json!(t),
        V::Array(xs) => Value::Array(xs.iter().map(value_json).collect()),
        V::Map(kvs) => Value::Object(
            kvs.iter()
                .map(|(k, x)| (k.clone(), value_json(x)))
                .collect(),
        ),
        V::Bool(b) => json!(b),
        V::Null => Value::Null,
    }
}

/// A context as the vectors give it: the cast's tree, the thresholds, the groups, the roles and the Docs.
pub struct Context {
    pub tree: Tree,
    pub threshold: usize,
    pub groups: Vec<(DocId, Vec<String>)>,
    pub roles: Vec<Role>,
    pub docs: Vec<Facts>,
}

impl Context {
    pub fn of(names: &Names, v: &Value) -> Context {
        assert_eq!(v["tree"], "cast");
        Context {
            tree: Tree::from_cast(CAST).expect("the cast"),
            threshold: v["threshold"].as_u64().unwrap() as usize,
            groups: v["groups"]
                .as_array()
                .unwrap()
                .iter()
                .map(|g| {
                    let members = g["members"].as_array().unwrap();
                    (
                        names.doc(g["group"].as_str().unwrap()),
                        members.iter().map(|m| m.as_str().unwrap().into()).collect(),
                    )
                })
                .collect(),
            roles: v["roles"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| Role {
                    id: r["id"].as_str().unwrap().into(),
                    name: r["name"].as_str().unwrap().into(),
                    grant: r["grant"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|l| names.line(l))
                        .collect(),
                })
                .collect(),
            docs: v["docs"]
                .as_array()
                .unwrap()
                .iter()
                .map(|d| Facts {
                    id: names.doc(d["id"].as_str().unwrap()),
                    vault: d["vault"].as_str().unwrap().into(),
                    r#type: names.doc(d["type"].as_str().unwrap()),
                })
                .collect(),
        }
    }

    pub fn with<T>(&self, f: impl FnOnce(&Ctx) -> T) -> T {
        let threshold = |_: &str| self.threshold;
        let in_group = |g: &DocId, v: &str| {
            self.groups
                .iter()
                .any(|(h, ms)| h == g && ms.iter().any(|m| m == v))
        };
        let facts = |d: &DocId| self.docs.iter().find(|f| f.id == *d).cloned();
        f(&Ctx {
            tree: &self.tree,
            threshold: &threshold,
            in_group: &in_group,
            roles: &self.roles,
            facts: &facts,
        })
    }
}

pub fn branches(v: &Value) -> Branches {
    match v {
        Value::String(s) if s == "any" => Branches::Any,
        Value::String(s) if s == "main" => Branches::Main,
        Value::String(s) if s == "proposals" => Branches::Proposals,
        _ => Branches::One(v["branch"].as_str().unwrap().into()),
    }
}

/// A cap's body with every Doc id it holds (a target's `doc` or `type`, a group holder) at its full 32 bytes, as
/// [`Names::doc`] maps a short one.
pub fn full_docs(v: aven_core::Value) -> aven_core::Value {
    use aven_core::Value as V;
    match v {
        V::Map(kvs) => V::Map(
            kvs.into_iter()
                .map(|(k, x)| {
                    let x = match x {
                        V::Bytes(b)
                            if ["doc", "type", "group"].contains(&k.as_str()) && b.len() != 32 =>
                        {
                            V::Bytes(blake3(&b).0.to_vec())
                        }
                        x => full_docs(x),
                    };
                    (k, x)
                })
                .collect(),
        ),
        V::Array(xs) => V::Array(xs.into_iter().map(full_docs).collect()),
        x => x,
    }
}
