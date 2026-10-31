//! avenID's key formats against Lean's vectors (`Aven.ID.KeyFormats`, `Aven.Core.Hybrid`; `derivations.json`,
//! `stanzas.json`): every derivation and every layout byte for byte. X-Wing's ciphertexts and the sealed keys in
//! `stanzas.json` are fixtures in a pattern; real ones round trip through the same layout (`tests/epochs.rs`).

mod common;

use aven_core::encode;
use aven_id::{
    BACK_LABEL, Context, Epoch, HybridPublic, HybridSignature, PrfOutput, Scope, Secret, Stanza,
    VAULT_LABEL, commit, prf_input, prf_salt, stanza_commit, stanza_keys, subkey, tag,
};
use serde_json::{Value, json};

fn unhex(v: &Value) -> Vec<u8> {
    let s = v.as_str().unwrap();
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap())
        .collect()
}

fn array<const N: usize>(v: &Value) -> [u8; N] {
    unhex(v).try_into().unwrap()
}

fn hex(bytes: &[u8]) -> Value {
    Value::String(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn secret(v: &Value) -> Secret {
    Secret::take(&mut array(v))
}

fn scope(v: &Value) -> Scope {
    Scope::parse(v.as_str().unwrap()).unwrap()
}

fn derive(input: &Value) -> Value {
    if let Some(mode) = input.get("mode") {
        let bytes = unhex(&input["input"]);
        let mut out = vec![0u8; input["length"].as_u64().unwrap() as usize];
        let mut hasher = match mode.as_str().unwrap() {
            "hash" => blake3::Hasher::new(),
            "keyed" => blake3::Hasher::new_keyed(&array(&input["key"])),
            "deriveKey" => blake3::Hasher::new_derive_key(input["context"].as_str().unwrap()),
            other => panic!("a BLAKE3 mode {other}"),
        };
        hasher.update(&bytes);
        hasher.finalize_xof().fill(&mut out);
        return hex(&out);
    }
    if let Some(vault) = input.get("vault") {
        let (vault, epoch) = (vault.as_str().unwrap(), input["epoch"].as_u64().unwrap());
        return json!({ "input": hex(&prf_input(vault, epoch)), "salt": hex(&prf_salt(vault, epoch)) });
    }
    if let Some(prf) = input.get("prf") {
        let prf = PrfOutput::new(secret(prf));
        let (ed, ml) = prf.owner_seeds();
        let public = prf.owner_key().public();
        assert_eq!(
            public.ed25519,
            ed25519_dalek::SigningKey::from_bytes(ed.expose())
                .verifying_key()
                .to_bytes()
        );
        return json!({ "ed25519Seed": hex(ed.expose()), "ed25519Public": hex(&public.ed25519),
            "mlDsaSeed": hex(ml.expose()), "sealSeed": hex(prf.seal_seed().expose()) });
    }
    let id = input["id"].as_str().unwrap();
    let n = input["epoch"].as_u64().unwrap();
    if let Some(shared) = input.get("shared") {
        let context = Context {
            scope: scope(&input["scope"]),
            owner: id,
            n,
        };
        let aad = context.aad(&array(&input["recipient"]));
        let (key, commit_key) = stanza_keys(&array(shared));
        return json!({ "aad": hex(&aad), "key": hex(key.expose()), "commitKey": hex(commit_key.expose()),
            "commit": hex(&stanza_commit(&commit_key, &aad)) });
    }
    if let Some(seed) = input.get("seed") {
        return hex(&tag(&secret(seed), id, n));
    }
    let key = secret(&input["key"]);
    let context = Context {
        scope: scope(&input["scope"]),
        owner: id,
        n,
    };
    json!({ "commit": hex(&commit(&key)), "backKey": hex(subkey(BACK_LABEL, &key).expose()),
        "vaultKey": hex(subkey(VAULT_LABEL, &key).expose()), "innerAad": hex(&context.inner_aad()) })
}

#[test]
fn every_derivation_is_the_models() {
    let all = common::vectors("derivations.json");
    assert!(all.len() >= 20, "{} derivation vectors", all.len());
    for v in &all {
        assert_eq!(derive(&v["input"]), v["expected"], "{}", v["name"]);
    }
}

fn stanza(v: &Value) -> Stanza {
    Stanza {
        ct: array(&v["ct"]),
        commit: array(&v["commit"]),
        sealed: array(&v["sealed"]),
        tag: v.get("tag").map(array),
    }
}

fn epoch(v: &Value) -> Epoch {
    Epoch {
        scope: scope(&v["scope"]),
        owner: v["id"].as_str().unwrap().to_string(),
        n: v["n"].as_u64().unwrap(),
        prev: v["prev"].as_array().unwrap().iter().map(array).collect(),
        stanzas: v["stanzas"]
            .as_array()
            .unwrap()
            .iter()
            .map(stanza)
            .collect(),
        commit: array(&v["commit"]),
        back: v.get("back").map(array),
        vault_key: v.get("vault").map(array),
    }
}

#[test]
fn every_layout_is_the_models() {
    let all = common::vectors("stanzas.json");
    assert!(all.len() >= 7, "{} layout vectors", all.len());
    for v in &all {
        let (input, name) = (&v["input"], v["name"].as_str().unwrap());
        let got = if input.get("ct").is_some() {
            let s = stanza(input);
            assert_eq!(Stanza::of_value(&s.value()), Some(s.clone()), "{name}");
            json!({ "bytes": hex(&encode(&s.value())) })
        } else if input.get("scope").is_some() {
            let e = epoch(input);
            assert_eq!(Epoch::from_bytes(&e.to_bytes()), Some(e.clone()), "{name}");
            json!({ "bytes": hex(&e.to_bytes()), "name": hex(&e.name()) })
        } else if name.contains("signature") {
            let s = HybridSignature {
                ed25519: array(&input["ed25519"]),
                ml_dsa: array(&input["mlDsa"]),
            };
            assert_eq!(
                aven_core::decode(&s.to_bytes()).and_then(|v| HybridPublic::of_value(&v)),
                None,
                "{name}"
            );
            json!({ "bytes": hex(&s.to_bytes()) })
        } else {
            let k = HybridPublic {
                ed25519: array(&input["ed25519"]),
                ml_dsa: array(&input["mlDsa"]),
            };
            json!({ "bytes": hex(&k.to_bytes()) })
        };
        assert_eq!(got, v["expected"], "{name}");
    }
}
