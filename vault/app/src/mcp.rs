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
use serde::Deserialize;
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
pub struct IdArg {
    pub id: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct SaveArgs {
    pub id: String,
    /// the fields to change, as the API takes them
    pub patch: Value,
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
                .collect();
            serde_json::to_value(list).map_err(|e| e.to_string())
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

    #[tool(description = "Queue a timeline's render (every delivery shape, colour-managed, QC'd)")]
    async fn render_queue(&self, Parameters(a): Parameters<IdArg>) -> String {
        text(self.api("POST", &format!("/api/timelines/{}/renders", a.id), None).await)
    }

    #[tool(description = "A timeline's renders and their deliveries")]
    async fn renders_list(&self, Parameters(a): Parameters<IdArg>) -> String {
        text(self.api("GET", &format!("/api/timelines/{}/renders", a.id), None).await)
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
             enrichment, probes and proxies, timelines (edit, audio), grades and renders, and the content board's \
             deliveries in draft and publish mode. Files are named by hash only.",
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
    // the MCP for agents; the plain vault routes for this Mac's own tools (the render worker) — one token for both
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
