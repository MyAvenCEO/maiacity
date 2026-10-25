//! An owner's exhaustive scoped statement at an explicitly accepted cut.
//! It is not an assertion that unknown peers have no newer state. Ordinary
//! entry/manifest authorization and canonical owner Snapshot approval apply.
use super::*;
use serde_json::json;

const KIND: &str = "discovery-manifest";
const MAX_MEMBERS: usize = 512;
const MAX_HEADS: usize = 64;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DiscoveryScope { Types(Vec<String>), Tag(String) }
impl DiscoveryScope {
    pub fn normalized(self) -> Option<Self> {
        match self {
            Self::Types(mut types) => {
                if types.is_empty() || types.len()>8 || types.iter().any(|t|t.is_empty()||t.len()>256) {return None;}
                types.sort(); types.dedup(); Some(Self::Types(types))
            }
            Self::Tag(tag) if !tag.is_empty() && tag.len()<=256 => Some(Self::Tag(tag)),
            _ => None,
        }
    }
    fn json(&self) -> Value { match self { Self::Types(types)=>json!({"types":types}), Self::Tag(tag)=>json!({"tag":tag}) } }
    fn matches(&self, lab:&Lab, on:SignerId, entry:EntryId)->Option<bool> {
        match self {
            Self::Types(types)=>{ let kind=lab.entry_type_hint(on,entry)?; Some(types.iter().any(|t|t==kind)) },
            Self::Tag(tag)=>lab.entry_tag_hint(on,entry,tag),
        }
    }
}

fn manifest_readable(st:&crate::policy::State,actor:VaultId,entry:&crate::policy::Entry)->bool {
    st.public_key(KeyFam::Audience(entry.vault,entry.audience()))
        || crate::world::levels(st,entry.vault,entry.audience()).iter().any(|(who,level)|*who==actor&&level.allows(Level::Read))
}

/// An encrypted creation held only in memory until its owner ceremony succeeds.
/// Fields are private so callers cannot substitute the payload or disclosure assumptions.
pub struct PreparedDiscoveryManifest {
    draft: Unsigned,
    on: SignerId,
    owner: SignerId,
    vault: VaultId,
    entry: EntryId,
    header: Header,
    audience: Vec<ShareId>,
    scope: DiscoveryScope,
    record: Value,
}
impl PreparedDiscoveryManifest {
    pub fn challenge(&self) -> [u8; 32] { self.draft.challenge() }
    pub fn owner(&self) -> SignerId { self.owner }
}

impl Lab {
    fn manifest_disclosure_safe(&self,on:SignerId,vault:VaultId,attrs:&Attrs,record:&Value)->bool {
        let st=self.state(on);
        let Some(members)=record.get("members").and_then(Value::as_array) else {return false;};
        st.shares_over(vault).filter(|issued|st.live(issued.id)&&issued.share.level.allows(Level::Read)).all(|issued| {
            // Checking every live share also covers delegation chains conservatively:
            // a child whose parent excludes the carrier may be over-restricted, never leaked.
            let Some(slice)=self.slice(on,issued.id) else {return false;};
            if !issued.share.wide && !slice.select.matches(attrs) {return true;}
            members.iter().all(|row| {
                let Some(entry)=row.get("entry").and_then(Value::as_str).and_then(EntryId::from_hex).and_then(|id|st.entry(id)) else {return false;};
                match issued.share.who {
                    Who::Vault(actor)=>manifest_readable(st,actor,entry),
                    Who::Everyone=>st.public_key(KeyFam::Audience(entry.vault,entry.audience())),
                    // Device/invite disclosure needs a separately proved audience relationship.
                    // Do not infer it from this device possessing the cleartext.
                    Who::Device(device)=>st.acts_for(device,issued.share.issuer) && manifest_readable(st,issued.share.issuer,entry),
                    Who::Invite(_)=>false,
                }
            })
        })
    }

    pub fn prepare_discovery_manifest(&mut self,on:SignerId,owner:SignerId,vault:VaultId,scope:DiscoveryScope)->Result<PreparedDiscoveryManifest,Refusal> {
        self.unlocked(on)?;
        if !self.state(on).approves(&[owner],Principal::Vault(vault)) {return Err(Refusal::BelowThreshold);}
        let scope=scope.normalized().ok_or(Refusal::NotAccepted)?;
        let record=self.discovery_manifest_record(on,vault,scope.clone()).ok_or(Refusal::NotAccepted)?;
        let (entry,nonce)=self.new_entry_id(on,vault);
        let header=Header{ty:Sym::new("discovery-manifest"),created:self.now};
        let attrs=Attrs{ty:header.ty.clone(),author:vault,entry,created:header.created,tags:vec![]};
        if !self.manifest_disclosure_safe(on,vault,&attrs,&record) {return Err(Refusal::NotAllowed);}
        let audience=self.intake(on,vault,vault,entry,&header,&[],true)?;
        let view=self.latest(on).clone();
        let x=AudienceId::of(vault,&audience);
        let epoch=view.epoch(KeyFam::Audience(vault,x))+view.reenters(vault,x) as u64;
        let action=Action::Write{vault,entry,actor:vault,stay:None,epoch,deps:vec![],proposal:Proposal::Main,via:vec![],
            create:Some(Creation{audience:audience.clone(),nonce}),files:vec![],body:vec![]};
        // The device authors the CRDT update, with the owner co-signing its exact ciphertext.
        let mut edit=self.held(on).log.draft_on(&view,on,&[owner],action);
        let w=view.accepted_write(&edit,edit.id())?.ok_or(Refusal::NotAccepted)?;
        let item=Item::made(&crate::lens::View::plain(&crate::lens::DISCOVERY_MANIFEST_V1),&record,on).ok_or(Refusal::NotAView)?;
        let content=item.export(&Version::default());
        let tags=TagDelta::default();
        let proof=self.proven(on,&view,(vault,&History::default()),&w,(&content,&tags),&[],Some(&attrs))?;
        let body=Body{header:Some(header.clone()),tags,answers:vec![],content,proof,files:vec![],defines:None};
        let at=self.at(on);
        let Lab{stores,rng,..}=self;
        let key=entry_key_for(stores.get_mut(&at).expect("device"),rng,vault,x,entry,None,epoch);
        let sealed=keys::seal_edit(&key,&body.to_wire(),&write_context(&edit),rng);
        if let Action::Write{body,..}=&mut edit.action {*body=sealed;}
        let draft=Unsigned{edit,blobs:Blobs::new(),held:self.held(on).log.ids().len(),batch:vec![],pass:None};
        Ok(PreparedDiscoveryManifest{draft,on,owner,vault,entry,header,audience,scope,record})
    }

    pub fn complete_discovery_manifest(&mut self,on:SignerId,prepared:PreparedDiscoveryManifest,ceremonies:&[(SignerId,&Ceremony)])->Result<EntryId,Refusal> {
        self.unlocked(on)?;
        let p=&prepared;
        if p.on!=on || !self.state(on).approves(&[p.owner],Principal::Vault(p.vault))
            || self.discovery_manifest_record(on,p.vault,p.scope.clone()).as_ref()!=Some(&p.record) {
            return Err(Refusal::NotAccepted);
        }
        let attrs=Attrs{ty:p.header.ty.clone(),author:p.vault,entry:p.entry,created:p.header.created,tags:vec![]};
        if !self.manifest_disclosure_safe(on,p.vault,&attrs,&p.record)
            || self.intake(on,p.vault,p.vault,p.entry,&p.header,&[],true)?!=p.audience {return Err(Refusal::NotAllowed);}
        let entry=p.entry;
        self.complete(on,prepared.draft,ceremonies)?;
        Ok(entry)
    }
}

/// Publication is an explicitly owner-cosigned carrier write followed by the
/// existing owner-approved checkpoint Snapshot. This builder mutates no data.
impl Lab {
    pub fn discovery_manifest_record(&self,on:SignerId,vault:VaultId,scope:DiscoveryScope)->Option<Value> {
        let scope=scope.normalized()?;
        let store=self.held(on);
        if !self.local_inventory_replayed(on) || !store.view().acts_for(on,vault) {return None;}
        let mut members=Vec::new();
        let mut total_heads=0usize;
        for entry in store.view().entries().iter().filter(|entry|entry.vault==vault) {
            // Publication never treats unknown headers/tags as an absent match.
            if !scope.matches(self,on,entry.id)? || !self.landed(on,entry.id) {continue;}
            if !self.reads(on,entry.id) || members.len()==MAX_MEMBERS {return None;}
            let mut heads=self.history(on,entry.id)?.heads(MAIN);
            heads.sort();heads.dedup();
            if heads.is_empty()||heads.len()>MAX_HEADS {return None;}
            total_heads+=heads.len(); if total_heads>4096 {return None;}
            members.push((entry.id,heads));
        }
        members.sort_by_key(|(entry,_)|*entry);
        Some(json!({"kind":KIND,"vault":vault.to_hex(),"scope":scope.json(),
            "members":members.into_iter().map(|(entry,heads)|json!({"entry":entry.to_hex(),"heads":heads.iter().map(EditId::to_hex).collect::<Vec<_>>()})).collect::<Vec<_>>(),
            "completeAtOwnerCut":true,"remoteComplete":false}))
    }

    /// Select only already authenticated, currently authorized exact-scope cuts.
    /// This is a scheduling aid; it does not replace current local query rows or
    /// opt a caller into historical negative evidence.
    pub fn automatic_discovery_hint(&self,on:SignerId,actor:VaultId,vault:VaultId,scope:DiscoveryScope)->Option<Value> {
        self.automatic_discovery_hint_for_rows(on,actor,vault,scope,&[])
    }

    pub fn automatic_discovery_hint_for_rows(&self,on:SignerId,actor:VaultId,vault:VaultId,scope:DiscoveryScope,visible:&[EntryId])->Option<Value> {
        let scope=scope.normalized()?;
        let store=self.held(on);
        let mut carriers:Vec<_>=store.projections.lock().ok()?.keys()
            .filter(|(device,_)|*device==on).map(|(_,entry)|*entry).collect();
        carriers.extend(store.bootstrap_bases.keys().copied());
        carriers.extend(store.attested_manifests.lock().ok()?.keys().filter(|(device,_)|*device==on).map(|(_,entry)|*entry));
        carriers.sort(); carriers.dedup();
        let mut snapshots:HashMap<EditId,Vec<EntryId>>=HashMap::new();
        for carrier in carriers {
            let retained=self.retained_projection_hint(on,carrier).or_else(||store.attested_manifests.lock().ok()?.get(&(on,carrier)).map(|row|row.0));
            if let Some(snapshot)=retained {
                snapshots.entry(snapshot).or_default().push(carrier);
            }
        }
        // Log depth is authenticated causal order: a later descendant publication
        // outranks its ancestor regardless of randomly generated carrier IDs.
        // Concurrent cuts have no objective "latest"; signed snapshot ID breaks
        // ties deterministically without claiming remote or wall-clock freshness.
        let mut candidates:Vec<_>=store.log.ids().iter().zip(store.log.edits()).flat_map(|(id,edit)|
            snapshots.get(id).into_iter().flatten().map(move|carrier|(edit.depth,*id,*carrier))).collect();
        candidates.sort();
        for (_,snapshot,carrier) in candidates.into_iter().rev() {
            let Some(rows)=self.discovery_manifest_rows(on,actor,vault,scope.clone(),carrier,snapshot) else {continue;};
            let targets:Vec<_>=rows.into_iter().filter_map(|(entry,heads)| {
                let covered=visible.contains(&entry) && self.materialized_manifest_heads(on,actor,entry,&heads);
                (!covered).then_some(entry)
            }).collect();
            return Some(json!({"basis":"owner-attested-cut","entry":carrier.to_hex(),"snapshot":snapshot.to_hex(),
                "scope":scope.json(),"pendingEntries":targets.iter().map(EntryId::to_hex).collect::<Vec<_>>(),
                "remoteComplete":false}));
        }
        None
    }

    /// Inspect current authorized accepted/imported metadata only. A visible old
    /// row is not evidence that the advertised updates reached its materialization.
    fn materialized_manifest_heads(&self,on:SignerId,actor:VaultId,entry:EntryId,heads:&[EditId])->bool {
        let store=self.held(on);
        let Some(en)=store.view().entry(entry) else {return false;};
        if !self.sees(on,entry) || !manifest_readable(store.view(),actor,en) {return false;}
        if self.projection_covers_manifest_heads(on,entry,heads) {return true;}
        let Some(shown)=store.shown.get(&entry) else {return false;};
        if !shown.items.get().is_some_and(|items|items.contains_key(&MAIN)) {return false;}
        let Some(imported)=shown.after.imported.get(&MAIN) else {return false;};
        heads.iter().all(|head|imported.contains(head)&&shown.history.get(*head).is_some_and(|change|change.counted))
    }

    /// IDs disclosed by the owner-approved carrier. These are scheduling hints,
    /// never per-entry read authority; unknown/revoked entries remain pending.
    pub fn discovery_manifest_targets(&self,on:SignerId,actor:VaultId,vault:VaultId,scope:DiscoveryScope,carrier:EntryId,snapshot:EditId)->Option<Vec<EntryId>> {
        Some(self.discovery_manifest_rows(on,actor,vault,scope,carrier,snapshot)?.into_iter().map(|(id,_)|id).collect())
    }

    pub(crate) fn remember_attested_manifest(&self,on:SignerId,snapshot:EditId,entry:EntryId,record:Value) {
        if record.get("kind").and_then(Value::as_str)!=Some(KIND) {return;}
        let Ok(bytes)=serde_json::to_vec(&record) else {return;};
        let size=bytes.len();
        if size>1<<20 {return;}
        let store=self.held(on);
        let Ok(mut cache)=store.attested_manifests.lock() else {return;};
        cache.remove(&(on,entry));
        while cache.len()>=16 || cache.values().map(|row|row.2).sum::<usize>()+size>4<<20 {
            let Some(key)=cache.keys().next().copied() else {return;}; cache.remove(&key);
        }
        cache.insert((on,entry),(snapshot,record,size));
    }

    fn attested_manifest_record(&self,on:SignerId,snapshot:EditId,carrier:EntryId)->Option<Value> {
        let store=self.held(on);
        if store.replayed!=store.log.edits().len() || !self.sees(on,carrier) {return None;}
        if let Some((at,record,_))=store.attested_manifests.lock().ok()?.get(&(on,carrier)) {
            if *at==snapshot {
                self.projection_entitlement(on,snapshot,carrier)?;
                return Some(record.clone());
            }
        }
        if let Some((at,sealed))=store.bootstrap_bases.get(&carrier) {
            if *at==snapshot {
                return self.restore_owner_judgment(on,snapshot,carrier,sealed)?.record(MAIN);
            }
        }
        self.attested_entry_projection(on,snapshot,carrier)?.record(MAIN)
    }

    fn discovery_manifest_rows(&self,on:SignerId,actor:VaultId,vault:VaultId,scope:DiscoveryScope,carrier:EntryId,snapshot:EditId)->Option<Vec<(EntryId,Vec<EditId>)>> {
        let scope=scope.normalized()?;
        // Read the signed cut itself, never the mutable overlay after suffix writes.
        let record=self.attested_manifest_record(on,snapshot,carrier)?;
        let object=record.as_object()?;
        if object.len()!=6 || object.keys().any(|key|!matches!(key.as_str(),"kind"|"vault"|"scope"|"members"|"completeAtOwnerCut"|"remoteComplete")) {return None;}
        if record.get("kind")?.as_str()?!=KIND || record.get("vault")?.as_str()?!=vault.to_hex()
            || record.get("scope")?!=&scope.json() || record.get("completeAtOwnerCut")?!=&Value::Bool(true)
            || record.get("remoteComplete")?!=&Value::Bool(false) {return None;}
        let st=self.state(on);
        let carrier_entry=st.entry(carrier)?;
        if carrier_entry.vault!=vault || !manifest_readable(st,actor,carrier_entry) {return None;}
        let rows=record.get("members")?.as_array()?;
        if rows.len()>MAX_MEMBERS {return None;}
        let mut decoded=Vec::with_capacity(rows.len());
        let mut total_heads=0usize;
        for row in rows {
            let row=row.as_object()?;
            if row.len()!=2 || row.keys().any(|key|key!="entry"&&key!="heads") {return None;}
            let id=EntryId::from_hex(row.get("entry")?.as_str()?)?;
            if decoded.last().is_some_and(|(prior,_)|*prior>=id) {return None;}
            let encoded=row.get("heads")?.as_array()?;
            if encoded.is_empty()||encoded.len()>MAX_HEADS {return None;}
            total_heads+=encoded.len(); if total_heads>4096 {return None;}
            let heads:Vec<_>=encoded.iter().map(|head|EditId::from_hex(head.as_str()?)).collect::<Option<_>>()?;
            if heads.windows(2).any(|pair|pair[0]>=pair[1]) {return None;}
            decoded.push((id,heads));
        }
        Some(decoded)
    }

    /// Negative use requires current policy and locally established member state,
    /// not merely the owner's authority to disclose IDs for discovery.
    pub fn discovery_manifest_members(&self,on:SignerId,actor:VaultId,vault:VaultId,scope:DiscoveryScope,carrier:EntryId,snapshot:EditId)->Option<Vec<EntryId>> {
        let scope=scope.normalized()?;
        let rows=self.discovery_manifest_rows(on,actor,vault,scope.clone(),carrier,snapshot)?;
        let st=self.state(on);
        let can_read=|entry:&crate::policy::Entry|manifest_readable(st,actor,entry);
        let mut members=Vec::with_capacity(rows.len());
        for (id,heads) in rows {
            let entry=st.entry(id)?;
            if entry.vault!=vault || !can_read(entry) || !self.reads(on,id) || !scope.matches(self,on,id)? {return None;}
            let mut current=self.history(on,id)?.heads(MAIN);current.sort();current.dedup();
            if current!=heads {return None;}
            members.push(id);
        }
        // Only inspect readable local candidates. Hidden unrelated activity must
        // not alter the public readiness signal; the statement remains at its
        // explicit owner cut, not a claim covering unknown later private writes.
        for entry in st.entries().iter().filter(|entry|entry.vault==vault&&can_read(entry)) {
            if !self.landed(on,entry.id) {continue;}
            if scope.matches(self,on,entry.id)? && members.binary_search(&entry.id).is_err() {return None;}
        }
        Some(members)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast;

    #[test]
    fn universal_query_uses_exact_manifest_scope_without_claiming_completeness() {
        let mut w=cast::world();
        let note=w.lab.create(w.mac_a,w.alice,w.alice,"note",&[],Item::todo("member",w.mac_a)).unwrap();
        let record=w.lab.discovery_manifest_record(w.mac_a,w.alice,DiscoveryScope::Types(vec!["note".into()])).unwrap();
        let item=Item::made(&crate::lens::View::plain(&crate::lens::DISCOVERY_MANIFEST_V1),&record,w.mac_a).unwrap();
        let carrier=w.lab.create(w.mac_a,w.alice,w.alice,"discovery-manifest",&[],item).unwrap();
        let prepared=w.lab.draft_entry_projection(w.mac_a,&[w.passkey_a],carrier).unwrap();
        let snapshot=w.lab.complete(w.mac_a,prepared.draft,&[]).unwrap();
        assert!(w.lab.retain_entry_projection(w.mac_a,snapshot,carrier,prepared.sealed));
        let query=json!({"op":"query","vault":w.alice.to_hex(),"where":{"type":["note"]},"limit":0});
        let answer=crate::engine::read(&w.lab,w.mac_a,&query);
        assert_eq!(answer["ok"]["rows"],json!([]));
        assert_eq!(answer["ok"]["count"],1);
        assert_eq!(answer["ok"]["scope"]["discovery"]["entry"],carrier.to_hex());
        assert_eq!(answer["ok"]["scope"]["discovery"]["pendingEntries"],json!([]),"pagination must not re-demand already materialized members");
        assert_eq!(answer["ok"]["readiness"]["authoritativeEmpty"],false);
        let other=crate::engine::read(&w.lab,w.mac_a,&json!({"op":"query","vault":w.alice.to_hex(),"where":{"type":["other"]}}));
        assert!(other["ok"].get("scope").is_none());
        assert!(w.lab.item(w.mac_a,note).is_some());
    }

    #[test]
    fn owner_manifest_query_requires_approval_exact_scope_and_unchanged_membership() {
        let mut w=cast::world();
        let note=w.lab.create(w.mac_a,w.alice,w.alice,"note",&["selected"],Item::todo("member",w.mac_a)).unwrap();
        let scope=DiscoveryScope::Tag("selected".into());
        let record=w.lab.discovery_manifest_record(w.mac_a,w.alice,scope.clone()).unwrap();
        let item=Item::made(&crate::lens::View::plain(&crate::lens::DISCOVERY_MANIFEST_V1),&record,w.mac_a).unwrap();
        let carrier=w.lab.create(w.mac_a,w.alice,w.alice,"discovery-manifest",&[],item).unwrap();
        assert!(w.lab.draft_entry_projection(w.mac_a,&[w.mac_a],carrier).is_err());
        let prepared=w.lab.draft_entry_projection(w.mac_a,&[w.passkey_a],carrier).unwrap();
        let snapshot=w.lab.complete(w.mac_a,prepared.draft,&[]).unwrap();
        let retained=prepared.sealed;
        assert!(w.lab.retain_entry_projection(w.mac_a,snapshot,carrier,retained.clone()));
        assert_eq!(w.lab.discovery_manifest_members(w.mac_a,w.alice,w.alice,scope.clone(),carrier,snapshot),Some(vec![note]));
        let ordinary=crate::engine::run(&mut w.lab,w.mac_a,&json!({"op":"entry_views","vault":w.alice.to_hex(),"tag":"selected"}));
        assert_eq!(ordinary["ok"]["scope"]["discovery"]["entry"],carrier.to_hex());
        assert_eq!(ordinary["ok"]["scope"]["discovery"]["snapshot"],snapshot.to_hex());
        assert_eq!(ordinary["ok"]["scope"]["discovery"]["pendingEntries"],json!([]));
        assert!(ordinary["ok"]["scope"].get("completeAtOwnerCut").is_none());
        assert!(w.lab.automatic_discovery_hint(w.mac_a,w.alice,w.alice,DiscoveryScope::Tag("other".into())).is_none());

        w.lab.held(w.mac_a).projections.lock().unwrap().clear();
        assert!(w.lab.discovery_manifest_members(w.mac_a,w.alice,w.alice,scope.clone(),carrier,snapshot).is_none());
        assert!(w.lab.retain_entry_projection(w.mac_a,snapshot,carrier,retained));
        assert_eq!(w.lab.discovery_manifest_members(w.mac_a,w.alice,w.alice,scope.clone(),carrier,snapshot),Some(vec![note]),"full carrier history does not erase the restored owner attestation");
        assert!(w.lab.discovery_manifest_members(w.mac_a,w.alice,w.alice,DiscoveryScope::Tag("another".into()),carrier,snapshot).is_none());
        let query=json!({"op":"entry_views","vault":w.alice.to_hex(),"as":w.alice.to_hex(),"tag":"selected",
            "manifest":{"entry":carrier.to_hex(),"snapshot":snapshot.to_hex()}});
        let result=crate::engine::read(&w.lab,w.mac_a,&query);
        assert_eq!(result["ok"]["scope"]["completeAtOwnerCut"],true);
        assert_eq!(result["ok"]["scope"]["localComplete"],false);
        assert_eq!(result["ok"]["scope"]["remoteComplete"],false);
        assert!(crate::engine::read(&w.lab,w.mac_a,&json!({"op":"read_guard","query":query})).get("ok").is_some());
        w.lab.create(w.mac_a,w.alice,w.alice,"note",&["selected"],Item::todo("new member",w.mac_a)).unwrap();
        assert!(w.lab.discovery_manifest_members(w.mac_a,w.alice,w.alice,scope,carrier,snapshot).is_none(),"known in-domain additions invalidate the old cut for negative use");
        assert!(crate::engine::read(&w.lab,w.mac_a,&json!({"op":"read_guard","query":query})).get("refused").is_some());
    }

    #[test]
    fn discovery_scope_normalizes_and_rejects_unbounded_contracts() {
        assert_eq!(DiscoveryScope::Types(vec!["post".into(),"flow".into(),"post".into()]).normalized(),Some(DiscoveryScope::Types(vec!["flow".into(),"post".into()])));
        assert!(DiscoveryScope::Types(vec![]).normalized().is_none());
        assert!(DiscoveryScope::Types(vec!["flow".into();9]).normalized().is_none());
        assert!(DiscoveryScope::Tag("x".repeat(257)).normalized().is_none());
    }
    #[test]
    fn manifest_discovery_ids_do_not_admit_unknown_members_and_malformed_attestations_fail() {
        let mut w=cast::world();
        w.lab.sync(w.mac_a,w.phone_a);
        let note=w.lab.create(w.mac_a,w.alice,w.alice,"note",&["selected"],Item::todo("member",w.mac_a)).unwrap();
        let scope=DiscoveryScope::Tag("selected".into());
        let record=w.lab.discovery_manifest_record(w.mac_a,w.alice,scope.clone()).unwrap();
        let item=Item::made(&crate::lens::View::plain(&crate::lens::DISCOVERY_MANIFEST_V1),&record,w.mac_a).unwrap();
        let carrier=w.lab.create(w.mac_a,w.alice,w.alice,"discovery-manifest",&[],item).unwrap();
        let prepared=w.lab.draft_capsuled_entry_base(w.mac_a,&[w.passkey_a],carrier).unwrap();
        let snapshot=w.lab.complete(w.mac_a,prepared.draft,&[]).unwrap();
        let offer=w.lab.entry_projection_offer(w.mac_a,w.phone_a,carrier).unwrap();
        let capsule=w.lab.entry_checkpoint_capsule(w.mac_a,w.phone_a,snapshot,carrier,&prepared.sealed).unwrap();
        w.lab.receive(w.phone_a,offer.evidence,vec![]);
        assert!(w.lab.adopt_capsuled_owner_entry_base(w.phone_a,snapshot,carrier,prepared.sealed,capsule));
        assert_eq!(w.lab.discovery_manifest_targets(w.phone_a,w.alice,w.alice,scope.clone(),carrier,snapshot),Some(vec![note]));
        assert_eq!(w.lab.automatic_discovery_hint(w.phone_a,w.alice,w.alice,scope.clone()).unwrap()["pendingEntries"],json!([note.to_hex()]));
        assert!(w.lab.discovery_manifest_members(w.phone_a,w.alice,w.alice,scope.clone(),carrier,snapshot).is_none());
        let query=json!({"op":"entry_views","vault":w.alice.to_hex(),"as":w.alice.to_hex(),"tag":"selected",
            "manifest":{"entry":carrier.to_hex(),"snapshot":snapshot.to_hex()}});
        let pending=crate::engine::read(&w.lab,w.phone_a,&query);
        assert_eq!(pending["ok"]["rows"],json!([]));
        assert_eq!(pending["ok"]["scope"]["pendingEntries"],json!([note.to_hex()]));
        assert_eq!(pending["ok"]["scope"]["completeAtOwnerCut"],false);
        w.lab.sync(w.mac_a,w.phone_a);
        assert_eq!(w.lab.discovery_manifest_members(w.phone_a,w.alice,w.alice,scope.clone(),carrier,snapshot),Some(vec![note]));
        w.lab.edit(w.mac_a,w.alice,carrier,|item| {
            let mut changed=item.record(); changed["members"]=json!([]);
            item.set_record(&crate::lens::View::plain(&crate::lens::DISCOVERY_MANIFEST_V1),&changed);
        }).unwrap();
        w.lab.sync(w.mac_a,w.phone_a);
        assert_eq!(w.lab.discovery_manifest_targets(w.phone_a,w.alice,w.alice,scope.clone(),carrier,snapshot),Some(vec![note]),
            "later carrier content cannot rewrite the immutable owner-attested cut");
        w.lab.lock(w.phone_a);
        assert!(w.lab.held(w.phone_a).attested_manifests.lock().unwrap().is_empty(),"lock clears attested plaintext");
        let mut malformed=record;
        malformed["members"][0]["unexpected"]=json!(true);
        let item=Item::made(&crate::lens::View::plain(&crate::lens::DISCOVERY_MANIFEST_V1),&malformed,w.mac_a).unwrap();
        let bad=w.lab.create(w.mac_a,w.alice,w.alice,"discovery-manifest",&[],item).unwrap();
        let prepared=w.lab.draft_entry_projection(w.mac_a,&[w.passkey_a],bad).unwrap();
        let snapshot=w.lab.complete(w.mac_a,prepared.draft,&[]).unwrap();
        assert!(w.lab.retain_entry_projection(w.mac_a,snapshot,bad,prepared.sealed));
        assert!(w.lab.discovery_manifest_targets(w.mac_a,w.alice,w.alice,scope,bad,snapshot).is_none());
    }

    #[test]
    fn selected_entry_revocation_invalidates_manifest_negative_evidence() {
        let mut w=cast::world();
        let note=w.lab.create(w.mac_a,w.alice,w.alice,"note",&["selected"],Item::todo("member",w.mac_a)).unwrap();
        let scope=DiscoveryScope::Tag("selected".into());
        let record=w.lab.discovery_manifest_record(w.mac_a,w.alice,scope.clone()).unwrap();
        let item=Item::made(&crate::lens::View::plain(&crate::lens::DISCOVERY_MANIFEST_V1),&record,w.mac_a).unwrap();
        let carrier=w.lab.create(w.mac_a,w.alice,w.alice,"discovery-manifest",&[],item).unwrap();
        let selected=w.lab.issue(w.mac_a,&[w.mac_a],cast::share(w.alice,cast::vault(w.bob),Level::Read,cast::by_id(note))).unwrap();
        w.lab.issue(w.mac_a,&[w.mac_a],cast::share(w.alice,cast::vault(w.bob),Level::Read,cast::by_id(carrier))).unwrap();
        let prepared=w.lab.draft_entry_projection(w.mac_a,&[w.passkey_a],carrier).unwrap();
        let snapshot=w.lab.complete(w.mac_a,prepared.draft,&[]).unwrap();
        assert!(w.lab.retain_entry_projection(w.mac_a,snapshot,carrier,prepared.sealed));
        assert_eq!(w.lab.discovery_manifest_members(w.mac_a,w.bob,w.alice,scope.clone(),carrier,snapshot),Some(vec![note]));
        w.lab.submit(w.mac_a,&[w.mac_a],Action::Revoke(crate::policy::Revoking::Grant{share:selected,actor:w.alice,keep:vec![],via:vec![]})).unwrap();
        assert!(w.lab.discovery_manifest_members(w.mac_a,w.bob,w.alice,scope,carrier,snapshot).is_none());
    }

    #[test]
    fn discovery_manifest_creation_is_owner_gated_and_rechecks_disclosure() {
        let mut w=cast::world();
        w.lab.create(w.mac_a,w.alice,w.alice,"note",&["selected"],Item::todo("member",w.mac_a)).unwrap();
        let scope=DiscoveryScope::Tag("selected".into());
        let before=w.lab.held(w.mac_a).log.ids().len();
        assert!(w.lab.prepare_discovery_manifest(w.mac_a,w.mac_a,w.alice,scope.clone()).is_err());
        let prepared=w.lab.prepare_discovery_manifest(w.mac_a,w.passkey_a,w.alice,scope.clone()).unwrap();
        assert_eq!(w.lab.held(w.mac_a).log.ids().len(),before,"preparation must not announce content");
        // A grant arriving during the owner ceremony must invalidate its preflight.
        let selector=crate::slice::Selector::AnyOf(vec![vec![crate::slice::Atom::TypeIn(vec![Sym::new("discovery-manifest")])]]);
        w.lab.issue(w.mac_a,&[w.mac_a],cast::share(w.alice,Who::Everyone,Level::Read,selector)).unwrap();
        let after_grant=w.lab.held(w.mac_a).log.ids().len();
        assert!(w.lab.complete_discovery_manifest(w.mac_a,prepared,&[]).is_err());
        assert_eq!(w.lab.held(w.mac_a).log.ids().len(),after_grant,"failed owner continuation emitted a write");
        assert!(w.lab.prepare_discovery_manifest(w.mac_a,w.passkey_a,w.alice,scope).is_err());
    }

    #[test]
    fn discovery_manifest_preparation_allows_schema_only_grants_and_current_owner() {
        let mut w=cast::world();
        w.lab.create(w.mac_a,w.alice,w.alice,"note",&["selected"],Item::todo("member",w.mac_a)).unwrap();
        w.lab.issue(w.mac_a,&[w.mac_a],cast::share(w.alice,Who::Everyone,Level::Read,crate::slice::Selector::lane())).unwrap();
        let prepared=w.lab.prepare_discovery_manifest(w.mac_a,w.passkey_a,w.alice,DiscoveryScope::Tag("selected".into())).unwrap();
        let entry=w.lab.complete_discovery_manifest(w.mac_a,prepared,&[]).unwrap();
        assert!(w.lab.reads(w.mac_a,entry));
        assert_eq!(w.lab.item(w.mac_a,entry).unwrap().record()["kind"],KIND);
    }

    #[test]
    fn discovery_manifest_unknown_carrier_selector_fails_without_emitting_content() {
        let mut w=cast::world();
        w.lab.create(w.mac_a,w.alice,w.alice,"note",&["selected"],Item::todo("member",w.mac_a)).unwrap();
        let share=w.lab.issue(w.mac_a,&[w.mac_a],cast::share(w.alice,Who::Everyone,Level::Read,crate::slice::Selector::lane())).unwrap();
        let at=w.lab.at(w.mac_a);
        w.lab.stores.get_mut(&at).unwrap().slices.remove(&share);
        let before=w.lab.held(w.mac_a).log.ids().len();
        assert!(w.lab.prepare_discovery_manifest(w.mac_a,w.passkey_a,w.alice,DiscoveryScope::Tag("selected".into())).is_err());
        assert_eq!(w.lab.held(w.mac_a).log.ids().len(),before);
    }

    #[test]
    fn discovery_manifest_prefers_causal_publication_over_random_carrier_order() {
        let mut w=cast::world();
        let first=w.lab.create(w.mac_a,w.alice,w.alice,"note",&["selected"],Item::todo("first",w.mac_a)).unwrap();
        let scope=DiscoveryScope::Tag("selected".into());
        let record=w.lab.discovery_manifest_record(w.mac_a,w.alice,scope.clone()).unwrap();
        let mut carriers=Vec::new();
        for _ in 0..2 {
            let item=Item::made(&crate::lens::View::plain(&crate::lens::DISCOVERY_MANIFEST_V1),&record,w.mac_a).unwrap();
            carriers.push(w.lab.create(w.mac_a,w.alice,w.alice,"discovery-manifest",&[],item).unwrap());
        }
        carriers.sort();
        // Force the adverse case independent of RNG: old's EntryId sorts first
        // under the former reverse-ID selection, but newer has the later cut.
        let (newer,old)=(carriers[0],carriers[1]);
        let p=w.lab.draft_entry_projection(w.mac_a,&[w.passkey_a],old).unwrap();
        let old_snapshot=w.lab.complete(w.mac_a,p.draft,&[]).unwrap();
        assert!(w.lab.retain_entry_projection(w.mac_a,old_snapshot,old,p.sealed));
        let second=w.lab.create(w.mac_a,w.alice,w.alice,"note",&["selected"],Item::todo("second",w.mac_a)).unwrap();
        let current=w.lab.discovery_manifest_record(w.mac_a,w.alice,scope.clone()).unwrap();
        w.lab.edit(w.mac_a,w.alice,newer,|item|{item.set_record(&View::plain(&crate::lens::DISCOVERY_MANIFEST_V1),&current);}).unwrap();
        let p=w.lab.draft_entry_projection(w.mac_a,&[w.passkey_a],newer).unwrap();
        let new_snapshot=w.lab.complete(w.mac_a,p.draft,&[]).unwrap();
        assert!(w.lab.retain_entry_projection(w.mac_a,new_snapshot,newer,p.sealed));
        let selected=w.lab.automatic_discovery_hint(w.mac_a,w.alice,w.alice,scope).unwrap();
        assert_eq!(selected["entry"],newer.to_hex());
        assert_eq!(selected["snapshot"],new_snapshot.to_hex());
        let members=selected["pendingEntries"].as_array().unwrap();
        assert!(members.contains(&json!(first.to_hex()))&&members.contains(&json!(second.to_hex())));
        assert_eq!(selected["remoteComplete"],false);
    }

    #[test]
    fn discovery_manifest_keeps_stale_visible_member_priority_until_heads_are_imported() {
        let mut w=cast::world();
        let note=w.lab.create(w.mac_a,w.alice,w.alice,"note",&["selected"],Item::todo("old",w.mac_a)).unwrap();
        w.lab.sync(w.mac_a,w.phone_a);
        assert!(w.lab.item(w.phone_a,note).is_some());
        w.lab.edit(w.mac_a,w.alice,note,|item|{let mut record=item.record();record["title"]=json!("new");item.set_record(View::todo_v1(),&record);}).unwrap();
        let scope=DiscoveryScope::Tag("selected".into());
        let record=w.lab.discovery_manifest_record(w.mac_a,w.alice,scope).unwrap();
        let item=Item::made(&crate::lens::View::plain(&crate::lens::DISCOVERY_MANIFEST_V1),&record,w.mac_a).unwrap();
        let carrier=w.lab.create(w.mac_a,w.alice,w.alice,"discovery-manifest",&[],item).unwrap();
        let p=w.lab.draft_entry_projection(w.mac_a,&[w.passkey_a],carrier).unwrap();
        let snapshot=w.lab.complete(w.mac_a,p.draft,&[]).unwrap();
        let offer=w.lab.entry_projection_offer(w.mac_a,w.phone_a,carrier).unwrap();
        w.lab.receive(w.phone_a,offer.evidence,vec![]);
        assert!(w.lab.retain_entry_projection(w.phone_a,snapshot,carrier,p.sealed));
        let query=json!({"op":"entry_views","vault":w.alice.to_hex(),"tag":"selected"});
        let stale=crate::engine::read(&w.lab,w.phone_a,&query);
        assert!(stale["ok"]["rows"].as_array().unwrap().iter().any(|row|row["entry"]==note.to_hex()));
        assert_eq!(stale["ok"]["scope"]["discovery"]["pendingEntries"],json!([note.to_hex()]));
        w.lab.sync(w.mac_a,w.phone_a);
        let current=crate::engine::read(&w.lab,w.phone_a,&query);
        assert_eq!(current["ok"]["scope"]["discovery"]["pendingEntries"],json!([]));
        // A subsequent locally accepted write still covers the advertised heads.
        w.lab.edit(w.phone_a,w.alice,note,|item|{let mut record=item.record();record["title"]=json!("newer");item.set_record(View::todo_v1(),&record);}).unwrap();
        let newer=crate::engine::read(&w.lab,w.phone_a,&query);
        assert_eq!(newer["ok"]["scope"]["discovery"]["pendingEntries"],json!([]));
    }

    #[test]
    fn discovery_manifest_read_only_projection_requires_exact_advertised_basis() {
        let mut w=cast::world();
        w.lab.sync(w.mac_a,w.phone_a);
        let note=w.lab.create(w.mac_a,w.alice,w.alice,"note",&["selected"],Item::todo("checkpoint",w.mac_a)).unwrap();
        w.lab.edit(w.mac_a,w.alice,note,|item|{let mut record=item.record();record["title"]=json!("latest checkpoint");item.set_record(View::todo_v1(),&record);}).unwrap();
        let heads=w.lab.history(w.mac_a,note).unwrap().heads(MAIN);
        let p=w.lab.draft_entry_projection(w.mac_a,&[w.passkey_a],note).unwrap();
        let snapshot=w.lab.complete(w.mac_a,p.draft,&[]).unwrap();
        let offer=w.lab.entry_projection_offer(w.mac_a,w.phone_a,note).unwrap();
        w.lab.receive(w.phone_a,offer.evidence,vec![]);
        assert!(w.lab.retain_entry_projection(w.phone_a,snapshot,note,p.sealed));
        assert!(w.lab.history(w.phone_a,note).is_none_or(|history|heads.iter().any(|head|history.get(*head).is_none())),"latest state is only a read-only attestation");
        let shown=crate::engine::read(&w.lab,w.phone_a,&json!({"op":"entry_views","vault":w.alice.to_hex(),"types":["note"]}));
        assert_eq!(shown["ok"]["rows"][0]["title"],"latest checkpoint");
        assert_eq!(shown["ok"]["rows"][0]["readOnly"],true);
        assert_eq!(shown["ok"]["rows"][0]["checkpoint"]["partial"],true);
        assert_eq!(shown["ok"]["scope"]["localComplete"],false);
        assert!(w.lab.materialized_manifest_heads(w.phone_a,w.alice,note,&heads));
        assert!(!w.lab.materialized_manifest_heads(w.phone_a,w.alice,note,&[EditId([91;32])]));
        assert!(!w.lab.materialized_manifest_heads(w.phone_a,w.bob,note,&heads));
        w.lab.edit(w.mac_a,w.alice,note,|item|{let mut record=item.record();record["title"]=json!("later");item.set_record(View::todo_v1(),&record);}).unwrap();
        let p=w.lab.draft_entry_projection(w.mac_a,&[w.passkey_a],note).unwrap();
        let newer=w.lab.complete(w.mac_a,p.draft,&[]).unwrap();
        let offer=w.lab.entry_projection_offer(w.mac_a,w.phone_a,note).unwrap();
        w.lab.receive(w.phone_a,offer.evidence,vec![]);
        assert!(w.lab.retain_entry_projection(w.phone_a,newer,note,p.sealed));
        assert!(!w.lab.materialized_manifest_heads(w.phone_a,w.alice,note,&heads),"a different basis without counted ancestry is not proof");
        assert!(w.lab.materialized_manifest_heads(w.phone_a,w.alice,note,&w.lab.history(w.mac_a,note).unwrap().heads(MAIN)));
    }

}
