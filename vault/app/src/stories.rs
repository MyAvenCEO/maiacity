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
