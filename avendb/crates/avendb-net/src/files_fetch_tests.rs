use super::*;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::task::{Context, Poll};

use avendb::cast::{handbook, world};
use avendb::sign::Hello;
use avendb::wire::Wire;
use iroh::{Endpoint, SecretKey, endpoint::presets};

struct Tracked<S> {
    inner: Pin<Box<S>>,
    dropped: Arc<AtomicBool>,
}
impl<S: Stream> Stream for Tracked<S> {
    type Item = S::Item;
    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.inner.as_mut().poll_next(cx)
    }
}
impl<S> Drop for Tracked<S> {
    fn drop(&mut self) { self.dropped.store(true, Ordering::SeqCst); }
}

#[tokio::test(start_paused = true)]
async fn an_idle_provider_is_dropped_not_left_downloading() {
    let dropped = Arc::new(AtomicBool::new(false));
    let stream = Tracked { inner: Box::pin(stream::pending::<GetProgressItem>()), dropped: dropped.clone() };
    let start = time::Instant::now();
    assert!(receive_file(stream, time::Duration::from_secs(5)).await.is_err());
    assert_eq!(start.elapsed(), time::Duration::from_secs(5));
    assert!(dropped.load(Ordering::SeqCst));
}

#[tokio::test(start_paused = true)]
async fn progressing_files_outlive_the_idle_window() {
    let stream = stream::iter(1..=6).then(|n| async move {
        time::sleep(time::Duration::from_secs(4)).await;
        if n == 6 { GetProgressItem::Done(Default::default()) }
        else { GetProgressItem::Progress(n * 16384) }
    });
    let start = time::Instant::now();
    receive_file(stream, time::Duration::from_secs(5)).await.unwrap();
    assert_eq!(start.elapsed(), time::Duration::from_secs(24), "no fixed whole-file deadline");
}

#[tokio::test(start_paused = true)]
async fn duplicate_progress_does_not_extend_a_stalled_provider() {
    let stream = stream::iter([16, 16, 8, 16, 16, 16, 16, 16]).then(|n| async move {
        time::sleep(time::Duration::from_secs(1)).await;
        GetProgressItem::Progress(n)
    });
    let start = time::Instant::now();
    assert!(receive_file(stream, time::Duration::from_secs(3)).await.is_err());
    assert_eq!(start.elapsed(), time::Duration::from_secs(4), "only the first advance resets the deadline");
}

#[tokio::test]
async fn cancelling_a_file_read_drops_its_receive_future() {
    let dropped = Arc::new(AtomicBool::new(false));
    let stream = Tracked { inner: Box::pin(stream::pending::<GetProgressItem>()), dropped: dropped.clone() };
    let reading = tokio::spawn(receive_file(stream, FILE_IDLE));
    tokio::task::yield_now().await;
    reading.abort();
    assert!(reading.await.unwrap_err().is_cancelled());
    assert!(dropped.load(Ordering::SeqCst));
}

/// The real production provider loop: the first authenticated peer keeps its blob stream open without replying,
/// while the second serves through the unchanged authorization gate. The timed-out stream receives STOP_SENDING;
/// the healthy peer fills the local store and the normal file reader verifies and opens the exact plaintext.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stalled_file_provider_yields_to_an_authorized_peer() {
    let mut w = world();
    let h = handbook(&mut w);
    let (mac, phone, raw_device, passkey) = (w.mac_a, w.phone_a, w.server, w.passkey_a);
    let opts = || crate::Options { lazy: true, ..crate::Options::local() };
    let mac = Node::spawn(w.lab.split(mac, &[passkey], [221; 32]), mac, opts()).await.unwrap();
    let phone = Node::spawn(w.lab.split(phone, &[], [222; 32]), phone, opts()).await.unwrap();
    let expected: Vec<u8> = (0..90_000).map(|i| (i % 251) as u8).collect();
    let source = expected.clone();
    let brought = mac.store_file(source.len() as u64, move || stream::iter([Ok(Bytes::from(source.clone()))])).await.unwrap();
    let root = brought.root;
    let (coop, entry) = (h.coop, h.welcome);
    mac.try_act(move |lab, me| lab.bring(me, coop, entry, vec![brought], |_| {})).await.unwrap().unwrap();
    phone.try_know(mac.addr()).unwrap();
    phone.sync_with(mac.id()).await.unwrap();
    assert!(phone.read(move |lab, me| lab.file(me, &root).is_some()).await);

    let raw = Endpoint::builder(presets::Empty)
        .secret_key(SecretKey::from_bytes(&w.lab.endpoint_secret(raw_device).unwrap()))
        .crypto_provider(crate::pq_provider()).clear_ip_transports()
        .alpns(vec![iroh_blobs::ALPN.to_vec()]).bind_addr("127.0.0.1:0").unwrap().bind().await.unwrap();
    let sync = raw.connect(phone.addr(), crate::ALPN).await.unwrap();
    let drawn = crate::session::exporter(&sync).unwrap();
    let (mut send, mut recv) = sync.open_bi().await.unwrap();
    send.write_all(&w.lab.hello(raw_device, &drawn, true).unwrap().to_wire()).await.unwrap();
    send.finish().unwrap();
    let hello = Hello::from_wire(&recv.read_to_end(64 << 10).await.unwrap()).unwrap();
    assert_eq!(hello.verify(&drawn, false, phone.id().as_bytes()), Some(phone.device()));
    time::timeout(time::Duration::from_secs(5), async {
        while phone.shared.live(raw.id()).is_none() { tokio::task::yield_now().await; }
    }).await.unwrap();
    phone.try_know(raw.addr()).unwrap();
    let endpoint = raw.clone();
    let requested = Arc::new(AtomicBool::new(false));
    let seen = requested.clone();
    let provider = tokio::spawn(async move {
        let conn = endpoint.accept().await.unwrap().await.unwrap();
        let (send, mut recv) = conn.accept_bi().await.unwrap();
        assert!(!recv.read_to_end(4096).await.unwrap().is_empty());
        seen.store(true, Ordering::SeqCst);
        // Keep the connection live: only cancelling this request should end the silent stream.
        send.stopped().await.unwrap()
    });
    let request = GetRequest::blob(Hash::from_bytes(root.hash));
    time::timeout(time::Duration::from_secs(10), phone.shared.get_from(request, || vec![raw.id(), mac.id()], time::Duration::from_millis(150)))
        .await.unwrap().unwrap();
    assert!(requested.load(Ordering::SeqCst), "the stalled peer was actually tried first");
    assert!(time::timeout(time::Duration::from_secs(5), provider).await.unwrap().unwrap().is_some(),
        "the cancelled request stops its peer's response stream");
    assert!(sync.close_reason().is_none(), "a file timeout does not destroy the authenticated sync connection");
    assert_eq!(phone.read_file(root, 0..expected.len() as u64).await.unwrap(), expected);
    phone.shutdown().await.unwrap();
    mac.shutdown().await.unwrap();
    raw.close().await;
}
