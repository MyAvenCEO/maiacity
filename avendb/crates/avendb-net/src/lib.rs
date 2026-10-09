//! avenDB on the network (P8): each device a node of its own on an iroh endpoint, syncing with its peers by the bytes
//! of `avendb::wire` over avenDB's own ALPN, `avendb/sync/1`. The media vault's iroh (`vault/`) is another workspace
//! and stays as it is.
//!
//! - **Who**: a node's endpoint key is its device's ed25519 key, so iroh's TLS proves the endpoint. Each connection
//!   then opens with a hello each way (`sign::Hello`): the device's SLH-DSA signature over the connection's TLS
//!   exporter, which proves the device itself, by both its keys, on this connection alone. The listener checks the
//!   dialer's hello before it sends its own and closes a connection without one; the dialer checks the listener's.
//! - **Key exchange**: X25519MLKEM768 is the only group either end offers (`pq_provider`): ML-KEM-768 agrees the keys
//!   of every connection along with X25519, and a peer that offers only classical groups doesn't connect.
//! - **Sync**: either end asks the other on the connection (`wire::Request`) and is answered with the ops it may
//!   receive by the other's view and the McEliece keys they name (`wire::Reply`), each key by its id and BLAKE3 hash
//!   alone. The asker fetches the keys it lacks over iroh-blobs, where a node hands a key out only to a device a hello
//!   proved that may fetch it (`Lab::may_fetch`), and checks each key against its id.
//! - **Announcements**: whenever a log changes, the node tells each peer that may hold it by the node's view
//!   (`Lab::announce`), straight over their connection, the digests that changed since it last told it; a peer whose
//!   digests differ asks. Not iroh-gossip: a topic can't tell a device of a log it doesn't know yet without telling
//!   every other member too, and its members learn each other's endpoints, while an announcement goes to one proven
//!   device. A peer it can't reach it tries again after `Options::retry`, then twice as long each time it stays out
//!   of reach, up to a minute, or at once when the peer connects to it.
//! - **Store** (P8b): with `Options::store`, a node keeps what its device holds in a folder (`Disk`), saved as it
//!   changes, and starts again from it.
//! - **The server** (P8b, `server`): a node whose device keeps a secret of its own beside its store, whose vault it
//!   founds at its first start with an owner key it then forgets, and which hands its contact card, its vault's log,
//!   to whoever asks (`Node::contact`), so that a device can grant it relay on a space. Devices reach each other and
//!   the server through its relay, which lets in only the devices the server knows (`Admission`).
//! - **Linking** (P8c): a device shows its offer as a QR code (`Node::offer`, `Offer::to_text`): its endpoint, its
//!   device and where it is reached. A new device of the same person scans it and links through it (`Node::link`):
//!   once the hellos proved both devices, the person's passkey, used on the new device, says its own hello on the
//!   connection (`sign::PasskeyHello`), an assertion and an SLH-DSA signature over the connection's TLS exporter, the
//!   end it speaks for and the new device; the peer hands back the logs of the vaults the passkey owns, and nothing
//!   else (`Lab::link_card`); the new device adds itself to the vault whose root is the passkey, signed by the passkey
//!   and by itself (`Lab::join`), and the peer accepts that op alone, for that device alone (`Lab::accept_join`). Then
//!   they sync as devices of one vault. With every other device lost, a new device links the same way through the
//!   server, whose offer the app knows: the passkey alone brings the person's vault back. A device the server doesn't
//!   know yet makes that first contact straight, over UDP, as its relay lets it in only once it joined.

mod blobs;
mod disk;
pub mod server;
mod session;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::hash::Hash;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::id::{BlobId, SignerId, VaultId};
use avendb::lab::Lab;
use avendb::policy::Action;
use avendb::sync::LogId;
use avendb::wire::{Announce, Reply, Wire};
use data_encoding::BASE32_NOPAD;
use iroh::address_lookup::MemoryLookup;
use iroh::endpoint::{Connection, PortmapperConfig, presets};
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMode, RelayUrl, SecretKey};
use iroh_blobs::BlobsProtocol;
use iroh_blobs::store::mem::MemStore;
use rustls::crypto::CryptoProvider;
use tokio::sync::{Notify, watch};
use tokio::task::JoinHandle;

pub use disk::Disk;
pub use session::exporter;

/// avenDB's own ALPN: its sync protocol, version 1.
pub const ALPN: &[u8] = b"avendb/sync/1";

/// How long a node waits for a peer to connect, or to say its hello.
const WAIT: Duration = Duration::from_secs(10);

/// The longest a node waits before it tries a peer out of reach again.
const BACKOFF_MAX: Duration = Duration::from_secs(60);

/// The TLS of every node: aws-lc-rs with X25519MLKEM768 as its only key exchange, so that ML-KEM-768 agrees the keys
/// of every connection along with X25519, and a peer that offers only classical groups finds none in common. Ciphers
/// with 256-bit keys first; AES-128 last, as QUIC protects its first packets with it.
pub fn pq_provider() -> Arc<CryptoProvider> {
    use rustls::crypto::aws_lc_rs::{cipher_suite, default_provider, kx_group};
    Arc::new(CryptoProvider {
        kx_groups: vec![kx_group::X25519MLKEM768],
        cipher_suites: vec![
            cipher_suite::TLS13_AES_256_GCM_SHA384,
            cipher_suite::TLS13_CHACHA20_POLY1305_SHA256,
            cipher_suite::TLS13_AES_128_GCM_SHA256,
        ],
        ..default_provider()
    })
}

/// How a node runs.
#[derive(Clone, Debug)]
pub struct Options {
    /// The UDP socket it binds, or none: then it reaches its peers through its relay alone.
    pub bind: Option<SocketAddr>,
    /// The relay it is reached through, the server's; it looks for its peers there too.
    pub relay: Option<RelayUrl>,
    /// How soon it tries again to tell a peer it couldn't reach, or to ask one it failed to ask: after `retry`, then
    /// twice as long each time the peer stays out of reach, up to a minute.
    pub retry: Duration,
    /// The folder it keeps its store in (`Disk`), if any: it starts again from what it holds there.
    pub store: Option<PathBuf>,
    /// It hands its contact card to whoever asks (`Node::contact`), as the server does.
    pub card: bool,
    /// Where it writes the endpoints of the devices it knows, for a relay to let them in: the server's.
    pub admission: Option<Admission>,
}

impl Options {
    /// Nodes on one machine, as in the tests: loopback, no relay, and no lookup but the addresses a node is told.
    pub fn local() -> Options {
        Options {
            bind: Some(SocketAddr::from(([127, 0, 0, 1], 0))),
            relay: None,
            retry: Duration::from_secs(1),
            store: None,
            card: false,
            admission: None,
        }
    }
}

/// Who may use the server's relay: the endpoints of the devices the server knows, those of every vault in its view
/// whose keys it saw sign, and its own. The server's node keeps it up to date as its view changes, from before its
/// endpoint binds; the relay asks it about each client that connects, and lets go of a client it stops admitting.
#[derive(Clone, Debug)]
pub struct Admission(Arc<watch::Sender<HashSet<EndpointId>>>);

impl Default for Admission {
    fn default() -> Self {
        Admission(Arc::new(watch::Sender::new(HashSet::new())))
    }
}

impl Admission {
    /// The relay lets `endpoint` in.
    pub fn admits(&self, endpoint: &EndpointId) -> bool {
        self.0.borrow().contains(endpoint)
    }

    /// Marks each change of whom it admits.
    pub fn watch(&self) -> watch::Receiver<HashSet<EndpointId>> {
        self.0.subscribe()
    }

    fn set(&self, endpoints: HashSet<EndpointId>) {
        self.0.send_if_modified(|now| *now != endpoints && { *now = endpoints; true });
    }
}

/// A device on the network: its Lab, split off for it (`Lab::split`), behind an iroh endpoint of its own key.
pub struct Node {
    shared: Arc<Shared>,
    router: Router,
    tasks: Vec<JoinHandle<()>>,
}

impl Node {
    /// Device `me` of `lab` on the network: it answers its peers, tells them when its logs change, and asks them when
    /// theirs differ. With a store, it first takes back what the store holds, if anything, and saves what it holds
    /// from then on. Fails while the device is locked, as its endpoint key is its own ed25519 key.
    pub async fn spawn(lab: Lab, me: SignerId, opts: Options) -> Result<Node> {
        let secret = lab.endpoint_secret(me).context("a device of this Lab, unlocked")?;
        let store = opts.store.clone();
        let (lab, disk) = tokio::task::spawn_blocking(move || reopen(lab, me, store)).await??;
        if let Some(admission) = &opts.admission {
            let own = SecretKey::from_bytes(&secret).public();
            admission.set(endpoints(&lab.peers(me)).chain([own]).collect());
        }
        let lookup = MemoryLookup::new();
        let mut builder = Endpoint::builder(presets::Empty)
            .secret_key(SecretKey::from_bytes(&secret))
            .crypto_provider(pq_provider())
            .address_lookup(lookup.clone())
            .portmapper_config(PortmapperConfig::Disabled)
            .clear_ip_transports();
        if let Some(bind) = opts.bind {
            builder = builder.bind_addr(bind)?;
        }
        if let Some(relay) = &opts.relay {
            builder = builder.relay_mode(RelayMode::custom([relay.clone()]));
        }
        let endpoint = builder.bind().await?;
        let store = MemStore::new();
        let (events, gate) = blobs::events();
        let shared = Arc::new(Shared {
            me,
            lab: Mutex::new(lab),
            disk: disk.map(Mutex::new),
            endpoint: endpoint.clone(),
            lookup,
            store: store.clone(),
            opts,
            peers: Mutex::default(),
            proven: Mutex::default(),
            dialing: Mutex::default(),
            told: Mutex::default(),
            telling: Mutex::default(),
            unreached: Mutex::default(),
            asking: Mutex::default(),
            owed: Mutex::default(),
            offered: Mutex::default(),
            blob_peers: Mutex::default(),
            changed: Notify::new(),
            sent: Sent::default(),
        });
        let router = Router::builder(endpoint)
            .accept(ALPN, session::Protocol(shared.clone()))
            .accept(iroh_blobs::ALPN, BlobsProtocol::new(&store, Some(events)))
            .spawn();
        let tasks = vec![tokio::spawn(blobs::gate(shared.clone(), gate)), tokio::spawn(shared.clone().announcer())];
        Ok(Node { shared, router, tasks })
    }

    /// The device this node is.
    pub fn device(&self) -> SignerId {
        self.shared.me
    }

    /// Its endpoint, for what a test does by hand.
    pub fn endpoint(&self) -> &Endpoint {
        &self.shared.endpoint
    }

    /// Its endpoint id: its device's ed25519 key.
    pub fn id(&self) -> EndpointId {
        self.shared.endpoint.id()
    }

    /// Where its peers reach it: its endpoint id, the address of each network interface its socket is bound on, and
    /// its relay.
    pub fn addr(&self) -> EndpointAddr {
        let addr = self.shared.endpoint.addr();
        self.shared.opts.relay.iter().cloned().fold(addr, EndpointAddr::with_relay_url)
    }

    /// What it shows as a QR code for a new device of its person to link through it (`Node::link`): its device, and
    /// where it is reached.
    pub fn offer(&self) -> Offer {
        Offer { device: self.shared.me, addr: self.addr() }
    }

    /// Link this device to its person's vault through the device `offer` names: another device of its person, whose
    /// code it scanned, or, with every other device lost, the server, whose offer the app knows (P8c). The passkey
    /// `passkey`, used on this device, says its hello on their connection (`sign::PasskeyHello`), for this device on
    /// this connection alone; the peer hands back the logs of the vaults the passkey owns (`Lab::link_card`); this
    /// device adds itself to the one whose root is the passkey (`Lab::join`) and sends the peer that op, which the
    /// peer accepts only if it adds this very device with the vault's approval (`Lab::accept_join`). Then they sync as
    /// devices of one vault. The vault it joined. Fails if the device answering isn't the one offered, the passkey
    /// isn't at hand, it roots no vault the peer knows, or the peer refuses the join; tried again, it sends the same
    /// join.
    pub async fn link(&self, offer: &Offer, passkey: SignerId) -> Result<VaultId> {
        self.know(offer.addr.clone());
        let endpoint = offer.addr.id;
        let peer = self.shared.connection(endpoint).await?;
        if peer.device != offer.device {
            bail!("the device at {endpoint} isn't the one offered");
        }
        let (exporter, dialed) = (session::exporter(&peer.conn)?, peer.dialed);
        let hello = self.shared.lab(move |lab, me| lab.passkey_hello(me, passkey, &exporter, dialed)).await;
        let hello = hello.context("the passkey isn't at hand")?.to_wire();
        let card = session::exchange(&peer.conn, session::LINK, &hello, session::REPLY_LIMIT).await?;
        let Reply { mut ops, .. } = Reply::from_wire(&card)?;
        // a card carries vault logs, and nothing else
        ops.retain(|s| s.op.vault_of().is_some());
        let join = self.shared.lab(move |lab, me| {
            lab.receive(me, ops, Vec::new());
            lab.join(me, passkey)
        });
        let join = join.await.map_err(|why| anyhow!("no vault of this passkey to join: {why:?}"))?;
        let Action::AddDevice { vault, .. } = join.op.op.action else { bail!("a join that adds no device") };
        let sent = session::exchange(&peer.conn, session::JOIN, &join.to_wire(), 0).await;
        sent.context("the peer refuses the join")?;
        self.shared.changed.notify_one();
        self.shared.ask(endpoint).await?;
        Ok(vault)
    }

    /// Tell it where a peer is.
    pub fn know(&self, addr: EndpointAddr) {
        self.shared.lookup.add_endpoint_info(addr);
    }

    /// Act on its Lab as its device, as its app does: a write, a grant, an edit. Then it tells its peers of whatever
    /// changed.
    pub async fn act<T: Send + 'static>(&self, f: impl FnOnce(&mut Lab, SignerId) -> T + Send + 'static) -> T {
        let out = self.shared.lab(f).await;
        self.shared.changed.notify_one();
        out
    }

    /// Read its Lab as its device.
    pub async fn read<T: Send + 'static>(&self, f: impl FnOnce(&Lab, SignerId) -> T + Send + 'static) -> T {
        self.shared.lab(|lab, me| f(lab, me)).await
    }

    /// Ask the device at endpoint `peer` now, whatever it announced: the ops and McEliece keys it may send this one.
    /// How many ops were new.
    pub async fn sync_with(&self, peer: EndpointId) -> Result<usize> {
        self.shared.ask(peer).await
    }

    /// Ask the device at endpoint `peer` for its contact card (`Lab::card`), as a device asks the server for its
    /// vault's log before it grants the server relay on a space. How many ops were new.
    pub async fn contact(&self, peer: EndpointId) -> Result<usize> {
        self.shared.contact(peer).await
    }

    /// The device at endpoint `peer` as its hello proved it, once they are connected.
    pub fn proven(&self, peer: EndpointId) -> Option<SignerId> {
        self.shared.proven.lock().expect("proven").get(&peer).copied()
    }

    /// How many requests and announcements it has sent so far.
    pub fn sent(&self) -> (usize, usize) {
        (self.shared.sent.requests.load(Ordering::Relaxed), self.shared.sent.announcements.load(Ordering::Relaxed))
    }

    /// How many times it has dialed a peer so far, reached or not.
    pub fn dials(&self) -> usize {
        self.shared.sent.dials.load(Ordering::Relaxed)
    }

    /// Close its connections and its endpoint.
    pub async fn shutdown(&self) -> Result<()> {
        self.tasks.iter().for_each(JoinHandle::abort);
        self.router.shutdown().await?;
        Ok(())
    }
}

impl Drop for Node {
    fn drop(&mut self) {
        self.tasks.iter().for_each(JoinHandle::abort);
    }
}

/// Device `me` of `lab` with its store in folder `store`, if it keeps one: what the store holds taken back, if it
/// holds anything, and whatever else the device holds saved.
fn reopen(mut lab: Lab, me: SignerId, store: Option<PathBuf>) -> Result<(Lab, Option<Disk>)> {
    let Some(dir) = store else { return Ok((lab, None)) };
    let (mut disk, saved) = Disk::open(&dir)?;
    if !disk.is_empty() {
        lab.restore_backup(me, &saved);
    }
    disk.adopt(&lab, me)?;
    Ok((lab, Some(disk)))
}

/// The endpoints of the devices `known` (`Lab::peers`): each one's ed25519 key.
fn endpoints(known: &[(SignerId, [u8; 32])]) -> impl Iterator<Item = EndpointId> + '_ {
    known.iter().filter_map(|(_, key)| EndpointId::from_bytes(key).ok())
}

/// What a device offers a new device of its person to link through it (P8c), as a QR code shows it
/// (`Offer::to_text`), or what an app knows of the server: the device, whose hello the new device checks, and where
/// its endpoint is reached.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Offer {
    pub device: SignerId,
    pub addr: EndpointAddr,
}

/// What an offer's text starts with: avenDB's offer, version 1.
const OFFER: &str = "AVENDB1";

impl Offer {
    /// The offer as a QR code's text: `AVENDB1`, then in base32 without padding, which a QR code holds in its compact
    /// alphanumeric mode, the endpoint id, the device, each IP address (4 or 16 bytes, then the port) and each relay's
    /// URL, smallest first.
    pub fn to_text(&self) -> String {
        format!("{OFFER}{}", BASE32_NOPAD.encode(&self.to_bytes()))
    }

    /// An offer read back from its text, which must be exactly what `to_text` makes of it.
    pub fn from_text(text: &str) -> Result<Offer> {
        let bytes = text.strip_prefix(OFFER).and_then(|t| BASE32_NOPAD.decode(t.as_bytes()).ok());
        let offer = bytes.as_deref().and_then(Offer::from_bytes).context("no avenDB offer")?;
        if Some(offer.to_bytes()) != bytes {
            bail!("an avenDB offer written another way");
        }
        Ok(offer)
    }

    fn to_bytes(&self) -> Vec<u8> {
        let mut out = [&self.addr.id.as_bytes()[..], &self.device.0].concat();
        let ips: Vec<&SocketAddr> = self.addr.ip_addrs().take(255).collect();
        out.push(ips.len() as u8);
        for ip in ips {
            match ip.ip() {
                IpAddr::V4(v4) => out.extend([&[4][..], &v4.octets()].concat()),
                IpAddr::V6(v6) => out.extend([&[6][..], &v6.octets()].concat()),
            }
            out.extend(ip.port().to_be_bytes());
        }
        let relays: Vec<String> = self.addr.relay_urls().map(|u| u.to_string()).filter(|u| u.len() < 256).collect();
        out.push(relays.len().min(255) as u8);
        for url in relays.iter().take(255) {
            out.push(url.len() as u8);
            out.extend(url.as_bytes());
        }
        out
    }

    fn from_bytes(bytes: &[u8]) -> Option<Offer> {
        let mut r = Cursor(bytes);
        let id = EndpointId::from_bytes(&r.array()?).ok()?;
        let device = SignerId(r.array()?);
        let mut addr = EndpointAddr::new(id);
        for _ in 0..r.array::<1>()?[0] {
            let ip = match r.array::<1>()?[0] {
                4 => IpAddr::from(r.array::<4>()?),
                6 => IpAddr::from(r.array::<16>()?),
                _ => return None,
            };
            addr = addr.with_ip_addr(SocketAddr::new(ip, u16::from_be_bytes(r.array()?)));
        }
        for _ in 0..r.array::<1>()?[0] {
            let n = r.array::<1>()?[0] as usize;
            addr = addr.with_relay_url(std::str::from_utf8(r.take(n)?).ok()?.parse().ok()?);
        }
        r.0.is_empty().then_some(Offer { device, addr })
    }
}

/// A cursor over the bytes of an offer.
struct Cursor<'a>(&'a [u8]);

impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let (head, rest) = self.0.split_at_checked(n)?;
        self.0 = rest;
        Some(head)
    }

    fn array<const N: usize>(&mut self) -> Option<[u8; N]> {
        self.take(N)?.try_into().ok()
    }
}

/// A connection to a peer, dialed or accepted, with the device its hello proved.
#[derive(Clone)]
struct Peer {
    conn: Connection,
    device: SignerId,
    endpoint: EndpointId,
    /// This node dialed it.
    dialed: bool,
}

/// What a node's tasks share.
struct Shared {
    me: SignerId,
    lab: Mutex<Lab>,
    /// Its store on disk, if it keeps one.
    disk: Option<Mutex<Disk>>,
    endpoint: Endpoint,
    lookup: MemoryLookup,
    store: MemStore,
    opts: Options,
    /// The live connection to each peer.
    peers: Mutex<HashMap<EndpointId, Peer>>,
    /// Each endpoint a hello ever proved, with its device: whom the blob gate lets in.
    proven: Mutex<HashMap<EndpointId, SignerId>>,
    /// A lock for each endpoint, held while dialing it, so that a node dials each peer once.
    dialing: Mutex<HashMap<EndpointId, Arc<tokio::sync::Mutex<()>>>>,
    /// The digests each peer was last told.
    told: Mutex<HashMap<SignerId, BTreeMap<LogId, [u8; 32]>>>,
    /// The peers being told now.
    telling: Mutex<HashSet<SignerId>>,
    /// The peers it couldn't tell, and when to try each again.
    unreached: Mutex<Backoff<SignerId>>,
    /// The peers being asked, each with whether to ask it again once done.
    asking: Mutex<HashMap<EndpointId, bool>>,
    /// The peers whose asking failed, and when to ask each again.
    owed: Mutex<Backoff<EndpointId>>,
    /// The McEliece keys in the blob store, by hash and by id.
    offered: Mutex<blobs::Offered>,
    /// The blob connections the gate let in, each with its device.
    blob_peers: Mutex<HashMap<u64, SignerId>>,
    /// Woken whenever the node's logs may have changed.
    changed: Notify,
    /// How many messages it has sent.
    sent: Sent,
}

/// How many messages of each kind a node has sent, and how many times it dialed: once its peers and it agree, they
/// stop growing.
#[derive(Default)]
struct Sent {
    requests: AtomicUsize,
    announcements: AtomicUsize,
    dials: AtomicUsize,
}

/// The peers out of reach, each with when to try it again and how many times in a row it failed: after `retry`, then
/// twice as long each time, up to `BACKOFF_MAX`.
struct Backoff<K>(HashMap<K, (Instant, u32)>);

impl<K> Default for Backoff<K> {
    fn default() -> Self {
        Backoff(HashMap::new())
    }
}

impl<K: Hash + Eq + Copy> Backoff<K> {
    /// `k` failed again.
    fn failed(&mut self, k: K, retry: Duration) {
        let n = self.0.get(&k).map_or(0, |&(_, n)| n + 1);
        let wait = retry.saturating_mul(1 << n.min(16)).min(BACKOFF_MAX);
        self.0.insert(k, (Instant::now() + wait, n));
    }

    /// `k` was reached: no more waiting.
    fn reached(&mut self, k: &K) {
        self.0.remove(k);
    }

    /// It is time to try `k`: it never failed, or its wait is over.
    fn due(&self, k: &K) -> bool {
        self.0.get(k).is_none_or(|&(at, _)| Instant::now() >= at)
    }

    /// The peers out of reach whose wait is over.
    fn ready(&self) -> Vec<K> {
        self.0.iter().filter(|(_, (at, _))| Instant::now() >= *at).map(|(k, _)| *k).collect()
    }
}

/// What a node tells each peer: the digests of the logs the peer may hold, as worked out for the device's ops when
/// they were as many as `size` says (`Lab::size`).
struct News {
    size: (usize, usize),
    peers: Vec<(SignerId, EndpointId, BTreeMap<LogId, [u8; 32]>)>,
}

impl Shared {
    /// `f` on the Lab, off the async threads: its crypto takes milliseconds, a McEliece key pair seconds. Then what
    /// the device took is saved, if the node keeps a store.
    async fn lab<T: Send + 'static>(self: &Arc<Self>, f: impl FnOnce(&mut Lab, SignerId) -> T + Send + 'static) -> T {
        let shared = self.clone();
        let task = tokio::task::spawn_blocking(move || {
            let mut lab = shared.lab.lock().expect("the Lab");
            let out = f(&mut lab, shared.me);
            shared.save(&lab);
            out
        });
        task.await.expect("the Lab's task")
    }

    /// Saves what the device took since the last save, if the node keeps a store. A store that can't be written is
    /// said so in the log, and tried again at the next change.
    fn save(&self, lab: &Lab) {
        let Some(disk) = &self.disk else { return };
        if let Err(e) = disk.lock().expect("the store").save(lab, self.me) {
            tracing::warn!("avendb: the store can't be written: {e:#}");
        }
    }

    /// Where to reach `endpoint`: through the node's relay, if it has one, and wherever the lookup knows of.
    fn addr_of(&self, endpoint: EndpointId) -> EndpointAddr {
        self.opts.relay.iter().cloned().fold(EndpointAddr::new(endpoint), EndpointAddr::with_relay_url)
    }

    /// The live connection to `endpoint`, dialed if there is none.
    async fn connection(self: &Arc<Self>, endpoint: EndpointId) -> Result<Peer> {
        let lock = self.dialing.lock().expect("dialing").entry(endpoint).or_default().clone();
        let _dialing = lock.lock().await;
        if let Some(peer) = self.live(endpoint) {
            return Ok(peer);
        }
        self.sent.dials.fetch_add(1, Ordering::Relaxed);
        let dial = self.endpoint.connect(self.addr_of(endpoint), ALPN);
        let conn = tokio::time::timeout(WAIT, dial).await.context("no answer")??;
        match tokio::time::timeout(WAIT, session::dial_hello(self, &conn)).await {
            Ok(Ok(device)) => {
                let peer = self.connected(conn, device, true);
                tokio::spawn(session::serve(self.clone(), peer.clone()));
                Ok(peer)
            }
            Ok(Err(e)) => {
                conn.close(session::REFUSED, b"no hello");
                Err(e)
            }
            Err(_) => {
                conn.close(session::REFUSED, b"no hello");
                bail!("no hello from {endpoint}")
            }
        }
    }

    /// The connection to `endpoint` if there is one still open.
    fn live(&self, endpoint: EndpointId) -> Option<Peer> {
        let peers = self.peers.lock().expect("peers");
        peers.get(&endpoint).filter(|p| p.conn.close_reason().is_none()).cloned()
    }

    /// A connection whose hellos proved `device`, which this node dialed if `dialed`: the one to its endpoint from now
    /// on. A new connection starts their talk over: the node tells the peer every digest again, at once.
    fn connected(&self, conn: Connection, device: SignerId, dialed: bool) -> Peer {
        let endpoint = conn.remote_id();
        let peer = Peer { conn, device, endpoint, dialed };
        self.peers.lock().expect("peers").insert(endpoint, peer.clone());
        self.proven.lock().expect("proven").insert(endpoint, device);
        self.told.lock().expect("told").remove(&device);
        self.unreached.lock().expect("unreached").reached(&device);
        self.changed.notify_one();
        peer
    }

    /// Asks `endpoint` once: the ops the device there may send this one, and the McEliece keys they name that this
    /// one lacks. How many ops were new.
    async fn ask(self: &Arc<Self>, endpoint: EndpointId) -> Result<usize> {
        let peer = self.connection(endpoint).await?;
        let device = peer.device;
        let request = self.lab(move |lab, me| lab.request(me, device)).await.to_wire();
        let reply = session::exchange(&peer.conn, session::REQUEST, &request, session::REPLY_LIMIT).await?;
        self.sent.requests.fetch_add(1, Ordering::Relaxed);
        let Reply { ops, blobs } = Reply::from_wire(&reply)?;
        let lacking = move |lab: &mut Lab, me| -> Vec<(BlobId, [u8; 32])> {
            blobs.into_iter().filter(|(b, _)| lab.blob(me, *b).is_none()).collect()
        };
        let lacking = self.lab(lacking).await;
        let keys = self.fetch(endpoint, lacking).await;
        let fetched = !keys.is_empty();
        let new = self.lab(move |lab, me| lab.receive(me, ops, keys)).await;
        if new > 0 || fetched {
            self.changed.notify_one();
        }
        Ok(new)
    }

    /// Asks `endpoint` for its contact card, and takes its vault logs. How many ops were new.
    async fn contact(self: &Arc<Self>, endpoint: EndpointId) -> Result<usize> {
        let peer = self.connection(endpoint).await?;
        let reply = session::exchange(&peer.conn, session::CARD, &[], session::REPLY_LIMIT).await?;
        let Reply { mut ops, .. } = Reply::from_wire(&reply)?;
        // a card carries vault logs, and nothing else
        ops.retain(|s| s.op.vault_of().is_some());
        let new = self.lab(move |lab, me| lab.receive(me, ops, Vec::new())).await;
        if new > 0 {
            self.changed.notify_one();
        }
        Ok(new)
    }

    /// Asks `endpoint` soon, and once more after the asking under way if there is one; if the asking fails, again
    /// once its wait is over (`Backoff`).
    fn ask_soon(self: &Arc<Self>, endpoint: EndpointId) {
        if !self.start_asking(endpoint) {
            return;
        }
        let shared = self.clone();
        tokio::spawn(async move {
            loop {
                let asked = shared.ask(endpoint).await.is_ok();
                let mut owed = shared.owed.lock().expect("owed");
                if asked { owed.reached(&endpoint) } else { owed.failed(endpoint, shared.opts.retry) };
                drop(owed);
                if !shared.ask_again(endpoint) {
                    break;
                }
            }
        });
    }

    /// Whether to start asking `endpoint`: if an asking is under way, it asks again once done instead.
    fn start_asking(&self, endpoint: EndpointId) -> bool {
        let mut asking = self.asking.lock().expect("asking");
        match asking.get_mut(&endpoint) {
            Some(again) => {
                *again = true;
                false
            }
            None => {
                asking.insert(endpoint, false);
                true
            }
        }
    }

    /// Whether the asking of `endpoint` goes on, as the peer announced more meanwhile: otherwise it is done.
    fn ask_again(&self, endpoint: EndpointId) -> bool {
        let mut asking = self.asking.lock().expect("asking");
        if asking.get(&endpoint) == Some(&true) {
            asking.insert(endpoint, false);
            true
        } else {
            asking.remove(&endpoint);
            false
        }
    }

    /// Tells the peers what changed whenever the node's logs may have, and every `retry` tries again the peers whose
    /// wait is over: those it couldn't tell, and those it failed to ask.
    async fn announcer(self: Arc<Self>) {
        let mut news = News { size: (usize::MAX, 0), peers: Vec::new() };
        loop {
            if let Some(fresh) = self.news(news.size).await {
                news = fresh;
            }
            self.announce(&news);
            let owed = self.owed.lock().expect("owed").ready();
            owed.into_iter().for_each(|endpoint| self.ask_soon(endpoint));
            tokio::select! {
                _ = self.changed.notified() => {}
                _ = tokio::time::sleep(self.opts.retry) => {}
            }
        }
    }

    /// What to tell each peer, worked out again if the device's ops changed since `size`; then whom the relay lets
    /// in, if the node keeps that. `None` if nothing changed.
    async fn news(self: &Arc<Self>, size: (usize, usize)) -> Option<News> {
        let news = self
            .lab(move |lab, me| {
                let now = lab.size(me);
                if now == size {
                    return None;
                }
                let mut peers = Vec::new();
                for (device, key) in lab.peers(me) {
                    let Ok(endpoint) = EndpointId::from_bytes(&key) else { continue };
                    peers.push((device, endpoint, lab.announce(me, device).into_iter().collect()));
                }
                Some(News { size: now, peers })
            })
            .await?;
        if let Some(admission) = &self.opts.admission {
            let known = news.peers.iter().map(|(_, endpoint, _)| *endpoint);
            admission.set(known.chain([self.endpoint.id()]).collect());
        }
        Some(news)
    }

    /// Tells each peer the digests of the logs it may hold by the node's view, if they changed since it was last told,
    /// each on a task of its own, so that a peer out of reach holds up nobody; one at a time, so that tasks don't pile
    /// up while it stays out of reach; and a peer it couldn't reach, only once its wait is over.
    fn announce(self: &Arc<Self>, news: &News) {
        let told = self.told.lock().expect("told").clone();
        for (device, endpoint, digests) in &news.peers {
            if told.get(device) == Some(digests) || !self.unreached.lock().expect("unreached").due(device) {
                continue;
            }
            if !self.telling.lock().expect("telling").insert(*device) {
                continue;
            }
            let (shared, device, endpoint, digests) = (self.clone(), *device, *endpoint, digests.clone());
            tokio::spawn(async move {
                let told = shared.tell(device, endpoint, digests).await.is_ok();
                let mut unreached = shared.unreached.lock().expect("unreached");
                if told { unreached.reached(&device) } else { unreached.failed(device, shared.opts.retry) };
                drop(unreached);
                shared.telling.lock().expect("telling").remove(&device);
            });
        }
    }

    /// Tells `device`, at `endpoint`, the digests `digests`.
    async fn tell(
        self: &Arc<Self>,
        device: SignerId,
        endpoint: EndpointId,
        digests: BTreeMap<LogId, [u8; 32]>,
    ) -> Result<()> {
        let peer = self.connection(endpoint).await?;
        if peer.device != device {
            bail!("the hello at {endpoint} proved another device");
        }
        let announce = Announce { digests: digests.iter().map(|(l, d)| (*l, *d)).collect() }.to_wire();
        session::exchange(&peer.conn, session::ANNOUNCE, &announce, 0).await?;
        self.sent.announcements.fetch_add(1, Ordering::Relaxed);
        self.told.lock().expect("told").insert(device, digests);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An offer with an address of each family and a relay.
    fn offer() -> Offer {
        let addr = EndpointAddr::new(SecretKey::from_bytes(&[3; 32]).public())
            .with_ip_addr("192.0.2.7:7401".parse().expect("an address"))
            .with_ip_addr("[2001:db8::7]:7401".parse().expect("an address"))
            .with_relay_url("https://avendb.maia.city".parse().expect("a URL"));
        Offer { device: SignerId([5; 32]), addr }
    }

    #[test]
    fn an_offer_reads_back_only_from_its_own_text() {
        let offer = offer();
        let text = offer.to_text();
        assert_eq!(Offer::from_text(&text).expect("its own text"), offer);
        assert!(text.len() < 200, "{} characters: a small QR code", text.len());
        // another version, a character base32 doesn't have, lowercase, cut short or grown
        let (cut, grown) = (text[..text.len() - 2].to_string(), format!("{text}AA"));
        for bad in [text.replacen(OFFER, "AVENDB2", 1), format!("{text}8"), text.to_lowercase(), cut, grown] {
            assert!(Offer::from_text(&bad).is_err(), "{bad}");
        }
        // the same offer written another way: its addresses the other way round, after the id, the device and their
        // count, an IPv4 address in 7 bytes and an IPv6 one in 19
        let mut bytes = offer.to_bytes();
        let (v4, v6) = (bytes[65..72].to_vec(), bytes[72..91].to_vec());
        bytes.splice(65..91, [v6, v4].concat());
        assert_eq!(Offer::from_bytes(&bytes), Some(offer), "which reads as the same offer");
        let swapped = format!("{OFFER}{}", BASE32_NOPAD.encode(&bytes));
        assert!(Offer::from_text(&swapped).is_err(), "but not from a text other than its own");
    }
}
