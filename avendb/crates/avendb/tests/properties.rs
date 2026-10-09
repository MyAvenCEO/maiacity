//! One property per Lean theorem that the rules alone decide, checked on random histories: random signers trying random
//! actions on top of scenarios 1 to 4, kept when the rules accept them, then replayed in other orders; and forked ones,
//! where devices that were offline meet with concurrent changes. The lens laws (T9) are checked on random items, as any
//! mix of apps could have stored them, read and edited through each app's view, and the branch laws (T10) on random
//! histories of one document. Sync (T12, T13, T19) is checked between devices holding random parts of random histories,
//! gaps and all. Each property carries its theorem's name; T7 (the blind server, which follows from T5) is guarded by
//! the tests the Lean README lists.

mod common;

use common::*;
use serde_json::{json, Value};
use avendb::branch::{Repo, MAIN};
use avendb::doc::Item;
use avendb::id::{EntryId, GrantId, OpId, SignerId, SpaceId, VaultId};
use avendb::keys::{KeyName, KeyScope};
use avendb::lens::{DocV2, View};
use avendb::policy::{
    Line,
    checkpointed, order, removes, replay, trace, view, Action, Fact, Grantee, Holder, Kind, Log, Op, Principal, Refusal,
    Role, Scope, State,
};
use avendb::sync::{asks, digests, frontiers, log_of, receive, respond, respond_since, Ask};

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

const SIGNERS: [SignerId; 11] =
    [PASSKEY_S, MAC_S, PHONE_S, PASSKEY_B, MAC_B, PASSKEY_C, MAC_C, PASSKEY_D, MAC_D, NEW_DEVICE, STRANGER];
const ENTRIES: [EntryId; 3] = [WELCOME, CHARTER, ONBOARDING];
const ROLES: [Role; 4] = [Role::Relay, Role::Read, Role::Write, Role::Owner];
const SEEDS: std::ops::Range<u64> = 1..41;

struct History {
    log: Log,
    vaults: Vec<VaultId>,
    spaces: Vec<SpaceId>,
}

/// A random history on top of scenarios 1 to 4: `n` attempts, each kept only if the rules accept it.
fn history(seed: u64, n: usize) -> History {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let sp = spaces(&mut c, coop);
    let vaults = vec![c.samuel, c.bob, c.carol, c.dave, coop];
    let mut h = History { log: c.log, vaults, spaces: vec![sp.handbook, sp.notes, sp.todos] };
    let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
    attempts(&mut rng, &mut h, n, false);
    h
}

/// `n` random attempts appended to `h`'s log, each kept only if the rules accept it: writes, grants, revocations,
/// devices, coops, aven vaults and owners. New vaults join `h.vaults`. An act for a vault names the owners its author
/// goes through as an honest device's log names them, or, a time in four, a random chain. With `clash`, half of them
/// write with, revoke or remove what the log holds.
fn attempts(rng: &mut Rng, h: &mut History, n: usize, clash: bool) {
    for _ in 0..n {
        if clash && rng.below(2) == 0 {
            let (author, cosigners) = signers(rng);
            if let Some(action) = clash_action(rng, h, author) {
                let _ = h.log.append(author, &cosigners, action);
            }
            continue;
        }
        let author = rng.pick(&SIGNERS);
        let cosigners: Vec<SignerId> = (0..rng.below(4)).map(|_| rng.pick(&SIGNERS)).collect();
        let grants: Vec<GrantId> = h.log.view().grants().into_iter().map(|(id, _)| id).collect();
        let scope = if rng.below(2) == 0 {
            Scope::Space(rng.pick(&h.spaces))
        } else {
            Scope::Entry(rng.pick(&h.spaces), rng.pick(&ENTRIES))
        };
        let action = match rng.below(10) {
            0..=2 => write(rng.pick(&h.spaces), rng.pick(&ENTRIES), rng.pick(&h.vaults), rng.below(3) as u64),
            3 | 4 => {
                let grantee = match rng.below(6) {
                    0 => Grantee::Public,
                    1 => Grantee::Principal(Principal::Signer(rng.pick(&SIGNERS))),
                    _ => vault(rng.pick(&h.vaults)),
                };
                let parent = if grants.is_empty() || rng.below(2) == 0 { None } else { Some(rng.pick(&grants)) };
                grant(scope, rng.pick(&ROLES), grantee, rng.pick(&h.vaults), parent)
            }
            5 if !grants.is_empty() => {
                Action::Revoke { grant: rng.pick(&grants), actor: rng.pick(&h.vaults), keep: vec![], via: vec![] }
            }
            6 => Action::AddDevice { vault: rng.pick(&h.vaults), device: rng.pick(&SIGNERS), seal_to: None },
            7 => Action::RemoveDevice { vault: rng.pick(&h.vaults), device: rng.pick(&SIGNERS), keep: vec![] },
            8 => {
                let (owners, nonce) = (vec![Principal::Vault(rng.pick(&h.vaults))], rng.next());
                // a third of them aven vaults
                let kind = if nonce % 3 == 0 { Kind::Aven } else { Kind::Coop };
                Action::Genesis { kind, owners, threshold: 1, root: None, nonce, seal_to: vec![] }
            }
            _ => Action::AddOwner { vault: rng.pick(&h.vaults), owner: Principal::Vault(rng.pick(&h.vaults)), seal_to: None },
        };
        let action = random_via(&*rng, &h.vaults, action);
        let genesis = matches!(action, Action::Genesis { .. });
        if let Ok(id) = h.log.append(author, &cosigners, action)
            && genesis
        {
            h.vaults.push(VaultId::from(id));
        }
    }
}

/// An act for a vault through a random chain of one or two of `vaults`, a time in four; otherwise as it is. Its
/// randomness comes from `rng`'s state without moving it on, so the other attempts stay as they were.
fn random_via(rng: &Rng, vaults: &[VaultId], mut action: Action) -> Action {
    let mut rng = Rng(rng.0 ^ 0x5851_f42d_4c95_7f2d | 1);
    let chain: Vec<VaultId> = (0..1 + rng.below(2)).map(|_| rng.pick(vaults)).collect();
    let via = match &mut action {
        Action::FoundSpace { via, .. }
        | Action::Grant(_, via)
        | Action::Revoke { via, .. }
        | Action::Write { via, .. }
        | Action::Publish { via, .. } => via,
        _ => return action,
    };
    if rng.below(4) == 0 {
        *via = chain;
    }
    action
}

/// A random write by a vault `author` acts for and that holds write, a revocation of a grant in force, or a device
/// removed: what clashes when made concurrently.
fn clash_action(rng: &mut Rng, h: &History, author: SignerId) -> Option<Action> {
    let st = h.log.view();
    match rng.below(3) {
        0 => {
            let mut targets = vec![];
            for &sp in &h.spaces {
                for e in ENTRIES {
                    for &v in &h.vaults {
                        if st.acts_for(author, v) && st.holds(v, Scope::Entry(sp, e), Role::Write) {
                            targets.push((sp, e, v));
                        }
                    }
                }
            }
            let (sp, e, v) = (!targets.is_empty()).then(|| rng.pick(&targets))?;
            Some(write(sp, e, v, 0))
        }
        1 => {
            let grants = st.grants();
            let (id, g) = (!grants.is_empty()).then(|| grants[rng.below(grants.len())].clone())?;
            Some(Action::Revoke { grant: id, actor: g.issuer, keep: vec![], via: vec![] })
        }
        _ => {
            let devices: Vec<(VaultId, SignerId)> =
                st.vaults().iter().flat_map(|v| v.devices.iter().map(move |&d| (v.id, d))).collect();
            let (vault, device) = (!devices.is_empty()).then(|| rng.pick(&devices))?;
            Some(Action::RemoveDevice { vault, device, keep: vec![] })
        }
    }
}

/// Three devices take one random history offline, each adds its own random attempts, and then all the ops meet:
/// writes, grants and revocations made concurrently with removals that hadn't seen them.
fn forked_caps_history(seed: u64, n: usize) -> History {
    let base = history(seed, n / 2);
    let mut rng = Rng(seed.wrapping_mul(0x2545_f491_4f6c_dd1d) | 1);
    let mut all: Vec<Op> = base.log.ops().to_vec();
    let mut vaults = base.vaults.clone();
    for _ in 0..3 {
        let mut fork = History { log: base.log.clone(), vaults, spaces: base.spaces.clone() };
        attempts(&mut rng, &mut fork, n / 2, true);
        for op in fork.log.ops() {
            if !all.contains(op) {
                all.push(op.clone());
            }
        }
        vaults = fork.vaults;
    }
    History { log: Log::from_ops(all), vaults, spaces: base.spaces }
}

/// Who signs an attempt: half the time every passkey and one random signer, so that approvals pass and the rules'
/// other checks decide; otherwise up to four random signers.
fn signers(rng: &mut Rng) -> (SignerId, Vec<SignerId>) {
    if rng.below(2) == 0 {
        (PASSKEY_S, vec![PASSKEY_B, PASSKEY_C, PASSKEY_D, rng.pick(&SIGNERS)])
    } else {
        (rng.pick(&SIGNERS), (0..rng.below(4)).map(|_| rng.pick(&SIGNERS)).collect())
    }
}

/// A random vault op on `vaults`.
fn vault_action(rng: &mut Rng, vaults: &[VaultId]) -> Action {
    let principal = |rng: &mut Rng| {
        if rng.below(2) == 0 { Principal::Signer(rng.pick(&SIGNERS)) } else { Principal::Vault(rng.pick(vaults)) }
    };
    match rng.below(7) {
        0 => Action::AddDevice { vault: rng.pick(vaults), device: rng.pick(&SIGNERS), seal_to: None },
        1 => Action::RemoveDevice { vault: rng.pick(vaults), device: rng.pick(&SIGNERS), keep: vec![] },
        2 => Action::AddOwner { vault: rng.pick(vaults), owner: principal(rng), seal_to: None },
        3 => Action::RemoveOwner { vault: rng.pick(vaults), owner: principal(rng), keep: vec![] },
        4 => Action::SetThreshold { vault: rng.pick(vaults), threshold: rng.below(4) as u32 },
        _ => {
            // a third human vaults, a twelfth aven vaults
            let x = rng.next();
            let kind = match x % 12 {
                0 | 3 | 6 | 9 => Kind::Human,
                11 => Kind::Aven,
                _ => Kind::Coop,
            };
            let owners: Vec<Principal> = (0..1 + rng.below(3))
                .map(|_| if kind == Kind::Human { Principal::Signer(rng.pick(&SIGNERS)) } else { Principal::Vault(rng.pick(vaults)) })
                .collect();
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

/// A random change to the owners or threshold of a vault `log` knows: what clashes when made concurrently.
fn governance_action(rng: &mut Rng, log: &Log, vaults: &[VaultId]) -> Action {
    let st = log.view();
    let known: Vec<VaultId> = vaults.iter().copied().filter(|&v| st.vault(v).is_some()).collect();
    let v = rng.pick(&known);
    let owners = st.vault(v).map(|x| x.owners.clone()).unwrap_or_default();
    match rng.below(3) {
        0 => Action::AddOwner { vault: v, owner: Principal::Vault(rng.pick(&known)), seal_to: None },
        1 => Action::RemoveOwner { vault: v, owner: rng.pick(&owners), keep: vec![] },
        _ => Action::SetThreshold { vault: v, threshold: 1 + rng.below(owners.len()) as u32 },
    }
}

/// `n` random vault attempts appended to `log`, each kept only if the rules accept it; new vaults join `vaults`.
/// With `clash`, half of them change owners and thresholds of vaults that exist.
fn vault_attempts(rng: &mut Rng, log: &mut Log, vaults: &mut Vec<VaultId>, n: usize, clash: bool) {
    for _ in 0..n {
        let (author, cosigners) = signers(rng);
        let action = if clash && rng.below(2) == 0 { governance_action(rng, log, vaults) } else { vault_action(rng, vaults) };
        let genesis = matches!(action, Action::Genesis { .. });
        if let Ok(id) = log.append(author, &cosigners, action)
            && genesis
        {
            vaults.push(VaultId::from(id));
        }
    }
}

/// A random history of vault ops on top of scenarios 1 to 3, all on one device: what P1's rules decide. (From P2 the
/// properties also run on `history`, where caps and writes mix with governance.)
fn vault_history(seed: u64, n: usize) -> History {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let mut vaults = vec![c.samuel, c.bob, c.carol, c.dave, coop];
    let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
    vault_attempts(&mut rng, &mut c.log, &mut vaults, n, false);
    History { log: c.log, vaults, spaces: vec![] }
}

/// Three devices take one random history offline, each adds its own random vault ops, and then all the ops meet:
/// concurrent governance, where two changes each fine alone may clash (two adds that close a cycle together, two
/// owners removing each other, an add signed by an owner that a concurrent removal takes out).
fn forked_history(seed: u64, n: usize) -> History {
    let base = vault_history(seed, n / 2);
    let mut rng = Rng(seed.wrapping_mul(0x2545_f491_4f6c_dd1d) | 1);
    let mut vaults = base.vaults.clone();
    let mut all: Vec<Op> = base.log.ops().to_vec();
    for _ in 0..3 {
        let mut log = base.log.clone();
        vault_attempts(&mut rng, &mut log, &mut vaults, n / 2, true);
        for op in log.ops() {
            if !all.contains(op) {
                all.push(op.clone());
            }
        }
    }
    History { log: Log::from_ops(all), vaults, spaces: vec![] }
}

/// Each op in replay order with the states just before and just after it.
fn steps(ops: &[Op]) -> Vec<(Op, State, State)> {
    let states = trace(ops);
    order(ops).into_iter().enumerate().map(|(i, op)| (op, states[i].clone(), states[i + 1].clone())).collect()
}

#[test]
fn t1_authorized_writes() {
    let mut through = 0;
    for seed in SEEDS {
        for h in [history(seed, 60), forked_caps_history(seed, 60)] {
            for (op, before, after) in steps(h.log.ops()) {
                if let Action::Write { space, entry, actor, ref via, .. } = op.action {
                    let new = after.writes(space, entry).contains(&op.id()) && !before.writes(space, entry).contains(&op.id());
                    if new {
                        let acts = before.acts_via(op.author, via, actor) && before.acts_for(op.author, actor);
                        assert!(acts, "seed {seed}");
                        through += usize::from(!via.is_empty());
                        assert!(before.holds(actor, Scope::Entry(space, entry), Role::Write), "seed {seed}");
                    }
                }
            }
        }
    }
    // and some writes go through the owners they name
    assert!(through > 0);
}

#[test]
fn t1_revocation_wins() {
    // a write a step takes the authorization from stays only if the step is a removal that had seen it
    for seed in SEEDS {
        for (op, before, after) in steps(forked_caps_history(seed, 60).log.ops()) {
            for w in after.all_writes() {
                if before.all_writes().contains(w) && before.authorized(w) && !after.authorized(w) {
                    assert!(op.action.keep().is_some_and(|k| k.contains(&w.op)), "seed {seed}: {w:?} after {op:?}");
                }
            }
        }
    }
}

#[test]
fn t2_consent() {
    for (seed, h) in SEEDS.flat_map(|seed| [(seed, vault_history(seed, 60)), (seed, forked_history(seed, 60))]) {
        for (op, before, after) in steps(h.log.ops()) {
            let sigs: Vec<SignerId> = op.sigs().collect();
            for &v in &h.vaults {
                let (Some(a), Some(b)) = (before.vault(v), after.vault(v)) else { continue };
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

/// T21: in every state the rules reach, each vault keeps to its kind: a human vault's owners are signers, a coop's and
/// an aven vault's are human or coop vaults; only human and aven vaults have devices, and only human vaults a root.
#[test]
fn t21_vault_kinds() {
    let mut avens = 0;
    for seed in SEEDS {
        for h in [vault_history(seed, 60), forked_history(seed, 60), history(seed, 60)] {
            for st in trace(h.log.ops()) {
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
            avens += h.log.view().vaults().iter().filter(|v| v.kind == Kind::Aven).count();
        }
    }
    // the histories do found aven vaults
    assert!(avens > 0);
}

/// Devices never govern: a signer that owns no vault and is no vault's root approves for no vault, whatever it acts
/// for (`devices_cannot_govern`).
#[test]
fn devices_cannot_govern() {
    for seed in SEEDS {
        for h in [forked_history(seed, 60), forked_caps_history(seed, 60)] {
            for st in trace(h.log.ops()) {
                let governs = |s: SignerId| {
                    st.vaults().iter().any(|v| v.owners.contains(&Principal::Signer(s)) || v.root == Some(s))
                };
                for s in SIGNERS.into_iter().filter(|&s| !governs(s)) {
                    for v in st.vaults() {
                        assert!(!st.approves(&[s], Principal::Vault(v.id)), "seed {seed}: {s:?} approves for {v:?}");
                    }
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
    for seed in SEEDS {
        for h in [vault_history(seed, 80), forked_history(seed, 80)] {
            // in every state along the way, not only the last
            for st in trace(h.log.ops()) {
                assert!(h.vaults.iter().all(|&v| !owns_itself(&st, v)), "seed {seed}");
            }
        }
    }
}

#[test]
fn t11_vault_logs_converge() {
    // the same vault ops, received in any order, give the same vaults (T11 for P1)
    for seed in SEEDS {
        let ops = forked_history(seed, 60).log.ops().to_vec();
        let st = view(&ops);
        let mut rng = Rng(seed);
        for _ in 0..3 {
            let mut shuffled = ops.clone();
            rng.shuffle(&mut shuffled);
            assert!(view(&shuffled) == st, "seed {seed}");
            assert_eq!(order(&shuffled), order(&ops), "seed {seed}");
        }
    }
}

#[test]
fn forks_really_clash() {
    // the forked histories exercise concurrency: across the seeds, ops that each fork accepted are refused once all
    // the ops meet, among them adds that would close a cycle and removals of an owner already removed elsewhere
    let mut refused = vec![];
    for seed in SEEDS {
        let mut st = State::default();
        for op in order(forked_history(seed, 60).log.ops()) {
            match st.step(&op) {
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
fn t4_grants_name_vaults_and_t8_public_read_only() {
    for seed in SEEDS {
        for (_, g) in history(seed, 60).log.view().grants() {
            assert!(!matches!(g.grantee, Grantee::Principal(Principal::Signer(_))), "seed {seed}: {g:?}");
            assert!(g.grantee != Grantee::Public || g.role == Role::Read, "seed {seed}: {g:?}");
        }
    }
}

#[test]
fn t11_convergence() {
    for seed in SEEDS {
        for h in [history(seed, 60), forked_caps_history(seed, 60)] {
            let ops = h.log.ops().to_vec();
            let st = view(&ops);
            let mut rng = Rng(seed);
            for _ in 0..3 {
                let mut shuffled = ops.clone();
                rng.shuffle(&mut shuffled);
                assert!(view(&shuffled) == st, "seed {seed}");
            }
        }
    }
}

#[test]
fn t14_causally_closed() {
    // in every state along the way, every accepted write builds only on accepted writes of its own entry
    for seed in SEEDS {
        for h in [history(seed, 60), forked_caps_history(seed, 60)] {
            for st in trace(h.log.ops()) {
                let ws = st.all_writes();
                for w in ws {
                    for d in &w.deps {
                        let found = ws.iter().any(|x| x.op == *d && x.space == w.space && x.entry == w.entry);
                        assert!(found, "seed {seed}: {w:?} builds on a write that isn't there");
                    }
                }
            }
        }
    }
}

#[test]
fn t16_strong_removal() {
    let mut cut = 0;
    for seed in SEEDS {
        let ops = forked_caps_history(seed, 60).log.ops().to_vec();
        let (r, states) = (replay(&ops), trace(&ops));
        for (i, x) in r.ops.iter().enumerate() {
            // what each removal that stands after it, and hadn't seen it, takes away
            let hidden: Vec<Fact> = (i + 1..r.ops.len())
                .filter(|&j| r.stood[j] && r.ops[j].action.keep().is_some_and(|k| !k.contains(&x.id())))
                .flat_map(|j| removes(&r.ops, &r.ops[j]))
                .collect();
            if r.stood[i] {
                assert!(states[i].hide(&hidden).step(x).is_ok(), "seed {seed}: {x:?} stands on what a removal took away");
            } else if !x.is_removal() && states[i].step(x).is_ok() {
                cut += 1;
            }
        }
    }
    // and the forks do clash: some ops the state just before them accepts are cut
    assert!(cut > 0);
}

#[test]
fn t18_checkpointed_writes() {
    let (mut counted, mut dropped) = (0, 0);
    for seed in SEEDS {
        let h = forked_caps_history(seed, 60);
        let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
        let mut ops = h.log.ops().to_vec();
        // checkpoints of random writes, each covering more writes of its entry: most by the write's own author, some
        // by any signer, and some covering others' writes too, which the rules refuse
        let ws = h.log.view().all_writes().to_vec();
        for _ in 0..ws.len() / 2 {
            let w = &ws[rng.below(ws.len())];
            let author = if rng.below(4) > 0 { w.author } else { rng.pick(&SIGNERS) };
            let same = ws.iter().filter(|x| x.space == w.space && x.entry == w.entry && x.op != w.op);
            let covers = std::iter::once(w.op).chain(same.filter(|_| rng.below(3) == 0).map(|x| x.op)).collect();
            ops.push(h.log.draft(author, &[], Action::Checkpoint { space: w.space, entry: w.entry, covers }));
        }
        // a peer that no longer trusts the curves counts a write only if a checkpoint by its own author covers it
        let st = replay(&checkpointed(&ops)).state;
        for w in st.all_writes() {
            let vouched = ops.iter().any(|c| {
                c.author == w.author && matches!(&c.action, Action::Checkpoint { covers, .. } if covers.contains(&w.op))
            });
            assert!(vouched, "seed {seed}: {w:?} counts with no checkpoint by its author");
        }
        let all = view(&ops);
        counted += st.all_writes().len();
        dropped += all.all_writes().iter().filter(|w| !st.all_writes().contains(w)).count();
    }
    // the checkpoints cover some writes and leave others out
    assert!(counted > 0 && dropped > 0, "{counted} counted, {dropped} dropped");
}

#[test]
fn honest_logs_keep_all_they_accepted() {
    // every op a device appended stands in its own view: its removals keep everything they had seen
    for seed in SEEDS {
        let h = history(seed, 60);
        let r = replay(h.log.ops());
        assert!(r.stood.iter().all(|&s| s), "seed {seed}");
    }
}

/// A random part of `ops`: each op with even odds.
fn part(rng: &mut Rng, ops: &[Op]) -> Vec<Op> {
    ops.iter().filter(|_| rng.below(2) == 0).cloned().collect()
}

/// The ops of scenarios 1 to 4 that every random history starts with, and a random part of the rest.
fn part_after_cast(rng: &mut Rng, ops: &[Op]) -> Vec<Op> {
    let mut c = cast();
    let coop = with_coop(&mut c);
    spaces(&mut c, coop);
    let n = c.log.ops().len();
    ops[..n].iter().cloned().chain(part(rng, &ops[n..])).collect()
}

fn ids(ops: &[Op]) -> std::collections::HashSet<OpId> {
    ops.iter().map(Op::id).collect()
}

#[test]
fn t19_frontier_sync_loses_nothing() {
    // a device holding any part of the ops, gaps and all, asks a peer holding all of them or another part: it is sent
    // whatever of the peer's whole answer it lacks, nothing beyond that answer (T12), and no more than if it had named
    // only its frontiers
    let mut cut = 0;
    for seed in SEEDS {
        let ops = forked_caps_history(seed, 60).log.ops().to_vec();
        let mut rng = Rng(seed);
        for _ in 0..3 {
            let a = part(&mut rng, &ops);
            let r = if rng.below(2) == 0 { ops.clone() } else { part(&mut rng, &ops) };
            let (held, asked) = (ids(&a), asks(&a));
            let alone = Ask { haves: frontiers(&a), loose: asked.loose.clone() };
            for d in SIGNERS {
                let whole = respond(&r, d);
                let sent = respond_since(&r, d, &asked);
                let lacks = whole.iter().find(|op| !held.contains(&op.id()) && !sent.contains(op));
                assert!(lacks.is_none(), "seed {seed}: {d:?} lacks {lacks:?}");
                assert!(sent.iter().all(|op| whole.contains(op)), "seed {seed}: {d:?} was sent beyond its answer");
                let more = respond_since(&r, d, &alone).len();
                assert!(sent.len() <= more, "seed {seed}: {d:?}");
                cut += more - sent.len();
            }
        }
    }
    // naming ops further back saves something
    assert!(cut > 0);
}

#[test]
fn t19_partial_delivery() {
    // a device sent only part of each answer, any part in any order, asks again until nothing is left: it ends
    // holding everything it may receive, though it held gaps along the way
    for seed in SEEDS {
        let ops = forked_caps_history(seed, 60).log.ops().to_vec();
        let mut rng = Rng(seed);
        let d = rng.pick(&[MAC_S, PHONE_S, MAC_B, MAC_C, MAC_D]);
        let mut held: Vec<Op> = vec![];
        for round in 0.. {
            let sent = respond_since(&ops, d, &asks(&held));
            if sent.is_empty() {
                break;
            }
            assert!(round < 200, "seed {seed}: the answers never run out");
            let mut got = part(&mut rng, &sent);
            rng.shuffle(&mut got);
            held = receive(&held, &got);
        }
        let held = ids(&held);
        assert!(respond(&ops, d).iter().all(|op| held.contains(&op.id())), "seed {seed}");
    }
}

#[test]
fn t13_sync_converges() {
    // two devices holding parts of the ops each ask the other once: for every item each may receive by the other's
    // view, both then hold the same writes and checkpoints of it
    let mut checked = 0;
    for seed in SEEDS {
        let ops = forked_caps_history(seed, 60).log.ops().to_vec();
        let mut rng = Rng(seed);
        for _ in 0..3 {
            let (p, q) = (part_after_cast(&mut rng, &ops), part_after_cast(&mut rng, &ops));
            let (vp, vq) = (view(&p), view(&q));
            let devices = [MAC_S, PHONE_S, MAC_B, MAC_C];
            let pairs = devices.iter().flat_map(|&a| devices.iter().filter(move |&&b| b != a).map(move |&b| (a, b)));
            for (dp, dq) in pairs {
                let p2 = ids(&receive(&p, &respond_since(&q, dp, &asks(&p))));
                let q2 = ids(&receive(&q, &respond_since(&p, dq, &asks(&q))));
                for op in &ops {
                    let Some((sp, e)) = op.item() else { continue };
                    if vq.may_receive(dp, sp, e) && vp.may_receive(dq, sp, e) {
                        assert_eq!(p2.contains(&op.id()), q2.contains(&op.id()), "seed {seed}: {dp:?} and {dq:?}");
                        checked += 1;
                    }
                }
            }
        }
    }
    assert!(checked > 100, "only {checked} items checked");
}

#[test]
fn t19_one_digest_per_log() {
    // two devices hold the same ops of a log exactly when their digests of it are equal
    let (mut same, mut differ) = (0, 0);
    for seed in SEEDS {
        let ops = forked_caps_history(seed, 60).log.ops().to_vec();
        let mut rng = Rng(seed);
        let a = part(&mut rng, &ops);
        // and the same ops with about a quarter more: many logs untouched, some grown
        let more = part(&mut rng, &ops);
        let b = receive(&a, &part(&mut rng, &more));
        let (da, db) = (digests(&a), digests(&b));
        for l in da.keys().chain(db.keys()) {
            let of = |x: &[Op]| -> Vec<OpId> {
                let mut v: Vec<OpId> = x.iter().filter(|o| log_of(x, o) == Some(*l)).map(Op::id).collect();
                v.sort();
                v
            };
            let equal = da.get(l) == db.get(l);
            assert_eq!(equal, of(&a) == of(&b), "seed {seed}: {l:?}");
            if equal { same += 1 } else { differ += 1 }
        }
    }
    assert!(same > 0 && differ > 0);
}

#[test]
fn t12_sync_shares_only_caps() {
    for seed in SEEDS {
        let h = history(seed, 60);
        let st = h.log.view();
        for d in SIGNERS {
            for op in respond(h.log.ops(), d) {
                if let Action::Write { space, entry, .. } = op.action {
                    assert!(st.may_receive(d, space, entry), "seed {seed}: {d:?} got a write it has no cap on");
                }
            }
        }
    }
}


/// Every holder a history can have: each signer, listed in a vault or not anymore, each vault, and everyone.
fn every_holder(st: &State) -> Vec<Holder> {
    let vaults = st.vaults().iter().map(|v| Holder::Vault(v.id));
    SIGNERS.iter().map(|&s| Holder::Signer(s)).chain(vaults).chain([Holder::Everyone]).collect()
}

#[test]
fn t6_forward_secrecy() {
    // in every state along the way, a holder opens the current key of a family only while entitled to it, or while
    // the family is public
    let mut rotated = 0;
    for seed in SEEDS {
        for h in [history(seed, 60), forked_caps_history(seed, 60)] {
            for (op, before, after) in steps(h.log.ops()) {
                for holder in every_holder(&after) {
                    let opened = after.opens(&holder.start(&after));
                    for k in after.key_scopes() {
                        if opened.contains(&after.current(k)) {
                            assert!(holder.entitled(&after, k) || after.public_key(k), "seed {seed}: {holder:?} opens {k:?}");
                        }
                    }
                }
                // which is why the schedule only looks for stale keys after a removal: nothing else makes any
                let stale = after.stale_keys(&before);
                assert!(op.is_removal() || stale.is_empty(), "seed {seed}: {op:?} makes {stale:?} stale");
                rotated += stale.len();
            }
        }
    }
    assert!(rotated > 0);
}

/// `EverReads` of the Lean model over the states `sts`: for each holder, the families it could read at some point,
/// itself, as everyone, or through a vault whose key it held at some point.
fn ever_reads(sts: &[State], holders: &[Holder], families: &[KeyScope]) -> Vec<(Holder, KeyScope)> {
    let at_some_point = |h: Holder, k: KeyScope| sts.iter().any(|st| h.entitled(st, k));
    let mut ever: Vec<(Holder, KeyScope)> = vec![];
    for &h in holders {
        for &k in families {
            if at_some_point(h, k) || sts.iter().any(|st| st.public_key(k)) {
                ever.push((h, k));
            }
        }
    }
    loop {
        let mut more = vec![];
        for &h in holders {
            for &k in families {
                let via = |v: Holder| matches!(v, Holder::Vault(x) if at_some_point(h, KeyScope::Vault(x)));
                if !ever.contains(&(h, k)) && ever.iter().any(|&(v, j)| j == k && via(v)) {
                    more.push((h, k));
                }
            }
        }
        if more.is_empty() {
            return ever;
        }
        ever.extend(more);
    }
}

#[test]
fn t5_confidentiality() {
    // after any history, a holder opens a key of a family, of any epoch, only if over that history it could read
    // the family: newcomers to a vault inherit what the vault could read before them
    let mut inherited = 0;
    for seed in SEEDS {
        for h in [history(seed, 60), forked_caps_history(seed, 60)] {
            let sts = trace(h.log.ops());
            let st = sts.last().unwrap();
            let (holders, families) = (every_holder(st), st.key_scopes());
            let ever = ever_reads(&sts, &holders, &families);
            for &holder in &holders {
                for n in st.opens(&holder.start(st)) {
                    if let KeyName::Scoped(k, e) = n {
                        assert!(ever.contains(&(holder, k)), "seed {seed}: {holder:?} opens {k:?} at {e}");
                        if e < st.epoch(k) && !sts.iter().any(|x| holder.entitled(x, k)) {
                            inherited += 1;
                        }
                    }
                }
            }
        }
    }
    // and some holder does open history from before it could read: through a vault it joined later
    assert!(inherited > 0);
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
    for seed in SEEDS {
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
    for seed in SEEDS {
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
fn lines(repo: &Repo) -> Vec<(Line, Vec<OpId>, Value)> {
    repo.history().lines().into_iter().map(|l| (l, repo.log(l), shown(repo, l))).collect()
}

#[test]
fn t10_branches() {
    // on random histories of one document, edited on random lines by random devices, branched from random versions,
    // and merged and promoted between random lines: a write on one line leaves every other line as it was (T10f); a
    // merge's history is the union of both lines', so merging the other way shows the same and merging again changes
    // nothing (T10g); a promote shows exactly the branch and keeps both histories (T10h); and undoing a line's latest
    // commit gives back the version it built on
    let mut done = [0; 5];
    for seed in SEEDS {
        let mut rng = Rng(seed);
        let mut repo = Repo::new(&document("Welcome", WELCOME_TEXT, MAC_S), MAC_S);
        for _ in 0..12 {
            let before = lines(&repo);
            let ls: Vec<Line> = before.iter().map(|x| x.0).collect();
            let author = rng.pick(&[MAC_S, MAC_B, MAC_C]);
            let (from, into) = (rng.pick(&ls), rng.pick(&ls));
            let what = if from == into { rng.below(3) } else { rng.below(5) };
            done[what] += 1;
            let line = match what {
                0 => {
                    repo.edit(author, into, |i| edit_item(&mut rng, i));
                    into
                }
                1 => {
                    let ops: Vec<OpId> = repo.history().commits().iter().map(|c| c.write.op).collect();
                    let at = rng.pick(&ops);
                    let b = Some(repo.branch(author, &[at], "a branch").expect("a version the repo holds"));
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
                    let union: Vec<OpId> = repo.log(into).into_iter().filter(|&op| op != merge).collect();
                    let mut both: Vec<OpId> = [repo_log(&before, into), repo_log(&before, from)].concat();
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
                    assert!(kept.into_iter().all(|op| log.contains(&op)), "seed {seed}");
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

fn repo_log(lines: &[(Line, Vec<OpId>, Value)], line: Line) -> Vec<OpId> {
    lines.iter().find(|x| x.0 == line).map(|x| x.1.clone()).unwrap_or_default()
}
