//! Who this node lets in: the server peer and the other devices the admin paired — nobody else. The list comes from
//! the API (after the passkey approved this Mac) and can change while the node runs.

use std::{
    collections::HashSet,
    sync::{Arc, Mutex, RwLock},
};

use iroh::{
    EndpointId,
    endpoint::{AfterHandshakeOutcome, Connection, EndpointHooks, WeakConnectionHandle},
};

#[derive(Debug, Clone, Default)]
pub struct Allow {
    ids: Arc<RwLock<Option<HashSet<EndpointId>>>>,
    /// the blob connections peers opened — weak, as iroh's hooks ask: to read how each one moves (`links`)
    blobs: Arc<Mutex<Vec<WeakConnectionHandle>>>,
}

impl Allow {
    /// Until the node has joined, it talks to nobody (None); after, to exactly these.
    pub fn set(&self, ids: impl IntoIterator<Item = EndpointId>) {
        *self.ids.write().unwrap() = Some(ids.into_iter().collect());
    }
    /// Let one more in (a drive's node beside this Mac's), keeping the rest.
    pub fn add(&self, id: EndpointId) {
        self.ids.write().unwrap().get_or_insert_with(HashSet::new).insert(id);
    }
    pub fn has(&self, id: &EndpointId) -> bool {
        self.ids.read().unwrap().as_ref().is_some_and(|s| s.contains(id))
    }

    /// How each open blob connection moves, as iroh's QUIC sees its selected path: who, direct or relayed, the round
    /// trip, the congestion window, congestion events and losses, bytes sent. What limits an upload, told plainly.
    pub fn links(&self) -> Vec<String> {
        let mut blobs = self.blobs.lock().unwrap();
        blobs.retain(|w| w.upgrade().is_some());
        blobs
            .iter()
            .filter_map(|w| w.upgrade())
            .filter_map(|c| {
                let paths = c.paths();
                let p = paths.iter().find(|p| p.is_selected())?;
                let s = p.stats();
                Some(format!(
                    "{} · {} · rtt {} ms · cwnd {} KB · {} congestion events · {} lost packets ({} KB) · {} MB sent",
                    c.remote_id().fmt_short(),
                    if p.is_relay() { "relayed" } else { "direct" },
                    s.rtt.as_millis(),
                    s.cwnd / 1024,
                    s.congestion_events,
                    s.lost_packets,
                    s.lost_bytes / 1024,
                    s.udp_tx.bytes / 1_000_000,
                ))
            })
            .collect()
    }
}

impl EndpointHooks for Allow {
    async fn after_handshake(&self, conn: &Connection) -> AfterHandshakeOutcome {
        if self.has(&conn.remote_id()) {
            if conn.alpn() == iroh_blobs::ALPN {
                self.blobs.lock().unwrap().push(conn.weak_handle());
            }
            AfterHandshakeOutcome::Accept
        } else {
            AfterHandshakeOutcome::Reject { error_code: 403u32.into(), reason: b"not paired".to_vec() }
        }
    }
}
