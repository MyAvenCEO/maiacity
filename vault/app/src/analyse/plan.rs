//! What the shot analysis looks at, when, and how its answers become one record — pure functions, tested. They came
//! from the vault server's analyse.rs (retired: the Mac does all media work now) with their tests; what changed is
//! where a file is "held" (complete in this Mac's store, not in the bucket) and who works on it (one Mac at a time,
//! like the transcripts: `device` + `updated`).

use std::collections::HashMap;

use serde_json::{Map, Value, json};

/// Frames per request (a stretch of the file).
pub const BATCH: usize = 12;
/// Frames of one file at most (an hour: one every six seconds); picture changes come on top, then all are thinned.
pub const MAX_FRAMES: f64 = 600.0;
/// The long edge of a frame the model sees.
pub const EDGE: u32 = 768;
/// A frame whose picture changed this much from the one before (the mean difference of a small grey copy of both,
/// 0…1 of display code values) is sampled too — a cut, a light switched on. (ffmpeg's scene score before: 0.35 on
/// its own scale.)
pub const SCENE: f64 = 0.12;
/// The analysis' own version, in every record it writes (`version`): raised when what it makes changes enough to make
/// every file's again — a record of an older one (none said: 1) is due. A proxy made again is not that: it shows the
/// same original.
pub const VERSION: u64 = 1;



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

#[cfg(test)]
mod tests {
    use super::*;

    const O: &str = "0000000000000000000000000000000000000000000000000000000000000001";
    const P: &str = "0000000000000000000000000000000000000000000000000000000000000002";

    fn set(xs: &[&str]) -> HashSet<String> {
        xs.iter().map(|x| x.to_string()).collect()
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
