//! A device's world as its page shows it (the ops engine's `world`): every vault it knows, whom it acts for and through
//! which owners, and as which vault its person acts in each (`Acting`); every share in force, with its slice where the
//! device reads it, the group it is, what it reaches and who may revoke it; every audience, the entries the same shares
//! reach under one key, with the devices that sync it and whether each opens it or only relays its ciphertext; and
//! every entry, with its type, its tags, each vault's level on it, who reads, writes and shares it on, and the files
//! its writes bring, each with where it is synced to (`SyncedTo`).
//!
//! Also the entries a device writes itself, by their types: its card in its person's vault (`CARD`), a vault's profile
//! (`PROFILE`), a file it brings (`FILE`), an access request (`REQUEST`); and how avenCEO server, the device vault
//! avenDB's server is a device of, keeps or relays a person's vaults (`avenceo`, `server_level`).

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use crate::doc::Item;
use crate::id::{AudienceId, EditId, EntryId, ShareId, SignerId, VaultId};
use crate::keys::KeyFam;
use crate::lab::Lab;
use crate::lens::{DocV1, Lens, Schema, Status, View};
use crate::policy::{Entry, Issued, KeepMode, Kind, Level, Principal, Share, State, Vault, Who};
use crate::rules;
use crate::sealed::{FileRoot, PIECE};
use crate::slice::{LENS_TYPE, Selector, Slice};
use crate::words::{hex, kind_name, kinds_json, level_name, status_name, who_name};

/// The type of a device's card: an entry of its person's human vault, a record of avenDB's own `card` schema
/// (`lens::CARD_V1`) titled with the device's name, that the device wrote itself (the ops engine's `card`).
pub const CARD: &str = "card";

/// The type of a vault's profile: an entry of the vault, a record of avenDB's own `profile` schema
/// (`lens::PROFILE_V1`) titled with its name, written acting for the vault (the ops engine's `profile`).
pub const PROFILE: &str = "profile";

/// The type of a note: a document, titled, its text in its first paragraph (`cast::document`).
pub const NOTE: &str = "note";

/// The type of a todo.
pub const TODO: &str = "todo";

/// The type of a post on the Maia Universe stream: a record of avenDB's own `post` schema (`lens::POST_V1`), as the
/// content flow's function makes one as an article is published (`public_posts`).
pub const POST: &str = "post";

/// The type of a file: a record of avenDB's own `file` schema (`lens::FILE_V1`), its title the file's name and its
/// `media` the media type the page shows and plays it as, whose next write brings the file, sealed (the ops engine's
/// `put_file`).
pub const FILE: &str = "file";

/// The type of an access request: a record of avenDB's own `request` schema (`lens::REQUEST_V1`) that the asking vault
/// writes in its own vault and shares, that entry alone, with the vault it asks, by a share of the group `ANSWER` (the
/// ops engine's `ask`). So a request is a record and a share, which sync carries like any other, and its answer the
/// share the vault asked gives, if it grants it, and the answer it sets (`requests`). It asks for a share, to co-own
/// the vault asked, or, as an invitation, for the vault asked to co-own the asking one (`Request::adds`): granting one
/// of those two writes the asked vault's part of the edit that adds the owner, which the vault that asked finishes.
pub const REQUEST: &str = "request";

/// The name of the group of ops an access request goes to the vault it asks by (`answering`).
pub const ANSWER: &str = "Answer";

/// The ops an access request goes to the vault it asks by (`ANSWER`): read it, set its `answer`, on its main line, to
/// "granted" or "denied", and its `part`, the asked vault's part of an owner add it grants; nothing else.
pub fn answering() -> Vec<rules::Op> {
    let answers = ["granted", "denied"].map(|a| rules::Scalar::Text(a.into())).to_vec();
    let (answer, part) = (vec![rules::Step::Field("answer".into())], vec![rules::Step::Field("part".into())]);
    let main = Some(rules::On::Main);
    vec![rules::Op::Read, rules::Op::Set { path: answer, to: Some(answers), on: main }, rules::Op::Set {
        path: part,
        to: None,
        on: main,
    }]
}

/// The start of the mark a variant carries among its document's own tags, inside its record: a note made from what
/// one line of another shows (the ops engine's `variant`), marked with that note's entry and the version it copied, the
/// hashes of that version's edits, in hex (`variant_mark`). So a variant's history goes on into its original's, up to
/// that version, for whoever reads both; the original's edits stay its own, signed by whoever made them.
pub const VARIANT: &str = "avendb:variant:";

/// The mark of a variant of entry `entry` made from its version `at`: `avendb:variant:<entry>@<edit>,<edit>`.
pub fn variant_mark(entry: EntryId, at: &[EditId]) -> String {
    let at: Vec<String> = at.iter().map(|e| hex(&e.0)).collect();
    format!("{VARIANT}{}@{}", hex(&entry.0), at.join(","))
}

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
/// frontier covers; of a file, its sealed pieces. It holds all of it when `has` is `of`. `checked`, when the device
/// said so in the statement it signed (H2), seconds since 1970 by its clock: `None` for this device, and for one that
/// said it on a live connection now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Holder {
    pub device: SignerId,
    pub has: u64,
    pub of: u64,
    pub checked: Option<u64>,
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
    /// Its vault owns avenCEO server (`owns_server`).
    pub owns_server: bool,
    /// avenCEO server keeps a backup of its vault (`backs_up`).
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
    /// What each of its devices keeps of every vault it syncs, by its copy setting (`State::copy_of`): a full copy
    /// (`true`) or a light one (`false`), of each that set one.
    pub copies: BTreeMap<SignerId, bool>,
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
/// ciphertext, as avenDB's server does.
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
    /// it is a variant of and the version of it it copied, if it is one (`VARIANT`); whether it is deleted (`DELETED`);
    /// how many edits of it the device counts, and how many proposals it has; and for a spark, its record, each field
    /// it leaves out at its default, for its look, its link, its source, its files and the sparks it gathers.
    Note {
        title: String,
        text: String,
        variant_of: Option<(EntryId, Vec<EditId>)>,
        deleted: bool,
        edits: usize,
        proposals: usize,
        spark: Option<Value>,
    },
    Todo { title: String, status: Status },
    /// A file (`FILE`): its name, its media type, and whether it is deleted (`DELETED`).
    File { title: String, media: String, deleted: bool },
    /// A schema or lens entry (`slice::Sym::of_lane`): a schema's title, or a lens's name.
    Lane { title: String, lens: bool },
    /// Any other record the device opens, of a flow, a function, a post or a schema of a vault's own: its title or
    /// else its name, its text if it has one, the record itself, and whether it is deleted (`DELETED`).
    Record { title: String, text: Option<String>, record: Value, deleted: bool },
    /// What the device holds but can't open.
    Sealed,
}

impl World {
    /// The world as device `me`'s page reads it: ids in 64 hex digits, kinds, levels and statuses by their lowercase
    /// names, a share's slice as the core writes it (`{name, where, ops, above}`, `slice::Slice::to_json`), `null`
    /// where the device doesn't read it, a vault's `via` `null` where the device doesn't act for it, a share's `who`
    /// `"everyone"` for `Who::Everyone` (`words::who_name`), an entry's `type`, `tags` and `created` `null` where the
    /// device doesn't read them and its levels by vault; the built-in groups of ops the page offers when it shares
    /// (`rules::groups`), each with its level; the kind table, what each kind of vault may be owned by and hold
    /// (`kinds`, `words::kinds_json`); and the master recovery key it adds, `recovery`, `null` for none, which a
    /// vault's owners mark as such. As the device works it out, so the page keeps no rule:
    ///
    /// - `ownsServer` and `backsUp` (`owns_server`, `backs_up`, `null` while it knows no avenCEO server);
    /// - each vault's `acting`: `{as, reaches, shares}` (`Acting`);
    /// - each share's `group`, the built-in group whose ops its ops are and whose `everyone` matches its who, or a
    ///   keep share's mode's (`Level::group`), `null` for one of its own or one whose slice the device doesn't read;
    ///   `whole`, whether it is on the whole vault; `reads`, whether its who reads what it reaches; `gets`, whether
    ///   its who's devices receive it, neither for a keep share;
    /// - each entry's `readers`, `writers` and `sharers`: the vaults whose level on it allows read, write, or is owner,
    ///   its own vault first (everyone besides reads it where it is `public`);
    /// - each entry's `files`, every file its writes bring, `len` `null` where the device doesn't open it, with
    ///   `pieces`, how many pieces it is sealed in;
    /// - an entry of kind `record` (`What::Record`: a flow, a function, a post) with its `record`, `null` for others.
    ///
    /// Each entry and each file lists the devices it is synced to, `syncedTo`, smallest first, each
    /// `{device, has, of, checked}` (`Holder`): of an entry, edits of its log; of a file, its pieces; `checked` when
    /// the device said so in its signed statement, `null` for this device and one on a live connection. This device is
    /// among them once its shelf holds some of it.
    pub fn to_json(&self, me: SignerId) -> Value {
        let ids = |xs: &[VaultId]| xs.iter().map(|v| hex(&v.0)).collect::<Vec<_>>();
        let holders = |hs: Option<&Vec<Holder>>| {
            let holder =
                |h: &Holder| json!({ "device": hex(&h.device.0), "has": h.has, "of": h.of, "checked": h.checked });
            hs.into_iter().flatten().map(holder).collect::<Vec<_>>()
        };
        let owner = |p: &Principal| match p {
            Principal::Vault(v) => json!({ "vault": hex(&v.0) }),
            Principal::Signer(s) => json!({ "signer": hex(&s.0), "recovery": Some(*s) == self.recovery }),
        };
        let vault = |v: &VaultView| {
            let device = |d: &SignerId| {
                let copy = v.copies.get(d).map(|&full| if full { "full" } else { "light" });
                json!({ "id": hex(&d.0), "name": v.names.get(d), "me": *d == me, "copy": copy })
            };
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
                "who": who_name(c.share.who),
                "level": level_name(level),
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
            json!({ "device": device, "through": through, "level": level_name(x.level), "opens": x.opens })
        };
        let audience = |c: &AudienceView| {
            json!({
                "id": hex(&c.id.0),
                "vault": hex(&c.vault.0),
                "shares": c.shares.iter().map(|x| hex(&x.0)).collect::<Vec<_>>(),
                "epoch": c.epoch,
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
                What::Record { title, text, .. } => ("record", Some(title), text.as_ref(), None),
                What::Sealed => ("sealed", None, None, None),
            };
            let (variant_of, deleted, edits, proposals, media) = match &i.what {
                What::Note { variant_of, deleted, edits, proposals, .. } => {
                    (variant_of.as_ref(), *deleted, *edits, *proposals, None)
                }
                What::File { deleted, media, .. } => (None, *deleted, 0, 0, Some(media)),
                What::Record { deleted, .. } => (None, *deleted, 0, 0, None),
                _ => (None, false, 0, 0, None),
            };
            let variant_at = variant_of.map(|(_, at)| at.iter().map(|e| hex(&e.0)).collect::<Vec<_>>());
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
                "audience": hex(&i.audience.0),
                "public": i.public,
                "levels": levels,
                "readers": hexes(readers),
                "writers": hexes(writers),
                "sharers": hexes(sharers),
                "kind": kind,
                "title": title,
                "text": text,
                "status": status,
                "variantOf": variant_of.map(|(e, _)| hex(&e.0)),
                "variantAt": variant_at,
                "deleted": deleted,
                "edits": edits,
                "proposals": proposals,
                "media": media,
                "record": match &i.what {
                    What::Record { record, .. } | What::Note { spark: Some(record), .. } => record.clone(),
                    _ => Value::Null,
                },
                "files": i.files.iter().map(file).collect::<Vec<_>>(),
                "syncedTo": holders(synced.entries.get(&i.entry)),
            })
        };
        json!({
            "me": hex(&me.0),
            "mine": hex(&self.mine.0),
            "recovery": self.recovery.map(|r| hex(&r.0)),
            "ownsServer": self.owns_server,
            "backsUp": self.backs_up,
            "vaults": self.vaults.iter().map(vault).collect::<Vec<_>>(),
            "shares": self.shares.iter().map(share).collect::<Vec<_>>(),
            "audiences": self.audiences.iter().map(audience).collect::<Vec<_>>(),
            "entries": self.entries.iter().map(entry).collect::<Vec<_>>(),
            "groups": rules::groups().iter().map(rules::Group::to_json).collect::<Vec<_>>(),
            "kinds": kinds_json(),
        })
    }
}

/// The built-in group share `share` is, as a device reads its slice `slice`: the group whose ops its ops are and whose
/// `everyone` matches its who (`rules::groups`); for a keep share, its mode's (`Level::group`); none for a group of
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
        let copy = |d: &SignerId| {
            let modes: Vec<Option<KeepMode>> = st.copy_of(*d).map(|k| k.share.level.mode()).collect();
            let full = modes.contains(&Some(KeepMode::Whole));
            (full || modes.contains(&Some(KeepMode::Opened))).then_some((*d, full))
        };
        let copies = v.devices.iter().filter_map(copy).collect();
        let (via, acting) = (st.via(me, v.id), acting(st, me, mine, v.id));
        VaultView { vault: v.clone(), name, names, copies, via, acting }
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
    let (owns_server, backs_up) = (owns_server(lab, me), backs_up(lab, me));
    let synced_to = SyncedTo::default();
    Some(World { mine, recovery: lab.recovery(), owns_server, backs_up, vaults, shares, audiences, entries, synced_to })
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
    let what = match lab.item(me, en.id) {
        None => lane(lab, me, en.id, meaning.as_ref().map(|m| m.attrs.ty.as_str())).unwrap_or(What::Sealed),
        Some(item) => match (View::built_in(FILE).and_then(|v| item.read(v)), item.as_markdown(), item.as_todo()) {
            (Some(file), ..) => {
                let text = |k: &str| file.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
                let mut tags = file.get("tags").and_then(Value::as_array).into_iter().flatten();
                let deleted = tags.any(|t| t.as_str() == Some(DELETED));
                What::File { title: text("title"), media: text("media"), deleted }
            }
            (_, Some(doc), _) => {
                let text = doc.blocks.iter().find(|b| b.id == 2).map(|b| b.text.clone()).unwrap_or_default();
                let history = lab.history(me, en.id);
                let edits = history.map_or(0, |h| h.changes().len());
                let proposals = history.map_or(0, |h| h.lines().len().saturating_sub(1));
                let deleted = doc.tags.iter().any(|t| t == DELETED);
                let spark = View::built_in("spark").and_then(|v| item.read(v));
                What::Note { title: doc.title.clone(), text, variant_of: variant_of(&doc), deleted, edits, proposals, spark }
            }
            (_, None, Some(todo)) => What::Todo { title: todo.title, status: todo.status },
            (_, None, None) => record(item.record()),
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

/// Record `record`, of no kind the page knows apart, as the page shows it: through the built-in schema of its kind, each
/// field it leaves out at its default, where it has one (`View::built_in`); sealed where it holds nothing (no write the
/// device counts yet).
fn record(record: Value) -> What {
    let kind = record.get("kind").and_then(Value::as_str);
    let record = kind.and_then(View::built_in).and_then(|v| v.get(&record)).unwrap_or(record);
    let Some(fields) = record.as_object().filter(|r| !r.is_empty()) else { return What::Sealed };
    let text = |k: &str| fields.get(k).and_then(Value::as_str).map(String::from);
    let title = text("title").filter(|t| !t.is_empty()).or_else(|| text("name")).unwrap_or_default();
    let tags = fields.get("tags").and_then(Value::as_array);
    let deleted = tags.is_some_and(|ts| ts.iter().any(|t| t.as_str() == Some(DELETED)));
    What::Record { title, text: text("text"), deleted, record }
}

/// The note a document is a variant of and the version of it it copied, by its mark (`variant_mark`), if it is one.
fn variant_of(doc: &DocV1) -> Option<(EntryId, Vec<EditId>)> {
    let mark = doc.tags.iter().find_map(|t| t.strip_prefix(VARIANT))?;
    let (entry, at) = mark.split_once('@')?;
    let at: Option<Vec<EditId>> = at.split(',').filter(|e| !e.is_empty()).map(EditId::from_hex).collect();
    Some((EntryId::from_hex(entry)?, at?))
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

/// A record of avenDB's own schema of kind `kind` (`View::built_in`), made on device `device`: `fields` and its kind,
/// each other field at its default.
fn own(kind: &str, fields: Value, device: SignerId) -> Item {
    let view = View::built_in(kind).expect("one of avenDB's own kinds");
    let mut value = fields;
    value["kind"] = json!(kind);
    let value = view.schema().read(&value).expect("fields of its kind");
    Item::made(view, &value, device).expect("a record of its kind")
}

/// Device `device`'s card, titled with its name `title`.
pub fn card(title: &str, device: SignerId) -> Item {
    own(CARD, json!({ "title": title }), device)
}

/// A vault's profile, titled with its name `title`, made on device `device`.
pub fn profile(title: &str, device: SignerId) -> Item {
    own(PROFILE, json!({ "title": title }), device)
}

/// A file's record, made on device `device`: its name `title` and media type `media`.
pub fn file(title: &str, media: &str, device: SignerId) -> Item {
    own(FILE, json!({ "title": title, "media": media }), device)
}

/// An access request as a device reads it (`requests`): its entry, the vault that asks, the one it asks, what it asks
/// for (`asks`: "share", "owner" or "invite"), the level (a built-in group's name, Owner for the two others), why, the
/// vaults it asks that level on (none: `to` itself), the answer `to` set, if it did, the part of the owner add `to`
/// signed as it granted it (`part`, base64url; empty for none), and when it was asked, in seconds since 1970.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Request {
    pub entry: EntryId,
    pub from: VaultId,
    pub to: VaultId,
    pub asks: String,
    pub level: String,
    pub why: String,
    pub vaults: Vec<VaultId>,
    pub answer: Option<String>,
    pub part: String,
    pub created: u64,
}

impl Request {
    /// The owner add it asks for: the vault that takes an owner, and the vault that becomes one. To co-own (`"owner"`),
    /// the vault asked takes the one that asks; invited (`"invite"`), the other way round. None for a share.
    pub fn adds(&self) -> Option<(VaultId, VaultId)> {
        match self.asks.as_str() {
            "owner" => Some((self.to, self.from)),
            "invite" => Some((self.from, self.to)),
            _ => None,
        }
    }

    pub fn to_json(&self) -> Value {
        json!({
            "entry": hex(&self.entry.0),
            "from": hex(&self.from.0),
            "to": hex(&self.to.0),
            "asks": self.asks,
            "level": self.level,
            "why": self.why,
            "vaults": self.vaults.iter().map(|v| hex(&v.0)).collect::<Vec<_>>(),
            "answer": self.answer,
            "part": !self.part.is_empty(),
            "created": self.created,
        })
    }
}

/// The access requests device `me` reads, in the order they were made: each entry of type `REQUEST` a vault wrote in
/// itself, read through the `request` schema; one whose vaults aren't vaults' ids is left out.
pub fn requests(lab: &Lab, me: SignerId) -> Vec<Request> {
    let st = lab.state(me);
    let vault = |v: &Value| v.as_str().and_then(VaultId::from_hex);
    let read = |en: &Entry| -> Option<Request> {
        let meaning = lab.meaning(me, en.id).filter(|m| m.attrs.ty.as_str() == REQUEST)?;
        let r = lab.item(me, en.id)?.read(View::built_in(REQUEST)?)?;
        let text = |k: &str| r.get(k).and_then(Value::as_str).map(str::to_string);
        let vaults = r.get("vaults")?.as_array()?.iter().map(vault).collect::<Option<Vec<_>>>()?;
        Some(Request {
            entry: en.id,
            from: en.vault,
            to: vault(r.get("to")?)?,
            asks: text("asks").unwrap_or_else(|| "share".into()),
            level: text("level")?,
            why: text("why").unwrap_or_default(),
            vaults,
            answer: text("answer"),
            part: text("part").unwrap_or_default(),
            created: meaning.attrs.created,
        })
    };
    st.entries().iter().filter(|en| en.creator == en.vault).filter_map(read).collect()
}

/// The title of record `item` of avenDB's own kind `kind`, a card's or a profile's: `None` for another kind.
pub fn title_of(item: &Item, kind: &str) -> Option<String> {
    Some(item.read(View::built_in(kind)?)?.get("title")?.as_str()?.to_string())
}

/// Record `item` of avenDB's own kind `kind` titled `title` from now on. False if it is of another kind.
pub fn retitle(item: &mut Item, kind: &str, title: &str) -> bool {
    let Some(view) = View::built_in(kind) else { return false };
    let Some(mut value) = item.read(view) else { return false };
    value["title"] = json!(title);
    item.write(view, &value)
}

/// The cards of vault `vault` as device `me` reads them, by the device that wrote each, the author of its entry's first
/// write: its entry and the name it reads. A device's first card counts, should it hold two.
pub fn cards(lab: &Lab, me: SignerId, vault: VaultId) -> BTreeMap<SignerId, (EntryId, String)> {
    let st = lab.state(me);
    let mut cards = BTreeMap::new();
    for en in st.entries().iter().filter(|en| en.vault == vault && en.creator == vault) {
        let author = st.write(en.creation).map(|w| w.author);
        let title = || title_of(lab.item(me, en.id)?, CARD);
        if let Some(author) = author.filter(|_| typed(lab, me, en.id, CARD))
            && let Some(title) = title()
        {
            cards.entry(author).or_insert((en.id, title));
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
        Some((en.id, title_of(lab.item(me, en.id)?, PROFILE)?))
    })
}

/// The posts device `me` opens that everyone may read, newest first: each entry of type `POST` whose audience is
/// public and that isn't deleted (`DELETED`), as the Maia Universe stream shows it, `{entry, vault, name, kind,
/// created, title, text, channel, about, pictures}`, its vault's name as its profile reads (`null` where it has none)
/// and kind, when it was created, in seconds since 1970, the entry it is about (`null` for none), and the names of the
/// files of its vault everyone may read that its text shows (`public_files`). What avenDB's server serves as its feed,
/// of what it keeps (avendb-server's `feed`): a post leaves it once its tag no longer reaches a Public share, as when
/// its article goes back to a draft, and a picture once its own does.
pub fn public_posts(lab: &Lab, me: SignerId) -> Vec<Value> {
    let st = lab.state(me);
    let files = public_files(lab, me);
    let mut names: BTreeMap<VaultId, Option<String>> = BTreeMap::new();
    let mut posts = vec![];
    for en in st.entries().iter().filter(|en| st.public_key(KeyFam::Audience(en.vault, en.audience()))) {
        let Some(created) = lab.meaning(me, en.id).filter(|m| m.attrs.ty.as_str() == POST).map(|m| m.attrs.created)
        else {
            continue;
        };
        let Some(What::Record { title, text, record, deleted: false }) = lab.item(me, en.id).map(|i| record(i.record()))
        else {
            continue;
        };
        let name = names.entry(en.vault).or_insert_with(|| profile_of(lab, me, en.vault).map(|(_, name)| name));
        let kind = st.vault(en.vault).map(|v| kind_name(v.kind));
        let field = |k: &str| record.get(k).and_then(Value::as_str).filter(|v| !v.is_empty());
        let text = text.unwrap_or_default();
        let ours = files.keys().filter(|(v, name)| *v == en.vault && text.contains(name.as_str()));
        let pictures: Vec<&str> = ours.map(|(_, name)| name.as_str()).collect();
        let post = json!({
            "entry": en.id.to_hex(),
            "vault": en.vault.to_hex(),
            "name": name,
            "kind": kind,
            "created": created,
            "title": title,
            "text": text,
            "channel": field("channel"),
            "about": field("about"),
            "pictures": pictures,
        });
        posts.push((created, en.id, post));
    }
    posts.sort_by_key(|p| std::cmp::Reverse((p.0, p.1)));
    posts.into_iter().map(|(_, _, post)| post).collect()
}

/// A file everyone may read, as a device opens it (`public_files`): its root, its plaintext length and its media type.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublicFile {
    pub root: FileRoot,
    pub len: u64,
    pub media: String,
}

/// The files device `me` opens that everyone may read, by their vault and their name: each entry of type `FILE` whose
/// audience is public and that isn't deleted (`DELETED`), by the name its record reads, with the first file its writes
/// bring that the device opens; of two of a vault named alike, the first. An article shows a picture of its vault's
/// Library by its name (`<hash>.jpg`), so a public post names the pictures it shows that are among these
/// (`public_posts`), which avenDB's server serves (avendb-server's `feed`).
pub fn public_files(lab: &Lab, me: SignerId) -> BTreeMap<(VaultId, String), PublicFile> {
    files_everyone_reads(lab, me, |_| true)
}

/// The file of vault `vault` named `name` that device `me` opens and everyone may read (`public_files`), if any.
pub fn public_file(lab: &Lab, me: SignerId, vault: VaultId, name: &str) -> Option<PublicFile> {
    files_everyone_reads(lab, me, |en| en.vault == vault).remove(&(vault, name.to_string()))
}

/// `public_files`, of the entries `of` picks.
fn files_everyone_reads(
    lab: &Lab,
    me: SignerId,
    of: impl Fn(&Entry) -> bool,
) -> BTreeMap<(VaultId, String), PublicFile> {
    let st = lab.state(me);
    let mut files = BTreeMap::new();
    let public = st.entries().iter().filter(|en| of(en) && st.public_key(KeyFam::Audience(en.vault, en.audience())));
    for en in public.filter(|en| typed(lab, me, en.id, FILE)) {
        let Some(What::Record { title, record, deleted: false, .. }) = lab.item(me, en.id).map(|i| record(i.record()))
        else {
            continue;
        };
        let media = record.get("media").and_then(Value::as_str).unwrap_or_default().to_string();
        if let Some((root, len)) = lab.entry_files(me, en.id).into_iter().find_map(|(root, len)| Some((root, len?))) {
            files.entry((en.vault, title)).or_insert(PublicFile { root, len, media });
        }
    }
    files
}

/// The vaults a person's claim of avenDB's server founds beside their human vault (`avendb_net`'s `Node::found_with`,
/// `Node::claim_with`), each owned by the one before alone, the first by the human vault: Maia Holding GmbH and
/// avenCEO GmbH, two coops, and avenCEO server, the device vault the server becomes a device of.
pub const SEED: [Kind; 3] = [Kind::Coop, Kind::Coop, Kind::DeviceVault];

/// The coop the same claim founds beside `SEED`'s chain, owned alone by the vault of the chain at this place,
/// avenCEO GmbH: Maia City, where the content lives (Samuel 2026-10-15). Nothing names it in code but the seed.
pub const SEED_COOP_OF: usize = 1;

/// The names of the seed's vaults, in `SEED`'s order and then the coop beside it (`SEED_COOP_OF`), which their
/// profiles read from the start (`avendb_browser::Device::found`); the page names a seed that has none yet the same
/// (vaults.js's `SEED`).
pub const SEED_NAMES: [&str; 4] = ["Maia Holding GmbH", "avenCEO GmbH", "avenCEO server", "Maia City"];

/// The seed device `me`'s person's claim of the server founded, by its view, in `SEED_NAMES`' order: Maia Holding
/// GmbH, avenCEO GmbH, avenCEO server (`seeded`) and Maia City, a coop avenCEO GmbH owns alone, where it founded one.
/// None if it founded none.
pub fn seed_of(lab: &Lab, me: SignerId) -> Vec<VaultId> {
    let Some(mine) = lab.vault_of(me) else { return vec![] };
    let st = lab.state(me);
    let servers = st.vaults().iter().filter(|v| v.kind == Kind::DeviceVault && !v.devices.is_empty());
    let Some(server) = servers.map(|v| v.id).find(|&server| seeded(st, mine, server)) else { return vec![] };
    let mut chain = vec![server];
    while chain.len() < SEED.len() {
        let Some([Principal::Vault(owner)]) = st.vault(chain[0]).map(|v| &v.owners[..]) else { return vec![] };
        chain.insert(0, *owner);
    }
    let of = chain[SEED_COOP_OF];
    let coop = |v: &&Vault| v.kind == Kind::Coop && matches!(v.owners[..], [Principal::Vault(o)] if o == of);
    chain.extend(st.vaults().iter().find(coop).map(|v| v.id));
    chain
}

/// Whether vault `server` ends a seed founded from vault `mine`, by view `st` (`seeder`).
pub fn seeded(st: &State, mine: VaultId, server: VaultId) -> bool {
    seeder(st, server) == Some(mine)
}

/// The human vault whose seed vault `server` ends, by view `st` (`SEED`): its kind, its owner's and its owner's
/// owner's are the seed's, avenCEO server's, avenCEO GmbH's and Maia Holding GmbH's, each owned by the one before
/// alone, the first by that human vault. None for any other vault.
pub fn seeder(st: &State, server: VaultId) -> Option<VaultId> {
    let mut at = server;
    for kind in SEED.iter().rev() {
        let v = st.vault(at).filter(|v| v.kind == *kind)?;
        let [Principal::Vault(owner)] = v.owners[..] else { return None };
        at = owner;
    }
    st.vault(at).is_some_and(|v| v.kind == Kind::Human).then_some(at)
}

/// A server's vault by view `st`, read from the seed: the device vault of a seed, avenCEO server, which avenCEO GmbH
/// owns (`seeder`), with a device, the server. A device vault the shape of no seed's end is none, as a coop's drive's
/// or an aven's agent's.
fn is_server(st: &State, v: &Vault) -> bool {
    v.kind == Kind::DeviceVault && !v.devices.is_empty() && seeder(st, v.id).is_some()
}

/// Whether device `me`'s vault owns avenCEO server, directly or through owners of owners, by its view: a server's
/// vault (`is_server`), as once its person's vault claimed the server and founded its seed (`SEED`).
pub fn owns_server(lab: &Lab, me: SignerId) -> bool {
    let Some(mine) = lab.vault_of(me) else { return false };
    let st = lab.state(me);
    st.vaults().iter().any(|v| is_server(st, v) && st.owns(mine, v.id))
}

/// Whether avenDB's server keeps a backup of device `me`'s person's vault: avenCEO server holds backup on the whole of
/// it (`server_level`). `None` while it knows no avenCEO server.
pub fn backs_up(lab: &Lab, me: SignerId) -> Option<bool> {
    let mine = lab.vault_of(me)?;
    let st = lab.state(me);
    Some(server_level(st, mine, avenceo(st, mine)?) == Level::Backup)
}

/// avenCEO server by this view: a server's vault (`is_server`) that vault `mine` gives relay on the whole of it, as its
/// person's first device did as it founded it.
pub fn avenceo(st: &State, mine: VaultId) -> Option<VaultId> {
    st.vaults().iter().find(|v| is_server(st, v) && relays(st, mine, v.id)).map(|v| v.id)
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

/// The share vault `issuer`'s right to share a slice of vault `over` with `who` at level `level` rests on: none if it
/// is the vault itself, else one in force over the vault that it holds which the one rule lets the new share rest on
/// (`State::share_parent_ok`): an owner share, or, for a share to a vault `issuer` owns, as an aven's to its agent, one
/// at `level` or more; and only one on the whole vault if the new share is (`wide`). An owner share first, then one on
/// the whole vault, then the highest.
pub fn parent(st: &State, issuer: VaultId, over: VaultId, who: Who, level: Level, wide: bool) -> Option<ShareId> {
    if issuer == over {
        return None;
    }
    let probe = |cp: &Issued| Share { over, who, level, wide, select: vec![], parent: Some(cp.id), issuer, nonce: 0 };
    let mut held: Vec<&Issued> = st.shares_held(issuer).filter(|cp| st.share_parent_ok(&probe(cp))).collect();
    held.sort_by_key(|cp| (cp.share.level != Level::Owner, !cp.share.wide, std::cmp::Reverse(cp.share.level.rank())));
    held.first().map(|cp| cp.id)
}

/// What the name of a standing grant starts with, the name of its group following it: a share on the whole of a
/// person's vault, given for "all my vaults, now and later", which every vault founded under that vault from then on
/// gives too (`standing`), and every share that followed it, which carries the same name. The name is the share's own,
/// sealed in its slice beside its ops (`slice::Slice`), so a standing grant is told by what avenDB stores already, and
/// only the person's vault and its grantee read it.
pub const STANDING: &str = "avendb:standing:";

/// The name of a standing grant of group `group`: `avendb:standing:Viewer`.
pub fn standing_name(group: &str) -> String {
    format!("{STANDING}{group}")
}

/// A share named `name` is a standing grant, or followed one.
pub fn is_standing(name: &str) -> bool {
    name.starts_with(STANDING)
}

/// A grant a vault founded under a person follows (`standing`): the share it follows, the vault that holds it and its
/// level, its name and ops, and who issued it, the person's vault itself or a vault it owns passing it on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Standing {
    pub share: ShareId,
    pub who: VaultId,
    pub level: Level,
    pub name: String,
    pub ops: Vec<rules::Op>,
    pub issuer: VaultId,
}

/// The standing grants of vault `mine`, a person's, as device `me` reads them: each share in force on the whole of it
/// to a vault that is named a standing grant (`STANDING`), as "all my vaults, now and later" on the consent screen
/// gives one to their aven and the aven passes one on to its agent; and avenCEO server's, Backup or Relay, which is
/// the person's server setting (`server_level`), so every vault backs up or relays as theirs does. The strongest first,
/// then in the order issued, so a share comes after the one it rests on. Each with its slice's name and ops, or, where
/// the device doesn't read the slice, its level's group's.
pub fn standing(lab: &Lab, me: SignerId, mine: VaultId) -> Vec<Standing> {
    let st = lab.state(me);
    let server = avenceo(st, mine);
    let mut out = vec![];
    for cp in st.shares_over(mine).filter(|cp| cp.share.wide && st.live(cp.id)) {
        let Who::Vault(who) = cp.share.who else { continue };
        let slice = lab.slice(me, cp.id);
        let named = slice.is_some_and(|s| is_standing(&s.name));
        if cp.share.level.is_keep() || !(named || Some(who) == server) {
            continue;
        }
        let (name, ops) = match slice {
            Some(s) => (s.name.clone(), s.grant.ops.clone()),
            None => (cp.share.level.group().to_string(), cp.share.level.ops()),
        };
        let (level, issuer) = (cp.share.level, cp.share.issuer);
        out.push(Standing { share: cp.id, who, level, name, ops, issuer });
    }
    out.sort_by_key(|s| std::cmp::Reverse(s.level.rank()));
    out
}

/// The passkey that approves for vault `v` alone, as `st` reads it: its root; else, where one owner approves a change
/// (its threshold one), its first owner that is a signer, or that of its first owner that is a vault, up the chain.
/// So a person's passkey approves for their vault and for a coop it owns alone. None where it takes more than one.
pub fn approver(st: &State, v: VaultId) -> Option<SignerId> {
    let mut at = v;
    for _ in 0..=st.vaults().len() {
        let vault = st.vault(at)?;
        if let Some(root) = vault.root {
            return Some(root);
        }
        if vault.threshold != 1 {
            return None;
        }
        let signer = vault.owners.iter().find_map(|o| match o {
            Principal::Signer(s) => Some(*s),
            Principal::Vault(_) => None,
        });
        if signer.is_some() {
            return signer;
        }
        at = vault.owners.iter().find_map(|o| match o {
            Principal::Vault(x) => Some(*x),
            Principal::Signer(_) => None,
        })?;
    }
    None
}
