//! Every recording's words, with their times — on the server, as part of the ingest: once a video or sound original is
//! in Object Storage, its speech track is extracted here (ffmpeg, reading the bucket's copy), kept in the vault as the
//! original's **audio proxy**, and transcribed by Deepgram Nova 3 through Prem's encrypted API (the API container holds
//! Prem's key and SDK: `POST /api/transcripts`, api/src/stt.ts). The words go into the original's description.
//!
//! What the catalog gets (iroh-docs is the truth; Postgres only mirrors it) — written as the server's author, always
//! read-merge-write on the newest description so nothing a Mac wrote is lost:
//!
//!   the audio proxy   `blobs/<hash>` + `meta/<hash>`: class proxy, the original's story, meta `{ role: "audio",
//!                     audio_of: <original> }` — AAC in an .m4a, mono, 24 kHz, 48 kbps (an hour is ~22 MB: under Prem's
//!                     25 MB for one request); the same start as the original (silence where its sound starts late) and
//!                     its sound's length. The Macs fetch it like any file (the studio plays a video's detached sound
//!                     from it).
//!   the original      `meta.audio` = the audio proxy's hash; `meta.transcript` = `{ model, language, text, words: [{ w,
//!                     s, e, c, sp }], utterances: [{ s, e, text, sp }], of, at, timecode?, timecode_fps? }` — times in
//!                     seconds of the original file; `meta.transcript_state` = transcribing · done · queued (Prem not set
//!                     up yet) · failed: … · none: no speech track; `meta.probe.timecode` + `timecode_fps` (the camera's
//!                     start timecode, from its tmcd track, or a BWF time reference) — a word's timecode is the start
//!                     timecode + its `s`.
//!
//! Longer than one request takes: cut into equal chunks (re-encoded from the audio proxy, exact to the sample), each
//! transcribed, the words shifted by their chunk's start and joined. Speaker numbers are per chunk.
//!
//! One recording at a time, in the order the bucket got them; a round on every new file in the bucket and every ten
//! minutes (so every original already stored gets one too — the backfill). A failure is tried three times, then it
//! waits for a person. A finished transcript is also kept on the server's disk (`VAULT_DATA/transcripts/<hash>.json`):
//! a description a Mac overwrote at the same moment gets it back without asking Prem again.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use iroh_blobs::Hash;
use serde_json::{Map, Value, json};
use tokio::io::AsyncReadExt;

use crate::{db, peer::Peer, s3::{self, S3}};

/// Prem takes at most 25 MB in one request; a file above this goes in chunks.
pub const ONE_REQUEST: u64 = 24 * 1024 * 1024;
/// A chunk's target size.
pub const CHUNK: u64 = 20 * 1024 * 1024;
/// How often a recording is tried before it waits for a person.
pub const TRIES: u64 = 3;
pub const RATE: u32 = 24_000;
pub const BITRATE: &str = "48k";
/// The fps a sound file's BWF time reference is written in (the studio's cuts land on 30 fps frames).
pub const AUDIO_TC_FPS: f64 = 30.0;

/// Why a round stops without blaming the file.
#[derive(Debug)]
pub struct NotReady;
impl std::fmt::Display for NotReady {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("speech to text is not set up on the API (PREMAI_API_KEY)")
    }
}
impl std::error::Error for NotReady {}

pub struct Transcriber {
    pub peer: Arc<Peer>,
    pub s3: S3,
    pub db: Arc<tokio_postgres::Client>,
    /// the API inside the Docker network (http://api:3000)
    pub api: String,
    /// this server's token for the API (its hash is in vault_config `api_token`)
    pub token: String,
    pub dir: PathBuf,
    pub http: reqwest::Client,
}

// ── what is due (pure: tested) ──

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("")
}

/// Does this file get a transcript? A video or a sound that is an original or a working file — never a proxy (the
/// audio proxies themselves included) or a delivery.
pub fn wants(meta: &Value) -> bool {
    matches!(s(meta, "class"), "" | "default" | "original")
        && matches!(s(meta, "kind"), "video" | "audio")
        && meta.pointer("/meta/role").and_then(|r| r.as_str()) != Some("audio")
}

/// Is its transcript due now? None yet, and not "none: …", and failed fewer than TRIES times.
pub fn due(meta: &Value) -> bool {
    let m = &meta["meta"];
    if m.get("transcript").is_some_and(|t| t.is_object()) {
        return false;
    }
    let state = s(m, "transcript_state");
    let tries = m.get("transcript_tries").and_then(|t| t.as_u64()).unwrap_or(0);
    if state.starts_with("none") {
        return false;
    }
    !(state.starts_with("failed") && tries >= TRIES)
}

/// A description with these keys of its `meta` set (Null: taken out) — everything else as it was.
pub fn merge(latest: &Value, patch: &Map<String, Value>) -> Value {
    let mut out = latest.clone();
    if !out["meta"].is_object() {
        out["meta"] = json!({});
    }
    let m = out["meta"].as_object_mut().unwrap();
    for (k, v) in patch {
        if v.is_null() {
            m.remove(k);
        } else {
            m.insert(k.clone(), v.clone());
        }
    }
    out
}

/// The original's probe with its start timecode added (what the Mac's probe read stays).
pub fn with_timecode(probe: &Value, timecode: &str, fps: f64) -> Value {
    let mut p = if probe.is_object() { probe.clone() } else { json!({}) };
    p["timecode"] = json!(timecode);
    p["timecode_fps"] = json!(fps);
    p
}

/// A description whose `probe.timecode` was lost (a Mac probed the file again) gets it back from its transcript.
pub fn heal_timecode(meta: &Value) -> Option<Map<String, Value>> {
    let m = &meta["meta"];
    let tc = m.pointer("/transcript/timecode")?.as_str()?;
    let fps = m.pointer("/transcript/timecode_fps")?.as_f64()?;
    if m.pointer("/probe/timecode").is_some() {
        return None;
    }
    let mut patch = Map::new();
    patch.insert("probe".into(), with_timecode(&m["probe"], tc, fps));
    Some(patch)
}

// ── what ffprobe says (pure: tested) ──

#[derive(Debug, Default, PartialEq)]
pub struct Probed {
    pub audio: bool,
    pub seconds: f64,
    /// the start timecode ("HH:MM:SS:FF", `;` before the frames when drop-frame) and its frame rate
    pub timecode: Option<(String, f64)>,
}

fn rate(r: &str) -> Option<f64> {
    let (n, d) = r.split_once('/').unwrap_or((r, "1"));
    let (n, d): (f64, f64) = (n.trim().parse().ok()?, d.trim().parse().ok()?);
    (n > 0.0 && d > 0.0).then(|| (n / d * 1000.0).round() / 1000.0)
}

/// Seconds since midnight → "HH:MM:SS:FF" at a whole frame rate.
pub fn timecode_of(seconds: f64, fps: f64) -> String {
    let fps_i = fps.round().max(1.0) as u64;
    let frames = (seconds * fps_i as f64).round() as u64;
    let (f, secs) = (frames % fps_i, frames / fps_i);
    format!("{:02}:{:02}:{:02}:{:02}", secs / 3600 % 24, secs / 60 % 60, secs % 60, f)
}

/// ffprobe's `-show_format -show_streams` JSON → what we need: is there sound, how long, the start timecode.
pub fn parse_probe(p: &Value) -> Probed {
    let streams = p["streams"].as_array().cloned().unwrap_or_default();
    let kind = |st: &Value, k: &str| st["codec_type"].as_str() == Some(k);
    let audio = streams.iter().any(|st| kind(st, "audio"));
    let seconds = p["format"]["duration"].as_str().and_then(|d| d.parse().ok()).unwrap_or(0.0);
    let video = streams.iter().find(|st| kind(st, "video") && st["disposition"]["attached_pic"].as_i64() != Some(1));
    let fps = video.and_then(|v| rate(v["avg_frame_rate"].as_str().unwrap_or("")).or_else(|| rate(v["r_frame_rate"].as_str().unwrap_or(""))));
    // a movie's: the format's tag, or the tmcd track's (or the video stream's) — QuickTime and MP4 alike
    let tag = p["format"]["tags"]["timecode"]
        .as_str()
        .or_else(|| streams.iter().find_map(|st| st["tags"]["timecode"].as_str()))
        .filter(|t| t.len() >= 11);
    let timecode = match (tag, fps) {
        (Some(t), Some(f)) => Some((t.to_string(), f)),
        // a sound file's BWF time reference: samples since midnight
        _ => {
            let tr = p["format"]["tags"]["time_reference"].as_str().and_then(|t| t.parse::<u64>().ok());
            let sr = streams.iter().find(|st| kind(st, "audio")).and_then(|a| a["sample_rate"].as_str()?.parse::<u64>().ok());
            match (tr, sr, video) {
                (Some(tr), Some(sr), None) if sr > 0 => Some((timecode_of(tr as f64 / sr as f64, AUDIO_TC_FPS), AUDIO_TC_FPS)),
                _ => None,
            }
        }
    };
    Probed { audio, seconds, timecode }
}

// ── chunks and their words (pure: tested) ──

/// Where each chunk starts and how long it is: the whole file when one request takes it, else equal parts.
pub fn plan(bytes: u64, seconds: f64) -> Vec<(f64, f64)> {
    if bytes <= ONE_REQUEST || seconds <= 0.0 {
        return vec![(0.0, seconds)];
    }
    let n = bytes.div_ceil(CHUNK).max(2);
    let len = seconds / n as f64;
    (0..n).map(|i| (i as f64 * len, if i + 1 == n { seconds - i as f64 * len } else { len })).collect()
}

fn ms(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

/// The chunks' transcripts as one: every time shifted by its chunk's start (seconds of the original).
pub fn join(parts: Vec<(f64, Value)>) -> Value {
    let mut words = Vec::new();
    let mut utterances = Vec::new();
    let mut texts = Vec::new();
    let (mut model, mut language) = (Value::Null, Value::Null);
    for (offset, t) in parts {
        if model.is_null() {
            model = t["model"].clone();
            language = t["language"].clone();
        }
        let shift = |mut v: Value| {
            for k in ["s", "e"] {
                if let Some(x) = v[k].as_f64() {
                    v[k] = json!(ms(x + offset));
                }
            }
            v
        };
        words.extend(t["words"].as_array().cloned().unwrap_or_default().into_iter().map(shift));
        utterances.extend(t["utterances"].as_array().cloned().unwrap_or_default().into_iter().map(shift));
        if let Some(x) = t["text"].as_str().map(str::trim).filter(|x| !x.is_empty()) {
            texts.push(x.to_string());
        }
    }
    json!({ "model": model, "language": language, "text": texts.join(" "), "words": words, "utterances": utterances })
}

// ── the work ──

fn ffmpeg() -> String {
    std::env::var("FFMPEG").unwrap_or_else(|_| "ffmpeg".into())
}
fn ffprobe() -> String {
    std::env::var("FFPROBE").unwrap_or_else(|_| "ffprobe".into())
}

/// ffmpeg's options for reading over HTTP (the bucket): pick up again after a dropped connection.
fn net_input(input: &str) -> Vec<&'static str> {
    if input.starts_with("http") {
        vec!["-reconnect", "1", "-reconnect_on_network_error", "1", "-reconnect_delay_max", "30"]
    } else {
        vec![]
    }
}

pub async fn probe(input: &str) -> Result<Probed> {
    let out = tokio::process::Command::new(ffprobe())
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", input])
        .kill_on_drop(true)
        .output()
        .await
        .context("run ffprobe")?;
    if !out.status.success() {
        bail!("ffprobe: {}", scrub(&String::from_utf8_lossy(&out.stderr)));
    }
    Ok(parse_probe(&serde_json::from_slice(&out.stdout)?))
}

async fn run_ffmpeg(args: Vec<String>) -> Result<()> {
    let out = tokio::process::Command::new(ffmpeg()).args(&args).kill_on_drop(true).output().await.context("run ffmpeg")?;
    if !out.status.success() {
        bail!("ffmpeg: {}", scrub(&String::from_utf8_lossy(&out.stderr)));
    }
    Ok(())
}

/// A tool's complaint, short and without the bucket's signed address (it goes into the catalog and the log).
pub fn scrub(stderr: &str) -> String {
    let words: Vec<String> = stderr
        .split_whitespace()
        .map(|w| if w.contains("://") { format!("<the bucket's copy>{}", if w.ends_with(':') { ":" } else { "" }) } else { w.to_string() })
        .collect();
    words.join(" ").chars().take(400).collect()
}

/// The speech track: the first sound stream, mono, 24 kHz AAC at 48 kbps in an .m4a — starting where the file
/// starts (silence before a late sound), exact to the sample.
pub async fn extract(input: &str, out: &Path) -> Result<()> {
    let mut args: Vec<String> = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y"].map(String::from).to_vec();
    args.extend(net_input(input).into_iter().map(String::from));
    args.extend(["-i", input, "-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "1"].map(String::from));
    args.extend(["-ar".into(), RATE.to_string(), "-af".into(), "aresample=async=1:first_pts=0".into()]);
    args.extend(["-c:a", "aac", "-b:a", BITRATE, "-movflags", "+faststart", "-f", "mp4"].map(String::from));
    args.push(out.display().to_string());
    run_ffmpeg(args).await
}

/// One chunk of the audio proxy, re-encoded (so it starts exactly at `start`).
pub async fn cut(audio: &Path, start: f64, len: f64, out: &Path) -> Result<()> {
    let mut args: Vec<String> = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y"].map(String::from).to_vec();
    args.extend(["-ss".into(), format!("{start:.3}"), "-t".into(), format!("{len:.3}"), "-i".into(), audio.display().to_string()]);
    args.extend(["-ac".into(), "1".into(), "-ar".into(), RATE.to_string(), "-c:a".into(), "aac".into(), "-b:a".into(), BITRATE.into()]);
    args.extend(["-f", "mp4"].map(String::from));
    args.push(out.display().to_string());
    run_ffmpeg(args).await
}

/// A file's BLAKE3 (its name in the vault) and size.
pub async fn hash_file(path: &Path) -> Result<(Hash, u64)> {
    let mut f = tokio::fs::File::open(path).await?;
    let mut hasher = blake3::Hasher::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut size = 0u64;
    loop {
        let n = f.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        size += n as u64;
    }
    Ok((Hash::from(*hasher.finalize().as_bytes()), size))
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// The audio proxy's description: beside its original (the same story), class proxy.
pub fn audio_meta(original: &Value, hash: Hash, size: u64, seconds: f64) -> Value {
    let name = s(original, "original_name");
    let stem = Path::new(name).file_stem().map(|s| s.to_string_lossy().into_owned()).filter(|s| !s.is_empty()).unwrap_or_else(|| s(original, "hash").chars().take(12).collect());
    json!({
        "hash": hash.to_hex().to_string(), "size": size, "mime": "audio/mp4", "kind": "audio",
        "title": format!("{stem} · sound"), "tags": ["proxy", "audio"],
        "meta": { "role": "audio", "audio_of": s(original, "hash"), "seconds": ms(seconds), "channels": 1, "sample_rate": RATE, "codec": "aac" },
        "public": false, "original_name": format!("{stem}.audio.m4a"), "source": "vault-server",
        "ingest": format!("audio of {}", s(original, "hash")), "added": now_iso(),
        "story": s(original, "story"), "class": "proxy",
    })
}

impl Transcriber {
    pub async fn run(self) {
        tokio::time::sleep(Duration::from_secs(30)).await;
        std::fs::create_dir_all(self.dir.join("tmp")).ok();
        std::fs::create_dir_all(self.dir.join("transcripts")).ok();
        loop {
            match self.round().await {
                Ok(()) => {}
                Err(e) if e.is::<NotReady>() => tracing::info!("transcripts wait: {e}"),
                Err(e) => tracing::warn!("transcripts: {e:#}"),
            }
            tokio::select! {
                _ = self.peer.wake_transcribe.notified() => {}
                _ = tokio::time::sleep(Duration::from_secs(600)) => {}
            }
        }
    }

    /// Is speech to text set up on the API?
    async fn ready(&self) -> Result<bool> {
        let res = self.http.get(format!("{}/api/transcripts", self.api)).bearer_auth(&self.token).send().await?;
        if !res.status().is_success() {
            bail!("the API answered {} to the vault server's token", res.status());
        }
        let v: Value = serde_json::from_slice(&res.bytes().await?)?;
        Ok(v["ready"].as_bool().unwrap_or(false))
    }

    async fn round(&self) -> Result<()> {
        let held = self.peer.held().await?;
        let metas = self.peer.metas().await?;
        // descriptions a Mac overwrote: their timecode back
        for (hash, meta) in &metas {
            if let Some(patch) = heal_timecode(meta) {
                self.patch(*hash, patch).await.ok();
            }
        }
        let mut todo: Vec<(Hash, u64)> = metas
            .iter()
            .filter(|(h, m)| wants(m) && due(m) && held.contains(h.to_hex().as_str()))
            .map(|(h, m)| (*h, m["size"].as_u64().unwrap_or(0)))
            .collect();
        if todo.is_empty() {
            return Ok(());
        }
        if !self.ready().await? {
            return Err(NotReady.into());
        }
        // the small ones first: a phone clip's words need not wait for an hour of interview
        todo.sort_by_key(|(_, size)| *size);
        tracing::info!("transcripts: {} recordings to transcribe", todo.len());
        for (hash, _) in todo {
            self.one(hash, &held).await?;
        }
        Ok(())
    }

    /// Set keys of a file's `meta` on its newest description.
    async fn patch(&self, hash: Hash, patch: Map<String, Value>) -> Result<Value> {
        let latest = self.peer.meta_of(hash).await?.context("the description is not here")?;
        let next = merge(&latest, &patch);
        self.peer.write_meta(hash, &next).await?;
        Ok(next)
    }

    /// One recording; its own failure is written into its description (only "not set up" stops the round).
    async fn one(&self, hash: Hash, held: &HashSet<String>) -> Result<()> {
        let hex = hash.to_hex().to_string();
        let tmp = self.dir.join("tmp");
        let result = self.transcribe(hash, held).await;
        for e in std::fs::read_dir(&tmp).into_iter().flatten().flatten() {
            if e.file_name().to_string_lossy().starts_with(&hex) {
                std::fs::remove_file(e.path()).ok();
            }
        }
        match result {
            Ok(()) => Ok(()),
            Err(e) if e.is::<NotReady>() => {
                self.patch(hash, Map::from_iter([("transcript_state".into(), json!("queued"))])).await.ok();
                Err(e)
            }
            Err(e) => {
                tracing::warn!("transcript of {}: {e:#}", hash.fmt_short());
                let latest = self.peer.meta_of(hash).await.ok().flatten().unwrap_or(Value::Null);
                let tries = latest["meta"]["transcript_tries"].as_u64().unwrap_or(0) + 1;
                let why = format!("{e:#}").chars().take(300).collect::<String>();
                let note = if tries < TRIES { format!("failed: {why} — tried {tries} of {TRIES}, again by itself") } else { format!("failed: {why} — tried {TRIES} times, waits for a person") };
                self.patch(hash, Map::from_iter([("transcript_state".into(), json!(note)), ("transcript_tries".into(), json!(tries))])).await.ok();
                Ok(())
            }
        }
    }

    async fn transcribe(&self, hash: Hash, held: &HashSet<String>) -> Result<()> {
        let hex = hash.to_hex().to_string();
        let kept = self.dir.join("transcripts").join(format!("{hex}.json"));
        // finished once already (a Mac's description overwrote it at the same moment): put it back
        if let Ok(bytes) = std::fs::read(&kept) {
            if let Ok(Value::Object(patch)) = serde_json::from_slice::<Value>(&bytes) {
                self.patch(hash, patch).await?;
                tracing::info!("transcript of {} put back from the server's copy", hash.fmt_short());
                return Ok(());
            }
        }
        let original = self.patch(hash, Map::from_iter([("transcript_state".into(), json!("transcribing"))])).await?;
        let started = std::time::Instant::now();
        let url = self.s3.presign_get(&s3::blob_key(&hex), Duration::from_secs(12 * 3600));
        let probed = probe(&url).await?;
        let mut patch = Map::new();
        if let Some((tc, fps)) = &probed.timecode {
            if original["meta"].pointer("/probe/timecode").is_none() {
                patch.insert("probe".into(), with_timecode(&original["meta"]["probe"], tc, *fps));
            }
        }
        if !probed.audio {
            patch.insert("transcript_state".into(), json!("none: no speech track"));
            self.patch(hash, patch).await?;
            return Ok(());
        }

        // the audio proxy: made once (a retry takes it from the bucket), then into the vault beside its original
        let audio = self.dir.join("tmp").join(format!("{hex}.audio.m4a"));
        let known = original["meta"]["audio"].as_str().filter(|a| held.contains(*a)).and_then(|a| a.parse::<Hash>().ok());
        let (audio_hash, audio_size) = match known {
            Some(a) => {
                self.download(a, &audio).await?;
                hash_file(&audio).await?
            }
            None => {
                extract(&url, &audio).await?;
                let (a, size) = hash_file(&audio).await?;
                self.store_audio(&original, a, size, &audio).await?;
                (a, size)
            }
        };
        let seconds = probe(&audio.display().to_string()).await?.seconds;

        // the words: in one request, or chunk by chunk
        let mut parts = Vec::new();
        let chunks = plan(audio_size, seconds);
        for (i, (start, len)) in chunks.iter().enumerate() {
            let body = if chunks.len() == 1 {
                tokio::fs::read(&audio).await?
            } else {
                let piece = self.dir.join("tmp").join(format!("{hex}.chunk{i}.m4a"));
                cut(&audio, *start, *len, &piece).await?;
                let b = tokio::fs::read(&piece).await?;
                tokio::fs::remove_file(&piece).await.ok();
                b
            };
            parts.push((*start, self.ask(body).await?));
        }
        let mut transcript = join(parts);
        transcript["of"] = json!(audio_hash.to_hex().to_string());
        transcript["at"] = json!(now_iso());
        if let Some((tc, fps)) = &probed.timecode {
            // kept with the words too: the probe is the Mac's to rewrite
            transcript["timecode"] = json!(tc);
            transcript["timecode_fps"] = json!(fps);
        }
        let words = transcript["words"].as_array().map(Vec::len).unwrap_or(0);
        patch.insert("audio".into(), json!(audio_hash.to_hex().to_string()));
        patch.insert("transcript".into(), transcript);
        patch.insert("transcript_state".into(), json!("done"));
        patch.insert("transcript_tries".into(), Value::Null);
        std::fs::write(&kept, serde_json::to_vec(&Value::Object(patch.clone()))?).ok();
        self.patch(hash, patch).await?;
        tracing::info!(
            "transcribed {} ({:.0} s of sound, {} chunk(s), {words} words) in {:.0} s",
            hash.fmt_short(),
            seconds,
            chunks.len(),
            started.elapsed().as_secs_f64()
        );
        Ok(())
    }

    /// The audio proxy into the bucket and the catalog (its description first, then the server's holding).
    async fn store_audio(&self, original: &Value, hash: Hash, size: u64, path: &Path) -> Result<()> {
        let key = s3::blob_key(&hash.to_hex());
        if self.s3.head(&key).await? != Some(size) {
            let mut upload = self.s3.upload(&key);
            let mut f = tokio::fs::File::open(path).await?;
            let mut buf = vec![0u8; 1 << 20];
            loop {
                let n = f.read(&mut buf).await?;
                if n == 0 {
                    break;
                }
                if let Err(e) = upload.write(&buf[..n]).await {
                    upload.abort().await;
                    return Err(e);
                }
            }
            upload.finish().await?;
        }
        let meta = audio_meta(original, hash, size, probe(&path.display().to_string()).await?.seconds);
        self.peer.write_meta(hash, &meta).await?;
        db::mirror(&self.db, &meta, true).await?;
        self.peer.hold(hash, size, &self.db).await;
        Ok(())
    }

    async fn download(&self, hash: Hash, to: &Path) -> Result<()> {
        let mut res = self.s3.get(&s3::blob_key(&hash.to_hex()), None).await?;
        if !res.status().is_success() {
            bail!("the bucket answered {} for the audio proxy", res.status());
        }
        let mut out = tokio::fs::File::create(to).await?;
        while let Some(chunk) = res.chunk().await? {
            tokio::io::AsyncWriteExt::write_all(&mut out, &chunk).await?;
        }
        Ok(())
    }

    /// One piece of audio to the API (Prem): its transcript, times in seconds of the piece.
    async fn ask(&self, body: Vec<u8>) -> Result<Value> {
        let res = self
            .http
            .post(format!("{}/api/transcripts", self.api))
            .bearer_auth(&self.token)
            .header("content-type", "audio/mp4")
            .timeout(Duration::from_secs(20 * 60))
            .body(body)
            .send()
            .await?;
        let status = res.status();
        let bytes = res.bytes().await?;
        if status.as_u16() == 503 {
            return Err(NotReady.into());
        }
        if !status.is_success() {
            let why = serde_json::from_slice::<Value>(&bytes).ok().and_then(|v| v["error"].as_str().map(String::from));
            bail!("{}", why.unwrap_or_else(|| format!("the API answered {status}")));
        }
        Ok(serde_json::from_slice(&bytes)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: &str = "0000000000000000000000000000000000000000000000000000000000000001";

    #[test]
    fn which_files_and_when() {
        let orig = json!({ "hash": H, "kind": "video", "class": "original", "meta": {} });
        assert!(wants(&orig) && due(&orig));
        assert!(wants(&json!({ "kind": "audio", "class": "" })));
        assert!(!wants(&json!({ "kind": "video", "class": "proxy" })));
        assert!(!wants(&json!({ "kind": "audio", "class": "default", "meta": { "role": "audio" } })));
        assert!(!wants(&json!({ "kind": "image", "class": "original" })));
        assert!(!due(&json!({ "meta": { "transcript": { "words": [] } } })));
        assert!(!due(&json!({ "meta": { "transcript_state": "none: no speech track" } })));
        assert!(due(&json!({ "meta": { "transcript_state": "failed: x", "transcript_tries": 2 } })));
        assert!(!due(&json!({ "meta": { "transcript_state": "failed: x", "transcript_tries": 3 } })));
        // left midway (the server restarted): again
        assert!(due(&json!({ "meta": { "transcript_state": "transcribing" } })));
    }

    #[test]
    fn merging_keeps_what_a_mac_wrote() {
        let latest = json!({ "hash": H, "title": "Take 3", "meta": { "proxy": "p", "color": { "profile": "slog3" }, "transcript_tries": 1 } });
        let next = merge(&latest, &Map::from_iter([("audio".into(), json!("a")), ("transcript_tries".into(), Value::Null)]));
        assert_eq!(next, json!({ "hash": H, "title": "Take 3", "meta": { "proxy": "p", "color": { "profile": "slog3" }, "audio": "a" } }));
        assert_eq!(merge(&json!({ "hash": H }), &Map::from_iter([("a".into(), json!(1))]))["meta"], json!({ "a": 1 }));
    }

    #[test]
    fn a_camera_timecode_from_ffprobe() {
        // an FX3 / A7 IV MP4: the timecode on the tmcd data stream, 23.976 fps video
        let p = json!({
            "streams": [
                { "codec_type": "video", "avg_frame_rate": "24000/1001", "r_frame_rate": "24000/1001", "disposition": { "attached_pic": 0 } },
                { "codec_type": "audio", "sample_rate": "48000" },
                { "codec_type": "data", "codec_tag_string": "tmcd", "tags": { "timecode": "14:03:22:11" } }
            ],
            "format": { "duration": "12.345000", "tags": {} }
        });
        assert_eq!(parse_probe(&p), Probed { audio: true, seconds: 12.345, timecode: Some(("14:03:22:11".into(), 23.976)) });
        // a movie without sound and without timecode
        let silent = json!({ "streams": [{ "codec_type": "video", "avg_frame_rate": "30/1" }], "format": { "duration": "3.0" } });
        assert_eq!(parse_probe(&silent), Probed { audio: false, seconds: 3.0, timecode: None });
        // a field recorder's WAV: BWF time reference in samples since midnight
        let wav = json!({ "streams": [{ "codec_type": "audio", "sample_rate": "48000" }], "format": { "duration": "60.0", "tags": { "time_reference": "2427840000" } } });
        assert_eq!(parse_probe(&wav).timecode, Some(("14:03:00:00".into(), 30.0)));
    }

    #[test]
    fn no_signed_address_in_a_complaint() {
        let e = "https://maiacity.hel1.your-objectstorage.com/LIBRARY/blobs/ab?X-Amz-Signature=deadbeef: Server returned 403 Forbidden";
        assert_eq!(scrub(e), "<the bucket's copy>: Server returned 403 Forbidden");
    }

    #[test]
    fn timecodes() {
        assert_eq!(timecode_of(50_602.5, 30.0), "14:03:22:15");
        assert_eq!(timecode_of(0.0, 25.0), "00:00:00:00");
    }

    #[test]
    fn chunks_cover_the_whole_sound() {
        assert_eq!(plan(10 * 1024 * 1024, 1800.0), vec![(0.0, 1800.0)]);
        let parts = plan(50 * 1024 * 1024, 9000.0);
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], (0.0, 3000.0));
        let end = parts.last().map(|(s, l)| s + l).unwrap();
        assert!((end - 9000.0).abs() < 1e-9);
    }

    #[test]
    fn joining_shifts_every_time_by_its_chunk() {
        let a = json!({ "model": "deepgram/general-nova-3", "language": "en", "text": "Day twenty.", "words": [{ "w": "Day", "s": 0.48, "e": 0.8, "c": 1.0, "sp": 0 }], "utterances": [{ "s": 0.48, "e": 0.8, "text": "Day twenty.", "sp": 0 }] });
        let b = json!({ "model": "deepgram/general-nova-3", "language": "en", "text": "Does it hold?", "words": [{ "w": "Does", "s": 1.1, "e": 1.3, "c": 0.93, "sp": 0 }], "utterances": [] });
        let t = join(vec![(0.0, a), (3000.0, b)]);
        assert_eq!(t["text"], "Day twenty. Does it hold?");
        assert_eq!(t["words"][1], json!({ "w": "Does", "s": 3001.1, "e": 3001.3, "c": 0.93, "sp": 0 }));
        assert_eq!(t["utterances"].as_array().unwrap().len(), 1);
        assert_eq!(t["model"], "deepgram/general-nova-3");
    }

    #[test]
    fn a_lost_timecode_comes_back_from_the_transcript() {
        let m = json!({ "meta": { "probe": { "codec": "hvc1" }, "transcript": { "timecode": "01:00:00:00", "timecode_fps": 25.0 } } });
        let patch = heal_timecode(&m).unwrap();
        assert_eq!(patch["probe"], json!({ "codec": "hvc1", "timecode": "01:00:00:00", "timecode_fps": 25.0 }));
        assert!(heal_timecode(&merge(&m, &patch)).is_none());
    }

    #[test]
    fn the_audio_proxy_lives_beside_its_original() {
        let orig = json!({ "hash": H, "original_name": "C0042.MP4", "story": "s1", "class": "original" });
        let h: Hash = "00000000000000000000000000000000000000000000000000000000000000ff".parse().unwrap();
        let m = audio_meta(&orig, h, 1234, 61.23456);
        assert_eq!(m["class"], "proxy");
        assert_eq!(m["story"], "s1");
        assert_eq!(m["kind"], "audio");
        assert_eq!(m["original_name"], "C0042.audio.m4a");
        assert_eq!(m["meta"], json!({ "role": "audio", "audio_of": H, "seconds": 61.235, "channels": 1, "sample_rate": 24000, "codec": "aac" }));
    }

    /// The real tools, on synthetic media: a movie with a timecode and a sound that starts late → an audio proxy that
    /// starts where the movie starts, as long as it; and one without sound. Skipped where there is no ffmpeg.
    #[tokio::test]
    async fn extracts_the_speech_track_exactly() {
        if std::process::Command::new(ffmpeg()).arg("-version").output().is_err() {
            eprintln!("no ffmpeg here: skipped");
            return;
        }
        let dir = std::env::temp_dir().join(format!("vault-transcribe-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let movie = dir.join("take.mov");
        // 6 s of video at 25 fps with timecode 10:00:00:00; a 440 Hz tone that starts 0.5 s in
        let st = std::process::Command::new(ffmpeg())
            .args(["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=25:duration=6", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=5.5"])
            .args(["-filter_complex", "[1:a]adelay=500:all=1[a]", "-map", "0:v", "-map", "[a]", "-c:v", "mpeg4", "-c:a", "pcm_s16le", "-timecode", "10:00:00:00"])
            .arg(&movie)
            .status()
            .unwrap();
        assert!(st.success());
        let p = probe(&movie.display().to_string()).await.unwrap();
        assert!(p.audio);
        assert_eq!(p.timecode, Some(("10:00:00:00".into(), 25.0)));

        let audio = dir.join("take.audio.m4a");
        extract(&movie.display().to_string(), &audio).await.unwrap();
        let a = probe(&audio.display().to_string()).await.unwrap();
        assert!(a.audio);
        assert!((a.seconds - 6.0).abs() < 0.1, "the audio proxy is {} s, the movie 6 s", a.seconds);
        // the sound starts where it starts in the movie: 0.5 s of silence first (to a few ms — AAC's priming is in the
        // file's edit list)
        let pcm = std::process::Command::new(ffmpeg()).args(["-nostdin", "-v", "error", "-i"]).arg(&audio).args(["-f", "s16le", "-ac", "1", "-"]).output().unwrap().stdout;
        let samples: Vec<i16> = pcm.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect();
        let onset = samples.iter().position(|s| s.unsigned_abs() > 2000).unwrap() as f64 / RATE as f64;
        assert!((onset - 0.5).abs() < 0.01, "the sound starts at {onset} s, in the movie at 0.5 s");
        let (h1, size) = hash_file(&audio).await.unwrap();
        assert!(size > 1000 && size < 100_000, "{size} bytes for 6 s");
        assert_eq!(hash_file(&audio).await.unwrap().0, h1);

        let piece = dir.join("take.chunk.m4a");
        cut(&audio, 3.0, 3.0, &piece).await.unwrap();
        let c = probe(&piece.display().to_string()).await.unwrap();
        assert!((c.seconds - 3.0).abs() < 0.1, "the chunk is {} s", c.seconds);

        let mute = dir.join("mute.mov");
        std::process::Command::new(ffmpeg()).args(["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=25:duration=1", "-c:v", "mpeg4"]).arg(&mute).status().unwrap();
        assert!(!probe(&mute.display().to_string()).await.unwrap().audio);
        std::fs::remove_dir_all(&dir).ok();
    }
}
