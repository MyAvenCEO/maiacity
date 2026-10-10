//! One property per Lean theorem that the rules alone decide, checked on random histories of flat vaults: random
//! signers trying random actions on top of scenarios 1 to 3 and a few entries and caps, each kept when the rules accept
//! it, then replayed in other orders; and forked histories, where devices that were offline meet with concurrent
//! changes, many of them around one entry and one device. The actions: vault governance and devices; caps over random
//! slices (a type, tags, entries, a creator, a creation time, or the whole vault) with random grantees, roles and
//! parents; revocations; entries created with a type and tags, in a cell; writes, which retag their entry when they act
//! for its vault; moves by a vault's stewards, to where an entry's meaning asks or anywhere; keys and schemas. What no
//! rule reads (a cap's selector, an entry's header, a write's tags) goes into each history's `Readings`, as the readers
//! of its caps and entries open it. The lens laws (T9) are checked on random items, as any mix of apps could have
//! stored them, read and edited through each app's view, and the proposal laws (T10) on random histories of one
//! document. Sync (T12, T13, T19) is checked between devices holding random parts of random histories, gaps and all.
//! Each property carries its theorem's name; T7 (the blind server, which follows from T5), T15 (rotation follows
//! revocation, which follows from T24), T17 and T20 are guarded by the tests the Lean README lists.

mod common;

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::LazyLock;

use common::*;
use serde_json::{json, Value};
use avendb::doc::Item;
use avendb::history::{Repo, MAIN};
use avendb::id::{BlobId, CapId, CellId, EditId, EntryId, SignerId, VaultId};
use avendb::keys::{KeyBox, KeyFam, KeyId, KeyName, Recipient};
use avendb::lens::{DocV2, View};
use avendb::policy::{
    checkpointed, mk_cell, order, removes, replay, trace, view, Action, Cap, Edit, Entry, Fact, Grantee, Holder, Issued,
    Kind, Line, Log, Principal, Proposal, Readings, Refusal, Replay, Role, State, Vault, Write,
};
use avendb::slice::{Atom, Attrs, Body, Header, Select, Selector, Slice, Sym, TagDelta};
use avendb::sync::{asks, digests, frontiers, log_of, receive, respond, respond_since, Ask, LogId};
use avendb::wire::Wire;

/// xorshift64*: small and deterministic, so a failing seed can be replayed.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    fn pick<T: Copy>(&mut self, xs: &[T]) -> T {
        xs[self.below(xs.len())]
    }

    fn shuffle<T>(&mut self, xs: &mut [T]) {
        for i in (1..xs.len()).rev() {
            xs.swap(i, self.below(i + 1));
        }
    }
}

/// One of `xs`, if there is any.
fn pick_from<'a, T>(rng: &mut Rng, xs: &'a [T]) -> Option<&'a T> {
    if xs.is_empty() { None } else { Some(&xs[rng.below(xs.len())]) }
}

const SIGNERS: [SignerId; 11] =
    [PASSKEY_A, MAC_A, PHONE_A, PASSKEY_B, MAC_B, PASSKEY_C, MAC_C, PASSKEY_D, MAC_D, NEW_DEVICE, STRANGER];
const ENTRIES: [EntryId; 9] = [WELCOME, CHARTER, ONBOARDING, DOOR, SEEDS, SOLAR, PLAN, DIARY, LAMP];
const ROLES: [Role; 4] = [Role::Relay, Role::Read, Role::Write, Role::Owner];
const TYPES: [&str; 3] = ["doc", "note", "todo"];
const TAGS: [&str; 4] = ["work", "home", "garden", "door"];
const BLOBS: [&[u8]; 3] = [b"a schema", b"its next version", b"a lens between the two"];
const RUNS: std::ops::Range<u64> = 1..41;

/// A random history: its log; the vaults it may name, some of which the log may not hold; what the readers of its caps
/// and entries open of them; and the attempts the rules refused, as their signers drafted them.
#[derive(Clone)]
struct History {
    log: Log,
    vaults: Vec<VaultId>,
    readings: Readings,
    refused: Vec<Edit>,
    /// How many of the log's edits every history of its kind starts with.
    start: usize,
}

impl History {
    /// What `fork`, which went its own way from this history's start, adds to it: its edits, its vaults, what its
    /// readers open and the attempts it refused.
    fn meet(&mut self, fork: History) {
        self.log.receive(fork.log.edits().iter().cloned());
        self.vaults = fork.vaults;
        self.readings.selectors.extend(fork.readings.selectors);
        self.readings.headers.extend(fork.readings.headers);
        self.readings.tags.extend(fork.readings.tags);
        self.refused.extend(fork.refused);
    }
}

/// What every random history of caps and writes starts with: scenarios 1 to 3; Alice's todos, the door (tagged work)
/// and the seeds (tagged home), and the coop's documents, the welcome and the charter (tagged work); Bob writing
/// Alice's work todos, Carol reading her todos, Dave writing the coop's documents, and Carol holding a wide owner cap
/// over the coop, which both its owners approved; and every entry where its vault's stewards would move it.
fn start() -> History {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let (alice, bob, carol, dave) = (c.alice, c.bob, c.carol, c.dave);
    c.create(MAC_A, alice, DOOR, alice, &[], "todo", &["work"]).unwrap();
    c.create(PHONE_A, alice, SEEDS, alice, &[], "todo", &["home"]).unwrap();
    c.create(MAC_A, coop, WELCOME, coop, &[], "doc", &[]).unwrap();
    c.create(MAC_B, coop, CHARTER, coop, &[], "doc", &["work"]).unwrap();
    c.issue(MAC_A, &[], alice, vault(bob), Role::Write, tagged("todo", "work")).unwrap();
    c.issue(MAC_A, &[], alice, vault(carol), Role::Read, of_type("todo")).unwrap();
    c.issue(MAC_B, &[], coop, vault(dave), Role::Write, of_type("doc")).unwrap();
    c.issue(PASSKEY_A, &[PASSKEY_B], coop, vault(carol), Role::Owner, Selector::All).unwrap();
    c.tidy(MAC_A);
    let start = c.log.edits().len();
    History { log: c.log, vaults: vec![alice, bob, carol, dave, coop], readings: c.readings, refused: vec![], start }
}

static START: LazyLock<History> = LazyLock::new(start);

/// A random history on top of the start, all on one device: `n` attempts, each kept if the rules accept it.
fn history(seed: u64, n: usize) -> History {
    let mut h = START.clone();
    let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
    attempts(&mut rng, &mut h, n, None, None);
    h
}

/// Three devices take one random history offline, each adds its own random attempts, half of them clashing, and then
/// all the edits meet: writes, caps, retags and moves made concurrently with revocations and removals that hadn't seen
/// them, and moves of one entry by two stewards, most around one entry and one device all three contend for (`Hot`).
/// Each device's edits keep to a lane of depths of their own (`attempts`), so no two of them sort by their ids.
fn forked(seed: u64, n: usize) -> History {
    let base = history(seed, n / 2);
    let mut rng = Rng(seed.wrapping_mul(0x2545_f491_4f6c_dd1d) | 1);
    let hot = hot(&mut rng, &base);
    let mut out = base.clone();
    for k in 0..3 {
        let mut fork = History { vaults: out.vaults.clone(), refused: vec![], ..base.clone() };
        attempts(&mut rng, &mut fork, n / 2, Some(hot), Some(k));
        out.meet(fork);
    }
    out
}

/// What the devices of a forked history contend for: an entry, which some write through a cap while others move it
/// anywhere, and a device that acts for the entry's vault, which signs those moves while others remove it.
#[derive(Clone, Copy)]
struct Hot {
    entry: Option<EntryId>,
    device: Option<SignerId>,
}

/// An entry of `h` that a vault besides its own may write, if there is one, and a device that acts for its vault.
fn hot(rng: &mut Rng, h: &History) -> Hot {
    let st = h.log.view();
    let shared = |en: &&Entry| h.vaults.iter().any(|&v| v != en.vault && st.may_write(v, en.id));
    let ens: Vec<&Entry> = st.entries().iter().filter(shared).collect();
    let Some(en) = pick_from(rng, &ens).copied().or_else(|| pick_from(rng, st.entries())) else {
        return Hot { entry: None, device: None };
    };
    let device = |s: &SignerId| st.acts_for(*s, en.vault) && st.vaults().iter().any(|v| v.devices.contains(s));
    let devices: Vec<SignerId> = SIGNERS.into_iter().filter(device).collect();
    Hot { entry: Some(en.id), device: pick_from(rng, &devices).copied() }
}

/// An attempt: who signs what, and what the readers of the edit open of it.
struct Attempt {
    author: SignerId,
    cosigners: Vec<SignerId>,
    action: Action,
    said: Said,
}

/// What the readers of an edit open of it and no rule reads: a cap's selector, a new entry's header and first tags,
/// the tags a write adds and removes.
enum Said {
    Nothing,
    Selector(Selector),
    Created(Header, TagDelta),
    Tags(TagDelta),
}

/// `n` random attempts on `h`'s log, each kept if the rules accept it, what its readers open of it going into
/// `h.readings`; new vaults join `h.vaults`, and attempts the rules refuse go to `h.refused`. With `clash`, half of
/// them are what clashes when made concurrently (`clashing`), around what it names. In lane `k`, the j-th edit kept
/// goes 3j + k + 1 deeper than the deepest edit the log held: a device in another lane never puts one at the same
/// depth.
fn attempts(rng: &mut Rng, h: &mut History, n: usize, clash: Option<Hot>, lane: Option<u64>) {
    let deepest = h.log.edits().iter().map(|o| o.depth).max().unwrap_or(0);
    let mut kept = 0;
    for _ in 0..n {
        let st = h.log.view();
        let tried = match clash {
            Some(hot) if rng.below(2) == 0 => clashing(rng, h, &st, hot),
            _ => any_attempt(rng, h, &st),
        };
        let Some(a) = tried else { continue };
        if keep(h, &st, a, lane.map(|k| deepest + 3 * kept + k + 1)) {
            kept += 1;
        }
    }
}

/// Draft attempt `a` on `h`'s log, whose view is `st`, at depth `depth` if given, and keep it if the rules accept it.
fn keep(h: &mut History, st: &State, a: Attempt, depth: Option<u64>) -> bool {
    let genesis = matches!(a.action, Action::Genesis { .. });
    let mut edit = h.log.draft_on(st, a.author, &a.cosigners, a.action);
    if let Some(depth) = depth {
        edit.depth = depth;
    }
    let id = edit.id();
    if st.accepts(&edit, id).is_err() {
        h.refused.push(edit);
        return false;
    }
    h.log.receive([edit]);
    match a.said {
        Said::Nothing => {}
        Said::Selector(s) => {
            h.readings.selectors.insert(CapId::from(id), s);
        }
        Said::Created(header, tags) => {
            h.readings.headers.insert(id, header);
            h.readings.tags.insert(id, tags);
        }
        Said::Tags(tags) => {
            h.readings.tags.insert(id, tags);
        }
    }
    if genesis {
        h.vaults.push(VaultId::from(id));
    }
    true
}

/// One random attempt: a write, a new entry, a cap, a revocation, a move, a vault edit, a key or a schema. An act for a
/// vault names, a time in eight, a random chain of one or two vaults to go through; otherwise the chain its author acts
/// through, as the log drafts it.
fn any_attempt(rng: &mut Rng, h: &History, st: &State) -> Option<Attempt> {
    let mut a = match rng.below(20) {
        0..=3 => a_write(rng, h, st),
        4..=6 => Some(a_creation(rng, h, st)),
        7..=9 => Some(a_cap(rng, h, st)),
        10 => a_revocation(rng, h, st),
        11 | 12 => a_move(rng, h, st),
        13..=16 => {
            let (author, cosigners) = signers(rng);
            Some(Attempt { author, cosigners, action: vault_action(rng, &h.vaults), said: Said::Nothing })
        }
        17 => some_keys(rng, st),
        _ => Some(a_publish(rng, h, st)),
    }?;
    if rng.below(8) == 0 {
        let chain: Vec<VaultId> = (0..1 + rng.below(2)).map(|_| rng.pick(&h.vaults)).collect();
        match &mut a.action {
            Action::Cap(_, via)
            | Action::Revoke { via, .. }
            | Action::Write { via, .. }
            | Action::Move { via, .. }
            | Action::Publish { via, .. } => *via = chain,
            _ => {}
        }
    }
    Some(a)
}

/// What clashes when made concurrently: a write by a vault that may write its entry; a retag of an entry by its own
/// vault, which changes where its stewards would move it; a steward's move of an entry to where its meaning asks; a
/// revocation of a live cap by its issuer; a device removed; a change to the owners or the threshold of a vault. Half
/// the writes, moves and removals of devices are of what the devices contend for (`Hot`): the hot entry written by
/// another vault than its own, moved anywhere by the hot device, and the hot device removed.
fn clashing(rng: &mut Rng, h: &History, st: &State, hot: Hot) -> Option<Attempt> {
    let ens = st.entries();
    let a = match rng.below(6) {
        0 => {
            let mut writers: Vec<(&Entry, VaultId)> = vec![];
            for en in ens {
                writers.extend(h.vaults.iter().filter(|&&v| st.may_write(v, en.id)).map(|&v| (en, v)));
            }
            if hot.entry.is_some() && rng.below(2) == 0 {
                writers.retain(|&(en, v)| Some(en.id) == hot.entry && v != en.vault);
            }
            let &(en, actor) = pick_from(rng, &writers)?;
            written(rng, st, en, actor)
        }
        1 => {
            let en = pick_from(rng, ens)?;
            let mut a = written(rng, st, en, en.vault);
            let (add, remove) = (vec![Sym::new(rng.pick(&TAGS))], vec![Sym::new(rng.pick(&TAGS))]);
            a.said = Said::Tags(TagDelta { add, remove });
            a
        }
        2 if hot.entry.is_some_and(|e| st.entry(e).is_some()) && rng.below(2) == 0 => {
            let en = st.entry(hot.entry?)?;
            let (vault, entry, to) = (en.vault, en.id, random_cell(rng, st, en.vault));
            let action = Action::Move { vault, entry, to, keep: vec![], via: vec![] };
            let author = hot.device.unwrap_or_else(|| author_for(rng, st, vault));
            Attempt { author, cosigners: vec![], action, said: Said::Nothing }
        }
        2 => {
            let desired = |en: &Entry| Some((en.vault, en.id, st.meaning(en.id, &h.readings)?.desired?));
            let moving: Vec<(VaultId, EntryId, Vec<CapId>)> = ens.iter().filter_map(desired).collect();
            let (vault, entry, to) = pick_from(rng, &moving)?.clone();
            let action = Action::Move { vault, entry, to, keep: vec![], via: vec![] };
            Attempt { author: author_for(rng, st, vault), cosigners: vec![], action, said: Said::Nothing }
        }
        3 => {
            let live: Vec<&Issued> = st.caps().iter().filter(|cp| st.live(cp.id)).collect();
            let cp = *pick_from(rng, &live)?;
            let (author, cosigners) = signers_for(rng, st, cp.cap.issuer, cp.cap.role == Role::Owner);
            let action = Action::Revoke { cap: cp.id, actor: cp.cap.issuer, keep: vec![], via: vec![] };
            Attempt { author, cosigners, action, said: Said::Nothing }
        }
        4 => {
            let mut devices: Vec<(VaultId, SignerId)> =
                st.vaults().iter().flat_map(|v| v.devices.iter().map(move |&d| (v.id, d))).collect();
            if hot.device.is_some() && rng.below(2) == 0 {
                devices.retain(|&(_, d)| Some(d) == hot.device);
            }
            let &(vault, device) = pick_from(rng, &devices)?;
            let (author, cosigners) = signers(rng);
            let action = Action::RemoveDevice { vault, device, keep: vec![] };
            Attempt { author, cosigners, action, said: Said::Nothing }
        }
        _ => {
            let (author, cosigners) = signers(rng);
            Attempt { author, cosigners, action: governance_action(rng, st, &h.vaults), said: Said::Nothing }
        }
    };
    Some(a)
}

/// A signer that acts for vault `v`, three times in four if there is one; otherwise any signer.
fn author_for(rng: &mut Rng, st: &State, v: VaultId) -> SignerId {
    let acting: Vec<SignerId> = SIGNERS.into_iter().filter(|&s| st.acts_for(s, v)).collect();
    if acting.is_empty() || rng.below(4) == 0 { rng.pick(&SIGNERS) } else { rng.pick(&acting) }
}

/// Who signs an act for vault `v`: a signer that most often acts for it; when the act needs `v`'s approval (`approve`),
/// half the time with every passkey cosigning, otherwise with up to two random cosigners.
fn signers_for(rng: &mut Rng, st: &State, v: VaultId, approve: bool) -> (SignerId, Vec<SignerId>) {
    let author = author_for(rng, st, v);
    if !approve {
        return (author, vec![]);
    }
    if rng.below(2) == 0 {
        return (author, vec![PASSKEY_A, PASSKEY_B, PASSKEY_C, PASSKEY_D]);
    }
    (author, (0..rng.below(3)).map(|_| rng.pick(&SIGNERS)).collect())
}

/// Who signs a vault edit: half the time every passkey and one random signer, so that approvals pass and the rules'
/// other checks decide; otherwise up to four random signers.
fn signers(rng: &mut Rng) -> (SignerId, Vec<SignerId>) {
    if rng.below(2) == 0 {
        (PASSKEY_A, vec![PASSKEY_B, PASSKEY_C, PASSKEY_D, rng.pick(&SIGNERS)])
    } else {
        (rng.pick(&SIGNERS), (0..rng.below(4)).map(|_| rng.pick(&SIGNERS)).collect())
    }
}

/// The vault cap `cp` names, if it names one.
fn grantee_vault(cp: &Issued) -> Option<VaultId> {
    match cp.cap.grantee {
        Grantee::Principal(Principal::Vault(g)) => Some(g),
        _ => None,
    }
}

/// Up to two random tags.
fn some_syms(rng: &mut Rng) -> Vec<Sym> {
    (0..rng.below(3)).map(|_| Sym::new(rng.pick(&TAGS))).collect()
}

/// Up to two tags added and one removed.
fn some_tags(rng: &mut Rng) -> TagDelta {
    let add = some_syms(rng);
    TagDelta { add, remove: (0..rng.below(2)).map(|_| Sym::new(rng.pick(&TAGS))).collect() }
}

/// A write of entry `en` for `actor`, under its current stay and its cell's current generation, adding and removing
/// random tags, by a signer that most often acts for `actor`.
fn written(rng: &mut Rng, st: &State, en: &Entry, actor: VaultId) -> Attempt {
    let generation = st.epoch(KeyFam::Cell(en.vault, en.cell()));
    let action = write(en.vault, en.id, actor, en.stay(), generation);
    Attempt { author: author_for(rng, st, actor), cosigners: vec![], action, said: Said::Tags(some_tags(rng)) }
}

/// A write of an entry the log holds, now and then of one it doesn't or for another vault than the entry's: for the
/// entry's vault, a vault holding a live write cap that reaches it, or any vault; mostly under the entry's current stay
/// and its cell's current generation, on its main line, now and then under an earlier stay or a generation the cell
/// hasn't reached, or starting a proposal or on one the entry has.
fn a_write(rng: &mut Rng, h: &History, st: &State) -> Option<Attempt> {
    let Some(en) = pick_from(rng, st.entries()).filter(|_| rng.below(8) > 0) else {
        let action = write(rng.pick(&h.vaults), rng.pick(&ENTRIES), rng.pick(&h.vaults), None, 0);
        let (author, said) = (rng.pick(&SIGNERS), Said::Tags(some_tags(rng)));
        return Some(Attempt { author, cosigners: vec![], action, said });
    };
    let cell = st.cell_caps(en.cell()).unwrap_or_default();
    let reaches = |cp: &&Issued| {
        st.live(cp.id) && cp.cap.role.allows(Role::Write) && (cp.cap.wide || cell.contains(&cp.id))
    };
    let writers: Vec<VaultId> = st.caps_over(en.vault).filter(reaches).filter_map(grantee_vault).collect();
    let actor = match rng.below(4) {
        0 | 1 => en.vault,
        2 => pick_from(rng, &writers).copied().unwrap_or(en.vault),
        _ => rng.pick(&h.vaults),
    };
    let vault = if rng.below(16) == 0 { rng.pick(&h.vaults) } else { en.vault };
    let stay = if rng.below(6) > 0 { en.stay() } else { rng.pick(&en.stays).0 };
    let x = en.stay_cell(stay).expect("a stay of the entry");
    let generation = st.epoch(KeyFam::Cell(en.vault, x)) + u64::from(rng.below(10) == 0);
    let starts: Vec<EditId> = st.lines(en.id).into_iter().flatten().collect();
    let proposal = match rng.below(8) {
        0 => Proposal::New,
        1 => pick_from(rng, &starts).map_or(Proposal::Main, |&b| Proposal::On(b)),
        _ => Proposal::Main,
    };
    let (entry, deps, via, create, body) = (en.id, vec![], vec![], None, vec![rng.next() as u8]);
    let action = Action::Write { vault, entry, actor, stay, generation, deps, proposal, via, create, body };
    Some(Attempt { author: author_for(rng, st, actor), cosigners: vec![], action, said: Said::Tags(some_tags(rng)) })
}

/// The cell an entry of vault `v` with attributes `a` belongs in by the selectors `r` holds: the live caps over `v`
/// that aren't wide and select it, in canonical order.
fn semantic_cell(st: &State, r: &Readings, v: VaultId, a: &Attrs) -> Vec<CapId> {
    let selects = |cp: &&Issued| st.live(cp.id) && !cp.cap.wide && st.eff_selects(cp, a, r);
    mk_cell(&st.caps_over(v).filter(selects).map(|cp| cp.id).collect::<Vec<_>>())
}

/// Up to two of the caps over vault `v` that aren't wide, live or not, in canonical order; now and then with any cap
/// besides, which makes no cell of `v`.
fn random_cell(rng: &mut Rng, st: &State, v: VaultId) -> Vec<CapId> {
    let narrow: Vec<CapId> = st.caps_over(v).filter(|cp| !cp.cap.wide).map(|cp| cp.id).collect();
    let mut cell: Vec<CapId> = match narrow.is_empty() {
        true => vec![],
        false => (0..rng.below(3)).map(|_| rng.pick(&narrow)).collect(),
    };
    if rng.below(10) == 0
        && let Some(cp) = pick_from(rng, st.caps())
    {
        cell.push(cp.id);
    }
    mk_cell(&cell)
}

/// A new entry of a random vault, under an id the log may have used already, of a random type, time and tags: made by
/// the vault itself, in the cell its meaning asks for, the empty cell or a random one; or by a vault holding a live
/// write cap over it, in the cap's intake cell, now and then in a random one. It takes the generation its cell moves
/// to if it brings the cell back into use.
fn a_creation(rng: &mut Rng, h: &History, st: &State) -> Attempt {
    let unborn: Vec<EntryId> = ENTRIES.into_iter().filter(|&e| !st.born(e)).collect();
    let entry = if unborn.is_empty() || rng.below(6) == 0 { rng.pick(&ENTRIES) } else { rng.pick(&unborn) };
    let vault = rng.pick(&h.vaults);
    let header = Header { ty: Sym::new(rng.pick(&TYPES)), created: rng.below(4) as u64 };
    let tags = TagDelta { add: some_syms(rng), remove: vec![] };
    let holds = |cp: &&Issued| st.live(cp.id) && cp.cap.role.allows(Role::Write) && grantee_vault(cp).is_some();
    let through: Vec<&Issued> = st.caps_over(vault).filter(holds).collect();
    let (actor, cell) = match pick_from(rng, &through).filter(|_| rng.below(2) == 0) {
        Some(cp) => {
            let cell = if rng.below(6) > 0 { cp.intake.to_vec() } else { random_cell(rng, st, vault) };
            (grantee_vault(cp).expect("a cap to a vault"), cell)
        }
        None => {
            let (ty, created, tags) = (header.ty.clone(), header.created, tags.apply(&[]));
            let attrs = Attrs { ty, author: vault, entry, created, tags };
            let cell = match rng.below(4) {
                0 | 1 => semantic_cell(st, &h.readings, vault, &attrs),
                2 => vec![],
                _ => random_cell(rng, st, vault),
            };
            (vault, cell)
        }
    };
    let x = CellId::of(vault, &cell);
    let generation = st.epoch(KeyFam::Cell(vault, x)) + u64::from(st.reenters(vault, x));
    let (stay, deps, proposal, via, body) = (None, vec![], Proposal::Main, vec![], vec![rng.next() as u8]);
    let action =
        Action::Write { vault, entry, actor, stay, generation, deps, proposal, via, create: Some(cell), body };
    Attempt { author: author_for(rng, st, actor), cosigners: vec![], action, said: Said::Created(header, tags) }
}

/// A random selector: one or two conjunctions of one or two tests of an entry's type, tags, id, creator or creation
/// time.
fn a_selector(rng: &mut Rng, h: &History) -> Selector {
    let mut any = vec![];
    for _ in 0..1 + rng.below(2) {
        let mut all = vec![];
        for _ in 0..1 + rng.below(2) {
            all.push(match rng.below(7) {
                0 => Atom::TypeIn(vec![Sym::new(rng.pick(&TYPES))]),
                1 => Atom::TagHas(Sym::new(rng.pick(&TAGS))),
                2 => Atom::TagNone(vec![Sym::new(rng.pick(&TAGS))]),
                3 => Atom::TagsWithin(vec![Sym::new(rng.pick(&TAGS)), Sym::new(rng.pick(&TAGS))]),
                4 => Atom::EntryIn(vec![rng.pick(&ENTRIES), rng.pick(&ENTRIES)]),
                5 => Atom::AuthorIn(vec![rng.pick(&h.vaults)]),
                _ => {
                    let from = rng.below(3) as u64;
                    Atom::CreatedIn(from, from + 1 + rng.below(3) as u64)
                }
            });
        }
        any.push(all);
    }
    Selector::AnyOf(any)
}

/// A cap to a random grantee (a vault, now and then a signer or everyone) with a random role, on a random slice or the
/// whole vault: resting on a live owner cap and issued by that cap's grantee; or a root cap issued by the vault it is
/// over, now and then by another; or now and then resting on any cap. A few caps select every entry without being
/// wide. Its selector travels in the clear.
fn a_cap(rng: &mut Rng, h: &History, st: &State) -> Attempt {
    let owners: Vec<&Issued> = st.caps().iter().filter(|cp| cp.cap.role == Role::Owner && st.live(cp.id)).collect();
    let (over, parent, issuer) = match rng.below(4) {
        0 if !owners.is_empty() => {
            let p = owners[rng.below(owners.len())];
            (p.cap.over, Some(p.id), grantee_vault(p).unwrap_or(p.cap.over))
        }
        1 if !st.caps().is_empty() && rng.below(3) == 0 => {
            let p = st.caps()[rng.below(st.caps().len())].id;
            (rng.pick(&h.vaults), Some(p), rng.pick(&h.vaults))
        }
        _ => {
            let over = rng.pick(&h.vaults);
            (over, None, if rng.below(8) == 0 { rng.pick(&h.vaults) } else { over })
        }
    };
    let grantee = match rng.below(10) {
        0 => Grantee::Public,
        1 => Grantee::Principal(Principal::Signer(rng.pick(&SIGNERS))),
        _ => vault(rng.pick(&h.vaults)),
    };
    let role = if grantee == Grantee::Public && rng.below(2) == 0 { Role::Read } else { rng.pick(&ROLES) };
    let select = if rng.below(4) == 0 { Selector::All } else { a_selector(rng, h) };
    let wide = select == Selector::All && rng.below(6) > 0;
    let bytes = Select::Clear(Slice::of(select.clone())).to_wire();
    let cap = Cap { over, grantee, role, wide, select: bytes, parent, issuer, nonce: rng.next() };
    let (author, cosigners) = signers_for(rng, st, issuer, role == Role::Owner);
    Attempt { author, cosigners, action: Action::Cap(cap, vec![]), said: Said::Selector(select) }
}

/// A revocation of a random cap, live or not, by its issuer, the vault it is over, its grantee or any vault.
fn a_revocation(rng: &mut Rng, h: &History, st: &State) -> Option<Attempt> {
    let cp = pick_from(rng, st.caps())?;
    let actor = match rng.below(4) {
        0 => cp.cap.issuer,
        1 => cp.cap.over,
        2 => grantee_vault(cp).unwrap_or(cp.cap.over),
        _ => rng.pick(&h.vaults),
    };
    let (author, cosigners) = signers_for(rng, st, actor, cp.cap.role == Role::Owner);
    let action = Action::Revoke { cap: cp.id, actor, keep: vec![], via: vec![] };
    Some(Attempt { author, cosigners, action, said: Said::Nothing })
}

/// A steward of an entry's vault moves it to the cell its meaning asks for, if any, two times in three; otherwise to a
/// random cell, which may be the one it is in; now and then for another vault than the entry's.
fn a_move(rng: &mut Rng, h: &History, st: &State) -> Option<Attempt> {
    let en = pick_from(rng, st.entries())?;
    let to = match st.meaning(en.id, &h.readings).and_then(|m| m.desired) {
        Some(to) if rng.below(3) > 0 => to,
        _ => random_cell(rng, st, en.vault),
    };
    let vault = if rng.below(10) == 0 { rng.pick(&h.vaults) } else { en.vault };
    let action = Action::Move { vault, entry: en.id, to, keep: vec![], via: vec![] };
    Some(Attempt { author: author_for(rng, st, en.vault), cosigners: vec![], action, said: Said::Nothing })
}

/// A key of the schedule announced with no boxes: a family's current key, or an entry's in its current stay; by a
/// signer that most often acts for the key's vault.
fn some_keys(rng: &mut Rng, st: &State) -> Option<Attempt> {
    let name = match pick_from(rng, st.entries()).filter(|_| rng.below(2) == 0) {
        Some(en) => st.entry_key(en.id)?,
        None => {
            let fams = st.key_fams();
            let k = *pick_from(rng, &fams)?;
            KeyName::Scoped(k, st.epoch(k))
        }
    };
    let v = match name {
        KeyName::Scoped(k, _) => k.vault(),
        KeyName::Entry(e, ..) => st.entry(e)?.vault,
        KeyName::Signer(_) => return None,
    };
    let id = KeyId(BlobId::of(&rng.next().to_be_bytes()).0);
    let action = Action::Keys { name, id, public: None, boxes: vec![], clear: None };
    Some(Attempt { author: author_for(rng, st, v), cosigners: vec![], action, said: Said::Nothing })
}

/// A schema or a lens published into a random vault's lane, for the vault or for any vault.
fn a_publish(rng: &mut Rng, h: &History, st: &State) -> Attempt {
    let vault = rng.pick(&h.vaults);
    let actor = if rng.below(2) == 0 { vault } else { rng.pick(&h.vaults) };
    let action = Action::Publish { vault, actor, via: vec![], blob: rng.pick(&BLOBS).to_vec() };
    Attempt { author: author_for(rng, st, actor), cosigners: vec![], action, said: Said::Nothing }
}

/// A random vault edit on `vaults`.
fn vault_action(rng: &mut Rng, vaults: &[VaultId]) -> Action {
    let principal = |rng: &mut Rng| {
        if rng.below(2) == 0 { Principal::Signer(rng.pick(&SIGNERS)) } else { Principal::Vault(rng.pick(vaults)) }
    };
    match rng.below(8) {
        0 => Action::AddDevice { vault: rng.pick(vaults), device: rng.pick(&SIGNERS), seal_to: None },
        1 => Action::RemoveDevice { vault: rng.pick(vaults), device: rng.pick(&SIGNERS), keep: vec![] },
        2 => Action::AddOwner { vault: rng.pick(vaults), owner: principal(rng), seal_to: None },
        3 => Action::RemoveOwner { vault: rng.pick(vaults), owner: principal(rng), keep: vec![] },
        4 => Action::SetThreshold { vault: rng.pick(vaults), threshold: rng.below(4) as u32 },
        5 => {
            let root = if rng.below(3) == 0 { None } else { Some(rng.pick(&SIGNERS)) };
            Action::SetRoot { vault: rng.pick(vaults), root, keep: vec![] }
        }
        _ => {
            // a third human vaults, a twelfth aven vaults
            let x = rng.next();
            let kind = match x % 12 {
                0 | 3 | 6 | 9 => Kind::Human,
                11 => Kind::Aven,
                _ => Kind::Coop,
            };
            let owner = |rng: &mut Rng| match kind {
                Kind::Human => Principal::Signer(rng.pick(&SIGNERS)),
                _ => Principal::Vault(rng.pick(vaults)),
            };
            let owners: Vec<Principal> = (0..1 + rng.below(3)).map(|_| owner(rng)).collect();
            let (threshold, nonce) = (1 + rng.below(2) as u32, rng.next());
            // half the human vaults name their first owner as their root
            let root = match owners[..] {
                [Principal::Signer(s), ..] if nonce % 2 == 0 => Some(s),
                _ => None,
            };
            Action::Genesis { kind, owners, threshold, root, nonce, seal_to: vec![] }
        }
    }
}

/// A random change to the owners or the threshold of a vault `st` holds: what clashes when made concurrently. Half the
/// owners added to a coop are coops themselves, which another device may make owners of the first one.
fn governance_action(rng: &mut Rng, st: &State, vaults: &[VaultId]) -> Action {
    let known: Vec<VaultId> = vaults.iter().copied().filter(|&v| st.vault(v).is_some()).collect();
    let coops: Vec<VaultId> = known.iter().copied().filter(|&v| st.vault(v).unwrap().kind == Kind::Coop).collect();
    let v = rng.pick(&known);
    let owners = st.vault(v).map(|x| x.owners.clone()).unwrap_or_default();
    match rng.below(3) {
        0 if coops.len() > 1 && rng.below(2) == 0 => {
            Action::AddOwner { vault: rng.pick(&coops), owner: Principal::Vault(rng.pick(&coops)), seal_to: None }
        }
        0 => Action::AddOwner { vault: v, owner: Principal::Vault(rng.pick(&known)), seal_to: None },
        1 => Action::RemoveOwner { vault: v, owner: rng.pick(&owners), keep: vec![] },
        _ => Action::SetThreshold { vault: v, threshold: 1 + rng.below(owners.len()) as u32 },
    }
}

/// `n` random vault edits on `h`'s log, each kept if the rules accept it; new vaults join `h.vaults`. With `clash`,
/// half of them change the owners or the threshold of a vault the log holds.
fn vault_attempts(rng: &mut Rng, h: &mut History, n: usize, clash: bool) {
    for _ in 0..n {
        let st = h.log.view();
        let (author, cosigners) = signers(rng);
        let action = match clash && rng.below(2) == 0 {
            true => governance_action(rng, &st, &h.vaults),
            false => vault_action(rng, &h.vaults),
        };
        keep(h, &st, Attempt { author, cosigners, action, said: Said::Nothing }, None);
    }
}

/// A random history of vault edits on top of scenarios 1 to 3, all on one device: what the rules for vaults decide.
fn vault_history(seed: u64, n: usize) -> History {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let (start, vaults) = (c.log.edits().len(), vec![c.alice, c.bob, c.carol, c.dave, coop]);
    let mut h = History { log: c.log, vaults, readings: Readings::default(), refused: vec![], start };
    let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
    vault_attempts(&mut rng, &mut h, n, false);
    h
}

/// Three devices take one random history of vault edits offline, each adds its own, and then all the edits meet:
/// concurrent governance, where two changes each fine alone may clash (two adds that close a cycle together, two owners
/// removing each other, an add signed by an owner that a concurrent removal takes out). The devices' edits share
/// depths, so their ids order them.
fn forked_vaults(seed: u64, n: usize) -> History {
    let base = vault_history(seed, n / 2);
    let mut rng = Rng(seed.wrapping_mul(0x2545_f491_4f6c_dd1d) | 1);
    let mut out = base.clone();
    for _ in 0..3 {
        let mut fork = History { vaults: out.vaults.clone(), refused: vec![], ..base.clone() };
        vault_attempts(&mut rng, &mut fork, n / 2, true);
        out.meet(fork);
    }
    out
}

/// One device's history and a forked one, made from one seed.
struct Pair {
    seed: u64,
    one: History,
    forked: History,
}

/// `make` for every seed, on every core.
fn for_every_seed(make: fn(u64) -> Pair) -> Vec<Pair> {
    let seeds: Vec<u64> = RUNS.collect();
    let cores = std::thread::available_parallelism().map_or(4, |n| n.get());
    let mut made: Vec<Pair> = std::thread::scope(|s| {
        let seeds = &seeds;
        let runs: Vec<_> = (0..cores)
            .map(|i| s.spawn(move || seeds.iter().skip(i).step_by(cores).map(|&seed| make(seed)).collect::<Vec<_>>()))
            .collect();
        runs.into_iter().flat_map(|run| run.join().expect("the histories of some seeds")).collect()
    });
    made.sort_by_key(|p| p.seed);
    made
}

/// The random histories of caps and writes the properties run on, made once for them all.
static CAPS: LazyLock<Vec<Pair>> =
    LazyLock::new(|| for_every_seed(|seed| Pair { seed, one: history(seed, 60), forked: forked(seed, 60) }));

/// The random histories of vault edits alone.
static VAULTS: LazyLock<Vec<Pair>> = LazyLock::new(|| {
    for_every_seed(|seed| Pair { seed, one: vault_history(seed, 60), forked: forked_vaults(seed, 60) })
});

/// Every history of caps and writes with its seed: those of one device, then the forked ones.
fn every_history() -> impl Iterator<Item = (u64, &'static History)> {
    CAPS.iter().map(|p| (p.seed, &p.one)).chain(CAPS.iter().map(|p| (p.seed, &p.forked)))
}

/// The forked histories of caps and writes with their seeds.
fn forked_histories() -> impl Iterator<Item = (u64, &'static History)> {
    CAPS.iter().map(|p| (p.seed, &p.forked))
}

/// Every history of vault edits alone with its seed: those of one device, then the forked ones.
fn vault_histories() -> impl Iterator<Item = (u64, &'static History)> {
    VAULTS.iter().map(|p| (p.seed, &p.one)).chain(VAULTS.iter().map(|p| (p.seed, &p.forked)))
}

/// Each edit that stands, in replay order, with the states just before and just after it. The view is the replay of
/// the edits that stand, each accepted where it stands.
fn steps(edits: &[Edit]) -> Vec<(Edit, State, State)> {
    let r = replay(edits);
    let mut st = State::default();
    let mut out = vec![];
    for ((edit, &id), _) in r.edits.iter().zip(&r.ids).zip(&r.stood).filter(|(_, stood)| **stood) {
        let mut next = st.clone();
        next.step_mut(edit, id).expect("an edit that stands is accepted where it stands");
        out.push((edit.clone(), std::mem::replace(&mut st, next.clone()), next));
    }
    assert!(st == r.state, "the view is the replay of the edits that stand");
    out
}

/// The empty state, then the state after each edit that stands, in replay order: every state along the view.
fn states(edits: &[Edit]) -> Vec<State> {
    std::iter::once(State::default()).chain(steps(edits).into_iter().map(|(_, _, after)| after)).collect()
}

#[test]
fn t1_authorized_writes() {
    // a step adds a write of an entry that exists only if, just before it, the write's author acted for its actor
    // through the owners it names, and that vault could write the entry where it was; and creates an entry only with
    // its first write, by its vault or in the intake cell of a live write cap its creator held
    let (mut through, mut created, mut by_cap) = (0, 0, 0);
    for (seed, h) in every_history() {
        for (edit, before, after) in steps(h.log.edits()) {
            for w in after.all_writes().iter().filter(|w| before.write(w.edit).is_none()) {
                assert!(before.acts_via(w.author, &w.via, w.actor), "seed {seed}: {w:?}");
                through += usize::from(!w.via.is_empty());
                let en = after.entry(w.entry).expect("a write's entry");
                if w.first {
                    let cell = after.cell_caps(en.cell()).expect("the cell it is created in");
                    assert!(before.may_create(w.actor, en.vault, cell), "seed {seed}: {w:?}");
                    created += 1;
                } else {
                    assert!(before.authorized(w) && before.may_write(w.actor, w.entry), "seed {seed}: {w:?}");
                    by_cap += usize::from(w.actor != en.vault);
                }
            }
            for en in after.entries().iter().filter(|en| before.entry(en.id).is_none()) {
                let first = after.write(edit.id()).is_some_and(|w| w.entry == en.id && w.first);
                assert!(first, "seed {seed}: {en:?} came without its first write");
            }
        }
    }
    // and some writes go through the owners they name, some create their entry, some go through a cap
    assert!(through > 0 && created > 0 && by_cap > 0, "{through} through owners, {created} created, {by_cap} by cap");
}

#[test]
fn t1_revocation_wins() {
    // a write a step takes the authorization from stays only if the step is a removal that had seen it
    let mut kept = 0;
    for (seed, h) in every_history() {
        for (edit, before, after) in steps(h.log.edits()) {
            for w in after.all_writes() {
                if before.write(w.edit).is_some() && before.authorized(w) && !after.authorized(w) {
                    let seen = edit.action.keep().is_some_and(|k| k.contains(&w.edit));
                    assert!(seen, "seed {seed}: {w:?} after {edit:?}");
                    kept += 1;
                }
            }
        }
    }
    // and removals do keep writes they had seen
    assert!(kept > 0);
}

#[test]
fn t2_consent() {
    // an owner or a device is added only with its own signature
    for (seed, h) in vault_histories().chain(every_history()) {
        for (edit, before, after) in steps(h.log.edits()) {
            let sigs: Vec<SignerId> = edit.sigs().collect();
            for b in after.vaults() {
                let Some(a) = before.vault(b.id) else { continue };
                for d in b.devices.iter().filter(|d| !a.devices.contains(d)) {
                    assert!(sigs.contains(d), "seed {seed}: device added without its signature");
                }
                for p in b.owners.iter().filter(|p| !a.owners.contains(p)) {
                    assert!(before.approves(&sigs, *p), "seed {seed}: owner added without its consent");
                }
            }
        }
    }
}

/// `xs` without the first `x` in it.
fn erase<T: Clone + PartialEq>(xs: &[T], x: &T) -> Vec<T> {
    let mut out = xs.to_vec();
    if let Some(i) = out.iter().position(|y| y == x) {
        out.remove(i);
    }
    out
}

#[test]
fn t2_governance() {
    // a step that changes a vault's owners, threshold or devices carries the vault's approval, or is an owner or a
    // device removing itself
    let mut themselves = 0;
    for (seed, h) in vault_histories().chain(every_history()) {
        for (edit, before, after) in steps(h.log.edits()) {
            let sigs: Vec<SignerId> = edit.sigs().collect();
            for b in after.vaults() {
                let Some(a) = before.vault(b.id) else { continue };
                if (&a.owners, a.threshold, &a.devices) == (&b.owners, b.threshold, &b.devices) {
                    continue;
                }
                let approved = before.approves(&sigs, Principal::Vault(b.id));
                let owner = a.owners.iter().any(|p| erase(&a.owners, p) == b.owners && before.approves(&sigs, *p));
                let device = a.devices.iter().any(|d| erase(&a.devices, d) == b.devices && sigs.contains(d));
                assert!(approved || owner || device, "seed {seed}: {edit:?}");
                themselves += usize::from(!approved);
            }
        }
    }
    // and some owners and devices do leave on their own
    assert!(themselves > 0);
}

/// T21: in every state the rules reach, each vault keeps to its kind: a human vault's owners are signers, a coop's and
/// an aven vault's are human or coop vaults; only human and aven vaults have devices, and only human vaults a root.
#[test]
fn t21_vault_kinds() {
    let mut avens = 0;
    for (seed, h) in vault_histories().chain(every_history()) {
        let sts = states(h.log.edits());
        for st in &sts {
            for v in st.vaults() {
                for p in &v.owners {
                    let fits = match (v.kind, *p) {
                        (Kind::Human, Principal::Signer(_)) => true,
                        (Kind::Coop | Kind::Aven, Principal::Vault(o)) => {
                            st.vault(o).is_some_and(|o| o.kind != Kind::Aven)
                        }
                        _ => false,
                    };
                    assert!(fits, "seed {seed}: {v:?}");
                }
                assert!(v.devices.is_empty() || v.kind.has_devices(), "seed {seed}: {v:?}");
                assert!(v.root.is_none() || v.kind == Kind::Human, "seed {seed}: {v:?}");
            }
        }
        avens += sts.last().map_or(0, |st| st.vaults().iter().filter(|v| v.kind == Kind::Aven).count());
    }
    // the histories do found aven vaults
    assert!(avens > 0);
}

/// Devices never govern: a signer that owns no vault and is no vault's root approves for no vault, whatever it acts
/// for (`devices_cannot_govern`).
#[test]
fn devices_cannot_govern() {
    for (seed, h) in vault_histories().chain(every_history()) {
        for st in states(h.log.edits()) {
            let governs =
                |s: SignerId| st.vaults().iter().any(|v| v.owners.contains(&Principal::Signer(s)) || v.root == Some(s));
            for s in SIGNERS.into_iter().filter(|&s| !governs(s)) {
                for v in st.vaults() {
                    assert!(!st.approves(&[s], Principal::Vault(v.id)), "seed {seed}: {s:?} approves for {v:?}");
                }
            }
        }
    }
}

/// Vault `x` owns itself, directly or through other vaults.
fn owns_itself(st: &State, x: VaultId) -> bool {
    let (mut stack, mut seen) = (vec![x], vec![]);
    while let Some(y) = stack.pop() {
        for p in st.vault(y).map(|v| v.owners.clone()).unwrap_or_default() {
            if let Principal::Vault(o) = p {
                if o == x {
                    return true;
                }
                if !seen.contains(&o) {
                    seen.push(o);
                    stack.push(o);
                }
            }
        }
    }
    false
}

#[test]
fn t3_no_cycles() {
    for (seed, h) in vault_histories().chain(every_history()) {
        // in every state along the way, not only the last
        for st in states(h.log.edits()) {
            assert!(h.vaults.iter().all(|&v| !owns_itself(&st, v)), "seed {seed}");
        }
    }
}

#[test]
fn t11_vault_logs_converge() {
    // the same vault edits, received in any order, give the same vaults (T11 for vaults alone)
    for p in VAULTS.iter() {
        let (seed, edits) = (p.seed, p.forked.log.edits().to_vec());
        let st = view(&edits);
        let mut rng = Rng(seed);
        for _ in 0..3 {
            let mut shuffled = edits.clone();
            rng.shuffle(&mut shuffled);
            assert!(view(&shuffled) == st, "seed {seed}");
            assert_eq!(order(&shuffled), order(&edits), "seed {seed}");
        }
    }
}

#[test]
fn forks_really_clash() {
    // the forked histories exercise concurrency: across the seeds, edits that each fork accepted are refused once all
    // the edits meet, among them adds that would close a cycle and removals of an owner already removed elsewhere
    let mut refused = vec![];
    for p in VAULTS.iter() {
        let mut st = State::default();
        for edit in order(p.forked.log.edits()) {
            match st.step(&edit) {
                Ok(next) => st = next,
                Err(why) => refused.push(why),
            }
        }
    }
    for why in [Refusal::Cycle, Refusal::LastOwner, Refusal::BelowThreshold] {
        assert!(refused.contains(&why), "no {why:?} among {refused:?}");
    }
}

#[test]
fn t4_caps_name_vaults_and_t8_public_read_only() {
    // in every state along the way, and in the view of each history with the attempts the rules refused put back, as a
    // peer that skips the rules would send them: no cap names a signer, and Public only ever reads
    let mut tried = 0;
    for (seed, h) in every_history() {
        let with_refused: Vec<Edit> = h.log.edits().iter().chain(&h.refused).cloned().collect();
        for st in states(h.log.edits()).iter().chain([&view(&with_refused)]) {
            for cp in st.caps() {
                let signer = matches!(cp.cap.grantee, Grantee::Principal(Principal::Signer(_)));
                assert!(!signer, "seed {seed}: {cp:?}");
                assert!(cp.cap.grantee != Grantee::Public || cp.cap.role == Role::Read, "seed {seed}: {cp:?}");
            }
        }
        let barred = |c: &Cap| {
            matches!(c.grantee, Grantee::Principal(Principal::Signer(_)))
                || (c.grantee == Grantee::Public && c.role != Role::Read)
        };
        tried += h.refused.iter().filter(|o| matches!(&o.action, Action::Cap(c, _) if barred(c))).count();
    }
    // and the histories do try such caps
    assert!(tried > 0);
}

#[test]
fn t11_convergence() {
    // the same edits in any order: the same view, and the same edits stand
    for (seed, h) in every_history() {
        let edits = h.log.edits().to_vec();
        let r = replay(&edits);
        let mut rng = Rng(seed);
        for _ in 0..3 {
            let mut shuffled = edits.clone();
            rng.shuffle(&mut shuffled);
            let s = replay(&shuffled);
            assert!(s.state == r.state, "seed {seed}");
            assert_eq!(s.standing(), r.standing(), "seed {seed}");
        }
    }
}

#[test]
fn t14_causally_closed() {
    // in every state along the way, every accepted write builds only on accepted writes of its own entry, which come
    // before it, and is of an entry that exists; and every entry's first write is accepted
    for (seed, h) in every_history() {
        for st in states(h.log.edits()) {
            let place: HashMap<EditId, usize> = st.all_writes().iter().enumerate().map(|(i, w)| (w.edit, i)).collect();
            for (i, w) in st.all_writes().iter().enumerate() {
                for d in &w.deps {
                    let before = st.write(*d).is_some_and(|x| x.entry == w.entry) && place[d] < i;
                    assert!(before, "seed {seed}: {w:?} builds on a write that isn't there before it");
                }
                assert!(st.entry(w.entry).is_some(), "seed {seed}: {w:?} is of no entry");
            }
            for en in st.entries() {
                assert!(st.entry_writes(en.id).any(|w| w.first), "seed {seed}: {en:?} lost its first write");
            }
        }
    }
}

/// What each removal of replay `r` takes away (`removes`), by place.
fn facts(r: &Replay) -> Vec<Vec<Fact>> {
    r.edits.iter().map(|o| if o.is_removal() { removes(&r.edits, o) } else { vec![] }).collect()
}

/// What each removal after place `i` of replay `r` that stands, and hadn't seen the edit there, takes away (`facts`).
fn hidden(r: &Replay, facts: &[Vec<Fact>], i: usize) -> Vec<Fact> {
    let unseen = |j: &usize| r.stood[*j] && r.edits[*j].action.keep().is_some_and(|k| !k.contains(&r.ids[i]));
    (i + 1..r.edits.len()).filter(unseen).flat_map(|j| facts[j].iter().cloned()).collect()
}

#[test]
fn t16_strong_removal() {
    // an edit stands only if the state just before it accepts it with what each removal after it that stands, and
    // hadn't seen it, takes away hidden: an owner, a device, a root, a cap and those resting on it, or for a move the
    // cell it put the entry in
    let mut cut = 0;
    for (seed, h) in forked_histories() {
        let edits = h.log.edits();
        let (r, sts) = (replay(edits), trace(edits));
        let facts = facts(&r);
        for (i, x) in r.edits.iter().enumerate() {
            if r.stood[i] {
                let hidden = hidden(&r, &facts, i);
                assert!(sts[i].hide(&hidden).accepts(x, r.ids[i]).is_ok(), "seed {seed}: {x:?} stands on what was cut");
            } else if !x.is_removal() && sts[i].accepts(x, r.ids[i]).is_ok() {
                cut += 1;
            }
        }
    }
    // and the forks do clash: some edits the state just before them accepts are cut
    assert!(cut > 0);
}

#[test]
fn t16_resolved_removals_stand() {
    // and only removals that stand cut: an edit that the state just before it accepts but that doesn't stand is
    // refused there with what the removals after it that stand, and hadn't seen it, take away hidden
    for (seed, h) in forked_histories() {
        let edits = h.log.edits();
        let (r, sts) = (replay(edits), trace(edits));
        let facts = facts(&r);
        for (i, x) in r.edits.iter().enumerate() {
            if r.stood[i] || x.is_removal() || sts[i].accepts(x, r.ids[i]).is_err() {
                continue;
            }
            let hidden = hidden(&r, &facts, i);
            let cut = sts[i].hide(&hidden).accepts(x, r.ids[i]).is_err();
            assert!(cut, "seed {seed}: {x:?} is cut by no removal that stands");
        }
    }
}

#[test]
fn t18_checkpointed_writes() {
    let (mut counted, mut dropped) = (0, 0);
    for (seed, h) in forked_histories() {
        let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
        let mut edits = h.log.edits().to_vec();
        // checkpoints of random writes, each covering more writes of its entry: most by the write's own author, some
        // by any signer, and some covering others' writes too, which the rules refuse
        let ws = h.log.view().all_writes().to_vec();
        for _ in 0..ws.len() / 2 {
            let w = &ws[rng.below(ws.len())];
            let author = if rng.below(4) > 0 { w.author } else { rng.pick(&SIGNERS) };
            let same = ws.iter().filter(|x| x.entry == w.entry && x.edit != w.edit);
            let covers = std::iter::once(w.edit).chain(same.filter(|_| rng.below(3) == 0).map(|x| x.edit)).collect();
            edits.push(h.log.draft(author, &[], Action::Checkpoint { entry: w.entry, covers }));
        }
        // a peer that no longer trusts the curves counts a write only if a checkpoint by its own author covers it
        let st = replay(&checkpointed(&edits)).state;
        for w in st.all_writes() {
            let vouched = edits.iter().any(|c| {
                c.author == w.author
                    && matches!(&c.action, Action::Checkpoint { covers, .. } if covers.contains(&w.edit))
            });
            assert!(vouched, "seed {seed}: {w:?} counts with no checkpoint by its author");
        }
        let all = view(&edits);
        counted += st.all_writes().len();
        dropped += all.all_writes().iter().filter(|w| !st.all_writes().contains(w)).count();
    }
    // the checkpoints cover some writes and leave others out
    assert!(counted > 0 && dropped > 0, "{counted} counted, {dropped} dropped");
}

#[test]
fn honest_logs_keep_all_they_accepted() {
    // every edit a device appended stands in its own view: its removals keep everything they had seen
    for p in CAPS.iter() {
        let r = replay(p.one.log.edits());
        assert!(r.stood.iter().all(|&s| s), "seed {}", p.seed);
    }
}

/// A random part of `edits`: each edit with even odds.
fn part(rng: &mut Rng, edits: &[Edit]) -> Vec<Edit> {
    edits.iter().filter(|_| rng.below(2) == 0).cloned().collect()
}

/// The edits every history of its kind starts with, and a random part of the rest.
fn part_after_start(rng: &mut Rng, h: &History) -> Vec<Edit> {
    let edits = h.log.edits();
    edits[..h.start].iter().cloned().chain(part(rng, &edits[h.start..])).collect()
}

fn ids(edits: &[Edit]) -> HashSet<EditId> {
    edits.iter().map(Edit::id).collect()
}

/// Device `d` may receive the edits of the cell of the caps `caps` of vault `v` by `st` (`mayReceiveCell`): it acts for
/// the vault, or for the grantee of a live cap over it, relay or more, that is in the cell or wide, or such a cap is
/// public.
fn may_receive_cell(st: &State, d: SignerId, v: VaultId, caps: &[CapId]) -> bool {
    let names = |g: Grantee| match g {
        Grantee::Principal(Principal::Vault(g)) => st.acts_for(d, g),
        Grantee::Principal(Principal::Signer(_)) => false,
        Grantee::Public => true,
    };
    st.acts_for(d, v)
        || st.caps_over(v).any(|cp| st.live(cp.id) && (cp.cap.wide || caps.contains(&cp.id)) && names(cp.cap.grantee))
}

/// Device `d` may receive the edits of entry `e` by `st` (`mayReceive`): it may receive the entry's cell.
fn may_receive(st: &State, d: SignerId, e: EntryId) -> bool {
    st.entry(e).is_some_and(|en| may_receive_cell(st, d, en.vault, st.cell_caps(en.cell()).unwrap_or_default()))
}

/// Device `d` needs cap `cp` by `st` (`seesCap`): it acts for the vault the cap is over or for the vault it names, or
/// the cap is wide or was ever in the cell of an entry of its vault that `d` may receive.
fn sees_cap(st: &State, d: SignerId, cp: &Issued) -> bool {
    let stayed = |en: &Entry| en.stays.iter().any(|(_, x)| st.cell_caps(*x).unwrap_or_default().contains(&cp.id));
    st.acts_for(d, cp.cap.over)
        || grantee_vault(cp).is_some_and(|g| st.acts_for(d, g))
        || st.entries().iter().any(|en| {
            en.vault == cp.cap.over && may_receive(st, d, en.id) && (cp.cap.wide || stayed(en))
        })
}

/// Device `d` may receive log `l` by `st` (`mayReceiveLog`): the log of an entry or a cell it may receive, or of a cap
/// it needs or that a cap it needs rests on. A cell `st` never met has no caps.
fn may_receive_log(st: &State, d: SignerId, l: LogId) -> bool {
    match l {
        LogId::Entry(e) => may_receive(st, d, e),
        LogId::Cell(v, x) => may_receive_cell(st, d, v, st.cell_caps(x).unwrap_or_default()),
        LogId::Cap(c) => st.caps().iter().any(|x| x.chain.contains(&c) && sees_cap(st, d, x)),
        LogId::Vault(_) => false,
    }
}

#[test]
fn t12_sync_shares_only_caps() {
    // a peer sends a device only edits it holds, of the entries, cells and caps the device may receive by the peer's
    // view, and of vaults' logs; whatever the device says it holds
    let (mut entries, mut cells, mut caps) = (0, 0, 0);
    for (seed, h) in every_history() {
        let (edits, st) = (h.log.edits(), h.log.view());
        let held = ids(edits);
        let mut rng = Rng(seed);
        for d in SIGNERS {
            let mut may: HashMap<LogId, bool> = HashMap::new();
            let asked = asks(&part(&mut rng, edits));
            for edit in respond(edits, d).iter().chain(&respond_since(edits, d, &asked)) {
                assert!(held.contains(&edit.id()), "seed {seed}: {d:?} was sent an edit the peer doesn't hold");
                let l = log_of(edit, edit.id()).expect("an edit of a log");
                let ok = matches!(l, LogId::Vault(_)) || *may.entry(l).or_insert_with(|| may_receive_log(&st, d, l));
                assert!(ok, "seed {seed}: {d:?} was sent {edit:?} of {l:?}");
                match l {
                    LogId::Entry(_) => entries += 1,
                    LogId::Cell(..) => cells += 1,
                    LogId::Cap(_) => caps += 1,
                    LogId::Vault(_) => {}
                }
            }
        }
    }
    // and devices are sent the logs of entries, cells and caps
    assert!(entries > 0 && cells > 0 && caps > 0, "{entries} of entries, {cells} of cells, {caps} of caps");
}

#[test]
fn t19_frontier_sync_loses_nothing() {
    // a device holding any part of the edits, gaps and all, asks a peer holding all of them or another part: it is sent
    // whatever of the peer's whole answer it lacks, and nothing beyond that answer (T12); and so it is when it names
    // only its frontiers, though it is then sent more
    let mut saved = 0;
    for (seed, h) in forked_histories() {
        let edits = h.log.edits();
        let mut rng = Rng(seed);
        for _ in 0..3 {
            let a = part(&mut rng, edits);
            let r = if rng.below(2) == 0 { edits.to_vec() } else { part(&mut rng, edits) };
            let (held, asked) = (ids(&a), asks(&a));
            let alone = Ask { haves: frontiers(&a), loose: vec![] };
            for d in SIGNERS {
                let whole = respond(&r, d);
                for sent in [respond_since(&r, d, &asked), respond_since(&r, d, &alone)] {
                    let lacks = whole.iter().find(|edit| !held.contains(&edit.id()) && !sent.contains(edit));
                    assert!(lacks.is_none(), "seed {seed}: {d:?} lacks {lacks:?}");
                    let beyond = sent.iter().find(|edit| !whole.contains(edit));
                    assert!(beyond.is_none(), "seed {seed}: {d:?} was sent {beyond:?} beyond its answer");
                    saved += whole.len() - sent.len();
                }
            }
        }
    }
    // naming what it holds saves something
    assert!(saved > 0);
}

#[test]
fn t19_partial_delivery() {
    // a device sent only part of each answer, any part in any order, asks again until nothing is left: it ends holding
    // everything it may receive, though it held gaps along the way
    for (seed, h) in forked_histories() {
        let edits = h.log.edits();
        let mut rng = Rng(seed);
        let d = rng.pick(&[MAC_A, PHONE_A, MAC_B, MAC_C, MAC_D]);
        let mut held: Vec<Edit> = vec![];
        for round in 0.. {
            let sent = respond_since(edits, d, &asks(&held));
            if sent.is_empty() {
                break;
            }
            assert!(round < 200, "seed {seed}: the answers never run out");
            let mut got = part(&mut rng, &sent);
            rng.shuffle(&mut got);
            held = receive(&held, &got);
        }
        let held = ids(&held);
        assert!(respond(edits, d).iter().all(|edit| held.contains(&edit.id())), "seed {seed}");
    }
}

#[test]
fn t13_sync_converges() {
    // two devices holding parts of the edits each ask the other once: for every entry each may receive by the other's
    // view, both then hold the same edits of its log
    let mut checked = 0;
    let devices = [MAC_A, PHONE_A, MAC_B, MAC_C];
    for (seed, h) in forked_histories() {
        let entry_logs: Vec<(EntryId, EditId)> = h
            .log
            .edits()
            .iter()
            .filter_map(|o| match log_of(o, o.id()) {
                Some(LogId::Entry(e)) => Some((e, o.id())),
                _ => None,
            })
            .collect();
        let mut rng = Rng(seed);
        for _ in 0..3 {
            let (p, q) = (part_after_start(&mut rng, h), part_after_start(&mut rng, h));
            let (vp, vq, ap, aq) = (view(&p), view(&q), asks(&p), asks(&q));
            let got_p: Vec<HashSet<EditId>> = devices.map(|d| ids(&receive(&p, &respond_since(&q, d, &ap)))).into();
            let got_q: Vec<HashSet<EditId>> = devices.map(|d| ids(&receive(&q, &respond_since(&p, d, &aq)))).into();
            for (i, &dp) in devices.iter().enumerate() {
                for (j, &dq) in devices.iter().enumerate().filter(|&(j, _)| j != i) {
                    for &(e, id) in &entry_logs {
                        if may_receive(&vq, dp, e) && may_receive(&vp, dq, e) {
                            let (a, b) = (got_p[i].contains(&id), got_q[j].contains(&id));
                            assert_eq!(a, b, "seed {seed}: {dp:?} and {dq:?} on {e:?}");
                            checked += 1;
                        }
                    }
                }
            }
        }
    }
    assert!(checked > 100, "only {checked} edits checked");
}

#[test]
fn t19_one_digest_per_log() {
    // two devices hold the same edits of a log exactly when their digests of it are equal
    let (mut same, mut differ) = (0, 0);
    for (seed, h) in forked_histories() {
        let edits = h.log.edits();
        let mut rng = Rng(seed);
        let a = part(&mut rng, edits);
        // and the same edits with about a quarter more: many logs untouched, some grown
        let more = part(&mut rng, edits);
        let b = receive(&a, &part(&mut rng, &more));
        let (da, db) = (digests(&a), digests(&b));
        let of = |x: &[Edit], l: LogId| -> Vec<EditId> {
            let mut v: Vec<EditId> = x.iter().filter(|o| log_of(o, o.id()) == Some(l)).map(Edit::id).collect();
            v.sort();
            v
        };
        for l in da.keys().chain(db.keys()) {
            let equal = da.get(l) == db.get(l);
            assert_eq!(equal, of(&a, *l) == of(&b, *l), "seed {seed}: {l:?}");
            if equal { same += 1 } else { differ += 1 }
        }
    }
    assert!(same > 0 && differ > 0);
}

/// Every holder a history can have: each signer, listed in a vault or not anymore, each vault, and everyone.
fn every_holder(st: &State) -> Vec<Holder> {
    let vaults = st.vaults().iter().map(|v| Holder::Vault(v.id));
    SIGNERS.iter().map(|&s| Holder::Signer(s)).chain(vaults).chain([Holder::Everyone]).collect()
}

#[test]
fn t6_forward_secrecy() {
    // in every state along the way, a holder opens the current key of a family in use only while entitled to it, or
    // while the family is public
    let mut rotated = 0;
    for (seed, h) in every_history() {
        for (edit, before, after) in steps(h.log.edits()) {
            let fams = after.key_fams();
            for holder in every_holder(&after) {
                let opened = after.opens(&holder.start(&after));
                for &k in &fams {
                    if opened.contains(&after.current(k)) {
                        let may = holder.entitled(&after, k) || after.public_key(k);
                        assert!(may, "seed {seed}: {holder:?} opens {k:?} after {edit:?}");
                    }
                }
            }
            // which is why a family only moves on after a removal, or for a cell an entry brings back into use: nothing
            // else makes a key stale
            for (k, e) in after.epochs().filter(|&(k, e)| e > before.epoch(k)) {
                let back = matches!(k, KeyFam::Cell(..)) && !before.has_fam(k) && after.has_fam(k);
                assert!(edit.is_removal() || back, "seed {seed}: {edit:?} moves {k:?} on to {e}");
                rotated += 1;
            }
        }
    }
    assert!(rotated > 0);
}

/// `EverReads` of the Lean model over the states `sts`: a holder could read a family at some point itself (it was
/// entitled to it, or the family was public), or through a vault whose seed it held at some point and that could.
struct Ever<'a> {
    sts: &'a [State],
    /// In each state, the vaults each signer acts for, and those each vault owns.
    acts: Vec<HashMap<SignerId, Vec<VaultId>>>,
    owns: Vec<HashMap<VaultId, Vec<VaultId>>>,
    /// Each holder's vaults whose seed it held at some point, or held through such a vault, and so on.
    through: HashMap<Holder, HashSet<VaultId>>,
    /// Of each family asked about: whether it was ever public, and who could read it itself at some point.
    direct: RefCell<HashMap<KeyFam, (bool, HashSet<Holder>)>>,
}

impl<'a> Ever<'a> {
    fn new(sts: &'a [State]) -> Ever<'a> {
        let vaults: Vec<VaultId> = sts.last().map(|st| st.vaults().iter().map(|v| v.id).collect()).unwrap_or_default();
        let of = |f: &dyn Fn(VaultId) -> bool| vaults.iter().copied().filter(|&v| f(v)).collect();
        let acts: Vec<HashMap<SignerId, Vec<VaultId>>> =
            sts.iter().map(|st| SIGNERS.iter().map(|&s| (s, of(&|v| st.acts_for(s, v)))).collect()).collect();
        let owns: Vec<HashMap<VaultId, Vec<VaultId>>> =
            sts.iter().map(|st| vaults.iter().map(|&x| (x, of(&|y| st.owns(x, y)))).collect()).collect();
        // the seeds each holder held at some point: a signer those of the vaults it acted for, a vault its own and
        // those of the vaults it owned
        let mut seeds: HashMap<Holder, HashSet<VaultId>> = HashMap::new();
        for (a, o) in acts.iter().zip(&owns) {
            for (&s, vs) in a {
                seeds.entry(Holder::Signer(s)).or_default().extend(vs);
            }
            for (&x, ys) in o {
                seeds.entry(Holder::Vault(x)).or_default().extend(ys.iter().chain([&x]));
            }
        }
        let close = |h: &Holder| {
            let mut out: HashSet<VaultId> = seeds.get(h).cloned().unwrap_or_default();
            let mut todo: Vec<VaultId> = out.iter().copied().collect();
            while let Some(v) = todo.pop() {
                for &w in seeds.get(&Holder::Vault(v)).into_iter().flatten() {
                    if out.insert(w) {
                        todo.push(w);
                    }
                }
            }
            out
        };
        let through = seeds.keys().map(|h| (*h, close(h))).collect();
        Ever { sts, acts, owns, through, direct: RefCell::new(HashMap::new()) }
    }

    /// Whether family `k` was ever public, and who could read it itself at some point.
    fn direct(&self, k: KeyFam) -> (bool, HashSet<Holder>) {
        let mut out = HashSet::new();
        for (i, st) in self.sts.iter().enumerate() {
            if st.public_key(k) {
                return (true, out);
            }
            let readers = st.readers(k);
            for (&s, vs) in &self.acts[i] {
                if vs.iter().any(|v| readers.contains(v)) {
                    out.insert(Holder::Signer(s));
                }
            }
            for (&x, ys) in &self.owns[i] {
                if readers.contains(&x) || ys.iter().any(|y| readers.contains(y)) {
                    out.insert(Holder::Vault(x));
                }
            }
        }
        (false, out)
    }

    /// Holder `h` could read family `k` itself at some point.
    fn itself(&self, h: Holder, k: KeyFam) -> bool {
        let mut direct = self.direct.borrow_mut();
        let (public, readers) = direct.entry(k).or_insert_with(|| self.direct(k));
        *public || readers.contains(&h)
    }

    /// `EverReads`: holder `h` could read family `k` at some point, itself or through a vault.
    fn reads(&self, h: Holder, k: KeyFam) -> bool {
        let through = self.through.get(&h).into_iter().flatten();
        self.itself(h, k) || through.into_iter().any(|&v| self.itself(Holder::Vault(v), k))
    }
}

#[test]
fn t5_confidentiality() {
    // after any history, a holder opens a key of a family, of any epoch, only if over that history it could read the
    // family: newcomers to a vault inherit what the vault could read before them
    let mut inherited = 0;
    for (seed, h) in every_history() {
        let sts = states(h.log.edits());
        let (st, ever) = (sts.last().expect("a state"), Ever::new(&sts));
        for holder in every_holder(st) {
            for n in st.opens(&holder.start(st)) {
                let KeyName::Scoped(k, e) = n else { continue };
                assert!(ever.reads(holder, k), "seed {seed}: {holder:?} opens {k:?} at {e}");
                inherited += usize::from(e < st.epoch(k) && !ever.itself(holder, k));
            }
        }
    }
    // and some holder does open history from before it could read: through a vault it joined later
    assert!(inherited > 0);
}

#[test]
fn t24_entry_keys_reach_only_cell_readers() {
    // in every state along the way, whoever opens the key of an entry in its current stay, at its cell's current
    // generation, may open that cell's current key; and after any history, a holder opens a key of an entry only if
    // over that history it could read some cell the entry was in
    let mut earlier = 0;
    for (seed, h) in every_history() {
        let sts = states(h.log.edits());
        for st in &sts {
            for holder in every_holder(st) {
                let opened = st.opens(&holder.start(st));
                for en in st.entries() {
                    let k = KeyFam::Cell(en.vault, en.cell());
                    if st.entry_key(en.id).is_some_and(|n| opened.contains(&n)) {
                        let may = holder.entitled(st, k) || st.public_key(k);
                        assert!(may, "seed {seed}: {holder:?} opens the key of {en:?}");
                    }
                }
            }
        }
        let (st, ever) = (sts.last().expect("a state"), Ever::new(&sts));
        let mut cells: HashMap<EntryId, HashSet<KeyFam>> = HashMap::new();
        for x in &sts {
            for en in x.entries() {
                cells.entry(en.id).or_default().extend(en.stays.iter().map(|&(_, c)| KeyFam::Cell(en.vault, c)));
            }
        }
        for holder in every_holder(st) {
            for n in st.opens(&holder.start(st)) {
                let KeyName::Entry(e, stay, _) = n else { continue };
                let read = cells.get(&e).is_some_and(|ks| ks.iter().any(|&k| ever.reads(holder, k)));
                assert!(read, "seed {seed}: {holder:?} opens {n:?}");
                earlier += usize::from(st.entry(e).is_some_and(|en| en.stay() != stay));
            }
        }
    }
    // and readers do open the keys of an entry's earlier stays: its history, linked to the stay it is in now
    assert!(earlier > 0);
}

/// Attributes to try selectors on: every entry's in `st` as its readers see them, and made-up ones of each type, with a
/// few sets of tags, creators, entries and creation times.
fn some_attrs(st: &State, r: &Readings) -> Vec<Attrs> {
    let mut out: Vec<Attrs> = st.entries().iter().filter_map(|en| Some(st.meaning(en.id, r)?.attrs)).collect();
    let tag_sets: [&[&str]; 4] = [&[], &["work"], &["home", "door"], &["garden", "work"]];
    for ty in TYPES {
        for tags in tag_sets {
            for (i, v) in st.vaults().iter().take(6).enumerate() {
                let tags = tags.iter().map(|&t| Sym::new(t)).collect();
                let (entry, created) = (ENTRIES[i % ENTRIES.len()], i as u64 % 4);
                out.push(Attrs { ty: Sym::new(ty), author: v.id, entry, created, tags });
            }
        }
    }
    out
}

#[test]
fn t22_caps_narrow_down_their_chain() {
    // in the view of every history, and with the attempts the rules refused put back: a cap that rests on another is
    // over the same vault, rests on an owner cap issued to its own issuer, selects nothing that cap doesn't, and is
    // wide only if that cap is; a root cap is issued by the vault it is over
    let mut rested = 0;
    for (seed, h) in every_history() {
        let with_refused: Vec<Edit> = h.log.edits().iter().chain(&h.refused).cloned().collect();
        for st in [h.log.view(), view(&with_refused)] {
            let attrs = some_attrs(&st, &h.readings);
            for cp in st.caps() {
                assert_eq!(cp.chain.last(), Some(&cp.id), "seed {seed}: {cp:?}");
                let Some(p) = cp.cap.parent else {
                    assert!(cp.cap.issuer == cp.cap.over && cp.chain.len() == 1, "seed {seed}: {cp:?}");
                    continue;
                };
                let pc = st.cap(p).expect("a cap's parent");
                assert_eq!(pc.cap.over, cp.cap.over, "seed {seed}: {cp:?}");
                assert_eq!(pc.cap.role, Role::Owner, "seed {seed}: {cp:?}");
                assert_eq!(pc.cap.grantee, vault(cp.cap.issuer), "seed {seed}: {cp:?}");
                assert!(!cp.cap.wide || pc.cap.wide, "seed {seed}: {cp:?}");
                assert_eq!(cp.chain[..cp.chain.len() - 1], pc.chain[..], "seed {seed}: {cp:?}");
                for a in &attrs {
                    let narrower = !st.eff_selects(cp, a, &h.readings) || st.eff_selects(pc, a, &h.readings);
                    assert!(narrower, "seed {seed}: {cp:?} selects {a:?}");
                }
                rested += 1;
            }
        }
    }
    // and caps do rest on caps
    assert!(rested > 0);
}

#[test]
fn t23_cells_mean_what_caps_say() {
    // in every state along the way: where an entry's cell, revoked caps left aside, is the cell its meaning asks for,
    // the rule every peer checks without reading a selector, a type or a tag lets exactly the vaults write it that the
    // caps' selectors let; and that rule never refuses a creation inside its creator's slice
    let (mut meant, mut moving, mut admitted) = (0, 0, 0);
    for (seed, h) in every_history() {
        for st in states(h.log.edits()) {
            for en in st.entries() {
                let Some(m) = st.meaning(en.id, &h.readings) else { continue };
                if m.desired.is_some() {
                    moving += 1;
                    continue;
                }
                for &v in &h.vaults {
                    let (may, sem) = (st.may_write(v, en.id), st.sem_write(v, en.id, &h.readings));
                    assert_eq!(may, sem, "seed {seed}: {v:?} on {en:?}");
                }
                meant += usize::from(!m.cell.is_empty());
            }
            let attrs = some_attrs(&st, &h.readings);
            for cp in st.caps() {
                let Some(a) = grantee_vault(cp).filter(|&a| st.holds(a, cp, Role::Write)) else { continue };
                if let Some(x) = attrs.iter().find(|x| st.eff_selects(cp, x, &h.readings)) {
                    assert!(st.may_create(a, cp.cap.over, &cp.intake), "seed {seed}: {a:?} creates {x:?} by {cp:?}");
                    admitted += 1;
                }
            }
        }
    }
    // the entries do sit in cells of caps, some wait for a steward to move them, and caps do let their grantees create
    assert!(meant > 0 && moving > 0 && admitted > 0, "{meant} in place, {moving} to move, {admitted} admitted");
}

/// A relay's twin of a history (T25): every edit as a peer that reads no selector, no type and no tag sees it, a cap
/// selecting the whole vault, a write with an empty body, a new entry's header blank. The twins hash to other ids, so
/// whatever names an edit is renamed: what an edit creates (a vault, a cap), the cells the caps make, and every edit
/// named as a parent, a dependency, a stay, a proposal, kept or covered.
#[derive(Default)]
struct Twin {
    edits: HashMap<EditId, EditId>,
    cells: HashMap<CellId, CellId>,
}

impl Twin {
    fn edit(&self, id: EditId) -> EditId {
        self.edits.get(&id).copied().unwrap_or(id)
    }

    fn cap(&self, c: CapId) -> CapId {
        CapId(self.edit(EditId(c.0)).0)
    }

    fn vault(&self, v: VaultId) -> VaultId {
        VaultId(self.edit(EditId(v.0)).0)
    }

    fn cell(&self, x: CellId) -> CellId {
        self.cells.get(&x).copied().unwrap_or(x)
    }

    fn edits(&self, ids: &[EditId]) -> Vec<EditId> {
        ids.iter().map(|&id| self.edit(id)).collect()
    }

    fn vaults(&self, vs: &[VaultId]) -> Vec<VaultId> {
        vs.iter().map(|&v| self.vault(v)).collect()
    }

    /// The caps of a cell, renamed, in canonical order again.
    fn caps(&self, xs: &[CapId]) -> Vec<CapId> {
        mk_cell(&xs.iter().map(|&c| self.cap(c)).collect::<Vec<_>>())
    }

    fn principal(&self, p: Principal) -> Principal {
        match p {
            Principal::Vault(v) => Principal::Vault(self.vault(v)),
            p => p,
        }
    }

    fn grantee(&self, g: Grantee) -> Grantee {
        match g {
            Grantee::Principal(p) => Grantee::Principal(self.principal(p)),
            g => g,
        }
    }

    fn proposal(&self, p: Proposal) -> Proposal {
        match p {
            Proposal::On(b) => Proposal::On(self.edit(b)),
            p => p,
        }
    }

    fn fam(&self, k: KeyFam) -> KeyFam {
        match k {
            KeyFam::Seed(v) => KeyFam::Seed(self.vault(v)),
            KeyFam::Cap(v, c) => KeyFam::Cap(self.vault(v), self.cap(c)),
            KeyFam::Cell(v, x) => KeyFam::Cell(self.vault(v), self.cell(x)),
        }
    }

    fn key(&self, n: KeyName) -> KeyName {
        match n {
            KeyName::Signer(s) => KeyName::Signer(s),
            KeyName::Scoped(k, e) => KeyName::Scoped(self.fam(k), e),
            KeyName::Entry(e, stay, g) => KeyName::Entry(e, stay.map(|s| self.edit(s)), g),
        }
    }

    /// The cell of the caps `xs` of vault `v`, renamed; and from now on its id.
    fn new_cell(&mut self, v: VaultId, xs: &[CapId]) -> Vec<CapId> {
        let caps = self.caps(xs);
        self.cells.insert(CellId::of(v, xs), CellId::of(self.vault(v), &caps));
        caps
    }

    /// The relay's twin of `edit`, whatever it names renamed; and from now on its id.
    fn blind(&mut self, edit: &Edit) -> Edit {
        let action = self.action(&edit.action);
        let (parents, cosigners) = (self.edits(&edit.parents), edit.cosigners.clone());
        let twin = Edit { parents, depth: edit.depth, author: edit.author, cosigners, action };
        self.edits.insert(edit.id(), twin.id());
        twin
    }

    fn action(&mut self, a: &Action) -> Action {
        match a.clone() {
            Action::Genesis { kind, owners, threshold, root, nonce, seal_to } => {
                let owners = owners.into_iter().map(|p| self.principal(p)).collect();
                Action::Genesis { kind, owners, threshold, root, nonce, seal_to }
            }
            Action::AddOwner { vault, owner, seal_to } => {
                Action::AddOwner { vault: self.vault(vault), owner: self.principal(owner), seal_to }
            }
            Action::RemoveOwner { vault, owner, keep } => {
                Action::RemoveOwner { vault: self.vault(vault), owner: self.principal(owner), keep: self.edits(&keep) }
            }
            Action::SetThreshold { vault, threshold } => Action::SetThreshold { vault: self.vault(vault), threshold },
            Action::AddDevice { vault, device, seal_to } => {
                Action::AddDevice { vault: self.vault(vault), device, seal_to }
            }
            Action::RemoveDevice { vault, device, keep } => {
                Action::RemoveDevice { vault: self.vault(vault), device, keep: self.edits(&keep) }
            }
            Action::SetRoot { vault, root, keep } => {
                Action::SetRoot { vault: self.vault(vault), root, keep: self.edits(&keep) }
            }
            Action::Cap(c, via) => {
                let cap = Cap {
                    over: self.vault(c.over),
                    grantee: self.grantee(c.grantee),
                    select: Select::Clear(Slice::all()).to_wire(),
                    parent: c.parent.map(|p| self.cap(p)),
                    issuer: self.vault(c.issuer),
                    ..c
                };
                Action::Cap(cap, self.vaults(&via))
            }
            Action::Revoke { cap, actor, keep, via } => {
                let (keep, via) = (self.edits(&keep), self.vaults(&via));
                Action::Revoke { cap: self.cap(cap), actor: self.vault(actor), keep, via }
            }
            Action::Write { vault, entry, actor, stay, generation, deps, proposal, via, create, .. } => {
                let header = create.is_some().then(|| Header { ty: Sym::new(""), created: 0 });
                let body = Body { header, ..Body::default() }.to_wire();
                let create = create.map(|x| self.new_cell(vault, &x));
                let (stay, deps, proposal) = (stay.map(|s| self.edit(s)), self.edits(&deps), self.proposal(proposal));
                let (vault, actor, via) = (self.vault(vault), self.vault(actor), self.vaults(&via));
                Action::Write { vault, entry, actor, stay, generation, deps, proposal, via, create, body }
            }
            Action::Move { vault, entry, to, keep, via } => {
                let to = self.new_cell(vault, &to);
                Action::Move { vault: self.vault(vault), entry, to, keep: self.edits(&keep), via: self.vaults(&via) }
            }
            Action::Keys { name, id, public, boxes, clear } => {
                let to = |r: Recipient| match r {
                    Recipient::Key { name, id } => Recipient::Key { name: self.key(name), id },
                    r => r,
                };
                let boxes = boxes.into_iter().map(|b| KeyBox { to: to(b.to), bytes: b.bytes }).collect();
                Action::Keys { name: self.key(name), id, public, boxes, clear }
            }
            Action::Publish { vault, actor, via, blob } => {
                Action::Publish { vault: self.vault(vault), actor: self.vault(actor), via: self.vaults(&via), blob }
            }
            Action::Checkpoint { entry, covers } => Action::Checkpoint { entry, covers: self.edits(&covers) },
        }
    }
}

/// What a peer knows of the operational part of a state (`State.ops`): all of it but what only readers read, the caps'
/// selectors, every id renamed by `t`.
#[derive(Debug, PartialEq)]
struct Ops {
    vaults: Vec<Vault>,
    caps: Vec<Issued>,
    revoked: Vec<CapId>,
    entries: Vec<Entry>,
    born: Vec<EntryId>,
    writes: Vec<Write>,
    cells: BTreeMap<CellId, Vec<CapId>>,
    epochs: BTreeMap<KeyFam, Vec<Option<EditId>>>,
    seals: BTreeSet<(KeyName, KeyName)>,
    published: Vec<KeyName>,
    lane: Vec<(VaultId, BlobId)>,
}

fn ops(st: &State, t: &Twin) -> Ops {
    let vault = |v: &Vault| {
        let owners = v.owners.iter().map(|&p| t.principal(p)).collect();
        Vault { id: t.vault(v.id), owners, ..v.clone() }
    };
    let cap = |cp: &Issued| Issued {
        id: t.cap(cp.id),
        cap: Cap {
            over: t.vault(cp.cap.over),
            grantee: t.grantee(cp.cap.grantee),
            select: vec![],
            parent: cp.cap.parent.map(|p| t.cap(p)),
            issuer: t.vault(cp.cap.issuer),
            ..cp.cap.clone()
        },
        chain: cp.chain.iter().map(|&c| t.cap(c)).collect(),
        intake: t.caps(&cp.intake).into(),
    };
    let entry = |en: &Entry| Entry {
        id: en.id,
        vault: t.vault(en.vault),
        stays: en.stays.iter().map(|&(s, x)| (s.map(|s| t.edit(s)), t.cell(x))).collect(),
        creator: t.vault(en.creator),
        creation: t.edit(en.creation),
        intake: en.intake.iter().map(|&c| t.cap(c)).collect(),
        retags: t.edits(&en.retags),
    };
    let write = |w: &Write| Write {
        edit: t.edit(w.edit),
        actor: t.vault(w.actor),
        stay: w.stay.map(|s| t.edit(s)),
        deps: t.edits(&w.deps),
        proposal: t.proposal(w.proposal),
        via: t.vaults(&w.via),
        cell: t.cell(w.cell),
        ..w.clone()
    };
    let moved = |k: KeyFam, e: u64| (1..=e).map(|i| st.moved_by(k, i).map(|m| t.edit(m))).collect();
    Ops {
        vaults: st.vaults().iter().map(vault).collect(),
        caps: st.caps().iter().map(cap).collect(),
        revoked: st.revoked().iter().map(|&c| t.cap(c)).collect(),
        entries: st.entries().iter().map(entry).collect(),
        born: st.all_born().to_vec(),
        writes: st.all_writes().iter().map(write).collect(),
        cells: st.cells().map(|(x, caps)| (t.cell(x), t.caps(caps))).collect(),
        epochs: st.epochs().map(|(k, e)| (t.fam(k), moved(k, e))).collect(),
        seals: st.seals().iter().map(|s| (t.key(s.secret), t.key(s.to))).collect(),
        published: st.published().iter().map(|&n| t.key(n)).collect(),
        lane: st.lane().iter().map(|p| (t.vault(p.vault), p.blob)).collect(),
    }
}

#[test]
fn t25_blind_relays() {
    // a peer that reads no selector, no type and no tag, holding the same edits as an owner, has every edit stand or
    // fall alike, and knows the same of the vaults, caps, entries and their cells, writes and keys
    let mut moved = 0;
    for (seed, h) in every_history() {
        let r = replay(h.log.edits());
        let mut twin = Twin::default();
        let blind: Vec<Edit> = r.edits.iter().map(|o| twin.blind(o)).collect();
        let b = replay(&blind);
        let standing: Vec<EditId> = r.standing().into_iter().map(|id| twin.edit(id)).collect();
        assert_eq!(b.standing(), standing, "seed {seed}");
        assert_eq!(ops(&b.state, &Twin::default()), ops(&r.state, &twin), "seed {seed}");
        moved += r.state.entries().iter().filter(|en| en.stays.len() > 1).count();
    }
    // and the stewards do move entries between cells, which the twins name by other ids
    assert!(moved > 0);
}

#[test]
fn each_step_settles_as_the_whole_model_does() {
    // a step in place settles only what an edit touched, unless the edit removes something, where the model settles
    // every key after every edit: along every history, every edit in replay order, both accept and refuse alike and end
    // in the same state
    for (seed, h) in every_history() {
        let (mut light, mut full) = (State::default(), State::default());
        for edit in order(h.log.edits()) {
            let id = edit.id();
            let (a, b) = (light.step_mut(&edit, id), full.step_full(&edit, id));
            assert_eq!(a, b, "seed {seed}: {edit:?}");
            let what = format!("seed {seed}, after {edit:?}");
            assert_eq!(light.vaults(), full.vaults(), "{what}");
            assert_eq!(light.caps(), full.caps(), "{what}");
            assert_eq!(light.revoked(), full.revoked(), "{what}");
            assert_eq!(light.entries(), full.entries(), "{what}");
            assert_eq!(light.all_writes(), full.all_writes(), "{what}");
            let epochs = |st: &State| {
                st.epochs().flat_map(|(k, e)| (1..=e).map(move |i| (k, i, st.moved_by(k, i)))).collect::<BTreeSet<_>>()
            };
            assert_eq!(epochs(&light), epochs(&full), "{what}");
            let seals = |st: &State| st.seals().iter().map(|s| (s.secret, s.to)).collect::<BTreeSet<_>>();
            assert_eq!(seals(&light), seals(&full), "{what}");
            let published = |st: &State| st.published().iter().copied().collect::<BTreeSet<_>>();
            assert_eq!(published(&light), published(&full), "{what}");
        }
    }
}

/// A random document as any mix of apps could have stored it: blocks in v1's representation, v2's, or both after
/// concurrent edits; values no schema takes; blocks no app can read; ids two blocks share.
fn stored_document(rng: &mut Rng) -> Value {
    let blocks: Vec<Value> = (0..rng.below(7))
        .map(|_| {
            let mut b = json!({});
            if rng.below(8) != 0 {
                b["id"] = json!(1 + rng.below(6));
            }
            if rng.below(3) != 0 {
                b["kind"] = json!(rng.pick(&["h1", "h2", "h3", "p", "li", "code", "chapter"]));
            }
            if rng.below(2) == 0 {
                b["type"] = json!(rng.pick(&["heading", "paragraph", "item", "code", "chapter"]));
            }
            if rng.below(3) == 0 {
                b["level"] = json!(rng.below(4));
            }
            if rng.below(4) == 0 {
                b["checked"] = json!(rng.below(2) == 0);
            }
            if rng.below(4) == 0 {
                b["lang"] = json!(rng.pick(&["sh", "py"]));
            }
            if rng.below(5) != 0 {
                b["text"] = json!(rng.pick(&["Seeds", "Water", ""]));
            }
            b
        })
        .collect();
    let mut d = json!({ "kind": "document", "blocks": blocks });
    if rng.below(4) != 0 {
        d["title"] = json!(rng.pick(&["Welcome", "Charter"]));
    }
    if rng.below(2) == 0 {
        d["tags"] = json!(["greenhouse"]);
    }
    d
}

/// A new block as an app on v2 (`newer`) or v1 writes it.
fn new_block(rng: &mut Rng, id: u64, newer: bool) -> Value {
    let text = rng.pick(&["Seeds", "Water", ""]);
    if !newer {
        return json!({ "id": id, "kind": rng.pick(&["h1", "h2", "h3", "p", "li", "code"]), "text": text });
    }
    let mut b = json!({ "id": id, "type": rng.pick(&["heading", "paragraph", "item", "code"]), "text": text });
    if rng.below(2) == 0 {
        b["level"] = json!(rng.below(5));
    }
    if rng.below(2) == 0 {
        b["checked"] = json!(rng.below(2) == 0);
    }
    b
}

/// One random edit of a document as an app on v2 (`newer`) or v1 sees it: what a user does in its editor.
fn edit_document(rng: &mut Rng, d: &mut Value, newer: bool) {
    let what = rng.below(8);
    if what == 0 {
        d["title"] = json!(rng.pick(&["Welcome", "Charter", "Notes"]));
        return;
    }
    if what == 1 && newer {
        d["tags"] = [json!(["greenhouse"]), json!(["greenhouse", "seeds"]), json!([])][rng.below(3)].clone();
        return;
    }
    let blocks = d["blocks"].as_array_mut().expect("a view's blocks");
    let n = blocks.len();
    match what {
        // a new block, under an id the app doesn't show: one a block it can't read may have
        2 => {
            let shown: Vec<Value> = blocks.iter().map(|b| b["id"].clone()).collect();
            let free: Vec<u64> = (1..=8).filter(|&x| !shown.contains(&json!(x))).collect();
            if !free.is_empty() {
                let id = free[rng.below(free.len())];
                blocks.insert(rng.below(n + 1), new_block(rng, id, newer));
            }
        }
        3 if n > 0 => {
            blocks.remove(rng.below(n));
        }
        4 if n > 1 => {
            let (i, j) = (rng.below(n), rng.below(n));
            blocks.swap(i, j);
        }
        5 if n > 0 => blocks[rng.below(n)]["text"] = json!(rng.pick(&["Seeds", "Water", "", "Seeds and water"])),
        6 if n > 0 && !newer => blocks[rng.below(n)]["kind"] = json!(rng.pick(&["h1", "h2", "h3", "p", "li", "code"])),
        6 if n > 0 => {
            let b = blocks[rng.below(n)].as_object_mut().expect("a view's block");
            b.insert("type".into(), json!(rng.pick(&["heading", "paragraph", "item", "code"])));
            match rng.below(3) {
                0 => b.remove("level"),
                _ => b.insert("level".into(), json!(rng.below(5))),
            };
        }
        7 if n > 0 && newer => {
            let b = blocks[rng.below(n)].as_object_mut().expect("a view's block");
            match rng.below(4) {
                0 => b.remove("checked"),
                1 => b.insert("checked".into(), json!(rng.below(2) == 0)),
                2 => b.remove("lang"),
                _ => b.insert("lang".into(), json!(rng.pick(&["sh", "py", "rust"]))),
            };
        }
        _ => {}
    }
}

fn blocks(d: &Value) -> &[Value] {
    d["blocks"].as_array().map(Vec::as_slice).unwrap_or(&[])
}

/// The first block of `d` with id `id`: the one apps see.
fn first_with<'a>(d: &'a Value, id: &Value) -> Option<&'a Value> {
    blocks(d).iter().find(|b| b["id"] == *id)
}

/// The blocks of `stored` an app whose view was `seen` can't see, and doesn't write over in `edited`: those with an id
/// the view doesn't show and the edit doesn't use, and those without an id.
fn unseen(stored: &Value, seen: &Value, edited: &Value) -> Vec<Value> {
    let used: Vec<&Value> = blocks(seen).iter().chain(blocks(edited)).map(|b| &b["id"]).collect();
    blocks(stored).iter().filter(|b| b["id"].is_null() || !used.contains(&&b["id"])).cloned().collect()
}

#[test]
fn t9_put_get() {
    // on random documents as any mix of apps could have stored them, for both apps: both see the same item (T9c), an
    // unchanged view writes nothing (T9g), an edit reads back exactly as made (T9f), and what the app can't see is left
    // as it was; an older app's edit keeps the tags and each block's checked and lang (T9h)
    let (v1, v2) = (View::document_v1(), View::document_v2());
    let mut in_place = 0;
    for seed in RUNS {
        let mut rng = Rng(seed);
        for _ in 0..50 {
            let stored = stored_document(&mut rng);
            let as_v2 = v2.get(&stored).expect("every document reads");
            assert_eq!(v1.get(&stored), v1.get(&as_v2), "seed {seed}: {stored}");
            for (view, newer) in [(v1, false), (v2, true)] {
                let seen = view.get(&stored).expect("every document reads");
                assert_eq!(view.put(&stored, &seen).as_ref(), Some(&stored), "seed {seed}: {stored}");
                let mut edited = seen.clone();
                for _ in 0..1 + rng.below(3) {
                    edit_document(&mut rng, &mut edited, newer);
                }
                let put = view.put(&stored, &edited).expect("an edited view is a view");
                assert_eq!(view.get(&put).as_ref(), Some(&edited), "seed {seed}: {stored} edited into {edited}");
                let mut missing = unseen(&stored, &seen, &edited);
                for b in blocks(&put) {
                    if let Some(i) = missing.iter().position(|m| m == b) {
                        missing.swap_remove(i);
                    }
                }
                assert!(missing.is_empty(), "seed {seed}: {stored} edited into {edited} loses {missing:?}");
                for b in blocks(&edited) {
                    let before = first_with(&stored, &b["id"]);
                    in_place += usize::from(before.is_some() && first_with(&seen, &b["id"]).is_none());
                    if let (Some(before), false) = (before, newer) {
                        let after = first_with(&put, &b["id"]).expect("an edited block is stored");
                        let (was, is) = ((&before["checked"], &before["lang"]), (&after["checked"], &after["lang"]));
                        assert_eq!(was, is, "seed {seed}: {stored} edited into {edited}");
                    }
                }
                assert!(newer || put.get("tags") == stored.get("tags"), "seed {seed}: {stored} edited into {edited}");
            }
        }
    }
    // and apps do write ids of blocks they can't read, which edits those in place
    assert!(in_place > 0);
}

/// A random todo as any mix of apps could have stored it: `done`, `status`, both, or neither.
fn stored_todo(rng: &mut Rng) -> Value {
    let mut t = json!({ "kind": "todo" });
    if rng.below(4) != 0 {
        t["title"] = json!(rng.pick(&["Order seeds", "Water the beds"]));
    }
    if rng.below(2) == 0 {
        t["done"] = json!(rng.below(2) == 0);
    }
    if rng.below(2) == 0 {
        t["status"] = json!(rng.pick(&["open", "doing", "done", "later"]));
    }
    if rng.below(3) == 0 {
        t["notes"] = json!(rng.pick(&["From the coop", ""]));
    }
    if rng.below(3) == 0 {
        t["due"] = json!("2026-10-09");
    }
    t
}

fn edit_todo(rng: &mut Rng, t: &mut Value, newer: bool) {
    match rng.below(4) {
        0 => t["title"] = json!(rng.pick(&["Order seeds", "Plant the beans"])),
        1 if newer => t["status"] = json!(rng.pick(&["open", "doing", "done"])),
        1 => t["done"] = json!(rng.below(2) == 0),
        2 => t["notes"] = json!(rng.pick(&["", "Ask Bob"])),
        _ => match rng.below(2) {
            0 => drop(t.as_object_mut().expect("a view").remove("due")),
            _ => t["due"] = json!("2026-10-10"),
        },
    }
}

#[test]
fn t9_put_get_todos() {
    // the same laws for todos; and a todo in progress stays in progress when an older app edits anything but done
    let (v1, v2) = (View::todo_v1(), View::todo_v2());
    let mut kept = 0;
    for seed in RUNS {
        let mut rng = Rng(seed);
        for _ in 0..50 {
            let stored = stored_todo(&mut rng);
            let as_v2 = v2.get(&stored).expect("every todo reads");
            assert_eq!(v1.get(&stored), v1.get(&as_v2), "seed {seed}: {stored}");
            for (view, newer) in [(v1, false), (v2, true)] {
                let seen = view.get(&stored).expect("every todo reads");
                assert_eq!(view.put(&stored, &seen).as_ref(), Some(&stored), "seed {seed}: {stored}");
                let mut edited = seen.clone();
                for _ in 0..1 + rng.below(3) {
                    edit_todo(&mut rng, &mut edited, newer);
                }
                let put = view.put(&stored, &edited).expect("an edited view is a view");
                assert_eq!(view.get(&put).as_ref(), Some(&edited), "seed {seed}: {stored} edited into {edited}");
                if !newer && edited["done"] == seen["done"] {
                    assert_eq!((&put["status"], &put["done"]), (&stored["status"], &stored["done"]), "seed {seed}");
                    kept += usize::from(stored["status"] == "doing");
                }
            }
        }
    }
    assert!(kept > 0);
}

/// One random edit of a document, as a user makes it in a v2 app; a new one where an undo took the first write back.
fn edit_item(rng: &mut Rng, item: &mut Item) {
    let view = View::document_v2();
    let new = || DocV2 { title: "Welcome".into(), blocks: vec![], tags: vec![] }.to_value();
    let mut d = item.read(view).unwrap_or_else(new);
    edit_document(rng, &mut d, true);
    assert!(item.write(view, &d));
}

/// What a reader shows on `line`.
fn shown(repo: &Repo, line: Line) -> Value {
    repo.item(line, MAC_D).map_or(json!({}), |i| i.record())
}

/// Each line with its history and what it shows.
fn lines(repo: &Repo) -> Vec<(Line, Vec<EditId>, Value)> {
    repo.history().lines().into_iter().map(|l| (l, repo.log(l), shown(repo, l))).collect()
}

#[test]
fn t10_proposals() {
    // on random histories of one document, edited on random lines by random devices, proposed from random versions,
    // and merged and promoted between random lines: a write on one line leaves every other line as it was (T10f); a
    // merge's history is the union of both lines', so merging the other way shows the same and merging again changes
    // nothing (T10g); a promote shows exactly the proposal and keeps both histories (T10h); and undoing a line's latest
    // edit gives back the version it built on
    let mut done = [0; 5];
    for seed in RUNS {
        let mut rng = Rng(seed);
        let mut repo = Repo::new(&document("Welcome", WELCOME_TEXT, MAC_A), MAC_A);
        for _ in 0..12 {
            let before = lines(&repo);
            let ls: Vec<Line> = before.iter().map(|x| x.0).collect();
            let author = rng.pick(&[MAC_A, MAC_B, MAC_C]);
            let (from, into) = (rng.pick(&ls), rng.pick(&ls));
            let what = if from == into { rng.below(3) } else { rng.below(5) };
            done[what] += 1;
            let line = match what {
                0 => {
                    repo.edit(author, into, |i| edit_item(&mut rng, i));
                    into
                }
                1 => {
                    let edits: Vec<EditId> = repo.history().changes().iter().map(|c| c.write.edit).collect();
                    let at = rng.pick(&edits);
                    let b = Some(repo.propose(author, &[at], "a proposal").expect("a version the repo holds"));
                    let start = repo.history().item_at(&[at], MAC_D, MAIN).record();
                    assert_eq!(shown(&repo, b), start, "seed {seed}");
                    b
                }
                2 => {
                    let heads = repo.heads(into);
                    let latest = repo.history().get(heads[0]).expect("a head").write.deps.clone();
                    repo.undo(author, into, heads[0]).expect("a write the repo holds");
                    assert_eq!(heads.len(), 1, "seed {seed}");
                    let back = repo.history().item_at(&latest, MAC_D, MAIN).record();
                    assert_eq!(shown(&repo, into), back, "seed {seed}");
                    into
                }
                3 => {
                    let mut other = repo.clone();
                    let merge = repo.merge(author, from, into);
                    let union: Vec<EditId> = repo.log(into).into_iter().filter(|&edit| edit != merge).collect();
                    let mut both: Vec<EditId> = [repo_log(&before, into), repo_log(&before, from)].concat();
                    both.sort();
                    both.dedup();
                    let mut got = union.clone();
                    got.sort();
                    assert_eq!(got, both, "seed {seed}");
                    other.merge(author, into, from);
                    assert_eq!(shown(&other, from), shown(&repo, into), "seed {seed}");
                    let merged = shown(&repo, into);
                    repo.merge(author, from, into);
                    assert_eq!(shown(&repo, into), merged, "seed {seed}");
                    into
                }
                _ => {
                    repo.promote(author, from, into);
                    assert_eq!(shown(&repo, into), shown(&repo, from), "seed {seed}");
                    let log = repo.log(into);
                    let kept = repo_log(&before, into).into_iter().chain(repo_log(&before, from));
                    assert!(kept.into_iter().all(|edit| log.contains(&edit)), "seed {seed}");
                    into
                }
            };
            // every other line is as it was
            for (l, log, record) in &before {
                if *l != line {
                    assert_eq!((&repo.log(*l), &shown(&repo, *l)), (log, record), "seed {seed}");
                }
            }
        }
    }
    assert!(done.iter().all(|&n| n > 20), "{done:?}");
}

fn repo_log(lines: &[(Line, Vec<EditId>, Value)], line: Line) -> Vec<EditId> {
    lines.iter().find(|x| x.0 == line).map(|x| x.1.clone()).unwrap_or_default()
}
