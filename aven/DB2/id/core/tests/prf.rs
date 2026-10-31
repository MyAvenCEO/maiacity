//! The passkey's PRF step and the keyring it opens (id/caps/README.md, "Passkeys and the PRF step", the keyring's row
//! of "The layers"; D11). Every byte of the derivations is Lean's (`tests/key_vectors.rs`); here, what they make: the
//! hybrid owner key, the seal key, and a new browser opening its vault with its passkey alone.

use aven_id::{
    Epoch, HybridKey, KeyError, OWNER_LABEL, PrfOutput, SEAL_LABEL, SealKey, SealPublic, Secret,
    TestEntropy, hybrid_verify, prf_salt,
};
use proptest::prelude::*;

fn output(seed: &str) -> PrfOutput {
    PrfOutput::new(Secret::generate(&mut TestEntropy::new(seed)))
}

#[test]
fn the_seeds_are_blake3s_derivations() {
    let mut raw = [7u8; 32];
    let prf = PrfOutput::new(Secret::take(&mut raw));
    assert_eq!(raw, [0u8; 32], "the caller's copy is wiped");
    let mut wide = [0u8; 64];
    let mut hasher = blake3::Hasher::new_derive_key("avenID owner 1");
    hasher.update(&[7u8; 32]);
    hasher.finalize_xof().fill(&mut wide);
    let (ed, ml) = prf.owner_seeds();
    assert_eq!(ed.expose(), &wide[..32]);
    assert_eq!(ml.expose(), &wide[32..]);
    // the first 32 bytes of the XOF are derive_key's own
    assert_eq!(ed.expose(), &blake3::derive_key(OWNER_LABEL, &[7u8; 32]));
    assert_eq!(
        prf.seal_seed().expose(),
        &blake3::derive_key(SEAL_LABEL, &[7u8; 32])
    );
    assert_eq!(prf.seal_key().seed(), prf.seal_seed());
    assert_eq!(
        prf.owner_key().public(),
        HybridKey::from_seeds(&ed, &ml).public()
    );
}

#[test]
fn secrets_never_print() {
    let prf = output("print");
    assert_eq!(format!("{prf:?}"), "PrfOutput(Secret(..))");
    assert_eq!(format!("{:?}", prf.seal_key()), "SealKey(..)");
    assert_eq!(format!("{:?}", prf.owner_key()), "HybridKey(..)");
}

/// Signing up, then a new browser with the passkey alone (the PRF step's two ceremonies), then the keyring's rotation
/// when a device leaves (its row of "The layers").
#[test]
fn a_new_browser_opens_the_vault_with_its_passkey_alone() {
    let mut entropy = TestEntropy::new("sign-up");
    let laptop = SealKey::generate(&mut entropy);
    let vault = SealKey::generate(&mut entropy);
    // signing up: the PRF answers for alice at owner epoch 1
    let passkey = output("alice's passkey, alice, 1");
    let (mut ring, _) = Epoch::keyring(
        "alice",
        &vault,
        &[laptop.public(), passkey.seal_key().public()],
        &mut entropy,
    )
    .unwrap();

    // a new browser: the same passkey answers the same input with the same output, and nothing else is online
    let again = output("alice's passkey, alice, 1");
    let ring_key = ring.open(&again.seal_key()).unwrap();
    assert_eq!(ring.vault_key(&ring_key).unwrap().public(), vault.public());
    let browser = SealKey::generate(&mut entropy);
    ring.reseal(&ring_key, &browser.public(), &mut entropy)
        .unwrap();
    let name = ring.name();
    assert_eq!(ring.open(&browser).unwrap(), ring_key);
    assert_eq!(
        ring.name(),
        name,
        "adding a device doesn't rename the epoch"
    );
    // a passkey on another owner epoch, or another passkey, opens nothing
    assert_eq!(
        ring.open(&output("alice's passkey, alice, 2").seal_key())
            .unwrap_err(),
        KeyError::NotSealedTo
    );

    // the laptop leaves; a heal gives the vault a new key, sealed to the browser and the passkey
    let healed = SealKey::generate(&mut entropy);
    let (next, next_key) = ring
        .rotate_keyring(
            &ring_key,
            &healed,
            &[browser.public(), passkey.seal_key().public()],
            &mut entropy,
        )
        .unwrap();
    assert_eq!(next.open(&laptop).unwrap_err(), KeyError::NotSealedTo);
    assert_eq!(
        next.vault_key(&next.open(&again.seal_key()).unwrap())
            .unwrap()
            .public(),
        healed.public()
    );
    // the laptop keeps the keyring as it was when it left, and those who remain open the past through back
    assert_eq!(
        ring.vault_key(&ring.open(&laptop).unwrap())
            .unwrap()
            .public(),
        vault.public()
    );
    assert_eq!(next.back(&next_key).unwrap(), ring_key);
}

/// Rotating needs no ceremony: a keyring seals to the seal key's public half, which is all a rotation holds.
#[test]
fn rotation_seals_to_the_public_half() {
    let mut entropy = TestEntropy::new("ceremony");
    let passkey = output("carol");
    let public = SealPublic::from_bytes(&passkey.seal_key().public().to_bytes()).unwrap();
    let device = SealKey::generate(&mut entropy);
    let vault = SealKey::generate(&mut entropy);
    let (ring, key) = Epoch::keyring("carol", &vault, &[device.public()], &mut entropy).unwrap();
    let (next, _) = ring
        .rotate_keyring(&key, &vault, &[device.public(), public], &mut entropy)
        .unwrap();
    assert!(next.open(&passkey.seal_key()).is_ok());
    assert_eq!(SealPublic::from_bytes(&[0u8; 12]), None);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(16))]

    /// Every owner epoch has its own input, and the same output always derives the same keys.
    #[test]
    fn inputs_differ(m in any::<u64>(), n in any::<u64>()) {
        prop_assert_eq!(prf_salt(m) == prf_salt(n), m == n);
    }

    /// A hybrid key, an owner's or a device's: a signature holds for its message under its key, and only with both
    /// halves; as bytes, `hybrid_verify` says the same.
    #[test]
    fn hybrid_signatures_need_both_halves(seed in "[a-z]{1,8}", msg in proptest::collection::vec(any::<u8>(), 0..64), at in any::<prop::sample::Index>()) {
        let key = output(&seed).owner_key();
        let public = output(&seed).owner_key().public();
        let signature = key.sign(&msg);
        prop_assert!(public.verify(&msg, &signature));
        prop_assert!(hybrid_verify(&public.to_bytes(), &msg, &signature.to_bytes()));
        prop_assert!(!hybrid_verify(&signature.to_bytes(), &msg, &public.to_bytes()), "a signature is no key");
        let signed = key.sign_value("avenID test 1", aven_core::Value::Bytes(msg.clone()));
        prop_assert!(signed.valid(&aven_id::Hybrid));
        let mut other = signed.clone();
        other.label = "avenID test 2".into();
        prop_assert!(!other.valid(&aven_id::Hybrid), "a signature for one label is no other's");
        let device = HybridKey::generate(&mut TestEntropy::new(&seed));
        prop_assert!(device.public().verify(&msg, &device.sign(&msg)));
        prop_assert!(!device.public().verify(&msg, &signature));
        prop_assert_eq!(&signature, &output(&seed).owner_key().sign(&msg), "deterministic");
        prop_assert!(!public.verify(&[msg.as_slice(), &[0]].concat(), &signature));
        let mut classical = signature.clone();
        classical.ed25519[at.index(64)] ^= 1;
        prop_assert!(!public.verify(&msg, &classical));
        prop_assert!(!hybrid_verify(&public.to_bytes(), &msg, &classical.to_bytes()));
        let mut quantum = signature.clone();
        quantum.ml_dsa[at.index(quantum.ml_dsa.len())] ^= 1;
        prop_assert!(!public.verify(&msg, &quantum));
        let other = output(&format!("{}x", seed)).owner_key().public();
        prop_assert!(!other.verify(&msg, &signature));
    }
}
