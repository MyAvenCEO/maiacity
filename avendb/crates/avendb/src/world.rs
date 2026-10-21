//! A device's world as its page shows it (the ops engine's `world`): every vault it knows, whom it acts for and through
//! which owners, and as which vault its person acts in each (`Acting`); every share in force, with its slice where the
//! device reads it, the group it is, what it reaches and who may revoke it; every audience, the entries the same shares
//! reach under one key, with the devices that sync it and whether each opens it or only relays its ciphertext; and
//! every entry, with its type, its tags, each vault's level on it, who reads, writes and shares it on, and the files
//! its writes bring, each with where it is synced to (`SyncedTo`).
//!
//! Also the entries a device writes itself, by their types: its card in its person's vault (`CARD`), a vault's profile
//! (`PROFILE`), a file it brings (`FILE`), an access request (`REQUEST`); and how avenMAIA, the device vault
//! avenDB's server is a device of, keeps or relays a person's vaults (`avenceo`, `server_level`).

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value, json};

use crate::doc::Item;
use crate::engine;
use crate::history::MAIN;
use crate::id::{AudienceId, EditId, EntryId, ShareId, SignerId, VaultId};
use crate::keys::KeyFam;
use crate::lab::Lab;
use crate::lens::{DocV1, Lane, Lens, Schema, Status, View};
use crate::policy::{Entry, Issued, KeepMode, Kind, Level, Line, Principal, Share, State, Vault, Who};
use crate::rules;
use crate::sealed::{FileRoot, PIECE};
use crate::sign::{ApiPass, SIGNING, SignerKeys};
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

/// The start of the mark a fork carries among its document's own tags, inside its record: a note made from what one
/// line of another shows (the ops engine's `fork`), marked with that note's entry and the version it copied, the
/// hashes of that version's edits, in hex (`fork_mark`). So a fork's history goes on into its original's, up to that
/// version, for whoever reads both; the original's edits stay its own, signed by whoever made them.
pub const FORK: &str = "avendb:fork:";

/// The mark of a fork of entry `entry` made from its version `at`: `avendb:fork:<entry>@<edit>,<edit>`.
pub fn fork_mark(entry: EntryId, at: &[EditId]) -> String {
    let at: Vec<String> = at.iter().map(|e| hex(&e.0)).collect();
    format!("{FORK}{}@{}", hex(&entry.0), at.join(","))
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
/// in the order they were issued; every audience an entry is in; and every entry, in the order they were created. A
/// draft its vault hasn't landed is in none of them (`Lab::landed`): it has no main line yet, and is read on its own
/// line alone (`note`, `history`, the AIPs).
pub struct World {
    /// Its own vault, its person's.
    pub mine: VaultId,
    /// The master recovery key it adds (`Lab::set_recovery`), if any.
    pub recovery: Option<SignerId>,
    /// Each owner of its vaults that is the master recovery key as it was before the key move (`Lab::is_recovery`,
    /// K4): an old, legacy one, listed beside the one it adds, never folded into it.
    pub legacy: BTreeSet<SignerId>,
    /// What kind of signer each owner of its vaults that is one is (`SignerKeys::kind`), of those it saw sign
    /// (`Lab::signers_seen`): the master recovery key, which never signs, among none.
    pub signers: BTreeMap<SignerId, &'static str>,
    /// Each owner key and each device of its vaults the key move kept beside its next key, which is an owner or a
    /// device of the same vault too, with that key (`Lab::earlier_keys`).
    pub earlier: BTreeMap<SignerId, SignerId>,
    /// Each device of its vaults that signs in the suite from before the key move and that no next key was kept beside
    /// (`earlier`), of those it saw sign: a device not unlocked since its person's keys moved, an old one.
    pub unmoved: BTreeSet<SignerId>,
    /// Its vault owns avenMAIA (`owns_server`).
    pub owns_server: bool,
    /// avenMAIA keeps a backup of its vault (`backs_up`).
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

impl ShareView {
    /// Whether its ops let its grantee draft new entries, by its slice as the device reads it (`drafts`): `None` where
    /// it doesn't read it.
    pub fn drafts(&self) -> Option<bool> {
        drafts(self.slice.as_ref()?)
    }
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
    /// Who wrote its main line as it stands (`authors`): its coop's aven, then each human vault whose device signed a
    /// write of it.
    pub authors: Vec<VaultId>,
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
    /// it is a fork of and the version of it it copied, if it is one (`FORK`); whether it is deleted (`DELETED`); how
    /// many edits of it the device counts, how many proposals it has and how many variants; and for a spark or an
    /// article, its record, each field it leaves out at its default: a spark's canvas; an article's story, language
    /// and quote, all but its text, which `text` is.
    Note {
        title: String,
        text: String,
        fork_of: Option<(EntryId, Vec<EditId>)>,
        deleted: bool,
        edits: usize,
        proposals: usize,
        variants: usize,
        record: Option<Value>,
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
    /// vault's owners mark as such, `recovery`, as they mark the one from before the key move, `recovery` and `legacy`
    /// (`legacy`), each other signer among them with its kind, `by` (`signers`: `device`, `passkey` or `touch`, `null`
    /// where the device never saw it sign), and each owner key and device with `next`, its next key where the key move
    /// kept it beside that key (`earlier`), `null` otherwise, the legacy master recovery key never; each device `old`
    /// where it signs as before the key move and never moved (`unmoved`). As the device works it out, so the page keeps
    /// no rule:
    ///
    /// - `ownsServer` and `backsUp` (`owns_server`, `backs_up`, `null` while it knows no avenMAIA);
    /// - each vault's `acting`: `{as, reaches, shares}` (`Acting`);
    /// - each share's `group`, the built-in group whose ops its ops are and whose `everyone` matches its who, or a
    ///   keep share's mode's (`Level::group`), `null` for one of its own or one whose slice the device doesn't read; a
    ///   Suggester's made before drafts still names Suggester; `drafts`, whether its ops let its grantee draft new
    ///   entries (`create` on proposals, or on either line), `null` where the device doesn't read its slice;
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
    /// The next key the key move kept signer `s` beside (`earlier`), in 64 hex digits.
    fn next_of(&self, s: &SignerId) -> Option<String> {
        self.earlier.get(s).map(|n| hex(&n.0))
    }

    pub fn to_json(&self, me: SignerId) -> Value {
        let ids = |xs: &[VaultId]| xs.iter().map(|v| hex(&v.0)).collect::<Vec<_>>();
        let holders = |hs: Option<&Vec<Holder>>| {
            let holder =
                |h: &Holder| json!({ "device": hex(&h.device.0), "has": h.has, "of": h.of, "checked": h.checked });
            hs.into_iter().flatten().map(holder).collect::<Vec<_>>()
        };
        let owner = |p: &Principal| match p {
            Principal::Vault(v) => json!({ "vault": hex(&v.0) }),
            Principal::Signer(s) => {
                let (legacy, by) = (self.legacy.contains(s), self.signers.get(s));
                let recovery = legacy || Some(*s) == self.recovery;
                json!({ "signer": hex(&s.0), "recovery": recovery, "legacy": legacy, "by": by, "next": self.next_of(s) })
            }
        };
        let vault = |v: &VaultView| {
            let device = |d: &SignerId| {
                let copy = v.copies.get(d).map(|&full| if full { "full" } else { "light" });
                let (name, next) = (v.names.get(d), self.next_of(d));
                let old = self.unmoved.contains(d);
                json!({ "id": hex(&d.0), "name": name, "me": *d == me, "copy": copy, "next": next, "old": old })
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
                "capGroup": c.share.group.map(|g| hex(&g.0)),
                "drafts": c.drafts(),
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
            let (fork_of, deleted, edits, (proposals, variants), media) = match &i.what {
                What::Note { fork_of, deleted, edits, proposals, variants, .. } => {
                    (fork_of.as_ref(), *deleted, *edits, (*proposals, *variants), None)
                }
                What::File { deleted, media, .. } => (None, *deleted, 0, (0, 0), Some(media)),
                What::Record { deleted, .. } => (None, *deleted, 0, (0, 0), None),
                _ => (None, false, 0, (0, 0), None),
            };
            let fork_at = fork_of.map(|(_, at)| at.iter().map(|e| hex(&e.0)).collect::<Vec<_>>());
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
                "authors": i.authors.iter().map(|v| hex(&v.0)).collect::<Vec<_>>(),
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
                "forkOf": fork_of.map(|(e, _)| hex(&e.0)),
                "forkAt": fork_at,
                "deleted": deleted,
                "edits": edits,
                "proposals": proposals,
                "variants": variants,
                "media": media,
                "record": match &i.what {
                    What::Record { record, .. } | What::Note { record: Some(record), .. } => record.clone(),
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
/// `everyone` matches its who (`rules::groups`), a Suggester's made before drafts among them
/// (`rules::suggester_before_drafts`), which `drafts` tells apart; for a keep share, its mode's (`Level::group`); none
/// for a group of its own, or where the device doesn't read its slice.
pub fn group_of(share: &Share, slice: Option<&Slice>) -> Option<&'static str> {
    if share.level.is_keep() {
        return Some(share.level.group());
    }
    let ops = &slice?.grant.ops;
    let everyone = share.who == Who::Everyone;
    let same = |g: &rules::Group| g.everyone == everyone && rules::normalize(g.ops.clone()).is_ok_and(|o| o == *ops);
    let before = !everyone && rules::normalize(rules::suggester_before_drafts()).is_ok_and(|o| o == *ops);
    rules::groups().into_iter().find(same).map(|g| g.name).or(before.then_some("Suggester"))
}

/// Whether the ops of a share with slice `slice` let its grantee draft new entries: each grant of its chain creates on
/// proposals, as a Suggester's does since drafts, or on either line, as an Editor's (`rules::Op::Create`). A share is
/// judged by its whole chain, so one resting on a share that drafts nothing drafts nothing either.
pub fn drafts(slice: &Slice) -> Option<bool> {
    Some(slice.grants().iter().all(|g| rules::allows_all(&g.ops, false, &[rules::Touch::Create])))
}

/// Device `me`'s world by its view: `None` while it belongs to no vault. Where its entries and files are synced to it
/// leaves to the node (`SyncedTo`).
pub fn world(lab: &Lab, me: SignerId) -> Option<World> {
    let st = lab.state(me);
    let mine = lab.vault_of(me)?;
    // the entries it shows: every one but a draft its vault hasn't landed, which has no main line yet
    let shown: Vec<&Entry> = st.entries().iter().filter(|en| lab.landed(me, en.id)).collect();
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
            entries: shown.iter().copied().filter(reaches).map(|en| en.id).collect(),
        }
    };
    let shares = st.shares().iter().filter(|cp| st.live(cp.id)).map(share).collect();
    let devices: Vec<(SignerId, VaultId)> =
        st.vaults().iter().flat_map(|v| v.devices.iter().map(move |&d| (d, v.id))).collect();
    let mut audiences: Vec<AudienceView> = vec![];
    for en in &shown {
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
    let entries = shown.iter().map(|en| entry(lab, me, en)).collect();
    let (owns_server, backs_up) = (owns_server(lab, me), backs_up(lab, me));
    let recovery = lab.recovery();
    let signers_of = |v: &Vault| {
        let owners = v.owners.iter().filter_map(|p| if let Principal::Signer(s) = p { Some(*s) } else { None });
        owners.filter(|&s| Some(s) != recovery).collect::<BTreeSet<SignerId>>()
    };
    let owners: BTreeSet<SignerId> = st.vaults().iter().flat_map(signers_of).collect();
    let seen = lab.signers_seen(me, &owners);
    let legacy: BTreeSet<SignerId> = seen.iter().filter(|(_, keys)| lab.is_recovery(keys)).map(|(&s, _)| s).collect();
    let signers = seen.into_iter().filter(|(s, _)| !legacy.contains(s)).map(|(s, keys)| (s, keys.kind())).collect();
    let earlier: BTreeMap<SignerId, SignerId> = st
        .vaults()
        .iter()
        .flat_map(|v| lab.earlier_keys(me, &signers_of(v).into_iter().chain(v.devices.iter().copied()).collect()))
        .filter(|(s, _)| !legacy.contains(s))
        .collect();
    let all: BTreeSet<SignerId> = st.vaults().iter().flat_map(|v| v.devices.iter().copied()).collect();
    let old = |(s, keys): &(SignerId, SignerKeys)| keys.suite() != SIGNING && !earlier.contains_key(s);
    let unmoved = lab.signers_seen(me, &all).into_iter().filter(old).map(|(s, _)| s).collect();
    let synced_to = SyncedTo::default();
    Some(World {
        mine,
        recovery,
        legacy,
        signers,
        earlier,
        unmoved,
        owns_server,
        backs_up,
        vaults,
        shares,
        audiences,
        entries,
        synced_to,
    })
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
                let variants = history.map_or(0, |h| h.variants().len());
                let proposals = history.map_or(0, |h| h.lines().len().saturating_sub(1 + variants));
                let deleted = doc.tags.iter().any(|t| t == DELETED);
                let read = |kind: &str| View::built_in(kind).and_then(|v| item.read(v));
                // an article's text is the entry's text already: its record tells the rest
                let article = || read("article").map(|mut r| (r.as_object_mut().map(|o| o.remove("text")), r).1);
                let record = read("spark").or_else(article);
                let fork_of = fork_of(&doc);
                What::Note { title: doc.title.clone(), text, fork_of, deleted, edits, proposals, variants, record }
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
        authors: lab.history(me, en.id).map_or(vec![], |h| authors(lab, me, en.id, &h.heads(MAIN))),
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

/// The note a document is a fork of and the version of it it copied, by its mark (`fork_mark`), if it is one.
fn fork_of(doc: &DocV1) -> Option<(EntryId, Vec<EditId>)> {
    let mark = doc.tags.iter().find_map(|t| t.strip_prefix(FORK))?;
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
    st.entries().iter().filter(|en| en.creator == en.vault && lab.landed(me, en.id)).filter_map(read).collect()
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
    for en in st.entries().iter().filter(|en| en.vault == vault && en.creator == vault && lab.landed(me, en.id)) {
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
    let profiles = st.entries().iter().filter(|en| en.vault == vault && en.creator == vault && lab.landed(me, en.id));
    profiles.filter(|en| typed(lab, me, en.id, PROFILE)).find_map(|en| {
        Some((en.id, title_of(lab.item(me, en.id)?, PROFILE)?))
    })
}

/// The posts device `me` opens that everyone may read, newest first: each entry of type `POST` whose audience is
/// public and that isn't deleted (`DELETED`), as the Maia Universe stream shows it, `{entry, vault, name, kind,
/// created, title, text, channel, about, published, tags, pictures}`, its vault's name as its profile reads (`null`
/// where it has none) and kind, when it was created, in seconds since 1970, the entry it is about, its `about` or else
/// the story it links (`null` for none),
/// when it says it was published, as its record's own `published` reads, an ISO 8601 date or time passed on as it is
/// (`null` where it says none), its tags as its header reads them, and the names of the files of its vault everyone may
/// read that its text shows (`public_files`). A field its schema doesn't name, as `published` before a post's schema
/// names it, reads as the record stores it. What avenDB's server serves as its feed, of what it keeps (avendb-server's
/// `feed`): a post leaves it once its tag no longer reaches a Public share, as when its article goes back to a draft,
/// and a picture once its own does. A draft its vault hasn't landed is never among them (`Lab::landed`).
pub fn public_posts(lab: &Lab, me: SignerId) -> Vec<Value> {
    let st = lab.state(me);
    let files = public_files(lab, me);
    let mut names: BTreeMap<VaultId, Option<String>> = BTreeMap::new();
    let mut posts = vec![];
    for en in st.entries().iter().filter(|en| lab.landed(me, en.id) && everyone_reads(st, en)) {
        let Some(attrs) = lab.meaning(me, en.id).map(|m| m.attrs).filter(|a| a.ty.as_str() == POST) else { continue };
        let Some(stored) = lab.item(me, en.id).map(|i| i.record()) else { continue };
        let What::Record { title, text, record, deleted: false } = record(stored.clone()) else { continue };
        let name = names.entry(en.vault).or_insert_with(|| profile_of(lab, me, en.vault).map(|(_, name)| name));
        let kind = st.vault(en.vault).map(|v| kind_name(v.kind));
        let field = |k: &str| record.get(k).or(stored.get(k)).and_then(Value::as_str).filter(|v| !v.is_empty());
        // a post of a post type links the story it came from (`story`): the entry it is about
        fn story(l: Option<&Value>) -> Option<&str> {
            l?.get("entry")?.as_str().filter(|v| !v.is_empty())
        }
        let text = text.unwrap_or_default();
        let ours = files.keys().filter(|(v, name)| *v == en.vault && text.contains(name.as_str()));
        let pictures: Vec<&str> = ours.map(|(_, name)| name.as_str()).collect();
        let post = json!({
            "entry": en.id.to_hex(),
            "vault": en.vault.to_hex(),
            "name": name,
            "kind": kind,
            "created": attrs.created,
            "title": title,
            "text": text,
            "channel": field("channel"),
            "about": field("about").or_else(|| story(record.get("story")).or_else(|| story(stored.get("story")))),
            "published": field("published"),
            "tags": attrs.tags.iter().map(|t| t.as_str()).collect::<Vec<_>>(),
            "pictures": pictures,
            "authors": lab.history(me, en.id).map_or(json!([]), |h| authors_json(lab, me, &authors(lab, me, en.id, &h.heads(MAIN)))),
        });
        posts.push((attrs.created, en.id, post));
    }
    posts.sort_by_key(|p| std::cmp::Reverse((p.0, p.1)));
    posts.into_iter().map(|(_, _, post)| post).collect()
}

/// A page of posts `posts`, newest first as `public_posts` lists them: `limit` of them, the newest, or with `after` (an
/// entry, hex) those after its post, none where it isn't among them any more (it was taken off: the page reads the
/// newest again); `{"posts": [...], "more"}`, `more` whether any come after the last. So a page that shows the newest posts first asks for the next ones as its person scrolls, of its own device
/// (avendb's `posts` op) or of avenDB's server (`/feed/posts?limit=…&after=…`), the same pages.
pub fn page_of_posts(posts: Vec<Value>, limit: usize, after: Option<&str>) -> Value {
    let from = match after {
        None => 0,
        Some(a) => posts.iter().position(|p| p["entry"].as_str() == Some(a)).map_or(posts.len(), |i| i + 1),
    };
    let more = posts.len() > from + limit;
    let page: Vec<Value> = posts.into_iter().skip(from).take(limit).collect();
    json!({ "posts": page, "more": more })
}

/// Who wrote version `version` of entry `entry` (its heads), by device `me`'s view (Samuel 2026-10-18: never the coop,
/// always the coop's aven and its human collaborators): the aven of the entry's vault, where that vault is a coop with
/// one (`aven_of`), first; then the vault each write of that version its readers count was signed in, each once, in the
/// order they first wrote, where it is a human vault or an aven: the vault the writing device belongs to, the last of
/// the owners it acted through, or the vault it acted for where it acted directly, as an aven's server does. So a story
/// of Maia City reads "avenMAIA + Samuel + Alice", whoever's devices wrote it, and never names a device vault or a coop.
pub fn authors(lab: &Lab, me: SignerId, entry: EntryId, version: &[EditId]) -> Vec<VaultId> {
    let st = lab.state(me);
    let mut out: Vec<VaultId> = vec![];
    let vault = lab.vault_of_entry(me, entry);
    if let Some(aven) = vault.filter(|&v| st.vault(v).is_some_and(|v| v.kind == Kind::Coop)).and_then(|v| aven_of(st, v)) {
        out.push(aven);
    }
    let Some(history) = lab.history(me, entry) else { return out };
    for c in history.version(version).into_iter().filter(|c| c.counted) {
        let signed = c.write.via.last().copied().unwrap_or(c.write.actor);
        let person = st.vault(signed).is_some_and(|v| matches!(v.kind, Kind::Human | Kind::Aven));
        if person && !out.contains(&signed) {
            out.push(signed);
        }
    }
    out
}

/// Vaults `vaults`, as `authors` lists them, as JSON: each `{vault, name, kind}`, its name as its profile reads (`null`
/// where it has none the device opens).
pub fn authors_json(lab: &Lab, me: SignerId, vaults: &[VaultId]) -> Value {
    let st = lab.state(me);
    let one = |&v: &VaultId| {
        let name = profile_of(lab, me, v).map(|(_, name)| name);
        json!({ "vault": v.to_hex(), "name": name, "kind": st.vault(v).map(|v| kind_name(v.kind)) })
    };
    Value::Array(vaults.iter().map(one).collect())
}

/// The kinds of record that are code: a recipe, a view, a logic and a function, the code entries avenDB ships
/// (`lens::blobs::code_entry!`), and a config, a record of a schema of a vault's own whose kind is `config`, as avenDB
/// ships none. What avenDB's server serves as its code (avendb-server's `feed`), of `public_entries`.
pub const CODE_KINDS: [&str; 5] = ["recipe", "view", "logic", "function", "config"];

/// The entries device `me` opens that everyone may read, of the kinds `kinds` names, or of every kind for none: each
/// entry whose audience is public, as `public_posts` takes them, whose record isn't deleted (`DELETED`), as
/// `public_row` shows it, by its vault, then its kind, then its entry. What avenDB's server serves as its entries and,
/// of `CODE_KINDS`, its code (avendb-server's `feed`), so that a page nobody signed in to, and the API, which holds no
/// device, read a vault's stories and articles and load its views, logic, recipes and configs, each checked again by
/// their own checker against its schema before a sandboxed host runs it. An entry leaves it as its tag no longer
/// reaches a Public share, as a post does. An entry whose record names no kind a schema of its vault's lane reads, a
/// schema's or a lens's, say, is of none.
///
/// Anyone may found a vault, call it Maia City and make its views public, so a row tells the seed's vaults by where
/// they stand in the seed (`seed_of`), never by a name: its `seed` is its vault's name in `SEED_NAMES` where its vault
/// is one of the seed's, `null` for any other. A page that loads code reads Maia City's alone (`SEED_COOP`). A draft
/// its vault hasn't landed is never among them (`Lab::landed`), so no agent's new code runs before the vault took it.
pub fn public_entries(lab: &Lab, me: SignerId, kinds: Option<&[&str]>) -> Vec<Value> {
    public_entries_of(lab, me, None, kinds)
}

/// `public_entries` of vault `vault` alone, or of every vault for none: what a device reads back of one vault's code as
/// avenDB's server serves it (the `code` op, `engine`), the same rows, so a page that holds a device reads its own copy
/// of a vault's code as it would read the feed's.
pub fn public_entries_of(lab: &Lab, me: SignerId, vault: Option<VaultId>, kinds: Option<&[&str]>) -> Vec<Value> {
    let st = lab.state(me);
    let seed: Vec<(VaultId, &str)> = seed_of(lab, me).into_iter().zip(SEED_NAMES).collect();
    let of = |kind: &str| kinds.is_none_or(|ks| ks.contains(&kind));
    let mut vaults = BTreeMap::new();
    let mut rows = vec![];
    let public = |en: &&Entry| vault.is_none_or(|v| en.vault == v) && lab.landed(me, en.id) && everyone_reads(st, en);
    for en in st.entries().iter().filter(public) {
        let Some((kind, false, row)) = public_row(lab, me, en, &seed, &mut vaults, of) else { continue };
        rows.push(((en.vault, kind, en.id), row));
    }
    rows.sort_by(|a, b| a.0.cmp(&b.0));
    rows.into_iter().map(|(_, row)| row).collect()
}

/// Everyone may read entry `en`, by view `st`: a Public share reaches its audience, whose key is everyone's.
fn everyone_reads(st: &State, en: &Entry) -> bool {
    st.public_key(KeyFam::Audience(en.vault, en.audience()))
}

/// Entry `en` as the feed serves it (`public_entries`), where its record is of a kind `of` takes:
/// `{entry, vault, name, seed, type, schema, tags, heads, version, created, record, files}`, its vault's name as its
/// profile reads (`null` where it has none) and as the seed names it (`seed`: its name in `SEED_NAMES`, of the seed's
/// vaults alone), its type the kind of its record, the schema it reads through and the heads of its main line in hex,
/// which release of main they are and how many writes they hold, those before them too (`version`, `{version, edits,
/// writes}`, `History::describe`), its tags
/// as its header reads them, when it was created, in seconds since 1970, its record as device `me` counts it on its
/// main line, the version every reader agrees on, its Loro texts plain text, and the files that line brings that `me`
/// counts as the entry's and opens (`Lab::line_files`), oldest first, each `{root, size, len}`, its root in hex, its
/// sealed size and its plaintext length: the last is its newest, which the feed serves whole as text where the entry is
/// code (avendb-server's `feed`). The record reads through the schema its kind
/// names in its vault's lane, the newest, as the ops engine's `get` reads it (`engine::own`), each field it leaves out
/// at its default: so a view of v1 reads as one of v2, as the schema it names says. With its kind, and whether it is
/// deleted (`DELETED`). None where `me` opens none of it, or no schema reads it. `vaults` holds each vault's lane and
/// name, read once however many of its entries are shown. An entry whose writes bring files more than once, as an
/// asset's versions and variants do, each a record and its file in one write (`Lab::brought`), lists each of them
/// too (`brought`): `{edit, line, version, at, files, record}`, the line whose history holds it (`null` for main's),
/// the version of main it belongs to (`engine::main_version`), the heads a pin of it names (`engine::version_heads`),
/// the files it brings, as `files` lists them, and the record at it, read as the entry's own is: so a reader finds
/// every version of it, and its file by its root, and pins it by the entry's id and those heads. One that brought a
/// file once, on its main line, says the heads a pin of that version names itself (`at`).
fn public_row(
    lab: &Lab,
    me: SignerId,
    en: &Entry,
    seed: &[(VaultId, &str)],
    vaults: &mut BTreeMap<VaultId, (Lane, Option<String>)>,
    of: impl Fn(&str) -> bool,
) -> Option<(String, bool, Value)> {
    let item = lab.item(me, en.id)?;
    let stored = item.record();
    if !of(stored.get("kind")?.as_str()?) {
        return None;
    }
    let (meaning, history) = (lab.meaning(me, en.id)?, lab.history(me, en.id)?);
    let (lane, name) = vaults.entry(en.vault).or_insert_with(|| {
        let name = profile_of(lab, me, en.vault).map(|(_, name)| name);
        (Lane::with_built_ins(lab.lane_of(me, en.vault)), name)
    });
    let app = engine::own(lane, &stored)?;
    let record = lane.view(&app, &item.authored()).0.get(&stored)?;
    let kind = app.kind()?.to_string();
    let tags = record.get("tags").and_then(Value::as_array);
    let deleted = tags.is_some_and(|ts| ts.iter().any(|t| t.as_str() == Some(DELETED)));
    let heads = history.heads(MAIN);
    // which release of main the row is (`engine::described`), and how many writes its version holds, its heads and all
    // before them: a version that comes after another holds every write that one holds and more, so a reader that
    // already proved a newer version of the entry tells an older one handed out after it by its fewer writes, as a
    // server that leaves out an entry's newest writes hands one out (T10l, the spec's `writesAt`; maiaCITY's
    // game/code/fresh.js)
    let mut version = engine::described(history, MAIN, &heads);
    version["writes"] = json!(history.version(&heads).len());
    let mut row = json!({
        "entry": en.id.to_hex(),
        "vault": en.vault.to_hex(),
        "name": name,
        "seed": seed.iter().find(|(v, _)| *v == en.vault).map(|(_, name)| name),
        "type": kind,
        "schema": app.id().to_hex(),
        "tags": meaning.attrs.tags.iter().map(|t| t.as_str()).collect::<Vec<_>>(),
        "heads": heads.iter().map(EditId::to_hex).collect::<Vec<_>>(),
        "version": version,
        "authors": authors_json(lab, me, &authors(lab, me, en.id, &heads)),
        "created": meaning.attrs.created,
        "record": record,
        "files": lab.line_files(me, en.id, MAIN).into_iter().filter_map(file_json).collect::<Vec<_>>(),
    });
    let brought = lab.brought(me, en.id);
    if let [(edit, None, _)] = brought.as_slice() {
        row["at"] = engine::version_heads(history, *edit, None);
    }
    if brought.len() > 1 {
        let version = |(edit, line, files): (EditId, Line, Vec<(FileRoot, Option<u64>)>)| {
            let item = history.item_at(&[edit], me, line);
            let stored = item.record();
            let record = engine::own(lane, &stored).and_then(|app| lane.view(&app, &item.authored()).0.get(&stored));
            json!({
                "edit": edit.to_hex(),
                "line": line.map(|b| b.to_hex()),
                "version": engine::main_version(history, edit, line),
                "at": engine::version_heads(history, edit, line),
                "authors": authors_json(lab, me, &authors(lab, me, en.id, &[edit])),
                "files": files.into_iter().filter_map(file_json).collect::<Vec<_>>(),
                "record": record,
            })
        };
        row["brought"] = brought.into_iter().map(version).collect();
    }
    Some((kind, deleted, row))
}

/// A file an entry everyone reads brings, as its feed's row lists it (`public_row`), where the device opens it: `{root,
/// size, len}`.
fn file_json((root, len): (FileRoot, Option<u64>)) -> Option<Value> {
    Some(json!({ "root": hex(&root.hash), "size": root.size, "len": len? }))
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
/// (`public_posts`), which avenDB's server serves (avendb-server's `feed`). A draft its vault hasn't landed is never
/// among them (`Lab::landed`).
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
    let landed = |en: &&Entry| lab.landed(me, en.id);
    let public = st.entries().iter().filter(landed).filter(|en| of(en) && everyone_reads(st, en));
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

/// The vaults a person's claim of avenDB's server founds under their human vault (`avendb_net`'s `Node::found_with`,
/// `Node::claim_with`), each owned by the one before alone, the first by the human vault: Maia City, the one coop of the
/// seed, where the content lives, and avenMAIA, its one aven, which lives on the server, its device (Samuel 2026-10-18:
/// no holding, no company coop, and the server's vault and the coop's aven one vault).
pub const SEED: [Kind; 2] = [Kind::Coop, Kind::Aven];

/// The names of the seed's vaults, in `SEED`'s order, which their profiles read from the start
/// (`avendb_browser::Device::found`); the page names a seed that has none yet the same (vaults.js's `SEED`).
pub const SEED_NAMES: [&str; 2] = ["Maia City", "avenMAIA"];

/// The seed's coop by its name in `SEED_NAMES`, the first of `SEED`'s chain: Maia City, whose code alone a page loads
/// (`public_entries`' `seed`), whatever another vault calls itself.
pub const SEED_COOP: &str = SEED_NAMES[0];

/// Whether `share` is an invite of the seed's coop, Maia City, that a newcomer may still sign up with, by device `me`'s
/// view: a live share over it to an invite key, which no vault claimed yet (`Lab::invite_card`, docs/ARCHITECTURE.md
/// §5, Invites). So maiaCITY's API, which holds no device, signs up only someone an owner of Maia City invited, by
/// the invite their link brings, which a device signed with no passkey (Samuel 2026-10-19).
pub fn open_invite(lab: &Lab, me: SignerId, share: ShareId) -> bool {
    let Some(&city) = seed_of(lab, me).first() else { return false };
    let st = lab.state(me);
    st.share(share)
        .is_some_and(|cp| cp.share.over == city && matches!(cp.share.who, Who::Invite(_)) && st.live(share))
}

/// What avenDB's server, device `me`, answers a service called `audience` that brings pass `pass`, at `now`, seconds
/// since 1970 by its clock (G3, `Gate.lean`'s `passStanding`): if the pass counts for that service now
/// (`sign::ApiPass::device`), the vault its device is a device of and whether that vault is an admin of the seed's
/// coop, Maia City: Maia City itself, a vault that owns it, or one holding its Admin group (`gate::device_standing`).
/// `None` for a pass that doesn't count, a signer that is no vault's device, or a server whose seed has no coop. So
/// maiaCITY's API, which holds no device, opens its admins' pages by avenDB, with no passkey and no key of its own.
pub fn pass_standing(lab: &Lab, me: SignerId, pass: &ApiPass, audience: &str, now: u64) -> Option<(VaultId, bool)> {
    let &city = seed_of(lab, me).first()?;
    lab.device_standing(me, city, pass.device(audience, now)?)
}

/// The P-256 keys (SEC1 compressed) of the passkeys among vault `v`'s owners, its root among them, each once, as device
/// `me` saw them sign: what avenDB's server tells maiaCITY's API beside a pass's standing when it asks (`/feed/pass`
/// with `passkeys`). The passkey a person signed up to the API with is the one that roots their human vault (one
/// passkey), so the API knows them by that vault, with no sign-in of its own. Public keys alone, never a secret.
pub fn vault_passkeys(lab: &Lab, me: SignerId, v: VaultId) -> Vec<[u8; 33]> {
    let st = lab.state(me);
    let Some(vault) = st.vault(v) else { return vec![] };
    let signer = |p: &Principal| match *p {
        Principal::Signer(s) => Some(s),
        Principal::Vault(_) => None,
    };
    let owners: BTreeSet<SignerId> = vault.owners.iter().filter_map(signer).chain(vault.root).collect();
    let passkey = |keys: SignerKeys| match keys {
        SignerKeys::Passkey { p256, .. } => Some(p256),
        SignerKeys::Device { .. } | SignerKeys::Enclave { .. } => None,
    };
    let keys: BTreeSet<[u8; 33]> = lab.signers_seen(me, &owners).into_values().filter_map(passkey).collect();
    keys.into_iter().collect()
}

/// The service a device's pass names to have avenDB's server list the vaults it knows (G4, `Gate.lean`'s
/// `vaultsAudience`): a name of its own, so a pass made for maiaCITY's API never lists them.
pub const VAULTS_AUDIENCE: &str = "avenDB vaults";

/// What avenDB's server, device `me`, answers pass `pass` asking at `now` for the vaults it knows (G4, `Gate.lean`'s
/// `keptVaults`), as the Vaults app of Maia City's admins lists them: where the pass counts for `VAULTS_AUDIENCE` and
/// its device's vault is an admin of Maia City (`pass_standing`), every vault the server knows, in the order they were
/// founded, each `{id, kind, name, owners, devices, entries, keeps}`: its name where the server reads it, its owners
/// (`{"vault"}` or `{"signer"}`), how many devices act for it, how many of its entries the server holds, and what the
/// server keeps of it, `"backup"` (an encrypted copy of the whole), `"relay"` (it passes its edits on) or `"known"` (it
/// knows the vault alone, from another's edits). `None` for any other pass.
pub fn kept_vaults(lab: &Lab, me: SignerId, pass: &ApiPass, now: u64) -> Option<Vec<Value>> {
    let (_, true) = pass_standing(lab, me, pass, VAULTS_AUDIENCE, now)? else { return None };
    let (st, mine) = (lab.state(me), lab.vault_of(me)?);
    let keeps = |v: VaultId| {
        let wide = |level: Level| st.shares_over(v).any(|cp| cp.share.wide && st.holds(mine, cp, level));
        if v == mine || wide(Level::Backup) { "backup" } else if wide(Level::Relay) { "relay" } else { "known" }
    };
    let mut entries: BTreeMap<VaultId, usize> = BTreeMap::new();
    for en in st.entries() {
        *entries.entry(en.vault).or_default() += 1;
    }
    let row = |v: &Vault| {
        json!({
            "id": hex(&v.id.0),
            "kind": kind_name(v.kind),
            "name": profile_of(lab, me, v.id).map(|(_, name)| name),
            "owners": v.owners.iter().map(|&p| crate::words::principal_json(p)).collect::<Vec<_>>(),
            "devices": v.devices.len(),
            "entries": entries.get(&v.id).copied().unwrap_or(0),
            "keeps": keeps(v.id),
        })
    };
    Some(st.vaults().iter().map(row).collect())
}

/// The seed device `me`'s person's claim of the server founded, by its view, in `SEED_NAMES`' order: Maia City and
/// avenMAIA, its aven, the server's vault (`seeded`); for avenDB's server itself, a device of avenMAIA, the seed that
/// ends in its vault (`seeder`). None if it founded none.
pub fn seed_of(lab: &Lab, me: SignerId) -> Vec<VaultId> {
    let Some(mine) = lab.vault_of(me) else { return vec![] };
    let st = lab.state(me);
    let servers = st.vaults().iter().filter(|v| v.kind == Kind::Aven && !v.devices.is_empty());
    let ours = |server: VaultId| seeded(st, mine, server) || (server == mine && seeder(st, server).is_some());
    let Some(server) = servers.map(|v| v.id).find(|&server| ours(server)) else { return vec![] };
    let mut chain = vec![server];
    while chain.len() < SEED.len() {
        let Some([Principal::Vault(owner)]) = st.vault(chain[0]).map(|v| &v.owners[..]) else { return vec![] };
        chain.insert(0, *owner);
    }
    chain
}

/// Maia City, the coop of the seed that the claim of human vault `person` founded, by view `st`, found walking down
/// from `person` rather than up from the server, as `seed_of` walks: so a view that holds no server's device finds it,
/// as an agent's holds none. A coop `person` owns alone: where the view holds one whose aven is a server (`seeder`), as
/// the person's own devices do, that one; else the first the view holds, by the order the vaults were founded
/// (`State::vaults`), as the seed is founded with the person's vault or as they claim a server, before a coop of their
/// own. Never by its name, which anyone may give a vault. None where `person` owns no coop alone.
pub fn seed_coop(st: &State, person: VaultId) -> Option<VaultId> {
    let owned = |v: &&Vault| v.kind == Kind::Coop && v.owners == [Principal::Vault(person)];
    let coops: Vec<VaultId> = st.vaults().iter().filter(owned).map(|v| v.id).collect();
    let serves = |&coop: &VaultId| aven_of(st, coop).is_some_and(|aven| seeder(st, aven) == Some(person));
    coops.iter().copied().find(serves).or(coops.first().copied())
}

/// The aven of coop `coop`, by view `st`: the one aven it owns alone (`Kind::rules`), its agents' parent. None where
/// it owns none.
pub fn aven_of(st: &State, coop: VaultId) -> Option<VaultId> {
    let ours = |v: &&Vault| v.kind == Kind::Aven && v.owners == [Principal::Vault(coop)];
    st.vaults().iter().find(ours).map(|v| v.id)
}

/// Whether vault `server` ends a seed founded from vault `mine`, by view `st` (`seeder`).
pub fn seeded(st: &State, mine: VaultId, server: VaultId) -> bool {
    seeder(st, server) == Some(mine)
}

/// The human vault whose seed vault `server` ends, by view `st` (`SEED`): its kind and its owner's are the seed's,
/// avenMAIA's and Maia City's, each owned by the one before alone, the first by that human vault. An aven is one to a
/// coop, so no other vault ends such a chain. None for any other vault.
pub fn seeder(st: &State, server: VaultId) -> Option<VaultId> {
    let mut at = server;
    for kind in SEED.iter().rev() {
        let v = st.vault(at).filter(|v| v.kind == *kind)?;
        let [Principal::Vault(owner)] = v.owners[..] else { return None };
        at = owner;
    }
    st.vault(at).is_some_and(|v| v.kind == Kind::Human).then_some(at)
}

/// A server's vault by view `st`, read from the seed: the aven of a seed, avenMAIA, which Maia City owns (`seeder`),
/// with a device, the server. A device vault, a coop's drive's or an aven's agent's, is none.
fn is_server(st: &State, v: &Vault) -> bool {
    v.kind == Kind::Aven && !v.devices.is_empty() && seeder(st, v.id).is_some()
}

/// Whether device `me`'s vault owns avenMAIA, directly or through owners of owners, by its view: a server's
/// vault (`is_server`), as once its person's vault claimed the server and founded its seed (`SEED`).
pub fn owns_server(lab: &Lab, me: SignerId) -> bool {
    let Some(mine) = lab.vault_of(me) else { return false };
    let st = lab.state(me);
    st.vaults().iter().any(|v| is_server(st, v) && st.owns(mine, v.id))
}

/// Whether avenDB's server keeps a backup of device `me`'s person's vault: avenMAIA holds backup on the whole of
/// it (`server_level`). `None` while it knows no avenMAIA.
pub fn backs_up(lab: &Lab, me: SignerId) -> Option<bool> {
    let mine = lab.vault_of(me)?;
    let st = lab.state(me);
    Some(server_level(st, mine, avenceo(st, mine)?) == Level::Backup)
}

/// avenMAIA by this view: a server's vault (`is_server`) that vault `mine` gives relay on the whole of it, as its
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
    parents(st, issuer, over, who, level, wide).first().copied()
}

/// Every share `parent` may pick, in the order it picks them: none if `issuer` is the vault itself.
pub fn parents(st: &State, issuer: VaultId, over: VaultId, who: Who, level: Level, wide: bool) -> Vec<ShareId> {
    if issuer == over {
        return vec![];
    }
    let probe = |cp: &Issued| {
        let parent = Some(cp.id);
        Share { over, who, level, wide, select: vec![], parent, issuer, nonce: 0, group: None }
    };
    let mut held: Vec<&Issued> = st.shares_held(issuer).filter(|cp| st.share_parent_ok(&probe(cp))).collect();
    held.sort_by_key(|cp| (cp.share.level != Level::Owner, !cp.share.wide, std::cmp::Reverse(cp.share.level.rank())));
    held.into_iter().map(|cp| cp.id).collect()
}

/// `parent`, for a new share that gives the ops `ops`: of the shares it may rest on, the first whose chain gives every
/// one of them too, as device `me` reads it (`gives`), so that what the new share gives is in force; else the first,
/// as `parent` picks it. So an aven passes on an AIP author's share resting on its own, rather than on a Suggester's
/// share it holds beside it, which adds no entry. The rules check the share as any; this only picks among those they
/// let it rest on.
pub fn parent_giving(
    lab: &Lab,
    me: SignerId,
    issuer: VaultId,
    over: VaultId,
    who: Who,
    ops: &[rules::Op],
    wide: bool,
) -> Option<ShareId> {
    let held = parents(lab.state(me), issuer, over, who, rules::level_of(ops), wide);
    held.iter().copied().find(|&p| gives(lab, me, p, ops)).or(held.first().copied())
}

/// Whether share `share` gives every op of `ops`, by its slice as device `me` reads it: each share of its chain names
/// each of them, or the op of its kind that reaches anything (any path, any line, any value, any tag), as an Editor's
/// share does. False where `me` reads no slice of it.
pub fn gives(lab: &Lab, me: SignerId, share: ShareId, ops: &[rules::Op]) -> bool {
    use rules::Op;
    let widest = |o: &Op| match o {
        Op::Create { .. } => Op::Create { on: None },
        Op::Set { .. } | Op::SetOwn { .. } => Op::Set { path: vec![], to: None, on: None },
        Op::Insert { .. } => Op::Insert { path: vec![], on: None },
        Op::Remove { .. } => Op::Remove { path: vec![], on: None },
        Op::Move { .. } => Op::Move { path: vec![], on: None },
        Op::Merge { .. } => Op::Merge { on: None, path: vec![] },
        Op::Tag(_) => Op::Tag(None),
        o => o.clone(),
    };
    let names = |grant: &[Op], o: &Op| grant.iter().any(|g| g == o || *g == widest(o));
    lab.slice(me, share)
        .is_some_and(|s| s.grants().iter().all(|g| ops.iter().all(|o| names(&g.ops, o))))
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
/// gives one to their aven and the aven passes one on to its agent; and avenMAIA's, Backup or Relay, which is
/// the person's server setting (`server_level`), so every vault backs up or relays as theirs does. The strongest first,
/// then in the order issued, so a share comes after the one it rests on. Each with its slice's name and ops, or, where
/// the device doesn't read the slice, its level's group's. Of two the same vault issued to the same vault by the same
/// name, the later alone: one issued again as its group grew, as a Suggester's did with drafts (`engine`'s
/// `standing`), stands for the one before it.
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
        out.retain(|s: &Standing| !(s.who == who && s.issuer == issuer && s.name == name && named));
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
