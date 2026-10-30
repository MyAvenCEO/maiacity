//! Presence as the Aven Peer counts it (`aven_db_core::presence`): every peer that says hello on `aven/db/1` joins,
//! each of its connections counted, and every connected peer is told who is there, itself included, on every change.
//! The Aven Peer beats once per clock step on every link, so a quiet link still moves.

use std::sync::{Arc, Mutex};

use aven_db_core::presence::Presence;
use aven_db_core::status::TICK_MS;
use aven_db_core::timeline;
use aven_db_core::wire::{Decoder, Frame, encode};
use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use serde_json::json;
use tokio::sync::watch;
use tokio::time::{Duration, interval};

use crate::keys::Members;
use crate::{Notes, link, now};

#[derive(Clone)]
pub struct Hub {
    me: String,
    members: Members,
    presence: Arc<Mutex<Presence<String>>>,
    told: watch::Sender<Vec<String>>,
    notes: Notes,
}

impl std::fmt::Debug for Hub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Hub").field("me", &self.me).finish()
    }
}

fn fail(what: impl std::fmt::Display) -> AcceptError {
    std::io::Error::other(what.to_string()).into()
}

impl Hub {
    /// The Aven Peer's hub; it is present itself from the start. With members, it admits only them, each by its name.
    pub fn new(me: String, members: Members, notes: Notes) -> Self {
        let mut presence = Presence::default();
        presence.join(me.clone());
        let (told, _) = watch::channel(presence.present().cloned().collect());
        let hub = Hub {
            me,
            members,
            presence: Arc::new(Mutex::new(presence)),
            told,
            notes,
        };
        hub.tell();
        hub
    }

    fn note(&self, event: &str, fields: serde_json::Value) {
        (self.notes)(timeline::line(now(), &self.me, event, fields));
    }

    fn change(&self, join: bool, peer: &str) {
        let present: Vec<String> = {
            let mut presence = self.presence.lock().unwrap();
            if join {
                presence.join(peer.to_string())
            } else {
                presence.leave(&peer.to_string())
            }
            presence.present().cloned().collect()
        };
        self.told.send_if_modified(|told| {
            let changed = *told != present;
            *told = present;
            changed
        });
        self.tell();
    }

    /// The Aven Peer's own status line: live, and how many are connected.
    fn tell(&self) {
        let present = self.told.borrow().clone();
        self.note(
            "status",
            json!({ "phase": "live", "peers": present.len(), "present": present, "path": null }),
        );
    }

    async fn serve(&self, conn: &Connection, peer: &str) -> Result<(), AcceptError> {
        let (mut send, mut recv) = conn.accept_bi().await?;
        let mut decoder = Decoder::default();
        let mut buf = vec![0u8; 16 * 1024];
        // the first frame is a hello
        let said = loop {
            let n = recv
                .read(&mut buf)
                .await
                .map_err(fail)?
                .ok_or_else(|| fail("closed before hello"))?;
            if let Some(frame) = decoder
                .push(&buf[..n])
                .map_err(|e| fail(format!("{e:?}")))?
                .into_iter()
                .next()
            {
                break frame;
            }
        };
        // the first frame names the peer; a member must name itself
        let named = matches!(&said, Frame::Hello { peer: name } if name == peer);
        if !named && (self.members.knows(&conn.remote_id()) || !matches!(said, Frame::Hello { .. })) {
            return Err(fail(format!("{peer} said {said:?}")));
        }
        send.write_all(&encode(&Frame::Hello {
            peer: self.me.clone(),
        }))
        .await
        .map_err(fail)?;
        let mut told = self.told.subscribe();
        told.mark_changed();
        let mut beat = interval(Duration::from_millis(TICK_MS));
        let mut n = 0;
        loop {
            tokio::select! {
                _ = told.changed() => {
                    let peers = told.borrow_and_update().clone();
                    send.write_all(&encode(&Frame::Presence { peers })).await.map_err(fail)?;
                }
                _ = beat.tick() => {
                    n += 1;
                    send.write_all(&encode(&Frame::Beat { n })).await.map_err(fail)?;
                }
                read = recv.read(&mut buf) => match read.map_err(fail)? {
                    Some(m) => { decoder.push(&buf[..m]).map_err(|e| fail(format!("{e:?}")))?; }
                    None => return Ok(()),
                },
                _ = conn.closed() => return Ok(()),
            }
        }
    }
}

impl ProtocolHandler for Hub {
    async fn accept(&self, conn: Connection) -> Result<(), AcceptError> {
        let key = conn.remote_id();
        // the members-only door (invites, the relay's allow-list) is milestone 2's; members given, only they get in
        if !self.members.is_empty() && !self.members.knows(&key) {
            self.note("refused", json!({ "key": key.to_string() }));
            return Err(fail("not a member"));
        }
        let peer = self.members.name(&key);
        self.change(true, &peer);
        self.note("joined", json!({ "from": peer, "path": link::path(&conn) }));
        let served = self.serve(&conn, &peer).await;
        self.change(false, &peer);
        self.note(
            "left",
            json!({ "from": peer, "why": served.as_ref().err().map(|e| e.to_string()) }),
        );
        served
    }
}
