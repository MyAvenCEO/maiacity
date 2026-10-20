//! The avenDB server's binary: its node and its relay, as its environment says (`Config`), until it is told to stop;
//! and, with a bucket of snapshots (`AVENDB_SNAPSHOTS`), what it does with them from the bucket alone (`backups`):
//!
//! - `avendb-server`: runs the server; SIGUSR1 has it back up every vault now (`docker kill -s USR1 maia-city-avendb`);
//! - `avendb-server snapshots`: lists each vault's snapshots;
//! - `avendb-server check [--read-all]`: checks every vault's folder as the daily run does (`backups::check_all`),
//!   reading the files' blobs due today, or with `--read-all` every one, and fails unless each is whole;
//! - `avendb-server restore --into <folder> [--at <time>]`: restores every vault into a new, empty folder, a shelf
//!   for a server started on it to run as the same device; never into the live server's.
//!
//! A time is seconds since 1970, or a day, `YYYY-MM-DD`, to its end in UTC: each vault as its newest snapshot then.
//! `snapshots` and `check` only read the bucket of snapshots, and `restore` writes only into its new folder.

use std::process::ExitCode;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb_net::backup::Reading;
use avendb_server::backups::{self, time_said, when};
use avendb_server::health::{self, Health};
use avendb_server::{Config, start_with};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<ExitCode> {
    health::few_heaps();
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();
    // the TLS of whatever doesn't name its own: avenDB's, X25519MLKEM768 only, never iroh-relay's ring
    let provider = std::sync::Arc::unwrap_or_clone(avendb_net::pq_provider());
    provider.install_default().map_err(|_| anyhow!("a TLS provider was installed before avenDB's"))?;
    let config = Config::from_env()?;
    let args: Vec<String> = std::env::args().skip(1).collect();
    let at = match args.iter().position(|a| a == "--at") {
        Some(i) => {
            let said = args.get(i + 1).context("--at: no time after it")?;
            Some(time_said(said).with_context(|| format!("--at: {said} is neither seconds since 1970 nor YYYY-MM-DD"))?)
        }
        None => None,
    };
    match args.first() {
        None => serve(&config).await.map(|()| ExitCode::SUCCESS),
        Some(command) => {
            let done = by_hand(&config, command, &args, at).await;
            std::fs::remove_dir_all(staging()).ok();
            done
        }
    }
}

/// Runs `command`, said by hand with `args`, on the bucket of snapshots alone.
async fn by_hand(config: &Config, command: &str, args: &[String], at: Option<u64>) -> Result<ExitCode> {
    match command {
        "snapshots" => list(config).await.map(|()| ExitCode::SUCCESS),
        "check" => check(config, args.iter().any(|a| a == "--read-all")).await,
        "restore" => {
            let into = args.iter().position(|a| a == "--into").and_then(|i| args.get(i + 1));
            let into = into.context("restore: --into <folder>, a new, empty folder, must be said")?;
            restore(config, at, std::path::Path::new(into)).await.map(|()| ExitCode::SUCCESS)
        }
        other => bail!("{other}: avendb-server runs the server, or says snapshots, check or restore"),
    }
}

/// Where a command run by hand stages what it reads of the bucket of snapshots: a folder of its own, as a shelf clears
/// its folder's staging as it opens, and the running server's backups stage in theirs (`AVENDB_SNAPSHOTS_DIR`).
fn staging() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("avendb-snapshots-by-hand-{}", std::process::id()))
}

/// Runs the server until it is told to stop, saying how it is doing in its folder (`Health`), how it ended too: told
/// to stop, or an error; a run that says nothing was killed.
async fn serve(config: &Config) -> Result<()> {
    let health = Health::open(&config.data);
    health.hook();
    let served = run(config, health.clone()).await;
    match &served {
        Ok(()) => health.ended("stopped", None),
        Err(e) => health.ended("error", Some(format!("{e:#}"))),
    }
    served
}

/// Runs the server until it is told to stop, handing back as it started what its start let go of (`give_back`).
async fn run(config: &Config, health: std::sync::Arc<Health>) -> Result<()> {
    let before = health.json()["before"].clone();
    if !before.is_null() {
        let (how, memory) = (&before["ended"]["how"], &before["memory"]);
        tracing::info!("avenDB server: its run before ended {how}, holding {} bytes then", memory["rss"]);
    }
    let running = start_with(config, health).await?;
    health::give_back();
    let node = &running.node;
    let (device, vault) = (node.device(), avendb_net::server::vault(node).await);
    match vault {
        Some(v) => tracing::info!("avenDB server: device {device:?} of avenCEO {v:?}, endpoint {}", node.id()),
        None => tracing::info!(
            "avenDB server: device {device:?}, endpoint {}, not claimed yet: the first human vault founded through it \
             owns it",
            node.id()
        ),
    }
    tracing::info!("avenDB server: offer {}", running.offer.to_text());
    let (data, bind, relay, feed) = (config.data.display(), config.bind, config.relay_bind, running.feed.addr());
    tracing::info!("avenDB server: data in {data}, iroh on {bind}, relay on {relay}, feed on {feed}");
    match &config.bucket {
        Some(b) => {
            tracing::info!("avenDB server: its shelf is in bucket {} at {}, sealed; {data} caches", b.name, b.endpoint)
        }
        None => tracing::info!("avenDB server: no bucket, its shelf is in {data}"),
    }
    match &config.snapshots {
        Some(s) => tracing::info!(
            "avenDB server: backs up every vault into bucket {} each day at {} UTC, and on SIGUSR1",
            s.bucket.name,
            &when(s.at)[11..16]
        ),
        None => tracing::info!("avenDB server: no bucket of snapshots, so no backups"),
    }
    stopped(running.backups.as_ref()).await?;
    tracing::info!("avenDB server: stopping");
    running.shutdown().await
}

/// The bucket of snapshots `config` names, staging in a folder of this command's own (`staging`).
fn snapshots(config: &Config) -> Result<avendb_net::backup::Snapshots> {
    let said = config.snapshots.as_ref().context("AVENDB_SNAPSHOTS: unsaid, so there are no snapshots")?;
    backups::snapshots(&avendb_server::SnapshotsConfig { dir: staging(), ..said.clone() })
}

/// Lists each vault's snapshots, and what the newest holds.
async fn list(config: &Config) -> Result<()> {
    let snapshots = snapshots(config)?;
    for v in snapshots.vaults().await? {
        let folder = snapshots.folder(v).await?;
        let times = folder.times().await?;
        let newest = folder.newest().await?;
        let held = newest.map_or("none reads whole".into(), |m| format!("{} edits, {} files", m.edits, m.files.len()));
        println!("vault {}: {} snapshots; the newest {held}", v.to_hex(), times.len());
        for t in times {
            println!("  {t}  {}", when(t));
        }
    }
    Ok(())
}

/// Checks every vault's folder as the daily run does, or reading every blob: fails unless each is whole.
async fn check(config: &Config, read_all: bool) -> Result<ExitCode> {
    let snapshots = snapshots(config)?;
    let read_days = config.snapshots.as_ref().map_or(30, |s| s.read_days);
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs();
    let reading = if read_all { Reading::ALL } else { Reading::at(read_days, now) };
    let checks = backups::check_all(&snapshots, reading).await?;
    let broken: Vec<_> = checks.checked.iter().filter(|(_, c)| !c.whole()).collect();
    let (all, not) = (checks.checked.len(), broken.len());
    let (failed, took) = (checks.failed.len(), checks.took);
    println!("{all} vaults checked, {} whole, {not} not whole, {failed} failed, in {took:?}", all - not);
    for (v, c) in &broken {
        println!("  not whole: vault {}: {c:?}", v.to_hex());
    }
    for (v, why) in &checks.failed {
        println!("  failed: vault {}: {why}", v.to_hex());
    }
    Ok(if checks.whole() { ExitCode::SUCCESS } else { ExitCode::FAILURE })
}

/// Restores every vault from the bucket of snapshots into folder `into`, never the live server's.
async fn restore(config: &Config, at: Option<u64>, into: &std::path::Path) -> Result<()> {
    let real = |p: &std::path::Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    if real(into).starts_with(real(&config.data)) {
        bail!("{} is the live server's folder: a restore goes into a new one", into.display());
    }
    let restored = backups::restore(&snapshots(config)?, at, into).await?;
    for (v, m) in &restored {
        println!("vault {}: the snapshot of {} ({} edits, {} files)", v.to_hex(), when(m.time), m.edits, m.files.len());
    }
    let shown = into.display();
    println!("{} vaults restored into {shown}", restored.len());
    println!("a server started with AVENDB_DATA={shown} and no AVENDB_BUCKET runs on them, as the same device");
    Ok(())
}

/// Waits until the process is told to stop: ctrl-c, or the SIGTERM a container gets. On SIGUSR1, has `backups` back
/// up every vault now.
async fn stopped(backups: Option<&backups::Backups>) -> Result<()> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let (mut term, mut usr1) = (signal(SignalKind::terminate())?, signal(SignalKind::user_defined1())?);
        loop {
            tokio::select! {
                c = tokio::signal::ctrl_c() => return Ok(c?),
                _ = term.recv() => return Ok(()),
                _ = usr1.recv() => match backups {
                    Some(b) => b.now(),
                    None => tracing::warn!("avenDB server: told to back up, with no bucket of snapshots"),
                },
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = backups;
        Ok(tokio::signal::ctrl_c().await?)
    }
}
