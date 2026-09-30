//! Every picture tagged for the edit — on this Mac, the step after the proxy (it was the vault server's, retired): once
//! a video original's ACEScct proxy (or a still) is in this Mac's store, its frames are sampled here natively (read
//! in place, through the ACES 2.0 output transform, JPEGs in memory: `frames`) and sent in stretches, with the words
//! said in each, to our server (`prem`: `POST /api/analysis`), which asks Prem's confidential Qwen with its own key —
//! the prompt, the vocabulary and the validation are the server's; no LLM key is on a Mac. The vocabulary is game/film/vocabulary.json: base tags with fixed
//! values, free tags, and time-ranged cues (takes, actions, emotions, cut points, transitions, highlights, problems).
//!
//! Map, then reduce: each stretch is described on its own — its tags, its cues, a line of what it shows, its best
//! frame; then one text-only request over every stretch's answer (and the words) groups the repeated attempts of an
//! action into takes and ranks them, writes the file's tags, its summary and where it serves an edit best, and picks
//! the thumbnail (`plan`: merge, finish, thumbnail_time — pure, tested).
//!
//! What the catalog gets — `analysis/<hash>` (the original's hash), the shape the server wrote, so the studio and the
//! MCP read it as before: `{ state, progress, tries?, thumbnail?, of, model, vocabulary, at, seconds, frames, summary:
//! { line, best_use }, tags, free, labels, segments, cues, device, updated? }` — `state` = queued: why · analysing
//! (with `progress` 0…1) · done · failed: …; `of` = the hash of what was looked at (a new proxy is analysed again).
//! One Mac at a time: another device's analysis that is under way is left to it (unless it went quiet for six hours).
//!
//! The thumbnail: a small display-referred JPEG (640 px long edge) of the file's best frame, a vault file of its own
//! (class proxy, `role: "thumbnail"`, `thumbnail_of`, beside its original), named in the record's `thumbnail`. A first
//! one (the middle frame) is made as soon as the proxy is here, before any model answers; the analysis replaces it.
//!
//! One file at a time, after its transcript has settled (a recording's words go with its frames), the smallest first;
//! for the stories in scope (the Day 01 story unless set otherwise: `prem::stories`). A round after an ingest, a
//! proxy or a transcript, and every ten minutes; a failure is tried three times, then it waits for a person. Its
//! progress shows in the studio's Ingest (the record, and `proxies_now` as `analysis:<hash>`).

pub mod frames;
pub mod plan;
pub mod prem;

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, Instant},
};

use iroh_blobs::{Hash, api::proto::BlobStatus};
use serde_json::{Map, Value, json};
use tauri::{AppHandle, Emitter, Manager};
use vault_core::{
    Vault,
    catalog::{ANALYSIS, SOUND, TRANSCRIPT},
};

use crate::proxies::{self, pressure};
use plan::Source;
use prem::{Ask, prem};

static WAKE: tokio::sync::Notify = tokio::sync::Notify::const_new();

/// A round now (an ingest, a proxy, a transcript, a sound record: something may be due).
pub fn wake() {
    WAKE.notify_one();
}

/// The key of an analysis's line in the studio's list of work in progress (`proxies_now`).
pub fn key(hash: &str) -> String {
    format!("analysis:{hash}")
}

fn fail(e: impl std::fmt::Display) -> Ask {
    Ask::Fail(format!("{e:#}"))
}

fn waiting(e: impl std::fmt::Display) -> Ask {
    Ask::Wait { reason: e.to_string(), until: None }
}

pub async fn sweep(handle: AppHandle, vault: Arc<Vault>) {
    prem::forget_old_key();
    tokio::time::sleep(Duration::from_secs(45)).await;
    // a thumbnail that could not be made: not again until the ten-minute round
    let mut no_thumb: HashSet<String> = HashSet::new();
    loop {
        let mut rest = Duration::from_secs(600);
        if crate::auth::signed_in() {
            match round(&handle, &vault, &mut no_thumb).await {
                Ok(()) => {}
                Err(Ask::Wait { reason, until }) => {
                    tracing::info!("analysis waits: {reason}");
                    if let Some(u) = until {
                        // Prem is paused: nothing is asked until the pause ends
                        rest = u.saturating_duration_since(Instant::now()).clamp(Duration::from_secs(60), Duration::from_secs(1800));
                    }
                }
                Err(Ask::Fail(e)) => tracing::warn!("analysis: {e}"),
            }
        }
        tokio::select! {
            _ = WAKE.notified() => {}
            _ = tokio::time::sleep(rest) => no_thumb.clear(),
        }
    }
}

/// Set keys of a file's `analysis/<hash>` record (read, set, write).
async fn patch(vault: &Vault, hex: &str, patch: Map<String, Value>) -> Result<Value, Ask> {
    let hash: Hash = hex.parse().map_err(fail)?;
    let latest = vault.catalog.record(ANALYSIS, hash).await.ok().flatten();
    let next = plan::patched(latest.as_ref(), &patch);
    vault.catalog.write_record(ANALYSIS, hash, &next).await.map_err(fail)?;
    Ok(next)
}

fn fields(kv: &[(&str, Value)]) -> Map<String, Value> {
    kv.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
}

/// Every waiting file says why it waits (only where it does not say so already).
async fn say_queued(vault: &Vault, todo: &[&(String, Source)], records: &HashMap<String, Value>, why: &str) {
    let state = format!("queued: {why}");
    for (hex, _) in todo {
        if records.get(hex).and_then(|r| r["state"].as_str()) != Some(state.as_str()) {
            patch(vault, hex, fields(&[("state", json!(state)), ("progress", Value::Null)])).await.ok();
        }
    }
}

async fn round(handle: &AppHandle, vault: &Arc<Vault>, no_thumb: &mut HashSet<String>) -> Result<(), Ask> {
    let me = vault.endpoint.id().to_string();
    let now = vault_core::ingest::now_iso();
    let list = vault.catalog.list().await.map_err(fail)?;
    let metas: HashMap<String, Value> = list.iter().filter_map(|m| Some((m.hash.clone(), serde_json::to_value(m).ok()?))).collect();
    let records = vault.catalog.records(ANALYSIS).await.map_err(fail)?;
    let transcripts = vault.catalog.records(TRANSCRIPT).await.map_err(fail)?;
    let sounds = vault.catalog.records(SOUND).await.map_err(fail)?;
    // the proxies that name their original (the original's own `meta.proxy` may have been written over)
    let proxy_of: HashMap<String, String> = metas
        .iter()
        .filter(|(_, m)| plan::s(m, "class") == "proxy" && m.pointer("/meta/color/profile").and_then(|x| x.as_str()) == Some(plan::WORKING))
        .filter_map(|(h, m)| Some((m.pointer("/meta/proxy_of")?.as_str()?.to_string(), h.clone())))
        .collect();
    // what this Mac holds of what may show a wanted file
    let wanted: Vec<(&String, &Value)> = metas.iter().filter(|(_, m)| plan::wants(m)).collect();
    let mut held: HashSet<String> = HashSet::new();
    for (hex, m) in &wanted {
        for c in plan::candidates(hex, m, &proxy_of) {
            let Ok(h) = c.parse::<Hash>() else { continue };
            if !held.contains(&c) && matches!(vault.store.blobs().status(h).await, Ok(BlobStatus::Complete { .. })) {
                held.insert(c);
            }
        }
    }
    let mut sources: Vec<(String, Source)> = wanted.iter().filter_map(|(h, m)| Some(((*h).clone(), plan::source(h, m, &metas, &proxy_of, &held)?))).collect();
    sources.sort_by_key(|(_, src)| src.size());

    // a first thumbnail for everything that has none, as soon as its proxy is here — no model needed
    let known: HashSet<String> = metas.keys().cloned().collect();
    for (hex, src) in &sources {
        if plan::needs_thumbnail(records.get(hex), &known) && !no_thumb.contains(hex) && !plan::elsewhere(records.get(hex), &me, &now) {
            if let Err(e) = first_thumbnail(vault, hex, src).await {
                no_thumb.insert(hex.clone());
                tracing::warn!("thumbnail of {}: {e}", &hex[..12]);
            }
        }
    }

    // then the analysis: in scope, due here, a recording once its words have settled
    let only = prem::stories();
    let todo: Vec<&(String, Source)> = sources
        .iter()
        .filter(|(hex, src)| plan::due(records.get(hex), src) && !plan::elsewhere(records.get(hex), &me, &now))
        .filter(|(hex, _)| plan::in_scope(&metas[hex], only.as_ref()))
        .filter(|(hex, _)| !plan::waits_for_words(&metas[hex], transcripts.get(hex), sounds.get(hex), &now))
        .collect();
    if todo.is_empty() {
        return Ok(());
    }
    let auth = handle.state::<crate::auth::Auth>();
    if let Err(e) = prem().ready(&auth).await {
        if let Ask::Wait { reason, .. } = &e {
            say_queued(vault, &todo, &records, reason).await;
        }
        return Err(e);
    }
    tracing::info!("analysis: {} files to tag", todo.len());
    // one at a time, one attempt each; a pause stops the round (the rest say why they wait)
    for (i, (hex, src)) in todo.iter().enumerate() {
        if let Err(e) = one(handle, vault, hex, src, &metas[hex], transcripts.get(hex), &me).await {
            if let Ask::Wait { reason, .. } = &e {
                say_queued(vault, &todo[i + 1..], &records, reason).await;
            }
            return Err(e);
        }
    }
    Ok(())
}

/// The file that shows it, read in place from this Mac's store.
async fn open(vault: &Vault, src: &Source) -> Result<vault_media::Source, Ask> {
    let name = vault.catalog.meta(src.hash()).await.ok().flatten().map(|m| m.original_name).filter(|n| !n.is_empty());
    let name = name.unwrap_or_else(|| if src.movie() { "proxy.mp4".into() } else { "still.png".into() });
    crate::blob::source(vault, src.hash(), &name).await.map_err(waiting)
}

/// The source's middle frame as the file's thumbnail, before any model looked at it.
async fn first_thumbnail(vault: &Arc<Vault>, hex: &str, src: &Source) -> Result<(), String> {
    let file = open(vault, src).await.map_err(|e| e.to_string())?;
    let t = if src.movie() {
        let f = file.clone();
        let p = tokio::task::spawn_blocking(move || objc2::rc::autoreleasepool(|_| vault_media::probe(f))).await.map_err(|e| e.to_string())?.map_err(|e| format!("{e:#}"))?;
        Some(p.seconds / 2.0)
    } else {
        None
    };
    let thumb = thumbnail(vault, hex, file, src.acescct(), t, "").await?;
    patch(vault, hex, fields(&[("thumbnail", json!(thumb))])).await.map_err(|e| e.to_string())?;
    tracing::info!("first thumbnail of {}", &hex[..12]);
    Ok(())
}

/// A thumbnail into the vault (its own file, beside its original), its hash.
async fn thumbnail(vault: &Arc<Vault>, hex: &str, file: vault_media::Source, acescct: bool, t: Option<f64>, why: &str) -> Result<String, String> {
    let hash: Hash = hex.parse().map_err(|e| format!("{e}"))?;
    let original = vault.catalog.meta(hash).await.map_err(|e| format!("{e:#}"))?.ok_or("the description is not here")?;
    let bytes = tokio::task::spawn_blocking(move || frames::one(file, t, plan::THUMB_EDGE, acescct)).await.map_err(|e| e.to_string())?.map_err(|e| format!("{e:#}"))?;
    let (name, batch) = plan::thumbnail_batch(&original, t.unwrap_or(0.0), why);
    // its own folder: the file's name is the thumbnail's name in the vault
    let dir = vault.ingest_dir().join(format!("thumb-{hex}"));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&name);
    let made = async {
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
        vault.ingest_file(&path, &batch).await.map_err(|e| format!("{e:#}"))
    }
    .await;
    std::fs::remove_dir_all(&dir).ok();
    Ok(made?.hash)
}

/// One file; its own failure is written into its record (only a wait stops the round).
async fn one(handle: &AppHandle, vault: &Arc<Vault>, hex: &str, src: &Source, meta: &Value, transcript: Option<&Value>, me: &str) -> Result<(), Ask> {
    let k = key(hex);
    let name = plan::s(meta, "original_name").to_string();
    proxies::set(&k, &name, "queued", 0.0);
    // an ingest first; and only while the Mac has memory to spare
    vault.hold.free_of("ingest").await;
    while pressure() > 1 {
        proxies::set(&k, &name, "waiting for memory", 0.0);
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    let tell: Tell = {
        let (k, name) = (k.clone(), name.clone());
        Arc::new(move |stage: &str, done: f64| proxies::set(&k, &name, stage, done))
    };
    let result = analyse(&handle.state::<crate::auth::Auth>(), vault, hex, src, meta, transcript, me, tell).await;
    proxies::clear(&k);
    handle.emit("vault-analysis", json!({ "of": hex })).ok();
    match result {
        Ok(()) => Ok(()),
        Err(Ask::Wait { reason, until }) => {
            // not the file's fault: it waits, queued (with why), and no try is used up
            patch(vault, hex, fields(&[("state", json!(format!("queued: {reason}"))), ("progress", Value::Null)])).await.ok();
            Err(Ask::Wait { reason, until })
        }
        Err(Ask::Fail(e)) => {
            tracing::warn!("analysis of {}: {e}", &hex[..12]);
            let latest = vault.catalog.record(ANALYSIS, hex.parse().map_err(fail)?).await.ok().flatten().unwrap_or(Value::Null);
            let tries = latest["tries"].as_u64().unwrap_or(0) + 1;
            let p = [
                ("state", json!(plan::failed(&e, tries))),
                ("tries", json!(tries)),
                ("progress", Value::Null),
                ("of", json!(src.hash().to_hex().to_string())),
                ("device", json!(me)),
                ("updated", json!(vault_core::ingest::now_iso())),
            ];
            patch(vault, hex, fields(&p)).await.ok();
            Ok(())
        }
    }
}

/// How far a file is, for the studio's Ingest (`proxies_now`): its stage and 0…1.
type Tell = Arc<dyn Fn(&str, f64) + Send + Sync>;

#[allow(clippy::too_many_arguments)]
async fn analyse(auth: &crate::auth::Auth, vault: &Arc<Vault>, hex: &str, src: &Source, meta: &Value, transcript: Option<&Value>, me: &str, tell: Tell) -> Result<(), Ask> {
    let started = Instant::now();
    let of = src.hash().to_hex().to_string();
    let running = |progress: f64| fields(&[("state", json!("analysing")), ("progress", json!(progress)), ("of", json!(of)), ("device", json!(me)), ("updated", json!(vault_core::ingest::now_iso()))]);
    patch(vault, hex, running(0.0)).await?;
    let file = open(vault, src).await?;
    let acescct = src.acescct();
    // the frames and their times
    tell("sampling frames", 0.0);
    let (seconds, times, jpegs) = if src.movie() {
        let f = file.clone();
        let probed = tokio::task::spawn_blocking(move || objc2::rc::autoreleasepool(|_| vault_media::probe(f))).await.map_err(fail)?.map_err(fail)?;
        let seconds = probed.seconds;
        let (f, t) = (file.clone(), tell.clone());
        let sampled = tokio::task::spawn_blocking(move || frames::sample(f, seconds, plan::interval(seconds), plan::EDGE, acescct, &mut |d| t("sampling frames", d)))
            .await
            .map_err(fail)?
            .map_err(fail)?;
        // picture changes on top of the regular frames: thinned to the cap, evenly
        let keep = plan::thin(sampled.times.len(), (plan::MAX_FRAMES * 1.5) as usize);
        let times: Vec<f64> = keep.iter().map(|&i| sampled.times[i]).collect();
        let mut jpegs = sampled.jpegs;
        let jpegs: Vec<Vec<u8>> = keep.iter().map(|&i| std::mem::take(&mut jpegs[i])).collect();
        (seconds, times, jpegs)
    } else {
        let f = file.clone();
        let jpeg = tokio::task::spawn_blocking(move || frames::one(f, None, plan::EDGE, acescct)).await.map_err(fail)?.map_err(fail)?;
        (0.0, vec![0.0], vec![jpeg])
    };
    let kind = if src.movie() { "video" } else { "image" };
    let info = json!({ "name": plan::s(meta, "original_name"), "title": plan::s(meta, "title"), "kind": kind, "seconds": seconds,
                       "description": plan::s(meta, "description"), "tags": meta["tags"] });
    let parts = plan::stretches(&times, seconds);
    let steps = parts.len() + 1;
    let mut answers: Vec<(f64, f64, Value)> = Vec::new();
    let mut picks: Vec<(f64, String)> = Vec::new();
    let (mut model, mut vocabulary) = (Value::Null, Value::Null);
    for (n, (i, j, a, b)) in parts.iter().enumerate() {
        tell("asking Qwen", n as f64 / steps as f64);
        let frames: Vec<(f64, String)> = (*i..*j).map(|k| ((times[k] * 1000.0).round() / 1000.0, plan::base64(&jpegs[k]))).collect();
        let words = plan::words_in(transcript, *a, *b);
        let before = answers.last().map(|(_, _, p)| p["summary"].clone()).unwrap_or(Value::Null);
        let st = prem::Stretch { file: &info, s: *a, e: *b, index: n, of: parts.len(), frames: &frames, words: &words, before: &before };
        let answer = prem().frames(auth, &st).await?;
        if model.is_null() {
            model = answer["model"].clone();
            vocabulary = answer["vocabulary"].clone();
        }
        if let Some(idx) = answer["thumbnail"]["index"].as_u64().map(|x| x as usize).filter(|x| i + x < *j) {
            picks.push((times[i + idx], answer["thumbnail"]["why"].as_str().unwrap_or("").to_string()));
        }
        answers.push((*a, *b, answer));
        patch(vault, hex, running(((n + 1) as f64 / steps as f64 * 1000.0).round() / 1000.0)).await?;
    }

    // the reduce: the takes across the file, its tags and summary, the thumbnail
    tell("asking Qwen: the whole file", parts.len() as f64 / steps as f64);
    let merged = plan::merge(&answers);
    let stretches: Vec<Value> = answers
        .iter()
        .map(|(a, b, p)| {
            let pick = picks.iter().find(|(t, _)| t >= a && t <= b).map(|(t, why)| json!({ "t": t, "why": why }));
            json!({ "s": a, "e": b, "summary": p["summary"], "tags": p["tags"], "cues": p["cues"], "thumbnail": pick })
        })
        .collect();
    let said: String = transcript.and_then(|t| t["text"].as_str()).unwrap_or("").chars().take(24_000).collect();
    let reduce = match prem().reduce(auth, &info, &json!(stretches), &said).await {
        Ok(r) => Some(r),
        Err(e @ Ask::Wait { .. }) => return Err(e),
        Err(Ask::Fail(e)) => {
            // the stretches' work is kept: the file is tagged, only its takes are not grouped across stretches
            tracing::warn!("analysis of {}: the reduce failed, the stretches stand: {e}", &hex[..12]);
            None
        }
    };
    let mut record = plan::finish(merged, reduce.as_ref());

    // the thumbnail the analysis picked
    tell("the thumbnail", 1.0);
    let cues = record["cues"].as_array().cloned().unwrap_or_default();
    let t = plan::thumbnail_time(reduce.as_ref(), &picks, &cues, &times, seconds);
    let why = reduce
        .as_ref()
        .and_then(|r| r["thumbnail"]["why"].as_str())
        .map(String::from)
        .or_else(|| picks.iter().find(|(p, _)| (p - t).abs() < 1e-6).map(|(_, w)| w.clone()))
        .unwrap_or_default();
    let hash: Hash = hex.parse().map_err(fail)?;
    let previous = vault.catalog.record(ANALYSIS, hash).await.ok().flatten().and_then(|r| r["thumbnail"].as_str().map(String::from));
    match thumbnail(vault, hex, file, acescct, src.movie().then_some(t), &why).await {
        Ok(h) => {
            if let Some(old) = previous.filter(|o| *o != h) {
                // one thumbnail per file: the one it replaces goes
                if let Ok(o) = old.parse::<Hash>() {
                    vault.catalog.delete_file(o, "replaced by the file's new thumbnail").await.ok();
                }
            }
            record["thumbnail"] = json!(h);
        }
        Err(e) => {
            tracing::warn!("thumbnail of {}: {e}", &hex[..12]);
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
    o.insert("at".into(), json!(vault_core::ingest::now_iso()));
    o.insert("seconds".into(), json!((seconds * 1000.0).round() / 1000.0));
    o.insert("frames".into(), json!(times.len()));
    o.insert("device".into(), json!(me));
    vault.catalog.write_record(ANALYSIS, hash, &record).await.map_err(fail)?;
    tracing::info!("analysed {} ({} frames in {} stretches, {} cues) in {:.0} s", &hex[..12], times.len(), parts.len(), cues.len(), started.elapsed().as_secs_f64());
    Ok(())
}

/// The analysis's setup on this Mac: the stories it runs for (story ids; `["*"]` every story; empty: back to Day 01).
/// The model and its key are the server's. Answers what is set.
pub fn setup(stories: Option<Vec<String>>) -> Result<Value, String> {
    let mut p = Map::new();
    if let Some(s) = stories {
        p.insert("stories".into(), if s.is_empty() { Value::Null } else if s.iter().any(|x| x == "*") { json!([]) } else { json!(s) });
    }
    if !p.is_empty() {
        prem::set_settings(&p)?;
        wake();
    }
    Ok(prem::status())
}

/// Set the analysis up on this Mac (the stories): what is set.
#[tauri::command]
pub fn analysis_setup(stories: Option<Vec<String>>) -> crate::Res<Value> {
    crate::gate()?;
    setup(stories)
}

/// A file analysed again (by hand, or by an agent): its record set back to queued, its tries forgotten.
pub async fn again(vault: &Vault, hash: &str) -> Result<(), String> {
    patch(vault, hash, fields(&[("state", json!("queued")), ("tries", Value::Null), ("progress", Value::Null), ("device", Value::Null)])).await.map_err(|e| e.to_string())?;
    wake();
    Ok(())
}

#[tauri::command]
pub async fn vault_analyse(app: tauri::State<'_, crate::App>, hash: String) -> crate::Res<()> {
    crate::gate()?;
    again(&app.vault, &hash).await
}
