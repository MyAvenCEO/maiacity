//! Sync by caps, item by item, as in `vault/spec/VaultSpec/Sync.lean`. A device asks a peer for what it may receive;
//! the connection proves which device is asking (iroh's endpoint key is the device key). The peer answers from its own
//! view: the logs of the vaults that device acts for, and for each item it may receive, the encrypted writes, the auth
//! ops of the scopes covering it, and the logs of every vault those ops act for or name, up their chains of owners.
//! Nothing about other items leaves the peer (T12), and two devices that answered each other hold the same writes for
//! every item they share (T13).
//!
//! Vault logs in P1, items by caps in P2, proven in P6 (T12, T13); on the wire (P8) it runs on its own iroh ALPN, with
//! the bytes in iroh-blobs.

use crate::id::{EntryId, OpId, SignerId, SpaceId, VaultId};
use crate::policy::{view, Op, Principal, State};

/// What a peer holding `ops` sends device `d`: the logs of the vaults `d` acts for, and of every vault that owns one
/// of them, up the chains. (P2 adds the items `d` may receive.)
pub fn respond(ops: &[Op], d: SignerId) -> Vec<Op> {
    let st = view(ops);
    let mine: Vec<VaultId> = st.vaults().iter().map(|x| x.id).filter(|&v| st.acts_for(d, v)).collect();
    vault_logs(ops, &st, mine)
}

/// The ops of the logs of `vs` and of every vault that owns one of them, up the chains, as `st` knows them: what a
/// contact card carries.
pub fn vault_logs(ops: &[Op], st: &State, vs: Vec<VaultId>) -> Vec<Op> {
    let vaults = close_vaults(st, vs);
    ops.iter().filter(|op| op.vault_of().is_some_and(|v| vaults.contains(&v))).cloned().collect()
}

/// `vs` and every vault that owns one of them, directly or further up.
pub fn close_vaults(st: &State, mut vs: Vec<VaultId>) -> Vec<VaultId> {
    let mut i = 0;
    while i < vs.len() {
        if let Some(vt) = st.vault(vs[i]) {
            for p in &vt.owners {
                if let Principal::Vault(o) = *p
                    && !vs.contains(&o)
                {
                    vs.push(o);
                }
            }
        }
        i += 1;
    }
    vs
}

/// A peer's ops after receiving `incoming`: each op once.
pub fn receive(ops: &[Op], incoming: &[Op]) -> Vec<Op> {
    let mut out = ops.to_vec();
    for op in incoming {
        if !out.contains(op) {
            out.push(op.clone());
        }
    }
    out
}

/// The writes one item has in the view of `ops`.
pub fn item_writes(ops: &[Op], sp: SpaceId, e: EntryId) -> Vec<OpId> {
    let _ = (ops, sp, e);
    todo!("P2: caps decide what syncs")
}
