//! Provenance (H2 of maiaCITY's hardening plan): which code is a vault's, proven on the device that runs it, never
//! taken on a server's word. A page and maiaCITY's API load the views, logic, configs and recipes of Maia City's vault,
//! and whoever serves them, avenDB's server or the network between, could hand out any rows it liked; so they take
//! none but what this module proves.
//!
//! - **What proves it** (`proof`): the signed edits a stranger may receive of the vault's public code, as a device that
//!   acts for no vault and follows the vault is sent them (`sync::answer`, T12), and of those only the logs of the code
//!   entries asked for, of the vault's own schemas and lenses their records read through, of the cap groups their
//!   shares name, the audiences they stayed in, the shares that pick them, are wide over the vault or say what they
//!   want, and the vaults all that names, up their owners. Nothing a stranger may not receive, so no key and nothing
//!   private: the keys it opens with are those an Everyone share publishes in the clear. The server hands it out as
//!   one `wire::Reply` (avendb-server's `feed`), each edit after its past, with no McEliece key, which nobody needs to
//!   read what is public.
//! - **What checks it** (`Observer`): a device of no vault takes those edits as every device takes a sync reply
//!   (`Lab::receive`): every signature checked, the rules replayed, a write counted only where its chain allows it,
//!   what is public opened with the keys published for it. It reads back the rows the feed serves
//!   (`world::public_entries`) of the one vault it is anchored to, by that vault's id, never by its name, which anyone
//!   may give a vault; and it holds a file to the file a write it counts brought (`Observer::holds`).
//!
//! So a row the server makes up, or changes, or a write the vault never signed, or one by someone its shares don't let
//! write there, is in no row the observer reads: a forged edit fails its signature, and the rest count for no reader.
//! What the server still decides is which of the vault's signed edits it hands out: it can leave out a newer version
//! of an entry, which the observer then doesn't see yet, or an entry, which it then reads nowhere; it can't hand out
//! anything the vault's signers didn't sign, nor make a write count that the vault's rules refuse.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde_json::Value;

use crate::id::{AudienceId, EditId, EntryId, ShareId, SignerId, VaultId};
use crate::keys::KeyFam;
use crate::lab::Lab;
use crate::policy::{Edit, Entry, State};
use crate::sealed::{seal, FileRoot};
use crate::sign::Signed;
use crate::sync::{self, LogId};
use crate::wire::{Reply, Wire as _, WireError};
use crate::world;

/// The device a proof is worked out for: one that acts for no vault, a stranger's, so it is sent only what a vault
/// shares with everyone, and of that only what it follows (T12). No key hashes to it, so no vault holds it.
pub const STRANGER: SignerId = SignerId([0; 32]);

/// The kinds of code a proof proves, as the feed names them (`world::CODE_KINDS`).
pub use crate::world::CODE_KINDS;

/// The edits that prove code entries `code` of vault `vault` to a stranger, as device `me` holds them, each after its
/// past (`sync::place`), as a reply sends them: of what a stranger that follows `vault` may receive (`sync::answer`),
/// the logs of those entries, of the vault's schema and lens entries its records read through (`Lab::lane_entry`),
/// and of the cap groups the shares below name, which judge the writes through them (CG1); of the audiences any of
/// them stayed in; of the shares over the vault that pick them, are wide over it or name them among their wants, and
/// every share those rest on; and of every vault all that names, up its owners. An entry of `code` that isn't the
/// vault's, or that a stranger may not receive, is left out, as is everything else the vault holds: its other public
/// entries, its stories and its files among them.
///
/// An audience's key is published as the first entry stays in it (`State::published`), and its `Keys` edit, which
/// hands the key out in the clear, counts only after that. So for each audience those entries stayed in, the proof
/// holds the log of the entry that stayed in it first, up to that stay (`opener`), though that entry wasn't asked for:
/// its rows are of no use to the reader, which reads those of `code`. An audience whose key moved on emptied and took
/// entries again; only the logs of every entry that stayed in it replay that, so then they all are held.
pub fn proof(lab: &Lab, me: SignerId, vault: VaultId, code: &BTreeSet<EntryId>) -> Vec<Signed> {
    let log = lab.log(me);
    let (edits, ids, st) = (log.edits(), log.ids(), lab.state(me));
    let places = sync::answer(edits, st, STRANGER, &[vault]);
    let logs = sync::logs_of(edits, ids);
    let at: HashMap<EditId, usize> = places.iter().map(|&i| (ids[i], i)).collect();
    let theirs = |en: &&Entry| en.vault == vault;
    let asked = code.iter().copied().filter(|&e| st.entry(e).is_some_and(|en| theirs(&en)));
    let mut entries: HashSet<EntryId> = asked.collect();
    entries.extend(st.entries().iter().filter(theirs).filter(|en| lab.lane_entry(me, en.id).is_some()).map(|en| en.id));
    // the entries held up to one edit alone: each the first to stay in an audience the others stayed in
    let mut upto: HashMap<EntryId, usize> = HashMap::new();
    let first = Stays { st, edits, at: &at };
    // the audiences and shares those entries need, the cap groups those shares name, which are entries in turn, and
    // the entries that opened those audiences
    let (audiences, shares) = loop {
        let (audiences, shares) = needs(st, vault, &entries, &first.held(&upto));
        let groups = shares.iter().filter_map(|&c| st.share(c)?.share.group);
        let moved = audiences.iter().filter(|&&(v, x)| st.epoch(KeyFam::Audience(v, x)) > 0);
        let stayed = moved.flat_map(|&(v, x)| first.stayed(v, x));
        let more: Vec<EntryId> = groups.chain(stayed).filter(|e| !entries.contains(e)).collect();
        let later = |e: EntryId, i: usize| upto.get(&e).is_none_or(|&j| first.place(j) < first.place(i));
        let opened = audiences.iter().filter_map(|&(v, x)| first.opener(v, x));
        let opened: Vec<(EntryId, usize)> = opened.filter(|&(e, i)| !entries.contains(&e) && later(e, i)).collect();
        if more.is_empty() && opened.is_empty() {
            break (audiences, shares);
        }
        entries.extend(more);
        upto.extend(opened);
    };
    let keeps = |i: usize| match logs[i] {
        Some(LogId::Entry(e)) => {
            entries.contains(&e) || upto.get(&e).is_some_and(|&j| first.place(i) <= first.place(j))
        }
        Some(LogId::Audience(v, x)) => audiences.contains(&(v, x)),
        Some(LogId::Share(c)) => shares.contains(&c),
        Some(LogId::Vault(_)) | None => false,
    };
    let items: Vec<usize> = places.iter().copied().filter(|&i| keeps(i)).collect();
    let named = std::iter::once(vault).chain(items.iter().flat_map(|&i| sync::vaults_named(&edits[i])));
    let vaults: HashSet<VaultId> = sync::close_vaults(st, named.collect()).into_iter().collect();
    let of_vaults = places.iter().copied().filter(|&i| matches!(logs[i], Some(LogId::Vault(v)) if vaults.contains(&v)));
    let mut kept: Vec<usize> = items.iter().copied().chain(of_vaults).collect();
    kept.sort_by_key(|&i| sync::place(&edits[i]));
    kept.dedup();
    kept.into_iter().filter_map(|i| lab.signed_edit(me, ids[i]).cloned()).collect()
}

/// The stays of a vault's entries, by view `st` of `edits`, as far as a stranger may receive the edits that began them
/// (`at`, each edit's place in `edits`).
struct Stays<'a> {
    st: &'a State,
    edits: &'a [Edit],
    at: &'a HashMap<EditId, usize>,
}

impl Stays<'_> {
    fn place(&self, i: usize) -> sync::Place {
        sync::place(&self.edits[i])
    }

    /// Where in `edits` stay `s` of entry `en` began: at its mark, or at its creation.
    fn began(&self, en: &Entry, s: Option<EditId>) -> Option<usize> {
        self.at.get(&s.unwrap_or(en.creation)).copied()
    }

    /// The entry that stayed in audience `x` of vault `v` first, and the edit it began that stay by.
    fn opener(&self, v: VaultId, x: AudienceId) -> Option<(EntryId, usize)> {
        let ens = self.st.entries().iter().filter(|en| en.vault == v);
        let stays = ens.flat_map(|en| en.stays.iter().filter(|s| s.1 == x).map(move |s| (en, s.0)));
        let began = stays.filter_map(|(en, s)| Some((en.id, self.began(en, s)?)));
        began.min_by_key(|&(_, i)| self.place(i))
    }

    /// Every entry of vault `v` that stayed in its audience `x`.
    fn stayed(&self, v: VaultId, x: AudienceId) -> impl Iterator<Item = EntryId> + '_ {
        let ens = self.st.entries().iter().filter(move |en| en.vault == v);
        ens.filter(move |en| en.stays.iter().any(|s| s.1 == x)).map(|en| en.id)
    }

    /// The stays of the entries held up to an edit alone (`upto`), as far as that edit.
    fn held(&self, upto: &HashMap<EntryId, usize>) -> Vec<(EntryId, VaultId, AudienceId)> {
        let mut held = vec![];
        for (&e, &j) in upto {
            let Some(en) = self.st.entry(e) else { continue };
            let within = |&&(s, _): &&(Option<EditId>, AudienceId)| {
                self.began(en, s).is_some_and(|i| self.place(i) <= self.place(j))
            };
            held.extend(en.stays.iter().filter(within).map(|&(_, x)| (e, en.vault, x)));
        }
        held
    }
}

/// What entries `entries` of vault `vault` need beside their own logs, by view `st`, with the stays `held` of the
/// entries held in part: every audience any of them stayed in, and the shares over the vault that are in one of those
/// audiences, among their wants, or wide, with every share each rests on.
fn needs(
    st: &State,
    vault: VaultId,
    entries: &HashSet<EntryId>,
    held: &[(EntryId, VaultId, AudienceId)],
) -> (HashSet<(VaultId, AudienceId)>, HashSet<ShareId>) {
    let (mut audiences, mut stayed) = (HashSet::new(), HashSet::new());
    let whole = entries.iter().filter_map(|&e| st.entry(e));
    let whole = whole.flat_map(|en| en.stays.iter().map(|&(_, x)| (en.id, en.vault, x)));
    for (e, v, x) in whole.chain(held.iter().copied()) {
        audiences.insert((v, x));
        stayed.extend(st.audience_shares(x).unwrap_or_default().iter().copied());
        stayed.extend(st.wants_of(e).iter().copied());
    }
    let picks = |c: ShareId, wide: bool| wide || stayed.contains(&c);
    let over = st.shares().iter().filter(|cp| cp.share.over == vault && picks(cp.id, cp.share.wide));
    (audiences, over.flat_map(|cp| cp.chain.iter().copied()).collect())
}

/// `proof` as the bytes a server hands out: one `wire::Reply` of its edits, with no McEliece key and nothing more to
/// ask for.
pub fn reply(edits: Vec<Signed>) -> Vec<u8> {
    Reply { edits, blobs: vec![], more: false }.to_wire()
}

/// What names a proof, whatever order its edits come in: the hash of their ids, smallest first. Two proofs of the same
/// edits are named alike, so a reader that checked one keeps what it read for as long as the server hands out that
/// one (its `ETag`).
pub fn frontier(edits: &[Signed]) -> [u8; 32] {
    let ids: BTreeSet<_> = edits.iter().map(|s| s.edit.id()).collect();
    let mut h = crate::hash::Hasher::new("avendb proof of code");
    for id in ids {
        h.update(&id.0);
    }
    h.finalize()
}

/// Why an observer reads nothing of its vault.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unproven {
    /// The bytes it took are no reply.
    Wire(WireError),
    /// What it took proves no vault of its id: its genesis isn't among the edits that stand.
    NoVault,
}

impl std::fmt::Display for Unproven {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Unproven::Wire(e) => write!(f, "what the server handed out is no avenDB reply: {e}"),
            Unproven::NoVault => f.write_str("what the server handed out proves no vault of that id"),
        }
    }
}

impl std::error::Error for Unproven {}

/// A device of no vault that takes the edits a proof hands out, as any device takes a sync reply, and reads back the
/// public code of the one vault it is anchored to: a page's, or maiaCITY's API's, way to know which code is Maia
/// City's. It holds no key but its own, and those an Everyone share publishes in the clear.
pub struct Observer {
    lab: Lab,
    me: SignerId,
    vault: VaultId,
}

impl Observer {
    /// An observer anchored to vault `vault`, by its id: the only vault it reads rows of.
    pub fn new(vault: VaultId) -> Observer {
        let mut lab = Lab::new();
        let me = lab.device("an observer of public code");
        Observer { lab, me, vault }
    }

    /// The vault it is anchored to.
    pub fn vault(&self) -> VaultId {
        self.vault
    }

    /// Take `edits`, as a device takes a reply (`Lab::receive`): each kept only if every signature on it checks out,
    /// and counted only as the rules say. How many were new.
    pub fn take(&mut self, edits: Vec<Signed>) -> usize {
        self.lab.receive(self.me, edits, vec![])
    }

    /// Take the bytes a server handed out, one `wire::Reply` (`reply`): how many edits were new, or why they are no
    /// reply.
    pub fn take_wire(&mut self, bytes: &[u8]) -> Result<usize, Unproven> {
        let reply = Reply::from_wire(bytes).map_err(Unproven::Wire)?;
        Ok(self.take(reply.edits))
    }

    /// The rows of its vault's public code of the kinds `kinds`, as avenDB's server's feed serves them
    /// (`world::public_entries`: each `{entry, vault, type, schema, tags, heads, created, record, files, brought?}`),
    /// read off the edits it took and counts, and nothing else: `seed` is `null` in each, as a stranger knows no seed,
    /// and the anchor stands in for it. `NoVault` while what it took proves no vault of its id.
    pub fn rows(&self, kinds: &[&str]) -> Result<Vec<Value>, Unproven> {
        if self.lab.state(self.me).vault(self.vault).is_none() {
            return Err(Unproven::NoVault);
        }
        let ours = self.vault.to_hex();
        let rows = world::public_entries(&self.lab, self.me, Some(kinds));
        Ok(rows.into_iter().filter(|row| row["vault"].as_str() == Some(&ours)).collect())
    }

    /// Whether `bytes` are the file whose root is `root` that a write it counts brought into a public entry of its
    /// vault, on its main line or a variant's (`Lab::brought`): the file of no more than one piece that the key and
    /// length that write's body holds seal to that root (`sealed::seal`, iroh's BLAKE3 of the sealed bytes). False for
    /// any other bytes, a file no such write brought, or one of several pieces, which no code entry brings.
    pub fn holds(&self, root: &FileRoot, bytes: &[u8]) -> bool {
        let (lab, me) = (&self.lab, self.me);
        let st = lab.state(me);
        let public = |en: &&Entry| {
            en.vault == self.vault && lab.landed(me, en.id) && st.public_key(KeyFam::Audience(en.vault, en.audience()))
        };
        let brings = |en: &Entry| lab.brought(me, en.id).into_iter().flat_map(|(_, _, files)| files);
        let counted = st.entries().iter().filter(public).flat_map(brings).any(|(f, _)| f == *root);
        let Some(file) = lab.file(me, root).filter(|_| counted && !root.pieced()) else { return false };
        file.len == bytes.len() as u64 && *blake3::hash(&seal(&file.key, bytes)).as_bytes() == root.hash
    }

    /// The Lab it takes edits on, and its device there, for what it reads beside its rows.
    pub fn lab(&self) -> (&Lab, SignerId) {
        (&self.lab, self.me)
    }
}

/// The rows a proof's bytes `bytes` prove of vault `vault`'s public code of kinds `kinds` (`Observer::rows`): a fresh
/// observer's, which takes them and reads them back.
pub fn verify(bytes: &[u8], vault: VaultId, kinds: &[&str]) -> Result<Vec<Value>, Unproven> {
    let mut observer = Observer::new(vault);
    observer.take_wire(bytes)?;
    observer.rows(kinds)
}
