//! aven-id's queries for avenOS (`os/web/id.js`): `new Cast(json)` reads the cast's tree and refuses
//! one that is not well formed; its methods answer as the Rust API does, ids in the tree's order.

use wasm_bindgen::prelude::*;

use crate::claim;
use crate::invite;
use crate::passkey;
use crate::tree::Tree;

/// The challenge a passkey signs for a statement's text.
#[wasm_bindgen]
pub fn challenge(text: &str) -> String {
    passkey::challenge(text)
}

/// What a claim's passkey signs.
#[wasm_bindgen(js_name = claimText)]
pub fn claim_text(
    network: &str,
    person: &str,
    name: &str,
    passkey: &str,
    spki: &str,
    device: &str,
    key: &str,
) -> String {
    claim::claim_text(network, person, name, passkey, spki, device, key)
}

/// Whether a name given at signup is one: 1 to 48 characters, no control characters.
#[wasm_bindgen(js_name = validPersonName)]
pub fn valid_person_name(name: &str) -> bool {
    crate::tree::valid_person_name(name)
}

/// What a sign-in's passkey signs.
#[wasm_bindgen(js_name = signInText)]
pub fn sign_in_text(network: &str, device: &str, key: &str) -> String {
    claim::sign_in_text(network, device, key)
}

/// The ids a browser and a passkey go by, from their public keys.
#[wasm_bindgen(js_name = deviceId)]
pub fn device_id(key: &str) -> String {
    claim::device_id(key)
}

#[wasm_bindgen(js_name = passkeyId)]
pub fn passkey_id(spki: &str) -> String {
    claim::passkey_id(spki)
}

#[wasm_bindgen(js_name = personId)]
pub fn person_id(spki: &str) -> String {
    claim::person_id(spki)
}

/// What an invite's and a withdrawal's passkey sign: the admin's acts on the invite with one-time key `key`.
#[wasm_bindgen(js_name = inviteText)]
pub fn invite_text(network: &str, key: &str) -> String {
    invite::invite_text(network, key)
}

#[wasm_bindgen(js_name = withdrawText)]
pub fn withdraw_text(network: &str, key: &str) -> String {
    invite::withdraw_text(network, key)
}

/// What a join's passkey and the invite's one-time key sign.
#[wasm_bindgen(js_name = joinText)]
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
    invite::join_text(
        network, key, person, name, passkey, spki, device, device_key,
    )
}

#[wasm_bindgen(js_name = inviteId)]
pub fn invite_id(key: &str) -> String {
    invite::invite_id(key)
}

/// A one-time key's public half from the secret an invite's link carries (both hex).
#[wasm_bindgen(js_name = oneTimePublic)]
pub fn one_time_public(secret: &str) -> Result<String, JsError> {
    invite::one_time_public(secret)
        .ok_or_else(|| JsError::new("a one-time secret is 64 hex digits"))
}

/// The one-time key's signature over a join's text (hex), made from the link's secret.
#[wasm_bindgen(js_name = signJoin)]
pub fn sign_join(secret: &str, text: &str) -> Result<String, JsError> {
    invite::sign_join(secret, text)
        .ok_or_else(|| JsError::new("a one-time secret is 64 hex digits"))
}

#[wasm_bindgen]
pub struct Cast(Tree);

fn strings(ids: Vec<&str>) -> Vec<String> {
    ids.into_iter().map(str::to_string).collect()
}

#[wasm_bindgen]
impl Cast {
    #[wasm_bindgen(constructor)]
    pub fn new(json: &str) -> Result<Cast, JsError> {
        Tree::from_cast(json)
            .map(Cast)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// Every vault's id, in the tree's order.
    pub fn vaults(&self) -> Vec<String> {
        self.0.vaults().iter().map(|v| v.id.clone()).collect()
    }

    pub fn name(&self, id: &str) -> Option<String> {
        self.0.vault(id).map(|v| v.name.clone())
    }

    /// `person`, `network`, `coop` or `device`.
    pub fn kind(&self, id: &str) -> Option<String> {
        self.0.kind(id).map(|k| k.as_str().to_string())
    }

    /// A vault's owners as the cast writes them: `key:<id>` or `vault:<id>`.
    pub fn owners(&self, id: &str) -> Vec<String> {
        self.0.vault(id).map_or_else(Vec::new, |v| {
            v.owners.iter().map(ToString::to_string).collect()
        })
    }

    /// The public half of a key: Ed25519 in hex, a passkey's `es256:<SPKI>`.
    pub fn key(&self, id: &str) -> Option<String> {
        self.0.key(id).map(str::to_string)
    }

    pub fn owned(&self, id: &str) -> Vec<String> {
        strings(self.0.owned(id))
    }

    pub fn governs(&self, id: &str) -> Vec<String> {
        strings(self.0.governs(id))
    }

    pub fn chain(&self, id: &str) -> Vec<String> {
        strings(self.0.chain(id))
    }

    #[wasm_bindgen(js_name = actsFor)]
    pub fn acts_for(&self, device: &str) -> Option<String> {
        self.0.acts_for(device).map(str::to_string)
    }

    #[wasm_bindgen(js_name = actsThrough)]
    pub fn acts_through(&self, id: &str) -> Vec<String> {
        strings(self.0.acts_through(id))
    }

    /// Whom a device may act as; without a device, whom the box may.
    pub fn accounts(&self, device: Option<String>) -> Vec<String> {
        strings(self.0.accounts(device.as_deref()))
    }

    pub fn sees(&self, id: &str) -> Vec<String> {
        strings(self.0.sees(id))
    }

    #[wasm_bindgen(js_name = mayActOn)]
    pub fn may_act_on(&self, device: &str, vault: &str) -> bool {
        self.0.may_act_on(device, vault)
    }
}
