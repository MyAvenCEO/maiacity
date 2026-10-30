//! avenPEER's core, the same in every peer: its keys, the link to the Aven Peer that says how it is, and (in the Peer,
//! `native`) presence as the Aven Peer counts it. The protocol's rules live in `aven-db-core`; this is the edge where
//! iroh and the clock meet them (README, rule 2). What ships is the node, never the box: sandbox or live is
//! configuration only (keys, members, the relay, the addresses), and nothing here knows which it is.

pub mod keys;
#[cfg(feature = "native")]
pub mod hub;
pub mod link;

/// Where a peer's events go: the timeline's lines (`aven_db_core::timeline`), already shaped.
pub type Notes = std::sync::Arc<dyn Fn(String) + Send + Sync>;

/// Milliseconds since the epoch, the one clock every line is stamped with.
pub fn now() -> u64 {
    n0_future::time::SystemTime::now()
        .duration_since(n0_future::time::SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
