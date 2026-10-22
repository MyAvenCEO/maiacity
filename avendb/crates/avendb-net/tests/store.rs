//! A node's edits on its shelf (v8 phase S), here a folder's (`disk`), as on the Mac: what its device holds comes back
//! whole and in its order when the node starts again; a place's first shelf deletes nothing it finds beside it, a
//! shelf of before the last reset or an earlier avenDB's store, and a shelf put aside stays whole beside the next;
//! avenDB's floor stays where its last reset left it; a head follows every 64 journal entries; a head or an
//! entry cut short is passed and never replaced; an edit whose signatures fail brings a head of the whole log; an
//! object is put once, and a slot kept in place; and a node steps on its stored view as it starts.

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
use avendb::policy::{Action, Revoking};
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
async fn a_shelf_deletes_nothing_it_finds_and_puts_older_ones_aside_whole() {
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
    assert_eq!(disk::generations(dir.path()).expect("its shelves"), vec![1, FLOOR], "a new one, of the floor's, beside");
    let welcome = write(&node, coop, "Welcome", WELCOME_TEXT).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    let now = files(dir.path());
    for (name, bytes) in &earlier {
        assert_eq!(now.get(name), Some(bytes), "{name}, from before the last reset, stays as it was");
    }
    assert!(now.keys().any(|n| n.starts_with(&format!("g{FLOOR}/journal/"))), "the new shelf keeps what the Mac takes");
    // put aside: a second shelf beside it, which holds nothing, and the first stays whole
    assert_eq!(disk::aside(dir.path()).expect("put aside"), FLOOR + 1);
    assert_eq!(disk::generations(dir.path()).expect("its shelves"), vec![1, FLOOR, FLOOR + 1]);
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

/// How many edits device `me` of `lab` checked the signatures of, and how many it was offered, since it started.
fn checks(lab: &Lab, me: SignerId) -> (u64, u64) {
    let perf = lab.perf(me);
    let count = |k: &str| perf["counts"][k].as_u64().unwrap_or(0);
    (count("edits checked"), count("edits offered"))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_head_the_device_sealed_is_not_checked_again_and_a_forged_seal_is_passed() {
    let dir = Folder::new("sealed");
    let (node, _, coop) = mac(dir.path()).await;
    for n in 0..70 {
        write(&node, coop, &format!("Note {n}"), &format!("note number {n}")).await;
    }
    let held = node.read(|lab, me| lab.log(me).ids().to_vec()).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    let g = dir.path().join(format!("g{FLOOR}"));
    let sealed: Vec<String> = files(&g.join("sealed")).into_keys().collect();
    assert_eq!(sealed, ["0000000000000001"], "the head it put is sealed");
    // started again: the head's edits come back unchecked, only the journal's after it are checked
    let (node, _, _) = mac(dir.path()).await;
    assert_eq!(node.read(|lab, me| lab.log(me).ids().to_vec()).await, held, "every edit, in its order");
    let (checked, offered) = node.read(|lab, me| checks(lab, me)).await;
    assert!(offered as usize >= held.len() && checked * 3 < offered, "checked {checked} of {offered}");
    node.shutdown().await.expect("it stops");
    drop(node);
    // a seal another key made vouches for nothing: every edit is checked again
    fs::write(g.join("sealed/0000000000000001"), [7u8; 32]).expect("a forged seal");
    let (node, _, _) = mac(dir.path()).await;
    assert_eq!(node.read(|lab, me| lab.log(me).ids().to_vec()).await, held);
    let (all, again) = node.read(|lab, me| checks(lab, me)).await;
    assert_eq!(again, offered, "offered the same edits");
    assert!(all > checked * 3, "every edit checked, but those a checkpoint covers: {all} of {offered}");
    node.shutdown().await.expect("it stops");
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
    // all but the slots, kept in place, which hold no history
    for (name, bytes) in before.iter().filter(|(name, _)| !name.contains("/slots/")) {
        assert_eq!(after.get(name), Some(bytes), "{name} stays as it was");
    }
    assert!(after.contains_key(&format!("g{FLOOR}/heads/0000000000000001")), "a head of the whole log");
    let (node, _, _) = mac(dir.path()).await;
    assert_eq!(node.read(|lab, me| lab.log(me).ids().to_vec()).await, ids, "from which the Mac starts again");
    node.shutdown().await.expect("it stops");
}

/// The id of the last edit of journal entry `entry`: after its header, its keys, each 40 bytes (a BLAKE3 hash and a
/// size), and its records, the BLAKE3 hash of all before it.
fn last_edit(entry: &[u8]) -> EditId {
    let body = &entry[..entry.len() - 32];
    let header = b"avenDB journal 1\n".len();
    let keys = u32::from_be_bytes(body[header..header + 4].try_into().expect("4 bytes")) as usize;
    let (mut at, mut last) = (header + 4 + keys * 40, None);
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

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_slot_is_kept_in_place_and_never_put() {
    let dir = Folder::new("slots");
    let shelf: Shelf = disk::open(dir.path()).expect("the shelf");
    shelf.keep("slots/view-0", Bytes::from_static(b"one")).await.expect("kept");
    shelf.keep("slots/view-0", Bytes::from_static(b"two")).await.expect("kept again, in place");
    assert_eq!(shelf.get("slots/view-0").await.expect("got"), Some(Bytes::from_static(b"two")));
    let put = shelf.put("slots/view-1", Bytes::from_static(b"one")).await.expect_err("a slot is never put");
    assert_eq!(put.kind(), ErrorKind::InvalidInput);
    let kept = shelf.keep("meta/0000000000000001", Bytes::from_static(b"one")).await.expect_err("never kept");
    assert_eq!(kept.kind(), ErrorKind::InvalidInput, "what is put is never kept in place");
    assert_eq!(shelf.names("slots/").await.expect("its names"), vec!["slots/view-0".to_string()]);
    let staged = files(&dir.path().join(format!("g{FLOOR}/new")));
    assert!(staged.is_empty(), "nothing left beside it: {:?}", staged.keys());
}

/// avenDB is never reset again (Samuel 2026-10-19: "so no accidental resets can happen anymore"): its floor stays at
/// the generation its last reset left, so no place ever leaves the shelf it holds for a new, empty one.
#[test]
fn the_floor_stays_where_the_last_reset_left_it() {
    assert_eq!(FLOOR, 18, "raising the floor would leave every place's shelf for an empty one: a reset");
}

/// How many times device `me` of `lab` counted `what` since it started.
fn counted(lab: &Lab, me: SignerId, what: &str) -> u64 {
    lab.perf(me)["counts"][what].as_u64().unwrap_or(0)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_node_starts_from_what_it_worked_out_before_and_passes_what_it_cant_open() {
    let dir = Folder::new("warm");
    let (node, w, coop) = mac(dir.path()).await;
    let (alice, phone, passkey) = (w.alice, w.phone_a, w.passkey_a);
    let remove = move |lab: &mut Lab, me: SignerId| {
        lab.submit(me, &[passkey], Action::Revoke(Revoking::Device { vault: alice, device: phone, keep: vec![] }))
    };
    node.act(remove).await.expect("Alice's phone removed");
    let welcome = write(&node, coop, "Welcome", WELCOME_TEXT).await;
    let held = node.read(|lab, me| lab.log(me).ids().to_vec()).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    let g = dir.path().join(format!("g{FLOOR}"));
    let named = |folder: &str| files(&g.join(folder)).into_keys().map(|n| format!("{folder}/{n}")).collect::<Vec<_>>();
    assert!(!named("warm").is_empty(), "the choice its resolve made, put");
    // each start again: every edit in its order, Welcome shown, and what it took from its shelf and worked out anew,
    // with no view to step on, so that it replays every edit
    let start = || async {
        for (name, _) in files(&g.join("slots")) {
            fs::write(g.join("slots").join(name), [7u8; 80]).expect("no view");
        }
        let (node, _, _) = mac(dir.path()).await;
        assert_eq!(node.read(|lab, me| lab.log(me).ids().to_vec()).await, held, "every edit, in its order");
        assert!(shows(&node, welcome, WELCOME_TEXT).await, "it shows Welcome again");
        let counts = node.read(|lab, me| {
            let count = |what| counted(lab, me, what);
            (count("replay: removals as chosen before"), count("keys from the shelf"), count("keys opened"))
        });
        let counts = counts.await;
        // its saver puts what it worked out as it comes to, with no edit to save and before it stops
        let mut waited = 0;
        while node.read(|lab, me| lab.warm_due(me)).await {
            assert!(waited < 100, "what it worked out, put while it runs");
            tokio::time::sleep(Duration::from_millis(50)).await;
            waited += 1;
        }
        node.shutdown().await.expect("it stops");
        counts
    };
    // the first: it takes the removals as it chose them, and opens the boxes of the keys it made itself before
    let (chosen, shelved, opened) = start().await;
    assert!(chosen > 0 && shelved == 0 && opened > 0, "chosen {chosen}, from the shelf {shelved}, opened {opened}");
    assert!(!named("opened").is_empty(), "the keys it opened, put");
    let put = (named("warm"), named("opened"));
    // the next: it opens no box again, and puts nothing, as its shelf holds all it worked out
    let (chosen, shelved, opened) = start().await;
    assert!(chosen > 0 && shelved > 0 && opened == 0, "chosen {chosen}, from the shelf {shelved}, opened {opened}");
    assert_eq!((named("warm"), named("opened")), put, "what its shelf holds already is put no more");
    // what it can't open it passes, and works it out again
    for name in named("warm").into_iter().chain(named("opened")) {
        fs::write(g.join(name), [7u8; 80]).expect("a forged one");
    }
    let (chosen, shelved, opened) = start().await;
    assert!(chosen == 0 && shelved == 0 && opened > 0, "chosen {chosen}, from the shelf {shelved}, opened {opened}");
}

/// Waits until device `me` of `node` put on its shelf all it worked out.
async fn warmed(node: &Node) {
    until("what it worked out, put while it runs", || async { !node.read(|lab, me| lab.warm_due(me)).await }).await;
}

/// How many times device `me` of `node` counted `what`, and how many times it replayed every edit, since its world
/// was made: the same world each start, so that starts differ by what each did alone.
async fn replays(node: &Node, what: &'static str) -> (u64, u64) {
    node.read(move |lab, me| {
        let counts = lab.perf(me)["counts"].clone();
        let wholes = counts.as_object().into_iter().flatten().filter(|(k, _)| k.starts_with("replay whole"));
        (counted(lab, me, what), wholes.filter_map(|(_, n)| n.as_u64()).sum())
    })
    .await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_node_steps_on_its_stored_view_and_replays_every_edit_where_none_opens() {
    const VIEW: &str = "replay: from its stored view";
    let dir = Folder::new("view");
    let (node, _, coop) = mac(dir.path()).await;
    let welcome = write(&node, coop, "Welcome", WELCOME_TEXT).await;
    warmed(&node).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    let g = dir.path().join(format!("g{FLOOR}"));
    let slots = || files(&g.join("slots"));
    assert_eq!(slots().into_keys().collect::<Vec<_>>(), ["view-0"], "its view, kept");
    // started again: what its edits said comes from its view, with no replay of every edit, and a new edit steps on it
    let (node, _, coop) = mac(dir.path()).await;
    assert!(shows(&node, welcome, WELCOME_TEXT).await, "it shows Welcome again");
    let (from_view, wholes) = replays(&node, VIEW).await;
    assert_eq!(from_view, 1, "from its view");
    let onboarding = write(&node, coop, "Onboarding", ONBOARDING_TEXT).await;
    let held = node.read(|lab, me| lab.log(me).ids().to_vec()).await;
    warmed(&node).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    assert_eq!(slots().len(), 1, "one edit stepped on is no new view");
    // and again: the view is of the edits its log starts with, and those after it step on it
    let (node, _, _) = mac(dir.path()).await;
    assert_eq!(node.read(|lab, me| lab.log(me).ids().to_vec()).await, held, "every edit, in its order");
    assert!(shows(&node, welcome, WELCOME_TEXT).await && shows(&node, onboarding, ONBOARDING_TEXT).await);
    assert_eq!(replays(&node, VIEW).await, (1, wholes), "from its view, the edits after it stepped on");
    node.shutdown().await.expect("it stops");
    drop(node);
    // a view that doesn't open is passed: it replays every edit, and keeps its view anew
    fs::write(g.join("slots/view-0"), [7u8; 80]).expect("a forged one");
    let (node, _, _) = mac(dir.path()).await;
    assert!(shows(&node, welcome, WELCOME_TEXT).await && shows(&node, onboarding, ONBOARDING_TEXT).await);
    assert_eq!(replays(&node, VIEW).await, (0, wholes + 1), "no view opens: every edit replayed");
    assert_eq!(counted_on(&node, "stored view: none that opens").await, 1);
    warmed(&node).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    let kept = slots();
    assert_eq!(kept.keys().collect::<Vec<_>>(), ["view-0"], "kept anew, in place of what read as no view");
    assert_ne!(kept["view-0"], [7u8; 80]);
    // a newer view that doesn't open is passed for the older one that does
    let newer = [&b"avenDB slot 1\n"[..], &9u64.to_be_bytes(), &[7u8; 80]].concat();
    fs::write(g.join("slots/view-1"), newer).expect("a forged one");
    let (node, _, _) = mac(dir.path()).await;
    assert!(shows(&node, onboarding, ONBOARDING_TEXT).await);
    assert_eq!(replays(&node, VIEW).await, (1, wholes), "the newest view that opens");
    node.shutdown().await.expect("it stops");
}

async fn counted_on(node: &Node, what: &'static str) -> u64 {
    node.read(move |lab, me| counted(lab, me, what)).await
}
