//! avenPEER's Peer-Light: the same core as wasm, in a browser's worker (SANDBOX.md, "The cast"). It is relay-only: it
//! reaches the Aven Peer through the relay it is given (in the box, the page's own origin, where Vite passes `/relay`
//! on). Like the Peer, it is configured, never built for a place: its name, its secret seed and the Aven Peer's key
//! come from the page. It keeps its data through avenDB's store, in its origin's OPFS. Every event goes to the page as a
//! timeline line. On an Aven Peer's host without a cast (PRODUCTION.md, Part A) the page makes its secret itself and
//! keeps it in OPFS, and the Peer-Light is named by its key (`device-…`); the page's statements go to the Aven Peer
//! through `send`.
//!
//! From milestone 2 it keeps the members-only door like every peer (`aven_peer::members`): the cast's members, given by
//! the page, or the members it checks itself from the statements the Aven Peer tells it. It is in the network's chat
//! room over iroh-gossip on its own `Router` (`say`, and the `chat`, `room` and `dropped` lines). A browser that is no
//! device yet brings its claim, sign-in or join to the relay as its token, so the relay lets it in for that statement:
//! the Peer-Light binds again, with the same key and name, its token set, since a relay connection keeps the token it
//! started with.
//!
//! It is the page's one WebAssembly module (Samuel, 30 Oct 2026): avenDB and avenID run inside it, and it pushes the
//! page every view of the tree as a `views` line, a snapshot stamped with the head it is correct at ([`views`]), on
//! start and whenever the tree changes. The box's own view (`localhost`), which serves no vault, loads it only for that
//! ([`views()`]). What a person's acts need computed (a passkey's texts, an invite's key) is in [`acts`].
//!
//! Files (store/README.md, "How a file travels"): it serves its store's blobs to members over iroh-blobs, and fetches
//! files by their index's hash, from the Aven Peer or another member: [`file_len`], [`file_range`] and [`file_fetch`].
//! These three are the Peer-Light's stable API for files: the chat's Service Worker calls them through the leader to
//! answer `/files/<hash>` with ranges, and the box's check calls them directly. A file or a chunk of it that the holder
//! asked says it hasn't throws an `Error` named [`NOT_FOUND`] (a 404); any other failure (no holder reached, a refusal) throws a
//! plain one (a 502).

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::ops::Range;
use std::sync::Arc;

use aven_db_core::chat::Message;
use aven_db_core::timeline;
use aven_db_core::wire::{ALPN, Frame};
use aven_db_store::blobs::{Blobs, FetchError, Shared};
use aven_db_store::{Hash, backend, files};
use aven_peer::iroh_gossip::{self, Gossip};
use aven_peer::members::{Gate, Hook};
use aven_peer::room::Room;
use aven_peer::{Notes, blobs, keys, link, now, record};
use iroh::endpoint::{Connection, presets};
use iroh::protocol::Router;
use iroh::{
    Endpoint, EndpointAddr, PublicKey, RelayConfig, RelayMap, RelayMode, RelayUrl, SecretKey,
};
use wasm_bindgen::prelude::*;

pub mod acts;
pub mod views;

/// The `name` of the `Error` the file API throws when the holder hasn't the file, or a chunk of it.
pub const NOT_FOUND: &str = "NotFoundError";

/// The page's callback for timeline lines. A browser's worker has one thread, so it is never shared across threads.
struct Page(js_sys::Function);
// SAFETY: wasm32-unknown-unknown without threads runs everything on the worker's one thread.
unsafe impl Send for Page {}
unsafe impl Sync for Page {}

fn js(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

/// Every view of a tree in the cast's JSON as `device` sees it, without starting a peer: the box's own view, which acts
/// as every person and serves none (`device` absent), runs only this. Refused when the tree is not well formed.
#[wasm_bindgen]
pub fn views(cast: &str, device: Option<String>) -> Result<String, JsError> {
    views::of_cast(cast, device.as_deref())
        .map(|v| v.to_string())
        .map_err(js)
}

/// The `views` line for `tree` (cast JSON) as the device `me` sees it, or why it has none.
fn views_line(me: &str, tree: &str) -> String {
    let fields = match views::of_cast(tree, Some(me)) {
        Ok(views) => views,
        Err(why) => serde_json::json!({ "why": why.to_string() }),
    };
    timeline::line(now(), me, "views", fields)
}

/// The page's notes, and a new snapshot of the views whenever the Aven Peer tells this device a changed tree: the
/// same tree told again (as with every invite) is no change, so no new snapshot (README rule 4).
fn pushing_views(me: String, page: Notes) -> Notes {
    let told = std::sync::Mutex::new(None::<String>);
    Arc::new(move |line: String| {
        let tree = line
            .contains("\"network\"")
            .then(|| serde_json::from_str::<serde_json::Value>(&line).ok())
            .flatten()
            .filter(|l| l["event"] == "network")
            .and_then(|l| l["tree"].as_str().map(str::to_string));
        page(line);
        if let Some(tree) = tree {
            let mut told = told.lock().unwrap_or_else(|e| e.into_inner());
            if told.as_deref() != Some(tree.as_str()) {
                page(views_line(&me, &tree));
                *told = Some(tree);
            }
        }
    })
}

/// How the page configured the Peer-Light: kept, so it can bind again with a newcomer's token.
#[derive(Clone)]
struct Config {
    name: String,
    secret: SecretKey,
    relay: RelayUrl,
    aven_key: PublicKey,
    aven_name: String,
    members: Option<String>,
    notes: Notes,
}

/// What the page's calls reach once the Peer-Light runs.
struct Running {
    outbox: futures_channel::mpsc::UnboundedSender<Frame>,
    room: Room,
    router: Router,
    files: Files,
}

/// What fetching a file takes: the endpoint, the store and iroh-blobs on it, and where the Aven Peer is.
#[derive(Clone)]
struct Files {
    endpoint: Endpoint,
    store: Shared,
    held: Blobs,
    aven: EndpointAddr,
    relay: RelayUrl,
}

thread_local! {
    static CONFIG: RefCell<Option<Config>> = const { RefCell::new(None) };
    static RUNNING: RefCell<Option<Running>> = const { RefCell::new(None) };
    /// Which binding is current: a closed one's watcher falls silent.
    static BOUND: Cell<u32> = const { Cell::new(0) };
    /// Whether the relay lets this browser in, as it last said.
    static ADMITTED: Cell<Option<bool>> = const { Cell::new(None) };
    /// Whether a newcomer's statement waits on the relay: a refusal of this browser is then that statement's.
    static PENDING: Cell<bool> = const { Cell::new(false) };
    /// A connection on iroh-blobs' protocol to each peer files came from, kept while it is open.
    static CONNECTIONS: RefCell<HashMap<PublicKey, Connection>> = RefCell::new(HashMap::new());
}

fn running<T>(f: impl FnOnce(&Running) -> Result<T, JsError>) -> Result<T, JsError> {
    RUNNING.with(|r| match r.borrow().as_ref() {
        Some(running) => f(running),
        None => Err(JsError::new("the Peer-Light has not started")),
    })
}

/// Sends the page's statement (a frame as JSON) to the Aven Peer, once the link is up: a claim, a sign-in, an invite,
/// a withdrawal or a join. A claim, a sign-in or a join from a browser the relay doesn't let in becomes its relay token:
/// the Peer-Light binds again with it, and sends it on the new link.
#[wasm_bindgen]
pub fn send(frame: String) -> Result<(), JsError> {
    let frame: Frame = serde_json::from_str(&frame).map_err(js)?;
    let newcomer = matches!(
        frame,
        Frame::Claim { .. } | Frame::SignIn { .. } | Frame::Join { .. }
    );
    if !newcomer && !matches!(frame, Frame::Invite { .. } | Frame::Withdraw { .. }) {
        return Err(JsError::new("a page sends only a statement"));
    }
    if newcomer && ADMITTED.get() != Some(true) {
        PENDING.set(true);
        let token = aven_peer::token(&frame);
        wasm_bindgen_futures::spawn_local(async move {
            if let Some(old) = RUNNING.take() {
                let _ = old.router.shutdown().await;
            }
            let bound = bind(Some(token)).await;
            let sent = bound.and_then(|()| running(|r| r.outbox.unbounded_send(frame).map_err(js)));
            if let (Err(e), Some(config)) = (sent, CONFIG.with(|c| c.borrow().clone())) {
                let why = serde_json::json!({ "why": format!("{e:?}") });
                (config.notes)(timeline::line(now(), &config.name, "failed", why));
            }
        });
        return Ok(());
    }
    running(|r| r.outbox.unbounded_send(frame).map_err(js))
}

/// Says a line in the network's chat room.
#[wasm_bindgen]
pub fn say(text: String) -> Result<(), JsError> {
    running(|r| {
        let room = r.room.clone();
        wasm_bindgen_futures::spawn_local(async move { room.say(text).await });
        Ok(())
    })
}

/// Sends a chat message as it is (JSON), unchecked here: every other peer checks it. The box's check sends one signed
/// by a key that is no member's this way (MILESTONE2.md, "How it is checked", 5).
#[wasm_bindgen]
pub fn post(message: String) -> Result<(), JsError> {
    let m: Message = serde_json::from_str(&message).map_err(js)?;
    running(|r| {
        let room = r.room.clone();
        wasm_bindgen_futures::spawn_local(async move {
            room.post(&m).await;
        });
        Ok(())
    })
}

/// Tells the page whether the relay lets this browser in (`door` lines): a stranger's page learns it is invite only
/// this way, since no peer answers it. A statement the relay refused is `refused`, as the Aven Peer's refusals are.
fn door(endpoint: &Endpoint, bound: u32, name: String, notes: Notes) {
    use aven_peer::n0_future::StreamExt;
    use iroh::Watcher;
    let mut statuses = endpoint.home_relay_status().stream();
    wasm_bindgen_futures::spawn_local(async move {
        let mut told = None;
        while let Some(all) = statuses.next().await {
            if BOUND.get() != bound {
                break;
            }
            let denied = all
                .iter()
                .find_map(|s| s.auth_denied_reason().map(str::to_string));
            let admitted = match &denied {
                Some(_) => Some(false),
                None if all.iter().any(|s| s.is_connected()) => Some(true),
                None => None,
            };
            if admitted.is_none() || admitted == told {
                continue;
            }
            told = admitted;
            ADMITTED.set(admitted);
            notes(timeline::line(
                now(),
                &name,
                "door",
                serde_json::json!({ "admitted": admitted, "why": denied }),
            ));
            if admitted == Some(false) && PENDING.replace(false) {
                let why = "the network did not take this browser's statement: invite only";
                notes(timeline::line(
                    now(),
                    &name,
                    "refused",
                    serde_json::json!({ "why": why }),
                ));
            }
            if admitted == Some(true) {
                PENDING.set(false);
            }
        }
    });
}

// This worker's store, in this origin's OPFS under `/store/`, opened once: the one writer holds its handles until the
// worker ends (store/README.md, the opfs driver). The crate also builds natively, for the workspace's tests; there it
// has no OPFS, and keeps its store in memory.
thread_local! {
    static STORE: RefCell<Option<Shared>> = const { RefCell::new(None) };
}

async fn store() -> Result<(Shared, &'static str), JsError> {
    if let Some(s) = STORE.with(|s| s.borrow().clone()) {
        return Ok((s, KIND));
    }
    #[cfg(target_arch = "wasm32")]
    #[allow(clippy::arc_with_non_send_sync)]
    let s: Shared = Arc::new(backend::opfs("/store/").await.map_err(js)?);
    #[cfg(not(target_arch = "wasm32"))]
    let s: Shared = Arc::new(backend::memory().map_err(js)?);
    STORE.with(|kept| *kept.borrow_mut() = Some(s.clone()));
    Ok((s, KIND))
}

#[cfg(target_arch = "wasm32")]
const KIND: &str = "opfs";
#[cfg(not(target_arch = "wasm32"))]
const KIND: &str = "memory";

/// This browser's device secret (PRODUCTION.md, Part A), kept in its store under the ref `device-key`: the one there,
/// or else `candidate` (the page's: an older Peer-Light's file in OPFS, or new random bytes), stored now. Returns the
/// secret the Peer-Light goes by.
#[wasm_bindgen(js_name = deviceSecret)]
pub async fn device_secret(candidate: String) -> Result<String, JsError> {
    use aven_db_store::RefName;
    let (store, _) = store().await?;
    let name = RefName::new("device-key").map_err(js)?;
    if let Some(blob) = store.get_ref(&name).await.map_err(js)? {
        let bytes = store
            .get(&blob)
            .await
            .map_err(js)?
            .ok_or_else(|| JsError::new("device-key points at a missing blob"))?;
        return String::from_utf8(bytes.to_vec()).map_err(js);
    }
    keys::secret(&candidate).map_err(js)?;
    let blob = store
        .put(candidate.clone().into_bytes().into())
        .await
        .map_err(js)?;
    store.set_ref(&name, None, blob).await.map_err(js)?;
    Ok(candidate)
}

/// Starts the Peer-Light `name` with its secret seed (hex), linking through `relay` to the Aven Peer (`aven_key`,
/// called `aven_name` in the timeline), and tells `notes` every event. Without a name it goes by its key's device id.
/// In the box's cast, `members` lists the cast's members (`name=key,…`); without them it learns the members from the
/// Aven Peer's statements. In the box, `cast` is the cast's tree, whose views it pushes at once; without one they
/// follow the network's tree as the Aven Peer tells it. Returns once the endpoint is bound; the link and the room run
/// on.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub async fn start(
    name: String,
    secret: String,
    relay: String,
    aven_key: String,
    aven_name: String,
    notes: js_sys::Function,
    members: Option<String>,
    cast: Option<String>,
) -> Result<(), JsError> {
    let page = Page(notes);
    let notes: Notes = Arc::new(move |line: String| {
        let _ = page.0.call1(&JsValue::NULL, &JsValue::from_str(&line));
    });
    let secret = keys::secret(&secret).map_err(js)?;
    let name = if name.is_empty() {
        aven_id::device_id(&secret.public().to_string())
    } else {
        name
    };
    let notes = pushing_views(name.clone(), notes);
    if let Some(cast) = &cast {
        notes(views_line(&name, cast));
    }
    let config = Config {
        name,
        secret,
        relay: relay.parse().map_err(js)?,
        aven_key: keys::public(&aven_key).map_err(js)?,
        aven_name,
        members,
        notes,
    };
    CONFIG.with(|c| *c.borrow_mut() = Some(config));
    bind(None).await
}

/// Binds the Peer-Light's endpoint, with a newcomer's relay token if it has one, and runs its link and room on it.
async fn bind(token: Option<String>) -> Result<(), JsError> {
    let Config {
        name,
        secret,
        relay,
        aven_key,
        aven_name,
        members,
        notes,
    } = CONFIG
        .with(|c| c.borrow().clone())
        .ok_or_else(|| JsError::new("the Peer-Light has not started"))?;
    let bound = BOUND.get() + 1;
    BOUND.set(bound);
    ADMITTED.set(None);
    // the door as this browser knows it: the Aven Peer, and the cast's members or, later, the statements' members
    let gate = Gate::default();
    let cast = keys::Members::parse(members.as_deref().unwrap_or_default()).map_err(js)?;
    let known = cast.keys().chain([(aven_key, aven_name.clone())]);
    gate.set(known.map(|(k, n)| (k, n, None)).collect::<Vec<_>>());
    let relays = match &token {
        Some(token) => {
            RelayMap::from(RelayConfig::from(relay.clone()).with_auth_token(token.clone()))
        }
        None => RelayMap::from(relay.clone()),
    };
    let endpoint = Endpoint::builder(presets::Minimal)
        .secret_key(secret.clone())
        .relay_mode(RelayMode::Custom(relays))
        .alpns(vec![ALPN.to_vec(), iroh_gossip::ALPN.to_vec(), blobs::ALPN.to_vec()])
        .hooks(Hook {
            me: name.clone(),
            gate: gate.clone(),
            notes: notes.clone(),
        })
        .bind()
        .await
        .map_err(js)?;
    door(&endpoint, bound, name.clone(), notes.clone());
    notes(timeline::line(
        now(),
        &name,
        "started",
        serde_json::json!({ "key": endpoint.id().to_string(), "relay": relay.to_string(), "newcomer": token.is_some() }),
    ));
    // the one record it keeps, in this origin's OPFS: its first start, found again after a reload
    let (store, kind) = store().await?;
    let kept = record::first_start(&*store, &name, now())
        .await
        .map_err(js)?;
    notes(record::line(now(), &name, kind, &kept));
    let aven = EndpointAddr::new(aven_key).with_relay_url(relay.clone());
    aven_peer::know(&endpoint, aven.clone());
    let held = Blobs::new(store.clone());
    let gossip = Gossip::builder().spawn(endpoint.clone());
    let router = Router::builder(endpoint.clone())
        .accept(iroh_gossip::ALPN, gossip.clone())
        .accept(blobs::ALPN, blobs::provider(&held, name.clone(), gate.clone(), notes.clone()))
        .spawn();
    let files = Files { endpoint: endpoint.clone(), store, held, aven: aven.clone(), relay: relay.clone() };
    let room = Room::join(
        &gossip,
        name.clone(),
        "aven",
        secret,
        gate.clone(),
        vec![aven_key],
        notes.clone(),
    )
    .await
    .map_err(js)?;
    let (outbox, frames) = futures_channel::mpsc::unbounded();
    // the cast's members are configuration; without a cast the statements say who they are
    let learns = members.is_none().then_some(gate);
    RUNNING.with(|r| {
        *r.borrow_mut() = Some(Running {
            outbox,
            room,
            router,
            files,
        })
    });
    wasm_bindgen_futures::spawn_local(link::run(
        endpoint,
        name,
        link::fixed(aven),
        aven_name,
        notes,
        Some(frames),
        learns,
    ));
    Ok(())
}

/// A connection on iroh-blobs' protocol to `from` (a member's key, hex), or to the Aven Peer: one kept while it is open.
async fn connection(f: &Files, from: Option<String>) -> Result<Connection, JsValue> {
    let at = match from {
        Some(key) => EndpointAddr::new(keys::public(&key).map_err(js)?).with_relay_url(f.relay.clone()),
        None => f.aven.clone(),
    };
    let open = CONNECTIONS.with(|c| c.borrow().get(&at.id).filter(|c| c.close_reason().is_none()).cloned());
    if let Some(conn) = open {
        return Ok(conn);
    }
    let conn = f.endpoint.connect(at.clone(), blobs::ALPN).await.map_err(js)?;
    CONNECTIONS.with(|c| c.borrow_mut().insert(at.id, conn.clone()));
    Ok(conn)
}

/// The file's index, fetched if this Peer-Light hasn't it; and the bytes that crossed for it.
async fn open(f: &Files, file: &Hash, from: Option<String>) -> Result<(files::File, u64), JsValue> {
    if let Some(found) = files::open(&*f.store, file).await.map_err(js)? {
        return Ok((found, 0));
    }
    let conn = connection(f, from).await?;
    let fetched = f.held.fetch_chunks(&conn, *file, 0..0).await.map_err(fetch_error)?;
    let found = files::open(&*f.store, file).await.map_err(js)?.ok_or_else(|| JsError::new("no such file"))?;
    Ok((found, fetched.bytes))
}

/// The chunks of `range` this Peer-Light lacks, fetched; the bytes that crossed.
async fn chunks(f: &Files, file: &files::File, range: Range<u64>, from: Option<String>) -> Result<u64, JsValue> {
    let missing = file.missing(&*f.store, range).await.map_err(js)?;
    let (Some(first), Some(last)) = (missing.first(), missing.last()) else {
        return Ok(0);
    };
    let conn = connection(f, from).await?;
    Ok(f.held.fetch_chunks(&conn, file.name, *first..*last + 1).await.map_err(fetch_error)?.bytes)
}

/// A fetch's failure for the page: [`NOT_FOUND`] when the holder hasn't the file or a chunk of it (a Service Worker's
/// 404), a plain error otherwise (its 502).
fn fetch_error(e: FetchError) -> JsValue {
    let error = js_sys::Error::new(&e.to_string());
    if matches!(e, FetchError::NotFound(_)) {
        error.set_name(NOT_FOUND);
    }
    error.into()
}

fn running_files() -> Result<Files, JsError> {
    running(|r| Ok(r.files.clone()))
}

fn object(fields: &[(&str, JsValue)]) -> JsValue {
    let o = js_sys::Object::new();
    for (k, v) in fields {
        let _ = js_sys::Reflect::set(&o, &JsValue::from_str(k), v);
    }
    o.into()
}

fn hash(file: &str) -> Result<Hash, JsError> {
    file.parse().map_err(js)
}

/// A file's length in bytes, by its name (its index's hash, hex): its index is fetched from `from` (a member's key,
/// hex) or the Aven Peer if this Peer-Light hasn't it.
#[wasm_bindgen]
pub async fn file_len(file: String, from: Option<String>) -> Result<f64, JsValue> {
    let f = running_files()?;
    Ok(open(&f, &hash(&file)?, from).await?.0.len as f64)
}

/// A file's bytes `start..end`, read from this Peer-Light's store: the chunks they lie in that it lacks are fetched
/// first, from `from` or the Aven Peer, each checked whole. `{bytes: Uint8Array, len, fetched}`, where `fetched` is the
/// bytes that crossed for this call. A seek is a range: a movie played from its middle fetches only the chunks it
/// plays.
#[wasm_bindgen]
pub async fn file_range(file: String, start: f64, end: f64, from: Option<String>) -> Result<JsValue, JsValue> {
    let f = running_files()?;
    let (found, mut fetched) = open(&f, &hash(&file)?, from.clone()).await?;
    let range = start as u64..(end as u64).min(found.len);
    fetched += chunks(&f, &found, range.clone(), from).await?;
    let bytes = found.read(&*f.store, range).await.map_err(js)?.ok_or_else(|| JsError::new("a chunk went missing"))?;
    Ok(object(&[
        ("bytes", js_sys::Uint8Array::from(&bytes[..]).into()),
        ("len", (found.len as f64).into()),
        ("fetched", (fetched as f64).into()),
    ]))
}

/// The whole file into this Peer-Light's store, from `from` or the Aven Peer: only what it lacks crosses.
/// `{len, fetched, chunks}`.
#[wasm_bindgen]
pub async fn file_fetch(file: String, from: Option<String>) -> Result<JsValue, JsValue> {
    let f = running_files()?;
    let (found, mut fetched) = open(&f, &hash(&file)?, from.clone()).await?;
    fetched += chunks(&f, &found, 0..found.len, from).await?;
    let missing = found.missing(&*f.store, 0..found.len).await.map_err(js)?;
    if !missing.is_empty() {
        return Err(JsError::new(&format!("{} chunks still missing", missing.len())).into());
    }
    Ok(object(&[
        ("len", (found.len as f64).into()),
        ("fetched", (fetched as f64).into()),
        ("chunks", (found.chunks.len() as f64).into()),
    ]))
}
