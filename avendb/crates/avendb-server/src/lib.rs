//! avenDB's server (P8b), as its binary runs it: its node (`avendb_net::server`) in a folder of its own, holding only
//! ciphertext, and beside it its relay, through which devices with no UDP of their own reach the server and each
//! other. The relay lets in only the devices the node knows (`Admission`): the devices of the vaults acting for the
//! vaults it relays, and the node itself; and it lets go of a device the node stops knowing, as when the device is
//! taken out of its vault. A new device with no UDP of its own, as a browser's, which the node can't know before it
//! joined, shows a pass its person's passkey signed (P8d, `avendb::sign::RelayPass`): the relay lets it in for ten
//! minutes if the passkey roots a vault the node knows, long enough to link, and lets it go once its pass runs out,
//! unless by then the node knows it. While sign-up is open (P8e, `Config::signup`), it honours a pass of any passkey,
//! so that a person's first device, a browser, founds their vault and makes it known to the server in those minutes.
//!
//! A new server belongs to no vault (P8f). The first human vault to claim it owns it (`avendb_net::Node::claim`), as a
//! person's first device founds their vault through it (`avendb_net::Node::found_with`): the server becomes a device of
//! avenMAIA, the aven Maia City owns, of the seed that human vault founds in the same ceremony, and
//! acts as it without ever governing it. Until then its relay honours a pass of any passkey, so that the claiming
//! device may be a browser; once claimed, nobody claims it again.
//!
//! The relay serves plain HTTP. TLS ends in front of it, at a proxy that must offer X25519MLKEM768, as every device's
//! TLS offers nothing else (`avendb_net::pq_provider`); and as iroh's relay path is `/relay`, the relay wants a host
//! name of its own. Where it is deployed is said in `README.md`, under "Deploying the server".
//!
//! The node's shelf (v8 phase S, `avendb_net::shelf`) is its bucket (`Config::bucket`), every object sealed under the
//! server's seal (`avendb_net::bucket`), its folder only a cache: the server tells its peers of an edit only once the
//! bucket has it, and a server whose folder is lost starts again from the bucket alone, as the same device. Without a
//! bucket, its shelf is its folder (`avendb_net::disk`).
//!
//! Beside them, the Maia Universe's feed (`feed`): the posts the server keeps that everyone may read, the pictures they
//! show, and every entry everyone may read, the code among them, views, logic, recipes, functions and configs, Maia
//! City's told apart, each listed or whole, as JSON over plain HTTP on a socket of its own, behind the same proxy at
//! avendb.maia.city/feed/.

pub mod backups;
pub mod bucket;
pub mod feed;

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::backup::Keep;
use avendb::id::SignerId;
use avendb::sign::RelayPass;
use avendb_net::bucket::Sealed;
use avendb_net::{Admission, Node, Offer, Options, server, token_passes};
use data_encoding::HEXLOWER_PERMISSIVE;
use iroh::{EndpointAddr, EndpointId, RelayUrl};
use iroh_relay::server::{
    Access, AccessControl, ClientRequest, ConnectionId, RelayConfig, RelayService, Server, ServerConfig,
};
use tokio::sync::Notify;
use tokio::task::JoinHandle;
use zeroize::Zeroizing;

/// How the server runs, as its environment says.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    /// Its folder (`AVENDB_DATA`, `/data` by default): its shelf, with its device's secret and its edits, or, beside a
    /// bucket, only a cache.
    pub data: PathBuf,
    /// The UDP socket its node binds (`AVENDB_BIND`, `0.0.0.0:7401`), where devices on UDP reach it straight.
    pub bind: SocketAddr,
    /// The socket its relay serves plain HTTP on (`AVENDB_RELAY_BIND`, `0.0.0.0:3350`), behind the proxy.
    pub relay_bind: SocketAddr,
    /// The socket the Maia Universe's feed is served on, over plain HTTP (`AVENDB_FEED_BIND`, `0.0.0.0:3351`), behind
    /// the proxy (`feed`).
    pub feed_bind: SocketAddr,
    /// Where devices reach its relay (`AVENDB_RELAY_URL`, such as `https://avendb.maia.city`); if unsaid, the relay's
    /// own socket, for devices on the server's machine.
    pub relay_url: Option<RelayUrl>,
    /// Where devices on UDP reach its node from the internet (`AVENDB_PUBLIC_ADDR`, the server's IP and port 7401),
    /// as its offer says; if unsaid, the addresses of its own network interfaces, which in a container are the
    /// container's.
    pub public_addr: Option<SocketAddr>,
    /// Sign-up is open (`AVENDB_SIGNUP`, `open` by default, or `closed`): its relay lets in, for ten minutes, a device
    /// whose pass any passkey signed (`avendb_net::Admission::open`), not only one whose passkey roots a vault the
    /// server knows. A device on UDP reaches the server without the relay anyway.
    pub signup: bool,
    /// It takes a new vault only where it welcomes it (`AVENDB_GATE`, `off` by default, or `on`; `avendb::gate`): a
    /// person's only with the invite of the vault it serves it claims, a coop or an aven only where an admin of that
    /// vault owns it. Until its first human vault claims it, it serves no vault, and takes any.
    pub gate: bool,
    /// The bucket that is its shelf (`AVENDB_BUCKET` and the rest of `BucketConfig`), if any; else its folder is.
    pub bucket: Option<BucketConfig>,
    /// The most bytes of the files in its bucket its folder caches (`AVENDB_CACHE`, in gigabytes, 8 by default).
    pub cache: u64,
    /// The bucket of snapshots of every vault it keeps (`AVENDB_SNAPSHOTS` and the rest of `SnapshotsConfig`), if any;
    /// else it backs nothing up.
    pub snapshots: Option<SnapshotsConfig>,
}

/// The server's backups (`backups`, `docs/BACKUP.md`): the bucket of snapshots, with a folder for each vault, when
/// each day it backs up every vault, and how much of it each day's check reads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotsConfig {
    /// The bucket (`AVENDB_SNAPSHOTS`, its name), at `AVENDB_SNAPSHOTS_ENDPOINT` and `AVENDB_SNAPSHOTS_REGION`, with
    /// the key `AVENDB_SNAPSHOTS_ACCESS_KEY` and `AVENDB_SNAPSHOTS_SECRET_KEY`, each the server's bucket's if unsaid;
    /// each folder sealed under a key derived from the server's seal (`AVENDB_BUCKET_SEAL`) and its vault.
    pub bucket: BucketConfig,
    /// When each day it backs up every vault (`AVENDB_SNAPSHOTS_AT`, `03:00` by default), in seconds into the day, UTC.
    pub at: u64,
    /// The folder where what it puts in the bucket is staged and what it reads cached (`AVENDB_SNAPSHOTS_DIR`,
    /// `avendb-snapshots` in the system's temporary folder by default): not the server's own, which holds its shelf.
    pub dir: PathBuf,
    /// In how many days the check after each day's backup reads every blob of the files once, a few each day
    /// (`AVENDB_SNAPSHOTS_READ_DAYS`, 30 by default; 0 reads none, `avendb_net::backup::Reading`).
    pub read_days: u64,
}

/// The bucket that is the server's shelf (blobs B3a), its folder only a cache of it.
#[derive(Clone, PartialEq, Eq)]
pub struct BucketConfig {
    /// Its name (`AVENDB_BUCKET`).
    pub name: String,
    /// Its S3 endpoint (`AVENDB_BUCKET_ENDPOINT`, such as `https://hel1.your-objectstorage.com`).
    pub endpoint: String,
    /// Its region (`AVENDB_BUCKET_REGION`, such as `hel1`).
    pub region: String,
    /// The S3 key the server signs its requests with (`AVENDB_BUCKET_ACCESS_KEY` and `AVENDB_BUCKET_SECRET_KEY`).
    pub access_key: String,
    pub secret_key: String,
    /// The seal every object is sealed under (`AVENDB_BUCKET_SEAL`, 64 hex digits): without it, nothing in the bucket
    /// opens, and with another, the server doesn't start.
    pub seal: Zeroizing<[u8; 32]>,
}

impl fmt::Debug for BucketConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut config = f.debug_struct("BucketConfig");
        config.field("name", &self.name).field("endpoint", &self.endpoint).field("region", &self.region);
        config.finish_non_exhaustive()
    }
}

impl Config {
    /// As the process's environment says.
    pub fn from_env() -> Result<Config> {
        Config::from_vars(|name| std::env::var(name).ok())
    }

    /// As `var` says each variable is; an empty one is unsaid.
    pub fn from_vars(var: impl Fn(&str) -> Option<String>) -> Result<Config> {
        let var = |name: &str| var(name).filter(|v| !v.is_empty());
        let socket = |name: &str, default: &str| -> Result<SocketAddr> {
            let v = var(name).unwrap_or_else(|| default.to_string());
            v.parse().with_context(|| format!("{name}: {v} is no socket address"))
        };
        let url = |v: String| v.parse().with_context(|| format!("AVENDB_RELAY_URL: {v} is no URL"));
        Ok(Config {
            data: var("AVENDB_DATA").map_or_else(|| PathBuf::from("/data"), PathBuf::from),
            bind: socket("AVENDB_BIND", "0.0.0.0:7401")?,
            relay_bind: socket("AVENDB_RELAY_BIND", "0.0.0.0:3350")?,
            feed_bind: socket("AVENDB_FEED_BIND", "0.0.0.0:3351")?,
            relay_url: var("AVENDB_RELAY_URL").map(url).transpose()?,
            public_addr: var("AVENDB_PUBLIC_ADDR").map(|v| v.parse()).transpose().context("AVENDB_PUBLIC_ADDR")?,
            signup: match var("AVENDB_SIGNUP").as_deref() {
                None | Some("open") => true,
                Some("closed") => false,
                Some(v) => return Err(anyhow!("AVENDB_SIGNUP: {v} is neither open nor closed")),
            },
            gate: match var("AVENDB_GATE").as_deref() {
                None | Some("off") => false,
                Some("on") => true,
                Some(v) => return Err(anyhow!("AVENDB_GATE: {v} is neither on nor off")),
            },
            bucket: var("AVENDB_BUCKET").map(|name| bucket_config(name, &var)).transpose()?,
            cache: match var("AVENDB_CACHE") {
                Some(v) => v.parse::<u64>().map(|g| g << 30).with_context(|| format!("AVENDB_CACHE: {v} isn't one"))?,
                None => avendb_net::bucket::CACHE,
            },
            snapshots: var("AVENDB_SNAPSHOTS").map(|name| snapshots_config(name, &var)).transpose()?,
        })
        .and_then(Config::checked)
    }

    /// It, if its buckets are two: the snapshots live apart from what they back up.
    fn checked(self) -> Result<Config> {
        if let (Some(b), Some(s)) = (&self.bucket, &self.snapshots)
            && (b.name == s.bucket.name && b.endpoint == s.bucket.endpoint)
        {
            bail!("AVENDB_SNAPSHOTS: {} is the server's own bucket; snapshots go into a bucket of their own", b.name);
        }
        Ok(self)
    }
}

/// The bucket of snapshots named `name`, as `var` says the rest of it is: what it doesn't say, as the server's bucket
/// is, and the server's seal, which must be said.
fn snapshots_config(name: String, var: &impl Fn(&str) -> Option<String>) -> Result<SnapshotsConfig> {
    // each part as the server's bucket's, unless its own is said; the seal the server's alone
    let mine = |n: &str| match n.strip_prefix("AVENDB_BUCKET_").filter(|part| *part != "SEAL") {
        Some(part) => var(&format!("AVENDB_SNAPSHOTS_{part}")).or_else(|| var(n)),
        None => var(n),
    };
    let bucket = bucket_config(name, &mine).context("AVENDB_SNAPSHOTS, the bucket of snapshots")?;
    let at = match var("AVENDB_SNAPSHOTS_AT") {
        Some(v) => backups::time_of_day(&v).with_context(|| format!("AVENDB_SNAPSHOTS_AT: {v} is no HH:MM"))?,
        None => 3 * 3600,
    };
    let dir = var("AVENDB_SNAPSHOTS_DIR").map_or_else(|| std::env::temp_dir().join("avendb-snapshots"), PathBuf::from);
    let read_days = match var("AVENDB_SNAPSHOTS_READ_DAYS") {
        Some(v) => v.trim().parse().with_context(|| format!("AVENDB_SNAPSHOTS_READ_DAYS: {v} is no number of days"))?,
        None => 30,
    };
    Ok(SnapshotsConfig { bucket, at, dir, read_days })
}

/// The bucket named `name`, as `var` says the rest of it is: every part must be said.
fn bucket_config(name: String, var: &impl Fn(&str) -> Option<String>) -> Result<BucketConfig> {
    let said = |n: &str| var(n).with_context(|| format!("{n}: unsaid, with AVENDB_BUCKET said"));
    let seal = Zeroizing::new(said("AVENDB_BUCKET_SEAL")?);
    let seal = HEXLOWER_PERMISSIVE.decode(seal.trim().as_bytes()).map(Zeroizing::new).ok();
    let seal = seal.and_then(|bytes| <[u8; 32]>::try_from(&bytes[..]).ok());
    let seal = seal.context("AVENDB_BUCKET_SEAL: no 64 hex digits")?;
    Ok(BucketConfig {
        name,
        endpoint: said("AVENDB_BUCKET_ENDPOINT")?,
        region: said("AVENDB_BUCKET_REGION")?,
        access_key: said("AVENDB_BUCKET_ACCESS_KEY")?,
        secret_key: said("AVENDB_BUCKET_SECRET_KEY")?,
        seal: Zeroizing::new(seal),
    })
}

/// The server running: its node, its relay, its feed, its backups, and its offer.
pub struct Running {
    pub node: Arc<Node>,
    pub relay: Relay,
    pub feed: feed::Feed,
    pub backups: Option<backups::Backups>,
    /// What the apps know of the server (P8c), so that a new device links through it with its person's passkey alone:
    /// its device, its endpoint, where devices on UDP reach it (`Config::public_addr`) and its relay. A device it
    /// doesn't know yet reaches it straight, over UDP, as its relay lets the device in only once it joined.
    pub offer: Offer,
}

impl Running {
    /// Stops the node, then the relay.
    pub async fn shutdown(self) -> Result<()> {
        self.node.shutdown().await?;
        self.relay.shutdown().await
    }
}

/// How long the server waits at its start to be on its relay.
const ONLINE: Duration = Duration::from_secs(30);

/// Starts the server as `config` says: its relay, then its node on its shelf, its bucket's or its folder's, made at
/// its first start, which is reached through that relay and tells it whom to let in, gated or not, then the feed of
/// what it keeps.
pub async fn start(config: &Config) -> Result<Running> {
    let admission = if config.signup { Admission::open() } else { Admission::default() };
    let relay = Relay::spawn(config.relay_bind, admission.clone()).await?;
    let url = config.relay_url.clone().unwrap_or_else(|| relay.url());
    let shelf = match &config.bucket {
        Some(b) => {
            let sealed = Sealed::new(bucket::S3::new(b)?, &b.seal);
            avendb_net::bucket::shelf(sealed, &config.data, config.cache).await?
        }
        None => avendb_net::disk::open(&config.data)?,
    };
    let own = shelf.clone();
    let opts = Options {
        bind: Some(config.bind),
        direct: false,
        relay: Some(url),
        proxy: false,
        retry: Duration::from_secs(1),
        shelf: None,
        keep: false,
        card: false,
        admission: Some(admission),
        relay_passes: Vec::new(),
        page: avendb_net::PAGE,
        // its start is nobody's to watch
        progress: avendb_net::Progress::new(),
    };
    let node = Arc::new(server::open(shelf, opts).await?);
    node.gate(config.gate).await;
    // on its relay before it says its offer: its endpoint joins the relay once its first net report is done, a few
    // seconds in, and until then the relay drops what devices send it
    if tokio::time::timeout(ONLINE, node.endpoint().online()).await.is_err() {
        tracing::warn!("avenDB server: not on its relay after {ONLINE:?}; devices reach it once it is");
    }
    let mut offer = node.offer();
    if let Some(public) = config.public_addr {
        let relays: Vec<RelayUrl> = offer.addr.relay_urls().cloned().collect();
        let addr = EndpointAddr::new(node.id()).with_ip_addr(public);
        offer.addr = relays.into_iter().fold(addr, EndpointAddr::with_relay_url);
    }
    let feed = feed::Feed::spawn(config.feed_bind, node.clone()).await?;
    let backups = config.snapshots.as_ref().map(|s| backups::Backups::spawn(node.clone(), own, s, Keep::default()));
    Ok(Running { node, relay, feed, backups: backups.transpose()?, offer })
}

/// The server's relay: iroh's, serving plain HTTP on its socket, letting in only the clients its admission admits or
/// whose passes it honours, and letting go of those it stops admitting and those whose passes ran out.
pub struct Relay {
    server: Server,
    gate: Arc<Gate>,
    _letting_go: Abort,
}

impl Relay {
    /// The relay on socket `bind`, letting in whom `admission` admits.
    pub async fn spawn(bind: SocketAddr, admission: Admission) -> Result<Relay> {
        let (served, passes, passed) = (Mutex::default(), Mutex::default(), Notify::new());
        let gate = Arc::new(Gate { admission, served, passes, passed });
        let mut relay = RelayConfig::new(bind);
        relay.access = gate.clone();
        let mut config = ServerConfig::default();
        config.relay = Some(relay);
        let server = Server::spawn(config).await.map_err(|e| anyhow!("the relay on {bind}: {e}"))?;
        let service = server.relay_service().context("the relay's service")?.clone();
        let letting_go = Abort(tokio::spawn(let_go(gate.clone(), service)));
        Ok(Relay { server, gate, _letting_go: letting_go })
    }

    /// Where devices on this machine reach it: its socket, over plain HTTP.
    pub fn url(&self) -> RelayUrl {
        let addr = self.server.http_addr().expect("the relay serves HTTP");
        format!("http://{addr}").parse().expect("a socket's URL")
    }

    /// Whom it lets in.
    pub fn admission(&self) -> &Admission {
        &self.gate.admission
    }

    /// It serves `endpoint` now: let in, and connected.
    pub fn serves(&self, endpoint: &EndpointId) -> bool {
        self.gate.served.lock().expect("served").contains_key(endpoint)
    }

    /// It lets `endpoint` in by a pass now (`avendb::sign::RelayPass`): until when, in seconds since 1970.
    pub fn passed(&self, endpoint: &EndpointId) -> Option<u64> {
        self.gate.passes.lock().expect("passes").get(endpoint).copied().filter(|&until| until > now())
    }

    /// Lets go of every client, and stops.
    pub async fn shutdown(self) -> Result<()> {
        self.server.shutdown().await.map_err(|e| anyhow!("the relay: {e}"))
    }
}

/// The relay's gate: whom it lets in, whom it serves, each client with its connections, and the clients it let in by a
/// pass, each with when its pass runs out.
#[derive(Debug)]
struct Gate {
    admission: Admission,
    served: Mutex<HashMap<EndpointId, HashSet<ConnectionId>>>,
    passes: Mutex<HashMap<EndpointId, u64>>,
    /// Woken when it lets a client in by a pass, whose end may come before any other's.
    passed: Notify,
}

impl Gate {
    /// When the pass the client of `request` shows runs out, if it is one the relay honours at `now`: for the client's
    /// own endpoint, by a passkey that roots a vault the server knows or by any while sign-up is open, made within its
    /// ten minutes, and signed both ways. The passkeys it may be from are checked first, the signatures, which take a
    /// while, last: the relay honours it if it honours one of the passkeys that made it (`RelayPass::passkeys`). A
    /// client may show its passkey's pass in each suite (`token_passes`): the first the relay honours counts.
    fn pass(&self, request: &ClientRequest, now: u64) -> Option<u64> {
        let endpoint = *request.endpoint_id().as_bytes();
        let honours = |p: &SignerId| self.admission.honours(p);
        let mine = |pass: &RelayPass| pass.endpoint() == Some(endpoint) && pass.candidates().iter().any(honours);
        let passes = token_passes(&request.auth_token()?);
        passes.into_iter().filter(mine).find_map(|pass| pass.passkeys(now).iter().any(honours).then(|| pass.expires()))
    }

    /// The relay still lets `endpoint` in at `now`: the server knows it, or its pass hasn't run out.
    fn admits(&self, endpoint: &EndpointId, passes: &HashMap<EndpointId, u64>, now: u64) -> bool {
        self.admission.admits(endpoint) || passes.get(endpoint).is_some_and(|&until| until > now)
    }
}

impl AccessControl for Gate {
    async fn on_connect(&self, request: &ClientRequest) -> Access {
        let (endpoint, now) = (request.endpoint_id(), now());
        // the pass checked before the lock is taken, as its signatures take a while
        let pass = if self.admission.admits(&endpoint) { None } else { self.pass(request, now) };
        // under the lock, so that a client let in while the admission changes is let go with the others
        let mut served = self.served.lock().expect("served");
        let mut passes = self.passes.lock().expect("passes");
        if let Some(until) = pass {
            let until = passes.get(&endpoint).map_or(until, |&had| had.max(until));
            passes.insert(endpoint, until);
            self.passed.notify_one();
        }
        if !self.admits(&endpoint, &passes, now) {
            return Access::Deny { reason: Some("not a device this server knows, nor one with a pass".into()) };
        }
        served.entry(endpoint).or_default().insert(request.connection_id());
        Access::Allow
    }

    fn on_disconnect(&self, endpoint: EndpointId, connection: ConnectionId) {
        let mut served = self.served.lock().expect("served");
        if let Some(connections) = served.get_mut(&endpoint) {
            connections.remove(&connection);
            if connections.is_empty() {
                served.remove(&endpoint);
            }
        }
    }
}

/// Whenever whom the relay admits changes, or a pass runs out, lets go of each client it serves that it no longer
/// admits: a device taken out of its vault, say, or one whose pass ran out before it joined. The client, trying again,
/// is turned away.
async fn let_go(gate: Arc<Gate>, service: RelayService) {
    let mut changes = gate.admission.watch();
    loop {
        // until the first pass runs out, a minute at most
        let next = gate.passes.lock().expect("passes").values().min().copied();
        let wait = next.map_or(60, |until| until.saturating_sub(now())).clamp(1, 60);
        tokio::select! {
            changed = changes.changed() => if changed.is_err() { return },
            () = gate.passed.notified() => {}
            () = tokio::time::sleep(Duration::from_secs(wait)) => {}
        }
        let now = now();
        let served = gate.served.lock().expect("served");
        let mut passes = gate.passes.lock().expect("passes");
        for endpoint in served.keys().filter(|e| !gate.admits(e, &passes, now)) {
            tracing::info!("avendb relay: letting {endpoint} go, a device the server doesn't know, with no pass");
            service.clients().disconnect(*endpoint, None);
        }
        passes.retain(|_, &mut until| until > now);
    }
}

/// The time by this machine's clock: seconds since 1970.
fn now() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// A task, aborted when dropped.
struct Abort(JoinHandle<()>);

impl Drop for Abort {
    fn drop(&mut self) {
        self.0.abort();
    }
}
