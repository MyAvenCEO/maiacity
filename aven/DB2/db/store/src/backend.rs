//! The backends, one per place a peer stores (SANDBOX.md, "Storage"): memory for tests, a folder for a Peer, S3 for
//! the Aven Peer, OPFS for a Peer-Light. Each is a [`DalStore`], so each passes the same suite.

use opendal::Operator;
use opendal::services;

pub use crate::dal::DalStore;
use crate::{Error, Result};

fn build(op: opendal::Result<Operator>) -> Result<DalStore> {
    op.map(DalStore::new).map_err(|e| Error::Backend(e.to_string()))
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
    let path = |p: &std::path::Path| p.to_str().map(str::to_owned).ok_or_else(|| Error::Backend(format!("{p:?} isn't UTF-8")));
    build(Operator::new(services::Fs::default().root(&path(root)?).atomic_write_dir(&path(&tmp)?)))
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
}

/// Object storage over the S3 API. Each write is one PUT, so an object is whole or absent; refs use conditional
/// writes (`If-Match`, `If-None-Match: *`) and conditional deletes.
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
    build(Operator::new(builder))
}

/// The origin's private file system, in a browser. A write goes through `createWritable`, which the browser
/// commits whole when it closes.
#[cfg(target_arch = "wasm32")]
pub fn opfs(root: &str) -> Result<DalStore> {
    build(Operator::new(services::Opfs::default().root(root)))
}
