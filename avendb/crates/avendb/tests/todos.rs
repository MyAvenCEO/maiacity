//! Social todos (scenarios 15 to 17 on the rules alone): a todo of Alice's vault shared by caps on it alone with
//! several vaults in different roles, which her Mac, a steward, moves into the cell of those caps; roles changing,
//! through the coop and on caps resting on its owner cap; each todo syncing on its own, peer to peer; and a todo
//! leaving a slice, whose move cuts the writes it hadn't seen.

mod common;

use avendb::id::{CapId, CellId, EntryId, VaultId};
use avendb::keys::KeyFam;
use avendb::policy::{mk_cell, view, Action, Cap, Edit, Log, Refusal, Role, State};
use avendb::sync::{entry_writes, log_of, receive, respond, LogId};
use common::*;

/// A write of entry `e` for `actor`, under the stay `log`'s view has it in and its cell's generation now: what an app
/// on a device holding `log` sends.
fn write_now(log: &Log, e: EntryId, actor: VaultId) -> Action {
    let st = log.view();
    let en = st.entry(e).expect("an entry the log holds");
    write(en.vault, e, actor, en.stay(), st.epoch(KeyFam::Cell(en.vault, en.cell())))
}

/// The cell entry `e` is in, by `log`'s view.
fn cell_of(log: &Log, e: EntryId) -> Option<CellId> {
    Some(log.view().entry(e)?.cell())
}

/// The entries whose logs `edits` hold edits of, in the order they first come.
fn entries_in(edits: &[Edit]) -> Vec<EntryId> {
    let mut out = vec![];
    for o in edits {
        if let Some(LogId::Entry(e)) = log_of(o, o.id())
            && !out.contains(&e)
        {
            out.push(e);
        }
    }
    out
}

/// What a peer holding the edits of every log of `logs` makes of them.
fn met(logs: &[&Log]) -> State {
    let mut all: Vec<Edit> = vec![];
    for o in logs.iter().flat_map(|log| log.edits()) {
        if !all.contains(o) {
            all.push(o.clone());
        }
    }
    view(&all)
}

/// A cap over vault `over` naming vault `grantee`, resting on `parent` and issued by `issuer`: what `Cast::issue_on`
/// appends, to check without appending. Its selector travels sealed, and no rule reads it.
fn cap_edit(over: VaultId, grantee: VaultId, role: Role, parent: Option<CapId>, issuer: VaultId) -> Action {
    let cap = Cap { over, grantee: vault(grantee), role, wide: false, select: vec![], parent, issuer, nonce: 7 };
    Action::Cap(cap, vec![])
}

#[test]
fn todo_shared_per_item_roles() {
    let t = social_todo();
    let (c, alice) = (&t.c, t.c.alice);
    let v = c.log.view();
    // Bob can edit the door todo and check it off; Carol can only read it
    assert!(c.log.check(MAC_B, &[], write_now(&c.log, DOOR, c.bob)).is_ok());
    assert_eq!(c.log.check(MAC_C, &[], write_now(&c.log, DOOR, c.carol)).err(), Some(Refusal::NoCap));
    // it is in the cell of the three caps, which Carol's vault reads; the seeds todo is in the cell of none
    let shared = mk_cell(&[t.bob_write, t.carol_read, t.coop_owner]);
    assert_eq!(cell_of(&c.log, DOOR), Some(CellId::of(alice, &shared)));
    let key = |e| KeyFam::Cell(alice, cell_of(&c.log, e).expect("a todo"));
    assert!(v.reads_vault(c.carol, key(DOOR)) && !v.reads_vault(c.carol, key(SEEDS)));
    // neither of them receives the other two todos
    for d in [MAC_B, MAC_C] {
        assert_eq!(entries_in(&respond(c.log.edits(), d)), [DOOR]);
    }
    // every coop owner's device can share it further, acting for the coop: Bob's Mac, Alice's iPhone
    for d in [MAC_B, PHONE_A] {
        let share = cap_edit(alice, c.dave, Role::Read, Some(t.coop_owner), t.coop);
        assert!(c.log.check(d, &[], share).is_ok());
    }
    // Bob's own write cap doesn't let him share: only an owner cap is one to issue caps on
    let reshare = cap_edit(alice, c.dave, Role::Read, Some(t.bob_write), c.bob);
    assert_eq!(c.log.check(MAC_B, &[], reshare).err(), Some(Refusal::BadParent));
    // and a device alone can't make anyone owner of a todo
    let owner = cap_edit(alice, t.coop, Role::Owner, None, alice);
    assert_eq!(c.log.check(MAC_A, &[], owner).err(), Some(Refusal::BelowThreshold));
}

/// Scenario 16 up to its last step, on the social todo `t`: acting for the coop, on the coop's owner cap, Bob gives
/// Dave read; Alice raises Carol to write and takes Bob's own write away; and her Mac moves the todo into the cell of
/// the caps that select it now. Dave's read and Carol's write.
fn change_roles(t: &mut SocialTodo) -> (CapId, CapId) {
    let (alice, carol, dave) = (t.c.alice, t.c.carol, t.c.dave);
    let parent = Some(t.coop_owner);
    let dave_read = t.c.issue_on(MAC_B, &[], alice, vault(dave), Role::Read, by_id(DOOR), parent, t.coop, 0).unwrap();
    let carol_write = t.c.issue(MAC_A, &[], alice, vault(carol), Role::Write, by_id(DOOR)).unwrap();
    let revoke = Action::Revoke { cap: t.bob_write, actor: alice, keep: vec![], via: vec![] };
    t.c.log.append(MAC_A, &[], revoke).unwrap();
    t.c.tidy(MAC_A);
    (dave_read, carol_write)
}

#[test]
fn access_through_coop_survives_direct_revoke() {
    let mut t = social_todo();
    // Bob's Mac goes offline before the roles change
    let mut bobs = t.c.log.clone();
    let (dave_read, carol_write) = change_roles(&mut t);
    let (c, alice, coop) = (&t.c, t.c.alice, t.coop);
    let v = c.log.view();
    // Bob's own write is gone, but he still acts for the coop, which owns the todo
    assert!(!v.live(t.bob_write) && !v.may_write(c.bob, DOOR));
    assert!(v.acts_for(MAC_B, coop) && v.may_write(coop, DOOR));
    assert!(c.log.check(MAC_B, &[], write_now(&c.log, DOOR, coop)).is_ok());
    assert!(entries_in(&respond(c.log.edits(), MAC_B)).contains(&DOOR));
    // so the cell it was in when Alice took Bob's write away never moved on: everyone who read it still did
    let before = CellId::of(alice, &mk_cell(&[t.bob_write, t.carol_read, t.coop_owner]));
    assert_eq!(v.epoch(KeyFam::Cell(alice, before)), 0);
    // moved into the cell of the caps that select it now: Dave reads it, and Carol writes it
    let now = CellId::of(alice, &mk_cell(&[t.carol_read, t.coop_owner, dave_read, carol_write]));
    assert_eq!(cell_of(&c.log, DOOR), Some(now));
    assert!(v.reads_vault(c.dave, KeyFam::Cell(alice, now)));
    assert!(entries_in(&respond(c.log.edits(), MAC_D)).contains(&DOOR));
    assert!(c.log.check(MAC_C, &[], write_now(&c.log, DOOR, c.carol)).is_ok());
    // what Bob's Mac wrote offline, unseen by the revocation and the move: for Bob, it is cut; for the coop, it stands
    let for_coop = bobs.append(MAC_B, &[], write_now(&bobs, DOOR, coop)).unwrap();
    let for_bob = bobs.append(MAC_B, &[], write_now(&bobs, DOOR, c.bob)).unwrap();
    let writes = met(&[&c.log, &bobs]).writes(DOOR);
    assert!(writes.contains(&for_coop) && !writes.contains(&for_bob));
}

#[test]
fn cascade_ends_caps_resting_on_it() {
    let mut t = social_todo();
    let (dave_read, carol_write) = change_roles(&mut t);
    let (alice, coop) = (t.c.alice, t.coop);
    let cell = cell_of(&t.c.log, DOOR).expect("the door todo");
    let key = KeyFam::Cell(alice, cell);
    let before = t.c.log.view().epoch(key);
    // taking the coop's owner cap away is governance: Alice's Mac alone can't
    let revoke = Action::Revoke { cap: t.coop_owner, actor: alice, keep: vec![], via: vec![] };
    assert_eq!(t.c.log.check(MAC_A, &[], revoke.clone()).err(), Some(Refusal::BelowThreshold));
    t.c.log.append(PASSKEY_A, &[], revoke).unwrap();
    let (c, v) = (&t.c, t.c.log.view());
    // the coop loses the todo, and so does Dave, whose read rested on the coop's owner cap
    assert!(!v.live(t.coop_owner) && !v.live(dave_read));
    assert!(!v.reads_vault(coop, key) && !v.reads_vault(c.dave, key) && !v.may_write(coop, DOOR));
    for d in [MAC_B, MAC_D] {
        assert!(!entries_in(&respond(c.log.edits(), d)).contains(&DOOR));
    }
    assert_eq!(c.log.check(MAC_B, &[], write_now(&c.log, DOOR, coop)).err(), Some(Refusal::NoCap));
    // the todo stays in its cell, whose key moves on: a revocation moves no entry
    assert_eq!(cell_of(&c.log, DOOR), Some(cell));
    assert_eq!(v.meaning(DOOR, &c.readings).map(|m| m.desired), Some(None));
    assert_eq!(v.epoch(key), before + 1);
    // Carol's write came from Alice, not the coop, so it stays
    assert!(v.live(carol_write) && v.may_write(c.carol, DOOR) && v.reads_vault(c.carol, key));
    assert!(entries_in(&respond(c.log.edits(), MAC_C)).contains(&DOOR));
}

#[test]
fn sync_sends_only_what_caps_reach() {
    let t = social_todo();
    let edits = t.c.log.edits();
    // Alice's Mac answers Carol's Mac with the door todo's writes and its move, and nothing of the other two
    let to_carol = respond(edits, MAC_C);
    assert_eq!(entries_in(&to_carol), [DOOR]);
    // and with the caps of every cell the door todo was in, so Carol's Mac can check them
    let caps: Vec<CapId> =
        to_carol.iter().filter(|o| matches!(o.action, Action::Cap(..))).map(|o| CapId::from(o.id())).collect();
    assert!([t.bob_write, t.carol_read, t.coop_owner].iter().all(|cap| caps.contains(cap)));
    // a device without a cap gets no entry at all
    assert!(entries_in(&respond(edits, STRANGER)).is_empty());
    // after the coop lost the todo, Dave's Mac gets nothing of it either, only the revocation that ended its read
    let mut gone = social_todo();
    change_roles(&mut gone);
    let revoke = Action::Revoke { cap: gone.coop_owner, actor: gone.c.alice, keep: vec![], via: vec![] };
    let revoked = gone.c.log.append(PASSKEY_A, &[], revoke).unwrap();
    let to_dave = respond(gone.c.log.edits(), MAC_D);
    assert!(entries_in(&to_dave).is_empty() && to_dave.iter().any(|o| o.id() == revoked));
}

#[test]
fn entry_syncs_peer_to_peer_without_server() {
    let t = social_todo();
    let edits = t.c.log.edits();
    // each Mac starts with its own vault's edits and what Alice's Mac sent it
    let own = |v: VaultId| -> Vec<Edit> {
        edits.iter().filter(|o| log_of(o, o.id()) == Some(LogId::Vault(v))).cloned().collect()
    };
    let mut bob_mac = Log::from_edits(receive(&own(t.c.bob), &respond(edits, MAC_B)));
    let carol_mac = Log::from_edits(receive(&own(t.c.carol), &respond(edits, MAC_C)));
    assert_eq!(entry_writes(carol_mac.edits(), DOOR).len(), 1);
    // Alice and the server go offline; Bob edits the door todo on his Mac
    bob_mac.append(MAC_B, &[], write_now(&bob_mac, DOOR, t.c.bob)).unwrap();
    // Bob's Mac and Carol's Mac answer each other once, directly
    let bob_after = receive(bob_mac.edits(), &respond(carol_mac.edits(), MAC_B));
    let carol_after = receive(carol_mac.edits(), &respond(bob_mac.edits(), MAC_C));
    // both hold Alice's and Bob's edits of the door todo, and Carol's Mac accepts Bob's
    assert_eq!(entry_writes(&carol_after, DOOR).len(), 2);
    assert_eq!(entry_writes(&carol_after, DOOR), entry_writes(&bob_after, DOOR));
    // and neither learned anything about the other todos
    assert_eq!((entries_in(&carol_after), entries_in(&bob_after)), (vec![DOOR], vec![DOOR]));
}

/// Examples.lean's `shared`: Alice's three todos, Carol writing all of them and Bob those tagged work, each moved into
/// the cell of the caps that select it. Carol's cap and Bob's.
fn shared_todos() -> (Cast, CapId, CapId) {
    let mut c = cast();
    let (alice, bob, carol) = (c.alice, c.bob, c.carol);
    for (e, tag) in [(DOOR, "work"), (SEEDS, "home"), (SOLAR, "work")] {
        c.create(MAC_A, alice, e, alice, &[], "todo", &[tag]).unwrap();
    }
    let todos = c.issue(MAC_A, &[], alice, vault(carol), Role::Write, of_type("todo")).unwrap();
    let work = c.issue(MAC_A, &[], alice, vault(bob), Role::Write, tagged("todo", "work")).unwrap();
    c.tidy(MAC_A);
    (c, todos, work)
}

/// Examples.lean's `movedOver`: a move is a removal too. It takes its entry out of every cap it leaves behind, so a
/// write it hadn't seen stands only if its writer may write in the cell the move took the entry to.
#[test]
fn a_move_cuts_the_writes_it_had_not_seen() {
    let (mut c, todos, work) = shared_todos();
    let (alice, bob, carol) = (c.alice, c.bob, c.carol);
    assert_eq!(cell_of(&c.log, SOLAR), Some(CellId::of(alice, &mk_cell(&[todos, work]))));
    // Bob and Carol each check the solar panels off, on copies that hear nothing of what follows
    let (mut bobs, mut carols) = (c.log.clone(), c.log.clone());
    let late = bobs.append(MAC_B, &[], write_now(&bobs, SOLAR, bob)).unwrap();
    let carols_late = carols.append(MAC_C, &[], write_now(&carols, SOLAR, carol)).unwrap();
    // meanwhile Alice takes the work tag off them, and her Mac moves them out of Bob's slice, into Carol's cell alone
    let retag = c.retag(MAC_A, SOLAR, alice, &[], &["work"]).unwrap();
    c.tidy(MAC_A);
    assert_eq!(cell_of(&c.log, SOLAR), Some(CellId::of(alice, &[todos])));
    // the move cut Bob's write, as his cap doesn't reach where it took them; Carol's stands
    let st = met(&[&c.log, &bobs, &carols]);
    let writes = st.writes(SOLAR);
    assert!(!writes.contains(&late) && writes.contains(&carols_late) && writes.contains(&retag));
    assert!(!st.may_write(bob, SOLAR) && st.may_write(carol, SOLAR));
    // had Alice's Mac heard of Bob's write before it moved them, the move would have kept it
    let (mut heard, ..) = shared_todos();
    heard.log.receive(bobs.edits().to_vec());
    heard.retag(MAC_A, SOLAR, alice, &[], &["work"]).unwrap();
    heard.tidy(MAC_A);
    assert_eq!(cell_of(&heard.log, SOLAR), Some(CellId::of(alice, &[todos])));
    assert!(heard.log.view().writes(SOLAR).contains(&late));
}
