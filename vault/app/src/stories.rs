//! Stories in the studio: the buckets everything of one story lives in (originals, proxies, sound, stills, metadata,
//! deliveries), and the inbox for everything that belongs to none yet. A file has one story; its class (default,
//! original, proxy, delivery) says which of the story's destinations keep it. Only the admin's app writes them.


use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{Value, json};
use tauri::State;
use vault_core::catalog::{CLASSES, Story};

use crate::{App, Res, err, gate};

/// A story as the studio lists it: the story, and what it holds per class.
#[derive(Serialize)]
pub struct StoryView {
    #[serde(flatten)]
    pub story: Story,
    pub inbox: bool,
    pub files: usize,
    pub bytes: u64,
    /// class → (files, bytes)
    pub classes: BTreeMap<String, (usize, u64)>,
}

#[tauri::command]
pub async fn stories_list(app: State<'_, App>) -> Res<Vec<StoryView>> {
    gate()?;
    let v = &app.vault;
    let inbox = v.catalog.inbox_id();
    let files = v.catalog.list().await.map_err(err)?;
    let mut out = Vec::new();
    for story in v.catalog.stories().await.map_err(err)? {
        let is_inbox = story.id == inbox;
        let mine: Vec<_> = files.iter().filter(|m| if is_inbox { m.story.is_empty() } else { m.story == story.id }).collect();
        let mut classes: BTreeMap<String, (usize, u64)> = CLASSES.iter().map(|c| (c.to_string(), (0, 0))).collect();
        for m in &mine {
            let c = classes.entry(if m.class.is_empty() { "default".into() } else { m.class.clone() }).or_default();
            c.0 += 1;
            c.1 += m.size;
        }
        out.push(StoryView { files: mine.len(), bytes: mine.iter().map(|m| m.size).sum(), inbox: is_inbox, classes, story: Story { key: String::new(), ..story } });
    }
    Ok(out)
}

/// Create a story (without an id) or change one: title (at most five words), description, series, episode, rules.
#[tauri::command]
pub async fn story_save(app: State<'_, App>, story: Story) -> Res<Story> {
    gate()?;
    let saved = app.vault.catalog.save_story(story).await.map_err(err)?;
    Ok(Story { key: String::new(), ..saved })
}

/// Remove an empty story (never the inbox). By hand in the app only — never by an agent.
#[tauri::command]
pub async fn story_delete(app: State<'_, App>, id: String) -> Res<()> {
    gate()?;
    app.vault.catalog.delete_story(&id).await.map_err(err)
}

/// Files into a story (its id; the inbox's id takes them out of every story). A file has one story, so this moves it.
/// By hand in the app only (the admin confirms) — never by an agent.
#[tauri::command]
pub async fn files_move(app: State<'_, App>, hashes: Vec<String>, story: String) -> Res<usize> {
    gate()?;
    patch_all(&app, &hashes, json!({ "story": story })).await
}

/// Files into a class, by hand: default or original. Proxy and delivery are written only by their pipelines (the
/// proxy maker, the render worker).
#[tauri::command]
pub async fn files_class(app: State<'_, App>, hashes: Vec<String>, class: String) -> Res<usize> {
    gate()?;
    by_hand(&class)?;
    patch_all(&app, &hashes, json!({ "class": class })).await
}

/// The classes a person (or an agent) may set.
pub fn by_hand(class: &str) -> Res<()> {
    match class {
        "default" | "original" => Ok(()),
        "proxy" | "delivery" => Err(format!("{class} is written only by its pipeline")),
        other => Err(format!("no such class: {other}")),
    }
}

async fn patch_all(app: &App, hashes: &[String], patch: Value) -> Res<usize> {
    for h in hashes {
        let hash: iroh_blobs::Hash = h.parse().map_err(err)?;
        app.vault.catalog.describe(hash, &patch).await.map_err(err)?;
    }
    Ok(hashes.len())
}

/// A file out of the vault into this Mac's Downloads folder, under the name it came in as (` (2)`, ` (3)`… when one is
/// there already): copied from the store, its BLAKE3 checked on the way out. Returns where it went; the Finder shows
/// it.
#[tauri::command]
pub async fn file_download(app: State<'_, App>, hash: String, name: Option<String>) -> Res<String> {
    gate()?;
    let at = download(&app.vault, &hash, name.as_deref()).await?;
    let _ = std::process::Command::new("open").arg("-R").arg(&at).spawn();
    Ok(at)
}

/// The same, for the app and the MCP alike: where the copy went.
pub async fn download(vault: &vault_core::Vault, hash: &str, name: Option<&str>) -> Res<String> {
    let h: iroh_blobs::Hash = hash.parse().map_err(err)?;
    match vault.store.blobs().status(h).await.map_err(err)? {
        iroh_blobs::api::blobs::BlobStatus::Complete { .. } => {}
        _ => return Err("its bytes are not all on this Mac yet".into()),
    }
    let home = std::env::var_os("HOME").ok_or("no home folder")?;
    let dir = std::path::PathBuf::from(home).join("Downloads");
    std::fs::create_dir_all(&dir).map_err(err)?;
    // only the name's last part, nothing that climbs out of Downloads
    let name = name
        .and_then(|n| std::path::Path::new(n).file_name())
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty() && !n.starts_with('.'))
        .unwrap_or_else(|| format!("{}.bin", &hash[..12.min(hash.len())]));
    let path = std::path::Path::new(&name);
    let (stem, ext) = (path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(), path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default());
    let mut target = dir.join(&name);
    let mut n = 2;
    while target.exists() {
        target = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    // written next to it first, so Downloads never shows half a file
    let part = dir.join(format!(".{}.part", target.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default()));
    vault.store.blobs().export(h, &part).await.map_err(|e| format!("out of the vault: {e}"))?;
    std::fs::rename(&part, &target).map_err(err)?;
    // the copy checked against the hash it is known by
    let check = target.clone();
    let got = tauri::async_runtime::spawn_blocking(move || -> std::io::Result<String> {
        let mut hasher = blake3::Hasher::new();
        hasher.update_reader(std::fs::File::open(&check)?)?;
        Ok(hasher.finalize().to_hex().to_string())
    })
    .await
    .map_err(err)?
    .map_err(err)?;
    if got != h.to_hex().to_string() {
        std::fs::remove_file(&target).ok();
        return Err("the copy in Downloads did not match its hash: removed".into());
    }
    tracing::info!("downloaded {} → {}", &hash[..12.min(hash.len())], target.display());
    Ok(target.to_string_lossy().to_string())
}

/// Every old day and what it is called now: the one list the site and the scripts read too.
const LEGACY: &str = include_str!("../../../src/lib/stories/legacy.json");

// ── the Stories board's stories, each in its bucket ──────────────────────────────────────────────────────────────

/// Every story on the board past its idea that is in no bucket yet (GET /api/content/unfiled) is filed in the vault
/// story of its name (its project — "233 settlers, how it starts" — else its title): the one there is, or a new one,
/// its title the name (five words at most) and its description the hook. The board is told
/// (PUT /api/content/:id/story). Now, and every two minutes while this Mac is signed in.
pub async fn file_sweep(app: tauri::AppHandle, vault: std::sync::Arc<vault_core::Vault>) {
    use tauri::Manager;
    // first, once the catalog has had a moment to sync: the old days' names put away — buckets named by a day merged
    // into their story's and named by it, no episodes, the files' day tags as their ideas' (vault-core, tidy_legacy)
    tokio::time::sleep(std::time::Duration::from_secs(20)).await;
    if crate::auth::signed_in() {
        match serde_json::from_str::<Vec<vault_core::catalog::Legacy>>(LEGACY) {
            Ok(legacy) => match vault.catalog.tidy_legacy(&legacy).await {
                Ok(did) => did.iter().for_each(|d| tracing::info!("the old days put away: {d}")),
                Err(e) => tracing::warn!("putting the old days away: {e:#}"),
            },
            Err(e) => tracing::warn!("the old days' names (legacy.json): {e}"),
        }
    }
    loop {
        if crate::auth::signed_in() {
            let auth = app.state::<crate::auth::Auth>();
            if let Err(e) = file_round(&auth, &vault).await {
                tracing::warn!("filing the board's stories in the vault: {e}");
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(120)).await;
    }
}

async fn file_round(auth: &crate::auth::Auth, vault: &vault_core::Vault) -> Result<(), String> {
    let got = auth.get_ok("GET", "/api/content/unfiled", None).await?;
    let items = got["items"].as_array().cloned().unwrap_or_default();
    if items.is_empty() {
        return Ok(());
    }
    let inbox = vault.catalog.inbox_id();
    let mut stories = vault.catalog.stories().await.map_err(err)?;
    for it in items {
        let Some(id) = it["id"].as_str() else { continue };
        let name = it["project"].as_str().filter(|p| !p.trim().is_empty()).or(it["title"].as_str()).unwrap_or_default().trim().to_string();
        if name.is_empty() {
            continue;
        }
        // the old day it was, from the folder its article came from (blog/day-19-…), to find a bucket still named by it
        let day = it["source"].as_str().and_then(|p| p.split('/').find_map(|seg| seg.strip_prefix("day-")?.split('-').next()?.parse::<u32>().ok()));
        let story = match vault_core::catalog::bucket_for(&stories, &inbox, &name, day) {
            Some(s) => s.clone(),
            None => {
                let series = stories.iter().find(|s| !s.series.is_empty()).map(|s| s.series.clone()).unwrap_or_else(|| "The Journey of Maia City".into());
                let made = vault
                    .catalog
                    .save_story(Story { title: vault_core::catalog::title_of(&name), description: it["hook"].as_str().unwrap_or_default().to_string(), series, ..Default::default() })
                    .await
                    .map_err(err)?;
                tracing::info!("a new story in the vault for \"{name}\": {}", made.title);
                stories.push(made.clone());
                made
            }
        };
        auth.get_ok("PUT", &format!("/api/content/{id}/story"), Some(json!({ "story": story.id }))).await?;
        tracing::info!("\"{name}\" filed in the vault's story \"{}\"", story.title);
    }
    Ok(())
}
