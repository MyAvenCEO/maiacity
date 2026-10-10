//! How the page names what the core says (JSON): kinds, roles and statuses by their lowercase names, ids in 64 hex
//! digits, and a cap's slice, what it shares of its vault's entries. The Mac app's device takes the same words
//! (`avendb-device`).
//!
//! A slice is `{select, relabel}`: `relabel` the tags its grantee may ask the vault's stewards to add or remove, and
//! `select` either `"all"`, the whole vault, or a list of conjunctions, each a list of tests, of which an entry passes
//! every test of at least one (`avendb::slice::Selector`). A test is an object of one field:
//!
//! - `{"type": ["todo", "note"]}`: its type is one of these;
//! - `{"author": [vault, ..]}`: the vault that created it is one of these;
//! - `{"entry": [entry, ..]}`: it is one of these entries;
//! - `{"created": [from, to]}`: it was created at or after `from` and before `to`, seconds since 1970;
//! - `{"tag": "work"}`: it carries this tag;
//! - `{"noTag": ["private", ..]}`: it carries none of these tags;
//! - `{"onlyTags": ["work", "home"]}`: every tag it carries is one of these.
//!
//! "Bob's work todos" is `[[{"type": ["todo"]}, {"tag": "work"}]]`.

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::id::{BlobId, EntryId, VaultId};
use avendb::lens::Status;
use avendb::policy::{Kind, Role};
use avendb::slice::{Atom, Selector, Slice, Sym};
use serde_json::{Map, Value, json};

pub fn kind_name(kind: Kind) -> &'static str {
    match kind {
        Kind::Human => "human",
        Kind::Coop => "coop",
        Kind::Aven => "aven",
    }
}

pub fn role_name(role: Role) -> &'static str {
    match role {
        Role::Relay => "relay",
        Role::Read => "read",
        Role::Write => "write",
        Role::Owner => "owner",
    }
}

pub fn status_name(status: Status) -> &'static str {
    match status {
        Status::Open => "open",
        Status::Doing => "doing",
        Status::Done => "done",
    }
}

/// A role by its name: `"relay"`, `"read"`, `"write"` or `"owner"`.
pub fn role_of(name: &str) -> Result<Role> {
    Ok(match name {
        "relay" => Role::Relay,
        "read" => Role::Read,
        "write" => Role::Write,
        "owner" => Role::Owner,
        _ => bail!("a role is relay, read, write or owner"),
    })
}

/// A todo's status by its name: `"open"`, `"doing"` or `"done"`.
pub fn status_of(name: &str) -> Result<Status> {
    Ok(match name {
        "open" => Status::Open,
        "doing" => Status::Doing,
        "done" => Status::Done,
        _ => bail!("a todo is open, doing or done"),
    })
}

/// 32 bytes as 64 lowercase hex digits, as the page sees every id.
pub fn hex(b: &[u8; 32]) -> String {
    BlobId(*b).to_hex()
}

/// An id from its 64 lowercase hex digits.
pub fn id_of(s: &str) -> Result<[u8; 32]> {
    BlobId::from_hex(s).map(|b| b.0).ok_or_else(|| anyhow!("{s:?} is no id"))
}

/// A slice as the page reads it: `{select, relabel}`.
pub fn slice_value(s: &Slice) -> Value {
    json!({ "select": selector_value(&s.select), "relabel": s.relabel.iter().map(Sym::as_str).collect::<Vec<_>>() })
}

/// A selector as the page reads it: `"all"`, or its conjunctions.
pub fn selector_value(s: &Selector) -> Value {
    let syms = |xs: &[Sym]| xs.iter().map(|x| x.as_str().to_string()).collect::<Vec<_>>();
    let atom = |a: &Atom| match a {
        Atom::TypeIn(ts) => json!({ "type": syms(ts) }),
        Atom::AuthorIn(vs) => json!({ "author": vs.iter().map(|v| hex(&v.0)).collect::<Vec<_>>() }),
        Atom::EntryIn(es) => json!({ "entry": es.iter().map(|e| hex(&e.0)).collect::<Vec<_>>() }),
        Atom::CreatedIn(from, to) => json!({ "created": [from, to] }),
        Atom::TagHas(t) => json!({ "tag": t.as_str() }),
        Atom::TagNone(ts) => json!({ "noTag": syms(ts) }),
        Atom::TagsWithin(ts) => json!({ "onlyTags": syms(ts) }),
    };
    match s {
        Selector::All => Value::from("all"),
        Selector::AnyOf(ds) => ds.iter().map(|d| d.iter().map(atom).collect::<Vec<_>>()).collect(),
    }
}

/// A slice from what the page wrote (`slice_value`): `relabel` may be left out, for no tags to ask for. Fails on
/// anything else, and on a selector beyond the bounds a peer accepts (`Selector::bounded`).
pub fn slice_of(v: &Value) -> Result<Slice> {
    let o = v.as_object().context("a slice is {select, relabel}")?;
    if let Some(other) = o.keys().find(|k| !matches!(k.as_str(), "select" | "relabel")) {
        bail!("a slice has no field {other:?}");
    }
    let select = selector_of(o.get("select").context("a slice selects something")?)?;
    let relabel = match o.get("relabel") {
        None | Some(Value::Null) => vec![],
        Some(v) => syms(v).context("relabel is a list of tags")?,
    };
    Ok(Slice { select, relabel })
}

/// A selector from what the page wrote (`selector_value`).
pub fn selector_of(v: &Value) -> Result<Selector> {
    if v.as_str() == Some("all") {
        return Ok(Selector::All);
    }
    let conjunction = |d: &Value| -> Result<Vec<Atom>> {
        d.as_array().context("a conjunction is a list of tests")?.iter().map(atom_of).collect()
    };
    let ds = v.as_array().context("a selector is \"all\" or a list of conjunctions")?;
    let selector = Selector::AnyOf(ds.iter().map(conjunction).collect::<Result<_>>()?);
    if !selector.bounded() {
        bail!("a selector this big no peer accepts");
    }
    Ok(selector)
}

/// One test of a selector, an object of one field.
fn atom_of(v: &Value) -> Result<Atom> {
    let o: &Map<String, Value> = v.as_object().context("a test is an object of one field")?;
    let [(name, value)] = o.iter().collect::<Vec<_>>()[..] else { bail!("a test is an object of one field") };
    let ids = |v: &Value| -> Result<Vec<[u8; 32]>> {
        let xs = v.as_array().context("a list of ids")?;
        xs.iter().map(|x| id_of(x.as_str().context("an id is text")?)).collect()
    };
    Ok(match name.as_str() {
        "type" => Atom::TypeIn(syms(value).context("type is a list of types")?),
        "author" => Atom::AuthorIn(ids(value)?.into_iter().map(VaultId).collect()),
        "entry" => Atom::EntryIn(ids(value)?.into_iter().map(EntryId).collect()),
        "created" => {
            let at = |i: usize| value.get(i).and_then(Value::as_u64);
            match (value.as_array().map(Vec::len), at(0), at(1)) {
                (Some(2), Some(from), Some(to)) => Atom::CreatedIn(from, to),
                _ => bail!("created is [from, to], seconds since 1970"),
            }
        }
        "tag" => Atom::TagHas(Sym::new(value.as_str().context("tag is one tag")?)),
        "noTag" => Atom::TagNone(syms(value).context("noTag is a list of tags")?),
        "onlyTags" => Atom::TagsWithin(syms(value).context("onlyTags is a list of tags")?),
        other => bail!("no test is called {other:?}"),
    })
}

/// A list of names: types or tags.
fn syms(v: &Value) -> Option<Vec<Sym>> {
    v.as_array()?.iter().map(|x| x.as_str().map(Sym::new)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slice_reads_back_from_its_words() {
        let work = Selector::AnyOf(vec![vec![Atom::TypeIn(vec!["todo".into()]), Atom::TagHas("work".into())]]);
        let any = Selector::AnyOf(vec![
            vec![Atom::EntryIn(vec![EntryId([7; 32])]), Atom::AuthorIn(vec![VaultId([9; 32])])],
            vec![Atom::CreatedIn(10, 20), Atom::TagNone(vec!["private".into()])],
            vec![Atom::TagsWithin(vec!["a".into(), "b".into()])],
        ]);
        for select in [Selector::All, work, any] {
            let slice = Slice { select, relabel: vec!["urgent".into()] };
            assert_eq!(slice_of(&slice_value(&slice)).expect("its own words"), slice);
        }
        let todos = json!({ "select": [[{ "type": ["todo"] }]] });
        assert_eq!(slice_of(&todos).expect("relabel left out").relabel, vec![]);
    }

    #[test]
    fn a_slice_written_otherwise_is_refused() {
        let bad = [
            json!({ "select": "some" }),
            json!({ "select": [[{ "type": "todo" }]] }),
            json!({ "select": [[{ "type": ["todo"], "tag": "work" }]] }),
            json!({ "select": [[{ "colour": ["red"] }]] }),
            json!({ "select": [[{ "created": [1] }]] }),
            json!({ "select": [[{ "entry": ["beef"] }]] }),
            json!({ "select": "all", "who": "Bob" }),
            json!({ "relabel": [] }),
            json!({ "select": vec![json!([]); 9] }),
        ];
        for slice in bad {
            assert!(slice_of(&slice).is_err(), "{slice}");
        }
    }
}
