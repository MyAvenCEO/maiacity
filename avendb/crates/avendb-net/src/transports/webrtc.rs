//! A machine's own WebRTC peer (P8): the data channel a browser opens to reach this node straight, over ICE, in place
//! of the relay. A browser has no UDP of its own, so between a page and the Mac app WebRTC is the only direct way; the
//! Mac's iroh sockets serve its native peers. Like the browser's carrier (`src/lib/avendb/transports/webrtc.js`) it
//! carries only the packets of the same authenticated post-quantum iroh connection, framed and opaque: it grants no
//! peer authority. Its SDP and ICE signals travel solely inside that connection (`control`), so the DTLS fingerprint a
//! browser checks is the one this node's PQ session vouched for; STUN only avenDB's own, no TURN (the relay is the
//! fallback).
use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result, bail, ensure};
use serde_json::{Value, json};
use str0m::change::{SdpAnswer, SdpOffer, SdpPendingOffer};
use str0m::channel::{ChannelConfig, ChannelId, Reliability};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc};
use tokio::net::UdpSocket;
use tokio::sync::mpsc;
use tokio::task::JoinSet;

use super::{Carrier, Command, PacketTransport, RouteId};

/// The one data channel of a route, as the browser's carrier opens and checks it: unordered, never retransmitted.
pub const LABEL: &str = "avendb-iroh-v1";
/// How long a route may take to open its channel, as the browser's carrier allows: then it closes, and the relay stays.
const OPENING: Duration = Duration::from_secs(15);
/// How long it waits for its STUN servers before it offers what it has.
const GATHER: Duration = Duration::from_millis(1500);
/// The outer datagram it reports: one SCTP chunk inside a DTLS record inside a UDP datagram, under any Internet path's
/// MTU, so a lost fragment never takes a whole inner QUIC packet with it.
const MTU: usize = 1100;
/// The most bytes it lets wait in a channel's send buffer: past that, a packet is lost, which inner QUIC recovers.
const BUFFERED: usize = 128 << 10;
const ROUTES: usize = 8;
/// What a route holds for its task at most: packets past it are lost, as on any congested path.
const QUEUE: usize = 256;
const SIGNALS: usize = 128;
const SIGNAL: usize = 16 << 10;
/// The longest datagram it reads.
const DATAGRAM: usize = 2048;

/// What a node's WebRTC peer offers.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Config {
    /// The STUN servers it asks for the address its network shows (`host:port`), avenDB's own (avendb-server's
    /// `stun.rs`); none, and it offers its own addresses alone. `None` is its relay's host on port 3478 (`resolved`).
    pub stun: Option<Vec<String>>,
    /// The addresses it offers as its own: `None` is its machine's, the one of each default route (IPv4 and IPv6); a
    /// test names loopback. None at all, and it offers nothing a peer can reach: its routes time out, the relay stays.
    pub hosts: Option<Vec<IpAddr>>,
}

impl Config {
    /// Its STUN servers named: where unsaid, the relay's host, whose server answers STUN on 3478 (`AVENDB_STUN_BIND`).
    pub fn resolved(mut self, relay: Option<&str>) -> Self {
        if self.stun.is_none() {
            self.stun = Some(relay.map(|host| vec![format!("{host}:3478")]).unwrap_or_default());
        }
        self
    }
}

/// Carries the WebRTC routes of `broker` until it closes: the sole consumer of their commands
/// (`PacketTransport::next_carrier`). Each route reports in `events` as a browser's carrier does, `{kind, route, epoch}`
/// with `ready` and its `mtu`, a `signal` for the peer, or `closed` and why: what `Node::transport_event` takes.
pub async fn serve(broker: PacketTransport, config: Config, events: mpsc::Sender<Value>) {
    let mut routes: BTreeMap<RouteId, mpsc::Sender<Message>> = BTreeMap::new();
    let mut tasks = JoinSet::new();
    while let Some(command) = broker.next_carrier(Carrier::WebRtc).await {
        while tasks.try_join_next().is_some() {}
        routes.retain(|_, route| !route.is_closed());
        match command {
            Command::Open { id, descriptor, .. } => {
                let Some(initiator) = descriptor["initiator"].as_bool() else {
                    broker.close_route(&id);
                    continue;
                };
                if routes.len() >= ROUTES {
                    broker.close_route(&id);
                    continue;
                }
                let (to, from) = mpsc::channel(QUEUE);
                routes.insert(id.clone(), to);
                tasks.spawn(route(id, initiator, config.clone(), broker.clone(), from, events.clone()));
            }
            // a full queue is loss, which inner QUIC recovers
            Command::Send { id, bytes } => {
                if let Some(route) = routes.get(&id) {
                    let _ = route.try_send(Message::Packet(bytes));
                }
            }
            Command::Signal { id, signal } => {
                if let Some(route) = routes.get(&id)
                    && route.try_send(Message::Signal(signal)).is_err()
                {
                    routes.remove(&id);
                    broker.close_route(&id);
                }
            }
            // its sender dropped, its task ends and lets its sockets go
            Command::Close { id } => {
                routes.remove(&id);
            }
        }
    }
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
}

enum Message {
    Packet(Vec<u8>),
    Signal(Value),
}

/// The event a route reports, as a browser's carrier does.
fn event(id: &RouteId, mut value: Value) -> Value {
    value["route"] = json!(id.route);
    value["epoch"] = json!(id.epoch);
    value
}

async fn route(
    id: RouteId,
    initiator: bool,
    config: Config,
    broker: PacketTransport,
    mut from: mpsc::Receiver<Message>,
    events: mpsc::Sender<Value>,
) {
    let why = match Route::run(&id, initiator, &config, &broker, &mut from, &events).await {
        Ok(()) => "closed".to_string(),
        Err(error) => format!("{error:#}").chars().take(160).collect(),
    };
    let _ = events.send(event(&id, json!({"kind": "closed", "reason": why}))).await;
}

/// The local addresses it offers: the one of each default route, which a connected UDP socket learns without sending.
fn hosts() -> Vec<IpAddr> {
    let probe = |bind: SocketAddr, to: SocketAddr| {
        let socket = std::net::UdpSocket::bind(bind).ok()?;
        socket.connect(to).ok()?;
        Some(socket.local_addr().ok()?.ip())
    };
    let v4 = probe((Ipv4Addr::UNSPECIFIED, 0).into(), (Ipv4Addr::new(192, 0, 2, 1), 9).into());
    let v6 = probe((Ipv6Addr::UNSPECIFIED, 0).into(), ("2001:db8::1".parse::<Ipv6Addr>().expect("an address"), 9).into());
    // a link-local IPv6 address needs its scope, which no candidate carries
    [v4, v6.filter(|ip| !matches!(ip, IpAddr::V6(v6) if (v6.segments()[0] & 0xffc0) == 0xfe80))]
        .into_iter()
        .flatten()
        .filter(|ip| !ip.is_unspecified())
        .collect()
}

/// A STUN Binding request (RFC 8489), with no attributes, and its transaction id.
fn binding() -> Result<([u8; 12], Vec<u8>)> {
    let mut id = [0; 12];
    getrandom::fill(&mut id).map_err(anyhow::Error::msg)?;
    let mut request = vec![0x00, 0x01, 0x00, 0x00, 0x21, 0x12, 0xa4, 0x42];
    request.extend_from_slice(&id);
    Ok((id, request))
}

/// The XOR-MAPPED-ADDRESS of a Binding success answering transaction `id`, if `packet` is one.
fn mapped(packet: &[u8], id: &[u8; 12]) -> Option<SocketAddr> {
    const COOKIE: [u8; 4] = [0x21, 0x12, 0xa4, 0x42];
    if packet.len() < 20 || packet[0..2] != [0x01, 0x01] || packet[4..8] != COOKIE || packet[8..20] != id[..] {
        return None;
    }
    let length = u16::from_be_bytes([packet[2], packet[3]]) as usize;
    let mut rest = packet.get(20..20 + length)?;
    while rest.len() >= 4 {
        let (kind, size) = (u16::from_be_bytes([rest[0], rest[1]]), u16::from_be_bytes([rest[2], rest[3]]) as usize);
        let value = rest.get(4..4 + size)?;
        if kind == 0x0020 && value.len() >= 8 {
            let port = u16::from_be_bytes([value[2], value[3]]) ^ 0x2112;
            let ip = match (value[1], value.len()) {
                (1, 8) => {
                    let octets: Vec<u8> = value[4..8].iter().zip(COOKIE).map(|(a, b)| a ^ b).collect();
                    IpAddr::from(<[u8; 4]>::try_from(octets).ok()?)
                }
                (2, 20) => {
                    let key = COOKIE.iter().chain(id.iter());
                    let octets: Vec<u8> = value[4..20].iter().zip(key).map(|(a, b)| a ^ b).collect();
                    IpAddr::from(<[u8; 16]>::try_from(octets).ok()?)
                }
                _ => return None,
            };
            return Some(SocketAddr::new(ip, port));
        }
        rest = rest.get((4 + size).div_ceil(4) * 4..).unwrap_or_default();
    }
    None
}

/// A remote SDP without the candidates no machine can reach: a browser's mDNS names (`….local`), which its SDP
/// parser refuses. The peer's reflexive candidates, and the peer-reflexive ones its checks show, still reach it.
fn reachable(sdp: &str) -> String {
    sdp.split_inclusive('\n')
        .filter(|line| match line.strip_prefix("a=candidate:") {
            Some(rest) => rest.split_whitespace().nth(4).is_some_and(|addr| addr.parse::<IpAddr>().is_ok()),
            None => true,
        })
        .collect()
}

/// The media section id (`a=mid:`) of the data channel in a description it sent: str0m names it at random when it
/// offers (`Mid::new`, three letters), the browser's own when it answers.
fn mid(sdp: &str) -> Option<&str> {
    sdp.lines().find_map(|line| line.trim_end().strip_prefix("a=mid:"))
}

/// One of its candidates as a browser signals one (`RTCIceCandidateInit`), for the media section `mid` names. A
/// candidate for a section its description has none of is refused: Safari's `addIceCandidate` threw "Error processing
/// ICE candidate" every 31 s on the iPhone while the Mac offered with a random mid and trickled for mid "0" (batch 4
/// round, 2026-10-27), so no Mac-to-iPhone route ever opened. Without a mid, the first section's index alone.
fn trickled(candidate: &Candidate, mid: Option<&str>) -> Value {
    let mut init = json!({"candidate": candidate.to_sdp_string(), "sdpMLineIndex": 0});
    if let Some(mid) = mid {
        init["sdpMid"] = json!(mid);
    }
    json!({"candidate": init})
}

/// A remote candidate as a browser signals it (`RTCIceCandidate.toJSON()`), if a machine can reach it.
fn candidate(signal: &Value) -> Option<Candidate> {
    let text = signal["candidate"]["candidate"].as_str()?;
    if text.is_empty() || text.len() > 4096 {
        return None;
    }
    Candidate::from_sdp_string(text.strip_prefix("a=").unwrap_or(text)).ok()
}

struct Route<'a> {
    id: &'a RouteId,
    rtc: Rtc,
    sockets: Vec<UdpSocket>,
    events: &'a mpsc::Sender<Value>,
    sent: usize,
}

impl<'a> Route<'a> {
    async fn run(
        id: &'a RouteId,
        initiator: bool,
        config: &Config,
        broker: &PacketTransport,
        from: &mut mpsc::Receiver<Message>,
        events: &'a mpsc::Sender<Value>,
    ) -> Result<()> {
        let opening = tokio::time::Instant::now() + OPENING;
        let mut sockets = Vec::new();
        for ip in config.hosts.clone().unwrap_or_else(hosts) {
            if let Ok(socket) = UdpSocket::bind(SocketAddr::new(ip, 0)).await {
                sockets.push(socket);
            }
        }
        let rtc = Rtc::builder().build(Instant::now());
        let mut route = Route { id, rtc, sockets, events, sent: 0 };
        let mut offered = Vec::new();
        for socket in &route.sockets {
            let local = socket.local_addr()?;
            if let Some(added) = route.rtc.add_local_candidate(Candidate::host(local, "udp")?) {
                offered.push(added.clone());
            }
        }
        for srflx in route.gather(config.stun.as_deref().unwrap_or_default()).await {
            if let Some(added) = route.rtc.add_local_candidate(srflx) {
                offered.push(added.clone());
            }
        }
        // the offer, or the answer once the peer's offer is in
        let mut pending: Option<SdpPendingOffer> = None;
        let mut channel: Option<ChannelId> = None;
        let mut described = false;
        let mut early: Vec<Candidate> = Vec::new();
        if initiator {
            let mut api = route.rtc.sdp_api();
            api.add_channel_with_config(ChannelConfig {
                label: LABEL.into(),
                ordered: false,
                reliability: Reliability::MaxRetransmits { retransmits: 0 },
                negotiated: None,
                protocol: String::new(),
            });
            let (offer, waiting) = api.apply().context("no RTC offer")?;
            pending = Some(waiting);
            let sdp = offer.to_sdp_string();
            route.signal(json!({"description": {"type": "offer", "sdp": sdp}})).await?;
            route.trickle(&offered, mid(&sdp)).await?;
        }
        let mut buf = vec![0u8; DATAGRAM];
        let mut buf6 = vec![0u8; DATAGRAM];
        loop {
            let timeout = route.drive(&mut channel, broker).await?;
            let wake = tokio::time::Instant::from_std(timeout.max(Instant::now()));
            let (first, second) = (route.sockets.first(), route.sockets.get(1));
            tokio::select! {
                _ = tokio::time::sleep_until(opening), if channel.is_none() => bail!("RTC opening timed out"),
                _ = tokio::time::sleep_until(wake) => route.rtc.handle_input(Input::Timeout(Instant::now()))?,
                received = recv(first, &mut buf) => if let Some((n, source, local)) = received { route.receive(source, local, &buf[..n]); },
                received = recv(second, &mut buf6) => if let Some((n, source, local)) = received { route.receive(source, local, &buf6[..n]); },
                message = from.recv() => match message {
                    // the route closed: its sockets go with it
                    None => return Ok(()),
                    Some(Message::Packet(bytes)) => {
                        if let Some(mut open) = channel.and_then(|c| route.rtc.channel(c))
                            && open.buffered_amount() + bytes.len() <= BUFFERED
                        {
                            // false: no room, a lost packet
                            let _ = open.write(true, &bytes)?;
                        }
                    }
                    Some(Message::Signal(signal)) => {
                        ensure!(serde_json::to_vec(&signal)?.len() <= SIGNAL, "RTC signal too large");
                        if let Some(description) = signal.get("description") {
                            ensure!(!described, "a second RTC description");
                            let (kind, sdp) = (description["type"].as_str(), description["sdp"].as_str().context("RTC SDP")?);
                            ensure!(sdp.len() <= SIGNAL, "RTC SDP too large");
                            let sdp = reachable(sdp);
                            if initiator {
                                ensure!(kind == Some("answer"), "invalid RTC description");
                                let answer = SdpAnswer::from_sdp_string(&sdp).context("RTC answer")?;
                                route.rtc.sdp_api().accept_answer(pending.take().context("no RTC offer")?, answer)?;
                            } else {
                                ensure!(kind == Some("offer"), "invalid RTC description");
                                let offer = SdpOffer::from_sdp_string(&sdp).context("RTC offer")?;
                                let answer = route.rtc.sdp_api().accept_offer(offer)?.to_sdp_string();
                                route.signal(json!({"description": {"type": "answer", "sdp": answer}})).await?;
                                route.trickle(&offered, mid(&answer)).await?;
                            }
                            described = true;
                            for candidate in early.drain(..) { route.rtc.add_remote_candidate(candidate); }
                        } else if signal.get("candidate").is_some() {
                            // null: the peer's candidates are all in; one it can't reach (mDNS) is left out
                            if let Some(candidate) = candidate(&signal) {
                                ensure!(early.len() < SIGNALS, "RTC candidates");
                                if described { route.rtc.add_remote_candidate(candidate) } else { early.push(candidate) }
                            }
                        } else {
                            bail!("invalid RTC signal");
                        }
                    }
                },
            }
        }
    }

    /// Its server-reflexive candidates: the address each of its sockets shows the STUN servers, as they answer within
    /// `GATHER`. None where none answers, or where it shows its own address.
    async fn gather(&self, servers: &[String]) -> Vec<Candidate> {
        let mut servers_at = Vec::new();
        for server in servers.iter().take(4) {
            if let Ok(Ok(found)) = tokio::time::timeout(GATHER, tokio::net::lookup_host(server.as_str())).await {
                servers_at.extend(found.take(4));
            }
        }
        let mut asked = Vec::new();
        for (index, socket) in self.sockets.iter().enumerate() {
            let Ok(local) = socket.local_addr() else { continue };
            for server in servers_at.iter().filter(|s| s.is_ipv4() == local.is_ipv4()) {
                if let Ok((id, request)) = binding()
                    && socket.send_to(&request, server).await.is_ok()
                {
                    asked.push((index, id));
                }
            }
        }
        let mut found: Vec<Candidate> = Vec::new();
        let deadline = tokio::time::Instant::now() + GATHER;
        let mut buf = [0u8; 576];
        for (index, socket) in self.sockets.iter().enumerate() {
            let Ok(local) = socket.local_addr() else { continue };
            let ids: Vec<_> = asked.iter().filter(|(i, _)| *i == index).map(|(_, id)| *id).collect();
            let mut answered = 0;
            while answered < ids.len() {
                let Ok(Ok((n, _))) = tokio::time::timeout_at(deadline, socket.recv_from(&mut buf)).await else { break };
                let Some(addr) = ids.iter().find_map(|id| mapped(&buf[..n], id)) else { continue };
                answered += 1;
                if addr != local
                    && !found.iter().any(|c| c.addr() == addr)
                    && let Ok(candidate) = Candidate::server_reflexive(addr, local, "udp")
                {
                    found.push(candidate);
                }
            }
        }
        found
    }

    /// Sends one signal to the peer, in order, through the authenticated session (`control::browser_event`).
    async fn signal(&mut self, signal: Value) -> Result<()> {
        ensure!(self.sent < SIGNALS, "RTC signaling overflow");
        self.sent += 1;
        self.events.send(event(self.id, json!({"kind": "signal", "signal": signal}))).await.ok().context("node closed")
    }

    /// Its candidates again, one by one, as a browser trickles them, for a peer that reads none in the SDP: each for
    /// the data channel's media section, `mid` of its own description (`trickled`).
    async fn trickle(&mut self, candidates: &[Candidate], mid: Option<&str>) -> Result<()> {
        for c in candidates {
            self.signal(trickled(c, mid)).await?;
        }
        self.signal(json!({"candidate": null})).await
    }

    fn receive(&mut self, source: SocketAddr, local: SocketAddr, bytes: &[u8]) {
        let Ok(receive) = Receive::new(Protocol::Udp, source, local, bytes) else { return };
        let input = Input::Receive(Instant::now(), receive);
        // a late STUN answer, or a stranger's datagram, is not this route's
        if self.rtc.accepts(&input) {
            let _ = self.rtc.handle_input(input);
        }
    }

    /// Everything its WebRTC instance has to send or tell, done: when it wants to be woken next.
    async fn drive(&mut self, channel: &mut Option<ChannelId>, broker: &PacketTransport) -> Result<Instant> {
        loop {
            match self.rtc.poll_output()? {
                Output::Timeout(at) => return Ok(at),
                Output::Transmit(transmit) => {
                    if let Some(socket) = self.sockets.iter().find(|s| s.local_addr().is_ok_and(|a| a == transmit.source)) {
                        let _ = socket.try_send_to(&transmit.contents, transmit.destination);
                    }
                }
                Output::Event(Event::ChannelOpen(id, label)) => {
                    let config = self.rtc.channel(id).and_then(|c| c.config().cloned());
                    let expected = config.is_some_and(|c| {
                        !c.ordered && c.reliability == Reliability::MaxRetransmits { retransmits: 0 }
                    });
                    ensure!(channel.is_none() && label == LABEL && expected, "unexpected RTC channel");
                    *channel = Some(id);
                    self.events
                        .send(event(self.id, json!({"kind": "ready", "mtu": MTU})))
                        .await
                        .ok()
                        .context("node closed")?;
                }
                Output::Event(Event::ChannelData(data)) => {
                    if Some(data.id) == *channel && data.binary && !data.data.is_empty() && data.data.len() <= 65_535 {
                        broker.receive(self.id, &data.data);
                    }
                }
                Output::Event(Event::ChannelClose(id)) if Some(id) == *channel => bail!("RTC channel closed"),
                Output::Event(Event::IceConnectionStateChange(IceConnectionState::Disconnected)) => bail!("RTC disconnected"),
                Output::Event(Event::Closed) => bail!("RTC closed"),
                Output::Event(_) => {}
            }
        }
    }
}

/// A datagram on `socket`, and where it came from and to; never, without a socket.
async fn recv(socket: Option<&UdpSocket>, buf: &mut [u8]) -> Option<(usize, SocketAddr, SocketAddr)> {
    let Some(socket) = socket else { return std::future::pending().await };
    let (n, source) = socket.recv_from(buf).await.ok()?;
    Some((n, source, socket.local_addr().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stun_answers_are_read_for_their_own_transaction_alone() {
        let id = [7; 12];
        // as avendb-server's responder answers 203.0.113.9:40000
        let mut answer = vec![0x01, 0x01, 0x00, 0x0c, 0x21, 0x12, 0xa4, 0x42];
        answer.extend_from_slice(&id);
        answer.extend_from_slice(&[0x00, 0x20, 0x00, 0x08, 0x00, 0x01]);
        answer.extend_from_slice(&(40000u16 ^ 0x2112).to_be_bytes());
        answer.extend([203, 0, 113, 9].iter().zip([0x21, 0x12, 0xa4, 0x42]).map(|(a, b)| a ^ b));
        assert_eq!(mapped(&answer, &id), Some("203.0.113.9:40000".parse().unwrap()));
        assert_eq!(mapped(&answer, &[8; 12]), None, "another transaction's answer");
        assert_eq!(mapped(&answer[..24], &id), None, "cut short");
        let (asked, request) = binding().unwrap();
        assert_eq!(request.len(), 20);
        assert_eq!(&request[8..], &asked);
    }

    #[test]
    fn a_browsers_mdns_candidates_are_left_out_and_its_addresses_kept() {
        let sdp = "v=0\r\na=candidate:1 1 udp 2113937151 0b1d1f.local 54321 typ host\r\na=candidate:2 1 udp 1677729535 198.51.100.7 54321 typ srflx raddr 0.0.0.0 rport 0\r\na=mid:0\r\n";
        assert_eq!(reachable(sdp), "v=0\r\na=candidate:2 1 udp 1677729535 198.51.100.7 54321 typ srflx raddr 0.0.0.0 rport 0\r\na=mid:0\r\n");
        let named = json!({"candidate": {"candidate": "candidate:1 1 udp 2113937151 0b1d1f.local 54321 typ host", "sdpMid": "0"}});
        assert!(candidate(&named).is_none());
        let seen = json!({"candidate": {"candidate": "candidate:2 1 udp 1677729535 198.51.100.7 54321 typ srflx raddr 0.0.0.0 rport 0", "sdpMid": "0"}});
        assert_eq!(candidate(&seen).unwrap().addr(), "198.51.100.7:54321".parse().unwrap());
        assert!(candidate(&json!({"candidate": null})).is_none());
    }

    /// Its trickled candidates name the media section of the description it sent, as the browser's
    /// `addIceCandidate` requires, whether it offered (a mid of str0m's, at random) or answered (the browser's).
    #[test]
    fn its_candidates_name_its_own_descriptions_section() {
        let mut rtc = Rtc::builder().build(Instant::now());
        let host = Candidate::host("192.0.2.4:50000".parse().unwrap(), "udp").unwrap();
        rtc.add_local_candidate(host.clone());
        let mut api = rtc.sdp_api();
        api.add_channel_with_config(ChannelConfig {
            label: LABEL.into(),
            ordered: false,
            reliability: Reliability::MaxRetransmits { retransmits: 0 },
            negotiated: None,
            protocol: String::new(),
        });
        let (offer, _) = api.apply().unwrap();
        let sdp = offer.to_sdp_string();
        let section = mid(&sdp).expect("the offer's data channel section");
        assert_eq!(sdp.matches(&format!("a=mid:{section}")).count(), 1);
        let signal = trickled(&host, Some(section));
        assert_eq!(signal["candidate"]["sdpMid"], section);
        assert_eq!(signal["candidate"]["sdpMLineIndex"], 0);
        assert_eq!(candidate(&signal).unwrap().addr(), host.addr(), "a peer reads it back");
        // answering a browser's offer: the browser's own section id
        let browser = "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=mid:0\r\n";
        assert_eq!(trickled(&host, mid(browser))["candidate"]["sdpMid"], "0");
        assert!(trickled(&host, None)["candidate"].get("sdpMid").is_none());
    }

    #[test]
    fn stun_defaults_to_the_relays_own_server() {
        assert_eq!(Config::default().resolved(Some("avendb.maia.city")).stun, Some(vec!["avendb.maia.city:3478".into()]));
        assert_eq!(Config { stun: Some(vec![]), hosts: None }.resolved(Some("avendb.maia.city")).stun, Some(vec![]));
        assert_eq!(Config::default().resolved(None).stun, Some(vec![]));
    }
}
