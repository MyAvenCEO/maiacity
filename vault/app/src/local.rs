//! The vault for this Mac's own tools (the render worker, the film scripts): plain HTTP beside the MCP server, on
//! 127.0.0.1 only and behind the same token. List the catalog, read a file (with Range, streamed from the store), add
//! a file (the three-hash check, like every ingest), describe one. Nothing here leaves the Mac.
//!
//!   GET  /vault/files                    the catalog: every file's Meta
//!   GET  /vault/files/<hash>             its bytes (Range)
//!   POST /vault/files?about=<json>       the body becomes a file: { name?, title?, description?, tags?, meta?, public? }
//!   POST /vault/describe                 { hash, title?, description?, tags?, public?, meta? } — meta merged, tags replaced

use std::{io::SeekFrom, sync::Arc};

use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures_lite::StreamExt;
use iroh_blobs::{Hash, api::proto::BlobStatus};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use vault_core::{Vault, Verdict, ingest};

pub fn router(vault: Arc<Vault>) -> Router {
    Router::new()
        .route("/vault/files", get(list).post(add))
        .route("/vault/files/{hash}", get(file))
        .route("/vault/describe", post(describe))
        // a render is gigabytes: the body is streamed to disk, never held
        .layer(DefaultBodyLimit::disable())
        .with_state(vault)
}

fn fail(status: StatusCode, e: impl std::fmt::Display) -> Response {
    (status, Json(json!({ "error": e.to_string() }))).into_response()
}

async fn list(State(v): State<Arc<Vault>>) -> Response {
    match v.catalog.list().await {
        Ok(all) => Json(all).into_response(),
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}")),
    }
}

async fn file(State(v): State<Arc<Vault>>, Path(hex): Path<String>, headers: HeaderMap) -> Response {
    let Ok(hash) = hex.split('.').next().unwrap_or("").parse::<Hash>() else { return fail(StatusCode::BAD_REQUEST, "not a hash") };
    let size = match v.store.blobs().status(hash).await {
        Ok(BlobStatus::Complete { size }) => size,
        _ => return fail(StatusCode::NOT_FOUND, "not in this Mac's vault"),
    };
    let mime = v.catalog.meta(hash).await.ok().flatten().map(|m| m.mime).unwrap_or_else(|| "application/octet-stream".into());
    let range = headers
        .get(header::RANGE)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("bytes="))
        .and_then(|r| {
            let (a, b) = r.split_once('-')?;
            let start: u64 = if a.is_empty() { size.saturating_sub(b.parse().ok()?) } else { a.parse().ok()? };
            let end: u64 = if a.is_empty() || b.is_empty() { size.saturating_sub(1) } else { b.parse::<u64>().ok()?.min(size.saturating_sub(1)) };
            Some((start, end))
        });
    let (start, end) = match range {
        Some((s, e)) if s <= e && s < size => (s, e),
        Some(_) => return (StatusCode::RANGE_NOT_SATISFIABLE, [(header::CONTENT_RANGE, format!("bytes */{size}"))]).into_response(),
        None => (0, size.saturating_sub(1)),
    };
    let len = if size == 0 { 0 } else { end - start + 1 };
    let mut reader = v.store.blobs().reader(hash);
    if reader.seek(SeekFrom::Start(start)).await.is_err() {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "the store cannot be read");
    }
    // 1 MiB at a time, until the range is sent
    let body = futures_lite::stream::unfold((reader, len), |(mut r, left)| async move {
        if left == 0 {
            return None;
        }
        let mut buf = vec![0u8; left.min(1 << 20) as usize];
        match r.read_exact(&mut buf).await {
            Ok(_) => Some((Ok::<Bytes, std::io::Error>(Bytes::from(buf)), (r, left - left.min(1 << 20)))),
            Err(e) => Some((Err(e), (r, 0))),
        }
    });
    let mut res = Response::builder()
        .status(if range.is_some() { StatusCode::PARTIAL_CONTENT } else { StatusCode::OK })
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, len.to_string());
    if range.is_some() {
        res = res.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
    }
    res.body(Body::from_stream(body)).unwrap_or_default()
}

#[derive(Deserialize)]
struct AddQuery {
    about: Option<String>,
}

#[derive(Deserialize, Default)]
struct About {
    name: Option<String>,
    title: Option<String>,
    description: Option<String>,
    tags: Option<Vec<String>>,
    meta: Option<Value>,
    public: Option<bool>,
    /// the story it goes into (its id); none: the inbox
    story: Option<String>,
    /// default · original · proxy · delivery; none: told from the file
    class: Option<String>,
}

async fn add(State(v): State<Arc<Vault>>, Query(q): Query<AddQuery>, body: Body) -> Response {
    let about: About = match q.about.as_deref().map(serde_json::from_str).transpose() {
        Ok(a) => a.unwrap_or_default(),
        Err(e) => return fail(StatusCode::BAD_REQUEST, format!("about is not JSON: {e}")),
    };
    // the name it came in as; never a path
    let name = about.name.as_deref().and_then(|n| std::path::Path::new(n).file_name()).and_then(|n| n.to_str()).unwrap_or("file").to_string();
    // written beside the store (the same volume), in a folder of its own so the name is kept
    let dir = v.ingest_dir().join(format!("local-{}", iroh::SecretKey::generate().public().fmt_short()));
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    let path = dir.join(&name);
    let written = async {
        let mut f = tokio::fs::File::create(&path).await?;
        let mut stream = body.into_data_stream();
        while let Some(chunk) = stream.next().await {
            f.write_all(&chunk.map_err(std::io::Error::other)?).await?;
        }
        f.sync_all().await
    };
    if let Err(e) = written.await {
        tokio::fs::remove_dir_all(&dir).await.ok();
        return fail(StatusCode::BAD_REQUEST, format!("the upload broke off: {e}"));
    }
    let batch = ingest::Batch {
        session: ingest::now_iso(),
        tags: about.tags.clone().unwrap_or_default(),
        title: about.title.clone(),
        description: about.description.clone(),
        meta: about.meta.clone().unwrap_or(Value::Null),
        public: about.public.unwrap_or(false),
        story: about.story.clone(),
        class: about.class.clone(),
        // a pipeline adds what it made; a file that is already somewhere stays there
        moves_existing: false,
    };
    let outcome = v.ingest_file(&path, &batch).await;
    tokio::fs::remove_dir_all(&dir).await.ok();
    let o = match outcome {
        Ok(o) => o,
        Err(e) => return fail(StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}")),
    };
    if o.verdict == Verdict::Mismatch {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "the three hashes disagree: not kept");
    }
    let Ok(hash) = o.hash.parse::<Hash>() else { return fail(StatusCode::INTERNAL_SERVER_ERROR, "no hash") };
    // the same bytes again: the file was there already — what the caller says about it still applies
    if o.verdict == Verdict::Duplicate {
        let patch = json!({ "title": about.title, "description": about.description, "tags": about.tags, "public": about.public, "meta": about.meta });
        if let Err(e) = v.catalog.describe(hash, &strip_nulls(patch)).await {
            return fail(StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}"));
        }
    }
    let meta = v.catalog.meta(hash).await.ok().flatten();
    (StatusCode::CREATED, Json(json!({ "hash": o.hash, "verdict": o.verdict, "meta": meta }))).into_response()
}

fn strip_nulls(v: Value) -> Value {
    match v {
        Value::Object(m) => Value::Object(m.into_iter().filter(|(_, v)| !v.is_null()).collect()),
        other => other,
    }
}

async fn describe(State(v): State<Arc<Vault>>, Json(body): Json<Value>) -> Response {
    let Some(hash) = body.get("hash").and_then(|h| h.as_str()).and_then(|h| h.parse::<Hash>().ok()) else {
        return fail(StatusCode::BAD_REQUEST, "which file? (hash)");
    };
    let mut patch = strip_nulls(body);
    if let Value::Object(m) = &mut patch {
        m.remove("hash");
    }
    match v.catalog.describe(hash, &patch).await {
        Ok(meta) => Json(meta).into_response(),
        Err(e) => fail(StatusCode::NOT_FOUND, format!("{e:#}")),
    }
}
