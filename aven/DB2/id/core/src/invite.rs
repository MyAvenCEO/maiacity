//! The statements of milestone 2's door (`Aven.ID.Invite`): an invite and its withdrawal, each the admin's act signed
//! by an admin's passkey as a claim is, and a join, signed by the invite's one-time key and by the joiner's new
//! passkey. Each passkey signs its statement's text through its challenge; the one-time key signs the join's text
//! itself with Ed25519.
//!
//! As JSON, on the wire and in the store (bytes in hex, the client data as the browser wrote it):
//!
//! ```text
//! invite:   {"network":"aven","invite":"<one-time key>","passkey":"passkey-…","assertion":{…}}
//! withdraw: {"network":"aven","invite":"<one-time key>","passkey":"passkey-…","assertion":{…}}
//! join:     {"network":"aven","invite":"<one-time key>","person":"person-…","name":"Bea","passkey":{"id":"passkey-…","spki":"3059…"},
//!            "device":{"id":"device-…","key":"…"},"signature":"<Ed25519, 128 hex>","assertion":{…}}
//! ```

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier};
use serde_json::{Value, json};

use crate::claim::{assertion, assertion_json, text};
use crate::hex;
use crate::keys::{parse_public, public_hex};
use crate::passkey::Assertion;

pub fn invite_text(network: &str, key: &str) -> String {
    format!("avenID invite 1\nnetwork {network}\ninvite {key}\n")
}

pub fn withdraw_text(network: &str, key: &str) -> String {
    format!("avenID withdraw 1\nnetwork {network}\ninvite {key}\n")
}

#[allow(clippy::too_many_arguments)]
pub fn join_text(
    network: &str,
    key: &str,
    person: &str,
    name: &str,
    passkey: &str,
    spki: &str,
    device: &str,
    device_key: &str,
) -> String {
    format!(
        "avenID join 1\nnetwork {network}\ninvite {key}\nperson {person}\nname {name}\npasskey {passkey} {spki}\ndevice {device} {device_key}\n"
    )
}

/// The id an invite goes by, which names its refs: the start of its one-time key.
pub fn invite_id(key: &str) -> String {
    format!("invite-{}", &key[..key.len().min(16)])
}

/// A one-time key's public half (hex), from its secret seed (hex): what an invite names, from what its link carries.
pub fn one_time_public(secret: &str) -> Option<String> {
    Some(public_hex(&one_time_key(secret)?.verifying_key()))
}

/// The one-time key's signature over a join's text, as the joining page makes it from the link's secret.
pub fn sign_join(secret: &str, text: &str) -> Option<String> {
    Some(hex::encode(
        &one_time_key(secret)?.sign(text.as_bytes()).to_bytes(),
    ))
}

fn one_time_key(secret: &str) -> Option<SigningKey> {
    let seed: [u8; 32] = hex::decode(secret.trim())?.try_into().ok()?;
    Some(SigningKey::from_bytes(&seed))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Invite {
    pub network: String,
    /// the one-time key's public half, Ed25519 in hex
    pub key: String,
    pub passkey: String,
    pub assertion: Assertion,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Withdrawal {
    pub network: String,
    pub key: String,
    pub passkey: String,
    pub assertion: Assertion,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Join {
    pub network: String,
    /// the invite's one-time key
    pub invite: String,
    pub person: String,
    /// the person's name, asked at signup
    pub name: String,
    pub passkey: String,
    /// SubjectPublicKeyInfo, hex
    pub passkey_key: String,
    pub device: String,
    /// Ed25519, hex: the browser's iroh key
    pub device_key: String,
    /// the one-time key's Ed25519 signature over the text
    pub signature: Vec<u8>,
    pub assertion: Assertion,
}

impl Invite {
    pub fn text(&self) -> String {
        invite_text(&self.network, &self.key)
    }

    pub fn to_json(&self) -> Value {
        act_json(&self.network, &self.key, &self.passkey, &self.assertion)
    }

    pub fn from_json(v: &Value) -> Result<Invite, String> {
        Ok(Invite {
            network: text(v, &["network"])?,
            key: text(v, &["invite"])?,
            passkey: text(v, &["passkey"])?,
            assertion: assertion(v)?,
        })
    }
}

impl Withdrawal {
    pub fn text(&self) -> String {
        withdraw_text(&self.network, &self.key)
    }

    pub fn to_json(&self) -> Value {
        act_json(&self.network, &self.key, &self.passkey, &self.assertion)
    }

    pub fn from_json(v: &Value) -> Result<Withdrawal, String> {
        let i = Invite::from_json(v)?;
        Ok(Withdrawal {
            network: i.network,
            key: i.key,
            passkey: i.passkey,
            assertion: i.assertion,
        })
    }
}

fn act_json(network: &str, key: &str, passkey: &str, a: &Assertion) -> Value {
    json!({ "network": network, "invite": key, "passkey": passkey, "assertion": assertion_json(a) })
}

impl Join {
    pub fn text(&self) -> String {
        join_text(
            &self.network,
            &self.invite,
            &self.person,
            &self.name,
            &self.passkey,
            &self.passkey_key,
            &self.device,
            &self.device_key,
        )
    }

    /// Whether the invite's one-time key signed exactly this join.
    pub fn signed_by_invite(&self) -> bool {
        let (Some(key), Ok(signature)) = (
            parse_public(&self.invite),
            Signature::from_slice(&self.signature),
        ) else {
            return false;
        };
        key.verify(self.text().as_bytes(), &signature).is_ok()
    }

    pub fn to_json(&self) -> Value {
        json!({
            "network": self.network,
            "invite": self.invite,
            "person": self.person,
            "name": self.name,
            "passkey": { "id": self.passkey, "spki": self.passkey_key },
            "device": { "id": self.device, "key": self.device_key },
            "signature": hex::encode(&self.signature),
            "assertion": assertion_json(&self.assertion),
        })
    }

    pub fn from_json(v: &Value) -> Result<Join, String> {
        let signature = text(v, &["signature"])?;
        Ok(Join {
            network: text(v, &["network"])?,
            invite: text(v, &["invite"])?,
            person: text(v, &["person"])?,
            name: text(v, &["name"])?,
            passkey: text(v, &["passkey", "id"])?,
            passkey_key: text(v, &["passkey", "spki"])?,
            device: text(v, &["device", "id"])?,
            device_key: text(v, &["device", "key"])?,
            signature: hex::decode(&signature).ok_or("signature is not hex")?,
            assertion: assertion(v)?,
        })
    }
}
