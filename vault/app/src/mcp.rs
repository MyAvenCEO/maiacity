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
use vault_core::{Meta, Vault};

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
pub struct AnalysisArgs {
    /// the file's BLAKE3 hash (64 hex) — an original; its proxy's, audio proxy's or thumbnail's hash works too
    pub hash: String,
    /// only the cues and stretches between these seconds of the file
    pub from: Option<f64>,
    pub to: Option<f64>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct AnalysisSetupArgs {
    /// the stories whose files are analysed (story ids); ["*"] every story; [] back to the default (Day 01). Leave it
    /// out to keep what is set.
    pub stories: Option<Vec<String>>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct FindShotsArgs {
    /// words to find — in a cue's label, note or why, in what is said in its range, in the file's summary and tags,
    /// e.g. "window light", "laughs", "opening line"
    pub query: Option<String>,
    /// base tags (game/film/vocabulary.json), each one value or a list of any: {"shot_size": ["CU", "ECU"],
    /// "scene": "dialogue", "location": "exterior", "people": 1}. A file matches where its tags do, or only in the
    /// stretches whose tags do
    pub tags: Option<serde_json::Map<String, Value>>,
    /// only these cue kinds: take, action, emotion, cut, transition, highlight, problem (none: all but problems)
    pub kinds: Option<Vec<String>>,
    /// only in this story (its id)
    pub story: Option<String>,
    /// only cues at least this sure (0…1)
    pub min_confidence: Option<f64>,
    /// at most this many ranges (default 20)
    pub limit: Option<usize>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct IdArg {
    pub id: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct RenderArgs {
    /// the timeline
    pub id: String,
    /// "youtube-4k": the 16:9 4K master for YouTube alone (HEVC 10-bit, 80 Mb/s, AAC 384 kb/s) — the studio's one
    /// delivery for now; left out: every delivery shape
    #[serde(default)]
    pub delivery: Option<String>,
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

/// A shot's balance — the fixed first nodes, in ACEScct, before its grade. Every amount in stops; 0 = as shot.
#[derive(Deserialize, Serialize, schemars::JsonSchema, Default)]
pub struct BalanceArg {
    /// white balance: + warmer (red up, blue down, half each), −2…2
    #[serde(default)]
    pub temp: f64,
    /// white balance: + more magenta (green down), −2…2
    #[serde(default)]
    pub tint: f64,
    /// −4…4 stops
    #[serde(default)]
    pub exposure: f64,
    /// the slope around mid grey minus 1: 0.2 = 20 % more contrast, −0.8…1.5
    #[serde(default)]
    pub contrast: f64,
    /// stops added to the tones above mid grey (fully in at about 2.5 stops above it), −3…3
    #[serde(default)]
    pub highlights: f64,
    /// stops added to the tones below mid grey ("lows"), −3…3
    #[serde(default)]
    pub shadows: f64,
    /// the saturation around luma minus 1: 0.2 = 20 % more colour, −1…1
    #[serde(default)]
    pub sat: f64,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct BalanceArgs {
    /// the timeline's id
    pub timeline: String,
    /// the clip's id (a V1 clip)
    pub clip: String,
    /// its balance; none: as shot
    pub balance: Option<BalanceArg>,
}

/// Parts of one shot's frame named by hand, each a box [x0, y0, x1, y1] from the frame's top left, 0…1.
#[derive(Deserialize, Serialize, Default, Clone, schemars::JsonSchema)]
pub struct RegionsArg {
    /// a white object known to be neutral (a wall, a T-shirt, the rug)
    pub white: Option<[f64; 4]>,
    /// a grey object known to be neutral
    pub grey: Option<[f64; 4]>,
    /// a real black
    pub black: Option<[f64; 4]>,
    /// the skin: the key side of the face, cheeks and forehead (else the face Vision finds)
    pub skin: Option<[f64; 4]>,
}

fn regions_of(r: Option<std::collections::HashMap<String, RegionsArg>>) -> std::collections::HashMap<String, vault_render::look::Regions> {
    r.unwrap_or_default()
        .into_iter()
        .map(|(k, v)| (k, vault_render::look::Regions { white: v.white, grey: v.grey, black: v.black, skin: v.skin }))
        .collect()
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct LookArgs {
    /// the timeline's id
    pub timeline: String,
    /// the clips to read (ids, in order); none: every picture clip with a file
    pub clips: Option<Vec<String>>,
    /// per clip id, parts of its frame named by hand
    pub regions: Option<std::collections::HashMap<String, RegionsArg>>,
    /// true: through each shot's grade and looks as well (the whole chain, as the film shows it); default: after its
    /// balance only (the base correction)
    pub looks: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct ScopesArgs {
    /// the timeline's id
    pub timeline: String,
    /// the clips, one row each, in order — the first is the reference (the scene's master)
    pub clips: Vec<String>,
    /// per clip id, parts of its frame named by hand (drawn as boxes, and the skin box used)
    pub regions: Option<std::collections::HashMap<String, RegionsArg>>,
    /// true: through each shot's grade and looks as well (the whole chain); default: after its balance only
    pub looks: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct SecondaryArgs {
    /// the timeline's id
    pub timeline: String,
    /// the clip's id (a V1 clip)
    pub clip: String,
    /// its secondaries (at most 4), each { name?, key?: { hue: [centre°, width°] (the vectorscope's; skin 123°), sat:
    /// [lo, hi] (chroma × 100), luma: [lo, hi] (IRE), soft 0…1 }, window?: { shape: ellipse | rect, x, y (centre,
    /// 0…1 from the top left), w, h (parts of the frame, or of the face with track: face), angle°, feather 0…1,
    /// invert, track?: "face" }, adjust: { temp, tint, exposure, contrast, highlights, shadows, sat } (the balance's
    /// units), mix 0…1 } — a key alone, a window alone, or a key inside a window; none or []: take them off
    pub secondaries: Option<Value>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct ReferenceArgs {
    /// the reference stills (a moodboard): the files' hashes in the vault
    pub hashes: Vec<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct FinishArgs {
    /// the timeline's id
    pub timeline: String,
    /// the film's finishing, after its looks: { pop?: { amount −1…1, radius px@1080 }, halation?: { amount 0…1,
    /// threshold (ACEScct, 0.55), radius px@1080 }, bloom?: { same }, grain?: { amount 0…1 (0.25: felt, not seen),
    /// size px@1080, chroma 0…1 }, vignette?: { amount 0…1 (1: 1.5 stops), size (1: the frame's edge), softness,
    /// roundness } } — none: take it off
    pub finish: Option<Value>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct LookSetArgs {
    /// the timeline's id
    pub timeline: String,
    /// the scene whose look this is (as its clips name it in script.scene); none: the film's look
    pub scene: Option<String>,
    /// the look: { cdl?, preset?, contrast (−1…1), pivot (ACEScct, mid grey 0.414), split?: { shadows: { hue°, amount
    /// 0…1 }, highlights: { hue°, amount }, balance −1…1 }, hue?: [[hue°, shift°]…], hue_sat?: [[hue°, factor]…], hue_lum?: [[hue°, stops −2…2]…], hi_sat? (the highlights' saturation 0…2: a sky clipped in camera back to white), sat,
    /// lut? (a .cube's hash, ACEScct in and out), strength 0…1 } — hues on the vectorscope (the skin line 123°);
    /// none: take it off
    pub look: Option<Value>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct MatchArgs {
    /// the timeline's id
    pub timeline: String,
    /// the clips to level (ids): a scene's shots; none: every picture clip with a file
    pub clips: Option<Vec<String>>,
    /// the scene's master, which the others are matched to as it is balanced now (never an average)
    pub reference: Option<String>,
    /// true: each clip's own neutrals (the white or grey named, else its whites and middle tones) to grey, then
    /// `warmth` warmer — for a scene's master; its exposure, contrast and the rest stay as they are
    pub neutral: Option<bool>,
    /// with neutral: how much warmer than neutral, in stops of temp (a touch ≈ 0.25, clearly ≈ 0.5; − cooler)
    pub warmth: Option<f64>,
    /// per clip id, parts of its frame named by hand (a known white, grey, black, the skin)
    pub regions: Option<std::collections::HashMap<String, RegionsArg>>,
    /// per clip id, elements not to match (blacks, whites, mids, skin, white, grey, black) — what that shot has only
    /// by content (a frame without real blacks) — or only one side of one: `skin.level` (feet on a bright rug need
    /// not be as bright as a face), `whites.colour` (a cream rug is not a white wall)
    pub skip: Option<std::collections::HashMap<String, Vec<String>>>,
    /// false: only propose the balances, write nothing (default true: write them)
    pub apply: Option<bool>,
}

#[derive(Deserialize, Serialize, schemars::JsonSchema)]
pub struct TensionPoint {
    /// where in the section, 0 (its start) … 1 (its end)
    pub t: f64,
    /// the tension there, 0 (released) … 1 (at its height)
    pub v: f64,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct StorySection {
    /// thumbnail (one frame: the picture the film is shown by), hook, act1, act2, act3, cliffhanger
    pub section: String,
    /// where it starts on the timeline, seconds
    pub start: f64,
    /// how long it runs, seconds (a thumbnail: 0.05)
    pub dur: f64,
    /// what it does for the story (its promise, its turn, its open loop)
    pub text: Option<String>,
    /// the tension across it: rises and releases inside every section, a higher peak in each act, an open loop at the end
    pub tension: Option<Vec<TensionPoint>>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct ArcArgs {
    /// the timeline's id
    pub timeline: String,
    /// the story's parts in order; they replace the ones it has
    pub sections: Vec<StorySection>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct DeleteArgs {
    /// the files' BLAKE3 hashes
    pub hashes: Vec<String>,
    /// why (kept with the file)
    pub why: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct MixClip {
    /// the clip's id (an A1, A2 or A3 clip)
    pub clip: String,
    /// its gain in dB (0 = as recorded; −60…+12)
    pub gain_db: Option<f64>,
    /// fade in, seconds
    pub fin: Option<f64>,
    /// fade out, seconds
    pub fout: Option<f64>,
    /// gain keys along the clip, [seconds into the clip, dB] (straight lines between them, the ends held; on top of
    /// the gain) — a breath or a sniff dipped: [[1.2, 0], [1.25, -20], [1.7, -20], [1.75, 0]]; [] takes them off
    pub keys: Option<Vec<[f64; 2]>>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct MixArgs {
    /// the timeline's id
    pub timeline: String,
    /// the clips to change
    pub clips: Vec<MixClip>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct EqArgs {
    /// the timeline's id
    pub timeline: String,
    /// the sound clips to set it on (ids)
    pub clips: Option<Vec<String>>,
    /// or every clip with a file on this track (A1 voice, A2 music, A3 sounds)
    pub track: Option<String>,
    /// the EQ, bands in order (replaces the clip's; [] takes it off): { type: highpass | lowshelf | peaking | notch |
    /// highshelf | lowpass, f: Hz 20–20000, gain: dB ±24 (shelves, peaks), q: 0.1–18 (plain Q; default 0.707, a
    /// peak's or notch's 1; shelves have a slope of 1) } — at most 8
    pub eq: Vec<Value>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct MatchSoundArgs {
    /// the timeline's id
    pub timeline: String,
    /// the sound clips to match (ids)
    pub clips: Vec<String>,
    /// the clip whose tone they should have (through its own EQ), e.g. the voice-over for a camera's voice
    pub reference: String,
    /// the octaves matched, Hz (default 100–10000, a voice's range)
    pub lo: Option<f64>,
    pub hi: Option<f64>,
    /// the most any band may lift or cut, dB (default 6)
    pub limit: Option<f64>,
    /// how much of the difference to take, 0–1 (default 0.8: close, not a copy)
    pub amount: Option<f64>,
    /// also set each clip's gain so it plays as loud as the reference (default true)
    pub level: Option<bool>,
    /// false: only propose, write nothing (default true)
    pub apply: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct LevelArgs {
    /// the timeline's id
    pub timeline: String,
    /// LUFS per track instead of the defaults (A1 voice −18, A2 music −26, A3 sounds −30), e.g. { "A2": -24 }
    pub targets: Option<std::collections::HashMap<String, f64>>,
    /// false: only propose, write nothing (default true)
    pub apply: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct PlaybackArgs {
    /// the timeline's id
    pub timeline: String,
    /// the moment on the timeline, in seconds from 0
    pub t: f64,
    /// how many frames to read one after another from there, and time (default 15)
    pub frames: Option<usize>,
    /// the shape (default 16:9)
    pub shape: Option<String>,
    /// true: play the originals (as Picture: Original does), else each shot's proxy
    pub originals: Option<bool>,
    /// player_stream_check: true plays exactly what the studio loaded last (its timeline, shape, files)
    pub as_studio: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct JobsArgs {
    /// "list" (the default), "cancel" (a queued job), "bump" (a queued job to the front of its lane) or "retry" (a
    /// failed or cancelled one)
    pub action: Option<String>,
    /// the job's id, for cancel, bump and retry
    pub id: Option<String>,
    /// how many finished jobs of the history (default 30)
    pub history: Option<usize>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct WordFix {
    /// the word's place in the transcript's words (0 first, as `transcript` lists them)
    pub i: usize,
    /// what was said: one word keeps the timing; several share it; empty takes the word out
    pub w: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct TranscriptEditArgs {
    /// the recording's BLAKE3 hash
    pub hash: String,
    /// the words put right
    pub fixes: Vec<WordFix>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct DownloadArgs {
    /// the file's BLAKE3 hash
    pub hash: String,
    /// the name to give it (default: the name it came in as)
    pub name: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct PlayerStateArgs {
    /// drive the studio's player first, as the viewer does: "play", "pause" or "sync" (at `t`)
    pub action: Option<String>,
    /// seconds on the timeline for the action
    pub t: Option<f64>,
    /// then watch it this long (ms, at most 10000), sampling its state every 250 ms
    pub watch_ms: Option<u64>,
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
    /// where each class of its files is kept — store names per class: {"default": [...], "original": [...], "proxy":
    /// [...], "delivery": [...]} ("avenSSD" this Mac, "hetzner" the server's Object Storage, a drive's name e.g.
    /// "SDD_A"). Asked of the person first (a store added fetches the files there, one left out lets them go there).
    pub rules: Option<Value>,
    /// why the rules change (shown to the person)
    pub why: Option<String>,
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

    #[tool(
        description = "Every file in the vault's catalog with its description (hash, size, mime, kind, title, tags, public, meta) — its transcript and shot analysis in brief (meta.transcript, meta.analysis: the `transcript` and `analysis` tools give them whole), meta.preview (its one picture: a JPEG of its grading still's frame, graded once a clip grades it) and meta.thumbnail (the moment the analysis picked: { t, why })"
    )]
    async fn library_list(&self, Parameters(f): Parameters<Filter>) -> String {
        let r = async {
            self.signed_in()?;
            let list = self.vault.catalog.list_view().await.map_err(|e| e.to_string())?;
            let list: Vec<_> = list
                .into_iter()
                .filter(|m| f.kind.as_ref().is_none_or(|k| &m.kind == k))
                .filter(|m| f.tag.as_ref().is_none_or(|t| m.tags.contains(t)))
                .map(|mut m| {
                    // a transcript is said, not listed: its words come with the `transcript` tool
                    if let Some(t) = m.meta.get_mut("transcript") {
                        *t = transcript_summary(t);
                    }
                    if let Some(a) = m.meta.get_mut("analysis") {
                        *a = crate::analysis::summary(a);
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
        description = "A recording's transcript (made on this Mac by Phonon-2; a voice take's own words; put right by hand in the Script tab or with transcript_edit — the captions' one truth): its text, sentences and every word with its start and end in seconds of the file (a clip's in/out map straight onto them), confidence, speaker, and — for camera files with a start timecode — each word's timecode (HH:MM:SS:FF). from/to narrow it to a clip. Also the transcript's state (transcribing, failed …) and the audio proxy's hash."
    )]
    async fn transcript(&self, Parameters(a): Parameters<TranscriptArgs>) -> String {
        let r = async {
            self.signed_in()?;
            let hash: iroh_blobs::Hash = a.hash.parse().map_err(|e| format!("{e}"))?;
            let meta = self.original(hash).await?;
            Ok::<_, String>(transcript_view(&meta, a.from, a.to))
        };
        text(r.await)
    }

    #[tool(
        description = "Make a recording's words again, here on this Mac (Phonon-2, on-device, English; what it had is set aside) — queued behind any ingest, one recording at a time; follow it in library_list (meta.transcript_state, meta.transcript_progress)"
    )]
    async fn transcribe(&self, Parameters(a): Parameters<HashArg>) -> String {
        let r = async {
            self.signed_in()?;
            let h: iroh_blobs::Hash = a.hash.parse().map_err(|e| format!("{e}"))?;
            let rec = json!({ "state": "queued", "device": self.vault.endpoint.id().to_string(), "updated": vault_core::ingest::now_iso() });
            self.vault.catalog.write_record(vault_core::catalog::TRANSCRIPT, h, &rec).await.map_err(|e| format!("{e:#}"))?;
            crate::transcripts::queue(self.handle.clone(), self.vault.clone(), a.hash.clone());
            Ok::<_, String>(json!({ "queued": a.hash }))
        };
        text(r.await)
    }

    #[tool(
        description = "Once, by hand, on one Mac: download the on-device models (Phonon-2 speech, Silero VAD) from where they were published — Phonon-2's ONNX made here by vault/tools/phonon2_onnx.py --int8 and put in ~/Library/Application Support/city.maia.studio/models-made/phonon-2/ first — ingest them into the Models story (the three-hash check) and compare each with the BLAKE3 hash pinned in the app (models.rs). After that every device gets them from our own vault, never from the internet. Answers each file's hash and whether it matches its pin."
    )]
    async fn models_import(&self) -> String {
        let r = async {
            self.signed_in()?;
            crate::models::import(&self.vault, &reqwest::Client::new()).await
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
            for m in self.vault.catalog.list_view().await.map_err(|e| format!("{e:#}"))? {
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

    // ── the shot analysis: every picture tagged for the edit (this Mac writes it: analysis/<hash>, analyse/) ──

    #[tool(
        description = "Set up the shot analysis on this Mac: the stories whose files are analysed (story ids; [\"*\"] every story; [] back to the default, the Day 01 story). The Mac samples the frames; the model is asked through our server (POST /api/analysis), whose key it is. Answers what is set."
    )]
    async fn analysis_setup(&self, Parameters(a): Parameters<AnalysisSetupArgs>) -> String {
        let r = async {
            self.signed_in()?;
            crate::analyse::setup(a.stories)
        };
        text(r.await)
    }

    #[tool(description = "Analyse a file again (its shot tags, cues and thumbnail): its analysis record goes back to queued, its tries forgotten, and this Mac's analysis takes it up in its next round.")]
    async fn analyse_again(&self, Parameters(a): Parameters<HashArg>) -> String {
        let r = async {
            self.signed_in()?;
            crate::analyse::again(&self.vault, &a.hash).await?;
            Ok::<_, String>(json!({ "queued": a.hash }))
        };
        text(r.await)
    }

    #[tool(
        description = "A file's shot analysis (Prem's confidential Qwen, asked from this Mac once the file's proxy is here, in game/film/vocabulary.json's terms): its summary (one line + where it serves an edit best), base tags (shot size, angle, camera movement, lens, depth of field, light, time of day, location, people, who, scene kind, quality flags), free tags, its stretches with their own tags, and its cues — takes (repeated attempts of an action, numbered and ranked, the best marked with why), actions, emotions, cut points, transition opportunities, highlights, problems — each with its start and end in seconds of the file and its timecodes (tc_in, tc_out). from/to narrow it to a clip. Also its state/progress and its thumbnail's hash."
    )]
    async fn analysis(&self, Parameters(a): Parameters<AnalysisArgs>) -> String {
        let r = async {
            self.signed_in()?;
            let hash: iroh_blobs::Hash = a.hash.parse().map_err(|e| format!("{e}"))?;
            let meta = self.original(hash).await?;
            Ok::<_, String>(crate::analysis::view(&meta, a.from, a.to))
        };
        text(r.await)
    }

    #[tool(
        description = "Find the best parts of shots across the vault, to cut with: filters on the base tags (e.g. {\"shot_size\": [\"CU\", \"ECU\"], \"scene\": \"dialogue\"}) and words (in the cues, what is said, the summaries), optionally cue kinds (highlight, take, emotion, cut, transition, action, problem), a story, a minimum confidence. Answers the candidate ranges, best first: each with the file (hash, name, story, its proxy and thumbnail), its in and out in seconds of the file and as timecode, the cue's kind, label, why/note, take and rank, and a score (the words found, the confidence, a highlight or best take up, a problem or quality flag down)."
    )]
    async fn find_shots(&self, Parameters(a): Parameters<FindShotsArgs>) -> String {
        let r = async {
            self.signed_in()?;
            let tags = a
                .tags
                .unwrap_or_default()
                .into_iter()
                .map(|(k, v)| {
                    let vals = match v {
                        Value::Array(xs) => xs.iter().map(|x| x.as_str().map(String::from).unwrap_or_else(|| x.to_string())).collect(),
                        Value::String(s) => vec![s],
                        other => vec![other.to_string()],
                    };
                    (k, vals)
                })
                .collect();
            let q = crate::analysis::Query {
                text: a.query.unwrap_or_default(),
                tags,
                kinds: a.kinds.unwrap_or_default(),
                story: a.story,
                min_confidence: a.min_confidence.unwrap_or(0.0),
                limit: a.limit.unwrap_or(20),
            };
            let list = self.vault.catalog.list_view().await.map_err(|e| format!("{e:#}"))?;
            let analysed = list.iter().filter(|m| m.meta.get("analysis").is_some()).count();
            Ok::<_, String>(json!({ "analysed_files": analysed, "hits": crate::analysis::find(&list, &q) }))
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

    #[tool(description = "Create a story (no id), or change a story's title (at most five words), description (the full hook), series and episode — and where its files are kept (rules: the stores per class — avenSSD this Mac, hetzner the server's Object Storage, a drive by its name). A new story gets avenSSD + hetzner for every class. A change of rules is asked of the person first (a modal shows before and after; the call waits); on yes each store fetches or lets go of the story's files by itself.")]
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
            if let Some(r) = a.rules {
                let rules: vault_core::catalog::Rules = serde_json::from_value(r).map_err(|e| format!("rules: {e}"))?;
                if rules != story.rules {
                    let question = json!({ "kind": "rules", "story": story.title, "why": a.why.clone().unwrap_or_default(), "before": story.rules, "after": rules });
                    match crate::asks::ask(&self.handle, question).await {
                        Some(true) => story.rules = rules,
                        Some(false) => return Err("the person said no: the story's rules stay as they are (nothing saved)".into()),
                        None => return Err("nobody answered in 15 minutes: the story's rules stay as they are (nothing saved)".into()),
                    }
                }
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
            let src = self.source(&a.hash).await?;
            let p = tokio::task::spawn_blocking(move || vault_media::probe(src)).await.map_err(|e| e.to_string())?.map_err(|e| format!("{e:#}"))?;
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

    #[tool(
        description = "Save changes to a timeline: clips (edit, audio), meta, the film's grade (send the whole clips array). A clip is a media clip ({ hash }), a world clip, a slate (kind 'slate', V1, no hash: a shot of the script not filmed yet) or a line (kind 'line', A1, no hash, { text }: a line not recorded yet, in the captions already) or a section (kind 'section', S1: the story's structure — set it with story_arc). A V1 clip may carry script: { scene, label, description, notes, size (EWS WS FS MS MCU CU ECU insert) } — the Script tab is these same clips; a slate swapped for a file keeps its script."
    )]
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

    #[tool(
        description = "Set one shot's balance — the fixed first nodes, applied in ACEScct before its creative grade, in the preview and the render alike: white balance (temp, tint), exposure, contrast, highlights, lows (shadows), saturation (sat); every amount in stops (contrast and sat: the factor minus 1), 0 = as shot; none: back to as shot. The cut stays as it is; a locked timeline may be balanced."
    )]
    async fn grade_balance(&self, Parameters(a): Parameters<BalanceArgs>) -> String {
        let r = async {
            let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
            let mut clips = t["clips"].as_array().cloned().ok_or("the timeline has no clips")?;
            let clip = clips.iter_mut().find(|c| c["id"].as_str() == Some(a.clip.as_str())).ok_or("no such clip on this timeline")?;
            clip["balance"] = match &a.balance {
                Some(b) => serde_json::to_value(b).map_err(|e| e.to_string())?,
                None => Value::Null,
            };
            let saved = self.api("PUT", &format!("/api/timelines/{}", a.timeline), Some(json!({ "clips": clips }))).await?;
            let now = saved["clips"].as_array().and_then(|cs| cs.iter().find(|c| c["id"].as_str() == Some(a.clip.as_str()))).map(|c| c["balance"].clone());
            Ok::<_, String>(json!({ "clip": a.clip, "balance": now }))
        };
        text(r.await)
    }

    #[tool(
        description = "Read a timeline's shots for the base correction, as a colourist does, natively on this Mac from the real thing — each shot's 4K grading still (else its original's frame; never a proxy) through the ACES 2.0 output, as the Rec.709 display shows it: levels in IRE (p1…p99, contrast, clipped %, saturation), the blacks, the whites and the middle tones (level and cast: warm = R − B, green = G − (R + B)/2, in IRE), the skin of the face Apple Vision finds (or the box named: its level, its hue against the skin line at 123°, its saturation) and any white, grey or black named by hand — as shot and after each clip's balance."
    )]
    async fn grade_look(&self, Parameters(a): Parameters<LookArgs>) -> String {
        let r = async {
            let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
            let looks = crate::render::look_clips(&self.vault, &t, a.clips, regions_of(a.regions), Default::default(), a.looks == Some(true)).await?;
            let shots: Vec<Value> = looks.into_iter().map(|l| l.map(|l| l.json).unwrap_or_else(|e| e)).collect();
            Ok::<_, String>(json!({ "timeline": a.timeline, "shots": shots }))
        };
        text(r.await)
    }

    #[tool(
        description = "A scope sheet to look at, drawn natively from the shots' 4K grading stills after their balances: one row per clip (the first is the reference, the scene's master) — the picture with the skin box and any boxes named, its waveform (5/10/50/90/100 IRE), RGB parade and vectorscope (the skin line, rings at chroma 0.1 and 0.2). Returned as the picture itself (shown inline) and each row's numbers. Look at it before and after every balance."
    )]
    async fn grade_scopes(&self, Parameters(a): Parameters<ScopesArgs>) -> rmcp::model::CallToolResult {
        let r = async {
            let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
            crate::render::scope_sheet(&self.vault, &t, a.clips, regions_of(a.regions), a.looks == Some(true)).await
        };
        match r.await {
            Ok((rows, png)) => rmcp::model::CallToolResult::success(vec![
                rmcp::model::ContentBlock::text(serde_json::to_string_pretty(&rows).unwrap_or_default()),
                rmcp::model::ContentBlock::image(base64(&png), "image/png"),
            ]),
            Err(e) => rmcp::model::CallToolResult::error(vec![rmcp::model::ContentBlock::text(e)]),
        }
    }

    #[tool(
        description = "The base correction's balances (story-producer grading.md), fitted natively from the shots' 4K grading stills by the elements a colourist matches — blacks, whites, the middle and the skin (Apple Vision's face, or the boxes named), through the ACES 2.0 output — with the balance nodes only (white balance, exposure, contrast, highlights, lows, saturation; no look). neutral: a scene master's own neutrals to grey, then `warmth` stops warmer. Else: every clip matched to `reference`, the scene's master as it is balanced now (a reference is required: never an average). Returns each shot's balance, the elements it was matched by and what they will read after it (predicted); writes them unless apply: false — propose first, look at grade_scopes, then write."
    )]
    async fn grade_match(&self, Parameters(a): Parameters<MatchArgs>) -> String {
        let r = async {
            let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
            let mut out = crate::render::propose_balances(
                &self.vault,
                &t,
                a.clips.clone(),
                a.reference.clone(),
                a.neutral == Some(true),
                a.warmth.unwrap_or(0.0),
                regions_of(a.regions),
                a.skip.unwrap_or_default(),
            )
            .await?;
            let apply = a.apply != Some(false);
            if apply {
                // fetched again: what changed on the timeline while the shots were read stays
                let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
                let mut clips = t["clips"].as_array().cloned().ok_or("the timeline has no clips")?;
                for p in out["shots"].as_array().into_iter().flatten().filter(|p| p.get("error").is_none()) {
                    if let Some(c) = clips.iter_mut().find(|c| c["id"] == p["clip"]) {
                        c["balance"] = p["balance"].clone();
                    }
                }
                self.api("PUT", &format!("/api/timelines/{}", a.timeline), Some(json!({ "clips": clips }))).await?;
            }
            out["applied"] = json!(apply);
            Ok::<_, String>(out)
        };
        text(r.await)
    }

    #[tool(
        description = "Listen to a timeline's sound, measured natively (BS.1770, as the render levels it): every sound clip's loudness (LUFS) and true peak through its EQ, as recorded and at its volume (gain_db), its fades, its EQ and spectrum (octave bands 63 Hz–16 kHz: each one's share of its energy where it speaks, dB — compare a clip's tone with another's), a loudness curve every 0.5 s, and per voice clip how far the music under it sits below it (voice_over_music_lu; the render keys the music down 6 dB while the voice speaks — 12 to 18 LU keeps a voice clear). The render levels the whole mix to −14 LUFS / −1 dBTP at the end."
    )]
    async fn audio_measure(&self, Parameters(a): Parameters<IdArg>) -> String {
        let r = async {
            let t = self.api("GET", &format!("/api/timelines/{}", a.id), None).await?;
            crate::render::measure_sound(&self.vault, &t).await
        };
        text(r.await)
    }

    #[tool(
        description = "Set a timeline's story structure — the Script tab's Story track: the thumbnail (one frame), the hook, act 1, act 2, act 3, the cliffhanger, each with what it does and its tension curve (rises and releases inside each part, the highest peak late, an open loop at the end). Replaces the sections it has; the picture, the sound and the captions stay."
    )]
    async fn story_arc(&self, Parameters(a): Parameters<ArcArgs>) -> String {
        let r = async {
            let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
            let mut clips: Vec<Value> = t["clips"].as_array().cloned().unwrap_or_default().into_iter().filter(|c| c["kind"] != "section").collect();
            for (i, s) in a.sections.iter().enumerate() {
                clips.push(json!({ "id": format!("story-{}-{i}", s.section), "kind": "section", "track": "S1", "start": s.start, "in": 0, "dur": s.dur, "vol": 0,
                    "section": s.section, "text": s.text.clone().unwrap_or_default(), "tension": s.tension.as_ref().map(|p| json!(p)).unwrap_or(json!([])) }));
            }
            let saved = self.api("PUT", &format!("/api/timelines/{}", a.timeline), Some(json!({ "clips": clips }))).await?;
            let n = saved["clips"].as_array().map(|c| c.iter().filter(|c| c["kind"] == "section").count()).unwrap_or(0);
            Ok::<_, String>(json!({ "sections": n }))
        };
        text(r.await)
    }

    #[tool(
        description = "Delete files from the vault for good — never by yourself: the person is asked first. The studio shows them a modal with every file that would go (with it: the files made of it — proxies, grading stills, previews, thumbnails) and your why; the call waits for their answer (up to 15 minutes). On yes, each file's description says it is deleted (when, why), no device lists it, every Mac lets go of it and iroh's garbage collection prunes its bytes, and the server empties Object Storage of it — it cannot be undone. On no (or no answer), nothing happens."
    )]
    async fn library_delete(&self, Parameters(a): Parameters<DeleteArgs>) -> String {
        let r = async {
            let all = self.vault.catalog.list().await.map_err(|e| format!("{e:#}"))?;
            let mut asked: Vec<String> = Vec::new();
            for h in &a.hashes {
                h.parse::<iroh_blobs::Hash>().map_err(|e| format!("{h}: {e}"))?;
                if !all.iter().any(|m| &m.hash == h) {
                    return Err(format!("no file {h} in the library"));
                }
                if !asked.contains(h) {
                    asked.push(h.clone());
                }
            }
            // and every file made of one of them (its proxy, grading still, preview, thumbnail: a `<role>_of` it names)
            let made_of = |m: &Meta, of: &str| m.meta.as_object().is_some_and(|o| o.iter().any(|(k, v)| k.ends_with("_of") && v.as_str() == Some(of)));
            let mut with: Vec<String> = Vec::new();
            for h in &asked {
                for m in all.iter().filter(|m| made_of(m, h) && !asked.contains(&m.hash)) {
                    if !with.contains(&m.hash) {
                        with.push(m.hash.clone());
                    }
                }
            }
            let file = |h: &String, part: &str| {
                let m = all.iter().find(|m| &m.hash == h).expect("listed");
                let preview = ["preview", "thumbnail"].iter().find_map(|k| m.meta.get(*k).and_then(|v| v.as_str()).map(String::from));
                let preview = preview.or_else(|| m.mime.starts_with("image/").then(|| m.hash.clone()));
                json!({ "hash": h, "name": m.original_name, "title": m.title, "kind": m.kind, "class": m.class, "role": m.meta.get("role"),
                    "story": m.story, "size": m.size, "preview": preview, "part": part })
            };
            let files: Vec<Value> = asked.iter().map(|h| file(h, "asked")).chain(with.iter().map(|h| file(h, "with"))).collect();
            let question = json!({ "kind": "delete", "why": a.why, "files": files, "bytes": files.iter().filter_map(|f| f["size"].as_u64()).sum::<u64>() });
            match crate::asks::ask(&self.handle, question).await {
                Some(true) => {
                    let mut done = Vec::new();
                    for h in asked.iter().chain(with.iter()) {
                        let hash: iroh_blobs::Hash = h.parse().map_err(|e| format!("{h}: {e}"))?;
                        self.vault.catalog.delete_file(hash, &a.why).await.map_err(|e| format!("{e:#}"))?;
                        done.push(h.clone());
                    }
                    Ok::<_, String>(json!({ "approved": true, "deleted": done }))
                }
                Some(false) => Ok(json!({ "approved": false, "deleted": [], "note": "the person said no: nothing was deleted" })),
                None => Ok(json!({ "approved": false, "deleted": [], "note": "nobody answered in 15 minutes: nothing was deleted" })),
            }
        };
        text(r.await)
    }

    #[tool(description = "Set sound clips' gain (dB, 0 = as recorded, −60…+12), fades (seconds) and gain keys along a clip (a dip under a breath or a sniff, a swell) — the sound design's hand on the mix, the same in the render and the studio's playback.")]
    async fn audio_mix(&self, Parameters(a): Parameters<MixArgs>) -> String {
        let r = async {
            let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
            let mut clips = t["clips"].as_array().cloned().ok_or("the timeline has no clips")?;
            for m in &a.clips {
                let c = clips.iter_mut().find(|c| c["id"].as_str() == Some(m.clip.as_str())).ok_or_else(|| format!("no clip {}", m.clip))?;
                if let Some(g) = m.gain_db {
                    c["vol"] = json!(((10f64.powf(g.clamp(-60.0, 12.0) / 20.0)) * 1000.0).round() / 1000.0);
                }
                if let Some(f) = m.fin {
                    c["fin"] = json!(f.max(0.0));
                }
                if let Some(f) = m.fout {
                    c["fout"] = json!(f.max(0.0));
                }
                if let Some(k) = &m.keys {
                    let keys = vault_render::sound::clean_keys(&json!(k));
                    if keys.is_empty() {
                        c.as_object_mut().map(|o| o.remove("keys"));
                    } else {
                        c["keys"] = json!(keys);
                    }
                }
            }
            self.api("PUT", &format!("/api/timelines/{}", a.timeline), Some(json!({ "clips": clips }))).await?;
            Ok::<_, String>(json!({ "changed": a.clips.len() }))
        };
        text(r.await)
    }

    #[tool(
        description = "Level a timeline's sound automatically: measures it (audio_measure), then brings every clip to its track's loudness — voice (A1) −18 LUFS, music (A2) −26, sounds (A3) −30, or targets of your own — within +12 dB, with fades so nothing clicks (voice ≥ 0.05 s, music 1 s in / 2.5 s out at the film's ends, sounds 0.3 s). Writes it (apply: false only proposes). Check with audio_measure; adjust single clips with audio_mix."
    )]
    async fn audio_level(&self, Parameters(a): Parameters<LevelArgs>) -> String {
        let r = async {
            let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
            let measured = crate::render::measure_sound(&self.vault, &t).await?;
            let clips = t["clips"].as_array().cloned().ok_or("the timeline has no clips")?;
            let end = clips.iter().map(|c| c["start"].as_f64().unwrap_or(0.0) + c["dur"].as_f64().unwrap_or(0.0)).fold(0.0, f64::max);
            let targets: Vec<(String, f64)> = a.targets.clone().unwrap_or_default().into_iter().collect();
            let changes = crate::render::level_sound(&measured, &clips, &targets, end);
            let apply = a.apply != Some(false);
            if apply {
                let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
                let mut clips = t["clips"].as_array().cloned().ok_or("the timeline has no clips")?;
                for ch in &changes {
                    if let Some(c) = clips.iter_mut().find(|c| c["id"] == ch["clip"]) {
                        for k in ["vol", "fin", "fout"] {
                            if !ch[k].is_null() {
                                c[k] = ch[k].clone();
                            }
                        }
                    }
                }
                self.api("PUT", &format!("/api/timelines/{}", a.timeline), Some(json!({ "clips": clips }))).await?;
            }
            Ok::<_, String>(json!({ "applied": apply, "changes": changes, "voice_over_music_before": measured["voice_over_music"] }))
        };
        text(r.await)
    }

    #[tool(
        description = "Set the EQ of sound clips — named ones, or every clip with a file on a track. Bands in order, each a biquad from the Audio EQ Cookbook, the same in the render's mix and the studio's playback: highpass (rumble, handling, wind: 70–120 Hz on a voice), lowshelf, peaking (a boost or cut around f; q 0.7 wide … 4 narrow), notch (a hum), highshelf (air), lowpass. Replaces the clip's EQ; [] takes it off. Check with audio_measure (each clip's spectrum, through its EQ); audio_match builds one from a reference. Voice rules in story-producer sound.md."
    )]
    async fn audio_eq(&self, Parameters(a): Parameters<EqArgs>) -> String {
        let r = async {
            let eq = serde_json::to_value(vault_render::eq::clean_eq(&json!(a.eq))).map_err(|e| e.to_string())?;
            if eq.as_array().map(Vec::len) != Some(a.eq.len()) {
                return Err(format!("{} of the {} bands are not EQ bands (or change nothing): {eq}", a.eq.len() - eq.as_array().map(Vec::len).unwrap_or(0), a.eq.len()));
            }
            let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
            let mut clips = t["clips"].as_array().cloned().ok_or("the timeline has no clips")?;
            let mut changed = Vec::new();
            for c in clips.iter_mut() {
                let id = c["id"].as_str().unwrap_or_default().to_string();
                let named = a.clips.as_ref().is_some_and(|ids| ids.contains(&id));
                let on_track = a.track.as_deref().is_some_and(|tr| c["track"] == tr && c["hash"].is_string());
                if !(named || on_track) {
                    continue;
                }
                if !c["track"].as_str().is_some_and(|tr| tr.starts_with('A')) {
                    return Err(format!("clip {id} is not a sound clip"));
                }
                if eq.as_array().is_some_and(Vec::is_empty) {
                    c.as_object_mut().map(|o| o.remove("eq"));
                } else {
                    c["eq"] = eq.clone();
                }
                changed.push(id);
            }
            for id in a.clips.iter().flatten() {
                if !changed.contains(id) {
                    return Err(format!("no clip {id}"));
                }
            }
            self.api("PUT", &format!("/api/timelines/{}", a.timeline), Some(json!({ "clips": clips }))).await?;
            Ok::<_, String>(json!({ "changed": changed, "eq": eq }))
        };
        text(r.await)
    }

    #[tool(
        description = "Match sound clips' tone to a reference clip's — the sound's grade_match: measures each clip's spectrum without its EQ and the reference's through its own (octave bands where they speak, audio_measure), and builds the EQ that closes the difference (a peaking band per octave from lo to hi, within ±limit dB, solved for how the bands overlap; a high-pass when the reference has far less below). Tone only; with level (the default) each clip's gain then makes it play as loud as the reference. Replaces the clips' EQ. Returns the EQ, the spectra before and after, and the gains. Use it for a camera's voice against the lav's or the voice-over's, a scene's sound against its master."
    )]
    async fn audio_match(&self, Parameters(a): Parameters<MatchSoundArgs>) -> String {
        let r = async {
            let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
            let all = t["clips"].as_array().cloned().ok_or("the timeline has no clips")?;
            let find = |id: &str| all.iter().find(|c| c["id"] == id).cloned().ok_or_else(|| format!("no clip {id}"));
            let reference = find(&a.reference)?;
            let (lo, hi) = (a.lo.unwrap_or(100.0).clamp(20.0, 20000.0), a.hi.unwrap_or(10000.0).clamp(20.0, 20000.0));
            let limit = a.limit.unwrap_or(6.0).clamp(0.5, 24.0);
            let amount = a.amount.unwrap_or(0.8).clamp(0.0, 1.0);
            // one clip and the reference measured at a time: nothing else is read
            let measure = |clips: Vec<Value>| {
                let mut one = t.clone();
                one["clips"] = json!(clips);
                async move { crate::render::measure_sound(&self.vault, &one).await }
            };
            let spectrum_of = |m: &Value, id: &str| -> Option<(Vec<f64>, Value)> {
                let c = m["clips"].as_array()?.iter().find(|c| c["clip"] == id)?;
                Some((c["spectrum"].as_array()?.iter().filter_map(|p| p[1].as_f64()).collect(), c.clone()))
            };
            let mut out = Vec::new();
            let mut results: Vec<(String, Value, Option<f64>)> = Vec::new();
            for id in &a.clips {
                let mut plain = find(id)?;
                if !plain["track"].as_str().is_some_and(|tr| tr.starts_with('A')) {
                    return Err(format!("clip {id} is not a sound clip"));
                }
                plain.as_object_mut().map(|o| o.remove("eq"));
                let m = measure(vec![plain.clone(), reference.clone()]).await?;
                let (from, _) = spectrum_of(&m, id).ok_or_else(|| format!("clip {id}: silent, or its file is not here"))?;
                let (to, r) = spectrum_of(&m, &a.reference).ok_or("the reference is silent, or its file is not here")?;
                let to_scaled: Vec<f64> = from.iter().zip(&to).map(|(f, t)| f + amount * (t - f)).collect();
                let bands = vault_render::eq::matching(&from, &to_scaled, lo, hi, limit, vault_render::av::RATE as f64);
                let eq = serde_json::to_value(&bands).map_err(|e| e.to_string())?;
                let mut matched = plain.clone();
                if !bands.is_empty() {
                    matched["eq"] = eq.clone();
                }
                let after = measure(vec![matched]).await?;
                let (got, c) = spectrum_of(&after, id).ok_or("measuring it again failed")?;
                // its gain: as loud as the reference plays
                let vol = (a.level != Some(false)).then(|| {
                    let g = r["lufs_at_vol"].as_f64()? - c["lufs"].as_f64()?;
                    Some((10f64.powf(g.clamp(-60.0, 12.0) / 20.0) * 1000.0).round() / 1000.0)
                }).flatten();
                let bands_json = |s: &[f64]| vault_render::eq::OCTAVES.iter().zip(s).map(|(f, v)| json!([f, v])).collect::<Vec<_>>();
                out.push(json!({ "clip": id, "eq": eq, "vol_before": plain["vol"], "vol": vol, "lufs_after_eq_at_old_vol": c["lufs"].as_f64().zip(plain["vol"].as_f64()).map(|(l, v)| l + 20.0 * v.max(1e-6).log10()),
                    "reference_lufs_at_vol": r["lufs_at_vol"], "spectrum_before": bands_json(&from), "spectrum_after": bands_json(&got), "reference_spectrum": bands_json(&to) }));
                results.push((id.clone(), eq, vol));
            }
            let apply = a.apply != Some(false);
            if apply {
                let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
                let mut clips = t["clips"].as_array().cloned().ok_or("the timeline has no clips")?;
                for (id, eq, vol) in &results {
                    if let Some(c) = clips.iter_mut().find(|c| c["id"] == id.as_str()) {
                        if eq.as_array().is_some_and(Vec::is_empty) {
                            c.as_object_mut().map(|o| o.remove("eq"));
                        } else {
                            c["eq"] = eq.clone();
                        }
                        if let Some(v) = vol {
                            c["vol"] = json!(v.clamp(0.0, 4.0));
                        }
                    }
                }
                self.api("PUT", &format!("/api/timelines/{}", a.timeline), Some(json!({ "clips": clips }))).await?;
            }
            Ok::<_, String>(json!({ "applied": apply, "clips": out, "reference": a.reference }))
        };
        text(r.await)
    }

    #[tool(
        description = "A timeline's looks after its shots' own grades: the film's (`film`) and each scene's (`scenes`, keyed by the scene its clips name in script.scene), with the scenes on the timeline and their clips in order — every clip goes through its balance, its own grade, its scene's look, then the film's (story-producer look.md)."
    )]
    async fn looks(&self, Parameters(a): Parameters<IdArg>) -> String {
        let r = async {
            let t = self.api("GET", &format!("/api/timelines/{}", a.id), None).await?;
            let mut scenes: Vec<(String, Vec<Value>)> = Vec::new();
            let mut v1: Vec<&Value> = t["clips"].as_array().into_iter().flatten().filter(|c| c["track"] == "V1").collect();
            v1.sort_by(|a, b| a["start"].as_f64().unwrap_or(0.0).total_cmp(&b["start"].as_f64().unwrap_or(0.0)));
            for c in v1 {
                let scene = c["script"]["scene"].as_str().unwrap_or("").to_string();
                let entry = json!({ "clip": c["id"], "start": c["start"], "description": c["script"]["description"] });
                match scenes.iter_mut().find(|(s, _)| *s == scene) {
                    Some((_, clips)) => clips.push(entry),
                    None => scenes.push((scene, vec![entry])),
                }
            }
            let g = &t["grade"];
            Ok::<_, String>(json!({
                "film": g.get("film").cloned().unwrap_or(Value::Null),
                "film_cdl": { "look": g.get("look").cloned().unwrap_or(Value::Null), "preset": g.get("preset").cloned().unwrap_or(Value::Null) },
                "scenes": g.get("scenes").cloned().unwrap_or(json!({})),
                "scenes_on_timeline": scenes.into_iter().map(|(s, c)| json!({ "scene": if s.is_empty() { Value::Null } else { json!(s) }, "clips": c })).collect::<Vec<_>>(),
            }))
        };
        text(r.await)
    }

    #[tool(
        description = "Set the film's look (no scene) or a scene's look — after every shot's own balance and grade: base correction first, then the look. Colour only (the maths in Rust, baked into one cube per clip: the studio plays it live and the render uses the same). Returns the grade as saved. Check it with grade_scopes { looks: true } and grade_look { looks: true }."
    )]
    async fn look_set(&self, Parameters(a): Parameters<LookSetArgs>) -> String {
        let r = async {
            let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
            let mut g = t["grade"].clone();
            if !g.is_object() {
                g = json!({ "look": null });
            }
            let look = a.look.unwrap_or(Value::Null);
            match &a.scene {
                None => g["film"] = look,
                Some(scene) => {
                    if !g["scenes"].is_object() {
                        g["scenes"] = json!({});
                    }
                    g["scenes"][scene.as_str()] = look;
                }
            }
            let saved = self.api("PUT", &format!("/api/timelines/{}", a.timeline), Some(json!({ "grade": g }))).await?;
            Ok::<_, String>(json!({ "grade": saved["grade"] }))
        };
        text(r.await)
    }

    #[tool(
        description = "Set one shot's secondaries — parts of it (a key: a hue range with its chroma and luma; a window: an ellipse or rectangle, turned, feathered, inverted, or on the face Vision finds in every frame) given their own balance, after the shot's balance and before its grade and looks. Spatial: shown natively on the stills in the Grade tab and in the render. Check it with grade_scopes { looks: true }."
    )]
    async fn grade_secondary(&self, Parameters(a): Parameters<SecondaryArgs>) -> String {
        let r = async {
            let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
            let mut clips = t["clips"].as_array().cloned().ok_or("the timeline has no clips")?;
            let clip = clips.iter_mut().find(|c| c["id"].as_str() == Some(a.clip.as_str())).ok_or("no such clip on this timeline")?;
            clip["secondaries"] = a.secondaries.unwrap_or(Value::Null);
            let saved = self.api("PUT", &format!("/api/timelines/{}", a.timeline), Some(json!({ "clips": clips }))).await?;
            let now = saved["clips"].as_array().and_then(|cs| cs.iter().find(|c| c["id"].as_str() == Some(a.clip.as_str()))).map(|c| c["secondaries"].clone());
            Ok::<_, String>(json!({ "clip": a.clip, "secondaries": now }))
        };
        text(r.await)
    }

    #[tool(
        description = "Read reference stills — a moodboard of the look to get close to (pictures as they are shown, display-referred) — as grade_look reads a shot through its whole chain: levels (p1…p99 IRE, contrast), zones (shadows, middle, highlights: level, cast, hue and chroma on the vectorscope), where the colour lies (warm, green, teal/blue shares), saturation, and the skin of the face Vision finds. Compare them with grade_look { looks: true } on the timeline's shots."
    )]
    async fn look_reference(&self, Parameters(a): Parameters<ReferenceArgs>) -> String {
        let r = async {
            let mut out = Vec::new();
            for h in a.hashes {
                let hash: iroh_blobs::Hash = h.parse().map_err(|e| format!("{h}: {e}"))?;
                let src = crate::blob::source(&self.vault, hash, "reference.png").await.map_err(|e| format!("{e:#}"))?;
                let read = tauri::async_runtime::spawn_blocking(move || objc2::rc::autoreleasepool(|_| vault_render::look::reference(src)))
                    .await
                    .map_err(|e| format!("{e}"))?;
                out.push(match read {
                    Ok(mut v) => {
                        v["hash"] = json!(h);
                        v
                    }
                    Err(e) => json!({ "hash": h, "error": format!("{e:#}") }),
                });
            }
            Ok::<_, String>(json!({ "references": out }))
        };
        text(r.await)
    }

    #[tool(
        description = "Set the film's finishing, after its looks and before the output transform: contrast pop (local contrast), halation (red-orange glow around highlights), bloom, film grain (luma, a new pattern every frame), vignette (in stops) — each subtle. Spatial: shown natively on the stills in the Grade tab and in the render."
    )]
    async fn grade_finish(&self, Parameters(a): Parameters<FinishArgs>) -> String {
        let r = async {
            let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
            let mut g = t["grade"].clone();
            if !g.is_object() {
                g = json!({ "look": null });
            }
            g["finish"] = a.finish.unwrap_or(Value::Null);
            let saved = self.api("PUT", &format!("/api/timelines/{}", a.timeline), Some(json!({ "grade": g }))).await?;
            Ok::<_, String>(json!({ "grade": saved["grade"] }))
        };
        text(r.await)
    }

    #[tool(description = "Grade the whole film: its look — a named preset (neutral, cold, dip, bright, night, warm) or an ASC CDL of its own in ACEScct — applied after every clip's own grade.")]
    async fn grade_film(&self, Parameters(a): Parameters<GradeFilmArgs>) -> String {
        let r = async {
            if let Some(p) = &a.preset
                && vault_render::grade::preset(p).is_none()
            {
                let names: Vec<&str> = vault_render::grade::PRESETS.iter().map(|(n, _)| *n).collect();
                return Err(format!("no preset {p} — one of {}", names.join(", ")));
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
        description = "Queue a timeline's final render — rendered natively on this Mac by maiaCITY Studio (Core Image on Metal, VideoToolbox; world clips as ACEScct plates in its own world): every delivery shape (16:9 4K HEVC master + 1080 H.264, 9:16, 1:1, 4:5), or with delivery \"youtube-4k\" the 16:9 4K master for YouTube alone (HEVC 10-bit 80 Mb/s), colour-managed through ACES 2.0, levelled to −14 LUFS, QC'd, into the vault as deliveries and onto the calendar. One render per timeline at a time; follow it with renders_list."
    )]
    async fn render_queue(&self, Parameters(a): Parameters<RenderArgs>) -> String {
        let body = a.delivery.map(|d| json!({ "delivery": d })).unwrap_or_else(|| json!({}));
        text(self.api("POST", &format!("/api/timelines/{}/renders", a.id), Some(body)).await)
    }

    #[tool(description = "A timeline's renders (and hero frames) as this Mac renders them: status, progress, note, the film's hash, the report (colour transforms, conform, plates, QC and loudness per delivery)")]
    async fn renders_list(&self, Parameters(a): Parameters<IdArg>) -> String {
        text(self.api("GET", &format!("/api/timelines/{}/renders", a.id), None).await)
    }

    #[tool(
        description = "What the Grade tab's playback shows at t, checked without a screen: the timeline's composition as the Mac's player plays it (each shot from its proxy, else its original; every frame through the whole chain — balance, secondaries with the face tracked, grade and looks, finishing, output), then played by an AVPlayer for two seconds from t with the frames it hands out counted. Returns the first frame as the picture (compare it with the Grade viewer's still of the same shot) and played_fps (30 is real time; fewer: frames dropped)."
    )]
    async fn player_frame(&self, Parameters(a): Parameters<PlaybackArgs>) -> rmcp::model::CallToolResult {
        let r = async {
            let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
            crate::player::playback_frames(&self.vault, t, a.t, a.frames.unwrap_or(15), a.shape, a.originals == Some(true)).await
        };
        match r.await {
            Ok((info, jpg)) => rmcp::model::CallToolResult::success(vec![
                rmcp::model::ContentBlock::text(serde_json::to_string_pretty(&info).unwrap_or_default()),
                rmcp::model::ContentBlock::image(base64(&jpg), "image/jpeg"),
            ]),
            Err(e) => rmcp::model::CallToolResult::error(vec![rmcp::model::ContentBlock::text(e)]),
        }
    }

    #[tool(
        description = "Every process this Mac runs, in one place (the studio's Processes tab): proxies, grading stills, world proxies, renders and hero frames, transcripts, analyses, sound records, files kept, ingests — each with its lane (gpu, speech, ai, io: one at a time in each), state (queued, waiting and why, running, done, failed, cancelled), stage, progress and times; the running and queued first, then the history. Also: cancel a queued job, bump one to the front of its lane, retry a failed one."
    )]
    async fn jobs(&self, Parameters(a): Parameters<JobsArgs>) -> String {
        let id = a.id.clone().unwrap_or_default();
        let done = match a.action.as_deref().unwrap_or("list") {
            "list" => None,
            "cancel" => Some(crate::jobs::jobs_cancel(id)),
            "bump" => Some(crate::jobs::jobs_bump(id)),
            "retry" => Some(match crate::jobs::list(400).history.into_iter().find(|j| j.id == id) {
                Some(j) => crate::jobs::retry(&self.handle, &self.vault, &j).await,
                None => Err("no such job in the history".into()),
            }),
            other => Some(Err(format!("no action {other}: list, cancel, bump or retry"))),
        };
        if let Some(Err(e)) = done {
            return e;
        }
        let j = crate::jobs::list(a.history.unwrap_or(30));
        serde_json::to_string_pretty(&json!({ "active": j.active, "history": j.history, "holds": self.vault.hold.now() })).unwrap_or_default()
    }

    #[tool(
        description = "Put words of a recording's transcript right (a word heard wrong): each fix by its place in the transcript's words. The transcript is the captions' one truth — the preview and the render burn in what it says — and a transcript edited by hand is never transcribed again. Returns the transcript's text."
    )]
    async fn transcript_edit(&self, Parameters(a): Parameters<TranscriptEditArgs>) -> String {
        let r = async {
            let h: iroh_blobs::Hash = a.hash.parse().map_err(|e| format!("{e}"))?;
            let rec = self.vault.catalog.record(vault_core::catalog::TRANSCRIPT, h).await.map_err(|e| format!("{e:#}"))?.ok_or("no transcript yet")?;
            let mut words: Vec<Value> = rec["words"].as_array().cloned().ok_or("no words in its transcript")?;
            // from the last fix back, so each place stays where `transcript` showed it
            let mut fixes = a.fixes;
            fixes.sort_by(|x, y| y.i.cmp(&x.i));
            for f in fixes {
                let Some(old) = words.get(f.i).cloned() else { return Err(format!("no word {}", f.i)) };
                let said: Vec<&str> = f.w.split_whitespace().collect();
                let (s0, e0) = (old["s"].as_f64().unwrap_or(0.0), old["e"].as_f64().unwrap_or(0.0));
                let total: f64 = said.iter().map(|x| x.chars().count() as f64 + 1.0).sum();
                let mut at = s0;
                let made: Vec<Value> = said
                    .iter()
                    .map(|x| {
                        let d = if said.len() == 1 { e0 - s0 } else { (e0 - s0) * (x.chars().count() as f64 + 1.0) / total };
                        let w = json!({ "w": x, "s": at, "e": at + d });
                        at += d;
                        w
                    })
                    .collect();
                words.splice(f.i..=f.i, made);
            }
            let r = crate::transcripts::set_words(&self.vault, h, &words, "hand").await?;
            Ok::<_, String>(r["text"].as_str().unwrap_or_default().to_string())
        };
        r.await.unwrap_or_else(|e| e)
    }

    #[tool(
        description = "A vault file into this Mac's Downloads folder (as the Library's Download button does): copied out of the store under the name it came in as (or `name`), checked against its BLAKE3; ` (2)` added when one is there already. Returns where it went."
    )]
    async fn file_download(&self, Parameters(a): Parameters<DownloadArgs>) -> String {
        let name = match a.name {
            Some(n) => Some(n),
            None => self.vault.catalog.list().await.ok().and_then(|all| all.into_iter().find(|m| m.hash == a.hash)).map(|m| m.original_name).filter(|n| !n.is_empty()),
        };
        match crate::stories::download(&self.vault, &a.hash, name.as_deref()).await {
            Ok(at) => at,
            Err(e) => e,
        }
    }

    #[tool(
        description = "The studio's own player as it is now (the one the program monitor shows): its item's status and error, clock, rate, whether it plays or waits and why, the driving (where the studio wants it, the seek under way), loads made and pictures sent to the viewer. Optionally drive it first as the viewer does (play, pause or sync at t) and watch it for a while, sampled every 250 ms."
    )]
    async fn player_state(&self, Parameters(a): Parameters<PlayerStateArgs>) -> String {
        if let Some(action) = &a.action
            && let Err(e) = crate::player::drive(action, a.t.unwrap_or(0.0))
        {
            return e;
        }
        let watch = a.watch_ms.unwrap_or(0).min(10_000);
        let mut samples = vec![crate::player::state()];
        let started = std::time::Instant::now();
        while (started.elapsed().as_millis() as u64) < watch {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let mut s = crate::player::state();
            s["ms"] = json!(started.elapsed().as_millis());
            samples.push(s);
        }
        serde_json::to_string_pretty(&samples).unwrap_or_default()
    }

    #[tool(
        description = "The studio's playback run as the studio drives it, headless: the same player, video output, frame pump and driver the viewer gets its pictures from. Stopped on t (how long the frozen frame takes); the playhead dragged over two seconds of film in one second, a move every 16 ms (pictures during the drag, how long the last took); played three seconds against a clock kept every 250 ms as the studio keeps it (pictures a second: 30 is real time; seeks; how far off); and played as it was kept before (a seek whenever two frames off, once a second) for comparison. Returns those numbers and the frozen picture on t as the viewer would draw it."
    )]
    async fn player_stream_check(&self, Parameters(a): Parameters<PlaybackArgs>) -> rmcp::model::CallToolResult {
        let r = async {
            let t = self.api("GET", &format!("/api/timelines/{}", a.timeline), None).await?;
            crate::player::stream_check(&self.vault, t, a.t, a.originals == Some(true), a.as_studio == Some(true)).await
        };
        match r.await {
            Ok((info, pic)) => {
                let mut out = vec![rmcp::model::ContentBlock::text(serde_json::to_string_pretty(&info).unwrap_or_default())];
                if let Some(p) = pic {
                    out.push(rmcp::model::ContentBlock::image(base64(&p), "image/jpeg"));
                }
                rmcp::model::CallToolResult::success(out)
            }
            Err(e) => rmcp::model::CallToolResult::error(vec![rmcp::model::ContentBlock::text(e)]),
        }
    }

    #[tool(
        description = "Queue a frame of a timeline at t seconds, rendered natively on this Mac. Of a media clip it is that file's graded still: its grading still (the ACEScct frame it is graded on) through the clip's whole chain (16:9 framing → balance → secondaries → clip grade → scene and film look → ACES 2.0 output), 1920×1080 JPEG, set as the file's preview and replacing the one before (a timeline save that changes a file's look queues this by itself). Of a world clip: a hero frame in the shape asked for, a 16-bit PNG (role:frame), replacing that clip's previous one. Follow it with renders_list: the job's output_hash is the picture."
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
pub(crate) fn word_timecode(meta: &Value, seconds: f64) -> Option<String> {
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
pub(crate) fn tokens(text: &str) -> Vec<String> {
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
    /// A file as the studio sees it (its derived records merged in) — and for a proxy, an audio proxy or a thumbnail,
    /// its original's.
    async fn original(&self, hash: iroh_blobs::Hash) -> Result<vault_core::Meta, String> {
        let meta = self.vault.catalog.meta_view(hash).await.map_err(|e| format!("{e:#}"))?.ok_or("no such file in the catalog")?;
        let of = ["audio_of", "proxy_of", "thumbnail_of"].iter().find_map(|k| meta.meta.get(*k).and_then(|v| v.as_str()).and_then(|h| h.parse::<iroh_blobs::Hash>().ok()));
        match of {
            Some(o) => self.vault.catalog.meta_view(o).await.map_err(|e| format!("{e:#}"))?.ok_or_else(|| "its original is not in the catalog".to_string()),
            None => Ok(meta),
        }
    }

    /// A vault file on disk for the native media tools (exported from the store into the ingest area).
    /// A file of the vault, read in place from its blob store (never copied out).
    async fn source(&self, hex: &str) -> Result<vault_media::Source, String> {
        let hash: iroh_blobs::Hash = hex.parse().map_err(|e| format!("{e}"))?;
        let meta = self.vault.catalog.meta(hash).await.map_err(|e| e.to_string())?.ok_or("no such file in the catalog")?;
        crate::blob::source(&self.vault, hash, &meta.original_name).await.map_err(|e| format!("{e:#}"))
    }
}

#[tool_handler]
impl ServerHandler for Studio {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build()).with_instructions(
            "maiaCITY Studio: the media vault (every file by its BLAKE3 hash) and the whole studio — ingest, library \
             enrichment, probes and proxies, every recording's transcript (words with their times and timecode — find \
             a phrase to cut by words), every picture's shot analysis (tags, takes, cues, highlights — find_shots pulls \
             the best parts of shots), timelines (edit, audio), grades, renders and hero frames (rendered \
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

/// Standard base64 (an image shown inline over MCP).
fn base64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(A[(n >> 18) as usize & 63] as char);
        out.push(A[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { A[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { A[n as usize & 63] as char } else { '=' });
    }
    out
}
