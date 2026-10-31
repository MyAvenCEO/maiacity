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
//! Offline first (README rule 3; `aven_peer::link::recall`): on an Aven Peer's host it keeps the network it was told in
//! its store and reads it back at start, every statement checked again, so a returning browser pushes its views and
//! opens its chat with its history before any link is up. A newcomer's statement (a claim, a sign-in or a join) is kept
//! in its store as soon as the page signs it, and sent once the link is up, after a reload too: a `pending` line says
//! so until the network takes it. [`wake`] makes the link dial again at once when the page comes back online or into
//! view.
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
use aven_db_store::blobs::{Blobs, FetchError, Fetched, Shared};
use aven_db_store::{Hash, backend, files};
use aven_peer::chats::Chats;
use aven_peer::iroh_gossip::{self, Gossip};
use aven_peer::members::{Gate, Hook};
use aven_peer::room::Room;
use aven_peer::{Notes, blobs, keys, link, now, record};
use aven_runtimes_registry as registry;
use iroh::endpoint::{Connection, presets};
use iroh::protocol::Router;
use iroh::{
    Endpoint, EndpointAddr, PublicKey, RelayConfig, RelayMap, RelayMode, RelayUrl, SecretKey,
};
use wasm_bindgen::prelude::*;

pub mod acts;
pub mod views;

/// The `name` of the `Error` the file API throws when the holder hasn't the file, or a chunk of it, or what it holds
/// under that hash is no file.
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
/// same tree told again (as with every invite) is no change, so no new snapshot (README rule 4). A tree it kept, told
/// before any link, is one too; and once the Aven Peer tells no tree after one was shown (its store wiped in the box,
/// so the network unclaimed, or this browser no device of it), the snapshot is empty: the page shows no vault it kept.
fn pushing_views(me: String, page: Notes) -> Notes {
    let told = std::sync::Mutex::new(None::<String>);
    Arc::new(move |line: String| {
        let network = line
            .contains("\"network\"")
            .then(|| serde_json::from_str::<serde_json::Value>(&line).ok())
            .flatten()
            .filter(|l| l["event"] == "network");
        page(line);
        let Some(network) = network else { return };
        let mut told = told.lock().unwrap_or_else(|e| e.into_inner());
        match network["tree"].as_str() {
            Some(tree) if told.as_deref() != Some(tree) => {
                page(views_line(&me, tree));
                *told = Some(tree.to_string());
            }
            None if told.is_some() && network["kept"].is_null() => {
                let empty = serde_json::json!({ "at": null, "device": me, "accounts": [], "keys": {}, "vaults": [] });
                page(timeline::line(now(), &me, "views", empty));
                *told = None;
            }
            _ => {}
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
    /// files a retraction took: /files/<hash> answers them as gone, and no one is asked for them
    withheld: aven_db_store::withhold::Withheld,
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
    /// Whether the network this browser keeps has it among its devices already.
    static MEMBER: Cell<bool> = const { Cell::new(false) };
    /// What wakes the current binding's link.
    static WAKE: RefCell<Option<futures_channel::mpsc::UnboundedSender<()>>> = const { RefCell::new(None) };
}

/// Files this device shared since it started, for its "sending to the network": each chunk's file, and per file its
/// size, the chunks its provider has served and their bytes (README rule 8: pushed as `sending` lines).
#[derive(Default)]
struct Sending {
    chunk: HashMap<Hash, Hash>,
    files: HashMap<Hash, (u64, std::collections::HashSet<Hash>, u64)>,
}

static SENDING: std::sync::LazyLock<std::sync::Mutex<Sending>> =
    std::sync::LazyLock::new(Default::default);

/// A chunk this device served: when it is a chunk of a file it shared, how much of that file has gone out.
fn served(me: &str, notes: &Notes, chunk: Hash, len: u64) {
    let told = {
        let mut sending = SENDING.lock().unwrap_or_else(|e| e.into_inner());
        let Some(file) = sending.chunk.get(&chunk).copied() else {
            return;
        };
        let Some((size, chunks, sent)) = sending.files.get_mut(&file) else {
            return;
        };
        if !chunks.insert(chunk) {
            return;
        }
        *sent += len;
        (file, *sent, *size)
    };
    let (file, sent, size) = told;
    notes(timeline::line(
        now(),
        me,
        "sending",
        serde_json::json!({ "file": file.to_hex(), "sent": sent, "size": size }),
    ));
}

/// The ref a newcomer's statement waits under, as the frame's JSON, until the network takes it or refuses it.
const PENDING_REF: &str = "statement";

fn pending_ref() -> aven_db_store::RefName {
    aven_db_store::RefName::new(PENDING_REF).expect("a fixed ref name is valid")
}

/// Keeps a newcomer's statement (the frame's JSON) in the store, in place of any before it.
async fn keep_pending(frame: &str) -> Result<(), JsError> {
    let (store, _) = store().await?;
    let blob = store
        .put(frame.as_bytes().to_vec().into())
        .await
        .map_err(js)?;
    let current = store.get_ref(&pending_ref()).await.map_err(js)?;
    store
        .set_ref(&pending_ref(), current, blob)
        .await
        .map_err(js)
}

/// The newcomer's statement the store keeps, if one waits.
async fn kept_pending() -> Option<String> {
    let (store, _) = store().await.ok()?;
    let blob = store.get_ref(&pending_ref()).await.ok().flatten()?;
    let bytes = store.get(&blob).await.ok().flatten()?;
    String::from_utf8(bytes.to_vec()).ok()
}

/// The statement no longer waits: the network took it (this browser is in the tree) or refused it.
fn clear_pending() {
    wasm_bindgen_futures::spawn_local(async {
        let Ok((store, _)) = store().await else {
            return;
        };
        if let Ok(Some(at)) = store.get_ref(&pending_ref()).await {
            let _ = store.delete_ref(&pending_ref(), at).await;
        }
    });
}

/// The page's notes, clearing the waiting statement once the network has taken this device into its tree or refused
/// the statement.
fn settling(me: String, page: Notes) -> Notes {
    Arc::new(move |line: String| {
        let settles = (line.contains("\"refused\"") || line.contains("\"network\""))
            .then(|| serde_json::from_str::<serde_json::Value>(&line).ok())
            .flatten()
            .is_some_and(|l| {
                l["event"] == "refused"
                    || (l["event"] == "network"
                        && l["kept"].is_null()
                        && l["tree"].as_str().is_some_and(|t| t.contains(&me)))
            });
        if settles {
            clear_pending();
        }
        page(line);
    })
}

/// The device may be back: the page came online or into view. iroh looks at the network again, and a link that
/// isn't live dials at once.
#[wasm_bindgen]
pub fn wake() {
    if let Ok(endpoint) = running(|r| Ok(r.files.endpoint.clone())) {
        wasm_bindgen_futures::spawn_local(async move { endpoint.network_change().await });
    }
    WAKE.with(|w| {
        if let Some(w) = w.borrow().as_ref() {
            let _ = w.unbounded_send(());
        }
    });
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
    let text = frame;
    let frame = statement(&text).ok_or_else(|| JsError::new("a page sends only a statement"))?;
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
            // kept first: a reload, or a network that comes back later, sends it still
            if let (Err(e), Some(config)) = (
                keep_pending(&text).await,
                CONFIG.with(|c| c.borrow().clone()),
            ) {
                let why = serde_json::json!({ "why": format!("the statement not kept: {e:?}") });
                (config.notes)(timeline::line(now(), &config.name, "dropped", why));
            }
            if let Some(config) = CONFIG.with(|c| c.borrow().clone()) {
                (config.notes)(timeline::line(
                    now(),
                    &config.name,
                    "pending",
                    serde_json::json!({ "frame": kind(&frame) }),
                ));
            }
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

/// The page's statement, `{"frame": "claim" | "sign_in" | "invite" | "withdraw" | "join", "statement": "…"}`, read from
/// exactly those keys: as the page sends it, and as a newcomer's is kept in the store until the network takes it, so a
/// statement kept by an earlier release reads the same.
fn statement(text: &str) -> Option<Frame> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let o = v.as_object().filter(|o| o.len() == 2)?;
    let statement = o.get("statement")?.as_str()?.to_string();
    Some(match o.get("frame")?.as_str()? {
        "claim" => Frame::Claim { statement },
        "sign_in" => Frame::SignIn { statement },
        "invite" => Frame::Invite { statement },
        "withdraw" => Frame::Withdraw { statement },
        "join" => Frame::Join { statement },
        _ => return None,
    })
}

/// A newcomer's frame by the name the page knows it.
fn kind(frame: &Frame) -> &'static str {
    match frame {
        Frame::Claim { .. } => "claim",
        Frame::SignIn { .. } => "sign_in",
        Frame::Join { .. } => "join",
        _ => "statement",
    }
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

/// Deletes a line of this device's vault, by its name: a retraction on this device's chain, kept and shown at once
/// (the line shows deleted), then sent (`aven_peer::room::Room::retract`).
#[wasm_bindgen]
pub fn retract(id: String) -> Result<(), JsError> {
    running(|r| {
        let room = r.room.clone();
        wasm_bindgen_futures::spawn_local(async move { room.retract(id).await });
        Ok(())
    })
}

/// Sends a line's blob on gossip as it is, unchecked here: every other peer checks it. The box's check sends a fork
/// and a line of a device that is no member's this way (store/README.md, "How it is checked", 5).
#[wasm_bindgen]
pub fn post_line(blob: String) -> Result<(), JsError> {
    running(|r| {
        let room = r.room.clone();
        wasm_bindgen_futures::spawn_local(async move {
            room.gossip_line(blob.as_bytes()).await;
        });
        Ok(())
    })
}

/// Puts one chunk of a file the page is sharing, 1 MiB but the last, into this origin's store, and returns its name:
/// the page reads a dropped file a chunk at a time, so a movie never sits in memory whole (store/README.md).
#[wasm_bindgen]
pub async fn put_chunk(bytes: Vec<u8>) -> Result<String, JsError> {
    let store = running(|r| Ok(r.files.store.clone()))?;
    if bytes.is_empty() || bytes.len() as u64 > files::CHUNK {
        return Err(JsError::new("a chunk is 1 byte to 1 MiB"));
    }
    Ok(store.put(bytes.into()).await.map_err(js)?.to_hex())
}

/// Shares a file whose chunks are in the store (their names, in order, as JSON): puts its index, keeps it under
/// `file-<index>`, and says it as a `file` line of this device's chain, shown at once. Returns the index's name.
#[wasm_bindgen]
pub async fn share(
    name: String,
    kind: String,
    size: f64,
    chunks: String,
) -> Result<String, JsError> {
    let (store, room) = running(|r| Ok((r.files.store.clone(), r.room.clone())))?;
    let chunks: Vec<String> = serde_json::from_str(&chunks).map_err(js)?;
    let mut index = Vec::with_capacity(chunks.len() * 32);
    for c in &chunks {
        let h = hash(c)?;
        if !store.has(&h).await.map_err(js)? {
            return Err(JsError::new(&format!("chunk {c} isn't in the store")));
        }
        index.extend_from_slice(h.as_bytes());
    }
    let file = store.put(index.into()).await.map_err(js)?;
    {
        let mut sending = SENDING.lock().unwrap_or_else(|e| e.into_inner());
        for c in &chunks {
            sending.chunk.insert(hash(c)?, file);
        }
        sending
            .files
            .entry(file)
            .or_insert((size as u64, Default::default(), 0));
    }
    let len = files::open(&*store, &file)
        .await
        .map_err(js)?
        .map(|f| f.len);
    if len != Some(size as u64) {
        return Err(JsError::new(&format!(
            "the chunks hold {len:?} bytes, not {size}"
        )));
    }
    let _ = store
        .set_ref(
            &aven_db_store::RefName::new(format!("file-{file}")).map_err(js)?,
            None,
            file,
        )
        .await;
    room.share(aven_db_core::files::Announcement {
        file: file.to_hex(),
        size: size as u64,
        name,
        kind,
    })
    .await;
    Ok(file.to_hex())
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
                // the relay names why it refused a statement; a bare "not a member" says nothing more
                let why = match denied.as_deref() {
                    Some(why) if why != "not a member" => why,
                    _ => "the network did not take this browser's statement: invite only",
                };
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
// worker ends (store/README.md, the opfs driver). What an older avenOS left in this origin is cleared, and the store
// made fresh: `RESET` says why until `start` tells the page (a `reset` line). The crate also builds natively, for the
// workspace's tests; there it has no OPFS, and keeps its store in memory.
thread_local! {
    static STORE: RefCell<Option<Shared>> = const { RefCell::new(None) };
    static RESET: RefCell<Option<String>> = const { RefCell::new(None) };
}

async fn store() -> Result<(Shared, &'static str), JsError> {
    if let Some(s) = STORE.with(|s| s.borrow().clone()) {
        return Ok((s, KIND));
    }
    #[cfg(target_arch = "wasm32")]
    #[allow(clippy::arc_with_non_send_sync)]
    let s: Shared = {
        let (store, reset) = backend::opfs_or_reset("/store/").await.map_err(js)?;
        RESET.with(|r| *r.borrow_mut() = reset);
        Arc::new(store)
    };
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
/// or else `candidate` (new random bytes from the page), stored now. Returns the secret the Peer-Light goes by.
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

std::thread_local! {
    /// The passkey's seal key, for this session only: derived again at each ceremony, never stored. The owner key is
    /// never kept at all (A42): each ceremony derives it, signs, and drops it (`ownerSign`).
    static SEAL: RefCell<Option<aven_id::SealKey>> = const { RefCell::new(None) };
}

/// The PRF output of the passkey `credential` (its id, base64url) at owner epoch `epoch`, straight from the ceremony
/// (rule 13): the Peer-Light derives the owner key and the seal key from it, keeps the seal key in memory for this
/// session and drops the owner key (A42), wipes the output, and keeps only the public halves in its store, under the
/// ref `owner-keys`, until the tree's ops carry them. Gives back `{owner, seal}`, hex: never a secret.
#[wasm_bindgen(js_name = prfKeys)]
pub async fn prf_keys(
    epoch: u32,
    credential: String,
    mut output: Vec<u8>,
) -> Result<JsValue, JsError> {
    use aven_db_store::RefName;
    // the seal key goes into this session's keeping and the owner key is dropped before anything awaits, so no
    // future carries them
    let (owner, seal) = {
        let derived = acts::prf_derive(&mut output).map_err(|e| JsError::new(&e))?;
        let public = (derived.owner.clone(), derived.seal.clone());
        SEAL.with(|s| *s.borrow_mut() = Some(derived.seal_key));
        public
    };
    let kept = serde_json::json!({ "credential": credential, "epoch": epoch, "owner": owner, "seal": seal });
    let (store, _) = store().await?;
    let name = RefName::new("owner-keys").map_err(js)?;
    let blob = store
        .put(kept.to_string().into_bytes().into())
        .await
        .map_err(js)?;
    let was = store.get_ref(&name).await.map_err(js)?;
    store.set_ref(&name, was, blob).await.map_err(js)?;
    Ok(object(&[("owner", owner.into()), ("seal", seal.into())]))
}

/// What the passkey's hybrid owner key signs, inside the Peer-Light: the ceremony's PRF `output` and `bytes` (hex) in,
/// the signature's Value's bytes (hex) out. The owner key is derived for this one signature and dropped (A42); the
/// output is wiped.
#[wasm_bindgen(js_name = ownerSign)]
pub fn owner_sign(mut output: Vec<u8>, bytes: String) -> Result<String, JsError> {
    let msg = unhex(&bytes);
    let derived = acts::prf_derive(&mut output).map_err(|e| JsError::new(&e))?;
    let msg = msg.ok_or_else(|| JsError::new("not hex"))?;
    Ok(derived
        .owner_key
        .sign(&msg)
        .to_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

/// The public halves this browser keeps (`owner-keys`), or null.
#[wasm_bindgen(js_name = ownerKeys)]
pub async fn owner_keys() -> Result<JsValue, JsError> {
    use aven_db_store::RefName;
    let (store, _) = store().await?;
    let name = RefName::new("owner-keys").map_err(js)?;
    let Some(blob) = store.get_ref(&name).await.map_err(js)? else {
        return Ok(JsValue::NULL);
    };
    let bytes = store
        .get(&blob)
        .await
        .map_err(js)?
        .ok_or_else(|| JsError::new("owner-keys points at a missing blob"))?;
    Ok(String::from_utf8(bytes.to_vec()).map_err(js)?.into())
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) || !s.is_ascii() {
        return None;
    }
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).ok())
        .collect()
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
    let notes = if members.is_none() {
        settling(name.clone(), notes)
    } else {
        notes
    };
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
    let learns = config.members.is_none();
    CONFIG.with(|c| *c.borrow_mut() = Some(config.clone()));
    bind(None).await?;
    // a newcomer's statement signed before a reload, and not yet taken: sent again, so the person needn't tap again
    if learns && MEMBER.get() {
        clear_pending();
    } else if learns && let Some(frame) = kept_pending().await {
        (config.notes)(timeline::line(
            now(),
            &config.name,
            "pending",
            serde_json::json!({ "kept": true }),
        ));
        if let Err(e) = send(frame) {
            let why = serde_json::json!({ "why": format!("the kept statement: {e:?}") });
            (config.notes)(timeline::line(now(), &config.name, "dropped", why));
            clear_pending();
        }
    }
    Ok(())
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
        .alpns(vec![
            ALPN.to_vec(),
            iroh_gossip::ALPN.to_vec(),
            blobs::ALPN.to_vec(),
        ])
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
    // this origin held what an older avenOS left: it was cleared, so this browser is a new device, which signs in again
    if let Some(why) = RESET.with(|r| r.borrow_mut().take()) {
        notes(timeline::line(
            now(),
            &name,
            "reset",
            serde_json::json!({ "why": why }),
        ));
    }
    let kept = record::first_start(&*store, &name, now())
        .await
        .map_err(js)?;
    notes(record::line(now(), &name, kind, &kept));
    // the network as it was last told, checked again: the views and the members before any link (offline first)
    if members.is_none() {
        aven_peer::link::recall(&store, &name, &gate, &notes).await;
        MEMBER.set(gate.admits(&secret.public()));
    }
    // the chat's history, from the same store: shown before any peer answers (store/README.md, "Local first")
    let chats = Chats::open(
        name.clone(),
        "aven",
        secret.clone(),
        gate.clone(),
        notes.clone(),
        store.clone(),
    )
    .await
    .map_err(js)?;
    let aven = EndpointAddr::new(aven_key).with_relay_url(relay.clone());
    aven_peer::know(&endpoint, aven.clone());
    // a file a retraction took is served no more, even while its bytes are being deleted
    let held = Blobs::new(aven_db_store::withhold::Withholding::serving(
        store.clone(),
        chats.withheld(),
    ));
    {
        let (me, notes) = (name.clone(), notes.clone());
        held.on_served(Arc::new(move |chunk, len| served(&me, &notes, chunk, len)));
    }
    let gossip = Gossip::builder().spawn(endpoint.clone());
    let router = Router::builder(endpoint.clone())
        .accept(iroh_gossip::ALPN, gossip.clone())
        .accept(
            blobs::ALPN,
            blobs::provider(&held, name.clone(), gate.clone(), notes.clone()),
        )
        .spawn();
    let files = Files {
        endpoint: endpoint.clone(),
        store,
        held,
        withheld: chats.withheld(),
        aven: aven.clone(),
        relay: relay.clone(),
    };
    let room = Room::join(
        &gossip,
        name.clone(),
        "aven",
        secret,
        gate.clone(),
        vec![aven_key],
        notes.clone(),
        Some(chats.clone()),
    )
    .await
    .map_err(js)?;
    let (outbox, frames) = futures_channel::mpsc::unbounded();
    let (wakes, woken) = futures_channel::mpsc::unbounded();
    WAKE.with(|w| *w.borrow_mut() = Some(wakes));
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
        Some(chats),
        Some(woken),
    ));
    Ok(())
}

/// A fetch from `from` (a member's key, hex) or the Aven Peer, over the connection kept to it while it is open; one
/// that fails over a kept connection is tried once more over a fresh one (`blobs::once_more`): a leader's takeover can
/// leave a kept connection dead and still open.
async fn fetching(
    f: &Files,
    from: Option<String>,
    fetch: impl AsyncFn(Connection) -> Result<Fetched, FetchError>,
) -> Result<Fetched, JsValue> {
    let at = match from {
        Some(key) => {
            EndpointAddr::new(keys::public(&key).map_err(js)?).with_relay_url(f.relay.clone())
        }
        None => f.aven.clone(),
    };
    let cached = CONNECTIONS.with(|c| {
        c.borrow()
            .get(&at.id)
            .filter(|c| c.close_reason().is_none())
            .cloned()
    });
    let fresh = async || f.endpoint.connect(at.clone(), blobs::ALPN).await;
    let (result, keep) = blobs::once_more(cached, fresh, fetch).await;
    CONNECTIONS.with(|c| match keep {
        Some(conn) => c.borrow_mut().insert(at.id, conn),
        None => c.borrow_mut().remove(&at.id),
    });
    result.map_err(fetch_error)
}

/// The file's index, fetched if this Peer-Light hasn't it, and its last chunk: until that is here the file's length
/// is only a guess (`files::open`), and a player told a wrong length asks past the end and never finds a movie's index
/// there (30 Oct 2026). The bytes that crossed for both.
async fn open(f: &Files, file: &Hash, from: Option<String>) -> Result<(files::File, u64), JsValue> {
    // deleted: gone, whatever bytes are left, and never fetched again
    if f.withheld.read().unwrap().contains(file) {
        return Err(fetch_error(FetchError::NotFound(*file)));
    }
    let mut fetched = 0;
    let found = match files::open(&*f.store, file).await.map_err(js)? {
        Some(found) => found,
        None => {
            let got = fetching(f, from.clone(), async |conn| {
                f.held.fetch_chunks(&conn, *file, 0..0).await
            })
            .await?;
            fetched += got.bytes;
            files::open(&*f.store, file)
                .await
                .map_err(js)?
                .ok_or_else(|| JsError::new("no such file"))?
        }
    };
    let n = found.chunks.len() as u64;
    let Some(last) = found.chunks.last() else {
        return Ok((found, fetched));
    };
    if f.store.has(last).await.map_err(js)? {
        return Ok((found, fetched));
    }
    let got = fetching(f, from, async |conn| {
        f.held.fetch_chunks(&conn, *file, n - 1..n).await
    })
    .await?;
    let found = files::open(&*f.store, file)
        .await
        .map_err(js)?
        .ok_or_else(|| JsError::new("no such file"))?;
    Ok((found, fetched + got.bytes))
}

/// The chunks of `range` this Peer-Light lacks, fetched; the bytes that crossed.
async fn chunks(
    f: &Files,
    file: &files::File,
    range: Range<u64>,
    from: Option<String>,
) -> Result<u64, JsValue> {
    let missing = file.missing(&*f.store, range).await.map_err(js)?;
    let (Some(first), Some(last)) = (missing.first(), missing.last()) else {
        return Ok(0);
    };
    let wanted = *first..*last + 1;
    let fetched = fetching(f, from, async |conn| {
        f.held.fetch_chunks(&conn, file.name, wanted.clone()).await
    })
    .await?;
    Ok(fetched.bytes)
}

/// A fetch's failure for the page: [`NOT_FOUND`] when the holder hasn't the file or a chunk of it (a Service Worker's
/// 404), a plain error otherwise (its 502).
fn fetch_error(e: FetchError) -> JsValue {
    let error = js_sys::Error::new(&e.to_string());
    if matches!(e, FetchError::NotFound(_) | FetchError::NotAFile(_)) {
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

/// How the Service Worker serves a file (aven/runtimes' registry, `decideFile`), by its first bytes (at most 64 KiB),
/// its size and what its sender claims: `{type, mime, inline}`, `inline` the media type to serve it inline as, or null
/// for an attachment. The bytes decide; the claim only chooses among text formats, and never makes a file inline. No
/// file runtime runs before the files origin (A15), so a decision is native, framed or a download.
#[wasm_bindgen]
pub fn decide(head: &[u8], size: f64, claimed: Option<String>, name: Option<String>) -> JsValue {
    let claim = registry::Claim {
        r#type: claimed.as_deref(),
        name: name.as_deref(),
    };
    let d = registry::decide_file(
        registry::Stage { runtimes: false },
        head,
        size as u64,
        &claim,
    );
    let inline = match d.serve {
        registry::Serve::Inline(m) => JsValue::from_str(m),
        _ => JsValue::NULL,
    };
    object(&[
        ("type", JsValue::from_str(d.r#type.name())),
        ("mime", JsValue::from_str(d.r#type.mime())),
        ("inline", inline),
    ])
}

/// What the chat's card for a file is, by the type its sender claims, before its bytes are read: `image`, `audio`,
/// `video`, `pdf` or `file` (a download link). Only a label: the Service Worker serves the bytes as [`decide`] says,
/// so a card whose claim lies shows nothing.
#[wasm_bindgen]
pub fn file_kind(claimed: &str) -> String {
    use registry::{Element, Mode};
    match registry::entry(registry::of_mime(claimed)).mode {
        Mode::Native(Element::Img) => "image",
        Mode::Native(Element::Audio) => "audio",
        Mode::Native(Element::Video) => "video",
        Mode::Frame => "pdf",
        _ => "file",
    }
    .into()
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
pub async fn file_range(
    file: String,
    start: f64,
    end: f64,
    from: Option<String>,
) -> Result<JsValue, JsValue> {
    let f = running_files()?;
    let (found, mut fetched) = open(&f, &hash(&file)?, from.clone()).await?;
    // a range past the end is empty: the Service Worker answers it 416
    let range = (start as u64).min(found.len)..(end as u64).min(found.len);
    fetched += chunks(&f, &found, range.clone(), from).await?;
    let bytes = found
        .read(&*f.store, range)
        .await
        .map_err(js)?
        .ok_or_else(|| JsError::new("a chunk went missing"))?;
    Ok(object(&[
        ("bytes", js_sys::Uint8Array::from(&bytes[..]).into()),
        ("len", (found.len as f64).into()),
        ("fetched", (fetched as f64).into()),
    ]))
}

/// How much of a file this Peer-Light holds: `{len, held}` in bytes, `len` 0 while it hasn't the file's index. A
/// viewer's card says "fetching 12 of 85 MB" from it while the chunks come.
#[wasm_bindgen]
pub async fn file_held(file: String) -> Result<JsValue, JsValue> {
    let f = running_files()?;
    let Some(found) = files::open(&*f.store, &hash(&file)?).await.map_err(js)? else {
        return Ok(object(&[("len", 0f64.into()), ("held", 0f64.into())]));
    };
    let n = found.chunks.len() as u64;
    let lacking: u64 = found
        .missing(&*f.store, 0..found.len)
        .await
        .map_err(js)?
        .iter()
        .map(|&i| {
            if i + 1 == n {
                found.len - i * files::CHUNK
            } else {
                files::CHUNK
            }
        })
        .sum();
    Ok(object(&[
        ("len", (found.len as f64).into()),
        ("held", ((found.len - lacking) as f64).into()),
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
