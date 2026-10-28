//! Negotiated supplemental batch proofs. Kind 14 wraps one of the existing authorized request kinds, never an
//! unrestricted edit-id lookup. Root metadata is attached only to edits already authorized in it.
//!
//! Version 1 attaches paths beside the legacy reply, every legacy signature still sent and verified. Version 2 (P8,
//! `spec/AvenDB/WireBatches.lean`) is asked by a node that reads paths (`Options::paths`): each part with a path
//! goes without its signature, its root once in the reply's table, and the receiver holds the path in the
//! signature's place (`batch::Proof::held`) once its root is admitted and the path checks. Parts a node holds by a
//! path already travel as they are held, and a frozen signer's are refused. A node that asks version 1 or a legacy
//! kind is sent no edit held by a path (`WireBatches.toOld`): an old app reads signatures alone.
//!
//! Version 3 (S8, `spec/AvenDB/Segments.lean`) is asked by a node that keeps other writers' segments
//! (`Options::segments`): the asker names every writer it holds a root of, with how many of its ids it holds, and the
//! node attaches paths for every writer of the reply it holds a segment of, not its own log's alone, each root once and
//! linked to the asker's, with the writer's ids beyond the ones the asker holds. The asker takes those ids only where
//! they and the ones it holds rebuild the signed root exactly (`Signers::extend`), and serves paths for that writer in
//! its turn. So a page through a relay costs one signature check per writer, not per edit. Version 3 may strip
//! signatures as version 2 does, or keep them, as the server does for old apps.
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use anyhow::{Result, anyhow, ensure};
use avendb::batch::{self, ForkProof, Path, Proof, SignedRoot};
use avendb::id::{EditId, SignerId};
use avendb::sign::Signature;
use avendb::wire::{Packed, Reply, Wire};

use crate::Cursor;
use crate::signers::Signers;

pub(crate) const KIND: u8 = 14;
const VERSION: u8 = 1;
/// Parts with a path go without their signatures (`Request::paths`).
const PATHS: u8 = 2;
/// Paths of every writer the node holds a segment of, with the ids beyond the asker's (`Request::held`).
const SEGMENTS: u8 = 3;
/// A segment request's flags: strip the signatures that paths stand in for.
const STRIP: u8 = 1;
pub(crate) const MAX_KNOWN_SEGMENTS: usize = 4096;
/// Version 3 carries up to `MAX_SEGMENT_IDS` ids a root.
const MAX_SEGMENT_SUPPLEMENT: usize = 8 << 20;
const MAX_ROOTS: usize = 128;
const MAX_KNOWN: usize = 128;
const MAX_PROOFS: usize = 4096;
const MAX_SUPPLEMENT: usize = 1 << 20;
const MAX_REQUEST: usize = 16 << 20;
const MAX_REPLY: usize = 256 << 20;
// Legacy SLH-DSA alone has a 17,088-byte signature, plus its key/root.
const MAX_ROOT: usize = 32 << 10;

fn take<const N: usize>(r: &mut Cursor<'_>) -> Result<[u8; N]> {
    r.array().ok_or_else(|| anyhow!("truncated batch proof message"))
}
fn count(r: &mut Cursor<'_>, max: usize) -> Result<usize> {
    let n = u32::from_be_bytes(take(r)?) as usize;
    ensure!(n <= max, "oversized batch proof message");
    Ok(n)
}
fn bytes<'a>(r: &mut Cursor<'a>, max: usize) -> Result<&'a [u8]> {
    let n = count(r, max)?;
    r.take(n).ok_or_else(|| anyhow!("truncated batch proof message"))
}
fn put(out: &mut Vec<u8>, b: &[u8]) {
    out.extend_from_slice(&(b.len() as u32).to_be_bytes());
    out.extend_from_slice(b);
}

pub(crate) struct Request {
    pub(crate) kind: u8,
    pub(crate) request: Vec<u8>,
    pub(crate) known: BTreeMap<SignerId, u64>,
    /// The asker reads paths in place of signatures (version 2); a node that doesn't know version 2 refuses it, and
    /// the asker asks version 1 again.
    pub(crate) paths: bool,
    /// Version 3: the asker keeps segments, and holds this many ids of each writer named in `known`.
    pub(crate) held: Option<BTreeMap<SignerId, u64>>,
}
impl Request {
    pub(crate) fn encode(&self) -> Result<Vec<u8>> {
        let most = if self.held.is_some() { MAX_KNOWN_SEGMENTS } else { MAX_KNOWN };
        ensure!(
            matches!(self.kind & !crate::session::SIZED, 0 | 7 | 11) && self.request.len() <= MAX_REQUEST && self.known.len() <= most,
            "invalid batch proof request"
        );
        if let Some(held) = &self.held {
            ensure!(held.keys().all(|s| self.known.contains_key(s)), "held ids of an unknown writer");
            let mut out = vec![SEGMENTS, if self.paths { STRIP } else { 0 }, self.kind];
            put(&mut out, &self.request);
            out.extend_from_slice(&(self.known.len() as u32).to_be_bytes());
            for (signer, length) in &self.known {
                out.extend_from_slice(&signer.0);
                out.extend_from_slice(&length.to_be_bytes());
                out.extend_from_slice(&held.get(signer).copied().unwrap_or(0).to_be_bytes());
            }
            return Ok(out);
        }
        let mut out = vec![if self.paths { PATHS } else { VERSION }, self.kind];
        put(&mut out, &self.request);
        out.extend_from_slice(&(self.known.len() as u32).to_be_bytes());
        for (signer, length) in &self.known {
            out.extend_from_slice(&signer.0);
            out.extend_from_slice(&length.to_be_bytes());
        }
        Ok(out)
    }
    pub(crate) fn decode(data: &[u8]) -> Result<Self> {
        ensure!(data.len() <= MAX_REQUEST + 8192, "oversized batch proof request");
        let mut r = Cursor(data);
        let (paths, segments) = match take::<1>(&mut r)? {
            [VERSION] => (false, false),
            [PATHS] => (true, false),
            [SEGMENTS] => match take::<1>(&mut r)? {
                [0] => (false, true),
                [STRIP] => (true, true),
                _ => anyhow::bail!("unknown segment request flags"),
            },
            _ => anyhow::bail!("unknown batch proof request"),
        };
        let kind = take::<1>(&mut r)?[0];
        ensure!(matches!(kind & !crate::session::SIZED, 0 | 7 | 11), "unsupported nested request kind");
        let request = bytes(&mut r, MAX_REQUEST)?.to_vec();
        let mut known = BTreeMap::new();
        let mut held = segments.then(BTreeMap::new);
        let n = count(&mut r, if segments { MAX_KNOWN_SEGMENTS } else { MAX_KNOWN })?;
        ensure!(r.0.len() == n * if segments { 48 } else { 40 }, "invalid known-root list");
        for _ in 0..n {
            let signer = SignerId(take(&mut r)?);
            let length = u64::from_be_bytes(take(&mut r)?);
            ensure!(known.insert(signer, length).is_none(), "duplicate known signer");
            if let Some(held) = &mut held {
                let ids = u64::from_be_bytes(take(&mut r)?);
                if ids > 0 {
                    held.insert(signer, ids);
                }
            }
        }
        Ok(Self { kind, request, known, paths, held })
    }
}

struct RootLink {
    root: SignedRoot,
    prefix: Vec<batch::Hash>,
    /// Version 3: the writer's ids from the first one the asker doesn't hold up to the root.
    ids: Option<(u64, Vec<EditId>)>,
}
struct PathRef {
    edit: usize,
    signer: usize,
    root: usize,
    path: Path,
}

pub(crate) struct Supplement {
    pub(crate) reply: Reply,
    roots: Vec<RootLink>,
    paths: Vec<PathRef>,
    forks: Vec<ForkProof>,
    /// Version 2: each part with a path goes without its signature.
    stripped: bool,
    /// Version 3: paths of other writers' segments, with their ids.
    segments: bool,
}

/// A signature with only its keys: the part of a version 2 reply whose path stands in its place.
fn stripped_sig(sig: &Signature) -> Signature {
    Signature { keys: sig.keys, webauthn: None, enclave: None, pq: vec![] }
}

impl Supplement {
    /// `durable` is the set of currently held, fully persisted legacy records. A
    /// ledger leaf alone, including a partially signed failed write, grants no proof.
    pub(crate) async fn attach(
        reply: Reply,
        store: &Signers,
        request: &Request,
        durable: &BTreeSet<avendb::id::EditId>,
    ) -> Self {
        let (known, strip) = (&request.known, request.paths);
        let segments = request.held.is_some();
        let most = if segments { MAX_SEGMENT_SUPPLEMENT } else { MAX_SUPPLEMENT };
        let mut roots = Vec::<RootLink>::new();
        let mut paths = Vec::new();
        let mut size = 0usize;
        let mut used_signers = BTreeSet::new();
        for (edit_index, signed) in reply.edits.iter().enumerate() {
            let edit_id = signed.edit.id();
            for (signer_index, signer) in signed.edit.sigs().enumerate() {
                used_signers.insert(signer);
                // a ledger leaf of this node's own needs the edit durably held; another writer's segment is that
                // writer's own signed word, whatever this node holds
                let own = signer == store.me();
                if (own && !durable.contains(&edit_id)) || (!own && !segments) || paths.len() >= MAX_PROOFS {
                    continue;
                }
                // a part held by a path already travels as it is held, and a device's own signature on its edit is
                // all it strips: never a passkey's assertion or an Enclave's
                let sig = &signed.sigs[signer_index];
                if strip && (sig.webauthn.is_some() || sig.enclave.is_some() || sig.pq.starts_with(batch::PATH_MARK)) {
                    continue;
                }
                let proof = if own { store.proof(edit_id) } else { store.peer_proof(signer, edit_id).await };
                let Some(proof) = proof else {
                    continue;
                };
                // a root shorter than the asker's newest can't be linked to it: the signature goes instead
                if proof.root.root.log != signer || known.get(&signer).is_some_and(|n| *n > proof.root.root.length) {
                    continue;
                }
                let found = roots.iter().position(|r| r.root.root == proof.root.root);
                let index = if let Some(index) = found {
                    index
                } else {
                    if roots.len() == MAX_ROOTS {
                        continue;
                    }
                    let length = proof.root.root.length;
                    let prefix = match known.get(&signer) {
                        Some(n) if own => store.prefix_at(*n, length),
                        Some(n) => store.peer_prefix(signer, *n, length).await,
                        None => None,
                    }
                    .unwrap_or_default();
                    let from = request.held.as_ref().map(|h| h.get(&signer).copied().unwrap_or(0));
                    let ids = match from {
                        Some(from) if from < length => store.segment(signer, from, length).await.map(|ids| (from, ids)),
                        _ => None,
                    };
                    let root_size = proof.root.to_wire().len()
                        + prefix.len() * 32
                        + 13
                        + ids.as_ref().map_or(0, |(_, ids)| 12 + ids.len() * 32);
                    if size + root_size > most {
                        continue;
                    }
                    size += root_size;
                    roots.push(RootLink { root: (*proof.root).clone(), prefix, ids });
                    roots.len() - 1
                };
                let path_size = proof.path.to_wire().len() + 16;
                if size + path_size > most {
                    continue;
                }
                size += path_size;
                paths.push(PathRef { edit: edit_index, signer: signer_index, root: index, path: proof.path });
            }
        }
        let mut forks = Vec::new();
        for signer in used_signers {
            if let Some(fork) = store.fork(signer).await {
                let bytes = fork.to_wire().len() + 4;
                if forks.len() < MAX_ROOTS && size + bytes <= most {
                    size += bytes;
                    forks.push(fork);
                }
            }
        }
        Self { reply, roots, paths, forks, stripped: strip, segments }
    }

    pub(crate) fn encode(&self) -> Result<Vec<u8>> {
        let mut reply = self.reply.clone();
        if self.stripped {
            for p in &self.paths {
                let sig = &mut reply.edits[p.edit].sigs[p.signer];
                *sig = stripped_sig(sig);
            }
        }
        let legacy = Packed(reply).to_wire();
        ensure!(legacy.len() <= MAX_REPLY, "oversized legacy reply");
        let mut out = if self.segments {
            vec![SEGMENTS, if self.stripped { STRIP } else { 0 }]
        } else {
            vec![if self.stripped { PATHS } else { VERSION }]
        };
        put(&mut out, &legacy);
        let start = out.len();
        out.extend_from_slice(&(self.roots.len() as u32).to_be_bytes());
        for root in &self.roots {
            put(&mut out, &root.root.to_wire());
            out.extend_from_slice(&(root.prefix.len() as u32).to_be_bytes());
            for hash in &root.prefix {
                out.extend_from_slice(hash);
            }
            if self.segments {
                match &root.ids {
                    None => out.push(0),
                    Some((from, ids)) => {
                        out.push(1);
                        out.extend_from_slice(&from.to_be_bytes());
                        out.extend_from_slice(&(ids.len() as u32).to_be_bytes());
                        for id in ids {
                            out.extend_from_slice(&id.0);
                        }
                    }
                }
            }
        }
        out.extend_from_slice(&(self.paths.len() as u32).to_be_bytes());
        for p in &self.paths {
            for n in [p.edit, p.signer, p.root] {
                out.extend_from_slice(&(n as u32).to_be_bytes());
            }
            put(&mut out, &p.path.to_wire());
        }
        out.extend_from_slice(&(self.forks.len() as u32).to_be_bytes());
        for fork in &self.forks {
            put(&mut out, &fork.to_wire());
        }
        let most = if self.segments { MAX_SEGMENT_SUPPLEMENT } else { MAX_SUPPLEMENT };
        ensure!(out.len() - start <= most, "oversized proof supplement");
        Ok(out)
    }

    pub(crate) fn decode(data: &[u8]) -> Result<Self> {
        ensure!(data.len() <= MAX_REPLY + MAX_SEGMENT_SUPPLEMENT + 6, "oversized supplemented reply");
        let mut r = Cursor(data);
        let (stripped, segments) = match take::<1>(&mut r)? {
            [VERSION] => (false, false),
            [PATHS] => (true, false),
            [SEGMENTS] => match take::<1>(&mut r)? {
                [0] => (false, true),
                [STRIP] => (true, true),
                _ => anyhow::bail!("unknown segment supplement flags"),
            },
            _ => anyhow::bail!("unknown proof supplement"),
        };
        let reply = Packed::from_wire(bytes(&mut r, MAX_REPLY)?)?.0;
        ensure!(
            r.0.len() <= if segments { MAX_SEGMENT_SUPPLEMENT } else { MAX_SUPPLEMENT },
            "oversized proof supplement"
        );
        let n = count(&mut r, MAX_ROOTS)?;
        let mut roots = Vec::with_capacity(n);
        let mut unique = BTreeSet::new();
        for _ in 0..n {
            let root = SignedRoot::from_wire(bytes(&mut r, MAX_ROOT)?)?;
            ensure!(unique.insert((root.root.log, root.root.length, root.root.hash)), "duplicate proof root");
            let m = count(&mut r, batch::MOST_STEPS + 1)?;
            let mut prefix = Vec::with_capacity(m);
            for _ in 0..m {
                prefix.push(take(&mut r)?);
            }
            let ids = if segments && take::<1>(&mut r)? == [1] {
                let from = u64::from_be_bytes(take(&mut r)?);
                let n = count(&mut r, crate::signers::MAX_SEGMENT_IDS)?;
                ensure!(from.checked_add(n as u64) == Some(root.root.length), "segment ids end short of their root");
                let mut ids = Vec::with_capacity(n);
                for _ in 0..n {
                    ids.push(EditId(take(&mut r)?));
                }
                Some((from, ids))
            } else {
                None
            };
            roots.push(RootLink { root, prefix, ids });
        }
        let n = count(&mut r, MAX_PROOFS)?;
        let mut paths = Vec::with_capacity(n);
        let mut unique = BTreeSet::new();
        for _ in 0..n {
            let edit = count(&mut r, u32::MAX as usize)?;
            let signer = count(&mut r, u32::MAX as usize)?;
            let root = count(&mut r, u32::MAX as usize)?;
            let path = Path::from_wire(bytes(&mut r, 32 * batch::MOST_STEPS + 64)?)?;
            let signed = reply.edits.get(edit).ok_or_else(|| anyhow!("path names no edit"))?;
            let signer_id = signed.edit.sigs().nth(signer).ok_or_else(|| anyhow!("path names no signer"))?;
            let linked = roots.get(root).ok_or_else(|| anyhow!("path names no root"))?;
            ensure!(
                signer_id == linked.root.root.log && unique.insert((edit, signer)),
                "wrong or duplicate proof signer"
            );
            paths.push(PathRef { edit, signer, root, path });
        }
        let n = count(&mut r, MAX_ROOTS)?;
        let mut forks = Vec::with_capacity(n);
        for _ in 0..n {
            forks.push(ForkProof::from_wire(bytes(&mut r, MAX_ROOT * 2 + 4096)?)?);
        }
        ensure!(r.0.is_empty(), "trailing proof bytes");
        if stripped {
            // a part goes without its signature exactly where its path stands in its place
            let placed: BTreeSet<(usize, usize)> = paths.iter().map(|p| (p.edit, p.signer)).collect();
            for (e, signed) in reply.edits.iter().enumerate() {
                for (s, sig) in signed.sigs.iter().enumerate() {
                    let bare = sig.pq.is_empty() && sig.webauthn.is_none() && sig.enclave.is_none();
                    ensure!(!bare || placed.contains(&(e, s)), "a part with neither its signature nor its path");
                }
            }
            for p in &paths {
                let sig = &reply.edits[p.edit].sigs[p.signer];
                ensure!(*sig == stripped_sig(sig), "a stripped part that still carries its signature");
            }
        }
        let mentioned: BTreeSet<_> = reply.edits.iter().flat_map(|s| s.edit.sigs()).collect();
        ensure!(
            roots.iter().all(|r| mentioned.contains(&r.root.root.log))
                && forks.iter().all(|f| f.signer().is_some_and(|s| mentioned.contains(&s))),
            "unrelated signer metadata"
        );
        Ok(Self { reply, roots, paths, forks, stripped, segments })
    }

    /// Persist fork/admission decisions before checking paths. Failure or an unlinked
    /// root never weakens legacy verification: the caller still receives the original
    /// Signed edits through the ordinary Lab receive path. Invalid supplements fail
    /// this attempt and may be retried through the ordinary legacy request.
    pub(crate) async fn verify(mut self, store: &Signers) -> Result<Reply> {
        for fork in self.forks {
            store.freeze(fork).await?;
        }
        let mut admitted = Vec::with_capacity(self.roots.len());
        for root in &self.roots {
            let taken = store.admit(root.root.clone(), &root.prefix).await?;
            // a writer's ids are held only once its root is admitted, and only where they rebuild it exactly
            // (`Segments.extend`); ids that don't leave what this node held as it was
            if let (true, Some((from, ids))) = (taken, &root.ids) {
                store.extend(&root.root, *from, ids).await?;
            }
            admitted.push(taken);
        }
        let ids: Vec<_> = self.reply.edits.iter().map(|signed| signed.edit.id()).collect();
        for p in self.paths {
            // version 1 keeps the signature beside an unlinked root; version 2 has nothing else to stand on
            if !admitted[p.root] {
                ensure!(!self.stripped, "a path to a root this node can't link");
                continue;
            }
            let edit = &self.reply.edits[p.edit].edit;
            let proof = Proof { root: Arc::new(self.roots[p.root].root.clone()), path: p.path };
            ensure!(
                store.check(edit.sigs().nth(p.signer).expect("decoded signer"), ids[p.edit], &proof).await,
                "invalid supplemental proof"
            );
            if self.stripped {
                self.reply.edits[p.edit].sigs[p.signer] = proof.held();
            }
        }
        // a part held by a path elsewhere stands on its signer's log: none of a signer this node froze
        for signed in &self.reply.edits {
            for (signer, sig) in signed.edit.sigs().zip(&signed.sigs) {
                if sig.pq.starts_with(batch::PATH_MARK) {
                    ensure!(store.fork(signer).await.is_none(), "a path of a frozen signer");
                }
            }
        }
        Ok(self.reply)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use avendb::batch::SignerLog;
    use avendb::id::{EntryId, VaultId};
    use avendb::policy::{Action, Edit, Proposal};
    use avendb::sign::{DeviceKey, Signed};

    fn sample() -> Supplement {
        sample_with(DeviceKey::from_secret([199; 32]))
    }
    fn sample_with(key: DeviceKey) -> Supplement {
        let edit = Edit {
            parents: vec![],
            depth: 1,
            author: key.id(),
            cosigners: vec![],
            action: Action::Write {
                vault: VaultId::from_u64(1),
                entry: EntryId::from_u64(1),
                actor: VaultId::from_u64(1),
                stay: None,
                epoch: 0,
                deps: vec![],
                proposal: Proposal::Main,
                via: vec![],
                create: None,
                files: vec![],
                body: b"legacy bytes are unchanged".to_vec().into(),
            },
        };
        let signed = Signed { sigs: vec![key.sign(edit.id())], edit };
        let mut log = SignerLog::wrap(key.id(), [signed.edit.id()]);
        log.commit(&key);
        let proof = log.proof(signed.edit.id()).unwrap();
        Supplement {
            reply: Reply { edits: vec![signed], blobs: vec![], more: false },
            roots: vec![RootLink { root: (*proof.root).clone(), prefix: vec![], ids: None }],
            paths: vec![PathRef { edit: 0, signer: 0, root: 0, path: proof.path }],
            forks: vec![],
            stripped: false,
            segments: false,
        }
    }

    #[test]
    fn supplemental_codec_preserves_every_legacy_signature_byte() {
        let original = sample();
        let legacy = original.reply.edits[0].to_wire();
        let bytes = original.encode().unwrap();
        let decoded = Supplement::decode(&bytes).unwrap();
        assert_eq!(decoded.reply.edits[0].to_wire(), legacy);
        assert!(decoded.reply.edits[0].verify().is_ok());
        assert_eq!(decoded.encode().unwrap(), bytes);
        let path = &decoded.paths[0];
        let proof = Proof { root: Arc::new(decoded.roots[0].root.clone()), path: path.path.clone() };
        assert!(proof.shows(decoded.reply.edits[0].edit.author, decoded.reply.edits[0].edit.id()));
    }

    #[test]
    fn codecs_reject_truncation_trailing_bytes_duplicate_and_out_of_range_refs() {
        let original = sample().encode().unwrap();
        for n in [0, 1, 4, original.len() / 2, original.len() - 1] {
            assert!(Supplement::decode(&original[..n]).is_err());
        }
        let mut trailing = original.clone();
        trailing.push(0);
        assert!(Supplement::decode(&trailing).is_err());
        let mut bad = sample();
        bad.paths[0].edit = usize::MAX;
        assert!(Supplement::decode(&bad.encode().unwrap()).is_err());
        let mut bad = sample();
        bad.paths[0].root = 17;
        assert!(Supplement::decode(&bad.encode().unwrap()).is_err());
        let mut bad = sample();
        bad.paths.push(PathRef { edit: 0, signer: 0, root: 0, path: bad.paths[0].path.clone() });
        assert!(Supplement::decode(&bad.encode().unwrap()).is_err());
        let mut bad = sample();
        bad.roots[0].root.root.log = SignerId::from_u64(88);
        assert!(Supplement::decode(&bad.encode().unwrap()).is_err());
        // A malicious declared collection size must fail before allocation.
        let mut bad = vec![VERSION];
        put(&mut bad, &Packed(sample().reply).to_wire());
        bad.extend_from_slice(&u32::MAX.to_be_bytes());
        assert!(Supplement::decode(&bad).is_err());
    }

    #[test]
    fn request_is_bounded_and_cannot_nest_arbitrary_protocol_kinds() {
        for kind in [0, 7, 11] {
            let request =
                Request { kind, request: vec![1, 2, 3], known: BTreeMap::from([(SignerId::from_u64(7), 42)]), paths: kind == 7, held: None };
            let bytes = request.encode().unwrap();
            let decoded = Request::decode(&bytes).unwrap();
            assert_eq!(decoded.encode().unwrap(), bytes);
            for n in [0, 1, bytes.len() - 1] {
                assert!(Request::decode(&bytes[..n]).is_err());
            }
            let mut trailing = bytes;
            trailing.push(0);
            assert!(Request::decode(&trailing).is_err());
        }
        for kind in [1, 8, 12, 13, 14, 15, 255] {
            assert!(Request { kind, request: vec![], known: BTreeMap::new(), paths: false, held: None }.encode().is_err());
        }
        let mut malicious = vec![VERSION, 0];
        malicious.extend_from_slice(&u32::MAX.to_be_bytes());
        assert!(Request::decode(&malicious).is_err());
        let mut repeated = vec![VERSION, 0];
        put(&mut repeated, &[]);
        repeated.extend_from_slice(&2u32.to_be_bytes());
        for _ in 0..2 {
            repeated.extend_from_slice(&[0; 32]);
            repeated.extend_from_slice(&1u64.to_be_bytes());
        }
        assert!(Request::decode(&repeated).is_err());
    }
}
