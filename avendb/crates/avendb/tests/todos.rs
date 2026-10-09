//! Social todos (scenarios 15 to 17 on the rules alone): one todo shared with several vaults in different roles,
//! roles changing, and each todo syncing on its own, peer to peer.

mod common;

use common::*;
use avendb::id::{EntryId, SpaceId, VaultId};
use avendb::policy::{Action, Log, Op, Refusal, Role, Scope};
use avendb::sync::{item_writes, receive, respond};

#[test]
fn todo_shared_per_item_roles() {
    let t = social_todo();
    let (c, todos, door) = (&t.c, t.todos, Scope::Entry(t.todos, DOOR));
    let v = c.log.view();
    // Bob can edit the door todo and check it off; Carol can only read it
    assert!(c.log.check(MAC_B, &[], write(todos, DOOR, c.bob, 0)).is_ok());
    assert_eq!(c.log.check(MAC_C, &[], write(todos, DOOR, c.carol, 0)).err(), Some(Refusal::NoCap));
    assert!(v.holds(c.carol, door, Role::Read) && !v.holds(c.carol, Scope::Entry(todos, SEEDS), Role::Read));
    // neither of them may receive the other two todos
    for e in [SEEDS, SOLAR] {
        assert!(!v.may_receive(MAC_B, todos, e) && !v.may_receive(MAC_C, todos, e));
    }
    // every coop owner's device can share it further, acting for the coop: Bob's Mac, Samuel's iPhone
    for d in [MAC_B, PHONE_S] {
        assert!(c.log.check(d, &[], grant(door, Role::Read, vault(c.dave), t.coop, Some(t.coop_owner))).is_ok());
    }
    // Bob's own write cap doesn't let him share: only owners grant
    let reshare = c.log.check(MAC_B, &[], grant(door, Role::Read, vault(c.dave), c.bob, Some(t.bob_write)));
    assert!(matches!(reshare.err(), Some(Refusal::NoCap | Refusal::BadParent)));
    // and a device alone can't make anyone owner of a todo
    let owner = grant(Scope::Entry(todos, SEEDS), Role::Owner, vault(t.coop), c.samuel, None);
    assert_eq!(c.log.check(MAC_S, &[], owner).err(), Some(Refusal::BelowThreshold));
}

/// Scenario 16 up to its last step: Bob gives Dave read for the coop; Samuel raises Carol to write and revokes Bob's
/// own write.
fn roles_changed() -> SocialTodo {
    let mut t = social_todo();
    let door = Scope::Entry(t.todos, DOOR);
    let (carol, dave, samuel) = (t.c.carol, t.c.dave, t.c.samuel);
    t.c.log.append(MAC_B, &[], grant(door, Role::Read, vault(dave), t.coop, Some(t.coop_owner))).unwrap();
    t.c.log.append(MAC_S, &[], grant(door, Role::Write, vault(carol), samuel, None)).unwrap();
    t.c.log.append(MAC_S, &[], Action::Revoke { grant: t.bob_write, actor: samuel, keep: vec![], via: vec![] }).unwrap();
    t
}

#[test]
fn access_through_coop_survives_direct_revoke() {
    let t = roles_changed();
    let (c, todos, door) = (&t.c, t.todos, Scope::Entry(t.todos, DOOR));
    let v = c.log.view();
    // Bob's own write is gone, but he still acts for the coop, which owns the todo
    assert!(!v.holds(c.bob, door, Role::Write));
    assert!(v.acts_for(MAC_B, t.coop) && v.holds(t.coop, door, Role::Write));
    assert!(c.log.check(MAC_B, &[], write(todos, DOOR, t.coop, 0)).is_ok());
    assert!(v.may_receive(MAC_B, todos, DOOR));
    // Dave reads it, and Carol now writes it
    assert!(v.holds(c.dave, door, Role::Read) && v.may_receive(MAC_D, todos, DOOR));
    assert!(c.log.check(MAC_C, &[], write(todos, DOOR, c.carol, 0)).is_ok());
}

#[test]
fn cascade_ends_regrants() {
    let mut t = roles_changed();
    let (todos, door, samuel) = (t.todos, Scope::Entry(t.todos, DOOR), t.c.samuel);
    // taking the coop's owner cap away is governance: Samuel's Mac alone can't
    let revoke = Action::Revoke { grant: t.coop_owner, actor: samuel, keep: vec![], via: vec![] };
    assert_eq!(t.c.log.check(MAC_S, &[], revoke.clone()).err(), Some(Refusal::BelowThreshold));
    t.c.log.append(PASSKEY_S, &[], revoke).unwrap();
    let v = t.c.log.view();
    // the coop loses the todo, and so does Dave, whose read rested on the coop's owner cap
    assert!(!v.holds(t.coop, door, Role::Relay) && !v.holds(t.c.dave, door, Role::Relay));
    assert!(!v.may_receive(MAC_B, todos, DOOR) && !v.may_receive(MAC_D, todos, DOOR));
    assert_eq!(t.c.log.check(MAC_B, &[], write(todos, DOOR, t.coop, 0)).err(), Some(Refusal::NoCap));
    // Carol's write came from Samuel, not the coop, so it stays
    assert!(v.holds(t.c.carol, door, Role::Write) && v.may_receive(MAC_C, todos, DOOR));
}

fn writes_on(ops: &[Op]) -> Vec<(SpaceId, EntryId)> {
    ops.iter()
        .filter_map(|o| match o.action {
            Action::Write { space, entry, .. } => Some((space, entry)),
            _ => None,
        })
        .collect()
}

#[test]
fn sync_sends_only_capped_items() {
    let t = social_todo();
    let ops = t.c.log.ops();
    // Samuel's Mac answers Carol's Mac with the door todo's writes and nothing of the other two
    let to_carol = writes_on(&respond(ops, MAC_C));
    assert!(!to_carol.is_empty() && to_carol.iter().all(|&w| w == (t.todos, DOOR)));
    // and the grants on the door todo come with it, so Carol's Mac can check them
    assert!(respond(ops, MAC_C).iter().any(|o| matches!(&o.action, Action::Grant(g, _) if g.scope == Scope::Entry(t.todos, DOOR))));
    // a device without a cap gets no item at all
    assert!(writes_on(&respond(ops, STRANGER)).is_empty());
    // after the coop lost the todo, Dave's Mac gets nothing of it either
    let mut gone = roles_changed();
    let revoke = Action::Revoke { grant: gone.coop_owner, actor: gone.c.samuel, keep: vec![], via: vec![] };
    gone.c.log.append(PASSKEY_S, &[], revoke).unwrap();
    assert!(writes_on(&respond(gone.c.log.ops(), MAC_D)).is_empty());
}

#[test]
fn item_syncs_peer_to_peer_without_server() {
    let t = social_todo();
    let ops = t.c.log.ops();
    // each Mac starts with its own vault's ops and what Samuel's Mac sent it
    let own = |v: VaultId| -> Vec<Op> {
        let vault_of = |o: &Op| match &o.action {
            Action::AddDevice { vault, .. } => Some(*vault),
            Action::Genesis { .. } => Some(VaultId::from(o.id())),
            _ => None,
        };
        ops.iter().filter(|o| vault_of(o) == Some(v)).cloned().collect()
    };
    let mut bob_mac = Log::from_ops(receive(&own(t.c.bob), &respond(ops, MAC_B)));
    let carol_mac = Log::from_ops(receive(&own(t.c.carol), &respond(ops, MAC_C)));
    assert_eq!(item_writes(carol_mac.ops(), t.todos, DOOR).len(), 1);
    // Samuel and the server go offline; Bob edits the door todo on his Mac
    bob_mac.append(MAC_B, &[], write(t.todos, DOOR, t.c.bob, 0)).unwrap();
    // Bob's Mac and Carol's Mac answer each other once, directly
    let bob_after = receive(bob_mac.ops(), &respond(carol_mac.ops(), MAC_B));
    let carol_after = receive(carol_mac.ops(), &respond(bob_mac.ops(), MAC_C));
    // both hold Samuel's and Bob's edits of the door todo, and Carol's Mac accepts Bob's
    assert_eq!(item_writes(&carol_after, t.todos, DOOR).len(), 2);
    assert_eq!(item_writes(&carol_after, t.todos, DOOR), item_writes(&bob_after, t.todos, DOOR));
    // and neither learned anything about the other todos
    assert!(item_writes(&carol_after, t.todos, SEEDS).is_empty() && item_writes(&bob_after, t.todos, SOLAR).is_empty());
}
