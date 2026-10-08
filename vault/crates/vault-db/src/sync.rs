//! Sync by caps, item by item, as in `vault/spec/VaultSpec/Sync.lean`. A device asks a peer for what it may receive;
//! the connection proves which device is asking (iroh's endpoint key is the device key). The peer answers from its own
//! view: the logs of the vaults that device acts for, and for each item it may receive, the encrypted writes, the auth
//! ops of the scopes covering it, and the logs of every vault those ops act for or name, up their chains of owners.
//! Nothing about other items leaves the peer (T12), and two devices that answered each other hold the same writes for
//! every item they share (T13).
//!
//! Vault logs in P1, items by caps in P2, proven in P6 (T12, T13); on the wire (P8) it runs on its own iroh ALPN, with
//! the bytes in iroh-blobs.

use crate::id::{EntryId, GrantId, OpId, SignerId, SpaceId, VaultId};
use crate::policy::{view, Action, Op, Principal, Scope, State};

/// What a peer holding `ops` sends device `d`: the writes of every item `d` may receive, the auth ops of every scope it
/// reaches, and the logs of the vaults it acts for, of the vaults those ops act for or name, and of every vault that
/// owns one of them, up the chains.
pub fn respond(ops: &[Op], d: SignerId) -> Vec<Op> {
    let st = view(ops);
    let writes: Vec<&Op> =
        ops.iter().filter(|op| op.write_target().is_some_and(|(sp, e)| st.may_receive(d, sp, e))).collect();
    let auth: Vec<&Op> = ops.iter().filter(|op| auth_scope(ops, op).is_some_and(|sc| st.reaches(d, sc))).collect();
    let mut vs: Vec<VaultId> = st.vaults().iter().map(|x| x.id).filter(|&v| st.acts_for(d, v)).collect();
    vs.extend(writes.iter().chain(&auth).filter_map(|op| op.actor()));
    vs.extend(auth.iter().filter_map(|op| op.grantee()));
    let vaults = close_vaults(&st, vs);
    let vault_ops = ops.iter().filter(|op| op.vault_of().is_some_and(|v| vaults.contains(&v)));
    writes.into_iter().chain(auth).chain(vault_ops).cloned().collect()
}

/// The scope an auth op is about: a space's founding, a grant's scope, or for a revocation the scope of the grant it
/// revokes, looked up among `ops`.
fn auth_scope(ops: &[Op], op: &Op) -> Option<Scope> {
    match &op.action {
        Action::FoundSpace { .. } => Some(Scope::Space(SpaceId::from(op.id()))),
        Action::Grant(g) => Some(g.scope),
        Action::Revoke { grant, .. } => ops.iter().find_map(|o| match &o.action {
            Action::Grant(g) if GrantId::from(o.id()) == *grant => Some(g.scope),
            _ => None,
        }),
        _ => None,
    }
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
