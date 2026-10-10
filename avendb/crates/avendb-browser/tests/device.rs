//! A browser's device, run natively (P8d, P8e): its person's passkey stays in the browser's authenticator, a software
//! passkey here, which makes each ceremony the device asks for. Eve's first browser founds her vault through the relay,
//! open to sign-up, with the passkey she signed up to maiaCITY with, and the server learns it; her second browser
//! links through the first one's code, browser to browser; the first opens again from what its store kept; with both
//! lost, her passkey alone gets her vault back on a new browser, through the server. Alice's browser links through the
//! code her Mac shows and edits Welcome. The first person to found their vault through a new server claims it from
//! their first browser, in the same ceremony (P8f), and her vault founds four more vaults it owns in one more ceremony:
//! her browser acts as each of them, and what each shares, a note by its id, its todos by their type, or the whole of
//! it, decides what the others may read and write. Every device, the server too, trusts no curve: only the writes a
//! checkpoint covers count.
//! `tests/page.rs` runs the same in Chromium, the passkey in its virtual authenticator.

use std::future::Future;
use std::net::SocketAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use avendb::cast::*;
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::keys::KeyFam;
use avendb::lab::Lab;
use avendb::lens::Status;
use avendb::policy::{Kind, Principal, Role};
use avendb::sign::{Ceremony, Passkey, device_salt};
use avendb::slice::{Selector, Slice};
use avendb_browser::{Device, EntryView, Fresh, PROFILE, Start, Unlock, What, World as Seen, backup};
use avendb_net::{Admission, Authenticator, Node, Offer, Options, Step};
use avendb_server::Relay;
use iroh::RelayUrl;
use serde_json::{Value, json};

/// A socket of the system's choosing on this machine.
const LOOPBACK: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 0);

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
    Start { name: name.into(), relay: url.clone(), entropy: [seed; 32], now: now(), direct: false, store: None }
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
    Device::found(start, server, p256, fresh, unlock, browser).await
}

/// A new browser's device at `start` that links through the device whose code is `offer`, as the page's does
/// (`PageDevice::link`): `browser` unlocks it, its salt ending in `nonce`, then signs its join.
async fn link(start: Start, offer: &Offer, browser: &Browser, nonce: [u8; 32]) -> anyhow::Result<Device> {
    let (fresh, unlock) = browser.fresh(&start, nonce);
    Device::link(start, offer, fresh, unlock, browser).await
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

/// The names of its person's devices as device `d` shows them, each on its card, or "?" for one that wrote none yet.
async fn names(d: &Device) -> Vec<String> {
    let devices = d.account().await.map(|a| a.devices).unwrap_or_default();
    devices.into_iter().map(|(_, name)| name.unwrap_or_else(|| "?".into())).collect()
}

/// Op `op` of the ops engine run on device `d` (`Device::run`), as the page runs every read and change: what it did,
/// or its refusal, whole.
async fn run(d: &Device, op: Value) -> Result<Value, Value> {
    let out = d.run(op).await;
    out.get("ok").cloned().ok_or(out)
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

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn eves_first_browser_founds_her_vault_her_second_links_through_it_and_the_first_opens_again() {
    let admission = Admission::open();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url: RelayUrl = relay.url();
    let mut w = world();
    let server_d = w.server;
    let opts = Options { relay: Some(url.clone()), admission: Some(admission.clone()), card: true, ..Options::local() };
    let server = node(&mut w, server_d, &[], 2, opts).await;
    // Eve is new to avenDB, but signed up to maiaCITY with her passkey: her first browser founds her vault with it
    let eve = Browser::new(Passkey::from_seed([5; 32]));
    let p256 = eve.0.lock().expect("the authenticator").0.public();
    let first = start("Eve's browser", &url, 7);
    let first = found(first, &server.offer(), None, &eve, [1; 32]).await.expect("her vault");
    assert_eq!(eve.steps(), [Step::Found], "after the unlock, one ceremony for her vault and her browser");
    assert_eq!(first.p256(), p256, "it learned her passkey's key: the one of the unlock's the second verifies under");
    assert!(first.node().endpoint().bound_sockets().is_empty(), "with no UDP of its own");
    let vault = first.vault().await.expect("the browser belongs to her vault");
    assert!(!first.owns_aven().await, "avenCEO is Alice's vault's, which claimed the server before Eve");
    until("the server learns her browser from what it relays", || async { admission.admits(&first.node().id()) }).await;
    assert!(titles(&first).await.is_empty(), "no note yet: her browser's card is none");
    // her account: her vault, her passkey its root, and her browser, by the name on its card
    let account = first.account().await.expect("her account");
    assert_eq!((account.vault, account.root, account.owns_aven), (vault, Some(first.passkey()), false));
    assert_eq!(account.devices, [(first.node().device(), Some("Eve's browser".into()))]);
    let note = write_note(&first, vault, vault, titled("Seeds", "Tomatoes in March."), &[]).await.expect("a note");
    let holds = move |lab: &Lab, me| lab.fetched(me, note) > 0;
    until("the server keeps her note", || server.read(holds)).await;
    // her second browser links through the first one's code, in two ceremonies: the unlock, then its join
    let other = start("Eve's other browser", &url, 8);
    let code = first.node().offer();
    let other = link(other, &code, &eve, [2; 32]).await.expect("it links through the first");
    assert_eq!(eve.steps(), [Step::Join]);
    assert_eq!((other.vault().await, other.p256()), (Some(vault), p256), "it learned her passkey's key");
    until("it reads her note", || shows(&other, note, "Tomatoes in March.")).await;
    run(&other, set_text(vault, note, None, 2, "Tomatoes in April.")).await.expect("it edits the note");
    until("the first reads the edit", || shows(&first, note, "Tomatoes in April.")).await;
    // the second writes its card, as it holds her vault's keys now; each shows both browsers by name
    assert!(other.card("Eve's other browser".into()).await.expect("its card"), "it had none");
    let both = ["Eve's browser", "Eve's other browser"];
    until("the first shows both by name", || async { names(&first).await == both }).await;
    assert_eq!(names(&other).await, both);
    // a card renames its device; the notes never show one
    assert!(first.card("Eve's Mac".into()).await.expect("a new name"));
    assert!(!first.card("Eve's Mac".into()).await.expect("the same name"), "nothing to write");
    let renamed = ["Eve's Mac", "Eve's other browser"];
    until("the second shows the new name", || async { names(&other).await == renamed }).await;
    assert_eq!(titles(&other).await, ["Seeds"]);
    // the first browser closes, and opens again from what its store kept, in the unlock alone
    let edits = first.edits(0).await.expect("its edits");
    let mut keys = vec![];
    for id in first.key_ids().await {
        keys.push(first.key(id).await.expect("a key it holds"));
    }
    assert_eq!(first.edits(edits.len() + 1).await, None, "it holds no more edits than these");
    assert_eq!(first.edits(edits.len()).await, Some(vec![]));
    first.node().shutdown().await.expect("the node shuts down");
    let kept = backup(&edits, keys.clone());
    let (mask, page) = (first.mask(), [0xaa; 32]);
    assert!(mask.is_some(), "it keeps its secret masked by the PRF output on its salt");
    let unmasked = Device::open(start("Eve's browser", &url, 9), p256, None, eve.unlock([1; 32], page), &kept);
    assert!(unmasked.await.is_err(), "unmasked, the PRF output alone is another device's secret");
    let again = start("Eve's browser", &url, 9);
    let again = Device::open(again, p256, mask, eve.unlock([1; 32], page), &kept).await.expect("it opens again");
    assert!(eve.steps().is_empty(), "with no ceremony but the unlock");
    assert_eq!(again.node().id(), first.node().id(), "the same device");
    assert!(shows(&again, note, "Tomatoes in April.").await, "it reads what its store kept");
    assert_eq!(names(&again).await, renamed, "and both cards");
    run(&other, set_text(vault, note, None, 2, "Tomatoes in May.")).await.expect("another edit");
    let may = || shows(&again, note, "Tomatoes in May.");
    until("the relay lets it in again, as the server knows it", may).await;
    // a store cut short reads back up to where it was cut; an unlock of another passkey opens nothing
    let mut cut = edits.clone();
    cut[3].truncate(10);
    assert_eq!(backup(&cut, keys.clone()).signed().len(), 3);
    let mallory = Browser::new(Passkey::from_seed([6; 32]));
    let theirs = start("Eve's browser", &url, 10);
    let theirs = Device::open(theirs, p256, mask, mallory.unlock([1; 32], page), &kept);
    assert!(theirs.await.is_err(), "not her passkey's ceremony");
    // with both her browsers lost, her passkey alone gets her vault back on a new one, through the server (P8c)
    for n in [again.node(), other.node()] {
        n.shutdown().await.expect("the node shuts down");
    }
    let new = start("Eve's new browser", &url, 11);
    let new = link(new, &server.offer(), &eve, [3; 32]).await.expect("it links through the server");
    assert_eq!(eve.steps(), [Step::Join]);
    assert_eq!(new.vault().await, Some(vault), "to her vault");
    until("it reads her note", || shows(&new, note, "Tomatoes in May.")).await;
    assert!(new.card("Eve's new browser".into()).await.expect("its card"));
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
    assert_eq!(alices.steps(), [Step::Join]);
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
    // an edit its view refuses fails: Alice's own vault, acting as itself and not for the coop, holds no cap on Welcome
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
    // vault, adds itself to it and claims the server, all in one ceremony after the unlock
    let eve = Browser::new(Passkey::from_seed([5; 32]));
    let p256 = eve.0.lock().expect("the authenticator").0.public();
    let first = start("Eve's browser", &url, 7);
    let first = found(first, &server.offer(), Some(p256), &eve, [1; 32]).await.expect("her vault claims the server");
    assert_eq!(eve.steps(), [Step::Found], "one ceremony for her vault, her browser and the claim");
    let vault = first.vault().await.expect("her vault");
    let avenceo = server.read(|lab, me| lab.vault_of(me)).await.expect("the server is avenCEO's device");
    let shape = move |lab: &Lab, _| lab.state(me).vault(avenceo).map(|v| (v.kind, v.owners.clone()));
    assert_eq!(server.read(shape).await, Some((Kind::Aven, vec![Principal::Vault(vault)])), "owned by her vault");
    assert!(first.owns_aven().await, "as her browser shows");
    // her vault gives avenCEO relay on the whole of it: the server keeps her note and knows her browser for good
    let note = write_note(&first, vault, vault, titled("Seeds", "Tomatoes in March."), &[]).await.expect("a note");
    let holds = move |lab: &Lab, me| lab.fetched(me, note) > 0;
    until("the server keeps her note", || server.read(holds)).await;
    until("and knows her browser", || async { admission.admits(&first.node().id()) }).await;
    let stranger = Passkey::from_seed([9; 32]).id();
    assert!(!admission.honours(&stranger), "claimed, its relay honours no stranger's pass");
    for n in [first.node(), &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// The role vault `v` holds in `roles`, if any.
fn role(roles: &[(VaultId, Role)], v: VaultId) -> Option<Role> {
    roles.iter().find(|(x, _)| *x == v).map(|(_, r)| *r)
}

/// Entry `e` in the world `w` a device shows.
fn item(w: &Seen, e: EntryId) -> &EntryView {
    w.entries.iter().find(|i| i.entry == e).expect("the entry")
}

/// Vault `v`'s name in the world `w` a device shows, as its profile reads.
fn named(w: &Seen, v: VaultId) -> Option<String> {
    w.vaults.iter().find(|x| x.vault.id == v).expect("the vault").name.clone()
}

/// Vault `v`'s profile in the world `w` a device shows.
fn profile(w: &Seen, v: VaultId) -> EntryId {
    let of = |i: &&EntryView| i.vault == v && i.ty.as_deref() == Some(PROFILE);
    w.entries.iter().find(of).expect("its profile").entry
}

/// How device `d` takes the edits of the cell entry `e` is in, as the world `w` a device shows: through which of its
/// vaults, and whether it opens them.
fn syncs(w: &Seen, e: EntryId, d: SignerId) -> Option<(VaultId, bool)> {
    let x = item(w, e).cell;
    let cell = w.cells.iter().find(|c| c.id == x).expect("its cell");
    cell.syncs.iter().find(|s| s.device == d).map(|s| (s.through, s.opens))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_vaults_her_vault_owns_are_real_and_each_acts_by_its_own_caps() {
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
    // every device trusts no curve, the server too
    assert!(first.node().read(|lab, _| lab.pq_only()).await && server.read(|lab, _| lab.pq_only()).await);
    let w = first.world().await.expect("her world");
    assert!(w.pq_only && w.mine == eve_v);
    let ids: Vec<VaultId> = w.vaults.iter().map(|v| v.vault.id).collect();
    assert_eq!(ids, [eve_v, avenceo], "her vault and avenCEO");
    assert_eq!(w.vaults[1].via, Some(vec![eve_v]), "her browser acts for avenCEO through her vault");
    // her vault's and avenCEO's profiles, written by her browser with no ceremony; avenCEO's entries are its own,
    // which its server opens, while hers it only relays
    assert!(first.profile(eve_v, "Eve".into()).await.expect("her profile"));
    assert!(first.profile(avenceo, "avenCEO".into()).await.expect("avenCEO's profile"));
    assert!(!first.profile(eve_v, "Eve".into()).await.expect("unchanged"), "it reads Eve already");
    assert_eq!(eve.steps(), [], "no ceremony");
    let w = first.world().await.expect("her world");
    assert_eq!((named(&w, eve_v).as_deref(), named(&w, avenceo).as_deref()), (Some("Eve"), Some("avenCEO")));
    let (eve_p, ceo_p) = (profile(&w, eve_v), profile(&w, avenceo));
    let (mine, srv) = (first.node().device(), server.device());
    assert_eq!(syncs(&w, eve_p, srv), Some((avenceo, false)), "the server relays her entries' ciphertext");
    assert_eq!(syncs(&w, eve_p, mine), Some((eve_v, true)));
    assert_eq!(syncs(&w, ceo_p, srv), Some((avenceo, true)), "avenCEO's own entries its server opens");
    // four vaults her vault owns, in one ceremony, each of which gives avenCEO relay on the whole of it
    let avens = ["avenALICE", "avenBOB", "avenCHARLY"].map(|n| (Kind::Aven, n.to_string()));
    let new = avens.into_iter().chain([(Kind::Coop, "Maia City COOP".to_string())]).collect();
    let vaults = first.found_vaults(new, &eve).await.expect("four vaults");
    assert_eq!(eve.steps(), [Step::Approve], "one ceremony for all four");
    let [alice, bob, charly, coop] = vaults[..] else { panic!("four vaults: {vaults:?}") };
    let w = first.world().await.expect("her world");
    assert_eq!(w.vaults.len(), 6);
    let made = [(alice, Kind::Aven, "avenALICE"), (bob, Kind::Aven, "avenBOB"), (coop, Kind::Coop, "Maia City COOP")];
    for (v, kind, name) in made {
        let x = w.vaults.iter().find(|x| x.vault.id == v).expect("the vault");
        assert_eq!((x.vault.kind, x.name.as_deref()), (kind, Some(name)));
        assert_eq!((&x.vault.owners[..], x.vault.root), (&[Principal::Vault(eve_v)][..], None), "her vault owns it");
        assert_eq!(x.via, Some(vec![eve_v]), "her browser acts for it through her vault");
        assert_eq!(syncs(&w, profile(&w, v), srv), Some((avenceo, false)), "the server relays its entries");
        assert_eq!(syncs(&w, profile(&w, v), mine), Some((v, true)), "her browser opens them, acting for it");
    }
    // avenALICE writes a note into her vault; avenBOB may not write there, nor read it
    let plan = titled("Plan", "Plant beans.");
    let note = write_note(&first, alice, alice, plan, &["garden"]).await.expect("a note");
    let w = first.world().await.expect("her world");
    let it = item(&w, note);
    assert!(matches!(&it.what, What::Note { title, text, .. } if title == "Plan" && text == "Plant beans."));
    assert_eq!((it.ty.as_deref(), it.tags.as_deref()), (Some("note"), Some(&["garden".to_string()][..])));
    let (alices, bobs) = (role(&it.roles, alice), role(&it.roles, bob));
    assert_eq!((it.vault, it.by, alices, bobs), (alice, alice, Some(Role::Owner), None));
    assert_eq!(role(&it.roles, avenceo), Some(Role::Relay));
    let refused = write_note(&first, bob, alice, titled("Mine", "Not here."), &[]).await;
    assert_eq!(refused.expect_err("refused")["refused"], "NoCap", "avenBOB holds no cap on avenALICE's vault");
    // she shares the note by its id with avenBOB to read, with no ceremony: her browser moves it to the cell of that
    // cap, under a key of its own, which avenBOB reads; he can't edit it
    let by_note = Slice::of(by_id(note));
    let read = first.share(alice, alice, by_note, Role::Read, vault(bob), &eve).await.expect("shared");
    assert_eq!(eve.steps(), [], "a read cap needs no ceremony");
    let moved = || async {
        let w = first.world().await.expect("her world");
        let roles = &item(&w, note).roles;
        (role(roles, bob), role(roles, charly)) == (Some(Role::Read), None)
    };
    until("the note moves to the cell avenBOB reads", moved).await;
    let edit = run(&first, set_text(bob, note, None, 2, "Plant peas.")).await;
    assert_eq!(edit.expect_err("refused")["refused"], "NoCap", "avenBOB only reads it");
    let refused = first.share(charly, alice, Slice::of(Selector::All), Role::Read, vault(charly), &eve).await;
    assert!(refused.unwrap_err().to_string().contains("BadParent"), "avenCHARLY gives itself nothing");
    // write on her todos, by their type: avenBOB adds a todo to her vault and closes it
    let todos = Slice::of(of_type("todo"));
    let write = first.share(alice, alice, todos, Role::Write, vault(bob), &eve).await.expect("write");
    let (by, into) = (bob.to_hex(), alice.to_hex());
    let new_todo = |title: &str| {
        let value = json!({ "kind": "todo", "title": title });
        json!({ "op": "create", "as": by, "vault": into, "type": "todo", "value": value })
    };
    let todo = entry(run(&first, new_todo("Water the beans")).await.expect("avenBOB's todo"));
    let done = json!({ "op": "set", "as": by, "entry": todo.to_hex(), "path": ["status"], "value": "done" });
    run(&first, done).await.expect("avenBOB closes it");
    let w = first.world().await.expect("her world");
    let it = item(&w, todo);
    assert!(matches!(&it.what, What::Todo { title, status: Status::Done } if title == "Water the beans"));
    assert_eq!((it.vault, it.by), (alice, bob), "avenBOB wrote it into her vault");
    // owner of the whole of her vault for the coop is governance: her passkey approves it in a ceremony
    let all = Slice::of(Selector::All);
    first.share(alice, alice, all, Role::Owner, vault(coop), &eve).await.expect("the coop owns it");
    assert_eq!(eve.steps(), [Step::Approve]);
    let w = first.world().await.expect("her world");
    let roles = &item(&w, todo).roles;
    assert_eq!((role(roles, coop), role(roles, bob)), (Some(Role::Owner), Some(Role::Write)));
    // avenALICE takes avenBOB's write back: he writes no more there, and still reads the note
    first.revoke(alice, write, &eve).await.expect("revoked");
    assert_eq!(eve.steps(), [], "a write cap ends without a ceremony");
    let refused = run(&first, new_todo("Again")).await;
    assert_eq!(refused.expect_err("refused")["refused"], "NoCap");
    let w = first.world().await.expect("her world");
    assert_eq!(role(&item(&w, note).roles, bob), Some(Role::Read), "{read:?} stands");
    let json = w.to_json(mine);
    assert_eq!((json["pqOnly"].as_bool(), json["vaults"][2]["name"].as_str()), (Some(true), Some("avenALICE")));
    let caps = json["caps"].as_array().expect("its caps");
    let shared = caps.iter().find(|c| c["id"] == hex_of(&read.0)).expect("the read cap");
    let by_id = json!([[{ "entry": [hex_of(&note.0)] }]]);
    assert_eq!((&shared["role"], &shared["slice"]["select"]), (&"read".into(), &by_id), "the note by its id");
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
        let Some(w) = other.world().await else { return false };
        let names: Vec<_> = w.vaults.iter().filter_map(|v| v.name.clone()).collect();
        let beans = |i: &EntryView| matches!(&i.what, What::Note { text, .. } if text == "Plant beans.");
        names == ["Eve", "avenCEO", "avenALICE", "avenBOB", "avenCHARLY", "Maia City COOP"]
            && w.entries.iter().any(beans)
    };
    until("her other browser shows every vault and avenALICE's note", reads).await;
    for n in [first.node(), other.node(), &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// The text the note viewer shows on line `line` of `note`'s history (`Device::note`).
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
    let shown = first.note(note).await.expect("its history");
    assert_eq!(kinds(&shown), ["edit", "edit"]);
    let edits = shown["edits"].as_array().expect("its edits");
    assert_eq!(
        (edits[1]["before"].as_str(), edits[1]["text"].as_str()),
        (Some("Plant beans."), Some("Plant beans and peas."))
    );
    assert_eq!(edits[0]["before"], Value::Null, "the first edit built on nothing");
    let edit = edits[1]["id"].as_str().expect("the edit's id").to_string();
    // a proposal from the main line's head: its own line, named, from that version
    let heads = || async { first.note(note).await.expect("its history")["lines"][0]["heads"].clone() };
    let from: Vec<String> = serde_json::from_value(heads().await).expect("the heads");
    assert_eq!(from, std::slice::from_ref(&edit));
    let e = note.to_hex();
    let propose = json!({ "op": "propose", "entry": e, "from": from, "name": "draft" });
    let draft = run(&first, propose).await.expect("a proposal")["line"].as_str().expect("its line").to_string();
    let b = draft.as_str();
    run(&first, set_text(v, note, Some(b), 2, "Plant beans, peas and corn.")).await.expect("an edit on it");
    let shown = first.note(note).await.expect("its history");
    assert_eq!(shown["lines"][1]["name"].as_str(), Some("draft"));
    assert_eq!(shown["lines"][1]["from"], json!([edit]));
    assert_eq!(
        (on_line(&shown, None), on_line(&shown, Some(b))),
        ("Plant beans and peas.".into(), "Plant beans, peas and corn.".into())
    );
    assert_eq!(kinds(&shown), ["edit", "edit", "propose", "edit"]);
    let corn = shown["edits"][3]["id"].as_str().expect("the proposal's edit").to_string();
    let all: Vec<&str> =
        shown["edits"].as_array().expect("its edits").iter().map(|c| c["id"].as_str().unwrap()).collect();
    assert_eq!(shown["lines"][0]["history"], json!(all[..2]), "the main line: the first two");
    assert_eq!(shown["lines"][1]["history"], json!(all), "the proposal: what it builds on, then its own");
    assert_eq!(
        shown["edits"][2]["from"],
        json!({ "line": null, "name": "main" }),
        "it started from main"
    );
    // merged into the main line: an edit that carries no change, and the main line shows the proposal's edit
    run(&first, json!({ "op": "merge", "entry": e, "from": b })).await.expect("merged");
    let shown = first.note(note).await.expect("its history");
    assert_eq!(kinds(&shown).last().map(String::as_str), Some("merge"));
    assert_eq!(on_line(&shown, None), "Plant beans, peas and corn.");
    let merge = &shown["edits"][4];
    assert_eq!(merge["from"], json!({ "line": b, "name": "draft" }), "it brought in the proposal");
    assert_eq!(
        (merge["before"].as_str(), merge["text"].as_str()),
        (Some("Plant beans and peas."), Some("Plant beans, peas and corn.")),
        "what the merge brought to the main line"
    );
    // the proposal's edit undone on the main line, every other change kept; then the first version restored
    run(&first, json!({ "op": "undo", "entry": e, "edit": corn })).await.expect("undone");
    assert_eq!(on_line(&first.note(note).await.expect("its history"), None), "Plant beans and peas.");
    let made = first.note(note).await.expect("its history")["edits"][0]["id"].as_str().map(str::to_string);
    let made = made.expect("the first edit");
    run(&first, json!({ "op": "restore", "entry": e, "at": [made] })).await.expect("restored");
    assert_eq!(on_line(&first.note(note).await.expect("its history"), None), "Plant beans.");
    // the proposal goes on, and a promote brings the main line to exactly what the proposal shows
    run(&first, set_text(v, note, Some(b), 2, "Corn first.")).await.expect("another edit on the proposal");
    run(&first, json!({ "op": "merge", "entry": e, "from": b, "promote": true })).await.expect("promoted");
    let shown = first.note(note).await.expect("its history");
    assert_eq!(kinds(&shown).last().map(String::as_str), Some("promote"));
    assert_eq!((on_line(&shown, None), on_line(&shown, Some(b))), ("Corn first.".into(), "Corn first.".into()));
    // the engine's history of it: each write as the note page names it, and the promote's change, the text it brought
    let log = run(&first, json!({ "op": "history", "entry": e })).await.expect("its history");
    assert_eq!(kinds(&log), kinds(&shown));
    let brought = json!([{ "set": [["blocks", { "id": 2 }, "text"], "Corn first."] }]);
    assert_eq!(log["edits"].as_array().and_then(|es| es.last()).map(|p| &p["changes"]), Some(&brought));
    // a variant: the proposal's note as a new entry of her vault, with none of its history, that names its origin
    let mark = json!([{ "op": "insert", "path": ["tags"], "value": format!("avendb:variant:{e}") }]);
    let copy = json!({ "op": "variant", "entry": e, "line": b, "into": v.to_hex(), "ops": mark });
    let variant = entry(run(&first, copy).await.expect("a variant"));
    let made = first.note(variant).await.expect("the variant's history");
    assert_eq!((kinds(&made), on_line(&made, None)), (vec!["edit".to_string()], "Corn first.".to_string()));
    let world = first.world().await.expect("her world");
    let what = |e: EntryId| world.entries.iter().find(|i| i.entry == e).map(|i| &i.what);
    assert!(matches!(what(variant), Some(What::Note { variant_of: Some(of), edits: 1, .. }) if *of == note));
    assert!(matches!(what(note), Some(What::Note { variant_of: None, proposals: 1, .. })), "one proposal");
    // and a new title on the main line, which leaves the proposal's
    let retitle = json!({ "op": "batch", "ops": [
        { "op": "set", "entry": e, "path": ["title"], "value": "Garden plan" },
        { "op": "set", "entry": e, "path": ["blocks", { "id": 1 }, "text"], "value": "Garden plan" },
    ] });
    let one = run(&first, retitle).await.expect("retitled");
    assert_eq!(one.as_array().map(Vec::len), Some(1), "one write");
    let shown = first.note(note).await.expect("its history");
    let titles = (shown["lines"][0]["title"].as_str(), shown["lines"][1]["title"].as_str());
    assert_eq!(titles, (Some("Garden plan"), Some("Plan")));
    assert_eq!(eve.steps(), [], "no ceremony for any of it");
    // her database: the note's record and lines, the variant, her browser's card; the schemas the app ships
    let db = first.database(v).await;
    assert_eq!(db["vault"].as_str(), Some(hex_of(&v.0).as_str()));
    let rows = db["rows"].as_array().expect("its rows");
    let row = |e: EntryId| rows.iter().find(|r| r["entry"].as_str() == Some(hex_of(&e.0).as_str())).expect("the row");
    let plan = row(note);
    assert_eq!(
        (plan["kind"].as_str(), plan["title"].as_str(), plan["type"].as_str(), &plan["tags"]),
        (Some("document"), Some("Garden plan"), Some("note"), &json!([]))
    );
    assert_eq!((plan["lines"].as_u64(), plan["proposals"].clone()), (Some(2), json!(["draft"])));
    assert_eq!(plan["edits"].as_u64(), Some(kinds(&shown).len() as u64));
    assert_eq!(plan["record"]["blocks"][1]["text"].as_str(), Some("Corn first."));
    assert_eq!(plan["record"]["blocks"][0]["text"].as_str(), Some("Garden plan"), "its heading retitled with it");
    assert_eq!(plan["actor"].as_str(), Some(hex_of(&v.0).as_str()), "her vault wrote it");
    let schemas: Vec<String> = db["builtIn"]["schemas"]
        .as_array()
        .expect("the app's schemas")
        .iter()
        .map(|s| s["id"].as_str().unwrap_or_default().to_string())
        .collect();
    assert_eq!(schemas.len(), 4);
    assert_eq!(
        plan["authored"],
        json!([avendb::lens::DOCUMENT_V2.id().to_hex()]),
        "written under document v2"
    );
    assert!(schemas.contains(&avendb::lens::DOCUMENT_V2.id().to_hex()));
    assert_eq!(row(variant)["record"]["blocks"][1]["text"].as_str(), Some("Corn first."));
    let tags = &row(variant)["record"]["tags"];
    assert_eq!(tags, &json!([format!("avendb:variant:{}", hex_of(&note.0))]), "it names its origin");
    let card = rows.iter().find(|r| r["type"].as_str() == Some("card")).expect("her browser's card");
    assert_eq!(card["title"].as_str(), Some("Eve's browser"));
    assert_eq!(db["edits"]["founded"].as_u64(), Some(1));
    let writes = db["edits"]["writes"].as_u64();
    assert!(writes.is_some_and(|n| n >= kinds(&shown).len() as u64 + 2), "{}", db["edits"]);
    assert!(db["edits"]["caps"].as_u64().is_some_and(|n| n >= 1), "avenCEO relays it");
    let cells = db["cells"].as_array().expect("its cells");
    let one = (cells.len(), cells[0]["entries"].as_u64(), cells[0]["caps"].as_array().map(Vec::len));
    assert_eq!(one, (1, Some(3), Some(0)), "her card, the note and its variant: no cap splits her vault");
    assert_eq!(db["builtIn"]["lenses"][0]["title"].as_str(), Some("Markdown document, v1 to v2"));
    // her database's history, every edit her browser holds, in the order it took them: her vault's genesis, her
    // browser added to it, avenCEO's relay on the whole of it, and each write, every one counted, as a checkpoint
    // covers it
    let log = first.history().await;
    let edits = log["edits"].as_array().expect("its edits");
    assert_eq!(edits.len(), first.edits(0).await.expect("its edits").len(), "every edit it holds");
    let places: Vec<u64> = edits.iter().filter_map(|o| o["n"].as_u64()).collect();
    assert_eq!(places, (1..=edits.len() as u64).collect::<Vec<_>>(), "in the order it took them");
    let of = |kind: &str| edits.iter().filter(|o| o["kind"].as_str() == Some(kind)).collect::<Vec<_>>();
    let genesis = of("genesis").into_iter().find(|o| o["id"].as_str() == Some(hex_of(&v.0).as_str())).expect("hers");
    assert_eq!(genesis["fields"]["vaultKind"].as_str(), Some("human"));
    assert_eq!(genesis["fields"]["root"].as_str(), Some(hex_of(&first.passkey().0).as_str()), "her passkey roots it");
    let sigs = genesis["sigs"].as_array().expect("its signatures");
    assert!(sigs.iter().any(|s| s["by"] == "passkey" && s["pq"].as_u64().is_some_and(|n| n > 1000)), "{sigs:?}");
    let browser = hex_of(&first.node().device().0);
    assert!(of("addDevice").iter().any(|o| o["fields"]["device"].as_str() == Some(browser.as_str())));
    let relay = |o: &&Value| o["fields"]["role"] == "relay" && o["fields"]["wide"] == true;
    assert!(of("cap").iter().any(relay), "avenCEO's relay on the whole of her vault");
    let writes = of("write");
    let mine = writes.iter().filter(|o| o["fields"]["entry"].as_str() == Some(hex_of(&note.0).as_str()));
    assert_eq!(mine.clone().count(), kinds(&shown).len(), "each write of the note");
    assert!(mine.clone().all(|o| o["counted"] == true), "every one counted");
    assert!(mine.clone().all(|o| o["fields"]["sealed"].as_u64().is_some_and(|n| n > 0)), "its body by its size alone");
    let starts = |o: &&Value| o["fields"]["starts"] == true && o["fields"]["line"] == o["id"];
    assert!(mine.clone().any(starts), "the proposal's start");
    assert!(writes.iter().all(|o| o["vaults"].as_array().is_some_and(|vs| vs.contains(&hex_of(&v.0).into()))));
    assert!(!of("checkpoint").is_empty() && !of("keys").is_empty());
    assert!(edits
        .iter()
        .all(|o| o["bytes"].as_u64().is_some_and(|n| n > 0) && !o["sigs"].as_array().unwrap().is_empty()));
    let text = log.to_string();
    assert!(!text.contains("Corn first") && !text.contains("Plant beans"), "no note's text in its history: sealed");
    // the server relays her entries and opens none of them: its rows are sealed
    let sealed = move |lab: &Lab, me| lab.fetched(me, variant) > 0 && lab.item(me, note).is_none();
    until("the server keeps her entries, sealed", || server.read(sealed)).await;
    for n in [first.node(), &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// 32 bytes as their 64 hex digits, as the page sees them.
fn hex_of(b: &[u8; 32]) -> String {
    avendb::id::BlobId(*b).to_hex()
}
