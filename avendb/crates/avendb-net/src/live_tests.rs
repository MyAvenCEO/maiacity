//! Runtime acceptance corresponding to spec/AvenDB/LivePriority.lean. These fixtures use ordinary authenticated
//! peers and the PQ transport; no database server or relay is spawned. Timing is a test timeout, not a theorem.
use super::*;
use crate::{Node, Options};
use avendb::cast::{document, handbook_ready, world};
use avendb::wire::Wire;
use n0_future::future;
use std::time::Instant;
use tokio::sync::watch;

async fn wait_for(mut condition: impl AsyncFnMut() -> bool) {
    time::timeout(Duration::from_secs(20), async {
        while !condition().await {
            time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("the local peer operation completes");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_live_edit_reaches_an_authorized_peer_while_its_background_pages_are_stalled_without_server()
 {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (sender, receiver) = (w.mac_a, w.phone_a);
    let mac = Node::spawn(w.lab.split(sender, &[], [51; 32]), sender, Options::local())
        .await
        .unwrap();
    let phone = Node::spawn(
        w.lab.split(receiver, &[], [52; 32]),
        receiver,
        Options::local(),
    )
    .await
    .unwrap();
    phone.know(mac.addr());
    mac.know(phone.addr());
    phone.sync_with(mac.id()).await.unwrap();
    wait_for(async || mac.shared.told.lock().unwrap().contains_key(&receiver)).await;
    wait_for(async || phone.shared.differ(sender).await.is_empty()).await;

    // Occupy all background page slots, leaving the reserved interactive slot free. An existing broad pull is
    // now unable to finish; simply setting asking.again (the previous behavior) cannot deliver the next edit.
    let mut stalled = Vec::new();
    loop {
        let mut page = Box::pin(phone.shared.pulls.page(false, true));
        let Some(page) = future::poll_once(&mut page).await else {
            break;
        };
        stalled.push(page.unwrap());
    }
    assert!(!stalled.is_empty());
    let backlog = mac
        .act(move |lab, me| {
            (0..pulls::LIVE_LOGS + 1)
                .map(|i| {
                    lab.create(
                        me,
                        coop,
                        coop,
                        "doc",
                        &[],
                        document(&format!("Backlog {i}"), "history", me),
                    )
                    .unwrap()
                })
                .collect::<Vec<_>>()
        })
        .await;
    wait_for(async || {
        mac.shared
            .told
            .lock()
            .unwrap()
            .get(&receiver)
            .is_some_and(|(_, held)| {
                backlog
                    .iter()
                    .all(|entry| held.logs.contains_key(&LogId::Entry(*entry)))
            })
    })
    .await;
    wait_for(async || phone.shared.asking.lock().unwrap().contains_key(&mac.id())).await;
    let backlog_first = backlog[0];
    assert!(
        !phone
            .read(move |lab, me| lab.item(me, backlog_first).is_some())
            .await
    );

    // All times share one monotonic process clock. Setup, key generation and initial
    // catch-up are excluded. Both reactive consumers subscribe before the mutation.
    let local_updates = mac.stirs();
    let remote_updates = phone.stirs();
    let began = Instant::now();
    let (entry, mutation_completed) = mac
        .act(move |lab, me| {
            let entry = lab.create(me, coop, coop, "doc", &[],
                document("Live generic entry", "sent during backlog", me)).unwrap();
            (entry, began.elapsed())
        })
        .await;
    let mutation_returned = began.elapsed();
    let observe = async |node: &Node, mut updates: watch::Receiver<u64>| {
        time::timeout(Duration::from_secs(20), async {
            loop {
                updates.borrow_and_update();
                if let Some(body) = node.read(move |lab, me| lab.item(me, entry)
                    .and_then(|item| item.read(avendb::lens::View::document_v1()))).await {
                    break (began.elapsed(), body);
                }
                updates.changed().await.expect("live view notifications remain open");
            }
        }).await.expect("a reactive consumer reads the live edit without polling")
    };
    let ((local_readable, sender_body), (remote_readable, receiver_body)) =
        tokio::join!(observe(&mac, local_updates), observe(&phone, remote_updates));
    assert_eq!(receiver_body, sender_body, "the exact live body is decrypted");
    // The observations are upper bounds that include task scheduling and targeted
    // reads; they are not a wire receive timestamp or a browser DOM paint time.
    eprintln!("LIVE_LATENCY {}", serde_json::json!({
        "fixture": "authenticated-loopback-generic-document",
        "background_slots_held": stalled.len(),
        "mutation_completed_ms": mutation_completed.as_secs_f64() * 1000.0,
        "mutation_returned_ms": mutation_returned.as_secs_f64() * 1000.0,
        "local_readable_ms": local_readable.as_secs_f64() * 1000.0,
        "receiver_readable_ms": remote_readable.as_secs_f64() * 1000.0,
        "durable_ms": null, "remote_accept_ms": null,
        "durability": "in-memory fixture; no disk fence measured"
    }));
    assert!(phone.read(move |lab, me| lab.item(me, backlog_first).is_some()).await,
        "the first creation is the required audience-key witness");
    let unrelated = backlog[1..].to_vec();
    assert!(phone.read(move |lab, me| unrelated.iter().all(|entry| lab.item(me, *entry).is_none())).await,
        "unrelated history remains behind the blocked background lane");
    assert_eq!(
        phone.live_peers().await.len(),
        1,
        "only the ordinary Mac peer is connected"
    );

    drop(stalled);
    wait_for(async || {
        let backlog = backlog.clone();
        phone.read(move |lab, me| backlog.iter().all(|entry| lab.item(me, *entry).is_some())).await
    })
    .await;
    mac.shutdown().await.unwrap();
    phone.shutdown().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_live_hint_does_not_authorize_a_private_entry() {
    // LivePriority.priority_does_not_widen / unauthorized_never_accepted. Even an authenticated peer's forged
    // availability hint is not a grant: ordinary scoped reply/receive checks still reject the private content.
    let mut w = world();
    handbook_ready(&mut w);
    let (sender, receiver, bob) = (w.mac_b, w.mac_a, w.bob);
    let secret = w
        .lab
        .create(
            sender,
            bob,
            bob,
            "note",
            &[],
            document("Private", "not Alice's", sender),
        )
        .unwrap();
    let options = || Options {
        lazy: true,
        ..Options::local()
    };
    let bob = Node::spawn(w.lab.split(sender, &[], [53; 32]), sender, options())
        .await
        .unwrap();
    let alice = Node::spawn(w.lab.split(receiver, &[], [54; 32]), receiver, options())
        .await
        .unwrap();
    alice.know(bob.addr());
    bob.know(alice.addr());
    alice.shared.connection(bob.id()).await.unwrap();
    let changed_identity = alice
        .shared
        .pull_expected(
            bob.id(),
            Scope::Logs([LogId::Entry(secret)].into()),
            false,
            None,
            Some(SignerId::from_u64(999)),
        )
        .await
        .expect_err("a hint cannot be routed under another authenticated identity");
    assert!(changed_identity.to_string().contains("identity changed"));
    assert_eq!(
        bob.shared.traffic.served_json()["pages"],
        0,
        "the identity fence runs before a scoped request is sent"
    );
    bob.shared.own_logs().await;
    let frontier = bob
        .shared
        .own
        .lock()
        .unwrap()
        .holdings
        .logs
        .get(&LogId::Entry(secret))
        .unwrap()
        .clone();
    alice.shared.hear(
        sender,
        avendb::wire::Announce {
            full: true,
            logs: vec![(LogId::Entry(secret), frontier)],
            files: vec![],
        },
    );
    alice
        .shared
        .pull_live(bob.id(), sender, [LogId::Entry(secret)].into())
        .await
        .unwrap();
    assert!(
        !alice
            .read(move |lab, me| lab.item(me, secret).is_some())
            .await
    );
    assert!(
        bob.shared.traffic.served_json()["pages"].as_u64().unwrap() > 0,
        "the private hint reaches the ordinary reply gate rather than passing through a vacuous no-op"
    );
    assert_eq!(
        bob.shared.traffic.served_json()["edits"],
        0,
        "priority did not make the sender disclose private records"
    );
    bob.shutdown().await.unwrap();
    alice.shutdown().await.unwrap();
}

#[test]
fn witness_hints_preserve_permission_budget_and_duplicate_suppression() {
    use avendb::id::EntryId;
    use avendb::wire::Frontier;
    let log = |n| LogId::Entry(EntryId::from_u64(n));
    let want = Holdings { logs: (1..40).map(|n| (log(n), Frontier::default())).collect(), ..Default::default() };
    let mut announce = Announce { logs: vec![(log(1), Frontier::default())], ..Default::default() };
    add_witness_hints(&mut announce, &want, [log(100), log(2), log(2)]);
    assert_eq!(announce.logs.iter().map(|(id, _)| *id).collect::<Vec<_>>(), vec![log(1), log(2)]);
    add_witness_hints(&mut announce, &want, (3..40).map(log));
    assert_eq!(announce.logs.len(), pulls::LIVE_LOGS);
    assert!(announced_hints(&want, &announce).is_empty(), "unchanged hints cannot manufacture priority");
    let mut held = want.clone();
    held.logs.remove(&log(1));
    assert_eq!(announced_hints(&held, &announce).len(), pulls::LIVE_LOGS);
    announce.full = true;
    assert!(announced_hints(&held, &announce).is_empty());
}

#[test]
fn earlier_witnesses_keep_the_announcement_wire_canonical() {
    use avendb::id::EntryId;
    use avendb::wire::Frontier;
    let log = |n| LogId::Entry(EntryId::from_u64(n));
    let want = Holdings {
        logs: (1..=40).map(|n| (log(n), Frontier { heads: vec![avendb::id::EditId::from_u64(n)], waiting: vec![] })).collect(),
        ..Default::default()
    };
    // Creation order has no relation to hashed LogId order. Witnesses may sort before a changed log.
    let mut announce = Announce {
        logs: vec![(log(40), want.logs[&log(40)].clone())],
        ..Default::default()
    };
    add_witness_hints(&mut announce, &want, [log(3), log(1), log(3), log(100), log(2)]);
    assert_eq!(Announce::from_wire(&announce.to_wire()), Ok(announce.clone()),
        "the receiver must accept the entire announcement after authorized witness insertion");
    assert_eq!(announce.logs.iter().map(|(id, _)| *id).collect::<Vec<_>>(),
        vec![log(1), log(2), log(3), log(40)]);
    assert!(announce.logs.iter().all(|(id, frontier)| want.logs.get(id) == Some(frontier)));
    add_witness_hints(&mut announce, &want, (4..40).rev().map(log));
    assert_eq!(announce.logs.len(), pulls::LIVE_LOGS);
    assert_eq!(Announce::from_wire(&announce.to_wire()), Ok(announce));
}

#[test]
fn ineligible_announcements_are_unchanged_without_consuming_witnesses() {
    use avendb::id::EntryId;
    use avendb::wire::Frontier;
    let logs: Vec<_> = (1..=pulls::LIVE_LOGS as u64)
        .map(|n| (LogId::Entry(EntryId::from_u64(n)), Frontier::default())).collect();
    let want = Holdings { logs: logs.iter().cloned().collect(), ..Default::default() };
    for mut announce in [
        Announce { full: true, logs: logs[..1].to_vec(), ..Default::default() },
        Announce::default(),
        Announce { logs, ..Default::default() },
    ] {
        let before = announce.clone();
        add_witness_hints(&mut announce, &want,
            std::iter::from_fn(|| panic!("ineligible announcement consumed witnesses")));
        assert_eq!(announce, before);
        assert_eq!(Announce::from_wire(&announce.to_wire()), Ok(announce));
    }
}

#[tokio::test]
async fn held_announcement_coalesces_new_entry_wake_without_waiting_for_retry() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (sender, receiver) = (w.mac_a, w.phone_a);
    let node = Node::spawn(w.lab.split(sender, &[], [93; 32]), sender,
        Options { lazy: true, retry: Duration::from_secs(60), ..Options::local() }).await.unwrap();
    // Drive the production scheduling boundary explicitly, without a periodic retry
    // or unrelated peer task consuming its notification. This is not wire timing.
    let tasks: Vec<_> = node.tasks.lock().unwrap().drain(..).collect();
    // Node::spawn returns immediately after spawning these tasks. On this
    // current-thread runtime, abort every task before yielding so the initial
    // announcer cannot start detached tells and seed unrelated failure backoff.
    for task in &tasks { task.abort(); }
    for task in tasks { let _ = task.await; }
    let mut news = node.shared.news((usize::MAX, 0), None).await.unwrap();
    node.shared.own_logs().await;
    let before = node.shared.own.lock().unwrap().holdings.clone();
    assert!(node.shared.begin_tell(receiver), "hold the first announcement slot");
    node.act(move |lab, me| {
        lab.create(me, coop, coop, "doc", &[], document("Generic live entry", "second frontier", me)).unwrap();
    }).await;
    news = node.shared.news(news.size, news.revision.clone()).await.unwrap();
    node.shared.own_logs().await;
    assert_ne!(before, node.shared.own.lock().unwrap().holdings);
    let reach = news.reach.get(&receiver).unwrap();
    news.reach = Arc::new(std::collections::BTreeMap::from([(receiver, crate::Reach {
        endpoint: reach.endpoint, files: reach.files.clone(), logs: reach.logs.clone(),
    })]));
    assert_eq!(news.reach.len(), 1);
    while time::timeout(Duration::ZERO, node.shared.changed.notified()).await.is_ok() {}
    // Multiple passes consume the mutation's wake while the first tell is held.
    assert!(node.shared.unreached.lock().unwrap().due(&receiver), "the fixture peer is eligible, without startup backoff");
    node.shared.announce(&news);
    node.shared.announce(&news);
    assert_eq!(node.shared.telling.lock().unwrap().len(), 1);
    assert_eq!(node.shared.telling.lock().unwrap().get(&receiver), Some(&true), "the held tell owes the new frontier");
    node.shared.finish_tell(receiver, true);
    time::timeout(Duration::from_millis(100), node.shared.changed.notified()).await
        .expect("successful held tell must release the coalesced frontier wake before the 60s retry");
    assert!(time::timeout(Duration::ZERO, node.shared.changed.notified()).await.is_err(), "one coalesced wake");
    // A success with no intervening demand must not manufacture an announce loop.
    assert!(node.shared.begin_tell(receiver));
    node.shared.finish_tell(receiver, true);
    assert!(time::timeout(Duration::ZERO, node.shared.changed.notified()).await.is_err());
    // Failed work keeps the existing backoff even when another pass was skipped.
    assert!(node.shared.begin_tell(receiver));
    assert!(!node.shared.begin_tell(receiver));
    node.shared.finish_tell(receiver, false);
    assert!(!node.shared.unreached.lock().unwrap().due(&receiver));
    assert!(time::timeout(Duration::ZERO, node.shared.changed.notified()).await.is_err());
    assert!(node.shared.telling.lock().unwrap().is_empty());
    node.shutdown().await.unwrap();
}
