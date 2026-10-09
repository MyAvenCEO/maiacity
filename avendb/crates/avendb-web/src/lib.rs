//! avenDB in a web page: the Lab as WebAssembly, for the avenDB tile (`src/routes/app/avendb/`). The page makes the
//! tile's world a step at a time (`Tile::build_step`), reads it through JSON views (`Tile::view`) and changes it
//! through JSON actions (`Tile::act`), each on the device it picks, and plays the plan's scenarios (`run_scenario`).
//!
//! A page has no threads to make Classic McEliece key pairs in, most of a second each, so it makes them in its
//! workers: each key that will need one says so (`avendb::keys::Secret::prepare`), the page takes their seeds
//! (`wanted_pairs`), a worker makes each pair from its seed alone (`make_pair`), and the page hands the pairs in
//! (`hand_in_pair`) before the next step needs them. The Lab keeps spare keys (`set_spare_keys`), so the keys a step
//! makes have their pairs made already. A pair is only ever made from its seed, so a pair made in a worker is the pair
//! the key would have made itself.
//!
//! The tests run natively: `cargo test -p avendb-web`.

use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

use avendb::keys::{self, MCELIECE_PUBLIC_BYTES};
use avendb::scenarios::{scenario, SCENARIOS};

mod act;
mod show;
mod tile;

pub use tile::Tile;

/// Report a panic on the page's console: the tile can't go on after one, and the page offers to start again.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(start)]
pub fn start() {
    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_namespace = console)]
        fn error(s: &str);
    }
    std::panic::set_hook(Box::new(|info| error(&format!("avenDB: {info}"))));
}

/// Have every Lab made from now on keep `n` spare keys, their McEliece pairs made ahead (`avendb::lab::spare_keys`).
#[wasm_bindgen]
pub fn set_spare_keys(n: usize) {
    avendb::lab::spare_keys(n);
}

/// The seeds of the McEliece pairs keys want and nobody was handed yet, as a JSON list of hex strings.
#[wasm_bindgen]
pub fn wanted_pairs() -> String {
    let seeds: Vec<String> = keys::wanted_pairs().iter().map(tile::hex).collect();
    json!(seeds).to_string()
}

/// The McEliece pair a seed makes: its public key, then its secret key. Empty for a seed that isn't 64 hex digits.
#[wasm_bindgen]
pub fn make_pair(seed: &str) -> Vec<u8> {
    let Some(seed) = tile::unhex(seed) else { return vec![] };
    let (public, secret) = keys::make_pair(&seed);
    [public, secret].concat()
}

/// Hand in the pair `make_pair` made from `seed`: false if no key wants it or the bytes aren't a pair's.
#[wasm_bindgen]
pub fn hand_in_pair(seed: &str, pair: &[u8]) -> bool {
    match tile::unhex(seed) {
        Some(seed) if pair.len() > MCELIECE_PUBLIC_BYTES => {
            let (public, secret) = pair.split_at(MCELIECE_PUBLIC_BYTES);
            keys::hand_in_pair(&seed, public, secret)
        }
        _ => false,
    }
}

/// Every scenario of the plan, in its order: number, title and the phase that turned it green.
#[wasm_bindgen]
pub fn scenarios() -> String {
    let list: Vec<Value> =
        SCENARIOS.iter().map(|s| json!({"number": s.number, "title": s.title, "phase": s.phase})).collect();
    json!(list).to_string()
}

/// Play scenario `number` on a Lab of its own: each check, green or red, with what was found instead of a red one's
/// expectation, and the step it stopped at if one was refused.
#[wasm_bindgen]
pub fn run_scenario(number: &str) -> String {
    play(number).to_string()
}

fn play(number: &str) -> Value {
    let Some(s) = scenario(number) else { return json!({"error": format!("There is no scenario {number}.")}) };
    let run = s.run();
    let checks: Vec<Value> =
        run.checks.iter().map(|c| json!({"what": c.what, "ok": c.ok, "found": c.found})).collect();
    json!({
        "number": s.number,
        "title": s.title,
        "phase": s.phase,
        "passed": run.passed(),
        "stopped": run.stopped,
        "checks": checks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_scenario_plays_with_every_check() {
        let run = play("1");
        assert_eq!(run["passed"], json!(true), "{run}");
        assert!(run["checks"].as_array().is_some_and(|c| c.len() >= 3 && c.iter().all(|c| c["ok"] == json!(true))));
        assert!(play("99")["error"].is_string());
        let list: Value = serde_json::from_str(&scenarios()).unwrap();
        assert_eq!(list.as_array().map(Vec::len), Some(SCENARIOS.len()));
        assert_eq!(list[0], json!({"number": "1", "title": "Alice's vault", "phase": "P1"}));
    }

    #[test]
    fn a_pair_is_made_from_its_seed_and_handed_in_once() {
        // natively, nothing else here wants a pair: keys make theirs in threads of their own
        let key = keys::Secret::derive("avendb-web tests", &[5; 32]);
        key.want();
        let seeds: Vec<String> = serde_json::from_str(&wanted_pairs()).unwrap();
        assert_eq!(seeds.len(), 1);
        let pair = make_pair(&seeds[0]);
        assert!(!hand_in_pair(&seeds[0], &pair[..MCELIECE_PUBLIC_BYTES]));
        assert!(hand_in_pair(&seeds[0], &pair));
        assert!(!hand_in_pair(&seeds[0], &pair));
        assert_eq!(key.mceliece_public()[..], pair[..MCELIECE_PUBLIC_BYTES]);
        assert_eq!(make_pair("not hex"), Vec::<u8>::new());
    }
}
