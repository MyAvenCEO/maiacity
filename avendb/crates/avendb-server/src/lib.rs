//! avenDB's server (P8b), as its binary runs it: its node (`avendb_net::server`) in a folder of its own, holding only
//! ciphertext, and beside it its relay, through which devices with no UDP of their own reach the server and each
//! other. The relay lets in only the devices the node knows (`Admission`): the devices of the vaults acting in the
//! spaces it relays, and the node itself; and it lets go of a device the node stops knowing, as when the device is
//! taken out of its vault. A new device with no UDP of its own, as a browser's, which the node can't know before it
//! joined, shows a pass its person's passkey signed (P8d, `avendb::sign::RelayPass`): the relay lets it in for ten
//! minutes if the passkey roots a vault the node knows, long enough to link, and lets it go once its pass runs out,
//! unless by then the node knows it. While sign-up is open (P8e, `Config::signup`), it honours a pass of any passkey,
//! so that a person's first device, a browser, founds their vault and makes it known to the server in those minutes.
//!
//! The relay serves plain HTTP. TLS ends in front of it, at a proxy that must offer X25519MLKEM768, as every device's
//! TLS offers nothing else (`avendb_net::pq_provider`); and as iroh's relay path is `/relay`, the relay wants a host
//! name of its own. Where it is deployed is said in `README.md`, under "Deploying the server".

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use anyhow::{Context as _, Result, anyhow};
use avendb_net::{Admission, Node, Offer, Options, server, token_pass};
use iroh::{EndpointAddr, EndpointId, RelayUrl};
use iroh_relay::server::{
    Access, AccessControl, ClientRequest, ConnectionId, RelayConfig, RelayService, Server, ServerConfig,
};
use tokio::sync::Notify;
use tokio::task::JoinHandle;

/// How the server runs, as its environment says.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    /// Its folder (`AVENDB_DATA`, `/data` by default): its device's secret and its store.
    pub data: PathBuf,
    /// The UDP socket its node binds (`AVENDB_BIND`, `0.0.0.0:7401`), where devices on UDP reach it straight.
    pub bind: SocketAddr,
    /// The socket its relay serves plain HTTP on (`AVENDB_RELAY_BIND`, `0.0.0.0:3350`), behind the proxy.
    pub relay_bind: SocketAddr,
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
            relay_url: var("AVENDB_RELAY_URL").map(url).transpose()?,
            public_addr: var("AVENDB_PUBLIC_ADDR").map(|v| v.parse()).transpose().context("AVENDB_PUBLIC_ADDR")?,
            signup: match var("AVENDB_SIGNUP").as_deref() {
                None | Some("open") => true,
                Some("closed") => false,
                Some(v) => return Err(anyhow!("AVENDB_SIGNUP: {v} is neither open nor closed")),
            },
        })
    }
}

/// The server running: its node, its relay, and its offer.
pub struct Running {
    pub node: Node,
    pub relay: Relay,
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

/// Starts the server as `config` says: its relay, then its node in its folder, made at its first start, which is
/// reached through that relay and tells it whom to let in.
pub async fn start(config: &Config) -> Result<Running> {
    let admission = if config.signup { Admission::open() } else { Admission::default() };
    let relay = Relay::spawn(config.relay_bind, admission.clone()).await?;
    let url = config.relay_url.clone().unwrap_or_else(|| relay.url());
    let opts = Options {
        bind: Some(config.bind),
        relay: Some(url),
        retry: Duration::from_secs(1),
        store: None,
        card: false,
        admission: Some(admission),
        relay_pass: None,
        page: avendb_net::PAGE,
    };
    let node = server::open(&config.data, opts).await?;
    let mut offer = node.offer();
    if let Some(public) = config.public_addr {
        let relays: Vec<RelayUrl> = offer.addr.relay_urls().cloned().collect();
        let addr = EndpointAddr::new(node.id()).with_ip_addr(public);
        offer.addr = relays.into_iter().fold(addr, EndpointAddr::with_relay_url);
    }
    Ok(Running { node, relay, offer })
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
    /// ten minutes, and signed both ways. The passkey is checked first, the signatures, which take a while, last.
    fn pass(&self, request: &ClientRequest, now: u64) -> Option<u64> {
        let pass = token_pass(&request.auth_token()?)?;
        if !self.admission.honours(&pass.keys.id()) {
            return None;
        }
        pass.verify(request.endpoint_id().as_bytes(), now)?;
        Some(pass.expires())
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
