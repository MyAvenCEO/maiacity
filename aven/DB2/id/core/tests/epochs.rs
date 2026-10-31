//! Epochs with real keys (`Aven.ID.Epochs`, `Aven.ID.Forget`, `id/spec/vectors/epochs.json`).
//!
//! Each vector's world is built with X-Wing: every key a seal key of its own, every seal `(k, under)` a stanza sealing
//! `k`'s seed to `under`'s public half. A party starts from its own keys and opens what it can, with the seeds it opens,
//! until nothing more opens; what it then holds is what the model says it learns. Then the properties: a removed
//! reader opens no later epoch (`rotation_shuts_out`) while the old one stays as it was, and a blob reads back as
//! written.

mod common;

use std::collections::HashMap;

use aven_id::{
    Context, Epoch, History, KeyError, Scope, SealKey, SealPublic, Secret, Stanza, TestEntropy,
};
use proptest::prelude::*;
use serde_json::Value;

fn key(name: &str) -> SealKey {
    SealKey::generate(&mut TestEntropy::new(name))
}

fn context(name: &str) -> Context<'_> {
    Context {
        scope: Scope::Doc,
        owner: name,
        n: 0,
    }
}

/// What `party` holds once nothing more opens, opening only with what it has opened.
fn learned(world: &Value, party: &str, entropy: &mut TestEntropy) -> HashMap<String, Secret> {
    let seals: Vec<(String, String)> = world["seals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            (
                s["key"].as_str().unwrap().to_string(),
                s["under"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    let stanzas: Vec<(&str, Stanza)> = seals
        .iter()
        .map(|(k, under)| {
            (
                k.as_str(),
                Stanza::seal(&key(k).seed(), &key(under).public(), &context(k), entropy),
            )
        })
        .collect();
    let mut known: HashMap<String, Secret> = world["own"][party]
        .as_array()
        .map(|own| {
            own.iter()
                .map(|k| {
                    (
                        k.as_str().unwrap().to_string(),
                        key(k.as_str().unwrap()).seed(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    loop {
        let mut opened = Vec::new();
        for (k, stanza) in &stanzas {
            if known.contains_key(*k) {
                continue;
            }
            // every key held is tried on every stanza: only the one it was sealed to opens it
            for seed in known.values() {
                if let Some(inner) = stanza.open(&SealKey::from_seed(seed), &context(k)) {
                    assert_eq!(inner, key(k).seed(), "a stanza opened to the wrong key");
                    opened.push((k.to_string(), inner));
                    break;
                }
            }
        }
        if opened.is_empty() {
            return known;
        }
        known.extend(opened);
    }
}

#[test]
fn every_party_learns_what_the_model_says() {
    let all = common::vectors("epochs.json");
    assert!(all.len() >= 20, "{} epoch vectors", all.len());
    for v in &all {
        let input = &v["input"];
        let party = input["party"].as_str().unwrap();
        let holds = learned(
            &input["world"],
            party,
            &mut TestEntropy::new(v["name"].as_str().unwrap()),
        );
        let k = input["key"].as_str().unwrap();
        assert_eq!(
            holds.contains_key(k),
            v["expected"]["learns"].as_bool().unwrap(),
            "{}",
            v["name"]
        );
    }
}

fn readers(n: usize, seed: u64) -> Vec<SealKey> {
    (0..n).map(|i| key(&format!("reader {seed} {i}"))).collect()
}

fn publics(keys: &[&SealKey]) -> Vec<SealPublic> {
    keys.iter().map(|k| k.public()).collect()
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(12))]

    /// `rotation_shuts_out`: after a reader's removal, every later epoch, sealed to the readers who remain, stays shut
    /// to it; it still opens the epochs it was in, which keep their bytes. Those who remain open the newest, and through
    /// `back` every epoch before, unless a rotation was `from-now`.
    #[test]
    fn rotation_shuts_out(
        count in 2usize..5,
        removed in 0usize..5,
        histories in proptest::collection::vec(any::<bool>(), 1..4),
        seed in any::<u64>(),
    ) {
        let removed = removed % count;
        let keys = readers(count, seed);
        let mut entropy = TestEntropy::new(&format!("rotation {seed}"));
        let (first, first_key) = Epoch::doc("d:01", &publics(&keys.iter().collect::<Vec<_>>()), &mut entropy).unwrap();
        let first_bytes = first.to_bytes();
        let remain: Vec<&SealKey> = keys.iter().enumerate().filter(|(i, _)| *i != removed).map(|(_, k)| k).collect();

        let mut chain = vec![(first.clone(), first_key)];
        for all in &histories {
            let (last, last_key) = chain.last().unwrap();
            let history = if *all { History::All } else { History::FromNow };
            let next = last.rotate_doc(last_key, &publics(&remain), history, &mut entropy).unwrap();
            prop_assert_eq!(next.0.prev, Some(last.id()));
            prop_assert_eq!(next.0.n, last.n + 1);
            chain.push(next);
        }

        for (epoch, epoch_key) in &chain[1..] {
            prop_assert_eq!(epoch.open(&keys[removed]).unwrap_err(), KeyError::NotSealedTo);
            for k in &remain {
                prop_assert_eq!(&epoch.open(k).unwrap(), epoch_key);
            }
        }
        prop_assert_eq!(&first.open(&keys[removed]).unwrap(), &chain[0].1);
        prop_assert_eq!(first.to_bytes(), first_bytes);

        // back down the chain while every step kept history
        let mut at = chain.len() - 1;
        let mut held = chain[at].0.open(remain[0]).unwrap();
        while at > 0 && histories[at - 1] {
            held = chain[at].0.back(&held).unwrap();
            at -= 1;
            prop_assert!(chain[at].0.check(&held).is_ok());
        }
        if at > 0 {
            prop_assert_eq!(chain[at].0.back(&held).unwrap_err(), KeyError::NoBack);
        }
    }

    /// A blob reads back as written, and a blob cut short or lengthened reads as nothing.
    #[test]
    fn a_blob_reads_back(count in 1usize..4, seed in any::<u64>(), cut in any::<prop::sample::Index>()) {
        let keys = readers(count, seed);
        let mut entropy = TestEntropy::new(&format!("blob {seed}"));
        let vault = key(&format!("vault {seed}"));
        let (ring, ring_key) = Epoch::keyring("alice", &vault, &publics(&keys.iter().collect::<Vec<_>>()), &mut entropy).unwrap();
        let (next, _) = ring.rotate_keyring(&ring_key, &vault, &[keys[0].public()], &mut entropy).unwrap();
        for epoch in [ring, next] {
            let bytes = epoch.to_bytes();
            prop_assert_eq!(Epoch::from_bytes(&bytes), Some(epoch.clone()));
            prop_assert_eq!(Epoch::from_bytes(&bytes[..cut.index(bytes.len())]), None);
            prop_assert_eq!(Epoch::from_bytes(&[bytes.as_slice(), &[0]].concat()), None);
        }
    }

    /// Whatever the bytes, reading them never panics.
    #[test]
    fn any_bytes_read_safely(bytes in proptest::collection::vec(any::<u8>(), 0..512)) {
        let _ = Epoch::from_bytes(&bytes);
        let mut with_domain = b"avenID epoch 1\0".to_vec();
        with_domain.extend_from_slice(&bytes);
        let _ = Epoch::from_bytes(&with_domain);
    }

    /// A stanza opens only for its reader and only in its context: another key, another owner, another epoch or
    /// another scope opens nothing.
    #[test]
    fn a_stanza_opens_only_where_it_was_sealed(seed in any::<u64>(), n in any::<u64>(), flip in 0usize..1168) {
        let mut entropy = TestEntropy::new(&format!("stanza {seed}"));
        let (reader, other) = (key(&format!("a {seed}")), key(&format!("b {seed}")));
        let secret = Secret::generate(&mut entropy);
        let here = Context { scope: Scope::Doc, owner: "d:01", n };
        let stanza = Stanza::seal(&secret, &reader.public(), &here, &mut entropy);
        prop_assert_eq!(stanza.open(&reader, &here), Some(secret));
        prop_assert_eq!(stanza.open(&other, &here), None);
        prop_assert_eq!(stanza.open(&reader, &Context { owner: "d:02", ..here }), None);
        prop_assert_eq!(stanza.open(&reader, &Context { n: n.wrapping_add(1), ..here }), None);
        prop_assert_eq!(stanza.open(&reader, &Context { scope: Scope::Keyring, ..here }), None);
        let mut bytes = stanza.to_bytes();
        bytes[flip] ^= 1;
        prop_assert_eq!(Stanza::from_bytes(&bytes).unwrap().open(&reader, &here), None);
    }
}

#[test]
fn a_stanza_with_another_key_fails_the_commitment() {
    let mut entropy = TestEntropy::new("forged");
    let reader = key("reader");
    let (mut epoch, epoch_key) = Epoch::doc("d:01", &[reader.public()], &mut entropy).unwrap();
    // someone who can write stanzas but not the key puts a wrong one first
    let wrong = Secret::generate(&mut entropy);
    let forged = Stanza::seal(
        &wrong,
        &reader.public(),
        &Context {
            scope: Scope::Doc,
            owner: "d:01",
            n: 1,
        },
        &mut entropy,
    );
    epoch.stanzas.insert(0, forged);
    assert_eq!(epoch.open(&reader).unwrap_err(), KeyError::WrongKey);
    assert_eq!(
        epoch
            .reseal(&wrong, &reader.public(), &mut entropy)
            .unwrap_err(),
        KeyError::WrongKey
    );
    assert!(epoch.check(&epoch_key).is_ok());
}

#[test]
fn a_keyring_act_on_a_doc_is_refused() {
    let mut entropy = TestEntropy::new("scopes");
    let reader = key("reader");
    let (doc, doc_key) = Epoch::doc("d:01", &[reader.public()], &mut entropy).unwrap();
    assert_eq!(doc.vault_key(&doc_key).unwrap_err(), KeyError::WrongScope);
    assert_eq!(
        doc.rotate_keyring(&doc_key, &reader, &[reader.public()], &mut entropy)
            .unwrap_err(),
        KeyError::WrongScope
    );
    let (ring, ring_key) =
        Epoch::keyring("alice", &reader, &[reader.public()], &mut entropy).unwrap();
    assert_eq!(
        ring.rotate_doc(&ring_key, &[reader.public()], History::All, &mut entropy)
            .unwrap_err(),
        KeyError::WrongScope
    );
    assert_eq!(
        Epoch::doc("d:01", &[], &mut entropy).unwrap_err(),
        KeyError::NoReaders
    );
}
