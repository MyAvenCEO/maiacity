//! Sync by cells, entry by entry, as in `avendb/spec/AvenDB/Sync.lean`, and by frontiers, log by log, as in
//! `Logs.lean`. A device asks a peer for what it may receive; the connection proves which device is asking (iroh's
//! endpoint key is the device's ed25519 key, and the device shows the rest of its keys, which hash to its signer id). The
//! peer answers from its own view: the logs of the entries and cells the device may receive (it acts for their vault, or
//! for the grantee of a live cap that reaches their cell, or that cap is public), the logs of every cap it needs to check
//! those (the caps of every cell such an entry was ever in, the vault's wide caps, the caps its own vaults hold or are
//! over, and every cap those rest on), and the logs of every vault all that names, up their chains of owners. A
//! revocation sits in the log of the cap it ends, so a device whose cap was revoked hears of it, and knows what it may
//! no longer do. Nothing about any other entry or cell leaves the peer (T12): not its writes, not even its cell. Two
//! devices that answered each other hold the same writes for every entry they share (T13). Receiving is not reading:
//! a relay cap gets the ciphertext and no key.
//!
//! Every edit belongs to one log (`log_of`): a vault's (its governance, its seed's keys, its schema lane), a cap's (the
//! cap, its revocation, its keys), a cell's (its keys), or an entry's (its writes, moves, checkpoints and keys). It names
//! as its parents the frontier of its own log as its device held it. So each log is a small history of its own, and two
//! copies of a log compare by their frontiers alone: one hash per log (`digests`), which is what devices gossip. A device
//! asks with its frontier of each log it holds and a few edits further back, the edits 1, 2, 4, 8, … steps back and the
//! oldest, and with the edits it holds outside them (`asks`); the peer sends only what lies beyond the ones it holds
//! (`respond_since`). A peer that is behind holds the whole frontier and sends exactly what the device lacks; one that
//! lacks the device's latest edits still holds one of them close by, and sends back little the device holds. That
//! withholds nothing the device lacks (T19): a device names of a log only edits of the part whose whole past it holds, so
//! an edit whose parent hasn't arrived waits outside, with whatever builds on it, until the gap is filled. A device signs
//! its edits in a log one after another, each building on the last, so two edits of one device in one log where neither
//! builds on the other mean its key signed twice from the same past (`forks`): a cloned device, one restored from an old
//! backup, or a stolen key.
//!
//! A big reply comes a page at a time (P8d), each edit after the edits it builds on (`place`): the device takes each
//! page as it comes and asks on after the last edit it got, until the peer has nothing more.

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::hash::Hasher;
use crate::id::{CapId, CellId, EditId, EntryId, SignerId, VaultId};
use crate::keys::{KeyFam, KeyName};
use crate::policy::{view, Action, Edit, Grantee, Principal, State};

/// A log: a vault's, a cap's, a cell's or an entry's.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum LogId {
    Vault(VaultId),
    Cap(CapId),
    Cell(VaultId, CellId),
    Entry(EntryId),
}

/// The log of edit `edit`, whose id is `id` (`Edit.log?`): a vault edit, a schema or lens, and a seed's key go to their
/// vault's; a cap, its revocation and its key to the cap's; a cell's key to the cell's; a write, a move, a checkpoint
/// and an entry's key to the entry's. A signer's own key is never boxed, so a `Keys` edit naming one is of no log. The
/// id names the log only of an edit that starts one, a genesis or a cap.
pub fn log_of(edit: &Edit, id: EditId) -> Option<LogId> {
    Some(match &edit.action {
        Action::Genesis { .. } => LogId::Vault(VaultId::from(id)),
        Action::AddOwner { vault, .. }
        | Action::RemoveOwner { vault, .. }
        | Action::SetThreshold { vault, .. }
        | Action::AddDevice { vault, .. }
        | Action::RemoveDevice { vault, .. }
        | Action::SetRoot { vault, .. }
        | Action::Publish { vault, .. } => LogId::Vault(*vault),
        Action::Cap(..) => LogId::Cap(CapId::from(id)),
        Action::Revoke { cap, .. } => LogId::Cap(*cap),
        Action::Write { entry, .. } | Action::Move { entry, .. } | Action::Checkpoint { entry, .. } => {
            LogId::Entry(*entry)
        }
        Action::Keys { name, .. } => match *name {
            KeyName::Signer(_) => return None,
            KeyName::Scoped(KeyFam::Seed(v), _) => LogId::Vault(v),
            KeyName::Scoped(KeyFam::Cap(_, c), _) => LogId::Cap(c),
            KeyName::Scoped(KeyFam::Cell(v, x), _) => LogId::Cell(v, x),
            KeyName::Entry(e, ..) => LogId::Entry(e),
        },
    })
}

/// The log of each of `edits` (`ids[i]` being `edits[i]`'s id).
pub(crate) fn logs_of(edits: &[Edit], ids: &[EditId]) -> Vec<Option<LogId>> {
    edits.iter().zip(ids).map(|(edit, &id)| log_of(edit, id)).collect()
}

/// The vaults an edit names (`Edit.vaultsNamed`): what it acts for, through, or about.
fn vaults_named(edit: &Edit) -> Vec<VaultId> {
    match &edit.action {
        Action::Cap(c, via) => {
            let grantee = match c.grantee {
                Grantee::Principal(Principal::Vault(g)) => Some(g),
                _ => None,
            };
            [c.over, c.issuer].into_iter().chain(grantee).chain(via.iter().copied()).collect()
        }
        Action::Revoke { actor, via, .. } => std::iter::once(*actor).chain(via.iter().copied()).collect(),
        Action::Write { vault, actor, via, .. } => [*vault, *actor].into_iter().chain(via.iter().copied()).collect(),
        Action::Move { vault, via, .. } => std::iter::once(*vault).chain(via.iter().copied()).collect(),
        _ => vec![],
    }
}

/// What one device may receive by a view, worked out once for the whole of a reply.
struct Reach<'a> {
    st: &'a State,
    /// The vaults the device acts for.
    acts: HashSet<VaultId>,
    /// The vaults whose every cell it may receive: it acts for them, or a live wide cap over them names a vault it acts
    /// for, or is public.
    whole: HashSet<VaultId>,
    /// The live caps that aren't wide naming a vault it acts for, or public, with the vault each is over: it may
    /// receive the cells they are in.
    granting: HashMap<CapId, VaultId>,
    /// The caps it may learn about (`reachesCap`).
    caps: HashSet<CapId>,
}

impl<'a> Reach<'a> {
    fn new(st: &'a State, d: SignerId) -> Reach<'a> {
        let acts: HashSet<VaultId> = st.vaults().iter().map(|v| v.id).filter(|&v| st.acts_for(d, v)).collect();
        let names = |g: Grantee| match g {
            Grantee::Principal(Principal::Vault(g)) => acts.contains(&g),
            Grantee::Principal(Principal::Signer(_)) => false,
            Grantee::Public => true,
        };
        let mut whole = acts.clone();
        let mut granting = HashMap::new();
        for cp in st.caps().iter().filter(|cp| st.live(cp.id) && names(cp.cap.grantee)) {
            if cp.cap.wide {
                whole.insert(cp.cap.over);
            } else {
                granting.insert(cp.id, cp.cap.over);
            }
        }
        let mut reach = Reach { st, acts, whole, granting, caps: HashSet::new() };
        // the caps of every cell an entry it may receive was ever in, and the vaults of those entries, for their wide
        // caps
        let (mut stayed, mut vaults) = (HashSet::new(), HashSet::new());
        for en in st.entries().iter().filter(|en| reach.cell(en.vault, en.cell())) {
            vaults.insert(en.vault);
            for (_, x) in &en.stays {
                stayed.extend(st.cell_caps(*x).unwrap_or_default().iter().copied());
            }
        }
        let grantee = |g: Grantee| matches!(g, Grantee::Principal(Principal::Vault(g)) if reach.acts.contains(&g));
        let sees = |cp: &crate::policy::Issued| {
            reach.acts.contains(&cp.cap.over)
                || grantee(cp.cap.grantee)
                || (vaults.contains(&cp.cap.over) && (cp.cap.wide || stayed.contains(&cp.id)))
        };
        let caps: HashSet<CapId> = st.caps().iter().filter(|cp| sees(cp)).flat_map(|cp| cp.chain.iter().copied()).collect();
        reach.caps = caps;
        reach
    }

    /// It may receive the edits of cell `x` of vault `v` (`mayReceiveCell`).
    fn cell(&self, v: VaultId, x: CellId) -> bool {
        self.whole.contains(&v)
            || self.st.cell_caps(x).unwrap_or_default().iter().any(|c| self.granting.get(c) == Some(&v))
    }

    /// It may receive log `l` (`mayReceiveLog`). Vault logs come as the vaults the rest names.
    fn log(&self, l: LogId) -> bool {
        match l {
            LogId::Entry(e) => self.st.entry(e).is_some_and(|en| self.cell(en.vault, en.cell())),
            LogId::Cell(v, x) => self.cell(v, x),
            LogId::Cap(c) => self.caps.contains(&c),
            LogId::Vault(_) => false,
        }
    }
}

/// What a peer holding `edits` sends device `d`: the edits of every entry, cell and cap log `d` may receive, and of the
/// logs of the vaults `d` acts for and that those edits name, up their owners.
pub fn respond(edits: &[Edit], d: SignerId) -> Vec<Edit> {
    answer(edits, &view(edits), d).into_iter().map(|i| edits[i].clone()).collect()
}

/// `respond`, by the view `st` of `edits`: the places in `edits` of what it sends, the entry, cell and cap logs' first.
pub(crate) fn answer(edits: &[Edit], st: &State, d: SignerId) -> Vec<usize> {
    let reach = Reach::new(st, d);
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
/// them to add itself to its vault. Nothing about any cap, cell or entry (T20): the device asks for the rest once it
/// acts for the vault.
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
}

/// What a device holding `edits` sends when it asks a peer: of each log, its frontier and a few edits further back, so
/// a peer that lacks its latest edits still sends back little it holds; and its loose edits.
pub fn asks(edits: &[Edit]) -> Ask {
    let ids: Vec<EditId> = edits.iter().map(Edit::id).collect();
    asks_ids(edits, &ids)
}

/// `asks`, given each edit's id.
pub(crate) fn asks_ids(edits: &[Edit], ids: &[EditId]) -> Ask {
    let logs = logs_of(edits, ids);
    let mut ask = Ask::default();
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

/// What a peer holding `edits` sends device `d` that asked with `asked` (`asks`): what `respond` sends, but none of the
/// device's loose edits, and of each log only what lies beyond the edits it named of it: those not among them and that
/// none of them builds on. A log it named nothing of is sent whole.
pub fn respond_since(edits: &[Edit], d: SignerId, asked: &Ask) -> Vec<Edit> {
    let ids: Vec<EditId> = edits.iter().map(Edit::id).collect();
    let logs = logs_of(edits, &ids);
    beyond(edits, &ids, &logs, &answer(edits, &view(edits), d), asked).into_iter().map(|i| edits[i].clone()).collect()
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
