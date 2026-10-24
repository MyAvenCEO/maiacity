//! Version-two owner-authenticated CRDT base envelopes, representation stage only.
//! These are NOT installed into History, policy, projections or writable Items. A signed
//! envelope authenticates an owner's claim; it does not prove counted-history equivalence.
use super::*;
use crate::encode::Encode;
use crate::wire::Reader as WireReader;
use loro::{EncodedBlobMode, LoroDoc};

const FORMAT: &[u8] = b"avenDB entry base 2\n";
const MAX_BYTES: usize = 1 << 20;
const MAX_LINES: usize = 16;
const MAX_BASIS: usize = 64;
const MAX_PEERS: usize = 1024;
const MAX_CHANGES: u32 = 16_384;
const MAX_OPERATIONS: u64 = 1_000_000;

pub struct PreparedEntryBase {
    pub draft: Unsigned,
    pub sealed: Vec<u8>,
    pub root: FileRoot,
}

#[derive(Clone)]
struct BaseLine {
    basis: Vec<EditId>,
    version: Vec<u8>,
    snapshot: Vec<u8>,
}

/// Private fields prevent callers from fabricating an authenticated envelope. There is
/// deliberately no Item constructor, cache installation, or write permission associated
/// with this type. Counted-history/base-suffix validation is a subsequent stage.
pub struct AuthenticatedEntryBaseEnvelope {
    entry: EntryId,
    snapshot: EditId,
    lines: BTreeMap<Line, BaseLine>,
}
impl AuthenticatedEntryBaseEnvelope {
    pub fn entry(&self) -> EntryId { self.entry }
    pub fn snapshot(&self) -> EditId { self.snapshot }
    pub fn line_count(&self) -> usize { self.lines.len() }
    pub fn is_writable(&self) -> bool { false }
}

fn context(vault: VaultId, entry: EntryId) -> Vec<u8> {
    let mut out = FORMAT.to_vec();
    vault.encode(&mut out);
    entry.encode(&mut out);
    out
}
fn bounded_basis(ids: &[EditId]) -> bool {
    !ids.is_empty() && ids.len() <= MAX_BASIS && ids.windows(2).all(|pair| pair[0] < pair[1])
}

// Metadata inspection does not install an Item, but Loro internally decodes an oplog
// before these count checks. MAX_BYTES bounds wire size, not decoder CPU/allocations.
// This dormant representation must not enter live receive until preflight/isolation
// bounds that work. Full snapshots preserve pre-cut proposal ancestry.
fn snapshot_version(bytes: &[u8]) -> Option<Vec<u8>> {
    if bytes.len() > MAX_BYTES { return None; }
    let meta = LoroDoc::decode_import_blob_meta(bytes, true).ok()?;
    if meta.mode != EncodedBlobMode::Snapshot || meta.change_num > MAX_CHANGES
        || meta.partial_start_vv.iter().any(|(_, count)| *count != 0) { return None; }
    let mut peers: Vec<_> = meta.partial_end_vv.iter().map(|(&peer, &count)| (peer, count)).collect();
    if peers.len() > MAX_PEERS || peers.iter().any(|(_, count)| *count <= 0)
        || peers.iter().map(|(_, count)| *count as u64).sum::<u64>() > MAX_OPERATIONS { return None; }
    peers.sort_unstable();
    let mut version = Vec::with_capacity(peers.len() * 12);
    for (peer, count) in peers { version.extend(peer.to_be_bytes()); version.extend(count.to_be_bytes()); }
    Some(version)
}
fn encode(vault: VaultId, entry: EntryId, basis: &[EditId], lines: &BTreeMap<Line, BaseLine>) -> Vec<u8> {
    let mut out = context(vault, entry);
    ENGINE.as_bytes().to_vec().encode(&mut out);
    basis.to_vec().encode(&mut out);
    (lines.len() as u32).encode(&mut out);
    for (line, base) in lines {
        line.encode(&mut out);
        base.basis.encode(&mut out);
        base.version.encode(&mut out);
        base.snapshot.encode(&mut out);
    }
    out
}
fn decode(bytes: &[u8], vault: VaultId, entry: EntryId, basis: &[EditId]) -> Option<BTreeMap<Line, BaseLine>> {
    if bytes.len() > MAX_BYTES || !bounded_basis(basis) { return None; }
    let mut r = WireReader::new(bytes);
    let prefix = context(vault, entry);
    if r.take(prefix.len()).ok()? != prefix || r.bytes().ok()? != ENGINE.as_bytes() { return None; }
    if r.seq::<EditId>(32).ok()? != basis { return None; }
    let count = r.count(13).ok()?;
    if count == 0 || count > MAX_LINES { return None; }
    let mut lines = BTreeMap::new();
    let mut union = BTreeSet::new();
    for _ in 0..count {
        let line = r.option::<EditId>().ok()?;
        let heads = r.seq::<EditId>(32).ok()?;
        if !bounded_basis(&heads) { return None; }
        union.extend(heads.iter().copied());
        let version = r.bytes().ok()?;
        if version.len() > MAX_PEERS * 12 || version.len() % 12 != 0 { return None; }
        let snapshot = r.bytes().ok()?;
        if snapshot_version(&snapshot)? != version { return None; }
        if lines.insert(line, BaseLine { basis: heads, version, snapshot }).is_some() { return None; }
    }
    if !r.done() || !lines.contains_key(&MAIN) || union.into_iter().collect::<Vec<_>>() != basis { return None; }
    Some(lines)
}

impl Lab {
    /// Prepare an explicit owner approval over a versioned base. This is not exposed as
    /// a Node operation until base/suffix validation and capability negotiation exist.
    pub fn draft_entry_base(&mut self, on: SignerId, signers: &[SignerId], entry: EntryId) -> Result<PreparedEntryBase, Refusal> {
        let store = self.held(on);
        if store.replayed != store.log.edits().len() { return Err(Refusal::NotAccepted); }
        let st = &store.replay.state;
        let en = st.entry(entry).ok_or(Refusal::UnknownEntry)?;
        let shown = store.shown.get(&entry).ok_or(Refusal::NotAccepted)?;
        if !shown.history.landed() || !shown.items().contains_key(&MAIN) || shown.items().len() > MAX_LINES {
            return Err(Refusal::NotAccepted);
        }
        let vault = en.vault;
        let key = st.entry_key(entry).and_then(|name| store.keys.first(name)).ok_or(Refusal::NoCap)?.clone();
        let mut lines = BTreeMap::new();
        let mut union = BTreeSet::new();
        let mut bytes_used = 0usize;
        for (&line, item) in shown.items() {
            let mut basis = shown.history.heads(line);
            basis.sort(); basis.dedup();
            if !bounded_basis(&basis) { return Err(Refusal::NotAccepted); }
            union.extend(basis.iter().copied());
            let snapshot = item.bytes();
            bytes_used = bytes_used.checked_add(snapshot.len()).ok_or(Refusal::NotAccepted)?;
            if bytes_used > MAX_BYTES { return Err(Refusal::NotAccepted); }
            let version = snapshot_version(&snapshot).ok_or(Refusal::NotAccepted)?;
            if version != item.version().0 { return Err(Refusal::NotAccepted); }
            lines.insert(line, BaseLine { basis, version, snapshot });
        }
        let basis: Vec<_> = union.into_iter().collect();
        if !bounded_basis(&basis) { return Err(Refusal::NotAccepted); }
        let bytes = encode(vault, entry, &basis, &lines);
        if bytes.len() > MAX_BYTES { return Err(Refusal::NotAccepted); }
        let sealed = keys::seal_edit(&key, &bytes, &context(vault, entry), &mut self.rng);
        let root = FileRoot { hash: crate::hash::content(&sealed), size: sealed.len() as u64 };
        let draft = self.draft(on, signers, Action::Snapshot { vault,
            states: vec![crate::policy::Stated { entry, basis, slice: root }] })?;
        Ok(PreparedEntryBase { draft, sealed, root })
    }

    /// Authenticity/format only. No installation or writable state is returned. Current
    /// policy, owner approval, key epoch and signed content root are ordinary gates.
    pub fn authenticate_entry_base(&self, on: SignerId, snapshot: EditId, entry: EntryId, sealed: &[u8]) -> Option<AuthenticatedEntryBaseEnvelope> {
        if sealed.len() > MAX_BYTES + 128 { return None; }
        let (vault, stated, name) = self.projection_authority(on, snapshot, entry)?;
        if stated.slice.size != sealed.len() as u64 || stated.slice.hash != crate::hash::content(sealed) { return None; }
        let key = self.held(on).keys.first(name)?;
        let bytes = keys::open_edit(key, sealed, &context(vault, entry))?;
        let lines = decode(&bytes, vault, entry, &stated.basis)?;
        Some(AuthenticatedEntryBaseEnvelope { entry, snapshot, lines })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast::{document, human_on};

    #[test]
    fn entry_base_authenticates_without_installing_writable_state() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        lab.sync(mac, phone);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Base", "old", mac)).unwrap();
        lab.sync(mac, phone);
        let before = lab.item(phone, entry).unwrap().record();
        lab.edit(mac, vault, entry, |item| item.set_text(2, "new")).unwrap();
        assert!(lab.draft_entry_base(mac, &[mac], entry).is_err(), "owner ceremony required");
        let PreparedEntryBase { draft, sealed, root } = lab.draft_entry_base(mac, &[owner], entry).unwrap();
        let snapshot = lab.complete(mac, draft, &[]).unwrap();
        let offered = lab.entry_projection_offer(mac, phone, entry).unwrap();
        lab.receive(phone, offered.evidence, vec![]);
        let ids = lab.log(phone).ids().to_vec();
        let base = lab.authenticate_entry_base(phone, snapshot, entry, &sealed).unwrap();
        assert_eq!(base.entry(), entry);
        assert_eq!(base.snapshot(), snapshot);
        assert_eq!(base.line_count(), 1);
        assert!(!base.is_writable());
        assert_eq!(lab.log(phone).ids(), ids);
        assert_eq!(lab.item(phone, entry).unwrap().record(), before);
        assert_eq!(root.hash, crate::hash::content(&sealed));
        assert!(lab.open_entry_projection(phone, snapshot, entry, &sealed).is_none(), "v2 is not a JSON projection");
        let mut corrupt = sealed.clone(); corrupt[0] ^= 1;
        assert!(lab.authenticate_entry_base(phone, snapshot, entry, &corrupt).is_none());
        assert!(lab.authenticate_entry_base(phone, snapshot, EntryId([99;32]), &sealed).is_none());
        let outsider = lab.device("Outsider");
        assert!(lab.authenticate_entry_base(outsider, snapshot, entry, &sealed).is_none());
        lab.submit(mac, &[owner], Action::Revoke(crate::policy::Revoking::Device { vault, device: phone, keep: vec![] })).unwrap();
        lab.sync(mac, phone);
        assert!(lab.authenticate_entry_base(phone, snapshot, entry, &sealed).is_none());
    }

    #[test]
    fn entry_base_format_rejects_updates_mismatched_vectors_and_context() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let me = lab.device_of(owner, "Device");
        let vault = human_on(&mut lab, owner, &[me]);
        let entry = lab.create(me, vault, vault, "note", &[], document("Base", "state", me)).unwrap();
        let item = lab.item(me, entry).unwrap();
        let updates = item.export(&Default::default());
        assert!(snapshot_version(&updates).is_none());
        let raw = LoroDoc::new();
        raw.get_map("item").insert("title", "shallow").unwrap();
        raw.commit();
        let shallow = raw.export(loro::ExportMode::shallow_snapshot(&raw.oplog_frontiers())).unwrap();
        assert!(snapshot_version(&shallow).is_none());
        let snapshot = item.bytes();
        let version = snapshot_version(&snapshot).unwrap();
        let basis = vec![EditId([7;32])];
        let mut lines = BTreeMap::from([(MAIN, BaseLine { basis: basis.clone(), version, snapshot })]);
        let bytes = encode(vault, entry, &basis, &lines);
        assert!(decode(&bytes, vault, entry, &basis).is_some());
        let mut unsupported = bytes.clone(); unsupported[FORMAT.len()-2] = b'3';
        assert!(decode(&unsupported, vault, entry, &basis).is_none());
        assert!(decode(&bytes, vault, EntryId([9;32]), &basis).is_none());
        assert!(decode(&bytes, vault, entry, &[EditId([8;32])]).is_none());
        assert!(decode(&bytes[..bytes.len()-1], vault, entry, &basis).is_none());
        let mut trailing = bytes.clone(); trailing.push(0);
        assert!(decode(&trailing, vault, entry, &basis).is_none());
        lines.get_mut(&MAIN).unwrap().version = vec![0;12];
        assert!(decode(&encode(vault, entry, &basis, &lines), vault, entry, &basis).is_none());
        assert!(!bounded_basis(&[basis[0], basis[0]]));
        assert!(decode(&vec![0; MAX_BYTES + 1], vault, entry, &basis).is_none());
    }
}
