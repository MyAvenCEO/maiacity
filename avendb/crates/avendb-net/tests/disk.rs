//! A node's store on disk (P8b): the signed ops its device holds, in the order it took them, and the McEliece keys
//! they name come back whole; a record a crash cut short is dropped and the file cut back, an op whose signatures fail
//! is dropped and the file written anew, and a node started again from its folder holds and shows what it held.

mod common;

use std::fs::{self, OpenOptions};
use std::io::Write as _;

use avendb::cast::*;
use avendb::id::OpId;
use avendb::lab::Lab;
use avendb_net::{Disk, Node, Options};
use common::Folder;

#[test]
fn ops_and_keys_come_back_in_the_order_they_were_taken() {
    let mut w = world();
    let h = handbook(&mut w);
    let dir = Folder::new("order");
    let (mut disk, nothing) = Disk::open(dir.path()).expect("a new store");
    assert!(nothing.signed().is_empty() && disk.is_empty(), "a new store holds nothing");
    disk.adopt(&w.lab, w.mac_s).expect("Samuel's Mac saves what it holds");
    let (disk, saved) = Disk::open(dir.path()).expect("the store again");
    let ids: Vec<OpId> = saved.signed().iter().map(|s| s.op.id()).collect();
    assert_eq!(ids, w.lab.log(w.mac_s).ids(), "every op, in the order the Mac took them");
    assert_eq!((disk.len(), saved.blob_count()), w.lab.size(w.mac_s), "and every McEliece key");
    w.lab.restore_backup(w.mac_s, &saved);
    assert_eq!(text(&w.lab, w.mac_s, h.space, h.welcome, 2).as_deref(), Some(WELCOME_TEXT), "it shows Welcome again");
}

#[test]
fn a_record_cut_short_is_dropped_and_the_file_cut_back() {
    let mut w = world();
    handbook(&mut w);
    let dir = Folder::new("cut");
    Disk::open(dir.path()).expect("a store").0.adopt(&w.lab, w.mac_s).expect("saved");
    let ops = dir.path().join("ops");
    let whole = fs::metadata(&ops).expect("the ops").len();
    // a crash in the middle of the next record: its length, and a few of its bytes
    OpenOptions::new().append(true).open(&ops).expect("the ops").write_all(&[0, 0, 40, 0, 1, 2, 3]).expect("written");
    let (disk, saved) = Disk::open(dir.path()).expect("the store again");
    assert_eq!(saved.signed().len(), w.lab.log(w.mac_s).ids().len(), "every whole record is read");
    assert_eq!(disk.len(), saved.signed().len());
    assert_eq!(fs::metadata(&ops).expect("the ops").len(), whole, "and the torn one cut off");
    // a key cut short never got its name, and is dropped
    let keys = dir.path().join("keys");
    fs::write(keys.join("cut-short.part"), [7; 100]).expect("a key cut short");
    fs::write(keys.join(w.lab.blob_ids(w.mac_s)[0].to_hex()), [7; 100]).expect("a key that isn't its name's");
    let (_, saved) = Disk::open(dir.path()).expect("the store again");
    assert_eq!(saved.blob_count(), w.lab.size(w.mac_s).1 - 1, "the key that isn't its name's is dropped");
    assert!(!keys.join("cut-short.part").exists(), "and so is the one cut short");
}

#[test]
fn an_op_whose_signatures_fail_is_dropped_and_the_store_written_anew() {
    let mut w = world();
    handbook(&mut w);
    let dir = Folder::new("forged");
    Disk::open(dir.path()).expect("a store").0.adopt(&w.lab, w.mac_s).expect("saved");
    let held = w.lab.log(w.mac_s).ids().len();
    // a byte of the last op's signature, changed on disk
    let ops = dir.path().join("ops");
    let mut bytes = fs::read(&ops).expect("the ops");
    let at = bytes.len() - 40;
    bytes[at] ^= 1;
    fs::write(&ops, bytes).expect("changed");
    let (mut disk, saved) = Disk::open(dir.path()).expect("the store again");
    assert_eq!(saved.signed().len(), held, "the changed op still reads as an op");
    w.lab.restore_backup(w.mac_s, &saved);
    assert_eq!(w.lab.log(w.mac_s).ids().len(), held - 1, "but the device doesn't take it back");
    disk.adopt(&w.lab, w.mac_s).expect("the store is written anew");
    let (disk, saved) = Disk::open(dir.path()).expect("the store again");
    assert_eq!((disk.len(), saved.signed().len()), (held - 1, held - 1), "without it");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_node_started_again_holds_and_shows_what_it_held() {
    let mut w = world();
    let (coop, space, _) = handbook_spaces(&mut w);
    let (mac_s, passkey_s) = (w.mac_s, w.passkey_s);
    let dir = Folder::new("restart");
    let opts = Options { store: Some(dir.path().to_path_buf()), ..Options::local() };
    let mac = Node::spawn(w.lab.split(mac_s, &[passkey_s], [1; 32]), mac_s, opts.clone()).await.expect("a node");
    let write = move |lab: &mut Lab, me| lab.create(me, coop, space, document("Welcome", WELCOME_TEXT, me));
    let welcome = mac.act(write).await.expect("Samuel's Mac writes Welcome");
    mac.shutdown().await.expect("it stops");
    drop(mac);
    // the same Mac from a world that never saw Welcome: what it took comes from its store
    let mut again = world();
    handbook_spaces(&mut again);
    let lab = again.lab.split(mac_s, &[passkey_s], [1; 32]);
    assert!(lab.item(mac_s, space, welcome).is_none(), "a world of its own holds no Welcome");
    let mac = Node::spawn(lab, mac_s, opts).await.expect("the node again");
    let shows = move |lab: &Lab, me| text(lab, me, space, welcome, 2);
    assert_eq!(mac.read(shows).await.as_deref(), Some(WELCOME_TEXT), "started again, it shows Welcome");
    mac.shutdown().await.expect("it stops");
}
