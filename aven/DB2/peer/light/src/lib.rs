//! avenPEER's Peer-Light: the same core as wasm, in a browser's worker (SANDBOX.md, "The cast"). It is relay-only: it
//! reaches the Aven Peer through the relay it is given (in the box, the page's own origin, where Vite passes `/relay`
//! on). Like the Peer, it is configured, never built for a place: its name, its secret seed and the Aven Peer's key
//! come from the page. Every event goes to the page as a timeline line.

use std::sync::Arc;

use aven_db_core::timeline;
use aven_db_core::wire::ALPN;
use aven_peer::{Notes, keys, link, now};
use iroh::endpoint::presets;
use iroh::{Endpoint, EndpointAddr, RelayMap, RelayMode, RelayUrl};
use wasm_bindgen::prelude::*;

/// The page's callback for timeline lines. A browser's worker has one thread, so it is never shared across threads.
struct Page(js_sys::Function);
// SAFETY: wasm32-unknown-unknown without threads runs everything on the worker's one thread.
unsafe impl Send for Page {}
unsafe impl Sync for Page {}

fn js(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

/// Starts the Peer-Light `name` with its secret seed (hex), linking through `relay` to the Aven Peer (`aven_key`,
/// called `aven_name` in the timeline), and tells `notes` every event. Returns once the endpoint is bound; the link
/// runs on.
#[wasm_bindgen]
pub async fn start(
    name: String,
    secret: String,
    relay: String,
    aven_key: String,
    aven_name: String,
    notes: js_sys::Function,
) -> Result<(), JsError> {
    let page = Page(notes);
    let notes: Notes = Arc::new(move |line: String| {
        let _ = page.0.call1(&JsValue::NULL, &JsValue::from_str(&line));
    });
    let relay: RelayUrl = relay.parse().map_err(js)?;
    let endpoint = Endpoint::builder(presets::Minimal)
        .secret_key(keys::secret(&secret).map_err(js)?)
        .relay_mode(RelayMode::Custom(RelayMap::from(relay.clone())))
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await
        .map_err(js)?;
    notes(timeline::line(
        now(),
        &name,
        "started",
        serde_json::json!({ "key": endpoint.id().to_string(), "relay": relay.to_string() }),
    ));
    let aven = EndpointAddr::new(keys::public(&aven_key).map_err(js)?).with_relay_url(relay);
    wasm_bindgen_futures::spawn_local(link::run(endpoint, name, aven, aven_name, notes));
    Ok(())
}
