//! Documents, schemas and branches (P4, P5; T9, T10, T11): the lenses, edits through a view, promote, and convergence
//! of items.

mod common;

use common::*;
use avendb::branch::{Repo, MAIN};
use avendb::doc::Item;
use serde_json::json;
use avendb::lens::{BlockV1, DocV1, KindV1, Status, TodoV1, TodoV2, TypeV2};

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
fn edits_through_a_view_keep_what_it_cant_see() {
    // Welcome as a v1 app wrote it; a v2 app checks the list item, names the code's language and tags it
    let mut item = Item::written_v1(&welcome_v1(), MAC_S);
    assert!(item.edit_document(|d| {
        d.blocks[3].checked = Some(true);
        d.blocks[4].lang = Some("sh".into());
        d.tags.push("greenhouse".into());
    }));
    // a v1 app edits all it sees: the title, a text, a kind, the order, and a new block
    assert!(item.edit_document_v1(|d| {
        d.title = "Welcome to Maia Coop".into();
        d.blocks[1].text = AFTER_TEXT.into();
        d.blocks[2].kind = KindV1::H3;
        d.blocks.swap(3, 4);
        d.blocks.push(BlockV1 { id: 6, kind: KindV1::P, text: "See you there".into() });
    }));
    // what only v2 says survives (T9h)
    let after = item.as_document().unwrap();
    let block = |id| after.blocks.iter().find(|b| b.id == id).unwrap().clone();
    assert_eq!(after.tags, ["greenhouse"]);
    assert_eq!((block(4).checked, block(5).lang.as_deref()), (Some(true), Some("sh")));
    // and the v1 app's edit shows as made, in v1 and through the lens in v2 (T9f)
    assert_eq!(item.as_document_v1().unwrap().blocks[1].text, AFTER_TEXT);
    assert_eq!(after.title, "Welcome to Maia Coop");
    assert_eq!((block(3).r#type, block(3).level), (TypeV2::Heading, Some(3)));
    assert_eq!(after.blocks.iter().map(|b| b.id).collect::<Vec<_>>(), [1, 2, 3, 5, 4, 6]);
    // its new block is stored as v1 wrote it, with no default filled in
    assert_eq!(item.record()["blocks"][5], json!({"id": 6, "kind": "p", "text": "See you there"}));
    // and either app's view put back unchanged writes nothing (T9g)
    let v = item.version();
    assert!(item.edit_document_v1(|_| {}) && item.edit_document(|_| {}));
    assert_eq!(item.version(), v);
}

#[test]
fn promote_equals_branch() {
    let mut repo = Repo::new(&document("Welcome", WELCOME_TEXT, MAC_S), MAC_S);
    let rewrite = Some(repo.branch(MAC_B, &repo.heads(MAIN), "rewrite").unwrap());
    repo.edit(MAC_B, rewrite, |i| i.set_text(2, "Welcome to the coop, rewritten"));
    // main moves on meanwhile, on the block the branch rewrites and on another
    repo.edit(MAC_S, MAIN, |i| {
        i.set_text(2, "Welcome to Maia Coop: the greenhouse opens at nine.");
        i.push_block(paragraph(3, "an edit on main"));
    });
    let (main, branch) = (repo.log(MAIN), repo.log(rewrite));
    repo.promote(MAC_S, rewrite, MAIN);
    // main shows exactly the branch's content (T10h, from T10d) and keeps both histories (T10e)
    let shown = |line| repo.item(line, MAC_S).map(|i| i.record());
    assert_eq!(shown(MAIN), shown(rewrite));
    assert_eq!(repo.item(MAIN, MAC_C).unwrap().as_document().unwrap().blocks.len(), 2);
    let log = repo.log(MAIN);
    assert!(main.iter().chain(&branch).all(|op| log.contains(op)), "{log:?}");
}

#[test]
fn merge_is_the_union_of_both_lines() {
    let mut repo = Repo::new(&document("Welcome", WELCOME_TEXT, MAC_S), MAC_S);
    let draft = Some(repo.branch(MAC_B, &repo.heads(MAIN), "draft").unwrap());
    repo.edit(MAC_B, draft, |i| i.set_text(1, "Hello"));
    // until the merge, main doesn't show the draft (T10f)
    let before = repo.item(MAIN, MAC_S).unwrap().record();
    repo.edit(MAC_S, MAIN, |i| i.push_block(paragraph(3, "on main")));
    assert_eq!(repo.item(MAIN, MAC_S).unwrap().as_document().unwrap().blocks[0].text, "Welcome");
    let (main, branch) = (repo.log(MAIN), repo.log(draft));
    // merging either way shows both edits, the same (T10g); merging again changes nothing
    let mut other = repo.clone();
    let merge = repo.merge(MAC_S, draft, MAIN);
    other.merge(MAC_B, MAIN, draft);
    let merged = repo.item(MAIN, MAC_S).unwrap().record();
    assert_eq!(Some(&merged), other.item(draft, MAC_B).map(|i| i.record()).as_ref());
    let doc = repo.item(MAIN, MAC_S).unwrap().as_document().unwrap();
    assert_eq!((doc.blocks[0].text.as_str(), doc.blocks.len()), ("Hello", 3));
    repo.merge(MAC_S, draft, MAIN);
    assert_eq!(repo.item(MAIN, MAC_S).unwrap().record(), merged);
    let log = repo.log(MAIN);
    assert!(main.iter().chain(&branch).chain([&merge]).all(|op| log.contains(op)) && merged != before);
}

#[test]
fn the_latest_commit_reverts_and_an_older_one_is_undone() {
    let mut repo = Repo::new(&document("Welcome", WELCOME_TEXT, MAC_S), MAC_S);
    let good = repo.item(MAIN, MAC_S).unwrap().record();
    let bad = repo.edit(MAC_B, MAIN, |i| i.set_text(2, "oops"));
    // the latest commit goes back exactly, by restoring the version it built on
    let built_on = repo.history().get(bad).unwrap().write.deps.clone();
    repo.restore(MAC_S, MAIN, &built_on);
    assert_eq!(repo.item(MAIN, MAC_S).unwrap().record(), good);
    // an older bad commit is undone and what came after stays
    let older = repo.edit(MAC_B, MAIN, |i| i.set_text(1, "Welcome!!!"));
    repo.edit(MAC_S, MAIN, |i| i.push_block(paragraph(3, "a later, good edit")));
    repo.undo(MAC_S, MAIN, older).unwrap();
    let doc = repo.item(MAIN, MAC_S).unwrap().as_document().unwrap();
    let texts: Vec<&str> = doc.blocks.iter().map(|b| b.text.as_str()).collect();
    assert_eq!(texts, ["Welcome", WELCOME_TEXT, "a later, good edit"]);
    // and every version is still there
    assert_eq!(repo.log(MAIN).len(), repo.history().commits().len());
    let oops = repo.history().item_at(&[bad], MAC_S, MAIN).as_document().unwrap();
    assert_eq!(oops.blocks[1].text, "oops");
}

#[test]
fn a_fork_copies_the_record_and_the_schemas_that_wrote_it() {
    let mut welcome = document_v1("Welcome", WELCOME_TEXT, MAC_S);
    welcome.edit_document(|d| d.tags.push("greenhouse".into()));
    let copy = welcome.copy(MAC_B);
    assert_eq!((copy.record(), copy.authored()), (welcome.record(), welcome.authored()));
    assert_eq!(copy.authored().len(), 2);
    // with no history: one change, by the device that copied it
    let mut reader = avendb::doc::Item::new(MAC_C);
    assert!(reader.import(&copy.export(&Default::default()), MAC_S).is_err());
    reader.import(&copy.export(&Default::default()), MAC_B).unwrap();
    assert_eq!(reader.as_document(), welcome.as_document());
}

#[test]
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
fn an_update_from_the_wrong_peer_is_refused() {
    // Bob's edits carry his Loro peer; the same bytes claimed as Carol's are refused before import
    let base = document("Welcome", WELCOME_TEXT, MAC_S);
    let start = base.version();
    let mut bobs = base.fork_as(MAC_B);
    bobs.set_text(2, "Bob's version");
    let update = bobs.export(&start);
    let mut samuels = base.fork_as(MAC_S);
    assert_eq!(samuels.import(&update, MAC_C), Err(avendb::doc::DocError::WrongPeer));
    assert_eq!(samuels.import(b"not a loro update", MAC_B), Err(avendb::doc::DocError::Malformed));
    assert!(samuels.import(&update, MAC_B).is_ok());
}
