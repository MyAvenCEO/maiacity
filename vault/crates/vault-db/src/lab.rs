//! The Lab: in-process devices on a network the test controls. Each device has its own keys, its own ops and its own
//! store, exactly what a real device would hold; there is also a relay server, whose vault holds relay caps and never
//! read, and any number of strangers. The scenario tests run on it, and so will the Database tile's Lab screen.
//!
//! It grows with the phases: devices and their ops in P1, caps and sync by caps in P2, keys, reading and the blind
//! server in P3, items in P4 and P5, and in P6 offline devices and random delivery orders.

use std::collections::HashMap;

use crate::doc::Item;
use crate::id::{EntryId, OpId, SignerId, SpaceId, VaultId};
use crate::keys::{KeyName, KeyScope};
use crate::policy::{Action, Kind, Log, Principal, Refusal};
use crate::sign::{DeviceKey, Passkey, RecoveryCode, Signature, Signed};
use crate::sync::{respond, vault_logs};

/// What the Lab's keys derive from: the Lab is deterministic, so a failing test replays exactly.
const LAB_KEY: &str = "maiacity vault-db 2026-10-08 lab key v1";

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

/// A signer's private key.
enum Key {
    /// A device, the server's owner key, or a recovery code's signer.
    Ed25519(DeviceKey),
    Passkey(Passkey),
}

/// What one device holds: its ops, and each with its signatures, to pass on.
#[derive(Default)]
struct Store {
    log: Log,
    signed: HashMap<OpId, Signed>,
}

#[derive(Default)]
pub struct Lab {
    keys: HashMap<SignerId, Key>,
    /// Devices in the order they were made.
    devices: Vec<SignerId>,
    stores: HashMap<SignerId, Store>,
    server: Option<(SignerId, VaultId)>,
    /// Keys made so far; each key's seed counts on from here.
    made: u64,
}

impl Lab {
    pub fn new() -> Lab {
        Lab::default()
    }

    fn seed(&mut self, what: &str, name: &str) -> blake3::OutputReader {
        self.made += 1;
        let mut h = blake3::Hasher::new_derive_key(LAB_KEY);
        h.update(&self.made.to_be_bytes()).update(what.as_bytes()).update(name.as_bytes());
        h.finalize_xof()
    }

    fn secret(&mut self, what: &str, name: &str) -> [u8; 32] {
        let mut out = [0u8; 32];
        self.seed(what, name).fill(&mut out);
        out
    }

    /// A passkey: an owner signer that governs a human vault. It signs on whichever device it is used on.
    pub fn passkey(&mut self, name: &str) -> SignerId {
        let key = Passkey::from_seed(self.secret("passkey", name));
        let id = key.id();
        self.keys.insert(id, Key::Passkey(key));
        id
    }

    /// A device with its own signing and encryption keys, its own ops and its own store.
    pub fn device(&mut self, name: &str) -> SignerId {
        let key = DeviceKey::from_secret(self.secret("device", name));
        let id = key.id();
        self.keys.insert(id, Key::Ed25519(key));
        self.devices.push(id);
        self.stores.insert(id, Store::default());
        id
    }

    /// The relay server: a device and its vault, which holds relay caps on what it stores and never read. Its vault
    /// is owned by a key of the server's own, kept off the device.
    pub fn server(&mut self) -> (SignerId, VaultId) {
        if let Some(s) = self.server {
            return s;
        }
        let device = self.device("the server");
        let owner = DeviceKey::from_secret(self.secret("server owner", "the server"));
        let owner_id = owner.id();
        self.keys.insert(owner_id, Key::Ed25519(owner));
        let genesis =
            Action::Genesis { kind: Kind::Human, owners: vec![Principal::Signer(owner_id)], threshold: 1, root: None, nonce: 0, seal_to: vec![] };
        let vault = VaultId::from(self.submit(device, &[owner_id], genesis).expect("the server's vault"));
        self.submit(device, &[owner_id, device], Action::AddDevice { vault, device, seal_to: None }).expect("the server's device");
        self.server = Some((device, vault));
        (device, vault)
    }

    /// A new recovery code, as the app shows it once to write down. Its signer can sign from then on (the code is
    /// at hand); add it to a human vault as an owner to make it a way back in.
    pub fn recovery_code(&mut self) -> RecoveryCode {
        let mut entropy = [0u8; 40];
        self.seed("recovery code", "").fill(&mut entropy);
        let code = RecoveryCode::new(entropy);
        self.use_code(&code);
        code
    }

    /// Type a recovery code in: its signer can sign again.
    pub fn use_code(&mut self, code: &RecoveryCode) -> SignerId {
        let key = code.signer();
        let id = key.id();
        self.keys.insert(id, Key::Ed25519(key));
        id
    }

    /// A signer is lost: its key can't sign anymore, and a lost device's store is gone with it.
    pub fn lose(&mut self, s: SignerId) {
        self.keys.remove(&s);
        self.stores.remove(&s);
        self.devices.retain(|&d| d != s);
    }

    fn held(&self, d: SignerId) -> &Store {
        self.stores.get(&d).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"))
    }

    /// Device `to` receives signed ops: each once, and only if every signature checks out.
    fn deliver(&mut self, to: SignerId, ops: Vec<Signed>) {
        let Some(store) = self.stores.get_mut(&to) else { return };
        for signed in ops {
            let Ok(op) = signed.verify() else { continue };
            let id = op.id();
            if !store.signed.contains_key(&id) {
                store.log.receive([op.clone()]);
                store.signed.insert(id, signed);
            }
        }
    }

    fn signed(&self, d: SignerId, ops: &[crate::policy::Op]) -> Vec<Signed> {
        let store = self.held(d);
        ops.iter().map(|op| store.signed[&op.id()].clone()).collect()
    }

    /// Device `from` hands vault `v`'s log to device `to`, as when two people exchange contact cards: a peer needs a
    /// vault's log before it accepts a grant to that vault.
    pub fn share_contact(&mut self, from: SignerId, to: SignerId, v: VaultId) {
        let log = &self.held(from).log;
        let ops = vault_logs(log.ops(), &log.view(), vec![v]);
        let signed = self.signed(from, &ops);
        self.deliver(to, signed);
    }

    /// Sign `action` by `signers` (the author first) and keep it on device `on`, if `on`'s view accepts it.
    pub fn submit(&mut self, on: SignerId, signers: &[SignerId], action: Action) -> Result<OpId, Refusal> {
        let (&author, cosigners) = signers.split_first().expect("an op has an author");
        let op = self.held(on).log.check(author, cosigners, action)?;
        let id = op.id();
        let sigs: Vec<Signature> = op
            .sigs()
            .map(|s| match self.keys.get_mut(&s) {
                Some(Key::Ed25519(k)) => k.sign(id),
                Some(Key::Passkey(p)) => p.sign(id),
                None => panic!("the Lab holds no key for {s:?}"),
            })
            .collect();
        let signed = Signed { op, sigs };
        debug_assert!(signed.verify().is_ok());
        self.deliver(on, vec![signed]);
        Ok(id)
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
        &self.held(d).log
    }

    /// The signed op device `d` holds with id `op`, as it would send it.
    pub fn signed_op(&self, d: SignerId, op: OpId) -> Option<&Signed> {
        self.held(d).signed.get(&op)
    }

    /// Every byte device `d` stores, to search for plaintext that shouldn't be there.
    pub fn store(&self, d: SignerId) -> Vec<u8> {
        let _ = d;
        todo!("P3: stores")
    }

    /// Device `from` answers device `to` once, sending what `to` may receive by `from`'s view.
    pub fn sync(&mut self, from: SignerId, to: SignerId) {
        let ops = respond(self.held(from).log.ops(), to);
        let signed = self.signed(from, &ops);
        self.deliver(to, signed);
    }

    /// Every pair of online devices syncs until nothing new arrives, in an order drawn from `seed`.
    pub fn sync_all(&mut self, seed: u64) {
        let mut rng = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
        let mut next = move |n: usize| {
            rng ^= rng >> 12;
            rng ^= rng << 25;
            rng ^= rng >> 27;
            (rng.wrapping_mul(0x2545_f491_4f6c_dd1d) % n as u64) as usize
        };
        loop {
            let held: usize = self.stores.values().map(|s| s.signed.len()).sum();
            let mut pairs: Vec<(SignerId, SignerId)> =
                self.devices.iter().flat_map(|&a| self.devices.iter().filter(move |&&b| b != a).map(move |&b| (a, b))).collect();
            for i in (1..pairs.len()).rev() {
                pairs.swap(i, next(i + 1));
            }
            for (from, to) in pairs {
                self.sync(from, to);
            }
            if self.stores.values().map(|s| s.signed.len()).sum::<usize>() == held {
                break;
            }
        }
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
