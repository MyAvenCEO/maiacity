//! Sync by caps, item by item, as in `avendb/spec/AvenDB/Sync.lean`. A device asks a peer for what it may receive;
//! the connection proves which device is asking (iroh's endpoint key is the device's ed25519 key, and the device shows
//! the rest of its keys, which hash to its signer id). The peer answers from its own view: the logs of the vaults that
//! device acts for, and for each item it may receive, the encrypted writes and checkpoints, the auth ops of the scopes
//! covering it, and the logs of every vault those ops act for or name, up their chains of owners. A
//! revocation that took one of the device's caps away reaches it too, so it knows what it may no longer do. Nothing
//! else about other items leaves the peer (T12), and two devices that answered each other hold the same writes for
//! every item they share (T13).
//!
//! Vault logs in P1, items by caps in P2, proven in P6 (T12, T13); on the wire (P8) it runs on its own iroh ALPN, with
//! the bytes in iroh-blobs.

use crate::id::{EntryId, GrantId, OpId, SignerId, SpaceId, VaultId};
use crate::policy::{removes, view, Action, Fact, Grant, Grantee, Op, Principal, Scope, State};

/// What a peer holding `ops` sends device `d`: the writes of every item `d` may receive, the auth ops of every scope it
/// reaches and the revocations that took its caps away, and the logs of the vaults it acts for, of the vaults those
/// ops act for or name, and of every vault that owns one of them, up the chains.
pub fn respond(ops: &[Op], d: SignerId) -> Vec<Op> {
    let st = view(ops);
    let writes: Vec<&Op> = ops.iter().filter(|op| op.item().is_some_and(|(sp, e)| st.may_receive(d, sp, e))).collect();
    let auth: Vec<&Op> = ops
        .iter()
        .filter(|op| auth_scope(ops, op).is_some_and(|sc| st.reaches(d, sc)) || takes_from(&st, ops, d, op))
        .collect();
    let mut vs: Vec<VaultId> = st.vaults().iter().map(|x| x.id).filter(|&v| st.acts_for(d, v)).collect();
    vs.extend(writes.iter().chain(&auth).filter_map(|op| op.actor()));
    vs.extend(auth.iter().filter_map(|op| op.grantee()));
    let vaults = close_vaults(&st, vs);
    let vault_ops = ops.iter().filter(|op| op.vault_of().is_some_and(|v| vaults.contains(&v)));
    writes.into_iter().chain(auth).chain(vault_ops).cloned().collect()
}

/// The scope an auth op is about: a space's founding, a grant's scope, for a revocation the scope of the grant it
/// revokes, looked up among `ops`, the scope of a space or entry key, or the space a schema or lens is published into.
fn auth_scope(ops: &[Op], op: &Op) -> Option<Scope> {
    match &op.action {
        Action::FoundSpace { .. } => Some(Scope::Space(SpaceId::from(op.id()))),
        Action::Grant(g) => Some(g.scope),
        Action::Revoke { grant, .. } => ops.iter().find_map(|o| match &o.action {
            Action::Grant(g) if GrantId::from(o.id()) == *grant => Some(g.scope),
            _ => None,
        }),
        Action::Keys { key, .. } => key.scope(),
        Action::Publish { space, .. } => Some(Scope::Space(*space)),
        _ => None,
    }
}

/// Revocation `op` takes a cap from device `d`: among the grants it takes away is one naming a vault `d` acts for.
/// `d` hears of it, and learns nothing more about the scope.
pub fn takes_from(st: &State, ops: &[Op], d: SignerId, op: &Op) -> bool {
    if !matches!(op.action, Action::Revoke { .. }) {
        return false;
    }
    let taken = removes(ops, op);
    ops.iter().any(|o| match o.action {
        Action::Grant(Grant { grantee: Grantee::Principal(Principal::Vault(v)), .. }) => {
            taken.contains(&Fact::Grant(GrantId::from(o.id()))) && st.acts_for(d, v)
        }
        _ => false,
    })
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

/// The writes one item has in the view of `ops`, in replay order.
pub fn item_writes(ops: &[Op], sp: SpaceId, e: EntryId) -> Vec<OpId> {
    view(ops).writes(sp, e)
}
