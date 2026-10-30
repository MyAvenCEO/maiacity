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
//!
//! Offline first (README rule 3): a peer that learns its members from statements keeps the network it was told in its
//! store (the ref `network`), and [`recall`] reads it back at start, every statement checked again, so a returning
//! browser knows its tree and opens before any link is up. A [`Wake`] (the page's `online` and `visibilitychange`)
//! makes a link that isn't live dial again at once rather than at its next try.

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

use crate::chats::{Chats, Shared};
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

/// What tells a link the device may be back: the network changed, or the page came back into view.
pub type Wake = futures_channel::mpsc::UnboundedReceiver<()>;

/// The ref under which a peer keeps the network it was told: whether it is claimed and, once the door admitted it,
/// every statement (the Aven Peer's `network` frame).
pub const NETWORK_REF: &str = "network";

/// Keeps what the Aven Peer told of its network in `store`, as the newest word: checked already by the caller.
pub async fn remember(
    store: &Shared,
    claimed: bool,
    statements: Option<&str>,
) -> Result<(), String> {
    let name = aven_db_store::RefName::new(NETWORK_REF).map_err(|e| e.to_string())?;
    let blob = serde_json::to_vec(&json!({ "claimed": claimed, "statements": statements }))
        .map_err(|e| e.to_string())?;
    let blob = store.put(blob.into()).await.map_err(|e| e.to_string())?;
    let mut expected = store.get_ref(&name).await.map_err(|e| e.to_string())?;
    for _ in 0..4 {
        if expected == Some(blob) {
            return Ok(());
        }
        match store.set_ref(&name, expected, blob).await {
            Ok(()) => return Ok(()),
            Err(aven_db_store::Error::Stale { current }) => expected = current,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("the ref network kept moving".into())
}

/// The members, and the tree they make, read back from statements as the Aven Peer told them: checked here, never
/// taken on its word. The tree only once the network is claimed.
pub fn checked(statements: &str) -> Result<(aven_id::Members, Option<String>), String> {
    let v = serde_json::from_str(statements).map_err(|e| e.to_string())?;
    let m = aven_id::Members::from_statements(&v)?;
    let tree = m
        .network()
        .claim()
        .and_then(|_| m.tree().ok())
        .map(|t| t.to_cast());
    Ok((m, tree))
}

/// The `network` line's fields for checked members: who the members are and the invites, beside `claimed` and `tree`.
fn told(m: &aven_id::Members, claimed: bool, tree: Option<String>) -> serde_json::Value {
    let invites: Vec<serde_json::Value> = m
        .invites()
        .iter()
        .map(
            |i| json!({ "id": aven_id::invite_id(&i.key), "key": i.key, "state": m.state(&i.key) }),
        )
        .collect();
    json!({ "claimed": claimed, "tree": tree, "members": m.members(), "invites": invites })
}

/// What the store kept of the network, read back at start before any link (offline first): each statement checked
/// again, the gate told its members, and a `network` line with `kept: true`, so the page opens on its tree at once and
/// a browser that isn't a device yet knows whether the network is claimed. Nothing kept, or nothing that still holds,
/// tells nothing. Whether it told the page a tree.
pub async fn recall(store: &Shared, me: &str, gate: &Gate, notes: &Notes) -> bool {
    let Ok(name) = aven_db_store::RefName::new(NETWORK_REF) else {
        return false;
    };
    let Some(kept) = (match store.get_ref(&name).await {
        Ok(Some(blob)) => store.get(&blob).await.ok().flatten(),
        _ => None,
    }) else {
        return false;
    };
    let Ok(kept) = serde_json::from_slice::<serde_json::Value>(&kept) else {
        return false;
    };
    let claimed = kept["claimed"].as_bool().unwrap_or(false);
    let mut fields = match kept["statements"].as_str().map(checked) {
        Some(Ok((m, tree))) => {
            gate.set_members(&m);
            told(&m, claimed, tree)
        }
        Some(Err(why)) => {
            notes(timeline::line(
                now(),
                me,
                "dropped",
                json!({ "why": format!("the kept network doesn't hold: {why}") }),
            ));
            json!({ "claimed": claimed, "tree": null })
        }
        None => json!({ "claimed": claimed, "tree": null }),
    };
    fields["kept"] = json!(true);
    let has_tree = !fields["tree"].is_null();
    notes(timeline::line(now(), me, "network", fields));
    has_tree
}

/// What a link waits for: bytes from the Aven Peer, or a frame to send it.
enum Next<R> {
    Read(R),
    Send(Option<Frame>),
    Woken,
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
    /// what wakes it to dial again at once
    wake: Option<Wake>,
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

    /// What the Aven Peer says of its network: the statements checked here before the gate believes them, and kept in
    /// the store, so the next start opens on them before any link (`recall`).
    async fn network(&self, claimed: bool, tree: Option<String>, statements: Option<String>) {
        let checked = statements.as_deref().map(|s| {
            serde_json::from_str(s)
                .map_err(|e| e.to_string())
                .and_then(|v| aven_id::Members::from_statements(&v))
        });
        let kept = checked.as_ref().map(|c| c.is_ok());
        match checked {
            Some(Ok(m)) => {
                if let Some(gate) = &self.gate {
                    gate.set_members(&m);
                }
                self.note("network", told(&m, claimed, tree));
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
        // what a peer that learns its members from statements was told and could check: kept, once the page has it
        let keep = match (&self.gate, &self.chats, &kept) {
            (Some(_), Some(chats), Some(true) | None) => Some(chats.store()),
            _ => None,
        };
        if let Some(store) = keep
            && let Err(why) = remember(&store, claimed, statements.as_deref()).await
        {
            self.note(
                "dropped",
                json!({ "why": format!("the network not kept: {why}") }),
            );
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
    wake: Option<Wake>,
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
        wake,
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
        // the next try after a step, or at once when woken
        sleep(TICK).or(woken(&mut link.wake)).await;
    }
}

/// Waits until the link is woken; never, without a wake. Wakes that came together count once.
async fn woken(wake: &mut Option<Wake>) {
    match wake.as_mut() {
        Some(w) => {
            // a wake whose sender is gone never wakes again
            if w.next().await.is_none() {
                std::future::pending::<()>().await;
            }
            while w.try_recv().is_ok() {}
        }
        None => std::future::pending().await,
    }
}

async fn follow(endpoint: &Endpoint, aven: &EndpointAddr, link: &mut Link) -> Result<(), String> {
    // every link catches up afresh: the Aven Peer may have restarted, or lost what it was sent
    (link.caught, link.uploaded, link.told_sent) = (false, 0, 0);
    link.there.clear();
    let dial = async {
        timeout(
            Duration::from_secs(10),
            endpoint.connect(aven.clone(), ALPN),
        )
        .await
        .map_err(|_| "no answer in 10 s".to_string())?
        .map_err(|e| e.to_string())
    };
    // woken while it dials: the network may have changed under the dial, so it starts over
    let wake = &mut link.wake;
    let conn = dial
        .or(async {
            woken(wake).await;
            Err("woken: dialing again".to_string())
        })
        .await?;
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
        let wake = &mut link.wake;
        let woken_next = async {
            woken(wake).await;
            Next::Woken
        };
        let got = timeout(
            next.saturating_duration_since(Instant::now()),
            read.or(send_next).or(woken_next),
        )
        .await;
        match got {
            // a live link carries on (iroh moves its paths itself); any other dials again at once
            Ok(Next::Woken) if link.view.status.phase == Phase::Live => continue,
            Ok(Next::Woken) => return Err("woken: dialing again".into()),
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
                    for page in chats.catch_up_frames(link.there.keys().cloned()) {
                        send.write_all(&encode(&page))
                            .await
                            .map_err(|e| e.to_string())?;
                    }
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
                        } => link.network(claimed, tree, statements).await,
                        Frame::Refused { why } => link.note("refused", json!({ "why": why })),
                        // catching up: told every head on each link, then whenever one moves there. It catches up
                        // when behind; its own lines the Aven Peer doesn't hold go on the next step (`upload`). The
                        // heads come in pages: the first telling is whole only at its last page (`more` false), and
                        // only then does this link catch up on all of it and learn its own head
                        Frame::Heads { heads, more } => {
                            if let Some(chats) = &link.chats {
                                for h in &heads {
                                    link.there.insert(h.device.clone(), h.seq);
                                }
                                let first = !link.caught;
                                if first && more {
                                    continue;
                                }
                                link.caught = true;
                                if first || chats.behind(&heads) {
                                    for page in chats.catch_up_frames(link.there.keys().cloned()) {
                                        send.write_all(&encode(&page))
                                            .await
                                            .map_err(|e| e.to_string())?;
                                    }
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
