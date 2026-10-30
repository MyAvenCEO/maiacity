//! The link: a peer's one connection to the Aven Peer on `aven/db/1`, and the status it is in. It dials, says hello,
//! and reads frames; every frame is progress, every clock step without one counts against it
//! (`aven_db_core::status`). A link that stays stalled, or is lost, dials again. What it learns goes out as timeline
//! lines whenever the phase, the presence or the path changes, so a page is pushed deltas (README, rule 8). A Peer-Light
//! also hands it frames to send, its statements (`Outbox`), and hears back from an Aven Peer that keeps its tree whether
//! the network is claimed and, once the door admits it, the tree and every statement, which it checks itself
//! (`aven_id::Members::from_statements`) before it believes who the members are (`network` lines, and the `Gate`); or
//! why a statement was refused (`refused`). Once linked, its chats catch up from the Aven Peer's chains (`heads`,
//! `catch_up`, `lines`), and send it the lines this device wrote offline. The Aven Peer's address is resolved again before every dial, so a Peer
//! follows it when it moves (30 Oct 2026: Alice Peer kept a stale address after the Aven Peer's container restarted).

use aven_db_core::status::{Event, Phase, STALL_AFTER, Status, TICK_MS};
use aven_db_core::timeline;
use aven_db_core::wire::{ALPN, Decoder, Frame, Head, encode};
use iroh::endpoint::Connection;
use iroh::{Endpoint, EndpointAddr};
use n0_future::time::{Duration, Instant, sleep, timeout};
use n0_future::{FutureExt, StreamExt};
use serde_json::json;

use std::collections::BTreeMap;
use std::sync::Arc;

use n0_future::boxed::BoxFuture;

use crate::chats::Chats;
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

/// The Aven Peer's address once it resolves, asked again every 250 ms, with one `waiting` line while it doesn't. A Peer
/// waits for it before it joins the room: iroh-gossip 0.101 never dials again a bootstrap its first join couldn't
/// reach, and a Peer that starts beside the Aven Peer (the box's `up`, a restart of both) may look it up before its
/// name exists. Its room then stayed alone for good (30 Oct 2026).
pub async fn resolved(aven: &Resolve, me: &str, notes: &Notes) -> EndpointAddr {
    let mut told = false;
    loop {
        match aven().await {
            Ok(addr) => return addr,
            Err(why) if !told => {
                told = true;
                notes(timeline::line(
                    now(),
                    me,
                    "waiting",
                    json!({ "for": "aven", "why": why }),
                ));
            }
            Err(_) => {}
        }
        sleep(Duration::from_millis(250)).await;
    }
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
    /// the chat's chains, which catch up from the Aven Peer's on every link
    chats: Option<Chats>,
    /// whether this link caught up once, on the Aven Peer's first `heads`
    caught: bool,
    /// how far the Aven Peer holds each chain, as its `heads` said
    there: BTreeMap<String, u64>,
    /// the newest line of its own this link sent the Aven Peer
    uploaded: u64,
    /// how many of its own lines it told the page the Aven Peer holds
    told_sent: usize,
}

/// This device's own lines the Aven Peer doesn't hold, written offline or lost on gossip, sent once each on the link:
/// it checks each as one heard on gossip, and its `heads` then say they arrived (`sent`).
async fn upload(link: &mut Link, send: &mut iroh::endpoint::SendStream) -> Result<(), String> {
    let Some(chats) = &link.chats else {
        return Ok(());
    };
    let me = chats.device();
    let (mine, there) = (chats.have(&me), link.there.get(&me).copied().unwrap_or(0));
    if !link.caught || mine <= there.max(link.uploaded) {
        return Ok(());
    }
    let from = Head {
        device: me,
        id: String::new(),
        seq: there.max(link.uploaded),
    };
    for frame in chats.unsent(&[from]).await {
        send.write_all(&encode(&frame))
            .await
            .map_err(|e| e.to_string())?;
    }
    link.uploaded = mine;
    Ok(())
}

impl Link {
    /// Once the Aven Peer's heads name this device's head and it holds it, it knows its own head: what it queued is
    /// chained, and goes out with its other unsent lines (`upload`).
    async fn learn(&mut self) {
        let Some(chats) = &self.chats else { return };
        let me = chats.device();
        if !chats.learned()
            && self.caught
            && chats.have(&me) >= self.there.get(&me).copied().unwrap_or(0)
        {
            chats.learn().await;
        }
    }

    /// Tells the page which of this device's own lines the Aven Peer holds, as its heads have said, when that grew.
    fn sent(&mut self) {
        let Some(chats) = &self.chats else { return };
        let me = chats.device();
        let there = Head {
            seq: self.there.get(&me).copied().unwrap_or(0),
            device: me,
            id: String::new(),
        };
        let sent = chats.sent(&[there]);
        if sent.len() > self.told_sent {
            self.told_sent = sent.len();
            self.note("sent", json!({ "ids": sent }));
        }
    }

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
#[allow(clippy::too_many_arguments)]
pub async fn run(
    endpoint: Endpoint,
    me: String,
    aven: Resolve,
    aven_name: String,
    notes: Notes,
    outbox: Option<Outbox>,
    gate: Option<Gate>,
    chats: Option<Chats>,
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
        chats,
        caught: false,
        there: BTreeMap::new(),
        uploaded: 0,
        told_sent: 0,
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
    // every link catches up afresh: the Aven Peer may have restarted, or lost what it was sent
    (link.caught, link.uploaded, link.told_sent) = (false, 0, 0);
    link.there.clear();
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
                // a gap still open after its wait: catch up for the lines before it
                if let Some(chats) = &link.chats
                    && chats.due(now())
                {
                    send.write_all(&encode(&chats.catch_up_frame(&[])))
                        .await
                        .map_err(|e| e.to_string())?;
                }
                upload(link, &mut send).await?;
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
                        // catching up: what it holds of each chain, and its own lines written offline
                        // catching up: told every head on each link, then whenever one moves there. It catches up
                        // when behind; its own lines the Aven Peer doesn't hold go on the next step (`upload`)
                        Frame::Heads { heads } => {
                            if let Some(chats) = &link.chats {
                                let first = !link.caught;
                                link.caught = true;
                                for h in &heads {
                                    link.there.insert(h.device.clone(), h.seq);
                                }
                                if first || chats.behind(&heads) {
                                    send.write_all(&encode(&chats.catch_up_frame(&heads)))
                                        .await
                                        .map_err(|e| e.to_string())?;
                                }
                                link.learn().await;
                                upload(link, &mut send).await?;
                                link.sent();
                            }
                        }
                        Frame::Lines { lines } => {
                            if let Some(chats) = &link.chats {
                                for line in lines {
                                    chats.take(line.as_bytes()).await;
                                }
                                link.learn().await;
                                upload(link, &mut send).await?;
                                link.sent();
                            }
                        }
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
