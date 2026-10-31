//! The Lean model runs (README, rule 10): random status traces through the Rust machine and through `aven-db-model`
//! (`db/spec/Main.lean`), compared state by state. The test builds the model with `lake build` first, so it needs the
//! box: `bun run box cargo test -p aven-gen1`.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use aven_gen1::status::{Event, Status};
use serde_json::{Value, json};

const TRACES: usize = 1000;

/// A small deterministic generator, so a failing trace is named by its seed and replays.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

struct Trace {
    limit: u32,
    events: Vec<Event>,
}

fn trace(seed: u64) -> Trace {
    let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
    let limit = 1 + rng.below(6) as u32;
    let len = rng.below(80) as usize;
    // ticks are the common case, as in a running peer
    let events = (0..len)
        .map(|_| match rng.below(10) {
            0 => Event::Dial,
            1 => Event::Lost,
            2..=4 => Event::Frame,
            _ => Event::Tick,
        })
        .collect();
    Trace { limit, events }
}

fn rust(t: &Trace) -> Value {
    let mut status = Status::start();
    let statuses: Vec<Value> = t
        .events
        .iter()
        .map(|&e| {
            status = status.step(t.limit, e);
            json!({ "phase": status.phase.name(), "moved": status.moved, "idle": status.idle })
        })
        .collect();
    json!({ "status": statuses })
}

fn input(t: &Trace) -> String {
    let events: Vec<&str> = t.events.iter().map(|e| e.name()).collect();
    json!({ "limit": t.limit, "status": events }).to_string()
}

fn model() -> std::path::PathBuf {
    let spec = Path::new(env!("CARGO_MANIFEST_DIR")).join("../db/spec");
    let built = Command::new("lake")
        .arg("build")
        .current_dir(&spec)
        .status()
        .expect("lake runs in the box: bun run box cargo test -p aven-gen1");
    assert!(built.success(), "lake build failed in db/spec");
    spec.join(".lake/build/bin/aven-db-model")
}

#[test]
fn rust_follows_the_model_on_random_traces() {
    let traces: Vec<Trace> = (1..=TRACES as u64).map(trace).collect();
    let mut child = Command::new(model())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let lines: String = traces.iter().map(|t| input(t) + "\n").collect();
    let writer = std::thread::spawn(move || stdin.write_all(lines.as_bytes()).unwrap());
    let out = child.wait_with_output().unwrap();
    writer.join().unwrap();
    assert!(out.status.success(), "aven-db-model failed");
    let replies: Vec<&str> = std::str::from_utf8(&out.stdout).unwrap().lines().collect();
    assert_eq!(replies.len(), TRACES);
    for (i, (t, reply)) in traces.iter().zip(replies).enumerate() {
        let mut lean: Value = serde_json::from_str(reply).unwrap();
        // the store is aven-db-store's to compare
        lean.as_object_mut().unwrap().remove("store");
        assert_eq!(
            rust(t),
            lean,
            "trace {} (seed {}) differs: {}",
            i,
            i + 1,
            input(t)
        );
    }
}
