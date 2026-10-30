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

use std::cell::{Cell, RefCell};
use std::sync::Arc;

use aven_db_core::chat::Message;
use aven_db_core::timeline;
use aven_db_core::wire::{ALPN, Frame};
use aven_db_store::backend;
use aven_peer::iroh_gossip::{self, Gossip};
use aven_peer::members::{Gate, Hook};
use aven_peer::room::Room;
use aven_peer::{Notes, keys, link, now, record};
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{
    Endpoint, EndpointAddr, PublicKey, RelayConfig, RelayMap, RelayMode, RelayUrl, SecretKey,
};
use wasm_bindgen::prelude::*;

pub mod acts;
pub mod views;

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

/// The page's notes, and a new snapshot of the views whenever the Aven Peer tells this device its network's tree.
fn pushing_views(me: String, page: Notes) -> Notes {
    Arc::new(move |line: String| {
        let tree = line
            .contains("\"network\"")
            .then(|| serde_json::from_str::<serde_json::Value>(&line).ok())
            .flatten()
            .filter(|l| l["event"] == "network")
            .and_then(|l| l["tree"].as_str().map(str::to_string));
        page(line);
        if let Some(tree) = tree {
            page(views_line(&me, &tree));
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

/// Starts the Peer-Light `name` with its secret seed (hex), linking through `relay` to the Aven Peer (`aven_key`,
/// called `aven_name` in the timeline), and tells `notes` every event. Without a name it goes by its key's device id.
/// In the box's cast, `members` lists the cast's members (`name=key,…`); without them it learns the members from the
/// Aven Peer's statements. In the box, `cast` is the cast's tree, whose views it pushes at once; without one they
/// follow the network's tree as the Aven Peer tells it. Returns once the endpoint is bound; the link and the room run
/// on.
#[wasm_bindgen]
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
        .alpns(vec![ALPN.to_vec(), iroh_gossip::ALPN.to_vec()])
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
    #[cfg(target_arch = "wasm32")]
    let (store, kind) = (backend::opfs("/store/").map_err(js)?, "opfs");
    // the crate also builds natively, for the workspace's tests; there it has no OPFS
    #[cfg(not(target_arch = "wasm32"))]
    let (store, kind) = (backend::memory().map_err(js)?, "memory");
    let kept = record::first_start(&store, &name, now())
        .await
        .map_err(js)?;
    notes(record::line(now(), &name, kind, &kept));
    let aven = EndpointAddr::new(aven_key).with_relay_url(relay.clone());
    aven_peer::know(&endpoint, aven.clone());
    let gossip = Gossip::builder().spawn(endpoint.clone());
    let router = Router::builder(endpoint.clone())
        .accept(iroh_gossip::ALPN, gossip.clone())
        .spawn();
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
