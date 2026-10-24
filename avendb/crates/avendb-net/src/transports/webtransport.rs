//! Native HTTP/3 carrier for already-authenticated avenDB peers. The ticket admits one outer connection;
//! iroh's PQ handshake and exporter-bound Hello still authenticate every inner application connection.
use std::collections::{BTreeMap, BTreeSet};
use std::future::{Future, IntoFuture};
use std::pin::Pin;
use std::io;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::time::Duration;

use iroh::EndpointId;
use iroh_base::CustomAddr;
use serde_json::{Value, json};
use tokio::sync::{mpsc, watch, Semaphore};
use tokio::task::{JoinHandle, JoinSet};
use tokio::time::{Instant, timeout};
use url::Url;
use wtransport::{Connection, Identity, ServerConfig, VarInt, quinn};
use wtransport::endpoint::IncomingSessionFuture;
use wtransport::tls::self_signed::time::{Duration as WallDuration, OffsetDateTime};

use super::{Carrier, Command, PacketTransport, RouteId};

const MAX_ROUTES: usize = 8;
const MAX_HANDSHAKES: usize = 8;
const TICKET_LIFETIME: Duration = Duration::from_secs(60);
const LEASE: Duration = Duration::from_secs(6 * 3600);
const HANDSHAKE: Duration = Duration::from_secs(10);
const ROTATION: Duration = Duration::from_secs(6 * 86400);
const CLOSE: VarInt = VarInt::from_u32(0);

/// Explicit UDP listener/public HTTPS URL; the existing Caddy TLS configuration is unrelated and unchanged.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub bind: SocketAddr,
    pub public_url: String,
    pub allowed_origins: Vec<String>,
}

#[derive(Clone, Debug)]
pub enum WtEvent {
    Ready { id: RouteId, peer: EndpointId, address: CustomAddr },
    Closed { id: RouteId, peer: EndpointId },
}

/// Send the descriptor only through the authenticated capability exchange, never logs or public discovery.
pub struct Reservation {
    pub id: RouteId,
    pub descriptor: Value,
}

struct Certificate {
    identity: Identity,
    expires: i64,
}
impl Certificate {
    fn generate(host: &str, now: OffsetDateTime) -> io::Result<Self> {
        // Including clock skew, validity remains strictly below the browser's fourteen-day limit.
        let expires = now + WallDuration::days(13);
        let identity = Identity::self_signed_builder().subject_alt_names([host])
            .validity_period(now - WallDuration::minutes(5), expires).build().map_err(io::Error::other)?;
        Ok(Self { identity, expires: expires.unix_timestamp() })
    }
    fn hash(&self) -> String {
        data_encoding::HEXLOWER.encode(self.identity.certificate_chain().as_slice()[0].hash().as_ref())
    }
}
struct Certificates {
    current: Certificate,
    next: Certificate,
    rotate_at: Instant,
}
struct Route {
    peer: EndpointId,
    ticket: Option<String>,
    admit_until: Instant,
    expires: Instant,
    expires_unix: i64,
    connection: Option<Connection>,
    closed_event: mpsc::OwnedPermit<WtEvent>,
}
struct State {
    certificates: Certificates,
    routes: BTreeMap<RouteId, Route>,
}
struct Inner {
    config: Config,
    url: Url,
    authority: String,
    host: String,
    origins: BTreeSet<String>,
    endpoint: Mutex<Option<quinn::Endpoint>>,
    runtime: Arc<JoinedRuntime>,
    broker: PacketTransport,
    events: mpsc::Sender<WtEvent>,
    state: Mutex<State>,
    closed: AtomicBool,
    stop: watch::Sender<bool>,
}

/// The sole native consumer of `PacketTransport::next`. Do not also run the browser broker pump on this node.
pub struct NativeWt {
    inner: Arc<Inner>,
    task: Mutex<Option<JoinHandle<()>>>,
    ending: tokio::sync::Mutex<()>,
}

/// Quinn's default runtime detaches its endpoint driver. Dropping the last endpoint
/// only wakes that driver; wait_idle covers connections, not UDP socket release.
/// Retain completion handles so awaited shutdown includes the actual driver drop.
#[derive(Debug, Default)]
struct JoinedRuntime { tasks: Mutex<JoinSet<()>> }
impl quinn::Runtime for JoinedRuntime {
    fn new_timer(&self, at: std::time::Instant) -> Pin<Box<dyn quinn::AsyncTimer>> {
        quinn::Runtime::new_timer(&quinn::TokioRuntime, at)
    }
    fn spawn(&self, future: Pin<Box<dyn Future<Output = ()> + Send>>) {
        let mut tasks = self.tasks.lock().expect("WT runtime");
        while tasks.try_join_next().is_some() {}
        tasks.spawn(future);
    }
    fn wrap_udp_socket(&self, socket: std::net::UdpSocket) -> io::Result<Arc<dyn quinn::AsyncUdpSocket>> {
        quinn::Runtime::wrap_udp_socket(&quinn::TokioRuntime, socket)
    }
}
impl JoinedRuntime {
    async fn joined(&self) {
        // Keep ownership in the runtime across cancellation of a shutdown caller.
        // A driver may spawn more work while finishing; it enters this same set.
        std::future::poll_fn(|cx| {
            let mut tasks = self.tasks.lock().expect("WT runtime");
            loop {
                match tasks.poll_join_next(cx) {
                    std::task::Poll::Ready(Some(_)) => continue,
                    std::task::Poll::Ready(None) => return std::task::Poll::Ready(()),
                    std::task::Poll::Pending => return std::task::Poll::Pending,
                }
            }
        }).await;
    }
}

fn invalid(message: &'static str) -> io::Error { io::Error::new(io::ErrorKind::InvalidInput, message) }
fn disconnected() -> io::Error { io::Error::new(io::ErrorKind::NotConnected, "WebTransport listener closed") }

fn tls_config(bind: SocketAddr, certificate: &Certificate) -> io::Result<ServerConfig> {
    let certs = certificate.identity.certificate_chain().as_slice().iter()
        .map(|c| rustls::pki_types::CertificateDer::from(c.der().to_vec())).collect();
    let key = rustls::pki_types::PrivatePkcs8KeyDer::from(certificate.identity.private_key().secret_der().to_vec()).into();
    let mut tls = rustls::ServerConfig::builder_with_provider(crate::pq_provider())
        .with_protocol_versions(&[&rustls::version::TLS13]).map_err(io::Error::other)?
        .with_no_client_auth().with_single_cert(certs, key).map_err(io::Error::other)?;
    tls.alpn_protocols = vec![wtransport::proto::WEBTRANSPORT_ALPN.to_vec()];
    let mut transport = wtransport::quinn::TransportConfig::default();
    transport.max_concurrent_bidi_streams(1u32.into()).max_concurrent_uni_streams(3u32.into())
        .stream_receive_window((64u32 << 10).into()).receive_window((256u32 << 10).into())
        .send_window(128 << 10).datagram_receive_buffer_size(Some(128 << 10)).datagram_send_buffer_size(128 << 10)
        .max_idle_timeout(Some(Duration::from_secs(30).try_into().map_err(io::Error::other)?))
        .keep_alive_interval(Some(Duration::from_secs(10)));
    let mut config = ServerConfig::builder().with_bind_address(bind).with_custom_tls_and_transport(tls, transport).build();
    config.quic_config_mut().max_incoming(MAX_HANDSHAKES).incoming_buffer_size(64 << 10).incoming_buffer_size_total(512 << 10);
    Ok(config)
}

impl Config {
    /// Validate configured URL and exact Origins before opening any store or listening socket.
    pub fn validate(&self) -> io::Result<()> { self.parsed().map(|_| ()) }

    fn parsed(&self) -> io::Result<(Url, BTreeSet<String>, String)> {
        let url = Url::parse(&self.public_url).map_err(|_| invalid("invalid WebTransport public URL"))?;
        if self.public_url.len() > 2048 || url.scheme() != "https" || url.host_str().is_none()
            || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some()
            || self.allowed_origins.is_empty() || self.allowed_origins.len() > 16 {
            return Err(invalid("invalid WebTransport listener configuration"));
        }
        let origins: BTreeSet<_> = self.allowed_origins.iter().map(|origin| {
            let parsed = Url::parse(origin).map_err(|_| invalid("invalid WebTransport Origin"))?;
            if origin.len() > 512 || parsed.origin().ascii_serialization() != *origin || parsed.host_str().is_none() {
                return Err(invalid("WebTransport Origin must be exact origin"));
            }
            Ok(origin.clone())
        }).collect::<io::Result<_>>()?;
        let host = match url.host().ok_or_else(|| invalid("missing WebTransport host"))? {
            url::Host::Domain(name) => name.to_owned(), url::Host::Ipv4(ip) => ip.to_string(), url::Host::Ipv6(ip) => ip.to_string(),
        };
        Ok((url, origins, host))
    }
}

impl NativeWt {
    pub async fn bind(config: Config, broker: PacketTransport, events: mpsc::Sender<WtEvent>) -> io::Result<Self> {
        let (mut url, origins, host) = config.parsed()?;
        if events.max_capacity() < 2 * MAX_ROUTES { return Err(invalid("WebTransport event capacity")); }
        let now = OffsetDateTime::now_utc();
        let certificates = Certificates { current: Certificate::generate(&host, now)?, next: Certificate::generate(&host, now)?, rotate_at: Instant::now() + ROTATION };
        let tls = tls_config(config.bind, &certificates.current)?;
        let runtime = Arc::new(JoinedRuntime::default());
        let endpoint = quinn::Endpoint::new(tls.quic_endpoint_config().clone(), Some(tls.quic_config().clone()),
            std::net::UdpSocket::bind(config.bind)?, runtime.clone())?;
        if url.port() == Some(0) { url.set_port(Some(endpoint.local_addr()?.port())).map_err(|_| invalid("invalid listener port"))?; }
        let authority = url[url::Position::BeforeHost..url::Position::AfterPort].to_owned();
        let (stop, stopped) = watch::channel(false);
        let inner = Arc::new(Inner { config, url, authority, host, origins, endpoint: Mutex::new(Some(endpoint)), runtime, broker, events,
            state: Mutex::new(State { certificates, routes: BTreeMap::new() }), closed: AtomicBool::new(false), stop });
        let task = tokio::spawn(serve(inner.clone(), stopped));
        Ok(Self { inner, task: Mutex::new(Some(task)), ending: tokio::sync::Mutex::new(()) })
    }

    pub fn local_addr(&self) -> io::Result<SocketAddr> { self.inner.endpoint()?.local_addr() }

    /// The caller already proved `peer` and negotiated `wire_epoch` over the exporter-bound PQ session.
    pub fn reserve(&self, peer: EndpointId, wire_epoch: [u8; 16]) -> io::Result<Reservation> {
        if self.inner.closed.load(Ordering::Acquire) { return Err(disconnected()); }
        self.inner.rotate(OffsetDateTime::now_utc(), Instant::now())?;
        let mut state = self.inner.state.lock().expect("WT state");
        if self.inner.closed.load(Ordering::Acquire) { return Err(disconnected()); }
        if state.routes.len() >= MAX_ROUTES { return Err(io::Error::new(io::ErrorKind::WouldBlock, "WebTransport route limit")); }
        let mut bytes = [0u8; 32]; getrandom::fill(&mut bytes).map_err(io::Error::other)?;
        let ticket = data_encoding::HEXLOWER.encode(&bytes);
        let mut url = self.inner.url.clone();
        url.set_path(&format!("{}/{}", url.path().trim_end_matches('/'), ticket));
        let expires = (OffsetDateTime::now_utc() + WallDuration::seconds(LEASE.as_secs() as i64)).unix_timestamp();
        let descriptor = json!({"url": url.as_str(), "certificateHashes": [state.certificates.current.hash(), state.certificates.next.hash()], "expires": expires});
        // Reserve teardown credit before admission. Slow control consumers backpressure new routes;
        // every admitted route can still remove its lookup address without an unbounded event queue.
        let closed_event = self.inner.events.clone().try_reserve_owned().map_err(|error| match error {
            mpsc::error::TrySendError::Full(_) => io::Error::new(io::ErrorKind::WouldBlock, "WebTransport event limit"),
            mpsc::error::TrySendError::Closed(_) => disconnected(),
        })?;
        let id = self.inner.broker.open(peer, Carrier::WebTransport, wire_epoch, Value::Null)?;
        let now = Instant::now();
        state.routes.insert(id.clone(), Route { peer, ticket: Some(ticket), admit_until: now + TICKET_LIFETIME,
            expires: now + LEASE, expires_unix: expires, connection: None, closed_event });
        Ok(Reservation { id, descriptor })
    }

    /// Synchronous signal; the supervisor drops its accept future before closing the HTTP/3 endpoint.
    pub fn close(&self) { self.inner.closed.store(true, Ordering::Release); let _ = self.inner.stop.send(true); }

    pub async fn shutdown(&self) {
        let _ending = self.ending.lock().await;
        self.close();
        std::future::poll_fn(|cx| {
            let mut task = self.task.lock().expect("WT task");
            let Some(handle) = task.as_mut() else { return std::task::Poll::Ready(()); };
            if Pin::new(handle).poll(cx).is_pending() { return std::task::Poll::Pending; }
            task.take();
            std::task::Poll::Ready(())
        }).await;
        drop(self.inner.endpoint.lock().expect("WT endpoint").take());
        self.inner.runtime.joined().await;
    }
}
impl Drop for NativeWt { fn drop(&mut self) { self.close(); } }

impl Inner {
    fn endpoint(&self) -> io::Result<quinn::Endpoint> {
        self.endpoint.lock().expect("WT endpoint").clone().ok_or_else(disconnected)
    }
    fn rotate(&self, now: OffsetDateTime, at: Instant) -> io::Result<()> {
        let mut state = self.state.lock().expect("WT state");
        let certificates = &mut state.certificates;
        if at < certificates.rotate_at && certificates.current.expires > now.unix_timestamp() + LEASE.as_secs() as i64 { return Ok(()); }
        let next = Certificate::generate(&self.host, now)?;
        // On a large wall-clock jump both old certificates may be invalid; fresh negotiation restores pins.
        let fresh = if certificates.next.expires <= now.unix_timestamp() + LEASE.as_secs() as i64 {
            Some(Certificate::generate(&self.host, now)?)
        } else { None };
        let current = fresh.as_ref().unwrap_or(&certificates.next);
        self.endpoint()?.set_server_config(Some(tls_config(self.config.bind, current)?.quic_config().clone()));
        let promoted = std::mem::replace(&mut certificates.next, next);
        certificates.current = fresh.unwrap_or(promoted);
        // The promoted certificate and the next pin overlap across a rotation boundary.
        certificates.rotate_at = at + ROTATION;
        Ok(())
    }

    fn finish(&self, id: &RouteId) {
        let route = self.state.lock().expect("WT state").routes.remove(id);
        self.broker.close_route(id);
        if let Some(route) = route {
            if let Some(connection) = route.connection { connection.close(CLOSE, b"carrier closed"); }
            route.closed_event.send(WtEvent::Closed { id: id.clone(), peer: route.peer });
        }
    }

    fn expire(&self, now: Instant, unix: i64) {
        let ids: Vec<_> = self.state.lock().expect("WT state").routes.iter().filter_map(|(id, route)| {
            (route.expires <= now || route.expires_unix <= unix || (route.connection.is_none() && route.admit_until <= now)).then_some(id.clone())
        }).collect();
        for id in ids { self.finish(&id); }
    }

    fn take_ticket(&self, path: &str, now: Instant) -> Option<RouteId> {
        let prefix = format!("{}/", self.url.path().trim_end_matches('/'));
        let ticket = path.strip_prefix(&prefix)?;
        if ticket.len() != 64 || !ticket.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) { return None; }
        let mut state = self.state.lock().expect("WT state");
        let (id, route) = state.routes.iter_mut().find(|(_, route)| route.ticket.as_deref() == Some(ticket) && route.admit_until > now)?;
        route.ticket = None;
        Some(id.clone())
    }
}

async fn stopped(stop: &mut watch::Receiver<bool>) {
    if *stop.borrow() { return; }
    let _ = stop.changed().await;
}

async fn serve(inner: Arc<Inner>, mut stop: watch::Receiver<bool>) {
    let Ok(endpoint) = inner.endpoint() else { return; };
    let permits = Arc::new(Semaphore::new(MAX_HANDSHAKES));
    let mut sessions = JoinSet::new();
    let mut maintenance = tokio::time::interval(Duration::from_secs(10));
    loop {
        // Fair selection keeps packet traffic from starving admission or completed-session cleanup.
        tokio::select! {
            _ = stopped(&mut stop) => break,
            _ = maintenance.tick() => {
                let now = OffsetDateTime::now_utc();
                inner.expire(Instant::now(), now.unix_timestamp());
                if inner.rotate(now, Instant::now()).is_err() { break; }
            },
            Some(_) = sessions.join_next(), if !sessions.is_empty() => {},
            command = inner.broker.next() => {
                let Some(command) = command else { break; };
                match command {
                    Command::Send { id, bytes } => {
                        let connection = inner.state.lock().expect("WT state").routes.get(&id).and_then(|r| r.connection.clone());
                        if let Some(connection) = connection { if connection.send_datagram(&bytes).is_err() { inner.finish(&id); } }
                    },
                    Command::Close { id } => inner.finish(&id),
                    Command::Open { id, carrier: Carrier::WebTransport, .. } => {
                        if !inner.state.lock().expect("WT state").routes.contains_key(&id) { inner.broker.close_route(&id); }
                    },
                    Command::Open { id, .. } | Command::Signal { id, .. } => inner.finish(&id),
                }
            },
            incoming = endpoint.accept() => {
                let Some(incoming) = incoming else { break; };
                if !incoming.remote_address_validated() { let _ = incoming.retry(); continue; }
                let Ok(permit) = permits.clone().try_acquire_owned() else { incoming.refuse(); continue; };
                let inner = inner.clone(); let stop = stop.clone();
                sessions.spawn(async move { session(inner, IncomingSessionFuture::with_quic_incoming(incoming), permit, stop).await; });
            },
        }
    }
    inner.closed.store(true, Ordering::Release); let _ = inner.stop.send(true);
    // No accept future is alive at this point: wtransport 0.7.2 accept panics if polled after close.
    endpoint.close(quinn::VarInt::from_u32(0), b"listener stopped");
    let ids: Vec<_> = inner.state.lock().expect("WT state").routes.keys().cloned().collect();
    for id in ids { inner.finish(&id); }
    sessions.abort_all(); while sessions.join_next().await.is_some() {}
    let _ = timeout(Duration::from_secs(1), endpoint.wait_idle()).await;
}

async fn session(inner: Arc<Inner>, incoming: IncomingSessionFuture, permit: tokio::sync::OwnedSemaphorePermit, mut stop: watch::Receiver<bool>) {
    let request = tokio::select! {
        biased;
        _ = stopped(&mut stop) => return,
        request = timeout(HANDSHAKE, incoming.into_future()) => match request { Ok(Ok(request)) => request, _ => return },
    };
    if request.authority() != inner.authority || !request.origin().is_some_and(|origin| inner.origins.contains(origin)) {
        let _ = timeout(Duration::from_secs(1), request.forbidden()).await; return;
    }
    let Some(id) = inner.take_ticket(request.path(), Instant::now()) else {
        let _ = timeout(Duration::from_secs(1), request.not_found()).await; return;
    };
    let connection = tokio::select! {
        biased;
        _ = stopped(&mut stop) => { inner.finish(&id); return; },
        connection = timeout(HANDSHAKE, request.accept()) => match connection {
            Ok(Ok(connection)) => connection, _ => { inner.finish(&id); return; }
        },
    };
    drop(permit);
    let Some(mtu) = connection.max_datagram_size().filter(|mtu| (256..=65535).contains(mtu)) else {
        connection.close(CLOSE, b"datagrams unavailable"); inner.finish(&id); return;
    };
    let installed = {
        let mut state = inner.state.lock().expect("WT state");
        state.routes.get_mut(&id).map(|route| { route.connection = Some(connection.clone()); (route.peer, route.expires) })
    };
    let Some((peer, expires)) = installed else { connection.close(CLOSE, b"reservation expired"); return; };
    let address = match inner.broker.ready(&id, mtu) { Ok(addr) => addr, Err(_) => { inner.finish(&id); return; } };
    if inner.events.try_send(WtEvent::Ready { id: id.clone(), peer, address }).is_err() { inner.finish(&id); return; }
    loop {
        tokio::select! {
            biased;
            _ = stopped(&mut stop) => break,
            _ = tokio::time::sleep_until(expires) => break,
            packet = connection.receive_datagram() => match packet {
                Ok(bytes) => { inner.broker.receive(&id, &bytes); },
                Err(_) => break,
            }
        }
    }
    inner.finish(&id);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn peer(byte: u8) -> EndpointId { iroh::SecretKey::from_bytes(&[byte; 32]).public() }
    #[tokio::test]
    async fn cancelled_shutdown_retains_completion_ownership() {
        let (events, _rx) = mpsc::channel(32);
        let listener = NativeWt::bind(config(), PacketTransport::new(peer(1)), events).await.unwrap();
        let address = listener.local_addr().unwrap();
        let mut first = Box::pin(listener.shutdown());
        // Current-thread executor: supervisor cannot finish before this poll returns.
        std::future::poll_fn(|cx| {
            assert!(first.as_mut().poll(cx).is_pending());
            std::task::Poll::Ready(())
        }).await;
        drop(first);
        listener.shutdown().await;
        let _rebound = std::net::UdpSocket::bind(address).expect("cancelled caller must not lose completion barrier");
    }

    #[tokio::test]
    async fn cancelled_runtime_join_keeps_running_driver() {
        let runtime = JoinedRuntime::default();
        let (release, wait) = tokio::sync::oneshot::channel();
        quinn::Runtime::spawn(&runtime, Box::pin(async move { let _ = wait.await; }));
        let mut first = Box::pin(runtime.joined());
        std::future::poll_fn(|cx| {
            assert!(first.as_mut().poll(cx).is_pending());
            std::task::Poll::Ready(())
        }).await;
        drop(first);
        assert_eq!(runtime.tasks.lock().unwrap().len(), 1);
        release.send(()).expect("cancelling waiter must not abort driver");
        runtime.joined().await;
        assert!(runtime.tasks.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn awaited_shutdown_releases_socket_with_listener_retained() {
        let (events, _rx) = mpsc::channel(32);
        let listener = NativeWt::bind(config(), PacketTransport::new(peer(1)), events).await.unwrap();
        let address = listener.local_addr().unwrap();
        assert!(std::net::UdpSocket::bind(address).is_err());
        let ((), ()) = tokio::join!(listener.shutdown(), listener.shutdown());
        let rebound = std::net::UdpSocket::bind(address).expect("driver completion releases UDP before shutdown returns");
        assert_eq!(rebound.local_addr().unwrap(), address);
        assert!(listener.local_addr().is_err());
    }

    fn config() -> Config { Config { bind: "127.0.0.1:0".parse().unwrap(), public_url: "https://127.0.0.1:0/packets".into(), allowed_origins: vec!["https://app.example".into()] } }

    #[tokio::test]
    async fn admission_is_one_shot_short_lived_and_bounded_separately_from_lease() {
        let (events, mut received) = mpsc::channel(16);
        let listener = NativeWt::bind(config(), PacketTransport::new(peer(1)), events).await.unwrap();
        let reservation = listener.reserve(peer(2), [1; 16]).unwrap();
        let url = Url::parse(reservation.descriptor["url"].as_str().unwrap()).unwrap();
        assert_ne!(url.port(), Some(0));
        assert_eq!(reservation.descriptor["certificateHashes"].as_array().unwrap().len(), 2);
        let expires = reservation.descriptor["expires"].as_i64().unwrap();
        assert!(expires - OffsetDateTime::now_utc().unix_timestamp() >= 6 * 3600 - 2);
        assert_eq!(listener.inner.take_ticket(url.path(), Instant::now()), Some(reservation.id.clone()));
        assert_eq!(listener.inner.take_ticket(url.path(), Instant::now()), None, "admission is single-use");
        assert!(listener.inner.take_ticket("/packets/not-a-ticket", Instant::now()).is_none());
        for i in 2..=8 { listener.reserve(peer(i + 2), [i; 16]).unwrap(); }
        assert_eq!(listener.reserve(peer(12), [12; 16]).err().unwrap().kind(), io::ErrorKind::WouldBlock);
        listener.inner.expire(Instant::now() + TICKET_LIFETIME, OffsetDateTime::now_utc().unix_timestamp());
        assert!(listener.inner.state.lock().unwrap().routes.is_empty());
        assert!(matches!(received.recv().await, Some(WtEvent::Closed { .. })));
        listener.reserve(peer(2), [13; 16]).unwrap();
        listener.shutdown().await;
        assert_eq!(listener.reserve(peer(2), [14; 16]).err().unwrap().kind(), io::ErrorKind::NotConnected);
    }

    #[tokio::test]
    async fn slow_event_consumer_backpressures_admission_without_losing_teardown() {
        let (events, mut received) = mpsc::channel(16);
        let listener = NativeWt::bind(config(), PacketTransport::new(peer(1)), events).await.unwrap();
        for epoch in 0..16 {
            let reservation = listener.reserve(peer(2), [epoch; 16]).unwrap();
            listener.inner.finish(&reservation.id);
        }
        assert_eq!(listener.reserve(peer(2), [16; 16]).err().unwrap().kind(), io::ErrorKind::WouldBlock);
        assert!(matches!(received.recv().await, Some(WtEvent::Closed { .. })));
        let reservation = listener.reserve(peer(2), [17; 16]).unwrap();
        listener.inner.finish(&reservation.id);
        for _ in 0..16 { assert!(matches!(received.try_recv(), Ok(WtEvent::Closed { .. }))); }
        assert!(received.try_recv().is_err());
        listener.shutdown().await;
    }

    #[tokio::test]
    async fn rotating_listener_promotes_advertised_next_pin_and_retains_udp_address() {
        let (events, _received) = mpsc::channel(16);
        let listener = NativeWt::bind(config(), PacketTransport::new(peer(1)), events).await.unwrap();
        let address = listener.local_addr().unwrap();
        let before = listener.reserve(peer(2), [1; 16]).unwrap().descriptor;
        listener.inner.rotate(OffsetDateTime::now_utc(), Instant::now() + ROTATION + Duration::from_secs(1)).unwrap();
        let after = listener.reserve(peer(3), [2; 16]).unwrap().descriptor;
        assert_eq!(before["certificateHashes"][1], after["certificateHashes"][0]);
        assert_ne!(after["certificateHashes"][0], after["certificateHashes"][1]);
        assert_eq!(listener.local_addr().unwrap(), address);
        listener.close();
        let task = listener.task.lock().unwrap().take().unwrap();
        task.await.expect("shutdown never polls Endpoint.accept after close");
    }

    #[tokio::test]
    async fn listener_rejects_ambiguous_configuration_and_does_not_relax_tls() {
        let (events, _received) = mpsc::channel(16);
        for url in ["http://127.0.0.1:0/packets", "https://user:pass@127.0.0.1:0/packets", "https://127.0.0.1/packets?secret=bad"] {
            let mut c = config(); c.public_url = url.into();
            assert!(NativeWt::bind(c, PacketTransport::new(peer(1)), events.clone()).await.is_err());
        }
        let mut c = config(); c.allowed_origins = vec!["*".into()];
        assert!(NativeWt::bind(c, PacketTransport::new(peer(1)), events).await.is_err());
        let provider = crate::pq_provider();
        assert_eq!(provider.kx_groups.len(), 1);
        assert_eq!(provider.kx_groups[0].name(), rustls::NamedGroup::X25519MLKEM768);
    }
}
