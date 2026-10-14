//! The Mac app's native device (avendb-device), as the app runs it: lines of JSON on its stdin and stdout, and each of
//! its person's passkey's ceremonies in the sign-in sheet, which the app shows and whose page seals what it brings back
//! to the key the device made for that ceremony alone. Here the app is the test, and the sheet's page a software
//! passkey that seals as the page does (avendb-browser's `sealCeremony`). Eve founds her vault from the Mac in two
//! sheets, through a relay open to sign-up; the device keeps her vault on the shelf in its folder, opens again from it
//! in the unlock's sheet alone, following the vaults it followed, and puts the shelf aside when she forgets it there,
//! never deleting it. Every read and change is an op (`run`, V2), what her vault's owners approve signed in a sheet;
//! a file comes in a chunk at a time (`fileStart`, `fileChunk`, `fileEnd`), and any range of it back, in base64. A new
//! device puts aside a shelf a start cut short left, and never reads what an earlier avenDB kept in the folder.

use std::collections::HashMap;
use std::future::Future;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use avendb::cast::*;
use avendb::id::EntryId;
use avendb::keys::{self, SeededRng};
use avendb::lab::Lab;
use avendb::sign::{Ceremony, PRF_SALT, Passkey};
use avendb_device::{Config, SHEET, serve};
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
    assert_eq!(disk::generations(&dir).expect("its shelves"), [1], "one shelf");
    assert!(objects(&dir, 1, "meta").is_empty(), "nothing to open");
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
        n["syncedTo"].as_array().is_some_and(|d| d.len() == 2 && d.contains(&mac) && d.contains(&keeper))
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
    let shares = world["caps"].as_array().expect("its shares");
    let shared = shares.iter().find(|c| c["id"] == share).expect("the share");
    let (who, level, slice) = (&shared["grantee"], &shared["role"], &shared["slice"]);
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
    // a film, a chunk at a time in base64, as native.js hands it over; then any range of it back, in base64 too
    let film: Vec<u8> = (0..100_000u32).map(|i| (i * 7 % 253) as u8).collect();
    let put = json!({ "op": "put_file", "vault": vault, "name": "Film.mp4", "media": "video/mp4", "tags": [],
        "len": film.len() });
    let n = app.call("fileStart", json!([put])).await.expect("a file's number");
    let mut at = 0;
    for chunk in film.chunks(40_000) {
        assert_eq!(app.call("fileChunk", json!([n, at, BASE64.encode(chunk)])).await, Ok(Value::Null));
        at += chunk.len();
    }
    let out_of_order = app.call("fileChunk", json!([n, 5, BASE64.encode(b"late")])).await;
    assert!(out_of_order.is_err_and(|e| e.contains("came before")), "each chunk in order");
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
    let metas = ["0000000000000001", "0000000000000002", "0000000000000003"];
    let kept = "what opens it, as founded, following avenCEO, then as renamed, each kept whole";
    assert_eq!(objects(&dir, 1, "meta"), metas, "{kept}");
    assert!(!objects(&dir, 1, "journal").is_empty(), "its shelf keeps its edits");
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
    // she forgets it here: its shelf, with what opens it, is put aside, never deleted, and a new one is in use
    assert_eq!(app.call("forget", json!([])).await, Ok(Value::Null));
    assert_eq!(app.call("status", json!([])).await, Ok(json!({ "meta": null, "open": false, "device": null })));
    assert_eq!(disk::generations(&dir).expect("its shelves"), [1, 2], "a new shelf beside the old");
    assert_eq!(objects(&dir, 1, "meta"), metas, "the old shelf as it was");
    assert!(objects(&dir, 2, "meta").is_empty() && objects(&dir, 2, "journal").is_empty(), "the new one empty");
    app.quit().await;
    let mut app = App::start(&dir, Passkey::from_seed([5; 32]), true);
    assert_eq!(app.call("open", json!([])).await, Err("this Mac holds no avenDB account yet".into()), "forgotten");
    app.quit().await;
    server.shutdown().await.expect("the server's node stops");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_new_device_puts_aside_a_shelf_cut_short_and_never_reads_what_an_earlier_avendb_kept() {
    let (_relay, url, server) = server().await;
    let folder = Folder::new("aside");
    let dir = folder.0.clone();
    // what an earlier avenDB kept in the folder: its store, what opened its device, and a store it put aside
    let opened = json!({
        "name": "Eve's old Mac",
        "relay": url.to_string(),
        "nonce": hex(&[1; 32]),
        "mask": hex(&[2; 32]),
        "credential": CREDENTIAL,
        "passkey": hex(&Passkey::from_seed([5; 32]).public()),
    });
    let opened = opened.to_string().into_bytes();
    let aside = "aside/1760000000-forgotten/meta.json";
    let earlier: [(&str, &[u8]); 3] = [("meta.json", &opened), ("store/ops", &[0, 0, 0, 3, 1, 2, 3]), (aside, &opened)];
    for (name, bytes) in earlier {
        std::fs::create_dir_all(dir.join(name).parent().expect("a folder")).expect("its folder");
        std::fs::write(dir.join(name), bytes).expect("kept");
    }
    // and a start cut short on the shelf in use: something kept, nothing that opens it
    let shelf = disk::open(&dir).expect("its shelf");
    shelf.put("journal/0000000000000001", Bytes::from_static(b"cut short")).await.expect("kept");
    drop(shelf);
    let mut app = App::start(&dir, Passkey::from_seed([5; 32]), false);
    let nothing = json!({ "meta": null, "open": false, "device": null });
    assert_eq!(app.call("status", json!([])).await, Ok(nothing), "nothing it opens");
    assert_eq!(app.call("open", json!([])).await, Err("this Mac holds no avenDB account yet".into()));
    let offer = server.offer().to_text();
    let device = app.call("found", json!(["Eve's Mac", url.to_string(), offer])).await.expect("her vault");
    assert_eq!(disk::generations(&dir).expect("its shelves"), [1, 2], "the shelf cut short put aside");
    let cut = std::fs::read(dir.join("g1/journal/0000000000000001")).expect("still there");
    assert_eq!(cut, b"cut short", "as it was");
    assert_eq!(objects(&dir, 2, "meta"), ["0000000000000001"], "what opens her device, on its own shelf");
    let status = app.call("status", json!([])).await.expect("its status");
    assert_eq!((&status["device"], &status["meta"]["name"]), (&device, &json!("Eve's Mac")));
    app.quit().await;
    for (name, bytes) in earlier {
        assert_eq!(std::fs::read(dir.join(name)).expect("still there"), bytes, "{name} as it was");
    }
    server.shutdown().await.expect("the server's node stops");
}

/// Bytes as lowercase hex digits.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
