//! Prem's confidential Qwen, asked from this Mac — the request, the vocabulary and the validation of every answer,
//! ported from the API (api/src/analysis.ts, which the vault server called; its route may stay for now, nothing calls
//! it any more) with the same prompt, JSON schema and rules; and the client (api/src/prem.ts's model pick, breaker,
//! rate limit and classification of Prem's failures).
//!
//! Confidential means end-to-end encrypted to Prem's attested enclave: the frames and the words are sealed on this
//! Mac (XWing + XChaCha20-Poly1305), and neither Prem's gateway nor anyone on the way sees them. Only Prem's own SDK
//! speaks that protocol, so the Mac runs Prem's **confidential proxy** (the SDK's `confidential-proxy`, the same code
//! the API used in-process) on its own loopback — started here when nothing answers there, with Bun from
//! `~/.bun/bin` — and talks OpenAI's chat completions to it. There is no plain HTTPS route for Qwen 3.8 27B (vision):
//! Prem serves it confidentially only. No round trip through our server: Mac → local proxy → Prem.
//!
//! Its key: set once on this Mac (MCP `analysis_setup`, or the `analysis_setup` command), kept beside the app's session
//! in `~/Library/Application Support/city.maia.studio/analysis.json`, readable by this user only — not the Keychain
//! (every unsigned build made macOS ask again; auth.rs moved the session out for the same reason). PREMAI_API_KEY in
//! the environment is the fallback for a dev build.

use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{
        Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use serde::Deserialize;
use serde_json::{Map, Value, json};

/// Prem's confidential vision model: Qwen 3.8 27B (text, image, video) — docs.prem.io/models-and-pricing.
pub const MODEL: &str = "qwen38-27b";
/// Prem's SDK, whose `confidential-proxy` the Mac runs (the version the API pins).
pub const SDK: &str = "@premai/api-sdk@1.0.66";
/// Where the confidential proxy listens (its own default).
pub const DEFAULT_BASE: &str = "http://127.0.0.1:8787/v1";
/// Prem's gateway: only for asking about a model's attestation when a call failed on it.
pub const GATEWAY: &str = "https://gateway.prem.io";
/// Prem calls per minute at most (the API's limit for Qwen).
pub const PER_MINUTE: usize = 20;
pub const MIN_PAUSE: Duration = Duration::from_secs(60);
pub const MAX_PAUSE: Duration = Duration::from_secs(30 * 60);

// ── the settings: the key, the stories, where the proxy is ──

fn settings_file() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join("Library/Application Support/city.maia.studio/analysis.json")
}

fn settings() -> Map<String, Value> {
    std::fs::read(settings_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// Change the settings (Null: taken out); the file readable by this user only (it holds Prem's key).
pub fn set_settings(patch: &Map<String, Value>) -> Result<(), String> {
    let mut map = settings();
    for (k, v) in patch {
        if v.is_null() {
            map.remove(k);
        } else {
            map.insert(k.clone(), v.clone());
        }
    }
    let file = settings_file();
    std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = file.with_extension("part");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&map).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

/// Prem's key: set on this Mac, else PREMAI_API_KEY (a dev build).
pub fn key() -> Option<String> {
    settings()
        .get("prem_key")
        .and_then(|k| k.as_str())
        .map(String::from)
        .or_else(|| std::env::var("PREMAI_API_KEY").ok())
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
}

/// The stories whose files are analysed: ANALYSE_STORIES (story ids, comma separated; `*` every story), else what is
/// set on this Mac (an empty list: every story), else the Day 01 story. None: every story.
pub fn stories() -> Option<HashSet<String>> {
    let parse = |v: &str| -> Option<HashSet<String>> {
        let set: HashSet<String> = v.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect();
        (!set.is_empty() && !set.contains("*")).then_some(set)
    };
    if let Ok(v) = std::env::var("ANALYSE_STORIES") {
        return parse(&v);
    }
    match settings().get("stories") {
        Some(Value::Array(xs)) => parse(&xs.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(",")),
        Some(Value::String(s)) => parse(s),
        _ => Some(HashSet::from([super::plan::DAY_01.to_string()])),
    }
}

/// Where the confidential proxy answers (OpenAI's routes under it).
pub fn base() -> String {
    std::env::var("PREM_BASE")
        .ok()
        .or_else(|| settings().get("prem_base").and_then(|b| b.as_str()).map(String::from))
        .unwrap_or_else(|| DEFAULT_BASE.into())
        .trim_end_matches('/')
        .to_string()
}

/// What is set, for a person or an agent to see (never the key itself).
pub fn status() -> Value {
    let stories = stories().map(|s| s.into_iter().collect::<Vec<_>>());
    json!({ "prem_key": key().is_some(), "from_env": settings().get("prem_key").is_none() && key().is_some(), "stories": stories.map(Value::from).unwrap_or(json!("every story")),
            "base": base(), "model": MODEL, "vocabulary": vocab().version, "settings": settings_file().display().to_string() })
}

// ── the vocabulary (game/film/vocabulary.json), in its own order ──

/// A JSON object's entries in the order they are written (serde_json's map may sort them).
struct Ordered<T>(Vec<(String, T)>);
impl<'de, T: Deserialize<'de>> Deserialize<'de> for Ordered<T> {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V<T>(std::marker::PhantomData<T>);
        impl<'de, T: Deserialize<'de>> serde::de::Visitor<'de> for V<T> {
            type Value = Ordered<T>;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("an object")
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(self, mut m: A) -> Result<Ordered<T>, A::Error> {
                let mut out = Vec::new();
                while let Some((k, v)) = m.next_entry::<String, T>()? {
                    out.push((k, v));
                }
                Ok(Ordered(out))
            }
        }
        d.deserialize_map(V(std::marker::PhantomData))
    }
}

#[derive(Deserialize, Clone)]
pub struct Field {
    #[serde(rename = "type")]
    pub kind: String,
    pub values: Option<Vec<String>>,
    pub about: String,
}

#[derive(Deserialize)]
struct Free {
    about: String,
    max: usize,
    max_length: usize,
}

#[derive(Deserialize)]
struct Cues {
    about: String,
    kinds: Ordered<String>,
    labels: Ordered<Vec<String>>,
}

#[derive(Deserialize)]
struct RawVocab {
    version: u64,
    base: Ordered<Field>,
    free: Free,
    cues: Cues,
}

pub struct Vocab {
    pub version: u64,
    pub base: Vec<(String, Field)>,
    pub free_about: String,
    pub free_max: usize,
    pub free_max_length: usize,
    pub cues_about: String,
    pub kinds: Vec<(String, String)>,
    pub labels: Vec<(String, Vec<String>)>,
}

impl Vocab {
    fn field(&self, k: &str) -> Option<&Field> {
        self.base.iter().find(|(x, _)| x == k).map(|(_, f)| f)
    }
}

pub fn vocab() -> &'static Vocab {
    static V: OnceLock<Vocab> = OnceLock::new();
    V.get_or_init(|| {
        let r: RawVocab = serde_json::from_str(include_str!("../../../../game/film/vocabulary.json")).expect("game/film/vocabulary.json reads");
        Vocab {
            version: r.version,
            base: r.base.0,
            free_about: r.free.about,
            free_max: r.free.max,
            free_max_length: r.free.max_length,
            cues_about: r.cues.about,
            kinds: r.cues.kinds.0,
            labels: r.cues.labels.0,
        }
    })
}

// ── the vocabulary's words, as a model might write them ──

fn squash(x: &str) -> String {
    x.to_lowercase().chars().filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit()).collect()
}

/// Other ways of saying a base value, per field (squashed → the vocabulary's own).
fn alias(field: &str, k: &str) -> Option<&'static str> {
    Some(match (field, k) {
        ("shot_size", "extremewide" | "extremewideshot" | "ews") => "EWS",
        ("shot_size", "wide" | "wideshot" | "long" | "longshot") => "WS",
        ("shot_size", "full" | "fullshot") => "FS",
        ("shot_size", "medium" | "mediumshot") => "MS",
        ("shot_size", "mediumcloseup") => "MCU",
        ("shot_size", "closeup" | "close") => "CU",
        ("shot_size", "extremecloseup") => "ECU",
        ("shot_size", "detail" | "insertshot") => "insert",
        ("angle", "eyelevel") => "eye",
        ("angle", "highangle") => "high",
        ("angle", "lowangle") => "low",
        ("angle", "birdseye" | "birdseyeview" | "topdown") => "overhead",
        ("angle", "dutchangle") => "dutch",
        ("angle", "overtheshoulder") => "OTS",
        ("angle", "pointofview") => "POV",
        ("movement", "still" | "locked" | "lockedoff" | "tripod") => "static",
        ("movement", "steadicam" | "stabilized") => "gimbal",
        ("movement", "jib") => "crane",
        ("movement", "aerial") => "drone",
        ("movement", "push" | "pushin" | "pull" | "pullout" | "track" | "tracking" | "trucking") => "dolly",
        ("lens", "wideangle") => "wide",
        ("lens", "standard") => "normal",
        ("lens", "telephoto" | "long") => "tele",
        ("time_of_day", "daytime") => "day",
        ("time_of_day", "nighttime") => "night",
        ("time_of_day", "goldenhour" | "sunset" | "sunrise") => "golden hour",
        ("time_of_day", "bluehour" | "dusk" | "dawn") => "blue hour",
        ("location", "inside" | "indoor" | "indoors" | "int") => "interior",
        ("location", "outside" | "outdoor" | "outdoors" | "ext") => "exterior",
        ("scene", "monologue" | "piecetocamera" | "talkinghead") => "monologue to camera",
        ("scene", "broll") => "b-roll",
        ("scene", "establishingshot") => "establishing",
        ("scene", "screen" | "text" | "screenrecording") => "text/screen",
        ("quality", "outoffocus" | "soft" | "blurry") => "focus miss",
        ("quality", "blown" | "blownout") => "overexposed",
        ("quality", "dark") => "underexposed",
        ("quality", "shake") => "shaky",
        ("quality", "obstructed") => "blocked",
        ("quality", "clipping") => "audio clipping",
        _ => return None,
    })
}

fn cue_alias(k: &str) -> Option<&'static str> {
    Some(match k {
        "attempt" | "repeat" => "take",
        "cutpoint" | "edit" | "in" | "out" => "cut",
        "moment" | "best" => "highlight",
        "mistake" | "flub" | "falsestart" => "problem",
        "expression" | "mood" => "emotion",
        _ => return None,
    })
}

/// A value as the vocabulary writes it, or None.
pub fn canonical(field: &str, value: &Value) -> Option<String> {
    let f = vocab().field(field)?;
    let values = f.values.as_ref()?;
    let k = squash(value.as_str()?);
    values.iter().find(|v| squash(v) == k).cloned().or_else(|| alias(field, &k).map(String::from))
}

fn round3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

/// A string, its whitespace collapsed and trimmed, at most `max` characters ("" for anything else).
fn text(v: &Value, max: usize) -> String {
    match v.as_str() {
        Some(s) => s.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect(),
        None => String::new(),
    }
}

/// A number, or a string that is one.
fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64().filter(|x| x.is_finite()),
        Value::String(s) if !s.trim().is_empty() => s.trim().parse::<f64>().ok().filter(|x| x.is_finite()),
        _ => None,
    }
}

fn js(v: &Value) -> String {
    serde_json::to_string(v).unwrap_or_default()
}

fn whole(x: f64) -> Value {
    json!(x.round() as i64)
}

/// The base tags, each as the vocabulary allows; what it does not know goes into `errors`.
pub fn clean_tags(raw: &Value, errors: &mut Vec<String>) -> Map<String, Value> {
    let mut out = Map::new();
    let Some(o) = raw.as_object() else { return out };
    for (k, v) in o {
        let Some(f) = vocab().field(k) else {
            errors.push(format!("unknown tag {k}"));
            continue;
        };
        if v.is_null() || v.as_str() == Some("") {
            continue;
        }
        let values = || f.values.clone().unwrap_or_default().join(", ");
        match f.kind.as_str() {
            "one" => {
                let one = if let Value::Array(xs) = v { xs.first().cloned().unwrap_or(Value::Null) } else { v.clone() };
                match canonical(k, &one) {
                    Some(c) => {
                        out.insert(k.clone(), json!(c));
                    }
                    None => errors.push(format!("{k}: {} is not one of {}", js(v), values())),
                }
            }
            "many" => {
                let xs = if let Value::Array(xs) = v { xs.clone() } else { vec![v.clone()] };
                let mut vals: Vec<String> = Vec::new();
                for x in &xs {
                    match canonical(k, x) {
                        Some(c) if !vals.contains(&c) => vals.push(c),
                        Some(_) => {}
                        None => errors.push(format!("{k}: {} is not one of {}", js(x), values())),
                    }
                }
                out.insert(k.clone(), json!(vals));
            }
            "number" => match num(v).filter(|n| *n >= 0.0 && *n < 100_000.0) {
                Some(n) => {
                    out.insert(k.clone(), whole(n));
                }
                None => errors.push(format!("{k}: {} is not a number", js(v))),
            },
            "text" => {
                let t = text(v, 80);
                if !t.is_empty() {
                    out.insert(k.clone(), json!(t));
                }
            }
            _ => {
                let xs = if let Value::Array(xs) = v { xs.clone() } else { vec![v.clone()] };
                let mut names: Vec<String> = Vec::new();
                for x in &xs {
                    let t = text(x, 40);
                    if !t.is_empty() && !names.contains(&t) {
                        names.push(t);
                    }
                }
                names.truncate(8);
                out.insert(k.clone(), json!(names));
            }
        }
    }
    out
}

/// Free tags: lower case, short, each once.
pub fn clean_free(raw: &Value) -> Vec<String> {
    let v = vocab();
    let mut out: Vec<String> = Vec::new();
    for x in raw.as_array().into_iter().flatten() {
        let t = text(x, v.free_max_length).to_lowercase();
        if !t.is_empty() && !out.contains(&t) {
            out.push(t);
        }
    }
    out.truncate(v.free_max);
    out
}

/// Cues inside [from, to] (a little slack at the edges), in the vocabulary's kinds, in order.
pub fn clean_cues(raw: &Value, from: f64, to: f64, errors: &mut Vec<String>) -> Vec<Value> {
    let Some(list) = raw.as_array() else { return vec![] };
    let (lo, hi) = ((from - 0.5).max(0.0), to + 0.5);
    let mut out: Vec<Value> = Vec::new();
    for c in list {
        let Some(o) = c.as_object() else { continue };
        let k = o.get("kind").and_then(|k| k.as_str()).map(squash).unwrap_or_default();
        let kind = vocab().kinds.iter().find(|(x, _)| *x == k).map(|(x, _)| x.clone()).or_else(|| cue_alias(&k).map(String::from));
        let label = text(o.get("label").unwrap_or(&Value::Null), 80);
        let s = o.get("s").and_then(num);
        let (Some(kind), false, Some(mut s)) = (kind.clone(), label.is_empty(), s) else {
            let why = if kind.is_none() {
                format!("a known kind ({})", o.get("kind").map(js).unwrap_or_else(|| "undefined".into()))
            } else if label.is_empty() {
                "a label".into()
            } else {
                "a start".into()
            };
            errors.push(format!("a cue without {why} was dropped"));
            continue;
        };
        let mut e = o.get("e").and_then(num).unwrap_or(s);
        if e < s {
            std::mem::swap(&mut s, &mut e);
        }
        if e < lo || s > hi {
            errors.push(format!("a cue at {s}–{e} s lies outside the stretch {from}–{to} s"));
            continue;
        }
        let confidence = o.get("confidence").and_then(num).unwrap_or(0.5).clamp(0.0, 1.0);
        let mut cue = json!({ "s": round3(s.clamp(lo, hi)), "e": round3(e.clamp(lo, hi)), "kind": kind, "label": label, "confidence": confidence });
        let get = |k: &str, max: usize| text(o.get(k).unwrap_or(&Value::Null), max);
        let (note, why, take_of) = (get("note", 240), get("why", 240), get("take_of", 60));
        if !note.is_empty() {
            cue["note"] = json!(note);
        }
        if !why.is_empty() {
            cue["why"] = json!(why);
        }
        if kind == "take" && !take_of.is_empty() {
            cue["take_of"] = json!(take_of);
        }
        if let Some(t) = o.get("take").and_then(num).filter(|t| kind == "take" && *t >= 1.0) {
            cue["take"] = whole(t);
        }
        out.push(cue);
    }
    let at = |c: &Value, k: &str| c[k].as_f64().unwrap_or(0.0);
    out.sort_by(|a, b| at(a, "s").total_cmp(&at(b, "s")).then(at(a, "e").total_cmp(&at(b, "e"))));
    out
}

/// The model's text → its JSON: without a reasoning block or a code fence around it (Null: none).
pub fn parse_answer(content: &Value) -> Value {
    if content.is_object() {
        return content.clone();
    }
    let Some(t) = content.as_str() else { return Value::Null };
    // every <think>…</think> out
    let mut t = t.to_string();
    while let Some(a) = t.find("<think>") {
        let Some(b) = t[a..].find("</think>") else { break };
        t.replace_range(a..a + b + "</think>".len(), "");
    }
    let mut t = t.trim().to_string();
    if let Some(a) = t.find("```") {
        let rest = &t[a + 3..];
        if let Some(b) = rest.find("```") {
            let inner = &rest[..b];
            let inner = inner.strip_prefix("json").unwrap_or(inner);
            t = inner.trim().to_string();
        }
    }
    let (Some(a), Some(b)) = (t.find('{'), t.rfind('}')) else { return Value::Null };
    if b <= a {
        return Value::Null;
    }
    serde_json::from_str(&t[a..=b]).unwrap_or(Value::Null)
}

/// An answer checked: what the catalog keeps, what was dropped, and whether it cannot be used at all.
#[derive(Debug)]
pub struct Checked {
    pub value: Value,
    pub errors: Vec<String>,
    pub fatal: bool,
}

/// A stretch's answer, as the catalog keeps it: `{ tags, free, cues, summary, thumbnail: { index, why } | null }`.
pub fn validate_frames(raw: &Value, s: f64, e: f64, frames: usize) -> Checked {
    let mut errors = Vec::new();
    let Some(o) = raw.as_object() else {
        return Checked { value: json!({ "tags": {}, "free": [], "cues": [], "summary": "", "thumbnail": null }), errors: vec!["the answer is not a JSON object".into()], fatal: true };
    };
    let fatal = !o.get("tags").is_some_and(|t| t.is_object() || t.is_array()) && !o.get("cues").is_some_and(|c| c.is_array());
    if fatal {
        errors.push("the answer has neither tags nor cues".into());
    }
    let null = Value::Null;
    let th = o.get("thumbnail").unwrap_or(&null);
    let idx = th.get("index").and_then(num);
    let tags = clean_tags(o.get("tags").unwrap_or(&null), &mut errors);
    let cues = clean_cues(o.get("cues").unwrap_or(&null), s, e, &mut errors);
    let thumbnail = match idx {
        Some(i) if i >= 0.0 && i < frames as f64 => json!({ "index": i.round() as i64, "why": text(th.get("why").unwrap_or(&null), 200) }),
        _ => Value::Null,
    };
    let value = json!({ "tags": tags, "free": clean_free(o.get("free").unwrap_or(&null)), "cues": cues, "summary": text(o.get("summary").unwrap_or(&null), 300), "thumbnail": thumbnail });
    Checked { value, errors, fatal }
}

/// The file's answer: `{ tags, free, summary: { line, best_use }, takes, thumbnail: { t, why } | null }`.
pub fn validate_reduce(raw: &Value, seconds: f64) -> Checked {
    let mut errors = Vec::new();
    let null = Value::Null;
    let Some(o) = raw.as_object() else {
        let empty = json!({ "tags": {}, "free": [], "summary": { "line": "", "best_use": "" }, "takes": [], "thumbnail": null });
        return Checked { value: empty, errors: vec!["the answer is not a JSON object".into()], fatal: true };
    };
    let sum = match o.get("summary") {
        Some(v) if v.is_object() => v.clone(),
        other => json!({ "line": other.cloned().unwrap_or(Value::Null) }),
    };
    let line = text(&sum["line"], 300);
    if line.is_empty() {
        errors.push("the summary has no line".into());
    }
    let end = seconds.max(0.0) + 0.5;
    let mut takes: Vec<Value> = Vec::new();
    for g in o.get("takes").and_then(|t| t.as_array()).into_iter().flatten() {
        let Some(gg) = g.as_object() else { continue };
        let mut list: Vec<Value> = Vec::new();
        for t in gg.get("takes").and_then(|t| t.as_array()).into_iter().flatten() {
            let (Some(mut s), Some(mut e)) = (t.get("s").and_then(num), t.get("e").and_then(num)) else { continue };
            if e < s {
                std::mem::swap(&mut s, &mut e);
            }
            if s > end {
                continue;
            }
            let n = t.get("take").and_then(num).unwrap_or((list.len() + 1) as f64);
            let mut take = json!({ "s": round3(s.max(0.0)), "e": round3(e.min(end)), "take": n.round() as i64 });
            if let Some(r) = t.get("rank").and_then(num).filter(|r| *r >= 1.0) {
                take["rank"] = whole(r);
            }
            let note = text(t.get("note").unwrap_or(&null), 200);
            if !note.is_empty() {
                take["note"] = json!(note);
            }
            list.push(take);
        }
        // a take is one of at least two attempts
        if list.len() < 2 {
            continue;
        }
        list.sort_by(|a, b| a["s"].as_f64().unwrap_or(0.0).total_cmp(&b["s"].as_f64().unwrap_or(0.0)));
        let take_of = text(gg.get("take_of").unwrap_or(&null), 60);
        let mut group = json!({ "take_of": if take_of.is_empty() { "take".to_string() } else { take_of }, "takes": list });
        if let Some(best) = gg.get("best").and_then(num).map(|b| b.round() as i64) {
            if group["takes"].as_array().unwrap().iter().any(|t| t["take"].as_i64() == Some(best)) {
                group["best"] = json!(best);
            }
        }
        let why = text(gg.get("why").unwrap_or(&null), 240);
        if !why.is_empty() {
            group["why"] = json!(why);
        }
        takes.push(group);
    }
    let th = o.get("thumbnail").unwrap_or(&null);
    let thumbnail = match th.get("t").and_then(num) {
        Some(t) if t >= 0.0 && t <= end => json!({ "t": round3(t), "why": text(th.get("why").unwrap_or(&null), 200) }),
        _ => Value::Null,
    };
    let tags = clean_tags(o.get("tags").unwrap_or(&null), &mut errors);
    let fatal = line.is_empty() && o.get("tags").is_none_or(|t| t.is_null());
    let value = json!({ "tags": tags, "free": clean_free(o.get("free").unwrap_or(&null)), "summary": { "line": line, "best_use": text(&sum["best_use"], 300) }, "takes": takes, "thumbnail": thumbnail });
    Checked { value, errors, fatal }
}

// ── what the model is told ──

/// The vocabulary, as the model reads it.
pub fn vocabulary_text() -> String {
    let v = vocab();
    let base = v
        .base
        .iter()
        .map(|(k, f)| {
            let kind = match f.kind.as_str() {
                "one" => "one of",
                "many" => "a list of",
                "number" => "a number",
                "names" => "a list of names",
                _ => "a few words",
            };
            let values = f.values.as_ref().map(|vs| format!(": {}", vs.iter().map(|x| js(&json!(x))).collect::<Vec<_>>().join(", "))).unwrap_or_default();
            format!("- {k} ({kind}{values}) — {}", f.about)
        })
        .collect::<Vec<_>>()
        .join("\n");
    let kinds = v.kinds.iter().map(|(k, a)| format!("- {k}: {a}")).collect::<Vec<_>>().join("\n");
    let labels = v.labels.iter().map(|(k, ls)| format!("- {k}: {}", ls.join(", "))).collect::<Vec<_>>().join("\n");
    format!(
        "BASE TAGS (use exactly these keys and values; leave a tag out when it cannot be judged):\n{base}\n\nFREE TAGS: {} (at most {}).\n\nCUE KINDS ({}):\n{kinds}\n\nSuggested cue labels:\n{labels}",
        v.free_about, v.free_max, v.cues_about
    )
}

fn system() -> &'static str {
    static S: OnceLock<String> = OnceLock::new();
    S.get_or_init(|| {
        format!(
            "You are an experienced film editor's assistant logging footage for the edit. You see frames sampled from one camera file (each with its time in seconds of the file) and the words said in that stretch, with their times. Describe only what you can see and hear — never invent people, names or events. Times are seconds of the file; a cue lies inside the stretch you are shown. Answer with one JSON object only, no prose around it.\n\n{}",
            vocabulary_text()
        )
    })
}

fn schema_tags() -> Value {
    let props: Map<String, Value> = vocab()
        .base
        .iter()
        .map(|(k, f)| {
            let v = match f.kind.as_str() {
                "one" => json!({ "type": "string", "enum": f.values }),
                "many" => json!({ "type": "array", "items": { "type": "string", "enum": f.values } }),
                "number" => json!({ "type": "number" }),
                "names" => json!({ "type": "array", "items": { "type": "string" } }),
                _ => json!({ "type": "string" }),
            };
            (k.clone(), v)
        })
        .collect();
    json!({ "type": "object", "properties": props, "additionalProperties": false })
}

/// The JSON schemas the model answers in (Prem's response_format json_schema), and their keys in order.
pub fn schema(which: &str) -> Value {
    let kinds: Vec<&str> = vocab().kinds.iter().map(|(k, _)| k.as_str()).collect();
    let cue = json!({
        "type": "object",
        "properties": { "s": { "type": "number" }, "e": { "type": "number" }, "kind": { "type": "string", "enum": kinds }, "label": { "type": "string" }, "confidence": { "type": "number" }, "note": { "type": "string" }, "why": { "type": "string" }, "take_of": { "type": "string" }, "take": { "type": "integer" } },
        "required": ["s", "e", "kind", "label", "confidence"],
    });
    if which == "frames" {
        json!({
            "type": "object",
            "properties": {
                "tags": schema_tags(),
                "free": { "type": "array", "items": { "type": "string" } },
                "cues": { "type": "array", "items": cue },
                "summary": { "type": "string" },
                "thumbnail": { "type": "object", "properties": { "index": { "type": "integer" }, "why": { "type": "string" } }, "required": ["index", "why"] },
            },
            "required": ["tags", "free", "cues", "summary", "thumbnail"],
        })
    } else {
        json!({
            "type": "object",
            "properties": {
                "tags": schema_tags(),
                "free": { "type": "array", "items": { "type": "string" } },
                "summary": { "type": "object", "properties": { "line": { "type": "string" }, "best_use": { "type": "string" } }, "required": ["line", "best_use"] },
                "takes": { "type": "array", "items": { "type": "object", "properties": {
                    "take_of": { "type": "string" }, "best": { "type": "integer" }, "why": { "type": "string" },
                    "takes": { "type": "array", "items": { "type": "object", "properties": { "s": { "type": "number" }, "e": { "type": "number" }, "take": { "type": "integer" }, "rank": { "type": "integer" }, "note": { "type": "string" } }, "required": ["s", "e", "take", "rank"] } },
                }, "required": ["take_of", "best", "takes"] } },
                "thumbnail": { "type": "object", "properties": { "t": { "type": "number" }, "why": { "type": "string" } }, "required": ["t", "why"] },
            },
            "required": ["tags", "free", "summary", "takes", "thumbnail"],
        })
    }
}

fn schema_keys(which: &str) -> &'static str {
    if which == "frames" { "tags, free, cues, summary, thumbnail" } else { "tags, free, summary, takes, thumbnail" }
}

fn clock(s: f64) -> String {
    format!("{s:.1} s")
}

/// A JSON value as a JS template writes it (a string without its quotes).
fn raw(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn said(words: &[Value]) -> String {
    let lines: Vec<String> = words
        .iter()
        .filter(|u| u["text"].is_string())
        .map(|u| {
            let sp = u.get("sp").map(|sp| format!(" speaker {}:", raw(sp))).unwrap_or_default();
            format!("[{}–{}]{sp} {}", clock(u["s"].as_f64().unwrap_or(f64::NAN)), clock(u["e"].as_f64().unwrap_or(f64::NAN)), raw(&u["text"]))
        })
        .collect();
    if lines.is_empty() { "(nothing is said)".into() } else { lines.join("\n") }
}

/// "File: C0042.MP4 · a 30.0 s camera file · described as: …"
fn file_line(f: &Value) -> String {
    let name = f["name"].as_str().filter(|n| !n.is_empty()).unwrap_or("unnamed");
    let title = f["title"].as_str().filter(|t| !t.is_empty() && Some(*t) != f["name"].as_str()).map(|t| format!(" (\"{t}\")")).unwrap_or_default();
    let what = if f["kind"] == "image" { "a still".to_string() } else { format!("a {} camera file", clock(f["seconds"].as_f64().unwrap_or(0.0))) };
    let described = f["description"].as_str().filter(|d| !d.is_empty()).map(|d| format!(" · described as: {d}")).unwrap_or_default();
    format!("File: {name}{title} · {what}{described}")
}

/// One stretch of frames to ask about: the file, where the stretch is (start, end, index, of), its frames (time, JPEG
/// in base64), the words said in it, and what the stretch before showed.
pub struct Stretch<'a> {
    pub file: &'a Value,
    pub s: f64,
    pub e: f64,
    pub index: usize,
    pub of: usize,
    pub frames: &'a [(f64, String)],
    pub words: &'a [Value],
    pub before: &'a Value,
}

/// The request for one stretch: the task, the words, and every frame with its time.
pub fn frames_messages(b: &Stretch) -> Value {
    let still = b.file["kind"] == "image";
    let task = if still {
        "This is a still picture. Tag it (base tags, free tags), say in one sentence what it shows (summary), and add cues only if they help an editor (e.g. a highlight, a problem) with s = e = 0. thumbnail.index is 0.".to_string()
    } else {
        let before = b.before.as_str().filter(|x| !x.is_empty()).map(|x| format!(" The stretch before showed: {x}")).unwrap_or_default();
        format!(
            "This is stretch {} of {}: {} to {} of the file.{before}\nTag the stretch as most of it looks (base tags, free tags). Mark cues in it: every repeated attempt of the same action as a take (with take_of naming the action and take numbering them as you see them), actions, the actor's emotions (from face and words), good cut points (an action starting or ending, a look, a breath or pause between sentences — from the word times), transition opportunities, highlights (with why), and problems (flubs, false starts, someone walking in). Summary: one sentence of what this stretch shows. thumbnail: the index (0-based, in the order shown) of the frame that best represents this stretch — sharp, well exposed, a face or the subject clearly seen — and why.",
            b.index + 1,
            b.of,
            clock(b.s),
            clock(b.e)
        )
    };
    let mut content = vec![json!({ "type": "text", "text": format!("{}\n\n{task}\n\nWords said in this stretch (times in seconds of the file):\n{}\n\nThe frames:", file_line(b.file), said(b.words)) })];
    for (i, (t, jpeg)) in b.frames.iter().enumerate() {
        content.push(json!({ "type": "text", "text": format!("Frame {i} at {}", clock(*t)) }));
        content.push(json!({ "type": "image_url", "image_url": { "url": format!("data:image/jpeg;base64,{jpeg}") } }));
    }
    json!([{ "role": "system", "content": system() }, { "role": "user", "content": content }])
}

/// The request for the whole file: every stretch's answer (text only) and the words.
pub fn reduce_messages(file: &Value, stretches: &Value, said_text: &str) -> Value {
    let task = "Here is what each stretch of the file shows, as logged from its frames. Now for the whole file:
- tags: the base tags as most of the file looks; free: the free tags that matter most.
- summary.line: one sentence of what the file shows; summary.best_use: one sentence of where it serves an edit best.
- takes: when the camera kept rolling while the same action was done again and again, group those attempts (look across stretches: similar actions, similar words), give each attempt its in (s) and out (e), number them in order (take), rank them (1 = best) and name the best one with why (a clean performance, no flub, the best look, the best light). Only actions attempted at least twice. An empty list when there are none.
- thumbnail: the time t of the frame that best represents the whole file (one of the stretches' thumbnail picks), and why.";
    let everything = if said_text.is_empty() { "(nothing is said)" } else { said_text };
    let content = format!("{}\n\n{task}\n\nThe stretches:\n{}\n\nEverything said in the file:\n{everything}", file_line(file), js(stretches));
    json!([{ "role": "system", "content": system() }, { "role": "user", "content": content }])
}

// ── asking Prem ──

/// Why an answer did not come: not the file's fault (no key, the proxy not up, Prem paused — it waits, queued, and
/// no try is used up; `until` when a pause ends), or the file's own failure.
#[derive(Debug, Clone, PartialEq)]
pub enum Ask {
    Wait { reason: String, until: Option<Instant> },
    Fail(String),
}

impl std::fmt::Display for Ask {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Ask::Wait { reason, .. } => f.write_str(reason),
            Ask::Fail(e) => f.write_str(e),
        }
    }
}

fn wait(reason: impl Into<String>) -> Ask {
    Ask::Wait { reason: reason.into(), until: None }
}

/// A breaker for the model: after a failure that is Prem's, it is paused (1 min, doubling to 30) and asked nothing.
#[derive(Default)]
struct Breaker {
    until: Option<Instant>,
    reason: String,
    pause: Duration,
}

pub struct Prem {
    http: reqwest::Client,
    breaker: Mutex<Breaker>,
    recent: Mutex<Vec<Instant>>,
    /// does Prem take our JSON schema? (learnt from its first refusal; then json_object)
    schema_taken: AtomicBool,
    model: Mutex<Option<String>>,
    proxy: tokio::sync::Mutex<Option<tokio::process::Child>>,
}

pub fn prem() -> &'static Prem {
    static P: OnceLock<Prem> = OnceLock::new();
    P.get_or_init(|| Prem {
        http: reqwest::Client::builder().connect_timeout(Duration::from_secs(5)).build().unwrap_or_default(),
        breaker: Mutex::new(Breaker::default()),
        recent: Mutex::new(Vec::new()),
        schema_taken: AtomicBool::new(true),
        model: Mutex::new(None),
        proxy: tokio::sync::Mutex::new(None),
    })
}

/// A Prem failure (the proxy's `{ error: { message } }`, its status) → what it means for the file.
pub enum Class {
    /// the file's own (a try used up)
    Own(String),
    /// Prem's for now: the model pauses, the file waits
    Transient(String),
    /// our key or the setup: the file waits, nothing is asked until a person looks
    Setup(String),
    /// an attestation problem: the gateway is asked what it is
    Attestation(String),
    /// Prem refused our JSON schema: json_object from now on
    Schema,
}

pub fn classify(status: u16, why: &str, schema_taken: bool) -> Class {
    let why: String = why.chars().take(300).collect();
    let lower = why.to_lowercase();
    if status == 400 && schema_taken && (lower.contains("response_format") || lower.contains("json_schema") || lower.contains("schema")) {
        return Class::Schema;
    }
    match status {
        413 => Class::Own(format!("Prem refused it as too large: {why}")),
        429 => Class::Transient(format!("Prem is rate limiting: {why}")),
        401 | 403 => Class::Setup(format!("Prem refused the key set on this Mac ({status}): {why}")),
        _ if lower.contains("attestation") || lower.contains("reticle") || lower.contains("x-session-id") => Class::Attestation(why),
        s if s >= 500 => Class::Transient(format!("Prem could not analyse this right now ({s}): {why}")),
        s => Class::Own(format!("Prem could not analyse this ({s}): {why}")),
    }
}

/// The gateway's answer about a model's attestation: (status, message, deployed) — None when all is well.
async fn gateway_probe(http: &reqwest::Client, key: &str, model: &str) -> Option<(u16, String, bool)> {
    let gw = std::env::var("PREMAI_PROXY_URL").unwrap_or_else(|_| GATEWAY.into());
    let res = http.get(format!("{}/attestation/modules?model={model}", gw.trim_end_matches('/'))).bearer_auth(key).timeout(Duration::from_secs(10)).send().await;
    let res = match res {
        Ok(r) => r,
        Err(e) => return Some((0, format!("the gateway cannot be reached from this Mac ({})", e.to_string().chars().take(120).collect::<String>()), true)),
    };
    let status = res.status().as_u16();
    let body = res.text().await.unwrap_or_default();
    let body = if body.trim_start().starts_with('<') { String::new() } else { body.split_whitespace().collect::<Vec<_>>().join(" ") };
    let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    let deployed = status != 404 && !v["data"].as_array().is_some_and(|d| d.is_empty());
    let ok = (200..300).contains(&status);
    if ok && deployed {
        return None;
    }
    let message = if ok {
        String::new()
    } else if v.is_object() {
        format!("{}{}", v["error"].as_str().or(v["message"].as_str()).unwrap_or(""), v["support_id"].as_str().map(|s| format!(" ({s})")).unwrap_or_default()).trim().to_string()
    } else {
        body.chars().take(160).collect()
    };
    Some((status, message, deployed))
}

/// Where Bun is (Prem's proxy runs on it): BUN, else ~/.bun/bin/bun.
fn bun() -> Option<PathBuf> {
    if let Some(b) = std::env::var_os("BUN").map(PathBuf::from).filter(|p| p.exists()) {
        return Some(b);
    }
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    Some(home.join(".bun/bin/bun")).filter(|p| p.exists())
}

impl Prem {
    /// Is the proxy answering? Started here when it is ours to start (the default address) and nothing answers.
    async fn proxy_up(&self) -> Result<(), Ask> {
        let base = base();
        let root = base.trim_end_matches("/v1").to_string();
        let answers = || async { self.http.get(format!("{root}/")).timeout(Duration::from_secs(3)).send().await.is_ok() };
        if answers().await {
            return Ok(());
        }
        if base != DEFAULT_BASE {
            return Err(wait(format!("Prem's confidential proxy does not answer at {base}")));
        }
        let mut child = self.proxy.lock().await;
        if let Some(c) = child.as_mut() {
            if c.try_wait().ok().flatten().is_none() {
                // started, not up yet: give it the time it takes
                for _ in 0..60 {
                    if answers().await {
                        return Ok(());
                    }
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
                return Err(wait("Prem's confidential proxy started on this Mac but does not answer yet"));
            }
        }
        let Some(bun) = bun() else {
            return Err(wait("Prem's confidential proxy needs Bun on this Mac (~/.bun/bin/bun) — or set PREM_BASE to a proxy that runs"));
        };
        let log = settings_file().with_file_name("prem-proxy.log");
        let out = std::fs::OpenOptions::new().create(true).append(true).open(&log).map_err(|e| wait(format!("the proxy's log {}: {e}", log.display())))?;
        let err = out.try_clone().map_err(|e| wait(e.to_string()))?;
        let path = format!("{}:/usr/bin:/bin", bun.parent().map(|p| p.display().to_string()).unwrap_or_default());
        let mut cmd = tokio::process::Command::new(&bun);
        // no --kek: the proxy makes a key encryption key of its own at every start (chat completions keep no files)
        cmd.args(["x", "--bun", "-p", SDK, "confidential-proxy", "--compat", "openai", "--host", "127.0.0.1", "--port", "8787", "--json-body-limit", "64mb"])
            .env("PATH", path)
            .stdin(std::process::Stdio::null())
            .stdout(out)
            .stderr(err)
            .kill_on_drop(true);
        for (ours, theirs) in [("PREMAI_PROXY_URL", "PROXY_URL"), ("PREMAI_ENCLAVE_URL", "ENCLAVE_URL")] {
            if let Ok(v) = std::env::var(ours) {
                cmd.env(theirs, v);
            }
        }
        let c = cmd.spawn().map_err(|e| wait(format!("Prem's confidential proxy does not start: {e}")))?;
        tracing::info!("analysis: Prem's confidential proxy started on this Mac ({SDK}, log {})", log.display());
        *child = Some(c);
        // the first start fetches the SDK: a minute at most
        for _ in 0..90 {
            if answers().await {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        Err(wait(format!("Prem's confidential proxy does not answer yet (its log: {})", log.display())))
    }

    /// Is Prem set up and not paused? (No: why the files wait.)
    pub async fn ready(&self) -> Result<(), Ask> {
        if key().is_none() {
            return Err(wait("no Prem key on this Mac yet — set it once (MCP analysis_setup)"));
        }
        self.paused()?;
        self.proxy_up().await
    }

    fn paused(&self) -> Result<(), Ask> {
        let b = self.breaker.lock().unwrap();
        match b.until {
            Some(u) if u > Instant::now() => Err(Ask::Wait { reason: b.reason.clone(), until: Some(u) }),
            _ => Ok(()),
        }
    }

    fn trip(&self, reason: &str) -> Ask {
        let mut b = self.breaker.lock().unwrap();
        let pause = if b.pause.is_zero() { MIN_PAUSE } else { (b.pause * 2).min(MAX_PAUSE) };
        let until = Instant::now() + pause;
        *b = Breaker { until: Some(until), reason: reason.to_string(), pause };
        tracing::warn!("analysis: {MODEL} paused for {} s — {reason}", pause.as_secs());
        Ask::Wait { reason: reason.to_string(), until: Some(until) }
    }

    /// At most PER_MINUTE calls a minute: wait for a slot.
    async fn slot(&self) {
        loop {
            let wait = {
                let mut r = self.recent.lock().unwrap();
                let now = Instant::now();
                r.retain(|t| now.duration_since(*t) < Duration::from_secs(60));
                if r.len() < PER_MINUTE {
                    r.push(now);
                    None
                } else {
                    Some(Duration::from_secs(60) - now.duration_since(r[0]))
                }
            };
            match wait {
                None => return,
                Some(w) => tokio::time::sleep(w + Duration::from_millis(200)).await,
            }
        }
    }

    /// The confidential Qwen this key lists (the one we name, unless Prem renamed it) — asked once.
    async fn model(&self) -> String {
        if let Some(m) = self.model.lock().unwrap().clone() {
            return m;
        }
        let Some(key) = key() else { return MODEL.into() };
        let res = self.http.get(format!("{}/models?type=CHAT", base())).bearer_auth(&key).timeout(Duration::from_secs(60)).send().await;
        let list: Option<Vec<String>> = match res {
            Ok(r) if r.status().is_success() => r.json::<Value>().await.ok().map(|v| v["data"].as_array().into_iter().flatten().filter_map(|m| m["id"].as_str().map(String::from)).collect()),
            _ => None,
        };
        let Some(list) = list else { return MODEL.into() };
        let picked = list
            .iter()
            .find(|m| m.eq_ignore_ascii_case(MODEL))
            .or_else(|| list.iter().find(|m| m.to_lowercase().starts_with("qwen")))
            .cloned()
            .unwrap_or_else(|| MODEL.into());
        if picked != MODEL {
            tracing::warn!("analysis: this Prem key lists no {MODEL} — using {picked}");
        }
        tracing::info!("analysis: Prem models for this key — {}", list.join(", "));
        *self.model.lock().unwrap() = Some(picked.clone());
        picked
    }

    /// One completion: the model's text. The schema where Prem takes it, else json_object.
    async fn complete(&self, messages: &Value, which: &str, model: &str) -> Result<String, Ask> {
        let key = key().ok_or_else(|| wait("no Prem key on this Mac yet — set it once (MCP analysis_setup)"))?;
        for _ in 0..3 {
            self.paused()?;
            self.slot().await;
            let format = if self.schema_taken.load(Ordering::Relaxed) {
                json!({ "type": "json_schema", "json_schema": { "name": format!("shot_{which}"), "schema": schema(which), "strict": false } })
            } else {
                json!({ "type": "json_object" })
            };
            let body = json!({ "model": model, "messages": messages, "temperature": 0.2, "reasoning_effort": "low", "max_completion_tokens": 6000, "response_format": format });
            let res = self.http.post(format!("{}/chat/completions", base())).bearer_auth(&key).timeout(Duration::from_secs(15 * 60)).json(&body).send().await;
            let res = match res {
                Ok(r) => r,
                Err(e) if e.is_connect() => {
                    // the proxy went away: up again, then once more
                    self.proxy_up().await?;
                    continue;
                }
                Err(e) if e.is_timeout() => return Err(self.trip(&format!("Prem did not answer within 15 minutes ({e})"))),
                Err(e) => return Err(self.trip(&format!("Prem could not be reached: {e}"))),
            };
            let status = res.status().as_u16();
            let text = res.text().await.unwrap_or_default();
            let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            if (200..300).contains(&status) {
                self.breaker.lock().unwrap().pause = Duration::ZERO;
                self.breaker.lock().unwrap().until = None;
                let content = v["choices"][0]["message"]["content"].as_str().unwrap_or("");
                if content.trim().is_empty() {
                    return Err(Ask::Fail("The model answered nothing.".into()));
                }
                return Ok(content.to_string());
            }
            let why = v["error"]["message"].as_str().or(v["error"].as_str()).map(String::from).unwrap_or_else(|| text.chars().take(300).collect());
            match classify(status, &why, self.schema_taken.load(Ordering::Relaxed)) {
                Class::Schema => {
                    self.schema_taken.store(false, Ordering::Relaxed);
                    continue;
                }
                Class::Own(e) => return Err(Ask::Fail(e)),
                Class::Transient(e) => return Err(self.trip(&e)),
                Class::Setup(e) => return Err(self.trip(&e)),
                Class::Attestation(why) => {
                    let said = |s: u16, m: &str| format!("gateway {}{}", if s == 0 { "unreachable".into() } else { s.to_string() }, if m.is_empty() { String::new() } else { format!(": {m}") });
                    return Err(match gateway_probe(&self.http, &key, model).await {
                        None => Ask::Fail(format!("Prem's attestation of {model} failed verification: {why}")),
                        Some((_, _, false)) => self.trip(&format!("{model} is not enabled for confidential use on our Prem key")),
                        Some((s, m, _)) if s >= 500 || s == 0 || s == 429 => self.trip(&format!("Prem's attestation report for {model} is unavailable right now ({}) — retrying", said(s, &m))),
                        Some((s, m, _)) if s == 401 || s == 403 => self.trip(&format!("Prem refused our key for {model}'s attestation ({})", said(s, &m))),
                        Some((s, m, _)) => Ask::Fail(format!("Prem's attestation of {model} was refused ({})", said(s, &m))),
                    });
                }
            }
        }
        Err(Ask::Fail("Prem's proxy went away twice during one request".into()))
    }

    /// Ask, validate; an answer that cannot be used is sent back once to be repaired (text only). The answer as the
    /// catalog keeps it, with `model` and `vocabulary`.
    async fn answer(&self, messages: Value, which: &str, check: impl Fn(&Value) -> Checked) -> Result<Value, Ask> {
        let m = self.model().await;
        let first = self.complete(&messages, which, &m).await?;
        let a = check(&parse_answer(&json!(first)));
        let done = |mut v: Value| {
            v["model"] = json!(m);
            v["vocabulary"] = json!(vocab().version);
            v
        };
        if !a.fatal {
            return Ok(done(a.value));
        }
        let head: String = first.chars().take(12000).collect();
        let repair = json!([messages[0].clone(), { "role": "user", "content": format!(
            "Your answer could not be used ({}). Your answer was:\n{head}\n\nAnswer again: one JSON object with the keys {}, in the vocabulary, nothing else.",
            a.errors.iter().take(5).cloned().collect::<Vec<_>>().join("; "), schema_keys(which)) }]);
        let b = check(&parse_answer(&json!(self.complete(&repair, which, &m).await?)));
        if b.fatal {
            return Err(Ask::Fail(format!("The model's answer could not be used, twice: {}", b.errors.iter().take(3).cloned().collect::<Vec<_>>().join("; "))));
        }
        Ok(done(b.value))
    }

    /// One stretch of frames → its tags, cues, summary and thumbnail pick.
    pub async fn frames(&self, st: &Stretch<'_>) -> Result<Value, Ask> {
        if st.frames.is_empty() {
            return Err(Ask::Fail("No frames in the request.".into()));
        }
        let (s, e, n) = (st.s, st.e, st.frames.len());
        self.answer(frames_messages(st), "frames", move |raw| validate_frames(raw, s, e, n)).await
    }

    /// Every stretch's answer → the file's tags, summary, takes and thumbnail.
    pub async fn reduce(&self, file: &Value, stretches: &Value, said_text: &str) -> Result<Value, Ask> {
        let seconds = file["seconds"].as_f64().unwrap_or(0.0);
        self.answer(reduce_messages(file, stretches, said_text), "reduce", move |raw| validate_reduce(raw, seconds)).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Value {
        let text = match name {
            "frames" => include_str!("../../../../api/test/fixtures/qwen-frames.json"),
            _ => include_str!("../../../../api/test/fixtures/qwen-reduce.json"),
        };
        let v: Value = serde_json::from_str(text).unwrap();
        v["choices"][0]["message"]["content"].clone()
    }

    #[test]
    fn the_vocabulary_and_the_ways_a_model_says_it() {
        assert_eq!(canonical("shot_size", &json!("medium close-up")).as_deref(), Some("MCU"));
        assert_eq!(canonical("shot_size", &json!("CU")).as_deref(), Some("CU"));
        assert_eq!(canonical("angle", &json!("Over the shoulder")).as_deref(), Some("OTS"));
        assert_eq!(canonical("movement", &json!("Steadicam")).as_deref(), Some("gimbal"));
        assert_eq!(canonical("scene", &json!("B-roll")).as_deref(), Some("b-roll"));
        assert_eq!(canonical("shot_size", &json!("gigantic")), None);
        // the prompt carries every base tag and every cue kind, in the vocabulary's order
        let t = vocabulary_text();
        for (k, _) in &vocab().base {
            assert!(t.contains(&format!("- {k} (")), "{k}");
        }
        for (k, _) in &vocab().kinds {
            assert!(t.contains(&format!("- {k}: ")), "{k}");
        }
        assert!(t.find("- shot_size (").unwrap() < t.find("- quality (").unwrap());
        assert!(t.contains("- shot_size (one of: \"EWS\", \"WS\""));
        // and the schema is the vocabulary's
        let s = schema("frames");
        assert_eq!(s["properties"]["tags"]["properties"]["shot_size"]["enum"], json!(["EWS", "WS", "FS", "MS", "MCU", "CU", "ECU", "insert"]));
        assert_eq!(s["required"], json!(["tags", "free", "cues", "summary", "thumbnail"]));
        assert_eq!(schema("reduce")["required"], json!(["tags", "free", "summary", "takes", "thumbnail"]));
        assert!(system().contains("shot_size (one of"));
    }

    #[test]
    fn a_stretch_s_answer_values_in_the_vocabulary_cues_in_the_stretch() {
        let raw = parse_answer(&fixture("frames"));
        let Checked { value, errors, fatal } = validate_frames(&raw, 0.0, 12.0, 12);
        assert!(!fatal);
        let tags = &value["tags"];
        assert_eq!(tags["shot_size"], "MCU");
        assert_eq!(tags["angle"], "eye");
        assert_eq!(tags["movement"], json!(["handheld"]));
        assert_eq!(tags["focal_mm"], 35);
        assert_eq!(tags["people"], 1);
        assert_eq!(tags["who"], json!(["Samuel"]));
        assert_eq!(tags["scene"], json!(["monologue to camera"]));
        assert_eq!(tags["quality"], json!([]));
        assert_eq!(tags["location_note"], "a desk by a window, two screens");
        assert!(tags.get("mood").is_none());
        assert_eq!(value["free"], json!(["laptop", "window light", "coffee cup"]));
        let kinds: Vec<&str> = value["cues"].as_array().unwrap().iter().map(|c| c["kind"].as_str().unwrap()).collect();
        assert_eq!(kinds, ["take", "problem", "cut", "take", "emotion", "highlight"]);
        assert_eq!(value["cues"][0], json!({ "s": 0.4, "e": 3.8, "kind": "take", "label": "opening line", "confidence": 0.8, "note": "stumbles on 'twenty'", "take_of": "opening line", "take": 1 }));
        assert_eq!(value["cues"].as_array().unwrap().iter().find(|c| c["kind"] == "highlight").unwrap()["why"], "the most alive moment");
        assert_eq!(value["thumbnail"], json!({ "index": 7, "why": "his face lit by the window, eyes to the lens" }));
        // what was dropped is said
        assert!(errors.iter().any(|e| e.contains("slow push")));
        assert!(errors.iter().any(|e| e.contains("unknown tag mood")));
        assert!(errors.iter().any(|e| e.contains("outside the stretch")));
        assert!(errors.iter().any(|e| e.contains("\"vibe\"")));
    }

    #[test]
    fn cues_clamped_turned_round_and_bounded() {
        let mut errs = Vec::new();
        let c = clean_cues(&json!([{ "s": 13, "e": 11.9, "kind": "Action", "label": " stands up ", "confidence": 3 }, { "s": 20, "e": 21, "kind": "action", "label": "far" }]), 0.0, 12.0, &mut errs);
        assert_eq!(c, vec![json!({ "s": 11.9, "e": 12.5, "kind": "action", "label": "stands up", "confidence": 1.0 })]);
        assert_eq!(errs.len(), 1);
    }

    #[test]
    fn the_file_s_answer_takes_of_at_least_two_attempts() {
        let Checked { value, fatal, .. } = validate_reduce(&parse_answer(&fixture("reduce")), 30.0);
        assert!(!fatal);
        assert_eq!(value["summary"], json!({ "line": "Samuel opens Day 20 at his desk, in two takes.", "best_use": "The film's opener: take 2, from the breath." }));
        assert_eq!(value["takes"].as_array().unwrap().len(), 1);
        assert_eq!(value["takes"][0]["take_of"], "opening line");
        assert_eq!(value["takes"][0]["best"], 2);
        assert_eq!(value["takes"][0]["why"], "no stumble, a smile at the end");
        assert_eq!(value["takes"][0]["takes"][0], json!({ "s": 0.4, "e": 3.8, "take": 1, "rank": 2, "note": "stumbles" }));
        assert_eq!(value["thumbnail"], json!({ "t": 7.5, "why": "his face lit by the window" }));
        assert_eq!(value["tags"], json!({ "shot_size": "MCU", "scene": ["monologue to camera"], "people": 1 }));
    }

    #[test]
    fn what_is_not_json_is_fatal_a_fence_or_reasoning_is_not() {
        assert_eq!(parse_answer(&json!("I cannot see the frames.")), Value::Null);
        assert_eq!(parse_answer(&json!("<think>hm</think>\n```json\n{\"a\":1}\n```")), json!({ "a": 1 }));
        assert!(validate_frames(&Value::Null, 0.0, 1.0, 1).fatal);
        assert!(validate_frames(&json!({ "summary": "only words" }), 0.0, 1.0, 1).fatal);
    }

    #[test]
    fn a_stretch_goes_as_frames_with_their_times_and_the_words() {
        let file = json!({ "name": "C0042.MP4", "kind": "video", "seconds": 30 });
        let frames: Vec<(f64, String)> = (0..12).map(|i| (i as f64, "/9j/4AAQ".to_string())).collect();
        let words = [json!({ "s": 0.4, "e": 3.8, "text": "Day twenty. The city starts with one street." })];
        let m = frames_messages(&Stretch { file: &file, s: 0.0, e: 12.0, index: 0, of: 3, frames: &frames, words: &words, before: &Value::Null });
        let parts = m[1]["content"].as_array().unwrap();
        assert_eq!(parts.iter().filter(|p| p["type"] == "image_url").count(), 12);
        assert_eq!(parts[2]["image_url"]["url"], "data:image/jpeg;base64,/9j/4AAQ");
        assert_eq!(parts[1]["text"], "Frame 0 at 0.0 s");
        let head = parts[0]["text"].as_str().unwrap();
        assert!(head.starts_with("File: C0042.MP4 · a 30.0 s camera file\n\nThis is stretch 1 of 3: 0.0 s to 12.0 s of the file.\n"));
        assert!(head.contains("[0.4 s–3.8 s] Day twenty. The city starts with one street."));
        assert!(m[0]["content"].as_str().unwrap().contains("shot_size (one of"));
        // the whole file: the stretches as text
        let r = reduce_messages(&file, &json!([{ "s": 0, "e": 12, "summary": "x" }]), "Day twenty.");
        let c = r[1]["content"].as_str().unwrap();
        assert!(c.contains("The stretches:\n[{") && c.ends_with("Everything said in the file:\nDay twenty."));
        assert!(said(&[]).contains("nothing is said"));
    }

    #[test]
    fn prem_s_failures_read_as_they_mean() {
        assert!(matches!(classify(400, "response_format json_schema is not supported for this model", true), Class::Schema));
        assert!(matches!(classify(400, "response_format json_schema is not supported", false), Class::Own(_)));
        assert!(matches!(classify(429, "slow down", true), Class::Transient(_)));
        assert!(matches!(classify(503, "upstream", true), Class::Transient(_)));
        assert!(matches!(classify(401, "bad key", true), Class::Setup(_)));
        assert!(matches!(classify(500, "failed to request modules from attestation server", true), Class::Attestation(_)));
        assert!(matches!(classify(413, "big", true), Class::Own(_)));
    }

    #[test]
    fn the_scope_defaults_to_day_01() {
        // (only when neither the environment nor this Mac's settings say otherwise)
        if std::env::var("ANALYSE_STORIES").is_err() && !settings().contains_key("stories") {
            assert_eq!(stories(), Some(HashSet::from([super::super::plan::DAY_01.to_string()])));
        }
    }
}
