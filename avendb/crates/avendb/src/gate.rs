//! Who the server takes (`Gate.lean`). Anyone can make a key and sign a genesis with it: key generation can't be
//! stopped. What the server of a vault (avenMAIA's device, serving Maia City, its `home`) takes onto what it holds can.
//! It takes a new vault only where it welcomes it, in what it knows once it holds the batch the vault came in
//! (`welcomes`):
//!
//! - the vault it serves, `home`;
//! - a human vault that holds a share of `home`, which is the invite it claimed in that batch, or that owns `home`;
//! - a coop or an aven that an admin owns, directly or through its owners: `home` itself, a vault that owns `home`, or
//!   one holding a share of `home`'s cap group named Admin (`ADMIN`, `is_admin`), which only admins get;
//! - a device vault, which its owner governs and the server took before.
//!
//! From a batch it drops the geneses of the new vaults it doesn't welcome, again until none is left to drop, and takes
//! the rest; where a vault it would take stays unwelcome, a genesis it held already that the batch lets stand, it takes
//! nothing of the batch (`takes`, G2 `takes_welcome`). What rested on a dropped genesis falls in replay, as it names a
//! vault that isn't there. The model reads every write; the server reads the cap groups it opens (`Readings`), so it
//! knows a group's name as its readers count the writes that say it, through any share over `home` it opens, a public
//! one among them, as every share selects its vault's cap groups.

use crate::id::VaultId;
use crate::policy::{replay, Action, Edit, Groups, Issued, Kind, Level, Readings, State};

/// The name of the cap group of `home` whose holders may found coops and avens on its server (`adminName`).
pub const ADMIN: &str = "Admin";

/// Vault `u` holds a live share of vault `home` (`holdsAny`).
pub fn holds_any(st: &State, home: VaultId, u: VaultId) -> bool {
    st.shares().iter().any(|cp| cp.share.over == home && st.holds(u, cp, Level::Read))
}

/// Vault `u` holds a live share of vault `home` naming one of `home`'s cap groups whose name, in force by `groups`, is
/// `name` (`holdsGroup`).
pub fn holds_group(st: &State, groups: &Groups, home: VaultId, u: VaultId, name: &str) -> bool {
    let named = |g| st.group_at(groups, home, g, st.all_writes().len()).is_some_and(|x| x.name == name);
    let of_group = |cp: &&Issued| cp.share.over == home && cp.share.group.is_some_and(named);
    st.shares().iter().filter(of_group).any(|cp| st.holds(u, cp, Level::Read))
}

/// Vault `u` may found coops and avens on the server of `home`: it is `home`, it owns `home`, or it holds `home`'s
/// Admin group (`isAdmin`).
pub fn is_admin(st: &State, groups: &Groups, home: VaultId, u: VaultId) -> bool {
    u == home || st.owns(u, home) || holds_group(st, groups, home, u, ADMIN)
}

/// The server of `home` welcomes vault `v` in `st`, the cap groups in force by `groups` (`welcomes`).
pub fn welcomes(st: &State, groups: &Groups, home: VaultId, v: VaultId) -> bool {
    if v == home {
        return true;
    }
    let Some(vt) = st.vault(v) else { return false };
    match vt.kind {
        Kind::Human => holds_any(st, home, v) || st.owns(v, home),
        Kind::Coop | Kind::Aven => st.vaults().iter().any(|u| is_admin(st, groups, home, u.id) && st.owns(u.id, v)),
        Kind::DeviceVault => true,
    }
}

/// The vaults `after` knows that `before` doesn't (`newVaults`).
fn new_vaults(before: &State, after: &State) -> Vec<VaultId> {
    after.vaults().iter().map(|v| v.id).filter(|&v| before.vault(v).is_none()).collect()
}

/// What a peer knows holding `held` and `b`, and the cap groups in force there as `r` reads the writes that say them.
fn view(held: &[Edit], b: &[Edit], r: &Readings) -> (State, Groups) {
    let all: Vec<Edit> = held.iter().chain(b).cloned().collect();
    let st = replay(&all).state;
    let groups = st.read_groups(r);
    (st, groups)
}

/// What the server of `home`, holding `held`, which `before` replays, takes of batch `batch`, reading what `r` opens:
/// the batch without the geneses of the vaults new to what it knows that it doesn't welcome there, pass after pass
/// until one drops none (`admitN`, which stops there too, as a pass that drops nothing changes nothing), if it then
/// welcomes every new vault; nothing otherwise (`takes`).
pub fn takes(home: VaultId, held: &[Edit], before: &State, batch: Vec<Edit>, r: &Readings) -> Option<Vec<Edit>> {
    let mut b = batch;
    loop {
        let (after, groups) = view(held, &b, r);
        let bad: Vec<VaultId> =
            new_vaults(before, &after).into_iter().filter(|&v| !welcomes(&after, &groups, home, v)).collect();
        if bad.is_empty() {
            return Some(b);
        }
        let dropped = |e: &Edit| matches!(e.action, Action::Genesis { .. }) && bad.contains(&VaultId::from(e.id()));
        if !b.iter().any(dropped) {
            return None;
        }
        b.retain(|e| !dropped(e));
    }
}
