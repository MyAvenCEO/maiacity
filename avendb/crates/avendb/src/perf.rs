//! What a device's work costs, measured as it works (Step 0 of the performance plan, 2026-10-20): for each kind of
//! work, how often it ran, its time in all and its longest. Kept in memory on the device alone, never written to a
//! vault or sent to a peer; the engine's `perf` op reads it, and theOS shows it.

use serde_json::{json, Value};
use std::collections::BTreeMap;
use web_time::Instant;

/// One kind of work: how often it ran, and its time in all and at most, in microseconds.
#[derive(Clone, Copy, Debug, Default)]
struct Timer {
    count: u64,
    total_us: u64,
    max_us: u64,
}

/// A device's timers, by the work they time, and its counts, by what they count.
#[derive(Clone, Debug, Default)]
pub struct Perf {
    timers: BTreeMap<&'static str, Timer>,
    counts: BTreeMap<&'static str, u64>,
}

/// A started piece of work (`Perf::start`), which `Perf::add` stops.
#[derive(Clone, Copy, Debug)]
pub struct Started(Instant);

impl Perf {
    pub fn start() -> Started {
        Started(Instant::now())
    }

    /// The work `what`, started at `at`, ended now.
    pub fn add(&mut self, what: &'static str, at: Started) {
        let us = at.0.elapsed().as_micros() as u64;
        let t = self.timers.entry(what).or_default();
        t.count += 1;
        t.total_us += us;
        t.max_us = t.max_us.max(us);
    }

    /// Accumulate completed work measured outside the device's mutable state.
    pub(crate) fn merge(&mut self, other: Self) {
        for (name, timer) in other.timers {
            let current = self.timers.entry(name).or_default();
            current.count += timer.count;
            current.total_us += timer.total_us;
            current.max_us = current.max_us.max(timer.max_us);
        }
        for (name, count) in other.counts { self.count(name, count); }
    }

    /// `n` more of `what`.
    pub fn count(&mut self, what: &'static str, n: u64) {
        *self.counts.entry(what).or_default() += n;
    }

    /// The timers as `{work: {count, total_ms, mean_ms, max_ms}}` and the counts as `{what: n}`.
    pub fn to_json(&self) -> Value {
        let ms = |us: u64| us as f64 / 1000.0;
        let timers: serde_json::Map<String, Value> = self
            .timers
            .iter()
            .map(|(k, t)| {
                let mean = if t.count == 0 { 0.0 } else { ms(t.total_us) / t.count as f64 };
                (k.to_string(), json!({"count": t.count, "total_ms": ms(t.total_us), "mean_ms": mean, "max_ms": ms(t.max_us)}))
            })
            .collect();
        let counts: serde_json::Map<String, Value> = self.counts.iter().map(|(k, n)| (k.to_string(), json!(n))).collect();
        json!({"timers": timers, "counts": counts})
    }
}
