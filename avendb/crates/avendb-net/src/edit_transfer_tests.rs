use super::*;
use crate::{Node, Options, disk};
use avendb::cast::{document, todos_on, world};
use avendb::id::{EditId, EntryId};
use avendb::policy::{Action, Revoking};
use avendb::wire::{Packed, Reply, Wire};

struct Folder(std::path::PathBuf);
impl Folder {
    fn new() -> Self {
        let mut n = [0; 16];
        getrandom::fill(&mut n).unwrap();
        let p = std::env::temp_dir().join(format!(
            "avendb-edit-ranges-{}",
            data_encoding::HEXLOWER.encode(&n)
        ));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
    fn options(&self) -> Options {
        Options {
            shelf: Some(disk::open(&self.0).unwrap()),
            lazy: true,
            ..Options::local()
        }
    }
}
impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn asking(entry: EntryId) -> Asking {
    let mut request = Asking::default();
    request.ask.haves.insert(LogId::Entry(entry), vec![]);
    request
}
// Receiving the listener's Hello FIN does not mean Protocol::accept has installed
// the peer yet. These raw endpoints cannot accept a second, reverse-direction dial.
async fn registered(node: &Node, endpoint: iroh::EndpointId) {
    n0_future::time::timeout(Duration::from_secs(5), async {
        while node.shared.live(endpoint).is_none() {
            n0_future::time::sleep(Duration::from_millis(1)).await;
        }
    }).await.expect("the listener registers the authenticated raw peer");
}
async fn exchange(peer: &Peer, request: Request) -> Result<Vec<u8>> {
    let request = request.encode()?;
    n0_future::time::timeout(
        Duration::from_secs(15),
        session::exchange(&peer.conn, ranges::KIND, &request, wire::FETCH_BYTES),
    )
    .await
    .context("test exchange deadline")?
}
async fn begin(peer: &Peer, entry: EntryId) -> Offer {
    Offer::decode(
        &exchange(
            peer,
            Request::Begin {
                asking: asking(entry),
                known: None,
            },
        )
        .await
        .unwrap(),
    )
    .unwrap()
}
async fn offered(peer: &Peer, offer: &Offer) -> BTreeSet<EditId> {
    let budget = Budget::new(32 << 20);
    let local = Tree::new(vec![], &budget).unwrap();
    let mut round = Round::new(offer.tree, &budget).unwrap();
    loop {
        let prefixes = round.next(&local).unwrap();
        if prefixes.is_empty() {
            break;
        }
        let bytes = exchange(
            peer,
            Request::Nodes {
                binding: offer.binding,
                prefixes,
            },
        )
        .await
        .unwrap();
        for (p, b) in wire::decode_nodes(&bytes, offer.binding).unwrap() {
            round.accept(p, b, &local).unwrap();
        }
    }
    round.finish().unwrap().ids().clone()
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn serving_permit_survives_cancelled_waiter_until_the_blocking_owner_exits() {
    let runtime = Runtime::default();
    let mut held = (0..RESPONSES)
        .map(|_| runtime.serving().unwrap())
        .collect::<Vec<_>>();
    let worker = held.pop().unwrap();
    let retained = worker.clone();
    let (started, ready) = std::sync::mpsc::channel();
    let (finish, finished) = std::sync::mpsc::channel();
    let work = tokio::task::spawn_blocking(move || {
        let _retained = retained;
        started.send(()).unwrap();
        finished.recv().unwrap();
    });
    ready.recv_timeout(Duration::from_secs(3)).unwrap();
    drop(worker);
    work.abort();
    assert!(
        runtime.serving().is_err(),
        "an aborted waiter cannot release the worker's response bytes"
    );
    finish.send(()).unwrap();
    let _ = work.await;
    let until = Instant::now() + Duration::from_secs(3);
    while runtime.serving().is_err() {
        assert!(Instant::now() < until);
        n0_future::time::sleep(Duration::from_millis(1)).await;
    }
    drop(held);
    assert_eq!(runtime.response.available_permits(), RESPONSES);
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_protocol_scopes_proofs_revocation_expiry_and_cumulative_limits() {
    let mut w = world();
    let todos = todos_on(&mut w);
    w.lab.sync_all(0);
    let (sender, reader, other) = (w.mac_a, w.mac_c, w.mac_b);
    let (a, b, c) = (Folder::new(), Folder::new(), Folder::new());
    let mac = Node::spawn(w.lab.split(sender, &[], [201; 32]), sender, a.options())
        .await
        .unwrap();
    let carol = Node::spawn(w.lab.split(reader, &[], [202; 32]), reader, b.options())
        .await
        .unwrap();
    let bob = Node::spawn(w.lab.split(other, &[], [203; 32]), other, c.options())
        .await
        .unwrap();
    mac.shared.save().await.unwrap();
    carol.know(mac.addr());
    bob.know(mac.addr());
    let peer = carol.shared.connection(mac.id()).await.unwrap();
    let peer2 = bob.shared.connection(mac.id()).await.unwrap();
    // Diagnose the authorized server path before testing the opaque wire reset behavior.
    let serving_peer = mac.shared.live(carol.id()).expect("authenticated server peer");
    let request = Request::Begin { asking: asking(todos.door), known: None }.encode().unwrap();
    handle(&mac.shared, &serving_peer, &request, mac.shared.edit_transfer.serving().unwrap()).await.expect("authorized direct BEGIN");
    let offer = begin(&peer, todos.door).await;
    assert!(offer.root.verify());
    let ids = offered(&peer, &offer).await;
    assert!(!ids.is_empty());
    assert!(
        exchange(
            &peer2,
            Request::Fetch {
                binding: offer.binding,
                ids: ids.clone()
            }
        )
        .await
        .is_err(),
        "another authenticated peer cannot reuse a stage"
    );
    let bytes = exchange(
        &peer,
        Request::Fetch {
            binding: offer.binding,
            ids: ids.clone(),
        },
    )
    .await
    .unwrap();
    let (records, more) =
        wire::decode_fetch(&bytes, offer.binding, &offer.root, sender, &ids).unwrap();
    assert!(!more);
    assert!(records.iter().all(|r| r.verify().is_ok()));
    let mut foreign = offer.binding;
    foreign.scope[0] ^= 1;
    assert!(
        exchange(
            &peer,
            Request::Nodes {
                binding: foreign,
                prefixes: vec![vec![]]
            }
        )
        .await
        .is_err(),
        "different scope cannot reuse root/count queries"
    );
    let offer = begin(&peer, todos.door).await;
    {
        let stages = mac.shared.edit_transfer.stages.lock().unwrap();
        let stage = stages.get(&offer.binding.token).unwrap();
        stage.used.lock().unwrap().fetch = ranges::ROUND_FETCH_BYTES;
    }
    assert!(
        exchange(
            &peer,
            Request::Fetch {
                binding: offer.binding,
                ids: ids.clone()
            }
        )
        .await
        .is_err()
    );
    assert!(
        !mac.shared
            .edit_transfer
            .stages
            .lock()
            .unwrap()
            .contains_key(&offer.binding.token),
        "quota error retires staging"
    );
    let offer = begin(&peer, todos.door).await;
    {
        let mut stages = mac.shared.edit_transfer.stages.lock().unwrap();
        let stage = Arc::get_mut(stages.get_mut(&offer.binding.token).unwrap()).unwrap();
        stage.began = Instant::now() - AGE - Duration::from_secs(1);
    }
    mac.shared.edit_transfer.expire();
    assert!(
        !mac.shared
            .edit_transfer
            .stages
            .lock()
            .unwrap()
            .contains_key(&offer.binding.token),
        "maintenance needs no next packet"
    );
    let offer = begin(&peer, todos.door).await;
    // Persist the authorized tree, then receive another author's journal-only revocation. Neither the old
    // compacted head nor this node's own signer root changes; the complete-history binding must still invalidate it.
    mac.shared.save().await.unwrap();
    let root_before = mac.shared.signers.as_ref().unwrap().published().unwrap().root().root;
    let compacted_before = mac.shared.edits.as_ref().unwrap().checked();
    let by = w.phone_a;
    let revoked = w.lab.submit(by, &[by], Action::Revoke(Revoking::Grant {
        share: todos.carol_read, actor: w.alice, keep: vec![], via: vec![],
    })).unwrap();
    let revoked = w.lab.signed_edit(by, revoked).unwrap().clone();
    // A paged receive can defer key refresh (and its own signed key rolls); permission replay must
    // still revoke this scope immediately, even before that independent catch-up phase.
    assert_eq!(mac.try_act(move |lab, me| lab.receive_whose_now(me, vec![revoked], vec![], false).0).await.unwrap(), 1);
    assert!(
        exchange(
            &peer,
            Request::Fetch {
                binding: offer.binding,
                ids: ids.clone()
            }
        )
        .await
        .is_err(),
        "a revocation between begin/fetch rejects every payload"
    );
    assert!(
        exchange(
            &peer,
            Request::Nodes {
                binding: offer.binding,
                prefixes: vec![vec![]]
            }
        )
        .await
        .is_err(),
        "and discloses no old subtree/count"
    );
    mac.shared.save().await.unwrap();
    assert_eq!(mac.shared.signers.as_ref().unwrap().published().unwrap().root().root, root_before);
    assert_eq!(mac.shared.edits.as_ref().unwrap().checked(), compacted_before);
    assert!(
        exchange(
            &peer,
            Request::Begin {
                asking: asking(todos.door),
                known: None
            }
        )
        .await
        .is_err(),
        "revoked scope cannot receive a new root"
    );
    carol.shutdown().await.unwrap();
    bob.shutdown().await.unwrap();
    mac.shutdown().await.unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sparse_payloads_are_followed_by_reconstructed_legacy_reconciliation() {
    let mut w = world();
    let coop = avendb::cast::handbook_ready(&mut w);
    let (sender, receiver) = (w.mac_a, w.phone_a);
    let entry = w
        .lab
        .create(
            sender,
            coop,
            coop,
            "doc",
            &[],
            document("Range", "before", sender),
        )
        .unwrap();
    w.lab.sync_all(0);
    let (a, b) = (Folder::new(), Folder::new());
    let mac = Node::spawn(w.lab.split(sender, &[], [204; 32]), sender, a.options())
        .await
        .unwrap();
    let phone = Node::spawn(w.lab.split(receiver, &[], [205; 32]), receiver, b.options())
        .await
        .unwrap();
    for i in 0..20 {
        mac.try_act(move |lab, me| {
            lab.edit(me, coop, entry, |doc| {
                doc.set_text(2, &format!("after {i}"))
            })
        })
        .await
        .unwrap()
        .unwrap();
    }
    mac.shared.save().await.unwrap();
    phone.know(mac.addr());
    let peer = phone.shared.connection(mac.id()).await.unwrap();
    let logs = [LogId::Entry(entry)].into();
    let admission = phone.shared.pulls.enter(false, None).await.unwrap();
    let serving_peer = mac.shared.live(phone.id()).expect("authenticated server peer");
    let request = Request::Begin { asking: asking(entry), known: None }.encode().unwrap();
    handle(&mac.shared, &serving_peer, &request, mac.shared.edit_transfer.serving().unwrap()).await.expect("sparse direct BEGIN");
    let (sparse, attempted) = receive(&phone.shared, &peer, &logs, admission).await;
    attempted.unwrap();
    assert_eq!(sparse, 20, "only absent own-signer writes transfer");
    // Remove one locally through an authoritative restore. Sparse reconciliation must find a hole even though a
    // later causal head is present; ordinary frontier reconciliation alone can believe the interior is complete.
    let removed = phone
        .try_act(move |lab, me| {
            let all = lab.backup(me);
            let id = all
                .signed()
                .iter()
                .filter(|s| matches!(s.edit.action,Action::Write{entry:e,..} if e==entry))
                .nth(5)
                .unwrap()
                .edit
                .id();
            let signed = all
                .signed()
                .iter()
                .filter(|s| s.edit.id() != id)
                .cloned()
                .collect::<Vec<_>>();
            lab.restore_backup(me, &avendb::lab::Backup::new(signed, []));
            id
        })
        .await
        .unwrap();
    let new = phone
        .shared
        .pull(mac.id(), crate::Scope::Logs(logs), true, None)
        .await
        .unwrap();
    assert!(new >= 1);
    assert!(
        phone
            .read(move |lab, me| lab.signed_edit(me, removed).is_some())
            .await,
        "interior gap recovered"
    );
    let request = phone
        .read(move |lab, me| {
            session::only(
                lab,
                me,
                lab.request(me, sender),
                &[LogId::Entry(entry)].into(),
            )
        })
        .await;
    let bytes = session::exchange(
        &peer.conn,
        session::ASK_LOGS | session::PACKED,
        &request.to_wire(),
        session::REPLY_LIMIT,
    )
    .await
    .unwrap();
    assert!(
        Packed::from_wire(&bytes).unwrap().0.edits.is_empty(),
        "the recomputed legacy request has reconciled all scoped records"
    );
    phone.shutdown().await.unwrap();
    mac.shutdown().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_legacy_peer_refusal_reconstructs_original_request_and_is_remembered() {
    use iroh::endpoint::presets;
    use iroh::{Endpoint, SecretKey};
    use std::sync::atomic::AtomicUsize;
    let mut w = world();
    let coop = avendb::cast::handbook_ready(&mut w);
    let (old, receiver) = (w.mac_a, w.phone_a);
    let entry = w
        .lab
        .create(
            old,
            coop,
            coop,
            "doc",
            &[],
            document("Legacy", "before", old),
        )
        .unwrap();
    w.lab.sync_all(0);
    let folder = Folder::new();
    let phone = Node::spawn(
        w.lab.split(receiver, &[], [206; 32]),
        receiver,
        folder.options(),
    )
    .await
    .unwrap();
    w.lab
        .edit(old, coop, entry, |doc| doc.set_text(2, "from an old peer"))
        .unwrap();
    let raw = Endpoint::builder(presets::Empty)
        .secret_key(SecretKey::from_bytes(&w.lab.endpoint_secret(old).unwrap()))
        .crypto_provider(crate::pq_provider())
        .clear_ip_transports()
        .bind_addr("127.0.0.1:0")
        .unwrap()
        .bind()
        .await
        .unwrap();
    let conn = raw.connect(phone.addr(), crate::ALPN).await.unwrap();
    let exporter = crate::exporter(&conn).unwrap();
    let (mut send, mut recv) = conn.open_bi().await.unwrap();
    send.write_all(&w.lab.hello(old, &exporter, true).unwrap().to_wire())
        .await
        .unwrap();
    send.finish().unwrap();
    let hello = avendb::sign::Hello::from_wire(&recv.read_to_end(64 << 10).await.unwrap()).unwrap();
    assert_eq!(
        hello.verify(&exporter, false, phone.id().as_bytes()),
        Some(receiver)
    );
    registered(&phone, raw.id()).await;
    let probes = Arc::new(AtomicUsize::new(0));
    let pages = Arc::new(AtomicUsize::new(0));
    let (seen, sent) = (probes.clone(), pages.clone());
    let serving = conn.clone();
    let server = tokio::spawn(async move {
        while let Ok((mut send, mut recv)) = serving.accept_bi().await {
            let request = recv.read_to_end(session::MESSAGE_LIMIT).await.unwrap();
            let (&kind, body) = request.split_first().unwrap();
            match kind {
                ranges::KIND => {
                    seen.fetch_add(1, Ordering::Relaxed);
                    send.reset(session::REFUSED).ok();
                }
                k if k & !session::PACKED == session::ASK_LOGS => {
                    let request = Asking::from_wire(body).unwrap();
                    let scope = ReplyScope::Logs(request.ask.haves.keys().copied().collect());
                    let (edits, _, more) =
                        w.lab.reply_in(old, receiver, &request, 64 << 10, &scope);
                    sent.fetch_add(1, Ordering::Relaxed);
                    let reply = Reply {
                        edits,
                        blobs: vec![],
                        more,
                    };
                    let bytes = if k & session::PACKED != 0 {
                        Packed(reply).to_wire()
                    } else {
                        reply.to_wire()
                    };
                    send.write_all(&bytes).await.unwrap();
                    send.finish().ok();
                }
                session::ANNOUNCE | session::STATE => {
                    send.finish().ok();
                }
                _ => {
                    send.reset(session::REFUSED).ok();
                }
            }
        }
    });
    let endpoint = raw.id();
    let logs = [LogId::Entry(entry)].into();
    assert!(
        phone
            .shared
            .pull(endpoint, crate::Scope::Logs(logs), true, None)
            .await
            .unwrap()
            > 0
    );
    assert_eq!(probes.load(Ordering::Relaxed), 1);
    assert!(pages.load(Ordering::Relaxed) > 0);
    let before = pages.load(Ordering::Relaxed);
    phone
        .shared
        .pull(
            endpoint,
            crate::Scope::Logs([LogId::Entry(entry)].into()),
            true,
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        probes.load(Ordering::Relaxed),
        1,
        "old connection is not reprobed for every entry batch"
    );
    assert!(
        pages.load(Ordering::Relaxed) > before,
        "ordinary reconciliation still runs"
    );
    phone.shutdown().await.unwrap();
    raw.close().await;
    server.await.unwrap();
}

#[test]
fn refused_begin_is_a_bounded_retry_hint_not_a_connection_capability_verdict() {
    let runtime = Runtime::default();
    runtime.refused(1);
    assert!(runtime.unavailable(1), "immediate legacy retries do not reprobe an old peer");
    runtime.unsupported.lock().unwrap().insert(1, Instant::now() - Duration::from_secs(1));
    assert!(!runtime.unavailable(1), "an expired transient refusal permits a later scope without reconnecting");
    for generation in 0..100 { runtime.refused(generation); }
    assert!(runtime.unsupported.lock().unwrap().len() <= 64);
    runtime.unsupported.lock().unwrap().insert(100, Instant::now() - Duration::from_secs(1));
    runtime.expire();
    assert!(!runtime.unsupported.lock().unwrap().contains_key(&100), "maintenance also removes idle hints");
    runtime.gone(99);
    assert!(!runtime.unavailable(99));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn accepted_sparse_page_then_reset_counts_with_legacy_completion() {
    use iroh::endpoint::presets;
    use iroh::{Endpoint, SecretKey};
    let mut w = world();
    let coop = avendb::cast::handbook_ready(&mut w);
    let (sender, receiver) = (w.mac_a, w.phone_a);
    let entry = w.lab.create(sender, coop, coop, "doc", &[], document("Partial", "before", sender)).unwrap();
    w.lab.sync_all(0);
    let folder = Folder::new();
    let phone = Node::spawn(w.lab.split(receiver, &[], [207; 32]), receiver, folder.options()).await.unwrap();
    let first = w.lab.edit(sender, coop, entry, |doc| doc.set_text(2, "first sparse page")).unwrap();
    let second = w.lab.edit(sender, coop, entry, |doc| doc.set_text(2, "second legacy page")).unwrap();
    let ids: BTreeSet<_> = [first, second].into();
    let tree = Tree::new(ids.iter().copied().collect(), &Budget::default()).unwrap();
    // A raw authenticated fixture supplies valid evidence for real signed records, then resets the second fetch.
    // This intentionally faulty peer has no production storage responsibilities; the receiving Node is unchanged.
    let mut ledger = avendb::batch::SignerLog::wrap(sender, [first, second]);
    assert!(ledger.publish(w.lab.sign_persisted_root(ledger.durable_root().unwrap()).unwrap()));
    let root = ledger.signed().unwrap().clone();
    let raw = Endpoint::builder(presets::Empty)
        .secret_key(SecretKey::from_bytes(&w.lab.endpoint_secret(sender).unwrap()))
        .crypto_provider(crate::pq_provider()).clear_ip_transports().bind_addr("127.0.0.1:0").unwrap()
        .bind().await.unwrap();
    let conn = raw.connect(phone.addr(), crate::ALPN).await.unwrap();
    let exporter = crate::exporter(&conn).unwrap();
    let (mut send, mut recv) = conn.open_bi().await.unwrap();
    send.write_all(&w.lab.hello(sender, &exporter, true).unwrap().to_wire()).await.unwrap();
    send.finish().unwrap();
    let hello = avendb::sign::Hello::from_wire(&recv.read_to_end(64 << 10).await.unwrap()).unwrap();
    assert_eq!(hello.verify(&exporter, false, phone.id().as_bytes()), Some(receiver));
    registered(&phone, raw.id()).await;
    let fetches = Arc::new(AtomicUsize::new(0));
    let legacy_edits = Arc::new(AtomicUsize::new(0));
    let legacy_pages = Arc::new(AtomicUsize::new(0));
    let (fetched, legacy, pages) = (fetches.clone(), legacy_edits.clone(), legacy_pages.clone());
    let serving = conn.clone();
    let server = tokio::spawn(async move {
        let mut binding = None;
        while let Ok((mut send, mut recv)) = serving.accept_bi().await {
            let request = recv.read_to_end(session::MESSAGE_LIMIT).await.unwrap();
            let (&kind, body) = request.split_first().unwrap();
            let bytes = match kind {
                ranges::KIND => match Request::decode(body).unwrap() {
                    Request::Begin { asking, .. } => {
                        let next = Binding { token: [33; 16], scope: wire::scope(&asking), root: *blake3::hash(&root.root.message()).as_bytes() };
                        binding = Some(next);
                        Offer { binding: next, tree: tree.root(), root: root.clone(), prefix: vec![] }.encode().unwrap()
                    }
                    Request::Nodes { binding: got, prefixes } => {
                        assert_eq!(Some(got), binding);
                        let nodes = prefixes.into_iter().map(|prefix| { let block = tree.block(&prefix).unwrap(); (prefix, block) }).collect::<Vec<_>>();
                        wire::encode_nodes(got, &nodes).unwrap()
                    }
                    Request::Fetch { binding: got, ids: wanted } => {
                        assert_eq!(Some(got), binding);
                        if fetched.fetch_add(1, Ordering::Relaxed) != 0 {
                            assert_eq!(wanted, [second].into());
                            send.reset(session::REFUSED).ok();
                            continue;
                        }
                        assert_eq!(wanted, ids);
                        let signed = w.lab.signed_edit(sender, first).unwrap().clone();
                        wire::encode_fetch(got, &[(signed, ledger.proof(first).unwrap().path)], true).unwrap()
                    }
                    Request::End { .. } => vec![],
                },
                k if k & !session::PACKED == session::ASK_LOGS => {
                    let request = Asking::from_wire(body).unwrap();
                    let scope = ReplyScope::Logs(request.ask.haves.keys().copied().collect());
                    let (edits, _, more) = w.lab.reply_in(sender, receiver, &request, 64 << 10, &scope);
                    assert!(edits.iter().all(|signed| signed.edit.id() != first), "legacy request must suppress the accepted sparse record");
                    legacy.fetch_add(edits.len(), Ordering::Relaxed);
                    pages.fetch_add(1, Ordering::Relaxed);
                    let reply = Reply { edits, blobs: vec![], more };
                    if k & session::PACKED != 0 { Packed(reply).to_wire() } else { reply.to_wire() }
                }
                session::ANNOUNCE | session::STATE => vec![],
                _ => { send.reset(session::REFUSED).ok(); continue; }
            };
            send.write_all(&bytes).await.unwrap();
            send.finish().ok();
        }
    });
    let scope = crate::Scope::Logs([LogId::Entry(entry)].into());
    let new = phone.shared.pull(raw.id(), scope, true, None).await.unwrap();
    assert_eq!(fetches.load(Ordering::Relaxed), 2, "one real sparse page succeeds before a forced reset");
    assert_eq!(legacy_edits.load(Ordering::Relaxed), 1, "legacy completes the other edit");
    assert_eq!(new, 2, "a failed optional attempt must retain its already accepted edit count");
    assert!(phone.read(move |lab, me| [first, second].iter().all(|id| lab.signed_edit(me, *id).is_some())).await);
    let before = legacy_pages.load(Ordering::Relaxed);
    let again = phone.shared.pull(raw.id(), crate::Scope::Logs([LogId::Entry(entry)].into()), true, None).await.unwrap();
    assert_eq!(again, 0, "completed edits are not counted twice");
    assert!(legacy_pages.load(Ordering::Relaxed) > before, "legacy still runs when sparse reconciliation finds nothing missing");
    phone.shutdown().await.unwrap();
    raw.close().await;
    server.await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn accepted_count_waits_for_cancelled_blocking_validation() {
    let (accepted, mut done) = Accepted::channel();
    let counted = accepted.clone();
    let (started, running) = tokio::sync::oneshot::channel();
    let (finish, finished) = std::sync::mpsc::channel();
    let waiter = tokio::spawn(async move {
        tokio::task::spawn_blocking(move || {
            started.send(()).unwrap();
            finished.recv().unwrap();
            counted.new.fetch_add(1, Ordering::Relaxed);
        }).await.unwrap();
    });
    running.await.unwrap();
    waiter.abort();
    let _ = waiter.await;
    drop(accepted);
    assert!(matches!(done.try_recv(), Err(tokio::sync::oneshot::error::TryRecvError::Empty)), "cancelling a waiter does not publish a premature count");
    finish.send(()).unwrap();
    assert_eq!(n0_future::time::timeout(Duration::from_secs(3), done).await.unwrap().unwrap(), 1);
}
