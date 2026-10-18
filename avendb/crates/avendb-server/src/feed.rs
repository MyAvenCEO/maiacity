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
//! too, once for the three, and takes what each asks from that. Each row lists the files its entry's main line brings
//! that every reader counts as the entry's (`files`, `{root, size, len}`, oldest first, `Lab::line_files`), and the
//! newest of a code entry's is served whole at `GET /feed/entry/<vault>/<entry>/file` (`OF_ENTRY`, `source`): a
//! recipe's source, say, as plain text that no page runs as a script, which its loader checks against its hash. An
//! entry whose writes bring files more than once, as an asset's versions and variants each do, lists each of those
//! writes with the record at it (`brought`, `Lab::brought`), and any file a row lists is served by its root at `GET
//! /feed/entry/<vault>/<entry>/file/<root>` (`OF_ROOT`).
//!
//! And the media the legacy media vault published, by the BLAKE3 hash the site has always named them by
//! (`GET /feed/legacy/<hash>`, `LEGACY`): the public file entry tagged `legacy:<hash>`, as the Mac app's copy out of the
//! legacy vault tags each file it brings (vault/app/src/legacy_copy.rs, Public by its `legacy:public` tag), served
//! with its media type and by range, so a page's `<video>` and `<audio>` play it as the old gateway served it
//! (src/lib/media/url.ts).

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result};
use avendb::id::{BlobId, EntryId, VaultId};
use avendb::sealed::FileRoot;
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

/// Where the newest file of a code entry everyone may read is served, after its entry's place: `ENTRY`
/// `<vault>/<entry>` `OF_ENTRY` (`source`).
pub const OF_ENTRY: &str = "/file";

/// Where one file of a code entry everyone may read is served, by its root, after its entry's place: `ENTRY`
/// `<vault>/<entry>` `OF_ROOT` `<root>`, its root in 64 hex digits (`source`): any of the files its row lists, as an
/// asset's versions each bring their own (`brought`).
pub const OF_ROOT: &str = "/file/";

/// Where a file the legacy media vault published is served, at `LEGACY` `<hash>`: its BLAKE3 hash, 64 hex digits, and
/// an extension after it if any (`legacy`).
pub const LEGACY: &str = "/feed/legacy/";

/// The tag before a file's legacy hash (`LEGACY`), as the Mac app's copy tags it.
const LEGACY_TAG: &str = "legacy:";

/// The most bytes one ranged answer of `LEGACY` carries: a player asks for the next range.
const RANGE: u64 = 8 << 20;

/// The most kinds one query names.
const MOST_KINDS: usize = 16;

/// The most bytes of a picture or of a code entry's file the feed serves, which it reads whole.
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
/// `ENTRIES` or the code of `CODE` (`listed`), an entry of `ENTRY` (`entry`), or a file of it (`OF_ENTRY`, `OF_ROOT`,
/// `source`); nothing for a browser's OPTIONS before any of them; and not found for anything else.
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
    if let Some(at) = path.strip_prefix(LEGACY).filter(|_| reads) {
        let range = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok()).map(str::to_string);
        return Ok(legacy(at, range.as_deref(), &node, &feeds.entries).await);
    }
    let query = request.uri().query().unwrap_or_default();
    if let Some(at) = path.strip_prefix(ENTRY).and_then(|at| at.strip_suffix(OF_ENTRY)).filter(|_| reads) {
        return Ok(source(at, None, query, &node, &feeds.entries).await);
    }
    if let Some((at, root)) = path.strip_prefix(ENTRY).and_then(by_root).filter(|_| reads) {
        return Ok(source(at, Some(root), query, &node, &feeds.entries).await);
    }
    let ours = [PATH, ENTRIES, CODE].contains(&path) || [FILES, ENTRY, LEGACY].iter().any(|p| path.starts_with(p));
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

/// Place `at` after `ENTRY` as a file of an entry by its root, `<vault>/<entry>` `OF_ROOT` `<root>`: the entry's place
/// and the root, as written.
fn by_root(at: &str) -> Option<(&str, &str)> {
    at.split_once(OF_ROOT).filter(|(_, root)| !root.contains('/'))
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

/// The answer to a GET or HEAD of `LEGACY` `at`, `<hash>` or `<hash>.<ext>`, with header `range` if any: the newest
/// file of the file entry everyone may read that is tagged `legacy:<hash>` (`entries`, `legacy_row`), with the media
/// type its record says; whole (at most `LARGEST` bytes, else its first `RANGE`), or the one range `range` asks for,
/// at most `RANGE` bytes of it, as partial content. Not found for a hash that is none, or for no such public file;
/// not satisfiable for a range past its end; and unavailable while the server can't read its bytes.
async fn legacy(at: &str, range: Option<&str>, node: &Node, kept: &Kept<Listed>) -> Response<Full<Bytes>> {
    let hash = at.split('.').next().unwrap_or_default().to_ascii_lowercase();
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) || at.contains('/') {
        return plain(StatusCode::NOT_FOUND, "no such file");
    }
    let listed = entries(node, kept).await;
    let Some(row) = legacy_row(&listed.rows, &hash) else { return plain(StatusCode::NOT_FOUND, "no such file") };
    let file = row["files"].as_array().and_then(|fs| fs.last()).and_then(|f| {
        Some((FileRoot { hash: BlobId::from_hex(f["root"].as_str()?)?.0, size: f["size"].as_u64()? }, f["len"].as_u64()?))
    });
    let Some((root, len)) = file else { return plain(StatusCode::NOT_FOUND, "no such file") };
    let media = row["record"]["media"].as_str().filter(|m| !m.is_empty()).unwrap_or("application/octet-stream");
    let media = HeaderValue::from_str(media).unwrap_or(HeaderValue::from_static("application/octet-stream"));
    let (from, to, partial) = match range.map(|r| ranged(r, len)) {
        None if len <= LARGEST => (0, len, false),
        None => (0, RANGE.min(len), true),
        Some(Some((from, to))) => (from, to.min(from + RANGE), true),
        Some(None) => {
            let mut response = plain(StatusCode::RANGE_NOT_SATISFIABLE, "no such range of this file");
            let whole = HeaderValue::from_str(&format!("bytes */{len}")).expect("a header");
            response.headers_mut().insert(header::CONTENT_RANGE, whole);
            return response;
        }
    };
    let bytes = match node.read_file(root, from..to).await {
        Ok(bytes) => bytes,
        Err(e) => {
            tracing::debug!("avenDB feed: the legacy file {hash}: {e:#}");
            return plain(StatusCode::SERVICE_UNAVAILABLE, "the server can't read this file yet");
        }
    };
    let mut response = Response::new(Full::new(Bytes::from(bytes)));
    if partial {
        *response.status_mut() = StatusCode::PARTIAL_CONTENT;
        let at = format!("bytes {from}-{}/{len}", to.saturating_sub(1).max(from));
        response.headers_mut().insert(header::CONTENT_RANGE, HeaderValue::from_str(&at).expect("a header"));
    }
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, media);
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(KEPT));
    response
}

/// The row of `rows` (`world::public_entries`) of the file entry tagged `legacy:<hash>`, `hash` in lower case, that
/// brings a file the server opens: the newest such, where the copy brought one more than once.
fn legacy_row<'a>(rows: &'a [Value], hash: &str) -> Option<&'a Value> {
    let tag = format!("{LEGACY_TAG}{hash}");
    let tagged = |row: &&Value| row["tags"].as_array().is_some_and(|ts| ts.iter().any(|t| t.as_str() == Some(&tag)));
    let opened = |row: &&Value| row["files"].as_array().and_then(|fs| fs.last()).is_some_and(|f| f["len"].is_u64());
    let rows = rows.iter().filter(|row| row["type"] == "file").filter(tagged).filter(opened);
    rows.max_by_key(|row| row["created"].as_u64().unwrap_or(0))
}

/// The one range header `range` asks of a file of `len` bytes, `bytes=<from>-<to>`, `bytes=<from>-` or
/// `bytes=-<last n>`: its start and its end, the end past its last byte; none for one past the file's end, or one this
/// can't read.
fn ranged(range: &str, len: u64) -> Option<(u64, u64)> {
    let (a, b) = range.trim().strip_prefix("bytes=")?.split_once('-')?;
    let (from, to) = match (a.trim(), b.trim()) {
        ("", n) => (len.saturating_sub(n.parse().ok()?), len),
        (f, "") => (f.parse().ok()?, len),
        (f, t) => (f.parse().ok()?, t.parse::<u64>().ok()?.saturating_add(1).min(len)),
    };
    (from < to && from < len).then_some((from, to))
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

    /// A range header reads as the bytes it asks for, its end past its last byte, cut at the file's end; one past the
    /// end, or one this can't read, is none.
    #[test]
    fn a_range_reads_as_the_bytes_it_asks_for() {
        assert_eq!(ranged("bytes=0-99", 1000), Some((0, 100)));
        assert_eq!(ranged("bytes=900-", 1000), Some((900, 1000)));
        assert_eq!(ranged("bytes=-100", 1000), Some((900, 1000)));
        assert_eq!(ranged("bytes=500-5000", 1000), Some((500, 1000)), "cut at its end");
        assert_eq!(ranged("bytes=1000-", 1000), None, "past its end");
        assert_eq!(ranged("bytes=9-3", 1000), None, "backwards");
        assert_eq!(ranged("items=0-1", 1000), None, "not bytes");
    }

    /// A legacy hash names the newest public file entry tagged with it whose file the server opens, and no other.
    #[test]
    fn a_legacy_hash_names_the_newest_file_tagged_with_it() {
        let (h, other) = ("ab".repeat(32), "cd".repeat(32));
        let file = |tag: &str, created: u64, len: Value| {
            json!({ "type": "file", "tags": [format!("legacy:{tag}")], "created": created,
                "files": [{ "root": "ef".repeat(32), "size": 10, "len": len }] })
        };
        let rows = vec![file(&h, 1, json!(4)), file(&h, 3, json!(4)), file(&h, 5, Value::Null), file(&other, 9, json!(4))];
        assert_eq!(legacy_row(&rows, &h).map(|r| r["created"].clone()), Some(json!(3)), "the newest it opens");
        assert!(legacy_row(&rows, &"12".repeat(32)).is_none(), "none tagged so");
        let note = json!({ "type": "note", "tags": [format!("legacy:{h}")], "files": [] });
        assert!(legacy_row(&[note], &h).is_none(), "a file entry's alone");
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
