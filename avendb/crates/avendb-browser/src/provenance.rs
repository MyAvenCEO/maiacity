//! Provenance in a page (H2 of maiaCITY's hardening plan, `avendb::provenance`): which code is Maia City's, proven by
//! the page that runs it, never taken on a server's word. avenDB's server hands out the signed edits that prove a
//! vault's public code (`/feed/proof`, one `wire::Reply`); the page's code loaders (game/code/sources/proof.js) hand
//! them here with the vault they are anchored to, by its id, and run nothing but the rows that come back. maiaCITY's
//! API loads this same WebAssembly and does the same.

use avendb::id::VaultId;
use avendb::provenance;
use wasm_bindgen::prelude::*;

/// The rows of the public code of kinds `kinds` (a comma-separated list: `view,logic,config`, `recipe`) of vault
/// `vault`, its id in 64 hex digits, that the proof `bytes` proves, as JSON text: an array of rows shaped as
/// `/feed/code` serves them, `seed` null in each (`avendb::provenance::verify`). A device of no vault, made for the
/// call, takes the edits as every device takes a sync reply, each signature checked and every rule replayed, and reads
/// back those of that vault alone. Throws why, for a vault that is no id, bytes that are no reply, or a reply that
/// proves no vault of that id.
#[wasm_bindgen(js_name = provenCode)]
pub fn proven_code(bytes: &[u8], vault: &str, kinds: &str) -> Result<String, JsError> {
    let vault = VaultId::from_hex(vault).ok_or_else(|| JsError::new("a vault is its id, 64 hex digits"))?;
    let kinds: Vec<&str> = kinds.split(',').filter(|k| !k.is_empty()).collect();
    let rows = provenance::verify(bytes, vault, &kinds).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(serde_json::to_string(&rows).expect("JSON writes"))
}
