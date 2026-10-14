//! A node's edits on its shelf (v8 phase S), here a folder's (`disk`), as on the Mac: what its device holds comes back
//! whole and in its order when the node starts again; a place's first shelf clears whatever came before the last
//! reset, and a shelf put aside stays whole beside the next; a head follows every 64 journal entries; a head or an
//! entry cut short is passed and never replaced; an edit whose signatures fail brings a head of the whole log; and an
//! object is put once.

mod common;

use std::collections::BTreeMap;
use std::fs;
use std::future::Future;
use std::io::ErrorKind;
use std::path::Path;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::{Duration, Instant};

use avendb::cast::*;
use avendb::id::{EditId, EntryId, SignerId, VaultId};
use avendb::lab::Lab;
use avendb::sign::Signed;
use avendb::wire::Wire;
use avendb_net::shelf::FLOOR;
use avendb_net::{Node, Options, Shelf, disk};
use bytes::Bytes;
use common::Folder;

/// Waits until `check` holds, 60 seconds at most.
async fn until<F: Future<Output = bool>>(what: &str, mut check: impl FnMut() -> F) {
    let end = Instant::now() + Duration::from_secs(60);
    while !check().await {
        assert!(Instant::now() < end, "{what}, within 60 s");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// Every file under `dir`, by its path there, with its bytes.
fn files(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut found = BTreeMap::new();
    for entry in fs::read_dir(dir).expect("a folder") {
        let path = entry.expect("an entry").path();
        let name = path.file_name().expect("a name").to_string_lossy().to_string();
        if path.is_dir() {
            found.extend(files(&path).into_iter().map(|(n, bytes)| (format!("{name}/{n}"), bytes)));
        } else {
            found.insert(name, fs::read(&path).expect("a file"));
        }
    }
    found
}

/// Alice's Mac, from a world of its own with the coop ready, on the shelf in folder `dir`: its randomness drawn anew
/// at each start, as a device's is, so that it never draws an entry's id twice.
async fn mac(dir: &Path) -> (Node, World, VaultId) {
    static STARTS: AtomicU8 = AtomicU8::new(1);
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let lab = w.lab.split(w.mac_a, &[w.passkey_a], [STARTS.fetch_add(1, Ordering::Relaxed); 32]);
    let opts = Options { shelf: Some(disk::open(dir).expect("the shelf")), ..Options::local() };
    let node = Node::spawn(lab, w.mac_a, opts).await.expect("a node");
    (node, w, coop)
}

/// Writes a document titled `title` into `coop` on `node`, and waits until its shelf holds it.
async fn write(node: &Node, coop: VaultId, title: &str, body: &str) -> EntryId {
    let (title, body) = (title.to_string(), body.to_string());
    let doc = move |lab: &mut Lab, me: SignerId| lab.create(me, coop, coop, "doc", &[], document(&title, &body, me));
    let entry = node.act(doc).await.expect("a document");
    until("the shelf holds it", || async { !node.behind().await }).await;
    entry
}

async fn shows(node: &Node, entry: EntryId, body: &str) -> bool {
    node.read(move |lab, me| text(lab, me, entry, 2)).await.as_deref() == Some(body)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn edits_and_keys_come_back_in_the_order_they_were_taken() {
    let dir = Folder::new("order");
    let (node, _, coop) = mac(dir.path()).await;
    let welcome = write(&node, coop, "Welcome", WELCOME_TEXT).await;
    let held = node.read(|lab, me| (lab.log(me).ids().to_vec(), lab.size(me))).await;
    assert!(held.1.1 > 0, "the Mac holds McEliece keys");
    node.shutdown().await.expect("it stops");
    drop(node);
    // the same Mac from a world that never saw Welcome: what it took comes from its shelf
    let (node, _, _) = mac(dir.path()).await;
    let again = node.read(|lab, me| (lab.log(me).ids().to_vec(), lab.size(me))).await;
    assert_eq!(again.0, held.0, "every edit, in the order the Mac took them");
    assert_eq!(again.1, held.1, "and every McEliece key");
    assert!(shows(&node, welcome, WELCOME_TEXT).await, "it shows Welcome again");
    assert!(!node.behind().await, "and its shelf holds all it holds");
    node.shutdown().await.expect("it stops");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_shelf_clears_what_came_before_the_last_reset_and_puts_older_ones_aside_whole() {
    let dir = Folder::new("aside");
    // an earlier avenDB's store, which no avenDB reads again
    fs::create_dir_all(dir.path().join("store/keys")).expect("its folders");
    fs::write(dir.path().join("store/ops"), [0, 0, 0, 3, 1, 2, 3]).expect("its edits");
    fs::write(dir.path().join("store/keys/old"), [7; 64]).expect("a key");
    fs::write(dir.path().join("meta.json"), "{\"name\":\"Alice's Mac\"}").expect("its meta");
    // and a shelf of a generation older than avenDB's floor, from before its last reset
    fs::create_dir_all(dir.path().join("g1/journal")).expect("an old shelf");
    fs::write(dir.path().join("g1/journal/0000000000000001"), [9; 8]).expect("an old journal entry");
    let earlier = files(dir.path());
    assert_eq!(disk::generations(dir.path()).expect("its shelves"), vec![1], "an old shelf alone");
    let (node, _, coop) = mac(dir.path()).await;
    assert_eq!(disk::generations(dir.path()).expect("its shelves"), vec![FLOOR], "a new one, of the floor's, alone");
    let welcome = write(&node, coop, "Welcome", WELCOME_TEXT).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    let now = files(dir.path());
    assert!(earlier.keys().all(|name| !now.contains_key(name)), "what came before the reset is cleared: {now:?}");
    assert!(now.keys().all(|n| n.starts_with(&format!("g{FLOOR}/"))), "all there is is in the new shelf");
    assert_eq!(fs::read_dir(dir.path()).expect("its folder").count(), 1, "not even an empty folder of before");
    // put aside: a second shelf beside it, which holds nothing, and the first stays whole
    assert_eq!(disk::aside(dir.path()).expect("put aside"), FLOOR + 1);
    assert_eq!(disk::generations(dir.path()).expect("its shelves"), vec![FLOOR, FLOOR + 1]);
    let (node, _, coop) = mac(dir.path()).await;
    assert!(!shows(&node, welcome, WELCOME_TEXT).await, "the Mac starts on the new shelf, without Welcome");
    write(&node, coop, "Onboarding", ONBOARDING_TEXT).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    let after = files(dir.path());
    for (name, bytes) in &now {
        assert_eq!(after.get(name), Some(bytes), "{name} stays as it was");
    }
    let journal = format!("g{}/journal/", FLOOR + 1);
    assert!(after.keys().any(|n| n.starts_with(&journal)), "and the new shelf keeps what the Mac takes");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_head_follows_every_64_journal_entries_and_one_cut_short_is_passed() {
    let dir = Folder::new("heads");
    let (node, _, coop) = mac(dir.path()).await;
    let mut written = Vec::new();
    for n in 0..70 {
        written.push(write(&node, coop, &format!("Note {n}"), &format!("note number {n}")).await);
    }
    let held = node.read(|lab, me| lab.size(me)).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    let g1 = dir.path().join(format!("g{FLOOR}"));
    let heads: Vec<String> = files(&g1.join("heads")).into_keys().collect();
    assert_eq!(heads, vec!["0000000000000001".to_string()], "one head, after the first 64 entries");
    let entries = files(&g1.join("journal")).len();
    assert!(entries >= 70, "an entry for each save, and none replaced: {entries}");
    let (node, _, _) = mac(dir.path()).await;
    assert_eq!(node.read(|lab, me| lab.size(me)).await, held, "started again from the head and the journal after it");
    assert!(shows(&node, written[0], "note number 0").await && shows(&node, written[69], "note number 69").await);
    node.shutdown().await.expect("it stops");
    drop(node);
    // the head cut short: the Mac reads the whole journal instead, and leaves the head as it is
    let head = g1.join("heads/0000000000000001");
    let torn = fs::read(&head).expect("the head")[..40].to_vec();
    fs::write(&head, &torn).expect("cut short");
    let (node, _, coop) = mac(dir.path()).await;
    assert_eq!(node.read(|lab, me| lab.size(me)).await, held, "every edit, from the journal alone");
    write(&node, coop, "Note 70", "note number 70").await;
    node.shutdown().await.expect("it stops");
    drop(node);
    assert_eq!(fs::read(&head).expect("the head"), torn, "the head cut short stays as it is");
    let heads: Vec<String> = files(&g1.join("heads")).into_keys().collect();
    assert_eq!(heads, ["0000000000000001", "0000000000000002"], "and the next head comes after it");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_journal_entry_cut_short_is_passed_and_never_replaced() {
    let dir = Folder::new("torn");
    let (node, _, coop) = mac(dir.path()).await;
    let welcome = write(&node, coop, "Welcome", WELCOME_TEXT).await;
    let onboarding = write(&node, coop, "Onboarding", ONBOARDING_TEXT).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    let journal = dir.path().join(format!("g{FLOOR}/journal"));
    let last = files(&journal).into_keys().last().expect("an entry");
    let path = journal.join(&last);
    let torn = fs::read(&path).expect("the entry")[..60].to_vec();
    fs::write(&path, &torn).expect("cut short");
    let (node, _, coop) = mac(dir.path()).await;
    assert!(shows(&node, welcome, WELCOME_TEXT).await, "the entries before it read whole");
    assert!(!shows(&node, onboarding, ONBOARDING_TEXT).await, "the one cut short is passed");
    write(&node, coop, "Charter", CHARTER_TEXT).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    assert_eq!(fs::read(&path).expect("the entry"), torn, "and stays as it is, never replaced");
    let after = files(&journal).into_keys().last().expect("an entry");
    assert!(after > last, "the journal goes on after it: {after}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_edit_whose_signatures_fail_brings_a_head_of_the_whole_log() {
    let dir = Folder::new("forged");
    let (node, _, coop) = mac(dir.path()).await;
    write(&node, coop, "Welcome", WELCOME_TEXT).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    // a byte of the last edit's signature, changed in its entry, which is summed again so that it reads whole
    let journal = dir.path().join(format!("g{FLOOR}/journal"));
    let path = journal.join(files(&journal).into_keys().last().expect("an entry"));
    let mut bytes = fs::read(&path).expect("the entry");
    let forged = last_edit(&bytes);
    let body = bytes.len() - 32;
    bytes[body - 40] ^= 1;
    let sum = iroh_blobs::Hash::new(&bytes[..body]);
    bytes[body..].copy_from_slice(sum.as_bytes());
    fs::write(&path, &bytes).expect("changed");
    let before = files(dir.path());
    let (node, _, _) = mac(dir.path()).await;
    let ids = node.read(|lab, me| lab.log(me).ids().to_vec()).await;
    assert!(!ids.contains(&forged), "the device doesn't take it back");
    until("the shelf holds a head of the whole log", || async { !node.behind().await }).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    let after = files(dir.path());
    for (name, bytes) in &before {
        assert_eq!(after.get(name), Some(bytes), "{name} stays as it was");
    }
    assert!(after.contains_key(&format!("g{FLOOR}/heads/0000000000000001")), "a head of the whole log");
    let (node, _, _) = mac(dir.path()).await;
    assert_eq!(node.read(|lab, me| lab.log(me).ids().to_vec()).await, ids, "from which the Mac starts again");
    node.shutdown().await.expect("it stops");
}

/// The id of the last edit of journal entry `entry`: after its header, its keys, each 72 bytes, and its records, the
/// BLAKE3 hash of all before it.
fn last_edit(entry: &[u8]) -> EditId {
    let body = &entry[..entry.len() - 32];
    let header = b"avenDB journal 1\n".len();
    let keys = u32::from_be_bytes(body[header..header + 4].try_into().expect("4 bytes")) as usize;
    let (mut at, mut last) = (header + 4 + keys * 72, None);
    while at < body.len() {
        let len = u32::from_be_bytes(body[at..at + 4].try_into().expect("4 bytes")) as usize;
        last = Some(Signed::from_wire(&body[at + 4..at + 4 + len]).expect("an edit").edit.id());
        at += 4 + len;
    }
    last.expect("an edit")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_object_is_put_once_and_owned_by_its_owner_alone() {
    let dir = Folder::new("put");
    let shelf: Shelf = disk::open(dir.path()).expect("the shelf");
    shelf.put("meta/0000000000000001", Bytes::from_static(b"one")).await.expect("put");
    shelf.put("meta/0000000000000001", Bytes::from_static(b"one")).await.expect("the same bytes again");
    let other = shelf.put("meta/0000000000000001", Bytes::from_static(b"two")).await.expect_err("other bytes");
    assert_eq!(other.kind(), ErrorKind::AlreadyExists);
    assert_eq!(shelf.get("meta/0000000000000001").await.expect("got"), Some(Bytes::from_static(b"one")));
    assert_eq!(shelf.get("meta/0000000000000002").await.expect("got"), None);
    shelf.put("device.key", Bytes::from_static(&[9; 32])).await.expect("put");
    let names = shelf.names("").await.expect("its names");
    assert_eq!(names, vec!["device.key".to_string(), "meta/0000000000000001".to_string()]);
    assert_eq!(shelf.names("meta/").await.expect("its names"), vec!["meta/0000000000000001".to_string()]);
    for name in ["../escape", "blobs/x", "new/x", "Meta", "a//b", ""] {
        let refused = shelf.put(name, Bytes::from_static(b"x")).await.expect_err(name);
        assert_eq!(refused.kind(), ErrorKind::InvalidInput, "{name:?} is refused");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let key = dir.path().join(format!("g{FLOOR}/device.key"));
        let mode = fs::metadata(key).expect("its file").permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "readable by its owner alone");
    }
}
