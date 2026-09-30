//! The on-device models, delivered by our own vault — never fetched from the internet by a device. Every model file
//! is a vault file in the **Models** story (class default, meta `{ role: "model", model, file, source, version }`),
//! pinned here by its BLAKE3 hash: it comes to this Mac over iroh like any file of the vault, and ONNX Runtime loads
//! it straight from the store's bytes (`vault_asr::ModelBytes`) — nothing is unpacked into a folder.
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
    /// its name in the files' meta
    pub id: &'static str,
    pub version: &'static str,
    pub files: &'static [ModelFile],
}

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

/// The speech models, ready on this Mac: every pinned file complete in the store (they come over iroh with the vault's
/// sync, verified by hash), read straight from it by hash. `progress` says how far ("the speech model is read").
pub async fn ready(vault: &Arc<Vault>, progress: &mut (dyn FnMut(&str, f64) + Send)) -> Result<vault_asr::ModelBytes, String> {
    let models = [&PHONON, &SILERO];
    let need = missing(vault, &models).await;
    if !need.is_empty() {
        let mb = need.iter().map(|(_, s)| s).sum::<u64>() as f64 / 1e6;
        return Err(format!("the speech model is not on this Mac yet ({} files, {mb:.0} MB still to come over iroh; once imported by hand with models_import)", need.len()));
    }
    let read = |f: &'static ModelFile| async move {
        let h: Hash = f.blake3.parse().map_err(|e| format!("{e}"))?;
        vault.store.blobs().get_bytes(h).await.map(|b| b.to_vec()).map_err(|e| format!("{}: {e:#}", f.name))
    };
    let file = |m: &'static Model, name: &str| m.files.iter().find(|f| f.name == name).ok_or_else(|| format!("{} has no {name}", m.id));
    progress("the speech model is read", 0.0);
    let bytes = vault_asr::ModelBytes {
        features: read(file(&PHONON, "nemo128.onnx")?).await?,
        encoder: read(file(&PHONON, "encoder-model.int8.onnx")?).await?,
        joint: read(file(&PHONON, "decoder_joint-model.onnx")?).await?,
        vocab: String::from_utf8(read(file(&PHONON, "vocab.txt")?).await?).map_err(|e| format!("vocab.txt: {e}"))?,
        vad: read(file(&SILERO, "silero_vad.onnx")?).await?,
    };
    progress("the speech model is read", 1.0);
    Ok(bytes)
}

/// Once, by hand: every model file downloaded from where it was published (or taken from where it was made:
/// `<vault>/ingest/models-made/<model>/<file>`), ingested into the Models story (the three-hash check), and its hash
/// compared with the pin. Returns what happened to each.
pub async fn import(vault: &Arc<Vault>, http: &reqwest::Client) -> Result<Value, String> {
    let dir = vault.ingest_dir().join("models-import");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let made = vault.ingest_dir().join("models-made");
    let mut out = Vec::new();
    for m in [&PHONON, &SILERO] {
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
        for m in [&PHONON, &SILERO] {
            for f in m.files {
                assert!(f.blake3.parse::<Hash>().is_ok(), "{}", f.name);
                assert!(f.source.ends_with(f.name), "{} ← {}", f.name, f.source);
                assert!(f.size > 0);
            }
        }
        assert!(MODELS_STORY.len() == 64);
    }
}
