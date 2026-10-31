//! Epochs of keys (id/caps/README.md, "The layers", "Epochs"; `Aven.ID.Epochs`, `Aven.ID.Forget`,
//! `Aven.ID.KeyFormats`).
//!
//! An [`Epoch`] is a key blob: a fresh 32-byte key, sealed in one [`Stanza`] to each reader, a commitment to it, and
//! the previous epoch's key sealed under it (`back`), so the newest key opens the past. Two kinds:
//! - a vault's **keyring**: its stanzas go to the vault's devices and to each passkey's PRF-derived seal key, and it
//!   carries the vault key (an X-Wing seed) sealed under the epoch's key. It rotates when a device or a sealing owner
//!   leaves;
//! - a **Doc's** epoch: its stanzas go to the Doc's readers, vaults and groups by their seal keys. It rotates at the
//!   next write after a reader leaves, and nothing already written is sealed again: the old epoch keeps its bytes and
//!   its readers, and a removed reader opens no later epoch (`rotation_shuts_out`).
//!
//! The blob is a Core Value with `scheme: "flat 1"`; its name is BLAKE3 of the blob without its stanzas
//! (`name_ignores_stanzas`), so sealing it to one more reader with [`Epoch::reseal`] doesn't rename it.

use std::fmt;

use aven_core::{Value, decode, encode};
use subtle::ConstantTimeEq;

use crate::seal::{Context, SEALED_LEN, Scope, SealKey, SealPublic, Stanza, unwrap_key, wrap_key};
use crate::secret::{Entropy, Secret};
use crate::value::{bytes, fields, text};

pub const COMMIT_LABEL: &str = "avenID commit 1";
pub const BACK_LABEL: &str = "avenID back 1";
pub const VAULT_LABEL: &str = "avenID keyring vault 1";
pub const SCHEME: &str = "flat 1";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum KeyError {
    /// No stanza of this epoch is sealed to the key.
    NotSealedTo,
    /// The key isn't the one the epoch commits to.
    WrongKey,
    /// The epoch carries no `back`: the first, or a `from-now` rotation.
    NoBack,
    /// A keyring's act on a Doc's epoch, or the other way round.
    WrongScope,
    /// An epoch sealed to nobody.
    NoReaders,
}

impl fmt::Display for KeyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            KeyError::NotSealedTo => "no stanza is sealed to this key",
            KeyError::WrongKey => "not the key the epoch commits to",
            KeyError::NoBack => "the epoch carries no back",
            KeyError::WrongScope => "a keyring's act on a Doc, or a Doc's on a keyring",
            KeyError::NoReaders => "an epoch must be sealed to someone",
        })
    }
}

impl std::error::Error for KeyError {}

/// Whether a Doc's new epoch opens its history (`history: all`) or not (`from-now`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum History {
    All,
    FromNow,
}

/// An epoch's commitment to its key: `keyed_hash(key, "avenID commit 1")`.
pub fn commit(key: &Secret) -> [u8; 32] {
    *blake3::keyed_hash(key.expose(), COMMIT_LABEL.as_bytes()).as_bytes()
}

/// The subkey of `key` for `label`.
pub fn subkey(label: &str, key: &Secret) -> Secret {
    Secret::take(&mut blake3::derive_key(label, key.expose()))
}

/// A reader's tag for an epoch: `keyed_hash(seed, encode({id, epoch}))`.
pub fn tag(seed: &Secret, id: &str, epoch: u64) -> [u8; 32] {
    let at = encode(&Value::Map(vec![
        ("id".into(), text(id)),
        ("epoch".into(), Value::Uint(epoch)),
    ]));
    *blake3::keyed_hash(seed.expose(), &at).as_bytes()
}

/// One epoch's key blob.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Epoch {
    pub scope: Scope,
    /// The vault whose keyring it is, or the Doc.
    pub owner: String,
    pub n: u64,
    /// The names of the epochs it follows.
    pub prev: Vec<[u8; 32]>,
    pub stanzas: Vec<Stanza>,
    pub commit: [u8; 32],
    /// The previous epoch's key, sealed under this one.
    pub back: Option<[u8; SEALED_LEN]>,
    /// A keyring's vault key (its X-Wing seed), sealed under this epoch's key.
    pub vault_key: Option<[u8; SEALED_LEN]>,
}

impl Epoch {
    fn context(&self) -> Context<'_> {
        Context {
            scope: self.scope,
            owner: &self.owner,
            n: self.n,
        }
    }

    fn make(
        scope: Scope,
        owner: &str,
        prev: Option<(&Epoch, &Secret)>,
        history: History,
        vault_key: Option<&SealKey>,
        to: &[SealPublic],
        entropy: &mut impl Entropy,
    ) -> Result<(Epoch, Secret), KeyError> {
        if to.is_empty() {
            return Err(KeyError::NoReaders);
        }
        let n = prev.map_or(1, |(p, _)| p.n + 1);
        let key = Secret::generate(entropy);
        let context = Context { scope, owner, n };
        let inner = context.inner_aad();
        let stanzas = to
            .iter()
            .map(|reader| Stanza::seal(&key, reader, &context, entropy))
            .collect();
        let back = match (prev, history) {
            (Some((_, prev_key)), History::All) => {
                Some(wrap_key(&subkey(BACK_LABEL, &key), &inner, prev_key))
            }
            _ => None,
        };
        let vault_key =
            vault_key.map(|vault| wrap_key(&subkey(VAULT_LABEL, &key), &inner, &vault.seed()));
        let epoch = Epoch {
            scope,
            owner: owner.to_string(),
            n,
            prev: prev.map(|(p, _)| vec![p.name()]).unwrap_or_default(),
            stanzas,
            commit: commit(&key),
            back,
            vault_key,
        };
        Ok((epoch, key))
    }

    /// A vault's first keyring epoch: `vault_key` inside, sealed to its devices and its passkeys' seal keys.
    pub fn keyring(
        vault: &str,
        vault_key: &SealKey,
        to: &[SealPublic],
        entropy: &mut impl Entropy,
    ) -> Result<(Epoch, Secret), KeyError> {
        Epoch::make(
            Scope::Keyring,
            vault,
            None,
            History::All,
            Some(vault_key),
            to,
            entropy,
        )
    }

    /// A Doc's first epoch, sealed to its readers.
    pub fn doc(
        doc: &str,
        readers: &[SealPublic],
        entropy: &mut impl Entropy,
    ) -> Result<(Epoch, Secret), KeyError> {
        Epoch::make(Scope::Doc, doc, None, History::All, None, readers, entropy)
    }

    /// The keyring's next epoch, when a device or a sealing owner leaves: sealed to those who remain, with
    /// `vault_key` inside (the same, or a new one in a heal), and this epoch's key behind it.
    pub fn rotate_keyring(
        &self,
        key: &Secret,
        vault_key: &SealKey,
        to: &[SealPublic],
        entropy: &mut impl Entropy,
    ) -> Result<(Epoch, Secret), KeyError> {
        self.scoped(Scope::Keyring)?;
        self.check(key)?;
        Epoch::make(
            Scope::Keyring,
            &self.owner,
            Some((self, key)),
            History::All,
            Some(vault_key),
            to,
            entropy,
        )
    }

    /// The Doc's next epoch, sealed to its readers now. Nothing written under this one is sealed again.
    pub fn rotate_doc(
        &self,
        key: &Secret,
        readers: &[SealPublic],
        history: History,
        entropy: &mut impl Entropy,
    ) -> Result<(Epoch, Secret), KeyError> {
        self.scoped(Scope::Doc)?;
        self.check(key)?;
        Epoch::make(
            Scope::Doc,
            &self.owner,
            Some((self, key)),
            history,
            None,
            readers,
            entropy,
        )
    }

    fn scoped(&self, scope: Scope) -> Result<(), KeyError> {
        if self.scope == scope {
            Ok(())
        } else {
            Err(KeyError::WrongScope)
        }
    }

    /// Whether `key` is this epoch's, in constant time.
    pub fn check(&self, key: &Secret) -> Result<(), KeyError> {
        if bool::from(commit(key).ct_eq(&self.commit)) {
            Ok(())
        } else {
            Err(KeyError::WrongKey)
        }
    }

    /// The epoch's key, from the stanza sealed to `key`: a stanza whose key isn't the one committed to opens nothing.
    pub fn open(&self, key: &SealKey) -> Result<Secret, KeyError> {
        let context = self.context();
        let mut wrong = false;
        for stanza in &self.stanzas {
            if let Some(opened) = stanza.open(key, &context) {
                if self.check(&opened).is_ok() {
                    return Ok(opened);
                }
                wrong = true;
            }
        }
        Err(if wrong {
            KeyError::WrongKey
        } else {
            KeyError::NotSealedTo
        })
    }

    /// Seals this epoch to one more reader, a new device or a new passkey, without rotating or renaming it.
    pub fn reseal(
        &mut self,
        key: &Secret,
        to: &SealPublic,
        entropy: &mut impl Entropy,
    ) -> Result<(), KeyError> {
        self.check(key)?;
        let stanza = Stanza::seal(key, to, &self.context(), entropy);
        self.stanzas.push(stanza);
        Ok(())
    }

    /// The previous epoch's key, opened with this one's. The caller checks it against the previous epoch.
    pub fn back(&self, key: &Secret) -> Result<Secret, KeyError> {
        self.check(key)?;
        let back = self.back.as_ref().ok_or(KeyError::NoBack)?;
        unwrap_key(&subkey(BACK_LABEL, key), &self.context().inner_aad(), back)
            .ok_or(KeyError::WrongKey)
    }

    /// A keyring's vault key, opened with the epoch's key.
    pub fn vault_key(&self, key: &Secret) -> Result<SealKey, KeyError> {
        self.scoped(Scope::Keyring)?;
        self.check(key)?;
        let sealed = self.vault_key.as_ref().ok_or(KeyError::WrongScope)?;
        unwrap_key(
            &subkey(VAULT_LABEL, key),
            &self.context().inner_aad(),
            sealed,
        )
        .map(|seed| SealKey::from_seed(&seed))
        .ok_or(KeyError::WrongKey)
    }

    /// The blob as a Value (`Aven.ID.KeyFormats.Epoch.value`).
    pub fn value(&self) -> Value {
        let mut kvs = vec![
            ("n".into(), Value::Uint(self.n)),
            ("id".into(), text(&self.owner)),
            (
                "prev".into(),
                Value::Array(self.prev.iter().map(|p| bytes(p)).collect()),
            ),
            ("scope".into(), text(self.scope.text())),
            ("commit".into(), bytes(&self.commit)),
            ("scheme".into(), text(SCHEME)),
            (
                "stanzas".into(),
                Value::Array(self.stanzas.iter().map(Stanza::value).collect()),
            ),
        ];
        if let Some(back) = &self.back {
            kvs.push(("back".into(), bytes(back)));
        }
        if let Some(vault) = &self.vault_key {
            kvs.push(("vault".into(), bytes(vault)));
        }
        Value::Map(kvs)
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        encode(&self.value())
    }

    /// The epoch's name: BLAKE3 of its blob without its stanzas.
    pub fn name(&self) -> [u8; 32] {
        let bare = Epoch {
            stanzas: Vec::new(),
            ..self.clone()
        };
        *blake3::hash(&bare.to_bytes()).as_bytes()
    }

    /// Reads only what [`Epoch::to_bytes`] writes: exactly its keys, the flat scheme, a vault key just for a keyring.
    pub fn from_bytes(blob: &[u8]) -> Option<Epoch> {
        let v = decode(blob)?;
        let f = fields(
            &v,
            &["n", "id", "prev", "scope", "commit", "scheme", "stanzas"],
            &["back", "vault"],
        )?;
        if f.text("scheme")? != SCHEME {
            return None;
        }
        let scope = Scope::parse(f.text("scope")?)?;
        let Value::Array(prev) = f.get("prev")? else {
            return None;
        };
        let Value::Array(stanzas) = f.get("stanzas")? else {
            return None;
        };
        let optional = |key: &str| match f.get(key) {
            Some(Value::Bytes(b)) => b.as_slice().try_into().ok().map(Some),
            Some(_) => None,
            None => Some(None),
        };
        let vault_key = optional("vault")?;
        if (scope == Scope::Keyring) != vault_key.is_some() {
            return None;
        }
        Some(Epoch {
            scope,
            owner: f.text("id")?.to_string(),
            n: f.uint("n")?,
            prev: prev
                .iter()
                .map(|p| match p {
                    Value::Bytes(b) => b.as_slice().try_into().ok(),
                    _ => None,
                })
                .collect::<Option<_>>()?,
            stanzas: stanzas
                .iter()
                .map(Stanza::of_value)
                .collect::<Option<_>>()?,
            commit: f.array("commit")?,
            back: optional("back")?,
            vault_key,
        })
    }
}
