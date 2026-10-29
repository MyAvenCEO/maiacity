//! Runtime acceptance corresponding to spec/AvenDB/LivePriority.lean. These fixtures use ordinary authenticated
//! peers and the PQ transport; no database server or relay is spawned. Timing is a test timeout, not a theorem.
use super::*;
use crate::{Node, Options};
use avendb::cast::{document, handbook_ready, world};
use avendb::id::EntryId;
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
    wait_for(async || phone.shared.differ(sender).is_empty()).await;

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
    wait_for(async || phone.shared.outreach.look().await.asks.get(&mac.id()).is_some_and(|lane| lane.busy)).await;
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
                // in the same turn of the Lab as the body is read: whether the witness it rests on was replayed then
                let read = node.read(move |lab, me| {
                    let body = lab.item(me, entry).and_then(|item| item.read(avendb::lens::View::document_v1()));
                    body.map(|body| (body, lab.state(me).entry(backlog_first).is_some()))
                }).await;
                if let Some((body, witnessed)) = read {
                    break (began.elapsed(), body, witnessed);
                }
                updates.changed().await.expect("live view notifications remain open");
            }
        }).await.expect("a reactive consumer reads the live edit without polling")
    };
    let ((local_readable, sender_body, _), (remote_readable, receiver_body, witnessed)) =
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
    // the live body is never readable before the witness it rests on is held and replayed, checked in the turn it
    // was first read; the witness's own entry is shown by the catch-up's steps after the live edit's
    // (`Lab::show_items`, new writes first), so whether that is shown yet is a race, not this rule
    assert!(witnessed, "the first creation is the required audience-key witness");
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
            Some(SignerId::from_u64(999)),
            None,
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
    let missing = alice.shared.differ(sender);
    alice
        .shared
        .pull_live(bob.id(), sender, [LogId::Entry(secret)].into(), &missing, crate::pulls::LIVE_LOGS, &mut super::LiveTiming::default())
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

/// Every remote entry predates the first authenticated announcement. No target ID is supplied
/// to the receiving application; discovery must hydrate its view while background work is held.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_active_type_query_discovers_existing_entries_without_unrelated_history() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (sender, receiver) = (w.mac_a, w.phone_a);
    // The receiver has valid identity/governance/schema state, but no target or unrelated payloads.
    let phone_lab = w.lab.split(receiver, &[], [121; 32]);
    let target = w.lab.create(sender, coop, coop, "active-document", &[],
        document("Useful existing entry", "active view", sender)).unwrap();
    let unrelated = (0..pulls::LIVE_LOGS + 1).map(|i| {
        w.lab.create(sender, coop, coop, "background-document", &[],
            document(&format!("Unrelated {i}"), "withheld history", sender)).unwrap()
    }).collect::<Vec<_>>();
    let mac = Node::spawn(w.lab.split(sender, &[], [122; 32]), sender, Options::local()).await.unwrap();
    let phone = Node::spawn(phone_lab, receiver, Options::local()).await.unwrap();
    // Hold only background admission. A negotiated bounded discovery lane must stay available.
    let mut stalled = Vec::new();
    loop {
        let mut page = Box::pin(phone.shared.pulls.page(false, true));
        let Some(page) = future::poll_once(&mut page).await else { break };
        stalled.push(page.unwrap());
    }
    assert!(!stalled.is_empty());
    phone.know(mac.addr());
    mac.know(phone.addr());
    phone.shared.connection(mac.id()).await.unwrap();
    wait_for(async || phone.shared.held.lock().unwrap().get(&sender)
        .is_some_and(|held| held.logs.contains_key(&LogId::Entry(target)))).await;
    let query = serde_json::json!({"op":"query", "vault":coop.to_hex(),
        "where":{"type":["active-document"]}, "select":[]});
    let initial = phone.op(query.clone()).await.unwrap();
    assert_eq!(initial["ok"]["rows"], serde_json::json!([]));
    // Local capability and lease acceptance are distinct; remote discovery is always incomplete.
    // Requester identity must be bound by the connection, never selected by this payload.
    let ack = phone.op(serde_json::json!({"op":"interest", "scope":"ab".repeat(16), "revision":1,
        "wants":[{"tier":"now", "queries":[{"vault":coop.to_hex(), "types":["active-document"]}]}]})).await.unwrap();
    assert_eq!(ack["ok"]["discovery_supported"], true);
    assert_eq!(ack["ok"]["discovery_complete"], false);
    let useful = time::timeout(Duration::from_secs(2), async {
        loop {
            let answer = phone.op(query.clone()).await.unwrap();
            if answer["ok"]["rows"].as_array().is_some_and(|rows| rows.iter()
                .any(|row| row["entry"].as_str() == Some(target.to_hex().as_str()))) { break; }
            time::sleep(Duration::from_millis(5)).await;
        }
    }).await.is_ok();
    let unrelated_absent = phone.read(move |lab, me|
        unrelated.iter().all(|entry| lab.item(me, *entry).is_none())).await;
    let incomplete = phone.synced().await;
    // Clean up before asserting, so background tasks/locks never leak to another test.
    drop(stalled);
    phone.shutdown().await.unwrap();
    mac.shutdown().await.unwrap();
    assert!(unrelated_absent, "active discovery must not require unrelated payloads");
    assert!(incomplete["behind"].as_u64().is_some_and(|behind| behind > 0),
        "a useful local result is not whole-device completeness: {incomplete}");
    assert!(useful, "an authenticated type-only active query must discover its existing entry before background admission is released");
}

/// Freshness with no clock (A4): a peer that told what it holds and stalls, its connection then closing, counts on by
/// what it told, reconnecting, as long as this device lacks it: the logs left never fall to none while nothing came
/// (fresh7: lacked 0, behind 0 from about 90 s with 9.8k of 52k edits in).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_stalled_peer_that_drops_its_connection_still_counts_what_it_holds() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (sender, receiver) = (w.mac_a, w.phone_a);
    let phone_lab = w.lab.split(receiver, &[], [131; 32]);
    for i in 0..4 {
        w.lab.create(sender, coop, coop, "doc", &[], document(&format!("Held back {i}"), "body", sender)).unwrap();
    }
    let mac = Node::spawn(w.lab.split(sender, &[], [132; 32]), sender, Options::local()).await.unwrap();
    let phone = Node::spawn(phone_lab, receiver, Options::local()).await.unwrap();
    // every pull held back: the phone hears what the Mac holds, and takes none of it
    let mut stalled = Vec::new();
    loop {
        let mut page = Box::pin(phone.shared.pulls.page(false, true));
        let Some(page) = future::poll_once(&mut page).await else { break };
        stalled.push(page.unwrap());
    }
    let mut live = Vec::new();
    loop {
        let mut page = Box::pin(phone.shared.pulls.page(true, true));
        let Some(page) = future::poll_once(&mut page).await else { break };
        live.push(page.unwrap());
    }
    phone.know(mac.addr());
    mac.know(phone.addr());
    phone.shared.connection(mac.id()).await.unwrap();
    wait_for(async || phone.synced().await["behind"].as_u64().is_some_and(|b| b > 0)).await;
    let before = phone.synced().await;
    mac.shutdown().await.unwrap();
    wait_for(async || phone.synced().await["reconnecting"].as_u64() == Some(1)).await;
    let after = phone.synced().await;
    drop((stalled, live));
    phone.shutdown().await.unwrap();
    assert_eq!(after["peers"], 1, "{after}");
    assert_eq!(after["behind"], before["behind"], "what it lacks of the Mac counts on: {before} then {after}");
}

/// What a device lacks of a peer is told while a long turn holds its Lab, the same as before it: the sync pill never
/// waits behind the Lab (fresh9, 2026-10-29: "Synced" shown 70 s after a reopen, the pill's `synced` waiting behind a
/// turn of the Lab while both peers had told of ~3,030 logs it lacked).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn what_a_device_lacks_is_told_while_a_long_turn_holds_its_lab() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (sender, receiver) = (w.mac_a, w.phone_a);
    let phone_lab = w.lab.split(receiver, &[], [133; 32]);
    for i in 0..4 {
        w.lab.create(sender, coop, coop, "doc", &[], document(&format!("Held back {i}"), "body", sender)).unwrap();
    }
    let mac = Node::spawn(w.lab.split(sender, &[], [134; 32]), sender, Options::local()).await.unwrap();
    let phone = Arc::new(Node::spawn(phone_lab, receiver, Options::local()).await.unwrap());
    // every pull held back: the phone hears what the Mac holds, and takes none of it
    let mut held_back = Vec::new();
    for live in [false, true] {
        loop {
            let mut page = Box::pin(phone.shared.pulls.page(live, true));
            let Some(page) = future::poll_once(&mut page).await else { break };
            held_back.push(page.unwrap());
        }
    }
    phone.know(mac.addr());
    mac.know(phone.addr());
    phone.shared.connection(mac.id()).await.unwrap();
    wait_for(async || phone.synced().await["behind"].as_u64().is_some_and(|b| b > 0)).await;
    let before = phone.synced().await;
    let (holding, held) = (Arc::new(std::sync::Barrier::new(2)), Arc::new(std::sync::Barrier::new(2)));
    let turn = {
        let (phone, holding, held) = (phone.clone(), holding.clone(), held.clone());
        tokio::spawn(async move { phone.act(move |_, _| { holding.wait(); held.wait(); }).await })
    };
    tokio::task::block_in_place(|| holding.wait());
    let during = tokio::time::timeout(Duration::from_secs(5), phone.synced()).await;
    tokio::task::block_in_place(|| held.wait());
    turn.await.unwrap();
    let during = during.expect("told while the Lab is held");
    drop(held_back);
    phone.shutdown().await.unwrap();
    mac.shutdown().await.unwrap();
    assert_eq!(during["behind"], before["behind"], "{before} then {during}");
    assert_eq!(during["peers"], 1, "{during}");
}

/// Coverage.lean `behind_is_partial` and `arrived_is_complete`, on a node: while a peer has announced logs this
/// device lacks, a query of their vault answers partial with those logs; once they arrive, complete. The iPhone's case.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_query_is_partial_while_announced_logs_are_behind_and_complete_once_they_arrive() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (sender, receiver) = (w.mac_a, w.phone_a);
    let mac = Node::spawn(w.lab.split(sender, &[], [53; 32]), sender, Options::local()).await.unwrap();
    let phone = Node::spawn(w.lab.split(receiver, &[], [54; 32]), receiver, Options::local()).await.unwrap();
    phone.know(mac.addr());
    mac.know(phone.addr());
    phone.sync_with(mac.id()).await.unwrap();
    wait_for(async || mac.shared.told.lock().unwrap().contains_key(&receiver)).await;
    wait_for(async || phone.shared.differ(sender).is_empty()).await;
    let query = serde_json::json!({"op": "query", "vault": coop.to_hex(), "where": {"type": ["doc"]}});
    let before = phone.op(query.clone()).await.unwrap();
    assert_eq!(before["ok"]["coverage"], serde_json::json!({"state": "complete"}), "{before}");

    // Hold every background page so the new logs stay behind while their announcement arrives.
    let mut stalled = Vec::new();
    loop {
        let mut page = Box::pin(phone.shared.pulls.page(false, true));
        let Some(page) = future::poll_once(&mut page).await else { break };
        stalled.push(page.unwrap());
    }
    let backlog = mac.act(move |lab, me| (0..pulls::LIVE_LOGS + 3).map(|i| lab.create(me, coop, coop, "doc", &[],
        document(&format!("Behind {i}"), "history", me)).unwrap()).collect::<Vec<_>>()).await;
    wait_for(async || phone.shared.differ(sender).len() > 1).await;
    let behind = phone.op(query.clone()).await.unwrap();
    let coverage = &behind["ok"]["coverage"];
    assert_eq!(coverage["state"], "partial", "{behind}");
    assert!(coverage["logs"].as_u64().unwrap() > 0, "{behind}");

    drop(stalled);
    wait_for(async || {
        let backlog = backlog.clone();
        phone.read(move |lab, me| backlog.iter().all(|entry| lab.item(me, *entry).is_some())).await
            && phone.shared.differ(sender).is_empty()
    }).await;
    let arrived = phone.op(query).await.unwrap();
    assert_eq!(arrived["ok"]["coverage"], serde_json::json!({"state": "complete"}), "{arrived}");
    assert_eq!(arrived["ok"]["count"].as_u64().unwrap() as usize, before["ok"]["count"].as_u64().unwrap() as usize + backlog.len());
    mac.shutdown().await.unwrap();
    phone.shutdown().await.unwrap();
}

/// Freshness.lean on a node, for any read alike (a query and `aips`, which has no coverage of its own): with no peer a
/// read is offline as of the device's last current read; while a live peer holds logs the device lacks, behind, so a
/// page never shows it as final and no action sheet opens; once they arrive, current. The 27 Oct iPhone's case.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn every_read_is_offline_behind_or_current_as_its_peers_say() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (sender, receiver) = (w.mac_a, w.phone_a);
    let mac = Node::spawn(w.lab.split(sender, &[], [55; 32]), sender, Options::local()).await.unwrap();
    let phone = Node::spawn(w.lab.split(receiver, &[], [56; 32]), receiver, Options::local()).await.unwrap();
    let query = serde_json::json!({"op": "query", "vault": coop.to_hex(), "where": {"type": ["doc"]}});
    let aips = serde_json::json!({"op": "aips"});
    let alone = phone.op(aips.clone()).await.unwrap();
    assert_eq!(alone["fresh"], serde_json::json!({"state": "offline", "asOf": 0}), "{alone}");

    phone.know(mac.addr());
    mac.know(phone.addr());
    phone.sync_with(mac.id()).await.unwrap();
    wait_for(async || phone.shared.differ(sender).is_empty()).await;
    for read in [&query, &aips] {
        let answer = phone.op(read.clone()).await.unwrap();
        assert_eq!(answer["fresh"], serde_json::json!({"state": "current"}), "{answer}");
    }

    let mut stalled = Vec::new();
    loop {
        let mut page = Box::pin(phone.shared.pulls.page(false, true));
        let Some(page) = future::poll_once(&mut page).await else { break };
        stalled.push(page.unwrap());
    }
    let backlog = mac.act(move |lab, me| (0..pulls::LIVE_LOGS + 3).map(|i| lab.create(me, coop, coop, "doc", &[],
        document(&format!("Behind {i}"), "history", me)).unwrap()).collect::<Vec<_>>()).await;
    wait_for(async || phone.shared.differ(sender).len() > 1).await;
    for read in [&query, &aips] {
        let answer = phone.op(read.clone()).await.unwrap();
        assert_eq!(answer["fresh"]["state"], "behind", "{answer}");
        assert!(answer["fresh"]["logs"].as_u64().unwrap() > 0, "{answer}");
    }

    drop(stalled);
    wait_for(async || {
        let backlog = backlog.clone();
        phone.read(move |lab, me| backlog.iter().all(|entry| lab.item(me, *entry).is_some())).await
            && phone.shared.differ(sender).is_empty()
    }).await;
    let arrived = phone.op(aips.clone()).await.unwrap();
    assert_eq!(arrived["fresh"], serde_json::json!({"state": "current"}), "{arrived}");
    mac.shutdown().await.unwrap();
    wait_for(async || phone.shared.peers.lock().unwrap().values().all(|p| p.conn.close_reason().is_some())).await;
    let offline = phone.op(aips).await.unwrap();
    assert_eq!(offline["fresh"]["state"], "offline", "{offline}");
    assert!(offline["fresh"]["asOf"].as_u64().unwrap() > 0, "{offline}");
    phone.shutdown().await.unwrap();
}

/// A chat round trip while a bulk catch-up runs (F2/F5), in process over the PQ transport, no server: the phone lacks
/// `BULK` notes the Mac wrote; once it has taken some of them, the Mac edits a chat entry both hold, `MESSAGES` times,
/// and each time waits until the phone's view shows the new text. 5505538 (the live view draining the whole catch-up):
/// p95 2,970 ms; with `LIVE_VIEW`, ten runs 128-298 ms. The batch's gate is sync_bench's `bench_live`; this one asserts
/// with room for loaded runners, and that no page from the Mac came back with nothing new (F12).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn chat_reaches_the_phone_quickly_while_it_catches_up() {
    const BULK: usize = 1500;
    const MESSAGES: usize = 12;
    let mut w = world();
    let (sender, receiver, alice) = (w.mac_a, w.phone_a, w.alice);
    w.lab.sync_all(0);
    let chat = w.lab.create(sender, alice, alice, "note", &[], document("Chat", "hello", sender)).unwrap();
    w.lab.sync(sender, receiver);
    let notes: Vec<EntryId> = (0..BULK)
        .map(|i| w.lab.create(sender, alice, alice, "note", &[], document(&format!("Note {i}"), "In May.", sender)).unwrap())
        .collect();
    let mac = Node::spawn(w.lab.split(sender, &[], [61; 32]), sender, Options { page: 16 << 10, ..Options::local() }).await.unwrap();
    let phone = Node::spawn(w.lab.split(receiver, &[], [62; 32]), receiver, Options { window: 1, ..Options::local() }).await.unwrap();
    phone.know(mac.addr());
    mac.know(phone.addr());
    let kept = async |n: &Node| {
        let logs = n.holdings().await.logs;
        notes.iter().filter(|e| logs.contains_key(&LogId::Entry(**e))).count()
    };
    time::timeout(Duration::from_secs(60), async { while kept(&phone).await < 20 { time::sleep(Duration::from_millis(5)).await } })
        .await
        .expect("the catch-up starts");
    let mut took = Vec::new();
    for i in 0..MESSAGES {
        let said = format!("message {i}");
        let began = Instant::now();
        let text = said.clone();
        mac.act(move |lab, me| lab.edit(me, alice, chat, |item| item.set_text(2, &text)).unwrap()).await;
        let shown = time::timeout(Duration::from_secs(30), async {
            loop {
                let said = said.clone();
                if phone.read(move |lab, me| avendb::cast::text(lab, me, chat, 2).as_deref() == Some(said.as_str())).await {
                    break began.elapsed();
                }
                time::sleep(Duration::from_millis(2)).await;
            }
        })
        .await
        .expect("the phone shows the chat message");
        took.push(shown);
        time::sleep(Duration::from_millis(150)).await;
    }
    let behind = BULK - kept(&phone).await;
    let mut sorted = took.clone();
    sorted.sort();
    let at = |p: f64| sorted[((sorted.len() as f64 * p).ceil() as usize).saturating_sub(1)].as_secs_f64() * 1000.0;
    let rows = phone.shared.traffic.recent();
    let empty = rows.iter().filter(|r| r["new"] == 0 && r["edits"].as_u64() > Some(0)).count();
    let live = phone.shared.traffic.live_json();
    let trace = phone.shared.traffic.trace_json();
    let traced = trace.as_array().map_or(0, |t| t.iter().filter(|s| s["stage"] == "taken").count());
    eprintln!("CHAT_DURING_CATCH_UP {}", serde_json::json!({
        "bulk": BULK, "messages": MESSAGES, "p50_ms": at(0.5), "p95_ms": at(0.95), "max_ms": at(1.0),
        "notes_left_at_end": behind, "duplicate_pages": empty, "live_ends": live["ends"], "traced_taken": traced,
    }));
    assert!(at(0.95) < 1000.0, "a chat message shows within a second while the phone catches up: p95 {} ms", at(0.95));
    assert_eq!(empty, 0, "no page from the Mac brought only what the phone held");
    mac.shutdown().await.unwrap();
    phone.shutdown().await.unwrap();
}

/// A chat message reaches the other device within 3 s, both ways, while the phone catches up a history that
/// holds more grants than a live pull takes at once and the removal of a device that once added another (Samuel
/// 2026-10-28: "within 1 sec, as long as both are online"). A live pull asks for the rules its entry rests on (its
/// vault's, its audience's and that audience's shares' logs), not every rule the phone lacks; it left the message to
/// the bulk catch-up while more than `LIVE_LOGS` were missing. And the phone, mid its catch-up, answers the Mac its own
/// message (Fix E): it answered nothing while a device's removal waited in its catch-up. With Chat open on both, a
/// live pull takes what its view wants first, ahead of the key upkeep the catching-up phone announces meanwhile, and the
/// rules with the entry in one asking (`wanted_go_first`). Timed as CI's live shard does (`--profile live`, no replay
/// checks): every message within this build's gate, 3 s (Samuel 2026-10-28 21:29 Berlin); a second is the goal after
/// it, which most messages meet already (after the first, 55-650 ms; one in about 25 at 1.2 s).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn chat_crosses_both_ways_within_three_seconds_while_the_phone_catches_up_grants_and_a_removal() {
    use avendb::cast::{by_id, paragraph, share, vault};
    use avendb::policy::{Action, Level, Revoking, Sharing};
    const BULK: usize = 3000;
    const GRANTS: usize = 3 * pulls::LIVE_LOGS;
    const MESSAGES: usize = 8;
    let mut w = world();
    let (sender, receiver, alice, passkey) = (w.mac_a, w.phone_a, w.alice, w.passkey_a);
    w.lab.sync_all(0);
    let chat = w.lab.create(sender, alice, alice, "note", &[], document("Chat", "hello", sender)).unwrap();
    w.lab.sync(sender, receiver);
    // an old iPad that added a TV, removed since, as Maia City's old devices
    let (pad, tv) = (w.lab.device_of(passkey, "Alice's old iPad"), w.lab.device_of(passkey, "Alice's TV"));
    let add = |d| Action::Share(Sharing::Device { vault: alice, device: d, seal_to: None });
    w.lab.submit(sender, &[passkey, pad], add(pad)).unwrap();
    w.lab.submit(sender, &[passkey, tv, pad], add(tv)).unwrap();
    let notes: Vec<EntryId> = (0..BULK)
        .map(|i| w.lab.create(sender, alice, alice, "note", &[], document(&format!("Note {i}"), "In May.", sender)).unwrap())
        .collect();
    for note in &notes[..GRANTS] {
        w.lab.issue(sender, &[sender], share(alice, vault(w.bob), Level::Read, by_id(*note))).unwrap();
    }
    w.lab.submit(sender, &[passkey], Action::Revoke(Revoking::Device { vault: alice, device: pad, keep: vec![] })).unwrap();
    // the Mac caught up, as Samuel's: the phone alone catches up
    while w.lab.catch_up(sender) {}
    let mac = Node::spawn(w.lab.split(sender, &[], [63; 32]), sender, Options { page: 16 << 10, ..Options::local() }).await.unwrap();
    let phone = Node::spawn(w.lab.split(receiver, &[], [64; 32]), receiver, Options { window: 1, ..Options::local() }).await.unwrap();
    phone.know(mac.addr());
    mac.know(phone.addr());
    // Chat open on both, as Samuel's: what its view wants goes first (`wanted_go_first`)
    for node in [&mac, &phone] {
        let open = vec![crate::interest::Want::now(vec![LogId::Entry(chat)])];
        node.shared.interests.lock().unwrap().replace("chat".into(), 1, open).unwrap();
    }
    let kept = async |n: &Node| {
        let logs = n.holdings().await.logs;
        notes.iter().filter(|e| logs.contains_key(&LogId::Entry(**e))).count()
    };
    time::timeout(Duration::from_secs(60), async { while kept(&phone).await < 20 { time::sleep(Duration::from_millis(5)).await } })
        .await
        .expect("the catch-up starts");
    let shows = async |on: &Node, block: u64, said: String, began: Instant| {
        time::timeout(Duration::from_secs(30), async {
            loop {
                let said = said.clone();
                if on.read(move |lab, me| avendb::cast::text(lab, me, chat, block).as_deref() == Some(said.as_str())).await {
                    break began.elapsed();
                }
                time::sleep(Duration::from_millis(2)).await;
            }
        })
        .await
        .ok()
    };
    let (mut to_phone, mut to_mac) = (Vec::new(), Vec::new());
    for i in 0..MESSAGES {
let said = format!("from the Mac {i}");
        let (text, began) = (said.clone(), Instant::now());
        mac.act(move |lab, me| lab.edit(me, alice, chat, |item| item.set_text(2, &text)).unwrap()).await;
        to_phone.push(shows(&phone, 2, said, began).await.unwrap_or(Duration::from_secs(30)));
        let (block, said) = (1000 + i as u64, format!("from the phone {i}"));
        let (text, began) = (said.clone(), Instant::now());
        phone.act(move |lab, me| lab.edit(me, alice, chat, |item| item.push_block(paragraph(block, &text))).unwrap()).await;
        to_mac.push(shows(&mac, block, said, began).await.unwrap_or(Duration::from_secs(30)));
        time::sleep(Duration::from_millis(150)).await;
    }
    let behind = BULK - kept(&phone).await;
    eprintln!("CHAT_BOTH_WAYS_DURING_CATCH_UP {}", serde_json::json!({
        "bulk": BULK, "grants": GRANTS, "to_phone_ms": to_phone.iter().map(|d| d.as_millis() as u64).collect::<Vec<_>>(),
        "to_mac_ms": to_mac.iter().map(|d| d.as_millis() as u64).collect::<Vec<_>>(), "notes_left_at_end": behind,
        "phone_live": phone.shared.traffic.live_json(), "mac_live": mac.shared.traffic.live_json(),
    }));
    assert!(behind > 0, "the phone still caught up as the last message crossed");
    // what a page's wait watches: the answers to the phone's askings, not every byte its connection carried
    let answered: u64 = phone.shared.peers.lock().unwrap().values()
        .map(|p| p.answered.load(std::sync::atomic::Ordering::Relaxed)).sum();
    assert!(answered > 0, "the phone counted the Mac's answers to its askings");
    // the gate where the build times what a release does; a debug build's checks replay a whole log on each turn of the
    // Lab (lab.rs), 150-250 ms a turn here, so there every message must come, within `shows`'s 30 s
    let gate = if cfg!(avendb_no_replay_checks) { 3000.0 } else { 30_000.0 };
    let most = |took: &[Duration]| took.iter().max().map_or(0.0, |d| d.as_secs_f64() * 1000.0);
    assert!(most(&to_phone) < gate, "the Mac's message shows on the phone within the gate: {to_phone:?}");
    assert!(most(&to_mac) < gate, "the phone's message shows on the Mac within the gate: {to_mac:?}");
    mac.shutdown().await.unwrap();
    phone.shutdown().await.unwrap();
}

/// A live edit's page is told as soon as the step that shows it is done, while the bulk is still being shown: a
/// reactive reader (the node's stirs, no polling) reads the new text within a second of the Mac's write, though the
/// catch-up goes on (`LivePriority.lean`'s `fresh_entries_show_in_the_first_step`). It was stirred once, after the
/// whole catch-up was caught.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_live_edits_page_is_told_while_the_bulk_is_still_shown() {
    const BULK: usize = 1500;
    let mut w = world();
    let (sender, receiver, alice) = (w.mac_a, w.phone_a, w.alice);
    w.lab.sync_all(0);
    let chat = w.lab.create(sender, alice, alice, "note", &[], document("Chat", "hello", sender)).unwrap();
    w.lab.sync(sender, receiver);
    let notes: Vec<EntryId> = (0..BULK)
        .map(|i| w.lab.create(sender, alice, alice, "note", &[], document(&format!("Note {i}"), "In May.", sender)).unwrap())
        .collect();
    let mac = Node::spawn(w.lab.split(sender, &[], [63; 32]), sender, Options { page: 16 << 10, ..Options::local() }).await.unwrap();
    let phone = Node::spawn(w.lab.split(receiver, &[], [64; 32]), receiver, Options { window: 1, ..Options::local() }).await.unwrap();
    phone.know(mac.addr());
    mac.know(phone.addr());
    let shown = async |n: &Node| {
        let notes = notes.clone();
        n.read(move |lab, me| notes.iter().filter(|e| lab.item(me, **e).is_some()).count()).await
    };
    time::timeout(Duration::from_secs(60), async { while shown(&phone).await < 20 { time::sleep(Duration::from_millis(5)).await } })
        .await
        .expect("the catch-up starts showing");
    let mut stirs = phone.stirs();
    let began = Instant::now();
    mac.act(move |lab, me| lab.edit(me, alice, chat, |item| item.set_text(2, "live")).unwrap()).await;
    let read = time::timeout(Duration::from_secs(1), async {
        loop {
            stirs.borrow_and_update();
            if phone.read(move |lab, me| avendb::cast::text(lab, me, chat, 2).as_deref() == Some("live")).await {
                break began.elapsed();
            }
            stirs.changed().await.expect("stirs stay open");
        }
    })
    .await
    .expect("a reader told by the node's stirs reads the live edit within a second");
    let left = BULK - shown(&phone).await;
    eprintln!("LIVE_STIRRED {}", serde_json::json!({ "read_ms": read.as_secs_f64() * 1000.0, "notes_not_shown_yet": left }));
    assert!(left > 0, "the bulk was still being shown");
    mac.shutdown().await.unwrap();
    phone.shutdown().await.unwrap();
}

/// Freshness costs a walk per change, not per read (`fresh.rs`): a phone 600 logs behind a Mac, its background pages
/// held, reads 1,000 times (3,028 logs measured the same once, 2026-10-27: 1 walk, 50 ms for the 1,000 reads; kept
/// smaller here for CI's time) (a query and `aips` in turn). Every read is behind, and the walk of what the Mac holds
/// against what the phone holds runs once per change of what either holds or of who is live, never once per read.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_thousand_reads_walk_once_per_change() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (sender, receiver) = (w.mac_a, w.phone_a);
    let phone_lab = w.lab.split(receiver, &[], [57; 32]);
    for i in 0..600 {
        w.lab.create(sender, coop, coop, "doc", &[], document(&format!("Log {i}"), "history", sender)).unwrap();
    }
    let mac = Node::spawn(w.lab.split(sender, &[], [58; 32]), sender, Options::local()).await.unwrap();
    let phone = Node::spawn(phone_lab, receiver, Options::local()).await.unwrap();
    let mut stalled = Vec::new();
    loop {
        let mut page = Box::pin(phone.shared.pulls.page(false, true));
        let Some(page) = future::poll_once(&mut page).await else { break };
        stalled.push(page.unwrap());
    }
    phone.know(mac.addr());
    mac.know(phone.addr());
    phone.shared.connection(mac.id()).await.unwrap();
    wait_for(async || phone.shared.differ(sender).len() > 500).await;
    let reads = [serde_json::json!({"op": "query", "vault": coop.to_hex(), "where": {"type": ["doc"]}}),
        serde_json::json!({"op": "aips"})];
    let key = || (phone.shared.fresh.walks.load(std::sync::atomic::Ordering::Relaxed), *phone.shared.size.borrow());
    let (walks, _) = key();
    let mut keys = std::collections::BTreeSet::new();
    let moved = || phone.shared.fresh.moved_count();
    let mut behind = 0;
    let started = std::time::Instant::now();
    for i in 0..1000 {
        keys.insert((moved(), *phone.shared.size.borrow()));
        let answer = phone.op(reads[i % 2].clone()).await.unwrap();
        if answer["fresh"]["state"] == "behind" { behind += 1; }
    }
    let took = started.elapsed();
    keys.insert((moved(), *phone.shared.size.borrow()));
    let walked = key().0 - walks;
    let logs = phone.shared.differ(sender).len();
    drop(stalled);
    phone.shutdown().await.unwrap();
    mac.shutdown().await.unwrap();
    eprintln!("1000 reads, {logs} logs behind: {walked} walks, {} changes seen, {behind} behind, {took:?}", keys.len());
    assert_eq!(behind, 1000, "every read is behind while the logs are");
    // at most one walk per change seen of what the peer or the device holds (an announcement may still land)
    assert!(walked <= keys.len() as u64, "{walked} walks for {} changes", keys.len());
}

#[test]
fn a_hint_tells_its_witnesses_from_the_logs_it_changed() {
    use avendb::wire::Frontier;
    let log = |n| LogId::Entry(EntryId::from_u64(n));
    let at = |b: u8| Frontier { heads: vec![EditId([b; 32])], waiting: vec![] };
    let held = Holdings { logs: [(log(1), at(1)), (log(2), at(2))].into_iter().collect(), ..Default::default() };
    let announce = Announce { logs: vec![(log(1), at(9)), (log(2), at(2)), (log(3), at(3))], ..Default::default() };
    let hinted = announced_hints(&held, &announce);
    assert_eq!(
        super::unchanged(&held, &announce, &hinted),
        vec![(log(1), false), (log(2), true), (log(3), false)],
        "a changed or new log is no witness; a repeated frontier is"
    );
    // a log any coalesced hint changed is no witness, whatever another repeated
    let budget = pulls::Budget::default();
    let peer = SignerId([7; 32]);
    budget.note_witnesses(peer, vec![(log(1), false), (log(2), true), (log(4), true)]);
    budget.note_witnesses(peer, vec![(log(1), true), (log(2), false)]);
    assert_eq!(budget.take_witnesses(peer, &[log(1), log(2), log(4)].into()), [log(4)].into());
    assert!(budget.take_witnesses(peer, &[log(4)].into()).is_empty(), "a log is taken once");
}


/// A view paints from what the device holds while its catch-up is still under way (Goal 6 S3): with the phone's
/// background pages held and the Mac's logs behind, the whole-world read and the world summary both answer at once,
/// with the entries the phone holds, stamped behind, never waiting for the logs to arrive.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_world_paints_from_local_entries_while_catching_up() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (sender, receiver) = (w.mac_a, w.phone_a);
    let mac = Node::spawn(w.lab.split(sender, &[], [63; 32]), sender, Options::local()).await.unwrap();
    let phone = Node::spawn(w.lab.split(receiver, &[], [64; 32]), receiver, Options::local()).await.unwrap();
    let local = mac.act(move |lab, me| (0..3).map(|i| lab.create(me, coop, coop, "doc", &[],
        document(&format!("Held {i}"), "here", me)).unwrap()).collect::<Vec<_>>()).await;
    phone.know(mac.addr());
    mac.know(phone.addr());
    phone.sync_with(mac.id()).await.unwrap();
    wait_for(async || {
        let local = local.clone();
        phone.read(move |lab, me| local.iter().all(|e| lab.item(me, *e).is_some())).await
            && phone.shared.differ(sender).is_empty()
    }).await;
    let held = phone.op(serde_json::json!({"op": "world"})).await.unwrap()["ok"]["entries"].as_array().unwrap().len();
    assert!(held > 0);

    let mut stalled = Vec::new();
    loop {
        let mut page = Box::pin(phone.shared.pulls.page(false, true));
        let Some(page) = future::poll_once(&mut page).await else { break };
        stalled.push(page.unwrap());
    }
    mac.act(move |lab, me| for i in 0..pulls::LIVE_LOGS + 40 {
        lab.create(me, coop, coop, "doc", &[], document(&format!("Behind {i}"), "history", me)).unwrap();
    }).await;
    wait_for(async || phone.shared.differ(sender).len() > pulls::LIVE_LOGS).await;
    for op in ["world", "world_summary"] {
        let started = std::time::Instant::now();
        let answer = time::timeout(Duration::from_secs(5), phone.op(serde_json::json!({"op": op}))).await
            .expect("a world read never waits for the catch-up").unwrap();
        eprintln!("{op} during catch-up: {:?}, {}", started.elapsed(), answer["fresh"]);
        assert_eq!(answer["fresh"]["state"], "behind", "{op}: {}", answer["fresh"]);
        assert!(answer["fresh"]["logs"].as_u64().unwrap() > pulls::LIVE_LOGS as u64, "{op}");
        if op == "world" {
            assert!(answer["ok"]["entries"].as_array().unwrap().len() >= held, "the entries it holds, shown now");
        }
    }
    assert!(phone.shared.differ(sender).len() > pulls::LIVE_LOGS, "the catch-up is still under way");
    drop(stalled);
    phone.shutdown().await.unwrap();
    mac.shutdown().await.unwrap();
}

/// A read is behind only on the logs that may change what it shows (`engine::footprint`, `Lab::may_change`), never
/// on its whole vault (Goal 8 D1): with the Mac's edits to the coop's 24 docs held back from the phone, a query of its
/// notes and a read of one note are current, while a query of its docs is behind on exactly those docs' logs.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_read_is_behind_only_on_the_logs_it_may_show() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (sender, receiver) = (w.mac_a, w.phone_a);
    let mac = Node::spawn(w.lab.split(sender, &[], [67; 32]), sender, Options::local()).await.unwrap();
    let phone = Node::spawn(w.lab.split(receiver, &[], [68; 32]), receiver, Options::local()).await.unwrap();
    let (docs, note) = mac.act(move |lab, me| {
        let docs: Vec<EntryId> = (0..pulls::LIVE_LOGS + 8).map(|i| lab.create(me, coop, coop, "doc", &[],
            document(&format!("Doc {i}"), "here", me)).unwrap()).collect();
        (docs, lab.create(me, coop, coop, "note", &[], document("Note", "here", me)).unwrap())
    }).await;
    phone.know(mac.addr());
    mac.know(phone.addr());
    phone.sync_with(mac.id()).await.unwrap();
    wait_for(async || {
        let all: Vec<EntryId> = docs.iter().copied().chain([note]).collect();
        phone.read(move |lab, me| all.iter().all(|e| lab.item(me, *e).is_some())).await
            && phone.shared.differ(sender).is_empty()
    }).await;

    // every background page slot held, the one a pull from the first sync still uses too, once it lets it go: held
    // only while free, a pull still under way kept a slot and carried the docs' edits past the hold
    let stalled = phone.shared.pulls.hold_background_pages().await;
    let edited = docs.clone();
    mac.act(move |lab, me| for d in &edited {
        lab.edit(me, coop, *d, |item| item.set_text(2, "newer")).unwrap();
    }).await;
    // more logs at once than a live change carries, so they wait for the held pages
    wait_for(async || phone.shared.differ(sender).len() == docs.len()).await;
    let vault = coop.to_hex();
    let state = async |op: serde_json::Value| {
        let answer = phone.op(op.clone()).await.unwrap();
        (answer["fresh"]["state"].as_str().unwrap_or_default().to_string(), answer["fresh"]["logs"].as_u64(), answer)
    };
    let (notes, _, answer) = state(serde_json::json!({"op": "query", "vault": vault, "where": {"type": ["note"]}})).await;
    assert_eq!(notes, "current", "the docs' logs can't change a query of notes: {answer}");
    let (one, _, answer) = state(serde_json::json!({"op": "get", "entry": note.to_hex()})).await;
    assert_eq!(one, "current", "nor a read of one note: {answer}");
    let (of_docs, logs, answer) = state(serde_json::json!({"op": "query", "vault": vault, "where": {"type": ["doc"]}})).await;
    assert_eq!(of_docs, "behind", "{answer}");
    assert_eq!(logs, Some(docs.len() as u64), "behind on the docs' logs alone: {answer}");
    drop(stalled);
    phone.shutdown().await.unwrap();
    mac.shutdown().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn probe_world_cost_holding_many() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (sender, receiver) = (w.mac_a, w.phone_a);
    let phone_lab = w.lab.split(receiver, &[], [65; 32]);
    let mac = Node::spawn(w.lab.split(sender, &[], [66; 32]), sender, Options::local()).await.unwrap();
    let phone = Node::spawn(phone_lab, receiver, Options::local()).await.unwrap();
    let first = mac.act(move |lab, me| (0..1500).map(|i| lab.create(me, coop, coop, "doc", &[], document(&format!("A {i}"), "x", me)).unwrap()).collect::<Vec<_>>()).await;
    phone.know(mac.addr());
    mac.know(phone.addr());
    phone.sync_with(mac.id()).await.unwrap();
    wait_for(async || { let f = first.clone(); phone.read(move |lab, me| f.iter().all(|e| lab.item(me, *e).is_some())).await }).await;
    for op in ["world_summary", "world", "world"] {
        let t = std::time::Instant::now();
        phone.op(serde_json::json!({"op": op})).await.unwrap();
        eprintln!("synced {op}: {:?}", t.elapsed());
    }
    mac.act(move |lab, me| for i in 0..1500 { lab.create(me, coop, coop, "doc", &[], document(&format!("B {i}"), "x", me)).unwrap(); }).await;
    for _ in 0..8 {
        for op in ["world_summary", "world"] {
            let t = std::time::Instant::now();
            phone.op(serde_json::json!({"op": op})).await.unwrap();
            eprintln!("catching up {op}: {:?} behind={}", t.elapsed(), phone.shared.differ(sender).len());
        }
        time::sleep(Duration::from_millis(300)).await;
    }
    phone.shutdown().await.unwrap();
    mac.shutdown().await.unwrap();
}
