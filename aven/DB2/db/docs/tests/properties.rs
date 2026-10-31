//! Property tests over random histories: peers that exchange envelopes in any order converge on the same Records and
//! version (`Loro.converges`), what a Doc counts is exactly Core's `Counts` with fit and authorized as its verdicts
//! (`countsB_iff`), a revocation only narrows (`revocation_narrows`), and the body and limits hold their laws.

mod common;

use std::collections::BTreeSet;

use aven_core::{Envelope, Held, Value};
use aven_db_docs::limits::{Limits, capped};
use aven_db_docs::{Body, Doc};
use common::*;
use proptest::prelude::*;

/// Three devices commit in turn, each after importing a random subset of what the others wrote.
fn history(steps: &[(usize, u8, u8)]) -> (aven_db_docs::Genesis, Vec<Vec<u8>>) {
    let ds = [device("p0"), device("p1"), device("p2")];
    let g = genesis(&ds[0]);
    let mut docs: Vec<Doc> = (0..3).map(|_| open(&g)).collect();
    let mut all: Vec<Vec<u8>> = vec![];
    for &(who, mask, val) in steps {
        for (i, b) in all.iter().enumerate() {
            if mask >> (i % 8) & 1 == 1 {
                docs[who].import(b, &Allow).unwrap();
            }
        }
        let id = format!("t{}", val % 4);
        let w = if docs[who].snapshot().records.contains_key(&id) {
            put(
                &id,
                todo_type(),
                vec![("count", Value::Uint(u64::from(val) % 101))],
            )
        } else {
            todo_put(&id, "born")
        };
        match docs[who].commit(
            &ds[who],
            0,
            &[w],
            "2026-10-31T12:00:00Z",
            aven_db_docs::Act::default(),
            &Allow,
        ) {
            Ok(b) => all.push(b),
            // a write of the value a field already holds changes nothing, so there is nothing to commit
            Err(aven_db_docs::CommitError::Empty) => {}
            Err(e) => panic!("{e:?}"),
        }
    }
    (g, all)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(24))]

    #[test]
    fn any_order_converges(steps in proptest::collection::vec((0usize..3, any::<u8>(), any::<u8>()), 1..10), seed in any::<u64>()) {
        let (g, all) = history(&steps);
        let mut a = open(&g);
        for b in &all {
            a.import(b, &Allow).unwrap();
        }
        // the same envelopes in another order: what waits is taken once its past arrives
        let mut order: Vec<usize> = (0..all.len()).collect();
        let mut s = seed;
        for i in (1..order.len()).rev() {
            s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            order.swap(i, (s >> 33) as usize % (i + 1));
        }
        let mut b = open(&g);
        for i in order {
            b.import(&all[i], &Allow).unwrap();
        }
        prop_assert_eq!(b.waiting(), 0);
        prop_assert_eq!(a.snapshot(), b.snapshot());
        let names: Vec<_> = all.iter().map(|x| Envelope::decode(x).unwrap().name()).collect();
        prop_assert!(names.iter().all(|n| a.counts(n) && b.counts(n)));
    }

    #[test]
    fn counts_is_cores_counts_and_revocation_narrows(steps in proptest::collection::vec((0usize..3, any::<u8>(), any::<u8>()), 1..10), deny in any::<u16>()) {
        let (g, all) = history(&steps);
        let envs: Vec<Envelope> = all.iter().map(|b| Envelope::decode(b).unwrap()).collect();
        let denied: BTreeSet<_> = envs.iter().enumerate().filter(|(i, _)| deny >> (i % 16) & 1 == 1).map(|(_, e)| e.name()).collect();
        let mut d = open(&g);
        for b in &all {
            d.import(b, &Allow).unwrap();
        }
        let before: BTreeSet<_> = envs.iter().map(Envelope::name).filter(|n| d.counts(n)).collect();
        let dn = denied.clone();
        d.reauthorize(&When(move |e: &Envelope, _: &Body| !dn.contains(&e.name())));
        let held = Held::new(&envs);
        for e in &envs {
            prop_assert_eq!(d.counts(&e.name()), held.counts(e, |_| true, |x| !denied.contains(&x.name()), |_| false));
        }
        let after: BTreeSet<_> = envs.iter().map(Envelope::name).filter(|n| d.counts(n)).collect();
        prop_assert!(after.is_subset(&before));
    }

    #[test]
    fn body_round_trips(generation in any::<u64>(), from in 0u64..1000, len in 0u64..1000, changes in proptest::collection::vec(any::<u8>(), 0..64), at in ".{0,20}", ids in proptest::collection::btree_set("[a-z0-9]{1,6}", 0..5)) {
        let mut records: Vec<_> = ids.into_iter().map(|i| (i, todo_type())).collect();
        records.sort_by(|a, b| aven_db_docs::codec_order(&a.0, &b.0));
        let b = Body { generation, from, to: from + len, records, changes, at, cap: Some(hash("cap")), acks: vec![hash("a")], calls: vec![], genesis: None };
        let back = Body::of_value(&aven_core::decode(&aven_core::encode(&b.value())).unwrap());
        prop_assert_eq!(back, Some(b));
    }

    #[test]
    fn a_capped_read_stays_within(limit in 0usize..4096, chunks in proptest::collection::vec(proptest::collection::vec(any::<u8>(), 0..512), 0..20)) {
        let total: usize = chunks.iter().map(Vec::len).sum();
        let got = capped(limit, chunks.iter().map(Vec::as_slice));
        if total <= limit {
            prop_assert_eq!(got, Some(chunks.concat()));
        } else {
            prop_assert_eq!(got, None);
        }
    }
}

#[test]
fn limits_are_the_models() {
    let l = Limits::DEFAULTS;
    assert_eq!(
        (l.sealed, l.depth, l.fanout, l.records, l.ops),
        (1 << 20, 256, 256, 4096, 65536)
    );
    assert_eq!((l.segment_envelopes, l.segment_bytes), (256, 1 << 20));
    // the Lean's #guards
    assert_eq!(
        aven_db_docs::limits::depth(&Value::Array(vec![
            Value::Array(vec![Value::Uint(1)]),
            Value::Map(vec![("a".into(), Value::Null)])
        ])),
        2
    );
    assert_eq!(capped(4, [&[1u8, 2][..], &[3]]), Some(vec![1, 2, 3]));
    assert_eq!(capped(4, [&[1u8, 2][..], &[3, 4, 5]]), None);
    assert!(!l.segment_fits(&[1; 257]));
}
