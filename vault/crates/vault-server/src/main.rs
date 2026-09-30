//! vault-server — the media vault's always-on peer on the Hetzner server (vault/, .claude/skills/iroh/maiacity.md).
//!
//! In the existing Docker app, beside the API: an iroh endpoint that lets in only the devices the admin paired, the
//! iroh relay (behind Caddy at api.maia.city/relay), a catalog replica, every file of the catalog in Object Storage,
//! the mirror in Postgres, and the HTTP gateway for the website and the studio. It does no media work: a file's sound
//! record (its start timecode) and its shot analysis (tags, cues, thumbnail) are made on a Mac (vault/app sound.rs,
//! analyse/), and reach the server like every other record.
//!
//! Configuration (environment):
//!   VAULT_DATA         the peer's small state (catalog replica, identity)          default /data
//!   VAULT_PORT         the iroh UDP port (open in the firewall)                    default 7400
//!   VAULT_PUBLIC_IP    the server's public IPv4, so devices dial it directly
//!   VAULT_RELAY_URL    the relay as devices reach it                               default https://api.maia.city
//!   VAULT_HTTP         the gateway (Caddy: /vault/*)                               default 0.0.0.0:3341
//!   VAULT_RELAY_HTTP   the relay's plain-HTTP port (Caddy: /relay, /generate_204)  default 0.0.0.0:3340
//!   DATABASE_URL, API_URL (http://api:3000)
//!   S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY

mod allow;
mod db;
mod gateway;
mod log;
mod peer;
mod s3;

use std::{net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use iroh::SecretKey;
use iroh_relay::server::{RelayConfig, Server, ServerConfig};

fn env(key: &str) -> Result<String> {
    std::env::var(key).with_context(|| format!("{key} is not set"))
}
fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn identity(dir: &std::path::Path) -> Result<SecretKey> {
    let path = dir.join("secret.key");
    if let Ok(b) = std::fs::read(&path) {
        return Ok(SecretKey::from_bytes(&b.as_slice().try_into().context("secret.key must be 32 bytes")?));
    }
    let key = SecretKey::generate();
    std::fs::write(&path, key.to_bytes())?;
    Ok(key)
}

#[tokio::main]
async fn main() -> Result<()> {
    let ring = log::Ring::default();
    tracing_subscriber::fmt()
        .with_env_filter(env_or("RUST_LOG", "info,iroh=warn,iroh_docs=info,iroh_blobs=warn"))
        .with_ansi(false)
        .with_writer(ring.clone())
        .init();
    rustls::crypto::ring::default_provider().install_default().ok();

    let dir = PathBuf::from(env_or("VAULT_DATA", "/data"));
    std::fs::create_dir_all(&dir)?;
    let secret = identity(&dir)?;

    let db = Arc::new(db::connect(&env("DATABASE_URL")?).await.context("connect to Postgres")?);
    let s3 = s3::S3::new(&env("S3_ENDPOINT")?, &env("S3_REGION")?, &env("S3_BUCKET")?, &env("S3_ACCESS_KEY")?, &env("S3_SECRET_KEY")?)?;

    // who may connect: the paired devices, refreshed from Postgres
    let allow = allow::Allow::default();
    allow.set(db::devices(&db).await?);

    // the relay, in this process, only for paired devices
    let mut relay = RelayConfig::new(env_or("VAULT_RELAY_HTTP", "0.0.0.0:3340").parse::<SocketAddr>().context("VAULT_RELAY_HTTP")?);
    relay.access = Arc::new(allow.clone());
    let mut relay_cfg = ServerConfig::default();
    relay_cfg.relay = Some(relay);
    let relay_server = Server::spawn(relay_cfg).await.context("start the relay")?;

    let relay_url: iroh::RelayUrl = env_or("VAULT_RELAY_URL", "https://api.maia.city").parse().context("VAULT_RELAY_URL")?;
    let peer = peer::Peer::start(
        peer::Config {
            dir: &dir,
            secret,
            port: env_or("VAULT_PORT", "7400").parse().context("VAULT_PORT")?,
            relay: relay_url.clone(),
            public_ip: std::env::var("VAULT_PUBLIC_IP").ok().and_then(|ip| ip.parse().ok()),
        },
        allow.clone(),
    )
    .await?;

    // what a paired device needs to join
    db::publish(&db, "server", &peer.endpoint.id().to_string()).await?;
    db::publish(&db, "relay", relay_url.as_str()).await?;
    db::publish(&db, "catalog", &peer.ticket().await?.to_string()).await?;
    // its author: the catalog entries it signs say what Object Storage holds
    db::publish(&db, "author", &peer.author.to_string()).await?;
    tracing::info!("vault-server {} · catalog {}", peer.endpoint.id(), peer.doc.id());

    // the paired devices change: follow them (who may connect, and how to reach them)
    peer.devices(db::devices(&db).await?);
    {
        let (db, allow, peer) = (db.clone(), allow.clone(), peer.clone());
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(15)).await;
                if let Ok(ids) = db::devices(&db).await {
                    let before = allow.all().len();
                    peer.devices(ids);
                    if allow.all().len() != before {
                        peer.nudge();
                    }
                }
            }
        });
    }
    tokio::spawn(peer.clone().listen());
    tokio::spawn(peer.clone().describe(s3.clone(), db.clone()));
    tokio::spawn(peer.clone().reconcile(s3.clone(), db.clone()));
    let api = env_or("API_URL", "http://api:3000");

    let gateway = gateway::Gateway::new(s3, db, api, ring).router();
    let http: SocketAddr = env_or("VAULT_HTTP", "0.0.0.0:3341").parse().context("VAULT_HTTP")?;
    let listener = tokio::net::TcpListener::bind(http).await?;
    tracing::info!("gateway on {http}");
    axum::serve(listener, gateway)
        .with_graceful_shutdown(async {
            tokio::signal::ctrl_c().await.ok();
        })
        .await?;

    peer.shutdown().await;
    relay_server.shutdown().await.ok();
    Ok(())
}
