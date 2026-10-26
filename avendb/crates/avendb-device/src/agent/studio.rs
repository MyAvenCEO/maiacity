//! Studio 2, the film studio, for an agent: what the legacy studio's MCP gave (vault/app/src/mcp.rs, removed in #975),
//! over avenDB's entries of its coop, Maia City, and with its aven's rights alone. Three tools:
//!
//!   avendb_studio       reads: the Library (each original file and what the Mac made of it: its probe, proxy, grading
//!                       still, words and shot analysis), a transcript, the words searched, an analysis, the shots
//!                       found by their tags and words, the cuts, a cut as a timeline and its grade's stacks, the tasks,
//!                       the stories, posts and Generated UI views, any entry whole, and the grading tools.
//!   avendb_studio_edit  writes: a cut's timeline, its story arc, a stack of its grade, balances, the mix and the EQ of
//!                       its sound, a transcript's words, any record's fields, a new entry, deletions, and files of this
//!                       Mac brought in as originals. Where its shares let it change the entry on main it does; where
//!                       they let it only suggest, as a Suggester's do, on a proposal of its own, and with `aip` it
//!                       bundles those in an AIP and promotes it, which a human of the vault accepts. A deletion and a
//!                       transcript's words are always proposed: a human says yes to them.
//!   avendb_task         asks the Mac's studio worker for what only the Mac computes, as the studio's buttons ask it:
//!                       a task of a rule (src/lib/studio/jobs/rules.js) on an entry, made in the entry's vault by the
//!                       aven's task asker's share (src/lib/avendb/seed.js `aven-tasks`), keyed as the page keys it
//!                       (`key_of`), so the same ask is one task; it waits for the worker's answer and reads it, a long
//!                       one from the file it spilled into, a picture inline.

use std::collections::HashMap;

use super::{Agent, Beside, FILE, LANDS, WINDOW};
use anyhow::{Context as _, Result, anyhow, bail};
use avendb_net::{NoBytes, NoCeremony};
use data_encoding::BASE64;
use serde_json::{Map, Value, json};

/// The tag that marks an entry deleted, as the page's (src/lib/avendb/ops.js `DELETED`): it can come back.
pub(super) const DELETED: &str = "avendb:deleted";

/// The type of a task's entry (src/lib/studio/jobs/schemas.js `TASK`).
const TASK: &str = "task";

/// The type of a cut's entry (src/lib/studio/cuts.js `CUT`).
const CUT: &str = "cut";

/// The tag of a file the studio made nothing of yet and makes everything of: an original.
const ORIGINAL: &str = "media:original";

/// The task key's own context, as the page's (src/lib/studio/jobs/tasks.js `CONTEXT`).
const CONTEXT: &str = "maiacity studio jobs 2026-10-16 task key v1";

/// How long a task's value may be and still stay on its task (vault/app/src/aven.rs `SPILL`).
const SPILL: usize = 16 * 1024;

/// The most bytes of a file a studio read takes into memory, a spilled value or a picture.
const MOST: u64 = 64 << 20;

/// The longest an avendb_task waits for its answer, and how long by default.
const WAIT_MOST: u64 = 600;
const WAIT: u64 = 30;

/// The grading tools, the one registry (game/film/grade-tools.json), as vault-render reads it.
const GRADE_TOOLS: &str = include_str!("../../../../../game/film/grade-tools.json");

/// The rules of the studio as the page holds them (src/lib/studio/jobs/rules.js `BUILT_IN`), but its test rule: each
/// `[key, version, lane, inputs, params]`, its inputs a JSON map as a rule record holds them. A vault's own rule
/// entry of a key overrides it (`rule_of`).
const RULES: [(&str, u64, &str, &str, &[&str]); 18] = [
    ("probe", 1, "io", r#"{"original":"$entry"}"#, &[]),
    ("proxy", 1, "gpu", r#"{"original":"$entry","probe":{"made":"probe","from":"$entry"}}"#, &["probe.journey"]),
    (
        "still",
        1,
        "gpu",
        r#"{"original":"$entry","probe":{"made":"probe","from":"$entry"},"analysis":{"made":"analysis","from":"$entry","optional":true}}"#,
        &["probe.journey", "analysis.hero.t"],
    ),
    ("transcript", 1, "speech", r#"{"original":"$entry"}"#, &[]),
    (
        "analysis",
        1,
        "ai",
        r#"{"original":"$entry","proxy":{"made":"proxy","from":"$entry"},"transcript":{"made":"transcript","from":"$entry"}}"#,
        &[],
    ),
    ("world-proxy", 1, "gpu", r#"{"shot":"$entry"}"#, &[]),
    ("youtube", 1, "net", r#"{"artifact":"$entry"}"#, &["url"]),
    ("render", 1, "gpu", r#"{"cut":"$entry"}"#, &["delivery"]),
    ("frame", 1, "gpu", r#"{"cut":"$entry"}"#, &["clip", "t", "shape"]),
    ("look", 1, "gpu", r#"{"cut":"$entry"}"#, &["clips", "regions", "looks"]),
    ("scopes", 1, "gpu", r#"{"cut":"$entry"}"#, &["clips", "regions", "looks"]),
    ("balance", 1, "gpu", r#"{"cut":"$entry"}"#, &["clips", "reference", "neutral", "warmth", "regions", "skip"]),
    ("reference", 1, "gpu", r#"{"picture":"$entry"}"#, &[]),
    ("sound", 1, "io", r#"{"cut":"$entry"}"#, &[]),
    ("level", 1, "io", r#"{"cut":"$entry"}"#, &["targets"]),
    ("sound-match", 1, "io", r#"{"cut":"$entry"}"#, &["reference", "clips", "lo", "hi", "limit", "amount", "level"]),
    ("playback", 1, "gpu", r#"{"cut":"$entry"}"#, &["t", "frames", "shape", "originals"]),
    ("checksum", 1, "io", r#"{"file":"$entry"}"#, &[]),
];

/// A rule as an ask reads it: its key, version and lane, its inputs in order (each `$entry`, or what another rule
/// made of it, `(made, optional)`), and the params that change its result.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Rule {
    pub key: String,
    pub version: u64,
    pub lane: String,
    pub inputs: Vec<(String, Option<(String, bool)>)>,
    pub params: Vec<String>,
}

/// Rule inputs as a rule record holds them, a JSON map: the entry picked first (as every rule names it first, and a
/// task's first input is what it was made from), then what other rules made of it, by name.
fn inputs_of(map: &Value) -> Option<Vec<(String, Option<(String, bool)>)>> {
    let mut entry = vec![];
    let mut made = vec![];
    for (name, from) in map.as_object()? {
        match from {
            Value::String(s) if s == "$entry" => entry.push((name.clone(), None)),
            Value::Object(o) => {
                let rule = o.get("made")?.as_str()?.to_string();
                made.push((name.clone(), Some((rule, o.get("optional") == Some(&Value::Bool(true))))));
            }
            _ => return None,
        }
    }
    (!entry.is_empty()).then(|| [entry, made].concat())
}

/// Rule `key` in force in vault `vault` among `entries` as the world shows them: the vault's own newest rule entry of
/// that key over the page's own (`RULES`), as the page layers them (rules.js `layered`; avenCEO GmbH's layer between is
/// the page's alone). None where there is no such rule; an error where the vault turned it off.
pub(super) fn rule_of(key: &str, vault: &str, entries: &[Value]) -> Result<Option<Rule>> {
    let own = entries
        .iter()
        .filter(|e| e["vault"] == vault && e["type"] == "rule" && e["deleted"] != true && e["record"]["key"] == key)
        .max_by_key(|e| e["record"]["version"].as_u64().unwrap_or(0));
    if let Some(e) = own {
        let r = &e["record"];
        anyhow::ensure!(r["off"] != true, "the {key} rule is off in this vault");
        let inputs = serde_json::from_str::<Value>(r["inputs"].as_str().unwrap_or("{}")).ok().and_then(|m| inputs_of(&m));
        let params = r["params"].as_array().map(|p| p.iter().filter_map(|x| x.as_str().map(String::from)).collect());
        if let (Some(inputs), Some(version), Some(lane)) = (inputs, r["version"].as_u64(), r["lane"].as_str()) {
            let params = params.unwrap_or_default();
            return Ok(Some(Rule { key: key.into(), version, lane: lane.into(), inputs, params }));
        }
    }
    let Some((key, version, lane, inputs, params)) = RULES.iter().find(|r| r.0 == key) else { return Ok(None) };
    let inputs = inputs_of(&serde_json::from_str(inputs)?).context("a rule's inputs")?;
    let params = params.iter().map(|p| p.to_string()).collect();
    Ok(Some(Rule { key: key.to_string(), version: *version, lane: lane.to_string(), inputs, params }))
}

/// A whole number held as a float as JSON.stringify writes it, a whole number, all through `v`, so a key made here is
/// the page's.
fn canon(v: &Value) -> Value {
    match v {
        Value::Number(n) => match n.as_f64() {
            Some(f) if n.is_f64() && f.fract() == 0.0 && f.abs() < 9e15 => json!(f as i64),
            _ => v.clone(),
        },
        Value::Array(a) => Value::Array(a.iter().map(canon).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, v)| (k.clone(), canon(v))).collect()),
        v => v.clone(),
    }
}

/// The key of rule `rule` over pinned inputs `inputs` (`{name, entry, at}`) with param values `params`, as the page
/// makes it (tasks.js `keyOf`): BLAKE3 in its own context of the rule and its version, each input by its name with
/// its entry and what it was read at, and each of the rule's params' values, or null.
pub(super) fn key_of(rule: &Rule, inputs: &[Value], params: &Map<String, Value>) -> String {
    let mut pins: Vec<Value> = inputs
        .iter()
        .map(|i| {
            let mut at: Vec<String> = i["at"].as_array().into_iter().flatten().filter_map(|a| a.as_str().map(String::from)).collect();
            at.sort();
            json!([i["name"], i["entry"], at])
        })
        .collect();
    pins.sort_by(|a, b| a[0].as_str().cmp(&b[0].as_str()));
    let mut names: Vec<&String> = rule.params.iter().collect();
    names.sort();
    let vals: Vec<Value> = names.into_iter().map(|k| json!([k, canon(params.get(k).unwrap_or(&Value::Null))])).collect();
    let text = json!([rule.key, rule.version, pins, vals]).to_string();
    blake3::derive_key(CONTEXT, text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// What entry `e` is read at, for its pin (tasks.js `atOf`): a file by the roots of its bytes, anything else by how
/// many edits the device holds of it.
fn at_of(e: &Value) -> Vec<String> {
    let mut roots: Vec<String> = e["files"].as_array().into_iter().flatten().filter_map(|f| f["root"].as_str().map(String::from)).collect();
    if roots.is_empty() {
        return vec![format!("edits:{}", e["edits"].as_u64().unwrap_or(0))];
    }
    roots.sort();
    roots
}

/// The value at a dotted place `path` of `v`.
fn dig<'a>(v: &'a Value, path: &[&str]) -> &'a Value {
    path.iter().fold(v, |v, p| &v[*p])
}

/// Whether `e` is a live entry: not deleted, nor tagged deleted.
fn live(e: &Value) -> bool {
    e["deleted"] != true && !e["tags"].as_array().is_some_and(|t| t.iter().any(|t| t == DELETED))
}

/// The tasks among `entries`, live.
pub(super) fn tasks_of(entries: &[Value]) -> Vec<&Value> {
    entries.iter().filter(|e| e["type"] == TASK && e["record"]["kind"] == TASK && live(e)).collect()
}

/// The newest done task of each rule by what it was made from (tasks.js `madeIndex`): `rule:entry`.
fn made_index<'a>(tasks: &[&'a Value]) -> HashMap<String, &'a Value> {
    let mut out: HashMap<String, &Value> = HashMap::new();
    for t in tasks.iter().copied().filter(|t| t["record"]["status"] == "done") {
        let r = &t["record"];
        let k = format!("{}:{}", r["rule"].as_str().unwrap_or_default(), r["inputs"][0]["entry"].as_str().unwrap_or_default());
        if out.get(&k).is_none_or(|o| o["record"]["at"].as_u64() < r["at"].as_u64()) {
            out.insert(k, t);
        }
    }
    out
}

/// A task's value, parsed; null where it holds none.
fn value_of(t: &Value) -> Value {
    serde_json::from_str(t["record"]["result"].as_str().unwrap_or("")).unwrap_or(Value::Null)
}

/// Rule `rule` pinned on entry `e`, as the page pins it (tasks.js `pin`): its inputs and its params' values, `given`
/// over them; or what it waits for, the rule whose made input isn't made yet.
pub(super) fn pin(rule: &Rule, e: &Value, made: &HashMap<String, &Value>, given: &Map<String, Value>) -> Result<(Vec<Value>, Map<String, Value>), String> {
    let mut inputs = vec![];
    let mut values: HashMap<&str, Value> = HashMap::new();
    let mut id = 1;
    for (name, from) in &rule.inputs {
        match from {
            None => {
                inputs.push(json!({ "id": id, "name": name, "entry": e["entry"], "at": at_of(e) }));
                values.insert(name, e["record"].clone());
                id += 1;
            }
            Some((other, optional)) => match made.get(&format!("{other}:{}", e["entry"].as_str().unwrap_or_default())) {
                None if *optional => {
                    values.insert(name, Value::Null);
                }
                None => return Err(other.clone()),
                Some(t) => {
                    inputs.push(json!({ "id": id, "name": name, "entry": t["entry"], "at": [t["record"]["key"]] }));
                    values.insert(name, value_of(t));
                    id += 1;
                }
            },
        }
    }
    let first = rule.inputs.iter().find(|(_, f)| f.is_none()).map(|(n, _)| n.as_str());
    let mut params = Map::new();
    for p in &rule.params {
        let path: Vec<&str> = p.split('.').collect();
        let v = match values.get(path[0]) {
            Some(v) => dig(v, &path[1..]).clone(),
            None => first.and_then(|f| values.get(f)).map(|v| dig(v, &path).clone()).unwrap_or(Value::Null),
        };
        params.insert(p.clone(), v);
    }
    for (k, v) in given {
        params.insert(k.clone(), v.clone());
    }
    Ok((inputs, params))
}

/// A new task's record (tasks.js `newTask`): rule `rule` on pinned inputs, queued, asked by `by` at `now`; its params
/// as JSON text, those that hold nothing left out, as JSON.stringify leaves them.
pub(super) fn new_task(rule: &Rule, inputs: Vec<Value>, params: &Map<String, Value>, by: &str, now: u64) -> Value {
    let key = key_of(rule, &inputs, params);
    let kept: Map<String, Value> = params.iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k.clone(), canon(v))).collect();
    json!({
        "kind": TASK, "rule": rule.key, "version": rule.version, "key": key, "lane": rule.lane, "inputs": inputs,
        "params": Value::Object(kept).to_string(), "status": "queued", "worker": "", "lease_until": 0, "attempts": 0,
        "error": "", "outputs": [], "result": "", "by": by, "at": now,
    })
}

/// A task asked again from nothing (tasks.js `retrying`), as one batch of sets.
fn retrying(task: &str) -> Value {
    let set = |k: &str, v: Value| json!({ "op": "set", "entry": task, "path": [k], "value": v });
    json!({ "op": "batch", "ops": [set("status", json!("queued")), set("attempts", json!(0)), set("error", json!("")),
        set("worker", json!("")), set("lease_until", json!(0))] })
}

// ── words and shots, as the legacy studio's MCP read them ───────────────────────────────────────────────────────

/// Words as the search compares them: lower case, letters and digits only.
pub(super) fn tokens(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|w| w.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect::<String>())
        .filter(|w| !w.is_empty())
        .collect()
}

/// The file's start timecode in frames, its nominal frame rate and the frames' separator (`;` drop-frame): from its
/// probe, else from its transcript's own copy.
fn start_timecode(probe: &Value, transcript: &Value) -> Option<(u64, u64, String)> {
    let tc = probe["timecode"].as_str().or(transcript["timecode"].as_str())?;
    let fps = probe["timecode_fps"].as_f64().or(transcript["timecode_fps"].as_f64())?;
    let nominal = fps.round().max(1.0) as u64;
    let parts: Vec<u64> = tc.split([':', ';', '.']).filter_map(|p| p.parse().ok()).collect();
    let [h, m, s, f] = parts[..] else { return None };
    let sep = if tc.contains(';') { ";" } else { ":" };
    Some((((h * 60 + m) * 60 + s) * nominal + f, nominal, sep.to_string()))
}

/// A moment of a file (seconds) as timecode: its start timecode plus the moment.
pub(super) fn timecode(probe: &Value, transcript: &Value, seconds: f64) -> Option<String> {
    let (start, fps, sep) = start_timecode(probe, transcript)?;
    let frames = start + (seconds.max(0.0) * fps as f64).round() as u64;
    let secs = frames / fps;
    Some(format!("{:02}:{:02}:{:02}{sep}{:02}", secs / 3600 % 24, secs / 60 % 60, secs % 60, frames % fps))
}

/// Whether range `v` (`s`, `e`) reaches into `from`…`to`.
fn inside(v: &Value, from: Option<f64>, to: Option<f64>) -> bool {
    let (s, e) = (v["s"].as_f64().unwrap_or(0.0), v["e"].as_f64().unwrap_or(0.0));
    from.is_none_or(|f| e > f) && to.is_none_or(|t| s < t)
}

/// What a listing says of a transcript: that it is there, and how much, not its words.
pub(super) fn transcript_summary(t: &Value) -> Value {
    let text = t["text"].as_str().unwrap_or("");
    let preview: String = text.chars().take(160).collect();
    let preview = if preview.len() < text.len() { format!("{preview}…") } else { preview };
    json!({ "state": t["state"], "words": t["words"].as_array().map(Vec::len), "language": t["language"],
        "model": t["model"], "seconds": t["seconds"], "edited": t["edited"], "preview": preview })
}

/// A transcript `t` of a file probed `probe`, between `from` and `to`: its words and utterances, each with its
/// timecode where the file has one.
pub(super) fn transcript_view(t: &Value, probe: &Value, from: Option<f64>, to: Option<f64>) -> Value {
    let with_tc = |v: &Value| {
        let mut v = v.clone();
        if let Some(tc) = timecode(probe, t, v["s"].as_f64().unwrap_or(0.0)) {
            v["tc"] = json!(tc);
        }
        v
    };
    let words: Vec<Value> = t["words"].as_array().into_iter().flatten().filter(|w| inside(w, from, to)).map(with_tc).collect();
    let utterances: Vec<Value> =
        t["utterances"].as_array().into_iter().flatten().filter(|u| inside(u, from, to)).map(with_tc).collect();
    let text = if from.is_some() || to.is_some() {
        json!(words.iter().filter_map(|w| w["w"].as_str()).collect::<Vec<_>>().join(" "))
    } else {
        t["text"].clone()
    };
    json!({ "state": t["state"], "model": t["model"], "language": t["language"], "at": t["at"], "edited": t["edited"],
        "timecode": probe["timecode"].as_str().or(t["timecode"].as_str()), "audio": probe["audio"],
        "text": text, "utterances": utterances, "words": words })
}

/// Every place a phrase (its `want`ed tokens) is said in transcript `t`: where it starts and ends, and the sentence
/// around it.
pub(super) fn find_phrase(t: &Value, want: &[String]) -> Vec<(f64, f64, String)> {
    let words = t["words"].as_array().cloned().unwrap_or_default();
    let said: Vec<String> = words.iter().map(|w| tokens(w["w"].as_str().unwrap_or("")).join("")).collect();
    let utterances = t["utterances"].as_array().cloned().unwrap_or_default();
    let mut out = Vec::new();
    if want.is_empty() || said.len() < want.len() {
        return out;
    }
    for i in 0..=said.len() - want.len() {
        if said[i..i + want.len()] != *want {
            continue;
        }
        let s = words[i]["s"].as_f64().unwrap_or(0.0);
        let e = words[i + want.len() - 1]["e"].as_f64().unwrap_or(s);
        let context = utterances
            .iter()
            .find(|u| u["s"].as_f64().unwrap_or(f64::MAX) <= s + 1e-6 && u["e"].as_f64().unwrap_or(0.0) >= s)
            .and_then(|u| u["text"].as_str().map(String::from))
            .unwrap_or_else(|| {
                let (a, b) = (i.saturating_sub(6), (i + want.len() + 6).min(words.len()));
                words[a..b].iter().filter_map(|w| w["w"].as_str()).collect::<Vec<_>>().join(" ")
            });
        out.push((s, e, context));
    }
    out
}

/// What a listing says of an analysis: what it found, in brief.
pub(super) fn analysis_summary(a: &Value) -> Value {
    let cues = a["cues"].as_array().map(Vec::as_slice).unwrap_or_default();
    let count = |k: &str| cues.iter().filter(|c| c["kind"] == k).count();
    json!({ "state": a["state"], "summary": a["summary"], "tags": a["tags"], "free": a["free"], "hero": a["hero"],
        "cues": cues.len(), "highlights": count("highlight"), "takes": count("take"), "problems": count("problem"),
        "model": a["model"], "at": a["at"] })
}

/// A range with its timecodes, where the file has one.
fn with_tc(probe: &Value, transcript: &Value, mut v: Value) -> Value {
    for (k, at) in [("tc_in", "s"), ("tc_out", "e")] {
        if let Some(tc) = v[at].as_f64().and_then(|t| timecode(probe, transcript, t)) {
            v[k] = json!(tc);
        }
    }
    v
}

/// Analysis `a` of a file probed `probe`, between `from` and `to`: its summary, tags, segments and cues, each range
/// with its timecodes.
pub(super) fn analysis_view(a: &Value, probe: &Value, from: Option<f64>, to: Option<f64>) -> Value {
    let pick = |k: &str| -> Vec<Value> {
        a[k].as_array().into_iter().flatten().filter(|v| inside(v, from, to)).map(|v| with_tc(probe, &Value::Null, v.clone())).collect()
    };
    let mut out = json!({});
    for k in ["state", "summary", "tags", "free", "labels", "hero", "model", "vocabulary", "at", "seconds", "frames"] {
        out[k] = a[k].clone();
    }
    out["timecode"] = probe["timecode"].clone();
    out["segments"] = json!(pick("segments"));
    out["cues"] = json!(pick("cues"));
    out
}

/// An analysed file, as find_shots reads it: its entry, title and tags, and its analysis, words and probe.
pub(super) struct Shot {
    pub entry: String,
    pub vault: String,
    pub title: String,
    pub tags: Vec<String>,
    pub analysis: Value,
    pub transcript: Value,
    pub probe: Value,
    pub proxy: Value,
}

/// What find_shots looks for.
#[derive(Debug, Default)]
pub(super) struct Query {
    /// words, anywhere: a cue's label, note or why, what is said in its range, the file's summary and tags
    pub text: String,
    /// base tags, each one value or any of several: a file matches where its tags do, or in the stretches whose do
    pub tags: Vec<(String, Vec<String>)>,
    /// only these cue kinds; none: all but problems
    pub kinds: Vec<String>,
    /// only files carrying this tag
    pub tag: Option<String>,
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

fn words_between(transcript: &Value, s: f64, e: f64) -> Vec<String> {
    transcript["words"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|w| w["s"].as_f64().unwrap_or(f64::MAX) < e && w["e"].as_f64().unwrap_or(0.0) > s)
        .flat_map(|w| tokens(w["w"].as_str().unwrap_or("")))
        .collect()
}

/// The best candidate ranges across the analysed files, as the legacy studio's find_shots ranked them: every file
/// whose tags (or some of whose stretches) match, its cues (and, where no cue answers the words, its stretches) scored
/// by the words found (in the cue 3, in its note or what is said in it 2, in the file's summary or tags 1), its
/// confidence, and what an editor wants (a highlight, the best take) or does not (a problem, a quality flag).
pub(super) fn find_shots(list: &[Shot], q: &Query) -> Vec<Value> {
    let want = tokens(&q.text);
    let mut hits: Vec<(f64, Value)> = Vec::new();
    for m in list {
        let a = &m.analysis;
        if !a.is_object() || q.tag.as_ref().is_some_and(|t| !m.tags.contains(t)) {
            continue;
        }
        let segments = a["segments"].as_array().cloned().unwrap_or_default();
        let ranges: Option<Vec<(f64, f64)>> = if q.tags.is_empty() || matches_tags(&a["tags"], &q.tags) {
            None
        } else {
            let r: Vec<(f64, f64)> = segments
                .iter()
                .filter(|g| matches_tags(&g["tags"], &q.tags))
                .map(|g| (g["s"].as_f64().unwrap_or(0.0), g["e"].as_f64().unwrap_or(0.0)))
                .collect();
            if r.is_empty() {
                continue;
            }
            Some(r)
        };
        let within = |s: f64, e: f64| ranges.as_ref().is_none_or(|r| r.iter().any(|(a, b)| s < b + 0.01 && e > a - 0.01));
        let file_words: Vec<String> =
            [a["summary"]["line"].as_str(), a["summary"]["best_use"].as_str(), a["tags"]["location_note"].as_str()]
                .into_iter()
                .flatten()
                .flat_map(tokens)
                .chain(a["labels"].as_array().into_iter().flatten().filter_map(|l| l.as_str()).flat_map(|l| tokens(&l.replace([':', '/', '-'], " "))))
                .chain(tokens(&m.title))
                .collect();
        let flags = a["tags"]["quality"].as_array().map(Vec::len).unwrap_or(0) as f64;
        let cues = a["cues"].as_array().cloned().unwrap_or_default();
        let problems: Vec<(f64, f64)> = cues
            .iter()
            .filter(|c| c["kind"] == "problem")
            .map(|c| (c["s"].as_f64().unwrap_or(0.0), c["e"].as_f64().unwrap_or(0.0)))
            .collect();
        let score_words = |label: &[String], near: &[String]| -> f64 {
            want.iter()
                .map(|w| if label.contains(w) { 3.0 } else if near.contains(w) { 2.0 } else if file_words.contains(w) { 1.0 } else { 0.0 })
                .sum()
        };
        let mut found_by_cue = false;
        let mut push = |kind: &str, c: &Value, score: f64| {
            let (s, e) = (c["s"].as_f64().unwrap_or(0.0), c["e"].as_f64().unwrap_or(0.0));
            let mut hit = json!({ "entry": m.entry, "vault": m.vault, "title": m.title, "s": s, "e": e, "kind": kind,
                "label": c.get("label").or(c.get("line")), "score": (score * 100.0).round() / 100.0,
                "file_summary": a["summary"]["line"], "proxy": m.proxy });
            for k in ["note", "why", "confidence", "take_of", "take", "rank", "best"] {
                if let Some(v) = c.get(k) {
                    hit[k] = v.clone();
                }
            }
            hits.push((score, with_tc(&m.probe, &m.transcript, hit)));
        };
        for c in &cues {
            let kind = c["kind"].as_str().unwrap_or("");
            let wanted_kind = if q.kinds.is_empty() { kind != "problem" } else { q.kinds.iter().any(|k| k == kind) };
            let confidence = c["confidence"].as_f64().unwrap_or(0.5);
            let (s, e) = (c["s"].as_f64().unwrap_or(0.0), c["e"].as_f64().unwrap_or(0.0));
            if !wanted_kind || confidence < q.min_confidence || !within(s, e) {
                continue;
            }
            let label: Vec<String> =
                tokens(c["label"].as_str().unwrap_or("")).into_iter().chain(tokens(c["take_of"].as_str().unwrap_or(""))).collect();
            let near: Vec<String> = [c["note"].as_str(), c["why"].as_str()]
                .into_iter()
                .flatten()
                .flat_map(tokens)
                .chain(words_between(&m.transcript, s, e))
                .collect();
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
        if !found_by_cue && q.kinds.is_empty() {
            for g in &segments {
                let (s, e) = (g["s"].as_f64().unwrap_or(0.0), g["e"].as_f64().unwrap_or(0.0));
                if !within(s, e) {
                    continue;
                }
                let label = tokens(g["line"].as_str().unwrap_or(""));
                let w = score_words(&label, &words_between(&m.transcript, s, e));
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

// ── a cut's timeline, as the studio keeps it (src/lib/studio/cuts.js) ───────────────────────────────────────────

/// The fields a cut's record holds apart from its timeline's JSON (cuts.js `FIELDS`).
const CUT_FIELDS: [&str; 7] = ["name", "project", "variant", "description", "stage", "version", "legacy"];

/// Cut entry `e` as a timeline, as the studio reads it (cuts.js `timelineOf`, vault/app/src/aven.rs `cut_json`): its
/// timeline's JSON, its record's own fields over it, `entry` and `vault` beside.
pub(super) fn timeline_of(e: &Value) -> Value {
    let r = &e["record"];
    let mut t = serde_json::from_str::<Value>(r["timeline"].as_str().unwrap_or("{}")).ok().filter(Value::is_object).unwrap_or_else(|| json!({}));
    for (k, v) in [("aspect", json!("16:9")), ("tags", json!([])), ("clips", json!([]))] {
        if t.get(k).is_none() {
            t[k] = v;
        }
    }
    for k in CUT_FIELDS {
        t[k] = r[k].clone();
    }
    t["name"] = json!(r["name"].as_str().unwrap_or("A cut"));
    t["stage"] = json!(r["stage"].as_str().unwrap_or("edit"));
    t["version"] = json!(r["version"].as_u64().unwrap_or(1));
    t["id"] = json!(format!("cut:{}", e["entry"].as_str().unwrap_or_default()));
    t["entry"] = e["entry"].clone();
    t["vault"] = e["vault"].clone();
    t
}

/// The ops that save timeline `now` (as `timeline_of` reads one, changed) into cut `entry` (as cut_api's PUT does):
/// its record's own fields, the rest as its timeline's JSON, and the time, `at`.
pub(super) fn saving(entry: &str, now: &Value, at: u64) -> Vec<Value> {
    let mut timeline = Map::new();
    let mut ops = vec![];
    for (k, v) in now.as_object().into_iter().flatten() {
        if ["id", "entry", "vault", "created", "updated", "at", "if_updated"].contains(&k.as_str()) {
            continue;
        }
        if CUT_FIELDS.contains(&k.as_str()) {
            let v = if v.is_null() { if k == "version" { json!(1) } else { json!("") } } else { v.clone() };
            ops.push(json!({ "op": "set", "entry": entry, "path": [k], "value": v }));
        } else {
            timeline.insert(k.clone(), v.clone());
        }
    }
    ops.push(json!({ "op": "set", "entry": entry, "path": ["timeline"], "value": Value::Object(timeline).to_string() }));
    ops.push(json!({ "op": "set", "entry": entry, "path": ["at"], "value": at }));
    ops
}

/// A clip of timeline `t` by its id, to change.
fn clip_mut<'a>(t: &'a mut Value, id: &str) -> Result<&'a mut Value> {
    let clips = t["clips"].as_array_mut().context("the cut has no clips")?;
    clips.iter_mut().find(|c| c["id"] == id).with_context(|| format!("no clip {id} on this cut"))
}

/// A stack of grading tools as it is written: null (none), or `{strength?, tools: [{tool, on?, ...controls}]}`, a
/// window's or a key's own tools nested in it (grade_tools lists them all).
fn checked_stack(v: &Value) -> Result<Value> {
    fn tools_ok(tools: &Value) -> bool {
        tools.as_array().is_some_and(|ts| {
            ts.iter().all(|t| t["tool"].is_string() && (t.get("tools").is_none() || tools_ok(&t["tools"])))
        })
    }
    if v.is_null() {
        return Ok(Value::Null);
    }
    anyhow::ensure!(v.is_object() && tools_ok(&v["tools"]), "not a stack: {{ tools: [{{ tool, ... }}] }} (grade_tools lists them)");
    Ok(v.clone())
}

/// Timeline `t` with one stack of its grade set (as the legacy studio's grade_stack set it): a shot's base correction
/// (`base`) or clip look (`clip`) of clip `clip`, a scene's look (`scene`, named, or the scene of clip `clip`), or the
/// timeline's look (`timeline`).
pub(super) fn set_stack(t: &mut Value, stack: &str, clip: Option<&str>, scene: Option<&str>, set: &Value) -> Result<()> {
    let st = checked_stack(set)?;
    match stack {
        "base" | "clip" => {
            let c = clip_mut(t, clip.context("which shot: clip")?)?;
            if !c["stacks"].is_object() {
                c["stacks"] = json!({});
            }
            c["stacks"][stack] = st;
        }
        "scene" => {
            let scene = match (scene, clip) {
                (Some(s), _) => s.to_string(),
                (None, Some(id)) => {
                    let c = clip_mut(t, id)?;
                    c["script"]["scene"].as_str().filter(|s| !s.is_empty()).context("this shot has no scene in the script")?.to_string()
                }
                _ => bail!("which scene: scene, or a clip of it"),
            };
            if !t["grade"].is_object() {
                t["grade"] = json!({});
            }
            if !t["grade"]["scenes"].is_object() {
                t["grade"]["scenes"] = json!({});
            }
            t["grade"]["scenes"][scene] = st;
        }
        "timeline" => {
            if !t["grade"].is_object() {
                t["grade"] = json!({});
            }
            t["grade"]["timeline"] = st;
        }
        other => bail!("no stack {other}: base, clip, scene or timeline"),
    }
    Ok(())
}

/// The whole grade of timeline `t` as stacks (the legacy studio's grade_stacks): the timeline's look, every scene's,
/// and each shot's base correction and clip look, in the shots' order.
pub(super) fn stacks_of(t: &Value) -> Value {
    let mut v1: Vec<&Value> = t["clips"].as_array().into_iter().flatten().filter(|c| c["track"] == "V1").collect();
    v1.sort_by(|a, b| a["start"].as_f64().unwrap_or(0.0).total_cmp(&b["start"].as_f64().unwrap_or(0.0)));
    let shots: Vec<Value> = v1
        .iter()
        .enumerate()
        .map(|(i, c)| json!({ "shot": i + 1, "clip": c["id"], "scene": c["script"]["scene"], "description": c["script"]["description"],
            "base": c["stacks"]["base"], "clip_look": c["stacks"]["clip"] }))
        .collect();
    json!({ "timeline": t["grade"]["timeline"], "scenes": t["grade"]["scenes"], "shots": shots })
}

/// Timeline `t` with each shot's proposed balance (a `balance` task's `shots`: `{clip, balance}`) written into its
/// base correction: its first balance tool, else one at its start.
pub(super) fn set_balances(t: &mut Value, shots: &[Value]) -> Result<Vec<String>> {
    let mut done = vec![];
    for p in shots.iter().filter(|p| p.get("error").is_none()) {
        let id = p["clip"].as_str().context("each shot names its clip")?;
        anyhow::ensure!(p["balance"].is_object(), "clip {id}: a balance is an object, as the balance task proposes it");
        let c = clip_mut(t, id)?;
        let mut tool = p["balance"].clone();
        tool["tool"] = json!("balance");
        if !c["stacks"].is_object() {
            c["stacks"] = json!({});
        }
        if !c["stacks"]["base"]["tools"].is_array() {
            c["stacks"]["base"] = json!({ "tools": [] });
        }
        let tools = c["stacks"]["base"]["tools"].as_array_mut().expect("a list");
        match tools.iter_mut().find(|x| x["tool"] == "balance") {
            Some(x) => *x = tool,
            None => tools.insert(0, tool),
        }
        done.push(id.to_string());
    }
    Ok(done)
}

/// A sound clip's EQ as it is written, checked as the mix takes it (vault-render `eq::clean_eq`): known kinds,
/// 20 Hz to 20 kHz, ±24 dB, q 0.1 to 18; a band that changes nothing refused, as it would be dropped.
fn checked_eq(v: &Value) -> Result<Value> {
    const KINDS: [&str; 6] = ["highpass", "lowshelf", "peaking", "notch", "highshelf", "lowpass"];
    let bands = v.as_array().context("an EQ is a list of bands: [{type, f, gain?, q?}]")?;
    for b in bands {
        let kind = b["type"].as_str().filter(|k| KINDS.contains(k));
        let kind = kind.with_context(|| format!("{b}: type is one of {}", KINDS.join(", ")))?;
        anyhow::ensure!(b["f"].as_f64().is_some_and(|f| (20.0..=20000.0).contains(&f)), "{b}: f is 20 to 20000 Hz");
        anyhow::ensure!(b["gain"].is_null() || b["gain"].as_f64().is_some_and(|g| g.abs() <= 24.0), "{b}: gain is ±24 dB");
        anyhow::ensure!(b["q"].is_null() || b["q"].as_f64().is_some_and(|q| (0.1..=18.0).contains(&q)), "{b}: q is 0.1 to 18");
        let shapes = ["peaking", "lowshelf", "highshelf"].contains(&kind);
        anyhow::ensure!(!shapes || b["gain"].as_f64().is_some_and(|g| g != 0.0), "{b}: a {kind} band at 0 dB changes nothing");
    }
    Ok(v.clone())
}

/// Timeline `t` with sound clips' mix changed (the legacy studio's audio_mix, and what a level or sound-match task
/// proposes): each `{clip, gain_db | vol, fin, fout, keys, eq}`, its gain in dB (0 as recorded, −60 to +12) or as a
/// volume (0 to 4), its fades in seconds, its gain keys along it (`[[t, dB]]`, [] none) and its EQ ([] none).
pub(super) fn mix(t: &mut Value, clips: &[Value]) -> Result<Vec<String>> {
    let mut done = vec![];
    for m in clips {
        let id = m["clip"].as_str().context("each change names its clip")?;
        let c = clip_mut(t, id)?;
        anyhow::ensure!(c["track"].as_str().is_some_and(|tr| tr.starts_with('A')), "clip {id} is not a sound clip");
        if let Some(g) = m["gain_db"].as_f64() {
            c["vol"] = json!(((10f64.powf(g.clamp(-60.0, 12.0) / 20.0)) * 1000.0).round() / 1000.0);
        } else if let Some(v) = m["vol"].as_f64() {
            c["vol"] = json!(v.clamp(0.0, 4.0));
        }
        for k in ["fin", "fout"] {
            if let Some(f) = m[k].as_f64() {
                c[k] = json!(f.max(0.0));
            }
        }
        if let Some(keys) = m.get("keys").filter(|k| !k.is_null()) {
            let keys = keys.as_array().context("keys are [[t, dB], ...]")?;
            let ok = keys.iter().all(|k| k.as_array().is_some_and(|p| p.len() == 2 && p.iter().all(Value::is_number)));
            anyhow::ensure!(ok, "keys are [[t, dB], ...]");
            if keys.is_empty() {
                c.as_object_mut().map(|o| o.remove("keys"));
            } else {
                c["keys"] = json!(keys);
            }
        }
        if let Some(eq) = m.get("eq").filter(|e| !e.is_null()) {
            let eq = checked_eq(eq)?;
            if eq.as_array().is_some_and(Vec::is_empty) {
                c.as_object_mut().map(|o| o.remove("eq"));
            } else {
                c["eq"] = eq;
            }
        }
        done.push(id.to_string());
    }
    Ok(done)
}

/// Timeline `t` with its story structure (the Script tab's Story track) set (the legacy studio's story_arc): its
/// sections replaced by `sections`, each `{section, start, dur, text?, tension?}`, on track S1.
pub(super) fn set_arc(t: &mut Value, sections: &[Value]) -> Result<usize> {
    let mut clips: Vec<Value> = t["clips"].as_array().cloned().unwrap_or_default().into_iter().filter(|c| c["kind"] != "section").collect();
    for (i, s) in sections.iter().enumerate() {
        let section = s["section"].as_str().context("each section names what it is: thumbnail, hook, act1, act2, act3, cliffhanger")?;
        let (start, dur) = (s["start"].as_f64().context("a section's start")?, s["dur"].as_f64().context("a section's dur")?);
        clips.push(json!({ "id": format!("story-{section}-{i}"), "kind": "section", "track": "S1", "start": start, "in": 0, "dur": dur,
            "vol": 0, "section": section, "text": s["text"].as_str().unwrap_or_default(), "tension": s.get("tension").cloned().unwrap_or(json!([])) }));
    }
    t["clips"] = json!(clips);
    Ok(sections.len())
}

/// Transcript `before` with the words at places `fixes` (`{i, w}`) put right, as the legacy studio's transcript_edit
/// did: a fix of several words shares the time of the word it replaces by their lengths; its text and sentences
/// written again from its words (src/lib/studio/transcript.js `withWords`), and `edited` by whom and when.
pub(super) fn fixed(before: &Value, fixes: &[Value], by: &str, now: &str) -> Result<Value> {
    let mut words: Vec<Value> = before["words"].as_array().cloned().context("no words in its transcript")?;
    let mut fixes: Vec<(usize, String)> = fixes
        .iter()
        .map(|f| Some((f["i"].as_u64()? as usize, f["w"].as_str()?.to_string())))
        .collect::<Option<_>>()
        .context("each fix is {i, w}: the word's place, and what was said")?;
    // from the last fix back, so each place stays where the transcript showed it
    fixes.sort_by(|x, y| y.0.cmp(&x.0));
    for (i, w) in fixes {
        let old = words.get(i).cloned().with_context(|| format!("no word {i}"))?;
        let said: Vec<&str> = w.split_whitespace().collect();
        let (s0, e0) = (old["s"].as_f64().unwrap_or(0.0), old["e"].as_f64().unwrap_or(0.0));
        let total: f64 = said.iter().map(|x| x.chars().count() as f64 + 1.0).sum();
        let mut at = s0;
        let made: Vec<Value> = said
            .iter()
            .map(|x| {
                let d = if said.len() == 1 { e0 - s0 } else { (e0 - s0) * (x.chars().count() as f64 + 1.0) / total };
                let w = json!({ "w": x, "s": (at * 1000.0).round() / 1000.0, "e": ((at + d) * 1000.0).round() / 1000.0 });
                at += d;
                w
            })
            .collect();
        words.splice(i..=i, made);
    }
    anyhow::ensure!(!words.is_empty(), "no words to keep");
    let said = |ws: &mut dyn Iterator<Item = &Value>| ws.filter_map(|w| w["w"].as_str()).collect::<Vec<_>>().join(" ");
    let mut r = before.clone();
    if let Some(us) = r.get_mut("utterances").and_then(|u| u.as_array_mut()) {
        for u in us {
            let (s, e) = (u["s"].as_f64().unwrap_or(0.0), u["e"].as_f64().unwrap_or(0.0));
            u["text"] = json!(said(&mut words.iter().filter(|w| w["s"].as_f64().is_some_and(|ws| ws >= s - 0.02 && ws < e))));
        }
    }
    r["text"] = json!(said(&mut words.iter()));
    r["words"] = json!(words);
    r["state"] = json!("done");
    r["edited"] = json!({ "by": by, "at": now });
    Ok(r)
}

/// Now, as ISO 8601 to the second, and as seconds since 1970.
fn now() -> (String, u64) {
    let s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (days, rest) = ((s / 86_400) as i64, s % 86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    (format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rest / 3600, rest % 3600 / 60, rest % 60), s)
}

/// What the agent wrote: an entry changed on main, or on a proposal line of its own (or a draft, its own line), for an
/// AIP to name.
struct Wrote {
    entry: String,
    vault: String,
    line: Option<String>,
}

/// The arguments' field `k`, as text.
fn text_arg<'a>(args: &'a Value, k: &str) -> Option<&'a str> {
    args[k].as_str().map(str::trim).filter(|s| !s.is_empty())
}

/// The arguments' field `k`, a list of texts.
fn texts_arg(args: &Value, k: &str) -> Option<Vec<String>> {
    args[k].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
}

/// What a picture an answer brings is: its media type and bytes.
pub(super) type Picture = (String, Vec<u8>);

impl Agent {
    /// The device's world, its `ok`.
    async fn world(&self) -> Result<Value> {
        let w = self.node.op(json!({ "op": "world" })).await?;
        w.get("ok").cloned().filter(|w| !w.is_null()).context("its device belongs to no vault yet")
    }

    /// The bytes of file entry `entry`, whole, as get_file reads them (`file_of`), a window at a time, in memory: at
    /// most `MOST`.
    async fn bytes_of(&self, entry: &str) -> Result<Vec<u8>> {
        let found = match self.file_of(&json!({ "op": "get_file", "entry": entry })).await? {
            Ok(found) => found,
            Err(refused) => bail!("file {entry} isn't read: {} ({})", refused["why"], refused["refused"]),
        };
        anyhow::ensure!(found.len <= MOST, "file {entry} is {} bytes: read it to a path with avendb_read_file", found.len);
        let mut out = Vec::with_capacity(found.len as usize);
        while (out.len() as u64) < found.len {
            let at = out.len() as u64;
            let to = (at + WINDOW).min(found.len);
            let read = json!({ "op": "read_file", "root": found.root, "size": found.size, "from": at, "to": to });
            let (answer, bytes) = self.node.run(read, None::<NoBytes>, None::<&NoCeremony>).await?;
            if answer.get("refused").is_some() {
                bail!("file {entry} isn't read: {}", answer["why"]);
            }
            let bytes = bytes.context("read_file brings the file's bytes")?;
            anyhow::ensure!(bytes.len() as u64 == to - at, "file {entry}'s bytes from {at} on came short");
            out.extend_from_slice(&bytes);
        }
        Ok(out)
    }

    /// A task's value whole: a long one read back from the JSON file it spilled into (`{file}`).
    async fn full_value(&self, t: &Value) -> Value {
        let v = value_of(t);
        let Some(file) = v["file"].as_str() else { return v };
        match self.bytes_of(file).await.and_then(|b| Ok(serde_json::from_slice::<Value>(&b)?)) {
            Ok(whole) => whole,
            Err(e) => json!({ "file": file, "error": format!("{e:#}"), "kept": v }),
        }
    }

    // ── avendb_studio ──────────────────────────────────────────────────────────────────────────────────────────

    /// avendb_studio: a read of Studio 2 (`what`), in words as JSON.
    pub(super) async fn studio(&self, args: &Value) -> Result<String> {
        let what = text_arg(args, "what").context("avendb_studio takes what it reads: what")?;
        let world = self.world().await?;
        let all = world["entries"].as_array().cloned().unwrap_or_default();
        let vault = text_arg(args, "vault").map(str::to_ascii_lowercase);
        let entries: Vec<Value> = all.iter().filter(|e| vault.as_ref().is_none_or(|v| e["vault"] == v.as_str())).cloned().collect();
        let tasks = tasks_of(&all);
        let made = made_index(&tasks);
        let made_of = |rule: &str, entry: &Value| made.get(&format!("{rule}:{}", entry.as_str().unwrap_or_default())).copied();
        let entry_arg = || -> Result<Value> {
            let id = text_arg(args, "entry").context("name the entry: entry")?.to_ascii_lowercase();
            all.iter().find(|e| e["entry"] == id.as_str()).cloned().with_context(|| format!("{} reads no entry {id}", self.name))
        };
        let limit = args["limit"].as_u64().map(|l| l.clamp(1, 1000) as usize);
        let range = (args["from"].as_f64(), args["to"].as_f64());
        let out = match what {
            "library" => {
                let tag = text_arg(args, "tag");
                let media = text_arg(args, "media");
                let originals = args["all"] != true;
                let files: Vec<&Value> = entries
                    .iter()
                    .filter(|e| e["type"] == FILE && live(e))
                    .filter(|e| !originals || e["tags"].as_array().is_some_and(|t| t.iter().any(|t| t == ORIGINAL)))
                    .filter(|e| tag.is_none_or(|t| e["tags"].as_array().is_some_and(|ts| ts.iter().any(|x| x == t))))
                    .filter(|e| media.is_none_or(|m| e["media"].as_str().is_some_and(|x| if let Some(p) = m.strip_suffix('*') { x.starts_with(p) } else { x == m })))
                    .collect();
                let bytes: u64 = files.iter().filter_map(|e| e["files"][0]["len"].as_u64()).sum();
                let rows: Vec<Value> = files.iter().take(limit.unwrap_or(500)).map(|e| self.library_row(e, &tasks, &made)).collect();
                json!({ "files": files.len(), "bytes": bytes, "shown": rows.len(), "library": rows })
            }
            "file" => {
                let e = entry_arg()?;
                let mut row = self.library_row(&e, &tasks, &made);
                for rule in ["probe", "transcript", "analysis", "youtube"] {
                    if let Some(t) = made_of(rule, &e["entry"]) {
                        let v = self.full_value(t).await;
                        row["made"][rule] = match rule {
                            "transcript" => transcript_summary(&v),
                            "analysis" => analysis_summary(&v),
                            _ => v,
                        };
                    }
                }
                row["record"] = e["record"].clone();
                row
            }
            "transcript" => {
                let e = entry_arg()?;
                let Some(t) = made_of("transcript", &e["entry"]) else {
                    let open = tasks.iter().find(|t| t["record"]["rule"] == "transcript" && t["record"]["inputs"][0]["entry"] == e["entry"]);
                    let state = open.map_or(json!("not yet: the Mac transcribes an original once it is in the Library"), |t| t["record"]["status"].clone());
                    return Ok(json!({ "entry": e["entry"], "title": e["title"], "transcript": null, "state": state }).to_string());
                };
                let probe = made_of("probe", &e["entry"]).map(value_of).unwrap_or_default();
                let mut v = transcript_view(&self.full_value(t).await, &probe, range.0, range.1);
                v["entry"] = e["entry"].clone();
                v["title"] = e["title"].clone();
                v["task"] = t["entry"].clone();
                v
            }
            "transcript_search" => {
                let phrase = text_arg(args, "phrase").context("a phrase to find: phrase")?;
                let want = tokens(phrase);
                anyhow::ensure!(!want.is_empty(), "a phrase to find: phrase");
                let tag = text_arg(args, "tag");
                let most = limit.unwrap_or(50);
                let mut hits = vec![];
                for e in entries.iter().filter(|e| e["type"] == FILE && live(e)) {
                    if tag.is_some_and(|t| !e["tags"].as_array().is_some_and(|ts| ts.iter().any(|x| x == t))) {
                        continue;
                    }
                    let Some(t) = made_of("transcript", &e["entry"]) else { continue };
                    let words = self.full_value(t).await;
                    let probe = made_of("probe", &e["entry"]).map(value_of).unwrap_or_default();
                    for (s, end, context) in find_phrase(&words, &want) {
                        hits.push(json!({ "entry": e["entry"], "vault": e["vault"], "title": e["title"], "s": s, "e": end,
                            "timecode": timecode(&probe, &words, s), "context": context }));
                        if hits.len() >= most {
                            return Ok(json!({ "phrase": phrase, "hits": hits, "more": true }).to_string());
                        }
                    }
                }
                json!({ "phrase": phrase, "hits": hits })
            }
            "analysis" => {
                let e = entry_arg()?;
                let Some(t) = made_of("analysis", &e["entry"]) else {
                    let open = tasks.iter().find(|t| t["record"]["rule"] == "analysis" && t["record"]["inputs"][0]["entry"] == e["entry"]);
                    let state = open.map_or(json!("not yet: the Mac analyses a film once its proxy and its words are made"), |t| t["record"]["status"].clone());
                    return Ok(json!({ "entry": e["entry"], "title": e["title"], "analysis": null, "state": state }).to_string());
                };
                let probe = made_of("probe", &e["entry"]).map(value_of).unwrap_or_default();
                let mut v = analysis_view(&self.full_value(t).await, &probe, range.0, range.1);
                v["entry"] = e["entry"].clone();
                v["title"] = e["title"].clone();
                v["task"] = t["entry"].clone();
                v
            }
            "find_shots" => {
                let mut list = vec![];
                for e in entries.iter().filter(|e| e["type"] == FILE && live(e)) {
                    let Some(t) = made_of("analysis", &e["entry"]) else { continue };
                    let transcript = match made_of("transcript", &e["entry"]) {
                        Some(t) => self.full_value(t).await,
                        None => Value::Null,
                    };
                    let tags = e["tags"].as_array().into_iter().flatten().filter_map(|t| t.as_str().map(String::from)).collect();
                    let proxy = made_of("proxy", &e["entry"]).map_or(Value::Null, |t| t["record"]["outputs"][0].clone());
                    list.push(Shot {
                        entry: e["entry"].as_str().unwrap_or_default().into(),
                        vault: e["vault"].as_str().unwrap_or_default().into(),
                        title: e["title"].as_str().unwrap_or_default().into(),
                        tags,
                        analysis: self.full_value(t).await,
                        transcript,
                        probe: made_of("probe", &e["entry"]).map(value_of).unwrap_or_default(),
                        proxy,
                    });
                }
                let tags = args["tags"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .map(|(k, v)| {
                        let vals = match v {
                            Value::Array(xs) => xs.iter().map(|x| x.as_str().map(String::from).unwrap_or_else(|| x.to_string())).collect(),
                            Value::String(s) => vec![s.clone()],
                            other => vec![other.to_string()],
                        };
                        (k.clone(), vals)
                    })
                    .collect();
                let q = Query {
                    text: text_arg(args, "query").unwrap_or_default().into(),
                    tags,
                    kinds: texts_arg(args, "kinds").unwrap_or_default(),
                    tag: text_arg(args, "tag").map(String::from),
                    min_confidence: args["min_confidence"].as_f64().unwrap_or(0.0),
                    limit: limit.unwrap_or(20),
                };
                json!({ "analysed_files": list.len(), "hits": find_shots(&list, &q) })
            }
            "cuts" => {
                let cuts: Vec<Value> = entries
                    .iter()
                    .filter(|e| e["type"] == CUT && e["record"]["kind"] == CUT && live(e))
                    .map(|e| {
                        let t = timeline_of(e);
                        json!({ "entry": e["entry"], "vault": e["vault"], "name": t["name"], "project": t["project"], "variant": t["variant"],
                            "stage": t["stage"], "version": t["version"], "aspect": t["aspect"], "clips": t["clips"].as_array().map(Vec::len), "at": e["record"]["at"] })
                    })
                    .collect();
                json!({ "cuts": cuts })
            }
            "cut" => {
                let e = entry_arg()?;
                anyhow::ensure!(e["type"] == CUT, "entry {} is a {}, not a cut", e["entry"], e["type"]);
                timeline_of(&e)
            }
            "stacks" => {
                let e = entry_arg()?;
                anyhow::ensure!(e["type"] == CUT, "entry {} is a {}, not a cut", e["entry"], e["type"]);
                stacks_of(&timeline_of(&e))
            }
            "tasks" => {
                let of = text_arg(args, "entry").map(str::to_ascii_lowercase);
                let (rule, status) = (text_arg(args, "rule"), text_arg(args, "status"));
                let mut rows: Vec<Value> = tasks
                    .iter()
                    .filter(|t| vault.as_ref().is_none_or(|v| t["vault"] == v.as_str()))
                    .filter(|t| of.as_ref().is_none_or(|o| t["entry"] == o.as_str() || t["record"]["inputs"][0]["entry"] == o.as_str()))
                    .filter(|t| rule.is_none_or(|r| t["record"]["rule"] == r) && status.is_none_or(|s| t["record"]["status"] == s))
                    .map(|t| task_row(t))
                    .collect();
                rows.sort_by_key(|t| std::cmp::Reverse(t["at"].as_u64().unwrap_or(0)));
                let (open, done): (Vec<Value>, Vec<Value>) = rows.into_iter().partition(|t| t["status"] != "done");
                let tasks: Vec<Value> = open.into_iter().chain(done.into_iter().take(limit.unwrap_or(30))).collect();
                json!({ "tasks": tasks })
            }
            "stories" | "posts" | "views" => {
                let ty = &what[..what.len() - 1];
                let rows: Vec<Value> = entries
                    .iter()
                    .filter(|e| e["type"] == ty && live(e))
                    .map(|e| {
                        let r = &e["record"];
                        let mut row = json!({ "entry": e["entry"], "vault": e["vault"], "title": e["title"].as_str().or(r["title"].as_str()), "tags": e["tags"], "created": e["created"] });
                        let keep: &[&str] = match ty {
                            "story" => &["format", "hook", "series", "from", "to", "question"],
                            "post" => &["channel", "about", "published"],
                            _ => &["note", "form", "for", "source"],
                        };
                        for k in keep {
                            if !r[*k].is_null() {
                                row[*k] = r[*k].clone();
                            }
                        }
                        row
                    })
                    .take(limit.unwrap_or(200))
                    .collect();
                json!({ what: rows })
            }
            "entry" => {
                let e = entry_arg()?;
                json!({ "entry": e["entry"], "vault": e["vault"], "type": e["type"], "title": e["title"], "tags": e["tags"],
                    "created": e["created"], "media": e["media"], "files": e["files"], "record": e["record"] })
            }
            "grade_tools" => serde_json::from_str(GRADE_TOOLS).context("the grading tools' registry")?,
            other => bail!(
                "avendb_studio reads no {other:?}: library, file, transcript, transcript_search, analysis, find_shots, cuts, cut, \
                 stacks, tasks, stories, posts, views, entry, grade_tools"
            ),
        };
        Ok(out.to_string())
    }

    /// A Library file as avendb_studio lists it: its entry, name, media type, length, tags, where its copies are, and
    /// what the Mac made of it so far (its probe in brief, its proxy, grading still and preview, its words' and its
    /// analysis' state), with the tasks of it still open.
    fn library_row(&self, e: &Value, tasks: &[&Value], made: &HashMap<String, &Value>) -> Value {
        let id = e["entry"].as_str().unwrap_or_default();
        let of = |rule: &str| made.get(&format!("{rule}:{id}")).copied();
        let mut m = json!({});
        if let Some(t) = of("probe") {
            let p = value_of(t);
            m["probe"] = json!({ "seconds": p["seconds"], "fps": p["fps"], "timecode": p["timecode"], "audio": p["audio"].is_object() || p["audio"] == true,
                "profile": p["journey"]["profile"], "width": p["picture"]["width"], "height": p["picture"]["height"], "codec": p["picture"]["codec"] });
        }
        for (rule, k, n) in [("proxy", "proxy", 0), ("still", "still", 0), ("still", "preview", 1)] {
            if let Some(t) = of(rule) {
                m[k] = t["record"]["outputs"][n].clone();
            }
        }
        for rule in ["transcript", "analysis"] {
            if let Some(t) = of(rule) {
                let v = value_of(t);
                m[rule] = json!({ "state": v["state"].as_str().unwrap_or("done"), "task": t["entry"], "language": v["language"], "hero": v["hero"] });
            }
        }
        let open: Vec<Value> = tasks
            .iter()
            .filter(|t| t["record"]["inputs"][0]["entry"] == id && t["record"]["status"] != "done")
            .map(|t| json!({ "task": t["entry"], "rule": t["record"]["rule"], "status": t["record"]["status"], "error": t["record"]["error"] }))
            .collect();
        json!({ "entry": id, "vault": e["vault"], "title": e["title"], "media": e["media"], "len": e["files"][0]["len"], "tags": e["tags"],
            "created": e["created"], "copies": e["syncedTo"], "made": m, "open": open })
    }

    // ── avendb_studio_edit ─────────────────────────────────────────────────────────────────────────────────────

    /// Changes `ops` of entry `entry` (each names it): on its main line where every one of them may run there (the
    /// `may` ask), unless `propose`; else on a proposal line of the agent's own, which an AIP puts to the vault.
    async fn write(&self, entry: &str, vault: &str, ops: Vec<Value>, propose: bool) -> Result<Wrote> {
        if !propose {
            let may = self.node.op(json!({ "op": "may", "ops": ops })).await?;
            let all = may["ok"].as_array().is_some_and(|v| !v.is_empty() && v.iter().all(|x| x == true));
            if all {
                let done = self.run(json!({ "op": "batch", "ops": ops }), Beside::default()).await?;
                if done.get("ok").is_some() {
                    return Ok(Wrote { entry: entry.into(), vault: vault.into(), line: None });
                }
            }
        }
        let proposed = self.run(json!({ "op": "propose", "entry": entry, "name": self.name }), Beside::default()).await?;
        let line = proposed["ok"]["line"].as_str().map(String::from).with_context(|| {
            format!("{} may not even propose a change of entry {entry}: {} ({})", self.name, proposed["why"], proposed["refused"])
        })?;
        let on: Vec<Value> = ops
            .into_iter()
            .map(|mut op| {
                op["line"] = json!(line);
                op
            })
            .collect();
        let done = self.run(json!({ "op": "batch", "ops": on }), Beside::default()).await?;
        if done.get("ok").is_none() {
            bail!("the change of entry {entry} isn't written on its proposal: {} ({})", done["why"], done["refused"]);
        }
        Ok(Wrote { entry: entry.into(), vault: vault.into(), line: Some(line) })
    }

    /// A new entry of type `ty` in vault `vault`, tagged `tags`, holding `value`: on main where the agent's shares let
    /// it create one there, else as a draft, its own line; with the file at `path`, brought in its creation.
    async fn add(&self, vault: &str, ty: &str, tags: &[String], value: Value, file: Option<(&std::path::Path, Value)>) -> Result<Wrote> {
        let Some(adding) = self.adding(&[vault.to_string()], &[(ty, tags)]).await? else {
            bail!("{} may neither add nor draft an entry of type {ty} in vault {vault}: ask its person for access", self.name);
        };
        let tags = [tags.to_vec(), adding.asked.into_iter().flatten().collect()].concat();
        let answer = match (file, adding.draft) {
            (Some((path, f)), false) if ty == FILE => {
                let op = json!({ "op": "put_file", "vault": vault, "name": f["name"], "media": f["media"], "tags": tags });
                self.run(op, Beside { path: Some(path.to_path_buf()), overwrite: false }).await?
            }
            (Some((path, f)), draft) => {
                let op = json!({ "op": "create", "vault": vault, "type": ty, "tags": tags, "value": value, "draft": draft, "file": f });
                self.run(op, Beside { path: Some(path.to_path_buf()), overwrite: false }).await?
            }
            (None, draft) => {
                let op = json!({ "op": "create", "vault": vault, "type": ty, "tags": tags, "value": value, "draft": draft });
                self.run(op, Beside::default()).await?
            }
        };
        let entry = answer["ok"]["entry"].as_str().map(String::from).with_context(|| {
            format!("the {ty} isn't added: {} ({})", answer["why"].as_str().unwrap_or_default(), answer["refused"].as_str().unwrap_or_default())
        })?;
        let line = adding.draft.then(|| answer["ok"]["line"].as_str().map(String::from)).flatten();
        Ok(Wrote { entry, vault: vault.into(), line })
    }

    /// The answer of an edit: what it wrote, on main or on proposals, with `said` beside; and with `aip`
    /// (`{title, note}`), the proposals bundled in an AIP per vault and promoted, which a human of the vault accepts.
    async fn edited(&self, wrote: Vec<Wrote>, aip: &Value, said: Value) -> Result<String> {
        let mut out = said;
        out["main"] = wrote.iter().filter(|w| w.line.is_none()).map(|w| json!(w.entry)).collect::<Vec<_>>().into();
        let proposals: Vec<(&str, Value)> =
            wrote.iter().filter_map(|w| Some((w.vault.as_str(), json!({ "entry": w.entry, "line": w.line.as_ref()? })))).collect();
        if proposals.is_empty() {
            return Ok(out.to_string());
        }
        out["proposals"] = proposals.iter().map(|(_, p)| p.clone()).collect::<Vec<_>>().into();
        if !aip.is_object() {
            out["lands"] = LANDS.into();
            return Ok(out.to_string());
        }
        let title = text_arg(aip, "title").context("an AIP has a title: aip.title")?;
        let note = text_arg(aip, "note").context("an AIP says why and what changes: aip.note")?;
        let mut vaults: Vec<&str> = proposals.iter().map(|(v, _)| *v).collect();
        vaults.dedup();
        let mut aips = vec![];
        for v in vaults {
            let mine: Vec<Value> = proposals.iter().filter(|(x, _)| *x == v).map(|(_, p)| p.clone()).collect();
            let open = json!({ "op": "aip_open", "vault": v, "title": title, "note": note, "proposals": mine });
            let opened = self.run(open, Beside::default()).await?;
            let entry = opened["ok"]["entry"].as_str().with_context(|| format!("no AIP opened: {} ({})", opened["why"], opened["refused"]))?.to_string();
            let promoted = self.run(json!({ "op": "aip_promote", "entry": entry }), Beside::default()).await?;
            anyhow::ensure!(promoted.get("ok").is_some(), "the AIP {entry} isn't promoted: {} ({})", promoted["why"], promoted["refused"]);
            aips.push(json!({ "entry": entry, "vault": v, "promoted": promoted["ok"], "review": format!("/app/aips/?aip={entry}") }));
        }
        out["aips"] = aips.into();
        Ok(out.to_string())
    }

    /// avendb_studio_edit: a change of Studio 2 (`action`).
    pub(super) async fn studio_edit(&self, args: &Value) -> Result<String> {
        let action = text_arg(args, "action").context("avendb_studio_edit takes what it does: action")?;
        let aip = &args["aip"];
        let world = self.world().await?;
        let all = world["entries"].as_array().cloned().unwrap_or_default();
        let entry_of = |k: &str| -> Result<Value> {
            let id = text_arg(args, k).with_context(|| format!("name the entry: {k}"))?.to_ascii_lowercase();
            all.iter().find(|e| e["entry"] == id.as_str()).cloned().with_context(|| format!("{} reads no entry {id}", self.name))
        };
        let (when, secs) = now();
        // a cut's timeline, changed by `change`, saved as the studio saves it
        let cut_change = |change: &dyn Fn(&mut Value) -> Result<Value>| -> Result<(Value, Vec<Value>, String, String)> {
            let e = entry_of("entry")?;
            anyhow::ensure!(e["type"] == CUT, "entry {} is a {}, not a cut", e["entry"], e["type"]);
            let mut t = timeline_of(&e);
            let said = change(&mut t)?;
            let (id, vault) = (e["entry"].as_str().unwrap_or_default().to_string(), e["vault"].as_str().unwrap_or_default().to_string());
            Ok((said, saving(&id, &t, secs), id, vault))
        };
        let (wrote, said) = match action {
            "cut" => {
                let patch = args["patch"].as_object().context("a cut's changes: patch, the fields of its timeline to set")?.clone();
                let (said, ops, id, vault) = cut_change(&|t| {
                    for (k, v) in &patch {
                        t[k] = v.clone();
                    }
                    Ok(json!({ "changed": patch.keys().collect::<Vec<_>>() }))
                })?;
                (vec![self.write(&id, &vault, ops, false).await?], said)
            }
            "story_arc" => {
                let sections = args["sections"].as_array().context("the story's sections: sections")?.clone();
                let (said, ops, id, vault) = cut_change(&|t| Ok(json!({ "sections": set_arc(t, &sections)? })))?;
                (vec![self.write(&id, &vault, ops, false).await?], said)
            }
            "grade_stack" => {
                let stack = text_arg(args, "stack").context("which stack: base, clip, scene or timeline")?.to_string();
                let (clip, scene) = (text_arg(args, "clip").map(String::from), text_arg(args, "scene").map(String::from));
                let set = args.get("set").cloned().context("the stack to set: set (null takes it off)")?;
                let (said, ops, id, vault) = cut_change(&|t| {
                    set_stack(t, &stack, clip.as_deref(), scene.as_deref(), &set)?;
                    Ok(json!({ "stack": stack, "set": set }))
                })?;
                (vec![self.write(&id, &vault, ops, false).await?], said)
            }
            "balances" => {
                let shots = args["shots"].as_array().context("the balances: shots, as a balance task proposes them")?.clone();
                let (said, ops, id, vault) = cut_change(&|t| Ok(json!({ "balanced": set_balances(t, &shots)? })))?;
                (vec![self.write(&id, &vault, ops, false).await?], said)
            }
            "audio_mix" => {
                let clips = args["clips"].as_array().context("the sound clips' changes: clips")?.clone();
                let (said, ops, id, vault) = cut_change(&|t| Ok(json!({ "changed": mix(t, &clips)? })))?;
                (vec![self.write(&id, &vault, ops, false).await?], said)
            }
            "audio_eq" => {
                let eq = checked_eq(&args["eq"])?;
                let (named, track) = (texts_arg(args, "clips"), text_arg(args, "track").map(String::from));
                anyhow::ensure!(named.is_some() || track.is_some(), "which clips: clips, or a track (every clip with a file on it)");
                let (said, ops, id, vault) = cut_change(&|t| {
                    let ids: Vec<String> = t["clips"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|c| {
                            let id = c["id"].as_str().unwrap_or_default();
                            named.as_ref().is_some_and(|n| n.iter().any(|x| x == id))
                                || track.as_ref().is_some_and(|tr| c["track"] == tr.as_str() && c["hash"].is_string())
                        })
                        .filter_map(|c| c["id"].as_str().map(String::from))
                        .collect();
                    for id in named.iter().flatten() {
                        anyhow::ensure!(ids.contains(id), "no clip {id} on this cut");
                    }
                    let changes: Vec<Value> = ids.iter().map(|id| json!({ "clip": id, "eq": eq })).collect();
                    Ok(json!({ "changed": mix(t, &changes)?, "eq": eq }))
                })?;
                (vec![self.write(&id, &vault, ops, false).await?], said)
            }
            "transcript_edit" => self.transcript_edit(&entry_of("entry")?, args, &all, &when).await?,
            "record" => {
                let e = entry_of("entry")?;
                let id = e["entry"].as_str().unwrap_or_default().to_string();
                let set = args["set"].as_object().cloned().unwrap_or_default();
                let tags = texts_arg(args, "tags");
                anyhow::ensure!(!set.is_empty() || tags.is_some(), "what changes: set (fields and values), tags (the whole list)");
                let mut ops: Vec<Value> = set.iter().map(|(k, v)| json!({ "op": "set", "entry": id, "path": [k], "value": v })).collect();
                if let Some(tags) = &tags {
                    ops.push(json!({ "op": "set", "entry": id, "path": ["tags"], "value": tags }));
                }
                let vault = e["vault"].as_str().unwrap_or_default().to_string();
                (vec![self.write(&id, &vault, ops, false).await?], json!({ "entry": id, "set": set.keys().collect::<Vec<_>>(), "tags": tags }))
            }
            "create" => {
                let ty = text_arg(args, "type").context("the new entry's type: type (story, post, view, cut, …)")?;
                let mut value = args["value"].clone();
                anyhow::ensure!(value.is_object(), "the new entry's record: value");
                if value.get("kind").is_none() {
                    value["kind"] = json!(ty);
                }
                if ty == CUT && value.get("at").is_none() {
                    value["at"] = json!(secs);
                }
                let tags = texts_arg(args, "tags").unwrap_or_default();
                let vault = match text_arg(args, "vault") {
                    Some(v) => v.to_ascii_lowercase(),
                    None => self.coop().await?,
                };
                let made = self.add(&vault, ty, &tags, value, None).await?;
                let said = json!({ "entry": made.entry, "vault": vault, "type": ty, "draft": made.line.is_some() });
                (vec![made], said)
            }
            "delete" => {
                let ids = texts_arg(args, "entries").filter(|e| !e.is_empty()).context("the entries to delete: entries")?;
                text_arg(args, "why").context("say why: its person reads it before they accept the deletion")?;
                let mut wrote = vec![];
                for id in &ids {
                    let id = id.to_ascii_lowercase();
                    let e = all.iter().find(|e| e["entry"] == id.as_str()).with_context(|| format!("{} reads no entry {id}", self.name))?;
                    anyhow::ensure!(live(e), "entry {id} is deleted already");
                    let op = json!({ "op": "insert", "entry": id, "path": ["tags"], "value": DELETED });
                    // a deletion is always a person's: proposed, never written on main by an agent
                    wrote.push(self.write(&id, e["vault"].as_str().unwrap_or_default(), vec![op], true).await?);
                }
                (wrote, json!({ "deleting": ids, "why": args["why"] }))
            }
            "ingest" => {
                let paths = texts_arg(args, "paths").filter(|p| !p.is_empty()).context("the files of this Mac to bring in: paths, absolute")?;
                let tags = [vec![ORIGINAL.to_string()], texts_arg(args, "tags").unwrap_or_default()].concat();
                let vault = match text_arg(args, "vault") {
                    Some(v) => v.to_ascii_lowercase(),
                    None => self.coop().await?,
                };
                let mut wrote = vec![];
                let mut files = vec![];
                for p in &paths {
                    let path = std::path::PathBuf::from(p);
                    anyhow::ensure!(path.is_absolute(), "{p} isn't an absolute path");
                    let meta = tokio::fs::metadata(&path).await.with_context(|| format!("no file at {p}"))?;
                    anyhow::ensure!(meta.is_file(), "{p} is no file");
                    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).context("the path names no file")?;
                    let media = super::media_of(&name);
                    let value = json!({ "kind": FILE, "title": name, "media": media });
                    let made = self.add(&vault, FILE, &tags, value, Some((&path, json!({ "name": name, "media": media })))).await?;
                    files.push(json!({ "path": p, "entry": made.entry, "draft": made.line.is_some() }));
                    wrote.push(made);
                }
                (wrote, json!({ "vault": vault, "files": files, "then": "once in the Library (an AIP accepted, where it drafts), the Mac probes, proxies, stills, transcribes and analyses each by itself" }))
            }
            other => bail!(
                "avendb_studio_edit does no {other:?}: cut, story_arc, grade_stack, balances, audio_mix, audio_eq, transcript_edit, \
                 record, create, delete, ingest"
            ),
        };
        self.edited(wrote, aip, said).await
    }

    /// The vault a new entry goes in where an edit names none: its aven's coop, Maia City (`homes`).
    async fn coop(&self) -> Result<String> {
        let mine = self.node.read(|lab, me| lab.vault_of(me)).await.context("its device belongs to no vault yet")?;
        self.homes(mine).await.into_iter().next().context("its aven's coop isn't known to its device yet: name a vault")
    }

    /// The words of original `e`'s transcript put right (`fixes`), as a proposal of its transcript task, always: a
    /// short one onto the task's value, a long one into a draft JSON file of its own, which the task's value then
    /// names, as the Mac spills it, both landed by the AIP that names them.
    async fn transcript_edit(&self, e: &Value, args: &Value, all: &[Value], when: &str) -> Result<(Vec<Wrote>, Value)> {
        let fixes = args["fixes"].as_array().filter(|f| !f.is_empty()).context("the words put right: fixes, each {i, w}")?;
        let tasks = tasks_of(all);
        let made = made_index(&tasks);
        let id = e["entry"].as_str().unwrap_or_default();
        let t = made.get(&format!("transcript:{id}")).copied().context("this file has no transcript yet")?;
        let held = value_of(t);
        let before = self.full_value(t).await;
        anyhow::ensure!(before.get("error").is_none(), "its words aren't read: {}", before["error"]);
        let next = fixed(&before, fixes, &self.name, when)?;
        let (task, vault) = (t["entry"].as_str().unwrap_or_default(), t["vault"].as_str().unwrap_or_default());
        let text = next.to_string();
        let said = json!({ "entry": id, "task": task, "text": next["text"] });
        if text.len() <= SPILL {
            let op = json!({ "op": "set", "entry": task, "path": ["result"], "value": text });
            return Ok((vec![self.write(task, vault, vec![op], true).await?], said));
        }
        // a long one: its words into a draft JSON file, which the task's value names
        let dir = std::env::temp_dir().join(format!("avendb-agent-{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await?;
        let stem = e["title"].as_str().unwrap_or("transcript").rsplit_once('.').map_or(e["title"].as_str().unwrap_or("transcript"), |(s, _)| s);
        let name = format!("{stem}.transcript.json");
        let path = dir.join(&name);
        tokio::fs::write(&path, &text).await?;
        let value = json!({ "kind": FILE, "title": name, "media": "application/json" });
        let tags = vec!["media:transcript".to_string()];
        let op = json!({ "op": "create", "vault": vault, "type": FILE, "tags": tags, "value": value, "draft": true,
            "file": { "name": name, "media": "application/json" } });
        let answer = self.run(op, Beside { path: Some(path.clone()), overwrite: false }).await;
        tokio::fs::remove_file(&path).await.ok();
        let answer = answer?;
        let (Some(file), Some(line)) = (answer["ok"]["entry"].as_str(), answer["ok"]["line"].as_str()) else {
            bail!("its words aren't saved: {} ({})", answer["why"], answer["refused"]);
        };
        let mut small = json!({ "file": file, "state": "done" });
        for k in ["language", "seconds"] {
            if !held[k].is_null() {
                small[k] = held[k].clone();
            }
        }
        let mut outputs = t["record"]["outputs"].as_array().cloned().unwrap_or_default();
        outputs.push(json!(file));
        let ops = vec![
            json!({ "op": "set", "entry": task, "path": ["result"], "value": small.to_string() }),
            json!({ "op": "set", "entry": task, "path": ["outputs"], "value": outputs }),
        ];
        let draft = Wrote { entry: file.into(), vault: vault.into(), line: Some(line.into()) };
        Ok((vec![draft, self.write(task, vault, ops, true).await?], said))
    }

    // ── avendb_task ────────────────────────────────────────────────────────────────────────────────────────────

    /// avendb_task: a task asked of the Mac's studio worker, or one read, waited for: its answer, and any picture it
    /// made, inline.
    pub(super) async fn task(&self, args: &Value) -> Result<(String, Vec<Picture>)> {
        const TAKES: [&str; 6] = ["kind", "entry", "params", "task", "again", "wait"];
        if let Some(k) = args.as_object().into_iter().flatten().map(|(k, _)| k).find(|k| !TAKES.contains(&k.as_str())) {
            bail!("avendb_task takes no {k:?}: {}", TAKES.join(", "));
        }
        let wait = args["wait"].as_u64().unwrap_or(WAIT).min(WAIT_MOST);
        let again = args["again"] == true;
        let world = self.world().await?;
        let all = world["entries"].as_array().cloned().unwrap_or_default();
        let tasks = tasks_of(&all);
        let (task, known) = match (text_arg(args, "task"), text_arg(args, "kind")) {
            (Some(id), None) => {
                let id = id.to_ascii_lowercase();
                tasks.iter().find(|t| t["entry"] == id.as_str()).with_context(|| format!("{} reads no task {id}", self.name))?;
                if again {
                    self.again(&id).await?;
                }
                (id, true)
            }
            (None, Some(kind)) => {
                let id = text_arg(args, "entry").context("the entry the task is of: entry (a cut, a file, a shot version, an artifact)")?.to_ascii_lowercase();
                let e = all.iter().find(|e| e["entry"] == id.as_str()).with_context(|| format!("{} reads no entry {id}", self.name))?;
                let vault = e["vault"].as_str().unwrap_or_default();
                let rule = rule_of(kind, vault, &all)?.with_context(|| {
                    let keys: Vec<&str> = RULES.iter().map(|r| r.0).filter(|k| *k != "checksum").collect();
                    format!("no rule {kind:?}: {}", keys.join(", "))
                })?;
                let given = args["params"].as_object().cloned().unwrap_or_default();
                if let Some(k) = given.keys().find(|k| !rule.params.contains(k)) {
                    bail!("the {kind} rule takes no param {k:?}: {}", if rule.params.is_empty() { "none".into() } else { rule.params.join(", ") });
                }
                let made = made_index(&tasks.iter().copied().filter(|t| t["vault"] == vault).collect::<Vec<_>>());
                let (inputs, params) = pin(&rule, e, &made, &given)
                    .map_err(|waits| anyhow!("the {kind} rule waits for the {waits} of entry {id}: ask that first, or wait for the Mac to make it"))?;
                let me = self.node.read(|lab, me| lab.vault_of(me)).await.map(|v| super::hex(&v.0)).unwrap_or_default();
                let value = new_task(&rule, inputs, &params, &me, now().1);
                let key = value["key"].as_str().unwrap_or_default().to_string();
                match tasks.iter().find(|t| t["vault"] == vault && t["record"]["key"] == key.as_str()) {
                    Some(t) => {
                        let tid = t["entry"].as_str().unwrap_or_default().to_string();
                        if t["record"]["status"] == "held" || (again && t["record"]["status"] == "done") {
                            self.again(&tid).await?;
                        }
                        (tid, true)
                    }
                    None => {
                        let op = json!({ "op": "create", "vault": vault, "type": TASK, "value": value });
                        let made = self.run(op, Beside::default()).await?;
                        let tid = made["ok"]["entry"].as_str().with_context(|| {
                            format!(
                                "the {kind} task isn't asked: {} ({}); the aven asks tasks by a task asker's share on the vault's tasks, and \
                                 the vault holds the Task schema once its studio worker ran",
                                made["why"].as_str().unwrap_or_default(),
                                made["refused"].as_str().unwrap_or_default()
                            )
                        })?;
                        (tid.to_string(), false)
                    }
                }
            }
            _ => bail!("avendb_task asks a task (kind and entry, params if any) or reads one (task)"),
        };
        // waits for the worker's answer: done, or held after its tries
        let end = std::time::Instant::now() + std::time::Duration::from_secs(wait);
        let t = loop {
            let world = self.world().await?;
            let all = world["entries"].as_array().cloned().unwrap_or_default();
            let t = all.into_iter().find(|e| e["entry"] == task.as_str());
            let settled = t.as_ref().is_some_and(|t| ["done", "held"].contains(&t["record"]["status"].as_str().unwrap_or_default()));
            if settled || std::time::Instant::now() >= end {
                break t;
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        };
        let t = t.context("the task isn't on this device yet: read it again in a moment")?;
        let mut out = task_row(&t);
        out["known"] = json!(known);
        let r = &t["record"];
        let mut pictures = vec![];
        match r["status"].as_str() {
            Some("done") => {
                out["result"] = self.full_value(&t).await;
                let world = self.world().await?;
                let all = world["entries"].as_array().cloned().unwrap_or_default();
                let mut files = vec![];
                for o in r["outputs"].as_array().into_iter().flatten() {
                    let Some(f) = all.iter().find(|e| e["entry"] == *o) else { continue };
                    files.push(json!({ "entry": o, "title": f["title"], "media": f["media"], "len": f["files"][0]["len"] }));
                    let picture = f["media"].as_str().is_some_and(|m| m == "image/png" || m == "image/jpeg");
                    let shown = f["tags"].as_array().is_some_and(|ts| ts.iter().any(|x| x == "media:scopes" || x == "media:check"));
                    if picture && shown && f["files"][0]["len"].as_u64().is_some_and(|l| l <= 8 << 20) {
                        if let Ok(bytes) = self.bytes_of(o.as_str().unwrap_or_default()).await {
                            pictures.push((f["media"].as_str().unwrap_or_default().to_string(), bytes));
                        }
                    }
                }
                out["outputs"] = files.into();
            }
            Some("held") => out["note"] = json!("held after its tries: ask it again with again: true once what failed is put right"),
            _ => {
                out["note"] = json!(
                    "not done yet: the Mac's studio worker takes it up while The OS app is open on a Mac that hosts it, a round a minute; \
                     read it again with task and wait"
                )
            }
        }
        Ok((out.to_string(), pictures))
    }

    /// Task `task` asked again from nothing (`retrying`), as the person's Retry asks it.
    async fn again(&self, task: &str) -> Result<()> {
        let done = self.run(retrying(task), Beside::default()).await?;
        anyhow::ensure!(done.get("ok").is_some(), "the task isn't asked again: {} ({})", done["why"], done["refused"]);
        Ok(())
    }
}

/// A task as avendb_studio and avendb_task show it.
fn task_row(t: &Value) -> Value {
    let r = &t["record"];
    let inputs: Vec<Value> = r["inputs"].as_array().into_iter().flatten().map(|i| json!({ "name": i["name"], "entry": i["entry"] })).collect();
    json!({ "task": t["entry"], "vault": t["vault"], "rule": r["rule"], "version": r["version"], "lane": r["lane"], "status": r["status"],
        "attempts": r["attempts"], "error": r["error"], "worker": r["worker"], "params": serde_json::from_str::<Value>(r["params"].as_str().unwrap_or("{}")).unwrap_or_default(),
        "inputs": inputs, "outputs": r["outputs"], "key": r["key"], "at": r["at"] })
}

/// The MCP content of an answer: its text, and each picture inline, as an image.
pub(super) fn content(text: String, pictures: Vec<Picture>) -> Value {
    let mut out = vec![json!({ "type": "text", "text": text })];
    for (media, bytes) in pictures {
        out.push(json!({ "type": "image", "data": BASE64.encode(&bytes), "mimeType": media }));
    }
    out.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cut() -> Value {
        json!({ "entry": "e1", "vault": "v", "type": "cut", "tags": [], "deleted": false, "edits": 3, "files": [],
            "record": { "kind": "cut", "name": "Day 21", "stage": "edit", "version": 1, "at": 5,
                "timeline": json!({ "aspect": "16:9", "clips": [
                    { "id": "v1", "track": "V1", "start": 0, "dur": 4, "hash": "aven:x", "script": { "scene": "desk" } },
                    { "id": "a1", "track": "A1", "start": 0, "dur": 4, "hash": "aven:y", "vol": 1 },
                    { "id": "s", "track": "S1", "kind": "section", "start": 0, "dur": 1 }
                ] }).to_string() } })
    }

    #[test]
    fn the_key_of_an_ask_is_the_pages() {
        // the same asks as src/lib/studio/jobs/jobs.test.js: the same keys, so whoever asks, it is one task
        let entries = vec![cut()];
        let look = rule_of("look", "v", &entries).unwrap().unwrap();
        let given = json!({ "clips": ["c1"] }).as_object().cloned().unwrap();
        let (inputs, params) = pin(&look, &entries[0], &HashMap::new(), &given).unwrap();
        assert_eq!(inputs, vec![json!({ "id": 1, "name": "cut", "entry": "e1", "at": ["edits:3"] })]);
        let task = new_task(&look, inputs, &params, "aven", 5);
        assert_eq!(task["key"], "251edfd06035ae72379a7000284f1be31d7979d282547d0be0964ab222fec0e1");
        assert_eq!(task["params"], r#"{"clips":["c1"]}"#);
        assert_eq!((&task["lane"], &task["status"], &task["by"]), (&json!("gpu"), &json!("queued"), &json!("aven")));
        let frame = rule_of("frame", "v", &entries).unwrap().unwrap();
        let given = json!({ "t": 2.5, "shape": "9:16" }).as_object().cloned().unwrap();
        let (inputs, params) = pin(&frame, &entries[0], &HashMap::new(), &given).unwrap();
        assert_eq!(key_of(&frame, &inputs, &params), "d1f7fdc27dda750f11b4d158cecc2cb87ee82a38032856a6ae6fa76532c49a27");
    }

    #[test]
    fn a_rule_waits_for_what_it_reads_and_a_vault_overrides_or_turns_one_off() {
        let file = json!({ "entry": "f1", "vault": "v", "type": "file", "files": [{ "root": "r2" }, { "root": "r1" }], "record": {} });
        let proxy = rule_of("proxy", "v", &[]).unwrap().unwrap();
        assert_eq!(pin(&proxy, &file, &HashMap::new(), &Map::new()), Err("probe".to_string()));
        let probe = json!({ "entry": "t1", "vault": "v", "type": "task", "tags": [], "record": { "kind": "task", "rule": "probe", "status": "done",
            "key": "k1", "at": 1, "inputs": [{ "entry": "f1" }], "result": json!({ "journey": { "profile": "slog3" } }).to_string() } });
        let tasks = vec![&probe];
        let (inputs, params) = pin(&proxy, &file, &made_index(&tasks), &Map::new()).unwrap();
        assert_eq!(inputs[0]["at"], json!(["r1", "r2"]));
        assert_eq!(inputs[1], json!({ "id": 2, "name": "probe", "entry": "t1", "at": ["k1"] }));
        assert_eq!(params["probe.journey"], json!({ "profile": "slog3" }));
        // the still goes on without the analysis, which is optional
        let still = rule_of("still", "v", &[]).unwrap().unwrap();
        assert_eq!(still.inputs[0].0, "original");
        assert!(pin(&still, &file, &made_index(&tasks), &Map::new()).is_ok());
        let off = json!({ "entry": "r", "vault": "v", "type": "rule", "record": { "kind": "rule", "key": "render", "version": 2, "lane": "gpu", "off": true } });
        assert!(rule_of("render", "v", &[off]).is_err());
        let newer = json!({ "entry": "r", "vault": "v", "type": "rule", "record": { "kind": "rule", "key": "render", "version": 2, "lane": "gpu",
            "inputs": "{\"cut\":\"$entry\"}", "params": ["delivery", "fps"] } });
        let r = rule_of("render", "v", &[newer]).unwrap().unwrap();
        assert_eq!((r.version, r.params.len()), (2, 2));
        assert!(rule_of("nothing", "v", &[]).unwrap().is_none());
    }

    #[test]
    fn a_cuts_timeline_is_read_and_saved_as_the_studio_keeps_it() {
        let mut t = timeline_of(&cut());
        assert_eq!((&t["id"], &t["name"], &t["clips"].as_array().map(Vec::len)), (&json!("cut:e1"), &json!("Day 21"), &Some(3)));
        set_stack(&mut t, "base", Some("v1"), None, &json!({ "tools": [{ "tool": "balance", "exposure": 0.2 }] })).unwrap();
        set_stack(&mut t, "scene", Some("v1"), None, &json!({ "tools": [{ "tool": "window", "tools": [{ "tool": "lift" }] }] })).unwrap();
        set_stack(&mut t, "timeline", None, None, &json!({ "tools": [{ "tool": "grain" }] })).unwrap();
        assert!(set_stack(&mut t, "base", Some("v1"), None, &json!({ "tools": [{ "exposure": 1 }] })).is_err());
        assert!(set_stack(&mut t, "base", Some("nope"), None, &Value::Null).is_err());
        let st = stacks_of(&t);
        assert_eq!(st["shots"][0]["base"]["tools"][0]["exposure"], json!(0.2));
        assert_eq!(st["scenes"]["desk"]["tools"][0]["tool"], "window");
        set_balances(&mut t, &[json!({ "clip": "v1", "balance": { "exposure": 0.5, "linear": true } })]).unwrap();
        assert_eq!(t["clips"][0]["stacks"]["base"]["tools"][0], json!({ "tool": "balance", "exposure": 0.5, "linear": true }));
        mix(&mut t, &[json!({ "clip": "a1", "gain_db": -6.0, "fin": 0.5, "eq": [{ "type": "highpass", "f": 90 }] })]).unwrap();
        assert_eq!((&t["clips"][1]["vol"], &t["clips"][1]["fin"]), (&json!(0.501), &json!(0.5)));
        assert!(mix(&mut t, &[json!({ "clip": "v1", "vol": 1 })]).is_err(), "a picture clip has no mix");
        assert!(mix(&mut t, &[json!({ "clip": "a1", "eq": [{ "type": "peaking", "f": 1000 }] })]).is_err(), "a peak at 0 dB");
        assert_eq!(set_arc(&mut t, &[json!({ "section": "hook", "start": 0, "dur": 3, "tension": [[0, 10]] })]).unwrap(), 1);
        assert_eq!(t["clips"].as_array().unwrap().iter().filter(|c| c["kind"] == "section").count(), 1);
        let ops = saving("e1", &t, 9);
        let timeline: Value = serde_json::from_str(ops.iter().find(|o| o["path"] == json!(["timeline"])).unwrap()["value"].as_str().unwrap()).unwrap();
        assert!(timeline.get("name").is_none() && timeline.get("entry").is_none(), "the record's own fields stay on the record");
        assert_eq!(timeline["clips"][1]["eq"][0]["type"], "highpass");
        assert!(ops.iter().any(|o| o["path"] == json!(["name"]) && o["value"] == "Day 21"));
        assert!(ops.iter().any(|o| o["path"] == json!(["at"]) && o["value"] == 9));
    }

    fn words() -> Value {
        json!({
            "text": "Day twenty. The city starts with one street.", "language": "en",
            "words": [
                { "w": "Day", "s": 0.48, "e": 0.8 }, { "w": "twenty.", "s": 0.8, "e": 1.3 }, { "w": "The", "s": 1.84, "e": 2.0 },
                { "w": "city", "s": 2.0, "e": 2.4 }, { "w": "starts", "s": 2.4, "e": 2.8 }, { "w": "with", "s": 2.8, "e": 2.96 },
                { "w": "one", "s": 2.96, "e": 3.28 }, { "w": "street.", "s": 3.28, "e": 3.78 }
            ],
            "utterances": [{ "s": 0.48, "e": 1.3, "text": "Day twenty." }, { "s": 1.84, "e": 3.78, "text": "The city starts with one street." }]
        })
    }

    #[test]
    fn words_are_found_read_by_a_clip_and_put_right() {
        assert_eq!(find_phrase(&words(), &tokens("One STREET")), vec![(2.96, 3.78, "The city starts with one street.".to_string())]);
        assert_eq!(find_phrase(&words(), &tokens("twenty the")).len(), 1);
        let probe = json!({ "timecode": "10:00:00:00", "timecode_fps": 25.0 });
        let v = transcript_view(&words(), &probe, Some(2.0), Some(3.0));
        assert_eq!(v["text"], "city starts with one");
        assert_eq!(v["words"][0]["tc"], "10:00:02:00");
        assert_eq!(timecode(&json!({ "timecode": "14:03:22:11", "timecode_fps": 23.976 }), &Value::Null, 2.96).as_deref(), Some("14:03:25:10"));
        assert_eq!(transcript_summary(&words())["words"], 8);
        let fixed = fixed(&words(), &[json!({ "i": 3, "w": "village" }), json!({ "i": 7, "w": "one road." })], "agentClaude", "2026-10-18T10:00:00Z").unwrap();
        assert_eq!(fixed["text"], "Day twenty. The village starts with one one road.");
        assert_eq!(fixed["utterances"][1]["text"], "The village starts with one one road.");
        assert_eq!(fixed["edited"]["by"], "agentClaude");
        assert_eq!(fixed["words"].as_array().unwrap().len(), 9);
        assert!(super::fixed(&words(), &[json!({ "i": 99, "w": "x" })], "a", "t").is_err());
    }

    #[test]
    fn the_best_take_comes_first() {
        let analysis = json!({
            "summary": { "line": "Samuel opens Day 20 at his desk.", "best_use": "The opener." },
            "tags": { "shot_size": "MCU", "quality": [] },
            "segments": [{ "s": 0.0, "e": 12.0, "tags": { "shot_size": "MCU" }, "line": "He speaks." }, { "s": 12.0, "e": 30.0, "tags": { "shot_size": "WS" }, "line": "He walks to the window." }],
            "cues": [
                { "s": 0.4, "e": 3.8, "kind": "take", "label": "opening line · take 1", "take_of": "opening line", "take": 1, "rank": 2, "confidence": 0.8 },
                { "s": 4.6, "e": 8.1, "kind": "take", "label": "opening line · take 2", "take_of": "opening line", "take": 2, "rank": 1, "best": true, "confidence": 0.85 },
                { "s": 2.1, "e": 2.6, "kind": "problem", "label": "false start", "confidence": 0.9 },
                { "s": 14.0, "e": 16.0, "kind": "highlight", "label": "light through the window", "confidence": 0.7 }
            ]
        });
        let shot = Shot { entry: "f".into(), vault: "v".into(), title: "A001.MOV".into(), tags: vec![], analysis: analysis.clone(),
            transcript: json!({ "words": [{ "w": "twenty.", "s": 5.0, "e": 5.5 }] }), probe: json!({ "timecode": "10:00:00:00", "timecode_fps": 25.0 }), proxy: Value::Null };
        let list = vec![shot];
        let hits = find_shots(&list, &Query { text: "opening line".into(), limit: 10, ..Default::default() });
        assert_eq!((&hits[0]["take"], &hits[0]["tc_in"]), (&json!(2), &json!("10:00:04:15")));
        assert_eq!(find_shots(&list, &Query { text: "twenty".into(), limit: 10, ..Default::default() })[0]["take"], 2);
        let ws = find_shots(&list, &Query { tags: vec![("shot_size".into(), vec!["ws".into()])], limit: 10, ..Default::default() });
        assert_eq!((ws.len(), &ws[0]["kind"]), (1, &json!("highlight")));
        assert_eq!(analysis_summary(&analysis)["takes"], 2);
        assert_eq!(analysis_view(&analysis, &Value::Null, Some(10.0), None)["cues"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn the_grading_tools_are_the_registry() {
        let tools: Value = serde_json::from_str(GRADE_TOOLS).unwrap();
        assert!(tools.is_object() || tools.is_array());
    }
}
