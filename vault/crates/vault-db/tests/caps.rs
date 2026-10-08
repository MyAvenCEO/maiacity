//! Caps (P2, P4; T1, T4, T8, T17), on the rules alone: spaces, grants per space and per entry, Public, writes checked
//! on import, and the schema lane only owners publish into.

mod common;

use common::*;
use vault_db::lens::{DOCUMENT_LENS, DOCUMENT_V2};
use vault_db::policy::{Action, Grantee, Log, Principal, Refusal, Role, Scope};

#[test]
fn grant_to_signer_rejected() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let handbook = spaces(&mut c, coop).handbook;
    c.log.append(MAC_S, &[], write(handbook, WELCOME, coop, 0)).unwrap();
    let welcome = Scope::Entry(handbook, WELCOME);
    // neither Carol's Mac nor her passkey can be named, only her vault
    for signer in [MAC_C, PASSKEY_C] {
        let to_signer = grant(welcome, Role::Read, Grantee::Principal(Principal::Signer(signer)), coop, None);
        assert_eq!(c.log.check(MAC_S, &[], to_signer).err(), Some(Refusal::GrantToSigner));
    }
    assert!(c.log.check(MAC_S, &[], grant(welcome, Role::Read, vault(c.carol), coop, None)).is_ok());
}

#[test]
fn public_is_read_only() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let handbook = spaces(&mut c, coop).handbook;
    c.log.append(MAC_S, &[], write(handbook, CHARTER, coop, 0)).unwrap();
    let charter = Scope::Entry(handbook, CHARTER);
    // write or owner for Public is refused, even with every signature the coop could give
    for role in [Role::Write, Role::Owner] {
        let public = grant(charter, role, Grantee::Public, coop, None);
        assert_eq!(c.log.check(MAC_S, &[PASSKEY_S, PASSKEY_B], public).err(), Some(Refusal::PublicBeyondRead));
    }
    c.log.append(MAC_S, &[], grant(charter, Role::Read, Grantee::Public, coop, None)).unwrap();
    let v = c.log.view();
    assert!(v.is_public(charter) && !v.is_public(Scope::Entry(handbook, WELCOME)));
    // anyone may receive Charter, but nobody outside the coop can edit it
    assert!(v.may_receive(STRANGER, handbook, CHARTER) && !v.may_receive(STRANGER, handbook, WELCOME));
    assert_eq!(c.log.check(STRANGER, &[], write(handbook, CHARTER, coop, 0)).err(), Some(Refusal::NotActing));
    assert_eq!(c.log.check(MAC_C, &[], write(handbook, CHARTER, c.carol, 0)).err(), Some(Refusal::NoCap));
}

#[test]
fn write_without_cap_rejected_on_import() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let handbook = spaces(&mut c, coop).handbook;
    c.log.append(MAC_S, &[], write(handbook, WELCOME, coop, 0)).unwrap();
    c.log.append(MAC_S, &[], grant(Scope::Entry(handbook, WELCOME), Role::Read, vault(c.carol), coop, None)).unwrap();
    // Carol's Mac holds the same ops; her own peer refuses her edit of Welcome, as she only reads it…
    let carols = Log::from_ops(c.log.ops().to_vec());
    assert_eq!(carols.check(MAC_C, &[], write(handbook, WELCOME, c.carol, 0)).err(), Some(Refusal::NoCap));
    // …and when a patched app sends it anyway, Samuel's peer imports it but never accepts it
    let forced = carols.draft(MAC_C, &[], write(handbook, WELCOME, c.carol, 0));
    c.log.receive([forced.clone()]);
    assert!(!c.log.view().writes(handbook, WELCOME).contains(&forced.id()));
    assert_eq!(c.log.view().writes(handbook, WELCOME).len(), 1);
}

#[test]
fn only_owners_publish_into_the_lane() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let handbook = spaces(&mut c, coop).handbook;
    let (welcome, carol) = (Scope::Entry(handbook, WELCOME), c.carol);
    c.log.append(MAC_S, &[], write(handbook, WELCOME, coop, 0)).unwrap();
    // Carol may write Welcome and even owns it, but only an owner of the whole space publishes into its lane (T17)
    for role in [Role::Write, Role::Owner] {
        c.log.append(PASSKEY_S, &[PASSKEY_B], grant(welcome, role, vault(carol), coop, None)).unwrap();
    }
    let publish = |actor, blob: &[u8]| Action::Publish { space: handbook, actor, blob: blob.to_vec() };
    assert_eq!(c.log.check(MAC_C, &[], publish(carol, DOCUMENT_V2.bytes())).err(), Some(Refusal::NoCap));
    // nor can she claim to act for the coop
    assert_eq!(c.log.check(MAC_C, &[], publish(coop, DOCUMENT_V2.bytes())).err(), Some(Refusal::NotActing));
    // Samuel's Mac acts for the coop, which founded the Handbook: v2 and the lens go in, each blob once
    for blob in [DOCUMENT_V2.bytes(), DOCUMENT_LENS.bytes()] {
        c.log.append(MAC_S, &[], publish(coop, blob)).unwrap();
    }
    assert_eq!(c.log.check(MAC_B, &[], publish(coop, DOCUMENT_V2.bytes())).err(), Some(Refusal::AlreadyPublished));
    let v = c.log.view();
    assert_eq!(v.lane_of(handbook).collect::<Vec<_>>(), [DOCUMENT_V2.bytes(), DOCUMENT_LENS.bytes()]);
    // a space that doesn't exist has no lane
    let nowhere = Action::Publish { space: vault_db::id::SpaceId::from_u64(404), actor: coop, blob: vec![1] };
    assert_eq!(c.log.check(MAC_S, &[], nowhere).err(), Some(Refusal::UnknownSpace));
}
