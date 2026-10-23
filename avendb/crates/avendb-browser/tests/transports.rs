//! Real production Worker/WASM carrier integration in disposable Chromium. No live accounts or public services.
//! Build WASM with localhost-passkeys and run this ignored target with AVENDB_PKG and AVENDB_NODE set.
use avendb::{
    id::{BlobId, EntryId},
    lab::Lab,
    sealed::FileRoot,
};
use avendb_net::{Admission, Node, Options, transports::WtConfig};
use avendb_server::Relay;
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdout, Command},
};

async fn report(lines: &mut tokio::io::Lines<BufReader<ChildStdout>>, expected: &str) -> Value {
    let line = tokio::time::timeout(Duration::from_secs(180), lines.next_line())
        .await
        .expect("browser fixture deadline")
        .unwrap()
        .expect("browser fixture report");
    assert!(line.len() < 32 << 10);
    let value: Value = serde_json::from_str(&line).expect("fixture JSON");
    assert_eq!(value["step"], expected, "browser report: {value}");
    value
}
async fn command(input: &mut tokio::process::ChildStdin, value: Value) {
    input
        .write_all(format!("{value}\n").as_bytes())
        .await
        .unwrap();
    input.flush().await.unwrap();
}
async fn eventually<F, Fut>(what: &str, mut check: F)
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    let end = tokio::time::Instant::now() + Duration::from_secs(60);
    while !check().await {
        assert!(tokio::time::Instant::now() < end, "{what}");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs freshly rebuilt localhost-passkeys WASM, AVENDB_PKG, AVENDB_NODE and installed Chromium"]
async fn real_browser_workers_sync_over_negotiated_wt_and_rtc_after_relay_shutdown() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let pkg = PathBuf::from(std::env::var("AVENDB_PKG").expect("rebuilt browser package"));
    assert!(pkg.join("avendb_browser_bg.wasm").exists());
    let node = std::env::var("AVENDB_NODE").unwrap_or_else(|_| "node".into());
    let mut child = Command::new(node)
        .arg(root.join("scripts/avendb-browser-transports.mjs"))
        .current_dir(&root)
        .env("AVENDB_PKG", pkg)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(false)
        .spawn()
        .expect("local browser harness");
    let mut input = child.stdin.take().unwrap();
    let mut reports = BufReader::new(child.stdout.take().unwrap()).lines();
    let started = report(&mut reports, "listening").await;
    let origin = started["origin"].as_str().unwrap().to_owned();
    eprintln!("carrier browser: {}", started["browser"]);
    let loopback = "127.0.0.1:0".parse().unwrap();
    let admission = Admission::open();
    let mut relay = Some(Relay::spawn(loopback, admission.clone()).await.unwrap());
    let relay_url = relay.as_ref().unwrap().url();
    let mut lab = Lab::with_entropy([3; 32]);
    let me = lab.device_with("disposable carrier server", [7; 32]);
    let server = Node::spawn(
        lab,
        me,
        Options {
            bind: None,
            relay: Some(relay_url.clone()),
            admission: Some(admission.clone()),
            card: true,
            keep: true,
            ..Options::local()
        },
    )
    .await
    .unwrap();
    server
        .listen_webtransport(WtConfig {
            bind: loopback,
            public_url: "https://localhost:0/avendb".into(),
            allowed_origins: vec![origin],
        })
        .await
        .unwrap();
    command(
        &mut input,
        json!({"relay":relay_url.to_string(), "server":server.offer().to_text()}),
    )
    .await;
    let carriers = report(&mut reports, "carriers").await;
    eprintln!(
        "carrier readiness (not yet data proof): {}",
        carriers["metrics"]
    );
    let wt = carriers["wt"] == true;
    if wt {
        relay.take().unwrap().shutdown().await.unwrap();
    }
    command(&mut input, json!({"op":"write"})).await;
    let written = report(&mut reports, "written").await;
    let entry = EntryId(
        BlobId::from_hex(written["entry"].as_str().unwrap())
            .unwrap()
            .0,
    );
    eventually("fresh edit reaches native server without relay", || {
        server.read(move |lab, me| lab.fetched(me, entry) > 0)
    })
    .await;
    let file = FileRoot {
        hash: BlobId::from_hex(written["file"]["root"].as_str().unwrap())
            .unwrap()
            .0,
        size: written["file"]["size"].as_u64().unwrap(),
    };
    eventually("fresh sealed blob reaches native server", || {
        server.holds_file(file)
    })
    .await;
    if relay.is_none() {
        let socket = relay_url
            .to_string()
            .trim_start_matches("http://")
            .trim_end_matches('/')
            .parse()
            .unwrap();
        relay = Some(Relay::spawn(socket, admission.clone()).await.unwrap());
    }
    command(&mut input, json!({"op":"fallback"})).await;
    let fallback = report(&mut reports, "fallback-written").await;
    let entry = EntryId(
        BlobId::from_hex(fallback["entry"].as_str().unwrap())
            .unwrap()
            .0,
    );
    eventually(
        "fresh edit reaches native server after carrier closes",
        || server.read(move |lab, me| lab.fetched(me, entry) > 0),
    )
    .await;
    let file = FileRoot {
        hash: BlobId::from_hex(fallback["file"]["root"].as_str().unwrap())
            .unwrap()
            .0,
        size: fallback["file"]["size"].as_u64().unwrap(),
    };
    eventually(
        "fresh sealed blob reaches native server over restored relay",
        || server.holds_file(file),
    )
    .await;
    server.shutdown().await.unwrap();
    if let Some(relay) = relay.take() {
        relay.shutdown().await.unwrap();
    }
    command(&mut input, json!({"op":"offline"})).await;
    let done = report(&mut reports, "done").await;
    assert_eq!(
        done["rtc"], true,
        "browser-only fresh edit+blob continue after native server and relay stop"
    );
    eprintln!("actual fresh data after shutdown: {done}");
    assert!(child.wait().await.unwrap().success());
    assert!(
        wt,
        "this installed Chromium could not establish mandatory PQ WebTransport; relay fallback worked, RTC result above"
    );
}
