//! avenDB's device in Chromium (P8d): `tests/device.rs` again, each browser a page. The test serves the page
//! (`tests/page/`) and the device's WebAssembly, which `scripts/test-browser.sh` builds; it starts a relay, the server
//! and Samuel's Mac on this machine and opens Chromium twice. Samuel's browser links through the code his Mac shows,
//! reads Welcome, edits it, and reads the Mac's answer; his other browser links through the first one's code and reads
//! that answer too. Each page reports its steps to the test over HTTP. `cargo test` skips it; the script runs it.

use std::collections::VecDeque;
use std::future::Future;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use avendb::cast::*;
use avendb::id::{BlobId, SignerId};
use avendb::lab::Lab;
use avendb_net::{Admission, Node, Options};
use avendb_server::Relay;
use iroh::EndpointId;
use serde_json::Value;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

/// A socket of the system's choosing on this machine.
const LOOPBACK: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 0);

/// What Samuel's Mac answers the browser's edit with.
const MAC_TEXT: &str = "Samuel's Mac answers: the greenhouse opens at ten.";

/// How long a page may take over a step: the first one compiles the WebAssembly and makes a McEliece key pair.
const STEP: Duration = Duration::from_secs(120);

/// A node for device `d`, split off `w`'s Lab with the keys of `with`, its randomness drawn from `seed`.
async fn node(w: &mut World, d: SignerId, with: &[SignerId], seed: u8, opts: Options) -> Node {
    Node::spawn(w.lab.split(d, with, [seed; 32]), d, opts).await.expect("a node")
}

/// Waits until `check` holds, within `STEP`.
async fn until<F: Future<Output = bool>>(what: &str, mut check: impl FnMut() -> F) {
    let end = Instant::now() + STEP;
    while !check().await {
        assert!(Instant::now() < end, "{what}, within {STEP:?}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// `b` in hex, as the page takes ids and keys.
fn hex(b: &[u8; 32]) -> String {
    BlobId(*b).to_hex()
}

/// A query string: each value percent-encoded but for the characters URLs leave alone.
fn query(params: &[(&str, &str)]) -> String {
    let encode = |s: &str| -> String {
        let plain = |b: u8| b.is_ascii_alphanumeric() || b"-_.~".contains(&b);
        s.bytes().map(|b| if plain(b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
    };
    params.iter().map(|(k, v)| format!("{k}={}", encode(v))).collect::<Vec<_>>().join("&")
}

/// What a page reported: which page, which step, and what it found.
type Report = (String, String, Value);

/// The pages' reports, as they come, and the Chromiums showing them.
struct Pages {
    reports: mpsc::UnboundedReceiver<Report>,
    early: VecDeque<Report>,
    chromium: PathBuf,
    open: Vec<(Child, PathBuf)>,
}

impl Pages {
    /// Opens `url` in a Chromium of its own, headless, its log in a folder of its own.
    fn open(&mut self, name: &str, url: &str) {
        let dir = std::env::temp_dir().join(format!("avendb-chromium-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("a folder for Chromium");
        let log = std::fs::File::create(dir.join("log")).expect("Chromium's log");
        let child = Command::new(&self.chromium)
            .args(["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run"])
            .args(["--no-default-browser-check", "--no-proxy-server", "--enable-logging=stderr", "--v=0"])
            .arg(format!("--user-data-dir={}", dir.join("profile").display()))
            .arg(url)
            .stdout(Stdio::null())
            .stderr(log)
            .kill_on_drop(true)
            .spawn()
            .expect("Chromium starts");
        self.open.push((child, dir));
    }

    /// Waits for page `page` to report step `what`: what it found. Fails on a page's error, or after `STEP`, showing
    /// what each page wrote to its console.
    async fn expect(&mut self, page: &str, what: &str) -> Value {
        let end = Instant::now() + STEP;
        loop {
            let report = match self.early.iter().position(|(p, w, _)| p == page && w == what) {
                Some(at) => self.early.remove(at),
                None => match tokio::time::timeout_at(end.into(), self.reports.recv()).await {
                    Ok(Some(report)) => Some(report),
                    _ => self.fail(&format!("page {page} doesn't report {what:?} within {STEP:?}")),
                },
            };
            let Some((p, w, found)) = report else { continue };
            if w == "error" {
                self.fail(&format!("page {p} fails: {}", found["error"].as_str().unwrap_or_default()));
            }
            if p == page && w == what {
                return found;
            }
            self.early.push_back((p, w, found));
        }
    }

    fn fail(&self, why: &str) -> ! {
        for (_, dir) in &self.open {
            let log = std::fs::read_to_string(dir.join("log")).unwrap_or_default();
            let console: Vec<&str> = log.lines().filter(|l| l.contains("CONSOLE") || l.contains("avenDB")).collect();
            eprintln!("--- {}:\n{}", dir.display(), console.join("\n"));
        }
        panic!("{why}");
    }
}

/// Serves the page's files from `page` and the device's package from `pkg`, and hands each report a page posts to
/// `reports`.
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
        ("GET", "/") => ("200 OK", "text/html", file(page.join("index.html"))),
        ("GET", "/page.js") => ("200 OK", "text/javascript", file(page.join("page.js"))),
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
async fn samuels_browsers_link_in_chromium() {
    let pkg = PathBuf::from(std::env::var("AVENDB_PKG").expect("AVENDB_PKG: the device's package"));
    assert!(pkg.join("avendb_browser_bg.wasm").exists(), "the device's WebAssembly in {}", pkg.display());
    let chromium = std::env::var("AVENDB_CHROMIUM").unwrap_or_else(|_| "/opt/pw-browsers/chromium".into());
    let page = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/page");
    let listener = TcpListener::bind(LOOPBACK).await.expect("a socket for the page");
    let site = format!("http://{}", listener.local_addr().expect("its address"));
    let (tx, reports) = mpsc::unbounded_channel();
    tokio::spawn(serve(listener, page, pkg, tx));
    let mut pages = Pages { reports, early: VecDeque::new(), chromium: chromium.into(), open: vec![] };

    let admission = Admission::default();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url = relay.url();
    let mut w = world();
    let h = handbook(&mut w);
    let secret = hex(&w.lab.passkey_secret(w.passkey_s).expect("Samuel's passkey, a software passkey"));
    let (mac_s, server_d, samuel) = (w.mac_s, w.server, w.samuel);
    let opts = Options { relay: Some(url.clone()), admission: Some(admission.clone()), ..Options::local() };
    let server = node(&mut w, server_d, &[], 2, opts).await;
    let mac = node(&mut w, mac_s, &[], 1, Options { relay: Some(url.clone()), ..Options::local() }).await;
    mac.know(server.addr());
    until("the relay serves Samuel's Mac", || async { relay.serves(&mac.id()) }).await;
    let (coop, space, welcome) = (h.coop, h.space, h.welcome);
    let (relay_url, space_hex, entry) = (url.to_string(), hex(&space.0), hex(&welcome.0));

    // Samuel's browser links through the code his Mac shows, reads Welcome, edits it, and reads the Mac's answer
    let code = mac.offer().to_text();
    let first = query(&[
        ("page", "first"),
        ("name", "Samuel's browser"),
        ("relay", &relay_url),
        ("offer", &code),
        ("passkey", &secret),
        ("space", &space_hex),
        ("entry", &entry),
        ("reads", WELCOME_TEXT),
        ("actor", &hex(&coop.0)),
        ("write", AFTER_TEXT),
        ("then", MAC_TEXT),
    ]);
    pages.open("first", &format!("{site}/?{first}"));
    let linked = pages.expect("first", "linked").await;
    assert_eq!(linked["vault"].as_str(), Some(hex(&samuel.0).as_str()), "it joined Samuel's vault: {linked}");
    eprintln!("Samuel's browser linked in {} ms", linked["ms"]);
    pages.expect("first", "read").await;
    pages.expect("first", "wrote").await;
    let reads = move |lab: &Lab, me| text(lab, me, space, welcome, 2).as_deref() == Some(AFTER_TEXT);
    until("the Mac reads the browser's edit", || mac.read(reads)).await;
    let answer = move |lab: &mut Lab, me| lab.edit(me, coop, space, welcome, |i| i.set_text(2, MAC_TEXT));
    mac.act(answer).await.expect("the Mac answers");
    pages.expect("first", "read again").await;
    let done = pages.expect("first", "done").await;
    eprintln!("Samuel's browser holds {} ops and {} blobs", done["ops"], done["blobs"]);

    // his other browser links through the first one's code, browser to browser, and reads the Mac's answer
    let code = linked["offer"].as_str().expect("the first browser's code");
    let second = query(&[
        ("page", "second"),
        ("name", "Samuel's other browser"),
        ("relay", &relay_url),
        ("offer", code),
        ("passkey", &secret),
        ("space", &space_hex),
        ("entry", &entry),
        ("reads", MAC_TEXT),
    ]);
    pages.open("second", &format!("{site}/?{second}"));
    let other = pages.expect("second", "linked").await;
    assert_eq!(other["vault"], linked["vault"], "it joined Samuel's vault too");
    pages.expect("second", "read").await;
    pages.expect("second", "done").await;

    // the server learned both from the Mac, and lets them in as devices it knows
    for found in [&linked, &other] {
        let endpoint = found["endpoint"].as_str().and_then(BlobId::from_hex).expect("an endpoint");
        let endpoint = EndpointId::from_bytes(&endpoint.0).expect("an endpoint's key");
        until("the server knows the browser", || async { admission.admits(&endpoint) }).await;
    }
    let four = move |lab: &Lab, me| lab.state(me).vault(samuel).map(|v| v.devices.len()) == Some(4);
    until("the Mac counts both browsers among Samuel's devices", || mac.read(four)).await;
    for n in [mac, server] {
        n.shutdown().await.expect("the node shuts down");
    }
}
