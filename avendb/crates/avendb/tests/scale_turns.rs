//! Every turn of the Lab short at a server's size (the sync lane work, 2026-10-27): a device holding about 130,000
//! edits over a few thousand entries, every one of which it reads, takes a page of new edits, catches up a step at a
//! time (`Lab::catch_up_step`), has its keeper scan its files (`Lab::scan_files`) and makes a write of its own in the
//! middle of a catch-up. Each of those is one turn of a node's Lab, and none may hold it past `TURN`, whatever the
//! device holds: a page waits for one turn, not for the whole. A release build alone (a debug build checks each step
//! of a replay against the whole replay, which is what this measures the absence of). Run by hand or on CI:
//! `cargo test --release -p avendb --test scale_turns -- --ignored --nocapture`, `SCALE_EDITS` edits (130,000 if
//! unset) by `SCALE_WRITERS` devices (64).
#![cfg(not(debug_assertions))]

use std::collections::HashSet;
use std::time::{Duration, Instant};

use avendb::cast::{document, paragraph};
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::lab::{CatchUp, FileScan, FileScanned, Lab};
use avendb::policy::{Action, Kind, Principal, Sharing};
use avendb::sign::Signed;

/// The longest one turn of the Lab may take.
const TURN: Duration = Duration::from_millis(50);
/// The entries a catch-up shows anew in a turn, and the edits a keeper's scan reads in one, as a node takes them.
const SHOW: usize = 48;
const SCAN: usize = 4096;
/// The edits of a page.
const PAGE: usize = 600;

fn env(name: &str, default: usize) -> usize {
    std::env::var(name).ok().and_then(|n| n.parse().ok()).unwrap_or(default)
}

struct Fixture {
    lab: Lab,
    alice: VaultId,
    phone: SignerId,
    writers: Vec<(SignerId, Vec<EntryId>)>,
}

/// Alice's vault, her iPhone, and `writers` devices of hers that each wrote `edits / writers` edits over 50 entries of
/// her vault, without syncing each other, so that each one's store stays small while it writes.
fn fixture(writers: usize, edits: usize) -> Fixture {
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let phone = lab.device_of(passkey, "Alice's iPhone");
    let ws: Vec<SignerId> = (0..writers).map(|i| lab.device_of(passkey, &format!("Alice's writer {i}"))).collect();
    let genesis = Action::Genesis {
        kind: Kind::Human,
        owners: vec![Principal::Signer(passkey)],
        threshold: 1,
        root: Some(passkey),
        nonce: 0,
        seal_to: vec![],
    };
    let alice = VaultId::from(lab.submit(mac, &[passkey], genesis).expect("a vault"));
    for &d in [mac, phone].iter().chain(&ws) {
        let add = Action::Share(Sharing::Device { vault: alice, device: d, seal_to: None });
        lab.submit(mac, &[passkey, d], add).expect("a device added");
    }
    for &d in [phone].iter().chain(&ws) {
        lab.sync(mac, d);
    }
    let per = edits / writers.max(1);
    let began = Instant::now();
    let mut made = vec![];
    for (i, &w) in ws.iter().enumerate() {
        let entries: Vec<EntryId> = (0..50)
            .map(|e| {
                let doc = document(&format!("Doc {i}.{e}"), "Written by one of Alice's devices.", w);
                lab.create(w, alice, alice, "doc", &[], doc).expect("a document")
            })
            .collect();
        for k in 0..per.saturating_sub(entries.len()) {
            let entry = entries[k % entries.len()];
            let text = format!("Edit {k} of writer {i}.");
            lab.edit(w, alice, entry, |item| item.push_block(paragraph(100 + k as u64, &text))).expect("an edit");
        }
        made.push((w, entries));
        if i % 8 == 7 {
            eprintln!("SCALE fixture: {} writers in {:.0?}", i + 1, began.elapsed());
        }
    }
    Fixture { lab, alice, phone, writers: made }
}

/// A page taken as a node takes it: what it lacks of it told apart in one turn, the signatures checked outside the
/// Lab, and the page kept in another turn, not yet caught up.
fn take(lab: &mut Lab, d: SignerId, page: Vec<Signed>, turns: &mut Turns, what: [&'static str; 2]) {
    let preparing = turns.took(what[0], || lab.prepare_receive(d, page));
    let prepared = preparing.check();
    turns.took(what[1], || lab.receive_prepared(d, prepared, false));
}

/// What device `to` lacks of what `from` holds, in the order `from` took it.
fn lacking(lab: &Lab, from: SignerId, to: SignerId) -> Vec<Signed> {
    let held: HashSet<_> = lab.log(to).ids().iter().copied().collect();
    lab.backup(from).signed().iter().filter(|s| !held.contains(&s.edit.id())).cloned().collect()
}

/// Where the time went between two of a device's perf timers, the largest first.
fn spent(before: &serde_json::Value, after: &serde_json::Value) -> String {
    let total = |v: &serde_json::Value, k: &str| v[k]["total_ms"].as_f64().unwrap_or(0.0);
    let mut d: Vec<(String, f64)> = after.as_object().into_iter().flatten()
        .map(|(k, _)| (k.clone(), total(after, k) - total(before, k))).filter(|(_, ms)| *ms > 0.5).collect();
    d.sort_by(|a, b| b.1.total_cmp(&a.1));
    d.iter().map(|(k, ms)| format!("{k} {ms:.1} ms")).collect::<Vec<_>>().join(", ")
}

/// The longest turns, by what they were, with where the longest one's time went.
#[derive(Default)]
struct Turns(Vec<(&'static str, Duration, usize, String)>);

impl Turns {
    fn took<T>(&mut self, what: &'static str, f: impl FnOnce() -> T) -> T {
        let at = Instant::now();
        let out = f();
        self.record(what, at.elapsed(), String::new());
        out
    }

    /// A turn of `what` took `took`, its time going where `why` says.
    fn record(&mut self, what: &'static str, took: Duration, why: String) {
        match self.0.iter_mut().find(|(w, ..)| *w == what) {
            Some((_, longest, n, was)) => {
                if took > *longest {
                    (*longest, *was) = (took, why);
                }
                *n += 1;
            }
            None => self.0.push((what, took, 1, why)),
        }
    }
}

/// One turn `f` of device `d`'s, timed as `what`, with where its time went.
fn turn<T>(lab: &mut Lab, d: SignerId, turns: &mut Turns, what: &'static str, f: impl FnOnce(&mut Lab) -> T) -> T {
    let before = lab.perf(d);
    let at = Instant::now();
    let out = f(lab);
    let took = at.elapsed();
    let after = lab.perf(d);
    let why = breakdown(&before, &after);
    if took > TURN {
        eprintln!("SCALE   a long {what} ({took:.1?}): {why}");
    }
    turns.record(what, took, why);
    out
}

/// What a turn judged and where its time went, between a device's perf before and after it.
fn breakdown(before: &serde_json::Value, after: &serde_json::Value) -> String {
    let n = |p: &serde_json::Value, k: &str| p["counts"][k].as_u64().unwrap_or(0);
    let judged = ["show: entries judged", "show: writes judged", "upkeep: entries looked at", "read: writes looked at"]
        .map(|k| n(after, k) - n(before, k));
    format!(
        "{} entries and {} writes judged, {} entries kept up, {} writes read: {}",
        judged[0],
        judged[1],
        judged[2],
        judged[3],
        spent(&before["timers"], &after["timers"])
    )
}

/// A catch-up of device `d` a step at a time, each step timed as `what`, the last one, `Caught`, as `last`.
fn catch_up(lab: &mut Lab, d: SignerId, turns: &mut Turns, [what, last]: [&'static str; 2]) {
    for _ in 0..1_000_000 {
        let before = lab.perf(d);
        let at = Instant::now();
        let step = lab.catch_up_step(d, SHOW);
        let took = at.elapsed();
        let after = lab.perf(d);
        let why = breakdown(&before, &after);
        if took > TURN {
            eprintln!("SCALE   a long {what} ({took:.1?}, {step:?}): {why}");
        }
        let caught = matches!(step, CatchUp::Caught(_));
        turns.record(if caught { last } else { what }, took, why);
        if caught {
            return;
        }
    }
    panic!("a catch-up ends");
}

#[test]
#[ignore]
fn every_turn_is_short_at_a_servers_size() {
    let (writers, edits) = (env("SCALE_WRITERS", 64), env("SCALE_EDITS", 130_000));
    let began = Instant::now();
    let Fixture { mut lab, alice, phone, writers: ws } = fixture(writers, edits);
    eprintln!("SCALE fixture: {} edits written in {:.1?}", edits, began.elapsed());
    eprintln!("SCALE a writer's perf {}", lab.perf(ws[0].0)["timers"]);
    // the iPhone takes them all a page at a time and catches up: what it holds before the turns measured
    let setup = Instant::now();
    let mut first = Turns::default();
    for (w, _) in &ws {
        for page in lacking(&lab, *w, phone).chunks(PAGE) {
            take(&mut lab, phone, page.to_vec(), &mut first, ["first sync: a page told apart", "first sync: a page kept"]);
        }
    }
    catch_up(&mut lab, phone, &mut first, ["first sync: a catch-up step", "first sync: the last catch-up step"]);
    let held = lab.log(phone).edits().len();
    let entries = lab.entries(phone).len();
    eprintln!("SCALE the iPhone holds {held} edits, {entries} entries, set up in {:.1?}", setup.elapsed());
    for (what, longest, n, _) in &first.0 {
        eprintln!("SCALE   (setup) {what}: {n} turns, the longest {longest:.1?}");
    }
    assert!(held >= edits, "it holds what they wrote");

    let mut turns = Turns::default();
    for round in 0..3 {
        // a page of new edits from a few writers, taken as a pull takes a page, then caught up a step at a time
        let mut page = vec![];
        for (k, (w, entries)) in ws.iter().enumerate().take(10) {
            for n in 0..PAGE / 10 {
                let entry = entries[(n * 7 + round) % entries.len()];
                let text = format!("Round {round}, edit {n} of writer {k}.");
                lab.edit(*w, alice, entry, |item| item.push_block(paragraph(1_000_000 + n as u64, &text))).expect("an edit");
            }
            page.extend(lacking(&lab, *w, phone));
        }
        take(&mut lab, phone, page, &mut turns, ["a page told apart", "a page kept"]);
        // a write of its own, two steps into the catch-up, as a person types while the pull goes on
        turn(&mut lab, phone, &mut turns, "a catch-up step", |lab| lab.catch_up_step(phone, SHOW));
        turn(&mut lab, phone, &mut turns, "a catch-up step", |lab| lab.catch_up_step(phone, SHOW));
        let mine = ws[round].1[3];
        turn(&mut lab, phone, &mut turns, "a write of its own during a catch-up", |lab| {
            lab.edit(phone, alice, mine, |item| item.push_block(paragraph(2_000_000 + round as u64, "From the iPhone.")))
                .expect("the iPhone's write")
        });
        catch_up(&mut lab, phone, &mut turns, ["a catch-up step", "the last catch-up step (Caught)"]);
        // its keeper's scan of its files, a slice a turn
        let mut scan = FileScan::new(true, lab.entries(phone).into_iter().take(20).collect());
        loop {
            match turns.took("a keeper's slice", || lab.scan_files(phone, &mut scan, SCAN)) {
                FileScanned::Done { .. } => break,
                FileScanned::More => {}
                FileScanned::Behind => panic!("caught up"),
            }
        }
        turn(&mut lab, phone, &mut turns, "a write of its own", |lab| {
            lab.edit(phone, alice, mine, |item| item.push_block(paragraph(3_000_000 + round as u64, "Again.")))
                .expect("the iPhone's write")
        });
    }
    let mut long = vec![];
    for (what, longest, n, why) in &turns.0 {
        eprintln!("SCALE {what}: {n} turns, the longest {longest:.1?} ({why})");
        if *longest > TURN {
            long.push(format!("{what} {longest:.1?}"));
        }
    }
    eprintln!("SCALE perf {}", lab.perf(phone));
    assert!(long.is_empty(), "turns past {TURN:?} at {held} edits: {long:?}");
}
