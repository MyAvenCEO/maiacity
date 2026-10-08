//! One property per Lean theorem that the rules alone decide, checked on random histories: random signers trying random
//! actions on top of scenarios 1 to 4, kept when the rules accept them, then replayed in other orders. Each property
//! carries its theorem's name; T5 to T7 (keys) and T9, T10, T13 are guarded by the tests the Lean README lists.

mod common;

use common::*;
use vault_db::id::{EntryId, GrantId, SignerId, SpaceId, VaultId};
use vault_db::policy::{order, trace, view, Action, Grantee, Kind, Log, Op, Principal, Role, Scope, State};
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
}

/// A random history on top of scenarios 1 to 4: `n` attempts, each kept only if the rules accept it.
fn history(seed: u64, n: usize) -> History {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let sp = spaces(&mut c, coop);
    let mut vaults = vec![c.samuel, c.bob, c.carol, c.dave, coop];
    let spaces: [SpaceId; 3] = [sp.handbook, sp.notes, sp.todos];
    let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
    for _ in 0..n {
        let author = rng.pick(&SIGNERS);
        let cosigners: Vec<SignerId> = (0..rng.below(4)).map(|_| rng.pick(&SIGNERS)).collect();
        let grants: Vec<GrantId> = c.log.view().grants().into_iter().map(|(id, _)| id).collect();
        let scope = if rng.below(2) == 0 {
            Scope::Space(rng.pick(&spaces))
        } else {
            Scope::Entry(rng.pick(&spaces), rng.pick(&ENTRIES))
        };
        let action = match rng.below(10) {
            0..=2 => write(rng.pick(&spaces), rng.pick(&ENTRIES), rng.pick(&vaults), rng.below(3) as u64),
            3 | 4 => {
                let grantee = match rng.below(6) {
                    0 => Grantee::Public,
                    1 => Grantee::Principal(Principal::Signer(rng.pick(&SIGNERS))),
                    _ => vault(rng.pick(&vaults)),
                };
                let parent = if grants.is_empty() || rng.below(2) == 0 { None } else { Some(rng.pick(&grants)) };
                grant(scope, rng.pick(&ROLES), grantee, rng.pick(&vaults), parent)
            }
            5 if !grants.is_empty() => Action::Revoke { grant: rng.pick(&grants), actor: rng.pick(&vaults), keep: vec![] },
            6 => Action::AddDevice { vault: rng.pick(&vaults), device: rng.pick(&SIGNERS) },
            7 => Action::RemoveDevice { vault: rng.pick(&vaults), device: rng.pick(&SIGNERS), keep: vec![] },
            8 => {
                let owners = vec![Principal::Vault(rng.pick(&vaults))];
                Action::Genesis { kind: Kind::Coop, owners, threshold: 1, nonce: rng.next() }
            }
            _ => Action::AddOwner { vault: rng.pick(&vaults), owner: Principal::Vault(rng.pick(&vaults)) },
        };
        let genesis = matches!(action, Action::Genesis { .. });
        if let Ok(id) = c.log.append(author, &cosigners, action) {
            if genesis {
                vaults.push(VaultId::from(id));
            }
        }
    }
    History { log: c.log, vaults }
}

/// Each op in replay order with the states just before and just after it.
fn steps(ops: &[Op]) -> Vec<(Op, State, State)> {
    let states = trace(ops);
    order(ops).into_iter().enumerate().map(|(i, op)| (op, states[i].clone(), states[i + 1].clone())).collect()
}

#[test]
#[ignore = "P2: caps"]
fn t1_authorized_writes() {
    for seed in SEEDS {
        for (op, before, after) in steps(history(seed, 60).log.ops()) {
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

#[test]
#[ignore = "P1: vaults"]
fn t2_consent() {
    for seed in SEEDS {
        let h = history(seed, 60);
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
#[ignore = "P1: vaults"]
fn t3_no_cycles() {
    for seed in SEEDS {
        let h = history(seed, 80);
        let st = h.log.view();
        assert!(h.vaults.iter().all(|&v| !owns_itself(&st, v)), "seed {seed}");
    }
}

#[test]
#[ignore = "P2: caps"]
fn t4_grants_name_vaults_and_t8_public_read_only() {
    for seed in SEEDS {
        for (_, g) in history(seed, 60).log.view().grants() {
            assert!(!matches!(g.grantee, Grantee::Principal(Principal::Signer(_))), "seed {seed}: {g:?}");
            assert!(g.grantee != Grantee::Public || g.role == Role::Read, "seed {seed}: {g:?}");
        }
    }
}

#[test]
#[ignore = "P2: caps"]
fn t11_convergence() {
    for seed in SEEDS {
        let ops = history(seed, 60).log.ops().to_vec();
        let st = view(&ops);
        let mut rng = Rng(seed);
        for _ in 0..3 {
            let mut shuffled = ops.clone();
            rng.shuffle(&mut shuffled);
            assert!(view(&shuffled) == st, "seed {seed}");
        }
    }
}

#[test]
#[ignore = "P2: caps decide what syncs"]
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
