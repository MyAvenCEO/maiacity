//! Every recording's words, made here on the Mac, on-device — Phonon-2 (vault-asr), in English; nothing of the speech
//! leaves our devices for it. Words another model made (before Phonon) are made again.
//!
//! An automatic step after the ingest, like the proxies: its own queue, one recording at a time, after any ingest and
//! only while macOS says there is memory to spare; the uploads go on meanwhile (it is the CPU's work, not the line's).
//! It does not wait for the proxies either: they are the GPU's and the video encoder's.
//!
//! The sound: the original itself (sound has no proxy), decoded by AVFoundation straight to 16 kHz mono
//! (vault-media `audio`).
//!
//! What the catalog gets — `transcript/<hash>` (the original's hash), written by this Mac's author: while it runs
//! `{ state: "transcribing", stage, progress, device, updated }` (the Ingest table shows how far), then the transcript
//! `{ state: "done", model, language, locale, text, words: [{ w, s, e, c }], utterances: [{ s, e, text }], device, at }`
//! (times in seconds of the original), `none: no speech` or `failed: …` (three tries, then it waits for a person).
//! One writer per file: a file another device is transcribing is left to it (unless it went quiet for six hours).
//!
//! The model (~1 GB in memory) is loaded for a run of recordings and let go when the queue is empty.

use std::{
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

/// Its words made, but by another model than Phonon (Nemotron, Deepgram — before): made again.
pub fn by_another(record: Option<&Value>) -> bool {
    record.is_some_and(|r| r["state"] == "done" && r["model"] != vault_asr::MODEL)
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
    let mut todo: Vec<&Meta> =
        all.iter().filter(|m| wants(m) && (due(records.get(&m.hash), &me, &now) || by_another(records.get(&m.hash)))).collect();
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
    let result = transcribe(&vault, hash, &name, &me, tries).await;
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

async fn transcribe(vault: &Arc<Vault>, hash: Hash, name: &str, me: &str, tries: u64) -> Result<(), Why> {
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
    let mut models_told = tell.clone();
    // the models' bytes, read from the store only when the recognizer is not loaded yet
    let models = if RECOGNIZER.lock().unwrap().is_none() {
        Some(crate::models::ready(vault, &mut move |stage, done| models_told(stage, done)).await.map_err(Wait)?)
    } else {
        None
    };

    // the sound: the original itself (sound has no proxy)
    let view = vault.catalog.meta_view(hash).await.map_err(|e| format!("{e:#}"))?.ok_or("no such file")?;
    if !matches!(vault.store.blobs().status(hash).await, Ok(BlobStatus::Complete { .. })) {
        return Err(Wait("the recording is not on this Mac yet".into()));
    }
    // read in place from the vault's blob store, never copied out
    let src = crate::blob::source(vault, hash, &view.original_name).await.map_err(|e| Wait(format!("{e:#}")))?;
    let t2 = tell.clone();
    let samples = tokio::task::spawn_blocking(move || vault_media::audio::decode_mono(src, vault_asr::RATE as u32, &mut |d| t2("reading the sound", d)))
        .await
        .map_err(|e| e.to_string())?;
    let Some(samples) = samples.map_err(|e| format!("{e:#}"))? else {
        let r = json!({ "state": "none: no sound track", "device": me, "at": vault_core::ingest::now_iso() });
        return vault.catalog.write_record(TRANSCRIPT, hash, &r).await.map_err(|e| Fail(format!("{e:#}")));
    };
    let seconds = samples.len() as f64 / vault_asr::RATE as f64;

    // the model, loaded once for a run of recordings
    let t3 = tell.clone();
    let transcript = tokio::task::spawn_blocking(move || -> Result<Value, String> {
        let mut slot = RECOGNIZER.lock().unwrap();
        if slot.is_none() {
            t3("loading the speech model", 0.0);
            let models = models.as_ref().ok_or("the speech model was let go of while this recording waited: again")?;
            *slot = Some(vault_asr::Recognizer::open_bytes(models).map_err(|e| format!("{e:#}"))?);
        }
        slot.as_mut().unwrap().transcribe(&samples, &mut |stage, d| t3(stage, d)).map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())??;

    let words = transcript["words"].as_array().map(Vec::len).unwrap_or(0);
    let mut record = transcript;
    if words == 0 {
        record = json!({ "state": "none: no speech", "model": vault_asr::MODEL });
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
    fn words_by_another_model_made_again() {
        assert!(by_another(Some(&json!({ "state": "done", "model": "nvidia/nemotron-3.5-asr-streaming-0.6b" }))));
        assert!(!by_another(Some(&json!({ "state": "done", "model": "fermionresearch/phonon-2" }))));
        assert!(!by_another(Some(&json!({ "state": "none: no speech", "model": "nvidia/nemotron-3.5-asr-streaming-0.6b" }))));
        assert!(!by_another(None));
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
