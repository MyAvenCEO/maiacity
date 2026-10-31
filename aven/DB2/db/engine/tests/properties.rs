//! The Lean theorems, as properties over random inputs (`Engine.Query`, `Engine.Mutate`):
//! - `length_le_bound`, `work_le_cost`: what a query yields never exceeds its bound, nor its work its cost;
//! - `refused_changes_nothing`: a refused commit leaves the Doc as it was;
//! - `refs_point_backward`: in an accepted commit every reference names an earlier `put`;
//! - `commit_within`, `honest_footprint`: a commit that ran as its ops say passes every reader's check of its diff,
//!   and the verdict's footprint part on the changes it makes, on a Doc whose Records have distinct ids;
//! - `created_distinct`, `ids_differ_across`: one commit's new ids differ, and differ from another commit's.

use aven_core::{DocId, Hash, TypeId, Value};
use aven_db_engine::{
    Cell, Cmp, NewId, Op, Query, Rec, Record, apply, bound, changes_from, check, commit, cost,
    created, eval, footprint, in_scope, verdict_footprint, work,
};
use proptest::prelude::*;

fn ty(i: u8) -> DocId {
    DocId(Hash([i; 32]))
}

fn val() -> impl Strategy<Value = Value> {
    prop_oneof![
        (0u64..4).prop_map(Value::Uint),
        (0u64..2).prop_map(Value::Nint),
        prop::sample::select(vec!["a", "b"]).prop_map(|s| Value::Text(s.into())),
        Just(Value::Null),
    ]
}

fn col() -> impl Strategy<Value = String> {
    prop::sample::select(vec!["k", "x"]).prop_map(String::from)
}

fn fields() -> impl Strategy<Value = Vec<(String, Value)>> {
    prop::collection::vec((col(), val()), 0..3)
}

fn rec() -> impl Strategy<Value = Rec> {
    (0u8..3, 0u8..2, fields()).prop_map(|(d, t, fields)| Rec {
        doc: ty(10 + d),
        r#type: ty(t),
        fields,
    })
}

fn query() -> impl Strategy<Value = Query> {
    let leaf = (0u8..2).prop_map(|t| Query::Scan(ty(t)));
    leaf.prop_recursive(3, 16, 2, |q| {
        let b = |q: Query| Box::new(q);
        prop_oneof![
            (
                col(),
                prop::sample::select(vec![Cmp::Eq, Cmp::Ne, Cmp::Lt, Cmp::Le]),
                val(),
                q.clone()
            )
                .prop_map(move |(col, cmp, value, q)| Query::Filter {
                    col,
                    cmp,
                    value,
                    query: b(q)
                }),
            (prop::collection::vec(col(), 0..3), q.clone())
                .prop_map(move |(cols, q)| Query::Project { cols, query: b(q) }),
            (q.clone(), q.clone(), col(), col()).prop_map(move |(l, r, lcol, rcol)| Query::Join {
                left: b(l),
                right: b(r),
                lcol,
                rcol
            }),
            (q.clone(), q.clone(), col(), col()).prop_map(move |(l, r, lcol, rcol)| {
                Query::LeftJoin {
                    left: b(l),
                    right: b(r),
                    lcol,
                    rcol,
                }
            }),
            (q.clone(), q.clone(), col(), col()).prop_map(move |(l, r, lcol, rcol)| Query::Anti {
                left: b(l),
                right: b(r),
                lcol,
                rcol
            }),
            (col(), q.clone()).prop_map(move |(col, q)| Query::Order { col, query: b(q) }),
            (col(), q.clone()).prop_map(move |(col, q)| Query::Group { col, query: b(q) }),
            (0u64..4, q).prop_map(move |(n, q)| Query::Limit { n, query: b(q) }),
        ]
    })
}

fn new_id() -> impl Strategy<Value = NewId> {
    (1u64..3, 0u64..3, 0u64..3).prop_map(|(writer, counter, index)| NewId {
        writer,
        counter,
        index,
    })
}

fn record() -> impl Strategy<Value = Record> {
    (new_id(), 0u8..2, fields()).prop_map(|(id, t, fields)| Record {
        id,
        r#type: ty(t),
        fields,
    })
}

fn op() -> impl Strategy<Value = Op> {
    let cell = prop_oneof![val().prop_map(Cell::Lit), (0u64..5).prop_map(Cell::Ref)];
    prop_oneof![
        (0u8..2, prop::collection::vec((col(), cell), 0..3)).prop_map(|(t, fields)| Op::Put {
            r#type: ty(t),
            fields
        }),
        (0u8..2, fields(), fields()).prop_map(|(t, w, set)| Op::Patch {
            r#type: ty(t),
            r#where: w,
            set
        }),
        (0u8..2, fields()).prop_map(|(t, w)| Op::Remove {
            r#type: ty(t),
            r#where: w
        }),
        (0u8..2, new_id(), col(), val()).prop_map(|(t, id, field, value)| Op::Edit {
            r#type: ty(t),
            id,
            field,
            value
        }),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2000))]

    #[test]
    fn length_le_bound_and_work_le_cost(
        db in prop::collection::vec(rec(), 0..8),
        held in prop::collection::vec(any::<bool>(), 3),
        q in query(),
    ) {
        let docs = [ty(10), ty(11), ty(12)];
        let held = |d: &DocId| docs.iter().position(|x| x == d).is_some_and(|i| held[i]);
        let src = |t: &DocId| in_scope(&db, &docs, &held, t);
        // any upper bound per type will do: the database's own counts
        let n = |t: &DocId| db.iter().filter(|r| r.r#type == *t).count() as u64;
        prop_assert!(eval(&src, &q).len() as u64 <= bound(&n, &q));
        prop_assert!(work(&src, &q) <= cost(&n, &q));
    }

    #[test]
    fn commits(
        w in 1u64..3,
        c in 0u64..3,
        s in prop::collection::vec(record(), 0..5),
        ops in prop::collection::vec(op(), 0..6),
    ) {
        match commit(w, c, &s, &ops) {
            Err(_) => prop_assert_eq!(apply(w, c, &s, &ops), s),
            Ok(after) => {
                prop_assert_eq!(apply(w, c, &s, &ops), after.clone());
                prop_assert!(check(&ops, &s, &after));
                let distinct = s.iter().enumerate().all(|(i, r)| s[i + 1..].iter().all(|x| x.id != r.id));
                if distinct {
                    let ver = |t: &DocId| TypeId { r#type: *t, schema: Hash([7; 32]) };
                    prop_assert!(verdict_footprint(&footprint(&ops), &changes_from(&ver, &s, &after)));
                }
                for (i, op) in ops.iter().enumerate() {
                    for n in op.refs() {
                        prop_assert!(n < i as u64 && ops[n as usize].is_put());
                    }
                }
            }
        }
        let ids = created(w, c, &ops);
        for (i, a) in ids.iter().enumerate() {
            prop_assert!(ids[i + 1..].iter().all(|b| a != b));
            prop_assert!(created(w + 1, c, &ops).iter().chain(&created(w, c + 1, &ops)).all(|b| a != b));
        }
    }
}
