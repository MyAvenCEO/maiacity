//! The device's secure boundary (P8c): a device's secrets stay in its memory, and only while it needs them. Every key
//! wipes itself as it is dropped, and prints as its id alone; a locked device keeps no key (no seed, no cell's key, no
//! entry's key derived from one), nothing a key opened (no selector, no entry's type or tags), and no secret half of a
//! key that nothing else in its process holds; and once it unlocks, it draws randomness that a copy of its memory taken
//! while it was locked can't foresee. One test, alone in its binary, as the McEliece pairs it looks for are the
//! process's, which other tests would make and forget meanwhile.

mod common;

use std::mem::ManuallyDrop;

use avendb::id::{CellId, EntryId, SignerId};
use avendb::keys::{self, KeyFam, KeyId, Secret};
use avendb::lab::Lab;
use avendb::sign::{DeviceKey, Passkey};
use common::*;
use zeroize::ZeroizeOnDrop;

/// Compiles only for a type that wipes its secrets as it is dropped.
fn wipes<T: ZeroizeOnDrop>() {}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The ids of the keys device `d` holds: its own, then each key it opened.
fn held(lab: &Lab, d: SignerId) -> Vec<KeyId> {
    lab.secrets(d).iter().map(Secret::id).collect()
}

/// The entry Alice's iPhone, split off with seed `seed` from a world of its own, creates first, a note of the coop's,
/// after it locked and unlocked again if `relock`: its id is the first thing it draws from its randomness.
fn first_entry(seed: [u8; 32], relock: bool) -> EntryId {
    let mut w = world();
    let h = handbook(&mut w);
    let (phone, passkey) = (w.phone_a, w.passkey_a);
    let mut alone = w.lab.split(phone, &[passkey], seed);
    if relock {
        alone.lock(phone);
        assert!(alone.unlock(phone));
    }
    let note = document("A note", "Seeds for the garden.", phone);
    alone.create(phone, h.coop, h.coop, "note", &[], note).expect("a note")
}

#[test]
fn a_device_keeps_its_secrets_inside_and_only_while_it_needs_them() {
    // every key wipes itself as it is dropped: a key's 32 bytes, and a device's or a passkey's keys
    wipes::<Secret>();
    wipes::<DeviceKey>();
    wipes::<Passkey>();
    let secret = Secret::derive("boundary tests", &[7; 32]);
    let mut dropped = ManuallyDrop::new(secret.clone());
    // SAFETY: dropped once and never again; its bytes stay those of a key, which any 32 bytes are, so they can be read
    unsafe { ManuallyDrop::drop(&mut dropped) };
    assert_eq!(dropped.bytes(), [0; 32], "a dropped key leaves zeros where it was");
    // and prints as its id alone
    let printed = format!("{secret:?}");
    assert!(printed.contains(&format!("{:?}", secret.id())), "{printed}");
    assert!(!printed.contains(&hex(&secret.bytes())[..8]), "{printed}");

    // locked, Alice's iPhone forgets the secret half of its own key, which nothing else here holds, and keeps the
    // pairs of the keys Alice's Mac holds too
    let mut w = world();
    let h = handbook(&mut w);
    let (phone, mac, alice) = (w.phone_a, w.mac_a, w.alice);
    let own = held(&w.lab, phone)[0];
    assert!(keys::pair_made(own), "the iPhone made its own key's pair to open what is sealed to it");
    let phones = held(&w.lab, phone);
    let shared: Vec<Secret> = w.lab.secrets(mac).into_iter().filter(|s| phones.contains(&s.id())).collect();
    let what = "the seeds of Alice's vault, avenCEO and the coop, the key of the coop's cell and its two entries' keys";
    assert!(shared.len() >= 6, "{what} both open: {shared:?}");
    for s in &shared {
        s.public();
    }
    w.lab.lock(phone);
    assert!(w.lab.secrets(phone).is_empty(), "a locked device holds no key");
    assert!(w.lab.meaning(phone, h.welcome).is_none(), "nor reads what an entry is");
    assert!(!keys::pair_made(own), "nor the secret half of its own");
    assert!(shared.iter().all(|s| keys::pair_made(s.id())), "the Mac's keys keep their pairs");
    assert!(w.lab.unlock(phone));
    let none = KeyFam::Cell(h.coop, CellId::of(h.coop, &[]));
    let opens = [KeyFam::Seed(alice), KeyFam::Seed(w.avenceo), KeyFam::Seed(h.coop), none];
    assert!(opens.iter().all(|&k| w.lab.opens(phone, k)), "unlocked, it opens them all again");
    assert!(w.lab.meaning(phone, h.welcome).is_some(), "and reads what Welcome is");
    assert!(keys::pair_made(own), "making its pair again to open the vault key the Mac sealed to it");

    // on a machine of its own, once the iPhone locks, its process holds the secret half of no key the iPhone held
    let mut alone = w.lab.split(phone, &[w.passkey_a], [3; 32]);
    let keys: Vec<Secret> = alone.secrets(phone);
    assert!(keys.len() >= 7, "its own and the keys it opened and derived: {keys:?}");
    for s in &keys {
        s.public();
    }
    alone.lock(phone);
    assert!(keys.iter().all(|s| !keys::pair_made(s.id())), "locked, no pair of a key it held is left");
    assert!(alone.unlock(phone) && opens.iter().all(|&k| alone.opens(phone, k)), "and unlocked, it opens them again");

    // after it unlocks, it draws what a copy of its memory taken while it was locked can't foresee: its randomness is
    // reseeded with its keys, which only its passkey derives again
    let relocked = first_entry([4; 32], true);
    assert_eq!(relocked, first_entry([4; 32], true), "the same passkey reseeds it alike: a failing test replays");
    assert_ne!(relocked, first_entry([4; 32], false), "a copy of it from before it unlocked draws another entry id");
}
