//! The shot analysis' model, asked through our server: the Mac samples the frames (natively, from the vault in
//! place) and sends them — with the words said in the stretch — to the API (`POST /api/analysis`, by the Mac's avenDB
//! device pass, else the app's own key),
//! which asks Prem's confidential Qwen with the server's key: the prompt, the vocabulary, the JSON schemas, the
//! validation and repair of every answer, the model's pick, the rate limit and the pause after a Prem failure all live
//! there (api/src/analysis.ts, api/src/prem.ts), once. No LLM key is ever on a Mac.
//!
//! What stays here: which stories are analysed (set on this Mac: MCP `analysis_setup`; ANALYSE_STORIES overrides), and
//! reading the API's answers — a pause (`503` with `paused_until`) or a transient failure makes the files wait (no try
//! used up), a refusal of the file's own is its failure.

use std::time::{Duration, Instant};

use serde_json::{Value, json};

use crate::auth::Auth;



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
    async fn call(&self, auth: &Auth, pass: Option<String>, method: &str, body: Option<Value>) -> Result<Value, Ask> {
        let (status, body) = auth.call_as(method, "/api/analysis", body, pass.as_deref()).await.map_err(|e| wait(e))?;
        read(status, body)
    }

    /// One stretch of frames → its tags, cues, summary and thumbnail pick; `pass` the device's for this call, if any.
    pub async fn frames(&self, auth: &Auth, pass: Option<String>, st: &Stretch<'_>) -> Result<Value, Ask> {
        if st.frames.is_empty() {
            return Err(Ask::Fail("No frames in the request.".into()));
        }
        let frames: Vec<Value> = st.frames.iter().map(|(t, jpeg)| json!({ "t": t, "jpeg": jpeg })).collect();
        let body = json!({ "mode": "frames", "file": st.file, "stretch": { "s": st.s, "e": st.e, "index": st.index, "of": st.of },
                           "frames": frames, "words": st.words, "before": st.before });
        self.call(auth, pass, "POST", Some(body)).await
    }

    /// Every stretch's answer → the file's tags, summary, takes and thumbnail.
    pub async fn reduce(&self, auth: &Auth, pass: Option<String>, file: &Value, stretches: &Value, said_text: &str) -> Result<Value, Ask> {
        self.call(auth, pass, "POST", Some(json!({ "mode": "reduce", "file": file, "stretches": stretches, "text": said_text }))).await
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
