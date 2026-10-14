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
    assert_eq!((&seen["mine"], &seen["ownsAven"]), (&json!(alice.to_hex()), &json!(true)));
    // new vaults: without a ceremony the op answers its draft and makes nothing; with one, they are made
    let found = json!({ "op": "found", "vaults": [{ "kind": "aven", "name": "avenALICE" },
        { "kind": "coop", "name": "Maia City COOP" }] });
    let asked = run(&mac, found.clone()).await.expect_err("it waits for her passkey");
    assert_eq!(asked["approve"]["signers"], json!([passkey.to_hex()]));
    let vaults = mac.read(|lab, me| lab.state(me).vaults().len()).await;
    let made = signed(&mac, found, &alices).await.expect("two vaults");
    assert_eq!(alices.steps(), [Step::Approve], "one ceremony for both");
    let ids: Vec<VaultId> = made["vaults"].as_array().expect("the vaults").iter().map(vault_id).collect();
    let [x, coop] = ids[..] else { panic!("two vaults: {made}") };
    assert_eq!(mac.read(|lab, me| lab.state(me).vaults().len()).await, vaults + 2);
    // owner of everything: the coop a co-owner of avenALICE, in a ceremony
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
    let chunks: Vec<io::Result<Bytes>> = film.chunks(1 << 16).map(|c| Ok(Bytes::copy_from_slice(c))).collect();
    let op = json!({ "op": "put_file", "vault": alice.to_hex(), "name": "Harvest.mp4", "media": "video/mp4",
        "tags": [], "len": len });
    let (made, none) = mac.run(op, Some(stream::iter(chunks)), None::<&NoCeremony>).await.expect("an answer");
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
    let untouched = stream::poll_fn(|_: &mut Context<'_>| -> Poll<Option<io::Result<Bytes>>> { panic!("a byte read") });
    let (answer, _) = mac.run(theirs, Some(Box::pin(untouched)), None::<&NoCeremony>).await.expect("an answer");
    assert_eq!(answer["refused"], "NoCap");
    // bytes fewer than its length: no answer comes
    let short = json!({ "op": "put_file", "vault": alice.to_hex(), "name": "Short", "len": 10 });
    let few = stream::iter([Ok::<_, io::Error>(Bytes::from_static(b"four"))]);
    assert!(mac.run(short, Some(few), None::<&NoCeremony>).await.is_err(), "the file ends early");
    let bare = json!({ "op": "put_file", "vault": alice.to_hex(), "name": "Bare", "len": 1 });
    assert!(mac.op(bare).await.is_err(), "a put_file brings its bytes");
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
