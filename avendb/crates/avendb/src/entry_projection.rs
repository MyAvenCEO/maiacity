//! Owner-approved, read-only entry projections. No projection replaces the policy kernel,
//! admits a write or claims current/global completeness. Ordinary signed history still converges.
//! Current authorization means the locally held verified policy: it cannot establish the absence
//! of unknown revocations. An owner attests the projection, not global freshness or discovery.
//! Records are bounded JSON, never imported as Loro documents or writable CRDT state.
use super::*;
use crate::encode::Encode;
use crate::wire::Reader as WireReader;

const FORMAT: &[u8] = b"avenDB entry projection 1\n";
const MAX_BYTES: usize = 1 << 20;
const MAX_LINES: usize = 16;
const MAX_BASIS: usize = 64;
const MAX_DEPTH: usize = 32;
const MAX_NODES: usize = 16_384;

/// Bytes to store by content hash, and the normal owner-ceremony draft that commits to them.
/// The draft is not signed or accepted by preparation.
pub struct PreparedEntryProjection {
    pub draft: Unsigned,
    pub root: FileRoot,
    pub sealed: Vec<u8>,
}

/// Authenticated state at the stated basis, explicitly read-only until ordinary history arrives.
/// Fields cannot be constructed by callers; the Lab gate is the sole constructor.
#[derive(Clone)]
pub struct VerifiedEntryProjection {
    entry: EntryId,
    snapshot: EditId,
    basis: Vec<EditId>,
    key: KeyName,
    lines: BTreeMap<Line, Value>,
}
impl VerifiedEntryProjection {
    pub fn entry(&self) -> EntryId { self.entry }
    pub fn snapshot(&self) -> EditId { self.snapshot }
    pub fn basis(&self) -> &[EditId] { &self.basis }
    pub fn record(&self, line: Line) -> Option<Value> { self.lines.get(&line).cloned() }
}

// Allocation-free conservative JSON preflight. Count keys as nodes too; syntax and UTF-8
// are validated by serde only after depth, token and encoded-byte budgets pass.
fn json_budget(bytes: &[u8], remaining: &mut usize) -> bool {
    if bytes.len() > MAX_BYTES { return false; }
    let (mut depth, mut string, mut escaped, mut atom) = (0usize, false, false, false);
    for &b in bytes {
        if string {
            if escaped { escaped = false; }
            else if b == b'\\' { escaped = true; }
            else if b == b'"' { string = false; }
            continue;
        }
        let node = match b {
            b'"' => { string = true; atom = false; true }
            b'{' | b'[' => { depth += 1; atom = false; if depth > MAX_DEPTH { return false; } true }
            b'}' | b']' => { if depth == 0 { return false; } depth -= 1; atom = false; false }
            b',' | b':' | b' ' | b'\n' | b'\r' | b'\t' => { atom = false; false }
            _ => { let first = !atom; atom = true; first }
        };
        if node { if *remaining == 0 { return false; } *remaining -= 1; }
    }
    !string && depth == 0
}

// serde_json retains its default recursion limit while parsing. This tighter traversal bounds
// accepted records and includes object keys in the encoded byte limit. No compressed payloads.
fn bounded_record(value: &Value) -> bool {
    let mut todo = vec![(value, 0usize)];
    let mut nodes = 0;
    while let Some((value, depth)) = todo.pop() {
        nodes += 1;
        if nodes > MAX_NODES || depth > MAX_DEPTH { return false; }
        match value {
            Value::Array(xs) => {
                if xs.len() > MAX_NODES - nodes || todo.len() + xs.len() > MAX_NODES { return false; }
                todo.extend(xs.iter().map(|x| (x, depth + 1)));
            }
            Value::Object(xs) => {
                if xs.len() > MAX_NODES - nodes || todo.len() + xs.len() > MAX_NODES { return false; }
                todo.extend(xs.values().map(|x| (x, depth + 1)));
            }
            _ => {}
        }
    }
    value.is_object()
}

fn context(vault: VaultId, entry: EntryId) -> Vec<u8> {
    let mut out = FORMAT.to_vec();
    vault.encode(&mut out); entry.encode(&mut out);
    out
}

fn encode(vault: VaultId, entry: EntryId, basis: &[EditId], lines: &BTreeMap<Line, Value>) -> Vec<u8> {
    let mut out = context(vault, entry);
    ENGINE.as_bytes().to_vec().encode(&mut out);
    basis.to_vec().encode(&mut out);
    (lines.len() as u32).encode(&mut out);
    for (line, item) in lines { line.encode(&mut out); serde_json::to_vec(item).expect("JSON record").encode(&mut out); }
    out
}

fn decode(bytes: &[u8], vault: VaultId, entry: EntryId, basis: &[EditId], _signer: SignerId) -> Option<BTreeMap<Line, Value>> {
    if bytes.len() > MAX_BYTES { return None; }
    let mut r = WireReader::new(bytes);
    let prefix = context(vault, entry);
    if r.take(prefix.len()).ok()? != prefix || r.bytes().ok()? != ENGINE.as_bytes() { return None; }
    if r.seq::<EditId>(32).ok()? != basis { return None; }
    let count = r.count(5).ok()?;
    if count == 0 || count > MAX_LINES { return None; }
    let mut lines = BTreeMap::new();
    let mut budget = MAX_NODES;
    for _ in 0..count {
        let line = r.option::<EditId>().ok()?;
        let encoded = r.bytes().ok()?;
        if !json_budget(&encoded, &mut budget) { return None; }
        let item: Value = serde_json::from_slice(&encoded).ok()?;
        if !bounded_record(&item) { return None; }
        if lines.insert(line, item).is_some() { return None; }
    }
    if !r.done() || !lines.contains_key(&MAIN) { return None; }
    Some(lines)
}

impl Lab {
    /// Prepare a bounded encrypted projection through the existing owner approval path.
    /// Device-only signatures cannot approve Snapshot. The caller must run the returned draft's
    /// usual ceremony/complete path and persist its content-addressed bytes; no live store changes.
    pub fn draft_entry_projection(&mut self, on: SignerId, signers: &[SignerId], entry: EntryId) -> Result<PreparedEntryProjection, Refusal> {
        let store = self.held(on);
        if store.replayed != store.log.edits().len() { return Err(Refusal::NotAccepted); }
        let st = &store.replay.state;
        let en = st.entry(entry).ok_or(Refusal::UnknownEntry)?;
        let vault = en.vault;
        let shown = store.shown.get(&entry).ok_or(Refusal::NotAccepted)?;
        let items = shown.items_in(Some(store));
        if !shown.history.landed() || !items.contains_key(&MAIN) || items.len() > MAX_LINES {
            return Err(Refusal::NotAccepted);
        }
        let mut basis: Vec<_> = shown.history.lines().into_iter().flat_map(|line| shown.history.heads(line)).collect();
        basis.sort(); basis.dedup();
        if basis.is_empty() || basis.len() > MAX_BASIS { return Err(Refusal::NotAccepted); }
        let key = st.entry_key(entry).and_then(|name| store.keys.first(name)).ok_or(Refusal::NoCap)?.clone();
        let records: BTreeMap<_, _> = items.iter().map(|(line, item)| (*line, item.record())).collect();
        if records.values().any(|record| !bounded_record(record)) { return Err(Refusal::NotAccepted); }
        let bytes = encode(vault, entry, &basis, &records);
        if bytes.len() > MAX_BYTES { return Err(Refusal::NotAccepted); }
        let sealed = keys::seal_edit(&key, &bytes, &context(vault, entry), &mut self.rng);
        let root = FileRoot { hash: crate::hash::content(&sealed), size: sealed.len() as u64 };
        let draft = self.draft(on, signers, Action::Snapshot { vault,
            states: vec![crate::policy::Stated { entry, basis, slice: root }] })?;
        Ok(PreparedEntryProjection { draft, root, sealed })
    }

    pub(super) fn projection_authority(&self, on: SignerId, snapshot: EditId, entry: EntryId) -> Option<(VaultId, &crate::policy::Stated, KeyName)> {
        let authority = self.projection_entitlement(on, snapshot, entry)?;
        self.held(on).keys.first(authority.2)?;
        Some(authority)
    }
    // Policy authority and possession of a particular ciphertext key are distinct.
    // The legacy decoder still requires its exact ordinary entry key.
    pub(super) fn projection_entitlement(&self, on: SignerId, snapshot: EditId, entry: EntryId) -> Option<(VaultId, &crate::policy::Stated, KeyName)> {
        let store = self.held(on);
        if store.replayed != store.log.edits().len() { return None; }
        let st = &store.replay.state;
        let en = st.entry(entry)?;
        let standing: HashSet<_> = store.replay.standing().into_iter().collect();
        if !standing.contains(&snapshot) { return None; }
        let edit = store.log.edits().iter().find(|e| e.id() == snapshot)?;
        let Action::Snapshot { vault, states } = &edit.action else { return None; };
        if *vault != en.vault { return None; }
        let stated = states.iter().find(|s| s.entry == entry)?;
        if stated.basis.is_empty() || stated.basis.len() > MAX_BASIS
            || crate::snapshot::stale(store.log.edits(), &standing, edit, stated) { return None; }
        for basis in &stated.basis {
            if let Some(held) = store.log.edits().iter().find(|e| e.id() == *basis) {
                if held.depth >= edit.depth || crate::sync::log_of(held, *basis) != Some(LogId::Entry(entry)) { return None; }
            }
        }
        // Current recipient entitlement is checked even if an old decrypted key remains locally.
        let audience = KeyFam::Audience(en.vault, en.audience());
        let opens = st.opens(&[KeyName::Signer(on)]);
        let name = st.entry_key(entry)?;
        if !(st.public_key(audience) || st.entitled(on, audience))
            || !opens.contains(&st.current(audience)) || !opens.contains(&name) || !st.wants(on, en) { return None; }
        Some((*vault, stated, name))

    }

    /// Validate a stored owner-approved projection without adopting any peer's authorization state.
    /// The local signed log must already establish entry identity and current governance. A
    /// pending policy update or any standing later removal makes this return None and use history.
    pub fn open_entry_projection(&self, on: SignerId, snapshot: EditId, entry: EntryId, sealed: &[u8]) -> Option<VerifiedEntryProjection> {
        if sealed.len() > MAX_BYTES + 128 { return None; }
        let (vault, stated, name) = self.projection_authority(on, snapshot, entry)?;
        if stated.slice.size != sealed.len() as u64 || stated.slice.hash != crate::hash::content(sealed) { return None; }
        let store = self.held(on);
        let key = store.keys.get(&keys::edit_key(sealed)?, name)?;
        let bytes = keys::open_edit(key, sealed, &context(vault, entry))?;
        let lines = decode(&bytes, vault, entry, &stated.basis, on)?;
        // A full holder does not take even an owner's incorrect record on faith. Compare
        // against exactly the stated causal version, not later local edits.
        if stated.basis.iter().all(|id| store.log.ids().contains(id)) {
            let history = store.shown.get(&entry)?;
            let version = history.history.version(&stated.basis);
            if !stated.basis.iter().all(|id| version.iter().any(|c| c.write.edit == *id)) { return None; }
            let expected: std::collections::BTreeSet<_> = std::iter::once(MAIN)
                .chain(version.iter().filter(|c| c.counted && c.write.proposal == crate::policy::Proposal::New)
                    .map(|c| Some(c.write.edit))).collect();
            if lines.keys().copied().collect::<std::collections::BTreeSet<_>>() != expected { return None; }
            for (line, item) in &lines {
                let selected = crate::policy::history(version.iter().copied().filter(|c| c.counted), *line);
                let canonical = crate::history::build_from(&selected, on, *line)?;
                if canonical.record() != *item { return None; }
            }
        }
        Some(VerifiedEntryProjection { entry, snapshot, basis: stated.basis.clone(), key: name, lines })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast::{document, human_on};

    #[test]
    fn owner_projection_is_encrypted_read_only_and_revocation_sensitive() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        // Login/authority setup precedes view demand; only the new entry's history is withheld.
        lab.sync(mac, phone);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Private checkpoint", "before", mac)).unwrap();
        lab.edit(mac, vault, entry, |item| item.set_text(2, "latest private content")).unwrap();
        assert!(matches!(lab.draft_entry_projection(mac, &[mac], entry), Err(Refusal::BelowThreshold)));
        let PreparedEntryProjection { draft, sealed, root } = lab.draft_entry_projection(mac, &[owner], entry).unwrap();
        assert!(!String::from_utf8_lossy(&sealed).contains("latest private content"));
        let snap = lab.complete(mac, draft, &[]).unwrap();
        let offered = lab.entry_projection_offer(mac, phone, entry).expect("authorized reader offer");
        assert_eq!(offered.snapshot, snap);
        assert!(lab.entry_projection_offer_after(mac, phone, entry, Some(snap)).is_none(), "unchanged checkpoint needs no repeat transfer");
        assert_eq!(offered.root, root);
        lab.receive(phone, offered.evidence.clone(), vec![]);
        assert!(lab.retain_entry_projection(phone, snap, entry, sealed.clone()),
            "new entry setup includes the authorized audience key without content history");
        assert!(offered.evidence.iter().all(|s| !matches!(s.edit.action, Action::Write { create: None, .. })),
            "checkpoint evidence withholds intermediate content history");
        let stranger = lab.passkey("Stranger");
        assert!(lab.entry_projection_offer(mac, stranger, entry).is_none());
        let projection = lab.open_entry_projection(mac, snap, entry, &sealed).unwrap();
        assert_eq!(projection.record(MAIN), Some(lab.item(mac, entry).unwrap().record()));
        assert_eq!(projection.entry(), entry);
        assert_eq!(projection.snapshot(), snap);
        assert!(!projection.basis().is_empty());
        assert_eq!(root.hash, crate::hash::content(&sealed));
        let mut corrupt = sealed.clone(); corrupt[35] ^= 1;
        assert!(lab.open_entry_projection(mac, snap, entry, &corrupt).is_none());
        assert!(lab.open_entry_projection(mac, snap, EntryId([99; 32]), &sealed).is_none());
        lab.submit(mac, &[owner], Action::Revoke(crate::policy::Revoking::Device {
            vault, device: phone, keep: vec![],
        })).unwrap();
        assert!(lab.open_entry_projection(mac, snap, entry, &sealed).is_none());
        assert!(lab.entry_projection_offer(mac, phone, entry).is_none());
    }
    #[test]
    fn owner_projection_reads_latest_record_while_entry_history_is_withheld() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Checkpoint", "initial", mac)).unwrap();
        lab.sync(mac, phone);
        let original = lab.item(phone, entry).unwrap().record();
        for n in 0..8 {
            lab.edit(mac, vault, entry, |item| item.set_text(2, &format!("latest {n}"))).unwrap();
        }
        let PreparedEntryProjection { draft, sealed, .. } = lab.draft_entry_projection(mac, &[owner], entry).unwrap();
        let snap = lab.complete(mac, draft, &[]).unwrap();
        let snapshot_only = lab.backup(mac).signed().iter().filter(|s| s.edit.id() == snap).cloned().collect();
        lab.receive(phone, snapshot_only, vec![]);
        assert_eq!(lab.item(phone, entry).unwrap().record(), original, "historical entry edits remain withheld");
        let held = lab.log(phone).ids().to_vec();
        let projection = lab.open_entry_projection(phone, snap, entry, &sealed).unwrap();
        assert_eq!(projection.record(MAIN), Some(lab.item(mac, entry).unwrap().record()));
        assert!(projection.basis().iter().any(|id| !held.contains(id)));
        assert_eq!(lab.log(phone).ids(), held, "projection adopts no signatures, history or authorization");
        assert!(lab.retain_entry_projection(phone, snap, entry, sealed));
        let query = serde_json::json!({ "op": "query", "schema": "stored", "where": { "type": ["note"] } });
        let projected = crate::engine::read(&lab, phone, &query);
        let row = &projected["ok"]["rows"][0];
        assert_eq!(row["record"], lab.item(mac, entry).unwrap().record(), "generic query reads checkpoint before history");
        assert_eq!(row["readOnly"], true);
        assert_eq!(row["checkpoint"]["partial"], true);
        let get = crate::engine::read(&lab, phone, &serde_json::json!({ "op": "get", "entry": entry.to_hex(), "schema": "stored" }));
        assert_eq!(get["ok"]["record"], row["record"]);
        assert_eq!(get["ok"]["readOnly"], true);
        assert_eq!(lab.edit(phone, vault, entry, |item| item.set_text(2, "must not edit old state")), Err(Refusal::ReadOnly));
        assert_eq!(lab.log(phone).ids(), held, "checkpoint-selected writes do not sign stale canonical state");
        lab.sync(mac, phone);
        assert!(lab.entry_projection(phone, entry).is_none(), "canonical history covering basis supersedes checkpoint");
        lab.edit(mac, vault, entry, |item| item.set_text(2, "after checkpoint")).unwrap();
        lab.sync(mac, phone);
        let current = crate::engine::read(&lab, phone, &query);
        assert_eq!(current["ok"]["rows"][0]["record"], lab.item(mac, entry).unwrap().record());
        assert!(current["ok"]["rows"][0].get("checkpoint").is_none());
        lab.lock(phone);
        assert!(lab.held(phone).projections.lock().unwrap().is_empty(), "locking clears decrypted checkpoint cache");
    }

    #[test]
    fn retained_projection_revalidates_revocation_and_recipient() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let outsider = lab.device("Outsider");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Checkpoint", "initial", mac)).unwrap();
        lab.sync(mac, phone);
        lab.edit(mac, vault, entry, |item| item.set_text(2, "new")).unwrap();
        let PreparedEntryProjection { draft, sealed, .. } = lab.draft_entry_projection(mac, &[owner], entry).unwrap();
        let snap = lab.complete(mac, draft, &[]).unwrap();
        let signed = lab.backup(mac).signed().iter().filter(|s| s.edit.id() == snap).cloned().collect();
        lab.receive(phone, signed, vec![]);
        assert!(!lab.retain_entry_projection(outsider, snap, entry, sealed.clone()));
        assert!(lab.retain_entry_projection(phone, snap, entry, sealed));
        assert!(lab.entry_projection(phone, entry).is_some());
        lab.create(phone, vault, vault, "note", &[], document("Unrelated", "does not invalidate projection", phone)).unwrap();
        assert!(lab.entry_projection(phone, entry).is_some(), "unrelated revision rechecks authorization without losing view");
        let revoke = lab.submit(mac, &[owner], Action::Revoke(crate::policy::Revoking::Device {
            vault, device: phone, keep: vec![],
        })).unwrap();
        let signed = lab.backup(mac).signed().iter().filter(|s| s.edit.id() == revoke).cloned().collect();
        lab.receive(phone, signed, vec![]);
        assert!(lab.entry_projection(phone, entry).is_none());
    }

    #[test]
    fn owner_projection_rejects_mismatched_envelopes_and_full_holder_lies() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let mac = lab.device_of(owner, "Mac");
        let vault = human_on(&mut lab, owner, &[mac]);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Checkpoint", "real", mac)).unwrap();
        let other = lab.create(mac, vault, vault, "note", &[], document("Other", "other", mac)).unwrap();
        let prepared = lab.draft_entry_projection(mac, &[owner], entry).unwrap();
        let Action::Snapshot { states, .. } = &prepared.draft.edit.action else { panic!("snapshot draft") };
        let basis = states[0].basis.clone();
        let key = {
            let store = lab.held(mac);
            store.keys.first(store.replay.state.entry_key(entry).unwrap()).unwrap().clone()
        };
        let body = keys::open_edit(&key, &prepared.sealed, &context(vault, entry)).unwrap();
        let mut lines = decode(&body, vault, entry, &basis, mac).unwrap();
        lines.get_mut(&MAIN).unwrap().as_object_mut().unwrap().insert("forged".into(), Value::Bool(true));
        let cases = [
            encode(vault, entry, &basis, &lines),
            encode(vault, other, &basis, &lines),
            encode(VaultId([91; 32]), entry, &basis, &lines),
            encode(vault, entry, &[EditId([92; 32])], &lines),
        ];
        for body in cases {
            let sealed = keys::seal_edit(&key, &body, &context(vault, entry), &mut lab.rng);
            let root = FileRoot { hash: crate::hash::content(&sealed), size: sealed.len() as u64 };
            let snap = lab.submit(mac, &[owner], Action::Snapshot { vault, states: vec![
                crate::policy::Stated { entry, basis: basis.clone(), slice: root }
            ] }).unwrap();
            assert!(lab.open_entry_projection(mac, snap, entry, &sealed).is_none());
        }
    }

    #[test]
    fn record_limits_reject_before_json_allocation() {
        let mut budget = MAX_NODES;
        assert!(json_budget(br#"{"text":"escaped \" [ {", "rows":[1,true,null]}"#, &mut budget));
        let deep = format!("{}0{}", "[".repeat(MAX_DEPTH + 1), "]".repeat(MAX_DEPTH + 1));
        let rejects = |bytes: &[u8]| { let mut budget = MAX_NODES; !json_budget(bytes, &mut budget) };
        assert!(rejects(deep.as_bytes()));
        let broad = format!("[{}]", vec!["0"; MAX_NODES].join(","));
        assert!(rejects(broad.as_bytes()));
        assert!(rejects(&vec![b' '; MAX_BYTES + 1]));
        assert!(rejects(br#"{"broken":"unfinished"#));
    }

}

// Bounded, recipient-keyed read projections. Store replacement/lock drops this entire cache.
pub(super) struct CachedEntryProjection {
    snapshot: EditId,
    sealed: Vec<u8>,
    revision: crate::policy::LogRevision,
    value: VerifiedEntryProjection,
}
const CACHE_ENTRIES: usize = 8;
const CACHE_BYTES: usize = 4 << 20;

impl Lab {
    /// Retain only a normally verified checkpoint. This is not entry-history or policy adoption.
    pub fn retain_entry_projection(&self, on: SignerId, snapshot: EditId, entry: EntryId, sealed: Vec<u8>) -> bool {
        let Some(value) = self.open_entry_projection(on, snapshot, entry, &sealed) else { return false; };
        let store = self.held(on);
        let mut cache = store.projections.lock().expect("entry projections");
        let key = (on, entry);
        let rank = |id| store.log.edits().iter().find(|e| e.id() == id).map(|e| (e.depth, id));
        if cache.get(&key).is_some_and(|old| rank(old.snapshot) > rank(snapshot)) { return false; }
        cache.remove(&key);
        while cache.len() >= CACHE_ENTRIES || cache.values().map(|x| x.sealed.len()).sum::<usize>() + sealed.len() > CACHE_BYTES {
            let Some(first) = cache.keys().next().copied() else { return false; };
            cache.remove(&first);
        }
        cache.insert(key, CachedEntryProjection { snapshot, sealed, revision: store.log.revision(), value });
        true
    }

    /// Read-only checkpoint only while canonical history has not materialized its signed basis.
    /// Authorization is cached only for the exact immutable log revision and recipient.
    pub(crate) fn entry_projection(&self, on: SignerId, entry: EntryId) -> Option<VerifiedEntryProjection> {
        let store = self.held(on);
        if store.replayed != store.log.edits().len() || !self.sees(on, entry) { return None; }
        let key = (on, entry);
        let revision = store.log.revision();
        let mut cache = store.projections.lock().expect("entry projections");
        let cached = cache.get_mut(&key)?;
        let covered = store.shown.get(&entry).is_some_and(|shown| shown.history.landed()
            && cached.value.basis.iter().all(|id| shown.history.get(*id).is_some_and(|c| c.counted)));
        if covered { return None; }
        // Once all frontier signatures are held, use only canonical materialization. An owner
        // attestation must not mask a locally denied or still-unopened basis.
        if cached.value.basis.iter().all(|id| store.log.ids().contains(id)) { return None; }
        if cached.revision != revision {
            // Immutable ciphertext was authenticated/decoded once. Only policy and the key epoch
            // change with unrelated log arrivals; do not decrypt/parse the same record again.
            let authorized = self.projection_authority(on, cached.snapshot, entry)
                .is_some_and(|(_, stated, name)| name == cached.value.key && stated.basis == cached.value.basis);
            if !authorized { cache.remove(&key); return None; }
            cached.revision = revision;
        }
        Some(cached.value.clone())
    }
}

/// A normally signed, scoped checkpoint offer. Evidence contains only authorized entry setup
/// (creation/key/stay records) and its owner approval, never the intervening content history.
pub struct EntryProjectionOffer {
    pub snapshot: EditId,
    pub root: FileRoot,
    pub evidence: Vec<Signed>,
    pub blobs: Vec<BlobId>,
}

impl Lab {
    /// Current READ authorization precedes checkpoint selection. Backup/relay possession alone
    /// cannot discover or fetch a checkpoint; the authenticated requester supplies no identity field.
    /// An untrusted optimization hint only: it neither reads plaintext nor validates authorization.
    /// A peer still checks current READ before comparing this ID to its standing snapshot.
    pub fn retained_projection_hint(&self, me: SignerId, entry: EntryId) -> Option<EditId> {
        self.active_owner_base(me, entry).map(|(snapshot, _)| snapshot)
            .or_else(|| self.held(me).projections.lock().expect("entry projections").get(&(me, entry)).map(|v| v.snapshot))
    }

    /// A persisted content pin only locates bytes. Select its signed checkpoint under
    /// current ordinary policy; ciphertext must still pass `retain_entry_projection`.
    /// A disk tag may advance only to the newest currently authorized standing snapshot.
    /// Call under the node's checkpoint pin serialization gate; ordinary policy remains
    /// checked here and no in-memory cache hint is treated as authority.
    pub fn entry_projection_pin_is_current(&self, me: SignerId, entry: EntryId, snapshot: EditId, root: FileRoot) -> bool {
        let Some((_, stated, _)) = self.projection_authority(me, snapshot, entry) else { return false; };
        if stated.slice != root { return false; }
        let log = &self.held(me).log;
        let Some(selected) = log.edits().iter().find(|edit| edit.id() == snapshot) else { return false; };
        !log.edits().iter().any(|edit| {
            (edit.depth, edit.id()) > (selected.depth, snapshot)
                && matches!(&edit.action, Action::Snapshot { states, .. } if states.iter().any(|state| state.entry == entry))
                && self.projection_authority(me, edit.id(), entry).is_some()
        })
    }

    pub fn entry_projection_restore_point(&self, me: SignerId, entry: EntryId, hash: [u8; 32]) -> Option<(EditId, FileRoot)> {
        let store = self.held(me);
        if store.replayed != store.log.edits().len() { return None; }
        store.log.edits().iter().filter_map(|edit| {
            let Action::Snapshot { states, .. } = &edit.action else { return None; };
            let state = states.iter().find(|state| state.entry == entry && state.slice.hash == hash)?;
            if state.slice.size > (MAX_BYTES + 128) as u64 { return None; }
            self.projection_authority(me, edit.id(), entry)?;
            Some((edit.depth, edit.id(), state.slice))
        }).max_by_key(|(depth, id, _)| (*depth, *id)).map(|(_, id, root)| (id, root))
    }

    pub fn entry_projection_offer(&self, me: SignerId, requester: SignerId, entry: EntryId) -> Option<EntryProjectionOffer> {
        self.entry_projection_offer_after(me, requester, entry, None)
    }

    pub fn entry_projection_offer_after(&self, me: SignerId, requester: SignerId, entry: EntryId, known: Option<EditId>) -> Option<EntryProjectionOffer> {
        self.entry_projection_offer_matching(me,requester,entry,known,None)
    }
    /// A format-specific durable pin is only a hint: all standing/current READ gates
    /// still apply before selecting the signed snapshot with this ciphertext root.
    pub fn entry_projection_offer_for_root(&self, me:SignerId, requester:SignerId, entry:EntryId, known:Option<EditId>, root:[u8;32])->Option<EntryProjectionOffer> {
        self.entry_projection_offer_matching(me,requester,entry,known,Some(root))
    }
    fn entry_projection_offer_matching(&self, me: SignerId, requester: SignerId, entry: EntryId, known: Option<EditId>, root:Option<[u8;32]>) -> Option<EntryProjectionOffer> {
        let store = self.held(me);
        if store.replayed != store.log.edits().len() { return None; }
        let st = self.latest(me);
        let en = st.entry(entry)?;
        let audience = KeyFam::Audience(en.vault, en.audience());
        let opens = st.opens(&[KeyName::Signer(requester)]);
        if !(st.public_key(audience) || st.entitled(requester, audience))
            || !opens.contains(&st.current(audience))
            || !st.entry_key(entry).is_some_and(|name| opens.contains(&name)) || !st.wants(requester, en) { return None; }
        let standing: HashSet<_> = store.replay.standing().into_iter().collect();
        let (edit, stated) = store.log.edits().iter().filter_map(|edit| {
            let Action::Snapshot { vault, states } = &edit.action else { return None; };
            if states.len() > MAX_LINES || states.iter().any(|state| state.basis.len() > MAX_BASIS) { return None; }
            if *vault != en.vault || !standing.contains(&edit.id()) { return None; }
            let stated = states.iter().find(|state| state.entry == entry)?;
            if root.is_some_and(|root|root!=stated.slice.hash) { return None; }
            if stated.slice.size > (MAX_BYTES + 128) as u64
                || crate::snapshot::stale(store.log.edits(), &standing, edit, stated) { return None; }
            Some((edit, stated))
        }).max_by_key(|(edit, _)| (edit.depth, edit.id()))?;
        if known == Some(edit.id()) { return None; }
        let allowed = self.answered(me, requester, &[]);
        let mut evidence = Vec::new();
        let mut evidence_bytes = 0usize;
        for &index in allowed.iter() {
            let candidate = &store.log.edits()[index];
            let id = store.log.ids()[index];
            let log = crate::sync::log_of(candidate, id);
            // A newly discovered entry can introduce its audience key after login. Carry
            // that authorized key evidence with the entry; background history may be stalled.
            let audience_key = log == Some(LogId::Audience(en.vault, en.audience()))
                && matches!(candidate.action, Action::Keys { .. });
            let setup = audience_key || (log == Some(LogId::Entry(entry))
                && !matches!(candidate.action, Action::Write { create: None, .. }));
            if setup || id == edit.id() {
                let signed = store.signed.get(&id)?;
                if !bounded_offer_edit(signed) { return None; }
                evidence_bytes = evidence_bytes.checked_add(signed.to_wire().len())?;
                if evidence_bytes > (480 << 10) { return None; }
                evidence.push(signed.clone());
                if evidence.len() > 64 { return None; }
            }
        }
        if !evidence.iter().any(|signed| signed.edit.id() == edit.id()) { return None; }
        let blobs: BTreeSet<_> = evidence.iter().flat_map(|signed| signed.edit.blobs())
            .filter(|blob| store.blobs.contains_key(blob)).collect();
        Some(EntryProjectionOffer { snapshot: edit.id(), root: stated.slice, evidence, blobs: blobs.into_iter().collect() })
    }
}

// Bound every variable-length field before encoding/cloning evidence. Oversized legacy setup
// remains available through ordinary history; the first-view lane never needs an oversized page.
pub(super) fn bounded_offer_edit(signed: &Signed) -> bool {
    use crate::sign::WebAuthn;
    let e = &signed.edit;
    if e.parents.len() > 64 || e.cosigners.len() > 8 || signed.sigs.len() > 8 { return false; }
    for sig in &signed.sigs {
        if sig.pq.len() > 32768 { return false; }
        if let Some(web) = &sig.webauthn {
            let a = web.assertion();
            if a.authenticator_data.len() > 4096 || a.client_data_json.len() > 4096 || a.signature.len() > 1024
                || matches!(web, WebAuthn::Batch { edits, .. } if edits.len() > 64) { return false; }
        }
        if sig.enclave.as_ref().is_some_and(|s| s.public.len() > 4096 || s.sig.len() > 4096 || s.edits.len() > 64) { return false; }
    }
    match &e.action {
        Action::Write { deps, via, create: Some(c), files, body, .. } =>
            deps.len() <= 64 && via.len() <= 16 && c.audience.len() <= 64 && files.len() <= 64 && body.len() <= (128 << 10),
        Action::Write { deps, via, create:None, files, body, .. } => deps.len()<=64 && via.len()<=16 && files.len()<=64 && body.len()<=(128<<10),
        Action::Snapshot { states, .. } => states.len() <= 16 && states.iter().all(|s| s.basis.len() <= 64),
        Action::Mark { caps, wants, keep, via, .. } => caps.as_ref().is_none_or(|x| x.len() <= 64)
            && wants.as_ref().is_none_or(|x| x.len() <= 64) && keep.len() <= 64 && via.len() <= 16,
        Action::Keys { boxes, .. } => boxes.len() <= 32 && boxes.iter().all(|b| b.bytes.len() <= 4096),
        Action::Wraps { wraps, .. } => wraps.len() <= 32 && wraps.iter().all(|w| w.boxed.bytes.len() <= 4096),
        _ => false,
    }
}
