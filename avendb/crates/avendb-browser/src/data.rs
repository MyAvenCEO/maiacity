//! What the page's database studio and its note page show, as the page reads them (JSON): a vault's database as a
//! device holds it (`database`), every signed edit the device holds, the database's history (`history`), and one note
//! as it is on its main line and on each proposal, with every edit of it (`note`). Each reads the device's Lab and
//! nothing else: what the device can't open shows as sealed, as the server sees all of it.
//!
//! The page's words are the core's own: an edit (`Edit`); a proposal (`Proposal`), a line of a note's history that its
//! main line may take in; a variant (`Lab::variant`), a new note made from a line of another; a cap, what a vault
//! shares of its entries; and a cell, the entries of a vault the same caps reach, under one key.

use std::collections::{HashMap, HashSet};

use avendb::doc::Item;
use avendb::engine::{SHOWN, Wrote, line_name, wrote};
use avendb::history::{Change, History};
use avendb::id::{BlobId, CapId, CellId, EditId, EntryId, SignerId, VaultId};
use avendb::keys::{KeyFam, KeyName, Recipient};
use avendb::lab::Lab;
use avendb::lens::{self, DocV2, Lens, Schema};
use avendb::policy::{Action, Entry, Grantee, Principal, Proposal, State};
use avendb::sign::{Classical, Signature, SignerKeys};
use avendb::wire::Wire as _;
use serde_json::{Map, Value, json};

use crate::{grantee_name, hex, kind_name, role_name, roles};

/// Vault `vault`'s database as device `me` holds it, for the page's database studio: how many edits and McEliece keys
/// the device holds in all; the schemas and lenses the app ships (`lens::blobs`); its seed's generation; the edits the
/// device holds on it by kind; the schemas and lenses its lane publishes; each cell its entries are in, the first
/// first, with the caps that reach it beside the vault's caps on the whole of it, its key's generation and how many
/// entries it holds; and every entry, cards and profiles too, in the order they were created (`row`).
pub fn database(lab: &Lab, me: SignerId, vault: VaultId) -> Value {
    let st = lab.state(me);
    let (edits, keys) = lab.size(me);
    let lane = lab.lane(me, vault);
    let entries: Vec<&Entry> = st.entries().iter().filter(|en| en.vault == vault).collect();
    let mut cells: Vec<CellId> = vec![];
    for en in &entries {
        if !cells.contains(&en.cell()) {
            cells.push(en.cell());
        }
    }
    let cell = |x: &CellId| {
        json!({
            "id": hex(&x.0),
            "caps": caps(st.cell_caps(*x).unwrap_or_default()),
            "generation": st.epoch(KeyFam::Cell(vault, *x)),
            "entries": entries.iter().filter(|en| en.cell() == *x).count(),
        })
    };
    let schemas = [&*lens::DOCUMENT_V1, &*lens::DOCUMENT_V2, &*lens::TODO_V1, &*lens::TODO_V2].map(schema);
    json!({
        "vault": hex(&vault.0),
        "held": { "edits": edits, "keys": keys },
        "builtIn": { "schemas": schemas, "lenses": [lens(&lens::DOCUMENT_LENS), lens(&lens::TODO_LENS)] },
        "seed": st.epoch(KeyFam::Seed(vault)),
        "edits": counts(lab, me, vault),
        "schemas": lane.schemas().map(schema).collect::<Vec<_>>(),
        "lenses": lane.lenses().map(lens).collect::<Vec<_>>(),
        "cells": cells.iter().map(cell).collect::<Vec<_>>(),
        "rows": entries.iter().map(|en| row(lab, me, en)).collect::<Vec<_>>(),
    })
}

/// Entry `en` as the studio's table editor shows it: its type and its tags now, if the device reads them; its record
/// as the device opens it on the main line (`null` if it opens none of it), and its `kind` as the record names it
/// (`"sealed"` then); the schemas its edits were made under; how many edits of it the device counts and holds; its
/// lines (the main line and each proposal) and its proposals' names; its cell and its key's generation there; the size
/// of its Loro document; the device and the vault of its first edit; and who may read it.
fn row(lab: &Lab, me: SignerId, en: &Entry) -> Value {
    let (st, entry) = (lab.state(me), en.id);
    let item = lab.item(me, entry);
    let record = item.map(Item::record);
    let field = |name: &str| record.as_ref().and_then(|r| r.get(name)).cloned();
    let kind = field("kind").and_then(|k| k.as_str().map(str::to_string));
    let kind = kind.unwrap_or_else(|| if item.is_some() { "record" } else { "sealed" }.into());
    let meaning = lab.meaning(me, entry);
    let history = lab.history(me, entry);
    let lines = history.map(History::lines).unwrap_or_default();
    let name = |b: EditId| history.and_then(|h| h.name(b)).map_or(Value::Null, Value::from);
    let proposals: Vec<Value> = lines.iter().flatten().map(|&b| name(b)).collect();
    let author = st.write(en.creation).map(|w| hex(&w.author.0));
    let authored: Vec<String> = item.map(|i| i.authored().iter().map(|b| b.to_hex()).collect()).unwrap_or_default();
    let (v, x) = (en.vault, en.cell());
    let roles: Map<String, Value> = roles(st, v, x).iter().map(|(v, r)| (hex(&v.0), role_name(*r).into())).collect();
    json!({
        "entry": hex(&entry.0),
        "type": meaning.as_ref().map(|m| m.attrs.ty.as_str().to_string()),
        "tags": meaning.as_ref().map(|m| m.attrs.tags.iter().map(|t| t.as_str().to_string()).collect::<Vec<_>>()),
        "kind": kind,
        "title": field("title"),
        "record": record,
        "authored": authored,
        "edits": history.map_or(0, |h| h.changes().len()),
        "held": lab.fetched(me, entry),
        "lines": lines.len(),
        "proposals": proposals,
        "cell": hex(&x.0),
        "generation": st.epoch(KeyFam::Cell(v, x)),
        "bytes": item.map_or(0, |i| i.bytes().len()),
        "author": author,
        "actor": hex(&en.creator.0),
        "public": st.public_key(KeyFam::Cell(v, x)),
        "roles": roles,
    })
}

/// The edits device `me` holds on vault `vault`, by kind: its founding, the writes, moves and checkpoints of its
/// entries, the keys edits of its keys and its entries', the caps over it and the revocations of those, and what was
/// published into its lane.
fn counts(lab: &Lab, me: SignerId, vault: VaultId) -> Value {
    let (log, st) = (lab.log(me), lab.state(me));
    let edits = || log.edits().iter().zip(log.ids());
    let of = |e: &EntryId| st.entry(*e).map(|en| en.vault) == Some(vault);
    let caps: HashSet<CapId> = edits()
        .filter(|(edit, _)| matches!(&edit.action, Action::Cap(c, _) if c.over == vault))
        .map(|(_, id)| CapId::from(*id))
        .collect();
    let (mut founded, mut writes, mut moves, mut checkpoints, mut keys, mut revokes, mut published) =
        (0, 0, 0, 0, 0, 0, 0);
    for (edit, id) in edits() {
        match &edit.action {
            Action::Genesis { .. } if VaultId::from(*id) == vault => founded += 1,
            Action::Write { vault: v, .. } if *v == vault => writes += 1,
            Action::Move { vault: v, .. } if *v == vault => moves += 1,
            Action::Checkpoint { entry, .. } if of(entry) => checkpoints += 1,
            Action::Keys { name: KeyName::Scoped(k, _), .. } if k.vault() == vault => keys += 1,
            Action::Keys { name: KeyName::Entry(e, ..), .. } if of(e) => keys += 1,
            Action::Revoke { cap, .. } if caps.contains(cap) => revokes += 1,
            Action::Publish { vault: v, .. } if *v == vault => published += 1,
            _ => {}
        }
    }
    json!({
        "founded": founded,
        "writes": writes,
        "moves": moves,
        "checkpoints": checkpoints,
        "keys": keys,
        "caps": caps.len(),
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

/// The database's history: every signed edit device `me` holds, in the order it took them, for the studio's History
/// view: each one's place in that order, its id, what it does (`action`: its kind and fields, ids in hex, what is
/// sealed by its size alone), its author and cosigners, each signature by its signer and its halves (`signature`), the
/// edits of its log it builds on and its causal depth, its size on the wire, and the vaults it concerns (`concerns`);
/// for a write, whether the device counts it, as once it no longer trusts the curves it counts only the writes a
/// checkpoint covers, and whether its entry's readers do, as the rules of the caps it relies on allow it and what it
/// builds on (`allowed`, `Change::counted`).
pub fn history(lab: &Lab, me: SignerId) -> Value {
    let (held, st) = (lab.log(me), lab.state(me));
    let counted: HashSet<EditId> = st.all_writes().iter().map(|w| w.edit).collect();
    let caps: HashMap<CapId, VaultId> = held
        .edits()
        .iter()
        .zip(held.ids())
        .filter_map(|(edit, id)| match &edit.action {
            Action::Cap(c, _) => Some((CapId::from(*id), c.over)),
            _ => None,
        })
        .collect();
    let edits: Vec<Value> = held
        .edits()
        .iter()
        .zip(held.ids())
        .enumerate()
        .map(|(n, (edit, &id))| {
            let signed = lab.signed_edit(me, id);
            let (kind, fields) = action(id, &edit.action);
            json!({
                "n": n + 1,
                "id": hex(&id.0),
                "kind": kind,
                "fields": fields,
                "author": hex(&edit.author.0),
                "cosigners": edit.cosigners.iter().map(|s| hex(&s.0)).collect::<Vec<_>>(),
                "sigs": signed.map(|s| s.sigs.iter().map(signature).collect::<Vec<_>>()).unwrap_or_default(),
                "parents": ids(&edit.parents),
                "depth": edit.depth,
                "bytes": signed.map_or(0, |s| s.to_wire().len()),
                "vaults": concerns(st, id, &edit.action, &caps).iter().map(|v| hex(&v.0)).collect::<Vec<_>>(),
                "counted": matches!(edit.action, Action::Write { .. }).then(|| counted.contains(&id)),
                "allowed": match &edit.action {
                    Action::Write { entry, .. } => lab.history(me, *entry).and_then(|h| h.get(id)).map(|c| c.counted),
                    _ => None,
                },
            })
        })
        .collect();
    json!({ "edits": edits })
}

/// What edit `id` does, as the History view shows it: its kind, and its fields, ids in hex. What is sealed, a write's
/// body, a cap's slice, keys' boxes, shows by its size or its recipient alone, and a public key by whether there is
/// one. A write's `line` is the proposal it extends (`null` on the main line), and `starts` whether it starts one; a
/// write that creates its entry names the cell it goes in (`create`), and its `stay` the move that put the entry where
/// it is now (`null` for where it was created).
fn action(id: EditId, a: &Action) -> (&'static str, Value) {
    let vias = |via: &[VaultId]| via.iter().map(|v| hex(&v.0)).collect::<Vec<_>>();
    match a {
        Action::Genesis { kind, owners, threshold, root, seal_to, .. } => (
            "genesis",
            json!({
                "vaultKind": kind_name(*kind),
                "owners": owners.iter().map(principal).collect::<Vec<_>>(),
                "threshold": threshold,
                "root": root.map(|r| hex(&r.0)),
                "sealTo": seal_to.len(),
            }),
        ),
        Action::AddOwner { vault, owner, seal_to } => (
            "addOwner",
            json!({ "vault": hex(&vault.0), "owner": principal(owner), "sealTo": seal_to.is_some() }),
        ),
        Action::RemoveOwner { vault, owner, keep } => {
            ("removeOwner", json!({ "vault": hex(&vault.0), "owner": principal(owner), "keep": keep.len() }))
        }
        Action::SetThreshold { vault, threshold } => {
            ("setThreshold", json!({ "vault": hex(&vault.0), "threshold": threshold }))
        }
        Action::AddDevice { vault, device, seal_to } => (
            "addDevice",
            json!({ "vault": hex(&vault.0), "device": hex(&device.0), "sealTo": seal_to.is_some() }),
        ),
        Action::RemoveDevice { vault, device, keep } => {
            ("removeDevice", json!({ "vault": hex(&vault.0), "device": hex(&device.0), "keep": keep.len() }))
        }
        Action::SetRoot { vault, root, keep } => {
            ("setRoot", json!({ "vault": hex(&vault.0), "root": root.map(|r| hex(&r.0)), "keep": keep.len() }))
        }
        Action::Cap(c, via) => (
            "cap",
            json!({
                "over": hex(&c.over.0),
                "role": role_name(c.role),
                "grantee": grantee_name(c.grantee),
                "wide": c.wide,
                "issuer": hex(&c.issuer.0),
                "parent": c.parent.map(|p| hex(&p.0)),
                "via": vias(via),
                "sealed": c.select.len(),
            }),
        ),
        Action::Revoke { cap, actor, keep, via } => (
            "revoke",
            json!({ "cap": hex(&cap.0), "actor": hex(&actor.0), "keep": keep.len(), "via": vias(via) }),
        ),
        Action::Write { vault, entry, actor, stay, generation, deps, proposal, via, create, body } => {
            let line = match proposal {
                Proposal::Main => None,
                Proposal::New => Some(id),
                Proposal::On(b) => Some(*b),
            };
            (
                "write",
                json!({
                    "vault": hex(&vault.0),
                    "entry": hex(&entry.0),
                    "actor": hex(&actor.0),
                    "stay": stay.map(|s| hex(&s.0)),
                    "generation": generation,
                    "deps": ids(deps),
                    "line": line.map(|b| hex(&b.0)),
                    "starts": *proposal == Proposal::New,
                    "via": vias(via),
                    "create": create.as_deref().map(caps),
                    "sealed": body.len(),
                }),
            )
        }
        Action::Move { vault, entry, to, keep, via } => (
            "move",
            json!({
                "vault": hex(&vault.0),
                "entry": hex(&entry.0),
                "to": caps(to),
                "keep": keep.len(),
                "via": vias(via),
            }),
        ),
        Action::Keys { name, id: key_id, public, boxes, clear } => (
            "keys",
            json!({
                "key": key_name(*name),
                "id": hex(&key_id.0),
                "public": public.is_some(),
                "boxes": boxes.iter().map(|b| recipient(&b.to)).collect::<Vec<_>>(),
                "clear": clear.is_some(),
            }),
        ),
        Action::Publish { vault, actor, via, blob } => {
            let title = Schema::parse(blob)
                .map(|s| s.title().to_string())
                .or_else(|| Lens::parse(blob).map(|l| l.title().to_string()));
            (
                "publish",
                json!({
                    "vault": hex(&vault.0),
                    "actor": hex(&actor.0),
                    "via": vias(via),
                    "blob": BlobId::of(blob).to_hex(),
                    "title": title,
                    "bytes": blob.len(),
                }),
            )
        }
        Action::Checkpoint { entry, covers } => {
            ("checkpoint", json!({ "entry": hex(&entry.0), "covers": ids(covers) }))
        }
    }
}

/// A signature as the History view shows it: its signer, whether that is a device or a passkey, its classical half (a
/// device's ed25519, a passkey's assertion, or one assertion over a batch of edits, with how many), and the size of its
/// SLH-DSA half, if it carries one.
fn signature(sig: &Signature) -> Value {
    let by = match sig.keys {
        SignerKeys::Device { .. } => "device",
        SignerKeys::Passkey { .. } => "passkey",
    };
    let (classical, batch) = match &sig.classical {
        Classical::Ed25519(_) => ("ed25519", None),
        Classical::Passkey(_) => ("p256", None),
        Classical::Batch { edits, .. } => ("p256", Some(edits.len())),
        Classical::Pass { .. } => ("p256", None),
    };
    json!({ "signer": hex(&sig.keys.id().0), "by": by, "classical": classical, "batch": batch, "pq": sig.pq.as_ref().map(Vec::len) })
}

/// The vaults edit `id` concerns, by device `st`'s view: the vault it founds or changes, the vault it acts for and the
/// owners it acts through, the vault a cap is over and its grantee, the vault of the entry it touches or of the key
/// it boxes.
fn concerns(st: &State, id: EditId, a: &Action, caps: &HashMap<CapId, VaultId>) -> Vec<VaultId> {
    let of = |e: &EntryId| st.entry(*e).map(|en| en.vault);
    let mut vaults: Vec<VaultId> = match a {
        Action::Genesis { owners, .. } => {
            let owners = owners.iter().filter_map(|o| if let Principal::Vault(v) = o { Some(*v) } else { None });
            [VaultId::from(id)].into_iter().chain(owners).collect()
        }
        Action::AddOwner { vault, owner, .. } | Action::RemoveOwner { vault, owner, .. } => match owner {
            Principal::Vault(o) => vec![*vault, *o],
            Principal::Signer(_) => vec![*vault],
        },
        Action::SetThreshold { vault, .. }
        | Action::AddDevice { vault, .. }
        | Action::RemoveDevice { vault, .. }
        | Action::SetRoot { vault, .. }
        | Action::Move { vault, .. } => vec![*vault],
        Action::Cap(c, _) => {
            let to = match c.grantee {
                Grantee::Principal(Principal::Vault(v)) => Some(v),
                _ => None,
            };
            [Some(c.issuer), Some(c.over), to].into_iter().flatten().collect()
        }
        Action::Revoke { cap, actor, .. } => [Some(*actor), caps.get(cap).copied()].into_iter().flatten().collect(),
        Action::Write { vault, actor, .. } | Action::Publish { vault, actor, .. } => vec![*actor, *vault],
        Action::Keys { name, .. } => match *name {
            KeyName::Signer(_) => vec![],
            KeyName::Scoped(k, _) => vec![k.vault()],
            KeyName::Entry(e, ..) => of(&e).into_iter().collect(),
        },
        Action::Checkpoint { entry, .. } => of(entry).into_iter().collect(),
    };
    vaults.extend(a.via().unwrap_or_default());
    let mut seen = HashSet::new();
    vaults.retain(|v| seen.insert(*v));
    vaults
}

fn principal(p: &Principal) -> Value {
    match p {
        Principal::Vault(v) => json!({ "vault": hex(&v.0) }),
        Principal::Signer(s) => json!({ "signer": hex(&s.0) }),
    }
}

fn caps(xs: &[CapId]) -> Vec<String> {
    xs.iter().map(|c| hex(&c.0)).collect()
}

/// A key of the schedule as the History view names it: a signer's own key, one generation of a vault's seed, of a
/// cap's key or of a cell's key, or the key of an entry in one of its stays at one generation of that stay's cell.
fn key_name(k: KeyName) -> Value {
    match k {
        KeyName::Signer(s) => json!({ "signer": hex(&s.0) }),
        KeyName::Scoped(KeyFam::Seed(v), g) => json!({ "seed": hex(&v.0), "generation": g }),
        KeyName::Scoped(KeyFam::Cap(v, c), g) => json!({ "vault": hex(&v.0), "cap": hex(&c.0), "generation": g }),
        KeyName::Scoped(KeyFam::Cell(v, x), g) => json!({ "vault": hex(&v.0), "cell": hex(&x.0), "generation": g }),
        KeyName::Entry(e, stay, g) => {
            json!({ "entry": hex(&e.0), "stay": stay.map(|s| hex(&s.0)), "generation": g })
        }
    }
}

/// Whom a key's box goes to: a signer, or the holders of a key of the schedule.
fn recipient(r: &Recipient) -> Value {
    key_name(r.name())
}

/// Note `entry` as device `me` holds it, for the page's note page: its lines, the main line first, then each proposal
/// in the order it started, each with its name (`named`), the version it started from, its heads, its history (its own
/// edits and every edit they build on, oldest first), and the note it shows there; and every edit of it the device
/// counts, in the order the device took them (`edit`). `None` if it counts none.
pub fn note(lab: &Lab, me: SignerId, entry: EntryId) -> Option<Value> {
    let h = lab.history(me, entry)?;
    let line = |line| {
        let doc = lab.item_on(me, entry, line).and_then(Item::as_document);
        let start = line.and_then(|b| h.get(b));
        json!({
            "line": line.map(|b: EditId| hex(&b.0)),
            "name": line_name(h, line),
            "from": start.map(|c| ids(&c.write.deps)),
            "heads": ids(&h.heads(line)),
            "history": h.history(line).iter().map(|c| hex(&c.write.edit.0)).collect::<Vec<_>>(),
            "title": doc.as_ref().map(|d| d.title.clone()),
            "text": doc.as_ref().map(body),
            "blocks": doc.as_ref().map(|d| d.blocks.iter().map(|b| b.to_value()).collect::<Vec<_>>()),
        })
    };
    let lines: Vec<Value> = h.lines().into_iter().map(line).collect();
    let shown = h.changes().len().saturating_sub(SHOWN);
    let edits: Vec<Value> = h.changes().iter().enumerate().map(|(i, c)| edit(h, me, c, i >= shown)).collect();
    let vault = lab.vault_of_entry(me, entry).map(|v| hex(&v.0));
    Some(json!({ "entry": hex(&entry.0), "vault": vault, "lines": lines, "edits": edits }))
}

/// One edit of a note as its page shows it: its id, its device and the vault it acted for, the line it extends, what
/// it builds on, and what it is, as the ops engine's `history` says (`engine::wrote`): an `edit` of the text, the
/// start of a proposal (`propose`, with its name), a `merge` of two lines, a `promote`, or `sealed`; and the line it
/// brought in, or for a proposal the line it started from (`from`); and whether the note's readers count it, as the
/// rules of the caps it relies on allow it and what it builds on (`Change::counted`). With `shown`, the note's title
/// and text at its version, and the text at the one it changed, so the page's diff shows what it brought.
fn edit(h: &History, me: SignerId, c: &Change, shown: bool) -> Value {
    let (w, Wrote { kind, from, base }) = (&c.write, wrote(h, c));
    let line = w.line();
    let at = |version: &[EditId]| h.item_at(version, me, line).as_document();
    let (after, before) =
        if shown && matches!(kind, "edit" | "merge" | "promote") { (at(&[w.edit]), at(&base)) } else { (None, None) };
    json!({
        "id": hex(&w.edit.0),
        "author": hex(&w.author.0),
        "actor": hex(&w.actor.0),
        "line": line.map(|b| hex(&b.0)),
        "deps": ids(&w.deps),
        "kind": kind,
        "name": if kind == "propose" { h.name(w.edit) } else { None },
        "from": from.map(|l| json!({ "line": l.map(|b| hex(&b.0)), "name": line_name(h, l) })),
        "title": after.as_ref().map(|d| d.title.clone()),
        "text": after.as_ref().map(body),
        "before": before.as_ref().map(body),
        "counted": c.counted,
    })
}

/// A note's text: its first paragraph, block 2, as `cast::document` writes it.
fn body(doc: &DocV2) -> String {
    doc.blocks.iter().find(|b| b.id == 2).map(|b| b.text.clone()).unwrap_or_default()
}

fn ids(edits: &[EditId]) -> Vec<String> {
    edits.iter().map(|edit| hex(&edit.0)).collect()
}
