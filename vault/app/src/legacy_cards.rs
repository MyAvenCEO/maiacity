//! The thumbnail cards designed on the old content board, carried into Studio 2 once, beside the copy of the legacy
//! vault's files (legacy_copy.rs, which runs this after its files): each old content item's title card (its
//! `thumbnail.layers` on the 16:9 canvas, as the old ThumbnailTab drew them) becomes an `artwork` entry of its avenDB
//! story in Maia City, as the Story's Thumbnail tab keeps cards (src/lib/avendb/artworks.js, StoryThumbnail.svelte):
//! the same layers, each picture a link to the Library file the copy brought (tagged `legacy:<hash>`), and the card
//! rendered from them linked as its `render`. A card the old studio rendered in another shape (a delivery of kind
//! thumbnail, or a legacy file tagged `role:thumbnail`, `shape:<shape>` and the item's `idea:<title>`) becomes an
//! artwork of that shape whose one layer is that rendered card.
//!
//! The old board is read through the API with the app's key (`GET /api/content`, auth.rs) while it still answers;
//! what it answered is kept on this Mac (`legacy-content.json` beside the app's settings), so a later run works
//! without it. An item's story: the one the repo seed's journal post for its source names (the post tagged
//! `legacy:blog/<folder>`, src/lib/avendb/seed.js), else the story of Maia City with its title. Idempotent: each card
//! is tagged `legacy:thumbnail:<content id>` and `legacy:thumbnail:<content id>:<shape>`, and one already there is not
//! made again. An item whose pictures the copy hasn't brought yet waits for the next run.

use std::collections::{BTreeMap, HashMap};

use serde_json::{Value, json};
use tauri::{AppHandle, Manager as _};
use vault_core::Meta;

/// What became of the old board's cards in one run.
#[derive(Default, Debug, serde::Serialize)]
pub struct Cards {
    pub made: usize,
    pub there: usize,
    /// content items with a card but no avenDB story found, by title
    pub storyless: Vec<String>,
    /// content items waiting for pictures the copy hasn't brought yet
    pub waiting: usize,
    /// why the board couldn't be read, if it couldn't and nothing was kept of it
    pub unread: Option<String>,
}

/// Where what the old board answered is kept.
fn kept_file() -> std::path::PathBuf {
    crate::settings_file().with_file_name("legacy-content.json")
}

/// The old board's content items: as the API answers now (kept), else as it answered before.
async fn items(app: &AppHandle) -> Result<Vec<Value>, String> {
    let asked = app.state::<crate::auth::Auth>().call("GET", "/api/content", None).await;
    match asked {
        Ok((200, body)) if body["items"].is_array() => {
            let items = body["items"].as_array().cloned().unwrap_or_default();
            let path = kept_file();
            let part = path.with_extension("json.part");
            if std::fs::write(&part, serde_json::to_vec(&items).unwrap_or_default()).is_ok() {
                std::fs::rename(&part, &path).ok();
            }
            Ok(items)
        }
        other => {
            let why = match other {
                Ok((status, _)) => format!("the API answered {status}"),
                Err(e) => e,
            };
            std::fs::read(kept_file())
                .ok()
                .and_then(|b| serde_json::from_slice::<Vec<Value>>(&b).ok())
                .ok_or_else(|| format!("the old content board: {why}, and nothing of it is kept here"))
        }
    }
}

/// A shape's key from an aspect ("9:16" → "9x16"), if it is one of the cards' shapes.
fn shape_of(aspect: &str) -> Option<&'static str> {
    ["16x9", "9x16", "1x1", "4x5", "5x2"].into_iter().find(|s| s.replace('x', ":") == aspect || *s == aspect)
}

/// The tags of a live entry.
fn tags_of(e: &Value) -> Vec<&str> {
    e["tags"].as_array().into_iter().flatten().filter_map(Value::as_str).collect()
}

fn live(e: &Value, vault: &str) -> bool {
    e["vault"] == vault && e["deleted"] != true && !tags_of(e).contains(&"avendb:deleted")
}

/// The Library file entry the copy brought of legacy file `hash` in world `entries`: the file itself, never a sidecar
/// or an about.
fn file_of<'a>(entries: &'a [Value], vault: &str, hash: &str) -> Option<&'a Value> {
    let mark = format!("legacy:{hash}");
    entries.iter().filter(|e| live(e, vault) && e["type"] == "file").find(|e| {
        let tags = tags_of(e);
        tags.contains(&mark.as_str()) && !tags.iter().any(|t| *t == "media:transcript" || *t == "media:analysis")
    })
}

/// The avenDB story of content item `item` in Maia City: the one its journal post names, else the one of its title.
fn story_of<'a>(entries: &'a [Value], vault: &str, item: &Value) -> Option<&'a Value> {
    let by_entry = |id: &str| entries.iter().find(|e| e["entry"] == id && live(e, vault) && e["type"] == "story");
    let folder = item["source"].as_str().and_then(|s| s.strip_prefix("blog/")).and_then(|s| s.split('/').next());
    if let Some(folder) = folder {
        let mark = format!("legacy:blog/{folder}");
        let post = entries.iter().find(|e| live(e, vault) && e["type"] == "post" && tags_of(e).contains(&mark.as_str()));
        if let Some(story) = post.and_then(|p| p["record"]["story"]["entry"].as_str()).and_then(by_entry) {
            return Some(story);
        }
    }
    let title = item["title"].as_str()?.trim().to_lowercase();
    entries.iter().filter(|e| live(e, vault) && e["type"] == "story").find(|e| {
        let t = e["record"]["title"].as_str().or(e["title"].as_str()).unwrap_or_default();
        !title.is_empty() && t.trim().to_lowercase() == title
    })
}

/// The words an empty text layer of item `item` stood for: its image title, else its hook (the old board's
/// `cardWords`), so the card reads as it was though the avenDB story keeps no hooks of the old board.
fn words_of(item: &Value) -> Option<String> {
    let lines: Vec<&str> = item["image_title"].as_array().into_iter().flatten().filter_map(Value::as_str).filter(|l| !l.is_empty()).collect();
    if !lines.is_empty() {
        return Some(lines.join("\n"));
    }
    item["hook"].as_str().filter(|h| !h.trim().is_empty()).map(String::from)
}

/// Old layer `l` as an artwork's layer, its id `id`, its picture `file` (a link) where it has one.
fn layer_of(l: &Value, id: usize, file: Option<Value>, words: Option<&str>) -> Value {
    let mut out = json!({ "id": id, "kind": l["kind"].as_str().unwrap_or("text"), "on": l["on"].as_bool().unwrap_or(true) });
    for k in ["name", "fit", "text", "color", "align", "x", "y", "w", "size", "rot"] {
        if !l[k].is_null() {
            out[k] = l[k].clone();
        }
    }
    if out["kind"] == "text" && out["text"].as_str().is_none_or(str::is_empty) {
        if let Some(w) = words {
            out["text"] = json!(w);
        }
    }
    if let Some(f) = file {
        out["file"] = f;
    }
    out
}

/// The rendered cards of item `item` by shape: its 16:9 card, its thumbnail deliveries, and the legacy files tagged
/// `role:thumbnail`, `shape:<shape>` and `idea:<its title>` (the newest), as hashes.
fn rendered_of(item: &Value, legacy: &[Meta]) -> BTreeMap<&'static str, String> {
    let mut out = BTreeMap::new();
    if let Some(card) = item["thumbnail"]["card"].as_str().filter(|c| c.len() == 64) {
        out.insert("16x9", card.to_string());
    }
    for d in item["deliveries"].as_array().into_iter().flatten().filter(|d| d["kind"] == "thumbnail") {
        if let (Some(shape), Some(hash)) = (d["aspect"].as_str().and_then(shape_of), d["hash"].as_str()) {
            out.entry(shape).or_insert_with(|| hash.to_string());
        }
    }
    if let Some(title) = item["title"].as_str().filter(|t| !t.is_empty()) {
        let idea = format!("idea:{title}");
        let mut cards: Vec<&Meta> = legacy.iter().filter(|m| m.tags.iter().any(|t| t == "role:thumbnail") && m.tags.contains(&idea)).collect();
        cards.sort_by(|a, b| b.added.cmp(&a.added));
        for m in cards {
            if let Some(shape) = m.tags.iter().find_map(|t| t.strip_prefix("shape:")).and_then(shape_of) {
                out.entry(shape).or_insert_with(|| m.hash.clone());
            }
        }
    }
    out
}

/// The cards each content item of the old board would make in Maia City (`vault`), as `(shape, record)`, or `None`
/// where a picture it shows is in the legacy catalog (`legacy`) but not copied yet; pictures the legacy vault never
/// held are left out of their layers.
fn cards_of(entries: &[Value], vault: &str, story: &Value, item: &Value, legacy: &[Meta]) -> Option<Vec<(&'static str, Value)>> {
    let in_catalog: HashMap<&str, ()> = legacy.iter().map(|m| (m.hash.as_str(), ())).collect();
    let link = |e: &Value| json!({ "vault": vault, "entry": e["entry"] });
    // a hash as its link: Some(Some) copied, Some(None) never in the legacy vault, None not copied yet
    let resolve = |hash: &str| -> Option<Option<Value>> {
        match file_of(entries, vault, hash) {
            Some(e) => Some(Some(link(e))),
            None if in_catalog.contains_key(hash) => None,
            None => Some(None),
        }
    };
    let title = story["record"]["title"].as_str().or(item["title"].as_str()).unwrap_or("Untitled").to_string();
    let words = words_of(item);
    let rendered = rendered_of(item, legacy);
    let mut out = vec![];
    let layers = item["thumbnail"]["layers"].as_array().cloned().unwrap_or_default();
    if !layers.is_empty() {
        let mut made = vec![];
        for (i, l) in layers.iter().enumerate() {
            let file = match l["hash"].as_str().filter(|h| h.len() == 64) {
                Some(h) => resolve(h)?,
                None => None,
            };
            made.push(layer_of(l, i + 1, file, words.as_deref()));
        }
        let mut record = json!({ "kind": "artwork", "title": format!("{title} · 16:9"), "shape": "16x9", "story": link(story), "layers": made, "tags": [] });
        if let Some(h) = rendered.get("16x9") {
            if let Some(f) = resolve(h)? {
                record["render"] = f;
            }
        }
        out.push(("16x9", record));
    }
    for (shape, hash) in &rendered {
        if *shape == "16x9" && !layers.is_empty() {
            continue;
        }
        let Some(f) = resolve(hash)? else { continue };
        let layer = json!({ "id": 1, "kind": "image", "on": true, "name": "The card as rendered", "x": 0, "y": 0, "w": 100, "fit": "cover", "file": f });
        let name = shape.replace('x', ":");
        out.push((*shape, json!({ "kind": "artwork", "title": format!("{title} · {name}"), "shape": shape, "story": link(story), "layers": [layer], "render": f, "tags": [] })));
    }
    Some(out)
}

/// The old board's cards made in Maia City (`vault`, acting as `as_`) where they aren't yet, `legacy` the legacy
/// catalog as the copy read it.
pub async fn export(app: &AppHandle, vault: &str, as_: &str, legacy: &[Meta]) -> Cards {
    let mut c = Cards::default();
    let items = match items(app).await {
        Ok(items) => items,
        Err(e) => {
            c.unread = Some(e);
            return c;
        }
    };
    let world = match crate::aven::world(app).await {
        Ok(w) => w,
        Err(e) => {
            c.unread = Some(e);
            return c;
        }
    };
    let entries = world["entries"].as_array().cloned().unwrap_or_default();
    let have: std::collections::HashSet<String> =
        entries.iter().filter(|e| live(e, vault) && e["type"] == "artwork").flat_map(|e| tags_of(e).into_iter().map(String::from).collect::<Vec<_>>()).collect();
    for item in &items {
        let id = match &item["id"] {
            Value::String(s) if !s.is_empty() => s.clone(),
            Value::Number(n) => n.to_string(),
            _ => continue,
        };
        let has_card = item["thumbnail"]["layers"].as_array().is_some_and(|l| !l.is_empty()) || !rendered_of(item, legacy).is_empty();
        if !has_card {
            continue;
        }
        let Some(story) = story_of(&entries, vault, item) else {
            c.storyless.push(item["title"].as_str().unwrap_or(&id).to_string());
            continue;
        };
        let Some(cards) = cards_of(&entries, vault, story, item, legacy) else {
            c.waiting += 1;
            continue;
        };
        for (shape, record) in cards {
            let mark = format!("legacy:thumbnail:{id}:{shape}");
            if have.contains(&mark) {
                c.there += 1;
                continue;
            }
            let op = json!({ "op": "create", "vault": vault, "type": "artwork", "tags": [format!("legacy:thumbnail:{id}"), mark], "value": record, "as": as_ });
            match crate::aven::run(app, op).await {
                Ok(_) => c.made += 1,
                Err(e) => tracing::warn!("legacy cards: {} {shape}: {e}", item["title"].as_str().unwrap_or(&id)),
            }
        }
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    const CITY: &str = "c1";

    fn file(entry: &str, hash: &str) -> Value {
        json!({ "entry": entry, "vault": CITY, "type": "file", "tags": [format!("legacy:{hash}"), "media:original"] })
    }

    #[test]
    fn an_items_story_is_its_journal_posts_else_the_one_of_its_title() {
        let entries = vec![
            json!({ "entry": "s1", "vault": CITY, "type": "story", "record": { "title": "The decision" } }),
            json!({ "entry": "s2", "vault": CITY, "type": "story", "record": { "title": "Food forest" } }),
            json!({ "entry": "p1", "vault": CITY, "type": "post", "tags": ["legacy:blog/day-01-the-decision"], "record": { "story": { "vault": CITY, "entry": "s1" } } }),
        ];
        let by_source = json!({ "title": "Old name", "source": "blog/day-01-the-decision/post.md" });
        assert_eq!(story_of(&entries, CITY, &by_source).map(|s| s["entry"].clone()), Some(json!("s1")));
        assert_eq!(story_of(&entries, CITY, &json!({ "title": "food forest" })).map(|s| s["entry"].clone()), Some(json!("s2")));
        assert!(story_of(&entries, CITY, &json!({ "title": "Nothing" })).is_none());
    }

    #[test]
    fn a_title_card_keeps_its_layers_its_pictures_as_library_links() {
        let (bg, card, gone) = ("ab".repeat(32), "cd".repeat(32), "ef".repeat(32));
        let entries = vec![file("f1", &bg), file("f2", &card)];
        let story = json!({ "entry": "s1", "vault": CITY, "record": { "title": "The decision" } });
        let item = json!({ "id": "7", "title": "The decision", "image_title": ["a '1' million", "decision"],
            "thumbnail": { "card": card, "layers": [
                { "id": "a", "kind": "image", "hash": bg, "fit": "cover", "x": 0, "y": 0, "w": 100 },
                { "id": "b", "kind": "cutout", "hash": gone, "x": 4, "y": 8, "w": 40 },
                { "id": "c", "kind": "text", "text": "", "color": "gold", "x": 48, "y": 14, "w": 48, "size": 6.2, "rot": -2 }
            ] } });
        let legacy: Vec<Meta> = vec![];
        let cards = cards_of(&entries, CITY, &story, &item, &legacy).expect("its pictures are here");
        assert_eq!(cards.len(), 1);
        let (shape, r) = &cards[0];
        assert_eq!(*shape, "16x9");
        assert_eq!(r["layers"][0]["file"], json!({ "vault": CITY, "entry": "f1" }));
        assert_eq!(r["layers"][0]["id"], json!(1));
        assert!(r["layers"][1]["file"].is_null(), "a picture the legacy vault never held stays out");
        assert_eq!(r["layers"][2]["text"], json!("a '1' million\ndecision"), "the words it stood for");
        assert_eq!(r["layers"][2]["rot"], json!(-2));
        assert_eq!(r["render"], json!({ "vault": CITY, "entry": "f2" }));
        assert_eq!(r["story"], json!({ "vault": CITY, "entry": "s1" }));
    }

    #[test]
    fn a_card_waits_for_a_picture_the_copy_hasnt_brought_yet() {
        let bg = "ab".repeat(32);
        let story = json!({ "entry": "s1", "vault": CITY, "record": { "title": "T" } });
        let item = json!({ "id": "7", "title": "T", "thumbnail": { "layers": [{ "id": "a", "kind": "image", "hash": bg }] } });
        let legacy: Vec<Meta> = vec![serde_json::from_value(json!({ "hash": bg, "size": 1, "mime": "image/jpeg", "kind": "image" })).expect("a Meta")];
        assert!(cards_of(&[], CITY, &story, &item, &legacy).is_none());
    }

    #[test]
    fn a_card_rendered_in_another_shape_is_an_artwork_of_that_shape() {
        let vertical = "12".repeat(32);
        let entries = vec![file("f9", &vertical)];
        let story = json!({ "entry": "s1", "vault": CITY, "record": { "title": "T" } });
        let item = json!({ "id": "7", "title": "T", "thumbnail": {}, "deliveries": [{ "kind": "thumbnail", "aspect": "9:16", "hash": vertical }] });
        let cards = cards_of(&entries, CITY, &story, &item, &[]).expect("here");
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].0, "9x16");
        assert_eq!(cards[0].1["render"], json!({ "vault": CITY, "entry": "f9" }));
        assert_eq!(cards[0].1["layers"][0]["file"], json!({ "vault": CITY, "entry": "f9" }));
    }
}
