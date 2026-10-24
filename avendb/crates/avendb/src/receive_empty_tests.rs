//! Differential coverage for omitting the named-blob history scan on edit-only receives.
use super::*;
use crate::cast;
use crate::sign::Suite;

// The former receive_now path, deliberately retaining its unconditional full-log scan as the oracle.
fn receive_reference(lab: &mut Lab, d: SignerId, edits: Vec<Signed>, blobs: Vec<Arc<[u8]>>, now: bool) -> usize {
    let blobs: Blobs = blobs.into_iter().map(|b| (BlobId::of(&b), b)).collect();
    let before = lab.held(d).signed.len();
    let mut changed = lab.take(d, edits, &blobs);
    let store = lab.stores.get_mut(&lab.at(d)).unwrap();
    let named: HashSet<BlobId> = store.log.edits().iter().flat_map(Edit::blobs).collect();
    for (b, bytes) in blobs {
        if named.contains(&b) && !store.blobs.contains_key(&b) {
            store.blobs.insert(b, bytes);
            changed = true;
        }
    }
    let new = lab.held(d).signed.len() - before;
    let store = lab.stores.get_mut(&lab.at(d)).unwrap();
    store.behind |= changed;
    if now && store.behind { lab.refresh(d, &[]); }
    new
}

fn receiver() -> (Lab, SignerId) {
    let mut lab = Lab::with_entropy([234; 32]);
    let me = lab.device_with_in("receiver", [233; 32], Suite::MlDsa);
    (lab, me)
}

fn same(fast: &Lab, slow: &Lab, d: SignerId, entry: EntryId) {
    assert_eq!(fast.log(d).ids(), slow.log(d).ids());
    assert_eq!(fast.backup(d).signed, slow.backup(d).signed);
    assert_eq!(fast.backup(d).blobs, slow.backup(d).blobs);
    assert!(fast.state(d) == slow.state(d));
    assert_eq!(fast.replay(d).standing(), slow.replay(d).standing());
    assert_eq!(fast.held(d).behind, slow.held(d).behind);
    assert_eq!(fast.item(d, entry).map(|x| x.record()), slow.item(d, entry).map(|x| x.record()));
}

#[test]
fn edit_only_pages_and_delayed_named_blobs_match_full_scan_reference() {
    let mut source = Lab::with_entropy([230; 32]);
    let owner = source.passkey_from_in("owner", [231; 32], Suite::MlDsa);
    let sender = source.device_with_in("sender", [232; 32], Suite::MlDsa);
    let (_, me) = receiver();
    assert_eq!(source.device_with_in("receiver", [233; 32], Suite::MlDsa), me);
    let vault = cast::human_on(&mut source, owner, &[sender, me]);
    let entry = source.create(sender, vault, vault, world::NOTE, &[], cast::document("A delayed key", "Its signed history arrives first.", sender)).unwrap();
    let backup = source.backup(sender);
    assert!(!backup.blobs.is_empty());
    let mut corrupt = backup.signed.last().unwrap().clone();
    corrupt.sigs[0].pq[0] ^= 1;
    assert!(corrupt.verify().is_err());
    let (mut fast, _) = receiver();
    let (mut slow, _) = receiver();
    let mut apply = |edits: Vec<Signed>, blobs: Vec<Arc<[u8]>>, now| {
        let expected = receive_reference(&mut slow, me, edits.clone(), blobs.clone(), now);
        assert_eq!(fast.receive_now(me, edits, blobs, now), expected);
        same(&fast, &slow, me, entry);
    };
    apply(vec![corrupt], vec![], true);
    for page in backup.signed.chunks(2) {
        apply(page.to_vec(), vec![], false);
        apply(page.to_vec(), vec![], false); // Duplicate edit-only pages while replay is still deferred.
    }
    apply(vec![], vec![], true); // An empty final page must still flush deferred replay.
    apply(vec![], vec![Arc::from(&b"an unsolicited key"[..])], true);
    let blobs: Vec<_> = backup.blobs.values().cloned().collect();
    apply(vec![], vec![blobs[0].clone()], false); // A key can arrive after the edit naming it.
    apply(vec![], blobs.clone(), true);
    apply(backup.signed.clone(), blobs, true); // Already kept keys and edits remain no-ops.
    drop(apply);
    assert!(fast.item(me, entry).is_some(), "the delayed named keys still open the entry");
    assert!(!fast.blob_ids(me).contains(&BlobId::of(b"an unsolicited key")));
    assert!(!fast.held(me).behind);
    let last = source.edit(sender, vault, entry, |item| item.set_text(2, "An edit without another key.")).unwrap();
    let edits = vec![source.signed_edit(sender, last).unwrap().clone()];
    assert_eq!(fast.receive_now(me, edits.clone(), vec![], true), receive_reference(&mut slow, me, edits, vec![], true));
    same(&fast, &slow, me, entry);
    assert_eq!(cast::text(&fast, me, entry, 2).as_deref(), Some("An edit without another key."));
}
