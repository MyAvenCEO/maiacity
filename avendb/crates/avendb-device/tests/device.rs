//! The Mac app's native device (avendb-device), as the app runs it: lines of JSON on its stdin and stdout, and each of
//! its person's passkey's ceremonies in the sign-in sheet, which the app shows and whose page seals what it brings back
//! to the key the device made for that ceremony alone. Here the app is the test, and the sheet's page a software
//! passkey that seals as the page does (avendb-browser's `sealCeremony`). Eve founds her vault from the Mac in two
//! sheets, through a relay open to sign-up; the device keeps her vault in its folder, opens again from it in the
//! unlock's sheet alone, and puts it aside when she forgets it there. A device her browser made before, before
//! 2026-10-10 even, moves into the folder as it opens (`adopt`), the same device, and opens again from the folder
//! after.

use std::collections::HashMap;
use std::future::Future;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use avendb::cast::*;
use avendb::id::EntryId;
use avendb::keys::{self, SeededRng};
use avendb::lab::Lab;
use avendb::sign::{Ceremony, PRF_SALT, Passkey, device_salt};
use avendb_browser::{Device, Fresh, Start, Unlock};
use avendb_device::{ASIDE, Config, META, SHEET, STORE, serve};
use avendb_net::{Admission, Authenticator, Node, Options, Step};
use avendb_server::Relay;
use data_encoding::{BASE64, BASE64URL_NOPAD};
use iroh::RelayUrl;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader, DuplexStream, Lines, ReadHalf, WriteHalf};
use tokio::task::JoinHandle;

/// A socket of the system's choosing on this machine.
const LOOPBACK: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 0);

/// The id of Eve's passkey's credential, as her browser names it.
const CREDENTIAL: &str = "ZXZlcy1wYXNza2V5";

/// The app, as the device sees it: it asks on the device's stdin and reads its answers and sheets on its stdout, and
/// shows each sheet, the person's passkey answering in it.
struct App {
    to: Option<WriteHalf<DuplexStream>>,
    from: Lines<BufReader<ReadHalf<DuplexStream>>>,
    serving: JoinHandle<anyhow::Result<()>>,
    passkey: Passkey,
    /// What each sheet was for, since the test last asked.
    asked: Vec<String>,
    /// Whether the person closes the next sheet instead of using their passkey.
    cancel: bool,
    next: u64,
}

impl App {
    /// The app starts the device on folder `dir`, Eve's passkey answering its sheets.
    fn start(dir: &Path, passkey: Passkey, direct: bool) -> App {
        let (app, device) = tokio::io::duplex(1 << 20);
        let (input, output) = tokio::io::split(device);
        let serving = tokio::spawn(serve(Config { dir: dir.to_path_buf(), direct }, input, output));
        let (from, to) = tokio::io::split(app);
        let from = BufReader::new(from).lines();
        App { to: Some(to), from, serving, passkey, asked: vec![], cancel: false, next: 0 }
    }

    /// Call `call` with `args` on the device, showing each sheet it asks for meanwhile: its answer, or its error.
    async fn call(&mut self, call: &str, args: Value) -> Result<Value, String> {
        self.next += 1;
        let id = self.next;
        self.say(json!({ "id": id, "call": call, "args": args })).await;
        loop {
            let line = tokio::time::timeout(Duration::from_secs(120), self.from.next_line()).await;
            let line = line.expect("an answer within 120 s").expect("the device's stdout").expect("a line");
            let message: Value = serde_json::from_str(&line).expect("a line of JSON");
            if let Some(n) = message.get("sheet").and_then(Value::as_u64) {
                let answer = self.sheet(n, message["url"].as_str().expect("the sheet's URL"));
                self.say(answer).await;
            } else {
                assert_eq!(message["id"].as_u64(), Some(id), "an answer to the call: {message}");
                return match message.get("ok") {
                    Some(ok) => Ok(ok.clone()),
                    None => Err(message["error"].as_str().expect("an answer or an error").to_string()),
                };
            }
        }
    }

    async fn say(&mut self, message: Value) {
        let to = self.to.as_mut().expect("the app runs");
        to.write_all(format!("{message}\n").as_bytes()).await.expect("the device's stdin");
    }

    /// Sheet `n` at `url`, as maia.city's sheet page runs it: the ceremony the fragment asks for, sealed to its key and
    /// bound to its challenge, sent back to the app's scheme; or the person closed it.
    fn sheet(&mut self, n: u64, url: &str) -> Value {
        let fragment = url.strip_prefix(SHEET).and_then(|u| u.strip_prefix('#')).expect("maia.city's sheet page");
        // every value is base64url or a word, which a URL holds as it is
        let asked: HashMap<&str, &str> = fragment.split('&').map(|p| p.split_once('=').expect("a pair")).collect();
        let bytes = |k: &str| BASE64URL_NOPAD.decode(asked[k].as_bytes()).expect("base64url");
        self.asked.push(asked["what"].to_string());
        if std::mem::take(&mut self.cancel) {
            return json!({ "sheet": n, "error": "You closed the sign-in sheet." });
        }
        assert_eq!(bytes("salt"), PRF_SALT, "the app's PRF salt");
        assert!(asked.get("id").is_none_or(|id| *id == CREDENTIAL), "her passkey's credential, if any");
        let challenge: [u8; 32] = bytes("challenge").try_into().expect("a challenge of 32 bytes");
        let Ceremony { assertion, .. } = self.passkey.ceremony(challenge);
        let prf = self.passkey.prf(PRF_SALT);
        let device = asked.contains_key("device").then(|| self.passkey.prf(&bytes("device")));
        let parts: [&[u8]; 6] = [
            CREDENTIAL.as_bytes(),
            &assertion.authenticator_data,
            &assertion.client_data_json,
            &assertion.signature,
            &prf[..],
            device.as_ref().map_or(&[][..], |d| &d[..]),
        ];
        let mut plain = vec![];
        for part in parts {
            plain.extend_from_slice(&u32::try_from(part.len()).expect("a short part").to_le_bytes());
            plain.extend_from_slice(part);
        }
        let info = [&b"avenDB sign-in sheet "[..], &challenge].concat();
        let mut rng = SeededRng::new("the test's sign-in sheet", &challenge);
        let sealed = keys::seal_once(&bytes("key"), &plain, &info, &mut rng).expect("an X-Wing key");
        json!({ "sheet": n, "back": format!("city.maia.studio://avendb#sealed={}", BASE64URL_NOPAD.encode(&sealed)) })
    }

    /// What the sheets since the last ask were for.
    fn asked(&mut self) -> Vec<String> {
        std::mem::take(&mut self.asked)
    }

    /// The app quits: the device's stdin ends, and it closes.
    async fn quit(mut self) {
        let mut to = self.to.take().expect("the app runs");
        to.shutdown().await.expect("the device's stdin ends");
        let done = tokio::time::timeout(Duration::from_secs(60), &mut self.serving).await;
        done.expect("the device stops within 60 s").expect("the device's task").expect("the device stops cleanly");
    }
}

/// A browser's authenticator, holding its person's passkey, as a page's device asks it.
struct Browser(Mutex<Passkey>);

impl Authenticator for Browser {
    async fn ceremony(&self, challenge: [u8; 32], _: Step) -> anyhow::Result<Ceremony> {
        Ok(self.0.lock().expect("the authenticator").ceremony(challenge))
    }
}

impl Browser {
    /// The ceremony that unlocks the device whose salt ends in `nonce`, over `challenge`.
    fn unlock(&self, nonce: [u8; 32], challenge: [u8; 32]) -> Unlock {
        let mut passkey = self.0.lock().expect("the authenticator");
        let device = passkey.prf(&device_salt(&nonce));
        Unlock { ceremony: passkey.ceremony(challenge), device }
    }
}

/// A folder of its own in the system's temporary folder, removed with everything in it when dropped.
struct Folder(PathBuf);

impl Folder {
    fn new(name: &str) -> Folder {
        static MADE: AtomicU32 = AtomicU32::new(0);
        let n = MADE.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).expect("after 1970").subsec_nanos();
        let path = std::env::temp_dir().join(format!("avendb-device-{name}-{}-{n}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&path).expect("a folder of its own");
        Folder(path)
    }
}

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A relay open to sign-up and the server's node through it, as at avendb.maia.city: the relay's URL, and the node.
async fn server() -> (Relay, RelayUrl, Node) {
    let admission = Admission::open();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url = relay.url();
    let mut w = world();
    let d = w.server;
    let opts = Options { relay: Some(url.clone()), admission: Some(admission), card: true, ..Options::local() };
    let node = Node::spawn(w.lab.split(d, &[], [2; 32]), d, opts).await.expect("the server's node");
    (relay, url, node)
}

/// Waits until `check` holds, 60 seconds at most.
async fn until<F: Future<Output = bool>>(what: &str, mut check: impl FnMut() -> F) {
    let end = Instant::now() + Duration::from_secs(60);
    while !check().await {
        assert!(Instant::now() < end, "{what}, within 60 s");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// An id from its hex digits, as the device names it.
fn id(v: &Value) -> [u8; 32] {
    let hex = v.as_str().expect("an id in hex");
    let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex");
    let bytes: Vec<u8> = (0..hex.len()).step_by(2).map(byte).collect();
    bytes.try_into().expect("32 bytes")
}

/// Entry `entry` as the device's world shows it, once `check` holds of it, 60 seconds at most.
async fn shown(app: &mut App, entry: &Value, what: &str, check: impl Fn(&Value) -> bool) -> Value {
    let end = Instant::now() + Duration::from_secs(60);
    loop {
        let world = app.call("world", json!([])).await.expect("its world");
        let entries = world["entries"].as_array().expect("its entries");
        if let Some(shown) = entries.iter().find(|i| i["entry"] == *entry && check(i)) {
            return shown.clone();
        }
        assert!(Instant::now() < end, "{what}, within 60 s");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// The title and text of note `entry`, as the device's world shows it.
async fn note(app: &mut App, entry: &Value) -> Option<(String, String)> {
    let world = app.call("world", json!([])).await.expect("its world");
    let entries = world["entries"].as_array().expect("its entries");
    let note = entries.iter().find(|i| i["entry"] == *entry)?;
    Some((note["title"].as_str()?.to_string(), note["text"].as_str()?.to_string()))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_mac_founds_eves_vault_opens_it_again_from_its_folder_and_forgets_it() {
    let (_relay, url, server) = server().await;
    let folder = Folder::new("found");
    let dir = folder.0.clone();
    let mut app = App::start(&dir, Passkey::from_seed([5; 32]), true);
    // a Mac with no account yet
    assert_eq!(app.call("status", json!([])).await, Ok(json!({ "meta": null, "open": false, "device": null })));
    assert_eq!(app.call("open", json!([])).await, Err("this Mac holds no avenDB account yet".into()));
    assert_eq!(app.call("world", json!([])).await, Err("avenDB isn't open here: unlock it first".into()));
    // she closes the first sheet: nothing is founded, and nothing kept
    app.cancel = true;
    let offer = server.offer().to_text();
    let found = app.call("found", json!(["Eve's Mac", url.to_string(), offer])).await;
    assert_eq!(found, Err("You closed the sign-in sheet.".into()));
    assert_eq!(app.asked(), ["unlock"]);
    assert!(!dir.join(META).exists(), "nothing to open");
    // she founds her vault from the Mac in two sheets: the unlock, which is her passkey's pass for it, and her vault
    let device = app.call("found", json!(["Eve's Mac", url.to_string(), offer])).await.expect("her vault");
    assert_eq!(app.asked(), ["unlock", "found"]);
    assert_eq!(device["passkey"], hex(&Passkey::from_seed([5; 32]).public()), "her passkey's key");
    assert!(!device["sockets"].as_array().expect("its sockets").is_empty(), "UDP sockets of its own");
    let status = app.call("status", json!([])).await.expect("its status");
    assert_eq!((&status["open"], &status["device"]), (&json!(true), &device));
    assert_eq!(status["meta"]["name"], "Eve's Mac");
    assert_eq!(status["meta"]["credential"], CREDENTIAL, "the credential her ceremonies named");
    assert!(status["meta"]["mask"].as_str().is_some_and(|m| m.len() == 64), "its secret, masked: {status}");
    let again = app.call("found", json!(["Eve's Mac", url.to_string(), server.offer().to_text()])).await;
    assert_eq!(again, Err("this Mac holds an avenDB account already: forget it here first".into()));
    // a note in her vault, which the server keeps, as the relay cap her vault gave it at its founding reaches it
    let vault = app.call("world", json!([])).await.expect("its world")["mine"].clone();
    let args = json!([vault, vault, "Seeds", "Tomatoes in March.", ["garden"]]);
    let entry = app.call("write", args).await.expect("a note");
    let e = EntryId(id(&entry));
    let holds = move |lab: &Lab, me| lab.fetched(me, e) > 0;
    until("the server keeps her note", || server.read(holds)).await;
    let garden = |n: &Value| n["type"] == "note" && n["tags"] == json!(["garden"]) && n["title"] == "Seeds";
    shown(&mut app, &entry, "her note, tagged", garden).await;
    // a todo for her work, which she shares with everyone to read, and then no longer
    let todo = app.call("todo", json!([vault, vault, "Sow tomatoes", ["work"]])).await.expect("a todo");
    assert_eq!(app.call("setStatus", json!([vault, todo, "doing"])).await, Ok(Value::Null));
    assert_eq!(app.call("tag", json!([vault, todo, ["urgent"], []])).await, Ok(Value::Null));
    let doing = |t: &Value| t["status"] == "doing" && t["tags"] == json!(["work", "urgent"]) && t["public"] == false;
    shown(&mut app, &todo, "her todo, doing and urgent", doing).await;
    let work = json!({ "select": [[{ "type": ["todo"] }, { "tag": "work" }]] });
    let cap = app.call("share", json!([vault, vault, work, "read", "public"])).await.expect("a cap");
    shown(&mut app, &todo, "her work todos, public", |t| t["public"] == true).await;
    let world = app.call("world", json!([])).await.expect("its world");
    let caps = world["caps"].as_array().expect("its caps");
    let shared = caps.iter().find(|c| c["id"] == cap).expect("the cap");
    let (grantee, role, select) = (&shared["grantee"], &shared["role"], &shared["slice"]["select"]);
    assert_eq!((grantee, role, select), (&json!("public"), &json!("read"), &work["select"]), "her work todos");
    assert_eq!(shown(&mut app, &entry, "her note", |n| n["public"] == false).await["title"], "Seeds", "not a todo");
    assert_eq!(app.call("revoke", json!([vault, cap])).await, Ok(Value::Null));
    shown(&mut app, &todo, "her work todos, hers alone again", |t| t["public"] == false).await;
    let size = app.call("size", json!([])).await.expect("its size");
    assert!(size[0].as_u64().expect("its edits") > 0, "it holds her vault's edits: {size}");
    assert_eq!(app.call("changed", json!([0, 0])).await, Ok(json!(true)), "it holds more than nothing at once");
    // the page's other calls
    assert_eq!(app.call("rename", json!(["Eve's MacBook"])).await, Ok(json!(true)), "a new card");
    let svg = app.call("qrSvg", json!([device["offer"], 240])).await.expect("a QR code");
    assert!(svg.as_str().expect("an image").contains("<svg"), "an SVG image");
    assert_eq!(app.call("nope", json!([])).await, Err("no call \"nope\"".into()));
    assert_eq!(app.call("write", json!(["x"])).await, Err("\"x\" is no id".into()));
    assert!(app.asked().is_empty(), "with no sheet");
    app.quit().await;
    // the app starts again: the device opens from its folder in the unlock's sheet alone, the same device
    assert!(dir.join(META).exists() && dir.join(STORE).join("ops").exists(), "its folder keeps it");
    let mut app = App::start(&dir, Passkey::from_seed([5; 32]), true);
    let status = app.call("status", json!([])).await.expect("its status");
    assert_eq!((&status["open"], &status["meta"]["name"]), (&json!(false), &json!("Eve's MacBook")));
    let opened = app.call("open", json!([])).await.expect("it opens again");
    assert_eq!(app.asked(), ["unlock"]);
    assert_eq!((&opened["id"], &opened["endpoint"]), (&device["id"], &device["endpoint"]), "the same device");
    assert_eq!(app.call("open", json!([])).await, Ok(opened), "open already");
    assert!(app.asked().is_empty());
    let read = note(&mut app, &entry).await;
    assert_eq!(read, Some(("Seeds".into(), "Tomatoes in March.".into())), "it reads what its folder kept");
    // she forgets it here: its store and what opens it are put aside, never deleted
    assert_eq!(app.call("forget", json!([])).await, Ok(Value::Null));
    assert_eq!(app.call("status", json!([])).await, Ok(json!({ "meta": null, "open": false, "device": null })));
    assert!(!dir.join(META).exists() && !dir.join(STORE).exists());
    let aside = std::fs::read_dir(dir.join(ASIDE)).expect("aside");
    let aside: Vec<_> = aside.map(|e| e.expect("an entry").path()).collect();
    let [forgotten] = aside.as_slice() else { panic!("one store put aside: {aside:?}") };
    assert!(forgotten.to_string_lossy().ends_with("-forgotten"));
    assert!(forgotten.join(META).exists() && forgotten.join(STORE).join("ops").exists());
    app.quit().await;
    server.shutdown().await.expect("the server's node stops");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_device_her_browser_made_moves_into_the_macs_folder_and_opens_from_it_after() {
    let (_relay, url, server) = server().await;
    // the app's page made her device before, in the web view, its store in IndexedDB; before 2026-10-10 even, so its
    // secret is the PRF output on its salt itself, and the page kept no mask
    let browser = Browser(Mutex::new(Passkey::from_seed([5; 32])));
    let nonce = [1; 32];
    let old = Fresh::from_secret(*browser.0.lock().expect("the authenticator").prf(&device_salt(&nonce)));
    let start = Start {
        name: "Eve's Mac".into(),
        relay: url.clone(),
        entropy: [7; 32],
        now: SystemTime::now().duration_since(UNIX_EPOCH).expect("after 1970").as_secs(),
        direct: false,
        store: None,
    };
    let unlock = browser.unlock(nonce, old.challenge(start.now));
    let page = Device::found(start, &server.offer(), None, old, unlock, &browser).await.expect("her vault");
    let vault = page.vault().await.expect("her vault");
    let seeds = ("Seeds".into(), "Tomatoes in March.".into());
    let entry = page.write(vault, vault, seeds, vec![]).await.expect("a note");
    let edits = page.edits(0).await.expect("its edits");
    let mut keys = vec![];
    for id in page.key_ids().await {
        keys.push(page.key(id).await.expect("a key it holds"));
    }
    let (device, p256) = (page.node().device(), page.p256());
    page.close().await.expect("the page's device closes");
    // the app moves it into its folder as it opens, in the unlock's sheet alone
    let folder = Folder::new("adopt");
    let mut app = App::start(&folder.0, Passkey::from_seed([5; 32]), false);
    let meta = json!({
        "name": "Eve's Mac",
        "relay": url.to_string(),
        "nonce": hex(&nonce),
        "credential": CREDENTIAL,
        "passkey": hex(&p256),
    });
    let edits: Vec<_> = edits.iter().map(|e| BASE64.encode(e)).collect();
    let keys: Vec<_> = keys.iter().map(|k| BASE64.encode(k)).collect();
    let adopted = app.call("adopt", json!([meta, edits, keys])).await.expect("it moves in");
    assert_eq!(app.asked(), ["unlock"]);
    assert_eq!(adopted["id"], hex(&device.0), "the same device");
    assert!(adopted["sockets"].as_array().expect("its sockets").is_empty(), "on its relay alone, as asked");
    let entry = json!(hex(&entry.0));
    let read = note(&mut app, &entry).await;
    assert_eq!(read, Some(("Seeds".into(), "Tomatoes in March.".into())), "it reads what the page kept");
    let status = app.call("status", json!([])).await.expect("its status");
    assert_eq!(status["meta"], meta, "what opens it, as the page kept it");
    app.quit().await;
    // and opens from the folder after, the page's store no longer needed
    let mut app = App::start(&folder.0, Passkey::from_seed([5; 32]), false);
    let opened = app.call("open", json!([])).await.expect("it opens again");
    assert_eq!((app.asked(), &opened["id"]), (vec!["unlock".to_string()], &adopted["id"]));
    let read = note(&mut app, &entry).await;
    assert_eq!(read, Some(("Seeds".into(), "Tomatoes in March.".into())), "from its folder");
    app.quit().await;
    server.shutdown().await.expect("the server's node stops");
}

/// Bytes as lowercase hex digits.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
