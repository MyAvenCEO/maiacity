//! Exact signed-write Entry-key capsules. Validation alone does not activate writes.
//! Only an ordinary-authorized exact Entry key travels, never a key family.
use super::*;
const KEY_CAPSULE: &[u8] = b"avenDB exact entry key recovery 1\n";
#[derive(Clone)]
pub struct EntryKeyRecovery {
    pub edit: EditId,
    pub recipient: SignerId,
    pub bytes: Vec<u8>,
}
fn recovery_context(edit: EditId, recipient: SignerId) -> Vec<u8> {
    let mut out=KEY_CAPSULE.to_vec(); edit.encode(&mut out); recipient.encode(&mut out); out
}
impl Lab {
    pub fn entry_key_recovery(&mut self,me:SignerId,recipient:SignerId,edit:EditId)->Option<EntryKeyRecovery> {
        let store=self.held(me);
        if store.replayed!=store.log.edits().len() { return None; }
        let state=&store.replay.state;
        let write=state.write(edit)?;
        let entry=state.entry(write.entry)?;
        let family=KeyFam::Audience(entry.vault,entry.audience());
        if !(state.public_key(family)||state.entitled(me,family))
            || !(state.public_key(family)||state.entitled(recipient,family))
            || !state.wants(recipient,entry) { return None; }
        let name=write.key();
        if !state.opens(&[KeyName::Signer(me)]).contains(&name)
            || !state.opens(&[KeyName::Signer(recipient)]).contains(&name) { return None; }
        let answered=self.answered(me,recipient,&[]);
        if !answered.iter().any(|&i|store.log.ids()[i]==edit) { return None; }
        let signed=store.signed.get(&edit)?;
        let Action::Write{body,..}=&signed.edit.action else { return None; };
        let key=store.keys.get(&keys::edit_key(body)?,name)?.clone();
        // Root binding is to the complete original Signed edit ID, not a caller's
        // description of entry/stay/epoch or an unverified ciphertext blob.
        let pk=state.seal_key(recipient)?.clone();
        let public=store.blobs.get(&pk.mceliece)?.clone();
        if BlobId::of(&public)!=pk.mceliece { return None; }
        let bytes=keys::seal(&key,&pk,&public,&recovery_context(edit,recipient),&mut self.rng)?;
        if bytes.len()>4096 { return None; }
        Some(EntryKeyRecovery{edit,recipient,bytes})
    }
    /// Decode only; durable retention and ordinary canonical replay must precede activation.
    pub(super) fn verified_entry_key_recovery(&self,on:SignerId,capsule:&EntryKeyRecovery)->Option<(KeyName,Secret)> {
        let recover=||->Option<(KeyName,Secret)> {
            if capsule.recipient!=on || capsule.bytes.len()>4096 { return None; }
            let store=self.held(on);
            if store.replayed!=store.log.edits().len() { return None; }
            let state=&store.replay.state;
            let signed=store.signed.get(&capsule.edit)?;
            if signed.verify().is_err() { return None; }
            // The signed body was already admitted by canonical replay. Calling
            // accepted_write again would correctly reject it as Duplicate.
            let write=state.write(capsule.edit)?;
            if !state.authorized(write) || !store.replay.standing().contains(&capsule.edit) { return None; }
            let entry=state.entry(write.entry)?;
            let family=KeyFam::Audience(entry.vault,entry.audience());
            if !(state.public_key(family)||state.entitled(on,family)) || !state.wants(on,entry) { return None; }
            let Action::Write{body,..}=&signed.edit.action else { return None; };
            let own=self.keys.get(&on)?.seal_secret()?;
            let key=keys::open(&capsule.bytes,&own,&recovery_context(capsule.edit,on))?;
            if keys::edit_key(body)?!=key.id() { return None; }
            let clear=Zeroizing::new(keys::open_edit(&key,body,&write_context(&signed.edit))?);
            Body::from_wire(&clear).ok()?;
            Some((write.key(),key))
        };
        recover()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast::{document, human_on};
    use crate::policy::{Level, Who, Revoking};
    #[test]
    fn exact_entry_recovery_checks_signed_scope_and_current_revocation() {
        let mut lab=Lab::new();
        let owner=lab.passkey("Owner"); let mac=lab.device_of(owner,"Mac");
        let vault=human_on(&mut lab,owner,&[mac]);
        let guest=lab.passkey("Guest"); let phone=lab.device_of(guest,"Phone");
        let guest_vault=human_on(&mut lab,guest,&[phone]);
        lab.share_contact(mac,phone,vault); lab.share_contact(phone,mac,guest_vault);
        let share=lab.issue(mac,&[owner],crate::cast::share(vault,Who::Vault(guest_vault),Level::Read,crate::cast::of_type("note"))).unwrap();
        lab.sync(mac,phone);
        let hidden=lab.create_in(mac,vault,vault,vec![share],"private-other",&[],document("Private","hidden",mac)).unwrap();
        let hidden_write=lab.edit(mac,vault,hidden,|i|i.set_text(2,"Private update")).unwrap();
        let entry=lab.create_in(mac,vault,vault,vec![share],"note",&[],document("Note","old",mac)).unwrap();
        lab.sync(mac,phone);
        let edit=lab.edit(mac,vault,entry,|i|i.set_text(2,"New")).unwrap();
        let capsule=lab.entry_key_recovery(mac,phone,edit).unwrap();
        assert!(lab.entry_key_recovery(mac,phone,hidden_write).is_none());
        assert!(lab.verified_entry_key_recovery(phone,&capsule).is_none(),"exact signed body must be held");
        lab.receive(phone,vec![lab.signed_edit(mac,edit).unwrap().clone()],vec![]);
        let epochs=lab.latest(phone).epochs().collect::<Vec<_>>();
        let keys=lab.held(phone).keys.by_name.clone();
        let (name,key)=lab.verified_entry_key_recovery(phone,&capsule).unwrap();
        assert_eq!(name,lab.latest(mac).write(edit).unwrap().key());
        let Action::Write{body,..}=&lab.signed_edit(mac,edit).unwrap().edit.action else {panic!("write")};
        assert_eq!(key.id(),keys::edit_key(body).unwrap());
        assert_eq!(lab.latest(phone).epochs().collect::<Vec<_>>(),epochs);
        assert_eq!(lab.held(phone).keys.by_name,keys,"validation does not import keys or enable writes");
        let mut wrong=capsule.clone(); wrong.edit=hidden_write;
        assert!(lab.verified_entry_key_recovery(phone,&wrong).is_none());
        let mut wrong=capsule.clone(); wrong.recipient=mac;
        assert!(lab.verified_entry_key_recovery(phone,&wrong).is_none());
        let mut wrong=capsule.clone(); wrong.bytes[0]^=1;
        assert!(lab.verified_entry_key_recovery(phone,&wrong).is_none());
        let pk=lab.latest(mac).seal_key(phone).unwrap().clone();
        let public=lab.held(mac).blobs[&pk.mceliece].clone();
        let unrelated=Secret::generate(&mut lab.rng);
        let wrong=EntryKeyRecovery{edit,recipient:phone,bytes:keys::seal(&unrelated,&pk,&public,&recovery_context(edit,phone),&mut lab.rng).unwrap()};
        assert!(lab.verified_entry_key_recovery(phone,&wrong).is_none(),"valid recipient box cannot substitute the original write key");

        let revoked=lab.submit(mac,&[owner],Action::Revoke(Revoking::Grant{share,actor:vault,keep:vec![],via:vec![]})).unwrap();
        lab.receive(phone,vec![lab.signed_edit(mac,revoked).unwrap().clone()],vec![]);
        assert!(lab.entry_key_recovery(mac,phone,edit).is_none());
        assert!(lab.verified_entry_key_recovery(phone,&capsule).is_none());
        let rotated=lab.edit(mac,vault,entry,|i|i.set_text(2,"After revoke")).unwrap();
        assert!(lab.entry_key_recovery(mac,phone,rotated).is_none(),"revoked recipient gets no new key");
        lab.issue(mac,&[owner],crate::cast::share(vault,Who::Vault(guest_vault),Level::Read,crate::cast::of_type("note"))).unwrap();
        lab.mark_now(mac,entry).unwrap();
        lab.sync(mac,phone);
        // T24 current entry readers regain this entry's history, but never the
        // excluded entry's audience key or a blanket authorization interval.
        let regranted=lab.entry_key_recovery(mac,phone,rotated).expect("new canonical grant reaches exact history key");
        assert!(lab.verified_entry_key_recovery(phone,&regranted).is_some());
        assert!(lab.entry_key_recovery(mac,phone,hidden_write).is_none());
    }
}

const RETAINED: &[u8] = b"avenDB retained exact entry recovery 1\n";
const MAX_RECOVERIES: usize = 32;
pub(super) fn is_retained(bytes:&[u8])->bool { bytes.starts_with(RETAINED) }
pub(super) fn retained_parts(bytes:&[u8])->Option<(Vec<u8>,Vec<EntryKeyRecovery>)> {
    if bytes.len()>MAX_BYTES+128 { return None; }
    let mut r=WireReader::new(bytes);
    if r.take(RETAINED.len()).ok()?!=RETAINED { return None; }
    let base=r.bytes().ok()?;
    if is_retained(&base) { return None; }
    capsule::local_parts(&base)?;
    let count=u64::decode(&mut r).ok()?;
    if count==0 || count>MAX_RECOVERIES as u64 { return None; }
    let mut recoveries=Vec::new(); let mut seen=HashSet::new();
    for _ in 0..count {
        let edit=EditId::decode(&mut r).ok()?;
        let recipient=SignerId::decode(&mut r).ok()?;
        let bytes=r.bytes().ok()?;
        if bytes.len()>4096 || !seen.insert(edit) { return None; }
        recoveries.push(EntryKeyRecovery{edit,recipient,bytes});
    }
    r.done().then_some((base,recoveries))
}
impl Lab {
    /// Retain only recipient ciphertext in the existing atomic encrypted anchor
    /// companion. A changed bootstrap stamp wakes the saver; ordinary write gates
    /// continue to require its durable receipt.
    pub fn retain_entry_key_recovery(&mut self,on:SignerId,entry:EntryId,recovery:EntryKeyRecovery)->bool {
        let Some((name,_))=self.verified_entry_key_recovery(on,&recovery) else{return false;};
        if !matches!(name,KeyName::Entry(e,_,_) if e==entry) {return false;}
        let Some((snapshot,bytes))=self.held(on).bootstrap_bases.get(&entry).cloned() else{return false;};
        if self.projection_entitlement(on,snapshot,entry).is_none() {return false;}
        let (base,mut keys)=if is_retained(&bytes) {
            let Some(parts)=retained_parts(&bytes) else{return false;}; parts
        } else {
            if capsule::local_parts(&bytes).is_none() {return false;} (bytes,Vec::new())
        };
        if let Some(old)=keys.iter_mut().find(|key|key.edit==recovery.edit) {*old=recovery;}
        else {if keys.len()>=MAX_RECOVERIES{return false;} keys.push(recovery);}
        let mut bytes=RETAINED.to_vec(); base.encode(&mut bytes); (keys.len() as u64).encode(&mut bytes);
        for key in keys {key.edit.encode(&mut bytes);key.recipient.encode(&mut bytes);key.bytes.encode(&mut bytes);}
        if bytes.len()>MAX_BYTES+128 {return false;}
        let at=self.at(on);let store=self.stores.get_mut(&at).expect("device");
        store.bootstrap_bases.insert(entry,(snapshot,bytes));
        store.bootstrap_revision=Arc::new(());store.bootstrap_basis=None;
        self.refresh(on,&[]);
        true
    }
    // Reopened ciphertext is not trusted merely because the local shelf kept it.
    // Revalidate current policy and original signed writes before every import.
    pub(super) fn restore_retained_entry_keys(&mut self,on:SignerId)->bool {
        let verified:Vec<_>=self.held(on).bootstrap_bases.iter().filter_map(|(entry,(snapshot,bytes))| {
            self.projection_entitlement(on,*snapshot,*entry)?;
            let (_,keys)=retained_parts(bytes)?;
            let mut out=Vec::new();
            for key in keys {
                let (name,secret)=self.verified_entry_key_recovery(on,&key)?;
                if !matches!(name,KeyName::Entry(e,_,_) if e==*entry) {return None;}
                out.push((name,secret));
            }
            Some(out)
        }).flatten().collect();
        let at=self.at(on);let store=self.stores.get_mut(&at).expect("device");
        let mut changed=false;
        for (name,key) in verified {changed|=store.keys.insert(name,key);}
        changed
    }
    pub(super) fn recovered_capsule_frontier(&self,on:SignerId,entry:EntryId)->bool {
        let Some((snapshot,bytes))=self.held(on).bootstrap_bases.get(&entry) else{return false;};
        let Some((_,stated,_))=self.projection_entitlement(on,*snapshot,entry) else{return false;};
        let Some((_,keys))=retained_parts(bytes) else{return false;};
        !stated.basis.is_empty() && stated.basis.iter().all(|id| keys.iter().any(|k| {
            k.edit==*id && self.verified_entry_key_recovery(on,k).is_some_and(|(name,_)|matches!(name,KeyName::Entry(e,_,_) if e==entry))
        }))
    }
}
