//! The shared index held to `SharedIndex.lean`: after every save it holds the rows a rebuild from what the device's
//! edits say holds, with the same root; a crash at any write of a save leaves an index the next save brings there;
//! and a view lists an audience's entries of a link, the newest first.

use std::sync::atomic::Ordering;

use super::*;
use crate::shelf_index::tests::Memory;
use avendb::cast::{World, document, world};
use avendb::id::EditId;
use avendb::index::{link_label, tag_label, type_label};
use serde_json::json;

/// The rows a rebuild from device `me`'s edits holds, in key order (`SharedIndex.full`).
fn rebuilt(lab: &Lab, me: SignerId) -> Vec<(Vec<u8>, Vec<u8>)> {
    full_rows(lab, me)
}

/// A fresh index of what `me` holds, on a shelf of its own: its root.
async fn fresh_root(lab: &Mutex<Lab>, me: SignerId) -> Option<Sum> {
    let ix = SharedIndex::open(Memory::new().shelf()).await.unwrap();
    let held = lab.lock().unwrap().log(me).ids().len();
    assert!(
        matches!(ix.step(lab, me, held).await.unwrap(), Stepped::Entries(_)),
        "a new index puts every entry"
    );
    ix.root().await
}

async fn save(ix: &SharedIndex, lab: &Mutex<Lab>, me: SignerId) -> io::Result<Stepped> {
    let held = lab.lock().unwrap().log(me).ids().len();
    ix.step(lab, me, held).await
}

/// The schema of a message: a text and the room it is in, a link.
const MESSAGE: &str = r#"{ "title": "Message", "type": "object", "properties": { "kind": { "const": "message" },
    "text": { "type": "string", "default": "" }, "room": { "x-link": "newest" } }, "required": ["kind"] }"#;

fn op(w: &mut World, value: serde_json::Value) -> serde_json::Value {
    let mac = w.mac_a;
    let out = avendb::engine::run(&mut w.lab, mac, &value);
    out.get("ok").cloned().unwrap_or_else(|| panic!("{out}"))
}

fn message(w: &mut World, room: EntryId, n: u64) -> EntryId {
    let alice = w.alice.to_hex();
    let value = json!({ "kind": "message", "text": format!("message {n}"),
        "room": { "vault": alice, "entry": room.to_hex() } });
    let made = op(
        w,
        json!({ "op": "create", "vault": alice, "type": "note", "value": value }),
    );
    EntryId::from_hex(made["entry"].as_str().expect("an entry")).expect("its id")
}

/// Alice's Mac with rooms and messages in them, and a note, its schema of messages made.
fn alices(rooms: usize) -> (World, Vec<EntryId>) {
    let mut w = world();
    let alice = w.alice.to_hex();
    op(
        &mut w,
        json!({ "op": "create", "vault": alice, "type": "schema", "value": MESSAGE }),
    );
    let (mac, a) = (w.mac_a, w.alice);
    let rooms = (0..rooms)
        .map(|i| {
            w.lab
                .create(
                    mac,
                    a,
                    a,
                    "room",
                    &["chat"],
                    document(&format!("Room {i}"), "Hi", mac),
                )
                .unwrap()
        })
        .collect();
    (w, rooms)
}

#[tokio::test]
async fn after_every_save_the_index_is_the_rebuild_with_its_root() {
    let (mut w, rooms) = alices(3);
    let (mac, alice) = (w.mac_a, w.alice);
    let shelf = Memory::new();
    let ix = SharedIndex::open(shelf.shelf()).await.unwrap();
    let mut seed = 0x9e37_79b9_7f4a_7c15u64;
    let mut next = |n: u64| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed % n
    };
    let mut made: Vec<EntryId> = rooms.clone();
    let mut entries = 0;
    for step in 0..40u64 {
        match next(4) {
            0 => made.push(message(
                &mut w,
                rooms[next(rooms.len() as u64) as usize],
                step,
            )),
            1 => {
                let e = made[next(made.len() as u64) as usize];
                let tag = format!("t{}", next(3));
                if next(2) == 0 {
                    w.lab.tag(mac, alice, e, &[&tag], &[]).unwrap();
                } else {
                    w.lab.tag(mac, alice, e, &[], &[&tag]).unwrap();
                }
            }
            2 => {
                let e = made[next(made.len() as u64) as usize];
                w.lab
                    .edit(mac, alice, e, |item| {
                        item.set_text(2, &format!("edit {step}"))
                    })
                    .ok();
            }
            _ => made.push(
                w.lab
                    .create(mac, alice, alice, "note", &[], document("Note", "x", mac))
                    .unwrap(),
            ),
        }
        let lab = Mutex::new(std::mem::replace(&mut w.lab, Lab::new()));
        match save(&ix, &lab, mac).await.unwrap() {
            Stepped::Entries(n) => entries += n,
            Stepped::Not => {}
        }
        assert_eq!(
            ix.rows().await.unwrap(),
            rebuilt(&lab.lock().unwrap(), mac),
            "after step {step}"
        );
        assert_eq!(
            ix.root().await,
            fresh_root(&lab, mac).await,
            "one root for the same rows, step {step}"
        );
        assert_eq!(ix.stamp().await, head(lab.lock().unwrap().log(mac).ids()));
        w.lab = lab.into_inner().unwrap();
    }
    assert!(
        entries > 0 && entries < 40 * made.len() / 4,
        "a save of an entry's edits puts again that entry alone, not every entry each time: {entries}"
    );
}

#[tokio::test]
async fn a_crash_at_any_write_leaves_an_index_the_next_save_brings_to_the_rebuild() {
    for crash_after in 0..12 {
        let (mut w, rooms) = alices(2);
        let (mac, alice) = (w.mac_a, w.alice);
        let memory = Memory::new();
        let ix = SharedIndex::open(memory.shelf()).await.unwrap();
        let lab = Mutex::new(std::mem::replace(&mut w.lab, Lab::new()));
        save(&ix, &lab, mac).await.unwrap();
        w.lab = lab.into_inner().unwrap();
        for n in 0..6 {
            message(&mut w, rooms[n % 2], n as u64);
        }
        w.lab.tag(mac, alice, rooms[0], &["pinned"], &[]).unwrap();
        let lab = Mutex::new(std::mem::replace(&mut w.lab, Lab::new()));
        memory.writes_left.store(crash_after, Ordering::SeqCst);
        let crashed = save(&ix, &lab, mac).await;
        memory.writes_left.store(i64::MAX, Ordering::SeqCst);
        // the node starts again: the index as its newest slot that opens left it, stepped on at its next save
        let ix = SharedIndex::open(memory.shelf()).await.unwrap();
        save(&ix, &lab, mac).await.unwrap();
        let lab = lab.into_inner().unwrap();
        assert_eq!(
            ix.rows().await.unwrap(),
            rebuilt(&lab, mac),
            "a crash after {crash_after} writes: {crashed:?}"
        );
    }
}

#[tokio::test]
async fn a_lost_page_or_a_rewritten_log_builds_the_index_again() {
    let (mut w, rooms) = alices(2);
    let mac = w.mac_a;
    for n in 0..4 {
        message(&mut w, rooms[n % 2], n as u64);
    }
    let memory = Memory::new();
    let lab = Mutex::new(std::mem::replace(&mut w.lab, Lab::new()));
    let ix = SharedIndex::open(memory.shelf()).await.unwrap();
    save(&ix, &lab, mac).await.unwrap();
    // every page lost: the next save finds out and builds it again
    memory
        .objects
        .lock()
        .unwrap()
        .retain(|name, _| !name.starts_with("index/"));
    let ix = SharedIndex::open(memory.shelf()).await.unwrap();
    {
        let mut l = lab.lock().unwrap();
        let alice = w.alice;
        l.tag(mac, alice, rooms[1], &["x"], &[]).unwrap();
    }
    assert!(matches!(
        save(&ix, &lab, mac).await.unwrap(),
        Stepped::Entries(_)
    ));
    assert_eq!(ix.rows().await.unwrap(), rebuilt(&lab.lock().unwrap(), mac));
    // a stamp of another log of the same length: every entry put again
    let other = SharedIndex::open(Memory::new().shelf()).await.unwrap();
    {
        let mut index = other.index.lock().await;
        let ids = lab.lock().unwrap().log(mac).ids().to_vec();
        let wrong = Stamp {
            at: ids.len() as u64,
            head: [1; 32],
        };
        index.apply(vec![], wrong).await.unwrap();
    }
    assert!(matches!(
        save(&other, &lab, mac).await.unwrap(),
        Stepped::Entries(_)
    ));
    assert_eq!(
        other.rows().await.unwrap(),
        rebuilt(&lab.lock().unwrap(), mac)
    );
}

#[tokio::test]
async fn a_view_lists_a_rooms_messages_newest_first_off_the_shelf() {
    let (mut w, rooms) = alices(2);
    let (mac, alice) = (w.mac_a, w.alice);
    let mut said = vec![];
    for n in 0..9 {
        let e = message(&mut w, rooms[n % 2], n as u64);
        if n % 2 == 0 {
            said.push(e);
        }
    }
    let lab = Mutex::new(std::mem::replace(&mut w.lab, Lab::new()));
    let ix = SharedIndex::open(Memory::new().shelf()).await.unwrap();
    save(&ix, &lab, mac).await.unwrap();
    let found = ix
        .find(&lab, mac, alice, &[link_label(rooms[0])], None, 100)
        .await
        .unwrap();
    said.reverse();
    assert_eq!(
        found.iter().map(|(_, e)| *e).collect::<Vec<_>>(),
        said,
        "room 0's messages, the newest first"
    );
    // a page of 2, then on from its last
    let first = ix
        .find(&lab, mac, alice, &[link_label(rooms[0])], None, 2)
        .await
        .unwrap();
    let rest = ix
        .find(
            &lab,
            mac,
            alice,
            &[link_label(rooms[0])],
            first.last().copied(),
            100,
        )
        .await
        .unwrap();
    assert_eq!([first, rest].concat(), found);
    let rooms_found = ix
        .find(&lab, mac, alice, &[type_label("room")], None, 100)
        .await
        .unwrap();
    assert_eq!(
        rooms_found
            .iter()
            .map(|(_, e)| *e)
            .rev()
            .collect::<Vec<_>>(),
        rooms
    );
    assert_eq!(
        ix.find(&lab, mac, alice, &[tag_label("chat")], None, 100)
            .await
            .unwrap(),
        rooms_found
    );
    assert!(
        ix.find(&lab, mac, alice, &[tag_label("none")], None, 100)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn a_log_that_grew_is_checked_from_its_head_and_a_rewritten_one_is_refused() {
    let (mut w, rooms) = alices(2);
    let mac = w.mac_a;
    for n in 0..20 {
        message(&mut w, rooms[n % 2], n as u64);
    }
    let lab = Mutex::new(std::mem::replace(&mut w.lab, Lab::new()));
    let ix = SharedIndex::open(Memory::new().shelf()).await.unwrap();
    save(&ix, &lab, mac).await.unwrap();
    let stamp = ix.stamp().await;
    assert_eq!(stamp, head(lab.lock().unwrap().log(mac).ids()));
    // the log grows: the index is still of its first edits, told from the log's mark before them, hashing fewer ids
    // than a mark's worth (`log_head`'s `a_head_hashes_each_id_once_and_a_prefix_from_its_mark`)
    w.lab = lab.into_inner().unwrap();
    for n in 0..5 {
        message(&mut w, rooms[n % 2], 100 + n as u64);
    }
    assert!(w.lab.log(mac).of_log(stamp.into()));
    // a save of the grown log stamps it with the log's head, which the log kept as the edits came
    let lab = Mutex::new(std::mem::replace(&mut w.lab, Lab::new()));
    let grown = head(lab.lock().unwrap().log(mac).ids());
    assert!(matches!(
        save(&ix, &lab, mac).await.unwrap(),
        Stepped::Entries(_)
    ));
    assert_eq!(ix.stamp().await, grown);
    assert_eq!(Stamp::from(lab.lock().unwrap().log(mac).head()), grown);
    // the same device's log written otherwise, as long or longer: not of it
    let (mut other, other_rooms) = alices(1);
    for n in 0..40 {
        message(&mut other, other_rooms[0], 1000 + n as u64);
    }
    assert_eq!(other.mac_a, mac);
    assert!(
        !other.lab.log(mac).of_log(stamp.into()),
        "a rewritten log is not one the index is of"
    );
    // and the log it is of still is, after the refusal
    assert!(lab.lock().unwrap().log(mac).of_log(grown.into()));
}

/// A device catching up takes keys, shares and vaults' edits between its entries' (`SharedIndex.X5_step`): after every
/// save its index is the rebuild, though the edits it took were of other logs, and a save puts again the entries whose
/// inputs changed, never every entry each time.
#[tokio::test]
async fn a_device_catching_up_on_keys_shares_and_vaults_puts_again_the_entries_they_change() {
    let (mut w, rooms) = alices(3);
    for n in 0..12 {
        message(&mut w, rooms[n % 3], n as u64);
    }
    avendb::cast::todos_on(&mut w);
    let (mac, phone) = (w.mac_a, w.phone_a);
    let ids = w.lab.log(mac).ids().to_vec();
    let blobs: Vec<std::sync::Arc<[u8]>> = w.lab.blob_ids(mac).into_iter().filter_map(|b| w.lab.blob(mac, b)).collect();
    let ix = SharedIndex::open(Memory::new().shelf()).await.unwrap();
    let (mut saves, mut put, mut most) = (0, 0, 0);
    for chunk in ids.chunks(5) {
        let signed = chunk.iter().map(|id| w.lab.signed_edit(mac, *id).expect("an edit it holds")).collect();
        w.lab.receive(phone, signed, blobs.clone());
        let lab = Mutex::new(std::mem::replace(&mut w.lab, Lab::new()));
        if let Stepped::Entries(n) = save(&ix, &lab, phone).await.unwrap() {
            saves += 1;
            put += n;
        }
        let lab = lab.into_inner().unwrap();
        most = most.max(lab.shared_entries(phone).len());
        assert_eq!(ix.rows().await.unwrap(), rebuilt(&lab, phone), "after {} of {} edits", saves, ids.len());
        w.lab = lab;
    }
    assert!(saves > 4, "it saved as it caught up: {saves}");
    assert!(put < saves * most / 2, "and put again the entries whose inputs changed, not each every time: {put} of {saves} x {most}");
}

/// What the head of a log costs to work out once, as a node opens: `AVENDB_HEAD_N` ids (10M if unset).
///
///   cargo test -p avendb-net --features test-fixtures --lib -- --ignored --nocapture bench_head
#[test]
#[ignore]
fn bench_head() {
    let n: usize = std::env::var("AVENDB_HEAD_N").ok().and_then(|n| n.parse().ok()).unwrap_or(10_000_000);
    let ids: Vec<EditId> = (0..n as u64)
        .map(|i| EditId(avendb::hash::Hasher::new("bench").update(&i.to_be_bytes()).clone().finalize()))
        .collect();
    let t = std::time::Instant::now();
    let h = head(&ids);
    println!("BENCH {}", json!({ "bench": "shared_index_head", "ids": n, "ms": t.elapsed().as_secs_f64() * 1e3, "at": h.at }));
}

/// What a save's step holds the Lab for at `AVENDB_INPUTS_N` entries (20k if unset): working out every entry's inputs,
/// against working out every entry's rows, what a step of every entry did under the Lab; and a step after one message.
///
///   cargo test -p avendb-net --features test-fixtures --lib -- --ignored --nocapture bench_inputs
#[tokio::test]
#[ignore]
async fn bench_inputs() {
    let n: usize = std::env::var("AVENDB_INPUTS_N").ok().and_then(|n| n.parse().ok()).unwrap_or(20_000);
    let (mut w, rooms) = alices(1);
    let (mac, alice) = (w.mac_a, w.alice);
    for i in 0..n {
        w.lab.create(mac, alice, alice, "note", &["t"], document(&format!("Note {i}"), "x", mac)).unwrap();
    }
    let ms = |t: std::time::Instant| t.elapsed().as_secs_f64() * 1e3;
    let t = std::time::Instant::now();
    let inputs = w.lab.shared_inputs(mac).len();
    let inputs_ms = ms(t);
    let t = std::time::Instant::now();
    let rows = w.lab.shared_entries(mac).into_iter().filter_map(|e| w.lab.shared_of(mac, e)).count();
    let rows_ms = ms(t);
    message(&mut w, rooms[0], 1);
    let was = w.lab.shared_inputs(mac);
    message(&mut w, rooms[0], 2);
    let t = std::time::Instant::now();
    let changed = shared::differ(&was, &w.lab.shared_inputs(mac)).len();
    let step_ms = ms(t);
    println!("BENCH {}", json!({ "bench": "shared_index_inputs", "entries": inputs, "inputs_ms": inputs_ms, "rows": rows,
        "rows_ms": rows_ms, "after_a_message_ms": step_ms, "changed": changed }));
}
