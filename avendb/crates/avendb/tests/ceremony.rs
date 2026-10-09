//! A passkey in the platform's authenticator (P8e): a browser's device never holds its person's passkey, only what
//! one ceremony at a time brings back, an assertion over a challenge and the PRF output on the app's salt. It drafts
//! each op the passkey signs, the passkey signs the op's id in a ceremony, and the device keeps the op; its own keys
//! derive from the PRF output on a salt of its own. Here a software passkey stands in for the browser's
//! authenticator: it makes the same ceremonies, and the device's Lab sees nothing else of it.

mod common;

use common::*;
use avendb::id::{OpId, SignerId};
use avendb::keys::{self, KeyScope};
use avendb::lab::Lab;
use avendb::policy::{Action, Kind, Principal, Refusal};
use avendb::sign::{self, Passkey, PasskeyHello, RelayPass, device_salt, hello_challenge, pass_challenge, passkey_key};
use avendb::wire::{Join, Reply, Request, Wire};

/// The TLS exporter of the connection between the browser, which dials, and its peer.
const EXPORTER: [u8; 32] = [9; 32];

/// The time a pass is made at: seconds since 1970.
const NOW: u64 = 1_791_500_000;

/// A browser's device in a Lab of its own, its passkey brought in by the ceremony that unlocks it: the device's keys
/// from the PRF output on its salt, which ends in `nonce`, and the passkey's from that ceremony and its P-256 key.
fn browser(authenticator: &mut Passkey, nonce: [u8; 32]) -> (Lab, SignerId, SignerId) {
    let mut lab = Lab::with_entropy([7; 32]);
    let unlock = authenticator.ceremony([1; 32]);
    let passkey = lab.web_passkey("Samuel", authenticator.public(), &unlock).expect("the passkey's own ceremony");
    let device = lab.web_device(passkey, "Samuel's browser", nonce, *authenticator.prf(&device_salt(&nonce)));
    (lab, passkey, device)
}

/// The genesis of the human vault whose root is passkey `passkey`.
fn genesis(passkey: SignerId) -> Action {
    let owners = vec![Principal::Signer(passkey)];
    Action::Genesis { kind: Kind::Human, owners, threshold: 1, root: Some(passkey), nonce: 0, seal_to: vec![] }
}

/// `action` signed by `signers` on device `on`, the passkey `passkey` among them in a ceremony of `authenticator`.
fn ceremony(lab: &mut Lab, on: SignerId, signers: &[SignerId], action: Action, authenticator: &mut Passkey) -> OpId {
    let draft = lab.draft(on, signers, action).expect("the device's view takes it");
    let ceremony = authenticator.ceremony(draft.challenge());
    lab.complete(on, draft, &[(authenticator.id(), &ceremony)]).expect("the passkey signed it")
}

/// `to` asks `from` once, by the bytes alone, as in `split.rs`. How many ops were new to `to`.
fn ask(to: (&mut Lab, SignerId), from: (&mut Lab, SignerId)) -> usize {
    let ((to, t), (from, f)) = (to, from);
    let request = Request::from_wire(&to.request(t, f).to_wire()).expect("a request");
    let (ops, ids, more) = from.reply(f, t, &request, usize::MAX);
    let blobs = ids.iter().map(|&b| (b, [0; 32])).collect();
    let reply = Reply::from_wire(&Reply { ops, blobs, more }.to_wire()).expect("a reply");
    let blobs = reply.blobs.iter().filter(|(b, _)| from.may_fetch(f, t, *b)).filter_map(|(b, _)| from.blob(f, *b));
    to.receive(t, reply.ops, blobs.collect())
}

#[test]
fn a_browser_founds_samuels_vault_in_ceremonies() {
    let mut authenticator = Passkey::from_seed([1; 32]);
    let (mut lab, passkey, device) = browser(&mut authenticator, [5; 32]);
    assert_eq!(passkey, authenticator.id(), "the ceremony shows the passkey's keys");
    assert_eq!(device, authenticator.device([5; 32]).id(), "and the PRF output on the device's salt its keys");
    let genesis = genesis(passkey);
    let vault = ceremony(&mut lab, device, &[passkey], genesis, &mut authenticator).into();
    let add = Action::AddDevice { vault, device, seal_to: None };
    ceremony(&mut lab, device, &[passkey, device], add, &mut authenticator);
    assert_eq!(lab.vault_of(device), Some(vault), "the browser belongs to the vault its passkey founded");
    assert!(lab.opens(device, KeyScope::Vault(vault)), "and opens its key");
    // the device writes on its own, with no ceremony
    let found = Action::FoundSpace { actor: vault, nonce: 1, via: vec![] };
    let space = lab.submit(device, &[device], found).expect("the browser founds a space").into();
    let note = lab.create(device, vault, space, document("Seeds", "Tomatoes in March.", device));
    let note = note.expect("and writes in it");
    assert_eq!(text(&lab, device, space, note, 2).as_deref(), Some("Tomatoes in March."));
    // locked, it opens nothing; the PRF output on its salt unlocks it again, and nothing else does
    lab.lock(device);
    assert!(!lab.opens(device, KeyScope::Vault(vault)));
    assert!(!lab.unlock(device), "the Lab holds no passkey to derive its keys from");
    assert!(!lab.unlock_with(device, *authenticator.prf(&device_salt(&[6; 32]))), "another salt's output");
    assert!(lab.unlock_with(device, *authenticator.prf(&device_salt(&[5; 32]))));
    assert_eq!(text(&lab, device, space, note, 2).as_deref(), Some("Tomatoes in March."), "it reads again");
}

#[test]
fn a_passkey_signs_only_in_its_ceremony_over_the_op() {
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
    // its own ceremony over the op's id does
    let draft = lab.draft(device, &[passkey], genesis).expect("a draft");
    let own = authenticator.ceremony(draft.challenge());
    let id = lab.complete(device, draft, &[(passkey, &own)]).expect("the passkey signed it");
    assert!(lab.signed_op(device, id).expect("kept").verify().is_ok());
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
    assert!(lab.passkey_hello(device, passkey, &EXPORTER, true).is_none(), "it says a hello in a ceremony alone");
    assert!(lab.relay_pass(device, passkey, NOW).is_none(), "and makes a pass in one");
    // the McEliece pair of the key sealed to the passkey, which it lent the device, is forgotten as the device locks
    let pair = authenticator.seal_secret().id();
    assert!(keys::pair_made(pair), "the device opened the vault key with it");
    lab.lock(device);
    assert!(!keys::pair_made(pair), "the process forgot the passkey's pair");
}

#[test]
fn a_browser_links_through_samuels_mac_in_ceremonies() {
    let mut w = world();
    let h = handbook(&mut w);
    let mut mac = w.lab.split(w.mac_s, &[], [1; 32]);
    let secret = w.lab.passkey_secret(w.passkey_s).expect("Samuel's software passkey");
    // the browser's authenticator holds Samuel's passkey, as his platform syncs it; the browser never saw it made
    let mut authenticator = Passkey::from_seed(*secret);
    let nonce = [5; 32];
    let unlock = authenticator.ceremony([1; 32]);
    let key = sign::DeviceKey::from_secret(*authenticator.prf(&device_salt(&nonce)));
    let sign::SignerKeys::Device { ed25519: endpoint, .. } = key.keys() else { unreachable!() };
    // its pass to the relay: a second ceremony, so the passkey's key is the one both assertions recover to
    let pass = authenticator.ceremony(pass_challenge(&endpoint, NOW));
    let p256 = passkey_key(&unlock.assertion, &pass.assertion).expect("one key recovers from both");
    assert_eq!(p256, authenticator.public());
    let mut browser = Lab::with_entropy([7; 32]);
    let passkey = browser.web_passkey("Samuel", p256, &unlock).expect("Samuel's passkey");
    assert_eq!(passkey, w.passkey_s);
    let device = browser.web_device(passkey, "Samuel's browser", nonce, *authenticator.prf(&device_salt(&nonce)));
    let pass = pass.pass(browser.keys_of(passkey).expect("its keys"), endpoint, NOW).expect("a pass");
    let pass = RelayPass::from_wire(&pass.to_wire()).expect("a pass");
    assert_eq!(pass.verify(&endpoint, NOW), Some(w.passkey_s), "the relay would let it in");
    // its hello on the connection to the Mac: a third ceremony, which the Mac checks before it hands its link card
    let keys = browser.keys_of(passkey).expect("its keys");
    let hello = authenticator.ceremony(hello_challenge(&EXPORTER, true, device));
    let hello = hello.hello(keys, &EXPORTER, true, device).expect("the passkey's hello");
    let hello = PasskeyHello::from_wire(&hello.to_wire()).expect("a hello");
    let proven = hello.verify(&EXPORTER, true, device).expect("the Mac checks it");
    browser.receive(device, mac.link_card(w.mac_s, proven), vec![]);
    // it joins Samuel's vault: the fourth ceremony signs the op that adds it, and the Mac takes it
    let (vault, added) = browser.joining(device, passkey).expect("Samuel's vault, by the card");
    assert_eq!((vault, added), (w.samuel, None));
    let add = Action::AddDevice { vault, device, seal_to: None };
    let id = ceremony(&mut browser, device, &[passkey, device], add, &mut authenticator);
    let join = Join::from_wire(&browser.joined(device, id).to_wire()).expect("a join");
    mac.accept_join(w.mac_s, device, join).expect("the Mac takes the join");
    assert_eq!(browser.joining(device, passkey), Ok((vault, Some(id))), "joined, it would send the same op again");
    for _ in 0..4 {
        ask((&mut mac, w.mac_s), (&mut browser, device));
        ask((&mut browser, device), (&mut mac, w.mac_s));
    }
    assert!(browser.opens(device, KeyScope::Space(h.space)), "the browser opens the Handbook's key");
    assert_eq!(text(&browser, device, h.space, h.welcome, 2).as_deref(), Some(WELCOME_TEXT), "and reads Welcome");
}
