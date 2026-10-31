//! The gate adapter over avenCAPS' keep module: a proof counts only as the fetch key's signature over this Doc and this
//! connection's exporter, by the Doc's current key, for a device the tree places in a vault, for a Doc the keeper
//! keeps; a link counts only when a key the keeper holds signed it. The keys are real Ed25519 fetch keys derived from
//! epoch keys (`aven_id::keep::bytes`, `keep-bytes.json`); placement is a stand-in for `Books`.

use std::collections::{BTreeMap, BTreeSet};

use aven_core::{DocId, Sig, blake3};
use aven_id::Secret;
use aven_id::keep::Proof;
use aven_id::keep::bytes::{Link, fetch_key, fetch_signer, proof_signed};
use aven_peer_keeper::gate::{CapsGate, Chain, FetchProof, Key, Placement, chain, take_link};
use aven_peer_keeper::serve::Gate;
use ed25519_dalek::Signer;

/// `Books` as far as the keeper needs it: the Docs it keeps, and each vault's quota. Serving composes aven-id's own
/// `Keep::serves`, as `Books::serves` does.
struct Kept(BTreeSet<DocId>);

impl Placement for Kept {
    fn serves(
        &self,
        chain: &Chain,
        doc: &DocId,
        exporter: &[u8; 32],
        proof: &Proof<Key, [u8; 32]>,
    ) -> Option<String> {
        (self.0.contains(doc) && chain.serves(exporter, proof)).then(|| proof.vault.clone())
    }
    fn quota(&self, vault: &str) -> u64 {
        if vault == "alice" { 5000 } else { 0 }
    }
}

fn epoch(n: u8) -> Secret {
    Secret::take(&mut [n; 32])
}

fn prove(epoch_key: &Secret, doc: &DocId, exporter: &[u8; 32], device: &str) -> FetchProof {
    let signer = fetch_signer(epoch_key);
    let sig = signer.sign(&proof_signed(doc, exporter, vec![]).signing());
    FetchProof {
        device: device.into(),
        key: fetch_key(epoch_key),
        sig: sig.to_bytes().to_vec(),
    }
}

fn link(doc: &DocId, n: u64, to: &Secret, by: &Secret) -> (Link, Vec<Sig>) {
    let l = Link {
        doc: *doc,
        epoch: blake3(&[n as u8]),
        key: fetch_key(to),
        n,
        prev: blake3(b"the listing"),
    };
    let sig = fetch_signer(by).sign(&l.signed(vec![]).signing());
    let sigs = vec![Sig {
        signer: fetch_key(by).to_vec(),
        sig: sig.to_bytes().to_vec(),
    }];
    (l, sigs)
}

#[test]
fn proofs_and_links_count_only_as_caps_says() {
    let d1 = DocId(blake3(b"d1"));
    let d9 = DocId(blake3(b"d9"));
    let (x, y) = ([7u8; 32], [8u8; 32]);
    let mut gate = CapsGate {
        placement: Kept([d1].into_iter().collect()),
        chains: BTreeMap::from([
            (d1, chain(&d1, fetch_key(&epoch(0)))),
            (d9, chain(&d9, fetch_key(&epoch(0)))),
        ]),
        acts_for: |device: &str| (device == "alice-light").then(|| "alice".to_string()),
    };
    // the Doc's first fetch key, on this connection: served, billed to Alice's vault
    assert_eq!(
        gate.serves(&d1, &x, &prove(&epoch(0), &d1, &x, "alice-light")),
        Some("alice".into())
    );
    assert_eq!(gate.quota(&"alice".to_string()), 5000);
    // made for another connection, or another Doc, or claiming a key that didn't sign: refused
    assert_eq!(
        gate.serves(&d1, &x, &prove(&epoch(0), &d1, &y, "alice-light")),
        None
    );
    assert_eq!(
        gate.serves(&d1, &x, &prove(&epoch(0), &d9, &x, "alice-light")),
        None
    );
    let mut forged = prove(&epoch(1), &d1, &x, "alice-light");
    forged.key = fetch_key(&epoch(0));
    assert_eq!(gate.serves(&d1, &x, &forged), None);
    // a device the tree places in no vault, and a Doc no keep cap names: refused
    assert_eq!(
        gate.serves(&d1, &x, &prove(&epoch(0), &d1, &x, "carol-light")),
        None
    );
    assert_eq!(
        gate.serves(&d9, &x, &prove(&epoch(0), &d9, &x, "alice-light")),
        None
    );

    // a rotation: link 1 to the next key, signed by the first; then only the new key is current
    let chain1 = gate.chains.get_mut(&d1).unwrap();
    let (l, sigs) = link(&d1, 1, &epoch(1), &epoch(0));
    assert!(take_link(chain1, &l, sigs));
    assert_eq!(chain1.current(), fetch_key(&epoch(1)));
    assert_eq!(
        gate.serves(&d1, &x, &prove(&epoch(0), &d1, &x, "alice-light")),
        None,
        "the old key no more"
    );
    assert_eq!(
        gate.serves(&d1, &x, &prove(&epoch(1), &d1, &x, "alice-light")),
        Some("alice".into())
    );

    // a link no held key signed, one of another Doc, and one that skips a level: refused, nothing taken
    let chain1 = gate.chains.get_mut(&d1).unwrap();
    let before = chain1.links.len();
    let (l, sigs) = link(&d1, 2, &epoch(3), &epoch(9));
    assert!(!take_link(chain1, &l, sigs));
    let (l, sigs) = link(&d9, 2, &epoch(3), &epoch(1));
    assert!(!take_link(chain1, &l, sigs));
    let (l, sigs) = link(&d1, 3, &epoch(3), &epoch(1));
    assert!(!take_link(chain1, &l, sigs));
    assert_eq!(chain1.links.len(), before);
}
