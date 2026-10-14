//! Shares (P2, P4; T1, T4, T8, T16, T17, T22), on the rules alone. A grant gives a vault a level on a slice of another
//! vault: relay, read, write or owner on the entries its selector picks, or up to write on the whole vault for a wide
//! grant, which reaches every audience and splits none; owner of the whole vault is an owner of it, never a grant
//! (WideOwner). A device it names only as a keep share, of a device of its issuer, which grants nothing. Everyone only
//! reads; a write no share allows is refused, on import too; only the vault publishes into its schema lane; a share
//! resting on an owner share grants no more than it, and ends with it; and when revocations clash, the most senior
//! revoker stands.

mod common;

use avendb::id::{AudienceId, EntryId, ShareId, SignerId, VaultId};
use avendb::keys::{KeyFam, KeyName};
use avendb::lens::{DOCUMENT_LENS, DOCUMENT_V1, DOCUMENT_V2};
use avendb::policy::{
    mk_audience, replay, Action, Edit, KeepMode, Kind, Level, Log, Principal, Refusal, Revoking, Share, Sharing, State,
    Who,
};
use avendb::slice::Selector;
use avendb::sync::{log_of, respond, LogId};
use common::*;

/// The relay server's device on the rules' log.
const SERVER: SignerId = SignerId::from_u64(600);

/// The entries of Alice's library, in the order her Mac made them.
const LIBRARY: [EntryId; 5] = [DOOR, SEEDS, SOLAR, PLAN, DIARY];

/// Alice's library on the rules, as Examples.lean's `lib`: the door and solar todos tagged work, the seeds todo tagged
/// home, the plan, a note tagged work, and her diary, all made by her Mac in the audience of no shares.
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
    let server = Action::Share(Sharing::Device { vault: aven, device: SERVER, seal_to: None });
    c.log.append(PASSKEY_A, &[SERVER], server).unwrap();
    aven
}

/// A share over vault `over` naming vault `who`, resting on `parent` and issued by `issuer`: what `Cast::issue_on`
/// appends, to check without appending. Its selector travels sealed, and no rule reads it.
fn share_edit(
    over: VaultId,
    who: VaultId,
    level: Level,
    wide: bool,
    parent: Option<ShareId>,
    issuer: VaultId,
) -> Action {
    let share = Share { over, who: vault(who), level, wide, select: vec![], parent, issuer, nonce: 7 };
    Action::Share(Sharing::Grant(share, vec![]))
}

/// A write of entry `e` for `actor`, under the stay `log`'s view has it in and its audience's epoch now: what an app
/// on a device holding `log` sends.
fn write_now(log: &Log, e: EntryId, actor: VaultId) -> Action {
    let st = log.view();
    let en = st.entry(e).expect("an entry the log holds");
    write(en.vault, e, actor, en.stay(), st.epoch(KeyFam::Audience(en.vault, en.audience())))
}

/// The audience entry `e` is in, by `log`'s view.
fn audience_of(log: &Log, e: EntryId) -> Option<AudienceId> {
    Some(log.view().entry(e)?.audience())
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
fn share_to_device_rejected() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    c.create(MAC_A, coop, WELCOME, coop, &[], "doc", &[]).unwrap();
    // neither Carol's Mac nor her passkey can be named, only her vault (T4), whatever the level
    for signer in [MAC_C, PASSKEY_C] {
        for level in [Level::Relay, Level::Read, Level::Write] {
            let refused = c.issue(MAC_A, &[], coop, Who::Device(signer), level, by_id(WELCOME)).err();
            assert_eq!(refused, Some(Refusal::DeviceOnlyKeeps));
        }
    }
    // nor the coop itself, which has every right over its own entries already
    let itself = c.issue(MAC_A, &[], coop, vault(coop), Level::Read, by_id(WELCOME)).err();
    assert_eq!(itself, Some(Refusal::CapToItself));
    c.issue(MAC_A, &[], coop, vault(c.carol), Level::Read, by_id(WELCOME)).unwrap();
    c.tidy(MAC_A);
    // the share names Carol's vault, so it reaches Welcome on whichever device acts for her, a new one too
    assert!(reads(&c.log.view(), MAC_C, WELCOME) && !reads(&c.log.view(), NEW_DEVICE, WELCOME));
    let add = Action::Share(Sharing::Device { vault: c.carol, device: NEW_DEVICE, seal_to: None });
    c.log.append(PASSKEY_C, &[NEW_DEVICE], add).unwrap();
    assert!(reads(&c.log.view(), NEW_DEVICE, WELCOME));
    // a device is named only by a keep share, of a device of its issuer, as Examples.lean's s6 has it: a keep share to
    // a vault is none; the coop has no device to keep its entries on, and Carol keeps nothing on Alice's Mac; Carol
    // keeps Welcome whole on her Mac, which puts it in no audience
    let (carol, whole) = (c.carol, Level::Keep(KeepMode::Whole));
    let keep = |c: &mut Cast, signer, who, issuer| {
        c.issue_on(signer, &[], coop, who, whole, by_id(WELCOME), None, issuer, 2)
    };
    assert_eq!(keep(&mut c, MAC_C, vault(carol), carol).err(), Some(Refusal::KeepNeedsDevice));
    assert_eq!(keep(&mut c, MAC_A, Who::Device(MAC_C), coop).err(), Some(Refusal::NotDevice));
    assert_eq!(keep(&mut c, MAC_C, Who::Device(MAC_A), carol).err(), Some(Refusal::NotDevice));
    let audience = |c: &Cast| c.log.view().entry(WELCOME).map(|en| en.audience());
    let before = audience(&c);
    keep(&mut c, MAC_C, Who::Device(MAC_C), carol).unwrap();
    c.tidy(MAC_A);
    assert_eq!(audience(&c), before);
}

/// Owner of a whole vault is an owner of it, which only the vault's approval and the newcomer's consent make
/// (`Sharing::Owner`): no grant makes anyone that (WideOwner), whoever approves it and whatever it rests on. Owner of a
/// slice and a wide read stay grants.
#[test]
fn owner_of_a_whole_vault_is_no_grant() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let (carol, dave) = (c.carol, c.dave);
    c.create(MAC_A, coop, WELCOME, coop, &[], "doc", &[]).unwrap();
    // refused with both of the coop's passkeys, and before its approval or its parent is looked at
    for cosigners in [&[PASSKEY_A, PASSKEY_B][..], &[]] {
        let wide = c.issue(MAC_A, cosigners, coop, vault(dave), Level::Owner, Selector::All).err();
        assert_eq!(wide, Some(Refusal::WideOwner));
    }
    let carols = c.issue(PASSKEY_A, &[PASSKEY_B], coop, vault(carol), Level::Owner, by_id(WELCOME)).unwrap();
    let on = c.issue_on(PASSKEY_C, &[], coop, vault(dave), Level::Owner, Selector::All, Some(carols), carol, 0);
    assert_eq!(on.err(), Some(Refusal::WideOwner));
    // what may be granted wide is write or less, and owner on a slice
    c.issue(MAC_A, &[], coop, vault(dave), Level::Write, Selector::All).unwrap();
    c.issue(PASSKEY_A, &[PASSKEY_B], coop, vault(dave), Level::Owner, by_id(WELCOME)).unwrap();
    let v = c.log.view();
    assert!(v.shares().iter().all(|cp| !(cp.share.wide && cp.share.level == Level::Owner)));
    // the way to own the whole coop is to become one of its owners
    let owner = Action::Share(Sharing::Owner { vault: coop, owner: Principal::Vault(dave), seal_to: None });
    c.log.append(PASSKEY_A, &[PASSKEY_B, PASSKEY_D], owner).unwrap();
    assert!(c.log.view().owner_of(dave, coop));
}

#[test]
fn everyone_only_reads() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    for e in [WELCOME, CHARTER] {
        c.create(MAC_A, coop, e, coop, &[], "doc", &[]).unwrap();
    }
    // write or owner for everyone is refused, even with every signature the coop could give (T8)
    for level in [Level::Write, Level::Owner] {
        let public = c.issue(MAC_A, &[PASSKEY_A, PASSKEY_B], coop, Who::Everyone, level, by_id(CHARTER));
        assert_eq!(public.err(), Some(Refusal::PublicBeyondRead));
    }
    c.issue(MAC_A, &[], coop, Who::Everyone, Level::Read, by_id(CHARTER)).unwrap();
    // a steward moves Charter into the public share's audience, whose key is published; Welcome's audience's isn't
    c.tidy(MAC_A);
    let v = c.log.view();
    let public = |e| v.entry(e).is_some_and(|en| v.public_key(KeyFam::Audience(coop, en.audience())));
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
fn write_without_share_rejected_on_import() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    c.create(MAC_A, coop, WELCOME, coop, &[], "doc", &[]).unwrap();
    let read = c.issue(MAC_A, &[], coop, vault(c.carol), Level::Read, by_id(WELCOME)).unwrap();
    // a steward, Alice's Mac, moves Welcome into the audience of Carol's share
    c.tidy(MAC_A);
    assert_eq!(audience_of(&c.log, WELCOME), Some(AudienceId::of(coop, &[read])));
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
    // Carol may write Welcome and even owns it, but only the coop publishes into the coop's lane (T17)
    for level in [Level::Write, Level::Owner] {
        c.issue(PASSKEY_A, &[PASSKEY_B], coop, vault(carol), level, by_id(WELCOME)).unwrap();
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
    // owner of the whole coop is an owner of it, which no grant makes, even with both its owners (WideOwner), so Dave
    // doesn't publish into its lane
    let wide = c.issue(PASSKEY_A, &[PASSKEY_B], coop, vault(dave), Level::Owner, Selector::All).err();
    assert_eq!(wide, Some(Refusal::WideOwner));
    assert_eq!(c.log.check(MAC_D, &[], publish(dave, DOCUMENT_V1.bytes())).err(), Some(Refusal::NoCap));
    let v = c.log.view();
    let lane = [DOCUMENT_V2.bytes(), DOCUMENT_LENS.bytes()];
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
    let dave_owner = c.issue(PASSKEY_A, &[], alice, vault(dave), Level::Owner, of_type("note")).unwrap();
    let notes = of_type("note");
    let carol_read = c.issue_on(MAC_D, &[], alice, vault(carol), Level::Read, notes, Some(dave_owner), dave, 0);
    let carol_read = carol_read.unwrap();
    // Dave revokes Carol's read on a copy that never sees Alice go on writing and then revoke Dave's share, so Dave's
    // revocation sorts first
    let mut daves = c.log.clone();
    let revoke = |share, actor| Action::Revoke(Revoking::Grant { share, actor, keep: vec![], via: vec![] });
    let late = daves.append(MAC_D, &[], revoke(carol_read, dave)).unwrap();
    c.create(MAC_A, alice, DIARY, alice, &[], "note", &[]).unwrap();
    c.log.append(MAC_A, &[], write_now(&c.log, PLAN, alice)).unwrap();
    let senior = c.log.append(PASSKEY_A, &[], revoke(dave_owner, alice)).unwrap();
    // the vault the shares are over ranks first, wherever the revocations sort: both shares are gone, in either order
    // of arrival, and Dave's revocation falls with the share it rested on
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
/// and, claiming more than she holds, her notes. A share selects only what every share of its chain does, and ends with
/// them.
#[test]
fn a_share_on_an_owner_share_grants_no_more_than_it() {
    let mut c = alices_library();
    let (alice, bob, carol, dave) = (c.alice, c.bob, c.carol, c.dave);
    // a device alone can't make anyone owner; Alice's passkey can
    let refused = c.issue(MAC_A, &[], alice, vault(carol), Level::Owner, of_type("todo")).err();
    assert_eq!(refused, Some(Refusal::BelowThreshold));
    let owner = c.issue(PASSKEY_A, &[], alice, vault(carol), Level::Owner, of_type("todo")).unwrap();
    let (home, notes) = (tagged("todo", "home"), of_type("note"));
    let home = c.issue_on(MAC_C, &[], alice, vault(dave), Level::Read, home, Some(owner), carol, 0).unwrap();
    let notes = c.issue_on(MAC_C, &[], alice, vault(dave), Level::Read, notes, Some(owner), carol, 1).unwrap();
    // only the grantee of an owner share issues on it, only on an owner share, and a wide share only on a wide one
    let on = |parent, issuer, wide| share_edit(alice, bob, Level::Read, wide, Some(parent), issuer);
    assert_eq!(c.log.check(MAC_B, &[], on(owner, bob, false)).err(), Some(Refusal::BadParent));
    assert_eq!(c.log.check(MAC_D, &[], on(home, dave, false)).err(), Some(Refusal::BadParent));
    assert_eq!(c.log.check(MAC_C, &[], on(owner, carol, true)).err(), Some(Refusal::BadParent));
    // an owner share resting on Carol's takes her own approval
    let owner_on = share_edit(alice, dave, Level::Owner, false, Some(owner), carol);
    assert_eq!(c.log.check(MAC_C, &[], owner_on.clone()).err(), Some(Refusal::BelowThreshold));
    assert!(c.log.check(PASSKEY_C, &[], owner_on).is_ok());
    // Dave's shares select what every share of their chain selects: the todo tagged home, and no note at all
    let v = c.log.view();
    let selects = |share| {
        let share = v.share(share).expect("a cap");
        LIBRARY.map(|e| v.meaning(e, &c.readings).is_some_and(|m| v.eff_selects(share, &m.attrs, &c.readings)))
    };
    assert_eq!((selects(home), selects(notes)), ([false, true, false, false, false], [false; 5]));
    // so a steward moves the todos into the audiences of Carol's share, the one tagged home into Dave's too, and no
    // note
    let desired = LIBRARY.map(|e| v.meaning(e, &c.readings).and_then(|m| m.desired));
    let (carols, both) = (Some(vec![owner]), Some(mk_audience(&[owner, home])));
    assert_eq!(desired, [carols.clone(), both, carols, None, None]);
    c.tidy(MAC_A);
    let v = c.log.view();
    assert_eq!(LIBRARY.map(|e| reads(&v, MAC_C, e)), [true, true, true, false, false]);
    assert_eq!(LIBRARY.map(|e| reads(&v, MAC_D, e)), [false, true, false, false, false]);
    // Carol, who issued Dave's share, and Dave, giving it up, may revoke it; Bob may not
    let revoke = |share, actor| Action::Revoke(Revoking::Grant { share, actor, keep: vec![], via: vec![] });
    assert!(c.log.check(MAC_C, &[], revoke(home, carol)).is_ok());
    assert!(c.log.check(MAC_D, &[], revoke(home, dave)).is_ok());
    assert_eq!(c.log.check(MAC_B, &[], revoke(home, bob)).err(), Some(Refusal::NoCap));
    // revoking Carol's owner share is governance, and ends Dave's shares with it; no entry has to move
    assert_eq!(c.log.check(MAC_A, &[], revoke(owner, alice)).err(), Some(Refusal::BelowThreshold));
    c.log.append(PASSKEY_A, &[], revoke(owner, alice)).unwrap();
    let v = c.log.view();
    assert!([owner, home, notes].iter().all(|&share| !v.live(share)));
    assert!(LIBRARY.iter().all(|&e| v.meaning(e, &c.readings).is_some_and(|m| m.desired.is_none())));
    assert!(LIBRARY.iter().all(|&e| !reads(&v, MAC_C, e) && !reads(&v, MAC_D, e)));
}

/// Examples.lean's `wideShares`: Alice gives Dave, her backup, read on her whole vault, and avenCEO, the server's
/// vault, relay on it.
#[test]
fn a_wide_share_reaches_every_audience_and_splits_none() {
    let mut c = alices_library();
    let (alice, bob, dave) = (c.alice, c.bob, c.dave);
    // Bob writes Alice's todos tagged work: her Mac moves them into his share's audience
    let work = c.issue(MAC_A, &[], alice, vault(bob), Level::Write, tagged("todo", "work")).unwrap();
    c.tidy(MAC_A);
    let ceo = aven_of_alice(&mut c);
    let backup = c.issue(MAC_A, &[], alice, vault(dave), Level::Read, Selector::All).unwrap();
    let relay = c.issue(MAC_A, &[], alice, vault(ceo), Level::Backup, Selector::All).unwrap();
    // the wide shares split no audience: no entry has anywhere to move, and no audience may name one
    let v = c.log.view();
    let (bobs, none) = (Some(AudienceId::of(alice, &[work])), Some(AudienceId::of(alice, &[])));
    assert_eq!(LIBRARY.map(|e| audience_of(&c.log, e)), [bobs, none, bobs, none, none]);
    assert!(LIBRARY.iter().all(|&e| v.meaning(e, &c.readings).is_some_and(|m| m.desired.is_none())));
    assert_eq!(c.move_to(MAC_A, alice, DIARY, &[backup]).err(), Some(Refusal::BadAudience));
    // Dave reads every entry, in every audience, and writes none; Bob reads and writes the two in his audience alone
    assert!(LIBRARY.iter().all(|&e| reads(&v, MAC_D, e) && !v.may_write(dave, e)));
    assert_eq!(LIBRARY.map(|e| reads(&v, MAC_B, e) && v.may_write(bob, e)), [true, false, true, false, false]);
    // the server receives every entry of Alice's and reads none: a relay share has no key
    let relayed = entries_in(&respond(c.log.edits(), SERVER));
    assert!(relayed.len() == LIBRARY.len() && LIBRARY.iter().all(|e| relayed.contains(e)));
    assert!(LIBRARY.iter().all(|&e| !reads(&v, SERVER, e)));
    assert!(v.has_fam(KeyFam::Share(alice, backup)) && !v.has_fam(KeyFam::Share(alice, relay)));
}

/// Relay alone (T26): Alice gives avenCEO relay on her whole vault, no backup. The server learns her vault's devices,
/// from her vault's log, so its relay lets them through and they find each other there, and receives none of her
/// entries; backup on top of it brings them.
#[test]
fn a_relay_share_keeps_nothing() {
    let mut c = alices_library();
    let alice = c.alice;
    let ceo = aven_of_alice(&mut c);
    let relay = c.issue(MAC_A, &[], alice, vault(ceo), Level::Relay, Selector::All).unwrap();
    let sent = respond(c.log.edits(), SERVER);
    assert!(entries_in(&sent).is_empty(), "no entry of Alice's");
    let known = avendb::policy::view(&sent);
    let hers = known.vault(alice).expect("Alice's vault, from its log");
    assert!(hers.devices.contains(&MAC_A), "her devices, for the relay to let through");
    assert!(sent.iter().any(|e| ShareId::from(e.id()) == relay), "the cap itself");
    // with backup, the server keeps the ciphertext of every entry, and still reads none
    c.issue(MAC_A, &[], alice, vault(ceo), Level::Backup, Selector::All).unwrap();
    let kept = entries_in(&respond(c.log.edits(), SERVER));
    assert!(LIBRARY.iter().all(|e| kept.contains(e)));
    assert!(LIBRARY.iter().all(|&e| !reads(&c.log.view(), SERVER, e)));
}
