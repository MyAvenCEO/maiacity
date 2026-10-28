//! Recovery changes can preserve edit/key counts while replacing what the node shows.
use avendb::cast::{handbook, text, world};
use avendb_net::{Node, Options};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restoring_a_different_history_of_the_same_size_wakes_subscribers() {
    let mut w = world();
    let h = handbook(&mut w);
    let (me, passkey) = (w.mac_a, w.passkey_a);
    let initial = w.lab.backup(me);
    w.lab.edit(me, h.coop, h.welcome, |i| i.set_text(2, "first branch")).unwrap();
    let first = w.lab.backup(me);
    let size = w.lab.size(me);
    let first_ids = w.lab.log(me).ids().to_vec();
    w.lab.restore_backup(me, &initial);
    w.lab.edit(me, h.coop, h.welcome, |i| i.set_text(2, "other branch")).unwrap();
    assert_eq!(w.lab.size(me), size, "the two branches have equal counts");
    assert_ne!(w.lab.log(me).ids(), first_ids, "but different contents");
    let node = Node::spawn(w.lab.split(me, &[passkey], [17; 32]), me, Options::local()).await.unwrap();
    let mut changed = node.changes();
    let mut stirred = node.stirs();
    changed.borrow_and_update();
    let before = *stirred.borrow_and_update();
    // A normal read neither replaces nor changes the log.
    node.read(|lab, me| lab.size(me)).await;
    assert!(!changed.has_changed().unwrap());
    node.act(move |lab, me| lab.restore_from(me, first)).await;
    assert_eq!(*changed.borrow(), size, "the advertised counts are unchanged");
    assert!(changed.has_changed().unwrap(), "recovery still wakes content subscribers");
    assert!(*stirred.borrow() > before, "it wakes UI subscriptions too");
    assert_eq!(node.read(move |lab, me| text(lab, me, h.welcome, 2)).await.as_deref(), Some("first branch"));
    node.shutdown().await.unwrap();
}
