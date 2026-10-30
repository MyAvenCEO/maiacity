//! avenPEER's Peer: the native node, one binary for the box and for production. `--relay` makes it the Aven Peer
//! (SANDBOX.md, "The cast"): iroh's relay runs in the same process, and its hub counts presence. Without it, the Peer
//! links to the Aven Peer directly over UDP, with the relay as fallback. It keeps its data through avenDB's store, in
//! the backend `--store` names: S3 for the Aven Peer, a folder for a Peer, memory for a test. Fully private: the relay it is given only, no
//! n0 services, no public DNS. Everything that differs between the box and the world is configuration, by flag or by
//! environment (`--name` or `AVEN_PEER_NAME`, and so on):
//!
//!     --name NAME            what this peer is called in presence and the timeline
//!     --secret HEX           its Ed25519 secret seed (better by environment: AVEN_PEER_SECRET)
//!     --secret-file PATH     or a file holding it, so it shows in no `docker inspect`; exactly one of the two
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
//!     --rp-id ID             with --relay: keep the tree in the store, claimed by the first passkey to sign up;
//!                            the passkeys' RP ID: maia.city in production, localhost in the box
//!     --origin URLS          with --rp-id: avenOS's origins, comma-separated; an assertion must come from one, and a
//!                            stored one holds while its origin stays listed
//!     --guardian HEX         with --rp-id, and required with it: MaiaCityGuardian's public half, an owner of every
//!                            person's vault founded
//!     --admin-coop NAME      with --rp-id: the name of the admin coop the claim founds, which owns the network
//!                            (Maia City); read at every start, so a restart with another renames it
//!
//! The door is members only (MILESTONE2.md): the relay and every connection's `after_handshake` admit the cast's
//! members, or the devices of the tree's members and admin, and the Aven Peer. Every peer is in the network's chat
//! room, over iroh-gossip on the same Router; the Aven Peer joins it first and says once who joined.

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use aven_db_core::timeline;
use aven_db_core::wire::ALPN;
use aven_db_store::backend::{self, DalStore};
use aven_id::Relying;
use aven_peer::keys::{self, Members};
use aven_peer::members::{Gate, Hook};
use aven_peer::relay::Allow;
use aven_peer::room::Room;
use aven_peer::{Notes, door, door::Door, hub::Hub, link, now, record};
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, RelayMap, RelayMode, RelayUrl};
use iroh_gossip::Gossip;
use serde_json::json;
use tokio::time::Duration;

type Error = Box<dyn std::error::Error + Send + Sync>;

/// Flags, each also read from the environment as `AVEN_PEER_<FLAG>`; a flag wins.
struct Config(HashMap<String, String>);

impl Config {
    fn read() -> Result<Self, Error> {
        let mut out = HashMap::new();
        let mut it = std::env::args().skip(1).peekable();
        while let Some(flag) = it.next() {
            let name = flag
                .strip_prefix("--")
                .ok_or_else(|| format!("unexpected {flag}"))?
                .to_string();
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
            std::env::var(format!(
                "AVEN_PEER_{}",
                name.to_uppercase().replace('-', "_")
            ))
            .ok()
            .filter(|v| !v.is_empty())
        })
    }

    fn need(&self, name: &str) -> Result<String, Error> {
        self.get(name)
            .ok_or_else(|| format!("--{name} is required").into())
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
            Some(Mutex::new(
                OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(format!("{dir}/{name}.jsonl"))?,
            ))
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
    Ok(tokio::net::lookup_host(host)
        .await?
        .find(SocketAddr::is_ipv4)
        .ok_or_else(|| format!("{host} has no address"))?)
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    let config = Config::read()?;
    let me = config.need("name")?;
    let secret = keys::secret(&match (config.get("secret"), config.get("secret-file")) {
        (Some(hex), None) => hex,
        (None, Some(path)) => {
            std::fs::read_to_string(&path).map_err(|e| format!("--secret-file {path}: {e}"))?
        }
        _ => return Err("give exactly one of --secret and --secret-file".into()),
    })?;
    let members = Members::parse(&config.or("members", ""))?;
    let notes = notes(&me, config.get("events"))?;
    let relay = config.get("relay").is_some_and(|v| v != "false");
    let listen = config.or("listen", "0.0.0.0:4433");
    let relay_url: RelayUrl = config.need("relay-url")?.parse()?;
    let note = |event: &str, fields| notes(timeline::line(now(), &me, event, fields));
    let key = secret.public();

    // its store, waited for: an Aven Peer that starts before its S3 does keeps trying rather than exit (30 Oct 2026)
    let (store, kind) = store(&config)?;
    let store = Arc::new(store);
    let record = loop {
        match record::first_start(&*store, &me, now()).await {
            Ok(record) => break record,
            Err(e) => {
                note("waiting", json!({ "for": "store", "why": e.to_string() }));
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    };
    notes(record::line(now(), &me, &kind, &record));

    // without a cast, an Aven Peer keeps its tree in its store, claimable once, its members by invite only; never
    // without MaiaCityGuardian (Samuel, 30 Oct 2026)
    let door = match (config.get("rp-id"), config.get("origin"), config.get("guardian"), config.get("admin-coop")) {
        (None, None, None, None) => None,
        (Some(_), _, None, _) => return Err("--rp-id needs --guardian: no claimable network without MaiaCityGuardian".into()),
        (Some(rp_id), Some(origins), Some(guardian), coop) if relay => {
            let coop = coop.unwrap_or_else(|| aven_id::COOP_NAME.to_string());
            if !aven_id::valid_name(&coop) {
                return Err(format!("--admin-coop: a name is 1 to {} characters, without control characters", aven_id::MAX_NAME).into());
            }
            let guardian = Some(guardian.trim().to_lowercase());
            let origins = origins.split(',').map(|o| o.trim().to_string()).filter(|o| !o.is_empty()).collect();
            if let Some(g) = &guardian {
                keys::public(g).map_err(|e| format!("--guardian: {e}"))?;
            }
            let rp = Relying { rp_id, origins };
            let coop = (aven_id::COOP, coop.as_str());
            Some(Arc::new(Door::open(me.clone(), store.clone(), &key.to_string(), rp, guardian, coop, notes.clone()).await?))
        }
        _ => {
            return Err(
                "--rp-id and --origin come together, on an Aven Peer (--relay); --guardian and --admin-coop only with them".into()
            )
        }
    };

    // the door, as this peer knows it: from its own tree, or the cast's members (and itself)
    let gate = Gate::default();
    match &door {
        Some(door) => {
            gate.set_members(&door.members());
            let (gate, mut changed) = (gate.clone(), door.subscribe());
            tokio::spawn(async move {
                while changed.changed().await.is_ok() {
                    let m = changed.borrow_and_update().clone();
                    gate.set_members(&m);
                }
            });
        }
        None => gate.set(
            members
                .keys()
                .chain([(key, me.clone())])
                .map(|(k, n)| (k, n, None))
                .collect::<Vec<_>>(),
        ),
    }

    // the Aven Peer's relay, in this process, for the door's keys only
    let _relay = if relay {
        let bind: SocketAddr = config.or("relay-listen", "0.0.0.0:3340").parse()?;
        let mut relay_config = iroh_relay::server::RelayConfig::new(bind);
        relay_config.access = Arc::new(Allow {
            me: me.clone(),
            gate: gate.clone(),
            door: door.clone(),
            notes: notes.clone(),
        });
        let mut server = iroh_relay::server::ServerConfig::default();
        server.relay = Some(relay_config);
        let server = iroh_relay::server::Server::spawn(server).await?;
        note(
            "relay",
            json!({ "listen": server.http_addr().map(|a| a.to_string()), "url": relay_url.to_string() }),
        );
        Some(server)
    } else {
        None
    };

    let endpoint = Endpoint::builder(presets::Minimal)
        .secret_key(secret.clone())
        .relay_mode(RelayMode::Custom(RelayMap::from(relay_url.clone())))
        .clear_ip_transports()
        .bind_addr(listen.as_str())?
        .alpns(vec![ALPN.to_vec(), iroh_gossip::ALPN.to_vec()])
        .hooks(Hook {
            me: me.clone(),
            gate: gate.clone(),
            notes: notes.clone(),
        })
        .bind()
        .await?;
    note(
        "started",
        json!({ "key": endpoint.id().to_string(), "listen": listen, "relay": relay }),
    );

    // gossip on the same Router as aven/db/1 (README, rule 9): the chat's room, joined through the Aven Peer
    let gossip = Gossip::builder().spawn(endpoint.clone());
    let router = Router::builder(endpoint.clone()).accept(iroh_gossip::ALPN, gossip.clone());
    let (router, bootstrap) = if relay {
        (
            router
                .accept(
                    ALPN,
                    Hub::new(me.clone(), members, notes.clone(), door.clone()),
                )
                .spawn(),
            vec![],
        )
    } else {
        let aven_key = keys::public(&config.need("aven-key")?)?;
        let host = config.need("aven")?;
        let (at, known) = (relay_url.clone(), endpoint.clone());
        let aven: link::Resolve = Arc::new(move || {
            let (host, at, known) = (host.clone(), at.clone(), known.clone());
            Box::pin(async move {
                let ip = resolve(&host).await.map_err(|e| e.to_string())?;
                let addr = EndpointAddr::new(aven_key)
                    .with_ip_addr(ip)
                    .with_relay_url(at);
                // and gossip finds it there, the room's bootstrap
                aven_peer::know(&known, addr.clone());
                Ok(addr)
            })
        });
        // once now, so the room's bootstrap is known before the link first dials
        if let Err(why) = aven().await {
            note("waiting", json!({ "for": "aven", "why": why }));
        }
        tokio::spawn(link::run(
            endpoint.clone(),
            me.clone(),
            aven,
            members.name(&aven_key),
            notes.clone(),
            None,
            None,
        ));
        (router.spawn(), vec![aven_key])
    };
    let room = Room::join(
        &gossip,
        me.clone(),
        door::NETWORK,
        secret,
        gate.clone(),
        bootstrap,
        notes.clone(),
    )
    .await?;
    // the Aven Peer says once who joined
    if let Some(door) = &door {
        let (room, mut changed) = (room.clone(), door.subscribe());
        let mut known = door.members().members();
        tokio::spawn(async move {
            while changed.changed().await.is_ok() {
                let joins = changed.borrow_and_update().joins().to_vec();
                for j in joins.iter().filter(|j| !known.contains(&j.person)) {
                    room.say(format!("{} joined", j.name)).await;
                }
                known = joins.into_iter().map(|j| j.person).collect();
            }
        });
    }

    // `docker stop` sends SIGTERM, a terminal SIGINT: either way the timeline hears that this peer stopped
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
    room.bye().await;
    note("stopped", json!({}));
    router.shutdown().await?;
    Ok(())
}
