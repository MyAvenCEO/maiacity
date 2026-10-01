//! Every recording's sound record, read here on the Mac at ingest (it was the vault server's, with ffprobe, reading
//! the bucket's copy — sound.rs there, retired): whether it has sound, how long it runs, and the camera's start
//! timecode — AVFoundation for the tracks and the file's own boxes for the timecode (its `tmcd` track, or a sound
//! file's BWF time reference: vault-media `probe::sound`), read in place from this Mac's store.
//!
//! What the catalog gets — `sound/<hash>` (the original's hash), the same shape the server wrote: `{ state, seconds,
//! timecode?, timecode_fps?, at, device }` — `state` = done · none: no sound track · failed: … (three tries, then it
//! waits for a person). The studio's view merges it into `meta.sound_state` and `meta.probe.timecode` (vault-core
//! `with_derived`); a word's timecode is the start timecode + its `s`. The records the server wrote stay as they are.
//!
//! A round after every ingest and every ten minutes; it is quick (a file's header and one sample), so one loop does
//! every file in turn, the smallest first.

use std::{sync::Arc, time::Duration};

use iroh_blobs::{Hash, api::proto::BlobStatus};
use serde_json::{Value, json};
use vault_core::{Meta, Vault, catalog::SOUND};

pub const TRIES: u64 = 3;

static WAKE: tokio::sync::Notify = tokio::sync::Notify::const_new();

/// A round now (after an ingest).
pub fn wake() {
    WAKE.notify_one();
}

fn ms(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

/// Does this file get its sound record? A video or a sound that is an original or a working file — never a proxy or
/// a delivery, nor a deleted file, nor an audio proxy or a model.
pub fn wants_value(meta: &Value) -> bool {
    let s = |k: &str| meta.get(k).and_then(|x| x.as_str()).unwrap_or("");
    meta.pointer("/meta/deleted").is_none_or(|d| d.is_null())
        && matches!(s("class"), "" | "default" | "original")
        && matches!(s("kind"), "video" | "audio")
        && !matches!(meta.pointer("/meta/role").and_then(|r| r.as_str()), Some("audio" | "model"))
}

pub fn wants(m: &Meta) -> bool {
    serde_json::to_value(m).is_ok_and(|v| wants_value(&v))
}

/// Is its sound due now (its `sound/<hash>` record)? None yet, or left midway, or failed fewer than TRIES times.
pub fn due(record: Option<&Value>) -> bool {
    let Some(r) = record else { return true };
    let state = r["state"].as_str().unwrap_or("");
    if state == "done" || state.starts_with("none") {
        return false;
    }
    !(state.starts_with("failed") && r["tries"].as_u64().unwrap_or(0) >= TRIES)
}

/// Is a file's transcript settled — done, none, or failed for good? (The analysis of a recording waits for its words.)
pub fn settled(record: Option<&Value>) -> bool {
    let Some(r) = record else { return false };
    let state = r["state"].as_str().unwrap_or("");
    state == "done"
        || r.get("words").is_some_and(|w| w.is_array())
        || state.starts_with("none")
        || (state.starts_with("failed") && r["tries"].as_u64().unwrap_or(0) >= crate::transcripts::TRIES)
}

/// What the probe found → the record.
pub fn record_of(p: &vault_media::probe::Sound, me: &str, at: &str) -> Value {
    let mut r = json!({ "state": if p.audio { "done" } else { "none: no sound track" }, "seconds": ms(p.seconds), "at": at, "device": me });
    if let Some((tc, fps)) = &p.timecode {
        r["timecode"] = json!(tc);
        r["timecode_fps"] = json!(fps);
    }
    r
}

pub async fn sweep(vault: Arc<Vault>) {
    tokio::time::sleep(Duration::from_secs(30)).await;
    loop {
        if crate::auth::signed_in() {
            round(&vault).await;
        }
        tokio::select! {
            _ = WAKE.notified() => {}
            _ = tokio::time::sleep(Duration::from_secs(600)) => {}
        }
    }
}

async fn round(vault: &Arc<Vault>) {
    let (Ok(all), Ok(records)) = (vault.catalog.list().await, vault.catalog.records(SOUND).await) else { return };
    let mut todo: Vec<&Meta> = all.iter().filter(|m| wants(m) && due(records.get(&m.hash))).collect();
    todo.sort_by_key(|m| m.size);
    let mut done = 0;
    for m in todo {
        let Ok(hash) = m.hash.parse::<Hash>() else { continue };
        // only what this Mac holds: the rest comes round when its bytes are here
        if !matches!(vault.store.blobs().status(hash).await, Ok(BlobStatus::Complete { .. })) {
            continue;
        }
        crate::jobs::queue(crate::jobs::Kind::Sound, &m.hash, &m.original_name);
        crate::jobs::stage(crate::jobs::Kind::Sound, &m.hash, "reading its sound", 0.0);
        one(vault, hash, &m.original_name, records.get(&m.hash)).await;
        done += 1;
    }
    if done > 0 {
        // a recording's analysis waits for its sound record (and its words)
        crate::analyse::wake();
    }
}

async fn one(vault: &Arc<Vault>, hash: Hash, name: &str, before: Option<&Value>) {
    let me = vault.endpoint.id().to_string();
    let result = async {
        let src = crate::blob::source(vault, hash, name).await.map_err(|e| format!("{e:#}"))?;
        tokio::task::spawn_blocking(move || objc2::rc::autoreleasepool(|_| vault_media::probe::sound(src)))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("{e:#}"))
    }
    .await;
    crate::jobs::end(crate::jobs::Kind::Sound, &hash.to_hex().to_string(), result.as_ref().map(|_| ()).map_err(|e| e.clone()));
    let record = match result {
        Ok(p) => {
            tracing::info!("the sound of {} ({:.0} s, timecode {:?})", hash.fmt_short(), p.seconds, p.timecode);
            record_of(&p, &me, &vault_core::ingest::now_iso())
        }
        Err(e) => {
            tracing::warn!("sound of {}: {e}", hash.fmt_short());
            let tries = before.and_then(|r| r["tries"].as_u64()).unwrap_or(0) + 1;
            json!({ "state": crate::analyse::plan::failed(&e, tries), "tries": tries, "device": me, "updated": vault_core::ingest::now_iso() })
        }
    };
    vault.catalog.write_record(SOUND, hash, &record).await.ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn which_files_and_when() {
        let orig = json!({ "kind": "video", "class": "original", "meta": {} });
        assert!(wants_value(&orig) && due(None));
        assert!(wants_value(&json!({ "kind": "audio", "class": "" })));
        assert!(!wants_value(&json!({ "kind": "video", "class": "proxy" })));
        assert!(!wants_value(&json!({ "kind": "audio", "class": "default", "meta": { "role": "audio" } })));
        assert!(!wants_value(&json!({ "kind": "image", "class": "original" })));
        assert!(!wants_value(&json!({ "kind": "video", "class": "original", "meta": { "deleted": { "at": "x" } } })));
        assert!(!due(Some(&json!({ "state": "done", "audio": "a" }))));
        assert!(!due(Some(&json!({ "state": "none: no sound track" }))));
        assert!(due(Some(&json!({ "state": "failed: x", "tries": 2 }))));
        assert!(!due(Some(&json!({ "state": "failed: x", "tries": 3 }))));
        // left midway (the server's old "making"): again
        assert!(due(Some(&json!({ "state": "making" }))));
        // a transcript settled: the analysis may go on
        assert!(settled(Some(&json!({ "state": "done", "words": [] }))) && settled(Some(&json!({ "state": "failed: x", "tries": 3 }))));
        assert!(settled(Some(&json!({ "state": "none: no speech" }))));
        assert!(!settled(None) && !settled(Some(&json!({ "state": "transcribing", "progress": 0.4 }))));
    }

    #[test]
    fn the_record_is_the_server_s_shape() {
        let p = vault_media::probe::Sound { audio: true, seconds: 12.3456, fps: Some(23.976), timecode: Some(("14:03:22:11".into(), 23.976)) };
        assert_eq!(
            record_of(&p, "mac", "2026-09-30T12:00:00Z"),
            json!({ "state": "done", "seconds": 12.346, "timecode": "14:03:22:11", "timecode_fps": 23.976, "at": "2026-09-30T12:00:00Z", "device": "mac" })
        );
        let mute = vault_media::probe::Sound { audio: false, seconds: 3.0, fps: Some(25.0), timecode: None };
        assert_eq!(record_of(&mute, "mac", "t")["state"], "none: no sound track");
    }

    /// The real thing on a movie ffmpeg makes: a 25 fps take with timecode 10:00:00:00 and a tone. Skipped without
    /// ffmpeg.
    #[test]
    fn probes_timecode_and_sound() {
        let dir = std::env::temp_dir().join(format!("vault-sound-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let movie = dir.join("take.mov");
        let made = std::process::Command::new("ffmpeg")
            .args(["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=25:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2"])
            .args(["-map", "0:v", "-map", "1:a", "-c:v", "mpeg4", "-c:a", "pcm_s16le", "-timecode", "10:00:00:00"])
            .arg(&movie)
            .status();
        if !made.is_ok_and(|s| s.success()) {
            eprintln!("no ffmpeg here: skipped");
            return;
        }
        let p = objc2::rc::autoreleasepool(|_| vault_media::probe::sound(&movie)).unwrap();
        assert!(p.audio);
        assert!((p.seconds - 2.0).abs() < 0.1, "{}", p.seconds);
        assert_eq!(p.timecode, Some(("10:00:00:00".into(), 25.0)));
        std::fs::remove_dir_all(&dir).ok();
    }
}
