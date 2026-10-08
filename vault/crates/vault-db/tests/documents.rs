//! Documents, schemas and branches (P4, P5; T9, T10, T11): the lenses, migration, promote, and convergence of items.

mod common;

use common::*;
use vault_db::branch::Repo;
use vault_db::doc::Item;
use vault_db::lens::{migrate, AnyBlock, BlockV1, DocV1, KindV1, Status, TodoV1, TodoV2};

fn welcome_v1() -> DocV1 {
    let block = |id, kind, text: &str| BlockV1 { id, kind, text: text.into() };
    DocV1 {
        title: "Welcome".into(),
        blocks: vec![
            block(1, KindV1::H1, "Welcome"),
            block(2, KindV1::P, WELCOME_TEXT),
            block(3, KindV1::H2, "First steps"),
            block(4, KindV1::Li, "Water the seedlings"),
            block(5, KindV1::Code, "open greenhouse --at 8"),
        ],
    }
}

#[test]
#[ignore = "P4: lenses"]
fn lens_round_trip_v1() {
    // v1 → v2 → v1 returns the same document and the same todo (T9a, T9d)
    let doc = welcome_v1();
    assert_eq!(doc.fwd().bwd(), doc);
    for done in [false, true] {
        let todo = TodoV1 { title: "Fix the greenhouse door".into(), done, notes: "hinge".into(), due: Some("2026-10-10".into()) };
        assert_eq!(todo.fwd().bwd(), todo);
    }
    // v2 → v1 → v2 too, for what v1 can say (T9b, T9e); a todo in progress reads as not done in v1
    let v2 = doc.fwd();
    assert_eq!(v2.bwd().fwd(), v2);
    let doing = TodoV2 { title: "Order seeds".into(), status: Status::Doing, notes: String::new(), due: None };
    assert!(!doing.bwd().done);
}

#[test]
#[ignore = "P4: migration"]
fn migration_is_idempotent() {
    // after concurrent edits a document can hold blocks in both shapes; migrating twice equals migrating once (T9c)
    let v1 = welcome_v1();
    let mut blocks: Vec<AnyBlock> = v1.blocks.iter().cloned().map(AnyBlock::V1).collect();
    blocks.insert(2, AnyBlock::V2(paragraph(9, "written by a v2 app")));
    let once = migrate(&blocks);
    assert!(once.iter().all(|b| matches!(b, AnyBlock::V2(_))));
    assert_eq!(migrate(&once), once);
    // and on an item: the migration commit run a second time changes nothing
    let mut item = Item::written_v1(&v1, MAC_S);
    item.migrate();
    let after = item.version();
    item.migrate();
    assert_eq!(item.version(), after);
}

#[test]
#[ignore = "P5: branches"]
fn promote_equals_branch() {
    let mut repo = Repo::new(document("Welcome", WELCOME_TEXT, MAC_S));
    repo.commit("main", "Welcome");
    repo.branch("rewrite", "main");
    repo.item_mut("rewrite").set_text(2, "Welcome to the coop, rewritten");
    repo.commit("rewrite", "rewrite");
    // main moves on meanwhile
    repo.item_mut("main").push_block(paragraph(3, "an edit on main"));
    repo.commit("main", "meanwhile");
    repo.promote("rewrite", "main");
    // main shows exactly the branch's content (T10d) and keeps both histories (T10e)
    assert_eq!(repo.item("main").as_document(), repo.item("rewrite").as_document());
    let log: Vec<String> = repo.log("main").into_iter().map(|c| c.message).collect();
    for m in ["Welcome", "rewrite", "meanwhile"] {
        assert!(log.iter().any(|l| l == m), "{m} missing from {log:?}");
    }
}

#[test]
#[ignore = "P4: Loro items"]
fn same_ops_any_order_same_result() {
    // Samuel and Bob edit the same block at the same moment on their own copies
    let base = document("Welcome", WELCOME_TEXT, MAC_S);
    let start = base.version();
    let (mut samuels, mut bobs) = (base.fork_as(MAC_S), base.fork_as(MAC_B));
    samuels.set_text(2, "Samuel's version");
    bobs.set_text(2, "Bob's version");
    bobs.push_block(paragraph(3, "Bob adds a line"));
    let (from_samuel, from_bob) = (samuels.export(&start), bobs.export(&start));
    // two more devices receive both edits in opposite orders
    let (mut carols, mut daves) = (base.fork_as(MAC_C), base.fork_as(MAC_D));
    carols.import(&from_samuel, MAC_S).unwrap();
    carols.import(&from_bob, MAC_B).unwrap();
    daves.import(&from_bob, MAC_B).unwrap();
    daves.import(&from_samuel, MAC_S).unwrap();
    samuels.import(&from_bob, MAC_B).unwrap();
    bobs.import(&from_samuel, MAC_S).unwrap();
    // every device shows the same document (T11)
    let shown = [&samuels, &bobs, &carols, &daves].map(|i| i.as_document());
    assert!(shown.iter().all(|d| d.is_some() && *d == shown[0]));
}

#[test]
#[ignore = "P4: Loro items"]
fn an_update_from_the_wrong_peer_is_refused() {
    // Bob's edits carry his Loro peer; the same bytes claimed as Carol's are refused before import
    let base = document("Welcome", WELCOME_TEXT, MAC_S);
    let start = base.version();
    let mut bobs = base.fork_as(MAC_B);
    bobs.set_text(2, "Bob's version");
    let update = bobs.export(&start);
    let mut samuels = base.fork_as(MAC_S);
    assert_eq!(samuels.import(&update, MAC_C), Err(vault_db::doc::DocError::WrongPeer));
    assert_eq!(samuels.import(b"not a loro update", MAC_B), Err(vault_db::doc::DocError::Malformed));
    assert!(samuels.import(&update, MAC_B).is_ok());
}
