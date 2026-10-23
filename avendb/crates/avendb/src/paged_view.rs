//! Authenticated local policy projections in independently loadable pages.
//!
//! This is a foundation for paged stored views, not a partial `State` or a new
//! startup path. VIEW2 remains authoritative. The producer still has a complete
//! replay; the caller must provide complete kernel/schema/opened-key dependencies.
//! `Ready` proves only the requested policy projection at the exact bound context,
//! never query coverage, document-body availability, or safe tail continuation.
use std::collections::{BTreeMap, BTreeSet};

use crate::encode::Encode;
use crate::hash;
use crate::id::{EditId, EntryId, SignerId, VaultId};
use crate::policy::{Slice, State};
use crate::wire::{Decode, Reader, WireError};

const HEADER: &[u8] = b"avenDB paged view 1\n";
const ENTRY: &[u8] = b"avenDB entry projection 1\n";
pub const MAX_PAGES: usize = 65_536;
pub const MAX_PAGE_BYTES: usize = 16 << 20;
pub const MAX_HEADER_BYTES: usize = 16 << 20;
pub const MAX_DRAFT_BYTES: usize = 256 << 20;
const MAX_EDGES: usize = 262_144;
const MAX_DEPENDENCIES: usize = 1024;

/// Exact core source fingerprint, domain-stable as a fixed-size binding.
pub fn engine() -> [u8; 32] {
    hash::content(env!("AVENDB_ENGINE").as_bytes())
}

/// Every invalidation input is exact: no old-engine allowlist or weaker epoch comparison.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Binding {
    pub device: SignerId,
    pub vault: VaultId,
    pub engine: [u8; 32],
    pub frontier: [u8; 32],
    pub kernel: [u8; 32],
    pub schema: [u8; 32],
    pub opened_epoch: [u8; 32],
    pub generation: u64,
}
impl Binding {
    /// The log commitment includes every ID in held order, not merely a count.
    pub fn new(device: SignerId, vault: VaultId, ids: &[EditId], globals: &Globals, generation: u64) -> Self {
        let mut h = hash::Hasher::new("paged view held IDs 1");
        h.update(&(ids.len() as u64).to_be_bytes());
        for id in ids {
            h.update(&id.0);
        }
        Self {
            device,
            vault,
            engine: engine(),
            frontier: h.finalize(),
            kernel: hash::content(&globals.kernel),
            schema: hash::content(&globals.schema),
            opened_epoch: hash::content(&globals.key_epoch),
            generation,
        }
    }
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = vec![];
        self.device.encode(&mut out);
        self.vault.encode(&mut out);
        for x in [self.engine, self.frontier, self.kernel, self.schema, self.opened_epoch] {
            out.extend_from_slice(&x);
        }
        self.generation.encode(&mut out);
        out
    }
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(Self {
            device: SignerId::decode(r)?,
            vault: VaultId::decode(r)?,
            engine: r.array()?,
            frontier: r.array()?,
            kernel: r.array()?,
            schema: r.array()?,
            opened_epoch: r.array()?,
            generation: u64::decode(r)?,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum PageId {
    Kernel,
    Schema,
    KeyEpoch,
    Entry(EntryId),
}
impl PageId {
    fn encoded_len(self) -> usize {
        if matches!(self, Self::Entry(_)) { 33 } else { 1 }
    }
    fn encode(self, out: &mut Vec<u8>) {
        match self {
            Self::Kernel => out.push(0),
            Self::Schema => out.push(1),
            Self::KeyEpoch => out.push(2),
            Self::Entry(e) => {
                out.push(3);
                e.encode(out);
            }
        }
    }
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        match r.u8()? {
            0 => Ok(Self::Kernel),
            1 => Ok(Self::Schema),
            2 => Ok(Self::KeyEpoch),
            3 => Ok(Self::Entry(EntryId::decode(r)?)),
            _ => Err(WireError::Unknown),
        }
    }
}
const GLOBALS: [PageId; 3] = [PageId::Kernel, PageId::Schema, PageId::KeyEpoch];

/// Exact serialized global dependency inputs, supplied by the complete producer.
/// These bytes are opaque here: wiring their real Lab codecs is an activation gate.
/// `key_epoch` describes which openings are current, never the raw secret keys.
pub struct Globals {
    pub kernel: Vec<u8>,
    pub schema: Vec<u8>,
    pub key_epoch: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct Page {
    pub bytes: Vec<u8>,
    pub dependencies: BTreeSet<PageId>,
}
pub struct Draft {
    pub binding: Binding,
    pub pages: BTreeMap<PageId, Page>,
}
impl Draft {
    /// Capture actual policy slices of the selected existing entries, without
    /// synthesizing empty records for unknown IDs. Cross-entry dependencies must
    /// be supplied by the producer; all three globals are mandatory automatically.
    pub fn capture(
        binding: Binding,
        state: &State,
        globals: Globals,
        entries: &BTreeSet<EntryId>,
        dependencies: &BTreeMap<PageId, BTreeSet<PageId>>,
    ) -> Result<Self, WireError> {
        if entries.len() + 3 > MAX_PAGES
            || binding.kernel != hash::content(&globals.kernel)
            || binding.schema != hash::content(&globals.schema)
            || binding.opened_epoch != hash::content(&globals.key_epoch)
        {
            return Err(WireError::Unknown);
        }
        // Reject caller-constructed dependency graphs before cloning any sets.
        // Header validation repeats the aggregate limit after mandatory globals
        // have been inserted, so the public Draft cannot bypass publication bounds.
        let mut edges = 0usize;
        if dependencies.len() > MAX_PAGES {
            return Err(WireError::Unknown);
        }
        for deps in dependencies.values() {
            edges = edges.checked_add(deps.len()).ok_or(WireError::Unknown)?;
            if deps.len() > MAX_DEPENDENCIES || edges > MAX_EDGES {
                return Err(WireError::Unknown);
            }
        }
        let mut pages = BTreeMap::new();
        let mut encoded_bytes = 0usize;
        for (id, bytes) in
            [(PageId::Kernel, globals.kernel), (PageId::Schema, globals.schema), (PageId::KeyEpoch, globals.key_epoch)]
        {
            encoded_bytes = encoded_bytes.checked_add(bytes.len()).ok_or(WireError::Unknown)?;
            if bytes.len() > MAX_PAGE_BYTES || encoded_bytes > MAX_DRAFT_BYTES {
                return Err(WireError::Unknown);
            }
            pages.insert(id, Page { bytes, dependencies: dependencies.get(&id).cloned().unwrap_or_default() });
        }
        for &entry in entries {
            if state.entry(entry).is_none_or(|e| e.vault != binding.vault) {
                return Err(WireError::Unknown);
            }
            let mut deps = dependencies.get(&PageId::Entry(entry)).cloned().unwrap_or_default();
            deps.extend(GLOBALS);
            let bytes = encode_slice(entry, &state.slice_of(entry));
            encoded_bytes = encoded_bytes.checked_add(bytes.len()).ok_or(WireError::Unknown)?;
            if bytes.len() > MAX_PAGE_BYTES || encoded_bytes > MAX_DRAFT_BYTES {
                return Err(WireError::Unknown);
            }
            pages.insert(PageId::Entry(entry), Page { bytes, dependencies: deps });
        }
        if dependencies.keys().any(|id| !pages.contains_key(id))
            || pages.values().any(|p| {
                p.bytes.len() > MAX_PAGE_BYTES
                    || p.dependencies.len() > MAX_DEPENDENCIES
                    || p.dependencies.iter().any(|id| !pages.contains_key(id))
            })
        {
            return Err(WireError::Unknown);
        }
        Ok(Self { binding, pages })
    }
}

/// The object hash names encrypted bytes on the shelf; the content hash is kept
/// inside the encrypted header. Authentication binds both and the dependency graph.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Descriptor {
    pub object: [u8; 32],
    pub content: [u8; 32],
    pub bytes: u32,
    pub dependencies: BTreeSet<PageId>,
}
impl Descriptor {
    pub fn aad(&self, binding: &Binding, id: PageId) -> Vec<u8> {
        let mut out = b"avenDB paged view page 1\n".to_vec();
        out.extend(binding.to_bytes());
        id.encode(&mut out);
        out.extend(self.content);
        self.bytes.encode(&mut out);
        (self.dependencies.len() as u32).encode(&mut out);
        for &d in &self.dependencies {
            d.encode(&mut out);
        }
        out
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Header {
    pub binding: Binding,
    pub pages: BTreeMap<PageId, Descriptor>,
}
impl Header {
    pub fn validate(&self) -> Result<(), WireError> {
        if self.pages.len() > MAX_PAGES || GLOBALS.iter().any(|id| !self.pages.contains_key(id)) {
            return Err(WireError::Unknown);
        }
        let mut edges = 0usize;
        let mut encoded_bytes = HEADER.len() + self.binding.to_bytes().len() + 4 + 32;
        for (id, p) in &self.pages {
            if p.dependencies.len() > MAX_DEPENDENCIES {
                return Err(WireError::Unknown);
            }
            edges = edges.checked_add(p.dependencies.len()).ok_or(WireError::Unknown)?;
            encoded_bytes = encoded_bytes.checked_add(id.encoded_len() + 72).ok_or(WireError::Unknown)?;
            for dep in &p.dependencies {
                encoded_bytes = encoded_bytes.checked_add(dep.encoded_len()).ok_or(WireError::Unknown)?;
            }
            if edges > MAX_EDGES || encoded_bytes > MAX_HEADER_BYTES {
                return Err(WireError::Unknown);
            }
            if p.bytes as usize > MAX_PAGE_BYTES
                || p.dependencies.len() > MAX_DEPENDENCIES
                || p.dependencies.iter().any(|d| !self.pages.contains_key(d))
                || matches!(id, PageId::Entry(_)) && GLOBALS.iter().any(|d| !p.dependencies.contains(d))
            {
                return Err(WireError::Unknown);
            }
        }
        for (id, hash) in [
            (PageId::Kernel, self.binding.kernel),
            (PageId::Schema, self.binding.schema),
            (PageId::KeyEpoch, self.binding.opened_epoch),
        ] {
            if self.pages[&id].content != hash {
                return Err(WireError::Unknown);
            }
        }
        Ok(())
    }
    pub fn to_bytes(&self) -> Result<Vec<u8>, WireError> {
        self.validate()?;
        let mut out = HEADER.to_vec();
        out.extend(self.binding.to_bytes());
        let start = out.len();
        (self.pages.len() as u32).encode(&mut out);
        for (&id, d) in &self.pages {
            id.encode(&mut out);
            out.extend(d.object);
            out.extend(d.content);
            d.bytes.encode(&mut out);
            (d.dependencies.len() as u32).encode(&mut out);
            for &dep in &d.dependencies {
                dep.encode(&mut out);
            }
            if out.len() > MAX_HEADER_BYTES - 32 {
                return Err(WireError::Unknown);
            }
        }
        let directory_root = hash::content(&out[start..]);
        out.extend(directory_root);
        Ok(out)
    }
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, WireError> {
        if bytes.len() > MAX_HEADER_BYTES {
            return Err(WireError::Unknown);
        }
        let mut r = Reader::new(bytes);
        if r.take(HEADER.len())? != HEADER {
            return Err(WireError::Unknown);
        }
        let binding = Binding::decode(&mut r)?;
        let directory_at = HEADER.len() + binding.to_bytes().len();
        let n = r.count(73)?;
        if n > MAX_PAGES {
            return Err(WireError::Unknown);
        }
        let mut pages = BTreeMap::new();
        let mut edges = 0usize;
        let mut previous = None;
        for _ in 0..n {
            let id = PageId::decode(&mut r)?;
            if previous.is_some_and(|p| p >= id) {
                return Err(WireError::Unordered);
            }
            previous = Some(id);
            let object = r.array()?;
            let content = r.array()?;
            let bytes = u32::decode(&mut r)?;
            let n = r.count(1)?;
            edges = edges.checked_add(n).ok_or(WireError::Unknown)?;
            if n > MAX_DEPENDENCIES || edges > MAX_EDGES {
                return Err(WireError::Unknown);
            }
            let mut dependencies = BTreeSet::new();
            let mut prev = None;
            for _ in 0..n {
                let d = PageId::decode(&mut r)?;
                if prev.is_some_and(|p| p >= d) {
                    return Err(WireError::Unordered);
                }
                dependencies.insert(d);
                prev = Some(d);
            }
            pages.insert(id, Descriptor { object, content, bytes, dependencies });
        }
        let root: [u8; 32] = r.array()?;
        if !r.done() {
            return Err(WireError::Trailing);
        }
        if hash::content(&bytes[directory_at..bytes.len() - 32]) != root {
            return Err(WireError::Unknown);
        }
        let header = Self { binding, pages };
        header.validate()?;
        Ok(header)
    }
    /// Iterative transitive closure, cycle safe and bounded by the validated directory.
    /// Unknown requested IDs remain missing, never known-empty.
    pub fn closure(&self, requested: &BTreeSet<EntryId>) -> Result<BTreeSet<PageId>, WireError> {
        self.validate()?;
        if requested.len() > MAX_PAGES {
            return Err(WireError::Unknown);
        }
        let mut needed: BTreeSet<_> = requested.iter().copied().map(PageId::Entry).chain(GLOBALS).collect();
        let mut todo: Vec<_> = needed.iter().copied().collect();
        while let Some(id) = todo.pop() {
            if let Some(p) = self.pages.get(&id) {
                for &dependency in &p.dependencies {
                    // Mark when queued: shared/cyclic edges cannot duplicate pending work.
                    if needed.insert(dependency) {
                        todo.push(dependency);
                    }
                }
            }
        }
        Ok(needed)
    }
    /// Authenticated plaintext supplied by storage. Validate the complete needed
    /// closure before any requested slice escapes; irrelevant loaded pages are ignored.
    pub fn read(
        &self,
        current: &Binding,
        requested: &BTreeSet<EntryId>,
        loaded: &BTreeMap<PageId, Vec<u8>>,
    ) -> Result<PageRead, WireError> {
        if &self.binding != current {
            return Ok(PageRead::Stale);
        }
        let needed = self.closure(requested)?;
        let missing: BTreeSet<_> =
            needed.iter().filter(|id| !self.pages.contains_key(id) || !loaded.contains_key(id)).copied().collect();
        if !missing.is_empty() {
            return Ok(PageRead::Missing(missing));
        }
        for id in needed {
            let d = &self.pages[&id];
            let bytes = &loaded[&id];
            if bytes.len() != d.bytes as usize || hash::content(bytes) != d.content {
                return Err(WireError::Unknown);
            }
        }
        let mut entries = BTreeMap::new();
        for &entry in requested {
            let slice = decode_slice(&loaded[&PageId::Entry(entry)], entry, self.binding.vault)?;
            entries.insert(entry, slice);
        }
        Ok(PageRead::Ready { binding: self.binding.clone(), entries })
    }
}
#[derive(Debug, PartialEq, Eq)]
pub enum PageRead {
    Ready { binding: Binding, entries: BTreeMap<EntryId, Slice> },
    Missing(BTreeSet<PageId>),
    Stale,
}

fn encode_slice(entry: EntryId, sl: &Slice) -> Vec<u8> {
    let mut out = ENTRY.to_vec();
    entry.encode(&mut out);
    sl.entries.encode(&mut out);
    sl.writes.encode(&mut out);
    (sl.audiences.len() as u32).encode(&mut out);
    for (id, shares) in &sl.audiences {
        id.encode(&mut out);
        shares.as_ref().encode(&mut out);
    }
    (sl.marks.len() as u32).encode(&mut out);
    for (id, shares) in &sl.marks {
        id.encode(&mut out);
        shares.as_ref().encode(&mut out);
    }
    sl.seals.encode(&mut out);
    sl.born.encode(&mut out);
    out
}
fn decode_slice(bytes: &[u8], entry: EntryId, vault: VaultId) -> Result<Slice, WireError> {
    if bytes.len() > MAX_PAGE_BYTES {
        return Err(WireError::Unknown);
    }
    let mut r = Reader::new(bytes);
    if r.take(ENTRY.len())? != ENTRY || EntryId::decode(&mut r)? != entry {
        return Err(WireError::Unknown);
    }
    let entries = r.seq(32)?;
    let writes = r.seq(32)?;
    let mut audiences = vec![];
    for _ in 0..r.count(36)? {
        audiences.push((Decode::decode(&mut r)?, r.seq(32)?.into()));
    }
    let mut marks = vec![];
    for _ in 0..r.count(36)? {
        marks.push((EntryId::decode(&mut r)?, r.seq(32)?.into()));
    }
    let seals = r.seq(2)?;
    let born = bool::decode(&mut r)?;
    if !r.done() {
        return Err(WireError::Trailing);
    }
    let slice = Slice { entries, writes, audiences, marks, seals, born };
    if !slice.within(entry, vault) || encode_slice(entry, &slice) != bytes {
        return Err(WireError::Unknown);
    }
    Ok(slice)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast::{document, human_on};
    use crate::lab::Lab;
    fn fixture() -> (Lab, SignerId, VaultId, Vec<EntryId>) {
        let mut lab = Lab::new();
        let pass = lab.passkey("Pages");
        let mac = lab.device_of(pass, "Mac");
        let vault = human_on(&mut lab, pass, &[mac]);
        let entries = (0..3)
            .map(|i| lab.create(mac, vault, vault, "note", &[], document(&format!("{i}"), "text", mac)).unwrap())
            .collect();
        (lab, mac, vault, entries)
    }
    fn globals() -> Globals {
        Globals {
            kernel: b"test complete kernel".to_vec(),
            schema: b"test complete schema".to_vec(),
            key_epoch: b"test opening epoch".to_vec(),
        }
    }
    fn draft(lab: &Lab, mac: SignerId, vault: VaultId, entries: &[EntryId], generation: u64) -> Draft {
        let binding = Binding::new(mac, vault, lab.log(mac).ids(), &globals(), generation);
        let deps = BTreeMap::from([
            (PageId::Entry(entries[0]), BTreeSet::from([PageId::Entry(entries[1])])),
            (PageId::Entry(entries[1]), BTreeSet::from([PageId::Entry(entries[0])])),
        ]);
        Draft::capture(binding, lab.state(mac), globals(), &entries.iter().copied().collect(), &deps).unwrap()
    }
    fn materialize(draft: &Draft) -> (Header, BTreeMap<PageId, Vec<u8>>) {
        let pages = draft
            .pages
            .iter()
            .map(|(&id, p)| {
                (
                    id,
                    Descriptor {
                        object: [0; 32],
                        content: hash::content(&p.bytes),
                        bytes: p.bytes.len() as u32,
                        dependencies: p.dependencies.clone(),
                    },
                )
            })
            .collect();
        (
            Header { binding: draft.binding.clone(), pages },
            draft.pages.iter().map(|(&id, p)| (id, p.bytes.clone())).collect(),
        )
    }
    #[test]
    fn projection_matches_complete_replay_and_loads_transitive_dependencies() {
        let (mut lab, mac, vault, entries) = fixture();
        for i in 0..12 {
            lab.edit(mac, vault, entries[i % 3], |it| it.set_text(2, &format!("revision {i}"))).unwrap();
        }
        let draft = draft(&lab, mac, vault, &entries, 1);
        let (header, mut loaded) = materialize(&draft);
        let requested = BTreeSet::from([entries[0]]);
        let closure = header.closure(&requested).unwrap();
        assert_eq!(closure.len(), 5); // two cyclic entries plus three globals
        assert!(!closure.contains(&PageId::Entry(entries[2])));
        loaded.remove(&PageId::Entry(entries[2]));
        let full = crate::policy::replay(lab.log(mac).edits());
        assert_eq!(
            header.read(&header.binding, &requested, &loaded).unwrap(),
            PageRead::Ready {
                binding: header.binding.clone(),
                entries: BTreeMap::from([(entries[0], full.state.slice_of(entries[0]))])
            }
        );
        loaded.remove(&PageId::Entry(entries[1]));
        assert_eq!(
            header.read(&header.binding, &requested, &loaded).unwrap(),
            PageRead::Missing(BTreeSet::from([PageId::Entry(entries[1])]))
        );
        let unknown = EntryId::from_u64(999999);
        assert!(
            matches!(header.read(&header.binding, &BTreeSet::from([unknown]), &loaded).unwrap(), PageRead::Missing(ids) if ids.contains(&PageId::Entry(unknown)))
        );
    }
    #[test]
    fn same_count_restore_and_every_context_change_invalidate_pages() {
        let (mut lab, mac, vault, entries) = fixture();
        let base = lab.backup(mac);
        lab.edit(mac, vault, entries[0], |it| it.set_text(2, "first branch")).unwrap();
        let (header, loaded) = materialize(&draft(&lab, mac, vault, &entries, 1));
        let n = lab.log(mac).ids().len();
        lab.restore_backup(mac, &base);
        lab.edit(mac, vault, entries[0], |it| it.set_text(2, "replacement branch")).unwrap();
        assert_eq!(lab.log(mac).ids().len(), n);
        let current = Binding::new(mac, vault, lab.log(mac).ids(), &globals(), 1);
        let requested = BTreeSet::from([entries[0]]);
        assert_eq!(header.read(&current, &requested, &loaded).unwrap(), PageRead::Stale);
        for i in 0..8 {
            let mut changed = header.binding.clone();
            match i {
                0 => changed.device.0[0] ^= 1,
                1 => changed.vault.0[0] ^= 1,
                2 => changed.engine[0] ^= 1,
                3 => changed.frontier[0] ^= 1,
                4 => changed.kernel[0] ^= 1,
                5 => changed.schema[0] ^= 1,
                6 => changed.opened_epoch[0] ^= 1,
                _ => changed.generation += 1,
            }
            assert_eq!(header.read(&changed, &requested, &loaded).unwrap(), PageRead::Stale);
        }
    }
    #[test]
    fn codecs_reject_truncation_oversized_counts_tampering_and_foreign_entry_data() {
        let (lab, mac, vault, entries) = fixture();
        let (header, mut loaded) = materialize(&draft(&lab, mac, vault, &entries, 1));
        let bytes = header.to_bytes().unwrap();
        assert_eq!(Header::from_bytes(&bytes).unwrap(), header);
        for n in 0..bytes.len() {
            assert!(Header::from_bytes(&bytes[..n]).is_err());
        }
        let mut bad = bytes.clone();
        bad.push(0);
        assert!(Header::from_bytes(&bad).is_err());
        let count = HEADER.len() + header.binding.to_bytes().len();
        let mut bad = bytes.clone();
        bad[count..count + 4].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(Header::from_bytes(&bad).is_err());
        let mut bad = bytes.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert!(Header::from_bytes(&bad).is_err());
        let requested = BTreeSet::from([entries[0]]);
        loaded.get_mut(&PageId::Entry(entries[0])).unwrap().push(0);
        assert!(header.read(&header.binding, &requested, &loaded).is_err());
        // Even a locally authenticated producer cannot place another entry's slice
        // under this entry: the projection decoder validates its scope explicitly.
        let mut foreign = header.clone();
        let bytes = encode_slice(entries[0], &lab.state(mac).slice_of(entries[1]));
        let d = foreign.pages.get_mut(&PageId::Entry(entries[0])).unwrap();
        d.bytes = bytes.len() as u32;
        d.content = hash::content(&bytes);
        loaded.insert(PageId::Entry(entries[0]), bytes);
        assert!(foreign.read(&foreign.binding, &requested, &loaded).is_err());
    }
    #[test]
    fn dense_shared_dependencies_are_bounded_for_constructed_and_decoded_headers() {
        let (lab, mac, vault, entries) = fixture();
        let (mut header, _) = materialize(&draft(&lab, mac, vault, &entries, 1));
        header.pages.retain(|id, _| !matches!(id, PageId::Entry(_)));
        let shared: BTreeSet<_> =
            (0..500).map(|n| PageId::Entry(EntryId::from_u64(10000 + n))).chain(GLOBALS).collect();
        for &id in &shared {
            if matches!(id, PageId::Entry(_)) {
                header.pages.insert(
                    id,
                    Descriptor { object: [0; 32], content: [0; 32], bytes: 0, dependencies: shared.clone() },
                );
            }
        }
        let request = BTreeSet::from([EntryId::from_u64(10000)]);
        assert_eq!(header.closure(&request).unwrap(), shared);
        let encoded = header.to_bytes().unwrap();
        assert_eq!(Header::from_bytes(&encoded).unwrap().closure(&request).unwrap(), shared);
        // Each descriptor is individually legal, and the total encoding is below
        // 16 MiB, but its aggregate edge count exceeds the independent graph budget.
        for n in 500..525 {
            header.pages.insert(
                PageId::Entry(EntryId::from_u64(10000 + n)),
                Descriptor { object: [0; 32], content: [0; 32], bytes: 0, dependencies: shared.clone() },
            );
        }
        assert!(header.closure(&request).is_err());
        assert!(header.to_bytes().is_err());
    }

    #[test]
    fn capture_requires_existing_own_vault_entries_and_closed_dependencies() {
        let (lab, mac, vault, entries) = fixture();
        let binding = Binding::new(mac, vault, lab.log(mac).ids(), &globals(), 1);
        let unknown = EntryId::from_u64(999999);
        assert!(
            Draft::capture(binding.clone(), lab.state(mac), globals(), &BTreeSet::from([unknown]), &BTreeMap::new())
                .is_err()
        );
        let deps = BTreeMap::from([(PageId::Schema, BTreeSet::from([PageId::Entry(unknown)]))]);
        assert!(Draft::capture(binding, lab.state(mac), globals(), &entries.iter().copied().collect(), &deps).is_err());
    }
}
