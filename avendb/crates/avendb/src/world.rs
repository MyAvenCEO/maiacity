//! A device's world as its page shows it (the ops engine's `world`): every vault it knows, whom it acts for and through
//! which owners, and as which vault its person acts in each (`Acting`); every share in force, with its slice where the
//! device reads it, the group it is, what it reaches and who may revoke it; every audience, the entries the same shares
//! reach under one key, with the devices that sync it and whether each opens it or only relays its ciphertext; and
//! every entry, with its type, its tags, each vault's level on it, who reads, writes and shares it on, and the files
//! its writes bring, each with where it is synced to (`SyncedTo`).
//!
//! Also the entries a device writes itself, by their types: its card in its person's vault (`CARD`), a vault's profile
//! (`PROFILE`), a file it brings (`FILE`); and how avenCEO, the aven vault avenDB's server is a device of, keeps or
//! relays a person's vaults (`avenceo`, `server_level`).

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use crate::doc::Item;
use crate::id::{AudienceId, BlobId, EntryId, ShareId, SignerId, VaultId};
use crate::keys::KeyFam;
use crate::lab::Lab;
use crate::lens::{DocV2, Lens, Schema, Status};
use crate::policy::{Entry, Issued, Kind, Level, Principal, Share, State, Vault, Who};
use crate::rules;
use crate::sealed::{FileRoot, PIECE};
use crate::slice::{LENS_TYPE, Selector, Slice};
use crate::words::{hex, kind_name, level_name, status_name, who_name};

/// The type of a device's card: an entry of its person's human vault, titled with the device's name, that the device
/// wrote itself (the ops engine's `card`).
pub const CARD: &str = "card";

/// The type of a vault's profile: an entry of the vault, titled with its name, written acting for the vault (the ops
/// engine's `profile`).
pub const PROFILE: &str = "profile";

/// The type of a note: a document, titled, its text in its first paragraph (`cast::document`).
pub const NOTE: &str = "note";

/// The type of a todo.
pub const TODO: &str = "todo";

/// The type of a file: a document titled with the file's name, whose first write brings the file, sealed (the ops
/// engine's `put_file`); the file's media type rides among the document's own tags (`MEDIA`).
pub const FILE: &str = "file";

/// The start of the mark that carries a file's media type among its document's own tags, inside its record:
/// `avendb:media:video/mp4`, what the page shows and plays it as.
pub const MEDIA: &str = "avendb:media:";

/// The start of the mark a variant carries among its document's own tags, inside its record: a note made from what
/// one line of another shows (the ops engine's `variant`), marked with that note's entry in hex.
pub const VARIANT: &str = "avendb:variant:";

/// The mark a deleted note carries among its document's own tags, inside its record: the page lists it apart, under
/// Deleted, and taking the mark out brings it back. Its edits stay in the vault's history, as every edit does.
pub const DELETED: &str = "avendb:deleted";

/// Where each entry and each file a device holds is synced to, by holdings (`avendb_net`'s `Node::synced_to`): one
/// list for entries and files alike, of the devices that hold some of it by their own word and the device's own shelf,
/// among those that may hold it by the device's view, each with how much it holds (`Holder`), smallest first.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SyncedTo {
    pub entries: BTreeMap<EntryId, Vec<Holder>>,
    pub files: BTreeMap<FileRoot, Vec<Holder>>,
}

/// A device Synced to lists for an entry or a file: how much of it the device holds, `has`, of how much this device
/// holds, `of`. Of an entry, the edits of its log this device holds, as far as its edits show those the device's
/// frontier covers; of a file, its sealed pieces. It holds all of it when `has` is `of`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Holder {
    pub device: SignerId,
    pub has: u64,
    pub of: u64,
}

impl Holder {
    /// It holds all of it.
    pub fn all(&self) -> bool {
        self.has >= self.of
    }
}

/// A device's world by its view (`world`): every vault it knows, in the order they were founded; every share in force,
/// in the order they were issued; every audience an entry is in; and every entry, in the order they were created.
pub struct World {
    /// Its own vault, its person's.
    pub mine: VaultId,
    /// The master recovery key it adds (`Lab::set_recovery`), if any.
    pub recovery: Option<SignerId>,
    /// Its vault owns avenCEO (`owns_aven`).
    pub owns_aven: bool,
    /// avenCEO keeps a backup of its vault (`backs_up`).
    pub backs_up: Option<bool>,
    pub vaults: Vec<VaultView>,
    pub shares: Vec<ShareView>,
    pub audiences: Vec<AudienceView>,
    pub entries: Vec<EntryView>,
    /// The devices each entry and each file is synced to, by their holdings: none in a Lab alone.
    pub synced_to: SyncedTo,
}

/// A vault as a device shows it.
pub struct VaultView {
    pub vault: Vault,
    /// The name on its profile, if it has one.
    pub name: Option<String>,
    /// Its devices' names, by their cards, of each that wrote one.
    pub names: BTreeMap<SignerId, String>,
    /// The owners the device acts for it through (`State::via`): none for its own vault, `None` if it doesn't act for
    /// it.
    pub via: Option<Vec<VaultId>>,
    pub acting: Acting,
}

/// What its person may do in a vault, by a device's view (`acting`): the vault they act as in it, whether that vault
/// reaches any of it, and whether it may share some of it on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Acting {
    pub actor: VaultId,
    pub reaches: bool,
    pub shares: bool,
}

/// A share in force as a device shows it.
pub struct ShareView {
    pub id: ShareId,
    pub share: Share,
    /// The shares it rests on, from its root share down to itself.
    pub chain: Vec<ShareId>,
    /// Its slice, if the device reads it: its selector is sealed to the vault it is over, its grantee and its issuer,
    /// so a device acting for none of them sees only that it is there, and what it reaches.
    pub slice: Option<Slice>,
    /// The vaults that may revoke it.
    pub revokers: Vec<VaultId>,
    /// The entries it reaches now: every entry of its vault for a share on the whole vault, else those in an audience
    /// of shares it is one of.
    pub entries: Vec<EntryId>,
}

/// An audience as a device shows it: the entries of a vault that the same shares reach, under one key.
pub struct AudienceView {
    pub id: AudienceId,
    pub vault: VaultId,
    /// The shares that reach it beside the vault's shares on the whole of it: none for the audience of the vault's own
    /// entries that no share selects.
    pub shares: Vec<ShareId>,
    /// Its key's epoch: it moves on when a reader may no longer read it.
    pub epoch: u64,
    pub entries: Vec<EntryId>,
    /// The vaults that read it: its own, and each vault a share with read or more that reaches it names.
    pub readers: Vec<VaultId>,
    /// Everyone may read it.
    pub public: bool,
    /// The devices that receive its edits.
    pub syncs: Vec<Syncing>,
}

/// A device that receives an audience's edits: the vault it receives them through, the one of those it acts for that
/// holds the strongest level on the audience, that level, and whether it opens any of what they hold, or only keeps
/// ciphertext, as the server for avenCEO.
pub struct Syncing {
    pub device: SignerId,
    pub through: VaultId,
    pub level: Level,
    pub opens: bool,
}

/// An entry as a device shows it.
pub struct EntryView {
    pub entry: EntryId,
    pub vault: VaultId,
    /// The vault its first write acted for.
    pub by: VaultId,
    /// Its type, its tags now and when it was created, in seconds since 1970, if the device reads them: they travel
    /// inside its encrypted writes.
    pub ty: Option<String>,
    pub tags: Option<Vec<String>>,
    pub created: Option<u64>,
    pub audience: AudienceId,
    /// Everyone may read it.
    pub public: bool,
    /// The strongest level each vault holds on it: its own vault's is owner.
    pub levels: Vec<(VaultId, Level)>,
    /// The files its writes bring, each with its plaintext length where the device opens it (`Lab::entry_files`).
    pub files: Vec<(FileRoot, Option<u64>)>,
    pub what: What,
}

/// What an entry holds, as a device reads it.
pub enum What {
    /// A document: its title and the text of its first paragraph (block 2), as `cast::document` writes them; the note
    /// it is a variant of, if it is one (`VARIANT`); whether it is deleted (`DELETED`); how many edits of it the device
    /// counts, and how many proposals it has.
    Note { title: String, text: String, variant_of: Option<EntryId>, deleted: bool, edits: usize, proposals: usize },
    Todo { title: String, status: Status },
    /// A file (`FILE`): its name, its media type (`MEDIA`), and whether it is deleted (`DELETED`).
    File { title: String, media: String, deleted: bool },
    /// A schema or lens entry (`slice::Sym::of_lane`): a schema's title, or a lens's name.
    Lane { title: String, lens: bool },
    /// What the device holds but can't open.
    Sealed,
}

impl World {
    /// The world as device `me`'s page reads it: ids in 64 hex digits, kinds, levels and statuses by their lowercase
    /// names, a share's slice as the core writes it (`{name, where, ops, above}`, `slice::Slice::to_json`), `null`
    /// where the device doesn't read it, a vault's `via` `null` where the device doesn't act for it, a share's
    /// `grantee` `"everyone"` for `Who::Everyone` (`words::who_name`), an entry's `type`, `tags` and `created` `null`
    /// where the device doesn't read them and its levels by vault; the built-in groups of ops the page offers when it
    /// shares (`rules::groups`), each with its level; and the master recovery key it adds, `recovery`, `null` for none,
    /// which a vault's owners mark as such. As the device works it out, so the page keeps no rule:
    ///
    /// - `ownsAven` and `backsUp` (`owns_aven`, `backs_up`, `null` while it knows no avenCEO);
    /// - each vault's `acting`: `{as, reaches, shares}` (`Acting`);
    /// - each share's `group`, the built-in group whose ops its ops are and whose `everyone` matches its grantee, or a
    ///   keep share's mode's (`Level::group`), `null` for one of its own or one whose slice the device doesn't read;
    ///   `whole`, whether it is on the whole vault; `reads`, whether its grantee reads what it reaches; `gets`, whether
    ///   its grantee's devices receive it, neither for a keep share;
    /// - each entry's `readers`, `writers` and `sharers`: the vaults whose level on it allows read, write, or is owner,
    ///   its own vault first (everyone besides reads it where it is `public`);
    /// - each entry's `files`, every file its writes bring, `len` `null` where the device doesn't open it, with
    ///   `pieces`, how many pieces it is sealed in.
    ///
    /// Each entry and each file lists the devices it is synced to, `syncedTo`, smallest first, each `{device, has, of}`
    /// (`Holder`): of an entry, edits of its log; of a file, its pieces. This device is among them once its shelf
    /// holds some of it. The page's keys keep their older names: the shares are `caps`, the audiences `cells`, a
    /// share's who and level `grantee` and `role`, an entry's audience and levels `cell` and `roles`, and an audience's
    /// epoch `generation`.
    pub fn to_json(&self, me: SignerId) -> Value {
        let ids = |xs: &[VaultId]| xs.iter().map(|v| hex(&v.0)).collect::<Vec<_>>();
        let holders = |hs: Option<&Vec<Holder>>| {
            let holder = |h: &Holder| json!({ "device": hex(&h.device.0), "has": h.has, "of": h.of });
            hs.into_iter().flatten().map(holder).collect::<Vec<_>>()
        };
        let owner = |p: &Principal| match p {
            Principal::Vault(v) => json!({ "vault": hex(&v.0) }),
            Principal::Signer(s) => json!({ "signer": hex(&s.0), "recovery": Some(*s) == self.recovery }),
        };
        let vault = |v: &VaultView| {
            let device = |d: &SignerId| json!({ "id": hex(&d.0), "name": v.names.get(d), "me": *d == me });
            let a = &v.acting;
            json!({
                "id": hex(&v.vault.id.0),
                "kind": kind_name(v.vault.kind),
                "name": v.name,
                "owners": v.vault.owners.iter().map(owner).collect::<Vec<_>>(),
                "threshold": v.vault.threshold,
                "root": v.vault.root.map(|r| hex(&r.0)),
                "devices": v.vault.devices.iter().map(device).collect::<Vec<_>>(),
                "via": v.via.as_deref().map(ids),
                "acting": { "as": hex(&a.actor.0), "reaches": a.reaches, "shares": a.shares },
            })
        };
        let share = |c: &ShareView| {
            let (level, keep) = (c.share.level, c.share.level.is_keep());
            let whole = c.share.wide || c.slice.as_ref().is_some_and(|s| s.select == Selector::All);
            json!({
                "id": hex(&c.id.0),
                "over": hex(&c.share.over.0),
                "issuer": hex(&c.share.issuer.0),
                "grantee": who_name(c.share.who),
                "role": level_name(level),
                "wide": c.share.wide,
                "parent": c.share.parent.map(|p| hex(&p.0)),
                "chain": c.chain.iter().map(|x| hex(&x.0)).collect::<Vec<_>>(),
                "slice": c.slice.as_ref().map(Slice::to_json),
                "revokers": ids(&c.revokers),
                "entries": c.entries.iter().map(|e| hex(&e.0)).collect::<Vec<_>>(),
                "group": group_of(&c.share, c.slice.as_ref()),
                "whole": whole,
                "reads": !keep && level.allows(Level::Read),
                "gets": !keep && level.allows(Level::Backup),
            })
        };
        let syncing = |x: &Syncing| {
            let (device, through) = (hex(&x.device.0), hex(&x.through.0));
            json!({ "device": device, "through": through, "role": level_name(x.level), "opens": x.opens })
        };
        let audience = |c: &AudienceView| {
            json!({
                "id": hex(&c.id.0),
                "vault": hex(&c.vault.0),
                "caps": c.shares.iter().map(|x| hex(&x.0)).collect::<Vec<_>>(),
                "generation": c.epoch,
                "entries": c.entries.iter().map(|e| hex(&e.0)).collect::<Vec<_>>(),
                "readers": ids(&c.readers),
                "public": c.public,
                "syncs": c.syncs.iter().map(syncing).collect::<Vec<_>>(),
            })
        };
        let synced = &self.synced_to;
        let file = |(f, len): &(FileRoot, Option<u64>)| {
            json!({
                "root": hex(&f.hash),
                "size": f.size,
                "len": len,
                "pieces": f.size.div_ceil(PIECE).max(1),
                "syncedTo": holders(synced.files.get(f)),
            })
        };
        let entry = |i: &EntryView| {
            let (kind, title, text, status) = match &i.what {
                What::Note { title, text, .. } => ("note", Some(title), Some(text), None),
                What::Todo { title, status } => ("todo", Some(title), None, Some(status_name(*status))),
                What::File { title, .. } => ("file", Some(title), None, None),
                What::Lane { title, lens } => (if *lens { "lens" } else { "schema" }, Some(title), None, None),
                What::Sealed => ("sealed", None, None, None),
            };
            let (variant_of, deleted, edits, proposals, media) = match &i.what {
                What::Note { variant_of, deleted, edits, proposals, .. } => {
                    (variant_of.map(|e| hex(&e.0)), *deleted, *edits, *proposals, None)
                }
                What::File { deleted, media, .. } => (None, *deleted, 0, 0, Some(media)),
                _ => (None, false, 0, 0, None),
            };
            let levels: Map<String, Value> =
                i.levels.iter().map(|(v, r)| (hex(&v.0), Value::from(level_name(*r)))).collect();
            let with = |need: Level| i.levels.iter().filter(|(_, r)| r.allows(need)).map(|(v, _)| v.0).collect();
            let (readers, writers): (Vec<[u8; 32]>, Vec<[u8; 32]>) = (with(Level::Read), with(Level::Write));
            let sharers: Vec<[u8; 32]> =
                i.levels.iter().filter(|(_, r)| *r == Level::Owner).map(|(v, _)| v.0).collect();
            let hexes = |xs: Vec<[u8; 32]>| xs.iter().map(hex).collect::<Vec<_>>();
            json!({
                "entry": hex(&i.entry.0),
                "vault": hex(&i.vault.0),
                "by": hex(&i.by.0),
                "type": i.ty,
                "tags": i.tags,
                "created": i.created,
                "cell": hex(&i.audience.0),
                "public": i.public,
                "roles": levels,
                "readers": hexes(readers),
                "writers": hexes(writers),
                "sharers": hexes(sharers),
                "kind": kind,
                "title": title,
                "text": text,
                "status": status,
                "variantOf": variant_of,
                "deleted": deleted,
                "edits": edits,
                "proposals": proposals,
                "media": media,
                "files": i.files.iter().map(file).collect::<Vec<_>>(),
                "syncedTo": holders(synced.entries.get(&i.entry)),
            })
        };
        json!({
            "me": hex(&me.0),
            "mine": hex(&self.mine.0),
            "recovery": self.recovery.map(|r| hex(&r.0)),
            "ownsAven": self.owns_aven,
            "backsUp": self.backs_up,
            "vaults": self.vaults.iter().map(vault).collect::<Vec<_>>(),
            "caps": self.shares.iter().map(share).collect::<Vec<_>>(),
            "cells": self.audiences.iter().map(audience).collect::<Vec<_>>(),
            "entries": self.entries.iter().map(entry).collect::<Vec<_>>(),
            "groups": rules::groups().iter().map(rules::Group::to_json).collect::<Vec<_>>(),
        })
    }
}

/// The built-in group share `share` is, as a device reads its slice `slice`: the group whose ops its ops are and whose
/// `everyone` matches its grantee (`rules::groups`); for a keep share, its mode's (`Level::group`); none for a group of
/// its own, or where the device doesn't read its slice.
pub fn group_of(share: &Share, slice: Option<&Slice>) -> Option<&'static str> {
    if share.level.is_keep() {
        return Some(share.level.group());
    }
    let ops = &slice?.grant.ops;
    let everyone = share.who == Who::Everyone;
    let same = |g: &rules::Group| g.everyone == everyone && rules::normalize(g.ops.clone()).is_ok_and(|o| o == *ops);
    rules::groups().into_iter().find(same).map(|g| g.name)
}

/// Device `me`'s world by its view: `None` while it belongs to no vault. Where its entries and files are synced to it
/// leaves to the node (`SyncedTo`).
pub fn world(lab: &Lab, me: SignerId) -> Option<World> {
    let st = lab.state(me);
    let mine = lab.vault_of(me)?;
    let vault = |v: &Vault| {
        let names = cards(lab, me, v.id).into_iter().map(|(d, (_, name))| (d, name)).collect();
        let name = profile_of(lab, me, v.id).map(|(_, name)| name);
        VaultView { vault: v.clone(), name, names, via: st.via(me, v.id), acting: acting(st, me, mine, v.id) }
    };
    let vaults = st.vaults().iter().map(vault).collect();
    let share = |cp: &Issued| {
        let reaches =
            |en: &&Entry| en.vault == cp.share.over && (cp.share.wide || in_audience(st, en.audience(), cp.id));
        ShareView {
            id: cp.id,
            share: cp.share.clone(),
            chain: cp.chain.to_vec(),
            slice: lab.slice(me, cp.id).cloned(),
            revokers: st.vaults().iter().map(|v| v.id).filter(|&a| st.may_revoke(a, cp)).collect(),
            entries: st.entries().iter().filter(reaches).map(|en| en.id).collect(),
        }
    };
    let shares = st.shares().iter().filter(|cp| st.live(cp.id)).map(share).collect();
    let devices: Vec<(SignerId, VaultId)> =
        st.vaults().iter().flat_map(|v| v.devices.iter().map(move |&d| (d, v.id))).collect();
    let mut audiences: Vec<AudienceView> = vec![];
    for en in st.entries() {
        let (v, x) = (en.vault, en.audience());
        if let Some(c) = audiences.iter_mut().find(|c| c.id == x) {
            c.entries.push(en.id);
            continue;
        }
        let k = KeyFam::Audience(v, x);
        audiences.push(AudienceView {
            id: x,
            vault: v,
            shares: st.audience_shares(x).unwrap_or_default().to_vec(),
            epoch: st.epoch(k),
            entries: vec![en.id],
            readers: st.readers(k),
            public: st.public_key(k),
            syncs: syncing(st, &devices, v, x),
        });
    }
    let entries = st.entries().iter().map(|en| entry(lab, me, en)).collect();
    let (owns_aven, backs_up) = (owns_aven(lab, me), backs_up(lab, me));
    let synced_to = SyncedTo::default();
    Some(World { mine, recovery: lab.recovery(), owns_aven, backs_up, vaults, shares, audiences, entries, synced_to })
}

/// As which vault device `me`, of vault `mine`, has its person act in vault `v`, and what that vault may there: the
/// vault itself where the device acts for it, directly or through owners (`State::via`); else, of the vaults it acts
/// for, the one a live share over `v` names with the strongest level, its own vault first of equals, the first issued
/// of others (no share to everyone, no keep share); else its own vault. It reaches some of `v` where it is `v`, a live
/// share over `v` but a keep share names it or everyone, or it reads an entry of `v` (`levels`), or one is public. It
/// shares some of `v` on where it is `v` or holds a live owner share over it, as a share it issues rests on one
/// (`parent`).
pub fn acting(st: &State, me: SignerId, mine: VaultId, v: VaultId) -> Acting {
    let live = |cp: &&Issued| st.live(cp.id) && !cp.share.level.is_keep();
    let actor = match st.via(me, v) {
        Some(_) => v,
        None => {
            let mut best: Option<((u8, bool), VaultId)> = None;
            for cp in st.shares_over(v).filter(live) {
                let Who::Vault(g) = cp.share.who else { continue };
                let rank = (cp.share.level.rank(), g == mine);
                if st.acts_for(me, g) && best.is_none_or(|(r, _)| rank > r) {
                    best = Some((rank, g));
                }
            }
            best.map_or(mine, |(_, g)| g)
        }
    };
    let named = |cp: &Issued| cp.share.who == Who::Vault(actor) || cp.share.who == Who::Everyone;
    let reads = |en: &&Entry| {
        let x = en.audience();
        let reader = |&(g, r): &(VaultId, Level)| g == actor && r.allows(Level::Read);
        st.public_key(KeyFam::Audience(v, x)) || levels(st, v, x).iter().any(reader)
    };
    let reaches = actor == v
        || st.shares_over(v).filter(live).any(named)
        || st.entries().iter().filter(|en| en.vault == v).any(|en| reads(&en));
    let shares = actor == v || st.shares_over(v).any(|cp| st.holds(actor, cp, Level::Owner));
    Acting { actor, reaches, shares }
}

/// Schema or lens entry `entry` of type `ty` as device `me` reads it: a schema's title, or a lens's name, from its
/// JSON. `None` for any other entry, or one whose creation `me` doesn't open (`Lab::lane_entry`).
fn lane(lab: &Lab, me: SignerId, entry: EntryId, ty: Option<&str>) -> Option<What> {
    let blob = lab.lane_entry(me, entry)?;
    let lens = ty == Some(LENS_TYPE);
    let title = if lens {
        Lens::parse(blob).map(|l| l.title().to_string())
    } else {
        Schema::parse(blob).map(|s| s.title().to_string())
    };
    Some(What::Lane { title: title.unwrap_or_default(), lens })
}

/// Entry `en` as device `me` shows it.
fn entry(lab: &Lab, me: SignerId, en: &Entry) -> EntryView {
    let meaning = lab.meaning(me, en.id);
    let file = meaning.as_ref().is_some_and(|m| m.attrs.ty.as_str() == FILE);
    let what = match lab.item(me, en.id) {
        None => lane(lab, me, en.id, meaning.as_ref().map(|m| m.attrs.ty.as_str())).unwrap_or(What::Sealed),
        Some(item) => match (item.as_document(), item.as_todo()) {
            (Some(doc), _) if file => {
                let media = doc.tags.iter().find_map(|t| t.strip_prefix(MEDIA)).unwrap_or_default().to_string();
                let deleted = doc.tags.iter().any(|t| t == DELETED);
                What::File { title: doc.title.clone(), media, deleted }
            }
            (Some(doc), _) => {
                let text = doc.blocks.iter().find(|b| b.id == 2).map(|b| b.text.clone()).unwrap_or_default();
                let history = lab.history(me, en.id);
                let edits = history.map_or(0, |h| h.changes().len());
                let proposals = history.map_or(0, |h| h.lines().len().saturating_sub(1));
                let deleted = doc.tags.iter().any(|t| t == DELETED);
                What::Note { title: doc.title.clone(), text, variant_of: variant_of(&doc), deleted, edits, proposals }
            }
            (None, Some(todo)) => What::Todo { title: todo.title, status: todo.status },
            (None, None) => What::Sealed,
        },
    };
    let st = lab.state(me);
    let (ty, tags, created) = match &meaning {
        Some(m) => {
            let tags = m.attrs.tags.iter().map(|t| t.0.clone()).collect();
            (Some(m.attrs.ty.0.clone()), Some(tags), Some(m.attrs.created))
        }
        None => (None, None, None),
    };
    let (v, x) = (en.vault, en.audience());
    EntryView {
        entry: en.id,
        vault: v,
        by: en.creator,
        ty,
        tags,
        created,
        audience: x,
        public: st.public_key(KeyFam::Audience(v, x)),
        levels: levels(st, v, x),
        files: lab.entry_files(me, en.id),
        what,
    }
}

/// The note a document is a variant of, by its mark (`VARIANT`), if it is one.
fn variant_of(doc: &DocV2) -> Option<EntryId> {
    let of = doc.tags.iter().find_map(|t| t.strip_prefix(VARIANT)).and_then(BlobId::from_hex);
    of.map(|b| EntryId(b.0))
}

/// Share `share` is one of the shares of audience `x`.
pub fn in_audience(st: &State, x: AudienceId, share: ShareId) -> bool {
    st.audience_shares(x).is_some_and(|shares| shares.contains(&share))
}

/// The shares in force that reach audience `x` of vault `v`: over the vault, and on the whole of it or among the
/// audience's.
fn reaching(st: &State, v: VaultId, x: AudienceId) -> impl Iterator<Item = &Issued> {
    st.shares_over(v).filter(move |cp| st.live(cp.id) && (cp.share.wide || in_audience(st, x, cp.id)))
}

/// The strongest level each vault holds on audience `x` of vault `v`: the vault itself owner, and each vault a share in
/// force that reaches the audience names, the strongest of those shares.
pub fn levels(st: &State, v: VaultId, x: AudienceId) -> Vec<(VaultId, Level)> {
    let mut levels = vec![(v, Level::Owner)];
    for cp in reaching(st, v, x) {
        let Who::Vault(g) = cp.share.who else { continue };
        match levels.iter_mut().find(|(a, _)| *a == g) {
            Some((_, r)) if cp.share.level.rank() > r.rank() => *r = cp.share.level,
            Some(_) => {}
            None => levels.push((g, cp.share.level)),
        }
    }
    levels
}

/// The devices `devices` (each with its own vault) that receive the edits of audience `x` of vault `v`, as a peer sends
/// them (`sync`): those acting for the vault, or for a vault a share with backup or more that reaches the audience
/// names (a relay share receives none of them), or every device, through its own vault, if a share to everyone reaches
/// it.
fn syncing(st: &State, devices: &[(SignerId, VaultId)], v: VaultId, x: AudienceId) -> Vec<Syncing> {
    let shares: Vec<&Issued> = reaching(st, v, x).collect();
    let public = shares.iter().any(|cp| cp.share.who == Who::Everyone);
    let through = |d: SignerId, own: VaultId| {
        let mut best: Option<(Level, VaultId)> = st.acts_for(d, v).then_some((Level::Owner, v));
        for cp in &shares {
            let Who::Vault(g) = cp.share.who else { continue };
            let stronger = best.is_none_or(|(r, _)| cp.share.level.rank() > r.rank());
            if cp.share.level.allows(Level::Backup) && st.acts_for(d, g) && stronger {
                best = Some((cp.share.level, g));
            }
        }
        best.or(public.then_some((Level::Read, own)))
    };
    let k = KeyFam::Audience(v, x);
    let sync = |&(d, own): &(SignerId, VaultId)| {
        let (level, through) = through(d, own)?;
        Some(Syncing { device: d, through, level, opens: st.entitled(d, k) })
    };
    devices.iter().filter_map(sync).collect()
}

/// Entry `e` is of type `ty`, as device `me` reads its header.
fn typed(lab: &Lab, me: SignerId, e: EntryId, ty: &str) -> bool {
    lab.meaning(me, e).is_some_and(|m| m.attrs.ty.as_str() == ty)
}

/// A document titled `title`, made on device `device`: a card's, a profile's or a file's record.
pub fn named(title: &str, device: SignerId) -> Item {
    Item::document(title, device)
}

/// The cards of vault `vault` as device `me` reads them, by the device that wrote each, the author of its entry's first
/// write: its entry and the name it reads. A device's first card counts, should it hold two.
pub fn cards(lab: &Lab, me: SignerId, vault: VaultId) -> BTreeMap<SignerId, (EntryId, String)> {
    let st = lab.state(me);
    let mut cards = BTreeMap::new();
    for en in st.entries().iter().filter(|en| en.vault == vault && en.creator == vault) {
        let author = st.write(en.creation).map(|w| w.author);
        let doc = || lab.item(me, en.id).and_then(Item::as_document);
        if let Some(author) = author.filter(|_| typed(lab, me, en.id, CARD))
            && let Some(doc) = doc()
        {
            cards.entry(author).or_insert((en.id, doc.title));
        }
    }
    cards
}

/// Vault `vault`'s profile as device `me` reads it: its first entry of type `PROFILE` that it wrote itself, and the
/// name it reads.
pub fn profile_of(lab: &Lab, me: SignerId, vault: VaultId) -> Option<(EntryId, String)> {
    let st = lab.state(me);
    let profiles = st.entries().iter().filter(|en| en.vault == vault && en.creator == vault);
    profiles.filter(|en| typed(lab, me, en.id, PROFILE)).find_map(|en| {
        let doc = lab.item(me, en.id)?.as_document()?;
        Some((en.id, doc.title))
    })
}

/// The vaults a person's claim of avenDB's server founds beside their human vault (`avendb_net`'s `Node::found_with`,
/// `Node::claim_with`), each owned by the one before alone, the first by the human vault: Maia Holding GmbH and
/// avenCEO GmbH, two coops, and the CEO Aven, the aven vault the server becomes a device of.
pub const SEED: [Kind; 3] = [Kind::Coop, Kind::Coop, Kind::Aven];

/// Whether vault `aven` ends a seed founded from vault `mine`, by view `st` (`SEED`): its kind, its owner's and its
/// owner's owner's are the seed's, each owned by the one before alone, the first by `mine`.
pub fn seeded(st: &State, mine: VaultId, aven: VaultId) -> bool {
    let mut at = aven;
    for kind in SEED.iter().rev() {
        let Some(v) = st.vault(at).filter(|v| v.kind == *kind) else { return false };
        let [Principal::Vault(owner)] = v.owners[..] else { return false };
        at = owner;
    }
    at == mine
}

/// Whether device `me`'s vault owns avenCEO, directly or through owners of owners, by its view: an aven vault with a
/// device, the server, as once its person's vault claimed the server and founded the CEO Aven (`SEED`).
pub fn owns_aven(lab: &Lab, me: SignerId) -> bool {
    let Some(mine) = lab.vault_of(me) else { return false };
    let st = lab.state(me);
    st.vaults().iter().any(|v| v.kind == Kind::Aven && !v.devices.is_empty() && st.owns(mine, v.id))
}

/// Whether avenDB's server keeps a backup of device `me`'s person's vault: avenCEO holds backup on the whole of it
/// (`server_level`). `None` while it knows no avenCEO.
pub fn backs_up(lab: &Lab, me: SignerId) -> Option<bool> {
    let mine = lab.vault_of(me)?;
    let st = lab.state(me);
    Some(server_level(st, mine, avenceo(st, mine)?) == Level::Backup)
}

/// avenCEO by this view: the aven vault with a device, the server, that vault `mine` gives relay on the whole of it, as
/// its person's first device did as it founded it.
pub fn avenceo(st: &State, mine: VaultId) -> Option<VaultId> {
    let server = |v: &&Vault| v.kind == Kind::Aven && !v.devices.is_empty() && relays(st, mine, v.id);
    st.vaults().iter().find(server).map(|v| v.id)
}

/// Vault `to` holds a share in force on the whole of vault `over`, relay or more.
pub fn relays(st: &State, over: VaultId, to: VaultId) -> bool {
    st.shares_over(over).any(|cp| cp.share.wide && st.holds(to, cp, Level::Relay))
}

/// What the server's vault `avenceo` holds on the whole of vault `mine`: backup, if any share in force there gives it
/// backup or more, else relay alone. The vaults `mine` owns give the server the same.
pub fn server_level(st: &State, mine: VaultId, avenceo: VaultId) -> Level {
    let backs_up = st.shares_over(mine).any(|cp| cp.share.wide && st.holds(avenceo, cp, Level::Backup));
    if backs_up { Level::Backup } else { Level::Relay }
}

/// The owner share vault `issuer`'s right to share a slice of vault `over` rests on: none if it is the vault itself,
/// else one in force over the vault that it holds, a share on the whole vault first, and only such a one if the new
/// share is on the whole vault (`wide`), as a share on the whole vault rests only on another.
pub fn parent(st: &State, issuer: VaultId, over: VaultId, wide: bool) -> Option<ShareId> {
    if issuer == over {
        return None;
    }
    let owner = |cp: &&Issued| cp.share.over == over && st.holds(issuer, cp, Level::Owner) && (cp.share.wide || !wide);
    let mut held: Vec<&Issued> = st.shares_held(issuer).filter(owner).collect();
    held.sort_by_key(|cp| !cp.share.wide);
    held.first().map(|cp| cp.id)
}
