//! A first pull cut off part of the way, as when the app closes during it, and the node started again from its shelf
//! (S2, 2026-10-28: such a device spun at a whole core on every start and never fetched more): it goes on from what
//! its shelf holds, what it holds only grows, and it ends holding every edit, caught up, in a bounded number of steps.
#![cfg(debug_assertions)]

use crate::common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use avendb::cast::*;
use avendb::id::{SignerId, VaultId};
use avendb::lab::Lab;
use avendb_net::{Node, Options, disk};
use avendb_testkit::until;
use common::Folder;

/// The world with the coop ready, the same each time it is made.
fn ready() -> (World, VaultId) {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    (w, coop)
}

/// Alice's iPhone from a world made anew, on the shelf in `dir`, its randomness drawn anew at each start.
/// With `whole`, the work its start does in one go (`Lab::set_restore_whole`).
async fn phone(dir: &std::path::Path, start: u8, whole: Option<usize>) -> Arc<Node> {
    let (mut w, _) = ready();
    let mut lab = w.lab.split(w.phone_a, &[w.passkey_a], [100 + start; 32]);
    if let Some(n) = whole {
        lab.set_restore_whole(w.phone_a, n);
    }
    let opts = Options { shelf: Some(disk::open(dir).expect("the shelf")), ..Options::local() };
    Arc::new(Node::spawn(lab, w.phone_a, opts).await.expect("Alice's iPhone"))
}

async fn held(node: &Node) -> usize {
    node.read(|lab: &Lab, me: SignerId| lab.log(me).ids().len()).await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_first_pull_cut_off_goes_on_from_its_shelf_when_started_again() {
    let (docs, edits) = (std::env::var("RESUME_DOCS").ok().and_then(|n| n.parse().ok()).unwrap_or(40), 40);
    let (mut w, coop) = ready();
    let mac_d = w.mac_a;
    for i in 0..docs {
        let entry = w.lab.create(mac_d, coop, coop, "doc", &[], document(&format!("Doc {i}"), "Written on the Mac.", mac_d))
            .expect("a document");
        for k in 0..edits {
            w.lab.edit(mac_d, coop, entry, |item| item.push_block(paragraph(100 + k as u64, &format!("Edit {k}.")))).expect("an edit");
        }
    }
    let mac = Node::spawn(w.lab.split(mac_d, &[w.passkey_a], [1; 32]), mac_d, Options::local()).await.expect("Alice's Mac");
    let all = held(&mac).await;
    let dir = Folder::new("resume");
    let first = phone(dir.path(), 0, None).await;
    let before = held(&first).await;
    first.know(mac.addr());
    mac.know(first.addr());
    // its first pull, cut off once it took some of the Mac's edits and not all
    let pulling = {
        let (first, id) = (first.clone(), mac.id());
        tokio::spawn(async move { first.sync_with(id).await })
    };
    until("some of the Mac's edits taken", || async { held(&first).await > before }).await;
    let cut = held(&first).await;
    pulling.abort();
    first.shutdown().await.expect("the app closes");
    drop(first);
    eprintln!("RESUME the Mac holds {all}, the iPhone {before} before its first pull, {cut} when it was cut off");
    assert!(cut < all, "cut off part of the way: {cut} of {all}");
    // and its stored view and kept showings gone, as an iPhone's that never kept one of a partial vault (2026-10-28)
    let generations = std::fs::read_dir(dir.path()).expect("the shelf's folder").map(|g| g.expect("a generation").path());
    let mut gone = 0;
    for generation in generations.filter(|g| g.is_dir()) {
        for slot in ["view-0", "view-1", "index-view-0", "index-view-1", "shown-0", "shown-1"] {
            gone += std::fs::remove_file(generation.join("slots").join(slot)).is_ok() as usize;
        }
    }
    assert!(gone > 0, "it kept a view to lose");
    // started again from its shelf: it holds at least what it took, and goes on to every edit, what it holds only
    // growing, and caught up within a bounded time
    let starting = Instant::now();
    // with nothing it may do in one go as it starts, as a start of a vault too big for that (an iPhone's unlock of a
    // partial vault, 313 s, 2026-10-28): it does a step and ends behind, its own catch-up doing the rest
    let again = phone(dir.path(), 1, Some(0)).await;
    let back = held(&again).await;
    let perf = again.read(|lab: &Lab, me: SignerId| lab.perf(me)).await;
    eprintln!("RESUME started again in {:?}: refresh {} counts {}", starting.elapsed(), perf["timers"]["refresh"], perf["counts"]);
    assert!(back >= before, "its shelf's edits back: {back}");
    assert!(perf["counts"]["restore: left to its catch-up"].as_u64().is_some_and(|n| n > 0), "its start left work to its catch-up");
    again.know(mac.addr());
    mac.know(again.addr());
    let began = Instant::now();
    let pulling = {
        let (again, id) = (again.clone(), mac.id());
        tokio::spawn(async move { again.sync_with(id).await })
    };
    let mut last = back;
    loop {
        let now = held(&again).await;
        assert!(now >= last, "what it holds only grows: {last} then {now}");
        last = now;
        if now >= all && !again.behind().await && !again.read(|lab: &Lab, me: SignerId| lab.catching_up(me)).await {
            break;
        }
        assert!(began.elapsed() < Duration::from_secs(120), "caught up in time: {now} of {all} held");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    pulling.await.expect("the pull ends").expect("the pull ends well");
    eprintln!("RESUME started again holding {back}, caught up on {all} in {:?}", began.elapsed());
    again.shutdown().await.expect("it stops");
    mac.shutdown().await.expect("it stops");
}
