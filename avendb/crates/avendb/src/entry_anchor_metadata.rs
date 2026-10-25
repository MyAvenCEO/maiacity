//! Bounded owner-attested entry policy and non-content body metadata. No global kernel.
use super::*;

pub(super) fn put_anchor_metadata(store: &Store, entry: EntryId) -> Option<Vec<u8>> {
    let slice = store.replay.state.slice_of(entry);
    if slice.entries.len() != 1 || slice.writes.len() > MAX_FACTS {
        return None;
    }
    let en = &slice.entries[0];
    let mut b = Vec::new();
    en.id.encode(&mut b);
    en.vault.encode(&mut b);
    (en.stays.len() as u32).encode(&mut b);
    for (s, a) in &en.stays {
        s.encode(&mut b);
        a.encode(&mut b);
    }
    en.creator.encode(&mut b);
    en.creation.encode(&mut b);
    en.intake.encode(&mut b);
    en.retags.encode(&mut b);
    (slice.writes.len() as u32).encode(&mut b);
    for w in &slice.writes {
        suffix::encode_write(w, &mut b);
    }
    (slice.audiences.len() as u32).encode(&mut b);
    for (a, ids) in &slice.audiences {
        a.encode(&mut b);
        ids.to_vec().encode(&mut b);
    }
    (slice.marks.len() as u32).encode(&mut b);
    for (e, ids) in &slice.marks {
        e.encode(&mut b);
        ids.to_vec().encode(&mut b);
    }
    (slice.seals.len() as u32).encode(&mut b);
    for s in &slice.seals {
        s.secret.encode(&mut b);
        s.to.encode(&mut b);
    }
    slice.born.encode(&mut b);
    let ids: BTreeSet<_> = slice
        .writes
        .iter()
        .map(|w| w.edit)
        .chain(en.retags.iter().copied())
        .collect();
    if ids.len() > MAX_FACTS {
        return None;
    }
    (ids.len() as u32).encode(&mut b);
    for id in ids {
        // Own exact-basis metadata is authorized through current keys. Avoid
        // copying historical content only to discard it for the policy envelope.
        let body = crate::deferred_body::BodyMetadata::of(store.body_metadata(id)?);
        id.encode(&mut b);
        body.bytes().encode(&mut b);
    }
    (b.len() <= MAX_BYTES).then_some(b)
}
pub(super) fn get_anchor_metadata(
    bytes: &[u8],
    entry: EntryId,
    vault: VaultId,
) -> Option<(crate::policy::Slice, HashMap<EditId, Body>)> {
    if bytes.len() > MAX_BYTES {
        return None;
    }
    let mut r = WireReader::new(bytes);
    let id = Decode::decode(&mut r).ok()?;
    let owner = Decode::decode(&mut r).ok()?;
    let mut stays = Vec::new();
    for _ in 0..bounded_count(&mut r, 33, MAX_FACTS)? {
        stays.push((r.option::<EditId>().ok()?, Decode::decode(&mut r).ok()?));
    }
    if id != entry || owner != vault || stays.is_empty() {
        return None;
    }
    let en = Entry {
        id,
        vault: owner,
        stays,
        creator: Decode::decode(&mut r).ok()?,
        creation: Decode::decode(&mut r).ok()?,
        intake: seq(&mut r, 32, MAX_LIST)?,
        retags: seq(&mut r, 32, MAX_FACTS)?,
    };
    let writes = (0..bounded_count(&mut r, 1, MAX_FACTS)?)
        .map(|_| suffix::decode_write(&mut r))
        .collect::<Option<Vec<_>>>()?;
    let mut audiences = Vec::new();
    for _ in 0..bounded_count(&mut r, 36, MAX_FACTS)? {
        let a = Decode::decode(&mut r).ok()?;
        audiences.push((a, seq::<ShareId>(&mut r, 32, MAX_LIST)?.into()));
    }
    let mut marks = Vec::new();
    for _ in 0..bounded_count(&mut r, 36, 1)? {
        let e = Decode::decode(&mut r).ok()?;
        marks.push((e, seq::<ShareId>(&mut r, 32, MAX_LIST)?.into()));
    }
    let mut seals = Vec::new();
    for _ in 0..bounded_count(&mut r, 2, MAX_LIST)? {
        seals.push(crate::keys::Seal {
            secret: Decode::decode(&mut r).ok()?,
            to: Decode::decode(&mut r).ok()?,
        });
    }
    let born = bool::decode(&mut r).ok()?;
    let slice = crate::policy::Slice {
        entries: vec![en],
        writes,
        audiences,
        marks,
        seals,
        born,
    };
    if !slice.within(entry, vault) {
        return None;
    }
    let mut bodies = HashMap::new();
    for _ in 0..bounded_count(&mut r, 36, MAX_FACTS)? {
        let id = EditId::decode(&mut r).ok()?;
        let body = Body::from_wire(&r.bytes().ok()?).ok()?;
        if !body.content.is_empty() || bodies.insert(id, body).is_some() {
            return None;
        }
    }
    let needed: BTreeSet<_> = slice
        .writes
        .iter()
        .map(|w| w.edit)
        .chain(slice.entries[0].retags.iter().copied())
        .collect();
    if !r.done()
        || needed != bodies.keys().copied().collect()
        || !needed.contains(&slice.entries[0].creation)
    {
        return None;
    }
    Some((slice, bodies))
}
