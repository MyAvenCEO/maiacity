//! XChaCha20-Poly1305 as the seal uses it (`Aven.ID.Seal` keeps it a parameter, so its known answers fix it here):
//! Wycheproof's cases, from aven-id's copy (`id/core/tests/kats/wycheproof/xchacha20_poly1305_test.json`), whose case
//! 1 is draft-irtf-cfrg-xchacha's known answer (A.3.1). Every valid case seals to its ciphertext and tag and opens;
//! every invalid one fails to open. The calls are the seal's: a 32-byte key, a 24-byte nonce, the AAD, one payload.

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde_json::Value as Json;

fn unhex(v: &Json) -> Vec<u8> {
    let s = v.as_str().unwrap_or("");
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap())
        .collect()
}

fn cases() -> Vec<Json> {
    let path = format!(
        "{}/../../id/core/tests/kats/wycheproof/xchacha20_poly1305_test.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let all: Json = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    all["testGroups"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|g| g["tests"].as_array().unwrap().clone())
        .collect()
}

#[test]
fn the_drafts_known_answer() {
    let all = cases();
    let t = all.iter().find(|t| t["tcId"] == 1).unwrap();
    assert_eq!(t["comment"], "draft-arciszewski-xchacha-02");
    let key: [u8; 32] = unhex(&t["key"]).try_into().unwrap();
    let nonce: [u8; 24] = unhex(&t["iv"]).try_into().unwrap();
    let sealed = XChaCha20Poly1305::new(&key.into())
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: &unhex(&t["msg"]),
                aad: &unhex(&t["aad"]),
            },
        )
        .unwrap();
    assert_eq!(sealed, [unhex(&t["ct"]), unhex(&t["tag"])].concat());
    assert!(unhex(&t["msg"]).starts_with(b"Ladies and Gentlemen of the class of '99"));
}

#[test]
fn wycheproof() {
    let all = cases();
    assert!(all.len() > 100);
    for t in all {
        let (key, iv, aad, msg) = (
            unhex(&t["key"]),
            unhex(&t["iv"]),
            unhex(&t["aad"]),
            unhex(&t["msg"]),
        );
        let sealed = [unhex(&t["ct"]), unhex(&t["tag"])].concat();
        let must = t["result"].as_str().unwrap();
        let (Ok(key), Ok(nonce)) = (
            <[u8; 32]>::try_from(key.as_slice()),
            <[u8; 24]>::try_from(iv.as_slice()),
        ) else {
            assert_eq!(
                must, "invalid",
                "tcId {}: a key or nonce the seal never makes",
                t["tcId"]
            );
            continue;
        };
        let cipher = XChaCha20Poly1305::new(&key.into());
        let opened = cipher.decrypt(
            &XNonce::from(nonce),
            Payload {
                msg: &sealed,
                aad: &aad,
            },
        );
        match must {
            "valid" => {
                assert_eq!(opened.as_deref(), Ok(msg.as_slice()), "tcId {}", t["tcId"]);
                let again = cipher
                    .encrypt(
                        &XNonce::from(nonce),
                        Payload {
                            msg: &msg,
                            aad: &aad,
                        },
                    )
                    .unwrap();
                assert_eq!(again, sealed, "tcId {}", t["tcId"]);
            }
            "invalid" => assert!(opened.is_err(), "tcId {}", t["tcId"]),
            _ => {}
        }
    }
}
