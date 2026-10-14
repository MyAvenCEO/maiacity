//! What the page's database studio and its note page show, as the page reads them (JSON): a vault's database as a
//! device holds it (`database`), every signed edit the device holds, the database's history (`history`), and one note
//! as it is on its main line and on each proposal, with every edit of it (`note`). Each reads the device's Lab and
//! nothing else: what the device can't open shows as sealed, as the server sees all of it.
//!
//! The page's words are the core's own: an edit (`Edit`); a proposal (`Proposal`), a line of a note's history that its
//! main line may take in; a variant (`Lab::variant`), a new note made from a line of another; a share, what a vault
//! shares of its entries; and an audience, the entries of a vault the same shares reach, under one key. Its JSON keys
//! keep their older names: `caps` and `cap` for shares, `cells` and `cell` for audiences, `role` and `roles` for
//! levels, `grantee` for a share's who, and `generation` for a key's epoch.

use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value, json};

use crate::doc::Item;
use crate::engine::{SHOWN, Wrote, line_name, wrote};
use crate::history::{Change, History};
use crate::id::{AudienceId, EditId, EntryId, ShareId, SignerId, VaultId};
use crate::keys::{KeyFam, KeyName, Recipient};
use crate::lab::Lab;
use crate::lens::{self, DocV2, Lens, Schema};
use crate::policy::{Action, Entry, Principal, Proposal, Revoking, Setting, Sharing, State, Who};
use crate::sign::{Classical, Signature, SignerKeys};
use crate::slice::LENS_TYPE;
use crate::wire::Wire as _;
use crate::words::{hex, kind_name, level_name, who_name};
use crate::world::levels;

/// Vault `vault`'s database as device `me` holds it, for the page's database studio: how many edits and McEliece keys
/// the device holds in all; the schemas and lenses the app ships (`lens::blobs`); its seed's epoch; the edits the
/// device holds on it by kind; the schemas and lenses of its lane; each audience its entries are in, the first
/// first, with the shares that reach it beside the vault's shares on the whole of it, its key's epoch and how many
/// entries it holds; and every entry, cards and profiles too, in the order they were created (`row`).
pub fn database(lab: &Lab, me: SignerId, vault: VaultId) -> Value {
    let st = lab.state(me);
    let (edits, keys) = lab.size(me);
    let lane = lab.lane(me, vault);
    let entries: Vec<&Entry> = st.entries().iter().filter(|en| en.vault == vault).collect();
    let mut audiences: Vec<AudienceId> = vec![];
    for en in &entries {
        if !audiences.contains(&en.audience()) {
            audiences.push(en.audience());
        }
    }
    let audience = |x: &AudienceId| {
        json!({
            "id": hex(&x.0),
            "caps": share_ids(st.audience_shares(*x).unwrap_or_default()),
            "generation": st.epoch(KeyFam::Audience(vault, *x)),
            "entries": entries.iter().filter(|en| en.audience() == *x).count(),
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
        "cells": audiences.iter().map(audience).collect::<Vec<_>>(),
        "rows": entries.iter().map(|en| row(lab, me, en)).collect::<Vec<_>>(),
    })
}

/// Entry `en` as the studio's table editor shows it: its type and its tags now, if the device reads them; its record
/// as the device opens it on the main line, or a schema's or lens's JSON (`null` if it opens none of it), and its
/// `kind` as the record names it, or its type for a schema or lens (`"sealed"` then); the schemas its edits were made
/// under; how many edits of it the device counts and holds; its lines (the main line and each proposal) and its
/// proposals' names; its audience and its key's epoch there; the size of its Loro document; the device and the vault
/// of its first edit; and who may read it.
fn row(lab: &Lab, me: SignerId, en: &Entry) -> Value {
    let (st, entry) = (lab.state(me), en.id);
    let item = lab.item(me, entry);
    let meaning = lab.meaning(me, entry);
    let ty = meaning.as_ref().map(|m| m.attrs.ty.as_str().to_string());
    // A schema or lens entry holds its JSON as written, not a Loro document (`Lab::lane_entry`): that is its record.
    let lane: Option<Value> = match item {
        None => lab.lane_entry(me, entry).and_then(|b| serde_json::from_slice(b).ok()),
        Some(_) => None,
    };
    let opens = item.is_some() || lane.is_some();
    let record = item.map(Item::record).or(lane);
    let field = |name: &str| record.as_ref().and_then(|r| r.get(name)).cloned();
    let (kind, title) = match item {
        None if opens => (ty.clone(), field(if ty.as_deref() == Some(LENS_TYPE) { "lens" } else { "title" })),
        _ => (field("kind").and_then(|k| k.as_str().map(str::to_string)), field("title")),
    };
    let kind = kind.unwrap_or_else(|| if opens { "record" } else { "sealed" }.into());
    let history = lab.history(me, entry);
    let lines = history.map(History::lines).unwrap_or_default();
    let name = |b: EditId| history.and_then(|h| h.name(b)).map_or(Value::Null, Value::from);
    let proposals: Vec<Value> = lines.iter().flatten().map(|&b| name(b)).collect();
    let author = st.write(en.creation).map(|w| hex(&w.author.0));
    let authored: Vec<String> = item.map(|i| i.authored().iter().map(|b| b.to_hex()).collect()).unwrap_or_default();
    let (v, x) = (en.vault, en.audience());
    let levels: Map<String, Value> = levels(st, v, x).iter().map(|(v, r)| (hex(&v.0), level_name(*r).into())).collect();
    json!({
        "entry": hex(&entry.0),
        "type": ty,
        "tags": meaning.as_ref().map(|m| m.attrs.tags.iter().map(|t| t.as_str().to_string()).collect::<Vec<_>>()),
        "kind": kind,
        "title": title,
        "record": record,
        "authored": authored,
        "edits": history.map_or(0, |h| h.changes().len()),
        "held": lab.fetched(me, entry),
        "lines": lines.len(),
        "proposals": proposals,
        "cell": hex(&x.0),
        "generation": st.epoch(KeyFam::Audience(v, x)),
        "bytes": item.map_or(0, |i| i.bytes().len()),
        "author": author,
        "actor": hex(&en.creator.0),
        "public": st.public_key(KeyFam::Audience(v, x)),
        "roles": levels,
    })
}

/// The edits device `me` holds on vault `vault`, by kind: its founding, the writes, moves (marks that take an entry to
/// an audience) and checkpoints of its entries, the keys edits of its keys and its entries', the shares over it and the
/// revocations of those. Its schemas and lenses are entries (V1d), counted among the writes, so none counts apart.
fn counts(lab: &Lab, me: SignerId, vault: VaultId) -> Value {
    let (log, st) = (lab.log(me), lab.state(me));
    let edits = || log.edits().iter().zip(log.ids());
    let of = |e: &EntryId| st.entry(*e).map(|en| en.vault) == Some(vault);
    let shares: HashSet<ShareId> = edits()
        .filter(|(edit, _)| matches!(&edit.action, Action::Share(Sharing::Grant(c, _)) if c.over == vault))
        .map(|(_, id)| ShareId::from(*id))
        .collect();
    let (mut founded, mut writes, mut moves, mut checkpoints, mut keys, mut revokes) = (0, 0, 0, 0, 0, 0);
    for (edit, id) in edits() {
        match &edit.action {
            Action::Genesis { .. } if VaultId::from(*id) == vault => founded += 1,
            Action::Write { vault: v, .. } if *v == vault => writes += 1,
            Action::Mark { vault: v, caps: Some(_), .. } if *v == vault => moves += 1,
            Action::Checkpoint { entry, .. } if of(entry) => checkpoints += 1,
            Action::Keys { name: KeyName::Scoped(k, _), .. } if k.vault() == vault => keys += 1,
            Action::Keys { name: KeyName::Entry(e, ..), .. } if of(e) => keys += 1,
            Action::Revoke(Revoking::Grant { share, .. }) if shares.contains(share) => revokes += 1,
            _ => {}
        }
    }
    json!({
        "founded": founded,
        "writes": writes,
        "moves": moves,
        "checkpoints": checkpoints,
        "keys": keys,
        "caps": shares.len(),
        "revokes": revokes,
    })
}

/// A schema as the tab shows it: its id, its title and its JSON, as its entry holds it.
fn schema(s: &Schema) -> Value {
    json!({ "id": s.id().to_hex(), "title": s.title(), "json": String::from_utf8_lossy(s.bytes()) })
}

/// A lens as the tab shows it: its id, its title, the schemas it joins, and its JSON, as its entry holds it.
fn lens(l: &Lens) -> Value {
    let (from, to) = (l.from().to_hex(), l.to().to_hex());
    json!({ "id": l.id().to_hex(), "title": l.title(), "from": from, "to": to, "json": String::from_utf8_lossy(l.bytes()) })
}

/// The database's history: every signed edit device `me` holds, in the order it took them, for the studio's History
/// view: each one's place in that order, its id, what it does (`action`: its kind and fields, ids in hex, what is
/// sealed by its size alone), its author and cosigners, each signature by its signer and its halves (`signature`), the
/// edits of its log it builds on and its causal depth, its size on the wire, and the vaults it concerns (`concerns`);
/// for a write, whether the device counts it, as once it no longer trusts the curves it counts only the writes a
/// checkpoint covers, and whether its entry's readers do, as it fits its entry's schemas, the ops of the shares it
/// relies on allow it and what it builds on counts (`allowed`, `Change::counted`), and why not (`why`, `wrote`).
pub fn history(lab: &Lab, me: SignerId) -> Value {
    let (held, st) = (lab.log(me), lab.state(me));
    let counted: HashSet<EditId> = st.all_writes().iter().map(|w| w.edit).collect();
    let shares: HashMap<ShareId, VaultId> = held
        .edits()
        .iter()
        .zip(held.ids())
        .filter_map(|(edit, id)| match &edit.action {
            Action::Share(Sharing::Grant(c, _)) => Some((ShareId::from(*id), c.over)),
            _ => None,
        })
        .collect();
    // write `id`, as its entry's history holds it
    let write = |id: EditId, a: &Action| match a {
        Action::Write { entry, .. } => lab.history(me, *entry).and_then(|h| Some((h, h.get(id)?))),
        _ => None,
    };
    let edits: Vec<Value> = held
        .edits()
        .iter()
        .zip(held.ids())
        .enumerate()
        .map(|(n, (edit, &id))| {
            let signed = lab.signed_edit(me, id);
            let ((kind, fields), written) = (action(id, &edit.action), write(id, &edit.action));
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
                "vaults": concerns(st, id, &edit.action, &shares).iter().map(|v| hex(&v.0)).collect::<Vec<_>>(),
                "counted": matches!(edit.action, Action::Write { .. }).then(|| counted.contains(&id)),
                "allowed": written.map(|(_, c)| c.counted),
                "why": written.and_then(|(h, c)| wrote(h, c).why),
            })
        })
        .collect();
    json!({ "edits": edits })
}

/// What edit `id` does, as the History view shows it: its kind, and its fields, ids in hex. What is sealed, a write's
/// body, a share's slice, keys' boxes, shows by its size or its recipient alone, and a public key by whether there is
/// one. A keep share is a `cap` like any share, its `role` its mode (`words::level_name`) and its `grantee` a device. A
/// write's `line` is the proposal it extends (`null` on the main line), and `starts` whether it starts one; a write
/// that creates its entry names the audience it goes in (`create`), and its `stay` the mark that put the entry where
/// it is now (`null` for where it was created). A mark names the audience it takes its entry to (`caps`) and the keep
/// shares it marks it as wanted by (`wants`), each `null` where it leaves that part as it is.
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
        Action::Share(Sharing::Owner { vault, owner, seal_to }) => (
            "addOwner",
            json!({ "vault": hex(&vault.0), "owner": principal(owner), "sealTo": seal_to.is_some() }),
        ),
        Action::Revoke(Revoking::Owner { vault, owner, keep }) => {
            ("removeOwner", json!({ "vault": hex(&vault.0), "owner": principal(owner), "keep": keep.len() }))
        }
        Action::Settings { vault, set: Setting::Threshold(threshold) } => {
            ("setThreshold", json!({ "vault": hex(&vault.0), "threshold": threshold }))
        }
        Action::Share(Sharing::Device { vault, device, seal_to }) => (
            "addDevice",
            json!({ "vault": hex(&vault.0), "device": hex(&device.0), "sealTo": seal_to.is_some() }),
        ),
        Action::Revoke(Revoking::Device { vault, device, keep }) => {
            ("removeDevice", json!({ "vault": hex(&vault.0), "device": hex(&device.0), "keep": keep.len() }))
        }
        Action::Settings { vault, set: Setting::Root { root, keep } } => {
            ("setRoot", json!({ "vault": hex(&vault.0), "root": root.map(|r| hex(&r.0)), "keep": keep.len() }))
        }
        Action::Share(Sharing::Grant(c, via)) => (
            "cap",
            json!({
                "over": hex(&c.over.0),
                "role": level_name(c.level),
                "grantee": who_name(c.who),
                "wide": c.wide,
                "issuer": hex(&c.issuer.0),
                "parent": c.parent.map(|p| hex(&p.0)),
                "via": vias(via),
                "sealed": c.select.len(),
            }),
        ),
        Action::Revoke(Revoking::Grant { share, actor, keep, via }) => (
            "revoke",
            json!({ "cap": hex(&share.0), "actor": hex(&actor.0), "keep": keep.len(), "via": vias(via) }),
        ),
        Action::Write { vault, entry, actor, stay, epoch, deps, proposal, via, create, files, body } => {
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
                    "generation": epoch,
                    "deps": ids(deps),
                    "line": line.map(|b| hex(&b.0)),
                    "starts": *proposal == Proposal::New,
                    "via": vias(via),
                    "create": create.as_deref().map(share_ids),
                    "files": files.iter().map(|f| json!({ "root": hex(&f.hash), "size": f.size })).collect::<Vec<_>>(),
                    "sealed": body.len(),
                }),
            )
        }
        Action::Mark { vault, entry, caps, wants, keep, via } => (
            "mark",
            json!({
                "vault": hex(&vault.0),
                "entry": hex(&entry.0),
                "caps": caps.as_deref().map(share_ids),
                "wants": wants.as_deref().map(share_ids),
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
/// owners it acts through, the vault a share is over and its grantee, the vault of the entry it touches or of the key
/// it boxes.
fn concerns(st: &State, id: EditId, a: &Action, shares: &HashMap<ShareId, VaultId>) -> Vec<VaultId> {
    let of = |e: &EntryId| st.entry(*e).map(|en| en.vault);
    let mut vaults: Vec<VaultId> = match a {
        Action::Genesis { owners, .. } => {
            let owners = owners.iter().filter_map(|o| if let Principal::Vault(v) = o { Some(*v) } else { None });
            [VaultId::from(id)].into_iter().chain(owners).collect()
        }
        Action::Share(Sharing::Owner { vault, owner, .. }) | Action::Revoke(Revoking::Owner { vault, owner, .. }) => {
            match owner {
                Principal::Vault(o) => vec![*vault, *o],
                Principal::Signer(_) => vec![*vault],
            }
        }
        Action::Settings { vault, .. }
        | Action::Share(Sharing::Device { vault, .. })
        | Action::Revoke(Revoking::Device { vault, .. })
        | Action::Mark { vault, .. } => vec![*vault],
        Action::Share(Sharing::Grant(c, _)) => {
            let to = match c.who {
                Who::Vault(v) => Some(v),
                _ => None,
            };
            [Some(c.issuer), Some(c.over), to].into_iter().flatten().collect()
        }
        Action::Revoke(Revoking::Grant { share, actor, .. }) => {
            [Some(*actor), shares.get(share).copied()].into_iter().flatten().collect()
        }
        Action::Write { vault, actor, .. } => vec![*actor, *vault],
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

fn share_ids(xs: &[ShareId]) -> Vec<String> {
    xs.iter().map(|c| hex(&c.0)).collect()
}

/// A key of the schedule as the History view names it: a signer's own key, one epoch of a vault's seed, of a
/// share's key or of an audience's key, or the key of an entry in one of its stays at one epoch of that stay's
/// audience.
fn key_name(k: KeyName) -> Value {
    match k {
        KeyName::Signer(s) => json!({ "signer": hex(&s.0) }),
        KeyName::Scoped(KeyFam::Seed(v), g) => json!({ "seed": hex(&v.0), "generation": g }),
        KeyName::Scoped(KeyFam::Share(v, c), g) => json!({ "vault": hex(&v.0), "cap": hex(&c.0), "generation": g }),
        KeyName::Scoped(KeyFam::Audience(v, x), g) => json!({ "vault": hex(&v.0), "cell": hex(&x.0), "generation": g }),
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
/// brought in, or for a proposal the line it started from (`from`); and whether the note's readers count it, as it
/// fits the note's schemas, the ops of the shares it relies on allow it and what it builds on counts
/// (`Change::counted`), and why not (`why`). With `shown`, the note's title and text at its version, and the text at
/// the one it changed, so the page's diff shows what it brought.
fn edit(h: &History, me: SignerId, c: &Change, shown: bool) -> Value {
    let (w, Wrote { kind, from, base, why }) = (&c.write, wrote(h, c));
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
        "why": why,
    })
}

/// A note's text: its first paragraph, block 2, as `cast::document` writes it.
fn body(doc: &DocV2) -> String {
    doc.blocks.iter().find(|b| b.id == 2).map(|b| b.text.clone()).unwrap_or_default()
}

fn ids(edits: &[EditId]) -> Vec<String> {
    edits.iter().map(|edit| hex(&edit.0)).collect()
}
