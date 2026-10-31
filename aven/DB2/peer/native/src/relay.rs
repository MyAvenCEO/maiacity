//! The Aven Peer's relay admits only the door's keys (MILESTONE2.md, "the door is checked twice"): the members' devices,
//! the Aven Peer and the devices of the admin's people. Where the Aven Peer keeps its tree, two more: anyone while the
//! network is unclaimed, so the first signup reaches it; and a newcomer whose relay token is a statement the network
//! would take from it now (a sign-in by the passkey of a person whose vault the tree holds, the admin's or a member's,
//! a join with an open invite: `aven_id::Members::newcomer`). No secret travels in the token, and the relay's handshake
//! proves the key it is for. A statement it refuses is refused with its reason, which the browser shows: it is about
//! the browser's own statement ("This passkey isn't a member of Maia City. Ask the admin for an invite."). The hook then lets that
//! newcomer bring its statement on `aven/db/1`, and nothing else.

use std::sync::Arc;

use aven_db_core::timeline;
use aven_db_core::wire::Frame;
use iroh_relay::server::{Access, AccessControl, ClientRequest};
use serde_json::json;

use crate::door::{Door, Statement};
use crate::members::Gate;
use crate::{Notes, now};

pub struct Allow {
    pub me: String,
    pub gate: Gate,
    pub door: Option<Arc<Door>>,
    pub notes: Notes,
}

impl std::fmt::Debug for Allow {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Allow").field("me", &self.me).finish()
    }
}

/// A newcomer's token: its statement's frame, as `crate::token` writes it.
fn read(token: &str) -> Option<Statement> {
    let bytes: Option<Vec<u8>> = (0..token.len() / 2)
        .map(|i| {
            token
                .get(2 * i..2 * i + 2)
                .and_then(|b| u8::from_str_radix(b, 16).ok())
        })
        .collect();
    let frame = Frame::of_value(&aven_core::decode(&bytes?)?)?;
    Statement::of(&frame)?.ok()
}

impl AccessControl for Allow {
    async fn on_connect(&self, request: &ClientRequest) -> Access {
        let key = request.endpoint_id();
        if self.gate.admits(&key) {
            return Access::Allow;
        }
        let mut why = "not a member".to_string();
        let mut told = None;
        if let Some(door) = &self.door {
            let m = door.members();
            if m.network().claim().is_none() {
                return Access::Allow;
            }
            let token = request.auth_token();
            let pending = token.as_deref().and_then(read).and_then(|s| s.pending());
            match (&token, pending) {
                (None, _) => {}
                (Some(_), None) => why = "a token that is no claim, sign-in or join".into(),
                (Some(_), Some(p)) => match m.take(&key.to_string(), p) {
                    Ok(_) => {
                        self.gate.expect(key);
                        return Access::Allow;
                    }
                    Err(e) => {
                        why = m.say(&e);
                        told = Some(why.clone());
                    }
                },
            }
        }
        let line = json!({ "key": key.to_string(), "by": "relay", "why": why });
        (self.notes)(timeline::line(now(), &self.me, "kept-out", line));
        Access::Deny {
            reason: Some(told.unwrap_or_else(|| "not a member".into())),
        }
    }
}
