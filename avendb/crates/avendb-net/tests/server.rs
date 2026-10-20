//! The server peer (P8b) in a folder of its own: it keeps its device across restarts, belongs to no vault until the
//! first human vault to claim it makes it a device of avenMAIA (P8f), and keeps that too; it hands avenMAIA's card to
//! whoever asks, relays a vault once the vault gives avenMAIA relay on it, holding only ciphertext, and from then on
//! knows the devices of the vaults acting for it, whom its relay lets in.

mod common;

use std::future::Future;
use std::time::{Duration, Instant};

use avendb::cast::*;
use avendb::id::{EntryId, ShareId, SignerId, VaultId};
use avendb::keys::KeyFam;
use avendb::lab::Lab;
use avendb::world;
use avendb::policy::{Action, Kind, Level, Principal, Sharing};
use avendb::sign::{self, DeviceKey, Suite};
use avendb::slice::Selector;
use avendb_net::{Admission, Node, Options, Place, disk, server, shelf};
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
    // Bob's vault claims it first: the server is a device of avenMAIA, the aven at the end of the seed Bob's vault
    // founds, owned by Maia City, which Bob's vault owns
    let avenceo = bobs.claim(&offer, passkey_b).await.expect("Bob's vault claims the server");
    assert_eq!(server::vault(&server).await, Some(avenceo), "the server is avenMAIA's device");
    let shape = move |lab: &Lab, me| {
        let st = lab.state(me);
        st.vault(avenceo).map(|v| (v.kind, v.root, v.devices.clone(), world::seeded(st, bob, avenceo)))
    };
    let owned = Some((Kind::Aven, None, vec![server.device()], true));
    assert_eq!(server.read(shape).await, owned, "the end of Bob's seed, the server its one device");
    assert_eq!(bobs.read(shape).await, owned, "on Bob's Mac too");
    let opens = move |lab: &Lab, me| lab.opens(me, KeyFam::Seed(avenceo));
    until("the server opens avenMAIA's seed, boxed for it by Bob's Mac", || server.read(opens)).await;
    assert!(!server.read(move |lab, me| lab.opens(me, KeyFam::Seed(bob))).await, "and not Bob's vault's seed");
    assert!(!admission.honours(&anyone), "once claimed, its relay honours only the passes of people it knows");
    assert!(admission.honours(&passkey_b) && admission.admits(&bobs.id()), "Bob's among them");
    // nobody claims it again
    assert!(alices.claim(&offer, passkey_a).await.is_err(), "Alice's vault comes second");
    // Bob tries again, as if the answer had been lost: the server is avenMAIA's device already
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
    assert_eq!(server::vault(&again).await, Some(avenceo), "still avenMAIA's, from its store");
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
    assert_eq!(mac.read(move |lab, me| lab.server_vault_of(me, server_d)).await, Some(v), "it names avenMAIA");
    assert!(!admission.admits(&mac.id()), "the server knows no device of Alice's yet");
    // on Alice's Mac, the coop gives avenMAIA relay on the whole of it, and Alice writes Welcome into it
    let relayed = move |lab: &mut Lab, me| {
        lab.issue(me, &[me], share(coop, vault(v), Level::Backup, Selector::All))?;
        lab.create(me, coop, coop, "doc", &[], document("Welcome", WELCOME_TEXT, me))
    };
    let welcome = mac.act(relayed).await.expect("the coop, relayed by avenMAIA, and Welcome");
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
    assert!(admission.admits(&daves.id()), "and Dave's Mac, of avenMAIA's owner");
    assert!(!admission.admits(&carol_mac) && !admission.admits(&stranger.id()), "not Carol's Mac, nor a stranger");
}

/// An agent's own device on a shelf in folder `dir`, named `name`, as a harness starts it beside its person's Mac.
async fn agent(dir: &Folder, name: &str) -> Node {
    let shelf = disk::open(dir.path()).expect("the agent's shelf");
    server::open_agent(shelf, name, Options::local()).await.expect("the agent's device")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_persons_mac_adds_agents_as_devices_of_their_coops_one_aven_which_act_with_its_rights() {
    let (claude_dir, codex_dir, second_dir) = (Folder::new("claude"), Folder::new("codex"), Folder::new("claude-2"));
    let claude = agent(&claude_dir, "agentClaude").await;
    let codex = agent(&codex_dir, "agentCodex").await;
    // the same harness on Bob's second Mac: another device of its own
    let second = agent(&second_dir, "agentClaude").await;
    assert_eq!(server::vault(&claude).await, None, "a new agent belongs to no vault");
    let mut w = world();
    let (mac_b, passkey_b, bob) = (w.mac_b, w.passkey_b, w.bob);
    // Bob's garden, a coop of his alone, and its one aven, which holds no device yet and owns nothing
    let found = |w: &mut World, kind: Kind, owner: VaultId| {
        let owners = vec![Principal::Vault(owner)];
        let genesis = Action::Genesis { kind, owners, threshold: 1, root: None, nonce: 3, seal_to: vec![] };
        VaultId::from(w.lab.submit(mac_b, &[passkey_b], genesis).expect("Bob's passkey founds it"))
    };
    let garden = found(&mut w, Kind::Coop, bob);
    let aven = found(&mut w, Kind::Aven, garden);
    // a second aven of the garden, for nobody
    let twice = w.lab.submit(mac_b, &[passkey_b], Action::Genesis {
        kind: Kind::Aven,
        owners: vec![Principal::Vault(garden)],
        threshold: 1,
        root: None,
        nonce: 4,
        seal_to: vec![],
    });
    assert!(twice.is_err(), "one aven a coop");
    let bobs = node(&mut w, mac_b, &[passkey_b], 2).await;
    for a in [&claude, &codex, &second] {
        bobs.know(a.addr());
        a.know(bobs.addr());
    }
    // an aven owns no vault: no agent's device vault goes under it
    let under = bobs.add_device_vault(&claude.offer(), Place::Under(aven), passkey_b).await;
    assert!(under.is_err(), "no device vault under an aven: {under:?}");
    assert_eq!(server::vault(&claude).await, None, "and agentClaude joined nothing");
    // his Mac adds agentClaude's key to the aven as a device, in one ceremony, which the agent's device cosigns
    let joined = bobs.add_device_vault(&claude.offer(), Place::Vault(aven), passkey_b).await.expect("agentClaude");
    assert_eq!(joined, (garden, aven), "a device of the garden's aven");
    assert_eq!(server::vault(&claude).await, Some(aven), "agentClaude acts as the aven");
    let shape = move |v: VaultId| {
        move |lab: &Lab, me| lab.state(me).vault(v).map(|v| (v.kind, v.owners.clone(), v.devices.clone()))
    };
    let one = Some((Kind::Aven, vec![Principal::Vault(garden)], vec![claude.device()]));
    assert_eq!(bobs.read(shape(aven)).await, one, "the garden's one aven, agentClaude its device");
    // agentCodex, and agentClaude on his second Mac, join the same aven: three devices of one vault, one set of rights
    let codexs = bobs.add_device_vault(&codex.offer(), Place::Vault(aven), passkey_b).await.expect("agentCodex");
    assert_eq!(codexs, (garden, aven), "the same aven");
    let seconds = bobs.add_device_vault(&second.offer(), Place::Vault(aven), passkey_b).await.expect("the second");
    assert_eq!(seconds, (garden, aven), "the same aven again");
    let all = vec![claude.device(), codex.device(), second.device()];
    assert_eq!(bobs.read(shape(aven)).await, Some((Kind::Aven, vec![Principal::Vault(garden)], all)));
    let again = bobs.add_device_vault(&claude.offer(), Place::Vault(aven), passkey_b).await;
    assert!(again.is_err(), "a device of a vault already takes no claim");
    // Bob's vault lets the aven suggest in it: every agent of it reads Bob's own story, by its own key
    let own = serde_json::json!({ "op": "create", "vault": bob.to_hex(), "type": "story",
        "value": { "kind": "story", "title": "Bob's own story", "tags": [] } });
    let own = bobs.op(own).await.expect("an answer");
    let own = own["ok"]["entry"].as_str().and_then(avendb::id::EntryId::from_hex).expect("{own}");
    let to_aven = serde_json::json!({ "op": "share", "over": bob.to_hex(), "who": { "vault": aven.to_hex() },
        "level": "Suggester", "what": "everything", "as": bob.to_hex() });
    let to_aven = bobs.op(to_aven).await.expect("an answer");
    let to_aven = to_aven["ok"]["share"].as_str().and_then(ShareId::from_hex).expect("the aven's: {to_aven}");
    let sees = move |lab: &Lab, me| lab.state(me).entry(own).map(|en| en.vault);
    until("agentClaude reads Bob's story", || async { claude.read(sees).await == Some(bob) }).await;
    until("agentCodex reads it too", || async { codex.read(sees).await == Some(bob) }).await;
    // an agent acts as the aven: a story it starts in the garden as the aven may only suggest is refused on main
    let story = serde_json::json!({ "op": "create", "vault": garden.to_hex(), "type": "story",
        "value": { "kind": "story", "title": "Trailer story", "tags": [] } });
    let refused = claude.op(story).await.expect("an answer");
    assert!(refused.get("ok").is_none(), "the garden gave the aven nothing: {refused}");
    // Bob's vault takes the aven's share back: it ends for every agent of it
    let revoke = serde_json::json!({ "op": "revoke", "share": to_aven.to_hex(), "as": bob.to_hex() });
    assert!(bobs.op(revoke).await.expect("an answer")["ok"]["edit"].is_string(), "revoked");
    let ended = move |lab: &Lab, me| !lab.state(me).live(to_aven);
    assert!(bobs.read(ended).await, "it ends on Bob's Mac");
    until("it ends on agentClaude's device", || claude.read(ended)).await;
    for n in [bobs, claude, codex, second] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// The access requests device `node` reads (the ops engine's `requests`): `{asked, made}`.
async fn requests(node: &Node) -> serde_json::Value {
    let answer = node.op(serde_json::json!({ "op": "requests" })).await.expect("an answer");
    answer["ok"].clone()
}

/// The entries of the requests `node` is asked, in order.
async fn asked(node: &Node) -> Vec<serde_json::Value> {
    let asked = requests(node).await["asked"].as_array().cloned().unwrap_or_default();
    asked.into_iter().map(|r| r["entry"].clone()).collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_avens_access_request_reaches_the_coop_it_asks_directly_and_through_the_server_while_its_person_is_away() {
    let dir = Folder::new("asker");
    let claude = agent(&dir, "agentClaude").await;
    let mut w = world();
    let (alice, bob) = (w.alice, w.bob);
    let (mac_a, passkey_a, mac_b, passkey_b, server_d) = (w.mac_a, w.passkey_a, w.mac_b, w.passkey_b, w.server);
    // Alice's vault has avenMAIA keep a backup of it; Bob has an iPhone beside his Mac, and a garden, a coop of
    // his alone, whose card Alice's Mac takes
    relay_on(&mut w, alice);
    let phone_b = w.lab.device_of(passkey_b, "Bob's iPhone");
    let add = Action::Share(Sharing::Device { vault: bob, device: phone_b, seal_to: None });
    w.lab.submit(mac_b, &[passkey_b, phone_b], add).expect("Bob's passkey adds his iPhone");
    let genesis = Action::Genesis {
        kind: Kind::Coop,
        owners: vec![Principal::Vault(bob)],
        threshold: 1,
        root: None,
        nonce: 0,
        seal_to: vec![],
    };
    let garden = VaultId::from(w.lab.submit(mac_b, &[passkey_b], genesis).expect("Bob's garden"));
    w.lab.share_contact(mac_b, mac_a, garden);
    let found = |w: &mut World, kind: Kind, owner: VaultId| {
        let owners = vec![Principal::Vault(owner)];
        let genesis = Action::Genesis { kind, owners, threshold: 1, root: None, nonce: 3, seal_to: vec![] };
        VaultId::from(w.lab.submit(mac_a, &[passkey_a], genesis).expect("her passkey founds it"))
    };
    let orchard = found(&mut w, Kind::Coop, alice);
    let aven = found(&mut w, Kind::Aven, orchard);
    w.lab.sync_all(0);
    let mac = node(&mut w, mac_a, &[passkey_a], 1).await;
    let bobs = node(&mut w, mac_b, &[passkey_b], 2).await;
    for (a, b) in [(&mac, &bobs), (&bobs, &mac), (&mac, &claude), (&claude, &mac)] {
        a.know(b.addr());
    }
    // all her vaults, now and later, for Bob to read: a standing grant, which a vault of one owner doesn't follow
    let standing = serde_json::json!({ "op": "share", "over": alice.to_hex(), "who": { "vault": bob.to_hex() },
        "level": "Viewer", "standing": true, "as": alice.to_hex() });
    assert!(mac.op(standing).await.expect("an answer")["ok"]["share"].is_string(), "her standing grant");
    // a coop of hers and its one aven, founded under her, each following her standing grants, as every vault founded
    // under her does; then her Mac adds agentClaude's key to the aven as a device: it acts as the aven
    for v in [orchard, aven] {
        let follow = move |lab: &mut Lab, me| avendb::engine::follow_standing(lab, me, v).map(drop);
        mac.act(follow).await.expect("it follows her standing grants");
    }
    let joined = mac.add_device_vault(&claude.offer(), Place::Vault(aven), passkey_a).await.expect("agentClaude");
    assert_eq!(joined, (orchard, aven), "a device of her coop's aven");
    assert_eq!(server::vault(&claude).await, Some(aven), "agentClaude acts as the aven");
    let given = move |v: VaultId, level: Level| {
        move |lab: &Lab, me| {
            let st = lab.state(me);
            st.shares_over(v).any(|cp| cp.share.wide && cp.share.level == level && st.live(cp.id))
        }
    };
    assert!(mac.read(given(aven, Level::Backup)).await, "the server keeps the aven, as it keeps her vault");
    assert!(!mac.read(given(aven, Level::Read)).await, "Bob reads none of it: an aven acts for its coop alone");
    // her aven asks Bob's garden for Editor, both Macs online: a record in the aven, and a share of it to the garden
    let ask = |why: &str| {
        serde_json::json!({ "op": "ask", "to": garden.to_hex(), "level": "Editor", "why": why, "as": aven.to_hex() })
    };
    let first = mac.op(ask("To plan the harvest")).await.expect("an answer");
    let first = first["ok"]["entry"].clone();
    assert!(first.is_string(), "the request: {first}");
    let near = || async {
        bobs.sync_with(mac.id()).await.ok();
        asked(&bobs).await == [first.clone()]
    };
    until("Bob's Mac is asked, straight from Alice's", near).await;
    let request = requests(&bobs).await["asked"][0].clone();
    let said = (&request["from"], &request["to"], &request["level"], &request["why"]);
    let want = (&serde_json::json!(aven.to_hex()), &serde_json::json!(garden.to_hex()), &serde_json::json!("Editor"));
    assert_eq!(said, (want.0, want.1, want.2, &serde_json::json!("To plan the harvest")));
    // Bob grants it: the garden's share to the aven, and the answer, which Alice's Mac sees
    let grant = serde_json::json!({ "op": "share", "over": garden.to_hex(), "who": { "vault": aven.to_hex() },
        "level": "Editor", "as": garden.to_hex() });
    assert!(bobs.op(grant).await.expect("an answer")["ok"]["share"].is_string(), "granted");
    let answer = serde_json::json!({ "op": "set", "entry": first, "path": ["answer"], "value": "granted",
        "as": garden.to_hex() });
    assert!(bobs.op(answer).await.expect("an answer")["ok"]["edit"].is_string(), "answered");
    let seen = || async {
        mac.sync_with(bobs.id()).await.ok();
        requests(&mac).await["made"][0]["answer"] == "granted"
    };
    until("Alice's Mac sees it granted", seen).await;
    // Bob's Mac goes away; the server comes, and her aven asks again: the server keeps the request, then she goes too
    bobs.shutdown().await.expect("Bob's Mac stops");
    let server = node(&mut w, server_d, &[], 9).await;
    mac.know(server.addr());
    server.know(mac.addr());
    let second = mac.op(ask("To sow the beans")).await.expect("an answer")["ok"]["entry"].clone();
    let entry = second.as_str().and_then(EntryId::from_hex).expect("the second request");
    let holds = || async {
        server.sync_with(mac.id()).await.ok();
        server.read(move |lab, me| lab.fetched(me, entry) > 0).await
    };
    until("the server holds the second request", holds).await;
    assert!(!server.read(move |lab, me| lab.reads(me, entry)).await, "and reads none of it");
    for n in [mac, claude] {
        n.shutdown().await.expect("the node stops");
    }
    // Bob's iPhone, which never met Alice's Mac, with neither her Mac nor her agent online: it is asked through the
    // server
    let phone = node(&mut w, phone_b, &[passkey_b], 3).await;
    phone.know(server.addr());
    let far = || async {
        phone.sync_with(server.id()).await.ok();
        asked(&phone).await.contains(&second)
    };
    until("Bob's iPhone is asked through the server, Alice away", far).await;
    for n in [phone, server] {
        n.shutdown().await.expect("the node stops");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_server_made_before_the_key_move_opens_as_itself_and_a_new_one_in_ml_dsa_65() {
    // a server made before the key move kept the 32 bytes of its secret alone: it opens in SLH-DSA, as itself
    let old = Folder::new("old server");
    let shelf = disk::open(old.path()).expect("its shelf");
    shelf.put(server::SECRET, bytes::Bytes::copy_from_slice(&[7; 32])).await.expect("its secret, as it kept it");
    let node = server::open(shelf, Options::local()).await.expect("the server");
    assert_eq!(node.device(), DeviceKey::from_secret_in([7; 32], Suite::SlhDsa).id(), "in SLH-DSA, as itself");
    node.shutdown().await.expect("it shuts down");
    // a new one makes its secret in ML-DSA-65, keeps its suite with it, and opens as itself again
    let new = Folder::new("new server");
    let first = open(&new, &Admission::default()).await.expect("a new server");
    let kept = disk::open(new.path()).expect("its shelf").get(server::SECRET).await.expect("it reads");
    let (secret, suite) = sign::kept_secret_of(&kept.expect("its secret")).expect("a kept secret");
    assert_eq!(suite, Suite::MlDsa);
    let id = first.device();
    assert_eq!(id, DeviceKey::from_secret_in(*secret, suite).id());
    first.shutdown().await.expect("it shuts down");
    let again = open(&new, &Admission::default()).await.expect("the server again");
    assert_eq!(again.device(), id, "the same device");
    again.shutdown().await.expect("it shuts down");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_persons_mac_moves_the_avens_server_and_agent_from_before_the_key_move_and_they_open_as_their_next_keys() {
    // a server and an agent made before the key move kept the 32 bytes of their secrets alone: SLH-DSA
    let (server_dir, claude_dir) = (Folder::new("aven server"), Folder::new("aven claude"));
    let secrets = [[11; 32], [12; 32]];
    for (dir, secret) in [&server_dir, &claude_dir].into_iter().zip(secrets) {
        let shelf = disk::open(dir.path()).expect("its shelf");
        shelf.put(server::SECRET, bytes::Bytes::copy_from_slice(&secret)).await.expect("its secret, as it kept it");
    }
    let [earlier, next] = [Suite::SlhDsa, Suite::MlDsa].map(|suite| secrets.map(|s| DeviceKey::from_secret_in(s, suite).id()));
    let admission = Admission::default();
    let server = open(&server_dir, &admission).await.expect("the server");
    let claude = agent(&claude_dir, "agentClaude").await;
    assert_eq!([server.device(), claude.device()], earlier, "each in SLH-DSA, as itself");
    let mut w = world();
    let (mac_b, passkey_b) = (w.mac_b, w.passkey_b);
    let bobs = node(&mut w, mac_b, &[passkey_b], 2).await;
    let offer = server.offer();
    let aven = bobs.claim(&offer, passkey_b).await.expect("Bob's vault claims the server");
    bobs.know(claude.addr());
    claude.know(bobs.addr());
    bobs.add_device_vault(&claude.offer(), Place::Vault(aven), passkey_b).await.expect("agentClaude joins avenMAIA");
    // a device of no vault, and one whose key hasn't moved, hands no next key
    assert!(bobs.next_key_of(bobs.id(), mac_b).await.is_err(), "Bob's Mac answers no claims");
    // Bob's Mac sees the aven's two devices in SLH-DSA, and each hands its next key, from the same secret
    let mut found = bobs.read(|lab, me| lab.aven_devices(me)).await;
    found.sort();
    let mut expected = vec![(earlier[0], *server.id().as_bytes()), (earlier[1], *claude.id().as_bytes())];
    expected.sort();
    assert_eq!(found, expected, "the server and agentClaude, at their endpoints");
    for (d, n) in earlier.into_iter().zip(next) {
        let at = EndpointId::from_bytes(&found.iter().find(|f| f.0 == d).expect("found").1).expect("an endpoint");
        assert_eq!(bobs.next_key_of(at, d).await.expect("its next key"), n);
    }
    // his passkey adds each next key to the aven, beside the earlier, which each device signs too and keeps
    let moves: Vec<(SignerId, SignerId)> = earlier.into_iter().zip(next).collect();
    let by_move = moves.clone();
    let drafts = bobs.read(move |lab, me| lab.draft_move(me, &by_move, passkey_b)).await.expect("the move's edits");
    assert_eq!(drafts.len(), 2, "one edit each");
    for (draft, at) in drafts.into_iter().zip([server.id(), claude.id()]) {
        let claim = bobs.act(move |lab, me| lab.claim(me, draft, &[])).await.expect("its claim");
        bobs.send_move(at, claim).await.expect("the device takes its key move");
    }
    let devices = move |lab: &Lab, me| lab.state(me).vault(aven).map(|v| v.devices.clone());
    let all = Some(vec![earlier[0], earlier[1], next[0], next[1]]);
    assert_eq!(bobs.read(devices).await, all, "each next key beside the earlier, which stays");
    until("the server sees both moves", || async { server.read(devices).await == all }).await;
    assert!(bobs.read(|lab, me| lab.aven_devices(me)).await.is_empty(), "nothing left to move");
    assert_eq!(server::moved(&server).await, Some(next[0]), "the server knows its next key");
    // each names its next key on its shelf once the shelf holds the move, and opens as it from its next start
    let named = |dir: &Folder| {
        let dir = dir.path().to_path_buf();
        async move { disk::open(&dir).expect("its shelf").get(server::NEXT).await.expect("it reads").is_some() }
    };
    until("the server names its next key", || named(&server_dir)).await;
    until("agentClaude names its next key", || named(&claude_dir)).await;
    for n in [server, claude] {
        n.shutdown().await.expect("it stops");
    }
    let server = open(&server_dir, &admission).await.expect("the server again");
    let claude = agent(&claude_dir, "agentClaude").await;
    assert_eq!([server.device(), claude.device()], next, "each in ML-DSA-65, as its next key");
    assert_eq!(server::vault(&server).await, Some(aven), "the server still avenMAIA's");
    assert_eq!(server::vault(&claude).await, Some(aven), "and agentClaude");
    assert_eq!(*server.id().as_bytes(), found.iter().find(|f| f.0 == earlier[0]).expect("the server").1, "same endpoint");
    // the offer the app carries names the server's earlier key: its next key at the same endpoint stands for it
    bobs.know(server.addr());
    assert_eq!(bobs.claim(&offer, passkey_b).await.expect("the same server"), aven);
    for n in [bobs, server, claude] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_server_whose_shelf_names_a_next_key_of_no_vault_opens_as_its_earlier_key() {
    // a shelf that names a next key whose move it doesn't hold: the server doesn't open as a device of no vault, which
    // would take a stranger's claim, but as its earlier key
    let dir = Folder::new("lost move");
    let shelf = disk::open(dir.path()).expect("its shelf");
    shelf.put(server::SECRET, bytes::Bytes::copy_from_slice(&[13; 32])).await.expect("its secret");
    let next = DeviceKey::from_secret_in([13; 32], Suite::MlDsa).id();
    shelf.put(server::NEXT, bytes::Bytes::copy_from_slice(&next.0)).await.expect("a next key");
    let node = open(&dir, &Admission::default()).await.expect("the server");
    assert_eq!(node.device(), DeviceKey::from_secret_in([13; 32], Suite::SlhDsa).id(), "as its earlier key");
    node.shutdown().await.expect("it stops");
}
