//! avenDB's device as the Mac app's sidecar: `avendb-device --dir <folder> [--volumes <folder>]`, the folder it keeps
//! its account in, and the one the system mounts volumes in, whose drives it hosts (`avendb_device::drive`): on a Mac
//! `/Volumes` unless named, elsewhere none unless named. It answers the app in lines of JSON on its stdin and stdout
//! until its stdin ends (`avendb_device::serve`), and logs on its stderr, as `RUST_LOG` says, else its warnings.
//!
//! `avendb-device agent <harness> [--aven <name>] [--dir <folder>]`: a harness's agent device (agentClaude for
//! `claude`) beside the app's folder, the app's own by default, as an MCP server on its stdin and stdout, asking to
//! join the aven named, if any (`avendb_device::agent`).

use std::path::PathBuf;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb_device::{Config, agent, drive, serve};
use tracing_subscriber::EnvFilter;

fn main() -> Result<()> {
    // threads with room on their stacks: a Classic McEliece key pair's public matrix, over a megabyte, is made there
    let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().thread_stack_size(8 << 20).build()?;
    runtime.block_on(run())
}

async fn run() -> Result<()> {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("warn"));
    tracing_subscriber::fmt().with_env_filter(filter).with_writer(std::io::stderr).with_ansi(false).init();
    // the TLS of whatever doesn't name its own: avenDB's, X25519MLKEM768 only
    let provider = std::sync::Arc::unwrap_or_clone(avendb_net::pq_provider());
    provider.install_default().map_err(|_| anyhow!("a TLS provider was installed before avenDB's"))?;
    match usage()? {
        Usage::App { dir, volumes } => {
            std::fs::create_dir_all(&dir).with_context(|| format!("the device's folder {}", dir.display()))?;
            let volumes = volumes.or_else(|| cfg!(target_os = "macos").then(|| drive::VOLUMES.into()));
            serve(Config { dir, direct: true, volumes }, tokio::io::stdin(), tokio::io::stdout()).await
        }
        Usage::Agent { harness, aven, dir } => {
            agent::serve(dir, harness, aven, tokio::io::stdin(), tokio::io::stdout()).await
        }
    }
}

/// What it runs as.
enum Usage {
    /// The app's device, in the folder the app names, hosting the drives mounted in the folder named, if any:
    /// `--dir <folder> [--volumes <folder>]`.
    App { dir: PathBuf, volumes: Option<PathBuf> },
    /// Harness `harness`'s agent device beside the app's folder `dir`, asking to join aven `aven`, if named:
    /// `agent <harness> [--aven <name>] [--dir <folder>]`.
    Agent { harness: String, aven: Option<String>, dir: PathBuf },
}

fn usage() -> Result<Usage> {
    const USAGE: &str =
        "usage: avendb-device --dir <folder> [--volumes <folder>] | avendb-device agent <harness> [--aven <name>] [--dir <folder>]";
    let args: Vec<String> = std::env::args().skip(1).collect();
    match &args[..] {
        [flag, dir] if flag == "--dir" => Ok(Usage::App { dir: dir.into(), volumes: None }),
        [flag, dir, v, volumes] if flag == "--dir" && v == "--volumes" => {
            Ok(Usage::App { dir: dir.into(), volumes: Some(volumes.into()) })
        }
        [agent, harness, rest @ ..] if agent == "agent" => {
            let (mut aven, mut dir) = (None, None);
            for pair in rest.chunks(2) {
                match pair {
                    [flag, value] if flag == "--aven" && aven.is_none() => aven = Some(value.clone()),
                    [flag, value] if flag == "--dir" && dir.is_none() => dir = Some(PathBuf::from(value)),
                    _ => bail!(USAGE),
                }
            }
            let dir = match dir {
                Some(dir) => dir,
                None => app_folder()?,
            };
            Ok(Usage::Agent { harness: harness.clone(), aven, dir })
        }
        _ => bail!(USAGE),
    }
}

/// The app's avenDB folder on this Mac, as the app names it (vault/app/src/avendb.rs): `~/avenDB/mac`.
fn app_folder() -> Result<PathBuf> {
    let home = std::env::var_os("HOME").context("no HOME to find the app's folder in")?;
    Ok(PathBuf::from(home).join("avenDB/mac"))
}
