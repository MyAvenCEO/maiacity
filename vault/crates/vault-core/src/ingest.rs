//! Verified ingest — the way film crews offload cards, with three hashes that must agree:
//!
//! 1. **source**: BLAKE3 of the bytes as they are read off the card or SSD (read exactly once, while copying),
//! 2. **disk**: BLAKE3 of the landed copy, read back around the page cache,
//! 3. **iroh**: the hash iroh computes when it takes the copy into the store (a clone on APFS — no second copy).
//!
//! Only when all three are the same is the file verified and recorded in the catalog.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use iroh_blobs::{
    BlobFormat, Hash,
    api::{blobs::AddPathOptions, proto::ImportMode},
};
use serde::Serialize;

use crate::{Vault, catalog::Meta, hash};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    /// All three hashes agree; the file is in the store and the catalog.
    Verified,
    /// The same bytes were already in the vault; nothing stored twice.
    Duplicate,
    /// The hashes disagree — the card, the cable or the disk returned different bytes. Never "safe to format".
    Mismatch,
}

#[derive(Debug, Clone, Serialize)]
pub struct IngestOutcome {
    pub source: String,
    pub size: u64,
    pub hash: String,
    pub source_hash: String,
    pub disk_hash: String,
    pub iroh_hash: String,
    pub verdict: Verdict,
    pub seconds: f64,
}

/// What the person ingesting says about this batch (tags such as "Day 01", a camera, a note).
#[derive(Debug, Clone, Default)]
pub struct Batch {
    pub session: String,
    pub tags: Vec<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub meta: serde_json::Value,
    pub public: bool,
    /// the story it all goes into (a story id); None: the inbox — or, for a file already in the vault, where it is
    pub story: Option<String>,
    /// the class, when the batch says it; None: told from the file (and when in doubt, default)
    pub class: Option<String>,
}

/// A file's class when nobody said it: what a camera or recorder made is an original — anything else, or anything in
/// doubt, is default. Proxy and delivery are never guessed: only their pipelines (the proxy maker, the render worker)
/// write them.
pub fn class_of(mime: &str, _tags: &[String], _meta: &serde_json::Value) -> &'static str {
    // straight from a camera or a field recorder
    if matches!(mime, "video/quicktime" | "video/x-braw" | "video/x-r3d" | "image/x-adobe-dng" | "audio/wav") {
        return "original";
    }
    "default"
}

/// Files the OS leaves on cards and drives — never footage.
pub fn is_junk(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    name.starts_with("._")
        || matches!(name, ".DS_Store" | ".Spotlight-V100" | ".Trashes" | ".fseventsd" | ".TemporaryItems")
}

/// Every file under `path` (or `path` itself), junk left out, in a stable order.
pub fn walk(path: &Path) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    let mut stack = vec![path.to_path_buf()];
    while let Some(p) = stack.pop() {
        if is_junk(&p) {
            continue;
        }
        let md = std::fs::symlink_metadata(&p)?;
        if md.is_dir() {
            for e in std::fs::read_dir(&p)? {
                stack.push(e?.path());
            }
        } else if md.is_file() {
            out.push(p);
        }
    }
    out.sort();
    Ok(out)
}

impl Vault {
    /// Ingest one file with the three-hash check. A mismatch is retried once before it is reported.
    pub async fn ingest_file(&self, src: &Path, batch: &Batch) -> Result<IngestOutcome> {
        let first = self.ingest_once(src, batch).await?;
        if first.verdict != Verdict::Mismatch {
            return Ok(first);
        }
        tracing::warn!("hash mismatch on {} — retrying once", src.display());
        self.ingest_once(src, batch).await
    }

    async fn ingest_once(&self, src: &Path, batch: &Batch) -> Result<IngestOutcome> {
        let started = std::time::Instant::now();
        let landing = self.ingest_dir().join(format!("{}.part", unique()));

        // 1 + 2: copy while hashing the source; then read the copy back from the disk
        let (src_path, land) = (src.to_path_buf(), landing.clone());
        let (source_hash, size, disk_hash) = tokio::task::spawn_blocking(move || -> Result<_> {
            let (source_hash, size) = hash::copy_hashing(&src_path, &land)?;
            let disk_hash = hash::hash_from_disk(&land)?;
            Ok((source_hash, size, disk_hash))
        })
        .await??;

        let source_hash = Hash::from(*source_hash.as_bytes());
        let disk_hash = Hash::from(*disk_hash.as_bytes());
        let outcome = |iroh_hash: Hash, verdict| IngestOutcome {
            source: src.display().to_string(),
            size,
            hash: source_hash.to_hex(),
            source_hash: source_hash.to_hex(),
            disk_hash: disk_hash.to_hex(),
            iroh_hash: iroh_hash.to_hex(),
            verdict,
            seconds: started.elapsed().as_secs_f64(),
        };

        if source_hash != disk_hash {
            std::fs::remove_file(&landing).ok();
            return Ok(outcome(Hash::EMPTY, Verdict::Mismatch));
        }
        if self.store.blobs().has(source_hash).await? && self.catalog.has(source_hash).await? {
            std::fs::remove_file(&landing).ok();
            // the same bytes brought in for a story: it now lives there (a file has one story), with the batch's tags too
            if batch.story.is_some() || batch.class.is_some() || !batch.tags.is_empty() {
                let known = self.catalog.meta(source_hash).await?.unwrap_or_default();
                let mut tags = known.tags.clone();
                for t in &batch.tags {
                    if !tags.contains(t) {
                        tags.push(t.clone());
                    }
                }
                // a file that never had a class gets one: the batch's, else told from what the vault knows of it
                let class = batch.class.clone().or_else(|| known.class.is_empty().then(|| class_of(&known.mime, &tags, &known.meta).to_string()));
                let patch = serde_json::json!({ "story": batch.story, "class": class, "tags": tags });
                let patch: serde_json::Map<_, _> = patch.as_object().into_iter().flatten().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k.clone(), v.clone())).collect();
                self.catalog.describe(source_hash, &serde_json::Value::Object(patch)).await?;
            }
            return Ok(outcome(source_hash, Verdict::Duplicate));
        }

        // 3: iroh takes the copy in (a clone on the same APFS volume) and hashes it itself; the tag pins it
        let tag = self
            .store
            .blobs()
            .add_path_with_opts(AddPathOptions { path: landing.clone(), format: BlobFormat::Raw, mode: ImportMode::Copy })
            .with_named_tag(format!("vault/{}", source_hash.to_hex()))
            .await
            .context("import into the store")?;
        std::fs::remove_file(&landing).ok();
        let iroh_hash = tag.hash;

        if iroh_hash != source_hash {
            return Ok(outcome(iroh_hash, Verdict::Mismatch));
        }

        let meta = Meta {
            hash: iroh_hash.to_hex(),
            size,
            mime: mime_of(src).to_string(),
            kind: kind_of(mime_of(src)).to_string(),
            title: batch.title.clone().unwrap_or_default(),
            description: batch.description.clone().unwrap_or_default(),
            tags: batch.tags.clone(),
            meta: batch.meta.clone(),
            public: batch.public,
            original_name: src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            source: src.display().to_string(),
            ingest: batch.session.clone(),
            added: now_iso(),
            story: batch.story.clone().filter(|s| *s != self.catalog.inbox_id()).unwrap_or_default(),
            class: batch.class.clone().unwrap_or_else(|| class_of(mime_of(src), &batch.tags, &batch.meta).to_string()),
        };
        self.catalog.put(iroh_hash, size, &meta).await?;
        Ok(outcome(iroh_hash, Verdict::Verified))
    }
}

fn unique() -> String {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    format!("{}-{}", t.as_nanos(), std::process::id())
}

pub fn now_iso() -> String {
    // seconds since the epoch, formatted without pulling in a date crate
    let s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
    let (days, rem) = (s.div_euclid(86_400), s.rem_euclid(86_400));
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Howard Hinnant's days → civil date.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn mime_of(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("avif") => "image/avif",
        Some("heic") => "image/heic",
        Some("dng") => "image/x-adobe-dng",
        Some("exr") => "image/x-exr",
        Some("mp4") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("m4v") => "video/x-m4v",
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        Some("braw") => "video/x-braw",
        Some("r3d") => "video/x-r3d",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("m4a") => "audio/mp4",
        Some("pdf") => "application/pdf",
        Some("json") => "application/json",
        // an EXR frame sequence or a game build, packed into one file
        Some("tar") => "application/x-tar",
        Some("cube") => "text/plain",
        _ => "application/octet-stream",
    }
}

pub fn kind_of(mime: &str) -> &'static str {
    match mime.split('/').next() {
        Some("image") => "image",
        Some("video") => "video",
        Some("audio") => "audio",
        _ if mime == "application/pdf" => "document",
        _ => "other",
    }
}
