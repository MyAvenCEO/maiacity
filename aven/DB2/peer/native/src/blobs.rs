//! iroh-blobs' protocol on a peer's Router (store/README.md, "The layers": aven/PEER owns its networking, the store
//! its adapter). The provider is the door's second check (MILESTONE2.md, "the door is checked twice"): after every
//! connection's `after_handshake`, iroh-blobs asks once more whom it serves, and serves only the keys the door admits
//! now. Push, a remote writing into this peer's store, stays off.

use std::sync::Arc;

use aven_db_core::timeline;
use aven_db_store::blobs::{Blobs, Provider};
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
