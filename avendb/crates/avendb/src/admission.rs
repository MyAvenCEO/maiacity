//! Whom the server's relay lets in by a pass (`Admission.lean`). A device the server doesn't know yet, a browser with
//! no UDP of its own, reaches the server only through its relay, by a pass its person's passkey signed
//! (`sign::RelayPass`). Whose passes the relay honours follows the gate (`gate`), as the server signs people up
//! (`Signup`): any passkey's; a known vault's or one shown with an invite of `home` no vault claimed yet; or a known
//! vault's alone. While nobody has claimed the server it honours any, for the device that claims it.

use crate::id::{ShareId, SignerId, VaultId};
use crate::policy::{State, Who};

/// How the server signs people up (`Signup`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Signup {
    /// Any passkey's pass (P8e): a person's first device founds their vault through it.
    #[default]
    Anyone,
    /// A pass of a passkey that roots a vault it knows, or one shown with an open invite of its vault.
    Invited,
    /// A pass of a passkey that roots a vault it knows, and no other.
    Known,
}

/// The passkeys that root a vault in `st` (`roots`, `Lab::roots`).
pub fn roots(st: &State) -> Vec<SignerId> {
    st.vaults().iter().filter_map(|v| v.root).collect()
}

/// Share `c` is an invite of `home` that no vault claimed yet: a live share over `home` to an invite key
/// (`openInvite`).
pub fn open_invite(st: &State, home: VaultId, c: ShareId) -> bool {
    st.live(c) && st.share(c).is_some_and(|cp| cp.share.over == home && matches!(cp.share.who, Who::Invite(_)))
}

/// The invites of `home` in `st` that no vault claimed yet, each once.
pub fn open_invites(st: &State, home: VaultId) -> Vec<ShareId> {
    let ids = st.shares().iter().map(|cp| cp.id);
    let mut out: Vec<ShareId> = ids.filter(|&c| open_invite(st, home, c)).collect();
    out.sort_unstable();
    out.dedup();
    out
}

/// The relay of the server of `home`, knowing `st` and signing people up as `signup` says, honours a pass of passkey
/// `passkey` shown with invite `invite` (`honours`): any while nobody has claimed the server (`claimable`) or under
/// `Anyone`; one that roots a vault the server knows; and under `Invited`, one shown with an open invite of `home`.
pub fn honours(
    st: &State,
    home: VaultId,
    signup: Signup,
    claimable: bool,
    passkey: SignerId,
    invite: Option<ShareId>,
) -> bool {
    claimable
        || signup == Signup::Anyone
        || roots(st).contains(&passkey)
        || (signup == Signup::Invited && invite.is_some_and(|c| open_invite(st, home, c)))
}
