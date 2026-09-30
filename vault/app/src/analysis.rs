//! The shot analysis, for agents: what the vault server's analysis (vault-server analyse.rs → Prem's confidential Qwen,
//! in game/film/vocabulary.json's terms) found in every picture — base tags, free tags, time-ranged cues (takes,
//! actions, emotions, cut points, transitions, highlights, problems), a summary — read from the file's view
//! (`meta.analysis`, merged in from `analysis/<hash>` by vault-core), and searched: `find_shots` ranks the ranges of every
//! analysed file against filters on the base tags and words (in the cues, the summaries and what is said), so an
//! agent can pull the best parts of a shot. Pure functions; mcp.rs makes them tools.

use serde_json::{Value, json};
use vault_core::Meta;

use crate::mcp::{tokens, word_timecode};

/// What library_list says of an analysis: that it is there and what it found in brief — not every cue.
pub fn summary(a: &Value) -> Value {
    let cues = a["cues"].as_array().map(Vec::as_slice).unwrap_or_default();
    let count = |k: &str| cues.iter().filter(|c| c["kind"] == k).count();
    json!({ "summary": a["summary"], "tags": a["tags"], "free": a["free"], "cues": cues.len(), "highlights": count("highlight"),
            "takes": count("take"), "problems": count("problem"), "model": a["model"], "at": a["at"] })
}

fn inside(v: &Value, from: Option<f64>, to: Option<f64>) -> bool {
    let (s, e) = (v["s"].as_f64().unwrap_or(0.0), v["e"].as_f64().unwrap_or(0.0));
    from.is_none_or(|f| e >= f) && to.is_none_or(|t| s <= t)
}

/// A range with its timecodes (the file's start timecode plus its times), when the file has one.
fn with_tc(meta: &Value, mut v: Value) -> Value {
    for (k, at) in [("tc_in", "s"), ("tc_out", "e")] {
        if let Some(tc) = v[at].as_f64().and_then(|t| word_timecode(meta, t)) {
            v[k] = json!(tc);
        }
    }
    v
}

/// A file's analysis for the `analysis` tool: its summary, tags, segments and cues (between from and to), each range
/// with its timecodes; or where it stands.
pub fn view(meta: &Meta, from: Option<f64>, to: Option<f64>) -> Value {
    let m = &meta.meta;
    let state = m.get("analysis_state").cloned().unwrap_or(Value::Null);
    let base = json!({ "hash": meta.hash, "name": meta.original_name, "title": meta.title, "story": meta.story, "state": state,
                       "progress": m.get("analysis_progress"), "thumbnail": m.get("thumbnail"), "proxy": m.get("proxy") });
    let Some(a) = m.get("analysis").filter(|a| a.is_object()) else {
        let mut out = base;
        out["analysis"] = Value::Null;
        if out["state"].is_null() {
            out["state"] = json!("not yet: the vault server analyses a picture once its proxy is in the bucket (and a recording's transcript is done)");
        }
        return out;
    };
    let pick = |k: &str| -> Vec<Value> { a[k].as_array().into_iter().flatten().filter(|v| inside(v, from, to)).map(|v| with_tc(m, v.clone())).collect() };
    let mut out = base;
    for k in ["summary", "tags", "free", "labels", "model", "vocabulary", "at", "of", "seconds", "frames"] {
        out[k] = a[k].clone();
    }
    out["timecode"] = m.pointer("/probe/timecode").cloned().unwrap_or(Value::Null);
    out["segments"] = json!(pick("segments"));
    out["cues"] = json!(pick("cues"));
    out
}

/// What find_shots looks for.
#[derive(Debug, Default)]
pub struct Query {
    /// words, anywhere: a cue's label, note or why, what is said in its range, the file's summary and tags
    pub text: String,
    /// base tags, each one value or any of several: ("shot_size", ["CU", "ECU"]) — a file matches where its tags do,
    /// or only in the stretches whose tags do
    pub tags: Vec<(String, Vec<String>)>,
    /// only these cue kinds (take, action, emotion, cut, transition, highlight, problem); none: all but problems
    pub kinds: Vec<String>,
    pub story: Option<String>,
    pub min_confidence: f64,
    pub limit: usize,
}

/// Does a tag's value (one, many, a number) hold any of the wanted values? Case does not matter.
fn holds(v: &Value, wanted: &[String]) -> bool {
    let is = |x: &Value| {
        let s = match x {
            Value::String(s) => s.to_lowercase(),
            Value::Number(n) => n.to_string(),
            _ => return false,
        };
        wanted.iter().any(|w| w.to_lowercase() == s)
    };
    match v {
        Value::Array(xs) => xs.iter().any(is),
        x => is(x),
    }
}

fn matches_tags(tags: &Value, filters: &[(String, Vec<String>)]) -> bool {
    filters.iter().all(|(k, want)| holds(&tags[k.as_str()], want))
}

fn words_between(meta: &Value, s: f64, e: f64) -> Vec<String> {
    meta.pointer("/transcript/words")
        .and_then(|w| w.as_array())
        .into_iter()
        .flatten()
        .filter(|w| w["s"].as_f64().unwrap_or(f64::MAX) < e && w["e"].as_f64().unwrap_or(0.0) > s)
        .flat_map(|w| tokens(w["w"].as_str().unwrap_or("")))
        .collect()
}

/// The best candidate ranges across the library: every analysed file whose tags (or some of whose stretches) match,
/// its cues (and, where no cue answers the words, its stretches) scored by the words found (in the cue 3, in its
/// note or what is said in it 2, in the file's summary or tags 1), its confidence, and what an editor wants (a
/// highlight, the best take) or does not (a problem, a quality flag). Highest first.
pub fn find(list: &[Meta], q: &Query) -> Vec<Value> {
    let want = tokens(&q.text);
    let mut hits: Vec<(f64, Value)> = Vec::new();
    for m in list {
        let Some(a) = m.meta.get("analysis").filter(|a| a.is_object()) else { continue };
        if q.story.as_ref().is_some_and(|st| &m.story != st) {
            continue;
        }
        let segments = a["segments"].as_array().cloned().unwrap_or_default();
        // where in the file the tags hold: all of it, or some stretches
        let ranges: Option<Vec<(f64, f64)>> = if q.tags.is_empty() || matches_tags(&a["tags"], &q.tags) {
            None
        } else {
            let r: Vec<(f64, f64)> =
                segments.iter().filter(|g| matches_tags(&g["tags"], &q.tags)).map(|g| (g["s"].as_f64().unwrap_or(0.0), g["e"].as_f64().unwrap_or(0.0))).collect();
            if r.is_empty() {
                continue;
            }
            Some(r)
        };
        let within = |s: f64, e: f64| ranges.as_ref().is_none_or(|r| r.iter().any(|(a, b)| s < b + 0.01 && e > a - 0.01));
        let file_words: Vec<String> = [a["summary"]["line"].as_str(), a["summary"]["best_use"].as_str(), a["tags"]["location_note"].as_str()]
            .into_iter()
            .flatten()
            .flat_map(tokens)
            .chain(a["labels"].as_array().into_iter().flatten().filter_map(|l| l.as_str()).flat_map(|l| tokens(&l.replace([':', '/', '-'], " "))))
            .chain(tokens(&m.title))
            .chain(tokens(&m.description))
            .collect();
        let flags = a["tags"]["quality"].as_array().map(Vec::len).unwrap_or(0) as f64;
        let cues = a["cues"].as_array().cloned().unwrap_or_default();
        let problems: Vec<(f64, f64)> =
            cues.iter().filter(|c| c["kind"] == "problem").map(|c| (c["s"].as_f64().unwrap_or(0.0), c["e"].as_f64().unwrap_or(0.0))).collect();
        let score_words = |label: &[String], near: &[String]| -> f64 {
            want.iter().map(|w| if label.contains(w) { 3.0 } else if near.contains(w) { 2.0 } else if file_words.contains(w) { 1.0 } else { 0.0 }).sum()
        };
        let mut found_by_cue = false;
        let mut push = |kind: &str, c: &Value, score: f64| {
            let (s, e) = (c["s"].as_f64().unwrap_or(0.0), c["e"].as_f64().unwrap_or(0.0));
            let mut hit = json!({ "hash": m.hash, "name": m.original_name, "title": m.title, "story": m.story, "s": s, "e": e, "kind": kind,
                "label": c.get("label").or(c.get("line")), "score": (score * 100.0).round() / 100.0, "file_summary": a["summary"]["line"],
                "proxy": m.meta.get("proxy"), "thumbnail": m.meta.get("thumbnail") });
            for k in ["note", "why", "confidence", "take_of", "take", "rank", "best"] {
                if let Some(v) = c.get(k) {
                    hit[k] = v.clone();
                }
            }
            hits.push((score, with_tc(&m.meta, hit)));
        };
        for c in &cues {
            let kind = c["kind"].as_str().unwrap_or("");
            let wanted_kind = if q.kinds.is_empty() { kind != "problem" } else { q.kinds.iter().any(|k| k == kind) };
            let confidence = c["confidence"].as_f64().unwrap_or(0.5);
            let (s, e) = (c["s"].as_f64().unwrap_or(0.0), c["e"].as_f64().unwrap_or(0.0));
            if !wanted_kind || confidence < q.min_confidence || !within(s, e) {
                continue;
            }
            let label: Vec<String> = tokens(c["label"].as_str().unwrap_or("")).into_iter().chain(tokens(c["take_of"].as_str().unwrap_or(""))).collect();
            let near: Vec<String> = [c["note"].as_str(), c["why"].as_str()].into_iter().flatten().flat_map(tokens).chain(words_between(&m.meta, s, e)).collect();
            let w = score_words(&label, &near);
            if !want.is_empty() && w == 0.0 {
                continue;
            }
            let mut score = w + confidence;
            score += match kind {
                "highlight" => 1.5,
                "take" if c["best"] == true => 2.0,
                "take" => c["rank"].as_f64().map(|r| 1.0 / r.max(1.0)).unwrap_or(0.0),
                "problem" => -2.0,
                _ => 0.0,
            };
            if kind != "problem" && problems.iter().any(|(a, b)| s < *b && e > *a) {
                score -= 1.0;
            }
            score -= 0.5 * flags;
            found_by_cue |= w > 0.0 || want.is_empty();
            push(kind, c, score);
        }
        // the stretches themselves, where no cue answered the words (a b-roll shot with nothing marked in it)
        if !found_by_cue && q.kinds.is_empty() {
            for g in &segments {
                let (s, e) = (g["s"].as_f64().unwrap_or(0.0), g["e"].as_f64().unwrap_or(0.0));
                if !within(s, e) {
                    continue;
                }
                let label = tokens(g["line"].as_str().unwrap_or(""));
                let w = score_words(&label, &words_between(&m.meta, s, e));
                if !want.is_empty() && w == 0.0 {
                    continue;
                }
                push("segment", g, w + 0.3 - 0.5 * flags);
            }
        }
    }
    hits.sort_by(|a, b| b.0.total_cmp(&a.0));
    hits.into_iter().take(q.limit.max(1)).map(|(_, v)| v).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(hash: &str, story: &str, analysis: Value) -> Meta {
        Meta {
            hash: hash.into(),
            kind: "video".into(),
            original_name: format!("{hash}.MP4"),
            story: story.into(),
            meta: json!({ "analysis": analysis, "probe": { "timecode": "10:00:00:00", "timecode_fps": 25.0 },
                          "transcript": { "words": [{ "w": "Day", "s": 4.7, "e": 5.0 }, { "w": "twenty.", "s": 5.0, "e": 5.5 }] } }),
            ..Default::default()
        }
    }

    fn desk() -> Value {
        json!({
            "summary": { "line": "Samuel opens Day 20 at his desk.", "best_use": "The opener." },
            "tags": { "shot_size": "MCU", "scene": ["monologue to camera"], "quality": [], "location_note": "desk by a window" },
            "labels": ["shot_size:MCU", "scene:monologue to camera", "laptop"],
            "segments": [{ "s": 0.0, "e": 12.0, "tags": { "shot_size": "MCU" }, "line": "He speaks." }, { "s": 12.0, "e": 30.0, "tags": { "shot_size": "WS" }, "line": "He walks to the window." }],
            "cues": [
                { "s": 0.4, "e": 3.8, "kind": "take", "label": "opening line · take 1", "take_of": "opening line", "take": 1, "rank": 2, "confidence": 0.8 },
                { "s": 4.6, "e": 8.1, "kind": "take", "label": "opening line · take 2", "take_of": "opening line", "take": 2, "rank": 1, "best": true, "why": "clean", "confidence": 0.85 },
                { "s": 2.1, "e": 2.6, "kind": "problem", "label": "false start", "confidence": 0.9 },
                { "s": 14.0, "e": 16.0, "kind": "highlight", "label": "light through the window", "why": "golden", "confidence": 0.7 }
            ]
        })
    }

    #[test]
    fn the_best_take_comes_first() {
        let list = vec![file("a", "s1", desk())];
        let hits = find(&list, &Query { text: "opening line".into(), limit: 10, ..Default::default() });
        assert_eq!(hits[0]["take"], 2);
        assert_eq!(hits[0]["best"], true);
        assert_eq!(hits[0]["tc_in"], "10:00:04:15");
        // take 1 overlaps the false start: below
        assert_eq!(hits[1]["take"], 1);
        assert!(hits[0]["score"].as_f64() > hits[1]["score"].as_f64());
        // a word said in the range finds it too
        assert_eq!(find(&list, &Query { text: "twenty".into(), limit: 10, ..Default::default() })[0]["take"], 2);
        // problems only when asked for
        assert!(find(&list, &Query { limit: 50, ..Default::default() }).iter().all(|h| h["kind"] != "problem"));
        assert_eq!(find(&list, &Query { kinds: vec!["problem".into()], limit: 5, ..Default::default() })[0]["label"], "false start");
    }

    #[test]
    fn tags_narrow_to_the_stretches_that_have_them() {
        let list = vec![file("a", "s1", desk()), file("b", "s2", json!({ "tags": { "shot_size": "CU" }, "cues": [{ "s": 1.0, "e": 2.0, "kind": "action", "label": "hands", "confidence": 0.6 }], "segments": [] }))];
        // the desk file is MCU as a whole, WS only from 12 s: its highlight at 14 s is in a WS stretch
        let ws = find(&list, &Query { tags: vec![("shot_size".into(), vec!["ws".into()])], limit: 10, ..Default::default() });
        assert_eq!(ws.len(), 1);
        assert_eq!(ws[0]["kind"], "highlight");
        let close = find(&list, &Query { tags: vec![("shot_size".into(), vec!["CU".into(), "ECU".into()])], limit: 10, ..Default::default() });
        assert_eq!(close.len(), 1);
        assert_eq!(close[0]["hash"], "b");
        assert_eq!(find(&list, &Query { story: Some("s2".into()), limit: 10, ..Default::default() }).len(), 1);
        assert!(find(&list, &Query { text: "zebra".into(), limit: 10, ..Default::default() }).is_empty());
        // words only in the file's stretch line: the stretch itself
        let walk = find(&list, &Query { text: "walks".into(), limit: 10, ..Default::default() });
        assert_eq!(walk[0]["kind"], "segment");
        assert_eq!(walk[0]["s"], 12.0);
    }

    #[test]
    fn a_file_s_analysis_with_its_timecodes() {
        let m = file("a", "s1", desk());
        let v = view(&m, Some(10.0), None);
        assert_eq!(v["cues"].as_array().unwrap().len(), 1);
        assert_eq!(v["cues"][0]["tc_in"], "10:00:14:00");
        assert_eq!(v["segments"].as_array().unwrap().len(), 2);
        assert_eq!(v["summary"]["best_use"], "The opener.");
        let none = view(&Meta { hash: "x".into(), ..Default::default() }, None, None);
        assert!(none["analysis"].is_null());
        assert!(none["state"].as_str().unwrap().starts_with("not yet"));
        let s = summary(&desk());
        assert_eq!(s["takes"], 2);
        assert_eq!(s["highlights"], 1);
    }
}
