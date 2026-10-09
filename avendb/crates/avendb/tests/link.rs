//! Linking a device by its passkey (P8c). A new device of Samuel's says his passkey's hello on a connection to a
//! device that holds his vault's log, his Mac or the server; that device hands it the logs of the vaults the passkey
//! owns (the link card) and nothing else; the new device adds itself to the vault its passkey is the root of, signed by
//! the passkey and by itself, and the peer accepts that one op; then the two sync by caps. Each device runs split off,
//! as on a machine of its own, and they speak by the bytes they would send each other: `avendb-net` carries the same
//! bytes over iroh.

mod common;

use common::*;
use avendb::id::{OpId, SignerId};
use avendb::keys::{KeyScope, Recipient};
use avendb::lab::Lab;
use avendb::policy::{Action, Op, Refusal};
use avendb::sign::{PasskeyHello, RelayPass};
use avendb::wire::{Join, Reply, Request, Wire};

/// The TLS exporter of the connection between the new device, which dials, and its peer.
const EXPORTER: [u8; 32] = [9; 32];

/// The new device `new` links through `peer` by the bytes alone: the passkey's hello, which the peer checks, the link
/// card the peer hands back, and the join the new device then sends, which the peer accepts or refuses.
fn link(new: (&mut Lab, SignerId), passkey: SignerId, peer: (&mut Lab, SignerId)) -> Result<(), Refusal> {
    let ((new, n), (peer, p)) = (new, peer);
    let hello = new.passkey_hello(n, passkey, &EXPORTER, true).expect("the passkey is at hand");
    let hello = PasskeyHello::from_wire(&hello.to_wire()).expect("a passkey's hello");
    let proven = hello.verify(&EXPORTER, true, n).expect("the hello proves the passkey");
    assert_eq!(proven, passkey);
    let card = Reply { ops: peer.link_card(p, proven), ..Reply::default() };
    let card = Reply::from_wire(&card.to_wire()).expect("a card");
    new.receive(n, card.ops, vec![]);
    let join = Join::from_wire(&new.join(n, passkey)?.to_wire()).expect("a join");
    peer.accept_join(p, n, join).map(|_| ())
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

/// `a` and `b` ask each other until neither has anything new for the other.
fn settle(a: (&mut Lab, SignerId), b: (&mut Lab, SignerId)) {
    let ((a, x), (b, y)) = (a, b);
    for _ in 0..8 {
        if ask((a, x), (b, y)) + ask((b, y), (a, x)) == 0 {
            return;
        }
    }
    panic!("they keep sending each other ops");
}

#[test]
fn a_new_iphone_links_through_samuels_mac_by_the_passkey_alone() {
    let mut w = world();
    let h = handbook(&mut w);
    let new = w.lab.device_of(w.passkey_s, "Samuel's new iPhone");
    let mut mac = w.lab.split(w.mac_s, &[], [1; 32]);
    let mut phone = w.lab.split(new, &[w.passkey_s], [2; 32]);
    // before it links, the Mac sends it nothing: it belongs to no vault the Mac knows
    assert_eq!(ask((&mut phone, new), (&mut mac, w.mac_s)), 0);
    link((&mut phone, new), w.passkey_s, (&mut mac, w.mac_s)).expect("the new iPhone links");
    assert_eq!(phone.vault_of(new), Some(w.samuel), "it added itself to Samuel's vault");
    let devices = &mac.state(w.mac_s).vault(w.samuel).expect("Samuel's vault").devices;
    assert!(devices.contains(&new), "and the Mac counts it among Samuel's devices");
    settle((&mut phone, new), (&mut mac, w.mac_s));
    let keys = [KeyScope::Vault(w.samuel), KeyScope::Vault(h.coop), KeyScope::Space(h.space), KeyScope::Space(h.notes)];
    for k in keys {
        assert!(phone.opens(new, k), "the new iPhone opens {k:?}");
    }
    assert_eq!(text(&phone, new, h.space, h.welcome, 2).as_deref(), Some(WELCOME_TEXT), "and reads Welcome");
    // locked and unlocked again, it opens them by its own key: it boxed Samuel's vault key for itself as it joined
    phone.lock(new);
    assert!(phone.unlock(new));
    assert!(keys.iter().all(|&k| phone.opens(new, k)), "unlocked, it opens them again");
    // and it writes, which the Mac reads
    phone.edit(new, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).expect("the new iPhone edits Welcome");
    settle((&mut phone, new), (&mut mac, w.mac_s));
    assert_eq!(text(&mac, w.mac_s, h.space, h.welcome, 2).as_deref(), Some(AFTER_TEXT), "the Mac reads its edit");
}

#[test]
fn samuel_gets_his_vault_back_through_the_server_with_his_passkey_alone() {
    let mut w = world();
    let h = handbook(&mut w);
    // Samuel loses his Mac and his iPhone; his passkey, synced by his platform, is on his new Mac
    w.lab.lose(w.mac_s);
    w.lab.lose(w.phone_s);
    let new = w.lab.device_of(w.passkey_s, "Samuel's new Mac");
    let mut server = w.lab.split(w.server, &[], [1; 32]);
    let mut mac = w.lab.split(new, &[w.passkey_s], [2; 32]);
    link((&mut mac, new), w.passkey_s, (&mut server, w.server)).expect("the new Mac links through the server");
    settle((&mut mac, new), (&mut server, w.server));
    assert_eq!(text(&mac, new, h.space, h.welcome, 2).as_deref(), Some(WELCOME_TEXT), "the new Mac reads Welcome");
    assert_eq!(text(&mac, new, h.space, h.onboarding, 2).as_deref(), Some(ONBOARDING_TEXT), "and Onboarding");
    assert!(mac.opens(new, KeyScope::Space(h.notes)), "and opens Samuel's Notes");
    // the server, which handed over the vault's log, opens none of its keys and holds no text
    let keys = [KeyScope::Vault(w.samuel), KeyScope::Vault(h.coop), KeyScope::Space(h.space), KeyScope::Space(h.notes)];
    for k in keys {
        assert!(!server.opens(w.server, k), "the server opens no key: {k:?}");
    }
    assert!(!contains(&server.store(w.server), WELCOME_TEXT), "Welcome's text appears nowhere in its store");
}

#[test]
fn a_link_card_holds_the_logs_of_the_passkeys_vaults_and_nothing_else() {
    let mut w = world();
    let h = handbook(&mut w);
    let eve = w.lab.passkey("Eve");
    let card = w.lab.link_card(w.mac_s, w.passkey_s);
    assert!(!card.is_empty());
    assert!(card.iter().all(|s| s.op.vault_of() == Some(w.samuel)), "Samuel's vault's log alone: no coop, no space");
    let theirs = w.lab.link_card(w.server, w.passkey_s);
    assert_eq!(card, theirs, "the server, relaying the Handbook and Notes, holds the same and hands the same");
    let bob = w.lab.link_card(w.mac_s, w.passkey_b);
    assert!(!bob.is_empty() && bob.iter().all(|s| s.op.vault_of() == Some(w.bob)), "Bob's passkey gets Bob's");
    assert!(w.lab.link_card(w.mac_s, eve).is_empty(), "a passkey that owns nothing gets nothing");
    assert!(w.lab.link_card(w.mac_s, w.mac_b).is_empty(), "nor does a device");
    assert!(card.iter().all(|s| s.op.item().is_none()), "no write, no checkpoint");
    let _ = h;
}

#[test]
fn a_device_joins_only_the_vault_its_passkey_is_the_root_of() {
    let mut w = world();
    let new = w.lab.device_of(w.passkey_s, "Samuel's new iPhone");
    assert_eq!(w.lab.join(new, w.passkey_s).err(), Some(Refusal::UnknownVault), "it knows no vault yet");
    let bobs = w.lab.link_card(w.mac_s, w.passkey_b);
    w.lab.receive(new, bobs, vec![]);
    assert_eq!(w.lab.join(new, w.passkey_s).err(), Some(Refusal::UnknownVault), "Bob's vault isn't rooted by it");
    let card = w.lab.link_card(w.mac_s, w.passkey_s);
    w.lab.receive(new, card, vec![]);
    let join = w.lab.join(new, w.passkey_s).expect("it joins Samuel's vault");
    assert!(matches!(join.op.op.action, Action::AddDevice { vault, device, .. } if vault == w.samuel && device == new));
    assert_eq!(join.op.op.sigs().collect::<Vec<_>>(), vec![w.passkey_s, new], "signed by the passkey, then by itself");
    assert_eq!(join.blobs.len(), 1, "with its McEliece key, which the op names");
    assert_eq!(w.lab.join(new, w.passkey_s), Ok(join), "asked again, the same join, as a link tried again sends");
    // a device whose person's passkey isn't at hand signs nothing
    let other = w.lab.device_of(w.passkey_s, "Samuel's iPad");
    let card = w.lab.link_card(w.mac_s, w.passkey_s);
    w.lab.receive(other, card, vec![]);
    let mut ipad = w.lab.split(other, &[], [3; 32]);
    assert_eq!(ipad.join(other, w.passkey_s).err(), Some(Refusal::Locked));
    assert!(ipad.passkey_hello(other, w.passkey_s, &EXPORTER, true).is_none(), "nor says the passkey's hello");
}

#[test]
fn a_peer_accepts_only_a_device_adding_itself_with_its_vaults_approval() {
    let mut w = world();
    let eve = w.lab.passkey("Eve");
    let eves = w.lab.device_of(eve, "Eve's phone");
    let eves_vault = human_on(&mut w.lab, eve, &[eves]);
    let new = w.lab.device_of(w.passkey_s, "Samuel's new iPhone");
    let card = w.lab.link_card(w.mac_s, w.passkey_s);
    w.lab.receive(new, card.clone(), vec![]);
    w.lab.receive(eves, card, vec![]);
    let join = w.lab.join(new, w.passkey_s).expect("a join");
    let add = |vault, device| Action::AddDevice { vault, device, seal_to: None };
    let unchecked = |lab: &mut Lab, on, signers: &[SignerId], action| {
        Join { op: lab.sign_unchecked(on, signers, action).expect("signed"), blobs: vec![] }
    };
    let no_consent = unchecked(&mut w.lab, new, &[w.passkey_s], add(w.samuel, new));
    let eve_adds = unchecked(&mut w.lab, eves, &[eve, eves], add(w.samuel, eves));
    let eve_joins = unchecked(&mut w.lab, eves, &[eve, eves], add(eves_vault, eves));
    let no_device = unchecked(&mut w.lab, new, &[new], Action::FoundSpace { actor: w.samuel, nonce: 9 });
    let mut mac = w.lab.split(w.mac_s, &[], [1; 32]);
    let accept = |mac: &mut Lab, from, join: &Join| mac.accept_join(w.mac_s, from, join.clone()).map(|_| ());
    assert_eq!(accept(&mut mac, eves, &join), Err(Refusal::NotJoining), "sent by another device than it adds");
    assert_eq!(accept(&mut mac, new, &no_device), Err(Refusal::NotJoining), "an op adding no device");
    let mut forged = join.clone();
    forged.op.sigs[0].pq.as_mut().expect("both halves")[0] ^= 1;
    assert_eq!(accept(&mut mac, new, &forged), Err(Refusal::BadSignature), "a changed signature");
    assert_eq!(accept(&mut mac, eves, &eve_adds), Err(Refusal::BelowThreshold), "Eve's passkey can't add to Samuel's");
    assert_eq!(accept(&mut mac, new, &no_consent), Err(Refusal::NoConsent), "a device that didn't sign");
    assert_eq!(accept(&mut mac, eves, &eve_joins), Err(Refusal::UnknownVault), "a vault the Mac doesn't know");
    let before: Vec<OpId> = mac.log(w.mac_s).ids().to_vec();
    assert!(!mac.state(w.mac_s).vault(w.samuel).expect("Samuel's").devices.contains(&new));
    let id = mac.accept_join(w.mac_s, new, join.clone()).expect("the join itself is accepted");
    // besides the join it keeps only its own boxes of Samuel's vault key for the new iPhone, sealed to its key
    let ops = mac.log(w.mac_s).ops().iter().zip(mac.log(w.mac_s).ids());
    let added: Vec<(&Op, &OpId)> = ops.filter(|(_, x)| !before.contains(x)).collect();
    assert!(added.iter().any(|(_, x)| **x == id));
    let boxes_for_it = |op: &Op| match &op.action {
        Action::Keys { key, boxes, .. } => {
            *key == KeyScope::Vault(w.samuel) && boxes.iter().all(|b| b.to == Recipient::Signer(new))
        }
        _ => false,
    };
    assert!(added.iter().all(|(op, x)| **x == id || (op.author == w.mac_s && boxes_for_it(op))), "{added:?}");
    assert!(mac.signed_op(w.mac_s, id).is_some());
    assert!(mac.blob(w.mac_s, join.op.op.blobs()[0]).is_some(), "with the McEliece key it names");
    assert_eq!(mac.accept_join(w.mac_s, new, join), Ok(id), "sent again, the same");
}

#[test]
fn a_browser_takes_samuels_passkey_in_and_links_by_a_pass_to_the_relay() {
    // P8d: a page holds Samuel's passkey as a software passkey, brought in by its secret as his platform syncs it
    let mut w = world();
    let h = handbook(&mut w);
    let secret = w.lab.passkey_secret(w.passkey_s).expect("a software passkey's secret");
    assert!(w.lab.passkey_secret(w.mac_s).is_none(), "a device holds no passkey's secret");
    let mut page = Lab::with_entropy([5; 32]);
    let passkey = page.passkey_from("Samuel", *secret);
    assert_eq!(passkey, w.passkey_s, "the same passkey");
    let browser = page.device_of(passkey, "Samuel's browser");
    // its pass to the server's relay: for its own endpoint, by the passkey that roots a vault the server knows
    let made = 1_791_500_000;
    let pass = page.relay_pass(browser, passkey, made).expect("a pass");
    let endpoint = page.endpoint_secret(browser).expect("unlocked");
    let endpoint = ed25519_dalek::SigningKey::from_bytes(&endpoint).verifying_key().to_bytes();
    assert_eq!(pass.endpoint, endpoint, "for the browser's endpoint");
    let pass = RelayPass::from_wire(&pass.to_wire()).expect("a pass, as the relay reads it");
    assert_eq!(pass.verify(&endpoint, made + 60), Some(passkey), "by Samuel's passkey");
    let roots = w.lab.roots(w.server);
    for p in [w.passkey_s, w.passkey_b, w.passkey_c, w.passkey_d] {
        assert!(roots.contains(&p), "the server knows the people whose vaults it knows");
    }
    assert!(page.roots(browser).is_empty(), "the browser knows nobody before it links");
    assert!(page.relay_pass(passkey, passkey, made).is_none(), "a passkey is no device to make a pass for");
    assert!(page.relay_pass(browser, w.passkey_b, made).is_none(), "and Bob's passkey isn't at hand");
    // then it links through Samuel's Mac as any new device does, and reads Welcome
    let mut mac = w.lab.split(w.mac_s, &[], [1; 32]);
    link((&mut page, browser), passkey, (&mut mac, w.mac_s)).expect("the browser links");
    settle((&mut page, browser), (&mut mac, w.mac_s));
    assert_eq!(text(&page, browser, h.space, h.welcome, 2).as_deref(), Some(WELCOME_TEXT), "and reads Welcome");
    assert!(page.roots(browser).contains(&passkey), "it knows Samuel's vault now, and Bob's, a coop owner");
}
