//! Exact dependency repair is a subset of ordinary authorized disclosure.
use super::*;
impl Lab {
    /// Current-authorized retained entries waiting for a key, not for ciphertext.
    /// These hints only reorder existing ordinary log requests.
    pub fn owner_base_key_waits(&self, on: SignerId) -> Vec<EntryId> {
        if self.locked(on) { return vec![]; }
        self.held(on).bootstrap_bases.keys().copied()
            .filter(|entry| self.owner_base_wait_reason(on, *entry) == Some("missing-entry-key"))
            .collect()
    }

    pub fn owner_base_dependency_reply(
        &self,
        me: SignerId,
        requester: SignerId,
        entry: EntryId,
        ids: &[EditId],
    ) -> Option<crate::wire::Reply> {
        if ids.is_empty() || ids.len() > 32 {
            return None;
        }
        let store = self.held(me);
        if store.replayed != store.log.edits().len() {
            return None;
        }
        let state = self.latest(me);
        let en = state.entry(entry)?;
        let audience = KeyFam::Audience(en.vault, en.audience());
        let opens = state.opens(&[KeyName::Signer(requester)]);
        if !(state.public_key(audience) || state.entitled(requester, audience))
            || !opens.contains(&state.current(audience))
            || !state
                .entry_key(entry)
                .is_some_and(|key| opens.contains(&key))
            || !state.wants(requester, en)
        {
            return None;
        }
        let wanted: HashSet<_> = ids.iter().copied().collect();
        let mut edits = Vec::new();
        let mut size = 0usize;
        for &i in self.answered(me, requester, &[]).iter() {
            let id = store.log.ids()[i];
            if !wanted.contains(&id)
                || !matches!(store.log.edits()[i].action,Action::Write{entry:e,..}if e==entry)
            {
                continue;
            }
            let signed = store.signed.get(&id)?;
            if !entry_projection::bounded_offer_edit(signed) {
                continue;
            }
            let n = signed.to_wire().len();
            if size + n > 480 << 10 {
                break;
            }
            size += n;
            edits.push(signed.clone());
        }
        Some(crate::wire::Reply {
            edits,
            blobs: Vec::new(),
            more: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast::{document, human_on};
    #[test]
    fn dependency_reply_is_scoped_and_current_authorized() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let stranger = lab.device("stranger");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let entry = lab
            .create(mac, vault, vault, "note", &[], document("A", "old", mac))
            .unwrap();
        let wanted = lab
            .edit(mac, vault, entry, |i| i.set_text(2, "needed"))
            .unwrap();
        let other = lab
            .create(
                mac,
                vault,
                vault,
                "note",
                &[],
                document("B", "unrelated", mac),
            )
            .unwrap();
        let other_id = lab.history(mac, other).unwrap().heads(MAIN)[0];
        let reply = lab
            .owner_base_dependency_reply(mac, phone, entry, &[wanted, other_id])
            .unwrap();
        assert_eq!(
            reply.edits.iter().map(|s| s.edit.id()).collect::<Vec<_>>(),
            vec![wanted]
        );
        assert!(
            lab.owner_base_dependency_reply(mac, stranger, entry, &[wanted])
                .is_none()
        );
        assert!(
            lab.owner_base_dependency_reply(mac, phone, entry, &vec![wanted; 33])
                .is_none()
        );
        lab.submit(
            mac,
            &[owner],
            Action::Revoke(crate::policy::Revoking::Device {
                vault,
                device: phone,
                keep: vec![],
            }),
        )
        .unwrap();
        assert!(
            lab.owner_base_dependency_reply(mac, phone, entry, &[wanted])
                .is_none()
        );
    }
}
