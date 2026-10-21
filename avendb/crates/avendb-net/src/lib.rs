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
//! - **No curve trusted**: every signature on every edit is ML-DSA-65, or SLH-DSA from a signer made before the key
//!   move (`sign::Suite`), so neither ed25519 nor P-256 makes an edit count; a passkey's WebAuthn assertion beside it
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
//! - **Snapshots** (`backup`, `docs/BACKUP.md`): the server backs up each vault into a folder of its own of a bucket of
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
mod blobs;
#[cfg(not(target_arch = "wasm32"))]
pub mod bucket;
#[cfg(not(target_arch = "wasm32"))]
pub mod disk;
mod edits;
mod files;
mod holdings;
mod jobs;
mod limits;
pub mod kx;
mod progress;
mod run;
pub mod server;
mod session;
pub mod shelf;
mod statements;
mod tree;

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::hash::Hash;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::engine::follow_standing;
use avendb::id::{BlobId, EditId, ShareId, SignerId, VaultId};
use avendb::keys::PublicKey;
use avendb::lab::{Backup, Drafting, Lab, Unsigned, Warm};
use avendb::policy::{Action, Kind, Principal, Refusal, Sharing};
use avendb::sealed::{FileRoot, PIECE};
use avendb::sign::{Ceremony, RelayPass, SUITES, Signed, SignerKeys};
use avendb::sync::{log_of, place, LogId};
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
use iroh_blobs::util::connection_pool::{self, ConnectionPool};
#[cfg(not(target_arch = "wasm32"))]
use iroh_blobs::store::mem::MemStore;
use serde_json::{Value, json};
use rustls::crypto::CryptoProvider;
use n0_future::task::{self, JoinHandle};
use n0_future::{FuturesUnordered, StreamExt as _, future};
use n0_future::time::{self, Instant};
use tokio::sync::{Notify, watch};

use holdings::{Logs, MOST};

pub use limits::{Limits, Usage};
pub use files::Source;
pub use holdings::{Holder, Holdings, SyncedTo};
pub use jobs::{HISTORY, Job, Jobs, Running, State as JobState};
pub use progress::{Ending, Progress, Stage, Steps};
pub use run::{NoBytes, NoCeremony};
pub use session::exporter;
pub use shelf::{Call, Shelf};

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
/// with two pulls running). The asking fails, and the node asks again as it does any it failed (`Backoff`).
const PAGE_WAIT: Duration = Duration::from_secs(180);

/// The most entry logs one asking of the logs a peer holds more of names (`Shared::ask_differing`). A peer answers an
/// asking a page at a time by the edits' places across every log it names (`sync::place`), and a log counts only once
/// it is whole, so one asking of every log of a vault (~2,200 of Maia City's) makes nearly none whole until its last
/// page. Asked so many at a time, each batch of entries comes whole before the next starts.
const LOGS_AT_ONCE: usize = 256;

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
    /// It reaches its relay through the HTTP proxy its environment names (`HTTPS_PROXY` and the like), as a node in a
    /// cloud session must, whose only way out is its proxy: iroh tunnels the relay's connection through it, and the TLS
    /// inside, X25519MLKEM768 alone, is the node's own end to end.
    pub proxy: bool,
    /// It asks its peers for nothing on its own, as a cloud session's agent does: not what a peer announces it holds,
    /// nor again once the vaults it follows change; only what it is told to bring (`Node::bring`, `Node::sync_with`),
    /// so a fresh one never pulls all its device may hold, but the vaults a tool call touches.
    pub lazy: bool,
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
    /// its own, as a browser's, which the server doesn't know until it joined, is let in by one for ten minutes. One,
    /// or one in each suite while it doesn't know which its person's vault knows (the key move, `passes_token`).
    pub relay_passes: Vec<RelayPass>,
    /// The most bytes of edits it answers a request with, but at least one edit: a peer asks on for the rest
    /// (`Lab::reply`).
    pub page: usize,
    /// Where it marks the steps of its start, its own (`node`, once its store is replayed) and those of founding its
    /// person's vault or linking to it (`Node::found_with`, `Node::link_with`), for its person to watch.
    pub progress: Progress,
}

/// How many bytes of edits a node answers a request with, at most, unless told otherwise: a few hundred edits, each
/// with its signatures, so a big reply never waits whole in either end's memory, nor holds up the connection.
pub const PAGE: usize = 4 << 20;

/// Every how many pages of a pull its device brings its keys and items up to date (`Lab::receive_whose_now`), and at
/// its last: each time replays the whole log for a device catching up from far behind, whose edits sort before what
/// its replay last stepped over.
const CATCH_UP: usize = 8;

impl Options {
    /// Nodes on one machine, as in the tests: loopback, no relay, and no lookup but the addresses a node is told.
    pub fn local() -> Options {
        Options {
            bind: Some(SocketAddr::from(([127, 0, 0, 1], 0))),
            direct: false,
            relay: None,
            proxy: false,
            lazy: false,
            retry: Duration::from_secs(1),
            shelf: None,
            keep: false,
            card: false,
            admission: None,
            relay_passes: Vec::new(),
            page: PAGE,
            progress: Progress::new(),
        }
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
        self.0.lab(move |lab, _| lab.ceremony(passkey, challenge)).await.context("the passkey isn't at hand")
    }

    async fn touch(&self, challenge: [u8; 32], step: Step) -> Result<Ceremony> {
        self.ceremony(challenge, step).await
    }
}

/// The time by this machine's clock, or the browser's: seconds since 1970.
pub(crate) fn unix_now() -> u64 {
    time::SystemTime::now().duration_since(time::SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// The most passes a token carries (`passes_token`): one in each suite.
pub const TOKEN_PASSES: usize = 2;

/// Relay passes as the token a node shows its relay as it connects: each in base64url without padding, joined by
/// `.`, which a browser's node carries in the query of the relay's URL, as a page can't set the headers of a
/// WebSocket. A new device shows its passkey's pass in each suite while it doesn't know which one its person's vault
/// knows (the key move, Samuel 2026-10-19), the relay taking the one it honours (`token_passes`); one pass is the
/// token it was before.
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
    tasks: Vec<JoinHandle<()>>,
}

impl Node {
    /// Device `me` of `lab` on the network: it answers its peers, tells them when its logs change, and asks them when
    /// theirs differ. With a shelf, it first takes back what its device kept there, if anything, and saves there what
    /// its device holds from then on (`edits`). Fails while the device is locked, as its endpoint key is its own
    /// ed25519 key, and if its shelf can't be read.
    pub async fn spawn(lab: Lab, me: SignerId, opts: Options) -> Result<Node> {
        let secret = lab.endpoint_secret(me).context("a device of this Lab, unlocked")?;
        // a page keeps what lasts in OPFS, and nowhere else
        #[cfg(target_arch = "wasm32")]
        if opts.shelf.is_none() {
            bail!("a node in a browser keeps a shelf");
        }
        let (edits, stored) = match &opts.shelf {
            Some(shelf) => {
                let (edits, stored) = edits::Edits::open(shelf.clone()).await?;
                (Some(edits), stored)
            }
            None => (None, edits::Stored::default()),
        };
        // the edits of a head the device sealed it checked already (`Edits::vouched`)
        let key = lab.shelf_key(me);
        let vouched = match (&edits, &key) {
            (Some(edits), Some(key)) => edits.vouched(key).await,
            _ => HashSet::new(),
        };
        // and what it worked out from them before (`Edits::warm`)
        let warm = match &edits {
            Some(edits) => edits.warm().await,
            None => Warm::default(),
        };
        let restore = move || restore(lab, me, stored, &vouched, &warm);
        #[cfg(not(target_arch = "wasm32"))]
        let (lab, stored) = tokio::task::spawn_blocking(restore).await?;
        // a page has no threads to spare
        #[cfg(target_arch = "wasm32")]
        let (lab, stored) = restore();
        if let Some(edits) = &edits {
            edits.settle(&lab, me, &stored);
            if let Some(key) = key
                && let Err(e) = edits.seal_with(key).await
            {
                tracing::warn!("avendb: the shelf's head can't be sealed: {e:#}");
            }
        }
        opts.progress.step("node");
        if let Some(admission) = &opts.admission {
            let own = SecretKey::from_bytes(&secret).public();
            let endpoints = endpoints(&lab.peers(me)).chain([own]).collect();
            let claimable = opts.card && lab.vault_of(me).is_none();
            let (passkeys, invites) = (lab.roots(me).into_iter().collect(), open_invites(&lab, me).into_iter().collect());
            admission.set(Admitted { endpoints, passkeys, claimable, invites });
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
        let shared = Arc::new(Shared {
            me,
            lab: Mutex::new(lab),
            edits,
            endpoint: endpoint.clone(),
            lookup,
            store: store.clone(),
            opts,
            peers: Mutex::default(),
            dialing: Mutex::default(),
            logs: Mutex::default(),
            own: Mutex::new(Own { at: ((usize::MAX, 0), 0), holdings: Holdings::default() }),
            reach: Mutex::default(),
            held: Mutex::default(),
            told: Mutex::default(),
            statements: Mutex::default(),
            telling: Mutex::default(),
            unreached: Mutex::default(),
            asking: Mutex::default(),
            owed: Mutex::default(),
            wanted: Mutex::default(),
            offered: Mutex::default(),
            shelf,
            blob_peers: Mutex::default(),
            follows: Mutex::default(),
            unpacked: Mutex::default(),
            pieces: Mutex::default(),
            pool,
            changed: Notify::new(),
            size: watch::Sender::new(size),
            sent: Sent::default(),
            jobs: Jobs::default(),
            keeping: Mutex::default(),
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
        ];
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

    /// Whether its relay has let it in, waited for up to `RELAY_WAIT`: a node with no socket of its own, as a page's,
    /// reaches nobody before its relay lets it in, and a dial it sends sooner is lost and sent again ever later
    /// (`REDIAL`), so it waits for it first, as its `relay` step. At once for a node with a socket, or no relay. While
    /// iroh has picked no relay, it has it pick again every `RELAY_PICK`, by handing it its relay once more.
    pub async fn on_relay(&self) -> bool {
        let (opts, endpoint) = (&self.shared.opts, &self.shared.endpoint);
        let Some(relay) = opts.relay.as_ref().filter(|_| opts.bind.is_none() && !opts.direct) else { return true };
        opts.progress.step("relay");
        let end = Instant::now() + RELAY_WAIT;
        loop {
            let wait = end.saturating_duration_since(Instant::now()).min(RELAY_PICK);
            if time::timeout(wait, endpoint.online()).await.is_ok() {
                return true;
            }
            if Instant::now() >= end {
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
    /// another, one in each suite (`sign::Ceremony::passes`), until the peer hands a vault over: their vault may know
    /// their passkey in either (the key move). That passkey and the vault it joined.
    pub async fn link_with(
        &self,
        offer: &Offer,
        passes: &[RelayPass],
        authenticator: &impl Authenticator,
    ) -> Result<(SignerId, VaultId)> {
        self.linking(offer, passes, Joins::By(authenticator)).await
    }

    /// `link_with`, in the one ceremony that unlocked this device, `unlock`, which is the passkey's pass for it: that
    /// ceremony signs the edit adding the device too, as the pass (`sign::WebAuthn::Pass`), its PRF output making the
    /// SLH-DSA signature over the edit itself, so that a browser signs in to its person's vault in one ceremony. That
    /// passkey and the vault it joined.
    pub async fn link_by_pass(
        &self,
        offer: &Offer,
        passes: &[RelayPass],
        unlock: Ceremony,
    ) -> Result<(SignerId, VaultId)> {
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
        self.join_through(offer, passes, Joins::<InLab>::Pass(unlock), false).await
    }

    async fn linking<A: Authenticator>(
        &self,
        offer: &Offer,
        passes: &[RelayPass],
        joins: Joins<'_, A>,
    ) -> Result<(SignerId, VaultId)> {
        self.on_relay().await;
        self.shared.opts.progress.step("server");
        self.join_through(offer, passes, joins, true).await?.context("no vault of this passkey to join")
    }

    /// Join the vault a pass's passkey roots, through device `offer`, which hands over its log for the pass: `None`
    /// if it hands over none for any of `passes`, which it shows one after another, the next only if the peer handed
    /// nothing over for the one before (a pass in each suite, the key move). `linking` marks the pass step as it shows
    /// the passes; a device that founds its vault, only once the server handed one over.
    async fn join_through<A: Authenticator>(
        &self,
        offer: &Offer,
        passes: &[RelayPass],
        joins: Joins<'_, A>,
        linking: bool,
    ) -> Result<Option<(SignerId, VaultId)>> {
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
        let joining = self.shared.lab(move |lab, me| {
            lab.receive(me, edits, Vec::new());
            let at_hand = |p: &SignerId| lab.keys_of(*p).is_some();
            passkeys.into_iter().filter(at_hand).find_map(|p| Some((p, lab.joining(me, p).ok()?)))
        });
        let Some((passkey, joining)) = joining.await else { return Ok(None) };
        let id = match joining {
            (_, Some(id)) => id,
            (vault, None) => {
                progress.step("join");
                let add = move |lab: &mut Lab, me| {
                    lab.draft(me, &[passkey, me], Action::Share(Sharing::Device { vault, device: me, seal_to: None }))
                };
                let draft = self.shared.lab(add).await.map_err(|why| anyhow!("the join is refused: {why:?}"))?;
                let (draft, ceremony) = match joins {
                    Joins::By(authenticator) => {
                        let ceremony = authenticator.ceremony(draft.challenge(), Step::Join).await?;
                        (draft, ceremony)
                    }
                    Joins::Pass(unlock) => (draft.by_pass(pass.made), unlock),
                };
                let complete = move |lab: &mut Lab, me| lab.complete(me, draft, &[(passkey, &ceremony)]);
                self.shared.lab(complete).await.map_err(|why| anyhow!("the passkey didn't sign the join: {why:?}"))?
            }
        };
        let join = self.shared.lab(move |lab, me| lab.joined(me, id)).await;
        let Action::Share(Sharing::Device { vault, .. }) = join.edit.edit.action else {
            bail!("a join that adds no device")
        };
        let sent = session::exchange(&peer.conn, session::JOIN, &join.to_wire(), 0).await;
        sent.context("the peer refuses the join")?;
        self.shared.changed.notify_one();
        // what the peer keeps for the vault comes in the background, a `pull` job: nobody waits on it
        let (shared, endpoint) = (self.shared.clone(), peer.endpoint);
        task::spawn(async move { shared.ask(endpoint).await.ok() });
        Ok(Some((passkey, vault)))
    }

    /// `found_with`, with `passkey` a software passkey this device's Lab holds.
    pub async fn found(&self, offer: &Offer, passkey: SignerId) -> Result<(VaultId, VaultId)> {
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
        let sets = self.shared.lab(draft).await.map_err(|why| anyhow!("the vault is refused: {why:?}"))?;
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
        let endpoint = self.offered(offer).await?.endpoint;
        let server = offer.device;
        let key = match self.claim_key(offer).await {
            Ok(key) => key,
            Err(e) => {
                // a claim whose answer was lost: the server tells this device that it is avenCEO's already
                self.shared.ask(endpoint).await.ok();
                let claimed = self.shared.lab(move |lab, me| lab.server_vault_of(me, server)).await;
                return claimed.ok_or(e);
            }
        };
        // a claim tried again, after one the server didn't take, adds the server to the avenMAIA that one founded
        let unclaimed = self.shared.lab(|lab, me| lab.unclaimed_server(me)).await;
        self.add(offer, key, unclaimed.map_or(Place::Seed, Place::Vault), passkey, Step::Claim, authenticator).await
    }

    /// `add_device_vault_with`, the passkey `passkey` in this node's Lab, which makes its ceremony itself.
    pub async fn add_device_vault(&self, offer: &Offer, place: Place, passkey: SignerId) -> Result<(VaultId, VaultId)> {
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
        self.act(follow).await.map_err(|why| anyhow!("a new vault's standing grants are refused: {why:?}"))?;
        Ok((parent, vault))
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
        let human = self.shared.lab(|lab, me| lab.vault_of(me)).await.context("this device belongs to no vault")?;
        let device = offer.device;
        let draft = move |lab: &mut Lab, me| {
            let nonce = lab.nonce();
            let mut drafting = lab.drafting(me);
            add_device_vault(&mut drafting, passkey, human, place, nonce, device, key)?;
            Ok::<_, Refusal>(drafting.done())
        };
        let drafts = self.shared.lab(draft).await.map_err(|why| anyhow!("the device vault is refused: {why:?}"))?;
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
        let drafted = move |lab: &mut Lab, me| {
            let mut drafting = lab.drafting(me);
            let out = draft(&mut drafting, me)?;
            Ok::<_, Refusal>((out, drafting.done()))
        };
        let (out, drafts) = self.shared.lab(drafted).await.map_err(|why| anyhow!("refused: {why:?}"))?;
        self.sign(vec![(passkey, (), drafts)], false, Step::Approve, authenticator).await?;
        Ok(out)
    }

    /// The connection to the device `offer` names, once its hello proved it the device offered, or that device's next
    /// key once its key moved (the key move, K3c), as the server's offer the app and the agents carry names the key it
    /// started with: a device beside it in the vault it belongs to, by the logs its card brings, at the same endpoint,
    /// so from the same secret. Its person's devices signed it in, and it signed its joining itself.
    async fn offered(&self, offer: &Offer) -> Result<Peer> {
        self.know(offer.addr.clone());
        let endpoint = offer.addr.id;
        let peer = self.shared.connection(endpoint).await?;
        if peer.device != offer.device && !self.moved_from(offer.device, &peer).await {
            bail!("the device at {endpoint} isn't the one offered");
        }
        Ok(peer)
    }

    /// Whether `peer`'s device is the next key of device `earlier` (`offered`): a device beside it in a vault, by the
    /// logs `peer`'s card brings, as their endpoint is the same.
    async fn moved_from(&self, earlier: SignerId, peer: &Peer) -> bool {
        if self.shared.contact(peer.endpoint).await.is_err() {
            return false;
        }
        let next = peer.device;
        let beside = move |lab: &mut Lab, me| {
            let st = lab.state(me);
            st.vaults().iter().any(|v| v.devices.contains(&earlier) && v.devices.contains(&next))
        };
        self.shared.lab(beside).await
    }

    /// The next key of device `device` at `endpoint`, a server or an agent of an aven its person governs
    /// (`Lab::aven_devices`), as it hands it while its key hasn't moved yet (the key move, K3c, `Lab::move_key`), once
    /// its hello proved it that device. Fails if it isn't reached, or has no key to move.
    pub async fn next_key_of(&self, endpoint: EndpointId, device: SignerId) -> Result<SignerId> {
        let peer = self.shared.connection(endpoint).await?;
        if peer.device != device {
            bail!("the device at {endpoint} isn't the one asked");
        }
        let next = session::exchange(&peer.conn, session::NEXT_KEY, &[], 64).await;
        let next = next.context("it hands no next key: its key moved, or it runs a build from before the move")?;
        Ok(SignerId(<[u8; 32]>::try_from(&next[..]).context("a key's id")?))
    }

    /// Sends the device at `endpoint` the claim of its next key (`Lab::claim`, the key move, K3c), and keeps the join
    /// it answers with, which makes that key a device of its vault beside it, as the device signed it too
    /// (`Lab::accept_claim`). Then they sync.
    pub async fn send_move(&self, endpoint: EndpointId, claim: Claim) -> Result<()> {
        let peer = self.shared.connection(endpoint).await?;
        let id = claim.add.id();
        let Action::Share(Sharing::Device { vault, device: next, .. }) = claim.add.action else {
            bail!("a claim that adds no device")
        };
        let join = session::exchange(&peer.conn, session::CLAIM, &claim.to_wire(), session::REPLY_LIMIT).await;
        let Join { edit, blobs } = Join::from_wire(&join.context("the device refuses its key move")?)?;
        if edit.edit.id() != id {
            bail!("the device answered its key move with another edit");
        }
        let blobs = blobs.into_iter().map(Arc::from).collect();
        let kept = self.shared.lab(move |lab, me| {
            lab.receive(me, vec![edit], blobs);
            lab.state(me).is_device(next, vault)
        });
        if !kept.await {
            bail!("the device's join doesn't make its next key a device of its vault");
        }
        self.shared.changed.notify_one();
        self.shared.ask(peer.endpoint).await?;
        Ok(())
    }

    /// The avenMAIA the server `offer` names is a device of, by its card (`contact`): none while nobody has
    /// claimed it.
    async fn avenceo(&self, offer: &Offer) -> Result<Option<VaultId>> {
        self.offered(offer).await?;
        self.shared.contact(offer.addr.id).await.context("the server's card")?;
        let server = offer.device;
        Ok(self.shared.lab(move |lab, me| lab.server_vault_of(me, server)).await)
    }

    /// The key to seal to the server `offer` names hands while nobody has claimed it (`Lab::claim_key`).
    async fn claim_key(&self, offer: &Offer) -> Result<PublicKey> {
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
        let first = sets.first().and_then(|(_, _, drafts)| drafts.first());
        let challenge = first.context("nothing to sign")?.challenge();
        let signer = sets.first().map(|(p, _, _)| *p);
        let keys = self.shared.lab(move |lab, _| signer.and_then(|p| lab.keys_of(p))).await;
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
        let kept = self.shared.lab(keep).await.map_err(|why| anyhow!("the passkey didn't sign it all: {why:?}"))?;
        self.shared.changed.notify_one();
        Ok(kept)
    }

    /// Send the server `offer` names this device's claim of it (`sign`), and keep the join it answers with, which makes
    /// the server a device of avenCEO. Then they sync. avenCEO.
    async fn send_claim(&self, offer: &Offer, claim: Claim) -> Result<VaultId> {
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
        let kept = self.shared.lab(move |lab, me| {
            lab.receive(me, vec![edit], blobs);
            lab.server_vault_of(me, server)
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

    /// Act on its Lab as its device, as its app does: a write, a share, an edit. Then it tells its peers of whatever
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

    /// Act on its Lab as its device in a dry run (`Lab::dry`): every edit asked for is checked and refused as ever,
    /// and none is made, so its peers are told of nothing.
    pub async fn dry<T: Send + 'static>(&self, f: impl FnOnce(&mut Lab, SignerId) -> T + Send + 'static) -> T {
        self.shared.lab(|lab, me| lab.dry(|lab| f(lab, me))).await
    }

    /// Ask the device at endpoint `peer` now, whatever it announced: the edits and McEliece keys it may send this one.
    /// How many edits were new.
    pub async fn sync_with(&self, peer: EndpointId) -> Result<usize> {
        self.shared.ask(peer).await
    }

    /// Ask the device at endpoint `peer` now for the entries of the vaults `vaults` alone (`session::ASK_VAULTS`), and
    /// for the logs that are no entry's, the vaults', shares' and audiences', which say who may do what: what a node
    /// that asks only when told (`Options::lazy`) brings for a call that touches those vaults. How many edits were new.
    pub async fn bring(&self, peer: EndpointId, vaults: BTreeSet<VaultId>) -> Result<usize> {
        self.shared.asking(peer, Scope::Vaults(vaults)).await
    }

    /// Ask the device at endpoint `peer` now for the logs `logs` alone (`session::ASK_LOGS`), as an entry a call names
    /// that the node holds nothing of yet. How many edits were new.
    pub async fn bring_logs(&self, peer: EndpointId, logs: BTreeSet<LogId>) -> Result<usize> {
        self.shared.asking(peer, Scope::Logs(logs)).await
    }

    /// Mark the entry logs `logs` as what a page reads now: an asking of what a peer holds more of takes them before
    /// the other entries' (`Shared::ask_differing`), until one asked for them. Logs that are no entry's come first
    /// anyway.
    pub fn want(&self, logs: impl IntoIterator<Item = LogId>) {
        let entries = logs.into_iter().filter(|l| matches!(l, LogId::Entry(_)));
        self.shared.wanted.lock().expect("wanted").extend(entries);
    }

    /// Ask the device at endpoint `peer` for its contact card (`Lab::card`), as a device asks the server for its
    /// vault's log before a vault gives the server relay on its entries. How many edits were new.
    pub async fn contact(&self, peer: EndpointId) -> Result<usize> {
        self.shared.contact(peer).await
    }

    /// It takes and keeps at most what `limits` says (`limits`): the bytes of one edit, of one file it keeps whole,
    /// and of each person's backup by the cap group of Maia City they hold (`avendb::quota`). A node told nothing takes
    /// and keeps whatever its peers bring.
    pub fn limit(&self, limits: Limits) {
        self.shared.keeping.lock().expect("keeping").limits = limits;
        self.shared.changed.notify_one();
    }

    /// What it keeps for person `p`, the human vault whose backup it is, as it last weighed it (`limits::Usage`): none
    /// before it weighed it, or where it limits nobody.
    pub fn backup(&self, p: VaultId) -> Option<Usage> {
        self.shared.keeping.lock().expect("keeping").usage(p)
    }

    /// Its device, a server, takes a new vault from its peers only where it welcomes it, or again any (`Lab::gate`): a
    /// person's with the invite it claims, a coop or an aven an admin of the vault it serves owns.
    pub async fn gate(&self, on: bool) {
        self.shared.lab(move |lab, me| lab.gate(me, on)).await;
    }

    /// Claim the invite a link names for this device's vault, through the server `offer` names, which takes a new
    /// person's vault only with the invite it claims (`Lab::gate`): the server hands the invite, share `share`, to
    /// whoever names it (`Lab::invite_card`); the key made again from `secret`, the link's other half, and this device
    /// sign its claim (`Lab::claim_invite`), with no owner of the vault it is over signing; and this device hands the
    /// server the logs of its vault and the claim at once (`Lab::sign_up_card`), which the server takes. The key is
    /// forgotten once it signed. Fails if this device belongs to no vault, the server knows no such invite or a vault
    /// claimed it already, or the server takes the vault no more.
    pub async fn claim_invite(&self, offer: &Offer, share: ShareId, secret: [u8; 32]) -> Result<VaultId> {
        let peer = self.shared.connection(offer.addr.id).await?;
        let reply = session::exchange(&peer.conn, session::INVITE, &share.0, session::REPLY_LIMIT).await;
        let Reply { edits, .. } = Reply::from_wire(&reply.context("the server knows no such invite")?)?;
        let claim = move |lab: &mut Lab, me| -> Result<(VaultId, Vec<Signed>), Refusal> {
            lab.receive(me, edits, Vec::new());
            let vault = lab.vault_of(me).ok_or(Refusal::NotActing)?;
            // the key in each suite, as an invite made before the key move names it in SLH-DSA: the one it names signs
            let mut claimed = Err(Refusal::NoConsent);
            for suite in SUITES {
                let key = lab.invite_key_in(secret, suite);
                claimed = lab.claim_invite(me, share, vault, key);
                lab.lose(key);
                if claimed.is_ok() {
                    break;
                }
            }
            claimed?;
            Ok((vault, lab.sign_up_card(me)))
        };
        let (vault, edits) = self.shared.lab(claim).await.map_err(|why| anyhow!("the invite is refused: {why:?}"))?;
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
    /// logs don't. What a page's sync bar shows.
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
        json!({ "peers": heard.len(), "logs": logs.len(), "behind": behind.len(), "pulling": pulling, "pages": pages })
    }

    /// The devices it is connected to now, as their hellos proved them, each with how many logs it holds edits in that
    /// this device lacks (`differ`), as `synced` counts them, or `None` until it told what it holds: what a removal of
    /// keys waits for, as it cuts what rests on them that its drafter doesn't hold (T16; the key move's retire step).
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

    /// Its shelf lacks something its device holds (`edits`): its holdings name only what the shelf holds. Never, for a
    /// node with no shelf.
    pub async fn behind(&self) -> bool {
        let shared = self.shared.clone();
        self.shared.lab(move |lab, me| shared.edits.as_ref().is_some_and(|edits| edits.lacks(lab, me))).await
    }

    /// Close its connections, its endpoint and its blob store, which the router closes with the blob protocol; with a
    /// shelf, first put there what it lacks, if it can.
    pub async fn shutdown(&self) -> Result<()> {
        self.tasks.iter().for_each(JoinHandle::abort);
        match time::timeout(WAIT, self.shared.save()).await {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => tracing::warn!("avendb: stopping with the shelf behind: {e:#}"),
            Err(_) => tracing::warn!("avendb: stopping with the shelf behind: it took too long"),
        }
        self.router.shutdown().await?;
        Ok(())
    }
}

impl Drop for Node {
    fn drop(&mut self) {
        self.tasks.iter().for_each(JoinHandle::abort);
    }
}

/// Device `me` of `lab`, with what its shelf held taken back, if it held anything (`stored`), not checking again the
/// signatures of the edits `vouched`, from what it worked out before (`Lab::restore_warm`); and the ids of the edits
/// the shelf held, in its order.
fn restore(mut lab: Lab, me: SignerId, (signed, keys): edits::Stored, vouched: &HashSet<EditId>, warm: &Warm) -> (Lab, Vec<EditId>) {
    let stored = signed.iter().map(|s| s.edit.id()).collect();
    if !signed.is_empty() {
        lab.restore_warm(me, Backup::new(signed, keys), vouched, warm);
    }
    (lab, stored)
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
enum Scope {
    All,
    Logs(BTreeSet<LogId>),
    Vaults(BTreeSet<VaultId>),
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
    /// Its device's edits on its shelf, if it keeps one.
    edits: Option<edits::Edits>,
    endpoint: Endpoint,
    lookup: MemoryLookup,
    /// Its blob store: the McEliece keys it offers, and the sealed pieces of files (`files`).
    store: Store,
    opts: Options,
    /// The live connection to each peer, with the device its hello proved: whom the blob gate lets in.
    peers: Mutex<HashMap<EndpointId, Peer>>,
    /// A lock for each endpoint, held while dialing it, so that a node dials each peer once.
    dialing: Mutex<HashMap<EndpointId, Arc<tokio::sync::Mutex<()>>>>,
    /// Its device's edits by their logs, as they were when they were last worked out.
    logs: Mutex<Option<Arc<Logs>>>,
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
    /// The peers being told now.
    telling: Mutex<HashSet<SignerId>>,
    /// The peers it couldn't tell, and when to try each again.
    unreached: Mutex<Backoff<SignerId>>,
    /// The peers being asked, each with whether to ask it again once done.
    asking: Mutex<HashMap<EndpointId, bool>>,
    /// The peers whose asking failed, and when to ask each again.
    owed: Mutex<Backoff<EndpointId>>,
    /// The entry logs its pages asked for (`Node::want`): an asking of what a peer holds more of takes them first.
    wanted: Mutex<BTreeSet<LogId>>,
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
    /// The pieces of the files whose HashSeq it holds, each with the files it is a piece of: what the gate hands out
    /// as those files.
    pieces: Mutex<HashMap<iroh_blobs::Hash, BTreeSet<avendb::sealed::FileRoot>>>,
    /// Its blob connections to its peers, for the files and McEliece keys it fetches.
    pool: ConnectionPool,
    /// Woken whenever the node's logs may have changed.
    changed: Notify,
    /// How many edits and McEliece keys its device holds (`Node::changes`).
    size: watch::Sender<(usize, usize)>,
    /// How many messages it has sent.
    sent: Sent,
    /// What it does in the background, as its person watches it (`Node::jobs`).
    jobs: Jobs,
    /// What it takes and keeps at most, and what it keeps for each person (`Node::limit`, `limits`).
    keeping: Mutex<limits::Keeping>,
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

/// What a node's device holds for good (`Holdings`), its logs as worked out when it held as much as `at` says: its
/// size (`Lab::size`), and how many of its edits its shelf held (`edits::Edits::held`).
struct Own {
    at: ((usize, usize), usize),
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
    reach: Arc<BTreeMap<SignerId, Reach>>,
    /// The passkeys that root the vaults in the device's view, whose passes a server's relay honours.
    roots: Vec<SignerId>,
    /// The node is a server whose device belongs to no vault yet: nobody has claimed it.
    claimable: bool,
    /// The invites of Maia City no vault claimed yet, whose passes a server's relay honours while it signs people up
    /// by invite.
    invites: Vec<ShareId>,
}

impl Shared {
    /// `f` on the Lab, off the async threads: its crypto takes milliseconds, a McEliece key pair seconds. The Lab's
    /// clock is the machine's, so an entry `f` creates says when (`Lab::set_now`). If what the device holds changed,
    /// its saver puts it on the shelf, if the node keeps one. A panic in `f`, a bug, fails the call that asked for it
    /// alone: it is caught while the Lab is still locked, so the lock isn't poisoned and every later call runs, logged,
    /// and carried on to the caller once the lock is let go.
    async fn lab<T: Send + 'static>(self: &Arc<Self>, f: impl FnOnce(&mut Lab, SignerId) -> T + Send + 'static) -> T {
        let shared = self.clone();
        let work = move || {
            let mut lab = shared.locked_lab();
            let ran = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                lab.set_now(unix_now());
                let out = f(&mut lab, shared.me);
                let now = lab.size(shared.me);
                if shared.size.send_if_modified(|size| *size != now && { *size = now; true }) {
                    shared.edits.iter().for_each(|edits| edits.due.notify_one());
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
        return tokio::task::spawn_blocking(work).await.expect("the Lab's task");
        // a page's node runs in a worker of its own, which the Lab may hold up
        #[cfg(target_arch = "wasm32")]
        work()
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
        let lock = self.dialing.lock().expect("dialing").entry(endpoint).or_default().clone();
        let _dialing = lock.lock().await;
        if let Some(peer) = self.live(endpoint) {
            return Ok(peer);
        }
        self.sent.dials.fetch_add(1, Ordering::Relaxed);
        let conn = time::timeout(WAIT, self.dial(endpoint)).await.context("no answer")??;
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

    /// A connection to `endpoint`: a dial, and a new one beside it every `REDIAL` while none has connected, the first
    /// that connects kept and the others dropped; or the error of the first that fails, which the peer answered.
    async fn dial(&self, endpoint: EndpointId) -> Result<Connection> {
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

    /// A connection whose hellos proved `device`, dialed or accepted: the one to its endpoint from now on, which its
    /// blob connections reach too, through the node's relay if it has one. A new connection starts their talk over:
    /// the node tells the peer all its holdings again, at once.
    fn connected(&self, conn: Connection, device: SignerId) -> Peer {
        let endpoint = conn.remote_id();
        let peer = Peer { conn, device, endpoint };
        if self.opts.relay.is_some() {
            self.lookup.add_endpoint_info(self.addr_of(endpoint));
        }
        self.peers.lock().expect("peers").insert(endpoint, peer.clone());
        self.told.lock().expect("told").remove(&device);
        self.unreached.lock().expect("unreached").reached(&device);
        self.changed.notify_one();
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
        let peer = self.connection(endpoint).await?;
        let mut job = self.jobs.begin("pull", peer.device.to_hex(), String::new(), 0, "edits");
        let asked = self.pages(endpoint, peer, scope, &mut job).await;
        // what its pages brought, brought up to date once more, however the asking ended
        if self.lab(|lab, me| lab.catch_up(me)).await {
            self.changed.notify_one();
        }
        if matches!(asked, Ok(0)) { job.forget() } else { job.ended(&asked) }
        asked
    }

    /// `asking` of `peer`, connected at `endpoint`: page after page, each told to `job`, with how many of the edits it
    /// took are each vault's and each entry's.
    async fn pages(
        self: &Arc<Self>,
        endpoint: EndpointId,
        peer: Peer,
        scope: Scope,
        job: &mut Running,
    ) -> Result<usize> {
        let device = peer.device;
        let kind = match scope {
            Scope::All => session::REQUEST,
            Scope::Logs(_) => session::ASK_LOGS,
            Scope::Vaults(_) => session::ASK_VAULTS,
        };
        let scope = Arc::new(scope);
        let (mut after, mut new, mut pages) = (None, 0, 0);
        let (mut vaults, mut entries) = (BTreeMap::<String, u64>::new(), BTreeMap::<String, u64>::new());
        loop {
            let scope = scope.clone();
            let request = move |lab: &mut Lab, me| {
                let request = lab.request(me, device);
                match &*scope {
                    Scope::All => Request { after, ..request }.to_wire(),
                    Scope::Logs(logs) => Request { after, ..session::only(lab, me, request, logs) }.to_wire(),
                    Scope::Vaults(vaults) => {
                        let request = Request { after, ..session::of_vaults(lab, me, request, vaults) };
                        session::vaults_body(vaults, &request)
                    }
                }
            };
            let request = self.lab(request).await;
            let reply = time::timeout(PAGE_WAIT, self.reply_to(&peer, kind, &request)).await;
            let Reply { mut edits, blobs, more } = reply.context("no page in time")??;
            self.sized(&mut edits);
            self.sent.requests.fetch_add(1, Ordering::Relaxed);
            // where the next page starts: a page that brings nothing past the last ends the asking
            let last = edits.iter().map(|s| place(&s.edit)).max().filter(|&l| after.is_none_or(|a| l > a));
            let lacking = move |lab: &mut Lab, me| -> Vec<BlobId> {
                blobs.into_iter().filter(|b| lab.blob(me, *b).is_none()).collect()
            };
            let lacking = self.lab(lacking).await;
            let keys = self.fetch(endpoint, lacking).await;
            let fetched = !keys.is_empty();
            // its keys and items brought up to date every few pages and at the last, not at each (`CATCH_UP`)
            let now = !more || (pages + 1) % CATCH_UP == 0;
            let (got, whose) = self.lab(move |lab, me| lab.receive_whose_now(me, edits, keys, now)).await;
            if now && (got > 0 || fetched || new > 0) {
                self.changed.notify_one();
            }
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
            match last {
                Some(last) if more => after = Some(last),
                _ => return Ok(new),
            }
        }
    }

    /// The reply of the peer on `peer`'s connection to the message of kind `kind` with body `request`, packed, each
    /// ML-DSA-65 key its signatures carry once (K5, `session::PACKED`), where the peer's node takes that; else whole,
    /// as a node from before K5 answers, asked again without it, and from then on on that connection.
    async fn reply_to(&self, peer: &Peer, kind: u8, request: &[u8]) -> Result<Reply> {
        let (id, limit) = (peer.conn.stable_id(), session::REPLY_LIMIT);
        let packs = !self.unpacked.lock().expect("unpacked").contains(&id);
        if packs {
            let packed = session::exchange(&peer.conn, kind | session::PACKED, request, limit).await;
            if let Ok(Ok(Packed(reply))) = packed.map(|bytes| Packed::from_wire(&bytes)) {
                return Ok(reply);
            }
        }
        let reply = Reply::from_wire(&session::exchange(&peer.conn, kind, request, limit).await?)?;
        if packs {
            self.unpacked.lock().expect("unpacked").insert(id);
        }
        Ok(reply)
    }

    /// Asks `endpoint` for its contact card, and takes its vault logs. How many edits were new.
    async fn contact(self: &Arc<Self>, endpoint: EndpointId) -> Result<usize> {
        let peer = self.connection(endpoint).await?;
        let reply = session::exchange(&peer.conn, session::CARD, &[], session::REPLY_LIMIT).await?;
        let Reply { mut edits, .. } = Reply::from_wire(&reply)?;
        // a card carries vault logs, and nothing else
        edits.retain(of_a_vault);
        self.sized(&mut edits);
        let new = self.lab(move |lab, me| lab.receive(me, edits, Vec::new())).await;
        if new > 0 {
            self.changed.notify_one();
        }
        Ok(new)
    }

    /// Asks `endpoint` soon for the logs where the device there holds what this one lacks, by what it told (`differ`),
    /// and once more after the asking under way if there is one; if the asking fails, again once its wait is over
    /// (`Backoff`).
    fn ask_soon(self: &Arc<Self>, endpoint: EndpointId) {
        if self.opts.lazy || !self.start_asking(endpoint) {
            return;
        }
        let shared = self.clone();
        task::spawn(async move {
            loop {
                let asked = shared.ask_differing(endpoint).await.is_ok();
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

    /// Tells the peers what changed of its holdings whenever they may have, and every `retry` tries again the peers
    /// whose wait is over: those it couldn't tell, and those it failed to ask.
    async fn announcer(self: Arc<Self>) {
        let mut news =
            News { size: (usize::MAX, 0), reach: Arc::default(), roots: Vec::new(), claimable: false, invites: Vec::new() };
        loop {
            if let Some(fresh) = self.news(news.size).await {
                news = fresh;
            }
            self.own_logs().await;
            self.announce(&news);
            self.state(&news.reach);
            let owed = self.owed.lock().expect("owed").ready();
            owed.into_iter().for_each(|endpoint| self.ask_soon(endpoint));
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
    async fn news(self: &Arc<Self>, size: (usize, usize)) -> Option<News> {
        let (server, shared) = (self.opts.card, self.clone());
        let news = self
            .lab(move |lab, me| {
                let now = lab.size(me);
                if now == size {
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
                Some(News { size: now, reach: Arc::new(reach), roots: lab.roots(me), claimable, invites })
            })
            .await?;
        *self.reach.lock().expect("reach") = news.reach.clone();
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
        match &*logs {
            Some(known) if known.size == size => known.clone(),
            _ => {
                let log = lab.log(me);
                let fresh = Arc::new(Logs::of(log.edits(), log.ids(), size));
                *logs = Some(fresh.clone());
                fresh
            }
        }
    }

    /// Works out again what its device holds for good of each log, if its edits or what its shelf holds of them
    /// changed: the frontier of the edits its shelf holds, the first of its log (`edits::Edits::held`), or with no
    /// shelf, of all it holds.
    async fn own_logs(self: &Arc<Self>) {
        let shared = self.clone();
        let worked = self
            .lab(move |lab, me| {
                let size = lab.size(me);
                let held = shared.edits.as_ref().map_or(size.0, |edits| edits.held(lab, me));
                if shared.own.lock().expect("own").at == (size, held) {
                    return None;
                }
                let logs = match held >= size.0 {
                    true => shared.logs_of(lab, me).frontiers(),
                    false => {
                        let log = lab.log(me);
                        Logs::of(&log.edits()[..held], &log.ids()[..held], size).frontiers()
                    }
                };
                Some(((size, held), logs))
            })
            .await;
        if let Some((at, logs)) = worked {
            let mut own = self.own.lock().expect("own");
            (own.at, own.holdings.logs) = (at, logs);
        }
    }

    /// Tells each peer what of the node's holdings it may know by the node's view, if that changed since it was last
    /// told, or it is on a new connection, each on a task of its own, so that a peer out of reach holds up nobody; one
    /// at a time, so that tasks don't pile up while it stays out of reach; and a peer it couldn't reach, only once its
    /// wait is over.
    fn announce(self: &Arc<Self>, news: &News) {
        let own = self.own.lock().expect("own").holdings.clone();
        let told = self.told.lock().expect("told").clone();
        for (device, reach) in news.reach.iter() {
            let want = own.only(&reach.logs, &reach.files);
            let live = self.live(reach.endpoint).map(|p| p.conn.stable_id());
            let due = told.get(device).is_none_or(|(on, was)| *was != want || live.is_some_and(|id| id != *on));
            if !due || !self.unreached.lock().expect("unreached").due(device) {
                continue;
            }
            if !self.telling.lock().expect("telling").insert(*device) {
                continue;
            }
            let (shared, device, endpoint) = (self.clone(), *device, reach.endpoint);
            task::spawn(async move {
                let told = shared.tell(device, endpoint, want).await.is_ok();
                let mut unreached = shared.unreached.lock().expect("unreached");
                if told { unreached.reached(&device) } else { unreached.failed(device, shared.opts.retry) };
                drop(unreached);
                shared.telling.lock().expect("telling").remove(&device);
            });
        }
    }

    /// Tells `device`, at `endpoint`, that it holds `want`: all of it on a connection it told nothing yet, else what
    /// changed since it last told it, if anything did. Whichever key the device at `endpoint` goes by, as its hello
    /// proves it: one secret makes one endpoint, so it is `device`, or across a key move its earlier or next key
    /// (`Lab::peers`), as a server whose key moved goes by its earlier key until it starts again (K3c).
    async fn tell(self: &Arc<Self>, device: SignerId, endpoint: EndpointId, want: Holdings) -> Result<()> {
        let peer = self.connection(endpoint).await?;
        let on = peer.conn.stable_id();
        let told = self.told.lock().expect("told").get(&device).filter(|(at, _)| *at == on).map(|(_, h)| h.clone());
        if let Some(announce) = want.since(told.as_ref()) {
            session::exchange(&peer.conn, session::ANNOUNCE, &announce.to_wire(), 0).await?;
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
    fn hear(&self, device: SignerId, announce: Announce) {
        let mut held = self.held.lock().expect("held");
        let holdings = held.entry(device).or_default();
        holdings.take(announce);
        if holdings.logs.len() > MOST || holdings.files.len() > MOST {
            held.remove(&device);
        }
    }

    /// The connection of `peer` closed: what its device told the node it holds is kept, unless the node's device
    /// doesn't know that device (`Lab::peers`) and it isn't connected any more. What it follows goes.
    fn gone(&self, peer: &Peer) {
        self.follows.lock().expect("follows").remove(&peer.conn.stable_id());
        self.unpacked.lock().expect("unpacked").remove(&peer.conn.stable_id());
        let known = self.reach.lock().expect("reach").contains_key(&peer.device);
        if !known && self.live(peer.endpoint).is_none() {
            self.held.lock().expect("held").remove(&peer.device);
        }
    }

    /// The logs where `device` holds an edit this node's device lacks, by what it told (`Logs::lacks`). Of the logs the
    /// node holds, only those the device may hold by the node's view (`Reach`, worked out again where it may have grown
    /// since), as `synced_to` reads them: a claim to any other steers nothing, and learns nothing of what the node
    /// holds of it. A log the node holds nothing of, which its view can't place, it asks for naming nothing of it
    /// (`session::only`), as its request on a new connection does: else it would never learn of a new entry. A device
    /// the view doesn't know, on the endpoint of one it knows, is that one's next key, whose key move the node lacks
    /// yet (`Lab::peers`: one secret, one endpoint): it may hold what that one may, so the node asks it for the move
    /// too, as it never would otherwise (Samuel's Mac 2026-10-20 moved while the server was away, and nobody learned).
    async fn differ(self: &Arc<Self>, device: SignerId) -> BTreeSet<LogId> {
        let Some(theirs) = self.held.lock().expect("held").get(&device).map(|h| h.logs.clone()) else {
            return BTreeSet::new();
        };
        let (shared, known) = (self.clone(), self.reach.lock().expect("reach").clone());
        let earlier = || {
            let endpoint = self.endpoint_of(device)?;
            known.iter().find(|(_, r)| r.endpoint == endpoint).map(|(d, _)| *d)
        };
        let device = if known.contains_key(&device) { device } else { earlier().unwrap_or(device) };
        self.lab(move |lab, me| {
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
    }

    /// The endpoint of the live connection whose hellos proved `device`, if there is one.
    fn endpoint_of(&self, device: SignerId) -> Option<EndpointId> {
        let peers = self.peers.lock().expect("peers");
        peers.values().find(|p| p.device == device && p.conn.close_reason().is_none()).map(|p| p.endpoint)
    }

    /// Asks `endpoint` for the logs where the device there holds what this one lacks (`differ`), and those alone, if
    /// there are any. How many edits were new.
    ///
    /// A batch at a time (`next_logs`): first every log that is no entry's, the vaults', shares' and audiences', which
    /// say who may do what; then the entry logs its pages asked for (`wanted`), as they stand when each batch starts;
    /// then the rest, `LOGS_AT_ONCE` at a time, so that the entries come whole a batch after another.
    async fn ask_differing(self: &Arc<Self>, endpoint: EndpointId) -> Result<usize> {
        let peer = self.connection(endpoint).await?;
        let mut left = self.differ(peer.device).await;
        let mut new = 0;
        loop {
            let logs = {
                let mut wanted = self.wanted.lock().expect("wanted");
                let logs = next_logs(&mut left, &wanted, LOGS_AT_ONCE);
                wanted.retain(|l| !logs.contains(l));
                logs
            };
            if logs.is_empty() {
                return Ok(new);
            }
            new += self.asking(endpoint, Scope::Logs(logs)).await?;
        }
    }

    /// `Node::synced_to`: this device and each device on a live connection or of which the node keeps no statement, by
    /// what it announced (H1), and each other device by its newest statement, with when it checked (H2).
    async fn synced_to(self: &Arc<Self>) -> SyncedTo {
        self.own_logs().await;
        let own = self.own.lock().expect("own").holdings.clone();
        let mut held: BTreeMap<SignerId, (Holdings, Option<u64>)> = {
            let held = self.held.lock().expect("held");
            held.iter().map(|(d, h)| (*d, (h.clone(), None))).collect()
        };
        held.extend(self.stated().into_iter().map(|(d, (h, checked))| (d, (h, Some(checked)))));
        let reach = self.reach.lock().expect("reach").clone();
        let shared = self.clone();
        self.lab(move |lab, me| {
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
            for l in all.of.keys() {
                let LogId::Entry(entry) = *l else { continue };
                let of = |h: &Holdings, r: Option<&Reach>| {
                    let f = h.logs.get(l).filter(|_| r.is_none_or(|r| r.logs.contains(l)))?;
                    Some(all.held(edits, l, f))
                };
                synced.entries.insert(entry, list(&of));
            }
            for f in lab.files(me) {
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

/// The logs of `left` to ask for next, taken out of it (`Shared::ask_differing`): every log that is no entry's, if any is
/// left; else the entry logs of `wanted` left, at most `most`; else at most `most` others. None once `left` is empty.
fn next_logs(left: &mut BTreeSet<LogId>, wanted: &BTreeSet<LogId>, most: usize) -> BTreeSet<LogId> {
    let rules: BTreeSet<LogId> = left.iter().filter(|l| !matches!(l, LogId::Entry(_))).copied().collect();
    let next = if !rules.is_empty() {
        rules
    } else {
        let first: BTreeSet<LogId> = left.intersection(wanted).take(most).copied().collect();
        if first.is_empty() { left.iter().take(most).copied().collect() } else { first }
    };
    left.retain(|l| !next.contains(l));
    next
}

#[cfg(test)]
mod tests {
    use super::*;
    use avendb::id::EntryId;

    /// An offer with an address of each family and a relay.
    fn offer() -> Offer {
        let addr = EndpointAddr::new(SecretKey::from_bytes(&[3; 32]).public())
            .with_ip_addr("192.0.2.7:7401".parse().expect("an address"))
            .with_ip_addr("[2001:db8::7]:7401".parse().expect("an address"))
            .with_relay_url("https://avendb.maia.city".parse().expect("a URL"));
        Offer { device: SignerId([5; 32]), addr }
    }

    #[test]
    fn the_logs_that_say_who_may_do_what_come_first_then_the_wanted_entries_then_the_rest_in_batches() {
        let entry = |i: u8| LogId::Entry(EntryId([i; 32]));
        let mut left: BTreeSet<LogId> = (1..=5).map(entry).collect();
        left.extend([LogId::Vault(VaultId([9; 32])), LogId::Share(ShareId([8; 32]))]);
        let wanted: BTreeSet<LogId> = [entry(4), entry(7)].into();
        // the vault's and the share's log, however many
        let rules = next_logs(&mut left, &wanted, 1);
        assert_eq!(rules, [LogId::Vault(VaultId([9; 32])), LogId::Share(ShareId([8; 32]))].into());
        // the wanted entry left, then the others two at a time, until none is left
        assert_eq!(next_logs(&mut left, &wanted, 2), [entry(4)].into());
        assert_eq!(next_logs(&mut left, &wanted, 2), [entry(1), entry(2)].into());
        assert_eq!(next_logs(&mut left, &wanted, 2), [entry(3), entry(5)].into());
        assert!(next_logs(&mut left, &wanted, 2).is_empty() && left.is_empty());
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
        assert!(closed.honours_with(&known, None) && !closed.honours_with(&stranger, Some(open)), "closed: known alone");
        assert!(Admission::open().honours_with(&stranger, None), "open to anyone");
        let unclaimed = Admission::invited();
        unclaimed.set(Admitted { claimable: true, ..Admitted::default() });
        assert!(unclaimed.honours_with(&stranger, None), "while nobody has claimed the server, any");
    }
}
