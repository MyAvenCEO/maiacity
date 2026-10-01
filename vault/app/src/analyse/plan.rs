//! What the shot analysis looks at, when, and how its answers become one record — pure functions, tested. They came
//! from the vault server's analyse.rs (retired: the Mac does all media work now) with their tests; what changed is
//! where a file is "held" (complete in this Mac's store, not in the bucket) and who works on it (one Mac at a time,
//! like the transcripts: `device` + `updated`).

use std::collections::{HashMap, HashSet};

use iroh_blobs::Hash;
use serde_json::{Map, Value, json};
use vault_core::{Meta, ingest::Batch};

/// How often a file is tried before it waits for a person.
pub const TRIES: u64 = 3;
/// Frames per request (a stretch of the file).
pub const BATCH: usize = 12;
/// Frames of one file at most (an hour: one every six seconds); picture changes come on top, then all are thinned.
pub const MAX_FRAMES: f64 = 600.0;
/// The long edge of a frame the model sees.
pub const EDGE: u32 = 768;
/// The long edge of a still's preview (a video's is its grading still's frame, 1920 wide).
pub const PREVIEW_EDGE: u32 = 1920;
/// A frame whose picture changed this much from the one before (the mean difference of a small grey copy of both,
/// 0…1 of display code values) is sampled too — a cut, a light switched on. (ffmpeg's scene score before: 0.35 on
/// its own scale.)
pub const SCENE: f64 = 0.12;
/// The proxies' working space (vault-media `proxy::WORKING`).
pub const WORKING: &str = vault_media::proxy::WORKING;
/// How long a recording's analysis waits for its words before it goes on without them.
pub const WORDS_WAIT_HOURS: i64 = 6;
/// Another device's analysis that has said nothing for this long is taken over.
pub const STALE_HOURS: i64 = 6;
/// The Day 01 story: what the analysis runs for when nothing else is set.
pub const DAY_01: &str = "9e89f786b06a26d5d33fa8ed2d77cc828afacc016e1113bb779ab4076243fa26";

pub(crate) fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("")
}

pub fn is_hash(x: &str) -> bool {
    x.len() == 64 && x.bytes().all(|b| b.is_ascii_hexdigit())
}

/// What the model looks at for a file.
#[derive(Debug, Clone, PartialEq)]
pub enum Source {
    /// a movie's ACEScct proxy (HEVC Main10)
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
    /// Is it in ACEScct (then it goes through the output transform)?
    pub fn acescct(&self) -> bool {
        matches!(self, Source::Movie { .. } | Source::Still { acescct: true, .. })
    }
    pub fn movie(&self) -> bool {
        matches!(self, Source::Movie { .. })
    }
}

/// Is this file's story one the analysis runs for? (None: every story.)
pub fn in_scope(meta: &Value, only: Option<&HashSet<String>>) -> bool {
    only.is_none_or(|set| set.contains(s(meta, "story")))
}

/// Does this file get analysed? Footage to cut with: a video original, an EXR sequence, a still — never a proxy, a
/// delivery, or the pipeline's own working files (hero frames, LUTs, thumbnails, audio proxies).
pub fn wants(meta: &Value) -> bool {
    let role = meta.pointer("/meta/role").and_then(|r| r.as_str()).unwrap_or("");
    let working = matches!(role, "frame" | "lut" | "proxy" | "proxy-cache" | "audio" | "thumbnail" | "plate" | "model" | "grade-still" | "preview");
    let superseded = meta["tags"].as_array().is_some_and(|t| t.iter().any(|t| t.as_str() == Some("superseded"))) || meta.pointer("/meta/deleted").is_some_and(|d| !d.is_null());
    let sequence = meta.pointer("/meta/sequence").and_then(|x| x.as_str()) == Some("exr");
    matches!(s(meta, "class"), "" | "default" | "original") && !working && !superseded && (matches!(s(meta, "kind"), "video" | "image") || sequence)
}

/// Which file shows it: its ACEScct proxy once this Mac holds it (the original's `meta.proxy`, or a proxy naming it
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

/// The hashes `source` may pick for a file (to ask this Mac's store whether it holds them).
pub fn candidates(hex: &str, meta: &Value, proxy_of: &HashMap<String, String>) -> Vec<String> {
    let named = meta.pointer("/meta/proxy").and_then(|p| p.as_str()).unwrap_or("");
    let mut out = vec![hex.to_string()];
    if is_hash(named) {
        out.push(named.to_string());
    }
    if let Some(p) = proxy_of.get(hex) {
        out.push(p.clone());
    }
    out
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

/// Is another device working on it right now (analysing, and heard from within STALE_HOURS)? Then it is left to it.
pub fn elsewhere(record: Option<&Value>, me: &str, now: &str) -> bool {
    let Some(r) = record else { return false };
    let device = s(r, "device");
    s(r, "state") == "analysing" && !device.is_empty() && device != me && crate::transcripts::age_hours(s(r, "updated"), now).is_some_and(|h| h < STALE_HOURS)
}

/// Does a recording's analysis still wait for its words? Until its transcript has settled — or, when no Mac has made
/// it within WORDS_WAIT_HOURS of its sound being read (`sound/<hash>`'s `at`), not any longer; a file without sound
/// never waits.
pub fn waits_for_words(meta: &Value, transcript: Option<&Value>, sound: Option<&Value>, now: &str) -> bool {
    if !crate::sound::wants_value(meta) || crate::sound::settled(transcript) {
        return false;
    }
    let state = sound.and_then(|x| x["state"].as_str()).unwrap_or("");
    if state.starts_with("none") {
        return false;
    }
    let since = sound.and_then(|x| x["at"].as_str()).and_then(|a| crate::transcripts::age_hours(a, now));
    !since.is_some_and(|h| h >= WORDS_WAIT_HOURS)
}

/// Does a still need its preview? (Its description names none, or one that is not in the vault.)
pub fn needs_preview(meta: &Value, known: &HashSet<String>) -> bool {
    !meta["meta"]["preview"].as_str().is_some_and(|p| known.contains(p))
}

/// Seconds between the regular frames: one a second, fewer for a long file.
pub fn interval(seconds: f64) -> f64 {
    (seconds / MAX_FRAMES).max(1.0)
}

/// Is the frame at `t` sampled? The first; one every `every` seconds; and a picture change (`change` ≥ SCENE) at
/// least half a second after the last one sampled.
pub fn pick(t: f64, last: Option<f64>, change: f64, every: f64) -> bool {
    match last {
        None => true,
        Some(p) => t - p >= every - 1e-6 || (change >= SCENE && t - p >= 0.5),
    }
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
        let many = parts.iter().any(|(_, _, p)| p["tags"][&k].is_array());
        if vals.is_empty() {
            continue;
        }
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

/// A still's preview: its file name and batch — beside its original (the same story), class proxy, role preview.
pub fn preview_batch(original: &Meta) -> (String, Batch) {
    let stem = std::path::Path::new(&original.original_name)
        .file_stem()
        .map(|x| x.to_string_lossy().into_owned())
        .filter(|x| !x.is_empty())
        .unwrap_or_else(|| original.hash.chars().take(12).collect());
    let batch = Batch {
        session: format!("preview of {}", original.hash),
        tags: vec!["preview".into()],
        title: Some(format!("{stem} · preview")),
        meta: json!({ "role": "preview", "preview_of": original.hash, "edge": PREVIEW_EDGE }),
        story: Some(original.story.clone()).filter(|s| !s.is_empty()),
        class: Some("proxy".into()),
        ..Default::default()
    };
    (format!("{stem}.preview.jpg"), batch)
}

/// A JPEG as base64 (what a data URL carries).
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

/// The failure a file's record says: why, and whether it tries again by itself.
pub fn failed(why: &str, tries: u64) -> String {
    let why: String = why.chars().take(300).collect();
    if tries < TRIES { format!("failed: {why} — tried {tries} of {TRIES}, again by itself") } else { format!("failed: {why} — tried {TRIES} times, waits for a person") }
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
        // the proxy, once this Mac holds it
        assert_eq!(source(O, &orig, &metas, &HashMap::new(), &set(&[O])), None);
        assert_eq!(source(O, &orig, &metas, &HashMap::new(), &set(&[O, P])), Some(Source::Movie { hash: P.parse().unwrap(), size: 90 }));
        // the original's meta.proxy written over: the proxy naming it still counts
        let bare = json!({ "hash": O, "kind": "video", "class": "original", "meta": {} });
        let of: HashMap<String, String> = [(O.to_string(), P.to_string())].into();
        assert!(matches!(source(O, &bare, &metas, &of, &set(&[P])), Some(Source::Movie { .. })));
        assert_eq!(candidates(O, &bare, &of), vec![O.to_string(), P.to_string()]);
        // an old proxy not in ACEScct: not the model's picture
        let old = json!({ "hash": P, "kind": "video", "class": "proxy", "meta": { "color": { "profile": "slog3" } } });
        let metas2: HashMap<String, Value> = [(O.to_string(), orig.clone()), (P.to_string(), old)].into();
        assert_eq!(source(O, &orig, &metas2, &HashMap::new(), &set(&[O, P])), None);
        // a small display still: itself
        let still = json!({ "hash": O, "kind": "image", "class": "default", "size": 5, "meta": { "proxy": "none: a 1080×720 display still needs none" } });
        assert_eq!(source(O, &still, &HashMap::new(), &HashMap::new(), &set(&[O])), Some(Source::Still { hash: O.parse().unwrap(), size: 5, acescct: false }));
        // a still's PNG proxy: through the output transform
        let png = json!({ "hash": P, "kind": "image", "class": "proxy", "size": 7, "meta": { "color": { "profile": "acescct" } } });
        let exr = json!({ "hash": O, "kind": "image", "class": "original", "meta": { "proxy": P } });
        let metas3: HashMap<String, Value> = [(P.to_string(), png)].into();
        assert_eq!(source(O, &exr, &metas3, &HashMap::new(), &set(&[P])), Some(Source::Still { hash: P.parse().unwrap(), size: 7, acescct: true }));
        // the scope: the Day 01 story only, unless every story
        let only = set(&[DAY_01]);
        assert!(in_scope(&json!({ "story": DAY_01 }), Some(&only)) && !in_scope(&json!({ "story": "x" }), Some(&only)) && in_scope(&json!({}), None));
    }

    #[test]
    fn when_it_is_due_and_whose_it_is() {
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
        assert!(needs_preview(&json!({}), &set(&[])) && needs_preview(&json!({ "meta": { "preview": "p" } }), &set(&[])));
        assert!(!needs_preview(&json!({ "meta": { "preview": "p" } }), &set(&["p"])));
        // another Mac at work an hour ago: its own; gone quiet for six hours, or the server's old run: taken over
        let now = "2026-09-30T12:00:00Z";
        assert!(elsewhere(Some(&json!({ "state": "analysing", "device": "mac2", "updated": "2026-09-30T11:00:00Z" })), "me", now));
        assert!(!elsewhere(Some(&json!({ "state": "analysing", "device": "mac2", "updated": "2026-09-30T05:00:00Z" })), "me", now));
        assert!(!elsewhere(Some(&json!({ "state": "analysing", "progress": 0.2 })), "me", now));
        assert!(!elsewhere(Some(&json!({ "state": "analysing", "device": "me", "updated": "2026-09-30T11:59:00Z" })), "me", now));
        assert_eq!(failed("x", 1), "failed: x — tried 1 of 3, again by itself");
        assert_eq!(failed("x", 3), "failed: x — tried 3 times, waits for a person");
    }

    #[test]
    fn a_recording_waits_for_its_words_but_not_forever() {
        let rec = json!({ "kind": "video", "class": "original", "meta": {} });
        let now = "2026-09-30T12:00:00Z";
        let sound = |at: &str| json!({ "state": "done", "at": at });
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
        // one a second, and a cut half a second after the last one sampled
        assert!(pick(0.0, None, 0.0, 1.0));
        assert!(!pick(0.5, Some(0.0), 0.01, 1.0));
        assert!(pick(1.0, Some(0.0), 0.0, 1.0));
        assert!(pick(1.5, Some(1.0), 0.5, 1.0));
        assert!(!pick(1.2, Some(1.0), 0.5, 1.0));
        let times: Vec<f64> = (0..30).map(f64::from).collect();
        let st = stretches(&times, 30.5);
        assert_eq!(st.len(), 3);
        assert_eq!(st[0], (0, 12, 0.0, 12.0));
        assert_eq!(st[2], (24, 30, 24.0, 30.5));
        assert_eq!(stretches(&[0.0], 0.0), vec![(0, 1, 0.0, 0.0)]);
        assert_eq!(thin(10, 4), vec![0, 2, 5, 7]);
        assert_eq!(thin(3, 4), vec![0, 1, 2]);
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
    fn a_still_s_preview_lives_beside_its_original() {
        let orig = Meta { hash: O.into(), original_name: "sky.png".into(), story: "s1".into(), class: "original".into(), ..Default::default() };
        let (name, b) = preview_batch(&orig);
        assert_eq!(name, "sky.preview.jpg");
        assert_eq!(b.class.as_deref(), Some("proxy"));
        assert_eq!(b.story.as_deref(), Some("s1"));
        assert_eq!(b.title.as_deref(), Some("sky · preview"));
        assert_eq!(b.meta, json!({ "role": "preview", "preview_of": O, "edge": 1920 }));
        let as_meta = json!({ "kind": "image", "class": "proxy", "tags": b.tags, "meta": b.meta });
        assert!(!wants(&as_meta));
    }

    #[test]
    fn base64_as_everyone_writes_it() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0xff, 0xfe, 0xfd]), "//79");
    }

    #[test]
    fn a_record_is_patched_key_by_key() {
        let r = json!({ "state": "failed: x", "tries": 1, "thumbnail": "t" });
        let next = patched(Some(&r), &Map::from_iter([("state".into(), json!("analysing")), ("tries".into(), Value::Null)]));
        assert_eq!(next, json!({ "state": "analysing", "thumbnail": "t" }));
        assert_eq!(patched(None, &Map::from_iter([("state".into(), json!("queued"))])), json!({ "state": "queued" }));
    }
}
