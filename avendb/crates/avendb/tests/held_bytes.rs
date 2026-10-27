//! What a device holds in memory as its log grows (S7, bounded RAM): measured by the bytes its allocator holds.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicIsize, Ordering};

use avendb::cast::{todos_on, world};
use avendb::lab::Spill;
use avendb::wire::Wire as _;

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

#[test]
#[ignore]
fn measure() {
    let n: usize = std::env::var("N").ok().and_then(|v| v.parse().ok()).unwrap_or(500);
    let mut w = world();
    let spilled = std::env::var("SPILL").is_ok();
    let dir = std::env::temp_dir().join(format!("avendb-measure-{}", std::process::id()));
    if spilled {
        w.lab.spill(w.mac_a, &Spill::new(&dir, 1 << 20).expect("a spill")).expect("spilled");
    }
    let todos = todos_on(&mut w);
    let d = w.mac_a;
    let before = HELD.load(Ordering::Relaxed);
    for i in 0..n {
        w.lab.edit(d, w.alice, todos.door, |item| item.set_text(1, &format!("write {i}"))).unwrap();
    }
    let after = HELD.load(Ordering::Relaxed);
    let b = w.lab.backup(d);
    let wire: usize = b.signed().iter().map(|s| s.to_wire().len()).sum();
    let sigs: usize = b.signed().iter().map(|s| s.sigs.iter().map(|g| g.to_wire().len()).sum::<usize>()).sum();
    drop(b);
    eprintln!(
        "MEASURE spilled={spilled} n={n} held_growth={} per_edit={} wire_per_edit={} sig_wire_per_edit={} edits={}",
        after - before,
        (after - before) / n as isize,
        wire / w.lab.size(d).0,
        sigs / w.lab.size(d).0,
        w.lab.size(d).0
    );
    eprintln!("MEASURE memory {}", w.lab.perf(d)["held"]["memory"]);
    std::fs::remove_dir_all(dir).ok();
}

/// A device whose edits and keys are spilled (`Spill`, the server's) holds, says and sends exactly what one holding them
/// in memory does, as both write the same; and holds in memory an index of its edits alone, however many: its edits'
/// memory grows by a few dozen bytes an edit where the other's grows by kilobytes.
#[test]
fn a_spilled_device_holds_the_same_in_a_fraction_of_the_memory() {
    let dir = std::env::temp_dir().join(format!("avendb-held-bytes-{}", std::process::id()));
    let (mut plain, mut spilled) = (world(), world());
    let spill = Spill::new(&dir, 0).expect("a spill");
    spilled.lab.spill(spilled.mac_a, &spill).expect("spilled");
    let memory = |w: &avendb::cast::World| -> (u64, u64) {
        let held = &w.lab.perf(w.mac_a)["held"]["memory"];
        (held["edits"].as_u64().expect("edits"), held["keys"].as_u64().expect("keys"))
    };
    let mut at = vec![];
    for w in [&mut plain, &mut spilled] {
        let todos = todos_on(w);
        let (d, alice) = (w.mac_a, w.alice);
        let before = memory(w);
        for i in 0..60 {
            w.lab.edit(d, alice, todos.door, |item| item.set_text(1, &format!("write {i}"))).expect("a write");
        }
        at.push((before, memory(w), w.lab.size(d).0));
    }
    let wire = |w: &avendb::cast::World| -> Vec<Vec<u8>> {
        w.lab.backup(w.mac_a).signed().iter().map(|s| s.to_wire()).collect()
    };
    assert_eq!(wire(&plain), wire(&spilled), "the same edits, signed the same");
    assert!(plain.lab.state(plain.mac_a) == spilled.lab.state(spilled.mac_a), "the same state");
    assert_eq!(plain.lab.blob_ids(plain.mac_a), spilled.lab.blob_ids(spilled.mac_a), "the same keys");
    for k in plain.lab.blob_ids(plain.mac_a) {
        assert_eq!(plain.lab.blob(plain.mac_a, k), spilled.lab.blob(spilled.mac_a, k), "each read back whole");
    }
    let (((_, p0), (pe, pk), n), ((_, s0), (se, sk), _)) = (at[0], at[1]);
    let per_edit = |m: u64| m / n as u64;
    assert!(per_edit(se) < 200, "spilled, a few dozen bytes an edit: {} ({se} for {n})", per_edit(se));
    assert!(per_edit(pe) > 2000, "in memory, kilobytes an edit: {}", per_edit(pe));
    assert!(sk < 4096 && pk > 1 << 20, "keys: {sk} spilled, {pk} in memory (a megabyte each)");
    let _ = (p0, s0);
    std::fs::remove_dir_all(dir).ok();
}
