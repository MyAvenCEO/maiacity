//! The spike's measurement, in the box: Alice Peer's endpoint (direct and relay) serves a file from its store, a
//! relay-only endpoint with the Peer-Light's key fetches it through the Aven Peer's relay, both in this process. Each
//! way, (a) iroh-blobs and (b) bao-tree: the whole file, then a seek to its middle cold (index and one chunk) and warm
//! (the index held). Prints one JSON line per measurement, with Alice's store requests counted as S3's would be.
//!
//! Configuration by environment: SPIKE_SIZE (bytes, 1 GiB), SPIKE_STORE (fs, s3 or memory), SPIKE_STORE_PATH,
//! SPIKE_S3_ENDPOINT, SPIKE_S3_BUCKET, SPIKE_S3_ROOT, SPIKE_S3_KEY, SPIKE_S3_SECRET, SPIKE_RELAY_URL,
//! SPIKE_ALICE_SECRET, SPIKE_LIGHT_SECRET (hex seeds), SPIKE_WAYS (ab), SPIKE_PARALLEL (b's requests in flight, 4).

use std::sync::Arc;
use std::time::Instant;

use aven_db_store::backend;
use aven_db_store::{RefName, Store};
use aven_store_spike::count::Counted;
use aven_store_spike::{adapter, bao, files};
use bao_tree::ChunkRanges;
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, RelayMap, RelayMode, RelayUrl, SecretKey};
use iroh_blobs::protocol::GetRequest;
use iroh_blobs::{BlobsProtocol, HashAndFormat};

type Error = Box<dyn std::error::Error + Send + Sync>;

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn need(name: &str) -> Result<String, Error> {
    env(name).ok_or_else(|| format!("{name} is required").into())
}

fn secret(hex: &str) -> Result<SecretKey, Error> {
    let bytes: Vec<u8> = (0..32).map(|i| u8::from_str_radix(&hex[2 * i..2 * i + 2], 16)).collect::<Result<_, _>>()?;
    Ok(SecretKey::from_bytes(&bytes.try_into().unwrap()))
}

fn store() -> Result<backend::DalStore, Error> {
    Ok(match env("SPIKE_STORE").as_deref().unwrap_or("memory") {
        "memory" => backend::memory()?,
        "fs" => {
            let dir = need("SPIKE_STORE_PATH")?;
            std::fs::create_dir_all(&dir)?;
            backend::fs(std::path::Path::new(&dir))?
        }
        "s3" => backend::s3(&backend::S3 {
            endpoint: need("SPIKE_S3_ENDPOINT")?,
            region: "us-east-1".into(),
            bucket: need("SPIKE_S3_BUCKET")?,
            root: env("SPIKE_S3_ROOT").unwrap_or("/spike/".into()),
            access_key_id: need("SPIKE_S3_KEY")?,
            secret_access_key: need("SPIKE_S3_SECRET")?,
            conditions: backend::Conditions::Off,
        })?,
        other => return Err(format!("SPIKE_STORE {other}").into()),
    })
}

fn line(what: &str, fields: String) {
    println!("{{\"what\":\"{what}\",{fields}}}");
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    let size: u64 = env("SPIKE_SIZE").map_or(Ok(1 << 30), |s| s.parse())?;
    let relay: RelayUrl = need("SPIKE_RELAY_URL")?.parse()?;
    let ways = env("SPIKE_WAYS").unwrap_or("ab".into());
    let parallel: usize = env("SPIKE_PARALLEL").map_or(Ok(4), |s| s.parse())?;

    // Alice's store and the file in it, made once
    let alice_store = Arc::new(Counted::new(store()?));
    let name = RefName::new("spike-file").map_err(|e| e.to_string())?;
    let key = format!("spike-file-{size}");
    let name = RefName::new(&key).unwrap_or(name);
    let file = match alice_store.get_ref(&name).await? {
        Some(h) => h,
        None => {
            let t = Instant::now();
            let h = files::put(&(alice_store.clone() as adapter::Shared), files::random(&key, size)).await?;
            alice_store.set_ref(&name, None, h).await?;
            line("made", format!("\"ms\":{}", t.elapsed().as_millis()));
            h
        }
    };
    alice_store.take();
    let shared: adapter::Shared = alice_store.clone();
    let chunks = files::chunks(&alice_store.get(&file).await?.ok_or("no index")?).len() as u64;
    alice_store.take();
    let middle = chunks / 2;
    line("file", format!("\"index\":\"{file}\",\"size\":{size},\"chunks\":{chunks}"));

    let relays = RelayMode::Custom(RelayMap::from(relay.clone()));
    let alice = Endpoint::builder(presets::Minimal)
        .secret_key(secret(&need("SPIKE_ALICE_SECRET")?)?)
        .relay_mode(relays.clone())
        .alpns(vec![iroh_blobs::ALPN.to_vec(), bao::ALPN.to_vec()])
        .bind()
        .await?;
    let router = Router::builder(alice.clone())
        .accept(iroh_blobs::ALPN, BlobsProtocol::new(&adapter::blobs(shared.clone()), None))
        .accept(bao::ALPN, bao::Serve::new(shared.clone()))
        .spawn();
    alice.online().await;
    // the Peer-Light: relay only, as in a browser
    let light = Endpoint::builder(presets::Minimal)
        .secret_key(secret(&need("SPIKE_LIGHT_SECRET")?)?)
        .relay_mode(relays)
        .clear_ip_transports()
        .bind()
        .await?;
    light.online().await;
    let at = EndpointAddr::new(alice.id()).with_relay_url(relay);

    let report = |what: &str, t: Instant, bytes: u64| {
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        let (gets, heads, _, read) = alice_store.take();
        line(
            what,
            format!(
                "\"ms\":{ms:.1},\"bytes\":{bytes},\"MBps\":{:.1},\"gets\":{gets},\"heads\":{heads},\"readMB\":{:.1}",
                bytes as f64 / 1e6 / (ms / 1000.0),
                read as f64 / 1e6
            ),
        );
    };

    if ways.contains('a') {
        let conn = light.connect(at.clone(), iroh_blobs::ALPN).await?;
        line("path", format!("\"way\":\"a\",\"relay\":{}", is_relay(&conn)));
        alice_store.take();
        // the whole file
        let mine: adapter::Shared = Arc::new(backend::memory()?);
        let blobs = adapter::blobs(mine.clone());
        let t = Instant::now();
        blobs.remote().fetch(conn.clone(), HashAndFormat::hash_seq(iroh(file))).await?;
        report("a.whole", t, size);
        check(&mine, file).await?;
        // a seek, cold: the index and the middle chunk
        let mine: adapter::Shared = Arc::new(backend::memory()?);
        let blobs = adapter::blobs(mine.clone());
        let t = Instant::now();
        let req = GetRequest::builder().root(ChunkRanges::all()).child(middle, ChunkRanges::all()).build(iroh(file));
        blobs.remote().execute_get(conn.clone(), req).await?;
        report("a.seek-cold", t, files::CHUNK as u64);
        // and warm: the index held, a chunk further on
        let t = Instant::now();
        let req = GetRequest::builder().child(middle + 7, ChunkRanges::all()).build(iroh(file));
        blobs.remote().execute_get(conn.clone(), req).await?;
        report("a.seek-warm", t, files::CHUNK as u64);
        let held = mine.list().await?.len();
        line("a.held", format!("\"blobs\":{held}"));
        conn.close(0u32.into(), b"done");
    }

    if ways.contains('b') {
        let conn = light.connect(at.clone(), bao::ALPN).await?;
        line("path", format!("\"way\":\"b\",\"relay\":{}", is_relay(&conn)));
        alice_store.take();
        let mine: adapter::Shared = Arc::new(backend::memory()?);
        let t = Instant::now();
        let index = bao::get_blob(&conn, &mine, file).await?;
        let list = files::chunks(&index);
        let mut next = list.iter();
        let mut flight = n0_future::FuturesUnordered::new();
        loop {
            while flight.len() < parallel {
                let Some(h) = next.next() else { break };
                let (conn, mine) = (conn.clone(), mine.clone());
                flight.push(async move { bao::get_blob(&conn, &mine, *h).await });
            }
            match n0_future::StreamExt::next(&mut flight).await {
                Some(r) => {
                    r?;
                }
                None => break,
            }
        }
        report("b.whole", t, size);
        check(&mine, file).await?;
        let mine: adapter::Shared = Arc::new(backend::memory()?);
        let t = Instant::now();
        let index = bao::get_blob(&conn, &mine, file).await?;
        let list = files::chunks(&index);
        bao::get_blob(&conn, &mine, list[middle as usize]).await?;
        report("b.seek-cold", t, files::CHUNK as u64);
        let t = Instant::now();
        bao::get_blob(&conn, &mine, list[middle as usize + 7]).await?;
        report("b.seek-warm", t, files::CHUNK as u64);
        conn.close(0u32.into(), b"done");
    }

    router.shutdown().await?;
    light.close().await;
    Ok(())
}

fn iroh(h: aven_db_store::Hash) -> iroh_blobs::Hash {
    iroh_blobs::Hash::from_bytes(*h.as_bytes())
}

/// Whether the connection's path runs through the relay.
fn is_relay(conn: &iroh::endpoint::Connection) -> bool {
    let paths = format!("{:?}", conn.paths());
    paths.contains("relay:") && !paths.contains("ip:")
}

/// Every chunk the index lists is held, whole.
async fn check(store: &adapter::Shared, file: aven_db_store::Hash) -> Result<(), Error> {
    let index = store.get(&file).await?.ok_or("index missing")?;
    for h in files::chunks(&index) {
        if !store.has(&h).await? {
            return Err(format!("chunk {h} missing").into());
        }
    }
    Ok(())
}
