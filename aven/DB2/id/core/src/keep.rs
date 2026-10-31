//! Keepers: fetch keys that chain, proofs, and what a keeper keeps for whom (`Aven.ID.Keep`, A22, A44).
//!
//! A keeper reads no caps, so it checks who may fetch or upload by key proofs alone:
//! - fetch keys chain from the Doc's genesis, each link signed by the key before it, one epoch deeper; a keeper takes
//!   exactly the keys that chain, and every successor (`fetch_chain`, `kept_every`);
//! - where two links follow one key, the current one is the smaller epoch hash, at each fork from the genesis on, or
//!   the branch the keep cap's issuer chose (`current_agrees`, `grind_settled`), and every fork is flagged
//!   (`fork_flagged`);
//! - it serves a fetch, and takes an upload, only from a device that signed the connection's TLS exporter with the
//!   current fetch key, or a branch's newest while a fork is unsettled (`served_current`, `fork_served`).
//!
//! What it keeps, and for whom: a Doc listed by a keep cap the issuer's owners approved, naming the keeper, not
//! withdrawn, not deleted, and covered by one of the keeper's own offers (`Books.keeps`); and how much for a vault, the
//! largest quota its offers give (`Books.quota`).
//!
//! The model names keys and epoch hashes by numbers; here they are any ordered types, so the same code runs over the
//! model's vectors and over real keys. A [`Proof`] is only ever made from a signature already verified under the key
//! it names, over the bytes the fetch gate fixes (`Aven.Peer.Fetch.proofBytes`), as a [`crate::caps::Sig`] is.

use aven_core::DocId;

use crate::caps::{Cap, Form, Holder, Line, issued};
use crate::tree::Tree;

/// A fetch key's link: its Doc, its epoch's depth and hash, the new key, the key before it, and the key whose
/// signature the link carries.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FetchLink<D, E, K> {
    pub doc: D,
    pub n: u64,
    pub epoch: E,
    pub key: K,
    pub prev: K,
    pub signer: K,
}

impl<D, E: Ord, K: Ord> FetchLink<D, E, K> {
    /// `a` goes before `b`: a smaller epoch hash, or the same hash and a key no larger (`FetchLink.before`).
    fn before(&self, b: &Self) -> bool {
        self.epoch < b.epoch || (self.epoch == b.epoch && self.key <= b.key)
    }
}

/// The keep cap's issuer settling a fork: the depth and key it is from, the branch to follow, and the device that
/// signed it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Choice<K> {
    pub depth: u64,
    pub fork: K,
    pub branch: K,
    pub signer: String,
}

/// A device's proof on one connection: the device, its vault as the door's tree says, the fetch key it signed with,
/// and the TLS exporter it signed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Proof<K, X> {
    pub device: String,
    pub vault: String,
    pub key: K,
    pub exporter: X,
}

/// What a keeper holds for one Doc: its first fetch key, every link that came, the devices of the vault that issued
/// its keep cap (as the tree says), and that vault's choices at forks.
#[derive(Clone, Debug)]
pub struct Keep<D, E, K> {
    pub doc: D,
    pub genesis: K,
    pub links: Vec<FetchLink<D, E, K>>,
    pub issuer: Vec<String>,
    pub choices: Vec<Choice<K>>,
}

impl<D: Eq, E: Ord, K: Ord + Clone> Keep<D, E, K> {
    /// The links a keeper takes from key `k` at depth `i`: for its Doc, one epoch deeper, after `k`, signed by it
    /// (`successors`).
    pub fn successors(&self, i: u64, k: &K) -> Vec<&FetchLink<D, E, K>> {
        self.links
            .iter()
            .filter(|l| l.doc == self.doc && l.n == i + 1 && l.prev == *k && l.signer == *k)
            .collect()
    }

    /// The fetch keys a keeper takes at depth `i`: the genesis's, then the keys of the links after them (`level`).
    pub fn level(&self, i: u64) -> Vec<K> {
        let mut keys = vec![self.genesis.clone()];
        for d in 0..i {
            keys = keys
                .iter()
                .flat_map(|k| self.successors(d, k).into_iter().map(|l| l.key.clone()))
                .collect();
        }
        keys
    }

    /// The link that goes first (`least`): of two that go alike, the earlier.
    fn least<'a>(links: &[&'a FetchLink<D, E, K>]) -> Option<&'a FetchLink<D, E, K>> {
        links
            .iter()
            .rev()
            .fold(None, |m: Option<&FetchLink<D, E, K>>, l| match m {
                None => Some(l),
                Some(m) => Some(if l.before(m) { l } else { m }),
            })
    }

    /// The branch the issuer chose at the fork from `k` at depth `i`: by one of its devices, naming a key the keeper
    /// keeps there; of two different choices, the smaller key (`chosen`).
    pub fn chosen(&self, i: u64, k: &K) -> Option<K> {
        let next = self.successors(i, k);
        self.choices
            .iter()
            .filter(|c| {
                c.depth == i
                    && c.fork == *k
                    && self.issuer.contains(&c.signer)
                    && next.iter().any(|l| l.key == c.branch)
            })
            .map(|c| c.branch.clone())
            .min()
    }

    /// Where a keeper goes from `k` at depth `i`: the issuer's choice, else the smaller epoch hash (`next`).
    fn next(&self, i: u64, k: &K) -> Option<K> {
        self.chosen(i, k)
            .or_else(|| Self::least(&self.successors(i, k)).map(|l| l.key.clone()))
    }

    /// The deepest any link goes (`depth`).
    pub fn depth(&self) -> u64 {
        self.links.iter().map(|l| l.n).max().unwrap_or(0)
    }

    /// The current fetch key: from the genesis, at each fork the issuer's choice or the smaller epoch hash, to the
    /// end (`current`).
    pub fn current(&self) -> K {
        let mut k = self.genesis.clone();
        for i in 0..self.depth() {
            match self.next(i, &k) {
                Some(c) => k = c,
                None => break,
            }
        }
        k
    }

    /// A fork: two links the keeper takes from one key, to different keys (`forked`).
    pub fn forked(&self, i: u64, k: &K) -> bool {
        let next = self.successors(i, k);
        next.iter().any(|l| next.iter().any(|m| l.key != m.key))
    }

    /// Every fork on the chain, by its depth and the key it forks from (`flags`).
    pub fn flags(&self) -> Vec<(u64, K)> {
        (0..self.depth())
            .flat_map(|i| {
                self.level(i)
                    .into_iter()
                    .filter(move |k| self.forked(i, k))
                    .map(move |k| (i, k))
            })
            .collect()
    }

    /// A flagged fork the issuer hasn't settled yet (`unsettled`).
    pub fn unsettled(&self) -> bool {
        self.flags()
            .iter()
            .any(|(i, k)| self.chosen(*i, k).is_none())
    }

    /// A branch's newest key: one the keeper keeps that nothing follows (`newest`).
    pub fn newest(&self, k: &K) -> bool {
        (0..=self.depth()).any(|i| self.level(i).contains(k) && self.successors(i, k).is_empty())
    }

    /// The keeper serves a fetch, or takes an upload, on the connection with `exporter`, only for a proof over that
    /// exporter by the current fetch key, or, while a fork is unsettled, by any branch's newest (`serves`).
    pub fn serves<X: Eq>(&self, exporter: &X, p: &Proof<K, X>) -> bool {
        p.exporter == *exporter
            && (p.key == self.current() || (self.unsettled() && self.newest(&p.key)))
    }
}

/// A keep cap as its keeper holds it: the cap, and the Docs its issuer's device resolved its target to, each with its
/// first fetch key (`Listing`).
#[derive(Clone, Debug)]
pub struct Listing<K> {
    pub cap: Cap,
    pub docs: Vec<(DocId, K)>,
}

/// What a device of a keep cap's issuer orders its keeper: withdraw that cap, or delete a Doc.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Order {
    Withdraw(String),
    Delete(DocId),
}

/// An order and the device that sent it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeepOrder {
    pub order: Order,
    pub signer: String,
}

/// avenID's own op, by its id: the name of its stored form `{"op": name, "plugin": "id/1"}` (`idOp`).
pub fn id_op(name: &str) -> aven_core::OpId {
    crate::caps::plugin_op("id/1", name)
}

/// A keeper's offer of its storage (`keepOffer`, A44).
pub fn keep_offer() -> aven_core::OpId {
    id_op("keep-offer")
}

/// The quota an offer gives: the largest its `keep-offer` lines bound to one number (`Cap.offerQuota`).
pub fn offer_quota(o: &Cap) -> u64 {
    let op = keep_offer();
    o.grant
        .iter()
        .filter(|l| l.op == op)
        .filter_map(|l: &Line| match l.bound("quota").map(|b| b.0.as_slice()) {
            Some([aven_core::Value::Uint(q)]) => Some(*q),
            _ => None,
        })
        .max()
        .unwrap_or(0)
}

/// A keeper's books: its own vault, the tree, how many owners each vault needs, the keep caps it was handed, the
/// orders that came, its own vault's offers, and who is in each group they name (`Books`).
pub struct Books<'a, K> {
    pub keeper: String,
    pub tree: &'a Tree,
    pub threshold: &'a dyn Fn(&str) -> usize,
    pub listings: Vec<Listing<K>>,
    pub orders: Vec<KeepOrder>,
    pub offers: Vec<Cap>,
    pub in_group: &'a dyn Fn(&DocId, &str) -> bool,
}

impl<K> Books<'_, K> {
    fn approved(&self, c: &Cap) -> bool {
        self.tree
            .approves(self.threshold, &c.issuer, &c.id, &c.approvals)
    }

    /// A keep cap the keeper takes: a grant to its vault, issued by its issuer, which the issuer's owners approved
    /// (`valid`).
    pub fn valid(&self, c: &Cap) -> bool {
        c.form == Form::Grant
            && c.holder == Holder::Vault(self.keeper.clone())
            && issued(self.tree, self.threshold, c)
            && self.approved(c)
    }

    fn signed_by(&self, v: &str, o: &KeepOrder) -> bool {
        self.tree.acts_for(&o.signer) == Some(v)
    }

    /// A cap a device of its issuer withdrew (`withdrawn`).
    pub fn withdrawn(&self, c: &Cap) -> bool {
        self.orders
            .iter()
            .any(|o| o.order == Order::Withdraw(c.id.clone()) && self.signed_by(&c.issuer, o))
    }

    /// A Doc a device of vault `v` deleted (`deleted`).
    pub fn deleted(&self, v: &str, d: &DocId) -> bool {
        self.orders
            .iter()
            .any(|o| o.order == Order::Delete(*d) && self.signed_by(v, o))
    }

    /// An offer the keeper stands by: a grant of its own vault, issued and approved, not withdrawn, that offers
    /// storage (`offerValid`).
    pub fn offer_valid(&self, o: &Cap) -> bool {
        let op = keep_offer();
        o.form == Form::Grant
            && o.issuer == self.keeper
            && issued(self.tree, self.threshold, o)
            && self.approved(o)
            && !self.withdrawn(o)
            && o.grant.iter().any(|l| l.op == op)
    }

    /// Whom an offer covers: the vault it names, or every vault in the group it names (`offeredTo`).
    pub fn offered_to(&self, o: &Cap, v: &str) -> bool {
        match &o.holder {
            Holder::Vault(w) => w == v,
            Holder::Group(g) => (self.in_group)(g, v),
            Holder::Public => false,
        }
    }

    /// The keeper's own offers cover vault `v` (`offered`).
    pub fn offered(&self, v: &str) -> bool {
        self.offers
            .iter()
            .any(|o| self.offer_valid(o) && self.offered_to(o, v))
    }

    /// How much the keeper keeps for vault `v`: the largest quota of the offers that cover it (`quota`).
    pub fn quota(&self, v: &str) -> u64 {
        self.offers
            .iter()
            .filter(|o| self.offer_valid(o) && self.offered_to(o, v))
            .map(offer_quota)
            .max()
            .unwrap_or(0)
    }

    /// The keeper keeps `d` under the keep cap `l` (`keepsUnder`).
    pub fn keeps_under(&self, l: &Listing<K>, d: &DocId) -> bool {
        self.valid(&l.cap)
            && !self.withdrawn(&l.cap)
            && l.docs.iter().any(|(x, _)| x == d)
            && !self.deleted(&l.cap.issuer, d)
            && self.offered(&l.cap.issuer)
    }

    /// The keeper keeps `d`: under one of its keep caps (`keeps`).
    pub fn keeps(&self, d: &DocId) -> bool {
        self.listings.iter().any(|l| self.keeps_under(l, d))
    }

    /// The keeper serves a fetch of `d`, or takes an upload for it, only while it keeps `d`, and only for a device
    /// that proves `d`'s current fetch key (`Books.serves`). The vault the device acts for when it serves: the one the
    /// keeper bills.
    pub fn serves<E: Ord, X: Eq>(
        &self,
        k: &Keep<String, E, K>,
        d: &DocId,
        exporter: &X,
        p: &Proof<K, X>,
    ) -> Option<String>
    where
        K: Ord + Clone,
    {
        (self.keeps(d) && k.serves(exporter, p)).then(|| p.vault.clone())
    }
}

/// A keeper's bytes (`Aven.ID.KeepCbor`, A30, A44): everything a keeper checks is one of Core's signed things, a label
/// and a body with its signatures beside it, named by the hash of the two. Each body has exactly its own keys, none
/// null and none optional (A42). A fetch key is Ed25519, its seed `derive_key("avenDB fetch key 1", the Doc epoch's
/// key)`, so every reader of the epoch derives it and a keeper checks by its public half.
pub mod bytes {
    use aven_core::{DocId, Hash, Sig, Signed, Value};
    use ed25519_dalek::{Signature, SigningKey, VerifyingKey};

    use crate::Secret;

    pub const LISTING_LABEL: &str = "avenID keep listing 1";
    pub const LINK_LABEL: &str = "avenDB fetch link 1";
    pub const ORDER_LABEL: &str = "avenID keep order 1";
    pub const CHOICE_LABEL: &str = "avenID keep choice 1";
    /// The fetch proof's label, caps' (the keeper's `Aven.Peer.Fetch` cites it).
    pub const FETCH_LABEL: &str = "avenDB fetch 1";
    /// What a fetch key's seed is derived under.
    pub const FETCH_KEY_LABEL: &str = "avenDB fetch key 1";

    /// A fetch key's Ed25519 seed, from the key of the Doc epoch it opens (`fetchSeed`).
    pub fn fetch_seed(epoch_key: &Secret) -> Secret {
        Secret::take(&mut blake3::derive_key(FETCH_KEY_LABEL, epoch_key.expose()))
    }

    /// A fetch key, its private half: what a reader of the epoch signs links and proofs with.
    pub fn fetch_signer(epoch_key: &Secret) -> SigningKey {
        SigningKey::from_bytes(fetch_seed(epoch_key).expose())
    }

    /// A fetch key's public half, which a keeper checks proofs and links by (`fetchKey`).
    pub fn fetch_key(epoch_key: &Secret) -> [u8; 32] {
        fetch_signer(epoch_key).verifying_key().to_bytes()
    }

    /// An Ed25519 signature by the fetch key `key` over `msg`, as [`aven_core::Verify`] asks.
    pub fn verify(key: &[u8], msg: &[u8], sig: &[u8]) -> bool {
        let (Ok(key), Ok(sig)) = (<[u8; 32]>::try_from(key), <[u8; 64]>::try_from(sig)) else {
            return false;
        };
        VerifyingKey::from_bytes(&key)
            .is_ok_and(|k| k.verify_strict(msg, &Signature::from_bytes(&sig)).is_ok())
    }

    fn doc(d: &DocId) -> Value {
        Value::Bytes(d.0.0.to_vec())
    }

    fn name(h: &Hash) -> Value {
        Value::Bytes(h.0.to_vec())
    }

    fn map(kvs: Vec<(&str, Value)>) -> Value {
        Value::Map(kvs.into_iter().map(|(k, v)| (k.into(), v)).collect())
    }

    fn signed(label: &str, body: Value, sigs: Vec<Sig>) -> Signed {
        Signed {
            label: label.into(),
            body,
            sigs,
        }
    }

    /// A listing: the keep cap it rests on, by its name, and each Doc with its first fetch key, number 0. A device
    /// acting for the keep cap's issuer signs it, or the issuer's owners, k of n.
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct Listing {
        pub cap: Hash,
        pub docs: Vec<(DocId, [u8; 32])>,
    }

    impl Listing {
        pub fn body(&self) -> Value {
            map(vec![
                ("cap", name(&self.cap)),
                (
                    "docs",
                    Value::Array(
                        self.docs
                            .iter()
                            .map(|(d, k)| {
                                map(vec![("doc", doc(d)), ("key", Value::Bytes(k.to_vec()))])
                            })
                            .collect(),
                    ),
                ),
            ])
        }

        pub fn signed(&self, sigs: Vec<Sig>) -> Signed {
            signed(LISTING_LABEL, self.body(), sigs)
        }
    }

    /// Fetch link `n ≥ 1`: the Doc, the epoch it opens by its name, its new fetch key, and the name before it (the
    /// link before, or the listing for link 1). Fetch key `n − 1` signs it.
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct Link {
        pub doc: DocId,
        pub epoch: Hash,
        pub key: [u8; 32],
        pub n: u64,
        pub prev: Hash,
    }

    impl Link {
        pub fn body(&self) -> Value {
            map(vec![
                ("n", Value::Uint(self.n)),
                ("doc", doc(&self.doc)),
                ("key", Value::Bytes(self.key.to_vec())),
                ("prev", name(&self.prev)),
                ("epoch", name(&self.epoch)),
            ])
        }

        pub fn signed(&self, sigs: Vec<Sig>) -> Signed {
            signed(LINK_LABEL, self.body(), sigs)
        }
    }

    /// What a keep cap's issuer orders its keeper: withdraw the keep cap named, or delete a Doc. Signed as a listing.
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub enum Order {
        Withdraw(Hash),
        Delete(DocId),
    }

    impl Order {
        pub fn body(&self) -> Value {
            match self {
                Order::Withdraw(c) => map(vec![
                    ("act", Value::Text("withdraw".into())),
                    ("cap", name(c)),
                ]),
                Order::Delete(d) => {
                    map(vec![("act", Value::Text("delete".into())), ("doc", doc(d))])
                }
            }
        }

        pub fn signed(&self, sigs: Vec<Sig>) -> Signed {
            signed(ORDER_LABEL, self.body(), sigs)
        }
    }

    /// Which branch to follow at a fork of a Doc's fetch keys: the key forked from, and the next key chosen. A device of
    /// the vault that issued the keep cap signs it (A22).
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct Choice {
        pub doc: DocId,
        pub fork: [u8; 32],
        pub branch: [u8; 32],
    }

    impl Choice {
        pub fn body(&self) -> Value {
            map(vec![
                ("doc", doc(&self.doc)),
                ("fork", Value::Bytes(self.fork.to_vec())),
                ("branch", Value::Bytes(self.branch.to_vec())),
            ])
        }

        pub fn signed(&self, sigs: Vec<Sig>) -> Signed {
            signed(CHOICE_LABEL, self.body(), sigs)
        }
    }

    /// What a fetch key signs to prove it on a connection: the Doc, and the connection's TLS exporter (`proofBody`).
    pub fn proof_body(d: &DocId, exporter: &[u8]) -> Value {
        map(vec![
            ("doc", doc(d)),
            ("exporter", Value::Bytes(exporter.to_vec())),
        ])
    }

    /// The proof as Core's signed thing (`proofSigned`): the fetch key it proves signs [`Signed::signing`].
    pub fn proof_signed(d: &DocId, exporter: &[u8], sigs: Vec<Sig>) -> Signed {
        signed(FETCH_LABEL, proof_body(d, exporter), sigs)
    }
}
