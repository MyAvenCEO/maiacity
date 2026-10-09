//! The wire (P8): what devices send each other, as bytes, and back. An op keeps the bytes its id hashes (`encode`); a
//! signed op adds its signatures, and the messages of a sync wrap what `sync` asks and answers: a device's hello on a
//! connection, its request (`Request`), the reply (`Reply`), and the digests it announces (`Announce`). A new device
//! links (P8c) with its passkey's hello (`PasskeyHello`), then joins its person's vault (`Join`).
//!
//! Every value has exactly one encoding, and a decoder takes only bytes that encode back to themselves: integers are
//! big-endian and fixed-size, sequences carry their length, every enum starts with a tag, sets go smallest first with
//! no repeats, and nothing may follow the value. So two devices never read one message two ways. Nothing a peer sends
//! can make a device panic, or allocate more than a few times what it sent: a count is checked against the bytes left
//! before anything is made of it. The mutation fuzzing covers every decoder (`tests/fuzz.rs`).

use std::collections::BTreeMap;

use crate::encode::{Encode, VERSION};
use crate::id::{BlobId, EntryId, GrantId, OpId, SignerId, SpaceId, VaultId};
use crate::keys::{KeyBox, KeyId, KeyScope, PublicKey, Recipient};
use crate::policy::{Action, Branch, Grant, Grantee, Kind, Op, Principal, Role, Scope};
use crate::sign::{Assertion, Classical, Hello, PasskeyHello, Signature, SignerKeys, Signed};
use crate::sync::{Ask, LogId};

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

wire!(Signed, Ask, Hello, Request, Reply, Announce, PasskeyHello, Join);

/// An op on the wire is the bytes its id hashes (`encode::bytes`): the format's version, then the op.
impl Wire for Op {
    fn to_wire(&self) -> Vec<u8> {
        crate::encode::bytes(self)
    }

    fn from_wire(bytes: &[u8]) -> Result<Self, WireError> {
        let mut r = Reader { bytes, at: 0 };
        let op = versioned(&mut r)?;
        if r.at == bytes.len() { Ok(op) } else { Err(WireError::Trailing) }
    }
}

/// An op behind the format's version.
fn versioned(r: &mut Reader<'_>) -> Result<Op, WireError> {
    if r.u8()? != VERSION {
        return Err(WireError::Unknown);
    }
    Op::decode(r)
}

/// What a device sends a peer to sync with it: what it holds of each log the peer may hold, by its own view (`Ask`),
/// and the McEliece keys it lacks that ops of those logs name.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Request {
    pub ask: Ask,
    /// Smallest first, no repeats.
    pub wants: Vec<BlobId>,
}

/// What the peer sends back: the ops the device may receive beyond what it asked with (`sync::respond_since`), and of
/// each McEliece key those ops or the request name that the peer holds and the device may fetch, its id and the hash
/// it is fetched by (iroh-blobs' BLAKE3). The device checks each key against its id once it has it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Reply {
    pub ops: Vec<Signed>,
    /// Smallest id first, no repeats.
    pub blobs: Vec<(BlobId, [u8; 32])>,
}

/// The digest of each log a device holds that the peer may hold too (`sync::digests`), as it tells the peer each time
/// one changes: the peer asks it when one differs from its own.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Announce {
    /// Smallest log first, no repeats.
    pub digests: Vec<(LogId, [u8; 32])>,
}

/// What a new device sends the peer its passkey proved itself to (P8c), once it holds the passkey's link card: the op
/// adding it to its person's vault, signed by the passkey and by itself (`Lab::join`), and the McEliece key that op
/// names, its own. The peer accepts that op alone (`Lab::accept_join`).
#[derive(Clone, PartialEq, Eq)]
pub struct Join {
    pub op: Signed,
    pub blobs: Vec<Vec<u8>>,
}

/// The McEliece keys show only their sizes.
impl std::fmt::Debug for Join {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let blobs: Vec<String> = self.blobs.iter().map(|b| format!("{} bytes", b.len())).collect();
        f.debug_struct("Join").field("op", &self.op).field("blobs", &blobs).finish()
    }
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

ids!(SignerId, VaultId, SpaceId, EntryId, GrantId, OpId, BlobId, KeyId);

impl Decode for PublicKey {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(PublicKey { xwing: r.bytes()?, mceliece: BlobId::decode(r)? })
    }
}

impl Decode for KeyScope {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(KeyScope::Vault(VaultId::decode(r)?)),
            1 => Ok(KeyScope::Space(SpaceId::decode(r)?)),
            2 => Ok(KeyScope::Entry(SpaceId::decode(r)?, EntryId::decode(r)?)),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for Recipient {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Recipient::Signer(SignerId::decode(r)?)),
            1 => Ok(Recipient::Key { key: KeyScope::decode(r)?, epoch: u64::decode(r)?, id: KeyId::decode(r)? }),
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

impl Decode for Scope {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Scope::Space(SpaceId::decode(r)?)),
            1 => Ok(Scope::Entry(SpaceId::decode(r)?, EntryId::decode(r)?)),
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

impl Decode for Grant {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Grant {
            scope: Scope::decode(r)?,
            role: Role::decode(r)?,
            grantee: Grantee::decode(r)?,
            issuer: VaultId::decode(r)?,
            parent: r.option()?,
        })
    }
}

impl Decode for Branch {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Branch::Main),
            1 => Ok(Branch::New),
            2 => Ok(Branch::On(OpId::decode(r)?)),
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
            6 => Action::FoundSpace { actor: VaultId::decode(r)?, nonce: u64::decode(r)? },
            7 => Action::Grant(Grant::decode(r)?),
            8 => Action::Revoke { grant: GrantId::decode(r)?, actor: VaultId::decode(r)?, keep: r.seq(32)? },
            9 => Action::Write {
                space: SpaceId::decode(r)?,
                entry: EntryId::decode(r)?,
                actor: VaultId::decode(r)?,
                epoch: u64::decode(r)?,
                deps: r.seq(32)?,
                branch: Branch::decode(r)?,
                body: r.bytes()?,
            },
            10 => Action::SetRoot { vault: VaultId::decode(r)?, root: r.option()?, keep: r.seq(32)? },
            11 => Action::Keys {
                key: KeyScope::decode(r)?,
                epoch: u64::decode(r)?,
                id: KeyId::decode(r)?,
                public: r.option()?,
                boxes: r.seq(37)?,
                clear: r.option()?,
            },
            12 => Action::Publish { space: SpaceId::decode(r)?, actor: VaultId::decode(r)?, blob: r.bytes()? },
            13 => Action::Checkpoint { space: SpaceId::decode(r)?, entry: EntryId::decode(r)?, covers: r.seq(32)? },
            _ => return Err(WireError::Unknown),
        })
    }
}

impl Decode for Op {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Op {
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
        }
    }
}

impl Decode for Classical {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Classical::Ed25519(r.array()?)),
            1 => Ok(Classical::Passkey(Assertion::decode(r)?)),
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

/// The op as its id hashes it, then its signatures.
impl Encode for Signed {
    fn encode(&self, out: &mut Vec<u8>) {
        out.push(VERSION);
        self.op.encode(out);
        self.sigs.encode(out);
    }
}

impl Decode for Signed {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Signed { op: versioned(r)?, sigs: r.seq(79)? })
    }
}

impl Encode for LogId {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            LogId::Vault(v) => {
                out.push(0);
                v.encode(out);
            }
            LogId::Space(sp) => {
                out.push(1);
                sp.encode(out);
            }
            LogId::Entry(sp, e) => {
                out.push(2);
                sp.encode(out);
                e.encode(out);
            }
        }
    }
}

impl Decode for LogId {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(LogId::Vault(VaultId::decode(r)?)),
            1 => Ok(LogId::Space(SpaceId::decode(r)?)),
            2 => Ok(LogId::Entry(SpaceId::decode(r)?, EntryId::decode(r)?)),
            _ => Err(WireError::Unknown),
        }
    }
}

/// Of each log, smallest first, the ops named of it, smallest first; then the loose ops, smallest first.
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

impl Encode for Join {
    fn encode(&self, out: &mut Vec<u8>) {
        self.op.encode(out);
        self.blobs.encode(out);
    }
}

impl Decode for Join {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Join { op: Signed::decode(r)?, blobs: r.seq(4)? })
    }
}

impl Encode for Request {
    fn encode(&self, out: &mut Vec<u8>) {
        self.ask.encode(out);
        self.wants.encode(out);
    }
}

impl Decode for Request {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Request { ask: Ask::decode(r)?, wants: r.set(32)? })
    }
}

impl Encode for Reply {
    fn encode(&self, out: &mut Vec<u8>) {
        self.ops.encode(out);
        self.blobs.encode(out);
    }
}

impl Decode for Reply {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Reply { ops: r.seq(76)?, blobs: r.set(64)? })
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
    fn every_op_and_signature_of_a_world_reads_back_the_same() {
        let mut w = world();
        let h = handbook(&mut w);
        let mut kinds = std::collections::HashSet::new();
        for d in [w.mac_s, w.mac_b, w.server] {
            for op in w.lab.log(d).ops() {
                let signed = w.lab.signed_op(d, op.id()).expect("held").clone();
                let bytes = signed.to_wire();
                assert_eq!(Signed::from_wire(&bytes), Ok(signed.clone()));
                assert_eq!(Op::from_wire(&op.to_wire()).as_ref(), Ok(op));
                assert_eq!(op.to_wire(), crate::encode::bytes(op), "an op on the wire is the bytes its id hashes");
                kinds.insert(std::mem::discriminant(&op.action));
            }
        }
        assert!(kinds.len() >= 6, "genesis, devices, keys, spaces, grants and writes all crossed: {}", kinds.len());
        let ask = crate::sync::asks(w.lab.log(w.mac_b).ops());
        assert!(!ask.haves.is_empty());
        assert_eq!(Ask::from_wire(&ask.to_wire()), Ok(ask.clone()));
        let digests: Vec<(LogId, [u8; 32])> = w.lab.digests(w.mac_b).iter().map(|(l, d)| (*l, *d)).collect();
        let announce = Announce { digests };
        assert_eq!(Announce::from_wire(&announce.to_wire()), Ok(announce));
        let _ = h;
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
        let ok = Request { ask: Ask::default(), wants: vec![a, b] };
        assert_eq!(Request::from_wire(&ok.to_wire()), Ok(ok));
        for wants in [vec![b, a], vec![a, a]] {
            let bytes = Request { ask: Ask::default(), wants }.to_wire();
            assert_eq!(Request::from_wire(&bytes), Err(WireError::Unordered));
        }
        let (x, y) = (LogId::Vault(VaultId([1; 32])), LogId::Space(SpaceId([0; 32])));
        let mut ask = Ask::default();
        ask.haves.insert(y, vec![]);
        ask.haves.insert(x, vec![OpId([1; 32])]);
        let mut bytes = ask.to_wire();
        assert_eq!(Ask::from_wire(&bytes), Ok(ask));
        // swap the two logs: the vault's log (37 bytes, then its one op) after the space's
        let (first, rest) = bytes[4..].split_at(33 + 4 + 32);
        let swapped = [&rest[..33 + 4], first].concat();
        bytes.splice(4..4 + swapped.len(), swapped);
        assert_eq!(Ask::from_wire(&bytes), Err(WireError::Unordered));
        // an op of another format version
        let action = Action::SetThreshold { vault: VaultId([2; 32]), threshold: 1 };
        let op = Op { parents: vec![], depth: 0, author: SignerId([1; 32]), cosigners: vec![], action };
        let mut bytes = op.to_wire();
        bytes[0] = VERSION + 1;
        assert_eq!(Op::from_wire(&bytes), Err(WireError::Unknown));
    }

    #[test]
    fn a_made_up_count_allocates_nothing() {
        // four billion ops claimed in eight bytes: refused before anything is made of them
        let bytes = [0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0];
        assert_eq!(Reply::from_wire(&bytes), Err(WireError::Short));
        assert_eq!(Announce::from_wire(&bytes[..4]), Err(WireError::Short));
    }
}
