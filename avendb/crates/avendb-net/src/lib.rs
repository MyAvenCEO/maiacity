//! avenDB on the network (P8): each device a node of its own on an iroh endpoint, syncing with its peers by the bytes
//! of `avendb::wire` over avenDB's own ALPN, `avendb/sync/1`. The media vault's iroh (`vault/`) is another workspace
//! and stays as it is.
//!
//! - **Who**: a node's endpoint key is its device's ed25519 key, so iroh's TLS proves the endpoint. Each connection
//!   then opens with a hello each way (`sign::Hello`): the device's post-quantum signature over the connection's TLS
//!   exporter, which proves the device itself, by both its keys, on this connection alone. The listener checks the
//!   dialer's hello before it sends its own and closes a connection without one; the dialer checks the listener's.
//! - **Key exchange**: X25519MLKEM768 is the only group either end offers (`pq_provider`): ML-KEM-768 agrees the keys
//!   of every connection along with X25519, and a peer that offers only classical groups doesn't connect.
//! - **No curve trusted**: every signature on every edit is ML-DSA-65, but on the SLH-DSA edits the fork froze, which
//!   count by the legacy anchor alone (`avendb::legacy`), so neither ed25519 nor P-256 makes an edit count; a passkey's WebAuthn assertion beside it
//!   only proves its person took part.
//! - **Sync**: either end asks the other on the connection (`wire::Request`) and is answered with the edits it may
//!   receive by the other's view and the McEliece keys they name (`wire::Reply`), each key by its id and BLAKE3 hash
//!   alone. The asker fetches the keys it lacks over iroh-blobs, where a node hands a key out only to a device a hello
//!   proved that may fetch it (`Lab::may_fetch`), and checks each key against its id. A big answer comes a page at a
//!   time (P8d, `Options::page`), each edit after the edits it builds on: the asker takes each page as it comes and
//!   asks on after the last edit it got.
//! - **Holdings** (v8 phase H, `holdings`): each device tells each peer, straight over their connection, what it holds
//!   for good of the logs and files the peer may know by its view (`wire::Announce`): of each log its frontier and the
//!   edits there waiting for their past, of each file all of it or some of its pieces. All of it on each new
//!   connection, then only what changed. A node keeps what each device told it, on the connection whose hello proved
//!   that device alone, and asks a peer for the logs where it holds what the node lacks, and those alone
//!   (`session::ASK_LOGS`); it fetches a file first from the peers that hold it, and shows where each entry and file is
//!   synced to (`Node::synced_to`). Holdings route and never let anyone do anything: the blob gate hands a file out by
//!   T27 alone. Not iroh-gossip: a topic can't tell a device of a log it doesn't know yet without telling every other
//!   member too, and its members learn each other's endpoints, while an announcement goes to one proven device. A
//!   peer it can't reach it tries again after `Options::retry`, then twice as long each time it stays out of reach,
//!   up to a minute, or at once when the peer connects to it.
//! - **Signed holdings** (H2, `statements`): each device also signs what it tells each peer it holds, with when it
//!   checked (`wire::Statement`), and hands it to the peers it is connected to (`session::STATE`). A node keeps the
//!   newest statement of each device it knows, whoever brought it, passes it on to a connected peer that may know all
//!   of it, and keeps it on its shelf; Synced to lists a device on no live connection by it, with that time.
//! - **Shelf** (v8 phase S, `shelf`): with `Options::shelf`, a node keeps what its device holds on its shelf, the one
//!   place it keeps what lasts, laid out the same everywhere: a page's in OPFS, the Mac's in its folder (`disk`), the
//!   server's in its S3 bucket (`bucket`), every object sealed, its folder only a cache. It saves its device's edits
//!   there as they change (`edits`), and starts again from it. What it holds for good, as it tells its peers, is what
//!   its shelf holds: on the server, what its bucket took. A place puts a shelf aside by starting a new generation
//!   beside it, and never deletes one: avenDB is never reset (`shelf::FLOOR`).
//! - **Snapshots** (`backup`, `doc:docs/avendb`): the server backs up each vault into a folder of its own of a bucket of
//!   snapshots, by the frontiers of its newest snapshot, as a device asks a peer, each blob once (`Node::back_up`); a
//!   snapshot restores onto a new shelf as a node's own edits and files (`backup::restore`, `backup::rehearse`), and
//!   each day's check reads the bucket without restoring (`backup::Folder::check`).
//! - **Files** (blobs B2, `files`): a node keeps one iroh-blobs store, over its shelf (blobs B2d, B3b, `shelf`), or
//!   else in memory: what it brings and keeps whole goes onto the shelf. It brings a file sealed as it reads it
//!   (`Node::store_file`), reads any range of a file its device opens, fetching only the sealed segments that hold it
//!   (`Node::read_file`), and keeps whole the files its device's keep shares say to keep, or with none over a vault
//!   but never ones, if it keeps files (`Options::keep`), as the server does, every file of the vault it syncs. A
//!   file it needn't keep it lets go of when told (`Node::let_go`), as an agent device does once its person's Mac
//!   holds the file whole by its own word (`Node::holds_whole`). It fetches blobs, files and McEliece keys alike, over
//!   one pool of blob connections, the keys a reply names in one request (`blobs`). Its blob gate lets in a blob
//!   connection only from an endpoint whose live sync connection a hello proved, and hands a file's root or pieces
//!   only to a device that may fetch the file (T27).
//! - **Keep shares** (blobs B2c, V1c): a node sends a peer's device only the entries it may receive and its keep
//!   shares want, by the stewards' marks (T28).
//! - **One API** (V2, `run`): every read and change of a device's database, from its page, the Mac app or an agent, is
//!   one op of avendb's engine, JSON in and JSON out (`Node::run`): the node shows where its entries and files are
//!   synced to, reads and brings a file's bytes beside the op, has the passkey sign in its ceremony what the vault's
//!   owners approve, and asks its peers again once the vaults its device follows change.
//! - **Progress**: a node marks each step of founding its person's vault or linking to it (`Options::progress`), with
//!   how long it took, for its person to watch while they wait (`Progress`).
//! - **The server** (P8b, `server`): a node whose device keeps a secret of its own on its shelf, and which hands
//!   its contact card, avenMAIA's log and its owners', to whoever asks (`Node::contact`), so that a vault can
//!   give avenMAIA relay on its entries. Devices reach each other and the server through its relay, which lets
//!   in only the devices the server knows (`Admission`).
//! - **avenMAIA** (P8f): a new server belongs to no vault, and the first human vault to claim it owns it
//!   (`Node::claim`): the server hands its key to seal to whoever asks while nobody has claimed it, the person's
//!   passkey founds the seed, its last vault avenMAIA, a device vault Maia City owns, and adds the server as
//!   its device, and the server signs that edit too and keeps it (`Lab::accept_claim`). A person's first device founds
//!   their vault through a server nobody has claimed yet and claims it in the same ceremony (`Node::found_with`). From
//!   then on the server acts as avenMAIA and never governs it, and nobody claims it again.
//! - **Adding a device vault** (`Place`, `Node::add_device_vault_with`): the claim is one case of the one flow that
//!   adds a device of its own to a vault: a device vault founded under its parent, or there already, the device added
//!   to it, which signs that edit too, as it answers claims while it belongs to no vault (`Options::card`); then the
//!   parent passes shares on to it. So a person's Mac adds agentClaude under their aven, founded with it if they have
//!   none yet, in one ceremony of their passkey.
//! - **Linking** (P8c): a device shows its offer as a QR code (`Node::offer`, `Offer::to_text`): its endpoint, its
//!   device and where it is reached. A new device of the same person scans it and links through it (`Node::link`):
//!   once the hellos proved both devices, the new device shows its person's passkey's pass for it on the connection
//!   (`sign::RelayPass`), an assertion and a post-quantum signature over the new device's id and when the pass was made
//!   (it shows one in each suite, one after the other, as its person's vault may know the passkey in either);
//!   the peer checks it is for the device whose hello proved it, and hands back the logs of the vaults the passkey owns,
//!   and nothing else (`Lab::link_card`); the new device adds itself to the vault whose root is the passkey, signed by
//!   the passkey and by itself (`Lab::join`), and the peer accepts that edit alone, for that device alone
//!   (`Lab::accept_join`). Then they sync as devices of one vault. With every other device lost, a new device links
//!   the same way through the server, whose offer the app knows: the passkey alone brings the person's vault back. A
//!   device the server doesn't know yet makes that first contact straight, over UDP, or, with no UDP of its own,
//!   through the relay by the same pass (`Options::relay_passes`).
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

#[cfg(not(target_arch = "wasm32"))]
pub mod backup;
#[cfg(test)]
mod bench;
mod node_loop;
mod blind;
mod blobs;
#[cfg(not(target_arch = "wasm32"))]
mod congestion;
#[cfg(not(target_arch = "wasm32"))]
pub mod bucket;
#[cfg(not(target_arch = "wasm32"))]
pub mod claim;
mod interest;
mod discovery;
mod checkpoint_delivery;
mod bootstrap_dependencies;
#[cfg(not(target_arch = "wasm32"))]
pub mod disk;
#[cfg(not(target_arch = "wasm32"))]
mod disk_queue;
mod edit_ranges;
mod edit_ranges_wire;
mod edit_summaries;
mod edit_transfer;
mod edits;
mod files;
mod fresh;
mod holdings;
mod jobs;
pub mod kx;
mod lifecycle;
mod lab_schedule;
mod limits;
mod progress;
mod proofs;
mod peer_receipts;
mod receipt_tracker;
mod pulls;
mod live;
mod ranges;
mod run;
mod scoped;
pub mod server;
mod session;
pub mod shelf;
mod posts_page;
mod shared_index;
pub mod query_window;
mod told_index;
// the index gate's on-disk index; the sync lane wires it in place of S7's spill (`avendb::lab::held`)
#[cfg_attr(not(test), allow(dead_code))]
mod shelf_index;
#[cfg(test)]
mod shelf_contract;
mod signers;
#[cfg(all(feature = "sim", not(target_arch = "wasm32")))]
pub mod sim;
mod statements;
mod traffic;
pub mod transports;
mod tree;
#[cfg(not(target_arch = "wasm32"))]
mod writer;

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::hash::Hash;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::engine::follow_standing;
use avendb::id::{BlobId, EditId, EntryId, ShareId, SignerId, VaultId};
use avendb::keys::PublicKey;
use avendb::lab::{Drafting, Lab, Unsigned, Warm};
use avendb::policy::{Action, Kind, Principal, Refusal, Sharing};
use avendb::sealed::{FileRoot, PIECE};
use avendb::sign::{Ceremony, RelayPass, Signed, SignerKeys};
use avendb::sync::{LogId, log_of, place};
use avendb::wire::{Announce, Claim, FileHold, Join, Packed, Reply, Request, Statement, Wire};
use data_encoding::{BASE32_NOPAD, BASE64URL_NOPAD};
use iroh::address_lookup::MemoryLookup;
#[cfg(not(target_arch = "wasm32"))]
use iroh::endpoint::PortmapperConfig;
use iroh::endpoint::{Connection, presets};
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayConfig, RelayMap, RelayMode, RelayUrl, SecretKey, Watcher as _};
use iroh_blobs::BlobsProtocol;
use iroh_blobs::api::Store;
#[cfg(not(target_arch = "wasm32"))]
use iroh_blobs::store::mem::MemStore;
use iroh_blobs::util::connection_pool::{self, ConnectionPool};
use n0_future::task::{self, JoinHandle};
use n0_future::time::{self, Instant};
use n0_future::{FuturesUnordered, StreamExt as _, future};
use rustls::crypto::CryptoProvider;
use serde_json::{Value, json};
use tokio::sync::{Notify, watch};

use holdings::{Logs, MOST};

pub use files::Source;
pub use holdings::{Holder, Holdings, SyncedTo};
pub use jobs::{HISTORY, Job, Jobs, Running, State as JobState};
pub use limits::{Limits, Usage};
pub use progress::{Ending, Progress, Stage, Steps};
pub use run::{NoBytes, NoCeremony};
pub use session::exporter;
pub use shelf::{Call, Shelf, Writer};

/// avenDB's own ALPN: its sync protocol, version 1.
pub const ALPN: &[u8] = b"avendb/sync/1";

/// How long a node waits for a peer to connect, or to say its hello.
const WAIT: Duration = Duration::from_secs(10);

/// How long a dial waits for its peer before a new one starts beside it (`Shared::dial`): a dial whose first packets
/// were lost, as while the peer isn't on its relay yet, sends them again ever later (QUIC's backoff: after 1, 2, 4 and
/// 8 seconds), where a new dial sends its first at once.
const REDIAL: Duration = Duration::from_secs(2);

/// How long a node with no socket of its own waits for its relay to let it in before it reaches out anyway
/// (`Node::on_relay`).
const RELAY_WAIT: Duration = Duration::from_secs(20);

/// How long a claim holds with no page of its asking landing before a peer owed its logs takes them (`Claims::take`,
/// `LivePriority.lean` `takes`): a few pages' time on a phone's relay, where a page took 5-14 s.
const HANDOVER: Duration = Duration::from_secs(15);

/// How long a node with no socket of its own waits for iroh to pick its relay before it has it pick again
/// (`Node::on_relay`): iroh picks it by a report of how fast each relay answers, which a browser times by an HTTPS
/// request; a report with no answer in its three seconds picks none, and the next comes only 20 to 26 seconds on.
const RELAY_PICK: Duration = Duration::from_secs(2);

/// The longest a node waits before it tries a peer out of reach again.
const BACKOFF_MAX: Duration = Duration::from_secs(60);

/// How long a blob connection nothing uses stays open.
const IDLE: Duration = Duration::from_secs(30);

/// How long a node waits for a page of edits it asked a peer for (`Shared::pages`): one that never comes, over a
/// connection kept open, would hold its pull, and the sync bar, for ever (Samuel's iPhone 2026-10-21, "syncing" at 19%
/// with two pulls running). The asking fails, and the node asks again as it does any it failed (`node_loop`).
const PAGE_WAIT: Duration = Duration::from_secs(180);

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
/// Every connection's QUIC: iroh's, its send rate set by BBR v3 and Cubic together (`congestion`).
fn quic() -> iroh::endpoint::QuicTransportConfig {
    let builder = iroh::endpoint::QuicTransportConfig::builder();
    #[cfg(not(target_arch = "wasm32"))]
    let builder = builder.congestion_controller_factory(Arc::new(congestion::EitherConfig::default()));
    builder.build()
}

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
    /// It reaches its relay through the HTTP proxy its environment names (`HTTPS_PROXY` and the like), as a node in a
    /// cloud session must, whose only way out is its proxy: iroh tunnels the relay's connection through it, and the TLS
    /// inside, X25519MLKEM768 alone, is the node's own end to end.
    pub proxy: bool,
    /// It asks its peers for nothing on its own, as a cloud session's agent does: not what a peer announces it holds,
    /// nor again once the vaults it follows change; only what it is told to bring (`Node::bring`, `Node::sync_with`),
    /// so a fresh one never pulls all its device may hold, but the vaults a tool call touches.
    pub lazy: bool,
    /// A device that holds nothing yet when it starts takes its first sync with the boxes it needs not now held back
    /// as stubs, and their bodies in the pull after (`Lab::set_lazy_boxes`): on by default, never for a server (`card`,
    /// `keep`) or a node that asks only when told (`lazy`).
    pub first_sync_stubs: bool,
    /// How soon it tries again to tell a peer it couldn't reach, or to ask one it failed to ask: after `retry`, then
    /// twice as long each time the peer stays out of reach, up to a minute.
    pub retry: Duration,
    /// Its shelf, if it keeps one (`shelf`): a page's in OPFS, the Mac's in its folder (`disk`), the server's in its
    /// bucket (`bucket::shelf`). It starts again from the edits its device kept there (`edits`), saves there what its
    /// device takes, and keeps there whole the files it brings and keeps. A node on a machine with none keeps nothing
    /// past its end, its blobs in memory; a page needs one.
    pub shelf: Option<Shelf>,
    /// It keeps whole every file the edits its device holds bring, fetched from its peers as soon as it learns of them
    /// (`files`): the server's backup. Its device's keep shares over a vault say otherwise for that vault's files
    /// (`avendb::lab::Lab::kept_files`).
    pub keep: bool,
    /// It is a server or an agent's device: it hands its contact card to whoever asks (`Node::contact`), and, while its
    /// device belongs to no vault, its key to seal to, for the first human vault to claim it (`Node::claim`,
    /// `Node::add_device_vault_with`).
    pub card: bool,
    /// Where it writes the endpoints of the devices it knows, for a relay to let them in: the server's.
    pub admission: Option<Admission>,
    /// The passes it shows its relay, signed by its person's passkey (`Lab::relay_pass`): a new device with no UDP of
    /// its own, as a browser's, which the server doesn't know until it joined, is let in by one for ten minutes.
    pub relay_passes: Vec<RelayPass>,
    /// The most bytes of edits it answers a request with, but at least one edit: a peer asks on for the rest
    /// (`Lab::reply`).
    pub page: usize,
    /// Where it marks the steps of its start, its own (`node`, once its store is replayed) and those of founding its
    /// person's vault or linking to it (`Node::found_with`, `Node::link_with`), for its person to watch.
    pub progress: Progress,
    /// The simulated network it is on (P7, `sim`), in place of every socket and relay: a scenario's own.
    #[cfg(all(feature = "sim", not(target_arch = "wasm32")))]
    pub sim: Option<sim::Net>,
    /// It keeps the blind index rows the devices it syncs with tell it, on its shelf, and answers `find` from them
    /// (`blind`, P4 of sync v2): the server's.
    pub index: bool,
    /// It takes a peer's edits with paths up to their signer's signed roots in place of their signatures (P8,
    /// `spec/AvenDB/WireBatches.lean`), each root once a reply: a device's. The server asks for signatures alone for
    /// one release, so that it serves every edit it holds to an old app, which reads signatures alone.
    pub paths: bool,
    /// It keeps the segments of the writers whose edits it holds (S8, `spec/AvenDB/Segments.lean`): each one's ids in
    /// order and the newest root it signed over them, taken only once they rebuild that root, so it makes their paths
    /// for any peer, as a relay, and a page through it costs one signature check per writer, not per edit. It asks
    /// peers for segments first (`proofs` version 3), and versions 2 and 1 of a peer that doesn't know them. On since
    /// Samuel's go (2026-10-27): a node that keeps segments still serves old apps their signatures where it keeps them
    /// (`paths` off), and keeps every signature; dropping those a signed segment covers is a later step of its own.
    pub segments: bool,
    /// The most pages a pull keeps in flight from one peer (S6, `pulls::Window`): asked at once where the peer says
    /// they end (`session::CUTS`), and taken in order. 1 asks each page once the one before came, as nodes did before.
    pub window: usize,
}

/// How many bytes of edits a node answers a request with, at most, unless told otherwise: a few hundred edits, each
/// with its signatures, so a big reply never waits whole in either end's memory, nor holds up the connection.
pub const PAGE: usize = 4 << 20;

/// How many entries a catch-up shows anew in one turn of the Lab (`Lab::catch_up_step`): about 0.35 ms each on a
/// server's core (measured 2026-10-27), so a turn of 48 holds the Lab some 17 ms.
pub(crate) const CATCH_UP_SLICE: usize = 48;

/// How long one step of a catch-up may hold the Lab: each step's budget follows how long the last one took
/// (`catch_up_budget`), from `CATCH_UP_SLICE`, so a phone's WebAssembly, several times slower than a server's core, takes
/// steps as short (G5: a person's write applied within 50 ms during a catch-up, 2026-10-27).
const CATCH_UP_TURN: Duration = Duration::from_millis(16);

/// The budget of a catch-up's next step, after one of `budget` took `took`: smaller in proportion where it took longer
/// than `CATCH_UP_TURN`, twice as big where it took less than half of it, never under 1 nor over four times
/// `CATCH_UP_SLICE`.
fn catch_up_budget(budget: usize, took: Duration) -> usize {
    let (took, turn) = (took.as_micros().max(1), CATCH_UP_TURN.as_micros());
    let next = if took > turn {
        (budget as u128 * turn / took) as usize
    } else if took * 2 < turn {
        budget.saturating_mul(2)
    } else {
        budget
    };
    next.clamp(1, CATCH_UP_SLICE * 4)
}

/// How much longer than its last bringing up to date took a pull waits before it brings its device's keys and items up
/// to date again (`Shared::catch_up_paced`): each time replays the whole log for a device catching up from far behind,
/// whose edits sort before what its replay last stepped over. Samuel's iPhone 2026-10-22: each asking of 256 logs ended
/// in one, 5-10 s each, and its pages waited behind them; paced so, at most a quarter of a pull's time goes to them.
const CATCH_UP_PACE: u32 = 3;

impl Options {
    /// Nodes on one machine, as in the tests: loopback, no relay, and no lookup but the addresses a node is told.
    pub fn local() -> Options {
        Options {
            bind: Some(SocketAddr::from(([127, 0, 0, 1], 0))),
            direct: false,
            relay: None,
            proxy: false,
            lazy: false,
            first_sync_stubs: true,
            retry: Duration::from_secs(1),
            shelf: None,
            keep: false,
            card: false,
            admission: None,
            relay_passes: Vec::new(),
            page: PAGE,
            progress: Progress::new(),
            #[cfg(all(feature = "sim", not(target_arch = "wasm32")))]
            sim: None,
            index: false,
            paths: true,
            segments: true,
            window: pulls::WINDOW,
        }
    }

    /// A node on simulated network `net` (P7, `sim`): no socket, no relay, every packet through `net`.
    #[cfg(all(feature = "sim", not(target_arch = "wasm32")))]
    pub fn simulated(net: &sim::Net) -> Options {
        Options { bind: None, sim: Some(net.clone()), ..Options::local() }
    }
}

/// Who may use the server's relay: the endpoints of the devices the server knows, those of every vault in its view
/// whose keys it saw sign, and its own; and, for ten minutes, a new device whose pass a passkey signed that roots a
/// vault in its view (P8d, `sign::RelayPass`), or any passkey while nobody has claimed the server (P8f); and, while it
/// signs people up by invite (`Admission::invited`), a pass shown with an invite of Maia City no vault claimed yet
/// (`avendb::admission`, G5). The server's node keeps it up to date as its view changes, from before its endpoint
/// binds; the relay asks it about each client that connects, and lets go of a client it stops admitting.
#[derive(Clone, Debug, Default)]
pub struct Admission {
    admitted: Arc<watch::Sender<Admitted>>,
    /// It honours a pass of any passkey (P8e, `Admission::open`).
    open: bool,
    /// It honours a pass shown with an open invite (`Admission::invited`).
    invited: bool,
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
    /// The invites of the vault the server serves, Maia City, that no vault claimed yet (`admission::open_invites`):
    /// a pass shown with one is honoured while the server signs people up by invite.
    pub invites: HashSet<ShareId>,
}

impl Admission {
    /// An admission open to sign-up (P8e): its relay honours a pass of any passkey, for its ten minutes, so that a
    /// person's first device with no UDP of its own, a browser, founds their vault and makes it known to the server
    /// (the vault gives the server relay on its entries): from then on the server knows the device. A device on UDP
    /// reaches the server so anyway; the relay's minutes are what it opens.
    pub fn open() -> Admission {
        Admission { open: true, ..Admission::default() }
    }

    /// An admission that signs people up by invite (G5, `avendb::admission::Signup::Invited`): its relay honours a
    /// pass of a passkey that roots a vault it knows, as any admission does, and one shown with an invite of Maia City
    /// that no vault claimed yet, for the newcomer's first device to found their vault and claim the invite in its
    /// ten minutes.
    pub fn invited() -> Admission {
        Admission { invited: true, ..Admission::default() }
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

    /// The relay lets in the endpoint a pass of `passkey` names, shown with invite `invite` (`admission::honours`):
    /// as `honours` says, or, signing people up by invite, where `invite` is one of Maia City's no vault claimed yet.
    pub fn honours_with(&self, passkey: &SignerId, invite: Option<ShareId>) -> bool {
        self.honours(passkey) || (self.invited && invite.is_some_and(|c| self.admitted.borrow().invites.contains(&c)))
    }

    /// Marks each change of whom it admits.
    pub fn watch(&self) -> watch::Receiver<Admitted> {
        self.admitted.subscribe()
    }

    fn set(&self, admitted: Admitted) {
        self.admitted.send_if_modified(|now| {
            *now != admitted && {
                *now = admitted;
                true
            }
        });
    }
}

/// Signs in its person's passkey's ceremonies as a device founds its person's vault, links, claims a server or has
/// their vault approve a change (P8e, `Node::found_with`, `Node::link_with`, `Node::claim_with`,
/// `Node::approve_with`): a browser's WebAuthn, which asks its person each time, or a software passkey its Lab holds
/// (`Node::link`, `Node::claim`).
pub trait Authenticator {
    /// The passkey's ceremony over `challenge` (`sign::Ceremony`), for `step`.
    fn ceremony(&self, challenge: [u8; 32], step: Step) -> impl Future<Output = Result<Ceremony>>;

    /// The ceremony over `challenge` of the Mac's Touch ID key, which signs where its keys are those of the owner key
    /// that approves (`avendb::engine::passkey_of`): one touch (`sign::Ceremony::enclave`), for `step`. None where no
    /// Touch ID key is at hand, as in a browser.
    fn touch(&self, challenge: [u8; 32], step: Step) -> impl Future<Output = Result<Ceremony>> {
        let _ = (challenge, step);
        async { Err(anyhow!("no Touch ID key here")) }
    }
}

/// The ceremony over `challenge` of owner key `keys` (`Authenticator`): a touch for a Touch ID key's, the passkey's
/// otherwise, as a Mac its Touch ID key opened knows its passkey's keys only from its ceremony (`Lab::take_in`).
pub async fn ceremony_of(
    authenticator: &impl Authenticator,
    keys: Option<SignerKeys>,
    challenge: [u8; 32],
    step: Step,
) -> Result<Ceremony> {
    match keys {
        Some(SignerKeys::Enclave { .. }) => authenticator.touch(challenge, step).await,
        _ => authenticator.ceremony(challenge, step).await,
    }
}

/// Who signs the edit adding a new device for its passkey (`Node::linking`): a ceremony of its own, or the one that
/// unlocked the device, its pass.
enum Joins<'a, A> {
    By(&'a A),
    Pass(Ceremony),
}

/// What a passkey's ceremony signs as its device founds its person's vault, links, claims a server or has their vault
/// approve a change. The ceremony that unlocks a new device, its pass, comes before any of them, from the device's own
/// app (`sign::RelayPass`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// The edit that adds the new device to its person's vault.
    Join,
    /// The genesis of its person's vault and the edit that adds their first device to it, which that device drafts
    /// together (`Node::found_with`); and, through a server nobody has claimed yet, the seed's geneses and the edit
    /// that adds the server to its device vault, avenMAIA (`Place::Seed`).
    Found,
    /// The geneses of the seed its person's human vault founds as their device claims a server, and the edit that adds
    /// the server to its device vault, avenMAIA, drafted together (`Node::claim_with`, `Place::Seed`).
    Claim,
    /// Changes its person's vault approves, as the root of the vaults it owns: new vaults it owns, an owner share, the
    /// revocation of one, drafted together (`Node::approve_with`); or a device added to a device vault of theirs, with
    /// the vaults founded for it (`Node::add_device_vault_with`), as an agent's under their aven.
    Approve,
}

/// Where the device a person's device adds goes (`Node::add_device_vault_with`): a device vault of theirs, there
/// already or new, and a new one under which vault. Every child that acts by keys of its own is added so, in the
/// same steps (`add_device_vault`): an agent under its person's aven, the server under Maia City, a coop's drive
/// under the coop.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Place {
    /// Device vault `0`, there already, which the device joins: agentClaude on a person's second Mac joining the
    /// agentClaude their first Mac added, or the server the avenMAIA a claim it didn't take founded
    /// (`Lab::unclaimed_server`).
    Vault(VaultId),
    /// A new device vault under vault `0`, which the person's vault owns: an agent's under their aven.
    Under(VaultId),
    /// A new device vault under a new vault of kind `0`, which the person's vault founds and owns alone, both in the
    /// same ceremony: their first agent's, under the aven founded with it.
    UnderNew(Kind),
    /// avenMAIA, a new aven under Maia City, which the same ceremony founds with the rest of the seed
    /// (`avendb::world::SEED`): Maia City, a coop the person's vault owns alone, and its one aven, whose device the
    /// server becomes (Samuel 2026-10-18: an aven lives on its server).
    Seed,
}

/// The first two of the three steps of adding a device vault (`Place`), drafted one on top of the other, each approved
/// by the passkey `passkey` of human vault `human`: the vaults `place` founds, if any, each owned alone by the one
/// before it, the first by `human`, each genesis with nonce `nonce`; then the edit that adds device `device` to the
/// device vault, its key to seal to `key`, which the device signs too, drafted last, as the device's claim sends it
/// (`Lab::claim`). The third, the shares its parent passes on to it, comes after, each resting on a share the parent
/// holds, as a vault passes rights on to a vault it owns (`avendb::world::parent`). The device vault.
fn add_device_vault(
    drafting: &mut Drafting<'_>,
    passkey: SignerId,
    human: VaultId,
    place: Place,
    nonce: u64,
    device: SignerId,
    key: PublicKey,
) -> Result<VaultId, Refusal> {
    let mut found = |kind, owner| {
        let owners = vec![Principal::Vault(owner)];
        let genesis = Action::Genesis { kind, owners, threshold: 1, root: None, nonce, seal_to: vec![] };
        drafting.draft(&[passkey], genesis).map(VaultId::from)
    };
    let vault = match place {
        Place::Vault(vault) => vault,
        Place::Under(parent) => found(Kind::DeviceVault, parent)?,
        Place::UnderNew(kind) => {
            let parent = found(kind, human)?;
            found(Kind::DeviceVault, parent)?
        }
        Place::Seed => {
            let [kinds @ .., last] = avendb::world::SEED;
            let mut chain = vec![human];
            for kind in kinds {
                let owner = *chain.last().expect("the human vault first");
                chain.push(found(kind, owner)?);
            }
            // the chain's end, the coop's one aven, avenMAIA, which the server is added to: it lives on its server
            found(last, *chain.last().expect("Maia City last"))?
        }
    };
    let add = Action::Share(Sharing::Device { vault, device, seal_to: Some(key) });
    drafting.draft(&[passkey, device], add)?;
    Ok(vault)
}

/// The software passkey `1` in a node's Lab, which makes its ceremonies itself.
struct InLab(Arc<Shared>, SignerId);

impl Authenticator for InLab {
    async fn ceremony(&self, challenge: [u8; 32], _: Step) -> Result<Ceremony> {
        let passkey = self.1;
        self.0.try_lab(move |lab, _| lab.ceremony(passkey, challenge)).await?.context("the passkey isn't at hand")
    }

    async fn touch(&self, challenge: [u8; 32], step: Step) -> Result<Ceremony> {
        self.ceremony(challenge, step).await
    }
}

/// Saves that fail (`Shared::unsaved`): since when, by `unix_now`, how many in a row, and the last one's error.
#[derive(Clone, Debug)]
struct Unsaved {
    since: u64,
    tries: u64,
    error: String,
}

/// The time by this machine's clock, or the browser's: seconds since 1970.
pub(crate) fn unix_now() -> u64 {
    time::SystemTime::now().duration_since(time::SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// The most passes a token carries (`passes_token`): one, its passkey's, since the fork off SLH-DSA.
pub const TOKEN_PASSES: usize = 1;

/// Relay passes as the token a node shows its relay as it connects: each in base64url without padding, joined by
/// `.`, which a browser's node carries in the query of the relay's URL, as a page can't set the headers of a
/// WebSocket. The relay takes the first `TOKEN_PASSES` of them (`token_passes`).
pub fn passes_token(passes: &[RelayPass]) -> String {
    let token = |pass: &RelayPass| BASE64URL_NOPAD.encode(&pass.to_wire());
    passes.iter().map(token).collect::<Vec<_>>().join(".")
}

/// How a node with `opts` reaches its relay `relay`: with its passes, if it has any.
fn relay_config(relay: &RelayUrl, opts: &Options) -> RelayConfig {
    let config = RelayConfig::from(relay.clone());
    match opts.relay_passes.is_empty() {
        true => config,
        false => config.with_auth_token(passes_token(&opts.relay_passes)),
    }
}

/// The relay passes a token carries (`passes_token`): those of its first `TOKEN_PASSES` parts that are one.
pub fn token_passes(token: &str) -> Vec<RelayPass> {
    let pass = |part: &str| RelayPass::from_wire(&BASE64URL_NOPAD.decode(part.as_bytes()).ok()?).ok();
    token.split('.').take(TOKEN_PASSES).filter_map(pass).collect()
}

/// A device on the network: its Lab, split off for it (`Lab::split`), behind an iroh endpoint of its own key.
pub struct Node {
    shared: Arc<Shared>,
    router: Router,
    tasks: Mutex<Vec<JoinHandle<()>>>,
}

impl Node {
    /// Device `me` of `lab` on the network: it answers its peers, tells them when its logs change, and asks them when
    /// theirs differ. With a shelf, it first takes back what its device kept there, if anything, and saves there what
    /// its device holds from then on (`edits`). Fails while the device is locked, as its endpoint key is its own
    /// ed25519 key, and if its shelf can't be read.
    pub async fn spawn(lab: Lab, me: SignerId, opts: Options) -> Result<Node> {
        let writer = opts.shelf.as_ref().map(Shelf::writer).transpose()?;
        Self::spawn_owned(lab, me, opts, writer).await
    }

    /// Startup already owns the shelf before writing identity or restoring state.
    pub(crate) async fn spawn_owned(lab: Lab, me: SignerId, mut opts: Options, writer: Option<Writer>) -> Result<Node> {
        let lifecycle = writer.as_ref().map_or_else(lifecycle::Lifecycle::new, Writer::lifecycle);
        if let Some(writer) = &writer {
            opts.shelf = Some(writer.shelf());
        }
        let secret = lab.endpoint_secret(me).context("a device of this Lab, unlocked")?;
        // a page keeps what lasts in OPFS, and nowhere else
        #[cfg(target_arch = "wasm32")]
        if opts.shelf.is_none() {
            bail!("a node in a browser keeps a shelf");
        }
        // its edits taken back from its shelf a page at a time, never all of them at once beside what it keeps (F9)
        let (edits, lab, stored) = match &opts.shelf {
            Some(shelf) => {
                // a device opening again restores in parts, each its own step with how it went, so that its person sees
                // which takes the time; a new one's empty shelf has none to show
                let parts = opts.progress.current() == Some("restore");
                let step = |step| if parts { opts.progress.step(step) };
                step("shelf");
                let mut to = Restorer { lab: Some(lab), me, checked: None, keys: Warm::default(), restoring: None };
                let (edits, warm, stored, anchors) = edits::Edits::open_into(shelf.clone(), &mut to).await?;
                let taken = to.lab.as_ref().map_or(0, |lab| lab.size(me).0);
                opts.progress.note("shelf", format!("{taken} edits, {} stored views, {} packs of kept showings", warm.views.len(), warm.shown.len()));
                step("refresh");
                let lab = to.end(anchors, warm).await?;
                if let Some(report) = lab.restore_report(me) {
                    opts.progress.note("refresh", report);
                }
                (Some(edits), lab, stored)
            }
            None => (None, lab, Vec::new()),
        };
        if let Some(edits) = &edits {
            if opts.progress.current() == Some("refresh") {
                opts.progress.step("ledger");
            }
            edits.settle(&lab, me, &stored);
        }
        // Batch roots are optional: an unsupported shelf or damaged signer ledger must not
        // prevent the existing signed-edit node from opening. Never reconstruct an enrolled ledger.
        let mut lab = lab;
        let signers = match &opts.shelf {
            Some(shelf) => match signers::Signers::open(shelf.clone(), me, &mut lab).await {
                Ok(signers) => signers,
                Err(error) => {
                    lab.stop_capturing_signing(me);
                    tracing::warn!("avendb: batch roots disabled; legacy signatures remain active: {error:#}");
                    None
                }
            },
            None => None,
        };
        // a device that holds nothing yet, the page's or a new native device's, takes its first sync with the boxes it
        // needs not now held back as stubs and their bodies in the pull after (`Lab::set_lazy_boxes`,
        // `spec/AvenDB/LazyBoxes.lean`); one that holds edits syncs as before. A peer from before box stubs refuses
        // `session::STUBS` and sends everything, which ends it (`Shared::pages`). Not a server, which keeps and hands on
        // what it holds (`card`, `keep`), nor a node that asks only when told (`lazy`), which would never ask for the
        // bodies
        if opts.first_sync_stubs && !opts.card && !opts.keep && !opts.lazy && lab.size(me).0 == 0 {
            lab.set_lazy_boxes(me, true);
        }
        opts.progress.step("node");
        if let Some(admission) = &opts.admission {
            let own = SecretKey::from_bytes(&secret).public();
            let endpoints = endpoints(&lab.peers(me)).chain([own]).collect();
            let claimable = opts.card && lab.vault_of(me).is_none();
            let (passkeys, invites) =
                (lab.roots(me).into_iter().collect(), open_invites(&lab, me).into_iter().collect());
            admission.set(Admitted { endpoints, passkeys, claimable, invites });
        }
        let size = lab.size(me);
        let lookup = MemoryLookup::new();
        let packets = transports::PacketTransport::new(SecretKey::from_bytes(&secret).public());
        let mut builder = Endpoint::builder(presets::Empty)
            .secret_key(SecretKey::from_bytes(&secret))
            .crypto_provider(provider())
            .address_lookup(lookup.clone())
            .transport_config(quic())
            .add_custom_transport(Arc::new(packets.clone()));
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
        // a simulated node reaches its peers through its scenario's network alone
        #[cfg(all(feature = "sim", not(target_arch = "wasm32")))]
        if let Some(net) = &opts.sim {
            anyhow::ensure!(opts.relay.is_none() && !opts.direct, "a simulated node has no relay and no socket");
            builder = builder
                .portmapper_config(PortmapperConfig::Disabled)
                .clear_ip_transports()
                .add_custom_transport(net.transport(SecretKey::from_bytes(&secret).public()));
        }
        if let Some(relay) = &opts.relay {
            builder = builder.relay_mode(RelayMode::Custom(RelayMap::from(relay_config(relay, &opts))));
        }
        #[cfg(not(target_arch = "wasm32"))]
        if opts.proxy {
            builder = builder.proxy_from_env();
        }
        let endpoint = builder.bind().await?;
        // its blob store over its shelf, which lists what it holds once its edits are taken back; else in memory
        let (store, shelf): (Store, _) = match &opts.shelf {
            Some(on) => {
                let (shelf, store) = shelf::ShelfStore::open(on.clone()).await?;
                (store, Some(shelf))
            }
            #[cfg(not(target_arch = "wasm32"))]
            None => (MemStore::new().into(), None),
            #[cfg(target_arch = "wasm32")]
            None => unreachable!("a page's node keeps a shelf"),
        };
        let (events, gate) = blobs::events();
        let pool = connection_pool::Options { idle_timeout: IDLE, connect_timeout: WAIT, ..Default::default() };
        let pool = ConnectionPool::new(endpoint.clone(), iroh_blobs::ALPN, pool);
        let transport_control = transports::control::Control::new(packets.clone());
        let (outreach, inbox) = node_loop::outreach();
        // its shared index, stepped on at its first save (`shared_index`); a shelf that can't read it costs it the
        // index, never the node
        let shared_index = match &opts.shelf {
            Some(shelf) => match shared_index::SharedIndex::open(shelf.clone()).await {
                Ok(ix) => Some(ix),
                Err(e) => {
                    tracing::warn!("avendb: the shared index can't be opened on the shelf: {e:#}");
                    None
                }
            },
            None => None,
        };
        // the rows its peers told it, if it keeps an index (`told_index`): on its shelf, or in memory for a node that
        // keeps none
        let told_rows = match opts.index {
            true => {
                let (on, older) = match &opts.shelf {
                    Some(shelf) => (shelf.clone(), blind::older_rows(shelf).await),
                    None => (told_index::memory_shelf(), None),
                };
                Some(told_index::ToldIndex::open(on, older).await?)
            }
            false => None,
        };
        let shared = Arc::new(Shared {
            lifecycle,
            writer: Mutex::new(writer),
            me,
            lab: Mutex::new(lab),
            shared_index,
            lab_schedule: Arc::default(),
            lab_turns: Arc::default(),
            edits,
            signers,
            endpoint: endpoint.clone(),
            lookup,
            packets,
            transport_control,
            store: store.clone(),
            opts,
            peers: Mutex::default(),
            dependency_peer_turn: std::sync::atomic::AtomicUsize::new(0),
            dialing: Mutex::default(),
            logs: Mutex::default(),
            held_logs: Mutex::default(),
            world_encoding: Arc::default(),
            entry_encoding: Arc::default(),
            checkpoint_pins: Arc::default(),
            receive_checking: Arc::default(),
            own: Mutex::new(Own { at: ((usize::MAX, 0), 0), revision: None, holdings: Holdings::default() }),
            reach: Mutex::default(),
            held: Mutex::default(),
            told: Mutex::default(),
            statements: Mutex::default(),
            receipts: peer_receipts::Receipts::default(),
            ui_receipts: peer_receipts::Receipts::for_ui(),
            outreach,
            wanted: Mutex::default(),
            fresh: fresh::Fresh::default(),
            claims: Mutex::default(),
            interests: Mutex::default(),
            discovery_running: Mutex::default(),
            discovery_rounds: AtomicUsize::new(0),
            discovery_first_found: AtomicUsize::new(0),
            discovery_mark: Mutex::default(),
            discovery_answer: Arc::new(tokio::sync::Semaphore::new(1)),
            told_rows,
            index_told: Mutex::default(),
            index_due: Notify::new(),
            offered: Mutex::default(),
            shelf,
            blob_peers: Mutex::default(),
            follows: Mutex::default(),
            unpacked: Mutex::default(),
            unbatched: Mutex::default(),
            uncut: Mutex::default(),
            unstubbed: Mutex::default(),
            unstripped: Mutex::default(),
            unsegmented: Mutex::default(),
            ranges: Mutex::default(),
            edit_transfer: edit_transfer::Runtime::default(),
            paced: Mutex::default(),
            catch_up_due: AtomicBool::new(false),
            pieces: Mutex::default(),
            pool,
            changed: Notify::new(),
            bootstrap_due: Notify::new(),
            size: watch::Sender::new(size),
            warm: AtomicBool::new(false),
            unsaved: Mutex::new(None),
            sent: Sent::default(),
            jobs: Jobs::default(),
            traffic: traffic::Traffic::default(),
            pulls: pulls::Budget::default(),
            keeping: Mutex::default(),
            asked: Mutex::default(),
            files_asked: Notify::new(),
        });
        let router = Router::builder(endpoint)
            .accept(ALPN, session::Protocol(shared.clone()))
            .accept(iroh_blobs::ALPN, BlobsProtocol::new(&store, Some(events)))
            .spawn();
        let tasks = vec![
            task::spawn(blobs::gate(shared.clone(), gate)),
            task::spawn(shared.clone().announcer()),
            task::spawn(shared.clone().keeper()),
            task::spawn(shared.clone().saver()),
            task::spawn(shared.clone().unshelve()),
            task::spawn(shared.clone().index_teller()),
            task::spawn(shared.clone().bootstrap_pump()),
            task::spawn(transports::control::maintain(shared.clone())),
            task::spawn(node_loop::run(shared.clone(), inbox)),
        ];
        Ok(Node { shared, router, tasks: Mutex::new(tasks) })
    }

    /// The device this node is.
    pub fn device(&self) -> SignerId {
        self.shared.me
    }

    /// Its endpoint, for what a test does by hand.
    pub fn endpoint(&self) -> &Endpoint {
        &self.shared.endpoint
    }

    /// Whether its relay has let it in, waited for up to `RELAY_WAIT`: a node with no socket of its own, as a page's,
    /// reaches nobody before its relay lets it in, and a dial it sends sooner is lost and sent again ever later
    /// (`REDIAL`), so it waits for it first, as its `relay` step. At once for a node with a socket, or no relay. While
    /// iroh has picked no relay, it has it pick again every `RELAY_PICK`, by handing it its relay once more.
    pub async fn on_relay(&self) -> bool {
        let Ok(_activity) = self.shared.admit() else { return false };
        let (opts, endpoint) = (&self.shared.opts, &self.shared.endpoint);
        let Some(relay) = opts.relay.as_ref().filter(|_| opts.bind.is_none() && !opts.direct) else { return true };
        opts.progress.step("relay");
        let end = Instant::now() + RELAY_WAIT;
        loop {
            let wait = end.saturating_duration_since(Instant::now()).min(RELAY_PICK);
            if time::timeout(wait, endpoint.online()).await.is_ok() {
                return true;
            }
            if Instant::now() >= end || self.shared.admit().is_err() {
                return false;
            }
            if endpoint.home_relay_status().get().is_empty() {
                endpoint.insert_relay(relay.clone(), Arc::new(relay_config(relay, opts))).await;
            }
        }
    }

    /// Its endpoint id: its device's ed25519 key.
    pub fn id(&self) -> EndpointId {
        self.shared.endpoint.id()
    }

    /// Where its peers reach it: its endpoint id, the address of each network interface its socket is bound on, and
    /// its relay.
    pub fn addr(&self) -> EndpointAddr {
        let addr = self.shared.endpoint.addr();
        // iroh lists no custom address of its own: a simulated node's is its endpoint's on the scenario's network
        #[cfg(all(feature = "sim", not(target_arch = "wasm32")))]
        let addr = match &self.shared.opts.sim {
            Some(_) => EndpointAddr::from_parts(addr.id, addr.addrs.into_iter().chain([sim::addr(addr.id)])),
            None => addr,
        };
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
        let _activity = self.shared.admit()?;
        let now = unix_now();
        let pass = self.shared.try_lab(move |lab, me| lab.relay_pass(me, passkey, now)).await?;
        let pass = pass.context("the passkey isn't at hand")?;
        let passes = std::slice::from_ref(&pass);
        let (_, vault) = self.link_with(offer, passes, &InLab(self.shared.clone(), passkey)).await?;
        Ok(vault)
    }

    /// `link`, with its person's passkey in the platform's authenticator (P8e): `passes` are the passkey's pass for
    /// this device, the ceremony that unlocked it, which the peer takes in place of a ceremony of the passkey's on
    /// their connection, and `authenticator` signs the one more ceremony linking takes, the edit that adds this device
    /// to its person's vault. A pass may be from any of a few passkeys, as this device may not know its passkey's P-256
    /// key yet (`RelayPass::candidates`): the one whose vault the peer hands over is its person's, and its keys must be
    /// at hand in the Lab (`Lab::web_passkey`), as those of the others may be. It shows the peer one pass after
    /// another until the peer hands a vault over. That passkey and the vault it joined.
    pub async fn link_with(
        &self,
        offer: &Offer,
        passes: &[RelayPass],
        authenticator: &impl Authenticator,
    ) -> Result<(SignerId, VaultId)> {
        let _activity = self.shared.admit()?;
        self.linking(offer, passes, Joins::By(authenticator)).await
    }

    /// `link_with`, in the one ceremony that unlocked this device, `unlock`, which is the passkey's pass for it: that
    /// ceremony signs the edit adding the device too, as the pass (`sign::WebAuthn::Pass`), its PRF output making the
    /// ML-DSA-65 signature over the edit itself, so that a browser signs in to its person's vault in one ceremony. That
    /// passkey and the vault it joined.
    pub async fn link_by_pass(
        &self,
        offer: &Offer,
        passes: &[RelayPass],
        unlock: Ceremony,
    ) -> Result<(SignerId, VaultId)> {
        let _activity = self.shared.admit()?;
        self.linking(offer, passes, Joins::<InLab>::Pass(unlock)).await
    }

    /// `link_by_pass` through the server `offer` names, only if the pass's passkey roots a vault the server knows: one
    /// passkey, one human vault, so a new device of a person who has a vault already joins it, as it asks to found
    /// one (`avendb_browser::Device::found`). That passkey and the vault it joined, or `None` if the passkey roots no
    /// vault the server hands over, and nothing changed.
    pub async fn rejoin_by_pass(
        &self,
        offer: &Offer,
        passes: &[RelayPass],
        unlock: Ceremony,
    ) -> Result<Option<(SignerId, VaultId)>> {
        let _activity = self.shared.admit()?;
        self.join_through(offer, passes, Joins::<InLab>::Pass(unlock), false).await
    }

    async fn linking<A: Authenticator>(
        &self,
        offer: &Offer,
        passes: &[RelayPass],
        joins: Joins<'_, A>,
    ) -> Result<(SignerId, VaultId)> {
        let _activity = self.shared.admit()?;
        self.on_relay().await;
        self.shared.opts.progress.step("server");
        self.join_through(offer, passes, joins, true).await?.context("no vault of this passkey to join")
    }

    /// Join the vault a pass's passkey roots, through device `offer`, which hands over its log for the pass: `None`
    /// if it hands over none for any of `passes`, which it shows one after another, the next only if the peer handed
    /// nothing over for the one before. `linking` marks the pass step as it shows
    /// the passes; a device that founds its vault, only once the server handed one over.
    async fn join_through<A: Authenticator>(
        &self,
        offer: &Offer,
        passes: &[RelayPass],
        joins: Joins<'_, A>,
        linking: bool,
    ) -> Result<Option<(SignerId, VaultId)>> {
        let _activity = self.shared.admit()?;
        let progress = &self.shared.opts.progress;
        let peer = self.offered(offer).await?;
        if linking {
            progress.step("pass");
        }
        let mut handed = None;
        for pass in passes {
            let card = session::exchange(&peer.conn, session::LINK, &pass.to_wire(), session::REPLY_LIMIT).await?;
            let Reply { mut edits, .. } = Reply::from_wire(&card)?;
            // a card carries vault logs, and nothing else
            edits.retain(of_a_vault);
            if !edits.is_empty() {
                handed = Some((pass, edits));
                break;
            }
        }
        let Some((pass, edits)) = handed else { return Ok(None) };
        if !linking {
            progress.step("pass");
        }
        let passkeys = pass.candidates();
        progress.step("vault");
        let joining = self.shared.try_lab(move |lab, me| {
            lab.receive(me, edits, Vec::new());
            let at_hand = |p: &SignerId| lab.keys_of(*p).is_some();
            passkeys.into_iter().filter(at_hand).find_map(|p| Some((p, lab.joining(me, p).ok()?)))
        });
        let Some((passkey, joining)) = joining.await? else { return Ok(None) };
        let id = match joining {
            (_, Some(id)) => id,
            (vault, None) => {
                progress.step("join");
                let add = move |lab: &mut Lab, me| {
                    lab.draft(me, &[passkey, me], Action::Share(Sharing::Device { vault, device: me, seal_to: None }))
                };
                let draft = self.shared.try_lab(add).await?.map_err(|why| anyhow!("the join is refused: {why:?}"))?;
                let (draft, ceremony) = match joins {
                    Joins::By(authenticator) => {
                        let ceremony = authenticator.ceremony(draft.challenge(), Step::Join).await?;
                        (draft, ceremony)
                    }
                    Joins::Pass(unlock) => (draft.by_pass(pass.made), unlock),
                };
                let complete = move |lab: &mut Lab, me| lab.complete(me, draft, &[(passkey, &ceremony)]);
                self.shared
                    .try_lab(complete)
                    .await?
                    .map_err(|why| anyhow!("the passkey didn't sign the join: {why:?}"))?
            }
        };
        let join = self.shared.read(move |lab, me| lab.joined(me, id)).await;
        let Action::Share(Sharing::Device { vault, .. }) = join.edit.edit.action else {
            bail!("a join that adds no device")
        };
        let sent = session::exchange(&peer.conn, session::JOIN, &join.to_wire(), 0).await;
        sent.context("the peer refuses the join")?;
        self.shared.changed.notify_one();
        // what the peer keeps for the vault comes in the background, a `pull` job: nobody waits on it
        let (shared, endpoint) = (self.shared.clone(), peer.endpoint);
        let activity = shared.admit()?;
        task::spawn(async move {
            let _activity = activity;
            shared.ask(endpoint).await.ok()
        });
        Ok(Some((passkey, vault)))
    }

    /// `found_with`, with `passkey` a software passkey this device's Lab holds.
    pub async fn found(&self, offer: &Offer, passkey: SignerId) -> Result<(VaultId, VaultId)> {
        let _activity = self.shared.admit()?;
        let (_, vault, avenceo) = self.found_with(offer, &[passkey], &InLab(self.shared.clone(), passkey)).await?;
        Ok((vault, avenceo))
    }

    /// Found this device's person's human vault, its root their passkey, with this device in it and the master recovery
    /// key the Lab adds among its owners (`Lab::set_recovery`), and make it known to the server `offer` names, whose
    /// card it takes (`contact`): `authenticator` signs the vault's genesis and the edit that adds this device in one
    /// ceremony (`Lab::drafting`). If the card names no avenCEO, as nobody has claimed the server yet, the same
    /// ceremony founds the seed (`Place::Seed`): Maia City, which the new human vault owns, and
    /// avenMAIA, and adds the server as that device vault's device, which the server signs too and keeps
    /// (`Lab::accept_claim`): the first person to found their vault through a server nobody has claimed owns it. Should
    /// another vault claim it first, this device takes that avenCEO from its card. The passkey is one of `passkeys`,
    /// whose keys the Lab holds: a device that doesn't know its passkey's P-256 key yet drafts it all for each key the
    /// passkey's pass recovers to, in one batch (`Lab::drafting_for`), and keeps the edits of the passkey the
    /// ceremony's assertion verifies under. That passkey, the human vault and avenCEO. Fails if the device answering
    /// isn't the one offered, this device belongs to a vault already, no passkey of `passkeys` made the ceremony, or
    /// the server names no avenCEO and takes no claim.
    pub async fn found_with(
        &self,
        offer: &Offer,
        passkeys: &[SignerId],
        authenticator: &impl Authenticator,
    ) -> Result<(SignerId, VaultId, VaultId)> {
        let _activity = self.shared.admit()?;
        self.offered(offer).await?;
        if self.shared.read(|lab, me| lab.vault_of(me)).await.is_some() {
            bail!("this device belongs to a vault already");
        }
        let named = self.avenceo(offer).await?;
        let key = match named {
            Some(_) => None,
            None => self.claim_key(offer).await.ok(),
        };
        let (server, claiming, passkeys) = (offer.device, key.is_some(), passkeys.to_vec());
        let progress = &self.shared.opts.progress;
        progress.step("draft");
        let draft = move |lab: &mut Lab, me| {
            let nonce = lab.nonce();
            let lab = &*lab;
            let found = |drafting: &mut Drafting<'_>, passkey| {
                // the master recovery key the Lab adds is an owner beside the passkey, by its standing consent
                let ((owners, signers), root) = (lab.human_owners(passkey), Some(passkey));
                let genesis =
                    Action::Genesis { kind: Kind::Human, owners, threshold: 1, root, nonce: 0, seal_to: vec![] };
                let vault = VaultId::from(drafting.draft(&signers, genesis)?);
                drafting.draft(&[passkey, me], Action::Share(Sharing::Device { vault, device: me, seal_to: None }))?;
                if let Some(key) = &key {
                    add_device_vault(drafting, passkey, vault, Place::Seed, nonce, server, key.clone())?;
                }
                Ok(vault)
            };
            lab.drafting_for(me, &passkeys, found)
        };
        let sets = self.shared.try_lab(draft).await?.map_err(|why| anyhow!("the vault is refused: {why:?}"))?;
        progress.step("sign");
        let (passkey, vault, claim) = self.sign(sets, claiming, Step::Found, authenticator).await?;
        let refused = match (claim, named) {
            (Some(claim), _) => {
                progress.step("claim");
                match self.send_claim(offer, claim).await {
                    Ok(avenceo) => return Ok((passkey, vault, avenceo)),
                    Err(e) => e,
                }
            }
            (None, Some(avenceo)) => return Ok((passkey, vault, avenceo)),
            (None, None) => anyhow!("the server takes no claim"),
        };
        // another vault claimed the server first: its card names that avenCEO
        let avenceo = self.avenceo(offer).await?.ok_or(refused)?;
        Ok((passkey, vault, avenceo))
    }

    /// Claim the server `offer` names for this device's person (P8f), while nobody has claimed it: the server hands its
    /// key to seal to (`Lab::claim_key`), and the passkey `passkey`, used on this device, adds it to a device vault of
    /// theirs as any device vault's device is added (`add`): to avenMAIA, under Maia City, which the same
    /// ceremony founds with the rest of the seed (`Place::Seed`): Maia City, which this device's human vault
    /// owns, and avenMAIA, its aven, the server's vault. Tried again after a claim the server didn't take, it adds the
    /// server to the aven that claim founded (`Lab::unclaimed_server`); after one whose answer was lost, it
    /// finds the server its device already. Fails if the device answering isn't the one offered, this device belongs to
    /// no vault, the passkey isn't at hand, or another vault has claimed the server, or the server refuses the claim.
    pub async fn claim(&self, offer: &Offer, passkey: SignerId) -> Result<VaultId> {
        let _activity = self.shared.admit()?;
        self.claim_with(offer, passkey, &InLab(self.shared.clone(), passkey)).await
    }

    /// `claim`, with `passkey` in the platform's authenticator (P8e): `authenticator` signs the seed's geneses and the
    /// edit that adds the server to its device vault in one ceremony (`Lab::drafting`).
    pub async fn claim_with(
        &self,
        offer: &Offer,
        passkey: SignerId,
        authenticator: &impl Authenticator,
    ) -> Result<VaultId> {
        let _activity = self.shared.admit()?;
        let endpoint = self.offered(offer).await?.endpoint;
        let server = offer.device;
        let key = match self.claim_key(offer).await {
            Ok(key) => key,
            Err(e) => {
                // a claim whose answer was lost: the server tells this device that it is avenCEO's already
                self.shared.ask(endpoint).await.ok();
                let claimed = self.shared.read(move |lab, me| lab.server_vault_of(me, server)).await;
                return claimed.ok_or(e);
            }
        };
        // a claim tried again, after one the server didn't take, adds the server to the avenMAIA that one founded
        let unclaimed = self.shared.read(|lab, me| lab.unclaimed_server(me)).await;
        self.add(offer, key, unclaimed.map_or(Place::Seed, Place::Vault), passkey, Step::Claim, authenticator).await
    }

    /// `add_device_vault_with`, the passkey `passkey` in this node's Lab, which makes its ceremony itself.
    pub async fn add_device_vault(&self, offer: &Offer, place: Place, passkey: SignerId) -> Result<(VaultId, VaultId)> {
        let _activity = self.shared.admit()?;
        self.add_device_vault_with(offer, place, passkey, &InLab(self.shared.clone(), passkey)).await
    }

    /// Add the device `offer` names, one of no vault yet that answers claims (`Options::card`), to a device vault of
    /// this device's person's at `place`: one there already, or a new one under a vault their vault owns, or under a
    /// new one their vault founds, as their aven (`Place`). The passkey `passkey` approves it all in one ceremony, and
    /// the device signs the edit that adds it too, as a server's claim goes (`claim_with`, `add`): an agent device,
    /// such as agentClaude on the person's Mac, which acts as its device vault by its own key from then on, with the
    /// shares its parent passes on to it. Each vault it founds then follows the person's standing grants, as every
    /// vault founded under them does (`avendb::engine::follow_standing`): their server setting, backup or relay, and
    /// none that reads, as an aven and a device vault act for their one owner alone. The device vault's parent and the
    /// device vault. Fails if this device belongs to no vault, the device offered isn't the one answering or takes no
    /// claim, the passkey isn't at hand, the vaults' rules refuse it (a second aven, a parent their vault doesn't own),
    /// or the device refuses the edit.
    pub async fn add_device_vault_with(
        &self,
        offer: &Offer,
        place: Place,
        passkey: SignerId,
        authenticator: &impl Authenticator,
    ) -> Result<(VaultId, VaultId)> {
        let _activity = self.shared.admit()?;
        let key = self.claim_key(offer).await?;
        let vault = self.add(offer, key, place, passkey, Step::Approve, authenticator).await?;
        let parent = move |lab: &Lab, me| match lab.state(me).vault(vault)?.owners[..] {
            [Principal::Vault(parent)] => Some(parent),
            _ => None,
        };
        let parent = self.read(parent).await.context("a device vault has one owner, its parent")?;
        let founded = match place {
            Place::UnderNew(_) => vec![parent, vault],
            Place::Under(_) => vec![vault],
            Place::Vault(_) | Place::Seed => vec![],
        };
        let follow =
            move |lab: &mut Lab, me| founded.into_iter().try_for_each(|v| follow_standing(lab, me, v).map(drop));
        self.try_act(follow).await?.map_err(|why| anyhow!("a new vault's standing grants are refused: {why:?}"))?;
        Ok((parent, vault))
    }

    /// Add session `device`, an agent this device hosts on its Mac (`Lab::host`), which runs no device of its own, to
    /// aven `aven` as a device of it, its key to seal to `key`, with `mceliece` the McEliece key it names, both handed
    /// by the agent as it connected: drafted here and signed in one ceremony of the passkey `passkey` made by
    /// `authenticator`, then signed by the agent too, asked through its session (`Lab::accept_hosted`), as a server
    /// signs its claim. The aven. Fails as `add_device_vault_with` does, or if the agent doesn't sign.
    pub async fn add_hosted_device(
        &self,
        device: SignerId,
        key: PublicKey,
        mceliece: Arc<[u8]>,
        aven: VaultId,
        passkey: SignerId,
        authenticator: &impl Authenticator,
    ) -> Result<VaultId> {
        let _activity = self.shared.admit()?;
        let human = self.shared.read(|lab, me| lab.vault_of(me)).await.context("this device belongs to no vault")?;
        let draft = move |lab: &mut Lab, me| {
            let nonce = lab.nonce();
            let mut drafting = lab.drafting(me);
            add_device_vault(&mut drafting, passkey, human, Place::Vault(aven), nonce, device, key)?;
            Ok::<_, Refusal>(drafting.done())
        };
        let drafts = self.shared.try_lab(draft).await?.map_err(|why| anyhow!("the device is refused: {why:?}"))?;
        let (_, (), claim) = self.sign(vec![(passkey, (), drafts)], true, Step::Approve, authenticator).await?;
        let claim = claim.context("a claim")?;
        let kept = self.shared.try_lab(move |lab, me| lab.accept_hosted(me, claim, mceliece)).await?;
        let vault = kept.map_err(|why| anyhow!("the agent's join is refused: {why:?}"))?;
        self.shared.changed.notify_one();
        Ok(vault)
    }

    /// Add the device `offer` names, which handed `key` to seal to (`claim_key`), to a device vault at `place`
    /// (`add_device_vault`), the edits drafted on this device and signed in one ceremony of the passkey `passkey`, for
    /// `step`; this device keeps them, but the last, which adds the device: its claim of it (`Lab::claim`), which the
    /// device signs too and keeps (`Lab::accept_claim`), and answers with its join (`send_claim`). The device vault.
    async fn add(
        &self,
        offer: &Offer,
        key: PublicKey,
        place: Place,
        passkey: SignerId,
        step: Step,
        authenticator: &impl Authenticator,
    ) -> Result<VaultId> {
        let _activity = self.shared.admit()?;
        let human = self.shared.read(|lab, me| lab.vault_of(me)).await.context("this device belongs to no vault")?;
        let device = offer.device;
        let draft = move |lab: &mut Lab, me| {
            let nonce = lab.nonce();
            let mut drafting = lab.drafting(me);
            add_device_vault(&mut drafting, passkey, human, place, nonce, device, key)?;
            Ok::<_, Refusal>(drafting.done())
        };
        let drafts =
            self.shared.try_lab(draft).await?.map_err(|why| anyhow!("the device vault is refused: {why:?}"))?;
        let (_, (), claim) = self.sign(vec![(passkey, (), drafts)], true, step, authenticator).await?;
        self.send_claim(offer, claim.context("a claim")?).await
    }

    /// Edits that need the approval of a vault its person's passkey `passkey` roots, or of one their vault owns, as the
    /// genesis of a vault their vault owns or an owner share: `draft` drafts them on this device one on top of the
    /// other (`Lab::drafting`), and `authenticator` signs them all in one ceremony; then this device keeps them in that
    /// order and tells its peers. What `draft` returned. Fails if this device's view refuses one, or the passkey
    /// didn't sign them.
    pub async fn approve_with<T: Send + 'static>(
        &self,
        passkey: SignerId,
        draft: impl FnOnce(&mut Drafting<'_>, SignerId) -> Result<T, Refusal> + Send + 'static,
        authenticator: &impl Authenticator,
    ) -> Result<T> {
        let _activity = self.shared.admit()?;
        let drafted = move |lab: &mut Lab, me| {
            let mut drafting = lab.drafting(me);
            let out = draft(&mut drafting, me)?;
            Ok::<_, Refusal>((out, drafting.done()))
        };
        let (out, drafts) = self.shared.try_lab(drafted).await?.map_err(|why| anyhow!("refused: {why:?}"))?;
        self.sign(vec![(passkey, (), drafts)], false, Step::Approve, authenticator).await?;
        Ok(out)
    }

    /// The connection to the device `offer` names, once its hello proved it the device offered.
    async fn offered(&self, offer: &Offer) -> Result<Peer> {
        let _activity = self.shared.admit()?;
        self.try_know(offer.addr.clone())?;
        let endpoint = offer.addr.id;
        let peer = self.shared.connection(endpoint).await?;
        if peer.device != offer.device {
            bail!("the device at {endpoint} isn't the one offered");
        }
        Ok(peer)
    }

    /// The avenMAIA the server `offer` names is a device of, by its card (`contact`): none while nobody has
    /// claimed it.
    async fn avenceo(&self, offer: &Offer) -> Result<Option<VaultId>> {
        let _activity = self.shared.admit()?;
        self.offered(offer).await?;
        self.shared.contact(offer.addr.id).await.context("the server's card")?;
        let server = offer.device;
        Ok(self.shared.read(move |lab, me| lab.server_vault_of(me, server)).await)
    }

    /// The key to seal to the server `offer` names hands while nobody has claimed it (`Lab::claim_key`).
    async fn claim_key(&self, offer: &Offer) -> Result<PublicKey> {
        let _activity = self.shared.admit()?;
        let peer = self.offered(offer).await?;
        let key = session::exchange(&peer.conn, session::CLAIM_KEY, &[], session::KEY_LIMIT).await;
        Ok(PublicKey::from_wire(&key.context("the server takes no claim: a vault has claimed it")?)?)
    }

    /// Sign `sets`, edits drafted for each of a few passkeys, one of them its person's, all over one batch
    /// (`Lab::drafting`, `Lab::drafting_for`), in one ceremony for `step` made by `authenticator`; and keep the set of the
    /// passkey whose P-256 key the ceremony's assertion verifies under, or of the Touch ID key whose keys the ceremony's
    /// are, on this device in the order it was drafted; but
    /// its last edit, if `claiming`, which adds a server to avenCEO: this device's claim of it (`Lab::claim`), which the
    /// server signs too (`send_claim`). That passkey, what its set was drafted with, and the claim.
    async fn sign<T: Send + 'static>(
        &self,
        sets: Vec<(SignerId, T, Vec<Unsigned>)>,
        claiming: bool,
        step: Step,
        authenticator: &impl Authenticator,
    ) -> Result<(SignerId, T, Option<Claim>)> {
        let _activity = self.shared.admit()?;
        let first = sets.first().and_then(|(_, _, drafts)| drafts.first());
        let challenge = first.context("nothing to sign")?.challenge();
        let signer = sets.first().map(|(p, _, _)| *p);
        let keys = self.shared.read(move |lab, _| signer.and_then(|p| lab.keys_of(p))).await;
        let ceremony = ceremony_of(authenticator, keys, challenge, step).await?;
        let keep = move |lab: &mut Lab, me| {
            let mut made = |p: SignerId| match (lab.take_in(p, &ceremony), ceremony.assertion()) {
                (Some(SignerKeys::Passkey { p256, .. }), Some(a)) => a.verify(&p256, EditId(challenge)),
                (Some(keys @ SignerKeys::Enclave { .. }), None) => ceremony.is_enclave_of(&keys),
                _ => false,
            };
            let at = sets.iter().position(|(p, _, _)| made(*p)).ok_or(Refusal::BadSignature)?;
            let (passkey, out, mut drafts) = sets.into_iter().nth(at).ok_or(Refusal::BadSignature)?;
            let claim = if claiming { drafts.pop() } else { None };
            for draft in drafts {
                lab.complete(me, draft, &[(passkey, &ceremony)])?;
            }
            let claim = claim.map(|draft| lab.claim(me, draft, &[(passkey, &ceremony)])).transpose()?;
            Ok::<_, Refusal>((passkey, out, claim))
        };
        let kept =
            self.shared.try_lab(keep).await?.map_err(|why| anyhow!("the passkey didn't sign it all: {why:?}"))?;
        self.shared.changed.notify_one();
        Ok(kept)
    }

    /// Send the server `offer` names this device's claim of it (`sign`), and keep the join it answers with, which makes
    /// the server a device of avenCEO. Then they sync. avenCEO.
    async fn send_claim(&self, offer: &Offer, claim: Claim) -> Result<VaultId> {
        let _activity = self.shared.admit()?;
        let peer = self.offered(offer).await?;
        let (id, server) = (claim.add.id(), offer.device);
        let Action::Share(Sharing::Device { vault: avenceo, .. }) = claim.add.action else {
            bail!("a claim that adds no device")
        };
        let join = session::exchange(&peer.conn, session::CLAIM, &claim.to_wire(), session::REPLY_LIMIT).await;
        let Join { edit, blobs } = Join::from_wire(&join.context("the server refuses the claim")?)?;
        if edit.edit.id() != id {
            bail!("the server answered the claim with another edit");
        }
        let blobs = blobs.into_iter().map(Arc::from).collect();
        let kept = self.shared.try_lab(move |lab, me| {
            lab.receive(me, vec![edit], blobs);
            lab.server_vault_of(me, server)
        });
        if kept.await? != Some(avenceo) {
            bail!("the server's join doesn't make it avenCEO's device");
        }
        self.shared.changed.notify_one();
        self.shared.ask(peer.endpoint).await?;
        Ok(avenceo)
    }

    /// Tell it where a peer is.
    pub fn know(&self, addr: EndpointAddr) {
        self.try_know(addr).expect("know requires an open node");
    }

    pub fn try_know(&self, addr: EndpointAddr) -> Result<()> {
        let _activity = self.shared.admit()?;
        self.shared.lookup.add_endpoint_info(addr);
        Ok(())
    }

    /// Act on its Lab as its device, as its app does: a write, a share, an edit. Then it tells its peers of whatever
    /// changed.
    /// Compatibility wrapper for callers that statically own an open Node. Runtime
    /// app/protocol operations use try_act and propagate shutdown admission failures.
    pub async fn act<T: Send + 'static>(&self, f: impl FnOnce(&mut Lab, SignerId) -> T + Send + 'static) -> T {
        self.try_act(f).await.expect("acting requires an open node")
    }

    pub async fn try_act<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Lab, SignerId) -> T + Send + 'static,
    ) -> Result<T> {
        let sampled = self.shared.receipts.enabled() || self.shared.ui_receipts.enabled();
        // a person's write goes ahead of every read and background turn waiting (`lab_schedule`, `Writes.lean`)
        let (out, edit) = self.shared.try_lab_class(lab_schedule::Class::Write, move |lab, me| {
            let before = if sampled { lab.log(me).ids().len() } else { 0 };
            let out = f(lab, me);
            let edit = if sampled && lab.log(me).ids().len() > before {
                lab.log(me).edits().iter().zip(lab.log(me).ids()).skip(before).rev()
                    .find_map(|(edit, id)| matches!(avendb::sync::log_of(edit, *id), Some(avendb::sync::LogId::Entry(_))).then_some(*id))
            } else { None };
            (out, edit)
        }).await?;
        let completed = Instant::now();
        self.shared.changed.notify_one();
        if let Some(edit) = edit { self.shared.observe_edit(edit, completed); }
        Ok(out)
    }

    /// Run `f` as session `s`, which its device hosts (`Lab::host`): each read, ask and change `f` makes through the node
    /// acts as `s`, on the device's one store.
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn acting<F: std::future::Future>(&self, s: SignerId, f: F) -> F::Output {
        ACTING.scope(s, f).await
    }

    /// Who acts through the node here: the session `acting` names, else its device.
    pub fn acting_as(&self) -> SignerId {
        acting().unwrap_or(self.shared.me)
    }

    /// The entries of vault `vault` whose type, tag or link is one of `labels` (`avendb::index::type_label`,
    /// `tag_label`, `link_label`), the newest first, each with its creation, older than `after` (the last of a page
    /// before), at most `limit`, read off its shelf's shared index (B1, `shared_index`) as of its last save: what a
    /// view lists without the log. Nothing for a node that keeps no shelf.
    pub async fn shared_find(
        &self,
        vault: VaultId,
        labels: Vec<String>,
        after: Option<(u64, EntryId)>,
        limit: usize,
    ) -> Result<Vec<(u64, EntryId)>> {
        let Some(index) = &self.shared.shared_index else { return Ok(vec![]) };
        Ok(index.find(&self.shared.lab, self.shared.me, vault, &labels, after, limit).await?)
    }

    /// The newest `w` entries of vault `vault` whose type, tag or link is one of `labels`, the newest first, read off its
    /// shared index and the tail of edits after its last save (B3, `query_window`), never the log before it: a query
    /// view's window. `None` where the index can't say (no shelf, or the tail is of a key's or share's log), and the
    /// caller asks the engine.
    pub async fn window(&self, vault: VaultId, labels: Vec<String>, w: usize) -> Result<Option<query_window::Window>> {
        let Some(index) = &self.shared.shared_index else { return Ok(None) };
        Ok(query_window::window(index, &self.shared.lab, self.shared.me, vault, &labels, None, w).await?)
    }

    /// What window query `op` answers (`engine::window_of`), off its shared index and the tail after it
    /// (`query_window::answer`), never the log before it; `None` where the index can't say, and the engine answers.
    pub(crate) async fn windowed(&self, op: &serde_json::Value) -> Option<serde_json::Value> {
        let index = self.shared.shared_index.as_ref()?;
        query_window::answer(index, &self.shared.lab, self.shared.me, op).await.ok().flatten().map(|(got, _)| got)
    }

    /// A page of posts (`{"op": "posts", "limit"?, "after"?}`, as the engine answers it) off its shared index and the
    /// tail of edits after its last save (`posts_page`, `PostsPage.lean`), never a walk of every entry it holds; `None`
    /// where the index can't say (no shelf, or the tail is of a key's or share's log), and the caller asks the engine.
    pub(crate) async fn posts_indexed(&self, op: &Value) -> Option<Value> {
        let index = self.shared.shared_index.as_ref()?;
        let o = op.as_object()?;
        let (limit, after) = match avendb::engine::posts_args(o) {
            Ok(args) => args,
            Err(why) => return Some(why.to_json()),
        };
        posts_page::page(index, &self.shared.lab, self.shared.me, limit, after).await.ok().flatten()
    }

    /// The root of its shared index and the head of the edits it is of, as its last save left them: what a peer holds
    /// it to before it reads through pages it fetched (`ShelfIndex.I5_trusted_reads`).
    pub async fn shared_index_root(&self) -> Option<(Option<[u8; 32]>, u64)> {
        let index = self.shared.shared_index.as_ref()?;
        Some((index.root().await, index.stamp().await.at))
    }

    /// Read its Lab as its device.
    pub async fn read<T: Send + 'static>(&self, f: impl FnOnce(&Lab, SignerId) -> T + Send + 'static) -> T {
        self.shared.read(f).await
    }

    /// Act on its Lab as its device in a dry run (`Lab::dry`): every edit asked for is checked and refused as ever,
    /// and none is made, so its peers are told of nothing.
    pub async fn dry<T: Send + 'static>(&self, f: impl FnOnce(&mut Lab, SignerId) -> T + Send + 'static) -> T {
        self.try_dry(f).await.expect("dry run requires an open node")
    }

    pub async fn try_dry<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Lab, SignerId) -> T + Send + 'static,
    ) -> Result<T> {
        self.shared.try_lab(|lab, me| lab.dry(|lab| f(lab, me))).await
    }

    /// Ask the device at endpoint `peer` now, whatever it announced: the edits and McEliece keys it may send this one.
    /// How many edits were new.
    pub async fn sync_with(&self, peer: EndpointId) -> Result<usize> {
        let _activity = self.shared.admit()?;
        self.shared.ask(peer).await
    }

    /// Ask the device at endpoint `peer` now for the entries of the vaults `vaults` alone (`session::ASK_VAULTS`), and
    /// for the logs that are no entry's, the vaults', shares' and audiences', which say who may do what: what a node
    /// that asks only when told (`Options::lazy`) brings for a call that touches those vaults. How many edits were new.
    pub async fn bring(&self, peer: EndpointId, vaults: BTreeSet<VaultId>) -> Result<usize> {
        let _activity = self.shared.admit()?;
        self.shared.asking(peer, Scope::Vaults(vaults)).await
    }

    /// Ask the device at endpoint `peer` now for the logs `logs` alone (`session::ASK_LOGS`), as an entry a call names
    /// that the node holds nothing of yet. How many edits were new.
    pub async fn bring_logs(&self, peer: EndpointId, logs: BTreeSet<LogId>) -> Result<usize> {
        let _activity = self.shared.admit()?;
        self.shared.asking(peer, Scope::Logs(logs)).await
    }

    /// Mark the entry logs `logs` as what a page reads now: an asking of what a peer holds more of takes them before
    /// the other entries' (`Shared::ask_differing`), until one asked for them. Logs that are no entry's come first
    /// anyway.
    pub fn want(&self, logs: impl IntoIterator<Item = LogId>) {
        self.try_want(logs).expect("want requires an open node");
    }

    pub fn try_want(&self, logs: impl IntoIterator<Item = LogId>) -> Result<()> {
        let _activity = self.shared.admit()?;
        let entries = logs.into_iter().filter(|l| matches!(l, LogId::Entry(_)));
        self.shared.wanted.lock().expect("wanted").extend(entries);
        Ok(())
    }

    /// Ask the device at endpoint `peer` for its contact card (`Lab::card`), as a device asks the server for its
    /// vault's log before a vault gives the server relay on its entries. How many edits were new.
    pub async fn contact(&self, peer: EndpointId) -> Result<usize> {
        let _activity = self.shared.admit()?;
        self.shared.contact(peer).await
    }

    /// It takes and keeps at most what `limits` says (`limits`): the bytes of one edit, of one file it keeps whole,
    /// and of each person's backup by the cap group of Maia City they hold (`avendb::quota`). A node told nothing takes
    /// and keeps whatever its peers bring.
    pub fn limit(&self, limits: Limits) {
        self.try_limit(limits).expect("limit requires an open node");
    }

    pub fn try_limit(&self, limits: Limits) -> Result<()> {
        let _activity = self.shared.admit()?;
        self.shared.keeping.lock().expect("keeping").limits = limits;
        self.shared.changed.notify_one();
        Ok(())
    }

    /// What it keeps for person `p`, the human vault whose backup it is, as it last weighed it (`limits::Usage`): none
    /// before it weighed it, or where it limits nobody.
    pub fn backup(&self, p: VaultId) -> Option<Usage> {
        self.shared.keeping.lock().expect("keeping").usage(p)
    }

    /// Its device, a server, takes a new vault from its peers only where it welcomes it, or again any (`Lab::gate`): a
    /// person's with the invite it claims, a coop or an aven an admin of the vault it serves owns.
    pub async fn gate(&self, on: bool) -> Result<()> {
        self.shared.try_lab(move |lab, me| lab.gate(me, on)).await
    }

    /// Claim the invite a link names for this device's vault, through the server `offer` names, which takes a new
    /// person's vault only with the invite it claims (`Lab::gate`): the server hands the invite, share `share`, to
    /// whoever names it (`Lab::invite_card`); the key made again from `secret`, the link's other half, and this device
    /// sign its claim (`Lab::claim_invite`), with no owner of the vault it is over signing; and this device hands the
    /// server the logs of its vault and the claim at once (`Lab::sign_up_card`), which the server takes. The key is
    /// forgotten once it signed. Fails if this device belongs to no vault, the server knows no such invite or a vault
    /// claimed it already, or the server takes the vault no more.
    pub async fn claim_invite(&self, offer: &Offer, share: ShareId, secret: [u8; 32]) -> Result<VaultId> {
        let _activity = self.shared.admit()?;
        let peer = self.shared.connection(offer.addr.id).await?;
        let reply = session::exchange(&peer.conn, session::INVITE, &share.0, session::REPLY_LIMIT).await;
        let Reply { edits, .. } = Reply::from_wire(&reply.context("the server knows no such invite")?)?;
        let claim = move |lab: &mut Lab, me| -> Result<(VaultId, Vec<Signed>), Refusal> {
            lab.receive(me, edits, Vec::new());
            let vault = lab.vault_of(me).ok_or(Refusal::NotActing)?;
            // an invite made before the key move names its key in SLH-DSA, which signs nothing since the fork: refused
            let key = lab.invite_key(secret);
            let claimed = lab.claim_invite(me, share, vault, key);
            lab.lose(key);
            claimed?;
            Ok((vault, lab.sign_up_card(me)))
        };
        let (vault, edits) =
            self.shared.try_lab(claim).await?.map_err(|why| anyhow!("the invite is refused: {why:?}"))?;
        self.shared.changed.notify_one();
        let card = Reply { edits, ..Reply::default() }.to_wire();
        session::exchange(&peer.conn, session::SIGN_UP, &card, 0).await.context("the server takes no such sign-up")?;
        Ok(vault)
    }

    /// Marks each change of what its device holds: how many edits and McEliece keys (`Lab::size`), after every act of
    /// its own and every edit it takes from a peer.
    pub fn changes(&self) -> watch::Receiver<(usize, usize)> {
        self.shared.size.subscribe()
    }

    /// How many times what the node shows changed, as it changes (`Jobs::stir`): its jobs, the pages it took, its
    /// peers and what they hold, what its device holds. A page waits on it to read again, never on a timer.
    pub fn stirs(&self) -> watch::Receiver<u64> {
        self.shared.jobs.stirs()
    }

    /// The device at endpoint `peer` as its hello proved it, once they are connected.
    pub fn proven(&self, peer: EndpointId) -> Option<SignerId> {
        self.shared.peers.lock().expect("peers").get(&peer).map(|p| p.device)
    }

    /// The device its device knows at endpoint `endpoint`, the one whose ed25519 key it is (`Lab::peers`), as it last
    /// worked out whom it tells what: the device a hello there proves, connected or not.
    pub fn device_at(&self, endpoint: EndpointId) -> Option<SignerId> {
        let reach = self.shared.reach.lock().expect("reach");
        reach.iter().find(|(_, r)| r.endpoint == endpoint).map(|(device, _)| *device)
    }

    /// What its device holds for good (`Holdings`), as it tells its peers: of each log the frontier of the edits its
    /// shelf holds, of each file what its shelf holds whole, which on the server is its bucket; with no shelf, what it
    /// holds.
    pub async fn holdings(&self) -> Holdings {
        self.shared.own_logs().await;
        self.shared.own.lock().expect("own").holdings.clone()
    }

    /// What `device` told this node it holds for good, on a connection whose hello proved it, if it told anything.
    pub fn holdings_of(&self, device: SignerId) -> Option<Holdings> {
        self.shared.held.lock().expect("held").get(&device).cloned()
    }

    /// The newest statement `device` signed of its holdings that this node keeps (H2), heard from it or passed on by
    /// any peer, or kept on its shelf.
    pub fn statement_of(&self, device: SignerId) -> Option<Statement> {
        self.shared.statement_of(device)
    }

    /// Where each entry and each file its device holds is synced to (`SyncedTo`): this device, once its shelf holds
    /// every edit of the entry it holds, or the whole file; and each device whose own holdings, as it told them, hold
    /// as much, among those that may hold it by this device's view: on a live connection or with no statement, as it
    /// announced them, else as its newest statement says, with when it checked (`Holder::checked`).
    pub async fn synced_to(&self) -> SyncedTo {
        self.shared.synced_to().await
    }

    /// What it does in the background: the files it brings in and keeps, and what it takes from its peers, those
    /// under way and the last that ended (`jobs`), as its `jobs` op tells them.
    pub fn jobs(&self) -> &Jobs {
        &self.shared.jobs
    }

    /// How far its device is synced with the peers it is connected to, by what each told it it holds (`Holdings`), as
    /// the `synced` op tells it: `{"peers", "logs", "behind", "pulling", "pages"}`, how many of them told it, how many
    /// logs they hold between them that this device may hold, how many of those hold edits this device lacks (`differ`),
    /// which it asks them for, how many pulls from them run now (`jobs`), and how many pages of edits it took since it
    /// started: a log counts once whole, and a page brings edits of many, so the pages show a pull moving while the
    /// logs don't; and `unsaved`, where its shelf can't be written (a full disk, an OPFS quota): since when (Unix
    /// seconds), how many saves failed in a row and why the last did, else null. What a page's sync bar shows.
    pub async fn synced(&self) -> Value {
        let live: BTreeSet<SignerId> = {
            let peers = self.shared.peers.lock().expect("peers");
            peers.values().filter(|p| p.conn.close_reason().is_none()).map(|p| p.device).collect()
        };
        let heard: Vec<(SignerId, Vec<LogId>)> = {
            let held = self.shared.held.lock().expect("held");
            live.iter().filter_map(|d| Some((*d, held.get(d)?.logs.keys().copied().collect()))).collect()
        };
        let (mut logs, mut behind) = (BTreeSet::new(), BTreeSet::new());
        for (device, theirs) in &heard {
            logs.extend(theirs.iter().copied());
            behind.extend(self.shared.differ(*device).await);
        }
        let (running, _) = self.jobs().snapshot();
        let pulling = running.iter().filter(|j| j.kind == "pull").count();
        let pages = self.shared.sent.requests.load(Ordering::Relaxed);
        let unsaved = self.shared.unsaved.lock().expect("unsaved").clone()
            .map(|u| json!({ "since": u.since, "tries": u.tries, "error": u.error }));
        json!({ "peers": heard.len(), "logs": logs.len(), "behind": behind.len(), "pulling": pulling, "pages": pages,
            "unsaved": unsaved })
    }

    /// Where it syncs from and how (Samuel 2026-10-22: "the whole sync topology … what comes directly p2p and what via
    /// relay"), as the `network` op tells it for the Performance page: its own endpoint, the relay it is homed on and
    /// the addresses it is reached at directly; each peer it is connected to, its device, since when, who dialed whom,
    /// each path of the connection (direct or through a relay, the one it sends on now, its round trip, the bytes it
    /// carried each way and lost), how many logs that peer holds that this device lacks edits of (`differ`), and what
    /// this device took from it page by page (`traffic::Pulled`: pages, edits, bytes, the time it waited for them and
    /// took to take them, how fast, how much came direct and how much through a relay); the devices it took from that
    /// it is not connected to now; and its newest pages. Kept in memory alone, since it started.
    /// What this node answered its peers' askings with, and how long each page took it (`traffic::Served`), without
    /// which peer asked: what avenDB's server says on its public health.
    /// What this node's own Lab work cost since it started (`Lab::work_metrics`) and how far its replay is behind
    /// (`Lab::replay_lag`), read in a background turn: what avenDB's server says on its public health every minute.
    pub async fn work(&self) -> Value {
        self.shared
            .read_class(lab_schedule::Class::Background, |lab, me| json!({ "timers": lab.work_metrics(me), "replay": lab.replay_lag(me) }))
            .await
    }

    pub fn served(&self) -> Value {
        let mut served = self.shared.traffic.served_json();
        served["lab"] = self.shared.lab_turns.json();
        served["carriers"] = self.shared.transport_control.json();
        served
    }

    pub async fn network(&self) -> Value {
        let s = &self.shared;
        let me = s.endpoint.addr();
        let relays: Vec<String> = me
            .addrs
            .iter()
            .filter_map(|a| match a {
                iroh::TransportAddr::Relay(url) => Some(url.to_string()),
                _ => None,
            })
            .collect();
        let direct: Vec<String> = me
            .addrs
            .iter()
            .filter_map(|a| match a {
                iroh::TransportAddr::Ip(ip) => Some(ip.to_string()),
                _ => None,
            })
            .collect();
        let live: Vec<Peer> = {
            let peers = s.peers.lock().expect("peers");
            peers.values().filter(|p| p.conn.close_reason().is_none()).cloned().collect()
        };
        let mut seen = BTreeSet::new();
        let mut peers = Vec::new();
        for p in &live {
            seen.insert(p.device);
            let told = s.held.lock().expect("held").get(&p.device).map(|h| h.logs.len());
            let lacks = if told.is_some() { Some(s.differ(p.device).await.len()) } else { None };
            let paths: Vec<Value> = p
                .conn
                .paths()
                .iter()
                .map(|path| {
                    let st = path.stats();
                    json!({
                        "way": if path.is_relay() { "relay" } else if path.is_ip() { "direct" } else { "other" },
                        "addr": addr_of_path(path.remote_addr()),
                        "selected": path.is_selected(),
                        "rtt_ms": st.rtt.as_secs_f64() * 1000.0,
                        "rx": st.udp_rx.bytes,
                        "tx": st.udp_tx.bytes,
                        "lost": st.lost_bytes,
                    })
                })
                .collect();
            let st = p.conn.stats();
            peers.push(json!({
                "device": p.device.to_hex(),
                "endpoint": p.endpoint.to_string(),
                "since": p.since,
                "dialed": matches!(p.conn.side(), iroh::endpoint::Side::Client),
                "way": way_of(&p.conn),
                "paths": paths,
                "rx": st.udp_rx.bytes,
                "tx": st.udp_tx.bytes,
                "logs": told,
                "lacks": lacks,
                "pulled": s.traffic.of(&p.device).map(|t| t.to_json()),
            }));
        }
        let gone: Vec<Value> = s
            .traffic
            .devices()
            .into_iter()
            .filter(|d| !seen.contains(d))
            .filter_map(|d| Some(json!({ "device": d.to_hex(), "pulled": s.traffic.of(&d)?.to_json() })))
            .collect();
        json!({
            "served": s.traffic.served_json(),
            "policy_observations": s.receipts.json(),
            "reactive_observations": s.ui_receipts.json(),
            "me": { "endpoint": me.id.to_string(), "relays": relays, "direct": direct },
            "peers": peers,
            "gone": gone,
            "recent": s.traffic.recent(),
            "live": s.traffic.live_json(),
            "trace": s.traffic.trace_json(),
            "carriers": s.transport_control.json(),
            "files": s.asked.lock().expect("asked").json(),
        })
    }

    /// The devices it is connected to now, as their hellos proved them, each with how many logs it holds edits in that
    /// this device lacks (`differ`), as `synced` counts them, or `None` until it told what it holds: what a removal of
    /// keys waits for, as it cuts what rests on them that its drafter doesn't hold (T16).
    pub async fn live_peers(&self) -> BTreeMap<SignerId, Option<usize>> {
        let live: BTreeSet<SignerId> = {
            let peers = self.shared.peers.lock().expect("peers");
            peers.values().filter(|p| p.conn.close_reason().is_none()).map(|p| p.device).collect()
        };
        let mut out = BTreeMap::new();
        for device in live {
            let told = self.shared.held.lock().expect("held").contains_key(&device);
            let lacks = if told { Some(self.shared.differ(device).await.len()) } else { None };
            out.insert(device, lacks);
        }
        out
    }

    /// How many requests and announcements it has sent so far.
    pub fn sent(&self) -> (usize, usize) {
        (self.shared.sent.requests.load(Ordering::Relaxed), self.shared.sent.announcements.load(Ordering::Relaxed))
    }

    /// How many times it has dialed a peer so far, reached or not.
    pub fn dials(&self) -> usize {
        self.shared.sent.dials.load(Ordering::Relaxed)
    }

    /// The bounded outer packet bridge. Opening a route requires an authenticated peer descriptor; the inner
    /// connection still performs the same PQ TLS, Hello, sync authorization and blob gate.
    pub fn packet_transport(&self) -> transports::PacketTransport {
        self.shared.packets.clone()
    }

    /// The next command for the browser's single carrier adapter. Native listeners consume their
    /// own broker commands; applications must not attach a second consumer to the same node.
    pub async fn transport_next(&self) -> Option<transports::Command> {
        self.shared.packets.next().await
    }

    /// A private carrier-adapter event: capabilities, ready, signal or closed. A signal is sent only
    /// over the authenticated sync connection that negotiated this exact local route generation.
    pub async fn transport_event(&self, event: Value) -> Result<()> {
        transports::control::browser_event(&self.shared, event).await
    }

    /// One opaque outer datagram for an already negotiated route. A stale callback cannot name a new route.
    pub fn transport_receive(&self, id: &transports::RouteId, bytes: &[u8]) -> bool {
        self.shared.packets.receive(id, bytes)
    }

    /// Start an optional native HTTP/3 packet listener. Existing sync remains available if opening fails.
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn listen_webtransport(&self, config: transports::WtConfig) -> Result<()> {
        transports::control::listen(&self.shared, config).await
    }

    /// Start its own WebRTC peer, for the pages among its peers (an iPhone's) to reach it straight over ICE in place of
    /// the relay, which stays as their fallback: as the Mac app's node does. It offers its own addresses and the one
    /// its STUN servers see; every SDP and candidate goes only through the authenticated session of the peer it
    /// negotiated with, and the route carries only that same PQ connection's packets. Fails if it runs already.
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn serve_webrtc(&self, config: transports::RtcConfig) -> Result<()> {
        transports::control::serve_rtc(&self.shared, config).await
    }

    /// Its shelf lacks something its device holds (`edits`): its holdings name only what the shelf holds. Never, for a
    /// node with no shelf.
    pub async fn behind(&self) -> bool {
        let shared = self.shared.clone();
        self.shared.read(move |lab, me| shared.edits.as_ref().is_some_and(|edits| edits.lacks(lab, me))).await
    }

    /// Close its connections, its endpoint and its blob store, which the router closes with the blob protocol; with a
    /// shelf, first put there what it lacks, if it can.
    pub async fn shutdown(&self) -> Result<()> {
        self.begin_close();
        self.shared.lifecycle.closed().await.map_err(|e| anyhow!(e.to_string()))
    }

    /// A writable handle that closes with this Node, for its own app metadata.
    /// Read-only snapshots may keep using it after shutdown; new writes are refused.
    pub fn writer_shelf(&self) -> Option<Shelf> {
        self.shared.opts.shelf.clone()
    }

    fn begin_close(&self) {
        let shared = self.shared.clone();
        let router = self.router.clone();
        // The once-only transition happens before the owned task can be scheduled.
        // Duplicate shutdown callers observe the same completion without taking tasks.
        let tasks = &self.tasks;
        let mut tasks = tasks.lock().expect("node tasks");
        let owned = std::mem::take(&mut *tasks);
        self.shared.lifecycle.start_close(move |quiet| async move {
            shared.transport_control.shutdown().await;
            owned.iter().for_each(JoinHandle::abort);
            for task in owned {
                let _ = task.await;
            }
            // Closing endpoints and the blob protocol stops producers before waiting
            // for admitted operations, including detached requests and disk callbacks.
            router.shutdown().await.map_err(|e| Arc::<str>::from(e.to_string()))?;
            let proof = quiet.wait().await;
            let on = shared
                .opts
                .shelf
                .as_ref()
                .map(|s| s.finalizing(&proof))
                .transpose()
                .map_err(|e| Arc::<str>::from(e.to_string()))?;
            let saved = shared.save_on(on.as_ref()).await;
            shared.edit_transfer.close();
            saved.map_err(|e| Arc::<str>::from(format!("final save: {e:#}")))?;
            if let Some(on) = &on {
                on.fence().await.map_err(|e| Arc::<str>::from(format!("native disk fence: {e}")))?;
            }
            // On any failure the retained Shared still owns its lease and remains
            // closed. A replacement node cannot race a failed durability barrier.
            shared.writer.lock().expect("node writer").take();
            Ok(())
        });
    }
}

impl Drop for Node {
    fn drop(&mut self) {
        #[cfg(not(target_arch = "wasm32"))]
        if tokio::runtime::Handle::try_current().is_err() {
            self.shared.lifecycle.abandon();
            self.shared.transport_control.close();
            self.tasks.lock().expect("node tasks").iter().for_each(JoinHandle::abort);
            return;
        }
        self.begin_close();
    }
}

/// A node's Lab taking its device's edits back from its shelf a page at a time (`edits::Taker`, `Lab::restore_page`):
/// its restore begun at the first page, so a shelf that holds none leaves it as it was.
struct Restorer {
    lab: Option<Lab>,
    me: SignerId,
    /// The head it begins from, and the keys the device worked out before (`Warm::keys`), what its restore begins with.
    checked: Option<avendb::lab::Checked>,
    keys: Warm,
    restoring: Option<avendb::lab::Restoring>,
}

impl Restorer {
    /// Its Lab and its restore, taken out to work on (`Lab::restore_start` where it began none yet).
    fn take(&mut self) -> (Lab, avendb::lab::Restoring) {
        let mut lab = self.lab.take().expect("its Lab");
        let restoring = match self.restoring.take() {
            Some(r) => r,
            None => lab.restore_start(self.me, self.checked, &self.keys),
        };
        (lab, restoring)
    }

    /// Its Lab, its restore ended (`Lab::restore_end`) with `anchors` and `warm`, where it began one.
    async fn end(mut self, anchors: Vec<u8>, warm: Warm) -> Result<Lab> {
        let Some(r) = self.restoring.take() else { return Ok(self.lab.take().expect("its Lab")) };
        let (mut lab, me) = (self.lab.take().expect("its Lab"), self.me);
        let end = move || {
            lab.restore_end(me, r, &anchors, &warm);
            lab
        };
        #[cfg(not(target_arch = "wasm32"))]
        let lab = tokio::task::spawn_blocking(end).await?;
        // a page has no threads to spare
        #[cfg(target_arch = "wasm32")]
        let lab = end();
        Ok(lab)
    }
}

impl edits::Taker for Restorer {
    async fn begin(&mut self, checked: Option<avendb::lab::Checked>, warm: &Warm) -> Result<()> {
        (self.checked, self.keys) = (checked, Warm { keys: warm.keys.clone(), views: Vec::new(), shown: Vec::new() });
        // what it took of a head that didn't read whole goes
        if self.restoring.is_some() {
            let mut lab = self.lab.take().expect("its Lab");
            self.restoring = Some(lab.restore_start(self.me, checked, &self.keys));
            self.lab = Some(lab);
        }
        Ok(())
    }

    async fn page(&mut self, page: Vec<(Signed, Option<avendb::lab::Placed>)>, keys: Vec<Arc<[u8]>>, of_head: bool) -> Result<()> {
        let ((mut lab, mut r), me) = (self.take(), self.me);
        let take = move || {
            lab.restore_page_placed(me, &mut r, page, keys, of_head);
            (lab, r)
        };
        #[cfg(not(target_arch = "wasm32"))]
        let (lab, r) = tokio::task::spawn_blocking(take).await?;
        #[cfg(target_arch = "wasm32")]
        let (lab, r) = take();
        (self.lab, self.restoring) = (Some(lab), Some(r));
        Ok(())
    }

    async fn keys(&mut self, keys: Vec<Arc<[u8]>>) -> Result<()> {
        if let (Some(lab), Some(r)) = (self.lab.as_mut(), self.restoring.as_mut()) {
            lab.restore_keys(self.me, r, keys);
        }
        Ok(())
    }
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

/// What a node asks a peer for: all the peer may send it (`session::REQUEST`), the logs it names alone
/// (`session::ASK_LOGS`), or the entries of the vaults it names alone (`session::ASK_VAULTS`).
#[derive(Clone)]
enum Scope {
    All,
    Logs(BTreeSet<LogId>),
    Vaults(BTreeSet<VaultId>),
}

/// The way connection `conn` sends now: `direct` over an IP path, `relay` through a relay, `` where none is selected.
/// How many times a pull's pages may end elsewhere than its peer's cuts said (`session::CUTS`) before it asks the rest
/// page after page: its peer's edits changed under them, or the peer cuts pages otherwise than it says.
const MISSES: u32 = 3;

/// What landed first of a pull's pages and cuts in flight, or what else it waited on was done.
enum Landing<P, C, T> {
    Page(P),
    Cuts(C),
    Done(T),
}

/// The first of `pages` and `cuts` to land; never, while neither has any in flight.
async fn landing<P: std::future::Future, C: std::future::Future, T>(
    pages: &mut FuturesUnordered<P>,
    cuts: &mut FuturesUnordered<C>,
) -> Landing<P::Output, C::Output, T> {
    let page = async {
        match pages.next().await {
            Some(page) => Landing::Page(page),
            None => future::pending().await,
        }
    };
    let cut = async {
        match cuts.next().await {
            Some(cut) => Landing::Cuts(cut),
            None => future::pending().await,
        }
    };
    future::or(page, cut).await
}

fn way_of(conn: &Connection) -> &'static str {
    let paths = conn.paths();
    match paths.iter().find(|p| p.is_selected()) {
        Some(p) if p.is_ip() => "direct",
        Some(p) if p.is_relay() => "relay",
        Some(_) => "other",
        None => "",
    }
}

/// A path's address at the other end, in words: its IP address and port, or its relay's address.
fn addr_of_path(a: &iroh::TransportAddr) -> String {
    match a {
        iroh::TransportAddr::Ip(ip) => ip.to_string(),
        iroh::TransportAddr::Relay(url) => url.to_string(),
        other => format!("{other:?}"),
    }
}

/// A connection to a peer, dialed or accepted, with the device its hello proved.
#[derive(Clone)]
struct Peer {
    conn: Connection,
    device: SignerId,
    endpoint: EndpointId,
    /// When its hellos proved it, in milliseconds since 1970.
    since: u64,
}

/// What a node's tasks share.
struct Shared {
    /// Admission remains open until the one owned shutdown finalizer closes it.
    lifecycle: Arc<lifecycle::Lifecycle>,
    writer: Mutex<Option<Writer>>,
    me: SignerId,
    lab: Mutex<Lab>,
    lab_schedule: Arc<lab_schedule::Schedule>,
    /// How long Lab calls waited and held it, by call (`Node::served`).
    lab_turns: Arc<lab_schedule::Turns>,
    /// Its device's edits on its shelf, if it keeps one.
    edits: Option<edits::Edits>,
    /// Its shared index on its shelf, if it keeps one (B1, `shared_index`).
    shared_index: Option<shared_index::SharedIndex>,
    /// Durable supplemental signer roots; unsupported shelves keep ordinary signatures only.
    signers: Option<signers::Signers>,
    endpoint: Endpoint,
    lookup: MemoryLookup,
    packets: transports::PacketTransport,
    /// Authenticated optional-carrier negotiation, bound to each selected sync connection.
    transport_control: transports::control::Control,
    /// Its blob store: the McEliece keys it offers, and the sealed pieces of files (`files`).
    store: Store,
    opts: Options,
    /// The live connection to each peer, with the device its hello proved: whom the blob gate lets in.
    peers: Mutex<HashMap<EndpointId, Peer>>,
    dependency_peer_turn: std::sync::atomic::AtomicUsize,
    /// A lock for each endpoint, held while dialing it, so that a node dials each peer once.
    dialing: Mutex<HashMap<EndpointId, Arc<tokio::sync::Mutex<()>>>>,
    /// Its device's edits by their logs, as they were when they were last worked out.
    logs: Mutex<Option<Arc<Logs>>>,
    /// The same of the edits its shelf holds while it holds fewer (`own_logs`), grown as the shelf catches up.
    held_logs: Mutex<Option<Logs>>,
    /// One owned world snapshot/conversion at a time; targeted reads and writes bypass it.
    world_encoding: Arc<tokio::sync::Mutex<()>>,
    entry_encoding: Arc<tokio::sync::Mutex<()>>,
    /// Serialize durable checkpoint tag changes; a queued old save cannot replace a newer pin.
    checkpoint_pins: Arc<tokio::sync::Mutex<()>>,
    /// One page's signature checker at a time, independent of interactive Lab access.
    receive_checking: Arc<tokio::sync::Mutex<()>>,
    /// What its device holds for good.
    own: Mutex<Own>,
    /// Each device it may tell, by its device's view, and what of its holdings it tells it.
    reach: Mutex<Arc<BTreeMap<SignerId, Reach>>>,
    /// What each device told it it holds, on a connection whose hello proved that device.
    held: Mutex<HashMap<SignerId, Holdings>>,
    /// What each peer was last told, and on which connection (`Connection::stable_id`).
    told: Mutex<HashMap<SignerId, (usize, Holdings)>>,
    /// The signed statements of holdings it keeps, signs and passes on (H2, `statements`).
    statements: Mutex<statements::Statements>,
    receipts: peer_receipts::Receipts,
    ui_receipts: peer_receipts::Receipts,
    /// The node loop's handle: the telling of each peer and the asking of each, with their waits (`node_loop`).
    outreach: node_loop::Outreach,
    /// The entry logs its pages asked for (`Node::want`): an asking of what a peer holds more of takes them first.
    wanted: Mutex<BTreeSet<LogId>>,
    /// How fresh its reads are (`fresh`): the stamp of its last current read, and the walk of what its live peers
    /// hold that it lacks, kept until what they hold or what it holds changes.
    fresh: fresh::Fresh,
    /// Which peer each log is asked of now (`Claims`): a log comes from one peer at a time, never from each.
    pub(crate) claims: Mutex<Claims>,
    /// Active app/query windows, replaced or released independently of one-shot brings.
    interests: Mutex<interest::Interests>,
    discovery_running: Mutex<HashMap<String, bool>>,
    /// The discovery rounds that asked a peer, and the one whose find first named something (0 = none yet): a test
    /// tells by them that the round a connection started brought a view's entries, never a later one.
    pub(crate) discovery_rounds: AtomicUsize,
    pub(crate) discovery_first_found: AtomicUsize,
    /// The keys and audiences the views' last finds stood on (`Lab::index_mark`): a change finds again.
    discovery_mark: Mutex<usize>,
    discovery_answer: Arc<tokio::sync::Semaphore>,
    /// The blind index rows it keeps, where it keeps an index (`Options::index`).
    told_rows: Option<told_index::ToldIndex>,
    /// Of each peer, the change of the device's entries it was last told the rows of, `None` once it refused them.
    index_told: Mutex<HashMap<EndpointId, Option<u64>>>,
    /// A peer connected: tell it the rows (`blind::index_teller`).
    index_due: Notify,
    /// The McEliece keys in the blob store, by hash and by id.
    offered: Mutex<blobs::Offered>,
    /// Its blob store over its shelf, if it keeps one (`shelf`): what the shelf holds whole.
    shelf: Option<shelf::ShelfStore>,
    /// The blob connections the gate let in, each with the device and endpoint of the live sync connection that let
    /// it in.
    blob_peers: Mutex<HashMap<u64, (SignerId, EndpointId)>>,
    /// The vaults the device of each sync connection follows, by the connection (`Connection::stable_id`): as its last
    /// request named them (`sync::Ask::follow`), which the gate lets its blob connections fetch by.
    follows: Mutex<HashMap<usize, Vec<VaultId>>>,
    /// The sync connections whose node refused a request for a packed reply (K5, `session::PACKED`), a node from before
    /// it, by the connection (`Connection::stable_id`): it asks those for whole replies.
    unpacked: Mutex<HashSet<usize>>,
    /// Connections without usable supplemental proofs, independent of their packed-reply support.
    unbatched: Mutex<HashSet<usize>>,
    /// The connections whose peer refused a `session::CUTS`, a peer from before S6: asked page after page.
    uncut: Mutex<HashSet<usize>>,
    /// The connections whose peer refused or failed a `session::STUBS`, a peer from before box stubs: pulled whole.
    unstubbed: Mutex<HashSet<usize>>,
    /// The connections whose peer didn't answer a proof request of version 2, with paths in place of signatures (P8):
    /// an older node, or one that couldn't link a root; asked version 1 from then on.
    unstripped: Mutex<HashSet<usize>>,
    /// The connections whose peer didn't answer a segment request (S8, `proofs` version 3): asked version 2 or 1.
    unsegmented: Mutex<HashSet<usize>>,
    /// Incremental, peer-scoped holdings trees and bounded root-bound receiving rounds.
    ranges: Mutex<ranges::Cache>,
    edit_transfer: edit_transfer::Runtime,
    /// The soonest a pull brings its device up to date again, unless it must (`Shared::catch_up_paced`).
    paced: Mutex<Option<Instant>>,
    /// A catch-up waits for `paced` to pass, and runs then (`Shared::catch_up_later`).
    catch_up_due: AtomicBool,
    /// The pieces of the files whose HashSeq it holds, each with the files it is a piece of: what the gate hands out
    /// as those files.
    pieces: Mutex<HashMap<iroh_blobs::Hash, BTreeSet<avendb::sealed::FileRoot>>>,
    /// Its blob connections to its peers, for the files and McEliece keys it fetches.
    pool: ConnectionPool,
    /// Woken whenever the node's logs may have changed.
    changed: Notify,
    /// Newly staged or invalidated bounded owner-bootstrap work. Never a timer poll.
    bootstrap_due: Notify,
    /// How many edits and McEliece keys its device holds (`Node::changes`).
    size: watch::Sender<(usize, usize)>,
    /// Whether its device worked out something its shelf lacks, as last seen (`Lab::warm_due`).
    warm: AtomicBool,
    /// Since when its saves fail, how many failed, and why the last did: a full disk or an OPFS quota leaves what the
    /// device took off its shelf, which its person is told (`Node::synced`), never a silent stall. None once one saves.
    unsaved: Mutex<Option<Unsaved>>,
    /// How many messages it has sent.
    sent: Sent,
    /// What it does in the background, as its person watches it (`Node::jobs`).
    jobs: Jobs,
    /// What it took from each peer and how (`Node::network`).
    traffic: traffic::Traffic,
    /// Shared outgoing pull/page admission and bounded foreground peer latency hints.
    pulls: pulls::Budget,
    /// What it takes and keeps at most, and what it keeps for each person (`Node::limit`, `limits`).
    keeping: Mutex<limits::Keeping>,
    /// The files pages asked for that its device didn't hold, for the keeper to fetch first, and what it did (`files`).
    asked: Mutex<files::Asked>,
    /// Woken when a page asks for a file its device doesn't hold.
    files_asked: Notify,
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
}

/// What a node's device holds for good (`Holdings`), its logs as worked out when it held as much as `at` says: its
/// size (`Lab::size`), and how many of its edits its shelf held (`edits::Edits::held`).
struct Own {
    at: ((usize, usize), usize),
    revision: Option<avendb::policy::LogRevision>,
    holdings: Holdings,
}

/// What a device may know of a node's holdings by the node's view: the logs of the edits it may receive
/// (`Lab::announce`), and the files those bring, which it may fetch (T27). And its endpoint.
struct Reach {
    endpoint: EndpointId,
    logs: BTreeSet<LogId>,
    files: BTreeSet<FileRoot>,
}

/// Whom a node tells what, as worked out for the device's edits when they were as many as `size` says (`Lab::size`).
struct News {
    size: (usize, usize),
    revision: Option<avendb::policy::LogRevision>,
    reach: Arc<BTreeMap<SignerId, Reach>>,
    /// The passkeys that root the vaults in the device's view, whose passes a server's relay honours.
    roots: Vec<SignerId>,
    /// The node is a server whose device belongs to no vault yet: nobody has claimed it.
    claimable: bool,
    /// The invites of Maia City no vault claimed yet, whose passes a server's relay honours while it signs people up
    /// by invite.
    invites: Vec<ShareId>,
}

#[cfg(not(target_arch = "wasm32"))]
tokio::task_local! {
    /// The session a node's caller acts as (`Node::acting`).
    static ACTING: SignerId;
}

/// The session the calling task acts as (`Node::acting`), if any.
pub(crate) fn acting() -> Option<SignerId> {
    #[cfg(not(target_arch = "wasm32"))]
    return ACTING.try_with(|s| *s).ok();
    #[cfg(target_arch = "wasm32")]
    None
}

impl Shared {
    /// `f` on the Lab, off the async threads: its crypto takes milliseconds, a McEliece key pair seconds. The Lab's
    /// clock is the machine's, so an entry `f` creates says when (`Lab::set_now`). If what the device holds changed,
    /// its saver puts it on the shelf, if the node keeps one. A panic in `f`, a bug, fails the call that asked for it
    /// alone: it is caught while the Lab is still locked, so the lock isn't poisoned and every later call runs, logged,
    /// and carried on to the caller once the lock is let go.
    #[cfg(test)]
    async fn lab<T: Send + 'static>(self: &Arc<Self>, f: impl FnOnce(&mut Lab, SignerId) -> T + Send + 'static) -> T {
        self.try_lab(f).await.expect("internal compatibility call requires an open node")
    }

    /// Whole-operation admission for asynchronous I/O. A detached task must move its
    /// own ticket into that task instead of relying on its requesting future's ticket.
    pub(crate) fn admit(&self) -> Result<lifecycle::Ticket> {
        Ok(self.lifecycle.admit()?)
    }

    /// A mutation owns admission inside its actual blocking closure. Cancellation of
    /// its async waiter cannot make shutdown consider that closure quiescent early.
    pub(crate) async fn try_lab<T: Send + 'static>(
        self: &Arc<Self>,
        f: impl FnOnce(&mut Lab, SignerId) -> T + Send + 'static,
    ) -> Result<T> {
        self.try_lab_class(lab_schedule::Class::Foreground, f).await
    }

    pub(crate) async fn try_lab_class<T: Send + 'static>(
        self: &Arc<Self>, class: lab_schedule::Class,
        f: impl FnOnce(&mut Lab, SignerId) -> T + Send + 'static,
    ) -> Result<T> {
        let operation = self.admit()?;
        // A real browser task boundary lets pending page messages register foreground
        // work; immediately-ready Rust futures alone cannot yield the worker event loop.
        #[cfg(target_arch = "wasm32")]
        if class == lab_schedule::Class::Background { time::sleep(Duration::ZERO).await; }
        let (what, asked) = (std::any::type_name_of_val(&f), Instant::now());
        let turn = self.lab_schedule.acquire(class).await;
        let shared = self.clone();
        let me = acting().unwrap_or(self.me);
        let work = move || {
            let (_operation, _turn) = (operation, turn);
            let mut lab = shared.locked_lab();
            let _timed = Timed::new(&shared.lab_turns, what, asked);
            let ran = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                lab.set_now(unix_now());
                let before = lab.log(shared.me).revision();
                let bootstrap_before = lab.owner_bases_pending(shared.me);
                let missing_before = lab.owner_base_missing(shared.me);
                let keys_before = lab.owner_base_key_waits(shared.me);
                let lanes_before = lab.owner_base_lane_waits(shared.me);
                let anchors_before = lab.bootstrap_stamp(shared.me);
                let out = f(&mut lab, me);
                let now = lab.size(shared.me);
                // Restore and checkpoint withdrawal can replace edits without changing their count. Wake
                // subscriptions and the saver for those changes too; an ordinary read stays quiet.
                let revised = before != lab.log(shared.me).revision();
                let grew = shared.size.send_if_modified(|size| {
                    if *size == now && !revised {
                        return false;
                    }
                    *size = now;
                    true
                });
                let missing_after=lab.owner_base_missing(shared.me);
                let missing_changed=missing_before!=missing_after;
                let keys_after=lab.owner_base_key_waits(shared.me);
                let keys_changed=keys_before!=keys_after;
                let lanes_changed=lanes_before!=lab.owner_base_lane_waits(shared.me);
                if keys_changed || lanes_changed { shared.bootstrap_due.notify_one(); }
                if (lab.owner_bases_pending(shared.me) && (!bootstrap_before || grew || revised))
                    || (!missing_after.is_empty() && (missing_changed || grew || revised)) {
                    shared.bootstrap_due.notify_one();
                }
                // Key/body restoration may change only the materialized prefix, not log size.
                if missing_changed || keys_changed || lanes_changed { shared.size.send_modify(|_| {}); }
                // what it worked out, as a replay or a key it opened, wakes the saver too, once as it comes to
                let warm = !lab.locked(shared.me) && lab.warm_due(shared.me);
                if grew {
                    shared.jobs.stir();
                }
                let signing = shared.signers.as_ref().is_some_and(|signers| {
                    lab.signing_pending(shared.me) || (!lab.locked(shared.me) && signers.root_due())
                });
                if grew || signing || anchors_before != lab.bootstrap_stamp(shared.me) || (warm && !shared.warm.swap(true, Ordering::Relaxed)) {
                    shared.edits.iter().for_each(|edits| edits.due.notify_one());
                }
                if !warm {
                    shared.warm.store(false, Ordering::Relaxed);
                }
                out
            }));
            drop(lab);
            ran.unwrap_or_else(|panic| {
                let why = panic.downcast_ref::<&str>().copied().or(panic.downcast_ref::<String>().map(String::as_str));
                tracing::error!("avendb: a call on the Lab panicked, and fails alone: {}", why.unwrap_or("no message"));
                std::panic::resume_unwind(panic)
            })
        };
        #[cfg(not(target_arch = "wasm32"))]
        return Ok(tokio::task::spawn_blocking(work).await.context("the Lab's task")?);
        // a page's node runs in a worker of its own, which the Lab may hold up: after a long turn the worker's event
        // loop runs before the next, so the carrier's packets waiting in its socket are drained, not dropped
        #[cfg(target_arch = "wasm32")]
        {
            let began = Instant::now();
            let out = work();
            if began.elapsed() > LONG_TURN {
                time::sleep(Duration::ZERO).await;
            }
            Ok(out)
        }
    }

    /// Pure observation: does not set the clock, mutate the view, or wake persistence.
    /// A retained closed Node can safely read the immutable state it ended with.
    pub(crate) async fn read<T: Send + 'static>(
        self: &Arc<Self>,
        f: impl FnOnce(&Lab, SignerId) -> T + Send + 'static,
    ) -> T {
        self.read_class(lab_schedule::Class::Foreground, f).await
    }

    pub(crate) async fn read_class<T: Send + 'static>(
        self: &Arc<Self>, class: lab_schedule::Class,
        f: impl FnOnce(&Lab, SignerId) -> T + Send + 'static,
    ) -> T {
        #[cfg(target_arch = "wasm32")]
        if class == lab_schedule::Class::Background { time::sleep(Duration::ZERO).await; }
        let (what, asked) = (std::any::type_name_of_val(&f), Instant::now());
        let turn = self.lab_schedule.acquire(class).await;
        let shared = self.clone();
        let me = acting().unwrap_or(self.me);
        let work = move || {
            let _turn = turn;
            let lab = shared.locked_lab();
            let _timed = Timed::new(&shared.lab_turns, what, asked);
            f(&lab, me)
        };
        #[cfg(not(target_arch = "wasm32"))]
        return tokio::task::spawn_blocking(work).await.expect("the Lab's read task");
        #[cfg(target_arch = "wasm32")]
        {
            let began = Instant::now();
            let out = work();
            if began.elapsed() > LONG_TURN {
                time::sleep(Duration::ZERO).await;
            }
            out
        }
    }

    /// The Lab, locked. A call that changes it never poisons the lock (`lab` catches its panic first); one that only
    /// reads it (the saver's) changed nothing if it panicked, so the Lab it leaves is taken as it is rather than lost
    /// to every later call.
    pub(crate) fn locked_lab(&self) -> std::sync::MutexGuard<'_, Lab> {
        self.lab.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Where to reach `endpoint`: through the node's relay, if it has one, and wherever the lookup knows of.
    fn addr_of(&self, endpoint: EndpointId) -> EndpointAddr {
        self.opts.relay.iter().cloned().fold(EndpointAddr::new(endpoint), EndpointAddr::with_relay_url)
    }

    /// The live connection to `endpoint`, dialed if there is none.
    async fn connection(self: &Arc<Self>, endpoint: EndpointId) -> Result<Peer> {
        let _activity = self.admit()?;
        let lock = self.dialing.lock().expect("dialing").entry(endpoint).or_default().clone();
        let _dialing = lock.lock().await;
        if let Some(peer) = self.live(endpoint) {
            return Ok(peer);
        }
        self.sent.dials.fetch_add(1, Ordering::Relaxed);
        let conn = time::timeout(WAIT, self.dial(endpoint)).await.context("no answer")??;
        match time::timeout(WAIT, session::dial_hello(self, &conn)).await {
            Ok(Ok(device)) => {
                let _install = match self.admit() {
                    Ok(activity) => activity,
                    Err(error) => {
                        conn.close(session::REFUSED, b"node closing");
                        return Err(error);
                    }
                };
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

    /// A connection to `endpoint`: a dial, and a new one beside it every `REDIAL` while none has connected, the first
    /// that connects kept and the others dropped; or the error of the first that fails, which the peer answered.
    async fn dial(&self, endpoint: EndpointId) -> Result<Connection> {
        let _activity = self.admit()?;
        let mut dials = FuturesUnordered::new();
        loop {
            dials.push(self.endpoint.connect(self.addr_of(endpoint), ALPN));
            let answered = async { dials.next().await.map(|dialed| dialed.map_err(anyhow::Error::from)) };
            let due = async {
                time::sleep(REDIAL).await;
                None
            };
            if let Some(dialed) = future::or(answered, due).await {
                return dialed;
            }
        }
    }

    /// The connection to `endpoint` if there is one still open.
    fn live(&self, endpoint: EndpointId) -> Option<Peer> {
        let peers = self.peers.lock().expect("peers");
        peers.get(&endpoint).filter(|p| p.conn.close_reason().is_none()).cloned()
    }

    /// A connection whose hellos proved `device`, dialed or accepted. Control selects its live peer, preferring
    /// the lower endpoint's outgoing connection for crossed dials to the same device. This returns the actual new
    /// connection for its caller to serve, even if it is not selected; the node announces its holdings again.
    fn connected(self: &Arc<Self>, conn: Connection, device: SignerId) -> Peer {
        let endpoint = conn.remote_id();
        let peer = Peer { conn, device, endpoint, since: jobs::now_ms() };
        if self.opts.relay.is_some() {
            self.lookup.add_endpoint_info(self.addr_of(endpoint));
        }
        // Control owns peer selection and old-route retirement under its state→peers lock order.
        transports::control::connected(self, &peer);
        // what it last told `device`, kept: `tell` tells all again on a connection it told nothing yet, and a small
        // change since it first
        self.outreach.send(node_loop::Msg::Reached { device });
        self.index_told.lock().expect("index told").remove(&endpoint);
        self.index_due.notify_one();
        self.changed.notify_one();
        self.jobs.stir();
        peer
    }

    /// Asks `endpoint` for the edits the device there may send this one, and the McEliece keys they name that this one
    /// lacks: a page at a time, each taken as it comes, asking on after the last edit a page brought until the peer has
    /// no more. How many edits were new.
    async fn ask(self: &Arc<Self>, endpoint: EndpointId) -> Result<usize> {
        self.asking(endpoint, Scope::All).await
    }

    /// `ask`, of what `scope` names alone: once connected, a `pull` job of the peer's device, forgotten if it took
    /// nothing.
    async fn asking(self: &Arc<Self>, endpoint: EndpointId, scope: Scope) -> Result<usize> {
        self.pull(endpoint, scope, false, None).await
    }

    async fn pull(
        self: &Arc<Self>,
        endpoint: EndpointId,
        scope: Scope,
        background: bool,
        catch_up: Option<&pulls::CatchUp>,
    ) -> Result<usize> {
        self.pull_expected(endpoint, scope, background, catch_up, None, None, None).await
    }

    /// A live hint belongs to the authenticated identity that announced it. Fence that identity before building
    /// a request, then keep the captured Peer throughout the pull even if the endpoint's connection is replaced.
    async fn pull_expected(
        self: &Arc<Self>,
        endpoint: EndpointId,
        scope: Scope,
        background: bool,
        catch_up: Option<&pulls::CatchUp>,
        expected: Option<SignerId>,
        keys: Option<&mut BTreeSet<BlobId>>,
        yielding: Option<&Yield>,
    ) -> Result<usize> {
        let _activity = self.admit()?;
        let turn = if expected.is_none() { Some(self.pulls.one_asking(endpoint).await) } else { None };
        let admission = self.pulls.enter(background, catch_up).await?;
        let peer = self.connection(endpoint).await?;
        if expected.is_some_and(|device| device != peer.device) {
            anyhow::bail!("sync peer identity changed before live pull");
        }
        let mut job = self.jobs.begin("pull", peer.device.to_hex(), String::new(), 0, "edits");
        // an asking of some logs among more to come (`ask_differing`) leaves the last bringing up to date to its caller
        let must = !matches!(scope, Scope::Logs(_));
        let device = peer.device;
        let mut named = BTreeSet::new();
        let mut asked = self.pages(peer, scope, &mut job, admission, background, keys.unwrap_or(&mut named), yielding).await;
        if asked.is_ok() {
            if expected.is_some() {
                // a live pull's edits show without the keys they name (one is needed only to seal to its signer), and a
                // key is a megabyte: brought after, not waited for (`bench_live` phone: a chat edit's pull waited 1.7 s
                // on two keys the backlog was bringing too)
                if !named.is_empty() && let Ok(activity) = self.admit() {
                    let shared = self.clone();
                    task::spawn(async move {
                        let _activity = activity;
                        if let Err(error) = shared.bring_keys(endpoint, device, named, background).await {
                            tracing::debug!(%error, "avendb: a live pull's keys come with a later pull");
                        }
                    });
                }
            } else if let Err(error) = self.bring_keys(endpoint, device, named, background).await {
                asked = Err(error);
            }
        }
        // the next asking of this peer names what these pages brought; bringing it up to date needs no turn
        drop(turn);
        // what its pages brought, brought up to date once more, however the asking ended; a live pull's own caller
        // does it, bounded (`live::LIVE_VIEW`), where this would drain every catch-up pending
        if expected.is_none() {
            self.catch_up_paced_class(must, if background { lab_schedule::Class::Background } else { lab_schedule::Class::Foreground }).await;
        }
        if matches!(asked, Ok(0)) {
            job.forget()
        } else {
            job.ended(&asked)
        }
        asked
    }

    /// `asking` of `peer`: page after page, each told to `job`, with how many of the edits it took are each vault's and
    /// each entry's, and the McEliece keys its pages named added to `keys` (`bring_keys`). It ends after a page where
    /// `yielding` says the open views want now a log it asks for that they didn't when it began (`Yield`).
    #[allow(clippy::too_many_arguments)]
    async fn pages(
        self: &Arc<Self>,
        peer: Peer,
        scope: Scope,
        job: &mut Running,
        admission: Arc<pulls::Admission>,
        background: bool,
        keys: &mut BTreeSet<BlobId>,
        yielding: Option<&Yield>,
    ) -> Result<usize> {
        // Only the authority-first background scheduler uses the optional payload pass. A refusal, unsupported
        // signer, large edit, exhausted quota or stale scope always reaches the original legacy reconciliation.
        // Build that legacy request AFTER this attempt so newly accepted IDs suppress duplicate payloads.
        let sparse = if background {
            if let Scope::Logs(logs) = &scope {
                if !logs.is_empty() && logs.iter().all(|log| matches!(log, LogId::Entry(_))) {
                    let (new, attempted) = edit_transfer::receive(self, &peer, logs, admission.clone()).await;
                    if let Err(error) = attempted {
                        tracing::debug!(%error, new, "avendb: optional edit ranges fall back to legacy");
                    }
                    new
                } else {
                    0
                }
            } else {
                0
            }
        } else {
            0
        };
        let device = peer.device;
        let scope_logs = match &scope { Scope::Logs(logs) => Some(logs.clone()), _ => None };
        let kind = match scope {
            Scope::All => session::REQUEST,
            Scope::Logs(_) => session::ASK_LOGS,
            Scope::Vaults(_) => session::ASK_VAULTS,
        };
        // a fresh device asking for its first sync with the boxes held back asks the peer for their stubs first, to
        // count them as held (`session::STUBS`, `LazyBoxes.lean`), and for their bodies in the pull after this one
        let stubbed = self.stubs(&peer, kind, scope.clone()).await;
        // the logs a pull for the bodies of stubs answers for: all, or those it names
        let answers = match &scope {
            Scope::All => Some(None),
            Scope::Logs(logs) => Some(Some(logs.clone())),
            Scope::Vaults(_) => None,
        };
        // the request, worked out once for the whole asking: each page asks the same, after the last place it got, so
        // the peer works out what it sends once too (`Lab::reply`), and no page waits on this device's lab to ask
        let asking = Instant::now();
        // Request construction can outlive a cancelled caller on a blocking worker too.
        let preparing = admission.clone();
        let base = self
            .read_class(if background { lab_schedule::Class::Background } else { lab_schedule::Class::Foreground }, move |lab: &Lab, me| {
                let _preparing = preparing;
                let request = lab.request(me, device);
                match scope {
                    Scope::All => (request, None),
                    Scope::Logs(logs) => (session::only(lab, me, request, &logs), None),
                    Scope::Vaults(vaults) => (session::of_vaults(lab, me, request, &vaults), Some(vaults)),
                }
            })
            .await;
        self.traffic.asked(device, asking.elapsed().as_millis() as u64);
        // what other pulls of the peer, or of another peer for its logs, took while this asking runs, which each page
        // asked after names loose: the peer sends none of it again (`LivePriority.lean` `withTaken`)
        let others_took = self.pulls.taking(device, scope_logs);
        let took_meanwhile = &others_took;
        let wire = move |after: Option<avendb::sync::Place>| {
            let mut request = Request { after, ..base.0.clone() };
            let took = took_meanwhile.ids.lock().expect("taken").clone();
            if !took.is_empty() {
                request.ask.loose.extend(took);
                request.ask.loose.sort();
                request.ask.loose.dedup();
            }
            match &base.1 {
                Some(vaults) => session::vaults_body(vaults, &request),
                None => request.to_wire(),
            }
        };
        // Acquire before serializing, and retain admission through decoding and validation. A page larger
        // than the ordinary budget retries exclusively under the original ceiling (old peers and large edits).
        // A page asked ahead (S6) brings its own slot (`Budget::ahead`): it never retries large, and its failure is
        // no failure of the pull, nor of the peer, as the page is asked again in its turn.
        let ask = |after: Option<avendb::sync::Place>, ahead: Option<pulls::Page>| {
            let (peer, wire) = (peer.clone(), &wire);
            async move {
                let asked = Instant::now();
                let early = ahead.is_some();
                let mut ahead = ahead;
                let receive = async {
                    let mut permit = match ahead.take() {
                        Some(permit) => permit,
                        None => self.pulls.page(false, background).await?,
                    };
                    let reply = {
                        let request = wire(after);
                        anyhow::ensure!(request.len() < session::MESSAGE_LIMIT, "sync request exceeds message limit");
                        self.reply_to(&peer, kind, &request, pulls::PAGE_BYTES).await
                    };
                    let reply = match reply {
                        Err(error) if session::too_long(&error) && !early => {
                            // No encoded request or partial reply remains while exclusive admission waits.
                            drop(permit);
                            permit = self.pulls.page(true, background).await?;
                            let request = wire(after);
                            self.reply_to(&peer, kind, &request, session::REPLY_LIMIT).await
                        }
                        reply => reply,
                    };
                    reply.map(|(reply, bytes)| (reply, bytes, permit))
                };
                let reply = time::timeout(PAGE_WAIT, receive).await.context("no page in time").and_then(|r| r);
                if reply.is_err() && !early {
                    self.traffic.failed(device);
                }
                reply.map(|(reply, bytes, permit)| (reply, bytes, asked.elapsed(), permit))
            }
        };
        // where the peer's next pages end (`session::CUTS`), for the pages after them to be asked at once
        let cut = |after: Option<avendb::sync::Place>, count: usize| {
            let (peer, wire) = (peer.clone(), &wire);
            async move {
                let _activity = self.admit()?;
                let asked = Instant::now();
                let body = session::cuts_body(kind, count, &wire(after));
                anyhow::ensure!(body.len() < session::MESSAGE_LIMIT, "sync request exceeds message limit");
                let answer = session::exchange(&peer.conn, session::CUTS, &body, session::CUTS_REPLY_LIMIT);
                let answer = time::timeout(PAGE_WAIT, answer).await.context("no cuts in time")??;
                let (cuts, done) = session::from_cuts_wire(&answer)?;
                anyhow::ensure!(after.is_none_or(|a| cuts.first().is_none_or(|c| *c > a)), "cuts before their start");
                Ok::<_, anyhow::Error>((cuts, done, asked.elapsed()))
            }
        };
        let connection = peer.conn.stable_id();
        let most = if self.uncut.lock().expect("uncut").contains(&connection) {
            1
        } else {
            self.opts.window.clamp(1, session::CUTS_LIMIT)
        };
        // The pages in flight, each asked after the place its predecessor ends at by the peer's cuts, and taken
        // strictly in order: one is taken only if it was asked after the last place the page before it brought, so
        // the pages taken are exactly those asked one after the other, each sorting after the last (`replay_on`);
        // one asked after any other place is dropped unread, and what follows asked again from where the last ended.
        let mut window = pulls::Window::new(most);
        let mut cutting = most > 1;
        let fly = |seq: u64, flying: usize, after: Option<avendb::sync::Place>, ahead: Option<pulls::Page>| {
            let page = ask(after, ahead);
            async move { (seq, flying, page.await) }
        };
        let cut_fly = |generation: u64, after: Option<avendb::sync::Place>, count: usize| {
            let cuts = cut(after, count);
            async move { (generation, cuts.await) }
        };
        let mut flying = FuturesUnordered::new();
        let mut cutting_flight = FuturesUnordered::new();
        // the pages asked, in order: each its number, where it starts, and whether it was asked ahead
        let mut asked: std::collections::VecDeque<(u64, Option<avendb::sync::Place>, bool)> = Default::default();
        let mut landed = BTreeMap::new();
        // where pages yet to be asked ahead start, where the next cuts start, and whether the peer named its last
        let mut cuts: std::collections::VecDeque<avendb::sync::Place> = Default::default();
        let (mut cut_after, mut cuts_end, mut cut_busy, mut generation, mut misses) = (None, false, false, 0u64, 0u32);
        // the page asked last starts after this place
        let (mut seq, mut asked_upto) = (0u64, None::<avendb::sync::Place>);
        macro_rules! pump {
            () => {
                let size = window.size();
                while cutting && asked.len() < size && !cuts.is_empty() {
                    let Some(permit) = self.pulls.ahead() else { break };
                    let after = cuts.pop_front();
                    seq += 1;
                    asked_upto = after.max(asked_upto);
                    asked.push_back((seq, after, true));
                    flying.push(fly(seq, asked.len(), after, Some(permit)));
                }
                if cutting && !cut_busy && !cuts_end && cuts.len() < size {
                    cut_busy = true;
                    cutting_flight.push(cut_fly(generation, cut_after, 2 * most));
                }
            };
        }
        macro_rules! land {
            ($got:expr) => {
                match $got {
                    Landing::Page((at, count, page)) => {
                        if asked.iter().any(|(s, _, _)| *s == at) {
                            if let Ok((_, _, wait, _)) = &page {
                                window.page(*wait, count);
                            }
                            landed.insert(at, page);
                        }
                    }
                    Landing::Cuts((at, got)) if at == generation => {
                        cut_busy = false;
                        match got {
                            Ok((mut got, done, wait)) => {
                                window.latency(wait);
                                if let Some(&last) = got.last() {
                                    cut_after = Some(last);
                                }
                                // the last page ends where the last cut is: nothing is asked after it
                                if done || got.is_empty() {
                                    cuts_end = true;
                                    if done {
                                        got.pop();
                                    }
                                }
                                // a page already asked after one of them is not asked again
                                got.retain(|c| asked_upto.is_none_or(|upto| *c > upto));
                                cuts.extend(got);
                            }
                            Err(error) => {
                                tracing::debug!(%error, "avendb: no page cuts; asking page after page");
                                cutting = false;
                                self.uncut.lock().expect("uncut").insert(connection);
                            }
                        }
                    }
                    _ => {}
                }
            };
        }
        let (mut after, mut new, mut pages) = (None, sparse, 0);
        let (mut vaults, mut entries) = (BTreeMap::<String, u64>::new(), BTreeMap::<String, u64>::new());
        // Include initial admission, request encoding and reply wait in pipeline service time.
        // Starting after this await makes a slow one-page request appear arbitrarily fast.
        let mut since = Instant::now();
        seq += 1;
        asked.push_back((seq, None, false));
        flying.push(fly(seq, 1, None, None));
        pump!();
        loop {
            let &(at, starts, early) = asked.front().expect("the next page is asked");
            debug_assert_eq!(starts, after);
            let coming = loop {
                if let Some(page) = landed.remove(&at) {
                    break page;
                }
                let got: Landing<_, _, ()> = landing(&mut flying, &mut cutting_flight).await;
                land!(got);
                pump!();
            };
            asked.pop_front();
            let coming = match coming {
                Err(error) if early => {
                    // asked ahead and lost: asked again now, in its turn, as any page is
                    tracing::debug!(%error, "avendb: a page asked ahead failed; asking it again");
                    seq += 1;
                    asked.push_front((seq, after, false));
                    flying.push(fly(seq, asked.len(), after, None));
                    continue;
                }
                coming => coming,
            };
            let (Reply { mut edits, blobs, more }, bytes, wait, permit) = coming?;
            let (way, sent) = (way_of(&peer.conn), edits.len() as u64);
            let taking = Instant::now();
            self.sized(&mut edits);
            self.sent.requests.fetch_add(1, Ordering::Relaxed);
            // where the next page starts: a page that brings nothing past the last ends the asking
            let last = edits.iter().map(|s| place(&s.edit)).max().filter(|&l| after.is_none_or(|a| l > a));
            let next = match last {
                Some(last) if more => Some(last),
                _ => None,
            };
            // the next page asked after where this one ends, and what follows it ahead, while this one is taken (checked
            // and kept), so the peer, the network and this device work at once rather than in turn
            match (next, asked.front().map(|&(_, starts, _)| starts)) {
                (Some(next), Some(starts)) if starts == Some(next) => {}
                (Some(next), ahead) => {
                    if ahead.is_some() {
                        // the peer's pages ended elsewhere than it said: what was asked ahead goes unread
                        misses += 1;
                        cutting &= misses < MISSES;
                        (flying, landed, cutting_flight) = (FuturesUnordered::new(), BTreeMap::new(), FuturesUnordered::new());
                        asked.clear();
                        cuts.clear();
                        (cut_after, cuts_end, cut_busy, generation) = (Some(next), false, false, generation + 1);
                    }
                    // a cut it reached is no page to ask ahead
                    while cuts.front().is_some_and(|c| *c <= next) {
                        cuts.pop_front();
                    }
                    seq += 1;
                    asked_upto = Some(next).max(asked_upto);
                    asked.push_back((seq, Some(next), false));
                    flying.push(fly(seq, 1, Some(next), None));
                }
                (None, _) => {
                    // the last page: nothing asked ahead of it is wanted
                    (flying, landed, cutting_flight) = (FuturesUnordered::new(), BTreeMap::new(), FuturesUnordered::new());
                    asked.clear();
                    cutting = false;
                }
            }
            pump!();
            // the McEliece keys its edits name come after the last page, not with each: a device needs one only to seal
            // to its signer, each is a megabyte, and a page of a few edits waited ~10 s on them through a relay
            // (2026-10-22, an iPhone's first sync), while what its edits say could be used already
            keys.extend(blobs);
            let logged: Vec<(EditId, Option<LogId>)> = edits.iter().map(|s| (s.edit.id(), log_of(&s.edit, s.edit.id()))).collect();
            let ids: Vec<EditId> = logged.iter().map(|(id, _)| *id).collect();
            let take = async {
                // Native cryptography runs outside the Lab mutex. The owned page/admission survives
                // cancellation until its blocking checker exits; current-state admission still runs below.
                #[cfg(not(target_arch = "wasm32"))]
                let (prepared, permit, activity, ()) = self.prepare_received_page(edits, permit, (),
                    #[cfg(test)] None,
                ).await?;
                #[cfg(target_arch = "wasm32")]
                let (prepared, permit, activity, ()) = self.prepare_received_page(edits, permit, ()).await?;
                let checked = taking.elapsed();
                let (got, whose, held) = self
                    .try_lab_class(if background { lab_schedule::Class::Background } else { lab_schedule::Class::Foreground }, move |lab, me| {
                        let (_permit, _activity) = (permit, activity);
                        let (got, whose) = lab.receive_prepared(me, prepared, false);
                        (got, whose, lab.holding(me, ids))
                    })
                    .await?;
                let held: BTreeSet<EditId> = held.into_iter().collect();
                let held: Vec<_> = logged.into_iter().filter(|(id, _)| held.contains(id)).collect();
                self.pulls.took(device, &others_took, &held);
                let kept = taking.elapsed();
                // its keys and items brought up to date now and then, not at each page (`CATCH_UP_PACE`)
                if next.is_some() {
                    self.catch_up_paced_class(false, if background { lab_schedule::Class::Background } else { lab_schedule::Class::Foreground }).await;
                }
                let took = taking.elapsed();
                Ok::<_, anyhow::Error>((got, whose, [checked, kept - checked, took - kept, took]))
            };
            // the pages in flight land (and more are asked) while this one is taken
            let mut take = std::pin::pin!(take);
            let taken = loop {
                let first = future::or(async { Landing::Done(take.as_mut().await) }, landing(&mut flying, &mut cutting_flight));
                match first.await {
                    Landing::Done(taken) => break taken,
                    got => {
                        land!(got);
                        pump!();
                    }
                }
            };
            let (got, whose, [checked, kept, caught, took]) = taken?;
            let finished = Instant::now();
            // a claim holds on while its pages land (`Claims::landed`)
            self.claims.lock().expect("claims").landed(peer.endpoint, finished);
            self.traffic.page(traffic::Page {
                device,
                at: jobs::now_ms(),
                bytes,
                edits: sent,
                new: got as u64,
                wait_ms: wait.as_millis() as u64,
                take_ms: took.as_millis() as u64,
                check_ms: checked.as_millis() as u64,
                lab_ms: kept.as_millis() as u64,
                catch_ms: caught.as_millis() as u64,
                ms: finished.duration_since(since).as_millis() as u64,
                way,
            });
            self.jobs.stir();
            since = finished;
            new += got;
            pages += 1;
            for (v, e) in whose {
                *vaults.entry(v.to_hex()).or_default() += 1;
                if let Some(e) = e {
                    *entries.entry(e.to_hex()).or_default() += 1;
                }
            }
            job.stage(format!("page {pages}"));
            job.progress(new as u64, None);
            job.about(vaults.clone(), entries.clone());
            // the open views want a log of its own now that they didn't when it began: it ends here, with all it took,
            // for them to be asked for at once, and the rest again after them (`Yield`); nothing more of it is taken,
            // so none of a stub's bodies counts as not sent
            if next.is_some() && yielding.is_some_and(|y| y.due(self)) {
                return Ok(new);
            }
            match next {
                Some(last) => after = Some(last),
                None => break,
            }
        }
        if stubbed && (kind == session::REQUEST || new == 0) {
            // the first view is in, of all the peer may send or of logs that differ by their boxes alone: the bodies of
            // the boxes held back come in the next pull, each checked against its stub as it comes (S5)
            self.try_lab(|lab, me| lab.fetch_withheld(me)).await?;
            self.ask_soon(peer.endpoint);
        } else if let Some(logs) = answers {
            // asked for their bodies, what didn't come of the stubs this peer sent is of nothing it sends; and a first
            // sync a peer from before box stubs sent whole leaves the device holding edits, which ends its stubs
            self.try_lab(move |lab, me| {
                lab.drop_unanswered(me, device, logs.as_ref());
                if new > 0 && lab.lazy_boxes(me) && lab.stubs(me).is_empty() {
                    lab.set_lazy_boxes(me, false);
                }
            })
            .await?;
        }
        Ok(new)
    }

    /// Asks `peer` for the stubs of the boxes this device needs not now of what a pull of `kind` for `scope` brings, if
    /// it asks for its first syncs so (`Lab::lazy_boxes`), and takes them (`Lab::receive_stubs`). True if the peer
    /// answered. A peer that refuses or fails to answer sends everything, as before.
    async fn stubs(self: &Arc<Self>, peer: &Peer, kind: u8, scope: Scope) -> bool {
        let device = peer.device;
        let body = self
            .read(move |lab: &Lab, me| {
                lab.lazy_boxes(me).then(|| {
                    let request = lab.request(me, device);
                    match &scope {
                        Scope::All => request.to_wire(),
                        Scope::Logs(logs) => session::only(lab, me, request, logs).to_wire(),
                        Scope::Vaults(vaults) => session::vaults_body(vaults, &request),
                    }
                })
            })
            .await;
        let Some(body) = body else { return false };
        let connection = peer.conn.stable_id();
        if self.unstubbed.lock().expect("unstubbed").contains(&connection) {
            return false;
        }
        let mut asked = vec![kind];
        asked.extend(body);
        let answer = async {
            let _activity = self.admit()?;
            anyhow::ensure!(asked.len() < session::MESSAGE_LIMIT, "sync request exceeds message limit");
            let bytes = session::exchange(&peer.conn, session::STUBS, &asked, session::STUBS_REPLY_LIMIT);
            let bytes = time::timeout(PAGE_WAIT, bytes).await.context("no stubs in time")??;
            Ok::<_, anyhow::Error>(avendb::wire::Stubs::from_wire(&bytes)?)
        };
        match answer.await {
            Ok(stubs) => self.try_lab(move |lab, me| lab.receive_stubs(me, device, stubs.0)).await.is_ok(),
            Err(error) => {
                tracing::debug!(%error, "avendb: no stubs, the first sync takes every box");
                self.unstubbed.lock().expect("unstubbed").insert(connection);
                false
            }
        }
    }

    /// The McEliece keys a pull's pages named that this device lacks, from `device` at `endpoint` in one request, once
    /// every page of the asking is taken: an asking of many logs (`ask_differing`) brings them after its last log, so
    /// no log waits on another's keys (a new human's six keys, ~6 MB, held the next log ~40 s on a lossy link).
    async fn bring_keys(self: &Arc<Self>, endpoint: EndpointId, device: SignerId, keys: BTreeSet<BlobId>, background: bool) -> Result<()> {
        if keys.is_empty() {
            return Ok(());
        }
        let fetching = Instant::now();
        let lacking =
            move |lab: &Lab, me| -> Vec<BlobId> { keys.into_iter().filter(|b| lab.blob(me, *b).is_none()).collect() };
        let lacking = self.read(lacking).await;
        if lacking.is_empty() {
            return Ok(());
        }
        // a key another pull brings now is waited for, not brought twice, and what is still lacking then brought
        let _turns = self.pulls.fetching(&lacking).await;
        let lacking = self.read(move |lab: &Lab, me| -> Vec<BlobId> { lacking.into_iter().filter(|b| lab.blob(me, *b).is_none()).collect() }).await;
        if !lacking.is_empty() {
            let asked = lacking.len() as u64;
            let got = self.fetch(endpoint, lacking).await;
            let bytes = got.iter().map(|k| k.len() as u64).sum();
            self.traffic.keys(device, asked, got.len() as u64, bytes, fetching.elapsed().as_millis() as u64);
            if !got.is_empty() {
                self.try_lab_class(if background { lab_schedule::Class::Background } else { lab_schedule::Class::Foreground }, move |lab, me| lab.receive(me, Vec::new(), got)).await?;
                self.changed.notify_one();
            }
        }
        Ok(())
    }

    /// Pure signature checks own their page, lifecycle ticket and caller context but never the Lab
    /// mutex. Moving the context through both workers preserves range admission and accepted-count
    /// ownership even if an asynchronous waiter is cancelled during capture or checking.
    #[cfg(not(target_arch = "wasm32"))]
    async fn prepare_received_page<O: Send + 'static>(
        self: &Arc<Self>,
        edits: Vec<Signed>,
        permit: pulls::Page,
        owner: O,
        #[cfg(test)] before_check: Option<Box<dyn FnOnce() + Send>>,
    ) -> Result<(avendb::lab::PreparedReceive, pulls::Page, lifecycle::Ticket, O)> {
        let activity = self.admit()?;
        let checking = self.receive_checking.clone().lock_owned().await;
        let (preparation, permit, activity, checking, owner) = self.read(move |lab, me| {
            (lab.prepare_receive(me, edits), permit, activity, checking, owner)
        }).await;
        tokio::task::spawn_blocking(move || {
            let _checking = checking;
            #[cfg(test)]
            if let Some(before) = before_check { before(); }
            (preparation.check(), permit, activity, owner)
        }).await.context("checking incoming signatures")
    }

    /// The browser has one worker thread: let its event loop service generic operations between
    /// bounded signature groups. n0_future's zero-duration sleep uses setTimeout, not a microtask.
    #[cfg(target_arch = "wasm32")]
    async fn prepare_received_page<O: Send + 'static>(
        self: &Arc<Self>,
        edits: Vec<Signed>,
        permit: pulls::Page,
        owner: O,
    ) -> Result<(avendb::lab::PreparedReceive, pulls::Page, lifecycle::Ticket, O)> {
        let activity = self.admit()?;
        let _checking = self.receive_checking.clone().lock_owned().await;
        let preparation = self.read(move |lab, me| lab.prepare_receive(me, edits)).await;
        let prepared = preparation.check_cooperatively(|| time::sleep(Duration::ZERO)).await;
        Ok((prepared, permit, activity, owner))
    }

    /// Prefer supplemental batch proofs where this device can persist their admissions. The enclosed
    /// signed edits still take the ordinary verification path. Unsupported or invalid supplements fall
    /// back to packed, then original replies, with each capability remembered separately per connection.
    /// The byte limit and page admission remain the caller's, including typed oversized-response retries.
    async fn reply_to(self: &Arc<Self>, peer: &Peer, kind: u8, request: &[u8], limit: usize) -> Result<(Reply, u64)> {
        let _activity = self.admit()?;
        let id = peer.conn.stable_id();
        if let Some(signers) = &self.signers {
            // segments first, where this node keeps them: each writer it holds a root of whose edits its request names
            // to the peer already (`Lab::writers_shown`), and how many of its ids; never the writers of its other logs
            if self.opts.segments && !self.unsegmented.lock().expect("unsegmented").contains(&id) {
                let device = peer.device;
                let shown = self.read(move |lab: &Lab, me| lab.writers_shown(me, device)).await;
                let held = signers.held_among(&shown, proofs::MAX_KNOWN_SEGMENTS).await;
                let known = held.iter().map(|(s, (n, _))| (*s, *n)).collect();
                let held = Some(held.iter().filter(|(_, (_, ids))| *ids > 0).map(|(s, (_, ids))| (*s, *ids)).collect());
                let paths = self.opts.paths;
                let batch = proofs::Request { kind, request: request.to_vec(), known, paths, held }.encode()?;
                if batch.len() < session::MESSAGE_LIMIT {
                    match session::exchange(&peer.conn, proofs::KIND, &batch, limit).await {
                        Ok(bytes) => {
                            let size = bytes.len() as u64;
                            if let Ok(supplement) = proofs::Supplement::decode(&bytes) {
                                drop(bytes);
                                if let Ok(reply) = supplement.verify(signers).await {
                                    return Ok((reply, size));
                                }
                            }
                        }
                        Err(error) if session::too_long(&error) => return Err(error),
                        Err(_) => {}
                    }
                    self.unsegmented.lock().expect("unsegmented").insert(id);
                }
            }
            let batches = !self.unbatched.lock().expect("unbatched").contains(&id);
            // Only the authenticated peer's own ledger is exported by this first batch slice.
            // Do not disclose the other signers whose roots this device has observed.
            if batches {
                let known: BTreeMap<_, _> =
                    signers.known(peer.device).await.map(|n| (peer.device, n)).into_iter().collect();
                // version 2 first where this node reads paths, version 1 where its peer doesn't know version 2 (P8)
                let unstripped = self.unstripped.lock().expect("unstripped").contains(&id);
                let versions: &[bool] = if self.opts.paths && !unstripped { &[true, false] } else { &[false] };
                let mut asked = false;
                for &paths in versions {
                    let batch =
                        proofs::Request { kind, request: request.to_vec(), known: known.clone(), paths, held: None }
                            .encode()?;
                    // Near-limit legacy requests still fit their original framing, with no capability downgrade.
                    if batch.len() >= session::MESSAGE_LIMIT {
                        break;
                    }
                    asked = true;
                    let result = session::exchange(&peer.conn, proofs::KIND, &batch, limit).await;
                    drop(batch);
                    match result {
                        Ok(bytes) => {
                            let size = bytes.len() as u64;
                            let supplement = proofs::Supplement::decode(&bytes);
                            drop(bytes);
                            if let Ok(supplement) = supplement {
                                if let Ok(reply) = supplement.verify(signers).await {
                                    return Ok((reply, size));
                                }
                            }
                        }
                        // Keep the existing ordinary/exclusive page admission boundary even with proofs.
                        Err(error) if session::too_long(&error) => return Err(error),
                        Err(_) => {}
                    }
                    if paths {
                        self.unstripped.lock().expect("unstripped").insert(id);
                    }
                }
                if asked {
                    self.unbatched.lock().expect("unbatched").insert(id);
                }
            }
        }
        let packs = !self.unpacked.lock().expect("unpacked").contains(&id);
        if packs {
            match session::exchange(&peer.conn, kind | session::PACKED, request, limit).await {
                Ok(bytes) => {
                    if let Ok(Packed(reply)) = Packed::from_wire(&bytes) {
                        return Ok((reply, bytes.len() as u64));
                    }
                }
                // A size limit is not evidence that this peer lacks packed replies. Let page admission retry
                // exclusively; falling back here would send a second large response without that admission.
                Err(error) if session::too_long(&error) => return Err(error),
                Err(_) => {}
            }
        }
        let bytes = session::exchange(&peer.conn, kind, request, limit).await?;
        let reply = Reply::from_wire(&bytes)?;
        if packs {
            self.unpacked.lock().expect("unpacked").insert(id);
        }
        Ok((reply, bytes.len() as u64))
    }

    /// Asks `endpoint` for its contact card, and takes its vault logs. How many edits were new.
    async fn contact(self: &Arc<Self>, endpoint: EndpointId) -> Result<usize> {
        let _activity = self.admit()?;
        let peer = self.connection(endpoint).await?;
        let reply = session::exchange(&peer.conn, session::CARD, &[], session::REPLY_LIMIT).await?;
        let Reply { mut edits, .. } = Reply::from_wire(&reply)?;
        // a card carries vault logs, and nothing else
        edits.retain(of_a_vault);
        self.sized(&mut edits);
        let new = self.try_lab(move |lab, me| lab.receive(me, edits, Vec::new())).await?;
        if new > 0 {
            self.changed.notify_one();
        }
        Ok(new)
    }

    /// Asks `endpoint` soon for the logs where the device there holds what this one lacks, by what it told (`differ`):
    /// the node loop starts the asking, or asks once more after the one under way, or once its wait is over if
    /// asking it failed (`node_loop::Lane`).
    fn ask_soon(self: &Arc<Self>, endpoint: EndpointId) {
        if self.opts.lazy || self.admit().is_err() {
            return;
        }
        self.outreach.send(node_loop::Msg::Ask { endpoint });
    }

    /// Finish authenticated suffixes without making foreground requests pump history.
    /// Each turn uses the same fair scheduler as other background work; browser
    /// admission supplies a real worker event-loop boundary before taking the Lab.
    async fn bootstrap_pump(self: Arc<Self>) {
        // Check once at startup for durable partial progress restored before spawn.
        loop {
            let turn = self.try_lab_class(lab_schedule::Class::Background, |lab, me| {
                if !lab.owner_bases_pending(me) { return (false, false); }
                let pending = lab.advance_owner_bases(me);
                (true, pending)
            }).await;
            let Ok((ran, pending)) = turn else { break; };
            if ran {
                // Materialization advances without changing signed-log cardinality.
                self.size.send_modify(|_| {});
                self.changed.notify_one();
                self.edits.iter().for_each(|edits| edits.due.notify_one());
            }
            if pending {
                tokio::task::yield_now().await;
            } else {
                let missing=self.fetch_owner_dependencies().await;
                let key_wait=self.prioritize_owner_keys().await;
                let lane_wait=self.prioritize_owner_lanes().await;
                if missing || key_wait || lane_wait {
                    // Network failure is an explicit wait, not a tight reconstruction loop.
                    tokio::select! {
                        _=self.bootstrap_due.notified()=>{},
                        _=time::sleep(self.opts.retry.max(Duration::from_millis(250)))=>{},
                    }
                } else { self.bootstrap_due.notified().await; }
            }
        }
    }

    /// Tells the peers what changed of its holdings whenever they may have, through the node loop, which tries again
    /// the peers it couldn't tell or failed to ask once their wait is over. It looks again every `retry` for the range
    /// candidates and transfers to expire.
    async fn announcer(self: Arc<Self>) {
        let mut news = News {
            size: (usize::MAX, 0),
            revision: None,
            reach: Arc::default(),
            roots: Vec::new(),
            claimable: false,
            invites: Vec::new(),
        };
        loop {
            let Ok(activity) = self.admit() else { break };
            // Reap idle range candidates even when their connections stay open without sending another message.
            self.ranges.lock().expect("ranges").expire();
            self.edit_transfer.expire();
            if let Some(fresh) = self.news(news.size, news.revision.clone()).await {
                news = fresh;
            }
            self.own_logs().await;
            self.announce(&news);
            self.state(&news.reach);
            drop(activity);
            time::timeout(self.opts.retry, self.changed.notified()).await.ok();
        }
    }

    /// Of `edits` from a peer, those no larger than the most it takes (`Node::limit`).
    fn sized(&self, edits: &mut Vec<Signed>) {
        let most = self.keeping.lock().expect("keeping").limits.edit;
        limits::sized(edits, most);
    }

    /// Whom to tell what, worked out again if the device's edits changed since `size`; then whom the relay lets in, if
    /// the node keeps that. `None` if nothing changed.
    async fn news(
        self: &Arc<Self>,
        size: (usize, usize),
        revision: Option<avendb::policy::LogRevision>,
    ) -> Option<News> {
        let _activity = self.admit().ok()?;
        let (server, shared) = (self.opts.card, self.clone());
        let news = self
            .try_lab(move |lab, me| {
                let now = lab.size(me);
                let current = lab.log(me).revision();
                if now == size && revision.as_ref() == Some(&current) {
                    return None;
                }
                let all = shared.logs_of(lab, me);
                let mut reach = BTreeMap::new();
                for (device, key) in lab.peers(me) {
                    let Ok(endpoint) = EndpointId::from_bytes(&key) else { continue };
                    let logs: BTreeSet<LogId> = lab.announce(me, device).into_iter().map(|(l, _)| l).collect();
                    let files = logs.iter().filter_map(|l| all.of.get(l)).flat_map(|log| log.files.iter().copied());
                    reach.insert(device, Reach { endpoint, files: files.collect(), logs });
                }
                let claimable = server && lab.vault_of(me).is_none();
                let invites = if server { open_invites(lab, me) } else { Vec::new() };
                // worked out mid catch-up by a replay behind its log, whom to tell what is worked out again once it
                // caught up, its log the same (`Lab::answers_current`): kept, a peer was never told of what the
                // catch-up brought
                let current = lab.answers_current(me).then_some(current);
                Some(News {
                    size: now,
                    revision: current,
                    reach: Arc::new(reach),
                    roots: lab.roots(me),
                    claimable,
                    invites,
                })
            })
            .await
            .ok()??;
        *self.reach.lock().expect("reach") = news.reach.clone();
        self.fresh.moved();
        if let Some(admission) = &self.opts.admission {
            let endpoints = news.reach.values().map(|r| r.endpoint).chain([self.endpoint.id()]).collect();
            let (passkeys, invites) = (news.roots.iter().copied().collect(), news.invites.iter().copied().collect());
            admission.set(Admitted { endpoints, passkeys, claimable: news.claimable, invites });
        }
        Some(news)
    }

    /// Its device's edits by their logs (`holdings::Logs`), `lab` being the node's Lab: worked out again only once
    /// they changed.
    fn logs_of(&self, lab: &Lab, me: SignerId) -> Arc<Logs> {
        let size = lab.size(me);
        let mut logs = self.logs.lock().expect("logs");
        if let Some(known) = logs.as_mut() {
            if !known.current(lab.log(me), size) {
                Arc::make_mut(known).update(lab.log(me), size);
            }
            known.clone()
        } else {
            let log = lab.log(me);
            let mut fresh = Logs::of(&[], &[], (0, 0));
            fresh.update(log, size);
            let fresh = Arc::new(fresh);
            *logs = Some(fresh.clone());
            fresh
        }
    }

    /// Works out again what its device holds for good of each log, if its edits or what its shelf holds of them
    /// changed: the frontier of the edits its shelf holds, the first of its log (`edits::Edits::held`), or with no
    /// shelf, of all it holds.
    async fn own_logs(self: &Arc<Self>) {
        let shared = self.clone();
        let worked = self
            .read(move |lab, me| {
                let size = lab.size(me);
                let held = shared.edits.as_ref().map_or(size.0, |edits| edits.held(lab, me));
                let revision = lab.log(me).revision();
                {
                    let own = shared.own.lock().expect("own");
                    if own.at == (size, held) && own.revision.as_ref() == Some(&revision) {
                        return None;
                    }
                }
                let logs = match held >= size.0 {
                    true => shared.logs_of(lab, me).frontiers(),
                    false => {
                        let mut index = shared.held_logs.lock().expect("held logs");
                        let index = index.get_or_insert_with(|| Logs::of(&[], &[], (0, 0)));
                        index.update_held(lab.log(me), held, size);
                        index.frontiers()
                    }
                };
                Some(((size, held), revision, logs))
            })
            .await;
        if let Some((at, revision, logs)) = worked {
            let mut own = self.own.lock().expect("own");
            (own.at, own.revision, own.holdings.logs) = (at, Some(revision), logs);
        }
    }

    /// Has the node loop tell each peer what of the node's holdings it may know by the node's view, if that changed
    /// since it was last told, or it is on a new connection: each on a task of its own, so that a peer out of reach
    /// holds up nobody; one at a time; and a peer it couldn't reach, only once its wait is over (`node_loop`).
    fn announce(self: &Arc<Self>, news: &News) {
        let own = self.own.lock().expect("own").holdings.clone();
        let told = self.told.lock().expect("told").clone();
        for (device, reach) in news.reach.iter() {
            let want = own.only(&reach.logs, &reach.files);
            let live = self.live(reach.endpoint).map(|p| p.conn.stable_id());
            let due = told.get(device).is_none_or(|(on, was)| *was != want || live.is_some_and(|id| id != *on));
            if due {
                self.outreach.send(node_loop::Msg::Tell { device: *device, endpoint: reach.endpoint });
            }
        }
    }

    /// What of the node's holdings `device` may know by the node's view now, if it may know any (`announce`).
    fn want_of(&self, device: SignerId) -> Option<Holdings> {
        let reach = self.reach.lock().expect("reach").get(&device).map(|r| (r.logs.clone(), r.files.clone()))?;
        Some(self.own.lock().expect("own").holdings.only(&reach.0, &reach.1))
    }

    /// Tells `device`, at `endpoint`, that it holds `want`: all of it on a connection it told nothing yet, else what
    /// changed since it last told it, if anything did.
    async fn tell(self: &Arc<Self>, device: SignerId, endpoint: EndpointId, want: Holdings) -> Result<()> {
        let _activity = self.admit()?;
        let peer = self.connection(endpoint).await?;
        let on = peer.conn.stable_id();
        let (told, before) = {
            let told = self.told.lock().expect("told");
            let told = told.get(&device);
            (told.filter(|(at, _)| *at == on).map(|(_, h)| h.clone()), told.filter(|(at, _)| *at != on).map(|(_, h)| h.clone()))
        };
        // A new connection owes the device all it holds again, which can take range rounds (four round trips on a
        // phone's link, behind a crossed dial at start); a small change since what it was told on the connection
        // before goes first, as any live change does, so a live edit is not held behind the replacement
        // (`LivePriority.lean` `changeFirst`).
        if told.is_none()
            && let Some(mut change) = want.since(before.as_ref()).filter(|a| !a.full && a.logs.len() <= pulls::LIVE_LOGS)
        {
            self.live_witnesses(&mut change, &want).await;
            let heads = change.logs.iter().flat_map(|(_, f)| f.heads.iter().copied());
            self.traffic.trace(traffic::Stage::Told, device, heads.collect::<Vec<_>>(), false);
            session::exchange(&peer.conn, session::ANNOUNCE, &change.to_wire(), 0).await?;
            self.sent.announcements.fetch_add(1, Ordering::Relaxed);
        }
        if let Some(mut announce) = want.since(told.as_ref()) {
            self.live_witnesses(&mut announce, &want).await;
            // T1: a small change's heads, each the trace id of a live edit on its way to `device`
            if !announce.full && announce.logs.len() <= pulls::LIVE_LOGS {
                let heads = announce.logs.iter().flat_map(|(_, f)| f.heads.iter().copied());
                self.traffic.trace(traffic::Stage::Told, device, heads.collect::<Vec<_>>(), false);
            }
            // Small live changes already have the cheapest encoding. A complete replacement (including reconnect
            // and permission contraction) first reconciles cached subtrees with capable peers. Refusal preserves
            // the original full announcement, and a legacy peer is probed only once on this connection.
            let ranges = announce.full && {
                let cached = self.ranges.lock().expect("ranges");
                cached.has_offered(device) && !cached.unsupported(on)
            };
            let sparse = if ranges { session::tell_ranges(self, &peer, device, &want).await.is_ok() } else { false };
            if !sparse {
                if ranges {
                    self.ranges.lock().expect("ranges").fallback(on, device);
                }
                session::exchange(&peer.conn, session::ANNOUNCE, &announce.to_wire(), 0).await?;
                if announce.full && !self.ranges.lock().expect("ranges").unsupported(on) {
                    // First contact is still one message, not a walk through a tree the peer has never seen. Seed
                    // the cache only after it accepted that full claim; a later full replacement can reuse it.
                    self.ranges.lock().expect("ranges").offered(device, &want).ok();
                }
            }
            self.sent.announcements.fetch_add(1, Ordering::Relaxed);
        }
        self.told.lock().expect("told").insert(device, (on, want));
        Ok(())
    }

    /// The device of `peer`'s connection asked `request` on it: it follows the vaults the request names, until it asks
    /// again or the connection closes.
    fn follows(&self, peer: &Peer, request: &Request) {
        self.follows.lock().expect("follows").insert(peer.conn.stable_id(), request.ask.follow.clone());
    }

    /// `device` told the node `announce` of its holdings, on a connection whose hello proved it: what it holds from
    /// now on, as `Holdings::take` says. A device that claims to hold more than `MOST` logs or files claims nothing.
    fn hear(self: &Arc<Self>, device: SignerId, announce: Announce) {
        let full = announce.full;
        let mut held = self.held.lock().expect("held");
        self.fresh.moved();
        let holdings = held.entry(device).or_default();
        let live_logs = live::announced_hints(holdings, &announce);
        if !live_logs.is_empty() {
            self.pulls.note_witnesses(device, live::unchanged(holdings, &announce, &live_logs));
            let heads = announce.logs.iter().filter(|(l, _)| live_logs.contains(l)).flat_map(|(_, f)| f.heads.iter().copied());
            self.traffic.trace(traffic::Stage::Heard, device, heads.collect::<Vec<_>>(), false);
        }
        // Always take the holdings lock before the range cache: complete range rounds use the same order, so a
        // legacy update cannot race between checking a root and publishing its replacement.
        let mut ranges = self.ranges.lock().expect("ranges");
        ranges.observe(device, &announce);
        holdings.take(announce);
        if holdings.logs.len() > MOST || holdings.files.len() > MOST {
            held.remove(&device);
            ranges.forget(device);
        }
        let admitted = held.contains_key(&device);
        drop(ranges);
        drop(held);
        if admitted { self.live_announced(device, full, &live_logs); }
        self.jobs.stir();
    }

    /// The connection of `peer` closed: what its device told the node it holds is kept, unless the node's device
    /// doesn't know that device (`Lab::peers`) and it isn't connected any more. What it follows goes.
    fn gone(self: &Arc<Self>, peer: &Peer) {
        self.edit_transfer.gone(peer.conn.stable_id());
        transports::control::gone(self, peer);
        self.follows.lock().expect("follows").remove(&peer.conn.stable_id());
        self.unpacked.lock().expect("unpacked").remove(&peer.conn.stable_id());
        self.unbatched.lock().expect("unbatched").remove(&peer.conn.stable_id());
        self.uncut.lock().expect("uncut").remove(&peer.conn.stable_id());
        self.unstubbed.lock().expect("unstubbed").remove(&peer.conn.stable_id());
        self.unstripped.lock().expect("unstripped").remove(&peer.conn.stable_id());
        let known = self.reach.lock().expect("reach").contains_key(&peer.device);
        let forget = !known && self.live(peer.endpoint).is_none();
        let mut held = self.held.lock().expect("held");
        self.fresh.moved();
        if forget {
            held.remove(&peer.device);
        }
        self.ranges.lock().expect("ranges").gone(peer.conn.stable_id(), peer.device, forget);
        drop(held);
        self.jobs.stir();
    }

    /// The logs where `device` holds an edit this node's device lacks, by what it told (`Logs::lacks`). Of the logs the
    /// node holds, only those the device may hold by the node's view (`Reach`, worked out again where it may have grown
    /// since), as `synced_to` reads them: a claim to any other steers nothing, and learns nothing of what the node
    /// holds of it. A log the node holds nothing of, which its view can't place, it asks for naming nothing of it
    /// (`session::only`), as its request on a new connection does: else it would never learn of a new entry. A device
    async fn differ(self: &Arc<Self>, device: SignerId) -> BTreeSet<LogId> {
        let Some(theirs) = self.held.lock().expect("held").get(&device).map(|h| h.logs.clone()) else {
            return BTreeSet::new();
        };
        let (shared, known) = (self.clone(), self.reach.lock().expect("reach").clone());
        self.try_lab(move |lab, me| {
            let mine = shared.logs_of(lab, me);
            let mut now: Option<BTreeSet<LogId>> = None;
            let mut within = |l: &LogId| {
                let reach = |lab: &mut Lab| lab.announce(me, device).into_iter().map(|(l, _)| l).collect();
                known.get(&device).is_some_and(|r| r.logs.contains(l))
                    || now.get_or_insert_with(|| reach(lab)).contains(l)
            };
            let lacking = theirs.into_iter().filter(|(_, f)| mine.lacks(f)).map(|(l, _)| l);
            lacking.filter(|l| !mine.of.contains_key(l) || within(l)).collect()
        })
        .await
        .unwrap_or_default()
    }

    /// The endpoint of the live connection whose hellos proved `device`, if there is one.
    fn endpoint_of(&self, device: SignerId) -> Option<EndpointId> {
        let peers = self.peers.lock().expect("peers");
        peers.values().find(|p| p.device == device && p.conn.close_reason().is_none()).map(|p| p.endpoint)
    }

    /// Asks `endpoint` for the logs where the device there holds what this one lacks (`differ`), and those alone, if
    /// there are any. How many edits were new.
    ///
    /// In three askings at most (`next_asking`): first Maia City's manifests the views asked for, which say what each
    /// page wants, then what the open views want now, each with the logs that say who may do what; then every other
    /// log at once. A peer answers an asking a page at a time by
    /// the edits' places across every log it names (`sync::place`), so each page of one asking sorts after all it took
    /// before and steps on the replay (`policy::replay_on`), where an asking of a few hundred logs at a time sorted each
    /// page among the edits held and replayed them all again: a first sync of 50,000 edits took 8.7 s so, 0.36 s in
    /// one asking (`replay_scale`, 2026-10-27). The view's few edits sort among the rest's, which replays them again
    /// alone (`Tail`).
    async fn ask_differing(self: &Arc<Self>, endpoint: EndpointId) -> Result<usize> {
        let _activity = self.admit()?;
        let peer = self.connection(endpoint).await?;
        // the logs no other peer is asked for now (`Claims`), claimed until this asking ends, however it ends
        let differing = self.differ(peer.device).await;
        let (mut left, owed) = self.claims.lock().expect("claims").take(endpoint, differing, Instant::now());
        let _claimed = Claimed { shared: self, endpoint };
        // logs another peer's asking lands pages for: asked again once its claim may have stalled
        // (`no_log_waits_past_the_handover`), and again then while it lands them
        if owed {
            let shared = Arc::downgrade(self);
            task::spawn(async move {
                time::sleep(HANDOVER).await;
                if let Some(shared) = shared.upgrade() {
                    shared.ask_soon(endpoint);
                }
            });
        }
        let (mut new, mut keys, mut stage) = (0, BTreeSet::new(), AskingStage::Manifests);
        // a new device's views ask by selectors before they know an entry: the first asking waits a moment for what
        // peers name for them, Maia City's manifests first, else it would take every log at once and the views theirs
        // only at its end; a catch-up of a few logs asks for them at once
        if left.len() > FIRST_FINDS_LOGS {
            self.first_finds().await;
        }
        let asked = loop {
            let key_waits = self.read(|lab, me| lab.owner_base_key_waits(me)).await;
            let logs = {
                let mut wanted = self.wanted.lock().expect("wanted");
                let (active, manifests) = {
                    let interests = self.interests.lock().expect("interests");
                    (interests.entries(), interests.manifests())
                };
                let mut priority = bootstrap_dependencies::key_logs(&active, &key_waits);
                priority.extend(active);
                let logs = next_asking(&mut left, &wanted, &priority, &manifests, &mut stage);
                wanted.retain(|l| !logs.contains(l));
                logs
            };
            if logs.is_empty() {
                break Ok(new);
            }
            // an asking of every log left yields to what the open views come to want now while it runs (`Yield`):
            // a view opened, or peers named the entries a new device's view asks for by its selectors
            let yielding = left.is_empty().then(|| Yield::new(logs.clone(), self.views_want()));
            match self.pull_expected(endpoint, Scope::Logs(logs.clone()), true, None, None, Some(&mut keys), yielding.as_ref()).await {
                Ok(got) => new += got,
                Err(e) => break Err(e),
            }
            // it yielded: its logs are left again, the manifests and the views asked for first, then the rest, whose
            // pages come after what it took (the request names what is held now)
            if yielding.as_ref().is_some_and(Yield::yielded) {
                left.extend(logs);
                stage = AskingStage::Manifests;
            }
            // an asking of the manifests or the views, which leaves logs for a later one
            let early = !left.is_empty();
            // the keys the manifests' and the views' batches named, on a task of their own while the next batches
            // come: it is the logs no entry's (who may do what, the audiences' keys), so a new device's views open and
            // find what they want at once instead of after the last log of a whole catch-up, and no log waits behind a
            // key fetch (`a_new_humans_keys_hold_no_log_back`); the last batch's keys come after its last log
            if early && !keys.is_empty() {
                let (now, shared, device) = (std::mem::take(&mut keys), self.clone(), peer.device);
                if let Ok(activity) = self.admit() {
                    task::spawn(async move {
                        let _activity = activity;
                        if shared.bring_keys(endpoint, device, now, true).await.is_ok() {
                            shared.catch_up_paced_class(true, lab_schedule::Class::Background).await;
                        }
                    });
                }
            }
        };
        // the keys every log named, after the last log (`bring_keys`); after a failed asking only while its connection
        // lives, so no fetch waits out its timeouts on a dead one
        if asked.is_err() && self.live(endpoint).is_none() {
            keys.clear();
        }
        let brought = self.bring_keys(endpoint, peer.device, keys, true).await;
        let asked = asked.and_then(|new| brought.map(|()| new));
        // what every asking brought, brought up to date at last, however it ended
        self.catch_up_paced_class(true, lab_schedule::Class::Background).await;
        asked
    }

    /// Waits, at most `FIRST_FINDS`, until peers named something for the open views' selectors, while they ask by
    /// selectors alone (`Interests::finding`): a new device's pages, which know no entry before their first find came
    /// back. At once where no view asks so, or one names an entry.
    async fn first_finds(self: &Arc<Self>) {
        let until = Instant::now() + FIRST_FINDS;
        while self.interests.lock().expect("interests").finding() && Instant::now() < until {
            time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// Brings its device's keys and items up to date with the edits it took since (`Lab::catch_up`), if it `must`, or
    /// else once it waited `CATCH_UP_PACE` times as long as the last one took since it ended. True if it did.
    async fn catch_up_paced_class(self: &Arc<Self>, must: bool, class: lab_schedule::Class) -> bool {
        self.catch_up_steps(must, class, None).await.0
    }

    /// `catch_up_paced_class`, and for a live pull (`live::materialize_live`) `until` a deadline: no step begins after
    /// it, and the pages are stirred after every step, so the step that shows the live edit's entries (a new write's
    /// entries are shown first, `Lab::show_items`) reaches them at once rather than after the whole catch-up. Whether it
    /// did, and whether steps were left at the deadline.
    pub(crate) async fn catch_up_steps(self: &Arc<Self>, must: bool, class: lab_schedule::Class, until: Option<Instant>) -> (bool, bool) {
        let soonest = *self.paced.lock().expect("paced");
        if !must && let Some(soonest) = soonest.filter(|soonest| Instant::now() < *soonest) {
            self.catch_up_later(soonest);
            return (false, false);
        }
        // A turn of the Lab a step (`Lab::catch_up_step`), not one for the whole: its replay stepped on, then its
        // entries shown anew `CATCH_UP_SLICE` at a time, so a page's turn comes between them rather than after all of
        // them (a catch-up held the server's Lab 5.5 s, 2026-10-27).
        let (mut caught, mut work, mut left, mut budget) = (false, Duration::ZERO, false, CATCH_UP_SLICE);
        loop {
            if until.is_some_and(|until| Instant::now() >= until) {
                left = true;
                break;
            }
            let (step, took) = self.try_lab_class(class, move |lab, me| {
                // Queue waiting is not computation cost: foreground priority must not
                // multiply a busy queue into another long background-sync cooldown.
                let started = Instant::now();
                (lab.catch_up_step(me, budget), started.elapsed())
            }).await.unwrap_or((avendb::lab::CatchUp::Caught(false), Duration::ZERO));
            work += took;
            budget = catch_up_budget(budget, took);
            let done = match step {
                avendb::lab::CatchUp::Stepped => { caught = true; false }
                avendb::lab::CatchUp::Caught(any) => { caught |= any; true }
            };
            if until.is_some() && caught {
                self.jobs.stir();
            }
            if done {
                break;
            }
        }
        if caught {
            *self.paced.lock().expect("paced") = Some(Instant::now() + work * CATCH_UP_PACE);
            self.changed.notify_one();
            self.find_again_on_new_keys().await;
        }
        (caught, left)
    }

    /// A catch-up its pace put off runs at `soonest`, once however many were put off: a device left behind with nothing
    /// to step it on answers its peers by a replay that lacks the edits it took since (`Lab::standing`), so a peer that
    /// asked meanwhile never got them (a drive plugged in again never got the note written while it was away,
    /// 2026-10-28). It holds no turn of the node while it waits, so a shutdown doesn't wait for it.
    fn catch_up_later(self: &Arc<Self>, soonest: Instant) {
        if self.catch_up_due.swap(true, Ordering::AcqRel) {
            return;
        }
        let shared = Arc::downgrade(self);
        task::spawn(async move {
            time::sleep(soonest.saturating_duration_since(Instant::now())).await;
            let Some(shared) = shared.upgrade() else { return };
            shared.catch_up_due.store(false, Ordering::Release);
            if let Ok(_activity) = shared.admit() {
                shared.catch_up_paced_class(true, lab_schedule::Class::Background).await;
            }
        });
    }

    /// `Node::synced_to`: this device and each device on a live connection or of which the node keeps no statement, by
    /// what it announced (H1), and each other device by its newest statement, with when it checked (H2).
    async fn synced_to(self: &Arc<Self>) -> SyncedTo {
        self.synced_to_for(None).await
    }

    async fn synced_to_for(self: &Arc<Self>, scope: Option<(BTreeSet<LogId>, BTreeSet<FileRoot>)>) -> SyncedTo {
        if scope.as_ref().is_some_and(|(logs, files)| logs.is_empty() && files.is_empty()) { return SyncedTo::default(); }
        self.own_logs().await;
        let select = |h: &Holdings| match &scope { Some((logs, files)) => h.only(logs, files), None => h.clone() };
        let own = select(&self.own.lock().expect("own").holdings);
        let mut held: BTreeMap<SignerId, (Holdings, Option<u64>)> = {
            let held = self.held.lock().expect("held");
            held.iter().map(|(d, h)| (*d, (select(h), None))).collect()
        };
        held.extend(self.stated_map(select).into_iter().map(|(d, (h, checked))| (d, (h, Some(checked)))));
        let reach = self.reach.lock().expect("reach").clone();
        let shared = self.clone();
        self.read(move |lab, me| {
            let all = shared.logs_of(lab, me);
            let edits = lab.log(me).edits();
            // this device, which may hold all it holds; and each other device that may hold it by this one's view
            let mut holders: Vec<(SignerId, &Holdings, Option<&Reach>, Option<u64>)> = vec![(me, &own, None, None)];
            let others = held.iter().filter(|(d, _)| **d != me);
            holders.extend(others.filter_map(|(d, (h, checked))| Some((*d, h, Some(reach.get(d)?), *checked))));
            // each with how much it holds, among those that hold some of it as far as this device's edits show
            let list = |has: &dyn Fn(&Holdings, Option<&Reach>) -> Option<(u64, u64)>| {
                let holder = |(device, h, r, checked): &(SignerId, &Holdings, Option<&Reach>, Option<u64>)| {
                    let (has, of) = has(h, *r)?;
                    (has > 0).then_some(Holder { device: *device, has, of, checked: *checked })
                };
                let mut listed = holders.iter().filter_map(holder).collect::<Vec<_>>();
                listed.sort_by_key(|h| h.device);
                listed
            };
            let mut synced = SyncedTo::default();
            let selected_logs;
            let logs = if let Some((logs, _)) = &scope { logs } else {
                selected_logs = all.of.keys().copied().collect::<BTreeSet<_>>();
                &selected_logs
            };
            for l in logs {
                let LogId::Entry(entry) = *l else { continue };
                let of = |h: &Holdings, r: Option<&Reach>| {
                    let f = h.logs.get(l).filter(|_| r.is_none_or(|r| r.logs.contains(l)))?;
                    Some(all.held(edits, l, f))
                };
                synced.entries.insert(entry, list(&of));
            }
            let selected_files;
            let files = if let Some((_, files)) = &scope { files } else {
                selected_files = lab.files(me).into_iter().collect::<BTreeSet<_>>();
                &selected_files
            };
            for &f in files {
                let pieces = f.size.div_ceil(PIECE).max(1);
                let of = |h: &Holdings, r: Option<&Reach>| match h.files.get(&f) {
                    _ if r.is_some_and(|r| !r.files.contains(&f)) => None,
                    Some(FileHold::Whole) => Some((pieces, pieces)),
                    Some(FileHold::Pieces(p)) => Some((p.iter().collect::<BTreeSet<_>>().len() as u64, pieces)),
                    None => None,
                };
                synced.files.insert(f, list(&of));
            }
            synced
        })
        .await
    }
}

/// Which peer each log is asked of now (S5): a log that two peers hold more of comes from the first one asked for
/// it alone, not from both at once, which sent each of its edits twice and replayed them twice (the server's and
/// the Mac's answers to a phone's first sync). A peer that held more of a log asked of another is owed an asking
/// again once that other's ends (`release`), so what the first did not bring, the second still does, and a failed
/// asking's logs go to the next peer at once rather than after its wait. A claim holds only while its asking's pages
/// land: one that landed none for `HANDOVER` goes to a peer owed its logs that asks then (`take`), as an iPhone's asking
/// of the always-on peer landed one page and then none for 9 minutes, and the Mac that held the same logs was never
/// asked (S1, 2026-10-28).
#[derive(Default)]
pub(crate) struct Claims {
    by: BTreeMap<LogId, EndpointId>,
    owed: BTreeSet<EndpointId>,
    /// When each claiming peer's asking last landed a page, or began.
    landed: BTreeMap<EndpointId, Instant>,
    /// The logs a live pull asks for now (`live::LiveClaimed`), and how many live pulls ask for each: no asking of
    /// the backlog names them meanwhile, from any peer, as its request would name what the device held before the live
    /// pull took them and the peer would send them again (`LivePriority.lean`'s `backlogTake`).
    live: BTreeMap<LogId, usize>,
}

impl Claims {
    /// The logs of `differing` no other peer's asking is landing pages for now (`LivePriority.lean` `takes`), nor a
    /// live pull asks for, claimed for `endpoint` as of `now`; owes it an asking again if it left any out, and says so.
    fn take(&mut self, endpoint: EndpointId, differing: BTreeSet<LogId>, now: Instant) -> (BTreeSet<LogId>, bool) {
        let stalled = |e: &EndpointId| self.landed.get(e).is_none_or(|at| *at + HANDOVER <= now);
        let (mine, others): (BTreeSet<_>, BTreeSet<_>) = differing
            .into_iter()
            .partition(|l| !self.live.contains_key(l) && self.by.get(l).is_none_or(|e| *e == endpoint || stalled(e)));
        let owed = !others.is_empty();
        if owed {
            self.owed.insert(endpoint);
        } else {
            self.owed.remove(&endpoint);
        }
        if !mine.is_empty() {
            self.landed.insert(endpoint, now);
        }
        self.by.extend(mine.iter().map(|l| (*l, endpoint)));
        (mine, owed)
    }

    /// A page of `endpoint`'s asking landed at `now`: its claims hold on (`a_landing_claim_is_kept`).
    pub(crate) fn landed(&mut self, endpoint: EndpointId, now: Instant) {
        if let Some(at) = self.landed.get_mut(&endpoint) {
            *at = now;
        }
    }

    /// Ends `endpoint`'s claims: the other peers owed an asking, to ask again now. One still owed for logs claimed
    /// by a third stays owed, so it is asked again when that one ends too.
    fn release(&mut self, endpoint: EndpointId) -> BTreeSet<EndpointId> {
        self.landed.remove(&endpoint);
        let before = self.by.len();
        self.by.retain(|_, e| *e != endpoint);
        if self.by.len() == before {
            return BTreeSet::new();
        }
        self.owed.iter().filter(|e| **e != endpoint).copied().collect()
    }

    /// A live pull asks for `logs` now (`live::LiveClaimed`).
    pub(crate) fn live(&mut self, logs: &BTreeSet<LogId>) {
        for log in logs {
            *self.live.entry(*log).or_default() += 1;
        }
    }

    /// A live pull's `logs` asked, however it ended: every peer owed an asking, its own among them, to ask again now,
    /// for what the live pull didn't bring (`no_differing_log_is_lost`).
    pub(crate) fn live_done(&mut self, logs: &BTreeSet<LogId>) -> BTreeSet<EndpointId> {
        let mut ended = false;
        for log in logs {
            if let Some(n) = self.live.get_mut(log) {
                *n -= 1;
                if *n == 0 {
                    self.live.remove(log);
                    ended = true;
                }
            }
        }
        if ended { std::mem::take(&mut self.owed) } else { BTreeSet::new() }
    }
}

/// An asking's claims (`Claims`), ended as it drops, and the peers they held back asked again.
struct Claimed<'a> {
    shared: &'a Shared,
    endpoint: EndpointId,
}

impl Drop for Claimed<'_> {
    fn drop(&mut self) {
        let again = self.shared.claims.lock().map(|mut c| c.release(self.endpoint)).unwrap_or_default();
        for endpoint in again {
            self.shared.outreach.send(node_loop::Msg::Ask { endpoint });
        }
    }
}

/// The most logs a first asking names for the open views (`next_asking`): their own few, not a vault's thousands.
const VIEW_LOGS: usize = 1024;

/// What an asking of every log left (`Shared::ask_differing`) yields to (`Interest.lean`'s `yields`): the logs it asks
/// for, and what the open views wanted when it began (`Shared::views_want`). It yields once they want now a log it
/// asks for that they didn't then: a view that opened while it ran, or the entries peers named for a view's
/// selectors. Their logs came only when its pages reached their places, often at its very end; so it ends after the
/// page it is taking, and they are asked for on their own. What was wanted when it began never stops it, so an asking
/// begun anew doesn't yield to the same wants again.
pub(crate) struct Yield {
    asked: BTreeSet<LogId>,
    before: BTreeSet<LogId>,
    yielded: AtomicBool,
}

impl Yield {
    fn new(asked: BTreeSet<LogId>, before: BTreeSet<LogId>) -> Self {
        Self { asked, before, yielded: AtomicBool::new(false) }
    }

    /// Whether `now`, what the views want now, holds a log it asks for that they didn't want when it began.
    fn yields_to(&self, now: &BTreeSet<LogId>) -> bool {
        now.iter().any(|l| self.asked.contains(l) && !self.before.contains(l))
    }

    /// Whether it yields now to what `shared`'s views want; once it did, it stays yielded.
    fn due(&self, shared: &Shared) -> bool {
        let due = self.yields_to(&shared.views_want());
        if due {
            self.yielded.store(true, Ordering::Relaxed);
        }
        due
    }

    fn yielded(&self) -> bool {
        self.yielded.load(Ordering::Relaxed)
    }
}

impl Shared {
    /// What the open views want: the entries their Interests name or peers named for their selectors, the manifests
    /// peers named for them, and the entries pages asked for (`Node::want`). An asking's `Yield` reads it.
    fn views_want(&self) -> BTreeSet<LogId> {
        let mut out: BTreeSet<LogId> = {
            let interests = self.interests.lock().expect("interests");
            interests.entries().into_iter().chain(interests.manifests()).collect()
        };
        out.extend(self.wanted.lock().expect("wanted").iter().copied());
        out
    }
}

/// A turn on the Lab so long that, in a page's worker, the network's packets wait behind it: one frame's time.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
const LONG_TURN: Duration = Duration::from_millis(16);

/// Which asking of a connection's comes next (`next_asking`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AskingStage {
    /// Maia City's manifests the views asked for: they say what each page wants, so they decide what comes first.
    Manifests,
    /// What the open views want now.
    Views,
    /// Every log left.
    Rest,
}

/// How long a connection's first asking waits for what peers name for the views' selectors (`Shared::first_finds`),
/// at most: a find's round trip over the relay, the device's keys of the vaults found on the way.
const FIRST_FINDS: Duration = Duration::from_millis(1500);
/// The fewest logs a connection's askings take for its first to wait for the views' finds (`FIRST_FINDS`): a catch-up
/// of fewer comes at once, whatever the views want.
const FIRST_FINDS_LOGS: usize = 64;

/// The logs of `left` to ask for next, taken out of it (`Shared::ask_differing`), by `stage`, which it moves on. First
/// the manifests peers named for the views (`manifests`), if any are left; then the logs the open views want now
/// (`active`, with their audiences' keys) and the entry logs pages asked for (`wanted`), if any are left; each with
/// every vault's and share's log not asked yet, which say who may do what and are few, at most `VIEW_LOGS`; else, and
/// then, every log left, in one asking. None once `left` is empty. Not every audience's log: those hold the keys and
/// their wraps, most of a vault's edits (2026-10-27, with them in the first asking an iPhone's views never opened).
fn next_asking(left: &mut BTreeSet<LogId>, wanted: &BTreeSet<LogId>, active: &[LogId], manifests: &BTreeSet<LogId>, stage: &mut AskingStage) -> BTreeSet<LogId> {
    let rules = |left: &BTreeSet<LogId>| left.iter().filter(|l| matches!(l, LogId::Vault(_) | LogId::Share(_))).copied().collect::<Vec<_>>();
    let mut next = BTreeSet::new();
    if *stage == AskingStage::Manifests {
        *stage = AskingStage::Views;
        let first: Vec<LogId> = manifests.iter().filter(|l| left.contains(l)).copied().collect();
        if !first.is_empty() {
            next = first.into_iter().chain(rules(left)).take(VIEW_LOGS).collect();
        }
    }
    if next.is_empty() && *stage == AskingStage::Views {
        *stage = AskingStage::Rest;
        let viewed: Vec<LogId> = active.iter().chain(wanted).filter(|l| left.contains(l)).copied().collect();
        if !viewed.is_empty() {
            next = viewed.into_iter().chain(rules(left)).take(VIEW_LOGS).collect();
        }
    }
    if next.is_empty() {
        *stage = AskingStage::Rest;
        next = std::mem::take(left);
    }
    left.retain(|l| !next.contains(l));
    next
}

#[cfg(test)]
mod tests {
    use super::*;
    use avendb::id::EntryId;

    /// S5: a log two peers hold more of is asked of one of them at a time; the other is asked again once that
    /// asking ends, and owed nothing more once it took all it differed by.
    #[test]
    fn each_log_is_asked_of_one_peer_and_the_other_is_asked_again_after() {
        let (server, mac) = (SecretKey::from_bytes(&[1; 32]).public(), SecretKey::from_bytes(&[2; 32]).public());
        let log = |n: u8| LogId::Entry(EntryId([n; 32]));
        let (mut claims, now) = (Claims::default(), Instant::now());
        let both: BTreeSet<_> = [log(1), log(2)].into();
        assert_eq!(claims.take(server, both.clone(), now), (both, false), "the first asked takes all");
        let other = claims.take(mac, [log(2), log(3)].into(), now);
        assert_eq!(other, ([log(3)].into(), true), "the other only what no one asks for, owed the rest");
        assert_eq!(claims.release(server), [mac].into(), "its end asks the held-back peer again");
        assert_eq!(claims.take(mac, [log(2)].into(), now), ([log(2)].into(), false), "which takes what is left");
        assert_eq!(claims.release(mac), BTreeSet::new(), "and is owed nothing more");
        assert_eq!(claims.release(server), BTreeSet::new(), "an asking that claimed nothing wakes no one");
    }

    /// S1: a claim holds while its asking's pages land (`a_landing_claim_is_kept`); once none landed for `HANDOVER`, a
    /// peer owed its logs takes them (`a_stalled_claim_hands_over`), and the stalled asking's end wakes no one for them.
    #[test]
    fn a_claim_whose_pages_stop_landing_goes_to_the_peer_owed_it() {
        let (server, mac) = (SecretKey::from_bytes(&[1; 32]).public(), SecretKey::from_bytes(&[2; 32]).public());
        let log = |n: u8| LogId::Entry(EntryId([n; 32]));
        let (mut claims, began) = (Claims::default(), Instant::now());
        let both: BTreeSet<_> = [log(1), log(2)].into();
        claims.take(server, both.clone(), began);
        let soon = began + HANDOVER / 2;
        assert_eq!(claims.take(mac, both.clone(), soon), (BTreeSet::new(), true), "a fresh claim holds");
        claims.landed(server, soon);
        let later = began + HANDOVER;
        assert_eq!(claims.take(mac, both.clone(), later), (BTreeSet::new(), true), "a page landed: it holds on");
        let stalled = soon + HANDOVER;
        assert_eq!(claims.take(mac, both.clone(), stalled), (both, false), "no page for the handover: the Mac takes all");
        assert_eq!(claims.release(server), BTreeSet::new(), "the stalled asking's end holds nothing back");
        assert_eq!(claims.release(mac), BTreeSet::new());
    }

    /// F12: a log a live pull asks for is left out of every backlog asking meanwhile, of its own peer too, and the
    /// backlog is asked again once the live pull ends, so nothing is pulled twice and nothing is lost.
    #[test]
    fn a_live_pulls_logs_are_not_asked_again_by_the_backlog() {
        let (server, mac) = (SecretKey::from_bytes(&[1; 32]).public(), SecretKey::from_bytes(&[2; 32]).public());
        let log = |n: u8| LogId::Entry(EntryId([n; 32]));
        let (mut claims, now) = (Claims::default(), Instant::now());
        let chat: BTreeSet<_> = [log(1)].into();
        claims.live(&chat);
        claims.live(&chat);
        assert_eq!(claims.take(mac, [log(1), log(2)].into(), now), ([log(2)].into(), true), "its own peer's backlog leaves it out");
        assert_eq!(claims.take(server, [log(1)].into(), now), (BTreeSet::new(), true), "and every other peer's");
        assert_eq!(claims.live_done(&chat), BTreeSet::new(), "a second live pull still asks for it");
        assert_eq!(claims.live_done(&chat), [mac, server].into(), "the last one's end asks both again");
        assert_eq!(claims.take(mac, [log(1)].into(), now), ([log(1)].into(), false), "what it didn't bring, the backlog takes");
        assert_eq!(claims.live_done(&chat), BTreeSet::new(), "an ended claim ends once");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn bootstrap_pump_finishes_suffix_without_foreground_mutations() {
        use avendb::cast::{document, human_on};
        let mut lab = Lab::new();
        let owner = lab.passkey("Pump owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Base", "old", mac)).unwrap();
        lab.sync(mac, phone);
        lab.edit(mac, vault, entry, |item| item.set_text(2, "checkpoint")).unwrap();
        let prepared = lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
        let snapshot = lab.complete(mac, prepared.draft, &[]).unwrap();
        let offer = lab.entry_base_offer(mac, phone, entry).unwrap();
        lab.receive(phone, offer.evidence, vec![]);
        let mut suffix = Vec::new();
        for n in 0..40 {
            suffix.push(lab.edit(mac, vault, entry, |item| item.set_text(2, &format!("suffix {n}"))).unwrap());
        }
        let signed = lab.backup(mac).signed().iter().filter(|s| suffix.contains(&s.edit.id())).cloned().collect();
        lab.receive(phone, signed, vec![]);
        let expected = lab.item(mac, entry).unwrap().record();
        assert!(lab.adopt_owner_entry_base(phone, snapshot, entry, prepared.sealed));
        assert!(lab.owner_base_pending(phone, entry) > 0, "fixture needs a second bounded turn");
        let node = Node::spawn(lab.split(phone, &[owner], [31; 32]), phone, Options::local()).await.unwrap();
        tokio::time::timeout(Duration::from_secs(20), async {
            loop {
                if node.read(move |lab, me| lab.owner_base_pending(me, entry)).await == 0 { break; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.expect("background pump advances without foreground mutation");
        assert_eq!(node.read(move |lab, me| lab.item(me, entry).unwrap().record()).await, expected);
        node.shutdown().await.unwrap();
    }

    #[tokio::test(flavor="multi_thread",worker_threads=2)]
    async fn bootstrap_missing_body_transition_wakes_idle_dependency_pump() {
        use avendb::cast::{document,human_on};
        let mut lab=Lab::new();let owner=lab.passkey("Wake owner");
        let mac=lab.device_of(owner,"Mac");let phone=lab.device_of(owner,"Phone");let pad=lab.device_of(owner,"Pad");
        let vault=human_on(&mut lab,owner,&[mac,phone,pad]);
        let entry=lab.create(mac,vault,vault,"note",&[],document("Base","old",mac)).unwrap();
        lab.sync(mac,phone);lab.sync(mac,pad);
        let dependency=lab.edit(mac,vault,entry,|i|i.set_text(2,"dependency")).unwrap();
        let dependency_signed=lab.signed_edit(mac,dependency).unwrap().clone();
        lab.sync(mac,phone);
        let concurrent=lab.edit(phone,vault,entry,|i|{i.edit_document(|d|d.title="concurrent".into());}).unwrap();
        let signed=lab.signed_edit(phone,concurrent).unwrap().clone();
        lab.edit(mac,vault,entry,|i|i.set_text(2,"checkpoint")).unwrap();
        let prepared=lab.draft_judged_entry_base(mac,&[owner],entry).unwrap();
        let snapshot=lab.complete(mac,prepared.draft,&[]).unwrap();
        let offer=lab.entry_base_offer(mac,pad,entry).unwrap();
        lab.receive(pad,offer.evidence,vec![]);lab.receive(pad,vec![signed],vec![]);
        let node=Node::spawn(lab.split(pad,&[owner],[41;32]),pad,Options::local()).await.unwrap();
        node.tasks.lock().unwrap().iter().for_each(|task|task.abort());
        while tokio::time::timeout(Duration::ZERO,node.shared.bootstrap_due.notified()).await.is_ok() {}
        assert!(node.act(move|lab,me|lab.adopt_owner_entry_base(me,snapshot,entry,prepared.sealed)).await);
        assert!(!node.read(|lab,me|lab.owner_bases_pending(me)).await,"dependency wait is not runnable replay");
        assert_eq!(node.read(move|lab,me|bootstrap_dependencies::missing_batch(lab,me,entry)).await,vec![dependency]);
        tokio::time::timeout(Duration::from_millis(100),node.shared.bootstrap_due.notified()).await.expect("new dependency wait must wake the network pump");
        let mut changed=node.shared.size.subscribe();changed.borrow_and_update();
        node.act(move|lab,me|lab.receive(me,vec![dependency_signed],vec![])).await;
        assert!(node.read(|lab,me|lab.owner_base_missing(me).is_empty()).await);
        assert!(node.read(move|lab,me|bootstrap_dependencies::missing_batch(lab,me,entry)).await.is_empty(),"next peer must not re-fetch a dependency already received");
        tokio::time::timeout(Duration::from_millis(100),changed.changed()).await.unwrap().unwrap();
        node.shutdown().await.unwrap();
    }

    /// An offer with an address of each family and a relay.
    fn offer() -> Offer {
        let addr = EndpointAddr::new(SecretKey::from_bytes(&[3; 32]).public())
            .with_ip_addr("192.0.2.7:7401".parse().expect("an address"))
            .with_ip_addr("[2001:db8::7]:7401".parse().expect("an address"))
            .with_relay_url("https://avendb.maia.city".parse().expect("a URL"));
        Offer { device: SignerId([5; 32]), addr }
    }

    #[test]
    fn the_views_logs_come_first_with_who_may_do_what_then_every_other_log_at_once() {
        let entry = |i: u8| LogId::Entry(EntryId([i; 32]));
        let mut left: BTreeSet<LogId> = (1..=5).map(entry).collect();
        left.extend([LogId::Vault(VaultId([9; 32])), LogId::Share(ShareId([8; 32])), LogId::Audience(VaultId([9; 32]), avendb::id::AudienceId([7; 32]))]);
        let (wanted, view) = ([entry(1)].into(), [entry(99), entry(4)]);
        // the view's logs left and the old wants, with the vaults' and shares' logs; a log it doesn't lack isn't asked
        let mut stage = AskingStage::Manifests;
        let none = BTreeSet::new();
        let first = next_asking(&mut left, &wanted, &view, &none, &mut stage);
        let audience = LogId::Audience(VaultId([9; 32]), avendb::id::AudienceId([7; 32]));
        assert_eq!(first, [entry(1), entry(4), LogId::Vault(VaultId([9; 32])), LogId::Share(ShareId([8; 32]))].into());
        // then the rest in one asking, an audience's keys among them, so its pages come by their places across every log
        let rest = next_asking(&mut left, &wanted, &view, &none, &mut stage);
        assert_eq!(rest, [entry(2), entry(3), entry(5), audience].into());
        assert!(left.is_empty() && next_asking(&mut left, &wanted, &view, &none, &mut stage).is_empty());
    }

    #[test]
    fn maia_citys_manifests_come_before_any_view_then_the_views_then_every_other_log() {
        let entry = |i: u8| LogId::Entry(EntryId([i; 32]));
        let (vault, share) = (LogId::Vault(VaultId([9; 32])), LogId::Share(ShareId([8; 32])));
        let audience = LogId::Audience(VaultId([9; 32]), avendb::id::AudienceId([7; 32]));
        let mut left: BTreeSet<LogId> = (1..=6).map(entry).collect();
        left.extend([vault, share, audience]);
        // entry 5 and 6 are manifests (6 held already: not left), entry 2 and 3 the view's rooms
        let (manifests, view) = ([entry(5), entry(60)].into(), [entry(2), entry(3), entry(5)]);
        let mut stage = AskingStage::Manifests;
        let first = next_asking(&mut left, &BTreeSet::new(), &view, &manifests, &mut stage);
        assert_eq!(first, [entry(5), vault, share].into(), "the manifests first, with who may do what");
        let views = next_asking(&mut left, &BTreeSet::new(), &view, &manifests, &mut stage);
        assert_eq!(views, [entry(2), entry(3)].into(), "then the view's own");
        let rest = next_asking(&mut left, &BTreeSet::new(), &view, &manifests, &mut stage);
        assert_eq!(rest, [entry(1), entry(4), entry(6), audience].into(), "then every other log at once");
        assert!(left.is_empty());
        // no manifest named yet: the views first, as before
        let mut left: BTreeSet<LogId> = (1..=3).map(entry).collect();
        let mut stage = AskingStage::Manifests;
        assert_eq!(next_asking(&mut left, &BTreeSet::new(), &[entry(2)], &BTreeSet::new(), &mut stage), [entry(2)].into());
        assert_eq!(next_asking(&mut left, &BTreeSet::new(), &[entry(2)], &BTreeSet::new(), &mut stage), [entry(1), entry(3)].into());
    }

    #[test]
    fn with_no_view_every_log_comes_in_one_asking() {
        let entry = |i: u8| LogId::Entry(EntryId([i; 32]));
        let mut left: BTreeSet<LogId> = (1..=300).map(|i| entry(i as u8)).collect();
        left.insert(LogId::Vault(VaultId([9; 32])));
        let all = left.clone();
        assert_eq!(next_asking(&mut left, &BTreeSet::new(), &[], &BTreeSet::new(), &mut AskingStage::Manifests), all);
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

/// The invites of the vault device `me` of `lab` serves, the seed's coop, Maia City, that no vault claimed yet
/// (`avendb::admission::open_invites`); none where it serves no coop.
fn open_invites(lab: &Lab, me: SignerId) -> Vec<ShareId> {
    match avendb::world::seed_of(lab, me).first() {
        Some(&home) => avendb::admission::open_invites(lab.state(me), home),
        None => Vec::new(),
    }
}

#[cfg(test)]
mod admission_tests {
    use super::*;

    #[test]
    fn signing_up_by_invite_honours_a_known_passkey_or_an_open_invite_alone() {
        let (known, stranger) = (SignerId::from_u64(1), SignerId::from_u64(2));
        let (open, claimed) = (ShareId::from_u64(31), ShareId::from_u64(32));
        let admitted = || Admitted { passkeys: [known].into(), invites: [open].into(), ..Admitted::default() };
        let invited = Admission::invited();
        invited.set(admitted());
        assert!(invited.honours_with(&known, None), "a passkey of a vault it knows");
        assert!(!invited.honours_with(&stranger, None), "a stranger with no invite");
        assert!(invited.honours_with(&stranger, Some(open)), "a stranger with an open invite");
        assert!(!invited.honours_with(&stranger, Some(claimed)), "a stranger with an invite no longer open");
        let closed = Admission::default();
        closed.set(admitted());
        assert!(
            closed.honours_with(&known, None) && !closed.honours_with(&stranger, Some(open)),
            "closed: known alone"
        );
        assert!(Admission::open().honours_with(&stranger, None), "open to anyone");
        let unclaimed = Admission::invited();
        unclaimed.set(Admitted { claimable: true, ..Admitted::default() });
        assert!(unclaimed.honours_with(&stranger, None), "while nobody has claimed the server, any");
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
#[path = "prepared_receive_tests.rs"]
mod prepared_receive_tests;

/// One Lab call's turn, timed from when it asked for it: its wait ends as it holds the Lab, its hold as this drops.
struct Timed<'a> {
    turns: &'a lab_schedule::Turns,
    what: &'static str,
    asked: Instant,
    held: Instant,
}

impl<'a> Timed<'a> {
    fn new(turns: &'a lab_schedule::Turns, what: &'static str, asked: Instant) -> Self {
        Self { turns, what, asked, held: Instant::now() }
    }
}

impl Drop for Timed<'_> {
    fn drop(&mut self) {
        let wait = self.held.duration_since(self.asked).as_millis() as u64;
        self.turns.took(self.what, wait, self.held.elapsed().as_millis() as u64);
    }
}

#[cfg(test)]
mod catch_up_budget_tests {
    use super::*;

    /// A step that took four times its turn shrinks the next to a quarter; one in under half of it doubles; within it,
    /// the same; never under one, nor over four times `CATCH_UP_SLICE`.
    #[test]
    fn a_catch_ups_budget_follows_how_long_its_steps_took() {
        let ms = Duration::from_millis;
        assert_eq!(catch_up_budget(48, ms(64)), 12);
        assert_eq!(catch_up_budget(48, ms(4)), 96);
        assert_eq!(catch_up_budget(48, ms(12)), 48);
        assert_eq!(catch_up_budget(1, ms(24_100)), 1, "a 24 s step leaves one entry's worth");
        assert_eq!(catch_up_budget(CATCH_UP_SLICE * 4, Duration::ZERO), CATCH_UP_SLICE * 4);
    }
}
