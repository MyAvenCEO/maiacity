//! What each source brought in, and whether it may go. Every ingest records a report (its session, story, sources and
//! each file's hash); the studio lists them by source — a card, a drive, a folder — with each file's copies. A source
//! may be released only when every one of its files is verified at every destination its story names: this Mac's
//! avenSSD read back and hashed here, the server's Object Storage read back and hashed on the server. Deleting the
//! source itself is always the person's, by hand — the app never deletes it.

use std::{io::SeekFrom, path::Path};

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::{App, Res, auth::{self, Auth}, err, gate};

#[derive(Serialize)]
pub struct SourceFile {
    pub hash: String,
    /// where it was inside the source
    pub name: String,
    pub size: u64,
    /// verified (new), duplicate (already in the vault), mismatch
    pub verdict: String,
}

#[derive(Serialize)]
pub struct IngestedSource {
    pub session: String,
    /// the story it went into (empty: the inbox)
    pub story: String,
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub files: Vec<SourceFile>,
}

/// Every source ingested (into this story, or all), newest first — a session with two folders is two sources.
#[tauri::command]
pub async fn ingest_sources(app: State<'_, App>, story: Option<String>) -> Res<Vec<IngestedSource>> {
    gate()?;
    let inbox = app.vault.catalog.inbox_id();
    // where each file lives now: a source belongs to the story its files are in (moved since, or ingested before
    // reports named their story)
    let home: std::collections::HashMap<String, String> =
        app.vault.catalog.list().await.map_err(err)?.into_iter().map(|m| (m.hash, m.story)).collect();
    let mut out = Vec::new();
    for r in app.vault.catalog.reports().await.map_err(err)? {
        let mut votes: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for f in r["files"].as_array().into_iter().flatten() {
            if let Some(s) = f["hash"].as_str().and_then(|h| home.get(h)) {
                *votes.entry(s.clone()).or_default() += 1;
            }
        }
        let rs = votes.into_iter().max_by_key(|(_, n)| *n).map(|(s, _)| s).unwrap_or_else(|| r["story"].as_str().unwrap_or("").to_string());
        let rs = if rs == inbox { String::new() } else { rs };
        if let Some(want) = &story {
            let want = if *want == inbox { "" } else { want.as_str() };
            if rs != want {
                continue;
            }
        }
        let paths: Vec<String> = r["sources"].as_array().into_iter().flatten().filter_map(|p| p.as_str().map(String::from)).collect();
        let files = r["files"].as_array().cloned().unwrap_or_default();
        for p in &paths {
            let mine: Vec<SourceFile> = files
                .iter()
                .filter(|f| f["source"].as_str().is_some_and(|s| s == p || s.starts_with(&format!("{}/", p.trim_end_matches('/')))))
                .map(|f| {
                    let src = f["source"].as_str().unwrap_or("");
                    let name = src.strip_prefix(p.trim_end_matches('/')).map(|s| s.trim_start_matches('/')).filter(|s| !s.is_empty());
                    SourceFile {
                        hash: f["hash"].as_str().unwrap_or("").to_string(),
                        name: name.map(String::from).unwrap_or_else(|| Path::new(src).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()),
                        size: f["size"].as_u64().unwrap_or(0),
                        verdict: f["verdict"].as_str().unwrap_or("").to_string(),
                    }
                })
                .collect();
            if mine.is_empty() {
                continue;
            }
            out.push(IngestedSource {
                session: r["session"].as_str().unwrap_or("").to_string(),
                story: rs.clone(),
                name: Path::new(p).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.clone()),
                path: p.clone(),
                bytes: mine.iter().map(|f| f.size).sum(),
                files: mine,
            });
        }
    }
    Ok(out)
}

#[derive(Serialize, Clone)]
pub struct Checked {
    pub hash: String,
    /// verified · missing · corrupt · unreachable
    #[serde(rename = "avenSSD")]
    pub aven: String,
    pub hetzner: String,
}

/// Before a source may go: every file read back and hashed at every destination, now. Reports each file as it goes
/// (event `release-check`); the answer says whether all of them hold. Nothing is deleted here.
#[tauri::command]
pub async fn release_check(handle: AppHandle, app: State<'_, App>, auth: State<'_, Auth>, hashes: Vec<String>) -> Res<Value> {
    gate()?;
    let key = auth::load_key_pub().ok_or("sign in first")?;
    let total = hashes.len();
    let mut out = Vec::new();
    for (i, h) in hashes.iter().enumerate() {
        let hash: iroh_blobs::Hash = h.parse().map_err(err)?;
        let aven = local(&app, hash).await;
        let hetzner = match auth.http().get(format!("{}/vault/verify/{h}", auth::api_base())).bearer_auth(&key).send().await {
            Ok(r) if r.status().is_success() => r.json::<Value>().await.ok().and_then(|v| v["state"].as_str().map(String::from)).unwrap_or_else(|| "unreachable".into()),
            _ => "unreachable".into(),
        };
        let c = Checked { hash: h.clone(), aven, hetzner };
        handle.emit("release-check", json!({ "index": i, "total": total, "file": c })).ok();
        out.push(c);
    }
    let all = out.iter().all(|c| c.aven == "verified" && c.hetzner == "verified");
    Ok(json!({ "ok": all, "files": out }))
}

/// This Mac's copy, read back from the store and hashed.
async fn local(app: &App, hash: iroh_blobs::Hash) -> String {
    use iroh_blobs::api::proto::BlobStatus;
    if !matches!(app.vault.store.blobs().status(hash).await, Ok(BlobStatus::Complete { .. })) {
        return "missing".into();
    }
    let mut reader = app.vault.store.blobs().reader(hash);
    if reader.seek(SeekFrom::Start(0)).await.is_err() {
        return "unreachable".into();
    }
    let mut hasher = blake3::Hasher::new();
    let mut buf = vec![0u8; 4 << 20];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                hasher.update(&buf[..n]);
            }
            Err(_) => return "unreachable".into(),
        }
    }
    if iroh_blobs::Hash::from(*hasher.finalize().as_bytes()) == hash { "verified".into() } else { "corrupt".into() }
}
