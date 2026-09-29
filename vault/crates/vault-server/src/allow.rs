//! Who may connect: only the devices the admin paired with the passkey (vault_devices), and the server itself.
//! One list, read from Postgres, enforced in two places — the server's iroh endpoint (after the TLS handshake, when
//! the remote EndpointId is proven) and the relay (before a client may use it at all).

use std::{
    collections::HashSet,
    sync::{Arc, RwLock},
};

use iroh::{
    EndpointId,
    endpoint::{AfterHandshakeOutcome, Connection, EndpointHooks},
};
use iroh_relay::server::{Access, AccessControl, ClientRequest};

#[derive(Debug, Clone, Default)]
pub struct Allow(Arc<RwLock<HashSet<EndpointId>>>);

impl Allow {
    pub fn set(&self, ids: impl IntoIterator<Item = EndpointId>) {
        *self.0.write().unwrap() = ids.into_iter().collect();
    }
    pub fn has(&self, id: &EndpointId) -> bool {
        self.0.read().unwrap().contains(id)
    }
    pub fn all(&self) -> Vec<EndpointId> {
        self.0.read().unwrap().iter().copied().collect()
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

impl AccessControl for Allow {
    async fn on_connect(&self, request: &ClientRequest) -> Access {
        if self.has(&request.endpoint_id()) {
            Access::Allow
        } else {
            Access::Deny { reason: Some("not paired".into()) }
        }
    }
}
