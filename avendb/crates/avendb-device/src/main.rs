//! avenDB's device as the Mac app's sidecar: `avendb-device --dir <folder>`, the folder it keeps its account in. It
//! answers the app in lines of JSON on its stdin and stdout until its stdin ends (`avendb_device::serve`), and logs on
//! its stderr, as `RUST_LOG` says, else its warnings.

use std::path::PathBuf;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb_device::{Config, serve};
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
    let dir = dir()?;
    std::fs::create_dir_all(&dir).with_context(|| format!("the device's folder {}", dir.display()))?;
    serve(Config { dir, direct: true }, tokio::io::stdin(), tokio::io::stdout()).await
}

/// The folder the app names: `--dir <folder>`.
fn dir() -> Result<PathBuf> {
    let mut args = std::env::args_os().skip(1);
    match (args.next(), args.next(), args.next()) {
        (Some(flag), Some(dir), None) if flag == "--dir" => Ok(dir.into()),
        _ => bail!("usage: avendb-device --dir <folder>"),
    }
}
