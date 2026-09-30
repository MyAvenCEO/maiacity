//! The shot analysis' model, asked through our server: the Mac samples the frames (natively, from the vault in
//! place) and sends them — with the words said in the stretch — to the API (`POST /api/analysis`, the app's own key),
//! which asks Prem's confidential Qwen with the server's key: the prompt, the vocabulary, the JSON schemas, the
//! validation and repair of every answer, the model's pick, the rate limit and the pause after a Prem failure all live
//! there (api/src/analysis.ts, api/src/prem.ts), once. No LLM key is ever on a Mac.
//!
//! What stays here: which stories are analysed (set on this Mac: MCP `analysis_setup`; ANALYSE_STORIES overrides), and
//! reading the API's answers — a pause (`503` with `paused_until`) or a transient failure makes the files wait (no try
//! used up), a refusal of the file's own is its failure.

use std::{collections::HashSet, path::PathBuf, time::{Duration, Instant}};

use serde_json::{Map, Value, json};

use crate::auth::Auth;

// ── the settings: the stories ──

fn settings_file() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join("Library/Application Support/city.maia.studio/analysis.json")
}

fn settings() -> Map<String, Value> {
    std::fs::read(settings_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// Change the settings (Null: taken out). A key an earlier version kept here is dropped: keys live on the server.
pub fn set_settings(patch: &Map<String, Value>) -> Result<(), String> {
    let mut map = settings();
    map.remove("prem_key");
    map.remove("prem_base");
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
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

/// No LLM key on a Mac: one an earlier version kept is taken out at start.
pub fn forget_old_key() {
    if settings().contains_key("prem_key") || settings().contains_key("prem_base") {
        set_settings(&Map::new()).ok();
        tracing::info!("analysis: the Prem key kept on this Mac is gone — the server asks Prem");
    }
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

/// What is set, for a person or an agent to see.
pub fn status() -> Value {
    let stories = stories().map(|s| s.into_iter().collect::<Vec<_>>());
    json!({ "through": "our server (POST /api/analysis): the model, its key and the prompt are the server's",
            "stories": stories.map(Value::from).unwrap_or(json!("every story")), "settings": settings_file().display().to_string() })
}

// ── one stretch ──

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

// ── asking through the server ──

/// Why an answer did not come: not the file's fault (the server not set up, the model paused — it waits, queued, and
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

/// The API's answer (its status, its body) → the answer, or why not.
pub fn read(status: u16, body: Value) -> Result<Value, Ask> {
    if (200..300).contains(&status) {
        return Ok(body);
    }
    let why = body["error"].as_str().map(String::from).unwrap_or_else(|| format!("the API answered {status}"));
    if let Some(at) = body["paused_until"].as_str().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()) {
        let left = (at.with_timezone(&chrono::Utc) - chrono::Utc::now()).to_std().unwrap_or(Duration::ZERO);
        return Err(Ask::Wait { reason: why, until: Some(Instant::now() + left) });
    }
    if body["transient"].as_bool() == Some(true) || status == 401 || status == 403 || status == 429 || status >= 500 {
        return Err(wait(why));
    }
    Err(Ask::Fail(why))
}

pub struct Prem;

pub fn prem() -> &'static Prem {
    static P: Prem = Prem;
    &P
}

impl Prem {
    async fn call(&self, auth: &Auth, method: &str, body: Option<Value>) -> Result<Value, Ask> {
        let (status, body) = auth.call(method, "/api/analysis", body).await.map_err(|e| wait(e))?;
        read(status, body)
    }

    /// Is the analysis set up on the server and not paused? (No: why the files wait.)
    pub async fn ready(&self, auth: &Auth) -> Result<(), Ask> {
        let s = self.call(auth, "GET", None).await?;
        if s["ready"].as_bool() != Some(true) {
            return Err(wait("the shot analysis is not set up on the server yet (its Prem key)"));
        }
        if let Some(until) = s["paused_until"].as_str() {
            return read(503, json!({ "error": s["reason"].as_str().unwrap_or("the model is paused"), "paused_until": until })).map(|_| ());
        }
        Ok(())
    }

    /// One stretch of frames → its tags, cues, summary and thumbnail pick.
    pub async fn frames(&self, auth: &Auth, st: &Stretch<'_>) -> Result<Value, Ask> {
        if st.frames.is_empty() {
            return Err(Ask::Fail("No frames in the request.".into()));
        }
        let frames: Vec<Value> = st.frames.iter().map(|(t, jpeg)| json!({ "t": t, "jpeg": jpeg })).collect();
        let body = json!({ "mode": "frames", "file": st.file, "stretch": { "s": st.s, "e": st.e, "index": st.index, "of": st.of },
                           "frames": frames, "words": st.words, "before": st.before });
        self.call(auth, "POST", Some(body)).await
    }

    /// Every stretch's answer → the file's tags, summary, takes and thumbnail.
    pub async fn reduce(&self, auth: &Auth, file: &Value, stretches: &Value, said_text: &str) -> Result<Value, Ask> {
        self.call(auth, "POST", Some(json!({ "mode": "reduce", "file": file, "stretches": stretches, "text": said_text }))).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_the_server_says_decides_wait_or_fail() {
        assert_eq!(read(200, json!({ "tags": {} })).unwrap(), json!({ "tags": {} }));
        // paused: the files wait until then
        let later = (chrono::Utc::now() + chrono::Duration::seconds(90)).to_rfc3339();
        match read(503, json!({ "error": "paused", "paused_until": later })) {
            Err(Ask::Wait { until: Some(u), .. }) => assert!(u > Instant::now() + Duration::from_secs(60)),
            other => panic!("{other:?}"),
        }
        // not set up, rate limited, transient, our side: they wait
        assert!(matches!(read(503, json!({ "error": "PREMAI_API_KEY is missing" })), Err(Ask::Wait { until: None, .. })));
        assert!(matches!(read(429, json!({})), Err(Ask::Wait { .. })));
        assert!(matches!(read(502, json!({ "error": "x", "transient": true })), Err(Ask::Wait { .. })));
        assert!(matches!(read(403, json!({ "error": "This key cannot work with the media vault." })), Err(Ask::Wait { .. })));
        // the file's own: it fails (a try used up)
        assert_eq!(read(413, json!({ "error": "too large" })), Err(Ask::Fail("too large".into())));
        assert_eq!(read(422, json!({})), Err(Ask::Fail("the API answered 422".into())));
    }
}
