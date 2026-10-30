//! avenDB's store: the one contract of blobs and refs, its backends (S3, a folder, OPFS, memory) and the conformance
//! suite every backend passes (SANDBOX.md, "Storage").

pub mod backend;
pub mod conformance;
mod dal;
mod hash;
mod name;
mod store;

pub use hash::Hash;
pub use name::RefName;
pub use store::{Error, Result, Store};
