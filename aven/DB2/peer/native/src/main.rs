//! avenPEER's Peer: the native node, one binary for the box and for production. `--relay` makes it the Aven Peer
//! (SANDBOX.md, "The cast"): iroh's relay runs in the same process, and its hub counts presence. Without it, the Peer
//! links to the Aven Peer directly over UDP, with the relay as fallback. It keeps its data through avenDB's store, in
//! the backend `--store` names: S3 for the Aven Peer, a folder for a Peer, memory for a test. Fully private: the relay it is given only, no
//! n0 services, no public DNS. Everything that differs between the box and the world is configuration, by flag or by
//! environment (`--name` or `AVEN_PEER_NAME`, and so on):
//!
//!     --name NAME            what this peer is called in presence and the timeline
//!     --secret HEX           its Ed25519 secret seed (better by environment: AVEN_PEER_SECRET)
//!     --listen ADDR          its UDP socket (0.0.0.0:4433)
//!     --relay                run the relay here: this is the Aven Peer
//!     --relay-listen ADDR    the relay's HTTP socket (0.0.0.0:3340), with --relay
//!     --relay-url URL        the relay every peer reaches, this one's included
//!     --members LIST         name=key,…: the peers this one knows by name; the Aven Peer admits only them
//!     --aven HOST:PORT       the Aven Peer's UDP address, without --relay
//!     --aven-key HEX         the Aven Peer's key, without --relay
//!     --events DIR           also write the timeline's lines to DIR/NAME.jsonl
//!     --store KIND           where it keeps its data: memory (the default), fs or s3
//!     --store-path DIR       the folder, with --store fs
//!     --s3-endpoint URL      the S3 server, with --store s3
//!     --s3-bucket NAME       its bucket
//!     --s3-root PREFIX       the store's prefix in the bucket (/)
//!     --s3-region NAME       its region (us-east-1)
//!     --s3-key ID            its access key id (better by environment: AVEN_PEER_S3_KEY)
//!     --s3-secret SECRET     its secret access key (better by environment: AVEN_PEER_S3_SECRET)

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use aven_db_core::timeline;
use aven_db_core::wire::ALPN;
use aven_peer::keys::{self, Members};
use aven_db_store::backend::{self, DalStore};
use aven_peer::{Notes, hub::Hub, link, now, record};
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, RelayMap, RelayMode, RelayUrl};
use serde_json::json;

type Error = Box<dyn std::error::Error + Send + Sync>;

/// Flags, each also read from the environment as `AVEN_PEER_<FLAG>`; a flag wins.
struct Config(HashMap<String, String>);

impl Config {
    fn read() -> Result<Self, Error> {
        let mut out = HashMap::new();
        let mut it = std::env::args().skip(1).peekable();
        while let Some(flag) = it.next() {
            let name = flag.strip_prefix("--").ok_or_else(|| format!("unexpected {flag}"))?.to_string();
            let value = match it.peek() {
                Some(v) if !v.starts_with("--") => it.next().unwrap(),
                _ => "true".into(),
            };
            out.insert(name, value);
        }
        Ok(Config(out))
    }

    fn get(&self, name: &str) -> Option<String> {
        self.0.get(name).cloned().or_else(|| {
            std::env::var(format!("AVEN_PEER_{}", name.to_uppercase().replace('-', "_"))).ok().filter(|v| !v.is_empty())
        })
    }

    fn need(&self, name: &str) -> Result<String, Error> {
        self.get(name).ok_or_else(|| format!("--{name} is required").into())
    }

    fn or(&self, name: &str, default: &str) -> String {
        self.get(name).unwrap_or_else(|| default.into())
    }
}

/// Every event as a JSON line, on stdout and, given a folder, in `<dir>/<name>.jsonl`.
fn notes(name: &str, dir: Option<String>) -> Result<Notes, Error> {
    let file = match dir {
        Some(dir) => {
            std::fs::create_dir_all(&dir)?;
            Some(Mutex::new(OpenOptions::new().create(true).append(true).open(format!("{dir}/{name}.jsonl"))?))
        }
        None => None,
    };
    Ok(Arc::new(move |line: String| {
        println!("{line}");
        if let Some(file) = &file {
            let _ = writeln!(file.lock().unwrap(), "{line}");
        }
    }))
}

/// The store `--store` names, and that name for the timeline.
fn store(config: &Config) -> Result<(DalStore, String), Error> {
    let kind = config.or("store", "memory");
    let store = match kind.as_str() {
        "memory" => backend::memory()?,
        "fs" => {
            let dir = config.need("store-path")?;
            std::fs::create_dir_all(&dir)?;
            backend::fs(std::path::Path::new(&dir))?
        }
        "s3" => backend::s3(&backend::S3 {
            endpoint: config.need("s3-endpoint")?,
            region: config.or("s3-region", "us-east-1"),
            bucket: config.need("s3-bucket")?,
            root: config.or("s3-root", "/"),
            access_key_id: config.need("s3-key")?,
            secret_access_key: config.need("s3-secret")?,
        })?,
        other => return Err(format!("--store {other}: memory, fs or s3").into()),
    };
    Ok((store, kind))
}

async fn resolve(host: &str) -> Result<SocketAddr, Error> {
    Ok(tokio::net::lookup_host(host).await?.find(SocketAddr::is_ipv4).ok_or_else(|| format!("{host} has no address"))?)
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    let config = Config::read()?;
    let me = config.need("name")?;
    let secret = keys::secret(&config.need("secret")?)?;
    let members = Members::parse(&config.or("members", ""))?;
    let notes = notes(&me, config.get("events"))?;
    let relay = config.get("relay").is_some_and(|v| v != "false");
    let listen = config.or("listen", "0.0.0.0:4433");
    let relay_url: RelayUrl = config.need("relay-url")?.parse()?;
    let note = |event: &str, fields| notes(timeline::line(now(), &me, event, fields));

    // the Aven Peer's relay, in this process
    let _relay = if relay {
        let bind: SocketAddr = config.or("relay-listen", "0.0.0.0:3340").parse()?;
        let mut server = iroh_relay::server::ServerConfig::default();
        server.relay = Some(iroh_relay::server::RelayConfig::new(bind));
        let server = iroh_relay::server::Server::spawn(server).await?;
        note("relay", json!({ "listen": server.http_addr().map(|a| a.to_string()), "url": relay_url.to_string() }));
        Some(server)
    } else {
        None
    };

    let endpoint = Endpoint::builder(presets::Minimal)
        .secret_key(secret)
        .relay_mode(RelayMode::Custom(RelayMap::from(relay_url.clone())))
        .clear_ip_transports()
        .bind_addr(listen.as_str())?
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await?;
    note("started", json!({ "key": endpoint.id().to_string(), "listen": listen, "relay": relay }));

    let (store, kind) = store(&config)?;
    // the one record it keeps: its first start, found again after a restart
    let record = record::first_start(&store, &me, now()).await?;
    notes(record::line(now(), &me, &kind, &record));

    let router = if relay {
        Router::builder(endpoint.clone()).accept(ALPN, Hub::new(me.clone(), members, notes.clone())).spawn()
    } else {
        let aven_key = keys::public(&config.need("aven-key")?)?;
        let aven = EndpointAddr::new(aven_key).with_ip_addr(resolve(&config.need("aven")?).await?).with_relay_url(relay_url);
        tokio::spawn(link::run(endpoint.clone(), me.clone(), aven, members.name(&aven_key), notes.clone()));
        Router::builder(endpoint.clone()).spawn()
    };

    // `docker stop` sends SIGTERM, a terminal SIGINT: either way the timeline hears that this peer stopped
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
    note("stopped", json!({}));
    router.shutdown().await?;
    Ok(())
}
