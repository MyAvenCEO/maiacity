//! The store upgrade's spike (db/store/README.md, "The iroh it uses"): a file of chunk blobs and an index moved two
//! ways, (a) iroh-blobs on our `Store` through [`adapter`], (b) bao-tree directly through [`bao`]. `src/bin/spike.rs`
//! measures both in the box.

pub mod adapter;
pub mod bao;
pub mod count;
pub mod files;
#[cfg(target_arch = "wasm32")]
pub mod wasm;
