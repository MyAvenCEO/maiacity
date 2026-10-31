//! Epochs of keys (id/caps/README.md, "The layers", "Epochs"; `Aven.ID.Epochs`, `Aven.ID.Forget`).
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
//! An epoch is named by the BLAKE3 hash of everything but its stanzas, so adding a reader with [`Epoch::reseal`]
//! doesn't rename it; each stanza's key is checked against the commitment, so a stanza with a wrong key opens nothing.

use std::fmt;

use crate::seal::{
    BACK_LABEL, Context, Scope, SealKey, SealPublic, Stanza, VAULT_LABEL, WRAPPED_LEN, commit,
    commits, put, subkey, unwrap_key, wrap_key,
};
use crate::secret::{Entropy, Secret};

const DOMAIN: &[u8] = b"avenID epoch 1\0";

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

/// One epoch's key blob.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Epoch {
    pub scope: Scope,
    /// The vault whose keyring it is, or the Doc.
    pub owner: String,
    pub n: u64,
    /// The previous epoch's name.
    pub prev: Option<[u8; 32]>,
    pub stanzas: Vec<Stanza>,
    pub commit: [u8; 32],
    /// The previous epoch's key, sealed under this one.
    pub back: Option<[u8; WRAPPED_LEN]>,
    /// A keyring's vault key (its X-Wing seed), sealed under this epoch's key.
    pub vault_key: Option<[u8; WRAPPED_LEN]>,
}

/// What an epoch's own key seals, besides stanzas: bound to the epoch, under a subkey used once.
fn inner_aad(label: &str, scope: Scope, owner: &str, n: u64) -> Vec<u8> {
    let mut out = label.as_bytes().to_vec();
    out.push(0);
    out.push(scope as u8);
    put(&mut out, owner.as_bytes());
    out.extend_from_slice(&n.to_be_bytes());
    out
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
        let stanzas = to
            .iter()
            .map(|reader| Stanza::seal(&key, reader, &context, entropy))
            .collect();
        let back = match (prev, history) {
            (Some((_, prev_key)), History::All) => Some(wrap_key(
                &subkey(BACK_LABEL, &key),
                &inner_aad(BACK_LABEL, scope, owner, n),
                prev_key,
            )),
            _ => None,
        };
        let vault_key = vault_key.map(|vault| {
            wrap_key(
                &subkey(VAULT_LABEL, &key),
                &inner_aad(VAULT_LABEL, scope, owner, n),
                &vault.seed(),
            )
        });
        let epoch = Epoch {
            scope,
            owner: owner.to_string(),
            n,
            prev: prev.map(|(p, _)| p.id()),
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
        if commits(key, &self.commit) {
            Ok(())
        } else {
            Err(KeyError::WrongKey)
        }
    }

    /// The epoch's key, from the stanza sealed to `key`.
    pub fn open(&self, key: &SealKey) -> Result<Secret, KeyError> {
        let context = self.context();
        let opened = self
            .stanzas
            .iter()
            .find_map(|stanza| stanza.open(key, &context))
            .ok_or(KeyError::NotSealedTo)?;
        self.check(&opened)?;
        Ok(opened)
    }

    /// Seals this epoch to one more reader, a new device or a new passkey, without rotating.
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
        unwrap_key(
            &subkey(BACK_LABEL, key),
            &inner_aad(BACK_LABEL, self.scope, &self.owner, self.n),
            back,
        )
        .ok_or(KeyError::WrongKey)
    }

    /// A keyring's vault key, opened with the epoch's key.
    pub fn vault_key(&self, key: &Secret) -> Result<SealKey, KeyError> {
        self.scoped(Scope::Keyring)?;
        self.check(key)?;
        let wrapped = self.vault_key.as_ref().ok_or(KeyError::WrongScope)?;
        unwrap_key(
            &subkey(VAULT_LABEL, key),
            &inner_aad(VAULT_LABEL, self.scope, &self.owner, self.n),
            wrapped,
        )
        .map(|seed| SealKey::from_seed(&seed))
        .ok_or(KeyError::WrongKey)
    }

    fn header(&self) -> Vec<u8> {
        let mut out = DOMAIN.to_vec();
        out.push(self.scope as u8);
        put(&mut out, self.owner.as_bytes());
        out.extend_from_slice(&self.n.to_be_bytes());
        optional(&mut out, self.prev.as_ref().map(|p| p.as_slice()));
        out.extend_from_slice(&self.commit);
        optional(&mut out, self.back.as_ref().map(|b| b.as_slice()));
        optional(&mut out, self.vault_key.as_ref().map(|v| v.as_slice()));
        out
    }

    /// The epoch's name: BLAKE3 of everything but its stanzas.
    pub fn id(&self) -> [u8; 32] {
        *blake3::hash(&self.header()).as_bytes()
    }

    /// The blob: the header, then the stanzas with their count.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = self.header();
        out.extend_from_slice(&(self.stanzas.len() as u32).to_be_bytes());
        for stanza in &self.stanzas {
            out.extend_from_slice(&stanza.to_bytes());
        }
        out
    }

    /// Reads only what [`Epoch::to_bytes`] writes: anything else, trailing bytes included, is `None`.
    pub fn from_bytes(bytes: &[u8]) -> Option<Epoch> {
        let mut r = Reader(bytes);
        if r.take(DOMAIN.len())? != DOMAIN {
            return None;
        }
        let scope = match r.byte()? {
            1 => Scope::Keyring,
            2 => Scope::Doc,
            _ => return None,
        };
        let len = u32::from_be_bytes(r.array()?) as usize;
        let owner = String::from_utf8(r.take(len)?.to_vec()).ok()?;
        let n = u64::from_be_bytes(r.array()?);
        let prev = r.optional()?;
        let commit = r.array()?;
        let back = r.optional()?;
        let vault_key = r.optional()?;
        if (scope == Scope::Keyring) != vault_key.is_some() {
            return None;
        }
        let count = u32::from_be_bytes(r.array()?) as usize;
        if count > r.0.len() / Stanza::LEN {
            return None;
        }
        let stanzas = (0..count)
            .map(|_| Stanza::from_bytes(r.take(Stanza::LEN)?))
            .collect::<Option<Vec<_>>>()?;
        if !r.0.is_empty() {
            return None;
        }
        Some(Epoch {
            scope,
            owner,
            n,
            prev,
            stanzas,
            commit,
            back,
            vault_key,
        })
    }
}

fn optional(out: &mut Vec<u8>, bytes: Option<&[u8]>) {
    match bytes {
        Some(bytes) => {
            out.push(1);
            out.extend_from_slice(bytes);
        }
        None => out.push(0),
    }
}

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        if self.0.len() < n {
            return None;
        }
        let (head, rest) = self.0.split_at(n);
        self.0 = rest;
        Some(head)
    }

    fn byte(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }

    fn array<const N: usize>(&mut self) -> Option<[u8; N]> {
        self.take(N)?.try_into().ok()
    }

    fn optional<const N: usize>(&mut self) -> Option<Option<[u8; N]>> {
        match self.byte()? {
            0 => Some(None),
            1 => Some(Some(self.array()?)),
            _ => None,
        }
    }
}
