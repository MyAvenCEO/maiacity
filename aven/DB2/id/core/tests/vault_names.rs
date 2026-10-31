//! Vault names against Lean's vectors (`Aven.ID.VaultName`, `id/spec/vectors/vaults.json`): each of the cast's
//! geneses written and named byte for byte, and geneses read back or refused as the model says.

mod common;

use aven_id::{CAST_VAULTS, Kind, VaultGenesis, cast_name, cast_nonce};
use serde_json::Value;

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
fn every_vault_name_is_the_models() {
    let all = common::vectors("vaults.json");
    assert!(all.len() >= 10, "{} vault vectors", all.len());
    for v in &all {
        let (input, name) = (&v["input"], v["name"].as_str().unwrap());
        if name.starts_with("read back") {
            let reads = VaultGenesis::from_bytes(&unhex(&input["bytes"])).is_some();
            assert_eq!(reads, v["expected"]["reads"].as_bool().unwrap(), "{name}");
            continue;
        }
        let genesis = VaultGenesis {
            kind: Kind::parse(input["kind"].as_str().unwrap()).unwrap(),
            nonce: unhex(&input["nonce"]).try_into().unwrap(),
        };
        let encoded = aven_core::encode(&genesis.value());
        assert_eq!(
            hex(&encoded),
            v["expected"]["genesis"].as_str().unwrap(),
            "{name}"
        );
        assert_eq!(
            hex(&genesis.name().0),
            v["expected"]["name"].as_str().unwrap(),
            "{name}"
        );
        assert_eq!(VaultGenesis::from_bytes(&encoded), Some(genesis), "{name}");
        // the cast's vault by its handle: the same nonce and name (`VaultName.castName`, A210)
        let handle = name.trim_start_matches("the name of the cast's ");
        assert_eq!(cast_nonce(handle), genesis.nonce, "{name}");
        assert_eq!(cast_name(handle), genesis.name(), "{name}");
        assert!(
            CAST_VAULTS
                .iter()
                .any(|&(h, k)| h == handle && k == genesis.kind),
            "{name}"
        );
    }
    assert_eq!(
        all.iter()
            .filter(|v| !v["name"].as_str().unwrap().starts_with("read back"))
            .count(),
        CAST_VAULTS.len()
    );
}
