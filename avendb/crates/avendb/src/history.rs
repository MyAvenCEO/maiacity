//! History and proposals of one entry (T10; `avendb/spec/AvenDB/Proposals.lean` and `Doc.lean`). Every write is an
//! edit, named by its edit id: it extends one line of the entry's history, the main line or a proposal
//! (`policy::Proposal`), and a line's history is its own writes and every write they build on (`policy::history`). What
//! a device shows on a line is the Loro content of the updates in that history. A version is any set of the entry's
//! writes, and holds what they build on: a device opens one read-only on a scratch item made from those updates, never
//! by checking out the item it edits, which would stop it taking imports.
//!
//! On each line a device edits as a Loro peer of that line (`doc`), so its edits on one line never wait for its edits
//! on another. A proposal starts from any version with a write that holds the proposal's name. A merge is a write on
//! the target that builds on the heads of both lines and carries no change: its history is the union of both (T10g),
//! which Loro merges, so the order of merges doesn't matter and merging again changes nothing. A promote is the same
//! write carrying the change that brings the merged item to exactly the proposal's record: the target then shows the
//! proposal and keeps both histories (T10h). The merged item imports first and changes after; Loro's own revert is not
//! used, as it isn't atomic in Loro 1.16.
//!
//! Only a line's latest edit is reverted as it is: its line goes back to the record of the version it built on
//! (`restore`, which puts back any version's record). An older edit is undone by a three-way merge of records
//! (`undo`), which keeps every change made since. A variant copies an item's record into a new entry, with no history
//! (`doc::Item::copy`). A device stores full Loro snapshots (`doc::Item::bytes`), never shallow ones: a shallow
//! snapshot refuses the updates of a proposal that starts before it.
//!
//! `History` is what a device holds of one entry, every accepted write with what it could open; the Lab builds one
//! for each entry it shows. `Repo` keeps one locally, with no keys and no caps, for the tests and the property checks.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde_json::{Map, Value};

use crate::doc::Item;
use crate::id::{BlobId, CellId, EditId, EntryId, SignerId, VaultId};
use crate::policy::{self, Line, Proposal, Refusal, Write};

/// The main line.
pub const MAIN: Line = None;

/// One accepted write of an entry as a device holds it: the write, and what it carries if the device could open it:
/// a Loro update, nothing for a merge, or for a write that starts a proposal, the proposal's name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Change {
    pub write: Write,
    pub body: Option<Vec<u8>>,
}

impl AsRef<Write> for Change {
    fn as_ref(&self) -> &Write {
        &self.write
    }
}

/// A write a device is about to make on an entry: the line it extends, what it builds on, and what it carries.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Draft {
    pub proposal: Proposal,
    pub deps: Vec<EditId>,
    pub body: Vec<u8>,
}

/// The proposal a write extending `line` names.
fn on(line: Line) -> Proposal {
    line.map_or(Proposal::Main, Proposal::On)
}

/// One entry's history as one device holds it: every accepted write, in replay order.
#[derive(Clone, Debug, Default)]
pub struct History {
    changes: Vec<Change>,
}

impl History {
    /// Add the next accepted write. Refused, as the rules refuse it, if it builds on a write the history doesn't
    /// hold or, on a proposal, on neither the proposal's start nor another write on it.
    pub fn push(&mut self, c: Change) -> Result<(), Refusal> {
        policy::builds_on(&self.changes, &c.write)?;
        self.changes.push(c);
        Ok(())
    }

    pub fn changes(&self) -> &[Change] {
        &self.changes
    }

    pub fn get(&self, edit: EditId) -> Option<&Change> {
        self.changes.iter().find(|c| c.write.edit == edit)
    }

    /// The lines: the main line, then each proposal in the order it started.
    pub fn lines(&self) -> Vec<Line> {
        let starts = self.changes.iter().filter(|c| c.write.proposal == Proposal::New).map(|c| Some(c.write.edit));
        std::iter::once(MAIN).chain(starts).collect()
    }

    /// The name of the proposal `b` started, if the device could open it.
    pub fn name(&self, b: EditId) -> Option<String> {
        let c = self.get(b).filter(|c| c.write.proposal == Proposal::New)?;
        String::from_utf8(c.body.clone()?).ok()
    }

    /// The history of `line`: its own writes and everything they build on, oldest first.
    pub fn history(&self, line: Line) -> Vec<&Change> {
        policy::history(self.changes.iter(), line)
    }

    /// What the next write on `line` builds on.
    pub fn heads(&self, line: Line) -> Vec<EditId> {
        policy::tips(&self.history(line))
    }

    /// The writes of `version` and everything they build on, oldest first: what that version holds.
    pub fn version(&self, version: &[EditId]) -> Vec<&Change> {
        let mut needed: HashSet<EditId> = version.iter().copied().collect();
        let mut out = vec![];
        for c in self.changes.iter().rev() {
            if needed.contains(&c.write.edit) {
                needed.extend(c.write.deps.iter().copied());
                out.push(c);
            }
        }
        out.reverse();
        out
    }

    /// The item the device shows on `line`, as `signer` edits it there: the updates of the line's history. `None` if
    /// it opens none of them.
    pub fn item(&self, line: Line, signer: SignerId) -> Option<Item> {
        build(&self.history(line), signer, line)
    }

    /// The item at `version`, made from scratch from the updates it holds, as `signer` would edit it on `line`: how a
    /// device opens any version read-only, and makes the change a promote carries.
    pub fn item_at(&self, version: &[EditId], signer: SignerId, line: Line) -> Item {
        build(&self.version(version), signer, line).unwrap_or_else(|| Item::new_on(signer, line))
    }

    /// The schemas the update of write `edit` was written under, imported on the version it builds on: none for a write
    /// the device can't open, a proposal's start, a merge, or a promote, a restore or an undo, which name none.
    pub fn written_under(&self, edit: EditId, signer: SignerId) -> BTreeSet<BlobId> {
        let Some(c) = self.get(edit) else { return BTreeSet::new() };
        let w = &c.write;
        let Some(update) = c.body.as_ref().filter(|u| w.proposal != Proposal::New && !u.is_empty()) else {
            return BTreeSet::new();
        };
        let mut item = self.item_at(&w.deps, signer, w.line());
        let since = item.version();
        match item.import_on(update, w.author, w.line()) {
            Ok(()) => item.authored_since(&since),
            Err(_) => BTreeSet::new(),
        }
    }

    /// The record `signer` shows on `line`: `{}` before any update.
    pub fn record(&self, line: Line, signer: SignerId) -> Value {
        self.item(line, signer).map_or_else(|| Value::Object(Map::new()), |i| i.record())
    }

    /// An edit on `line`: `change` edits the item `signer` shows there, and the write carries what changed.
    pub fn edit(&self, line: Line, signer: SignerId, change: impl FnOnce(&mut Item)) -> Draft {
        let mut item = self.item(line, signer).unwrap_or_else(|| Item::new_on(signer, line));
        let since = item.version();
        change(&mut item);
        Draft { proposal: on(line), deps: self.heads(line), body: item.export(&since) }
    }

    /// A new proposal named `name`, starting from `version`.
    pub fn propose(&self, version: &[EditId], name: &str) -> Draft {
        Draft { proposal: Proposal::New, deps: version.to_vec(), body: name.as_bytes().to_vec() }
    }

    /// A merge of `from` into `into`: a write on `into` that builds on the heads of both and carries no change, so the
    /// history of `into` is then the union of both (T10g).
    pub fn merge(&self, from: Line, into: Line) -> Draft {
        Draft { proposal: on(into), deps: self.both(from, into), body: vec![] }
    }

    /// A promote of `from` into `into`: the merge's write, carrying the change that brings the merged item to exactly
    /// the record `from` shows, so `into` then shows it too and keeps both histories (T10h).
    pub fn promote(&self, from: Line, into: Line, signer: SignerId) -> Draft {
        let deps = self.both(from, into);
        let mut item = self.item_at(&deps, signer, into);
        let since = item.version();
        item.put_record(&self.record(from, signer));
        Draft { proposal: on(into), deps, body: item.export(&since) }
    }

    /// Put the record of `version` back on `line`: a restore, or, to the version it built on, the revert of the
    /// line's latest edit.
    pub fn restore(&self, line: Line, version: &[EditId], signer: SignerId) -> Draft {
        let record = self.item_at(version, signer, line).record();
        self.put(line, signer, &record)
    }

    /// Undo the edit `edit` on `line`, keeping every change made since (`undo`). `None` if the history doesn't hold
    /// it. A merge carries no change, so undoing it changes nothing: restoring the version before it does.
    pub fn undo(&self, line: Line, edit: EditId, signer: SignerId) -> Option<Draft> {
        let c = self.get(edit)?;
        let after = self.item_at(&[edit], signer, line).record();
        let before = self.item_at(&c.write.deps, signer, line).record();
        Some(self.put(line, signer, &undo(&self.record(line, signer), &after, &before)))
    }

    /// A write on `line` that brings its record to exactly `record`.
    fn put(&self, line: Line, signer: SignerId, record: &Value) -> Draft {
        let mut item = self.item(line, signer).unwrap_or_else(|| Item::new_on(signer, line));
        let since = item.version();
        item.put_record(record);
        Draft { proposal: on(line), deps: self.heads(line), body: item.export(&since) }
    }

    /// The heads of `into`, then those of `from` it doesn't share.
    fn both(&self, from: Line, into: Line) -> Vec<EditId> {
        let mut deps = self.heads(into);
        for h in self.heads(from) {
            if !deps.contains(&h) {
                deps.push(h);
            }
        }
        deps
    }
}

/// An item, as `signer` edits it on `line`, holding the updates of `changes` it can open, each checked against the
/// Loro peer of its author on its own line. `None` if none imports.
fn build(changes: &[&Change], signer: SignerId, line: Line) -> Option<Item> {
    let mut item = Item::new_on(signer, line);
    let mut shown = false;
    for c in changes {
        let w = &c.write;
        match &c.body {
            // a proposal's name, and a merge, change nothing
            Some(update) if w.proposal != Proposal::New && !update.is_empty() => {
                shown |= item.import_on(update, w.author, w.line()).is_ok();
            }
            _ => {}
        }
    }
    shown.then_some(item)
}

/// The record `now` with the change from `before` to `after` taken back, and every change made since kept. Where `now`
/// is still `after`, `before` comes back; where the change changed nothing, `now` stays. Records go field by field,
/// and lists element by element, a record by its `id` and a value by itself: what the change added goes, what it
/// deleted comes back after what came before it, what it changed is undone inside, and the order it made goes back
/// unless the list changed since. A text or value that changed again since stays as it is now.
pub fn undo(now: &Value, after: &Value, before: &Value) -> Value {
    if now == after {
        return before.clone();
    }
    if after == before {
        return now.clone();
    }
    match (now, after, before) {
        (Value::Object(n), Value::Object(a), Value::Object(b)) => {
            let mut out = Map::new();
            let keys: Vec<&String> = {
                let mut seen = HashSet::new();
                n.keys().chain(a.keys()).chain(b.keys()).filter(|k| seen.insert(*k)).collect()
            };
            for k in keys {
                let field = |m: &Map<String, Value>| m.get(k).cloned().unwrap_or(Value::Null);
                let v = undo(&field(n), &field(a), &field(b));
                if !v.is_null() {
                    out.insert(k.clone(), v);
                }
            }
            Value::Object(out)
        }
        (Value::Array(n), Value::Array(a), Value::Array(b)) => Value::Array(undo_list(n, a, b)),
        _ => now.clone(),
    }
}

/// An element's key in a list: a record by its `id`, anything else by itself, and how many before it share that.
type Key = (Value, usize);

fn keys(list: &[Value]) -> Vec<Key> {
    let mut seen: HashMap<Value, usize> = HashMap::new();
    list.iter()
        .map(|e| {
            let id = match e.get("id") {
                Some(id) if e.is_object() => serde_json::json!({ "id": id }),
                _ => e.clone(),
            };
            let n = seen.entry(id.clone()).or_default();
            *n += 1;
            (id, *n - 1)
        })
        .collect()
}

fn undo_list(now: &[Value], after: &[Value], before: &[Value]) -> Vec<Value> {
    let (nk, ak, bk) = (keys(now), keys(after), keys(before));
    let a: HashMap<&Key, &Value> = ak.iter().zip(after).collect();
    let b: HashMap<&Key, &Value> = bk.iter().zip(before).collect();
    // what the change added goes; what it changed is undone where `now` still has it
    let mut out: Vec<(Key, Value)> = vec![];
    for (k, v) in nk.iter().zip(now) {
        match (a.get(k), b.get(k)) {
            (Some(_), None) => {}
            (Some(av), Some(bv)) => out.push((k.clone(), undo(v, av, bv))),
            _ => out.push((k.clone(), v.clone())),
        }
    }
    // what it deleted comes back, after the nearest element before it that is still there
    for (i, k) in bk.iter().enumerate() {
        if a.contains_key(k) || out.iter().any(|(x, _)| x == k) {
            continue;
        }
        let at = bk[..i].iter().rev().find_map(|p| out.iter().position(|(x, _)| x == p)).map_or(0, |p| p + 1);
        out.insert(at, (k.clone(), before[i].clone()));
    }
    // the order it made goes back, if the list hasn't changed since
    if nk == ak {
        let place: HashMap<&Key, usize> = bk.iter().enumerate().map(|(i, k)| (k, i)).collect();
        out.sort_by_key(|(k, _)| place.get(k).copied().unwrap_or(usize::MAX));
    }
    out.into_iter().map(|(_, v)| v).collect()
}

/// One entry's history kept locally, with no keys, caps or signatures: what proposals do to an item, for the tests and
/// the property checks of T10. Writes are numbered from 1; the first holds the item the repo starts from.
#[derive(Clone)]
pub struct Repo {
    history: History,
}

impl Repo {
    /// An entry whose first write, on the main line, holds `item`'s updates; `author` made it.
    pub fn new(item: &Item, author: SignerId) -> Repo {
        let mut repo = Repo { history: History::default() };
        let body = item.export(&Default::default());
        repo.make(author, Draft { proposal: Proposal::Main, deps: vec![], body }).expect("the first write");
        repo
    }

    pub fn history(&self) -> &History {
        &self.history
    }

    /// The item shown on `line`, as `signer` edits it there.
    pub fn item(&self, line: Line, signer: SignerId) -> Option<Item> {
        self.history.item(line, signer)
    }

    /// The writes on `line` and what they build on, oldest first.
    pub fn log(&self, line: Line) -> Vec<EditId> {
        self.history.history(line).iter().map(|c| c.write.edit).collect()
    }

    pub fn heads(&self, line: Line) -> Vec<EditId> {
        self.history.heads(line)
    }

    /// `author` edits the item on `line`.
    pub fn edit(&mut self, author: SignerId, line: Line, change: impl FnOnce(&mut Item)) -> EditId {
        let d = self.history.edit(line, author, change);
        self.make(author, d).expect("an edit on a line the repo holds")
    }

    /// `author` starts a proposal named `name` from `version`; its id names it.
    pub fn propose(&mut self, author: SignerId, version: &[EditId], name: &str) -> Result<EditId, Refusal> {
        let d = self.history.propose(version, name);
        self.make(author, d)
    }

    pub fn merge(&mut self, author: SignerId, from: Line, into: Line) -> EditId {
        let d = self.history.merge(from, into);
        self.make(author, d).expect("a merge of lines the repo holds")
    }

    pub fn promote(&mut self, author: SignerId, from: Line, into: Line) -> EditId {
        let d = self.history.promote(from, into, author);
        self.make(author, d).expect("a promote of lines the repo holds")
    }

    pub fn restore(&mut self, author: SignerId, line: Line, version: &[EditId]) -> EditId {
        let d = self.history.restore(line, version, author);
        self.make(author, d).expect("a restore on a line the repo holds")
    }

    pub fn undo(&mut self, author: SignerId, line: Line, edit: EditId) -> Option<EditId> {
        let d = self.history.undo(line, edit, author)?;
        Some(self.make(author, d).expect("an undo on a line the repo holds"))
    }

    /// Accept `d` as the next write, by `author`.
    pub fn make(&mut self, author: SignerId, d: Draft) -> Result<EditId, Refusal> {
        let edit = EditId::from_u64(self.history.changes.len() as u64 + 1);
        let (entry, actor) = (EntryId::from_u64(0), VaultId::from_u64(0));
        let (stay, generation, cell, first) = (None, 0, CellId::of(actor, &[]), self.history.changes.is_empty());
        let (deps, proposal, via) = (d.deps, d.proposal, vec![]);
        let write = Write { edit, author, actor, entry, stay, generation, deps, proposal, via, first, cell };
        self.history.push(Change { write, body: Some(d.body) })?;
        Ok(edit)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn undo_takes_back_one_change_and_keeps_the_rest() {
        let blocks = json!([{"id": 1, "text": "one"}, {"id": 2, "text": "two"}]);
        let before = json!({"title": "Welcome", "tags": ["a"], "blocks": blocks});
        // the change: a new title, a tag, block 2 deleted, block 3 added, block 1's text changed
        let blocks = json!([{"id": 1, "text": "uno"}, {"id": 3, "text": "three"}]);
        let after = json!({"title": "Hello", "tags": ["a", "b"], "blocks": blocks});
        assert_eq!(undo(&after, &after, &before), before);
        // since: a tag, block 4 at the start, and block 3's text
        let now = json!({"title": "Hello", "tags": ["a", "b", "c"],
            "blocks": [{"id": 4, "text": "four"}, {"id": 1, "text": "uno"}, {"id": 3, "text": "THREE"}]});
        let undone = json!({"title": "Welcome", "tags": ["a", "c"],
            "blocks": [{"id": 4, "text": "four"}, {"id": 1, "text": "one"}, {"id": 2, "text": "two"}]});
        assert_eq!(undo(&now, &after, &before), undone);
        // a field the change set and that changed again since stays
        let now = json!({"title": "Hi there", "tags": ["a", "b"], "blocks": []});
        assert_eq!(undo(&now, &after, &before)["title"], "Hi there");
        // nothing changed: nothing to undo
        assert_eq!(undo(&now, &before, &before), now);
    }

    #[test]
    fn undo_puts_back_an_order_unless_the_list_changed_since() {
        let before = json!([{"id": 1}, {"id": 2}, {"id": 3}]);
        let after = json!([{"id": 3}, {"id": 1}, {"id": 2}]);
        let now = json!([{"id": 3, "x": 1}, {"id": 1}, {"id": 2}]);
        assert_eq!(undo(&now, &after, &before), json!([{"id": 1}, {"id": 2}, {"id": 3, "x": 1}]));
        let now = json!([{"id": 3}, {"id": 1}, {"id": 2}, {"id": 4}]);
        assert_eq!(undo(&now, &after, &before), now);
    }

    #[test]
    fn a_write_on_a_proposal_builds_on_it() {
        let item = Item::document("Welcome", SignerId::from_u64(2));
        let mut repo = Repo::new(&item, SignerId::from_u64(2));
        let first = repo.heads(MAIN);
        assert_eq!(first, [EditId::from_u64(1)]);
        let draft = repo.propose(SignerId::from_u64(2), &first, "draft").unwrap();
        // not on main's head alone, not on a write that started no proposal, not on one it doesn't hold
        let bad = |deps: Vec<EditId>, b: EditId| Draft { proposal: Proposal::On(b), deps, body: vec![] };
        assert_eq!(repo.make(SignerId::from_u64(2), bad(first.clone(), draft)), Err(Refusal::NotOnProposal));
        assert_eq!(repo.make(SignerId::from_u64(2), bad(first.clone(), first[0])), Err(Refusal::NotOnProposal));
        assert_eq!(repo.make(SignerId::from_u64(2), bad(vec![EditId::from_u64(9)], draft)), Err(Refusal::UnknownDep));
        assert!(repo.make(SignerId::from_u64(2), bad(vec![draft], draft)).is_ok());
        assert_eq!(repo.history().name(draft).as_deref(), Some("draft"));
        assert_eq!(repo.history().lines(), [MAIN, Some(draft)]);
    }
}
