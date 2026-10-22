//! Batch-signed logs (M3, `spec/AvenDB/Batches.lean`, V5). Each device keeps one append-only log of the edits it
//! signs, in the order it signs them, shaped as a Merkle tree of BLAKE3 hashes (`Tree`), and signs the tree's root once
//! per batch with its post-quantum key (`Root`, `SignedRoot`), as Hypercore and AT Protocol do. An edit then proves its
//! device signed it by a path up the tree to a signed root (`Path`, `Proof`): about thirty hashes at a billion edits,
//! checked at hashing speed, where a signature of its own is 3,309 bytes and a few dozen microseconds of ML-DSA-65.
//!
//! - **The tree.** It splits as RFC 9162 splits a log: a tree of `n` edits, two or more, is the node of the tree of
//!   its first `split(n)`, the largest power of two below `n`, and the tree of the rest. A leaf hashes an edit's id, a
//!   node two hashes, each for a purpose of its own (`hash`), so a leaf is never a node. An edit's id hashes its sealed
//!   bytes, so the tree covers ciphertext: a relay that opens nothing checks and serves edits all the same. The device
//!   keeps every edit and every node of every full subtree for good, two hashes an edit, and makes any root or path
//!   from them in a few dozen hashes.
//! - **Batches by group commit.** A batch is what the device wrote while it signed the batch before
//!   (`SignerLog::begin`, `SignerLog::end`): the first write of a quiet device is signed at once, and writes that come
//!   while a root is being signed wait for the next. So a write waits a signature's time or two, about a millisecond
//!   each, and a batch grows by itself under load. V5 holds whatever the batches.
//! - **What is signed.** The log (the device's id, one log to a device), its fork number, its length and its root,
//!   behind this format's version byte (`Root::message`), under a context of its own (`sign::ROOT_CONTEXT`), so a root
//!   signature never counts as an edit's, a hello or a statement.
//! - **Checking an edit.** A device takes an edit where each of its signers signed it: by its signature on the edit,
//!   as every edit before batches did and goes on doing (`sign::Signed::verify`), or by a path from the edit to a root
//!   of the signer's log that the signer signed (`Proof::shows`, `Roots::check`). Lean's V5 proves both ways
//!   authenticate exactly the edits of the signer's log, so a device takes and knows the same; the tests hold the two
//!   to each other edit by edit (`tests/batch.rs`).
//! - **Forks.** Two roots of one log that disagree, of other fork numbers, of one length with other hashes, or the
//!   shorter not the first edits of the longer, prove its device signed two histories of its log: a clone, a backup
//!   restored, a stolen key (`ForkProof`). A shorter root is shown to begin a longer one by the hashes that rebuild
//!   both (`Tree::prefix`, `rebuild`, RFC 9162's consistency proof with the shorter root always in it). A device that
//!   holds such a proof freezes the signer (`Roots::frozen`): it takes no path to its roots any more, and says why
//!   (`ForkProof::why`). Every edit keeps its own signature where it has one, which still checks.
//! - **Existing logs.** No reset: every edit signed before keeps its signature, which checks exactly as today. A
//!   device's log as it stands is wrapped into a tree in its order (`SignerLog::wrap`), and its first batch signs one
//!   root over all of it.
//!
//! Every format here starts with its version byte (`FORMAT`), and a decoder takes only bytes that encode back to
//! themselves, as the wire does.

use std::collections::HashMap;
use std::sync::Arc;

use crate::encode::Encode;
use crate::hash::{self, Hasher};
use crate::id::{EditId, SignerId};
use crate::policy::{Edit, Refusal};
use crate::sign::{self, DeviceKey, Signature, SignerKeys};
use crate::wire::{Decode, Reader, Wire, WireError};

/// The version byte every format of this module starts with, the bytes a root's signature signs among them.
pub const FORMAT: u8 = 1;

/// The fork number every device signs: avenDB never truncates a log, so another one is itself a fork.
pub const FORK: u64 = 0;

/// The most steps a path or a prefix proof can have: a tree of fewer than 2^64 edits is never deeper.
pub const MOST_STEPS: usize = 64;

/// A hash of the tree.
pub type Hash = [u8; 32];

/// The leaf of edit `edit`: a hash of its id.
pub fn leaf(edit: EditId) -> Hash {
    hash::hash("log leaf", &edit.0)
}

/// The node of two hashes, `left` first.
pub fn node(left: &Hash, right: &Hash) -> Hash {
    let mut h = Hasher::new("log node");
    h.update(left).update(right);
    h.finalize()
}

/// The root of a log of no edits.
pub fn empty() -> Hash {
    hash::hash("log empty", b"")
}

/// Where a tree of `n` edits, two or more, splits: the largest power of two below `n` (`split` in the model).
pub fn split(n: u64) -> u64 {
    debug_assert!(n >= 2, "only a tree of two edits or more splits");
    1 << (63 - (n - 1).leading_zeros())
}

/// One device's log: the ids of the edits it signed, in the order it signed them, and every node of every full subtree,
/// kept for good.
#[derive(Clone, Debug, Default)]
pub struct Tree {
    /// `full[h][i]`: the root of the 2^h edits from `i * 2^h` on; `full[0]` holds the leaves.
    full: Vec<Vec<Hash>>,
    ids: Vec<EditId>,
    at: HashMap<EditId, u64>,
}

impl Tree {
    pub fn new() -> Tree {
        Tree::default()
    }

    /// A log as it stands, its edits in their order: how an existing log is wrapped.
    pub fn wrap(ids: impl IntoIterator<Item = EditId>) -> Tree {
        let mut tree = Tree::new();
        for id in ids {
            tree.push(id);
        }
        tree
    }

    /// How many edits it holds.
    pub fn len(&self) -> u64 {
        self.ids.len() as u64
    }

    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    /// Add edit `edit` at the end, and its place: an edit already in it keeps the place it has.
    pub fn push(&mut self, edit: EditId) -> u64 {
        if let Some(&i) = self.at.get(&edit) {
            return i;
        }
        let index = self.len();
        self.ids.push(edit);
        self.at.insert(edit, index);
        if self.full.is_empty() {
            self.full.push(vec![]);
        }
        self.full[0].push(leaf(edit));
        // each full subtree the new leaf closes gets its node, from the bottom up
        let (mut h, mut i) = (0, index);
        while i & 1 == 1 {
            let n = node(&self.full[h][i as usize - 1], &self.full[h][i as usize]);
            if self.full.len() == h + 1 {
                self.full.push(vec![]);
            }
            self.full[h + 1].push(n);
            h += 1;
            i >>= 1;
        }
        index
    }

    /// The place of edit `edit`, if it holds it.
    pub fn index(&self, edit: EditId) -> Option<u64> {
        self.at.get(&edit).copied()
    }

    /// The edit at `index`.
    pub fn edit(&self, index: u64) -> Option<EditId> {
        self.ids.get(usize::try_from(index).ok()?).copied()
    }

    /// The root of all its edits.
    pub fn root(&self) -> Hash {
        self.range(0, self.len())
    }

    /// The root of its first `n` edits, if it holds as many.
    pub fn root_at(&self, n: u64) -> Option<Hash> {
        (n <= self.len()).then(|| self.range(0, n))
    }

    /// The root of the edits from `a` to `b`, a range the tree's splits make: `a` a multiple of a power of two that is
    /// no less than `b - a`. A full one is kept; any other is made from the full ones it splits into, a few dozen
    /// hashes at most.
    fn range(&self, a: u64, b: u64) -> Hash {
        let n = b - a;
        if n == 0 {
            return empty();
        }
        if n.is_power_of_two() && a % n == 0 {
            return self.full[n.trailing_zeros() as usize][(a / n) as usize];
        }
        let k = split(n);
        node(&self.range(a, a + k), &self.range(a + k, b))
    }

    /// The path of the edit at `index` up to the root of the first `n` edits: the root of the other side at each
    /// split, from the bottom up (RFC 9162's audit path, `path` in the model).
    pub fn prove(&self, index: u64, n: u64) -> Option<Path> {
        if index >= n || n > self.len() {
            return None;
        }
        let mut hashes = vec![];
        self.path(index, 0, n, &mut hashes);
        Some(Path { index, length: n, hashes })
    }

    fn path(&self, i: u64, a: u64, b: u64, out: &mut Vec<Hash>) {
        if b - a == 1 {
            return;
        }
        let k = split(b - a);
        if i < a + k {
            self.path(i, a, a + k, out);
            out.push(self.range(a + k, b));
        } else {
            self.path(i, a + k, b, out);
            out.push(self.range(a, a + k));
        }
    }

    /// The hashes that show the root of the first `m` edits begins the root of the first `n` (`rebuild`): the root of
    /// the first `m` within the tree of `n`, then the root of the other side at each split above it, from the bottom
    /// up. `None` unless `0 < m <= n <= len`.
    pub fn prefix(&self, m: u64, n: u64) -> Option<Vec<Hash>> {
        if m == 0 || m > n || n > self.len() {
            return None;
        }
        let mut out = vec![];
        self.sub(m, 0, n, &mut out);
        Some(out)
    }

    fn sub(&self, m: u64, a: u64, b: u64, out: &mut Vec<Hash>) {
        let n = b - a;
        if m == n {
            out.push(self.range(a, b));
            return;
        }
        let k = split(n);
        if m <= k {
            self.sub(m, a, a + k, out);
            out.push(self.range(a + k, b));
        } else {
            self.sub(m - k, a + k, b, out);
            out.push(self.range(a, a + k));
        }
    }
}

/// The roots of the first `m` edits and of all `n` that the prefix proof `proof` rebuilds (`Tree::prefix`), if it is
/// one for those sizes: so the first is what the second's first `m` edits hash to.
pub fn rebuild(m: u64, n: u64, proof: &[Hash]) -> Option<(Hash, Hash)> {
    if m == 0 || m > n {
        return None;
    }
    // each split from the top down, and whether the first `m` edits reach past it
    let mut past = vec![];
    let (mut m, mut n) = (m, n);
    while m != n {
        let k = split(n);
        if m <= k {
            past.push(false);
            n = k;
        } else {
            past.push(true);
            m -= k;
            n -= k;
        }
    }
    let (first, rest) = proof.split_first()?;
    if rest.len() != past.len() {
        return None;
    }
    let (mut old, mut new) = (*first, *first);
    for (&past, side) in past.iter().rev().zip(rest) {
        if past {
            old = node(side, &old);
            new = node(side, &new);
        } else {
            new = node(&new, side);
        }
    }
    Some((old, new))
}

/// The path of one edit up to a root of its log: its place, how many edits the root hashes, and the root of the other
/// side at each split, from the bottom up.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Path {
    pub index: u64,
    pub length: u64,
    pub hashes: Vec<Hash>,
}

impl Path {
    /// The splits above the edit at `index` of `length`, from the top down: whether the edit lies past each. `None`
    /// unless the edit is among them.
    fn sides(index: u64, length: u64) -> Option<Vec<bool>> {
        if index >= length {
            return None;
        }
        let (mut i, mut n, mut out) = (index, length, vec![]);
        while n > 1 {
            let k = split(n);
            if i < k {
                out.push(false);
                n = k;
            } else {
                out.push(true);
                i -= k;
                n -= k;
            }
        }
        Some(out)
    }

    /// The root this path climbs to from edit `edit` (`climb` in the model): `None` unless it has a hash for each
    /// split above its place.
    pub fn climb(&self, edit: EditId) -> Option<Hash> {
        let sides = Path::sides(self.index, self.length)?;
        if sides.len() != self.hashes.len() {
            return None;
        }
        let mut h = leaf(edit);
        for (&past, side) in sides.iter().rev().zip(&self.hashes) {
            h = if past { node(side, &h) } else { node(&h, side) };
        }
        Some(h)
    }
}

/// What a device signs once per batch: its log, the fork number, how many edits the log holds and their root.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Root {
    /// The log's device: one log to a device, named by it.
    pub log: SignerId,
    pub fork: u64,
    pub length: u64,
    pub hash: Hash,
}

impl Root {
    /// What its signature signs: the format's version, then each field at its fixed size.
    pub fn message(&self) -> Vec<u8> {
        let mut out = vec![FORMAT];
        self.log.encode(&mut out);
        self.fork.encode(&mut out);
        self.length.encode(&mut out);
        self.hash.encode(&mut out);
        out
    }

    fn decode_message(r: &mut Reader<'_>) -> Result<Root, WireError> {
        if r.u8()? != FORMAT {
            return Err(WireError::Unknown);
        }
        Ok(Root { log: SignerId::decode(r)?, fork: u64::decode(r)?, length: u64::decode(r)?, hash: r.array()? })
    }
}

/// A root its device signed: its keys, which hash to the log's id, and its post-quantum signature on the root's
/// message.
#[derive(Clone, PartialEq, Eq)]
pub struct SignedRoot {
    pub root: Root,
    pub keys: SignerKeys,
    pub sig: Vec<u8>,
}

/// The signature shows only its size.
impl std::fmt::Debug for SignedRoot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SignedRoot")
            .field("root", &self.root)
            .field("sig", &format!("{} bytes", self.sig.len()))
            .finish()
    }
}

impl SignedRoot {
    /// Device `key`'s signature on `root`, a root of its own log.
    pub fn sign(key: &DeviceKey, root: Root) -> SignedRoot {
        debug_assert_eq!(root.log, key.id(), "a device signs only its own log's roots");
        SignedRoot { root, keys: key.keys(), sig: key.sign_root(&root.message()) }
    }

    /// Its log's device signed it: its keys are that device's, and its signature checks out.
    pub fn verify(&self) -> bool {
        sign::verify_root(&self.keys, &self.root.message(), &self.sig) == Some(self.root.log)
    }

}

impl Encode for SignedRoot {
    fn encode(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.root.message());
        self.keys.encode(out);
        self.sig.encode(out);
    }
}

impl Decode for SignedRoot {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(SignedRoot { root: Root::decode_message(r)?, keys: SignerKeys::decode(r)?, sig: r.bytes()? })
    }
}

impl Encode for Path {
    fn encode(&self, out: &mut Vec<u8>) {
        out.push(FORMAT);
        self.index.encode(out);
        self.length.encode(out);
        self.hashes.encode(out);
    }
}

impl Decode for Path {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        if r.u8()? != FORMAT {
            return Err(WireError::Unknown);
        }
        let (index, length) = (u64::decode(r)?, u64::decode(r)?);
        let hashes: Vec<Hash> = r.seq(32)?;
        // one hash for each split above its place, so it reads back one way only
        match Path::sides(index, length) {
            Some(sides) if sides.len() == hashes.len() => Ok(Path { index, length, hashes }),
            _ => Err(WireError::Unknown),
        }
    }
}

/// An edit's proof that its device signed it: a path up to a root of the device's log, and that root, signed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Proof {
    pub root: Arc<SignedRoot>,
    pub path: Path,
}

impl Proof {
    /// It shows signer `signer` signed edit `edit` (`Proof.shows` in the model): its root is of `signer`'s log,
    /// signed by `signer`, as long as its path, and the path climbs from the edit to it.
    pub fn shows(&self, signer: SignerId, edit: EditId) -> bool {
        self.climbs(signer, edit) && self.root.verify()
    }

    /// All of `shows` but the root's signature, which a device checks once for every edit under it.
    fn climbs(&self, signer: SignerId, edit: EditId) -> bool {
        let r = &self.root.root;
        r.log == signer && self.path.length == r.length && self.path.climb(edit) == Some(r.hash)
    }
}

impl Encode for Proof {
    fn encode(&self, out: &mut Vec<u8>) {
        self.root.encode(out);
        self.path.encode(out);
    }
}

impl Decode for Proof {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Proof { root: Arc::new(SignedRoot::decode(r)?), path: Path::decode(r)? })
    }
}

/// Two signed roots of one log that disagree: the proof that its device signed two histories of it. The shorter
/// first; where it is the shorter of two lengths, the hashes that rebuild the longer and what its first edits hash to
/// (`Tree::prefix`), which is not the shorter.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ForkProof {
    pub a: SignedRoot,
    pub b: SignedRoot,
    pub prefix: Vec<Hash>,
}

impl ForkProof {
    /// The device it proves signed two histories of its log, if it does: both roots of that log, both signed by it,
    /// and they disagree: other fork numbers; one length and other hashes; or the longer's first edits, as the
    /// prefix rebuilds it, hash to other than the shorter. Stricter than the model's `forkProof`, which reads what
    /// edits a root hashes rather than its hash: a root its device didn't make as the tree makes one disagrees too, and
    /// a device never signs one.
    pub fn signer(&self) -> Option<SignerId> {
        let (a, b) = (&self.a.root, &self.b.root);
        if a.log != b.log || a.length > b.length || !self.a.verify() || !self.b.verify() {
            return None;
        }
        let disagree = if a.fork != b.fork {
            true
        } else if a.length == b.length {
            a.hash != b.hash
        } else if a.length == 0 {
            false
        } else {
            matches!(rebuild(a.length, b.length, &self.prefix), Some((old, new)) if new == b.hash && old != a.hash)
        };
        disagree.then_some(a.log)
    }

    /// Why a device froze the signer, as the page says it.
    pub fn why(&self) -> String {
        let (a, b) = (&self.a.root, &self.b.root);
        let how = if a.fork != b.fork {
            format!("one says fork {} and the other fork {}", a.fork, b.fork)
        } else if a.length == b.length {
            format!("both say {} edits, with other roots", a.length)
        } else {
            format!("its root of {} edits doesn't begin its root of {}", a.length, b.length)
        };
        let who = a.log.to_hex();
        format!("{who} signed two histories of its log ({how}): a clone, a backup restored or a stolen key")
    }
}

impl Encode for ForkProof {
    fn encode(&self, out: &mut Vec<u8>) {
        out.push(FORMAT);
        self.a.encode(out);
        self.b.encode(out);
        self.prefix.encode(out);
    }
}

impl Decode for ForkProof {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        if r.u8()? != FORMAT {
            return Err(WireError::Unknown);
        }
        let (a, b) = (SignedRoot::decode(r)?, SignedRoot::decode(r)?);
        let prefix: Vec<Hash> = r.seq(32)?;
        if prefix.len() > MOST_STEPS + 1 {
            return Err(WireError::Unknown);
        }
        Ok(ForkProof { a, b, prefix })
    }
}

macro_rules! wire {
    ($($t:ty),*) => {$(
        impl Wire for $t {
            fn to_wire(&self) -> Vec<u8> {
                let mut out = vec![];
                self.encode(&mut out);
                out
            }

            fn from_wire(bytes: &[u8]) -> Result<Self, WireError> {
                let mut r = Reader::new(bytes);
                let value = <$t as Decode>::decode(&mut r)?;
                if r.done() { Ok(value) } else { Err(WireError::Trailing) }
            }
        }
    )*};
}

wire!(SignedRoot, Path, Proof, ForkProof);

/// A device's own log, and its batches: every edit it signed in order, the newest root it signed, and the root it is
/// signing now, if any (group commit).
#[derive(Clone, Debug)]
pub struct SignerLog {
    log: SignerId,
    tree: Tree,
    /// The newest root it signed.
    signed: Option<Arc<SignedRoot>>,
    /// The length of the root it is signing now.
    signing: Option<u64>,
}

impl SignerLog {
    pub fn new(log: SignerId) -> SignerLog {
        SignerLog::wrap(log, [])
    }

    /// Device `log`'s log as it stands, `ids` its edits in their order: an existing log, wrapped in place. Its first
    /// batch signs one root over all of them.
    pub fn wrap(log: SignerId, ids: impl IntoIterator<Item = EditId>) -> SignerLog {
        SignerLog { log, tree: Tree::wrap(ids), signed: None, signing: None }
    }

    pub fn log(&self) -> SignerId {
        self.log
    }

    pub fn tree(&self) -> &Tree {
        &self.tree
    }

    /// The newest root it signed.
    pub fn signed(&self) -> Option<&Arc<SignedRoot>> {
        self.signed.as_ref()
    }

    /// Edit `edit`, signed by the device: it goes at the end of the log and waits for the next batch. Its place.
    pub fn write(&mut self, edit: EditId) -> u64 {
        self.tree.push(edit)
    }

    /// How many of its edits no root it signed covers yet.
    pub fn waiting(&self) -> u64 {
        self.tree.len() - self.signed.as_ref().map_or(0, |s| s.root.length)
    }

    /// The next batch, if the device is free and edits wait: the root over every edit written so far, for the device
    /// to sign. Until it ends (`end`), edits written meanwhile wait for the batch after.
    pub fn begin(&mut self) -> Option<Root> {
        if self.signing.is_some() || self.waiting() == 0 {
            return None;
        }
        let length = self.tree.len();
        self.signing = Some(length);
        Some(Root { log: self.log, fork: FORK, length, hash: self.tree.root() })
    }

    /// The batch begun, signed: its root is the newest. False, and nothing changes, unless it is that root, by this
    /// log's device.
    pub fn end(&mut self, signed: SignedRoot) -> bool {
        let r = signed.root;
        let ours = self.signing == Some(r.length)
            && r.log == self.log
            && r.fork == FORK
            && self.tree.root_at(r.length) == Some(r.hash)
            && signed.verify();
        if ours {
            self.signing = None;
            self.signed = Some(Arc::new(signed));
        }
        ours
    }

    /// Begin a batch, sign it with `key` and end it, at once: the root signed, if edits waited.
    pub fn commit(&mut self, key: &DeviceKey) -> Option<Arc<SignedRoot>> {
        let root = self.begin()?;
        let signed = SignedRoot::sign(key, root);
        self.end(signed).then(|| self.signed.clone().expect("the root it just signed"))
    }

    /// Edit `edit`'s proof: its path up to the newest root signed over it.
    pub fn proof(&self, edit: EditId) -> Option<Proof> {
        let root = self.signed.clone()?;
        let path = self.tree.prove(self.tree.index(edit)?, root.root.length)?;
        Some(Proof { root, path })
    }

    /// The hashes that show a root of its first `m` edits begins the newest it signed (`Tree::prefix`).
    pub fn prefix(&self, m: u64) -> Option<Vec<Hash>> {
        self.tree.prefix(m, self.signed.as_ref()?.root.length)
    }
}

/// What a device made of a signed root it was handed (`Roots::take`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Taken {
    /// The first of its log, or longer than the newest and shown to begin with it: the newest now.
    Newer,
    /// The newest already.
    Same,
    /// Shorter than the newest, and shown to begin it.
    Older,
    /// Signed, and so good for the paths up to it, but not shown to begin the newest or to be begun by it: no
    /// proof came, or one that rebuilds neither. The newest stays.
    Unlinked,
    /// It and the newest disagree: the signer is frozen now.
    Fork(Box<ForkProof>),
    /// Its signer is frozen.
    Frozen,
    /// Not signed by its log's device.
    Bad,
}

/// The roots a device keeps of each log it holds edits of: the newest, older ones only where it keeps them at a
/// checkpoint (`checkpoint`), and the signers it froze with the proof of each fork. It remembers each signed root it
/// checked, its signature and keys too, so a root's signature is checked once for every path up to it.
#[derive(Clone, Debug, Default)]
pub struct Roots {
    newest: HashMap<SignerId, Arc<SignedRoot>>,
    kept: HashMap<SignerId, Vec<Arc<SignedRoot>>>,
    frozen: HashMap<SignerId, ForkProof>,
    checked: HashMap<Root, Arc<SignedRoot>>,
}

impl Roots {
    pub fn new() -> Roots {
        Roots::default()
    }

    /// The newest root it keeps of `log`.
    pub fn newest(&self, log: SignerId) -> Option<&Arc<SignedRoot>> {
        self.newest.get(&log)
    }

    /// The older roots it keeps of `log`, at checkpoints, oldest first.
    pub fn kept(&self, log: SignerId) -> &[Arc<SignedRoot>] {
        self.kept.get(&log).map_or(&[], |k| &k[..])
    }

    /// The proof of fork it froze signer `s` by.
    pub fn frozen(&self, s: SignerId) -> Option<&ForkProof> {
        self.frozen.get(&s)
    }

    /// Why it froze signer `s`, if it did.
    pub fn why(&self, s: SignerId) -> Option<String> {
        self.frozen.get(&s).map(ForkProof::why)
    }

    /// `root` is signed by its log's device, checked once: the same root with the same keys and signature again is
    /// taken as checked.
    fn verified(&mut self, root: &SignedRoot) -> bool {
        if self.checked.get(&root.root).is_some_and(|c| **c == *root) {
            return true;
        }
        let ok = root.verify();
        if ok {
            self.checked.insert(root.root, Arc::new(root.clone()));
        }
        ok
    }

    /// Take a signed root a peer handed it, with `prefix`, the hashes that link it to the newest it keeps of its log,
    /// the shorter's first (`Tree::prefix`), if the peer had them.
    pub fn take(&mut self, root: &SignedRoot, prefix: Option<&[Hash]>) -> Taken {
        if !self.verified(root) {
            return Taken::Bad;
        }
        let log = root.root.log;
        if self.frozen.contains_key(&log) {
            return Taken::Frozen;
        }
        let Some(newest) = self.newest.get(&log).cloned() else {
            self.newest.insert(log, Arc::new(root.clone()));
            return Taken::Newer;
        };
        let (old, new) = (&newest.root, &root.root);
        let fork = |a: &SignedRoot, b: &SignedRoot, prefix: Vec<Hash>| ForkProof { a: a.clone(), b: b.clone(), prefix };
        // what a proof of fork of the two holds, if it is one, and else whether the shorter begins the longer
        let (proof, linked) = if old.fork != new.fork || old.length == new.length {
            let shorter_first = if old.length <= new.length { (&*newest, root) } else { (root, &*newest) };
            (Some(fork(shorter_first.0, shorter_first.1, vec![])), old.fork == new.fork && old.hash == new.hash)
        } else {
            let (a, b) = if old.length < new.length { (&*newest, root) } else { (root, &*newest) };
            if a.root.length == 0 {
                (None, a.root.hash == empty())
            } else {
                match prefix.and_then(|p| rebuild(a.root.length, b.root.length, p)) {
                    Some((first, all)) if all == b.root.hash => {
                        (Some(fork(a, b, prefix.expect("a prefix rebuilt").to_vec())), first == a.root.hash)
                    }
                    _ => (None, false),
                }
            }
        };
        if linked {
            return match old.length.cmp(&new.length) {
                std::cmp::Ordering::Less => {
                    self.newest.insert(log, Arc::new(root.clone()));
                    Taken::Newer
                }
                std::cmp::Ordering::Equal => Taken::Same,
                std::cmp::Ordering::Greater => Taken::Older,
            };
        }
        match proof.filter(|p| p.signer() == Some(log)) {
            Some(p) => {
                self.frozen.insert(log, p.clone());
                Taken::Fork(Box::new(p))
            }
            None => Taken::Unlinked,
        }
    }

    /// Take a proof of fork a peer passed on: if it proves one, its signer is frozen. True if it does.
    pub fn freeze(&mut self, proof: ForkProof) -> bool {
        match proof.signer() {
            Some(s) => {
                self.frozen.entry(s).or_insert(proof);
                true
            }
            None => false,
        }
    }

    /// Keep the newest root of each log for good, beside the older ones kept: at a checkpoint.
    pub fn checkpoint(&mut self) {
        for (log, root) in &self.newest {
            let kept = self.kept.entry(*log).or_default();
            if kept.last().is_none_or(|k| k.root != root.root) {
                kept.push(root.clone());
            }
        }
    }

    /// Signer `s` signed edit `edit`, by the path `proof` up to a root of its log (`check` in the model, the half a
    /// path shows): the path climbs from the edit to a root of `s`'s log signed by `s`, while `s` isn't frozen.
    pub fn check(&mut self, s: SignerId, edit: EditId, proof: &Proof) -> bool {
        !self.frozen.contains_key(&s) && proof.climbs(s, edit) && self.verified(&proof.root)
    }
}

/// Each signer of `edit` signed it (`check` in the model): the i-th by its signature `sigs[i]` where one came, as every
/// edit before batches did and still does, or by the path `proofs[i]` up to a root of its log it signed, while it isn't
/// frozen. Where every signer's signature came, it answers as `sign::Signed::verify` does.
pub fn check(
    edit: &Edit,
    sigs: &[Option<Signature>],
    proofs: &[Option<Proof>],
    roots: &mut Roots,
) -> Result<(), Refusal> {
    sign::its_id(edit)?;
    let signers: Vec<SignerId> = edit.sigs().collect();
    if sigs.len() != signers.len() || proofs.len() != signers.len() {
        return Err(Refusal::BadSignature);
    }
    let id = edit.id();
    let each = signers.iter().enumerate().all(|(i, &s)| {
        sigs[i].as_ref().is_some_and(|sig| sign::signs(edit, id, s, sig))
            || proofs[i].as_ref().is_some_and(|p| roots.check(s, id, p))
    });
    if each { Ok(()) } else { Err(Refusal::BadSignature) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(n: u64) -> EditId {
        EditId::from_u64(n)
    }

    /// The root of `ids` as RFC 9162 defines it, hash by hash: what the tree must make.
    fn naive(ids: &[EditId]) -> Hash {
        match ids.len() {
            0 => empty(),
            1 => leaf(ids[0]),
            n => {
                let k = split(n as u64) as usize;
                node(&naive(&ids[..k]), &naive(&ids[k..]))
            }
        }
    }

    #[test]
    fn a_tree_splits_at_the_largest_power_of_two_below_its_size() {
        assert_eq!([2, 3, 4, 5, 8, 9, 1 << 40].map(split), [1, 2, 2, 4, 4, 8, 1 << 39]);
        assert_eq!(split((1 << 40) + 1), 1 << 40);
        assert_eq!(split(u64::MAX), 1 << 63);
    }

    #[test]
    fn every_root_and_path_is_the_rfcs() {
        let ids: Vec<EditId> = (0..70).map(id).collect();
        let tree = Tree::wrap(ids.iter().copied());
        for n in 0..=70u64 {
            assert_eq!(tree.root_at(n), Some(naive(&ids[..n as usize])), "root of {n}");
            for i in 0..n {
                let path = tree.prove(i, n).expect("a path");
                assert_eq!(path.climb(ids[i as usize]), Some(naive(&ids[..n as usize])), "path of {i} in {n}");
            }
        }
        assert_eq!(tree.root_at(71), None);
        assert_eq!(tree.prove(5, 5), None);
    }

    #[test]
    fn a_prefix_rebuilds_both_roots() {
        let ids: Vec<EditId> = (0..40).map(id).collect();
        let tree = Tree::wrap(ids.iter().copied());
        for n in 1..=40u64 {
            for m in 1..=n {
                let p = tree.prefix(m, n).expect("a prefix");
                let both = (naive(&ids[..m as usize]), naive(&ids[..n as usize]));
                assert_eq!(rebuild(m, n, &p), Some(both), "{m} of {n}");
                // a hash too many or too few is no proof
                assert_eq!(rebuild(m, n, &p[..p.len() - 1]), None);
                assert_eq!(rebuild(m, n, &[&p[..], &[[0; 32]]].concat()), None);
            }
        }
    }

    #[test]
    fn an_edit_has_one_place() {
        let mut tree = Tree::new();
        assert_eq!(tree.push(id(1)), 0);
        assert_eq!(tree.push(id(2)), 1);
        assert_eq!(tree.push(id(1)), 0);
        assert_eq!((tree.len(), tree.index(id(2)), tree.edit(1)), (2, Some(1), Some(id(2))));
    }
}
