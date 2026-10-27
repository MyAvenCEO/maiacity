//! What a device's store holds of its signed edits and McEliece keys (S7, bounded RAM).
//!
//! A page and a Mac hold them in memory, as ever. The server, whose vaults grow toward a million edits and more, holds
//! them in a spill (`Spill`) instead: each record appended once to a file in a folder of its own, in the server's
//! folder beside its bucket's cache, and only an index in memory, a few dozen bytes an edit, with the records it read
//! or took lately in a cache of `Spill::budget` bytes at most, the least lately used let go first. The spill is no
//! store of record: the bucket is (`avendb_net::edits`), and a spill is emptied as its server starts and filled again
//! as the device takes its edits back from the bucket, so a server whose folder is lost loses nothing.
//!
//! The spill changes nothing the device holds, proves or says: every record reads back as the very bytes that went in,
//! checked against the BLAKE3 hash of them its index keeps (a signed edit), or against its id, its hash (a McEliece
//! key), and a record that doesn't is a folder the server can't trust, which it says by panicking, never by holding or
//! serving other bytes. Signatures were checked before an edit is held, as ever (`Lab::fresh`); a spill holds only what
//! passed.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::Hash;
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::id::{BlobId, EditId, SignerId};
use crate::sign::{Signed, SignerKeys};
use crate::wire::Wire as _;

/// Where a device's store spills what it holds, and how many bytes of it it keeps at hand in memory at most.
#[derive(Clone, Debug)]
pub struct Spill {
    dir: PathBuf,
    budget: usize,
}

impl Spill {
    /// A spill in folder `dir`, which it empties first (what was there is a cache of an older run), keeping `budget`
    /// bytes of what it read or took lately at hand, half for edits and half for keys.
    pub fn new(dir: impl Into<PathBuf>, budget: usize) -> io::Result<Spill> {
        let dir = dir.into();
        if dir.exists() {
            fs::remove_dir_all(&dir)?;
        }
        fs::create_dir_all(&dir)?;
        Ok(Spill { dir, budget })
    }

    /// The bytes it keeps at hand at most.
    pub fn budget(&self) -> usize {
        self.budget
    }

    /// The folder it spills into.
    pub fn dir(&self) -> &Path {
        &self.dir
    }
}

/// The numbers of the spill files made in this process, each new one's.
static FILES: AtomicU64 = AtomicU64::new(0);

/// A spill's file of records, appended to and read at; removed once nothing names it.
struct File {
    path: PathBuf,
    file: Mutex<(fs::File, u64)>,
}

impl File {
    fn new(spill: &Spill, what: &str) -> io::Result<File> {
        let n = FILES.fetch_add(1, Ordering::Relaxed);
        let path = spill.dir.join(format!("{what}-{}-{n}", std::process::id()));
        let file = fs::OpenOptions::new().create_new(true).read(true).append(true).open(&path)?;
        Ok(File { path, file: Mutex::new((file, 0)) })
    }

    /// Appends `bytes`: where they start.
    fn append(&self, bytes: &[u8]) -> io::Result<u64> {
        let mut held = self.file.lock().expect("a spill file");
        let at = held.1;
        held.0.write_all(bytes)?;
        held.1 += bytes.len() as u64;
        Ok(at)
    }

    fn read(&self, at: u64, len: u32) -> io::Result<Vec<u8>> {
        let mut bytes = vec![0; len as usize];
        let held = self.file.lock().expect("a spill file");
        read_at(&held.0, &mut bytes, at)?;
        Ok(bytes)
    }

    /// The bytes it holds, gone over or not.
    fn len(&self) -> u64 {
        self.file.lock().expect("a spill file").1
    }
}

#[cfg(unix)]
fn read_at(file: &fs::File, bytes: &mut [u8], at: u64) -> io::Result<()> {
    std::os::unix::fs::FileExt::read_exact_at(file, bytes, at)
}

#[cfg(not(unix))]
fn read_at(file: &fs::File, bytes: &mut [u8], at: u64) -> io::Result<()> {
    use std::io::{Read as _, Seek as _, SeekFrom};
    let mut file = file.try_clone()?;
    file.seek(SeekFrom::Start(at))?;
    file.read_exact(bytes)
}

impl Drop for File {
    fn drop(&mut self) {
        fs::remove_file(&self.path).ok();
    }
}

/// What a spill holds: a value that goes to bytes and comes back from them, checked against its key.
pub(crate) trait Record: Clone {
    type Key: Copy + Eq + Hash;
    fn bytes(&self) -> Vec<u8>;
    /// The value `bytes` hold, if they hold the very value `key` names.
    fn from_bytes(key: &Self::Key, bytes: &[u8]) -> Option<Self>;
    /// Its size in memory, about.
    fn size(&self) -> usize;
}

impl Record for Arc<Signed> {
    type Key = EditId;
    fn bytes(&self) -> Vec<u8> {
        self.to_wire()
    }
    fn from_bytes(id: &EditId, bytes: &[u8]) -> Option<Self> {
        let signed = Signed::from_wire(bytes).ok()?;
        (signed.edit.id() == *id).then(|| Arc::new(signed))
    }
    fn size(&self) -> usize {
        // what it holds on the wire, and as much again for how memory holds it
        2 * self.to_wire().len()
    }
}

impl Record for Arc<[u8]> {
    type Key = BlobId;
    fn bytes(&self) -> Vec<u8> {
        self.to_vec()
    }
    fn from_bytes(id: &BlobId, bytes: &[u8]) -> Option<Self> {
        (BlobId::of(bytes) == *id).then(|| Arc::from(bytes))
    }
    fn size(&self) -> usize {
        self.len()
    }
}

/// Where a record is in its spill's file: its place, its length, and the BLAKE3 hash of its bytes.
#[derive(Clone, Copy)]
struct Slot {
    at: u64,
    len: u32,
    sum: [u8; 32],
}

/// The records a spill read or took lately, each with when it was used last, `budget` bytes of them at most.
struct Hot<V: Record> {
    held: HashMap<V::Key, (V, u64, usize)>,
    bytes: usize,
    budget: usize,
    tick: u64,
}

impl<V: Record> Hot<V> {
    fn new(budget: usize) -> Hot<V> {
        Hot { held: HashMap::new(), bytes: 0, budget, tick: 0 }
    }

    fn get(&mut self, k: &V::Key) -> Option<V> {
        self.tick += 1;
        let tick = self.tick;
        self.held.get_mut(k).map(|(v, used, _)| {
            *used = tick;
            v.clone()
        })
    }

    fn put(&mut self, k: V::Key, v: V) {
        let size = v.size();
        if size > self.budget {
            self.remove(&k);
            return;
        }
        self.tick += 1;
        if let Some((_, _, was)) = self.held.insert(k, (v, self.tick, size)) {
            self.bytes -= was;
        }
        self.bytes += size;
        if self.bytes > self.budget {
            // the least lately used go, down to three quarters of its budget, so it sorts seldom
            let mut used: Vec<(u64, V::Key)> = self.held.iter().map(|(k, (_, used, _))| (*used, *k)).collect();
            used.sort_unstable_by_key(|(used, _)| *used);
            for (_, k) in used {
                if self.bytes <= self.budget / 4 * 3 {
                    break;
                }
                self.remove(&k);
            }
        }
    }

    fn remove(&mut self, k: &V::Key) {
        if let Some((_, _, size)) = self.held.remove(k) {
            self.bytes -= size;
        }
    }
}

/// A spill of records of one kind: its file, the index of what it holds, and those at hand.
struct Spilled<V: Record> {
    spill: Spill,
    what: &'static str,
    file: Arc<File>,
    at: HashMap<V::Key, Slot>,
    hot: Mutex<Hot<V>>,
}

impl<V: Record> Spilled<V> {
    fn new(spill: &Spill, what: &'static str) -> io::Result<Spilled<V>> {
        let file = Arc::new(File::new(spill, what)?);
        let hot = Mutex::new(Hot::new(spill.budget / 2));
        Ok(Spilled { spill: spill.clone(), what, file, at: HashMap::new(), hot })
    }

    fn get(&self, k: &V::Key) -> Option<V> {
        let slot = *self.at.get(k)?;
        if let Some(v) = self.hot.lock().expect("hot").get(k) {
            return Some(v);
        }
        let bytes = self.file.read(slot.at, slot.len).unwrap_or_else(|e| panic!("avendb: its spill of {} doesn't read: {e}", self.what));
        let whole = *blake3::hash(&bytes).as_bytes() == slot.sum;
        let v = whole.then(|| V::from_bytes(k, &bytes)).flatten();
        let v = v.unwrap_or_else(|| panic!("avendb: its spill of {} changed in its folder: a disk it can't trust", self.what));
        self.hot.lock().expect("hot").put(*k, v.clone());
        Some(v)
    }

    fn insert(&mut self, k: V::Key, v: V) {
        let bytes = v.bytes();
        let at = self.file.append(&bytes).unwrap_or_else(|e| panic!("avendb: its spill of {} takes nothing: {e}", self.what));
        let len = u32::try_from(bytes.len()).expect("a record under 4 GB");
        self.at.insert(k, Slot { at, len, sum: *blake3::hash(&bytes).as_bytes() });
        self.hot.lock().expect("hot").put(k, v);
    }

    fn remove(&mut self, k: &V::Key) {
        self.at.remove(k);
        self.hot.get_mut().expect("hot").remove(k);
    }
}

impl<V: Record> Clone for Spilled<V> {
    fn clone(&self) -> Spilled<V> {
        let hot = Mutex::new(Hot::new(self.spill.budget / 2));
        Spilled { spill: self.spill.clone(), what: self.what, file: self.file.clone(), at: self.at.clone(), hot }
    }
}

/// Records of one kind a store holds, each by its key: in memory, or spilled (`Spill`).
pub(crate) struct Held<V: Record> {
    mem: HashMap<V::Key, V>,
    spilled: Option<Spilled<V>>,
}

impl<V: Record> Default for Held<V> {
    fn default() -> Held<V> {
        Held { mem: HashMap::new(), spilled: None }
    }
}

impl<V: Record> Clone for Held<V> {
    fn clone(&self) -> Held<V> {
        Held { mem: self.mem.clone(), spilled: self.spilled.clone() }
    }
}

impl<V: Record> Held<V> {
    /// It, spilled into `spill` from now on, with what it holds now.
    fn spill_into(&mut self, spill: &Spill, what: &'static str) -> io::Result<()> {
        let mut spilled = Spilled::new(spill, what)?;
        for (k, v) in self.mem.drain() {
            spilled.insert(k, v);
        }
        self.spilled = Some(spilled);
        Ok(())
    }

    /// An empty one, spilled as it is, into a file of its own.
    fn fresh(&self) -> Held<V> {
        let spilled = self.spilled.as_ref().map(|s| {
            Spilled::new(&s.spill, s.what).unwrap_or_else(|e| panic!("avendb: no new spill of {}: {e}", s.what))
        });
        Held { mem: HashMap::new(), spilled }
    }

    pub(crate) fn len(&self) -> usize {
        self.spilled.as_ref().map_or(self.mem.len(), |s| s.at.len())
    }

    pub(crate) fn contains_key(&self, k: &V::Key) -> bool {
        match &self.spilled {
            Some(s) => s.at.contains_key(k),
            None => self.mem.contains_key(k),
        }
    }

    pub(crate) fn get(&self, k: &V::Key) -> Option<V> {
        match &self.spilled {
            Some(s) => s.get(k),
            None => self.mem.get(k).cloned(),
        }
    }

    pub(crate) fn insert(&mut self, k: V::Key, v: V) {
        match &mut self.spilled {
            Some(s) => s.insert(k, v),
            None => {
                self.mem.insert(k, v);
            }
        }
    }

    /// Lets go of what it holds under `k`, which it returns.
    pub(crate) fn remove(&mut self, k: &V::Key) -> Option<V> {
        let was = self.get(k)?;
        match &mut self.spilled {
            Some(s) => s.remove(k),
            None => {
                self.mem.remove(k);
            }
        }
        Some(was)
    }

    /// Every key it holds, in no order.
    pub(crate) fn keys(&self) -> Box<dyn Iterator<Item = &V::Key> + '_> {
        match &self.spilled {
            Some(s) => Box::new(s.at.keys()),
            None => Box::new(self.mem.keys()),
        }
    }

    /// The bytes it holds in memory, about: what it holds itself, and its index and what it keeps at hand, spilled.
    pub(crate) fn memory(&self) -> usize {
        match &self.spilled {
            Some(s) => s.at.len() * (std::mem::size_of::<(V::Key, Slot)>() + 8) + s.hot.lock().expect("hot").bytes,
            None => self.mem.values().map(Record::size).sum(),
        }
    }

    /// The bytes of what it holds, spilled or not.
    pub(crate) fn bytes(&self) -> usize {
        match &self.spilled {
            Some(s) => s.at.values().map(|slot| slot.len as usize).sum(),
            None => self.mem.values().map(|v| v.bytes().len()).sum(),
        }
    }

    /// The bytes its spill's file holds, of records it holds or held: none, unspilled.
    pub(crate) fn spilled_bytes(&self) -> u64 {
        self.spilled.as_ref().map_or(0, |s| s.file.len())
    }
}

/// The McEliece keys a store holds, each by its id.
pub(crate) type Keys = Held<Arc<[u8]>>;

impl Keys {
    pub(crate) fn spill_keys(&mut self, spill: &Spill) -> io::Result<()> {
        self.spill_into(spill, "keys")
    }

    pub(crate) fn fresh_keys(&self) -> Keys {
        self.fresh()
    }

    /// Every key it holds, each by its id: read whole from its spill, if spilled.
    pub(crate) fn to_map(&self) -> HashMap<BlobId, Arc<[u8]>> {
        self.keys().filter_map(|k| Some((*k, self.get(k)?))).collect()
    }
}

/// The signed edits a store holds, each by its id, and the keys of every signer whose signature one of them carries,
/// with how many signatures of theirs it holds: what `Lab::signers_seen` and `Lab::peers` read without reading every
/// edit back.
#[derive(Clone, Default)]
pub(crate) struct Signeds {
    held: Held<Arc<Signed>>,
    signers: HashMap<SignerId, (SignerKeys, usize)>,
    /// The edits held bare whose signatures it let go of already (`strip`): not read back again to tell.
    stripped: HashSet<EditId>,
}

impl Signeds {
    pub(crate) fn spill_edits(&mut self, spill: &Spill) -> io::Result<()> {
        self.held.spill_into(spill, "edits")
    }

    /// An empty one, spilled as it is.
    pub(crate) fn fresh(&self) -> Signeds {
        Signeds { held: self.held.fresh(), signers: HashMap::new(), stripped: HashSet::new() }
    }

    pub(crate) fn len(&self) -> usize {
        self.held.len()
    }

    pub(crate) fn contains_key(&self, id: &EditId) -> bool {
        self.held.contains_key(id)
    }

    pub(crate) fn get(&self, id: &EditId) -> Option<Arc<Signed>> {
        self.held.get(id)
    }

    /// Edit `id`, which it holds, as a value of its own.
    pub(crate) fn owned(&self, id: &EditId) -> Signed {
        Signed::clone(&self.get(id).expect("an edit the store holds"))
    }

    /// Edit `id`, if it holds it, as a value of its own.
    pub(crate) fn owned_get(&self, id: &EditId) -> Option<Signed> {
        self.get(id).map(|s| Signed::clone(&s))
    }

    pub(crate) fn insert(&mut self, id: EditId, signed: Signed) {
        self.remove(&id);
        self.stripped.remove(&id);
        for sig in &signed.sigs {
            self.signers.entry(sig.keys.id()).or_insert_with(|| (sig.keys.clone(), 0)).1 += 1;
        }
        self.held.insert(id, Arc::new(signed));
    }

    pub(crate) fn remove(&mut self, id: &EditId) {
        let Some(signed) = self.held.get(id) else { return };
        for sig in &signed.sigs {
            let s = sig.keys.id();
            if let Some((_, n)) = self.signers.get_mut(&s) {
                *n -= 1;
                if *n == 0 {
                    self.signers.remove(&s);
                }
            }
        }
        self.held.remove(id);
        self.stripped.remove(id);
    }

    /// Edit `id` as `strip` leaves it, held bare on a checkpoint's word: changed where `needs` says it must be, and
    /// once only.
    pub(crate) fn strip(&mut self, id: &EditId, needs: impl Fn(&Signed) -> bool, strip: impl FnOnce(&mut Signed)) {
        if self.stripped.contains(id) {
            return;
        }
        let Some(signed) = self.held.get(id) else { return };
        if needs(&signed) {
            let mut signed = Signed::clone(&signed);
            strip(&mut signed);
            self.insert(*id, signed);
        }
        self.stripped.insert(*id);
    }

    /// The keys of every signer whose signature an edit it holds carries.
    pub(crate) fn signer_keys(&self) -> impl Iterator<Item = &SignerKeys> {
        self.signers.values().map(|(keys, _)| keys)
    }

    pub(crate) fn memory(&self) -> usize {
        self.held.memory()
    }

    pub(crate) fn spilled_bytes(&self) -> u64 {
        self.held.spilled_bytes()
    }

    pub(crate) fn is_spilled(&self) -> bool {
        self.held.spilled.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("avendb-held-{name}-{}", std::process::id()))
    }

    /// The keys a spill holds read back as they went in, and what it keeps in memory stays within its budget and its
    /// index however many it holds: 10,000 keys, then 100,000.
    #[test]
    fn a_spill_holds_its_records_in_a_bounded_memory() {
        let spill = Spill::new(dir("bounded"), 1 << 20).expect("a spill");
        let mut keys = Keys::default();
        keys.spill_keys(&spill).expect("spilled");
        let key = |n: u32| -> Arc<[u8]> { Arc::from(&[n.to_le_bytes(); 64].concat()[..]) };
        let mut held_at = vec![];
        let mut ids = vec![];
        for n in 0..100_000u32 {
            let k = key(n);
            let id = BlobId::of(&k);
            ids.push(id);
            keys.insert(id, k);
            // each read a few times, as a peer's sync reads them
            assert_eq!(keys.get(&id).as_deref(), Some(&key(n)[..]));
            if n + 1 == 10_000 || n + 1 == 100_000 {
                held_at.push(keys.memory());
            }
        }
        assert_eq!(keys.len(), 100_000);
        assert_eq!(keys.bytes(), 100_000 * 256);
        // the records themselves, 25.6 MB, are in the file, and memory holds the budget at most beside the index
        let index = |n: usize| n * (std::mem::size_of::<(BlobId, Slot)>() + 8);
        assert!(held_at[0] <= index(10_000) + (1 << 19), "{held_at:?}");
        assert!(held_at[1] <= index(100_000) + (1 << 19), "{held_at:?}");
        let per_record = (held_at[1] - (1 << 19).min(held_at[1])) / 100_000;
        assert!(per_record < 256 / 2, "the index holds far less than the records: {per_record} bytes each");
        for (n, id) in ids.iter().enumerate().step_by(997) {
            assert_eq!(keys.get(id).as_deref(), Some(&key(n as u32)[..]), "read back from its file");
        }
        keys.remove(&ids[0]);
        assert!(!keys.contains_key(&ids[0]) && keys.get(&ids[0]).is_none());
        fs::remove_dir_all(spill.dir()).ok();
    }

    /// A record changed in the spill's file, as by its disk, is never read as another: the server stops.
    #[test]
    #[should_panic(expected = "changed in its folder")]
    fn a_spoiled_record_is_never_read() {
        let spill = Spill::new(dir("spoiled"), 0).expect("a spill");
        let mut keys = Keys::default();
        keys.spill_keys(&spill).expect("spilled");
        let k: Arc<[u8]> = Arc::from(&b"a key of a few bytes"[..]);
        let id = BlobId::of(&k);
        keys.insert(id, k);
        let path = fs::read_dir(spill.dir()).expect("its folder").next().expect("its file").expect("a file").path();
        let mut bytes = fs::read(&path).expect("its bytes");
        bytes[3] ^= 1;
        fs::write(&path, bytes).expect("spoiled");
        keys.get(&id);
    }
}
