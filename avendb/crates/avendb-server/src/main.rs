//! The avenDB server's binary: its node and its relay, as its environment says (`Config`), until it is told to stop.

use anyhow::{Result, anyhow};
use avendb_server::{Config, start};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();
    // the TLS of whatever doesn't name its own: avenDB's, X25519MLKEM768 only, never iroh-relay's ring
    let provider = std::sync::Arc::unwrap_or_clone(avendb_net::pq_provider());
    provider.install_default().map_err(|_| anyhow!("a TLS provider was installed before avenDB's"))?;
    let config = Config::from_env()?;
    let running = start(&config).await?;
    let node = &running.node;
    let (device, vault) = (node.device(), avendb_net::server::vault(node).await);
    let vault = vault.map_or_else(|| "none".to_string(), |v| format!("{v:?}"));
    tracing::info!("avenDB server: device {device:?}, vault {vault}, endpoint {}", node.id());
    let (data, bind, relay) = (config.data.display(), config.bind, config.relay_bind);
    tracing::info!("avenDB server: data in {data}, iroh on {bind}, relay on {relay}");
    stopped().await?;
    tracing::info!("avenDB server: stopping");
    running.shutdown().await
}

/// Waits until the process is told to stop: ctrl-c, or the SIGTERM a container gets.
async fn stopped() -> Result<()> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut term = signal(SignalKind::terminate())?;
        tokio::select! {
            c = tokio::signal::ctrl_c() => c?,
            _ = term.recv() => {}
        }
        Ok(())
    }
    #[cfg(not(unix))]
    {
        Ok(tokio::signal::ctrl_c().await?)
    }
}
