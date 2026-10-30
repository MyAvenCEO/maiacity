//! The Lean model runs (README, rule 10): random traces through the Rust machines and through `aven-db-model`
//! (`db/spec/Main.lean`), compared state by state. The test builds the model with `lake build` first, so it needs the
//! box: `bun run box cargo test -p aven-db-core`.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use aven_db_core::presence::Presence;
use aven_db_core::status::{Event, Status};
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
    changes: Vec<(bool, u32)>,
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
    let changes = (0..rng.below(60))
        .map(|_| (rng.below(3) != 0, rng.below(6) as u32))
        .collect();
    Trace {
        limit,
        events,
        changes,
    }
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
    let mut presence = Presence::default();
    let presences: Vec<Value> = t
        .changes
        .iter()
        .map(|&(join, p)| {
            if join {
                presence.join(p)
            } else {
                presence.leave(&p)
            }
            json!(presence.present().copied().collect::<Vec<_>>())
        })
        .collect();
    json!({ "status": statuses, "presence": presences })
}

fn input(t: &Trace) -> String {
    let events: Vec<&str> = t.events.iter().map(|e| e.name()).collect();
    let changes: Vec<Value> = t
        .changes
        .iter()
        .map(|&(join, p)| json!([if join { "join" } else { "leave" }, p]))
        .collect();
    json!({ "limit": t.limit, "status": events, "presence": changes }).to_string()
}

/// The model lists presence in its own order; the count and the members are what must agree.
fn sorted(mut v: Value) -> Value {
    for p in v["presence"].as_array_mut().unwrap() {
        let mut ids: Vec<u64> = p
            .as_array()
            .unwrap()
            .iter()
            .map(|id| id.as_u64().unwrap())
            .collect();
        ids.sort();
        *p = json!(ids);
    }
    v
}

fn model() -> std::path::PathBuf {
    let spec = Path::new(env!("CARGO_MANIFEST_DIR")).join("../spec");
    let built = Command::new("lake")
        .arg("build")
        .current_dir(&spec)
        .status()
        .expect("lake runs in the box: bun run box cargo test -p aven-db-core");
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
        let lean = sorted(serde_json::from_str(reply).unwrap());
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
