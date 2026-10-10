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
//! - **No curve trusted**: every node's Lab no longer trusts the curves (`Lab::set_pq_only`), so neither ed25519 nor
//!   P-256 alone makes an edit count: it counts only the writes that a checkpoint by their author covers, which carries
//!   an SLH-DSA signature, and vouches for each write of its own as it makes it, and at its start for those of its
//!   own that no checkpoint covers yet. Every other edit carries the SLH-DSA half of its signatures anyway.
//! - **Sync**: either end asks the other on the connection (`wire::Request`) and is answered with the edits it may
//!   receive by the other's view and the McEliece keys they name (`wire::Reply`), each key by its id and BLAKE3 hash
//!   alone. The asker fetches the keys it lacks over iroh-blobs, where a node hands a key out only to a device a hello
//!   proved that may fetch it (`Lab::may_fetch`), and checks each key against its id. A big answer comes a page at a
//!   time (P8d, `Options::page`), each edit after the edits it builds on: the asker takes each page as it comes and
//!   asks on after the last edit it got.
//! - **Announcements**: whenever a log changes, the node tells each peer that may hold it by the node's view
//!   (`Lab::announce`), straight over their connection, the digests that changed since it last told it; a peer whose
//!   digests differ asks. Not iroh-gossip: a topic can't tell a device of a log it doesn't know yet without telling
//!   every other member too, and its members learn each other's endpoints, while an announcement goes to one proven
//!   device. A peer it can't reach it tries again after `Options::retry`, then twice as long each time it stays out
//!   of reach, up to a minute, or at once when the peer connects to it.
//! - **Store** (P8b): with `Options::store`, a node keeps what its device holds in a folder (`Disk`), saved as it
//!   changes, and starts again from it.
//! - **The server** (P8b, `server`): a node whose device keeps a secret of its own beside its store, and which hands
//!   its contact card, avenCEO's log, to whoever asks (`Node::contact`), so that a vault can give avenCEO relay on its
//!   entries. Devices reach each other and the server through its relay, which lets in only the devices the server
//!   knows (`Admission`).
//! - **avenCEO** (P8f): a new server belongs to no vault, and the first human vault to claim it owns it
//!   (`Node::claim`): the server hands its key to seal to whoever asks while nobody has claimed it, the person's
//!   passkey founds avenCEO, an aven vault their human vault owns, and adds the server as its device, and the server
//!   signs that edit too and keeps it (`Lab::accept_claim`). A person's first device founds their vault through a
//!   server nobody has claimed yet and claims it in the same ceremony (`Node::found_with`). From then on the server
//!   acts for avenCEO and never governs it, and nobody claims it again.
//! - **Linking** (P8c): a device shows its offer as a QR code (`Node::offer`, `Offer::to_text`): its endpoint, its
//!   device and where it is reached. A new device of the same person scans it and links through it (`Node::link`):
//!   once the hellos proved both devices, the new device shows its person's passkey's pass for it on the connection
//!   (`sign::RelayPass`), an assertion and an SLH-DSA signature over the new device's id and when the pass was made;
//!   the peer checks it is for the device whose hello proved it, and hands back the logs of the vaults the passkey owns,
//!   and nothing else (`Lab::link_card`); the new device adds itself to the vault whose root is the passkey, signed by
//!   the passkey and by itself (`Lab::join`), and the peer accepts that edit alone, for that device alone
//!   (`Lab::accept_join`). Then they sync as devices of one vault. With every other device lost, a new device links
//!   the same way through the server, whose offer the app knows: the passkey alone brings the person's vault back. A
//!   device the server doesn't know yet makes that first contact straight, over UDP, or, with no UDP of its own,
//!   through the relay by the same pass (`Options::relay_pass`).
//! - **In a browser** (P8d): a page has no UDP, so its node reaches every peer through its relay, which lets the new
//!   device in by its passkey's pass (`sign::RelayPass`) until it joined; its TLS is ring, with X25519MLKEM768 in pure
//!   Rust (`kx`), and its tasks and timers run on the page's event loop.
//! - **The browser's passkey** (P8e): a passkey in the platform's authenticator signs in ceremonies, each of which asks
//!   its person (`sign::Ceremony`), so a browser signs up and links through an `Authenticator` in two: the ceremony
//!   that unlocks the new device, which is its pass, as the device made its secret before it; and one for the edits
//!   that found its person's vault (`Node::found_with`) or add it to it (`Node::link_with`). A device that didn't make
//!   the passkey learns its P-256 key in that second ceremony: the pass recovers to a few keys, and the second
//!   ceremony's assertion verifies under the passkey's alone. Edits drafted together are signed in one ceremony
//!   (`Lab::drafting`): a person's first device founds their vault, adds itself and claims a server nobody has claimed
//!   yet in one, drafted for each key the pass recovers to (`Lab::drafting_for`), and later the vaults their vault
//!   founds and owns in one more (`Node::approve_with`). A server open to sign-up (`Admission::open`) lets a person's
//!   first device onto its relay by a pass of any passkey, to found their vault and make it known; so does a server
//!   nobody has claimed yet, for its first device to claim it.

mod blobs;
mod disk;
pub mod kx;
pub mod server;
mod session;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::hash::Hash;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::id::{BlobId, SignerId, VaultId};
use avendb::keys::PublicKey;
use avendb::lab::{Drafting, Lab, Unsigned};
use avendb::id::EditId;
use avendb::policy::{Action, Kind, Principal, Refusal};
use avendb::sign::{Ceremony, RelayPass, Signed, SignerKeys};
use avendb::sync::{log_of, place, LogId};
use avendb::wire::{Announce, Claim, Join, Reply, Request, Wire};
use data_encoding::{BASE32_NOPAD, BASE64URL_NOPAD};
use iroh::address_lookup::MemoryLookup;
#[cfg(not(target_arch = "wasm32"))]
use iroh::endpoint::PortmapperConfig;
use iroh::endpoint::{Connection, presets};
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayConfig, RelayMap, RelayMode, RelayUrl, SecretKey};
use iroh_blobs::BlobsProtocol;
use iroh_blobs::store::mem::MemStore;
use rustls::crypto::CryptoProvider;
use n0_future::task::{self, JoinHandle};
use n0_future::time::{self, Instant};
use tokio::sync::{Notify, watch};

pub use disk::Disk;
pub use session::exporter;

/// avenDB's own ALPN: its sync protocol, version 1.
pub const ALPN: &[u8] = b"avendb/sync/1";

/// How long a node waits for a peer to connect, or to say its hello.
const WAIT: Duration = Duration::from_secs(10);

/// The longest a node waits before it tries a peer out of reach again.
const BACKOFF_MAX: Duration = Duration::from_secs(60);

/// The TLS of every node on a machine: aws-lc-rs with X25519MLKEM768 as its only key exchange, so that ML-KEM-768
/// agrees the keys of every connection along with X25519, and a peer that offers only classical groups finds none in
/// common. Ciphers with 256-bit keys first; AES-128 last, as QUIC protects its first packets with it.
#[cfg(not(target_arch = "wasm32"))]
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

/// The TLS of a node in a browser (P8d), where aws-lc-rs doesn't build: ring, with X25519MLKEM768 in pure Rust as its
/// only key exchange (`kx`), the same group as `pq_provider`'s; the same ciphers, in the same order.
#[cfg(target_arch = "wasm32")]
pub fn web_provider() -> Arc<CryptoProvider> {
    use rustls::crypto::ring::{cipher_suite, default_provider};
    Arc::new(CryptoProvider {
        kx_groups: vec![kx::X25519MLKEM768],
        cipher_suites: vec![
            cipher_suite::TLS13_AES_256_GCM_SHA384,
            cipher_suite::TLS13_CHACHA20_POLY1305_SHA256,
            cipher_suite::TLS13_AES_128_GCM_SHA256,
        ],
        ..default_provider()
    })
}

/// The TLS of this node: `pq_provider` on a machine, `web_provider` in a browser.
fn provider() -> Arc<CryptoProvider> {
    #[cfg(not(target_arch = "wasm32"))]
    return pq_provider();
    #[cfg(target_arch = "wasm32")]
    web_provider()
}

/// How a node runs.
#[derive(Clone, Debug)]
pub struct Options {
    /// The UDP socket it binds, or none: then it reaches its peers through its relay alone.
    pub bind: Option<SocketAddr>,
    /// It reaches its peers as directly as it can, as a device on its person's own machine does, the Mac app's: in
    /// place of `bind` it binds every interface, IPv4 and IPv6, on ports of the system's choosing, and maps a port on
    /// the network's router where one lets it (UPnP, NAT-PMP, PCP), so its peers reach it directly wherever they can,
    /// and through the relay only where they can't.
    pub direct: bool,
    /// The relay it is reached through, the server's; it looks for its peers there too.
    pub relay: Option<RelayUrl>,
    /// How soon it tries again to tell a peer it couldn't reach, or to ask one it failed to ask: after `retry`, then
    /// twice as long each time the peer stays out of reach, up to a minute.
    pub retry: Duration,
    /// The folder it keeps its store in (`Disk`), if any: it starts again from what it holds there.
    pub store: Option<PathBuf>,
    /// It is a server: it hands its contact card to whoever asks (`Node::contact`), and, while its device belongs to no
    /// vault, its key to seal to, for the first human vault to claim it (`Node::claim`).
    pub card: bool,
    /// Where it writes the endpoints of the devices it knows, for a relay to let them in: the server's.
    pub admission: Option<Admission>,
    /// The pass it shows its relay, signed by its person's passkey (`Lab::relay_pass`): a new device with no UDP of its
    /// own, as a browser's, which the server doesn't know until it joined, is let in by it for ten minutes.
    pub relay_pass: Option<RelayPass>,
    /// The most bytes of edits it answers a request with, but at least one edit: a peer asks on for the rest
    /// (`Lab::reply`).
    pub page: usize,
}

/// How many bytes of edits a node answers a request with, at most, unless told otherwise: a few hundred edits, each
/// with its signatures, so a big reply never waits whole in either end's memory, nor holds up the connection.
pub const PAGE: usize = 4 << 20;

impl Options {
    /// Nodes on one machine, as in the tests: loopback, no relay, and no lookup but the addresses a node is told.
    pub fn local() -> Options {
        Options {
            bind: Some(SocketAddr::from(([127, 0, 0, 1], 0))),
            direct: false,
            relay: None,
            retry: Duration::from_secs(1),
            store: None,
            card: false,
            admission: None,
            relay_pass: None,
            page: PAGE,
        }
    }
}

/// Who may use the server's relay: the endpoints of the devices the server knows, those of every vault in its view
/// whose keys it saw sign, and its own; and, for ten minutes, a new device whose pass a passkey signed that roots a
/// vault in its view (P8d, `sign::RelayPass`), or any passkey while nobody has claimed the server (P8f). The server's
/// node keeps it up to date as its view changes, from before its endpoint binds; the relay asks it about each client
/// that connects, and lets go of a client it stops admitting.
#[derive(Clone, Debug, Default)]
pub struct Admission {
    admitted: Arc<watch::Sender<Admitted>>,
    /// It honours a pass of any passkey (P8e, `Admission::open`).
    open: bool,
}

/// Whom the server's relay lets in, by the server's view.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Admitted {
    /// The endpoints of the devices it knows, and its own.
    pub endpoints: HashSet<EndpointId>,
    /// The passkeys whose passes it honours: those that root a vault it knows (`Lab::roots`).
    pub passkeys: HashSet<SignerId>,
    /// Nobody has claimed the server yet: it honours a pass of any passkey, for the device that claims it
    /// (`Node::claim`, `Node::found_with`).
    pub claimable: bool,
}

impl Admission {
    /// An admission open to sign-up (P8e): its relay honours a pass of any passkey, for its ten minutes, so that a
    /// person's first device with no UDP of its own, a browser, founds their vault and makes it known to the server
    /// (the vault gives the server relay on its entries): from then on the server knows the device. A device on UDP
    /// reaches the server so anyway; the relay's minutes are what it opens.
    pub fn open() -> Admission {
        Admission { open: true, ..Admission::default() }
    }

    /// The relay lets `endpoint` in.
    pub fn admits(&self, endpoint: &EndpointId) -> bool {
        self.admitted.borrow().endpoints.contains(endpoint)
    }

    /// The relay lets in the endpoint a pass of `passkey` names.
    pub fn honours(&self, passkey: &SignerId) -> bool {
        let admitted = self.admitted.borrow();
        self.open || admitted.claimable || admitted.passkeys.contains(passkey)
    }

    /// Marks each change of whom it admits.
    pub fn watch(&self) -> watch::Receiver<Admitted> {
        self.admitted.subscribe()
    }

    fn set(&self, admitted: Admitted) {
        self.admitted.send_if_modified(|now| *now != admitted && { *now = admitted; true });
    }
}

/// Signs in its person's passkey's ceremonies as a device founds its person's vault, links, claims a server or has
/// their vault approve a change (P8e, `Node::found_with`, `Node::link_with`, `Node::claim_with`,
/// `Node::approve_with`): a browser's WebAuthn, which asks its person each time, or a software passkey its Lab holds
/// (`Node::link`, `Node::claim`).
pub trait Authenticator {
    /// The passkey's ceremony over `challenge` (`sign::Ceremony`), for `step`.
    fn ceremony(&self, challenge: [u8; 32], step: Step) -> impl Future<Output = Result<Ceremony>>;
}

/// What a passkey's ceremony signs as its device founds its person's vault, links, claims a server or has their vault
/// approve a change. The ceremony that unlocks a new device, its pass, comes before any of them, from the device's own
/// app (`sign::RelayPass`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// The edit that adds the new device to its person's vault.
    Join,
    /// The genesis of its person's vault and the edit that adds their first device to it, which that device drafts
    /// together (`Node::found_with`); and, through a server nobody has claimed yet, avenCEO's genesis and the edit that
    /// adds the server to it.
    Found,
    /// The genesis of avenCEO, the aven vault its person's human vault founds as their device claims a server, and the
    /// edit that adds the server to it, drafted together (`Node::claim_with`).
    Claim,
    /// Changes its person's vault approves, as the root of the vaults it owns: new vaults it owns, an owner cap, the
    /// revocation of one, drafted together (`Node::approve_with`).
    Approve,
}

/// The genesis of avenCEO, an aven vault human vault `owner` owns alone, as its person claims a server.
fn aven(owner: VaultId) -> Action {
    let owners = vec![Principal::Vault(owner)];
    Action::Genesis { kind: Kind::Aven, owners, threshold: 1, root: None, nonce: 0, seal_to: vec![] }
}

/// The software passkey `1` in a node's Lab, which makes its ceremonies itself.
struct InLab(Arc<Shared>, SignerId);

impl Authenticator for InLab {
    async fn ceremony(&self, challenge: [u8; 32], _: Step) -> Result<Ceremony> {
        let passkey = self.1;
        self.0.lab(move |lab, _| lab.ceremony(passkey, challenge)).await.context("the passkey isn't at hand")
    }
}

/// The time by this machine's clock, or the browser's: seconds since 1970.
pub(crate) fn unix_now() -> u64 {
    time::SystemTime::now().duration_since(time::SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// A relay pass as the token a node shows its relay as it connects: base64url without padding, which a browser's
/// node carries in the query of the relay's URL, as a page can't set the headers of a WebSocket.
pub fn pass_token(pass: &RelayPass) -> String {
    BASE64URL_NOPAD.encode(&pass.to_wire())
}

/// The relay pass a token carries (`pass_token`), if it is one.
pub fn token_pass(token: &str) -> Option<RelayPass> {
    RelayPass::from_wire(&BASE64URL_NOPAD.decode(token.as_bytes()).ok()?).ok()
}

/// A device on the network: its Lab, split off for it (`Lab::split`), behind an iroh endpoint of its own key.
pub struct Node {
    shared: Arc<Shared>,
    router: Router,
    tasks: Vec<JoinHandle<()>>,
}

impl Node {
    /// Device `me` of `lab` on the network: it answers its peers, tells them when its logs change, and asks them when
    /// theirs differ. It trusts no curve (`Lab::set_pq_only`), and vouches at once for the writes of its own that no
    /// checkpoint covers yet. With a store, it first takes back what the store holds, if anything, and saves what it
    /// holds from then on. Fails while the device is locked, as its endpoint key is its own ed25519 key.
    pub async fn spawn(lab: Lab, me: SignerId, opts: Options) -> Result<Node> {
        let secret = lab.endpoint_secret(me).context("a device of this Lab, unlocked")?;
        let store = opts.store.clone();
        #[cfg(not(target_arch = "wasm32"))]
        let (lab, disk) = tokio::task::spawn_blocking(move || reopen(lab, me, store)).await??;
        // a page has no folders, nor threads to spare
        #[cfg(target_arch = "wasm32")]
        let (lab, disk) = reopen(lab, me, store)?;
        if let Some(admission) = &opts.admission {
            let own = SecretKey::from_bytes(&secret).public();
            let endpoints = endpoints(&lab.peers(me)).chain([own]).collect();
            let claimable = opts.card && lab.vault_of(me).is_none();
            admission.set(Admitted { endpoints, passkeys: lab.roots(me).into_iter().collect(), claimable });
        }
        let size = lab.size(me);
        let lookup = MemoryLookup::new();
        let mut builder = Endpoint::builder(presets::Empty)
            .secret_key(SecretKey::from_bytes(&secret))
            .crypto_provider(provider())
            .address_lookup(lookup.clone());
        // iroh's own sockets, on every interface, and its port mapping, for a node that reaches out directly; else
        // the one socket it binds, if any
        #[cfg(not(target_arch = "wasm32"))]
        if !opts.direct {
            builder = builder.portmapper_config(PortmapperConfig::Disabled).clear_ip_transports();
            if let Some(bind) = opts.bind {
                builder = builder.bind_addr(bind)?;
            }
        }
        // a page has no UDP: it reaches its peers through its relay alone
        #[cfg(target_arch = "wasm32")]
        if opts.bind.is_some() || opts.direct || opts.relay.is_none() {
            bail!("a node in a browser binds no socket and needs a relay");
        }
        if let Some(relay) = &opts.relay {
            let mut config = RelayConfig::from(relay.clone());
            if let Some(pass) = &opts.relay_pass {
                config = config.with_auth_token(pass_token(pass));
            }
            builder = builder.relay_mode(RelayMode::Custom(RelayMap::from(config)));
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
            size: watch::Sender::new(size),
            sent: Sent::default(),
        });
        let router = Router::builder(endpoint)
            .accept(ALPN, session::Protocol(shared.clone()))
            .accept(iroh_blobs::ALPN, BlobsProtocol::new(&store, Some(events)))
            .spawn();
        let tasks = vec![task::spawn(blobs::gate(shared.clone(), gate)), task::spawn(shared.clone().announcer())];
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
    /// code it scanned, or, with every other device lost, the server, whose offer the app knows (P8c). This device
    /// shows the passkey `passkey`'s pass for it on their connection (`sign::RelayPass`), which only it can show, as
    /// its hello proves it there; the peer hands back the logs of the vaults the passkey owns (`Lab::link_card`); this
    /// device adds itself to the one whose root is the passkey (`Lab::join`) and sends the peer that edit, which the
    /// peer accepts only if it adds this very device with the vault's approval (`Lab::accept_join`). Then they sync as
    /// devices of one vault. The vault it joined. Fails if the device answering isn't the one offered, the passkey
    /// isn't at hand, it roots no vault the peer knows, or the peer refuses the join; tried again, it sends the same
    /// join.
    pub async fn link(&self, offer: &Offer, passkey: SignerId) -> Result<VaultId> {
        let now = unix_now();
        let pass = self.shared.lab(move |lab, me| lab.relay_pass(me, passkey, now)).await;
        let pass = pass.context("the passkey isn't at hand")?;
        let (_, vault) = self.link_with(offer, &pass, &InLab(self.shared.clone(), passkey)).await?;
        Ok(vault)
    }

    /// `link`, with its person's passkey in the platform's authenticator (P8e): `pass` is the passkey's pass for this
    /// device, the ceremony that unlocked it, which the peer takes in place of a ceremony of the passkey's on their
    /// connection, and `authenticator` signs the one more ceremony linking takes, the edit that adds this device to its
    /// person's vault. The pass may be from any of a few passkeys, as this device may not know its passkey's P-256 key
    /// yet (`RelayPass::candidates`): the one whose vault the peer hands over is its person's, and its keys must be at
    /// hand in the Lab (`Lab::web_passkey`), as those of the others may be. That passkey and the vault it joined.
    pub async fn link_with(
        &self,
        offer: &Offer,
        pass: &RelayPass,
        authenticator: &impl Authenticator,
    ) -> Result<(SignerId, VaultId)> {
        let peer = self.offered(offer).await?;
        let card = session::exchange(&peer.conn, session::LINK, &pass.to_wire(), session::REPLY_LIMIT).await?;
        let Reply { mut edits, .. } = Reply::from_wire(&card)?;
        // a card carries vault logs, and nothing else
        edits.retain(of_a_vault);
        let passkeys = pass.candidates();
        let joining = self.shared.lab(move |lab, me| {
            lab.receive(me, edits, Vec::new());
            let at_hand = |p: &SignerId| lab.keys_of(*p).is_some();
            passkeys.into_iter().filter(at_hand).find_map(|p| Some((p, lab.joining(me, p).ok()?)))
        });
        let (passkey, joining) = joining.await.context("no vault of this passkey to join")?;
        let id = match joining {
            (_, Some(id)) => id,
            (vault, None) => {
                let add = move |lab: &mut Lab, me| {
                    lab.draft(me, &[passkey, me], Action::AddDevice { vault, device: me, seal_to: None })
                };
                let draft = self.shared.lab(add).await.map_err(|why| anyhow!("the join is refused: {why:?}"))?;
                let ceremony = authenticator.ceremony(draft.challenge(), Step::Join).await?;
                let complete = move |lab: &mut Lab, me| lab.complete(me, draft, &[(passkey, &ceremony)]);
                self.shared.lab(complete).await.map_err(|why| anyhow!("the passkey didn't sign the join: {why:?}"))?
            }
        };
        let join = self.shared.lab(move |lab, me| lab.joined(me, id)).await;
        let Action::AddDevice { vault, .. } = join.edit.edit.action else { bail!("a join that adds no device") };
        let sent = session::exchange(&peer.conn, session::JOIN, &join.to_wire(), 0).await;
        sent.context("the peer refuses the join")?;
        self.shared.changed.notify_one();
        self.shared.ask(peer.endpoint).await?;
        Ok((passkey, vault))
    }

    /// `found_with`, with `passkey` a software passkey this device's Lab holds.
    pub async fn found(&self, offer: &Offer, passkey: SignerId) -> Result<(VaultId, VaultId)> {
        let (_, vault, avenceo) = self.found_with(offer, &[passkey], &InLab(self.shared.clone(), passkey)).await?;
        Ok((vault, avenceo))
    }

    /// Found this device's person's human vault, its root their passkey, with this device in it, and make it known to
    /// the server `offer` names, whose card it takes (`contact`): `authenticator` signs the vault's genesis and the edit
    /// that adds this device in one ceremony (`Lab::drafting`). If the card names no avenCEO, as nobody has claimed the
    /// server yet, the same ceremony founds avenCEO, an aven vault the new human vault owns, and adds the server as its
    /// device, which the server signs too and keeps (`Lab::accept_claim`): the first person to found their vault
    /// through a server nobody has claimed owns it. Should another vault claim it first, this device takes that
    /// avenCEO from its card. The passkey is one of `passkeys`, whose keys the Lab holds: a device that doesn't know
    /// its passkey's P-256 key yet drafts it all for each key the passkey's pass recovers to, in one batch
    /// (`Lab::drafting_for`), and keeps the edits of the passkey the ceremony's assertion verifies under. That passkey,
    /// the human vault and avenCEO. Fails if the device answering isn't the one offered, this device belongs to a vault
    /// already, no passkey of `passkeys` made the ceremony, or the server names no avenCEO and takes no claim.
    pub async fn found_with(
        &self,
        offer: &Offer,
        passkeys: &[SignerId],
        authenticator: &impl Authenticator,
    ) -> Result<(SignerId, VaultId, VaultId)> {
        self.offered(offer).await?;
        if self.shared.lab(|lab, me| lab.vault_of(me)).await.is_some() {
            bail!("this device belongs to a vault already");
        }
        let named = self.avenceo(offer).await?;
        let key = match named {
            Some(_) => None,
            None => self.claim_key(offer).await.ok(),
        };
        let (server, claiming, passkeys) = (offer.device, key.is_some(), passkeys.to_vec());
        let draft = move |lab: &mut Lab, me| {
            let found = |drafting: &mut Drafting<'_>, passkey| {
                let (owners, root) = (vec![Principal::Signer(passkey)], Some(passkey));
                let genesis =
                    Action::Genesis { kind: Kind::Human, owners, threshold: 1, root, nonce: 0, seal_to: vec![] };
                let vault = VaultId::from(drafting.draft(&[passkey], genesis)?);
                drafting.draft(&[passkey, me], Action::AddDevice { vault, device: me, seal_to: None })?;
                if let Some(key) = &key {
                    let avenceo = VaultId::from(drafting.draft(&[passkey], aven(vault))?);
                    let add = Action::AddDevice { vault: avenceo, device: server, seal_to: Some(key.clone()) };
                    drafting.draft(&[passkey, server], add)?;
                }
                Ok(vault)
            };
            lab.drafting_for(me, &passkeys, found)
        };
        let sets = self.shared.lab(draft).await.map_err(|why| anyhow!("the vault is refused: {why:?}"))?;
        let (passkey, vault, claim) = self.sign(sets, claiming, Step::Found, authenticator).await?;
        let refused = match (claim, named) {
            (Some(claim), _) => match self.send_claim(offer, claim).await {
                Ok(avenceo) => return Ok((passkey, vault, avenceo)),
                Err(e) => e,
            },
            (None, Some(avenceo)) => return Ok((passkey, vault, avenceo)),
            (None, None) => anyhow!("the server takes no claim"),
        };
        // another vault claimed the server first: its card names that avenCEO
        let avenceo = self.avenceo(offer).await?.ok_or(refused)?;
        Ok((passkey, vault, avenceo))
    }

    /// Claim the server `offer` names for this device's person (P8f), while nobody has claimed it: the server hands its
    /// key to seal to (`Lab::claim_key`); the passkey `passkey`, used on this device, founds avenCEO, an aven vault
    /// this device's human vault owns, and adds the server as its device (`Lab::claim`); the server signs that edit too
    /// and keeps it (`Lab::accept_claim`), and this device keeps the server's join. Then they sync, and this device
    /// boxes avenCEO's key for the server. avenCEO. Tried again after a claim the server didn't take, it adds the
    /// server to the avenCEO that claim founded; after one whose answer was lost, it finds the server avenCEO's device
    /// already. Fails if the device answering isn't the one offered, this device belongs to no vault, the passkey isn't
    /// at hand, or another vault has claimed the server, or the server refuses the claim.
    pub async fn claim(&self, offer: &Offer, passkey: SignerId) -> Result<VaultId> {
        self.claim_with(offer, passkey, &InLab(self.shared.clone(), passkey)).await
    }

    /// `claim`, with `passkey` in the platform's authenticator (P8e): `authenticator` signs avenCEO's genesis and the
    /// edit that adds the server to it in one ceremony (`Lab::drafting`).
    pub async fn claim_with(
        &self,
        offer: &Offer,
        passkey: SignerId,
        authenticator: &impl Authenticator,
    ) -> Result<VaultId> {
        let endpoint = self.offered(offer).await?.endpoint;
        let human = self.shared.lab(|lab, me| lab.vault_of(me)).await.context("this device belongs to no vault")?;
        let server = offer.device;
        let key = match self.claim_key(offer).await {
            Ok(key) => key,
            Err(e) => {
                // a claim whose answer was lost: the server tells this device that it is avenCEO's already
                self.shared.ask(endpoint).await.ok();
                let claimed = self.shared.lab(move |lab, me| lab.aven_of(me, server)).await;
                return claimed.ok_or(e);
            }
        };
        let draft = move |lab: &mut Lab, me| {
            let mut drafting = lab.drafting(me);
            // a claim tried again, after one the server didn't take, adds the server to the avenCEO that one founded
            let avenceo = match lab.unclaimed_aven(me) {
                Some(avenceo) => avenceo,
                None => VaultId::from(drafting.draft(&[passkey], aven(human))?),
            };
            let add = Action::AddDevice { vault: avenceo, device: server, seal_to: Some(key) };
            drafting.draft(&[passkey, server], add)?;
            Ok::<_, Refusal>(drafting.done())
        };
        let drafts = self.shared.lab(draft).await.map_err(|why| anyhow!("the claim is refused: {why:?}"))?;
        let (_, (), claim) = self.sign(vec![(passkey, (), drafts)], true, Step::Claim, authenticator).await?;
        self.send_claim(offer, claim.context("a claim")?).await
    }

    /// Edits that need the approval of a vault its person's passkey `passkey` roots, or of one their vault owns, as the
    /// genesis of a vault their vault owns or an owner cap: `draft` drafts them on this device one on top of the
    /// other (`Lab::drafting`), and `authenticator` signs them all in one ceremony; then this device keeps them in that
    /// order and tells its peers. What `draft` returned. Fails if this device's view refuses one, or the passkey
    /// didn't sign them.
    pub async fn approve_with<T: Send + 'static>(
        &self,
        passkey: SignerId,
        draft: impl FnOnce(&mut Drafting<'_>, SignerId) -> Result<T, Refusal> + Send + 'static,
        authenticator: &impl Authenticator,
    ) -> Result<T> {
        let drafted = move |lab: &mut Lab, me| {
            let mut drafting = lab.drafting(me);
            let out = draft(&mut drafting, me)?;
            Ok::<_, Refusal>((out, drafting.done()))
        };
        let (out, drafts) = self.shared.lab(drafted).await.map_err(|why| anyhow!("refused: {why:?}"))?;
        self.sign(vec![(passkey, (), drafts)], false, Step::Approve, authenticator).await?;
        Ok(out)
    }

    /// The connection to the device `offer` names, once its hello proved it the device offered.
    async fn offered(&self, offer: &Offer) -> Result<Peer> {
        self.know(offer.addr.clone());
        let endpoint = offer.addr.id;
        let peer = self.shared.connection(endpoint).await?;
        if peer.device != offer.device {
            bail!("the device at {endpoint} isn't the one offered");
        }
        Ok(peer)
    }

    /// The avenCEO the server `offer` names is a device of, by its card (`contact`): none while nobody has claimed it.
    async fn avenceo(&self, offer: &Offer) -> Result<Option<VaultId>> {
        self.offered(offer).await?;
        self.shared.contact(offer.addr.id).await.context("the server's card")?;
        let server = offer.device;
        Ok(self.shared.lab(move |lab, me| lab.aven_of(me, server)).await)
    }

    /// The key to seal to the server `offer` names hands while nobody has claimed it (`Lab::claim_key`).
    async fn claim_key(&self, offer: &Offer) -> Result<PublicKey> {
        let peer = self.offered(offer).await?;
        let key = session::exchange(&peer.conn, session::CLAIM_KEY, &[], session::KEY_LIMIT).await;
        Ok(PublicKey::from_wire(&key.context("the server takes no claim: a vault has claimed it")?)?)
    }

    /// Sign `sets`, edits drafted for each of a few passkeys, one of them its person's, all over one batch
    /// (`Lab::drafting`, `Lab::drafting_for`), in one ceremony for `step` made by `authenticator`; and keep the set of the
    /// passkey whose P-256 key the ceremony's assertion verifies under, on this device in the order it was drafted; but
    /// its last edit, if `claiming`, which adds a server to avenCEO: this device's claim of it (`Lab::claim`), which the
    /// server signs too (`send_claim`). That passkey, what its set was drafted with, and the claim.
    async fn sign<T: Send + 'static>(
        &self,
        sets: Vec<(SignerId, T, Vec<Unsigned>)>,
        claiming: bool,
        step: Step,
        authenticator: &impl Authenticator,
    ) -> Result<(SignerId, T, Option<Claim>)> {
        let first = sets.first().and_then(|(_, _, drafts)| drafts.first());
        let challenge = first.context("nothing to sign")?.challenge();
        let ceremony = authenticator.ceremony(challenge, step).await?;
        let keep = move |lab: &mut Lab, me| {
            let made = |p: SignerId| match lab.keys_of(p) {
                Some(SignerKeys::Passkey { p256, .. }) => ceremony.assertion.verify(&p256, EditId(challenge)),
                _ => false,
            };
            let (passkey, out, mut drafts) = sets.into_iter().find(|(p, _, _)| made(*p)).ok_or(Refusal::BadSignature)?;
            let claim = if claiming { drafts.pop() } else { None };
            for draft in drafts {
                lab.complete(me, draft, &[(passkey, &ceremony)])?;
            }
            let claim = claim.map(|draft| lab.claim(me, draft, &[(passkey, &ceremony)])).transpose()?;
            Ok::<_, Refusal>((passkey, out, claim))
        };
        let kept = self.shared.lab(keep).await.map_err(|why| anyhow!("the passkey didn't sign it all: {why:?}"))?;
        self.shared.changed.notify_one();
        Ok(kept)
    }

    /// Send the server `offer` names this device's claim of it (`sign`), and keep the join it answers with, which makes
    /// the server a device of avenCEO. Then they sync. avenCEO.
    async fn send_claim(&self, offer: &Offer, claim: Claim) -> Result<VaultId> {
        let peer = self.offered(offer).await?;
        let (id, server) = (claim.add.id(), offer.device);
        let Action::AddDevice { vault: avenceo, .. } = claim.add.action else { bail!("a claim that adds no device") };
        let join = session::exchange(&peer.conn, session::CLAIM, &claim.to_wire(), session::REPLY_LIMIT).await;
        let Join { edit, blobs } = Join::from_wire(&join.context("the server refuses the claim")?)?;
        if edit.edit.id() != id {
            bail!("the server answered the claim with another edit");
        }
        let blobs = blobs.into_iter().map(Arc::from).collect();
        let kept = self.shared.lab(move |lab, me| {
            lab.receive(me, vec![edit], blobs);
            lab.aven_of(me, server)
        });
        if kept.await != Some(avenceo) {
            bail!("the server's join doesn't make it avenCEO's device");
        }
        self.shared.changed.notify_one();
        self.shared.ask(peer.endpoint).await?;
        Ok(avenceo)
    }

    /// Tell it where a peer is.
    pub fn know(&self, addr: EndpointAddr) {
        self.shared.lookup.add_endpoint_info(addr);
    }

    /// Act on its Lab as its device, as its app does: a write, a cap, an edit. Then it tells its peers of whatever
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

    /// Ask the device at endpoint `peer` now, whatever it announced: the edits and McEliece keys it may send this one.
    /// How many edits were new.
    pub async fn sync_with(&self, peer: EndpointId) -> Result<usize> {
        self.shared.ask(peer).await
    }

    /// Ask the device at endpoint `peer` for its contact card (`Lab::card`), as a device asks the server for its
    /// vault's log before a vault gives the server relay on its entries. How many edits were new.
    pub async fn contact(&self, peer: EndpointId) -> Result<usize> {
        self.shared.contact(peer).await
    }

    /// Marks each change of what its device holds: how many edits and McEliece keys (`Lab::size`), after every act of
    /// its own and every edit it takes from a peer. A browser saves what changed to its store (P8e).
    pub fn changes(&self) -> watch::Receiver<(usize, usize)> {
        self.shared.size.subscribe()
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

/// Device `me` of `lab` with its store in folder `store`, if it keeps one: trusting no curve (`Lab::set_pq_only`),
/// what the store holds taken back, if it holds anything, a checkpoint for the writes of its own that none covers yet,
/// and whatever else the device holds saved.
fn reopen(mut lab: Lab, me: SignerId, store: Option<PathBuf>) -> Result<(Lab, Option<Disk>)> {
    lab.set_pq_only(true);
    let mut disk = match store {
        Some(dir) => {
            let (disk, saved) = Disk::open(&dir)?;
            if !disk.is_empty() {
                lab.restore_backup(me, &saved);
            }
            Some(disk)
        }
        None => None,
    };
    lab.checkpoint(me);
    if let Some(disk) = &mut disk {
        disk.adopt(&lab, me)?;
    }
    Ok((lab, disk))
}

/// `s` is an edit of a vault's log (`sync::log_of`), all that a card carries.
fn of_a_vault(s: &Signed) -> bool {
    matches!(log_of(&s.edit, s.edit.id()), Some(LogId::Vault(_)))
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
    /// How many edits and McEliece keys its device holds (`Node::changes`).
    size: watch::Sender<(usize, usize)>,
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

/// What a node tells each peer: the digests of the logs the peer may hold, as worked out for the device's edits when
/// they were as many as `size` says (`Lab::size`).
struct News {
    size: (usize, usize),
    peers: Vec<(SignerId, EndpointId, BTreeMap<LogId, [u8; 32]>)>,
    /// The passkeys that root the vaults in the device's view, whose passes a server's relay honours.
    roots: Vec<SignerId>,
    /// The node is a server whose device belongs to no vault yet: nobody has claimed it.
    claimable: bool,
}

impl Shared {
    /// `f` on the Lab, off the async threads: its crypto takes milliseconds, a McEliece key pair seconds. Then what
    /// the device took is saved, if the node keeps a store.
    async fn lab<T: Send + 'static>(self: &Arc<Self>, f: impl FnOnce(&mut Lab, SignerId) -> T + Send + 'static) -> T {
        let shared = self.clone();
        let work = move || {
            let mut lab = shared.lab.lock().expect("the Lab");
            let out = f(&mut lab, shared.me);
            shared.save(&lab);
            shared.size.send_if_modified(|size| *size != lab.size(shared.me) && { *size = lab.size(shared.me); true });
            out
        };
        #[cfg(not(target_arch = "wasm32"))]
        return tokio::task::spawn_blocking(work).await.expect("the Lab's task");
        // a page's node runs in a worker of its own, which the Lab may hold up
        #[cfg(target_arch = "wasm32")]
        work()
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
        let conn = time::timeout(WAIT, dial).await.context("no answer")??;
        match time::timeout(WAIT, session::dial_hello(self, &conn)).await {
            Ok(Ok(device)) => {
                let peer = self.connected(conn, device);
                task::spawn(session::serve(self.clone(), peer.clone()));
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

    /// A connection whose hellos proved `device`, dialed or accepted: the one to its endpoint from now on. A new
    /// connection starts their talk over: the node tells the peer every digest again, at once.
    fn connected(&self, conn: Connection, device: SignerId) -> Peer {
        let endpoint = conn.remote_id();
        let peer = Peer { conn, device, endpoint };
        self.peers.lock().expect("peers").insert(endpoint, peer.clone());
        self.proven.lock().expect("proven").insert(endpoint, device);
        self.told.lock().expect("told").remove(&device);
        self.unreached.lock().expect("unreached").reached(&device);
        self.changed.notify_one();
        peer
    }

    /// Asks `endpoint` for the edits the device there may send this one, and the McEliece keys they name that this one
    /// lacks: a page at a time, each taken as it comes, asking on after the last edit a page brought until the peer has
    /// no more. How many edits were new.
    async fn ask(self: &Arc<Self>, endpoint: EndpointId) -> Result<usize> {
        let peer = self.connection(endpoint).await?;
        let device = peer.device;
        let (mut after, mut new) = (None, 0);
        loop {
            let request = self.lab(move |lab, me| Request { after, ..lab.request(me, device) }).await.to_wire();
            let reply = session::exchange(&peer.conn, session::REQUEST, &request, session::REPLY_LIMIT).await?;
            self.sent.requests.fetch_add(1, Ordering::Relaxed);
            let Reply { edits, blobs, more } = Reply::from_wire(&reply)?;
            // where the next page starts: a page that brings nothing past the last ends the asking
            let last = edits.iter().map(|s| place(&s.edit)).max().filter(|&l| after.is_none_or(|a| l > a));
            let lacking = move |lab: &mut Lab, me| -> Vec<(BlobId, [u8; 32])> {
                blobs.into_iter().filter(|(b, _)| lab.blob(me, *b).is_none()).collect()
            };
            let lacking = self.lab(lacking).await;
            let keys = self.fetch(endpoint, lacking).await;
            let fetched = !keys.is_empty();
            let got = self.lab(move |lab, me| lab.receive(me, edits, keys)).await;
            if got > 0 || fetched {
                self.changed.notify_one();
            }
            new += got;
            match last {
                Some(last) if more => after = Some(last),
                _ => return Ok(new),
            }
        }
    }

    /// Asks `endpoint` for its contact card, and takes its vault logs. How many edits were new.
    async fn contact(self: &Arc<Self>, endpoint: EndpointId) -> Result<usize> {
        let peer = self.connection(endpoint).await?;
        let reply = session::exchange(&peer.conn, session::CARD, &[], session::REPLY_LIMIT).await?;
        let Reply { mut edits, .. } = Reply::from_wire(&reply)?;
        // a card carries vault logs, and nothing else
        edits.retain(of_a_vault);
        let new = self.lab(move |lab, me| lab.receive(me, edits, Vec::new())).await;
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
        task::spawn(async move {
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
        let mut news = News { size: (usize::MAX, 0), peers: Vec::new(), roots: Vec::new(), claimable: false };
        loop {
            if let Some(fresh) = self.news(news.size).await {
                news = fresh;
            }
            self.announce(&news);
            let owed = self.owed.lock().expect("owed").ready();
            owed.into_iter().for_each(|endpoint| self.ask_soon(endpoint));
            time::timeout(self.opts.retry, self.changed.notified()).await.ok();
        }
    }

    /// What to tell each peer, worked out again if the device's edits changed since `size`; then whom the relay lets
    /// in, if the node keeps that. `None` if nothing changed.
    async fn news(self: &Arc<Self>, size: (usize, usize)) -> Option<News> {
        let server = self.opts.card;
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
                Some(News { size: now, peers, roots: lab.roots(me), claimable: server && lab.vault_of(me).is_none() })
            })
            .await?;
        if let Some(admission) = &self.opts.admission {
            let endpoints = news.peers.iter().map(|(_, endpoint, _)| *endpoint).chain([self.endpoint.id()]).collect();
            let passkeys = news.roots.iter().copied().collect();
            admission.set(Admitted { endpoints, passkeys, claimable: news.claimable });
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
            task::spawn(async move {
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
