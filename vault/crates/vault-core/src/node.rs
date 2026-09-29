//! One vault node: a private iroh endpoint, the blob store, gossip and the catalog replica, all under one directory.
//!
//! Private means: built from `presets::Minimal` — no n0 relays, no n0 DNS, nothing published anywhere. Until the
//! server peer exists the node runs without a relay; peers are added by address (see skill `connectivity.md`).

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use iroh::{Endpoint, RelayMode, SecretKey, endpoint::presets, protocol::Router};
use iroh_blobs::{BlobsProtocol, store::fs::FsStore};
use iroh_docs::protocol::Docs;
use iroh_gossip::net::Gossip;

use crate::catalog::Catalog;

pub struct Vault {
    pub dir: PathBuf,
    pub endpoint: Endpoint,
    pub store: FsStore,
    pub docs: Docs,
    pub catalog: Catalog,
    router: Router,
}

impl Vault {
    /// Open (or create) the vault in `dir`: `dir/secret.key` is this device's identity, `dir/blobs` the store,
    /// `dir/docs` the catalog replica, `dir/ingest` the landing place of copies being verified.
    pub async fn open(dir: impl AsRef<Path>) -> Result<Self> {
        let dir = dir.as_ref().to_path_buf();
        std::fs::create_dir_all(dir.join("ingest"))?;
        std::fs::create_dir_all(dir.join("docs"))?;
        // iroh-blobs imports by absolute path only
        let dir = std::fs::canonicalize(&dir)?;
        let secret = load_or_create_key(&dir.join("secret.key"))?;

        let endpoint = Endpoint::builder(presets::Minimal)
            .secret_key(secret)
            .relay_mode(RelayMode::Disabled)
            .bind()
            .await
            .context("bind the iroh endpoint")?;

        let store = FsStore::load(dir.join("blobs")).await.context("open the blob store")?;
        let gossip = Gossip::builder().spawn(endpoint.clone());
        let docs = Docs::persistent(dir.join("docs"))
            .spawn(endpoint.clone(), (*store).clone(), gossip.clone())
            .await
            .context("open the catalog store")?;

        let router = Router::builder(endpoint.clone())
            .accept(iroh_blobs::ALPN, BlobsProtocol::new(&store, None))
            .accept(iroh_gossip::ALPN, gossip)
            .accept(iroh_docs::ALPN, docs.clone())
            .spawn();

        let catalog = Catalog::open(&dir, &docs, &store).await?;
        Ok(Self { dir, endpoint, store, docs, catalog, router })
    }

    /// Where ingest lands copies: on the same volume as the store, so importing them is a clone, not a second copy.
    pub fn ingest_dir(&self) -> PathBuf {
        self.dir.join("ingest")
    }

    /// Always close cleanly: the store may lose its last seconds of writes otherwise.
    pub async fn close(self) -> Result<()> {
        self.router.shutdown().await.ok();
        self.store.shutdown().await.ok();
        Ok(())
    }
}

/// The device's Ed25519 identity. A new key would be a new, unpaired device, so it is kept across starts.
/// (The Mac app keeps it in the Keychain instead; the file is for the CLI and tests.)
fn load_or_create_key(path: &Path) -> Result<SecretKey> {
    if let Ok(bytes) = std::fs::read(path) {
        let bytes: [u8; 32] = bytes.as_slice().try_into().context("secret.key must be 32 bytes")?;
        return Ok(SecretKey::from_bytes(&bytes));
    }
    let key = SecretKey::generate();
    std::fs::write(path, key.to_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(key)
}
