//! Explicit owner publication, using ordinary local creation and checkpoint approval.
//! No sharing is inferred: the carrier remains in its normal source-vault audience.
use crate::{Authenticator, Node};
use anyhow::Result;
use avendb::{doc::Item, engine::Refused, id::VaultId, lab::DiscoveryScope};
use serde_json::{Value,json};

impl Node {
    pub(crate) async fn publish_scope_manifest<A:Authenticator>(&self,op:&Value,authenticator:Option<&A>)->Result<Value> {
        let Some(object)=op.as_object() else {return Ok(Refused::BadOp("checkpoint_scope requires an object".into()).to_json());};
        if object.keys().any(|key|!matches!(key.as_str(),"op"|"vault"|"types"|"tag")) {
            return Ok(Refused::BadOp("checkpoint_scope takes vault and exactly one types or tag scope".into()).to_json());
        }
        let Some(vault)=op.get("vault").and_then(Value::as_str).and_then(VaultId::from_hex) else {
            return Ok(Refused::BadOp("checkpoint_scope requires a vault ID".into()).to_json());
        };
        let scope=match(op.get("types"),op.get("tag")) {
            (Some(types),None)=>types.as_array().and_then(|types|types.iter().map(|t|t.as_str().map(str::to_owned)).collect::<Option<Vec<_>>>()).map(DiscoveryScope::Types),
            (None,Some(tag))=>tag.as_str().map(|tag|DiscoveryScope::Tag(tag.to_owned())),
            _=>None,
        }.and_then(DiscoveryScope::normalized);
        let Some(scope)=scope else {return Ok(Refused::BadOp("invalid or unbounded discovery scope".into()).to_json());};
        // The builder requires owner-domain authority and complete local metadata.
        // This is an ordinary signed creation, not a fabricated privileged write.
        let made=self.try_act(move|lab,me| {
            let record=lab.discovery_manifest_record(me,vault,scope).ok_or(avendb::policy::Refusal::NotAccepted)?;
            let mut item=Item::new(me);item.put_record(&record);
            lab.create(me,vault,vault,"discovery-manifest",&[],item)
        }).await?;
        let entry=match made {Ok(entry)=>entry,Err(why)=>return Ok(Refused::from(why).to_json())};
        let request=json!({"op":"checkpoint_view","entry":entry.to_hex()});
        // Carrier creation has already succeeded. Preserve it in every outcome;
        // no automatic retry, no implied rollback, and no inferred public share.
        match self.publish_checkpoint(&request,authenticator).await {
            Ok(answer) if answer.get("ok").is_some()=>Ok(json!({"ok":{"entry":entry.to_hex(),"published":answer["ok"]["pinned"]==true,"approved":true,"checkpoint":answer["ok"],"shared":false}})),
            Ok(answer)=>Ok(json!({"ok":{"entry":entry.to_hex(),"published":false,"checkpointResponse":answer,"resume":request,"shared":false}})),
            Err(error)=>Ok(json!({"ok":{"entry":entry.to_hex(),"published":false,"checkpointError":error.to_string(),"resume":request,"shared":false}})),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Options;
    use avendb::{cast, lab::PreparedEntryProjection};
    use iroh_blobs::{BlobFormat,Hash,HashAndFormat};
    use n0_future::time::Instant;

    #[tokio::test(flavor="multi_thread",worker_threads=2)]
    async fn scope_publication_without_authenticator_retains_private_carrier_not_fake_success() {
        let mut w=cast::world();
        w.lab.create(w.mac_a,w.alice,w.alice,"note",&["selected"],Item::todo("member",w.mac_a)).unwrap();
        let vault=w.alice;
        let node=Node::spawn(w.lab.split(w.mac_a,&[],[181;32]),w.mac_a,Options::local()).await.unwrap();
        let answer=node.op(json!({"op":"checkpoint_scope","vault":vault.to_hex(),"tag":"selected"})).await.unwrap();
        assert_eq!(answer["ok"]["published"],false);
        assert_eq!(answer["ok"]["shared"],false);
        assert!(answer["ok"]["entry"].is_string());
        assert!(answer["ok"]["checkpointResponse"].get("approve").is_some());
        assert_eq!(answer["ok"]["resume"]["op"],"checkpoint_view");
        node.shutdown().await.unwrap();
    }

    #[tokio::test(flavor="multi_thread",worker_threads=2)]
    async fn manifest_pin_restores_offline_after_reopen_with_full_carrier_history() {
        let folder=std::env::temp_dir().join(format!("avendb-manifest-reopen-{}",crate::shelf::fresh()));
        let mut w=cast::world();
        let (sender,receiver,owner,vault)=(w.mac_a,w.phone_a,w.passkey_a,w.alice);
        w.lab.create(sender,vault,vault,"note",&["selected"],Item::todo("member",sender)).unwrap();
        let record=w.lab.discovery_manifest_record(sender,vault,DiscoveryScope::Tag("selected".into())).unwrap();
        let mut item=Item::new(sender);item.put_record(&record);
        let carrier=w.lab.create(sender,vault,vault,"discovery-manifest",&[],item).unwrap();
        let PreparedEntryProjection{draft,root,sealed}=w.lab.draft_entry_projection(sender,&[owner],carrier).unwrap();
        let snapshot=w.lab.complete(sender,draft,&[]).unwrap();
        w.lab.sync(sender,receiver); // Full carrier and selected history, not projection-only.
        let shelf=crate::disk::open(&folder).unwrap();
        let node=Node::spawn(w.lab.split(receiver,&[],[182;32]),receiver,Options{shelf:Some(shelf.clone()),..Options::local()}).await.unwrap();
        let temporary=node.shared.store.add_bytes_with_opts((sealed,BlobFormat::Raw)).temp_tag().await.unwrap();
        let tag=[b"avendb/checkpoint/".as_slice(),&carrier.0].concat();
        node.shared.store.tags().set(tag,HashAndFormat::new(Hash::from_bytes(root.hash),BlobFormat::Raw)).await.unwrap();
        drop(temporary);
        node.shutdown().await.unwrap();drop(node);
        let mut next=cast::world();
        let node=Node::spawn(next.lab.split(receiver,&[],[183;32]),receiver,Options{shelf:Some(shelf),..Options::local()}).await.unwrap();
        assert!(node.shared.peers.lock().unwrap().is_empty());
        assert_eq!(node.read(move|lab,me|lab.retained_projection_hint(me,carrier)).await,None);
        let scope="ab".repeat(16);
        node.shared.demands.lock().unwrap().replace(scope.clone(),1,vec![avendb::sync::LogId::Entry(carrier)],Instant::now()).unwrap();
        assert!(node.shared.restore_view_checkpoint(carrier,&scope,1).await.unwrap());
        let result=node.op(json!({"op":"entry_views","vault":vault.to_hex(),"as":vault.to_hex(),"tag":"selected",
            "manifest":{"entry":carrier.to_hex(),"snapshot":snapshot.to_hex()}})).await.unwrap();
        assert_eq!(result["ok"]["scope"]["completeAtOwnerCut"],true);
        assert_eq!(result["ok"]["scope"]["remoteComplete"],false);
        node.shutdown().await.unwrap();drop(node);
        std::fs::remove_dir_all(folder).unwrap();
    }
}
