//! Key trees (M7; proven in Lean as V6, `avendb/spec/AvenDB/KeyTree.lean`). An audience's key boxed to each member
//! device costs a box per device at every epoch: a removal from a thousand devices, a thousand boxes. A key tree, in
//! the style of MLS TreeKEM (RFC 9420), costs about one box a level instead. Its leaves are the member devices, each
//! with its own X-Wing key. Each inner node holds secrets that only the devices below it open. A commit writes new
//! secrets along its author's path, each derived from the one below it, and seals each to the keys of the other side
//! of the path (its copath). The epoch's key is derived from the top of the path, so every member opens it.
//!
//! Devices commit apart. As in Keyhive's BeeKEM, two commits that both wrote a node keep both secrets there until a
//! commit that saw them replaces them, and a sender seals to both. Every peer applies the changes in the view's replay
//! order, so every peer builds the same tree.
//!
//! The rules are the Lean model's (`Tree.step`). A commit counts only if it seals each secret to keys that only members
//! open: the tree knows who opens each secret (its knowers), as MLS knows its unmerged leaves. A member that none of
//! its boxes reach gets the epoch's key boxed to its own key (a fill). A removal starts a new epoch, and each key of
//! the new epoch wraps each key of the one before, so history stays readable. An add either boxes the epoch's keys to
//! the new device or starts an epoch of its own that keeps no history. So every member opens every key of the epoch
//! now (`members_open`), and a removed device opens no key of a later epoch (`removed_shut`).
//!
//! The tree refuses some changes the model takes, never more. A commit names its epoch and counts only in it, and it
//! must carry exactly the fills and history wraps that the model adds itself; an add with the history must carry a box
//! for each key of the epoch. So the changes that count here are a run of the model, and its theorems hold of them. A
//! commit made apart from a removal or an add is refused, and its author drafts again.
//!
//! The tree's keys are X-Wing pairs alone (`keys::seal_tree`). Classic McEliece stays on a vault's seed and the
//! recovery boxes. Boxes made before stay as they are: an audience's earlier epochs keep their flat boxes, and a tree
//! starts at an epoch change. Edits stay one seal under the epoch's key.
//!
//! Nodes are named by level and index (`Node`): a leaf is level 0, and the node above leaf `i` at level `l` has index
//! `i >> l`. A tree grows by a new root over its old one, which leaves every name as it is.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use rand_core::CryptoRng;

use crate::hash::{self, Hasher};
use crate::id::SignerId;
use crate::keys::{self, Secret, XWING_PUBLIC_BYTES};
use crate::wire::Reader;

/// The format of a change's bytes, their first byte. A later format is a new byte that reads beside this one.
pub const FORMAT: u8 = 1;

/// The highest a tree grows: 2^32 leaves.
pub const MAX_HEIGHT: u8 = 32;

/// A node of a tree: its level, 0 for a leaf, and its index at that level.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Node {
    pub level: u8,
    pub index: u64,
}

impl Node {
    /// The node `level` levels above leaf `leaf`, on its path.
    pub fn above(leaf: u64, level: u8) -> Node {
        Node { level, index: leaf >> level }
    }

    /// The child of the node at `level` above leaf `leaf` that is off the leaf's path: its copath there.
    pub fn copath(leaf: u64, level: u8) -> Node {
        Node { level: level - 1, index: (leaf >> (level - 1)) ^ 1 }
    }

    /// Whether node `n` is this node or below it.
    pub fn over(self, n: Node) -> bool {
        n.level <= self.level && n.index >> (self.level - n.level) == self.index
    }

    /// The leaves below it: the first, and the one past the last.
    fn leaves(self) -> std::ops::Range<u64> {
        self.index << self.level..(self.index + 1) << self.level
    }

    fn children(self) -> [Node; 2] {
        let level = self.level - 1;
        [Node { level, index: self.index * 2 }, Node { level, index: self.index * 2 + 1 }]
    }
}

/// A commit's id: the hash of its author, epoch, nonce and public keys (`Commit::id`). The tree names each secret by
/// the commit that wrote it, and each epoch key by the commit that derived it.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CommitId(pub [u8; 32]);

impl std::fmt::Debug for CommitId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "CommitId(")?;
        for b in &self.0[..4] {
            write!(f, "{b:02x}")?;
        }
        write!(f, "…)")
    }
}

/// A key of the tree, as boxes name what they are sealed to (the model's `TKey`): a member device's own key at its
/// leaf, the secret a commit wrote on a node, or the key of an epoch a commit derived.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum TreeKey {
    Leaf(SignerId),
    Node(Node, CommitId),
    Epoch(u64, CommitId),
}

/// One box of a commit: the secret its path holds at `level`, sealed to the key `to` below the other child there.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PathBox {
    pub level: u8,
    pub to: TreeKey,
    pub bytes: Vec<u8>,
}

/// New secrets along a member's path: the model's `Change.commit`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Commit {
    pub author: SignerId,
    /// The epoch it is made for: it counts in that epoch alone.
    pub epoch: u64,
    /// What its path's secrets are derived from with its author's own key, so its author opens them as every other
    /// member does, from its own key alone.
    pub nonce: [u8; 32],
    /// The secrets of its path it replaces, by the commits that wrote them: the ones its author saw.
    pub saw: Vec<CommitId>,
    /// The X-Wing public key of each new secret, from the level above the leaf up to the root.
    pub publics: Vec<Vec<u8>>,
    pub boxes: Vec<PathBox>,
    /// The epoch's new key boxed to each member that none of the boxes reach.
    pub fills: Vec<(SignerId, Vec<u8>)>,
    /// Each key of the epoch before wrapped under the new key, where the epoch keeps the history.
    pub history: Vec<(CommitId, Vec<u8>)>,
}

impl Commit {
    pub fn id(&self) -> CommitId {
        let mut h = Hasher::new("key tree commit");
        h.update(&self.author.0).update(&self.epoch.to_be_bytes()).update(&self.nonce);
        h.update(&(self.publics.len() as u32).to_be_bytes());
        for p in &self.publics {
            h.update(&(p.len() as u32).to_be_bytes()).update(p);
        }
        CommitId(h.finalize())
    }
}

/// A change of a tree, in the replay order: a device joins at a leaf, with its own X-Wing key and, if it gets the
/// history, each key of the epoch boxed to it; a device leaves; or a member commits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Change {
    Add { device: SignerId, leaf: u64, public: Vec<u8>, history: bool, boxes: Vec<(CommitId, Vec<u8>)> },
    Remove { device: SignerId },
    Commit(Commit),
}

/// Why a change doesn't count. The tree stays as it was, as the model's does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refused {
    /// The author of a commit, or the device to remove, is no member.
    NotMember,
    /// The device to add is a member already, or its leaf is taken.
    Taken,
    /// The leaf is past the highest a tree grows.
    TooHigh,
    /// A public key is no X-Wing key, or a commit hasn't one for each level of the tree.
    Malformed,
    /// A commit is made for another epoch than the one now: made apart from a removal or an add.
    StaleEpoch,
    /// The commit counted already.
    Repeated,
    /// A box seals a secret to a key that only members don't open: a device that left opens it.
    Unclean,
    /// A box seals a secret to a key that is not below the other child of its node.
    OffPath,
    /// The fills are not exactly the members that the boxes miss.
    Fills,
    /// A commit's history wraps, or an add's boxes, are not exactly the keys of the epoch they carry.
    History,
}

/// A member device, at its leaf, with its own X-Wing key.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Member {
    pub device: SignerId,
    pub leaf: u64,
    pub public: Vec<u8>,
}

/// A secret a commit wrote on a node: its public key and who opens it.
#[derive(Clone, Debug)]
struct Written {
    commit: CommitId,
    public: Vec<u8>,
    knowers: BTreeSet<SignerId>,
}

/// Historical secrets remain readable without putting them on the current-resolution
/// path. `current` preserves replay order; lookup never scans historical versions.
/// This is the separation of `written` and `current` in the Lean tree model.
#[derive(Clone, Debug, Default)]
struct NodeVersions {
    history: Vec<Written>,
    by_commit: HashMap<CommitId, usize>,
    current: Vec<usize>,
}

impl NodeVersions {
    fn written(&self, id: CommitId) -> Option<&Written> {
        self.by_commit.get(&id).map(|&i| &self.history[i])
    }

    fn current(&self) -> impl Iterator<Item = &Written> {
        self.current.iter().map(|&i| &self.history[i])
    }

    fn remove(&mut self, device: SignerId) {
        self.current.retain(|&i| !self.history[i].knowers.contains(&device));
    }

    fn land(&mut self, written: Written, saw: &HashSet<CommitId>) {
        self.current.retain(|&i| !saw.contains(&self.history[i].commit));
        let index = self.history.len();
        let previous = self.by_commit.insert(written.commit, index);
        debug_assert!(previous.is_none(), "a counted commit is inserted once");
        self.history.push(written);
        self.current.push(index);
    }
}

/// An epoch: whether its keys wrap the keys of the one before (a removal's do, a new member's without the history
/// don't), and the commits that derived its keys, more than one where members committed apart.
#[derive(Clone, Debug, Default)]
struct Epoch {
    chains: bool,
    keys: Vec<CommitId>,
}

/// A box of an epoch's key to a device added with the history.
#[derive(Clone, Debug)]
struct Join {
    device: SignerId,
    epoch: u64,
    commit: CommitId,
    bytes: Vec<u8>,
}

/// An audience's key tree as every peer builds it from the changes in the replay order. It holds public things alone:
/// public keys, who opens what, and the boxes of every commit that counted. Each device opens its keys from its own
/// key (`opener`).
#[derive(Clone, Debug)]
pub struct KeyTree {
    /// What every box is bound to: the audience.
    context: [u8; 32],
    height: u8,
    members: BTreeMap<u64, Member>,
    leaf_of: HashMap<SignerId, u64>,
    /// Every leaf each device was ever added at: where the secrets it opened lie, whether it is a member still.
    held: HashMap<SignerId, BTreeSet<u64>>,
    nodes: BTreeMap<Node, NodeVersions>,
    epochs: Vec<Epoch>,
    commits: HashMap<CommitId, Commit>,
    joins: Vec<Join>,
}

/// The secrets of a commit's path: at level 0 derived from its author's own key and its nonce, each one above from
/// the one below it.
fn path_secrets(own: &Secret, nonce: &[u8; 32], height: u8) -> Vec<Secret> {
    let mut path = vec![own.child("key tree path", nonce)];
    for _ in 0..height {
        let up = path.last().expect("a secret").child("key tree path up", b"");
        path.push(up);
    }
    path
}

/// The secret `levels` levels up a path from `from`.
fn climb(from: Secret, levels: u8) -> Secret {
    (0..levels).fold(from, |s, _| s.child("key tree path up", b""))
}

/// The key of epoch `epoch` that the secret at the top of a commit's path derives.
fn epoch_key(top: &Secret, epoch: u64) -> Secret {
    top.child("key tree epoch key", &epoch.to_be_bytes())
}

/// Whether `ids` are exactly the commits `of`, each once.
fn same_set(ids: impl Iterator<Item = CommitId>, of: &[CommitId]) -> bool {
    let mut n = 0;
    let got: BTreeSet<CommitId> = ids.inspect(|_| n += 1).collect();
    n == got.len() && got == of.iter().copied().collect()
}

impl KeyTree {
    /// An empty tree, its boxes bound to `context`: the audience whose keys it holds.
    pub fn new(context: &[u8]) -> KeyTree {
        KeyTree {
            context: hash::hash("key tree context", context),
            height: 0,
            members: BTreeMap::new(),
            leaf_of: HashMap::new(),
            held: HashMap::new(),
            nodes: BTreeMap::new(),
            epochs: vec![Epoch::default()],
            commits: HashMap::new(),
            joins: vec![],
        }
    }

    pub fn height(&self) -> u8 {
        self.height
    }

    pub fn epoch(&self) -> u64 {
        self.epochs.len() as u64 - 1
    }

    /// The commits whose keys epoch `epoch` has.
    pub fn keys(&self, epoch: u64) -> &[CommitId] {
        self.epochs.get(epoch as usize).map_or(&[], |e| &e.keys)
    }

    /// Whether the keys of epoch `epoch` wrap the keys of the epoch before.
    pub fn chains(&self, epoch: u64) -> bool {
        self.epochs.get(epoch as usize).is_some_and(|e| e.chains)
    }

    pub fn members(&self) -> impl Iterator<Item = &Member> {
        self.members.values()
    }

    pub fn is_member(&self, d: SignerId) -> bool {
        self.leaf_of.contains_key(&d)
    }

    /// The commits whose secrets node `n` holds now: more than one where commits made apart both wrote it.
    pub fn current(&self, n: Node) -> Vec<CommitId> {
        self.nodes.get(&n).map_or(vec![], |versions| versions.current().map(|w| w.commit).collect())
    }

    /// A commit that counted.
    pub fn commit(&self, id: CommitId) -> Option<&Commit> {
        self.commits.get(&id)
    }

    /// Apply a change, the next in the replay order; a change refused changes nothing.
    pub fn apply(&mut self, change: &Change) -> Result<(), Refused> {
        match change {
            Change::Add { device, leaf, public, history, boxes } => self.add(*device, *leaf, public, *history, boxes),
            Change::Remove { device } => self.remove(*device),
            Change::Commit(c) => self.land(c),
        }
    }

    /// Device `device` joins at leaf `leaf`: with the history, each key of the epoch now boxed to it; without, a new
    /// epoch starts that keeps no history. The tree grows to hold the leaf.
    fn add(
        &mut self,
        device: SignerId,
        leaf: u64,
        public: &[u8],
        history: bool,
        boxes: &[(CommitId, Vec<u8>)],
    ) -> Result<(), Refused> {
        if self.leaf_of.contains_key(&device) || self.members.contains_key(&leaf) {
            return Err(Refused::Taken);
        }
        let height = (u64::BITS - leaf.leading_zeros()) as u8;
        if height > MAX_HEIGHT {
            return Err(Refused::TooHigh);
        }
        if public.len() != XWING_PUBLIC_BYTES {
            return Err(Refused::Malformed);
        }
        let epoch = self.epoch();
        if !same_set(boxes.iter().map(|b| b.0), if history { self.keys(epoch) } else { &[] }) {
            return Err(Refused::History);
        }
        self.height = self.height.max(height);
        self.members.insert(leaf, Member { device, leaf, public: public.to_vec() });
        self.leaf_of.insert(device, leaf);
        self.held.entry(device).or_default().insert(leaf);
        if history {
            self.joins.extend(boxes.iter().map(|(c, b)| Join { device, epoch, commit: *c, bytes: b.clone() }));
        } else {
            self.epochs.push(Epoch { chains: false, keys: vec![] });
        }
        Ok(())
    }

    /// Device `device` leaves: no secret it opens is one to seal to any more, and a new epoch starts that keeps the
    /// history.
    fn remove(&mut self, device: SignerId) -> Result<(), Refused> {
        let leaf = self.leaf_of.remove(&device).ok_or(Refused::NotMember)?;
        self.members.remove(&leaf);
        for versions in self.nodes.values_mut() {
            versions.remove(device);
        }
        self.epochs.push(Epoch { chains: true, keys: vec![] });
        Ok(())
    }

    fn written(&self, n: Node, c: CommitId) -> Option<&Written> {
        self.nodes.get(&n)?.written(c)
    }

    /// Who opens key `k`: a leaf's device, a node secret's knowers. No box is sealed to an epoch key.
    fn knowers_of(&self, k: &TreeKey) -> Vec<SignerId> {
        match *k {
            TreeKey::Leaf(d) => vec![d],
            TreeKey::Node(n, c) => self.written(n, c).map_or(vec![], |w| w.knowers.iter().copied().collect()),
            TreeKey::Epoch(..) => vec![],
        }
    }

    /// Who opens the secret commit `c` writes at `level`: its author, and whoever opens a key it sealed a secret at or
    /// below that level to, as each secret derives the one above it.
    fn knowers_at(&self, c: &Commit, level: u8) -> BTreeSet<SignerId> {
        let mut out = BTreeSet::from([c.author]);
        for b in c.boxes.iter().filter(|b| b.level <= level) {
            out.extend(self.knowers_of(&b.to));
        }
        out
    }

    /// Whether only members open key `k`: a member's own key, or a secret that a commit that counted wrote and that
    /// no device that left opens.
    fn clean(&self, k: &TreeKey) -> bool {
        match *k {
            TreeKey::Leaf(d) => self.is_member(d),
            TreeKey::Node(n, c) => self.written(n, c).is_some_and(|w| w.knowers.iter().all(|d| self.is_member(*d))),
            TreeKey::Epoch(..) => false,
        }
    }

    /// The model's `targetOk` for every box, and what the tree asks beyond it: the epoch, a public key a level, and
    /// exactly the fills and history wraps the model adds. The author's leaf if the commit counts.
    fn check(&self, c: &Commit, id: CommitId) -> Result<u64, Refused> {
        let leaf = *self.leaf_of.get(&c.author).ok_or(Refused::NotMember)?;
        let epoch = self.epoch();
        if c.epoch != epoch {
            return Err(Refused::StaleEpoch);
        }
        if self.commits.contains_key(&id) {
            return Err(Refused::Repeated);
        }
        if c.publics.len() != self.height as usize || c.publics.iter().any(|p| p.len() != XWING_PUBLIC_BYTES) {
            return Err(Refused::Malformed);
        }
        for b in &c.boxes {
            if !self.clean(&b.to) {
                return Err(Refused::Unclean);
            }
            if b.level == 0 || b.level > self.height {
                return Err(Refused::OffPath);
            }
            let side = Node::copath(leaf, b.level);
            let below = match b.to {
                TreeKey::Leaf(d) => self.leaf_of.get(&d).is_some_and(|&l| side.over(Node::above(l, 0))),
                TreeKey::Node(n, _) => side.over(n),
                TreeKey::Epoch(..) => false,
            };
            if !below {
                return Err(Refused::OffPath);
            }
        }
        let reached = self.knowers_at(c, self.height);
        let missed: BTreeSet<SignerId> =
            self.members.values().map(|m| m.device).filter(|d| !reached.contains(d)).collect();
        let fills: Vec<SignerId> = c.fills.iter().map(|f| f.0).collect();
        if fills.len() != missed.len() || fills.iter().collect::<BTreeSet<_>>() != missed.iter().collect() {
            return Err(Refused::Fills);
        }
        let before = if self.chains(epoch) { self.keys(epoch - 1) } else { &[] };
        if !same_set(c.history.iter().map(|h| h.0), before) {
            return Err(Refused::History);
        }
        Ok(leaf)
    }

    /// Commit `c` counts: each node on its path holds the new secret beside the ones its author didn't see, and the
    /// epoch has a new key.
    fn land(&mut self, c: &Commit) -> Result<(), Refused> {
        let id = c.id();
        let leaf = self.check(c, id)?;
        // the check against flat boxes: the new key reaches exactly the members, the devices a box to each would reach
        debug_assert!({
            let reached = self.knowers_at(c, self.height);
            let fills: BTreeSet<SignerId> = c.fills.iter().map(|f| f.0).collect();
            let all: BTreeSet<SignerId> = self.members.values().map(|m| m.device).collect();
            reached.union(&fills).copied().collect::<BTreeSet<_>>() == all
        });
        let saw: HashSet<CommitId> = c.saw.iter().copied().collect();
        for level in 1..=self.height {
            let knowers = self.knowers_at(c, level);
            self.nodes
                .entry(Node::above(leaf, level))
                .or_default()
                .land(Written { commit: id, public: c.publics[level as usize - 1].clone(), knowers }, &saw);
        }
        self.epochs.last_mut().expect("an epoch").keys.push(id);
        self.commits.insert(id, c.clone());
        Ok(())
    }

    /// What a box of commit `c` is bound to: the audience, what kind of box it is, the commit, and whom it is for.
    fn info(&self, what: &str, c: CommitId, rest: &[u8]) -> Vec<u8> {
        let mut h = Hasher::new("key tree box");
        h.update(&self.context).update(&[what.len() as u8]).update(what.as_bytes()).update(&c.0).update(rest);
        h.finalize().to_vec()
    }

    fn path_info(&self, c: CommitId, level: u8, to: &TreeKey) -> Vec<u8> {
        let mut rest = vec![level];
        to.encode(&mut rest);
        self.info("path", c, &rest)
    }

    fn join_info(&self, device: SignerId, epoch: u64, c: CommitId) -> Vec<u8> {
        self.info("join", c, &[&device.0[..], &epoch.to_be_bytes()].concat())
    }

    /// The keys that reach every member below node `n`: its secrets now, and the own key of each member below it that
    /// opens none of them; through a node with no secret, its children's; at a leaf, its device's own key.
    fn resolution(&self, n: Node, out: &mut Vec<TreeKey>) {
        if self.members.range(n.leaves()).next().is_none() {
            return;
        }
        if n.level == 0 {
            out.push(TreeKey::Leaf(self.members[&n.index].device));
            return;
        }
        let current: Vec<&Written> = self.nodes.get(&n).map_or(vec![], |versions| versions.current().collect());
        if current.is_empty() {
            for child in n.children() {
                self.resolution(child, out);
            }
            return;
        }
        out.extend(current.iter().map(|w| TreeKey::Node(n, w.commit)));
        for m in self.members.range(n.leaves()).map(|(_, m)| m) {
            if current.iter().all(|w| !w.knowers.contains(&m.device)) {
                out.push(TreeKey::Leaf(m.device));
            }
        }
    }

    /// The public key a box to `k` is sealed to.
    fn public_of(&self, k: &TreeKey) -> Option<&[u8]> {
        match *k {
            TreeKey::Leaf(d) => Some(&self.members.get(self.leaf_of.get(&d)?)?.public),
            TreeKey::Node(n, c) => self.written(n, c).map(|w| &w.public[..]),
            TreeKey::Epoch(..) => None,
        }
    }

    /// The commit member `me`, whose own key is `own`, drafts on the tree as it stands (the model's `draft`): new
    /// secrets on its whole path, each sealed to the keys that reach the other side; the epoch's new key boxed to each
    /// member those miss (none, once every member has committed: `draft_reaches_all`); and each key of the epoch before
    /// wrapped under it, where the epoch keeps the history. `None` if `me` is no member, or doesn't open a key of the
    /// epoch before that it must wrap.
    pub fn draft(&self, me: SignerId, own: &Secret, rng: &mut impl CryptoRng) -> Option<Change> {
        let leaf = *self.leaf_of.get(&me)?;
        let epoch = self.epoch();
        let nonce = Secret::generate(rng).bytes();
        let path = path_secrets(own, &nonce, self.height);
        let publics = path[1..].iter().map(Secret::xwing_public).collect();
        let saw = (1..=self.height).flat_map(|l| self.current(Node::above(leaf, l))).collect();
        let mut c = Commit { author: me, epoch, nonce, saw, publics, boxes: vec![], fills: vec![], history: vec![] };
        let id = c.id();
        for level in 1..=self.height {
            let mut to = vec![];
            self.resolution(Node::copath(leaf, level), &mut to);
            for t in to {
                let bytes =
                    keys::seal_tree(&path[level as usize], self.public_of(&t)?, &self.path_info(id, level, &t), rng)?;
                c.boxes.push(PathBox { level, to: t, bytes });
            }
        }
        let key = epoch_key(&path[self.height as usize], epoch);
        let reached = self.knowers_at(&c, self.height);
        for m in self.members.values().filter(|m| !reached.contains(&m.device)) {
            c.fills.push((m.device, keys::seal_tree(&key, &m.public, &self.info("fill", id, &m.device.0), rng)?));
        }
        if self.chains(epoch) {
            let mut opener = self.opener(me, own);
            for &old in self.keys(epoch - 1) {
                let k = opener.epoch_key(epoch - 1, old)?;
                c.history.push((old, keys::wrap(&k, &key, &self.info("history", id, &old.0), rng)));
            }
        }
        Some(Change::Commit(c))
    }

    /// The change that adds device `device` at leaf `leaf`, with its own X-Wing key `public`: with the history, each key
    /// of the epoch now boxed to it, which member `me` opens from its own key `own`; without, nothing, as it starts an
    /// epoch of its own. `None` if `me` doesn't open a key of the epoch now, or `public` is no X-Wing key.
    #[allow(clippy::too_many_arguments)]
    pub fn draft_add(
        &self,
        me: SignerId,
        own: &Secret,
        device: SignerId,
        leaf: u64,
        public: Vec<u8>,
        history: bool,
        rng: &mut impl CryptoRng,
    ) -> Option<Change> {
        let mut boxes = vec![];
        if history {
            let epoch = self.epoch();
            let mut opener = self.opener(me, own);
            for &c in self.keys(epoch) {
                let k = opener.epoch_key(epoch, c)?;
                boxes.push((c, keys::seal_tree(&k, &public, &self.join_info(device, epoch, c), rng)?));
            }
        }
        Some(Change::Add { device, leaf, public, history, boxes })
    }

    /// What device `me` opens from its own key `own` alone.
    pub fn opener<'a>(&'a self, me: SignerId, own: &'a Secret) -> Opener<'a> {
        Opener { tree: self, me, own, paths: HashMap::new(), epochs: HashMap::new() }
    }
}

/// What a device opens from its own key alone, through the boxes sealed to keys it opens: the model's `Reach`. Each
/// answer is kept, so each box is opened at most once.
pub struct Opener<'a> {
    tree: &'a KeyTree,
    me: SignerId,
    own: &'a Secret,
    paths: HashMap<(CommitId, u8), Option<Secret>>,
    epochs: HashMap<(u64, CommitId), Option<Secret>>,
}

impl Opener<'_> {
    /// The secret commit `c` wrote at `level` of its path: its author derives it from its own key, and whoever opens a
    /// box of the commit at or below the level climbs to it.
    fn path(&mut self, c: CommitId, level: u8) -> Option<Secret> {
        if let Some(s) = self.paths.get(&(c, level)) {
            return s.clone();
        }
        self.paths.insert((c, level), None);
        let got = self.path_through(c, level);
        self.paths.insert((c, level), got.clone());
        got
    }

    fn path_through(&mut self, c: CommitId, level: u8) -> Option<Secret> {
        let tree = self.tree;
        let commit = tree.commits.get(&c)?;
        if commit.author == self.me {
            let s = path_secrets(self.own, &commit.nonce, level).pop()?;
            // its own key derives the secrets the commit's public keys name
            return (level == 0 || commit.publics.get(level as usize - 1) == Some(&s.xwing_public())).then_some(s);
        }
        // a node secret it may open lies on the path of a leaf it was at
        let leaves = tree.held.get(&self.me)?;
        for b in commit.boxes.iter().filter(|b| b.level >= 1 && b.level <= level) {
            let with = match b.to {
                TreeKey::Leaf(d) if d == self.me => Some(self.own.clone()),
                TreeKey::Node(n, w) if leaves.iter().any(|&l| n.over(Node::above(l, 0))) => self.path(w, n.level),
                _ => None,
            };
            let Some(with) = with else { continue };
            let Some(s) = keys::open(&b.bytes, &with, &tree.path_info(c, b.level, &b.to)) else {
                continue;
            };
            // the secret the commit's public key at that level names, and no other
            if commit.publics.get(b.level as usize - 1) != Some(&s.xwing_public()) {
                continue;
            }
            let upper = climb(s, level - b.level);
            // A valid box at a lower level does not prove that the announced upper
            // public belongs to the derived secret. Never return an unconfirmed
            // path secret when a malformed commit announces inconsistent levels.
            if commit.publics.get(level as usize - 1) != Some(&upper.xwing_public()) {
                continue;
            }
            return Some(upper);
        }
        None
    }

    /// The key of epoch `epoch` that commit `c` derived: from the top of its path, or a fill or a join box to the
    /// device's own key, or through a key of the next epoch, where that epoch keeps the history.
    pub fn epoch_key(&mut self, epoch: u64, c: CommitId) -> Option<Secret> {
        if let Some(k) = self.epochs.get(&(epoch, c)) {
            return k.clone();
        }
        let got = self.epoch_direct(epoch, c);
        self.epochs.insert((epoch, c), got.clone());
        if got.is_some() {
            return got;
        }
        // Path recursion strictly decreases the node level (at most MAX_HEIGHT).
        // History, in contrast, can span every past epoch. Keep its DFS frames on
        // the heap so an old key never consumes one Rust stack frame per epoch.
        // The next-child cursor preserves the recursive opener's search order.
        let mut pending = vec![(epoch, c, 0_usize)];
        while let Some(&(at, id, next_index)) = pending.last() {
            let tree = self.tree;
            let valid = tree.commits.get(&id).is_some_and(|commit| commit.epoch == at);
            if self.epochs[&(at, id)].is_some() || !valid || !tree.chains(at + 1) {
                pending.pop();
                continue;
            }
            let Some(&next) = tree.keys(at + 1).get(next_index) else {
                pending.pop();
                continue;
            };
            let child = (at + 1, next);
            if !self.epochs.contains_key(&child) {
                let got = self.epoch_direct(child.0, child.1);
                self.epochs.insert(child, got.clone());
                if got.is_none() {
                    pending.push((child.0, child.1, 0));
                    continue;
                }
            }
            pending.last_mut().expect("the parent frame").2 += 1;
            let Some(under) = self.epochs[&child].as_ref() else {
                continue;
            };
            let Some(wrap) = tree.commits.get(&next).and_then(|n| n.history.iter().find(|h| h.0 == id)) else {
                continue;
            };
            if let Some(key) = keys::open(&wrap.1, under, &tree.info("history", next, &id.0)) {
                self.epochs.insert((at, id), Some(key));
            }
        }
        self.epochs[&(epoch, c)].clone()
    }

    /// Open without following history links into a later epoch.
    fn epoch_direct(&mut self, epoch: u64, c: CommitId) -> Option<Secret> {
        let tree = self.tree;
        let commit = tree.commits.get(&c).filter(|k| k.epoch == epoch)?;
        if let Some(top) = self.path(c, commit.publics.len() as u8) {
            return Some(epoch_key(&top, epoch));
        }
        let me = self.me;
        if let Some(f) = commit.fills.iter().find(|f| f.0 == me) {
            if let Some(k) = keys::open(&f.1, self.own, &tree.info("fill", c, &me.0)) {
                return Some(k);
            }
        }
        for j in tree.joins.iter().filter(|j| j.device == me && j.epoch == epoch && j.commit == c) {
            if let Some(k) = keys::open(&j.bytes, self.own, &tree.join_info(me, epoch, c)) {
                return Some(k);
            }
        }
        None
    }

    /// Every key of the epoch now that the device opens.
    pub fn keys_now(&mut self) -> Vec<(CommitId, Secret)> {
        let epoch = self.tree.epoch();
        let ids = self.tree.keys(epoch).to_vec();
        ids.into_iter().filter_map(|c| Some((c, self.epoch_key(epoch, c)?))).collect()
    }
}

impl TreeKey {
    fn encode(&self, out: &mut Vec<u8>) {
        match *self {
            TreeKey::Leaf(d) => {
                out.push(0);
                out.extend_from_slice(&d.0);
            }
            TreeKey::Node(n, c) => {
                out.push(1);
                out.push(n.level);
                out.extend_from_slice(&n.index.to_be_bytes());
                out.extend_from_slice(&c.0);
            }
            TreeKey::Epoch(g, c) => {
                out.push(2);
                out.extend_from_slice(&g.to_be_bytes());
                out.extend_from_slice(&c.0);
            }
        }
    }

    fn decode(r: &mut Reader<'_>) -> Option<TreeKey> {
        Some(match r.u8().ok()? {
            0 => TreeKey::Leaf(SignerId(r.array().ok()?)),
            1 => {
                let level = r.u8().ok()?;
                let index = u64::from_be_bytes(r.array().ok()?);
                if level > MAX_HEIGHT {
                    return None;
                }
                TreeKey::Node(Node { level, index }, CommitId(r.array().ok()?))
            }
            2 => TreeKey::Epoch(u64::from_be_bytes(r.array().ok()?), CommitId(r.array().ok()?)),
            _ => return None,
        })
    }
}

/// Bytes behind their length.
fn put(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    out.extend_from_slice(bytes);
}

/// A count of what follows.
fn count(out: &mut Vec<u8>, n: usize) {
    out.extend_from_slice(&(n as u32).to_be_bytes());
}

/// A list of keys by commit, each with its box.
fn put_boxes(out: &mut Vec<u8>, boxes: &[(CommitId, Vec<u8>)]) {
    count(out, boxes.len());
    for (c, b) in boxes {
        out.extend_from_slice(&c.0);
        put(out, b);
    }
}

fn read_boxes(r: &mut Reader<'_>) -> Option<Vec<(CommitId, Vec<u8>)>> {
    let n = r.count(36).ok()?;
    (0..n).map(|_| Some((CommitId(r.array().ok()?), r.bytes().ok()?))).collect()
}

impl Change {
    /// The change as bytes: the format, then the change. Every value has a fixed size or its length in front of it.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = vec![FORMAT];
        match self {
            Change::Add { device, leaf, public, history, boxes } => {
                out.push(0);
                out.extend_from_slice(&device.0);
                out.extend_from_slice(&leaf.to_be_bytes());
                put(&mut out, public);
                out.push(*history as u8);
                put_boxes(&mut out, boxes);
            }
            Change::Remove { device } => {
                out.push(1);
                out.extend_from_slice(&device.0);
            }
            Change::Commit(c) => {
                out.push(2);
                out.extend_from_slice(&c.author.0);
                out.extend_from_slice(&c.epoch.to_be_bytes());
                out.extend_from_slice(&c.nonce);
                count(&mut out, c.saw.len());
                for s in &c.saw {
                    out.extend_from_slice(&s.0);
                }
                count(&mut out, c.publics.len());
                for p in &c.publics {
                    put(&mut out, p);
                }
                count(&mut out, c.boxes.len());
                for b in &c.boxes {
                    out.push(b.level);
                    b.to.encode(&mut out);
                    put(&mut out, &b.bytes);
                }
                count(&mut out, c.fills.len());
                for (d, b) in &c.fills {
                    out.extend_from_slice(&d.0);
                    put(&mut out, b);
                }
                put_boxes(&mut out, &c.history);
            }
        }
        out
    }

    /// A change from its bytes: `None` for another format, or for bytes that aren't one change whole.
    pub fn from_bytes(bytes: &[u8]) -> Option<Change> {
        let mut r = Reader::new(bytes);
        if r.u8().ok()? != FORMAT {
            return None;
        }
        let change = match r.u8().ok()? {
            0 => {
                let device = SignerId(r.array().ok()?);
                let leaf = u64::from_be_bytes(r.array().ok()?);
                let public = r.bytes().ok()?;
                let history = match r.u8().ok()? {
                    0 => false,
                    1 => true,
                    _ => return None,
                };
                Change::Add { device, leaf, public, history, boxes: read_boxes(&mut r)? }
            }
            1 => Change::Remove { device: SignerId(r.array().ok()?) },
            2 => {
                let author = SignerId(r.array().ok()?);
                let epoch = u64::from_be_bytes(r.array().ok()?);
                let nonce = r.array().ok()?;
                let n = r.count(32).ok()?;
                let saw = (0..n).map(|_| Some(CommitId(r.array().ok()?))).collect::<Option<_>>()?;
                let n = r.count(4).ok()?;
                let publics = (0..n).map(|_| r.bytes().ok()).collect::<Option<_>>()?;
                let n = r.count(38).ok()?;
                let mut boxes = Vec::with_capacity(n.min(64));
                for _ in 0..n {
                    let level = r.u8().ok()?;
                    let to = TreeKey::decode(&mut r)?;
                    boxes.push(PathBox { level, to, bytes: r.bytes().ok()? });
                }
                let n = r.count(36).ok()?;
                let fills =
                    (0..n).map(|_| Some((SignerId(r.array().ok()?), r.bytes().ok()?))).collect::<Option<_>>()?;
                let history = read_boxes(&mut r)?;
                Change::Commit(Commit { author, epoch, nonce, saw, publics, boxes, fills, history })
            }
            _ => return None,
        };
        r.done().then_some(change)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::SeededRng;

    /// Devices with their own keys, at leaves 0, 1, 2, ...
    struct Cast {
        rng: SeededRng,
        tree: KeyTree,
        own: Vec<(SignerId, Secret)>,
    }

    impl Cast {
        /// `n` devices; the first starts the tree, each next one is added with the history by the first.
        fn new(n: usize) -> Cast {
            let mut rng = SeededRng::new("key tree tests", &(n as u64).to_be_bytes());
            let own: Vec<(SignerId, Secret)> =
                (0..n).map(|i| (SignerId([i as u8 + 1; 32]), Secret::generate(&mut rng))).collect();
            let mut c = Cast { rng, tree: KeyTree::new(b"an audience"), own };
            let (d0, k0) = c.own[0].clone();
            c.apply(Change::Add { device: d0, leaf: 0, public: k0.xwing_public(), history: false, boxes: vec![] });
            c.commit(0);
            for i in 1..n {
                c.add(i, true);
            }
            c
        }

        fn apply(&mut self, change: Change) {
            let bytes = change.to_bytes();
            assert_eq!(Change::from_bytes(&bytes).as_ref(), Some(&change), "a change reads back from its bytes");
            self.tree.apply(&change).expect("the change counts");
        }

        fn draft(&mut self, i: usize) -> Change {
            let (d, k) = self.own[i].clone();
            self.tree.draft(d, &k, &mut self.rng).expect("a member drafts")
        }

        fn commit(&mut self, i: usize) -> CommitId {
            let change = self.draft(i);
            let Change::Commit(c) = &change else { unreachable!() };
            let id = c.id();
            self.apply(change);
            id
        }

        /// Device `i` joins at leaf `i`, added by device 0.
        fn add(&mut self, i: usize, history: bool) {
            let (d0, k0) = self.own[0].clone();
            let (d, k) = self.own[i].clone();
            let change = self.tree.draft_add(d0, &k0, d, i as u64, k.xwing_public(), history, &mut self.rng);
            self.apply(change.expect("device 0 opens the epoch's keys"));
        }

        fn keys_now(&self, i: usize) -> Vec<(CommitId, Secret)> {
            let (d, k) = &self.own[i];
            self.tree.opener(*d, k).keys_now()
        }

        fn opens(&self, i: usize, epoch: u64, c: CommitId) -> Option<Secret> {
            let (d, k) = &self.own[i];
            self.tree.opener(*d, k).epoch_key(epoch, c)
        }
    }

    #[test]
    fn thousands_of_history_epochs_open_on_a_small_thread_stack() {
        // Exercise the opener with a cryptographically valid wrap chain and one
        // late join box. Policy/replay membership is covered by the Cast tests;
        // this fixture isolates the unbounded history traversal itself.
        std::thread::Builder::new()
            .stack_size(128 * 1024)
            .spawn(|| {
                let mut rng = SeededRng::new("long key tree history", b"");
                let owner = SignerId([1; 32]);
                let joined = SignerId([2; 32]);
                let own = Secret::generate(&mut rng);
                let mut tree = KeyTree::new(b"long history");
                tree.epochs.clear();
                let mut previous: Option<(CommitId, Secret)> = None;
                let mut first = None;
                for epoch in 0..4096_u64 {
                    let key = Secret::generate(&mut rng);
                    let mut commit = Commit {
                        author: owner,
                        epoch,
                        nonce: Secret::generate(&mut rng).bytes(),
                        saw: vec![],
                        publics: vec![],
                        boxes: vec![],
                        fills: vec![],
                        history: vec![],
                    };
                    let id = commit.id();
                    if let Some((old, secret)) = &previous {
                        commit
                            .history
                            .push((*old, keys::wrap(secret, &key, &tree.info("history", id, &old.0), &mut rng)));
                    }
                    if first.is_none() {
                        first = Some((id, key.clone()));
                    }
                    tree.epochs.push(Epoch { chains: epoch != 0, keys: vec![id] });
                    tree.commits.insert(id, commit);
                    previous = Some((id, key));
                }
                let (latest, key) = previous.unwrap();
                let epoch = tree.epoch();
                let bytes =
                    keys::seal_tree(&key, &own.xwing_public(), &tree.join_info(joined, epoch, latest), &mut rng)
                        .unwrap();
                tree.joins.push(Join { device: joined, epoch, commit: latest, bytes });
                let (id, expected) = first.unwrap();
                let mut opener = tree.opener(joined, &own);
                assert_eq!(opener.epoch_key(0, id), Some(expected.clone()));
                assert_eq!(opener.epoch_key(0, id), Some(expected), "verified openings are reused");
                assert!(opener.epoch_key(u64::MAX, id).is_none(), "unknown epochs do not wrap arithmetic");
                let outsider = Secret::generate(&mut rng);
                assert!(tree.opener(joined, &outsider).epoch_key(0, id).is_none(), "the join box is required");
                tree.epochs[2048].chains = false;
                assert!(tree.opener(joined, &own).epoch_key(0, id).is_none(), "a no-history boundary is not crossed");
            })
            .unwrap()
            .join()
            .unwrap();
    }

    #[test]
    fn current_versions_match_the_historical_scan_without_scanning_history() {
        // The old representation is the slow reference: every historical secret
        // carries its current flag. Exercise replacement, unseen concurrent
        // versions, removals, rejoining knowers, and empty/duplicate saw lists.
        let mut versions = NodeVersions::default();
        let mut slow: Vec<(Written, bool)> = Vec::new();
        let mut random = 0x72b81a9d_u64;
        for step in 0..4096_u64 {
            random = random.wrapping_mul(6364136223846793005).wrapping_add(1);
            let device = SignerId([(random >> 32) as u8 % 8; 32]);
            if step % 11 == 10 {
                versions.remove(device);
                for (written, current) in &mut slow {
                    if written.knowers.contains(&device) {
                        *current = false;
                    }
                }
            } else {
                let mut id = [0; 32];
                id[..8].copy_from_slice(&step.to_be_bytes());
                let id = CommitId(id);
                let saw: HashSet<_> = slow
                    .iter()
                    .enumerate()
                    .filter(|(i, (_, current))| *current && (i + step as usize) % 3 != 0)
                    .map(|(_, (written, _))| written.commit)
                    .collect();
                let knowers = BTreeSet::from([device, SignerId([(step % 8) as u8; 32])]);
                let written = Written { commit: id, public: step.to_be_bytes().to_vec(), knowers };
                for (old, current) in &mut slow {
                    if saw.contains(&old.commit) {
                        *current = false;
                    }
                }
                slow.push((written.clone(), true));
                versions.land(written, &saw);
            }
            let expected: Vec<_> = slow.iter().filter(|(_, current)| *current).map(|(w, _)| w.commit).collect();
            assert_eq!(versions.current().map(|w| w.commit).collect::<Vec<_>>(), expected, "step {step}");
            assert_eq!(versions.history.len(), slow.len(), "history is retained");
            assert_eq!(versions.by_commit.len(), slow.len(), "one historical lookup per commit");
        }
        for (written, _) in &slow {
            let held = versions.written(written.commit).expect("old secrets remain readable");
            assert_eq!(held.public, written.public);
            assert_eq!(held.knowers, written.knowers);
        }
        assert!(versions.history.len() > 3000);
        assert!(versions.current.len() < 10, "resolution retains only current concurrent versions");
    }

    #[test]
    fn every_member_opens_the_epochs_key_and_a_full_tree_takes_a_box_a_level() {
        let mut c = Cast::new(8);
        assert_eq!(c.tree.height(), 3);
        // once every member has committed, a commit reaches all through the tree: one box a level, no fills
        for i in 0..8 {
            c.commit(i);
        }
        let change = c.draft(5);
        let Change::Commit(commit) = &change else { unreachable!() };
        assert_eq!((commit.boxes.len(), commit.fills.len()), (3, 0), "three boxes, where flat boxes take seven");
        let id = commit.id();
        c.apply(change);
        let epoch = c.tree.epoch();
        let key = c.opens(5, epoch, id).expect("its author opens it");
        for i in 0..8 {
            assert_eq!(c.opens(i, epoch, id), Some(key.clone()), "member {i}");
        }
    }

    #[test]
    fn a_removed_device_opens_no_later_key_and_the_members_keep_the_history() {
        let mut c = Cast::new(6);
        for i in 0..6 {
            c.commit(i);
        }
        let (before, old) = (c.tree.epoch(), c.commit(2));
        let old_key = c.opens(4, before, old).unwrap();
        c.apply(Change::Remove { device: c.own[3].0 });
        assert!(c.tree.chains(c.tree.epoch()), "a removal's epoch keeps the history");
        // a commit drafted before the removal is made apart from it: refused, its author drafts again
        let mut late = Cast::new(6);
        for i in 0..6 {
            late.commit(i);
        }
        let stale = late.draft(1);
        assert_eq!(c.tree.clone().apply(&stale), Err(Refused::StaleEpoch));
        let new = c.commit(1);
        let epoch = c.tree.epoch();
        let key = c.opens(1, epoch, new).unwrap();
        for i in [0, 1, 2, 4, 5] {
            assert_eq!(c.opens(i, epoch, new), Some(key.clone()), "member {i} opens the new key");
        }
        assert!(c.opens(3, epoch, new).is_none(), "the removed device doesn't");
        assert!(c.keys_now(3).is_empty());
        // the new key wraps the old one, so a member opens the history through it
        assert_eq!(c.opens(5, before, old), Some(old_key));
    }

    #[test]
    fn commits_made_apart_both_stay_and_every_member_opens_both() {
        let mut c = Cast::new(4);
        for i in 0..4 {
            c.commit(i);
        }
        // devices 0 and 3 draft on the same tree, apart; the replay order applies both
        let (a, b) = (c.draft(0), c.draft(3));
        let ids: Vec<CommitId> =
            [&a, &b].iter().map(|x| if let Change::Commit(k) = x { k.id() } else { unreachable!() }).collect();
        c.apply(a);
        c.apply(b);
        let top = Node { level: 2, index: 0 };
        let current = c.tree.current(top);
        assert!(ids.iter().all(|id| current.contains(id)), "the top holds both secrets");
        let epoch = c.tree.epoch();
        for i in 0..4 {
            let keys = c.keys_now(i);
            assert!(ids.iter().all(|id| keys.iter().any(|(k, _)| k == id)), "member {i} opens both keys");
        }
        // the next commit saw both and replaces them
        let next = c.commit(1);
        assert_eq!(c.tree.current(top), vec![next]);
        assert!(c.opens(2, epoch, next).is_some());
    }

    #[test]
    fn a_device_added_without_the_history_opens_only_what_comes_after() {
        let mut c = Cast::new(3);
        let (before, old) = (c.tree.epoch(), c.commit(1));
        c.own.push((SignerId([9; 32]), Secret::generate(&mut c.rng)));
        c.add(3, false);
        assert!(!c.tree.chains(c.tree.epoch()));
        let new = c.commit(0);
        let epoch = c.tree.epoch();
        assert!(c.opens(3, epoch, new).is_some(), "it opens the epoch it joined in");
        assert!(c.opens(3, before, old).is_none(), "but no key before it");
        assert!(c.opens(2, before, old).is_some());
    }

    #[test]
    fn a_lower_path_box_cannot_confirm_an_inconsistent_upper_public() {
        let mut cast = Cast::new(4);
        let Change::Commit(mut commit) = cast.draft(0) else { unreachable!() };
        assert_eq!(commit.publics.len(), 2);
        let actual = path_secrets(&cast.own[0].1, &commit.nonce, cast.tree.height());
        // An authorized but faulty author can encrypt valid lower boxes while
        // claiming another root public. Rebind every box to the changed commit
        // ID, so rejection cannot be explained merely by an old AEAD context.
        commit.publics[1] = Secret::generate(&mut cast.rng).xwing_public();
        let id = commit.id();
        for boxed in &mut commit.boxes {
            boxed.bytes = keys::seal_tree(
                &actual[boxed.level as usize],
                cast.tree.public_of(&boxed.to).unwrap(),
                &cast.tree.path_info(id, boxed.level, &boxed.to),
                &mut cast.rng,
            )
            .unwrap();
        }
        assert!(commit.fills.is_empty());
        assert!(commit.history.is_empty());
        // Public schedule validation cannot prove every ciphertext consistent;
        // each local opener must also confirm the public at its target level.
        cast.apply(Change::Commit(commit));
        let epoch = cast.tree.epoch();
        for i in 0..4 {
            assert!(cast.opens(i, epoch, id).is_none(), "member {i} must reject the inconsistent path");
        }
    }

    #[test]
    fn a_tree_refuses_what_the_model_would_not_count() {
        let mut c = Cast::new(4);
        let stranger = (SignerId([77; 32]), Secret::generate(&mut c.rng));
        assert!(c.tree.draft(stranger.0, &stranger.1, &mut c.rng).is_none(), "no member, no draft");
        // a commit missing a fill, or with the history of another epoch
        let Change::Commit(mut commit) = c.draft(2) else { unreachable!() };
        let mut no_fill = commit.clone();
        if no_fill.fills.pop().is_some() {
            assert_eq!(c.tree.clone().apply(&Change::Commit(no_fill)), Err(Refused::Fills));
        }
        commit.history.push((CommitId([0; 32]), vec![]));
        assert_eq!(c.tree.clone().apply(&Change::Commit(commit)), Err(Refused::History));
        // the same commit twice
        let change = c.draft(1);
        c.apply(change.clone());
        assert_eq!(c.tree.apply(&change), Err(Refused::Repeated));
        // a device added twice, or at a taken leaf
        let (d, k) = c.own[1].clone();
        let again = Change::Add { device: d, leaf: 9, public: k.xwing_public(), history: false, boxes: vec![] };
        assert_eq!(c.tree.apply(&again), Err(Refused::Taken));
        // bytes of another format, or cut short, read as nothing
        let bytes = change.to_bytes();
        assert!(Change::from_bytes(&bytes[..bytes.len() - 1]).is_none());
        assert!(Change::from_bytes(&[&[FORMAT + 1][..], &bytes[1..]].concat()).is_none());
    }
}
