//! Negotiated supplemental batch proofs. The enclosed legacy reply remains the
//! authoritative edit representation; every legacy signature is still verified.
//! Kind 14 wraps one of the existing authorized request kinds, never an unrestricted
//! edit-id lookup. Root metadata is attached only to edits already authorized in it.
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use anyhow::{Result, anyhow, ensure};
use avendb::batch::{self, ForkProof, Path, Proof, SignedRoot};
use avendb::id::SignerId;
use avendb::wire::{Packed, Reply, Wire};

use crate::Cursor;
use crate::signers::Signers;

pub(crate) const KIND: u8 = 14;
const VERSION: u8 = 1;
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
}
impl Request {
    pub(crate) fn encode(&self) -> Result<Vec<u8>> {
        ensure!(
            matches!(self.kind, 0 | 7 | 11) && self.request.len() <= MAX_REQUEST && self.known.len() <= MAX_KNOWN,
            "invalid batch proof request"
        );
        let mut out = vec![VERSION, self.kind];
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
        ensure!(take::<1>(&mut r)? == [VERSION], "unknown batch proof request");
        let kind = take::<1>(&mut r)?[0];
        ensure!(matches!(kind, 0 | 7 | 11), "unsupported nested request kind");
        let request = bytes(&mut r, MAX_REQUEST)?.to_vec();
        let mut known = BTreeMap::new();
        let n = count(&mut r, MAX_KNOWN)?;
        ensure!(r.0.len() == n * 40, "invalid known-root list");
        for _ in 0..n {
            let signer = SignerId(take(&mut r)?);
            let length = u64::from_be_bytes(take(&mut r)?);
            ensure!(known.insert(signer, length).is_none(), "duplicate known signer");
        }
        Ok(Self { kind, request, known })
    }
}

struct RootLink {
    root: SignedRoot,
    prefix: Vec<batch::Hash>,
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
}

impl Supplement {
    /// `durable` is the set of currently held, fully persisted legacy records. A
    /// ledger leaf alone, including a partially signed failed write, grants no proof.
    pub(crate) async fn attach(
        reply: Reply,
        store: &Signers,
        known: &BTreeMap<SignerId, u64>,
        durable: &BTreeSet<avendb::id::EditId>,
    ) -> Self {
        let mut roots = Vec::<RootLink>::new();
        let mut paths = Vec::new();
        let mut size = 0usize;
        let mut used_signers = BTreeSet::new();
        for (edit_index, signed) in reply.edits.iter().enumerate() {
            let edit_id = signed.edit.id();
            for (signer_index, signer) in signed.edit.sigs().enumerate() {
                used_signers.insert(signer);
                if !durable.contains(&edit_id) || paths.len() >= MAX_PROOFS {
                    continue;
                }
                let Some(proof) = store.proof(edit_id) else {
                    continue;
                };
                if proof.root.root.log != signer {
                    continue;
                }
                let found = roots.iter().position(|r| r.root.root == proof.root.root);
                let index = if let Some(index) = found {
                    index
                } else {
                    if roots.len() == MAX_ROOTS {
                        continue;
                    }
                    let prefix = known
                        .get(&signer)
                        .and_then(|n| store.prefix_at(*n, proof.root.root.length))
                        .unwrap_or_default();
                    let root_size = proof.root.to_wire().len() + prefix.len() * 32 + 12;
                    if size + root_size > MAX_SUPPLEMENT {
                        continue;
                    }
                    size += root_size;
                    roots.push(RootLink { root: (*proof.root).clone(), prefix });
                    roots.len() - 1
                };
                let path_size = proof.path.to_wire().len() + 16;
                if size + path_size > MAX_SUPPLEMENT {
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
                if forks.len() < MAX_ROOTS && size + bytes <= MAX_SUPPLEMENT {
                    size += bytes;
                    forks.push(fork);
                }
            }
        }
        Self { reply, roots, paths, forks }
    }

    pub(crate) fn encode(&self) -> Result<Vec<u8>> {
        let legacy = Packed(self.reply.clone()).to_wire();
        ensure!(legacy.len() <= MAX_REPLY, "oversized legacy reply");
        let mut out = vec![VERSION];
        put(&mut out, &legacy);
        let start = out.len();
        out.extend_from_slice(&(self.roots.len() as u32).to_be_bytes());
        for root in &self.roots {
            put(&mut out, &root.root.to_wire());
            out.extend_from_slice(&(root.prefix.len() as u32).to_be_bytes());
            for hash in &root.prefix {
                out.extend_from_slice(hash);
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
        ensure!(out.len() - start <= MAX_SUPPLEMENT, "oversized proof supplement");
        Ok(out)
    }

    pub(crate) fn decode(data: &[u8]) -> Result<Self> {
        ensure!(data.len() <= MAX_REPLY + MAX_SUPPLEMENT + 5, "oversized supplemented reply");
        let mut r = Cursor(data);
        ensure!(take::<1>(&mut r)? == [VERSION], "unknown proof supplement");
        let reply = Packed::from_wire(bytes(&mut r, MAX_REPLY)?)?.0;
        ensure!(r.0.len() <= MAX_SUPPLEMENT, "oversized proof supplement");
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
            roots.push(RootLink { root, prefix });
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
        let mentioned: BTreeSet<_> = reply.edits.iter().flat_map(|s| s.edit.sigs()).collect();
        ensure!(
            roots.iter().all(|r| mentioned.contains(&r.root.root.log))
                && forks.iter().all(|f| f.signer().is_some_and(|s| mentioned.contains(&s))),
            "unrelated signer metadata"
        );
        Ok(Self { reply, roots, paths, forks })
    }

    /// Persist fork/admission decisions before checking paths. Failure or an unlinked
    /// root never weakens legacy verification: the caller still receives the original
    /// Signed edits through the ordinary Lab receive path. Invalid supplements fail
    /// this attempt and may be retried through the ordinary legacy request.
    pub(crate) async fn verify(self, store: &Signers) -> Result<Reply> {
        for fork in self.forks {
            store.freeze(fork).await?;
        }
        let mut admitted = Vec::with_capacity(self.roots.len());
        for root in &self.roots {
            admitted.push(store.admit(root.root.clone(), &root.prefix).await?);
        }
        let ids: Vec<_> = self.reply.edits.iter().map(|signed| signed.edit.id()).collect();
        for p in self.paths {
            if !admitted[p.root] {
                continue;
            }
            let edit = &self.reply.edits[p.edit].edit;
            let proof = Proof { root: Arc::new(self.roots[p.root].root.clone()), path: p.path };
            ensure!(
                store.check(edit.sigs().nth(p.signer).expect("decoded signer"), ids[p.edit], &proof).await,
                "invalid supplemental proof"
            );
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
                body: b"legacy bytes are unchanged".to_vec(),
            },
        };
        let signed = Signed { sigs: vec![key.sign(edit.id())], edit };
        let mut log = SignerLog::wrap(key.id(), [signed.edit.id()]);
        log.commit(&key);
        let proof = log.proof(signed.edit.id()).unwrap();
        Supplement {
            reply: Reply { edits: vec![signed], blobs: vec![], more: false },
            roots: vec![RootLink { root: (*proof.root).clone(), prefix: vec![] }],
            paths: vec![PathRef { edit: 0, signer: 0, root: 0, path: proof.path }],
            forks: vec![],
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
    fn supplemental_codec_roundtrips_legacy_slh_dsa_roots_and_signatures() {
        let original = sample_with(DeviceKey::from_secret_in([198; 32], avendb::sign::Suite::SlhDsa));
        assert!(original.roots[0].root.to_wire().len() > 16_384);
        let encoded = original.encode().unwrap();
        let decoded = Supplement::decode(&encoded).unwrap();
        assert_eq!(decoded.encode().unwrap(), encoded);
        assert!(decoded.reply.edits[0].verify().is_ok());
        let proof = Proof { root: Arc::new(decoded.roots[0].root.clone()), path: decoded.paths[0].path.clone() };
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
                Request { kind, request: vec![1, 2, 3], known: BTreeMap::from([(SignerId::from_u64(7), 42)]) };
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
            assert!(Request { kind, request: vec![], known: BTreeMap::new() }.encode().is_err());
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
