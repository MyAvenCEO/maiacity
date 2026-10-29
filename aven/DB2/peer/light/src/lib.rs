//! avenPEER's Peer-Light: the same core as wasm, in a browser's worker (SANDBOX.md, "The cast"). It is relay-only: it
//! reaches the Aven Peer through the Aven Peer's relay, at the page's own origin, where Vite passes `/relay` on to it.
//! Its key is its device key from the cast. Every event goes to the page as a timeline line.

use std::sync::Arc;

use aven_db_core::timeline;
use aven_db_core::wire::ALPN;
use aven_peer::{Notes, cast, link, now};
use iroh::endpoint::presets;
use iroh::{Endpoint, EndpointAddr, RelayMap, RelayMode, RelayUrl};
use wasm_bindgen::prelude::*;

/// The page's callback for timeline lines. A browser's worker has one thread, so it is never shared across threads.
struct Page(js_sys::Function);
// SAFETY: wasm32-unknown-unknown without threads runs everything on the worker's one thread.
unsafe impl Send for Page {}
unsafe impl Sync for Page {}

/// Starts the Peer-Light `me` (a Peer-Light of the cast) on the relay at `relay` (the page's origin), telling `notes`
/// every event. Returns once the endpoint is bound; the link runs on.
#[wasm_bindgen]
pub async fn start(me: String, relay: String, notes: js_sys::Function) -> Result<(), JsError> {
    if !cast::peers().contains(&me) {
        return Err(JsError::new(&format!("{me} is not a peer of the cast")));
    }
    let page = Page(notes);
    let notes: Notes = Arc::new(move |line: String| {
        let _ = page.0.call1(&JsValue::NULL, &JsValue::from_str(&line));
    });
    let relay: RelayUrl = relay.parse().map_err(|e| JsError::new(&format!("{e}")))?;
    let secret = cast::secret(&me);
    if Some(secret.public()) != cast::public(&me) {
        return Err(JsError::new(&format!("{me}'s key is not the cast's")));
    }
    let endpoint = Endpoint::builder(presets::Minimal)
        .secret_key(secret)
        .relay_mode(RelayMode::Custom(RelayMap::from(relay.clone())))
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await
        .map_err(|e| JsError::new(&e.to_string()))?;
    notes(timeline::line(now(), &me, "started", serde_json::json!({ "key": endpoint.id().to_string(), "relay": relay.to_string() })));
    let aven_key = cast::public(cast::AVEN_PEER).ok_or_else(|| JsError::new("the cast has no Aven Peer"))?;
    let aven = EndpointAddr::new(aven_key).with_relay_url(relay);
    wasm_bindgen_futures::spawn_local(link::run(endpoint, me, aven, notes));
    Ok(())
}
