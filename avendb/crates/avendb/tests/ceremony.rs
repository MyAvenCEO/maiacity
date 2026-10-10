//! A passkey in the platform's authenticator (P8e): a browser's device never holds its person's passkey, only what
//! one ceremony at a time brings back, an assertion over a challenge and the PRF output on the app's salt. It drafts
//! each edit the passkey signs, the passkey signs the edit's id in a ceremony, and the device keeps the edit; its own
//! keys come from the PRF output on a salt of its own, or from a secret of its own that output masks. It writes with
//! no ceremony, a note of its vault in a cell whose key it makes; and once it joins Alice's vault, the keys of the
//! coop's cells reach it as they reach any of Alice's devices. A new device signs up or in with two ceremonies: the one
//! that unlocks it is its passkey's pass for it, as it made its secret first, and the next founds or joins its vault,
//! which also shows which of the keys the first one recovers to is the passkey's. Here a software passkey stands in for
//! the browser's authenticator: it makes the same ceremonies, and the device's Lab sees nothing else of it.

mod common;

use common::*;
use avendb::id::{CellId, EditId, SignerId};
use avendb::keys::{self, KeyFam};
use avendb::lab::Lab;
use avendb::policy::{Action, Kind, Principal, Refusal};
use avendb::sign::{self, Passkey, RelayPass, device_salt, pass_challenge};
use avendb::wire::{Join, Reply, Request, Wire};

/// The time a pass is made at: seconds since 1970.
const NOW: u64 = 1_791_500_000;

/// A browser's device in a Lab of its own, its passkey brought in by the ceremony that unlocks it: the device's keys
/// from the PRF output on its salt, which ends in `nonce`, and the passkey's from that ceremony and its P-256 key.
fn browser(authenticator: &mut Passkey, nonce: [u8; 32]) -> (Lab, SignerId, SignerId) {
    let mut lab = Lab::with_entropy([7; 32]);
    let unlock = authenticator.ceremony([1; 32]);
    let passkey = lab.web_passkey("Alice", authenticator.public(), &unlock).expect("the passkey's own ceremony");
    let device = lab.device_with("Alice's browser", *authenticator.prf(&device_salt(&nonce)));
    (lab, passkey, device)
}

/// The genesis of the human vault whose root is passkey `passkey`.
fn genesis(passkey: SignerId) -> Action {
    let owners = vec![Principal::Signer(passkey)];
    Action::Genesis { kind: Kind::Human, owners, threshold: 1, root: Some(passkey), nonce: 0, seal_to: vec![] }
}

/// `action` signed by `signers` on device `on`, the passkey `passkey` among them in a ceremony of `authenticator`.
fn ceremony(lab: &mut Lab, on: SignerId, signers: &[SignerId], action: Action, authenticator: &mut Passkey) -> EditId {
    let draft = lab.draft(on, signers, action).expect("the device's view takes it");
    let ceremony = authenticator.ceremony(draft.challenge());
    lab.complete(on, draft, &[(authenticator.id(), &ceremony)]).expect("the passkey signed it")
}

/// `to` asks `from` once, by the bytes alone, as in `split.rs`. How many edits were new to `to`.
fn ask(to: (&mut Lab, SignerId), from: (&mut Lab, SignerId)) -> usize {
    let ((to, t), (from, f)) = (to, from);
    let request = Request::from_wire(&to.request(t, f).to_wire()).expect("a request");
    let (edits, ids, more) = from.reply(f, t, &request, usize::MAX);
    let blobs = ids.iter().map(|&b| (b, [0; 32])).collect();
    let reply = Reply::from_wire(&Reply { edits, blobs, more }.to_wire()).expect("a reply");
    let blobs = reply.blobs.iter().filter(|(b, _)| from.may_fetch(f, t, *b)).filter_map(|(b, _)| from.blob(f, *b));
    to.receive(t, reply.edits, blobs.collect())
}

#[test]
fn a_browser_founds_alices_vault_in_ceremonies() {
    let mut authenticator = Passkey::from_seed([1; 32]);
    let (mut lab, passkey, device) = browser(&mut authenticator, [5; 32]);
    assert_eq!(passkey, authenticator.id(), "the ceremony shows the passkey's keys");
    assert_eq!(device, authenticator.device([5; 32]).id(), "and the PRF output on the device's salt its keys");
    let genesis = genesis(passkey);
    let vault = ceremony(&mut lab, device, &[passkey], genesis, &mut authenticator).into();
    let add = Action::AddDevice { vault, device, seal_to: None };
    ceremony(&mut lab, device, &[passkey, device], add, &mut authenticator);
    assert_eq!(lab.vault_of(device), Some(vault), "the browser belongs to the vault its passkey founded");
    assert!(lab.opens(device, KeyFam::Seed(vault)), "and opens its seed");
    // the device writes on its own, with no ceremony: a note in its vault, in the cell of no caps, as no cap selects it
    let note = lab.create(device, vault, vault, "note", &[], document("Seeds", "Tomatoes in March.", device));
    let note = note.expect("the browser writes a note");
    let cell = KeyFam::Cell(vault, CellId::of(vault, &[]));
    assert!(lab.opens(device, cell), "under the key of a cell it made");
    assert_eq!(text(&lab, device, note, 2).as_deref(), Some("Tomatoes in March."));
    // locked, it opens nothing; the PRF output on its salt unlocks it again, and nothing else does
    lab.lock(device);
    assert!(!lab.opens(device, KeyFam::Seed(vault)) && !lab.opens(device, cell));
    assert!(!lab.unlock(device), "the Lab holds no passkey to derive its keys from");
    assert!(!lab.unlock_with(device, *authenticator.prf(&device_salt(&[6; 32]))), "another salt's output");
    assert!(lab.unlock_with(device, *authenticator.prf(&device_salt(&[5; 32]))));
    assert_eq!(text(&lab, device, note, 2).as_deref(), Some("Tomatoes in March."), "it reads again");
}

#[test]
fn a_passkey_signs_only_in_its_ceremony_over_the_edit() {
    let mut authenticator = Passkey::from_seed([1; 32]);
    let (mut lab, passkey, device) = browser(&mut authenticator, [5; 32]);
    let genesis = genesis(passkey);
    // without a ceremony, the passkey isn't at hand
    assert_eq!(lab.submit(device, &[passkey], genesis.clone()), Err(Refusal::Locked));
    // a ceremony over another challenge, or of another passkey, signs nothing
    let draft = lab.draft(device, &[passkey], genesis.clone()).expect("a draft");
    let elsewhere = authenticator.ceremony([2; 32]);
    assert_eq!(lab.complete(device, draft, &[(passkey, &elsewhere)]), Err(Refusal::BadSignature));
    let draft = lab.draft(device, &[passkey], genesis.clone()).expect("a draft");
    let theirs = Passkey::from_seed([2; 32]).ceremony(draft.challenge());
    assert_eq!(lab.complete(device, draft, &[(passkey, &theirs)]), Err(Refusal::BadSignature));
    assert!(lab.log(device).ids().is_empty(), "the device kept none of them");
    // its own ceremony over the edit's id does
    let draft = lab.draft(device, &[passkey], genesis).expect("a draft");
    let own = authenticator.ceremony(draft.challenge());
    let id = lab.complete(device, draft, &[(passkey, &own)]).expect("the passkey signed it");
    assert!(lab.signed_edit(device, id).expect("kept").verify().is_ok());
    // a ceremony that isn't the passkey's own shows no passkey
    assert!(lab.web_passkey("Eve", Passkey::from_seed([3; 32]).public(), &own).is_none());
}

#[test]
fn the_lab_holds_no_secret_of_a_browsers_passkey() {
    // a passkey of its own: the tests beside it make their passkeys' pairs in the same process
    let mut authenticator = Passkey::from_seed([4; 32]);
    let (mut lab, passkey, device) = browser(&mut authenticator, [5; 32]);
    let genesis = genesis(passkey);
    let vault = ceremony(&mut lab, device, &[passkey], genesis, &mut authenticator).into();
    let add = Action::AddDevice { vault, device, seal_to: None };
    ceremony(&mut lab, device, &[passkey, device], add, &mut authenticator);
    assert!(lab.secrets(passkey).is_empty(), "no secret of the passkey");
    assert!(lab.passkey_secret(passkey).is_none(), "nor its private key");
    assert!(lab.relay_pass(device, passkey, NOW).is_none(), "it makes a pass in a ceremony alone");
    // the McEliece pair of the key sealed to the passkey, which it lent the device, is forgotten as the device locks
    let pair = authenticator.seal_secret().id();
    assert!(keys::pair_made(pair), "the device opened the vault key with it");
    lab.lock(device);
    assert!(!keys::pair_made(pair), "the process forgot the passkey's pair");
}

/// A new browser's device and the ceremony that unlocks it, which is its passkey's pass for it made at `NOW`: the
/// browser made the device's secret, `secret`, before the ceremony, so that its challenge names the device. With the
/// passkey's keys for each P-256 key the ceremony's assertion recovers to, as the browser can't tell which is the
/// passkey's yet.
fn fresh(authenticator: &mut Passkey, secret: [u8; 32]) -> (Lab, SignerId, Vec<SignerId>, RelayPass) {
    let key = sign::DeviceKey::from_secret(secret);
    let unlock = authenticator.ceremony(pass_challenge(key.id(), NOW));
    let mut lab = Lab::with_entropy([7; 32]);
    let device = lab.device_with("Alice's browser", secret);
    let pass = unlock.pass(key.keys(), NOW).expect("the unlock is the passkey's pass for the device");
    let recovered = unlock.assertion.recover().into_iter();
    let passkeys: Vec<SignerId> = recovered.filter_map(|p256| lab.web_passkey("Alice", p256, &unlock)).collect();
    (lab, device, passkeys, RelayPass::from_wire(&pass.to_wire()).expect("a pass"))
}

#[test]
fn a_new_browser_founds_its_vault_in_two_ceremonies() {
    let mut authenticator = Passkey::from_seed([1; 32]);
    let (mut lab, device, passkeys, pass) = fresh(&mut authenticator, [6; 32]);
    assert!(passkeys.contains(&authenticator.id()) && passkeys.len() >= 2, "a few passkeys it may be, Alice's among them");
    assert_eq!(pass.passkeys(NOW), passkeys, "the relay would let it in as any of them");
    assert_eq!(pass.device.id(), device);
    // its vault and itself in it, for each of them, in one batch: the second ceremony signs them all
    let found = |d: &mut avendb::lab::Drafting<'_>, p: SignerId| {
        let vault = d.draft(&[p], genesis(p))?.into();
        d.draft(&[p, device], Action::AddDevice { vault, device, seal_to: None })?;
        Ok(vault)
    };
    let sets = lab.drafting_for(device, &passkeys, found).expect("each drafts");
    let challenge = sets[0].2[0].challenge();
    assert!(sets.iter().flat_map(|(_, _, ds)| ds).all(|d| d.challenge() == challenge), "one batch");
    let ceremony = authenticator.ceremony(challenge);
    // the set of every other key fails, as the ceremony's assertion verifies under the passkey's key alone
    let mut kept = vec![];
    for (passkey, vault, drafts) in sets {
        let done: Result<Vec<EditId>, Refusal> =
            drafts.into_iter().map(|d| lab.complete(device, d, &[(passkey, &ceremony)])).collect();
        match done {
            Ok(_) => kept.push((passkey, vault)),
            Err(why) => assert_eq!(why, Refusal::BadSignature, "{passkey:?}"),
        }
    }
    assert_eq!(kept.len(), 1, "one passkey's set is kept");
    let (passkey, vault) = kept[0];
    assert_eq!(passkey, authenticator.id(), "Alice's");
    assert_eq!(lab.vault_of(device), Some(vault), "the browser belongs to the vault its passkey founded");
    assert!(lab.opens(device, KeyFam::Seed(vault)), "and opens its seed");
    for id in lab.log(device).ids().to_vec() {
        assert!(lab.signed_edit(device, id).expect("kept").verify().is_ok(), "every edit it kept is signed");
    }
}

#[test]
fn a_browser_links_through_alices_mac_in_two_ceremonies() {
    let mut w = world();
    let h = handbook(&mut w);
    let mut mac = w.lab.split(w.mac_a, &[], [1; 32]);
    let secret = w.lab.passkey_secret(w.passkey_a).expect("Alice's software passkey");
    // the browser's authenticator holds Alice's passkey, as her platform syncs it; the browser never saw it made
    let mut authenticator = Passkey::from_seed(*secret);
    let (mut browser, device, passkeys, pass) = fresh(&mut authenticator, [6; 32]);
    assert!(passkeys.contains(&w.passkey_a));
    // on their connection, where the browser's hello proved its device, the Mac hands it the link card of each
    // passkey the pass may be from: only Alice's roots a vault
    assert_eq!(pass.device.id(), device, "the pass is for the device on the connection");
    let card = pass.passkeys(NOW).into_iter().flat_map(|p| mac.link_card(w.mac_a, p)).collect();
    browser.receive(device, card, vec![]);
    let joining: Vec<_> = passkeys.iter().filter_map(|&p| Some((p, browser.joining(device, p).ok()?))).collect();
    assert_eq!(joining, [(w.passkey_a, (w.alice, None))], "Alice's vault, by the card, so her passkey is Alice's");
    let (passkey, vault) = (w.passkey_a, w.alice);
    // it joins Alice's vault: the second ceremony signs the edit that adds it, and the Mac takes it
    let add = Action::AddDevice { vault, device, seal_to: None };
    let id = ceremony(&mut browser, device, &[passkey, device], add, &mut authenticator);
    let join = Join::from_wire(&browser.joined(device, id).to_wire()).expect("a join");
    mac.accept_join(w.mac_a, device, join).expect("the Mac takes the join");
    assert_eq!(browser.joining(device, passkey), Ok((vault, Some(id))), "joined, it would send the same edit again");
    for _ in 0..4 {
        ask((&mut mac, w.mac_a), (&mut browser, device));
        ask((&mut browser, device), (&mut mac, w.mac_a));
    }
    let cell = KeyFam::Cell(h.coop, CellId::of(h.coop, &[]));
    assert!(browser.opens(device, KeyFam::Seed(h.coop)), "the browser opens the coop's seed");
    assert!(browser.opens(device, cell), "and the key of the cell Welcome is in");
    assert_eq!(text(&browser, device, h.welcome, 2).as_deref(), Some(WELCOME_TEXT), "and reads Welcome");
}
