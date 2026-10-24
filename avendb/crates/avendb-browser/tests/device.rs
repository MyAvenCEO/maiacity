//! A browser's device, run natively (P8d, P8e): its person's passkey stays in the browser's authenticator, a software
//! passkey here, which makes each ceremony the device asks for. Eve's first browser founds her vault through the relay,
//! open to sign-up, with the passkey she signed up to maiaCITY with, and the server learns it; her second browser
//! links through the first one's code, browser to browser; the first opens again from its shelf, following the vaults
//! it followed; with both lost, her passkey alone gets her vault back on a new browser, through the server. Alice's
//! browser links through the code her Mac shows and edits Welcome. The first person to found their vault through a new
//! server claims it from their first browser, in the same ceremony (P8f), and her vault founds four more vaults it owns
//! in one more ceremony: her browser acts as each of them, and what each shares, a note by its id, its todos by their
//! type, or the whole of it, decides what the others may read and write. Her browser brings a film into her vault, a
//! megabyte at a time, and her Mac reads any range of it. Every device, the server too, trusts no curve: every edit
//! is ML-DSA-65 signed, as every signer here is made after the key move (Gina's is made before it, in SLH-DSA). Hana's
//! browser and passkey, made before it too, move to ML-DSA-65 after an unlock, in one ceremony more (K3b), and the
//! browser opens again as its next key on the same shelf, with no unlock. Sam's new phone signs in through the server
//! with his passkey from before it, knows the server from then on, and moves his passkey only once it caught up with
//! one of its peers, so it reads his name and Maia City after the move as before.
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
use avendb::id::{BlobId, EntryId, ShareId, SignerId, VaultId};
use avendb::keys::KeyFam;
use avendb::lab::{Lab, Retire};
use avendb::policy::{Action, Kind, Level, Principal, Sharing};
use avendb::slice::Selector;
use avendb::recovery::RecoveryKey;
use avendb::rules::ops_to_json;
use avendb::sealed::FileRoot;
use avendb::sign::{Ceremony, ML_DSA_PUBLIC_BYTES, ML_DSA_SIGNATURE_BYTES, Passkey, Suite, device_salt};
use avendb::world;
use avendb_browser::{DELETED, Device, Fresh, Meta, Moving, Signing, Start, Unlock};
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
    Start { name, relay, entropy: [seed; 32], now: now(), direct: false, shelf: None, progress, recovery, on_node: None }
}

/// The same, on the shelf in folder `dir`, as a page's device keeps its in OPFS.
fn start_on(dir: &Path, name: &str, url: &RelayUrl, seed: u8) -> Start {
    Start { shelf: Some(disk::open(dir).expect("its shelf")), ..start(name, url, seed) }
}

/// Seed metadata between closed fixture Nodes with an explicit temporary writer. The next Node must acquire
/// its own generation after this writer has durably finished and released the shelf.
async fn keep_meta(dir: &Path, meta: &Meta) {
    let shelf = disk::open(dir).expect("its shelf");
    let writer = shelf.writer().expect("the closed fixture releases its writer");
    meta.keep(&writer.shelf()).await.expect("what opens it again");
    writer.shutdown().await.expect("metadata is durable before the next Node opens");
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

/// An outline: nodes, each with a text and the nodes under it, at any depth.
const OUTLINE: &str = r##"{ "title": "Outline", "type": "object",
  "$defs": { "node": { "type": "object", "properties": {
    "id": { "type": "integer" },
    "text": { "type": "string", "x-loro": "text", "default": "" },
    "kids": { "type": "array", "default": [], "items": { "$ref": "#/$defs/node" } } },
    "required": ["id"] } },
  "properties": {
    "kind": { "const": "outline" },
    "title": { "type": "string", "default": "" },
    "nodes": { "type": "array", "default": [], "items": { "$ref": "#/$defs/node" } } },
  "required": ["kind"] }"##;

/// Outline `e` as device `d` reads it through its schema: `None` while it reads none.
async fn outline(d: &Device, e: EntryId) -> Option<Value> {
    let row = run(d, json!({ "op": "get", "entry": e.to_hex() })).await.ok()?;
    row["schema"].is_string().then(|| row["record"].clone())
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
    assert_eq!(seen["ownsServer"], false, "avenCEO server is Alice's vault's, which claimed the server before Eve");
    until("the server learns her browser from what it relays", || async { admission.admits(&first.node().id()) }).await;
    assert!(titles(&first).await.is_empty(), "no note yet: her browser's card is none");
    // her vault, her passkey its root, and her browser, by the name on its card
    let mine = shown(&seen, vault);
    assert_eq!((&mine["kind"], &mine["root"]), (&json!("human"), &json!(first.passkey().to_hex())));
    let first_d = first.node().device().to_hex();
    let me = json!({ "id": first_d, "name": "Eve's browser", "me": true, "copy": null, "next": null, "old": false });
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
    // it follows avenCEO from now on, and its queries read 6 levels down at most: it keeps both on its shelf, in what
    // opens it again
    let follow = json!({ "op": "follow", "vault": avenceo.to_hex(), "on": true });
    assert_eq!(run(&first, follow).await, Ok(json!({ "follow": [avenceo.to_hex()] })));
    let limits = |depth: usize| json!({ "depth": depth, "default": 16, "ceiling": 256 });
    assert_eq!(run(&first, json!({ "op": "limits" })).await, Ok(limits(256)), "as deep as any write reaches");
    assert_eq!(run(&first, json!({ "op": "set_limits", "depth": 6 })).await, Ok(limits(6)));
    let meta = Meta { follow: vec![avenceo], query_depth: Some(6), ..meta };
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
    assert_eq!(run(&again, json!({ "op": "limits" })).await, Ok(limits(6)), "and reads as deep as it did");
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
    assert_eq!(steps(&shown_steps), ["keys", "node", "relay", "server", "pass", "vault", "join"]);
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
    // both browsers write in one outline of hers at once, rows inside rows: each adds a row under one row two lists
    // down, and one edits the text of a row while the other moves that row within its list; each reads the other's,
    // the edit kept by the move, and the two agree on the whole outline
    let schema = json!({ "op": "create", "as": alice.to_hex(), "vault": alice.to_hex(), "type": "schema",
        "value": OUTLINE });
    run(&browser, schema).await.expect("her outline's schema");
    let beds = json!({ "kind": "outline", "title": "Garden", "nodes": [{ "id": 1, "text": "Beds", "kids": [
        { "id": 11, "text": "North", "kids": [] }, { "id": 12, "text": "South", "kids": [] }] }] });
    let garden = json!({ "op": "create", "as": alice.to_hex(), "vault": alice.to_hex(), "type": "note",
        "value": beds });
    let garden = entry(run(&browser, garden).await.expect("her outline"));
    let reads = || async { outline(&other, garden).await.is_some() };
    until("the other reads the outline through its schema", reads).await;
    let op = |op: &str, path: Value, more: Value| {
        let mut o = json!({ "op": op, "as": alice.to_hex(), "entry": garden.to_hex(), "path": path });
        o.as_object_mut().expect("an op").extend(more.as_object().expect("its fields").clone());
        o
    };
    let row = |id: i64, more: &[&str]| {
        let mut p = vec![json!("nodes"), json!({ "id": 1 }), json!("kids"), json!({ "id": id })];
        p.extend(more.iter().map(|f| json!(f)));
        Value::Array(p)
    };
    let under = |id: i64, text: &str| op("insert", row(11, &["kids"]), json!({ "value": { "id": id, "text": text } }));
    let renamed = op("set", row(12, &["text"]), json!({ "value": "South bed" }));
    let moved = op("move", row(12, &[]), json!({ "to": 0 }));
    let first = async { (run(&browser, under(111, "Beans")).await, run(&browser, renamed).await) };
    let second = async { (run(&other, under(112, "Peas")).await, run(&other, moved).await) };
    let (first, second) = tokio::join!(first, second);
    for done in [first.0, first.1, second.0, second.1] {
        done.expect("each write fits the outline");
    }
    let agreed = || async {
        let (a, b) = (outline(&browser, garden).await, outline(&other, garden).await);
        let Some(a) = a.filter(|a| Some(a) == b.as_ref()) else { return false };
        let kids = &a["nodes"][0]["kids"];
        kids[0]["text"] == "South bed" && kids[1]["kids"].as_array().map(Vec::len) == Some(2)
    };
    until("both read both rows, the move and the edit, alike", agreed).await;
    let read = outline(&browser, garden).await.expect("her outline");
    let kids = read["nodes"][0]["kids"].as_array().expect("its rows");
    assert_eq!(kids.iter().map(|k| k["id"].as_i64()).collect::<Vec<_>>(), [Some(12), Some(11)], "moved first");
    let mut rows: Vec<(i64, String)> = kids[1]["kids"].as_array().expect("its rows").iter().map(|k| {
        (k["id"].as_i64().expect("an id"), k["text"].as_str().expect("a text").to_string())
    }).collect();
    rows.sort();
    assert_eq!(rows, [(111, "Beans".into()), (112, "Peas".into())], "each browser's row: {read}");
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
    let avenceo = server.read(|lab, me| lab.vault_of(me)).await.expect("the server is avenMAIA's device");
    let shape = move |lab: &Lab, _| {
        let st = lab.state(me);
        st.vault(avenceo).map(|v| (v.kind, world::seeded(st, vault, avenceo)))
    };
    let seeded = Some((Kind::Aven, true));
    let what = "avenMAIA, the aven of her seed, owned through Maia City";
    assert_eq!(server.read(shape).await, seeded, "{what}");
    // her phone shares her passkey and sets up too: the server knows her vault, so the phone joins it, in the unlock
    // alone, and founds nothing; still one vault her passkey roots, the one that owns her seed
    let phone = start("Eve's phone", &url, 8);
    let joined = phone.progress.clone();
    let phone = found(phone, &server.offer(), Some(p256), &eve, [2; 32]).await.expect("her phone in her vault");
    assert_eq!(phone.vault().await, Some(vault), "her one vault");
    assert_eq!(eve.steps(), [], "no ceremony past the unlock");
    let rooted = ["keys", "node", "relay", "server", "pass", "vault", "join"];
    assert_eq!(steps(&joined), rooted, "it signs in as a link does");
    let passkey = Passkey::from_seed([5; 32]).id();
    let roots = move |lab: &Lab, _| lab.state(me).vaults().iter().filter(|v| v.root == Some(passkey)).count();
    assert_eq!(server.read(roots).await, 1, "one vault her passkey roots");
    until("her phone acts for her seed too", || async { world_of(&phone).await["ownsServer"] == true }).await;
    // her browser gives Maia City avenDB's own schemas and lenses, as her page does once her seed is there: each an
    // entry of Maia City's of the very bytes the app ships, so of the same id, shared with Everyone
    let coop = move |lab: &Lab, _| match lab.state(me).vault(avenceo)?.owners[..] {
        [Principal::Vault(v)] => Some(v.to_hex()),
        _ => None,
    };
    let company = server.read(coop).await.expect("Maia City owns her avenMAIA");
    let database = json!({ "op": "database", "vault": company });
    let standard = run(&first, database.clone()).await.expect("its database")["builtIn"].clone();
    for (ty, list) in [("schema", "schemas"), ("lens", "lenses")] {
        for x in standard[list].as_array().expect("the app's own") {
            let op = json!({ "op": "create", "vault": company, "type": ty, "value": x["json"], "as": company });
            run(&first, op).await.expect("an entry of Maia City's");
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
    let own = "its own kinds, the article's, the spark's, the function's, the view's and the AIP's two versions, and the \
        lenses between";
    assert_eq!((both.0.len(), both.1.len()), (30, 7), "{own}");
    let public = |w: &Value| -> usize {
        let es = w["entries"].as_array().into_iter().flatten();
        es.filter(|e| e["vault"] == company.as_str() && e["kind"] == "schema" && e["public"] == true).count()
    };
    let n = both.0.len();
    until("her phone reads them all, each Public", || async { public(&world_of(&phone).await) == n }).await;
    let seen = world_of(&first).await;
    assert_eq!(seen["ownsServer"], true, "as her browser shows");
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
    // her vault gives avenMAIA relay on the whole of it: the server keeps her note and knows her browser for good
    let note = write_note(&first, vault, vault, titled("Seeds", "Tomatoes in March."), &[]).await.expect("a note");
    let holds = move |lab: &Lab, me| lab.fetched(me, note) > 0;
    until("the server keeps her note", || server.read(holds)).await;
    until("and knows her browser", || async { admission.admits(&first.node().id()) }).await;
    let stranger = Passkey::from_seed([9; 32]).id();
    assert!(!admission.honours(&stranger), "claimed, its relay honours no stranger's pass");
    // Maia City holds the content flow and a function of it, as her page adds them, and shares its flows and
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
        run(&first, op).await.expect("an entry of Maia City's");
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
    let hers = (json!("profile"), json!(false), Value::Null);
    let both = [hers, (json!("flow"), json!(true), json!(true)), (json!("function"), json!(true), Value::Null)];
    assert_eq!(fields, both, "its profile a record too, its flows and functions Public: {records:?}");
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
    // a picture of her Library, which its post shows by its name, as an article does
    let photo: Vec<u8> = (0..70_000u32).map(|i| (i * 7 % 253) as u8).collect();
    let (len, name) = (photo.len() as u64, format!("{}.png", "ab".repeat(32)));
    let put = json!({ "op": "put_file", "as": her, "vault": her, "name": name, "media": "image/png", "tags": [],
        "len": len });
    let chunks = || stream::iter([Ok::<Bytes, io::Error>(Bytes::from(photo.clone()))]);
    let (made, _) = first.run(put, Some(chunks), None::<&NoCeremony>).await.expect("an answer");
    let picture = entry(made["ok"].clone());
    let text = format!("Tomatoes in **March**.\n\n![Seedlings]({name})");
    let value = json!({ "kind": "post", "title": "Seeds", "text": text, "channel": "Devlog",
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
    // its picture is hers alone, so the feed names none, until it goes public on the stage's tag, as the content
    // flow's function tags it: then the feed names it, and the server reads it whole, as it serves it
    let pictures = move |lab: &Lab, me| -> Option<Value> {
        let ours = world::public_posts(lab, me).into_iter().find(|p| p["entry"] == post.to_hex());
        ours.map(|p| p["pictures"].clone())
    };
    assert_eq!(server.read(pictures).await, Some(json!([])), "the feed names no picture of hers yet");
    let (vault_of, named) = (vault, name.clone());
    let served = move |lab: &Lab, me| world::public_file(lab, me, vault_of, &named);
    assert_eq!(server.read(served.clone()).await, None, "and serves none");
    let tag = json!({ "op": "tag", "entry": picture.to_hex(), "add": ["content:published"], "as": her });
    run(&first, tag).await.expect("its picture published with it");
    let shown = json!([name]);
    until("the feed names its picture", || async { server.read(pictures).await.as_ref() == Some(&shown) }).await;
    let file = server.read(served.clone()).await.expect("a picture everyone may read");
    assert_eq!((file.len, file.media.as_str()), (len, "image/png"), "its length and its media type");
    assert_eq!(server.read_file(file.root, 0..file.len).await.expect("the server reads it"), photo, "all of it");
    // Maia City publishes too, its profile Public as it first does, so that everyone reads who published it; the
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
    let mut both = vec![(news.to_hex(), Some(world::SEED_COOP.to_string())), (post.to_hex(), None)];
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
    let off = json!({ "op": "tag", "entry": picture.to_hex(), "remove": ["content:published"], "as": her });
    run(&first, off).await.expect("its picture with it");
    until("the server serves its picture no more", || async { server.read(served.clone()).await.is_none() }).await;
    let city = vec![(news.to_hex(), Some(world::SEED_COOP.to_string()))];
    until("the server's feed lists Maia City's alone", || async { server.read(listed).await == city }).await;
    for n in [first.node(), &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// Entry `e` in the world `w` a device shows.
fn item(w: &Value, e: EntryId) -> &Value {
    let entries = w["entries"].as_array().expect("its entries");
    entries.iter().find(|i| i["entry"] == e.to_hex()).unwrap_or_else(|| panic!("entry {} in the world", e.to_hex()))
}

/// The level vault `v` holds on entry `it` a world shows, if any (its `levels`).
fn level(it: &Value, v: VaultId) -> Option<&str> {
    it["levels"][v.to_hex()].as_str()
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
    let x = &item(w, e)["audience"];
    let audiences = w["audiences"].as_array().expect("its audiences");
    let audience = audiences.iter().find(|c| &c["id"] == x).expect("its audience");
    let syncs = audience["syncs"].as_array().expect("who syncs it");
    let s = syncs.iter().find(|s| s["device"] == d.to_hex())?;
    let text = |v: &Value| v.as_str().unwrap_or_default().to_string();
    Some((text(&s["through"]), text(&s["level"]), s["opens"] == true))
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
    let avenceo = server.read(|lab, me| lab.vault_of(me)).await.expect("the server is avenMAIA's device");
    let w = world_of(&first).await;
    assert_eq!(w["mine"], eve_v.to_hex());
    // her seed: Maia City, a coop her vault owns, and avenMAIA, its one aven, which the server is a device of
    let owner = |v: VaultId| shown(&w, v)["owners"][0]["vault"].as_str().and_then(VaultId::from_hex).expect("an owner");
    let city = owner(avenceo);
    assert_eq!(owner(city), eve_v, "her vault owns Maia City");
    let ids: Vec<&str> = w["vaults"].as_array().expect("its vaults").iter().filter_map(|v| v["id"].as_str()).collect();
    assert_eq!(ids, [eve_v.to_hex(), city.to_hex(), avenceo.to_hex()], "her seed");
    assert_eq!((&shown(&w, city)["kind"], &shown(&w, avenceo)["kind"]), (&json!("coop"), &json!("aven")));
    let via = json!([city.to_hex(), eve_v.to_hex()]);
    assert_eq!(shown(&w, avenceo)["via"], via, "her browser acts for avenMAIA through its owner's owner");
    // her seed named from the start, by the founding itself; her vault's profile written by her browser with no
    // ceremony; avenMAIA's entries are its own, which its server opens, while hers it only relays
    let seed = [(city, "Maia City"), (avenceo, "avenMAIA")];
    for (v, name) in seed {
        assert_eq!(named(&w, v), Some(name), "{name} named as it was founded");
    }
    let profiled = |v: VaultId, name: &str| json!({ "op": "profile", "vault": v.to_hex(), "name": name });
    assert_eq!(signed(&first, profiled(eve_v, "Eve"), &eve).await, Ok(json!({ "wrote": true })));
    for (v, name) in seed {
        assert_eq!(signed(&first, profiled(v, name), &eve).await, Ok(json!({ "wrote": false })), "{name}");
    }
    assert_eq!(signed(&first, profiled(eve_v, "Eve"), &eve).await, Ok(json!({ "wrote": false })), "it reads Eve");
    assert_eq!(eve.steps(), [], "no ceremony");
    let w = world_of(&first).await;
    assert_eq!((named(&w, eve_v), named(&w, avenceo)), (Some("Eve"), Some("avenMAIA")));
    let (eve_p, ceo_p) = (profile(&w, eve_v), profile(&w, avenceo));
    let (mine, srv) = (first.node().device(), server.device());
    let as_level = |v: VaultId, r: &str, opens: bool| Some((v.to_hex(), r.to_string(), opens));
    assert_eq!(syncs(&w, eve_p, srv), as_level(avenceo, "backup", false), "the server keeps her entries' ciphertext");
    assert_eq!(syncs(&w, eve_p, mine), as_level(eve_v, "owner", true));
    assert_eq!(syncs(&w, ceo_p, srv), as_level(avenceo, "owner", true), "avenMAIA's own entries its server opens");
    // four vaults her vault owns, in one ceremony, each of which gives avenMAIA relay on the whole of it: three device
    // vaults and a coop, as a human vault owns no aven; without a ceremony at hand the op answers what the passkey
    // would sign, and makes nothing
    let four = json!({ "op": "found", "vaults": [
        { "kind": "device", "name": "avenALICE" },
        { "kind": "device", "name": "avenBOB" },
        { "kind": "device", "name": "avenCHARLY" },
        { "kind": "coop", "name": "Maia City COOP" },
    ] });
    let asked = run(&first, four.clone()).await.expect_err("it waits for her passkey");
    assert_eq!(asked["approve"]["signers"], json!([first.passkey().to_hex()]), "{asked}");
    assert_eq!(world_of(&first).await["vaults"].as_array().map(Vec::len), Some(3), "nothing made");
    let vaults = signed(&first, four, &eve).await.expect("four vaults")["vaults"].clone();
    assert_eq!(eve.steps(), [Step::Approve], "one ceremony for all four");
    let vaults: Vec<VaultId> =
        vaults.as_array().expect("four").iter().filter_map(|v| v.as_str().and_then(VaultId::from_hex)).collect();
    let [alice, bob, charly, coop] = vaults[..] else { panic!("four vaults: {vaults:?}") };
    let w = world_of(&first).await;
    assert_eq!(w["vaults"].as_array().map(Vec::len), Some(7));
    let made = [(alice, "device", "avenALICE"), (bob, "device", "avenBOB"), (coop, "coop", "Maia City COOP")];
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
    let shares = w["shares"].as_array().expect("its shares");
    let shown_share = shares.iter().find(|c| c["id"] == ticks).expect("the share that ticks");
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
    assert_eq!(w["vaults"][3]["name"], "avenALICE");
    let shares = w["shares"].as_array().expect("its shares");
    let shared = shares.iter().find(|c| c["id"] == read).expect("the read share");
    assert_eq!((&shared["level"], &shared["slice"]["where"]), (&json!("read"), &the_note), "the note by its id");
    let public = shares.iter().find(|c| c["who"] == "everyone").expect("the public share");
    assert_eq!((&public["slice"]["name"], &public["level"]), (&json!("Public"), &json!("read")));
    assert_eq!(public["group"], "Public");
    // the server keeps it all, counts the writes, and opens none of avenALICE's keys
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
        let seed = ["Eve", "Maia City", "avenMAIA"];
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
async fn a_note_takes_proposals_merges_and_forks_and_the_database_shows_every_record() {
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
    // a fork: the proposal's note as a new entry of her vault, its own edits one, that names its origin and the
    // version of it it copies, the proposal's heads, so its history goes on into the original's
    let copy = json!({ "op": "fork", "entry": e, "line": b, "into": v.to_hex() });
    let variant = entry(run(&first, copy).await.expect("a fork"));
    let made = note_of(&first, variant).await;
    assert_eq!((kinds(&made), on_line(&made, None)), (vec!["edit".to_string()], "Corn first.".to_string()));
    let lines = shown_note["lines"].as_array().expect("its lines");
    let heads = &lines.iter().find(|l| l["line"] == json!(b)).expect("the proposal")["heads"];
    let world = world_of(&first).await;
    let of = item(&world, variant);
    assert_eq!((&of["forkOf"], &of["forkAt"], &of["edits"]), (&json!(e), heads, &json!(1)));
    assert_eq!((&item(&world, note)["forkOf"], &item(&world, note)["proposals"]), (&Value::Null, &json!(1)));
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
    let own = "documents, todos, articles (v1 and v2), flows, functions (v1 and v2), recipes, views (v1 and v2), logic, \
        reviews (v1 and v2), bundles, policies, AIPs (v1 and v2), posts, cards, profiles, files, stories, sparks (v1 and v2), requests, artifacts, \
        artworks, cap groups, rooms";
    assert_eq!(schemas.len(), 31, "{own}");
    let lenses = db["builtIn"]["lenses"].as_array().map(Vec::len);
    assert_eq!(lenses, Some(8), "the lenses from article, spark, function, view, post, story, AIP and review v1 to v2");
    assert!(schemas.contains(&avendb::lens::REVIEW_V1.id().to_hex()), "historical reviews remain readable");
    assert!(schemas.contains(&avendb::lens::REVIEW_V2.id().to_hex()), "current review schema is listed");
    assert_ne!(avendb::lens::REVIEW_V1.id(), avendb::lens::REVIEW_V2.id());
    assert!(schemas.contains(&avendb::lens::ARTICLE_V1.id().to_hex()));
    assert_eq!(plan["authored"], json!([avendb::lens::DOCUMENT_V1.id().to_hex()]), "written under document v1");
    assert!(schemas.contains(&avendb::lens::DOCUMENT_V1.id().to_hex()));
    assert_eq!(row(variant)["record"]["blocks"][1]["text"].as_str(), Some("Corn first."));
    let tags = &row(variant)["record"]["tags"];
    let at: Vec<&str> = heads.as_array().expect("the heads").iter().filter_map(Value::as_str).collect();
    let mark = format!("avendb:fork:{}@{}", note.to_hex(), at.join(","));
    assert_eq!(tags, &json!([mark]), "it names its origin and the version it copies");
    let card = rows.iter().find(|r| r["type"].as_str() == Some("card")).expect("her browser's card");
    assert_eq!(card["title"].as_str(), Some("Eve's browser"));
    assert_eq!(db["edits"]["founded"].as_u64(), Some(1));
    assert_eq!(db["edits"].get("published"), None, "a vault's schemas and lenses are its entries, writes among writes");
    let writes = db["edits"]["writes"].as_u64();
    assert!(writes.is_some_and(|n| n >= kinds(&shown_note).len() as u64 + 2), "{}", db["edits"]);
    assert!(db["edits"]["shares"].as_u64().is_some_and(|n| n >= 1), "avenCEO relays it");
    let audiences = db["audiences"].as_array().expect("its audiences");
    let one = (audiences.len(), audiences[0]["entries"].as_u64(), audiences[0]["shares"].as_array().map(Vec::len));
    assert_eq!(one, (1, Some(3), Some(0)), "her card, the note and its variant: no share splits her vault");
    let lenses = db["builtIn"]["lenses"].as_array().expect("the app's own lenses");
    let ends = |l: &avendb::lens::Lens| (l.from().to_hex(), l.to().to_hex());
    let shipped = [&avendb::lens::ARTICLE_LENS, &avendb::lens::SPARK_LENS, &avendb::lens::FUNCTION_LENS]
        .into_iter()
        .chain([&avendb::lens::VIEW_LENS, &avendb::lens::POST_LENS, &avendb::lens::STORY_LENS, &avendb::lens::AIP_LENS])
        .map(|l| ends(l))
        .collect::<Vec<_>>();
    let hex = |l: &Value, end: &str| l[end].as_str().unwrap_or_default().to_string();
    let got: Vec<_> = lenses.iter().map(|l| (hex(l, "from"), hex(l, "to"))).collect();
    assert_eq!(got, shipped, "the lenses avenDB ships, from article, spark, function, view and post v1 to v2");
    // her database's history, every edit her browser holds, in the order it took them: her vault's genesis, her
    // browser added to it, avenCEO's relay on the whole of it, and each write, every one counted and ML-DSA-65 signed
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
    // an ML-DSA-65 signature carries its key beside it
    let ml = (ML_DSA_PUBLIC_BYTES + ML_DSA_SIGNATURE_BYTES) as u64;
    let passkey = |s: &Value| s["by"] == "passkey" && s["webauthn"] == "batch" && s["pq"].as_u64() == Some(ml);
    assert!(sigs.iter().any(passkey), "{sigs:?}");
    let browser = first.node().device().to_hex();
    assert!(of("addDevice").iter().any(|o| o["fields"]["device"].as_str() == Some(browser.as_str())));
    let backup = |o: &&Value| o["fields"]["level"] == "backup" && o["fields"]["wide"] == true;
    assert!(of("share").iter().any(backup), "avenCEO's backup of the whole of her vault");
    let writes = of("write");
    let mine = writes.iter().filter(|o| o["fields"]["entry"].as_str() == Some(note.to_hex().as_str()));
    assert_eq!(mine.clone().count(), kinds(&shown_note).len(), "each write of the note");
    assert!(mine.clone().all(|o| o["counted"] == true), "every one counted");
    let device = |s: &Value| s["by"] == "device" && s["webauthn"].is_null();
    let by_device = |o: &&Value| o["sigs"].as_array().unwrap().iter().all(device);
    assert!(mine.clone().all(by_device), "signed by her browser alone, with no assertion");
    assert!(mine.clone().all(|o| o["allowed"] == true), "and allowed, as her vault's own");
    assert!(of("share").iter().all(|o| o["allowed"].is_null()), "a share is no write");
    assert!(mine.clone().all(|o| o["fields"]["sealed"].as_u64().is_some_and(|n| n > 0)), "its body by its size alone");
    let starts = |o: &&Value| o["fields"]["starts"] == true && o["fields"]["line"] == o["id"];
    assert!(mine.clone().any(starts), "the proposal's start");
    let hers = json!(v.to_hex());
    assert!(writes.iter().all(|o| o["vaults"].as_array().is_some_and(|vs| vs.contains(&hers))));
    assert!(!of("keys").is_empty());
    let ml_dsa = |s: &Value| s["alg"] == "ML-DSA-65" && s["pq"].as_u64() == Some(ml);
    let signed_all = |o: &Value| {
        let sigs = o["sigs"].as_array().unwrap();
        o["bytes"].as_u64().is_some_and(|n| n > 0) && !sigs.is_empty() && sigs.iter().all(ml_dsa)
    };
    assert!(edits.iter().all(signed_all));
    let text = log.to_string();
    assert!(!text.contains("Corn first") && !text.contains("Plant beans"), "no note's text in its history: sealed");
    // the server relays her entries and opens none of them: its rows are sealed
    // Temporary failure-only diagnostics: preserve the predicate, 60 s deadline and 50 ms cadence.
    let sealed = move |lab: &Lab, me| (lab.fetched(me, variant), lab.item(me, note).is_some());
    let end = Instant::now() + Duration::from_secs(60);
    loop {
        let (variant_writes, note_opened) = server.read(sealed).await;
        if variant_writes > 0 && !note_opened {
            break;
        }
        assert!(Instant::now() < end,
            "the server keeps her entries, sealed, within 60 s: variant_writes={variant_writes}, note_opened={note_opened}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
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
    let chunks = || {
        let chunks = film.chunks(MB as usize).map(|c| Ok(Bytes::copy_from_slice(c)));
        stream::iter(chunks.collect::<Vec<io::Result<Bytes>>>())
    };
    let put = json!({ "op": "put_file", "as": alice.to_hex(), "vault": alice.to_hex(), "name": "Harvest.mp4",
        "media": "video/mp4", "tags": [], "len": len });
    assert_eq!(run(&browser, json!({ "op": "may", "ops": [put] })).await, Ok(json!([true])));
    let (made, _) = browser.run(put, Some(chunks), None::<&NoCeremony>).await.expect("an answer");
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

/// Whether the server's node `server` holds vault `v`.
async fn holds(server: &Node, v: VaultId) -> bool {
    server.read(move |lab: &Lab, me| lab.state(me).vault(v).is_some()).await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_gated_server_takes_a_newcomers_vault_only_with_the_invite_maia_city_gave() {
    let admission = Admission::open();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url: RelayUrl = relay.url();
    let mut lab = Lab::with_entropy([3; 32]);
    let me = lab.device_with("the server", [7; 32]);
    let (relay, admits) = (Some(url.clone()), Some(admission.clone()));
    let opts = Options { relay, admission: admits, card: true, ..Options::local() };
    let server = Node::spawn(lab, me, opts).await.expect("the server's node");
    // Eve claims the server: it is avenMAIA's device, which Maia City owns, and Maia City gives it backup, so it
    // holds Maia City's invites and their claims
    let eve = Browser::new(Passkey::from_seed([5; 32]));
    let first = start("Eve's browser", &url, 7);
    let first = found(first, &server.offer(), None, &eve, [1; 32]).await.expect("her vault claims the server");
    let avenceo = server.read(|lab, me| lab.vault_of(me)).await.expect("avenMAIA");
    let coop = move |lab: &Lab, me| match lab.state(me).vault(avenceo)?.owners[..] {
        [Principal::Vault(v)] => Some(v),
        _ => None,
    };
    let maia = server.read(coop).await.expect("Maia City");
    let backup = avendb::cast::share(maia, vault(avenceo), Level::Backup, Selector::All);
    let backup = move |lab: &mut Lab, me| lab.issue(me, &[me], backup);
    first.node().act(backup).await.expect("Maia City gives its server backup");
    server.gate(true).await.unwrap();
    // Maia City defines Traveler and invites a traveler: the answer carries the secret the invite's link holds
    let company = maia.to_hex();
    let traveler = json!({ "name": "Traveler", "caps": [{ "op": "read" }] });
    let defined = run(&first, json!({ "op": "define_group", "vault": company, "group": traveler })).await;
    let group = defined.expect("Traveler")["entry"].clone();
    let invite = json!({ "op": "share_group", "over": company, "group": group, "who": "invite", "as": company });
    let invited = run(&first, invite).await.expect("an invite");
    let share = ShareId::from_hex(invited["share"].as_str().expect("its share")).expect("a share's id");
    let secret = BlobId::from_hex(invited["secret"].as_str().expect("its secret")).expect("64 hex digits").0;
    let known = || server.read(move |lab: &Lab, me| lab.state(me).share(share).is_some());
    until("the server holds the invite", known).await;
    // Frank founds his vault through the server with no invite: his browser has it, the server doesn't take it
    let frank = Browser::new(Passkey::from_seed([6; 32]));
    let franks = found(start("Frank's browser", &url, 9), &server.offer(), None, &frank, [3; 32]).await;
    let franks = franks.expect("his vault, on his browser");
    let fv = franks.vault().await.expect("his vault");
    // Erin founds hers, then her browser claims the invite her link names and hands the server her vault and the
    // claim at once, which it takes
    let erin = Browser::new(Passkey::from_seed([8; 32]));
    let erins = found(start("Erin's browser", &url, 10), &server.offer(), None, &erin, [4; 32]).await;
    let erins = erins.expect("her vault, on her browser");
    let ev = erins.vault().await.expect("her vault");
    assert!(!holds(&server, ev).await, "a vault with no invite claimed stays out");
    let claimed = erins.node().claim_invite(&server.offer(), share, secret).await.expect("her invite brings her in");
    assert_eq!(claimed, ev);
    assert!(holds(&server, ev).await, "the server takes her vault with the invite it claimed");
    // the invite is spent: Frank's browser claims it no more, and his vault stays out
    assert!(franks.node().claim_invite(&server.offer(), share, secret).await.is_err(), "a claimed invite");
    assert!(!holds(&server, fv).await, "the server leaves out a vault that came with no invite");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn ginas_keys_from_before_the_key_move_link_a_new_browser_that_opens_again_as_her_vault_knows_her() {
    let admission = Admission::open();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url: RelayUrl = relay.url();
    // Gina's passkey and Mac, made before the key move: SLH-DSA
    let mut lab = Lab::new();
    let passkey = lab.passkey_from_in("Gina", [41; 32], Suite::SlhDsa);
    let mac_g = lab.device_of(passkey, "Gina's Mac");
    let gina = human_on(&mut lab, passkey, &[mac_g]);
    let pass = lab.relay_pass(mac_g, passkey, now()).expect("her passkey's pass for her Mac");
    let opts = Options { relay: Some(url.clone()), relay_passes: vec![pass], ..Options::local() };
    let mac = Node::spawn(lab.split(mac_g, &[], [1; 32]), mac_g, opts).await.expect("her Mac's node");
    until("the relay serves her Mac", || async { relay.serves(&mac.id()) }).await;
    // her new browser: the unlock makes its passkey's pass in each suite, and her Mac hands her vault over for the
    // one in SLH-DSA, which also signs the browser's join
    let ginas = Browser::new(Passkey::from_seed([41; 32]));
    let shelf = Folder::new("gina");
    let browser = link(start_on(&shelf.0, "Gina's browser", &url, 7), &mac.offer(), &ginas, [1; 32]).await;
    let browser = browser.expect("it links through her Mac");
    assert!(ginas.steps().is_empty(), "no ceremony but the unlock");
    assert_eq!(browser.vault().await, Some(gina));
    assert_eq!(browser.passkey(), passkey, "her passkey as her vault knows it, in SLH-DSA");
    let me = browser.node().device();
    let suite = move |lab: &Lab, _| lab.keys_of(me).map(|k| k.suite());
    assert_eq!(browser.node().read(suite).await, Some(Suite::MlDsa), "a new device, in ML-DSA-65");
    let both = move |lab: &Lab, me| lab.state(me).vault(gina).map(|v| v.devices.len()) == Some(2);
    until("her Mac counts her browser among her devices", || mac.read(both)).await;
    let note = write_note(&browser, gina, gina, titled("Bees", "Two hives."), &[]).await.expect("a note");
    until("her Mac reads it", || mac.read(move |lab: &Lab, me| lab.reads(me, note))).await;
    // what her vault approves, her passkey signs in SLH-DSA, as her vault knows it
    let coop = json!({ "op": "found", "vaults": [{ "kind": "coop", "name": "Gina's Bees" }] });
    let asked = run(&browser, coop).await.expect_err("it waits for her passkey");
    assert_eq!(asked["approve"]["signers"], json!([passkey.to_hex()]), "{asked}");
    // closed, it opens again from its shelf by her passkey's unlock alone: the same device, her passkey as her vault
    // knows it
    let meta = browser.meta([1; 32], "Z2luYQ".into());
    browser.keep(&meta).await.expect("what opens it again, on its shelf");
    browser.close().await.expect("it closes");
    let again = Device::open(start_on(&shelf.0, "Gina's browser", &url, 9), &meta, ginas.unlock([1; 32], [0xaa; 32]));
    let again = again.await.expect("it opens again");
    assert_eq!((again.node().device(), again.passkey()), (me, passkey));
    assert!(shows(&again, note, "Two hives.").await, "it reads what its shelf kept");
    for n in [again.node(), &mac] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// Whether node `n` reads `body` in block 2 of entry `e`, as `shows` asks a device.
async fn node_shows(n: &Node, e: EntryId, body: &str) -> bool {
    let get = json!({ "op": "get", "entry": e.to_hex() });
    let Ok((out, _)) = n.run(get, None::<NoBytes>, None::<&NoCeremony>).await else { return false };
    let blocks = out["ok"]["record"]["blocks"].as_array().cloned().unwrap_or_default();
    blocks.iter().any(|b| b["id"] == 2 && b["text"] == body)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn hanas_browser_and_passkey_from_before_the_key_move_move_in_one_ceremony_and_it_opens_again_as_its_next_key() {
    let admission = Admission::open();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url: RelayUrl = relay.url();
    // Hana's passkey, Mac and browser, made before the key move: SLH-DSA. Her browser's secret is its own, kept masked
    // by her passkey's PRF output on its salt, as a page keeps it
    let mut lab = Lab::new();
    let passkey = lab.passkey_from_in("Hana", [43; 32], Suite::SlhDsa);
    let mac_h = lab.device_of(passkey, "Hana's Mac");
    let (secret, nonce) = ([44; 32], [1; 32]);
    let browser_h = lab.device_with_in("Hana's browser", secret, Suite::SlhDsa);
    let hana = human_on(&mut lab, passkey, &[mac_h, browser_h]);
    lab.sync_all(1);
    let pass = |lab: &mut Lab, d| lab.relay_pass(d, passkey, now()).expect("her passkey's pass");
    let opts = Options { relay: Some(url.clone()), relay_passes: vec![pass(&mut lab, mac_h)], ..Options::local() };
    let mac = Node::spawn(lab.split(mac_h, &[], [1; 32]), mac_h, opts).await.expect("her Mac's node");
    let shelf = Folder::new("hana");
    let (relay_passes, on) = (vec![pass(&mut lab, browser_h)], Some(disk::open(&shelf.0).expect("its shelf")));
    let opts = Options { relay: Some(url.clone()), relay_passes, shelf: on, ..Options::local() };
    let browser = Node::spawn(lab.split(browser_h, &[], [2; 32]), browser_h, opts).await.expect("her browser's node");
    until("the relay serves both", || async { relay.serves(&mac.id()) && relay.serves(&browser.id()) }).await;
    browser.shutdown().await.expect("it closes, its shelf holding what it holds");
    let hanas = Browser::new(Passkey::from_seed([43; 32]));
    let (p256, pad) = {
        let held = &hanas.0.lock().expect("the authenticator").0;
        (held.public(), held.prf(&device_salt(&nonce)))
    };
    let mask: [u8; 32] = std::array::from_fn(|i| secret[i] ^ pad[i]);
    let (name, relay_at, credential) = ("Hana's browser".to_string(), url.to_string(), "aGFuYQ".to_string());
    let (device, follow, query_depth, touch) = (browser_h, vec![], None, None);
    let meta = Meta { name, relay: relay_at, nonce, mask, credential, p256, device, follow, query_depth, touch };
    keep_meta(&shelf.0, &meta).await;
    // her browser opens by her passkey's unlock, as itself, her passkey as her vault knows it
    let opened = Device::open(start_on(&shelf.0, "Hana's browser", &url, 3), &meta, hanas.unlock(nonce, [0xaa; 32]));
    let opened = opened.await.expect("it opens");
    assert_eq!((opened.node().device(), opened.passkey()), (browser_h, passkey));
    let note = write_note(&opened, hana, hana, titled("Kites", "Red and blue."), &[]).await.expect("a note");
    until("her Mac reads it", || node_shows(&mac, note, "Red and blue.")).await;
    // after the unlock the page asks once more: her passkey and her browser move, in one ceremony
    let moving = opened.moving().await.expect("what moves");
    assert_eq!(moving, Some(Moving { passkey: true, touch: false, device: true, avens: 0, ..Moving::default() }));
    let again = start_on(&shelf.0, "Hana's browser", &url, 4);
    let shown_steps = again.progress.clone();
    let sign = |challenge, moving: Moving| {
        let hanas = &hanas;
        async move {
            assert!(moving.passkey && !moving.touch, "her passkey alone signs");
            Ok(Signing { passkey: Some(hanas.ceremony(challenge, Step::Approve).await?), touch: None })
        }
    };
    let moved = opened.move_keys(again, sign, |_| async { Ok(()) }).await.expect("it moves");
    let moved = moved.expect("her keys moved");
    assert_eq!(hanas.steps(), [Step::Approve], "one ceremony");
    assert_eq!(steps(&shown_steps), ["restore", "node", "check"], "it opened again with no unlock");
    // her browser opened again as its next key, in ML-DSA-65, on the same shelf and the same endpoint; her passkey
    // signs as its next key too
    let (me, next) = (moved.node().device(), moved.passkey());
    assert!(me != browser_h && next != passkey);
    assert_eq!(moved.node().id(), opened.node().id(), "one secret, one endpoint, which the relay knows");
    let suites = moved.node().read(move |lab, _| [me, next].map(|s| lab.keys_of(s).map(|k| k.suite()))).await;
    assert_eq!(suites, [Some(Suite::MlDsa); 2]);
    let kept = Meta::load(&disk::open(&shelf.0).expect("its shelf")).await.expect("it reads").expect("what opens it");
    assert_eq!(kept, Meta { device: me, ..meta.clone() }, "what opens it again names its next key");
    // her Mac sees her passkey's next key as an owner beside the old, which stays her vault's root, and her
    // browser's next key beside the old; each reads her note, and her Mac her browser's edit as its next key
    let members = move |lab: &Lab, d| lab.state(d).vault(hana).map(|v| (v.owners.clone(), v.root, v.devices.clone()));
    let after = Some(([passkey, next].map(Principal::Signer).to_vec(), Some(passkey), vec![mac_h, browser_h, me]));
    until("her Mac sees the move", || async { mac.read(members).await == after }).await;
    assert_eq!(moved.node().read(members).await, after);
    assert!(shows(&moved, note, "Red and blue.").await, "it reads what it read");
    run(&moved, set_text(hana, note, None, 2, "Red, blue and green.")).await.expect("it edits her note");
    until("her Mac reads the edit", || node_shows(&mac, note, "Red, blue and green.")).await;
    // nothing more moves here: her Mac moves at its own next unlock. Her earlier keys stay: she governs no server
    // whose holding tells her browser it holds all, and removing them over less would cut what it lacks. What her
    // browser's earlier key signed as it moved, its passkey's next key vouches for alone, in one more ceremony
    let moving = moved.moving().await.expect("what moves");
    assert_eq!(moving, Some(Moving { passkey: true, checkpoint: true, ..Moving::default() }));
    let sign = |challenge, _: Moving| {
        let hanas = &hanas;
        async move { Ok(Signing { passkey: Some(hanas.ceremony(challenge, Step::Approve).await?), touch: None }) }
    };
    let same = start_on(&shelf.0, "Hana's browser", &url, 6);
    let stays = moved.move_keys(same, sign, |_| async { Ok(()) }).await.expect("her passkey signs it");
    assert!(stays.is_none(), "her browser stays as it is");
    assert_eq!(moved.moving().await.expect("what moves"), None, "nothing left: her Mac's edits wait for its move");
    // closed, it opens again from its shelf as its next key, by her passkey's unlock alone
    moved.close().await.expect("it closes");
    let again = Device::open(start_on(&shelf.0, "Hana's browser", &url, 5), &kept, hanas.unlock(nonce, [0xbb; 32]));
    let again = again.await.expect("it opens again");
    assert_eq!((again.node().device(), again.passkey()), (me, next));
    assert!(shows(&again, note, "Red, blue and green.").await, "it reads what its shelf kept");
    assert_eq!(again.moving().await.expect("what moves"), None);
    for n in [again.node(), &mac] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn ivys_vault_takes_the_master_keys_next_key_at_her_browsers_unlock_by_her_passkey_and_its_consent() {
    let admission = Admission::open();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url: RelayUrl = relay.url();
    // Ivy's passkey, Mac and browser in ML-DSA-65 already, her vault founded with the master recovery key among its
    // owners as it was before the key moved, in SLH-DSA (K4)
    let mut lab = Lab::new();
    let (secret_key, suite) = ([21; 32], Suite::SlhDsa);
    let old = lab.set_recovery(Arc::new(RecoveryKey::of_in(secret_key, suite)));
    let passkey = lab.passkey_from("Ivy", [48; 32]);
    let mac_i = lab.device_of(passkey, "Ivy's Mac");
    let (secret, nonce) = ([49; 32], [3; 32]);
    let browser_i = lab.device_with("Ivy's browser", secret);
    let (owners, signers) = lab.human_owners(passkey);
    let genesis = Action::Genesis { kind: Kind::Human, owners, threshold: 1, root: Some(passkey), nonce: 0, seal_to: vec![] };
    let ivy = VaultId::from(lab.submit(mac_i, &signers, genesis).expect("her passkey and the key's consent"));
    for d in [mac_i, browser_i] {
        let add = Action::Share(Sharing::Device { vault: ivy, device: d, seal_to: None });
        lab.submit(mac_i, &[passkey, d], add).expect("her passkey adds its device");
    }
    lab.sync_all(1);
    let pass = |lab: &mut Lab, d| lab.relay_pass(d, passkey, now()).expect("her passkey's pass");
    let opts = Options { relay: Some(url.clone()), relay_passes: vec![pass(&mut lab, mac_i)], ..Options::local() };
    let mac = Node::spawn(lab.split(mac_i, &[], [1; 32]), mac_i, opts).await.expect("her Mac's node");
    let shelf = Folder::new("ivy");
    let (relay_passes, on) = (vec![pass(&mut lab, browser_i)], Some(disk::open(&shelf.0).expect("its shelf")));
    let opts = Options { relay: Some(url.clone()), relay_passes, shelf: on, ..Options::local() };
    let browser = Node::spawn(lab.split(browser_i, &[], [2; 32]), browser_i, opts).await.expect("her browser's node");
    until("the relay serves both", || async { relay.serves(&mac.id()) && relay.serves(&browser.id()) }).await;
    browser.shutdown().await.expect("it closes, its shelf holding what it holds");
    let ivys = Browser::new(Passkey::from_seed([48; 32]));
    let (p256, pad) = {
        let held = &ivys.0.lock().expect("the authenticator").0;
        (held.public(), held.prf(&device_salt(&nonce)))
    };
    let mask: [u8; 32] = std::array::from_fn(|i| secret[i] ^ pad[i]);
    let (name, relay_at, credential) = ("Ivy's browser".to_string(), url.to_string(), "aXZ5".to_string());
    let (device, follow, query_depth, touch) = (browser_i, vec![], None, None);
    let meta = Meta { name, relay: relay_at, nonce, mask, credential, p256, device, follow, query_depth, touch };
    keep_meta(&shelf.0, &meta).await;
    // avenDB's next build carries the master key in ML-DSA-65, from the same secret
    let master = Arc::new(RecoveryKey::of(secret_key));
    let new = master.id();
    let with_master = |seed| Start { recovery: Some(master.clone()), ..start_on(&shelf.0, "Ivy's browser", &url, seed) };
    let opened = Device::open(with_master(3), &meta, ivys.unlock(nonce, [0xaa; 32])).await.expect("it opens");
    assert_eq!((opened.node().device(), opened.passkey()), (browser_i, passkey));
    // her passkey alone signs, in one ceremony: the key's next key by its standing consent, and no device moves
    let moving = opened.moving().await.expect("what moves");
    assert_eq!(moving, Some(Moving { passkey: true, touch: false, device: false, avens: 0, ..Moving::default() }));
    let sign = |challenge, _: Moving| {
        let ivys = &ivys;
        async move { Ok(Signing { passkey: Some(ivys.ceremony(challenge, Step::Approve).await?), touch: None }) }
    };
    let moved = opened.move_keys(with_master(4), sign, |_| async { Ok(()) }).await.expect("it moves");
    let moved = moved.expect("the master key moved");
    assert_eq!(ivys.steps(), [Step::Approve], "one ceremony");
    assert_eq!((moved.node().device(), moved.passkey()), (browser_i, passkey), "her own keys stay");
    // her Mac sees the master key's next key as an owner beside the earlier one, which stays, her passkey the root
    let members = move |lab: &Lab, d| lab.state(d).vault(ivy).map(|v| (v.owners.clone(), v.root));
    let after = Some(([passkey, old, new].map(Principal::Signer).to_vec(), Some(passkey)));
    until("her Mac sees the move", || async { mac.read(members).await == after }).await;
    assert_eq!(moved.node().read(members).await, after);
    // nothing left to move, and the earlier master key stays, as she governs no server
    assert_eq!(moved.moving().await.expect("what moves"), None, "nothing left to move");
    for n in [moved.node(), &mac] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn hanas_ipad_away_as_her_browser_moved_learns_the_move_from_its_next_key() {
    let admission = Admission::open();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url: RelayUrl = relay.url();
    // Hana's passkey, Mac, iPad and browser, made before the key move: SLH-DSA
    let mut lab = Lab::new();
    let passkey = lab.passkey_from_in("Hana", [43; 32], Suite::SlhDsa);
    let mac_h = lab.device_of(passkey, "Hana's Mac");
    let ipad_h = lab.device_of(passkey, "Hana's iPad");
    let (secret, nonce) = ([44; 32], [1; 32]);
    let browser_h = lab.device_with_in("Hana's browser", secret, Suite::SlhDsa);
    let hana = human_on(&mut lab, passkey, &[mac_h, ipad_h, browser_h]);
    lab.sync_all(1);
    let pass = |lab: &mut Lab, d| lab.relay_pass(d, passkey, now()).expect("her passkey's pass");
    let opts = Options { relay: Some(url.clone()), relay_passes: vec![pass(&mut lab, mac_h)], ..Options::local() };
    let mac = Node::spawn(lab.split(mac_h, &[], [1; 32]), mac_h, opts).await.expect("her Mac's node");
    // her iPad is away all along, as a server restarts or a phone sleeps: it holds what she had before the move
    let relay_passes = vec![pass(&mut lab, ipad_h)];
    let ipad_opts = Options { relay: Some(url.clone()), relay_passes, ..Options::local() };
    let ipad_lab = lab.split(ipad_h, &[], [5; 32]);
    let shelf = Folder::new("hana-away");
    let (relay_passes, on) = (vec![pass(&mut lab, browser_h)], Some(disk::open(&shelf.0).expect("its shelf")));
    let opts = Options { relay: Some(url.clone()), relay_passes, shelf: on, ..Options::local() };
    let browser = Node::spawn(lab.split(browser_h, &[], [2; 32]), browser_h, opts).await.expect("her browser's node");
    until("the relay serves both", || async { relay.serves(&mac.id()) && relay.serves(&browser.id()) }).await;
    browser.shutdown().await.expect("it closes, its shelf holding what it holds");
    let hanas = Browser::new(Passkey::from_seed([43; 32]));
    let (p256, pad) = {
        let held = &hanas.0.lock().expect("the authenticator").0;
        (held.public(), held.prf(&device_salt(&nonce)))
    };
    let mask: [u8; 32] = std::array::from_fn(|i| secret[i] ^ pad[i]);
    let (name, relay_at, credential) = ("Hana's browser".to_string(), url.to_string(), "aGFuYQ".to_string());
    let (device, follow, query_depth, touch) = (browser_h, vec![], None, None);
    let meta = Meta { name, relay: relay_at, nonce, mask, credential, p256, device, follow, query_depth, touch };
    keep_meta(&shelf.0, &meta).await;
    let opened = Device::open(start_on(&shelf.0, "Hana's browser", &url, 3), &meta, hanas.unlock(nonce, [0xaa; 32]));
    let opened = opened.await.expect("it opens");
    let moving = opened.moving().await.expect("what moves, once it caught up with her Mac");
    assert_eq!(moving, Some(Moving { passkey: true, touch: false, device: true, avens: 0, ..Moving::default() }));
    // her Mac goes away before she moves: no peer sees the move as it happens
    mac.shutdown().await.expect("her Mac's node stops");
    let again = start_on(&shelf.0, "Hana's browser", &url, 4);
    let sign = |challenge, _: Moving| {
        let hanas = &hanas;
        async move { Ok(Signing { passkey: Some(hanas.ceremony(challenge, Step::Approve).await?), touch: None }) }
    };
    let moved = opened.move_keys(again, sign, |_| async { Ok(()) }).await.expect("it moves");
    let moved = moved.expect("her keys moved");
    let (me, next) = (moved.node().device(), moved.passkey());
    // her iPad, which never saw the move, comes on: it learns it from her browser's next key
    let ipad = Node::spawn(ipad_lab, ipad_h, ipad_opts).await.expect("her iPad's node");
    let owns = move |lab: &Lab, d| {
        let vault = lab.state(d).vault(hana);
        vault.is_some_and(|v| v.owners.contains(&Principal::Signer(next)) && v.devices.contains(&me))
    };
    until("her iPad sees the move", || async { ipad.read(owns).await }).await;
    for n in [moved.node(), &ipad] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// Sam's, made before the key move: his passkey and Mac in SLH-DSA, and his vault, which claimed the server, so it owns
/// Maia City, which owns avenMAIA, the server's aven. His vault and Maia City each give avenMAIA backup and have a name.
struct Sams {
    lab: Lab,
    passkey: SignerId,
    mac: SignerId,
    sam: VaultId,
    server: SignerId,
    maia: VaultId,
}

fn sams() -> Sams {
    let mut lab = Lab::new();
    let passkey = lab.passkey_from_in("Sam", [45; 32], Suite::SlhDsa);
    let mac = lab.device_of(passkey, "Sam's Mac");
    let server = lab.device("the server");
    let sam = human_on(&mut lab, passkey, &[mac]);
    let avenceo = claim_on(&mut lab, mac, passkey, sam, server);
    let maia = match lab.state(mac).vault(avenceo).expect("avenMAIA").owners[..] {
        [Principal::Vault(v)] => v,
        _ => panic!("Maia City owns avenMAIA"),
    };
    for (v, name) in [(sam, "Sam"), (maia, "Maia City")] {
        let backup = avendb::cast::share(v, vault(avenceo), Level::Backup, Selector::All);
        lab.issue(mac, &[mac], backup).expect("avenMAIA keeps it");
        let op = json!({ "op": "profile", "vault": v.to_hex(), "name": name });
        assert!(avendb::engine::run(&mut lab, mac, &op).get("ok").is_some(), "{name}'s profile");
    }
    lab.sync(mac, server);
    Sams { lab, passkey, mac, sam, server, maia }
}

/// Whether device `d` shows vault `v` by its name `name`.
async fn shows_named(d: &Device, v: VaultId, name: &str) -> bool {
    let w = world_of(d).await;
    w["vaults"].as_array().is_some_and(|vs| vs.iter().any(|x| x["id"] == v.to_hex() && x["name"] == name))
}

/// The server's node: through the relay at `url`, letting in whom `admission` names.
async fn server_of(lab: &mut Lab, server: SignerId, url: &RelayUrl, admission: &Admission) -> Node {
    let (relay, admission) = (Some(url.clone()), Some(admission.clone()));
    let opts = Options { relay, admission, card: true, ..Options::local() };
    Node::spawn(lab.split(server, &[], [2; 32]), server, opts).await.expect("the server's node")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn sams_phone_signs_in_through_the_server_moves_his_passkey_at_once_and_shows_his_name_and_his_coop() {
    let admission = Admission::open();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url: RelayUrl = relay.url();
    let Sams { mut lab, passkey, sam, server: server_d, maia, .. } = sams();
    let server = server_of(&mut lab, server_d, &url, &admission).await;
    // his Mac is away. His new phone signs in through the server with his passkey alone, and knows the server from
    // then on, as avenMAIA's device, whatever the server handed it yet
    let sams = Browser::new(Passkey::from_seed([45; 32]));
    let shelf = Folder::new("sam");
    let phone = link(start_on(&shelf.0, "Sam's phone", &url, 7), &server.offer(), &sams, [1; 32]).await;
    let phone = phone.expect("it links through the server");
    assert_eq!((phone.vault().await, phone.passkey()), (Some(sam), passkey));
    let peers = phone.node().read(|lab: &Lab, me| lab.peers(me).into_iter().map(|(s, _)| s).collect::<Vec<_>>()).await;
    assert!(peers.contains(&server_d), "it syncs with the server: {peers:?}");
    // the page asks at once to move his passkey, which he does; then it shows his name and Maia City
    let meta = phone.meta([1; 32], "c2Ft".into());
    phone.keep(&meta).await.expect("what opens it again, on its shelf");
    let moving = phone.moving().await.expect("what moves");
    assert_eq!(moving, Some(Moving { passkey: true, touch: false, device: false, avens: 0, ..Moving::default() }));
    let sign = |challenge, _: Moving| {
        let sams = &sams;
        async move { Ok(Signing { passkey: Some(sams.ceremony(challenge, Step::Approve).await?), touch: None }) }
    };
    let again = start_on(&shelf.0, "Sam's phone", &url, 8);
    let moved = phone.move_keys(again, sign, |_| async { Ok(()) }).await.expect("it moves");
    let moved = moved.expect("his passkey moved");
    until("it shows his name", || shows_named(&moved, sam, "Sam")).await;
    until("it shows Maia City", || shows_named(&moved, maia, "Maia City")).await;
    for n in [moved.node(), &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn sams_phone_moves_his_passkey_only_once_it_brought_what_the_server_keeps() {
    let admission = Admission::open();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url: RelayUrl = relay.url();
    let Sams { mut lab, passkey, mac, sam, server: server_d, maia } = sams();
    // his phone signed in through the server: it holds what a link hands over, his vault's link card, its own join
    // and the server's card (`Device::link`), and nothing of the rest yet
    let (secret, nonce) = ([46; 32], [1; 32]);
    let phone_s = lab.device_with_in("Sam's phone", secret, Suite::MlDsa);
    let card = lab.link_card(server_d, passkey);
    lab.receive(phone_s, card, vec![]);
    let join = lab.join(phone_s, passkey).expect("it joins his vault");
    lab.accept_join(server_d, phone_s, join).expect("the server takes the join");
    let card = lab.card(server_d);
    lab.receive(phone_s, card, vec![]);
    let shelf = Folder::new("sam-moves");
    let on = Some(disk::open(&shelf.0).expect("its shelf"));
    let phone = Node::spawn(lab.split(phone_s, &[], [3; 32]), phone_s, Options { shelf: on, ..Options::local() });
    phone.await.expect("its node").shutdown().await.expect("it closes, its shelf holding what it holds");
    let sams = Browser::new(Passkey::from_seed([45; 32]));
    let (p256, pad) = {
        let held = &sams.0.lock().expect("the authenticator").0;
        (held.public(), held.prf(&device_salt(&nonce)))
    };
    let mask: [u8; 32] = std::array::from_fn(|i| secret[i] ^ pad[i]);
    let (name, relay_at, credential) = ("Sam's phone".to_string(), url.to_string(), "c2Ft".to_string());
    let (device, follow, query_depth, touch) = (phone_s, vec![], None, None);
    let meta = Meta { name, relay: relay_at, nonce, mask, credential, p256, device, follow, query_depth, touch };
    keep_meta(&shelf.0, &meta).await;
    // it opens while the server and his Mac are away: it caught up with none of them, so nothing moves yet
    let opened = Device::open(start_on(&shelf.0, "Sam's phone", &url, 4), &meta, sams.unlock(nonce, [0xaa; 32]));
    let opened = opened.await.expect("it opens");
    assert_eq!(opened.vault().await, Some(sam));
    let waits = opened.moving().await.expect_err("a move waits for a peer");
    assert_eq!(waits.to_string(), avendb_browser::NOT_CAUGHT_UP);
    // the server is back: the phone brings his name and Maia City from it, and then moves his passkey
    let server = server_of(&mut lab, server_d, &url, &admission).await;
    until("it shows his name", || shows_named(&opened, sam, "Sam")).await;
    until("it shows Maia City", || shows_named(&opened, maia, "Maia City")).await;
    let moving = opened.moving().await.expect("what moves");
    assert_eq!(moving, Some(Moving { passkey: true, touch: false, device: false, avens: 0, ..Moving::default() }));
    let sign = |challenge, _: Moving| {
        let sams = &sams;
        async move { Ok(Signing { passkey: Some(sams.ceremony(challenge, Step::Approve).await?), touch: None }) }
    };
    let again = start_on(&shelf.0, "Sam's phone", &url, 5);
    let moved = opened.move_keys(again, sign, |_| async { Ok(()) }).await.expect("it moves");
    let moved = moved.expect("his passkey moved");
    let next = moved.passkey();
    assert!(next != passkey);
    assert!(shows_named(&moved, sam, "Sam").await && shows_named(&moved, maia, "Maia City").await);
    // the server learns of the move: his passkey's next key is an owner of his vault
    let owner = Principal::Signer(next);
    let owns = move |lab: &Lab, me| lab.state(me).vault(sam).is_some_and(|v| v.owners.contains(&owner));
    until("the server sees the move", || async { server.read(owns).await }).await;
    // then his earlier keys retire, once the phone holds what the server holds, in one more ceremony: his passkey's
    // earlier key hands the root on and goes, and his Mac, away and never moved, goes too (he links it again)
    let ready = || async { moved.moving().await.ok().flatten().is_some_and(|m| !m.behind) };
    until("it holds what the server holds", ready).await;
    let moving = moved.moving().await.expect("what retires").expect("his earlier keys retire");
    let (root, owner) = (Retire::Root { old: passkey, new: next }, Retire::Owner(passkey));
    let retire = vec![root, owner, Retire::Device { vault: sam, device: mac }];
    assert_eq!(moving, Moving { passkey: true, retire, ..Moving::default() });
    let again = start_on(&shelf.0, "Sam's phone", &url, 6);
    let retired = moved.move_keys(again, sign, |_| async { Ok(()) }).await.expect("they retire");
    assert!(retired.is_none(), "the phone stays as it is");
    assert_eq!(sams.steps(), [Step::Approve, Step::Approve], "one ceremony each");
    // the server sees his next passkey as his vault's one owner and its root, the phone its one device; his name and
    // his coop stay, and the server takes the phone's next edit of his vault
    let members = move |lab: &Lab, me| lab.state(me).vault(sam).map(|v| (v.owners.clone(), v.root, v.devices.clone()));
    let phone_d = moved.node().device();
    let after = Some((vec![Principal::Signer(next)], Some(next), vec![phone_d]));
    until("the server sees the old keys go", || async { server.read(members).await == after }).await;
    assert_eq!(moved.node().read(members).await, after);
    assert!(shows_named(&moved, sam, "Sam").await && shows_named(&moved, maia, "Maia City").await, "his coop stays");
    let by_phone = move |lab: &Lab, me| lab.log(me).edits().iter().filter(|e| e.sigs().any(|s| s == phone_d)).count();
    let before = server.read(by_phone).await;
    let op = json!({ "op": "profile", "vault": sam.to_hex(), "name": "Sam S." });
    run(&moved, op).await.expect("it still edits his vault");
    until("the server takes the edit", || async { server.read(by_phone).await > before }).await;
    assert!(shows_named(&moved, sam, "Sam S.").await);
    assert_eq!(moved.moving().await.expect("what moves"), None, "nothing left");
    for n in [moved.node(), &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}
