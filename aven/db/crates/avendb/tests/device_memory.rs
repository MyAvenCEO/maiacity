//! What a device's Lab holds in memory through a full catch-up (batch 5, F9/F10): Alice's iPhone takes every edit her
//! writers made, a page at a time, and catches up a step at a time, as `scale_turns.rs`'s fixture does it. Measured by
//! the bytes the allocator holds (`peer_memory.rs` counts the same way): what the iPhone holds after, per edit, the most
//! it held on the way, and what its own count (`perf.held.memory`) names of it. A `DEVICE_MEMORY {...}` line per run.
//!
//!   DEVICE_MEMORY_EDITS=100000 cargo test --release -p avendb --test device_memory -- --ignored --nocapture
#![cfg(not(debug_assertions))]

use std::alloc::{GlobalAlloc, Layout, System};
use std::collections::HashSet;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::time::Instant;

use avendb::cast::{document, paragraph};
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::lab::{CatchUp, Lab};
use avendb::policy::{Action, Kind, Principal, Sharing};
use avendb::sign::Signed;
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

/// Alice's vault, her iPhone, and `writers` devices of hers that each wrote `edits / writers` edits over 50 entries of
/// her vault, without syncing each other (`scale_turns.rs`'s fixture).
fn fixture(writers: usize, edits: usize) -> (Lab, SignerId, Vec<SignerId>) {
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
    }
    (lab, phone, ws)
}

/// What device `to` lacks of what `from` holds, in the order `from` took it.
fn lacking(lab: &Lab, from: SignerId, to: SignerId) -> Vec<Signed> {
    let held: HashSet<_> = lab.log(to).ids().iter().copied().collect();
    lab.backup(from).signed().iter().filter(|s| !held.contains(&s.edit.id())).cloned().collect()
}

#[test]
#[ignore]
fn measure_device_memory() {
    let (writers, edits) = (env("DEVICE_MEMORY_WRITERS", 32), env("DEVICE_MEMORY_EDITS", 20_000));
    let began = Instant::now();
    let (mut lab, phone, ws) = fixture(writers, edits);
    eprintln!("DEVICE fixture: {edits} edits written in {:.1?}", began.elapsed());
    // the pages it takes, a writer's at a time, as a node holds a page at a time and not its writers' stores
    let h0 = held();
    PEAK.store(h0, Ordering::Relaxed);
    let began = Instant::now();
    for (k, w) in ws.iter().enumerate() {
        for page in lacking(&lab, *w, phone).chunks(600) {
            let prepared = lab.prepare_receive(phone, page.to_vec()).check();
            lab.receive_prepared(phone, prepared, false);
        }
        if k % 4 == 3 {
            while !matches!(lab.catch_up_step(phone, 48), CatchUp::Caught(_)) {}
        }
    }
    while !matches!(lab.catch_up_step(phone, 48), CatchUp::Caught(_)) {}
    let took = began.elapsed();
    // what is left of the pages it took is what it holds of them now: the pages themselves are gone
    let after = held() - h0;
    let peak = PEAK.load(Ordering::Relaxed) - h0;
    let n = lab.log(phone).edits().len() as isize;
    let perf = lab.perf(phone);
    println!("DEVICE_MEMORY {}", json!({
        "edits": n,
        "writers": writers,
        "caught_up_s": took.as_secs_f64(),
        "held_per_edit": after / n,
        "peak_per_edit": peak / n,
        "held_mb": after / 1_000_000,
        "peak_mb": peak / 1_000_000,
        "counted": perf["held"]["memory"],
    }));
}
