//! Who this node lets in: the server peer and the other devices the admin paired — nobody else. The list comes from
//! the API (after the passkey approved this Mac) and can change while the node runs.

use std::{
    collections::HashSet,
    sync::{Arc, RwLock},
};

use iroh::{
    EndpointId,
    endpoint::{AfterHandshakeOutcome, Connection, EndpointHooks},
};

#[derive(Debug, Clone, Default)]
pub struct Allow(Arc<RwLock<Option<HashSet<EndpointId>>>>);

impl Allow {
    /// Until the node has joined, it talks to nobody (None); after, to exactly these.
    pub fn set(&self, ids: impl IntoIterator<Item = EndpointId>) {
        *self.0.write().unwrap() = Some(ids.into_iter().collect());
    }
    pub fn has(&self, id: &EndpointId) -> bool {
        self.0.read().unwrap().as_ref().is_some_and(|s| s.contains(id))
    }
}

impl EndpointHooks for Allow {
    async fn after_handshake(&self, conn: &Connection) -> AfterHandshakeOutcome {
        if self.has(&conn.remote_id()) {
            AfterHandshakeOutcome::Accept
        } else {
            AfterHandshakeOutcome::Reject { error_code: 403u32.into(), reason: b"not paired".to_vec() }
        }
    }
}
