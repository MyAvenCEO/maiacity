//! Explicit owner-cosigned carrier creation followed by checkpoint approval.
//! Existing audience disclosure is checked before creation and after the ceremony.
use crate::{Authenticator, Node, Step};
use anyhow::Result;
use avendb::{doc::Item, engine::{self, Refused}, id::VaultId, lab::DiscoveryScope};
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
        let prepared=self.try_act(move|lab,me| {
            let owner=engine::passkey_of(lab,me).ok_or(avendb::policy::Refusal::BelowThreshold)?;
            let prepared=lab.prepare_discovery_manifest(me,owner,vault,scope)?;
            Ok::<_,avendb::policy::Refusal>((prepared,lab.keys_of(owner)))
        }).await?;
        let (prepared,keys)=match prepared {Ok(value)=>value,Err(why)=>return Ok(Refused::from(why).to_json())};
        let owner=prepared.owner();
        let Some(authenticator)=authenticator else {
            // No draft export: continuation must re-enter this guarded publication API.
            // Nothing has been admitted, announced, or pinned.
            return Ok(json!({"approve":{"signers":[owner.to_hex()],"operation":"checkpoint_scope"}}));
        };
        let ceremony=crate::ceremony_of(authenticator,keys,prepared.challenge(),Step::Approve).await?;
        let made=self.try_act(move|lab,me|lab.complete_discovery_manifest(me,prepared,&[(owner,&ceremony)])).await?;
        let entry=match made {Ok(entry)=>entry,Err(why)=>return Ok(Refused::from(why).to_json())};
        let request=json!({"op":"checkpoint_entry_capsule","entry":entry.to_hex()});
        // Carrier creation has already succeeded. Preserve it in every outcome;
        // no automatic retry, no implied rollback, and no inferred public share.
        match self.publish_checkpoint(&request,Some(authenticator)).await {
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
    use n0_future::{time::Instant, StreamExt as _};

    #[tokio::test(flavor="multi_thread",worker_threads=2)]
    async fn scope_publication_without_authenticator_keeps_no_carrier() {
        let mut w=cast::world();
        w.lab.create(w.mac_a,w.alice,w.alice,"note",&["selected"],Item::todo("member",w.mac_a)).unwrap();
        let vault=w.alice;
        // Keep the owner's credential metadata, as an unlocked owner device does.
        // No authenticator is supplied to Node::op, so no approval ceremony runs.
        let node=Node::spawn(w.lab.split(w.mac_a,&[w.passkey_a],[181;32]),w.mac_a,Options::local()).await.unwrap();
        let before=node.read(|lab,me|(lab.state(me).entries().len(),lab.log(me).ids().to_vec())).await;
        for request in [
            json!({"op":"checkpoint_scope","vault":vault.to_hex(),"tag":"selected"}),
            json!({"op":"checkpoint_scope","vault":vault.to_hex(),"types":["note"]}),
        ] {
            assert_eq!(engine::name(&request),Some("checkpoint_scope"));
            assert!(!engine::reads(&request),"publication is not an ordinary read operation");
            let answer=node.op(request).await.unwrap();
            assert_eq!(answer["approve"]["operation"],"checkpoint_scope");
            assert!(answer.get("ok").is_none());
            assert_eq!(node.read(|lab,me|(lab.state(me).entries().len(),lab.log(me).ids().to_vec())).await,before,
                "asking for approval must not admit a carrier or owner checkpoint");
        }
        let malformed=json!({"op":"checkpoint_scope","vault":vault.to_hex(),"tag":"selected","approved":true});
        assert!(engine::name(&malformed).is_none(),"caller cannot supply approval as data");
        assert_eq!(node.op(malformed).await.unwrap()["refused"],"BadOp");
        for prefix in [b"avendb/checkpoint/".as_slice(),b"avendb/judged-checkpoint/".as_slice(),b"avendb/capsuled-checkpoint/".as_slice()] {
            let mut pins=Box::pin(node.shared.store.tags().list_prefix(prefix).await.unwrap());
            assert!(pins.next().await.is_none(),"no-auth publication must not pin ciphertext");
        }
        node.shutdown().await.unwrap();
    }

    #[tokio::test(flavor="multi_thread",worker_threads=2)]
    async fn manifest_pin_restores_offline_after_reopen_with_full_carrier_history() {
        let folder=std::env::temp_dir().join(format!("avendb-manifest-reopen-{}",crate::shelf::fresh()));
        let mut w=cast::world();
        let (sender,receiver,owner,vault)=(w.mac_a,w.phone_a,w.passkey_a,w.alice);
        w.lab.create(sender,vault,vault,"note",&["selected"],Item::todo("member",sender)).unwrap();
        let record=w.lab.discovery_manifest_record(sender,vault,DiscoveryScope::Tag("selected".into())).unwrap();
        let item=Item::made(&avendb::lens::View::plain(&avendb::lens::DISCOVERY_MANIFEST_V1),&record,sender).unwrap();
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
    #[tokio::test(flavor="multi_thread",worker_threads=4)]
    async fn manifest_demand_advances_beyond_eight_read_only_members_with_history_withheld() {
        use n0_future::{future,time::{self,Duration}};
        use std::collections::BTreeSet;
        use avendb::id::EntryId;
        let mut w=cast::world();
        let (sender,receiver,owner,vault)=(w.mac_a,w.phone_a,w.passkey_a,w.alice);
        let receiver_lab=w.lab.split(receiver,&[],[187;32]);
        let mut members=Vec::new();
        let mut pinned=Vec::new();
        for n in 0..12 {
            let entry=w.lab.create(sender,vault,vault,"manifest-note",&["selected"],Item::todo("old",sender)).unwrap();
            for revision in 0..3 {
                w.lab.edit(sender,vault,entry,|item|{let mut record=item.record();record["title"]=json!(format!("latest-{n}-{revision}"));item.set_record(avendb::lens::View::todo_v1(),&record);}).unwrap();
            }
            let expected=w.lab.item(sender,entry).unwrap().record()["title"].as_str().unwrap().to_owned();
            let p=w.lab.draft_capsuled_entry_base(sender,&[owner],entry).unwrap();
            w.lab.complete(sender,p.draft,&[]).unwrap();
            pinned.push((entry,p.root,p.sealed));
            members.push((entry,expected));
        }
        let unrelated=w.lab.create(sender,vault,vault,"unrelated",&[],Item::todo("not demanded",sender)).unwrap();
        let record=w.lab.discovery_manifest_record(sender,vault,DiscoveryScope::Types(vec!["manifest-note".into()])).unwrap();
        let item=Item::made(&avendb::lens::View::plain(&avendb::lens::DISCOVERY_MANIFEST_V1),&record,sender).unwrap();
        let carrier=w.lab.create(sender,vault,vault,"discovery-manifest",&[],item).unwrap();
        let p=w.lab.draft_capsuled_entry_base(sender,&[owner],carrier).unwrap();
        w.lab.complete(sender,p.draft,&[]).unwrap();pinned.push((carrier,p.root,p.sealed));
        let mac=Node::spawn(w.lab.split(sender,&[],[188;32]),sender,Options::local()).await.unwrap();
        // Pin normally owner-signed fixtures. The transport still validates each
        // signed offer/hash/permission; no receiver state is injected by this test.
        for (entry,root,sealed) in pinned {
            let temporary=mac.shared.store.add_bytes_with_opts((sealed,BlobFormat::Raw)).temp_tag().await.unwrap();
            mac.shared.store.tags().set([b"avendb/capsuled-checkpoint/".as_slice(),&entry.0].concat(),HashAndFormat::new(Hash::from_bytes(root.hash),BlobFormat::Raw)).await.unwrap();
            drop(temporary);
        }
        let folder=std::env::temp_dir().join(format!("avendb-manifest-capsule-{}",crate::shelf::fresh()));
        let shelf=crate::disk::open(&folder).unwrap();
        let phone=Node::spawn(receiver_lab,receiver,Options{shelf:Some(shelf),..Options::local()}).await.unwrap();
        let mut stalled=Vec::new();
        loop {
            let mut waiting=Box::pin(phone.shared.pulls.enter(false,None));
            let Some(permit)=future::poll_once(&mut waiting).await else {break;};
            stalled.push(permit.unwrap());
        }
        assert!(!stalled.is_empty(),"ordinary and live history are deliberately withheld");
        phone.know(mac.addr());mac.know(phone.addr());
        phone.shared.connection(mac.id()).await.unwrap();
        let lease="e7".repeat(16);
        let queries=json!([{"vault":vault.to_hex(),"types":["discovery-manifest"]},{"vault":vault.to_hex(),"types":["manifest-note"]}]);
        let mut revision=1u64;
        let ack=phone.op(json!({"op":"demand","scope":lease,"revision":revision,"entries":[],"queries":queries})).await.unwrap();
        assert_eq!(ack["ok"]["discovery_supported"],true);
        let query=json!({"op":"entry_views","vault":vault.to_hex(),"types":["manifest-note"]});
        let mut observed=BTreeSet::new();
        let mut prior=Vec::<String>::new();
        let mut last=Value::Null;
        let progressed=time::timeout(Duration::from_secs(40),async {
            loop {
                let answer=phone.op(query.clone()).await.unwrap();
                let rows=answer["ok"]["rows"].as_array().cloned().unwrap_or_default();
                for row in &rows {
                    let Some(id)=row["entry"].as_str().and_then(EntryId::from_hex) else {continue;};
                    if let Some((_,expected))=members.iter().find(|(entry,_)|*entry==id) {
                        if row["title"]==*expected {
                            assert!(row["readOnly"].is_boolean(),"write readiness is explicit even with frontier recovery");
                            assert_eq!(row["checkpoint"]["partial"],true);
                            observed.insert(id);
                        }
                    }
                }
                assert_ne!(answer["ok"]["scope"]["localComplete"],true);
                assert_ne!(answer["ok"]["scope"]["completeAtOwnerCut"],true);
                let hint=&answer["ok"]["scope"]["discovery"];
                let mut wanted=Vec::<String>::new();
                if hint["basis"]=="owner-attested-cut" {
                    for id in hint["pendingEntries"].as_array().into_iter().flatten().filter_map(Value::as_str) {wanted.push(id.to_owned());}
                    if let Some(id)=hint["entry"].as_str(){wanted.push(id.to_owned());}
                }
                for row in rows {if let Some(id)=row["entry"].as_str(){if !wanted.iter().any(|old|old==id){wanted.push(id.to_owned());}}}
                wanted.truncate(512);
                last=answer;
                if observed.len()==members.len(){break;}
                if wanted!=prior {
                    revision+=1;
                    phone.op(json!({"op":"demand","scope":lease,"revision":revision,"entries":wanted,"queries":queries})).await.unwrap();
                    prior=wanted;
                }
                time::sleep(Duration::from_millis(20)).await;
            }
        }).await;
        let ids:Vec<_>=members.iter().map(|(id,_)|*id).collect();
        let still_incomplete=phone.read(move|lab,me| ids.iter().all(|id|lab.history(me,*id).is_none_or(|history|history.changes().len()<4)) && lab.item(me,unrelated).is_none()).await;
        drop(stalled);
        phone.shutdown().await.unwrap();mac.shutdown().await.unwrap();
        drop(phone); drop(mac);
        std::fs::remove_dir_all(folder).unwrap();
        assert!(progressed.is_ok(),"only {} of 12 read-only members advanced; last query {last}",observed.len());
        assert_eq!(observed.len(),12);
        assert!(still_incomplete,"checkpoint visibility must not depend on ordinary history/unrelated sync");
    }

}
