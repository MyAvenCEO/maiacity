//! Member caps (`Aven.ID.Member`, A38) against Lean: Maia City's confirm cap is the one `issuers.json` carries, byte
//! for byte; it only confirms (`confirm_only`); and a reader counts a vault as a member only by an authorized confirm
//! on the tree Doc naming a claim that founded it (`member_by_confirm`).

mod common;

use aven_core::{Call, CoreOp, DocId, Facts, Hash, Target, Value, blake3};
use aven_id::caps::{
    Cap, DeviceCap, Reader, Reading, Sig, World, confirm_call, confirm_cap, confirm_op,
    grant_allows, sign_in_op,
};
use common::caps::{Context, Names};
use common::{hex, vectors};
use proptest::prelude::*;

/// Maia City's confirm cap to Aven, as `issuers.json` carries it, and its context.
fn confirm_vector() -> (Names, Context, Cap, serde_json::Value) {
    let v = vectors("issuers.json")
        .into_iter()
        .find(|v| {
            v["name"]
                .as_str()
                .unwrap()
                .starts_with("Maia City's confirm cap to Aven")
        })
        .expect("the confirm cap's vector");
    let names = Names::default();
    let ctx = Context::of(&names, &v["input"]["context"]);
    let cap = names.cap(&v["input"]["chain"][0]);
    let raw = v["input"]["chain"][0].clone();
    (names, ctx, cap, raw)
}

fn tree_of(cap: &Cap) -> DocId {
    match &cap.grant[0].doc {
        Target::Doc { doc, .. } => *doc,
        t => panic!("the confirm cap names the tree Doc, not {t:?}"),
    }
}

#[test]
fn the_confirm_cap_is_the_models() {
    let (_, ctx, cap, raw) = confirm_vector();
    let ours = confirm_cap(
        tree_of(&cap),
        "aven",
        vec![Sig::new("alice-owner", "confirm-aven")],
    );
    assert_eq!(ours, cap);
    assert_eq!(hex(&ours.bytes()), raw["cbor"]);
    assert_eq!(ours.digest().text(), raw["hash"]);
    // a coop issues it by its owners' quorum, no device signing (A28)
    ctx.with(|x| assert_eq!(x.chain_error(std::slice::from_ref(&ours)), None));
    assert_eq!(ours.grant[0].op, confirm_op());
}

fn never(_: &DocId, _: &DocId) -> bool {
    false
}

proptest! {
    /// `confirm_only`: whatever call the confirm cap allows is a confirm, on the tree Doc.
    #[test]
    fn the_confirm_cap_only_confirms(op in 0usize..4, on in 0usize..3, claim in any::<[u8; 32]>()) {
        let tree = DocId(blake3(b"tree"));
        let chat = DocId(blake3(b"chat"));
        let cap = confirm_cap(tree, "aven", vec![]);
        let ops = [confirm_op(), sign_in_op(), CoreOp::Put.id(), CoreOp::Read.id()];
        let call = Call { op: ops[op], params: vec![("claim".into(), Value::Bytes(claim.to_vec()))] };
        let doc = [tree, chat, DocId(blake3(b"other"))][on];
        let f = Facts { id: doc, vault: "v:maia-city".into(), r#type: DocId(blake3(b"t")) };
        let gov = |_: &str, _: &str| false;
        let w = World { gov: &gov, spawned: &never, lists: &never };
        if grant_allows(&w, &cap.grant, &f, &call) {
            prop_assert_eq!(call.op, confirm_op());
            prop_assert_eq!(f.id, tree);
        }
        prop_assert_eq!(grant_allows(&w, &cap.grant, &f, &confirm_call(&Hash(claim))), doc == tree);
    }
}

/// `member_by_confirm`: Aven's device confirms Bob's claim under Maia City's confirm cap, so Bob's vault is a member;
/// without the chain, on another Doc, for another claim, or by a device outside its cap, it is not.
#[test]
fn a_member_only_by_a_confirm() {
    let (_, ctx, cap, _) = confirm_vector();
    let tree = tree_of(&cap);
    let claim = Hash(blake3(b"bob's claim").0);
    let other = Hash(blake3(b"another claim").0);
    let founded = |c: &Hash| (*c == claim).then(|| "bob".to_string());
    let chain = vec![cap.clone()];
    let signer = b"aven-peer".to_vec();
    let device = |grants: Option<Vec<aven_id::caps::Line>>| DeviceCap {
        device: "aven-peer".into(),
        vault: "aven".into(),
        grants,
        branches: aven_id::caps::Branches::Any,
        host: false,
    };
    let mut docs = ctx.docs.clone();
    docs.push(Facts {
        id: tree,
        vault: "v:maia-city".into(),
        r#type: DocId(blake3(b"tree/1")),
    });
    let ctx = Context { docs, ..ctx };
    let chat = DocId(blake3(b"chat"));
    for (name, doc, with_chain, call, grants, expect) in [
        (
            "an authorized confirm of Bob's claim",
            tree,
            true,
            confirm_call(&claim),
            None,
            true,
        ),
        (
            "no chain: Aven's vault doesn't govern Maia City's tree",
            tree,
            false,
            confirm_call(&claim),
            None,
            false,
        ),
        (
            "on another Doc",
            chat,
            true,
            confirm_call(&claim),
            None,
            false,
        ),
        (
            "a confirm of a claim that founded no one",
            tree,
            true,
            confirm_call(&other),
            None,
            false,
        ),
        (
            "a device whose cap allows no confirm",
            tree,
            true,
            confirm_call(&claim),
            Some(vec![]),
            false,
        ),
    ] {
        let e = Reading {
            signer: &signer,
            doc,
            branch: "main",
            chain: if with_chain { &chain } else { &[] },
            calls: vec![call],
            actor: None,
        };
        let dc = device(grants);
        let vault_of = |k: &[u8]| (k == b"aven-peer").then(|| "aven".to_string());
        let dc_of = |k: &[u8]| (k == b"aven-peer").then(|| dc.clone());
        let member = |_: &str| true;
        let got = ctx.with(|x| {
            let gov = |a: &str, b: &str| x.governs(a, b);
            let r = Reader {
                ctx: aven_id::caps::Ctx {
                    tree: x.tree,
                    threshold: x.threshold,
                    in_group: x.in_group,
                    roles: x.roles,
                    facts: x.facts,
                },
                world: World {
                    gov: &gov,
                    spawned: &never,
                    lists: &never,
                },
                member: &member,
                vault_of: &vault_of,
                device_cap: &dc_of,
            };
            r.member(&tree, std::slice::from_ref(&e), &founded, "bob")
        });
        assert_eq!(got, expect, "{name}");
    }
}

/// Member caps and the members a reading makes, against Lean's vectors (`member.json`, `Reader.membersB`).
#[test]
fn members_are_the_models() {
    use aven_id::caps::member_cap;
    let all = vectors("member.json");
    assert!(all.len() >= 9, "{} member vectors", all.len());
    for v in &all {
        let input = &v["input"];
        let names = Names::default();
        if let Some(vault) = input["vault"].as_str() {
            let d = |k: &str| names.doc(input[k].as_str().unwrap());
            let cap = member_cap(d("tree"), d("chat"), d("message"), vault);
            assert_eq!(cap, names.cap(&v["expected"]["cap"]), "{}", v["name"]);
            assert_eq!(
                hex(&cap.bytes()),
                v["expected"]["cap"]["cbor"],
                "{}",
                v["name"]
            );
            assert_eq!(
                cap.digest().text(),
                v["expected"]["cap"]["hash"],
                "{}",
                v["name"]
            );
        } else {
            let got = common::caps::judge_members(input);
            assert_eq!(got, v["expected"], "{}", v["name"]);
        }
    }
}
