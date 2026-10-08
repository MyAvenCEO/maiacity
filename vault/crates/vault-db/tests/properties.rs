//! One property per Lean theorem that the rules alone decide, checked on random histories: random signers trying random
//! actions on top of scenarios 1 to 4, kept when the rules accept them, then replayed in other orders; and forked ones,
//! where devices that were offline meet with concurrent changes. Each property carries its theorem's name; T7 (the
//! blind server, which follows from T5) and T9, T10, T13 are guarded by the tests the Lean README lists.

mod common;

use common::*;
use vault_db::id::{EntryId, GrantId, SignerId, SpaceId, VaultId};
use vault_db::keys::{KeyName, KeyScope};
use vault_db::policy::{
    order, removes, replay, trace, view, Action, Fact, Grantee, Holder, Kind, Log, Op, Principal, Refusal, Role, Scope,
    State,
};
use vault_db::sync::respond;

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
/// devices, coops and owners. New vaults join `h.vaults`. With `clash`, half of them write with, revoke or remove
/// what the log holds.
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
            5 if !grants.is_empty() => Action::Revoke { grant: rng.pick(&grants), actor: rng.pick(&h.vaults), keep: vec![] },
            6 => Action::AddDevice { vault: rng.pick(&h.vaults), device: rng.pick(&SIGNERS), seal_to: None },
            7 => Action::RemoveDevice { vault: rng.pick(&h.vaults), device: rng.pick(&SIGNERS), keep: vec![] },
            8 => {
                let owners = vec![Principal::Vault(rng.pick(&h.vaults))];
                Action::Genesis { kind: Kind::Coop, owners, threshold: 1, root: None, nonce: rng.next(), seal_to: vec![] }
            }
            _ => Action::AddOwner { vault: rng.pick(&h.vaults), owner: Principal::Vault(rng.pick(&h.vaults)), seal_to: None },
        };
        let genesis = matches!(action, Action::Genesis { .. });
        if let Ok(id) = h.log.append(author, &cosigners, action)
            && genesis
        {
            h.vaults.push(VaultId::from(id));
        }
    }
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
            Some(Action::Revoke { grant: id, actor: g.issuer, keep: vec![] })
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
            let kind = if rng.below(3) == 0 { Kind::Human } else { Kind::Coop };
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
    for seed in SEEDS {
        for h in [history(seed, 60), forked_caps_history(seed, 60)] {
            for (op, before, after) in steps(h.log.ops()) {
                if let Action::Write { space, entry, actor, .. } = op.action {
                    let new = after.writes(space, entry).contains(&op.id()) && !before.writes(space, entry).contains(&op.id());
                    if new {
                        assert!(before.acts_for(op.author, actor), "seed {seed}");
                        assert!(before.holds(actor, Scope::Entry(space, entry), Role::Write), "seed {seed}");
                    }
                }
            }
        }
    }
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
fn honest_logs_keep_all_they_accepted() {
    // every op a device appended stands in its own view: its removals keep everything they had seen
    for seed in SEEDS {
        let h = history(seed, 60);
        let r = replay(h.log.ops());
        assert!(r.stood.iter().all(|&s| s), "seed {seed}");
    }
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
