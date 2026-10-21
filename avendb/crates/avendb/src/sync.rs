//! Sync by audiences, entry by entry, as in `avendb/spec/AvenDB/Sync.lean`, and by frontiers, log by log, as in
//! `Logs.lean`. A device asks a peer for what it may receive; the connection proves which device is asking (iroh's
//! endpoint key is the device's ed25519 key, and the device shows the rest of its keys, which hash to its signer id).
//! The peer answers from its own view: the logs of the entries and audiences the device may receive (it acts for their
//! vault, or for the grantee of a live share that reaches their audience, or that share is public and the device has an
//! interest in the vault or follows it), the logs of every share it needs to check those or to know what it syncs (the
//! shares of every audience such an entry was ever in or of its wants, the vault's wide shares, the shares its own
//! vaults issued, hold or are over, and every share those rest on), and the logs of every vault all that names, up
//! their chains of owners. A revocation sits in the log of the share it ends, so a device whose share was revoked hears
//! of it, and knows what it may no longer do. Nothing about any other entry or audience leaves the peer (T12): not its
//! writes, not even its audience. Of the entries a device may receive, it is sent those its keep shares want
//! (`State::wants`, T28): all of a vault it has no keep share over, else those one of its whole or opened keep shares
//! there is wide over or marks (all of them when it has only never ones), but none a never one is wide over or marks;
//! the peer reads the stewards' marks, never a selector (T23). Two devices that answered each other hold the same
//! writes for every entry both sync (T13). Receiving is not reading: a relay share gets the ciphertext and no key.
//!
//! What is public goes only to whoever has an interest in its vault (design §5, option a): a device that acts for the
//! vault, or for a vault holding a live share over it, at any level, or that names the vault in the follow list of its
//! request (`Ask::follow`). Every vault shares its schemas and lenses with everyone, so otherwise anyone who connects
//! would be sent every vault's schema entries and, with them, the log of every vault they name: its owners, devices,
//! threshold and root. A follow list only narrows what everyone may receive to the vaults it names, and brings nothing
//! that isn't public (T12); it is the request's, never state, and naming a vault in it needs no proof.
//!
//! Every edit belongs to one log (`log_of`): a vault's (its governance, its seed's keys), a share's (the share, a keep
//! share too, its revocation, its keys), an audience's (its keys), or an entry's (its writes, marks and keys; a schema
//! or a lens is an entry too). It names as its parents the frontier of its own log as its device held it. So each log
//! is a small history of its own, and two copies of a log compare by their frontiers alone: one hash per log
//! (`digests`), which is what devices gossip. A device asks with its frontier of each log it holds and a few edits
//! further back, the edits 1, 2, 4, 8, … steps back and the oldest, and with the edits it holds outside them (`asks`);
//! the peer sends only what lies beyond the ones it holds (`respond_since`). A peer that is behind holds the whole
//! frontier and sends exactly what the device lacks; one that lacks the device's latest edits still holds one of them
//! close by, and sends back little the device holds. That withholds nothing the device lacks (T19): a device names of a
//! log only edits of the part whose whole past it holds, so an edit whose parent hasn't arrived waits outside, with
//! whatever builds on it, until the gap is filled. A device signs its edits in a log one after another, each building
//! on the last, so two edits of one device in one log where neither builds on the other mean its key signed twice from
//! the same past (`forks`): a cloned device, one restored from an old backup, or a stolen key.
//!
//! A big reply comes a page at a time (P8d), each edit after the edits it builds on (`place`): the device takes each
//! page as it comes and asks on after the last edit it got, until the peer has nothing more.

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::hash::Hasher;
use crate::id::{AudienceId, EditId, EntryId, ShareId, SignerId, VaultId};
use crate::keys::{KeyFam, KeyName};
use crate::policy::{view, Action, Edit, Issued, Level, Principal, Revoking, Sharing, State, Who};
use crate::sealed::FileRoot;

/// A log: a vault's, a share's, an audience's or an entry's.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum LogId {
    Vault(VaultId),
    Share(ShareId),
    Audience(VaultId, AudienceId),
    Entry(EntryId),
}

/// The log of edit `edit`, whose id is `id` (`Edit.log?`): a vault's genesis and settings, its owners and devices given
/// and revoked, and a seed's key go to their vault's; a grant or a keep share, its revocation, its claim and its key to
/// the grant's; an audience's key to the audience's; a write (of a schema or a lens entry too), a mark and an entry's
/// key to the entry's. A signer's own key is never boxed, so a `Keys` edit naming one is of no log. The id names the
/// log only of an edit that starts one, a genesis or a grant. The edit's kind alone says which, so a peer that knows
/// nothing else routes it.
pub fn log_of(edit: &Edit, id: EditId) -> Option<LogId> {
    Some(match &edit.action {
        Action::Genesis { .. } => LogId::Vault(VaultId::from(id)),
        Action::Settings { vault, .. }
        | Action::Share(Sharing::Owner { vault, .. } | Sharing::Device { vault, .. })
        | Action::Revoke(Revoking::Owner { vault, .. } | Revoking::Device { vault, .. }) => LogId::Vault(*vault),
        Action::Share(Sharing::Grant(..)) => LogId::Share(ShareId::from(id)),
        Action::Revoke(Revoking::Grant { share, .. }) | Action::Claim { share, .. } => LogId::Share(*share),
        Action::Write { entry, .. } | Action::Mark { entry, .. } | Action::Wraps { entry, .. } => LogId::Entry(*entry),
        Action::Checkpoint { vault, .. } | Action::Snapshot { vault, .. } => LogId::Vault(*vault),
        Action::Keys { name, .. } => match *name {
            KeyName::Signer(_) => return None,
            KeyName::Scoped(KeyFam::Seed(v), _) => LogId::Vault(v),
            KeyName::Scoped(KeyFam::Share(_, c), _) => LogId::Share(c),
            KeyName::Scoped(KeyFam::Audience(v, x), _) => LogId::Audience(v, x),
            KeyName::Entry(e, ..) => LogId::Entry(e),
        },
    })
}

/// The log of each of `edits` (`ids[i]` being `edits[i]`'s id).
pub(crate) fn logs_of(edits: &[Edit], ids: &[EditId]) -> Vec<Option<LogId>> {
    edits.iter().zip(ids).map(|(edit, &id)| log_of(edit, id)).collect()
}

/// The vaults an edit names (`Edit.vaultsNamed`): what it acts for, through, or about.
pub(crate) fn vaults_named(edit: &Edit) -> Vec<VaultId> {
    match &edit.action {
        Action::Share(Sharing::Grant(c, via)) => {
            let who = match c.who {
                Who::Vault(g) => Some(g),
                _ => None,
            };
            [c.over, c.issuer].into_iter().chain(who).chain(via.iter().copied()).collect()
        }
        Action::Revoke(Revoking::Grant { actor, via, .. }) => {
            std::iter::once(*actor).chain(via.iter().copied()).collect()
        }
        Action::Write { vault, actor, via, .. } => [*vault, *actor].into_iter().chain(via.iter().copied()).collect(),
        Action::Mark { vault, via, .. } | Action::Claim { vault, via, .. } => {
            std::iter::once(*vault).chain(via.iter().copied()).collect()
        }
        _ => vec![],
    }
}

/// What one device, which follows some vaults, may receive by a view, worked out once for the whole of a reply.
struct Reach<'a> {
    st: &'a State,
    d: SignerId,
    /// The vaults the device acts for.
    acts: HashSet<VaultId>,
    /// The vaults whose every audience it may receive: it acts for them, or a live wide share over them (backup or
    /// more) names a vault it acts for, or is public and the device has an interest in the vault or follows it.
    whole: HashSet<VaultId>,
    /// The live shares, backup or more, that aren't wide naming a vault it acts for, or public over a vault it has an
    /// interest in or follows, with the vault each is over: it may receive the audiences they are in.
    granting: HashMap<ShareId, VaultId>,
    /// The shares it may learn about (`reachesShare`).
    shares: HashSet<ShareId>,
}

impl<'a> Reach<'a> {
    fn new(st: &'a State, d: SignerId, follow: &[VaultId]) -> Reach<'a> {
        let acts: HashSet<VaultId> = st.vaults().iter().map(|v| v.id).filter(|&v| st.acts_for(d, v)).collect();
        // its interests (`interested`): the vaults it acts for, and those a live share of any level, relay too, names
        // a vault it acts for over; then those it follows
        let mut interest = acts.clone();
        for cp in st.shares().iter().filter(|cp| st.live(cp.id)) {
            if let Who::Vault(g) = cp.share.who
                && acts.contains(&g)
            {
                interest.insert(cp.share.over);
            }
        }
        interest.extend(follow.iter().copied());
        let names = |cp: &Issued| match cp.share.who {
            Who::Vault(g) => acts.contains(&g),
            Who::Device(_) | Who::Invite(_) => false,
            Who::Everyone => interest.contains(&cp.share.over),
        };
        let mut whole = acts.clone();
        let mut granting = HashMap::new();
        // a relay share lets its holder know the vault's devices, from the vault's log, and nothing of its entries
        let keeps = |cp: &&Issued| cp.share.level.allows(Level::Backup);
        for cp in st.shares().iter().filter(|cp| st.live(cp.id) && names(cp)).filter(keeps) {
            if cp.share.wide {
                whole.insert(cp.share.over);
            } else {
                granting.insert(cp.id, cp.share.over);
            }
        }
        let mut reach = Reach { st, d, acts, whole, granting, shares: HashSet::new() };
        // the shares of every audience an entry it may receive was ever in and the keep shares of its wants, both over
        // the entry's vault, and the vaults of those entries, for their wide shares
        let (mut stayed, mut vaults) = (HashSet::new(), HashSet::new());
        for en in st.entries().iter().filter(|en| reach.audience(en.vault, en.audience())) {
            vaults.insert(en.vault);
            for (_, x) in &en.stays {
                stayed.extend(st.audience_shares(*x).unwrap_or_default().iter().copied());
            }
            stayed.extend(st.wants_of(en.id).iter().copied());
        }
        // it needs a share it acts for the vault of, or for the grantee of, or for the issuer of, whose keep shares say
        // what it syncs, or that is wide over or in the audience or the wants of an entry it may receive
        let who = |g: Who| matches!(g, Who::Vault(g) if reach.acts.contains(&g));
        let sees = |cp: &Issued| {
            reach.acts.contains(&cp.share.over)
                || who(cp.share.who)
                || reach.acts.contains(&cp.share.issuer)
                || (vaults.contains(&cp.share.over) && (cp.share.wide || stayed.contains(&cp.id)))
        };
        let shares = st.shares().iter().filter(|cp| sees(cp)).flat_map(|cp| cp.chain.iter().copied());
        let shares: HashSet<ShareId> = shares.collect();
        reach.shares = shares;
        reach
    }

    /// It may receive the edits of audience `x` of vault `v` (`mayReceiveAudience`).
    fn audience(&self, v: VaultId, x: AudienceId) -> bool {
        self.whole.contains(&v)
            || self.st.audience_shares(x).unwrap_or_default().iter().any(|c| self.granting.get(c) == Some(&v))
    }

    /// It syncs log `l` (`syncsLog`): an entry's it may receive and its keep shares want (T28), any other it may
    /// receive (`mayReceiveLog`). Vault logs come as the vaults the rest names.
    fn log(&self, l: LogId) -> bool {
        match l {
            LogId::Entry(e) => {
                self.st.entry(e).is_some_and(|en| self.audience(en.vault, en.audience()) && self.st.wants(self.d, en))
            }
            LogId::Audience(v, x) => self.audience(v, x),
            LogId::Share(c) => self.shares.contains(&c),
            LogId::Vault(_) => false,
        }
    }
}

/// What a peer holding `edits` sends device `d`, which follows the vaults `follow`: the edits of every entry log `d`
/// syncs and every audience and share log it may receive, and of the logs of the vaults `d` acts for and that those
/// edits name, up their owners. A vault it follows adds no log of its own: only what its public edits name.
pub fn respond(edits: &[Edit], d: SignerId, follow: &[VaultId]) -> Vec<Edit> {
    answer(edits, &view(edits), d, follow).into_iter().map(|i| edits[i].clone()).collect()
}

/// A peer holding `edits` may hand device `d`, which follows the vaults `follow`, the sealed bytes of file `file`: it
/// sends `d` an edit that brings the file (T27), a write of an entry `d` may receive. Holding the bytes is the peer's
/// store's to say.
pub fn may_fetch(edits: &[Edit], d: SignerId, file: &FileRoot, follow: &[VaultId]) -> bool {
    answer(edits, &view(edits), d, follow).into_iter().any(|i| edits[i].files().contains(file))
}

/// `respond`, by the view `st` of `edits`: the places in `edits` of what it sends, the entry, audience and share logs'
/// first.
pub(crate) fn answer(edits: &[Edit], st: &State, d: SignerId, follow: &[VaultId]) -> Vec<usize> {
    let reach = Reach::new(st, d, follow);
    let logs: Vec<Option<LogId>> = edits.iter().map(|edit| log_of(edit, edit.id())).collect();
    let mut may: HashMap<LogId, bool> = HashMap::new();
    let items: Vec<usize> = (0..edits.len())
        .filter(|&i| logs[i].is_some_and(|l| *may.entry(l).or_insert_with(|| reach.log(l))))
        .collect();
    let mut vs: Vec<VaultId> = reach.acts.iter().copied().collect();
    vs.sort();
    vs.extend(items.iter().flat_map(|&i| vaults_named(&edits[i])));
    let vaults: HashSet<VaultId> = close_vaults(st, vs).into_iter().collect();
    let vault_edits = (0..edits.len()).filter(|&i| matches!(logs[i], Some(LogId::Vault(v)) if vaults.contains(&v)));
    items.iter().copied().chain(vault_edits).collect()
}

/// The edits of the logs of `vs` and of every vault that owns one of them, up the chains, as `st` knows them: what a
/// contact card carries.
pub fn vault_logs(edits: &[Edit], st: &State, vs: Vec<VaultId>) -> Vec<Edit> {
    let vaults: HashSet<VaultId> = close_vaults(st, vs).into_iter().collect();
    edits
        .iter()
        .filter(|edit| matches!(log_of(edit, edit.id()), Some(LogId::Vault(v)) if vaults.contains(&v)))
        .cloned()
        .collect()
}

/// The vaults passkey `p` owns in `st`: those it is an owner or the root of.
pub fn owned_by(st: &State, p: SignerId) -> Vec<VaultId> {
    let owns = |v: &&crate::policy::Vault| v.owners.contains(&Principal::Signer(p)) || v.root == Some(p);
    st.vaults().iter().filter(owns).map(|v| v.id).collect()
}

/// What a peer holding `edits` hands a device whose passkey `p` proved itself on their connection (P8c): the logs of
/// the vaults `p` owns, and of every vault that owns one of them, up the chains, as a new device of `p`'s person needs
/// them to add itself to its vault. Nothing about any share, audience or entry (T20): the device asks for the rest once
/// it acts for the vault.
pub fn link_card(edits: &[Edit], p: SignerId) -> Vec<Edit> {
    link_places(edits, &view(edits), p).into_iter().map(|i| edits[i].clone()).collect()
}

/// `link_card`, by the view `st` of `edits`: the places in `edits` of what it hands over.
pub(crate) fn link_places(edits: &[Edit], st: &State, p: SignerId) -> Vec<usize> {
    let vaults: HashSet<VaultId> = close_vaults(st, owned_by(st, p)).into_iter().collect();
    (0..edits.len())
        .filter(|&i| matches!(log_of(&edits[i], edits[i].id()), Some(LogId::Vault(v)) if vaults.contains(&v)))
        .collect()
}

/// `vs` and every vault that owns one of them, directly or further up.
pub fn close_vaults(st: &State, mut vs: Vec<VaultId>) -> Vec<VaultId> {
    let mut seen: HashSet<VaultId> = HashSet::new();
    vs.retain(|v| seen.insert(*v));
    let mut i = 0;
    while i < vs.len() {
        if let Some(vt) = st.vault(vs[i]) {
            for p in &vt.owners {
                if let Principal::Vault(o) = *p
                    && seen.insert(o)
                {
                    vs.push(o);
                }
            }
        }
        i += 1;
    }
    vs
}

/// A peer's edits after receiving `incoming`: each edit once.
pub fn receive(edits: &[Edit], incoming: &[Edit]) -> Vec<Edit> {
    let mut out = edits.to_vec();
    for edit in incoming {
        if !out.contains(edit) {
            out.push(edit.clone());
        }
    }
    out
}

/// The writes one entry has in the view of `edits`, in replay order.
pub fn entry_writes(edits: &[Edit], e: EntryId) -> Vec<EditId> {
    view(edits).writes(e)
}

/// One log's edits among a peer's, by id: the first edit of each id.
#[derive(Default)]
struct LogEdits<'a> {
    by_id: HashMap<EditId, &'a Edit>,
}

impl<'a> LogEdits<'a> {
    /// The edits of log `l` among `edits` (`ids[i]` being `edits[i]`'s id).
    fn new(edits: &'a [Edit], ids: &[EditId], l: LogId) -> LogEdits<'a> {
        let mut log = LogEdits::default();
        for (edit, &id) in edits.iter().zip(ids) {
            if log_of(edit, id) == Some(l) {
                log.by_id.entry(id).or_insert(edit);
            }
        }
        log
    }

    /// Every log's edits, `logs[i]` being the log of `edits[i]` and `ids[i]` its id.
    fn all(edits: &'a [Edit], ids: &[EditId], logs: &[Option<LogId>]) -> BTreeMap<LogId, LogEdits<'a>> {
        let mut all: BTreeMap<LogId, LogEdits<'a>> = BTreeMap::new();
        for ((edit, &id), lg) in edits.iter().zip(ids).zip(logs) {
            if let Some(l) = *lg {
                all.entry(l).or_default().by_id.entry(id).or_insert(edit);
            }
        }
        all
    }

    /// The edits whose whole past in the log is held: an edit is in once each of its parents is.
    fn closed(&self) -> HashSet<EditId> {
        let mut waiting: HashMap<EditId, usize> = HashMap::new();
        let mut children: HashMap<EditId, Vec<EditId>> = HashMap::new();
        let mut ready = vec![];
        for (&id, edit) in &self.by_id {
            let parents: HashSet<EditId> = edit.parents.iter().copied().collect();
            // a parent the log doesn't hold never comes in, and neither does what builds on it
            if parents.iter().any(|p| !self.by_id.contains_key(p)) {
                continue;
            }
            if parents.is_empty() {
                ready.push(id);
            }
            waiting.insert(id, parents.len());
            for p in parents {
                children.entry(p).or_default().push(id);
            }
        }
        let mut closed = HashSet::new();
        while let Some(id) = ready.pop() {
            if !closed.insert(id) {
                continue;
            }
            for c in children.get(&id).into_iter().flatten() {
                let n = waiting.get_mut(c).expect("a child waits");
                *n -= 1;
                if *n == 0 {
                    ready.push(*c);
                }
            }
        }
        closed
    }

    /// The ids of the edits of the closed part `closed` that no edit of it builds on, smallest first.
    fn frontier_in(&self, closed: &HashSet<EditId>) -> Vec<EditId> {
        let built_on: HashSet<EditId> = closed.iter().flat_map(|id| self.by_id[id].parents.iter().copied()).collect();
        let mut f: Vec<EditId> = closed.iter().copied().filter(|id| !built_on.contains(id)).collect();
        f.sort();
        f
    }

    /// The frontier, and the ids of the edits outside the closed part, waiting for their past, smallest first.
    fn frontier(&self) -> (Vec<EditId>, Vec<EditId>) {
        let closed = self.closed();
        let mut waiting: Vec<EditId> = self.by_id.keys().copied().filter(|id| !closed.contains(id)).collect();
        waiting.sort();
        (self.frontier_in(&closed), waiting)
    }

    /// What a device sends of the log when it asks a peer, smallest first: its frontier, the edits 1, 2, 4, 8, … steps
    /// back from it by the shortest way, and the oldest, all of the closed part `closed`.
    fn haves(&self, closed: &HashSet<EditId>) -> Vec<EditId> {
        let mut level = self.frontier_in(closed);
        let mut seen: HashSet<EditId> = level.iter().copied().collect();
        let mut out = vec![];
        for k in 0usize.. {
            // one step further back: the edits the level builds on, not yet seen
            let next: Vec<EditId> = level
                .iter()
                .flat_map(|id| self.by_id[id].parents.iter().copied())
                .filter(|p| closed.contains(p) && seen.insert(*p))
                .collect();
            if k == 0 || k.is_power_of_two() || next.is_empty() {
                out.extend(&level);
            }
            if next.is_empty() {
                break;
            }
            level = next;
        }
        out.sort();
        out.dedup();
        out
    }

    /// `f` and every edit of the log it builds on, directly or further back.
    fn ancestors(&self, f: &[EditId]) -> HashSet<EditId> {
        let mut seen: HashSet<EditId> = f.iter().copied().collect();
        let mut stack: Vec<EditId> = f.to_vec();
        while let Some(id) = stack.pop() {
            for p in self.by_id.get(&id).map(|edit| edit.parents.as_slice()).unwrap_or_default() {
                if seen.insert(*p) {
                    stack.push(*p);
                }
            }
        }
        seen
    }
}

/// The frontier of log `l` among `edits` (`ids[i]` being `edits[i]`'s id): the ids of the edits of its closed part that
/// no edit of it builds on, smallest first. What an edit made now builds on.
pub(crate) fn frontier_of(edits: &[Edit], ids: &[EditId], l: LogId) -> Vec<EditId> {
    LogEdits::new(edits, ids, l).frontier().0
}

/// The part of log `l` among `edits` whose whole past is held, as ids: what a peer counts in the log's frontier.
pub fn closed_part(edits: &[Edit], l: LogId) -> HashSet<EditId> {
    let ids: Vec<EditId> = edits.iter().map(Edit::id).collect();
    LogEdits::new(edits, &ids, l).closed()
}

/// The frontier of every log among `edits`: what an edit made now builds on, and what each log's digest hashes.
pub fn frontiers(edits: &[Edit]) -> BTreeMap<LogId, Vec<EditId>> {
    let ids: Vec<EditId> = edits.iter().map(Edit::id).collect();
    frontiers_ids(edits, &ids)
}

/// `frontiers`, given each edit's id.
pub(crate) fn frontiers_ids(edits: &[Edit], ids: &[EditId]) -> BTreeMap<LogId, Vec<EditId>> {
    LogEdits::all(edits, ids, &logs_of(edits, ids)).into_iter().map(|(l, log)| (l, log.frontier().0)).collect()
}

/// One hash for each log among `edits` (`ids[i]` being `edits[i]`'s id): of its frontier, and of the edits held outside
/// its closed part, waiting for their past. Two copies of a log with the same digest hold the same edits (T19), so
/// devices gossip digests and ask a peer only when one differs.
pub(crate) fn digests_ids(edits: &[Edit], ids: &[EditId]) -> BTreeMap<LogId, [u8; 32]> {
    let digest = |(f, waiting): (Vec<EditId>, Vec<EditId>)| {
        let mut h = Hasher::new("avendb log digest");
        h.update(&(f.len() as u64).to_be_bytes());
        for id in f.iter().chain(&waiting) {
            h.update(&id.0);
        }
        h.finalize()
    };
    LogEdits::all(edits, ids, &logs_of(edits, ids)).into_iter().map(|(l, log)| (l, digest(log.frontier()))).collect()
}

/// The digest of every log among `edits`: what a device gossips.
pub fn digests(edits: &[Edit]) -> BTreeMap<LogId, [u8; 32]> {
    let ids: Vec<EditId> = edits.iter().map(Edit::id).collect();
    digests_ids(edits, &ids)
}

/// What a device sends a peer when it asks.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Ask {
    /// Of each log, its frontier, the edits 1, 2, 4, 8, … steps back from it by the shortest way, and the oldest, all
    /// of its closed part: the peer sends nothing at or below them.
    pub haves: BTreeMap<LogId, Vec<EditId>>,
    /// The edits it holds outside every closed part, smallest first: waiting for their past, or of no log. The peer
    /// doesn't send them again.
    pub loose: Vec<EditId>,
    /// The vaults it follows, smallest first: of each, what everyone may read reaches it too, as if it had an interest
    /// in the vault (`Logs.lean`'s `Ask.follow`). It only narrows what is public to the vaults it names (T12).
    pub follow: Vec<VaultId>,
}

/// What a device holding `edits` and following the vaults `follow` sends when it asks a peer: of each log, its frontier
/// and a few edits further back, so a peer that lacks its latest edits still sends back little it holds; its loose
/// edits; and what it follows.
pub fn asks(edits: &[Edit], follow: &[VaultId]) -> Ask {
    let ids: Vec<EditId> = edits.iter().map(Edit::id).collect();
    asks_ids(edits, &ids, follow)
}

/// `asks`, given each edit's id.
pub(crate) fn asks_ids(edits: &[Edit], ids: &[EditId], follow: &[VaultId]) -> Ask {
    let logs = logs_of(edits, ids);
    let mut ask = Ask { follow: follow.to_vec(), ..Ask::default() };
    ask.follow.sort();
    ask.follow.dedup();
    let mut closed: HashSet<EditId> = HashSet::new();
    for (l, log) in LogEdits::all(edits, ids, &logs) {
        let c = log.closed();
        ask.haves.insert(l, log.haves(&c));
        closed.extend(c);
    }
    ask.loose = ids.iter().copied().filter(|id| !closed.contains(id)).collect();
    ask.loose.sort();
    ask.loose.dedup();
    ask
}

/// What a device holding `edits` sends when it asks by frontiers alone (`Logs.lean`'s `⟨frontiers, loose, []⟩`): of
/// each log its frontier, and its loose edits. A peer that holds all it holds, as the node a backup is made of holds
/// what its last snapshot held, sends back exactly what it lacks (T19). What a backup's manifest names (`backup`).
pub fn asks_by_frontiers(edits: &[Edit]) -> Ask {
    let ids: Vec<EditId> = edits.iter().map(Edit::id).collect();
    let logs = logs_of(edits, &ids);
    let mut ask = Ask::default();
    let mut closed: HashSet<EditId> = HashSet::new();
    for (l, log) in LogEdits::all(edits, &ids, &logs) {
        let c = log.closed();
        ask.haves.insert(l, log.frontier_in(&c));
        closed.extend(c);
    }
    ask.loose = ids.iter().copied().filter(|id| !closed.contains(id)).collect();
    ask.loose.sort();
    ask.loose.dedup();
    ask
}

/// Of the edits `edits` (`ids[i]` being `edits[i]`'s id and `logs[i]` its log), every id at or below what `asked`
/// names: its loose edits, and of each log the edits it names there and every edit of the log they build on. What a
/// peer would send it none of (`beyond`); of a log the peer holds none of, the ids named alone.
pub(crate) fn named_below(edits: &[Edit], ids: &[EditId], logs: &[Option<LogId>], asked: &Ask) -> HashSet<EditId> {
    let all = LogEdits::all(edits, ids, logs);
    let mut below: HashSet<EditId> = asked.loose.iter().copied().collect();
    for (l, named) in &asked.haves {
        match all.get(l) {
            Some(log) => below.extend(log.ancestors(named)),
            None => below.extend(named.iter().copied()),
        }
    }
    below
}

/// What a peer holding `edits` sends device `d` that asked with `asked` (`asks`): what `respond` sends it, following
/// what it asked with, but none of the device's loose edits, and of each log only what lies beyond the edits it named
/// of it: those not among them and that none of them builds on. A log it named nothing of is sent whole.
pub fn respond_since(edits: &[Edit], d: SignerId, asked: &Ask) -> Vec<Edit> {
    let ids: Vec<EditId> = edits.iter().map(Edit::id).collect();
    let logs = logs_of(edits, &ids);
    let places = answer(edits, &view(edits), d, &asked.follow);
    beyond(edits, &ids, &logs, &places, asked).into_iter().map(|i| edits[i].clone()).collect()
}

/// Of the edits at the places `answer` among `edits` (`ids[i]` being `edits[i]`'s id and `logs[i]` its log), those
/// beyond what the asker sent, `asked`: what `respond_since` sends.
pub(crate) fn beyond(
    edits: &[Edit],
    ids: &[EditId],
    logs: &[Option<LogId>],
    answer: &[usize],
    asked: &Ask,
) -> Vec<usize> {
    let all = LogEdits::all(edits, ids, logs);
    let loose: HashSet<EditId> = asked.loose.iter().copied().collect();
    let mut below: HashMap<LogId, HashSet<EditId>> = HashMap::new();
    answer
        .iter()
        .copied()
        .filter(|&i| {
            if loose.contains(&ids[i]) {
                return false;
            }
            let Some(l) = logs[i] else { return true };
            let named = asked.haves.get(&l).map(Vec::as_slice).unwrap_or_default();
            !below.entry(l).or_insert_with(|| all[&l].ancestors(named)).contains(&ids[i])
        })
        .collect()
}

/// Where an edit comes in a reply (`Lab::reply`), which a peer sends a page at a time: by its depth, then its id.
pub type Place = (u64, EditId);

/// The place of `edit` in a reply. An edit is one deeper than the deepest edit its device held when it made it, so none
/// comes ahead of an edit it builds on: a device that takes a reply a page at a time holds an edit's past in the reply
/// by the time the edit arrives, and asks on after the last place it got.
pub fn place(edit: &Edit) -> Place {
    (edit.depth, edit.id())
}

/// Every fork among `edits`: two edits of one device in one log where neither builds on the other, the smaller id
/// first. Only each log's closed part counts, where the whole past of both is held, and only the signers some vault in
/// what `edits` say lists as its devices: a passkey signs on several devices at once.
pub fn forks(edits: &[Edit]) -> Vec<(EditId, EditId)> {
    let ids: Vec<EditId> = edits.iter().map(Edit::id).collect();
    forks_in(edits, &ids, &view(edits))
}

/// `forks`, given each edit's id and the view `st` of `edits`.
pub(crate) fn forks_in(edits: &[Edit], ids: &[EditId], st: &State) -> Vec<(EditId, EditId)> {
    let device = |s: SignerId| st.vaults().iter().any(|v| v.devices.contains(&s));
    let mut out = vec![];
    for log in LogEdits::all(edits, ids, &logs_of(edits, ids)).values() {
        let mut by_author: BTreeMap<SignerId, Vec<EditId>> = BTreeMap::new();
        for id in log.closed() {
            let author = log.by_id[&id].author;
            if device(author) {
                by_author.entry(author).or_default().push(id);
            }
        }
        for mine in by_author.values_mut() {
            mine.sort();
            let past: Vec<HashSet<EditId>> = mine.iter().map(|id| log.ancestors(&log.by_id[id].parents)).collect();
            for i in 0..mine.len() {
                for j in i + 1..mine.len() {
                    if !past[j].contains(&mine[i]) && !past[i].contains(&mine[j]) {
                        out.push((mine[i], mine[j]));
                    }
                }
            }
        }
    }
    out.sort();
    out
}
