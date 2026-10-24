//! Targeted historical bodies over the ordinary authenticated peer connection.
use super::*;
use avendb::id::EntryId;
pub(crate) const KIND: u8 = 21;
pub(crate) const LIMIT: usize = 1 + 32 + 1 + 32 * 32;
const RESPONSE: usize = 512 << 10;
const DEADLINE: Duration = Duration::from_secs(2);
fn request(bytes: &[u8]) -> Result<(EntryId, Vec<EditId>)> {
    anyhow::ensure!(
        bytes.len() >= 34 && bytes.len() <= LIMIT && bytes[0] == 1,
        "dependency request version/size"
    );
    let count = bytes[33] as usize;
    anyhow::ensure!(
        count > 0 && count <= 32 && bytes.len() == 34 + count * 32,
        "dependency request count"
    );
    let entry = EntryId(bytes[1..33].try_into().unwrap());
    let ids: Vec<_> = bytes[34..]
        .chunks_exact(32)
        .map(|b| EditId(b.try_into().unwrap()))
        .collect();
    anyhow::ensure!(
        ids.iter().copied().collect::<BTreeSet<_>>().len() == ids.len(),
        "duplicate dependency IDs"
    );
    Ok((entry, ids))
}
pub(crate) async fn answer(
    shared: &Arc<Shared>,
    peer: &Peer,
    bytes: &[u8],
    permit: Arc<tokio::sync::OwnedSemaphorePermit>,
) -> Result<Vec<u8>> {
    let (entry, ids) = request(bytes)?;
    let requester = peer.device;
    let (revision, reply) = shared
        .read(move |lab, me| {
            let _permit = permit;
            (
                lab.log(me).revision(),
                lab.owner_base_dependency_reply(me, requester, entry, &ids),
            )
        })
        .await;
    let bytes = reply
        .unwrap_or(Reply {
            edits: vec![],
            blobs: vec![],
            more: false,
        })
        .to_wire();
    anyhow::ensure!(bytes.len() <= RESPONSE, "dependency response size");
    anyhow::ensure!(
        shared
            .read(move |lab, me| lab.log(me).revision() == revision)
            .await,
        "dependency policy changed"
    );
    Ok(bytes)
}
fn validate_reply(reply: &Reply, entry: EntryId, ids: &[EditId]) -> Result<()> {
    anyhow::ensure!(
        !reply.more && reply.blobs.is_empty() && reply.edits.len() <= ids.len(),
        "unexpected dependency payload"
    );
    anyhow::ensure!(
        reply.edits.iter().all(|s| ids.contains(&s.edit.id())
            && matches!(s.edit.action,avendb::policy::Action::Write{entry:e,..}if e==entry)),
        "dependency outside requested entry/cut"
    );
    anyhow::ensure!(
        reply
            .edits
            .iter()
            .map(|s| s.edit.id())
            .collect::<BTreeSet<_>>()
            .len()
            == reply.edits.len(),
        "duplicate dependency reply IDs"
    );
    Ok(())
}
impl Shared {
    /// One bounded sweep; disconnected/legacy peers leave the exact wait visible.
    /// The caller backs off between unresolved sweeps, while new local work wakes it.
    pub(crate) async fn fetch_owner_dependencies(self: &Arc<Self>) -> bool {
        let mut missing = self
            .read_class(lab_schedule::Class::Background, |lab, me| {
                lab.owner_base_missing(me)
                    .into_iter()
                    .filter_map(|(entry, ids)| {
                        let ids: Vec<_> = ids
                            .into_iter()
                            .filter(|id| lab.signed_edit(me, *id).is_none())
                            .take(32)
                            .collect();
                        (!ids.is_empty()).then_some((entry, ids))
                    })
                    .take(16)
                    .collect::<Vec<_>>()
            })
            .await;
        if missing.is_empty() {
            return false;
        }
        let offset = self.dependency_peer_turn.load(Ordering::Relaxed) % missing.len();
        missing.rotate_left(offset);
        missing.truncate(4);
        let peers: Vec<_> = {
            let peers = self.peers.lock().expect("peers");
            let start =
                self.dependency_peer_turn.fetch_add(3, Ordering::Relaxed) % peers.len().max(1);
            peers
                .values()
                .cycle()
                .skip(start)
                .take(peers.len().min(3))
                .cloned()
                .collect()
        };
        for (entry, ids) in missing {
            for peer in &peers {
                if let Err(error) = self
                    .fetch_owner_dependency_batch(peer, entry, ids.clone())
                    .await
                {
                    tracing::debug!(%error,"avendb: targeted dependency retry remains pending");
                }
                let unresolved = self
                    .read(move |lab, me| {
                        lab.owner_base_missing(me).iter().any(|(e, _)| *e == entry)
                    })
                    .await;
                if !unresolved {
                    break;
                }
            }
        }
        self.read(|lab, me| !lab.owner_base_missing(me).is_empty())
            .await
    }
    async fn fetch_owner_dependency_batch(
        self: &Arc<Self>,
        peer: &Peer,
        entry: EntryId,
        ids: Vec<EditId>,
    ) -> Result<()> {
        let mut body = vec![1];
        body.extend(entry.0);
        body.push(ids.len() as u8);
        for id in &ids {
            body.extend(id.0);
        }
        let permit = time::timeout(DEADLINE, self.pulls.page(false, true)).await??;
        let bytes = time::timeout(
            DEADLINE,
            session::exchange(&peer.conn, KIND, &body, RESPONSE),
        )
        .await??;
        let reply = Reply::from_wire(&bytes)?;
        validate_reply(&reply, entry, &ids)?;
        if reply.edits.is_empty() {
            return Ok(());
        }
        #[cfg(not(target_arch = "wasm32"))]
        let (prepared, permit, activity, ()) = self
            .prepare_received_page(
                reply.edits,
                permit,
                (),
                #[cfg(test)]
                None,
            )
            .await?;
        #[cfg(target_arch = "wasm32")]
        let (prepared, permit, activity, ()) =
            self.prepare_received_page(reply.edits, permit, ()).await?;
        self.try_lab_class(lab_schedule::Class::Background, move |lab, me| {
            let (_permit, _activity) = (permit, activity);
            lab.receive_prepared(me, prepared, true);
        })
        .await?;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dependency_request_is_exact_and_bounded() {
        let mut b = vec![1];
        b.extend([7; 32]);
        b.push(1);
        b.extend([8; 32]);
        assert_eq!(request(&b).unwrap().1, vec![EditId([8; 32])]);
        for n in [0, 33, 65] {
            assert!(request(&b[..n]).is_err());
        }
        b[0] = 2;
        assert!(request(&b).is_err());
        b[0] = 1;
        b[33] = 2;
        b.extend([8; 32]);
        assert!(request(&b).is_err());
    }
}

#[cfg(test)]
mod network_tests {
    use super::*;
    use avendb::cast::{document, human_on};
    use n0_future::future;
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn exact_dependency_arriving_late_is_received_without_unrelated_history() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let replacement_device = lab.device_of(owner, "Replacement");
        let vault = human_on(&mut lab, owner, &[mac, phone, replacement_device]);
        let entry = lab
            .create(mac, vault, vault, "note", &[], document("A", "old", mac))
            .unwrap();
        lab.sync(mac, phone);
        let baseline = lab.backup(mac);
        let wanted = lab
            .edit(mac, vault, entry, |i| i.set_text(2, "needed"))
            .unwrap();
        let signed = lab.signed_edit(mac, wanted).unwrap().clone();
        let bad = Reply {
            edits: vec![signed.clone(), signed.clone()],
            blobs: vec![],
            more: false,
        };
        assert!(
            validate_reply(&bad, entry, &[wanted, EditId([99; 32])]).is_err(),
            "duplicates cannot consume signature work as distinct requested edits"
        );
        let one = Reply {
            edits: vec![signed.clone()],
            blobs: vec![],
            more: false,
        };
        assert!(validate_reply(&one, EntryId([99; 32]), &[wanted]).is_err());

        let unrelated = lab
            .create(
                mac,
                vault,
                vault,
                "note",
                &[],
                document("B", "unrelated", mac),
            )
            .unwrap();
        // split moves device/signing state. Author every test edit first, then give
        // the initial provider only its old baseline and the replacement the full copy.
        let later = lab
            .edit(mac, vault, entry, |i| i.set_text(2, "after peer loss"))
            .unwrap();
        lab.sync(mac, replacement_device);
        let replacement_lab = lab.split(replacement_device, &[], [83; 32]);
        let receiver = lab.split(phone, &[], [82; 32]);
        let mut provider = lab.split(mac, &[owner], [81; 32]);
        provider.restore_backup(mac, &baseline);
        let sender = Node::spawn(provider, mac, Options::local()).await.unwrap();
        let receiver = Node::spawn(receiver, phone, Options::local())
            .await
            .unwrap();
        let mut stalled = Vec::new();
        loop {
            let mut p = Box::pin(receiver.shared.pulls.enter(false, None));
            let Some(p) = future::poll_once(&mut p).await else {
                break;
            };
            stalled.push(p.unwrap());
        }
        receiver.know(sender.addr());
        sender.know(receiver.addr());
        let peer = receiver.shared.connection(sender.id()).await.unwrap();
        receiver
            .shared
            .fetch_owner_dependency_batch(&peer, entry, vec![wanted])
            .await
            .unwrap();
        assert!(
            receiver
                .read(move |lab, me| lab.signed_edit(me, wanted).is_none())
                .await
        );
        sender
            .act(move |lab, me| lab.receive(me, vec![signed], vec![]))
            .await;
        receiver
            .shared
            .fetch_owner_dependency_batch(&peer, entry, vec![wanted])
            .await
            .unwrap();
        assert!(
            receiver
                .read(move |lab, me| lab.signed_edit(me, wanted).is_some()
                    && lab.item(me, unrelated).is_none())
                .await
        );
        sender.shutdown().await.unwrap();
        assert!(
            receiver
                .shared
                .fetch_owner_dependency_batch(&peer, entry, vec![wanted])
                .await
                .is_err(),
            "lost peer is a retryable transport failure"
        );
        let replacement = Node::spawn(replacement_lab, replacement_device, Options::local())
            .await
            .unwrap();
        receiver.know(replacement.addr());
        replacement.know(receiver.addr());
        let peer = receiver.shared.connection(replacement.id()).await.unwrap();
        receiver
            .shared
            .fetch_owner_dependency_batch(&peer, entry, vec![later])
            .await
            .unwrap();
        assert!(
            receiver
                .read(move |lab, me| lab.signed_edit(me, later).is_some()
                    && lab.item(me, unrelated).is_none())
                .await
        );
        replacement.shutdown().await.unwrap();
        drop(stalled);
        receiver.shutdown().await.unwrap();
    }
}
