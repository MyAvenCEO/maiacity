//! The keyring Doc against Lean's vectors (`Aven.ID.Keyring`, `keyring.json`), then with real keys: sign-up's
//! genesis, a new device resealed in by another Record of the same epoch, and a rotation that shuts a removed device out.

mod common;

use aven_id::{Epoch, KeyError, PrfOutput, SealKey, Secret, TestEntropy, device_seal_key, keyring};
use serde_json::{Value, json};

fn unhex(v: &Value) -> Vec<u8> {
    let s = v.as_str().unwrap();
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap())
        .collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn the_keyring_is_the_models() {
    let all = common::vectors("keyring.json");
    let mut records: Vec<Epoch> = Vec::new();
    for v in &all {
        let name = v["name"].as_str().unwrap();
        if let Some(rs) = v["input"].get("records") {
            let rs: Vec<Epoch> = rs
                .as_array()
                .unwrap()
                .iter()
                .map(|b| Epoch::from_bytes(&unhex(b)).unwrap())
                .collect();
            let got = json!({
                "stanzas": {
                    "genesis": keyring::stanzas_of(&rs, &rs[0].name()).len(),
                    "reseal": keyring::stanzas_of(&rs, &rs[1].name()).len(),
                    "second": keyring::stanzas_of(&rs, &rs[2].name()).len(),
                },
                "current": hex(&keyring::current(&rs).unwrap().name()),
            });
            assert_eq!(got, v["expected"], "{name}");
            assert_eq!(rs, records, "{name}: the Records are the ones above");
            continue;
        }
        let e = Epoch::from_bytes(&unhex(&v["expected"]["bytes"])).unwrap();
        let got = json!({ "bytes": hex(&e.to_bytes()), "name": hex(&e.name()), "genesis": keyring::is_genesis(&e) });
        assert_eq!(got, v["expected"], "{name}");
        records.push(e);
    }
    assert_eq!(records.len(), 3);
}

#[test]
fn sign_up_reseal_and_rotation_with_real_keys() {
    let mut entropy = TestEntropy::new("keyring");
    let device_seed = Secret::generate(&mut entropy);
    let device = device_seal_key(&device_seed);
    let passkey = PrfOutput::new(Secret::generate(&mut entropy)).seal_key();
    let vault_key = SealKey::generate(&mut entropy);

    // sign-up: the genesis, sealed to the device and the passkey
    let (genesis, key) = keyring::genesis(
        "alice",
        &vault_key,
        &[device.public(), passkey.public()],
        &mut entropy,
    )
    .unwrap();
    assert!(keyring::is_genesis(&genesis));
    let mut records = vec![genesis.clone()];
    for reader in [&device, &passkey] {
        let opened = keyring::open(&records, reader).unwrap();
        assert_eq!(opened.vault_key.public(), vault_key.public());
        assert_eq!(opened.key, key);
    }

    // a new browser: another Record of the same epoch, the earlier one untouched
    let browser = SealKey::generate(&mut entropy);
    assert_eq!(
        keyring::open(&records, &browser).unwrap_err(),
        KeyError::NotSealedTo
    );
    let resealed = keyring::reseal(&genesis, &key, &browser.public(), &mut entropy).unwrap();
    assert_eq!(resealed.name(), genesis.name());
    assert!(resealed.is_padded());
    records.push(resealed);
    assert_eq!(records[0], genesis);
    assert_eq!(
        keyring::open(&records, &browser)
            .unwrap()
            .vault_key
            .public(),
        vault_key.public()
    );

    // the device leaves: epoch 2 for the browser and the passkey; the device opens no current epoch
    let (second, second_key) = genesis
        .rotate_keyring(
            &key,
            &vault_key,
            &[browser.public(), passkey.public()],
            &mut entropy,
        )
        .unwrap();
    records.push(second.clone());
    assert_eq!(keyring::current(&records).unwrap().name(), second.name());
    assert_eq!(
        keyring::open(&records, &device).unwrap_err(),
        KeyError::NotSealedTo
    );
    let opened = keyring::open(&records, &browser).unwrap();
    assert_eq!(opened.key, second_key);
    assert_eq!(opened.epoch.back(&second_key).unwrap(), key);
}
