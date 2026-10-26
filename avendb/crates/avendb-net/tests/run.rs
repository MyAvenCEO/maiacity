//! One API (`Node::run`, `docs/ARCHITECTURE.md` §8): a node runs every op of the engine as JSON, a read on what
//! its device holds, `may` and `shares` dry, a change made and its peers told; one its vault's owners approve it has
//! the passkey sign in a ceremony, or else answers `approve` and makes nothing. It brings a file's bytes in beside a
//! `put_file`, once the entry it would create is checked, and reads any range of a file back beside a `read_file`; and
//! once the vaults its device follows change (`follow`), it asks its peers again, each request naming them, so it is
//! sent what everyone reads of them.

use std::future::Future;
use std::io;
use std::sync::Mutex;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use avendb::cast::*;
use avendb::id::{BlobId, EntryId, SignerId, VaultId};
use avendb::lab::Lab;
use avendb::policy::{Level, Principal, Who};
use avendb::sign::{Ceremony, Passkey};
use avendb_net::{Authenticator, NoBytes, NoCeremony, Node, Options, Step};
use bytes::Bytes;
use n0_future::stream;
use serde_json::{Value, json};

/// A node for device `d`, split off `w`'s Lab with the keys of `with`, its randomness drawn from `seed`.
async fn node(w: &mut World, d: SignerId, with: &[SignerId], seed: u8) -> Node {
    Node::spawn(w.lab.split(d, with, [seed; 32]), d, Options::local()).await.expect("a node")
}

/// Waits until `check` holds, 30 seconds at most.
async fn until<F: Future<Output = bool>>(what: &str, mut check: impl FnMut() -> F) {
    let end = Instant::now() + Duration::from_secs(30);
    while !check().await {
        assert!(Instant::now() < end, "{what}, within 30 s");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// A person's passkey in software, as a browser's authenticator holds one: each ceremony it made, and what for.
struct Software(Mutex<(Passkey, Vec<Step>)>);

impl Authenticator for Software {
    async fn ceremony(&self, challenge: [u8; 32], step: Step) -> anyhow::Result<Ceremony> {
        let mut held = self.0.lock().expect("the authenticator");
        held.1.push(step);
        Ok(held.0.ceremony(challenge))
    }
}

impl Software {
    /// The ceremonies it made since it was last asked.
    fn steps(&self) -> Vec<Step> {
        std::mem::take(&mut self.0.lock().expect("the authenticator").1)
    }
}

/// Op `op` on node `n`, with passkey `passkey` at hand: what it answered `ok`, or the whole answer.
async fn signed(n: &Node, op: Value, passkey: &Software) -> Result<Value, Value> {
    let (out, _) = n.run(op, None::<NoBytes>, Some(passkey)).await.expect("an answer");
    out.get("ok").cloned().ok_or(out)
}

/// Op `op` on node `n`, with no ceremony at hand: what it answered `ok`, or the whole answer.
async fn run(n: &Node, op: Value) -> Result<Value, Value> {
    let out = n.op(op).await.expect("an answer");
    out.get("ok").cloned().ok_or(out)
}

fn vault_id(v: &Value) -> VaultId {
    VaultId::from_hex(v.as_str().unwrap_or_else(|| panic!("a vault's id: {v}"))).expect("64 hex digits")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_node_has_the_passkey_approve_what_its_vault_approves_and_else_answers_approve() {
    let mut w = world();
    let secret = w.lab.passkey_secret(w.passkey_a).expect("Alice's passkey, a software passkey");
    let (mac_a, alice, passkey) = (w.mac_a, w.alice, w.passkey_a);
    let mac = node(&mut w, mac_a, &[passkey], 1).await;
    let alices = Software(Mutex::new((Passkey::from_seed(*secret), vec![])));
    // a read, and its world
    let seen = run(&mac, json!({ "op": "world" })).await.expect("her world");
    assert_eq!((&seen["mine"], &seen["ownsServer"]), (&json!(alice.to_hex()), &json!(true)));
    // new vaults: without a ceremony the op answers its draft and makes nothing; with one, they are made
    let found = json!({ "op": "found", "vaults": [{ "kind": "coop", "name": "Garden COOP" },
        { "kind": "coop", "name": "Maia City COOP" }] });
    let asked = run(&mac, found.clone()).await.expect_err("it waits for her passkey");
    assert_eq!(asked["approve"]["signers"], json!([passkey.to_hex()]));
    let vaults = mac.read(|lab, me| lab.state(me).vaults().len()).await;
    let made = signed(&mac, found, &alices).await.expect("two vaults");
    assert_eq!(alices.steps(), [Step::Approve], "one ceremony for both");
    let ids: Vec<VaultId> = made["vaults"].as_array().expect("the vaults").iter().map(vault_id).collect();
    let [x, coop] = ids[..] else { panic!("two vaults: {made}") };
    assert_eq!(mac.read(|lab, me| lab.state(me).vaults().len()).await, vaults + 2);
    // owner of everything: the coop a co-owner of the Garden, in a ceremony
    let owner = json!({ "op": "share", "over": x.to_hex(), "who": { "vault": coop.to_hex() }, "level": "Owner",
        "what": "everything" });
    let asked = run(&mac, json!({ "op": "may", "ops": [owner] })).await.expect("an answer");
    assert_eq!(asked, json!([{ "approve": { "signers": [passkey.to_hex()] } }]));
    assert!(signed(&mac, owner, &alices).await.expect("a co-owner")["edit"].is_string());
    let owners = move |lab: &Lab, me| lab.state(me).vault(x).map(|v| (v.owners.clone(), v.threshold));
    assert_eq!(mac.read(owners).await, Some((vec![Principal::Vault(alice), Principal::Vault(coop)], 1)));
    // its threshold, in another
    let two = json!({ "op": "settings", "vault": x.to_hex(), "threshold": 2 });
    assert!(signed(&mac, two, &alices).await.expect("a new threshold")["edit"].is_string());
    assert_eq!(mac.read(owners).await.map(|(_, t)| t), Some(2));
    assert_eq!(alices.steps(), [Step::Approve, Step::Approve]);
    // what the rules refuse takes no ceremony
    let three = json!({ "op": "settings", "vault": x.to_hex(), "threshold": 3 });
    assert_eq!(signed(&mac, three, &alices).await.expect_err("refused")["refused"], "BadThreshold");
    assert_eq!(alices.steps(), [], "no ceremony");
    // a change the device makes alone takes none either
    let card = signed(&mac, json!({ "op": "card", "name": "Alice's Mac" }), &alices).await.expect("its card");
    assert_eq!((card, alices.steps()), (json!({ "wrote": true }), vec![]));
    // and the shares over her vault, each with may of its revoke
    let listed = run(&mac, json!({ "op": "shares", "over": alice.to_hex() })).await.expect("the shares");
    let rows = listed["rows"].as_array().expect("its rows");
    let kinds: Vec<&str> = rows.iter().filter_map(|r| r["kind"].as_str()).collect();
    assert_eq!(kinds, ["owner", "device", "device"]);
    mac.shutdown().await.expect("the node shuts down");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_node_brings_a_file_in_beside_put_file_and_reads_any_range_of_it_beside_read_file() {
    let mut w = world();
    let (mac_a, alice, bob) = (w.mac_a, w.alice, w.bob);
    let mac = node(&mut w, mac_a, &[], 1).await;
    let film: Vec<u8> = (0..(1 << 20) + 4321).map(|i: u32| (i * 31 % 251) as u8).collect();
    let len = film.len() as u64;
    let chunks = || {
        let chunks = film.chunks(1 << 16).map(|c| Ok(Bytes::copy_from_slice(c)));
        stream::iter(chunks.collect::<Vec<io::Result<Bytes>>>())
    };
    let op = json!({ "op": "put_file", "vault": alice.to_hex(), "name": "Harvest.mp4", "media": "video/mp4",
        "tags": [], "len": len });
    let (made, none) = mac.run(op, Some(chunks), None::<&NoCeremony>).await.expect("an answer");
    assert!(none.is_none(), "no bytes beside a put_file's answer");
    let made = made["ok"].clone();
    let entry = EntryId::from_hex(made["entry"].as_str().expect("its entry")).expect("an entry's id");
    let (root, size) = (made["root"].clone(), made["size"].as_u64().expect("its sealed size"));
    let files = mac.read(move |lab, me| lab.entry_files(me, entry)).await;
    let files: Vec<(String, u64, Option<u64>)> =
        files.iter().map(|(f, n)| (BlobId(f.hash).to_hex(), f.size, *n)).collect();
    assert_eq!(files, [(root.as_str().expect("a root").to_string(), size, Some(len))], "the file its write brings");
    // any range of it, the bytes beside the answer, cut to the file
    for (from, to) in [(0, 10), ((1 << 20) - 5, (1 << 20) + 5), (len - 100, len + 50)] {
        let read = json!({ "op": "read_file", "root": root, "size": size, "from": from, "to": to });
        let (answer, bytes) = mac.run(read, None::<NoBytes>, None::<&NoCeremony>).await.expect("an answer");
        let end = to.min(len);
        assert_eq!(answer, json!({ "ok": { "root": root, "from": from, "to": end, "len": end - from } }));
        assert_eq!(bytes.expect("its bytes"), film[from as usize..end as usize], "bytes {from} to {to}");
    }
    let whole = json!({ "op": "read_file", "root": root, "size": size });
    let (_, bytes) = mac.run(whole, None::<NoBytes>, None::<&NoCeremony>).await.expect("an answer");
    assert_eq!(bytes.expect("all of it"), film);
    let unknown = json!({ "op": "read_file", "root": BlobId([4; 32]).to_hex(), "size": 10 });
    let (answer, bytes) = mac.run(unknown, None::<NoBytes>, None::<&NoCeremony>).await.expect("an answer");
    assert_eq!((&answer["refused"], bytes), (&json!("NoCap"), None), "a file it doesn't open");
    // the entry is checked before a byte is read: into Bob's vault, none
    let theirs = json!({ "op": "put_file", "vault": bob.to_hex(), "name": "x", "len": 3 });
    let untouched =
        || stream::poll_fn(|_: &mut Context<'_>| -> Poll<Option<io::Result<Bytes>>> { panic!("a byte read") });
    let (answer, _) = mac.run(theirs, Some(untouched), None::<&NoCeremony>).await.expect("an answer");
    assert_eq!(answer["refused"], "NoCap");
    // bytes fewer than its length: no answer comes
    let short = json!({ "op": "put_file", "vault": alice.to_hex(), "name": "Short", "len": 10 });
    let few = || stream::iter([Ok::<_, io::Error>(Bytes::from_static(b"four"))]);
    assert!(mac.run(short, Some(few), None::<&NoCeremony>).await.is_err(), "the file ends early");
    let bare = json!({ "op": "put_file", "vault": alice.to_hex(), "name": "Bare", "len": 1 });
    assert!(mac.op(bare).await.is_err(), "a put_file brings its bytes");
    // its jobs, as the page reads them: the film brought in, every byte of it, named by its root once sealed; the short
    // one failed, and why; the refused and the bare ones never began
    let jobs = mac.op(json!({ "op": "jobs" })).await.expect("its jobs")["ok"].clone();
    let ended = jobs["ended"].as_array().expect("those that ended");
    let text = |j: &Value, k: &str| j[k].as_str().unwrap_or_default().to_string();
    let told: Vec<_> = ended
        .iter()
        .map(|j| (text(j, "kind"), text(j, "name"), text(j, "state"), j["done"].as_u64(), j["total"].as_u64()))
        .collect();
    let s = |x: &str| x.to_string();
    // the short one failed in its first read, which counts each byte half
    let short = (s("bring"), s("Short"), s("failed"), Some(2), Some(10));
    assert_eq!(told, [short, (s("bring"), s("Harvest.mp4"), s("done"), Some(len), Some(len))], "the newest first");
    assert_eq!((&ended[1]["subject"], &ended[1]["unit"]), (&root, &json!("bytes")));
    let alices = |n: u64| json!({ alice.to_hex(): n });
    assert_eq!((&ended[1]["vaults"], &ended[0]["vaults"]), (&alices(len), &alices(10)), "the vault each went into");
    let made_entry = json!({ entry.to_hex(): len });
    assert_eq!((&ended[1]["entries"], &ended[0]["entries"]), (&made_entry, &json!({})), "the entry the film made");
    assert!(text(&ended[0], "error").contains("fewer bytes"), "{}", ended[0]);
    assert_eq!(jobs["running"], json!([]), "nothing runs now");
    mac.shutdown().await.expect("the node shuts down");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn once_it_follows_a_vault_a_node_asks_again_and_is_sent_what_everyone_reads_of_it() {
    let mut w = world();
    let h = handbook(&mut w);
    let (mac_a, mac_d, coop, welcome) = (w.mac_a, w.mac_d, h.coop, h.welcome);
    let public = share(coop, Who::Everyone, Level::Read, by_id(welcome));
    w.lab.issue(mac_a, &[mac_a], public).expect("the coop makes Welcome public");
    w.lab.sync_all(0);
    let mac = node(&mut w, mac_a, &[], 1).await;
    let daves = node(&mut w, mac_d, &[], 4).await;
    daves.know(mac.addr());
    mac.know(daves.addr());
    let reads = move |lab: &Lab, me| text(lab, me, welcome, 2).is_some();
    let peers = || async { mac.proven(daves.id()).is_some() };
    until("the two Macs meet", peers).await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert!(!daves.read(reads).await, "Dave's Mac, outside the coop and following nothing, gets nothing of it");
    let follow = json!({ "op": "follow", "vault": coop.to_hex(), "on": true });
    assert_eq!(run(&daves, follow).await, Ok(json!({ "follow": [coop.to_hex()] })));
    assert_eq!(daves.read(|lab, me| lab.follows(me).to_vec()).await, [coop]);
    until("it asks again, following the coop, and reads Welcome", || daves.read(reads)).await;
    let onboarding = h.onboarding;
    let other = move |lab: &Lab, me| text(lab, me, onboarding, 2).is_some();
    assert!(!daves.read(other).await, "what everyone reads alone");
    let unfollow = json!({ "op": "follow", "vault": coop.to_hex(), "on": false });
    assert_eq!(run(&daves, unfollow).await, Ok(json!({ "follow": [] })));
    for n in [&mac, &daves] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_node_brings_the_entries_a_page_names_alone_and_refuses_a_bring_naming_both_or_neither() {
    let mut w = world();
    let h = handbook(&mut w);
    let (mac_a, phone_a, coop) = (w.mac_a, w.phone_a, h.coop);
    // two notes Alice's Mac writes in the coop that her phone doesn't hold yet
    let first = w.lab.create(mac_a, coop, coop, "doc", &[], document("First", "Bring me.", mac_a)).expect("First");
    let other = w.lab.create(mac_a, coop, coop, "doc", &[], document("Other", "Leave me.", mac_a)).expect("Other");
    let mac = node(&mut w, mac_a, &[], 1).await;
    // her phone asks its peers only when told
    let lazy = Options { lazy: true, ..Options::local() };
    let phone = Node::spawn(w.lab.split(phone_a, &[], [2; 32]), phone_a, lazy).await.expect("a node");
    phone.know(mac.addr());
    mac.know(phone.addr());
    until("the two meet", || async { phone.proven(mac.id()).is_some() }).await;
    let holds = |e| move |lab: &Lab, me| text(lab, me, e, 2).is_some();
    // a bring of the first note alone: the Mac answers whole, and the phone holds it and not the other
    let brought = run(&phone, json!({ "op": "bring", "entries": [first.to_hex()] })).await.expect("brought");
    assert_eq!(brought["reached"], json!(true), "{brought}");
    assert!(brought["new"].as_u64() > Some(0), "{brought}");
    assert!(phone.read(holds(first)).await, "the entry it named");
    assert!(!phone.read(holds(other)).await, "and nothing else");
    // a bring names vaults or entries, 1 to 64, each by its id
    let both = json!({ "op": "bring", "vaults": [coop.to_hex()], "entries": [first.to_hex()] });
    for bad in [both, json!({ "op": "bring" }), json!({ "op": "bring", "entries": [] }), json!({ "op": "bring", "entries": ["x"] })] {
        assert_eq!(run(&phone, bad).await.expect_err("refused")["refused"], "BadOp");
    }
    for n in [&mac, &phone] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_node_brings_the_vaults_a_page_reads_its_code_from_first_and_tells_how_far_it_is_synced() {
    let mut w = world();
    let h = handbook(&mut w);
    let (mac_a, phone_a, coop) = (w.mac_a, w.phone_a, h.coop);
    // a note Alice's Mac writes in the coop that her phone doesn't hold yet
    let notes = document("Notes", "Bring me first.", mac_a);
    let notes = w.lab.create(mac_a, coop, coop, "doc", &[], notes).expect("Notes");
    let mac = node(&mut w, mac_a, &[], 1).await;
    // her phone asks its peers only when told, as a page that reads its code off its device asks first
    let lazy = Options { lazy: true, ..Options::local() };
    let phone = Node::spawn(w.lab.split(phone_a, &[], [2; 32]), phone_a, lazy).await.expect("a node");
    phone.know(mac.addr());
    mac.know(phone.addr());
    until("the two meet", || async { phone.proven(mac.id()).is_some() }).await;
    let reads = move |lab: &Lab, me| text(lab, me, notes, 2).is_some();
    assert!(!phone.read(reads).await, "not asked for it yet");
    // the Mac told the phone what it holds: the phone lacks a log of it
    let told = || async { run(&phone, json!({ "op": "synced" })).await.expect("synced")["behind"] != 0 };
    until("the phone hears it is behind", told).await;
    let synced = run(&phone, json!({ "op": "synced" })).await.expect("synced");
    assert_eq!(synced["peers"], 1);
    assert!(synced["logs"].as_u64() > synced["behind"].as_u64(), "{synced}");
    let pages = synced["pages"].as_u64().expect("how many pages it took");
    // a bring of the coop: each device it knows asked at once, the Mac, the one it reaches, answers whole, and the
    // phone reads Notes
    let known = phone.read(|lab, me| lab.peers(me).len()).await;
    let brought = run(&phone, json!({ "op": "bring", "vaults": [coop.to_hex()] })).await.expect("brought");
    assert_eq!((&brought["peers"], &brought["reached"]), (&json!(known), &json!(true)), "{brought}");
    assert!(brought["new"].as_u64() > Some(0), "{brought}");
    assert!(phone.read(reads).await, "brought first");
    // the pages it took tell the bring moving, as a log counts only once whole
    let after = run(&phone, json!({ "op": "synced" })).await.expect("synced");
    assert!(after["pages"].as_u64() > Some(pages), "{after}");
    let caught = || async { run(&phone, json!({ "op": "synced" })).await.expect("synced")["behind"] == 0 };
    until("the phone is synced with its peer", caught).await;
    // where it synced from and how, as the Performance page reads it: its one peer, the Mac, over a direct path on a
    // local network, and the pages it took from it, each with the way it came
    let net = run(&phone, json!({ "op": "network" })).await.expect("network");
    let peers = net["peers"].as_array().expect("its peers");
    assert_eq!(peers.len(), 1, "{net}");
    assert_eq!(peers[0]["device"], json!(mac_a.to_hex()), "{net}");
    assert_eq!(peers[0]["lacks"], 0, "{net}");
    assert!(peers[0]["paths"].as_array().is_some_and(|p| p.iter().any(|x| x["selected"] == true)), "{net}");
    let pulled = &peers[0]["pulled"];
    assert!(pulled["pages"].as_u64() > Some(0) && pulled["bytes"].as_u64() > Some(0), "{net}");
    assert!(pulled["new"].as_u64() > Some(0), "{net}");
    let recent = net["recent"].as_array().expect("its newest pages");
    assert!(!recent.is_empty() && recent.iter().all(|r| r["device"] == json!(mac_a.to_hex())), "{net}");
    assert_eq!(net["me"]["endpoint"], json!(phone.addr().id.to_string()), "{net}");
    // a bring names 1 to 64 vaults, each by its id
    for bad in [json!({ "op": "bring", "vaults": [] }), json!({ "op": "bring", "vaults": ["coop"] })] {
        assert_eq!(run(&phone, bad).await.expect_err("refused")["refused"], "BadOp");
    }
    for n in [&mac, &phone] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_removal_waits_until_its_device_holds_what_its_peers_hold() {
    let mut w = world();
    let (mac_a, phone_a, alice, bob) = (w.mac_a, w.phone_a, w.alice, w.bob);
    let plan = w.lab.create(mac_a, alice, alice, "doc", &[], document("Plan", "Bob reads it.", mac_a)).expect("Plan");
    let read = w.lab.issue(mac_a, &[mac_a], share(alice, vault(bob), Level::Read, by_id(plan))).expect("Bob reads it");
    w.lab.sync_all(0);
    // her Mac writes on, which her phone doesn't hold yet
    let later = document("Later", "Her phone hasn't seen me.", mac_a);
    let later = w.lab.create(mac_a, alice, alice, "doc", &[], later).expect("Later");
    let phone = node(&mut w, phone_a, &[], 2).await;
    let end = json!({ "op": "revoke", "share": read.to_hex() });
    let live = move |lab: &Lab, me| lab.state(me).live(read);
    // her phone knows her Mac holds her vault, and reaches it not: the removal is refused, saying what to do
    let refused = run(&phone, end.clone()).await.expect_err("refused while it can't catch up");
    assert_eq!(refused["refused"], "Behind", "{refused}");
    assert!(refused["why"].as_str().is_some_and(|w| w.starts_with("Sync first")), "{refused}");
    assert!(phone.read(live).await, "Bob still reads it");
    // a removal that names an owner or a device waits alike; a change that removes nothing doesn't
    let device = json!({ "op": "revoke", "vault": alice.to_hex(), "device": mac_a.to_hex() });
    assert_eq!(run(&phone, device).await.expect_err("refused")["refused"], "Behind");
    let card = run(&phone, json!({ "op": "card", "name": "Her phone" })).await;
    assert!(card.is_ok(), "{card:?}");
    // her Mac comes online: the phone catches up with it first, then the removal goes through
    let mac = node(&mut w, mac_a, &[], 1).await;
    phone.know(mac.addr());
    mac.know(phone.addr());
    let made = run(&phone, end).await.expect("made once it caught up");
    assert!(made["edit"].is_string(), "{made}");
    assert!(!phone.read(live).await, "Bob's share ended");
    let holds = move |lab: &Lab, me| text(lab, me, later, 2).is_some();
    assert!(phone.read(holds).await, "it took what her Mac wrote before it removed anything");
    for n in [&mac, &phone] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_panic_in_one_call_fails_that_call_alone_and_the_node_runs_on() {
    let mut w = world();
    let mac_a = w.mac_a;
    let mac = std::sync::Arc::new(node(&mut w, mac_a, &[], 1).await);
    let failing = mac.clone();
    let failed = tokio::spawn(async move { failing.act(|_, _| -> () { panic!("a bug in one call") }).await }).await;
    assert!(failed.expect_err("that call fails").is_panic());
    // every later call runs, reads and changes alike
    assert!(run(&mac, json!({ "op": "world" })).await.is_ok(), "it reads on");
    let card = run(&mac, json!({ "op": "card", "name": "Her Mac" })).await;
    assert!(card.is_ok(), "it changes on: {card:?}");
    mac.shutdown().await.expect("the node shuts down");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn view_interests_are_revisioned_local_metadata_and_never_a_vault_edit() {
    let mut w = world();
    let me = w.mac_a;
    let n = node(&mut w, me, &[], 211).await;
    let before = n.read(|lab, me| lab.log(me).ids().to_vec()).await;
    let scope = "a".repeat(32);
    let entry = "b".repeat(64);
    let rooms = json!({"types": ["room"]});
    let first = n.op(json!({"op": "interest", "scope": scope, "revision": 1,
        "wants": [{"tier": "now", "entries": [entry]}, {"tier": "next", "queries": [rooms]}]})).await.unwrap();
    assert_eq!(first["ok"]["accepted"], true);
    assert!(first["ok"].get("lease_ms").is_none(), "an interest has no lease: its view's unmount clears it");
    let clear = n.op(json!({"op": "interest", "scope": scope, "revision": 3, "wants": []})).await.unwrap();
    assert_eq!(clear["ok"]["accepted"], true);
    let late = n.op(json!({"op": "interest", "scope": scope, "revision": 2, "wants": [{"tier": "now", "entries": [entry]}]})).await.unwrap();
    assert_eq!(late["ok"]["accepted"], false, "a cleared view stays cleared");
    // the op before it, for one release: one Interest on screen now
    let old = n.op(json!({"op": "demand", "scope": "c".repeat(32), "revision": 1, "entries": [entry]})).await.unwrap();
    assert_eq!(old["ok"]["accepted"], true);
    let released = n.op(json!({"op": "interest", "release": "all"})).await.unwrap();
    assert_eq!(released["ok"]["released"], 1);
    for invalid in [
        json!({"op": "interest", "scope": "bad", "revision": 4, "wants": []}),
        json!({"op": "interest", "scope": scope, "revision": 0, "wants": []}),
        json!({"op": "interest", "scope": scope, "revision": 4, "wants": [{"tier": "soon"}]}),
        json!({"op": "interest", "scope": scope, "revision": 4, "wants": [{"tier": "now", "entries": ["bad"]}]}),
        json!({"op": "interest", "scope": scope, "revision": 4, "wants": [{"tier": "now", "entries": vec![entry.clone(); 513]}]}),
        json!({"op": "interest", "scope": scope, "revision": 4, "wants": [{"tier": "now", "where": {}}]}),
        json!({"op": "demand", "scope": scope, "revision": 4, "entries": ["bad"]}),
    ] {
        let got = n.op(invalid.clone()).await.unwrap();
        assert_eq!(got["refused"], "BadOp", "{invalid}");
    }
    assert_eq!(n.read(|lab, me| lab.log(me).ids().to_vec()).await, before);
    n.shutdown().await.unwrap();
}
