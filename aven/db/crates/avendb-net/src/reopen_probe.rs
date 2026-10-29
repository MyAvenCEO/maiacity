//! A device opening again from its shelf in a folder, as the Mac's does and a page's does from OPFS: what its `shelf`
//! step took, split as its note splits it into taking its edits back (`Lab::restore_page`) and reading its shelf, for
//! `REOPEN_EDITS` edits (5,000 if unset), its edits spilled as a page's are where `REOPEN_SPILL` names a cache in MiB.
//!
//!   REOPEN_EDITS=20000 REOPEN_SPILL=48 cargo test --release -p avendb-net --features test-fixtures --lib reopen_probe -- --ignored --nocapture

use std::time::Instant;

use avendb::cast::{todos_on, world};

use crate::progress::Progress;
use crate::{Node, Options};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore]
async fn reopen_probe() {
    let n: usize = std::env::var("REOPEN_EDITS").ok().and_then(|v| v.parse().ok()).unwrap_or(5000);
    let folder = std::env::temp_dir().join(format!("avendb-reopen-probe-{}", crate::shelf::fresh()));
    let mut w = world();
    let todos = todos_on(&mut w);
    let d = w.mac_a;
    let began = Instant::now();
    for i in 0..n {
        w.lab.edit(d, w.alice, todos.door, |item| item.set_text(1, &format!("write {i}"))).expect("a write");
    }
    let held = w.lab.size(d).0;
    eprintln!("REOPEN fixture: {held} edits in {:.1?}", began.elapsed());
    let shelf = crate::disk::open(&folder).expect("a shelf");
    let node = Node::spawn(w.lab.split(d, &[], [161; 32]), d, Options { shelf: Some(shelf.clone()), ..Options::local() })
        .await
        .expect("a node");
    node.shared.save().await.expect("saved");
    node.shutdown().await.expect("shut down");
    drop(node);
    let mut next = world();
    let mut lab = next.lab.split(d, &[], [162; 32]);
    let spill_dir = folder.join("spill");
    if let Ok(mib) = std::env::var("REOPEN_SPILL") {
        let budget = mib.parse::<usize>().expect("REOPEN_SPILL in MiB") << 20;
        lab.spill(d, &avendb::lab::Spill::new(&spill_dir, budget).expect("a spill")).expect("spilled");
    }
    let progress = Progress::new();
    progress.step("restore");
    let began = Instant::now();
    let opts = Options { shelf: Some(shelf), progress: progress.clone(), ..Options::local() };
    let node = Node::spawn(lab, d, opts).await.expect("opened again");
    let took = began.elapsed();
    let perf = node.read(|lab, me| lab.perf(me)).await;
    assert_eq!(node.read(|lab, me| lab.size(me).0).await, held, "it took back every edit");
    for s in progress.steps().steps {
        eprintln!("REOPEN step {} took {:?} ms: {}", s.step, s.took, s.note.unwrap_or_default());
    }
    eprintln!("REOPEN open {took:.1?}; timers {}", perf["timers"]);
    node.shutdown().await.expect("shut down");
    std::fs::remove_dir_all(folder).ok();
}
