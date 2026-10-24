//! Narrow Store adoption: ordinary owner-authored main-line append while older content
//! is absent. Shared/proposal writes wait for canonical history; no kernel privilege.
use super::*;

pub(crate) type Anchors = BTreeMap<EntryId, (EditId, Vec<u8>)>;

impl Lab {
    pub fn adopt_owner_entry_base(
        &mut self,
        on: SignerId,
        snapshot: EditId,
        entry: EntryId,
        sealed: Vec<u8>,
    ) -> bool {
        if self
            .restore_owner_judgment(on, snapshot, entry, &sealed)
            .is_none()
        {
            return false;
        }
        let at = self.at(on);
        let store = self.stores.get_mut(&at).expect("device");
        if !store.bootstrap_bases.contains_key(&entry) && store.bootstrap_bases.len() >= 16 {
            return false;
        }
        store.bootstrap_bases.insert(entry, (snapshot, sealed));
        self.rebuild_owner_bases(at);
        self.held(at).bootstrap_active.contains(&entry)
    }

    /// Reauthenticate ciphertext and policy on every reconstruction. The signed suffix
    /// stays in the ordinary log; only the entry's derived view is overlaid.
    pub(crate) fn rebuild_owner_bases(&mut self, on: SignerId) {
        let anchors = self.held(on).bootstrap_bases.clone();
        let restored: Vec<_> = anchors
            .iter()
            .filter_map(|(entry, (snap, sealed))| {
                self.restore_owner_judgment(on, *snap, *entry, sealed)
                    .map(|base| (*snap, base))
            })
            .collect();
        let at = self.at(on);
        let store = self.stores.get_mut(&at).expect("device");
        store.bootstrap_state = None;
        store.bootstrap_active.clear();
        if restored.is_empty() {
            return;
        }
        let mut state = store.replay.state.clone();
        'anchor: for (_snapshot, mut base) in restored {
            let entry = base.entry;
            let Some(en) = base.policy.entries.first() else {
                continue;
            };
            let vault = en.vault;
            // Historical entry slices must not overwrite later audience moves,
            // wants, or key seals. Content writes may extend retags; policy may not.
            let current = state.slice_of(entry);
            let Some(now) = current.entries.first() else { continue; };
            if now.id != en.id || now.vault != en.vault || now.creator != en.creator
                || now.creation != en.creation || now.intake != en.intake || now.stays != en.stays
                || current.marks != base.policy.marks || current.seals != base.policy.seals
            { continue; }
            let Some(attrs) = base.after.attrs.as_ref() else {
                continue;
            };
            // Capability groups and schema/lens entries affect other entries' admission.
            // Their bootstrap remains ordinary history; this slice cannot restore them.
            if attrs.ty.of_lane() || attrs.ty.is_cap_group() {
                continue;
            }
            if !state.acts_for(on, vault) {
                continue;
            }
            let mut view = state.with_slice(entry, &base.policy);
            let mut readings = store.readings.clone();
            for (id, body) in &base.bodies {
                if let Some(h) = &body.header {
                    readings.headers.insert(*id, h.clone());
                }
                readings.tags.insert(*id, body.tags.clone());
                if let Some(p) = &body.proof {
                    readings.proofs.insert(*id, p.clone());
                }
            }
            let lane = Lane::with_built_ins(view.lane_of(vault, &readings));
            let en = view.entry(entry).expect("scoped entry").clone();
            let base_scratch =
                base.items.get(&MAIN).cloned().and_then(|item| {
                    Scratch::from_attested_item(item, &base.history.history(MAIN))
                });
            let mut judging = Judging::resume(&en, &readings, &lane, base.history, base.after);
            let mut suffix: Vec<_> = store
                .log
                .edits()
                .iter()
                .filter(|e| {
                    base.history.get(e.id()).is_none()
                        && matches!(e.action,Action::Write{entry:eid,..}if eid==entry)
                })
                .take(513)
                .cloned()
                .collect();
            if suffix.len() > 512 {
                continue;
            }
            suffix = crate::policy::order(&suffix);
            let mut opened_suffix = Vec::new();
            for edit in suffix {
                let id = edit.id();
                // Only normal verified signed-log entries, never owner-invented signatures.
                if !store.signed.get(&id).is_some_and(|s| s.verify().is_ok()) {
                    continue 'anchor;
                }
                let Ok(Some(w)) = view.accepted_write(&edit, id) else {
                    continue 'anchor;
                };
                if w.actor != vault || !w.shares.is_empty() || w.proposal != Proposal::Main {
                    continue 'anchor;
                }
                if !w
                    .deps
                    .iter()
                    .all(|d| judging.history.get(*d).is_some_and(|c| c.counted))
                {
                    continue 'anchor;
                }
                let Action::Write { body, .. } = &edit.action else {
                    continue 'anchor;
                };
                let Some(key_id) = keys::edit_key(body) else {
                    continue 'anchor;
                };
                let Some(key) = store.keys.get(&key_id, w.key()) else {
                    continue 'anchor;
                };
                let Some(opened) = keys::open_edit(key, body, &write_context(&edit))
                    .and_then(|b| Body::from_wire(&b).ok())
                else {
                    continue 'anchor;
                };
                if view.step_mut(&edit, id).is_err() {
                    continue 'anchor;
                }
                if let Some(p) = &opened.proof {
                    readings.proofs.insert(id, p.clone());
                }
                readings.tags.insert(id, opened.tags.clone());
                let bodies = HashMap::from([(id, opened.clone())]);
                if judging
                    .scratch
                    .as_ref()
                    .is_none_or(|s| !s.within_version(&judging.history, &w.deps))
                {
                    judging.scratch = base_scratch
                        .as_ref()
                        .filter(|s| s.within_version(&judging.history, &w.deps))
                        .map(Scratch::fork);
                }
                judging.judge(on, &view, (&readings, &bodies), &w, &readings.groups);
                opened_suffix.push((id, opened));
            }
            let tip = Tip {
                writes: view.entry_writes(entry).count(),
                last: view.entry_writes(entry).last().map(|w| w.edit),
                lane: [0; 32],
                groups: [0; 32],
            };
            let shown = judging.shown_on(on, [0; 32], tip, Some(std::mem::take(&mut base.items)));
            // The ordinary checks may reject suffix content; only counted history shows.
            store.bodies.extend(opened_suffix);
            store.shown.insert(entry, shown);
            store.readings = readings;
            store
                .projections
                .lock()
                .expect("entry projections")
                .remove(&(on, entry));
            store.bootstrap_active.insert(entry);
            state = view;
        }
        if !store.bootstrap_active.is_empty() {
            store.latest = OnceLock::from(state.clone());
            store.bootstrap_state = Some(state);
        }
    }
}

impl Backup {
    /// Durable companion to the existing signed-log backup. Ciphertext only; decoding
    /// grants no authority and restore rechecks its signed root and current policy.
    pub fn bootstrap_bytes(&self) -> Vec<u8> {
        let mut b = b"avenDB bootstrap anchors 1\n".to_vec();
        (self.bootstrap_bases.len() as u32).encode(&mut b);
        for (entry, (snapshot, sealed)) in &self.bootstrap_bases {
            entry.encode(&mut b);
            snapshot.encode(&mut b);
            sealed.encode(&mut b);
            let depth = self
                .signed
                .iter()
                .find(|s| s.edit.id() == *snapshot)
                .map(|s| s.edit.depth)
                .unwrap_or(u64::MAX);
            let suffix: Vec<_> = self
                .signed
                .iter()
                .filter(|s| {
                    s.edit.depth > depth
                        && matches!(s.edit.action,Action::Write{entry:e,..}if e==*entry)
                })
                .map(|s| s.edit.id())
                .collect();
            suffix.encode(&mut b);
        }
        b
    }
    pub fn with_bootstrap_bytes(mut self, bytes: &[u8]) -> Option<Self> {
        if bytes.len() > 16 * (MAX_BYTES + 256) {
            return None;
        }
        let mut r = WireReader::new(bytes);
        let prefix = b"avenDB bootstrap anchors 1\n";
        if r.take(prefix.len()).ok()? != prefix {
            return None;
        }
        let mut anchors = BTreeMap::new();
        for _ in 0..bounded_count(&mut r, 68, 16)? {
            let entry = EntryId::decode(&mut r).ok()?;
            let snapshot = EditId::decode(&mut r).ok()?;
            let sealed = r.bytes().ok()?;
            let suffix = seq::<EditId>(&mut r, 32, 512)?;
            // Detect a torn pair: the durable anchor must not name acknowledged suffix
            // edits absent from the signed-log backup supplied with it.
            if !suffix
                .iter()
                .all(|id| self.signed.iter().any(|s| s.edit.id() == *id))
            {
                return None;
            }
            if sealed.len() > MAX_BYTES + 128 || anchors.insert(entry, (snapshot, sealed)).is_some()
            {
                return None;
            }
        }
        if !r.done() {
            return None;
        }
        self.bootstrap_bases = anchors;
        Some(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast::{document, human_on};
    #[test]
    fn owner_bootstrap_includes_concurrent_writes_older_than_snapshot() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Concurrent owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Base", "old", mac)).unwrap();
        lab.sync(mac, phone);
        let concurrent = lab.edit(phone, vault, entry, |item| {
            item.edit_document(|d| d.title = "concurrent title".into());
        }).unwrap();
        lab.edit(mac, vault, entry, |item| item.set_text(2, "checkpoint text")).unwrap();
        let PreparedEntryBase { draft, sealed, .. } = lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
        let snapshot = lab.complete(mac, draft, &[]).unwrap();
        let signed = lab.backup(phone).signed().iter().find(|s| s.edit.id() == concurrent).unwrap().clone();
        let snapshot_depth = lab.log(mac).edits().iter().find(|e| e.id() == snapshot).unwrap().depth;
        assert!(signed.edit.depth < snapshot_depth, "the delayed branch predates the checkpoint, but is not included in it");
        let offer = lab.entry_projection_offer(mac, phone, entry).unwrap();
        lab.receive(phone, offer.evidence, vec![]);
        assert!(lab.adopt_owner_entry_base(phone, snapshot, entry, sealed));
        lab.receive(mac, vec![signed], vec![]);
        assert_eq!(lab.item(phone, entry).unwrap().record(), lab.item(mac, entry).unwrap().record());
        // The held edit alone is not sufficient evidence for writable adoption.
        lab.stores.get_mut(&phone).unwrap().signed.remove(&concurrent);
        lab.refresh(phone, &[]);
        assert!(!lab.held(phone).bootstrap_active.contains(&entry), "an unverifiable required suffix cannot be skipped while claiming writable completeness");
    }

    #[test]
    fn owner_bootstrap_does_not_overwrite_a_later_entry_mark() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Marked owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Base", "old", mac)).unwrap();
        lab.sync(mac, phone);
        lab.edit(mac, vault, entry, |item| item.set_text(2, "checkpoint")).unwrap();
        let PreparedEntryBase { draft, sealed, .. } = lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
        let snapshot = lab.complete(mac, draft, &[]).unwrap();
        let offer = lab.entry_projection_offer(mac, phone, entry).unwrap();
        lab.receive(phone, offer.evidence, vec![]);
        assert!(lab.adopt_owner_entry_base(phone, snapshot, entry, sealed.clone()));
        let mark = lab.submit(mac, &[owner], Action::Mark { vault, entry, caps: Some(vec![]), wants: None, keep: vec![], via: vec![] }).unwrap();
        let signed = lab.backup(mac).signed().iter().find(|s| s.edit.id() == mark).unwrap().clone();
        lab.receive(phone, vec![signed], vec![]);
        let canonical = lab.held(phone).replay.state.slice_of(entry);
        assert!(!lab.held(phone).bootstrap_active.contains(&entry));
        assert!(!lab.adopt_owner_entry_base(phone, snapshot, entry, sealed));
        assert_eq!(lab.held(phone).view().slice_of(entry), canonical, "historical stays/seals cannot overwrite the current policy");
    }

    #[test]
    fn owner_bootstrap_store_writes_reopens_and_converges_concurrent_suffixes() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let pad = lab.device_of(owner, "Pad");
        let vault = human_on(&mut lab, owner, &[mac, phone, pad]);
        let entry = lab
            .create(mac, vault, vault, "note", &[], document("Base", "old", mac))
            .unwrap();
        lab.sync(mac, phone);
        lab.sync(mac, pad);
        lab.edit(mac, vault, entry, |item| item.set_text(2, "checkpoint"))
            .unwrap();
        let PreparedEntryBase { draft, sealed, .. } =
            lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
        let snapshot = lab.complete(mac, draft, &[]).unwrap();
        for device in [phone, pad] {
            let offer = lab.entry_projection_offer(mac, device, entry).unwrap();
            lab.receive(device, offer.evidence, vec![]);
            assert!(lab.adopt_owner_entry_base(device, snapshot, entry, sealed.clone()));
            assert_eq!(
                lab.item(device, entry).unwrap().record(),
                lab.item(mac, entry).unwrap().record()
            );
        }
        let a = lab
            .edit(phone, vault, entry, |item| item.set_text(2, "phone suffix"))
            .unwrap();
        let b = lab
            .edit(pad, vault, entry, |item| {
                item.edit_document(|d| d.title = "pad suffix".into());
            })
            .unwrap();
        let signed_a = lab
            .backup(phone)
            .signed()
            .iter()
            .find(|s| s.edit.id() == a)
            .unwrap()
            .clone();
        let signed_b = lab
            .backup(pad)
            .signed()
            .iter()
            .find(|s| s.edit.id() == b)
            .unwrap()
            .clone();
        lab.receive(phone, vec![signed_b.clone(), signed_b.clone()], vec![]);
        lab.receive(pad, vec![signed_a.clone()], vec![]);
        lab.receive(mac, vec![signed_b, signed_a], vec![]);
        let expected = lab.item(mac, entry).unwrap().record();
        assert_eq!(lab.item(phone, entry).unwrap().record(), expected);
        assert_eq!(lab.item(pad, entry).unwrap().record(), expected);
        // Recreate from serialized ciphertext anchors plus the ordinary signed suffix.
        let saved = lab.backup(phone);
        let bytes = saved.bootstrap_bytes();
        let disk = Backup::new(saved.signed().to_vec(), saved.blobs.values().cloned())
            .with_bootstrap_bytes(&bytes)
            .unwrap();
        let missing_suffix: Vec<_> = saved
            .signed()
            .iter()
            .filter(|s| s.edit.id() != a)
            .cloned()
            .collect();
        assert!(
            Backup::new(missing_suffix, saved.blobs.values().cloned())
                .with_bootstrap_bytes(&bytes)
                .is_none(),
            "torn baseline/log pair refuses recovery"
        );
        lab.restore_backup(phone, &disk);
        assert_eq!(lab.item(phone, entry).unwrap().record(), expected);
        assert!(lab.held(phone).bootstrap_active.contains(&entry));
        let c = lab
            .edit(phone, vault, entry, |item| item.set_text(2, "after crash"))
            .unwrap();
        let signed = lab
            .backup(phone)
            .signed()
            .iter()
            .find(|s| s.edit.id() == c)
            .unwrap()
            .clone();
        lab.receive(mac, vec![signed], vec![]);
        assert_eq!(
            lab.item(phone, entry).unwrap().record(),
            lab.item(mac, entry).unwrap().record()
        );
        let revoke = lab
            .submit(
                mac,
                &[owner],
                Action::Revoke(crate::policy::Revoking::Device {
                    vault,
                    device: phone,
                    keep: vec![],
                }),
            )
            .unwrap();
        let removal = lab
            .backup(mac)
            .signed()
            .iter()
            .find(|s| s.edit.id() == revoke)
            .unwrap()
            .clone();
        lab.receive(phone, vec![removal], vec![]);
        assert!(!lab.held(phone).bootstrap_active.contains(&entry));
        assert!(
            lab.edit(phone, vault, entry, |item| item.set_text(2, "forbidden"))
                .is_err()
        );
        let mut bad = bytes.clone();
        bad.push(0);
        assert!(
            Backup::new(vec![], vec![])
                .with_bootstrap_bytes(&bad)
                .is_none()
        );
        assert!(
            Backup::new(vec![], vec![])
                .with_bootstrap_bytes(&bytes[..bytes.len() - 1])
                .is_none()
        );
    }
}
