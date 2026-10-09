//! A browser's device, run natively (P8d, P8e): its person's passkey stays in the browser's authenticator, a software
//! passkey here, which makes each ceremony the device asks for. Eve's first browser founds her vault through the relay,
//! open to sign-up, with the passkey she signed up to maiaCITY with, and the server learns it; her second browser
//! links through the first one's code, browser to browser; the first opens again from what its store kept; with both
//! lost, her passkey alone gets her vault back on a new browser, through the server. Alice's browser links through the
//! code her Mac shows and edits Welcome. The first person to found their vault through a new server claims it from
//! their first browser, in the same ceremony (P8f).
//! `tests/page.rs` runs the same in Chromium, the passkey in its virtual authenticator.

use std::future::Future;
use std::net::SocketAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use avendb::cast::*;
use avendb::id::{EntryId, SignerId, SpaceId};
use avendb::keys::KeyScope;
use avendb::lab::Lab;
use avendb::policy::{Kind, Principal};
use avendb::sign::{Ceremony, Passkey, device_salt};
use avendb_browser::{Device, Start, Unlock, backup};
use avendb_net::{Admission, Authenticator, Node, Options, Step};
use avendb_server::Relay;
use iroh::RelayUrl;

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

    /// The ceremony that unlocks the device whose salt ends in `nonce`, over a challenge of the page's.
    fn unlock(&self, nonce: [u8; 32]) -> Unlock {
        let mut held = self.0.lock().expect("the authenticator");
        let device = held.0.prf(&device_salt(&nonce));
        Unlock { ceremony: held.0.ceremony([0xaa; 32]), nonce, device }
    }

    /// The ceremonies it made since it was last asked, by what for.
    fn steps(&self) -> Vec<Step> {
        std::mem::take(&mut self.0.lock().expect("the authenticator").1)
    }
}

/// Where a browser's device named `name` starts, through the relay at `url`, its randomness drawn from `seed`.
fn start(name: &str, url: &RelayUrl, seed: u8) -> Start {
    Start { name: name.into(), relay: url.clone(), entropy: [seed; 32], now: now() }
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

/// Whether device `d` reads `body` in block 2 of entry `e` in space `sp`.
async fn shows(d: &Device, sp: SpaceId, e: EntryId, body: &str) -> bool {
    d.text(sp, e, 2).await.as_deref() == Some(body)
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
    let first = Device::found(first, &server.offer(), None, eve.unlock([1; 32]), &eve).await;
    let first = first.expect("her vault");
    assert_eq!(eve.steps(), [Step::Pass, Step::Found], "the pass, then one ceremony for her vault and her browser");
    assert_eq!(first.p256(), p256, "it learned her passkey's key from the unlock and the pass");
    assert!(first.node().endpoint().bound_sockets().is_empty(), "with no UDP of its own");
    let vault = first.vault().await.expect("the browser belongs to her vault");
    assert!(!first.owns_aven().await, "avenCEO is Alice's vault's, which claimed the server before her");
    until("the server learns her browser from what it relays", || async { admission.admits(&first.node().id()) }).await;
    let notes = first.notes().await;
    let [space] = notes.as_slice() else { panic!("her first space, and no other: {}", notes.len()) };
    assert_eq!((space.founder, space.docs.len()), (vault, 0), "no note yet: its card is none");
    let space = space.space;
    // her account: her vault, her passkey its root, and her browser, by the name on its card
    let account = first.account().await.expect("her account");
    assert_eq!((account.vault, account.root, account.owns_aven), (vault, Some(first.passkey()), false));
    assert_eq!(account.devices, [(first.node().device(), Some("Eve's browser".into()))]);
    let note = first.write(vault, space, "Seeds".into(), "Tomatoes in March.".into()).await.expect("a note");
    let holds = move |lab: &Lab, me| lab.state(me).space(space).is_some_and(|s| s.entries.contains(&note));
    until("the server keeps her space's log", || server.read(holds)).await;
    // her second browser links through the first one's code, in four ceremonies
    let other = start("Eve's other browser", &url, 8);
    let code = first.node().offer();
    let other = Device::link(other, &code, eve.unlock([2; 32]), &eve).await.expect("it links through the first");
    assert_eq!(eve.steps(), [Step::Pass, Step::Hello, Step::Join]);
    assert_eq!((other.vault().await, other.p256()), (Some(vault), p256), "it learned her passkey's key");
    until("it reads her note", || shows(&other, space, note, "Tomatoes in March.")).await;
    other.set_text(vault, space, note, 2, "Tomatoes in April.".into()).await.expect("it edits the note");
    until("the first reads the edit", || shows(&first, space, note, "Tomatoes in April.")).await;
    // the second writes its card, as it holds her first space now; each shows both browsers by name
    assert!(other.card("Eve's other browser".into()).await.expect("its card"), "it had none");
    let both = ["Eve's browser", "Eve's other browser"];
    until("the first shows both by name", || async { names(&first).await == both }).await;
    assert_eq!(names(&other).await, both);
    // a card renames its device; the notes never show one
    assert!(first.card("Eve's Mac".into()).await.expect("a new name"));
    assert!(!first.card("Eve's Mac".into()).await.expect("the same name"), "nothing to write");
    let renamed = ["Eve's Mac", "Eve's other browser"];
    until("the second shows the new name", || async { names(&other).await == renamed }).await;
    let titles: Vec<_> = other.notes().await.into_iter().flat_map(|s| s.docs).map(|(_, title, _)| title).collect();
    assert_eq!(titles, ["Seeds"]);
    // the first browser closes, and opens again from what its store kept, in the unlock alone
    let ops = first.ops(0).await.expect("its ops");
    let mut keys = vec![];
    for id in first.key_ids().await {
        keys.push(first.key(id).await.expect("a key it holds"));
    }
    assert_eq!(first.ops(ops.len() + 1).await, None, "it holds no more ops than these");
    assert_eq!(first.ops(ops.len()).await, Some(vec![]));
    first.node().shutdown().await.expect("the node shuts down");
    let kept = backup(&ops, keys.clone());
    let again = start("Eve's browser", &url, 9);
    let again = Device::open(again, p256, eve.unlock([1; 32]), &kept).await.expect("it opens again");
    assert!(eve.steps().is_empty(), "with no ceremony but the unlock");
    assert_eq!(again.node().id(), first.node().id(), "the same device");
    assert!(shows(&again, space, note, "Tomatoes in April.").await, "it reads what its store kept");
    assert_eq!(names(&again).await, renamed, "and both cards");
    other.set_text(vault, space, note, 2, "Tomatoes in May.".into()).await.expect("another edit");
    let may = || shows(&again, space, note, "Tomatoes in May.");
    until("the relay lets it in again, as the server knows it", may).await;
    // a store cut short reads back up to where it was cut; an unlock of another passkey opens nothing
    let mut cut = ops.clone();
    cut[3].truncate(10);
    assert_eq!(backup(&cut, keys.clone()).signed().len(), 3);
    let mallory = Browser::new(Passkey::from_seed([6; 32]));
    let theirs = start("Eve's browser", &url, 10);
    assert!(Device::open(theirs, p256, mallory.unlock([1; 32]), &kept).await.is_err(), "not her passkey's ceremony");
    // with both her browsers lost, her passkey alone gets her vault back on a new one, through the server (P8c)
    for n in [again.node(), other.node()] {
        n.shutdown().await.expect("the node shuts down");
    }
    let new = start("Eve's new browser", &url, 11);
    let new = Device::link(new, &server.offer(), eve.unlock([3; 32]), &eve).await.expect("it links through the server");
    assert_eq!(eve.steps(), [Step::Pass, Step::Hello, Step::Join]);
    assert_eq!(new.vault().await, Some(vault), "to her vault");
    until("it reads her note", || shows(&new, space, note, "Tomatoes in May.")).await;
    assert!(new.card("Eve's new browser".into()).await.expect("its card"));
    assert_eq!(names(&new).await, ["Eve's Mac", "Eve's other browser", "Eve's new browser"]);
    let opens = move |lab: &Lab, me| lab.opens(me, KeyScope::Vault(vault)) || lab.opens(me, KeyScope::Space(space));
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
    let browser = Device::link(start("Alice's browser", &url, 7), &code, alices.unlock([1; 32]), &alices);
    let browser = browser.await.expect("it links through the Mac's code");
    assert_eq!(alices.steps(), [Step::Pass, Step::Hello, Step::Join]);
    assert_eq!(browser.vault().await, Some(alice));
    let (coop, space, welcome) = (h.coop, h.space, h.welcome);
    until("it reads Welcome", || shows(&browser, space, welcome, WELCOME_TEXT)).await;
    browser.set_text(coop, space, welcome, 2, AFTER_TEXT.into()).await.expect("it edits Welcome");
    let reads = move |lab: &Lab, me| text(lab, me, space, welcome, 2).as_deref() == Some(AFTER_TEXT);
    until("the Mac reads its edit", || mac.read(reads)).await;
    until("once it joined, the server knows it", || async { admission.admits(&browser.node().id()) }).await;
    // her other browser links through the first one's code: browser to browser
    let other = start("Alice's other browser", &url, 8);
    let code = browser.node().offer();
    let other = Device::link(other, &code, alices.unlock([2; 32]), &alices);
    let other = other.await.expect("it links through the browser's code");
    assert_eq!(other.vault().await, Some(alice));
    until("it reads the edit", || shows(&other, space, welcome, AFTER_TEXT)).await;
    assert_eq!(browser.node().proven(other.node().id()), Some(other.node().device()), "through the first browser");
    let both = move |lab: &Lab, me| lab.state(me).vault(alice).map(|v| v.devices.len()) == Some(4);
    until("the Mac counts both browsers among Alice's devices", || mac.read(both)).await;
    // an edit its view refuses fails: Alice's own vault holds no right on the coop's Handbook
    assert!(browser.set_text(alice, space, welcome, 2, "Alice's own words".into()).await.is_err());
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
    // vault, adds itself to it and claims the server, all in one ceremony after the unlock and the pass
    let eve = Browser::new(Passkey::from_seed([5; 32]));
    let p256 = eve.0.lock().expect("the authenticator").0.public();
    let first = start("Eve's browser", &url, 7);
    let first = Device::found(first, &server.offer(), Some(p256), eve.unlock([1; 32]), &eve).await;
    let first = first.expect("her vault claims the server");
    assert_eq!(eve.steps(), [Step::Pass, Step::Found], "one ceremony for her vault, her browser and the claim");
    let vault = first.vault().await.expect("her vault");
    let avenceo = server.read(|lab, me| lab.vault_of(me)).await.expect("the server is avenCEO's device");
    let shape = move |lab: &Lab, _| lab.state(me).vault(avenceo).map(|v| (v.kind, v.owners.clone()));
    assert_eq!(server.read(shape).await, Some((Kind::Aven, vec![Principal::Vault(vault)])), "owned by her vault");
    assert!(first.owns_aven().await, "as her browser shows");
    // her first space is relayed by avenCEO: the server keeps its log and knows her browser for good
    let notes = first.notes().await;
    let [space] = notes.as_slice() else { panic!("her first space: {}", notes.len()) };
    let space = space.space;
    let note = first.write(vault, space, "Seeds".into(), "Tomatoes in March.".into()).await.expect("a note");
    let holds = move |lab: &Lab, me| lab.state(me).space(space).is_some_and(|s| s.entries.contains(&note));
    until("the server keeps her space's log", || server.read(holds)).await;
    until("and knows her browser", || async { admission.admits(&first.node().id()) }).await;
    let stranger = Passkey::from_seed([9; 32]).id();
    assert!(!admission.honours(&stranger), "claimed, its relay honours no stranger's pass");
    for n in [first.node(), &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}
