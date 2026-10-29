//! avenPEER's Peer: the native node. `--relay` makes it the Aven Peer (SANDBOX.md, "The cast"): iroh's relay runs in
//! the same process, and its hub counts presence. Without it, the Peer links to the Aven Peer directly over UDP, with
//! the relay as fallback. Fully private: our relay only, no n0 services, no public DNS; the box hands out every
//! address.
//!
//!     aven-peer --id aven-peer --relay [--listen 0.0.0.0:4433] [--relay-listen 0.0.0.0:3340] [--relay-url URL]
//!     aven-peer --id alice-peer --aven aven:4433 --relay-url http://aven:3340 [--events DIR]

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use aven_db_core::timeline;
use aven_db_core::wire::ALPN;
use aven_peer::{Notes, cast, hub::Hub, link, now};
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, RelayMap, RelayMode, RelayUrl};
use serde_json::json;

type Error = Box<dyn std::error::Error + Send + Sync>;

fn args() -> Result<HashMap<String, String>, Error> {
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
    Ok(out)
}

/// Every event as a JSON line, on stdout and in `<dir>/<id>.jsonl`, which the box gathers into one timeline.
fn notes(id: &str, dir: Option<&String>) -> Result<Notes, Error> {
    let file = match dir {
        Some(dir) => {
            std::fs::create_dir_all(dir)?;
            Some(Mutex::new(OpenOptions::new().create(true).append(true).open(format!("{dir}/{id}.jsonl"))?))
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

async fn resolve(host: &str) -> Result<SocketAddr, Error> {
    Ok(tokio::net::lookup_host(host).await?.find(SocketAddr::is_ipv4).ok_or_else(|| format!("{host} has no address"))?)
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    let args = args()?;
    let me = args.get("id").ok_or("--id <peer of the cast> is required")?.clone();
    if !cast::peers().contains(&me) {
        return Err(format!("{me} is not a peer of the cast").into());
    }
    let notes = notes(&me, args.get("events"))?;
    let relay = args.contains_key("relay");
    let listen = args.get("listen").map(String::as_str).unwrap_or("0.0.0.0:4433");
    let relay_url: RelayUrl = args.get("relay-url").map(String::as_str).unwrap_or("http://aven:3340").parse()?;
    let note = |event: &str, fields| notes(timeline::line(now(), &me, event, fields));

    // the Aven Peer's relay, in this process: plain HTTP inside the box, where the page reaches it through Vite
    let _relay = if relay {
        let bind: SocketAddr = args.get("relay-listen").map(String::as_str).unwrap_or("0.0.0.0:3340").parse()?;
        let mut config = iroh_relay::server::ServerConfig::default();
        config.relay = Some(iroh_relay::server::RelayConfig::new(bind));
        let server = iroh_relay::server::Server::spawn(config).await?;
        note("relay", json!({ "listen": server.http_addr().map(|a| a.to_string()), "url": relay_url.to_string() }));
        Some(server)
    } else {
        None
    };

    let secret = cast::secret(&me);
    if Some(secret.public()) != cast::public(&me) {
        return Err(format!("{me}'s key is not the cast's").into());
    }
    let endpoint = Endpoint::builder(presets::Minimal)
        .secret_key(secret)
        .relay_mode(RelayMode::Custom(RelayMap::from(relay_url.clone())))
        .clear_ip_transports()
        .bind_addr(listen)?
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await?;
    note("started", json!({ "key": endpoint.id().to_string(), "listen": listen, "relay": relay }));

    let router = if relay {
        Router::builder(endpoint.clone()).accept(ALPN, Hub::new(me.clone(), notes.clone())).spawn()
    } else {
        // the Aven Peer's address comes from the box: its key from the cast, its host from the network
        let aven_key = cast::public(cast::AVEN_PEER).ok_or("the cast has no Aven Peer")?;
        let host = args.get("aven").map(String::as_str).unwrap_or("aven:4433");
        let aven = EndpointAddr::new(aven_key).with_ip_addr(resolve(host).await?).with_relay_url(relay_url);
        tokio::spawn(link::run(endpoint.clone(), me.clone(), aven, notes.clone()));
        Router::builder(endpoint.clone()).spawn()
    };

    tokio::signal::ctrl_c().await?;
    note("stopped", json!({}));
    router.shutdown().await?;
    Ok(())
}
