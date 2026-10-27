//! The shared index held to `SharedIndex.lean`: after every save it holds the rows a rebuild from what the device's
//! edits say holds, with the same root; a crash at any write of a save leaves an index the next save brings there;
//! and a view lists an audience's entries of a link, the newest first.

use std::sync::atomic::Ordering;

use super::*;
use crate::shelf_index::tests::Memory;
use avendb::cast::{World, document, world};
use avendb::index::{link_label, tag_label, type_label};
use serde_json::json;

thread_local! {
    /// How many edits `head_on` hashed on this thread.
    pub(super) static HASHED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

fn hashed() -> usize {
    HASHED.with(std::cell::Cell::get)
}

/// The rows a rebuild from device `me`'s edits holds, in key order (`SharedIndex.full`).
fn rebuilt(lab: &Lab, me: SignerId) -> Vec<(Vec<u8>, Vec<u8>)> {
    let mut rows: Vec<(Vec<u8>, Vec<u8>)> = lab
        .shared_entries(me)
        .into_iter()
        .filter_map(|e| lab.shared_of(me, e))
        .flat_map(|o| o.rows())
        .collect();
    rows.push((
        MARK.to_vec(),
        (lab.index_mark(me) as u64).to_be_bytes().to_vec(),
    ));
    rows.sort();
    rows
}

/// A fresh index of what `me` holds, on a shelf of its own: its root.
async fn fresh_root(lab: &Mutex<Lab>, me: SignerId) -> Option<Sum> {
    let ix = SharedIndex::open(Memory::new().shelf()).await.unwrap();
    let held = lab.lock().unwrap().log(me).ids().len();
    assert!(
        matches!(ix.step(lab, me, held).await.unwrap(), Stepped::Every(_)),
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
    let (mut entries, mut every) = (0, 0);
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
            Stepped::Every(n) => every += n,
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
        entries > 0,
        "a save of an entry's edits puts again that entry alone"
    );
    assert!(
        every < 40 * made.len(),
        "and not every entry each time: {every}"
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
        Stepped::Every(_)
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
        index
            .apply(vec![(MARK.to_vec(), Some(vec![0; 8]))], wrong)
            .await
            .unwrap();
    }
    assert!(matches!(
        save(&other, &lab, mac).await.unwrap(),
        Stepped::Every(_)
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
async fn a_log_that_grew_is_checked_at_once_and_a_rewritten_one_is_refused() {
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
    // the log grows: the index is still of its first edits, told without hashing one
    w.lab = lab.into_inner().unwrap();
    for n in 0..5 {
        message(&mut w, rooms[n % 2], 100 + n as u64);
    }
    let before = hashed();
    assert_eq!(ix.of_log(&w.lab, mac), Some(stamp));
    assert_eq!(
        hashed(),
        before,
        "a log that grew is checked without hashing its edits"
    );
    // a save of the grown log hashes the new edits alone
    let lab = Mutex::new(std::mem::replace(&mut w.lab, Lab::new()));
    let (held, grown) = {
        let l = lab.lock().unwrap();
        (l.log(mac).ids().len(), head(l.log(mac).ids()))
    };
    let before = hashed();
    assert!(matches!(
        save(&ix, &lab, mac).await.unwrap(),
        Stepped::Entries(_)
    ));
    assert_eq!(
        hashed(),
        before + held - stamp.at as usize,
        "the save chains on from the head it had"
    );
    assert_eq!(ix.stamp().await, grown);
    // the same device's log written otherwise, as long or longer: not of it
    let (mut other, other_rooms) = alices(1);
    for n in 0..40 {
        message(&mut other, other_rooms[0], 1000 + n as u64);
    }
    assert_eq!(other.mac_a, mac);
    assert_eq!(
        ix.of_log(&other.lab, mac),
        None,
        "a rewritten log is not one the index is of"
    );
    let before = hashed();
    assert_eq!(ix.of_log(&other.lab, mac), None);
    assert_eq!(hashed(), before, "and asked again, it is refused at once");
    // and the log it is of still is, after the refusal
    assert_eq!(ix.of_log(&lab.lock().unwrap(), mac), Some(grown));
}
