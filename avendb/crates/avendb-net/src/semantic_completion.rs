//! Resume persisted semantic work against one current authenticated peer cut.
//! Transfer priorities never replace canonical selector or group evaluation.
use super::*;
use anyhow::ensure;
use avendb::id::EntryId;
impl Shared {
    pub(crate) async fn finish_pending_semantics(self:&Arc<Self>,peer:Peer,entry:EntryId,
        origin:Option<crate::demand::Origin>)->Result<()> {
        let _slot=self.authority_stages.reserve()?;
        let connection=peer.conn.stable_id();let device=peer.device;
        self.catch_up_paced(true).await;
        let shared=self.clone();
        let initial=self.read(move|lab,me| {
            if !lab.semantic_pending(me,entry) {return None;}
            let held=shared.held.lock().expect("held");let current=held.get(&device)?;
            let receipt=shared.ranges.lock().expect("ranges").complete_inventory(connection,device)?;
            let announced:Holdings=Holdings {logs:current.logs.iter().filter(|(log,_)|
                !matches!(log,LogId::Entry(_)) || **log==LogId::Entry(entry)).map(|(l,f)|(*l,f.clone())).collect(),files:Default::default()};
            if announced.logs.len()>129 {return None;}
            let indexed=shared.logs_of(lab,me);let local=indexed.of.get(&LogId::Entry(entry))?;
            if local.edits.len()>64 || announced.logs.get(&LogId::Entry(entry))!=Some(&local.frontier) {return None;}
            let log=lab.log(me);let provenance=lab.authority_provenance(me);
            if local.edits.iter().any(|&at|!provenance.contains_key(&log.ids()[at])) {return None;}
            let owner=crate::authority_classes::OwnerEntry::from_parts(entry,
                local.edits.iter().map(|&at|(log.ids()[at],&log.edits()[at])),&local.frontier)?;
            Some((receipt,announced,owner))
        }).await;
        let Some((receipt,announced,owner))=initial else {return Ok(())};
        let shares=announced.logs.keys().filter_map(|log|match log {LogId::Share(id)=>Some(*id),_=>None}).collect();
        let Some(classes)=self.grant_classes_dependency(&peer,shares).await else {return Ok(())};
        for _ in 0..4 {
            ensure!(peer.conn.close_reason().is_none() && origin.as_ref().is_none_or(|o|o.active()),"semantic work obsolete");
            let (shared,announced,owner,classes,receipt,origin)=(self.clone(),announced.clone(),owner.clone(),classes.clone(),receipt.clone(),origin.clone());
            let result=self.try_lab(move|lab,me| {
                let demands=origin.as_ref().map(|_|shared.demands.lock().expect("demands"));
                if origin.as_ref().zip(demands.as_ref()).is_some_and(|(o,d)|!d.current(&o.scope,o.revision,n0_future::time::Instant::now())) {return None;}
                let held=shared.held.lock().expect("held");let current=held.get(&device)?;
                if current.logs.iter().filter(|(log,_)|!matches!(log,LogId::Entry(_)) || **log==LogId::Entry(entry))
                    .ne(announced.logs.iter()) {return None;}
                if shared.ranges.lock().expect("ranges").complete_inventory(connection,device)!=Some(receipt) {return None;}
                let indexed=shared.logs_of(lab,me);
                if indexed.of.get(&LogId::Entry(entry)).map(|log|&log.frontier)!=announced.logs.get(&LogId::Entry(entry)) {return None;}
                let log=lab.log(me);let provenance=lab.authority_provenance(me);
                let (dependencies,selectors_known)=classes.semantic_dependencies(&owner,log.edits(),log.ids(),&indexed,current,
                    |id|provenance.get(&id).cloned(),|group|lab.historical_group_dependencies(me,owner.vault,group),
                    |share|lab.semantic_selector_matches(me,entry,share))?;
                if dependencies.missing.is_empty() && selectors_known {
                    lab.complete_semantic_cut(me,entry);
                    return Some(None);
                }
                Some(Some(dependencies))
            }).await?;
            let Some(Some(dependencies))=result else {break};
            let (groups,authority):(BTreeSet<_>,BTreeSet<_>)=dependencies.missing.into_iter()
                .partition(|id|matches!(id,LogId::Entry(_)));
            if groups.is_empty() && authority.is_empty() {break;}
            if !authority.is_empty() {self.pull_dependency(peer.endpoint,authority,device).await?;self.catch_up_paced(true).await;}
            if !groups.is_empty() {self.pull_group_dependency(peer.endpoint,groups,device,dependencies.groups).await?;self.catch_up_paced(true).await;}
        }
        self.jobs.stir();Ok(())
    }
}
