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
            let store=self.held(on); let state=&store.replay.state;
            let signed=store.signed.get(&capsule.edit)?;
            if signed.verify().is_err() { return None; }
            let write=state.accepted_write(&signed.edit,capsule.edit).ok()??;
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
        let revoked=lab.submit(mac,&[owner],Action::Revoke(Revoking::Grant{share,actor:vault,keep:vec![],via:vec![]})).unwrap();
        lab.receive(phone,vec![lab.signed_edit(mac,revoked).unwrap().clone()],vec![]);
        assert!(lab.entry_key_recovery(mac,phone,edit).is_none());
        assert!(lab.verified_entry_key_recovery(phone,&capsule).is_none());
    }
}
