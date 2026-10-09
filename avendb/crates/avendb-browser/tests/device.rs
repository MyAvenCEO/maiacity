//! A browser's device, run natively (P8d): Samuel's browser holds his passkey and nothing else, reaches the server's
//! relay by the passkey's pass, links through the code his Mac shows, reads Welcome and edits it; then his other
//! browser links through the first one's code, browser to browser, through the relay alone. `tests/page.rs` runs the
//! same in Chromium.

use std::future::Future;
use std::net::SocketAddr;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use avendb::cast::*;
use avendb::id::{EntryId, SignerId, SpaceId};
use avendb::lab::Lab;
use avendb_browser::Device;
use avendb_net::{Admission, Node, Options};
use avendb_server::Relay;
use iroh::RelayUrl;

/// A socket of the system's choosing on this machine.
const LOOPBACK: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 0);

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
    let browser = Device::new("Samuel's browser", url.clone(), &secret, [7; 32], now()).await.expect("a device");
    assert!(browser.node().endpoint().bound_sockets().is_empty(), "with no UDP of its own");
    until("the relay lets it in by its pass", || async { relay.serves(&browser.node().id()) }).await;
    let code = mac.offer().to_text();
    assert_eq!(browser.link(&code).await.expect("it links through the Mac's code"), samuel);
    assert_eq!(browser.vault().await, Some(samuel));
    let (coop, space, welcome) = (h.coop, h.space, h.welcome);
    until("it reads Welcome", || shows(&browser, space, welcome, WELCOME_TEXT)).await;
    browser.set_text(coop, space, welcome, 2, AFTER_TEXT.into()).await.expect("it edits Welcome");
    let reads = move |lab: &Lab, me| text(lab, me, space, welcome, 2).as_deref() == Some(AFTER_TEXT);
    until("the Mac reads its edit", || mac.read(reads)).await;
    until("once it joined, the server knows it", || async { admission.admits(&browser.node().id()) }).await;
    // his other browser links through the first one's code: browser to browser
    let other = Device::new("Samuel's other browser", url, &secret, [8; 32], now()).await.expect("a device");
    let code = browser.node().offer().to_text();
    assert_eq!(other.link(&code).await.expect("it links through the browser's code"), samuel);
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
