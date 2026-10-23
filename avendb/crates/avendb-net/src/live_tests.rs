//! Runtime acceptance corresponding to spec/AvenDB/LivePriority.lean. These fixtures use ordinary authenticated
//! peers and the PQ transport; no database server or relay is spawned. Timing is a test timeout, not a theorem.
use super::*;
use crate::{Node, Options};
use avendb::cast::{document, handbook_ready, world};
use n0_future::future;

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

    let mut updates = phone.stirs();
    let chat = mac
        .act(move |lab, me| {
            lab.create(
                me,
                coop,
                coop,
                "doc",
                &[],
                document("Live chat", "sent during backlog", me),
            )
            .unwrap()
        })
        .await;
    let delivered = time::timeout(Duration::from_secs(20), async {
        loop {
            updates.borrow_and_update();
            if phone
                .read(move |lab, me| lab.item(me, chat).is_some())
                .await
            {
                break;
            }
            updates
                .changed()
                .await
                .expect("live view notifications remain open");
        }
    })
    .await;
    delivered.expect("a reactive consumer sees the live edit without polling");
    let sender_body = mac.read(move |lab, me| lab.item(me, chat).and_then(|item| item.read(avendb::lens::View::document_v1()))).await;
    let receiver_body = phone.read(move |lab, me| lab.item(me, chat).and_then(|item| item.read(avendb::lens::View::document_v1()))).await;
    assert!(sender_body.is_some());
    assert_eq!(receiver_body, sender_body, "the exact live body is decrypted");
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
