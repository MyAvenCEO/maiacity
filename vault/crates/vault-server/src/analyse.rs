//! Every picture tagged for the edit — on the server, the step after the proxy: once a video original's ACEScct proxy
//! (or a still) is in Object Storage, frames are sampled from it here (ffmpeg, reading the bucket's copy), taken to
//! what a Rec.709 screen shows (the ACES 2.0 output transform, baked from vault-color's maths into a 65³ cube for
//! ffmpeg's `lut3d` — the model must see the picture, not log code values), and sent in batches, with the words said
//! in that stretch, to Prem's confidential Qwen through the API (`POST /api/analysis`, api/src/analysis.ts — the key
//! and the SDK are the API's). The vocabulary is game/film/vocabulary.json: base tags with fixed values (shot size,
//! angle, movement, lens, light, location, people, scene kind, quality flags), free tags, and time-ranged cues (takes,
//! actions, emotions, cut points, transitions, highlights, problems).
//!
//! Map, then reduce: each batch of frames (a stretch of the file) is described on its own — its tags, its cues, a
//! line of what it shows, its best frame for a thumbnail; then one text-only request over every stretch's answer (and
//! the words) groups the repeated attempts of an action into takes and ranks them, and writes the file's tags, its
//! summary and where it serves an edit best, and picks the thumbnail.
//!
//! What the catalog gets — `analysis/<hash>` (the original's hash; written only by this server's author, never its
//! description): `{ state, progress, tries?, thumbnail?, of, model, vocabulary, at, seconds, frames, summary: { line,
//! best_use }, tags: { <base tag>: value… }, free: [..], labels: ["shot_size:MS", …], segments: [{ s, e, tags, line }],
//! cues: [{ s, e, kind, label, confidence, note?, why?, take_of?, take?, rank?, best? }] }` — times in seconds of the
//! file; `state` = queued (Prem not set up yet) · analysing (with `progress` 0…1, per batch) · done · failed: …;
//! `of` = the hash of what was looked at (the proxy, or the still itself: a new proxy is analysed again).
//!
//! The thumbnail: a small display-referred JPEG (640 px long edge) of the file's best frame, kept in the vault like the
//! audio proxy — its own `blobs/<hash>` + `meta/<hash>` (class proxy, `role: "thumbnail"`, `thumbnail_of`), named
//! in the record's `thumbnail`. A first one (the middle frame) is made as soon as the proxy is in the bucket, before
//! any model answers; the analysis replaces it with the frame it picks.
//!
//! One file at a time, after its transcript has settled (a recording's words go with its frames), the smallest first; a
//! round on every new file in the bucket, every settled transcript and every ten minutes (the backfill). A failure is
//! tried three times, then it waits for a person.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use iroh_blobs::Hash;
use serde_json::{Map, Value, json};

use crate::{
    peer::Peer,
    s3::{self, S3},
    api::{NotReady, Paused, api_error, queued, status_paused},
    sound::{self, hash_file, net_input, now_iso, probe, run_ffmpeg},
};

/// The derived record's key: `analysis/<hash>`.
pub const PREFIX: &str = "analysis/";
/// How often a file is tried before it waits for a person.
pub const TRIES: u64 = 3;
/// Frames per request (a stretch of the file).
pub const BATCH: usize = 12;
/// Frames of one file at most (an hour: one every five seconds); scene changes come on top, then all are thinned.
pub const MAX_FRAMES: f64 = 600.0;
/// The long edge of a frame the model sees, and of a thumbnail.
pub const EDGE: u32 = 768;
pub const THUMB_EDGE: u32 = 640;
/// A frame where the picture changes this much (ffmpeg's scene score) is sampled too.
pub const SCENE: f64 = 0.35;
/// The proxies' working space (vault-media `proxy::WORKING`).
pub const WORKING: &str = "acescct";
/// The cube's size (the studio's viewer LUTs bake at 65 too).
pub const CUBE: usize = 65;

pub struct Analyser {
    pub peer: Arc<Peer>,
    pub s3: S3,
    pub db: Arc<tokio_postgres::Client>,
    /// the API inside the Docker network (http://api:3000)
    pub api: String,
    pub token: String,
    pub dir: PathBuf,
    pub http: reqwest::Client,
}

// ── what is looked at, and when (pure: tested) ──

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("")
}

fn is_hash(x: &str) -> bool {
    x.len() == 64 && x.bytes().all(|b| b.is_ascii_hexdigit())
}

/// What the model looks at for a file.
#[derive(Debug, Clone, PartialEq)]
pub enum Source {
    /// a movie's ACEScct proxy (HEVC Main10, BT.709 matrix, TV range)
    Movie { hash: Hash, size: u64 },
    /// a still: its ACEScct proxy (a 16-bit PNG), or the still itself when it is a display picture that needed none
    Still { hash: Hash, size: u64, acescct: bool },
}

impl Source {
    pub fn hash(&self) -> Hash {
        match self {
            Source::Movie { hash, .. } | Source::Still { hash, .. } => *hash,
        }
    }
    pub fn size(&self) -> u64 {
        match self {
            Source::Movie { size, .. } | Source::Still { size, .. } => *size,
        }
    }
    fn acescct(&self) -> bool {
        matches!(self, Source::Movie { .. } | Source::Still { acescct: true, .. })
    }
}

/// Does this file get analysed? Footage to cut with: a video original, an EXR sequence, a still — never a proxy, a
/// delivery, or the pipeline's own working files (hero frames, LUTs, thumbnails, audio proxies).
pub fn wants(meta: &Value) -> bool {
    let role = meta.pointer("/meta/role").and_then(|r| r.as_str()).unwrap_or("");
    let working = matches!(role, "frame" | "lut" | "proxy" | "proxy-cache" | "audio" | "thumbnail" | "plate");
    let superseded = meta["tags"].as_array().is_some_and(|t| t.iter().any(|t| t.as_str() == Some("superseded")));
    let sequence = meta.pointer("/meta/sequence").and_then(|x| x.as_str()) == Some("exr");
    matches!(s(meta, "class"), "" | "default" | "original") && !working && !superseded && (matches!(s(meta, "kind"), "video" | "image") || sequence)
}

/// Which file shows it: its ACEScct proxy once the bucket holds it (the original's `meta.proxy`, or a proxy naming it
/// in `proxy_of`), or — a small display still that needed no proxy — the still itself.
pub fn source(hex: &str, meta: &Value, metas: &HashMap<String, Value>, proxy_of: &HashMap<String, String>, held: &HashSet<String>) -> Option<Source> {
    let named = meta.pointer("/meta/proxy").and_then(|p| p.as_str()).unwrap_or("");
    let proxy = if is_hash(named) { Some(named.to_string()) } else { proxy_of.get(hex).cloned() };
    if let Some(p) = proxy {
        let pm = metas.get(&p)?;
        if !held.contains(&p) || pm.pointer("/meta/color/profile").and_then(|x| x.as_str()) != Some(WORKING) {
            return None;
        }
        let (hash, size) = (p.parse().ok()?, pm["size"].as_u64().unwrap_or(0));
        return Some(if s(pm, "kind") == "image" { Source::Still { hash, size, acescct: true } } else { Source::Movie { hash, size } });
    }
    if s(meta, "kind") == "image" && named.starts_with("none") && held.contains(hex) {
        return Some(Source::Still { hash: hex.parse().ok()?, size: meta["size"].as_u64().unwrap_or(0), acescct: false });
    }
    None
}

/// Is its analysis due now (its `analysis/<hash>` record)? None yet, or of another source (the proxy was made again),
/// or not finished and failed fewer than TRIES times.
pub fn due(record: Option<&Value>, source: &Source) -> bool {
    let Some(r) = record.filter(|r| r.get("state").is_some()) else { return true };
    let state = s(r, "state");
    if s(r, "of") != source.hash().to_hex().as_str() && !s(r, "of").is_empty() {
        return true;
    }
    if state == "done" || state.starts_with("none") {
        return false;
    }
    !(state.starts_with("failed") && r["tries"].as_u64().unwrap_or(0) >= TRIES)
}

/// How long a recording's analysis waits for its words (a Mac makes them) before it goes on without them.
pub const WORDS_WAIT_HOURS: i64 = 6;

/// Does a recording's analysis still wait for its words? Until its transcript has settled — or, when no Mac has made
/// it within WORDS_WAIT_HOURS of its sound being taken (`sound/<hash>`'s `at`), not any longer; a file without sound
/// never waits.
pub fn waits_for_words(meta: &Value, transcript: Option<&Value>, sound: Option<&Value>, now: chrono::DateTime<chrono::Utc>) -> bool {
    if !sound::wants(meta) || sound::settled(transcript) {
        return false;
    }
    let state = sound.and_then(|x| x["state"].as_str()).unwrap_or("");
    if state.starts_with("none") {
        return false;
    }
    let since = sound.and_then(|x| x["at"].as_str()).and_then(|a| chrono::DateTime::parse_from_rfc3339(a).ok());
    !since.is_some_and(|t| (now - t.with_timezone(&chrono::Utc)).num_hours() >= WORDS_WAIT_HOURS)
}

/// Does it still need its first thumbnail?
pub fn needs_thumbnail(record: Option<&Value>, held: &HashSet<String>) -> bool {
    !record.and_then(|r| r["thumbnail"].as_str()).is_some_and(|t| held.contains(t))
}

/// Seconds between the regular frames: one a second, fewer for a long file.
pub fn interval(seconds: f64) -> f64 {
    (seconds / MAX_FRAMES).max(1.0)
}

/// The filter that takes a proxy's frames to the model's picture: sample (a frame every `every` seconds, and a scene
/// change at least half a second after the last one), log their times (showinfo), scale the long edge to `edge`
/// (a movie's YCbCr undone with its own matrix and range), and the output transform (the cube) when it is ACEScct.
pub fn filter(every: Option<f64>, edge: u32, cube: Option<&Path>, movie: bool) -> String {
    let mut f = Vec::new();
    if let Some(i) = every {
        f.push(format!("select='isnan(prev_selected_t)+gte(t-prev_selected_t,{i:.3})+gt(scene,{SCENE})*gte(t-prev_selected_t,0.5)'"));
        f.push("showinfo".to_string());
    }
    let range = if movie { ":in_color_matrix=bt709:in_range=tv" } else { "" };
    f.push(format!("scale=w={edge}:h={edge}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=bicubic{range}"));
    if let Some(c) = cube {
        f.push("format=rgb48le".to_string());
        f.push(format!("lut3d=file='{}':interp=tetrahedral", c.display()));
    }
    f.join(",")
}

/// The times of the frames ffmpeg wrote, from showinfo's log (one line per frame, in order).
pub fn frame_times(stderr: &str) -> Vec<f64> {
    stderr
        .lines()
        .filter(|l| l.contains("showinfo") && l.contains("pts_time:"))
        .filter_map(|l| l.split("pts_time:").nth(1)?.split_whitespace().next()?.parse::<f64>().ok())
        .collect()
}

/// At most `max` of `n` frames, evenly — the indices kept.
pub fn thin(n: usize, max: usize) -> Vec<usize> {
    if n <= max || max == 0 {
        return (0..n).collect();
    }
    let mut out: Vec<usize> = (0..max).map(|i| i * n / max).collect();
    out.dedup();
    out
}

/// The stretches: BATCH frames each; a stretch runs from its first frame (the file's start for the first) to the next
/// stretch's first frame (the file's end for the last). (first frame index, one past the last, start, end)
pub fn stretches(times: &[f64], seconds: f64) -> Vec<(usize, usize, f64, f64)> {
    let n = times.len();
    let mut out = Vec::new();
    let mut i = 0;
    while i < n {
        let j = (i + BATCH).min(n);
        let start = if i == 0 { 0.0 } else { times[i] };
        let end = if j < n { times[j] } else { seconds.max(times[n - 1]) };
        out.push((i, j, start, end));
        i = j;
    }
    out
}

/// What was said in a stretch: the transcript's sentences that overlap it (or its words, a dozen to a line).
pub fn words_in(transcript: Option<&Value>, from: f64, to: f64) -> Vec<Value> {
    let Some(t) = transcript else { return vec![] };
    let inside = |v: &Value| v["e"].as_f64().unwrap_or(0.0) > from && v["s"].as_f64().unwrap_or(f64::MAX) < to;
    let utterances: Vec<Value> = t["utterances"].as_array().into_iter().flatten().filter(|u| inside(u)).cloned().collect();
    if !utterances.is_empty() {
        return utterances;
    }
    let words: Vec<&Value> = t["words"].as_array().into_iter().flatten().filter(|w| inside(w)).collect();
    words
        .chunks(12)
        .map(|c| {
            let text = c.iter().filter_map(|w| w["w"].as_str()).collect::<Vec<_>>().join(" ");
            json!({ "s": c[0]["s"], "e": c[c.len() - 1]["e"], "text": text })
        })
        .collect()
}

/// The stretches' answers as one file: each base tag as most of the file has it (one value: the most frequent, the
/// longer stretch winning a tie; many: every value seen in at least a fifth of the file; a number: the median;
/// text: the most frequent), free tags by how often they came, every cue in order, and a segment per stretch.
pub fn merge(parts: &[(f64, f64, Value)]) -> Value {
    let total: f64 = parts.iter().map(|(a, b, _)| (b - a).max(0.0)).sum::<f64>().max(1e-9);
    let mut weights: HashMap<String, Vec<(Value, f64)>> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for (a, b, p) in parts {
        let w = (b - a).max(1e-6);
        for (k, v) in p["tags"].as_object().into_iter().flatten() {
            if !order.contains(k) {
                order.push(k.clone());
            }
            let e = weights.entry(k.clone()).or_default();
            match v {
                Value::Array(xs) => xs.iter().for_each(|x| e.push((x.clone(), w))),
                Value::Null => {}
                x => e.push((x.clone(), w)),
            }
        }
    }
    let mut tags = Map::new();
    for k in order {
        let vals = &weights[&k];
        if vals.is_empty() {
            continue;
        }
        let many = parts.iter().any(|(_, _, p)| p["tags"][&k].is_array());
        let numeric = vals.iter().all(|(v, _)| v.is_number());
        let mut by: Vec<(Value, f64)> = Vec::new();
        for (v, w) in vals {
            match by.iter_mut().find(|(x, _)| x == v) {
                Some(e) => e.1 += w,
                None => by.push((v.clone(), *w)),
            }
        }
        by.sort_by(|a, b| b.1.total_cmp(&a.1));
        let v = if many {
            Value::Array(by.iter().filter(|(_, w)| *w / total >= 0.2).map(|(v, _)| v.clone()).collect())
        } else if numeric {
            // the value itself (a count stays a whole number)
            let mut xs: Vec<&Value> = vals.iter().map(|(v, _)| v).collect();
            xs.sort_by(|a, b| a.as_f64().unwrap_or(0.0).total_cmp(&b.as_f64().unwrap_or(0.0)));
            xs[xs.len() / 2].clone()
        } else {
            by[0].0.clone()
        };
        tags.insert(k, v);
    }
    let mut free: Vec<(String, usize)> = Vec::new();
    for (_, _, p) in parts {
        for f in p["free"].as_array().into_iter().flatten().filter_map(|f| f.as_str()) {
            match free.iter_mut().find(|(x, _)| x == f) {
                Some(e) => e.1 += 1,
                None => free.push((f.to_string(), 1)),
            }
        }
    }
    free.sort_by(|a, b| b.1.cmp(&a.1));
    let mut cues: Vec<Value> = parts.iter().flat_map(|(_, _, p)| p["cues"].as_array().cloned().unwrap_or_default()).collect();
    cues.sort_by(|a, b| a["s"].as_f64().unwrap_or(0.0).total_cmp(&b["s"].as_f64().unwrap_or(0.0)));
    let segments: Vec<Value> = parts.iter().map(|(a, b, p)| json!({ "s": a, "e": b, "tags": p["tags"], "line": p["summary"] })).collect();
    json!({ "tags": tags, "free": free.into_iter().take(12).map(|(f, _)| f).collect::<Vec<_>>(), "cues": cues, "segments": segments })
}

/// The reduce's answer on top of the merge: its file-level tags and free tags (where it gave them), the summary, and
/// the takes — each attempt a `take` cue (take_of, take, rank, best, why), replacing the stretches' own take cues
/// (a stretch cannot see the attempts in the others). Without a reduce: the stretches' lines as the summary.
pub fn finish(mut merged: Value, reduce: Option<&Value>) -> Value {
    let lines: Vec<String> = merged["segments"].as_array().into_iter().flatten().filter_map(|x| x["line"].as_str().map(String::from)).filter(|l| !l.is_empty()).collect();
    merged["summary"] = json!({ "line": lines.first().cloned().unwrap_or_default(), "best_use": "" });
    if let Some(r) = reduce {
        if let Some(t) = r["tags"].as_object().filter(|t| !t.is_empty()) {
            let mut tags = merged["tags"].as_object().cloned().unwrap_or_default();
            for (k, v) in t {
                if !v.is_null() {
                    tags.insert(k.clone(), v.clone());
                }
            }
            merged["tags"] = Value::Object(tags);
        }
        if r["free"].as_array().is_some_and(|f| !f.is_empty()) {
            merged["free"] = r["free"].clone();
        }
        if r["summary"].is_object() {
            merged["summary"] = json!({ "line": r["summary"]["line"].as_str().unwrap_or(""), "best_use": r["summary"]["best_use"].as_str().unwrap_or("") });
        }
        if let Some(groups) = r["takes"].as_array().filter(|g| !g.is_empty()) {
            let mut cues: Vec<Value> = merged["cues"].as_array().cloned().unwrap_or_default().into_iter().filter(|c| c["kind"] != "take").collect();
            for g in groups {
                let of = g["take_of"].as_str().unwrap_or("take");
                let best = g["best"].as_u64();
                for (i, t) in g["takes"].as_array().into_iter().flatten().enumerate() {
                    let n = t["take"].as_u64().unwrap_or(i as u64 + 1);
                    let mut c = json!({ "s": t["s"], "e": t["e"], "kind": "take", "label": format!("{of} · take {n}"), "take_of": of, "take": n,
                        "confidence": t["confidence"].as_f64().unwrap_or(0.7) });
                    if let Some(r) = t["rank"].as_u64() {
                        c["rank"] = json!(r);
                    }
                    if best == Some(n) {
                        c["best"] = json!(true);
                        if let Some(w) = g["why"].as_str() {
                            c["why"] = json!(w);
                        }
                    }
                    if let Some(note) = t["note"].as_str() {
                        c["note"] = json!(note);
                    }
                    cues.push(c);
                }
            }
            cues.sort_by(|a, b| a["s"].as_f64().unwrap_or(0.0).total_cmp(&b["s"].as_f64().unwrap_or(0.0)));
            merged["cues"] = Value::Array(cues);
        }
    }
    merged["labels"] = json!(labels(&merged));
    merged
}

/// The tags as flat strings to search by: "shot_size:MS", "movement:handheld", "people:1", and the free tags.
pub fn labels(analysis: &Value) -> Vec<String> {
    let mut out = Vec::new();
    for (k, v) in analysis["tags"].as_object().into_iter().flatten() {
        let one = |x: &Value| match x {
            Value::String(s) if !s.is_empty() => Some(format!("{k}:{s}")),
            Value::Number(n) => Some(format!("{k}:{n}")),
            _ => None,
        };
        match v {
            Value::Array(xs) => out.extend(xs.iter().filter_map(one)),
            x => out.extend(one(x)),
        }
    }
    out.extend(analysis["free"].as_array().into_iter().flatten().filter_map(|f| f.as_str().map(String::from)));
    out
}

/// Where the thumbnail is: the frame the reduce picked (snapped to a sampled frame), else a stretch's pick of the
/// first highlight's stretch, else the middle of the first highlight, else the middle of the file.
pub fn thumbnail_time(reduce: Option<&Value>, picks: &[(f64, String)], cues: &[Value], times: &[f64], seconds: f64) -> f64 {
    let snap = |t: f64| times.iter().copied().min_by(|a, b| (a - t).abs().total_cmp(&(b - t).abs())).unwrap_or(t);
    if let Some(t) = reduce.and_then(|r| r["thumbnail"]["t"].as_f64()).filter(|t| t.is_finite() && *t >= 0.0 && *t <= seconds + 0.5) {
        return snap(t);
    }
    let highlight = cues.iter().find(|c| c["kind"] == "highlight");
    if let Some(h) = highlight {
        let (a, b) = (h["s"].as_f64().unwrap_or(0.0), h["e"].as_f64().unwrap_or(0.0));
        if let Some((t, _)) = picks.iter().find(|(t, _)| *t >= a - 1.0 && *t <= b + 1.0) {
            return *t;
        }
        return snap((a + b) / 2.0);
    }
    if let Some((t, _)) = picks.first() {
        return *t;
    }
    snap(seconds / 2.0)
}

/// A thumbnail's description: beside its original (the same story), class proxy, role thumbnail.
pub fn thumbnail_meta(original: &Value, hash: Hash, size: u64, t: f64, why: &str) -> Value {
    let name = s(original, "original_name");
    let stem = Path::new(name).file_stem().map(|x| x.to_string_lossy().into_owned()).filter(|x| !x.is_empty()).unwrap_or_else(|| s(original, "hash").chars().take(12).collect());
    let mut m = json!({ "role": "thumbnail", "thumbnail_of": s(original, "hash"), "t": (t * 1000.0).round() / 1000.0, "edge": THUMB_EDGE });
    if !why.is_empty() {
        m["why"] = json!(why);
    }
    json!({
        "hash": hash.to_hex().to_string(), "size": size, "mime": "image/jpeg", "kind": "image",
        "title": format!("{stem} · thumbnail"), "tags": ["proxy", "thumbnail"], "meta": m,
        "public": false, "original_name": format!("{stem}.thumb.jpg"), "source": "vault-server",
        "ingest": format!("thumbnail of {}", s(original, "hash")), "added": now_iso(),
        "story": s(original, "story"), "class": "proxy",
    })
}

/// A JPEG as base64 (what the API's JSON carries).
pub fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

// ── the tools ──

/// The ACES 2.0 output transform as a .cube for ffmpeg (made once per start, in the server's tmp).
pub fn write_cube(dir: &Path) -> Result<PathBuf> {
    let path = dir.join(format!("odt-rec709-{CUBE}.cube"));
    if !path.exists() {
        let cube = vault_color::aces2::bake_cube(CUBE);
        std::fs::write(&path, vault_color::cube_file("ACES 2.0 SDR 100 nits Rec.709 (from ACEScct)", CUBE, &cube))?;
    }
    Ok(path)
}

/// Sample a movie's frames into `out` (00001.jpg …): their times, in order.
pub async fn sample(input: &str, every: f64, cube: Option<&Path>, out: &Path) -> Result<Vec<f64>> {
    std::fs::create_dir_all(out)?;
    let mut args: Vec<String> = ["-nostdin", "-hide_banner", "-loglevel", "info", "-y"].map(String::from).to_vec();
    args.extend(net_input(input).into_iter().map(String::from));
    args.extend(["-i", input, "-map", "0:v:0", "-an", "-sn", "-dn", "-vf"].map(String::from));
    args.push(filter(Some(every), EDGE, cube, true));
    args.extend(["-fps_mode", "vfr", "-q:v", "4", "-f", "image2"].map(String::from));
    args.push(out.join("%05d.jpg").display().to_string());
    let res = tokio::process::Command::new(sound::ffmpeg()).args(&args).kill_on_drop(true).output().await.context("run ffmpeg")?;
    let log = String::from_utf8_lossy(&res.stderr);
    if !res.status.success() {
        let tail: String = log.lines().rev().take(3).collect::<Vec<_>>().join(" ");
        bail!("ffmpeg: {}", sound::scrub(&tail));
    }
    let times = frame_times(&log);
    let files = std::fs::read_dir(out)?.flatten().filter(|e| e.file_name().to_string_lossy().ends_with(".jpg")).count();
    if files == 0 {
        bail!("ffmpeg sampled no frames");
    }
    // one time per frame written (a frame dropped at the very end leaves a time over)
    Ok(times.into_iter().take(files).collect())
}

/// One frame (a still, or a movie at `t`) as a JPEG, its long edge `edge`.
pub async fn frame(input: &str, t: Option<f64>, movie: bool, edge: u32, cube: Option<&Path>, out: &Path) -> Result<()> {
    let mut args: Vec<String> = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y"].map(String::from).to_vec();
    args.extend(net_input(input).into_iter().map(String::from));
    if let Some(t) = t {
        args.extend(["-ss".into(), format!("{t:.3}")]);
    }
    args.extend(["-i".into(), input.into(), "-frames:v".into(), "1".into(), "-vf".into(), filter(None, edge, cube, movie)]);
    args.extend(["-q:v", "3", "-f", "image2"].map(String::from));
    args.push(out.display().to_string());
    run_ffmpeg(args).await
}

impl Analyser {
    pub async fn run(self) {
        tokio::time::sleep(Duration::from_secs(45)).await;
        let tmp = self.dir.join("tmp");
        std::fs::create_dir_all(&tmp).ok();
        let cube = match write_cube(&tmp) {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("analysis: the output transform's cube cannot be written: {e:#}");
                return;
            }
        };
        // a thumbnail that could not be made: not again until the ten-minute round
        let mut no_thumb: HashSet<String> = HashSet::new();
        loop {
            match self.round(&cube, &mut no_thumb).await {
                Ok(()) => {}
                Err(e) if e.is::<NotReady>() => tracing::info!("analysis waits: the API has no Prem key"),
                Err(e) if e.is::<Paused>() => {
                    // Prem is paused: nothing is asked until the pause ends
                    let p = e.downcast::<Paused>().unwrap();
                    let wait = p.wait(chrono::Utc::now());
                    tracing::info!("analysis waits {} s: {p}", wait.as_secs());
                    tokio::time::sleep(wait).await;
                    continue;
                }
                Err(e) => tracing::warn!("analysis: {e:#}"),
            }
            tokio::select! {
                _ = self.peer.wake_analyse.notified() => {}
                _ = tokio::time::sleep(Duration::from_secs(600)) => no_thumb.clear(),
            }
        }
    }

    /// Is the analysis set up on the API, and not paused? (A paused one is an Err(Paused).)
    async fn ready(&self) -> Result<bool> {
        let res = self.http.get(format!("{}/api/analysis", self.api)).bearer_auth(&self.token).send().await?;
        if !res.status().is_success() {
            bail!("the API answered {} to the vault server's token", res.status());
        }
        let v: Value = serde_json::from_slice(&res.bytes().await?)?;
        if let Some(p) = status_paused(&v) {
            return Err(p.into());
        }
        Ok(v["ready"].as_bool().unwrap_or(false))
    }

    /// Every waiting file says why it waits (only where it does not say so already).
    async fn say_queued(&self, todo: &[&(String, Source)], records: &HashMap<String, Value>, state: &str) {
        for (hex, _) in todo {
            if records.get(hex).and_then(|r| r["state"].as_str()) != Some(state) {
                self.patch(hex, Map::from_iter([("state".into(), json!(state)), ("progress".into(), Value::Null)])).await.ok();
            }
        }
    }

    async fn round(&self, cube: &Path, no_thumb: &mut HashSet<String>) -> Result<()> {
        let held = self.peer.held().await?;
        let metas: HashMap<String, Value> = self.peer.metas().await?.into_iter().map(|(h, m)| (h.to_hex().to_string(), m)).collect();
        let records: HashMap<String, Value> = self.peer.records(PREFIX).await?.into_iter().map(|(h, r)| (h.to_hex().to_string(), r)).collect();
        let transcripts: HashMap<String, Value> = self.peer.records(sound::TRANSCRIPT).await?.into_iter().map(|(h, r)| (h.to_hex().to_string(), r)).collect();
        let sounds: HashMap<String, Value> = self.peer.records(sound::PREFIX).await?.into_iter().map(|(h, r)| (h.to_hex().to_string(), r)).collect();
        let now = chrono::Utc::now();
        // the proxies that name their original (the original's own `meta.proxy` may have been written over)
        let proxy_of: HashMap<String, String> = metas
            .iter()
            .filter(|(_, m)| s(m, "class") == "proxy" && m.pointer("/meta/color/profile").and_then(|x| x.as_str()) == Some(WORKING))
            .filter_map(|(h, m)| Some((m.pointer("/meta/proxy_of")?.as_str()?.to_string(), h.clone())))
            .collect();
        let mut sources: Vec<(String, Source)> =
            metas.iter().filter(|(_, m)| wants(m)).filter_map(|(h, m)| Some((h.clone(), source(h, m, &metas, &proxy_of, &held)?))).collect();
        sources.sort_by_key(|(_, src)| src.size());

        // a first thumbnail for everything that has none, as soon as its proxy is here — no model needed
        for (hex, src) in &sources {
            if needs_thumbnail(records.get(hex), &held) && !no_thumb.contains(hex) {
                if let Err(e) = self.first_thumbnail(hex, src, cube).await {
                    no_thumb.insert(hex.clone());
                    tracing::warn!("thumbnail of {}: {e:#}", &hex[..12]);
                }
            }
        }

        // then the analysis: a recording once its words have settled
        let todo: Vec<&(String, Source)> = sources
            .iter()
            .filter(|(hex, src)| due(records.get(hex), src))
            .filter(|(hex, _)| !waits_for_words(&metas[hex], transcripts.get(hex), sounds.get(hex), now))
            .collect();
        if todo.is_empty() {
            return Ok(());
        }
        match self.ready().await {
            Ok(true) => {}
            Ok(false) => {
                self.say_queued(&todo, &records, "queued").await;
                return Err(NotReady.into());
            }
            Err(e) => {
                if let Some(p) = e.downcast_ref::<Paused>() {
                    self.say_queued(&todo, &records, &queued(p)).await;
                }
                return Err(e);
            }
        }
        tracing::info!("analysis: {} files to tag", todo.len());
        // one at a time, one attempt each; a pause stops the round (the rest say why they wait)
        for (i, (hex, src)) in todo.iter().enumerate() {
            if let Err(e) = self.one(hex, src, &metas[hex], transcripts.get(hex), cube).await {
                if let Some(p) = e.downcast_ref::<Paused>() {
                    self.say_queued(&todo[i + 1..], &records, &queued(p)).await;
                }
                return Err(e);
            }
        }
        Ok(())
    }

    /// Set keys of a file's `analysis/<hash>` record (only this server writes it: read, set, write).
    async fn patch(&self, hex: &str, patch: Map<String, Value>) -> Result<Value> {
        let hash: Hash = hex.parse()?;
        let latest = self.peer.record(PREFIX, hash).await.ok().flatten();
        let next = sound::patched(latest.as_ref(), &patch);
        self.peer.write_record(PREFIX, hash, &next).await?;
        Ok(next)
    }

    /// The source's middle frame as the file's thumbnail, before any model looked at it.
    async fn first_thumbnail(&self, hex: &str, src: &Source, cube: &Path) -> Result<()> {
        let url = self.s3.presign_get(&s3::blob_key(&src.hash().to_hex()), Duration::from_secs(3600));
        let t = match src {
            Source::Movie { .. } => Some(probe(&url).await?.seconds / 2.0),
            Source::Still { .. } => None,
        };
        let thumb = self.thumbnail(hex, src, &url, t, "", cube).await?;
        self.patch(hex, Map::from_iter([("thumbnail".into(), json!(thumb.to_hex().to_string()))])).await?;
        tracing::info!("first thumbnail of {}", &hex[..12]);
        Ok(())
    }

    /// A thumbnail into the vault (its own blob and description), its hash.
    async fn thumbnail(&self, hex: &str, src: &Source, url: &str, t: Option<f64>, why: &str, cube: &Path) -> Result<Hash> {
        let original = self.peer.meta_of(hex.parse()?).await?.context("the description is not here")?;
        let out = self.dir.join("tmp").join(format!("{hex}.thumb.jpg"));
        let movie = matches!(src, Source::Movie { .. });
        let made = frame(url, t, movie, THUMB_EDGE, src.acescct().then_some(cube), &out).await;
        let result = async {
            made?;
            let (hash, size) = hash_file(&out).await?;
            let meta = thumbnail_meta(&original, hash, size, t.unwrap_or(0.0), why);
            sound::store(&self.peer, &self.s3, &self.db, &out, hash, size, &meta).await?;
            Ok::<_, anyhow::Error>(hash)
        }
        .await;
        std::fs::remove_file(&out).ok();
        result
    }

    /// One file; its own failure is written into its record (only "not set up" stops the round).
    async fn one(&self, hex: &str, src: &Source, meta: &Value, transcript: Option<&Value>, cube: &Path) -> Result<()> {
        let frames = self.dir.join("tmp").join(format!("{hex}.frames"));
        let result = self.analyse(hex, src, meta, transcript, cube, &frames).await;
        std::fs::remove_dir_all(&frames).ok();
        match result {
            Ok(()) => Ok(()),
            Err(e) if e.is::<NotReady>() || e.is::<Paused>() => {
                // not the file's fault: it waits, queued (with why), and no try is used up
                let state = e.downcast_ref::<Paused>().map(queued).unwrap_or_else(|| "queued".into());
                self.patch(hex, Map::from_iter([("state".into(), json!(state)), ("progress".into(), Value::Null)])).await.ok();
                Err(e)
            }
            Err(e) => {
                tracing::warn!("analysis of {}: {e:#}", &hex[..12]);
                let latest = self.peer.record(PREFIX, hex.parse()?).await.ok().flatten().unwrap_or(Value::Null);
                let tries = latest["tries"].as_u64().unwrap_or(0) + 1;
                let why = format!("{e:#}").chars().take(300).collect::<String>();
                let note = if tries < TRIES { format!("failed: {why} — tried {tries} of {TRIES}, again by itself") } else { format!("failed: {why} — tried {TRIES} times, waits for a person") };
                let patch = [("state", json!(note)), ("tries", json!(tries)), ("progress", Value::Null), ("of", json!(src.hash().to_hex().to_string()))];
                self.patch(hex, patch.into_iter().map(|(k, v)| (k.to_string(), v)).collect()).await.ok();
                Ok(())
            }
        }
    }

    async fn analyse(&self, hex: &str, src: &Source, meta: &Value, transcript: Option<&Value>, cube: &Path, dir: &Path) -> Result<()> {
        let started = std::time::Instant::now();
        let of = src.hash().to_hex().to_string();
        self.patch(hex, Map::from_iter([("state".into(), json!("analysing")), ("progress".into(), json!(0.0)), ("of".into(), json!(of))])).await?;
        let url = self.s3.presign_get(&s3::blob_key(&of), Duration::from_secs(12 * 3600));
        let lut = src.acescct().then_some(cube);
        // the frames and their times
        let (seconds, times) = match src {
            Source::Movie { .. } => {
                let seconds = probe(&url).await?.seconds;
                let mut times = sample(&url, interval(seconds), lut, dir).await?;
                // scene changes on top of the regular frames: thinned to the cap, evenly
                let keep = thin(times.len(), (MAX_FRAMES * 1.5) as usize);
                if keep.len() < times.len() {
                    let kept: Vec<f64> = keep.iter().map(|&i| times[i]).collect();
                    for (n, &i) in keep.iter().enumerate() {
                        std::fs::rename(dir.join(format!("{:05}.jpg", i + 1)), dir.join(format!("k{:05}.jpg", n + 1))).ok();
                    }
                    for e in std::fs::read_dir(dir)?.flatten() {
                        let name = e.file_name().to_string_lossy().into_owned();
                        if name.ends_with(".jpg") && !name.starts_with('k') {
                            std::fs::remove_file(e.path()).ok();
                        } else if let Some(rest) = name.strip_prefix('k') {
                            std::fs::rename(e.path(), dir.join(rest)).ok();
                        }
                    }
                    times = kept;
                }
                (seconds, times)
            }
            Source::Still { .. } => {
                std::fs::create_dir_all(dir)?;
                frame(&url, None, false, EDGE, lut, &dir.join("00001.jpg")).await?;
                (0.0, vec![0.0])
            }
        };
        let kind = if matches!(src, Source::Movie { .. }) { "video" } else { "image" };
        let file = json!({ "name": s(meta, "original_name"), "title": s(meta, "title"), "kind": kind, "seconds": seconds,
                           "description": s(meta, "description"), "tags": meta["tags"] });
        let parts = stretches(&times, seconds);
        let steps = parts.len() + 1;
        let mut answers: Vec<(f64, f64, Value)> = Vec::new();
        let mut picks: Vec<(f64, String)> = Vec::new();
        let mut model = Value::Null;
        let mut vocabulary = Value::Null;
        for (n, (i, j, a, b)) in parts.iter().enumerate() {
            let mut frames = Vec::new();
            for k in *i..*j {
                let bytes = tokio::fs::read(dir.join(format!("{:05}.jpg", k + 1))).await.with_context(|| format!("frame {}", k + 1))?;
                frames.push(json!({ "t": (times[k] * 1000.0).round() / 1000.0, "jpeg": base64(&bytes) }));
            }
            let before = answers.last().map(|(_, _, p)| p["summary"].clone()).unwrap_or(Value::Null);
            let body = json!({ "mode": "frames", "file": file, "stretch": { "s": a, "e": b, "index": n, "of": parts.len() },
                               "frames": frames, "words": words_in(transcript, *a, *b), "before": before });
            let answer = self.ask(&body).await?;
            if model.is_null() {
                model = answer["model"].clone();
                vocabulary = answer["vocabulary"].clone();
            }
            if let Some(idx) = answer["thumbnail"]["index"].as_u64().map(|x| x as usize).filter(|x| i + x < *j) {
                picks.push((times[i + idx], answer["thumbnail"]["why"].as_str().unwrap_or("").to_string()));
            }
            answers.push((*a, *b, answer));
            self.patch(hex, Map::from_iter([("progress".into(), json!(((n + 1) as f64 / steps as f64 * 1000.0).round() / 1000.0))])).await?;
        }

        // the reduce: the takes across the file, its tags and summary, the thumbnail
        let merged = merge(&answers);
        let stretches_: Vec<Value> = answers
            .iter()
            .map(|(a, b, p)| {
                let pick = picks.iter().find(|(t, _)| t >= a && t <= b).map(|(t, why)| json!({ "t": t, "why": why }));
                json!({ "s": a, "e": b, "summary": p["summary"], "tags": p["tags"], "cues": p["cues"], "thumbnail": pick })
            })
            .collect();
        let text: String = transcript.and_then(|t| t["text"].as_str()).unwrap_or("").chars().take(24_000).collect();
        let reduce = self.ask(&json!({ "mode": "reduce", "file": file, "stretches": stretches_, "text": text })).await;
        let reduce = match reduce {
            Ok(r) => Some(r),
            Err(e) if e.is::<NotReady>() || e.is::<Paused>() => return Err(e),
            Err(e) => {
                // the stretches' work is kept: the file is tagged, only its takes are not grouped across stretches
                tracing::warn!("analysis of {}: the reduce failed, the stretches stand: {e:#}", &hex[..12]);
                None
            }
        };
        let mut record = finish(merged, reduce.as_ref());

        // the thumbnail the analysis picked
        let cues = record["cues"].as_array().cloned().unwrap_or_default();
        let t = thumbnail_time(reduce.as_ref(), &picks, &cues, &times, seconds);
        let why = reduce.as_ref().and_then(|r| r["thumbnail"]["why"].as_str()).map(String::from).or_else(|| picks.iter().find(|(p, _)| (p - t).abs() < 1e-6).map(|(_, w)| w.clone())).unwrap_or_default();
        let previous = self.peer.record(PREFIX, hex.parse()?).await.ok().flatten().and_then(|r| r["thumbnail"].as_str().map(String::from));
        let at = matches!(src, Source::Movie { .. }).then_some(t);
        match self.thumbnail(hex, src, &url, at, &why, cube).await {
            Ok(h) => {
                record["thumbnail"] = json!(h.to_hex().to_string());
                if let Some(old) = previous.filter(|o| *o != h.to_hex().as_str()) {
                    self.supersede(&old).await;
                }
            }
            Err(e) => {
                tracing::warn!("thumbnail of {}: {e:#}", &hex[..12]);
                if let Some(old) = previous {
                    record["thumbnail"] = json!(old);
                }
            }
        }
        let o = record.as_object_mut().unwrap();
        o.insert("state".into(), json!("done"));
        o.insert("progress".into(), json!(1.0));
        o.insert("of".into(), json!(of));
        o.insert("model".into(), model);
        o.insert("vocabulary".into(), vocabulary);
        o.insert("at".into(), json!(now_iso()));
        o.insert("seconds".into(), json!((seconds * 1000.0).round() / 1000.0));
        o.insert("frames".into(), json!(times.len()));
        self.peer.write_record(PREFIX, hex.parse()?, &record).await?;
        tracing::info!(
            "analysed {} ({} frames in {} stretches, {} cues) in {:.0} s",
            &hex[..12],
            times.len(),
            parts.len(),
            cues.len(),
            started.elapsed().as_secs_f64()
        );
        Ok(())
    }

    /// A thumbnail replaced by a better one: tagged superseded (its description is the server's: it made the file).
    async fn supersede(&self, old: &str) {
        let Ok(hash) = old.parse::<Hash>() else { return };
        if let Ok(Some(mut m)) = self.peer.meta_of(hash).await {
            if let Some(tags) = m["tags"].as_array_mut() {
                if !tags.iter().any(|t| t == "superseded") {
                    tags.push(json!("superseded"));
                    self.peer.write_meta(hash, &m).await.ok();
                }
            }
        }
    }

    /// One request to the API (Prem): the answer, validated there against the vocabulary. The API's own rate limit
    /// (not Prem failing) is waited out once — a long file is many stretches, and its work so far is kept.
    async fn ask(&self, body: &Value) -> Result<Value> {
        for attempt in 0..2 {
            let res = self.http.post(format!("{}/api/analysis", self.api)).bearer_auth(&self.token).timeout(Duration::from_secs(15 * 60)).json(body).send().await?;
            let status = res.status();
            let bytes = res.bytes().await?;
            if status.is_success() {
                return Ok(serde_json::from_slice(&bytes)?);
            }
            let e = api_error(status.as_u16(), &bytes);
            let wait = e.downcast_ref::<Paused>().filter(|p| p.rate && attempt == 0).and_then(|p| p.until).map(|u| (u - chrono::Utc::now()).num_milliseconds());
            match wait {
                Some(ms) if ms <= 120_000 => tokio::time::sleep(Duration::from_millis(ms.max(0) as u64 + 500)).await,
                _ => return Err(e),
            }
        }
        bail!("the API's rate limit did not let this stretch through")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const O: &str = "0000000000000000000000000000000000000000000000000000000000000001";
    const P: &str = "0000000000000000000000000000000000000000000000000000000000000002";

    fn set(xs: &[&str]) -> HashSet<String> {
        xs.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn which_files_and_what_shows_them() {
        let orig = json!({ "hash": O, "kind": "video", "class": "original", "size": 900, "meta": { "proxy": P } });
        let proxy = json!({ "hash": P, "kind": "video", "class": "proxy", "size": 90, "meta": { "proxy_of": O, "color": { "profile": "acescct" } } });
        let metas: HashMap<String, Value> = [(O.to_string(), orig.clone()), (P.to_string(), proxy.clone())].into();
        assert!(wants(&orig) && !wants(&proxy));
        assert!(!wants(&json!({ "kind": "image", "class": "default", "meta": { "role": "frame" } })));
        assert!(!wants(&json!({ "kind": "image", "class": "proxy", "meta": { "role": "thumbnail" } })));
        assert!(!wants(&json!({ "kind": "audio", "class": "original" })));
        assert!(wants(&json!({ "kind": "other", "class": "default", "meta": { "sequence": "exr" } })));
        // the proxy, once the bucket holds it
        assert_eq!(source(O, &orig, &metas, &HashMap::new(), &set(&[O])), None);
        assert_eq!(source(O, &orig, &metas, &HashMap::new(), &set(&[O, P])), Some(Source::Movie { hash: P.parse().unwrap(), size: 90 }));
        // the original's meta.proxy written over: the proxy naming it still counts
        let bare = json!({ "hash": O, "kind": "video", "class": "original", "meta": {} });
        let of: HashMap<String, String> = [(O.to_string(), P.to_string())].into();
        assert!(matches!(source(O, &bare, &metas, &of, &set(&[P])), Some(Source::Movie { .. })));
        // an old proxy not in ACEScct: not the model's picture
        let old = json!({ "hash": P, "kind": "video", "class": "proxy", "meta": { "color": { "profile": "slog3" } } });
        let metas2: HashMap<String, Value> = [(O.to_string(), orig.clone()), (P.to_string(), old)].into();
        assert_eq!(source(O, &orig, &metas2, &HashMap::new(), &set(&[O, P])), None);
        // a small display still: itself
        let still = json!({ "hash": O, "kind": "image", "class": "default", "size": 5, "meta": { "proxy": "none: a 1080×720 display still needs none" } });
        assert_eq!(source(O, &still, &HashMap::new(), &HashMap::new(), &set(&[O])), Some(Source::Still { hash: O.parse().unwrap(), size: 5, acescct: false }));
        // a still's PNG proxy: through the cube
        let png = json!({ "hash": P, "kind": "image", "class": "proxy", "size": 7, "meta": { "color": { "profile": "acescct" } } });
        let exr = json!({ "hash": O, "kind": "image", "class": "original", "meta": { "proxy": P } });
        let metas3: HashMap<String, Value> = [(P.to_string(), png)].into();
        assert_eq!(source(O, &exr, &metas3, &HashMap::new(), &set(&[P])), Some(Source::Still { hash: P.parse().unwrap(), size: 7, acescct: true }));
    }

    #[test]
    fn when_it_is_due() {
        let src = Source::Movie { hash: P.parse().unwrap(), size: 1 };
        assert!(due(None, &src));
        // only a first thumbnail so far
        assert!(due(Some(&json!({ "thumbnail": "t" })), &src));
        assert!(!due(Some(&json!({ "state": "done", "of": P })), &src));
        // the proxy was made again: again
        assert!(due(Some(&json!({ "state": "done", "of": O })), &src));
        assert!(due(Some(&json!({ "state": "failed: x", "tries": 2, "of": P })), &src));
        assert!(!due(Some(&json!({ "state": "failed: x", "tries": 3, "of": P })), &src));
        assert!(due(Some(&json!({ "state": "analysing", "progress": 0.4, "of": P })), &src));
        assert!(needs_thumbnail(None, &set(&[])) && needs_thumbnail(Some(&json!({ "thumbnail": "t" })), &set(&[])));
        assert!(!needs_thumbnail(Some(&json!({ "thumbnail": "t" })), &set(&["t"])));
    }

    #[test]
    fn a_recording_waits_for_its_words_but_not_forever() {
        let rec = json!({ "kind": "video", "class": "original", "meta": {} });
        let now = chrono::DateTime::parse_from_rfc3339("2026-09-30T12:00:00Z").unwrap().with_timezone(&chrono::Utc);
        let sound = |at: &str| json!({ "state": "done", "audio": "a", "at": at });
        assert!(waits_for_words(&rec, None, Some(&sound("2026-09-30T11:00:00Z")), now));
        assert!(waits_for_words(&rec, Some(&json!({ "state": "transcribing", "progress": 0.5 })), None, now));
        assert!(!waits_for_words(&rec, Some(&json!({ "state": "done", "words": [] })), None, now));
        // no Mac made them in six hours: on without them
        assert!(!waits_for_words(&rec, None, Some(&sound("2026-09-30T05:59:00Z")), now));
        // no sound at all, or a still: never waits
        assert!(!waits_for_words(&rec, None, Some(&json!({ "state": "none: no sound track" })), now));
        assert!(!waits_for_words(&json!({ "kind": "image", "class": "default" }), None, None, now));
    }

    #[test]
    fn frames_and_stretches() {
        assert_eq!(interval(30.0), 1.0);
        assert_eq!(interval(3600.0), 6.0);
        let log = "[Parsed_showinfo_1 @ 0x1] n:   0 pts:      0 pts_time:0       duration: 1\n[Parsed_showinfo_1 @ 0x1] color_range:tv\n[Parsed_showinfo_1 @ 0x1] n:   1 pts:  15360 pts_time:1.0 duration: 1\nframe=2";
        assert_eq!(frame_times(log), vec![0.0, 1.0]);
        let times: Vec<f64> = (0..30).map(f64::from).collect();
        let st = stretches(&times, 30.5);
        assert_eq!(st.len(), 3);
        assert_eq!(st[0], (0, 12, 0.0, 12.0));
        assert_eq!(st[2], (24, 30, 24.0, 30.5));
        assert_eq!(stretches(&[0.0], 0.0), vec![(0, 1, 0.0, 0.0)]);
        assert_eq!(thin(10, 4), vec![0, 2, 5, 7]);
        assert_eq!(thin(3, 4), vec![0, 1, 2]);
        let f = filter(Some(1.0), 768, Some(Path::new("/data/tmp/odt.cube")), true);
        assert!(f.starts_with("select='isnan(prev_selected_t)+gte(t-prev_selected_t,1.000)+gt(scene,0.35)"));
        assert!(f.contains("in_color_matrix=bt709:in_range=tv,format=rgb48le,lut3d=file='/data/tmp/odt.cube'"));
        assert_eq!(filter(None, 640, None, false), "scale=w=640:h=640:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=bicubic");
    }

    #[test]
    fn the_words_of_a_stretch() {
        let t = json!({ "utterances": [{ "s": 0.5, "e": 2.0, "text": "Day twenty." }, { "s": 13.0, "e": 15.0, "text": "Later." }],
                        "words": [{ "w": "Day", "s": 0.5, "e": 0.9 }] });
        assert_eq!(words_in(Some(&t), 0.0, 12.0), vec![json!({ "s": 0.5, "e": 2.0, "text": "Day twenty." })]);
        let bare = json!({ "words": [{ "w": "Day", "s": 0.5, "e": 0.9 }, { "w": "twenty.", "s": 0.9, "e": 1.3 }] });
        assert_eq!(words_in(Some(&bare), 0.0, 12.0), vec![json!({ "s": 0.5, "e": 1.3, "text": "Day twenty." })]);
        assert!(words_in(None, 0.0, 1.0).is_empty());
    }

    #[test]
    fn stretches_merge_into_one_file() {
        let a = json!({ "tags": { "shot_size": "MS", "movement": ["handheld"], "people": 1, "location": "interior" }, "free": ["desk", "laptop"],
                        "cues": [{ "s": 3.0, "e": 5.0, "kind": "take", "label": "sits down" }, { "s": 1.0, "e": 2.0, "kind": "action", "label": "enters" }], "summary": "He comes in." });
        let b = json!({ "tags": { "shot_size": "CU", "movement": ["static"], "people": 1, "location": "interior" }, "free": ["laptop"],
                        "cues": [{ "s": 14.0, "e": 16.0, "kind": "take", "label": "sits down" }], "summary": "He sits." });
        let c = json!({ "tags": { "shot_size": "MS", "movement": ["handheld", "pan"], "people": 2 }, "free": [], "cues": [], "summary": "" });
        let m = merge(&[(0.0, 12.0, a), (12.0, 20.0, b), (20.0, 30.0, c)]);
        assert_eq!(m["tags"]["shot_size"], "MS");
        // handheld 22 of 30 s, static 8 (> a fifth), pan 10
        assert_eq!(m["tags"]["movement"], json!(["handheld", "pan", "static"]));
        assert_eq!(m["tags"]["people"], 1);
        assert_eq!(m["free"], json!(["laptop", "desk"]));
        assert_eq!(m["cues"][0]["label"], "enters");
        assert_eq!(m["segments"].as_array().unwrap().len(), 3);

        // the reduce groups the attempts across stretches and ranks them
        let r = json!({ "tags": { "scene": ["action"] }, "summary": { "line": "A man sits down at his desk, twice.", "best_use": "The opener." },
                        "takes": [{ "take_of": "sits down", "best": 2, "why": "no bump", "takes": [{ "s": 3.0, "e": 5.0, "take": 1, "rank": 2 }, { "s": 14.0, "e": 16.0, "take": 2, "rank": 1 }] }],
                        "thumbnail": { "t": 14.2, "why": "his face in the light" } });
        let f = finish(m.clone(), Some(&r));
        assert_eq!(f["summary"]["best_use"], "The opener.");
        assert_eq!(f["tags"]["scene"], json!(["action"]));
        assert_eq!(f["tags"]["shot_size"], "MS");
        let takes: Vec<&Value> = f["cues"].as_array().unwrap().iter().filter(|c| c["kind"] == "take").collect();
        assert_eq!(takes.len(), 2);
        assert_eq!(takes[1]["best"], true);
        assert_eq!(takes[1]["label"], "sits down · take 2");
        assert_eq!(takes[1]["why"], "no bump");
        assert!(f["labels"].as_array().unwrap().contains(&json!("shot_size:MS")));
        assert!(f["labels"].as_array().unwrap().contains(&json!("movement:handheld")));
        assert!(f["labels"].as_array().unwrap().contains(&json!("laptop")));
        // without a reduce: the stretches stand, the first line is the summary
        let alone = finish(m, None);
        assert_eq!(alone["summary"]["line"], "He comes in.");
        assert_eq!(alone["cues"].as_array().unwrap().iter().filter(|c| c["kind"] == "take").count(), 2);
    }

    #[test]
    fn where_the_thumbnail_is() {
        let times = [0.0, 1.0, 2.0, 14.0, 15.0];
        let r = json!({ "thumbnail": { "t": 14.2 } });
        assert_eq!(thumbnail_time(Some(&r), &[], &[], &times, 20.0), 14.0);
        let cues = [json!({ "kind": "highlight", "s": 1.5, "e": 2.5 })];
        assert_eq!(thumbnail_time(None, &[(15.0, "x".into())], &cues, &times, 20.0), 2.0);
        assert_eq!(thumbnail_time(None, &[(2.0, "sharp".into())], &cues, &times, 20.0), 2.0);
        assert_eq!(thumbnail_time(None, &[], &[], &times, 20.0), 14.0);
        assert_eq!(thumbnail_time(None, &[], &[], &[0.0], 0.0), 0.0);
    }

    #[test]
    fn a_thumbnail_lives_beside_its_original() {
        let orig = json!({ "hash": O, "original_name": "C0042.MP4", "story": "s1", "class": "original" });
        let m = thumbnail_meta(&orig, P.parse().unwrap(), 12_000, 14.0, "his face in the light");
        assert_eq!(m["class"], "proxy");
        assert_eq!(m["story"], "s1");
        assert_eq!(m["kind"], "image");
        assert_eq!(m["original_name"], "C0042.thumb.jpg");
        assert_eq!(m["meta"]["role"], "thumbnail");
        assert_eq!(m["meta"]["thumbnail_of"], O);
        assert!(!wants(&m));
    }

    #[test]
    fn base64_as_everyone_writes_it() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0xff, 0xfe, 0xfd]), "//79");
    }

    /// The real tools on a synthetic ACEScct proxy: frames sampled with their times, through the output transform, and
    /// one frame at a time — skipped where there is no ffmpeg.
    #[tokio::test]
    async fn samples_frames_through_the_output_transform() {
        if std::process::Command::new(sound::ffmpeg()).arg("-version").output().is_err() {
            eprintln!("no ffmpeg here: skipped");
            return;
        }
        let dir = std::env::temp_dir().join(format!("vault-analyse-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let cube = write_cube(&dir).unwrap();
        let text = std::fs::read_to_string(&cube).unwrap();
        assert!(text.contains("LUT_3D_SIZE 65"));
        assert_eq!(text.lines().count(), 4 + CUBE * CUBE * CUBE);
        // 5 s of a grey 10-bit HEVC-like movie (mpeg4 here), tagged BT.709 TV range like a proxy, with a cut at 2.5 s
        let movie = dir.join("proxy.mp4");
        let st = std::process::Command::new(sound::ffmpeg())
            .args(["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x999999:size=640x360:rate=25:duration=2.5", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=2.5"])
            .args(["-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]", "-c:v", "mpeg4", "-q:v", "3", "-colorspace", "bt709", "-color_range", "tv"])
            .arg(&movie)
            .status()
            .unwrap();
        assert!(st.success());
        let frames = dir.join("frames");
        let times = sample(&movie.display().to_string(), 1.0, Some(&cube), &frames).await.unwrap();
        // one a second (0…4) and the cut at 2.5
        assert!(times.len() >= 5 && times.len() <= 7, "{times:?}");
        assert_eq!(times[0], 0.0);
        assert!(times.windows(2).all(|w| w[1] > w[0]));
        assert!(times.iter().any(|t| (t - 2.5).abs() < 0.05), "the cut is sampled: {times:?}");
        assert_eq!(std::fs::read_dir(&frames).unwrap().count(), times.len());
        let first = std::fs::read(frames.join("00001.jpg")).unwrap();
        assert_eq!(&first[..2], &[0xff, 0xd8]);
        // one frame, the thumbnail's size
        let thumb = dir.join("thumb.jpg");
        frame(&movie.display().to_string(), Some(3.0), true, THUMB_EDGE, Some(&cube), &thumb).await.unwrap();
        let (_, size) = hash_file(&thumb).await.unwrap();
        assert!(size > 1000);
        // the grey went through the output transform: ACEScct 0.6 reads as what a screen shows of it, not the
        // log value — decoded back to 8-bit grey to look
        let px = std::process::Command::new(sound::ffmpeg()).args(["-nostdin", "-v", "error", "-i"]).arg(frames.join("00001.jpg")).args(["-f", "rawvideo", "-pix_fmt", "gray", "-"]).output().unwrap().stdout;
        let mean = px.iter().map(|&x| x as f64).sum::<f64>() / px.len() as f64;
        let expect = vault_color::aces2::OutputTransform::sdr_rec709().apply([0x99 as f64 / 255.0; 3])[0] * 255.0;
        assert!((mean - expect).abs() < 12.0, "grey {mean:.1}, the transform says {expect:.1}");
        std::fs::remove_dir_all(&dir).ok();
    }
}
