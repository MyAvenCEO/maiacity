//! What a device holds in memory as its node starts again from its shelf (batch 5, F9 and G7): Alice's iPhone holds
//! every edit her writers made, its node keeps them on a shelf in a folder, as on the Mac, and starts again from it with
//! its edits spilled (`Lab::spill`, as `avendb-device` spills past 256 MiB). Measured by the bytes the allocator holds,
//! as `avendb/tests/device_memory.rs` measures them: the most the start held on the way, what it holds after, and how
//! long it took. An `UNLOCK_MEMORY {...}` line per run.
//!
//!   UNLOCK_MEMORY_EDITS=50000 cargo test --release -p avendb-net --test unlock_memory -- --ignored --nocapture
#![cfg(not(debug_assertions))]

mod common;

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicIsize, Ordering};
use std::time::Instant;

use avendb::cast::{document, paragraph};
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::lab::{Lab, Spill};
use avendb::policy::{Action, Kind, Principal, Sharing};
use avendb_net::{Node, Options, disk};
use avendb_testkit::until;
use common::Folder;
use serde_json::json;

struct Counting;
static HELD: AtomicIsize = AtomicIsize::new(0);
/// The most it held since `PEAK` was last set to what it held.
static PEAK: AtomicIsize = AtomicIsize::new(0);

// SAFETY: forwards to the system allocator, counting the bytes it holds
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let now = HELD.fetch_add(l.size() as isize, Ordering::Relaxed) + l.size() as isize;
        PEAK.fetch_max(now, Ordering::Relaxed);
        unsafe { System.alloc(l) }
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        HELD.fetch_sub(l.size() as isize, Ordering::Relaxed);
        unsafe { System.dealloc(p, l) }
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        let now = HELD.fetch_add(n as isize - l.size() as isize, Ordering::Relaxed) + n as isize - l.size() as isize;
        PEAK.fetch_max(now, Ordering::Relaxed);
        unsafe { System.realloc(p, l, n) }
    }
}

#[global_allocator]
static A: Counting = Counting;

fn held() -> isize {
    HELD.load(Ordering::Relaxed)
}

fn env(name: &str, default: usize) -> usize {
    std::env::var(name).ok().and_then(|n| n.parse().ok()).unwrap_or(default)
}

/// Alice's vault, her Mac, her iPhone and `writers` devices of hers, made the same way each time: the same keys.
fn base(writers: usize) -> (Lab, SignerId, SignerId, VaultId, Vec<SignerId>) {
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let phone = lab.device_of(passkey, "Alice's iPhone");
    let ws: Vec<SignerId> = (0..writers).map(|i| lab.device_of(passkey, &format!("Alice's writer {i}"))).collect();
    let genesis = Action::Genesis {
        kind: Kind::Human,
        owners: vec![Principal::Signer(passkey)],
        threshold: 1,
        root: Some(passkey),
        nonce: 0,
        seal_to: vec![],
    };
    let alice = VaultId::from(lab.submit(mac, &[passkey], genesis).expect("a vault"));
    for &d in [mac, phone].iter().chain(&ws) {
        let add = Action::Share(Sharing::Device { vault: alice, device: d, seal_to: None });
        lab.submit(mac, &[passkey, d], add).expect("a device added");
    }
    for &d in [phone].iter().chain(&ws) {
        lab.sync(mac, d);
    }
    (lab, passkey, phone, alice, ws)
}

/// `base`, each writer having written `edits / writers` edits over 50 entries of Alice's vault, all of which the
/// iPhone took.
fn written(writers: usize, edits: usize) -> (Lab, SignerId, SignerId, VaultId) {
    let (mut lab, passkey, phone, alice, ws) = base(writers);
    let per = edits / writers.max(1);
    for (i, &w) in ws.iter().enumerate() {
        let entries: Vec<EntryId> = (0..50)
            .map(|e| {
                let doc = document(&format!("Doc {i}.{e}"), "Written by one of Alice's devices.", w);
                lab.create(w, alice, alice, "doc", &[], doc).expect("a document")
            })
            .collect();
        for k in 0..per.saturating_sub(entries.len()) {
            let entry = entries[k % entries.len()];
            let text = format!("Edit {k} of writer {i}.");
            lab.edit(w, alice, entry, |item| item.push_block(paragraph(100 + k as u64, &text))).expect("an edit");
        }
        lab.sync(w, phone);
    }
    (lab, passkey, phone, alice)
}

#[test]
#[ignore]
fn measure_unlock_memory() {
    let (writers, edits) = (env("UNLOCK_MEMORY_WRITERS", 32), env("UNLOCK_MEMORY_EDITS", 20_000));
    let dir = Folder::new("unlock-memory");
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(4).enable_all().build().expect("a runtime");
    // its shelf, as the iPhone's node keeps it
    let began = Instant::now();
    let held_edits = rt.block_on(async {
        let (mut lab, passkey, phone, alice) = written(writers, edits);
        let lab = lab.split(phone, &[passkey], [1; 32]);
        let opts = Options { shelf: Some(disk::open(dir.path()).expect("the shelf")), ..Options::local() };
        let node = Node::spawn(lab, phone, opts).await.expect("a node");
        until("the shelf holds it", || async { !node.behind().await }).await;
        // saves enough for a head (one after every 64 journal entries), so that it starts again from a head's packs,
        // as a device that ran a while does
        for n in 0..70 {
            let doc = move |lab: &mut Lab, me: SignerId| {
                lab.create(me, alice, alice, "doc", &[], document(&format!("Note {n}"), "From the iPhone.", me))
            };
            node.act(doc).await.expect("a note");
            until("the shelf holds it", || async { !node.behind().await }).await;
        }
        // and what it worked out, so that it starts again as a device does, from its stored view and checked keys
        until("what it worked out, put", || async { !node.read(|lab, me| lab.warm_due(me)).await }).await;
        let n = node.read(|lab, me| lab.log(me).edits().len()).await;
        node.shutdown().await.expect("it stops");
        let heads = std::fs::read_dir(dir.path()).expect("the folder").filter_map(Result::ok)
            .map(|g| g.path().join("heads")).filter(|h| h.exists()).map(|h| std::fs::read_dir(h).expect("heads").count()).sum::<usize>();
        assert!(heads > 0, "a head of packs on its shelf");
        n
    });
    eprintln!("UNLOCK fixture: {held_edits} edits on its shelf in {:.1?}", began.elapsed());
    // the same iPhone starting again, holding nothing yet but its vault, its edits spilled past 256 MiB
    let (mut lab, passkey, phone, _, _) = base(writers);
    let mut lab = lab.split(phone, &[passkey], [2; 32]);
    let spill = Spill::new(dir.path().join("spill"), 256 << 20).expect("its spill");
    lab.spill(phone, &spill).expect("spilled");
    let h0 = held();
    PEAK.store(h0, Ordering::Relaxed);
    let began = Instant::now();
    let (node, after, perf, unlocked, read_back) = rt.block_on(async {
        let opts = Options { shelf: Some(disk::open(dir.path()).expect("the shelf")), ..Options::local() };
        let node = Node::spawn(lab, phone, opts).await.expect("a node");
        let took = began.elapsed();
        let unlocked = (PEAK.load(Ordering::Relaxed) - h0, held() - h0);
        PEAK.store(held(), Ordering::Relaxed);
        let (n, perf) = node.read(|lab, me| (lab.log(me).edits().len(), lab.perf(me))).await;
        assert_eq!(n, held_edits, "it took back every edit");
        // every edit reads back whole from where its spill holds it, its shelf's packs among them
        let back = node.read(|lab, me| lab.backup(me).signed().len()).await;
        assert_eq!(back, held_edits, "every edit reads back");
        let read_back = PEAK.load(Ordering::Relaxed) - h0;
        PEAK.store(PEAK.load(Ordering::Relaxed).max(unlocked.0 + h0), Ordering::Relaxed);
        (node, took, perf, unlocked, read_back)
    });
    let (peak, now) = (PEAK.load(Ordering::Relaxed) - h0, held() - h0);
    // what each part of its store holds: what letting go of it frees, the store of no use after
    let parts = rt.block_on(node.act(|lab: &mut Lab, me: SignerId| {
        let mut freed = serde_json::Map::new();
        for part in ["signed", "blobs", "log", "replay", "latest", "key_index", "keys", "bases", "bodies", "readings",
            "shown", "answers", "files_at", "slices", "opened_keys", "derived", "covers", "showing"]
        {
            let before = held();
            drop(lab.probe_part(me, part));
            freed.insert(part.into(), json!((before - held()) / 1_000_000));
        }
        serde_json::Value::Object(freed)
    }));
    let n = held_edits as isize;
    println!("UNLOCK_MEMORY {}", json!({
        "edits": n,
        "unlock_s": after.as_secs_f64(),
        "peak_mb": peak / 1_000_000,
        "unlock_peak_mb": unlocked.0 / 1_000_000,
        "unlock_held_mb": unlocked.1 / 1_000_000,
        "read_back_peak_mb": read_back / 1_000_000,
        "held_mb": now / 1_000_000,
        "peak_per_edit": peak / n,
        "held_per_edit": now / n,
        "counted": perf["held"]["memory"],
        "parts_mb": parts,
        "counts": perf["counts"],
        "timers": perf["timers"],
    }));
    drop(node);
}
