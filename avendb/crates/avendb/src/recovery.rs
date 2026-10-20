//! The master recovery key (Samuel, 2026-10-13): while avenDB is bootstrapped, one key that every human vault adds as
//! an owner, for emergencies, and removes like any other owner once it is no longer wanted. It is a signer like any
//! other: a passkey kept in software (`sign::Passkey`), all of whose keys derive from 32 secret bytes. Its P-256 and
//! ML-DSA-65 keys sign (SLH-DSA before the key move, K4), and its seal key, X-Wing and Classic McEliece, is what a vault seals its keys to, as to any
//! owner. Through its human vaults it owns the coop and aven vaults they own.
//!
//! Its person makes it on a machine of their own (`src/bin/master-key.rs`) and keeps the secret offline. What every
//! vault needs of it is its public half, `RecoveryKey`: a megabyte, nearly all of it the McEliece key, and its standing
//! consent to be added as an owner (`sign::standing`), which it signed as it was made, so that a vault adds it without
//! the secret ever coming online. That half's file is built in (`master`), and a device's Lab adds the key it holds to
//! every human vault it founds (`Lab::set_recovery`).

use std::sync::{Arc, OnceLock};

use crate::encode::Encode;
use crate::id::{BlobId, EditId, SignerId};
use crate::keys::{MCELIECE_PUBLIC_BYTES, PublicKey};
use crate::sign::{self, Passkey, Signature, SignerKeys};
use crate::wire::Wire;

/// How a master recovery key's public half starts, as its file holds it: what it is, and the format's version, 3 since
/// its keys are derived with BLAKE3 (a file of 2 holds those SHA-3 derived).
const MAGIC: &[u8] = b"avenDB master recovery key 3\n";

/// The file of avenDB's master recovery key, its public half, as its person made it from its secret (`master-key pub`,
/// again on 2026-10-20, in ML-DSA-65, the key move's K4): signer 29ee5fe7…, the same key as signer 05e5bd92… of
/// 2026-10-16 in SLH-DSA, by its P-256 and McEliece keys, which every human vault made before the move has among its
/// owners: the move adds this one beside it at the next unlock (`Lab::moves`), and the old one is listed as legacy
/// (`Lab::is_recovery`). An empty file builds avenDB without one.
const MASTER: &[u8] = include_bytes!("../master-recovery.pub");

/// avenDB's master recovery key, which every human vault adds as an owner while avenDB is bootstrapped (`MASTER`):
/// `None` while its file is empty. Read once.
pub fn master() -> Option<Arc<RecoveryKey>> {
    static KEY: OnceLock<Option<Arc<RecoveryKey>>> = OnceLock::new();
    let read = || RecoveryKey::from_bytes(MASTER).expect("the master key's file holds it whole");
    KEY.get_or_init(|| (!MASTER.is_empty()).then(|| Arc::new(read()))).clone()
}

/// The public half of a master recovery key: the signer a vault adds as an owner, and what it seals its keys to.
#[derive(Clone, PartialEq, Eq)]
pub struct RecoveryKey {
    /// Its P-256 and SLH-DSA keys, a passkey's.
    pub keys: SignerKeys,
    /// The key a vault seals its keys to: X-Wing, and the McEliece key's id.
    pub seal: PublicKey,
    /// The Classic McEliece public key that `seal` names, which travels beside the edit that adds the key to a vault.
    pub mceliece: Arc<[u8]>,
    /// Its standing consent to be added as an owner (`sign::standing`), which such an edit takes for its signature.
    pub consent: Signature,
}

/// The id alone, as the key is a megabyte.
impl std::fmt::Debug for RecoveryKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "RecoveryKey({})", self.id().to_hex())
    }
}

impl RecoveryKey {
    /// The public half of the master recovery key whose secret is `secret`: the keys of the passkey it is
    /// (`Passkey::from_seed`), the same a Lab takes it in as (`Lab::passkey_from`). Makes its McEliece pair, which
    /// takes about a second.
    pub fn of(secret: [u8; 32]) -> RecoveryKey {
        Self::of_in(secret, sign::SIGNING)
    }

    /// `of`, its passkey's post-quantum key in suite `suite`: the same secret makes the key in either suite, two
    /// signers, the second its next key (the key move). Its file is laid out the same either way, its keys' tag naming
    /// their suite.
    pub fn of_in(secret: [u8; 32], suite: sign::Suite) -> RecoveryKey {
        let mut passkey = Passkey::from_seed_in(secret, suite);
        let seal = passkey.seal_secret();
        let consent = passkey.consent();
        RecoveryKey { keys: passkey.keys(), seal: seal.public(), mceliece: seal.mceliece_public(), consent }
    }

    /// The signer it is.
    pub fn id(&self) -> SignerId {
        self.keys.id()
    }

    /// The bytes of its file: `MAGIC`, then its keys as the wire has them.
    pub fn to_bytes(&self) -> Vec<u8> {
        [MAGIC, &self.to_wire()].concat()
    }

    /// The key a file holds: `None` unless its bytes are one whole, a passkey's keys, an X-Wing key, the McEliece key
    /// the seal names, and the passkey's standing consent.
    pub fn from_bytes(bytes: &[u8]) -> Option<RecoveryKey> {
        let key = RecoveryKey::from_wire(bytes.strip_prefix(MAGIC)?).ok()?;
        let passkey = matches!(key.keys, SignerKeys::Passkey { .. });
        let mceliece = key.mceliece.len() == MCELIECE_PUBLIC_BYTES && BlobId::of(&key.mceliece) == key.seal.mceliece;
        let challenge = EditId(sign::consent_challenge(key.id()));
        let consents = sign::verify(key.id(), challenge, &key.consent);
        (passkey && mceliece && consents && key.seal.xwing.len() == XWING_PUBLIC_BYTES).then_some(key)
    }
}

/// An X-Wing public key's size: ML-KEM-768's 1,184 bytes and X25519's 32.
pub const XWING_PUBLIC_BYTES: usize = 1216;

impl Encode for RecoveryKey {
    fn encode(&self, out: &mut Vec<u8>) {
        self.keys.encode(out);
        self.seal.encode(out);
        (self.mceliece.len() as u32).encode(out);
        out.extend_from_slice(&self.mceliece);
        self.consent.encode(out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::id::VaultId;
    use crate::keys::KeyFam;
    use crate::lab::Lab;
    use crate::policy::{Action, Kind, Principal, Refusal, Revoking, Setting, Sharing};

    #[test]
    fn a_recovery_key_reads_back_from_its_bytes_alone() {
        let key = RecoveryKey::of([7; 32]);
        assert_eq!(key.seal.xwing.len(), XWING_PUBLIC_BYTES);
        let bytes = key.to_bytes();
        assert_eq!(RecoveryKey::from_bytes(&bytes), Some(key.clone()), "its file holds it whole");
        assert_eq!(RecoveryKey::of([7; 32]), key, "and the same secret makes it again");
        assert_ne!(RecoveryKey::of([8; 32]).id(), key.id(), "another secret another key");
        // cut short, with bytes after it, of another format, or holding a McEliece key its seal doesn't name
        assert!(RecoveryKey::from_bytes(&bytes[..bytes.len() - 1]).is_none());
        assert!(RecoveryKey::from_bytes(&[&bytes[..], &[0]].concat()).is_none());
        assert!(RecoveryKey::from_bytes(&bytes[1..]).is_none());
        let mut consent = vec![];
        key.consent.encode(&mut consent);
        let mut other = bytes.clone();
        other[bytes.len() - consent.len() - 1] ^= 1;
        assert!(RecoveryKey::from_bytes(&other).is_none(), "a McEliece key that isn't the one its seal names");
        let mut other = bytes.clone();
        *other.last_mut().expect("a byte") ^= 1;
        assert!(RecoveryKey::from_bytes(&other).is_none(), "a consent that doesn't verify");
        let mut other = key.clone();
        other.consent = RecoveryKey::of([8; 32]).consent;
        assert!(RecoveryKey::from_bytes(&other.to_bytes()).is_none(), "another key's consent");
    }

    #[test]
    fn the_built_in_master_key_is_whole_or_none() {
        assert_eq!(master().is_some(), !MASTER.is_empty());
    }

    #[test]
    fn a_lab_founds_human_vaults_with_the_master_key_among_their_owners() {
        let mut lab = Lab::new();
        let master = lab.set_recovery(Arc::new(RecoveryKey::of([7; 32])));
        assert_eq!((lab.recovery(), lab.name(master)), (Some(master), Some("the master recovery key")));
        let alice = lab.passkey("alice");
        let (phone, laptop) = (lab.device_of(alice, "phone"), lab.device_of(alice, "laptop"));
        let (owners, signers) = lab.human_owners(alice);
        assert_eq!(signers, [alice, master]);
        let genesis =
            Action::Genesis { kind: Kind::Human, owners, threshold: 1, root: Some(alice), nonce: 0, seal_to: vec![] };
        let v = VaultId::from(lab.submit(phone, &signers, genesis).expect("founded with the master key's consent"));
        for d in [phone, laptop] {
            let add = Action::Share(Sharing::Device { vault: v, device: d, seal_to: None });
            lab.submit(phone, &[alice, d], add).expect("a device");
        }
        lab.sync_all(1);
        let owners = |lab: &Lab, d| lab.state(d).vault(v).map(|x| x.owners.clone());
        assert_eq!(owners(&lab, laptop), Some(vec![Principal::Signer(alice), Principal::Signer(master)]));
        // its consent signs nothing else
        let threshold = Action::Settings { vault: v, set: Setting::Threshold(1) };
        assert_eq!(lab.submit(phone, &[alice, master], threshold.clone()), Err(Refusal::Locked));
        assert_eq!(lab.submit(phone, &[master], threshold), Err(Refusal::Locked));

        // alice loses her passkey and her phone, and her laptop stays locked for good, though it passes on edits:
        // whoever holds the master key's secret adds a device of their own, which opens the vault, as the vault's keys
        // were sealed to the master key as to any owner
        lab.lock(laptop);
        for s in [alice, phone] {
            lab.lose(s);
        }
        let rescue = lab.device("rescue");
        lab.share_contact(laptop, rescue, v);
        assert_eq!(lab.passkey_from("the master recovery", [7; 32]), master);
        let add = Action::Share(Sharing::Device { vault: v, device: rescue, seal_to: None });
        lab.submit(rescue, &[master, rescue], add).expect("the master key approves the vault's change alone");
        lab.share_contact(rescue, laptop, v);
        lab.sync_all(2);
        assert!(lab.state(rescue).vault(v).is_some_and(|x| x.devices.contains(&rescue)));
        assert!(lab.holds_key(rescue, lab.state(rescue).current(KeyFam::Seed(v))), "and it opens the vault");
    }

    #[test]
    fn a_vault_adds_the_master_key_later_and_removes_it_like_any_owner() {
        let mut lab = Lab::new();
        let alice = lab.passkey("alice");
        let phone = lab.device_of(alice, "phone");
        let v = crate::cast::human_on(&mut lab, alice, &[phone]);
        let master = lab.set_recovery(Arc::new(RecoveryKey::of([7; 32])));
        let add = Action::Share(Sharing::Owner { vault: v, owner: Principal::Signer(master), seal_to: None });
        lab.submit(phone, &[alice, master], add.clone()).expect("the root adds it, by its consent");
        assert_eq!(lab.submit(phone, &[alice, master], add), Err(Refusal::AlreadyMember));
        let owners = |lab: &Lab| lab.state(phone).vault(v).map(|x| x.owners.clone()).unwrap_or_default();
        assert_eq!(owners(&lab), [Principal::Signer(alice), Principal::Signer(master)]);
        let remove = Action::Revoke(Revoking::Owner { vault: v, owner: Principal::Signer(master), keep: vec![] });
        lab.submit(phone, &[alice], remove).expect("the root removes it");
        assert_eq!(owners(&lab), [Principal::Signer(alice)]);
    }

    #[test]
    fn a_recovery_key_is_the_passkey_its_secret_makes() {
        let key = RecoveryKey::of([7; 32]);
        let mut lab = Lab::with_entropy([1; 32]);
        let passkey = lab.passkey_from("the master recovery", [7; 32]);
        assert_eq!(passkey, key.id(), "the Lab that holds its secret signs as it");
    }

    #[test]
    fn a_recovery_key_in_ml_dsa_65_reads_back_from_its_bytes_alone() {
        use crate::sign::Suite;
        let (old, new) = (RecoveryKey::of_in([7; 32], Suite::SlhDsa), RecoveryKey::of_in([7; 32], Suite::MlDsa));
        assert_ne!(old.id(), new.id(), "its next key is another signer");
        assert_eq!((old.seal.clone(), old.mceliece.clone()), (new.seal.clone(), new.mceliece.clone()), "sealed to alike");
        assert_eq!(RecoveryKey::from_bytes(&new.to_bytes()), Some(new.clone()), "its file holds it whole");
        assert_eq!(new.keys.suite(), Suite::MlDsa);
        assert_eq!(Lab::with_entropy([1; 32]).passkey_from_in("the master recovery", [7; 32], Suite::MlDsa), new.id());
        // the old key's consent is no consent of the new one's
        let mut other = new.clone();
        other.consent = old.consent.clone();
        assert!(RecoveryKey::from_bytes(&other.to_bytes()).is_none());
    }

    #[test]
    fn the_built_in_master_key_keeps_its_signer() {
        // `master-key pub` of 2026-10-20, the key move's K4: ML-DSA-65, signer 29ee5fe7…
        let Some(master) = master() else { return };
        assert_eq!(master.id().to_hex(), "29ee5fe7f4b012249393449113eacca176b69dde38509d4b4eb71371f33dccf2");
        assert_eq!(master.keys.suite(), sign::Suite::MlDsa);
    }
}
