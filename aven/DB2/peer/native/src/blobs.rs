//! iroh-blobs' protocol on a peer's Router (store/README.md, "The layers": aven/PEER owns its networking, the store
//! its adapter). The provider is the door's second check (MILESTONE2.md, "the door is checked twice"): after every
//! connection's `after_handshake`, iroh-blobs asks once more whom it serves, and serves only the keys the door admits
//! now. Push, a remote writing into this peer's store, stays off.

use std::sync::Arc;

use aven_db_core::timeline;
use aven_db_store::blobs::{Blobs, FetchError, Provider};
use serde_json::json;

use crate::members::Gate;
use crate::{Notes, now};

pub use aven_db_store::blobs::ALPN;

/// `/iroh-bytes/4` for this peer's Router: its blobs, to members only.
pub fn provider(blobs: &Blobs, me: String, gate: Gate, notes: Notes) -> Provider {
    blobs.provider(Arc::new(move |key| {
        let ok = gate.admits(key);
        if !ok {
            let line = json!({ "key": key.to_string(), "alpn": "/iroh-bytes/4", "by": "blobs" });
            notes(timeline::line(now(), &me, "kept-out", line));
        }
        ok
    }))
}

/// A fetch over a connection kept from before, `cached`, and when it fails but for [`FetchError::NotFound`], once more
/// over a `fresh` one: a kept connection can be dead unseen (its holder's worker ended, or a takeover rebound its
/// endpoint) and still read as open. The result, and the connection to keep: the one that answered, or none.
pub async fn once_more<C: Clone, T, E: std::fmt::Display>(
    cached: Option<C>,
    fresh: impl AsyncFn() -> Result<C, E>,
    fetch: impl AsyncFn(C) -> Result<T, FetchError>,
) -> (Result<T, FetchError>, Option<C>) {
    if let Some(conn) = cached {
        match fetch(conn.clone()).await {
            Err(FetchError::Failed(_)) => {}
            answered => return (answered, Some(conn)),
        }
    }
    match fresh().await {
        Ok(conn) => {
            let result = fetch(conn.clone()).await;
            let keep = (!matches!(result, Err(FetchError::Failed(_)))).then_some(conn);
            (result, keep)
        }
        Err(e) => (Err(FetchError::Failed(format!("no connection: {e}"))), None),
    }
}
