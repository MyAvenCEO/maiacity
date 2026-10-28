//! Slices, as in `aven/db/spec/AvenDB/Basic.lean`: what a share selects of its vault's entries (by a selector,
//! `crate::selector`), and what a write says of its entry. A share selects entries by what their first write says of them (their type, the vault that created them,
//! their id, when they were created) and by their tags now; groups of entries are never named, a slice is whatever a
//! selector picks. The header and the tags travel inside the encrypted body of a write and the selector is sealed, so
//! no rule of `policy` reads any of this: only a vault's stewards (the devices acting for it) and a share's grantee
//! read a selector, and only an entry's readers its header and tags (`policy::Meaning`).

use std::sync::Arc;
use serde_json::{json, Value};

use crate::id::EditId;
use crate::keys::KeyBox;
use crate::rules::{self, CapGroup, Grant, Op, Proof};
use crate::sealed::Brought;

pub use crate::selector::{Atom, Attrs, Selector, MAX_CONJUNCTIONS, MAX_IDS, MAX_TESTS};

/// A type (`note`, `todo`, …) or a tag: a short name.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Sym(pub String);

impl Sym {
    pub fn new(name: &str) -> Sym {
        Sym(name.to_owned())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for Sym {
    fn from(name: &str) -> Sym {
        Sym::new(name)
    }
}

impl std::fmt::Debug for Sym {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self.0)
    }
}

/// The types of the entries that carry a vault's schemas and its lenses (design §5; `State.lean`'s `schemaType` and
/// `lensType`): every keep share that adds entries picks them too, and a never share none of them
/// (`policy::keep_picks`), so a device that syncs any of a vault syncs its lane.
pub const SCHEMA_TYPE: &str = "schema";
pub const LENS_TYPE: &str = "lens";

/// The type of the entries that carry a vault's cap groups (`State.lean`'s `capGroupType`): every share over the vault
/// selects them, so whoever reads anything of a vault reads its cap groups and judges each write alike, and every keep
/// share that adds entries picks them too (`policy::keep_picks`).
pub const CAP_GROUP_TYPE: &str = "capgroup";

impl Sym {
    /// The type of the entries that carry a vault's schemas or its lenses.
    pub fn of_lane(&self) -> bool {
        self.0 == SCHEMA_TYPE || self.0 == LENS_TYPE
    }

    /// The type of the entries that carry a vault's cap groups.
    pub fn is_cap_group(&self) -> bool {
        self.0 == CAP_GROUP_TYPE
    }

    /// The type of the entries every device that syncs part of a vault syncs too (`State.lean`'s `laneTypes`): its
    /// schemas, lenses and cap groups.
    pub fn synced_by_all(&self) -> bool {
        self.of_lane() || self.is_cap_group()
    }
}

/// The tags a write adds and removes.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct TagDelta {
    pub add: Vec<Sym>,
    pub remove: Vec<Sym>,
}

impl TagDelta {
    /// Remove, then add what isn't there yet, each once.
    pub fn apply(&self, tags: &[Sym]) -> Vec<Sym> {
        let mut out: Vec<Sym> = tags.iter().filter(|t| !self.remove.contains(t)).cloned().collect();
        let kept = out.len();
        for t in &self.add {
            if !out[..kept].contains(t) && !out[kept..].contains(t) {
                out.push(t.clone());
            }
        }
        out
    }

    pub fn is_empty(&self) -> bool {
        self.add.is_empty() && self.remove.is_empty()
    }
}

/// What an entry's first write says of it, which never changes: its type and when it was created (as its creator
/// says).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Header {
    pub ty: Sym,
    pub created: u64,
}

/// What a share's sealed `select` holds (`policy::Share::select`): its name, its selector, and its grant: the ops its
/// grantee may make, with the salt whose hash with them is the commitment its `select` carries in the clear. A share
/// resting on others carries their grants too (`above`, root first), copied by its issuer from the slice of the share
/// it rests on: so its grantee can prove a write against every share of its chain (`rules::Proof`).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Slice {
    pub name: String,
    pub select: Selector,
    pub grant: Grant,
    pub above: Vec<Grant>,
}

impl Slice {
    /// The grants of every share of its share's chain, root first: what a write relying on its share proves.
    pub fn grants(&self) -> Vec<Grant> {
        self.above.iter().chain([&self.grant]).cloned().collect()
    }

    /// How the page and the docs write a share's slice: `{"name", "where", "ops"}` (`spec_of_json`), with the ops of
    /// the shares it rests on, root first, as `"above"`: what the shares of its chain allow too. No salt.
    pub fn to_json(&self) -> Value {
        let above: Vec<Value> = self.above.iter().map(|g| rules::ops_to_json(&g.ops)).collect();
        json!({
            "name": self.name,
            "where": self.select.to_json(),
            "ops": rules::ops_to_json(&self.grant.ops),
            "above": above,
        })
    }
}

/// What a new share names, from its JSON as the page and the docs write it: `{"name": "Work todos", "where": {"all":
/// [{"type": ["todo"]}, {"tag": "work"}]}, "ops": [{"op": "read"}, {"op": "set", "path": ["status"]}]}`, `where` left
/// out for the whole vault (`Selector::of_json`, `rules::Op::of_json`): its name, its selector and its ops in order
/// (`rules::normalize`). Fails on anything else, on a name blank or too long and on no op.
pub fn spec_of_json(v: &Value) -> Result<(String, Selector, Vec<Op>), String> {
    let o = v.as_object().ok_or("a share is {name, where, ops}")?;
    if let Some(k) = o.keys().find(|k| !matches!(k.as_str(), "name" | "where" | "ops")) {
        return Err(format!("a share takes no field {k:?}: it is {{name, where, ops}}"));
    }
    let name = o.get("name").and_then(Value::as_str).ok_or("a share has a name")?;
    rules::name_ok(name)?;
    let select = o.get("where").map_or(Ok(Selector::All), Selector::of_json)?;
    let ops = rules::normalize(rules::ops_of_json(o.get("ops").ok_or("a share names its ops")?)?)?;
    Ok((name.to_string(), select, ops))
}

/// What a share's `select` holds (`policy::Share::select`): its slice, in the clear for a share to everyone, else
/// sealed: the slice encrypted under a key of its own and bound to the share (`keys::seal_edit`,
/// `encode::share_context`), and that key in a box for each vault that reads the slice, wrapped or sealed to the
/// vault's seed (`encode::share_select_info`): the vault the share is over, whose stewards keep its entries in their
/// audiences, its grantee unless it only relays or keeps, and its issuer.
///
/// The commitment to a share's ops (`rules::Grant::commitment`) travels in the clear beside its sealed slice: salted,
/// it tells every peer, a relay too, nothing of them, and binds what a proof opens to what the share was issued with.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Select {
    Clear(Slice),
    Sealed { boxes: Vec<KeyBox>, slice: Vec<u8>, commitment: [u8; 32] },
}

impl Select {
    /// The commitment to its share's ops.
    pub fn commitment(&self) -> [u8; 32] {
        match self {
            Select::Clear(slice) => slice.grant.commitment(),
            Select::Sealed { commitment, .. } => *commitment,
        }
    }
}

/// What a write's ciphertext holds: the header of the entry it creates; the tags it adds and removes, which count when
/// it acts for the entry's vault and otherwise ask the vault's stewards to; the writes whose asks it answers, a
/// steward's; its content: a Loro update, a proposal's name, or nothing for a merge or a write of tags alone; and the
/// proof of a write through a share (`rules::Proof`), which its readers check its touches and asks against; and, of a
/// cap group entry, the cap group its record says after it (`defines`), which counts where the vault itself writes it
/// on its main line (`policy::Groups`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Body {
    pub header: Option<Header>,
    pub tags: TagDelta,
    /// Smallest first, no repeats.
    pub answers: Vec<EditId>,
    /// Shared with the history it is judged into (`history::Change::body`): held once, however many hold it.
    pub content: Arc<[u8]>,
    pub proof: Option<Proof>,
    /// The keys and lengths of the files it brings, which it names in the clear (`Action::Write`): smallest root
    /// first, no repeats.
    pub files: Vec<Brought>,
    pub defines: Option<CapGroup>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tag_delta_removes_then_adds_each_tag_once() {
        let s = |xs: &[&str]| xs.iter().map(|&t| Sym::from(t)).collect::<Vec<_>>();
        let d = TagDelta { add: s(&["b", "c", "c", "d"]), remove: s(&["a", "d"]) };
        assert_eq!(d.apply(&s(&["a", "b"])), s(&["b", "c", "d"]));
        assert_eq!(TagDelta::default().apply(&s(&["x"])), s(&["x"]));
    }
}
