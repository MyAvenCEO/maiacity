//! rust-security's three tools, ported from Trail of Bits' rust-review scripts (trailofbits/skills, CC-BY-SA 4.0):
//!
//!   sec rust-plan      the run plan: plan.json + worker-prompts/ from prompts/clusters/manifest.json (build_run_plan.py)
//!   sec rust-validate  Phase 7 worker artifacts checked against plan.json (validate_artifacts.py)
//!   sec rust-sarif     REPORT.sarif from the findings' frontmatter (generate_sarif.py)

use crate::obj;
use crate::util::{Args, def, list, many, opt, pretty, py_repr, py_str, req, truthy};
use regex::Regex;
use serde_json::{Map, Value, json};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

// ---- frontmatter (shared by sarif and validate) -------------------------------------------------------------------

/// A finding file's frontmatter and body; an error on a malformed block (a scalar key, then a `  - ` item), as the
/// Python raised.
pub fn split_frontmatter(text: &str) -> Result<(Map<String, Value>, String), String> {
    if !text.starts_with("---\n") {
        return Ok((Map::new(), text.into()));
    }
    let Some(end) = text[4..].find("\n---").map(|i| i + 4) else { return Ok((Map::new(), text.into())) };
    let fm = &text[4..end];
    let body = text[end + 4..].trim_start_matches('\n').to_string();
    Ok((parse_frontmatter(fm)?, body))
}

fn parse_frontmatter(fm: &str) -> Result<Map<String, Value>, String> {
    let mut result = Map::new();
    let mut current: Option<String> = None;
    for raw in crate::util::splitlines(fm) {
        let line = raw.trim_end();
        if line.is_empty() {
            continue;
        }
        if let (Some(rest), Some(key)) = (line.strip_prefix("  - "), current.as_ref()) {
            let e = result.entry(key.clone()).or_insert_with(|| json!([]));
            match e {
                Value::Array(a) => a.push(parse_scalar(rest)),
                Value::Bool(_) => return Err("'bool' object has no attribute 'append'".into()),
                _ => return Err("'str' object has no attribute 'append'".into()),
            }
            continue;
        }
        if !line.contains(':') || line.starts_with(' ') || line.starts_with('\t') {
            current = None;
            continue;
        }
        let (k, v) = line.split_once(':').unwrap();
        let (k, v) = (k.trim().to_string(), v.trim());
        current = Some(k.clone());
        result.insert(k, if v.is_empty() { json!([]) } else { parse_scalar(v) });
    }
    Ok(result)
}

fn split_inline_list(inner: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut buf = String::new();
    let mut quote: Option<char> = None;
    for ch in inner.chars() {
        if let Some(q) = quote {
            buf.push(ch);
            if ch == q {
                quote = None;
            }
        } else if ch == '"' || ch == '\'' {
            quote = Some(ch);
            buf.push(ch);
        } else if ch == ',' {
            parts.push(buf.trim().to_string());
            buf.clear();
        } else {
            buf.push(ch);
        }
    }
    if !buf.is_empty() {
        parts.push(buf.trim().to_string());
    }
    parts
}

fn parse_scalar(value: &str) -> Value {
    let v = value.trim();
    if (v.starts_with('"') && v.ends_with('"') && !v.is_empty()) || (v.starts_with('\'') && v.ends_with('\'') && !v.is_empty()) {
        // a lone quote is both ends, which Python sliced to ""
        return Value::String(if v.len() >= 2 { v[1..v.len() - 1].into() } else { String::new() });
    }
    if v.starts_with('[') && v.ends_with(']') {
        let inner = v[1..v.len() - 1].trim();
        if inner.is_empty() {
            return json!([]);
        }
        return Value::Array(split_inline_list(inner).iter().map(|p| parse_scalar(p)).collect());
    }
    match v.to_lowercase().as_str() {
        "true" => Value::Bool(true),
        "false" => Value::Bool(false),
        _ => Value::String(v.into()),
    }
}

// ---- rust-sarif ---------------------------------------------------------------------------------------------------

fn severity_order(s: &str) -> u8 {
    match s {
        "LOW" => 1,
        "MEDIUM" => 2,
        "HIGH" => 3,
        "CRITICAL" => 4,
        _ => 0,
    }
}
fn sarif_level(s: &str) -> &'static str {
    match s.to_uppercase().as_str() {
        "CRITICAL" | "HIGH" => "error",
        "MEDIUM" => "warning",
        "LOW" => "note",
        _ => "warning",
    }
}
fn filter_min(f: &str) -> u8 {
    match f {
        "medium" => 2,
        "high" => 3,
        _ => 1,
    }
}
const SURVIVORS: [&str; 2] = ["TRUE_POSITIVE", "LIKELY_TP"];
// Findings with no fp_verdict (the fp-judge skipped on a partial run) go out with this verdict, so the SARIF safety
// net still shows them (SKILL.md Phase 8b).
const UNJUDGED_FALLBACK_VERDICT: &str = "LIKELY_TP";

/// The bug_class slugs of prompts/clusters/manifest.json.
const RULE_DESCRIPTIONS: &[(&str, &str)] = &[
    ("unsafe-reaching-api", "Safe API reaches unsafe without a sound boundary proof"),
    ("transmute-misuse", "Incorrect mem::transmute or transmute_copy usage"),
    ("raw-pointer-arith", "Raw pointer arithmetic without proven bounds or validity"),
    ("repr-c-layout", "Unsound #[repr(C)] layout for FFI or foreign memory"),
    ("safety-doc", "Missing or incorrect // SAFETY: at an unsafe site"),
    ("debug-assert-safety", "debug_assert! is the only safety invariant in release builds"),
    ("pointer-cast", "Unsound cast via `as` between pointers, integers, or enums"),
    ("enum-discriminant", "Invalid enum discriminant or niche read/write"),
    ("use-after-free", "Use-after-free via dangled raw pointer"),
    ("double-free", "Double free via ptr::read or duplicate drop"),
    ("invalid-free", "Invalid free via write to uninitialized memory"),
    ("uninitialized-read", "Read from MaybeUninit before assume_init"),
    ("buffer-overflow-unsafe", "Safe index or size flows into unchecked unsafe access"),
    ("union-ub", "Undefined behavior from union field misuse"),
    ("vec-set-len-uninit", "Vec length advanced without initializing new elements"),
    ("panic-unwind-unsafe", "Panic during unsafe container mutation leaves stale metadata"),
    ("double-lock-deadlock", "MutexGuard double-lock from lexical scope"),
    ("abba-deadlock", "ABBA lock ordering deadlock"),
    ("condvar-misuse", "Condvar wait without a matching notifier"),
    ("channel-starvation", "Channel send or receive starvation or deadlock"),
    ("once-reentrancy", "Once::call_once reentrancy hazard"),
    ("reentrancy-unsafe", "Signal handler or callback reentrancy across unsafe code"),
    ("atomic-race", "Non-atomic read-modify-write race on shared state"),
    ("unsafe-sync-impl", "unsafe impl Sync over interior mutability"),
    ("send-sync-bounds", "Missing or incorrect Send or Sync bounds"),
    ("shared-memory-race", "Cross-process shared memory data race"),
    ("static-mut-race", "Unsynchronized read or write of static mut across threads"),
    ("resource-exhaustion", "CPU or memory exhaustion DoS on untrusted input"),
    ("unwrap-on-untrusted", "unwrap or expect on attacker-controlled input"),
    ("arithmetic-overflow", "Integer overflow on an attacker-reachable path"),
    ("assertion-reachable", "Attacker-reachable assert! or unreachable! panic"),
    ("out-of-bounds-index", "Slice or vector index without bounds check on untrusted input"),
    ("str-slice-boundary", "str slice or split_at panic off a UTF-8 char boundary"),
    ("refcell-borrow-panic", "Attacker-reachable RefCell double-borrow panic"),
    ("recursive-deserialize-stack-overflow", "Unbounded recursive Deserialize stack overflow"),
    ("recursive-format-stack-overflow", "Recursive Display, Debug, or Serialize stack overflow"),
    ("recursive-drop-stack-overflow", "Implicit recursive Drop of Box<Self> chain"),
    ("result-discarded", "Security-relevant Result discarded without handling"),
    ("drop-panic", "Panic inside a Drop implementation"),
    ("lossy-from-into", "Lossy From, Into, or as conversion"),
    ("lossy-str-conversion", "Lossy UTF-8 or OS string or path conversion"),
    ("bufwriter-unflushed", "BufWriter dropped without flush swallows write errors"),
    ("ord-eq-hash", "Ord, Eq, or Hash invariant violation"),
    ("adversarial-trait", "Hostile generic trait impl breaks invariants"),
    ("closure-panic", "Closure may panic across unsafe scaffolding"),
    ("float-edge", "NaN or Inf float comparison or ordering edge case"),
    ("string-comparison", "Partial or case-insensitive string comparison bypasses a check"),
    ("serialize-struct-mismatch", "serialize_struct field-count mismatch corrupts output"),
    ("nondeterminism", "Nondeterministic iteration or hashing in replicated state"),
    ("collection-key-mutation", "Mutating a key already stored in a map or set"),
    ("cstring-dangling", "CString::as_ptr used after CString is dropped"),
    ("abi-mismatch", "FFI ABI signature or calling convention mismatch"),
    ("repr-c-padding", "#[repr(C)] padding leaks uninitialized data"),
    ("opaque-pointer", "Opaque pointer ownership confusion across FFI"),
    ("foreign-drop", "Mismatched drop of FFI-allocated memory"),
    ("closure-ffi", "Rust closure across extern C without catch_unwind"),
    ("dyn-trait-ffi", "dyn Trait fat pointer unsafely crosses FFI"),
    ("async-blocking", "Blocking call inside an async runtime"),
    ("cancel-safety", "Cancellation-unsafe .await sequence"),
    ("select-bias", "tokio::select! branch bias or fairness issue"),
    ("cargo-lint-config", "Cargo lint config weakens safety checks"),
    ("msrv-mismatch", "MSRV or edition mismatch with APIs in use"),
    ("deprecated-api", "Deprecated unsafe API (e.g. mem::uninitialized)"),
    ("packed-field-ref", "Reference to field of repr(packed) struct"),
    ("raw-fd-lifecycle", "Raw file descriptor double-close or leak"),
    ("destructor-skip", "Drop skipped via process::exit or mem::forget leaks cleanup"),
    ("path-traversal-join", "Path::join with attacker input escapes the intended directory"),
    ("toctou", "Filesystem time-of-check to time-of-use race"),
    ("pointer-exposure", "Raw memory address leaked to an externally observable sink"),
];

fn title_case(s: &str) -> String {
    // str.title(): the first letter of each run of letters upper, the rest lower
    let mut out = String::new();
    let mut prev_alpha = false;
    for c in s.chars() {
        if c.is_alphabetic() {
            if prev_alpha { out.extend(c.to_lowercase()) } else { out.extend(c.to_uppercase()) }
            prev_alpha = true;
        } else {
            out.push(c);
            prev_alpha = false;
        }
    }
    out
}

fn normalize_path(p: &str) -> String {
    let mut p = p.replace('\\', "/");
    while let Some(rest) = p.strip_prefix("./") {
        p = rest.to_string();
    }
    while p.contains("//") {
        p = p.replace("//", "/");
    }
    p
}

fn location_parts(location: Option<&Value>) -> (String, i64) {
    let value = if truthy(location) { py_str(location.unwrap()) } else { String::new() };
    if value.contains(',') || value.contains('\n') {
        return (value, 1);
    }
    // SARIF startLine has a minimum of 1, so a `:0` line is clamped
    let md = Regex::new(r"^\[([^\]]+)\]\([^)]+\):(\d+)$").unwrap();
    if let Some(m) = md.captures(&value) {
        return (normalize_path(&m[1]), m[2].parse::<i64>().unwrap_or(1).max(1));
    }
    if let Some((path, line)) = value.rsplit_once(':') {
        if !line.is_empty() && line.chars().all(|c| c.is_ascii_digit()) {
            return (normalize_path(path), line.parse::<i64>().unwrap_or(1).max(1));
        }
        if line.is_empty() {
            return (normalize_path(path), 1);
        }
    }
    (normalize_path(&value), 1)
}

fn sv(f: &Map<String, Value>, k: &str, default: &str) -> String {
    f.get(k).map(py_str).unwrap_or_else(|| default.into())
}

fn iter_findings(out_dir: &Path) -> (Vec<Map<String, Value>>, Vec<(String, String)>) {
    let mut findings = Vec::new();
    let mut skipped = Vec::new();
    let index = out_dir.join("findings-index.txt");
    let paths: Vec<PathBuf> = if index.exists() {
        fs::read_to_string(&index).unwrap_or_default().lines().map(str::trim).filter(|l| !l.is_empty()).map(PathBuf::from).collect()
    } else {
        let mut v: Vec<PathBuf> = fs::read_dir(out_dir.join("findings"))
            .map(|d| d.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "md")).collect())
            .unwrap_or_default();
        v.sort();
        v
    };
    for p in paths {
        let path = if p.is_absolute() { p } else { out_dir.join(p) };
        let shown = path.display().to_string();
        // a stale index entry must not crash the Phase-8b safety net, whose job is that REPORT.sarif exists
        let text = match fs::read_to_string(&path) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("warning: skipping unreadable finding file {shown}: {e}");
                skipped.push((shown, format!("unreadable ({})", if e.kind() == std::io::ErrorKind::NotFound { "FileNotFoundError" } else { "OSError" })));
                continue;
            }
        };
        match split_frontmatter(&text) {
            Ok((mut fm, _)) => {
                fm.insert("_path".into(), Value::String(shown));
                findings.push(fm);
            }
            Err(e) => {
                eprintln!("warning: skipping unparseable finding file {shown}: {e}");
                skipped.push((shown, "unparseable (AttributeError)".into()));
            }
        }
    }
    (findings, skipped)
}

pub fn build_sarif(out_dir: &Path) -> Value {
    let context = fs::read_to_string(out_dir.join("context.md")).ok().and_then(|t| split_frontmatter(&t).ok()).map(|x| x.0).unwrap_or_default();
    let severity_filter = sv(&context, "severity_filter", "all").to_lowercase();
    let threat_model = sv(&context, "threat_model", "UNKNOWN");
    let (mut all, mut skipped) = iter_findings(out_dir);

    // a merged finding is skipped only when its merge target survives, so a real bug whose target was rejected stays
    let mut by_id: HashMap<String, usize> = HashMap::new();
    for (i, f) in all.iter().enumerate() {
        if truthy(f.get("id")) {
            by_id.insert(py_str(&f["id"]), i);
        }
    }
    let terminal = |all: &Vec<Map<String, Value>>, mut fid: String| -> Option<String> {
        let mut seen = HashSet::new();
        while let Some(&i) = by_id.get(&fid) {
            if !seen.insert(fid.clone()) {
                break;
            }
            match all[i].get("merged_into") {
                Some(n) if truthy(Some(n)) => fid = py_str(n),
                _ => return Some(fid),
            }
        }
        None
    };
    let has_ident = |f: &Map<String, Value>| truthy(f.get("id")) || truthy(f.get("bug_class")) || truthy(f.get("title"));

    let mut survivors = HashSet::new();
    for f in &all {
        if f.contains_key("merged_into") || !has_ident(f) {
            continue;
        }
        let verdict = sv(f, "fp_verdict", "").to_uppercase();
        if !verdict.is_empty() && !SURVIVORS.contains(&verdict.as_str()) {
            continue;
        }
        if truthy(f.get("id")) {
            survivors.insert(py_str(&f["id"]));
        }
    }

    let mut kept: Vec<Map<String, Value>> = Vec::new();
    for idx in 0..all.len() {
        let target = all[idx].get("merged_into").cloned();
        if truthy(target.as_ref()) {
            let t = py_str(target.as_ref().unwrap());
            if terminal(&all, t.clone()).is_some_and(|p| survivors.contains(&p)) {
                continue;
            }
            eprintln!("generate_sarif: merge target did not survive -- emitting {} (merged_into: {t}): {}", sv(&all[idx], "id", "?"), sv(&all[idx], "_path", "?"));
        }
        let f = &mut all[idx];
        if !has_ident(f) {
            // no parseable frontmatter (a worker crashed mid-write): skipped, never a phantom "unknown" result
            let path = sv(f, "_path", "?");
            eprintln!("generate_sarif: skipping finding with no parseable frontmatter: {path}");
            skipped.push((path, "no parseable frontmatter".into()));
            continue;
        }
        let verdict = sv(f, "fp_verdict", "").to_uppercase();
        let unjudged = verdict.is_empty();
        if unjudged {
            // fp-judge skipped (partial run): LIKELY_TP, severity from the worker's confidence
            f.insert("fp_verdict".into(), UNJUDGED_FALLBACK_VERDICT.into());
            if !f.contains_key("severity") {
                let s = match sv(f, "confidence", "").to_uppercase().as_str() {
                    "LOW" => "LOW",
                    _ => "MEDIUM",
                };
                f.insert("severity".into(), s.into());
            }
            f.insert("unjudged".into(), true.into());
        } else if !SURVIVORS.contains(&verdict.as_str()) {
            continue;
        }
        // a judged survivor the fp-judge never gave a severity is shown, defaulted and marked, never dropped
        let sev = sv(f, "severity", "").to_uppercase();
        let unvalidated = !unjudged && severity_order(&sev) == 0;
        if unvalidated {
            f.insert("severity".into(), "MEDIUM".into());
            f.insert("severity_missing".into(), true.into());
        }
        // only validated severities are filtered; inferred ones always show (SKILL.md Phase 8b)
        if !unjudged && !unvalidated && severity_order(&sev) < filter_min(&severity_filter) {
            continue;
        }
        kept.push(f.clone());
    }

    let classes: BTreeSet<String> = kept.iter().map(|f| sv(f, "bug_class", "unknown")).collect();
    let rules: Vec<Value> = classes
        .iter()
        .map(|bc| {
            let max = kept.iter().filter(|f| f.get("bug_class").map(py_str).as_deref() == Some(bc.as_str())).map(|f| sv(f, "severity", "LOW").to_uppercase()).fold("LOW".to_string(), |m, s| if severity_order(&s) > severity_order(&m) { s } else { m });
            let text = RULE_DESCRIPTIONS.iter().find(|(k, _)| k == bc).map(|(_, d)| d.to_string()).unwrap_or_else(|| title_case(&bc.replace('-', " ")));
            obj! { "id" => bc.clone(), "shortDescription" => obj! { "text" => text }, "defaultConfiguration" => obj! { "level" => sarif_level(&max) } }
        })
        .collect();

    let results: Vec<Value> = kept
        .iter()
        .map(|f| {
            let (location, line) = location_parts(f.get("location"));
            let location_missing = location.is_empty();
            let severity = sv(f, "severity", "MEDIUM").to_uppercase();
            let aka = match f.get("also_known_as") {
                None => json!([]),
                Some(Value::Array(a)) => Value::Array(a.clone()),
                Some(v) => json!([py_str(v)]),
            };
            let unjudged = truthy(f.get("unjudged"));
            let severity_missing = truthy(f.get("severity_missing"));
            let validated = !(unjudged || severity_missing);
            let mut title = if truthy(f.get("title")) { py_str(&f["title"]) } else if truthy(f.get("id")) { py_str(&f["id"]) } else { "rust-review finding".into() };
            let mut markers = Vec::new();
            if !validated {
                markers.push("UNVALIDATED SEVERITY — not judged");
            }
            if location_missing {
                markers.push("LOCATION MISSING");
            }
            if !markers.is_empty() {
                title = format!("[{}] {title}", markers.join("; "));
            }
            obj! {
                "ruleId" => sv(f, "bug_class", "unknown"),
                "level" => sarif_level(&severity),
                "message" => obj! { "text" => title },
                "locations" => json!([{ "physicalLocation": { "artifactLocation": { "uri": location, "uriBaseId": "%SRCROOT%" }, "region": { "startLine": line } } }]),
                "properties" => obj! {
                    "finding_id" => sv(f, "id", ""),
                    "bug_class" => sv(f, "bug_class", "unknown"),
                    "severity" => severity,
                    "attack_vector" => sv(f, "attack_vector", ""),
                    "exploitability" => sv(f, "exploitability", ""),
                    "fp_verdict" => sv(f, "fp_verdict", ""),
                    "unjudged" => unjudged,
                    "severity_validated" => validated,
                    "location_missing" => location_missing,
                    "also_known_as" => aka,
                },
            }
        })
        .collect();

    // dropped files are named in the artifact itself; the run stays executionSuccessful, since flipping it can make a
    // platform discard every good finding too
    let mut invocation = obj! {
        "executionSuccessful" => true,
        "properties" => obj! { "threat_model" => threat_model, "severity_filter" => severity_filter, "skipped_findings" => skipped.len() },
    };
    if !skipped.is_empty() {
        invocation["properties"]["skipped_paths"] = json!(skipped.iter().map(|s| s.0.clone()).collect::<Vec<_>>());
        invocation["toolExecutionNotifications"] =
            Value::Array(skipped.iter().map(|(p, r)| json!({ "level": "warning", "message": { "text": format!("Skipped finding file (excluded from results): {p} — {r}") } })).collect());
    }
    obj! {
        "$schema" => "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
        "version" => "2.1.0",
        "runs" => json!([{
            "tool": { "driver": { "name": "rust-review", "informationUri": "https://github.com/trailofbits/skills/tree/main/plugins/rust-review", "rules": rules } },
            "originalUriBaseIds": { "%SRCROOT%": { "description": { "text": "Root of the audited Rust crate or workspace; finding URIs are relative to this." } } },
            "invocations": [invocation],
            "results": results,
        }]),
    }
}

pub fn sarif_main(argv: &[String]) -> i32 {
    let a = Args::parse("sec rust-sarif", argv, &[opt("output")], 1);
    let out_dir = fs::canonicalize(&a.positional[0]).unwrap_or_else(|_| PathBuf::from(&a.positional[0]));
    let out_path = a.get("output").map(PathBuf::from).unwrap_or_else(|| out_dir.join("REPORT.sarif"));
    let sarif = build_sarif(&out_dir);
    if let Err(e) = fs::write(&out_path, pretty(&sarif) + "\n") {
        eprintln!("generate_sarif: cannot write {}: {e}", out_path.display());
        return 1;
    }
    println!("wrote {}", out_path.display());
    let n = sarif["runs"][0]["invocations"][0]["properties"]["skipped_findings"].as_u64().unwrap_or(0);
    // on stdout too, so the orchestrator's Bash capture sees the loss
    if n > 0 {
        println!("WARNING: skipped {n} unreadable/frontmatterless finding file(s) — see REPORT.sarif invocations[].properties.skipped_findings");
    }
    0
}

// ---- rust-validate ------------------------------------------------------------------------------------------------

fn normalize_worker_id(v: &str) -> Result<String, String> {
    let suffix = v.strip_prefix("worker-").unwrap_or(v);
    if suffix.is_empty() || !suffix.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("invalid worker id: {}", py_repr(v)));
    }
    Ok(format!("worker-{}", suffix.parse::<u64>().map_err(|e| e.to_string())?))
}

fn parse_claimed_counts(values: &[String]) -> Result<HashMap<String, i64>, String> {
    let mut claimed = HashMap::new();
    for v in values {
        let Some((w, c)) = v.split_once('=') else { return Err(format!("invalid --claimed-count {}; expected worker-N=N", py_repr(v))) };
        let id = normalize_worker_id(w)?;
        let n: i64 = c.trim().parse().map_err(|_| format!("invalid claimed count for {id}: {}", py_repr(c)))?;
        if n < 0 {
            return Err(format!("invalid claimed count for {id}: {n}"));
        }
        claimed.insert(id, n);
    }
    Ok(claimed)
}

fn stem(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

fn frontmatter_id(path: &Path) -> Result<Option<String>, String> {
    let Ok(text) = fs::read_to_string(path) else { return Ok(None) };
    let (fm, _) = split_frontmatter(&text)?;
    Ok(fm.get("id").filter(|v| !v.is_null()).map(py_str))
}

fn validate_worker(id: &str, worker: &Value, out_dir: &Path, claimed: &HashMap<String, i64>) -> Result<Vec<String>, String> {
    let mut errors = Vec::new();
    let n: u64 = id["worker-".len()..].parse().unwrap();
    let shard = out_dir.join("findings-index.d").join(format!("worker-{n}.txt"));
    let coverage = out_dir.join("coverage").join(format!("worker-{n}.md"));
    let mut shard_paths: Vec<PathBuf> = Vec::new();
    let mut shard_ids: Vec<(String, PathBuf)> = Vec::new();
    if !shard.is_file() {
        errors.push(format!("{id}: missing shard {}", shard.display()));
    } else {
        for line in fs::read_to_string(&shard).map_err(|e| e.to_string())?.lines() {
            let raw = line.trim();
            if raw.is_empty() {
                continue;
            }
            let p = PathBuf::from(raw);
            let p = if p.is_absolute() { p } else { out_dir.join(p) };
            shard_paths.push(p.clone());
            let s = stem(&p);
            shard_ids.retain(|(k, _)| *k != s);
            shard_ids.push((s, p));
        }
        let findings_dir = fs::canonicalize(out_dir.join("findings")).unwrap_or_else(|_| out_dir.join("findings"));
        for p in &shard_paths {
            if !p.is_file() {
                errors.push(format!("{id}: shard references missing finding file {}", p.display()));
                continue;
            }
            if fs::canonicalize(p).ok().and_then(|r| r.parent().map(Path::to_path_buf)) != Some(findings_dir.clone()) {
                errors.push(format!("{id}: shard references finding file outside findings/: {}", p.display()));
            }
            let name = p.file_name().unwrap().to_string_lossy();
            match frontmatter_id(p) {
                // generate_sarif would skip this file and drop the finding, so it is a hard error here
                Err(e) => errors.push(format!("{id}: finding {name} has unparseable frontmatter (generate_sarif would drop it): {e}")),
                Ok(None) => errors.push(format!("{id}: finding {name} has no parseable frontmatter id")),
                Ok(Some(d)) if d != stem(p) => errors.push(format!("{id}: finding {name} frontmatter id {} does not match its filename stem {}", py_repr(&d), py_repr(&stem(p)))),
                Ok(Some(_)) => {}
            }
        }
    }
    if let Some(&c) = claimed.get(id) {
        if c != shard_paths.len() as i64 {
            errors.push(format!("{id}: claimed {c} finding files but shard has {} entries", shard_paths.len()));
        }
    }
    if !coverage.is_file() {
        errors.push(format!("{id}: missing coverage file {}", coverage.display()));
        return Ok(errors);
    }
    let sep = Regex::new(r"^:?-{3,}:?$").unwrap();
    let mut rows: HashMap<(String, String), String> = HashMap::new();
    for (i, raw) in fs::read_to_string(&coverage).map_err(|e| e.to_string())?.lines().enumerate() {
        let s = raw.trim();
        if !s.starts_with('|') {
            continue;
        }
        let cells: Vec<String> = s.trim_matches('|').split('|').map(|c| c.trim().to_string()).collect();
        if cells.len() < 3 || cells[0].to_lowercase() == "pass prefix" || cells.iter().all(|c| sep.is_match(c)) {
            continue;
        }
        let key = (cells[0].clone(), cells[1].clone());
        if rows.contains_key(&key) {
            errors.push(format!("{id}: {}: duplicate coverage row for {} / {} at line {}", coverage.display(), cells[0], cells[1], i + 1));
        }
        rows.insert(key, cells[2].clone());
    }
    let ids_re = Regex::new(r"\b[A-Z][A-Z0-9_]*-\d{3,}\b").unwrap();
    let strs = |k: &str| -> Vec<String> { worker.get(k).and_then(Value::as_array).map(|a| a.iter().map(py_str).collect()).unwrap_or_default() };
    let (prefixes, classes) = (strs("pass_prefixes"), strs("pass_bug_classes"));
    if prefixes.len() != classes.len() {
        return Err(format!("zip() argument 2 is {} than argument 1", if classes.len() < prefixes.len() { "shorter" } else { "longer" }));
    }
    let mut declared = HashSet::new();
    for (prefix, bc) in prefixes.iter().zip(&classes) {
        let Some(outcome) = rows.get(&(prefix.clone(), bc.clone())) else {
            errors.push(format!("{id}: missing coverage row for {prefix} / {bc}"));
            continue;
        };
        let lower = outcome.to_lowercase();
        if lower.starts_with("filed:") {
            let found: Vec<&str> = ids_re.find_iter(outcome).map(|m| m.as_str()).collect();
            if found.is_empty() {
                errors.push(format!("{id}: filed outcome for {prefix} has no finding IDs"));
                continue;
            }
            for fid in found {
                declared.insert(fid.to_string());
                if !fid.starts_with(&format!("{prefix}-")) {
                    errors.push(format!("{id}: filed ID {fid} does not match pass prefix {prefix}"));
                }
                match shard_ids.iter().find(|(k, _)| k == fid) {
                    None => errors.push(format!("{id}: filed ID {fid} is absent from shard")),
                    Some((_, p)) if !p.is_file() => errors.push(format!("{id}: filed ID {fid} points to missing {}", p.display())),
                    _ => {}
                }
            }
        } else if !(lower == "cleared" || lower.starts_with("cleared ") || lower.starts_with("cleared(")) {
            errors.push(format!("{id}: invalid coverage outcome for {prefix}: {outcome}"));
        }
    }
    let mut extra: Vec<&String> = shard_ids.iter().map(|(k, _)| k).filter(|k| !declared.contains(*k)).collect();
    extra.sort();
    for k in extra {
        errors.push(format!("{id}: shard ID {k} is not declared in coverage"));
    }
    Ok(errors)
}

fn validate_plan(plan_path: &Path, workers: Option<Vec<String>>, claimed: &HashMap<String, i64>) -> Result<Vec<String>, String> {
    let plan: Value = serde_json::from_str(&fs::read_to_string(plan_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let out_dir = match plan.get("run").and_then(|r| r.get("output_dir")) {
        Some(v) if truthy(Some(v)) => PathBuf::from(py_str(v)),
        _ => plan_path.parent().map(Path::to_path_buf).unwrap_or_default(),
    };
    let mut by_id: Vec<(String, Value)> = Vec::new();
    for w in plan.get("workers").and_then(Value::as_array).cloned().unwrap_or_default() {
        let Some(n) = w.get("worker_n") else { return Err(format!("plan worker entry missing 'worker_n': {w}")) };
        let id = normalize_worker_id(&py_str(n))?;
        by_id.retain(|(k, _)| *k != id);
        by_id.push((id, w));
    }
    let selected: Vec<String> = match workers {
        None => {
            let mut v: Vec<String> = by_id.iter().map(|(k, _)| k.clone()).collect();
            v.sort();
            v
        }
        Some(ws) => ws.iter().map(|w| normalize_worker_id(w)).collect::<Result<_, _>>()?,
    };
    let mut errors = Vec::new();
    for id in selected {
        match by_id.iter().find(|(k, _)| *k == id) {
            None => errors.push(format!("{id}: not present in {}", plan_path.display())),
            Some((_, w)) => errors.extend(validate_worker(&id, w, &out_dir, claimed)?),
        }
    }
    Ok(errors)
}

pub fn validate_main(argv: &[String]) -> i32 {
    let a = Args::parse("sec rust-validate", argv, &[many("worker"), list("claimed-count")], 1);
    let workers = if a.has("worker") { Some(a.all("worker")) } else { None };
    let run = || -> Result<Vec<String>, String> {
        let claimed = parse_claimed_counts(&a.all("claimed-count"))?;
        validate_plan(Path::new(&a.positional[0]), workers.clone(), &claimed)
    };
    match run() {
        Err(e) => {
            eprintln!("validate_artifacts: {e}");
            2
        }
        Ok(errors) if !errors.is_empty() => {
            for e in errors {
                eprintln!("{e}");
            }
            1
        }
        Ok(_) => {
            println!("validate_artifacts: OK ({})", workers.map(|w| w.join(", ")).unwrap_or_else(|| "all workers".into()));
            0
        }
    }
}

// ---- rust-plan ----------------------------------------------------------------------------------------------------

/// The one list of per-run capability flags: CLI args, gate and requires vocabularies, the rendered prompt and
/// plan.run all derive from it.
const FLAGS: [&str; 6] = ["has_unsafe", "has_ffi", "has_concurrency", "has_async", "has_packed_repr", "has_fs_io"];

fn parse_bool(v: &str, name: &str) -> Result<bool, String> {
    match v.trim().to_lowercase().as_str() {
        "true" | "1" | "yes" => Ok(true),
        "false" | "0" | "no" => Ok(false),
        _ => Err(format!("argument --{name}: expected true/false, got {}", py_repr(v))),
    }
}

struct Pass {
    bug_class: String,
    prefix: String,
    prompt: Option<String>,
}
struct Cluster {
    id: String,
    consolidated: bool,
    prompt: String,
    passes: Vec<Pass>,
    max: Option<i64>,
}

fn cluster_max(c: &Value, cid: &str) -> Result<Option<i64>, String> {
    match c.get("max_passes_per_worker") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) if n.as_i64().is_some_and(|v| v > 0) && n.is_i64() => Ok(n.as_i64()),
        _ => Err(format!("cluster {}: max_passes_per_worker must be a positive integer", py_repr(cid))),
    }
}

fn build_selection(manifest: &Value, root: &Path, flags: &HashMap<&str, bool>, threat: &str) -> Result<Vec<Cluster>, String> {
    if manifest.get("version") != Some(&json!(1)) {
        return Err(format!("unsupported manifest version: {}", manifest.get("version").map(crate::util::py_repr_value).unwrap_or("None".into())));
    }
    let Some(clusters) = manifest.get("clusters").and_then(Value::as_array) else { return Err("manifest.clusters must be a list".into()) };
    let mut selected = Vec::new();
    for c in clusters {
        let cid = c.get("cluster_id").filter(|v| truthy(Some(v))).map(py_str).ok_or("cluster missing cluster_id")?;
        let gate = c.get("gate").map(py_str).unwrap_or_else(|| "None".into());
        if gate != "always" && !FLAGS.contains(&gate.as_str()) {
            return Err(format!("cluster {}: invalid gate {}", py_repr(&cid), py_repr(&gate)));
        }
        if gate != "always" && !flags[gate.as_str()] {
            continue;
        }
        let max = cluster_max(c, &cid)?;
        let consolidated = truthy(c.get("consolidated"));
        let rel = c.get("prompt").filter(|v| truthy(Some(v))).map(py_str).ok_or(format!("cluster {}: missing prompt path", py_repr(&cid)))?;
        let prompt = resolve(&root.join(&rel));
        if !prompt.is_file() {
            return Err(format!("cluster {}: prompt not found at {}", py_repr(&cid), prompt.display()));
        }
        let passes_in = c.get("passes").and_then(Value::as_array).cloned().unwrap_or_default();
        if passes_in.is_empty() {
            return Err(format!("cluster {}: no passes declared", py_repr(&cid)));
        }
        let mut kept = Vec::new();
        'pass: for p in &passes_in {
            let (bc, prefix) = (p.get("bug_class").filter(|v| truthy(Some(v))).map(py_str), p.get("prefix").filter(|v| truthy(Some(v))).map(py_str));
            let (Some(bc), Some(prefix)) = (bc, prefix) else { return Err(format!("cluster {}: pass missing bug_class/prefix: {p}", py_repr(&cid))) };
            for r in p.get("requires").and_then(Value::as_array).cloned().unwrap_or_default() {
                let r = py_str(&r);
                if !FLAGS.contains(&r.as_str()) {
                    return Err(format!("pass {}: unknown requires flag {}", py_repr(&bc), py_repr(&r)));
                }
                if !flags[r.as_str()] {
                    continue 'pass;
                }
            }
            if p.get("skip_threat_models").and_then(Value::as_array).is_some_and(|a| a.iter().any(|t| py_str(t) == threat)) {
                continue;
            }
            let mut pass = Pass { bug_class: bc.clone(), prefix, prompt: None };
            if consolidated {
                // no prompt per pass: the cluster's prompt carries them all
                if p.get("prompt").is_some() {
                    return Err(format!("cluster {} (consolidated): pass {} unexpectedly has 'prompt'", py_repr(&cid), py_repr(&bc)));
                }
            } else {
                let rel = p.get("prompt").filter(|v| truthy(Some(v))).map(py_str).ok_or(format!("cluster {}: non-consolidated pass {} missing prompt path", py_repr(&cid), py_repr(&bc)))?;
                let abs = resolve(&root.join(&rel));
                if !abs.is_file() {
                    return Err(format!("cluster {} pass {}: prompt not found at {}", py_repr(&cid), py_repr(&bc), abs.display()));
                }
                pass.prompt = Some(abs.display().to_string());
            }
            kept.push(pass);
        }
        // empty after filtering: the cluster is dropped (Phase 4 rule)
        if kept.is_empty() {
            continue;
        }
        selected.push(Cluster { id: cid, consolidated, prompt: prompt.display().to_string(), passes: kept, max });
    }
    if selected.is_empty() {
        return Err("no clusters selected after filtering — refusing to start an empty review".into());
    }
    Ok(selected)
}

/// Clusters with more passes than their chunk size, split into contiguous `-{i}` chunks in manifest order. A
/// consolidated cluster is never split (one worker builds its shared inventory once); 0 turns chunking off.
fn split_oversized(selected: Vec<Cluster>, max: i64) -> Vec<Cluster> {
    if max == 0 {
        return selected;
    }
    let mut out = Vec::new();
    for c in selected {
        let eff = c.max.unwrap_or(max) as usize;
        if c.consolidated || c.passes.len() <= eff {
            out.push(c);
            continue;
        }
        let n = c.passes.len().div_ceil(eff);
        let mut passes = c.passes.into_iter();
        for i in 0..n {
            let chunk: Vec<Pass> = passes.by_ref().take(eff).collect();
            out.push(Cluster { id: format!("{}-{}", c.id, i + 1), consolidated: c.consolidated, prompt: c.prompt.clone(), passes: chunk, max: None });
        }
    }
    out
}

/// what Path.resolve() gives for a path that may not exist: absolute, `.`/`..` folded, symlinks followed where they are
fn resolve(p: &Path) -> PathBuf {
    if let Ok(c) = fs::canonicalize(p) {
        return c;
    }
    let abs = if p.is_absolute() { p.to_path_buf() } else { std::env::current_dir().unwrap().join(p) };
    let mut out = PathBuf::new();
    for c in abs.components() {
        match c {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

/// the lines every worker and the cache primer share byte for byte, so the prompt cache hits across workers
fn shared_prefix(out_dir: &Path, scope: &str, roots: &str, threat: &str, sev: &str, flags: &HashMap<&str, bool>, ctx: &str) -> Vec<String> {
    vec![
        "You are a rust-review worker on a parallel Rust security review.".into(),
        "Follow the protocol in your system prompt verbatim.".into(),
        String::new(),
        format!("Output directory: {}", out_dir.display()),
        format!("Finding scope root: {scope} — finding locations MUST be inside this subtree."),
        format!("Context roots: {roots} — read-only context for reachability, callers, wrappers, build settings, mitigations, and threat-model details. Do not file findings outside the finding scope."),
        format!("Scope root: {scope} — legacy alias for Finding scope root."),
        format!("Threat model: {threat}"),
        format!("Severity filter: {sev}"),
        format!("Codebase: {}", FLAGS.iter().map(|f| format!("{f}={}", flags[f])).collect::<Vec<_>>().join(", ")),
        String::new(),
        "<context>".into(),
        "Codebase context (from output_dir/context.md — do NOT re-Read it from disk; this block IS the canonical copy):".into(),
        String::new(),
        ctx.trim_end().to_string(),
        "</context>".into(),
        String::new(),
    ]
}

pub fn plan_main(argv: &[String]) -> i32 {
    let mut spec = vec![req("plugin-root"), req("output-dir"), req("threat-model"), req("severity-filter"), req("scope-subpath"), def("context-roots", "."), opt("manifest"), def("cache-primer", "true"), def("max-passes-per-worker", "4")];
    let flag_names: Vec<&'static str> = FLAGS.iter().map(|f| &*Box::leak(f.replace('_', "-").into_boxed_str())).collect();
    spec.extend(flag_names.iter().map(|n| req(n)));
    let a = Args::parse("sec rust-plan", argv, &spec, 0);
    match plan_run(&a) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("build_run_plan: {e}");
            2
        }
    }
}

fn plan_run(a: &Args) -> Result<(), String> {
    let threat = a.str("threat-model");
    if !["BOTH", "LOCAL_UNPRIVILEGED", "REMOTE"].contains(&threat) {
        return Err(format!("argument --threat-model: invalid choice: {} (choose from BOTH, LOCAL_UNPRIVILEGED, REMOTE)", py_repr(threat)));
    }
    let sev = a.str("severity-filter");
    if !["all", "high", "medium"].contains(&sev) {
        return Err(format!("argument --severity-filter: invalid choice: {} (choose from all, high, medium)", py_repr(sev)));
    }
    let mut flags = HashMap::new();
    for f in FLAGS {
        let n = f.replace('_', "-");
        flags.insert(f, parse_bool(a.str(&n), &n)?);
    }
    let cache_primer = parse_bool(a.str("cache-primer"), "cache-primer")?;
    let max: i64 = a.str("max-passes-per-worker").parse().map_err(|_| format!("argument --max-passes-per-worker: invalid int value: {}", py_repr(a.str("max-passes-per-worker"))))?;
    if max < 0 {
        return Err(format!("--max-passes-per-worker must be >= 0, got {max}"));
    }
    let root = resolve(&a.path("plugin-root"));
    if !root.is_dir() {
        return Err(format!("--plugin-root {} is not a directory", root.display()));
    }
    let out_dir = resolve(&a.path("output-dir"));
    if !out_dir.is_dir() {
        return Err(format!("--output-dir {} does not exist (Phase 2 must create it first)", out_dir.display()));
    }
    let manifest_path = resolve(&a.get("manifest").map(PathBuf::from).unwrap_or_else(|| root.join("prompts/clusters/manifest.json")));
    if !manifest_path.is_file() {
        return Err(format!("manifest not found at {}", manifest_path.display()));
    }
    let manifest: Value = serde_json::from_str(&fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?).map_err(|e| format!("manifest is not valid JSON: {e}"))?;

    let selected = split_oversized(build_selection(&manifest, &root, &flags, threat)?, max);
    let ctx_path = out_dir.join("context.md");
    if !ctx_path.is_file() {
        return Err(format!("context.md not found at {} — Phase 3 must write it before Phase 4 runs", ctx_path.display()));
    }
    let ctx = fs::read_to_string(&ctx_path).map_err(|e| e.to_string())?;
    let prompts = out_dir.join("worker-prompts");
    fs::create_dir_all(&prompts).map_err(|e| e.to_string())?;
    let (scope, roots) = (a.str("scope-subpath"), a.str("context-roots"));
    let shared = shared_prefix(&out_dir, scope, roots, threat, sev, &flags, &ctx);

    let mut workers = Vec::new();
    for (i, c) in selected.iter().enumerate() {
        let n = i + 1;
        let mut lines = shared.clone();
        lines.extend(["— assignment —".to_string(), format!("Worker id: worker-{n}"), format!("Cluster id: {}", c.id), format!("Cluster prompt: {}", c.prompt)]);
        // worker.md: no sub-prompt section for a consolidated cluster
        if !c.consolidated {
            lines.push("Sub-prompt paths:".into());
            lines.extend(c.passes.iter().map(|p| format!("  - {}", p.prompt.clone().unwrap_or_default())));
        }
        lines.push(format!("Pass bug classes: {}", c.passes.iter().map(|p| p.bug_class.as_str()).collect::<Vec<_>>().join(", ")));
        lines.push(format!("Pass prefixes: {}", c.passes.iter().map(|p| p.prefix.as_str()).collect::<Vec<_>>().join(", ")));
        // always empty (filtered passes never reach a worker); kept because worker.md "Inputs" requires it
        lines.extend(["Skip subclasses: (none)".to_string(), String::new()]);
        let path = prompts.join(format!("worker-{n}.txt"));
        fs::write(&path, lines.join("\n")).map_err(|e| e.to_string())?;
        workers.push(obj! {
            "worker_n" => n,
            "cluster_id" => c.id.clone(),
            "consolidated" => c.consolidated,
            "cluster_prompt" => c.prompt.clone(),
            "sub_prompt_paths" => c.passes.iter().filter_map(|p| p.prompt.clone()).collect::<Vec<_>>(),
            "pass_bug_classes" => c.passes.iter().map(|p| p.bug_class.clone()).collect::<Vec<_>>(),
            "pass_prefixes" => c.passes.iter().map(|p| p.prefix.clone()).collect::<Vec<_>>(),
            "spawn_prompt_path" => path.display().to_string(),
        });
    }
    let mut primer = None;
    if cache_primer {
        let p = prompts.join("cache-primer.txt");
        let mut lines = shared.clone();
        lines.extend(["Cache primer: true".to_string(), "worker-PRIMER abort: cache primer (no analysis performed)".into(), String::new()]);
        fs::write(&p, lines.join("\n")).map_err(|e| e.to_string())?;
        primer = Some(p.display().to_string());
    }
    let mut run = Map::new();
    for (k, v) in [("output_dir", out_dir.display().to_string()), ("finding_scope_root", scope.into()), ("scope_root", scope.into()), ("context_roots", roots.into()), ("threat_model", threat.into()), ("severity_filter", sev.into())] {
        run.insert(k.into(), v.into());
    }
    for f in FLAGS {
        run.insert(f.into(), flags[f].into());
    }
    run.insert("plugin_root".into(), root.display().to_string().into());
    run.insert("manifest_path".into(), manifest_path.display().to_string().into());
    run.insert("cache_primer".into(), cache_primer.into());
    let mut plan = obj! { "version" => 1, "run" => Value::Object(run), "workers" => workers };
    if let Some(p) = &primer {
        plan["cache_primer"] = obj! { "spawn_prompt_path" => p.clone() };
    }
    let plan_path = out_dir.join("plan.json");
    fs::write(&plan_path, pretty(&plan) + "\n").map_err(|e| e.to_string())?;
    let warning = "Spawn workers FOREGROUND only. Each Agent call MUST have no run_in_background field (or run_in_background=false). Setting it to true defeats the Phase-6a primer cache and burns ~15K cache-creation tokens per worker. 'Parallel' = one assistant message with M Agent calls; that is already concurrent — do not add run_in_background=true.";
    // on stderr too, so it shows in the Bash result the orchestrator reads
    eprintln!("WARNING: {warning}");
    println!(
        "{}",
        pretty(&obj! {
            "plan_path" => plan_path.display().to_string(),
            "worker_prompts_dir" => prompts.display().to_string(),
            "worker_count" => selected.len(),
            "cluster_ids" => selected.iter().map(|c| c.id.clone()).collect::<Vec<_>>(),
            "cache_primer_path" => primer.map(Value::from).unwrap_or(Value::Null),
            "spawn_instructions" => warning,
        })
    );
    Ok(())
}
