//! What the page's DB & Schema tab and its note viewer show, as the page reads them (JSON): a vault's database as a
//! device holds it (`database`), and one note's history, its lines and every write of it (`note`). Both read the
//! device's Lab and nothing else: what the device can't open shows as sealed, as the server sees all of it.

use std::collections::BTreeSet;

use avendb::branch::{Commit, History};
use avendb::doc::Item;
use avendb::id::{EntryId, GrantId, OpId, SignerId, SpaceId, VaultId};
use avendb::keys::KeyScope;
use avendb::lab::Lab;
use avendb::lens::{self, DocV2, Lens, Schema};
use avendb::policy::{Action, Branch, Line, Scope};
use serde_json::{Map, Value, json};

use crate::{Firsts, firsts, hex, is_card, is_profile, role_name, roles};

/// The most writes of one note whose text the viewer shows, the latest: each version is made from scratch from the
/// updates it holds.
const SHOWN: usize = 200;

/// Vault `vault`'s database as device `me` holds it, for the page's DB & Schema tab: how many ops and McEliece keys
/// the device holds in all; the schemas and lenses the app ships (`lens::blobs`); and each space the vault founded, in
/// the order founded, with its key's epoch, the ops the device holds on it by kind, the schemas and lenses its lane
/// publishes, and every entry, cards and profiles too (`row`).
pub fn database(lab: &Lab, me: SignerId, vault: VaultId) -> Value {
    let st = lab.state(me);
    let first = firsts(st);
    let (ops, keys) = lab.size(me);
    let founded = st.spaces().iter().filter(|s| s.founder == vault);
    let spaces: Vec<Value> = founded
        .map(|s| {
            let lane = lab.lane(me, s.id);
            json!({
                "id": hex(&s.id.0),
                "public": st.is_public(Scope::Space(s.id)),
                "epoch": st.epoch(KeyScope::Space(s.id)),
                "ops": counts(lab, me, s.id),
                "schemas": lane.schemas().map(schema).collect::<Vec<_>>(),
                "lenses": lane.lenses().map(lens).collect::<Vec<_>>(),
                "rows": s.entries.iter().map(|&e| row(lab, me, s.id, e, &first)).collect::<Vec<_>>(),
            })
        })
        .collect();
    let schemas = [&*lens::DOCUMENT_V1, &*lens::DOCUMENT_V2, &*lens::TODO_V1, &*lens::TODO_V2].map(schema);
    json!({
        "vault": hex(&vault.0),
        "held": { "ops": ops, "keys": keys },
        "builtIn": { "schemas": schemas, "lenses": [lens(&lens::DOCUMENT_LENS), lens(&lens::TODO_LENS)] },
        "spaces": spaces,
    })
}

/// Entry `entry` of space `space` as the DB & Schema tab shows it: its record as the device opens it on the main line
/// (`null` if it opens none of it), its `kind` as the record names it (`"sealed"` then), whether it is a device's card
/// or a vault's profile, the schemas its writes were made under, how many writes of it the device counts and holds,
/// its lines and its branches' names, its key's epoch, the size of its Loro document, the device and the vault of its
/// first write, and who may read it.
fn row(lab: &Lab, me: SignerId, space: SpaceId, entry: EntryId, first: &Firsts) -> Value {
    let (st, sc) = (lab.state(me), Scope::Entry(space, entry));
    let item = lab.item(me, space, entry);
    let record = item.map(Item::record);
    let field = |name: &str| record.as_ref().and_then(|r| r.get(name)).cloned();
    let kind = field("kind").and_then(|k| k.as_str().map(str::to_string));
    let kind = kind.unwrap_or_else(|| if item.is_some() { "record" } else { "sealed" }.into());
    let doc = item.and_then(Item::as_document);
    let tag = doc.as_ref().and_then(|d| {
        if is_card(d) {
            Some("card")
        } else if is_profile(d) {
            Some("profile")
        } else {
            None
        }
    });
    let history = lab.history(me, space, entry);
    let lines = history.map(History::lines).unwrap_or_default();
    let name = |b: OpId| history.and_then(|h| h.name(b)).map_or(Value::Null, Value::from);
    let branches: Vec<Value> = lines.iter().flatten().map(|&b| name(b)).collect();
    let (author, actor) = first.get(&(space, entry)).map_or((None, None), |(a, v)| (Some(hex(&a.0)), Some(hex(&v.0))));
    let authored: Vec<String> = item.map(|i| i.authored().iter().map(|b| b.to_hex()).collect()).unwrap_or_default();
    let roles: Map<String, Value> = roles(st, sc).iter().map(|(v, r)| (hex(&v.0), role_name(*r).into())).collect();
    json!({
        "entry": hex(&entry.0),
        "kind": kind,
        "tag": tag,
        "title": field("title"),
        "record": record,
        "authored": authored,
        "writes": history.map_or(0, |h| h.commits().len()),
        "held": lab.fetched(me, space, entry),
        "lines": lines.len(),
        "branches": branches,
        "epoch": st.epoch(KeyScope::Entry(space, entry)),
        "bytes": item.map_or(0, |i| i.bytes().len()),
        "author": author,
        "actor": actor,
        "public": st.is_public(sc),
        "roles": roles,
    })
}

/// The ops device `me` holds on space `space`, by kind: its founding, the writes and checkpoints of its entries, the
/// keys ops of its keys and its entries', the grants on it or on its entries and the revocations of those, and what was
/// published into its lane.
fn counts(lab: &Lab, me: SignerId, space: SpaceId) -> Value {
    let log = lab.log(me);
    let ops = || log.ops().iter().zip(log.ids());
    let on = |id: &OpId| GrantId::from(*id);
    let grants: BTreeSet<GrantId> = ops()
        .filter(|(op, _)| matches!(&op.action, Action::Grant(g, _) if g.scope.space() == space))
        .map(|(_, id)| on(id))
        .collect();
    let (mut founded, mut writes, mut checkpoints, mut keys, mut revokes, mut published) = (0, 0, 0, 0, 0, 0);
    for (op, id) in ops() {
        match &op.action {
            Action::FoundSpace { .. } if SpaceId::from(*id) == space => founded += 1,
            Action::Write { space: s, .. } if *s == space => writes += 1,
            Action::Checkpoint { space: s, .. } if *s == space => checkpoints += 1,
            Action::Keys { key: KeyScope::Space(s) | KeyScope::Entry(s, _), .. } if *s == space => keys += 1,
            Action::Revoke { grant, .. } if grants.contains(grant) => revokes += 1,
            Action::Publish { space: s, .. } if *s == space => published += 1,
            _ => {}
        }
    }
    json!({
        "founded": founded,
        "writes": writes,
        "checkpoints": checkpoints,
        "keys": keys,
        "grants": grants.len(),
        "revokes": revokes,
        "published": published,
    })
}

/// A schema as the tab shows it: its id, its title and its JSON, as published.
fn schema(s: &Schema) -> Value {
    json!({ "id": s.id().to_hex(), "title": s.title(), "json": String::from_utf8_lossy(s.bytes()) })
}

/// A lens as the tab shows it: its id, its title, the schemas it joins, and its JSON, as published.
fn lens(l: &Lens) -> Value {
    let (from, to) = (l.from().to_hex(), l.to().to_hex());
    json!({ "id": l.id().to_hex(), "title": l.title(), "from": from, "to": to, "json": String::from_utf8_lossy(l.bytes()) })
}

/// Note `entry` of space `space` as device `me` holds it, for the page's note viewer: its lines, the main line first,
/// then each branch in the order it started, each with its name (`named`), the version it started from, its heads, its
/// history (its own writes and every write they build on, oldest first), and the note it shows there; and every write
/// of it the device counts, in the order the device took them (`commit`). `None` if it counts none.
pub fn note(lab: &Lab, me: SignerId, space: SpaceId, entry: EntryId) -> Option<Value> {
    let h = lab.history(me, space, entry)?;
    let line = |line| {
        let doc = lab.item_on(me, space, entry, line).and_then(Item::as_document);
        let start = line.and_then(|b| h.get(b));
        json!({
            "line": line.map(|b: OpId| hex(&b.0)),
            "name": named(h, line),
            "from": start.map(|c| ids(&c.write.deps)),
            "heads": ids(&h.heads(line)),
            "history": h.history(line).iter().map(|c| hex(&c.write.op.0)).collect::<Vec<_>>(),
            "title": doc.as_ref().map(|d| d.title.clone()),
            "text": doc.as_ref().map(body),
            "blocks": doc.as_ref().map(|d| d.blocks.iter().map(|b| b.to_value()).collect::<Vec<_>>()),
        })
    };
    let lines: Vec<Value> = h.lines().into_iter().map(line).collect();
    let shown = h.commits().len().saturating_sub(SHOWN);
    let commits: Vec<Value> = h.commits().iter().enumerate().map(|(i, c)| commit(h, me, c, i >= shown)).collect();
    Some(json!({ "space": hex(&space.0), "entry": hex(&entry.0), "lines": lines, "commits": commits }))
}

/// One write of a note as the viewer shows it: its op, its device and the vault it acted for, the line it extends,
/// what it builds on, and what it is: an `edit`, the start of a `branch` (with its name), a `merge` of two lines, which
/// carries no change, a `promote`, a merge that brings its line to the other's record, or `sealed`, a write the device
/// can't open; for a branch, the line it started from, and for a merge or a promote, the line it brought in (`from`).
/// With `shown`, the note's title and text at its version, and the text at the one it changed: what it built on, or
/// for a merge or a promote, its own line's version before it, so the viewer's diff shows what it brought.
fn commit(h: &History, me: SignerId, c: &Commit, shown: bool) -> Value {
    let w = &c.write;
    let line = w.line();
    let on = |d: &OpId| h.get(*d).map(|x| x.write.line());
    let other = w.deps.iter().filter_map(on).find(|l| *l != line);
    let kind = match &c.body {
        _ if w.branch == Branch::New => "branch",
        None => "sealed",
        Some(change) if change.is_empty() => "merge",
        Some(_) if other.is_some() => "promote",
        Some(_) => "edit",
    };
    let own: Vec<OpId> = w.deps.iter().copied().filter(|d| on(d) == Some(line)).collect();
    let base = if kind == "edit" || own.is_empty() { &w.deps } else { &own };
    let at = |version: &[OpId]| h.item_at(version, me, line).as_document();
    let (after, before) =
        if shown && matches!(kind, "edit" | "merge" | "promote") { (at(&[w.op]), at(base)) } else { (None, None) };
    json!({
        "op": hex(&w.op.0),
        "author": hex(&w.author.0),
        "actor": hex(&w.actor.0),
        "line": line.map(|b| hex(&b.0)),
        "deps": ids(&w.deps),
        "kind": kind,
        "name": if kind == "branch" { h.name(w.op) } else { None },
        "from": other.map(|l| json!({ "line": l.map(|b| hex(&b.0)), "name": named(h, l) })),
        "title": after.as_ref().map(|d| d.title.clone()),
        "text": after.as_ref().map(body),
        "before": before.as_ref().map(body),
    })
}

/// A line of a note by name: `main`, or its branch's, `None` for a branch whose name the device can't open.
fn named(h: &History, line: Line) -> Option<String> {
    match line {
        None => Some("main".into()),
        Some(b) => h.name(b),
    }
}

/// A note's text: its first paragraph, block 2, as `cast::document` writes it.
fn body(doc: &DocV2) -> String {
    doc.blocks.iter().find(|b| b.id == 2).map(|b| b.text.clone()).unwrap_or_default()
}

fn ids(ops: &[OpId]) -> Vec<String> {
    ops.iter().map(|op| hex(&op.0)).collect()
}
