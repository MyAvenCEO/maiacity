//! The runtime host in a browser (README, "The browser host"): the same host as native, wasmi compiled to wasm32, in
//! avenOS's runtimes worker, a worker of its own (os/web/runtimes/host.js). A page asks for a runtime by name; the
//! manifest, compiled in, names its newest frozen hash; the worker fetches that hash's bytes from avenOS's origin
//! (`/runtimes/frozen/<hex>.wasm`), and the host loads them only when the manifest lists the hash and the bytes are
//! the hash's, admits them, and runs them under the limits the manifest froze with them. Values cross as their one
//! JSON form (`Aven.Core.Json`).

#![forbid(unsafe_code)]

use std::cell::RefCell;
use std::collections::HashMap;

use aven_core::{Hash, Value};
use aven_runtimes_contract::{Failure, result};
use aven_runtimes_host::json::{of_json, to_json};
use aven_runtimes_host::{Entry, Frozen, Loaded, latest, load, manifest, run};
use wasm_bindgen::prelude::*;

const MANIFEST: &str = include_str!("../../manifest.json");

thread_local! {
    static ENTRIES: Vec<Entry> = manifest(MANIFEST).expect("manifest.json reads as a manifest");
    static LOADED: RefCell<HashMap<String, (Frozen, Loaded)>> = RefCell::new(HashMap::new());
}

/// The newest frozen hash of the runtime named `name` that the manifest still lists, `b3:<hex>`, or none.
#[wasm_bindgen]
pub fn runtime_hash(name: &str) -> Option<String> {
    ENTRIES.with(|m| latest(m, name)).map(|f| f.hash.text())
}

/// Whether the module of `hash` is loaded here.
#[wasm_bindgen]
pub fn runtime_loaded(hash: &str) -> bool {
    LOADED.with(|l| l.borrow().contains_key(hash))
}

/// Loads the module of `hash` from `bytes`: only when the manifest lists the hash, the bytes are the hash's, and the
/// module is admitted. Otherwise refused, and nothing is kept.
#[wasm_bindgen]
pub fn runtime_load(hash: &str, bytes: &[u8]) -> Result<(), JsError> {
    let want = Hash::parse(hash).ok_or_else(|| JsError::new("not a hash"))?;
    let (entry, loaded) = ENTRIES
        .with(|m| {
            let entry = m.iter().find_map(|e| match e {
                Entry::Frozen(f) if f.hash == want => Some(f.clone()),
                _ => None,
            });
            load(m, &want, bytes).map(|l| (entry, l))
        })
        .map_err(|e| JsError::new(&format!("{hash}: {e:?}")))?;
    let entry = entry.ok_or_else(|| JsError::new("not frozen"))?;
    LOADED.with(|l| l.borrow_mut().insert(hash.to_string(), (entry, loaded)));
    Ok(())
}

/// Runs the loaded module of `hash` on a part and an input, each a Value in its JSON form, under the limits the
/// manifest froze with it: its result, `{"ok": output}` or `{"failure": name}`, in the same form. An input that isn't
/// a Value's JSON form is `badInput`.
#[wasm_bindgen]
pub fn runtime_run(hash: &str, part: &str, input: &str) -> Result<String, JsError> {
    let value = |s: &str| -> Option<Value> { of_json(&serde_json::from_str(s).ok()?) };
    let answer = LOADED.with(|l| {
        let l = l.borrow();
        let (entry, m) = l
            .get(hash)
            .ok_or_else(|| JsError::new(&format!("{hash} isn't loaded")))?;
        Ok::<_, JsError>(match (value(part), value(input)) {
            (Some(p), Some(i)) => run(m, entry.limits, &p, &i),
            _ => Err(Failure::BadInput),
        })
    })?;
    let out = to_json(&result(&answer)).unwrap_or_else(|| {
        to_json(&result(&Err(Failure::BadOutput))).expect("a failure has a JSON form")
    });
    Ok(out.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The manifest compiled in reads, and names each runtime avenOS draws with.
    #[test]
    fn manifest_compiled_in() {
        for name in ["face-runtime", "markdown-runtime"] {
            assert!(
                runtime_hash(name).is_some_and(|h| Hash::parse(&h).is_some()),
                "{name}"
            );
        }
        assert_eq!(runtime_hash("no-runtime"), None);
    }
}
