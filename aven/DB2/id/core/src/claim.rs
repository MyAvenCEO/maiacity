//! The statements a passkey signs (`Aven.ID.Claim`): a claim, which founds the claimant's vault, named after them, the
//! admin coop it owns and that owns the network, and adds the claiming browser, and a sign-in, which adds one more browser. The passkey signs a statement's text
//! through its challenge, so the text binds the network, every vault it names and every public half.
//!
//! As JSON, on the wire and in the store (bytes in hex, the client data as the browser wrote it):
//!
//! ```text
//! {"network":"aven","person":"person-…","name":"Ada","passkey":{"id":"passkey-…","spki":"3059…"},"device":{"id":"device-…","key":"…"},
//!  "assertion":{"clientData":"{\"type\":…}","authData":"49960de5…","signature":"3045…"}}
//! ```
//!
//! A sign-in is the same without `person` and `passkey`.

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::hex;
use crate::passkey::Assertion;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Claim {
    pub network: String,
    pub person: String,
    /// the name given at signup: 1 to 48 characters, no control characters
    pub name: String,
    pub passkey: String,
    /// SubjectPublicKeyInfo, hex
    pub passkey_key: String,
    pub device: String,
    /// Ed25519, hex: the browser's iroh key
    pub device_key: String,
    pub assertion: Assertion,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignIn {
    pub network: String,
    pub device: String,
    pub device_key: String,
    pub assertion: Assertion,
}

/// What a claim's passkey signs, through its challenge.
pub fn claim_text(
    network: &str,
    person: &str,
    name: &str,
    passkey: &str,
    spki: &str,
    device: &str,
    key: &str,
) -> String {
    format!(
        "avenID claim 2\nnetwork {network}\nperson {person}\nname {name}\npasskey {passkey} {spki}\ndevice {device} {key}\n"
    )
}

pub fn sign_in_text(network: &str, device: &str, key: &str) -> String {
    format!("avenID sign-in 1\nnetwork {network}\ndevice {device} {key}\n")
}

/// The id a browser's device goes by: the start of its key.
pub fn device_id(key: &str) -> String {
    format!("device-{}", &key[..key.len().min(16)])
}

/// The start of the SHA-256 of a passkey's public key, which names it and the person vault it owns.
fn spki_name(spki: &str) -> String {
    hex::encode(&Sha256::digest(hex::decode(spki).unwrap_or_default())[..8])
}

pub fn passkey_id(spki: &str) -> String {
    format!("passkey-{}", spki_name(spki))
}

pub fn person_id(spki: &str) -> String {
    format!("person-{}", spki_name(spki))
}

impl Claim {
    /// The vaults named after the claimant: their vault, and their browsers, the claiming one first (`n = 1`).
    pub fn vault_name(&self) -> String {
        format!("{}'s vault", self.name)
    }

    pub fn browser(&self, n: usize) -> String {
        if n == 1 {
            format!("{}'s browser", self.name)
        } else {
            format!("{}'s browser {n}", self.name)
        }
    }

    pub fn text(&self) -> String {
        claim_text(
            &self.network,
            &self.person,
            &self.name,
            &self.passkey,
            &self.passkey_key,
            &self.device,
            &self.device_key,
        )
    }

    pub fn to_json(&self) -> Value {
        json!({
            "network": self.network,
            "person": self.person,
            "name": self.name,
            "passkey": { "id": self.passkey, "spki": self.passkey_key },
            "device": { "id": self.device, "key": self.device_key },
            "assertion": assertion_json(&self.assertion),
        })
    }

    pub fn from_json(v: &Value) -> Result<Claim, String> {
        Ok(Claim {
            network: text(v, &["network"])?,
            person: text(v, &["person"])?,
            name: text(v, &["name"])?,
            passkey: text(v, &["passkey", "id"])?,
            passkey_key: text(v, &["passkey", "spki"])?,
            device: text(v, &["device", "id"])?,
            device_key: text(v, &["device", "key"])?,
            assertion: assertion(v)?,
        })
    }
}

impl SignIn {
    pub fn text(&self) -> String {
        sign_in_text(&self.network, &self.device, &self.device_key)
    }

    pub fn to_json(&self) -> Value {
        json!({
            "network": self.network,
            "device": { "id": self.device, "key": self.device_key },
            "assertion": assertion_json(&self.assertion),
        })
    }

    pub fn from_json(v: &Value) -> Result<SignIn, String> {
        Ok(SignIn {
            network: text(v, &["network"])?,
            device: text(v, &["device", "id"])?,
            device_key: text(v, &["device", "key"])?,
            assertion: assertion(v)?,
        })
    }
}

pub(crate) fn text(v: &Value, path: &[&str]) -> Result<String, String> {
    path.iter()
        .try_fold(v, |v, k| v.get(k))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("the statement has no {}", path.join(".")))
}

fn bytes(v: &Value, k: &str) -> Result<Vec<u8>, String> {
    hex::decode(&text(v, &["assertion", k])?).ok_or_else(|| format!("assertion.{k} is not hex"))
}

pub(crate) fn assertion(v: &Value) -> Result<Assertion, String> {
    Ok(Assertion {
        client_data: text(v, &["assertion", "clientData"])?.into_bytes(),
        authenticator_data: bytes(v, "authData")?,
        signature: bytes(v, "signature")?,
    })
}

pub(crate) fn assertion_json(a: &Assertion) -> Value {
    json!({
        "clientData": String::from_utf8_lossy(&a.client_data),
        "authData": hex::encode(&a.authenticator_data),
        "signature": hex::encode(&a.signature),
    })
}
