//! The media vault's core: one private iroh node per device, its blob store, the catalog, and verified ingest.
//!
//! Every file is known only by its BLAKE3 hash (64 hex, iroh's `Hash` display). The catalog is an iroh-docs replica
//! every node keeps in full: `blobs/<hash>` points at the file itself, `meta/<hash>` at a small JSON about it. The
//! design, and why each piece is what it is, lives in `.claude/skills/iroh/maiacity.md`.

pub mod catalog;
pub mod hash;
pub mod ingest;
pub mod node;

pub use catalog::{Catalog, Meta};
pub use ingest::{IngestOutcome, Verdict};
pub use node::Vault;
