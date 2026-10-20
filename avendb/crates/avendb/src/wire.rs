//! The wire (P8): what devices send each other, as bytes, and back. An edit keeps the bytes its id hashes (`encode`); a
//! signed edit adds its signatures, and the messages of a sync wrap what `sync` asks and answers: a device's hello on a
//! connection, its request (`Request`), the reply (`Reply`), and its holdings (`Announce`). A new device
//! shows its passkey's pass for it (`RelayPass`, P8d): to the server's relay, which lets it in if it has no UDP of its
//! own, and to the peer it links through (P8c), which hands it its vault; then it joins (`Join`). The first human vault
//! to claim a server nobody has claimed yet (`Claim`) owns it: the server becomes a device of the aven vault avenCEO,
//! which that human vault owns.
//!
//! Every value has exactly one encoding, and a decoder takes only bytes that encode back to themselves: integers are
//! big-endian and fixed-size, sequences carry their length, every enum starts with a tag, sets go smallest first with
//! no repeats, and nothing may follow the value. So two devices never read one message two ways. Nothing a peer sends
//! can make a device panic, or allocate more than a few times what it sent: a count is checked against the bytes left
//! before anything is made of it. The mutation fuzzing covers every decoder (`tests/fuzz.rs`).

use std::collections::BTreeMap;

use crate::encode::{Encode, DEFINES, VERSION};
use crate::id::{AudienceId, BlobId, EditId, EntryId, ShareId, SignerId, VaultId};
use crate::keys::{KeyBox, KeyFam, KeyId, KeyName, PublicKey, Recipient};
use crate::policy::{
    Action, Creation, Edit, KeepMode, Kind, Level, Principal, Proposal, Revoking, Setting, Share, Sharing, Who,
};
use crate::recovery::RecoveryKey;
use crate::rules::{
    Cap, CapGroup, Grant, On, Op, Proof, Scalar, Step, MAX_CAPS, MAX_GRANTS, MAX_INCLUDES, MAX_NAME, MAX_OPS, MAX_STEPS,
    MAX_VALUES,
};
use crate::sealed::{Brought, FileKey, FileRoot};
use crate::sign::{
    self, ApiPass, Assertion, EnclaveSig, Hello, PqKey, RelayPass, Signature, SignerKeys, Signed, Suite, WebAuthn,
    PQ_SIGNATURE_BYTES,
};
use crate::slice::{Atom, Body, Header, Select, Selector, Slice, Sym, TagDelta};
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

wire!(Signed, Signature, SignerKeys, Ask, Hello, Request, Reply, Announce, Statement, Join, RelayPass, ApiPass, Claim, PublicKey, Slice, Select, Body, RecoveryKey);

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

/// What a device sends a peer to sync with it: what it holds of each log the peer may hold, by its own view, and the
/// vaults it follows (`Ask`), and the McEliece keys it lacks that edits of those logs name. Asking on for the next page
/// of a reply, the place of the last edit it got.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Request {
    pub ask: Ask,
    /// Smallest first, no repeats.
    pub wants: Vec<BlobId>,
    /// The peer sends only edits after this place (`sync::place`).
    pub after: Option<Place>,
}

/// What the peer sends back: a page of the edits the device may receive beyond what it asked with
/// (`sync::respond_since`), by their place, and the id of each McEliece key those edits or the request name that the
/// peer holds and the device may fetch: the BLAKE3 hash iroh-blobs fetches it by. If more edits are left, the device
/// asks on after the last place it got.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Reply {
    pub edits: Vec<Signed>,
    /// Smallest first, no repeats.
    pub blobs: Vec<BlobId>,
    pub more: bool,
}

/// What a device holds of a log, as it states it in its holdings (`Announce`): the frontier of the part whose whole
/// past it holds (`sync::frontiers`), and the edits it holds outside that part, waiting for their past; each smallest
/// first, no repeats. Two copies of a log that agree on both hold the same edits (T19).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Frontier {
    pub heads: Vec<EditId>,
    pub waiting: Vec<EditId>,
}

/// What a device holds of a file, as it states it in its holdings (`Announce`): every sealed byte of it, or some of its
/// pieces whole (`sealed::PIECE`), by their numbers, smallest first: at least one, and not all.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FileHold {
    Whole,
    Pieces(Vec<u32>),
}

/// A device's holdings (v8), as it tells a peer whose hello proved the peer on their connection: of each log and each
/// file the peer may know by the device's view, what the device holds of it for good, on its shelf. On a new
/// connection it tells them all (`full`), which stand in for whatever it told the peer before; after that only what
/// changed, a file it no longer holds with `None`. A device speaks for itself alone: the peer keeps what it hears for
/// the device the connection proved, and only routes its asks and fetches by it, never lets anyone fetch anything by
/// it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Announce {
    pub full: bool,
    /// Smallest log first, no repeats.
    pub logs: Vec<(LogId, Frontier)>,
    /// Smallest file first, no repeats.
    pub files: Vec<(FileRoot, Option<FileHold>)>,
}

/// A device's signed statement of its holdings (H2): what it holds for good of each log and each file one peer may know
/// by its view, as it announces them to that peer, and when it checked, in seconds since 1970 by its clock, under its
/// own SLH-DSA signature (`sign::STATEMENT_CONTEXT`). Unlike an announcement it proves itself whatever connection brings
/// it: a node keeps the newest statement each device it knows signed, and passes it on to a peer that may know all of
/// it. Like an announcement, it routes and shows, and never lets anyone fetch anything.
#[derive(Clone, PartialEq, Eq)]
pub struct Statement {
    /// The device's keys, which its signature verifies under.
    pub keys: SignerKeys,
    pub checked: u64,
    /// Smallest log first, no repeats.
    pub logs: Vec<(LogId, Frontier)>,
    /// Smallest file first, no repeats.
    pub files: Vec<(FileRoot, FileHold)>,
    /// SLH-DSA-SHA2-128f over `body`.
    pub sig: Vec<u8>,
}

/// The signature shows only its size.
impl std::fmt::Debug for Statement {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Statement")
            .field("device", &self.keys.id())
            .field("checked", &self.checked)
            .field("logs", &self.logs)
            .field("files", &self.files)
            .field("sig", &format!("{} bytes", self.sig.len()))
            .finish()
    }
}

impl Statement {
    /// What a statement's signature signs: the format's version, its device, when it checked, then of each log its
    /// frontier and of each file what the device holds of it, as the wire writes them.
    pub fn body(device: SignerId, checked: u64, logs: &[(LogId, Frontier)], files: &[(FileRoot, FileHold)]) -> Vec<u8> {
        let mut out = vec![VERSION];
        device.encode(&mut out);
        checked.encode(&mut out);
        holdings(logs, files, &mut out);
        out
    }

    /// The device it is of: the one its keys are.
    pub fn device(&self) -> SignerId {
        self.keys.id()
    }

    /// Its device, if its signature checks out: a device's keys, signing this body.
    pub fn verify(&self) -> Option<SignerId> {
        let body = Statement::body(self.device(), self.checked, &self.logs, &self.files);
        sign::verify_statement(&self.keys, &body, &self.sig)
    }
}

/// Of each log, smallest first, its frontier, then of each file, smallest first, what a device holds of it.
fn holdings(logs: &[(LogId, Frontier)], files: &[(FileRoot, FileHold)], out: &mut Vec<u8>) {
    (logs.len() as u32).encode(out);
    for (log, frontier) in logs {
        log.encode(out);
        frontier.encode(out);
    }
    (files.len() as u32).encode(out);
    for (root, hold) in files {
        root.encode(out);
        hold.encode(out);
    }
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

    /// `option`, of a `seq`.
    fn option_seq<T: Decode>(&mut self, min: usize) -> Result<Option<Vec<T>>, WireError> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.seq(min)?)),
            _ => Err(WireError::Unknown),
        }
    }

    /// `seq`, of at most `max` values.
    fn bounded<T: Decode>(&mut self, min: usize, max: usize) -> Result<Vec<T>, WireError> {
        let out: Vec<T> = self.seq(min)?;
        if out.len() <= max { Ok(out) } else { Err(WireError::Unknown) }
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

impl Decode for i64 {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(i64::from_be_bytes(r.array()?))
    }
}

/// UTF-8 behind its length.
impl Decode for String {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        String::from_utf8(r.bytes()?).map_err(|_| WireError::Unknown)
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

ids!(SignerId, VaultId, EntryId, ShareId, AudienceId, EditId, BlobId, KeyId);

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

impl Decode for RecoveryKey {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let (keys, seal, mceliece) = (SignerKeys::decode(r)?, PublicKey::decode(r)?, r.bytes()?.into());
        Ok(RecoveryKey { keys, seal, mceliece, consent: Signature::decode(r)? })
    }
}

impl Decode for KeyFam {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(KeyFam::Seed(VaultId::decode(r)?)),
            1 => Ok(KeyFam::Share(VaultId::decode(r)?, ShareId::decode(r)?)),
            2 => Ok(KeyFam::Audience(VaultId::decode(r)?, AudienceId::decode(r)?)),
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

impl Decode for crate::policy::Wrap {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(crate::policy::Wrap { name: KeyName::decode(r)?, id: KeyId::decode(r)?, boxed: KeyBox::decode(r)? })
    }
}

/// A name: UTF-8 behind its length.
impl Decode for Sym {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        String::decode(r).map(Sym)
    }
}

impl Decode for Atom {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(match r.u8()? {
            0 => Atom::TypeIn(r.seq(4)?),
            1 => Atom::AuthorIn(r.seq(32)?),
            2 => Atom::EntryIn(r.seq(32)?),
            3 => Atom::CreatedIn(u64::decode(r)?, u64::decode(r)?),
            4 => Atom::TagHas(Sym::decode(r)?),
            5 => Atom::TagNone(r.seq(4)?),
            6 => Atom::TagsWithin(r.seq(4)?),
            _ => return Err(WireError::Unknown),
        })
    }
}

/// Only within the bounds a selector keeps (`Selector::bounded`).
impl Decode for Selector {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let select = match r.u8()? {
            0 => Selector::All,
            1 => {
                let n = r.count(4)?;
                let mut ds = Vec::with_capacity(n.min(16));
                for _ in 0..n {
                    ds.push(r.seq(1)?);
                }
                Selector::AnyOf(ds)
            }
            _ => return Err(WireError::Unknown),
        };
        if select.bounded() { Ok(select) } else { Err(WireError::Unknown) }
    }
}

/// Only with a name of at most `rules::MAX_NAME` characters, and a chain of at most `rules::MAX_GRANTS` shares.
impl Decode for Slice {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let name = String::decode(r)?;
        if name.chars().count() > MAX_NAME {
            return Err(WireError::Unknown);
        }
        let (select, grant, above) = (Selector::decode(r)?, Grant::decode(r)?, r.bounded(36, MAX_GRANTS - 1)?);
        Ok(Slice { name, select, grant, above })
    }
}

impl Decode for Select {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Select::Clear(Slice::decode(r)?)),
            1 => Ok(Select::Sealed { boxes: r.seq(4)?, slice: r.bytes()?, commitment: r.array()? }),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for Step {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Step::Field(String::decode(r)?)),
            1 => Ok(Step::Row(i64::decode(r)?)),
            2 => Ok(Step::Any),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for On {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(On::Main),
            1 => Ok(On::Proposals),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for Scalar {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Scalar::Null),
            1 => Ok(Scalar::Bool(false)),
            2 => Ok(Scalar::Bool(true)),
            3 => Ok(Scalar::Int(i64::decode(r)?)),
            4 => Ok(Scalar::Text(String::decode(r)?)),
            _ => Err(WireError::Unknown),
        }
    }
}

/// Only within the bounds ops keep (`rules::MAX_STEPS`, `rules::MAX_VALUES`).
impl Decode for Op {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let path = |r: &mut Reader<'_>| r.bounded(1, MAX_STEPS);
        // a list of at most `MAX_VALUES`, or none
        fn values<T: Decode>(r: &mut Reader<'_>, min: usize) -> Result<Option<Vec<T>>, WireError> {
            match r.u8()? {
                0 => Ok(None),
                1 => Ok(Some(r.bounded(min, MAX_VALUES)?)),
                _ => Err(WireError::Unknown),
            }
        }
        Ok(match r.u8()? {
            0 => Op::Relay,
            1 => Op::Backup,
            2 => Op::Read,
            3 => Op::Create { on: None },
            4 => Op::Set { path: path(r)?, to: values(r, 1)?, on: r.option()? },
            5 => Op::Insert { path: path(r)?, on: r.option()? },
            6 => Op::Remove { path: path(r)?, on: r.option()? },
            7 => Op::Move { path: path(r)?, on: r.option()? },
            8 => Op::Tag(values(r, 4)?),
            9 => Op::Propose,
            10 => Op::Merge { on: r.option()?, path: vec![] },
            11 => Op::Share,
            // a merge's path has a step at least: `[]` is the merge of kind 10
            12 => Op::Merge { on: r.option()?, path: r.bounded(1, MAX_STEPS).and_then(|p: Vec<Step>| match p.is_empty() {
                true => Err(WireError::Unknown),
                false => Ok(p),
            })? },
            // a creation's lines, named: one with none is the creation of kind 3
            13 => Op::Create { on: Some(On::decode(r)?) },
            14 => Op::SetOwn { path: path(r)?, to: values(r, 1)?, on: r.option()? },
            _ => return Err(WireError::Unknown),
        })
    }
}

impl Decode for Grant {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Grant { ops: r.bounded(1, MAX_OPS)?, salt: r.array()? })
    }
}

impl Decode for Proof {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Proof { share: ShareId::decode(r)?, grants: r.bounded(36, MAX_GRANTS)? })
    }
}

impl Decode for Header {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Header { ty: Sym::decode(r)?, created: u64::decode(r)? })
    }
}

impl Decode for TagDelta {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(TagDelta { add: r.seq(4)?, remove: r.seq(4)? })
    }
}

/// A body is read whole (`Wire`), so its files, next to last, are there exactly when bytes are left that don't start
/// with the byte its cap group follows (`encode::DEFINES`), and then there are some; and its cap group, last, exactly
/// when that byte is left.
impl Decode for Body {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let (header, tags, answers, content) = (r.option()?, TagDelta::decode(r)?, r.set(32)?, r.bytes()?);
        let proof = r.option()?;
        let mut files: Vec<Brought> = vec![];
        if r.at < r.bytes.len() && r.bytes[r.at] != DEFINES {
            files = r.seq(80)?;
            if files.is_empty() {
                return Err(WireError::Unknown);
            }
            if !files.windows(2).all(|w| w[0].root < w[1].root) {
                return Err(WireError::Unordered);
            }
        }
        let mut defines = None;
        if r.at < r.bytes.len() {
            if r.u8()? != DEFINES {
                return Err(WireError::Unknown);
            }
            defines = Some(CapGroup::decode(r)?);
        }
        Ok(Body { header, tags, answers, content, proof, files, defines })
    }
}

impl Decode for Cap {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Cap { op: Op::decode(r)?, slice: Selector::decode(r)? })
    }
}

/// Only with a name of at most `rules::MAX_NAME` characters, at most `rules::MAX_CAPS` caps and
/// `rules::MAX_INCLUDES` included groups.
impl Decode for CapGroup {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let name = String::decode(r)?;
        if name.chars().count() > MAX_NAME {
            return Err(WireError::Unknown);
        }
        Ok(CapGroup { name, caps: r.bounded(2, MAX_CAPS)?, includes: r.bounded(32, MAX_INCLUDES)? })
    }
}

impl Decode for FileRoot {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(FileRoot { hash: <[u8; 32]>::decode(r)?, size: u64::decode(r)? })
    }
}

impl Decode for Brought {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let (root, key) = (FileRoot::decode(r)?, FileKey::from_bytes(<[u8; 32]>::decode(r)?));
        Ok(Brought { root, key, len: u64::decode(r)? })
    }
}

impl Decode for Kind {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Kind::Human),
            1 => Ok(Kind::Coop),
            2 => Ok(Kind::Aven),
            3 => Ok(Kind::DeviceVault),
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

/// Its rank: keep 0, followed by its mode's byte (0 whole, 1 opened, 2 never), relay 1 to owner 5.
impl Decode for Level {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Level::Keep(match r.u8()? {
                0 => KeepMode::Whole,
                1 => KeepMode::Opened,
                2 => KeepMode::Never,
                _ => return Err(WireError::Unknown),
            })),
            1 => Ok(Level::Relay),
            2 => Ok(Level::Backup),
            3 => Ok(Level::Read),
            4 => Ok(Level::Write),
            5 => Ok(Level::Owner),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for Who {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Who::Vault(VaultId::decode(r)?)),
            1 => Ok(Who::Everyone),
            2 => Ok(Who::Device(SignerId::decode(r)?)),
            3 => Ok(Who::Invite(SignerId::decode(r)?)),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for Share {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Share {
            over: VaultId::decode(r)?,
            who: Who::decode(r)?,
            level: Level::decode(r)?,
            wide: bool::decode(r)?,
            select: r.bytes()?,
            parent: r.option()?,
            issuer: VaultId::decode(r)?,
            nonce: u64::decode(r)?,
            group: None,
        })
    }
}

impl Decode for Creation {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Creation { audience: r.seq(32)?, nonce: r.array()? })
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

impl Decode for Setting {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Setting::Threshold(u32::decode(r)?)),
            1 => Ok(Setting::Root { root: r.option()?, keep: r.seq(32)? }),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for Sharing {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Sharing::Grant(Share::decode(r)?, r.seq(32)?)),
            3 => {
                let share = Share::decode(r)?;
                let group = Some(EntryId::decode(r)?);
                Ok(Sharing::Grant(Share { group, ..share }, r.seq(32)?))
            }
            1 => Ok(Sharing::Owner { vault: VaultId::decode(r)?, owner: Principal::decode(r)?, seal_to: r.option()? }),
            2 => Ok(Sharing::Device { vault: VaultId::decode(r)?, device: SignerId::decode(r)?, seal_to: r.option()? }),
            _ => Err(WireError::Unknown),
        }
    }
}

impl Decode for Revoking {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Revoking::Grant {
                share: ShareId::decode(r)?,
                actor: VaultId::decode(r)?,
                keep: r.seq(32)?,
                via: r.seq(32)?,
            }),
            1 => Ok(Revoking::Owner { vault: VaultId::decode(r)?, owner: Principal::decode(r)?, keep: r.seq(32)? }),
            2 => Ok(Revoking::Device { vault: VaultId::decode(r)?, device: SignerId::decode(r)?, keep: r.seq(32)? }),
            _ => Err(WireError::Unknown),
        }
    }
}

/// Each kind by its tag (`encode`'s `Action`); a tag the format doesn't have is no edit.
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
            1 => Action::Settings { vault: VaultId::decode(r)?, set: Setting::decode(r)? },
            2 => Action::Share(Sharing::decode(r)?),
            3 => Action::Revoke(Revoking::decode(r)?),
            // its files always, none or some, smallest first, no repeats
            4 => Action::Write {
                vault: VaultId::decode(r)?,
                entry: EntryId::decode(r)?,
                actor: VaultId::decode(r)?,
                stay: r.option()?,
                epoch: u64::decode(r)?,
                deps: r.seq(32)?,
                proposal: Proposal::decode(r)?,
                via: r.seq(32)?,
                create: r.option()?,
                files: r.set(40)?,
                body: r.bytes()?,
            },
            // its audience and its wants, each there or not; the rules, not the format, say a mark marks something
            5 => Action::Mark {
                vault: VaultId::decode(r)?,
                entry: EntryId::decode(r)?,
                caps: r.option_seq(32)?,
                wants: r.option_seq(32)?,
                keep: r.seq(32)?,
                via: r.seq(32)?,
            },
            6 => Action::Keys {
                name: KeyName::decode(r)?,
                id: KeyId::decode(r)?,
                public: r.option()?,
                boxes: r.seq(37)?,
                clear: r.option()?,
            },
            12 => Action::Claim { share: ShareId::decode(r)?, vault: VaultId::decode(r)?, via: r.seq(32)? },
            15 => Action::Wraps { entry: EntryId::decode(r)?, wraps: r.seq(70)? },
            16 => Action::Checkpoint { vault: VaultId::decode(r)?, covers: r.seq(32)? },
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

/// A device's keys after a 0, a passkey's after a 1 and a Touch ID key's after a 2, as each was in SLH-DSA's suite
/// before the key move; in ML-DSA-65's, a device's after a 3, a passkey's after a 4, and a Touch ID key's, its Enclave's
/// key alone, after a 5.
impl Encode for SignerKeys {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            SignerKeys::Device { ed25519, pq } => {
                out.push(if pq.suite() == Suite::SlhDsa { 0 } else { 3 });
                ed25519.encode(out);
                pq.bytes().encode(out);
            }
            SignerKeys::Passkey { p256, pq } => {
                out.push(if pq.suite() == Suite::SlhDsa { 1 } else { 4 });
                p256.encode(out);
                pq.bytes().encode(out);
            }
            SignerKeys::Enclave { mldsa, slh: Some(slh) } => {
                out.push(2);
                mldsa.encode(out);
                slh.encode(out);
            }
            SignerKeys::Enclave { mldsa, slh: None } => {
                out.push(5);
                mldsa.encode(out);
            }
        }
    }
}

impl Decode for SignerKeys {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(SignerKeys::Device { ed25519: r.array()?, pq: PqKey::Slh(r.array()?) }),
            1 => Ok(SignerKeys::Passkey { p256: r.array()?, pq: PqKey::Slh(r.array()?) }),
            2 => Ok(SignerKeys::Enclave { mldsa: r.array()?, slh: Some(r.array()?) }),
            3 => Ok(SignerKeys::Device { ed25519: r.array()?, pq: PqKey::MlDsa(r.array()?) }),
            4 => Ok(SignerKeys::Passkey { p256: r.array()?, pq: PqKey::MlDsa(r.array()?) }),
            5 => Ok(SignerKeys::Enclave { mldsa: r.array()?, slh: None }),
            _ => Err(WireError::Unknown),
        }
    }
}

/// A passkey's assertion: 1, 2 or 3, as each was since the master recovery key's standing consent was made, which
/// carries one; a device's signature, none, 4.
impl Encode for Option<WebAuthn> {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Some(WebAuthn::Edit(a)) => {
                out.push(1);
                a.encode(out);
            }
            Some(WebAuthn::Batch { assertion, edits }) => {
                out.push(2);
                assertion.encode(out);
                edits.encode(out);
            }
            Some(WebAuthn::Pass { assertion, made }) => {
                out.push(3);
                assertion.encode(out);
                made.encode(out);
            }
            None => out.push(4),
        }
    }
}

impl Decode for Option<WebAuthn> {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            1 => Ok(Some(WebAuthn::Edit(Assertion::decode(r)?))),
            2 => Ok(Some(WebAuthn::Batch { assertion: Assertion::decode(r)?, edits: r.set(32)? })),
            3 => Ok(Some(WebAuthn::Pass { assertion: Assertion::decode(r)?, made: u64::decode(r)? })),
            4 => Ok(None),
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

/// Its keys, its assertion, and its SLH-DSA signature after a 1, as the master recovery key's consent has it; or, for
/// a Touch ID key's, after a 2 and its Enclave's signature (`EnclaveSig`).
impl Encode for Signature {
    fn encode(&self, out: &mut Vec<u8>) {
        self.keys.encode(out);
        self.webauthn.encode(out);
        match &self.enclave {
            None => out.push(1),
            Some(e) => {
                out.push(2);
                e.public.encode(out);
                e.sig.encode(out);
                e.edits.encode(out);
            }
        }
        self.pq.encode(out);
    }
}

impl Decode for Signature {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let keys = SignerKeys::decode(r)?;
        let webauthn = Option::<WebAuthn>::decode(r)?;
        let enclave = match r.u8()? {
            1 => None,
            2 => Some(EnclaveSig { public: r.bytes()?, sig: r.bytes()?, edits: r.set(32)? }),
            _ => return Err(WireError::Unknown),
        };
        Ok(Signature { keys, webauthn, enclave, pq: r.bytes()? })
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

/// The fewest bytes a signature takes on the wire: a Touch ID key's keys, its ML-DSA-65 key's hash alone, held on a
/// checkpoint's word with no signature (`Lab::trust`): its suite, 32 bytes, no assertion, no Enclave signature and
/// no post-quantum one, behind its length.
const SIGNATURE_MIN: usize = 1 + 32 + 1 + 1 + 4;

impl Decode for Signed {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Signed { edit: versioned(r)?, sigs: r.seq(SIGNATURE_MIN)? })
    }
}

impl Encode for LogId {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            LogId::Vault(v) => {
                out.push(0);
                v.encode(out);
            }
            LogId::Share(c) => {
                out.push(1);
                c.encode(out);
            }
            LogId::Audience(v, x) => {
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
            1 => Ok(LogId::Share(ShareId::decode(r)?)),
            2 => Ok(LogId::Audience(VaultId::decode(r)?, AudienceId::decode(r)?)),
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
        self.follow.encode(out);
    }
}

/// Its logs smallest first, each once, with the edits it names of each as a set; its loose edits as a set; then the
/// vaults it follows as a set.
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
        Ok(Ask { haves, loose: r.set(32)?, follow: r.set(32)? })
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

/// The passkey's post-quantum key, its assertion, its signature, the device and when it was made. The key's 32 bytes
/// say no suite; its signature does, by its size: SLH-DSA's is `PQ_SIGNATURE_BYTES` long, any other is ML-DSA-65's
/// key and signature.
impl Encode for RelayPass {
    fn encode(&self, out: &mut Vec<u8>) {
        self.pq.bytes().encode(out);
        self.assertion.encode(out);
        self.sig.encode(out);
        self.device.encode(out);
        self.made.encode(out);
    }
}

impl Decode for RelayPass {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let (key, assertion, sig) = (r.array()?, Assertion::decode(r)?, r.bytes()?);
        let pq = if sig.len() == PQ_SIGNATURE_BYTES { PqKey::Slh(key) } else { PqKey::MlDsa(key) };
        Ok(RelayPass { pq, assertion, sig, device: SignerKeys::decode(r)?, made: u64::decode(r)? })
    }
}

impl Encode for ApiPass {
    fn encode(&self, out: &mut Vec<u8>) {
        self.keys.encode(out);
        self.audience.encode(out);
        self.made.encode(out);
        self.sig.encode(out);
    }
}

impl Decode for ApiPass {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let (keys, audience) = (SignerKeys::decode(r)?, String::decode(r)?);
        if audience.len() > sign::MAX_AUDIENCE {
            return Err(WireError::Unknown);
        }
        Ok(ApiPass { keys, audience, made: u64::decode(r)?, sig: r.bytes()? })
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
        Ok(Claim { card: r.seq(76)?, add: versioned(r)?, sigs: r.seq(SIGNATURE_MIN)? })
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
        let (edits, blobs) = (r.seq(76)?, r.set(32)?);
        let more = match r.u8()? {
            0 => false,
            1 => true,
            _ => return Err(WireError::Unknown),
        };
        Ok(Reply { edits, blobs, more })
    }
}

/// The heads, then the waiting edits.
impl Encode for Frontier {
    fn encode(&self, out: &mut Vec<u8>) {
        self.heads.encode(out);
        self.waiting.encode(out);
    }
}

impl Decode for Frontier {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Frontier { heads: r.set(32)?, waiting: r.set(32)? })
    }
}

/// 0 for the whole file; 1, then the pieces' numbers.
impl Encode for FileHold {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            FileHold::Whole => out.push(0),
            FileHold::Pieces(pieces) => {
                out.push(1);
                pieces.encode(out);
            }
        }
    }
}

/// What a device holds of file `root`: some of its pieces only if it has several, each one of them.
fn file_hold(r: &mut Reader<'_>, root: &FileRoot) -> Result<FileHold, WireError> {
    match r.u8()? {
        0 => Ok(FileHold::Whole),
        1 => {
            let pieces: Vec<u32> = r.set(4)?;
            let count = root.size.div_ceil(crate::sealed::PIECE).max(1);
            let held = |p: &u32| u64::from(*p) < count;
            let some = !pieces.is_empty() && (pieces.len() as u64) < count && pieces.iter().all(held);
            if some { Ok(FileHold::Pieces(pieces)) } else { Err(WireError::Unknown) }
        }
        _ => Err(WireError::Unknown),
    }
}

/// Whether it is full, then of each log, smallest first, its frontier, then of each file, smallest first, what the
/// device holds of it, if anything.
impl Encode for Announce {
    fn encode(&self, out: &mut Vec<u8>) {
        self.full.encode(out);
        (self.logs.len() as u32).encode(out);
        for (log, frontier) in &self.logs {
            log.encode(out);
            frontier.encode(out);
        }
        (self.files.len() as u32).encode(out);
        for (root, hold) in &self.files {
            root.encode(out);
            hold.encode(out);
        }
    }
}

impl Decode for Announce {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let full = bool::decode(r)?;
        let n = r.count(41)?;
        let mut logs: Vec<(LogId, Frontier)> = Vec::with_capacity(n.min(64));
        for _ in 0..n {
            logs.push((LogId::decode(r)?, Frontier::decode(r)?));
        }
        let n = r.count(41)?;
        let mut files: Vec<(FileRoot, Option<FileHold>)> = Vec::with_capacity(n.min(64));
        for _ in 0..n {
            let root = FileRoot::decode(r)?;
            let hold = match r.u8()? {
                0 => None,
                1 => Some(file_hold(r, &root)?),
                _ => return Err(WireError::Unknown),
            };
            files.push((root, hold));
        }
        let ordered = logs.windows(2).all(|w| w[0].0 < w[1].0) && files.windows(2).all(|w| w[0].0 < w[1].0);
        if ordered { Ok(Announce { full, logs, files }) } else { Err(WireError::Unordered) }
    }
}

/// Its keys, when it checked, its holdings as a statement's body writes them, then its signature.
impl Encode for Statement {
    fn encode(&self, out: &mut Vec<u8>) {
        self.keys.encode(out);
        self.checked.encode(out);
        holdings(&self.logs, &self.files, out);
        self.sig.encode(out);
    }
}

impl Decode for Statement {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let (keys, checked) = (SignerKeys::decode(r)?, u64::decode(r)?);
        let n = r.count(41)?;
        let mut logs: Vec<(LogId, Frontier)> = Vec::with_capacity(n.min(64));
        for _ in 0..n {
            logs.push((LogId::decode(r)?, Frontier::decode(r)?));
        }
        let n = r.count(41)?;
        let mut files: Vec<(FileRoot, FileHold)> = Vec::with_capacity(n.min(64));
        for _ in 0..n {
            let root = FileRoot::decode(r)?;
            files.push((root, file_hold(r, &root)?));
        }
        let sig = r.bytes()?;
        let ordered = logs.windows(2).all(|w| w[0].0 < w[1].0) && files.windows(2).all(|w| w[0].0 < w[1].0);
        if ordered { Ok(Statement { keys, checked, logs, files, sig }) } else { Err(WireError::Unordered) }
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
        // a write that brings a file crosses too, the file named in the clear and its key in the sealed body
        let photo = Brought::new([5; 32], FileKey::from_bytes([6; 32]), 100);
        let root = photo.root;
        w.lab.bring(w.mac_a, h.coop, h.welcome, vec![photo], |_| {}).expect("Alice brings a photo");
        w.lab.sync_all(1);
        assert!(w.lab.log(w.server).edits().iter().any(|e| !e.files().is_empty()));
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
                let sharing = match &edit.action {
                    Action::Share(s) => Some(std::mem::discriminant(s)),
                    _ => None,
                };
                kinds.insert((std::mem::discriminant(&edit.action), sharing));
            }
        }
        assert!(kinds.len() >= 5, "genesis, devices, keys, grants and writes all crossed: {}", kinds.len());
        let ask = crate::sync::asks(w.lab.log(w.mac_b).edits(), &[]);
        assert!(!ask.haves.is_empty());
        assert_eq!(Ask::from_wire(&ask.to_wire()), Ok(ask.clone()));
        let frontier = |(l, heads): (LogId, Vec<EditId>)| (l, Frontier { heads, waiting: vec![] });
        let logs = crate::sync::frontiers(w.lab.log(w.mac_b).edits()).into_iter().map(frontier).collect();
        let announce = Announce { full: true, logs, files: vec![(root, Some(FileHold::Whole))] };
        assert_eq!(Announce::from_wire(&announce.to_wire()), Ok(announce));
        let _ = h;
    }

    #[test]
    fn a_claim_reads_back_the_same() {
        let w = world();
        let card = w.lab.card(w.server);
        let joined =
            |s: &&Signed| matches!(s.edit.action, Action::Share(Sharing::Device { device, .. }) if device == w.server);
        let add = card.iter().find(joined).expect("the edit that added the server").clone();
        let claim = Claim { card: card.clone(), add: add.edit.clone(), sigs: add.sigs[..1].to_vec() };
        assert_eq!(Claim::from_wire(&claim.to_wire()), Ok(claim));
    }

    #[test]
    fn a_cap_group_its_share_to_an_invite_and_the_claim_read_back_the_same() {
        let (v, e, k) = (VaultId([1; 32]), EntryId([2; 32]), SignerId([3; 32]));
        let share = Share {
            over: v,
            who: Who::Invite(k),
            level: Level::Read,
            wide: false,
            select: vec![],
            parent: None,
            issuer: v,
            nonce: 0,
            group: Some(e),
        };
        let edit = |action| Edit { parents: vec![], depth: 0, author: k, cosigners: vec![], action };
        let claim = Action::Claim { share: ShareId([4; 32]), vault: VaultId([5; 32]), via: vec![VaultId([6; 32])] };
        // a move's wraps in one edit, and a checkpoint of a vault's owners (2026-10-20)
        let entry = EntryId([7; 32]);
        let wrap = crate::policy::Wrap {
            name: KeyName::Entry(entry, None, 0),
            id: KeyId([8; 32]),
            boxed: KeyBox { to: Recipient::Key { name: KeyName::Entry(entry, Some(EditId([9; 32])), 0), id: KeyId([10; 32]) }, bytes: vec![1, 2, 3] },
        };
        let wraps = Action::Wraps { entry, wraps: vec![wrap.clone(), wrap] };
        let checkpoint = Action::Checkpoint { vault: VaultId([5; 32]), covers: vec![EditId([11; 32]), EditId([12; 32])] };
        for action in [Action::Share(Sharing::Grant(share, vec![])), claim, wraps, checkpoint] {
            let e = edit(action);
            assert_eq!(Edit::from_wire(&e.to_wire()), Ok(e));
        }
        let read = Cap { op: Op::of_json(&serde_json::json!({ "op": "read" })).expect("an op"), slice: Selector::All };
        let defines = CapGroup { name: "Traveler".into(), caps: vec![read], includes: vec![e] };
        let body = Body { defines: Some(defines), ..Body::default() };
        assert_eq!(Body::from_wire(&body.to_wire()), Ok(body.clone()));
        let plain = Body::default().to_wire();
        assert_eq!(body.to_wire()[..plain.len()], plain[..], "a body that says no group keeps its bytes");
    }

    #[test]
    fn a_signature_of_edits_signed_together_reads_back_only_in_their_order() {
        let w = world();
        let edits: Vec<Edit> = w.lab.log(w.mac_a).edits()[..2].to_vec();
        let mut batch: Vec<EditId> = edits.iter().map(Edit::id).collect();
        batch.sort();
        let mut passkey = crate::sign::Passkey::from_seed([1; 32]);
        let ceremony = passkey.ceremony(crate::sign::batch_challenge(&batch));
        let sig = ceremony.sign_in(passkey.keys(), edits[0].id(), &batch).expect("its signature");
        assert!(matches!(&sig.webauthn, Some(WebAuthn::Batch { edits, .. }) if *edits == batch), "it names both edits");
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
    fn a_touch_id_keys_signature_reads_back_whole() {
        let w = world();
        let edits: Vec<Edit> = w.lab.log(w.mac_a).edits()[..2].to_vec();
        let touch = crate::sign::EnclaveKey::from_seed([1; 32]);
        assert_eq!(SignerKeys::from_wire(&touch.keys().to_wire()), Ok(touch.keys()));
        let alone = Signed { edit: edits[0].clone(), sigs: vec![touch.sign(edits[0].id())] };
        assert_eq!(Signed::from_wire(&alone.to_wire()), Ok(alone.clone()));
        let mut batch: Vec<EditId> = edits.iter().map(Edit::id).collect();
        batch.sort();
        let ceremony = touch.ceremony(crate::sign::batch_challenge(&batch));
        let sig = ceremony.sign_in(touch.keys(), edits[1].id(), &batch).expect("its signature");
        let together = Signed { edit: edits[1].clone(), sigs: vec![sig] };
        assert_eq!(Signed::from_wire(&together.to_wire()), Ok(together));
        // a passkey's signature keeps its bytes: a 1 after its assertion, where a Touch ID key's has a 2
        let mut passkey = crate::sign::Passkey::from_seed([1; 32]);
        let bytes = passkey.sign(edits[0].id()).to_wire();
        assert_eq!(Signature::from_wire(&bytes).map(|s| s.enclave), Ok(None));
        let bytes = alone.sigs[0].to_wire();
        let at = touch.keys().to_wire().len() + 1;
        assert_eq!(bytes[at], 2, "after its keys and no assertion");
        let mut other = bytes.clone();
        other[at] = 3;
        assert_eq!(Signature::from_wire(&other), Err(WireError::Unknown));
    }

    #[test]
    fn an_ml_dsa_65_signer_reads_back_on_a_tag_of_its_own() {
        use crate::sign::{EnclaveKey, Passkey};
        let w = world();
        let edit = w.lab.log(w.mac_a).edits()[0].clone();
        let (slh, ml) = (Suite::SlhDsa, Suite::MlDsa);
        // each kind in each suite, its tag first: a signer made before the key move keeps its bytes
        let keys = [
            (DeviceKey::from_secret_in([3; 32], slh).keys(), 0, 65),
            (Passkey::from_seed_in([1; 32], slh).keys(), 1, 66),
            (EnclaveKey::from_seed_in([1; 32], slh).keys(), 2, 65),
            (DeviceKey::from_secret_in([3; 32], ml).keys(), 3, 65),
            (Passkey::from_seed_in([1; 32], ml).keys(), 4, 66),
            (EnclaveKey::from_seed_in([1; 32], ml).keys(), 5, 33),
        ];
        for (k, tag, len) in keys {
            let bytes = k.to_wire();
            assert_eq!((bytes[0], bytes.len()), (tag, len), "{k:?}");
            assert_eq!(SignerKeys::from_wire(&bytes), Ok(k));
        }
        assert_eq!(SignerKeys::from_wire(&[&[6], &[0; 64][..]].concat()), Err(WireError::Unknown));
        // their signatures, a hello and a pass
        let device = DeviceKey::from_secret_in([3; 32], ml);
        let mut passkey = Passkey::from_seed_in([1; 32], ml);
        let touch = EnclaveKey::from_seed_in([1; 32], ml);
        for sig in [device.sign(edit.id()), passkey.sign(edit.id()), touch.sign(edit.id())] {
            assert_eq!(Signature::from_wire(&sig.to_wire()), Ok(sig));
        }
        let hello = device.hello(&[5; 32], true);
        assert_eq!(Hello::from_wire(&hello.to_wire()), Ok(hello));
        // a pass says its suite by its signature's size
        let made = 1_791_500_000;
        for suite in [slh, ml] {
            let mut passkey = Passkey::from_seed_in([1; 32], suite);
            let pass = passkey.pass(DeviceKey::from_secret_in([3; 32], suite).keys(), made);
            let read = RelayPass::from_wire(&pass.to_wire()).expect("a pass");
            assert_eq!((read.pq.suite(), &read), (suite, &pass));
            assert!(read.passkeys(made).contains(&passkey.id()));
        }
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
        let (x, y) = (LogId::Vault(VaultId([1; 32])), LogId::Entry(EntryId([0; 32])));
        let mut ask = Ask::default();
        ask.haves.insert(y, vec![]);
        ask.haves.insert(x, vec![EditId([1; 32])]);
        let mut bytes = ask.to_wire();
        assert_eq!(Ask::from_wire(&bytes), Ok(ask));
        // swap the two logs: the vault's log (37 bytes, then its one edit) after the entry's
        let (first, rest) = bytes[4..].split_at(33 + 4 + 32);
        let swapped = [&rest[..33 + 4], first].concat();
        bytes.splice(4..4 + swapped.len(), swapped);
        assert_eq!(Ask::from_wire(&bytes), Err(WireError::Unordered));
        // an edit of another format version
        let action = Action::Settings { vault: VaultId([2; 32]), set: Setting::Threshold(1) };
        let edit = Edit { parents: vec![], depth: 0, author: SignerId([1; 32]), cosigners: vec![], action };
        let mut bytes = edit.to_wire();
        bytes[0] = VERSION + 1;
        assert_eq!(Edit::from_wire(&bytes), Err(WireError::Unknown));
    }

    #[test]
    fn a_request_names_the_vaults_it_follows_as_a_set_after_its_loose_edits() {
        let (a, b) = (VaultId([1; 32]), VaultId([2; 32]));
        let ask = Ask { loose: vec![EditId([3; 32])], follow: vec![a, b], ..Ask::default() };
        let bytes = Request { ask: ask.clone(), ..Request::default() }.to_wire();
        let n = |x: u32| x.to_be_bytes();
        let want = [&n(0)[..], &n(1), &[3; 32], &n(2), &a.0, &b.0, &n(0), &[0]].concat();
        assert_eq!(bytes, want);
        assert_eq!(Request::from_wire(&bytes).map(|r| r.ask), Ok(ask));
        // out of order, or one vault twice
        for follow in [vec![b, a], vec![a, a]] {
            let bytes = Ask { follow, ..Ask::default() }.to_wire();
            assert_eq!(Ask::from_wire(&bytes), Err(WireError::Unordered));
        }
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
    fn a_write_and_a_body_name_their_files_one_way_only() {
        let (a, b) = (FileRoot { hash: [1; 32], size: 16 }, FileRoot { hash: [2; 32], size: 65_552 });
        let action = |files: Vec<FileRoot>| Action::Write {
            vault: VaultId([1; 32]),
            entry: EntryId([2; 32]),
            actor: VaultId([1; 32]),
            stay: None,
            epoch: 0,
            deps: vec![],
            proposal: Proposal::Main,
            via: vec![],
            create: None,
            files,
            body: vec![7],
        };
        let edit = |files| {
            Edit { parents: vec![], depth: 0, author: SignerId([3; 32]), cosigners: vec![], action: action(files) }
        };
        for files in [vec![], vec![a], vec![a, b]] {
            let e = edit(files);
            assert_eq!(Edit::from_wire(&e.to_wire()), Ok(e));
        }
        // a write names its files always, none or some, smallest root first, no repeats, under its one tag
        let tag = 1 + 4 + 8 + 32 + 4;
        let first = tag + 1 + 32 + 32 + 32 + 1 + 8 + 4 + 1 + 4 + 1 + 4;
        let both = edit(vec![a, b]).to_wire();
        assert_eq!((both[tag], &both[first - 4..first]), (4, &[0, 0, 0, 2][..]));
        let mut swapped = both.clone();
        let (x, y) = (swapped[first..first + 40].to_vec(), swapped[first + 40..first + 80].to_vec());
        swapped.splice(first..first + 80, y.into_iter().chain(x));
        assert_eq!(Edit::from_wire(&swapped), Err(WireError::Unordered));
        let mut twice = both.clone();
        twice.copy_within(first..first + 40, first + 40);
        assert_eq!(Edit::from_wire(&twice), Err(WireError::Unordered));
        // the old tag of a write that brings files is no tag of the format's
        let mut old = both.clone();
        old[tag] = 14;
        assert_eq!(Edit::from_wire(&old), Err(WireError::Unknown));
        // a body holds their keys last, only when it brings some
        let brought = |root| Brought { root, key: FileKey::from_bytes([9; 32]), len: 0 };
        let body = Body { files: vec![brought(a), brought(b)], ..Body::default() };
        assert_eq!(Body::from_wire(&body.to_wire()), Ok(body.clone()));
        let plain = Body::default().to_wire();
        assert_eq!(body.to_wire()[..plain.len()], plain[..], "a body without files keeps its bytes");
        assert_eq!(Body::from_wire(&[plain.clone(), vec![0, 0, 0, 0]].concat()), Err(WireError::Unknown));
        let backwards = Body { files: vec![brought(b), brought(a)], ..Body::default() };
        assert_eq!(Body::from_wire(&backwards.to_wire()), Err(WireError::Unordered));
    }

    #[test]
    fn a_kind_a_level_or_a_grantee_the_format_lacks_is_no_edit() {
        let (v, g) = (VaultId([1; 32]), VaultId([2; 32]));
        let share = Share {
            over: v,
            who: Who::Vault(g),
            level: Level::Read,
            wide: false,
            select: vec![],
            parent: None,
            issuer: v,
            nonce: 0,
            group: None,
        };
        let edit = |action| Edit { parents: vec![], depth: 0, author: SignerId([3; 32]), cosigners: vec![], action };
        let grant = edit(Action::Share(Sharing::Grant(share.clone(), vec![])));
        let bytes = grant.to_wire();
        assert_eq!(Edit::from_wire(&bytes), Ok(grant));
        // after the version, no parents, the depth, the author and no cosigners: the kind, the sub-kind, the vault it
        // is over, whom it names and its level
        let at = 1 + 4 + 8 + 32 + 4;
        let (who, level) = (at + 2 + 32, at + 2 + 32 + 1 + 32);
        assert_eq!((bytes[at], bytes[at + 1], bytes[who], bytes[level]), (2, 0, 0, 3));
        let with = |i: usize, b: u8| {
            let mut x = bytes.clone();
            x[i] = b;
            Edit::from_wire(&x).map(|e| e.action)
        };
        let granted = |action: Result<Action, WireError>| match action {
            Ok(Action::Share(Sharing::Grant(c, _))) => Some((c.who, c.level)),
            _ => None,
        };
        // a level by its rank, relay 1 to owner 5, and none above owner
        let levels = [Level::Relay, Level::Backup, Level::Read, Level::Write, Level::Owner];
        for (rank, l) in (1..).zip(levels) {
            assert_eq!(granted(with(level, rank)), Some((Who::Vault(g), l)));
        }
        for rank in [6, 255] {
            assert_eq!(with(level, rank), Err(WireError::Unknown));
        }
        // whom a share names: a vault (0), a device (2) or an invite key (3), each named next, or everyone (1), and
        // nothing else
        assert_eq!(granted(with(who, 2)), Some((Who::Device(SignerId(g.0)), Level::Read)));
        assert_eq!(granted(with(who, 3)), Some((Who::Invite(SignerId(g.0)), Level::Read)));
        assert_eq!(with(who, 4), Err(WireError::Unknown));
        // keep, rank 0, and then its mode: 0 whole, 1 opened, 2 never, and no other
        let d = SignerId([4; 32]);
        let keep = |level| Share { who: Who::Device(d), level, ..share.clone() };
        for mode in [KeepMode::Whole, KeepMode::Opened, KeepMode::Never] {
            let k = edit(Action::Share(Sharing::Grant(keep(Level::Keep(mode)), vec![])));
            assert_eq!(Edit::from_wire(&k.to_wire()), Ok(k));
        }
        let mut bytes = edit(Action::Share(Sharing::Grant(keep(Level::Keep(KeepMode::Never)), vec![]))).to_wire();
        assert_eq!((bytes[who], bytes[level], bytes[level + 1]), (2, 0, 2));
        for b in [3, 255] {
            bytes[level + 1] = b;
            assert_eq!(Edit::from_wire(&bytes), Err(WireError::Unknown), "mode byte {b}");
        }
        // four sub-kinds of share, a grant of a cap group's, 3, among them, three of revocation, two of settings; eight
        // kinds and no more, as a checkpoint's tag, 7, went into the signature, a publish's, 8, into the write's, a
        // sync rule's, 9, and its end's, 10, into the share's and the revocation's, and a pick's, 11, into the mark's,
        // and a claim's is 12
        assert_eq!(with(at + 1, 4), Err(WireError::Unknown));
        let revoke = edit(Action::Revoke(Revoking::Grant { share: ShareId(g.0), actor: v, keep: vec![], via: vec![] }));
        let mut bytes = revoke.to_wire();
        bytes[at + 1] = 3;
        assert_eq!(Edit::from_wire(&bytes), Err(WireError::Unknown));
        let mut bytes = edit(Action::Settings { vault: v, set: Setting::Threshold(1) }).to_wire();
        bytes[at + 1 + 32] = 2;
        assert_eq!(Edit::from_wire(&bytes), Err(WireError::Unknown));
        for tag in [7, 8, 9, 10, 11, 13] {
            assert_eq!(with(at, tag), Err(WireError::Unknown), "tag {tag}");
        }
    }

    #[test]
    fn a_mark_names_its_audience_and_its_wants_each_or_not() {
        let (v, e, c, k) = (VaultId([1; 32]), EntryId([2; 32]), ShareId([3; 32]), EditId([4; 32]));
        let mark = |caps: Option<Vec<ShareId>>, wants: Option<Vec<ShareId>>, keep: Vec<EditId>| Edit {
            parents: vec![],
            depth: 0,
            author: SignerId([5; 32]),
            cosigners: vec![],
            action: Action::Mark { vault: v, entry: e, caps, wants, keep, via: vec![VaultId([6; 32])] },
        };
        // either part there or not, each read back as it was; a mark that keeps what it had seen and takes its entry
        // to no audience reads back too, as the rules refuse it, not the format (`Refusal::BadMark`)
        let parts = [(None, None), (Some(vec![c]), None), (None, Some(vec![c])), (Some(vec![]), Some(vec![c, c]))];
        for (caps, wants) in parts {
            for keep in [vec![], vec![k]] {
                let m = mark(caps.clone(), wants.clone(), keep);
                assert_eq!(Edit::from_wire(&m.to_wire()), Ok(m));
            }
        }
        // after the version, no parents, the depth, the author and no cosigners: the kind, the vault and the entry,
        // then a byte that says whether an audience follows, and one for the wants; a flag the format doesn't have is
        // no edit, and nor is a pick's old tag, 11
        let at = 1 + 4 + 8 + 32 + 4;
        let bytes = mark(None, Some(vec![c]), vec![]).to_wire();
        let (caps, wants) = (at + 1 + 32 + 32, at + 1 + 32 + 32 + 1);
        assert_eq!((bytes[at], bytes[caps], bytes[wants]), (5, 0, 1));
        for (i, b) in [(caps, 2), (wants, 2), (at, 11)] {
            let mut x = bytes.clone();
            x[i] = b;
            assert_eq!(Edit::from_wire(&x), Err(WireError::Unknown), "byte {i} as {b}");
        }
        // an audience said to be there that isn't
        let mut x = bytes.clone();
        x[caps] = 1;
        assert!(Edit::from_wire(&x).is_err());
    }

    #[test]
    fn create_on_a_line_is_grant_kind_13_and_old_grants_keep_their_bytes() {
        let read = |bytes: &[u8]| {
            let mut r = Reader { bytes, at: 0 };
            let grant = Grant::decode(&mut r)?;
            if r.at == bytes.len() { Ok(grant) } else { Err(WireError::Trailing) }
        };
        let grant = |ops: Vec<Op>| Grant { ops, salt: [9; 32] };
        let bytes = |g: &Grant| {
            let mut out = vec![];
            g.encode(&mut out);
            out
        };
        // a grant made before drafts, an Editor's, keeps its bytes: create is kind 3 alone, and its commitment stands
        let editor = grant(Level::Write.ops());
        let b = bytes(&editor);
        // after the count of its ops, read, then create, kind 3 with nothing after it, then set
        assert_eq!(&b[4..7], [2, 3, 4]);
        assert_eq!(read(&b), Ok(editor.clone()));
        // a creation on a line is kind 13, then the line: 0 main, 1 proposals
        for (on, byte) in [(On::Main, 0), (On::Proposals, 1)] {
            let g = grant(vec![Op::Read, Op::Create { on: Some(on) }]);
            let b = bytes(&g);
            assert_eq!(&b[4..7], [2, 13, byte]);
            assert_eq!(read(&b), Ok(g));
        }
        // the Suggester's new group reads back, and so does one made before drafts
        let suggester = crate::rules::groups().into_iter().find(|g| g.name == "Suggester").expect("Suggester").ops;
        for ops in [suggester, crate::rules::suggester_before_drafts()] {
            assert_eq!(read(&bytes(&grant(ops.clone()))), Ok(grant(ops)));
        }
        // the Member group, its setOwn ops kind 14, reads back
        let member = crate::rules::member();
        assert!(bytes(&grant(member.clone())).contains(&14));
        assert_eq!(read(&bytes(&grant(member.clone()))), Ok(grant(member)));
        // a line the format lacks is no grant, and nor is a kind past 14 (setOwn, the rooms' own edits)
        let mut b = bytes(&grant(vec![Op::Create { on: Some(On::Proposals) }]));
        b[5] = 2;
        assert_eq!(read(&b), Err(WireError::Unknown));
        b[5] = 1;
        b[4] = 15;
        assert_eq!(read(&b), Err(WireError::Unknown));
    }

    #[test]
    fn a_made_up_count_allocates_nothing() {
        // four billion edits claimed in eight bytes: refused before anything is made of them
        let bytes = [0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0];
        assert_eq!(Reply::from_wire(&bytes), Err(WireError::Short));
        assert_eq!(Announce::from_wire(&[&[0][..], &bytes[..4]].concat()), Err(WireError::Short));
    }

    #[test]
    fn holdings_read_back_only_from_their_own_bytes() {
        let (a, b) = (LogId::Vault(VaultId([1; 32])), LogId::Entry(EntryId([0; 32])));
        let frontier = Frontier { heads: vec![EditId([1; 32]), EditId([2; 32])], waiting: vec![EditId([3; 32])] };
        let one = FileRoot { hash: [4; 32], size: 16 };
        let film = FileRoot { hash: [5; 32], size: 3 * crate::sealed::PIECE };
        let files = vec![(one, Some(FileHold::Whole)), (film, Some(FileHold::Pieces(vec![0, 2])))];
        let announce = Announce { full: false, logs: vec![(a, frontier.clone()), (b, Frontier::default())], files };
        let bytes = announce.to_wire();
        assert_eq!(Announce::from_wire(&bytes), Ok(announce.clone()));
        let dropped = Announce { files: vec![(one, None)], ..Announce::default() };
        assert_eq!(Announce::from_wire(&dropped.to_wire()), Ok(dropped));
        // logs or files out of order, heads out of order, and pieces a file can't hold or that are all of it
        let swapped = Announce { logs: vec![(b, Frontier::default()), (a, frontier.clone())], ..announce.clone() };
        assert_eq!(Announce::from_wire(&swapped.to_wire()), Err(WireError::Unordered));
        let files = announce.files.iter().rev().cloned().collect();
        assert_eq!(Announce::from_wire(&Announce { files, ..announce.clone() }.to_wire()), Err(WireError::Unordered));
        let heads = Frontier { heads: frontier.heads.iter().rev().copied().collect(), ..frontier };
        let unordered = Announce { logs: vec![(a, heads)], ..Announce::default() };
        assert_eq!(Announce::from_wire(&unordered.to_wire()), Err(WireError::Unordered));
        for pieces in [vec![], vec![3], vec![0, 1, 2]] {
            let held = Announce { files: vec![(film, Some(FileHold::Pieces(pieces.clone())))], ..Announce::default() };
            assert_eq!(Announce::from_wire(&held.to_wire()), Err(WireError::Unknown), "{pieces:?}");
        }
        let held = Announce { files: vec![(one, Some(FileHold::Pieces(vec![0])))], ..Announce::default() };
        let held = Announce::from_wire(&held.to_wire());
        assert_eq!(held, Err(WireError::Unknown), "a file of one piece is whole or not");
        let mut flagged = bytes.clone();
        flagged[0] = 2;
        assert_eq!(Announce::from_wire(&flagged), Err(WireError::Unknown), "full is a flag");
    }

    #[test]
    fn a_devices_pass_reads_back_only_from_its_own_bytes() {
        let mac = DeviceKey::from_secret([7; 32]);
        let pass = mac.api_pass("maiaCITY API", 1_791_500_000);
        let bytes = pass.to_wire();
        assert_eq!(ApiPass::from_wire(&bytes), Ok(pass.clone()));
        assert_eq!(ApiPass::from_wire(&bytes).unwrap().device("maiaCITY API", 1_791_500_000), Some(mac.id()));
        assert_eq!(ApiPass::from_wire(&bytes[..bytes.len() - 1]), Err(WireError::Short));
        assert_eq!(ApiPass::from_wire(&[&bytes[..], &[0]].concat()), Err(WireError::Trailing));
        // a name longer than any service's is no pass
        let long = mac.api_pass(&"a".repeat(crate::sign::MAX_AUDIENCE + 1), 1_791_500_000);
        assert_eq!(ApiPass::from_wire(&long.to_wire()), Err(WireError::Unknown));
    }

    #[test]
    fn a_statement_proves_its_device_and_reads_back_only_from_its_own_bytes() {
        let (a, b) = (LogId::Vault(VaultId([1; 32])), LogId::Entry(EntryId([0; 32])));
        let frontier = Frontier { heads: vec![EditId([1; 32])], waiting: vec![EditId([3; 32])] };
        let one = FileRoot { hash: [4; 32], size: 16 };
        let film = FileRoot { hash: [5; 32], size: 3 * crate::sealed::PIECE };
        let (logs, files) =
            (vec![(a, frontier), (b, Frontier::default())], vec![(one, FileHold::Whole), (film, FileHold::Pieces(vec![1]))]);
        let (mac, phone) = (DeviceKey::from_secret([7; 32]), DeviceKey::from_secret([8; 32]));
        let sig = mac.state(&Statement::body(mac.id(), 1_760_000_000, &logs, &files));
        let stated = Statement { keys: mac.keys(), checked: 1_760_000_000, logs, files, sig };
        assert_eq!(stated.verify(), Some(mac.id()), "the Mac signed it, of itself");
        assert_eq!(Statement::from_wire(&stated.to_wire()), Ok(stated.clone()));
        // another time, other holdings or another device's keys: the signature is for none of them
        let later = Statement { checked: stated.checked + 1, ..stated.clone() };
        let less = Statement { files: vec![(one, FileHold::Whole)], ..stated.clone() };
        let theirs = Statement { keys: phone.keys(), ..stated.clone() };
        for forged in [later, less, theirs] {
            assert_eq!(forged.verify(), None, "{forged:?}");
        }
        // its signature on an edit, or an edit's on it, counts for neither
        let edit = EditId(crate::hash::Hasher::new("x").finalize());
        assert_eq!(Statement { sig: mac.sign(edit).pq, ..stated.clone() }.verify(), None);
        let body = Statement::body(mac.id(), stated.checked, &stated.logs, &stated.files);
        assert!(!crate::sign::verify(mac.id(), edit, &Signature { pq: mac.state(&body), ..mac.sign(edit) }));
        // a passkey's keys prove no statement
        let passkey = SignerKeys::Passkey { p256: [2; 33], pq: PqKey::Slh([1; 32]) };
        assert_eq!(Statement { keys: passkey, ..stated.clone() }.verify(), None);
        // logs or files out of order
        let swapped = Statement { logs: stated.logs.iter().rev().cloned().collect(), ..stated.clone() };
        assert_eq!(Statement::from_wire(&swapped.to_wire()), Err(WireError::Unordered));
        let swapped = Statement { files: stated.files.iter().rev().cloned().collect(), ..stated.clone() };
        assert_eq!(Statement::from_wire(&swapped.to_wire()), Err(WireError::Unordered));
    }
}
