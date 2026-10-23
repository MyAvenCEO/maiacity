use std::collections::{BTreeMap, VecDeque};
use std::future::poll_fn;
use std::io;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};

use iroh::EndpointId;
use iroh::endpoint::transports::{CustomTransport, CustomEndpoint, CustomSender, RecvInfo, Transmit};
use iroh_base::CustomAddr;
use n0_future::time::Instant;
use serde_json::Value;
use super::framing::{self, Reassembly};

const MAX_ROUTES: usize = 8;
const MAX_CONTROL: usize = 64;
const MAX_OUT_PACKETS: usize = 256;
const MAX_OUT_BYTES: usize = 256 << 10;
const MAX_IN_PACKETS: usize = 256;
const MAX_IN_BYTES: usize = 512 << 10;
const MAX_SEGMENTS: usize = 64;

/// Application-private transport IDs, distinct from iroh's test transport and its built-in paths.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Carrier { WebTransport, WebRtc }
impl Carrier {
    fn id(self) -> u64 { match self { Self::WebTransport => 0x6176_656e_5754_0001, Self::WebRtc => 0x6176_656e_5254_0001 } }
    pub fn name(self) -> &'static str { match self { Self::WebTransport => "webtransport", Self::WebRtc => "webrtc" } }
}

/// A process-local route handle. New negotiations always get fresh handles, even for the same endpoint.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct RouteId { pub route: String, pub epoch: u32 }

/// One command for an outer carrier. Consumers await bounded carrier admission before requesting another send.
#[derive(Debug)]
pub enum Command {
    Open { id: RouteId, carrier: Carrier, descriptor: Value },
    Send { id: RouteId, bytes: Vec<u8> },
    Signal { id: RouteId, signal: Value },
    Close { id: RouteId },
}
impl Command {
    fn route(&self) -> &RouteId { match self {
        Self::Open { id, .. } | Self::Send { id, .. } | Self::Signal { id, .. } | Self::Close { id } => id,
    } }
}

#[derive(Debug)]
struct Route {
    id: RouteId,
    local: CustomAddr,
    remote: CustomAddr,
    wire_epoch: [u8; 16],
    mtu: Option<usize>,
    opened: bool,
    next_packet: u64,
    out: VecDeque<Vec<u8>>,
    out_bytes: usize,
    reassembly: Reassembly,
}
#[derive(Debug)]
struct Packet { id: RouteId, remote: CustomAddr, local: CustomAddr, bytes: Vec<u8> }
#[derive(Debug, Default)]
struct State {
    bound: bool,
    closed: bool,
    routes: BTreeMap<RouteId, Route>,
    control: VecDeque<Command>,
    incoming: VecDeque<Packet>,
    in_bytes: usize,
    next_route: usize,
    control_burst: usize,
    commands_waker: Option<Waker>,
    recv_waker: Option<Waker>,
    dropped: u64,
}
#[derive(Debug)]
struct Inner {
    local: EndpointId,
    state: Mutex<State>,
    addresses: n0_watcher::Watchable<Vec<CustomAddr>>,
}
/// Rust-owned bounded queues only: JS/HTTP3 handles remain in their own runtime and never require unsafe Send.
#[derive(Clone, Debug)]
pub struct PacketTransport(Arc<Inner>);

fn address(carrier: Carrier, endpoint: EndpointId, epoch: &[u8; 16]) -> CustomAddr {
    let mut bytes = Vec::with_capacity(49);
    bytes.push(1); bytes.extend_from_slice(endpoint.as_bytes()); bytes.extend_from_slice(epoch);
    CustomAddr::from_parts(carrier.id(), &bytes)
}
fn take_control(state: &mut State) -> Option<Command> {
    let command = state.control.pop_front()?;
    if let Command::Open { id, .. } = &command {
        if let Some(route) = state.routes.get_mut(id) { route.opened = true; }
    }
    state.control_burst = state.control_burst.saturating_add(1);
    Some(command)
}
fn wake(wakers: impl IntoIterator<Item = Waker>) { for waker in wakers { waker.wake(); } }
fn failed(message: &'static str) -> io::Error { io::Error::new(io::ErrorKind::NotConnected, message) }

impl PacketTransport {
    pub fn new(local: EndpointId) -> Self {
        Self(Arc::new(Inner { local, state: Mutex::default(), addresses: n0_watcher::Watchable::new(Vec::new()) }))
    }

    /// Register only after authenticating the peer and its descriptor on the existing sync connection.
    /// `wire_epoch` is agreed once for this carrier, through that same connection.
    pub fn open(&self, peer: EndpointId, carrier: Carrier, wire_epoch: [u8; 16], descriptor: Value) -> io::Result<RouteId> {
        if descriptor.to_string().len() > 16 << 10 { return Err(io::Error::new(io::ErrorKind::InvalidInput, "oversize carrier descriptor")); }
        let mut random = [0u8; 16]; getrandom::fill(&mut random).map_err(io::Error::other)?;
        let id = RouteId { route: data_encoding::HEXLOWER.encode(&random), epoch: 1 };
        let remote = address(carrier, peer, &wire_epoch);
        let mut state = self.0.state.lock().expect("packet transport");
        if state.closed { return Err(failed("packet transport closed")); }
        if state.routes.len() >= MAX_ROUTES || state.control.len() >= MAX_CONTROL {
            return Err(io::Error::new(io::ErrorKind::WouldBlock, "carrier route limit"));
        }
        if state.routes.values().any(|r| r.remote == remote) {
            return Err(io::Error::new(io::ErrorKind::AlreadyExists, "carrier epoch already open"));
        }
        state.routes.insert(id.clone(), Route {
            id: id.clone(), local: address(carrier, self.0.local, &wire_epoch), remote, wire_epoch,
            mtu: None, opened: false, next_packet: 0, out: VecDeque::new(), out_bytes: 0, reassembly: Reassembly::new(wire_epoch),
        });
        state.control.push_back(Command::Open { id: id.clone(), carrier, descriptor });
        let waker = state.commands_waker.take(); drop(state); wake(waker);
        Ok(id)
    }

    /// Publish the route only once the outer carrier has authenticated/opened and reported its real datagram MTU.
    pub fn ready(&self, id: &RouteId, mtu: usize) -> io::Result<CustomAddr> {
        if !(256..=65535).contains(&mtu) { return Err(io::Error::new(io::ErrorKind::InvalidInput, "carrier MTU")); }
        let mut state = self.0.state.lock().expect("packet transport");
        let route = state.routes.get_mut(id).ok_or_else(|| failed("stale carrier ready"))?;
        if route.mtu.is_some_and(|old| old != mtu) { return Err(io::Error::new(io::ErrorKind::InvalidInput, "carrier MTU changed")); }
        route.mtu = Some(mtu);
        let remote = route.remote.clone();
        self.publish(&state);
        Ok(remote)
    }

    fn publish(&self, state: &State) {
        let _ = self.0.addresses.set(state.routes.values().filter(|r| r.mtu.is_some()).map(|r| r.local.clone()).collect());
    }

    /// Forward one authenticated RTC signal. Backpressure is explicit; callers close overloaded negotiations.
    pub fn signal(&self, id: &RouteId, signal: Value) -> bool {
        if signal.to_string().len() > 16 << 10 { return false; }
        let mut state = self.0.state.lock().expect("packet transport");
        if !state.routes.contains_key(id) || state.control.len() >= MAX_CONTROL { return false; }
        state.control.push_back(Command::Signal { id: id.clone(), signal });
        let waker = state.commands_waker.take(); drop(state); wake(waker); true
    }

    /// Consume one outer datagram. A stale callback can never inject into a later route.
    pub fn receive(&self, id: &RouteId, bytes: &[u8]) -> bool {
        let mut state = self.0.state.lock().expect("packet transport");
        let Some(route) = state.routes.get_mut(id) else { return false; };
        // The reported MTU limits our sends, not the peer's. HTTP/3 path MTUs may differ
        // by direction; reassembly independently bounds packet size, fragments and held bytes.
        if route.mtu.is_none() || bytes.len() > 65535 { return false; }
        let Some(bytes) = route.reassembly.receive(bytes, Instant::now()) else { return true; };
        let packet = Packet { id: id.clone(), remote: route.remote.clone(), local: route.local.clone(), bytes };
        if state.incoming.len() >= MAX_IN_PACKETS || state.in_bytes + packet.bytes.len() > MAX_IN_BYTES { return false; }
        state.in_bytes += packet.bytes.len(); state.incoming.push_back(packet);
        let waker = state.recv_waker.take(); drop(state); wake(waker); true
    }

    /// Drop every queue and partial packet belonging to this route, including commands not yet consumed by JS.
    pub fn close_route(&self, id: &RouteId) {
        let mut state = self.0.state.lock().expect("packet transport");
        if state.routes.remove(id).is_none() { return; }
        state.control.retain(|command| command.route() != id);
        state.incoming.retain(|packet| &packet.id != id);
        state.in_bytes = state.incoming.iter().map(|p| p.bytes.len()).sum();
        // Teardown has up to MAX_ROUTES reserved slots beyond MAX_CONTROL. Repeated closes cannot add
        // duplicates, and opens stop at MAX_CONTROL, so old Close commands cannot grow without bound.
        if state.control.len() >= MAX_CONTROL {
            if let Some(index) = state.control.iter().position(|c| matches!(c, Command::Signal { .. })) { state.control.remove(index); }
        }
        state.control.push_back(Command::Close { id: id.clone() });
        self.publish(&state);
        let waker = state.commands_waker.take(); drop(state); wake(waker);
    }

    pub fn close(&self) {
        let mut state = self.0.state.lock().expect("packet transport");
        state.closed = true; state.routes.clear(); state.control.clear(); state.incoming.clear(); state.in_bytes = 0;
        self.publish(&state);
        let wakers = [state.commands_waker.take(), state.recv_waker.take()]; drop(state); wake(wakers.into_iter().flatten());
    }

    /// Inner packets dropped at bounded outbound admission. QUIC treats these as ordinary packet loss.
    pub fn dropped(&self) -> u64 { self.0.state.lock().expect("packet transport").dropped }

    /// A single consumer, normally the browser worker or native HTTP3 carrier task.
    pub async fn next(&self) -> Option<Command> {
        poll_fn(|cx| {
            let mut state = self.0.state.lock().expect("packet transport");
            if state.closed { return Poll::Ready(None); }
            if state.control_burst < 8 {
                if let Some(command) = take_control(&mut state) { return Poll::Ready(Some(command)); }
            }
            let count = state.routes.len();
            for step in 0..count {
                let index = (state.next_route + step) % count;
                let Some(route) = state.routes.values_mut().nth(index) else { continue; };
                if !route.opened { continue; }
                if let Some(bytes) = route.out.pop_front() {
                    route.out_bytes -= bytes.len();
                    let command = Command::Send { id: route.id.clone(), bytes };
                    state.next_route = (index + 1) % count; state.control_burst = 0;
                    return Poll::Ready(Some(command));
                }
            }
            if let Some(command) = take_control(&mut state) { return Poll::Ready(Some(command)); }
            state.commands_waker = Some(cx.waker().clone()); Poll::Pending
        }).await
    }

    fn send(&self, _cx: &mut Context<'_>, dst: &CustomAddr, src: Option<&CustomAddr>, contents: &[u8], segment: Option<usize>) -> Poll<io::Result<()>> {
        let mut state = self.0.state.lock().expect("packet transport");
        let Some(route) = state.routes.values_mut().find(|r| &r.remote == dst) else {
            // iroh may still probe an expired custom address. Loss lets its path selector fall back; an I/O
            // error here could fail otherwise healthy connections sharing the endpoint.
            state.dropped = state.dropped.saturating_add(1); return Poll::Ready(Ok(()));
        };
        if src.is_some_and(|src| src != &route.local) { return Poll::Ready(Err(failed("carrier source mismatch"))); }
        let Some(mtu) = route.mtu else { return Poll::Ready(Err(failed("carrier not ready"))); };
        let segment = segment.unwrap_or(contents.len());
        if segment == 0 || segment > framing::MAX_PACKET || contents.is_empty()
            || contents.len().div_ceil(segment) > MAX_SEGMENTS {
            return Poll::Ready(Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid inner datagram segments")));
        }
        let count = contents.len().div_ceil(segment) as u64;
        if route.next_packet.checked_add(count).is_none() { return Poll::Ready(Err(failed("carrier packet sequence exhausted"))); }
        let fragments: usize = contents.chunks(segment).map(|packet| packet.len().div_ceil(mtu - framing::HEADER)).sum();
        let bytes = contents.len() + fragments * framing::HEADER;
        if route.out.len() + fragments > MAX_OUT_PACKETS || route.out_bytes + bytes > MAX_OUT_BYTES {
            // iroh 1.3's custom dispatcher does not propagate Pending. Explicit bounded loss is therefore the
            // adapter contract: no unbounded buffers or pretend end-to-end backpressure; inner QUIC recovers.
            state.dropped = state.dropped.saturating_add(count);
            return Poll::Ready(Ok(()));
        }
        let mut frames = Vec::with_capacity(fragments);
        for (index, packet) in contents.chunks(segment).enumerate() {
            match framing::encode(&route.wire_epoch, route.next_packet + index as u64, packet, mtu) {
                Ok(part) => frames.extend(part), Err(error) => return Poll::Ready(Err(error)),
            }
        }
        route.next_packet += count; route.out_bytes += bytes; route.out.extend(frames);
        let waker = state.commands_waker.take(); drop(state); wake(waker); Poll::Ready(Ok(()))
    }
}

#[derive(Debug)]
struct Bound(PacketTransport);
impl Drop for Bound { fn drop(&mut self) { self.0.close(); } }
impl CustomTransport for PacketTransport {
    fn bind(&self) -> io::Result<Box<dyn CustomEndpoint>> {
        let mut state = self.0.state.lock().expect("packet transport");
        if state.bound || state.closed { return Err(io::Error::new(io::ErrorKind::AlreadyExists, "packet transport bound once")); }
        state.bound = true; Ok(Box::new(Bound(self.clone())))
    }
}
impl CustomSender for PacketTransport {
    fn is_valid_send_addr(&self, addr: &CustomAddr) -> bool {
        [Carrier::WebTransport.id(), Carrier::WebRtc.id()].contains(&addr.id()) && addr.data().len() == 49 && addr.data()[0] == 1
    }
    fn poll_send(&self, cx: &mut Context, dst: &CustomAddr, src: Option<&CustomAddr>, transmit: &Transmit<'_>) -> Poll<io::Result<()>> {
        self.send(cx, dst, src, transmit.contents, transmit.segment_size)
    }
}
impl CustomEndpoint for Bound {
    // iroh takes the MINIMUM across all registered transports, including idle ones. Preserve native UDP GSO.
    fn max_transmit_segments(&self) -> std::num::NonZeroUsize { std::num::NonZeroUsize::new(MAX_SEGMENTS).unwrap() }
    fn watch_local_addrs(&self) -> n0_watcher::Direct<Vec<CustomAddr>> { self.0.0.addresses.watch() }
    fn create_sender(&self) -> Arc<dyn CustomSender> { Arc::new(self.0.clone()) }
    fn poll_recv(&mut self, cx: &mut Context, bufs: &mut [io::IoSliceMut<'_>], metas: &mut [noq_udp::RecvMeta], infos: &mut [RecvInfo]) -> Poll<io::Result<usize>> {
        assert_eq!(bufs.len(), metas.len()); assert_eq!(bufs.len(), infos.len());
        if bufs.is_empty() { return Poll::Ready(Ok(0)); }
        let mut state = self.0.0.state.lock().expect("packet transport");
        if state.closed { return Poll::Ready(Err(failed("packet transport closed"))); }
        let mut count = 0;
        while count < bufs.len() {
            let Some(packet) = state.incoming.pop_front() else { break; };
            state.in_bytes -= packet.bytes.len();
            if bufs[count].len() < packet.bytes.len() { continue; } // drop, never truncate one QUIC packet into another
            bufs[count][..packet.bytes.len()].copy_from_slice(&packet.bytes);
            metas[count] = noq_udp::RecvMeta::default();
            metas[count].len = packet.bytes.len(); metas[count].stride = packet.bytes.len();
            infos[count] = RecvInfo::new(packet.remote, Some(packet.local)); count += 1;
        }
        if count > 0 { Poll::Ready(Ok(count)) } else { state.recv_waker = Some(cx.waker().clone()); Poll::Pending }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn transport() -> PacketTransport { PacketTransport::new(iroh::SecretKey::from_bytes(&[1; 32]).public()) }
    fn peer() -> EndpointId { iroh::SecretKey::from_bytes(&[2; 32]).public() }
    fn route(t: &PacketTransport) -> RouteId { t.open(peer(), Carrier::WebRtc, [7; 16], Value::Null).unwrap() }

    #[tokio::test]
    async fn queue_pressure_is_bounded_loss_and_close_rejects_late_callbacks() {
        let t = transport(); let id = route(&t); let addr = t.ready(&id, 1500).unwrap();
        assert!(matches!(t.next().await, Some(Command::Open { .. })));
        let mut cx = Context::from_waker(Waker::noop());
        for _ in 0..MAX_OUT_PACKETS * 2 { assert!(t.send(&mut cx, &addr, None, &[3; 1200], None).is_ready()); }
        assert!(t.dropped() > 0);
        assert!(matches!(t.next().await, Some(Command::Send { .. })));
        assert!(t.send(&mut cx, &addr, None, &[3; 1200], None).is_ready());
        t.close_route(&id); assert!(!t.receive(&id, &[0; 100])); assert!(t.ready(&id, 1200).is_err());
        assert!(matches!(t.next().await, Some(Command::Close { .. })));
        t.close(); assert!(t.next().await.is_none()); assert!(route_error(&t));
    }
    #[tokio::test]
    async fn native_gso_aggregates_are_split_into_independent_packets() {
        let t = transport(); let bound = t.bind().unwrap();
        assert_eq!(bound.max_transmit_segments().get(), 64);
        let id = route(&t); let addr = t.ready(&id, 1500).unwrap(); t.next().await;
        let data = vec![42; 1200 * 64]; let mut cx = Context::from_waker(Waker::noop());
        assert!(matches!(t.send(&mut cx, &addr, None, &data, Some(1200)), Poll::Ready(Ok(()))));
        assert_eq!(t.dropped(), 0);
        let mut decoder = Reassembly::new([7; 16]);
        for _ in 0..64 {
            let Some(Command::Send { bytes, .. }) = t.next().await else { panic!("a packet"); };
            assert_eq!(decoder.receive(&bytes, Instant::now()).unwrap(), vec![42; 1200]);
        }
    }

    #[test]
    fn receive_accepts_peer_datagrams_larger_than_our_outbound_mtu() {
        let t = transport(); let id = route(&t);
        let data = vec![9; 2400]; let frames = framing::encode(&[7; 16], 0, &data, 1272).unwrap();
        assert!(!t.receive(&id, &frames[0]), "unready routes still reject input");
        let remote = t.ready(&id, 1000).unwrap();
        for frame in &frames { assert!(t.receive(&id, frame)); }
        let mut state = t.0.state.lock().unwrap();
        assert_eq!(state.incoming.pop_front().unwrap().bytes, data);
        assert!(state.incoming.is_empty()); drop(state);
        assert!(!t.receive(&id, &[0; 65536]), "outer receive bound remains finite");
        let mut cx = Context::from_waker(Waker::noop());
        assert!(matches!(t.send(&mut cx, &remote, None, &[8; 2400], None), Poll::Ready(Ok(()))));
        let state = t.0.state.lock().unwrap();
        assert!(state.routes[&id].out.iter().all(|frame| frame.len() <= 1000), "outbound MTU remains enforced");
    }

    #[tokio::test]
    async fn signaling_cannot_starve_queued_packets() {
        let t = transport(); let id = route(&t); let addr = t.ready(&id, 1500).unwrap(); t.next().await;
        let mut cx = Context::from_waker(Waker::noop());
        assert!(t.send(&mut cx, &addr, None, &[3; 1200], None).is_ready());
        for _ in 0..32 { assert!(t.signal(&id, Value::Null)); }
        for at in 0..9 {
            if matches!(t.next().await, Some(Command::Send { .. })) { return; }
            assert!(at < 8, "control producer cannot starve data"); assert!(t.signal(&id, Value::Null));
        }
        unreachable!();
    }

    fn route_error(t: &PacketTransport) -> bool { t.open(peer(), Carrier::WebRtc, [9; 16], Value::Null).is_err() }

    #[tokio::test]
    async fn route_limits_distinct_epochs_and_fair_packet_drain() {
        let t = transport(); let mut ids = Vec::new();
        for i in 0..MAX_ROUTES {
            let id = t.open(peer(), Carrier::WebRtc, [i as u8; 16], Value::Null).unwrap();
            t.ready(&id, 1200).unwrap(); ids.push(id); t.next().await;
        }
        assert!(route_error(&t));
        let waker = Waker::noop(); let mut cx = Context::from_waker(waker);
        for id in &ids {
            let addr = t.ready(id, 1200).unwrap();
            assert!(t.send(&mut cx, &addr, None, &[3; 1200], None).is_ready());
        }
        let order = t.0.state.lock().unwrap().routes.keys().cloned().collect::<Vec<_>>();
        for expected in order {
            assert!(matches!(t.next().await, Some(Command::Send { id, .. }) if id == expected));
        }
        t.close();
    }
}
