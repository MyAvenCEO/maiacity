//! `vault` — the vault from a terminal: ingest with the three-hash check, list, show the node.
//!
//!   vault [--dir DIR] ingest PATH… [--tag TAG]… [--session ID]
//!   vault [--dir DIR] ls
//!   vault [--dir DIR] id

use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};
use vault_core::{Vault, Verdict, ingest};

#[derive(Parser)]
struct Cli {
    /// The vault's directory (default: ~/Library/Application Support/city.maia.vault)
    #[arg(long, global = true)]
    dir: Option<PathBuf>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Copy files in with the three-hash check (source = disk = iroh)
    Ingest {
        paths: Vec<PathBuf>,
        #[arg(long = "tag")]
        tags: Vec<String>,
        #[arg(long)]
        session: Option<String>,
    },
    /// Every file in the catalog
    Ls,
    /// This node's EndpointId and catalog id
    Id,
    /// Join the vault's network (the server's catalog ticket) and keep syncing for a while
    Join {
        #[arg(long)]
        ticket: String,
        #[arg(long)]
        relay: String,
        /// other paired devices this node may talk to
        #[arg(long = "device")]
        devices: Vec<String>,
        /// how long to stay up and sync, in seconds
        #[arg(long, default_value_t = 60)]
        wait: u64,
    },
    /// What a movie file is, read by AVFoundation (the native ffprobe)
    Probe { file: PathBuf },
    /// A movie's HD proxy, made natively (HEVC Main10 in hardware)
    Proxy {
        file: PathBuf,
        out: PathBuf,
        /// the proxy's colour profile, as game/film/color.js names it
        #[arg(long, default_value = "rec709")]
        profile: String,
    },
}

fn default_dir() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join("Library/Application Support/city.maia.vault")
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "warn".into())).init();
    let cli = Cli::parse();
    // the media commands need no vault
    match &cli.cmd {
        Cmd::Probe { file } => {
            println!("{}", serde_json::to_string_pretty(&vault_media::probe(file)?)?);
            return Ok(());
        }
        Cmd::Proxy { file, out, profile } => {
            let started = std::time::Instant::now();
            let mut last = -1i64;
            let made = vault_media::make_proxy(file, out, profile, &mut |p| {
                let pct = (p * 100.0) as i64;
                if pct / 10 != last / 10 {
                    eprint!("{pct}% ");
                    last = pct;
                }
            })?;
            eprintln!();
            println!("{} in {:.1} s", serde_json::to_string(&made)?, started.elapsed().as_secs_f64());
            return Ok(());
        }
        _ => {}
    }
    let vault = Vault::open(cli.dir.unwrap_or_else(default_dir)).await?;

    match cli.cmd {
        Cmd::Probe { .. } | Cmd::Proxy { .. } => unreachable!("handled above"),
        Cmd::Join { ticket, relay, devices, wait } => {
            let ticket: iroh_docs::DocTicket = ticket.parse()?;
            let devices = devices.iter().map(|d| d.parse()).collect::<Result<Vec<_>, _>>()?;
            println!("node {} joining catalog {}", vault.endpoint.id(), ticket.capability.id());
            vault.join(vault_core::Join { ticket, relay: relay.parse()?, devices }).await?;
            let until = std::time::Instant::now() + std::time::Duration::from_secs(wait);
            while std::time::Instant::now() < until {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                let files = vault.catalog.list().await?.len();
                println!("catalog {} · {files} files described here", vault.catalog.id());
            }
        }
        Cmd::Id => {
            println!("endpoint {}", vault.endpoint.id());
            println!("catalog  {}", vault.catalog.id());
        }
        Cmd::Ls => {
            for m in vault.catalog.list().await? {
                println!("{}  {:>12}  {:<6}  {}  [{}]", m.hash, m.size, m.kind, m.original_name, m.tags.join(", "));
            }
        }
        Cmd::Ingest { paths, tags, session } => {
            let session = session.unwrap_or_else(|| ingest::now_iso());
            let batch = ingest::Batch { session: session.clone(), tags, ..Default::default() };
            let mut files = Vec::new();
            for p in &paths {
                files.extend(ingest::walk(p)?);
            }
            let (mut bytes, started) = (0u64, std::time::Instant::now());
            let mut outcomes = Vec::new();
            for f in &files {
                let o = vault.ingest_file(f, &batch).await?;
                let mark = match o.verdict {
                    Verdict::Verified => "✅ verified ",
                    Verdict::Duplicate => "•  duplicate",
                    Verdict::Mismatch => "❌ MISMATCH ",
                };
                let mbps = o.size as f64 / 1e6 / o.seconds.max(1e-6);
                println!("{mark}  {}…  {:>10} B  {:>7.0} MB/s  {}", &o.hash[..16], o.size, mbps, f.display());
                bytes += o.size;
                outcomes.push(o);
            }
            let secs = started.elapsed().as_secs_f64();
            let bad = outcomes.iter().filter(|o| o.verdict == Verdict::Mismatch).count();
            let report = serde_json::json!({ "session": session, "files": outcomes, "bytes": bytes, "seconds": secs });
            let report_hash = vault.catalog.put_report(&session, &report).await?;
            println!(
                "\n{} files, {:.2} GB in {:.1} s ({:.0} MB/s) — {} mismatches. Report {}",
                outcomes.len(),
                bytes as f64 / 1e9,
                secs,
                bytes as f64 / 1e6 / secs.max(1e-6),
                bad,
                report_hash.to_hex()
            );
        }
    }
    vault.close().await
}
