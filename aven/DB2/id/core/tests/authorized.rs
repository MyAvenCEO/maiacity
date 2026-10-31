//! The reader's verdict on an envelope's calls (`Aven.ID.Authorized`) as properties: the model exports no vectors for
//! it, so its theorems are checked on random readings over every chain in `caps.json` (good and bad), with random
//! signers, Docs, branches, calls, device caps and merges. Each property names the theorem it holds the code to.

mod common;

use aven_core::{Call, CoreOp, DocId, Facts, OpId, Value as V};
use aven_id::Tree;
use aven_id::caps::{
    Branches, Cap, DeviceCap, Line, Path, Reader, Reading, World, grant_allows, vault_id,
};
use common::caps::{Context, Names};
use common::vectors;
use proptest::prelude::*;
use proptest::test_runner::{Config, TestRunner};

const DEVICES: [&str; 5] = [
    "alice-peer",
    "alice-peer-light",
    "bob-peer-light",
    "aven-peer",
    "mallory",
];
use std::sync::atomic::{AtomicUsize, Ordering};

/// How many draws each verdict took, so the properties are known not to hold vacuously.
static OWN: AtomicUsize = AtomicUsize::new(0);
static CHAIN: AtomicUsize = AtomicUsize::new(0);
static REFUSED: AtomicUsize = AtomicUsize::new(0);

const BRANCHES: [&str; 3] = ["main", "fix-title", "other"];

/// One chain vector, read.
struct Case {
    name: String,
    ctx: Context,
    chain: Vec<Cap>,
}

fn cases() -> Vec<Case> {
    vectors("caps.json")
        .into_iter()
        .filter(|v| v["input"].get("chain").is_some())
        .map(|v| {
            let names = Names::default();
            let ctx = Context::of(&names, &v["input"]["context"]);
            let chain = v["input"]["chain"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| names.cap(c))
                .collect();
            Case {
                name: v["name"].as_str().unwrap().into(),
                ctx,
                chain,
            }
        })
        .collect()
}

/// A random reading of an envelope, and the device cap its signer holds.
#[derive(Clone, Debug)]
struct Draw {
    signer: usize,
    doc: usize,
    branch: usize,
    calls: Vec<(usize, Option<usize>)>,
    merge: Vec<(usize, Option<usize>)>,
    /// None: no device cap; else (lines picked from the chain's, or all its vault may do; branches; host; a wrong
    /// vault)
    device: Option<(Option<Vec<usize>>, usize, bool, bool)>,
    actor: bool,
    /// Drop the chain: write on own authority.
    own: bool,
}

fn draw() -> impl Strategy<Value = Draw> {
    let call = (0usize..16, proptest::option::of(0usize..3));
    (
        0usize..DEVICES.len() + 4,
        0usize..12,
        0usize..BRANCHES.len(),
        proptest::collection::vec(call.clone(), 0..3),
        proptest::collection::vec(call, 0..3),
        proptest::option::weighted(
            0.9,
            (
                proptest::option::of(proptest::collection::vec(0usize..8, 0..4)),
                0usize..4,
                any::<bool>(),
                proptest::bool::weighted(0.1),
            ),
        ),
        any::<bool>(),
        proptest::bool::weighted(0.25),
    )
        .prop_map(
            |(signer, doc, branch, calls, merge, device, actor, own)| Draw {
                signer,
                doc,
                branch,
                calls,
                merge,
                device,
                actor,
                own,
            },
        )
}

/// The ops a draw calls: every op the chain's lines name, then `core/1`'s.
fn ops(chain: &[Cap], roles: &[aven_id::caps::Role]) -> Vec<OpId> {
    let mut ops: Vec<OpId> = chain
        .iter()
        .flat_map(|c| c.grants(roles).iter().map(|l| l.op))
        .collect();
    ops.extend(CoreOp::ALL.iter().map(|o| o.id()));
    ops
}

fn calls(picks: &[(usize, Option<usize>)], ops: &[OpId]) -> Vec<Call> {
    let types = ["tasks", "notes", "photos"];
    picks
        .iter()
        .map(|&(o, t)| Call {
            op: ops[o % ops.len()],
            params: t
                .map(|t| ("type".to_string(), V::Bytes(types[t].as_bytes().to_vec())))
                .into_iter()
                .collect(),
        })
        .collect()
}

fn branches(i: usize) -> Branches {
    match i {
        0 => Branches::Any,
        1 => Branches::Main,
        2 => Branches::Proposals,
        _ => Branches::One("fix-title".into()),
    }
}

/// The cast's governance, as Core's targets name vaults.
fn gov(t: &Tree, v: &str, w: &str) -> bool {
    v.strip_prefix("v:")
        .is_some_and(|v| t.governs(v).into_iter().any(|g| vault_id(g) == w))
}

fn check(case: &Case, d: &Draw) -> Result<(), TestCaseError> {
    let x = &case.ctx;
    let t = &x.tree;
    let lines: Vec<Line> = case
        .chain
        .iter()
        .flat_map(|c| c.grants(&x.roles).to_vec())
        .collect();
    let ops = ops(&case.chain, &x.roles);
    // past the cast's devices: a device of the vault holding the chain's last cap, so the chain path is reached
    let held_by = case.chain.last().and_then(|c| match &c.holder {
        aven_id::caps::Holder::Vault(v) => t.acts_through(v).first().copied(),
        _ => None,
    });
    let device = DEVICES
        .get(d.signer)
        .copied()
        .or(held_by)
        .unwrap_or(DEVICES[0]);
    let device_cap = d.device.as_ref().map(|(g, b, host, wrong)| DeviceCap {
        device: device.into(),
        vault: if *wrong {
            "bob".into()
        } else {
            t.acts_for(device).unwrap_or("nobody").into()
        },
        grants: g
            .as_ref()
            .map(|g| g.iter().filter_map(|&i| lines.get(i).cloned()).collect()),
        branches: branches(*b),
        host: *host,
    });
    let docs: Vec<DocId> = x.docs.iter().map(|f| f.id).collect();
    // past the known Docs: the Doc a line of the chain's last cap names, or one the reader doesn't know
    let named = case.chain.last().and_then(|c| {
        c.grants(&x.roles).iter().find_map(|l| match &l.doc {
            aven_core::Target::Doc { doc, .. } => Some(*doc),
            _ => None,
        })
    });
    let doc = docs
        .get(d.doc)
        .copied()
        .or(if d.doc < 11 { named } else { None })
        .unwrap_or(DocId(aven_core::blake3(b"unknown")));
    let branch = BRANCHES[d.branch];
    let chain: &[Cap] = if d.own { &[] } else { &case.chain };
    let reading = Reading {
        signer: device.as_bytes(),
        doc,
        branch,
        chain,
        calls: calls(&d.calls, &ops),
        actor: d.actor.then(|| DocId(aven_core::blake3(b"actor"))),
    };
    let merge = calls(&d.merge, &ops);

    let gov_ = |v: &str, w: &str| gov(t, v, w);
    let never = |_: &DocId, _: &DocId| false;
    let world = World {
        gov: &gov_,
        spawned: &never,
        lists: &never,
    };
    let member = |v: &str| t.vault(v).is_some();
    let vault_of = |k: &[u8]| {
        std::str::from_utf8(k)
            .ok()
            .and_then(|k| t.acts_for(k))
            .map(str::to_string)
    };
    let dc_of = |k: &[u8]| {
        (k == device.as_bytes())
            .then(|| device_cap.clone())
            .flatten()
    };

    x.with(|ctx| {
        let r = Reader {
            ctx: aven_id::caps::Ctx {
                tree: ctx.tree,
                threshold: ctx.threshold,
                in_group: ctx.in_group,
                roles: ctx.roles,
                facts: ctx.facts,
            },
            world,
            member: &member,
            vault_of: &vault_of,
            device_cap: &dc_of,
        };
        let facts: Option<Facts> = (r.ctx.facts)(&doc);
        let verdict = r.authorized(&reading);
        match verdict {
            Ok(Path::Own) => &OWN,
            Ok(Path::Chain) => &CHAIN,
            Err(_) => &REFUSED,
        }
        .fetch_add(1, Ordering::Relaxed);
        let within = r.within_device(&reading);
        let by_chain = r.by_chain(&reading);
        let host = device_cap.as_ref().is_some_and(|dc| dc.host);

        // `Authorized`, both ways: `own_authorized` and `chain_authorized` give it, `authorized_by` takes one path
        let own = r.own(&reading);
        let expected = within.is_ok()
            && ((own && !host) || (by_chain.is_ok() && (!host || reading.actor.is_some())));
        prop_assert_eq!(verdict.is_ok(), expected, "{}: {:?}", case.name, verdict);

        if let Ok(path) = &verdict {
            // `device_within_cap`
            let dc = within.clone().expect("device_within_cap");
            let f = facts
                .clone()
                .expect("an authorized envelope's Doc is known");
            let v = vault_of(reading.signer).expect("a device signs");
            match path {
                // `authorized_vault`, own side: the Doc's vault or one it governs
                Path::Own => {
                    prop_assert!(!host, "host_chain_only");
                    prop_assert!(f.vault == vault_id(&v) || gov(t, &vault_id(&v), &f.vault));
                }
                Path::Chain => {
                    prop_assert!(by_chain.is_ok());
                    let root = &chain[0];
                    let last = chain.last().unwrap();
                    // `chain_signer`
                    prop_assert!(r.holds_at(last, &v));
                    for c in &reading.calls {
                        // `chain_root` (through `narrow_ops`) and `device_and_chain`
                        prop_assert!(grant_allows(&r.world, root.grants(r.ctx.roles), &f, c));
                        prop_assert!(grant_allows(&r.world, last.grants(r.ctx.roles), &f, c));
                        prop_assert!(dc.allows(&r.world, &f, c));
                    }
                    // `chain_root`: every line lies in the root issuer's authority
                    for c in chain {
                        for l in c.grants(r.ctx.roles) {
                            prop_assert!(r.ctx.authority_over(&root.issuer, l));
                        }
                    }
                    // `host_chain_only`
                    prop_assert!(!host || reading.actor.is_some());
                }
            }
        }
        if by_chain.is_ok() {
            // `branch_allowed`
            for c in chain {
                prop_assert!(c.conditions.branches.allows(branch));
            }
        }
        if branch == "main" {
            // `proposals_never_main`
            if chain.iter().any(|c| {
                matches!(
                    c.conditions.branches,
                    Branches::Proposals | Branches::One(_)
                )
            }) {
                prop_assert!(by_chain.is_err());
            }
            // `device_proposals_never_main`
            if device_cap
                .as_ref()
                .is_some_and(|dc| matches!(dc.branches, Branches::Proposals | Branches::One(_)))
            {
                prop_assert!(verdict.is_err());
            }
            // a merge into main, read whole
            let whole = reading.clone().whole(&merge);
            if r.by_chain(&whole).is_ok() {
                // `merge_covered`
                let last = chain.last().unwrap();
                prop_assert!(last.conditions.branches.allows("main"));
                let f = facts.clone().unwrap();
                for c in &merge {
                    prop_assert!(grant_allows(&r.world, last.grants(r.ctx.roles), &f, c));
                }
            }
            if r.authorized(&whole).is_ok() {
                // `merge_within_device`
                let dc = device_cap.clone().unwrap();
                prop_assert!(dc.branches.allows("main"));
                let f = facts.clone().unwrap();
                for c in &merge {
                    prop_assert!(dc.allows(&r.world, &f, c));
                }
            }
        }
        // `narrow_ops`, on a good chain: no cap allows a call its root doesn't, on any Doc the reader knows
        if r.ctx.chain_ok(&case.chain) {
            let root = &case.chain[0];
            for f in &x.docs {
                for c in &reading.calls {
                    for cap in &case.chain {
                        if grant_allows(&r.world, cap.grants(r.ctx.roles), f, c) {
                            prop_assert!(grant_allows(&r.world, root.grants(r.ctx.roles), f, c));
                        }
                    }
                }
            }
            // `root_authority`
            for cap in &case.chain {
                for l in cap.grants(r.ctx.roles) {
                    prop_assert!(r.ctx.authority_over(&root.issuer, l));
                }
            }
        }
        Ok(())
    })
}

#[test]
fn the_verdict_keeps_authorizeds_theorems() {
    let cases = cases();
    assert!(cases.len() >= 90);
    for case in &cases {
        let mut runner = TestRunner::new(Config {
            cases: 128,
            ..Config::default()
        });
        runner
            .run(&draw(), |d| check(case, &d))
            .unwrap_or_else(|e| panic!("{}: {e}", case.name));
    }
    let (own, chain, refused) = (
        OWN.load(Ordering::Relaxed),
        CHAIN.load(Ordering::Relaxed),
        REFUSED.load(Ordering::Relaxed),
    );
    eprintln!("verdicts: {own} on own authority, {chain} under a chain, {refused} refused");
    assert!(own > 100 && chain > 100 && refused > 100);
}

/// Some draws are authorized on each path, so the properties above aren't vacuous.
#[test]
fn both_paths_are_reached() {
    let cases = cases();
    let case = cases
        .iter()
        .find(|c| c.ctx.with(|x| x.chain_ok(&c.chain)) && c.chain.len() == 1)
        .expect("a good one-cap chain");
    let t = &case.ctx.tree;
    let gov_ = |v: &str, w: &str| gov(t, v, w);
    let never = |_: &DocId, _: &DocId| false;
    let member = |_: &str| true;
    let vault_of = |k: &[u8]| {
        std::str::from_utf8(k)
            .ok()
            .and_then(|k| t.acts_for(k))
            .map(str::to_string)
    };
    let dc = |k: &[u8]| {
        let d = std::str::from_utf8(k).unwrap();
        Some(DeviceCap {
            device: d.into(),
            vault: t.acts_for(d)?.into(),
            grants: None,
            branches: Branches::Any,
            host: false,
        })
    };
    let cap = &case.chain[0];
    let holder = match &cap.holder {
        aven_id::caps::Holder::Vault(v) => v.clone(),
        _ => panic!("{}: held by a vault", case.name),
    };
    let device = t.acts_through(&holder).first().copied();
    case.ctx.with(|ctx| {
        let r = Reader {
            ctx: aven_id::caps::Ctx {
                tree: ctx.tree,
                threshold: ctx.threshold,
                in_group: ctx.in_group,
                roles: ctx.roles,
                facts: ctx.facts,
            },
            world: World {
                gov: &gov_,
                spawned: &never,
                lists: &never,
            },
            member: &member,
            vault_of: &vault_of,
            device_cap: &dc,
        };
        // the issuer's own device writes its own Doc on its own authority
        let issuer_device = t.acts_through(&cap.issuer)[0];
        let line = &cap.grants(r.ctx.roles)[0];
        let aven_core::Target::Doc { doc, .. } = &line.doc else {
            panic!("{}: a Doc's line", case.name)
        };
        let call = Call {
            op: line.op,
            params: vec![],
        };
        let own = Reading {
            signer: issuer_device.as_bytes(),
            doc: *doc,
            branch: "main",
            chain: &[],
            calls: vec![call.clone()],
            actor: None,
        };
        assert_eq!(r.authorized(&own), Ok(Path::Own), "{}", case.name);
        {
            let device = device.expect("the holder has a device");
            let held = Reading {
                signer: device.as_bytes(),
                chain: &case.chain,
                ..own
            };
            assert!(line.admits(&call));
            assert_eq!(r.authorized(&held), Ok(Path::Chain), "{}", case.name);
        }
    });
}

/// The reader's verdict against Lean's vectors (`authorized.json`, `Aven.ID.Authorized`): each of its parts, the
/// path and, when refused, which group of reasons. Every expected value is the model's.
#[test]
fn verdicts_are_the_models() {
    let all = vectors("authorized.json");
    assert!(all.len() >= 15, "{} authorized vectors", all.len());
    for v in &all {
        assert_eq!(
            common::caps::judge(&v["input"]),
            v["expected"],
            "{}",
            v["name"]
        );
    }
}

/// Whether a signer's chain reaches a Doc at all, against Lean's vectors (`reach.json`, `Reader.reachesB`).
#[test]
fn reaches_as_the_model_says() {
    let all = vectors("reach.json");
    assert!(all.len() >= 11, "{} reach vectors", all.len());
    for v in &all {
        let got = common::caps::judge_reach(&v["input"]);
        assert_eq!(got, v["expected"], "{}", v["name"]);
    }
}
