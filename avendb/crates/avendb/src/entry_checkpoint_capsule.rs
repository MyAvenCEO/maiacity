//! Explicit checkpoint-only decryption capabilities. No ordinary Keyring insertion,
//! remote epoch adoption, or change to canonical authorization/history.
use super::*;

const FORMAT: &[u8] = b"avenDB judged checkpoint capsule 1\n";
const MAX_CAPSULE: usize = 4096;
#[derive(Clone)]
pub struct EntryCheckpointCapsule {
    pub recipient: SignerId,
    pub bytes: Vec<u8>,
}
fn context(vault: VaultId, entry: EntryId) -> Vec<u8> {
    let mut out = FORMAT.to_vec(); vault.encode(&mut out); entry.encode(&mut out); out
}
fn recipient_context(vault: VaultId, entry: EntryId, root: FileRoot, recipient: SignerId) -> Vec<u8> {
    let mut out = context(vault, entry);
    root.hash.to_vec().encode(&mut out); root.size.encode(&mut out); recipient.encode(&mut out); out
}
fn parts(bytes: &[u8], vault: VaultId, entry: EntryId) -> Option<(Vec<u8>,Vec<u8>)> {
    if bytes.len() > MAX_BYTES + 128 { return None; }
    let mut r=WireReader::new(bytes); let prefix=context(vault,entry);
    if r.take(prefix.len()).ok()? != prefix { return None; }
    let recovery=r.bytes().ok()?; let payload=r.bytes().ok()?;
    if recovery.len()>MAX_CAPSULE || !r.done() { return None; }
    Some((recovery,payload))
}
impl Lab {
    /// Explicit owner publication of a new format. The fresh key opens only this
    /// root; its recovery wrapper is for existing holders, never sent as a secret.
    pub fn draft_capsuled_entry_base(&mut self,on:SignerId,signers:&[SignerId],entry:EntryId)->Result<PreparedEntryBase,Refusal> {
        let old=self.draft_judged_entry_base(on,signers,entry)?;
        let Action::Snapshot{vault,states}=old.draft.edit.action else { return Err(Refusal::NotAccepted); };
        let name=self.latest(on).entry_key(entry).ok_or(Refusal::NoCap)?;
        let key=self.held(on).keys.get(&keys::edit_key(&old.sealed).ok_or(Refusal::NotAccepted)?,name).ok_or(Refusal::NoCap)?.clone();
        let plain=keys::open_edit(&key,&old.sealed,&judgment_context(vault,entry)).ok_or(Refusal::NotAccepted)?;
        let data=Secret::generate(&mut self.rng);
        let ctx=context(vault,entry);
        let recovery=keys::seal_edit(&key,&data.bytes(),&ctx,&mut self.rng);
        let payload=keys::seal_edit(&data,&plain,&ctx,&mut self.rng);
        let mut sealed=ctx; recovery.encode(&mut sealed); payload.encode(&mut sealed);
        if sealed.len()>MAX_BYTES+128 { return Err(Refusal::NotAccepted); }
        let root=FileRoot{hash:crate::hash::content(&sealed),size:sealed.len() as u64};
        let draft=self.draft(on,signers,Action::Snapshot{vault,states:vec![crate::policy::Stated{entry,basis:states[0].basis.clone(),slice:root}]})?;
        Ok(PreparedEntryBase{draft,sealed,root})
    }
    /// All peers use the same current recipient policy. The response exposes no
    /// audience/history key and is bound to the approved ciphertext and recipient.
    pub fn entry_checkpoint_capsule(&mut self,me:SignerId,recipient:SignerId,snapshot:EditId,entry:EntryId,sealed:&[u8])->Option<EntryCheckpointCapsule> {
        let offer=self.entry_projection_offer_for_root(me,recipient,entry,None,crate::hash::content(sealed))?;
        if offer.snapshot!=snapshot || offer.root.size!=sealed.len() as u64 { return None; }
        let (vault,stated,name)=self.projection_authority(me,snapshot,entry)?;
        let root=stated.slice;
        let (recovery,_)=parts(sealed,vault,entry)?;
        let key=self.held(me).keys.get(&keys::edit_key(&recovery)?,name)?;
        let raw=Zeroizing::new(keys::open_edit(key,&recovery,&context(vault,entry))?);
        let data=Secret::from_bytes(raw.as_slice().try_into().ok()?);
        let pk=self.latest(me).seal_key(recipient)?.clone();
        let blob=self.held(me).blobs.get(&pk.mceliece)?.clone();
        if BlobId::of(&blob)!=pk.mceliece { return None; }
        let bytes=keys::seal(&data,&pk,&blob,&recipient_context(vault,entry,root,recipient),&mut self.rng)?;
        if bytes.len()>MAX_CAPSULE { return None; }
        Some(EntryCheckpointCapsule{recipient,bytes})
    }
    /// Validates useful state without mutating policy, ordinary keys, or Store.
    /// Durable adoption and negotiated transport are separate required stages.
    pub fn restore_capsuled_owner_judgment(&self,on:SignerId,snapshot:EditId,entry:EntryId,sealed:&[u8],capsule:&EntryCheckpointCapsule)->Option<RestoredOwnerJudgment> {
        if capsule.recipient!=on || capsule.bytes.len()>MAX_CAPSULE { return None; }
        let (vault,stated,_)=self.projection_entitlement(on,snapshot,entry)?;
        if stated.slice.size!=sealed.len() as u64 || stated.slice.hash!=crate::hash::content(sealed) { return None; }
        let (_,payload)=parts(sealed,vault,entry)?;
        let own=self.keys.get(&on)?.seal_secret()?;
        let key=keys::open(&capsule.bytes,&own,&recipient_context(vault,entry,stated.slice,on))?;
        let plain=keys::open_edit(&key,&payload,&context(vault,entry))?;
        self.decode_owner_judgment_plain(on,entry,vault,stated,&plain,true)
    }
}
