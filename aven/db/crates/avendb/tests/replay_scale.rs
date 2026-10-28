//! What taking a page of a peer's late edits costs as a device holds more (the sync plan's scale rule, 2026-10-27): a
//! page of edits a peer wrote while it was away, which sort before the last edits held, as a first sync brings them, and
//! a page written on top, each stepped on (`replay_on`) at a few sizes held. The cost of a page must not grow with what
//! is held. Run by hand: `cargo test --release -p avendb --test replay_scale -- --ignored --nocapture`.

mod common;

use std::time::Instant;

use avendb::id::EntryId;
use avendb::keys::KeyFam;
use avendb::policy::{replay, replay_on, replay_on_why, Action, Edit, Log, Proposal, State};
use common::*;

/// The entries the writes are spread over.
const ENTRIES: u64 = 200;
/// The edits of a page, about what a 3 MB page brings.
const PAGE: usize = 600;

/// A write of `n` on entry `e`, by `by`, drafted on `log`.
fn write(log: &Log, st: &State, by: avendb::id::SignerId, e: EntryId, n: usize) -> Edit {
    let en = st.entry(e).expect("an entry");
    let epoch = st.epoch(KeyFam::Audience(en.vault, en.audience()));
    let body = n.to_le_bytes().to_vec();
    let (vault, actor, stay, deps, via, files) = (en.vault, en.vault, en.stay(), vec![], vec![], vec![]);
    let action = Action::Write { vault, entry: e, actor, stay, epoch, deps, proposal: Proposal::Main, via, create: None, files, body: body.into() };
    log.draft_on(st, by, &[], action)
}

/// Alice's Mac writes `held` edits; her iPhone, away since a tenth of them, wrote a page meanwhile. The seconds the
/// late page and a page on top each take to step on, and whether each stepped on is the whole replayed.
fn page_costs(held: usize) -> (f64, f64) {
    let mut c = cast();
    for i in 0..ENTRIES {
        c.log.append(MAC_A, &[], creation(c.alice, EntryId::from_u64(1000 + i), c.alice, &[])).expect("an entry");
    }
    let mut was = replay(c.log.edits());
    let mut away = None;
    for n in 0..held {
        let e = EntryId::from_u64(1000 + n as u64 % ENTRIES);
        let edit = write(&c.log, &was.state, MAC_A, e, n);
        let before = c.log.edits().len();
        c.log.receive([edit]);
        was = replay_on(was, c.log.edits(), before);
        if n == held / 10 {
            away = Some((c.log.clone(), was.clone()));
        }
    }
    // the iPhone's page, written on what it held when it went away
    let (mut phone, mut on) = away.expect("a log the iPhone left with");
    for n in 0..PAGE {
        let edit = write(&phone, &on.state, PHONE_A, EntryId::from_u64(1000 + (n as u64 * 7) % ENTRIES), n);
        let before = phone.edits().len();
        phone.receive([edit]);
        on = replay_on(on, phone.edits(), before);
    }
    let late: Vec<Edit> = phone.edits().iter().filter(|e| e.author == PHONE_A).cloned().collect();
    let before = c.log.edits().len();
    c.log.receive(late);
    let t = Instant::now();
    let was = replay_on(was, c.log.edits(), before);
    let late_s = t.elapsed().as_secs_f64();
    assert!(was == replay(c.log.edits()), "the late page stepped on differs from the whole");
    // a page on top, as a device that keeps up takes it
    let before = c.log.edits().len();
    let mut cur = was.clone();
    for n in 0..PAGE {
        let edit = write(&c.log, &cur.state, MAC_A, EntryId::from_u64(1000 + n as u64 % ENTRIES), n);
        let at = c.log.edits().len();
        c.log.receive([edit]);
        cur = replay_on(cur, c.log.edits(), at);
    }
    let t = Instant::now();
    let was = replay_on(was, c.log.edits(), before);
    let top_s = t.elapsed().as_secs_f64();
    assert!(was == replay(c.log.edits()), "the page on top stepped on differs from the whole");
    (late_s, top_s)
}

#[test]
fn a_late_page_and_a_page_on_top_step_on_to_the_whole() {
    page_costs(2_000);
}

#[test]
#[ignore]
fn a_page_costs_the_same_however_much_is_held() {
    for held in [10_000, 100_000] {
        let (late, top) = page_costs(held);
        eprintln!("SCALE held={held} late_page_s={late:.3} top_page_s={top:.3}");
    }
}

/// A new device taking what Alice's Mac wrote over `entries` entries (`held` writes), a page at a time: as the pull
/// asks today, the logs `LOGS_AT_ONCE` (256) at a time, each asking's edits in their places; or every log in one
/// asking, so that each page sorts after all it took before. The seconds each took, all pages stepped on.
fn first_sync(held: usize, entries: u64) -> (f64, f64, f64) {
    use avendb::sync::{log_of, place};
    let mut c = cast();
    for i in 0..entries {
        c.log.append(MAC_A, &[], creation(c.alice, EntryId::from_u64(1000 + i), c.alice, &[])).expect("an entry");
    }
    let mut was = replay(c.log.edits());
    for n in 0..held {
        let e = EntryId::from_u64(1000 + (n as u64 * 7919) % entries);
        let edit = write(&c.log, &was.state, MAC_A, e, n);
        let before = c.log.edits().len();
        c.log.receive([edit]);
        was = replay_on(was, c.log.edits(), before);
    }
    let all: Vec<(Option<avendb::sync::LogId>, Edit)> =
        c.log.edits().iter().zip(c.log.ids()).map(|(e, id)| (log_of(e, *id), e.clone())).collect();
    let take = |pages: Vec<Vec<Edit>>| {
        let (mut log, mut r) = (Log::new(), replay(&[]));
        let t = Instant::now();
        let mut why = std::collections::BTreeMap::<String, usize>::new();
        for page in pages {
            let before = log.edits().len();
            log.receive(page);
            let (next, w) = replay_on_why(r, log.edits(), before);
            r = next;
            *why.entry(format!("{w:?}")).or_default() += 1;
        }
        let s = t.elapsed().as_secs_f64();
        eprintln!("WHY {why:?}");
        assert!(r == replay(log.edits()), "a first sync stepped on differs from the whole");
        s
    };
    let paged = |mut edits: Vec<Edit>| -> Vec<Vec<Edit>> {
        edits.sort_by_key(place);
        edits.chunks(PAGE).map(<[Edit]>::to_vec).collect()
    };
    // today: the logs no entry's first, then the entries' logs 256 at a time
    let mut logs: Vec<_> = all.iter().map(|(l, _)| *l).collect::<std::collections::BTreeSet<_>>().into_iter().collect();
    logs.sort_by_key(|l| matches!(l, Some(avendb::sync::LogId::Entry(_))));
    let mut batched = vec![];
    for chunk in logs.chunks(256) {
        let edits = all.iter().filter(|(l, _)| chunk.contains(l)).map(|(_, e)| e.clone()).collect();
        batched.extend(paged(edits));
    }
    let one = paged(all.iter().map(|(_, e)| e.clone()).collect());
    // the open view's 20 logs first, then every other log in one asking
    let view: std::collections::BTreeSet<_> = logs.iter().rev().take(20).copied().collect();
    let mut first = paged(all.iter().filter(|(l, _)| view.contains(l)).map(|(_, e)| e.clone()).collect());
    first.extend(paged(all.iter().filter(|(l, _)| !view.contains(l)).map(|(_, e)| e.clone()).collect()));
    if std::env::var_os("ONLY_VIEW").is_some() {
        return (0.0, 0.0, take(first));
    }
    (take(batched), take(one), take(first))
}

#[test]
fn a_first_sync_steps_on_to_the_whole_however_it_is_asked() {
    first_sync(2_000, 600);
}

#[test]
#[ignore]
fn a_first_sync_in_one_asking_steps_on_each_page() {
    for (held, entries) in [(10_000, 2_000), (50_000, 3_000)] {
        let (batched, one, view) = first_sync(held, entries);
        eprintln!("FIRST held={held} logs={entries} batched_s={batched:.2} one_asking_s={one:.2} view_then_one_s={view:.2}");
    }
}
