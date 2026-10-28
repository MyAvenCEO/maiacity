//! avenDB's device in Chromium (P8d, P8e, v8 phase S): `tests/device.rs` again, each browser a page. The test serves
//! the page (`tests/page/`) and the device's WebAssembly, which `scripts/test-browser.sh` builds for passkeys of
//! localhost; it starts a relay open to sign-up and a new server, nobody's yet, on this machine, and drives one
//! headless Chromium over its DevTools protocol. The tab's virtual authenticator, with PRF, holds Eve's passkey, and
//! each of her browsers is a frame of the tab, with a store of its own in OPFS, its shelf. Her first browser keeps
//! there what an earlier avenDB kept, deleting none of it, makes the passkey, founds her vault and claims the server in one ceremony after
//! the unlock, and writes a note; then it runs the ops the page's screens send, each through `run` (V2): it brings a
//! file (`put_file`) and reads a range of it back (`read_file`), founds two vaults in one more ceremony, reads its
//! world, shares a note and revokes the share, keeps her notes, makes the coop a co-owner and sets a threshold, each in
//! a ceremony of her passkey, marks the note, asks `may` and sets how deep its queries read; her second links through
//! the first one's code in one ceremony and edits it; both add a row three lists down in her outline at once, and each
//! reads the other's, the two agreeing on the whole outline; once the second read its row, the first closes, opens
//! again from its shelf in one ceremony and edits the note once more, no other page holding its store while it runs;
//! then she forgets it there, and its shelf is put aside, a new one in use, what the earlier avenDB kept still there.
//! Each page reports its steps to the test over HTTP. `cargo test` skips it; the script runs it.

use std::collections::VecDeque;
use std::future::Future;
use std::net::SocketAddr;
use std::os::fd::{AsRawFd as _, OwnedFd};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use avendb::id::{BlobId, EntryId, VaultId};
use avendb::lab::Lab;
use avendb_net::shelf::FLOOR;
use avendb_net::{Admission, Node, Options};
use avendb_server::Relay;
use iroh::EndpointId;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt as _, AsyncReadExt as _, AsyncWriteExt as _, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

/// A socket of the system's choosing on this machine.
const LOOPBACK: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 0);

/// How long a page may take over a step: the first one compiles the WebAssembly and makes a McEliece key pair.
const STEP: Duration = Duration::from_secs(120);

/// What Eve's note reads as each browser writes it.
const MARCH: &str = "Tomatoes in March.";
const APRIL: &str = "Tomatoes in April.";
const MAY: &str = "Tomatoes in May.";

/// Waits until `check` holds, within `STEP`.
async fn until<F: Future<Output = bool>>(what: &str, mut check: impl FnMut() -> F) {
    let end = Instant::now() + STEP;
    while !check().await {
        assert!(Instant::now() < end, "{what}, within {STEP:?}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// A query string: each value percent-encoded but for the characters URLs leave alone.
fn query(params: &[(&str, &str)]) -> String {
    let encode = |s: &str| -> String {
        let plain = |b: u8| b.is_ascii_alphanumeric() || b"-_.~".contains(&b);
        s.bytes().map(|b| if plain(b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
    };
    params.iter().map(|(k, v)| format!("{k}={}", encode(v))).collect::<Vec<_>>().join("&")
}

/// An id a page reported, in hex.
fn id(found: &Value, key: &str) -> [u8; 32] {
    found[key].as_str().and_then(BlobId::from_hex).unwrap_or_else(|| panic!("{key} in {found}")).0
}

/// What a page reported: which page, which step, and what it found.
type Report = (String, String, Value);

/// Chromium, headless, driven over its DevTools protocol on a pipe (`--remote-debugging-pipe`): it reads commands on
/// its fd 3 and writes answers and events on its fd 4, each a JSON message ending in a NUL. Its log, where each page's
/// console goes too, is in a folder of its own.
struct Chromium {
    _child: Child,
    to: tokio::fs::File,
    from: BufReader<tokio::fs::File>,
    next: u64,
    dir: PathBuf,
}

impl Chromium {
    fn launch(path: &Path) -> Chromium {
        let dir = std::env::temp_dir().join(format!("avendb-chromium-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("a folder for Chromium");
        let log = std::fs::File::create(dir.join("log")).expect("Chromium's log");
        let (reads, to) = std::io::pipe().expect("a pipe to Chromium");
        let (from, writes) = std::io::pipe().expect("a pipe from Chromium");
        let (r, w) = (reads.as_raw_fd(), writes.as_raw_fd());
        assert!(r > 4 && w > 4, "the pipes clear of the fds Chromium takes them on");
        let mut command = Command::new(path);
        command
            .args(["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run"])
            .args(["--no-default-browser-check", "--no-proxy-server", "--enable-logging=stderr", "--v=0"])
            .arg("--remote-debugging-pipe")
            .arg(format!("--user-data-dir={}", dir.join("profile").display()))
            .arg("about:blank")
            .stdout(Stdio::null())
            .stderr(log)
            .kill_on_drop(true);
        // SAFETY: between fork and exec, dup2 alone, which is async-signal-safe
        unsafe {
            command.pre_exec(move || {
                if libc::dup2(r, 3) < 0 || libc::dup2(w, 4) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let _child = command.spawn().expect("Chromium starts");
        drop((reads, writes));
        let file = |fd: OwnedFd| tokio::fs::File::from_std(std::fs::File::from(fd));
        let (to, from) = (file(to.into()), BufReader::new(file(from.into())));
        Chromium { _child, to, from, next: 0, dir }
    }

    /// Calls `method` with `params`, on the page of `session` if any: its result. Events on the way are dropped.
    async fn call(&mut self, session: Option<&str>, method: &str, params: Value) -> Value {
        self.next += 1;
        let mut message = json!({ "id": self.next, "method": method, "params": params });
        if let Some(session) = session {
            message["sessionId"] = session.into();
        }
        let mut bytes = serde_json::to_vec(&message).expect("JSON");
        bytes.push(0);
        self.to.write_all(&bytes).await.expect("a command to Chromium");
        self.to.flush().await.expect("a command to Chromium");
        loop {
            let mut answer = vec![];
            let read = tokio::time::timeout(STEP, self.from.read_until(0, &mut answer)).await;
            let read = read.unwrap_or_else(|_| self.fail(&format!("Chromium doesn't answer {method}")));
            assert!(read.expect("Chromium's answer") > 0, "Chromium closed its pipe");
            answer.pop();
            let answer: Value = serde_json::from_slice(&answer).expect("JSON from Chromium");
            if answer["id"] == self.next {
                if let Some(error) = answer.get("error") {
                    self.fail(&format!("{method}: {error}"));
                }
                return answer["result"].clone();
            }
        }
    }

    fn fail(&self, why: &str) -> ! {
        let log = std::fs::read_to_string(self.dir.join("log")).unwrap_or_default();
        let console: Vec<&str> = log.lines().filter(|l| l.contains("CONSOLE") || l.contains("avenDB")).collect();
        eprintln!("--- {}:\n{}", self.dir.display(), console.join("\n"));
        panic!("{why}");
    }
}

/// The tab the devices are frames of, its virtual authenticator, and the pages' reports as they come.
struct Tab {
    chromium: Chromium,
    session: String,
    authenticator: String,
    site: String,
    reports: mpsc::UnboundedReceiver<Report>,
    early: VecDeque<Report>,
}

impl Tab {
    /// Opens `site` in a tab of `chromium` whose virtual authenticator holds passkeys with PRF, as a phone's or a
    /// laptop's platform authenticator does, and verifies its person each time.
    async fn open(mut chromium: Chromium, site: String, reports: mpsc::UnboundedReceiver<Report>) -> Tab {
        let target = chromium.call(None, "Target.createTarget", json!({ "url": format!("{site}/") })).await;
        let attach = json!({ "targetId": target["targetId"], "flatten": true });
        let session = chromium.call(None, "Target.attachToTarget", attach).await["sessionId"].clone();
        let session = session.as_str().expect("a session").to_owned();
        chromium.call(Some(&session), "WebAuthn.enable", json!({ "enableUI": false })).await;
        let options = json!({
            "protocol": "ctap2", "ctap2Version": "ctap2_1", "transport": "internal", "hasResidentKey": true,
            "hasUserVerification": true, "isUserVerified": true, "automaticPresenceSimulation": true, "hasPrf": true,
        });
        let added = chromium.call(Some(&session), "WebAuthn.addVirtualAuthenticator", json!({ "options": options }));
        let authenticator = added.await["authenticatorId"].as_str().expect("an authenticator").to_owned();
        // the site's page loaded, not the empty page a new tab holds until its first page comes, which reads as loaded
        // too: a frame put in that one goes with it, or runs in no secure context
        let loaded = format!("document.readyState === 'complete' && location.origin === {site:?}");
        let mut tab = Tab { chromium, session, authenticator, site, reports, early: VecDeque::new() };
        let end = Instant::now() + STEP;
        while tab.eval(&loaded).await != true {
            assert!(Instant::now() < end, "the tab loads");
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        tab
    }

    /// The value of `expression` in the tab.
    async fn eval(&mut self, expression: &str) -> Value {
        let params = json!({ "expression": expression, "returnByValue": true });
        self.chromium.call(Some(&self.session.clone()), "Runtime.evaluate", params).await["result"]["value"].clone()
    }

    /// A device's page in a frame of the tab, as `params` say.
    async fn frame(&mut self, params: &[(&str, &str)]) {
        let url = format!("{}/device?{}", self.site, query(params));
        let add = format!("document.body.append(Object.assign(document.createElement('iframe'), {{ src: {url:?} }}))");
        self.eval(&add).await;
    }

    /// The passkeys the tab's authenticator holds.
    async fn passkeys(&mut self) -> Vec<Value> {
        let params = json!({ "authenticatorId": self.authenticator });
        let held = self.chromium.call(Some(&self.session.clone()), "WebAuthn.getCredentials", params).await;
        held["credentials"].as_array().cloned().unwrap_or_default()
    }

    /// Waits for page `page` to report step `what`: what it found. Fails on a page's error, or after `STEP`, showing
    /// what the pages wrote to their console.
    async fn expect(&mut self, page: &str, what: &str) -> Value {
        let end = Instant::now() + STEP;
        loop {
            let report = match self.early.iter().position(|(p, w, _)| p == page && w == what) {
                Some(at) => self.early.remove(at),
                None => match tokio::time::timeout_at(end.into(), self.reports.recv()).await {
                    Ok(Some(report)) => Some(report),
                    _ => self.chromium.fail(&format!("page {page} doesn't report {what:?} within {STEP:?}")),
                },
            };
            let Some((p, w, found)) = report else { continue };
            if w == "error" {
                self.chromium.fail(&format!("page {p} fails: {}", found["error"].as_str().unwrap_or_default()));
            }
            if p == page && w == what {
                return found;
            }
            self.early.push_back((p, w, found));
        }
    }
}

/// Serves the page's files from `page`, the device's package from `pkg` and its JS modules (`js/`), and hands each
/// report a page posts to `reports`.
async fn serve(listener: TcpListener, page: PathBuf, pkg: PathBuf, reports: mpsc::UnboundedSender<Report>) {
    while let Ok((stream, _)) = listener.accept().await {
        let (page, pkg, reports) = (page.clone(), pkg.clone(), reports.clone());
        tokio::spawn(async move { answer(stream, &page, &pkg, &reports).await });
    }
}

/// Answers one HTTP request, then closes the connection.
async fn answer(mut stream: TcpStream, page: &Path, pkg: &Path, reports: &mpsc::UnboundedSender<Report>) -> Option<()> {
    let mut bytes = vec![];
    let head = loop {
        let mut chunk = [0; 8192];
        let n = stream.read(&mut chunk).await.ok().filter(|&n| n > 0)?;
        bytes.extend_from_slice(&chunk[..n]);
        if let Some(at) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            break at + 4;
        }
    };
    let text = String::from_utf8_lossy(&bytes[..head]).into_owned();
    let mut lines = text.lines();
    let mut request = lines.next()?.split(' ');
    let (method, target) = (request.next()?, request.next()?);
    let length = lines.filter_map(|l| l.split_once(':')).find(|(k, _)| k.eq_ignore_ascii_case("content-length"));
    let length: usize = length.and_then(|(_, v)| v.trim().parse().ok()).unwrap_or(0);
    let mut body = bytes[head..].to_vec();
    while body.len() < length {
        let mut chunk = [0; 8192];
        let n = stream.read(&mut chunk).await.ok().filter(|&n| n > 0)?;
        body.extend_from_slice(&chunk[..n]);
    }
    let path = target.split('?').next()?;
    let file = |path: PathBuf| std::fs::read(path).ok();
    let (status, kind, content) = match (method, path) {
        ("POST", p) if p.starts_with("/report/") => {
            let (page, what) = p["/report/".len()..].split_once('/')?;
            let what = what.replace("%20", " ");
            reports.send((page.into(), what, serde_json::from_slice(&body).unwrap_or(Value::Null))).ok()?;
            ("200 OK", "text/plain", Some(vec![]))
        }
        ("GET", "/") => ("200 OK", "text/html", file(page.join("host.html"))),
        ("GET", "/device") => ("200 OK", "text/html", file(page.join("index.html"))),
        ("GET", "/page.js") => ("200 OK", "text/javascript", file(page.join("page.js"))),
        ("GET", p) if p.starts_with("/js/") && !p.contains("..") => {
            ("200 OK", "text/javascript", file(page.join("../../js").join(&p["/js/".len()..])))
        }
        ("GET", p) if p.starts_with("/pkg/") && !p.contains("..") => {
            let kind = if p.ends_with(".wasm") { "application/wasm" } else { "text/javascript" };
            ("200 OK", kind, file(pkg.join(&p["/pkg/".len()..])))
        }
        _ => ("404 Not Found", "text/plain", None),
    };
    let (status, content) = match content {
        Some(content) => (status, content),
        None => ("404 Not Found", vec![]),
    };
    let head = format!("HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\n", content.len());
    stream.write_all(format!("{head}Connection: close\r\n\r\n").as_bytes()).await.ok()?;
    stream.write_all(&content).await.ok()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "needs the device's WebAssembly and Chromium: scripts/test-browser.sh runs it"]
async fn eves_browsers_found_link_and_open_again_with_her_passkey_in_chromium() {
    let pkg = PathBuf::from(std::env::var("AVENDB_PKG").expect("AVENDB_PKG: the device's package"));
    assert!(pkg.join("avendb_browser_bg.wasm").exists(), "the device's WebAssembly in {}", pkg.display());
    let chromium = std::env::var("AVENDB_CHROMIUM").unwrap_or_else(|_| "/opt/pw-browsers/chromium".into());
    let page = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/page");
    let listener = TcpListener::bind(LOOPBACK).await.expect("a socket for the page");
    // localhost, the relying party of the test's passkeys
    let site = format!("http://localhost:{}", listener.local_addr().expect("its address").port());
    let (tx, reports) = mpsc::unbounded_channel();
    tokio::spawn(serve(listener, page, pkg, tx));
    let mut tab = Tab::open(Chromium::launch(Path::new(&chromium)), site, reports).await;

    let admission = Admission::open();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url = relay.url().to_string();
    let mut lab = Lab::with_entropy([3; 32]);
    let server_d = lab.device_with("the server", [7; 32]);
    let opts = Options { relay: Some(relay.url()), admission: Some(admission.clone()), card: true, ..Options::local() };
    let server = Node::spawn(lab, server_d, opts).await.expect("the server");

    // what an earlier avenDB kept for her first browser's store in OPFS, which it keeps as it opens: avenDB is never reset
    tab.frame(&[("page", "earlier"), ("store", "first"), ("earlier", "1")]).await;
    let earlier = tab.expect("earlier", "earlier").await;
    assert!(earlier["ops"].is_string() && earlier["old"].is_string(), "kept: {earlier}");

    // Eve's first browser makes her passkey, founds her vault, claims the server and writes a note, in two ceremonies
    let code = server.offer().to_text();
    let params = [("store", "first"), ("name", "Eve's browser"), ("relay", &url), ("server", &code)];
    let then = [("page", "first"), ("write", MARCH), ("ops", "1"), ("reads", APRIL), ("nest", "111:Beans")];
    let then = [&then[..], &[("wait", "1"), ("close", "1")]].concat();
    tab.frame(&[&params[..], &then].concat()).await;
    let first = tab.expect("first", "started").await;
    eprintln!("Eve's first browser founded her vault in {} ms, in {} ceremonies", first["ms"], first["ceremonies"]);
    assert_eq!(first["ceremonies"], 2, "the unlock, and one for her vault and the claim: {first}");
    assert_eq!(first["limits"], 256, "its queries read as deep as any write reaches, until it says otherwise");
    let eve = VaultId(id(&first, "vault"));
    let seeded = move |lab: &Lab, me| lab.vault_of(me).is_some_and(|v| avendb::world::seeded(lab.state(me), eve, v));
    let seeded = server.read(seeded);
    assert!(seeded.await, "the server is a device of avenCEO server, of the seed her vault founded");
    let endpoint = EndpointId::from_bytes(&id(&first, "endpoint")).expect("an endpoint");
    until("the server learns her browser from what it relays", || async { admission.admits(&endpoint) }).await;
    let entry = EntryId(id(&first, "entry"));
    let holds = move |lab: &Lab, me| lab.fetched(me, entry) > 0;
    until("the server keeps her note", || server.read(holds)).await;
    // her browser's shelf is a new one, beside the shelf from before the last reset; the file she brought is there, its
    // one piece under its hash, its outboard too
    assert_eq!(first["generations"], json!(["g1", format!("g{FLOOR}")]), "a new shelf beside the old: {first}");
    let root = first["file"]["root"].as_str().unwrap_or_else(|| panic!("the file she brought: {first}"));
    for kept in ["blobs", "outboards"] {
        let held = first["shelf"][kept].as_array().unwrap_or_else(|| panic!("its {kept}: {first}"));
        assert!(held.contains(&json!(root)), "{root} in its {kept}: {held:?}");
    }

    // the ops the page's screens send, each through `run` (V2): what each answered
    let ops = tab.expect("first", "ops").await;
    eprintln!("the ops answered: {ops}");
    assert_eq!(ops["collection"], true, "real WASM canonical collection create/read/update/refusal");
    let eve_v = VaultId(id(&first, "vault"));
    let passkey = server.read(move |lab, me| lab.state(me).vault(eve_v).and_then(|v| v.root)).await;
    let passkey = passkey.expect("her vault's root, her passkey").to_hex();
    let approves = json!({ "approve": { "signers": [passkey] } });
    assert_eq!((&ops["mayFound"], &ops["foundCeremonies"]), (&approves, &json!(1)), "one ceremony for both: {ops}");
    let [farm, coop] = [&ops["vaults"][0], &ops["vaults"][1]];
    let mine = json!([{ "vault": first["vault"] }]);
    let made = json!([["coop", "Eve Farm COOP", farm, mine], ["coop", "Eve COOP", coop, mine]]);
    assert_eq!(ops["made"], made, "each named, her vault its owner, the device acting as it there");
    assert_eq!(ops["mayShare"], true, "a read share by id, alone");
    assert!(ops["share"].is_string() && ops["revoke"]["edit"].is_string() && ops["keep"].is_string(), "{ops}");
    assert_eq!((&ops["mayOwner"], &ops["owner"]["edit"].is_string()), (&approves, &true), "the coop a co-owner");
    let drafted = &ops["drafted"]["approve"];
    assert_eq!(drafted["signers"], json!([passkey]), "without a ceremony, what it would sign: {ops}");
    assert!(drafted["challenge"].as_str().is_some_and(|c| c.len() == 64) && drafted["draft"].is_string());
    assert!(ops["threshold"]["edit"].is_string(), "{ops}");
    assert_eq!((&ops["ceremonies"], &ops["thresholdNow"]), (&json!(2), &json!(2)), "one ceremony each");
    assert!(ops["mark"].get("edit").is_some(), "the steward's mark, or none left to make: {ops}");
    let rows: Vec<&str> = ops["rows"].as_array().expect("the shares").iter().filter_map(|r| r[0].as_str()).collect();
    assert_eq!(rows[..2], ["owner", "owner"], "her vault and the coop own it: {ops}");
    assert_eq!(ops["may"][0], true, "her card");
    assert_eq!(ops["may"][1]["refused"], "BadThreshold", "three of two owners");
    assert_eq!(ops["may"][2], approves, "a threshold her passkey approves");
    let limits = json!({ "depth": 9, "default": 16, "ceiling": 256 });
    assert_eq!(ops["limits"], limits, "its queries 9 levels down at most");
    let farm = VaultId(farm.as_str().and_then(BlobId::from_hex).expect("the new vault's id").0);
    let threshold = move |lab: &Lab, me| lab.state(me).vault(farm).map(|v| v.threshold);
    until("the server sees the new threshold", || async { server.read(threshold).await == Some(2) }).await;

    // her second browser links through the first one's code, in one ceremony, and edits the note
    let field = |key| first[key].as_str().unwrap_or_else(|| panic!("{key} in {first}"));
    let note = [("actor", field("actor")), ("entry", field("entry")), ("outline", field("outline"))];
    let offer = first["offer"].as_str().expect("the first browser's code");
    let second = [("page", "second"), ("store", "second"), ("name", "Eve's other browser"), ("relay", &url)];
    let file = format!("{root}:{}", first["file"]["size"]);
    let steps = [("offer", offer), ("reads", MARCH), ("file", &file), ("write", APRIL), ("nest", "112:Peas")];
    let steps = [&steps[..], &[("then", MAY)]].concat();
    tab.frame(&[&second[..], &steps, &note[..]].concat()).await;
    let second = tab.expect("second", "started").await;
    eprintln!("Eve's second browser linked in {} ms", second["ms"]);
    assert_eq!(second["ceremonies"], 1, "the unlock, which is the passkey's pass and signs the join: {second}");
    assert_eq!(second["vault"], first["vault"], "it joined her vault");
    tab.expect("second", "read").await;
    tab.expect("second", "fetched").await;
    tab.expect("second", "wrote").await;
    tab.expect("first", "read").await;
    // both add a row under one row of her outline, three lists down, at once: each reads both, and they agree
    let (mine, theirs) = (tab.expect("first", "nested").await, tab.expect("second", "nested").await);
    assert_eq!(mine["record"], theirs["record"], "both browsers read one outline");
    let under = &mine["record"]["nodes"][0]["kids"][0]["kids"];
    let mut rows: Vec<(i64, &str)> = under.as_array().expect("its rows").iter().map(|k| {
        (k["id"].as_i64().expect("an id"), k["text"].as_str().expect("a text"))
    }).collect();
    rows.sort();
    assert_eq!(rows, [(111, "Beans"), (112, "Peas")], "each browser's row, three lists down: {mine}");
    // the first closes once the second read its row too: a device closes with its edits on its shelf, and a peer that
    // hasn't taken them yet takes them once it opens again
    tab.eval("localStorage.setItem('go:first', '1')").await;
    let closed = tab.expect("first", "closed").await;
    eprintln!("Eve's first browser kept {} edits and {} McEliece keys in OPFS", closed["edits"], closed["keys"]);
    let shelf = closed["shelf"].as_array().expect("the names on its shelf");
    assert!(shelf.contains(&json!("meta/0000000000000001")), "what opens it again: {shelf:?}");
    assert!(shelf.iter().any(|n| n.as_str().is_some_and(|n| n.starts_with("journal/"))), "its edits: {shelf:?}");

    // the first browser opens again from its shelf, in the unlock alone, and edits the note once more
    let again = [("page", "again"), ("store", "first"), ("reads", APRIL), ("write", MAY)];
    tab.frame(&[&again[..], &[("wait", "1"), ("close", "1"), ("forget", "1")]].concat()).await;
    let again = tab.expect("again", "opened").await;
    eprintln!("Eve's first browser opened again in {} ms", again["ms"]);
    assert_eq!(again["ceremonies"], 1, "the unlock alone: {again}");
    assert_eq!((&again["endpoint"], &again["vault"]), (&first["endpoint"], &first["vault"]), "the same device");
    assert_eq!((&again["edits"], &again["keys"]), (&closed["edits"], &closed["keys"]), "holding what its shelf kept");
    assert_eq!(again["limits"], 9, "its queries as deep as it set them, kept on its shelf");
    tab.expect("again", "read").await;
    tab.expect("again", "wrote").await;
    // while it runs, no other page holds its store
    tab.frame(&[("page", "twice"), ("store", "first"), ("twice", "1")]).await;
    let twice = tab.expect("twice", "twice").await;
    let refused = twice["refused"].as_str().unwrap_or_else(|| panic!("a second page held the store: {twice}"));
    assert!(refused.contains("open in another tab"), "{refused}");
    tab.expect("second", "read again").await;

    // she forgets it there: its shelf is put aside, deleting nothing, and a new one is in use, holding nothing; what
    // the earlier avenDB kept, it still keeps
    tab.eval("localStorage.setItem('go:again', '1')").await;
    tab.expect("again", "closed").await;
    let forgot = tab.expect("again", "forgot").await;
    let (old, new) = (format!("g{FLOOR}"), format!("g{}", FLOOR + 1));
    assert_eq!(forgot["generations"], json!(["g1", old, new]), "a new shelf beside the old: {forgot}");
    // what opened it, as it kept it at the start and again with how deep its queries read
    let metas = json!({ "g1": ["0000000000000001"], old: ["0000000000000001", "0000000000000002"], new: [] });
    assert_eq!(forgot["metas"], metas, "the old shelf as it was");
    assert_eq!(forgot["meta"], Value::Null, "nothing opens a device on the new one");
    assert_eq!(forgot["earlier"], earlier, "what the earlier avenDB kept, as it was");
    let passkeys = tab.passkeys().await;
    assert_eq!(passkeys.len(), 1, "one passkey, Eve's: {passkeys:?}");
    assert_eq!(passkeys[0]["rpId"], "localhost");
    eprintln!("Eve's passkey signed {} times", passkeys[0]["signCount"]);
    server.shutdown().await.expect("the node shuts down");
}
