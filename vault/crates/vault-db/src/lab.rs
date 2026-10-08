//! The Lab: in-process devices on a network the test controls. Each device has its own keys, its own ops and its own
//! store, exactly what a real device would hold; there is also a relay server, whose vault holds relay caps and never
//! read, and any number of strangers. The scenario tests run on it, and so will the Database tile's Lab screen.
//!
//! It grows with the phases: devices and their ops in P1, caps and sync by caps in P2, keys, reading and the blind
//! server in P3, items in P4 and P5, and in P6 offline devices and random delivery orders.

use crate::doc::Item;
use crate::id::{EntryId, OpId, SignerId, SpaceId, VaultId};
use crate::keys::{KeyName, KeyScope};
use crate::policy::{Action, Log, Refusal};

/// A tampering attempt, delivered to a device to show that it is rejected or opens nothing.
#[derive(Clone, Debug)]
pub enum Tamper {
    /// An op the rules refuse, properly signed by `signers` and sent anyway: no cap, or a made-up chain.
    Unchecked { signers: Vec<SignerId>, action: Action },
    /// An op claiming a signature from a signer that didn't sign it.
    ForgedSignature { claimed: SignerId, action: Action },
    /// An accepted write with one byte of its ciphertext changed.
    ChangedCiphertext(OpId),
    /// A key from before a revocation, sealed again to the revoked device and replayed.
    ReplayedSeal { key: KeyName, to: SignerId },
}

pub struct Lab {
    _filled_in_p1_to_p6: (),
}

impl Lab {
    pub fn new() -> Lab {
        todo!("P1: the Lab")
    }

    /// A passkey: an owner signer that governs a human vault. It signs on whichever device it is used on.
    pub fn passkey(&mut self, name: &str) -> SignerId {
        let _ = name;
        todo!("P1: signers")
    }

    /// A device with its own signing and encryption keys, its own ops and its own store.
    pub fn device(&mut self, name: &str) -> SignerId {
        let _ = name;
        todo!("P1: devices")
    }

    /// The relay server: a device and its vault, which holds relay caps on what it stores and never read.
    pub fn server(&mut self) -> (SignerId, VaultId) {
        todo!("P2: the server's vault")
    }

    /// Device `from` hands vault `v`'s log to device `to`, as when two people exchange contact cards: a peer needs a
    /// vault's log before it accepts a grant to that vault.
    pub fn share_contact(&mut self, from: SignerId, to: SignerId, v: VaultId) {
        let _ = (from, to, v);
        todo!("P1: vault logs")
    }

    /// Sign `action` by `signers` (the author first) and keep it on device `on`, if `on`'s view accepts it.
    pub fn submit(&mut self, on: SignerId, signers: &[SignerId], action: Action) -> Result<OpId, Refusal> {
        let _ = (on, signers, action);
        todo!("P1: signing and appending")
    }

    /// Create an item in `space` on device `on`, acting for `actor`: its first encrypted write.
    pub fn create(&mut self, on: SignerId, actor: VaultId, space: SpaceId, item: Item) -> Result<EntryId, Refusal> {
        let _ = (on, actor, space, item);
        todo!("P3: encrypted writes")
    }

    /// Edit an item on device `on`, acting for `actor`: the change becomes one encrypted write under the entry's
    /// current key.
    pub fn edit(
        &mut self,
        on: SignerId,
        actor: VaultId,
        space: SpaceId,
        entry: EntryId,
        change: impl FnOnce(&mut Item),
    ) -> Result<OpId, Refusal> {
        let _ = (on, actor, space, entry, change);
        todo!("P3: encrypted writes")
    }

    /// The item as device `d` shows it: the writes it holds and can decrypt. `None` if it holds or opens none.
    pub fn item(&self, d: SignerId, space: SpaceId, entry: EntryId) -> Option<&Item> {
        let _ = (d, space, entry);
        todo!("P3: reading")
    }

    /// How many writes of the entry device `d` holds, whether it can decrypt them or not.
    pub fn fetched(&self, d: SignerId, space: SpaceId, entry: EntryId) -> usize {
        let _ = (d, space, entry);
        todo!("P3: stores")
    }

    /// Device `d` can open the current key of `k` with what it holds.
    pub fn opens(&self, d: SignerId, k: KeyScope) -> bool {
        let _ = (d, k);
        todo!("P3: keys")
    }

    /// The ops device `d` holds; `log(d).view()` is what it knows.
    pub fn log(&self, d: SignerId) -> &Log {
        let _ = d;
        todo!("P1: devices")
    }

    /// Every byte device `d` stores, to search for plaintext that shouldn't be there.
    pub fn store(&self, d: SignerId) -> Vec<u8> {
        let _ = d;
        todo!("P3: stores")
    }

    /// Device `from` answers device `to` once, sending what `to` may receive by `from`'s view.
    pub fn sync(&mut self, from: SignerId, to: SignerId) {
        let _ = (from, to);
        todo!("P1: vault logs, P2: items by caps")
    }

    /// Every pair of online devices syncs until nothing new arrives, in an order drawn from `seed`.
    pub fn sync_all(&mut self, seed: u64) {
        let _ = seed;
        todo!("P1: vault logs, P2: items by caps, P6: random delivery orders")
    }

    pub fn set_online(&mut self, d: SignerId, online: bool) {
        let _ = (d, online);
        todo!("P6: the network")
    }

    /// Deliver a tampering attempt to device `to`.
    pub fn tamper(&mut self, to: SignerId, how: Tamper) -> Result<(), Refusal> {
        let _ = (to, how);
        todo!("P3: tampering")
    }
}
