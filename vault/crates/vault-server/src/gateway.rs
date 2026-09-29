//! The HTTP gateway: how the website and the studio read files — `GET /vault/files/<hash>[.ext]`, with Range, straight
//! from Object Storage (bytes stream through, nothing is held). A public file needs nothing; any other needs a key the
//! admin approved (the Mac app's), checked with the API and remembered for five minutes.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};

use crate::{db, s3::{self, S3}};

#[derive(Clone)]
pub struct Gateway {
    pub s3: S3,
    pub db: Arc<tokio_postgres::Client>,
    pub api: String,
    pub http: reqwest::Client,
    keys: Arc<Mutex<HashMap<String, Instant>>>,
    log: crate::log::Ring,
}

impl Gateway {
    pub fn new(s3: S3, db: Arc<tokio_postgres::Client>, api: String, log: crate::log::Ring) -> Self {
        Self { s3, db, api, http: reqwest::Client::new(), keys: Default::default(), log }
    }

    pub fn router(self) -> Router {
        Router::new()
            .route("/vault/health", get(|| async { "ok" }))
            .route("/vault/files/{name}", get(file).head(file))
            .route("/vault/log", get(recent))
            .with_state(self)
    }

    /// Does this bearer key open the admin's media? Asked of the API, remembered for five minutes.
    async fn admin(&self, headers: &HeaderMap) -> bool {
        let Some(key) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")) else {
            return false;
        };
        if let Some(at) = self.keys.lock().unwrap().get(key) {
            if at.elapsed() < Duration::from_secs(300) {
                return true;
            }
        }
        let ok = self
            .http
            .get(format!("{}/api/vault/join", self.api))
            .bearer_auth(key)
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false);
        if ok {
            self.keys.lock().unwrap().insert(key.to_string(), Instant::now());
        }
        ok
    }
}

/// The server's last 300 log lines — for the admin (the app's key) only.
async fn recent(State(g): State<Gateway>, headers: HeaderMap) -> Response {
    if !g.admin(&headers).await {
        return (StatusCode::UNAUTHORIZED, "the admin's key only").into_response();
    }
    g.log.lines().join("\n").into_response()
}

async fn file(State(g): State<Gateway>, Path(name): Path<String>, headers: HeaderMap) -> Response {
    let hash = name.split('.').next().unwrap_or("").to_ascii_lowercase();
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return (StatusCode::BAD_REQUEST, "a file is named by its 64-hex BLAKE3 hash").into_response();
    }
    let Ok(Some((public, mime))) = db::public(&g.db, &hash).await else {
        return (StatusCode::NOT_FOUND, "not in the vault").into_response();
    };
    if !public && !g.admin(&headers).await {
        return (StatusCode::UNAUTHORIZED, "this file is not public").into_response();
    }
    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let res = match g.s3.get(&s3::blob_key(&hash), range).await {
        Ok(r) => r,
        Err(e) => return (StatusCode::BAD_GATEWAY, format!("storage: {e}")).into_response(),
    };
    let status = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    if status == StatusCode::NOT_FOUND {
        return (StatusCode::NOT_FOUND, "not stored yet").into_response();
    }
    let mut out = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ETAG, format!("\"{hash}\""))
        .header(
            header::CACHE_CONTROL,
            if public { "public, max-age=31536000, immutable" } else { "private, max-age=31536000, immutable" },
        )
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    for h in [header::CONTENT_LENGTH, header::CONTENT_RANGE] {
        if let Some(v) = res.headers().get(h.as_str()) {
            out = out.header(h, v.clone());
        }
    }
    out.body(Body::from_stream(res.bytes_stream())).unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}
