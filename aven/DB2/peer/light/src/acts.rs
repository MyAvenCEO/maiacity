//! What a page needs for a person's acts, as aven-id computes them (PRODUCTION.md, Parts A and C; MILESTONE2.md): the
//! texts a passkey signs and their challenges, the ids a browser, a passkey and a person go by, and an invite's one-time
//! key. The page runs the WebAuthn ceremony, which a worker can't, and asks the Peer-Light's worker for these
//! (`os/web/id.svelte.js`); the statement then goes back through `send`. They moved here from aven-id's own wasm,
//! which is gone: the Peer-Light is the page's one WebAssembly module.

use wasm_bindgen::prelude::*;

use aven_id as id;

/// The challenge a passkey signs for a statement's text.
#[wasm_bindgen]
pub fn challenge(text: &str) -> String {
    id::challenge(text)
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
    id::claim_text(network, person, name, passkey, spki, device, key)
}

/// Whether a name given at signup is one: 1 to 48 characters, no control characters.
#[wasm_bindgen(js_name = validPersonName)]
pub fn valid_person_name(name: &str) -> bool {
    id::valid_person_name(name)
}

/// What a sign-in's passkey signs.
#[wasm_bindgen(js_name = signInText)]
pub fn sign_in_text(network: &str, device: &str, key: &str) -> String {
    id::sign_in_text(network, device, key)
}

/// The ids a browser and a passkey go by, from their public keys.
#[wasm_bindgen(js_name = deviceId)]
pub fn device_id(key: &str) -> String {
    id::device_id(key)
}

#[wasm_bindgen(js_name = passkeyId)]
pub fn passkey_id(spki: &str) -> String {
    id::passkey_id(spki)
}

#[wasm_bindgen(js_name = personId)]
pub fn person_id(spki: &str) -> String {
    id::person_id(spki)
}

/// What an invite's and a withdrawal's passkey sign: the admin's acts on the invite with one-time key `key`.
#[wasm_bindgen(js_name = inviteText)]
pub fn invite_text(network: &str, key: &str) -> String {
    id::invite_text(network, key)
}

#[wasm_bindgen(js_name = withdrawText)]
pub fn withdraw_text(network: &str, key: &str) -> String {
    id::withdraw_text(network, key)
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
    id::join_text(
        network, key, person, name, passkey, spki, device, device_key,
    )
}

#[wasm_bindgen(js_name = inviteId)]
pub fn invite_id(key: &str) -> String {
    id::invite_id(key)
}

/// A one-time key's public half from the secret an invite's link carries (both hex).
#[wasm_bindgen(js_name = oneTimePublic)]
pub fn one_time_public(secret: &str) -> Result<String, JsError> {
    id::one_time_public(secret).ok_or_else(|| JsError::new("a one-time secret is 64 hex digits"))
}

/// The one-time key's signature over a join's text (hex), made from the link's secret.
#[wasm_bindgen(js_name = signJoin)]
pub fn sign_join(secret: &str, text: &str) -> Result<String, JsError> {
    id::sign_join(secret, text).ok_or_else(|| JsError::new("a one-time secret is 64 hex digits"))
}

/// The PRF step's input for an owner at an epoch (`Aven.ID.KeyFormats.prfInput`), hex, for the page's WebAuthn
/// `prf.eval.first`. The browser hashes it into the authenticator's salt itself.
#[wasm_bindgen(js_name = prfInput)]
pub fn prf_input(epoch: u32) -> String {
    hex(&id::prf_input(epoch.into()))
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// What a PRF output derives: the owner key and the seal key, and their public halves (the owner key's Value's bytes,
/// and X-Wing's), hex. `output` is wiped before this returns, whatever it returns.
pub struct Derived {
    pub owner: String,
    pub seal: String,
    pub owner_key: id::HybridKey,
    pub seal_key: id::SealKey,
}

pub fn prf_derive(output: &mut [u8]) -> Result<Derived, String> {
    use zeroize::Zeroize;
    let taken = <&mut [u8; 32]>::try_from(&mut *output).map(id::Secret::take);
    output.zeroize();
    let prf = id::PrfOutput::new(taken.map_err(|_| "a PRF output is 32 bytes".to_string())?);
    let (owner_key, seal_key) = (prf.owner_key(), prf.seal_key());
    Ok(Derived {
        owner: hex(&owner_key.public().to_bytes()),
        seal: hex(&seal_key.public().to_bytes()),
        owner_key,
        seal_key,
    })
}
