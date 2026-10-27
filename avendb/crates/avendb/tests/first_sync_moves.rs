//! A first sync of a vault whose entries move between audiences, page by page (2026-10-27, Samuel's iPhone: 16 of the
//! 25 replays of its first sync replayed every edit it held, each "a removal came", 1.5 s on average and 2.7 s at most,
//! the network waiting on each). A new device asks the vault's logs that say who may do what first, then every entry's
//! log in one asking (`ask_differing`), whose pages come in their places, each sorting after the last; a page of a
//! vault that moves its entries holds moves, each a removal. Each page steps on (`replay_on_why`) from the place the
//! replay keeps, the moves among them too (`V4_tail_moves`), never replaying every edit held, and the replay it ends
//! with is the whole's. What a page takes doesn't grow with what is held.

mod common;

use std::time::Instant;

use avendb::id::{AudienceId, EntryId, VaultId};
use avendb::keys::KeyFam;
use avendb::policy::{mk_audience, replay, replay_on, replay_on_why, Action, Edit, Level, Log, Proposal, Who, Why};
use avendb::slice::{Atom, Selector, Sym};
use avendb::sync::{log_of, place, LogId};
use common::*;

/// The notes the vault's edits are spread over at a time: the latest so many. A move wraps the key of every write of
/// its note under its new stay's (`link`), so it costs what its note was written, which a vault that keeps writing
/// new notes keeps bounded, as the iPhone's did (3,200 entries at 130,000 edits, about 40 each).
const ENTRIES: u64 = 400;
/// Of every so many edits, one creates a note, the oldest of the latest `ENTRIES` falling quiet: about 40 edits a note.
const NOTE_EVERY: usize = 40;
/// The edits of a page, about what a 3 MB page brings.
const PAGE: usize = 600;
/// Of every so many edits, one moves its entry.
const MOVE_EVERY: usize = 9;
/// Of every so many edits, one is a grant to another of Bob's vaults' notes.
const GRANT_EVERY: usize = 10_000;

/// Alice's vault as her Mac and her iPhone write it at once: `held` edits after its notes, two at each depth, every
/// `MOVE_EVERY`-th a move of its note into Bob's audience or back, keeping every write of the note it had seen, a new
/// note every `NOTE_EVERY`, and now and then a grant.
fn vault(held: usize) -> (Log, VaultId) {
    let mut c = cast();
    let (alice, bob) = (c.alice, c.bob);
    let notes = || Selector::AnyOf(vec![vec![Atom::TypeIn(vec![Sym::new("note")])]]);
    let bobs = c.issue(MAC_A, &[], alice, Who::Vault(bob), Level::Write, notes()).expect("a share with Bob");
    let mut made: Vec<EntryId> = (0..ENTRIES).map(|i| EntryId::from_u64(1000 + i)).collect();
    for &e in &made {
        c.create(MAC_A, alice, e, alice, &[], "note", &[]).expect("a note");
    }
    let mut was = replay(c.log.edits());
    let mut depth = c.log.edits().iter().map(|e| e.depth).max().unwrap_or(0);
    let mut n = 0;
    while n < held {
        if n > 0 && n % GRANT_EVERY == 0 {
            let before = c.log.edits().len();
            c.issue(MAC_A, &[], alice, Who::Vault(c.carol), Level::Read, notes()).expect("a share with Carol");
            was = replay_on(was, c.log.edits(), before);
            depth = depth.max(c.log.edits()[before..].iter().map(|e| e.depth).max().unwrap_or(0));
        }
        if n > 0 && n % NOTE_EVERY == 0 {
            let before = c.log.edits().len();
            let e = EntryId::from_u64(1000 + made.len() as u64);
            c.create(MAC_A, alice, e, alice, &[], "note", &[]).expect("a note");
            made.push(e);
            was = replay_on(was, c.log.edits(), before);
            depth = depth.max(c.log.edits()[before..].iter().map(|e| e.depth).max().unwrap_or(0));
        }
        // both devices at one depth, each on its own note, drafted on what both held
        depth += 1;
        let mut group = vec![];
        for (k, by) in [MAC_A, PHONE_A].into_iter().enumerate() {
            let e = made[made.len() - ENTRIES as usize + ((n + k) * 7919) % ENTRIES as usize];
            let en = was.state.entry(e).expect("a note");
            let action = if (n + k) % MOVE_EVERY == MOVE_EVERY - 1 {
                let into = en.audience() == AudienceId::of(alice, &[]);
                let to = if into { mk_audience(&[bobs]) } else { vec![] };
                let keep = was.state.writes(e);
                Action::Mark { vault: alice, entry: e, caps: Some(to), wants: None, keep, via: vec![] }
            } else {
                let epoch = was.state.epoch(KeyFam::Audience(en.vault, en.audience()));
                let body = (n + k).to_le_bytes().to_vec();
                let (vault, actor, stay, deps, via, files) = (alice, alice, en.stay(), vec![], vec![], vec![]);
                Action::Write { vault, entry: e, actor, stay, epoch, deps, proposal: Proposal::Main, via, create: None, files, body }
            };
            group.push(Edit { parents: vec![], depth, author: by, cosigners: vec![], action });
        }
        n += group.len();
        let before = c.log.edits().len();
        c.log.receive(group);
        was = replay_on(was, c.log.edits(), before);
    }
    (c.log, alice)
}

/// One page a new device took: how many edits it held before, how its replay stepped on, and the seconds it took.
struct Took {
    held: usize,
    why: Why,
    secs: f64,
}

/// A new device taking every edit of `log` as a first sync asks for them: the logs that say who may do what, then
/// every entry's log in one asking, each in pages in their places. Each page it took; the replay it ends with is the
/// whole's.
fn first_sync(log: &Log) -> Vec<Took> {
    let entry = |e: &Edit| matches!(log_of(e, e.id()), Some(LogId::Entry(_)));
    let paged = |mut edits: Vec<Edit>| -> Vec<Vec<Edit>> {
        edits.sort_by_key(place);
        edits.chunks(PAGE).map(<[Edit]>::to_vec).collect()
    };
    let mut pages = paged(log.edits().iter().filter(|e| !entry(e)).cloned().collect());
    pages.extend(paged(log.edits().iter().filter(|e| entry(e)).cloned().collect()));
    let (mut held, mut r) = (Log::new(), replay(&[]));
    let mut took = vec![];
    for page in pages {
        let before = held.edits().len();
        held.receive(page);
        let t = Instant::now();
        let (next, why) = replay_on_why(r, held.edits(), before);
        took.push(Took { held: before, why, secs: t.elapsed().as_secs_f64() });
        r = next;
    }
    assert!(r == replay(held.edits()), "a first sync stepped on differs from the whole");
    took
}

/// How the pages went, by what was held: how many replayed the whole, and the median seconds a page took.
fn report(took: &[Took], step: usize) -> String {
    let mut out = String::new();
    let most = took.iter().map(|t| t.held).max().unwrap_or(0);
    for from in (0..=most).step_by(step) {
        let these: Vec<&Took> = took.iter().filter(|t| (from..from + step).contains(&t.held)).collect();
        if these.is_empty() {
            continue;
        }
        let whole = these.iter().filter(|t| matches!(t.why, Why::Whole(_))).count();
        let mut s: Vec<f64> = these.iter().map(|t| t.secs).collect();
        s.sort_by(f64::total_cmp);
        let max = s.last().copied().unwrap_or(0.0);
        out += &format!("FIRST_SYNC_MOVES held={from}.. pages={} whole={whole} median_ms={:.2} max_ms={:.2}\n",
            these.len(), s[s.len() / 2] * 1e3, max * 1e3);
    }
    for t in took.iter().filter(|t| matches!(t.why, Why::Whole(_))) {
        out += &format!("FIRST_SYNC_MOVES whole at held={}: {:?} ({:.1} ms)\n", t.held, t.why, t.secs * 1e3);
    }
    out
}

/// The pages that replayed every edit: the first, which holds nothing yet, and the first of the entries' asking,
/// which sorts among the logs that say who may do what, few edits held then. No other.
fn wholes_after_the_start(took: &[Took], first: usize) -> Vec<&Took> {
    took.iter().filter(|t| t.held > first && matches!(t.why, Why::Whole(_))).collect()
}

/// How many edits the logs that say who may do what bring, the first asking.
fn rules(log: &Log) -> usize {
    log.edits().iter().filter(|e| !matches!(log_of(e, e.id()), Some(LogId::Entry(_)))).count()
}

#[test]
fn a_first_sync_steps_each_page_with_moves_on() {
    let (log, _) = vault(6_000);
    let took = first_sync(&log);
    let r = report(&took, 2_000);
    eprint!("{r}");
    let moved = log.edits().iter().filter(|e| matches!(e.action, Action::Mark { caps: Some(_), .. })).count();
    assert!(moved > 500, "the vault moves its notes: {moved}");
    let late = wholes_after_the_start(&took, rules(&log) + PAGE);
    assert!(late.is_empty(), "pages replayed every edit held:\n{r}");
}

/// The same at 100,000 edits: no page replays every edit held, and a page held after 80,000 takes about what one held
/// after 10,000 takes (`FIRST_SYNC_MOVES` lines, printed).
#[test]
fn a_page_with_moves_costs_the_same_however_much_is_held() {
    let (log, _) = vault(100_000);
    let took = first_sync(&log);
    let r = report(&took, 10_000);
    eprint!("{r}");
    let late = wholes_after_the_start(&took, rules(&log) + PAGE);
    assert!(late.is_empty(), "pages replayed every edit held:\n{r}");
    let median = |from: usize, to: usize| {
        let mut s: Vec<f64> = took.iter().filter(|t| (from..to).contains(&t.held)).map(|t| t.secs).collect();
        s.sort_by(f64::total_cmp);
        s[s.len() / 2]
    };
    let (early, late) = (median(10_000, 30_000), median(80_000, 100_000));
    eprintln!("FIRST_SYNC_MOVES median_ms held 10k-30k={:.2} 80k-100k={:.2}", early * 1e3, late * 1e3);
    // a shared runner's noise aside: flat, not the whole held again (that grew tenfold over the same span)
    assert!(late <= early * 3.0 + 0.005, "a page costs more as more is held:\n{r}");
}
