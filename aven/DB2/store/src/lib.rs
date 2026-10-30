//! avenDB's store: the one contract of blobs and refs, its backends (S3, a folder, OPFS, memory) and the conformance
//! suite every backend passes (SANDBOX.md, "Storage"); files as hash sequences of chunk blobs, and the one module that
//! moves blobs between peers, iroh-blobs on this store (README, "The store upgrade").

pub mod backend;
pub mod blobs;
pub mod conformance;
mod dal;
pub mod files;
mod hash;
mod name;
mod store;

pub use hash::Hash;
pub use name::RefName;
pub use store::{Error, Result, Store};
