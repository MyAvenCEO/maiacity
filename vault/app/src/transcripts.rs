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

use crate::jobs::{self, Kind};

pub const TRIES: u64 = 3;
/// Another device's transcript that has said nothing for this long is taken over.
pub const STALE_HOURS: i64 = 6;

/// the loaded model, kept for a run of recordings
static RECOGNIZER: Mutex<Option<vault_asr::Recognizer>> = Mutex::new(None);

/// Its words made, but by another model than Phonon (Nemotron, Deepgram — before): made again. Never words a person
/// put right, nor a voice take's own.
pub fn by_another(record: Option<&Value>) -> bool {
    record.is_some_and(|r| r["state"] == "done" && r.get("edited").is_none() && r["model"] != vault_asr::MODEL && r["model"] != OWN_WORDS)
}

// ── the words by hand: the transcript is the captions' one truth ─────────────────────────────────────────────────

/// A voice take's transcript: its own words, with the exact timing of the voice that spoke them (meta.words, written
/// with the take) — never heard again by a model.
pub const OWN_WORDS: &str = "own words";

/// Words as a transcript keeps them — `{ w, s, e, c?, sp? }` in time order, none empty — from its own or the captions'
/// form (`{ word, start, end }`).
pub fn clean_words(words: &[Value]) -> Vec<Value> {
    let mut out: Vec<Value> = words
        .iter()
        .filter_map(|w| {
            let text = w["w"].as_str().or(w["word"].as_str())?.trim();
            let (s, e) = (w["s"].as_f64().or(w["start"].as_f64())?, w["e"].as_f64().or(w["end"].as_f64())?);
            if text.is_empty() || !s.is_finite() || !e.is_finite() || s < 0.0 {
                return None;
            }
            let mut o = json!({ "w": text, "s": (s * 1000.0).round() / 1000.0, "e": (e.max(s) * 1000.0).round() / 1000.0 });
            if let Some(c) = w["c"].as_f64() {
                o["c"] = json!(c);
            }
            if let Some(sp) = w.get("sp").filter(|v| !v.is_null()) {
                o["sp"] = sp.clone();
            }
            Some(o)
        })
        .collect();
    out.sort_by(|a, b| a["s"].as_f64().unwrap_or(0.0).total_cmp(&b["s"].as_f64().unwrap_or(0.0)));
    out
}

/// A transcript with these words: its text and each sentence's written from them again, `edited` saying by whom and
/// when (a sweep never makes it again).
pub fn with_words(mut r: Value, words: Vec<Value>, by: &str) -> Value {
    let said = |ws: &mut dyn Iterator<Item = &Value>| ws.filter_map(|w| w["w"].as_str()).collect::<Vec<_>>().join(" ");
    if let Some(us) = r.get_mut("utterances").and_then(|u| u.as_array_mut()) {
        for u in us {
            let (s, e) = (u["s"].as_f64().unwrap_or(0.0), u["e"].as_f64().unwrap_or(0.0));
            u["text"] = json!(said(&mut words.iter().filter(|w| w["s"].as_f64().is_some_and(|ws| ws >= s - 0.02 && ws < e))));
        }
    }
    r["text"] = json!(said(&mut words.iter()));
    r["words"] = json!(words);
    r["state"] = json!("done");
    r["edited"] = json!({ "by": by, "at": vault_core::ingest::now_iso() });
    if let Some(o) = r.as_object_mut() {
        for k in ["stage", "progress", "tries", "updated"] {
            o.remove(k);
        }
    }
    r
}

/// A file's transcript words set (a word heard wrong put right, a phrase reworded; or a voice take's own words made
/// its transcript): the record written again — the captions read it, everywhere.
pub async fn set_words(vault: &Vault, hash: Hash, words: &[Value], by: &str) -> Result<Value, String> {
    let words = clean_words(words);
    if words.is_empty() {
        return Err("no words to keep".into());
    }
    let r = vault
        .catalog
        .record(TRANSCRIPT, hash)
        .await
        .map_err(|e| format!("{e:#}"))?
        .filter(|r| r["state"] == "done")
        .unwrap_or_else(|| json!({ "model": OWN_WORDS, "language": "en" }));
    let r = with_words(r, words, by);
    vault.catalog.write_record(TRANSCRIPT, hash, &r).await.map_err(|e| format!("{e:#}"))?;
    Ok(r)
}

/// Every file's own caption words (meta.words: a voice take's timing, or captions once reworded by hand) moved into
/// its transcript — once; the description's copy taken off, so one truth is left.
pub async fn fold_own_words(vault: &Vault) {
    let Ok(all) = vault.catalog.list().await else { return };
    for m in all.iter().filter(|m| m.meta.get("words").and_then(|w| w.as_array()).is_some_and(|w| !w.is_empty())) {
        let Ok(hash) = m.hash.parse::<Hash>() else { continue };
        let own = m.meta["words"].as_array().cloned().unwrap_or_default();
        match set_words(vault, hash, &own, OWN_WORDS).await {
            Ok(_) => {
                vault.catalog.describe(hash, &json!({ "meta": { "words": null } })).await.ok();
                tracing::info!("transcript of {}: its own words ({}) are its transcript now", &m.hash[..12], own.len());
            }
            Err(e) => tracing::warn!("transcript of {}: its own words: {e}", &m.hash[..12]),
        }
    }
}

/// A transcript's words, by hand (the Script tab, a caption reworded, the MCP): the whole list, each `{ w, s, e }`.
#[tauri::command]
pub async fn transcript_edit(app: tauri::State<'_, crate::App>, hash: String, words: Vec<Value>) -> crate::Res<Value> {
    crate::gate()?;
    let h: Hash = hash.parse().map_err(crate::err)?;
    set_words(&app.vault, h, &words, "hand").await
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

pub(crate) fn age_hours(at: &str, now: &str) -> Option<i64> {
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
    // a voice take's own words are its transcript (and captions once reworded by hand go into theirs)
    fold_own_words(vault).await;
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
    if jobs::queue(Kind::Transcript, &hash, "") {
        tauri::async_runtime::spawn(one(handle, vault, hash));
    }
}

async fn one(handle: AppHandle, vault: Arc<Vault>, hex: String) {
    let Ok(hash) = hex.parse::<Hash>() else { return jobs::drop_quietly(Kind::Transcript, &hex) };
    // words a person put right (or a voice take's own) are never heard again over them
    if vault.catalog.record(TRANSCRIPT, hash).await.ok().flatten().is_some_and(|r| r.get("edited").is_some()) {
        tracing::info!("transcript of {hex}: put right by hand — kept, not transcribed again");
        return jobs::drop_quietly(Kind::Transcript, &hex);
    }
    let name = vault.catalog.meta(hash).await.ok().flatten().map(|m| m.original_name).unwrap_or_default();
    jobs::name(Kind::Transcript, &hex, &name);
    // one recording at a time (the speech lane); an ingest first; and only while the Mac has memory to spare
    let Ok(turn) = jobs::turn(Kind::Transcript, &hex).await else { return };
    jobs::ready_to_run(&vault, Kind::Transcript, &hex).await;
    let me = vault.endpoint.id().to_string();
    // the tries so far go along in every record of this run (a failure counts on from them)
    let tries = vault.catalog.record(TRANSCRIPT, hash).await.ok().flatten().filter(|r| r["state"].as_str().is_some_and(|s| s.starts_with("failed") || s.starts_with("queued") || s == "transcribing")).and_then(|r| r["tries"].as_u64()).unwrap_or(0);
    let result = transcribe(&vault, hash, &name, &me, tries).await;
    match &result {
        Ok(()) => jobs::end(Kind::Transcript, &hex, Ok(())),
        Err(Wait(why)) => {
            jobs::waiting(Kind::Transcript, &hex, why);
            jobs::drop_quietly(Kind::Transcript, &hex);
        }
        Err(Fail(e)) => jobs::end(Kind::Transcript, &hex, Err(e.clone())),
    }
    drop(turn);
    // the queue is empty: the model's memory back to the Mac
    let more = jobs::list(0).active.iter().any(|j| j.kind == Kind::Transcript);
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
    // a recording's analysis waits for its words
    crate::analyse::wake();
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
    let started = std::time::Instant::now();
    // how far, here (every change) and in the catalog (at most every 15 s — it syncs to every device)
    let last_write = Arc::new(Mutex::new(std::time::Instant::now() - Duration::from_secs(60)));
    let (v, lw, hx, me2) = (vault.clone(), last_write.clone(), hex.clone(), me.to_string());
    let _ = name;
    let tell = move |stage: &str, done: f64| {
        jobs::stage(Kind::Transcript, &hx, stage, done);
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
