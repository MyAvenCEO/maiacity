//! The server peer (P8b) in a folder of its own: it keeps its device and its vault across restarts, hands its contact
//! card to whoever asks, relays a space once a device grants it relay there, holding only ciphertext, and from then on
//! knows the devices of the vaults acting in that space, whom its relay lets in.

mod common;

use std::future::Future;
use std::time::{Duration, Instant};

use avendb::cast::*;
use avendb::id::{SignerId, SpaceId};
use avendb::keys::KeyScope;
use avendb::lab::Lab;
use avendb::policy::{Action, Role, Scope};
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

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_server_keeps_its_device_and_its_vault_across_restarts() {
    let dir = Folder::new("server");
    let server = server::open(dir.path(), Options::local()).await.expect("a new server");
    let (id, vault) = (server.id(), server::vault(&server).await.expect("its vault, founded at its first start"));
    let held = server.read(|lab, me| lab.size(me)).await;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(dir.path().join(server::SECRET)).expect("its secret").permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "its secret is readable by its owner alone");
    }
    server.shutdown().await.expect("it stops");
    drop(server);
    let again = server::open(dir.path(), Options::local()).await.expect("the server again");
    assert_eq!(again.id(), id, "the same device, from its secret");
    assert_eq!(server::vault(&again).await, Some(vault), "the same vault, from its store");
    assert_eq!(again.read(|lab, me| lab.size(me)).await, held, "and nothing founded anew");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_device_takes_the_servers_card_and_the_server_relays_its_space() {
    let dir = Folder::new("card");
    let admission = Admission::default();
    let opts = Options { admission: Some(admission.clone()), ..Options::local() };
    let server = server::open(dir.path(), opts).await.expect("a new server");
    let v = server::vault(&server).await.expect("its vault");
    let mut w = world();
    let (coop, _, _) = handbook_spaces(&mut w);
    let (mac_s, passkey_s, stranger_d) = (w.mac_s, w.passkey_s, w.stranger);
    let (bob_mac, carol_mac) = (endpoint(&w, w.mac_b), endpoint(&w, w.mac_c));
    let mac = node(&mut w, mac_s, &[passkey_s], 1).await;
    let stranger = node(&mut w, stranger_d, &[], 5).await;
    for n in [&mac, &stranger] {
        n.know(server.addr());
    }
    stranger.know(mac.addr());
    assert!(stranger.contact(mac.id()).await.is_err(), "a person's device hands out no card");
    assert!(mac.contact(server.id()).await.expect("the server hands out its card") > 0, "Samuel's Mac takes it");
    assert!(!admission.admits(&mac.id()), "the server knows no device of Samuel's yet");
    // the coop founds the Garden on Samuel's Mac, gives the new server relay on it, and Samuel writes Welcome there
    let garden = move |lab: &mut Lab, me| {
        let garden = SpaceId::from(lab.submit(me, &[me], Action::FoundSpace { actor: coop, nonce: 11 })?);
        lab.submit(me, &[me], grant(Scope::Space(garden), Role::Relay, vault(v), coop, None))?;
        let welcome = lab.create(me, coop, garden, document("Welcome", WELCOME_TEXT, me))?;
        Ok::<_, avendb::policy::Refusal>((garden, welcome))
    };
    let (garden, welcome) = mac.act(garden).await.expect("the Garden, relayed by the new server, and Welcome");
    let holds = || server.read(move |lab, me| lab.fetched(me, garden, welcome) > 0);
    until("the new server holds Welcome's edits, never asked to sync", holds).await;
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
    assert!(!admission.admits(&carol_mac) && !admission.admits(&stranger.id()), "not Carol's Mac, nor a stranger");
}
