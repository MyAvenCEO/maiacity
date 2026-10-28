//! What a test program's allocator holds, for the tests that measure the process's memory (`tests/memory/` of
//! `avendb` and `avendb-net`): `Counting` is that program's one `#[global_allocator]`, and each of its tests takes the
//! process for itself first (`alone`), as another test's allocations or keys in the same process would count with its
//! own.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{Mutex, MutexGuard};

/// The system's allocator, counting the bytes it holds (`HELD`) and the most it held (`PEAK`).
pub struct Counting;
/// The bytes the allocator holds.
pub static HELD: AtomicIsize = AtomicIsize::new(0);
/// The most it held since `PEAK` was last set to what it held.
pub static PEAK: AtomicIsize = AtomicIsize::new(0);

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

/// The bytes the allocator holds now.
pub fn held() -> isize {
    HELD.load(Ordering::Relaxed)
}

/// The process for the calling test alone, while the guard lives: `cargo test` runs a program's tests side by side, so
/// each test that counts what the process holds takes it first, and they run one at a time. A test that failed holding
/// it leaves it to the next.
pub fn alone() -> MutexGuard<'static, ()> {
    static ALONE: Mutex<()> = Mutex::new(());
    ALONE.lock().unwrap_or_else(|failed| failed.into_inner())
}
