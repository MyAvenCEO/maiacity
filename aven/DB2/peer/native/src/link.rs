//! The link: a peer's one connection to the Aven Peer on `aven/db/1`, and the status it is in. It dials, says hello,
//! and reads frames; every frame is progress, every clock step without one counts against it
//! (`aven_db_core::status`). A link that stays stalled, or is lost, dials again. What it learns goes out as timeline
//! lines whenever the phase, the presence or the path changes, so a page is pushed deltas (README, rule 8). A Peer-Light
//! also hands it frames to send, its statements (`Outbox`), and hears back from an Aven Peer that keeps its tree whether
//! the network is claimed and, once the door admits it, the tree and every statement, which it checks itself
//! (`aven_id::Members::from_statements`) before it believes who the members are (`network` lines, and the `Gate`); or
//! why a statement was refused (`refused`). The Aven Peer's address is resolved again before every dial, so a Peer
//! follows it when it moves (30 Oct 2026: Alice Peer kept a stale address after the Aven Peer's container restarted).

use aven_db_core::status::{Event, Phase, STALL_AFTER, Status, TICK_MS};
use aven_db_core::timeline;
use aven_db_core::wire::{ALPN, Decoder, Frame, encode};
use iroh::endpoint::Connection;
use iroh::{Endpoint, EndpointAddr};
use n0_future::time::{Duration, Instant, sleep, timeout};
use n0_future::{FutureExt, StreamExt};
use serde_json::json;

use std::sync::Arc;

use n0_future::boxed::BoxFuture;

use crate::members::Gate;
use crate::{Notes, now};

/// Where the Aven Peer is now: resolved again before every dial.
pub type Resolve = Arc<dyn Fn() -> BoxFuture<Result<EndpointAddr, String>> + Send + Sync>;

/// An address that never moves: the Peer-Light's, which reaches the Aven Peer by its key through the relay.
pub fn fixed(addr: EndpointAddr) -> Resolve {
    Arc::new(move || {
        let addr = addr.clone();
        Box::pin(async move { Ok(addr) })
    })
}

const TICK: Duration = Duration::from_millis(TICK_MS);
/// A stalled link waits this many more steps for progress, then dials again.
const REDIAL_AFTER: u32 = 2 * STALL_AFTER;

/// The frames a page hands the link to send to the Aven Peer.
pub type Outbox = futures_channel::mpsc::UnboundedReceiver<Frame>;

/// What a link waits for: bytes from the Aven Peer, or a frame to send it.
enum Next<R> {
    Read(R),
    Send(Option<Frame>),
}

/// What a link shows: its status, the peers the Aven Peer says are connected, and the path it is on.
#[derive(Clone, Debug, PartialEq)]
pub struct View {
    pub status: Status,
    pub peers: Vec<String>,
    pub path: Option<&'static str>,
}

struct Link {
    me: String,
    /// the Aven Peer's name, for the timeline
    aven: String,
    notes: Notes,
    view: View,
    told: Option<View>,
    outbox: Option<Outbox>,
    /// the door as the statements say, for a link to an Aven Peer that keeps its tree
    gate: Option<Gate>,
}

impl Link {
    fn step(&mut self, event: Event) {
        self.view.status = self.view.status.step(STALL_AFTER, event);
        if matches!(event, Event::Lost | Event::Dial) {
            self.view.path = None;
            if event == Event::Lost {
                self.view.peers.clear();
            }
        }
    }

    /// What the Aven Peer says of its network: the statements checked here before the gate believes them.
    fn network(&self, claimed: bool, tree: Option<String>, statements: Option<String>) {
        let checked = statements.map(|s| {
            serde_json::from_str(&s)
                .map_err(|e| e.to_string())
                .and_then(|v| aven_id::Members::from_statements(&v))
        });
        match checked {
            Some(Ok(m)) => {
                if let Some(gate) = &self.gate {
                    gate.set_members(&m);
                }
                let invites: Vec<serde_json::Value> = m
                    .invites()
                    .iter()
                    .map(|i| json!({ "id": aven_id::invite_id(&i.key), "key": i.key, "state": m.state(&i.key) }))
                    .collect();
                self.note(
                    "network",
                    json!({ "claimed": claimed, "tree": tree, "members": m.members(), "invites": invites }),
                );
            }
            Some(Err(why)) => {
                self.note("network", json!({ "claimed": claimed, "tree": null }));
                self.note(
                    "refused",
                    json!({ "why": format!("the network's statements don't hold: {why}") }),
                );
            }
            None => self.note("network", json!({ "claimed": claimed, "tree": tree })),
        }
    }

    fn note(&self, event: &str, fields: serde_json::Value) {
        (self.notes)(timeline::line(now(), &self.me, event, fields));
    }

    /// Tells the timeline when what the link shows has changed, and only then.
    fn tell(&mut self) {
        let shown = |v: &View| (v.status.phase, v.peers.clone(), v.path);
        if self.told.as_ref().map(shown) == Some(shown(&self.view)) {
            return;
        }
        let v = &self.view;
        self.note(
            "status",
            json!({ "phase": v.status.phase.name(), "peers": v.peers.len(), "present": v.peers, "path": v.path, "moved": v.status.moved }),
        );
        self.told = Some(self.view.clone());
    }
}

/// The path a connection sends on now: `direct` over UDP, or through the `relay`.
pub fn path(conn: &Connection) -> Option<&'static str> {
    conn.paths()
        .iter()
        .find(|p| p.is_selected())
        .map(|p| if p.is_ip() { "direct" } else { "relay" })
}

/// Runs the link for ever: dial, follow, and dial again. `aven_name` is what the timeline calls the Aven Peer; the
/// outbox, if any, holds the frames to send it; the gate, if any, learns the members from the statements it is told.
pub async fn run(
    endpoint: Endpoint,
    me: String,
    aven: Resolve,
    aven_name: String,
    notes: Notes,
    outbox: Option<Outbox>,
    gate: Option<Gate>,
) {
    let mut link = Link {
        me,
        aven: aven_name,
        notes,
        view: View {
            status: Status::start(),
            peers: vec![],
            path: None,
        },
        told: None,
        outbox,
        gate,
    };
    link.tell();
    // until its endpoint closes: a Peer-Light rebinds with a newcomer's relay token
    while !endpoint.is_closed() {
        link.step(Event::Dial);
        link.tell();
        let why = match aven().await {
            Ok(addr) => follow(&endpoint, &addr, &mut link)
                .await
                .err()
                .unwrap_or_default(),
            Err(why) => format!("the Aven Peer's address: {why}"),
        };
        link.step(Event::Lost);
        link.tell();
        link.note("lost", json!({ "to": link.aven, "why": why }));
        sleep(TICK).await;
    }
}

async fn follow(endpoint: &Endpoint, aven: &EndpointAddr, link: &mut Link) -> Result<(), String> {
    let conn = timeout(
        Duration::from_secs(10),
        endpoint.connect(aven.clone(), ALPN),
    )
    .await
    .map_err(|_| "no answer in 10 s".to_string())?
    .map_err(|e| e.to_string())?;
    let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
    send.write_all(&encode(&Frame::Hello {
        peer: link.me.clone(),
    }))
    .await
    .map_err(|e| e.to_string())?;
    link.view.path = path(&conn);
    link.note(
        "connected",
        json!({ "to": link.aven, "path": link.view.path }),
    );
    let mut decoder = Decoder::default();
    let mut buf = vec![0u8; 16 * 1024];
    let mut next = Instant::now() + TICK;
    loop {
        let read = async { Next::Read(recv.read(&mut buf).await) };
        let outbox = &mut link.outbox;
        let send_next = async {
            match outbox.as_mut() {
                Some(outbox) => Next::Send(outbox.next().await),
                None => std::future::pending().await,
            }
        };
        let got = timeout(
            next.saturating_duration_since(Instant::now()),
            read.or(send_next),
        )
        .await;
        match got {
            Ok(Next::Send(Some(frame))) => {
                send.write_all(&encode(&frame))
                    .await
                    .map_err(|e| e.to_string())?;
                continue;
            }
            Ok(Next::Send(None)) => {
                link.outbox = None;
                continue;
            }
            Err(_) => {
                next += TICK;
                link.step(Event::Tick);
                if link.view.status.phase == Phase::Stalled && link.view.status.idle >= REDIAL_AFTER
                {
                    link.tell();
                    return Err(format!("no progress in {} steps", link.view.status.idle));
                }
            }
            Ok(Next::Read(Ok(Some(n)))) => {
                for frame in decoder.push(&buf[..n]).map_err(|e| format!("{e:?}"))? {
                    link.step(Event::Frame);
                    match frame {
                        Frame::Presence { peers } => link.view.peers = peers,
                        Frame::Network {
                            claimed,
                            tree,
                            statements,
                        } => link.network(claimed, tree, statements),
                        Frame::Refused { why } => link.note("refused", json!({ "why": why })),
                        _ => {}
                    }
                }
            }
            Ok(Next::Read(Ok(None))) => return Err("the Aven Peer closed the stream".into()),
            Ok(Next::Read(Err(e))) => return Err(e.to_string()),
        }
        let now_on = path(&conn);
        if now_on != link.view.path {
            link.view.path = now_on;
            link.note("path", json!({ "to": link.aven, "path": now_on }));
        }
        link.tell();
    }
}
