//! The cast's format (`sandbox/cast.json`): `keys`, each id to its public half, and `vaults`, each id to its name
//! (required: every vault has one), kind and owners, which read `"key:<id>"` or `"vault:<id>"`. The file's order is the tree's. Every key must be an
//! Ed25519 public key in hex or a passkey's `es256:<SPKI in hex>`; the model knows keys only by id, so that check is
//! the cast's. [`Tree::to_cast`] writes a tree back in the same form, for avenOS.

use std::fmt;

use serde_json::{Map, Value};

use crate::keys::valid_public;
use crate::tree::{Invalid, Kind, Owner, Tree, Vault};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CastError {
    /// Not JSON, or not the cast's shape.
    Format(String),
    /// Read, but not a well-formed tree.
    Invalid(Invalid),
}

impl fmt::Display for CastError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CastError::Format(why) => write!(f, "not a cast: {why}"),
            CastError::Invalid(why) => write!(f, "not a well-formed tree: {why}"),
        }
    }
}

impl std::error::Error for CastError {}

fn object<'a>(value: &'a Value, what: &str) -> Result<&'a Map<String, Value>, CastError> {
    value
        .as_object()
        .ok_or_else(|| CastError::Format(format!("{what} is not an object")))
}

fn text<'a>(value: &'a Value, what: &str) -> Result<&'a str, CastError> {
    value
        .as_str()
        .ok_or_else(|| CastError::Format(format!("{what} is not a string")))
}

impl Tree {
    /// The tree in a cast's JSON.
    pub fn from_cast(json: &str) -> Result<Tree, CastError> {
        let cast: Value =
            serde_json::from_str(json).map_err(|e| CastError::Format(e.to_string()))?;
        let cast = object(&cast, "the cast")?;
        let empty = Value::Object(Map::new());
        let mut keys = Vec::new();
        for (id, public) in object(cast.get("keys").unwrap_or(&empty), "keys")? {
            let public = text(public, &format!("key {id}"))?;
            if !valid_public(public) {
                return Err(CastError::Format(format!(
                    "key {id} is neither an Ed25519 public key in hex nor es256:<SPKI in hex>"
                )));
            }
            keys.push((id.clone(), public.to_string()));
        }
        let mut vaults = Vec::new();
        for (id, vault) in object(cast.get("vaults").unwrap_or(&empty), "vaults")? {
            let vault = object(vault, &format!("vault {id}"))?;
            let kind = text(
                vault.get("kind").unwrap_or(&Value::Null),
                &format!("{id}'s kind"),
            )?;
            let kind = Kind::parse(kind)
                .ok_or_else(|| CastError::Format(format!("{id}'s kind {kind} is unknown")))?;
            let name = text(
                vault.get("name").unwrap_or(&Value::Null),
                &format!("{id}'s name"),
            )?
            .to_string();
            let mut owners = Vec::new();
            let listed = vault.get("owners").and_then(Value::as_array);
            for owner in
                listed.ok_or_else(|| CastError::Format(format!("{id}'s owners are not a list")))?
            {
                let owner = text(owner, &format!("{id}'s owner"))?;
                owners.push(Owner::parse(owner).ok_or_else(|| {
                    CastError::Format(format!("{id}'s owner {owner} is neither key: nor vault:"))
                })?);
            }
            // a tree written before thresholds (A28) has none: its vaults took one owner each
            let threshold = match vault.get("threshold") {
                None | Some(Value::Null) => 1,
                Some(t) => t
                    .as_u64()
                    .ok_or_else(|| CastError::Format(format!("{id}'s threshold is not a number")))?
                    as usize,
            };
            // a device's vault names its key, and no other vault does (A211)
            let key = match vault.get("key") {
                None => None,
                Some(k) => Some(text(k, &format!("{id}'s key"))?.to_string()),
            };
            if (kind == Kind::Device) != key.is_some() {
                return Err(CastError::Format(format!(
                    "{id}: a device's vault names its key, and no other vault does"
                )));
            }
            vaults.push(Vault {
                id: id.clone(),
                name,
                kind,
                owners,
                threshold,
                key,
            });
        }
        Tree::new(keys, vaults).map_err(CastError::Invalid)
    }
}

impl Tree {
    /// The tree in the cast's form, in its order: what the Aven Peer tells its devices.
    pub fn to_cast(&self) -> String {
        let keys: Map<String, Value> = self
            .keys()
            .map(|(id, public)| (id.to_string(), Value::from(public)))
            .collect();
        let vaults: Map<String, Value> = self
            .vaults()
            .iter()
            .map(|v| {
                let owners: Vec<String> = v.owners.iter().map(ToString::to_string).collect();
                let mut vault = serde_json::json!({ "name": v.name, "kind": v.kind.as_str(), "owners": owners });
                if let Some(key) = &v.key {
                    vault["key"] = Value::from(key.as_str());
                }
                (v.id.clone(), vault)
            })
            .collect();
        serde_json::json!({ "keys": keys, "vaults": vaults }).to_string()
    }
}
