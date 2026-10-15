//! avenDB's device as the Mac app's sidecar: `avendb-device --dir <folder>`, the folder it keeps its account in. It
//! answers the app in lines of JSON on its stdin and stdout until its stdin ends (`avendb_device::serve`), and logs on
//! its stderr, as `RUST_LOG` says, else its warnings.
//!
//! `avendb-device agent <name> [--dir <folder>]`: an agent's own device beside the app's folder, the app's own by
//! default, as an MCP server on its stdin and stdout (`avendb_device::agent`).

use std::path::PathBuf;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb_device::{Config, agent, serve};
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
        Usage::App(dir) => {
            std::fs::create_dir_all(&dir).with_context(|| format!("the device's folder {}", dir.display()))?;
            serve(Config { dir, direct: true }, tokio::io::stdin(), tokio::io::stdout()).await
        }
        Usage::Agent { name, dir } => agent::serve(dir, name, tokio::io::stdin(), tokio::io::stdout()).await,
    }
}

/// What it runs as.
enum Usage {
    /// The app's device, in the folder the app names: `--dir <folder>`.
    App(PathBuf),
    /// Agent `name`'s own device beside the app's folder `dir`: `agent <name> [--dir <folder>]`.
    Agent { name: String, dir: PathBuf },
}

fn usage() -> Result<Usage> {
    const USAGE: &str = "usage: avendb-device --dir <folder> | avendb-device agent <name> [--dir <folder>]";
    let args: Vec<String> = std::env::args().skip(1).collect();
    match &args[..] {
        [flag, dir] if flag == "--dir" => Ok(Usage::App(dir.into())),
        [agent, name] if agent == "agent" => Ok(Usage::Agent { name: name.clone(), dir: app_folder()? }),
        [agent, name, flag, dir] if agent == "agent" && flag == "--dir" => {
            Ok(Usage::Agent { name: name.clone(), dir: dir.into() })
        }
        _ => bail!(USAGE),
    }
}

/// The app's avenDB folder on this Mac, as the app names it (vault/app/src/avendb.rs).
fn app_folder() -> Result<PathBuf> {
    let home = std::env::var_os("HOME").context("no HOME to find the app's folder in")?;
    Ok(PathBuf::from(home).join("Library/Application Support/city.maia.studio/avendb"))
}
