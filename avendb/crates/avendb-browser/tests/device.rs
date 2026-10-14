//! A browser's device, run natively (P8d, P8e): its person's passkey stays in the browser's authenticator, a software
//! passkey here, which makes each ceremony the device asks for. Eve's first browser founds her vault through the relay,
//! open to sign-up, with the passkey she signed up to maiaCITY with, and the server learns it; her second browser
//! links through the first one's code, browser to browser; the first opens again from its shelf, following the vaults
//! it followed; with both lost, her passkey alone gets her vault back on a new browser, through the server. Alice's
//! browser links through the code her Mac shows and edits Welcome. The first person to found their vault through a new
//! server claims it from their first browser, in the same ceremony (P8f), and her vault founds four more vaults it owns
//! in one more ceremony: her browser acts as each of them, and what each shares, a note by its id, its todos by their
//! type, or the whole of it, decides what the others may read and write. Her browser brings a film into her vault, a
//! megabyte at a time, and her Mac reads any range of it. Every device, the server too, trusts no curve: only the
//! writes a checkpoint covers count.
//!
//! Every read and change goes through one entry point, as the page's does (V2, `Device::run`,
//! `docs/ARCHITECTURE.md` §8): a JSON op, answered done, refused, or, where the vault's owners approve it, signed in
//! the passkey's ceremony when one is at hand and else answered `approve`, which makes nothing. `tests/page.rs` runs
//! the same in Chromium, the passkey in its virtual authenticator.

use std::collections::BTreeMap;
use std::future::Future;
use std::io;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use avendb::cast::*;
use avendb::id::{BlobId, EntryId, SignerId, VaultId};
use avendb::keys::KeyFam;
use avendb::lab::Lab;
use avendb::policy::{Kind, Level, Principal};
use avendb::recovery::RecoveryKey;
use avendb::rules::ops_to_json;
use avendb::sealed::FileRoot;
use avendb::sign::{Ceremony, Passkey, device_salt};
use avendb::world;
use avendb_browser::{DELETED, Device, Fresh, Meta, Start, Unlock};
use avendb_net::{Admission, Authenticator, NoBytes, NoCeremony, Node, Offer, Options, Progress, Step, disk};
use avendb_server::Relay;
use bytes::Bytes;
use iroh::RelayUrl;
use n0_future::stream;
use serde_json::{Value, json};

/// A socket of the system's choosing on this machine.
const LOOPBACK: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 0);

/// A megabyte.
const MB: u64 = 1 << 20;

/// A browser's authenticator, holding its person's passkey: each ceremony it made, and what for.
struct Browser(Mutex<(Passkey, Vec<Step>)>);

impl Authenticator for Browser {
    async fn ceremony(&self, challenge: [u8; 32], step: Step) -> anyhow::Result<Ceremony> {
        let mut held = self.0.lock().expect("the authenticator");
        held.1.push(step);
        Ok(held.0.ceremony(challenge))
    }
}

impl Browser {
    fn new(passkey: Passkey) -> Browser {
        Browser(Mutex::new((passkey, vec![])))
    }

    /// The ceremony that unlocks the device whose salt ends in `nonce`, over `challenge`: a new device's
    /// (`Fresh::challenge`), or one of the page's.
    fn unlock(&self, nonce: [u8; 32], challenge: [u8; 32]) -> Unlock {
        let mut held = self.0.lock().expect("the authenticator");
        let device = held.0.prf(&device_salt(&nonce));
        Unlock { ceremony: held.0.ceremony(challenge), device }
    }

    /// A new device starting at `start`, its salt ending in `nonce`, as a page makes one: its own secret, and the
    /// ceremony that unlocks it, over the challenge that makes it its passkey's pass for the device.
    fn fresh(&self, start: &Start, nonce: [u8; 32]) -> (Fresh, Unlock) {
        let fresh = Fresh::new().expect("a new device's secret");
        let unlock = self.unlock(nonce, fresh.challenge(start.now));
        (fresh, unlock)
    }

    /// The ceremonies it made since it was last asked, by what for.
    fn steps(&self) -> Vec<Step> {
        std::mem::take(&mut self.0.lock().expect("the authenticator").1)
    }
}

/// Where a browser's device named `name` starts, through the relay at `url`, its randomness drawn from `seed`.
fn start(name: &str, url: &RelayUrl, seed: u8) -> Start {
    let (name, progress) = (name.into(), Progress::new());
    let (relay, recovery) = (url.clone(), None);
    Start { name, relay, entropy: [seed; 32], now: now(), direct: false, shelf: None, progress, recovery }
}

/// The same, on the shelf in folder `dir`, as a page's device keeps its in OPFS.
fn start_on(dir: &Path, name: &str, url: &RelayUrl, seed: u8) -> Start {
    Start { shelf: Some(disk::open(dir).expect("its shelf")), ..start(name, url, seed) }
}

/// A folder of its own in the system's temporary folder, removed with everything in it when dropped.
struct Folder(PathBuf);

impl Folder {
    fn new(name: &str) -> Folder {
        static MADE: AtomicU32 = AtomicU32::new(0);
        let n = MADE.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).expect("after 1970").subsec_nanos();
        let path = std::env::temp_dir().join(format!("avendb-browser-{name}-{}-{n}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&path).expect("a folder of its own");
        Folder(path)
    }
}

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Every file in folder `dir` and under it, by its path there, with its bytes.
fn files(dir: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let mut found = BTreeMap::new();
    let mut folders = vec![dir.to_path_buf()];
    while let Some(folder) = folders.pop() {
        for entry in std::fs::read_dir(&folder).expect("a folder") {
            let path = entry.expect("an entry").path();
            if path.is_dir() {
                folders.push(path);
            } else {
                let bytes = std::fs::read(&path).expect("a file");
                found.insert(path.strip_prefix(dir).expect("under it").to_path_buf(), bytes);
            }
        }
    }
    found
}

/// The steps a start marked, by name, once it is over: each with how long it took.
fn steps(progress: &Progress) -> Vec<&'static str> {
    progress.end();
    let steps = progress.steps();
    assert!(steps.over && steps.steps.iter().all(|s| s.took.is_some()), "every step over: {steps:?}");
    steps.steps.iter().map(|s| s.step).collect()
}

/// A new browser's device at `start` that founds its person's vault through the server whose code is `server`, as the
/// page's does (`PageDevice::found`): `browser` unlocks it, its salt ending in `nonce`, then signs the rest.
async fn found(
    start: Start,
    server: &Offer,
    p256: Option<[u8; 33]>,
    browser: &Browser,
    nonce: [u8; 32],
) -> anyhow::Result<Device> {
    let (fresh, unlock) = browser.fresh(&start, nonce);
    Device::found(start, server, p256, fresh, unlock, browser, true).await
}

/// A new browser's device at `start` that links through the device whose code is `offer`, as the page's does
/// (`PageDevice::link`): `browser` unlocks it, its salt ending in `nonce`, and that one ceremony signs its join too.
async fn link(start: Start, offer: &Offer, browser: &Browser, nonce: [u8; 32]) -> anyhow::Result<Device> {
    let (fresh, unlock) = browser.fresh(&start, nonce);
    Device::link(start, offer, fresh, unlock).await
}

/// A node for device `d`, split off `w`'s Lab with the keys of `with`, its randomness drawn from `seed`.
async fn node(w: &mut World, d: SignerId, with: &[SignerId], seed: u8, opts: Options) -> Node {
    Node::spawn(w.lab.split(d, with, [seed; 32]), d, opts).await.expect("a node")
}

/// The time by this machine's clock: seconds since 1970.
fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).expect("after 1970").as_secs()
}

/// Waits until `check` holds, 60 seconds at most.
async fn until<F: Future<Output = bool>>(what: &str, mut check: impl FnMut() -> F) {
    let end = Instant::now() + Duration::from_secs(60);
    while !check().await {
        assert!(Instant::now() < end, "{what}, within 60 s");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Op `op` of the ops engine run on device `d` as the page runs it (`Device::run`), with no ceremony at hand: what it
/// did, or its answer whole: a refusal, or `approve` for what the vault's owners approve.
async fn run(d: &Device, op: Value) -> Result<Value, Value> {
    let (out, _) = d.run(op, None::<NoBytes>, None::<&NoCeremony>).await.expect("an answer");
    out.get("ok").cloned().ok_or(out)
}

/// The same, with `browser`'s passkey at hand for a ceremony, as the page passes its own.
async fn signed(d: &Device, op: Value, browser: &Browser) -> Result<Value, Value> {
    let (out, _) = d.run(op, None::<NoBytes>, Some(browser)).await.expect("an answer");
    out.get("ok").cloned().ok_or(out)
}

/// The world device `d` shows (the `world` op), `null` while it belongs to no vault.
async fn world_of(d: &Device) -> Value {
    run(d, json!({ "op": "world" })).await.expect("its world")
}

/// Vault `v` in the world `w` a device shows.
fn shown(w: &Value, v: VaultId) -> &Value {
    let vaults = w["vaults"].as_array().expect("its vaults");
    vaults.iter().find(|x| x["id"] == v.to_hex()).unwrap_or_else(|| panic!("vault {} in the world", v.to_hex()))
}

/// The names of its person's devices as device `d` shows them, each on its card, or "?" for one that wrote none yet.
async fn names(d: &Device) -> Vec<String> {
    let w = world_of(d).await;
    let Some(mine) = w["mine"].as_str().and_then(VaultId::from_hex) else { return vec![] };
    let devices = shown(&w, mine)["devices"].as_array().cloned().unwrap_or_default();
    devices.iter().map(|d| d["name"].as_str().unwrap_or("?").to_string()).collect()
}

/// The entry an op made.
fn entry(out: Value) -> EntryId {
    EntryId::from_hex(out["entry"].as_str().expect("the entry it made")).expect("an entry's id")
}

/// A note as the page writes one: a document titled `title`, its heading (block 1) the title too, then a paragraph
/// (block 2) that reads `text`.
fn titled(title: &str, text: &str) -> Value {
    json!({ "kind": "document", "title": title, "blocks": [
        { "id": 1, "type": "heading", "level": 1, "text": title },
        { "id": 2, "type": "paragraph", "text": text },
    ] })
}

/// Device `d` writes note `note`, tagged `tags`, into vault `vault`, acting for vault `actor`: its entry.
async fn write_note(d: &Device, actor: VaultId, vault: VaultId, note: Value, tags: &[&str]) -> Result<EntryId, Value> {
    let (actor, vault) = (actor.to_hex(), vault.to_hex());
    let op = json!({ "op": "create", "as": actor, "vault": vault, "type": "note", "tags": tags, "value": note });
    run(d, op).await.map(entry)
}

/// The op that sets the text of block `block` of entry `e` on its line `line` (the main line: `None`), acting for vault
/// `actor`.
fn set_text(actor: VaultId, e: EntryId, line: Option<&str>, block: u64, text: &str) -> Value {
    let path = json!(["blocks", { "id": block }, "text"]);
    json!({ "op": "set", "as": actor.to_hex(), "entry": e.to_hex(), "line": line, "path": path, "value": text })
}

/// Whether device `d` reads `body` in block 2 of entry `e`.
async fn shows(d: &Device, e: EntryId, body: &str) -> bool {
    let Ok(row) = run(d, json!({ "op": "get", "entry": e.to_hex() })).await else { return false };
    row["record"]["blocks"].as_array().is_some_and(|bs| bs.iter().any(|b| b["id"] == 2 && b["text"] == body))
}

/// The titles of the notes device `d` reads, in the order it took them.
async fn titles(d: &Device) -> Vec<String> {
    let notes = json!({ "op": "query", "where": { "type": ["note"] }, "select": ["title"] });
    let rows = run(d, notes).await.expect("its notes")["rows"].as_array().cloned().unwrap_or_default();
    rows.iter().map(|r| r["record"]["title"].as_str().unwrap_or_default().to_string()).collect()
}

/// The op that writes device `d`'s card, its name.
fn card(name: &str) -> Value {
    json!({ "op": "card", "name": name })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn eves_first_browser_founds_her_vault_her_second_links_through_it_and_the_first_opens_again() {
    let admission = Admission::open();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url: RelayUrl = relay.url();
    let mut w = world();
    let (server_d, avenceo) = (w.server, w.avenceo);
    let opts = Options { relay: Some(url.clone()), admission: Some(admission.clone()), card: true, ..Options::local() };
    let server = node(&mut w, server_d, &[], 2, opts).await;
    // Eve is new to avenDB, but signed up to maiaCITY with her passkey: her first browser founds her vault with it
    let eve = Browser::new(Passkey::from_seed([5; 32]));
    let p256 = eve.0.lock().expect("the authenticator").0.public();
    let shelf = Folder::new("first");
    let first = start_on(&shelf.0, "Eve's browser", &url, 7);
    let shown_steps = first.progress.clone();
    let first = found(first, &server.offer(), None, &eve, [1; 32]).await.expect("her vault");
    let meta = first.meta([1; 32], "ZXZl".into());
    first.keep(&meta).await.expect("what opens it again, on its shelf");
    assert_eq!(eve.steps(), [Step::Found], "after the unlock, one ceremony for her vault and her browser");
    let founding = ["keys", "node", "relay", "server", "draft", "sign", "settle"];
    assert_eq!(steps(&shown_steps), founding, "each step shown as it went, no claim as Alice's vault owns the server");
    assert_eq!(first.p256(), p256, "it learned her passkey's key: the one of the unlock's the second verifies under");
    assert!(first.node().endpoint().bound_sockets().is_empty(), "with no UDP of its own");
    let vault = first.vault().await.expect("the browser belongs to her vault");
    let seen = world_of(&first).await;
    assert_eq!(seen["ownsAven"], false, "avenCEO is Alice's vault's, which claimed the server before Eve");
    until("the server learns her browser from what it relays", || async { admission.admits(&first.node().id()) }).await;
    assert!(titles(&first).await.is_empty(), "no note yet: her browser's card is none");
    // her vault, her passkey its root, and her browser, by the name on its card
    let mine = shown(&seen, vault);
    assert_eq!((&mine["kind"], &mine["root"]), (&json!("human"), &json!(first.passkey().to_hex())));
    let me = json!({ "id": first.node().device().to_hex(), "name": "Eve's browser", "me": true });
    assert_eq!(mine["devices"], json!([me]));
    let note = write_note(&first, vault, vault, titled("Seeds", "Tomatoes in March."), &[]).await.expect("a note");
    let holds = move |lab: &Lab, me| lab.fetched(me, note) > 0;
    until("the server keeps her note", || server.read(holds)).await;
    // her second browser links through the first one's code, in one ceremony: the unlock, which signs its join too
    let other_browser = start("Eve's other browser", &url, 8);
    let code = first.node().offer();
    let other_browser = link(other_browser, &code, &eve, [2; 32]).await.expect("it links through the first");
    assert!(eve.steps().is_empty(), "no ceremony but the unlock");
    assert_eq!((other_browser.vault().await, other_browser.p256()), (Some(vault), p256), "it learned her key");
    until("it reads her note", || shows(&other_browser, note, "Tomatoes in March.")).await;
    run(&other_browser, set_text(vault, note, None, 2, "Tomatoes in April.")).await.expect("it edits the note");
    until("the first reads the edit", || shows(&first, note, "Tomatoes in April.")).await;
    // the second writes its card, as it holds her vault's keys now; each shows both browsers by name
    let wrote = run(&other_browser, card("Eve's other browser")).await.expect("its card");
    assert_eq!(wrote, json!({ "wrote": true }), "it had none");
    let both = ["Eve's browser", "Eve's other browser"];
    until("the first shows both by name", || async { names(&first).await == both }).await;
    assert_eq!(names(&other_browser).await, both);
    // a card renames its device; the notes never show one
    assert_eq!(run(&first, card("Eve's Mac")).await, Ok(json!({ "wrote": true })), "a new name");
    assert_eq!(run(&first, card("Eve's Mac")).await, Ok(json!({ "wrote": false })), "nothing to write");
    let renamed = ["Eve's Mac", "Eve's other browser"];
    until("the second shows the new name", || async { names(&other_browser).await == renamed }).await;
    assert_eq!(titles(&other_browser).await, ["Seeds"]);
    // it follows avenCEO from now on: it keeps that on its shelf, in what opens it again
    let follow = json!({ "op": "follow", "vault": avenceo.to_hex(), "on": true });
    assert_eq!(run(&first, follow).await, Ok(json!({ "follow": [avenceo.to_hex()] })));
    let meta = Meta { follow: vec![avenceo], ..meta };
    // the first browser closes, its shelf holding all it holds, and opens again from its shelf in the unlock alone
    first.close().await.expect("it closes");
    let kept = files(&shelf.0);
    let page = [0xaa; 32];
    let on = disk::open(&shelf.0).expect("its shelf");
    assert_eq!(Meta::load(&on).await.expect("it reads"), Some(meta.clone()), "what opens it, as it kept it");
    // a mask other than its own unmasks another device's secret, and an unlock of another passkey opens nothing: each
    // fails before it touches the shelf
    let other = Meta { mask: [0; 32], ..meta.clone() };
    let unmasked = Device::open(start_on(&shelf.0, "Eve's browser", &url, 9), &other, eve.unlock([1; 32], page));
    assert!(unmasked.await.is_err(), "the PRF output alone is another device's secret");
    let mallory = Browser::new(Passkey::from_seed([6; 32]));
    let theirs = Device::open(start_on(&shelf.0, "Eve's browser", &url, 10), &meta, mallory.unlock([1; 32], page));
    assert!(theirs.await.is_err(), "not her passkey's ceremony");
    assert_eq!(files(&shelf.0), kept, "the shelf as it was");
    let again = start_on(&shelf.0, "Eve's browser", &url, 11);
    let shown_steps = again.progress.clone();
    let again = Device::open(again, &meta, eve.unlock([1; 32], page)).await.expect("it opens again");
    assert!(eve.steps().is_empty(), "with no ceremony but the unlock");
    assert_eq!(steps(&shown_steps), ["keys", "restore", "node", "check"]);
    assert_eq!(again.node().id(), first.node().id(), "the same device");
    let follows = again.node().read(|lab, me| lab.follows(me).to_vec()).await;
    assert_eq!(follows, [avenceo], "it follows what it followed");
    assert!(shows(&again, note, "Tomatoes in April.").await, "it reads what its shelf kept");
    assert_eq!(names(&again).await, renamed, "and both cards");
    run(&other_browser, set_text(vault, note, None, 2, "Tomatoes in May.")).await.expect("another edit");
    let may = || shows(&again, note, "Tomatoes in May.");
    until("the relay lets it in again, as the server knows it", may).await;
    // with both her browsers lost, her passkey alone gets her vault back on a new one, through the server (P8c)
    for n in [again.node(), other_browser.node()] {
        n.shutdown().await.expect("the node shuts down");
    }
    let new = start("Eve's new browser", &url, 11);
    let shown_steps = new.progress.clone();
    let new = link(new, &server.offer(), &eve, [3; 32]).await.expect("it links through the server");
    assert!(eve.steps().is_empty(), "no ceremony but the unlock");
    assert_eq!(steps(&shown_steps), ["keys", "node", "relay", "server", "pass", "vault", "join", "sync"]);
    assert_eq!(new.vault().await, Some(vault), "to her vault");
    until("it reads her note", || shows(&new, note, "Tomatoes in May.")).await;
    assert_eq!(run(&new, card("Eve's new browser")).await, Ok(json!({ "wrote": true })));
    assert_eq!(names(&new).await, ["Eve's Mac", "Eve's other browser", "Eve's new browser"]);
    let opens = move |lab: &Lab, me| lab.opens(me, KeyFam::Seed(vault)) || lab.reads(me, note);
    assert!(!server.read(opens).await, "the server, which handed over her vault's log, opens none of its keys");
    for n in [new.node(), &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn alices_browsers_link_through_her_mac_and_each_other_through_the_relay_alone() {
    let admission = Admission::default();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url: RelayUrl = relay.url();
    let mut w = world();
    let h = handbook(&mut w);
    let secret = w.lab.passkey_secret(w.passkey_a).expect("Alice's passkey, a software passkey");
    let (mac_a, server_d, alice) = (w.mac_a, w.server, w.alice);
    let opts = Options { relay: Some(url.clone()), admission: Some(admission.clone()), ..Options::local() };
    let server = node(&mut w, server_d, &[], 2, opts).await;
    let mac = node(&mut w, mac_a, &[], 1, Options { relay: Some(url.clone()), ..Options::local() }).await;
    mac.know(server.addr());
    until("the relay serves Alice's Mac", || async { relay.serves(&mac.id()) }).await;
    // Alice's browser: her passkey, a name, the relay; its keys are its own
    let alices = Browser::new(Passkey::from_seed(*secret));
    let code = mac.offer();
    let browser = link(start("Alice's browser", &url, 7), &code, &alices, [1; 32]);
    let browser = browser.await.expect("it links through the Mac's code");
    assert!(alices.steps().is_empty(), "no ceremony but the unlock");
    assert_eq!(browser.vault().await, Some(alice));
    let (coop, welcome) = (h.coop, h.welcome);
    until("it reads Welcome", || shows(&browser, welcome, WELCOME_TEXT)).await;
    run(&browser, set_text(coop, welcome, None, 2, AFTER_TEXT)).await.expect("it edits Welcome");
    let reads = move |lab: &Lab, me| text(lab, me, welcome, 2).as_deref() == Some(AFTER_TEXT);
    until("the Mac reads its edit", || mac.read(reads)).await;
    until("once it joined, the server knows it", || async { admission.admits(&browser.node().id()) }).await;
    // her other browser links through the first one's code: browser to browser
    let other = start("Alice's other browser", &url, 8);
    let code = browser.node().offer();
    let other = link(other, &code, &alices, [2; 32]).await.expect("it links through the browser's code");
    assert_eq!(other.vault().await, Some(alice));
    until("it reads the edit", || shows(&other, welcome, AFTER_TEXT)).await;
    assert_eq!(browser.node().proven(other.node().id()), Some(other.node().device()), "through the first browser");
    let both = move |lab: &Lab, me| lab.state(me).vault(alice).map(|v| v.devices.len()) == Some(4);
    until("the Mac counts both browsers among Alice's devices", || mac.read(both)).await;
    // an edit its view refuses fails: Alice's own vault, acting as itself and not for the coop, holds no share on
    // Welcome
    let refused = run(&browser, set_text(alice, welcome, None, 2, "Alice's own words")).await;
    assert_eq!(refused.expect_err("refused")["refused"], "NoCap");
    for n in [browser.node(), other.node(), &mac, &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_first_person_to_found_their_vault_through_a_new_server_owns_it() {
    let admission = Admission::default();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url: RelayUrl = relay.url();
    // a new server, nobody's yet, its sign-up closed: it honours any passkey's pass until it is claimed
    let mut lab = Lab::with_entropy([3; 32]);
    let me = lab.device_with("the server", [7; 32]);
    let (relay, admits) = (Some(url.clone()), Some(admission.clone()));
    let opts = Options { relay, admission: admits, card: true, ..Options::local() };
    let server = Node::spawn(lab, me, opts).await.expect("the server's node");
    // Eve comes first: her first browser makes her passkey, whose public key info shows its P-256 key, then founds her
    // vault, adds itself to it and claims the server, all in one ceremony after the unlock; and her vault has the
    // master recovery key her browser adds among its owners, by the key's standing consent
    let eve = Browser::new(Passkey::from_seed([5; 32]));
    let p256 = eve.0.lock().expect("the authenticator").0.public();
    let master = Arc::new(RecoveryKey::of([11; 32]));
    let mut first = start("Eve's browser", &url, 7);
    first.recovery = Some(master.clone());
    let shown_steps = first.progress.clone();
    let first = found(first, &server.offer(), Some(p256), &eve, [1; 32]).await.expect("her vault claims the server");
    assert_eq!(eve.steps(), [Step::Found], "one ceremony for her vault, her browser and the claim");
    let claiming = ["keys", "node", "relay", "server", "draft", "sign", "claim", "settle"];
    assert_eq!(steps(&shown_steps), claiming, "the claim a step of its own");
    let vault = first.vault().await.expect("her vault");
    let avenceo = server.read(|lab, me| lab.vault_of(me)).await.expect("the server is avenCEO's device");
    let shape = move |lab: &Lab, _| {
        let st = lab.state(me);
        st.vault(avenceo).map(|v| (v.kind, world::seeded(st, vault, avenceo)))
    };
    let seeded = Some((Kind::Aven, true));
    assert_eq!(server.read(shape).await, seeded, "the CEO Aven of her seed, owned through Maia Holding, avenCEO GmbH");
    // her phone shares her passkey and sets up too: the server knows her vault, so the phone joins it, in the unlock
    // alone, and founds nothing; still one vault her passkey roots, the one that owns her seed
    let phone = start("Eve's phone", &url, 8);
    let joined = phone.progress.clone();
    let phone = found(phone, &server.offer(), Some(p256), &eve, [2; 32]).await.expect("her phone in her vault");
    assert_eq!(phone.vault().await, Some(vault), "her one vault");
    assert_eq!(eve.steps(), [], "no ceremony past the unlock");
    let rooted = ["keys", "node", "relay", "server", "pass", "vault", "join", "sync"];
    assert_eq!(steps(&joined), rooted, "it signs in as a link does");
    let passkey = Passkey::from_seed([5; 32]).id();
    let roots = move |lab: &Lab, _| lab.state(me).vaults().iter().filter(|v| v.root == Some(passkey)).count();
    assert_eq!(server.read(roots).await, 1, "one vault her passkey roots");
    until("her phone acts for her seed too", || async { world_of(&phone).await["ownsAven"] == true }).await;
    // her browser gives avenCEO GmbH avenDB's own schemas and lenses, as her page does once her seed is there: each an
    // entry of avenCEO GmbH's of the very bytes the app ships, so of the same id, shared with Everyone
    let gmbh = move |lab: &Lab, _| match lab.state(me).vault(avenceo)?.owners[..] {
        [Principal::Vault(v)] => Some(v.to_hex()),
        _ => None,
    };
    let company = server.read(gmbh).await.expect("avenCEO GmbH owns her CEO Aven");
    let database = json!({ "op": "database", "vault": company });
    let standard = run(&first, database.clone()).await.expect("its database")["builtIn"].clone();
    for (ty, list) in [("schema", "schemas"), ("lens", "lenses")] {
        for x in standard[list].as_array().expect("the app's own") {
            let op = json!({ "op": "create", "vault": company, "type": ty, "value": x["json"], "as": company });
            run(&first, op).await.expect("an entry of avenCEO GmbH's");
        }
    }
    let ids = |xs: &Value| -> Vec<String> {
        let ids = xs.as_array().into_iter().flatten().filter_map(|x| x["id"].as_str());
        let mut ids: Vec<String> = ids.map(String::from).collect();
        ids.sort();
        ids
    };
    let held = run(&first, database).await.expect("its database");
    let both = (ids(&held["schemas"]), ids(&held["lenses"]));
    assert_eq!(both, (ids(&standard["schemas"]), ids(&standard["lenses"])), "the app's own, by their ids");
    assert_eq!(both.0.len(), 8);
    let public = |w: &Value| -> usize {
        let es = w["entries"].as_array().into_iter().flatten();
        es.filter(|e| e["vault"] == company.as_str() && e["kind"] == "schema" && e["public"] == true).count()
    };
    until("her phone reads them, each Public", || async { public(&world_of(&phone).await) == 8 }).await;
    let seen = world_of(&first).await;
    assert_eq!(seen["ownsAven"], true, "as her browser shows");
    let (hers, masters) = (Principal::Signer(Passkey::from_seed([5; 32]).id()), Principal::Signer(master.id()));
    let owners = move |lab: &Lab, _| lab.state(me).vault(vault).map(|v| v.owners.clone()).unwrap_or_default();
    assert_eq!(server.read(owners).await, [hers, masters], "the master key among her vault's owners");
    let rows = shown(&seen, vault)["owners"].as_array().expect("its owners").clone();
    let marks: Vec<Value> = rows.iter().map(|o| o["recovery"].clone()).collect();
    assert_eq!((seen["recovery"].clone(), marks), (json!(master.id().to_hex()), vec![json!(false), json!(true)]));
    // she removes it like any owner, and adds it again (the Owners screen's ops), a ceremony each; it is an owner once
    let key = json!({ "signer": master.id().to_hex() });
    let remove = json!({ "op": "revoke", "vault": vault.to_hex(), "owner": key });
    let asked = run(&first, remove.clone()).await.expect_err("her passkey approves it");
    assert_eq!(asked["approve"]["signers"], json!([first.passkey().to_hex()]), "{asked}");
    assert_eq!(eve.steps(), [], "without a ceremony at hand, nothing is made and none asked");
    signed(&first, remove, &eve).await.expect("the master key removed");
    until("the server sees it removed", || async { server.read(owners).await == [hers] }).await;
    let add = json!({ "op": "share", "over": vault.to_hex(), "who": key, "level": "Owner", "what": "everything" });
    let asked = run(&first, json!({ "op": "may", "ops": [add] })).await.expect("an answer");
    let signers = json!([first.passkey().to_hex(), master.id().to_hex()]);
    assert_eq!(asked, json!([{ "approve": { "signers": signers } }]), "the key signs by its standing consent");
    signed(&first, add.clone(), &eve).await.expect("the master key added again");
    let again = signed(&first, add, &eve).await;
    assert_eq!(again.expect_err("refused")["refused"], "AlreadyMember", "it is an owner already");
    assert_eq!(eve.steps(), [Step::Approve, Step::Approve], "no ceremony for what the vault refuses");
    until("the server sees it back", || async { server.read(owners).await == [hers, masters] }).await;
    // her vault gives avenCEO relay on the whole of it: the server keeps her note and knows her browser for good
    let note = write_note(&first, vault, vault, titled("Seeds", "Tomatoes in March."), &[]).await.expect("a note");
    let holds = move |lab: &Lab, me| lab.fetched(me, note) > 0;
    until("the server keeps her note", || server.read(holds)).await;
    until("and knows her browser", || async { admission.admits(&first.node().id()) }).await;
    let stranger = Passkey::from_seed([9; 32]).id();
    assert!(!admission.honours(&stranger), "claimed, its relay honours no stranger's pass");
    // avenCEO GmbH holds the content flow and a function of it, as her page adds them, and shares its flows and
    // functions with Everyone by their type, no ceremony
    let stage = |id: u64, key: &str, public: bool, next: &[&str]| {
        json!({ "id": id, "key": key, "name": key, "public": public, "next": next, "x": id - 1, "y": 0 })
    };
    let stages = [
        stage(1, "idea", false, &["draft"]),
        stage(2, "draft", false, &["published"]),
        stage(3, "published", true, &[]),
    ];
    let flow = json!({ "kind": "flow", "key": "content", "name": "Content", "about": "", "types": ["article"],
        "stages": stages, "tags": [] });
    let code = "export function run(event) { return []; }";
    let function = json!({ "kind": "function", "name": "Publish to Maia Universe", "about": "", "on": "enter",
        "flow": "content", "stage": "published", "code": code, "enabled": true, "tags": [] });
    for (ty, value) in [("flow", flow), ("function", function)] {
        let op = json!({ "op": "create", "vault": company, "type": ty, "value": value, "as": company });
        run(&first, op).await.expect("an entry of avenCEO GmbH's");
    }
    let types = json!({ "type": ["flow", "function"] });
    let open = json!({ "op": "share", "over": company, "who": "everyone", "level": "Public", "what": types,
        "as": company });
    run(&first, open).await.expect("its flows and functions Public, no ceremony");
    let seen = world_of(&first).await;
    let records = seen["entries"].as_array().expect("its entries").iter().filter(|e| e["vault"] == company.as_str());
    let records: Vec<&Value> = records.filter(|e| e["kind"] == "record").collect();
    let fields = |e: &Value| (e["type"].clone(), e["public"].clone(), e["record"]["stages"][2]["public"].clone());
    let fields: Vec<_> = records.iter().map(|e| fields(e)).collect();
    let both = [(json!("flow"), json!(true), json!(true)), (json!("function"), json!(true), Value::Null)];
    assert_eq!(fields, both, "{records:?}");
    // her article goes from idea to published, as the content flow moves it: the Public share of her vault on the
    // stage's tag, the tag swapped, and the post its function asks for, carrying that tag too; the server keeps the
    // post and opens it, as everyone may
    let her = vault.to_hex();
    let value = json!({ "kind": "article", "title": "Seeds", "text": "Tomatoes in **March**.", "tags": [] });
    let tags = json!(["content:idea"]);
    let op = json!({ "op": "create", "vault": her, "type": "article", "tags": tags, "value": value, "as": her });
    let article = entry(run(&first, op).await.expect("her article"));
    assert_eq!(item(&world_of(&first).await, article)["public"], false, "an idea is hers alone");
    let tag = json!({ "tag": "content:published" });
    let public = json!({ "op": "share", "over": her, "who": "everyone", "level": "Public", "what": tag, "as": her });
    run(&first, public).await.expect("published is everyone's");
    let (add, remove) = (json!(["content:published"]), json!(["content:idea"]));
    let moved = json!({ "op": "tag", "entry": article.to_hex(), "add": add, "remove": remove, "as": her });
    run(&first, moved).await.expect("moved to published");
    let value = json!({ "kind": "post", "title": "Seeds", "text": "Tomatoes in **March**.", "channel": "Devlog",
        "about": article.to_hex(), "tags": [] });
    let tags = json!(["content:published"]);
    let op = json!({ "op": "create", "vault": her, "type": "post", "tags": tags, "value": value, "as": her });
    let post = entry(run(&first, op).await.expect("its post"));
    let seen = world_of(&first).await;
    let (a, p) = (item(&seen, article), item(&seen, post));
    let looks = |e: &Value, what: &Value| (e["public"].clone(), e["kind"].clone(), what.clone());
    let published = (json!(true), json!("note"), json!(["content:published"]));
    assert_eq!(looks(a, &a["tags"]), published, "published, public");
    let about = (json!(true), json!("record"), json!(article.to_hex()));
    assert_eq!(looks(p, &p["record"]["about"]), about, "its post, a record about it, public too");
    let opens = move |lab: &Lab, me| lab.item(me, post).is_some_and(|i| i.record()["channel"] == "Devlog");
    until("the server keeps her post and opens it", || server.read(opens)).await;
    // avenCEO GmbH publishes too, its profile Public as it first does, so that everyone reads who published it; the
    // server, which keeps its seed's vaults, opens that post and that name as well: the Maia Universe's feed lists
    // both posts, newest first, each by its vault's name where everyone may read it
    let named = profile(&world_of(&first).await, VaultId::from_hex(&company).expect("a vault"));
    let named = json!({ "entry": [named.to_hex()] });
    for what in [json!({ "tag": "content:published" }), named] {
        let public = json!({ "op": "share", "over": company, "who": "everyone", "level": "Public", "what": what,
            "as": company });
        run(&first, public).await.expect("its published stage and its name everyone's too");
    }
    let value = json!({ "kind": "post", "title": "Flows", "text": "Articles go from an idea to published.",
        "channel": "Devlog", "tags": [] });
    let tags = json!(["content:published"]);
    let op = json!({ "op": "create", "vault": company, "type": "post", "tags": tags, "value": value, "as": company });
    let news = entry(run(&first, op).await.expect("its post"));
    let feed = move |lab: &Lab, me| -> Vec<(String, Option<String>)> {
        let posts = world::public_posts(lab, me).into_iter();
        let entry = |p: &Value| p["entry"].as_str().unwrap_or_default().to_string();
        posts.map(|p| (entry(&p), p["name"].as_str().map(String::from))).collect()
    };
    let mut both = vec![(news.to_hex(), Some("avenCEO GmbH".to_string())), (post.to_hex(), None)];
    both.sort();
    let listed = move |lab: &Lab, me| {
        let mut posts = feed(lab, me);
        posts.sort();
        posts
    };
    until("the server's feed lists both posts", || async { server.read(listed).await == both }).await;
    // back to a draft: untagged, it is hers alone again, and its post, untagged as its function asks, leaves the feed
    let (add, remove) = (json!(["content:draft"]), json!(["content:published"]));
    let back = json!({ "op": "tag", "entry": article.to_hex(), "add": add, "remove": remove, "as": her });
    run(&first, back).await.expect("back to a draft");
    assert_eq!(item(&world_of(&first).await, article)["public"], false, "a draft is hers alone");
    let off = json!({ "op": "tag", "entry": post.to_hex(), "remove": ["content:published"], "as": her });
    run(&first, off).await.expect("its post off the stream");
    let gmbh = vec![(news.to_hex(), Some("avenCEO GmbH".to_string()))];
    until("the server's feed lists avenCEO GmbH's alone", || async { server.read(listed).await == gmbh }).await;
    for n in [first.node(), &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// Entry `e` in the world `w` a device shows.
fn item(w: &Value, e: EntryId) -> &Value {
    let entries = w["entries"].as_array().expect("its entries");
    entries.iter().find(|i| i["entry"] == e.to_hex()).unwrap_or_else(|| panic!("entry {} in the world", e.to_hex()))
}

/// The level vault `v` holds on entry `it` a world shows, if any (its `roles`).
fn level(it: &Value, v: VaultId) -> Option<&str> {
    it["roles"][v.to_hex()].as_str()
}

/// Vault `v`'s name in the world `w` a device shows, as its profile reads.
fn named(w: &Value, v: VaultId) -> Option<&str> {
    shown(w, v)["name"].as_str()
}

/// Vault `v`'s profile in the world `w` a device shows.
fn profile(w: &Value, v: VaultId) -> EntryId {
    let entries = w["entries"].as_array().expect("its entries");
    let of = |i: &&Value| i["vault"] == v.to_hex() && i["type"] == "profile";
    entry(json!({ "entry": entries.iter().find(of).expect("its profile")["entry"] }))
}

/// How device `d` takes the edits of the audience entry `e` is in, as the world `w` a device shows: through which of
/// its vaults, with what level, and whether it opens them.
fn syncs(w: &Value, e: EntryId, d: SignerId) -> Option<(String, String, bool)> {
    let x = &item(w, e)["cell"];
    let cells = w["cells"].as_array().expect("its audiences");
    let audience = cells.iter().find(|c| &c["id"] == x).expect("its audience");
    let syncs = audience["syncs"].as_array().expect("who syncs it");
    let s = syncs.iter().find(|s| s["device"] == d.to_hex())?;
    let text = |v: &Value| v.as_str().unwrap_or_default().to_string();
    Some((text(&s["through"]), text(&s["role"]), s["opens"] == true))
}

/// A share op as the page sends it: vault `over` shared with `who`, a group `level` of ops, on what `what` picks,
/// acting for vault `actor`.
fn share(actor: VaultId, over: VaultId, who: Value, level: Value, what: &Value) -> Value {
    json!({ "op": "share", "as": actor.to_hex(), "over": over.to_hex(), "who": who, "level": level, "what": what })
}

fn to(v: VaultId) -> Value {
    json!({ "vault": v.to_hex() })
}

/// A share's id, as an op answers it.
fn share_id(out: Value) -> String {
    out["share"].as_str().expect("the share it issued").to_string()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_vaults_her_vault_owns_are_real_and_each_acts_by_its_own_shares() {
    let admission = Admission::default();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url: RelayUrl = relay.url();
    let mut lab = Lab::with_entropy([3; 32]);
    let me = lab.device_with("the server", [7; 32]);
    let (relay, admits) = (Some(url.clone()), Some(admission.clone()));
    let opts = Options { relay, admission: admits, card: true, ..Options::local() };
    let server = Node::spawn(lab, me, opts).await.expect("the server's node");
    let eve = Browser::new(Passkey::from_seed([5; 32]));
    let first = start("Eve's browser", &url, 7);
    let first = found(first, &server.offer(), None, &eve, [1; 32]).await.expect("her vault");
    eve.steps();
    let eve_v = first.vault().await.expect("her vault");
    let avenceo = server.read(|lab, me| lab.vault_of(me)).await.expect("the server is avenCEO's device");
    let w = world_of(&first).await;
    assert_eq!(w["mine"], eve_v.to_hex());
    // her seed: Maia Holding GmbH, which her vault owns, avenCEO GmbH, which Maia Holding owns, and the CEO Aven,
    // which avenCEO GmbH owns and the server is a device of
    let owner = |v: VaultId| shown(&w, v)["owners"][0]["vault"].as_str().and_then(VaultId::from_hex).expect("an owner");
    let gmbh = owner(avenceo);
    let holding = owner(gmbh);
    assert_eq!(owner(holding), eve_v, "her vault owns Maia Holding");
    let ids: Vec<&str> = w["vaults"].as_array().expect("its vaults").iter().filter_map(|v| v["id"].as_str()).collect();
    assert_eq!(ids, [eve_v.to_hex(), holding.to_hex(), gmbh.to_hex(), avenceo.to_hex()], "her vault and her seed");
    let via = json!([gmbh.to_hex(), holding.to_hex(), eve_v.to_hex()]);
    assert_eq!(shown(&w, avenceo)["via"], via, "her browser acts for the CEO Aven through its owners' owners");
    // her seed named from the start, by the founding itself; her vault's profile written by her browser with no
    // ceremony; the CEO Aven's entries are its own, which its server opens, while hers it only relays
    for (v, name) in [(holding, "Maia Holding GmbH"), (gmbh, "avenCEO GmbH"), (avenceo, "CEO Aven")] {
        assert_eq!(named(&w, v), Some(name), "{name} named as it was founded");
    }
    let profiled = |v: VaultId, name: &str| json!({ "op": "profile", "vault": v.to_hex(), "name": name });
    assert_eq!(signed(&first, profiled(eve_v, "Eve"), &eve).await, Ok(json!({ "wrote": true })));
    for (v, name) in [(holding, "Maia Holding GmbH"), (gmbh, "avenCEO GmbH"), (avenceo, "CEO Aven")] {
        assert_eq!(signed(&first, profiled(v, name), &eve).await, Ok(json!({ "wrote": false })), "{name}");
    }
    assert_eq!(signed(&first, profiled(eve_v, "Eve"), &eve).await, Ok(json!({ "wrote": false })), "it reads Eve");
    assert_eq!(eve.steps(), [], "no ceremony");
    let w = world_of(&first).await;
    assert_eq!((named(&w, eve_v), named(&w, avenceo)), (Some("Eve"), Some("CEO Aven")));
    let (eve_p, ceo_p) = (profile(&w, eve_v), profile(&w, avenceo));
    let (mine, srv) = (first.node().device(), server.device());
    let as_level = |v: VaultId, r: &str, opens: bool| Some((v.to_hex(), r.to_string(), opens));
    assert_eq!(syncs(&w, eve_p, srv), as_level(avenceo, "backup", false), "the server keeps her entries' ciphertext");
    assert_eq!(syncs(&w, eve_p, mine), as_level(eve_v, "owner", true));
    assert_eq!(syncs(&w, ceo_p, srv), as_level(avenceo, "owner", true), "avenCEO's own entries its server opens");
    // four vaults her vault owns, in one ceremony, each of which gives avenCEO relay on the whole of it: without a
    // ceremony at hand the op answers what the passkey would sign, and makes nothing
    let four = json!({ "op": "found", "vaults": [
        { "kind": "aven", "name": "avenALICE" },
        { "kind": "aven", "name": "avenBOB" },
        { "kind": "aven", "name": "avenCHARLY" },
        { "kind": "coop", "name": "Maia City COOP" },
    ] });
    let asked = run(&first, four.clone()).await.expect_err("it waits for her passkey");
    assert_eq!(asked["approve"]["signers"], json!([first.passkey().to_hex()]), "{asked}");
    assert_eq!(world_of(&first).await["vaults"].as_array().map(Vec::len), Some(4), "nothing made");
    let vaults = signed(&first, four, &eve).await.expect("four vaults")["vaults"].clone();
    assert_eq!(eve.steps(), [Step::Approve], "one ceremony for all four");
    let vaults: Vec<VaultId> =
        vaults.as_array().expect("four").iter().filter_map(|v| v.as_str().and_then(VaultId::from_hex)).collect();
    let [alice, bob, charly, coop] = vaults[..] else { panic!("four vaults: {vaults:?}") };
    let w = world_of(&first).await;
    assert_eq!(w["vaults"].as_array().map(Vec::len), Some(8));
    let made = [(alice, "aven", "avenALICE"), (bob, "aven", "avenBOB"), (coop, "coop", "Maia City COOP")];
    for (v, kind, name) in made {
        let x = shown(&w, v);
        assert_eq!((&x["kind"], &x["name"]), (&json!(kind), &json!(name)));
        assert_eq!((&x["owners"], &x["root"]), (&json!([to(eve_v)]), &Value::Null), "her vault owns it");
        assert_eq!(x["via"], json!([eve_v.to_hex()]), "her browser acts for it through her vault");
        let (srv_sees, mine_sees) = (syncs(&w, profile(&w, v), srv), syncs(&w, profile(&w, v), mine));
        assert_eq!(srv_sees, as_level(avenceo, "backup", false), "the server keeps its entries' ciphertext");
        assert_eq!(mine_sees, as_level(v, "owner", true), "her browser opens them, acting for it");
    }
    // avenALICE writes a note into her vault; avenBOB may not write there, nor read it
    let plan = titled("Plan", "Plant beans.");
    let note = write_note(&first, alice, alice, plan, &["garden"]).await.expect("a note");
    let w = world_of(&first).await;
    let it = item(&w, note);
    assert_eq!((&it["kind"], &it["title"], &it["text"]), (&json!("note"), &json!("Plan"), &json!("Plant beans.")));
    assert_eq!((&it["type"], &it["tags"]), (&json!("note"), &json!(["garden"])));
    assert_eq!((&it["vault"], &it["by"]), (&json!(alice.to_hex()), &json!(alice.to_hex())));
    assert_eq!((level(it, alice), level(it, bob), level(it, avenceo)), (Some("owner"), None, Some("backup")));
    assert_eq!(it["readers"][0], alice.to_hex(), "its own vault first");
    let refused = write_note(&first, bob, alice, titled("Mine", "Not here."), &[]).await;
    assert_eq!(refused.expect_err("refused")["refused"], "NoCap", "avenBOB holds no share on avenALICE's vault");
    let creatable = json!({ "op": "creatable", "vault": alice.to_hex(), "type": "note", "as": bob.to_hex() });
    assert_eq!(run(&first, creatable).await.expect_err("refused")["refused"], "NoCap", "as the page asks first");
    // she shares the note by its id with avenBOB to read, with no ceremony: her browser moves it to the audience of
    // that share, under a key of its own, which avenBOB reads; he can't edit it
    let (the_note, reads) = (json!({ "entry": [note.to_hex()] }), json!([{ "op": "read" }]));
    let by_note = share(alice, alice, to(bob), json!({ "name": "Plan", "ops": reads }), &the_note);
    assert_eq!(run(&first, json!({ "op": "may", "ops": [by_note] })).await, Ok(json!([true])));
    let read = share_id(run(&first, by_note).await.expect("shared"));
    let moved = || async {
        let w = world_of(&first).await;
        let it = item(&w, note);
        (level(it, bob), level(it, charly)) == (Some("read"), None)
    };
    until("the note moves to the audience avenBOB reads", moved).await;
    let edit = run(&first, set_text(bob, note, None, 2, "Plant peas.")).await;
    assert_eq!(edit.expect_err("refused")["refused"], "NoCap", "avenBOB only reads it");
    let refused = run(&first, share(charly, alice, to(charly), json!("Viewer"), &json!("everything"))).await;
    assert_eq!(refused.expect_err("refused")["refused"], "BadParent", "avenCHARLY gives itself nothing");
    // a note for everyone: the Public group, which reads alone, needs no ceremony; everyone writing is refused
    let notice = write_note(&first, alice, alice, titled("Notice", "Market on Saturday."), &[]).await.expect("a note");
    let the_notice = json!({ "entry": [notice.to_hex()] });
    run(&first, share(alice, alice, json!("everyone"), json!("Public"), &the_notice)).await.expect("public");
    let everyone = || async { item(&world_of(&first).await, notice)["public"] == true };
    until("everyone reads the notice", everyone).await;
    let sets = json!({ "name": "Everyone edits", "ops": [{ "op": "set", "path": [] }] });
    let refused = signed(&first, share(alice, alice, json!("everyone"), sets, &the_notice), &eve).await;
    assert_eq!(refused.expect_err("refused")["refused"], "PublicBeyondRead", "everyone only reads");
    assert_eq!(eve.steps(), [], "a share that doesn't make an owner needs no ceremony");
    // write on her todos, by their type, as an Editor: avenBOB adds a todo to her vault and closes it
    let todos = json!({ "type": ["todo"] });
    let write = share_id(run(&first, share(alice, alice, to(bob), json!("Editor"), &todos)).await.expect("write"));
    let (by, into) = (bob.to_hex(), alice.to_hex());
    let new_todo = |title: &str| {
        let value = json!({ "kind": "todo", "title": title });
        json!({ "op": "create", "as": by, "vault": into, "type": "todo", "value": value })
    };
    let todo = entry(run(&first, new_todo("Water the beans")).await.expect("avenBOB's todo"));
    let done = json!({ "op": "set", "as": by, "entry": todo.to_hex(), "path": ["status"], "value": "done" });
    run(&first, done).await.expect("avenBOB closes it");
    let w = world_of(&first).await;
    let it = item(&w, todo);
    assert_eq!((&it["kind"], &it["title"], &it["status"]), (&json!("todo"), &json!("Water the beans"), &json!("done")));
    assert_eq!((&it["vault"], &it["by"]), (&json!(alice.to_hex()), &json!(bob.to_hex())), "into her vault");
    // a share on her todos whose ops let avenCHARLY only tick them done: the page asks first which ops would be made
    // (may), and a write its ops don't allow is refused, as its readers wouldn't count it
    let value = json!({ "kind": "todo", "title": "Weed the beds" });
    let weed = json!({ "op": "create", "as": into, "vault": into, "type": "todo", "value": value });
    let weed = entry(run(&first, weed).await.expect("her own todo"));
    let tick = json!({ "op": "set", "path": ["status"], "to": ["done"] });
    let ticks = json!({ "name": "Tick done", "ops": [tick] });
    let ticks = share_id(run(&first, share(alice, alice, to(charly), ticks, &todos)).await.expect("ticks"));
    let reaches = || async { level(item(&world_of(&first).await, weed), charly) == Some("write") };
    until("her todo moves to the audience avenCHARLY writes", reaches).await;
    let (c, at) = (charly.to_hex(), weed.to_hex());
    let set = |path: &str, value: &str| json!({ "op": "set", "as": c, "entry": at, "path": [path], "value": value });
    let asked = run(&first, json!({ "op": "may", "ops": [set("status", "done"), set("title", "Dig")] })).await;
    let asked = asked.expect("an answer");
    assert_eq!((&asked[0], &asked[1]["refused"]), (&json!(true), &json!("NotAllowed")), "{asked}");
    let taggable = json!({ "op": "taggable", "entry": weed.to_hex(), "as": c });
    assert_eq!(run(&first, taggable).await, Ok(json!({ "tags": [] })), "its ops tag nothing");
    let refused = run(&first, set("title", "Dig")).await;
    assert_eq!(refused.expect_err("refused")["refused"], "NotAllowed", "her share lets avenCHARLY only tick it");
    run(&first, set("status", "done")).await.expect("avenCHARLY ticks it");
    let add = json!({ "op": "create", "vault": into, "type": "todo", "value": { "kind": "todo", "title": "Dig" } });
    let asked = run(&first, json!({ "op": "may", "as": c, "ops": [add] })).await.expect("an answer");
    assert_eq!(asked[0]["refused"], "NotAllowed", "nor do they let it add a todo: {asked}");
    let w = world_of(&first).await;
    assert_eq!((&item(&w, weed)["title"], &item(&w, weed)["status"]), (&json!("Weed the beds"), &json!("done")));
    let caps = w["caps"].as_array().expect("its shares");
    let shown_share = caps.iter().find(|c| c["id"] == ticks).expect("the share that ticks");
    let ops = json!([{ "op": "read" }, tick]);
    let slice = &shown_share["slice"];
    assert_eq!((&slice["name"], &slice["ops"]), (&json!("Tick done"), &ops), "the page reads its name and ops");
    assert_eq!((&shown_share["group"], &shown_share["whole"]), (&Value::Null, &json!(false)), "a group of its own");
    // a group of its own at owner level on the whole of her vault is refused before any ceremony: Owner of everything
    // makes a co-owner (WideOwner)
    let owners = json!({ "name": "All mine", "ops": ops_to_json(&Level::Owner.ops()) });
    let refused = signed(&first, share(alice, alice, to(coop), owners, &json!("everything")), &eve).await;
    assert_eq!(refused.expect_err("refused")["refused"], "WideOwner");
    assert_eq!(eve.steps(), []);
    // Owner of her todos for the coop is governance: may says her passkey approves it; without a ceremony the op
    // answers what it would sign and makes nothing; with one it is made
    let owner = share(alice, alice, to(coop), json!("Owner"), &todos);
    let asked = run(&first, json!({ "op": "may", "ops": [owner] })).await.expect("an answer");
    assert_eq!(asked, json!([{ "approve": { "signers": [first.passkey().to_hex()] } }]));
    let drafted = run(&first, owner.clone()).await.expect_err("it waits for her passkey");
    assert_eq!(drafted["approve"]["challenge"].as_str().map(str::len), Some(64), "{drafted}");
    assert_eq!(eve.steps(), [], "no ceremony asked");
    let owned_share = share_id(signed(&first, owner, &eve).await.expect("the coop owns her todos"));
    assert_eq!(eve.steps(), [Step::Approve]);
    let owned = || async {
        let w = world_of(&first).await;
        let it = item(&w, todo);
        (level(it, coop), level(it, bob)) == (Some("owner"), Some("write"))
    };
    until("avenBOB's todo moves to the audience the coop owns", owned).await;
    // the shares over her vault as the Sharing screen lists them, each with may of its revoke: the coop's owner share
    // first, which her passkey ends
    let listed = run(&first, json!({ "op": "shares", "over": alice.to_hex() })).await.expect("the shares");
    assert_eq!((&listed["as"], &listed["share"]), (&json!(alice.to_hex()), &json!(true)));
    let rows = listed["rows"].as_array().expect("its rows");
    let first_grant = rows.iter().find(|r| r["kind"] == "grant").expect("a grant");
    assert_eq!((&first_grant["id"], &first_grant["group"]), (&json!(owned_share), &json!("Owner")));
    assert_eq!(first_grant["revoke"], json!({ "approve": { "signers": [first.passkey().to_hex()] } }));
    // avenALICE takes avenBOB's write back: he writes no more there, and still reads the note
    let end = json!({ "op": "revoke", "share": write, "as": alice.to_hex() });
    signed(&first, end, &eve).await.expect("revoked");
    assert_eq!(eve.steps(), [], "a write share ends without a ceremony");
    let refused = run(&first, new_todo("Again")).await;
    assert_eq!(refused.expect_err("refused")["refused"], "NoCap");
    let w = world_of(&first).await;
    assert_eq!(level(item(&w, note), bob), Some("read"), "{read} stands");
    assert_eq!(w["vaults"][4]["name"], "avenALICE");
    let caps = w["caps"].as_array().expect("its shares");
    let shared = caps.iter().find(|c| c["id"] == read).expect("the read share");
    assert_eq!((&shared["role"], &shared["slice"]["where"]), (&json!("read"), &the_note), "the note by its id");
    let public = caps.iter().find(|c| c["grantee"] == "everyone").expect("the public share");
    assert_eq!((&public["slice"]["name"], &public["role"]), (&json!("Public"), &json!("read")));
    assert_eq!(public["group"], "Public");
    // the server keeps it all, counts the writes, each covered by a checkpoint, and opens none of avenALICE's keys
    let counts = move |lab: &Lab, me| lab.state(me).entry_writes(note).count() == 1;
    until("the server counts avenALICE's note", || server.read(counts)).await;
    let opens_none = move |lab: &Lab, me| {
        !lab.reads(me, note) && !lab.opens(me, KeyFam::Seed(alice)) && lab.item(me, note).is_none()
    };
    assert!(server.read(opens_none).await, "it relays avenALICE's entries and opens none of them");
    // her second browser signs in through the server with her passkey alone: the same world, every name, the note
    let other = start("Eve's other browser", &url, 8);
    let other = link(other, &server.offer(), &eve, [2; 32]).await.expect("it signs in");
    let reads = || async {
        let w = world_of(&other).await;
        let Some(vaults) = w["vaults"].as_array() else { return false };
        let names: Vec<&str> = vaults.iter().filter_map(|v| v["name"].as_str()).collect();
        let entries = w["entries"].as_array().cloned().unwrap_or_default();
        let seed = ["Eve", "Maia Holding GmbH", "avenCEO GmbH", "CEO Aven"];
        names == [&seed[..], &["avenALICE", "avenBOB", "avenCHARLY", "Maia City COOP"]].concat()
            && entries.iter().any(|i| i["kind"] == "note" && i["text"] == "Plant beans.")
    };
    until("her other browser shows every vault and avenALICE's note", reads).await;
    for n in [first.node(), other.node(), &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// The text the note viewer shows on line `line` of `note`'s history (the `note` op).
fn on_line(note: &Value, line: Option<&str>) -> String {
    let lines = note["lines"].as_array().expect("its lines");
    let found = lines.iter().find(|l| l["line"].as_str() == line).expect("the line");
    found["text"].as_str().unwrap_or_default().to_string()
}

/// The kinds of `note`'s edits, in the order its device took them.
fn kinds(note: &Value) -> Vec<String> {
    let edits = note["edits"].as_array().expect("its edits");
    edits.iter().map(|c| c["kind"].as_str().unwrap_or_default().to_string()).collect()
}

/// Entry `e`'s history as the note viewer reads it (the `note` op).
async fn note_of(d: &Device, e: EntryId) -> Value {
    run(d, json!({ "op": "note", "entry": e.to_hex() })).await.expect("its history")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_note_takes_proposals_merges_and_variants_and_the_database_shows_every_record() {
    let admission = Admission::default();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url: RelayUrl = relay.url();
    let mut lab = Lab::with_entropy([3; 32]);
    let me = lab.device_with("the server", [7; 32]);
    let (relay, admits) = (Some(url.clone()), Some(admission.clone()));
    let opts = Options { relay, admission: admits, card: true, ..Options::local() };
    let server = Node::spawn(lab, me, opts).await.expect("the server's node");
    let eve = Browser::new(Passkey::from_seed([5; 32]));
    let first = start("Eve's browser", &url, 7);
    let first = found(first, &server.offer(), None, &eve, [1; 32]).await.expect("her vault");
    eve.steps();
    let v = first.vault().await.expect("her vault");
    let note = write_note(&first, v, v, titled("Plan", "Plant beans."), &[]).await.expect("a note");
    run(&first, set_text(v, note, None, 2, "Plant beans and peas.")).await.expect("an edit");
    let shown_note = note_of(&first, note).await;
    assert_eq!(kinds(&shown_note), ["edit", "edit"]);
    let edits = shown_note["edits"].as_array().expect("its edits");
    assert!(edits.iter().all(|e| e["counted"] == true), "the edits of the note's own vault all count");
    assert_eq!(
        (edits[1]["before"].as_str(), edits[1]["text"].as_str()),
        (Some("Plant beans."), Some("Plant beans and peas."))
    );
    assert_eq!(edits[0]["before"], Value::Null, "the first edit built on nothing");
    let edit = edits[1]["id"].as_str().expect("the edit's id").to_string();
    // a proposal from the main line's head: its own line, named, from that version
    let heads = note_of(&first, note).await["lines"][0]["heads"].clone();
    let from: Vec<String> = serde_json::from_value(heads).expect("heads");
    assert_eq!(from, std::slice::from_ref(&edit));
    let e = note.to_hex();
    let propose = json!({ "op": "propose", "entry": e, "from": from, "name": "draft" });
    let draft = run(&first, propose).await.expect("a proposal")["line"].as_str().expect("its line").to_string();
    let b = draft.as_str();
    run(&first, set_text(v, note, Some(b), 2, "Plant beans, peas and corn.")).await.expect("an edit on it");
    let shown_note = note_of(&first, note).await;
    assert_eq!(shown_note["lines"][1]["name"].as_str(), Some("draft"));
    assert_eq!(shown_note["lines"][1]["from"], json!([edit]));
    assert_eq!(
        (on_line(&shown_note, None), on_line(&shown_note, Some(b))),
        ("Plant beans and peas.".into(), "Plant beans, peas and corn.".into())
    );
    assert_eq!(kinds(&shown_note), ["edit", "edit", "propose", "edit"]);
    let corn = shown_note["edits"][3]["id"].as_str().expect("the proposal's edit").to_string();
    let all: Vec<&str> =
        shown_note["edits"].as_array().expect("its edits").iter().map(|c| c["id"].as_str().unwrap()).collect();
    assert_eq!(shown_note["lines"][0]["history"], json!(all[..2]), "the main line: the first two");
    assert_eq!(shown_note["lines"][1]["history"], json!(all), "the proposal: what it builds on, then its own");
    assert_eq!(shown_note["edits"][2]["from"], json!({ "line": null, "name": "main" }), "it started from main");
    // merged into the main line, which hadn't changed since: a write that carries no change, as Loro's merged item
    // shows the proposal's edit already, and the main line shows it
    run(&first, json!({ "op": "merge", "entry": e, "from": b })).await.expect("merged");
    let shown_note = note_of(&first, note).await;
    assert_eq!(kinds(&shown_note).last().map(String::as_str), Some("merge"));
    assert_eq!(on_line(&shown_note, None), "Plant beans, peas and corn.");
    let merge = &shown_note["edits"][4];
    assert_eq!(merge["from"], json!({ "line": b, "name": "draft" }), "it brought in the proposal");
    assert_eq!(
        (merge["before"].as_str(), merge["text"].as_str()),
        (Some("Plant beans and peas."), Some("Plant beans, peas and corn.")),
        "what the merge brought to the main line"
    );
    // the proposal's edit undone on the main line, every other change kept; then the first version restored
    run(&first, json!({ "op": "undo", "entry": e, "edit": corn })).await.expect("undone");
    assert_eq!(on_line(&note_of(&first, note).await, None), "Plant beans and peas.");
    let made = note_of(&first, note).await["edits"][0]["id"].as_str().map(str::to_string);
    let made = made.expect("the first edit");
    run(&first, json!({ "op": "restore", "entry": e, "at": [made] })).await.expect("restored");
    assert_eq!(on_line(&note_of(&first, note).await, None), "Plant beans.");
    // the proposal goes on while main went back: both changed the text at one place, a conflict the note shows,
    // and a merge that takes the proposal's text there brings it to main
    run(&first, set_text(v, note, Some(b), 2, "Corn first.")).await.expect("another edit on the proposal");
    let text = json!({ "at": ["blocks", { "id": 2 }], "what": "row" });
    let conflict = note_of(&first, note).await["lines"][1]["conflicts"][0].clone();
    assert_eq!((&conflict["at"], &conflict["ours"]["text"]), (&text["at"], &json!("Plant beans.")));
    run(&first, json!({ "op": "merge", "entry": e, "from": b, "take": [text] })).await.expect("merged, taking it");
    let shown_note = note_of(&first, note).await;
    assert_eq!(kinds(&shown_note).last().map(String::as_str), Some("merge"));
    let both = (on_line(&shown_note, None), on_line(&shown_note, Some(b)));
    assert_eq!(both, ("Corn first.".into(), "Corn first.".into()));
    // the engine's history of it: each write as the note page names it, and the merge's change, the text it brought
    let log = run(&first, json!({ "op": "history", "entry": e })).await.expect("its history");
    assert_eq!(kinds(&log), kinds(&shown_note));
    let brought = json!([{ "set": ["blocks", { "id": 2 }, "text"], "value": "Corn first." }]);
    assert_eq!(log["edits"].as_array().and_then(|es| es.last()).map(|p| &p["changes"]), Some(&brought));
    // a variant: the proposal's note as a new entry of her vault, its own edits one, that names its origin and the
    // version of it it copies, the proposal's heads, so its history goes on into the original's
    let copy = json!({ "op": "variant", "entry": e, "line": b, "into": v.to_hex() });
    let variant = entry(run(&first, copy).await.expect("a variant"));
    let made = note_of(&first, variant).await;
    assert_eq!((kinds(&made), on_line(&made, None)), (vec!["edit".to_string()], "Corn first.".to_string()));
    let lines = shown_note["lines"].as_array().expect("its lines");
    let heads = &lines.iter().find(|l| l["line"] == json!(b)).expect("the proposal")["heads"];
    let world = world_of(&first).await;
    let of = item(&world, variant);
    assert_eq!((&of["variantOf"], &of["variantAt"], &of["edits"]), (&json!(e), heads, &json!(1)));
    assert_eq!((&item(&world, note)["variantOf"], &item(&world, note)["proposals"]), (&Value::Null, &json!(1)));
    assert_eq!(item(&world, variant)["deleted"], false, "not deleted");
    // deleted: the mark among the document's own tags; and taken out again, back
    let mark = |op: &str| json!({ "op": op, "entry": variant.to_hex(), "path": ["tags"], "value": DELETED });
    run(&first, mark("insert")).await.expect("deleted");
    let world = world_of(&first).await;
    assert_eq!(item(&world, variant)["deleted"], true, "deleted");
    let marked = |p: &Value| p["entries"].as_array().map(|es| es.iter().filter(|e| e["deleted"] == true).count());
    assert_eq!(marked(&world), Some(1), "the page sees it deleted");
    run(&first, mark("remove")).await.expect("brought back");
    assert_eq!(item(&world_of(&first).await, variant)["deleted"], false, "back");
    // and a new title on the main line, which leaves the proposal's
    let retitle = json!({ "op": "batch", "ops": [
        { "op": "set", "entry": e, "path": ["title"], "value": "Garden plan" },
        { "op": "set", "entry": e, "path": ["blocks", { "id": 1 }, "text"], "value": "Garden plan" },
    ] });
    let one = run(&first, retitle).await.expect("retitled");
    assert_eq!(one.as_array().map(Vec::len), Some(1), "one write");
    let shown_note = note_of(&first, note).await;
    let titles = (shown_note["lines"][0]["title"].as_str(), shown_note["lines"][1]["title"].as_str());
    assert_eq!(titles, (Some("Garden plan"), Some("Plan")));
    assert_eq!(eve.steps(), [], "no ceremony for any of it");
    // her database: the note's record and lines, the variant, her browser's card; the schemas the app ships
    let db = run(&first, json!({ "op": "database", "vault": v.to_hex() })).await.expect("her database");
    assert_eq!(db["vault"].as_str(), Some(v.to_hex().as_str()));
    let rows = db["rows"].as_array().expect("its rows");
    let row = |e: EntryId| rows.iter().find(|r| r["entry"].as_str() == Some(e.to_hex().as_str())).expect("the row");
    let plan = row(note);
    assert_eq!(
        (plan["kind"].as_str(), plan["title"].as_str(), plan["type"].as_str(), &plan["tags"]),
        (Some("document"), Some("Garden plan"), Some("note"), &json!([]))
    );
    assert_eq!((plan["lines"].as_u64(), plan["proposals"].clone()), (Some(2), json!(["draft"])));
    assert_eq!(plan["edits"].as_u64(), Some(kinds(&shown_note).len() as u64));
    assert_eq!(plan["record"]["blocks"][1]["text"].as_str(), Some("Corn first."));
    assert_eq!(plan["record"]["blocks"][0]["text"].as_str(), Some("Garden plan"), "its heading retitled with it");
    assert_eq!(plan["actor"].as_str(), Some(v.to_hex().as_str()), "her vault wrote it");
    let schemas: Vec<String> = db["builtIn"]["schemas"]
        .as_array()
        .expect("the app's schemas")
        .iter()
        .map(|s| s["id"].as_str().unwrap_or_default().to_string())
        .collect();
    assert_eq!(schemas.len(), 8, "documents and todos, two versions each, articles, flows, functions and posts");
    assert!(schemas.contains(&avendb::lens::ARTICLE_V1.id().to_hex()));
    assert_eq!(plan["authored"], json!([avendb::lens::DOCUMENT_V2.id().to_hex()]), "written under document v2");
    assert!(schemas.contains(&avendb::lens::DOCUMENT_V2.id().to_hex()));
    assert_eq!(row(variant)["record"]["blocks"][1]["text"].as_str(), Some("Corn first."));
    let tags = &row(variant)["record"]["tags"];
    let at: Vec<&str> = heads.as_array().expect("the heads").iter().filter_map(Value::as_str).collect();
    let mark = format!("avendb:variant:{}@{}", note.to_hex(), at.join(","));
    assert_eq!(tags, &json!([mark]), "it names its origin and the version it copies");
    let card = rows.iter().find(|r| r["type"].as_str() == Some("card")).expect("her browser's card");
    assert_eq!(card["title"].as_str(), Some("Eve's browser"));
    assert_eq!(db["edits"]["founded"].as_u64(), Some(1));
    assert_eq!(db["edits"].get("published"), None, "a vault's schemas and lenses are its entries, writes among writes");
    let writes = db["edits"]["writes"].as_u64();
    assert!(writes.is_some_and(|n| n >= kinds(&shown_note).len() as u64 + 2), "{}", db["edits"]);
    assert!(db["edits"]["caps"].as_u64().is_some_and(|n| n >= 1), "avenCEO relays it");
    let audiences = db["cells"].as_array().expect("its audiences");
    let one = (audiences.len(), audiences[0]["entries"].as_u64(), audiences[0]["caps"].as_array().map(Vec::len));
    assert_eq!(one, (1, Some(3), Some(0)), "her card, the note and its variant: no share splits her vault");
    assert_eq!(db["builtIn"]["lenses"][0]["title"].as_str(), Some("Markdown document, v1 to v2"));
    // her database's history, every edit her browser holds, in the order it took them: her vault's genesis, her
    // browser added to it, avenCEO's relay on the whole of it, and each write, every one counted, as a checkpoint
    // covers it
    let log = run(&first, json!({ "op": "log" })).await.expect("its log");
    let edits = log["edits"].as_array().expect("its edits");
    assert_eq!(edits.len(), first.node().read(|lab, me| lab.size(me).0).await, "every edit it holds");
    let places: Vec<u64> = edits.iter().filter_map(|o| o["n"].as_u64()).collect();
    assert_eq!(places, (1..=edits.len() as u64).collect::<Vec<_>>(), "in the order it took them");
    let of = |kind: &str| edits.iter().filter(|o| o["kind"].as_str() == Some(kind)).collect::<Vec<_>>();
    let genesis = of("genesis").into_iter().find(|o| o["id"].as_str() == Some(v.to_hex().as_str())).expect("hers");
    assert_eq!(genesis["fields"]["vaultKind"].as_str(), Some("human"));
    assert_eq!(genesis["fields"]["root"].as_str(), Some(first.passkey().to_hex().as_str()), "her passkey roots it");
    let sigs = genesis["sigs"].as_array().expect("its signatures");
    assert!(sigs.iter().any(|s| s["by"] == "passkey" && s["pq"].as_u64().is_some_and(|n| n > 1000)), "{sigs:?}");
    let browser = first.node().device().to_hex();
    assert!(of("addDevice").iter().any(|o| o["fields"]["device"].as_str() == Some(browser.as_str())));
    let backup = |o: &&Value| o["fields"]["role"] == "backup" && o["fields"]["wide"] == true;
    assert!(of("cap").iter().any(backup), "avenCEO's backup of the whole of her vault");
    let writes = of("write");
    let mine = writes.iter().filter(|o| o["fields"]["entry"].as_str() == Some(note.to_hex().as_str()));
    assert_eq!(mine.clone().count(), kinds(&shown_note).len(), "each write of the note");
    assert!(mine.clone().all(|o| o["counted"] == true), "every one counted");
    assert!(mine.clone().all(|o| o["allowed"] == true), "and allowed, as her vault's own");
    assert!(of("cap").iter().all(|o| o["allowed"].is_null()), "a share is no write");
    assert!(mine.clone().all(|o| o["fields"]["sealed"].as_u64().is_some_and(|n| n > 0)), "its body by its size alone");
    let starts = |o: &&Value| o["fields"]["starts"] == true && o["fields"]["line"] == o["id"];
    assert!(mine.clone().any(starts), "the proposal's start");
    let hers = json!(v.to_hex());
    assert!(writes.iter().all(|o| o["vaults"].as_array().is_some_and(|vs| vs.contains(&hers))));
    assert!(!of("checkpoint").is_empty() && !of("keys").is_empty());
    let signed_all =
        |o: &Value| o["bytes"].as_u64().is_some_and(|n| n > 0) && !o["sigs"].as_array().unwrap().is_empty();
    assert!(edits.iter().all(signed_all));
    let text = log.to_string();
    assert!(!text.contains("Corn first") && !text.contains("Plant beans"), "no note's text in its history: sealed");
    // the server relays her entries and opens none of them: its rows are sealed
    let sealed = move |lab: &Lab, me| lab.fetched(me, variant) > 0 && lab.item(me, note).is_none();
    until("the server keeps her entries, sealed", || server.read(sealed)).await;
    for n in [first.node(), &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_browser_brings_a_film_into_her_vault_and_her_mac_reads_any_range_of_it() {
    let admission = Admission::default();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url: RelayUrl = relay.url();
    let mut w = world();
    let secret = w.lab.passkey_secret(w.passkey_a).expect("Alice's passkey, a software passkey");
    let (mac_a, server_d, alice) = (w.mac_a, w.server, w.alice);
    let opts = Options { relay: Some(url.clone()), admission: Some(admission.clone()), ..Options::local() };
    let server = node(&mut w, server_d, &[], 2, opts).await;
    let mac = node(&mut w, mac_a, &[], 1, Options { relay: Some(url.clone()), ..Options::local() }).await;
    mac.know(server.addr());
    until("the relay serves Alice's Mac", || async { relay.serves(&mac.id()) }).await;
    let alices = Browser::new(Passkey::from_seed(*secret));
    let browser = link(start("Alice's browser", &url, 7), &mac.offer(), &alices, [1; 32]).await.expect("it links");
    // a film of three megabytes and a bit, handed over as the page hands it, a megabyte at a time: the entry is
    // checked first, as may checks it
    let film: Vec<u8> = (0..3 * MB + 123).map(|i| (i * 31 % 251) as u8).collect();
    let len = film.len() as u64;
    let chunks = film.chunks(MB as usize).map(|c| Ok(Bytes::copy_from_slice(c))).collect::<Vec<io::Result<Bytes>>>();
    let put = json!({ "op": "put_file", "as": alice.to_hex(), "vault": alice.to_hex(), "name": "Harvest.mp4",
        "media": "video/mp4", "tags": [], "len": len });
    assert_eq!(run(&browser, json!({ "op": "may", "ops": [put] })).await, Ok(json!([true])));
    let (made, _) = browser.run(put, Some(stream::iter(chunks)), None::<&NoCeremony>).await.expect("an answer");
    let made = made["ok"].clone();
    let e = entry(made.clone());
    // her browser shows it as a file: its name, its media type, its one file and that file's length
    let seen = world_of(&browser).await;
    let row = item(&seen, e);
    assert_eq!((&row["kind"], &row["title"], &row["deleted"]), (&json!("file"), &json!("Harvest.mp4"), &json!(false)));
    assert_eq!((&row["media"], &row["files"][0]["len"]), (&json!("video/mp4"), &json!(len)));
    assert_eq!((&row["files"][0]["root"], &row["files"][0]["size"]), (&made["root"], &made["size"]), "{made}");
    let hash = BlobId::from_hex(made["root"].as_str().expect("its root")).expect("a root").0;
    let root = FileRoot { hash, size: made["size"].as_u64().expect("its sealed size") };
    // her Mac reads any range of it, fetched from the browser and opened with the key in the write
    let opens = move |lab: &Lab, me| lab.file(me, &root).is_some();
    until("the Mac takes the write that brings it", || mac.read(opens)).await;
    for range in [0..10, MB - 5..MB + 5, len - 100..len + 50] {
        let read = mac.read_file(root, range.clone()).await.expect("the Mac reads it");
        let end = range.end.min(len);
        assert_eq!(read, film[range.start as usize..end as usize], "bytes {range:?}");
    }
    // and as the page reads it, an op, the bytes beside the answer
    let read = json!({ "op": "read_file", "root": made["root"], "size": root.size, "from": MB - 5, "to": MB + 5 });
    let (answer, bytes) = browser.run(read, None::<NoBytes>, None::<&NoCeremony>).await.expect("an answer");
    let range = json!({ "root": made["root"], "from": MB - 5, "to": MB + 5, "len": 10 });
    assert_eq!((answer, bytes), (json!({ "ok": range }), Some(film[(MB - 5) as usize..(MB + 5) as usize].to_vec())));
    let whole = json!({ "op": "read_file", "root": made["root"], "size": root.size });
    let (_, bytes) = browser.run(whole, None::<NoBytes>, None::<&NoCeremony>).await.expect("an answer");
    assert_eq!(bytes, Some(film.clone()), "the whole film");
    // where it is synced to (v8 phase H): her browser, whose shelf holds it, and her Mac, once it read all of it
    mac.read_file(root, 0..len).await.expect("the Mac reads all of it");
    let (her, macs) = (json!(browser.node().device().to_hex()), json!(mac_a.to_hex()));
    // one list for the entry and its file, each device with how much of it it holds: all of it here
    let both = |list: &Value| {
        let holders = list.as_array().into_iter().flatten();
        let all: Vec<&Value> = holders.filter(|h| h["has"] == h["of"]).map(|h| &h["device"]).collect();
        all.contains(&&her) && all.contains(&&macs)
    };
    let synced = || async {
        let seen = world_of(&browser).await;
        let row = item(&seen, e);
        let file = &row["files"][0]["syncedTo"];
        both(&row["syncedTo"]) && both(file) && file.as_array().is_some_and(|l| l.len() == 2)
    };
    until("her browser shows the film synced to itself and her Mac", synced).await;
    // deleted as the page deletes it, a mark among its document's tags; and back
    let (alice_hex, e_hex) = (alice.to_hex(), e.to_hex());
    let mark = |op: &str| json!({ "op": op, "as": alice_hex, "entry": e_hex, "path": ["tags"], "value": DELETED });
    run(&browser, mark("insert")).await.expect("deleted");
    assert_eq!(item(&world_of(&browser).await, e)["deleted"], true);
    run(&browser, mark("remove")).await.expect("back");
    assert_eq!(item(&world_of(&browser).await, e)["deleted"], false);
    for n in [browser.node(), &mac, &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}
