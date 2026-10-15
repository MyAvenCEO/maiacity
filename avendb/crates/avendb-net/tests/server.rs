//! The server peer (P8b) in a folder of its own: it keeps its device across restarts, belongs to no vault until the
//! first human vault to claim it makes it a device of avenCEO (P8f), and keeps that too; it hands avenCEO's card to
//! whoever asks, relays a vault once the vault gives avenCEO relay on it, holding only ciphertext, and from then on
//! knows the devices of the vaults acting for it, whom its relay lets in.

mod common;

use std::future::Future;
use std::time::{Duration, Instant};

use avendb::cast::*;
use avendb::id::{SignerId, VaultId};
use avendb::keys::KeyFam;
use avendb::lab::Lab;
use avendb::world;
use avendb::policy::{Kind, Level};
use avendb::slice::Selector;
use avendb_net::{Admission, Node, Options, disk, server, shelf};
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

/// The server on the shelf in folder `dir`.
async fn open(dir: &Folder, admission: &Admission) -> anyhow::Result<Node> {
    server::open(disk::open(dir.path())?, admitting(admission)).await
}

/// Every file under `dir`, with its bytes.
fn files(dir: &std::path::Path) -> Vec<(std::path::PathBuf, Vec<u8>)> {
    let entries = std::fs::read_dir(dir).expect("a folder").map(|e| e.expect("an entry").path());
    let read = |path: std::path::PathBuf| match path.is_dir() {
        true => files(&path),
        false => vec![(path.clone(), std::fs::read(&path).expect("a file"))],
    };
    entries.flat_map(read).collect()
}

/// A server's options: its relay's admission.
fn admitting(admission: &Admission) -> Options {
    Options { admission: Some(admission.clone()), ..Options::local() }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_first_human_vault_to_claim_the_server_owns_it_once_and_for_good() {
    let dir = Folder::new("claim");
    let admission = Admission::default();
    let server = open(&dir, &admission).await.expect("a new server");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let secret = dir.path().join(format!("g{}", shelf::FLOOR)).join(server::SECRET);
        let mode = std::fs::metadata(secret).expect("its secret").permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "its secret is readable by its owner alone");
    }
    assert_eq!(server::vault(&server).await, None, "a new server belongs to no vault");
    let anyone = Lab::new().passkey("anyone");
    assert!(admission.honours(&anyone), "until it is claimed, its relay lets in a pass of any passkey");
    let mut w = world();
    let (mac_b, passkey_b, mac_a, passkey_a, bob) = (w.mac_b, w.passkey_b, w.mac_a, w.passkey_a, w.bob);
    let stranger_d = w.stranger;
    let bobs = node(&mut w, mac_b, &[passkey_b], 2).await;
    let alices = node(&mut w, mac_a, &[passkey_a], 1).await;
    let stranger = node(&mut w, stranger_d, &[], 5).await;
    let offer = server.offer();
    // a device of no vault claims nothing, and a person's own device takes no claim
    assert!(stranger.claim(&offer, passkey_b).await.is_err(), "a device of no vault");
    assert!(bobs.claim(&alices.offer(), passkey_b).await.is_err(), "Alice's Mac");
    assert_eq!(server::vault(&server).await, None, "and the server is still nobody's");
    // Bob's vault claims it first: the server is a device of the CEO Aven of the seed Bob's vault founds, owned by
    // avenCEO GmbH, which Maia Holding GmbH owns, which Bob's vault owns
    let avenceo = bobs.claim(&offer, passkey_b).await.expect("Bob's vault claims the server");
    assert_eq!(server::vault(&server).await, Some(avenceo), "the server is the CEO Aven's device");
    let shape = move |lab: &Lab, me| {
        let st = lab.state(me);
        st.vault(avenceo).map(|v| (v.kind, v.root, v.devices.clone(), world::seeded(st, bob, avenceo)))
    };
    let owned = Some((Kind::Aven, None, vec![server.device()], true));
    assert_eq!(server.read(shape).await, owned, "the end of Bob's seed, the server its one device");
    assert_eq!(bobs.read(shape).await, owned, "on Bob's Mac too");
    let opens = move |lab: &Lab, me| lab.opens(me, KeyFam::Seed(avenceo));
    until("the server opens avenCEO's seed, boxed for it by Bob's Mac", || server.read(opens)).await;
    assert!(!server.read(move |lab, me| lab.opens(me, KeyFam::Seed(bob))).await, "and not Bob's vault's seed");
    assert!(!admission.honours(&anyone), "once claimed, its relay honours only the passes of people it knows");
    assert!(admission.honours(&passkey_b) && admission.admits(&bobs.id()), "Bob's among them");
    // nobody claims it again
    assert!(alices.claim(&offer, passkey_a).await.is_err(), "Alice's vault comes second");
    // Bob tries again, as if the answer had been lost: the server is avenCEO's device already
    assert_eq!(bobs.claim(&offer, passkey_b).await.expect("the same claim"), avenceo);
    let held = server.read(|lab, me| lab.size(me)).await;
    for n in [bobs, alices, stranger] {
        n.shutdown().await.expect("the node shuts down");
    }
    server.shutdown().await.expect("it stops");
    let id = server.id();
    drop(server);
    let again = open(&dir, &admission).await.expect("the server again");
    assert_eq!(again.id(), id, "the same device, from its secret");
    assert_eq!(server::vault(&again).await, Some(avenceo), "still avenCEO's, from its store");
    assert_eq!(again.read(|lab, me| lab.size(me)).await, held, "and nothing claimed anew");
    assert!(!admission.honours(&anyone), "and its relay stays closed to strangers");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_device_takes_the_servers_card_and_the_server_relays_its_vault() {
    let dir = Folder::new("card");
    let admission = Admission::default();
    let server = open(&dir, &admission).await.expect("a new server");
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, passkey_a, mac_d, passkey_d, stranger_d) = (w.mac_a, w.passkey_a, w.mac_d, w.passkey_d, w.stranger);
    let (bob_mac, carol_mac) = (endpoint(&w, w.mac_b), endpoint(&w, w.mac_c));
    let daves = node(&mut w, mac_d, &[passkey_d], 4).await;
    let mac = node(&mut w, mac_a, &[passkey_a], 1).await;
    let stranger = node(&mut w, stranger_d, &[], 5).await;
    for n in [&mac, &stranger] {
        n.know(server.addr());
    }
    stranger.know(mac.addr());
    // Dave's vault claims the server, which then knows Dave's devices and no one else
    let v: VaultId = daves.claim(&server.offer(), passkey_d).await.expect("Dave's vault claims it");
    assert!(stranger.contact(mac.id()).await.is_err(), "a person's device hands out no card");
    assert!(mac.contact(server.id()).await.expect("the server hands out its card") > 0, "Alice's Mac takes it");
    let server_d = server.device();
    assert_eq!(mac.read(move |lab, me| lab.aven_of(me, server_d)).await, Some(v), "it names avenCEO");
    assert!(!admission.admits(&mac.id()), "the server knows no device of Alice's yet");
    // on Alice's Mac, the coop gives this avenCEO relay on the whole of it, and Alice writes Welcome into it
    let relayed = move |lab: &mut Lab, me| {
        lab.issue(me, &[me], share(coop, vault(v), Level::Backup, Selector::All))?;
        lab.create(me, coop, coop, "doc", &[], document("Welcome", WELCOME_TEXT, me))
    };
    let welcome = mac.act(relayed).await.expect("the coop, relayed by avenCEO, and Welcome");
    let holds = || server.read(move |lab, me| lab.fetched(me, welcome) > 0);
    until("the server holds Welcome's edits, never asked to sync", holds).await;
    let opens = move |lab: &Lab, me| lab.reads(me, welcome) || lab.opens(me, KeyFam::Seed(coop));
    assert!(!server.read(opens).await, "and opens neither Welcome's key nor the coop's seed");
    let store = server.read(|lab, me| lab.store(me)).await;
    assert!(!contains(&store, WELCOME_TEXT), "Welcome's text appears nowhere in its store");
    until("the server's shelf holds Welcome's edits", || async { !server.behind().await }).await;
    for (path, bytes) in files(dir.path()) {
        assert!(!contains(&bytes, WELCOME_TEXT), "nor on its shelf, in {}", path.display());
    }
    // from the coop's log it knows the devices of the vaults acting for the coop: its relay lets them in, and no one
    // else
    until("the server knows Alice's Mac", || async { admission.admits(&mac.id()) }).await;
    assert!(admission.admits(&bob_mac) && admission.admits(&server.id()), "and Bob's Mac, and itself");
    assert!(admission.admits(&daves.id()), "and Dave's Mac, of avenCEO's owner");
    assert!(!admission.admits(&carol_mac) && !admission.admits(&stranger.id()), "not Carol's Mac, nor a stranger");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_persons_mac_adopts_an_agents_own_device_into_an_aven_vault_their_vault_owns() {
    let dir = Folder::new("agent");
    let shelf = disk::open(dir.path()).expect("the agent's shelf");
    let agent = server::open_agent(shelf, "avenCLAUDE", Options::local()).await.expect("the agent's device");
    assert_eq!(server::vault(&agent).await, None, "a new agent belongs to no vault");
    let mut w = world();
    let (mac_b, passkey_b, bob) = (w.mac_b, w.passkey_b, w.bob);
    let bobs = node(&mut w, mac_b, &[passkey_b], 2).await;
    bobs.know(agent.addr());
    agent.know(bobs.addr());
    // Bob's Mac founds avenCLAUDE, which Bob's vault owns, and adds the agent's device to it, in one ceremony
    let aven = bobs.adopt(&agent.offer(), None, passkey_b).await.expect("Bob's Mac adopts the agent");
    assert_eq!(server::vault(&agent).await, Some(aven), "the agent's device is avenCLAUDE's");
    let shape = move |lab: &Lab, me| {
        let v = lab.state(me).vault(aven).cloned();
        v.map(|v| (v.kind, v.owners, v.devices))
    };
    let owned = Some((Kind::Aven, vec![avendb::policy::Principal::Vault(bob)], vec![agent.device()]));
    assert_eq!(bobs.read(shape).await, owned, "an aven Bob's vault owns, the agent its one device");
    // the agent acts for avenCLAUDE by its own key: a story it starts there reaches Bob's Mac, signed by it
    let story = serde_json::json!({ "op": "create", "vault": aven.to_hex(), "type": "story",
        "value": { "kind": "story", "title": "Trailer story", "tags": [] } });
    let made = agent.op(story).await.expect("an answer");
    let entry = made["ok"]["entry"].as_str().and_then(avendb::id::EntryId::from_hex).expect("{made}");
    let by = move |lab: &Lab, me| lab.state(me).entry(entry).map(|en| en.vault);
    until("Bob's Mac holds the agent's story", || async { bobs.read(by).await == Some(aven) }).await;
    // Bob's vault lets avenCLAUDE suggest in it, a share its device issues with no ceremony: the agent reads Bob's own
    let own = serde_json::json!({ "op": "create", "vault": bob.to_hex(), "type": "story",
        "value": { "kind": "story", "title": "Bob's own story", "tags": [] } });
    let own = bobs.op(own).await.expect("an answer");
    let own = own["ok"]["entry"].as_str().and_then(avendb::id::EntryId::from_hex).expect("{own}");
    let share = serde_json::json!({ "op": "share", "over": bob.to_hex(), "who": { "vault": aven.to_hex() },
        "level": "Suggester", "what": "everything", "as": bob.to_hex() });
    let shared = bobs.op(share).await.expect("an answer");
    assert!(shared["ok"]["share"].is_string(), "a Suggester share, issued alone: {shared}");
    let sees = move |lab: &Lab, me| lab.state(me).entry(own).map(|en| en.vault);
    until("the agent reads Bob's story", || async { agent.read(sees).await == Some(bob) }).await;
    // adopted again, into the same aven: nothing founds a second one
    let again = bobs.adopt(&agent.offer(), Some(aven), passkey_b).await;
    assert!(again.is_err(), "a device of a vault already takes no claim");
}
