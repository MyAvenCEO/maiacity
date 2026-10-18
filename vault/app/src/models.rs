//! The on-device speech models (the `transcript` rule: aven.rs `transcript`), pinned here by their BLAKE3 hashes and
//! kept on this Mac in `~/Library/Application Support/city.maia.studio/models/<blake3>`, from where ONNX Runtime loads
//! them (`vault_asr::ModelBytes`). A file not there yet is copied once out of the legacy vault's store, where the
//! Models story kept them, its hash checked; after that the legacy vault is not needed for them. A file can also be put
//! there by hand (named by its hash): it is checked the same way. Nothing is fetched from the internet by a device.

use std::path::PathBuf;

use iroh_blobs::{Hash, api::proto::BlobStatus};
use vault_core::Vault;

/// One file of a model: its name in the model's folder, where it was published (an https URL; else it is made here,
/// and `source` says by what), its size and BLAKE3 hash (pinned).
#[allow(dead_code)] // `source` and `version` say where a pin came from
pub struct ModelFile {
    pub name: &'static str,
    pub source: &'static str,
    pub size: u64,
    pub blake3: &'static str,
}

#[allow(dead_code)]
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

/// Where this Mac keeps the model files, each named by its BLAKE3 hash.
fn models_dir() -> PathBuf {
    crate::settings_file().with_file_name("models")
}

/// Model file `f` on this Mac (`models_dir`): there and whole already, else copied out of the legacy vault's store
/// (its BLAKE3 checked before it counts). Its path.
async fn kept(vault: &Vault, f: &ModelFile) -> Result<PathBuf, String> {
    let path = models_dir().join(f.blake3);
    if std::fs::metadata(&path).is_ok_and(|m| m.len() == f.size) {
        return Ok(path);
    }
    let h: Hash = f.blake3.parse().map_err(|e| format!("{e}"))?;
    if !matches!(vault.store.blobs().status(h).await, Ok(BlobStatus::Complete { .. })) {
        return Err(format!("the speech model's {} is not on this Mac: put it in {} as {}", f.name, models_dir().display(), f.blake3));
    }
    std::fs::create_dir_all(models_dir()).map_err(|e| e.to_string())?;
    let part = path.with_extension("part");
    vault.store.blobs().export(h, &part).await.map_err(|e| format!("{}: out of the legacy vault: {e}", f.name))?;
    let check = part.clone();
    let got = tauri::async_runtime::spawn_blocking(move || -> std::io::Result<String> {
        let mut hasher = blake3::Hasher::new();
        hasher.update_reader(std::fs::File::open(&check)?)?;
        Ok(hasher.finalize().to_hex().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    if got != f.blake3 {
        std::fs::remove_file(&part).ok();
        return Err(format!("{}: its copy's BLAKE3 is {got}, not its pin", f.name));
    }
    std::fs::rename(&part, &path).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Model file `f`, read whole from where this Mac keeps it, checked against its pin.
async fn read(vault: &Vault, f: &ModelFile) -> Result<Vec<u8>, String> {
    let path = kept(vault, f).await?;
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    if blake3::hash(&bytes).to_hex().as_str() != f.blake3 {
        return Err(format!("{}: {} is not the pinned file", f.name, path.display()));
    }
    Ok(bytes)
}

/// The speech models, ready on this Mac: every pinned file kept here (`kept`), read whole. `progress` says how far
/// ("the speech model is read").
pub async fn ready(vault: &Vault, progress: &mut (dyn FnMut(&str, f64) + Send)) -> Result<vault_asr::ModelBytes, String> {
    progress("the speech model is read", 0.0);
    let file = |m: &'static Model, name: &str| m.files.iter().find(|f| f.name == name).ok_or_else(|| format!("{} has no {name}", m.id));
    let read = |f: &'static ModelFile| read(vault, f);
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
