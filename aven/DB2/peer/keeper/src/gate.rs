//! The gate's authority half, avenCAPS', behind [`Gate`] (`Aven.ID.Keep`, `Aven.ID.KeepCbor`; brain/peers, "One gate,
//! two halves"). The keeper reads no caps itself: this adapter asks aven-id, and composes, never restates.
//!
//! - **A proof** arrives as `prove {doc, key, sig}` on a connection whose device the door knows. It counts only if `sig`
//!   is the fetch key `key`'s signature over [`bytes::proof_signed`] for this Doc and this connection's TLS exporter,
//!   and then only as [`Placement::serves`] says: the keeper keeps the Doc, and the key is the Doc's current fetch key
//!   on this connection, or a branch's newest while a fork is unsettled (`Books.serves`, `Keep.serves`).
//! - **A link** to a Doc's next fetch key is taken only if a key the keeper already holds one level up signed it
//!   ([`take_link`]); `Keep` then decides which key is current.
//! - **The quota** is the keeper's offers' (`Books.quota`). Bills and admission are the keeper's own
//!   (`Aven.Peer.Serve`).

use std::collections::BTreeMap;

use aven_core::{DocId, Hash, Sig};
use aven_id::keep::{Books, FetchLink, Keep, Proof, bytes};

use crate::serve::Gate;

/// A fetch key's public half.
pub type Key = [u8; 32];

/// A Doc's fetch keys as the keeper holds them: aven-id's `Keep`, the Doc named by its id's hex.
pub type Chain = Keep<String, Hash, Key>;

/// A fetch proof as `prove {doc, key, sig}` carries it, and the door's device for the connection.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FetchProof {
    pub device: String,
    pub key: Key,
    pub sig: Vec<u8>,
}

/// Where a keeper keeps and how much: avenCAPS' `Books`. A trait so the adapter's tests can stand without a whole
/// caps context; in a keeper it is [`Books`].
pub trait Placement {
    /// `Books.serves`: the vault to bill when the keeper keeps `doc` and `proof` holds against `chain`.
    fn serves(
        &self,
        chain: &Chain,
        doc: &DocId,
        exporter: &[u8; 32],
        proof: &Proof<Key, [u8; 32]>,
    ) -> Option<String>;
    /// `Books.quota`.
    fn quota(&self, vault: &str) -> u64;
}

impl Placement for Books<'_, Key> {
    fn serves(
        &self,
        chain: &Chain,
        doc: &DocId,
        exporter: &[u8; 32],
        proof: &Proof<Key, [u8; 32]>,
    ) -> Option<String> {
        Books::serves(self, chain, doc, exporter, proof)
    }
    fn quota(&self, vault: &str) -> u64 {
        Books::quota(self, vault)
    }
}

/// avenCAPS' gate for a keeper: its placement, each Doc's fetch keys, and whom each device acts for (the tree).
pub struct CapsGate<P, A> {
    pub placement: P,
    pub chains: BTreeMap<DocId, Chain>,
    pub acts_for: A,
}

impl<P: Placement, A: Fn(&str) -> Option<String>> Gate<DocId> for CapsGate<P, A> {
    type Proof = FetchProof;
    type Vault = String;

    fn serves(&self, doc: &DocId, exporter: &[u8; 32], p: &FetchProof) -> Option<String> {
        let signed = bytes::proof_signed(
            doc,
            exporter,
            vec![Sig {
                signer: p.key.to_vec(),
                sig: p.sig.clone(),
            }],
        );
        if !signed.signed_by(&bytes::verify, &p.key) {
            return None;
        }
        let vault = (self.acts_for)(&p.device)?;
        let chain = self.chains.get(doc)?;
        let proof = Proof {
            device: p.device.clone(),
            vault,
            key: p.key,
            exporter: *exporter,
        };
        self.placement.serves(chain, doc, exporter, &proof)
    }

    fn quota(&self, vault: &String) -> u64 {
        self.placement.quota(vault)
    }
}

/// A Doc's fetch keys from its first, as a listing names it.
pub fn chain(doc: &DocId, genesis: Key) -> Chain {
    Keep {
        doc: doc.text(),
        genesis,
        links: vec![],
        issuer: vec![],
        choices: vec![],
    }
}

/// Takes fetch link `n` of a Doc if a key the keeper holds at `n − 1` signed it (`fetch_chain`): the key that signed
/// becomes the link's `prev`. A link no held key signed, or one for another Doc, is refused and changes nothing.
pub fn take_link(chain: &mut Chain, link: &bytes::Link, sigs: Vec<Sig>) -> bool {
    if link.n == 0 || chain.doc != link.doc.text() {
        return false;
    }
    let signed = link.signed(sigs);
    let Some(signer) = chain
        .level(link.n - 1)
        .into_iter()
        .find(|k| signed.signed_by(&bytes::verify, k))
    else {
        return false;
    };
    chain.links.push(FetchLink {
        doc: chain.doc.clone(),
        n: link.n,
        epoch: link.epoch,
        key: link.key,
        prev: signer,
        signer,
    });
    true
}
