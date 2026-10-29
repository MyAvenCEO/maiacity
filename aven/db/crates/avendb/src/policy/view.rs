//! A device's stored view (M1 of the master plan, `V1_view_steps_on` in `StoredView.lean`): its replay, as bytes it
//! keeps between unlocks and steps new edits on (`replay_on`), so that it never replays every edit it holds again.
//! The edits themselves stay in its logs: the view names how many of them it replayed and the hash of their ids in the
//! one order, and takes them back from there. What the device made of them comes whole: which stood, the state, which
//! signers acted for the vaults the checkpoints cover, its resolve's choice, and the place it steps on from (`Tail`),
//! whose states, close to the state at the end, come as the runs of items they share with it and their own items
//! between (`put_items`), with what its tail made of the edits it holds (`put_derived`): their depths, the parents they
//! build on that it doesn't hold, what the checkpoints among them cover, the writes that stood before and after its
//! place, and the grants among them, so that a view opens without reading an edit it is of. Nothing else that follows
//! from the rest is kept: a state's lookups, and the order of the edits, are worked out again as the view is read.
//!
//! The bytes are the device's own, sealed with its shelf key to the replay rules they were worked out under
//! (`Lab::warming`, `ViewRules.lean`): a view is read by any build of the same rules and the same format (`VIEW`), or the
//! one before it (`VIEW_3`). One
//! that doesn't read back whole, or names other edits than the device holds, is no view, and the device replays every
//! edit again.

use std::collections::{HashMap, HashSet};
use std::hash::Hash;
use std::sync::Arc;

use super::{dangling, order_places, sorted, watched, Edit, Entry, Grants, Issued, Listed, Marks, Passed, Replay, Rung, Seals, State,
    Tail, Vault, Write};
use crate::encode::Encode;
use crate::id::{AudienceId, EditId, EntryId, ShareId, SignerId, VaultId};
use crate::keys::{KeyFam, KeyName, PublicKey, Seal};
use crate::policy::{Kind, Principal, Proposal, Share};
use crate::wire::{Decode, Reader, WireError};

/// Version 3 preserves cap-group bindings, which the canonical Share codec deliberately omits because the
/// enclosing Sharing edit carries them; version 4 keeps the rungs and marks before the place it steps on from
/// (`Tail::rungs`, `Marks`), so that a late edit after an unlock replays from the one before it, not every edit;
/// version 5 keeps what its tail made of the edits (`put_derived`), so that it opens without reading them.
/// A view of version 3 or 4 still reads, its tail's derivations worked out again from its edits, and one of version 3
/// as one whose tail keeps no rungs and no marks (`VIEW_3`): what a device made of its edits can't always be worked out
/// again from them, as edits held on a checkpoint's word stand only where a replay that stood them says so, so a newer
/// format never turns a device's own view into none.
const VIEW: &[u8] = b"avenDB view 5\n";

/// The formats before `VIEW`: the same, without its tail's derivations, and before that without rungs or marks.
const VIEW_4: &[u8] = b"avenDB view 4\n";
const VIEW_3: &[u8] = b"avenDB view 3\n";

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
        self.share.group.encode(out);
        self.chain.encode(out);
        self.intake.encode(out);
        self.commitment.encode(out);
    }
}

impl Decode for Issued {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let id = ShareId::decode(r)?;
        let mut share = Share::decode(r)?;
        share.group = r.option()?;
        Ok(Issued {
            id,
            share,
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
        self.signer.encode(out);
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
            signer: VaultId::decode(r)?,
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

/// A shared collection of state `t` (`imbl`), against the same of state `r`, as `put_vec` writes one.
fn put_shared<T: Clone + PartialEq + Encode, K: Eq + Hash>(
    out: &mut Vec<u8>,
    r: &imbl::Vector<T>,
    t: &imbl::Vector<T>,
    key: impl Fn(&T) -> K,
) {
    if r.ptr_eq(t) {
        out.push(0);
    } else {
        out.push(1);
        let (r, t): (Vec<T>, Vec<T>) = (r.iter().cloned().collect(), t.iter().cloned().collect());
        let at = places(&r, &key);
        put_items(out, &r, &t, key, &at);
    }
}

/// The collection `put_shared` wrote, against `r`: its runs of `r`'s items shared with `r`, not copied, and how many
/// of `r`'s first items it is, where it is just those (a tail's state, as it is before the edits after it).
fn shared_of<T: Clone>(
    rd: &mut Reader<'_>,
    r: &imbl::Vector<T>,
    item: impl Fn(&mut Reader<'_>) -> Result<T, WireError>,
) -> Result<(imbl::Vector<T>, Option<usize>), WireError> {
    match rd.u8()? {
        0 => Ok((r.clone(), Some(r.len()))),
        1 => {
            let n = rd.count(1)?;
            let mut out = imbl::Vector::new();
            // whether it is `r`'s first items so far
            let mut first = true;
            for _ in 0..n {
                match rd.u8()? {
                    0 => {
                        let (from, len) = (u32::decode(rd)? as usize, u32::decode(rd)? as usize);
                        let to = from.checked_add(len).filter(|&to| to <= r.len()).ok_or(WireError::Short)?;
                        first &= from == out.len();
                        out.append(r.skip(from).take(to - from));
                    }
                    1 => {
                        first = false;
                        out.push_back(item(rd)?);
                    }
                    _ => return Err(WireError::Unknown),
                }
            }
            let k = out.len();
            Ok((out, first.then_some(k)))
        }
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

fn put_places(v: &[usize], out: &mut Vec<u8>) {
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
    put_map(out, &r.held, &t.held, |v, out| put_places(v, out));
    put_listed(out, &r.revoked, &t.revoked);
    put_shared(out, &r.entries, &t.entries, |en| en.id);
    put_listed(out, &r.born, &t.born);
    put_shared(out, &r.writes, &t.writes, |w| w.edit);
    put_map(out, &r.audiences, &t.audiences, put_shares);
    put_map(out, &r.epochs, &t.epochs, |e, out| e.encode(out));
    put_map(out, &r.moved, &t.moved, |id, out| id.encode(out));
    if Arc::ptr_eq(&r.seals, &t.seals) {
        out.push(0);
    } else {
        out.push(1);
        let (rs, ts): (Vec<Seal>, Vec<Seal>) = (r.seals.list.iter().copied().collect(), t.seals.list.iter().copied().collect());
        put_items(out, &rs, &ts, |s| *s, &places(&rs, |s| *s));
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
    let (entries, _) = shared_of(rd, &r.entries, Entry::decode)?;
    let born = listed_of(rd, &r.born)?;
    let (writes, first) = shared_of(rd, &r.writes, Write::decode)?;
    let audiences = map_of(rd, &r.audiences, shares_of)?;
    let epochs = map_of(rd, &r.epochs, u64::decode)?;
    let moved = map_of::<(KeyFam, u64), EditId>(rd, &r.moved, EditId::decode)?;
    let seals = match rd.u8()? {
        0 => r.seals.clone(),
        1 => {
            let mut seals = Seals::default();
            let rs: Vec<Seal> = r.seals.list.iter().copied().collect();
            items(rd, &rs, Seal::decode)?.into_iter().for_each(|s| seals.add(s));
            Arc::new(seals)
        }
        _ => return Err(WireError::Unknown),
    };
    let published = listed_of::<KeyName>(rd, &r.published)?;
    let seal_keys = map_of(rd, &r.seal_keys, PublicKey::decode)?;
    let marks = map_of(rd, &r.marks, shares_of)?;
    let same = entries.ptr_eq(&r.entries) && writes.ptr_eq(&r.writes);
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
        // a tail's writes are the first of the state's after it: its places of them are the same, but of those after
        match first {
            Some(k) => st.index_first_writes(r, k),
            None => st.index_entries(),
        }
    }
    Ok(st)
}

/// A mark's state `t` as bytes, as it differs from the state `r` of the mark before it (`Marks`).
pub(super) fn put_mark(r: &State, t: &State) -> Vec<u8> {
    let mut out = vec![];
    put_state(&mut out, r, t);
    out
}

/// The state `put_mark` wrote against `r`: none where the bytes are no such state.
pub(super) fn mark_of(bytes: &[u8], r: &State) -> Option<State> {
    let mut rd = Reader::new(bytes);
    let st = state_of(&mut rd, r).ok()?;
    rd.done().then_some(st)
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
        encode_view(held, &self.ids, &self.stood, &self.state, &self.acts, self.tail.as_ref().map(TailView::of).as_ref(), true)
    }

    /// `to_view` as the format before (`VIEW_4`) wrote it: its tail without its derivations.
    #[doc(hidden)]
    pub fn to_view_4(&self, held: usize) -> Vec<u8> {
        encode_view(held, &self.ids, &self.stood, &self.state, &self.acts, self.tail.as_ref().map(TailView::of).as_ref(), false)
    }

    /// Only the owned inputs the canonical view encoder needs: no edit bodies or derived indexes.
    pub fn capture_view(&self) -> ViewCapture {
        ViewCapture {
            ids: self.ids.clone(), stood: self.stood.clone(), state: self.state.clone(), acts: self.acts.clone(),
            tail: self.tail.as_ref().map(TailView::of),
        }
    }

    /// The replay `to_view` made `bytes` of, of the first edits of `edits`, `ids` being their ids, and how many: none
    /// where the bytes are no view, or of other edits.
    pub fn from_view(bytes: &[u8], edits: &crate::policy::Edits, ids: &[EditId]) -> Option<(Replay, usize)> {
        Replay::from_view_ordered(bytes, edits, ids, |held| order_places(&edits[..held], &ids[..held]))
    }

    /// `from_view`, the one order of the first `held` edits being `order(held)`, as a log keeps it (`Log::order_of`):
    /// no edit read to order them.
    pub fn from_view_ordered(
        bytes: &[u8],
        edits: &crate::policy::Edits,
        ids: &[EditId],
        order: impl FnOnce(usize) -> Vec<usize>,
    ) -> Option<(Replay, usize)> {
        // a view of version 4 is one whose tail keeps no derivations, of version 3 no rungs and no marks either
        let (rest, laddered, derived) = match (bytes.strip_prefix(VIEW), bytes.strip_prefix(VIEW_4)) {
            (Some(rest), _) => (rest, true, true),
            (None, Some(rest)) => (rest, true, false),
            (None, None) => (bytes.strip_prefix(VIEW_3)?, false, false),
        };
        let mut rd = Reader::new(rest);
        let held = u64::decode(&mut rd).ok()? as usize;
        let (held_edits, held_ids) = (edits.get(..held)?, ids.get(..held)?);
        let order = order(held);
        let ids: Vec<EditId> = order.iter().map(|&p| held_ids[p]).collect();
        let edits = || order.iter().map(|&p| &held_edits[p]);
        if <[u8; 32]>::decode(&mut rd).ok()? != ids_hash(&ids) {
            return None;
        }
        let mut read = || -> Result<Replay, WireError> {
            let n = u32::decode(&mut rd)? as usize;
            if n != ids.len() {
                return Err(WireError::Unknown);
            }
            let bits = rd.take(n.div_ceil(8))?;
            let stood: Vec<bool> = (0..n).map(|i| bits[i / 8] & (1 << (i % 8)) != 0).collect();
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
                    // its rungs, each state as it differs from the tail's, and its marks as they are, every place before
                    // the next and the tail's
                    let mut rungs = vec![];
                    for _ in 0..if laddered { rd.count(9)? } else { 0 } {
                        let at = u64::decode(&mut rd)? as usize;
                        let state = state_of(&mut rd, &tail_state)?;
                        let base = match rd.u8()? {
                            0 => None,
                            1 => Some(state_of(&mut rd, &state)?),
                            _ => return Err(WireError::Unknown),
                        };
                        rungs.push(Rung { at, state, base });
                    }
                    let mut marks = Marks::default();
                    for _ in 0..if laddered { rd.count(12)? } else { 0 } {
                        let at = u64::decode(&mut rd)? as usize;
                        let len = u32::decode(&mut rd)? as usize;
                        marks.list.push((at, rd.take(len)?.into()));
                    }
                    let places = marks.list.iter().map(|m| m.0).chain(rungs.iter().map(|r| r.at)).chain([at]);
                    if !places.clone().zip(places.skip(1)).all(|(a, b)| a < b) {
                        return Err(WireError::Unknown);
                    }
                    // what its tail made of the edits, as it kept it; else as `replay_ids` works it out, and each replay
                    // stepped on keeps
                    let Derived { parents, covered, depths, passed, after, grants } = match derived {
                        true => derived_of(&mut rd, &ids)?,
                        false => {
                            let depths: HashMap<EditId, u64> =
                                held_ids.iter().copied().zip(held_edits.iter().map(|e| e.depth)).collect();
                            let held: Vec<&Edit> = edits().collect();
                            Derived {
                                parents: dangling(edits(), &depths),
                                covered: watched(edits()),
                                passed: Passed::of(sorted(&held, &ids, &stood, 0, at)),
                                after: Passed::of(sorted(&held, &ids, &stood, at, n)),
                                grants: Grants::of(edits().zip(ids.iter().copied())),
                                depths,
                            }
                        }
                    };
                    Some(Tail { at, state: tail_state, base, cands, tried, parents, covered, depths, passed, after, grants, rungs, marks })
                }
                _ => return Err(WireError::Unknown),
            };
            if !rd.done() {
                return Err(WireError::Trailing);
            }
            Ok(Replay { order: vec![], ids: vec![], stood, state, acts, tail })
        };
        let replay = read().ok()?;
        Some((Replay { order, ids, ..replay }, held))
    }

    /// The place it steps on from is the same as `o`'s, state for state: what `to_view` and `from_view` keep beside
    /// what makes two replays the same (`PartialEq`).
    pub fn same_tail(&self, o: &Replay) -> bool {
        match (&self.tail, &o.tail) {
            (None, None) => true,
            (Some(a), Some(b)) => {
                let rungs = |t: &Tail| t.rungs.iter().map(|r| (r.at, r.state.clone(), r.base.clone())).collect::<Vec<_>>();
                (a.at, &a.state, &a.base, &a.cands, &a.tried, &a.parents, &a.covered, &a.depths, &a.passed, &a.after, &a.grants)
                    == (b.at, &b.state, &b.base, &b.cands, &b.tried, &b.parents, &b.covered, &b.depths, &b.passed, &b.after, &b.grants)
                    && rungs(a) == rungs(b)
                    && a.marks.list == b.marks.list
            }
            _ => false,
        }
    }
}

/// Frozen input to the canonical encoder. Capturing copies IDs/bits/acts/tail positions;
/// State payloads are Arc-backed. Edit bodies and derived prefix maps are not copied.
pub struct ViewCapture {
    ids: Vec<EditId>,
    stood: Vec<bool>,
    state: State,
    acts: std::collections::HashSet<(EditId, VaultId)>,
    tail: Option<TailView>,
}
impl ViewCapture {
    pub fn encode(self, held: usize) -> Vec<u8> {
        encode_view(held, &self.ids, &self.stood, &self.state, &self.acts, self.tail.as_ref(), true)
    }
}

/// What a view keeps of the place a replay steps on from (`Tail`): its place, its state and base, its resolve's choice,
/// its rungs and its marks, their states sharing their items with the replay's; and what it made of the edits.
struct TailView {
    at: usize,
    state: State,
    base: Option<State>,
    cands: Vec<usize>,
    tried: Vec<usize>,
    rungs: Vec<Rung>,
    marks: Vec<(usize, Arc<[u8]>)>,
    derived: Derived,
}

impl TailView {
    fn of(t: &Tail) -> TailView {
        TailView {
            at: t.at, state: t.state.clone(), base: t.base.clone(), cands: t.cands.clone(), tried: t.tried.clone(),
            rungs: t.rungs.clone(), marks: t.marks.list.clone(),
            derived: Derived {
                parents: t.parents.clone(), covered: t.covered.clone(), depths: t.depths.clone(),
                passed: t.passed.clone(), after: t.after.clone(), grants: t.grants.clone(),
            },
        }
    }
}

/// What a replay's tail made of the edits it holds (`Tail`): the parents they build on that it doesn't hold, what the
/// checkpoints among them cover, the depth of each, the writes that stood before its place and after, and the grants.
struct Derived {
    parents: HashSet<EditId>,
    covered: HashMap<EditId, Vec<VaultId>>,
    depths: HashMap<EditId, u64>,
    passed: Passed,
    after: Passed,
    grants: Grants,
}

/// An edit a view names, by its place in the replay's order where it is one of its edits (`ids`), as most are, else by
/// its id behind `NOT_HELD`.
const NOT_HELD: u32 = u32::MAX;

fn put_edit(out: &mut Vec<u8>, id: &EditId, places: &HashMap<EditId, u32>) {
    match places.get(id) {
        Some(p) => p.encode(out),
        None => {
            NOT_HELD.encode(out);
            id.encode(out);
        }
    }
}

fn edit_of(rd: &mut Reader<'_>, ids: &[EditId]) -> Result<EditId, WireError> {
    match u32::decode(rd)? {
        NOT_HELD => EditId::decode(rd),
        p => ids.get(p as usize).copied().ok_or(WireError::Unknown),
    }
}

fn put_passed(out: &mut Vec<u8>, p: &Passed, places: &HashMap<EditId, u32>) {
    let mut wrote: Vec<(&EntryId, &Vec<EditId>)> = p.wrote.iter().collect();
    wrote.sort_by_key(|(e, _)| **e);
    (wrote.len() as u32).encode(out);
    for (e, ws) in wrote {
        e.encode(out);
        (ws.len() as u32).encode(out);
        ws.iter().for_each(|w| put_edit(out, w, places));
    }
    p.lost.encode(out);
}

fn passed_of(rd: &mut Reader<'_>, ids: &[EditId]) -> Result<Passed, WireError> {
    let mut wrote = HashMap::new();
    for _ in 0..rd.count(36)? {
        let e = EntryId::decode(rd)?;
        let ws = (0..rd.count(4)?).map(|_| edit_of(rd, ids)).collect::<Result<Vec<_>, _>>()?;
        wrote.insert(e, ws);
    }
    Ok(Passed { wrote, lost: bool::decode(rd)? })
}

/// What its tail made of the edits (`Derived`), the edits each by its place in `ids`, the replay's order: the depth of
/// each of `ids` in their order, where it holds one of each and no other, else each with its id; the rest each in the
/// order of its keys.
fn put_derived(out: &mut Vec<u8>, d: &Derived, ids: &[EditId]) {
    let places: HashMap<EditId, u32> = ids.iter().enumerate().map(|(p, id)| (*id, p as u32)).collect();
    let aligned = d.depths.len() == ids.len() && ids.iter().all(|id| d.depths.contains_key(id));
    match aligned {
        true => {
            out.push(0);
            ids.iter().for_each(|id| d.depths[id].encode(out));
        }
        false => {
            out.push(1);
            let mut depths: Vec<(&EditId, &u64)> = d.depths.iter().collect();
            depths.sort();
            (depths.len() as u32).encode(out);
            for (id, depth) in depths {
                put_edit(out, id, &places);
                depth.encode(out);
            }
        }
    }
    let mut parents: Vec<&EditId> = d.parents.iter().collect();
    parents.sort();
    (parents.len() as u32).encode(out);
    parents.iter().for_each(|p| p.encode(out));
    let mut covered: Vec<(&EditId, &Vec<VaultId>)> = d.covered.iter().collect();
    covered.sort();
    (covered.len() as u32).encode(out);
    for (id, vaults) in covered {
        put_edit(out, id, &places);
        vaults.encode(out);
    }
    put_passed(out, &d.passed, &places);
    put_passed(out, &d.after, &places);
    let mut parent: Vec<(&ShareId, &Option<ShareId>)> = d.grants.parent.iter().collect();
    parent.sort();
    (parent.len() as u32).encode(out);
    for (share, on) in parent {
        share.encode(out);
        on.encode(out);
    }
    let mut taken: Vec<&ShareId> = d.grants.taken.iter().collect();
    taken.sort();
    (taken.len() as u32).encode(out);
    taken.iter().for_each(|t| t.encode(out));
}

fn derived_of(rd: &mut Reader<'_>, ids: &[EditId]) -> Result<Derived, WireError> {
    let depths = match rd.u8()? {
        0 => ids.iter().map(|id| Ok((*id, u64::decode(rd)?))).collect::<Result<_, WireError>>()?,
        1 => (0..rd.count(12)?).map(|_| Ok((edit_of(rd, ids)?, u64::decode(rd)?))).collect::<Result<_, WireError>>()?,
        _ => return Err(WireError::Unknown),
    };
    let parents = rd.seq::<EditId>(32)?.into_iter().collect();
    let covered = (0..rd.count(8)?).map(|_| Ok((edit_of(rd, ids)?, rd.seq::<VaultId>(32)?)))
        .collect::<Result<_, WireError>>()?;
    let passed = passed_of(rd, ids)?;
    let after = passed_of(rd, ids)?;
    let parent = (0..rd.count(33)?).map(|_| Ok((ShareId::decode(rd)?, rd.option::<ShareId>()?)))
        .collect::<Result<_, WireError>>()?;
    let taken = rd.seq::<ShareId>(32)?.into_iter().collect();
    Ok(Derived { parents, covered, depths, passed, after, grants: Grants { parent, taken } })
}

fn encode_view(held: usize, ids: &[EditId], stood: &[bool], state: &State,
    acts: &std::collections::HashSet<(EditId, VaultId)>,
    tail: Option<&TailView>, derived: bool) -> Vec<u8> {
        let mut out = if derived { VIEW } else { VIEW_4 }.to_vec();
        (held as u64).encode(&mut out);
        ids_hash(ids).encode(&mut out);
        (stood.len() as u32).encode(&mut out);
        let mut bits = vec![0u8; stood.len().div_ceil(8)];
        for (i, _) in stood.iter().enumerate().filter(|(_, s)| **s) {
            bits[i / 8] |= 1 << (i % 8);
        }
        out.extend(bits);
        put_state(&mut out, &State::default(), state);
        let mut acts: Vec<&(EditId, VaultId)> = acts.iter().collect();
        acts.sort();
        (acts.len() as u32).encode(&mut out);
        acts.iter().for_each(|a| a.encode(&mut out));
        match tail {
            None => out.push(0),
            Some(t) => {
                out.push(1);
                (t.at as u64).encode(&mut out);
                put_state(&mut out, state, &t.state);
                match &t.base {
                    None => out.push(0),
                    Some(base) => {
                        out.push(1);
                        put_state(&mut out, &t.state, base);
                    }
                }
                for places in [&t.cands, &t.tried] {
                    put_places(places, &mut out);
                }
                (t.rungs.len() as u32).encode(&mut out);
                for r in &t.rungs {
                    (r.at as u64).encode(&mut out);
                    put_state(&mut out, &t.state, &r.state);
                    match &r.base {
                        None => out.push(0),
                        Some(base) => {
                            out.push(1);
                            put_state(&mut out, &r.state, base);
                        }
                    }
                }
                (t.marks.len() as u32).encode(&mut out);
                for (at, bytes) in &t.marks {
                    (*at as u64).encode(&mut out);
                    (bytes.len() as u32).encode(&mut out);
                    out.extend_from_slice(bytes);
                }
                if derived {
                    put_derived(&mut out, &t.derived, ids);
                }
            }
        }
        out
}
