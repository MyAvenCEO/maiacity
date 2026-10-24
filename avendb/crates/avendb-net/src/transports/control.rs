//! Authenticated, connection-bound negotiation of optional packet carriers (M5).
//! No forwarded advertisements: every capability and RTC signal travels inside an existing PQ sync session.
use super::{Carrier, PacketTransport, RouteId};
use crate::{Peer, Shared, session};
use anyhow::{Context as _, Result, bail, ensure};
use iroh::{EndpointAddr, EndpointId, TransportAddr};
use n0_future::{
    future, task,
    time::{self, Duration, Instant},
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;

pub(crate) const KIND: u8 = 15;
pub(crate) const LIMIT: usize = 32 << 10;
const SIGNAL_LIMIT: usize = 16 << 10;
const SESSIONS: usize = 16;
const RETRY: Duration = Duration::from_secs(30);
const WAIT: Duration = Duration::from_secs(10);
const OPEN_WAIT: Duration = Duration::from_secs(25);

#[cfg(test)]
#[path = "control_selection_tests.rs"]
mod selection_tests;

#[derive(Clone, Copy, Debug, Default)]
struct Caps {
    wt: bool,
    rtc: bool,
    listener: bool,
}
impl Caps {
    fn from_json(v: &Value) -> Result<Self> {
        Ok(Self {
            wt: v["wt"].as_bool().context("WT capability")?,
            rtc: v["rtc"].as_bool().context("RTC capability")?,
            listener: v["listener"].as_bool().context("listener capability")?,
        })
    }
    fn json(self) -> Value {
        json!({"wt":self.wt,"rtc":self.rtc,"listener":self.listener})
    }
}
#[derive(Debug)]
struct Negotiation {
    on: usize,
    mine: [u8; 16],
    theirs: Option<[u8; 16]>,
    spent: bool,
    wire_epoch: Option<[u8; 16]>,
    attempting: bool,
    at: Instant,
    route: Option<RouteId>,
}
#[derive(Clone, Debug)]
struct Binding {
    peer: EndpointId,
    on: usize,
    wire_epoch: [u8; 16],
    sent: u64,
    received: u64,
    since: Instant,
    ready: bool,
}
#[derive(Default)]
struct State {
    caps: Caps,
    closed: bool,
    sessions: BTreeMap<EndpointId, Negotiation>,
    routes: BTreeMap<RouteId, Binding>,
    probes: BTreeMap<RouteId, task::JoinHandle<()>>,
    cursor: Option<EndpointId>,
}
pub(crate) struct Control {
    packets: PacketTransport,
    state: Mutex<State>,
    pub(crate) changed: Notify,
    #[cfg(not(target_arch = "wasm32"))]
    native: Mutex<Option<Arc<super::webtransport::NativeWt>>>,
    tasks: Mutex<Vec<task::JoinHandle<()>>>,
    ending: tokio::sync::Mutex<()>,
    #[cfg(not(target_arch = "wasm32"))]
    starting: std::sync::atomic::AtomicBool,
}
fn room(state: &mut State) -> bool {
    if state.sessions.len() < SESSIONS {
        return true;
    }
    let oldest = state
        .sessions
        .iter()
        .filter(|(_, n)| n.route.is_none() && !n.attempting)
        .min_by_key(|(_, n)| n.at)
        .map(|(id, _)| *id);
    if let Some(id) = oldest {
        state.sessions.remove(&id);
        true
    } else {
        false
    }
}
fn nonce() -> Result<[u8; 16]> {
    let mut out = [0; 16];
    getrandom::fill(&mut out).map_err(anyhow::Error::msg)?;
    Ok(out)
}
fn hex(value: &[u8]) -> String {
    data_encoding::HEXLOWER.encode(value)
}
fn read_nonce(value: &Value) -> Result<[u8; 16]> {
    let text = value.as_str().context("transport nonce")?;
    ensure!(
        text.len() == 32 && text.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "transport nonce"
    );
    Ok(data_encoding::HEXLOWER.decode(text.as_bytes())?.try_into().map_err(|_| anyhow::anyhow!("transport nonce"))?)
}
fn epoch(exporter: &[u8; 32], initiator: EndpointId, responder: EndpointId, a: &[u8; 16], b: &[u8; 16]) -> [u8; 16] {
    let mut bytes = b"avendb packet route v1\0".to_vec();
    bytes.extend_from_slice(exporter);
    bytes.extend_from_slice(initiator.as_bytes());
    bytes.extend_from_slice(responder.as_bytes());
    bytes.extend_from_slice(a);
    bytes.extend_from_slice(b);
    iroh_blobs::Hash::new(&bytes).as_bytes()[..16].try_into().expect("hash prefix")
}
fn encode(value: Value) -> Result<Vec<u8>> {
    let bytes = serde_json::to_vec(&value)?;
    ensure!(bytes.len() <= LIMIT, "transport control too large");
    Ok(bytes)
}
async fn exchange(peer: &Peer, message: Value) -> Result<Value> {
    let bytes = encode(message)?;
    let bytes = time::timeout(WAIT, session::exchange(&peer.conn, KIND, &bytes, LIMIT)).await??;
    let value: Value = serde_json::from_slice(&bytes)?;
    ensure!(value["v"] == 1, "transport version");
    Ok(value)
}

impl Control {
    pub(crate) fn new(packets: PacketTransport) -> Self {
        Self {
            packets,
            state: Mutex::default(),
            changed: Notify::new(),
            tasks: Mutex::default(),
            ending: tokio::sync::Mutex::new(()),
            #[cfg(not(target_arch = "wasm32"))]
            native: Mutex::default(),
            #[cfg(not(target_arch = "wasm32"))]
            starting: std::sync::atomic::AtomicBool::new(false),
        }
    }
    pub(crate) fn browser(&self, wt: bool, rtc: bool) {
        let mut state = self.state.lock().expect("transport control");
        if state.closed {
            return;
        }
        state.caps.wt = wt;
        state.caps.rtc = rtc;
        drop(state);
        self.changed.notify_one();
    }
    fn caps(&self) -> Caps {
        self.state.lock().expect("transport control").caps
    }
    pub(crate) fn close(&self) {
        let mut state = self.state.lock().expect("transport control");
        state.closed = true;
        state.sessions.clear();
        state.routes.clear();
        for (_, probe) in std::mem::take(&mut state.probes) {
            probe.abort();
        }
        self.packets.close();
        self.changed.notify_waiters();
        self.changed.notify_one();
        self.tasks.lock().expect("transport tasks").drain(..).for_each(|task| task.abort());
        #[cfg(not(target_arch = "wasm32"))]
        if let Some(native) = self.native.lock().expect("native transport").as_ref() {
            native.close();
        }
    }
    /// Explicit shutdown waits for the native accept loop and UDP socket to finish. Drop still uses close().
    pub(crate) async fn shutdown(&self) {
        let _ending = self.ending.lock().await;
        self.close();
        #[cfg(not(target_arch = "wasm32"))]
        {
            // The native endpoint keeps its UDP socket until its last owner drops, even after close/wait_idle.
            // Retire the handle as well as awaiting its supervisor; serialize concurrent shutdown callers.
            let native = self.native.lock().expect("native transport").take();
            if let Some(native) = native {
                native.shutdown().await;
            }
        }
    }
    /// The caller checks membership from the live Lab before making any negotiation state or outgoing request.
    fn begin(&self, shared: &Shared, peer: &Peer) -> Result<Option<[u8; 16]>> {
        let mut state = self.state.lock().expect("transport control");
        if state.closed || !selected(shared, peer) {
            return Ok(None);
        }
        if let Some(old) = state.sessions.get(&peer.endpoint) {
            if old.on != peer.conn.stable_id() {
                return Ok(None);
            } // gone() retires the old generation
            if old.attempting || old.route.is_some() || old.at.elapsed() < RETRY {
                return Ok(None);
            }
        } else if !room(&mut state) {
            return Ok(None);
        }
        let mine = nonce()?;
        state.sessions.insert(
            peer.endpoint,
            Negotiation {
                on: peer.conn.stable_id(),
                mine,
                theirs: None,
                spent: false,
                wire_epoch: None,
                attempting: true,
                at: Instant::now(),
                route: None,
            },
        );
        Ok(Some(mine))
    }
    fn finish_attempt(&self, peer: &Peer, mine: [u8; 16]) {
        let mut state = self.state.lock().expect("transport control");
        if let Some(n) =
            state.sessions.get_mut(&peer.endpoint).filter(|n| n.on == peer.conn.stable_id() && n.mine == mine)
        {
            n.attempting = false;
        }
    }
    fn receive_caps(&self, shared: &Shared, peer: &Peer, theirs: [u8; 16]) -> Result<[u8; 16]> {
        let mut state = self.state.lock().expect("transport control");
        ensure!(!state.closed && selected(shared, peer), "closed or replaced transport");
        if let Some(old) = state.sessions.get(&peer.endpoint) {
            ensure!(old.on == peer.conn.stable_id(), "old transport connection");
            if old.theirs == Some(theirs) {
                return Ok(old.mine);
            }
            ensure!(old.route.is_none() && old.at.elapsed() >= RETRY, "transport negotiation busy");
        } else {
            ensure!(room(&mut state), "transport session limit");
        }
        let mine = nonce()?;
        state.sessions.insert(
            peer.endpoint,
            Negotiation {
                on: peer.conn.stable_id(),
                mine,
                theirs: Some(theirs),
                spent: false,
                wire_epoch: None,
                attempting: false,
                at: Instant::now(),
                route: None,
            },
        );
        Ok(mine)
    }
    fn spend(&self, shared: &Shared, peer: &Peer, mine: [u8; 16], theirs: [u8; 16]) -> Result<()> {
        let mut state = self.state.lock().expect("transport control");
        ensure!(!state.closed && selected(shared, peer), "closed or replaced transport");
        let n = state.sessions.get_mut(&peer.endpoint).context("no transport challenge")?;
        ensure!(
            n.on == peer.conn.stable_id() && n.mine == mine && n.theirs == Some(theirs) && !n.spent,
            "stale transport negotiation"
        );
        let local = shared.endpoint.id();
        n.wire_epoch = Some(if local < peer.endpoint {
            epoch(&session::exporter(&peer.conn)?, local, peer.endpoint, &mine, &theirs)
        } else {
            epoch(&session::exporter(&peer.conn)?, peer.endpoint, local, &theirs, &mine)
        });
        n.spent = true;
        Ok(())
    }
    fn bind(&self, shared: &Shared, peer: &Peer, id: RouteId, wire_epoch: [u8; 16]) -> Result<()> {
        let mut state = self.state.lock().expect("transport control");
        ensure!(!state.closed && selected(shared, peer), "closed or replaced transport");
        let n = state.sessions.get_mut(&peer.endpoint).context("transport session ended")?;
        ensure!(
            n.on == peer.conn.stable_id() && n.spent && n.wire_epoch == Some(wire_epoch) && n.route.is_none(),
            "transport session replaced"
        );
        n.route = Some(id.clone());
        state.routes.insert(
            id,
            Binding {
                peer: peer.endpoint,
                on: peer.conn.stable_id(),
                wire_epoch,
                sent: 0,
                received: 0,
                since: Instant::now(),
                ready: false,
            },
        );
        Ok(())
    }
    fn open_browser(
        &self,
        shared: &Shared,
        peer: &Peer,
        carrier: Carrier,
        wire_epoch: [u8; 16],
        descriptor: Value,
    ) -> Result<RouteId> {
        // Hold this lock across broker publication: a fast JS ready/signal callback cannot precede its binding.
        let mut state = self.state.lock().expect("transport control");
        ensure!(!state.closed && selected(shared, peer), "closed or replaced transport");
        let n = state.sessions.get_mut(&peer.endpoint).context("transport session ended")?;
        ensure!(
            n.on == peer.conn.stable_id() && n.spent && n.wire_epoch == Some(wire_epoch) && n.route.is_none(),
            "transport session replaced"
        );
        let id = self.packets.open(peer.endpoint, carrier, wire_epoch, descriptor)?;
        n.route = Some(id.clone());
        state.routes.insert(
            id.clone(),
            Binding {
                peer: peer.endpoint,
                on: peer.conn.stable_id(),
                wire_epoch,
                sent: 0,
                received: 0,
                since: Instant::now(),
                ready: false,
            },
        );
        Ok(id)
    }
    #[cfg(not(target_arch = "wasm32"))]
    fn reserve(&self, shared: &Shared, peer: &Peer, wire_epoch: [u8; 16]) -> Result<Value> {
        let native = self.native.lock().expect("native transport").clone().context("no WT listener")?;
        let reservation = native.reserve(peer.endpoint, wire_epoch)?;
        if let Err(error) = self.bind(shared, peer, reservation.id.clone(), wire_epoch) {
            self.packets.close_route(&reservation.id);
            return Err(error);
        }
        Ok(reservation.descriptor)
    }
    #[cfg(target_arch = "wasm32")]
    fn reserve(&self, _shared: &Shared, _peer: &Peer, _wire_epoch: [u8; 16]) -> Result<Value> {
        bail!("no WT listener")
    }
}

/// Only peers already known to the unlocked device may consume carrier resources. Hello alone proves a key,
/// while the Lab establishes which keys this device knows; sync and blob permissions still apply afterwards.
fn selected(shared: &Shared, peer: &Peer) -> bool {
    shared.live(peer.endpoint).is_some_and(|current| current.conn.stable_id() == peer.conn.stable_id())
}

async fn allowed(shared: &Arc<Shared>, peer: &Peer) -> bool {
    let endpoint = *peer.endpoint.as_bytes();
    let device = peer.device;
    shared
        .read(move |lab, me| !lab.locked(me) && lab.peers(me).iter().any(|(d, key)| *d == device && *key == endpoint))
        .await
        && selected(shared, peer)
}

pub(crate) async fn handle(shared: &Arc<Shared>, peer: &Peer, body: &[u8]) -> Result<Vec<u8>> {
    let _operation = shared.admit()?;
    ensure!(body.len() <= LIMIT, "transport control too large");
    ensure!(allowed(shared, peer).await, "transport peer unknown");
    let value: Value = serde_json::from_slice(body)?;
    ensure!(value["v"] == 1, "transport version");
    let control = &shared.transport_control;
    let answer = match value["op"].as_str() {
        Some("caps") => {
            ensure!(peer.endpoint < shared.endpoint.id(), "only the ordered initiator starts transport negotiation");
            let theirs = read_nonce(&value["nonce"])?;
            let mine = control.receive_caps(shared, peer, theirs)?;
            json!({"v":1,"echo":hex(&theirs),"nonce":hex(&mine),"caps":control.caps().json()})
        }
        Some("open") => {
            ensure!(peer.endpoint < shared.endpoint.id(), "transport initiator");
            let theirs = read_nonce(&value["initiator"])?;
            let mine = read_nonce(&value["responder"])?;
            control.spend(shared, peer, mine, theirs)?;
            let wire_epoch =
                epoch(&session::exporter(&peer.conn)?, peer.endpoint, shared.endpoint.id(), &theirs, &mine);
            let caps = control.caps();
            match value["mode"].as_str() {
                Some("rtc") if caps.rtc => {
                    control.open_browser(shared, peer, Carrier::WebRtc, wire_epoch, json!({"initiator":false}))?;
                    json!({"v":1})
                }
                Some("wt-client") if caps.wt => {
                    validate_descriptor(&value["descriptor"])?;
                    control.open_browser(
                        shared,
                        peer,
                        Carrier::WebTransport,
                        wire_epoch,
                        value["descriptor"].clone(),
                    )?;
                    json!({"v":1})
                }
                Some("wt-server") if caps.listener => {
                    json!({"v":1,"descriptor":control.reserve(shared, peer, wire_epoch)?})
                }
                _ => bail!("unsupported transport mode"),
            }
        }
        Some("signal") => {
            let wire_epoch = read_nonce(&value["epoch"])?;
            let sequence = value["sequence"].as_u64().context("signal sequence")?;
            ensure!(serde_json::to_vec(&value["signal"])?.len() <= SIGNAL_LIMIT, "signal too large");
            let mut state = control.state.lock().expect("transport control");
            ensure!(!state.closed && selected(shared, peer), "closed or replaced transport");
            let (id, binding) = state
                .routes
                .iter_mut()
                .find(|(_, b)| b.peer == peer.endpoint && b.on == peer.conn.stable_id() && b.wire_epoch == wire_epoch)
                .context("old signaling route")?;
            ensure!(binding.received == sequence && sequence < 128, "signal order or count");
            ensure!(control.packets.signal(id, value["signal"].clone()), "signal queue full");
            binding.received += 1;
            json!({"v":1})
        }
        _ => bail!("unsupported transport operation"),
    };
    encode(answer)
}

fn validate_descriptor(value: &Value) -> Result<()> {
    let url = value["url"].as_str().context("WT URL")?;
    ensure!(
        url.len() <= 2048
            && url.starts_with("https://")
            && !url.contains('@')
            && !url.contains('#')
            && !url.chars().any(char::is_whitespace),
        "WT URL"
    );
    let expires = value["expires"].as_u64().context("WT expiry")?;
    ensure!(expires > crate::unix_now() && expires.saturating_sub(crate::unix_now()) <= 14 * 86400, "WT expiry");
    let hashes = value["certificateHashes"].as_array().context("WT certificate hashes")?;
    ensure!(!hashes.is_empty() && hashes.len() <= 4, "WT certificate hashes");
    for hash in hashes {
        let hash = hash.as_str().context("WT certificate hash")?;
        ensure!(
            hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            "WT certificate hash"
        );
    }
    Ok(())
}

async fn negotiate(shared: Arc<Shared>, peer: Peer) -> Result<()> {
    let _operation = shared.admit()?;
    if shared.endpoint.id() >= peer.endpoint || !allowed(&shared, &peer).await {
        return Ok(());
    }
    let control = &shared.transport_control;
    let caps = control.caps();
    if !caps.wt && !caps.rtc && !caps.listener {
        return Ok(());
    }
    let Some(mine) = control.begin(&shared, &peer)? else {
        return Ok(());
    };
    let result = async {
        let reply = exchange(&peer, json!({"v":1,"op":"caps","nonce":hex(&mine)})).await?;
        ensure!(read_nonce(&reply["echo"])? == mine, "transport challenge mismatch");
        let theirs = read_nonce(&reply["nonce"])?;
        let remote = Caps::from_json(&reply["caps"])?;
        {
            let mut state = control.state.lock().expect("transport control");
            let n = state.sessions.get_mut(&peer.endpoint).context("transport negotiation ended")?;
            ensure!(n.on == peer.conn.stable_id() && n.mine == mine && n.attempting, "transport negotiation replaced");
            n.theirs = Some(theirs);
        }
        let mode = if caps.listener && remote.wt {
            "wt-client"
        } else if caps.wt && remote.listener {
            "wt-server"
        } else if caps.rtc && remote.rtc {
            "rtc"
        } else {
            return Ok(());
        };
        control.spend(&shared, &peer, mine, theirs)?;
        let wire_epoch = epoch(&session::exporter(&peer.conn)?, shared.endpoint.id(), peer.endpoint, &mine, &theirs);
        let mut open = json!({"v":1,"op":"open","initiator":hex(&mine),"responder":hex(&theirs),"mode":mode});
        if mode == "wt-client" {
            open["descriptor"] = control.reserve(&shared, &peer, wire_epoch)?;
        }
        let answer = exchange(&peer, open).await?;
        match mode {
            "rtc" => {
                control.open_browser(&shared, &peer, Carrier::WebRtc, wire_epoch, json!({"initiator":true}))?;
            }
            "wt-server" => {
                validate_descriptor(&answer["descriptor"])?;
                control.open_browser(
                    &shared,
                    &peer,
                    Carrier::WebTransport,
                    wire_epoch,
                    answer["descriptor"].clone(),
                )?;
            }
            _ => {}
        }
        Ok(())
    }
    .await;
    control.finish_attempt(&peer, mine);
    if result.is_err() {
        let id = control
            .state
            .lock()
            .expect("transport control")
            .sessions
            .get(&peer.endpoint)
            .filter(|s| s.on == peer.conn.stable_id() && s.mine == mine)
            .and_then(|s| s.route.clone());
        if let Some(id) = id {
            close_route(&shared, &id);
        }
    }
    result
}

// All control publication/removal is serialized by state, including lookup updates and peer selection.
// This lock order is state -> peers/lookup/packets. Callers must not hold the peers mutex first.
fn close_locked(shared: &Shared, state: &mut State, id: &RouteId) {
    shared.packets.close_route(id);
    let Some(binding) = state.routes.remove(id) else {
        return;
    };
    if let Some(session) =
        state.sessions.get_mut(&binding.peer).filter(|s| s.on == binding.on && s.route.as_ref() == Some(id))
    {
        session.route = None;
    }
    if let Some(probe) = state.probes.remove(id) {
        probe.abort();
    }
    // Re-add merges with concurrent IP/relay additions. Other custom route writers use this same state lock.
    if let Some(info) = shared.lookup.remove_endpoint_info(binding.peer) {
        let addresses = info
            .data
            .addrs()
            .filter(|addr| match addr {
                TransportAddr::Custom(addr) => !(addr.data().len() == 49 && addr.data()[33..] == binding.wire_epoch),
                _ => true,
            })
            .cloned();
        shared.lookup.add_endpoint_info(EndpointAddr::from_parts(binding.peer, addresses));
    }
}

pub(crate) fn close_route(shared: &Arc<Shared>, id: &RouteId) {
    let control = &shared.transport_control;
    close_locked(shared, &mut control.state.lock().expect("transport control"), id);
    control.changed.notify_one();
    shared.jobs.stir();
}

pub(crate) fn gone(shared: &Arc<Shared>, peer: &Peer) {
    let control = &shared.transport_control;
    let id = control
        .state
        .lock()
        .expect("transport control")
        .sessions
        .get(&peer.endpoint)
        .filter(|n| n.on == peer.conn.stable_id())
        .and_then(|n| n.route.clone());
    if let Some(id) = id {
        close_route(shared, &id);
    }
    let mut state = control.state.lock().expect("transport control");
    if state.sessions.get(&peer.endpoint).is_some_and(|n| n.on == peer.conn.stable_id()) {
        state.sessions.remove(&peer.endpoint);
    }
}

/// The existing connection stays in place. A short authenticated blob-ALPN probe publishes the custom address to
/// iroh's shared path actor; it never replaces the sync peer or its Hello. Actual path promotion is tested separately.
pub(crate) fn ready(shared: &Arc<Shared>, id: &RouteId, mtu: usize) -> Result<()> {
    let _operation = shared.admit()?;
    let address = shared.packets.ready(id, mtu)?;
    let result = ready_address(shared, id, address);
    if result.is_err() {
        close_route(shared, id);
    }
    result
}
pub(crate) fn ready_address(shared: &Arc<Shared>, id: &RouteId, address: iroh_base::CustomAddr) -> Result<()> {
    let operation = shared.admit()?;
    let mut state = shared.transport_control.state.lock().expect("transport control");
    ensure!(!state.closed, "node closed");
    let binding = state.routes.get_mut(id).context("late carrier ready")?;
    ensure!(shared.live(binding.peer).is_some_and(|p| p.conn.stable_id() == binding.on), "old carrier connection");
    if binding.ready {
        return Ok(());
    }
    binding.ready = true;
    let addr = EndpointAddr::from_parts(binding.peer, [TransportAddr::Custom(address)]);
    shared.lookup.add_endpoint_info(addr.clone());
    let device = shared.clone();
    // Registration and publication share the close lock: a late Ready cannot reinsert a closed route or launch
    // a detached probe. Closing a route aborts its pending probe before removing the lookup entry.
    let probe = task::spawn(async move {
        // Cancellation/route teardown drops this ticket with the probe, so the
        // node's quiescence barrier includes every admitted path activation.
        let _operation = operation;
        // Packet readers must start before waiting for a QUIC probe. This cannot block the JS ready event.
        if let Ok(Ok(connection)) = time::timeout(WAIT, device.endpoint.connect(addr, iroh_blobs::ALPN)).await {
            connection.close(0u32.into(), b"path probe complete");
        }
        device.jobs.stir();
    });
    state.probes.insert(id.clone(), probe);
    Ok(())
}

pub(crate) async fn browser_event(shared: &Arc<Shared>, event: Value) -> Result<()> {
    let _operation = shared.admit()?;
    if event["kind"] == "capabilities" {
        shared
            .transport_control
            .browser(event["webtransport"].as_bool().unwrap_or(false), event["webrtc"].as_bool().unwrap_or(false));
        return Ok(());
    }
    let route = event["route"].as_str().context("route id")?;
    ensure!(route.len() <= 128, "route id");
    let epoch = event["epoch"].as_u64().and_then(|n| u32::try_from(n).ok()).context("route generation")?;
    let id = RouteId { route: route.to_owned(), epoch };
    match event["kind"].as_str() {
        Some("ready") => {
            let mtu = event["mtu"].as_u64().and_then(|n| usize::try_from(n).ok()).context("carrier MTU")?;
            ready(shared, &id, mtu)
        }
        Some("closed") => {
            close_route(shared, &id);
            Ok(())
        }
        Some("signal") => {
            ensure!(serde_json::to_vec(&event["signal"])?.len() <= SIGNAL_LIMIT, "signal too large");
            let binding = {
                let mut state = shared.transport_control.state.lock().expect("transport control");
                let Some(binding) = state.routes.get_mut(&id) else {
                    return Ok(());
                };
                ensure!(binding.sent < 128, "signal count");
                let copy = binding.clone();
                binding.sent += 1;
                copy
            };
            let Some(peer) = shared.live(binding.peer).filter(|p| p.conn.stable_id() == binding.on) else {
                close_route(shared, &id);
                return Ok(());
            };
            let result = exchange(&peer, json!({"v":1,"op":"signal","epoch":hex(&binding.wire_epoch),"sequence":binding.sent,"signal":event["signal"]})).await;
            if result.is_err() {
                close_route(shared, &id);
            }
            result.map(|_| ())
        }
        _ => bail!("carrier event"),
    }
}

/// A crossed dial to the same proven device selects the lower endpoint's outgoing connection at both ends.
/// Either direction alone works; same-direction and key-move replacement retain their existing behavior.
/// The caller still serves the actual new peer, even when it does not replace the selected connection.
pub(crate) fn connected(shared: &Arc<Shared>, peer: &Peer) {
    let Ok(_operation) = shared.admit() else {
        peer.conn.close(0u32.into(), b"node closing");
        return;
    };
    let control = &shared.transport_control;
    let mut state = control.state.lock().expect("transport control");
    if state.closed {
        peer.conn.close(0u32.into(), b"node closing");
        return;
    }
    let mut peers = shared.peers.lock().expect("peers");
    if let Some(old) = peers.get(&peer.endpoint) {
        let lower = shared.endpoint.id() < peer.endpoint;
        let old_dialed = matches!(old.conn.side(), iroh::endpoint::Side::Client);
        let incoming_dialed = matches!(peer.conn.side(), iroh::endpoint::Side::Client);
        // ConnectionSelection.retain: preserve the live preferred generation and its route. Peer identity
        // equality matters: an authenticated key move at the same endpoint must not be held behind the old key.
        let retain = old.conn.close_reason().is_none()
            && old.device == peer.device
            && lower == old_dialed
            && lower != incoming_dialed;
        if old.conn.stable_id() == peer.conn.stable_id() || retain {
            return;
        }
    }
    peers.insert(peer.endpoint, peer.clone());
    drop(peers);
    let stale =
        state.sessions.get(&peer.endpoint).filter(|n| n.on != peer.conn.stable_id()).and_then(|n| n.route.clone());
    if let Some(id) = stale {
        close_locked(shared, &mut state, &id);
    }
    if state.sessions.get(&peer.endpoint).is_some_and(|n| n.on != peer.conn.stable_id()) {
        state.sessions.remove(&peer.endpoint);
    }
    drop(state);
    control.changed.notify_one();
}

/// Select a bounded ordered window even when the source is a HashMap. Only admitted candidates are cloned.
fn rotating_window<'a, T: Clone + 'a>(
    entries: impl Iterator<Item = (EndpointId, &'a T)>,
    cursor: Option<EndpointId>,
) -> Vec<(EndpointId, T)> {
    let mut selected = BTreeMap::new();
    for (id, value) in entries {
        let key = (cursor.is_some_and(|cursor| id <= cursor), id);
        if selected.len() == SESSIONS && selected.last_key_value().is_some_and(|(last, _)| key >= *last) {
            continue;
        }
        selected.insert(key, value.clone());
        if selected.len() > SESSIONS {
            selected.pop_last();
        }
    }
    selected.into_iter().map(|((_, id), value)| (id, value)).collect()
}

pub(crate) async fn maintain(shared: Arc<Shared>) {
    loop {
        let control = &shared.transport_control;
        let active = {
            let state = control.state.lock().expect("transport control");
            if state.closed {
                break;
            }
            state.caps.wt || state.caps.rtc || state.caps.listener || !state.routes.is_empty()
        };
        if !active {
            // Store one permit across the state check: capability startup/shutdown cannot be missed here.
            control.changed.notified().await;
            continue;
        }
        let Ok(operation) = shared.admit() else {
            break;
        };
        let known: BTreeSet<_> =
            shared.read(|lab, me| if lab.locked(me) { Vec::new() } else { lab.peers(me) }).await.into_iter().collect();
        let candidates = {
            let mut state = shared.transport_control.state.lock().expect("transport control");
            let live = shared.peers.lock().expect("peers");
            let permitted =
                |p: &Peer| p.conn.close_reason().is_none() && known.contains(&(p.device, *p.endpoint.as_bytes()));
            let current = |endpoint: &EndpointId, on| {
                live.get(endpoint).is_some_and(|p| p.conn.stable_id() == on && permitted(p))
            };
            let stale: Vec<_> = state
                .routes
                .iter()
                .filter(|(_, b)| (!b.ready && b.since.elapsed() > OPEN_WAIT) || !current(&b.peer, b.on))
                .map(|(id, _)| id.clone())
                .collect();
            // close_locked needs no peers lock; its state lock prevents new route publication during this snapshot.
            drop(live);
            for id in stale {
                close_locked(&shared, &mut state, &id);
            }
            let live = shared.peers.lock().expect("peers");
            state
                .sessions
                .retain(|endpoint, n| live.get(endpoint).is_some_and(|p| p.conn.stable_id() == n.on && permitted(p)));
            // Walk endpoints circularly. Unsupported recent peers cannot permanently starve older capable ones.
            let candidates =
                rotating_window(live.iter().filter(|(_, p)| permitted(p)).map(|(id, p)| (*id, p)), state.cursor);
            if let Some((last, _)) = candidates.last() {
                state.cursor = Some(*last);
            }
            candidates.into_iter().map(|(_, peer)| peer).collect::<Vec<_>>()
        };
        let mut attempts = n0_future::FuturesUnordered::new();
        use n0_future::StreamExt as _;
        for peer in candidates {
            if attempts.len() >= 4 {
                attempts.next().await;
            }
            let shared = shared.clone();
            attempts.push(async move {
                let _ = negotiate(shared, peer).await;
            });
        }
        while attempts.next().await.is_some() {}
        drop(operation);
        future::or(
            async {
                shared.transport_control.changed.notified().await;
            },
            time::sleep(Duration::from_secs(5)),
        )
        .await;
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) async fn listen(shared: &Arc<Shared>, config: super::webtransport::Config) -> Result<()> {
    let _operation = shared.admit()?;
    use std::sync::atomic::Ordering;
    ensure!(!shared.transport_control.starting.swap(true, Ordering::AcqRel), "WT listener already starting/running");
    let (events, mut incoming) = tokio::sync::mpsc::channel(16);
    let native = match super::webtransport::NativeWt::bind(config, shared.packets.clone(), events).await {
        Ok(native) => Arc::new(native),
        Err(error) => {
            shared.transport_control.starting.store(false, Ordering::Release);
            return Err(error.into());
        }
    };
    let mut state = shared.transport_control.state.lock().expect("transport control");
    if state.closed {
        native.close();
        bail!("node closed");
    }
    {
        let mut slot = shared.transport_control.native.lock().expect("native transport");
        ensure!(slot.is_none(), "WT listener already running");
        *slot = Some(native);
    }
    state.caps.listener = true;
    let device = shared.clone();
    let task = task::spawn(async move {
        while let Some(event) = incoming.recv().await {
            match event {
                super::webtransport::WtEvent::Ready { id, address, .. } => {
                    if ready_address(&device, &id, address).is_err() {
                        close_route(&device, &id);
                    }
                }
                super::webtransport::WtEvent::Closed { id, .. } => close_route(&device, &id),
            }
        }
    });
    shared.transport_control.tasks.lock().expect("transport tasks").push(task);
    drop(state);
    shared.transport_control.changed.notify_one();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn route_epoch_binds_both_challenges_ordered_endpoints_and_the_tls_session() {
        let a = iroh::SecretKey::from_bytes(&[1; 32]).public();
        let b = iroh::SecretKey::from_bytes(&[2; 32]).public();
        let expected = epoch(&[1; 32], a, b, &[2; 16], &[3; 16]);
        assert_ne!(expected, epoch(&[2; 32], a, b, &[2; 16], &[3; 16]));
        assert_ne!(expected, epoch(&[1; 32], b, a, &[2; 16], &[3; 16]));
        assert_ne!(expected, epoch(&[1; 32], a, b, &[4; 16], &[3; 16]));
        assert_ne!(expected, epoch(&[1; 32], a, b, &[2; 16], &[4; 16]));
    }
    #[test]
    fn bounded_candidate_windows_eventually_visit_every_peer_regardless_of_source_order() {
        let mut entries: Vec<_> =
            (1..=53).map(|seed| (iroh::SecretKey::from_bytes(&[seed; 32]).public(), seed)).collect();
        let expected: BTreeSet<_> = entries.iter().map(|(id, _)| *id).collect();
        let mut cursor = None;
        let mut seen = BTreeSet::new();
        for turn in 0..4 {
            // Adversarial, changing HashMap-like iteration must not govern fairness.
            entries.rotate_left(turn * 7);
            entries.reverse();
            let window = rotating_window(entries.iter().map(|(id, value)| (*id, value)), cursor);
            assert_eq!(window.len(), SESSIONS);
            cursor = window.last().map(|(id, _)| *id);
            seen.extend(window.into_iter().map(|(id, _)| id));
        }
        assert_eq!(seen, expected);
    }

    #[test]
    fn bounded_descriptors_reject_credentials_stale_pins_and_unbounded_expiry() {
        let good = json!({"url":"https://localhost:4433/avendb/one","expires":crate::unix_now()+60,"certificateHashes":["a".repeat(64)]});
        assert!(validate_descriptor(&good).is_ok());
        for url in ["http://localhost/", "https://user:pass@localhost/", "https://localhost/#fragment"] {
            let mut bad = good.clone();
            bad["url"] = json!(url);
            assert!(validate_descriptor(&bad).is_err());
        }
        let mut bad = good.clone();
        bad["expires"] = json!(crate::unix_now());
        assert!(validate_descriptor(&bad).is_err());
        let mut bad = good.clone();
        bad["expires"] = json!(u64::MAX);
        assert!(validate_descriptor(&bad).is_err());
        let mut bad = good;
        bad["certificateHashes"] = json!(["z".repeat(64)]);
        assert!(validate_descriptor(&bad).is_err());
    }
}
