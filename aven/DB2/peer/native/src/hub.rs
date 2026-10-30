//! Presence as the Aven Peer counts it (`aven_db_core::presence`): every peer that says hello on `aven/db/1` joins,
//! each of its connections counted, and every connected peer is told who is there, itself included, on every change.
//! The Aven Peer beats once per clock step on every link, so a quiet link still moves. An Aven Peer that keeps its tree
//! (`door`) also tells every link whether its network is claimed and, to the devices its door admits, its tree and
//! every statement, on every change; it takes claims, sign-ins, invites, withdrawals and joins on the same stream, and
//! answers a refused one with why. With the chat's chains (`chats`), it tells each link the heads of every chain it
//! keeps, answers a `catch_up` with the lines the peer misses, and keeps the lines a peer sends it (written offline),
//! passing on gossip each it chains. Who may connect at all is the hook's (`members`), not the hub's.

use std::sync::{Arc, Mutex, OnceLock};

use aven_db_core::presence::Presence;
use aven_db_core::status::TICK_MS;
use aven_db_core::timeline;
use aven_db_core::wire::{Decoder, Frame, encode};
use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use serde_json::json;
use tokio::sync::watch;
use tokio::time::{Duration, interval};

use aven_db_core::chain::Answer;

use crate::chats::Chats;
use crate::door::{Door, Statement};
use crate::room::Room;
use crate::keys::Members;
use crate::{Notes, link, now};

#[derive(Clone)]
pub struct Hub {
    me: String,
    members: Members,
    presence: Arc<Mutex<Presence<String>>>,
    told: watch::Sender<Vec<String>>,
    notes: Notes,
    door: Option<Arc<Door>>,
    chats: Option<Chats>,
    /// the room, once joined: lines a peer sends here go on to gossip
    room: Arc<OnceLock<Room>>,
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
    pub fn new(me: String, members: Members, notes: Notes, door: Option<Arc<Door>>) -> Self {
        let mut presence = Presence::default();
        presence.join(me.clone());
        let (told, _) = watch::channel(presence.present().cloned().collect());
        let hub = Hub {
            me,
            members,
            presence: Arc::new(Mutex::new(presence)),
            told,
            notes,
            door,
            chats: None,
            room: Arc::new(OnceLock::new()),
        };
        hub.tell();
        hub
    }

    /// The hub with the chat's chains: lines sent here go on through the room, once it is set.
    pub fn with_chats(mut self, chats: Chats, room: Arc<OnceLock<Room>>) -> Self {
        self.chats = Some(chats);
        self.room = room;
        self
    }

    /// What it answers a frame about the chains with: the lines a `catch_up` misses; a peer's lines are kept and
    /// passed on. `None` for any other frame.
    async fn chat(&self, frame: &Frame) -> Option<Vec<Frame>> {
        let chats = self.chats.as_ref()?;
        match frame {
            Frame::CatchUp { holds } => Some(chats.answer(holds).await),
            Frame::Lines { lines } => {
                for line in lines {
                    if let Answer::Moved(_) = chats.take(line.as_bytes()).await
                        && let Some(room) = self.room.get()
                    {
                        room.gossip_line(line.as_bytes()).await;
                    }
                }
                Some(vec![])
            }
            _ => None,
        }
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
        // the first frame is a hello; what came with it, a newcomer's statement, is taken once it is answered
        let (said, early) = loop {
            let n = recv
                .read(&mut buf)
                .await
                .map_err(fail)?
                .ok_or_else(|| fail("closed before hello"))?;
            let mut frames = decoder
                .push(&buf[..n])
                .map_err(|e| fail(format!("{e:?}")))?;
            if !frames.is_empty() {
                let first = frames.remove(0);
                break (first, frames);
            }
        };
        // the first frame names the peer; a member must name itself
        let named = matches!(&said, Frame::Hello { peer: name } if name == peer);
        if !named && (self.members.knows(&conn.remote_id()) || !matches!(said, Frame::Hello { .. }))
        {
            return Err(fail(format!("{peer} said {said:?}")));
        }
        send.write_all(&encode(&Frame::Hello {
            peer: self.me.clone(),
        }))
        .await
        .map_err(fail)?;
        if let Some(chats) = &self.chats {
            send.write_all(&encode(&chats.heads_frame()))
                .await
                .map_err(fail)?;
        }
        let mut told = self.told.subscribe();
        told.mark_changed();
        let mut beat = interval(Duration::from_millis(TICK_MS));
        let mut n = 0;
        let key = conn.remote_id().to_string();
        let mut network = self.door.as_ref().map(|door| {
            let mut network = door.subscribe();
            network.mark_changed();
            network
        });
        for frame in early {
            if let Some(why) = self.take(&key, frame).await {
                send.write_all(&encode(&Frame::Refused { why }))
                    .await
                    .map_err(fail)?;
            }
        }
        loop {
            tokio::select! {
                _ = told.changed() => {
                    let peers = told.borrow_and_update().clone();
                    send.write_all(&encode(&Frame::Presence { peers })).await.map_err(fail)?;
                }
                Some(Ok(())) = async {
                    match network.as_mut() {
                        Some(network) => Some(network.changed().await),
                        None => std::future::pending().await,
                    }
                } => {
                    let frame = Door::frame(&network.as_mut().unwrap().borrow_and_update(), &key);
                    send.write_all(&encode(&frame)).await.map_err(fail)?;
                }
                _ = beat.tick() => {
                    n += 1;
                    send.write_all(&encode(&Frame::Beat { n })).await.map_err(fail)?;
                }
                read = recv.read(&mut buf) => match read.map_err(fail)? {
                    Some(m) => {
                        for frame in decoder.push(&buf[..m]).map_err(|e| fail(format!("{e:?}")))? {
                            if let Some(answer) = self.chat(&frame).await {
                                for frame in answer {
                                    send.write_all(&encode(&frame)).await.map_err(fail)?;
                                }
                                continue;
                            }
                            if let Some(why) = self.take(&key, frame).await {
                                send.write_all(&encode(&Frame::Refused { why })).await.map_err(fail)?;
                            }
                        }
                    }
                    None => return Ok(()),
                },
                _ = conn.closed() => return Ok(()),
            }
        }
    }
}

impl Hub {
    /// A statement from the peer whose key is `key`, and why it was refused; any other frame is no news.
    async fn take(&self, key: &str, frame: Frame) -> Option<String> {
        let statement = Statement::of(&frame)?;
        match &self.door {
            Some(door) => door.take(key, statement).await.err(),
            None => Some("this peer keeps no tree".to_string()),
        }
    }
}

impl ProtocolHandler for Hub {
    async fn accept(&self, conn: Connection) -> Result<(), AcceptError> {
        let key = conn.remote_id();
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
