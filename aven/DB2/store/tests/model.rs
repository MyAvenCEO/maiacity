//! The store against the running Lean model (README, rule 10): random traces of calls through the memory store and
//! through `aven-db-model` (`db/spec/Main.lean`, `Aven.DB.Store`), compared call by call. The test builds the model
//! with `lake build` first, so it needs the box: `bun run box cargo test -p aven-db-store --test model`.

#![cfg(not(target_arch = "wasm32"))]

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use aven_db_store::{Hash, backend, conformance};
use serde_json::{Value, json};

const TRACES: u64 = 500;

/// A small deterministic generator, so a failing trace is named by its seed and replays.
struct Rng(u64);

impl Rng {
    fn below(&mut self, n: u64) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0 % n
    }
    fn pick<'a, T>(&mut self, l: &'a [T]) -> &'a T {
        &l[self.below(l.len() as u64) as usize]
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|b| format!("{b:02x}")).collect()
}

/// Calls drawn from small pools, so blobs and refs meet again: some bytes, their hashes and one never put, valid
/// names and invalid ones. A writer expects the value it last saw set, now and then another.
fn trace(seed: u64) -> Vec<Value> {
    let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
    let blobs: Vec<Vec<u8>> = vec![
        b"a".to_vec(),
        vec![],
        conformance::noise(70, seed).to_vec(),
        vec![0; 1025],
        b"z".to_vec(),
    ];
    let mut hashes: Vec<String> = blobs.iter().map(|b| Hash::of(b).to_hex()).collect();
    hashes.push(Hash::of(b"never put").to_hex());
    let names = ["head", "peer.key", "x", ".dot", "a b", ""];
    let mut seen: Option<String> = None;
    (0..rng.below(50))
        .map(|_| {
            let h = rng.pick(&hashes).clone();
            let pool = if rng.below(5) == 0 { 6 } else { 3 };
            let n = *rng.pick(&names[..pool]);
            let (a, b) = (rng.below(90), rng.below(90));
            let expected = if rng.below(3) == 0 {
                Some(rng.pick(&hashes).clone())
            } else {
                seen.clone()
            };
            match rng.below(12) {
                0 | 1 => json!(["put", hex(rng.pick(&blobs))]),
                2 => json!(["get", h]),
                3 => json!(["getRange", h, a, b]),
                4 => json!(["has", h]),
                5 => json!(["list"]),
                6 => json!(["delete", h]),
                7 => json!(["getRef", n]),
                8 | 9 => {
                    seen = Some(h.clone());
                    json!(["setRef", n, expected, h])
                }
                10 => json!(["deleteRef", n, expected.unwrap_or(h)]),
                _ => json!(["listRefs"]),
            }
        })
        .collect()
}

fn model() -> std::path::PathBuf {
    let spec = Path::new(env!("CARGO_MANIFEST_DIR")).join("../db/spec");
    let built = Command::new("lake")
        .arg("build")
        .current_dir(&spec)
        .status()
        .expect("lake runs in the box: bun run box cargo test -p aven-db-store --test model");
    assert!(built.success(), "lake build failed in db/spec");
    spec.join(".lake/build/bin/aven-db-model")
}

#[tokio::test]
async fn the_memory_store_follows_the_model_on_random_traces() {
    let traces: Vec<Vec<Value>> = (1..=TRACES).map(trace).collect();
    let mut child = Command::new(model())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let lines: String = traces
        .iter()
        .map(|t| json!({ "store": t }).to_string() + "\n")
        .collect();
    let writer = std::thread::spawn(move || stdin.write_all(lines.as_bytes()).unwrap());
    let out = child.wait_with_output().unwrap();
    writer.join().unwrap();
    assert!(out.status.success(), "aven-db-model failed");
    let replies: Vec<Value> = std::str::from_utf8(&out.stdout)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(replies.len(), traces.len());
    let mut calls = 0;
    for (i, (ops, reply)) in traces.iter().zip(&replies).enumerate() {
        let store = backend::memory().unwrap();
        for (at, (op, want)) in ops
            .iter()
            .zip(reply["store"].as_array().unwrap())
            .enumerate()
        {
            let got = conformance::call(&store, op).await;
            assert_eq!(&got, want, "seed {}, call {at}: {op}", i + 1);
            calls += 1;
        }
    }
    eprintln!("{calls} calls in {TRACES} traces agree with the model");
}
