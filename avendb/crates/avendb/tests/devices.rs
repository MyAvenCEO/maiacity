//! A device on a machine of its own (P8b): randomness drawn from the machine, a device that keeps a secret of its own
//! (the server), claimed once by the first human vault to claim it, as a device of avenCEO (P8f), in the same ceremony
//! that founds that vault, which then acts for avenCEO and never governs it; the contact card the server hands out,
//! avenCEO's vault log, which another vault needs before it gives avenCEO a cap; and a store reopened from what the
//! device saved, which goes on vouching for the device's writes.

mod common;

use avendb::id::{SignerId, VaultId};
use avendb::keys::KeyFam;
use avendb::lab::Lab;
use avendb::policy::{Action, Kind, Principal, Refusal, Role};
use avendb::sign::{Classical, Signed};
use avendb::slice::Selector;
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
    let (id, pq) = (add.id(), avendb::sign::needs_pq(&add));
    let sigs = add
        .sigs()
        .filter(|&s| s != server)
        .map(|s| {
            let ceremony = lab.ceremony(s, id.0).expect("a software passkey");
            ceremony.sign(lab.keys_of(s).expect("its keys"), id, pq).expect("its signature")
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
    let avenceo = claim_on(&mut lab, mac, passkey, alice, server);
    assert_eq!(lab.vault_of(server), Some(avenceo), "the server is a device of avenCEO");
    let vault = lab.state(server).vault(avenceo).expect("avenCEO").clone();
    assert_eq!((vault.kind, &vault.owners[..], vault.root), (Kind::Aven, &[Principal::Vault(alice)][..], None));
    assert_eq!(vault.devices, vec![server], "owned by Alice's vault, with the server its one device");
    assert_eq!(lab.state(mac).vault(avenceo).map(|v| v.devices.clone()), Some(vec![server]), "on her Mac too");
    // the server opens avenCEO's key, which Alice's Mac boxed for it, and nothing of Alice's own
    assert!(lab.opens(server, KeyFam::Seed(avenceo)) && !lab.opens(server, KeyFam::Seed(alice)));
    // it acts for avenCEO, and never governs it
    let other = lab.device("another server");
    let add = Action::AddDevice { vault: avenceo, device: other, seal_to: None };
    assert_eq!(lab.submit(server, &[server, other], add.clone()), Err(Refusal::BelowThreshold));
    let note = document("Status", "The relay is up.", server);
    let note = lab.create(server, avenceo, avenceo, "note", &[], note).expect("the server writes in avenCEO's vault");
    assert!(lab.reads(server, note), "and reads what it wrote");
    lab.submit(mac, &[passkey, other], add).expect("Alice's passkey adds a second server, through her vault");
    // nobody claims it again
    assert!(matches!(lab.claim_key(server), Err(Refusal::AlreadyMember)));
}

#[test]
fn a_server_takes_only_a_claim_that_makes_it_a_device_of_an_aven_vault() {
    let (mut lab, server, passkey, mac, alice) = unclaimed(3);
    let key = lab.claim_key(server).expect("its key");
    let owners = vec![Principal::Vault(alice)];
    let genesis = Action::Genesis { kind: Kind::Aven, owners, threshold: 1, root: None, nonce: 0, seal_to: vec![] };
    let avenceo = VaultId::from(lab.submit(mac, &[passkey], genesis).expect("avenCEO"));
    let adds = |vault, device, key| Action::AddDevice { vault, device, seal_to: Some(key) };
    // the claiming device claims an aven vault alone
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
    // four edits drafted one on top of the other: Eve's vault, her Mac in it, avenCEO, and the server in avenCEO
    let mut drafting = lab.drafting(mac);
    let owners = vec![Principal::Signer(passkey)];
    let root = Some(passkey);
    let genesis = Action::Genesis { kind: Kind::Human, owners, threshold: 1, root, nonce: 0, seal_to: vec![] };
    let eve = VaultId::from(drafting.draft(&[passkey], genesis).expect("her vault"));
    let add = Action::AddDevice { vault: eve, device: mac, seal_to: None };
    drafting.draft(&[passkey, mac], add).expect("her Mac in it");
    let owners = vec![Principal::Vault(eve)];
    let aven = Action::Genesis { kind: Kind::Aven, owners, threshold: 1, root: None, nonce: 0, seal_to: vec![] };
    let avenceo = VaultId::from(drafting.draft(&[passkey], aven).expect("avenCEO"));
    let add = Action::AddDevice { vault: avenceo, device: server, seal_to: Some(key) };
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
    assert_eq!((vault.kind, &vault.owners[..]), (Kind::Aven, &[Principal::Vault(eve)][..]), "Eve's vault owns it");
    let batched = |id| match &lab.signed_edit(mac, id).expect("held").sigs[0].classical {
        Classical::Batch { edits, .. } => edits.len(),
        _ => 0,
    };
    let genesis = avendb::id::EditId(eve.0);
    assert_eq!(batched(genesis), 4, "her passkey's signature on her vault's genesis names all four edits");
    lab.sync(mac, server);
    assert!(lab.opens(server, KeyFam::Seed(avenceo)), "and the server opens avenCEO's key");
}

#[test]
fn the_server_hands_out_avenceos_log_as_its_contact_card() {
    let (mut lab, server, passkey, mac, alice) = unclaimed(5);
    let avenceo = claim_on(&mut lab, mac, passkey, alice, server);
    let card = lab.card(server);
    let log = |s: &Signed| log_of(&s.edit, s.edit.id());
    assert!(card.iter().any(|s| log(s) == Some(LogId::Vault(avenceo))), "the card holds avenCEO's log");
    let ours = |s: &Signed| matches!(log(s), Some(LogId::Vault(v)) if v == avenceo || v == alice);
    assert!(card.iter().all(ours), "and its owner's, and nothing else: no cap, cell or entry");
    // someone else, who knows nothing of this avenCEO, gives it relay on their whole vault once they hold the card
    let mut w = world();
    let bob = w.bob;
    let relay = cap(bob, vault(avenceo), Role::Relay, Selector::All);
    let refused = w.lab.issue(w.mac_b, &[w.mac_b], relay.clone()).err();
    assert_eq!(refused, Some(Refusal::UnknownVault), "a vault Bob's Mac doesn't know gets no cap");
    let n = card.len();
    assert_eq!(w.lab.receive(w.mac_b, card, vec![]), n, "Bob's Mac takes every edit of the card");
    w.lab.issue(w.mac_b, &[w.mac_b], relay).expect("with the card, the server relays Bob's vault");
    assert!(w.lab.peers(w.mac_b).iter().any(|(d, _)| *d == server), "and Bob's Mac knows the server as a peer");
}

#[test]
fn a_device_reopened_from_what_it_saved_vouches_for_its_writes_as_before() {
    let mut w = world();
    let h = handbook(&mut w);
    let after = w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).expect("an edit");
    let saved = w.lab.backup(w.mac_a);
    // the device starts again from what it saved, as a node does from its store on disk
    w.lab.restore_backup(w.mac_a, &saved);
    w.lab.checkpoint(w.mac_a);
    let vouched = w.lab.log(w.mac_a).edits().iter().any(|edit| {
        edit.author == w.mac_a && matches!(&edit.action, Action::Checkpoint { covers, .. } if covers.contains(&after))
    });
    assert!(vouched, "a checkpoint of its own covers the edit it made before it started again");
    assert_eq!(text(&w.lab, w.mac_a, h.welcome, 2).as_deref(), Some(AFTER_TEXT), "and it shows the edit");
}
