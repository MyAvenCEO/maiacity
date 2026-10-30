//! The backends, one per place a peer stores (SANDBOX.md, "Storage"): memory for tests, a folder for a Peer, S3 for
//! the Aven Peer, OPFS for a Peer-Light. Memory, the folder and S3 are OpenDAL's [`DalStore`]; OPFS is our own driver
//! ([`crate::opfs`]). Each passes the same suite.

use opendal::Operator;
use opendal::services;

pub use crate::dal::Conditions;
pub use crate::dal::DalStore;
use crate::{Error, Result};

fn build(op: opendal::Result<Operator>) -> Result<DalStore> {
    op.map(DalStore::new)
        .map_err(|e| Error::Backend(e.to_string()))
}

/// Memory, for tests and the simulation: gone with the process.
pub fn memory() -> Result<DalStore> {
    build(Operator::new(services::Memory::default()))
}

/// A folder. Every write goes to `<root>/.tmp` first, is synced, and is renamed into place: a crash mid-write
/// leaves at most a stray file there, never a torn blob or ref.
#[cfg(not(target_arch = "wasm32"))]
pub fn fs(root: &std::path::Path) -> Result<DalStore> {
    let tmp = root.join(".tmp");
    let path = |p: &std::path::Path| {
        p.to_str()
            .map(str::to_owned)
            .ok_or_else(|| Error::Backend(format!("{p:?} isn't UTF-8")))
    };
    build(Operator::new(
        services::Fs::default()
            .root(&path(root)?)
            .atomic_write_dir(&path(&tmp)?),
    ))
}

/// Where an S3 store lives: a bucket and a prefix in it, on one endpoint.
#[derive(Clone, Debug)]
pub struct S3 {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    /// The store's prefix in the bucket, `/` for all of it.
    pub root: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    /// Which of the server's conditional writes refs use. Hetzner's Object Storage refuses a correct `If-Match` and
    /// ignores it on DELETE, but refuses a create over an existing key (the deploy's probe, 30 Oct 2026): there it is
    /// `Create`.
    pub conditions: Conditions,
}

/// Object storage over the S3 API. Each write is one PUT, so an object is whole or absent; refs use conditional
/// writes (`If-Match`, `If-None-Match: *`) and conditional deletes, as `conditions` says.
#[cfg(not(target_arch = "wasm32"))]
pub fn s3(at: &S3) -> Result<DalStore> {
    // OpenDAL's HTTP client (reqwest), process-wide; installing it again changes nothing
    opendal::install_default();
    let builder = services::S3::default()
        .endpoint(&at.endpoint)
        .region(&at.region)
        .bucket(&at.bucket)
        .root(&at.root)
        .access_key_id(&at.access_key_id)
        .secret_access_key(&at.secret_access_key)
        .disable_config_load()
        .disable_ec2_metadata();
    let store = build(Operator::new(builder))?;
    Ok(store.with_conditions(at.conditions))
}

/// The origin's private file system, in the Peer-Light's dedicated worker: our own driver on sync access handles
/// (store/README.md, "What the store asks of the opfs driver"). Opening recovers what a crash left under `root`.
#[cfg(target_arch = "wasm32")]
pub async fn opfs(root: &str) -> Result<crate::opfs::OpfsStore<crate::opfs_folder::OpfsFolder>> {
    crate::opfs::OpfsStore::open(crate::opfs_folder::OpfsFolder::open(root).await?).await
}
