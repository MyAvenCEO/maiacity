//! The Maia Universe's feed (`GET /feed/posts`): the posts avenDB's server keeps that everyone may read, newest first
//! (`avendb::world::public_posts`), as JSON, `{"posts": [...]}`, over plain HTTP on a socket of its own
//! (`Config::feed_bind`), behind the proxy at avendb.maia.city/feed/. Any page may read it
//! (`Access-Control-Allow-Origin: *`), as it is what everyone reads anyway: a post is in it while a Public share of its
//! vault reaches it, as the content flow's published stage does, and leaves it as its article goes back to a draft. The
//! server works it out at most every few seconds (`FRESH`), however many ask.
//!
//! Beside it, the pictures everyone may read (`GET /feed/files/<vault>/<name>`, `FILES`): each a file entry of a vault,
//! public, by the name an article shows it by, served whole as the server opens it (`world::public_file`), so that a
//! post's page shows its cover and its pictures. Pictures alone, by their names' endings (`media_of`): nothing a page
//! would run.
//!
//! And the site's media (`GET /feed/media/<hash>`, `MEDIA`): each a file of the seed's coop, Maia City, that everyone
//! may read, named by the BLAKE3 hash its bytes had in the old media vault and its ending (`<hash>.jpg`), as the site
//! names its pictures, sounds and films (src/lib/media/url.ts), served by `Range` a window at a time, so that a page
//! plays a film from any second (`media`). Pictures, sound and film alone, by their names' endings (`played`).
//!
//! And the entries everyone may read (`GET /feed/entries`, `ENTRIES`, `avendb::world::public_entries`): each entry of
//! what the server keeps that a Public share reaches, of whatever kind, as JSON, `{"entries": [...]}`, each with its
//! record as its main line holds it, the schema that reads it and the heads of that version, by its vault, then its
//! kind, then its entry; and the code among them, each view, logic, recipe, function and config (`GET /feed/code`,
//! `CODE`, `world::CODE_KINDS`), as `{"code": [...]}`. So a page nobody signed in to, and the API, which hold no device,
//! read a vault's stories and articles and load code from avenDB, and check it again themselves before a sandboxed host
//! runs any of it. Anyone may found a vault, call it Maia City and make its views public: a row names the seed's vaults
//! by where they stand in the server's seed (`seed`, `world::seed_of`), never by what a vault calls itself, and `seed=1`
//! keeps the seed's coop's alone, Maia City's (`world::SEED_COOP`), none while the server's seed has no coop. A query
//! also keeps one vault's (`vault=<64 hex>`) or some kinds (`type=story,article`), or leaves the records out (`bare=1`),
//! a listing for when they grow big (`Asked`). Beside them, any one entry everyone may read, whole, in the same shape
//! (`GET /feed/entry/<vault>/<entry>`, `ENTRY`), and not found, as JSON, for one that isn't public, that the server
//! doesn't hold, or that the query doesn't ask for. The server works all the entries out at most every few seconds
//! too, once for the three, and takes what each asks from that. Each row lists the files its entry's main line brings
//! that every reader counts as the entry's (`files`, `{root, size, len}`, oldest first, `Lab::line_files`), and the
//! newest of a code entry's is served whole at `GET /feed/entry/<vault>/<entry>/file` (`OF_ENTRY`, `source`): a
//! recipe's source, say, as plain text that no page runs as a script, which its loader checks against its hash. An
//! entry whose writes bring files more than once, as an asset's versions and variants each do, lists each of those
//! writes with the record at it (`brought`, `Lab::brought`), and any file a row lists is served by its root at `GET
//! /feed/entry/<vault>/<entry>/file/<root>` (`OF_ROOT`).
//!
//! And the proof of a vault's public code (`GET /feed/proof`, `PROOF`, `avendb::provenance`): the signed edits that
//! prove the code entries `/feed/code` lists of one vault (`vault=<64 hex>`, or `seed=1` for Maia City's), of the kinds
//! and entries a query names (`type=`, `entry=<64 hex>,…`), as one avenDB `wire::Reply`, its `ETag` the hash of their
//! ids (`provenance::frontier`). They are of what a stranger that follows the vault may receive, nothing more, and a
//! page or maiaCITY's API takes them as a device takes a sync reply (`provenance::Observer`): every signature checked,
//! every rule replayed, the rows it reads back those of the vault it is anchored to by its id. So which code is a
//! vault's is proven where it runs, and no row's JSON is taken on the server's word (H2 of maiaCITY's hardening plan).
//! A page asks for the proof of the entries it builds alone, and the next time asks for it by its tag: it is told the
//! proof is not modified while it is the same (304). Every answer of JSON but an invite's is tagged so too, by a BLAKE3
//! hash of its bytes, so a page that reads a listing again reads none of it while it is the same.
//!
//! And whether an invite is open (`GET /feed/invite/<share>`, `INVITE`, `world::open_invite`): `{"open": true}` while that
//! share is a live invite of Maia City's that no vault claimed yet, which maiaCITY's API asks before it signs anyone up,
//! so that an invite is only the share a device of Maia City signs, with no passkey and no code of the API's.
//!
//! And who a device is (`POST /feed/pass`, `PASS`, `world::pass_standing`, G3): a service that holds no device,
//! maiaCITY's API, posts the pass a device signed for it (`sign::ApiPass`, base64url) and its own name, `{"pass",
//! "audience"}`, and the server answers the vault the pass's device is a device of and whether that vault is an admin
//! of Maia City, `{"vault", "admin"}`: `{"vault": null, "admin": false}` for a pass that doesn't count for that service
//! now, or a signer that is no vault's device. So the API opens its admins' pages by avenDB's own word, never kept.

use std::collections::{BTreeMap, BTreeSet};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context as _, Result};
use avendb::id::{BlobId, EntryId, ShareId, VaultId};
use avendb::provenance;
use avendb::sealed::FileRoot;
use avendb::sign::{self, ApiPass};
use avendb::wire::Wire as _;
use avendb::world;
use avendb_net::Node;
use http_body_util::{BodyExt as _, Full, Limited};
use hyper::body::{Bytes, Incoming};
use hyper::header::{self, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use crate::Abort;
use crate::health::Health;

/// Where the feed is served.
pub const PATH: &str = "/feed/posts";

/// Where the pictures everyone may read are served, each at `FILES` `<vault>/<name>`: its vault in 64 hex digits, and
/// the name an article shows it by.
pub const FILES: &str = "/feed/files/";

/// Where the entries everyone may read are served, of every kind or of those a query names (`listed`).
pub const ENTRIES: &str = "/feed/entries";

/// Where the code everyone may read is served: the entries of the kinds of code (`world::CODE_KINDS`, `listed`).
pub const CODE: &str = "/feed/code";

/// Where one entry everyone may read is served, at `ENTRY` `<vault>/<entry>`, each in 64 hex digits (`entry`).
pub const ENTRY: &str = "/feed/entry/";

/// Where the newest file of a code entry everyone may read is served, after its entry's place: `ENTRY`
/// `<vault>/<entry>` `OF_ENTRY` (`source`).
pub const OF_ENTRY: &str = "/file";

/// Where one file of a code entry everyone may read is served, by its root, after its entry's place: `ENTRY`
/// `<vault>/<entry>` `OF_ROOT` `<root>`, its root in 64 hex digits (`source`): any of the files its row lists, as an
/// asset's versions each bring their own (`brought`).
pub const OF_ROOT: &str = "/file/";

/// Where the site's media everyone may read are served, each at `MEDIA` `<hash>`, or `<hash>.<ending>`: the file of
/// the seed's coop that everyone may read named so, the BLAKE3 hash its bytes had in the old media vault in 64 hex
/// digits and its ending (`media`).
pub const MEDIA: &str = "/feed/media/";

/// Where the server says whether an invite is open, at `INVITE` `<share>`, its id in 64 hex digits (`invite`).
pub const INVITE: &str = "/feed/invite/";

/// Where the server says how it is doing (`crate::health`): when it started, the memory it holds, and how the run
/// before it ended, never kept by a cache.
pub const HEALTH: &str = "/feed/health";

/// Where a service asks who the device of a pass is (`pass`), by a POST of `{"pass", "audience"}`.
pub const PASS: &str = "/feed/pass";

/// Where an admin of Maia City asks for the vaults the server knows (`vaults`, `world::kept_vaults`, G4), by a POST of
/// `{"pass"}`: a pass its device made for `world::VAULTS_AUDIENCE`.
pub const VAULTS: &str = "/feed/vaults";

/// The most bytes a POST of `PASS` brings: a pass is some 5 KiB of keys and signature, in base64url.
const MOST_POSTED: usize = 64 << 10;

/// Where the proof of one vault's public code is served (`proof`): `PROOF?vault=<64 hex>` or `PROOF?seed=1`, and the
/// kinds (`type=`) and entries (`entry=`) it proves.
pub const PROOF: &str = "/feed/proof";

/// The most bytes one answer of `MEDIA` carries of a file read by `Range`: a film is read a window at a time.
const WINDOW: u64 = 8 << 20;

/// The most kinds one query names.
const MOST_KINDS: usize = 16;

/// The most entries one query names (`entry=`).
const MOST_ENTRIES: usize = 512;

/// The most proofs the server keeps worked out, each of one query (`proven`): past that, it forgets them all.
const MOST_PROOFS: usize = 64;

/// The most bytes of a picture or of a code entry's file the feed serves, which it reads whole.
const LARGEST: u64 = 32 << 20;

/// How long a picture is served again from a cache: it is named by its content, but may stop being public.
const KEPT: &str = "public, max-age=300";

/// How long the feed the server worked out is served again before it works it out anew.
const FRESH: Duration = Duration::from_secs(5);

/// The most posts the feed holds, the newest.
const MOST: usize = 200;

/// What the server last worked out of a feed: when, and what. Held while it is worked out anew (`fresh_or`).
type Kept<T> = Arc<Mutex<Option<(Instant, T)>>>;

/// What the server last worked out of each: the feed's JSON, the entries everyone may read (`Listed`), the site's
/// media (`Media`), and the proofs of code it was asked for (`Proven`), by what each asks (`Asked`).
#[derive(Clone, Default)]
struct Feeds {
    posts: Kept<Bytes>,
    entries: Kept<Listed>,
    media: Kept<Media>,
    proofs: Arc<Mutex<BTreeMap<String, Kept<Option<Proven>>>>>,
}

/// A proof of a vault's code, as the server worked it out (`proven`): its bytes, one `wire::Reply`, and its tag, the
/// hash of its edits' ids in hex, quoted, as an `ETag` is.
#[derive(Clone)]
struct Proven {
    bytes: Bytes,
    tag: Arc<str>,
}

/// The site's media, as the server worked them out (`site_media`): each file of the seed's coop everyone may read that
/// is named by a hash and an ending it plays (`played`), by that hash, with its media type.
type Media = Arc<BTreeMap<String, (world::PublicFile, &'static str)>>;

/// The entries everyone may read, as the server worked them out: each as a row (`world::public_entries`), and the JSON
/// of them all and of the code among them, whole.
#[derive(Clone)]
struct Listed {
    rows: Arc<Vec<Value>>,
    entries: Bytes,
    code: Bytes,
}

/// The feed, served on its socket for as long as it is held.
pub struct Feed {
    addr: SocketAddr,
    _serving: Abort,
}

impl Feed {
    /// The feed of what `node` keeps, served on socket `bind`.
    pub async fn spawn(bind: SocketAddr, node: Arc<Node>, health: Arc<Health>) -> Result<Feed> {
        let listener = TcpListener::bind(bind).await.with_context(|| format!("the feed on {bind}"))?;
        let addr = listener.local_addr().context("the feed's socket")?;
        let feeds = Feeds::default();
        let serving = tokio::spawn(async move {
            loop {
                let stream = match listener.accept().await {
                    Ok((stream, _)) => stream,
                    Err(e) => {
                        // out of sockets, say: it tries again in a moment
                        tracing::warn!("avenDB feed: {e}");
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        continue;
                    }
                };
                let (node, feeds, health) = (node.clone(), feeds.clone(), health.clone());
                tokio::spawn(async move {
                    let service =
                        service_fn(move |request| answer(request, node.clone(), feeds.clone(), health.clone()));
                    let mut http = http1::Builder::new();
                    // a client that never finishes its request's head is let go, as the timer says (30 s)
                    http.timer(TokioTimer::new());
                    if let Err(e) = http.serve_connection(TokioIo::new(stream), service).await {
                        tracing::debug!("avenDB feed: {e}");
                    }
                });
            }
        });
        Ok(Feed { addr, _serving: Abort(serving) })
    }

    /// The socket it serves on.
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }
}

/// The answer to `request`: for a GET or HEAD, the feed of `PATH`, a picture of `FILES` (`picture`), a medium of `MEDIA`
/// by the `Range` it asks (`media`), the entries of `ENTRIES` or the code of `CODE` (`listed`), an entry of `ENTRY`
/// (`entry`), or a file of it (`OF_ENTRY`, `OF_ROOT`, `source`), the proof of some code (`PROOF`, `proof`), or whether
/// an invite is open (`INVITE`, `invite`); for a POST of `PASS`, whom a pass names (`pass`); nothing for a browser's
/// OPTIONS before any of them; and not found for anything else.
async fn answer(
    request: Request<Incoming>,
    node: Arc<Node>,
    feeds: Feeds,
    health: Arc<Health>,
) -> Result<Response<Full<Bytes>>, Infallible> {
    if request.uri().path() == PASS && *request.method() == Method::POST {
        return Ok(pass(request, &node).await);
    }
    // an admin's page asks it from the browser: its POST of JSON is asked about first (OPTIONS), and both are answered
    if request.uri().path() == VAULTS {
        return Ok(match *request.method() {
            Method::POST => vaults(request, &node).await,
            Method::OPTIONS => opened(no_store(StatusCode::NO_CONTENT, Bytes::new())),
            _ => opened(no_store(StatusCode::METHOD_NOT_ALLOWED, error("post {\"pass\"}"))),
        });
    }
    let path = request.uri().path();
    let reads = matches!(*request.method(), Method::GET | Method::HEAD);
    // how the server is doing, without asking its node, so that it answers while the node is busy
    if path == HEALTH && reads {
        return Ok(well(&health));
    }
    if let Some(at) = path.strip_prefix(FILES).filter(|_| reads) {
        return Ok(picture(at, &node).await);
    }
    if let Some(at) = path.strip_prefix(MEDIA).filter(|_| reads) {
        let range = request.headers().get(header::RANGE).and_then(|r| r.to_str().ok());
        return Ok(media(at, range, &node, &feeds.media).await);
    }
    let query = request.uri().query().unwrap_or_default();
    let had = request.headers().get(header::IF_NONE_MATCH).and_then(|t| t.to_str().ok());
    if path == PROOF && reads {
        return Ok(proof(query, had, &node, &feeds).await);
    }
    if let Some(at) = path.strip_prefix(ENTRY).and_then(|at| at.strip_suffix(OF_ENTRY)).filter(|_| reads) {
        return Ok(source(at, None, query, &node, &feeds.entries).await);
    }
    if let Some((at, root)) = path.strip_prefix(ENTRY).and_then(by_root).filter(|_| reads) {
        return Ok(source(at, Some(root), query, &node, &feeds.entries).await);
    }
    let under = [FILES, MEDIA, ENTRY, INVITE].iter().any(|at| path.starts_with(at));
    let ours = [PATH, ENTRIES, CODE, PROOF].contains(&path) || under;
    let invited = path.strip_prefix(INVITE).filter(|_| reads);
    let (status, body) = if let Some(at) = invited {
        invite(at, &node).await
    } else {
        match path.strip_prefix(ENTRY) {
            Some(at) if reads => entry(at, query, &node, &feeds.entries).await,
            _ if reads && path == PATH => (StatusCode::OK, posts(&node, &feeds.posts).await),
            _ if reads && [ENTRIES, CODE].contains(&path) => listed(path == CODE, query, &node, &feeds.entries).await,
            _ if *request.method() == Method::OPTIONS && ours => (StatusCode::NO_CONTENT, Bytes::new()),
            _ => (StatusCode::NOT_FOUND, error("no such feed")),
        }
    };
    // what a reader holds already, by its tag, is not modified: an invite never is
    let tag = (status == StatusCode::OK && reads && invited.is_none()).then(|| tag_of(&body));
    let held = tag.as_deref().is_some_and(|tag| holds(had, tag));
    let mut response = Response::new(Full::new(if held { Bytes::new() } else { body }));
    *response.status_mut() = if held { StatusCode::NOT_MODIFIED } else { status };
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, HEAD, OPTIONS"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("Range, If-None-Match"));
    if let Some(tag) = tag {
        headers.insert(header::ETAG, HeaderValue::from_str(&tag).expect("a tag in hex"));
        headers.insert(header::ACCESS_CONTROL_EXPOSE_HEADERS, HeaderValue::from_static("ETag"));
    }
    // an invite opens and closes from one moment to the next: never kept
    let kept = if invited.is_some() { "no-store" } else { "public, max-age=10" };
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(kept));
    Ok(response)
}

/// The answer to a GET or HEAD of `HEALTH`: how the server is doing (`Health::json`), as JSON, never kept.
fn well(health: &Health) -> Response<Full<Bytes>> {
    let body = Bytes::from(serde_json::to_vec(&health.json()).expect("JSON writes"));
    let mut response = Response::new(Full::new(body));
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// The tag of an answer of `body`: a BLAKE3 hash of its bytes in hex, quoted, as an `ETag` is.
fn tag_of(body: &[u8]) -> String {
    format!("\"{}\"", blake3::hash(body).to_hex())
}

/// A reader that asks with `had` (`If-None-Match`) holds what is tagged `tag`: one of the tags it names, weak or not.
fn holds(had: Option<&str>, tag: &str) -> bool {
    had.is_some_and(|had| had.split(',').any(|t| t.trim().trim_start_matches("W/") == tag))
}

/// The answer to a GET or HEAD of `INVITE` `<share>`: whether that share is an invite of the seed's coop, Maia City,
/// that a newcomer may still sign up with (`world::open_invite`), as `{"open": true}` or `{"open": false}`, and a bad
/// request, as JSON, for what isn't a share's id. What maiaCITY's API asks before it signs someone up.
async fn invite(at: &str, node: &Node) -> (StatusCode, Bytes) {
    let Some(share) = ShareId::from_hex(at) else {
        return (StatusCode::BAD_REQUEST, error("an invite is named by its share's id, 64 hex digits"));
    };
    let open = node.read(move |lab, me| world::open_invite(lab, me, share)).await;
    (StatusCode::OK, Bytes::from(serde_json::to_vec(&json!({ "open": open })).expect("JSON writes")))
}

/// The answer to a POST of `PASS`: of the pass it brings for the service it names, `{"pass", "audience"}`, the vault
/// its device is a device of and whether that vault is an admin of Maia City (`world::pass_standing`), checked now by
/// the server's clock, `{"vault", "admin"}`, never kept; a bad request, as JSON, for a body that is no such pass.
async fn pass(request: Request<Incoming>, node: &Node) -> Response<Full<Bytes>> {
    let posted = match Limited::new(request.into_body(), MOST_POSTED).collect().await {
        Ok(body) => body.to_bytes(),
        Err(_) => return no_store(StatusCode::PAYLOAD_TOO_LARGE, error("a pass is a few kilobytes")),
    };
    let asked: Value = serde_json::from_slice(&posted).unwrap_or_default();
    let text = |key: &str| asked.get(key).and_then(Value::as_str).map(str::to_owned);
    let (Some(pass), Some(audience)) = (text("pass"), text("audience")) else {
        return no_store(StatusCode::BAD_REQUEST, error("post {\"pass\", \"audience\"}"));
    };
    let Some(pass) = sign::unbase64url(&pass).and_then(|bytes| ApiPass::from_wire(&bytes).ok()) else {
        return no_store(StatusCode::BAD_REQUEST, error("a pass is a device's ApiPass in base64url"));
    };
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let said = node.read(move |lab, me| world::pass_standing(lab, me, &pass, &audience, now)).await;
    let (vault, admin) = said.map_or((Value::Null, false), |(v, admin)| (json!(v.to_hex()), admin));
    let body = serde_json::to_vec(&json!({ "vault": vault, "admin": admin })).expect("JSON writes");
    no_store(StatusCode::OK, Bytes::from(body))
}

/// The answer to a POST of `VAULTS`: of the pass it brings, `{"pass"}`, made for `world::VAULTS_AUDIENCE`, the vaults the
/// server knows, `{"vaults": [...]}` (`world::kept_vaults`), where its device's vault is an admin of Maia City, checked
/// now by the server's clock, never kept; forbidden for any other pass, and a bad request for a body that is no pass.
async fn vaults(request: Request<Incoming>, node: &Node) -> Response<Full<Bytes>> {
    let posted = match Limited::new(request.into_body(), MOST_POSTED).collect().await {
        Ok(body) => body.to_bytes(),
        Err(_) => return opened(no_store(StatusCode::PAYLOAD_TOO_LARGE, error("a pass is a few kilobytes"))),
    };
    let asked: Value = serde_json::from_slice(&posted).unwrap_or_default();
    let pass = asked.get("pass").and_then(Value::as_str).and_then(sign::unbase64url);
    let Some(pass) = pass.and_then(|bytes| ApiPass::from_wire(&bytes).ok()) else {
        return opened(no_store(StatusCode::BAD_REQUEST, error("post {\"pass\"}, a device's ApiPass in base64url")));
    };
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let (status, body) = match node.read(move |lab, me| world::kept_vaults(lab, me, &pass, now)).await {
        Some(vaults) => (StatusCode::OK, Bytes::from(serde_json::to_vec(&json!({ "vaults": vaults })).expect("JSON writes"))),
        None => (StatusCode::FORBIDDEN, error("the vaults are listed to an admin of Maia City alone")),
    };
    opened(no_store(status, body))
}

/// Answer `response` readable by any page, for its POST of JSON: what an admin's page in a browser asks of `VAULTS`.
fn opened(mut response: Response<Full<Bytes>>) -> Response<Full<Bytes>> {
    let headers = response.headers_mut();
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("POST, OPTIONS"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("Content-Type"));
    response
}

/// An answer of JSON `body` with `status` that nobody keeps: whom a pass names changes from one moment to the next.
fn no_store(status: StatusCode, body: Bytes) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(body));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// Place `at` after `ENTRY` as a file of an entry by its root, `<vault>/<entry>` `OF_ROOT` `<root>`: the entry's place
/// and the root, as written.
fn by_root(at: &str) -> Option<(&str, &str)> {
    at.split_once(OF_ROOT).filter(|(_, root)| !root.contains('/'))
}

/// What `kept` holds, if the server worked it out a moment ago (`FRESH`), else what `work` works out anew, kept. One
/// works it out at a time, holding `kept`, and those asking meanwhile wait and take what it worked out: a page that
/// asks for a world's hundred files at once had the server work out every entry everyone may read a hundred times
/// over at once, and it stopped answering (2026-10-19).
async fn fresh_or<T: Clone>(kept: &Kept<T>, work: impl Future<Output = T>) -> T {
    let mut held = kept.lock().await;
    if let Some((_, t)) = held.as_ref().filter(|(at, _)| at.elapsed() < FRESH) {
        return t.clone();
    }
    let t = work.await;
    *held = Some((Instant::now(), t.clone()));
    t
}

/// The feed's JSON: as the server last worked it out, if that was a moment ago (`FRESH`), else anew.
async fn posts(node: &Node, kept: &Kept<Bytes>) -> Bytes {
    let work = async {
        let mut posts = node.read(world::public_posts).await;
        posts.truncate(MOST);
        Bytes::from(serde_json::to_vec(&json!({ "posts": posts })).expect("JSON writes"))
    };
    fresh_or(kept, work).await
}

/// The entries everyone may read, as the server last worked them out, if that was a moment ago (`FRESH`), else anew.
async fn entries(node: &Node, kept: &Kept<Listed>) -> Listed {
    let work = async {
        let rows = node.read(|lab, me| world::public_entries(lab, me, None)).await;
        let (entries, code) = (listing("entries", &rows), listing("code", rows.iter().filter(|row| of_code(row))));
        Listed { rows: Arc::new(rows), entries, code }
    };
    fresh_or(kept, work).await
}

/// Row `row` is of code: its type is one of the kinds of code (`world::CODE_KINDS`).
fn of_code(row: &Value) -> bool {
    row["type"].as_str().is_some_and(|kind| world::CODE_KINDS.contains(&kind))
}

/// Rows `rows` as JSON, under `key`: `{key: [...]}`.
fn listing<'a>(key: &str, rows: impl IntoIterator<Item = &'a Value>) -> Bytes {
    let rows: Vec<&Value> = rows.into_iter().collect();
    Bytes::from(serde_json::to_vec(&json!({ key: rows })).expect("JSON writes"))
}

/// The answer to a GET or HEAD of `ENTRIES`, or of `CODE` for `code`, asking `query`: the entries everyone may read, or
/// the code among them, as the server last worked them out (`entries`); whole, as they were kept, for a query that asks
/// nothing of them, else those it asks for, as it asks for them (`Asked`); and a bad request, as JSON, for a query that
/// asks what isn't there to ask.
async fn listed(code: bool, query: &str, node: &Node, kept: &Kept<Listed>) -> (StatusCode, Bytes) {
    let asked = match Asked::of(query, code) {
        Ok(asked) => asked,
        Err(why) => return (StatusCode::BAD_REQUEST, error(why)),
    };
    let listed = entries(node, kept).await;
    match (asked.is_whole(), code) {
        (true, true) => (StatusCode::OK, listed.code),
        (true, false) => (StatusCode::OK, listed.entries),
        (false, _) => {
            let rows = listed.rows.iter().filter(|row| (!code || of_code(row)) && asked.keeps(row));
            let rows: Vec<Value> = rows.map(|row| asked.shown(row)).collect();
            (StatusCode::OK, listing(if code { "code" } else { "entries" }, &rows))
        }
    }
}

/// What a query of `ENTRIES`, `CODE` or `ENTRY` asks for: the entries of the seed's coop alone, of one vault, of some
/// kinds, and whether without records.
#[derive(Debug, Default, PartialEq, Eq)]
struct Asked {
    seed: bool,
    vault: Option<String>,
    kinds: Option<Vec<String>>,
    entries: Option<BTreeSet<String>>,
    bare: bool,
}

impl Asked {
    /// Query `query`, `seed=1&vault=<64 hex>&type=view,logic&entry=<64 hex>,<64 hex>&bare=1`, each part optional,
    /// `kind` another name for `type`, any other part left alone (a page's cache buster, say): why not, for a vault or
    /// an entry that isn't an id, more kinds than `MOST_KINDS` or entries than `MOST_ENTRIES`, or, of the code
    /// (`code`), a kind that isn't one of code's (`world::CODE_KINDS`). No kind at all keeps every kind, and no entry
    /// every entry.
    fn of(query: &str, code: bool) -> Result<Asked, &'static str> {
        let mut asked = Asked::default();
        for (key, value) in query.split('&').filter_map(|part| part.split_once('=')) {
            let value = decoded(value);
            match key {
                "vault" => {
                    let vault = VaultId::from_hex(&value).ok_or("vault is a vault's id, 64 hex digits")?;
                    asked.vault = Some(vault.to_hex());
                }
                "type" | "kind" => {
                    let kinds: Vec<String> = value.split(',').filter(|k| !k.is_empty()).map(String::from).collect();
                    if kinds.len() > MOST_KINDS {
                        return Err("type is a list of at most 16 kinds, as type=story,article");
                    }
                    if code && !kinds.iter().all(|k| world::CODE_KINDS.contains(&k.as_str())) {
                        return Err("type is a list of kinds of code here: recipe, view, logic, function or config");
                    }
                    asked.kinds = Some(kinds).filter(|ks| !ks.is_empty());
                }
                "entry" => {
                    let named = value.split(',').filter(|e| !e.is_empty());
                    let entries: Option<BTreeSet<String>> =
                        named.map(|e| Some(EntryId::from_hex(e)?.to_hex())).collect();
                    let entries = entries.ok_or("entry is a list of entries' ids, each 64 hex digits")?;
                    if entries.len() > MOST_ENTRIES {
                        return Err("entry is a list of at most 512 entries' ids");
                    }
                    asked.entries = Some(entries).filter(|es| !es.is_empty());
                }
                "seed" => asked.seed = value == "1" || value == "true",
                "bare" => asked.bare = value == "1" || value == "true",
                _ => {}
            }
        }
        Ok(asked)
    }

    /// It asks nothing of the entries: all of them, as they were kept.
    fn is_whole(&self) -> bool {
        *self == Asked::default()
    }

    /// Row `row` is of the seed's coop, of the vault, of a kind and one of the entries it asks for: of the coop by
    /// where its vault stands in the server's seed (`world::public_entries`), never by its name.
    fn keeps(&self, row: &Value) -> bool {
        let is = |field: &str, v: &str| row[field].as_str() == Some(v);
        (!self.seed || is("seed", world::SEED_COOP))
            && self.vault.as_deref().is_none_or(|v| is("vault", v))
            && self.kinds.as_ref().is_none_or(|ks| ks.iter().any(|k| is("type", k)))
            && self.entries.as_ref().is_none_or(|es| row["entry"].as_str().is_some_and(|e| es.contains(e)))
    }

    /// What it asks, written alike however its parts were: what a proof of it is kept by (`proven`).
    fn key(&self) -> String {
        let (kinds, entries) = (self.kinds.as_deref().unwrap_or_default(), self.entries.iter().flatten());
        let entries: Vec<&str> = entries.map(String::as_str).collect();
        let vault = self.vault.as_deref().unwrap_or_default();
        format!("{}/{vault}/{}/{}", self.seed, kinds.join(","), entries.join(","))
    }

    /// Row `row` as it asks for it: without its record, for `bare`.
    fn shown(&self, row: &Value) -> Value {
        let mut row = row.clone();
        if let (true, Some(fields)) = (self.bare, row.as_object_mut()) {
            fields.remove("record");
        }
        row
    }
}

/// Text `text` of a query, its `%XX` escapes, and `+` for a space, decoded: as it is, where that makes no UTF-8.
fn decoded(text: &str) -> String {
    let (bytes, mut out) = (text.as_bytes(), Vec::with_capacity(text.len()));
    let mut i = 0;
    while i < bytes.len() {
        let hex = bytes.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(std::str::from_utf8(h).ok()?, 16).ok());
        let (b, step) = match (bytes[i], hex) {
            (b'%', Some(b)) => (b, 3),
            (b'+', _) => (b' ', 1),
            (b, _) => (b, 1),
        };
        out.push(b);
        i += step;
    }
    String::from_utf8(out).unwrap_or_else(|_| text.to_string())
}

/// The answer to a GET or HEAD of `ENTRY` `at`, `<vault>/<entry>`, asking `query`: that entry, whole, as a row of the
/// entries everyone may read (`entries`), where it is one, as the query asks for it (`Asked`); a bad request, as JSON,
/// for a query that asks what isn't there to ask; and not found, as JSON, for any other, one that isn't public, that
/// the server doesn't hold, that is deleted or that the query doesn't ask for.
async fn entry(at: &str, query: &str, node: &Node, kept: &Kept<Listed>) -> (StatusCode, Bytes) {
    let asked = match Asked::of(query, false) {
        Ok(asked) => asked,
        Err(why) => return (StatusCode::BAD_REQUEST, error(why)),
    };
    let named = at.split_once('/').and_then(|(v, e)| Some((VaultId::from_hex(v)?, EntryId::from_hex(e)?)));
    let Some((vault, entry)) = named.map(|(v, e)| (v.to_hex(), e.to_hex())) else {
        return (StatusCode::NOT_FOUND, error("no such entry"));
    };
    let listed = entries(node, kept).await;
    let is = |row: &&Value| row["vault"].as_str() == Some(&vault) && row["entry"].as_str() == Some(&entry);
    match listed.rows.iter().find(is).filter(|row| asked.keeps(row)) {
        Some(row) => (StatusCode::OK, Bytes::from(serde_json::to_vec(&asked.shown(row)).expect("JSON writes"))),
        None => (StatusCode::NOT_FOUND, error("no entry everyone may read here")),
    }
}

/// The answer to a GET or HEAD of `PROOF`, asking `query`, from a reader that holds the proof tagged `had`
/// (`If-None-Match`): the proof of the code the same query lists at `CODE` (`proven`), one vault's, `vault=<64 hex>` or
/// Maia City's for `seed=1`, as bytes (`application/octet-stream`), tagged (`ETag`), and not modified for a reader
/// that holds it already, which asks again each time (`no-cache`); a bad request for a query it can't read or that
/// names no vault, and not found while `seed=1` names none, the server's seed having no coop yet.
async fn proof(query: &str, had: Option<&str>, node: &Node, feeds: &Feeds) -> Response<Full<Bytes>> {
    let asked = match Asked::of(query, true) {
        Ok(asked) if asked.seed || asked.vault.is_some() => asked,
        Ok(_) => return plain(StatusCode::BAD_REQUEST, "a proof is of one vault's code: vault=<64 hex> or seed=1"),
        Err(why) => return plain(StatusCode::BAD_REQUEST, why),
    };
    let Some(proven) = proven(&asked, node, feeds).await else {
        return plain(StatusCode::NOT_FOUND, "the server's seed has no coop yet");
    };
    let held = holds(had, &proven.tag);
    let mut response = match held {
        true => Response::new(Full::new(Bytes::new())),
        false => Response::new(Full::new(proven.bytes)),
    };
    if held {
        *response.status_mut() = StatusCode::NOT_MODIFIED;
    }
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"));
    headers.insert(header::ETAG, HeaderValue::from_str(&proven.tag).expect("a tag in hex"));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(header::ACCESS_CONTROL_EXPOSE_HEADERS, HeaderValue::from_static("ETag"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}

/// The proof of what `asked` asks of the code everyone may read (`provenance::proof`): of the code entries it lists
/// (`entries`, `of_code`, `Asked::keeps`), of its vault, or of the seed's coop for `seed`, as the server last worked it
/// out for the same query, if that was a moment ago (`FRESH`), else anew. None while `seed` names no vault.
async fn proven(asked: &Asked, node: &Node, feeds: &Feeds) -> Option<Proven> {
    let kept = {
        let mut proofs = feeds.proofs.lock().await;
        if proofs.len() >= MOST_PROOFS && !proofs.contains_key(&asked.key()) {
            // a proof is kept a moment (`FRESH`), and asked for again after it is worked out anew: those older go
            // first, and every one if none is
            let fresh = |kept: &Kept<Option<Proven>>| {
                kept.try_lock().map_or(true, |held| held.as_ref().is_some_and(|(at, _)| at.elapsed() < FRESH))
            };
            proofs.retain(|_, kept| fresh(kept));
            if proofs.len() >= MOST_PROOFS {
                proofs.clear();
            }
        }
        proofs.entry(asked.key()).or_default().clone()
    };
    let work = async {
        let vault = match asked.vault.as_deref().and_then(VaultId::from_hex) {
            Some(vault) => vault,
            None => *node.read(world::seed_of).await.first()?,
        };
        let listed = entries(node, &feeds.entries).await;
        let code = listed.rows.iter().filter(|row| of_code(row) && asked.keeps(row));
        let code: BTreeSet<EntryId> = code.filter_map(|row| EntryId::from_hex(row["entry"].as_str()?)).collect();
        let edits = node.read(move |lab, me| provenance::proof(lab, me, vault, &code)).await;
        let tag: String = provenance::frontier(&edits).iter().map(|b| format!("{b:02x}")).collect();
        Some(Proven { bytes: Bytes::from(provenance::reply(edits)), tag: format!("\"{tag}\"").into() })
    };
    fresh_or(&kept, work).await
}

/// An error, as JSON: `{"error": why}`.
fn error(why: &str) -> Bytes {
    Bytes::from(serde_json::to_vec(&json!({ "error": why })).expect("JSON writes"))
}

/// The media type of a picture named `name`, by its ending, as an article shows one (the page's `PICTURE`): none for
/// any other.
fn media_of(name: &str) -> Option<&'static str> {
    let (_, ending) = name.rsplit_once('.')?;
    Some(match ending {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        _ => return None,
    })
}

/// The answer to a GET or HEAD of `FILES` `at`, `<vault>/<name>`: the picture of that vault by that name that
/// everyone may read, whole, as the server opens it (`world::public_file`); not found for none, or for a file that
/// isn't a picture or is larger than `LARGEST`; and unavailable while the server can't read its bytes.
async fn picture(at: &str, node: &Node) -> Response<Full<Bytes>> {
    let asked = at.split_once('/').and_then(|(vault, name)| Some((VaultId::from_hex(vault)?, name.to_string())));
    let picture = asked.and_then(|(vault, name)| Some((vault, media_of(&name)?, name)));
    let Some((vault, media, name)) = picture else { return plain(StatusCode::NOT_FOUND, "no such picture") };
    let public = node.read(move |lab, me| world::public_file(lab, me, vault, &name)).await;
    let Some(file) = public.filter(|f| f.len <= LARGEST) else {
        return plain(StatusCode::NOT_FOUND, "no such picture");
    };
    let bytes = match node.read_file(file.root, 0..file.len).await {
        Ok(bytes) => bytes,
        Err(e) => {
            tracing::debug!("avenDB feed: a picture of {}: {e:#}", vault.to_hex());
            return plain(StatusCode::SERVICE_UNAVAILABLE, "the server can't read this picture yet");
        }
    };
    let mut response = Response::new(Full::new(Bytes::from(bytes)));
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(media));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(KEPT));
    response
}

/// The media type of a file named `name` that a page shows or plays, by its name's ending: a picture's (`media_of`), a
/// sound's or a film's; none for anything else, which a page might run.
fn played(name: &str) -> Option<&'static str> {
    if let Some(picture) = media_of(name) {
        return Some(picture);
    }
    let (_, ending) = name.rsplit_once('.')?;
    Some(match ending {
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        _ => return None,
    })
}

/// The site's media (`Media`): as the server last worked them out, if that was a moment ago (`FRESH`), else anew. None
/// while the server has no seed.
async fn site_media(node: &Node, kept: &Kept<Media>) -> Media {
    let work = async {
        let files = node.read(|lab, me| {
            let Some(&city) = world::seed_of(lab, me).first() else { return BTreeMap::new() };
            let named = |((vault, name), file): ((VaultId, String), world::PublicFile)| {
                let (hash, _) = name.split_once('.').filter(|(h, _)| vault == city && hexes(h))?;
                Some((hash.to_string(), (file, played(&name)?)))
            };
            let mut by_hash = BTreeMap::new();
            for (hash, file) in world::public_files(lab, me).into_iter().filter_map(named) {
                by_hash.entry(hash).or_insert(file);
            }
            by_hash
        });
        Arc::new(files.await)
    };
    fresh_or(kept, work).await
}

/// Whether `text` is a hash in 64 lower-case hex digits.
fn hexes(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// The bytes `range`, a request's `Range`, asks of a file of `len` bytes, as `media` serves them: none for a file asked
/// whole (no `Range`, or one it doesn't read, which it serves whole as HTTP says); or one range of `bytes=`, its first
/// byte and the end past its last, as it asks, from its start to its end, from its start on, or its last bytes, at
/// most `WINDOW` of them; or `Err` for one that asks nothing of the file, as one past its end.
fn ranged(range: Option<&str>, len: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(asked) = range.and_then(|r| r.trim().strip_prefix("bytes=")).filter(|r| !r.contains(',')) else {
        return Ok(None);
    };
    let Some((first, last)) = asked.trim().split_once('-') else { return Ok(None) };
    let (first, last) = (first.trim(), last.trim());
    let (from, to) = match (first.parse::<u64>(), last.parse::<u64>()) {
        (Ok(from), Ok(last)) if last >= from => (from, last.saturating_add(1).min(len)),
        (Ok(from), Err(_)) if last.is_empty() => (from, len),
        (Err(_), Ok(n)) if first.is_empty() && n > 0 => (len.saturating_sub(n), len),
        (Err(_), Ok(0)) if first.is_empty() => return Err(()),
        _ => return Ok(None),
    };
    if from >= len {
        return Err(());
    }
    Ok(Some((from, to.min(from + WINDOW))))
}

/// The answer to a GET or HEAD of `MEDIA` `at`, `<hash>` or `<hash>.<ending>`, by `Range` `range`: the site's medium
/// of that hash (`site_media`), whole, or the window of it the range asks (`ranged`), each with its media type and
/// that it is read by ranges (`Accept-Ranges`); a file larger than `LARGEST` asked whole is answered its first window,
/// as a page that plays it asks for more as it goes. Not found for a hash Maia City shows no one, or an ending other
/// than its file's; not satisfiable for a range past its end; and unavailable while the server can't read its bytes.
async fn media(at: &str, range: Option<&str>, node: &Node, kept: &Kept<Media>) -> Response<Full<Bytes>> {
    let (hash, ending) = at.split_once('.').map_or((at, None), |(hash, ending)| (hash, Some(ending)));
    let found = match hexes(hash) {
        true => site_media(node, kept).await.get(hash).cloned(),
        false => None,
    };
    let found = found.filter(|(_, media)| ending.is_none_or(|e| played(&format!("x.{e}")) == Some(*media)));
    let Some((file, media)) = found else { return plain(StatusCode::NOT_FOUND, "no such medium") };
    let (status, window) = match ranged(range, file.len) {
        Ok(Some(window)) => (StatusCode::PARTIAL_CONTENT, window),
        Ok(None) if file.len <= LARGEST => (StatusCode::OK, (0, file.len)),
        Ok(None) => (StatusCode::PARTIAL_CONTENT, (0, file.len.min(WINDOW))),
        Err(()) => {
            let mut response = plain(StatusCode::RANGE_NOT_SATISFIABLE, "no such range of this medium");
            let whole = HeaderValue::from_str(&format!("bytes */{}", file.len)).expect("a header");
            response.headers_mut().insert(header::CONTENT_RANGE, whole);
            return response;
        }
    };
    let bytes = match node.read_file(file.root, window.0..window.1).await {
        Ok(bytes) => bytes,
        Err(e) => {
            tracing::debug!("avenDB feed: the medium {hash}: {e:#}");
            return plain(StatusCode::SERVICE_UNAVAILABLE, "the server can't read this medium yet");
        }
    };
    let mut response = Response::new(Full::new(Bytes::from(bytes)));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(media));
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if status == StatusCode::PARTIAL_CONTENT {
        let part = format!("bytes {}-{}/{}", window.0, window.1 - 1, file.len);
        headers.insert(header::CONTENT_RANGE, HeaderValue::from_str(&part).expect("a header"));
    }
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    let shown = "Accept-Ranges, Content-Range, Content-Length";
    headers.insert(header::ACCESS_CONTROL_EXPOSE_HEADERS, HeaderValue::from_static(shown));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(KEPT));
    headers.insert("x-served-by", HeaderValue::from_static("avenDB"));
    response
}

/// The answer to a GET or HEAD of `ENTRY` `at` `OF_ENTRY`, `<vault>/<entry>/file`, asking `query`: the newest file of
/// that entry (`newest`), where it is a row of the code everyone may read (`entries`, `of_code`), the same rows
/// `ENTRY` serves, that the query asks for (`Asked`: `seed=1` keeps Maia City's alone, as ever), whole, as the server
/// opens it, as plain text (`text/plain; charset=utf-8`, `X-Content-Type-Options: nosniff`), so that no page runs it
/// as a script, nor takes it for anything else, whatever it holds: a loader checks it against its hash before a
/// sandboxed host runs it. With `root`, of `ENTRY` `at` `OF_ROOT` `root`, the file of that root among those the row
/// lists (`listed_file`) instead. A bad request for a query it can't read; not found for any other entry, one that
/// brings no file (or none of that root) or whose file is larger than `LARGEST`; and unavailable while the server can't
/// read its bytes.
async fn source(at: &str, root: Option<&str>, query: &str, node: &Node, kept: &Kept<Listed>) -> Response<Full<Bytes>> {
    let asked = match Asked::of(query, false) {
        Ok(asked) => asked,
        Err(why) => return plain(StatusCode::BAD_REQUEST, why),
    };
    let named = at.split_once('/').and_then(|(v, e)| Some((VaultId::from_hex(v)?, EntryId::from_hex(e)?)));
    let Some((vault, entry)) = named.map(|(v, e)| (v.to_hex(), e.to_hex())) else {
        return plain(StatusCode::NOT_FOUND, "no such entry");
    };
    let listed = entries(node, kept).await;
    let is = |row: &&Value| row["vault"].as_str() == Some(&vault) && row["entry"].as_str() == Some(&entry);
    let row = listed.rows.iter().find(is).filter(|row| of_code(row) && asked.keeps(row));
    let file = match root {
        None => row.and_then(newest),
        Some(root) => row.zip(BlobId::from_hex(root)).and_then(|(row, root)| listed_file(row, root)),
    };
    let Some((root, len)) = file else {
        return plain(StatusCode::NOT_FOUND, "no file of an entry everyone may read here");
    };
    let bytes = match node.read_file(root, 0..len).await {
        Ok(bytes) => bytes,
        Err(e) => {
            tracing::debug!("avenDB feed: the file of {vault}/{entry}: {e:#}");
            return plain(StatusCode::SERVICE_UNAVAILABLE, "the server can't read this file yet");
        }
    };
    let mut response = Response::new(Full::new(Bytes::from(bytes)));
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/plain; charset=utf-8"));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=10"));
    response
}

/// The newest file of row `row` (`world::public_entries`), as the feed serves it (`source`): the last of its `files`,
/// its root and plaintext length, where it is at most `LARGEST` bytes.
fn newest(row: &Value) -> Option<(FileRoot, u64)> {
    served(row["files"].as_array()?.last()?)
}

/// The file of root `root` among those row `row` lists (`world::public_entries`), as the feed serves it (`source`): of
/// its `files`, or of a version it brought (`brought`, each with its `files`), its root and plaintext length, where it
/// is at most `LARGEST` bytes.
fn listed_file(row: &Value, root: BlobId) -> Option<(FileRoot, u64)> {
    let versions = row["brought"].as_array().into_iter().flatten().map(|b| &b["files"]);
    let lists = std::iter::once(&row["files"]).chain(versions).filter_map(Value::as_array);
    let root = root.to_hex();
    lists.flatten().find(|f| f["root"].as_str() == Some(root.as_str())).and_then(served)
}

/// File `file` of a row, `{root, size, len}`, as the feed serves it: its root and plaintext length, where the server
/// opens it (`len`) and it is at most `LARGEST` bytes.
fn served(file: &Value) -> Option<(FileRoot, u64)> {
    let hash = BlobId::from_hex(file["root"].as_str()?)?.0;
    let (size, len) = (file["size"].as_u64()?, file["len"].as_u64()?);
    (len <= LARGEST).then_some((FileRoot { hash, size }, len))
}

/// An answer of `status` that says `why`, as text.
fn plain(status: StatusCode, why: &'static str) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(Bytes::from_static(why.as_bytes())));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/plain; charset=utf-8"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn a_feed_asked_many_times_at_once_is_worked_out_once() {
        let kept: Kept<usize> = Kept::default();
        let worked = Arc::new(AtomicUsize::new(0));
        let ask = || {
            let (kept, worked) = (kept.clone(), worked.clone());
            tokio::spawn(async move {
                let work = async {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    worked.fetch_add(1, Ordering::SeqCst) + 1
                };
                fresh_or(&kept, work).await
            })
        };
        let asked: Vec<_> = (0..100).map(|_| ask()).collect();
        for one in asked {
            assert_eq!(one.await.expect("asked"), 1);
        }
        assert_eq!(worked.load(Ordering::SeqCst), 1);
        // once it is no longer fresh, worked out anew
        *kept.lock().await = Some((Instant::now() - FRESH, 1));
        assert_eq!(ask().await.expect("asked"), 2);
    }

    #[test]
    fn a_range_asks_one_window_of_a_medium() {
        assert_eq!(ranged(None, 100), Ok(None), "whole");
        assert_eq!(ranged(Some("bytes=0-9"), 100), Ok(Some((0, 10))));
        assert_eq!(ranged(Some("bytes=90-"), 100), Ok(Some((90, 100))), "from 90 on");
        assert_eq!(ranged(Some("bytes=-5"), 100), Ok(Some((95, 100))), "the last five");
        assert_eq!(ranged(Some("bytes=-500"), 100), Ok(Some((0, 100))), "the last 500 of 100: all of it");
        assert_eq!(ranged(Some("bytes=50-500"), 100), Ok(Some((50, 100))), "up to its end");
        assert_eq!(ranged(Some("bytes=0-"), 100 << 20), Ok(Some((0, WINDOW))), "a window of a film");
        assert_eq!(ranged(Some("bytes=100-"), 100), Err(()), "past its end");
        assert_eq!(ranged(Some("bytes=-0"), 100), Err(()), "nothing of it");
        for unread in ["bytes=5-1", "bytes=0-1,5-6", "items=0-1", "bytes=a-b", "bytes=7"] {
            assert_eq!(ranged(Some(unread), 100), Ok(None), "{unread}: served whole, as HTTP says");
        }
    }

    #[test]
    fn a_medium_is_a_picture_a_sound_or_a_film() {
        let types = ["a.jpg", "a.png", "a.mp3", "a.m4a", "a.mp4", "a.webm"].map(played);
        let want = ["image/jpeg", "image/png", "audio/mpeg", "audio/mp4", "video/mp4", "video/webm"].map(Some);
        assert_eq!(types, want);
        for never in ["a.html", "a.js", "a.svg", "a.txt", "mp3"] {
            assert_eq!(played(never), None, "{never}");
        }
        assert!(hexes(&"ab".repeat(32)) && !hexes(&"AB".repeat(32)) && !hexes("ab") && !hexes(&"g".repeat(64)));
    }

    /// A query names entries by their ids, which keeps their rows alone, and what it asks is written alike however its
    /// parts were, as a proof of it is kept by that (`Asked::key`); entries that aren't ids, or too many, are refused.
    #[test]
    fn a_query_names_entries_and_is_kept_by_what_it_asks() {
        let (a, b) = ("ab".repeat(32), "cd".repeat(32));
        let asked = Asked::of(&format!("seed=1&type=view,logic&entry={b},{a}"), true).expect("a query");
        assert_eq!(asked.entries, Some([a.clone(), b.clone()].into_iter().collect()));
        let row = |e: &str| json!({ "entry": e, "type": "view", "seed": world::SEED_COOP });
        assert!(asked.keeps(&row(&a)) && asked.keeps(&row(&b)) && !asked.keeps(&row(&"ef".repeat(32))));
        let same = Asked::of(&format!("entry={a}%2C{b}&kind=view,logic&seed=true&t=1"), true).expect("a query");
        assert_eq!(same.key(), asked.key(), "the same query");
        for other in ["seed=1", "seed=1&type=view,logic", &format!("vault={a}&type=view,logic&entry={a},{b}")] {
            assert_ne!(Asked::of(other, true).expect("a query").key(), asked.key(), "{other}");
        }
        let many: Vec<String> = (0..=MOST_ENTRIES).map(|i| format!("{i:064x}")).collect();
        for bad in ["entry=ab".to_string(), format!("entry={a},x"), format!("entry={}", many.join(","))] {
            assert!(Asked::of(&bad, true).is_err(), "{}", &bad[..bad.len().min(80)]);
        }
        assert!(Asked::of(&format!("entry={}", many[1..].join(",")), true).is_ok(), "as many as a query may name");
    }

    /// A row whose files are `files`, each `(root, size, len)`.
    fn row(files: &[(&str, u64, u64)]) -> Value {
        let file = |(root, size, len): &(&str, u64, u64)| json!({ "root": root, "size": size, "len": len });
        let files: Vec<Value> = files.iter().map(file).collect();
        json!({ "type": "recipe", "files": files })
    }

    /// The newest file of a row is the last it lists, served up to `LARGEST` bytes and no further; a row with none, or
    /// whose file the server doesn't open, has none to serve.
    #[test]
    fn a_rows_newest_file_is_its_last_up_to_the_largest() {
        let (a, b) = ("ab".repeat(32), "cd".repeat(32));
        let root = |hex: &str, size| FileRoot { hash: BlobId::from_hex(hex).expect("a root").0, size };
        let two = row(&[(&a, 100, 40), (&b, 200, 120)]);
        assert_eq!(newest(&two), Some((root(&b, 200), 120)), "the last it lists");
        let edge = row(&[(&a, LARGEST + 1024, LARGEST)]);
        assert_eq!(newest(&edge), Some((root(&a, LARGEST + 1024), LARGEST)), "as large as the feed serves");
        let over = row(&[(&b, 300, 30), (&a, LARGEST + 2048, LARGEST + 1)]);
        assert_eq!(newest(&over), None, "its newest is too large, and an older one is no stand-in");
        assert_eq!(newest(&row(&[])), None, "no file");
        assert_eq!(newest(&json!({ "type": "recipe" })), None, "no files at all");
        let unopened = json!({ "files": [{ "root": a, "size": 100, "len": null }] });
        assert_eq!(newest(&unopened), None, "none the server opens");
    }

    /// A file of a row by its root is any its row lists, of its main line's or of a version it brought, and no other.
    #[test]
    fn a_rows_file_by_its_root_is_one_it_lists() {
        let (a, b, c) = ("ab".repeat(32), "cd".repeat(32), "ef".repeat(32));
        let id = |hex: &str| BlobId::from_hex(hex).expect("a root");
        let root = |hex: &str, size| FileRoot { hash: id(hex).0, size };
        let mut versions = row(&[(&a, 100, 40)]);
        let variant = json!({ "edit": c, "line": c, "files": [{ "root": b, "size": 200, "len": 120 }] });
        versions["brought"] = json!([{ "edit": a, "line": null, "files": versions["files"].clone() }, variant]);
        assert_eq!(listed_file(&versions, id(&a)), Some((root(&a, 100), 40)), "one of main's");
        assert_eq!(listed_file(&versions, id(&b)), Some((root(&b, 200), 120)), "one a variant brought");
        assert_eq!(listed_file(&versions, id(&c)), None, "none it lists");
        assert_eq!(listed_file(&row(&[(&a, 100, 40)]), id(&b)), None, "a row that brought no versions");
    }
}
