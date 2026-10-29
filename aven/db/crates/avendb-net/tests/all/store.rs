//! A node's edits on its shelf (v8 phase S), here a folder's (`disk`), as on the Mac: what its device holds comes back
//! whole and in its order when the node starts again; a place's first shelf deletes nothing it finds beside it, a
//! shelf of before the last reset or an earlier avenDB's store, and a shelf put aside stays whole beside the next;
//! avenDB's floor stays where its last reset left it; a head follows every 64 journal entries; a head or an
//! entry cut short is passed and never replaced; an edit whose signatures fail brings a head of the whole log; an
//! object is put once, and a slot kept in place; and a node steps on its stored view as it starts, takes the keys it
//! opened from its shelf, and doesn't check again the edits they name.
#![cfg(debug_assertions)]

use crate::common;

use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::sync::atomic::{AtomicU8, Ordering};
use avendb_testkit::until;

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
    assert_eq!(
        disk::generations(dir.path()).expect("its shelves"),
        vec![1, FLOOR],
        "a new one, of the floor's, beside"
    );
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
async fn the_edits_its_keys_name_are_not_checked_again_and_forged_keys_vouch_for_none() {
    let dir = Folder::new("vouched");
    let (node, _, coop) = mac(dir.path()).await;
    // past 64 journal entries, and more than three times the edits a head comes after with `test-fixtures` (64): the
    // edits after the newest head, which a start checks, are fewer than a third of all
    for n in 0..140 {
        write(&node, coop, &format!("Note {n}"), &format!("note number {n}")).await;
    }
    warmed(&node).await;
    let held = node.read(|lab, me| lab.log(me).ids().to_vec()).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    let g = dir.path().join(format!("g{FLOOR}"));
    // started again: the edits its keys name come back unchecked, only those after them are checked
    let (node, _, _) = mac(dir.path()).await;
    assert_eq!(node.read(|lab, me| lab.log(me).ids().to_vec()).await, held, "every edit, in its order");
    let (checked, offered) = node.read(|lab, me| checks(lab, me)).await;
    assert!(offered as usize >= held.len() && checked * 3 < offered, "checked {checked} of {offered}");
    node.shutdown().await.expect("it stops");
    drop(node);
    // a head put after it, the same but for its number, vouches for nothing: its keys name another
    let heads = g.join("heads");
    let (newest, bytes) = files(&heads).into_iter().last().expect("a head");
    let next = u64::from_str_radix(&newest, 16).expect("a number") + 1;
    fs::write(heads.join(format!("{next:016x}")), bytes).expect("put");
    let (node, _, _) = mac(dir.path()).await;
    assert_eq!(node.read(|lab, me| lab.log(me).ids().to_vec()).await, held);
    let (all, _) = node.read(|lab, me| checks(lab, me)).await;
    assert!(all > checked * 3, "every edit checked, but those a checkpoint covers: {all} of {offered}");
    warmed(&node).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    // and its keys name it once it checked it
    let (node, _, _) = mac(dir.path()).await;
    let (again, _) = node.read(|lab, me| checks(lab, me)).await;
    assert!(again * 3 < offered, "checked {again} of {offered}");
    node.shutdown().await.expect("it stops");
    drop(node);
    // keys another key sealed vouch for nothing: every edit is checked again
    for name in ["keys-0", "keys-1"].map(|n| g.join("slots").join(n)).into_iter().filter(|p| p.exists()) {
        fs::write(name, [&b"avenDB keys 1\n"[..], &[0; 8], &[7u8; 80]].concat()).expect("forged");
    }
    let (node, _, _) = mac(dir.path()).await;
    assert_eq!(node.read(|lab, me| lab.log(me).ids().to_vec()).await, held);
    let (all, again) = node.read(|lab, me| checks(lab, me)).await;
    assert_eq!(again, offered, "offered the same edits");
    assert!(all > checked * 3, "every edit checked, but those a checkpoint covers: {all} of {offered}");
    node.shutdown().await.expect("it stops");
}

/// Alice's Mac as `mac` starts it, its edits spilled into folder `spill`, as theOS holds them (`avendb_device`).
async fn spilled_mac(dir: &Path, spill: &Path) -> (Node, World, VaultId) {
    static STARTS: AtomicU8 = AtomicU8::new(101);
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let mut lab = w.lab.split(w.mac_a, &[w.passkey_a], [STARTS.fetch_add(1, Ordering::Relaxed); 32]);
    lab.spill(w.mac_a, &avendb::lab::Spill::new(spill, 1 << 20).expect("a spill")).expect("spilled");
    let opts = Options { shelf: Some(disk::open(dir).expect("the shelf")), ..Options::local() };
    let node = Node::spawn(lab, w.mac_a, opts).await.expect("a node");
    (node, w, coop)
}

/// A spilled node starting again takes the packs of its newest head back by their rows (`Lab::log_rows`): never
/// reading, hashing or decoding their edits, each held where its pack holds it and decoded as it is first read. The
/// same edits in the same order, and what they say reads the same.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_spilled_node_takes_its_packs_back_by_their_rows() {
    let (dir, spill) = (Folder::new("by-rows"), Folder::new("by-rows-spill"));
    let (node, _, coop) = spilled_mac(dir.path(), spill.path()).await;
    let first = write(&node, coop, "Note first", "the first note").await;
    for n in 0..140 {
        write(&node, coop, &format!("Note {n}"), &format!("note number {n}")).await;
    }
    warmed(&node).await;
    let held = node.read(|lab, me| lab.log(me).ids().to_vec()).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    let rows = files(&dir.path().join(format!("g{FLOOR}")).join("rows")).len();
    assert!(rows >= 1, "a pack's rows beside it");
    let (node, _, _) = spilled_mac(dir.path(), spill.path()).await;
    assert_eq!(node.read(|lab, me| lab.log(me).ids().to_vec()).await, held, "every edit, in its order");
    let by_rows = node.read(|lab, me| counted(lab, me, "edits by rows")).await;
    assert!(by_rows as usize * 3 > held.len() * 2, "the packs taken by their rows: {by_rows} of {}", held.len());
    assert!(shows(&node, first, "the first note").await, "an edit by place reads as it did");
    node.shutdown().await.expect("it stops");
}

/// A catch-up: many edits taken in a few saves, far fewer than the 64 a head follows. A head follows them all the
/// same, once the journal holds `TAIL_EDITS` edits (64 with `test-fixtures`, a page without), and the next start checks
/// only the edits after it, fewer than one save's, not every one.
#[cfg(feature = "test-fixtures")]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_catch_up_in_few_saves_is_not_checked_again() {
    let dir = Folder::new("caught-up");
    let (node, _, coop) = mac(dir.path()).await;
    write(&node, coop, "Welcome", WELCOME_TEXT).await;
    const CHUNK: usize = 100;
    for chunk in 0..3 {
        node.act(move |lab: &mut Lab, me| {
            for n in 0..CHUNK {
                let doc = document(&format!("Note {chunk}-{n}"), "taken", me);
                lab.create(me, coop, coop, "doc", &[], doc).expect("a note");
            }
        })
        .await;
        until("the shelf holds them", || async { !node.behind().await }).await;
    }
    warmed(&node).await;
    let held = node.read(|lab, me| lab.log(me).ids().to_vec()).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    let (node, _, _) = mac(dir.path()).await;
    assert_eq!(node.read(|lab, me| lab.log(me).ids().to_vec()).await, held, "every edit, in its order");
    let (checked, offered) = node.read(|lab, me| checks(lab, me)).await;
    assert!(offered as usize >= held.len(), "offered {offered} of {}", held.len());
    assert!((checked as usize) < CHUNK, "only the edits after its newest head are checked: {checked} of {offered}");
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
    // what holds its history stays as it was: the rest is what its device worked out, which a derivation of the log it
    // starts from replaces
    let held = history(&before);
    assert!(held.keys().any(|name| name.contains("/blobs/")), "the blobs its journal names are of it: {:?}", held.keys());
    for (name, bytes) in held {
        assert_eq!(after.get(&name), Some(&bytes), "{name} stays as it was");
    }
    assert!(after.contains_key(&format!("g{FLOOR}/heads/0000000000000001")), "a head of the whole log");
    let (node, _, _) = mac(dir.path()).await;
    assert_eq!(node.read(|lab, me| lab.log(me).ids().to_vec()).await, ids, "from which the Mac starts again");
    node.shutdown().await.expect("it stops");
}

/// What of a shelf's `files` holds its device's history (`avendb_net::edits`): its journal entries and heads, and the
/// blobs they name, each pack of edits and McEliece key, with their outboards. The rest holds none: its slots, and the
/// blobs only what its device worked out names (an index's pages, the packs of its kept showings and query views),
/// which go once a newer derivation names them no more.
fn history(files: &BTreeMap<String, Vec<u8>>) -> BTreeMap<String, Vec<u8>> {
    let generation = format!("g{FLOOR}/");
    let blobs = |bytes: &[u8], at: usize| {
        let n = u32::from_be_bytes(bytes[at..at + 4].try_into().expect("4 bytes")) as usize;
        let named: Vec<String> = (0..n).map(|i| iroh_blobs::Hash::from_bytes(bytes[at + 4 + i * 40..at + 36 + i * 40].try_into().expect("32 bytes")).to_hex()).collect();
        (named, at + 4 + n * 40)
    };
    let mut named = Vec::new();
    for (name, bytes) in files {
        let Some(name) = name.strip_prefix(&generation) else { continue };
        if name.starts_with("journal/") {
            // after its header, its keys
            named.extend(blobs(bytes, b"avenDB journal 1\n".len()).0);
        } else if name.starts_with("heads/") {
            // after its header and the journal entry it goes on from, its packs, then its keys
            let (packs, at) = blobs(bytes, b"avenDB head 1\n".len() + 8);
            named.extend(packs);
            named.extend(blobs(bytes, at).0);
        }
    }
    let held = |name: &str| {
        name.strip_prefix(&generation).is_some_and(|n| {
            n.starts_with("journal/") || n.starts_with("heads/")
                || named.iter().any(|h| n == format!("blobs/{h}") || n == format!("outboards/{h}"))
        })
    };
    files.iter().filter(|(name, _)| held(name)).map(|(n, b)| (n.clone(), b.clone())).collect()
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
    let owner = disk::open(dir.path()).expect("the shelf").writer().expect("writer");
    let shelf: Shelf = owner.shelf();
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
    let owner = disk::open(dir.path()).expect("the shelf").writer().expect("writer");
    let shelf: Shelf = owner.shelf();
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
async fn a_node_takes_its_keys_from_its_shelf_and_opens_them_again_where_none_opens() {
    let dir = Folder::new("warm");
    let (node, w, coop) = mac(dir.path()).await;
    let (alice, phone, passkey) = (w.alice, w.phone_a, w.passkey_a);
    let remove = move |lab: &mut Lab, me: SignerId| {
        lab.submit(me, &[passkey], Action::Revoke(Revoking::Device { vault: alice, device: phone, keep: vec![] }))
    };
    node.act(remove).await.expect("Alice's phone removed");
    let welcome = write(&node, coop, "Welcome", WELCOME_TEXT).await;
    warmed(&node).await;
    let held = node.read(|lab, me| lab.log(me).ids().to_vec()).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    let g = dir.path().join(format!("g{FLOOR}"));
    let named = |folder: &str| files(&g.join(folder)).into_keys().map(|n| format!("{folder}/{n}")).collect::<Vec<_>>();
    for old in ["warm", "opened", "sealed"] {
        assert!(!g.join(old).exists(), "{old}/ is put no more");
    }
    // each start again: every edit in its order, Welcome shown, and what it took from its shelf and worked out anew
    let start = || async {
        let (node, _, _) = mac(dir.path()).await;
        assert_eq!(node.read(|lab, me| lab.log(me).ids().to_vec()).await, held, "every edit, in its order");
        assert!(shows(&node, welcome, WELCOME_TEXT).await, "it shows Welcome again");
        let counts = node.read(|lab, me| {
            let count = |what| counted(lab, me, what);
            (count("replay: from its stored view"), count("keys from the shelf"), count("keys opened"))
        });
        let counts = counts.await;
        // its saver keeps its keys and its view as it comes to, with no edit to save and before it stops
        warmed(&node).await;
        node.shutdown().await.expect("it stops");
        counts
    };
    // started again: its replay from its view, and the keys it made itself opened from their boxes, then kept
    let (from_view, shelved, opened) = start().await;
    assert!(from_view == 1 && shelved == 0 && opened > 0, "from its view {from_view}, keys {shelved}, opened {opened}");
    // and again: every key from its shelf, no box opened again, and nothing kept anew
    let kept = files(&g.join("slots"));
    let (from_view, shelved, opened) = start().await;
    assert!(from_view == 1 && shelved > 0 && opened == 0, "from its view {from_view}, keys {shelved}, opened {opened}");
    assert_eq!(files(&g.join("slots")), kept, "what its shelf holds already is kept no more");
    // what it can't open it passes: it replays every edit, opens every box again, and keeps both anew
    for name in named("slots") {
        fs::write(g.join(name), [7u8; 80]).expect("a forged one");
    }
    let (from_view, shelved, opened) = start().await;
    assert!(from_view == 0 && shelved == 0 && opened > 0, "from its view {from_view}, keys {shelved}, opened {opened}");
    let (from_view, shelved, opened) = start().await;
    assert!(from_view == 1 && shelved > 0 && opened == 0, "from its view {from_view}, keys {shelved}, opened {opened}");
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
    // its view's rows lie in the index `view`, whose root its two slots keep, in turn
    let slots = || {
        files(&g.join("slots")).into_iter().filter(|(n, _)| n.starts_with("index-view-")).collect::<BTreeMap<_, _>>()
    };
    let first = slots();
    assert_eq!(first.len(), 1, "its view, kept");
    let (first_name, first_slot) = first.iter().next().map(|(n, b)| (n.clone(), b.clone())).expect("a slot");
    // started again: what its edits said comes from its view, with no replay of every edit, and a new edit steps on it
    let (node, _, coop) = mac(dir.path()).await;
    assert!(shows(&node, welcome, WELCOME_TEXT).await, "it shows Welcome again");
    let (from_view, wholes) = replays(&node, VIEW).await;
    assert_eq!(from_view, 1, "from its view");
    let onboarding = write(&node, coop, "Onboarding", ONBOARDING_TEXT).await;
    let held = node.read(|lab, me| lab.log(me).ids().to_vec()).await;
    warmed(&node).await;
    assert_eq!(slots(), first, "one small running edit does not bypass the background snapshot interval");
    node.shutdown().await.expect("it stops");
    drop(node);
    let closed = slots();
    assert_eq!(closed.len(), 2, "clean close publishes the current frontier beside the older view");
    assert_eq!(closed[&first_name], first_slot, "clean close preserves the older generation for fallback");
    let newest = closed.keys().find(|n| **n != first_name).cloned().expect("the newer slot");
    // and again: the clean-close view covers the latest durable edit.
    let (node, _, _) = mac(dir.path()).await;
    assert_eq!(node.read(|lab, me| lab.log(me).ids().to_vec()).await, held, "every edit, in its order");
    assert!(shows(&node, welcome, WELCOME_TEXT).await && shows(&node, onboarding, ONBOARDING_TEXT).await);
    assert_eq!(replays(&node, VIEW).await, (1, wholes), "from its view, the edits after it stepped on");
    node.shutdown().await.expect("it stops");
    drop(node);
    assert_eq!(slots(), closed, "an unchanged reopen and close do not publish another view");
    // Corrupt the newest slot while retaining its header. The older valid view, its rows and the blobs they name
    // still on the shelf, must still open and replay the suffix containing Onboarding.
    let mut damaged_newest = closed[&newest].clone();
    damaged_newest[b"avenDB index slot 1\n".len() + 8..].fill(7);
    fs::write(g.join("slots").join(&newest), damaged_newest).expect("a forged newest view");
    let (node, _, _) = mac(dir.path()).await;
    assert_eq!(node.read(|lab, me| lab.log(me).ids().to_vec()).await, held, "older view retains every durable edit");
    assert!(shows(&node, welcome, WELCOME_TEXT).await && shows(&node, onboarding, ONBOARDING_TEXT).await);
    assert_eq!(replays(&node, VIEW).await, (1, wholes), "older valid view plus canonical suffix");
    node.shutdown().await.expect("it stops");
    drop(node);
    // Full replay requires corrupting EVERY retained generation, including the
    // current-frontier view intentionally published by the preceding clean close.
    for name in slots().keys() {
        fs::write(g.join("slots").join(name), [7u8; 80]).expect("a forged view generation");
    }
    let (node, _, _) = mac(dir.path()).await;
    assert!(shows(&node, welcome, WELCOME_TEXT).await && shows(&node, onboarding, ONBOARDING_TEXT).await);
    assert_eq!(node.read(|lab, me| lab.log(me).ids().to_vec()).await, held, "a whole replay keeps every durable edit");
    assert_eq!(replays(&node, VIEW).await, (0, wholes + 1), "no view opens: every edit replayed");
    warmed(&node).await;
    node.shutdown().await.expect("it stops");
    drop(node);
    let kept = slots();
    assert_eq!(kept.len(), 2, "invalid generations remain on disk; one is replaced by a valid view");
    assert_eq!(kept.values().filter(|b| **b == [7u8; 80]).count(), 1, "recovery does not erase the other slot");
    // a newer view that doesn't open is passed for the older one that does
    let forged = kept.iter().find(|(_, b)| **b == [7u8; 80]).map(|(n, _)| n.clone()).expect("the forged slot");
    let newer = [&b"avenDB index slot 1\n"[..], &9u64.to_be_bytes(), &[7u8; 80]].concat();
    fs::write(g.join("slots").join(forged), newer).expect("a forged one");
    let (node, _, _) = mac(dir.path()).await;
    assert!(shows(&node, onboarding, ONBOARDING_TEXT).await);
    assert_eq!(replays(&node, VIEW).await, (1, wholes), "the view kept anew opens");
    node.shutdown().await.expect("it stops");
}
