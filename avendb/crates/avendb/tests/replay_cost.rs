//! A probe, run by hand: what a whole replay costs as removals pile up on a big log
//! (`NOTES=3000 REMOVALS=8 cargo test --release --test replay_cost -- --ignored --nocapture`).

use avendb::cast::{document, human_on};
use avendb::lab::Lab;
use avendb::policy::{replay, replay_memo, Action, Revoking};
use std::time::Instant;

#[test]
#[ignore]
fn whole_replay_with_removals() {
    let n: usize = std::env::var("NOTES").ok().and_then(|s| s.parse().ok()).unwrap_or(2000);
    let r: usize = std::env::var("REMOVALS").ok().and_then(|s| s.parse().ok()).unwrap_or(4);
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let phones: Vec<_> = (0..r).map(|i| lab.device_of(passkey, &format!("Phone {i}"))).collect();
    let mut devices = vec![mac];
    devices.extend(&phones);
    let alice = human_on(&mut lab, passkey, &devices);
    for i in 0..n {
        lab.create(mac, alice, alice, "note", &[], document(&format!("Note {i}"), "Hello.", mac)).unwrap();
        if r > 0 && (i + 1) % (n / r).max(1) == 0 && (i + 1) / (n / r).max(1) <= r {
            let device = phones[(i + 1) / (n / r).max(1) - 1];
            lab.submit(mac, &[passkey], Action::Revoke(Revoking::Device { vault: alice, device, keep: vec![] })).unwrap();
        }
    }
    let edits = lab.log(mac).edits().to_vec();
    let removals = edits.iter().filter(|e| e.is_removal()).count();
    let t = Instant::now();
    let whole = replay(&edits);
    eprintln!("PROBE edits={} removals={removals} stood={} replay_ms={:.0}", edits.len(), whole.stood.iter().filter(|s| **s).count(), t.elapsed().as_secs_f64() * 1e3);
    let t = Instant::now();
    let again = replay_memo(&edits, whole.memo.as_ref());
    eprintln!("PROBE with its memo: replay_ms={:.0}", t.elapsed().as_secs_f64() * 1e3);
    assert!(again == whole, "the same replay");
    let none = replay(&[]);
    assert!(replay_memo(&edits, none.memo.as_ref()) == whole);
}
