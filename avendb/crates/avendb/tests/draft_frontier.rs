//! A draft reads its depth and its log's frontier off what the log keeps as edits arrive (`Log::frontier`, its places
//! of each log), not a scan of every edit held: the same, after appends, edits received out of their order and edits
//! let go, as the scan the Lean model's `frontier` is (`Logs.lean`), and as one more than the deepest edit held.

mod common;

use std::collections::HashSet;

use avendb::id::EntryId;
use avendb::keys::KeyFam;
use avendb::policy::{replay, Action, Edit, Log, Proposal};
use avendb::sync::frontiers;
use common::*;

/// Every log's frontier as the log keeps it is the scan's, and a draft's depth is one more than the deepest held.
fn agrees(log: &Log) {
    for (l, f) in frontiers(log.edits()) {
        assert_eq!(log.frontier(l), f, "the frontier of {l:?}");
    }
    let deepest = log.edits().iter().map(|e| e.depth + 1).max().unwrap_or(0);
    let st = log.view();
    let alice = st.vaults()[0].id;
    let drafted = log.draft_on(&st, MAC_A, &[], creation(alice, EntryId::from_u64(9_999), alice, &[]));
    assert_eq!(drafted.depth, deepest, "a draft sorts after every edit held");
}

/// A write of `n` on entry `e` by Alice's Mac, drafted on `log`.
fn write(log: &Log, e: EntryId, n: usize) -> Edit {
    let st = log.view();
    let en = st.entry(e).expect("an entry");
    let epoch = st.epoch(KeyFam::Audience(en.vault, en.audience()));
    let (vault, actor, stay) = (en.vault, en.vault, en.stay());
    let body = n.to_le_bytes().to_vec();
    let action = Action::Write {
        vault, entry: e, actor, stay, epoch, deps: vec![], proposal: Proposal::Main, via: vec![], create: None,
        files: vec![], body,
    };
    log.draft_on(&st, MAC_A, &[], action)
}

#[test]
fn a_draft_builds_on_the_frontier_and_depth_the_scan_finds() {
    let mut c = cast();
    for i in 0..6 {
        c.log.append(MAC_A, &[], creation(c.alice, EntryId::from_u64(100 + i), c.alice, &[])).expect("an entry");
    }
    agrees(&c.log);
    // the iPhone's copy goes away and writes on its own, so its edits arrive late and out of their order
    let mut phone = c.log.clone();
    let mut late = vec![];
    for n in 0..20 {
        let edit = write(&phone, EntryId::from_u64(100 + n as u64 % 3), n);
        phone.receive([edit.clone()]);
        late.push(edit);
    }
    for n in 0..30 {
        let edit = write(&c.log, EntryId::from_u64(100 + n as u64 % 6), n);
        c.log.receive([edit]);
        agrees(&c.log);
    }
    late.reverse();
    for edit in late {
        c.log.receive([edit]);
        agrees(&c.log);
    }
    // a log that lets edits go keeps its frontiers and depth as the scan finds them
    let r = replay(c.log.edits());
    let gone: HashSet<_> = c.log.ids().iter().rev().take(5).copied().collect();
    assert!(r.edits.len() > 5);
    c.log.let_go(&gone);
    agrees(&c.log);
}
