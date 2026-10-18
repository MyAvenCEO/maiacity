//! A legacy vault file's transcript words set by hand (`transcript_edit`: a caption reworded on a legacy item). Words
//! are made by the `transcript` rule now, on avenDB's files (aven.rs `transcript`, Phonon-2 through vault-asr, the
//! model held here while a run of recordings lasts: `RECOGNIZER`); the legacy sweep that heard the legacy vault's
//! recordings is gone.

use std::sync::Mutex;

use iroh_blobs::Hash;
use serde_json::{Value, json};
use vault_core::{Vault, catalog::TRANSCRIPT};

/// the loaded model, kept for a run of recordings
pub(crate) static RECOGNIZER: Mutex<Option<vault_asr::Recognizer>> = Mutex::new(None);

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

/// A transcript's words, by hand (the Script tab, a caption reworded, the MCP): the whole list, each `{ w, s, e }`.
#[tauri::command]
pub async fn transcript_edit(app: tauri::State<'_, crate::App>, hash: String, words: Vec<Value>) -> crate::Res<Value> {
    crate::gate()?;
    let h: Hash = hash.parse().map_err(crate::err)?;
    set_words(&app.vault, h, &words, "hand").await
}

/// A legacy vault file's words made again: no longer here — a transcript is asked again from its avenDB task.
#[tauri::command]
pub async fn vault_transcribe(hash: String) -> crate::Res<()> {
    crate::gate()?;
    Err(format!("{hash}: a transcript is made again from its avenDB task (the transcript rule), not from the legacy vault"))
}
