//! Statements a device signs for the vault it serves. One verifies only with that device's key and only for that
//! vault; whether it may act on a given vault is `may_act_on`'s to decide.

use std::fmt;

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier};

use crate::keys::{parse_public, public_hex};
use crate::tree::Tree;

const DOMAIN: &[u8] = b"avenID statement 1\0";

/// `device` says `body`, signed for `vault`, the vault it serves.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Statement {
    pub device: String,
    pub vault: String,
    pub body: Vec<u8>,
    pub signature: [u8; 64],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SignError {
    /// Not a device of this tree.
    NotDevice(String),
    /// The device has no key in the tree, or its public half isn't an Ed25519 key.
    NoKey(String),
    /// The signing key is not the device's own.
    WrongKey(String),
    /// Signed for a vault the device does not serve.
    WrongVault { device: String, vault: String },
    /// The signature does not verify with the device's key.
    BadSignature,
}

impl fmt::Display for SignError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SignError::NotDevice(id) => write!(f, "{id} is not a device"),
            SignError::NoKey(id) => write!(f, "{id} has no Ed25519 key"),
            SignError::WrongKey(id) => write!(f, "that key is not {id}'s"),
            SignError::WrongVault { device, vault } => write!(f, "{device} does not serve {vault}"),
            SignError::BadSignature => write!(f, "the signature does not verify"),
        }
    }
}

impl std::error::Error for SignError {}

/// The bytes signed: a domain, then the device, the vault, each with its length, then the body.
fn message(device: &str, vault: &str, body: &[u8]) -> Vec<u8> {
    let mut out = DOMAIN.to_vec();
    for part in [device.as_bytes(), vault.as_bytes()] {
        out.extend_from_slice(&(part.len() as u32).to_be_bytes());
        out.extend_from_slice(part);
    }
    out.extend_from_slice(body);
    out
}

impl Tree {
    fn serves(&self, device: &str) -> Result<&str, SignError> {
        self.acts_for(device)
            .ok_or_else(|| SignError::NotDevice(device.to_string()))
    }

    /// `device` signs `body` for the vault it serves, with its own key.
    pub fn sign(
        &self,
        device: &str,
        key: &SigningKey,
        body: &[u8],
    ) -> Result<Statement, SignError> {
        let vault = self.serves(device)?;
        if self.key(device) != Some(public_hex(&key.verifying_key()).as_str()) {
            return Err(SignError::WrongKey(device.to_string()));
        }
        let signature = key.sign(&message(device, vault, body)).to_bytes();
        Ok(Statement {
            device: device.to_string(),
            vault: vault.to_string(),
            body: body.to_vec(),
            signature,
        })
    }

    /// A statement holds when its device serves its vault and its device's key signed it.
    pub fn verify(&self, statement: &Statement) -> Result<(), SignError> {
        let Statement {
            device,
            vault,
            body,
            signature,
        } = statement;
        if self.serves(device)? != vault {
            return Err(SignError::WrongVault {
                device: device.clone(),
                vault: vault.clone(),
            });
        }
        let public = self
            .key(device)
            .and_then(parse_public)
            .ok_or_else(|| SignError::NoKey(device.clone()))?;
        public
            .verify(
                &message(device, vault, body),
                &Signature::from_bytes(signature),
            )
            .map_err(|_| SignError::BadSignature)
    }

    /// A statement acts on `target` when it holds and its device may act on `target`.
    pub fn acts_on(&self, statement: &Statement, target: &str) -> Result<bool, SignError> {
        self.verify(statement)?;
        Ok(self.may_act_on(&statement.device, target))
    }
}
