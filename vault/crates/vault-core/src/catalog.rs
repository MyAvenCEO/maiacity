//! The catalog: an iroh-docs replica every node keeps in full. It is the truth about what the vault holds.
//!
//! Keys (skill `maiacity.md`):
//!   blobs/<hash>    → the file itself; every full node fetches these (native pinning). One entry per author: each
//!                     node writes its own once it holds the verified bytes — so where every file is lives in the
//!                     catalog itself, on every replica, offline too (the server's entry: in Object Storage)
//!   meta/<hash>     → a small JSON about the file (a blob too, so it syncs exactly like files)
//!   ingest/<id>     → an ingest session's report
//!   story/<id>      → a story: its title, description, series, episode, and where each class of its files is kept
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
            for (k, v) in extra {
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

    /// Every file's description whose JSON is here, newest entry per key.
    pub async fn list(&self) -> Result<Vec<Meta>> {
        let entries: Vec<_> = self.doc().get_many(Query::single_latest_per_key().key_prefix("meta/")).await?.collect().await;
        let mut out = Vec::new();
        for entry in entries {
            let entry = entry?;
            if let Ok(bytes) = self.store.blobs().get_bytes(entry.content_hash()).await {
                if let Ok(meta) = serde_json::from_slice(&bytes) {
                    out.push(meta);
                }
            }
        }
        Ok(out)
    }
}
