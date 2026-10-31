//! The primitives against their known answers and Wycheproof (`tests/kats/README.md`): X-Wing's draft vectors, through
//! aven-id's own seal key and stanza too; Ed25519 and ML-DSA-65 verification as the hybrid key verifies; ML-DSA-65's
//! deterministic signing from a seed, as an owner key signs; XChaCha20-Poly1305 as stanzas seal.

use std::path::PathBuf;

use aven_id::{Context, HybridPublic, HybridSignature, Scope, SealKey, Secret, Stanza};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use ml_dsa::{EncodedSignature, EncodedVerifyingKey, MlDsa65};
use serde_json::Value;
use x_wing::kem::{Decapsulate, KeyExport};

fn load(file: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/kats")
        .join(file);
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap()
}

fn unhex(v: &Value) -> Vec<u8> {
    let s = v.as_str().unwrap_or("");
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap())
        .collect()
}

/// Every Wycheproof test with its group, and whether it must hold (`acceptable` is the library's choice: `None`).
fn wycheproof(file: &str) -> Vec<(Value, Value, Option<bool>)> {
    let all = load(&format!("wycheproof/{file}"));
    let mut out = Vec::new();
    for group in all["testGroups"].as_array().unwrap() {
        for test in group["tests"].as_array().unwrap() {
            let must = match test["result"].as_str().unwrap() {
                "valid" => Some(true),
                "invalid" => Some(false),
                _ => None,
            };
            out.push((group.clone(), test.clone(), must));
        }
    }
    assert!(out.len() > 100, "{file}: {} tests", out.len());
    out
}

#[test]
fn x_wing_answers_as_its_draft() {
    let all = load("xwing.json");
    for v in all.as_array().unwrap() {
        let sk: [u8; 32] = unhex(&v["sk"]).try_into().unwrap();
        let key = SealKey::from_seed(&Secret::take(&mut sk.clone()));
        assert_eq!(key.public().to_bytes().to_vec(), unhex(&v["pk"]));
        let eseed = unhex(&v["eseed"]);
        let raw = x_wing::DecapsulationKey::from(sk);
        let (ct, ss) = x_wing::EncapsulationKey::try_from(unhex(&v["pk"]).as_slice())
            .unwrap()
            .encapsulate_deterministic(eseed.as_slice().try_into().unwrap());
        assert_eq!(ct.to_vec(), unhex(&v["ct"]));
        assert_eq!(ss.to_vec(), unhex(&v["ss"]));
        assert_eq!(raw.decapsulate(&ct).to_vec(), unhex(&v["ss"]));
        assert_eq!(raw.encapsulation_key_bytes(), unhex(&v["pk"]));
        // a stanza takes its 64 bytes of encapsulation randomness first: with the vector's, its ciphertext is the
        // vector's
        let mut entropy = eseed.clone().into_iter();
        let stanza = Stanza::seal(
            &Secret::take(&mut [9u8; 32]),
            &key.public(),
            &Context {
                scope: Scope::Doc,
                owner: "d:01",
                n: 1,
            },
            &mut |out: &mut [u8]| out.iter_mut().for_each(|b| *b = entropy.next().unwrap()),
        );
        assert_eq!(stanza.ct.to_vec(), unhex(&v["ct"]));
    }
}

trait PublicBytes {
    fn encapsulation_key_bytes(&self) -> Vec<u8>;
}

impl PublicBytes for x_wing::DecapsulationKey {
    fn encapsulation_key_bytes(&self) -> Vec<u8> {
        use x_wing::kem::Decapsulator;
        self.encapsulation_key().to_bytes().to_vec()
    }
}

/// Ed25519 as a hybrid key verifies its classical half: every valid signature holds, every invalid one fails.
#[test]
fn ed25519_answers_as_wycheproof() {
    for (group, test, must) in wycheproof("ed25519_test.json") {
        let public = unhex(&group["publicKey"]["pk"]);
        let held = <[u8; 32]>::try_from(public.as_slice()).is_ok_and(|pk| {
            ed25519_dalek::VerifyingKey::from_bytes(&pk).is_ok_and(|key| {
                <[u8; 64]>::try_from(unhex(&test["sig"]).as_slice()).is_ok_and(|sig| {
                    key.verify_strict(
                        &unhex(&test["msg"]),
                        &ed25519_dalek::Signature::from_bytes(&sig),
                    )
                    .is_ok()
                })
            })
        });
        if let Some(must) = must {
            assert_eq!(
                held, must,
                "Ed25519 tcId {}: {}",
                test["tcId"], test["comment"]
            );
        }
    }
}

/// ML-DSA-65 as a hybrid key verifies its post-quantum half, with the test's context.
#[test]
fn ml_dsa_65_verifies_as_wycheproof() {
    for (group, test, must) in wycheproof("mldsa_65_verify_test.json") {
        let public = unhex(&group["publicKey"]);
        let ctx = unhex(&test["ctx"]);
        let held = match (
            EncodedVerifyingKey::<MlDsa65>::try_from(public.as_slice()),
            EncodedSignature::<MlDsa65>::try_from(unhex(&test["sig"]).as_slice()),
        ) {
            (Ok(key), Ok(sig)) => ml_dsa::Signature::<MlDsa65>::decode(&sig).is_some_and(|sig| {
                ml_dsa::VerifyingKey::<MlDsa65>::decode(&key).verify_with_context(
                    &unhex(&test["msg"]),
                    &ctx,
                    &sig,
                )
            }),
            _ => false,
        };
        if let Some(must) = must {
            assert_eq!(
                held, must,
                "ML-DSA-65 tcId {}: {}",
                test["tcId"], test["comment"]
            );
        }
        // with an empty context, the hybrid check's post-quantum half answers the same
        if ctx.is_empty() && public.len() == 1952 && unhex(&test["sig"]).len() == 3309 {
            let key = HybridPublic {
                ed25519: [0u8; 32],
                ml_dsa: public.clone().try_into().unwrap(),
            };
            let sig = HybridSignature {
                ed25519: [0u8; 64],
                ml_dsa: unhex(&test["sig"]).try_into().unwrap(),
            };
            assert!(
                !key.verify(&unhex(&test["msg"]), &sig),
                "never without its classical half"
            );
        }
    }
}

/// ML-DSA-65's deterministic signing from a seed, as an owner key or a device key signs.
#[test]
fn ml_dsa_65_signs_as_wycheproof() {
    for (group, test, must) in wycheproof("mldsa_65_sign_seed_test.json") {
        let seed = unhex(&group["privateSeed"]);
        let flags: Vec<&str> = test["flags"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f.as_str().unwrap())
            .collect();
        let Ok(seed) = <[u8; 32]>::try_from(seed.as_slice()) else {
            assert_eq!(must, Some(false), "tcId {}", test["tcId"]);
            continue;
        };
        let key = ml_dsa::SigningKey::<MlDsa65>::from_seed(&seed.into());
        assert_eq!(
            key.expanded_key().verifying_key().encode().to_vec(),
            unhex(&group["publicKey"])
        );
        if flags.contains(&"Randomized") {
            continue;
        }
        let signed = if test.get("mu").is_some() && test.get("msg").is_none() {
            Ok(key
                .expanded_key()
                .sign_mu_deterministic(&unhex(&test["mu"]).as_slice().try_into().unwrap()))
        } else {
            key.expanded_key()
                .sign_deterministic(&unhex(&test["msg"]), &unhex(&test["ctx"]))
        };
        match (signed, must) {
            (Ok(sig), Some(true)) => assert_eq!(
                sig.encode().to_vec(),
                unhex(&test["sig"]),
                "tcId {}",
                test["tcId"]
            ),
            (Err(_), Some(false)) => {}
            (got, _) => panic!(
                "ML-DSA-65 tcId {}: {} gave {}",
                test["tcId"],
                test["comment"],
                got.is_ok()
            ),
        }
    }
}

/// XChaCha20-Poly1305 as stanzas and epochs seal: every valid case seals to its ciphertext and opens, every invalid
/// one fails to open.
#[test]
fn xchacha20_poly1305_answers_as_wycheproof() {
    for (_, test, must) in wycheproof("xchacha20_poly1305_test.json") {
        let (key, iv, aad, msg) = (
            unhex(&test["key"]),
            unhex(&test["iv"]),
            unhex(&test["aad"]),
            unhex(&test["msg"]),
        );
        let sealed = [unhex(&test["ct"]), unhex(&test["tag"])].concat();
        if key.len() != 32 || iv.len() != 24 {
            assert_eq!(must, Some(false), "tcId {}", test["tcId"]);
            continue;
        }
        let cipher = XChaCha20Poly1305::new(key.as_slice().try_into().unwrap());
        let nonce = XNonce::try_from(iv.as_slice()).unwrap();
        let opened = cipher.decrypt(
            &nonce,
            Payload {
                msg: &sealed,
                aad: &aad,
            },
        );
        match must {
            Some(true) => {
                assert_eq!(
                    opened.as_deref(),
                    Ok(msg.as_slice()),
                    "tcId {}",
                    test["tcId"]
                );
                assert_eq!(
                    cipher
                        .encrypt(
                            &nonce,
                            Payload {
                                msg: &msg,
                                aad: &aad
                            }
                        )
                        .unwrap(),
                    sealed
                );
            }
            Some(false) => assert!(
                opened.is_err(),
                "tcId {}: {}",
                test["tcId"],
                test["comment"]
            ),
            None => {}
        }
    }
}
