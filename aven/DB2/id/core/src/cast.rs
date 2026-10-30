//! The cast's format (`sandbox/cast.json`): `keys`, each id to its public half, and `vaults`, each id to its name,
//! kind and owners, which read `"key:<id>"` or `"vault:<id>"`. The file's order is the tree's. Every key must be an
//! Ed25519 public key; the model knows keys only by id, so that check is the cast's.

use std::fmt;

use serde_json::{Map, Value};

use crate::keys::parse_public;
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
            if parse_public(public).is_none() {
                return Err(CastError::Format(format!(
                    "key {id} is not an Ed25519 public key in hex"
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
            let name = match vault.get("name") {
                Some(name) => text(name, &format!("{id}'s name"))?.to_string(),
                None => id.clone(),
            };
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
            vaults.push(Vault {
                id: id.clone(),
                name,
                kind,
                owners,
            });
        }
        Tree::new(keys, vaults).map_err(CastError::Invalid)
    }
}
