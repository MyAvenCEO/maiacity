//! avenPEER's core, the same in every peer: its keys, the link to the Aven Peer that says how it is, the record it keeps
//! through its store, the members-only door (`members`), the chat's room (`room`), iroh-blobs' provider behind the door
//! (`blobs`), and (in the Peer, `native`)
//! presence as the Aven Peer counts it and its relay's allow-list. The protocol's rules live in `aven-db-core`; this is the edge where
//! iroh and the clock meet them (README, rule 2). What ships is the node, never the box: sandbox or live is
//! configuration only (keys, members, the relay, the addresses), and nothing here knows which it is.

pub mod blobs;
#[cfg(feature = "native")]
pub mod door;
#[cfg(feature = "native")]
pub mod hub;
/// iroh-gossip, as every peer runs it: the Peer-Light takes it from here.
pub use iroh_gossip;
pub use n0_future;
pub mod keys;
pub mod link;
pub mod members;
pub mod record;
#[cfg(feature = "native")]
pub mod relay;
pub mod room;
#[cfg(feature = "native")]
pub mod tls;

/// Where a peer's events go: the timeline's lines (`aven_db_core::timeline`), already shaped.
pub type Notes = std::sync::Arc<dyn Fn(String) + Send + Sync>;

/// A newcomer's relay token: the frame that carries its statement, as hex, so it travels in a URL's query. The Aven
/// Peer's relay reads it (`relay`).
pub fn token(frame: &aven_db_core::wire::Frame) -> String {
    let line = aven_db_core::wire::encode(frame);
    line[..line.len() - 1]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Tells the endpoint where a peer is, so gossip can dial it by its key: the Aven Peer, its room's bootstrap.
pub fn know(endpoint: &iroh::Endpoint, addr: iroh::EndpointAddr) {
    let lookup = iroh::address_lookup::memory::MemoryLookup::new();
    lookup.add_endpoint_info(addr);
    if let Ok(services) = endpoint.address_lookup() {
        services.add(lookup);
    }
}

/// Milliseconds since the epoch, the one clock every line is stamped with.
pub fn now() -> u64 {
    n0_future::time::SystemTime::now()
        .duration_since(n0_future::time::SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
