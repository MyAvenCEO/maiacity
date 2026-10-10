//! Linking a device by its passkey (P8c), as a device's QR code or the server's offer starts it. A new device of
//! Alice's shows her passkey's pass for it on a connection to a device that holds her vault's log, her Mac or the
//! server, where its hello proved it; that device hands it the logs of the vaults the passkey owns (the link card),
//! vault logs alone and nothing of any cap, cell or entry (T20); the new device adds itself to the vault its passkey
//! is the root of, signed by the passkey and by itself, and the peer accepts that one edit; then the two sync by caps
//! and cells, and the new device reads every entry of its vault and of the vaults it acts for. Each device runs split off, as on a machine of its own, and they
//! speak by the bytes they would send each other: `avendb-net` carries the same bytes over iroh.

mod common;

use avendb::id::{CellId, EditId, SignerId};
use avendb::keys::{KeyFam, KeyName, Recipient};
use avendb::lab::Lab;
use avendb::policy::{Action, Edit, Refusal};
use avendb::sign::{RelayPass, Signed};
use avendb::sync::{log_of, LogId};
use avendb::wire::{Join, Reply, Request, Wire};
use common::*;

/// When a new device's pass is made, and checked: seconds since 1970.
const NOW: u64 = 1_791_500_000;

const DIARY_TEXT: &str = "Dear diary: the seedlings are up.";

/// The new device `new` links through `peer` by the bytes alone: the passkey's pass for it, which the peer checks for
/// the device whose hello proved it on their connection, the link card the peer hands back for each passkey the pass
/// may be from, and the join the new device then sends, which the peer accepts or refuses.
fn link(new: (&mut Lab, SignerId), passkey: SignerId, peer: (&mut Lab, SignerId)) -> Result<(), Refusal> {
    let ((new, n), (peer, p)) = (new, peer);
    let pass = new.relay_pass(n, passkey, NOW).expect("the passkey is at hand");
    let pass = RelayPass::from_wire(&pass.to_wire()).expect("a passkey's pass");
    assert_eq!(pass.device.id(), n, "for the device on the connection");
    let passkeys = pass.passkeys(NOW);
    assert!(passkeys.contains(&passkey), "the pass may be the passkey's");
    let card = Reply { edits: passkeys.into_iter().flat_map(|q| peer.link_card(p, q)).collect(), ..Reply::default() };
    let card = Reply::from_wire(&card.to_wire()).expect("a card");
    new.receive(n, card.edits, vec![]);
    let join = Join::from_wire(&new.join(n, passkey)?.to_wire()).expect("a join");
    peer.accept_join(p, n, join).map(|_| ())
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

/// `a` and `b` ask each other until neither has anything new for the other.
fn settle(a: (&mut Lab, SignerId), b: (&mut Lab, SignerId)) {
    let ((a, x), (b, y)) = (a, b);
    for _ in 0..8 {
        if ask((a, x), (b, y)) + ask((b, y), (a, x)) == 0 {
            return;
        }
    }
    panic!("they keep sending each other edits");
}

/// The log a signed edit belongs to.
fn log(s: &Signed) -> Option<LogId> {
    log_of(&s.edit, s.edit.id())
}

#[test]
fn a_new_iphone_links_through_alices_mac_by_the_passkey_alone() {
    let mut w = world();
    let h = handbook(&mut w);
    let alice = w.alice;
    let diary = document("Diary", DIARY_TEXT, w.mac_a);
    let diary = w.lab.create(w.mac_a, alice, alice, "note", &[], diary).expect("Alice writes her diary on her Mac");
    let new = w.lab.device_of(w.passkey_a, "Alice's new iPhone");
    let mut mac = w.lab.split(w.mac_a, &[], [1; 32]);
    let mut phone = w.lab.split(new, &[w.passkey_a], [2; 32]);
    // before it links, the Mac sends it nothing: it belongs to no vault the Mac knows
    assert_eq!(ask((&mut phone, new), (&mut mac, w.mac_a)), 0);
    link((&mut phone, new), w.passkey_a, (&mut mac, w.mac_a)).expect("the new iPhone links");
    assert_eq!(phone.vault_of(new), Some(alice), "it added itself to Alice's vault");
    let devices = &mac.state(w.mac_a).vault(alice).expect("Alice's vault").devices;
    assert!(devices.contains(&new), "and the Mac counts it among Alice's devices");
    settle((&mut phone, new), (&mut mac, w.mac_a));
    // the seeds of Alice's vault and of the coop, and the keys of the cells Welcome and her diary are in
    let none = |v| KeyFam::Cell(v, CellId::of(v, &[]));
    let keys = [KeyFam::Seed(alice), KeyFam::Seed(h.coop), none(h.coop), none(alice)];
    for k in keys {
        assert!(phone.opens(new, k), "the new iPhone opens {k:?}");
    }
    assert_eq!(text(&phone, new, h.welcome, 2).as_deref(), Some(WELCOME_TEXT), "and reads Welcome");
    assert_eq!(text(&phone, new, diary, 2).as_deref(), Some(DIARY_TEXT), "and her diary");
    // locked and unlocked again, it opens them by its own key: it boxed Alice's vault key for itself as it joined
    phone.lock(new);
    assert!(keys.iter().all(|&k| !phone.opens(new, k)), "locked, it opens none of them");
    assert!(phone.unlock(new));
    assert!(keys.iter().all(|&k| phone.opens(new, k)), "unlocked, it opens them again");
    // and it writes, which the Mac reads
    phone.edit(new, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).expect("the new iPhone edits Welcome");
    settle((&mut phone, new), (&mut mac, w.mac_a));
    assert_eq!(text(&mac, w.mac_a, h.welcome, 2).as_deref(), Some(AFTER_TEXT), "the Mac reads its edit");
}

#[test]
fn alice_gets_her_vault_back_through_the_server_with_her_passkey_alone() {
    let mut w = world();
    let h = handbook(&mut w);
    // Alice's own vault gives the server relay too, and holds her diary
    let alice = w.alice;
    relay_on(&mut w, alice);
    let diary = document("Diary", DIARY_TEXT, w.mac_a);
    let diary = w.lab.create(w.mac_a, alice, alice, "note", &[], diary).expect("Alice writes her diary");
    w.lab.sync_all(1);
    // Alice loses her Mac and her iPhone; her passkey, synced by her platform, is on her new Mac
    w.lab.lose(w.mac_a);
    w.lab.lose(w.phone_a);
    let new = w.lab.device_of(w.passkey_a, "Alice's new Mac");
    let mut server = w.lab.split(w.server, &[], [1; 32]);
    let mut mac = w.lab.split(new, &[w.passkey_a], [2; 32]);
    link((&mut mac, new), w.passkey_a, (&mut server, w.server)).expect("the new Mac links through the server");
    settle((&mut mac, new), (&mut server, w.server));
    assert_eq!(text(&mac, new, h.welcome, 2).as_deref(), Some(WELCOME_TEXT), "the new Mac reads Welcome");
    assert_eq!(text(&mac, new, h.onboarding, 2).as_deref(), Some(ONBOARDING_TEXT), "and Onboarding");
    assert_eq!(text(&mac, new, diary, 2).as_deref(), Some(DIARY_TEXT), "and her diary, which the server relays");
    // the server, which handed over the vault's log, opens none of its keys and holds no text
    let none = |v| KeyFam::Cell(v, CellId::of(v, &[]));
    let keys = [KeyFam::Seed(alice), KeyFam::Seed(h.coop), none(h.coop), none(alice)];
    for k in keys {
        assert!(mac.opens(new, k), "the new Mac opens {k:?}");
        assert!(!server.opens(w.server, k), "the server opens no key: {k:?}");
    }
    let store = server.store(w.server);
    assert!(!contains(&store, WELCOME_TEXT) && !contains(&store, DIARY_TEXT), "and no text appears in its store");
}

#[test]
fn a_link_card_holds_the_logs_of_the_passkeys_vaults_and_nothing_else() {
    let mut w = world();
    handbook(&mut w);
    let eve = w.lab.passkey("Eve");
    let card = w.lab.link_card(w.mac_a, w.passkey_a);
    assert!(!card.is_empty());
    let alices = card.iter().all(|s| log(s) == Some(LogId::Vault(w.alice)));
    assert!(alices, "Alice's vault's log alone: nothing of the coop, nor of any cap, cell or entry");
    let theirs = w.lab.link_card(w.server, w.passkey_a);
    assert_eq!(card, theirs, "the server, relaying the coop's entries, holds the same and hands the same");
    let bob = w.lab.link_card(w.mac_a, w.passkey_b);
    let bobs = bob.iter().all(|s| log(s) == Some(LogId::Vault(w.bob)));
    assert!(!bob.is_empty() && bobs, "Bob's passkey gets Bob's");
    assert!(w.lab.link_card(w.mac_a, eve).is_empty(), "a passkey that owns nothing gets nothing");
    assert!(w.lab.link_card(w.mac_a, w.mac_b).is_empty(), "nor does a device");
    assert!(card.iter().all(|s| s.edit.entry().is_none()), "no write, no move, no checkpoint");
}

#[test]
fn a_device_joins_only_the_vault_its_passkey_is_the_root_of() {
    let mut w = world();
    let new = w.lab.device_of(w.passkey_a, "Alice's new iPhone");
    assert_eq!(w.lab.join(new, w.passkey_a).err(), Some(Refusal::UnknownVault), "it knows no vault yet");
    let bobs = w.lab.link_card(w.mac_a, w.passkey_b);
    w.lab.receive(new, bobs, vec![]);
    assert_eq!(w.lab.join(new, w.passkey_a).err(), Some(Refusal::UnknownVault), "Bob's vault isn't rooted by it");
    let card = w.lab.link_card(w.mac_a, w.passkey_a);
    w.lab.receive(new, card, vec![]);
    let join = w.lab.join(new, w.passkey_a).expect("it joins Alice's vault");
    assert!(
        matches!(join.edit.edit.action, Action::AddDevice { vault, device, .. } if vault == w.alice && device == new)
    );
    assert_eq!(
        join.edit.edit.sigs().collect::<Vec<_>>(),
        vec![w.passkey_a, new],
        "signed by the passkey, then by itself"
    );
    assert_eq!(join.blobs.len(), 1, "with its McEliece key, which the edit names");
    assert_eq!(w.lab.join(new, w.passkey_a), Ok(join), "asked again, the same join, as a link tried again sends");
    // a device whose person's passkey isn't at hand signs nothing
    let other = w.lab.device_of(w.passkey_a, "Alice's iPad");
    let card = w.lab.link_card(w.mac_a, w.passkey_a);
    w.lab.receive(other, card, vec![]);
    let mut ipad = w.lab.split(other, &[], [3; 32]);
    assert_eq!(ipad.join(other, w.passkey_a).err(), Some(Refusal::Locked));
    assert!(ipad.relay_pass(other, w.passkey_a, NOW).is_none(), "nor makes the passkey's pass");
}

#[test]
fn a_peer_accepts_only_a_device_adding_itself_with_its_vaults_approval() {
    let mut w = world();
    let eve = w.lab.passkey("Eve");
    let eves = w.lab.device_of(eve, "Eve's phone");
    let eves_vault = human_on(&mut w.lab, eve, &[eves]);
    let new = w.lab.device_of(w.passkey_a, "Alice's new iPhone");
    let card = w.lab.link_card(w.mac_a, w.passkey_a);
    w.lab.receive(new, card.clone(), vec![]);
    w.lab.receive(eves, card, vec![]);
    let join = w.lab.join(new, w.passkey_a).expect("a join");
    let add = |vault, device| Action::AddDevice { vault, device, seal_to: None };
    let unchecked = |lab: &mut Lab, on, signers: &[SignerId], action| {
        Join { edit: lab.sign_unchecked(on, signers, action).expect("signed"), blobs: vec![] }
    };
    let no_consent = unchecked(&mut w.lab, new, &[w.passkey_a], add(w.alice, new));
    let eve_adds = unchecked(&mut w.lab, eves, &[eve, eves], add(w.alice, eves));
    let eve_joins = unchecked(&mut w.lab, eves, &[eve, eves], add(eves_vault, eves));
    let no_device = unchecked(&mut w.lab, new, &[new], Action::SetThreshold { vault: w.alice, threshold: 1 });
    let mut mac = w.lab.split(w.mac_a, &[], [1; 32]);
    let accept = |mac: &mut Lab, from, join: &Join| mac.accept_join(w.mac_a, from, join.clone()).map(|_| ());
    assert_eq!(accept(&mut mac, eves, &join), Err(Refusal::NotJoining), "sent by another device than it adds");
    assert_eq!(accept(&mut mac, new, &no_device), Err(Refusal::NotJoining), "an edit adding no device");
    let mut forged = join.clone();
    forged.edit.sigs[0].pq.as_mut().expect("both halves")[0] ^= 1;
    assert_eq!(accept(&mut mac, new, &forged), Err(Refusal::BadSignature), "a changed signature");
    assert_eq!(accept(&mut mac, eves, &eve_adds), Err(Refusal::BelowThreshold), "Eve's passkey can't add to Alice's");
    assert_eq!(accept(&mut mac, new, &no_consent), Err(Refusal::NoConsent), "a device that didn't sign");
    assert_eq!(accept(&mut mac, eves, &eve_joins), Err(Refusal::UnknownVault), "a vault the Mac doesn't know");
    let before: Vec<EditId> = mac.log(w.mac_a).ids().to_vec();
    assert!(!mac.state(w.mac_a).vault(w.alice).expect("Alice's").devices.contains(&new));
    let id = mac.accept_join(w.mac_a, new, join.clone()).expect("the join itself is accepted");
    // besides the join it keeps only its own boxes of Alice's vault key for the new iPhone, sealed to its key
    let edits = mac.log(w.mac_a).edits().iter().zip(mac.log(w.mac_a).ids());
    let added: Vec<(&Edit, &EditId)> = edits.filter(|(_, x)| !before.contains(x)).collect();
    assert!(added.iter().any(|(_, x)| **x == id));
    let boxes_for_it = |edit: &Edit| match &edit.action {
        Action::Keys { name: KeyName::Scoped(KeyFam::Seed(v), _), boxes, .. } => {
            *v == w.alice && boxes.iter().all(|b| b.to == Recipient::Signer(new))
        }
        _ => false,
    };
    assert!(added.iter().all(|(edit, x)| **x == id || (edit.author == w.mac_a && boxes_for_it(edit))), "{added:?}");
    assert!(mac.signed_edit(w.mac_a, id).is_some());
    assert!(mac.blob(w.mac_a, join.edit.edit.blobs()[0]).is_some(), "with the McEliece key it names");
    assert_eq!(mac.accept_join(w.mac_a, new, join), Ok(id), "sent again, the same");
}

#[test]
fn a_browser_takes_alices_passkey_in_and_links_by_a_pass_to_the_relay() {
    // P8d: a page holds Alice's passkey as a software passkey, brought in by its secret as her platform syncs it
    let mut w = world();
    let h = handbook(&mut w);
    let secret = w.lab.passkey_secret(w.passkey_a).expect("a software passkey's secret");
    assert!(w.lab.passkey_secret(w.mac_a).is_none(), "a device holds no passkey's secret");
    let mut page = Lab::with_entropy([5; 32]);
    let passkey = page.passkey_from("Alice", *secret);
    assert_eq!(passkey, w.passkey_a, "the same passkey");
    let browser = page.device_of(passkey, "Alice's browser");
    // its pass to the server's relay: for its own endpoint, by the passkey that roots a vault the server knows
    let made = NOW;
    let pass = page.relay_pass(browser, passkey, made).expect("a pass");
    let endpoint = page.endpoint_secret(browser).expect("unlocked");
    let endpoint = ed25519_dalek::SigningKey::from_bytes(&endpoint).verifying_key().to_bytes();
    assert_eq!(pass.endpoint(), Some(endpoint), "for the browser's endpoint");
    let pass = RelayPass::from_wire(&pass.to_wire()).expect("a pass, as the relay reads it");
    assert!(pass.passkeys(made + 60).contains(&passkey), "by Alice's passkey");
    let roots = w.lab.roots(w.server);
    for p in [w.passkey_a, w.passkey_b, w.passkey_c, w.passkey_d] {
        assert!(roots.contains(&p), "the server knows the people whose vaults it knows");
    }
    assert!(page.roots(browser).is_empty(), "the browser knows nobody before it links");
    assert!(page.relay_pass(passkey, passkey, made).is_none(), "a passkey is no device to make a pass for");
    assert!(page.relay_pass(browser, w.passkey_b, made).is_none(), "and Bob's passkey isn't at hand");
    // then it links through Alice's Mac as any new device does, and reads Welcome
    let mut mac = w.lab.split(w.mac_a, &[], [1; 32]);
    link((&mut page, browser), passkey, (&mut mac, w.mac_a)).expect("the browser links");
    settle((&mut page, browser), (&mut mac, w.mac_a));
    assert_eq!(text(&page, browser, h.welcome, 2).as_deref(), Some(WELCOME_TEXT), "and reads Welcome");
    assert!(page.roots(browser).contains(&passkey), "it knows Alice's vault now, and Bob's, a coop owner");
}
