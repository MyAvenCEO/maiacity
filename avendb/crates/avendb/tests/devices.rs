//! A device on a machine of its own (P8b): randomness drawn from the machine, a device that keeps a secret of its own
//! (the server), claimed once by the first human vault to claim it, as a device of avenMAIA, the aven of the seed
//! that vault founds (P8f), or of a device vault, in the same ceremony that founds it, which then acts for it and never
//! governs it; the contact card the server hands out, its vault's log, which another vault needs before it gives the
//! server's vault a share; and a store reopened from what the device saved, which shows and sends the device's writes
//! as before.

mod common;

use avendb::id::{SignerId, VaultId};
use avendb::keys::KeyFam;
use avendb::lab::Lab;
use avendb::policy::{Action, Kind, Level, Principal, Refusal, Sharing};
use avendb::sign::{Signed, WebAuthn};
use avendb::slice::Selector;
use avendb::world;
use avendb::sync::{log_of, LogId};
use avendb::wire::Claim;
use common::*;

#[test]
fn a_lab_on_a_machine_makes_its_keys_from_the_machines_randomness() {
    let (mut a, mut b) = (Lab::with_entropy([1; 32]), Lab::with_entropy([2; 32]));
    let mut again = Lab::with_entropy([1; 32]);
    let (x, y, x2) = (a.device("a stranger"), b.device("a stranger"), again.device("a stranger"));
    assert_ne!(x, y, "two machines make different keys under the same name");
    assert_eq!(x, x2, "the same randomness makes the same keys, so a failing test replays");
    assert_ne!(x, Lab::new().device("a stranger"), "and neither makes the keys of the Lab's own");
}

/// A server on a machine of its own, and Alice with a passkey and a Mac, her vault founded: nobody has claimed the
/// server yet.
fn unclaimed(seed: u8) -> (Lab, SignerId, SignerId, SignerId, VaultId) {
    let mut lab = Lab::with_entropy([seed; 32]);
    let server = lab.device_with("the server", [7; 32]);
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let alice = human_on(&mut lab, passkey, &[mac]);
    (lab, server, passkey, mac, alice)
}

/// A claim of `server` by hand, as a device that skips `Lab::claim`'s checks would send it: `action`, drafted on
/// `on`, signed by each of its signers but the server in a ceremony of the Lab's software passkey.
fn claim_by_hand(lab: &mut Lab, on: SignerId, signers: &[SignerId], action: Action, server: SignerId) -> Claim {
    let add = lab.draft(on, signers, action).expect("the view takes the edit").edit().clone();
    let id = add.id();
    let sigs = add
        .sigs()
        .filter(|&s| s != server)
        .map(|s| {
            let ceremony = lab.ceremony(s, id.0).expect("a software passkey");
            ceremony.sign(lab.keys_of(s).expect("its keys"), id).expect("its signature")
        })
        .collect();
    Claim { card: lab.card(on), add, sigs }
}

#[test]
fn the_first_human_vault_to_claim_the_server_owns_it_for_good() {
    let (mut lab, server, passkey, mac, alice) = unclaimed(1);
    assert_eq!(server, Lab::with_entropy([2; 32]).device_with("the server", [7; 32]), "its keys are its secret's");
    assert_eq!(lab.vault_of(server), None, "a new server belongs to no vault");
    assert!(lab.claim_key(server).is_ok(), "and hands its key to the first device that asks");
    let aven = claim_on(&mut lab, mac, passkey, alice, server);
    assert_eq!(lab.vault_of(server), Some(aven), "the server is a device of avenMAIA");
    let vault = lab.state(server).vault(aven).expect("avenMAIA").clone();
    let [Principal::Vault(city)] = vault.owners[..] else { panic!("one owner, Maia City: {vault:?}") };
    let coop = lab.state(server).vault(city).map(|v| (v.kind, v.owners.clone()));
    assert_eq!((vault.kind, vault.root), (Kind::Aven, None), "an aven");
    assert_eq!(coop, Some((Kind::Coop, vec![Principal::Vault(alice)])), "of a coop Alice's vault owns alone");
    assert_eq!(world::seed_of(&lab, mac), vec![city, aven], "the seed: Maia City, then avenMAIA");
    assert_eq!(world::seeder(lab.state(server), aven), Some(alice), "the end of the seed Alice's vault founded");
    assert_eq!(vault.devices, vec![server], "with the server its one device");
    assert_eq!(lab.state(mac).vault(aven).map(|v| v.devices.clone()), Some(vec![server]), "on her Mac too");
    // the server opens avenMAIA's key, which Alice's Mac boxed for it, and nothing of Alice's own
    assert!(lab.opens(server, KeyFam::Seed(aven)) && !lab.opens(server, KeyFam::Seed(alice)));
    // it acts for avenMAIA, and never governs it
    let other = lab.device("another server");
    let add = Action::Share(Sharing::Device { vault: aven, device: other, seal_to: None });
    assert_eq!(lab.submit(server, &[server, other], add.clone()), Err(Refusal::BelowThreshold));
    let note = document("Status", "The relay is up.", server);
    let note = lab.create(server, aven, aven, "note", &[], note).expect("the server writes in avenMAIA's vault");
    assert!(lab.reads(server, note), "and reads what it wrote");
    lab.submit(mac, &[passkey, other], add).expect("Alice's passkey adds a second server, through Maia City");
    // nobody claims it again
    assert!(matches!(lab.claim_key(server), Err(Refusal::AlreadyMember)));
}

#[test]
fn a_server_takes_only_a_claim_that_makes_it_a_device_of_a_device_vault() {
    let (mut lab, server, passkey, mac, alice) = unclaimed(3);
    let key = lab.claim_key(server).expect("its key");
    let owners = vec![Principal::Vault(alice)];
    let kind = Kind::DeviceVault;
    let genesis = Action::Genesis { kind, owners, threshold: 1, root: None, nonce: 0, seal_to: vec![] };
    let avenceo = VaultId::from(lab.submit(mac, &[passkey], genesis).expect("avenCEO server"));
    let adds = |vault, device, key| Action::Share(Sharing::Device { vault, device, seal_to: Some(key) });
    // the claiming device claims a device vault alone
    let draft = lab.draft(mac, &[passkey, server], adds(alice, server, key.clone())).expect("a draft");
    assert!(matches!(lab.claim(mac, draft, &[]), Err(Refusal::NotClaiming)));
    // and the server checks for itself: never a device of a human vault, which would open that person's keys
    let into_alices = claim_by_hand(&mut lab, mac, &[passkey, server], adds(alice, server, key.clone()), server);
    assert!(matches!(lab.accept_claim(server, into_alices), Err(Refusal::NotClaiming)));
    // another device than itself, or sealing to another key than the one it handed
    let other = lab.device("another server");
    let other_key = lab.claim_key(other).expect("its key");
    let draft = lab.draft(mac, &[passkey, other], adds(avenceo, other, other_key.clone())).expect("a draft");
    let for_other = lab.claim(mac, draft, &[]).expect("a claim of the other server");
    assert!(matches!(lab.accept_claim(server, for_other), Err(Refusal::NotClaiming)));
    let draft = lab.draft(mac, &[passkey, server], adds(avenceo, server, other_key)).expect("a draft");
    let wrong_key = lab.claim(mac, draft, &[]).expect("a claim sealing to the other key");
    assert!(matches!(lab.accept_claim(server, wrong_key), Err(Refusal::NotClaiming)));
    // the right claim, but a signature missing or one too many, or no card to check it by
    let draft = lab.draft(mac, &[passkey, server], adds(avenceo, server, key)).expect("a draft");
    let claim = lab.claim(mac, draft, &[]).expect("the claim");
    let unsigned = Claim { sigs: vec![], ..claim.clone() };
    assert!(matches!(lab.accept_claim(server, unsigned), Err(Refusal::BadSignature)));
    let twice = Claim { sigs: [&claim.sigs[..], &claim.sigs[..]].concat(), ..claim.clone() };
    assert!(matches!(lab.accept_claim(server, twice), Err(Refusal::BadSignature)));
    let no_card = Claim { card: vec![], ..claim.clone() };
    assert!(matches!(lab.accept_claim(server, no_card), Err(Refusal::UnknownVault)));
    assert_eq!(lab.vault_of(server), None, "none of them claimed it");
    let join = lab.accept_claim(server, claim.clone()).expect("the claim");
    assert_eq!(join.blobs.len(), 1, "the server's join brings its McEliece key");
    assert_eq!(lab.vault_of(server), Some(avenceo));
    assert!(matches!(lab.accept_claim(server, claim), Err(Refusal::AlreadyMember)), "once");
}

#[test]
fn one_ceremony_founds_a_vault_adds_its_device_and_claims_the_server() {
    let mut lab = Lab::with_entropy([9; 32]);
    let server = lab.device_with("the server", [7; 32]);
    let passkey = lab.passkey("Eve");
    let mac = lab.device_of(passkey, "Eve's Mac");
    let key = lab.claim_key(server).expect("a server nobody has claimed hands its key");
    // four edits drafted one on top of the other: Eve's vault, her Mac in it, avenCEO server, and the server in it
    let mut drafting = lab.drafting(mac);
    let owners = vec![Principal::Signer(passkey)];
    let root = Some(passkey);
    let genesis = Action::Genesis { kind: Kind::Human, owners, threshold: 1, root, nonce: 0, seal_to: vec![] };
    let eve = VaultId::from(drafting.draft(&[passkey], genesis).expect("her vault"));
    let add = Action::Share(Sharing::Device { vault: eve, device: mac, seal_to: None });
    drafting.draft(&[passkey, mac], add).expect("her Mac in it");
    let owners = vec![Principal::Vault(eve)];
    let kind = Kind::DeviceVault;
    let server_vault = Action::Genesis { kind, owners, threshold: 1, root: None, nonce: 0, seal_to: vec![] };
    let avenceo = VaultId::from(drafting.draft(&[passkey], server_vault).expect("avenCEO server"));
    let add = Action::Share(Sharing::Device { vault: avenceo, device: server, seal_to: Some(key) });
    drafting.draft(&[passkey, server], add).expect("the server in it");
    let mut drafts = drafting.done();
    let challenge = drafts[0].challenge();
    assert!(drafts.iter().all(|d| d.challenge() == challenge), "one challenge for all four");
    assert!(drafts.iter().all(|d| d.challenge() != d.edit().id().0), "and none of their ids");
    // Eve's passkey signs them all in one ceremony; her Mac keeps the first three, and the server signs the last
    let ceremony = lab.ceremony(passkey, challenge).expect("a software passkey");
    let claim = drafts.pop().expect("the server's");
    for draft in drafts {
        lab.complete(mac, draft, &[(passkey, &ceremony)]).expect("signed by that one ceremony");
    }
    let claim = lab.claim(mac, claim, &[(passkey, &ceremony)]).expect("the claim");
    let join = lab.accept_claim(server, claim).expect("the server takes the claim");
    lab.receive(mac, vec![join.edit], join.blobs.into_iter().map(Into::into).collect());
    assert_eq!((lab.vault_of(mac), lab.vault_of(server)), (Some(eve), Some(avenceo)));
    let vault = lab.state(server).vault(avenceo).expect("avenCEO").clone();
    let owned = (Kind::DeviceVault, &[Principal::Vault(eve)][..]);
    assert_eq!((vault.kind, &vault.owners[..]), owned, "Eve's vault owns it");
    let batched = |id| match &lab.signed_edit(mac, id).expect("held").sigs[0].webauthn {
        Some(WebAuthn::Batch { edits, .. }) => edits.len(),
        _ => 0,
    };
    let genesis = avendb::id::EditId(eve.0);
    assert_eq!(batched(genesis), 4, "her passkey's signature on her vault's genesis names all four edits");
    lab.sync(mac, server);
    assert!(lab.opens(server, KeyFam::Seed(avenceo)), "and the server opens avenCEO's key");
}

#[test]
fn the_server_hands_out_its_avens_log_as_its_contact_card() {
    let (mut lab, server, passkey, mac, alice) = unclaimed(5);
    let avenceo = claim_on(&mut lab, mac, passkey, alice, server);
    let card = lab.card(server);
    let log = |s: &Signed| log_of(&s.edit, s.edit.id());
    assert!(card.iter().any(|s| log(s) == Some(LogId::Vault(avenceo))), "the card holds avenCEO's log");
    let st = lab.state(server);
    let up = |v: VaultId| v == avenceo || st.owns(v, avenceo);
    let ours = |s: &Signed| matches!(log(s), Some(LogId::Vault(v)) if up(v));
    assert!(card.iter().all(ours), "and its owners', up the seed to Alice's vault, and nothing else: no cap or entry");
    assert!(card.iter().any(|s| log(s) == Some(LogId::Vault(alice))), "hers among them");
    // someone else, who knows nothing of this avenCEO, gives it relay on their whole vault once they hold the card
    let mut w = world();
    let bob = w.bob;
    let relay = share(bob, vault(avenceo), Level::Backup, Selector::All);
    let refused = w.lab.issue(w.mac_b, &[w.mac_b], relay.clone()).err();
    assert_eq!(refused, Some(Refusal::UnknownVault), "a vault Bob's Mac doesn't know gets no cap");
    let n = card.len();
    assert_eq!(w.lab.receive(w.mac_b, card, vec![]), n, "Bob's Mac takes every edit of the card");
    w.lab.issue(w.mac_b, &[w.mac_b], relay).expect("with the card, the server relays Bob's vault");
    assert!(w.lab.peers(w.mac_b).iter().any(|(d, _)| *d == server), "and Bob's Mac knows the server as a peer");
}

#[test]
fn a_device_reopened_from_what_it_saved_shows_and_sends_its_writes_as_before() {
    let mut w = world();
    let h = handbook(&mut w);
    w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).expect("an edit");
    let saved = w.lab.backup(w.mac_a);
    // the device starts again from what it saved, as a node does from its store on disk
    w.lab.restore_backup(w.mac_a, &saved);
    assert_eq!(text(&w.lab, w.mac_a, h.welcome, 2).as_deref(), Some(AFTER_TEXT), "it shows the edit");
    w.lab.sync_all(7);
    assert_eq!(text(&w.lab, w.mac_b, h.welcome, 2).as_deref(), Some(AFTER_TEXT), "and Bob's Mac reads it");
}
