//! Slices, as in `avendb/spec/AvenDB/Basic.lean`: what a cap selects of its vault's entries, and what a write says of
//! its entry. A cap selects entries by what their first write says of them (their type, the vault that created them,
//! their id, when they were created) and by their tags now; groups of entries are never named, a slice is whatever a
//! selector picks. The header and the tags travel inside the encrypted body of a write and the selector is sealed, so
//! no rule of `policy` reads any of this: only a vault's stewards (the devices acting for it) and a cap's grantee read
//! a selector, and only an entry's readers its header and tags (`policy::Meaning`).

use serde_json::{json, Value};

use crate::id::{EditId, EntryId, VaultId};
use crate::keys::KeyBox;

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

/// What a selector tests of an entry: what its first write says of it, which never changes, and its tags now.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Attrs {
    pub ty: Sym,
    pub author: VaultId,
    pub entry: EntryId,
    pub created: u64,
    pub tags: Vec<Sym>,
}

/// One test. `TypeIn(vec![t])` is `type == t`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Atom {
    TypeIn(Vec<Sym>),
    AuthorIn(Vec<VaultId>),
    EntryIn(Vec<EntryId>),
    /// Created in `[from, to)`.
    CreatedIn(u64, u64),
    TagHas(Sym),
    TagNone(Vec<Sym>),
    TagsWithin(Vec<Sym>),
}

impl Atom {
    pub fn test(&self, a: &Attrs) -> bool {
        match self {
            Atom::TypeIn(ts) => ts.contains(&a.ty),
            Atom::AuthorIn(vs) => vs.contains(&a.author),
            Atom::EntryIn(es) => es.contains(&a.entry),
            Atom::CreatedIn(from, to) => *from <= a.created && a.created < *to,
            Atom::TagHas(t) => a.tags.contains(t),
            Atom::TagNone(ts) => !ts.iter().any(|t| a.tags.contains(t)),
            Atom::TagsWithin(ts) => a.tags.iter().all(|t| ts.contains(t)),
        }
    }

    /// The test as JSON (`Selector::to_json`).
    pub fn to_json(&self) -> Value {
        let syms = |xs: &[Sym]| xs.iter().map(|x| x.as_str().to_string()).collect::<Vec<_>>();
        match self {
            Atom::TypeIn(ts) => json!({ "type": syms(ts) }),
            Atom::AuthorIn(vs) => json!({ "author": vs.iter().map(VaultId::to_hex).collect::<Vec<_>>() }),
            Atom::EntryIn(es) => json!({ "entry": es.iter().map(EntryId::to_hex).collect::<Vec<_>>() }),
            Atom::CreatedIn(from, to) => json!({ "created": [from, to] }),
            Atom::TagHas(t) => json!({ "tag": t.as_str() }),
            Atom::TagNone(ts) => json!({ "noTag": syms(ts) }),
            Atom::TagsWithin(ts) => json!({ "onlyTags": syms(ts) }),
        }
    }

    /// One test from its JSON, an object of one field.
    pub fn of_json(v: &Value) -> Result<Atom, String> {
        let one = v.as_object().filter(|o| o.len() == 1).and_then(|o| o.iter().next());
        let (name, value) = one.ok_or("a test is an object of one field")?;
        let syms = |what: &str| -> Result<Vec<Sym>, String> {
            let names = value.as_array().and_then(|xs| xs.iter().map(|x| x.as_str().map(Sym::new)).collect());
            names.ok_or_else(|| format!("{what} is a list of names"))
        };
        let ids = || -> Result<Vec<[u8; 32]>, String> {
            let xs = value.as_array().ok_or("a list of ids")?;
            let id = |x: &Value| x.as_str().and_then(EntryId::from_hex).map(|e| e.0).ok_or("an id is 64 hex digits");
            Ok(xs.iter().map(id).collect::<Result<_, _>>()?)
        };
        Ok(match name.as_str() {
            "type" => Atom::TypeIn(syms("type")?),
            "author" => Atom::AuthorIn(ids()?.into_iter().map(VaultId).collect()),
            "entry" => Atom::EntryIn(ids()?.into_iter().map(EntryId).collect()),
            "created" => {
                let at = |i: usize| value.get(i).and_then(Value::as_u64);
                match (value.as_array().map(Vec::len), at(0), at(1)) {
                    (Some(2), Some(from), Some(to)) => Atom::CreatedIn(from, to),
                    _ => return Err("created is [from, to], seconds since 1970".into()),
                }
            }
            "tag" => Atom::TagHas(Sym::new(value.as_str().ok_or("tag is one tag")?)),
            "noTag" => Atom::TagNone(syms("noTag")?),
            "onlyTags" => Atom::TagsWithin(syms("onlyTags")?),
            other => return Err(format!("no test is called {other:?}")),
        })
    }
}

/// The whole vault, or the entries that pass every test of at least one of the conjunctions.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Selector {
    All,
    AnyOf(Vec<Vec<Atom>>),
}

/// The most conjunctions a selector has, the most tests a conjunction has, and the most ids an `EntryIn` names: so
/// matching stays linear in the entry and a selector fits in a sealed box.
pub const MAX_CONJUNCTIONS: usize = 8;
pub const MAX_TESTS: usize = 16;
pub const MAX_IDS: usize = 1000;

impl Selector {
    pub fn matches(&self, a: &Attrs) -> bool {
        match self {
            Selector::All => true,
            Selector::AnyOf(ds) => ds.iter().any(|d| d.iter().all(|t| t.test(a))),
        }
    }

    /// Within the bounds a peer accepts (`MAX_CONJUNCTIONS`, `MAX_TESTS`, `MAX_IDS`).
    pub fn bounded(&self) -> bool {
        let atom = |t: &Atom| match t {
            Atom::TypeIn(xs) | Atom::TagNone(xs) | Atom::TagsWithin(xs) => xs.len() <= MAX_IDS,
            Atom::AuthorIn(xs) => xs.len() <= MAX_IDS,
            Atom::EntryIn(xs) => xs.len() <= MAX_IDS,
            Atom::CreatedIn(..) | Atom::TagHas(_) => true,
        };
        match self {
            Selector::All => true,
            Selector::AnyOf(ds) => {
                ds.len() <= MAX_CONJUNCTIONS && ds.iter().all(|d| d.len() <= MAX_TESTS && d.iter().all(atom))
            }
        }
    }

    /// How the page and the ops write a selector (JSON): `"all"`, the whole vault, or a list of conjunctions, each a
    /// list of tests, of which an entry passes every test of at least one. A test is an object of one field:
    ///
    /// - `{"type": ["todo", "note"]}`: its type is one of these;
    /// - `{"author": [vault, ..]}`: the vault that created it is one of these, by its id in 64 hex digits;
    /// - `{"entry": [entry, ..]}`: it is one of these entries;
    /// - `{"created": [from, to]}`: it was created at or after `from` and before `to`, seconds since 1970;
    /// - `{"tag": "work"}`: it carries this tag;
    /// - `{"noTag": ["private", ..]}`: it carries none of these tags;
    /// - `{"onlyTags": ["work", "home"]}`: every tag it carries is one of these.
    ///
    /// "Bob's work todos" is `[[{"type": ["todo"]}, {"tag": "work"}]]`.
    pub fn to_json(&self) -> Value {
        match self {
            Selector::All => Value::from("all"),
            Selector::AnyOf(ds) => ds.iter().map(|d| d.iter().map(Atom::to_json).collect::<Vec<_>>()).collect(),
        }
    }

    /// A selector from its JSON: fails on anything else, and on a selector beyond the bounds a peer accepts.
    pub fn of_json(v: &Value) -> Result<Selector, String> {
        if v.as_str() == Some("all") {
            return Ok(Selector::All);
        }
        let conjunction = |d: &Value| -> Result<Vec<Atom>, String> {
            d.as_array().ok_or("a conjunction is a list of tests")?.iter().map(Atom::of_json).collect()
        };
        let ds = v.as_array().ok_or("a selector is \"all\" or a list of conjunctions")?;
        let selector = Selector::AnyOf(ds.iter().map(conjunction).collect::<Result<_, _>>()?);
        if !selector.bounded() {
            return Err("a selector this big no peer accepts".into());
        }
        Ok(selector)
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

/// What a cap's sealed `select` holds (`policy::Cap::select`): its selector, and the tags its grantee may ask the
/// vault's stewards to add or remove.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Slice {
    pub select: Selector,
    pub relabel: Vec<Sym>,
}

impl Slice {
    /// The whole vault, with no tags to ask for: a wide cap's slice.
    pub fn all() -> Slice {
        Slice { select: Selector::All, relabel: vec![] }
    }

    /// The entries `select` picks, with no tags to ask for.
    pub fn of(select: Selector) -> Slice {
        Slice { select, relabel: vec![] }
    }
}

/// What a cap's `select` holds (`policy::Cap::select`): its slice, in the clear for a cap to Public, else sealed: the
/// slice encrypted under a key of its own and bound to the cap (`keys::seal_edit`, `encode::cap_context`), and that key
/// in a box for each vault that reads the slice, wrapped or sealed to the vault's seed (`encode::select_info`): the
/// vault the cap is over, whose stewards keep its entries in their cells, its grantee unless it only relays, and its
/// issuer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Select {
    Clear(Slice),
    Sealed { boxes: Vec<KeyBox>, slice: Vec<u8> },
}

/// What a write's ciphertext holds: the header of the entry it creates; the tags it adds and removes, which count when
/// it acts for the entry's vault and otherwise ask the vault's stewards to; the writes whose asks it answers, a
/// steward's; and its content: a Loro update, a proposal's name, or nothing for a merge or a write of tags alone.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Body {
    pub header: Option<Header>,
    pub tags: TagDelta,
    /// Smallest first, no repeats.
    pub answers: Vec<EditId>,
    pub content: Vec<u8>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attrs(ty: &str, tags: &[&str]) -> Attrs {
        Attrs {
            ty: ty.into(),
            author: VaultId::from_u64(1),
            entry: EntryId::from_u64(7),
            created: 10,
            tags: tags.iter().map(|&t| t.into()).collect(),
        }
    }

    #[test]
    fn a_selector_picks_by_type_tags_author_entry_and_time() {
        let work_todos = Selector::AnyOf(vec![vec![Atom::TypeIn(vec!["todo".into()]), Atom::TagHas("work".into())]]);
        assert!(work_todos.matches(&attrs("todo", &["work"])));
        assert!(!work_todos.matches(&attrs("todo", &["home"])) && !work_todos.matches(&attrs("note", &["work"])));
        let seven = vec![Atom::EntryIn(vec![EntryId::from_u64(7)])];
        let either = Selector::AnyOf(vec![seven, vec![Atom::TagHas("x".into())]]);
        assert!(either.matches(&attrs("note", &[])));
        let a = attrs("note", &["a", "b"]);
        assert!(Atom::CreatedIn(10, 11).test(&a) && !Atom::CreatedIn(0, 10).test(&a));
        assert!(Atom::AuthorIn(vec![VaultId::from_u64(1)]).test(&a) && !Atom::AuthorIn(vec![]).test(&a));
        assert!(Atom::TagNone(vec!["c".into()]).test(&a) && !Atom::TagNone(vec!["b".into()]).test(&a));
        assert!(Atom::TagsWithin(vec!["a".into(), "b".into(), "c".into()]).test(&a));
        assert!(!Atom::TagsWithin(vec!["a".into()]).test(&a));
        assert!(Selector::All.matches(&a) && !Selector::AnyOf(vec![]).matches(&a));
    }

    #[test]
    fn a_tag_delta_removes_then_adds_each_tag_once() {
        let s = |xs: &[&str]| xs.iter().map(|&t| Sym::from(t)).collect::<Vec<_>>();
        let d = TagDelta { add: s(&["b", "c", "c", "d"]), remove: s(&["a", "d"]) };
        assert_eq!(d.apply(&s(&["a", "b"])), s(&["b", "c", "d"]));
        assert_eq!(TagDelta::default().apply(&s(&["x"])), s(&["x"]));
    }
}
