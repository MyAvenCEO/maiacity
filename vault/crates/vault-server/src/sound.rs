//! Every recording's sound, on the server, as part of the ingest: once a video or sound original is in Object Storage,
//! its speech track is extracted here (ffmpeg, reading the bucket's copy) and kept in the vault as the original's
//! **audio proxy** — the studio plays a video's detached sound from it, and a Mac transcribes from it (small, quick to
//! read) — and the camera's start timecode is read (its tmcd track, or a BWF time reference). The words themselves are
//! made on a Mac, on-device (Nemotron, vault/app/src/transcripts.rs): nothing of a recording's speech leaves our
//! devices for it.
//!
//! What the catalog gets (iroh-docs is the truth; Postgres only mirrors it) — written as the server's author:
//!
//!   the audio proxy   `blobs/<hash>` + `meta/<hash>`: class proxy, the original's story, meta `{ role: "audio",
//!                     audio_of: <original> }` — AAC in an .m4a, mono, 24 kHz, 48 kbps; the same start as the original
//!                     (silence where its sound starts late) and its sound's length. Its description is the server's
//!                     own: the server made the file.
//!   the original      `sound/<hash>` — the derived record, its own key, never the original's description:
//!                     `{ state, tries?, audio?, seconds?, timecode?, timecode_fps?, at }` — `state` = making · done ·
//!                     none: no sound track · failed: …; `audio` = the audio proxy's hash; `timecode` + `timecode_fps`
//!                     = the camera's start timecode (a word's timecode is the start timecode + its `s`). The Mac's view
//!                     merges it into `meta.audio` and `meta.probe.timecode` (vault-core `with_derived`).
//!
//! One recording at a time, the smallest first; a round on every new file in the bucket and every ten minutes (the
//! backfill). A failure is tried three times, then it waits for a person.
//!
//! Before the records existed the server merged the transcript and the audio proxy into the original's `meta/`: each
//! round moves what is left of that into `transcript/<hash>` (words already made: kept) and `sound/<hash>`, and takes
//! it out of the description (`migrate`) — the only writes into `meta/` this loop makes, once per file.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use iroh_blobs::Hash;
use serde_json::{Map, Value, json};
use tokio::io::AsyncReadExt;

use crate::{db, peer::Peer, s3::{self, S3}};

/// How often a recording is tried before it waits for a person.
pub const TRIES: u64 = 3;
pub const RATE: u32 = 24_000;
pub const BITRATE: &str = "48k";
/// The fps a sound file's BWF time reference is written in (the studio's cuts land on 30 fps frames).
pub const AUDIO_TC_FPS: f64 = 30.0;
/// The derived records' keys: `sound/<hash>` (this loop's), `transcript/<hash>` (a Mac's; moved here only from old
/// descriptions).
pub const PREFIX: &str = "sound/";
pub const TRANSCRIPT: &str = "transcript/";

pub struct Sounds {
    pub peer: Arc<Peer>,
    pub s3: S3,
    pub db: Arc<tokio_postgres::Client>,
    pub dir: PathBuf,
}

// ── what is due (pure: tested) ──

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("")
}

fn ms(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

/// Does this file get an audio proxy (and words)? A video or a sound that is an original or a working file — never a
/// proxy (the audio proxies themselves included) or a delivery.
pub fn wants(meta: &Value) -> bool {
    matches!(s(meta, "class"), "" | "default" | "original")
        && matches!(s(meta, "kind"), "video" | "audio")
        && !matches!(meta.pointer("/meta/role").and_then(|r| r.as_str()), Some("audio" | "model"))
}

/// Is its sound due now (its `sound/<hash>` record)? None yet, or left midway, or failed fewer than TRIES times.
pub fn due(record: Option<&Value>) -> bool {
    let Some(r) = record else { return true };
    let state = s(r, "state");
    if state == "done" || state.starts_with("none") {
        return false;
    }
    !(state.starts_with("failed") && r["tries"].as_u64().unwrap_or(0) >= TRIES)
}

/// Is a file's transcript settled — done, none, or failed for good? (The analysis of a recording waits for its words.)
pub fn settled(record: Option<&Value>) -> bool {
    let Some(r) = record else { return false };
    let state = s(r, "state");
    state == "done" || r.get("words").is_some_and(|w| w.is_array()) || state.starts_with("none") || (state.starts_with("failed") && r["tries"].as_u64().unwrap_or(0) >= TRIES)
}

/// The keys an original's description carried before the records existed.
pub const LEGACY: [&str; 4] = ["transcript", "transcript_state", "transcript_tries", "audio"];

/// What an old description carries → its records: the words (only when there are words — a transcript that failed
/// or waited is made anew on a Mac) and the sound (the audio proxy, the start timecode).
pub fn legacy_records(meta: &Value) -> Option<(Option<Value>, Option<Value>)> {
    let m = &meta["meta"];
    if !LEGACY.iter().any(|k| m.get(*k).is_some()) {
        return None;
    }
    let words = match m.get("transcript") {
        Some(Value::Object(t)) if t.get("words").is_some_and(|w| w.is_array()) => {
            let mut r = Value::Object(t.clone());
            r["state"] = json!("done");
            r["device"] = json!("server (moved from the description)");
            Some(r)
        }
        _ => None,
    };
    let tc = |k: &str| m.pointer(&format!("/transcript/{k}")).or_else(|| m.pointer(&format!("/probe/{k}"))).cloned();
    let sound = m.get("audio").filter(|a| a.is_string()).map(|a| {
        let mut r = json!({ "state": "done", "audio": a });
        for k in ["timecode", "timecode_fps"] {
            if let Some(v) = tc(k) {
                r[k] = v;
            }
        }
        r
    });
    Some((words, sound))
}

/// A record with these keys set (Null: taken out) — everything else as it was.
pub fn patched(latest: Option<&Value>, patch: &Map<String, Value>) -> Value {
    let mut out = latest.filter(|v| v.is_object()).cloned().unwrap_or_else(|| json!({}));
    let o = out.as_object_mut().unwrap();
    for (k, v) in patch {
        if v.is_null() {
            o.remove(k);
        } else {
            o.insert(k.clone(), v.clone());
        }
    }
    out
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

// ── the work ──

pub(crate) fn ffmpeg() -> String {
    std::env::var("FFMPEG").unwrap_or_else(|_| "ffmpeg".into())
}
pub(crate) fn ffprobe() -> String {
    std::env::var("FFPROBE").unwrap_or_else(|_| "ffprobe".into())
}

/// ffmpeg's options for reading over HTTP (the bucket): pick up again after a dropped connection.
pub(crate) fn net_input(input: &str) -> Vec<&'static str> {
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

pub(crate) async fn run_ffmpeg(args: Vec<String>) -> Result<()> {
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

pub(crate) fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// A file the server made (an audio proxy, a thumbnail) into the vault: its bytes into the bucket, its description
/// (the server's own: it made the file), then the server's holding — the Macs fetch it like any file.
pub(crate) async fn store(peer: &Peer, s3: &S3, db: &tokio_postgres::Client, path: &Path, hash: Hash, size: u64, meta: &Value) -> Result<()> {
    let key = s3::blob_key(&hash.to_hex());
    if s3.head(&key).await? != Some(size) {
        let mut upload = s3.upload(&key);
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
    peer.write_meta(hash, meta).await?;
    db::mirror(db, meta, true).await?;
    peer.hold(hash, size, db).await;
    Ok(())
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

impl Sounds {
    pub async fn run(self) {
        tokio::time::sleep(Duration::from_secs(30)).await;
        std::fs::create_dir_all(self.dir.join("tmp")).ok();
        loop {
            if let Err(e) = self.round().await {
                tracing::warn!("sound: {e:#}");
            }
            tokio::select! {
                _ = self.peer.wake_transcribe.notified() => {}
                _ = tokio::time::sleep(Duration::from_secs(600)) => {}
            }
        }
    }

    async fn round(&self) -> Result<()> {
        let held = self.peer.held().await?;
        let metas = self.peer.metas().await?;
        self.migrate(&metas).await;
        let records: HashMap<Hash, Value> = self.peer.records(PREFIX).await?.into_iter().collect();
        let mut todo: Vec<(Hash, u64)> = metas
            .iter()
            .filter(|(h, m)| wants(m) && due(records.get(h)) && held.contains(h.to_hex().as_str()))
            .map(|(h, m)| (*h, m["size"].as_u64().unwrap_or(0)))
            .collect();
        if todo.is_empty() {
            return Ok(());
        }
        // the small ones first: a phone clip's sound need not wait for an hour of interview
        todo.sort_by_key(|(_, size)| *size);
        tracing::info!("sound: {} recordings to take the sound of", todo.len());
        for (hash, _) in todo {
            self.one(hash, &held).await;
        }
        Ok(())
    }

    /// Set keys of a file's `sound/<hash>` record (only this server writes it: read, set, write).
    async fn patch(&self, hash: Hash, patch: Map<String, Value>) -> Result<Value> {
        let latest = self.peer.record(PREFIX, hash).await.ok().flatten();
        let next = patched(latest.as_ref(), &patch);
        self.peer.write_record(PREFIX, hash, &next).await?;
        Ok(next)
    }

    /// What is left of the time before the records: into `transcript/<hash>` and `sound/<hash>` (where they are not
    /// yet), and out of the description.
    async fn migrate(&self, metas: &[(Hash, Value)]) {
        for (hash, meta) in metas {
            let Some((words, sound)) = legacy_records(meta) else { continue };
            if let Some(w) = words {
                if self.peer.record(TRANSCRIPT, *hash).await.ok().flatten().is_none() {
                    if let Err(e) = self.peer.write_record(TRANSCRIPT, *hash, &w).await {
                        tracing::warn!("transcript of {} not moved: {e:#}", hash.fmt_short());
                        continue;
                    }
                }
            }
            if let Some(snd) = sound {
                if self.peer.record(PREFIX, *hash).await.ok().flatten().is_none() {
                    if let Err(e) = self.peer.write_record(PREFIX, *hash, &snd).await {
                        tracing::warn!("sound of {} not moved: {e:#}", hash.fmt_short());
                        continue;
                    }
                }
            }
            let strip: Map<String, Value> = LEGACY.iter().map(|k| (k.to_string(), Value::Null)).collect();
            match self.peer.write_meta(*hash, &merge(meta, &strip)).await {
                Ok(()) => tracing::info!("{}: its transcript and sound moved into their own records", hash.fmt_short()),
                Err(e) => tracing::warn!("the description of {} keeps its old transcript: {e:#}", hash.fmt_short()),
            }
        }
        // the old safety copies of the words (VAULT_DATA/transcripts): every one is in a record by now
        let old = self.dir.join("transcripts");
        if old.exists() && metas.iter().all(|(_, m)| legacy_records(m).is_none()) {
            std::fs::remove_dir_all(&old).ok();
        }
    }

    /// One recording; its own failure is written into its record.
    async fn one(&self, hash: Hash, held: &HashSet<String>) {
        let hex = hash.to_hex().to_string();
        let result = self.take(hash, held).await;
        for e in std::fs::read_dir(self.dir.join("tmp")).into_iter().flatten().flatten() {
            if e.file_name().to_string_lossy().starts_with(&hex) {
                std::fs::remove_file(e.path()).ok();
            }
        }
        if let Err(e) = result {
            tracing::warn!("sound of {}: {e:#}", hash.fmt_short());
            let latest = self.peer.record(PREFIX, hash).await.ok().flatten().unwrap_or(Value::Null);
            let tries = latest["tries"].as_u64().unwrap_or(0) + 1;
            let why = format!("{e:#}").chars().take(300).collect::<String>();
            let note = if tries < TRIES { format!("failed: {why} — tried {tries} of {TRIES}, again by itself") } else { format!("failed: {why} — tried {TRIES} times, waits for a person") };
            self.patch(hash, Map::from_iter([("state".into(), json!(note)), ("tries".into(), json!(tries))])).await.ok();
        }
    }

    async fn take(&self, hash: Hash, held: &HashSet<String>) -> Result<()> {
        let hex = hash.to_hex().to_string();
        let original = self.peer.meta_of(hash).await?.context("the description is not here")?;
        let record = self.patch(hash, Map::from_iter([("state".into(), json!("making"))])).await?;
        let started = std::time::Instant::now();
        let url = self.s3.presign_get(&s3::blob_key(&hex), Duration::from_secs(12 * 3600));
        let probed = probe(&url).await?;
        let mut patch = Map::from_iter([("at".into(), json!(now_iso())), ("tries".into(), Value::Null), ("seconds".into(), json!(ms(probed.seconds)))]);
        if let Some((tc, fps)) = &probed.timecode {
            // the camera's start timecode: the server's to read (the probe in the description is the Mac's)
            patch.insert("timecode".into(), json!(tc));
            patch.insert("timecode_fps".into(), json!(fps));
        }
        if !probed.audio {
            patch.insert("state".into(), json!("none: no sound track"));
            self.patch(hash, patch).await?;
            self.peer.wake_analyse.notify_one();
            return Ok(());
        }
        // the audio proxy: made once (a retry keeps the one in the bucket), then into the vault beside its original
        let audio_hash = match record["audio"].as_str().filter(|a| held.contains(*a)).and_then(|a| a.parse::<Hash>().ok()) {
            Some(a) => a,
            None => {
                let audio = self.dir.join("tmp").join(format!("{hex}.audio.m4a"));
                extract(&url, &audio).await?;
                let (a, size) = hash_file(&audio).await?;
                let meta = audio_meta(&original, a, size, probe(&audio.display().to_string()).await?.seconds);
                store(&self.peer, &self.s3, &self.db, &audio, a, size, &meta).await?;
                a
            }
        };
        patch.insert("audio".into(), json!(audio_hash.to_hex().to_string()));
        patch.insert("state".into(), json!("done"));
        self.patch(hash, patch).await?;
        tracing::info!("the sound of {} ({:.0} s) in {:.0} s", hash.fmt_short(), probed.seconds, started.elapsed().as_secs_f64());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: &str = "0000000000000000000000000000000000000000000000000000000000000001";

    #[test]
    fn which_files_and_when() {
        let orig = json!({ "hash": H, "kind": "video", "class": "original", "meta": {} });
        assert!(wants(&orig) && due(None));
        assert!(wants(&json!({ "kind": "audio", "class": "" })));
        assert!(!wants(&json!({ "kind": "video", "class": "proxy" })));
        assert!(!wants(&json!({ "kind": "audio", "class": "default", "meta": { "role": "audio" } })));
        assert!(!wants(&json!({ "kind": "image", "class": "original" })));
        assert!(!due(Some(&json!({ "state": "done", "audio": "a" }))));
        assert!(!due(Some(&json!({ "state": "none: no sound track" }))));
        assert!(due(Some(&json!({ "state": "failed: x", "tries": 2 }))));
        assert!(!due(Some(&json!({ "state": "failed: x", "tries": 3 }))));
        // left midway (the server restarted): again
        assert!(due(Some(&json!({ "state": "making" }))));
        // a transcript settled: the analysis may go on
        assert!(settled(Some(&json!({ "state": "done", "words": [] }))) && settled(Some(&json!({ "state": "failed: x", "tries": 3 }))));
        assert!(settled(Some(&json!({ "state": "none: no speech" }))));
        assert!(!settled(None) && !settled(Some(&json!({ "state": "transcribing", "progress": 0.4 }))));
    }

    #[test]
    fn an_old_description_s_words_and_sound_become_their_records() {
        let old = json!({ "hash": H, "meta": { "proxy": "p", "audio": "a1", "probe": { "timecode": "10:00:00:00", "timecode_fps": 25.0 },
            "transcript": { "model": "deepgram/general-nova-3", "text": "Day twenty.", "words": [{ "w": "Day", "s": 0.4, "e": 0.8, "c": 1.0 }] }, "transcript_state": "done" } });
        let (words, sound) = legacy_records(&old).unwrap();
        let words = words.unwrap();
        assert_eq!(words["state"], "done");
        assert_eq!(words["text"], "Day twenty.");
        assert_eq!(sound.unwrap(), json!({ "state": "done", "audio": "a1", "timecode": "10:00:00:00", "timecode_fps": 25.0 }));
        // what is taken out of the description: only those keys
        let strip: Map<String, Value> = LEGACY.iter().map(|k| (k.to_string(), Value::Null)).collect();
        assert_eq!(merge(&old, &strip)["meta"], json!({ "proxy": "p", "probe": { "timecode": "10:00:00:00", "timecode_fps": 25.0 } }));
        // a transcript that failed (Prem): no words to keep — a Mac makes them anew
        let (w, s) = legacy_records(&json!({ "meta": { "transcript_state": "failed: Prem could not transcribe this", "transcript_tries": 3 } })).unwrap();
        assert!(w.is_none() && s.is_none());
        assert!(legacy_records(&json!({ "meta": { "proxy": "p" } })).is_none());
    }

    #[test]
    fn a_record_is_patched_key_by_key() {
        let r = json!({ "state": "failed: x", "tries": 1, "audio": "a" });
        let next = patched(Some(&r), &Map::from_iter([("state".into(), json!("making")), ("tries".into(), Value::Null)]));
        assert_eq!(next, json!({ "state": "making", "audio": "a" }));
        assert_eq!(patched(None, &Map::from_iter([("state".into(), json!("making"))])), json!({ "state": "making" }));
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


        let mute = dir.join("mute.mov");
        std::process::Command::new(ffmpeg()).args(["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=25:duration=1", "-c:v", "mpeg4"]).arg(&mute).status().unwrap();
        assert!(!probe(&mute.display().to_string()).await.unwrap().audio);
        std::fs::remove_dir_all(&dir).ok();
    }
}
