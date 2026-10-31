//! A vault's keyring, as a Doc (`Aven.ID.Keyring`; A43): its Records are `epoch` Records, each an [`Epoch`] blob of
//! scope keyring. Built-in Records are written whole and never edited, so a rotation writes epoch n + 1, and a reseal
//! writes another Record of the *same* epoch, carrying the new reader's stanza. Opening an epoch tries the stanzas of
//! every Record that shares its name; the current epoch is the highest number, and at one number the smaller name.
//!
//! Sign-up writes the genesis through its real ceremony: a fresh vault key, sealed to the device's derived seal key and
//! the passkey's PRF seal key ([`genesis`]).

use crate::epoch::{Epoch, KeyError};
use crate::seal::{Scope, SealKey, SealPublic, Stanza};
use crate::secret::{Entropy, Secret};

/// A keyring's first Record and its epoch key: epoch 1, `vault_key` inside, sealed to `readers` (the device's seal key
/// and the passkey's PRF seal key at sign-up).
pub fn genesis(
    vault: &str,
    vault_key: &SealKey,
    readers: &[SealPublic],
    entropy: &mut impl Entropy,
) -> Result<(Epoch, Secret), KeyError> {
    Epoch::keyring(vault, vault_key, readers, entropy)
}

/// Whether a Record is a keyring's genesis (`Genesis.ok`): epoch 1, no `prev`, no `back`, a vault key, padded.
pub fn is_genesis(e: &Epoch) -> bool {
    e.scope == Scope::Keyring
        && e.n == 1
        && e.prev.is_empty()
        && e.back.is_none()
        && e.vault_key.is_some()
        && e.is_padded()
}

/// A reseal's Record: the same epoch (so the same name), carrying only the new reader's stanza, padded.
pub fn reseal(
    epoch: &Epoch,
    key: &Secret,
    to: &SealPublic,
    entropy: &mut impl Entropy,
) -> Result<Epoch, KeyError> {
    let mut record = Epoch {
        stanzas: Vec::new(),
        ..epoch.clone()
    };
    record.reseal(key, to, entropy)?;
    Ok(record)
}

/// Every stanza of the epoch named `name`, from every Record that carries it (`stanzasOf`).
pub fn stanzas_of<'a>(records: &'a [Epoch], name: &[u8; 32]) -> Vec<&'a Stanza> {
    records
        .iter()
        .filter(|r| r.name() == *name)
        .flat_map(|r| r.stanzas.iter())
        .collect()
}

/// The current epoch (`current`): the highest number, and at one number the smaller name.
pub fn current(records: &[Epoch]) -> Option<&Epoch> {
    let mut best: Option<&Epoch> = None;
    for r in records {
        best = match best {
            Some(b) if r.n < b.n || (r.n == b.n && r.name() >= b.name()) => Some(b),
            _ => Some(r),
        };
    }
    best
}

/// What opening a keyring gives: its current epoch, that epoch's key, and the vault key inside.
#[derive(Debug)]
pub struct Opened {
    pub epoch: Epoch,
    pub key: Secret,
    pub vault_key: SealKey,
}

/// Opens the keyring's current epoch with `key`, a device's seal key or a passkey's PRF seal key, from the stanzas of
/// every Record of that epoch.
pub fn open(records: &[Epoch], key: &SealKey) -> Result<Opened, KeyError> {
    let now = current(records).ok_or(KeyError::NotSealedTo)?;
    let name = now.name();
    let whole = Epoch {
        stanzas: stanzas_of(records, &name).into_iter().cloned().collect(),
        ..now.clone()
    };
    let epoch_key = whole.open(key)?;
    let vault_key = whole.vault_key(&epoch_key)?;
    Ok(Opened {
        epoch: now.clone(),
        key: epoch_key,
        vault_key,
    })
}
