//! What the page's database studio and its note page show, as the page reads them (JSON): a vault's database as a
//! device holds it (`database`), every signed edit the device holds, the database's history (`history`), and one note
//! as it is on its main line and on each proposal, with every edit of it (`note`). Each reads the device's Lab and
//! nothing else: what the device can't open shows as sealed, as the server sees all of it.
//!
//! The page's words: an edit is a signed op (the core's `Op`), a proposal a branch of a note's history (the core's
//! `Branch`), a variant a fork of a note into a new one (`Lab::fork`).

use std::collections::{BTreeSet, HashMap, HashSet};

use avendb::branch::{Commit, History};
use avendb::doc::Item;
use avendb::id::{BlobId, EntryId, GrantId, OpId, SignerId, SpaceId, VaultId};
use avendb::keys::{KeyScope, Recipient};
use avendb::lab::Lab;
use avendb::lens::{self, DocV2, Lens, Schema};
use avendb::policy::{Action, Branch, Grantee, Line, Principal, Scope, State};
use avendb::sign::{Classical, Signature, SignerKeys};
use avendb::wire::Wire as _;
use serde_json::{Map, Value, json};

use crate::{Firsts, firsts, hex, is_card, is_profile, kind_name, role_name, roles};

/// The most edits of one note whose text the note page shows, the latest: each version is made from scratch from the
/// updates it holds.
const SHOWN: usize = 200;

/// Vault `vault`'s database as device `me` holds it, for the page's database studio: how many edits and McEliece keys
/// the device holds in all; the schemas and lenses the app ships (`lens::blobs`); and each space the vault founded, in
/// the order founded, with its key's epoch, the edits the device holds on it by kind, the schemas and lenses its lane
/// publishes, and every entry, cards and profiles too (`row`).
pub fn database(lab: &Lab, me: SignerId, vault: VaultId) -> Value {
    let st = lab.state(me);
    let first = firsts(st);
    let (edits, keys) = lab.size(me);
    let founded = st.spaces().iter().filter(|s| s.founder == vault);
    let spaces: Vec<Value> = founded
        .map(|s| {
            let lane = lab.lane(me, s.id);
            json!({
                "id": hex(&s.id.0),
                "public": st.is_public(Scope::Space(s.id)),
                "epoch": st.epoch(KeyScope::Space(s.id)),
                "edits": counts(lab, me, s.id),
                "schemas": lane.schemas().map(schema).collect::<Vec<_>>(),
                "lenses": lane.lenses().map(lens).collect::<Vec<_>>(),
                "rows": s.entries.iter().map(|&e| row(lab, me, s.id, e, &first)).collect::<Vec<_>>(),
            })
        })
        .collect();
    let schemas = [&*lens::DOCUMENT_V1, &*lens::DOCUMENT_V2, &*lens::TODO_V1, &*lens::TODO_V2].map(schema);
    json!({
        "vault": hex(&vault.0),
        "held": { "edits": edits, "keys": keys },
        "builtIn": { "schemas": schemas, "lenses": [lens(&lens::DOCUMENT_LENS), lens(&lens::TODO_LENS)] },
        "spaces": spaces,
    })
}

/// Entry `entry` of space `space` as the studio's table editor shows it: its record as the device opens it on the main
/// line (`null` if it opens none of it), its `kind` as the record names it (`"sealed"` then), whether it is a device's
/// card or a vault's profile, the schemas its edits were made under, how many edits of it the device counts and holds,
/// its lines (the main line and each proposal) and its proposals' names, its key's epoch, the size of its Loro
/// document, the device and the vault of its first edit, and who may read it.
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
    let proposals: Vec<Value> = lines.iter().flatten().map(|&b| name(b)).collect();
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
        "edits": history.map_or(0, |h| h.commits().len()),
        "held": lab.fetched(me, space, entry),
        "lines": lines.len(),
        "proposals": proposals,
        "epoch": st.epoch(KeyScope::Entry(space, entry)),
        "bytes": item.map_or(0, |i| i.bytes().len()),
        "author": author,
        "actor": actor,
        "public": st.is_public(sc),
        "roles": roles,
    })
}

/// The edits device `me` holds on space `space`, by kind: its founding, the writes and checkpoints of its entries, the
/// keys edits of its keys and its entries', the grants on it or on its entries and the revocations of those, and what
/// was published into its lane.
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

/// The database's history: every signed edit device `me` holds, in the order it took them, for the studio's History
/// view: each one's place in that order, its id, what it does (`action`: its kind and fields, ids in hex, what is
/// sealed by its size alone), its author and cosigners, each signature by its signer and its halves (`signature`), the
/// edits of its log it builds on and its causal depth, its size on the wire, and the vaults it concerns (`concerns`);
/// for a write, whether the device counts it, as once it no longer trusts the curves it counts only the writes a
/// checkpoint covers.
pub fn history(lab: &Lab, me: SignerId) -> Value {
    let (held, st) = (lab.log(me), lab.state(me));
    let counted: HashSet<OpId> = st.all_writes().iter().map(|w| w.op).collect();
    let grants: HashMap<GrantId, Scope> = held
        .ops()
        .iter()
        .zip(held.ids())
        .filter_map(|(op, id)| match &op.action {
            Action::Grant(g, _) => Some((GrantId::from(*id), g.scope)),
            _ => None,
        })
        .collect();
    let edits: Vec<Value> = held
        .ops()
        .iter()
        .zip(held.ids())
        .enumerate()
        .map(|(n, (op, &id))| {
            let signed = lab.signed_op(me, id);
            let (kind, fields) = action(id, &op.action);
            json!({
                "n": n + 1,
                "id": hex(&id.0),
                "kind": kind,
                "fields": fields,
                "author": hex(&op.author.0),
                "cosigners": op.cosigners.iter().map(|s| hex(&s.0)).collect::<Vec<_>>(),
                "sigs": signed.map(|s| s.sigs.iter().map(signature).collect::<Vec<_>>()).unwrap_or_default(),
                "parents": ids(&op.parents),
                "depth": op.depth,
                "bytes": signed.map_or(0, |s| s.to_wire().len()),
                "vaults": concerns(st, id, &op.action, &grants).iter().map(|v| hex(&v.0)).collect::<Vec<_>>(),
                "counted": matches!(op.action, Action::Write { .. }).then(|| counted.contains(&id)),
            })
        })
        .collect();
    json!({ "edits": edits })
}

/// What edit `id` does, as the History view shows it: its kind, and its fields, ids in hex. What is sealed, a write's
/// body, keys' boxes, shows by its size or its recipient alone, and a public key by whether there is one. A write's
/// `line` is the proposal it extends (`null` on the main line), and `starts` whether it starts one.
fn action(id: OpId, a: &Action) -> (&'static str, Value) {
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
        Action::FoundSpace { actor, via, .. } => ("foundSpace", json!({ "actor": hex(&actor.0), "via": vias(via) })),
        Action::Grant(g, via) => (
            "grant",
            json!({
                "scope": scope(g.scope),
                "role": role_name(g.role),
                "grantee": grantee(&g.grantee),
                "issuer": hex(&g.issuer.0),
                "parent": g.parent.map(|p| hex(&p.0)),
                "via": vias(via),
            }),
        ),
        Action::Revoke { grant, actor, keep, via } => (
            "revoke",
            json!({ "grant": hex(&grant.0), "actor": hex(&actor.0), "keep": keep.len(), "via": vias(via) }),
        ),
        Action::Write { space, entry, actor, epoch, deps, branch, via, body } => {
            let line = match branch {
                Branch::Main => None,
                Branch::New => Some(id),
                Branch::On(b) => Some(*b),
            };
            (
                "write",
                json!({
                    "space": hex(&space.0),
                    "entry": hex(&entry.0),
                    "actor": hex(&actor.0),
                    "epoch": epoch,
                    "deps": ids(deps),
                    "line": line.map(|b| hex(&b.0)),
                    "starts": *branch == Branch::New,
                    "via": vias(via),
                    "sealed": body.len(),
                }),
            )
        }
        Action::Keys { key, epoch, id: key_id, public, boxes, clear } => (
            "keys",
            json!({
                "key": key_scope(*key),
                "epoch": epoch,
                "id": hex(&key_id.0),
                "public": public.is_some(),
                "boxes": boxes.iter().map(|b| recipient(&b.to)).collect::<Vec<_>>(),
                "clear": clear.is_some(),
            }),
        ),
        Action::Publish { space, actor, via, blob } => {
            let title = Schema::parse(blob)
                .map(|s| s.title().to_string())
                .or_else(|| Lens::parse(blob).map(|l| l.title().to_string()));
            (
                "publish",
                json!({
                    "space": hex(&space.0),
                    "actor": hex(&actor.0),
                    "via": vias(via),
                    "blob": BlobId::of(blob).to_hex(),
                    "title": title,
                    "bytes": blob.len(),
                }),
            )
        }
        Action::Checkpoint { space, entry, covers } => {
            ("checkpoint", json!({ "space": hex(&space.0), "entry": hex(&entry.0), "covers": ids(covers) }))
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
        Classical::Batch { ops, .. } => ("p256", Some(ops.len())),
    };
    json!({ "signer": hex(&sig.keys.id().0), "by": by, "classical": classical, "batch": batch, "pq": sig.pq.as_ref().map(Vec::len) })
}

/// The vaults edit `id` concerns, by device `st`'s view: the vault it founds or changes, the vault it acts for and the
/// owners it acts through, the founder of the space it touches, and a grant's grantee.
fn concerns(st: &State, id: OpId, a: &Action, grants: &HashMap<GrantId, Scope>) -> Vec<VaultId> {
    let founder = |s: SpaceId| st.founder(s);
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
        | Action::SetRoot { vault, .. } => vec![*vault],
        Action::FoundSpace { actor, .. } => vec![*actor],
        Action::Grant(g, _) => {
            let to = match g.grantee {
                Grantee::Principal(Principal::Vault(v)) => Some(v),
                _ => None,
            };
            [Some(g.issuer), to, founder(g.scope.space())].into_iter().flatten().collect()
        }
        Action::Revoke { grant, actor, .. } => {
            [Some(*actor), grants.get(grant).and_then(|s| founder(s.space()))].into_iter().flatten().collect()
        }
        Action::Write { space, actor, .. } | Action::Publish { space, actor, .. } => {
            [Some(*actor), founder(*space)].into_iter().flatten().collect()
        }
        Action::Keys { key: KeyScope::Vault(v), .. } => vec![*v],
        Action::Keys { key: KeyScope::Space(s) | KeyScope::Entry(s, _), .. } | Action::Checkpoint { space: s, .. } => {
            founder(*s).into_iter().collect()
        }
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

fn grantee(g: &Grantee) -> Value {
    match g {
        Grantee::Public => Value::from("public"),
        Grantee::Principal(p) => principal(p),
    }
}

fn scope(s: Scope) -> Value {
    match s {
        Scope::Space(sp) => json!({ "space": hex(&sp.0) }),
        Scope::Entry(sp, e) => json!({ "space": hex(&sp.0), "entry": hex(&e.0) }),
    }
}

fn key_scope(k: KeyScope) -> Value {
    match k {
        KeyScope::Vault(v) => json!({ "vault": hex(&v.0) }),
        KeyScope::Space(sp) => json!({ "space": hex(&sp.0) }),
        KeyScope::Entry(sp, e) => json!({ "space": hex(&sp.0), "entry": hex(&e.0) }),
    }
}

/// Whom a key's box goes to: a signer, or the holders of a key of the schedule at its epoch.
fn recipient(r: &Recipient) -> Value {
    match r {
        Recipient::Signer(s) => json!({ "signer": hex(&s.0) }),
        Recipient::Key { key, epoch, .. } => json!({ "key": key_scope(*key), "epoch": epoch }),
    }
}

/// Note `entry` of space `space` as device `me` holds it, for the page's note page: its lines, the main line first,
/// then each proposal in the order it started, each with its name (`named`), the version it started from, its heads,
/// its history (its own edits and every edit they build on, oldest first), and the note it shows there; and every edit
/// of it the device counts, in the order the device took them (`edit`). `None` if it counts none.
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
    let edits: Vec<Value> = h.commits().iter().enumerate().map(|(i, c)| edit(h, me, c, i >= shown)).collect();
    Some(json!({ "space": hex(&space.0), "entry": hex(&entry.0), "lines": lines, "edits": edits }))
}

/// One edit of a note as its page shows it: its id, its device and the vault it acted for, the line it extends, what
/// it builds on, and what it is: an `edit` of the text, the start of a proposal (`propose`, with its name), a `merge`
/// of two lines, which carries no change, a `promote`, a merge that brings its line to the other's record, or
/// `sealed`, an edit the device can't open; for a proposal, the line it started from, and for a merge or a promote,
/// the line it brought in (`from`). With `shown`, the note's title and text at its version, and the text at the one
/// it changed: what it built on, or for a merge or a promote, its own line's version before it, so the page's diff
/// shows what it brought.
fn edit(h: &History, me: SignerId, c: &Commit, shown: bool) -> Value {
    let w = &c.write;
    let line = w.line();
    let on = |d: &OpId| h.get(*d).map(|x| x.write.line());
    let other = w.deps.iter().filter_map(on).find(|l| *l != line);
    let kind = match &c.body {
        _ if w.branch == Branch::New => "propose",
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
        "id": hex(&w.op.0),
        "author": hex(&w.author.0),
        "actor": hex(&w.actor.0),
        "line": line.map(|b| hex(&b.0)),
        "deps": ids(&w.deps),
        "kind": kind,
        "name": if kind == "propose" { h.name(w.op) } else { None },
        "from": other.map(|l| json!({ "line": l.map(|b| hex(&b.0)), "name": named(h, l) })),
        "title": after.as_ref().map(|d| d.title.clone()),
        "text": after.as_ref().map(body),
        "before": before.as_ref().map(body),
    })
}

/// A line of a note by name: `main`, or its proposal's, `None` for a proposal whose name the device can't open.
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
