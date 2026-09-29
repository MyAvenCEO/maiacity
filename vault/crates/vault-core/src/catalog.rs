//! The catalog: an iroh-docs replica every node keeps in full. It is the truth about what the vault holds.
//!
//! Keys (skill `maiacity.md`):
//!   blobs/<hash>    → the file itself; every full node fetches these (native pinning)
//!   meta/<hash>     → a small JSON about the file (a blob too, so it syncs exactly like files)
//!   ingest/<id>     → an ingest session's report
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
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

    /// Record an ingest session's report.
    pub async fn put_report(&self, id: &str, report: &serde_json::Value) -> Result<Hash> {
        self.doc().set_bytes(self.author, format!("ingest/{id}"), serde_json::to_vec_pretty(report)?).await
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
