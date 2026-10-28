//! The shot analysis' model, asked through our server: the Mac samples the frames (natively, from the vault in
//! place) and sends them — with the words said in the stretch — to the API (`POST /api/analysis`, by the Mac's avenDB
//! device pass),
//! which asks Prem's confidential Qwen with the server's key: the prompt, the vocabulary, the JSON schemas, the
//! validation and repair of every answer, the model's pick, the rate limit and the pause after a Prem failure all live
//! there (aven/api/src/analysis.ts, aven/api/src/prem.ts), once. No LLM key is ever on a Mac.
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
    if let Some(at) = body["paused_until"].as_str().and_then(unix_of) {
        let left = Duration::try_from_secs_f64(at - now()).unwrap_or(Duration::ZERO);
        return Err(Ask::Wait { reason: why, until: Some(Instant::now() + left) });
    }
    if body["transient"].as_bool() == Some(true) || status == 401 || status == 403 || status == 429 || status >= 500 {
        return Err(wait(why));
    }
    Err(Ask::Fail(why))
}

/// Seconds since 1970 now.
fn now() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0.0, |d| d.as_secs_f64())
}

/// An RFC 3339 time (`2026-10-26T12:00:00.000Z`, `…+02:00`) → seconds since 1970, or None.
fn unix_of(t: &str) -> Option<f64> {
    let num = |s: &str| s.bytes().all(|b| b.is_ascii_digit()).then(|| s.parse::<i64>().ok()).flatten();
    let (date, rest) = t.split_once(['T', 't', ' '])?;
    let mut d = date.splitn(3, '-').map(num);
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let zone = rest.find(['Z', 'z', '+', '-'])?;
    let (clock, offset) = rest.split_at(zone);
    let mut c = clock.splitn(3, ':');
    let (h, min) = (num(c.next()?)?, num(c.next()?)?);
    let sec: f64 = c.next()?.parse().ok().filter(|s: &f64| (0.0..61.0).contains(s))?;
    let off = match offset {
        "Z" | "z" => 0,
        o => {
            let (hh, mm) = o[1..].split_once(':')?;
            let off = num(hh)? * 3600 + num(mm)? * 60;
            if o.starts_with('-') { -off } else { off }
        }
    };
    if !(1..=12).contains(&m) || !(1..=31).contains(&day) || h > 23 || min > 59 {
        return None;
    }
    // days from civil (Howard Hinnant's algorithm)
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    Some((days * 86_400 + h * 3600 + min * 60 - off) as f64 + sec)
}

pub struct Prem;

pub fn prem() -> &'static Prem {
    static P: Prem = Prem;
    &P
}

impl Prem {
    async fn call(&self, auth: &Auth, pass: Option<String>, method: &str, body: Option<Value>) -> Result<Value, Ask> {
        // the API takes the shot analysis by the Mac's avenDB device pass alone: while the device is locked, the files wait
        let pass = pass.ok_or_else(|| wait("This Mac's avenDB is locked: the shot analysis waits for it to open."))?;
        let (status, body) = auth.call_as(method, "/api/analysis", body, &pass).await.map_err(|e| wait(e))?;
        read(status, body)
    }

    /// One stretch of frames → its tags, cues, summary and thumbnail pick; `pass` the device's for this call, none while
    /// it is locked.
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
        let at = now() as i64 + 90;
        let (days, s) = (at.div_euclid(86_400), at.rem_euclid(86_400));
        let later = format!("1970-01-01T{:02}:{:02}:{:02}.000Z", s / 3600, s / 60 % 60, s % 60);
        let later = later.replacen("1970-01-01", &civil(days), 1);
        match read(503, json!({ "error": "paused", "paused_until": later })) {
            Err(Ask::Wait { until: Some(u), .. }) => assert!(u > Instant::now() + Duration::from_secs(60)),
            other => panic!("{other:?}"),
        }
        // not set up, rate limited, transient, our side: they wait
        assert!(matches!(read(503, json!({ "error": "PREMAI_API_KEY is missing" })), Err(Ask::Wait { until: None, .. })));
        assert!(matches!(read(429, json!({})), Err(Ask::Wait { .. })));
        assert!(matches!(read(502, json!({ "error": "x", "transient": true })), Err(Ask::Wait { .. })));
        assert!(matches!(read(403, json!({ "error": "This needs Maia City’s Admin group in avenDB." })), Err(Ask::Wait { .. })));
        // the file's own: it fails (a try used up)
        assert_eq!(read(413, json!({ "error": "too large" })), Err(Ask::Fail("too large".into())));
        assert_eq!(read(422, json!({})), Err(Ask::Fail("the API answered 422".into())));
    }

    /// Days since 1970 → `YYYY-MM-DD` (civil from days, Howard Hinnant's algorithm).
    fn civil(days: i64) -> String {
        let z = days + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        format!("{:04}-{m:02}-{d:02}", yoe + era * 400 + i64::from(m <= 2))
    }

    #[test]
    fn rfc3339_times_read_as_unix_seconds() {
        assert_eq!(unix_of("1970-01-01T00:00:00Z"), Some(0.0));
        assert_eq!(unix_of("2026-10-26T12:00:00.500Z"), Some(1_793_016_000.5));
        assert_eq!(unix_of("2026-10-26T14:00:00+02:00"), Some(1_793_016_000.0));
        assert_eq!(unix_of("2000-02-29T00:00:00-01:30"), Some(951_787_800.0));
        assert_eq!(civil(20_752), "2026-10-26");
        for bad in ["", "2026-10-26", "2026-13-01T00:00:00Z", "2026-10-26T25:00:00Z", "2026-10-26T12:00:00", "x026-10-26T12:00:00Z"] {
            assert_eq!(unix_of(bad), None, "{bad}");
        }
    }
}
