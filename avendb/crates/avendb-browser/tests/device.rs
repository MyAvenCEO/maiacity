//! A browser's device, run natively (P8d, P8e): its person's passkey stays in the browser's authenticator, a software
//! passkey here, which makes each ceremony the device asks for. Eve's first browser founds her vault through the relay,
//! open to sign-up, and the server learns it; her second browser links through the first one's code, browser to
//! browser; the first opens again from what its store kept. Samuel's browser links through the code his Mac shows and
//! edits Welcome. `tests/page.rs` runs the same in Chromium, the passkey in its virtual authenticator.

use std::future::Future;
use std::net::SocketAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use avendb::cast::*;
use avendb::id::{EntryId, SignerId, SpaceId};
use avendb::lab::Lab;
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
    // Eve is new: her browser makes her passkey, and its public key info shows its P-256 key
    let eve = Browser::new(Passkey::from_seed([5; 32]));
    let p256 = eve.0.lock().expect("the authenticator").0.public();
    let first = start("Eve's browser", &url, 7);
    let first = Device::found(first, &server.offer(), p256, eve.unlock([1; 32]), &eve).await.expect("her vault");
    assert_eq!(eve.steps(), [Step::Pass, Step::Found, Step::Join], "a ceremony for each the passkey signs");
    assert!(first.node().endpoint().bound_sockets().is_empty(), "with no UDP of its own");
    let vault = first.vault().await.expect("the browser belongs to her vault");
    until("the server learns her browser from what it relays", || async { admission.admits(&first.node().id()) }).await;
    let notes = first.notes().await;
    let [space] = notes.as_slice() else { panic!("her first space, and the server's: {}", notes.len()) };
    assert_eq!((space.founder, space.docs.len()), (vault, 0));
    let space = space.space;
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
    for n in [again.node(), other.node(), &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn samuels_browsers_link_through_his_mac_and_each_other_through_the_relay_alone() {
    let admission = Admission::default();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url: RelayUrl = relay.url();
    let mut w = world();
    let h = handbook(&mut w);
    let secret = w.lab.passkey_secret(w.passkey_s).expect("Samuel's passkey, a software passkey");
    let (mac_s, server_d, samuel) = (w.mac_s, w.server, w.samuel);
    let opts = Options { relay: Some(url.clone()), admission: Some(admission.clone()), ..Options::local() };
    let server = node(&mut w, server_d, &[], 2, opts).await;
    let mac = node(&mut w, mac_s, &[], 1, Options { relay: Some(url.clone()), ..Options::local() }).await;
    mac.know(server.addr());
    until("the relay serves Samuel's Mac", || async { relay.serves(&mac.id()) }).await;
    // Samuel's browser: his passkey, a name, the relay; its keys are its own
    let samuels = Browser::new(Passkey::from_seed(*secret));
    let code = mac.offer();
    let browser = Device::link(start("Samuel's browser", &url, 7), &code, samuels.unlock([1; 32]), &samuels);
    let browser = browser.await.expect("it links through the Mac's code");
    assert_eq!(samuels.steps(), [Step::Pass, Step::Hello, Step::Join]);
    assert_eq!(browser.vault().await, Some(samuel));
    let (coop, space, welcome) = (h.coop, h.space, h.welcome);
    until("it reads Welcome", || shows(&browser, space, welcome, WELCOME_TEXT)).await;
    browser.set_text(coop, space, welcome, 2, AFTER_TEXT.into()).await.expect("it edits Welcome");
    let reads = move |lab: &Lab, me| text(lab, me, space, welcome, 2).as_deref() == Some(AFTER_TEXT);
    until("the Mac reads its edit", || mac.read(reads)).await;
    until("once it joined, the server knows it", || async { admission.admits(&browser.node().id()) }).await;
    // his other browser links through the first one's code: browser to browser
    let other = start("Samuel's other browser", &url, 8);
    let code = browser.node().offer();
    let other = Device::link(other, &code, samuels.unlock([2; 32]), &samuels);
    let other = other.await.expect("it links through the browser's code");
    assert_eq!(other.vault().await, Some(samuel));
    until("it reads the edit", || shows(&other, space, welcome, AFTER_TEXT)).await;
    assert_eq!(browser.node().proven(other.node().id()), Some(other.node().device()), "through the first browser");
    let both = move |lab: &Lab, me| lab.state(me).vault(samuel).map(|v| v.devices.len()) == Some(4);
    until("the Mac counts both browsers among Samuel's devices", || mac.read(both)).await;
    // an edit its view refuses fails: Samuel's own vault holds no right on the coop's Handbook
    assert!(browser.set_text(samuel, space, welcome, 2, "Samuel's own words".into()).await.is_err());
    for n in [browser.node(), other.node(), &mac, &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}
