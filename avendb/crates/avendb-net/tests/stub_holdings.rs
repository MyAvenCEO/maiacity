//! A device whose first sync held key boxes back holds a stub of each (`Lab::set_lazy_boxes`, `LazyBoxes.lean`), and
//! counts it as held when it asks. Its holdings count it too: else a log whose head on its peer is such a box read as
//! lacked for good, its askings brought nothing new, and its views waited on it (an iPhone lacking 2,577 of 3,090 logs,
//! 2026-10-28, Fix D).

use avendb::cast::*;
use avendb::id::SignerId;
use avendb::lab::Lab;
use avendb::policy::{Action, Sharing};
use avendb_net::{Node, Options};

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_log_whose_head_is_a_box_held_back_is_reported_by_its_heads_and_ends_lacked_by_none() {
    let mut w = world();
    let h = handbook(&mut w);
    let ipad = w.lab.device_of(w.passkey_a, "Alice's iPad");
    let share = Action::Share(Sharing::Device { vault: w.alice, device: ipad, seal_to: None });
    w.lab.submit(w.mac_a, &[w.passkey_a, ipad], share).expect("Alice adds an iPad");
    w.lab.set_online(ipad, false);
    w.lab.sync_all(7);
    w.lab.set_online(ipad, true);
    w.lab.set_lazy_boxes(ipad, true);
    let mac_d = w.mac_a;
    let mac = Node::spawn(w.lab.split(mac_d, &[w.passkey_a], [1; 32]), mac_d, Options::local()).await.expect("Alice's Mac");
    let lazy = Node::spawn(w.lab.split(ipad, &[], [2; 32]), ipad, Options::local()).await.expect("Alice's iPad");
    lazy.know(mac.addr());
    mac.know(lazy.addr());
    lazy.sync_with(mac.id()).await.expect("its first sync");
    let welcome = h.welcome;
    assert!(lazy.read(move |lab: &Lab, me: SignerId| lab.reads(me, welcome)).await, "it reads Welcome");
    let taken = lazy.read(|lab: &Lab, me: SignerId| lab.stubs_taken(me)).await;
    assert!(taken > 0, "its first sync held boxes back");
    // while their bodies are on their way, the logs they head read lacked, and the report names them by their heads
    let synced = lazy.synced().await;
    eprintln!("STUBS taken {taken}; synced {synced}");
    let lacked = &synced["lacked"][0];
    assert_eq!(lacked["lacks"], synced["behind"], "{synced}");
    if synced["behind"].as_u64().is_some_and(|n| n > 0) {
        assert!(lacked["sample"][0]["lacked_heads"].as_array().is_some_and(|h| !h.is_empty()), "{synced}");
    }
    // once the bodies came, no log is lacked, by the stub or by what it holds
    for _ in 0..100 {
        let _ = lazy.sync_with(mac.id()).await;
        if lazy.read(|lab: &Lab, me: SignerId| lab.stubs(me).is_empty()).await {
            break;
        }
    }
    let synced = lazy.synced().await;
    assert_eq!(synced["behind"], 0, "{synced}");
    assert_eq!(synced["lacked"][0]["by_stub"], 0, "{synced}");
    mac.shutdown().await.expect("it stops");
    lazy.shutdown().await.expect("it stops");
}
