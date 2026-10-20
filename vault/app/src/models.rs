//! The on-device speech models (the `transcript` rule: aven.rs `transcript`), pinned by their BLAKE3 hashes in
//! src/lib/models/models.json (the one list, which the avenDB app's Models page reads too) and kept on this Mac in
//! `~/Library/Application Support/city.maia.studio/models/<blake3>`, from where ONNX Runtime loads them
//! (`vault_asr::ModelBytes`). A file not there yet is brought once from Maia City in avenDB, where each is a file entry
//! tagged `blake3:<its pin>` (scripts/propose-models.mjs, AIP-17), read a window at a time. Its BLAKE3 is checked against
//! the pin before it counts, and again each time it is read: a copy that is not the pinned file is never loaded. A file can also be put
//! there by hand (named by its hash): it is checked the same way. Nothing is fetched from the internet by a device.

use std::io::Write as _;
use std::path::PathBuf;
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

/// One file of a model: its name in the model's folder, where it was published (an https URL; else it is made here,
/// and `source` says by what), its size and BLAKE3 hash (pinned).
#[derive(Deserialize)]
#[allow(dead_code)] // `source` says where a pin came from
pub struct ModelFile {
    pub name: String,
    pub source: String,
    pub size: u64,
    pub blake3: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
pub struct Model {
    /// its name in the files' meta, and its tag in avenDB (`model:<id>`)
    pub id: String,
    pub version: String,
    pub files: Vec<ModelFile>,
}

#[derive(Deserialize)]
struct Pins {
    models: Vec<Model>,
}

/// Every model this Mac runs, as src/lib/models/models.json pins them (built into the app).
fn models() -> &'static [Model] {
    static PINS: OnceLock<Vec<Model>> = OnceLock::new();
    PINS.get_or_init(|| {
        let pins: Pins = serde_json::from_str(include_str!("../../../src/lib/models/models.json")).expect("models.json");
        pins.models
    })
}

/// Model `id`'s file `name`, as pinned.
fn pinned(id: &str, name: &str) -> Result<&'static ModelFile, String> {
    let m = models().iter().find(|m| m.id == id).ok_or_else(|| format!("no model {id} is pinned"))?;
    m.files.iter().find(|f| f.name == name).ok_or_else(|| format!("{id} has no {name}"))
}

/// Where this Mac keeps the model files, each named by its BLAKE3 hash.
fn models_dir() -> PathBuf {
    crate::settings_file().with_file_name("models")
}

/// The BLAKE3 of the file at `path`, hashed off the async runtime.
async fn hash_of(path: PathBuf) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> std::io::Result<String> {
        let mut hasher = blake3::Hasher::new();
        hasher.update_reader(std::fs::File::open(&path)?)?;
        Ok(hasher.finalize().to_hex().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// `part` made the kept copy of `f` at `path` if its bytes hash to `f`'s pin; else let go of, and why not.
async fn keep(part: PathBuf, path: &PathBuf, f: &ModelFile, from: &str) -> Result<(), String> {
    let got = hash_of(part.clone()).await?;
    if got != f.blake3 {
        std::fs::remove_file(&part).ok();
        return Err(format!("{}: its copy {from} hashes to {got}, not its pin", f.name));
    }
    std::fs::rename(&part, path).map_err(|e| e.to_string())
}

/// Model file `f` from Maia City in avenDB, into `part`: a file entry tagged `blake3:<its pin>` (else one named as the
/// file), read a window at a time and written as it comes, so the 654 MB encoder is never held whole. None where the
/// device isn't open or holds no such entry.
async fn from_avendb(app: &AppHandle, f: &ModelFile, part: &PathBuf) -> Result<Option<()>, String> {
    let Ok(world) = crate::aven::world(app).await else { return Ok(None) };
    let pin = format!("blake3:{}", f.blake3);
    let tagged = |e: &Value, t: &str| e["tags"].as_array().is_some_and(|ts| ts.iter().any(|x| x == t));
    let mut found: Vec<&Value> = world["entries"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|e| e["kind"] == "file" && e["deleted"] != true && !tagged(e, "avendb:deleted"))
        .filter(|e| tagged(e, &pin) || e["title"] == f.name.as_str())
        .collect();
    // the pinned one first, the newest of each
    found.sort_by_key(|e| (!tagged(e, &pin), std::cmp::Reverse(e["created"].as_u64())));
    for e in found {
        let Ok(file) = crate::aven::File::of(&e["files"][0]) else { continue };
        if file.len != f.size {
            continue;
        }
        let mut out = std::fs::File::create(part).map_err(|e| e.to_string())?;
        let mut at = 0;
        while at < file.len {
            let bytes = crate::aven::read(app, &file, at, (at + (4 << 20)).min(file.len)).await?;
            if bytes.is_empty() {
                return Err(format!("{}: avenDB's copy ends early", f.name));
            }
            out.write_all(&bytes).map_err(|e| e.to_string())?;
            at += bytes.len() as u64;
        }
        out.sync_all().map_err(|e| e.to_string())?;
        return Ok(Some(()));
    }
    Ok(None)
}

/// Model file `f` on this Mac (`models_dir`): there and whole already, else brought from Maia City in avenDB (its
/// BLAKE3 checked against the pin before it counts). Its path.
async fn kept(app: &AppHandle, f: &ModelFile) -> Result<PathBuf, String> {
    let path = models_dir().join(&f.blake3);
    if std::fs::metadata(&path).is_ok_and(|m| m.len() == f.size) {
        return Ok(path);
    }
    std::fs::create_dir_all(models_dir()).map_err(|e| e.to_string())?;
    let part = path.with_extension("part");
    let why = match from_avendb(app, f, &part).await {
        Ok(Some(())) => return keep(part, &path, f, "from avenDB").await.map(|()| path),
        Ok(None) => "Maia City holds no copy of it".to_string(),
        Err(why) => {
            std::fs::remove_file(&part).ok();
            why
        }
    };
    Err(format!("the speech model's {} is not on this Mac ({why}): put it in {} as {}", f.name, models_dir().display(), f.blake3))
}

/// Model file `f`, read whole from where this Mac keeps it, checked against its pin.
async fn read(app: &AppHandle, f: &ModelFile) -> Result<Vec<u8>, String> {
    let path = kept(app, f).await?;
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    if blake3::hash(&bytes).to_hex().as_str() != f.blake3 {
        return Err(format!("{}: {} is not the pinned file", f.name, path.display()));
    }
    Ok(bytes)
}

/// The speech models, ready on this Mac: every pinned file kept here (`kept`), read whole. `progress` says how far
/// ("the speech model is read").
pub async fn ready(app: &AppHandle, progress: &mut (dyn FnMut(&str, f64) + Send)) -> Result<vault_asr::ModelBytes, String> {
    progress("the speech model is read", 0.0);
    let bytes = vault_asr::ModelBytes {
        features: read(app, pinned("phonon-2", "nemo128.onnx")?).await?,
        encoder: read(app, pinned("phonon-2", "encoder-model.int8.onnx")?).await?,
        joint: read(app, pinned("phonon-2", "decoder_joint-model.onnx")?).await?,
        vocab: String::from_utf8(read(app, pinned("phonon-2", "vocab.txt")?).await?).map_err(|e| format!("vocab.txt: {e}"))?,
        vad: read(app, pinned("silero-vad-5", "silero_vad.onnx")?).await?,
    };
    progress("the speech model is read", 1.0);
    Ok(bytes)
}
