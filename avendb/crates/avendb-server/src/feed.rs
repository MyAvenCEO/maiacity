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
//! too, once for the three, and takes what each asks from that.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result};
use avendb::id::{EntryId, VaultId};
use avendb::world;
use avendb_net::Node;
use http_body_util::Full;
use hyper::body::{Bytes, Incoming};
use hyper::header::{self, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde_json::{Value, json};
use tokio::net::TcpListener;

use crate::Abort;

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

/// The most kinds one query names.
const MOST_KINDS: usize = 16;

/// The most bytes of a picture the feed serves, which it reads whole.
const LARGEST: u64 = 32 << 20;

/// How long a picture is served again from a cache: it is named by its content, but may stop being public.
const KEPT: &str = "public, max-age=300";

/// How long the feed the server worked out is served again before it works it out anew.
const FRESH: Duration = Duration::from_secs(5);

/// The most posts the feed holds, the newest.
const MOST: usize = 200;

/// What the server last worked out of a feed: when, and what.
type Kept<T> = Arc<Mutex<Option<(Instant, T)>>>;

/// What the server last worked out of each: the feed's JSON, and the entries everyone may read (`Listed`).
#[derive(Clone, Default)]
struct Feeds {
    posts: Kept<Bytes>,
    entries: Kept<Listed>,
}

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
    pub async fn spawn(bind: SocketAddr, node: Arc<Node>) -> Result<Feed> {
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
                let (node, feeds) = (node.clone(), feeds.clone());
                tokio::spawn(async move {
                    let service = service_fn(move |request| answer(request, node.clone(), feeds.clone()));
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

/// The answer to `request`: for a GET or HEAD, the feed of `PATH`, a picture of `FILES` (`picture`), the entries of
/// `ENTRIES` or the code of `CODE` (`listed`), or an entry of `ENTRY` (`entry`); nothing for a browser's OPTIONS before
/// any of them; and not found for anything else.
async fn answer(
    request: Request<Incoming>,
    node: Arc<Node>,
    feeds: Feeds,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let path = request.uri().path();
    let reads = matches!(*request.method(), Method::GET | Method::HEAD);
    if let Some(at) = path.strip_prefix(FILES).filter(|_| reads) {
        return Ok(picture(at, &node).await);
    }
    let query = request.uri().query().unwrap_or_default();
    let ours = [PATH, ENTRIES, CODE].contains(&path) || path.starts_with(FILES) || path.starts_with(ENTRY);
    let (status, body) = match path.strip_prefix(ENTRY) {
        Some(at) if reads => entry(at, query, &node, &feeds.entries).await,
        _ if reads && path == PATH => (StatusCode::OK, posts(&node, &feeds.posts).await),
        _ if reads && [ENTRIES, CODE].contains(&path) => listed(path == CODE, query, &node, &feeds.entries).await,
        _ if *request.method() == Method::OPTIONS && ours => (StatusCode::NO_CONTENT, Bytes::new()),
        _ => (StatusCode::NOT_FOUND, error("no such feed")),
    };
    let mut response = Response::new(Full::new(body));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, HEAD, OPTIONS"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=10"));
    Ok(response)
}

/// What `kept` holds, if the server worked it out a moment ago (`FRESH`), else what `work` works out anew, kept.
async fn fresh_or<T: Clone>(kept: &Kept<T>, work: impl Future<Output = T>) -> T {
    let fresh = kept.lock().expect("the feed").as_ref().filter(|(at, _)| at.elapsed() < FRESH).map(|k| k.1.clone());
    if let Some(t) = fresh {
        return t;
    }
    let t = work.await;
    *kept.lock().expect("the feed") = Some((Instant::now(), t.clone()));
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
    bare: bool,
}

impl Asked {
    /// Query `query`, `seed=1&vault=<64 hex>&type=view,logic&bare=1`, each part optional, `kind` another name for
    /// `type`, any other part left alone (a page's cache buster, say): why not, for a vault that isn't a vault's id, more
    /// kinds than `MOST_KINDS`, or, of the code (`code`), a kind that isn't one of code's (`world::CODE_KINDS`). No kind
    /// at all keeps every kind.
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

    /// Row `row` is of the seed's coop, of the vault and of a kind it asks for: of the coop by where its vault stands
    /// in the server's seed (`world::public_entries`), never by its name.
    fn keeps(&self, row: &Value) -> bool {
        let is = |field: &str, v: &str| row[field].as_str() == Some(v);
        (!self.seed || is("seed", world::SEED_COOP))
            && self.vault.as_deref().is_none_or(|v| is("vault", v))
            && self.kinds.as_ref().is_none_or(|ks| ks.iter().any(|k| is("type", k)))
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

/// An answer of `status` that says `why`, as text.
fn plain(status: StatusCode, why: &'static str) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(Bytes::from_static(why.as_bytes())));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/plain; charset=utf-8"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    response
}
