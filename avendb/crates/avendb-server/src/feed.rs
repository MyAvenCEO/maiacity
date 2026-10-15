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

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result};
use avendb::id::VaultId;
use avendb::world;
use avendb_net::Node;
use http_body_util::Full;
use hyper::body::{Bytes, Incoming};
use hyper::header::{self, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde_json::json;
use tokio::net::TcpListener;

use crate::Abort;

/// Where the feed is served.
pub const PATH: &str = "/feed/posts";

/// Where the pictures everyone may read are served, each at `FILES` `<vault>/<name>`: its vault in 64 hex digits, and
/// the name an article shows it by.
pub const FILES: &str = "/feed/files/";

/// The most bytes of a picture the feed serves, which it reads whole.
const LARGEST: u64 = 32 << 20;

/// How long a picture is served again from a cache: it is named by its content, but may stop being public.
const KEPT: &str = "public, max-age=300";

/// How long the feed the server worked out is served again before it works it out anew.
const FRESH: Duration = Duration::from_secs(5);

/// The most posts the feed holds, the newest.
const MOST: usize = 200;

/// The feed as the server last worked it out: when, and its JSON.
type Last = Arc<Mutex<Option<(Instant, Bytes)>>>;

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
        let last: Last = Arc::default();
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
                let (node, last) = (node.clone(), last.clone());
                tokio::spawn(async move {
                    let service = service_fn(move |request| answer(request, node.clone(), last.clone()));
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

/// The answer to `request`: the feed for a GET or HEAD of `PATH`, a picture for one of `FILES` (`picture`), nothing
/// for a browser's OPTIONS before either, and not found for anything else.
async fn answer(request: Request<Incoming>, node: Arc<Node>, last: Last) -> Result<Response<Full<Bytes>>, Infallible> {
    let path = request.uri().path();
    if let Some(at) = path.strip_prefix(FILES).filter(|_| matches!(*request.method(), Method::GET | Method::HEAD)) {
        return Ok(picture(at, &node).await);
    }
    let (status, body) = match (request.method(), path) {
        (&Method::GET | &Method::HEAD, PATH) => (StatusCode::OK, posts(&node, &last).await),
        (&Method::OPTIONS, _) if path == PATH || path.starts_with(FILES) => (StatusCode::NO_CONTENT, Bytes::new()),
        _ => (StatusCode::NOT_FOUND, Bytes::from_static(br#"{"error":"no such feed"}"#)),
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

/// The feed's JSON: as the server last worked it out, if that was a moment ago (`FRESH`), else anew.
async fn posts(node: &Node, last: &Last) -> Bytes {
    let fresh = |l: &Option<(Instant, Bytes)>| l.as_ref().filter(|(at, _)| at.elapsed() < FRESH).map(|l| l.1.clone());
    if let Some(body) = fresh(&last.lock().expect("the feed")) {
        return body;
    }
    let mut posts = node.read(world::public_posts).await;
    posts.truncate(MOST);
    let body = Bytes::from(serde_json::to_vec(&json!({ "posts": posts })).expect("JSON writes"));
    *last.lock().expect("the feed") = Some((Instant::now(), body.clone()));
    body
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
