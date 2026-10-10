//! Caps (P2, P4; T1, T4, T8, T16, T17, T22), on the rules alone. A cap gives a vault, never a signer, a role on a
//! slice of another vault: relay, read, write or owner on the entries its selector picks, or on the whole vault for a
//! wide cap, which reaches every cell and splits none. Public only reads; a write no cap allows is refused, on import
//! too; only the vault, and a vault holding a wide owner cap over it, publish into its schema lane; a cap resting on
//! an owner cap grants no more than it, and ends with it; and when revocations clash, the most senior revoker stands.

mod common;

use avendb::id::{CapId, CellId, EntryId, SignerId, VaultId};
use avendb::keys::{KeyFam, KeyName};
use avendb::lens::{DOCUMENT_LENS, DOCUMENT_V1, DOCUMENT_V2};
use avendb::policy::{mk_cell, replay, Action, Cap, Edit, Grantee, Kind, Log, Principal, Refusal, Role, State};
use avendb::slice::Selector;
use avendb::sync::{log_of, respond, LogId};
use common::*;

/// The relay server's device on the rules' log.
const SERVER: SignerId = SignerId::from_u64(600);

/// The entries of Alice's library, in the order her Mac made them.
const LIBRARY: [EntryId; 5] = [DOOR, SEEDS, SOLAR, PLAN, DIARY];

/// Alice's library on the rules, as Examples.lean's `lib`: the door and solar todos tagged work, the seeds todo tagged
/// home, the plan, a note tagged work, and her diary, all made by her Mac in the cell of no caps.
fn alices_library() -> Cast {
    let mut c = cast();
    let alice = c.alice;
    let entries: [(EntryId, &str, &[&str]); 5] = [
        (DOOR, "todo", &["work"]),
        (SEEDS, "todo", &["home"]),
        (SOLAR, "todo", &["work"]),
        (PLAN, "note", &["work"]),
        (DIARY, "note", &[]),
    ];
    for (e, ty, tags) in entries {
        c.create(MAC_A, alice, e, alice, &[], ty, tags).unwrap();
    }
    c
}

/// An aven vault owned by Alice's vault, as avenCEO is, with the server as its device.
fn aven_of_alice(c: &mut Cast) -> VaultId {
    let owners = vec![Principal::Vault(c.alice)];
    let genesis = Action::Genesis { kind: Kind::Aven, owners, threshold: 1, root: None, nonce: 0, seal_to: vec![] };
    let aven = VaultId::from(c.log.append(PASSKEY_A, &[], genesis).unwrap());
    c.log.append(PASSKEY_A, &[SERVER], Action::AddDevice { vault: aven, device: SERVER, seal_to: None }).unwrap();
    aven
}

/// A cap over vault `over` naming vault `grantee`, resting on `parent` and issued by `issuer`: what `Cast::issue_on`
/// appends, to check without appending. Its selector travels sealed, and no rule reads it.
fn cap_edit(over: VaultId, grantee: VaultId, role: Role, wide: bool, parent: Option<CapId>, issuer: VaultId) -> Action {
    let cap = Cap { over, grantee: vault(grantee), role, wide, select: vec![], parent, issuer, nonce: 7 };
    Action::Cap(cap, vec![])
}

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

/// Signer `d` opens the key entry `e` is under now, by the seals of `st`: it reads what is written to it next.
fn reads(st: &State, d: SignerId, e: EntryId) -> bool {
    st.entry_key(e).is_some_and(|k| st.opens(&[KeyName::Signer(d)]).contains(&k))
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

#[test]
fn cap_to_signer_rejected() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    c.create(MAC_A, coop, WELCOME, coop, &[], "doc", &[]).unwrap();
    // neither Carol's Mac nor her passkey can be named, only her vault (T4)
    for signer in [MAC_C, PASSKEY_C] {
        let to_signer = Grantee::Principal(Principal::Signer(signer));
        let refused = c.issue(MAC_A, &[], coop, to_signer, Role::Read, by_id(WELCOME)).err();
        assert_eq!(refused, Some(Refusal::CapToSigner));
    }
    // nor the coop itself, which has every right over its own entries already
    let itself = c.issue(MAC_A, &[], coop, vault(coop), Role::Read, by_id(WELCOME)).err();
    assert_eq!(itself, Some(Refusal::CapToItself));
    c.issue(MAC_A, &[], coop, vault(c.carol), Role::Read, by_id(WELCOME)).unwrap();
    c.tidy(MAC_A);
    // the cap names Carol's vault, so it reaches Welcome on whichever device acts for her, a new one too
    assert!(reads(&c.log.view(), MAC_C, WELCOME) && !reads(&c.log.view(), NEW_DEVICE, WELCOME));
    let add = Action::AddDevice { vault: c.carol, device: NEW_DEVICE, seal_to: None };
    c.log.append(PASSKEY_C, &[NEW_DEVICE], add).unwrap();
    assert!(reads(&c.log.view(), NEW_DEVICE, WELCOME));
}

#[test]
fn public_is_read_only() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    for e in [WELCOME, CHARTER] {
        c.create(MAC_A, coop, e, coop, &[], "doc", &[]).unwrap();
    }
    // write or owner for Public is refused, even with every signature the coop could give (T8)
    for role in [Role::Write, Role::Owner] {
        let public = c.issue(MAC_A, &[PASSKEY_A, PASSKEY_B], coop, Grantee::Public, role, by_id(CHARTER));
        assert_eq!(public.err(), Some(Refusal::PublicBeyondRead));
    }
    c.issue(MAC_A, &[], coop, Grantee::Public, Role::Read, by_id(CHARTER)).unwrap();
    // a steward moves Charter into the public cap's cell, whose key is published; Welcome's cell's isn't
    c.tidy(MAC_A);
    let v = c.log.view();
    let public = |e| v.entry(e).is_some_and(|en| v.public_key(KeyFam::Cell(coop, en.cell())));
    assert!(public(CHARTER) && !public(WELCOME));
    // anyone receives Charter and reads it, and nothing else
    assert_eq!(entries_in(&respond(c.log.edits(), STRANGER)), [CHARTER]);
    assert!(reads(&v, STRANGER, CHARTER) && !reads(&v, STRANGER, WELCOME));
    // but nobody outside the coop can edit it
    let stranger = c.log.check(STRANGER, &[], write_now(&c.log, CHARTER, coop)).err();
    assert_eq!(stranger, Some(Refusal::NotActing));
    let carol = c.log.check(MAC_C, &[], write_now(&c.log, CHARTER, c.carol)).err();
    assert_eq!(carol, Some(Refusal::NoCap));
}

#[test]
fn write_without_cap_rejected_on_import() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    c.create(MAC_A, coop, WELCOME, coop, &[], "doc", &[]).unwrap();
    let read = c.issue(MAC_A, &[], coop, vault(c.carol), Role::Read, by_id(WELCOME)).unwrap();
    // a steward, Alice's Mac, moves Welcome into the cell of Carol's cap
    c.tidy(MAC_A);
    assert_eq!(cell_of(&c.log, WELCOME), Some(CellId::of(coop, &[read])));
    // Carol's Mac holds the same edits; her own peer refuses her edit of Welcome, as she only reads it…
    let carols = Log::from_edits(c.log.edits().to_vec());
    let edit = write_now(&carols, WELCOME, c.carol);
    assert_eq!(carols.check(MAC_C, &[], edit.clone()).err(), Some(Refusal::NoCap));
    // …and when a patched app sends it anyway, Alice's peer imports it but never accepts it
    let forced = carols.draft(MAC_C, &[], edit);
    c.log.receive([forced.clone()]);
    assert!(!c.log.view().writes(WELCOME).contains(&forced.id()));
    assert_eq!(c.log.view().writes(WELCOME).len(), 1);
}

#[test]
fn only_owners_publish_into_the_lane() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let (carol, dave) = (c.carol, c.dave);
    c.create(MAC_A, coop, WELCOME, coop, &[], "doc", &[]).unwrap();
    // Carol may write Welcome and even owns it, but only the coop, or a vault that owns the whole coop, publishes into
    // the coop's lane (T17)
    for role in [Role::Write, Role::Owner] {
        c.issue(PASSKEY_A, &[PASSKEY_B], coop, vault(carol), role, by_id(WELCOME)).unwrap();
    }
    let publish = |actor, blob: &[u8]| Action::Publish { vault: coop, actor, via: vec![], blob: blob.to_vec() };
    assert_eq!(c.log.check(MAC_C, &[], publish(carol, DOCUMENT_V2.bytes())).err(), Some(Refusal::NoCap));
    // nor can she claim to act for the coop
    assert_eq!(c.log.check(MAC_C, &[], publish(coop, DOCUMENT_V2.bytes())).err(), Some(Refusal::NotActing));
    // Alice's Mac acts for the coop: v2 and the lens go in, each blob once
    for blob in [DOCUMENT_V2.bytes(), DOCUMENT_LENS.bytes()] {
        c.log.append(MAC_A, &[], publish(coop, blob)).unwrap();
    }
    let again = c.log.check(MAC_B, &[], publish(coop, DOCUMENT_V2.bytes())).err();
    assert_eq!(again, Some(Refusal::AlreadyPublished));
    // Dave, made owner of the whole coop by both its owners, publishes into its lane too
    c.issue(PASSKEY_A, &[PASSKEY_B], coop, vault(dave), Role::Owner, Selector::All).unwrap();
    c.log.append(MAC_D, &[], publish(dave, DOCUMENT_V1.bytes())).unwrap();
    let v = c.log.view();
    let lane = [DOCUMENT_V2.bytes(), DOCUMENT_LENS.bytes(), DOCUMENT_V1.bytes()];
    assert_eq!(v.lane_of(coop).collect::<Vec<_>>(), lane);
    // a vault that doesn't exist has no lane
    let nowhere = Action::Publish { vault: VaultId::from_u64(404), actor: coop, via: vec![], blob: vec![1] };
    assert_eq!(c.log.check(MAC_A, &[], nowhere).err(), Some(Refusal::UnknownVault));
}

/// Examples.lean's `seniorRevoke`.
#[test]
fn a_revoked_owner_cannot_block_his_revocation() {
    let mut c = cast();
    let (alice, dave, carol) = (c.alice, c.dave, c.carol);
    c.create(MAC_A, alice, PLAN, alice, &[], "note", &[]).unwrap();
    // Alice gives Dave owner on her notes, and Dave gives Carol read beneath it
    let dave_owner = c.issue(PASSKEY_A, &[], alice, vault(dave), Role::Owner, of_type("note")).unwrap();
    let notes = of_type("note");
    let carol_read = c.issue_on(MAC_D, &[], alice, vault(carol), Role::Read, notes, Some(dave_owner), dave, 0);
    let carol_read = carol_read.unwrap();
    // Dave revokes Carol's read on a copy that never sees Alice go on writing and then revoke Dave's cap, so Dave's
    // revocation sorts first
    let mut daves = c.log.clone();
    let revoke = |cap, actor| Action::Revoke { cap, actor, keep: vec![], via: vec![] };
    let late = daves.append(MAC_D, &[], revoke(carol_read, dave)).unwrap();
    c.create(MAC_A, alice, DIARY, alice, &[], "note", &[]).unwrap();
    c.log.append(MAC_A, &[], write_now(&c.log, PLAN, alice)).unwrap();
    let senior = c.log.append(PASSKEY_A, &[], revoke(dave_owner, alice)).unwrap();
    // the vault the caps are over ranks first, wherever the revocations sort: both caps are gone, in either order of
    // arrival, and Dave's revocation falls with the cap it rested on
    for (a, b) in [(&c.log, &daves), (&daves, &c.log)] {
        let mut all = a.edits().to_vec();
        all.extend(b.edits().iter().filter(|o| !a.edits().contains(o)).cloned());
        let r = replay(&all);
        let at = |id| r.ids.iter().position(|&x| x == id);
        assert!(at(late) < at(senior));
        assert!(!r.state.live(dave_owner) && !r.state.live(carol_read));
        assert!(r.standing().contains(&senior) && !r.standing().contains(&late));
    }
}

/// T22, as Examples.lean's `resting`: Alice makes Carol owner of her todos, and Carol gives Dave her todos tagged home
/// and, claiming more than she holds, her notes. A cap selects only what every cap of its chain does, and ends with
/// them.
#[test]
fn a_cap_on_an_owner_cap_grants_no_more_than_it() {
    let mut c = alices_library();
    let (alice, bob, carol, dave) = (c.alice, c.bob, c.carol, c.dave);
    // a device alone can't make anyone owner; Alice's passkey can
    let refused = c.issue(MAC_A, &[], alice, vault(carol), Role::Owner, of_type("todo")).err();
    assert_eq!(refused, Some(Refusal::BelowThreshold));
    let owner = c.issue(PASSKEY_A, &[], alice, vault(carol), Role::Owner, of_type("todo")).unwrap();
    let (home, notes) = (tagged("todo", "home"), of_type("note"));
    let home = c.issue_on(MAC_C, &[], alice, vault(dave), Role::Read, home, Some(owner), carol, 0).unwrap();
    let notes = c.issue_on(MAC_C, &[], alice, vault(dave), Role::Read, notes, Some(owner), carol, 1).unwrap();
    // only the grantee of an owner cap issues on it, only on an owner cap, and a wide cap only on a wide one
    let on = |parent, issuer, wide| cap_edit(alice, bob, Role::Read, wide, Some(parent), issuer);
    assert_eq!(c.log.check(MAC_B, &[], on(owner, bob, false)).err(), Some(Refusal::BadParent));
    assert_eq!(c.log.check(MAC_D, &[], on(home, dave, false)).err(), Some(Refusal::BadParent));
    assert_eq!(c.log.check(MAC_C, &[], on(owner, carol, true)).err(), Some(Refusal::BadParent));
    // an owner cap resting on Carol's takes her own approval
    let owner_on = cap_edit(alice, dave, Role::Owner, false, Some(owner), carol);
    assert_eq!(c.log.check(MAC_C, &[], owner_on.clone()).err(), Some(Refusal::BelowThreshold));
    assert!(c.log.check(PASSKEY_C, &[], owner_on).is_ok());
    // Dave's caps select what every cap of their chain selects: the todo tagged home, and no note at all
    let v = c.log.view();
    let selects = |cap| {
        let cap = v.cap(cap).expect("a cap");
        LIBRARY.map(|e| v.meaning(e, &c.readings).is_some_and(|m| v.eff_selects(cap, &m.attrs, &c.readings)))
    };
    assert_eq!((selects(home), selects(notes)), ([false, true, false, false, false], [false; 5]));
    // so a steward moves the todos into the cells of Carol's cap, the one tagged home into Dave's too, and no note
    let desired = LIBRARY.map(|e| v.meaning(e, &c.readings).and_then(|m| m.desired));
    let (carols, both) = (Some(vec![owner]), Some(mk_cell(&[owner, home])));
    assert_eq!(desired, [carols.clone(), both, carols, None, None]);
    c.tidy(MAC_A);
    let v = c.log.view();
    assert_eq!(LIBRARY.map(|e| reads(&v, MAC_C, e)), [true, true, true, false, false]);
    assert_eq!(LIBRARY.map(|e| reads(&v, MAC_D, e)), [false, true, false, false, false]);
    // Carol, who issued Dave's cap, and Dave, giving it up, may revoke it; Bob may not
    let revoke = |cap, actor| Action::Revoke { cap, actor, keep: vec![], via: vec![] };
    assert!(c.log.check(MAC_C, &[], revoke(home, carol)).is_ok());
    assert!(c.log.check(MAC_D, &[], revoke(home, dave)).is_ok());
    assert_eq!(c.log.check(MAC_B, &[], revoke(home, bob)).err(), Some(Refusal::NoCap));
    // revoking Carol's owner cap is governance, and ends Dave's caps with it; no entry has to move
    assert_eq!(c.log.check(MAC_A, &[], revoke(owner, alice)).err(), Some(Refusal::BelowThreshold));
    c.log.append(PASSKEY_A, &[], revoke(owner, alice)).unwrap();
    let v = c.log.view();
    assert!([owner, home, notes].iter().all(|&cap| !v.live(cap)));
    assert!(LIBRARY.iter().all(|&e| v.meaning(e, &c.readings).is_some_and(|m| m.desired.is_none())));
    assert!(LIBRARY.iter().all(|&e| !reads(&v, MAC_C, e) && !reads(&v, MAC_D, e)));
}

/// Examples.lean's `wideCaps`: Alice gives Dave, her backup, read on her whole vault, and avenCEO, the server's vault,
/// relay on it.
#[test]
fn a_wide_cap_reaches_every_cell_and_splits_none() {
    let mut c = alices_library();
    let (alice, bob, dave) = (c.alice, c.bob, c.dave);
    // Bob writes Alice's todos tagged work: her Mac moves them into his cap's cell
    let work = c.issue(MAC_A, &[], alice, vault(bob), Role::Write, tagged("todo", "work")).unwrap();
    c.tidy(MAC_A);
    let ceo = aven_of_alice(&mut c);
    let backup = c.issue(MAC_A, &[], alice, vault(dave), Role::Read, Selector::All).unwrap();
    let relay = c.issue(MAC_A, &[], alice, vault(ceo), Role::Relay, Selector::All).unwrap();
    // the wide caps split no cell: no entry has anywhere to move, and no cell may name one
    let v = c.log.view();
    let (bobs, none) = (Some(CellId::of(alice, &[work])), Some(CellId::of(alice, &[])));
    assert_eq!(LIBRARY.map(|e| cell_of(&c.log, e)), [bobs, none, bobs, none, none]);
    assert!(LIBRARY.iter().all(|&e| v.meaning(e, &c.readings).is_some_and(|m| m.desired.is_none())));
    assert_eq!(c.move_to(MAC_A, alice, DIARY, &[backup]).err(), Some(Refusal::BadCell));
    // Dave reads every entry, in every cell, and writes none; Bob reads and writes the two in his cell alone
    assert!(LIBRARY.iter().all(|&e| reads(&v, MAC_D, e) && !v.may_write(dave, e)));
    assert_eq!(LIBRARY.map(|e| reads(&v, MAC_B, e) && v.may_write(bob, e)), [true, false, true, false, false]);
    // the server receives every entry of Alice's and reads none: a relay cap has no key
    let relayed = entries_in(&respond(c.log.edits(), SERVER));
    assert!(relayed.len() == LIBRARY.len() && LIBRARY.iter().all(|e| relayed.contains(e)));
    assert!(LIBRARY.iter().all(|&e| !reads(&v, SERVER, e)));
    assert!(v.has_fam(KeyFam::Cap(alice, backup)) && !v.has_fam(KeyFam::Cap(alice, relay)));
}
