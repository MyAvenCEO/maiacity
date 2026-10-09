//! The server peer (P8b) in a folder of its own: it keeps its device across restarts, belongs to no vault until the
//! first human vault to claim it makes it a device of avenCEO (P8f), and keeps that too; it hands avenCEO's card to
//! whoever asks, relays a space once a device grants avenCEO relay there, holding only ciphertext, and from then on
//! knows the devices of the vaults acting in that space, whom its relay lets in.

mod common;

use std::future::Future;
use std::time::{Duration, Instant};

use avendb::cast::*;
use avendb::id::{SignerId, SpaceId, VaultId};
use avendb::keys::KeyScope;
use avendb::lab::Lab;
use avendb::policy::{Action, Kind, Principal, Role, Scope};
use avendb_net::{Admission, Node, Options, server};
use common::Folder;
use iroh::{EndpointId, SecretKey};

/// A node for device `d`, split off `w`'s Lab with the keys of `with`, its randomness drawn from `seed`.
async fn node(w: &mut World, d: SignerId, with: &[SignerId], seed: u8) -> Node {
    Node::spawn(w.lab.split(d, with, [seed; 32]), d, Options::local()).await.expect("a node")
}

/// The endpoint of device `d` of `w`'s Lab.
fn endpoint(w: &World, d: SignerId) -> EndpointId {
    SecretKey::from_bytes(&w.lab.endpoint_secret(d).expect("a device's key")).public()
}

/// Waits until `check` holds, 30 seconds at most.
async fn until<F: Future<Output = bool>>(what: &str, mut check: impl FnMut() -> F) {
    let end = Instant::now() + Duration::from_secs(30);
    while !check().await {
        assert!(Instant::now() < end, "{what}, within 30 s");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// A server's options: its relay's admission.
fn admitting(admission: &Admission) -> Options {
    Options { admission: Some(admission.clone()), ..Options::local() }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_first_human_vault_to_claim_the_server_owns_it_once_and_for_good() {
    let dir = Folder::new("claim");
    let admission = Admission::default();
    let server = server::open(dir.path(), admitting(&admission)).await.expect("a new server");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(dir.path().join(server::SECRET)).expect("its secret").permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "its secret is readable by its owner alone");
    }
    assert_eq!(server::vault(&server).await, None, "a new server belongs to no vault");
    let anyone = Lab::new().passkey("anyone");
    assert!(admission.honours(&anyone), "until it is claimed, its relay lets in a pass of any passkey");
    let mut w = world();
    let (mac_b, passkey_b, mac_s, passkey_s, bob) = (w.mac_b, w.passkey_b, w.mac_s, w.passkey_s, w.bob);
    let stranger_d = w.stranger;
    let bobs = node(&mut w, mac_b, &[passkey_b], 2).await;
    let samuels = node(&mut w, mac_s, &[passkey_s], 1).await;
    let stranger = node(&mut w, stranger_d, &[], 5).await;
    let offer = server.offer();
    // a device of no vault claims nothing, and a person's own device takes no claim
    assert!(stranger.claim(&offer, passkey_b).await.is_err(), "a device of no vault");
    assert!(bobs.claim(&samuels.offer(), passkey_b).await.is_err(), "Samuel's Mac");
    assert_eq!(server::vault(&server).await, None, "and the server is still nobody's");
    // Bob's vault claims it first: the server is a device of a new avenCEO, which Bob's vault owns
    let avenceo = bobs.claim(&offer, passkey_b).await.expect("Bob's vault claims the server");
    assert_eq!(server::vault(&server).await, Some(avenceo), "the server is avenCEO's device");
    let shape = move |lab: &Lab, me| {
        lab.state(me).vault(avenceo).map(|v| (v.kind, v.owners.clone(), v.root, v.devices.clone()))
    };
    let owned = Some((Kind::Aven, vec![Principal::Vault(bob)], None, vec![server.device()]));
    assert_eq!(server.read(shape).await, owned, "owned by Bob's vault, the server its one device");
    assert_eq!(bobs.read(shape).await, owned, "on Bob's Mac too");
    let opens = move |lab: &Lab, me| lab.opens(me, KeyScope::Vault(avenceo));
    until("the server opens avenCEO's key, boxed for it by Bob's Mac", || server.read(opens)).await;
    assert!(!server.read(move |lab, me| lab.opens(me, KeyScope::Vault(bob))).await, "and not Bob's vault's key");
    assert!(!admission.honours(&anyone), "once claimed, its relay honours only the passes of people it knows");
    assert!(admission.honours(&passkey_b) && admission.admits(&bobs.id()), "Bob's among them");
    // nobody claims it again
    assert!(samuels.claim(&offer, passkey_s).await.is_err(), "Samuel's vault comes second");
    // Bob tries again, as if the answer had been lost: the server is avenCEO's device already
    assert_eq!(bobs.claim(&offer, passkey_b).await.expect("the same claim"), avenceo);
    let held = server.read(|lab, me| lab.size(me)).await;
    for n in [bobs, samuels, stranger] {
        n.shutdown().await.expect("the node shuts down");
    }
    server.shutdown().await.expect("it stops");
    let id = server.id();
    drop(server);
    let again = server::open(dir.path(), admitting(&admission)).await.expect("the server again");
    assert_eq!(again.id(), id, "the same device, from its secret");
    assert_eq!(server::vault(&again).await, Some(avenceo), "still avenCEO's, from its store");
    assert_eq!(again.read(|lab, me| lab.size(me)).await, held, "and nothing claimed anew");
    assert!(!admission.honours(&anyone), "and its relay stays closed to strangers");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_device_takes_the_servers_card_and_the_server_relays_its_space() {
    let dir = Folder::new("card");
    let admission = Admission::default();
    let server = server::open(dir.path(), admitting(&admission)).await.expect("a new server");
    let mut w = world();
    let (coop, _, _) = handbook_spaces(&mut w);
    let (mac_s, passkey_s, mac_d, passkey_d, stranger_d) = (w.mac_s, w.passkey_s, w.mac_d, w.passkey_d, w.stranger);
    let (bob_mac, carol_mac) = (endpoint(&w, w.mac_b), endpoint(&w, w.mac_c));
    let daves = node(&mut w, mac_d, &[passkey_d], 4).await;
    let mac = node(&mut w, mac_s, &[passkey_s], 1).await;
    let stranger = node(&mut w, stranger_d, &[], 5).await;
    for n in [&mac, &stranger] {
        n.know(server.addr());
    }
    stranger.know(mac.addr());
    // Dave's vault claims the server, which then knows Dave's devices and no one else
    let v: VaultId = daves.claim(&server.offer(), passkey_d).await.expect("Dave's vault claims it");
    assert!(stranger.contact(mac.id()).await.is_err(), "a person's device hands out no card");
    assert!(mac.contact(server.id()).await.expect("the server hands out its card") > 0, "Samuel's Mac takes it");
    let server_d = server.device();
    assert_eq!(mac.read(move |lab, me| lab.aven_of(me, server_d)).await, Some(v), "it names avenCEO");
    assert!(!admission.admits(&mac.id()), "the server knows no device of Samuel's yet");
    // the coop founds the Garden on Samuel's Mac, gives avenCEO relay on it, and Samuel writes Welcome there
    let garden = move |lab: &mut Lab, me| {
        let garden = lab.submit(me, &[me], Action::FoundSpace { actor: coop, nonce: 11, via: vec![] })?;
        let garden = SpaceId::from(garden);
        lab.submit(me, &[me], grant(Scope::Space(garden), Role::Relay, vault(v), coop, None))?;
        let welcome = lab.create(me, coop, garden, document("Welcome", WELCOME_TEXT, me))?;
        Ok::<_, avendb::policy::Refusal>((garden, welcome))
    };
    let (garden, welcome) = mac.act(garden).await.expect("the Garden, relayed by avenCEO, and Welcome");
    let holds = || server.read(move |lab, me| lab.fetched(me, garden, welcome) > 0);
    until("the server holds Welcome's edits, never asked to sync", holds).await;
    let opens = move |lab: &Lab, me| {
        lab.opens(me, KeyScope::Entry(garden, welcome)) || lab.opens(me, KeyScope::Space(garden))
    };
    assert!(!server.read(opens).await, "and opens neither Welcome's key nor the Garden's");
    let store = server.read(|lab, me| lab.store(me)).await;
    assert!(!contains(&store, WELCOME_TEXT), "Welcome's text appears nowhere in its store");
    let on_disk: Vec<u8> = std::fs::read(dir.path().join("ops")).expect("its store on disk");
    assert!(!contains(&on_disk, WELCOME_TEXT), "nor on its disk");
    // from the Garden's logs it knows the coop's owners' devices: its relay lets them in, and no one else
    until("the server knows Samuel's Mac", || async { admission.admits(&mac.id()) }).await;
    assert!(admission.admits(&bob_mac) && admission.admits(&server.id()), "and Bob's Mac, and itself");
    assert!(admission.admits(&daves.id()), "and Dave's Mac, of avenCEO's owner");
    assert!(!admission.admits(&carol_mac) && !admission.admits(&stranger.id()), "not Carol's Mac, nor a stranger");
}
