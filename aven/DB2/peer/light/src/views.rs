//! What avenOS shows, computed in the Peer-Light and pushed to the page (README rules 1 and 8): one snapshot of every
//! view of the tree (whom this host may act as, each vault's Vault and Control Room), stamped with the head it is
//! correct at, the BLAKE3 hash of the tree in the cast's form. The page only looks answers up in it and never asks
//! again; a new tree is a new snapshot. Every answer is aven-id's (`Aven.ID.Query`); the page names things, nothing
//! more. `device` is the device this host is, or `None` for the box's own view, which may act as every person.

use aven_db_store::Hash;
use aven_id::{CastError, Tree};
use serde_json::{Map, Value, json};

/// The snapshot of `tree` as `device` sees it, in the form the page reads (`os/web/id.svelte.js`).
pub fn snapshot(tree: &Tree, device: Option<&str>) -> Value {
    let keys: Map<String, Value> = tree
        .keys()
        .map(|(id, public)| (id.to_string(), Value::from(public)))
        .collect();
    let vaults: Vec<Value> = tree
        .vaults()
        .iter()
        .map(|v| {
            let id = v.id.as_str();
            let owners: Vec<String> = v.owners.iter().map(ToString::to_string).collect();
            json!({
                "id": id,
                "name": v.name,
                "kind": v.kind.as_str(),
                "owners": owners,
                "owned": tree.owned(id),
                "governs": tree.governs(id),
                "chain": tree.chain(id),
                "actsFor": tree.acts_for(id),
                "actsThrough": tree.acts_through(id),
                "sees": tree.sees(id),
            })
        })
        .collect();
    json!({
        "at": Hash::of(tree.to_cast().as_bytes()).to_hex(),
        "device": device,
        "accounts": tree.accounts(device),
        "keys": keys,
        "vaults": vaults,
    })
}

/// The snapshot of a tree in the cast's JSON: refused when it is not a well-formed tree.
pub fn of_cast(json: &str, device: Option<&str>) -> Result<Value, CastError> {
    Tree::from_cast(json).map(|tree| snapshot(&tree, device))
}
