//! The wire (P8): what devices send each other, as bytes, and back. An edit keeps the bytes its id hashes (`encode`); a
//! signed edit adds its signatures, and the messages of a sync wrap what `sync` asks and answers: a device's hello on a
//! connection, its request (`Request`), the reply (`Reply`), and the digests it announces (`Announce`). A new device
//! links (P8c) with its passkey's hello (`PasskeyHello`), then joins its person's vault (`Join`); a device with no UDP
//! of its own reaches the server's relay first by its passkey's pass (`RelayPass`, P8d). The first human vault to
//! claim a server nobody has claimed yet (`Claim`) owns it: the server becomes a device of the aven vault avenCEO,
//! which that human vault owns.
//!
//! Every value has exactly one encoding, and a decoder takes only bytes that encode back to themselves: integers are
//! big-endian and fixed-size, sequences carry their length, every enum starts with a tag, sets go smallest first with
//! no repeats, and nothing may follow the value. So two devices never read one message two ways. Nothing a peer sends
//! can make a device panic, or allocate more than a few times what it sent: a count is checked against the bytes left
//! before anything is made of it. The mutation fuzzing covers every decoder (`tests/fuzz.rs`).

use std::collections::BTreeMap;

use crate::encode::{Encode, VERSION};
use crate::id::{BlobId, CapId, CellId, EditId, EntryId, SignerId, VaultId};
use crate::keys::{KeyBox, KeyFam, KeyId, KeyName, PublicKey, Recipient};
use crate::policy::{Action, Cap, Edit, Grantee, Kind, Principal, Proposal, Role};
use crate::sign::{Assertion, Classical, Hello, PasskeyHello, RelayPass, Signature, SignerKeys, Signed};
use crate::sync::{Ask, LogId, Place};

/// Why bytes from a peer are no message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WireError {
    /// The bytes end before the value does.
    Short,
    /// Bytes are left over after the value.
    Trailing,
    /// A tag, a flag or a version this format doesn't have.
    Unknown,
    /// A set out of order or with a repeat, which would encode another way.
    Unordered,
}

impl std::fmt::Display for WireError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            WireError::Short => "the message ends too soon",
            WireError::Trailing => "bytes follow the message",
            WireError::Unknown => "a tag, flag or version the format doesn't have",
            WireError::Unordered => "a set out of order or with a repeat",
        })
    }
}

impl std::error::Error for WireError {}

/// A value that crosses the wire: one encoding each, read back only from exactly those bytes.
pub trait Wire: Sized {
    fn to_wire(&self) -> Vec<u8>;
    fn from_wire(bytes: &[u8]) -> Result<Self, WireError>;
}

macro_rules! wire {
    ($($t:ty),*) => {$(
        impl Wire for $t {
            fn to_wire(&self) -> Vec<u8> {
                let mut out = vec![];
                self.encode(&mut out);
                out
            }

            fn from_wire(bytes: &[u8]) -> Result<Self, WireError> {
                let mut r = Reader { bytes, at: 0 };
                let value = <$t as Decode>::decode(&mut r)?;
                if r.at == bytes.len() { Ok(value) } else { Err(WireError::Trailing) }
            }
        }
    )*};
}

wire!(Signed, Ask, Hello, Request, Reply, Announce, PasskeyHello, Join, RelayPass, Claim, PublicKey);

/// An edit on the wire is the bytes its id hashes (`encode::bytes`): the format's version, then the edit.
impl Wire for Edit {
    fn to_wire(&self) -> Vec<u8> {
        crate::encode::bytes(self)
    }

    fn from_wire(bytes: &[u8]) -> Result<Self, WireError> {
        let mut r = Reader { bytes, at: 0 };
        let edit = versioned(&mut r)?;
        if r.at == bytes.len() { Ok(edit) } else { Err(WireError::Trailing) }
    }
}

/// An edit behind the format's version.
fn versioned(r: &mut Reader<'_>) -> Result<Edit, WireError> {
    if r.u8()? != VERSION {
        return Err(WireError::Unknown);
    }
    Edit::decode(r)
}

/// What a device sends a peer to sync with it: what it holds of each log the peer may hold, by its own view (`Ask`),
/// and the McEliece keys it lacks that edits of those logs name. Asking on for the next page of a reply, the place of
/// the last edit it got.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Request {
    pub ask: Ask,
    /// Smallest first, no repeats.
    pub wants: Vec<BlobId>,
    /// The peer sends only edits after this place (`sync::place`).
    pub after: Option<Place>,
}

/// What the peer sends back: a page of the edits the device may receive beyond what it asked with
/// (`sync::respond_since`), by their place, and of each McEliece key those edits or the request name that the peer
/// holds and the device may fetch, its id and the hash it is fetched by (iroh-blobs' BLAKE3). The device checks each
/// key against its id once it has it. If more edits are left, the device asks on after the last place it got.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Reply {
    pub edits: Vec<Signed>,
    /// Smallest id first, no repeats.
    pub blobs: Vec<(BlobId, [u8; 32])>,
    pub more: bool,
}

/// The digest of each log a device holds that the peer may hold too (`sync::digests`), as it tells the peer each time
/// one changes: the peer asks it when one differs from its own.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Announce {
    /// Smallest log first, no repeats.
    pub digests: Vec<(LogId, [u8; 32])>,
}

/// What a new device sends the peer its passkey proved itself to (P8c), once it holds the passkey's link card: the edit
/// adding it to its person's vault, signed by the passkey and by itself (`Lab::join`), and the McEliece key that edit
/// names, its own. The peer accepts that edit alone (`Lab::accept_join`).
#[derive(Clone, PartialEq, Eq)]
pub struct Join {
    pub edit: Signed,
    pub blobs: Vec<Vec<u8>>,
}

/// The McEliece keys show only their sizes.
impl std::fmt::Debug for Join {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let blobs: Vec<String> = self.blobs.iter().map(|b| format!("{} bytes", b.len())).collect();
        f.debug_struct("Join").field("edit", &self.edit).field("blobs", &blobs).finish()
    }
}

/// What a device of a human vault sends a server no vault has claimed yet to claim it (P8f, `Lab::claim`): the logs
/// of the vaults the device acts for (its contact card, among them the new aven vault avenCEO, which its human vault
/// owns), the edit adding the server as a device of avenCEO, sealing to the key the server handed for it
/// (`Lab::claim_key`), and the signatures of every signer of that edit but the server, in the order the edit names
/// them. The server signs last, in its place, and keeps it all (`Lab::accept_claim`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Claim {
    pub card: Vec<Signed>,
    pub add: Edit,
    pub sigs: Vec<Signature>,
}

/// A cursor over bytes a peer sent.
pub(crate) struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], WireError> {
        let end = self.at.checked_add(n).filter(|&e| e <= self.bytes.len()).ok_or(WireError::Short)?;
        let out = &self.bytes[self.at..end];
        self.at = end;
        Ok(out)
    }

    fn u8(&mut self) -> Result<u8, WireError> {
        Ok(self.take(1)?[0])
    }

    fn array<const N: usize>(&mut self) -> Result<[u8; N], WireError> {
        Ok(self.take(N)?.try_into().expect("N bytes"))
    }

    /// A count of values, each at least `min` bytes long: never more than the bytes left can hold.
    fn count(&mut self, min: usize) -> Result<usize, WireError> {
        let n = u32::from_be_bytes(self.array()?) as usize;
        if n.saturating_mul(min.max(1)) > self.bytes.len() - self.at { Err(WireError::Short) } else { Ok(n) }
    }

    /// Bytes behind their length.
    fn bytes(&mut self) -> Result<Vec<u8>, WireError> {
        let n = self.count(1)?;
        Ok(self.take(n)?.to_vec())
    }

    /// A sequence behind its count, each value at least `min` bytes long.
    fn seq<T: Decode>(&mut self, min: usize) -> Result<Vec<T>, WireError> {
        let n = self.count(min)?;
        let mut out = Vec::with_capacity(n.min(64));
        for _ in 0..n {
            out.push(T::decode(self)?);
        }
        Ok(out)
    }

    /// `seq`, of a set: smallest first, no repeats.
    fn set<T: Decode + Ord>(&mut self, min: usize) -> Result<Vec<T>, WireError> {
        let out: Vec<T> = self.seq(min)?;
        if out.windows(2).all(|w| w[0] < w[1]) { Ok(out) } else { Err(WireError::Unordered) }
    }

    fn option<T: Decode>(&mut self) -> Result<Option<T>, WireError> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(T::decode(self)?)),
            _ => Err(WireError::Unknown),
        }
    }
}

/// The inverse of `Encode`, from bytes a peer sent.
pub(crate) trait Decode: Sized {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError>;
}

impl Decode for u32 {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(u32::from_be_bytes(r.array()?))
    }
}

impl Decode for u64 {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(u64::from_be_bytes(r.array()?))
    }
}

impl<const N: usize> Decode for [u8; N] {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        r.array()
    }
}

/// Bytes behind their length.
impl Decode for Vec<u8> {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        r.bytes()
    }
}

impl<A: Decode, B: Decode> Decode for (A, B) {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok((A::decode(r)?, B::decode(r)?))
    }
}

macro_rules! ids {
    ($($t:ty),*) => {$(
        impl Decode for $t {
            fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
                Ok(Self(r.array()?))
            }
        }
    )*};
}

ids!(SignerId, VaultId, EntryId, CapId, CellId, EditId, BlobId, KeyId);

impl Decode for bool {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for PublicKey {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(PublicKey { xwing: r.bytes()?, mceliece: BlobId::decode(r)? })
    }
}

impl Decode for KeyFam {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(KeyFam::Seed(VaultId::decode(r)?)),
            1 => Ok(KeyFam::Cap(VaultId::decode(r)?, CapId::decode(r)?)),
            2 => Ok(KeyFam::Cell(VaultId::decode(r)?, CellId::decode(r)?)),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for KeyName {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(KeyName::Signer(SignerId::decode(r)?)),
            1 => Ok(KeyName::Scoped(KeyFam::decode(r)?, u64::decode(r)?)),
            2 => Ok(KeyName::Entry(EntryId::decode(r)?, r.option()?, u64::decode(r)?)),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for Recipient {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Recipient::Signer(SignerId::decode(r)?)),
            1 => Ok(Recipient::Key { name: KeyName::decode(r)?, id: KeyId::decode(r)? }),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for KeyBox {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(KeyBox { to: Recipient::decode(r)?, bytes: r.bytes()? })
    }
}

impl Decode for Kind {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Kind::Human),
            1 => Ok(Kind::Coop),
            2 => Ok(Kind::Aven),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for Principal {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Principal::Signer(SignerId::decode(r)?)),
            1 => Ok(Principal::Vault(VaultId::decode(r)?)),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for Role {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Role::Relay),
            1 => Ok(Role::Read),
            2 => Ok(Role::Write),
            3 => Ok(Role::Owner),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for Grantee {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Grantee::Principal(Principal::decode(r)?)),
            1 => Ok(Grantee::Public),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for Cap {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Cap {
            over: VaultId::decode(r)?,
            grantee: Grantee::decode(r)?,
            role: Role::decode(r)?,
            wide: bool::decode(r)?,
            select: r.bytes()?,
            parent: r.option()?,
            issuer: VaultId::decode(r)?,
            nonce: u64::decode(r)?,
        })
    }
}

impl Decode for Proposal {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Proposal::Main),
            1 => Ok(Proposal::New),
            2 => Ok(Proposal::On(EditId::decode(r)?)),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for Action {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(match r.u8()? {
            0 => Action::Genesis {
                kind: Kind::decode(r)?,
                owners: r.seq(33)?,
                threshold: u32::decode(r)?,
                root: r.option()?,
                nonce: u64::decode(r)?,
                seal_to: r.seq(68)?,
            },
            1 => Action::AddOwner { vault: VaultId::decode(r)?, owner: Principal::decode(r)?, seal_to: r.option()? },
            2 => Action::RemoveOwner { vault: VaultId::decode(r)?, owner: Principal::decode(r)?, keep: r.seq(32)? },
            3 => Action::SetThreshold { vault: VaultId::decode(r)?, threshold: u32::decode(r)? },
            4 => Action::AddDevice { vault: VaultId::decode(r)?, device: SignerId::decode(r)?, seal_to: r.option()? },
            5 => Action::RemoveDevice { vault: VaultId::decode(r)?, device: SignerId::decode(r)?, keep: r.seq(32)? },
            6 => Action::SetRoot { vault: VaultId::decode(r)?, root: r.option()?, keep: r.seq(32)? },
            7 => Action::Cap(Cap::decode(r)?, r.seq(32)?),
            8 => Action::Revoke {
                cap: CapId::decode(r)?,
                actor: VaultId::decode(r)?,
                keep: r.seq(32)?,
                via: r.seq(32)?,
            },
            9 => Action::Write {
                vault: VaultId::decode(r)?,
                entry: EntryId::decode(r)?,
                actor: VaultId::decode(r)?,
                stay: r.option()?,
                generation: u64::decode(r)?,
                deps: r.seq(32)?,
                proposal: Proposal::decode(r)?,
                via: r.seq(32)?,
                create: match r.u8()? {
                    0 => None,
                    1 => Some(r.seq(32)?),
                    _ => return Err(WireError::Unknown),
                },
                body: r.bytes()?,
            },
            10 => Action::Move {
                vault: VaultId::decode(r)?,
                entry: EntryId::decode(r)?,
                to: r.seq(32)?,
                keep: r.seq(32)?,
                via: r.seq(32)?,
            },
            11 => Action::Keys {
                name: KeyName::decode(r)?,
                id: KeyId::decode(r)?,
                public: r.option()?,
                boxes: r.seq(37)?,
                clear: r.option()?,
            },
            12 => Action::Publish {
                vault: VaultId::decode(r)?,
                actor: VaultId::decode(r)?,
                via: r.seq(32)?,
                blob: r.bytes()?,
            },
            13 => Action::Checkpoint { entry: EntryId::decode(r)?, covers: r.seq(32)? },
            _ => return Err(WireError::Unknown),
        })
    }
}

impl Decode for Edit {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Edit {
            parents: r.seq(32)?,
            depth: u64::decode(r)?,
            author: SignerId::decode(r)?,
            cosigners: r.seq(32)?,
            action: Action::decode(r)?,
        })
    }
}

impl Encode for SignerKeys {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            SignerKeys::Device { ed25519, slh } => {
                out.push(0);
                ed25519.encode(out);
                slh.encode(out);
            }
            SignerKeys::Passkey { p256, slh } => {
                out.push(1);
                p256.encode(out);
                slh.encode(out);
            }
        }
    }
}

impl Decode for SignerKeys {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(SignerKeys::Device { ed25519: r.array()?, slh: r.array()? }),
            1 => Ok(SignerKeys::Passkey { p256: r.array()?, slh: r.array()? }),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Encode for Classical {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Classical::Ed25519(sig) => {
                out.push(0);
                sig.encode(out);
            }
            Classical::Passkey(a) => {
                out.push(1);
                a.encode(out);
            }
            Classical::Batch { assertion, edits } => {
                out.push(2);
                assertion.encode(out);
                edits.encode(out);
            }
        }
    }
}

impl Decode for Classical {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Classical::Ed25519(r.array()?)),
            1 => Ok(Classical::Passkey(Assertion::decode(r)?)),
            2 => Ok(Classical::Batch { assertion: Assertion::decode(r)?, edits: r.set(32)? }),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Encode for Assertion {
    fn encode(&self, out: &mut Vec<u8>) {
        self.authenticator_data.encode(out);
        self.client_data_json.encode(out);
        self.signature.encode(out);
    }
}

impl Decode for Assertion {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Assertion { authenticator_data: r.bytes()?, client_data_json: r.bytes()?, signature: r.bytes()? })
    }
}

impl Encode for Signature {
    fn encode(&self, out: &mut Vec<u8>) {
        self.keys.encode(out);
        self.classical.encode(out);
        self.pq.encode(out);
    }
}

impl Decode for Signature {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Signature {
            keys: SignerKeys::decode(r)?,
            classical: Classical::decode(r)?,
            pq: match r.u8()? {
                0 => None,
                1 => Some(r.bytes()?),
                _ => return Err(WireError::Unknown),
            },
        })
    }
}

/// The edit as its id hashes it, then its signatures.
impl Encode for Signed {
    fn encode(&self, out: &mut Vec<u8>) {
        out.push(VERSION);
        self.edit.encode(out);
        self.sigs.encode(out);
    }
}

impl Decode for Signed {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Signed { edit: versioned(r)?, sigs: r.seq(79)? })
    }
}

impl Encode for LogId {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            LogId::Vault(v) => {
                out.push(0);
                v.encode(out);
            }
            LogId::Cap(c) => {
                out.push(1);
                c.encode(out);
            }
            LogId::Cell(v, x) => {
                out.push(2);
                v.encode(out);
                x.encode(out);
            }
            LogId::Entry(e) => {
                out.push(3);
                e.encode(out);
            }
        }
    }
}

impl Decode for LogId {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(LogId::Vault(VaultId::decode(r)?)),
            1 => Ok(LogId::Cap(CapId::decode(r)?)),
            2 => Ok(LogId::Cell(VaultId::decode(r)?, CellId::decode(r)?)),
            3 => Ok(LogId::Entry(EntryId::decode(r)?)),
            _ => Err(WireError::Unknown),
        }
    }
}

/// Of each log, smallest first, the edits named of it, smallest first; then the loose edits, smallest first.
impl Encode for Ask {
    fn encode(&self, out: &mut Vec<u8>) {
        (self.haves.len() as u32).encode(out);
        for (log, ids) in &self.haves {
            log.encode(out);
            ids.encode(out);
        }
        self.loose.encode(out);
    }
}

impl Decode for Ask {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let n = r.count(37)?;
        let mut haves = BTreeMap::new();
        let mut last: Option<LogId> = None;
        for _ in 0..n {
            let log = LogId::decode(r)?;
            if last.is_some_and(|l| l >= log) {
                return Err(WireError::Unordered);
            }
            last = Some(log);
            haves.insert(log, r.set(32)?);
        }
        Ok(Ask { haves, loose: r.set(32)? })
    }
}

impl Encode for Hello {
    fn encode(&self, out: &mut Vec<u8>) {
        self.keys.encode(out);
        self.sig.encode(out);
    }
}

impl Decode for Hello {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Hello { keys: SignerKeys::decode(r)?, sig: r.bytes()? })
    }
}

impl Encode for PasskeyHello {
    fn encode(&self, out: &mut Vec<u8>) {
        self.keys.encode(out);
        self.assertion.encode(out);
        self.sig.encode(out);
    }
}

impl Decode for PasskeyHello {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(PasskeyHello { keys: SignerKeys::decode(r)?, assertion: Assertion::decode(r)?, sig: r.bytes()? })
    }
}

impl Encode for RelayPass {
    fn encode(&self, out: &mut Vec<u8>) {
        self.keys.encode(out);
        self.assertion.encode(out);
        self.sig.encode(out);
        self.endpoint.encode(out);
        self.made.encode(out);
    }
}

impl Decode for RelayPass {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let (keys, assertion, sig) = (SignerKeys::decode(r)?, Assertion::decode(r)?, r.bytes()?);
        Ok(RelayPass { keys, assertion, sig, endpoint: r.array()?, made: u64::decode(r)? })
    }
}

impl Encode for Join {
    fn encode(&self, out: &mut Vec<u8>) {
        self.edit.encode(out);
        self.blobs.encode(out);
    }
}

impl Decode for Join {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Join { edit: Signed::decode(r)?, blobs: r.seq(4)? })
    }
}

/// The code, the card, the edit as its id hashes it, then the signatures.
impl Encode for Claim {
    fn encode(&self, out: &mut Vec<u8>) {
        self.card.encode(out);
        out.push(VERSION);
        self.add.encode(out);
        self.sigs.encode(out);
    }
}

impl Decode for Claim {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Claim { card: r.seq(76)?, add: versioned(r)?, sigs: r.seq(79)? })
    }
}

impl Encode for Request {
    fn encode(&self, out: &mut Vec<u8>) {
        self.ask.encode(out);
        self.wants.encode(out);
        self.after.encode(out);
    }
}

impl Decode for Request {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Request { ask: Ask::decode(r)?, wants: r.set(32)?, after: r.option()? })
    }
}

impl Encode for Reply {
    fn encode(&self, out: &mut Vec<u8>) {
        self.edits.encode(out);
        self.blobs.encode(out);
        out.push(u8::from(self.more));
    }
}

impl Decode for Reply {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let (edits, blobs) = (r.seq(76)?, r.set(64)?);
        let more = match r.u8()? {
            0 => false,
            1 => true,
            _ => return Err(WireError::Unknown),
        };
        Ok(Reply { edits, blobs, more })
    }
}

impl Encode for Announce {
    fn encode(&self, out: &mut Vec<u8>) {
        self.digests.encode(out);
    }
}

impl Decode for Announce {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Announce { digests: r.set(65)? })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast::{handbook, world};
    use crate::sign::DeviceKey;

    #[test]
    fn every_edit_and_signature_of_a_world_reads_back_the_same() {
        let mut w = world();
        let h = handbook(&mut w);
        let mut kinds = std::collections::HashSet::new();
        for d in [w.mac_a, w.mac_b, w.server] {
            for edit in w.lab.log(d).edits() {
                let signed = w.lab.signed_edit(d, edit.id()).expect("held").clone();
                let bytes = signed.to_wire();
                assert_eq!(Signed::from_wire(&bytes), Ok(signed.clone()));
                assert_eq!(Edit::from_wire(&edit.to_wire()).as_ref(), Ok(edit));
                assert_eq!(
                    edit.to_wire(),
                    crate::encode::bytes(edit),
                    "an edit on the wire is the bytes its id hashes"
                );
                kinds.insert(std::mem::discriminant(&edit.action));
            }
        }
        assert!(kinds.len() >= 6, "genesis, devices, keys, spaces, grants and writes all crossed: {}", kinds.len());
        let ask = crate::sync::asks(w.lab.log(w.mac_b).edits());
        assert!(!ask.haves.is_empty());
        assert_eq!(Ask::from_wire(&ask.to_wire()), Ok(ask.clone()));
        let digests: Vec<(LogId, [u8; 32])> = w.lab.digests(w.mac_b).iter().map(|(l, d)| (*l, *d)).collect();
        let announce = Announce { digests };
        assert_eq!(Announce::from_wire(&announce.to_wire()), Ok(announce));
        let _ = h;
    }

    #[test]
    fn a_claim_reads_back_the_same() {
        let w = world();
        let card = w.lab.card(w.server);
        let joined = |s: &&Signed| matches!(s.edit.action, Action::AddDevice { device, .. } if device == w.server);
        let add = card.iter().find(joined).expect("the edit that added the server").clone();
        let claim = Claim { card: card.clone(), add: add.edit.clone(), sigs: add.sigs[..1].to_vec() };
        assert_eq!(Claim::from_wire(&claim.to_wire()), Ok(claim));
    }

    #[test]
    fn a_signature_of_edits_signed_together_reads_back_only_in_their_order() {
        let w = world();
        let edits: Vec<Edit> = w.lab.log(w.mac_a).edits()[..2].to_vec();
        let mut batch: Vec<EditId> = edits.iter().map(Edit::id).collect();
        batch.sort();
        let mut passkey = crate::sign::Passkey::from_seed([1; 32]);
        let ceremony = passkey.ceremony(crate::sign::batch_challenge(&batch));
        let sig = ceremony.sign_in(passkey.keys(), edits[0].id(), &batch, true).expect("its signature");
        assert!(matches!(&sig.classical, Classical::Batch { edits, .. } if *edits == batch), "it names both edits");
        let signed = Signed { edit: edits[0].clone(), sigs: vec![sig] };
        let bytes = signed.to_wire();
        assert_eq!(Signed::from_wire(&bytes), Ok(signed));
        // the same ids the other way round encode another value, which no decoder takes
        let (a, b) = (&batch[0].0, &batch[1].0);
        let at = bytes.windows(64).position(|w| w == [&a[..], &b[..]].concat()).expect("the batch's ids");
        let mut swapped = bytes.clone();
        swapped[at..at + 64].copy_from_slice(&[&b[..], &a[..]].concat());
        assert_eq!(Signed::from_wire(&swapped), Err(WireError::Unordered));
    }

    #[test]
    fn a_value_reads_back_only_from_its_own_bytes() {
        let key = DeviceKey::from_secret([3; 32]);
        let hello = key.hello(&[5; 32], false);
        let bytes = hello.to_wire();
        assert_eq!(Hello::from_wire(&bytes), Ok(hello));
        // cut short, grown, or with a tag the format doesn't have
        assert_eq!(Hello::from_wire(&bytes[..bytes.len() - 1]), Err(WireError::Short));
        assert_eq!(Hello::from_wire(&[&bytes[..], &[0]].concat()), Err(WireError::Trailing));
        assert_eq!(Hello::from_wire(&[&[7], &bytes[1..]].concat()), Err(WireError::Unknown));
        // sets out of order, or repeated
        let (a, b) = (BlobId([1; 32]), BlobId([2; 32]));
        let ok = Request { ask: Ask::default(), wants: vec![a, b], after: Some((7, EditId([4; 32]))) };
        assert_eq!(Request::from_wire(&ok.to_wire()), Ok(ok));
        for wants in [vec![b, a], vec![a, a]] {
            let bytes = Request { ask: Ask::default(), wants, after: None }.to_wire();
            assert_eq!(Request::from_wire(&bytes), Err(WireError::Unordered));
        }
        let (x, y) = (LogId::Vault(VaultId([1; 32])), LogId::Space(SpaceId([0; 32])));
        let mut ask = Ask::default();
        ask.haves.insert(y, vec![]);
        ask.haves.insert(x, vec![EditId([1; 32])]);
        let mut bytes = ask.to_wire();
        assert_eq!(Ask::from_wire(&bytes), Ok(ask));
        // swap the two logs: the vault's log (37 bytes, then its one edit) after the space's
        let (first, rest) = bytes[4..].split_at(33 + 4 + 32);
        let swapped = [&rest[..33 + 4], first].concat();
        bytes.splice(4..4 + swapped.len(), swapped);
        assert_eq!(Ask::from_wire(&bytes), Err(WireError::Unordered));
        // an edit of another format version
        let action = Action::SetThreshold { vault: VaultId([2; 32]), threshold: 1 };
        let edit = Edit { parents: vec![], depth: 0, author: SignerId([1; 32]), cosigners: vec![], action };
        let mut bytes = edit.to_wire();
        bytes[0] = VERSION + 1;
        assert_eq!(Edit::from_wire(&bytes), Err(WireError::Unknown));
    }

    #[test]
    fn a_page_says_in_one_byte_whether_more_is_left() {
        let page = Reply { more: true, ..Reply::default() };
        let mut bytes = page.to_wire();
        assert_eq!(Reply::from_wire(&bytes), Ok(page));
        *bytes.last_mut().expect("the flag") = 2;
        assert_eq!(Reply::from_wire(&bytes), Err(WireError::Unknown));
        // asking on after a place: its flag, its depth, its id
        let ask_on = Request { after: Some((3, EditId([9; 32]))), ..Request::default() };
        let mut bytes = ask_on.to_wire();
        assert_eq!(Request::from_wire(&bytes), Ok(ask_on));
        let flag = bytes.len() - 41;
        bytes[flag] = 2;
        assert_eq!(Request::from_wire(&bytes), Err(WireError::Unknown));
    }

    #[test]
    fn a_made_up_count_allocates_nothing() {
        // four billion edits claimed in eight bytes: refused before anything is made of them
        let bytes = [0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0];
        assert_eq!(Reply::from_wire(&bytes), Err(WireError::Short));
        assert_eq!(Announce::from_wire(&bytes[..4]), Err(WireError::Short));
    }
}
