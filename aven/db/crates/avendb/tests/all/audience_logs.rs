//! The log keeps the audiences of each vault it holds key edits of (`Log::audience_logs`) as edits arrive, which a
//! device's blind-index tokens are in (`Lab::find_tokens`, `index_mark`): the same set a walk of every edit held
//! finds, on every device, after shares, a share's key moved by a revoke, and a sync.
#![cfg(debug_assertions)]

use std::collections::BTreeSet;

use avendb::cast;
use avendb::id::AudienceId;
use avendb::keys::{KeyFam, KeyName};
use avendb::policy::Action;

#[test]
fn the_audiences_kept_beside_the_log_are_the_walks() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let (alice, bob, mac) = (w.alice, w.bob, w.mac_a);
    let check = |w: &cast::World| {
        let mut held = 0;
        for d in [w.mac_a, w.mac_b, w.mac_c, w.server] {
            let log = w.lab.log(d);
            let vaults: BTreeSet<_> = log.edits().iter().filter_map(|e| match &e.action {
                Action::Keys { name: KeyName::Scoped(KeyFam::Audience(v, _), _), .. } => Some(*v),
                _ => None,
            }).collect();
            for v in vaults.iter().chain([&alice, &bob]) {
                let walked: BTreeSet<AudienceId> = log.edits().iter().filter_map(|e| match &e.action {
                    Action::Keys { name: KeyName::Scoped(KeyFam::Audience(u, x), _), .. } if u == v => Some(*x),
                    _ => None,
                }).collect();
                let kept: BTreeSet<AudienceId> = log.audience_logs(*v).collect();
                assert_eq!(kept, walked, "{d:?} {v:?}");
                held += kept.len();
            }
        }
        held
    };
    check(&w);
    let reads = cast::share(alice, cast::vault(bob), avendb::policy::Level::Read, cast::of_type("todo"));
    let share = w.lab.issue(mac, &[mac], reads).expect("Alice lets Bob read her todos");
    w.lab.sync_all(0);
    check(&w);
    let out = avendb::engine::run(&mut w.lab, mac, &serde_json::json!({ "op": "revoke", "share": share.to_hex() }));
    assert!(out.get("ok").is_some() || out.get("approve").is_some(), "{out}");
    w.lab.sync_all(0);
    let held = check(&w);
    assert!(held > 0, "some audiences' key edits are held");
    let _ = l;
}
