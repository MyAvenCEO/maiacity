//! Selectors, as in `avendb/spec/AvenDB/Selector.lean` (task A1 of the one query engine): one grammar for what every
//! part of the engine picks of a vault's entries by their labels: a share's or a cap's slice (`rules`), a query's plan
//! (`ops::Where::plan`), a mutation's or an actor method's footprint, and what a view wants (avendb-net's Interests).
//! Closed under intersection (`both`) and union (`either`); `fits` decides, test by test, that one selector picks no
//! entry another doesn't (Lean `fits_sound`); and `blind` names the labels a blind peer finds a selector's entries by
//! (Lean `blind_sound`): every entry it picks carries one of them.

use serde_json::{json, Value};

use crate::id::{EntryId, VaultId};
use crate::slice::{Sym, LENS_TYPE, SCHEMA_TYPE};

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
    /// Every schema and lens entry, and nothing else: what a vault's share of its schemas and lenses with everyone
    /// picks (`Examples.lean`'s `schemas`; `lab::Lab::add_schema`).
    pub fn lane() -> Selector {
        Selector::AnyOf(vec![vec![Atom::TypeIn(vec![Sym::new(SCHEMA_TYPE), Sym::new(LENS_TYPE)])]])
    }

    /// The types and the entries every match of it is one of, where each conjunction names its types (`TypeIn`) or its
    /// entries (`EntryIn`): an entry it matches is of one of those types, or one of those entries. `None` where a
    /// conjunction names neither, and any entry may match.
    pub fn named(&self) -> Option<(Vec<Sym>, Vec<EntryId>)> {
        let Selector::AnyOf(ds) = self else { return None };
        let (mut types, mut ids) = (Vec::new(), Vec::new());
        for d in ds {
            let entries = d.iter().find_map(|t| match t { Atom::EntryIn(es) => Some(es), _ => None });
            let typed = d.iter().find_map(|t| match t { Atom::TypeIn(ts) => Some(ts), _ => None });
            match (entries, typed) {
                (Some(es), _) => ids.extend(es.iter().copied()),
                (None, Some(ts)) => types.extend(ts.iter().cloned()),
                (None, None) => return None,
            }
        }
        types.sort();
        types.dedup();
        Some((types, ids))
    }

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

    /// How the page and the ops write a selector: as a query's `where` of labels alone (`ops::Where`), in its normal
    /// form: `{"all": []}`, the whole vault; `{"any": []}`, nothing; one test; `{"all": [test, ..]}`, the entries that
    /// pass every test; or `{"any": [..]}` of those, the entries that pass every test of at least one. A test is an
    /// object of one field:
    ///
    /// - `{"type": ["todo", "note"]}`: its type is one of these;
    /// - `{"author": [vault, ..]}`: the vault that created it is one of these, by its id in 64 hex digits;
    /// - `{"entry": [entry, ..]}`: it is one of these entries;
    /// - `{"created": [from, to]}`: it was created at or after `from` and before `to`, seconds since 1970;
    /// - `{"tag": "work"}`: it carries this tag;
    /// - `{"noTag": ["private", ..]}`: it carries none of these tags;
    /// - `{"onlyTags": ["work", "home"]}`: every tag it carries is one of these.
    ///
    /// "Bob's work todos" is `{"all": [{"type": ["todo"]}, {"tag": "work"}]}`.
    pub fn to_json(&self) -> Value {
        let all = |d: &[Atom]| match d {
            [one] => one.to_json(),
            _ => json!({ "all": d.iter().map(Atom::to_json).collect::<Vec<_>>() }),
        };
        match self {
            Selector::All => json!({ "all": [] }),
            Selector::AnyOf(ds) if ds.len() == 1 => all(&ds[0]),
            Selector::AnyOf(ds) => json!({ "any": ds.iter().map(|d| all(d)).collect::<Vec<_>>() }),
        }
    }

    /// A selector from its JSON, a `where` of labels alone (`ops::Where::of_json`): fails on anything else, on a test
    /// of a value or a `not`, which no selector holds, and on a selector beyond the bounds a peer accepts.
    pub fn of_json(v: &Value) -> Result<Selector, String> {
        let w = crate::ops::Where::of_json(v)?;
        if !w.labels_only() {
            return Err("a share picks entries by their labels alone: type, author, entry, created and tags".into());
        }
        let selector = match w.cover() {
            Selector::AnyOf(ds) if ds.iter().any(Vec::is_empty) => Selector::All,
            s => s,
        };
        if !selector.bounded() {
            return Err("a selector this big no peer accepts".into());
        }
        Ok(selector)
    }
}


impl Selector {
    /// The entries both pick (Lean `Selector.both`): each conjunction of one with each of the other.
    pub fn both(&self, other: &Selector) -> Selector {
        match (self, other) {
            (Selector::All, s) | (s, Selector::All) => s.clone(),
            (Selector::AnyOf(ds), Selector::AnyOf(es)) => {
                Selector::AnyOf(ds.iter().flat_map(|d| es.iter().map(move |e| [d.clone(), e.clone()].concat())).collect())
            }
        }
    }

    /// The entries either picks (Lean `Selector.either`).
    pub fn either(&self, other: &Selector) -> Selector {
        match (self, other) {
            (Selector::AnyOf(ds), Selector::AnyOf(es)) => Selector::AnyOf([ds.clone(), es.clone()].concat()),
            _ => Selector::All,
        }
    }

    /// Whether it picks no entry `outer` doesn't, test by test (Lean `Selector.fits`, sound by `fits_sound`, never
    /// complete: `false` only says it can't tell): `outer` is the whole vault, or each of its conjunctions holds, for
    /// some conjunction of `outer`, a test implying each of that one's tests. How a footprint is checked against a cap.
    pub fn fits(&self, outer: &Selector) -> bool {
        match (self, outer) {
            (_, Selector::All) => true,
            (Selector::All, Selector::AnyOf(_)) => false,
            (Selector::AnyOf(ds), Selector::AnyOf(es)) => {
                ds.iter().all(|d| es.iter().any(|e| e.iter().all(|x| d.iter().any(|y| y.implies(x)))))
            }
        }
    }

    /// The labels a blind peer finds it by (Lean `Selector.blind`): of each conjunction, the labels of its first test
    /// that names some (a type list, or a tag); `None` where a conjunction has none, or for the whole vault. Every entry
    /// it picks carries one of them (`blind_sound`), so a `find` for their tokens misses none.
    pub fn blind(&self) -> Option<Vec<Label>> {
        let Selector::AnyOf(ds) = self else { return None };
        let labels = ds.iter().map(|d| d.iter().find_map(Atom::labels)).collect::<Option<Vec<_>>>()?;
        Some(labels.concat())
    }
}

impl Atom {
    /// Whether it passes only where `x` passes (Lean `Atom.implies`): the same test, or one asking no less of an
    /// entry: its types, vaults, entries or allowed tags within `x`'s, its time inside `x`'s, more tags it may not carry.
    pub fn implies(&self, x: &Atom) -> bool {
        let within = |ys: &[Sym], xs: &[Sym]| ys.iter().all(|y| xs.contains(y));
        match (self, x) {
            (Atom::TypeIn(ys), Atom::TypeIn(xs)) | (Atom::TagsWithin(ys), Atom::TagsWithin(xs)) => within(ys, xs),
            (Atom::TagNone(ys), Atom::TagNone(xs)) => within(xs, ys),
            (Atom::AuthorIn(ys), Atom::AuthorIn(xs)) => ys.iter().all(|y| xs.contains(y)),
            (Atom::EntryIn(ys), Atom::EntryIn(xs)) => ys.iter().all(|y| xs.contains(y)),
            (Atom::CreatedIn(lo, hi), Atom::CreatedIn(lo2, hi2)) => lo2 <= lo && hi <= hi2,
            (Atom::TagHas(t), Atom::TagHas(u)) => t == u,
            _ => false,
        }
    }

    /// The labels it asks one of (Lean `Atom.label?`): a type list its types, a tag its tag; `None` for another test.
    pub fn labels(&self) -> Option<Vec<Label>> {
        match self {
            Atom::TypeIn(ts) => Some(ts.iter().cloned().map(Label::Type).collect()),
            Atom::TagHas(t) => Some(vec![Label::Tag(t.clone())]),
            _ => None,
        }
    }
}

/// A label a blind peer holds a token of (`index`, Lean `BlindIndex.lean`): an entry's type, or one of its tags.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Label {
    Type(Sym),
    Tag(Sym),
}

impl Attrs {
    /// The labels the entry carries: its type, then its tags.
    pub fn labels(&self) -> Vec<Label> {
        std::iter::once(Label::Type(self.ty.clone())).chain(self.tags.iter().cloned().map(Label::Tag)).collect()
    }
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

    fn sel(ds: &[&[Atom]]) -> Selector {
        Selector::AnyOf(ds.iter().map(|d| d.to_vec()).collect())
    }

    /// The `#guard`s of `Selector.lean`, case for case.
    #[test]
    fn fits_and_blind_say_what_the_model_says() {
        let (todo, note, work) = (Sym::from("1"), Sym::from("3"), Sym::from("2"));
        let work_todos = sel(&[&[Atom::TypeIn(vec![todo.clone()]), Atom::TagHas(work.clone())]]);
        assert!(work_todos.fits(&sel(&[&[Atom::TypeIn(vec![todo.clone()])]])));
        assert!(work_todos.fits(&sel(&[&[Atom::TagHas(work.clone())]])));
        assert!(!sel(&[&[Atom::TypeIn(vec![todo.clone()])]]).fits(&work_todos));
        let both_types = sel(&[&[Atom::TypeIn(vec![todo.clone(), note.clone()])]]);
        assert!(sel(&[&[Atom::TypeIn(vec![todo.clone()])]]).fits(&both_types));
        assert!(!both_types.fits(&sel(&[&[Atom::TypeIn(vec![todo.clone()])]])));
        assert!(sel(&[&[Atom::CreatedIn(5, 9)]]).fits(&sel(&[&[Atom::CreatedIn(0, 10)]])));
        assert!(!sel(&[&[Atom::CreatedIn(0, 10)]]).fits(&sel(&[&[Atom::CreatedIn(5, 9)]])));
        assert!(!Selector::All.fits(&sel(&[&[Atom::TypeIn(vec![todo.clone()])]])) && sel(&[]).fits(&sel(&[])));
        assert_eq!(work_todos.blind(), Some(vec![Label::Type(todo.clone())]));
        let either = sel(&[&[Atom::TagHas(work.clone())], &[Atom::TypeIn(vec![todo.clone(), note.clone()])]]);
        assert_eq!(either.blind(), Some(vec![Label::Tag(work), Label::Type(todo), Label::Type(note)]));
        assert_eq!(sel(&[&[Atom::CreatedIn(0, 9)]]).blind(), None);
        assert_eq!(Selector::All.blind(), None);
    }

    /// `both` picks exactly what both pick and `either` what either picks; `fits` is sound and `blind` misses none: over
    /// every pair of a few selectors and a few entries.
    #[test]
    fn both_either_fits_and_blind_hold_their_laws() {
        let ty = |t: &str| Atom::TypeIn(vec![t.into()]);
        let selectors = [
            Selector::All,
            sel(&[]),
            sel(&[&[ty("todo")]]),
            sel(&[&[ty("todo"), Atom::TagHas("work".into())]]),
            sel(&[&[Atom::TagHas("work".into())], &[ty("note")]]),
            sel(&[&[Atom::CreatedIn(5, 20)]]),
            sel(&[&[Atom::TagNone(vec!["private".into()])], &[Atom::EntryIn(vec![EntryId::from_u64(7)])]]),
        ];
        let entries = [attrs("todo", &["work"]), attrs("todo", &[]), attrs("note", &["private"]), attrs("x", &["work"])];
        for s in &selectors {
            for t in &selectors {
                for a in &entries {
                    assert_eq!(s.both(t).matches(a), s.matches(a) && t.matches(a), "{s:?} both {t:?}");
                    assert_eq!(s.either(t).matches(a), s.matches(a) || t.matches(a), "{s:?} either {t:?}");
                    if s.fits(t) && s.matches(a) {
                        assert!(t.matches(a), "{s:?} fits {t:?}");
                    }
                }
            }
            for a in &entries {
                if let (Some(ls), true) = (s.blind(), s.matches(a)) {
                    assert!(a.labels().iter().any(|l| ls.contains(l)), "{s:?} found blind");
                }
            }
        }
    }
}
