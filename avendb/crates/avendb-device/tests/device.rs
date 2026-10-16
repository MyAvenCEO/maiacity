//! The Mac app's native device (avendb-device), as the app runs it: lines of JSON on its stdin and stdout, and each of
//! its person's passkey's ceremonies in the sign-in sheet, which the app shows and whose page seals what it brings back
//! to the key the device made for that ceremony alone. Here the app is the test, and the sheet's page a software
//! passkey that seals as the page does (avendb-browser's `sealCeremony`). Eve founds her vault from the Mac in two
//! sheets, through a relay open to sign-up; the device keeps her vault on the shelf in its folder, opens again from it
//! in the unlock's sheet alone, following the vaults it followed and reading as deep in a query as it did, and puts the
//! shelf aside when she forgets it there, deleting nothing. Every read and change is an op (`run`, V2), what her
//! vault's owners approve signed in a sheet; a file comes in a chunk at a time (`fileStart`, `fileChunk`, `fileEnd`),
//! and any range of it back, in base64. A new device puts aside a shelf a start cut short left, and clears what an
//! earlier avenDB kept in the folder. The app may host the same device in its own process (`host`): the same calls and
//! sheets with no lines between, and the open device's node at hand, which reads her film back by range itself; closed,
//! it opens again from its folder. And agent devices on the Mac (`agent`), as Claude Code and Codex start them, ask
//! for access; she denies, it asks again, and the page's consent screen adds both under her one aven avenEve, founded
//! with the first, a device vault and a sheet each, with the shares the aven passes on to them; the same harness on her
//! other Mac joins its agent's device vault there. An agent saves a file of her Mac by its path as its shares allow,
//! an Editor's and not a Suggester's, and keeps it while her Mac keeps a light copy, then lets go of it once her Mac
//! keeps a full one: one copy on her Mac. It reads a file back to a path on her Mac, every byte, from its own shelf
//! or else from her Mac, never over a file there unless it says so, a small text file inline; a Suggester reads it
//! too, and no agent reads a file of a vault none of its shares reaches. An agent adds a spark to her own vault by
//! its fields' plain names, as the page captures one, and her Mac reads it; one that may add a spark nowhere says so,
//! and where it may. Her aven passes on no more than it holds of a coop that hired it, and the coop taking its share
//! back ends its agent's. And Eve's photo drive (`drive`) joins her vault as a device of its own in one
//! sheet, its key never on it in plain; the Mac it is plugged into hosts it, a full copy; unplugged, its node stops and
//! its signed holdings stay, with when it checked; plugged in again it is hosted with no sheet; ejected, nothing on it
//! stays open, and plugged in again it is hosted with no sheet; her other Mac opens it in one; removed like a lost
//! phone, her vault's peers refuse it.

use std::collections::HashMap;
use std::future::Future;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use avendb::cast::*;
use avendb::id::{EntryId, ShareId, SignerId, VaultId};
use avendb::keys::{self, SeededRng};
use avendb::lab::Lab;
use avendb::policy::{Action, Kind, Level, Principal, Revoking, Sharing};
use avendb::sealed::FileRoot;
use avendb::slice::Selector;
use avendb::sign::{Ceremony, DeviceKey, PRF_SALT, Passkey, device_salt};
use avendb_device::{Config, Host, SHEET, agent, drive, host, serve};
use avendb_net::shelf::FLOOR;
use avendb_net::{Admission, Node, Options, disk};
use avendb_server::Relay;
use bytes::Bytes;
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
        App::with(Config { dir: dir.to_path_buf(), direct, volumes: None }, passkey)
    }

    /// The app starts the device on folder `dir`, hosting the drives mounted in folder `volumes`, as macOS mounts them
    /// in /Volumes.
    fn with_volumes(dir: &Path, volumes: &Path, passkey: Passkey) -> App {
        App::with(Config { dir: dir.to_path_buf(), direct: true, volumes: Some(volumes.to_path_buf()) }, passkey)
    }

    fn with(config: Config, passkey: Passkey) -> App {
        let (app, device) = tokio::io::duplex(1 << 20);
        let (input, output) = tokio::io::split(device);
        let serving = tokio::spawn(serve(config, input, output));
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

    /// Sheet `n` at `url`, as maia.city's sheet page runs it (`sheet_page`); or the person closed it.
    fn sheet(&mut self, n: u64, url: &str) -> Value {
        let asked = asked_in(url);
        self.asked.push(asked["what"].to_string());
        if std::mem::take(&mut self.cancel) {
            return json!({ "sheet": n, "error": "You closed the sign-in sheet." });
        }
        sheet_page(&mut self.passkey, n, &asked)
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

/// What the sign-in sheet at `url` asks, by name: the fragment of maia.city's sheet page.
fn asked_in(url: &str) -> HashMap<&str, &str> {
    let fragment = url.strip_prefix(SHEET).and_then(|u| u.strip_prefix('#')).expect("maia.city's sheet page");
    // every value is base64url or a word, which a URL holds as it is
    fragment.split('&').map(|p| p.split_once('=').expect("a pair")).collect()
}

/// Sheet `n`'s answer, as maia.city's sheet page runs it with `passkey`: the ceremony `asked` asks for, sealed to its
/// key and bound to its challenge, sent back to the app's scheme.
fn sheet_page(passkey: &mut Passkey, n: u64, asked: &HashMap<&str, &str>) -> Value {
    let bytes = |k: &str| BASE64URL_NOPAD.decode(asked[k].as_bytes()).expect("base64url");
    assert_eq!(bytes("salt"), PRF_SALT, "the app's PRF salt");
    assert!(asked.get("id").is_none_or(|id| *id == CREDENTIAL), "her passkey's credential, if any");
    let challenge: [u8; 32] = bytes("challenge").try_into().expect("a challenge of 32 bytes");
    let Ceremony { assertion, .. } = passkey.ceremony(challenge);
    let prf = passkey.prf(PRF_SALT);
    let device = asked.contains_key("device").then(|| passkey.prf(&bytes("device")));
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

/// The Mac app with avenDB's device in its own process (`avendb_device::host`), in place of the sidecar: each call
/// straight to the host, and each sheet the device asks for meanwhile shown, the person's passkey answering in it, its
/// answer handed to the host (`Host::answer`).
struct InApp {
    host: Host,
    sheets: avendb_device::Lines,
    passkey: Passkey,
    /// What each sheet was for, since the test last asked.
    asked: Vec<String>,
    /// Whether the person closes the next sheet instead of using their passkey.
    cancel: bool,
}

impl InApp {
    /// The app hosts the device on folder `dir`, Eve's passkey answering its sheets.
    fn start(dir: &Path, passkey: Passkey) -> InApp {
        let (host, sheets) = host(Config { dir: dir.to_path_buf(), direct: true, volumes: None }).expect("hosted");
        InApp { host, sheets, passkey, asked: vec![], cancel: false }
    }

    /// Call `call` with `args` on the device, showing each sheet it asks for meanwhile: its answer, `{"ok": value}` or
    /// `{"error": why}`.
    async fn call(&mut self, call: &str, args: Value) -> Value {
        let (host, call, args) = (self.host.clone(), call.to_string(), args.as_array().cloned().expect("its args"));
        let mut answer = tokio::spawn(async move { host.call(&call, args).await });
        let end = Instant::now() + Duration::from_secs(120);
        loop {
            let sheet = tokio::select! {
                done = &mut answer => return done.expect("the call's task"),
                sheet = self.sheets.recv() => sheet.expect("the device's sheets"),
                () = tokio::time::sleep_until(end.into()) => panic!("an answer within 120 s"),
            };
            let n = sheet["sheet"].as_u64().expect("a sheet, all the device sends unprompted");
            let asked = asked_in(sheet["url"].as_str().expect("the sheet's URL"));
            self.asked.push(asked["what"].to_string());
            let back = match std::mem::take(&mut self.cancel) {
                true => json!({ "sheet": n, "error": "You closed the sign-in sheet." }),
                false => sheet_page(&mut self.passkey, n, &asked),
            };
            self.host.answer(&back);
        }
    }

    /// What the sheets since the last ask were for.
    fn asked(&mut self) -> Vec<String> {
        std::mem::take(&mut self.asked)
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

/// The steps of the device's last start, by name, as the page shows them (`steps`), once it is over: each with how
/// long it took.
async fn steps(app: &mut App) -> Vec<String> {
    let shown = app.call("steps", json!([])).await.expect("its steps");
    assert_eq!(shown["over"], true, "over: {shown}");
    let steps = shown["steps"].as_array().expect("its steps");
    assert!(steps.iter().all(|s| s["took"].is_u64() && s["at"].is_u64()), "each with its times: {shown}");
    steps.iter().map(|s| s["step"].as_str().expect("a name").to_string()).collect()
}

/// The names of the objects on shelf `g` in folder `dir` under `under`, in order.
fn objects(dir: &Path, g: u64, under: &str) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir.join(format!("g{g}")).join(under)) else { return vec![] };
    let mut names: Vec<String> = entries.map(|e| e.expect("an entry").file_name().to_string_lossy().into()).collect();
    names.sort();
    names
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

/// The device's world, as the page reads it (the `world` op).
async fn world_of(app: &mut App) -> Value {
    run(app, json!({ "op": "world" })).await.expect("its world")
}

/// Entry `entry` as the device's world shows it, once `check` holds of it, 60 seconds at most.
async fn shown(app: &mut App, entry: &Value, what: &str, check: impl Fn(&Value) -> bool) -> Value {
    let end = Instant::now() + Duration::from_secs(60);
    loop {
        let world = world_of(app).await;
        let entries = world["entries"].as_array().expect("its entries");
        if let Some(shown) = entries.iter().find(|i| i["entry"] == *entry && check(i)) {
            return shown.clone();
        }
        assert!(Instant::now() < end, "{what}, within 60 s");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Op `op` of the ops engine, run on the device as the page runs every read and change: what it did, or its refusal,
/// whole.
async fn run(app: &mut App, op: Value) -> Result<Value, Value> {
    let out = app.call("run", json!([op])).await.expect("an answer");
    out.get("ok").cloned().ok_or(out)
}

/// A note as the page writes one: a document titled `title`, its heading (block 1) the title too, then a paragraph
/// (block 2) that reads `text`.
fn titled(title: &str, text: &str) -> Value {
    json!({ "kind": "document", "title": title, "blocks": [
        { "id": 1, "type": "heading", "level": 1, "text": title },
        { "id": 2, "type": "paragraph", "text": text },
    ] })
}

/// The title and text of note `entry`, as the device's world shows it.
async fn note(app: &mut App, entry: &Value) -> Option<(String, String)> {
    let world = world_of(app).await;
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
    let world = app.call("run", json!([{ "op": "world" }])).await;
    assert_eq!(world, Err("avenDB isn't open here: unlock it first".into()));
    assert_eq!(app.call("steps", json!([])).await, Ok(Value::Null), "no start yet");
    // she closes the first sheet: nothing is founded, and nothing kept
    app.cancel = true;
    let offer = server.offer().to_text();
    let found = app.call("found", json!(["Eve's Mac", url.to_string(), offer])).await;
    assert_eq!(found, Err("You closed the sign-in sheet.".into()));
    assert_eq!(app.asked(), ["unlock"]);
    assert_eq!(steps(&mut app).await, ["unlock"], "it stopped at the unlock");
    assert_eq!(disk::generations(&dir).expect("its shelves"), [FLOOR], "one shelf");
    assert!(objects(&dir, FLOOR, "meta").is_empty(), "nothing to open");
    // she founds her vault from the Mac in two sheets: the unlock, which is her passkey's pass for it, and her vault
    let device = app.call("found", json!(["Eve's Mac", url.to_string(), offer])).await.expect("her vault");
    assert_eq!(app.asked(), ["unlock", "found"]);
    let founding = ["unlock", "keys", "node", "server", "draft", "sign", "settle"];
    assert_eq!(steps(&mut app).await, founding, "each step the page showed, the server Alice's vault's already");
    assert_eq!(device["passkey"], hex(&Passkey::from_seed([5; 32]).public()), "her passkey's key");
    assert!(!device["sockets"].as_array().expect("its sockets").is_empty(), "UDP sockets of its own");
    let status = app.call("status", json!([])).await.expect("its status");
    assert_eq!((&status["open"], &status["device"]), (&json!(true), &device));
    assert_eq!(status["meta"]["name"], "Eve's Mac");
    assert_eq!(status["meta"]["credential"], CREDENTIAL, "the credential her ceremonies named");
    assert!(status["meta"]["mask"].as_str().is_some_and(|m| m.len() == 64), "its secret, masked: {status}");
    let again = app.call("found", json!(["Eve's Mac", url.to_string(), server.offer().to_text()])).await;
    assert_eq!(again, Err("this Mac holds an avenDB account already: forget it here first".into()));
    // a note in her vault, which the server keeps, as the relay share her vault gave it at its founding reaches it
    let vault = world_of(&mut app).await["mine"].clone();
    let seeds = titled("Seeds", "Tomatoes in March.");
    let write = json!({ "op": "create", "vault": vault, "type": "note", "tags": ["garden"], "value": seeds });
    let entry = run(&mut app, write).await.expect("a note")["entry"].clone();
    let e = EntryId(id(&entry));
    let holds = move |lab: &Lab, me| lab.fetched(me, e) > 0;
    until("the server keeps her note", || server.read(holds)).await;
    let garden = |n: &Value| n["type"] == "note" && n["tags"] == json!(["garden"]) && n["title"] == "Seeds";
    shown(&mut app, &entry, "her note, tagged", garden).await;
    // where her note is synced to (v8 phase H): her Mac, once its folder holds it, and the server, and no other
    let (mac, keeper) = (device["id"].clone(), json!(hex(&server.device().0)));
    let synced = |n: &Value| {
        let all: Vec<&Value> = n["syncedTo"].as_array().into_iter().flatten().filter(|h| h["has"] == h["of"]).collect();
        let on = |d: &Value| all.iter().any(|h| h["device"] == *d);
        all.len() == 2 && on(&mac) && on(&keeper)
    };
    shown(&mut app, &entry, "her note, synced to her Mac and the server", synced).await;
    // a todo for her work, which she shares with everyone to read, and then no longer
    let sow = json!({ "kind": "todo", "title": "Sow tomatoes" });
    let todo = json!({ "op": "create", "vault": vault, "type": "todo", "tags": ["work"], "value": sow });
    let todo = run(&mut app, todo).await.expect("a todo")["entry"].clone();
    let doing = json!({ "op": "batch", "ops": [
        { "op": "set", "entry": todo, "path": ["status"], "value": "doing" },
        { "op": "tag", "entry": todo, "add": ["urgent"] },
    ] });
    assert_eq!(run(&mut app, doing).await.map(|done| done.as_array().map(Vec::len)), Ok(Some(2)), "two writes");
    let doing = |t: &Value| t["status"] == "doing" && t["tags"] == json!(["work", "urgent"]) && t["public"] == false;
    shown(&mut app, &todo, "her todo, doing and urgent", doing).await;
    let work = json!({ "all": [{ "type": ["todo"] }, { "tag": "work" }] });
    let public = json!({ "op": "share", "over": vault, "who": "everyone", "level": "Public", "what": work });
    let share = run(&mut app, public).await.expect("a share")["share"].clone();
    shown(&mut app, &todo, "her work todos, public", |t| t["public"] == true).await;
    let world = world_of(&mut app).await;
    let shares = world["shares"].as_array().expect("its shares");
    let shared = shares.iter().find(|c| c["id"] == share).expect("the share");
    let (who, level, slice) = (&shared["who"], &shared["level"], &shared["slice"]);
    let picks = (&slice["name"], &slice["where"], &slice["ops"]);
    assert_eq!((who, level, &shared["group"]), (&json!("everyone"), &json!("read"), &json!("Public")), "all read");
    assert_eq!(picks, (&json!("Public"), &work, &json!([{ "op": "read" }])), "her work todos, by the Public group");
    assert_eq!(shown(&mut app, &entry, "her note", |n| n["public"] == false).await["title"], "Seeds", "not a todo");
    let end = run(&mut app, json!({ "op": "revoke", "share": share })).await.expect("revoked");
    assert!(end["edit"].is_string(), "{end}");
    shown(&mut app, &todo, "her work todos, hers alone again", |t| t["public"] == false).await;
    // a new vault her vault owns: her passkey approves it in a sheet, so on the Mac an op never answers approve
    let new = json!({ "op": "found", "kind": "aven", "name": "avenEVE" });
    let made = run(&mut app, new).await.expect("a new vault");
    assert_eq!(app.asked(), ["approve"], "one sheet");
    assert_eq!(made["vaults"].as_array().map(Vec::len), Some(1), "{made}");
    // it follows avenCEO, and keeps that in what opens it again
    let avenceo = server.read(|lab, me| lab.vault_of(me)).await.expect("avenCEO");
    let follow = json!({ "op": "follow", "vault": hex(&avenceo.0), "on": true });
    assert_eq!(run(&mut app, follow).await, Ok(json!({ "follow": [hex(&avenceo.0)] })));
    let status = app.call("status", json!([])).await.expect("its status");
    assert_eq!(status["meta"]["follow"], json!([hex(&avenceo.0)]));
    // its queries read 7 rows and links down at most, as Settings sets it: it keeps that in what opens it again too
    let limits = |depth: usize| json!({ "depth": depth, "default": 16, "ceiling": 256 });
    assert_eq!(run(&mut app, json!({ "op": "limits" })).await, Ok(limits(256)), "as deep as any write reaches");
    assert_eq!(run(&mut app, json!({ "op": "set_limits", "depth": 7 })).await, Ok(limits(7)));
    assert!(app.asked().is_empty(), "a device's own setting, with no sheet");
    let status = app.call("status", json!([])).await.expect("its status");
    assert_eq!(status["meta"]["queryDepth"], 7);
    // a film, a chunk at a time in base64, as native.js hands it over, once for its key and once to seal it; then
    // any range of it back, in base64 too
    let film: Vec<u8> = (0..100_000u32).map(|i| (i * 7 % 253) as u8).collect();
    let put = json!({ "op": "put_file", "vault": vault, "name": "Film.mp4", "media": "video/mp4", "tags": [],
        "len": film.len() });
    let n = app.call("fileStart", json!([put])).await.expect("a file's number");
    let mut passes = 0;
    loop {
        passes += 1;
        let mut at = 0;
        for chunk in film.chunks(40_000) {
            assert_eq!(app.call("fileChunk", json!([n, at, BASE64.encode(chunk)])).await, Ok(Value::Null));
            at += chunk.len();
        }
        let out_of_order = app.call("fileChunk", json!([n, 5, BASE64.encode(b"late")])).await;
        assert!(out_of_order.is_err_and(|e| e.contains("came before")), "each chunk in order");
        if app.call("fileAgain", json!([n])).await != Ok(json!(true)) {
            break;
        }
    }
    assert_eq!(passes, 2, "read twice: for its key, then to seal it");
    let made = app.call("fileEnd", json!([n])).await.expect("the op's answer")["ok"].clone();
    let (root, size) = (made["root"].clone(), made["size"].clone());
    let file = shown(&mut app, &made["entry"], "the film", |f| f["kind"] == "file").await;
    assert_eq!((&file["title"], &file["files"][0]["len"]), (&json!("Film.mp4"), &json!(film.len())));
    let read = json!({ "op": "read_file", "root": root, "size": size, "from": 10, "to": 20 });
    let answer = app.call("run", json!([read])).await.expect("an answer");
    assert_eq!(answer["ok"], json!({ "root": root, "from": 10, "to": 20, "len": 10 }));
    let bytes = BASE64.decode(answer["bytes"].as_str().expect("its bytes").as_bytes()).expect("base64");
    assert_eq!(bytes, film[10..20], "the bytes beside, in base64");
    let dropped = app.call("fileStart", json!([{ "op": "put_file", "vault": vault, "name": "x", "len": 4 }])).await;
    let dropped = dropped.expect("a file's number");
    assert_eq!(app.call("fileDrop", json!([dropped])).await, Ok(Value::Null));
    assert_eq!(app.call("fileEnd", json!([dropped])).await, Err("no such file on its way in".into()), "dropped");
    for old in ["world", "share", "revoke", "foundVaults", "readFile", "database", "history"] {
        assert_eq!(app.call(old, json!([])).await, Err(format!("no call {old:?}")), "an op now");
    }
    let size = app.call("size", json!([])).await.expect("its size");
    assert!(size[0].as_u64().expect("its edits") > 0, "it holds her vault's edits: {size}");
    assert_eq!(app.call("changed", json!([0, 0])).await, Ok(json!(true)), "it holds more than nothing at once");
    // the page's other calls
    assert_eq!(app.call("rename", json!(["Eve's MacBook"])).await, Ok(json!(true)), "a new card");
    let svg = app.call("qrSvg", json!([device["offer"], 240])).await.expect("a QR code");
    assert!(svg.as_str().expect("an image").contains("<svg"), "an SVG image");
    assert_eq!(app.call("nope", json!([])).await, Err("no call \"nope\"".into()));
    let bad = run(&mut app, json!({ "op": "note", "entry": "x" })).await.expect_err("no id");
    assert_eq!((&bad["refused"], &bad["why"]), (&json!("BadOp"), &json!("entry is an id, 64 hex digits")));
    let nope = run(&mut app, json!({ "op": "nope" })).await.expect_err("no such op");
    assert_eq!((&nope["refused"], &nope["why"]), (&json!("BadOp"), &json!("no op is called \"nope\"")));
    assert!(app.asked().is_empty(), "with no sheet");
    app.quit().await;
    // the app starts again: the device opens from its folder in the unlock's sheet alone, the same device
    let metas = ["0000000000000001", "0000000000000002", "0000000000000003", "0000000000000004"];
    let kept = "what opens it, as founded, following avenCEO, reading 7 levels down, then as renamed, each kept whole";
    assert_eq!(objects(&dir, FLOOR, "meta"), metas, "{kept}");
    assert!(!objects(&dir, FLOOR, "journal").is_empty(), "its shelf keeps its edits");
    let mut app = App::start(&dir, Passkey::from_seed([5; 32]), true);
    let status = app.call("status", json!([])).await.expect("its status");
    assert_eq!((&status["open"], &status["meta"]["name"]), (&json!(false), &json!("Eve's MacBook")));
    let opened = app.call("open", json!([])).await.expect("it opens again");
    assert_eq!(app.asked(), ["unlock"]);
    assert_eq!(steps(&mut app).await, ["unlock", "keys", "restore", "node", "check"]);
    assert_eq!((&opened["id"], &opened["endpoint"]), (&device["id"], &device["endpoint"]), "the same device");
    assert_eq!(app.call("open", json!([])).await, Ok(opened), "open already");
    assert!(app.asked().is_empty());
    let read = note(&mut app, &entry).await;
    assert_eq!(read, Some(("Seeds".into(), "Tomatoes in March.".into())), "it reads what its folder kept");
    let status = app.call("status", json!([])).await.expect("its status");
    assert_eq!(status["meta"]["follow"], json!([hex(&avenceo.0)]), "and follows what it followed");
    assert_eq!(run(&mut app, json!({ "op": "limits" })).await, Ok(limits(7)), "and reads as deep as it did");
    // she forgets it here: its shelf, with what opens it, is put aside, never deleted, and a new one is in use
    assert_eq!(app.call("forget", json!([])).await, Ok(Value::Null));
    assert_eq!(app.call("status", json!([])).await, Ok(json!({ "meta": null, "open": false, "device": null })));
    assert_eq!(disk::generations(&dir).expect("its shelves"), [FLOOR, FLOOR + 1], "a new shelf beside the old");
    assert_eq!(objects(&dir, FLOOR, "meta"), metas, "the old shelf as it was");
    let (meta, journal) = (objects(&dir, FLOOR + 1, "meta"), objects(&dir, FLOOR + 1, "journal"));
    assert!(meta.is_empty() && journal.is_empty(), "the new one empty");
    app.quit().await;
    let mut app = App::start(&dir, Passkey::from_seed([5; 32]), true);
    assert_eq!(app.call("open", json!([])).await, Err("this Mac holds no avenDB account yet".into()), "forgotten");
    app.quit().await;
    server.shutdown().await.expect("the server's node stops");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_new_device_puts_aside_a_shelf_cut_short_and_clears_what_an_earlier_avendb_kept() {
    let (_relay, url, server) = server().await;
    let folder = Folder::new("aside");
    let dir = folder.0.clone();
    // a start cut short on the shelf in use: something kept, nothing that opens it
    let shelf = disk::open(&dir).expect("its shelf");
    shelf.put("journal/0000000000000001", Bytes::from_static(b"cut short")).await.expect("kept");
    drop(shelf);
    // and what an earlier avenDB kept in the folder: its store, what opened its device, a store it put aside, and a
    // shelf from before the last reset
    let opened = json!({
        "name": "Eve's old Mac",
        "relay": url.to_string(),
        "nonce": hex(&[1; 32]),
        "mask": hex(&[2; 32]),
        "credential": CREDENTIAL,
        "passkey": hex(&Passkey::from_seed([5; 32]).public()),
    });
    let opened = opened.to_string().into_bytes();
    let (aside, old) = ("aside/1760000000-forgotten/meta.json", "g1/meta/0000000000000001");
    let ops: &[u8] = &[0, 0, 0, 3, 1, 2, 3];
    let earlier = [("meta.json", &opened[..]), ("store/ops", ops), (aside, &opened), (old, &opened)];
    for (name, bytes) in earlier {
        std::fs::create_dir_all(dir.join(name).parent().expect("a folder")).expect("its folder");
        std::fs::write(dir.join(name), bytes).expect("kept");
    }
    let mut app = App::start(&dir, Passkey::from_seed([5; 32]), false);
    let nothing = json!({ "meta": null, "open": false, "device": null });
    assert_eq!(app.call("status", json!([])).await, Ok(nothing), "nothing it opens");
    assert_eq!(app.call("open", json!([])).await, Err("this Mac holds no avenDB account yet".into()));
    let offer = server.offer().to_text();
    let device = app.call("found", json!(["Eve's Mac", url.to_string(), offer])).await.expect("her vault");
    assert_eq!(disk::generations(&dir).expect("its shelves"), [FLOOR, FLOOR + 1], "the shelf cut short put aside");
    let cut = std::fs::read(dir.join(format!("g{FLOOR}/journal/0000000000000001"))).expect("still there");
    assert_eq!(cut, b"cut short", "as it was");
    assert_eq!(objects(&dir, FLOOR + 1, "meta"), ["0000000000000001"], "what opens her device, on its own shelf");
    let status = app.call("status", json!([])).await.expect("its status");
    assert_eq!((&status["device"], &status["meta"]["name"]), (&device, &json!("Eve's Mac")));
    app.quit().await;
    for (name, _) in earlier {
        assert!(!dir.join(name).exists(), "{name} cleared");
    }
    let left: Vec<_> = std::fs::read_dir(&dir).expect("its folder").map(|e| e.expect("one").file_name()).collect();
    assert_eq!(left.len(), 2, "its two shelves alone: {left:?}");
    server.shutdown().await.expect("the server's node stops");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_mac_app_hosts_the_device_in_its_own_process_and_reads_a_file_from_its_node() {
    let (_relay, url, server) = server().await;
    let folder = Folder::new("hosted");
    let dir = folder.0.clone();
    let mut app = InApp::start(&dir, Passkey::from_seed([5; 32]));
    // nothing open yet: no node, and each call answers as its line would, with no id
    assert!(app.host.node().is_none(), "no node before the device opens");
    let nothing = json!({ "ok": { "meta": null, "open": false, "device": null } });
    assert_eq!(app.call("status", json!([])).await, nothing);
    assert_eq!(app.call("open", json!([])).await, json!({ "error": "this Mac holds no avenDB account yet" }));
    // she closes the first sheet, and the call says so
    app.cancel = true;
    let offer = server.offer().to_text();
    let found = app.call("found", json!(["Eve's Mac", url.to_string(), offer])).await;
    assert_eq!(found, json!({ "error": "You closed the sign-in sheet." }));
    assert_eq!(app.asked(), ["unlock"]);
    // she founds her vault in two sheets, each answered through the host; then its node is at hand, the device's own
    let device = app.call("found", json!(["Eve's Mac", url.to_string(), offer])).await["ok"].clone();
    assert_eq!(app.asked(), ["unlock", "found"]);
    let node = app.host.node().expect("its node, once open");
    assert_eq!(json!(hex(&node.device().0)), device["id"], "the device the call opened");
    // an op, and a change her vault's owners approve, in a sheet answered through the host too
    let vault = app.call("run", json!([{ "op": "world" }])).await["ok"]["ok"]["mine"].clone();
    let aven = app.call("run", json!([{ "op": "found", "kind": "aven", "name": "avenEVE" }])).await;
    assert_eq!(aven["ok"]["ok"]["vaults"].as_array().map(Vec::len), Some(1), "a new vault: {aven}");
    assert_eq!(app.asked(), ["approve"]);
    // a film, a chunk at a time in base64, as native.js hands it over
    let film: Vec<u8> = (0..300_000u32).map(|i| (i * 13 % 251) as u8).collect();
    let put = json!({ "op": "put_file", "vault": vault, "name": "Film.mp4", "media": "video/mp4", "tags": [],
        "len": film.len() });
    let n = app.call("fileStart", json!([put])).await["ok"].clone();
    loop {
        let mut at = 0;
        for chunk in film.chunks(100_000) {
            assert_eq!(app.call("fileChunk", json!([n, at, BASE64.encode(chunk)])).await, json!({ "ok": null }));
            at += chunk.len();
        }
        if app.call("fileAgain", json!([n])).await != json!({ "ok": true }) {
            break;
        }
    }
    let made = app.call("fileEnd", json!([n])).await["ok"]["ok"].clone();
    // its bytes read back by range from the node itself, with no JSON and no base64 between
    let root = FileRoot { hash: id(&made["root"]), size: made["size"].as_u64().expect("its sealed size") };
    assert_eq!(node.read_file(root, 1_000..250_000).await.expect("a range"), film[1_000..250_000]);
    assert_eq!(node.read_file(root, 0..film.len() as u64).await.expect("all of it"), film);
    assert!(node.jobs().to_json().is_object(), "its jobs at hand too");
    assert_eq!(app.call("nope", json!([])).await, json!({ "error": "no call \"nope\"" }));
    app.host.answer(&json!({ "sheet": 999, "back": "city.maia.studio://avendb#sealed=x" }));
    assert!(app.asked().is_empty(), "no other sheet");
    // the app closes it as it quits: the host holds no node, and its sheets end once it is gone
    app.host.close().await;
    assert!(app.host.node().is_none(), "no node once closed");
    drop(node);
    let InApp { host, mut sheets, .. } = app;
    drop(host);
    let ended = tokio::time::timeout(Duration::from_secs(60), sheets.recv()).await;
    assert_eq!(ended.expect("within 60 s"), None, "no line more");
    // hosted again, it opens from its folder in the unlock's sheet alone, the same device, and reads the film it kept
    let mut app = InApp::start(&dir, Passkey::from_seed([5; 32]));
    let opened = app.call("open", json!([])).await["ok"].clone();
    assert_eq!((&opened["id"], app.asked()), (&device["id"], vec!["unlock".to_string()]), "the same device");
    let node = app.host.node().expect("its node");
    assert_eq!(node.read_file(root, 0..10).await.expect("its first bytes"), film[..10], "kept on its shelf");
    drop(node);
    app.host.close().await;
    server.shutdown().await.expect("the server's node stops");
}

/// An agent harness, as an agent's own device sees it (`agent::serve`): MCP on its stdin and stdout.
struct Harness {
    to: Option<WriteHalf<DuplexStream>>,
    from: Lines<BufReader<ReadHalf<DuplexStream>>>,
    serving: JoinHandle<anyhow::Result<()>>,
    next: u64,
}

impl Harness {
    /// The harness `harness` starts its agent device beside the app's folder `host`.
    fn start(host: &Path, harness: &str) -> Harness {
        let (pipe, device) = tokio::io::duplex(1 << 20);
        let (input, output) = tokio::io::split(device);
        let (host, harness) = (host.to_path_buf(), harness.to_string());
        let serving = tokio::spawn(agent::serve(host, harness, input, output));
        let (from, to) = tokio::io::split(pipe);
        Harness { to: Some(to), from: BufReader::new(from).lines(), serving, next: 0 }
    }

    /// MCP request `method` with `params`: its result, or its error.
    async fn ask(&mut self, method: &str, params: Value) -> Result<Value, Value> {
        self.next += 1;
        let id = self.next;
        let line = format!("{}\n", json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        let to = self.to.as_mut().expect("the harness runs");
        to.write_all(line.as_bytes()).await.expect("the agent's stdin");
        let line = tokio::time::timeout(Duration::from_secs(60), self.from.next_line()).await;
        let line = line.expect("an answer within 60 s").expect("the agent's stdout").expect("a line");
        let answer: Value = serde_json::from_str(&line).expect("a line of JSON");
        assert_eq!(answer["id"], id, "the answer to the request: {answer}");
        answer.get("result").cloned().ok_or_else(|| answer["error"].clone())
    }

    /// Tool `name` with `args`: its text, and whether it is an error.
    async fn tool(&mut self, name: &str, args: Value) -> (String, bool) {
        let result = self.ask("tools/call", json!({ "name": name, "arguments": args })).await.expect("a result");
        let text = result["content"][0]["text"].as_str().expect("its text").to_string();
        (text, result["isError"] == true)
    }

    /// The harness quits: the agent's stdin ends, and its device stops.
    async fn quit(mut self) {
        let mut to = self.to.take().expect("the harness runs");
        to.shutdown().await.expect("the agent's stdin ends");
        let done = tokio::time::timeout(Duration::from_secs(60), &mut self.serving).await;
        done.expect("the agent stops within 60 s").expect("the agent's task").expect("the agent stops cleanly");
    }
}

/// The access requests on the page once there are `n`, as the device lists them (`agents`).
async fn requests(app: &mut App, n: usize) -> Value {
    let mut asked = Value::Null;
    for _ in 0..100 {
        asked = app.call("agents", json!([])).await.expect("the requests");
        if asked.as_array().is_some_and(|a| a.len() == n) {
            return asked;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("{n} requests, not {asked}");
}

/// The one request device `app` is asked (the ops engine's `requests`), once it is there, 60 seconds at most.
async fn asked_of(app: &mut App) -> Value {
    let end = Instant::now() + Duration::from_secs(60);
    loop {
        let open = run(app, json!({ "op": "requests" })).await.expect("its requests");
        if let [one] = &open["asked"].as_array().expect("those it is asked")[..] {
            return one.clone();
        }
        assert!(Instant::now() < end, "a request, within 60 s: {open}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// What harness `h` reads of entry `entry`, once it reads it: its text, and whether it is an error.
async fn reads(h: &mut Harness, entry: &Value) -> (String, bool) {
    let get = json!({ "op": { "op": "get", "entry": entry } });
    let mut read = (String::new(), true);
    for _ in 0..100 {
        read = h.tool("avendb_ask", get.clone()).await;
        if !read.1 && read.0.contains("\"ok\"") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    read
}

/// What harness `h` answers reading a file back (`avendb_read_file`) with `args`, once the file's entry reached it: its
/// text, and whether it is an error.
async fn reads_file(h: &mut Harness, args: Value) -> (String, bool) {
    let mut read = (String::new(), true);
    for _ in 0..100 {
        read = h.tool("avendb_read_file", args.clone()).await;
        if !read.0.ends_with("(NoEntry)") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    read
}

/// Vault `id` as device `app`'s world shows it, once `check` holds of it, 60 seconds at most.
async fn vault_shown(app: &mut App, id: &Value, what: &str, check: impl Fn(&Value) -> bool) -> Value {
    let end = Instant::now() + Duration::from_secs(60);
    loop {
        let world = world_of(app).await;
        let vaults = world["vaults"].as_array().expect("its vaults");
        if let Some(shown) = vaults.iter().find(|v| v["id"] == *id && check(v)) {
            return shown.clone();
        }
        assert!(Instant::now() < end, "{what}, within 60 s");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn harnesses_ask_for_access_and_join_her_one_aven_as_agents_that_read_and_edit_her_vault() {
    let (_relay, url, server) = server().await;
    // the app's folder and the agents' beside it, both in a folder of the test's own
    let folder = Folder::new("agent");
    let dir = folder.0.join("avendb");
    let mut app = App::start(&dir, Passkey::from_seed([5; 32]), true);
    app.call("found", json!(["Eve's Mac", url.to_string(), server.offer().to_text()])).await.expect("her vault");
    assert_eq!(app.asked(), ["unlock", "found"]);
    let mine = world_of(&mut app).await["mine"].clone();
    let seeds = titled("Seeds", "Tomatoes in March.");
    let note = run(&mut app, json!({ "op": "create", "vault": mine, "type": "note", "value": seeds })).await;
    let entry = note.expect("her note")["entry"].clone();
    assert_eq!(app.call("agents", json!([])).await, Ok(json!([])), "no agent on her Mac yet");
    // Claude Code starts its agent device, agentClaude, which asks for access: the page shows it, with no aven named
    let mut claude = Harness::start(&dir, agent::CLAUDE);
    let hello = claude.ask("initialize", json!({ "protocolVersion": "2025-06-18" })).await.expect("its hello");
    assert_eq!(hello["serverInfo"]["name"], "avendb");
    let tools = claude.ask("tools/list", json!({})).await.expect("its tools")["tools"].clone();
    let names: Vec<&str> = tools.as_array().expect("tools").iter().filter_map(|t| t["name"].as_str()).collect();
    let named = ["avendb_vaults", "avendb_ask", "avendb_request_access", "avendb_run", "avendb_add_spark"];
    assert_eq!(names, [&named[..], &["avendb_read_file"]].concat());
    let (waits, _) = claude.tool("avendb_vaults", json!({})).await;
    assert!(waits.contains("waiting for its person to answer"), "{waits}");
    let asked = requests(&mut app, 1).await;
    let device = asked[0]["device"].clone();
    assert_eq!((&asked[0]["name"], &asked[0]["level"]), (&json!("agentClaude"), &json!("Suggester")), "{asked}");
    assert!(asked[0].get("aven").is_none(), "a harness names no aven: {asked}");
    assert!(asked[0]["offer"].is_string(), "its offer, to join by");
    // the command that runs any harness's agent device, and for Claude Code the line that adds it
    let codex = app.call("agentCommand", json!(["codex"])).await.expect("its command");
    assert_eq!(codex["device"], "agentCodex");
    assert!(codex["command"].as_str().is_some_and(|l| l.contains(" agent codex --dir ")), "{codex}");
    assert!(codex["claude"].is_null(), "no Claude Code line for Codex");
    let line = app.call("agentCommand", json!([])).await.expect("Claude Code's");
    assert!(line["claude"].as_str().is_some_and(|l| l.starts_with("claude mcp add --scope user avendb -- ")));
    assert!(app.call("agentCommand", json!(["../x"])).await.is_err(), "no name of a folder elsewhere");
    // she says no: it is gone, and the agent is told
    app.call("deny", json!(["agentClaude", device])).await.expect("denied");
    assert_eq!(app.call("agents", json!([])).await, Ok(json!([])), "no request any more");
    tokio::time::sleep(Duration::from_secs(4)).await;
    assert_eq!(app.call("agents", json!([])).await, Ok(json!([])), "and it asks no more of its own accord");
    let (no, _) = claude.tool("avendb_vaults", json!({})).await;
    assert!(no.contains("said no"), "{no}");
    // it asks again, for more and saying why; a level it may not ask for is refused
    let (bad, error) = claude.tool("avendb_request_access", json!({ "level": "Owner", "why": "all of it" })).await;
    assert!(error && bad.contains("no level"), "{bad}");
    let why = "to sort the garden notes";
    let (ok, error) = claude.tool("avendb_request_access", json!({ "level": "Editor", "why": why })).await;
    assert!(!error, "{ok}");
    let asked = requests(&mut app, 1).await;
    assert_eq!((&asked[0]["level"], &asked[0]["why"]), (&json!("Editor"), &json!(why)), "{asked}");
    // never Owner; and with no aven yet, she names the one it founds: no sheet for either
    let shares = json!([{ "over": mine, "level": "Editor" }]);
    let owner = json!([{ "over": mine, "level": "Owner" }]);
    let refused = app.call("grant", json!(["agentClaude", device, owner, "avenEve"])).await;
    assert!(refused.is_err_and(|e| e.contains("isn't a level")), "never Owner");
    let unnamed = app.call("grant", json!(["agentClaude", device, shares])).await;
    assert!(unnamed.is_err_and(|e| e.contains("no aven yet")), "an aven to found is named");
    assert!(app.asked().is_empty(), "no sheet");
    // one sheet: her vault founds her aven avenEve and agentClaude's device vault under it, the agent's device in it;
    // her vault gives the aven Editor on it, and the aven passes that on to agentClaude
    let granted = app.call("grant", json!(["agentClaude", device, shares, "avenEve"])).await.expect("granted");
    let (aven, claudes) = (granted["aven"].clone(), granted["vault"].clone());
    assert_eq!(app.asked(), ["approve"], "one sheet");
    let world = world_of(&mut app).await;
    let vaults = world["vaults"].as_array().expect("vaults");
    let shown = |id: &Value| vaults.iter().find(|v| v["id"] == *id).cloned().expect("on her Mac");
    let (her_aven, agents) = (shown(&aven), shown(&claudes));
    assert_eq!((&her_aven["kind"], &her_aven["name"]), (&json!("aven"), &json!("avenEve")), "{her_aven}");
    assert_eq!((&her_aven["owners"], &her_aven["devices"]), (&json!([{ "vault": mine }]), &json!([])));
    assert_eq!((&agents["kind"], &agents["name"]), (&json!("device"), &json!("agentClaude")), "{agents}");
    assert_eq!(agents["owners"], json!([{ "vault": aven }]), "under her aven");
    assert_eq!(agents["devices"][0]["id"], device, "the agent's device its one device");
    let shares_of = |who: &Value| {
        let held = world["shares"].as_array().expect("shares").iter();
        held.filter(|c| c["who"] == *who && c["over"] == mine).cloned().collect::<Vec<_>>()
    };
    let (to_aven, to_agent) = (shares_of(&aven), shares_of(&claudes));
    assert_eq!((to_aven.len(), &to_aven[0]["issuer"], &to_aven[0]["group"]), (1, &mine, &json!("Editor")));
    assert_eq!((to_agent.len(), &to_agent[0]["issuer"], &to_agent[0]["group"]), (1, &aven, &json!("Editor")));
    assert_eq!(to_agent[0]["parent"], to_aven[0]["id"], "agentClaude's resting on the aven's");
    assert_eq!(app.call("agents", json!([])).await, Ok(json!([])), "none waits any more");
    // agentClaude acts as its device vault by its own key, under avenEve: it reads her note, and edits her vault
    let (me, _) = claude.tool("avendb_vaults", json!({})).await;
    let me: Value = serde_json::from_str(&me).expect("JSON");
    let who = (&me["me"]["device"], &me["me"]["vault"], &me["me"]["aven"]);
    assert_eq!(who, (&json!("agentClaude"), &claudes, &aven), "{me}");
    assert!(me["who"].as_str().is_some_and(|w| w.starts_with("agentClaude is an agent under the aven")), "{me}");
    let read = reads(&mut claude, &entry).await;
    assert!(!read.1 && read.0.contains("Tomatoes in March."), "agentClaude reads her note: {read:?}");
    let beans = json!({ "op": "create", "vault": mine, "type": "note", "value": titled("Beans", "In May.") });
    let beans = json!({ "op": beans });
    let (made, error) = claude.tool("avendb_run", beans).await;
    assert!(!error && made.contains("\"ok\""), "an Editor writes: {made}");
    // Codex starts its own agent device, added under the same aven in one more sheet, a device vault of its own; the
    // name she gives is for an aven to found, and she has one
    let mut codex = Harness::start(&dir, "codex");
    let asked = requests(&mut app, 1).await;
    assert_eq!(asked[0]["name"], "agentCodex", "{asked}");
    let viewer = json!([{ "over": mine, "level": "Viewer" }]);
    let joined = app.call("grant", json!(["agentCodex", asked[0]["device"], viewer, "avenOther"])).await;
    let joined = joined.expect("joined");
    assert_eq!(joined["aven"], aven, "the same aven");
    assert_ne!(joined["vault"], claudes, "a device vault of its own");
    assert_eq!(app.asked(), ["approve"], "one sheet");
    let world = world_of(&mut app).await;
    let vaults = world["vaults"].as_array().expect("vaults");
    let avens: Vec<&Value> = vaults.iter().filter(|v| v["kind"] == "aven").collect();
    assert_eq!((avens.len(), &avens[0]["name"]), (1, &json!("avenEve")), "her one aven, named as it was");
    let codexs = vaults.iter().find(|v| v["id"] == joined["vault"]).expect("agentCodex's vault");
    assert_eq!((&codexs["name"], &codexs["owners"]), (&json!("agentCodex"), &json!([{ "vault": aven }])));
    let read = reads(&mut codex, &entry).await;
    assert!(!read.1 && read.0.contains("Tomatoes in March."), "agentCodex reads her note too: {read:?}");
    let beans = json!({ "op": { "op": "create", "vault": mine, "type": "note", "value": titled("Peas", "In June.") } });
    let (no, _) = codex.tool("avendb_run", beans).await;
    assert!(no.contains("\"refused\""), "a Viewer writes nothing, whatever the aven holds: {no}");
    let (no, error) = claude.tool("avendb_run", json!({ "op": { "op": "world" } })).await;
    assert!(error && no.contains("only reads"), "{no}");
    let put = json!({ "op": { "op": "put_file", "vault": mine, "name": "a.txt", "len": 1 } });
    let (no, error) = claude.tool("avendb_run", put).await;
    assert!(error && no.contains("absolute path"), "a file to save is named by its path: {no}");
    let (no, error) = claude.tool("avendb_run", json!({ "op": { "op": "set_limits", "depth": 4 } })).await;
    assert!(error && no.contains("isn't for an agent"), "a device's own setting, which an agent keeps nowhere: {no}");
    codex.quit().await;
    claude.quit().await;
    app.quit().await;
    server.shutdown().await.expect("the server's node stops");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_same_harness_on_her_other_mac_joins_its_agents_device_vault_under_her_aven() {
    let (_relay, url, server) = server().await;
    let folder = Folder::new("agent-macs");
    let (dir, other_dir) = (folder.0.join("avendb"), folder.0.join("avendb-b"));
    let mut app = App::start(&dir, Passkey::from_seed([5; 32]), true);
    let mac = app.call("found", json!(["Eve's Mac", url.to_string(), server.offer().to_text()])).await;
    let mac = mac.expect("her vault");
    let mine = world_of(&mut app).await["mine"].clone();
    let seeds = titled("Seeds", "Tomatoes in March.");
    let note = run(&mut app, json!({ "op": "create", "vault": mine, "type": "note", "value": seeds })).await;
    let entry = note.expect("her note")["entry"].clone();
    let mut claude = Harness::start(&dir, agent::CLAUDE);
    let asked = requests(&mut app, 1).await;
    let (first, viewer) = (asked[0]["device"].clone(), json!([{ "over": mine, "level": "Viewer" }]));
    let granted = app.call("grant", json!(["agentClaude", first, viewer, "avenEve"])).await;
    let granted = granted.expect("granted");
    let (aven, claudes) = (granted["aven"].clone(), granted["vault"].clone());
    assert_eq!(app.asked(), ["unlock", "found", "approve"]);
    // her other Mac, linked through this one, holds her aven and agentClaude's device vault
    let mut other = App::start(&other_dir, Passkey::from_seed([5; 32]), true);
    other.call("link", json!(["Eve's other Mac", url.to_string(), mac["offer"]])).await.expect("linked");
    assert_eq!(other.asked(), ["unlock"]);
    vault_shown(&mut other, &claudes, "agentClaude's device vault, named", |v| v["name"] == "agentClaude").await;
    let passed = |world: &Value| {
        let shares = world["shares"].as_array().expect("shares").iter();
        shares.filter(|c| c["who"] == claudes && c["over"] == mine && c["issuer"] == aven).count()
    };
    let end = Instant::now() + Duration::from_secs(60);
    while passed(&world_of(&mut other).await) == 0 {
        assert!(Instant::now() < end, "the share her aven passed on to agentClaude, there within 60 s");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    // Claude Code there starts agentClaude's device on that Mac, another device of the same agent: one sheet adds it
    // to the agent's device vault, which her aven passes the same share on to again, and founds nothing
    let mut there = Harness::start(&other_dir, agent::CLAUDE);
    let asked = requests(&mut other, 1).await;
    let (second, viewer) = (asked[0]["device"].clone(), json!([{ "over": mine, "level": "Viewer" }]));
    assert_ne!(second, first, "a device of its own");
    let joined = other.call("grant", json!(["agentClaude", second, viewer, "avenEve"])).await.expect("joined");
    assert_eq!((&joined["aven"], &joined["vault"]), (&aven, &claudes), "the same agent under the same aven");
    assert_eq!(other.asked(), ["approve"], "one sheet");
    let both = |v: &Value| v["devices"].as_array().is_some_and(|d| d.len() == 2);
    let agents = vault_shown(&mut other, &claudes, "agentClaude's two devices", both).await;
    assert!(agents["devices"].as_array().expect("devices").iter().any(|d| d["id"] == second));
    let world = world_of(&mut other).await;
    let avens = world["vaults"].as_array().expect("vaults").iter().filter(|v| v["kind"] == "aven").count();
    assert_eq!(avens, 1, "her one aven");
    assert_eq!(passed(&world), 1, "the Viewer's share its aven passed on before stands for it");
    let read = reads(&mut there, &entry).await;
    assert!(!read.1 && read.0.contains("Tomatoes in March."), "agentClaude reads her note on her other Mac: {read:?}");
    // agentClaude on her first Mac asks for more: its device is in its vault already, so it asks as anyone does, a
    // request its vault writes and shares with her aven, and leaves no file; granting it takes no sheet
    let why = "to tidy the seed notes";
    let (ok, error) = claude.tool("avendb_request_access", json!({ "level": "Editor", "why": why })).await;
    assert!(!error, "{ok}");
    let record = asked_of(&mut app).await;
    assert_eq!((&record["from"], &record["to"], &record["level"]), (&claudes, &aven, &json!("Editor")), "{record}");
    assert_eq!(record["why"], why);
    assert_eq!(app.call("agents", json!([])).await, Ok(json!([])), "no file");
    let editor = json!([{ "over": mine, "level": "Editor" }]);
    let more = app.call("grant", json!(["agentClaude", first, editor, "avenEve"])).await.expect("granted");
    assert_eq!((&more["aven"], &more["vault"]), (&aven, &claudes));
    assert!(app.asked().is_empty(), "no sheet");
    let answer = json!({ "op": "set", "entry": record["entry"], "path": ["answer"], "value": "granted", "as": aven });
    run(&mut app, answer).await.expect("her aven answers it");
    let open = run(&mut app, json!({ "op": "requests" })).await.expect("her requests");
    assert_eq!(open["asked"], json!([]), "answered");
    let beans = json!({ "op": { "op": "create", "vault": mine, "type": "note", "value": titled("Beans", "In May.") } });
    let mut made = (String::new(), true);
    for _ in 0..100 {
        made = claude.tool("avendb_run", beans.clone()).await;
        if !made.1 && made.0.contains("\"ok\"") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(!made.1 && made.0.contains("\"ok\""), "an Editor once its share reaches it: {made:?}");
    there.quit().await;
    claude.quit().await;
    other.quit().await;
    app.quit().await;
    server.shutdown().await.expect("the server's node stops");
}

/// The share `share`, as device `me`'s view has it: whether it is live.
fn live(w: &World, me: SignerId, share: ShareId) -> bool {
    w.lab.state(me).live(share)
}

#[test]
fn her_aven_passes_on_no_more_than_a_coop_that_hired_it_gave_and_the_coop_taking_it_back_ends_its_agents() {
    let mut w = world();
    let (alice, mac, passkey, bob, bob_mac, bob_key) = (w.alice, w.mac_a, w.passkey_a, w.bob, w.mac_b, w.passkey_b);
    // Alice's aven and agentClaude's device vault under it, its device in it, as her Mac's grant makes them
    let found = |lab: &mut Lab, kind: Kind, owner: VaultId, nonce: u64| {
        let owners = vec![Principal::Vault(owner)];
        let genesis = Action::Genesis { kind, owners, threshold: 1, root: None, nonce, seal_to: vec![] };
        VaultId::from(lab.submit(mac, &[passkey], genesis).expect("her passkey founds it"))
    };
    let aven = found(&mut w.lab, Kind::Aven, alice, 1);
    let claudes = found(&mut w.lab, Kind::DeviceVault, aven, 2);
    let claude = w.lab.device("agentClaude");
    let add = Action::Share(Sharing::Device { vault: claudes, device: claude, seal_to: None });
    w.lab.submit(mac, &[passkey, claude], add).expect("its device");
    assert_eq!(agent::aven_of(w.lab.state(mac), alice), Some(aven), "her one aven");
    // Bob's coop, his alone, hires her aven, which his Mac knows by its card: a Viewer share on the whole of it
    w.lab.share_contact(mac, bob_mac, aven);
    let owners = vec![Principal::Vault(bob)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 1, root: None, nonce: 3, seal_to: vec![] };
    let coop = VaultId::from(w.lab.submit(bob_mac, &[bob_key], genesis).expect("Bob's coop"));
    let hired = w.lab.issue(bob_mac, &[bob_mac], share(coop, vault(aven), Level::Read, Selector::All));
    let hired = hired.expect("the coop hires her aven");
    w.lab.sync_all(12);
    // her aven passes on nothing above its own there, refused before any sheet; a Viewer's it passes on
    let st = w.lab.state(mac);
    let above = agent::passable(st, alice, Some(aven), coop, "Editor");
    assert!(above.is_err_and(|e| e.to_string().contains("holds no share")), "no Editor of the coop's");
    assert!(agent::passable(st, alice, Some(aven), coop, "Viewer").is_ok());
    assert!(agent::passable(st, alice, None, coop, "Viewer").is_err(), "an aven still to found holds nothing");
    assert!(agent::passable(st, alice, None, alice, "Editor").is_ok(), "her own vault gives it what it lacks");
    let refused = agent::pass_on(&mut w.lab, mac, alice, aven, claudes, coop, "Editor");
    assert!(refused.is_err(), "nor passes it on after a sheet");
    let sub = agent::pass_on(&mut w.lab, mac, alice, aven, claudes, coop, "Viewer").expect("a Viewer's");
    let rests = w.lab.state(mac).share(sub).map(|cp| (cp.share.parent, cp.share.issuer, cp.share.who));
    assert_eq!(rests, Some((Some(hired), aven, vault(claudes))), "on the coop's share, issued by the aven");
    // over her own vault, her vault gives the aven its share first, and the aven passes it on
    let own = agent::pass_on(&mut w.lab, mac, alice, aven, claudes, alice, "Editor").expect("over her vault");
    let parent = w.lab.state(mac).share(own).and_then(|cp| cp.share.parent).expect("on the aven's share");
    let given = w.lab.state(mac).share(parent).map(|cp| (cp.share.issuer, cp.share.who, cp.share.level));
    assert_eq!(given, Some((alice, vault(aven), Level::Write)), "her vault's Editor share to her aven");
    w.lab.sync_all(12);
    assert!(live(&w, claude, sub) && live(&w, claude, own), "agentClaude holds both");
    // Bob's coop takes its share back from her aven: agentClaude's ends with it, and not the other
    let revoke = Action::Revoke(Revoking::Grant { share: hired, actor: coop, keep: vec![], via: vec![] });
    w.lab.submit(bob_mac, &[bob_mac], revoke).expect("the coop revokes the aven's share");
    w.lab.sync_all(12);
    assert!(!live(&w, claude, hired) && !live(&w, claude, sub), "the agent's ends with the aven's");
    assert!(live(&w, mac, own), "and its share over her vault stays");
}

/// Whether `holders`, an entry's or a file's `syncedTo`, has `device` holding any of it.
fn holds_some(holders: &Value, device: &Value) -> bool {
    holders.as_array().into_iter().flatten().any(|h| h["device"] == *device)
}

/// The bytes `from..to` of file `root` of `size` sealed bytes, as the device reads them (`read_file`).
async fn read_back(app: &mut App, root: &Value, size: &Value, from: usize, to: usize) -> Vec<u8> {
    let read = json!({ "op": "read_file", "root": root, "size": size, "from": from, "to": to });
    let answer = app.call("run", json!([read])).await.expect("an answer");
    BASE64.decode(answer["bytes"].as_str().expect("its bytes").as_bytes()).expect("base64")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_agent_saves_a_file_of_her_mac_as_its_share_allows_and_her_mac_keeps_the_one_copy() {
    let (_relay, url, server) = server().await;
    let folder = Folder::new("agent-files");
    let dir = folder.0.join("avendb");
    let mut app = App::start(&dir, Passkey::from_seed([5; 32]), true);
    let mac = app.call("found", json!(["Eve's Mac", url.to_string(), server.offer().to_text()])).await;
    let mac = mac.expect("her vault")["id"].clone();
    assert_eq!(app.asked(), ["unlock", "found"]);
    let mine = world_of(&mut app).await["mine"].clone();
    // her Mac keeps a light copy, for now: every entry, and a file only as it is read
    let light = run(&mut app, json!({ "op": "copy", "full": false })).await;
    assert!(light.expect("a light copy")["share"].is_string());
    let seeds = titled("Seeds", "Tomatoes in March.");
    let note = run(&mut app, json!({ "op": "create", "vault": mine, "type": "note", "value": seeds })).await;
    let note = note.expect("her note")["entry"].clone();
    // agentClaude tells its harness how to save a file, and joins under her aven avenEve, which may edit her vault
    let mut claude = Harness::start(&dir, agent::CLAUDE);
    let hello = claude.ask("initialize", json!({ "protocolVersion": "2025-06-18" })).await.expect("its hello");
    let told = hello["instructions"].as_str().is_some_and(|i| i.contains("`put_file`") && i.contains("`path`"));
    assert!(told, "{hello}");
    let tools = claude.ask("tools/list", json!({})).await.expect("its tools")["tools"].clone();
    let change = tools.as_array().expect("tools").iter().find(|t| t["name"] == "avendb_run").cloned();
    assert_eq!(change.expect("avendb_run")["inputSchema"]["properties"]["path"]["type"], "string");
    let asked = requests(&mut app, 1).await;
    let claude_device = asked[0]["device"].clone();
    let editor = json!([{ "over": mine, "level": "Editor" }]);
    app.call("grant", json!(["agentClaude", claude_device, editor, "avenEve"])).await.expect("granted");
    assert_eq!(app.asked(), ["approve"], "one sheet");
    let read = reads(&mut claude, &note).await;
    assert!(!read.1 && read.0.contains("Tomatoes in March."), "agentClaude reads her note: {read:?}");
    // it names a file of her Mac by its absolute path, beside a put_file alone
    let harvest: Vec<u8> = (0..150_000u32).map(|i| (i * 11 % 241) as u8).collect();
    let path = folder.0.join("Harvest.csv");
    std::fs::write(&path, &harvest).expect("a file on her Mac");
    let at = |p: &Path| json!(p.to_string_lossy());
    let op = json!({ "op": "put_file", "vault": mine, "name": "Harvest.csv", "media": "text/csv", "tags": [] });
    let wrong = [
        (json!("Harvest.csv"), "isn't an absolute path"),
        (at(&folder.0.join("Nowhere.csv")), "no file at"),
        (at(&folder.0), "is no file"),
    ];
    for (bad, why) in wrong {
        let (no, error) = claude.tool("avendb_run", json!({ "op": op, "path": bad })).await;
        assert!(error && no.contains(why), "{no}");
    }
    let create = json!({ "op": "create", "vault": mine, "type": "note", "value": titled("Beans", "In May.") });
    let (no, error) = claude.tool("avendb_run", json!({ "op": create, "path": at(&path) })).await;
    assert!(error && no.contains("beside put_file or get_file alone"), "{no}");
    // and saves it into her vault, as an Editor creates an entry: its length the file's size, sealed onto its own shelf
    let (made, error) = claude.tool("avendb_run", json!({ "op": op, "path": at(&path) })).await;
    assert!(!error && made.contains("\"ok\""), "an Editor saves a file: {made}");
    let made: Value = serde_json::from_str(&made).expect("JSON");
    let (file, root, size) = (made["ok"]["entry"].clone(), made["ok"]["root"].clone(), made["ok"]["size"].clone());
    let (claudes, blob) = (agent::folder(&dir, "agentClaude"), root.as_str().expect("its root in hex").to_string());
    assert!(objects(&claudes, FLOOR, "blobs").contains(&blob), "in agentClaude's folder");
    // it reads the file back by its entry (`avendb_read_file`), every byte, from its own shelf to a new path on her Mac
    let back = folder.0.join("Harvest back.csv");
    let (read, error) = claude.tool("avendb_read_file", json!({ "entry": file, "path": at(&back) })).await;
    assert!(!error, "{read}");
    let read: Value = serde_json::from_str(&read).expect("JSON");
    let said = (&read["entry"], &read["name"], &read["media"], &read["len"], &read["path"]);
    assert_eq!(said, (&file, &json!("Harvest.csv"), &json!("text/csv"), &json!(harvest.len()), &at(&back)));
    assert!(read.get("text").is_none(), "nothing inline past 64 KiB: {read}");
    assert_eq!(std::fs::read(&back).expect("read back"), harvest, "every byte");
    // never over a file there, unless it says so, as a get_file op on avendb_run by the file's vault and name does
    std::fs::write(&back, b"hers").expect("a file of hers");
    let (no, error) = claude.tool("avendb_read_file", json!({ "entry": file, "path": at(&back) })).await;
    assert!(error && no.contains("overwrite: true"), "{no}");
    assert_eq!(std::fs::read(&back).expect("her file"), b"hers", "hers, as it was");
    let get = json!({ "op": "get_file", "vault": mine, "name": "Harvest.csv" });
    let (done, error) = claude.tool("avendb_run", json!({ "op": get, "path": at(&back), "overwrite": true })).await;
    assert!(!error && done.contains("\"ok\""), "{done}");
    assert_eq!(std::fs::read(&back).expect("read back"), harvest, "over hers, as it said");
    let (no, error) = claude.tool("avendb_read_file", json!({ "entry": file })).await;
    assert!(error && no.contains("give an absolute path"), "a file past 64 KiB comes back to a path: {no}");
    let raw = json!({ "op": { "op": "read_file", "root": root, "size": size } });
    let (no, error) = claude.tool("avendb_ask", raw).await;
    assert!(error && no.contains("avendb_read_file"), "{no}");
    let (no, error) = claude.tool("avendb_run", json!({ "op": create, "overwrite": true })).await;
    assert!(error && no.contains("beside get_file alone"), "{no}");
    // a small text file comes back inline, with no path
    let notes = folder.0.join("Seeds.md");
    std::fs::write(&notes, "# Seeds\n\nTomatoes in March.\n").expect("her notes");
    let put = json!({ "op": "put_file", "vault": mine, "name": "Seeds.md", "media": "text/markdown" });
    let (made, error) = claude.tool("avendb_run", json!({ "op": put, "path": at(&notes) })).await;
    assert!(!error && made.contains("\"ok\""), "{made}");
    let (read, error) = claude.tool("avendb_read_file", json!({ "vault": mine, "name": "Seeds.md" })).await;
    assert!(!error, "{read}");
    let read: Value = serde_json::from_str(&read).expect("JSON");
    assert_eq!((&read["text"], &read["path"]), (&json!("# Seeds\n\nTomatoes in March.\n"), &Value::Null), "{read}");
    // and nothing it wrote beside the paths stays
    let left = std::fs::read_dir(&folder.0).expect("her folder").map(|e| e.expect("one").file_name());
    let left: Vec<String> = left.map(|n| n.to_string_lossy().into_owned()).collect();
    assert!(!left.iter().any(|n| n.contains(".avendb-")), "{left:?}");
    // her Mac shows it and reads it back, fetched from agentClaude
    let shown_file = shown(&mut app, &file, "the agent's file in her vault", |f| f["kind"] == "file").await;
    assert_eq!((&shown_file["title"], &shown_file["files"][0]["len"]), (&json!("Harvest.csv"), &json!(harvest.len())));
    assert_eq!(read_back(&mut app, &root, &size, 0, harvest.len()).await, harvest, "every byte");
    // while her Mac keeps it light, agentClaude keeps its copy: the one on her Mac
    tokio::time::sleep(agent::LOOK * 2).await;
    assert!(objects(&claudes, FLOOR, "blobs").contains(&blob), "still in agentClaude's folder");
    // with a full copy her Mac keeps it whole, and agentClaude lets go of its own: the one copy is her Mac's
    let full = run(&mut app, json!({ "op": "copy", "full": true })).await;
    assert!(full.expect("a full copy")["share"].is_string());
    let alone = |f: &Value| {
        let holders = &f["files"][0]["syncedTo"];
        holds_all(holders, &mac, true) && !holds_some(holders, &claude_device)
    };
    shown(&mut app, &file, "the file whole on her Mac, and on agentClaude no more", alone).await;
    until("agentClaude's folder holds none of it", || async { !objects(&claudes, FLOOR, "blobs").contains(&blob) })
        .await;
    assert_eq!(read_back(&mut app, &root, &size, 100, 200).await, harvest[100..200], "her Mac reads it still");
    // and agentClaude reads it back still, fetched from her Mac's one store
    let again = folder.0.join("Harvest again.csv");
    let (read, error) = claude.tool("avendb_read_file", json!({ "entry": file, "path": at(&again) })).await;
    assert!(!error, "{read}");
    assert_eq!(std::fs::read(&again).expect("read again"), harvest, "every byte, from her Mac");
    // agentCursor joins under the same aven, which passes on to it only a Suggester's share of her vault: a Suggester
    // creates no entry, whatever the aven holds, so it saves no file there, refused before it reads a byte, and a
    // put_file has no proposal's line to go on
    let mut cursor = Harness::start(&dir, "cursor");
    let asked = requests(&mut app, 1).await;
    assert_eq!(asked[0]["name"], "agentCursor", "{asked}");
    let suggester = json!([{ "over": mine, "level": "Suggester" }]);
    let scout = json!(["agentCursor", asked[0]["device"], suggester, "avenEve"]);
    app.call("grant", scout).await.expect("granted");
    assert_eq!(app.asked(), ["approve"], "one sheet");
    let read = reads(&mut cursor, &note).await;
    assert!(!read.1 && read.0.contains("Tomatoes in March."), "agentCursor reads her note: {read:?}");
    // it reads her files back as it reads her notes
    let cursors = folder.0.join("Harvest for Cursor.csv");
    let read = reads_file(&mut cursor, json!({ "entry": file, "path": at(&cursors) })).await;
    assert!(!read.1, "a Suggester reads her file: {read:?}");
    assert_eq!(std::fs::read(&cursors).expect("read back"), harvest, "every byte");
    let (no, error) = cursor.tool("avendb_run", json!({ "op": op, "path": at(&path) })).await;
    let no: Value = serde_json::from_str(&no).expect("JSON");
    assert!(!error && no["refused"] == "NotAllowed", "a Suggester's ops create no entry: {no}");
    let (jobs, _) = cursor.tool("avendb_ask", json!({ "op": { "op": "jobs" } })).await;
    let jobs: Value = serde_json::from_str(&jobs).expect("JSON");
    let mut all = ["running", "ended"].into_iter().flat_map(|k| jobs["ok"][k].as_array().cloned().unwrap_or_default());
    assert!(!all.any(|j| j["kind"] == "bring"), "refused before it read a byte: {jobs}");
    let mut on_line = op.clone();
    on_line["line"] = json!("a proposal");
    let (no, error) = cursor.tool("avendb_run", json!({ "op": on_line, "path": at(&path) })).await;
    let no: Value = serde_json::from_str(&no).expect("JSON");
    assert!(!error && no["why"] == "put_file takes no field \"line\"", "{no}");
    // a file of a vault no share of agentClaude's reaches, her studio's, it reads by neither its entry nor its name,
    // and writes nothing
    let studio = run(&mut app, json!({ "op": "found", "kind": "coop", "name": "Studio" })).await;
    let studio = studio.expect("her studio")["vaults"][0].clone();
    assert_eq!(app.asked(), ["approve"], "one sheet");
    let plan: Vec<u8> = (0..20_000u32).map(|i| (i * 17 % 239) as u8).collect();
    let put = json!({ "op": "put_file", "vault": studio, "name": "Plan.jpg", "len": plan.len(), "as": studio });
    let plan = bring(&mut app, put, &plan).await;
    let plan = plan["ok"]["entry"].as_str().map(Value::from).unwrap_or_else(|| panic!("her studio's plan: {plan}"));
    shown(&mut app, &plan, "her studio's plan", |f| f["kind"] == "file").await;
    let nowhere = folder.0.join("Plan.jpg");
    let (no, error) = claude.tool("avendb_read_file", json!({ "entry": plan, "path": at(&nowhere) })).await;
    assert!(error && no.contains("agentClaude reads no entry") && no.ends_with("(NoEntry)"), "{no}");
    let by_name = json!({ "vault": studio, "name": "Plan.jpg", "path": at(&nowhere) });
    let (no, error) = claude.tool("avendb_read_file", by_name).await;
    assert!(error && no.contains("reads no file named \"Plan.jpg\""), "{no}");
    assert!(!nowhere.exists(), "nothing written");
    cursor.quit().await;
    claude.quit().await;
    app.quit().await;
    server.shutdown().await.expect("the server's node stops");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_agent_adds_a_spark_to_her_own_vault_and_her_mac_reads_it() {
    let (_relay, url, server) = server().await;
    let folder = Folder::new("agent-sparks");
    let dir = folder.0.join("avendb");
    let mut app = App::start(&dir, Passkey::from_seed([5; 32]), true);
    app.call("found", json!(["Eve's Mac", url.to_string(), server.offer().to_text()])).await.expect("her vault");
    assert_eq!(app.asked(), ["unlock", "found"]);
    let mine = world_of(&mut app).await["mine"].clone();
    // agentClaude tells its harness how to add a spark, by its fields' plain names
    let mut claude = Harness::start(&dir, agent::CLAUDE);
    let hello = claude.ask("initialize", json!({ "protocolVersion": "2025-06-18" })).await.expect("its hello");
    let told = hello["instructions"].as_str().is_some_and(|i| i.contains("avendb_add_spark") && i.contains("`text`"));
    assert!(told, "{hello}");
    let tools = claude.ask("tools/list", json!({})).await.expect("its tools")["tools"].clone();
    let spark = tools.as_array().expect("tools").iter().find(|t| t["name"] == "avendb_add_spark").cloned();
    let schema = spark.expect("avendb_add_spark")["inputSchema"].clone();
    assert_eq!(schema["required"], json!(["text"]));
    let fields: Vec<&String> = schema["properties"].as_object().expect("its fields").keys().collect();
    assert_eq!(fields, ["tags", "text", "title", "vault"], "a spark's own fields, kind, title and blocks, and where");
    assert!(spark_tool_says_artifacts(&tools), "links and media go in as artifacts");
    let (waits, error) = claude.tool("avendb_add_spark", json!({ "text": "Too soon." })).await;
    assert!(!error && waits.contains("waiting for its person to answer"), "{waits}");
    // she adds it under her aven avenEve, which may edit her vault
    let asked = requests(&mut app, 1).await;
    let editor = json!([{ "over": mine, "level": "Editor" }]);
    let granted = app.call("grant", json!(["agentClaude", asked[0]["device"], editor, "avenEve"])).await;
    let aven = granted.expect("granted")["aven"].clone();
    assert_eq!(app.asked(), ["approve"], "one sheet");
    // a thought, as the page captures one: no vault named, so into her own, once its share reaches it; its one line
    // its title
    let thought = json!({ "text": "Tomatoes like the warm wall.", "tags": ["garden"] });
    let mut made = (String::new(), true);
    for _ in 0..100 {
        made = claude.tool("avendb_add_spark", thought.clone()).await;
        if !made.0.contains("waiting for its person") && !made.0.contains("may add no spark") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(!made.1, "{made:?}");
    let made: Value = serde_json::from_str(&made.0).expect("JSON");
    assert_eq!((&made["vault"], &made["tags"]), (&mine, &json!(["garden"])), "{made}");
    let thought = |s: &Value| s["type"] == "spark" && s["title"] == "Tomatoes like the warm wall.";
    let shown_spark = shown(&mut app, &made["entry"], "agentClaude's spark on her Mac", thought).await;
    assert_eq!(shown_spark["tags"], json!(["garden"]));
    assert_eq!(shown_spark["text"], "", "its words all its title");
    // one titled, its words beside
    let words = "Sow them under glass in March, and plant them out once the nights stay warm.";
    let (made, error) = claude.tool("avendb_add_spark", json!({ "text": words, "title": "Sowing tomatoes" })).await;
    assert!(!error, "{made}");
    let entry = serde_json::from_str::<Value>(&made).expect("JSON")["entry"].clone();
    let sowing = shown(&mut app, &entry, "the titled one, on her Mac", |s| s["title"] == "Sowing tomatoes").await;
    assert_eq!((&sowing["text"], &sowing["record"]["blocks"][0]["text"]), (&json!(words), &json!("Sowing tomatoes")));
    // a longer one, titled by its first line cut at a word
    let long = "Grow a wall of tomatoes along the south side of the shed, where the old bricks hold the warmth of the \
                day well into the night.\nPinch out the side shoots.";
    let (made, error) = claude.tool("avendb_add_spark", json!({ "text": long })).await;
    assert!(!error, "{made}");
    let entry = serde_json::from_str::<Value>(&made).expect("JSON")["entry"].clone();
    let title = "Grow a wall of tomatoes along the south side of the shed, where the old bricks…";
    let wall = shown(&mut app, &entry, "the long one, on her Mac", |s| s["title"] == title).await;
    assert_eq!(wall["text"], long);
    // its refusals read plainly: her aven shares nothing with it; a link goes in as an artifact, not on a spark
    let (no, error) = claude.tool("avendb_add_spark", json!({ "text": "x", "vault": aven })).await;
    let mine_id = mine.as_str().expect("her vault's id");
    let may = format!("may add sparks to {mine_id}");
    assert!(error && no.starts_with("agentClaude may add no spark to vault") && no.contains(&may), "{no}");
    let (no, error) = claude.tool("avendb_add_spark", json!({ "text": "x", "url": "https://example.com/sow" })).await;
    assert!(error && no.starts_with("a spark has no \"url\"") && no.contains("as an artifact"), "{no}");
    let (no, error) = claude.tool("avendb_add_spark", json!({ "title": "No words" })).await;
    assert!(error && no.contains("text"), "{no}");
    // agentCodex, a Viewer of her vault, may add a spark nowhere, and says so
    let mut codex = Harness::start(&dir, "codex");
    let asked = requests(&mut app, 1).await;
    let viewer = json!([{ "over": mine, "level": "Viewer" }]);
    app.call("grant", json!(["agentCodex", asked[0]["device"], viewer, "avenEve"])).await.expect("granted");
    assert_eq!(app.asked(), ["approve"], "one sheet");
    let read = reads(&mut codex, &entry).await;
    assert!(!read.1 && read.0.contains("Pinch out the side shoots."), "agentCodex reads her spark: {read:?}");
    let (no, error) = codex.tool("avendb_add_spark", json!({ "text": "Beans in May." })).await;
    let own = format!("may add no spark to its person's own vault, {mine_id}");
    assert!(error && no.contains(&own) && no.contains("avendb_request_access"), "{no}");
    codex.quit().await;
    claude.quit().await;
    app.quit().await;
    server.shutdown().await.expect("the server's node stops");
}

/// Whether the description of `avendb_add_spark` among `tools` says a link or a media file goes in as an artifact.
fn spark_tool_says_artifacts(tools: &Value) -> bool {
    let spark = tools.as_array().into_iter().flatten().find(|t| t["name"] == "avendb_add_spark");
    spark.and_then(|t| t["description"].as_str()).is_some_and(|d| d.contains("goes in as an artifact"))
}

/// What the Mac's device says of its volumes and drives (`drives`), once `check` holds of it, 60 seconds at most.
async fn drives(app: &mut App, what: &str, check: impl Fn(&Value) -> bool) -> Value {
    let end = Instant::now() + Duration::from_secs(60);
    loop {
        let drives = app.call("drives", json!([])).await.expect("its drives");
        if check(&drives) {
            return drives;
        }
        assert!(Instant::now() < end, "{what}, within 60 s: {drives}");
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// Device `device` of vault `vault` as the device's world shows it, if it is one, once `check` holds of that, 60
/// seconds at most.
async fn device_shown(app: &mut App, vault: &Value, device: &Value, what: &str, check: impl Fn(Option<&Value>) -> bool) {
    let end = Instant::now() + Duration::from_secs(60);
    loop {
        let world = world_of(app).await;
        let v = world["vaults"].as_array().expect("its vaults").iter().find(|v| v["id"] == *vault).cloned();
        let shown = v.and_then(|v| v["devices"].as_array()?.iter().find(|d| d["id"] == *device).cloned());
        if check(shown.as_ref()) {
            return;
        }
        assert!(Instant::now() < end, "{what}, within 60 s: {shown:?}");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// Whether `holders`, an entry's or a file's `syncedTo`, has `device` holding all of it: on a live connection
/// (`checked` null) if `live`, else as the statement it signed says.
fn holds_all(holders: &Value, device: &Value, live: bool) -> bool {
    let all = |h: &Value| h["device"] == *device && h["has"] == h["of"] && h["checked"].is_null() == live;
    holders.as_array().into_iter().flatten().any(all)
}

/// Every file in folder `dir` and the folders in it, with its bytes.
fn files_in(dir: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    let mut out = vec![];
    for entry in std::fs::read_dir(dir).expect("a folder").flatten() {
        let (path, kind) = (entry.path(), entry.file_type().expect("its type"));
        if kind.is_dir() {
            out.extend(files_in(&path));
        } else if kind.is_file() {
            let bytes = std::fs::read(&path).expect("its bytes");
            out.push((path, bytes));
        }
    }
    out
}

/// A file named `name` into vault `vault`, a chunk at a time in base64, as native.js hands one over: what it made.
async fn put_file(app: &mut App, vault: &Value, name: &str, bytes: &[u8]) -> Value {
    let put = json!({ "op": "put_file", "vault": vault, "name": name, "media": "image/jpeg", "tags": [],
        "len": bytes.len() });
    bring(app, put, bytes).await["ok"].clone()
}

/// Put_file op `put` with the file's `bytes`, a chunk at a time in base64, as native.js hands one over: its answer.
async fn bring(app: &mut App, put: Value, bytes: &[u8]) -> Value {
    let n = app.call("fileStart", json!([put])).await.expect("a file's number");
    loop {
        let mut at = 0;
        for chunk in bytes.chunks(40_000) {
            app.call("fileChunk", json!([n, at, BASE64.encode(chunk)])).await.expect("a chunk");
            at += chunk.len();
        }
        if app.call("fileAgain", json!([n])).await != Ok(json!(true)) {
            break;
        }
    }
    app.call("fileEnd", json!([n])).await.expect("the op's answer")
}

/// The files in folder `dir` this process holds open, as Linux names them in /proc/self/fd; none known elsewhere.
fn open_under(dir: &Path) -> Vec<PathBuf> {
    let Ok(fds) = std::fs::read_dir("/proc/self/fd") else { return vec![] };
    fds.flatten().filter_map(|fd| std::fs::read_link(fd.path()).ok()).filter(|p| p.starts_with(dir)).collect()
}

/// A volume moved from `from` to `to`: unplugged, or plugged in.
fn plug(from: &Path, to: &Path) {
    std::fs::rename(from, to).expect("moved");
}

/// The time by this machine's clock: seconds since 1970.
fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).expect("after 1970").as_secs()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn eves_drive_is_a_device_of_her_vault_hosted_by_the_mac_it_is_plugged_into() {
    let (_relay, url, server) = server().await;
    let folder = Folder::new("drive");
    let (dir, volumes, away) = (folder.0.join("avendb"), folder.0.join("Volumes"), folder.0.join("unplugged"));
    std::fs::create_dir_all(&volumes).expect("the volumes' folder");
    let passkey = || Passkey::from_seed([5; 32]);
    let mut app = App::with_volumes(&dir, &volumes, passkey());
    let mac = app.call("found", json!(["Eve's Mac", url.to_string(), server.offer().to_text()])).await;
    let mac = mac.expect("her vault");
    assert_eq!(app.asked(), ["unlock", "found"]);
    let mine = world_of(&mut app).await["mine"].clone();
    // she plugs in her photo drive, which avenDB doesn't use yet; beside it the startup disk, linked as macOS links
    // it, and a hidden folder: no drives
    let photo = volumes.join("Photo drive");
    std::fs::create_dir_all(&photo).expect("her drive");
    std::fs::write(photo.join("DSC0001.jpg"), b"her photo").expect("her photo");
    std::os::unix::fs::symlink("/", volumes.join("Macintosh HD")).expect("the startup disk");
    std::fs::create_dir_all(volumes.join(".Trashes")).expect("a hidden folder");
    let path = json!(photo.to_string_lossy());
    let free = json!({ "volumes": [{ "path": path, "name": "Photo drive", "state": "free", "device": null }],
        "drives": [] });
    assert_eq!(app.call("drives", json!([])).await, Ok(free), "a volume of hers, free");
    // one sheet makes it a device of her vault, with a key of its own
    let joined = app.call("joinDrive", json!([path, "Photo drive"])).await.expect("her drive joins");
    assert_eq!(app.asked(), ["drive"], "one sheet");
    let drive = joined["device"].clone();
    assert_ne!(drive, mac["id"], "a device of its own");
    let again = app.call("joinDrive", json!([path, "Photo drive"])).await;
    assert_eq!(again, Err("this drive is one of your devices already".into()));
    // a full copy, by default, named by its card
    let full = |d: Option<&Value>| d.is_some_and(|d| d["name"] == "Photo drive" && d["copy"] == "full" && d["me"] == false);
    device_shown(&mut app, &mine, &drive, "her drive, a full copy named by its card", full).await;
    let hosted = drives(&mut app, "her drive, hosted", |s| s["drives"][0]["plugged"] == true).await;
    assert_eq!((&hosted["volumes"][0]["state"], &hosted["volumes"][0]["device"]), (&json!("hosted"), &drive));
    let one = &hosted["drives"][0];
    assert_eq!((&one["device"], &one["name"], &one["volume"]), (&drive, &json!("Photo drive"), &path));
    // her note and her photo sync to it, the photo whole, as it keeps a full copy
    let seeds = titled("Seeds", "Tomatoes in March.");
    let note = run(&mut app, json!({ "op": "create", "vault": mine, "type": "note", "value": seeds })).await;
    let note = note.expect("her note")["entry"].clone();
    let picture: Vec<u8> = (0..60_000u32).map(|i| (i * 13 % 251) as u8).collect();
    let picture = put_file(&mut app, &mine, "Tomatoes.jpg", &picture).await["entry"].clone();
    shown(&mut app, &note, "her note, on her drive", |n| holds_all(&n["syncedTo"], &drive, true)).await;
    let whole = |f: &Value| holds_all(&f["files"][0]["syncedTo"], &drive, true);
    shown(&mut app, &picture, "her photo, whole on her drive", whole).await;
    let synced = now();
    // what opens the drive keeps its key masked by her passkey's PRF output on the drive's own salt: its key is
    // nowhere on the drive in plain, nor on her Mac, which keeps it wrapped under a key of its own
    let opens = photo.join(format!(".avendb/g{FLOOR}/meta/0000000000000001"));
    let meta: Value = serde_json::from_slice(&std::fs::read(opens).expect("what opens it")).expect("JSON");
    assert_eq!((&meta["device"], &meta["name"]), (&drive, &json!("Photo drive")));
    let (nonce, mask) = (id(&meta["nonce"]), id(&meta["mask"]));
    let unmask = passkey().prf(&device_salt(&nonce));
    let secret: [u8; 32] = std::array::from_fn(|i| mask[i] ^ unmask[i]);
    let key = DeviceKey::from_secret(secret);
    assert_eq!(json!(hex(&key.id().0)), drive, "her passkey unmasks the drive's own key");
    let (endpoint, secret_hex) = (key.endpoint_secret(), hex(&secret));
    let plain: [&[u8]; 3] = [&secret, secret_hex.as_bytes(), &endpoint[..]];
    let stored = files_in(&photo);
    assert!(stored.len() > 5, "its store: {} files", stored.len());
    for (file, bytes) in stored.iter().chain(&files_in(&dir)) {
        for p in plain {
            assert!(!bytes.windows(p.len()).any(|w| w == p), "{} holds the drive's key in plain", file.display());
        }
    }
    assert_eq!(objects(&dir, FLOOR, "drives"), [drive.as_str().expect("hex")], "her Mac keeps it wrapped");
    let untouched = std::fs::read(photo.join("DSC0001.jpg")).expect("her photo");
    assert_eq!(untouched, b"her photo", "the rest of the drive as it was");
    // it signs what it holds now, and her Mac keeps that
    let since = |s: &Value| s["drives"][0]["checked"].as_u64().is_some_and(|c| c > synced);
    drives(&mut app, "the drive's statement since it holds her note", since).await;
    // unplugged: its node stops, and her Mac shows what it held as it last said, and when it checked
    plug(&photo, &away);
    let unplugged = drives(&mut app, "her drive, unplugged", |s| s["drives"][0]["plugged"] == false).await;
    assert_eq!(unplugged["volumes"], json!([]), "no volume of hers");
    assert!(since(&unplugged) && unplugged["drives"][0]["volume"].is_null(), "{unplugged}");
    shown(&mut app, &note, "her note, on her drive as it said", |n| holds_all(&n["syncedTo"], &drive, false)).await;
    let said = |f: &Value| holds_all(&f["files"][0]["syncedTo"], &drive, false);
    shown(&mut app, &picture, "her photo, whole on her drive as it said", said).await;
    // plugged in again, it is hosted with no sheet, and takes what she wrote meanwhile
    let later = titled("Later", "Beans in May.");
    let later = run(&mut app, json!({ "op": "create", "vault": mine, "type": "note", "value": later })).await;
    let later = later.expect("another note")["entry"].clone();
    plug(&away, &photo);
    drives(&mut app, "her drive, plugged in again", |s| s["drives"][0]["plugged"] == true).await;
    shown(&mut app, &later, "her later note, on her drive", |n| holds_all(&n["syncedTo"], &drive, true)).await;
    assert!(app.asked().is_empty(), "no sheet");
    // she ejects it in the page: its node stops and nothing on the drive stays open, so macOS ejects it as Finder
    // would; it shows unplugged, with when it checked, and stays so until it is unmounted and plugged in again, then
    // it is hosted with no sheet
    let its_store = photo.join(".avendb").canonicalize().expect("its store");
    if cfg!(target_os = "linux") {
        let probe = std::fs::File::open(photo.join(format!(".avendb/g{FLOOR}/meta/0000000000000001")))
            .expect("a file of its store");
        assert!(!open_under(&its_store).is_empty(), "a file held open on the drive shows");
        drop(probe);
    }
    let ejected = app.call("ejectDrive", json!([path])).await.expect("ejected");
    assert_eq!(ejected["ejected"], path);
    assert_eq!(open_under(&its_store), Vec::<PathBuf>::new(), "nothing on the drive open once it is ejected");
    let out = drives(&mut app, "her drive, ejected", |s| s["drives"][0]["plugged"] == false).await;
    assert!(since(&out) && out["volumes"][0]["state"] == "ejected", "{out}");
    tokio::time::sleep(drive::LOOK * 2).await;
    let still = app.call("drives", json!([])).await.expect("her drives");
    assert_eq!((&still["drives"][0]["plugged"], &still["volumes"][0]["state"]), (&json!(false), &json!("ejected")));
    assert_eq!(open_under(&its_store), Vec::<PathBuf>::new(), "nor after the Mac looked again");
    plug(&photo, &away);
    drives(&mut app, "her drive, unmounted", |s| s["volumes"] == json!([])).await;
    plug(&away, &photo);
    drives(&mut app, "her drive, plugged in after it was ejected", |s| s["drives"][0]["plugged"] == true).await;
    assert!(app.asked().is_empty(), "no sheet");
    // a light copy, as she picks
    let light = run(&mut app, json!({ "op": "copy", "device": drive, "full": false })).await;
    assert!(light.expect("a light copy")["share"].is_string());
    device_shown(&mut app, &mine, &drive, "her drive, a light copy", |d| d.is_some_and(|d| d["copy"] == "light")).await;
    // her other Mac, linked to her vault through this one, opens the drive in one sheet, then in none
    let (dir_b, volumes_b) = (folder.0.join("avendb-b"), folder.0.join("Volumes B"));
    std::fs::create_dir_all(&volumes_b).expect("its volumes' folder");
    let mut other = App::with_volumes(&dir_b, &volumes_b, passkey());
    other.call("link", json!(["Eve's other Mac", url.to_string(), mac["offer"]])).await.expect("linked");
    assert_eq!(other.asked(), ["unlock"]);
    plug(&photo, &away);
    drives(&mut app, "her drive, unplugged from her first Mac", |s| s["drives"][0]["plugged"] == false).await;
    let photo_b = volumes_b.join("Photo drive");
    plug(&away, &photo_b);
    let path_b = json!(photo_b.to_string_lossy());
    let locked = drives(&mut other, "her drive, locked on her other Mac", |s| s["volumes"][0]["state"] == "locked").await;
    assert_eq!((&locked["volumes"][0]["device"], &locked["drives"]), (&drive, &json!([])));
    let opened = other.call("openDrive", json!([path_b])).await.expect("opened there");
    assert_eq!((other.asked(), &opened["device"]), (vec!["drive".to_string()], &drive), "one sheet");
    drives(&mut other, "her drive, hosted by her other Mac", |s| s["drives"][0]["plugged"] == true).await;
    plug(&photo_b, &away);
    drives(&mut other, "unplugged from her other Mac", |s| s["drives"][0]["plugged"] == false).await;
    plug(&away, &photo_b);
    drives(&mut other, "plugged into it again", |s| s["drives"][0]["plugged"] == true).await;
    assert!(other.asked().is_empty(), "no sheet the second time");
    plug(&photo_b, &away);
    drives(&mut other, "unplugged from it again", |s| s["drives"][0]["plugged"] == false).await;
    other.quit().await;
    // she loses it: removed as a lost phone is, in one sheet
    let removed = run(&mut app, json!({ "op": "revoke", "vault": mine, "device": drive })).await;
    assert!(removed.expect("removed")["edit"].is_string());
    assert_eq!(app.asked(), ["approve"], "one sheet");
    device_shown(&mut app, &mine, &drive, "her drive, a device of her vault no more", |d| d.is_none()).await;
    drives(&mut app, "no drive of hers", |s| s["drives"] == json!([])).await;
    let (vault, gone) = (VaultId(id(&mine)), SignerId(id(&drive)));
    let out = move |lab: &Lab, me| lab.state(me).vault(vault).is_some_and(|v| !v.devices.contains(&gone));
    until("the server takes it out of her vault", || server.read(out)).await;
    let newer = titled("Newer", "Peas in June.");
    let newer = run(&mut app, json!({ "op": "create", "vault": mine, "type": "note", "value": newer })).await;
    let newer = EntryId(id(&newer.expect("a newer note")["entry"]));
    until("the server keeps her newer note", || server.read(move |lab, me| lab.fetched(me, newer) > 0)).await;
    // whoever runs it now, with its key, is refused: what it writes stands nowhere, as its device's removal takes it
    // away (strong removal), and it gets nothing new
    let mut lab = Lab::with_entropy([7; 32]);
    let me = lab.device_with("Photo drive", secret);
    let shelf = disk::open(&away.join(".avendb")).expect("its store");
    let thief = Node::spawn(lab, me, Options { shelf: Some(shelf), ..Options::local() }).await.expect("its node");
    let note = titled("Mine now", "Not hers.");
    let written = thief.op(json!({ "op": "create", "vault": mine, "type": "note", "value": note })).await;
    let written = EntryId(id(&written.expect("an answer")["ok"]["entry"]));
    let stands = move |lab: &Lab, me| lab.entries(me).contains(&written);
    assert!(thief.read(stands).await, "it stands on the drive, which hasn't heard it was removed");
    thief.know(server.addr());
    server.know(thief.addr());
    let _ = server.sync_with(thief.id()).await;
    let _ = thief.sync_with(server.id()).await;
    let seen = server.read(move |lab, me| (lab.fetched(me, written), stands(lab, me))).await;
    assert_eq!(seen, (1, false), "the server holds what it signed, and refuses it");
    assert_eq!(thief.read(move |lab, me| lab.fetched(me, newer)).await, 0, "it gets nothing new");
    thief.shutdown().await.expect("its node stops");
    // plugged into her Mac again, it is hosted no more; used for avenDB again, it is a new device, what it held put
    // aside on it, never deleted
    plug(&away, &photo);
    let taken = drives(&mut app, "her drive, taken out", |s| s["volumes"][0]["state"] == "removed").await;
    assert_eq!(taken["drives"], json!([]));
    assert!(app.asked().is_empty(), "no sheet");
    let rejoined = app.call("joinDrive", json!([path, "Photo drive"])).await.expect("a new device");
    assert_eq!(app.asked(), ["drive"]);
    assert_ne!(rejoined["device"], drive, "a new device, its key new");
    let shelves = disk::generations(&photo.join(".avendb")).expect("its shelves");
    assert_eq!(shelves, [FLOOR, FLOOR + 1], "what it held put aside");
    app.quit().await;
    server.shutdown().await.expect("the server's node stops");
}

/// Bytes as lowercase hex digits.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
