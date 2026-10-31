//! The Lean model runs (README, rule 10): random presence traces through the Rust machine and through
//! `aven-peer-model` (`peer/spec/Main.lean`), compared state by state. The test builds the model with `lake build`
//! first, so it needs the box: `bun run box cargo test -p aven-peer-wire`.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use aven_peer_wire::presence::Presence;
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

fn trace(seed: u64) -> Vec<(bool, u32)> {
    let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
    (0..rng.below(60))
        .map(|_| (rng.below(3) != 0, rng.below(6) as u32))
        .collect()
}

fn rust(changes: &[(bool, u32)]) -> Value {
    let mut presence = Presence::default();
    let presences: Vec<Value> = changes
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
    json!({ "presence": presences })
}

fn input(changes: &[(bool, u32)]) -> String {
    let changes: Vec<Value> = changes
        .iter()
        .map(|&(join, p)| json!([if join { "join" } else { "leave" }, p]))
        .collect();
    json!({ "presence": changes }).to_string()
}

fn model() -> std::path::PathBuf {
    let spec = Path::new(env!("CARGO_MANIFEST_DIR")).join("../spec");
    let built = Command::new("lake")
        .arg("build")
        .current_dir(&spec)
        .status()
        .expect("lake runs in the box: bun run box cargo test -p aven-peer-wire");
    assert!(built.success(), "lake build failed in peer/spec");
    spec.join(".lake/build/bin/aven-peer-model")
}

#[test]
fn rust_follows_the_model_on_random_traces() {
    let traces: Vec<Vec<(bool, u32)>> = (1..=TRACES as u64).map(trace).collect();
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
    assert!(out.status.success(), "aven-peer-model failed");
    let replies: Vec<&str> = std::str::from_utf8(&out.stdout).unwrap().lines().collect();
    assert_eq!(replies.len(), TRACES);
    for (i, (t, reply)) in traces.iter().zip(replies).enumerate() {
        let lean: Value = serde_json::from_str(reply).unwrap();
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
