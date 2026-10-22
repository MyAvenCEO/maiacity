//! A device's stored view (M1 of the master plan, `V1_view_steps_on` in `StoredView.lean`): its replay, as bytes it
//! keeps between unlocks and steps new edits on (`replay_on`), so that it never replays every edit it holds again.
//! The edits themselves stay in its logs: the view names how many of them it replayed and the hash of their ids in the
//! one order, and takes them back from there. What the device made of them comes whole: which stood, the state, which
//! signers acted for the vaults the checkpoints cover, its resolve's choice, and the place it steps on from (`Tail`),
//! whose states, close to the state at the end, come as the runs of items they share with it and their own items
//! between (`put_items`). Nothing that follows from the rest is kept: a state's lookups, and the parents, depths and
//! checkpoints of the edits, are worked out again as the view is read.
//!
//! The bytes are the device's own, sealed with its shelf key for this engine alone (`Lab::warming`): a view is read only
//! by the build that wrote it. One that doesn't read back whole, or names other edits than the device holds, is no
//! view, and the device replays every edit again.

use std::collections::HashMap;
use std::hash::Hash;
use std::sync::Arc;

use super::{order_ids, watched, Edit, Entry, Issued, Listed, Replay, Seals, State, Tail, Vault, Write};
use crate::encode::Encode;
use crate::id::{AudienceId, EditId, EntryId, ShareId, SignerId, VaultId};
use crate::keys::{KeyFam, KeyName, PublicKey, Seal};
use crate::policy::{Kind, Principal, Proposal, Share};
use crate::wire::{Decode, Reader, WireError};

/// What every stored view starts with: version 2, which keeps no resolve's choice, as trying a removal replays only the
/// edits that say who may do what (`V2_removals_read_trust`).
const VIEW: &[u8] = b"avenDB view 2\n";

impl Encode for Vault {
    fn encode(&self, out: &mut Vec<u8>) {
        self.id.encode(out);
        self.kind.encode(out);
        self.owners.encode(out);
        self.threshold.encode(out);
        self.devices.encode(out);
        self.root.encode(out);
    }
}

impl Decode for Vault {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Vault {
            id: VaultId::decode(r)?,
            kind: Kind::decode(r)?,
            owners: r.seq::<Principal>(1)?,
            threshold: u32::decode(r)?,
            devices: r.seq(32)?,
            root: r.option()?,
        })
    }
}

impl Encode for Issued {
    fn encode(&self, out: &mut Vec<u8>) {
        self.id.encode(out);
        self.share.encode(out);
        self.chain.encode(out);
        self.intake.encode(out);
        self.commitment.encode(out);
    }
}

impl Decode for Issued {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Issued {
            id: ShareId::decode(r)?,
            share: Share::decode(r)?,
            chain: r.seq::<ShareId>(32)?.into(),
            intake: r.seq::<ShareId>(32)?.into(),
            commitment: r.option()?,
        })
    }
}

impl Encode for Entry {
    fn encode(&self, out: &mut Vec<u8>) {
        self.id.encode(out);
        self.vault.encode(out);
        self.stays.encode(out);
        self.creator.encode(out);
        self.creation.encode(out);
        self.intake.encode(out);
        self.retags.encode(out);
    }
}

impl Decode for Entry {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let (id, vault) = (EntryId::decode(r)?, VaultId::decode(r)?);
        let mut stays = vec![];
        for _ in 0..r.count(33)? {
            stays.push((r.option::<EditId>()?, AudienceId::decode(r)?));
        }
        Ok(Entry {
            id,
            vault,
            stays,
            creator: VaultId::decode(r)?,
            creation: EditId::decode(r)?,
            intake: r.seq(32)?,
            retags: r.seq(32)?,
        })
    }
}

impl Encode for Write {
    fn encode(&self, out: &mut Vec<u8>) {
        self.edit.encode(out);
        self.author.encode(out);
        self.actor.encode(out);
        self.entry.encode(out);
        self.stay.encode(out);
        self.epoch.encode(out);
        self.deps.encode(out);
        self.proposal.encode(out);
        self.via.encode(out);
        self.first.encode(out);
        self.audience.encode(out);
        self.shares.encode(out);
    }
}

impl Decode for Write {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Write {
            edit: EditId::decode(r)?,
            author: SignerId::decode(r)?,
            actor: VaultId::decode(r)?,
            entry: EntryId::decode(r)?,
            stay: r.option()?,
            epoch: u64::decode(r)?,
            deps: r.seq(32)?,
            proposal: Proposal::decode(r)?,
            via: r.seq(32)?,
            first: bool::decode(r)?,
            audience: AudienceId::decode(r)?,
            shares: r.seq(32)?,
        })
    }
}

impl Encode for Seal {
    fn encode(&self, out: &mut Vec<u8>) {
        self.secret.encode(out);
        self.to.encode(out);
    }
}

impl Decode for Seal {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Seal { secret: KeyName::decode(r)?, to: KeyName::decode(r)? })
    }
}

/* Items, as they differ from other items */

/// The items `t`, as they differ from the items `r`, where `at` finds an item of `r` by its key: the runs of `r`'s items
/// it holds (`0`, from where, how many) and the items of its own between them (`1`, the item), in order. Against no
/// items, every item its own.
fn put_items<T: PartialEq + Encode, K: Eq + Hash>(
    out: &mut Vec<u8>,
    r: &[T],
    t: &[T],
    key: impl Fn(&T) -> K,
    at: &HashMap<K, usize>,
) {
    enum Run<'a, T> {
        Theirs(usize, usize),
        Own(&'a T),
    }
    let mut runs: Vec<Run<'_, T>> = vec![];
    // where in `r` the run of its items goes on, if the last run is one
    let mut next = None;
    for x in t {
        match next {
            Some(j) if r.get(j) == Some(x) => {
                if let Some(Run::Theirs(_, n)) = runs.last_mut() {
                    *n += 1;
                }
                next = Some(j + 1);
            }
            _ => match at.get(&key(x)).copied().filter(|&j| r.get(j) == Some(x)) {
                Some(j) => {
                    runs.push(Run::Theirs(j, 1));
                    next = Some(j + 1);
                }
                None => {
                    runs.push(Run::Own(x));
                    next = None;
                }
            },
        }
    }
    (runs.len() as u32).encode(out);
    for run in runs {
        match run {
            Run::Theirs(from, n) => {
                out.push(0);
                (from as u32).encode(out);
                (n as u32).encode(out);
            }
            Run::Own(x) => {
                out.push(1);
                x.encode(out);
            }
        }
    }
}

/// The items `put_items` wrote, against `r`'s.
fn items<T: Clone>(
    rd: &mut Reader<'_>,
    r: &[T],
    item: impl Fn(&mut Reader<'_>) -> Result<T, WireError>,
) -> Result<Vec<T>, WireError> {
    let n = rd.count(1)?;
    let mut out = Vec::with_capacity(r.len());
    for _ in 0..n {
        match rd.u8()? {
            0 => {
                let (from, len) = (u32::decode(rd)? as usize, u32::decode(rd)? as usize);
                let run = from.checked_add(len).and_then(|to| r.get(from..to)).ok_or(WireError::Short)?;
                out.extend_from_slice(run);
            }
            1 => out.push(item(rd)?),
            _ => return Err(WireError::Unknown),
        }
    }
    Ok(out)
}

/// The place of each item of `xs`, by its key.
fn places<T, K: Eq + Hash>(xs: &[T], key: impl Fn(&T) -> K) -> HashMap<K, usize> {
    xs.iter().enumerate().map(|(i, x)| (key(x), i)).collect()
}

/// A collection of state `t`, against the same of state `r`: `0` where it is that one itself, else `1` and how it
/// differs.
fn put_vec<T: PartialEq + Encode, K: Eq + Hash>(
    out: &mut Vec<u8>,
    r: &Arc<Vec<T>>,
    t: &Arc<Vec<T>>,
    key: impl Fn(&T) -> K,
    at: &HashMap<K, usize>,
) {
    if Arc::ptr_eq(r, t) {
        out.push(0);
    } else {
        out.push(1);
        put_items(out, r, t, key, at);
    }
}

/// The collection `put_vec` wrote, against `r`.
fn vec_of<T: Clone>(
    rd: &mut Reader<'_>,
    r: &Arc<Vec<T>>,
    item: impl Fn(&mut Reader<'_>) -> Result<T, WireError>,
) -> Result<Arc<Vec<T>>, WireError> {
    match rd.u8()? {
        0 => Ok(r.clone()),
        1 => Ok(Arc::new(items(rd, r, item)?)),
        _ => Err(WireError::Unknown),
    }
}

/// A list without repeats, as `put_vec` writes a collection.
fn put_listed<T: Copy + Eq + Hash + Encode>(out: &mut Vec<u8>, r: &Arc<Listed<T>>, t: &Arc<Listed<T>>) {
    if Arc::ptr_eq(r, t) {
        out.push(0);
    } else {
        out.push(1);
        put_items(out, &r.list, &t.list, |x| *x, &places(&r.list, |x| *x));
    }
}

/// The list `put_listed` wrote, against `r`.
fn listed_of<T: Copy + Eq + Hash + Decode>(rd: &mut Reader<'_>, r: &Arc<Listed<T>>) -> Result<Arc<Listed<T>>, WireError> {
    match rd.u8()? {
        0 => Ok(r.clone()),
        1 => {
            let list = items(rd, &r.list, T::decode)?;
            let set = list.iter().copied().collect();
            Ok(Arc::new(Listed { list, set }))
        }
        _ => Err(WireError::Unknown),
    }
}

/// A map of state `t`, against the same of state `r`: `0` where it is that one itself, else `1`, the keys it lacks,
/// and the keys it holds otherwise, with their values, smallest first.
fn put_map<K: Ord + Hash + Encode, V: PartialEq>(
    out: &mut Vec<u8>,
    r: &Arc<HashMap<K, V>>,
    t: &Arc<HashMap<K, V>>,
    value: impl Fn(&V, &mut Vec<u8>),
) {
    if Arc::ptr_eq(r, t) {
        out.push(0);
        return;
    }
    out.push(1);
    let mut gone: Vec<&K> = r.keys().filter(|k| !t.contains_key(k)).collect();
    gone.sort();
    let mut set: Vec<(&K, &V)> = t.iter().filter(|(k, v)| r.get(k) != Some(v)).collect();
    set.sort_by_key(|(k, _)| *k);
    (gone.len() as u32).encode(out);
    gone.iter().for_each(|k| k.encode(out));
    (set.len() as u32).encode(out);
    for (k, v) in set {
        k.encode(out);
        value(v, out);
    }
}

/// The map `put_map` wrote, against `r`.
fn map_of<K: Clone + Eq + Hash + Decode, V: Clone>(
    rd: &mut Reader<'_>,
    r: &Arc<HashMap<K, V>>,
    value: impl Fn(&mut Reader<'_>) -> Result<V, WireError>,
) -> Result<Arc<HashMap<K, V>>, WireError> {
    match rd.u8()? {
        0 => Ok(r.clone()),
        1 => {
            let mut m = (**r).clone();
            for _ in 0..rd.count(1)? {
                m.remove(&K::decode(rd)?);
            }
            for _ in 0..rd.count(1)? {
                let k = K::decode(rd)?;
                m.insert(k, value(rd)?);
            }
            Ok(Arc::new(m))
        }
        _ => Err(WireError::Unknown),
    }
}

fn put_shares(v: &Arc<[ShareId]>, out: &mut Vec<u8>) {
    v.encode(out);
}

fn shares_of(rd: &mut Reader<'_>) -> Result<Arc<[ShareId]>, WireError> {
    Ok(rd.seq::<ShareId>(32)?.into())
}

fn put_places(v: &Vec<usize>, out: &mut Vec<u8>) {
    (v.len() as u32).encode(out);
    v.iter().for_each(|&i| (i as u32).encode(out));
}

fn places_of(rd: &mut Reader<'_>) -> Result<Vec<usize>, WireError> {
    Ok(rd.seq::<u32>(4)?.into_iter().map(|i| i as usize).collect())
}

/* States */

/// State `t`, against state `r`: each collection as it differs from `r`'s (`put_vec`, `put_map`). What `t` looks up in
/// them is worked out again as it is read (`state_of`).
fn put_state(out: &mut Vec<u8>, r: &State, t: &State) {
    debug_assert!(t.narrow.is_empty() && t.late.is_none(), "a state between two edits");
    put_vec(out, &r.vaults, &t.vaults, |v| v.id, &r.vault_at);
    put_vec(out, &r.shares, &t.shares, |c| c.id, &r.share_at);
    put_map(out, &r.held, &t.held, put_places);
    put_listed(out, &r.revoked, &t.revoked);
    put_vec(out, &r.entries, &t.entries, |en| en.id, &r.entry_at);
    put_listed(out, &r.born, &t.born);
    put_vec(out, &r.writes, &t.writes, |w| w.edit, &r.write_at);
    put_map(out, &r.audiences, &t.audiences, put_shares);
    put_map(out, &r.epochs, &t.epochs, |e, out| e.encode(out));
    put_map(out, &r.moved, &t.moved, |id, out| id.encode(out));
    if Arc::ptr_eq(&r.seals, &t.seals) {
        out.push(0);
    } else {
        out.push(1);
        put_items(out, &r.seals.list, &t.seals.list, |s| *s, &places(&r.seals.list, |s| *s));
    }
    put_listed(out, &r.published, &t.published);
    put_map(out, &r.seal_keys, &t.seal_keys, |k, out| k.encode(out));
    put_map(out, &r.marks, &t.marks, put_shares);
}

/// The state `put_state` wrote against `r`, with its lookups: those of `r` where a collection is `r`'s own.
fn state_of(rd: &mut Reader<'_>, r: &State) -> Result<State, WireError> {
    let vaults = vec_of(rd, &r.vaults, Vault::decode)?;
    let vault_at = match Arc::ptr_eq(&vaults, &r.vaults) {
        true => r.vault_at.clone(),
        false => Arc::new(places(&vaults, |v| v.id)),
    };
    let shares = vec_of(rd, &r.shares, Issued::decode)?;
    let (share_at, over) = match Arc::ptr_eq(&shares, &r.shares) {
        true => (r.share_at.clone(), r.over.clone()),
        false => {
            let mut over: HashMap<VaultId, Vec<usize>> = HashMap::new();
            for (i, c) in shares.iter().enumerate() {
                over.entry(c.share.over).or_default().push(i);
            }
            (Arc::new(places(&shares, |c| c.id)), Arc::new(over))
        }
    };
    let held = map_of(rd, &r.held, places_of)?;
    let revoked = listed_of(rd, &r.revoked)?;
    let entries = vec_of(rd, &r.entries, Entry::decode)?;
    let born = listed_of(rd, &r.born)?;
    let writes = vec_of(rd, &r.writes, Write::decode)?;
    let audiences = map_of(rd, &r.audiences, shares_of)?;
    let epochs = map_of(rd, &r.epochs, u64::decode)?;
    let moved = map_of::<(KeyFam, u64), EditId>(rd, &r.moved, EditId::decode)?;
    let seals = match rd.u8()? {
        0 => r.seals.clone(),
        1 => {
            let mut seals = Seals::default();
            items(rd, &r.seals.list, Seal::decode)?.into_iter().for_each(|s| seals.add(s));
            Arc::new(seals)
        }
        _ => return Err(WireError::Unknown),
    };
    let published = listed_of::<KeyName>(rd, &r.published)?;
    let seal_keys = map_of(rd, &r.seal_keys, PublicKey::decode)?;
    let marks = map_of(rd, &r.marks, shares_of)?;
    let same = Arc::ptr_eq(&entries, &r.entries) && Arc::ptr_eq(&writes, &r.writes);
    let mut st = State {
        vaults,
        vault_at,
        shares,
        share_at,
        held,
        over,
        revoked,
        entries,
        entry_at: r.entry_at.clone(),
        born,
        writes,
        write_at: r.write_at.clone(),
        by_entry: r.by_entry.clone(),
        audiences,
        in_use: r.in_use.clone(),
        epochs,
        moved,
        seals,
        published,
        seal_keys,
        narrow: vec![],
        late: None,
        marks,
    };
    if !same {
        st.index_entries();
    }
    Ok(st)
}

/* Replays */

/// The hash of the ids of a replay's edits, in their order: which edits a view is of.
fn ids_hash(ids: &[EditId]) -> [u8; 32] {
    let mut h = blake3::Hasher::new();
    ids.iter().for_each(|id| {
        h.update(&id.0);
    });
    *h.finalize().as_bytes()
}

impl Replay {
    /// Its stored view, the replay of the first `held` edits a device holds (`policy::view`): how many, the hash of
    /// their ids in the one order, which stood, the state, the signers that acted for the checkpoints' vaults, and the
    /// place it steps on from, each of whose states as it differs from the state after it.
    pub fn to_view(&self, held: usize) -> Vec<u8> {
        let mut out = VIEW.to_vec();
        (held as u64).encode(&mut out);
        ids_hash(&self.ids).encode(&mut out);
        (self.stood.len() as u32).encode(&mut out);
        let mut bits = vec![0u8; self.stood.len().div_ceil(8)];
        for (i, _) in self.stood.iter().enumerate().filter(|(_, s)| **s) {
            bits[i / 8] |= 1 << (i % 8);
        }
        out.extend(bits);
        put_state(&mut out, &State::default(), &self.state);
        let mut acts: Vec<&(EditId, VaultId)> = self.acts.iter().collect();
        acts.sort();
        (acts.len() as u32).encode(&mut out);
        acts.iter().for_each(|a| a.encode(&mut out));
        match &self.tail {
            None => out.push(0),
            Some(tail) => {
                out.push(1);
                (tail.at as u64).encode(&mut out);
                put_state(&mut out, &self.state, &tail.state);
                match &tail.base {
                    None => out.push(0),
                    Some(base) => {
                        out.push(1);
                        put_state(&mut out, &tail.state, base);
                    }
                }
                for places in [&tail.cands, &tail.tried] {
                    put_places(places, &mut out);
                }
            }
        }
        out
    }

    /// The replay `to_view` made `bytes` of, of the first edits of `edits`, `ids` being their ids, and how many: none
    /// where the bytes are no view, or of other edits.
    pub fn from_view(bytes: &[u8], edits: &[Edit], ids: &[EditId]) -> Option<(Replay, usize)> {
        let mut rd = Reader::new(bytes.strip_prefix(VIEW)?);
        let held = u64::decode(&mut rd).ok()? as usize;
        let (held_edits, held_ids) = (edits.get(..held)?, ids.get(..held)?);
        let (edits, ids) = order_ids(held_edits, held_ids);
        if <[u8; 32]>::decode(&mut rd).ok()? != ids_hash(&ids) {
            return None;
        }
        let mut read = || -> Result<Replay, WireError> {
            let n = u32::decode(&mut rd)? as usize;
            if n != ids.len() {
                return Err(WireError::Unknown);
            }
            let bits = rd.take(n.div_ceil(8))?;
            let stood = (0..n).map(|i| bits[i / 8] & (1 << (i % 8)) != 0).collect();
            let state = state_of(&mut rd, &State::default())?;
            let acts = rd.seq::<(EditId, VaultId)>(64)?.into_iter().collect();
            let tail = match rd.u8()? {
                0 => None,
                1 => {
                    let at = u64::decode(&mut rd)? as usize;
                    let tail_state = state_of(&mut rd, &state)?;
                    let base = match rd.u8()? {
                        0 => None,
                        1 => Some(state_of(&mut rd, &tail_state)?),
                        _ => return Err(WireError::Unknown),
                    };
                    let (cands, tried) = (places_of(&mut rd)?, places_of(&mut rd)?);
                    if at > n || cands.iter().chain(&tried).any(|&i| i >= n) {
                        return Err(WireError::Unknown);
                    }
                    // what follows from the edits: as `replay_ids` works it out, and each replay stepped on keeps
                    let parents = edits.iter().flat_map(|e| e.parents.iter().copied()).collect();
                    let depths: HashMap<EditId, u64> =
                        held_ids.iter().copied().zip(held_edits.iter().map(|e| e.depth)).collect();
                    let covered = watched(&edits);
                    Some(Tail { at, state: tail_state, base, cands, tried, parents, covered, depths })
                }
                _ => return Err(WireError::Unknown),
            };
            if !rd.done() {
                return Err(WireError::Trailing);
            }
            Ok(Replay { edits: vec![], ids: vec![], stood, state, acts, tail })
        };
        let replay = read().ok()?;
        Some((Replay { edits, ids, ..replay }, held))
    }

    /// The place it steps on from is the same as `o`'s, state for state: what `to_view` and `from_view` keep beside
    /// what makes two replays the same (`PartialEq`).
    pub fn same_tail(&self, o: &Replay) -> bool {
        match (&self.tail, &o.tail) {
            (None, None) => true,
            (Some(a), Some(b)) => {
                (a.at, &a.state, &a.base, &a.cands, &a.tried, &a.parents, &a.covered, &a.depths)
                    == (b.at, &b.state, &b.base, &b.cands, &b.tried, &b.parents, &b.covered, &b.depths)
            }
            _ => false,
        }
    }
}
