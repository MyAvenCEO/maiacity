//! Sync by caps, item by item, as in `avendb/spec/AvenDB/Sync.lean`, and by frontiers, log by log, as in `Logs.lean`.
//! A device asks a peer for what it may receive; the connection proves which device is asking (iroh's endpoint key is
//! the device's ed25519 key, and the device shows the rest of its keys, which hash to its signer id). The peer answers
//! from its own view: the logs of the vaults that device acts for, and for each item it may receive, the encrypted
//! writes and checkpoints, the auth ops of the scopes covering it, and the logs of every vault those ops act for or
//! name, up their chains of owners. A revocation that took one of the device's caps away reaches it too, so it knows
//! what it may no longer do. Nothing else about other items leaves the peer (T12), and two devices that answered each
//! other hold the same writes for every item they share (T13).
//!
//! Every op belongs to one log: a vault's, a space's or an entry's (`LogId`), and names as its parents the frontier of
//! its own log as its device held it. So each log is a small history of its own, and two copies of a log compare by
//! their frontiers alone: one hash per log (`digests`), which is what devices gossip. A device asks with its frontier
//! of each log it holds and a few ops further back, the ops 1, 2, 4, 8, … steps back and the oldest, and with the ops
//! it holds outside them (`asks`); the peer sends only what lies beyond the ones it holds (`respond_since`). A peer
//! that is behind holds the whole frontier and sends exactly what the device lacks; one that lacks the device's latest
//! ops still holds one of them close by, and sends back little the device holds. That withholds nothing the device
//! lacks (T19): a device names of a log only ops of the part whose whole past it holds, so an op whose parent hasn't
//! arrived waits outside, with whatever builds on it, until the gap is filled. A device signs its ops in a log one
//! after another, each building on the last, so two ops of one device in one log where neither builds on the other
//! mean its key signed twice from the same past (`forks`): a cloned device, one restored from an old backup, or a
//! stolen key.
//!
//! A big reply comes a page at a time (P8d), each op after the ops it builds on (`place`): the device takes each page
//! as it comes and asks on after the last op it got, until the peer has nothing more.
//!
//! Vault logs in P1, items by caps in P2, frontiers, forks and the proofs (T11, T12, T13, T19) in P6; on the wire (P8)
//! it runs on its own iroh ALPN, with the bytes in iroh-blobs and the digests on iroh-gossip.

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::hash::Hasher;
use crate::id::{EntryId, GrantId, OpId, SignerId, SpaceId, VaultId};
use crate::policy::{removes, view, Action, Fact, Grant, Grantee, Op, Principal, Scope, State};

/// What a peer holding `ops` sends device `d`: the writes of every item `d` may receive, the auth ops of every scope it
/// reaches and the revocations that took its caps away, and the logs of the vaults it acts for, of the vaults those
/// ops act for or name, and of every vault that owns one of them, up the chains.
pub fn respond(ops: &[Op], d: SignerId) -> Vec<Op> {
    answer(ops, &view(ops), d).into_iter().map(|i| ops[i].clone()).collect()
}

/// `respond`, by the view `st` of `ops`: the places in `ops` of what it sends.
pub(crate) fn answer(ops: &[Op], st: &State, d: SignerId) -> Vec<usize> {
    let all = 0..ops.len();
    let writes: Vec<usize> =
        all.clone().filter(|&i| ops[i].item().is_some_and(|(sp, e)| st.may_receive(d, sp, e))).collect();
    let auth: Vec<usize> = all
        .clone()
        .filter(|&i| auth_scope(ops, &ops[i]).is_some_and(|sc| st.reaches(d, sc)) || takes_from(st, ops, d, &ops[i]))
        .collect();
    let mut vs: Vec<VaultId> = st.vaults().iter().map(|x| x.id).filter(|&v| st.acts_for(d, v)).collect();
    vs.extend(writes.iter().chain(&auth).filter_map(|&i| ops[i].actor()));
    vs.extend(auth.iter().filter_map(|&i| ops[i].grantee()));
    let vaults = close_vaults(st, vs);
    let vault_ops = all.filter(|&i| ops[i].vault_of().is_some_and(|v| vaults.contains(&v)));
    writes.into_iter().chain(auth).chain(vault_ops).collect()
}

/// The scope an auth op is about: a space's founding, a grant's scope, for a revocation the scope of the grant it
/// revokes, looked up among `ops`, the scope of a space or entry key, or the space a schema or lens is published into.
fn auth_scope(ops: &[Op], op: &Op) -> Option<Scope> {
    match &op.action {
        Action::FoundSpace { .. } => Some(Scope::Space(SpaceId::from(op.id()))),
        Action::Grant(g, _) => Some(g.scope),
        Action::Revoke { grant, .. } => ops.iter().find_map(|o| match &o.action {
            Action::Grant(g, _) if GrantId::from(o.id()) == *grant => Some(g.scope),
            _ => None,
        }),
        Action::Keys { key, .. } => key.scope(),
        Action::Publish { space, .. } => Some(Scope::Space(*space)),
        _ => None,
    }
}

/// Revocation `op` takes a cap from device `d`: among the grants it takes away is one naming a vault `d` acts for.
/// `d` hears of it, and learns nothing more about the scope.
pub fn takes_from(st: &State, ops: &[Op], d: SignerId, op: &Op) -> bool {
    if !matches!(op.action, Action::Revoke { .. }) {
        return false;
    }
    let taken = removes(ops, op);
    ops.iter().any(|o| match o.action {
        Action::Grant(Grant { grantee: Grantee::Principal(Principal::Vault(v)), .. }, _) => {
            taken.contains(&Fact::Grant(GrantId::from(o.id()))) && st.acts_for(d, v)
        }
        _ => false,
    })
}

/// The ops of the logs of `vs` and of every vault that owns one of them, up the chains, as `st` knows them: what a
/// contact card carries.
pub fn vault_logs(ops: &[Op], st: &State, vs: Vec<VaultId>) -> Vec<Op> {
    let vaults = close_vaults(st, vs);
    ops.iter().filter(|op| op.vault_of().is_some_and(|v| vaults.contains(&v))).cloned().collect()
}

/// The vaults passkey `p` owns in `st`: those it is an owner or the root of.
pub fn owned_by(st: &State, p: SignerId) -> Vec<VaultId> {
    let owns = |v: &&crate::policy::Vault| v.owners.contains(&Principal::Signer(p)) || v.root == Some(p);
    st.vaults().iter().filter(owns).map(|v| v.id).collect()
}

/// What a peer holding `ops` hands a device whose passkey `p` proved itself on their connection (P8c): the logs of
/// the vaults `p` owns, and of every vault that owns one of them, up the chains, as a new device of `p`'s person needs
/// them to add itself to its vault. Nothing about any space or entry (T20): the device asks for the rest once it acts
/// for the vault.
pub fn link_card(ops: &[Op], p: SignerId) -> Vec<Op> {
    link_places(ops, &view(ops), p).into_iter().map(|i| ops[i].clone()).collect()
}

/// `link_card`, by the view `st` of `ops`: the places in `ops` of what it hands over.
pub(crate) fn link_places(ops: &[Op], st: &State, p: SignerId) -> Vec<usize> {
    let vaults = close_vaults(st, owned_by(st, p));
    (0..ops.len()).filter(|&i| ops[i].vault_of().is_some_and(|v| vaults.contains(&v))).collect()
}

/// `vs` and every vault that owns one of them, directly or further up.
pub fn close_vaults(st: &State, mut vs: Vec<VaultId>) -> Vec<VaultId> {
    let mut i = 0;
    while i < vs.len() {
        if let Some(vt) = st.vault(vs[i]) {
            for p in &vt.owners {
                if let Principal::Vault(o) = *p
                    && !vs.contains(&o)
                {
                    vs.push(o);
                }
            }
        }
        i += 1;
    }
    vs
}

/// A peer's ops after receiving `incoming`: each op once.
pub fn receive(ops: &[Op], incoming: &[Op]) -> Vec<Op> {
    let mut out = ops.to_vec();
    for op in incoming {
        if !out.contains(op) {
            out.push(op.clone());
        }
    }
    out
}

/// The writes one item has in the view of `ops`, in replay order.
pub fn item_writes(ops: &[Op], sp: SpaceId, e: EntryId) -> Vec<OpId> {
    view(ops).writes(sp, e)
}

/// A log: a vault's, a space's or an entry's.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum LogId {
    Vault(VaultId),
    Space(SpaceId),
    Entry(SpaceId, EntryId),
}

impl From<Scope> for LogId {
    fn from(sc: Scope) -> LogId {
        match sc {
            Scope::Space(sp) => LogId::Space(sp),
            Scope::Entry(sp, e) => LogId::Entry(sp, e),
        }
    }
}

/// The scope of each grant among `ops`, by its id: where a revocation of it belongs.
fn grant_scopes<'a>(ops: impl Iterator<Item = (&'a Op, OpId)>) -> HashMap<GrantId, Scope> {
    ops.filter_map(|(o, id)| match &o.action {
        Action::Grant(g, _) => Some((GrantId::from(id), g.scope)),
        _ => None,
    })
    .collect()
}

/// The log of `op`, `id` being its id, with `grants` the scopes of the grants a peer holds: a vault op and a vault's
/// key in the vault's log; a write and a checkpoint in their entry's; a space's founding, a grant, a revocation, a
/// space or entry key and a schema or lens in the log of the scope they are about, so a revocation joins the log of
/// the grant it revokes (none while that grant isn't held).
fn log_in(grants: &HashMap<GrantId, Scope>, op: &Op, id: OpId) -> Option<LogId> {
    let sc = match &op.action {
        Action::Genesis { .. } => return Some(LogId::Vault(VaultId::from(id))),
        Action::FoundSpace { .. } => Scope::Space(SpaceId::from(id)),
        Action::Grant(g, _) => g.scope,
        Action::Revoke { grant, .. } => *grants.get(grant)?,
        Action::Publish { space, .. } => Scope::Space(*space),
        Action::Keys { key, .. } => match key.scope() {
            Some(sc) => sc,
            None => return op.vault_of().map(LogId::Vault),
        },
        _ => {
            if let Some(v) = op.vault_of() {
                return Some(LogId::Vault(v));
            }
            let (sp, e) = op.item()?;
            Scope::Entry(sp, e)
        }
    };
    Some(sc.into())
}

/// The log of each of `ops` (`ids[i]` being `ops[i]`'s id), among them.
pub(crate) fn logs_of(ops: &[Op], ids: &[OpId]) -> Vec<Option<LogId>> {
    let grants = grant_scopes(ops.iter().zip(ids.iter().copied()));
    ops.iter().zip(ids).map(|(op, &id)| log_in(&grants, op, id)).collect()
}

/// The log of op `op` among the ops `ops` a peer holds.
pub fn log_of(ops: &[Op], op: &Op) -> Option<LogId> {
    let grants = grant_scopes(ops.iter().map(|o| (o, o.id())));
    log_in(&grants, op, op.id())
}

/// The log of an op being made among `ops` (`ids[i]` being `ops[i]`'s id), before it has its parents: any op but one
/// that starts a log, whose log is named by its own id.
pub(crate) fn log_of_new(ops: &[Op], ids: &[OpId], op: &Op) -> Option<LogId> {
    let grants = match op.action {
        Action::Revoke { .. } => grant_scopes(ops.iter().zip(ids.iter().copied())),
        _ => HashMap::new(),
    };
    log_in(&grants, op, OpId([0; 32]))
}

/// One log's ops among a peer's, by id: the first op of each id.
#[derive(Default)]
struct LogOps<'a> {
    by_id: HashMap<OpId, &'a Op>,
}

impl<'a> LogOps<'a> {
    /// The ops of log `l`, `logs[i]` being the log of `ops[i]` and `ids[i]` its id.
    fn new(ops: &'a [Op], ids: &[OpId], logs: &[Option<LogId>], l: LogId) -> LogOps<'a> {
        let mut log = LogOps::default();
        for ((op, &id), lg) in ops.iter().zip(ids).zip(logs) {
            if *lg == Some(l) {
                log.by_id.entry(id).or_insert(op);
            }
        }
        log
    }

    /// Every log's ops.
    fn all(ops: &'a [Op], ids: &[OpId], logs: &[Option<LogId>]) -> BTreeMap<LogId, LogOps<'a>> {
        let mut all: BTreeMap<LogId, LogOps<'a>> = BTreeMap::new();
        for ((op, &id), lg) in ops.iter().zip(ids).zip(logs) {
            if let Some(l) = *lg {
                all.entry(l).or_default().by_id.entry(id).or_insert(op);
            }
        }
        all
    }

    /// The ops whose whole past in the log is held: an op is in once each of its parents is.
    fn closed(&self) -> HashSet<OpId> {
        let mut waiting: HashMap<OpId, usize> = HashMap::new();
        let mut children: HashMap<OpId, Vec<OpId>> = HashMap::new();
        let mut ready = vec![];
        for (&id, op) in &self.by_id {
            let parents: HashSet<OpId> = op.parents.iter().copied().collect();
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

    /// The ids of the ops of the closed part `closed` that no op of it builds on, smallest first.
    fn frontier_in(&self, closed: &HashSet<OpId>) -> Vec<OpId> {
        let built_on: HashSet<OpId> = closed.iter().flat_map(|id| self.by_id[id].parents.iter().copied()).collect();
        let mut f: Vec<OpId> = closed.iter().copied().filter(|id| !built_on.contains(id)).collect();
        f.sort();
        f
    }

    /// The frontier, and the ids of the ops outside the closed part, waiting for their past, smallest first.
    fn frontier(&self) -> (Vec<OpId>, Vec<OpId>) {
        let closed = self.closed();
        let mut waiting: Vec<OpId> = self.by_id.keys().copied().filter(|id| !closed.contains(id)).collect();
        waiting.sort();
        (self.frontier_in(&closed), waiting)
    }

    /// What a device sends of the log when it asks a peer, smallest first: its frontier, the ops 1, 2, 4, 8, … steps
    /// back from it by the shortest way, and the oldest, all of the closed part `closed`.
    fn haves(&self, closed: &HashSet<OpId>) -> Vec<OpId> {
        let mut level = self.frontier_in(closed);
        let mut seen: HashSet<OpId> = level.iter().copied().collect();
        let mut out = vec![];
        for k in 0usize.. {
            // one step further back: the ops the level builds on, not yet seen
            let next: Vec<OpId> = level
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

    /// `f` and every op of the log it builds on, directly or further back.
    fn ancestors(&self, f: &[OpId]) -> HashSet<OpId> {
        let mut seen: HashSet<OpId> = f.iter().copied().collect();
        let mut stack: Vec<OpId> = f.to_vec();
        while let Some(id) = stack.pop() {
            for p in self.by_id.get(&id).map(|op| op.parents.as_slice()).unwrap_or_default() {
                if seen.insert(*p) {
                    stack.push(*p);
                }
            }
        }
        seen
    }
}

/// The frontier of log `l` among `ops` (`ids[i]` being `ops[i]`'s id): the ids of the ops of its closed part that no
/// op of it builds on, smallest first. What an op made now builds on.
pub(crate) fn frontier_of(ops: &[Op], ids: &[OpId], l: LogId) -> Vec<OpId> {
    LogOps::new(ops, ids, &logs_of(ops, ids), l).frontier().0
}

/// The part of log `l` among `ops` whose whole past is held, as ids: what a peer counts in the log's frontier.
pub fn closed_part(ops: &[Op], l: LogId) -> HashSet<OpId> {
    let ids: Vec<OpId> = ops.iter().map(Op::id).collect();
    LogOps::new(ops, &ids, &logs_of(ops, &ids), l).closed()
}

/// The frontier of every log among `ops`: what an op made now builds on, and what each log's digest hashes.
pub fn frontiers(ops: &[Op]) -> BTreeMap<LogId, Vec<OpId>> {
    let ids: Vec<OpId> = ops.iter().map(Op::id).collect();
    frontiers_ids(ops, &ids)
}

/// `frontiers`, given each op's id.
pub(crate) fn frontiers_ids(ops: &[Op], ids: &[OpId]) -> BTreeMap<LogId, Vec<OpId>> {
    LogOps::all(ops, ids, &logs_of(ops, ids)).into_iter().map(|(l, log)| (l, log.frontier().0)).collect()
}

/// One hash for each log among `ops` (`ids[i]` being `ops[i]`'s id): of its frontier, and of the ops held outside its
/// closed part, waiting for their past. Two copies of a log with the same digest hold the same ops (T19), so devices
/// gossip digests and ask a peer only when one differs.
pub(crate) fn digests_ids(ops: &[Op], ids: &[OpId]) -> BTreeMap<LogId, [u8; 32]> {
    let digest = |(f, waiting): (Vec<OpId>, Vec<OpId>)| {
        let mut h = Hasher::new("avendb log digest");
        h.update(&(f.len() as u64).to_be_bytes());
        for id in f.iter().chain(&waiting) {
            h.update(&id.0);
        }
        h.finalize()
    };
    LogOps::all(ops, ids, &logs_of(ops, ids)).into_iter().map(|(l, log)| (l, digest(log.frontier()))).collect()
}

/// The digest of every log among `ops`: what a device gossips.
pub fn digests(ops: &[Op]) -> BTreeMap<LogId, [u8; 32]> {
    let ids: Vec<OpId> = ops.iter().map(Op::id).collect();
    digests_ids(ops, &ids)
}

/// What a device sends a peer when it asks.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Ask {
    /// Of each log, its frontier, the ops 1, 2, 4, 8, … steps back from it by the shortest way, and the oldest, all of
    /// its closed part: the peer sends nothing at or below them.
    pub haves: BTreeMap<LogId, Vec<OpId>>,
    /// The ops it holds outside every closed part, smallest first: waiting for their past, or of no log it knows, as a
    /// revocation of a grant it never held. The peer doesn't send them again.
    pub loose: Vec<OpId>,
}

/// What a device holding `ops` sends when it asks a peer: of each log, its frontier and a few ops further back, so a
/// peer that lacks its latest ops still sends back little it holds; and its loose ops.
pub fn asks(ops: &[Op]) -> Ask {
    let ids: Vec<OpId> = ops.iter().map(Op::id).collect();
    asks_ids(ops, &ids)
}

/// `asks`, given each op's id.
pub(crate) fn asks_ids(ops: &[Op], ids: &[OpId]) -> Ask {
    let logs = logs_of(ops, ids);
    let mut ask = Ask::default();
    let mut closed: HashSet<OpId> = HashSet::new();
    for (l, log) in LogOps::all(ops, ids, &logs) {
        let c = log.closed();
        ask.haves.insert(l, log.haves(&c));
        closed.extend(c);
    }
    ask.loose = ids.iter().copied().filter(|id| !closed.contains(id)).collect();
    ask.loose.sort();
    ask.loose.dedup();
    ask
}

/// What a peer holding `ops` sends device `d` that asked with `asked` (`asks`): what `respond` sends, but none of the
/// device's loose ops, and of each log only what lies beyond the ops it named of it: those not among them and that
/// none of them builds on. A log it named nothing of is sent whole.
pub fn respond_since(ops: &[Op], d: SignerId, asked: &Ask) -> Vec<Op> {
    let ids: Vec<OpId> = ops.iter().map(Op::id).collect();
    let logs = logs_of(ops, &ids);
    beyond(ops, &ids, &logs, &answer(ops, &view(ops), d), asked).into_iter().map(|i| ops[i].clone()).collect()
}

/// Of the ops at the places `answer` among `ops` (`ids[i]` being `ops[i]`'s id and `logs[i]` its log), those beyond
/// what the asker sent, `asked`: what `respond_since` sends.
pub(crate) fn beyond(ops: &[Op], ids: &[OpId], logs: &[Option<LogId>], answer: &[usize], asked: &Ask) -> Vec<usize> {
    let all = LogOps::all(ops, ids, logs);
    let loose: HashSet<OpId> = asked.loose.iter().copied().collect();
    let mut below: HashMap<LogId, HashSet<OpId>> = HashMap::new();
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

/// Where an op comes in a reply (`Lab::reply`), which a peer sends a page at a time: by its depth, then its id.
pub type Place = (u64, OpId);

/// The place of `op` in a reply. An op is one deeper than the deepest op its device held when it made it, so none
/// comes ahead of an op it builds on: a device that takes a reply a page at a time holds an op's past in the reply by
/// the time the op arrives, and asks on after the last place it got.
pub fn place(op: &Op) -> Place {
    (op.depth, op.id())
}

/// Every fork among `ops`: two ops of one device in one log where neither builds on the other, the smaller id first.
/// Only each log's closed part counts, where the whole past of both is held, and only the signers some vault in what
/// `ops` say lists as its devices: a passkey signs on several devices at once.
pub fn forks(ops: &[Op]) -> Vec<(OpId, OpId)> {
    let ids: Vec<OpId> = ops.iter().map(Op::id).collect();
    forks_in(ops, &ids, &view(ops))
}

/// `forks`, given each op's id and the view `st` of `ops`.
pub(crate) fn forks_in(ops: &[Op], ids: &[OpId], st: &State) -> Vec<(OpId, OpId)> {
    let device = |s: SignerId| st.vaults().iter().any(|v| v.devices.contains(&s));
    let mut out = vec![];
    for log in LogOps::all(ops, ids, &logs_of(ops, ids)).values() {
        let mut by_author: BTreeMap<SignerId, Vec<OpId>> = BTreeMap::new();
        for id in log.closed() {
            let author = log.by_id[&id].author;
            if device(author) {
                by_author.entry(author).or_default().push(id);
            }
        }
        for mine in by_author.values_mut() {
            mine.sort();
            let past: Vec<HashSet<OpId>> = mine.iter().map(|id| log.ancestors(&log.by_id[id].parents)).collect();
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
