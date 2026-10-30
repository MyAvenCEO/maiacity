//! avenPEER's Peer-Light: the same core as wasm, in a browser's worker (SANDBOX.md, "The cast"). It is relay-only: it
//! reaches the Aven Peer through the relay it is given (in the box, the page's own origin, where Vite passes `/relay`
//! on). Like the Peer, it is configured, never built for a place: its name, its secret seed and the Aven Peer's key
//! come from the page. It keeps its data through avenDB's store, in its origin's OPFS. Every event goes to the page as a
//! timeline line. On an Aven Peer's host without a cast (PRODUCTION.md, Part A) the page makes its secret itself and
//! keeps it in OPFS, and the Peer-Light is named by its key (`device-…`); the page's claim and sign-in go to the Aven
//! Peer through `send`.

use std::cell::RefCell;
use std::sync::Arc;

use aven_db_core::timeline;
use aven_db_core::wire::{ALPN, Frame};
use aven_db_store::backend;
use aven_peer::{Notes, keys, link, now, record};
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

thread_local! {
    /// Where `send` puts the page's frames for the link.
    static OUTBOX: RefCell<Option<futures_channel::mpsc::UnboundedSender<Frame>>> = const { RefCell::new(None) };
}

/// Sends the page's claim or sign-in (a frame as JSON) to the Aven Peer, once the link is up. Only those two.
#[wasm_bindgen]
pub fn send(frame: String) -> Result<(), JsError> {
    let frame: Frame = serde_json::from_str(&frame).map_err(js)?;
    if !matches!(frame, Frame::Claim { .. } | Frame::SignIn { .. }) {
        return Err(JsError::new("a page sends only a claim or a sign-in"));
    }
    OUTBOX.with(|outbox| match outbox.borrow().as_ref() {
        Some(outbox) => outbox.unbounded_send(frame).map_err(js),
        None => Err(JsError::new("the Peer-Light has not started")),
    })
}

/// Starts the Peer-Light `name` with its secret seed (hex), linking through `relay` to the Aven Peer (`aven_key`,
/// called `aven_name` in the timeline), and tells `notes` every event. Without a name it goes by its key's device id.
/// Returns once the endpoint is bound; the link runs on.
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
    let name = if name.is_empty() {
        aven_id::device_id(&endpoint.id().to_string())
    } else {
        name
    };
    notes(timeline::line(
        now(),
        &name,
        "started",
        serde_json::json!({ "key": endpoint.id().to_string(), "relay": relay.to_string() }),
    ));
    // the one record it keeps, in this origin's OPFS: its first start, found again after a reload
    #[cfg(target_arch = "wasm32")]
    let (store, kind) = (backend::opfs("/store/").map_err(js)?, "opfs");
    // the crate also builds natively, for the workspace's tests; there it has no OPFS
    #[cfg(not(target_arch = "wasm32"))]
    let (store, kind) = (backend::memory().map_err(js)?, "memory");
    let kept = record::first_start(&store, &name, now())
        .await
        .map_err(js)?;
    notes(record::line(now(), &name, kind, &kept));
    let aven = EndpointAddr::new(keys::public(&aven_key).map_err(js)?).with_relay_url(relay);
    let (outbox, frames) = futures_channel::mpsc::unbounded();
    OUTBOX.with(|o| *o.borrow_mut() = Some(outbox));
    wasm_bindgen_futures::spawn_local(link::run(
        endpoint,
        name,
        aven,
        aven_name,
        notes,
        Some(frames),
    ));
    Ok(())
}
