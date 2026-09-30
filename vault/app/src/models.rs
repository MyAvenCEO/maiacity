//! The on-device models, delivered by our own vault — never fetched from the internet by a device. Every model file
//! is a vault file in the **Models** story (class default, meta `{ role: "model", model, file, source, version }`),
//! pinned here by its BLAKE3 hash: the app finds it in its own store (iroh-verified), or has it come down like any
//! file (the gateway, checked against its hash — `sync::fetch_from_gateway`), and exports it by hash into
//! `<vault>/models/<model>/<file>` (ONNX Runtime reads real files, the encoder's weights beside it by name).
//!
//! Once, by hand (the MCP tool `models_import`, run on one Mac): each file is downloaded from where it was published
//! (or, made here — Phonon-2's ONNX, by vault/tools/phonon2_onnx.py — taken from `<vault>/ingest/models-made/<model>/`),
//! ingested into the Models story with the normal three-hash check, and its hash compared with the pin — after that
//! nothing fetches from the internet again; new devices get the models peer to peer / from the bucket.

use std::{path::PathBuf, sync::Arc};

use iroh_blobs::{Hash, api::proto::BlobStatus};
use serde_json::{Value, json};
use vault_core::{Vault, ingest::Batch};

/// The Models story (maiaCITY Studio): where every model file is kept.
pub const MODELS_STORY: &str = "5f4381a8410988727d96c94d96ae953646961814ba92ba421ef7db4dc2c9f016";

/// One file of a model: its name in the model's folder, where it was published (an https URL; else it is made here,
/// and `source` says by what), its size and BLAKE3 hash (pinned).
pub struct ModelFile {
    pub name: &'static str,
    pub source: &'static str,
    pub size: u64,
    pub blake3: &'static str,
}

pub struct Model {
    /// the model's folder under `<vault>/models/`, and its name in the files' meta
    pub id: &'static str,
    pub version: &'static str,
    pub files: &'static [ModelFile],
}

/// NVIDIA Nemotron 3.5 ASR streaming, 0.6B, multilingual, as parakeet-rs 0.3.7 reads it (ONNX export by altunenes;
/// the sizes and SHA-256 match Hugging Face's LFS records of 2026-09-30).
pub const NEMOTRON: Model = Model {
    id: "nemotron-3.5-asr-streaming-0.6b",
    version: "altunenes/parakeet-rs@main 2026-09-30",
    files: &[
        ModelFile { name: "config.json", source: "https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-3.5-asr-streaming-0.6b-onnx/config.json", size: 2_979, blake3: "01f1935a37268549ebda20b4fb05dc0798302d86a115301322c3aa4a14b01119" },
        ModelFile { name: "tokenizer.model", source: "https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-3.5-asr-streaming-0.6b-onnx/tokenizer.model", size: 406_554, blake3: "9655b6ccd0ddeb098d493d62e8c9c79c6491d0af4119b6c709479a691e541010" },
        ModelFile { name: "encoder.onnx", source: "https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-3.5-asr-streaming-0.6b-onnx/encoder.onnx", size: 42_164_972, blake3: "f53de9242341f68ac53c2441c7403ca7670f06603124e6364b67ecbf256edb0a" },
        ModelFile { name: "decoder_joint.onnx", source: "https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-3.5-asr-streaming-0.6b-onnx/decoder_joint.onnx", size: 97_590_054, blake3: "c788e6afeaea4261b4c16884d57342de4789477486f622fbf5de51d573e18d69" },
        ModelFile { name: "encoder.onnx.data", source: "https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-3.5-asr-streaming-0.6b-onnx/encoder.onnx.data", size: 2_454_405_120, blake3: "e51db1a31bd36111a2271e731a6258366d8d50de4f7d26c6f78db3e74a3be839" },
    ],
};

/// Phonon-2 (FermionResearch/Phonon-2, English): Parakeet TDT 0.6B v3's graph as istupakov exported it, with Phonon's
/// weights — made once by vault/tools/phonon2_onnx.py --int8 from phonon-2.bps.tar.zst (sha256 98125795…) and
/// istupakov/parakeet-tdt-0.6b-v3-onnx; the preprocessor and the vocabulary are the export's own.
pub const PHONON: Model = Model {
    id: "phonon-2",
    version: "FermionResearch/Phonon-2@main 2026-09-30, int8",
    files: &[
        ModelFile { name: "nemo128.onnx", source: "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/nemo128.onnx", size: 139_764, blake3: "45c31fc9296461324ce2788deb5e0a00b1d9879db27c6816d5a8e65ffb629cee" },
        ModelFile { name: "vocab.txt", source: "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/vocab.txt", size: 93_939, blake3: "2609f23eb2e123e568f7bfa26ca772c053856733a255a95080cde91cd1af2bbc" },
        ModelFile { name: "decoder_joint-model.onnx", source: "vault/tools/phonon2_onnx.py: decoder_joint-model.onnx", size: 72_520_893, blake3: "e51a6521eb2a061e84debac32f6dbce474f876c678f969abd6e68c75984387c1" },
        ModelFile { name: "encoder-model.int8.onnx", source: "vault/tools/phonon2_onnx.py --int8: encoder-model.int8.onnx", size: 654_033_351, blake3: "4860a3feb477f45f31058fa170a470ab08a5eeaf5b77df620b41d686e0a585b1" },
    ],
};

/// Silero VAD v5 (snakers4/silero-vad).
pub const SILERO: Model = Model {
    id: "silero-vad-5",
    version: "snakers4/silero-vad@master 2026-09-30",
    files: &[ModelFile {
        name: "silero_vad.onnx",
        source: "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx",
        size: 2_327_524,
        blake3: "bd861b19a51c83ee067b54d7d8b7f40bc11bafcc526506edc00b163e1c53bb8e",
    }],
};

/// A speech engine's model.
pub fn model(engine: vault_asr::Engine) -> &'static Model {
    match engine {
        vault_asr::Engine::Phonon => &PHONON,
        vault_asr::Engine::Nemotron => &NEMOTRON,
    }
}

/// The speech models' folders on this Mac.
pub fn speech_models(vault: &Vault, engine: vault_asr::Engine) -> vault_asr::Models {
    let root = vault.dir.join("models");
    vault_asr::Models { engine, speech: root.join(model(engine).id), vad: root.join(SILERO.id).join(SILERO.files[0].name) }
}

/// The files of these models not complete in this Mac's store yet.
async fn missing(vault: &Vault, models: &[&Model]) -> Vec<(Hash, u64)> {
    let mut out = Vec::new();
    for f in models.iter().flat_map(|m| m.files.iter()) {
        let Ok(h) = f.blake3.parse::<Hash>() else { continue };
        if !matches!(vault.store.blobs().status(h).await, Ok(BlobStatus::Complete { .. })) {
            out.push((h, f.size));
        }
    }
    out
}

/// Make an engine's speech models ready on this Mac: every pinned file in the store (the missing ones come down from
/// the server, checked against their hashes), then exported by hash into its folder. `progress` says how far
/// ("the speech model arrives", 0…1 by bytes; "the speech model is unpacked").
pub async fn ready(handle: &tauri::AppHandle, vault: &Arc<Vault>, engine: vault_asr::Engine, progress: &mut (dyn FnMut(&str, f64) + Send)) -> Result<vault_asr::Models, String> {
    use tauri::Manager;
    let models = [model(engine), &SILERO];
    let need = missing(vault, &models).await;
    if !need.is_empty() {
        let total: u64 = need.iter().map(|(_, s)| s).sum::<u64>().max(1);
        let mut done = 0u64;
        let auth = handle.state::<crate::auth::Auth>();
        for (h, size) in need {
            progress("the speech model arrives", done as f64 / total as f64);
            crate::sync::fetch_from_gateway(vault, &auth, h)
                .await
                .map_err(|e| format!("the speech model is not in our vault yet ({e}) — import it once with the MCP tool models_import"))?;
            done += size;
        }
        progress("the speech model arrives", 1.0);
    }
    for m in models {
        let dir = vault.dir.join("models").join(m.id);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        for f in m.files {
            let path = dir.join(f.name);
            let pin = dir.join(format!(".{}.blake3", f.name));
            // exported before, from exactly this hash: kept
            if std::fs::read_to_string(&pin).is_ok_and(|p| p.trim() == f.blake3) && std::fs::metadata(&path).is_ok_and(|md| md.len() == f.size) {
                continue;
            }
            progress("the speech model is unpacked", 0.0);
            let h: Hash = f.blake3.parse().map_err(|e| format!("{e}"))?;
            std::fs::remove_file(&path).ok();
            vault.store.blobs().export(h, &path).await.map_err(|e| format!("{e:#}"))?;
            std::fs::write(&pin, f.blake3).map_err(|e| e.to_string())?;
        }
    }
    Ok(speech_models(vault, engine))
}

/// Once, by hand: every model file downloaded from where it was published (or taken from where it was made:
/// `<vault>/ingest/models-made/<model>/<file>`), ingested into the Models story (the three-hash check), and its hash
/// compared with the pin. Returns what happened to each.
pub async fn import(vault: &Arc<Vault>, http: &reqwest::Client) -> Result<Value, String> {
    let dir = vault.ingest_dir().join("models-import");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let made = vault.ingest_dir().join("models-made");
    let mut out = Vec::new();
    for m in [&PHONON, &NEMOTRON, &SILERO] {
        for f in m.files {
            let pinned: Hash = f.blake3.parse().map_err(|e| format!("{e}"))?;
            if matches!(vault.store.blobs().status(pinned).await, Ok(BlobStatus::Complete { .. })) && vault.catalog.has(pinned).await.unwrap_or(false) {
                out.push(json!({ "model": m.id, "file": f.name, "hash": f.blake3, "verdict": "already in the vault" }));
                continue;
            }
            let path = dir.join(f.name);
            if f.source.starts_with("https://") {
                download(http, f.source, &path).await?;
            } else {
                let from = made.join(m.id).join(f.name);
                if !from.is_file() {
                    return Err(format!("{} is made here, not downloaded ({}) — put it at {} first", f.name, f.source, from.display()));
                }
                std::fs::rename(&from, &path).or_else(|_| std::fs::copy(&from, &path).map(|_| ())).map_err(|e| format!("{}: {e}", from.display()))?;
            }
            let batch = Batch {
                session: format!("models {}", vault_core::ingest::now_iso()),
                tags: vec!["model".into(), m.id.into()],
                title: Some(format!("{} · {}", m.id, f.name)),
                meta: json!({ "role": "model", "model": m.id, "file": f.name, "source": f.source, "version": m.version }),
                story: Some(MODELS_STORY.into()),
                class: Some("default".into()),
                moves_existing: false,
                ..Default::default()
            };
            let o = vault.ingest_file(&path, &batch).await.map_err(|e| format!("{e:#}"))?;
            std::fs::remove_file(&path).ok();
            let ok = o.hash == f.blake3;
            out.push(json!({ "model": m.id, "file": f.name, "hash": o.hash, "pinned": f.blake3, "matches_pin": ok, "verdict": o.verdict }));
            if !ok {
                return Err(format!("{} came in as {} — the pin is {}: not what the code expects (a new version? then pin it in models.rs)", f.name, o.hash, f.blake3));
            }
        }
    }
    std::fs::remove_dir_all(&dir).ok();
    Ok(Value::Array(out))
}

async fn download(http: &reqwest::Client, url: &str, to: &PathBuf) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let mut res = http.get(url).send().await.map_err(|e| format!("{url}: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("{url} answered {}", res.status()));
    }
    let mut file = tokio::fs::File::create(to).await.map_err(|e| e.to_string())?;
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("{url}: {e}"))? {
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    file.sync_all().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_pin_is_a_hash_and_every_source_names_its_file() {
        for m in [&PHONON, &NEMOTRON, &SILERO] {
            for f in m.files {
                assert!(f.blake3.parse::<Hash>().is_ok(), "{}", f.name);
                assert!(f.source.ends_with(f.name), "{} ← {}", f.name, f.source);
                assert!(f.size > 0);
            }
        }
        assert!(MODELS_STORY.len() == 64);
        for e in vault_asr::Engine::ALL {
            assert_eq!(model(e).id, e.id(), "the folder an engine reads is its model's");
        }
    }
}
