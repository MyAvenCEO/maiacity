//! The studio, for agents: an MCP server inside maiaCITY Studio, so Claude Code (or any agent harness) can drive
//! every step the studio's buttons drive — ingest, the library and its copies, describing files, probes and proxies,
//! timelines (edit), grades and renders, the content board and its deliveries (draft and publish).
//!
//! Every tool is the same native function the studio calls; nothing here is a second implementation. It listens on
//! this Mac only (127.0.0.1:4545/mcp) and answers only a request that carries the app's MCP token
//! (`~/Library/Application Support/city.maia.studio/mcp-token`). It acts with the app's key, so it can do what the
//! admin approved for this Mac — and only while the app is signed in.
//!
//!   claude mcp add --transport http maiacity-studio http://127.0.0.1:4545/mcp \
//!     --header "Authorization: Bearer $(cat ~/Library/Application\ Support/city.maia.studio/mcp-token)"

use std::{path::PathBuf, sync::Arc};

use axum::{extract::Request, http::StatusCode, middleware::Next, response::Response};
use rmcp::{
    ServerHandler,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{ServerCapabilities, ServerConfig},
    schemars, tool, tool_handler, tool_router,
    transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::AppHandle;
use vault_core::Vault;

use crate::auth::{self, Auth};

pub const ADDR: &str = "127.0.0.1:4545";

fn token_file() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join("Library/Application Support/city.maia.studio/mcp-token")
}

/// The MCP token: made once, kept readable by this user only.
pub fn token() -> std::io::Result<String> {
    let file = token_file();
    if let Ok(t) = std::fs::read_to_string(&file) {
        return Ok(t.trim().to_string());
    }
    std::fs::create_dir_all(file.parent().unwrap())?;
    // 32 random bytes (from the same generator as the node keys)
    let bytes = iroh::SecretKey::generate().to_bytes();
    let t: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    std::fs::write(&file, &t)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(t)
}

fn text(v: Result<Value, String>) -> String {
    match v {
        Ok(v) => serde_json::to_string_pretty(&v).unwrap_or_default(),
        Err(e) => format!("error: {e}"),
    }
}

#[derive(Clone)]
pub struct Studio {
    vault: Arc<Vault>,
    auth: Auth,
    handle: AppHandle,
    #[allow(dead_code)] // read by the tool_handler macro
    tool_router: ToolRouter<Self>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct Filter {
    /// only this kind: video, image, audio, document, other
    pub kind: Option<String>,
    /// only files with this tag
    pub tag: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct IngestArgs {
    /// files or folders on this Mac (a card, a drive, a folder)
    pub paths: Vec<String>,
    /// tags for the whole batch, e.g. ["Day 20", "A7IV"]
    #[serde(default)]
    pub tags: Vec<String>,
    /// the story new files go into (its id, from stories_list); none: the inbox. Files already in the vault stay where they are.
    pub story: Option<String>,
    /// default or original for the whole batch (proxy and delivery are written only by their pipelines); none: told from each file
    pub class: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct DescribeArgs {
    /// the file's BLAKE3 hash (64 hex)
    pub hash: String,
    pub title: Option<String>,
    pub description: Option<String>,
    /// replaces the file's tags
    pub tags: Option<Vec<String>>,
    /// public files are served on the site without a login
    pub public: Option<bool>,
    /// more to know about the file, merged in (e.g. {"role": "proxy", "proxy_of": "<hash>", "scene": "…"})
    pub meta: Option<Value>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct HashArg {
    /// the file's BLAKE3 hash (64 hex)
    pub hash: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct TranscriptArgs {
    /// the recording's BLAKE3 hash (64 hex) — an original; its audio proxy's hash works too
    pub hash: String,
    /// only the words between these seconds of the file (a clip's in and out)
    pub from: Option<f64>,
    pub to: Option<f64>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct SearchArgs {
    /// the words to find, e.g. "one street" — case and punctuation do not matter
    pub phrase: String,
    /// only in files with this tag
    pub tag: Option<String>,
    /// only in this story (its id)
    pub story: Option<String>,
    /// at most this many hits (default 50)
    pub limit: Option<usize>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct IdArg {
    pub id: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct SaveArgs {
    pub id: String,
    /// the fields to change, as the API takes them
    pub patch: Value,
}

/// An ASC CDL grade, applied in ACEScct (the studio's and the render's own formula): out = (in·slope + offset)^power,
/// then saturation around Rec.709 luma.
#[derive(Deserialize, Serialize, schemars::JsonSchema)]
pub struct Cdl {
    pub slope: [f64; 3],
    pub offset: [f64; 3],
    pub power: [f64; 3],
    pub sat: f64,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct GradeClipArgs {
    /// the timeline's id
    pub timeline: String,
    /// the clip's id (a V1 clip)
    pub clip: String,
    /// its grade; none: take it off
    pub grade: Option<Cdl>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct GradeFilmArgs {
    /// the timeline's id
    pub timeline: String,
    /// a named look the render knows: neutral, cold, dip, bright, night, warm (game/film/color.js PRESETS)
    pub preset: Option<String>,
    /// or a look of its own (wins over the preset)
    pub look: Option<Cdl>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct FrameArgs {
    /// the timeline's id
    pub timeline: String,
    /// the moment on the timeline, in seconds from 0
    pub t: f64,
    /// the delivery shape: 16:9 (the default, 3840×2160), 9:16, 1:1 or 4:5
    pub shape: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct StoryArgs {
    /// the story to change; none: a new story
    pub id: Option<String>,
    /// at most five words
    pub title: Option<String>,
    /// the full hook
    pub description: Option<String>,
    pub series: Option<String>,
    /// e.g. DAY 0002
    pub episode: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct Range {
    /// ISO date, e.g. 2026-10-01
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct Item {
    /// the content item, as the API takes it: title, day, platform, status (idea, hook, draft, derivatives,
    /// scheduled, published), body, deliveries …
    pub item: Value,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct ApiArgs {
    /// GET, POST, PUT, PATCH or DELETE
    pub method: String,
    /// an API path under /api/, e.g. /api/shots
    pub path: String,
    pub body: Option<Value>,
}

impl Studio {
    pub fn new(vault: Arc<Vault>, auth: Auth, handle: AppHandle) -> Self {
        Self { vault, auth, handle, tool_router: Self::tool_router() }
    }

    fn signed_in(&self) -> Result<(), String> {
        if auth::signed_in() { Ok(()) } else { Err("maiaCITY Studio is not signed in — sign in with the passkey first".into()) }
    }

    async fn api(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
        self.signed_in()?;
        self.auth.get_ok(method, path, body).await
    }
}

#[tool_router]
impl Studio {
    // ── the vault: ingest, the library, copies ──

    #[tool(description = "This Mac's vault: its node, catalog, how many files and bytes, free disk space")]
    async fn vault_status(&self) -> String {
        let v = &self.vault;
        let list = v.catalog.list().await;
        text(self.signed_in().and(list.map_err(|e| e.to_string())).map(|l| {
            json!({ "node": v.endpoint.id().to_string(), "catalog": v.catalog.id().to_string(), "dir": v.dir,
                    "files": l.len(), "bytes": l.iter().map(|m| m.size).sum::<u64>() })
        }))
    }

    #[tool(description = "Every file in the vault's catalog with its description (hash, size, mime, kind, title, tags, public, meta)")]
    async fn library_list(&self, Parameters(f): Parameters<Filter>) -> String {
        let r = async {
            self.signed_in()?;
            let list = self.vault.catalog.list().await.map_err(|e| e.to_string())?;
            let list: Vec<_> = list
                .into_iter()
                .filter(|m| f.kind.as_ref().is_none_or(|k| &m.kind == k))
                .filter(|m| f.tag.as_ref().is_none_or(|t| m.tags.contains(t)))
                .map(|mut m| {
                    // a transcript is said, not listed: its words come with the `transcript` tool
                    if let Some(t) = m.meta.get_mut("transcript") {
                        *t = transcript_summary(t);
                    }
                    m
                })
                .collect();
            serde_json::to_value(list).map_err(|e| e.to_string())
        };
        text(r.await)
    }

    // ── transcripts: every recording's words, with their times (the vault server writes them: meta.transcript) ──

    #[tool(
        description = "A recording's transcript (Deepgram Nova 3, written by the vault server when the file reached the bucket): its text, sentences and every word with its start and end in seconds of the file (a clip's in/out map straight onto them), confidence, speaker, and — for camera files with a start timecode — each word's timecode (HH:MM:SS:FF). from/to narrow it to a clip. Also the transcript's state (transcribing, failed …) and the audio proxy's hash."
    )]
    async fn transcript(&self, Parameters(a): Parameters<TranscriptArgs>) -> String {
        let r = async {
            self.signed_in()?;
            let hash: iroh_blobs::Hash = a.hash.parse().map_err(|e| format!("{e}"))?;
            let mut meta = self.vault.catalog.meta(hash).await.map_err(|e| format!("{e:#}"))?.ok_or("no such file in the catalog")?;
            // an audio proxy: its original's
            if let Some(of) = meta.meta.get("audio_of").and_then(|v| v.as_str()).and_then(|h| h.parse::<iroh_blobs::Hash>().ok()) {
                meta = self.vault.catalog.meta(of).await.map_err(|e| format!("{e:#}"))?.ok_or("the audio proxy's original is not in the catalog")?;
            }
            Ok::<_, String>(transcript_view(&meta, a.from, a.to))
        };
        text(r.await)
    }

    #[tool(
        description = "Find a phrase across every transcript in the vault — to cut by words: each hit with the file (hash, name, story), where the phrase starts and ends in seconds of the file, its timecode (when the file has one), and the sentence around it."
    )]
    async fn transcript_search(&self, Parameters(a): Parameters<SearchArgs>) -> String {
        let r = async {
            self.signed_in()?;
            let want = tokens(&a.phrase);
            if want.is_empty() {
                return Err("a phrase to find".to_string());
            }
            let limit = a.limit.unwrap_or(50).max(1);
            let mut hits = Vec::new();
            for m in self.vault.catalog.list().await.map_err(|e| format!("{e:#}"))? {
                if a.tag.as_ref().is_some_and(|t| !m.tags.contains(t)) || a.story.as_ref().is_some_and(|st| &m.story != st) {
                    continue;
                }
                let Some(t) = m.meta.get("transcript") else { continue };
                for (s, e, context) in find_phrase(t, &want) {
                    hits.push(json!({ "hash": m.hash, "name": m.original_name, "title": m.title, "story": m.story,
                        "s": s, "e": e, "timecode": word_timecode(&m.meta, s), "context": context }));
                    if hits.len() >= limit {
                        return Ok(json!({ "phrase": a.phrase, "hits": hits, "more": true }));
                    }
                }
            }
            Ok(json!({ "phrase": a.phrase, "hits": hits }))
        };
        text(r.await)
    }

    #[tool(description = "Where every file's copies are: this Mac (verified/partial/missing) and the server's Object Storage (stored/syncing/unknown)")]
    async fn library_copies(&self) -> String {
        let r = async {
            self.signed_in()?;
            let server = self.auth.get_ok("GET", "/api/vault/files", None).await.unwrap_or(Value::Null);
            let mut out = Vec::new();
            for m in self.vault.catalog.list().await.map_err(|e| e.to_string())? {
                let hash: iroh_blobs::Hash = m.hash.parse().map_err(|e| format!("{e}"))?;
                let here = matches!(self.vault.store.blobs().status(hash).await, Ok(iroh_blobs::api::proto::BlobStatus::Complete { .. }));
                let stored = server.as_array().and_then(|a| a.iter().find(|f| f["hash"] == m.hash.as_str())).map(|f| f["stored"].as_bool().unwrap_or(false));
                out.push(json!({ "hash": m.hash, "name": m.original_name, "here": if here { "verified" } else { "missing" },
                                 "server": match stored { Some(true) => "stored", Some(false) => "syncing", None => "unknown" } }));
            }
            Ok(Value::Array(out))
        };
        text(r.await)
    }

    #[tool(description = "Ingest files or folders into the vault with the three-hash check (source = disk = iroh); returns the session's summary")]
    async fn ingest(&self, Parameters(a): Parameters<IngestArgs>) -> String {
        let r = async {
            self.signed_in()?;
            if let Some(c) = &a.class {
                crate::stories::by_hand(c)?;
            }
            // an agent ingests into a story (or the inbox) — but a file already in the vault stays where it is: moving
            // files is the admin's, by hand in the app
            let s = crate::run_ingest(&self.handle, &self.vault, a.paths, a.tags, a.story, a.class, false).await.map_err(|e| format!("{e:#}"))?;
            serde_json::to_value(s).map_err(|e| e.to_string())
        };
        text(r.await)
    }

    #[tool(description = "Describe a file (library enrichment): title, description, tags, public, and more meta; syncs like everything else")]
    async fn library_describe(&self, Parameters(a): Parameters<DescribeArgs>) -> String {
        let r = async {
            self.signed_in()?;
            let hash: iroh_blobs::Hash = a.hash.parse().map_err(|e| format!("{e}"))?;
            let patch = json!({ "title": a.title, "description": a.description, "tags": a.tags, "public": a.public, "meta": a.meta });
            let patch: serde_json::Map<String, Value> = patch.as_object().unwrap().iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k.clone(), v.clone())).collect();
            let meta = self.vault.catalog.describe(hash, &Value::Object(patch)).await.map_err(|e| format!("{e:#}"))?;
            serde_json::to_value(meta).map_err(|e| e.to_string())
        };
        text(r.await)
    }

    // ── stories: the buckets every file lives in ──

    #[tool(description = "Every story, read only (the admin creates stories and moves files in the app) — the inbox first: id, title, description, series, episode, the destinations of each class (default, original, proxy, delivery), and what it holds")]
    async fn stories_list(&self) -> String {
        let r = async {
            self.signed_in()?;
            let inbox = self.vault.catalog.inbox_id();
            let files = self.vault.catalog.list().await.map_err(|e| format!("{e:#}"))?;
            let stories = self.vault.catalog.stories().await.map_err(|e| format!("{e:#}"))?;
            let out: Vec<Value> = stories
                .into_iter()
                .map(|s| {
                    let mine: Vec<_> = files.iter().filter(|m| if s.id == inbox { m.story.is_empty() } else { m.story == s.id }).collect();
                    json!({ "id": s.id, "inbox": s.id == inbox, "title": s.title, "description": s.description, "series": s.series,
                        "episode": s.episode, "rules": s.rules, "files": mine.len(), "bytes": mine.iter().map(|m| m.size).sum::<u64>() })
                })
                .collect();
            Ok::<_, String>(Value::Array(out))
        };
        text(r.await)
    }

    #[tool(description = "Create a story (no id), or change a story's title (at most five words), description (the full hook), series and episode. Its destinations (rules) stay the admin's: a new story gets the defaults (avenSSD + hetzner for every class)")]
    async fn story_save(&self, Parameters(a): Parameters<StoryArgs>) -> String {
        let r = async {
            self.signed_in()?;
            let cat = &self.vault.catalog;
            let mut story = match a.id.as_deref().filter(|i| !i.is_empty()) {
                Some(id) => cat.stories().await.map_err(|e| format!("{e:#}"))?.into_iter().find(|s| s.id == id).ok_or("no such story")?,
                None => vault_core::catalog::Story::default(),
            };
            if story.id == cat.inbox_id() {
                return Err("the inbox is not a story to change".to_string());
            }
            if let Some(t) = a.title {
                story.title = t;
            }
            if let Some(d) = a.description {
                story.description = d;
            }
            if let Some(s) = a.series {
                story.series = s;
            }
            if let Some(e) = a.episode {
                story.episode = e;
            }
            let saved = cat.save_story(story).await.map_err(|e| format!("{e:#}"))?;
            serde_json::to_value(vault_core::catalog::Story { key: String::new(), ..saved }).map_err(|e| e.to_string())
        };
        text(r.await)
    }

    // ── media: probe, proxy ──

    #[tool(description = "What a movie in the vault is (codec, size, frame rate, length, bit depth, colour tags), read natively by AVFoundation")]
    async fn media_probe(&self, Parameters(a): Parameters<HashArg>) -> String {
        let r = async {
            self.signed_in()?;
            let path = self.export(&a.hash).await?;
            let p = tokio::task::spawn_blocking(move || vault_media::probe(&path)).await.map_err(|e| e.to_string())?.map_err(|e| format!("{e:#}"))?;
            serde_json::to_value(p).map_err(|e| e.to_string())
        };
        text(r.await)
    }

    #[tool(description = "Queue a movie's HD proxy to be made again — its colour read again, taken through its journey into ACEScct, the proxy put beside the original (the same pipeline every ingest runs)")]
    async fn media_proxy(&self, Parameters(a): Parameters<HashArg>) -> String {
        let r = async {
            self.signed_in()?;
            a.hash.parse::<iroh_blobs::Hash>().map_err(|e| e.to_string())?;
            tauri::async_runtime::spawn(crate::proxies::auto_proxy(self.handle.clone(), self.vault.clone(), a.hash.clone(), std::path::PathBuf::new()));
            Ok::<_, String>(json!({ "queued": a.hash }))
        };
        text(r.await)
    }

    // ── the studio: timelines (edit), renders (grade, render), jobs ──

    #[tool(description = "Every timeline (edits of the journal films), with its stage: edit, locked, graded, rendered")]
    async fn timelines_list(&self) -> String {
        text(self.api("GET", "/api/timelines", None).await)
    }

    #[tool(description = "Save changes to a timeline: clips (edit, audio), meta, the film's grade, the stage")]
    async fn timeline_save(&self, Parameters(a): Parameters<SaveArgs>) -> String {
        text(self.api("PUT", &format!("/api/timelines/{}", a.id), Some(a.patch)).await)
    }

    #[tool(description = "Grade one clip of a timeline: its ASC CDL in ACEScct (slope, offset, power per channel, and saturation), or none to take it off. The cut stays as it is; a locked timeline may be graded.")]
    async fn grade_clip(&self, Parameters(a): Parameters<GradeClipArgs>) -> String {
        let r = async {
            let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
            let mut clips = t["clips"].as_array().cloned().ok_or("the timeline has no clips")?;
            let clip = clips.iter_mut().find(|c| c["id"].as_str() == Some(a.clip.as_str())).ok_or("no such clip on this timeline")?;
            clip["grade"] = match &a.grade {
                Some(g) => serde_json::to_value(g).map_err(|e| e.to_string())?,
                None => Value::Null,
            };
            self.api("PUT", &format!("/api/timelines/{}", a.timeline), Some(json!({ "clips": clips }))).await
        };
        text(r.await)
    }

    #[tool(description = "Grade the whole film: its look — a named preset (neutral, cold, dip, bright, night, warm) or an ASC CDL of its own in ACEScct — applied after every clip's own grade.")]
    async fn grade_film(&self, Parameters(a): Parameters<GradeFilmArgs>) -> String {
        let r = async {
            const PRESETS: [&str; 6] = ["neutral", "cold", "dip", "bright", "night", "warm"];
            if let Some(p) = &a.preset {
                if !PRESETS.contains(&p.as_str()) {
                    return Err(format!("no preset {p} — one of {}", PRESETS.join(", ")));
                }
            }
            let grade = match (&a.look, &a.preset) {
                (Some(look), _) => json!({ "look": look }),
                (None, Some(p)) if p != "neutral" => json!({ "look": null, "preset": p }),
                _ => Value::Null,
            };
            self.api("PUT", &format!("/api/timelines/{}", a.timeline), Some(json!({ "grade": grade }))).await
        };
        text(r.await)
    }

    #[tool(
        description = "Queue a timeline's final render — rendered natively on this Mac by maiaCITY Studio (Core Image on Metal, VideoToolbox; world clips as ACEScct plates in its own world): every delivery shape (16:9 4K HEVC master + 1080 H.264, 9:16, 1:1, 4:5), colour-managed through ACES 2.0, levelled to −14 LUFS, QC'd, into the vault as deliveries and onto the calendar. One render per timeline at a time; follow it with renders_list."
    )]
    async fn render_queue(&self, Parameters(a): Parameters<IdArg>) -> String {
        text(self.api("POST", &format!("/api/timelines/{}/renders", a.id), None).await)
    }

    #[tool(description = "A timeline's renders (and hero frames) as this Mac renders them: status, progress, note, the film's hash, the report (colour transforms, conform, plates, QC and loudness per delivery)")]
    async fn renders_list(&self, Parameters(a): Parameters<IdArg>) -> String {
        text(self.api("GET", &format!("/api/timelines/{}/renders", a.id), None).await)
    }

    #[tool(
        description = "Queue a hero frame, rendered natively on this Mac: one frame of a timeline at t seconds in one delivery shape, at that delivery's full resolution through the whole chain (conformed original or world plate → its journey into ACEScct → framing → clip grade → film look → ACES 2.0 output), without captions, as a 16-bit PNG in the vault (role:frame) — for grading against. Follow it with renders_list: the job's output_hash is the PNG."
    )]
    async fn render_frame(&self, Parameters(a): Parameters<FrameArgs>) -> String {
        let shape = a.shape.unwrap_or_else(|| "16:9".into());
        text(self.api("POST", &format!("/api/timelines/{}/frames", a.timeline), Some(json!({ "t": a.t, "shape": shape }))).await)
    }

    // ── the content board: deliveries per platform, draft and publish ──

    #[tool(description = "The content board: items per day and platform (blog, Instagram, X, LinkedIn …) with their status idea → hook → draft → derivatives → scheduled → published")]
    async fn content_list(&self, Parameters(r): Parameters<Range>) -> String {
        let q = match (r.from, r.to) {
            (Some(f), Some(t)) => format!("?from={f}&to={t}"),
            (Some(f), None) => format!("?from={f}"),
            _ => String::new(),
        };
        text(self.api("GET", &format!("/api/content{q}"), None).await)
    }

    #[tool(description = "Create a content item (a delivery for one platform), usually as a draft")]
    async fn content_create(&self, Parameters(a): Parameters<Item>) -> String {
        text(self.api("POST", "/api/content", Some(a.item)).await)
    }

    #[tool(description = "Change a content item — its text, files, schedule, or status (draft → scheduled → published: publish mode)")]
    async fn content_save(&self, Parameters(a): Parameters<SaveArgs>) -> String {
        text(self.api("PUT", &format!("/api/content/{}", a.id), Some(a.patch)).await)
    }

    // ── anything else the admin may do ──

    #[tool(description = "Any maiaCITY API call under /api/ with the app's key (shots, grades, jobs, LUTs, media …) — the same rights the admin gave this Mac")]
    async fn api_call(&self, Parameters(a): Parameters<ApiArgs>) -> String {
        if !a.path.starts_with("/api/") {
            return "error: only paths under /api/".into();
        }
        text(self.api(&a.method.to_uppercase(), &a.path, a.body).await)
    }
}

/// What library_list says of a transcript: that it is there, and how much — not its words.
fn transcript_summary(t: &Value) -> Value {
    let n = t["words"].as_array().map(Vec::len).unwrap_or(0);
    let text = t["text"].as_str().unwrap_or("");
    let preview: String = text.chars().take(160).collect();
    json!({ "words": n, "language": t["language"], "model": t["model"], "at": t["at"], "of": t["of"],
            "preview": if preview.len() < text.len() { format!("{preview}…") } else { preview } })
}

/// The file's start timecode in frames, its nominal frame rate and the frames' separator (`;` drop-frame) — from the
/// probe (the vault server reads the camera's tmcd track), else the transcript's own copy.
fn start_timecode(meta: &Value) -> Option<(u64, u64, String)> {
    let tc = meta.pointer("/probe/timecode").or_else(|| meta.pointer("/transcript/timecode"))?.as_str()?;
    let fps = meta.pointer("/probe/timecode_fps").or_else(|| meta.pointer("/transcript/timecode_fps"))?.as_f64()?;
    // timecode counts whole frames at the nominal rate (23.976 → 24)
    let nominal = fps.round().max(1.0) as u64;
    let parts: Vec<u64> = tc.split([':', ';', '.']).filter_map(|p| p.parse().ok()).collect();
    let [h, m, s, f] = parts[..] else { return None };
    let sep = if tc.contains(';') { ";" } else { ":" };
    Some((((h * 60 + m) * 60 + s) * nominal + f, nominal, sep.to_string()))
}

/// A moment of the file (seconds) as timecode: the file's start timecode plus the moment.
fn word_timecode(meta: &Value, seconds: f64) -> Option<String> {
    let (start, fps, sep) = start_timecode(meta)?;
    let frames = start + (seconds.max(0.0) * fps as f64).round() as u64;
    let secs = frames / fps;
    Some(format!("{:02}:{:02}:{:02}{sep}{:02}", secs / 3600 % 24, secs / 60 % 60, secs % 60, frames % fps))
}

/// A file's transcript for the `transcript` tool: its words (between from and to), each with its timecode.
fn transcript_view(meta: &vault_core::Meta, from: Option<f64>, to: Option<f64>) -> Value {
    let m = &meta.meta;
    let state = m.get("transcript_state").cloned().unwrap_or(Value::Null);
    let Some(t) = m.get("transcript").filter(|t| t.is_object()) else {
        return json!({ "hash": meta.hash, "name": meta.original_name, "transcript": null,
            "state": if state.is_null() { json!("not yet: the vault server transcribes a recording once it is in the bucket") } else { state } });
    };
    let inside = |v: &Value| {
        let (s, e) = (v["s"].as_f64().unwrap_or(0.0), v["e"].as_f64().unwrap_or(0.0));
        from.is_none_or(|f| e > f) && to.is_none_or(|t| s < t)
    };
    let with_tc = |v: &Value| {
        let mut v = v.clone();
        if let Some(tc) = word_timecode(m, v["s"].as_f64().unwrap_or(0.0)) {
            v["tc"] = json!(tc);
        }
        v
    };
    let words: Vec<Value> = t["words"].as_array().into_iter().flatten().filter(|w| inside(w)).map(with_tc).collect();
    let utterances: Vec<Value> = t["utterances"].as_array().into_iter().flatten().filter(|u| inside(u)).map(with_tc).collect();
    let text = if from.is_some() || to.is_some() {
        json!(words.iter().filter_map(|w| w["w"].as_str()).collect::<Vec<_>>().join(" "))
    } else {
        t["text"].clone()
    };
    json!({
        "hash": meta.hash, "name": meta.original_name, "state": state, "audio": m.get("audio"),
        "model": t["model"], "language": t["language"], "at": t["at"],
        "timecode": m.pointer("/probe/timecode").or_else(|| t.get("timecode")),
        "timecode_fps": m.pointer("/probe/timecode_fps").or_else(|| t.get("timecode_fps")),
        "text": text, "utterances": utterances, "words": words,
    })
}

/// Words as the search compares them: lower case, letters and digits only.
fn tokens(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|w| w.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect::<String>())
        .filter(|w| !w.is_empty())
        .collect()
}

/// Every place a phrase is said in a transcript: its start and end (seconds of the file) and the sentence around it.
fn find_phrase(t: &Value, want: &[String]) -> Vec<(f64, f64, String)> {
    let words = t["words"].as_array().cloned().unwrap_or_default();
    let said: Vec<String> = words.iter().map(|w| tokens(w["w"].as_str().unwrap_or("")).join("")).collect();
    let utterances = t["utterances"].as_array().cloned().unwrap_or_default();
    let mut out = Vec::new();
    if want.is_empty() || said.len() < want.len() {
        return out;
    }
    for i in 0..=said.len() - want.len() {
        if said[i..i + want.len()] != *want {
            continue;
        }
        let s = words[i]["s"].as_f64().unwrap_or(0.0);
        let e = words[i + want.len() - 1]["e"].as_f64().unwrap_or(s);
        let context = utterances
            .iter()
            .find(|u| u["s"].as_f64().unwrap_or(f64::MAX) <= s + 1e-6 && u["e"].as_f64().unwrap_or(0.0) >= s)
            .and_then(|u| u["text"].as_str().map(String::from))
            .unwrap_or_else(|| {
                let (a, b) = (i.saturating_sub(6), (i + want.len() + 6).min(words.len()));
                words[a..b].iter().filter_map(|w| w["w"].as_str()).collect::<Vec<_>>().join(" ")
            });
        out.push((s, e, context));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transcript() -> Value {
        json!({
            "model": "deepgram/general-nova-3", "language": "en", "text": "Day twenty. The city starts with one street.",
            "words": [
                { "w": "Day", "s": 0.48, "e": 0.8, "c": 1.0, "sp": 0 }, { "w": "twenty.", "s": 0.8, "e": 1.3, "c": 1.0, "sp": 0 },
                { "w": "The", "s": 1.84, "e": 2.0, "c": 1.0, "sp": 0 }, { "w": "city", "s": 2.0, "e": 2.4, "c": 1.0, "sp": 0 },
                { "w": "starts", "s": 2.4, "e": 2.8, "c": 1.0, "sp": 0 }, { "w": "with", "s": 2.8, "e": 2.96, "c": 1.0, "sp": 0 },
                { "w": "one", "s": 2.96, "e": 3.28, "c": 1.0, "sp": 0 }, { "w": "street.", "s": 3.28, "e": 3.78, "c": 1.0, "sp": 0 }
            ],
            "utterances": [{ "s": 0.48, "e": 1.3, "text": "Day twenty.", "sp": 0 }, { "s": 1.84, "e": 3.78, "text": "The city starts with one street.", "sp": 0 }]
        })
    }

    #[test]
    fn a_phrase_is_found_by_its_words() {
        let hits = find_phrase(&transcript(), &tokens("One STREET"));
        assert_eq!(hits, vec![(2.96, 3.78, "The city starts with one street.".to_string())]);
        assert_eq!(find_phrase(&transcript(), &tokens("twenty the")).len(), 1); // across a sentence end
        assert!(find_phrase(&transcript(), &tokens("two streets")).is_empty());
    }

    #[test]
    fn a_word_s_timecode_is_the_start_plus_its_time() {
        let meta = json!({ "probe": { "timecode": "14:03:22:11", "timecode_fps": 23.976 } });
        assert_eq!(word_timecode(&meta, 0.0).as_deref(), Some("14:03:22:11"));
        // 2.96 s at 24 frames: 71 frames; 11 + 71 = 82 = 3 s 10 f
        assert_eq!(word_timecode(&meta, 2.96).as_deref(), Some("14:03:25:10"));
        let drop = json!({ "probe": { "timecode": "01:00:00;00", "timecode_fps": 29.97 } });
        assert_eq!(word_timecode(&drop, 1.0).as_deref(), Some("01:00:01;00"));
        assert_eq!(word_timecode(&json!({}), 1.0), None);
        // from the transcript's own copy when a probe lost it
        let kept = json!({ "transcript": { "timecode": "00:59:59:24", "timecode_fps": 25.0 } });
        assert_eq!(word_timecode(&kept, 0.04).as_deref(), Some("01:00:00:00"));
    }

    #[test]
    fn a_clip_s_words() {
        let meta = vault_core::Meta {
            hash: "h".into(),
            meta: json!({ "transcript": transcript(), "probe": { "timecode": "10:00:00:00", "timecode_fps": 25.0 } }),
            ..Default::default()
        };
        let v = transcript_view(&meta, Some(2.0), Some(3.0));
        assert_eq!(v["text"], "city starts with one");
        assert_eq!(v["words"][0]["tc"], "10:00:02:00");
        let listed = transcript_summary(&transcript());
        assert_eq!(listed["words"], 8);
        assert!(listed.get("utterances").is_none());
        let none = transcript_view(&vault_core::Meta::default(), None, None);
        assert!(none["transcript"].is_null());
    }
}

impl Studio {
    /// A vault file on disk for the native media tools (exported from the store into the ingest area).
    async fn export(&self, hex: &str) -> Result<PathBuf, String> {
        let hash: iroh_blobs::Hash = hex.parse().map_err(|e| format!("{e}"))?;
        let meta = self.vault.catalog.meta(hash).await.map_err(|e| e.to_string())?.ok_or("no such file in the catalog")?;
        let ext = meta.original_name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_else(|| "bin".into());
        let path = self.vault.ingest_dir().join(format!("{hex}.{ext}"));
        if !path.exists() {
            self.vault.store.blobs().export(hash, &path).await.map_err(|e| format!("{e:#}"))?;
        }
        Ok(path)
    }
}

#[tool_handler]
impl ServerHandler for Studio {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build()).with_instructions(
            "maiaCITY Studio: the media vault (every file by its BLAKE3 hash) and the whole studio — ingest, library \
             enrichment, probes and proxies, every recording's transcript (words with their times and timecode — find \
             a phrase to cut by words), timelines (edit, audio), grades, renders and hero frames (rendered \
             natively on this Mac), and the content board's deliveries in draft and publish mode. Files are named by \
             hash only.",
        )
    }
}

/// Serve the MCP endpoint on this Mac, behind the token.
pub async fn serve(vault: Arc<Vault>, auth: Auth, handle: AppHandle) -> anyhow::Result<()> {
    let token = token()?;
    let files = crate::local::router(vault.clone());
    let service = StreamableHttpService::new(
        move || Ok(Studio::new(vault.clone(), auth.clone(), handle.clone())),
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default(),
    );
    let guard = move |req: Request, next: Next| {
        let ok = req.headers().get("authorization").and_then(|v| v.to_str().ok()) == Some(format!("Bearer {token}").as_str());
        async move { if ok { Ok::<Response, StatusCode>(next.run(req).await) } else { Err(StatusCode::UNAUTHORIZED) } }
    };
    // the MCP for agents; the plain vault routes for this Mac's own tools (the film scripts) — one token for both
    let app = axum::Router::new().nest_service("/mcp", service).merge(files).layer(axum::middleware::from_fn(guard));
    let listener = tokio::net::TcpListener::bind(ADDR).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

/// For the studio's panel: how an agent connects (the address and this Mac's token — shown only in the app itself).
#[tauri::command]
pub fn mcp_info() -> Result<Value, String> {
    crate::gate()?;
    let token = token().map_err(|e| e.to_string())?;
    Ok(json!({
        "url": format!("http://{ADDR}/mcp"),
        "claude": format!("claude mcp add --transport http maiacity-studio http://{ADDR}/mcp --header \"Authorization: Bearer {token}\""),
    }))
}
