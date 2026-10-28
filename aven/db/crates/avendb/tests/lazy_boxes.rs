//! Boxes fetched later (`avendb::lazy`, `LazyBoxes.lean`): a new device takes the state from every edit but the `Keys`
//! and `Wraps` edits (L1), takes now only the boxes it opens, an entry's wraps with its history and boxes to keys it
//! can't open never (L2), and checks each box fetched later on the state of the edits before it (L3). Histories of
//! writes, moves between audiences of several shares, devices added and removed and the boxes their upkeep makes, on
//! the rules' log, at random: the state, who opens what and the edits that stand are the same with the boxes or
//! without them. And what a fresh device replays before its first view, with the mix of the owner's vault.

mod common;

use std::collections::HashSet;

use avendb::id::{EntryId, ShareId, SignerId, VaultId};
use avendb::keys::{KeyBox, KeyFam, KeyId, KeyName, Recipient};
use avendb::lazy::{boxes_under, first_sync, first_view, is_box, with_fetched};
use avendb::policy::{
    mk_audience, replay, Action, Edit, Level, Proposal, Replay, Revoking, Sharing, State, Who, Wrap,
};
use avendb::slice::{Atom, Selector, Sym};
use avendb::wire::Wire;
use common::*;

/// A sealed box's bytes, an X-Wing share and a McEliece share beside the key it seals (`keys::seal`), and a wrapped
/// one's (`keys::wrap`): about what each weighs on the wire.
const SEALED: usize = 1120 + 208 + 32 + 16 + 24 + 2;
const WRAPPED: usize = 32 + 16 + 24 + 2;

/// A small deterministic generator, so a failing history replays exactly.
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

/// How many of each kind of edit a history should have, about: per content write, `keys` boxes, `wraps` and moves.
#[derive(Clone, Copy)]
struct Mix {
    writes: usize,
    keys_per_write: f64,
    wraps_per_move: usize,
    moves_per_write: f64,
}

/// The owner's vault: keys 44k, wraps 54k, marks 20k, writes 7k.
const OWNERS: Mix = Mix { writes: 70, keys_per_write: 44.0 / 7.0, wraps_per_move: 3, moves_per_write: 20.0 / 7.0 };

/// A box of key `name` to the key `t` of the schedule: sealed to a signer or a seed, wrapped under any other key.
fn key_box(t: KeyName) -> KeyBox {
    match t {
        KeyName::Signer(s) => KeyBox { to: Recipient::Signer(s), bytes: vec![7; SEALED].into() },
        KeyName::Scoped(KeyFam::Seed(_), _) => {
            KeyBox { to: Recipient::Key { name: t, id: KeyId([1; 32]) }, bytes: vec![7; SEALED].into() }
        }
        _ => KeyBox { to: Recipient::Key { name: t, id: KeyId([1; 32]) }, bytes: vec![7; WRAPPED].into() },
    }
}

/// Device `d`'s upkeep, as `Lab`'s makes it: for each family it may open, its current key boxed for every target, and
/// each older key under the next epoch's. Each a `Keys` edit; `limit` of them at most.
fn upkeep(st: &State, d: SignerId, limit: usize) -> Vec<Action> {
    let mut out = vec![];
    for k in st.key_fams().into_iter().filter(|&k| st.entitled(d, k)) {
        let name = st.current(k);
        let boxes: Vec<KeyBox> = st.targets(k).into_iter().filter(|&t| st.sealed(name, t)).map(key_box).collect();
        if !boxes.is_empty() {
            out.push(Action::Keys { name, id: KeyId([0; 32]), public: None, boxes, clear: None });
        }
        for x in 0..st.epoch(k) {
            let (old, next) = (KeyName::Scoped(k, x), KeyName::Scoped(k, x + 1));
            if st.sealed(old, next) {
                out.push(Action::Keys { name: old, id: KeyId([0; 32]), public: None, boxes: vec![key_box(next)], clear: None });
            }
        }
    }
    out.truncate(limit);
    out
}

/// The wraps a move leaves of entry `e`: each key of an earlier stay under the key the schedule links it to now.
fn wraps(st: &State, e: EntryId) -> Option<Action> {
    let en = st.entry(e)?;
    let stay = en.stay();
    let ws: Vec<Wrap> = st
        .seals()
        .iter()
        .filter(|s| matches!(s.secret, KeyName::Entry(x, s0, _) if x == e && s0 != stay))
        .filter(|s| matches!(s.to, KeyName::Entry(x, s1, _) if x == e && s1 == stay))
        .map(|s| Wrap {
            name: s.secret,
            id: KeyId([2; 32]),
            boxed: KeyBox { to: Recipient::Key { name: s.to, id: KeyId([3; 32]) }, bytes: vec![7; WRAPPED].into() },
        })
        .collect();
    (!ws.is_empty()).then_some(Action::Wraps { entry: e, wraps: ws })
}

/// A write of entry `e` by `by`, under its stay and epoch now.
fn write(st: &State, e: EntryId, n: u64) -> Action {
    let en = st.entry(e).expect("an entry");
    let epoch = st.epoch(KeyFam::Audience(en.vault, en.audience()));
    let (vault, actor, stay) = (en.vault, en.vault, en.stay());
    Action::Write {
        vault,
        entry: e,
        actor,
        stay,
        epoch,
        deps: vec![],
        proposal: Proposal::Main,
        via: vec![],
        create: None,
        files: vec![],
        body: vec![n as u8; 600].into(),
    }
}

/// A history: Alice with her Mac, iPhone and more devices, notes shared with Bob and with Carol by selectors that
/// overlap, written, moved between the audiences of one, the other, both or none, devices removed and added, and the
/// boxes their upkeep makes, in about the proportions of `mix`. The fresh device it ends with is `NEW_DEVICE`.
fn history(seed: u64, mix: Mix) -> (common::Cast, VaultId, Vec<SignerId>) {
    let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
    let mut c = cast();
    let alice = c.alice;
    let notes = Selector::AnyOf(vec![vec![Atom::TypeIn(vec![Sym::new("note")])]]);
    let plans = Selector::AnyOf(vec![vec![Atom::TypeIn(vec![Sym::new("note"), Sym::new("plan")])]]);
    let bobs: ShareId = c.issue(MAC_A, &[], alice, Who::Vault(c.bob), Level::Read, notes).expect("Bob's share");
    let carols: ShareId = c.issue(MAC_A, &[], alice, Who::Vault(c.carol), Level::Write, plans).expect("Carol's share");
    let audiences = [vec![], mk_audience(&[bobs]), mk_audience(&[carols]), mk_audience(&[bobs, carols])];
    let mut devices = vec![MAC_A, PHONE_A];
    let mut next_device = 100u64;
    for _ in 0..3 {
        let d = SignerId::from_u64(next_device);
        next_device += 1;
        c.log.append(PASSKEY_A, &[d], Action::Share(Sharing::Device { vault: alice, device: d, seal_to: None })).unwrap();
        devices.push(d);
    }
    let entries: Vec<EntryId> = (0..12).map(|i| EntryId::from_u64(1000 + i)).collect();
    for &e in &entries {
        c.create(MAC_A, alice, e, alice, &[], "note", &[]).expect("a note");
    }
    let total = (mix.writes as f64 * (1.0 + mix.moves_per_write)) as usize;
    let mut writes = 0usize;
    let mut moves = 0usize;
    let mut keys = 0usize;
    for n in 0..total as u64 {
        let st = c.log.view();
        let e = entries[rng.below(entries.len() as u64) as usize];
        let by = devices[rng.below(devices.len() as u64) as usize];
        // a move as often as the mix has them
        if (moves as f64) < (writes as f64 + 1.0) * mix.moves_per_write {
            let now = st.entry(e).expect("an entry").audience();
            let to = audiences[rng.below(audiences.len() as u64) as usize].clone();
            if avendb::id::AudienceId::of(alice, &to) == now {
                continue;
            }
            let mark = Action::Mark { vault: alice, entry: e, caps: Some(to), wants: None, keep: vec![], via: vec![] };
            if c.log.append(by, &[], mark).is_ok() {
                moves += 1;
                // each of several devices does the wraps the move leaves, as devices that hadn't heard of the
                // others' do
                for i in 0..mix.wraps_per_move {
                    let st = c.log.view();
                    let d = devices[(rng.below(devices.len() as u64) as usize + i) % devices.len()];
                    if let Some(w) = wraps(&st, e) {
                        let _ = c.log.append(d, &[], w);
                    }
                }
            }
        } else {
            c.log.append(by, &[], write(&st, e, n)).expect("a write");
            writes += 1;
        }
        // now and then a device leaves, or a new one comes
        if rng.below(40) == 0 && devices.len() > 3 {
            let gone = devices.remove(2 + rng.below(devices.len() as u64 - 2) as usize);
            let revoke = Action::Revoke(Revoking::Device { vault: alice, device: gone, keep: vec![] });
            c.log.append(PASSKEY_A, &[], revoke).expect("a device removed");
        } else if rng.below(30) == 0 {
            let d = SignerId::from_u64(next_device);
            next_device += 1;
            let add = Action::Share(Sharing::Device { vault: alice, device: d, seal_to: None });
            c.log.append(PASSKEY_A, &[d], add).expect("a device added");
            devices.push(d);
        }
        // the devices' upkeep, as many boxes as the mix has
        while (keys as f64) < (writes as f64 + 1.0) * mix.keys_per_write {
            let st = c.log.view();
            let d = devices[rng.below(devices.len() as u64) as usize];
            let made = upkeep(&st, d, 4);
            if made.is_empty() {
                break;
            }
            for a in made {
                if c.log.append(d, &[], a).is_ok() {
                    keys += 1;
                }
            }
        }
    }
    // Alice's new iPhone: added, and boxed for by her Mac
    let add = Action::Share(Sharing::Device { vault: alice, device: NEW_DEVICE, seal_to: None });
    c.log.append(PASSKEY_A, &[NEW_DEVICE], add).expect("the new device");
    let st = c.log.view();
    for a in upkeep(&st, MAC_A, usize::MAX) {
        let _ = c.log.append(MAC_A, &[], a);
    }
    devices.push(NEW_DEVICE);
    (c, alice, devices)
}

/// Of each family in use: whether a signer opens its current key, and whether it may.
type Access = Vec<(KeyFam, bool, bool)>;

/// Each signer's keys it opens, of every family in use, by the state.
fn access(st: &State, signers: &[SignerId]) -> Vec<(SignerId, Access)> {
    signers
        .iter()
        .map(|&d| {
            let opens: HashSet<KeyName> = st.opens(&[KeyName::Signer(d)]);
            let fams = st.key_fams();
            (d, fams.into_iter().map(|k| (k, opens.contains(&st.current(k)), st.entitled(d, k))).collect())
        })
        .collect()
}

fn signers() -> Vec<SignerId> {
    let mut out = vec![MAC_A, PHONE_A, MAC_B, MAC_C, MAC_D, NEW_DEVICE, STRANGER];
    out.extend((100..120).map(SignerId::from_u64));
    out
}

/// The ids that stand, but the boxes.
fn standing_but_boxes(r: &Replay, held: &[Edit]) -> Vec<avendb::id::EditId> {
    r.ids.iter().zip(r.edits(held)).zip(&r.stood).filter(|((_, e), s)| **s && !is_box(e)).map(|((id, _), _)| *id).collect()
}

#[test]
fn a_view_without_the_boxes_is_the_view_with_them() {
    for seed in 1..=12u64 {
        let mix = Mix { writes: 12, ..OWNERS };
        let (c, _, _) = history(seed, mix);
        let edits = c.log.edits();
        let boxes = edits.iter().filter(|e| is_box(e)).count();
        assert!(boxes > 0, "seed {seed}: no boxes");
        assert!(boxes_under(edits), "seed {seed}: an honest history names no box as deep as itself");
        let full = replay(edits);
        let lazy = first_view(edits);
        // L1: the same state, every key schedule and audience in it, and the same edits standing but the boxes
        assert!(lazy.state == full.state, "seed {seed}: the state differs without the boxes");
        let kept: Vec<Edit> = edits.iter().filter(|e| !is_box(e)).cloned().collect();
        assert_eq!(standing_but_boxes(&lazy, &kept), standing_but_boxes(&full, edits), "seed {seed}");
        // and every box made stood: the history is no history of refused boxes
        let stood_boxes = full.edits(edits).zip(&full.stood).filter(|(e, s)| **s && is_box(e)).count();
        assert_eq!(stood_boxes, boxes, "seed {seed}: some box was refused");
        // who opens what, and who may, by the caps: the same for every signer
        assert_eq!(access(&lazy.state, &signers()), access(&full.state, &signers()), "seed {seed}");
    }
}

#[test]
fn a_removed_device_opens_no_current_key_with_any_boxes() {
    for seed in 1..=12u64 {
        let (c, alice, devices) = history(seed, Mix { writes: 12, ..OWNERS });
        let lazy = first_view(c.log.edits());
        let st = &lazy.state;
        let removed: Vec<SignerId> = (100..120).map(SignerId::from_u64).filter(|d| !devices.contains(d)).collect();
        for d in removed.iter().copied().chain([STRANGER]) {
            let opens = st.opens(&[KeyName::Signer(d)]);
            for k in st.key_fams() {
                // L2 and T6: it opens a current key only if it may
                if opens.contains(&st.current(k)) {
                    assert!(st.entitled(d, k) || st.public_key(k), "seed {seed}: {d:?} opens {k:?}");
                }
            }
            assert!(!st.acts_for(d, alice), "seed {seed}: {d:?} still acts for Alice");
        }
    }
}

#[test]
fn boxes_fetched_later_check_as_if_they_came_first() {
    for seed in 1..=8u64 {
        let (c, _, _) = history(seed, Mix { writes: 12, ..OWNERS });
        let edits = c.log.edits();
        let full = replay(edits);
        let first = first_view(edits);
        let split = first_sync(edits, &first, NEW_DEVICE);
        let now: Vec<Edit> = split.now.iter().map(|&i| edits[i].clone()).collect();
        let later: Vec<Edit> =
            split.with_history.iter().chain(&split.never).map(|&i| edits[i].clone()).collect();
        // what it takes now gives the view (L1)
        assert!(replay(&now).state == full.state, "seed {seed}");
        // the rest, fetched later, each checked on the state before it (L3): the same boxes stand as in the replay of all
        let fetched = with_fetched(&now, &replay(&now), &later);
        assert!(fetched.same, "seed {seed}: the state moved");
        let stood_full: HashSet<_> = full.standing().into_iter().collect();
        let later_ids: HashSet<_> = later.iter().map(Edit::id).collect();
        let want: HashSet<_> = stood_full.intersection(&later_ids).copied().collect();
        assert_eq!(fetched.stood.iter().copied().collect::<HashSet<_>>(), want, "seed {seed}");
        // and the new device opens with the boxes it took now every current key it may open
        let held_boxes: HashSet<(KeyName, KeyName)> = now
            .iter()
            .flat_map(|e| e.action.key_boxes().into_iter().map(|(n, _, b)| (n, b.to.name())))
            .collect();
        let st = &full.state;
        for k in st.key_fams().into_iter().filter(|&k| st.entitled(NEW_DEVICE, k)) {
            let cur = st.current(k);
            // a path of boxes it holds, or of keys derived, from its own key to the current key
            let mut known: HashSet<KeyName> = [KeyName::Signer(NEW_DEVICE)].into_iter().collect();
            loop {
                let more: Vec<KeyName> = st
                    .seals()
                    .iter()
                    .filter(|s| known.contains(&s.to) && !known.contains(&s.secret))
                    .filter(|s| held_boxes.contains(&(s.secret, s.to)) || derived(s.secret, s.to))
                    .map(|s| s.secret)
                    .collect();
                if more.is_empty() {
                    break;
                }
                known.extend(more);
            }
            assert!(known.contains(&cur), "seed {seed}: the new device can't open {k:?} with what it took now");
        }
    }
}

/// Keys no box carries: a share's and an audience's key derived from their vault's seed, an entry's from its
/// audience's.
fn derived(secret: KeyName, to: KeyName) -> bool {
    match (secret, to) {
        (KeyName::Entry(..), KeyName::Scoped(KeyFam::Audience(..), _)) => true,
        (KeyName::Scoped(KeyFam::Share(v, _), e), KeyName::Scoped(KeyFam::Seed(w), f)) => v == w && e == f,
        (KeyName::Scoped(KeyFam::Audience(v, _), e), KeyName::Scoped(KeyFam::Seed(w), f)) => v == w && e == f,
        _ => false,
    }
}

#[test]
fn an_edit_that_names_a_box_as_deep_as_itself_sends_the_device_back_to_every_edit() {
    let (mut c, _, _) = history(3, Mix { writes: 8, ..OWNERS });
    let st = c.log.view();
    let last_box = c.log.edits().iter().rev().find(|e| is_box(e)).cloned().expect("a box");
    let e = st.entries().iter().next().expect("an entry").id;
    // a write that claims to come no later than the box it builds on: malformed, so the replay leaves it out
    let mut bad = c.log.draft_on(&st, MAC_A, &[], write(&st, e, 99));
    bad.parents.push(last_box.id());
    bad.depth = last_box.depth;
    c.log.receive([bad]);
    let edits = c.log.edits();
    assert!(!boxes_under(edits));
    let full = replay(edits);
    let first = first_view(edits);
    let later: Vec<Edit> = edits.iter().filter(|e| is_box(e)).cloned().collect();
    let held: Vec<Edit> = edits.iter().filter(|e| !is_box(e)).cloned().collect();
    let fetched = with_fetched(&held, &first, &later);
    assert!(!fetched.same, "the device must see that its view no longer holds");
    assert!(fetched.replay.state == full.state);
}

/// What a fresh device replays before its first view, with the owner's mix of edits: every edit of the vault it is
/// sent, before; every edit but the boxes, and the boxes it opens now, after.
#[test]
fn a_fresh_device_replays_a_fraction_of_the_edits_before_its_first_view() {
    let (c, _, _) = history(7, OWNERS);
    let edits = c.log.edits();
    let kind = |e: &Edit| match &e.action {
        Action::Keys { .. } => "keys",
        Action::Wraps { .. } => "wraps",
        Action::Mark { .. } => "marks",
        Action::Write { create: None, .. } => "writes",
        _ => "other",
    };
    let bytes = |es: &mut dyn Iterator<Item = &Edit>| es.map(|e| e.to_wire().len()).sum::<usize>();
    let mut mix = std::collections::BTreeMap::new();
    for e in edits {
        let m = mix.entry(kind(e)).or_insert((0usize, 0usize));
        m.0 += 1;
        m.1 += e.to_wire().len();
    }
    eprintln!("LAZY mix {mix:?}");
    // what the `keys` edits are, as `bench_keys` (avendb-net) reads them off a shelf: by the kind of key each boxes,
    // how many boxes it carries, and whether that key is current or of an older epoch
    let st = replay(edits).state;
    let mut keys = std::collections::BTreeMap::new();
    for e in edits {
        if let Action::Keys { name, boxes, .. } = &e.action {
            let current = matches!(*name, KeyName::Scoped(f, _) if st.current(f) == *name);
            let k = match *name {
                KeyName::Signer(_) => "signer",
                KeyName::Scoped(KeyFam::Seed(_), _) => "seed",
                KeyName::Scoped(KeyFam::Share(..), _) => "share",
                KeyName::Scoped(KeyFam::Audience(..), _) => "audience",
                KeyName::Entry(..) => "entry (legacy)",
            };
            let m = keys.entry((k, boxes.len().min(3), current)).or_insert((0usize, 0usize));
            m.0 += 1;
            m.1 += e.to_wire().len();
        }
    }
    for ((k, n, current), (count, b)) in &keys {
        eprintln!("LAZY keys {k} boxes={n} current={current}: {count} edits, {b} bytes");
    }
    let first = first_view(edits);
    let split = first_sync(edits, &first, NEW_DEVICE);
    let before = (edits.len(), bytes(&mut edits.iter()));
    let after = (split.now.len(), bytes(&mut split.now.iter().map(|&i| &edits[i])));
    let boxes_now = split.now.iter().filter(|&&i| is_box(&edits[i])).count();
    eprintln!(
        "LAZY before: {} edits, {} bytes; after: {} edits ({} of them boxes it opens), {} bytes; later with an \
         entry's history: {} boxes; never: {} boxes",
        before.0,
        before.1,
        after.0,
        boxes_now,
        after.1,
        split.with_history.len(),
        split.never.len()
    );
    assert!(replay(&split.now.iter().map(|&i| edits[i].clone()).collect::<Vec<_>>()).state == replay(edits).state);
    assert!(after.0 * 2 < before.0, "a first sync should replay well under half the edits");
}
