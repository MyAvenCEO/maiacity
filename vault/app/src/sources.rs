//! What each source brought in, and whether it may go. Every ingest records a report (its session, story, sources and
//! each file's hash); the studio lists them by source — a card, a drive, a folder — with each file's copies. A source
//! may go only when every one of its files is kept where its story says: at every destination its class names, at
//! least two. That is iroh's word, not read back again: every copy was verified by hash on its way in (the three-hash
//! ingest here, every chunk on the way to Object Storage). Its files then go to the Trash — by hand in the app, after
//! the person confirmed exactly what goes, never by an agent — each read once more to be sure it is the bytes that came
//! in. Bit rot at rest is a scrub's business, in the background, not this.

use std::path::Path;

use serde::Serialize;
use serde_json::{Value, json};
use tauri::State;

use crate::{App, Res, auth::Auth, err, gate};

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
    sources_of(&app, story).await
}

async fn sources_of(app: &App, story: Option<String>) -> Res<Vec<IngestedSource>> {
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

/// One file of a source, before it may go: is it kept where its story says (every destination its class names, at
/// least two)?
#[derive(Serialize, Clone)]
pub struct Release {
    pub name: String,
    pub hash: String,
    pub size: u64,
    /// this Mac's store (B): complete, verified by hash on the way in
    pub local: bool,
    /// the server's Object Storage (A): stored, every chunk verified on the way
    pub cloud: bool,
    /// the story's rule for its class holds (and names at least two places)
    pub kept: bool,
    pub why: String,
}

/// Whether a source may go, file by file — from what iroh already verified (nothing read back): B complete in this
/// Mac's store, A stored by the server, and every destination its story names for its class there.
#[tauri::command]
pub async fn source_ready(app: State<'_, App>, auth: State<'_, Auth>, session: String, path: String) -> Res<Vec<Release>> {
    gate()?;
    ready(&app, &auth, &session, &path).await
}

async fn ready(app: &App, auth: &Auth, session: &str, path: &str) -> Res<Vec<Release>> {
    use iroh_blobs::api::proto::BlobStatus;
    let source = sources_of(app, None).await?.into_iter().find(|s| s.session == session && s.path == path).ok_or("no such source")?;
    // A: the server's own entries in the catalog — iroh's word, from this Mac's replica
    let _ = auth;
    let stored = crate::sync::held_by_server(&app.vault).await.ok_or("this Mac has not joined the vault yet — it cannot tell what Object Storage holds")?;
    let stories = app.vault.catalog.stories().await.map_err(err)?;
    let inbox = app.vault.catalog.inbox_id();
    let mut out = Vec::new();
    for f in source.files {
        let hash: iroh_blobs::Hash = f.hash.parse().map_err(err)?;
        let meta = app.vault.catalog.meta(hash).await.map_err(err)?;
        let local = matches!(app.vault.store.blobs().status(hash).await, Ok(BlobStatus::Complete { .. }));
        let cloud = stored.contains(&f.hash);
        let (story_id, class) = meta.as_ref().map(|m| (if m.story.is_empty() { inbox.clone() } else { m.story.clone() }, m.class.clone())).unwrap_or_default();
        let rules = stories.iter().find(|s| s.id == story_id).map(|s| s.rules.clone()).unwrap_or_default();
        let wants = match class.as_str() {
            "original" => rules.original,
            "proxy" => rules.proxy,
            "delivery" => rules.delivery,
            _ => rules.default,
        };
        let at = |d: &str| match d {
            "avenSSD" => local,
            "hetzner" => cloud,
            _ => false,
        };
        let missing: Vec<&str> = wants.iter().map(|d| d.as_str()).filter(|d| !at(d)).collect();
        let why = if f.verdict == "mismatch" {
            "it did not hash the same on the way in".to_string()
        } else if wants.len() < 2 {
            format!("its story keeps it in {} place(s) — two at least", wants.len())
        } else if !missing.is_empty() {
            format!("not yet at {}", missing.join(", "))
        } else {
            String::new()
        };
        out.push(Release { kept: why.is_empty(), why, name: f.name, hash: f.hash, size: f.size, local, cloud });
    }
    Ok(out)
}

/// The source's files to the Trash — by hand in the app only, never by an agent. Only when every file is kept as its
/// story says; and each is read once more first: a file on the source that is not the very bytes that came in stays
/// where it is. The Trash keeps them until it is emptied.
#[tauri::command]
pub async fn source_delete(app: State<'_, App>, auth: State<'_, Auth>, session: String, path: String) -> Res<Value> {
    gate()?;
    let files = ready(&app, &auth, &session, &path).await?;
    if let Some(f) = files.iter().find(|f| !f.kept) {
        return Err(format!("{} is not kept as its story says ({}) — nothing was moved", f.name, f.why));
    }
    let root = Path::new(&path);
    let (mut moved, mut bytes, mut left) = (0usize, 0u64, Vec::new());
    for f in &files {
        let file = if root.is_file() { root.to_path_buf() } else { root.join(&f.name) };
        if !file.exists() {
            left.push(json!({ "name": f.name, "why": "already gone" }));
            continue;
        }
        let check = file.clone();
        let same = tokio::task::spawn_blocking(move || vault_core::hash::hash_from_disk(&check).map(|h| h.to_hex().to_string()))
            .await
            .map_err(err)?
            .map(|h| h == f.hash)
            .unwrap_or(false);
        if !same {
            left.push(json!({ "name": f.name, "why": "not the bytes that came in — left where it is" }));
            continue;
        }
        match trash::delete(&file) {
            Ok(()) => {
                moved += 1;
                bytes += f.size;
            }
            Err(e) => left.push(json!({ "name": f.name, "why": format!("the Trash refused it: {e}") })),
        }
    }
    tracing::info!("source {path}: {moved} files ({bytes} B) to the Trash, {} left", left.len());
    Ok(json!({ "moved": moved, "bytes": bytes, "left": left }))
}
