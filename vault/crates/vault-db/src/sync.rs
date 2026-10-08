//! Sync by caps, item by item, as in `vault/spec/VaultSpec/Sync.lean`. A device asks a peer for what it may receive;
//! the connection proves which device is asking (iroh's endpoint key is the device key). The peer answers from its own
//! view: the logs of the vaults that device acts for, and for each item it may receive, the encrypted writes, the auth
//! ops of the scopes covering it, and the logs of every vault those ops act for or name, up their chains of owners.
//! Nothing about other items leaves the peer (T12), and two devices that answered each other hold the same writes for
//! every item they share (T13).
//!
//! Vault logs in P1, items by caps in P2, proven in P6 (T12, T13); on the wire (P8) it runs on its own iroh ALPN, with
//! the bytes in iroh-blobs.

use crate::id::{EntryId, OpId, SignerId, SpaceId};
use crate::policy::Op;

/// What a peer holding `ops` sends device `d`.
pub fn respond(ops: &[Op], d: SignerId) -> Vec<Op> {
    let _ = (ops, d);
    todo!("P1: vault logs, P2: items by caps")
}

/// A peer's ops after receiving `incoming`: each op once.
pub fn receive(ops: &[Op], incoming: &[Op]) -> Vec<Op> {
    let _ = (ops, incoming);
    todo!("P2: caps decide what syncs")
}

/// The writes one item has in the view of `ops`.
pub fn item_writes(ops: &[Op], sp: SpaceId, e: EntryId) -> Vec<OpId> {
    let _ = (ops, sp, e);
    todo!("P2: caps decide what syncs")
}
