//! What a device's log holds in memory when most of its edits are key upkeep, as the Mac's are (batch 5: of its 151k
//! edits, 74k wraps, 47k key boxes and 22k marks): each entry Alice makes she gives Bob, then Carol, by a share of its
//! own, which moves it to a new audience each time, with its keys boxed again and its earlier stays' keys wrapped. In
//! memory and spilled (`Spill`), as a Mac's device spills past its budget. An `UPKEEP_MEMORY {...}` line per run.
//!
//!   UPKEEP_MEMORY_ENTRIES=2000 cargo test --release -p avendb --test upkeep_memory -- --ignored --nocapture
#![cfg(not(debug_assertions))]

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicIsize, Ordering};

use avendb::cast::{by_id, document, share, vault};
use avendb::id::{SignerId, VaultId};
use avendb::lab::{Lab, Probed, Spill};
use avendb::policy::{Action, Kind, Level, Principal, Sharing};
use serde_json::json;

struct Counting;
static HELD: AtomicIsize = AtomicIsize::new(0);

// SAFETY: forwards to the system allocator, counting the bytes it holds
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        HELD.fetch_add(l.size() as isize, Ordering::Relaxed);
        unsafe { System.alloc(l) }
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        HELD.fetch_sub(l.size() as isize, Ordering::Relaxed);
        unsafe { System.dealloc(p, l) }
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        HELD.fetch_add(n as isize - l.size() as isize, Ordering::Relaxed);
        unsafe { System.realloc(p, l, n) }
    }
}

#[global_allocator]
static A: Counting = Counting;

fn held() -> isize {
    HELD.load(Ordering::Relaxed)
}

/// A person's vault on the Lab, its passkey the root, with one device: the device.
fn person(lab: &mut Lab, name: &str) -> (VaultId, SignerId) {
    let passkey = lab.passkey(name);
    let mac = lab.device_of(passkey, &format!("{name}'s Mac"));
    let genesis = Action::Genesis {
        kind: Kind::Human,
        owners: vec![Principal::Signer(passkey)],
        threshold: 1,
        root: Some(passkey),
        nonce: 0,
        seal_to: vec![],
    };
    let v = VaultId::from(lab.submit(mac, &[passkey], genesis).expect("a vault"));
    let add = Action::Share(Sharing::Device { vault: v, device: mac, seal_to: None });
    lab.submit(mac, &[passkey, mac], add).expect("its device added");
    (v, mac)
}

/// What letting go of part `part` of a device's store frees, in bytes.
fn weigh(store: &mut Probed, part: &str) -> isize {
    let before = held();
    drop(store.part(part));
    before - held()
}

#[test]
#[ignore]
fn measure_upkeep_memory() {
    let n: usize = std::env::var("UPKEEP_MEMORY_ENTRIES").ok().and_then(|n| n.parse().ok()).unwrap_or(1000);
    for spilled in [false, true] {
        let mut lab = Lab::new();
        let (alice, mac) = person(&mut lab, "Alice");
        let (bob, bobs) = person(&mut lab, "Bob");
        let (carol, carols) = person(&mut lab, "Carol");
        // Alice's Mac knows Bob's and Carol's vaults, the keys it seals their shares to
        lab.share_contact(bobs, mac, bob);
        lab.share_contact(carols, mac, carol);
        let dir = std::env::temp_dir().join(format!("avendb-upkeep-{}-{spilled}", std::process::id()));
        if spilled {
            lab.spill(mac, &Spill::new(&dir, 64 << 20).expect("a spill")).expect("spilled");
        }
        for i in 0..n {
            let e = lab.create(mac, alice, alice, "doc", &[], document(&format!("Doc {i}"), "x", mac)).expect("a doc");
            for to in [bob, carol] {
                lab.issue(mac, &[mac], share(alice, vault(to), Level::Read, by_id(e))).expect("a share");
            }
        }
        // the bulk bytes its log's edits carry, and those of them it holds in memory: before `Bulk`, all of them
        let (mut bulk, mut in_memory) = (0, 0);
        for e in lab.log(mac).edits() {
            let public = match &e.action {
                avendb::policy::Action::Keys { public: Some(p), .. } => Some(&p.xwing),
                _ => None,
            };
            let boxes = e.action.key_boxes().into_iter().map(|(.., b)| &b.bytes);
            for b in e.action.body().into_iter().chain(boxes).chain(public) {
                bulk += b.len();
                in_memory += b.heap_bytes();
            }
        }
        let perf = lab.perf(mac);
        let edits = perf["held"]["edits"].as_u64().unwrap_or(1) as isize;
        let mut store = lab.probe_store(mac).expect("its store");
        let parts: serde_json::Map<String, serde_json::Value> =
            ["log.edits", "log.entry_order", "log.logs", "log.held", "log.ids", "log.write_at", "log", "replay.order",
                "replay.ids", "replay.stood", "replay.acts", "replay.tail", "replay.state.vaults", "replay.state.shares",
                "replay.state.entries", "replay.state.writes", "replay.state.audiences", "replay.state.epochs", "replay.state.seals", "replay.state.published", "replay.state.seal_keys", "latest", "replay"]
                .into_iter()
                .map(|p| (p.to_string(), json!(weigh(&mut store, p) / edits)))
                .collect();
        println!("UPKEEP_MEMORY {}", json!({ "spilled": spilled, "entries": n, "edits": edits,
            "actions": perf["held"]["actions"],
            "bulk_per_edit": bulk as isize / edits, "bulk_in_memory_per_edit": in_memory as isize / edits, "per_edit": parts, "counted": perf["held"]["memory"] }));
        std::fs::remove_dir_all(&dir).ok();
    }
}
