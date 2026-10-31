//! What the safe gives back (id/caps/README.md, "The safe"; D17; `Aven.ID.Safe`). Every backend, the Secure Enclave's,
//! a Peer's process, the Peer-Light's worker, answers requests through [`Safe::handle`], so what may leave a safe is
//! decided once, as the model decides it: signatures, ciphertexts, public keys, answers and lent Doc keys, nothing
//! else. The cryptography, the cap check, the factors and the services are the [`Runtime`]'s.

/// A secret the safe holds, by name: the safe hands out handles, never the bytes.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Secret {
    /// The device's own keys, its safe-runtime key among them.
    Identity(String),
    /// A vault's keys, which its keyring holds.
    Vault(String),
    /// A group's key.
    Group(String),
    /// The safe's own key.
    Safe,
    /// A Doc's key at an epoch.
    Doc { doc: String, epoch: String },
    /// Another service's credential.
    Credential(String),
}

impl Secret {
    /// Only a Doc's key may be lent to the engine (the safe's rule 5).
    pub fn lendable(&self) -> bool {
        matches!(self, Secret::Doc { .. })
    }

    /// The keys the safe signs with.
    pub fn signer(&self) -> bool {
        matches!(self, Secret::Identity(_) | Secret::Vault(_))
    }

    /// What never leaves, not even sealed.
    pub fn kept(&self) -> bool {
        matches!(
            self,
            Secret::Identity(_) | Secret::Vault(_) | Secret::Credential(_)
        )
    }

    /// A Doc's key to a reader or to the Doc's next key, a group's key to a member vault.
    pub fn sealable_to(&self, to: &Secret) -> bool {
        match (self, to) {
            (Secret::Doc { .. }, Secret::Vault(_) | Secret::Group(_))
            | (Secret::Group(_), Secret::Vault(_)) => true,
            (Secret::Doc { doc, .. }, Secret::Doc { doc: other, .. }) => doc == other,
            _ => false,
        }
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Op {
    Unlock(String),
    Lock,
    Sign {
        key: Secret,
        msg: Vec<u8>,
    },
    /// Open a stanza sealed to `to`, and keep `inner`.
    Open {
        to: Secret,
        inner: Secret,
    },
    Seal {
        to: Secret,
        secret: Secret,
    },
    Derive {
        key: Secret,
        label: String,
    },
    Use {
        credential: String,
        call: Vec<u8>,
    },
    Enroll(String),
}

impl Op {
    /// Behind the lock and the cap: all but `unlock` and `lock`.
    pub fn gated(&self) -> bool {
        !matches!(self, Op::Unlock(_) | Op::Lock)
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Out {
    Plain(Secret),
    Sealed { to: Secret, secret: Secret },
    Signature { key: Secret, msg: Vec<u8> },
    PublicKey { key: Secret, label: String },
    Answer(Vec<u8>),
    Done,
    Refused,
}

/// What the safe runtime and the vault give the safe.
pub trait Runtime {
    fn unlocks(&self, factor: &str) -> bool;
    /// Whether the asker's `tell` cap names the act (D16).
    fn tells(&self, asker: &str, op: &Op) -> bool;
    /// The devices the vault's settled tree admits.
    fn admitted(&self, device: &str) -> bool;
    /// Whether the host lends Doc keys to its engine.
    fn lends(&self) -> bool;
    fn service(&self, credential: &str, call: &[u8]) -> Vec<u8>;
}

/// Whether the safe is unlocked, and what it holds.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Safe {
    pub unlocked: bool,
    pub holds: Vec<Secret>,
}

impl Safe {
    fn act(&mut self, runtime: &impl Runtime, op: &Op) -> Out {
        match op {
            Op::Sign { key, msg } if key.signer() && self.holds.contains(key) => Out::Signature {
                key: key.clone(),
                msg: msg.clone(),
            },
            Op::Open { to, inner } if self.holds.contains(to) => {
                let out = if inner.lendable() && runtime.lends() {
                    Out::Plain(inner.clone())
                } else {
                    Out::Done
                };
                self.holds.push(inner.clone());
                out
            }
            Op::Seal { to, secret } if self.holds.contains(secret) && secret.sealable_to(to) => {
                Out::Sealed {
                    to: to.clone(),
                    secret: secret.clone(),
                }
            }
            Op::Derive { key, label } if self.holds.contains(key) => Out::PublicKey {
                key: key.clone(),
                label: label.clone(),
            },
            Op::Use { credential, call }
                if self.holds.contains(&Secret::Credential(credential.clone())) =>
            {
                Out::Answer(runtime.service(credential, call))
            }
            Op::Enroll(device) if runtime.admitted(device) => Out::Sealed {
                to: Secret::Identity(device.clone()),
                secret: Secret::Safe,
            },
            _ => Out::Refused,
        }
    }

    /// What the safe does with `asker`'s request, and what it gives back.
    pub fn handle(&mut self, runtime: &impl Runtime, asker: &str, op: &Op) -> Out {
        match op {
            Op::Unlock(factor) if runtime.unlocks(factor) => {
                self.unlocked = true;
                Out::Done
            }
            Op::Unlock(_) => Out::Refused,
            Op::Lock => {
                self.unlocked = false;
                Out::Done
            }
            op if self.unlocked && runtime.tells(asker, op) => self.act(runtime, op),
            _ => Out::Refused,
        }
    }
}
