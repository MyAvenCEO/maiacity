//! Alice's iPhone opening again at the size it holds (2026-10-28): ~21,500 edits over ~3,000 entries of her own vault
//! and of a coop she owns, Maia City, with cap groups (Admin, Traveler, Citizen) that shares name, so that its entries
//! lie in several audiences, written by several of her devices before they synced, so that each made keys of its own.
//! It opens from its shelf as a device does, from its stored view and its checked keys (`Lab::restore_warm`), and an
//! `UNLOCK_PHONE {...}` line gives what the restore took, split into deriving keys, reading and showing.
//!
//!   UNLOCK_PHONE_EDITS=21500 cargo test --release -p avendb --test all unlock_phone:: -- --ignored --nocapture
//!
//! With `UNLOCK_PHONE_FIXTURE` set, it writes what the iPhone opens from there too, for avendb-browser's `benchUnlock`
//! to open the same in WebAssembly (`aven/ops/ci/avendb-bench-unlock.mjs`): its device's secret, the 40 bytes its shelf
//! names the edits it checked by, how many, then its signed edits, its McEliece keys, and its shelf's keys, views and
//! kept showings, each a count in 4 bytes, big-endian, and each item its length in 4 bytes, then its bytes. Synthetic:
//! fixed keys, no one's data.
#![cfg(not(debug_assertions))]

use std::time::Instant;

use avendb::wire::Wire;

use avendb::cast::{document, paragraph};
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::lab::{GroupShare, Lab, Warm};
use avendb::policy::{Action, Kind, Level, Principal, Sharing, Who};
use avendb::rules::{Cap, CapGroup, Op};
use avendb::slice::{Atom, Selector};
use serde_json::{Value, json};

/// The iPhone's device secret, so that a fixture of it opens as the same device elsewhere.
const PHONE: [u8; 32] = [7; 32];

fn env(name: &str, default: usize) -> usize {
    std::env::var(name).ok().and_then(|n| n.parse().ok()).unwrap_or(default)
}

fn tagged(tag: &str) -> Selector {
    Selector::AnyOf(vec![vec![Atom::TagHas(tag.into())]])
}

fn group(name: &str, op: Op, slice: Selector) -> CapGroup {
    CapGroup { name: name.into(), caps: vec![Cap { op, slice }], includes: vec![] }
}

/// Alice's vault and Maia City's, her Mac, her iPhone and `writers` devices more, Bob's vault, Maia City's three cap
/// groups and its shares through them; then each of her devices writing its share of `entries` entries and `edits`
/// edits, half in her vault and half in Maia City's, before it syncs, and the iPhone taking them all.
fn written(writers: usize, entries: usize, edits: usize) -> (Lab, SignerId, Vec<(SignerId, VaultId, EntryId)>) {
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let phone = lab.device_with("Alice's iPhone", PHONE);
    let ws: Vec<SignerId> = (0..writers).map(|i| lab.device_of(passkey, &format!("Alice's writer {i}"))).collect();
    let bob_key = lab.passkey("Bob");
    let bob_mac = lab.device_of(bob_key, "Bob's Mac");
    let human = |root| Action::Genesis {
        kind: Kind::Human,
        owners: vec![Principal::Signer(root)],
        threshold: 1,
        root: Some(root),
        nonce: 0,
        seal_to: vec![],
    };
    let alice = VaultId::from(lab.submit(mac, &[passkey], human(passkey)).expect("Alice's vault"));
    let bob = VaultId::from(lab.submit(bob_mac, &[bob_key], human(bob_key)).expect("Bob's vault"));
    for &d in [mac, phone].iter().chain(&ws) {
        let add = Action::Share(Sharing::Device { vault: alice, device: d, seal_to: None });
        lab.submit(mac, &[passkey, d], add).expect("a device added");
    }
    let add = Action::Share(Sharing::Device { vault: bob, device: bob_mac, seal_to: None });
    lab.submit(bob_mac, &[bob_key, bob_mac], add).expect("Bob's Mac added");
    lab.share_contact(bob_mac, mac, bob);
    let genesis = Action::Genesis {
        kind: Kind::Coop,
        owners: vec![Principal::Vault(alice)],
        threshold: 1,
        root: None,
        nonce: 0,
        seal_to: vec![],
    };
    let coop = VaultId::from(lab.submit(mac, &[passkey], genesis).expect("Maia City"));
    // its cap groups, each changed a few times, as Maia City's were, and its shares through them: Admin over all of it
    // to Bob, Traveler over what is tagged "travel" to everyone, Citizen over what is tagged "city" to Bob
    let groups = [
        ("Admin", Op::Share, Selector::All, Who::Vault(bob), Level::Write),
        ("Traveler", Op::Read, tagged("travel"), Who::Everyone, Level::Read),
        ("Citizen", Op::Create { on: None }, tagged("city"), Who::Vault(bob), Level::Write),
    ];
    for (name, op, slice, who, level) in groups {
        let g = lab.define_group(mac, coop, group(name, op.clone(), slice.clone())).expect("a cap group");
        for k in 1..4 {
            lab.redefine_group(mac, coop, g, group(&format!("{name} {k}"), op.clone(), slice.clone())).expect("again");
        }
        let share = GroupShare {
            over: coop,
            who,
            name: format!("{name} of Maia City"),
            select: slice,
            group: g,
            level,
            parent: None,
            issuer: coop,
        };
        lab.issue_group(mac, &[mac], share).expect("a share through it");
    }
    for &d in [phone].iter().chain(&ws) {
        lab.sync(mac, d);
    }
    let all: Vec<SignerId> = [mac].into_iter().chain(ws.iter().copied()).collect();
    let (per, per_edits) = (entries / all.len(), edits / all.len());
    let tags: [&[&str]; 4] = [&[], &["travel"], &["city"], &["travel", "city"]];
    let mut written = vec![];
    for (i, &w) in all.iter().enumerate() {
        let made: Vec<EntryId> = (0..per)
            .map(|e| {
                let doc = document(&format!("Doc {i}.{e}"), "Written by one of Alice's devices.", w);
                let (vault, tags) = if e % 2 == 0 { (alice, &[][..]) } else { (coop, tags[e / 2 % 4]) };
                lab.create(w, vault, vault, "doc", tags, doc).expect("a document")
            })
            .collect();
        for k in 0..per_edits.saturating_sub(made.len()) {
            let e = made[k % made.len()];
            let vault = if k % made.len() % 2 == 0 { alice } else { coop };
            let text = format!("Edit {k} of writer {i}.");
            lab.edit(w, vault, e, |item| item.push_block(paragraph(100 + k as u64, &text)))
                .unwrap_or_else(|r| panic!("an edit in {vault:?}: {r:?}"));
        }
        written.extend(made.iter().enumerate().map(|(k, e)| (w, if k % 2 == 0 { alice } else { coop }, *e)));
    }
    // UNLOCK_PHONE_STAGED: the iPhone takes each device's edits in turn, catching up after each as a node does after a
    // page (`catch_up_steps`), and a `CATCH_UP_PAGE {...}` line gives what each catch-up took, a step at a time
    let staged = std::env::var("UNLOCK_PHONE_STAGED").is_ok();
    for &w in &all {
        let took = lab.sync(w, phone);
        if staged {
            let before = lab.perf(phone);
            let (began, mut steps, mut longest) = (Instant::now(), 0usize, 0f64);
            loop {
                let at = Instant::now();
                let step = lab.catch_up_step(phone, 48);
                longest = longest.max(at.elapsed().as_secs_f64() * 1000.0);
                steps += 1;
                if matches!(step, avendb::lab::CatchUp::Caught(_)) {
                    break;
                }
            }
            let after = lab.perf(phone);
            let mut counts = serde_json::Map::new();
            for (k, v) in after["counts"].as_object().into_iter().flatten() {
                let n = v.as_u64().unwrap_or(0) - before["counts"][k].as_u64().unwrap_or(0);
                if n > 0 {
                    counts.insert(k.clone(), json!(n));
                }
            }
            println!("CATCH_UP_PAGE {}", json!({
                "took_edits": took,
                "held": lab.log(phone).ids().len(),
                "ms": (began.elapsed().as_secs_f64() * 10_000.0).round() / 10.0,
                "steps": steps,
                "longest_step_ms": (longest * 10.0).round() / 10.0,
                "timers": diff(&after["timers"], &before["timers"]),
                "counts": counts,
            }));
        }
    }
    // the iPhone works out all of it, as it does before it saves what it worked out
    lab.catch_up(phone);
    (lab, phone, written)
}

fn timer(t: &Value, k: &str) -> f64 {
    t[k]["total_ms"].as_f64().unwrap_or(0.0)
}

fn diff(after: &Value, before: &Value) -> Value {
    let mut out = serde_json::Map::new();
    for (k, v) in after.as_object().into_iter().flatten() {
        let ms = v["total_ms"].as_f64().unwrap_or(0.0) - timer(before, k);
        if ms > 0.5 {
            out.insert(k.clone(), json!((ms * 10.0).round() / 10.0));
        }
    }
    Value::Object(out)
}

#[test]
#[ignore]
fn measure_unlock_phone() {
    let (writers, entries, edits) =
        (env("UNLOCK_PHONE_WRITERS", 5), env("UNLOCK_PHONE_ENTRIES", 3_028), env("UNLOCK_PHONE_EDITS", 21_500));
    let began = Instant::now();
    let (mut lab, phone, made) = written(writers, entries, edits);
    let held = lab.log(phone).ids().len();
    let shown = lab.entries(phone).iter().filter(|e| lab.item(phone, **e).is_some()).count();
    eprintln!("UNLOCK_PHONE fixture: {held} edits, {shown} entries shown, in {:.1?}", began.elapsed());
    let checked = [1; 40];
    let receipt = lab.warming(phone, held, Some(checked)).expect("what it worked out, to save");
    let kept: Vec<Vec<u8>> = receipt.shown.clone().map(|k| k.pack).into_iter().collect();
    let warm = Warm {
        keys: receipt.keys.clone().into_iter().collect(),
        views: receipt.view.clone().into_iter().collect(),
        shown: kept.iter().cloned().map(Into::into).collect(),
        queries: receipt.queries.clone().map(Into::into).into_iter().collect(),
    };
    lab.warmed(phone, receipt);
    // UNLOCK_PHONE_AFTER=n: n edits more, its other devices', taken after it saved what it worked out, as the iPhone's
    // 723 past its stored view on 2026-10-28: its restore steps its view on by them
    let after = env("UNLOCK_PHONE_AFTER", 0);
    for k in 0..after {
        let (w, vault, e) = made[k * 7 % made.len()];
        let text = format!("Written after its save, {k}.");
        lab.edit(w, vault, e, |item| item.push_block(paragraph(100_000 + k as u64, &text))).expect("an edit after");
    }
    let mut writers: Vec<SignerId> = made.iter().map(|m| m.0).collect();
    writers.dedup();
    for w in writers.iter().filter(|_| after > 0) {
        lab.sync(*w, phone);
    }
    let held_before = held;
    let held = lab.log(phone).ids().len();
    eprintln!("UNLOCK_PHONE after its save: {} edits more", held - held_before);
    let backup = lab.backup(phone);
    if let Ok(path) = std::env::var("UNLOCK_PHONE_FIXTURE") {
        let list = |out: &mut Vec<u8>, items: Vec<Vec<u8>>| {
            out.extend_from_slice(&(items.len() as u32).to_be_bytes());
            for i in items {
                out.extend_from_slice(&(i.len() as u32).to_be_bytes());
                out.extend_from_slice(&i);
            }
        };
        let mut out = PHONE.to_vec();
        out.extend_from_slice(&checked);
        out.extend_from_slice(&(held as u32).to_be_bytes());
        list(&mut out, backup.signed().iter().map(|s| s.to_wire()).collect());
        list(&mut out, lab.blob_ids(phone).into_iter().filter_map(|b| lab.blob(phone, b)).map(|b| b.to_vec()).collect());
        list(&mut out, warm.keys.clone());
        list(&mut out, warm.views.clone());
        list(&mut out, kept.clone());
        std::fs::write(&path, &out).expect("the fixture written");
        eprintln!("UNLOCK_PHONE fixture written: {} bytes", out.len());
    }
    // UNLOCK_PHONE_SPILL: its edits spilled to a folder, as a page's are to OPFS, with a cache of that many MiB
    let spill_dir = std::env::temp_dir().join(format!("avendb-unlock-phone-{}", std::process::id()));
    if let Ok(mib) = std::env::var("UNLOCK_PHONE_SPILL") {
        let budget = mib.parse::<usize>().expect("UNLOCK_PHONE_SPILL in MiB") << 20;
        lab.spill(phone, &avendb::lab::Spill::new(&spill_dir, budget).expect("a spill")).expect("spilled");
    }
    let perf = lab.perf(phone);
    let began = Instant::now();
    lab.restore_warm(phone, backup, Some((checked, held_before)), &warm);
    let took = began.elapsed();
    let after = lab.perf(phone);
    assert_eq!(lab.log(phone).ids().len(), held, "it took back every edit");
    let again = lab.entries(phone).iter().filter(|e| lab.item(phone, **e).is_some()).count();
    assert_eq!(again, shown, "it shows every entry it showed");
    let t = diff(&after["timers"], &perf["timers"]);
    let ms = |k: &str| t[k].as_f64().unwrap_or(0.0);
    let mut counts = serde_json::Map::new();
    for (k, v) in after["counts"].as_object().into_iter().flatten() {
        let n = v.as_u64().unwrap_or(0) - perf["counts"][k].as_u64().unwrap_or(0);
        if n > 0 {
            counts.insert(k.clone(), json!(n));
        }
    }
    println!("UNLOCK_PHONE {}", json!({
        "edits": held,
        "entries": shown,
        "restore_ms": (took.as_secs_f64() * 10_000.0).round() / 10.0,
        "derive_ms": ms("keys: derive"),
        "open_keys_ms": ms("open keys"),
        "read_ms": ms("read"),
        "show_items_ms": ms("show items"),
        "show_cap_groups_ms": ms("show: cap groups"),
        "refresh_ms": ms("refresh"),
        "timers": t,
        "counts": counts,
    }));
    std::fs::remove_dir_all(&spill_dir).ok();
}
