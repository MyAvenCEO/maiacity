//! A browser's device, run natively (P8d, P8e): its person's passkey stays in the browser's authenticator, a software
//! passkey here, which makes each ceremony the device asks for. Eve's first browser founds her vault through the relay,
//! open to sign-up, with the passkey she signed up to maiaCITY with, and the server learns it; her second browser
//! links through the first one's code, browser to browser; the first opens again from what its store kept; with both
//! lost, her passkey alone gets her vault back on a new browser, through the server. Alice's browser links through the
//! code her Mac shows and edits Welcome. The first person to found their vault through a new server claims it from
//! their first browser, in the same ceremony (P8f), and her vault founds four more vaults it owns in one more ceremony:
//! her browser acts as each of them, and each one's caps decide what it may do. Every device, the server too, trusts
//! no curve: only the writes a checkpoint covers count.
//! `tests/page.rs` runs the same in Chromium, the passkey in its virtual authenticator.

use std::future::Future;
use std::net::SocketAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use avendb::cast::*;
use avendb::id::{EntryId, SignerId, SpaceId, VaultId};
use avendb::keys::KeyScope;
use avendb::lab::Lab;
use avendb::lens::Status;
use avendb::policy::{Kind, Principal, Role, Scope};
use avendb::sign::{Ceremony, Passkey, device_salt};
use avendb_browser::{Device, ItemView, Start, Unlock, What, World as Seen, backup};
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
    assert!(!first.owns_aven().await, "avenCEO is Alice's vault's, which claimed the server before Eve");
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

/// The role vault `v` holds in `roles`, if any.
fn role(roles: &[(VaultId, Role)], v: VaultId) -> Option<Role> {
    roles.iter().find(|(x, _)| *x == v).map(|(_, r)| *r)
}

/// Entry `e` of space `sp` in the world `w` a device shows.
fn item(w: &Seen, sp: SpaceId, e: EntryId) -> &ItemView {
    let space = w.spaces.iter().find(|s| s.space == sp).expect("the space");
    space.items.iter().find(|i| i.entry == e).expect("the entry")
}

/// Vault `v`'s name and home in the world `w` a device shows.
fn named(w: &Seen, v: VaultId) -> (Option<String>, Option<SpaceId>) {
    let vault = w.vaults.iter().find(|x| x.vault.id == v).expect("the vault");
    (vault.name.clone(), vault.home)
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
    let first = Device::found(first, &server.offer(), None, eve.unlock([1; 32]), &eve).await.expect("her vault");
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
    // her vault's and avenCEO's profiles, written by her browser with no ceremony; avenCEO's home is its own, which
    // its server opens, while her home it only relays
    assert!(first.profile(eve_v, "Eve".into()).await.expect("her profile"));
    assert!(first.profile(avenceo, "avenCEO".into()).await.expect("avenCEO's profile"));
    assert!(!first.profile(eve_v, "Eve".into()).await.expect("unchanged"), "it reads Eve already");
    assert_eq!(eve.steps(), [], "no ceremony");
    let w = first.world().await.expect("her world");
    let (eve_home, ceo_home) = (named(&w, eve_v), named(&w, avenceo));
    assert_eq!((eve_home.0.as_deref(), ceo_home.0.as_deref()), (Some("Eve"), Some("avenCEO")));
    let (eve_home, ceo_home) = (eve_home.1.expect("her home"), ceo_home.1.expect("avenCEO's home"));
    let opens = |w: &Seen, sp: SpaceId, d: SignerId| {
        let space = w.spaces.iter().find(|s| s.space == sp).expect("the space");
        space.syncs.iter().find(|x| x.device == d).map(|x| (x.through, x.opens))
    };
    let (mine, srv) = (first.node().device(), server.device());
    assert_eq!(opens(&w, eve_home, srv), Some((avenceo, false)), "the server relays her home's ciphertext");
    assert_eq!(opens(&w, eve_home, mine), Some((eve_v, true)));
    assert_eq!(opens(&w, ceo_home, srv), Some((avenceo, true)), "avenCEO's own home its server opens");
    // four vaults her vault owns, in one ceremony
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
        let home = x.home.expect("its home");
        assert_eq!(opens(&w, home, srv), Some((avenceo, false)), "the server relays its home");
        assert_eq!(opens(&w, home, mine), Some((v, true)), "her browser opens it, acting for it");
    }
    let alice_home = named(&w, alice).1.expect("avenALICE's home");
    // avenALICE writes a note in her home; avenBOB may not write there, nor read it
    let note = first.write(alice, alice_home, "Plan".into(), "Plant beans.".into()).await.expect("a note");
    let w = first.world().await.expect("her world");
    let it = item(&w, alice_home, note);
    assert!(matches!(&it.what, What::Note { title, text } if title == "Plan" && text == "Plant beans."));
    assert_eq!((it.by, role(&it.roles, alice), role(&it.roles, bob)), (Some(alice), Some(Role::Owner), None));
    assert_eq!(role(&it.roles, avenceo), Some(Role::Relay));
    let refused = first.write(bob, alice_home, "Mine".into(), "Not here.".into()).await;
    assert!(refused.unwrap_err().to_string().contains("NoCap"), "avenBOB holds no cap on avenALICE's home");
    // she shares the note with avenBOB to read, without a ceremony: he reads it and can't edit it
    let read = first.grant(alice, Scope::Entry(alice_home, note), Role::Read, vault(bob), &eve).await.expect("shared");
    assert_eq!(eve.steps(), [], "a read grant needs no ceremony");
    let w = first.world().await.expect("her world");
    let it = item(&w, alice_home, note);
    assert_eq!((role(&it.roles, bob), role(&it.roles, charly)), (Some(Role::Read), None));
    let edit = first.set_text(bob, alice_home, note, 2, "Plant peas.".into()).await;
    assert!(edit.unwrap_err().to_string().contains("NoCap"), "avenBOB only reads it");
    let refused = first.grant(charly, Scope::Space(alice_home), Role::Read, vault(charly), &eve).await;
    assert!(refused.unwrap_err().to_string().contains("NoCap"), "avenCHARLY gives itself nothing");
    // write on the whole home: avenBOB adds a todo there and closes it
    let write = first.grant(alice, Scope::Space(alice_home), Role::Write, vault(bob), &eve).await.expect("write");
    let todo = first.todo(bob, alice_home, "Water the beans".into()).await.expect("avenBOB's todo");
    first.set_status(bob, alice_home, todo, Status::Done).await.expect("avenBOB closes it");
    let w = first.world().await.expect("her world");
    let it = item(&w, alice_home, todo);
    assert!(matches!(&it.what, What::Todo { title, status: Status::Done } if title == "Water the beans"));
    assert_eq!(it.by, Some(bob), "avenBOB wrote it");
    // owner for the coop is governance: her passkey approves it in a ceremony
    first.grant(alice, Scope::Space(alice_home), Role::Owner, vault(coop), &eve).await.expect("the coop owns it");
    assert_eq!(eve.steps(), [Step::Approve]);
    let w = first.world().await.expect("her world");
    let roles = w.spaces.iter().find(|s| s.space == alice_home).map(|s| s.roles.clone()).unwrap_or_default();
    assert_eq!((role(&roles, coop), role(&roles, bob)), (Some(Role::Owner), Some(Role::Write)));
    // avenALICE takes avenBOB's write back: he writes no more there, and still reads the note
    first.revoke(alice, write, &eve).await.expect("revoked");
    assert_eq!(eve.steps(), [], "a write grant ends without a ceremony");
    let refused = first.todo(bob, alice_home, "Again".into()).await;
    assert!(refused.unwrap_err().to_string().contains("NoCap"));
    let w = first.world().await.expect("her world");
    assert_eq!(role(&item(&w, alice_home, note).roles, bob), Some(Role::Read), "{read:?} stands");
    let json = w.to_json(mine);
    assert_eq!((json["pqOnly"].as_bool(), json["vaults"][2]["name"].as_str()), (Some(true), Some("avenALICE")));
    // the server keeps it all, counts the writes, each covered by a checkpoint, and opens none of avenALICE's keys
    let counts = move |lab: &Lab, me| lab.state(me).writes(alice_home, note).len() == 1;
    until("the server counts avenALICE's note", || server.read(counts)).await;
    let opens_none =
        move |lab: &Lab, me| !lab.opens(me, KeyScope::Space(alice_home)) && !lab.opens(me, KeyScope::Vault(alice));
    assert!(server.read(opens_none).await, "it relays avenALICE's home and opens nothing of it");
    // her second browser signs in through the server with her passkey alone: the same world, every name, the note
    let other = start("Eve's other browser", &url, 8);
    let other = Device::link(other, &server.offer(), eve.unlock([2; 32]), &eve).await.expect("it signs in");
    let reads = || async {
        let Some(w) = other.world().await else { return false };
        let names: Vec<_> = w.vaults.iter().filter_map(|v| v.name.clone()).collect();
        let beans = |i: &ItemView| matches!(&i.what, What::Note { text, .. } if text == "Plant beans.");
        names == ["Eve", "avenCEO", "avenALICE", "avenBOB", "avenCHARLY", "Maia City COOP"]
            && w.spaces.iter().any(|s| s.items.iter().any(beans))
    };
    until("her other browser shows every vault and avenALICE's note", reads).await;
    for n in [first.node(), other.node(), &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// The text the note viewer shows on line `line` of `note`'s history (`Device::note`).
fn on_line(note: &serde_json::Value, line: Option<&str>) -> String {
    let lines = note["lines"].as_array().expect("its lines");
    let found = lines.iter().find(|l| l["line"].as_str() == line).expect("the line");
    found["text"].as_str().unwrap_or_default().to_string()
}

/// The kinds of `note`'s writes, in the order its device took them.
fn kinds(note: &serde_json::Value) -> Vec<String> {
    let commits = note["commits"].as_array().expect("its writes");
    commits.iter().map(|c| c["kind"].as_str().unwrap_or_default().to_string()).collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_note_branches_merges_and_forks_and_the_database_shows_every_record() {
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
    let first = Device::found(first, &server.offer(), None, eve.unlock([1; 32]), &eve).await.expect("her vault");
    eve.steps();
    let v = first.vault().await.expect("her vault");
    let home = first.world().await.and_then(|w| named(&w, v).1).expect("her home");
    let note = first.write(v, home, "Plan".into(), "Plant beans.".into()).await.expect("a note");
    let at = (home, note);
    first.set_text_on(v, at, None, 2, "Plant beans and peas.".into()).await.expect("an edit");
    let shown = first.note(home, note).await.expect("its history");
    assert_eq!(kinds(&shown), ["edit", "edit"]);
    let commits = shown["commits"].as_array().expect("its writes");
    assert_eq!(
        (commits[1]["before"].as_str(), commits[1]["text"].as_str()),
        (Some("Plant beans."), Some("Plant beans and peas."))
    );
    assert_eq!(commits[0]["before"], serde_json::Value::Null, "the first write built on nothing");
    let edit = commits[1]["op"].as_str().expect("the edit's id").to_string();
    // a branch from the main line's head: its own line, named, from that version
    let heads = || async { first.note(home, note).await.expect("its history")["lines"][0]["heads"].clone() };
    let from: Vec<String> = serde_json::from_value(heads().await).expect("the heads");
    assert_eq!(from, std::slice::from_ref(&edit));
    let ops = |ids: &[String]| ids.iter().map(|h| avendb::id::OpId(hex32(h))).collect::<Vec<_>>();
    let draft = first.branch(v, at, ops(&from), "draft".into()).await.expect("a branch");
    first.set_text_on(v, at, Some(draft), 2, "Plant beans, peas and corn.".into()).await.expect("an edit on it");
    let shown = first.note(home, note).await.expect("its history");
    let b = hex_of(&draft.0);
    assert_eq!(shown["lines"][1]["name"].as_str(), Some("draft"));
    assert_eq!(shown["lines"][1]["from"], serde_json::json!([edit]));
    assert_eq!(
        (on_line(&shown, None), on_line(&shown, Some(&b))),
        ("Plant beans and peas.".into(), "Plant beans, peas and corn.".into())
    );
    assert_eq!(kinds(&shown), ["edit", "edit", "branch", "edit"]);
    let corn = shown["commits"][3]["op"].as_str().expect("the branch's edit").to_string();
    let all: Vec<&str> =
        shown["commits"].as_array().expect("its writes").iter().map(|c| c["op"].as_str().unwrap()).collect();
    assert_eq!(shown["lines"][0]["history"], serde_json::json!(all[..2]), "the main line: the first two");
    assert_eq!(shown["lines"][1]["history"], serde_json::json!(all), "the branch: what it builds on, then its own");
    assert_eq!(
        shown["commits"][2]["from"],
        serde_json::json!({ "line": null, "name": "main" }),
        "it started from main"
    );
    // merged into the main line: a write that carries no change, and the main line shows the branch's edit
    first.merge(v, at, (Some(draft), None), false).await.expect("merged");
    let shown = first.note(home, note).await.expect("its history");
    assert_eq!(kinds(&shown).last().map(String::as_str), Some("merge"));
    assert_eq!(on_line(&shown, None), "Plant beans, peas and corn.");
    let merge = &shown["commits"][4];
    assert_eq!(merge["from"], serde_json::json!({ "line": b, "name": "draft" }), "it brought in the branch");
    assert_eq!(
        (merge["before"].as_str(), merge["text"].as_str()),
        (Some("Plant beans and peas."), Some("Plant beans, peas and corn.")),
        "what the merge brought to the main line"
    );
    // the branch's edit undone on the main line, every other change kept; then the first version restored
    first.undo(v, at, None, avendb::id::OpId(hex32(&corn))).await.expect("undone");
    assert_eq!(on_line(&first.note(home, note).await.expect("its history"), None), "Plant beans and peas.");
    let made = first.note(home, note).await.expect("its history")["commits"][0]["op"].as_str().map(str::to_string);
    let made = made.expect("the first write");
    first.restore(v, at, None, ops(&[made])).await.expect("restored");
    assert_eq!(on_line(&first.note(home, note).await.expect("its history"), None), "Plant beans.");
    // the branch goes on, and a promote brings the main line to exactly what the branch shows
    first.set_text_on(v, at, Some(draft), 2, "Corn first.".into()).await.expect("another edit on the branch");
    first.merge(v, at, (Some(draft), None), true).await.expect("promoted");
    let shown = first.note(home, note).await.expect("its history");
    assert_eq!(kinds(&shown).last().map(String::as_str), Some("promote"));
    assert_eq!((on_line(&shown, None), on_line(&shown, Some(&b))), ("Corn first.".into(), "Corn first.".into()));
    // a fork: the branch's note as a new entry of her home, with none of its history
    let fork = first.fork(v, at, Some(draft), home).await.expect("forked");
    let forked = first.note(home, fork).await.expect("the fork's history");
    assert_eq!((kinds(&forked), on_line(&forked, None)), (vec!["edit".to_string()], "Corn first.".to_string()));
    assert_eq!(eve.steps(), [], "no ceremony for any of it");
    // her database: the note's record and lines, the fork, her browser's card; the schemas the app ships
    let db = first.database(v).await;
    assert_eq!(db["vault"].as_str(), Some(hex_of(&v.0).as_str()));
    let space = &db["spaces"][0];
    assert_eq!(space["id"].as_str(), Some(hex_of(&home.0).as_str()));
    let rows = space["rows"].as_array().expect("its rows");
    let row = |e: EntryId| rows.iter().find(|r| r["entry"].as_str() == Some(hex_of(&e.0).as_str())).expect("the row");
    let plan = row(note);
    assert_eq!(
        (plan["kind"].as_str(), plan["title"].as_str(), plan["tag"].as_str()),
        (Some("document"), Some("Plan"), None)
    );
    assert_eq!((plan["lines"].as_u64(), plan["branches"].clone()), (Some(2), serde_json::json!(["draft"])));
    assert_eq!(plan["writes"].as_u64(), Some(kinds(&shown).len() as u64));
    assert_eq!(plan["record"]["blocks"][1]["text"].as_str(), Some("Corn first."));
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
        serde_json::json!([avendb::lens::DOCUMENT_V2.id().to_hex()]),
        "written under document v2"
    );
    assert!(schemas.contains(&avendb::lens::DOCUMENT_V2.id().to_hex()));
    assert_eq!(row(fork)["record"]["blocks"][1]["text"].as_str(), Some("Corn first."));
    let card = rows.iter().find(|r| r["tag"].as_str() == Some("card")).expect("her browser's card");
    assert_eq!(card["title"].as_str(), Some("Eve's browser"));
    assert_eq!(space["ops"]["founded"].as_u64(), Some(1));
    assert!(space["ops"]["writes"].as_u64().is_some_and(|n| n >= kinds(&shown).len() as u64 + 2), "{}", space["ops"]);
    assert!(space["ops"]["grants"].as_u64().is_some_and(|n| n >= 1), "avenCEO relays it");
    assert_eq!(db["builtIn"]["lenses"][0]["title"].as_str(), Some("Markdown document, v1 to v2"));
    // the server relays her home and opens none of it: its rows are sealed
    let sealed = move |lab: &Lab, me| {
        let held = lab.state(me).space(home).is_some_and(|s| s.entries.contains(&fork));
        held && lab.item(me, home, note).is_none()
    };
    until("the server keeps her home's log, sealed", || server.read(sealed)).await;
    for n in [first.node(), &server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// 32 bytes from their 64 hex digits.
fn hex32(s: &str) -> [u8; 32] {
    avendb::id::BlobId::from_hex(s).expect("an id").0
}

/// 32 bytes as their 64 hex digits, as the page sees them.
fn hex_of(b: &[u8; 32]) -> String {
    avendb::id::BlobId(*b).to_hex()
}
