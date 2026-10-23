//! Canonical bounded framing for the optional, own-signer entry-write range path.
//! No Packed decoder is used: a borrowed write-only scan bounds decoded object allocation before legacy decode.
use crate::Cursor;
use crate::edit_ranges::{self as ranges, Block, Prefix, Summary};
use anyhow::{Result, anyhow, ensure};
use avendb::batch::{self, Path, SignedRoot};
use avendb::id::{EditId, SignerId};
use avendb::sign::Signed;
use avendb::sync::LogId;
use avendb::wire::{Request as Asking, Wire};
use bao_tree::blake3;
use std::collections::BTreeSet;
use std::sync::Arc;

pub(crate) const FETCH_BYTES: usize = 8 << 20;
pub(crate) const ROOT_BYTES: usize = 32_768;
pub(crate) const PATH_BYTES: usize = 32 * batch::MOST_STEPS + 32;
// Leave room for paths, counts, all envelope fields and transient per-record wire prefixes.
pub(crate) const PAYLOAD_BYTES: usize = FETCH_BYTES - ranges::FETCH_IDS * (PATH_BYTES + 16) - 256;
const VERSION: u8 = 1;
const LOGS: usize = 256;

fn take<const N: usize>(r: &mut Cursor<'_>) -> Result<[u8; N]> {
    r.array()
        .ok_or_else(|| anyhow!("truncated edit range frame"))
}
fn count(r: &mut Cursor<'_>, max: usize) -> Result<usize> {
    let n = u32::from_be_bytes(take(r)?) as usize;
    ensure!(n <= max, "edit range count");
    Ok(n)
}
fn bytes<'a>(r: &mut Cursor<'a>, max: usize) -> Result<&'a [u8]> {
    let n = count(r, max)?;
    r.take(n)
        .ok_or_else(|| anyhow!("truncated edit range bytes"))
}
fn put(out: &mut Vec<u8>, data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(data);
}
fn done(r: &Cursor<'_>) -> Result<()> {
    ensure!(r.0.is_empty(), "trailing edit range bytes");
    Ok(())
}
fn prefix(r: &mut Cursor<'_>) -> Result<Prefix> {
    let n = take::<1>(r)?[0] as usize;
    ensure!(n <= 64, "edit range depth");
    let p = r
        .take(n)
        .ok_or_else(|| anyhow!("short edit range prefix"))?;
    ensure!(p.iter().all(|b| *b < 16), "edit range nibble");
    Ok(p.to_vec())
}
fn put_prefix(out: &mut Vec<u8>, p: &[u8]) {
    out.push(p.len() as u8);
    out.extend_from_slice(p);
}
fn summary(r: &mut Cursor<'_>) -> Result<Summary> {
    let s = Summary {
        count: u32::from_be_bytes(take(r)?),
        hash: take(r)?,
    };
    s.validate()?;
    Ok(s)
}
fn put_summary(out: &mut Vec<u8>, s: Summary) {
    out.extend_from_slice(&s.count.to_be_bytes());
    out.extend_from_slice(&s.hash);
}

/// The request includes only its requested entry logs and follow set. Frontiers and loose IDs would make the
/// offered tree depend on a claimed causal frontier, which cannot describe sparse gaps reliably.
pub(crate) fn validate_asking(request: &Asking) -> Result<()> {
    ensure!(
        !request.ask.haves.is_empty()
            && request.ask.haves.len() <= LOGS
            && request.ask.follow.len() <= LOGS,
        "edit range scope size"
    );
    ensure!(
        request.after.is_none()
            && request.wants.is_empty()
            && request.ask.loose.is_empty()
            && request
                .ask
                .haves
                .iter()
                .all(|(log, ids)| matches!(log, LogId::Entry(_)) && ids.is_empty()),
        "edit range scope is not a canonical entry request"
    );
    Ok(())
}
pub(crate) fn scope(request: &Asking) -> [u8; 32] {
    let mut h = blake3::Hasher::new();
    h.update(b"avenDB edit range scope 1\n");
    h.update(&request.to_wire());
    h.finalize().into()
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Binding {
    pub(crate) token: [u8; 16],
    pub(crate) scope: [u8; 32],
    pub(crate) root: [u8; 32],
}
impl Binding {
    fn read(r: &mut Cursor<'_>) -> Result<Self> {
        Ok(Self {
            token: take(r)?,
            scope: take(r)?,
            root: take(r)?,
        })
    }
    fn put(self, out: &mut Vec<u8>) {
        out.extend(self.token);
        out.extend(self.scope);
        out.extend(self.root);
    }
}
pub(crate) enum Request {
    Begin {
        asking: Asking,
        known: Option<u64>,
    },
    Nodes {
        binding: Binding,
        prefixes: Vec<Prefix>,
    },
    Fetch {
        binding: Binding,
        ids: BTreeSet<EditId>,
    },
    End {
        binding: Binding,
    },
}
impl Request {
    pub(crate) fn encode(&self) -> Result<Vec<u8>> {
        let mut out = vec![VERSION];
        match self {
            Self::Begin { asking, known } => {
                validate_asking(asking)?;
                out.push(0);
                put(&mut out, &asking.to_wire());
                match known {
                    None => out.push(0),
                    Some(n) => {
                        out.push(1);
                        out.extend(n.to_be_bytes());
                    }
                }
            }
            Self::Nodes { binding, prefixes } => {
                ensure!(
                    !prefixes.is_empty() && prefixes.len() <= ranges::QUERY_NODES,
                    "node request count"
                );
                ensure!(
                    prefixes.windows(2).all(|p| p[0] < p[1]),
                    "unordered node prefixes"
                );
                out.push(1);
                binding.put(&mut out);
                out.extend((prefixes.len() as u32).to_be_bytes());
                for p in prefixes {
                    ensure!(
                        p.len() <= 64 && p.iter().all(|b| *b < 16),
                        "bad node prefix"
                    );
                    put_prefix(&mut out, p);
                }
            }
            Self::Fetch { binding, ids } => {
                ensure!(
                    !ids.is_empty() && ids.len() <= ranges::FETCH_IDS,
                    "fetch ID count"
                );
                out.push(2);
                binding.put(&mut out);
                out.extend((ids.len() as u32).to_be_bytes());
                for id in ids {
                    out.extend(id.0);
                }
            }
            Self::End { binding } => {
                out.push(3);
                binding.put(&mut out);
            }
        }
        ensure!(
            out.len() <= ranges::CONTROL_BYTES,
            "edit range request size"
        );
        Ok(out)
    }
    pub(crate) fn decode(data: &[u8]) -> Result<Self> {
        ensure!(
            data.len() <= ranges::CONTROL_BYTES,
            "edit range request size"
        );
        let mut r = Cursor(data);
        ensure!(take::<1>(&mut r)? == [VERSION], "edit range version");
        let out = match take::<1>(&mut r)?[0] {
            0 => {
                // At most 256 one-ID log keys and 256 follows; this bound precedes the generic decoder.
                let asking = Asking::from_wire(bytes(&mut r, 72 * LOGS + 64)?)?;
                validate_asking(&asking)?;
                let known = match take::<1>(&mut r)?[0] {
                    0 => None,
                    1 => Some(u64::from_be_bytes(take(&mut r)?)),
                    _ => return Err(anyhow!("known root flag")),
                };
                Self::Begin { asking, known }
            }
            1 => {
                let binding = Binding::read(&mut r)?;
                let n = count(&mut r, ranges::QUERY_NODES)?;
                ensure!(n > 0, "empty node request");
                let mut prefixes = Vec::with_capacity(n);
                for _ in 0..n {
                    prefixes.push(prefix(&mut r)?);
                }
                ensure!(
                    prefixes.windows(2).all(|p| p[0] < p[1]),
                    "unordered node prefixes"
                );
                Self::Nodes { binding, prefixes }
            }
            2 => {
                let binding = Binding::read(&mut r)?;
                let n = count(&mut r, ranges::FETCH_IDS)?;
                ensure!(n > 0 && r.0.len() == n * 32, "fetch IDs");
                let mut ids = BTreeSet::new();
                let mut last = None;
                for _ in 0..n {
                    let id = EditId(take(&mut r)?);
                    ensure!(last.is_none_or(|p| p < id), "unordered fetch IDs");
                    ids.insert(id);
                    last = Some(id);
                }
                Self::Fetch { binding, ids }
            }
            3 => Self::End {
                binding: Binding::read(&mut r)?,
            },
            _ => return Err(anyhow!("edit range command")),
        };
        done(&r)?;
        Ok(out)
    }
}

pub(crate) struct Offer {
    pub(crate) binding: Binding,
    pub(crate) tree: Summary,
    pub(crate) root: Arc<SignedRoot>,
    pub(crate) prefix: Vec<batch::Hash>,
}
impl Offer {
    pub(crate) fn encode(&self) -> Result<Vec<u8>> {
        let root = self.root.to_wire();
        ensure!(
            root.len() <= ROOT_BYTES && self.prefix.len() <= batch::MOST_STEPS + 1,
            "offer evidence size"
        );
        let mut out = vec![VERSION, 0];
        self.binding.put(&mut out);
        put_summary(&mut out, self.tree);
        put(&mut out, &root);
        out.extend((self.prefix.len() as u32).to_be_bytes());
        for hash in &self.prefix {
            out.extend(hash);
        }
        Ok(out)
    }
    pub(crate) fn decode(data: &[u8]) -> Result<Self> {
        ensure!(data.len() <= ranges::CONTROL_BYTES, "offer bytes");
        let mut r = Cursor(data);
        ensure!(take::<2>(&mut r)? == [VERSION, 0], "offer version");
        let binding = Binding::read(&mut r)?;
        let tree = summary(&mut r)?;
        ensure!(tree.count > 0, "empty offer reveals no signer root");
        let root = Arc::new(SignedRoot::from_wire(bytes(&mut r, ROOT_BYTES)?)?);
        ensure!(
            binding.root == *blake3::hash(&root.root.message()).as_bytes(),
            "offer root binding"
        );
        let n = count(&mut r, batch::MOST_STEPS + 1)?;
        ensure!(r.0.len() == n * 32, "offer prefix bytes");
        let mut prefix = Vec::with_capacity(n);
        for _ in 0..n {
            prefix.push(take(&mut r)?);
        }
        Ok(Self {
            binding,
            tree,
            root,
            prefix,
        })
    }
}
pub(crate) fn encode_nodes(binding: Binding, nodes: &[(Prefix, Block)]) -> Result<Vec<u8>> {
    ensure!(nodes.len() <= ranges::QUERY_NODES, "node response count");
    let mut out = vec![VERSION, 1];
    binding.put(&mut out);
    out.extend((nodes.len() as u32).to_be_bytes());
    for (prefix, block) in nodes {
        block.validate(prefix)?;
        put_prefix(&mut out, prefix);
        block.encode(&mut out);
    }
    ensure!(out.len() <= ranges::CONTROL_BYTES, "node response size");
    Ok(out)
}
pub(crate) fn decode_nodes(data: &[u8], expected: Binding) -> Result<Vec<(Prefix, Block)>> {
    ensure!(data.len() <= ranges::CONTROL_BYTES, "node response size");
    let mut r = Cursor(data);
    ensure!(take::<2>(&mut r)? == [VERSION, 1], "node response version");
    ensure!(Binding::read(&mut r)? == expected, "node response binding");
    let n = count(&mut r, ranges::QUERY_NODES)?;
    let mut out = Vec::with_capacity(n);
    for _ in 0..n {
        let p = prefix(&mut r)?;
        let b = Block::decode(&mut r.0, &p)?;
        b.validate(&p)?;
        out.push((p, b));
    }
    done(&r)?;
    Ok(out)
}

/// Allocation-free structural preflight of exactly the legacy payload class offered by Lab::range_inventory.
/// Every variable element is either bytes, an ID (32 bytes), or FileRoot (40 bytes); the decoder's vector capacity
/// and nested fixed object overhead are thus bounded by a small constant multiple of the bounded wire frame.
fn write_preflight(data: &[u8]) -> Result<()> {
    let mut r = Cursor(data);
    fn skip(r: &mut Cursor<'_>, n: usize) -> Result<()> {
        r.take(n).ok_or_else(|| anyhow!("short range write"))?;
        Ok(())
    }
    fn vector(r: &mut Cursor<'_>, width: usize) -> Result<()> {
        let n = count(r, FETCH_BYTES / width)?;
        skip(
            r,
            n.checked_mul(width)
                .ok_or_else(|| anyhow!("range write overflow"))?,
        )
    }
    fn optional(r: &mut Cursor<'_>, n: usize) -> Result<()> {
        match take::<1>(r)?[0] {
            0 => Ok(()),
            1 => skip(r, n),
            _ => Err(anyhow!("range write option")),
        }
    }
    ensure!(
        take::<1>(&mut r)? == [avendb::encode::VERSION],
        "range write version"
    );
    vector(&mut r, 32)?;
    skip(&mut r, 8 + 32)?;
    ensure!(
        count(&mut r, 0)? == 0 && take::<1>(&mut r)? == [4],
        "range write class"
    );
    skip(&mut r, 96)?;
    optional(&mut r, 32)?;
    skip(&mut r, 8)?;
    vector(&mut r, 32)?;
    match take::<1>(&mut r)?[0] {
        0 | 1 => {}
        2 => skip(&mut r, 32)?,
        _ => return Err(anyhow!("range write proposal")),
    }
    vector(&mut r, 32)?;
    match take::<1>(&mut r)?[0] {
        0 => {}
        1 => {
            vector(&mut r, 32)?;
            skip(&mut r, 32)?
        }
        _ => return Err(anyhow!("range write creation")),
    }
    vector(&mut r, 40)?;
    vector(&mut r, 1)?;
    ensure!(count(&mut r, 1)? == 1, "range write signer count");
    ensure!(
        matches!(take::<1>(&mut r)?[0], 0 | 3),
        "range write device key"
    );
    skip(&mut r, 64)?;
    ensure!(take::<2>(&mut r)? == [4, 1], "range write ceremony");
    vector(&mut r, 1)?;
    done(&r)
}
pub(crate) fn encode_fetch(
    binding: Binding,
    records: &[(Signed, Path)],
    more: bool,
) -> Result<Vec<u8>> {
    ensure!(
        !records.is_empty() && records.len() <= ranges::FETCH_IDS,
        "fetch record count"
    );
    let mut out = vec![VERSION, 2];
    binding.put(&mut out);
    out.push(more as u8);
    out.extend((records.len() as u32).to_be_bytes());
    for (signed, path) in records {
        let signed = signed.to_wire();
        write_preflight(&signed)?;
        let path = path.to_wire();
        ensure!(path.len() <= PATH_BYTES, "fetch path size");
        put(&mut out, &signed);
        put(&mut out, &path);
        ensure!(out.len() <= FETCH_BYTES, "fetch size");
    }
    Ok(out)
}
pub(crate) fn decode_fetch(
    data: &[u8],
    expected: Binding,
    root: &Arc<SignedRoot>,
    signer: SignerId,
    wanted: &BTreeSet<EditId>,
) -> Result<(Vec<Signed>, bool)> {
    ensure!(data.len() <= FETCH_BYTES, "fetch size");
    let mut r = Cursor(data);
    ensure!(
        take::<2>(&mut r)? == [VERSION, 2] && Binding::read(&mut r)? == expected,
        "fetch binding"
    );
    let more = match take::<1>(&mut r)?[0] {
        0 => false,
        1 => true,
        _ => return Err(anyhow!("fetch continuation")),
    };
    let n = count(&mut r, ranges::FETCH_IDS)?;
    ensure!(n > 0 && n <= wanted.len(), "fetch record count");
    let mut out = Vec::with_capacity(n);
    let mut seen = BTreeSet::new();
    let mut last = None;
    for _ in 0..n {
        let wire = bytes(&mut r, PAYLOAD_BYTES)?;
        write_preflight(wire)?;
        let signed = Signed::from_wire(wire)?;
        let path = Path::from_wire(bytes(&mut r, PATH_BYTES)?)?;
        let id = signed.edit.id();
        let place = (signed.edit.depth, id);
        ensure!(
            last.is_none_or(|p| p < place) && wanted.contains(&id) && seen.insert(id),
            "unsolicited or unordered fetched edit"
        );
        ensure!(
            signed.edit.author == signer
                && root.root.log == signer
                && path.length == root.root.length
                && path.climb(id) == Some(root.root.hash),
            "invalid required edit range proof"
        );
        last = Some(place);
        out.push(signed);
    }
    ensure!(
        more == (seen.len() < wanted.len()),
        "incorrect fetch continuation"
    );
    done(&r)?;
    Ok((out, more))
}

#[cfg(test)]
mod tests {
    use super::*;
    use avendb::batch::SignerLog;
    use avendb::id::{EntryId, ShareId, VaultId};
    use avendb::policy::{Action, Creation, Edit, Proposal};
    use avendb::sealed::FileRoot;
    use avendb::sign::{DeviceKey, Suite};
    fn key() -> DeviceKey {
        DeviceKey::from_secret([190; 32])
    }
    fn record(key: &DeviceKey, n: u64) -> Signed {
        let vault = VaultId::from_u64(1);
        let nonce = [19; 32];
        let action = Action::Write {
            vault,
            entry: EntryId::of(vault, key.id(), &nonce),
            actor: vault,
            stay: (n > 0).then_some(EditId::from_u64(2)),
            epoch: u64::MAX,
            deps: (0..n).map(EditId::from_u64).collect(),
            proposal: match n {
                0 => Proposal::Main,
                1 => Proposal::New,
                _ => Proposal::On(EditId::from_u64(2)),
            },
            via: (0..n).map(VaultId::from_u64).collect(),
            create: Some(Creation {
                audience: (0..n).map(ShareId::from_u64).collect(),
                nonce,
            }),
            files: (0..n)
                .map(|i| FileRoot {
                    hash: EditId::from_u64(i).0,
                    size: u64::MAX,
                })
                .collect(),
            body: vec![127; n as usize * 4],
        };
        let edit = Edit {
            parents: (0..n).map(EditId::from_u64).collect(),
            depth: n,
            author: key.id(),
            cosigners: vec![],
            action,
        };
        Signed {
            sigs: vec![key.sign(edit.id())],
            edit,
        }
    }
    fn binding() -> Binding {
        Binding {
            token: [1; 16],
            scope: [2; 32],
            root: [3; 32],
        }
    }
    #[test]
    fn canonical_requests_reject_truncation_trailing_duplicates_and_nonentry_scope() {
        let mut asking = Asking::default();
        asking
            .ask
            .haves
            .insert(LogId::Entry(EntryId([4; 32])), vec![]);
        let requests = [
            Request::Begin {
                asking: asking.clone(),
                known: Some(5),
            },
            Request::Nodes {
                binding: binding(),
                prefixes: vec![vec![], vec![1, 2]],
            },
            Request::Fetch {
                binding: binding(),
                ids: [EditId([6; 32]), EditId([7; 32])].into(),
            },
            Request::End { binding: binding() },
        ];
        for request in requests {
            let bytes = request.encode().unwrap();
            assert_eq!(Request::decode(&bytes).unwrap().encode().unwrap(), bytes);
            for n in 0..bytes.len() {
                assert!(Request::decode(&bytes[..n]).is_err());
            }
            let mut extra = bytes;
            extra.push(0);
            assert!(Request::decode(&extra).is_err());
        }
        asking
            .ask
            .haves
            .insert(LogId::Vault(VaultId([8; 32])), vec![]);
        assert!(validate_asking(&asking).is_err());
        assert!(
            Request::Nodes {
                binding: binding(),
                prefixes: vec![vec![2], vec![1]]
            }
            .encode()
            .is_err()
        );
        assert!(
            Request::Nodes {
                binding: binding(),
                prefixes: vec![vec![1], vec![1]]
            }
            .encode()
            .is_err()
        );
        let mut bytes = Request::Fetch {
            binding: binding(),
            ids: [EditId([6; 32]), EditId([7; 32])].into(),
        }
        .encode()
        .unwrap();
        let end = bytes.len();
        let copied = bytes[end - 64..end - 32].to_vec();
        bytes[end - 32..].copy_from_slice(&copied);
        assert!(Request::decode(&bytes).is_err());
    }
    #[test]
    fn borrowed_preflight_matches_valid_write_variants_and_refuses_allocating_other_actions() {
        for suite in [Suite::MlDsa, Suite::SlhDsa] {
            let key = DeviceKey::from_secret_in([190; 32], suite);
            for n in [0, 1, 129] {
                let signed = record(&key, n);
                let bytes = signed.to_wire();
                write_preflight(&bytes).unwrap();
                assert_eq!(Signed::from_wire(&bytes).unwrap(), signed);
                for cut in 0..bytes.len() {
                    assert!(write_preflight(&bytes[..cut]).is_err());
                }
                let mut extra = bytes.clone();
                extra.push(0);
                assert!(write_preflight(&extra).is_err());
                let mut malicious = bytes;
                malicious[1..5].copy_from_slice(&u32::MAX.to_be_bytes());
                assert!(write_preflight(&malicious).is_err());
            }
        }
    }
    #[test]
    fn required_paths_reject_forged_evidence_scope_reuse_and_oversized_frames() {
        let key = key();
        let signed = record(&key, 1);
        let id = signed.edit.id();
        let other = record(&key, 2);
        let mut log = SignerLog::wrap(key.id(), [id, other.edit.id()]);
        let root = log.commit(&key).unwrap();
        let path = log.proof(id).unwrap().path;
        let records = vec![(signed.clone(), path.clone())];
        let binding = binding();
        let wanted = [id].into();
        let bytes = encode_fetch(binding, &records, false).unwrap();
        let (edits, more) = decode_fetch(&bytes, binding, &root, key.id(), &wanted).unwrap();
        assert!(!more);
        assert_eq!(edits, vec![signed.clone()]);
        let mut foreign = binding;
        foreign.scope[0] ^= 1;
        assert!(decode_fetch(&bytes, foreign, &root, key.id(), &wanted).is_err());
        foreign = binding;
        foreign.token[0] ^= 1;
        assert!(decode_fetch(&bytes, foreign, &root, key.id(), &wanted).is_err());
        assert!(decode_fetch(&bytes, binding, &root, SignerId([4; 32]), &wanted).is_err());
        let mut wrong = path.clone();
        wrong.hashes[0][0] ^= 1;
        let corrupt = encode_fetch(binding, &[(signed.clone(), wrong)], false).unwrap();
        assert!(decode_fetch(&corrupt, binding, &root, key.id(), &wanted).is_err());
        let mut malformed = bytes.clone();
        let end = malformed.len();
        malformed[end - 32 - 4..end - 32].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(decode_fetch(&malformed, binding, &root, key.id(), &wanted).is_err());
        assert!(
            decode_fetch(&vec![0; FETCH_BYTES + 1], binding, &root, key.id(), &wanted).is_err()
        );
        assert!(
            decode_fetch(&bytes[..bytes.len() - 1], binding, &root, key.id(), &wanted).is_err()
        );
        let mut unsigned_root = (*root).clone();
        unsigned_root.sig[0] ^= 1;
        assert!(
            !unsigned_root.verify(),
            "root admission must reject forged root before decode_fetch is called"
        );
        let mut binding = binding;
        binding.root = *blake3::hash(&root.root.message()).as_bytes();
        let offer = Offer {
            binding,
            tree: Summary {
                count: 1,
                hash: [9; 32],
            },
            root: root.clone(),
            prefix: vec![],
        };
        let offered = offer.encode().unwrap();
        assert_eq!(Offer::decode(&offered).unwrap().root.root, root.root);
        assert!(Offer::decode(&vec![0; ranges::CONTROL_BYTES + 1]).is_err());
    }
}
