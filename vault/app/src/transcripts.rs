//! Every recording's words, made here on the Mac, on-device (vault-asr), nothing of the speech leaves our devices for
//! it. First its language, kept on the file as a tag — `en` or `de` — unless it has one (a tag set by hand is the
//! file's language): Phonon-2 listens to the first seconds, and when it is unsure Nemotron 3.5 tells English from
//! German (vault-asr `Recognizer::language`); English unless told. Then the words: English by Phonon-2, German by
//! Nemotron. A file tagged `de` whose words are not Nemotron's is made again, by Nemotron; a recording with words and
//! no language tag (transcribed before languages were tagged) is made again too.
//!
//! An automatic step after the ingest, like the proxies: its own queue, one recording at a time, after any ingest and
//! only while macOS says there is memory to spare; the uploads go on meanwhile (it is the CPU's work, not the line's).
//! It does not wait for the proxies either: they are the GPU's and the video encoder's.
//!
//! The sound: the recording's audio proxy when this Mac has it (the server makes it: small, quick to read), else the
//! original itself — decoded by AVFoundation straight to 16 kHz mono (vault-media `audio`).
//!
//! What the catalog gets — `transcript/<hash>` (the original's hash), written by this Mac's author: while it runs
//! `{ state: "transcribing", stage, progress, device, updated }` (the Ingest table shows how far), then the transcript
//! `{ state: "done", model, language, locale, text, words: [{ w, s, e, c }], utterances: [{ s, e, text }], device, at }`
//! (times in seconds of the original), `none: no speech` or `failed: …` (three tries, then it waits for a person).
//! One writer per file: a file another device is transcribing is left to it (unless it went quiet for six hours).
//!
//! The model (Phonon ~1 GB in memory, Nemotron ~2.5 GB; one at a time) is loaded for a run of recordings and let go
//! when the queue is empty.

use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use iroh_blobs::{Hash, api::proto::BlobStatus};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};
use vault_core::{Meta, Vault, catalog::TRANSCRIPT};

use crate::proxies::{self, pressure};

pub const TRIES: u64 = 3;
/// Another device's transcript that has said nothing for this long is taken over.
pub const STALE_HOURS: i64 = 6;

/// one recording at a time
static TURN: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
/// the loaded model, kept for a run of recordings
static RECOGNIZER: Mutex<Option<vault_asr::Recognizer>> = Mutex::new(None);

/// The language tags a file can have.
pub const LANGUAGE_TAGS: [&str; 2] = ["en", "de"];

/// The language a file is tagged with.
pub fn tagged(tags: &[String]) -> Option<&'static str> {
    LANGUAGE_TAGS.into_iter().find(|l| tags.iter().any(|t| t == l))
}

/// Its tags with this language (another language's tag dropped).
pub fn with_language(tags: &[String], lang: &str) -> Vec<String> {
    let mut out: Vec<String> = tags.iter().filter(|t| !LANGUAGE_TAGS.contains(&t.as_str())).cloned().collect();
    out.push(lang.to_string());
    out
}

/// The model that reads a language: German Nemotron's, English (and anything else) Phonon's.
pub fn engine_for(lang: &str) -> vault_asr::Engine {
    if lang == "de" { vault_asr::Engine::Nemotron } else { vault_asr::Engine::Phonon }
}

/// Tagged German, its words made — but not by Nemotron: made again, by Nemotron.
pub fn german_again(tags: &[String], record: Option<&Value>) -> bool {
    tagged(tags) == Some("de") && record.is_some_and(|r| r["state"] == "done" && r["model"] != vault_asr::Engine::Nemotron.model())
}

/// Its words made, but no language on the file (transcribed before languages were tagged): made again.
pub fn untagged(tags: &[String], record: Option<&Value>) -> bool {
    tagged(tags).is_none() && record.is_some_and(|r| r["state"] == "done")
}

/// The recognizer for this engine, in the slot (another engine's let go first: one model in memory at a time).
fn recognizer<'a>(slot: &'a mut Option<vault_asr::Recognizer>, models: &vault_asr::Models, told: &dyn Fn(&str, f64)) -> Result<&'a mut vault_asr::Recognizer, String> {
    if slot.as_ref().is_some_and(|r| r.engine() != models.engine) {
        slot.take();
    }
    if slot.is_none() {
        told("loading the speech model", 0.0);
        *slot = Some(vault_asr::Recognizer::open(models).map_err(|e| format!("{e:#}"))?);
    }
    Ok(slot.as_mut().unwrap())
}

/// The key of a transcript's line in the studio's list of work in progress (`proxies_now`).
pub fn key(hash: &str) -> String {
    format!("transcript:{hash}")
}

/// Does this file get words? A video or a sound that is an original or a working file — never a proxy (the audio
/// proxies included), a delivery, an EXR sequence, a model or a world shot.
pub fn wants(m: &Meta) -> bool {
    let role = m.meta.get("role").and_then(|r| r.as_str()).unwrap_or("");
    matches!(m.class.as_str(), "" | "default" | "original")
        && matches!(m.kind.as_str(), "video" | "audio")
        && !matches!(role, "audio" | "model" | "proxy" | "proxy-cache" | "frame")
        && m.meta.get("sequence").is_none()
        && m.meta.get("shot").is_none()
}

fn age_hours(at: &str, now: &str) -> Option<i64> {
    // ISO seconds since the epoch, compared as the ingest writes them ("2026-09-30T09:15:00Z")
    let secs = |s: &str| -> Option<i64> {
        let (d, t) = s.trim_end_matches('Z').split_once('T')?;
        let d: Vec<i64> = d.split('-').filter_map(|x| x.parse().ok()).collect();
        let t: Vec<i64> = t.split(':').filter_map(|x| x.split('.').next()?.parse().ok()).collect();
        let [y, mo, da] = d[..] else { return None };
        let [h, mi, se] = t[..] else { return None };
        // days from the civil date (Howard Hinnant's algorithm)
        let (y, m) = if mo <= 2 { (y - 1, mo + 9) } else { (y, mo - 3) };
        let era = y.div_euclid(400);
        let yoe = y - era * 400;
        let doy = (153 * m + 2) / 5 + da - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        Some((era * 146_097 + doe - 719_468) * 86_400 + h * 3600 + mi * 60 + se)
    };
    Some((secs(now)? - secs(at)?) / 3600)
}

/// Is its transcript due here now? None yet; this Mac's own left midway or failed fewer than TRIES times; another
/// device's quiet for STALE_HOURS. Never one that is done or found no speech.
pub fn due(record: Option<&Value>, me: &str, now: &str) -> bool {
    let Some(r) = record else { return true };
    let s = |k: &str| r[k].as_str().unwrap_or("");
    let state = s("state");
    if state == "done" || state.starts_with("none") || r.get("words").is_some_and(|w| w.is_array()) {
        return false;
    }
    let tries = r["tries"].as_u64().unwrap_or(0);
    if state.starts_with("failed") {
        return tries < TRIES;
    }
    // transcribing / queued: ours (the app quit midway), or another device's gone quiet
    s("device") == me || age_hours(s("updated"), now).is_none_or(|h| h >= STALE_HOURS)
}

/// A record's progress fields (the Ingest table reads them).
fn running(stage: &str, done: f64, me: &str, tries: u64) -> Value {
    json!({ "state": "transcribing", "stage": stage, "progress": (done * 1000.0).round() / 1000.0, "tries": tries, "device": me, "updated": vault_core::ingest::now_iso() })
}

/// Every recording without its words, queued — at the start, and every ten minutes (a file that came in on another
/// device, one whose sound arrived since, one that failed and tries again).
pub async fn sweep(handle: AppHandle, vault: Arc<Vault>) {
    tokio::time::sleep(Duration::from_secs(40)).await;
    loop {
        if crate::auth::signed_in() {
            queue_due(&handle, &vault).await;
        }
        tokio::time::sleep(Duration::from_secs(600)).await;
    }
}

/// Queue every recording whose words are due.
pub async fn queue_due(handle: &AppHandle, vault: &Arc<Vault>) {
    let me = vault.endpoint.id().to_string();
    let now = vault_core::ingest::now_iso();
    let (Ok(all), Ok(records)) = (vault.catalog.list().await, vault.catalog.records(TRANSCRIPT).await) else { return };
    let again = |m: &Meta| german_again(&m.tags, records.get(&m.hash)) || untagged(&m.tags, records.get(&m.hash));
    let mut todo: Vec<&Meta> = all.iter().filter(|m| wants(m) && (due(records.get(&m.hash), &me, &now) || again(m))).collect();
    // the small ones first
    todo.sort_by_key(|m| m.size);
    for m in todo {
        queue(handle.clone(), vault.clone(), m.hash.clone());
    }
}

/// Queue one recording (again): nothing happens when it is queued already.
pub fn queue(handle: AppHandle, vault: Arc<Vault>, hash: String) {
    let queued = proxies::NOW.lock().unwrap().as_ref().is_some_and(|n| n.contains_key(&key(&hash)));
    if !queued {
        proxies::set(&key(&hash), "", "queued", 0.0);
        tauri::async_runtime::spawn(one(handle, vault, hash));
    }
}

async fn one(handle: AppHandle, vault: Arc<Vault>, hex: String) {
    let k = key(&hex);
    let Ok(hash) = hex.parse::<Hash>() else { return };
    let name = vault.catalog.meta(hash).await.ok().flatten().map(|m| m.original_name).unwrap_or_default();
    proxies::set(&k, &name, "queued", 0.0);
    let turn = TURN.acquire().await;
    // an ingest first; and only while the Mac has memory to spare
    vault.hold.free_of("ingest").await;
    while pressure() > 1 {
        proxies::set(&k, &name, "waiting for memory", 0.0);
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    let me = vault.endpoint.id().to_string();
    // the tries so far go along in every record of this run (a failure counts on from them)
    let tries = vault.catalog.record(TRANSCRIPT, hash).await.ok().flatten().filter(|r| r["state"].as_str().is_some_and(|s| s.starts_with("failed") || s.starts_with("queued") || s == "transcribing")).and_then(|r| r["tries"].as_u64()).unwrap_or(0);
    let result = transcribe(&handle, &vault, hash, &name, &me, tries).await;
    proxies::clear(&k);
    drop(turn);
    // the queue is empty: the model's memory back to the Mac
    let more = proxies::NOW.lock().unwrap().as_ref().is_some_and(|n| n.keys().any(|x| x.starts_with("transcript:")));
    if !more {
        RECOGNIZER.lock().unwrap().take();
    }
    if let Err(Wait(why)) = &result {
        // not the recording's fault (the model or the sound not on this Mac yet): no try used up, again next sweep
        tracing::info!("transcript of {hex} waits: {why}");
        let r = json!({ "state": format!("queued: {why}"), "tries": tries, "device": me, "updated": vault_core::ingest::now_iso() });
        vault.catalog.write_record(TRANSCRIPT, hash, &r).await.ok();
    }
    if let Err(Fail(e)) = result {
        tracing::warn!("transcript of {hex}: {e}");
        let tries = tries + 1;
        let note = if tries < TRIES { format!("failed: {e} — tried {tries} of {TRIES}, again by itself") } else { format!("failed: {e} — tried {TRIES} times, waits for a person") };
        let r = json!({ "state": note, "tries": tries, "device": me, "updated": vault_core::ingest::now_iso() });
        vault.catalog.write_record(TRANSCRIPT, hash, &r).await.ok();
    }
    handle.emit("vault-transcript", json!({ "of": hex })).ok();
}

/// Why a transcript did not come: it waits (for what comes by itself — no try used up), or it failed.
enum Why {
    Wait(String),
    Fail(String),
}
use Why::{Fail, Wait};
impl From<String> for Why {
    fn from(e: String) -> Self {
        Fail(e)
    }
}
impl From<&str> for Why {
    fn from(e: &str) -> Self {
        Fail(e.into())
    }
}

async fn transcribe(handle: &AppHandle, vault: &Arc<Vault>, hash: Hash, name: &str, me: &str, tries: u64) -> Result<(), Why> {
    let hex = hash.to_hex().to_string();
    let k = key(&hex);
    let started = std::time::Instant::now();
    // how far, here (every change) and in the catalog (at most every 15 s — it syncs to every device)
    let last_write = Arc::new(Mutex::new(std::time::Instant::now() - Duration::from_secs(60)));
    let (v, lw, kk, nm, me2) = (vault.clone(), last_write.clone(), k.clone(), name.to_string(), me.to_string());
    let tell = move |stage: &str, done: f64| {
        proxies::set(&kk, &nm, stage, done);
        let mut lw = lw.lock().unwrap();
        if lw.elapsed() >= Duration::from_secs(15) {
            *lw = std::time::Instant::now();
            let (v, r) = (v.clone(), running(stage, done, &me2, tries));
            tauri::async_runtime::spawn(async move { v.catalog.write_record(TRANSCRIPT, hash, &r).await.ok() });
        }
    };
    tell("the speech model", 0.0);
    // the file's language when it has one (a tag); else Phonon listens first
    let tags = vault.catalog.meta(hash).await.map_err(|e| format!("{e:#}"))?.map(|m| m.tags).unwrap_or_default();
    let told = tagged(&tags);
    let first = engine_for(told.unwrap_or("en"));
    let models = ready(handle, vault, first, &tell).await?;

    // the sound: the audio proxy when it is here, else the original
    let view = vault.catalog.meta_view(hash).await.map_err(|e| format!("{e:#}"))?.ok_or("no such file")?;
    let audio = view.meta.get("audio").and_then(|a| a.as_str()).and_then(|a| a.parse::<Hash>().ok());
    let here = |h: Hash| async move { matches!(vault.store.blobs().status(h).await, Ok(BlobStatus::Complete { .. })) };
    let (source, ext) = match audio {
        Some(a) if here(a).await => (a, "m4a".to_string()),
        _ if here(hash).await => (hash, std::path::Path::new(&view.original_name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "mov".into())),
        _ => return Err(Wait("neither the recording nor its audio proxy is on this Mac yet".into())),
    };
    let path: PathBuf = vault.ingest_dir().join(format!("{hex}.asr.{ext}"));
    vault.store.blobs().export(source, &path).await.map_err(|e| format!("{e:#}"))?;
    let (p, t2) = (path.clone(), tell.clone());
    let samples = tokio::task::spawn_blocking(move || vault_media::audio::decode_mono(&p, vault_asr::RATE as u32, &mut |d| t2("reading the sound", d)))
        .await
        .map_err(|e| e.to_string())?;
    std::fs::remove_file(&path).ok();
    let Some(samples) = samples.map_err(|e| format!("{e:#}"))? else {
        let r = json!({ "state": "none: no sound track", "device": me, "at": vault_core::ingest::now_iso() });
        return vault.catalog.write_record(TRANSCRIPT, hash, &r).await.map_err(|e| Fail(format!("{e:#}")));
    };
    let seconds = samples.len() as f64 / vault_asr::RATE as f64;

    // the speech, and — the language not told — what Phonon hears it as (None: unsure)
    let samples = Arc::new(samples);
    let (t3, s3, m3) = (tell.clone(), samples.clone(), models.clone());
    let (stretches, heard) = tokio::task::spawn_blocking(move || -> Result<_, String> {
        let mut slot = RECOGNIZER.lock().unwrap();
        let r = recognizer(&mut slot, &m3, &t3)?;
        let stretches = r.speech(&s3, vault_asr::VadParams::default(), &mut |p| t3("finding speech", p)).map_err(|e| format!("{e:#}"))?;
        let heard = match told {
            None if !stretches.is_empty() => {
                t3("telling the language", 0.0);
                r.language(&s3, &stretches).map_err(|e| format!("{e:#}"))?
            }
            _ => None,
        };
        Ok((stretches, heard))
    })
    .await
    .map_err(|e| e.to_string())??;
    // Phonon unsure: Nemotron tells English from German
    let heard = heard.map(|l| if l.starts_with("de") { "de" } else { "en" });
    let tell_by_nemotron = told.is_none() && !stretches.is_empty() && heard.is_none();
    let nemotron = if tell_by_nemotron || told == Some("de") || heard == Some("de") { Some(ready(handle, vault, vault_asr::Engine::Nemotron, &tell).await?) } else { None };
    let phonon = if first == vault_asr::Engine::Phonon { Some(models) } else { None };
    let t4 = tell.clone();
    let (transcript, lang) = tokio::task::spawn_blocking(move || -> Result<(Value, Option<&'static str>), String> {
        let mut slot = RECOGNIZER.lock().unwrap();
        let lang = match (told, heard, &nemotron) {
            (Some(l), _, _) => Some(l),
            (None, Some(l), _) => Some(l),
            (None, None, Some(n)) if tell_by_nemotron => {
                t4("telling the language", 0.0);
                let locale = recognizer(&mut slot, n, &t4)?.language(&samples, &stretches).map_err(|e| format!("{e:#}"))?;
                Some(if locale.is_some_and(|l| l.starts_with("de")) { "de" } else { "en" })
            }
            _ => None,
        };
        let models = match engine_for(lang.unwrap_or("en")) {
            vault_asr::Engine::Nemotron => nemotron.as_ref(),
            vault_asr::Engine::Phonon => phonon.as_ref(),
        };
        // German told by hand, the Phonon models not needed; English told by Nemotron, Phonon's were readied first
        let models = models.ok_or("the speech model for this language is not ready")?;
        let r = recognizer(&mut slot, models, &t4)?;
        let t = r.read(&samples, &stretches, lang.and_then(vault_asr::locale), &mut |stage, d| t4(stage, d)).map_err(|e| format!("{e:#}"))?;
        Ok((t, lang))
    })
    .await
    .map_err(|e| e.to_string())??;
    let engine = engine_for(lang.unwrap_or("en"));
    // the language, on the file (told by hand: kept as it is)
    if let (None, Some(l)) = (told, lang) {
        vault.catalog.describe(hash, &json!({ "tags": with_language(&tags, l) })).await.map_err(|e| format!("{e:#}"))?;
    }

    let words = transcript["words"].as_array().map(Vec::len).unwrap_or(0);
    let mut record = transcript;
    if words == 0 {
        record = json!({ "state": "none: no speech", "model": engine.model() });
    } else {
        record["state"] = json!("done");
    }
    record["device"] = json!(me);
    record["at"] = json!(vault_core::ingest::now_iso());
    record["seconds"] = json!((seconds * 1000.0).round() / 1000.0);
    vault.catalog.write_record(TRANSCRIPT, hash, &record).await.map_err(|e| format!("{e:#}"))?;
    let took = started.elapsed().as_secs_f64();
    tracing::info!("transcribed {hex} ({seconds:.0} s of sound, {words} words, {}) in {took:.0} s — {:.2}× real time", record["language"], took / seconds.max(0.1));
    Ok(())
}

/// An engine's models ready on this Mac (or waiting for them: no try used up).
async fn ready(handle: &AppHandle, vault: &Arc<Vault>, engine: vault_asr::Engine, tell: &(impl Fn(&str, f64) + Clone + Send + 'static)) -> Result<vault_asr::Models, Why> {
    let told = tell.clone();
    crate::models::ready(handle, vault, engine, &mut move |stage, done| told(stage, done)).await.map_err(Wait)
}

/// A recording's words made again (by hand, or by an agent).
#[tauri::command]
pub async fn vault_transcribe(handle: AppHandle, app: tauri::State<'_, crate::App>, hash: String) -> crate::Res<()> {
    crate::gate()?;
    let h: Hash = hash.parse().map_err(|e| format!("{e}"))?;
    // what is there is set aside: this Mac makes it anew
    let r = json!({ "state": "queued", "device": app.vault.endpoint.id().to_string(), "updated": vault_core::ingest::now_iso() });
    app.vault.catalog.write_record(TRANSCRIPT, h, &r).await.map_err(|e| format!("{e:#}"))?;
    queue(handle, app.vault.clone(), hash);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(kind: &str, class: &str, meta: Value) -> Meta {
        Meta { hash: "h".into(), kind: kind.into(), class: class.into(), meta, ..Default::default() }
    }

    #[test]
    fn which_files() {
        assert!(wants(&file("video", "original", json!({}))));
        assert!(wants(&file("audio", "", json!({}))));
        assert!(!wants(&file("audio", "proxy", json!({ "role": "audio", "audio_of": "x" }))));
        assert!(!wants(&file("video", "delivery", json!({}))));
        assert!(!wants(&file("other", "default", json!({ "role": "model" }))));
        assert!(!wants(&file("video", "default", json!({ "shot": "s1" }))));
        assert!(!wants(&file("image", "original", json!({}))));
    }

    #[test]
    fn a_files_language_is_its_tag() {
        let tags = |t: &[&str]| t.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(tagged(&tags(&["Day 20", "de"])), Some("de"));
        assert_eq!(tagged(&tags(&["Day 20"])), None);
        assert_eq!(with_language(&tags(&["Day 20", "en"]), "de"), tags(&["Day 20", "de"]));
        assert_eq!(engine_for("de"), vault_asr::Engine::Nemotron);
        assert_eq!(engine_for("en"), vault_asr::Engine::Phonon);
        // tagged German by hand, its words Phonon's: made again; once Nemotron's, not
        let phonon = json!({ "state": "done", "model": "fermionresearch/phonon-2", "language": "en" });
        let nemotron = json!({ "state": "done", "model": "nvidia/nemotron-3.5-asr-streaming-0.6b", "language": "de" });
        assert!(german_again(&tags(&["de"]), Some(&phonon)));
        assert!(!german_again(&tags(&["de"]), Some(&nemotron)));
        assert!(!german_again(&tags(&["en"]), Some(&phonon)));
        assert!(!german_again(&tags(&["de"]), None));
        // words made before languages were tagged: made again; no speech, or a tag: not
        assert!(untagged(&tags(&[]), Some(&nemotron)));
        assert!(!untagged(&tags(&["en"]), Some(&nemotron)));
        assert!(!untagged(&tags(&[]), Some(&json!({ "state": "none: no speech" }))));
    }

    #[test]
    fn when_and_by_whom() {
        let now = "2026-09-30T12:00:00Z";
        assert!(due(None, "me", now));
        assert!(!due(Some(&json!({ "state": "done", "words": [] })), "me", now));
        assert!(!due(Some(&json!({ "state": "none: no speech" })), "me", now));
        assert!(due(Some(&json!({ "state": "failed: x", "tries": 2 })), "other", now));
        assert!(!due(Some(&json!({ "state": "failed: x", "tries": 3 })), "me", now));
        // ours, left midway: again; another device's, busy an hour ago: its own
        assert!(due(Some(&json!({ "state": "transcribing", "device": "me", "updated": "2026-09-30T11:59:00Z" })), "me", now));
        assert!(!due(Some(&json!({ "state": "transcribing", "device": "mac2", "updated": "2026-09-30T11:00:00Z" })), "me", now));
        // … gone quiet for six hours: taken over
        assert!(due(Some(&json!({ "state": "transcribing", "device": "mac2", "updated": "2026-09-30T05:59:59Z" })), "me", now));
        // moved from an old description (the server's): done
        assert!(!due(Some(&json!({ "state": "done", "device": "server (moved from the description)", "words": [] })), "me", now));
        assert_eq!(age_hours("2026-09-29T23:00:00Z", "2026-09-30T02:30:00Z"), Some(3));
        assert_eq!(age_hours("2026-02-28T12:00:00Z", "2026-03-01T12:00:00Z"), Some(24));
    }
}
