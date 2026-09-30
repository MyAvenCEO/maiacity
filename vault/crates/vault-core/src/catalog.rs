//! The catalog: an iroh-docs replica every node keeps in full. It is the truth about what the vault holds.
//!
//! Keys (skill `maiacity.md`):
//!   blobs/<hash>    → the file itself; every full node fetches these (native pinning). One entry per author: each
//!                     node writes its own once it holds the verified bytes — so where every file is lives in the
//!                     catalog itself, on every replica, offline too (the server's entry: in Object Storage)
//!   meta/<hash>     → a small JSON about the file (a blob too, so it syncs exactly like files)
//!   ingest/<id>     → an ingest session's report
//!   story/<id>      → a story: its title, description, series, episode, and where each class of its files is kept
//!   transcript/<hash> → derived: the file's words with their times and the transcript's state and progress — made
//!                     on a Mac, on-device (vault/app transcripts.rs), written by that Mac's author
//!   sound/<hash>    → derived: the file's audio proxy and start timecode — written only by the vault server's author
//!                     (vault-server sound.rs)
//!   analysis/<hash> → derived: the file's shot tags, cues, summary and thumbnail, the analysis's state and progress —
//!                     written only by the vault server's author (vault-server analyse.rs)
//!
//! `meta/` is editorial (people and agents); what a machine derives from a file lives under its own key per concern,
//! keyed by the same hash, a small JSON blob synced exactly like `meta/`. Nobody writes derived data into `meta/`:
//! a Mac rewriting a description can never lose a transcript, and the server never overwrites what a person wrote.
//! What the app serves (the studio, the MCP, the local routes) is the *view* (`list_view`, `meta_view`): the
//! description with its derived records merged into `meta` — `meta.transcript`, `meta.transcript_state`,
//! `meta.transcript_progress`, `meta.audio`, `meta.analysis`, `meta.analysis_state`, `meta.analysis_progress`,
//! `meta.thumbnail` (`with_derived`).
//!
//! Every file belongs to exactly one story — its `meta` names it (one description per file, so never two) — or to
//! the inbox (no story named). The inbox's id is the catalog's own. A story's id is an iroh namespace key: the day a
//! story becomes a replica of its own (a device that syncs only some stories, only some classes), its id stays.
//! Underneath everything stays flat: files by hash, in every store.
//!
//! A new Mac starts with a catalog of its own; when it joins (the server peer's catalog, handed over by the API once
//! the passkey approved this Mac) everything it already had is written into the shared one.

use std::{path::{Path, PathBuf}, sync::RwLock};

use anyhow::{Context, Result};
use futures_lite::StreamExt;
use iroh_blobs::{Hash, store::fs::FsStore};
use iroh_docs::{AuthorId, DocTicket, NamespaceId, api::Doc, protocol::Docs, store::Query};
use serde::{Deserialize, Serialize};

pub struct Catalog {
    doc: RwLock<Doc>,
    pub author: AuthorId,
    store: FsStore,
    docs: Docs,
    id_file: PathBuf,
}

/// What is known about a file besides its bytes. The hash is the name; everything else is description.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Meta {
    pub hash: String,
    pub size: u64,
    pub mime: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub title: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// anything else known about the file (colour profile, roles, shot …) — as the library kept it
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub meta: serde_json::Value,
    #[serde(default)]
    pub public: bool,
    /// Where it came from — kept as a fact about the file, never used to find it.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub original_name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub source: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub ingest: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub added: String,
    /// the one story it belongs to (a story id); empty: the inbox
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub story: String,
    /// default · original · proxy · delivery (empty reads as default)
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub class: String,
}

/// The derived records: one catalog key per concern (`<prefix><hash>`), each with one writer.
pub const TRANSCRIPT: &str = "transcript/";
pub const SOUND: &str = "sound/";
pub const ANALYSIS: &str = "analysis/";

/// The keys of a file's `meta` that are views of its derived records: shown, never written into `meta/` (a studio
/// that sends its whole view back — `{ meta: { ...m.meta, color } }` — writes only what is editorial).
pub const VIEW_KEYS: [&str; 12] = [
    "transcript",
    "transcript_state",
    "transcript_stage",
    "transcript_progress",
    "transcript_tries",
    "audio",
    "sound_state",
    "analysis",
    "analysis_state",
    "analysis_progress",
    "analysis_stage",
    "thumbnail",
];

/// The fields of a derived record that say where it stands, not what it found.
const RECORD_STATE: [&str; 8] = ["state", "stage", "progress", "tries", "audio", "thumbnail", "device", "updated"];

/// One file's derived records, as they are here.
#[derive(Debug, Default, Clone, Copy)]
pub struct Derived<'a> {
    pub transcript: Option<&'a serde_json::Value>,
    pub sound: Option<&'a serde_json::Value>,
    pub analysis: Option<&'a serde_json::Value>,
}

/// A description with its derived records merged into `meta` — what the studio and the agents read. A record is the
/// truth for its concern: what an older description still carries of it (a transcript merged in before the records
/// existed) gives way.
///   transcript/<hash> (a Mac, on-device) `{ state, stage?, progress?, device, model, language, text, words,
///                        utterances, at }`
///     → `meta.transcript` (the words and what goes with them, once there are words), `meta.transcript_state`,
///       `meta.transcript_stage` + `meta.transcript_progress` (while it runs)
///   sound/<hash> (the server) `{ state, audio?, timecode?, timecode_fps?, seconds?, at }`
///     → `meta.audio` (the audio proxy's hash), `meta.sound_state`, `meta.probe.timecode` + `timecode_fps` when the
///       probe has none
///   analysis/<hash> (the server) `{ state, progress, thumbnail?, summary, tags, free, labels, segments, cues, … }`
///     → `meta.analysis` (what it found, once it found anything), `meta.analysis_state`, `meta.analysis_progress`,
///       `meta.thumbnail` (the hash of a small display-referred JPEG of the file's best frame)
pub fn with_derived(meta: &mut Meta, d: Derived<'_>) {
    use serde_json::{Value, json};
    fn obj(v: Option<&Value>) -> Option<&Value> {
        v.filter(|v| v.is_object())
    }
    let (transcript, sound, analysis) = (obj(d.transcript), obj(d.sound), obj(d.analysis));
    if transcript.is_none() && sound.is_none() && analysis.is_none() {
        return;
    }
    if !meta.meta.is_object() {
        meta.meta = json!({});
    }
    let m = meta.meta.as_object_mut().unwrap();
    let found = |r: &Value, keys: &[&str]| -> Option<Value> {
        let o = r.as_object()?;
        keys.iter().any(|k| o.contains_key(*k)).then(|| Value::Object(o.iter().filter(|(k, _)| !RECORD_STATE.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect()))
    };
    let copy = |m: &mut serde_json::Map<String, Value>, r: &Value, from: &str, to: &str| {
        if let Some(v) = r.get(from).filter(|v| v.is_string() || v.is_number()) {
            m.insert(to.into(), v.clone());
        }
    };
    if let Some(t) = transcript {
        for k in ["transcript", "transcript_state", "transcript_stage", "transcript_progress", "transcript_tries"] {
            m.remove(k);
        }
        copy(m, t, "state", "transcript_state");
        copy(m, t, "stage", "transcript_stage");
        copy(m, t, "progress", "transcript_progress");
        copy(m, t, "tries", "transcript_tries");
        if let Some(words) = found(t, &["words"]) {
            m.insert("transcript".into(), words);
        }
    }
    if let Some(snd) = sound {
        m.remove("audio");
        copy(m, snd, "state", "sound_state");
        copy(m, snd, "audio", "audio");
        if let (Some(tc), Some(fps)) = (snd.get("timecode").filter(|v| v.is_string()), snd.get("timecode_fps").filter(|v| v.is_number())) {
            let probe = m.entry("probe").or_insert_with(|| json!({}));
            if let Some(p) = probe.as_object_mut().filter(|p| !p.contains_key("timecode")) {
                p.insert("timecode".into(), tc.clone());
                p.insert("timecode_fps".into(), fps.clone());
            }
        }
    }
    if let Some(a) = analysis {
        for k in ["analysis", "analysis_state", "analysis_progress", "analysis_stage", "thumbnail"] {
            m.remove(k);
        }
        copy(m, a, "thumbnail", "thumbnail");
        copy(m, a, "state", "analysis_state");
        copy(m, a, "stage", "analysis_stage");
        copy(m, a, "progress", "analysis_progress");
        if let Some(found) = found(a, &["tags", "cues", "summary"]) {
            m.insert("analysis".into(), found);
        }
    }
}

/// Every audio proxy by the original it is the sound of (its own `meta.audio_of`).
pub fn audio_proxies(list: &[Meta]) -> std::collections::HashMap<String, String> {
    list.iter()
        .filter_map(|m| Some((m.meta.get("audio_of")?.as_str()?.to_string(), m.hash.clone())))
        .collect()
}

/// An original whose sound record does not name its audio proxy (made before there were records): the audio proxy
/// that names it, found from its side — as a proxy is found from either side.
pub fn link_audio(m: &mut Meta, audio: &std::collections::HashMap<String, String>) {
    if m.meta.get("audio").is_some_and(|a| a.is_string()) || m.meta.get("audio_of").is_some() {
        return;
    }
    if let Some(a) = audio.get(&m.hash) {
        if !m.meta.is_object() {
            m.meta = serde_json::json!({});
        }
        m.meta["audio"] = serde_json::json!(a);
    }
}

/// The classes a story keeps its files in, each with its own destinations.
pub const CLASSES: [&str; 4] = ["default", "original", "proxy", "delivery"];

/// Where each class of a story's files is kept: store names ("avenSSD", "hetzner", a drive's name later).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Rules {
    pub default: Vec<String>,
    pub original: Vec<String>,
    pub proxy: Vec<String>,
    pub delivery: Vec<String>,
}

impl Default for Rules {
    /// For now every class: this Mac's avenSSD and the server's Object Storage — two copies, the least there may be.
    fn default() -> Self {
        let two = || vec!["avenSSD".to_string(), "hetzner".to_string()];
        Self { default: two(), original: two(), proxy: two(), delivery: two() }
    }
}

/// A story: the bucket everything of one story lives in — originals, proxies, sound, stills, metadata, deliveries.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Story {
    /// an iroh namespace id (64 hex): never changes, whatever the title becomes
    #[serde(default)]
    pub id: String,
    /// at most five words
    pub title: String,
    /// the full hook
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub series: String,
    #[serde(default)]
    pub episode: String,
    #[serde(default)]
    pub rules: Rules,
    #[serde(default)]
    pub created: String,
    /// the namespace's secret: kept so the story can become its own replica under the same id
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub key: String,
}

impl Catalog {
    /// Open this vault's catalog, creating it the first time. Its id is kept in `dir/catalog.id`.
    pub async fn open(dir: &Path, docs: &Docs, store: &FsStore) -> Result<Self> {
        let id_file = dir.join("catalog.id");
        let doc = match std::fs::read_to_string(&id_file) {
            Ok(id) => {
                let id: NamespaceId = id.trim().parse().context("catalog.id")?;
                docs.open(id).await?.context("the catalog named in catalog.id is not in this replica store")?
            }
            Err(_) => {
                let doc = docs.create().await?;
                std::fs::write(&id_file, doc.id().to_string())?;
                doc
            }
        };
        let author = docs.author_default().await?;
        Ok(Self { doc: RwLock::new(doc), author, store: store.clone(), docs: docs.clone(), id_file })
    }

    /// The catalog's replica handle (cheap to clone).
    pub fn doc(&self) -> Doc {
        self.doc.read().unwrap().clone()
    }

    pub fn id(&self) -> NamespaceId {
        self.doc().id()
    }

    /// Join the shared catalog. Everything this Mac already recorded is written into it, so nothing is lost; from
    /// then on this node syncs with the ticket's peers (the server) and fetches every file (the default policy).
    pub async fn join(&self, ticket: DocTicket) -> Result<()> {
        let shared = ticket.capability.id();
        if self.id() == shared {
            self.doc().start_sync(ticket.nodes.clone()).await?;
            return Ok(());
        }
        let old = self.doc();
        let joined = self.docs.import(ticket).await.context("join the shared catalog")?;
        let mine: Vec<_> = old.get_many(Query::single_latest_per_key()).await?.collect().await;
        for entry in mine {
            let entry = entry?;
            joined.set_hash(self.author, entry.key().to_vec(), entry.content_hash(), entry.content_len()).await?;
        }
        std::fs::write(&self.id_file, shared.to_string())?;
        *self.doc.write().unwrap() = joined;
        Ok(())
    }

    /// Record a file: `blobs/<hash>` → the file, `meta/<hash>` → its description.
    pub async fn put(&self, hash: Hash, size: u64, meta: &Meta) -> Result<()> {
        let hex = hash.to_hex();
        let doc = self.doc();
        doc.set_hash(self.author, format!("blobs/{hex}"), hash, size).await?;
        doc.set_bytes(self.author, format!("meta/{hex}"), serde_json::to_vec_pretty(meta)?).await?;
        Ok(())
    }

    /// Change what is known about a file (library enrichment): a new `meta/<hash>` entry; the old JSON stays a blob.
    pub async fn describe(&self, hash: Hash, patch: &serde_json::Value) -> Result<Meta> {
        let mut meta = self.meta(hash).await?.context("no such file in the catalog")?;
        let text = |k: &str| patch.get(k).and_then(|v| v.as_str()).map(String::from);
        if let Some(t) = text("title") {
            meta.title = t;
        }
        if let Some(d) = text("description") {
            meta.description = d;
        }
        if let Some(tags) = patch.get("tags").and_then(|v| v.as_array()) {
            meta.tags = tags.iter().filter_map(|t| t.as_str().map(String::from)).collect();
        }
        if let Some(p) = patch.get("public").and_then(|v| v.as_bool()) {
            meta.public = p;
        }
        // its one story (the inbox's id, or empty, puts it back in the inbox)
        if let Some(st) = text("story") {
            meta.story = if st == self.inbox_id() { String::new() } else { st };
        }
        if let Some(c) = text("class") {
            anyhow::ensure!(CLASSES.contains(&c.as_str()), "a file's class is one of {}", CLASSES.join(", "));
            meta.class = c;
        }
        if let Some(extra) = patch.get("meta").and_then(|v| v.as_object()) {
            let mut m = meta.meta.as_object().cloned().unwrap_or_default();
            // the derived records' views are not the description's (the server writes them under their own keys)
            for (k, v) in extra.iter().filter(|(k, _)| !VIEW_KEYS.contains(&k.as_str())) {
                m.insert(k.clone(), v.clone());
            }
            meta.meta = serde_json::Value::Object(m);
        }
        let doc = self.doc();
        doc.set_bytes(self.author, format!("meta/{}", hash.to_hex()), serde_json::to_vec_pretty(&meta)?).await?;
        Ok(meta)
    }

    /// Record an ingest session's report.
    pub async fn put_report(&self, id: &str, report: &serde_json::Value) -> Result<Hash> {
        self.doc().set_bytes(self.author, format!("ingest/{id}"), serde_json::to_vec_pretty(report)?).await
    }

    /// Every ingest session's report whose JSON is here, newest first.
    pub async fn reports(&self) -> Result<Vec<serde_json::Value>> {
        let entries: Vec<_> = self.doc().get_many(Query::single_latest_per_key().key_prefix("ingest/")).await?.collect().await;
        let mut out = Vec::new();
        for entry in entries {
            let entry = entry?;
            if let Ok(bytes) = self.store.blobs().get_bytes(entry.content_hash()).await {
                if let Ok(report) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                    out.push(report);
                }
            }
        }
        out.sort_by(|a, b| b["session"].as_str().cmp(&a["session"].as_str()));
        Ok(out)
    }

    /// The files an author holds a verified copy of: its own `blobs/<hash>` entries (hex hashes).
    pub async fn held_by(&self, author: AuthorId) -> Result<std::collections::HashSet<String>> {
        let entries: Vec<_> = self.doc().get_many(Query::author(author).key_prefix("blobs/")).await?.collect().await;
        Ok(entries.into_iter().flatten().map(|e| String::from_utf8_lossy(e.key()).trim_start_matches("blobs/").to_string()).collect())
    }

    /// Is this file already in the catalog?
    pub async fn has(&self, hash: Hash) -> Result<bool> {
        Ok(self.doc().get_one(Query::key_exact(format!("blobs/{}", hash.to_hex()))).await?.is_some())
    }

    /// One file's description, if the catalog knows it (and its JSON has arrived).
    pub async fn meta(&self, hash: Hash) -> Result<Option<Meta>> {
        let query = Query::single_latest_per_key().key_exact(format!("meta/{}", hash.to_hex()));
        let Some(entry) = self.doc().get_one(query).await? else { return Ok(None) };
        let Ok(bytes) = self.store.blobs().get_bytes(entry.content_hash()).await else { return Ok(None) };
        Ok(Some(serde_json::from_slice(&bytes)?))
    }

    /// The inbox's id: the catalog's own.
    pub fn inbox_id(&self) -> String {
        self.id().to_string()
    }

    /// Every story, the inbox first (with the default rules until they are set).
    pub async fn stories(&self) -> Result<Vec<Story>> {
        let entries: Vec<_> = self.doc().get_many(Query::single_latest_per_key().key_prefix("story/")).await?.collect().await;
        let mut out = Vec::new();
        for entry in entries {
            let entry = entry?;
            if let Ok(bytes) = self.store.blobs().get_bytes(entry.content_hash()).await {
                if let Ok(story) = serde_json::from_slice::<Story>(&bytes) {
                    out.push(story);
                }
            }
        }
        let inbox = self.inbox_id();
        if !out.iter().any(|s| s.id == inbox) {
            out.push(Story { id: inbox.clone(), title: "Inbox".into(), description: "Everything that belongs to no story yet".into(), ..Default::default() });
        }
        out.sort_by(|a, b| (a.id != inbox).cmp(&(b.id != inbox)).then(a.series.cmp(&b.series)).then(a.episode.cmp(&b.episode)).then(a.title.cmp(&b.title)));
        Ok(out)
    }

    /// Create a story (no id yet: a new namespace key) or change one. Returns it as kept.
    pub async fn save_story(&self, mut story: Story) -> Result<Story> {
        story.title = story.title.trim().to_string();
        anyhow::ensure!(!story.title.is_empty(), "a story has a title");
        anyhow::ensure!(story.title.split_whitespace().count() <= 5, "a story's title is at most five words");
        let r = &story.rules;
        for (class, to) in [("default", &r.default), ("original", &r.original), ("proxy", &r.proxy), ("delivery", &r.delivery)] {
            anyhow::ensure!(to.len() >= 2, "every class is kept in at least two places ({class}: {})", to.len());
        }
        if story.id.is_empty() {
            let secret = iroh_docs::NamespaceSecret::from_bytes(&iroh::SecretKey::generate().to_bytes());
            story.id = secret.id().to_string();
            story.key = secret.to_bytes().iter().map(|b| format!("{b:02x}")).collect();
            story.created = crate::ingest::now_iso();
        } else if let Some(old) = self.stories().await?.into_iter().find(|s| s.id == story.id) {
            // what a save does not carry stays as it was
            story.key = old.key;
            if story.created.is_empty() {
                story.created = old.created;
            }
        }
        self.doc().set_bytes(self.author, format!("story/{}", story.id), serde_json::to_vec_pretty(&story)?).await?;
        Ok(story)
    }

    /// Remove a story — only an empty one, and never the inbox: a file always has a home.
    pub async fn delete_story(&self, id: &str) -> Result<()> {
        anyhow::ensure!(id != self.inbox_id(), "the inbox stays");
        let holds = self.list().await?.iter().filter(|m| m.story == id).count();
        anyhow::ensure!(holds == 0, "the story still holds {holds} files: move them out first");
        self.doc().del(self.author, format!("story/{id}")).await?;
        Ok(())
    }

    /// Every derived record of one concern (`transcript/`, `sound/`, `analysis/`) whose JSON is here: hex hash → record.
    pub async fn records(&self, prefix: &str) -> Result<std::collections::HashMap<String, serde_json::Value>> {
        let entries: Vec<_> = self.doc().get_many(Query::single_latest_per_key().key_prefix(prefix)).await?.collect().await;
        let mut out = std::collections::HashMap::new();
        for entry in entries.into_iter().flatten() {
            let hex = String::from_utf8_lossy(&entry.key()[prefix.len()..]).into_owned();
            if let Ok(bytes) = self.store.blobs().get_bytes(entry.content_hash()).await {
                if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                    out.insert(hex, v);
                }
            }
        }
        Ok(out)
    }

    /// One derived record (`transcript/`, `sound/`, `analysis/`) of one file.
    pub async fn record(&self, prefix: &str, hash: Hash) -> Result<Option<serde_json::Value>> {
        let query = Query::single_latest_per_key().key_exact(format!("{prefix}{}", hash.to_hex()));
        let Some(entry) = self.doc().get_one(query).await? else { return Ok(None) };
        let Ok(bytes) = self.store.blobs().get_bytes(entry.content_hash()).await else { return Ok(None) };
        Ok(serde_json::from_slice(&bytes).ok())
    }

    /// Write one derived record as this node (a Mac writes only `transcript/<hash>` — the words it made).
    pub async fn write_record(&self, prefix: &str, hash: Hash, record: &serde_json::Value) -> Result<()> {
        self.doc().set_bytes(self.author, format!("{prefix}{}", hash.to_hex()), serde_json::to_vec(record)?).await?;
        Ok(())
    }

    /// Every file as the studio and the agents see it: its description with its derived records merged in.
    pub async fn list_view(&self) -> Result<Vec<Meta>> {
        let mut list = self.list().await?;
        let transcripts = self.records(TRANSCRIPT).await?;
        let sounds = self.records(SOUND).await?;
        let analyses = self.records(ANALYSIS).await?;
        let audio = audio_proxies(&list);
        for m in &mut list {
            with_derived(m, Derived { transcript: transcripts.get(&m.hash), sound: sounds.get(&m.hash), analysis: analyses.get(&m.hash) });
            link_audio(m, &audio);
        }
        Ok(list)
    }

    /// One file as the studio and the agents see it (`list_view`'s merge).
    pub async fn meta_view(&self, hash: Hash) -> Result<Option<Meta>> {
        let Some(mut m) = self.meta(hash).await? else { return Ok(None) };
        let (t, snd, a) = (self.record(TRANSCRIPT, hash).await?, self.record(SOUND, hash).await?, self.record(ANALYSIS, hash).await?);
        with_derived(&mut m, Derived { transcript: t.as_ref(), sound: snd.as_ref(), analysis: a.as_ref() });
        if m.meta.get("audio").is_none() && matches!(m.kind.as_str(), "video" | "audio") {
            link_audio(&mut m, &audio_proxies(&self.list().await?));
        }
        Ok(Some(m))
    }

    /// Every file's description whose JSON is here, newest entry per key — only what `meta/` says (the derived
    /// records are merged in by `list_view`). A deleted file (`meta.deleted`) is not listed.
    pub async fn list(&self) -> Result<Vec<Meta>> {
        let entries: Vec<_> = self.doc().get_many(Query::single_latest_per_key().key_prefix("meta/")).await?.collect().await;
        let mut out = Vec::new();
        for entry in entries {
            let entry = entry?;
            if let Ok(bytes) = self.store.blobs().get_bytes(entry.content_hash()).await {
                if let Ok(meta) = serde_json::from_slice::<Meta>(&bytes) {
                    if !is_deleted(&meta) {
                        out.push(meta);
                    }
                }
            }
        }
        Ok(out)
    }

    /// A file deleted from the library: its description says so (`meta.deleted`: when, and why), so every device
    /// stops listing it; its bytes stay where they are kept until storage is cleaned — a delete by hand can be undone.
    pub async fn delete_file(&self, hash: Hash, why: &str) -> Result<()> {
        self.describe(hash, &serde_json::json!({ "meta": { "deleted": { "at": crate::ingest::now_iso(), "why": why } } })).await?;
        Ok(())
    }
}

/// Is this file deleted from the library (its description says so)?
pub fn is_deleted(m: &Meta) -> bool {
    m.meta.get("deleted").is_some_and(|d| !d.is_null())
}

impl Catalog {
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn file(meta: serde_json::Value) -> Meta {
        Meta { hash: "h".into(), kind: "video".into(), meta, ..Default::default() }
    }

    #[test]
    fn the_view_merges_the_derived_records() {
        let mut m = file(json!({ "proxy": "p", "probe": { "codec": "hvc1" } }));
        let t = json!({ "state": "done", "stage": "transcribing", "progress": 0.6, "device": "mac1",
                        "model": "nvidia/nemotron-3.5-asr-streaming-0.6b", "text": "Day twenty.", "words": [{ "w": "Day", "s": 0.4, "e": 0.8, "c": 1.0 }] });
        let snd = json!({ "state": "done", "audio": "a1", "timecode": "10:00:00:00", "timecode_fps": 25.0 });
        let a = json!({ "state": "analysing", "progress": 0.5, "thumbnail": "t1", "tags": { "shot_size": "MS" }, "cues": [] });
        with_derived(&mut m, Derived { transcript: Some(&t), sound: Some(&snd), analysis: Some(&a) });
        let v = &m.meta;
        assert_eq!(v["proxy"], "p");
        assert_eq!(v["transcript_state"], "done");
        assert_eq!(v["audio"], "a1");
        assert_eq!(v["transcript"]["text"], "Day twenty.");
        assert!(v["transcript"].get("state").is_none() && v["transcript"].get("device").is_none());
        assert_eq!(v["sound_state"], "done");
        assert_eq!(v["probe"], json!({ "codec": "hvc1", "timecode": "10:00:00:00", "timecode_fps": 25.0 }));
        assert_eq!(v["analysis_state"], "analysing");
        assert_eq!(v["analysis_progress"], 0.5);
        assert_eq!(v["thumbnail"], "t1");
        assert_eq!(v["transcript_stage"], "transcribing");
        assert_eq!(v["transcript_progress"], 0.6);
        assert_eq!(v["analysis"], json!({ "tags": { "shot_size": "MS" }, "cues": [] }));
    }

    #[test]
    fn a_record_is_the_truth_for_its_concern() {
        // a description still carrying an old merged-in transcript: the record wins; no words yet → no transcript
        let mut m = file(json!({ "transcript": { "words": [] }, "transcript_state": "done", "probe": { "timecode": "01:00:00:00" } }));
        with_derived(&mut m, Derived { transcript: Some(&json!({ "state": "transcribing" })), ..Default::default() });
        assert!(m.meta.get("transcript").is_none());
        assert_eq!(m.meta["transcript_state"], "transcribing");
        // the Mac's own probe timecode stays
        with_derived(&mut m, Derived { sound: Some(&json!({ "state": "none: no sound track", "timecode": "02:00:00:00", "timecode_fps": 25 })), ..Default::default() });
        assert_eq!(m.meta["probe"]["timecode"], "01:00:00:00");
        // nothing derived: the description as it is
        let mut plain = file(serde_json::Value::Null);
        with_derived(&mut plain, Derived::default());
        assert!(plain.meta.is_null());
        // a queued analysis shows its state, not an empty result
        let mut q = file(json!({}));
        with_derived(&mut q, Derived { analysis: Some(&json!({ "state": "queued" })), ..Default::default() });
        assert_eq!(q.meta, json!({ "analysis_state": "queued" }));
    }
}
