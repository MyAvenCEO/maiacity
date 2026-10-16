//! avenDB's files for the studio's Rust (Jobs and studio 2.0): the bytes of a file of the person's vaults, read in
//! place by range from avenDB's device inside the app (avendb.rs), as the byte source every reader of vault-media and
//! vault-render takes (`Source::Blob`, as blob.rs gives the legacy vault's); and a file on this Mac brought into a vault
//! (`put_path`), read back and compared before it counts. Every read and write is one op through the device's `run`,
//! the same the page sends (avendb/docs/ARCHITECTURE.md §8), so the keys never leave the device.
//!
//! The jobs: `studio_job` does one task of a rule the page's worker claimed (src/lib/studio/jobs/worker.js) in the
//! Mac's lanes (jobs.rs) and answers what it made; `studio_ingest` brings a card's files in (plan J1).

use std::io::{self, Read as _};
use std::path::Path;
use std::sync::{Arc, Mutex};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter as _};
use vault_media::{ByteSource, Source};

/// How many bytes a read asks the device for at a time: AVFoundation reads in small pieces, mostly in order.
const WINDOW: u64 = 4 << 20;

/// The tag that marks an entry deleted in avenDB (src/lib/avendb/ops.js `DELETED`): it can come back.
const DELETED: &str = "avendb:deleted";

/// How many bytes of a file on this Mac go to the device in one chunk (as the page's, src/lib/avendb/native.js).
const CHUNK: usize = 1 << 20;

/// A file of an entry, as the device's world shows it (`FileView`): its root and sealed size, which name it, and its
/// plain length, which only a device that may open it knows.
#[derive(Clone, Debug)]
pub struct File {
    pub root: String,
    pub size: u64,
    pub len: u64,
}

impl File {
    /// The file `v` names (`{root, size, len}`), or why it can't be read here.
    pub fn of(v: &Value) -> Result<Self, String> {
        let root = v["root"].as_str().ok_or("the file names no root")?.to_string();
        let size = v["size"].as_u64().ok_or("the file has no sealed size")?;
        let len = v["len"].as_u64().ok_or("this Mac can't open the file's bytes")?;
        Ok(Self { root, size, len })
    }
}

/// What an op answered, or why it was refused (`answer` in src/lib/avendb/ops.js).
pub fn answer(out: Value) -> Result<Value, String> {
    match out.get("ok") {
        Some(ok) => Ok(ok.clone()),
        None if out.get("approve").is_some() => Err("it needs the approval of the vault's owners".into()),
        None => Err(format!("refused: {}", out.get("why").or(out.get("refused")).unwrap_or(&out))),
    }
}

/// Runs op `op` on the device: what it answered.
pub async fn run(app: &AppHandle, op: Value) -> Result<Value, String> {
    answer(crate::avendb::call(app, "run", vec![op]).await?)
}

/// The device's world, now (`{me, mine, entries, …}`).
pub async fn world(app: &AppHandle) -> Result<Value, String> {
    run(app, json!({ "op": "world" })).await
}

/// File `f`'s plain bytes from `from` to `to`.
pub async fn read(app: &AppHandle, f: &File, from: u64, to: u64) -> Result<Vec<u8>, String> {
    let op = json!({ "op": "read_file", "root": f.root, "size": f.size, "from": from, "to": to });
    let out = crate::avendb::call(app, "run", vec![op]).await?;
    let bytes = out.get("bytes").and_then(Value::as_str).map(str::to_string);
    answer(out)?;
    BASE64.decode(bytes.ok_or("the device gave no bytes")?).map_err(|e| format!("the device's bytes: {e}"))
}

/// File `f`'s plain bytes, all of them, a window at a time.
pub async fn read_all(app: &AppHandle, f: &File) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(f.len as usize);
    while (out.len() as u64) < f.len {
        let at = out.len() as u64;
        let bytes = read(app, f, at, (at + WINDOW).min(f.len)).await?;
        if bytes.is_empty() {
            return Err("the file ends early".into());
        }
        out.extend_from_slice(&bytes);
    }
    Ok(out)
}

/// A file of avenDB read in place, a window of it held for the next read.
struct AvenBytes {
    app: AppHandle,
    file: File,
    rt: tokio::runtime::Handle,
    /// the window read last: where it starts, and its bytes
    held: Mutex<(u64, Arc<Vec<u8>>)>,
}

impl ByteSource for AvenBytes {
    fn len(&self) -> u64 {
        self.file.len
    }

    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        if offset >= self.file.len || buf.is_empty() {
            return Ok(0);
        }
        let (at, bytes) = self.held.lock().unwrap_or_else(|p| p.into_inner()).clone();
        let (at, bytes) = if offset >= at && offset < at + bytes.len() as u64 {
            (at, bytes)
        } else {
            let to = (offset + WINDOW.max(buf.len() as u64)).min(self.file.len);
            let read = read(&self.app, &self.file, offset, to);
            // on one of the runtime's own threads handed over to block; on AVFoundation's queues waited on directly
            let got = if tokio::runtime::Handle::try_current().is_ok() {
                tokio::task::block_in_place(|| self.rt.block_on(read))
            } else {
                self.rt.block_on(read)
            };
            let bytes = Arc::new(got.map_err(io::Error::other)?);
            *self.held.lock().unwrap_or_else(|p| p.into_inner()) = (offset, bytes.clone());
            (offset, bytes)
        };
        let from = (offset - at) as usize;
        let n = buf.len().min(bytes.len() - from);
        buf[..n].copy_from_slice(&bytes[from..from + n]);
        Ok(n)
    }
}

/// The app, for the readers that have no handle of their own (the player, the render): set as it starts (`init`).
static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// The app's handle, kept for the readers that have none (`APP`).
pub fn init(app: &AppHandle) {
    APP.set(app.clone()).ok();
}

/// How the page names an avenDB file where the legacy studio names a vault file by its hash (a clip's file, the
/// player's `files`): `aven:<root>:<sealed size>:<length>`.
pub fn ref_of(f: &File) -> String {
    format!("aven:{}:{}:{}", f.root, f.size, f.len)
}

/// The file reference `r` names, if it names an avenDB file (`ref_of`); `None` for a legacy vault hash.
pub fn file_of_ref(r: &str) -> Option<Result<File, String>> {
    let rest = r.strip_prefix("aven:")?;
    let mut parts = rest.split(':');
    let (Some(root), Some(size), Some(len)) = (parts.next(), parts.next(), parts.next()) else {
        return Some(Err(format!("{r} names no avenDB file")));
    };
    Some(match (size.parse(), len.parse()) {
        (Ok(size), Ok(len)) => Ok(File { root: root.to_string(), size, len }),
        _ => Err(format!("{r} names no avenDB file")),
    })
}

/// The source reference `r` names when it is an avenDB file (`ref_of`), read in place; `None` for a legacy vault hash,
/// which the caller reads from the legacy vault as before.
pub fn source_of_ref(r: &str, name: &str) -> Option<Result<Source, String>> {
    let file = file_of_ref(r)?;
    Some(file.and_then(|f| Ok(source(APP.get().ok_or("the app isn't up yet")?, f, name))))
}

/// File `f` of avenDB as a source read in place (`name`'s extension says what it is: AVFoundation tells a movie by its
/// type).
pub fn source(app: &AppHandle, f: File, name: &str) -> Source {
    source_with(app, &tokio::runtime::Handle::current(), f, name)
}

/// The same, its reads run on runtime `rt` (for a reader on a thread of its own, as the render's library is).
pub fn source_on(rt: &tokio::runtime::Handle, f: File, name: &str) -> Result<Source, String> {
    Ok(source_with(APP.get().ok_or("the app isn't up yet")?, rt, f, name))
}

fn source_with(app: &AppHandle, rt: &tokio::runtime::Handle, f: File, name: &str) -> Source {
    let ext = crate::blob::ext_of(name);
    let at = format!("{}.{ext}", f.root);
    Source::blob(Arc::new(AvenBytes { app: app.clone(), file: f, rt: rt.clone(), held: Mutex::new((0, Arc::new(vec![]))) }), at)
}

/// File `f`'s reference as the page writes it, its media type with it (src/lib/studio/avenref.js `avenRef`): a
/// delivery named so in the render's report is the same item the studio's library lists.
pub fn media_ref(f: &File, media: &str) -> String {
    // encodeURIComponent: all but letters, digits and -_.!~*'() escaped
    let enc: String = media
        .bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect();
    format!("{}:{enc}", ref_of(f))
}

/// Brings the file at `path` into avenDB with `put_file` op `op` (its `len` set here): it is read once for the device
/// to key it and once to seal it, each pass hashed; then the sealed file is read back from the device and its BLAKE3
/// compared with the one read from the disk, so that a card counts as in only once its bytes are known to be. `done`
/// hears how many bytes went in, over both passes and the read-back. The op's answer, with `blake3` added.
pub async fn put_path(app: &AppHandle, op: Value, path: &Path, done: impl Fn(u64)) -> Result<Value, String> {
    put_source(app, op, &Source::from(path), done).await
}

/// `n` bytes of `src` from `at` (fewer at its end), read on a thread of the blocking pool (a legacy vault file is read
/// in place, by waiting on its store).
async fn chunk_of(src: &Source, at: u64, n: usize) -> Result<Vec<u8>, String> {
    use std::io::{Seek as _, SeekFrom};
    let src = src.clone();
    tauri::async_runtime::spawn_blocking(move || -> io::Result<Vec<u8>> {
        let mut r = src.reader()?;
        r.seek(SeekFrom::Start(at))?;
        let mut buf = vec![0u8; n];
        let mut got = 0;
        while got < n {
            let k = r.read(&mut buf[got..])?;
            if k == 0 {
                break;
            }
            got += k;
        }
        buf.truncate(got);
        Ok(buf)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e}"))
}

/// `put_path` for any source: a file on this Mac, or a legacy vault file read in place (`studio_import`).
pub async fn put_source(app: &AppHandle, mut op: Value, src: &Source, done: impl Fn(u64)) -> Result<Value, String> {
    let len = {
        let s = src.clone();
        tauri::async_runtime::spawn_blocking(move || s.reader().and_then(|mut r| r.len())).await.map_err(|e| e.to_string())?.map_err(|e| format!("{src}: {e}"))?
    };
    op["len"] = json!(len);
    let n = crate::avendb::call(app, "fileStart", vec![op]).await?;
    let mut sum = None;
    let mut moved = 0;
    let given = async {
        loop {
            let mut hash = blake3::Hasher::new();
            let mut at = 0u64;
            while at < len {
                let buf = chunk_of(src, at, CHUNK.min((len - at) as usize)).await?;
                if buf.is_empty() {
                    return Err(format!("{src} ends early: it changed while it came in"));
                }
                hash.update(&buf);
                crate::avendb::call(app, "fileChunk", vec![n.clone(), json!(at), json!(BASE64.encode(&buf))]).await?;
                at += buf.len() as u64;
                moved += buf.len() as u64;
                done(moved);
            }
            let this = hash.finalize();
            if sum.is_some_and(|s| s != this) {
                return Err(format!("{src} changed while it came in"));
            }
            sum = Some(this);
            if crate::avendb::call(app, "fileAgain", vec![n.clone()]).await? != json!(true) {
                break;
            }
        }
        crate::avendb::call(app, "fileEnd", vec![n.clone()]).await.and_then(answer)
    }
    .await;
    let mut put = match given {
        Ok(put) => put,
        Err(e) => {
            crate::avendb::call(app, "fileDrop", vec![n]).await.ok();
            return Err(e);
        }
    };
    // read back: the device's sealed bytes, opened again, must be the disk's
    let f = File { root: put["root"].as_str().unwrap_or_default().into(), size: put["size"].as_u64().unwrap_or(0), len };
    let mut back = blake3::Hasher::new();
    let mut at = 0;
    while at < len {
        let to = (at + WINDOW).min(len);
        let bytes = read(app, &f, at, to).await?;
        if bytes.is_empty() {
            return Err("avenDB's copy ends early".into());
        }
        back.update(&bytes);
        at += bytes.len() as u64;
        moved += bytes.len() as u64;
        done(moved);
    }
    let sum = sum.ok_or("the file was never read")?;
    if back.finalize() != sum {
        return Err(format!("avenDB's copy of {src} doesn't match the source's: not counted"));
    }
    put["blake3"] = json!(sum.to_hex().to_string());
    Ok(put)
}

/// One file of a card brought in (`studio_ingest`), or why not.
#[derive(serde::Serialize)]
pub struct Brought {
    path: String,
    entry: Option<String>,
    blake3: Option<String>,
    error: Option<String>,
}

/// Brings the files at `paths` (and in the folders among them) into vault `vault` (acting as `actor`, the vault's own by default) as originals: each a
/// `file` entry tagged `media:original` and `tags`, read back and compared (`put_path`). One at a time, in the Io lane;
/// the page hears `studio-ingest` events `{path, done, len}` as each goes in. What became of each.
#[tauri::command]
pub async fn studio_ingest(
    app: AppHandle,
    vault: String,
    paths: Vec<String>,
    tags: Vec<String>,
    actor: Option<String>,
) -> Result<Vec<Brought>, String> {
    let mut files = vec![];
    for p in &paths {
        files.extend(vault_core::ingest::walk(Path::new(p)).map_err(|e| format!("{p}: {e:#}"))?);
    }
    let mut out = vec![];
    for path in files {
        let p = path.display().to_string();
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p.clone());
        let media = vault_core::ingest::mime_of(&path);
        let mut all = vec!["media:original".to_string()];
        all.extend(tags.iter().filter(|t| *t != "media:original").cloned());
        let mut op = json!({ "op": "put_file", "vault": vault, "name": name, "media": media, "tags": all });
        if let Some(actor) = &actor {
            op["as"] = json!(actor);
        }
        let subject = format!("aven:{p}");
        crate::jobs::queue(crate::jobs::Kind::Ingest, &subject, &name);
        let len = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0).max(1);
        // two passes in, one back: three times its length moves
        let total = 3 * len;
        let (app2, p2, s2) = (app.clone(), p.clone(), subject.clone());
        let told = move |moved: u64| {
            crate::jobs::stage(crate::jobs::Kind::Ingest, &s2, "bringing it into avenDB", moved as f64 / total as f64);
            app2.emit("studio-ingest", json!({ "path": p2, "done": moved, "len": total })).ok();
        };
        let put = put_path(&app, op, &path, told).await;
        crate::jobs::end(crate::jobs::Kind::Ingest, &subject, put.as_ref().map(|_| ()).map_err(Clone::clone));
        match put {
            Ok(put) => {
                out.push(Brought {
                    path: p,
                    entry: put["entry"].as_str().map(str::to_string),
                    blake3: put["blake3"].as_str().map(str::to_string),
                    error: None,
                });
            }
            Err(e) => {
                out.push(Brought { path: p, entry: None, blake3: None, error: Some(e) });
            }
        }
    }
    Ok(out)
}

/// What a task of a rule the page's worker claimed reads and does (`studio_job`): the task itself, the entries its
/// inputs name and, for an input another rule made, the files that task made, all as the device's world shows them
/// (`EntryView`), by entry; and the vault the worker acts as in the task's vault, which what it makes is put as.
pub struct Job<'a> {
    app: &'a AppHandle,
    task: &'a Value,
    entries: &'a serde_json::Map<String, Value>,
    /// a cut's rules only: the studio's library items of avenDB's footage (src/lib/studio/aven.js `libraryOf`)
    library: &'a [Value],
    actor: &'a str,
    kind: crate::jobs::Kind,
    subject: String,
}

impl Job<'_> {
    /// The entry input `name` names.
    fn input(&self, name: &str) -> Result<&Value, String> {
        let id = self.task["inputs"].as_array().into_iter().flatten().find(|i| i["name"] == name).and_then(|i| i["entry"].as_str());
        id.and_then(|id| self.entries.get(id)).ok_or_else(|| format!("its {name} is not on this Mac"))
    }

    /// The value the rule behind input `name` made (its done task's `result`).
    fn value(&self, name: &str) -> Result<Value, String> {
        let t = self.input(name)?;
        serde_json::from_str(t["record"]["result"].as_str().unwrap_or("null")).map_err(|e| format!("its {name}: {e}"))
    }

    /// The same, whole: a long value read back from the JSON file it went into (`spill`).
    async fn full_value(&self, name: &str) -> Result<Value, String> {
        let v = self.value(name)?;
        let Some(id) = v["file"].as_str() else { return Ok(v) };
        let e = self.entries.get(id).ok_or_else(|| format!("its {name}'s file is not on this Mac"))?;
        let f = File::of(e["files"].as_array().and_then(|f| f.first()).ok_or_else(|| format!("its {name}'s file brings no bytes"))?)?;
        let bytes = read_all(self.app, &f).await?;
        serde_json::from_slice(&bytes).map_err(|err| format!("its {name}'s file: {err}"))
    }

    /// The first file the rule behind input `name` made (its done task's first output), as a file to read.
    fn made_file(&self, name: &str) -> Result<File, String> {
        let t = self.input(name)?;
        let out = t["record"]["outputs"].as_array().and_then(|o| o.first()).and_then(Value::as_str).ok_or_else(|| format!("its {name} made no file"))?;
        let e = self.entries.get(out).ok_or_else(|| format!("its {name}'s file is not on this Mac"))?;
        File::of(e["files"].as_array().and_then(|f| f.first()).ok_or_else(|| format!("its {name} brings no bytes"))?)
    }

    /// The bytes entry input `name` brings, as a file to read.
    fn file(&self, name: &str) -> Result<File, String> {
        File::of(self.input(name)?["files"].as_array().and_then(|f| f.first()).ok_or_else(|| format!("its {name} brings no bytes"))?)
    }

    /// Param `name`, as the task pinned it.
    fn param(&self, name: &str) -> Value {
        match &self.task["params"] {
            Value::String(text) => serde_json::from_str::<Value>(text).unwrap_or_default()[name].clone(),
            params => params[name].clone(),
        }
    }

    fn stage(&self, stage: &str, done: f64) {
        crate::jobs::stage(self.kind, &self.subject, stage, done);
    }

    /// Puts the file at `path` into the task's vault as `name`, a `media` file tagged `tags`, read back and compared;
    /// then removes it from the disk: the new entry.
    async fn put(&self, path: &Path, name: &str, media: &str, tags: &[&str]) -> Result<String, String> {
        Ok(self.put_file(path, name, media, tags).await?.0)
    }

    /// The same: the new entry, and its file.
    async fn put_file(&self, path: &Path, name: &str, media: &str, tags: &[&str]) -> Result<(String, File), String> {
        let len = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?.len();
        let op = json!({ "op": "put_file", "vault": self.vault()?, "name": name, "media": media, "tags": tags, "as": self.actor });
        let put = put_path(self.app, op, path, |_| {}).await;
        std::fs::remove_file(path).ok();
        let put = put?;
        let entry = put["entry"].as_str().map(str::to_string).ok_or("the device named no entry")?;
        let file = File { root: put["root"].as_str().ok_or("the device named no root")?.to_string(), size: put["size"].as_u64().unwrap_or(0), len };
        Ok((entry, file))
    }

    /// The task's vault.
    fn vault(&self) -> Result<&str, String> {
        self.task["vault"].as_str().or(self.task["record"]["vault"].as_str()).ok_or_else(|| "the task names no vault".into())
    }

    /// How far, as a teller the render takes (render.rs `Told`): its stage in the Mac's jobs, up to `upto` of the whole.
    fn told(&self, upto: f64) -> crate::render::Told {
        let (kind, subject) = (self.kind, self.subject.clone());
        Arc::new(move |x, what| crate::jobs::stage(kind, &subject, what, x * upto))
    }

    /// The files older done tasks of the task's vault made that what this one made replaces (`same`, on a task's
    /// record and its value): deleted (avenDB's deleted tag, so they can come back), so that a file has one grading
    /// still, one preview, never a history of them. One that can't be deleted now stays: it costs room, not truth.
    async fn retire(&self, same: impl Fn(&Value, &Value) -> bool) {
        let Ok(world) = world(self.app).await else { return };
        let entries = world["entries"].as_array().cloned().unwrap_or_default();
        let gone = |id: &Value| entries.iter().any(|e| &e["entry"] == id && (e["deleted"] == json!(true) || e["tags"].as_array().is_some_and(|t| t.contains(&json!(DELETED)))));
        let vault = self.vault().unwrap_or_default();
        for e in &entries {
            let r = &e["record"];
            if e["type"] != "task" || e["vault"] != vault || r["status"] != "done" || e["entry"] == self.task["entry"] || e["deleted"] == json!(true) {
                continue;
            }
            let value = serde_json::from_str::<Value>(r["result"].as_str().unwrap_or("null")).unwrap_or_default();
            if !same(r, &value) {
                continue;
            }
            for out in r["outputs"].as_array().into_iter().flatten().filter(|o| !gone(o)) {
                let op = json!({ "op": "insert", "entry": out, "path": ["tags"], "value": DELETED, "as": self.actor });
                if let Err(e) = run(self.app, op).await {
                    tracing::warn!("a replaced file stays: {e}");
                }
            }
        }
    }
}

/// What became of one legacy vault file brought over (`studio_import`): its new entry, the entries of the values it
/// brought beside it (`transcript`, `analysis`), or why not.
#[derive(serde::Serialize)]
pub struct Imported {
    hash: String,
    entry: Option<String>,
    made: serde_json::Map<String, Value>,
    error: Option<String>,
}

/// Brings the legacy vault's files `hashes` into vault `vault` (plan JI: by hand only, never by itself), acting as
/// `actor`: each read in place from the legacy vault and put as an original, tagged `media:original` and
/// `legacy:<hash>`, its bytes read back and their BLAKE3 compared with the legacy hash (the BLAKE3 of the same bytes);
/// its legacy transcript and analysis put beside it as the JSON files a task keeps a long value in
/// (`<stem>.transcript.json`, tagged `media:transcript` and `legacy:<hash>`), which the rules take as they are instead
/// of hearing and watching it again (src/lib/studio/jobs/executors.js). A file brought before (an original tagged
/// `legacy:<hash>`) is not brought again. It copies, never moves: the legacy vault is left as it is.
#[tauri::command]
pub async fn studio_import(app: AppHandle, vault: String, hashes: Vec<String>, actor: Option<String>) -> Result<Vec<Imported>, String> {
    use tauri::Manager as _;
    use crate::jobs::Kind;
    let legacy = app.state::<crate::App>().vault.clone();
    let world = world(&app).await?;
    let entries = world["entries"].as_array().cloned().unwrap_or_default();
    let tagged = |e: &Value, t: &str| e["tags"].as_array().is_some_and(|ts| ts.iter().any(|x| x == t));
    let mut out = vec![];
    for hash in hashes {
        let hash = hash.to_lowercase();
        let mark = format!("legacy:{hash}");
        let mut made = serde_json::Map::new();
        if let Some(e) = entries.iter().find(|e| e["vault"] == vault.as_str() && e["deleted"] != json!(true) && tagged(e, &mark) && tagged(e, "media:original")) {
            out.push(Imported { hash, entry: e["entry"].as_str().map(str::to_string), made, error: None });
            continue;
        }
        let brought = async {
            let h: iroh_blobs::Hash = hash.parse().map_err(|e| format!("{hash} is no vault hash: {e}"))?;
            let m = legacy.catalog.meta(h).await.map_err(|e| e.to_string())?.ok_or("it is not in the legacy vault's catalog")?;
            let name = [&m.original_name, &m.title].into_iter().find(|n| !n.is_empty()).cloned().unwrap_or_else(|| format!("{}.bin", &hash[..12]));
            let src = crate::blob::source(&legacy, h, &name).await.map_err(|e| format!("{e:#}"))?;
            let subject = format!("aven:legacy:{hash}");
            crate::jobs::queue(Kind::Ingest, &subject, &name);
            let total = 3 * src.reader().and_then(|mut r| r.len()).unwrap_or(1).max(1);
            let (app2, h2, s2) = (app.clone(), hash.clone(), subject.clone());
            let told = move |moved: u64| {
                crate::jobs::stage(Kind::Ingest, &s2, "bringing it into avenDB", moved as f64 / total as f64);
                app2.emit("studio-import", json!({ "hash": h2, "done": moved, "len": total })).ok();
            };
            let mut op = json!({ "op": "put_file", "vault": vault, "name": name, "media": m.mime, "tags": ["media:original", mark] });
            if let Some(actor) = &actor {
                op["as"] = json!(actor);
            }
            let put = put_source(&app, op, &src, told).await;
            crate::jobs::end(Kind::Ingest, &subject, put.as_ref().map(|_| ()).map_err(Clone::clone));
            let put = put?;
            let entry = put["entry"].as_str().ok_or("the device named no entry")?.to_string();
            if put["blake3"].as_str() != Some(hash.as_str()) {
                let op = json!({ "op": "insert", "entry": entry, "path": ["tags"], "value": DELETED, "as": actor.clone().unwrap_or_else(|| vault.clone()) });
                run(&app, op).await.ok();
                return Err(format!("its copy's BLAKE3 is {}, not its legacy hash: not counted", put["blake3"]));
            }
            // its words and its analysis beside it, as the rules keep a long value
            for k in ["transcript", "analysis"] {
                let Some(v) = m.meta.get(k).filter(|v| v.is_object()) else { continue };
                let file = format!("{}.{k}.json", stem(&name));
                let path = work(&format!("legacy-{hash}"))?.join(&file);
                std::fs::write(&path, v.to_string()).map_err(|e| format!("{}: {e}", path.display()))?;
                let mut op = json!({ "op": "put_file", "vault": vault, "name": file, "media": "application/json", "tags": [format!("media:{k}"), mark] });
                if let Some(actor) = &actor {
                    op["as"] = json!(actor);
                }
                let put = put_path(&app, op, &path, |_| {}).await;
                std::fs::remove_file(&path).ok();
                made.insert(k.to_string(), put?["entry"].clone());
            }
            Ok::<_, String>(entry)
        }
        .await;
        std::fs::remove_dir_all(std::env::temp_dir().join("maiacity-jobs").join(format!("legacy-{hash}"))).ok();
        match brought {
            Ok(entry) => out.push(Imported { hash, entry: Some(entry), made, error: None }),
            Err(e) => out.push(Imported { hash, entry: None, made, error: Some(e) }),
        }
    }
    Ok(out)
}

/// A folder of its own on this Mac for what task `id` makes, before it goes into avenDB.
fn work(id: &str) -> Result<std::path::PathBuf, String> {
    let dir = std::env::temp_dir().join("maiacity-jobs").join(id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir)
}

/// A file name's stem.
fn stem(name: &str) -> String {
    Path::new(name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into())
}

/// Does task `task` of a rule the page's worker claimed (src/lib/studio/jobs/executors.js `NATIVE`), with `entries`
/// what it reads (`Job`), acting as `actor`: what it made, `{outputs, result}`, as the worker writes it back. It holds
/// its rule's lane in the Mac's jobs while it runs, so the Processes tab shows it.
#[tauri::command]
pub async fn studio_job(app: AppHandle, task: Value, entries: serde_json::Map<String, Value>, library: Option<Vec<Value>>, actor: String) -> Result<Value, String> {
    use crate::jobs::Kind;
    let rule = task["rule"].as_str().unwrap_or_default().to_string();
    let id = task["entry"].as_str().unwrap_or_default().to_string();
    let first = task["inputs"][0]["entry"].as_str().and_then(|e| entries.get(e));
    let name = first.and_then(|e| e["title"].as_str().or(e["record"]["title"].as_str()).or(e["record"]["name"].as_str())).unwrap_or("a file").to_string();
    let kind = match rule.as_str() {
        "probe" => Kind::Sound,
        "proxy" => Kind::Proxy,
        "still" => Kind::Still,
        "transcript" => Kind::Transcript,
        "analysis" => Kind::Analysis,
        "render" => Kind::Render,
        "frame" => Kind::Frame,
        "world-proxy" => Kind::WorldProxy,
        other => return Err(format!("no Rust executor for rule {other}")),
    };
    let library = library.unwrap_or_default();
    let job = Job { app: &app, task: &task, entries: &entries, library: &library, actor: &actor, kind, subject: format!("aven:{id}") };
    crate::jobs::queue(kind, &job.subject, &name);
    let turn = crate::jobs::turn(kind, &job.subject).await.map_err(|_| "cancelled".to_string())?;
    job.stage("starting", 0.0);
    let made = match rule.as_str() {
        "probe" => probe(&job, &name).await,
        "proxy" => proxy(&job, &id, &name).await,
        "still" => still(&job, &id, &name).await,
        "transcript" => transcript(&job, &name).await,
        "analysis" => analysis(&job, &name).await,
        "render" => render(&job, &id).await,
        "frame" => frame(&job, &id).await,
        "world-proxy" => world_proxy(&job, &id).await,
        _ => unreachable!(),
    };
    let made = match made {
        Ok(made) => spill(&job, &id, &rule, &name, made).await,
        Err(e) => Err(e),
    };
    drop(turn);
    std::fs::remove_dir_all(std::env::temp_dir().join("maiacity-jobs").join(&id)).ok();
    crate::jobs::end(kind, &job.subject, made.as_ref().map(|_| ()).map_err(Clone::clone));
    made
}

/// A cut of avenDB (src/lib/studio/cuts.js) as the render reads a timeline: its record's fields, and the rest of it
/// from its JSON text, named `cut:<entry>` as the studio names it.
fn cut_of(e: &Value) -> Result<vault_render::timeline::Timeline, String> {
    let r = &e["record"];
    let mut t: Value = serde_json::from_str(r["timeline"].as_str().unwrap_or("{}")).map_err(|err| format!("the cut's timeline: {err}"))?;
    if !t.is_object() {
        t = json!({});
    }
    t["id"] = json!(format!("cut:{}", e["entry"].as_str().unwrap_or_default()));
    t["name"] = r["name"].as_str().map_or(json!("A cut"), |n| json!(n));
    let text = |k: &str| r[k].as_str().filter(|s| !s.is_empty()).map_or(Value::Null, |s| json!(s));
    t["project"] = text("project");
    t["variant"] = text("variant");
    t["version"] = r["version"].as_u64().map_or(json!(1), |v| json!(v));
    serde_json::from_value(t).map_err(|err| format!("the cut's timeline: {err}"))
}

/// The `render` rule (plan J12): a cut into every delivery, or with param `delivery` "youtube-4k" YouTube's 4K master
/// alone, levelled (render.rs `render_cut`), each put into the cut's vault tagged `media:delivery`; its value the
/// report the API's job carried (`Render::job_result`), every delivery named by its avenDB reference (`media_ref`).
async fn render(job: &Job<'_>, id: &str) -> Result<Value, String> {
    let t = cut_of(job.input("cut")?)?;
    let delivery = job.param("delivery");
    let dir = work(id)?;
    let mut made = crate::render::render_cut(job.app, &t, job.library, delivery.as_str(), dir.join("out"), job.told(0.94)).await?;
    let mut outputs = Vec::new();
    let n = made.deliveries.len();
    for i in 0..n {
        let (about, file) = {
            let d = &made.deliveries[i];
            (made.about(&t, d), d.file.clone())
        };
        job.stage("into avenDB", 0.94 + 0.06 * i as f64 / n as f64);
        let (entry, f) = job.put_file(&file, &about.name, "video/mp4", &["media:delivery"]).await?;
        made.deliveries[i].hash = Some(media_ref(&f, "video/mp4"));
        outputs.push(entry);
    }
    for w in &made.warnings {
        tracing::warn!("render of {}: {w}", t.id);
    }
    let result = made.job_result(&t).map_err(|e| format!("{e:#}"))?;
    Ok(json!({ "outputs": outputs, "result": result }))
}

/// The `frame` rule (plan J13), of a cut: of a media clip (param `clip`, or the one on screen at `t`) its file's graded
/// still, 1920×1080, put tagged `media:preview` as the file's preview, the one before it deleted; of a world clip or a
/// gap a hero frame at `t` in shape `shape`, tagged `media:frame`, the one before of the same clip and shape deleted.
async fn frame(job: &Job<'_>, id: &str) -> Result<Value, String> {
    use crate::render::Framed;
    let t = cut_of(job.input("cut")?)?;
    let clip = job.param("clip");
    let at = job.param("t").as_f64().filter(|t| *t >= 0.0).unwrap_or(0.0);
    let shape = job.param("shape").as_str().unwrap_or("16:9").to_string();
    let dir = work(id)?;
    match crate::render::frame_cut(job.app, &t, job.library, clip.as_str(), at, &shape, &dir, job.told(0.9)).await? {
        Framed::Graded { file, rep, clip } => {
            let of = rep["of"].as_str().unwrap_or_default().to_string();
            let title = job.library.iter().find(|m| m["hash"] == of.as_str()).and_then(|m| m["title"].as_str()).unwrap_or("a file").to_string();
            job.stage("into avenDB", 0.9);
            let entry = job.put(&file, &format!("{}.preview.jpg", stem(&title)), "image/jpeg", &["media:preview"]).await?;
            job.retire(|r, v| r["rule"] == "frame" && v["kind"] == "graded" && v["of"] == of.as_str()).await;
            let result = json!({ "kind": "graded", "of": of, "cut": t.id, "clip": clip, "t": rep["t"], "width": rep["width"], "height": rep["height"] });
            Ok(json!({ "outputs": [entry], "result": result }))
        }
        Framed::Hero { file, rep, at, aspect, width, height } => {
            job.stage("into avenDB", 0.9);
            let name = format!("{} · hero frame {at:.2} s · {aspect}.png", t.name);
            let entry = job.put(&file, &name, "image/png", &["media:frame"]).await?;
            let (cut, shown) = (t.id.clone(), rep["clip"].clone());
            job.retire(|r, v| r["rule"] == "frame" && v["kind"] == "hero" && v["cut"] == cut.as_str() && v["clip"] == shown && v["shape"] == aspect.as_str()).await;
            let result = json!({ "kind": "hero", "cut": t.id, "clip": rep["clip"], "t": at, "shape": aspect, "width": width, "height": height, "what": rep["what"] });
            Ok(json!({ "outputs": [entry], "result": result }))
        }
    }
}

/// The `world-proxy` rule (plan J10): a world shot version's HD proxy in ACEScct, rendered in the unseen world
/// (world.rs `proxy_into`), put tagged `media:proxy`; its value names the shot (`shot:<entry>`) and its version, as
/// the studio finds a world clip's proxy by them.
async fn world_proxy(job: &Job<'_>, id: &str) -> Result<Value, String> {
    let e = job.input("shot")?;
    let r = &e["record"];
    let version = r["version"].as_u64().ok_or("the shot version has no number")?;
    // the first version is the shot itself; every later one names it
    let shot = r["shot"].as_str().filter(|s| !s.is_empty()).or(e["entry"].as_str()).unwrap_or_default().to_string();
    let spec: Value = serde_json::from_str(r["spec"].as_str().unwrap_or("null")).map_err(|err| format!("the shot's spec: {err}"))?;
    let name = r["name"].as_str().unwrap_or("a world shot").to_string();
    let out = work(id)?.join(format!("{}-v{version}.world.mp4", &shot[..12.min(shot.len())]));
    let (kind, subject) = (job.kind, job.subject.clone());
    job.stage("opening the world", 0.0);
    let made = {
        let _awake = crate::world::Awake::begin("rendering a world shot's proxy");
        crate::world::proxy_into(job.app, &format!("{}-v{version}", &shot[..12.min(shot.len())]), &spec, &out, move |d| crate::jobs::stage(kind, &subject, "making", d)).await
    };
    crate::world::close_if_idle(job.app);
    let (proxy, info, shape, fps) = made?;
    job.stage("into avenDB", 1.0);
    let entry = job.put(&out, &format!("{name} · v{version} · world proxy.mp4"), "video/mp4", &["media:proxy"]).await?;
    let result = json!({ "shot": format!("shot:{shot}"), "shotVersion": version, "shape": shape, "width": proxy.width, "height": proxy.height,
        "fps": fps, "seconds": (proxy.seconds * 1000.0).round() / 1000.0, "world": info });
    Ok(json!({ "outputs": [entry], "result": result }))
}

/// How long a value may be and still go on its task: a longer one (a long recording's words, an analysis) goes into a
/// file of its own, so that the device's world, read by every page, stays small.
const SPILL: usize = 16 * 1024;

/// What a task made, its value put into a JSON file of its own (`<stem>.<rule>.json`, tagged `media:<rule>`) when it
/// is longer than `SPILL`: that file among its outputs, and as its value `{file, state, hero}`, the file's entry and
/// the few fields the lists show.
async fn spill(job: &Job<'_>, id: &str, rule: &str, name: &str, mut made: Value) -> Result<Value, String> {
    let text = made["result"].to_string();
    if text.len() <= SPILL {
        return Ok(made);
    }
    let file = format!("{}.{rule}.json", stem(name));
    let path = work(id)?.join(&file);
    std::fs::write(&path, &text).map_err(|e| format!("{}: {e}", path.display()))?;
    let entry = job.put(&path, &file, "application/json", &[&format!("media:{rule}")]).await?;
    let mut outputs = made["outputs"].as_array().cloned().unwrap_or_default();
    outputs.push(json!(entry));
    let r = &made["result"];
    let mut small = json!({ "file": entry });
    for k in ["state", "hero", "language", "seconds", "status", "note", "output_hash"] {
        if !r[k].is_null() {
            small[k] = r[k].clone();
        }
    }
    // a render's deliveries, without their QC and loudness (in its file)
    if let Some(ds) = r["deliveries"].as_array() {
        let keep = ["hash", "mime", "aspect", "codec", "kind", "channels", "format", "width", "height", "bytes", "seconds"];
        small["deliveries"] = ds.iter().map(|d| keep.iter().filter(|k| !d[**k].is_null()).map(|k| (k.to_string(), d[*k].clone())).collect::<serde_json::Map<_, _>>().into()).collect::<Vec<Value>>().into();
    }
    made["outputs"] = json!(outputs);
    made["result"] = small;
    Ok(made)
}

/// The `probe` rule (plan J2): what the original is, from its own bytes: its sound record (sound track, length,
/// picture rate, start timecode) and, for a movie, its picture (codec, size, fps, bits, colour tags) and journey (the
/// colour profile it was shot in, `vault_media::detect`).
async fn probe(job: &Job<'_>, name: &str) -> Result<Value, String> {
    let e = job.input("original")?;
    let src = source(job.app, job.file("original")?, name);
    let movie = e["media"].as_str().or(e["record"]["media"].as_str()).unwrap_or_default().starts_with("video/");
    let at = vault_core::ingest::now_iso();
    job.stage("reading it", 0.0);
    tauri::async_runtime::spawn_blocking(move || {
        objc2::rc::autoreleasepool(|_| -> Result<Value, String> {
            let sound = vault_media::probe::sound(src.clone()).map_err(|e| format!("{e:#}"))?;
            let mut result = json!({
                "audio": sound.audio,
                "seconds": sound.seconds,
                "fps": sound.fps,
                "timecode": sound.timecode.as_ref().map(|t| &t.0),
                "timecode_fps": sound.timecode.as_ref().map(|t| t.1),
                "at": at,
            });
            if movie {
                let p = vault_media::probe(src).map_err(|e| format!("{e:#}"))?;
                result["journey"] = json!(vault_media::detect(&p));
                result["picture"] = json!(p);
            }
            Ok(json!({ "outputs": [], "result": result }))
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The colour profile a movie was shot in, from its probe (the `probe.journey` param), if a journey into ACEScct
/// takes it; else why it waits.
fn profile_of(job: &Job<'_>) -> Result<String, String> {
    let profile = job.param("probe.journey")["profile"].as_str().unwrap_or("unknown").to_string();
    if profile == "unknown" {
        return Err("its colour can't be told from the file".into());
    }
    if !crate::proxies::journey(&profile) {
        return Err(format!("no colour journey from {profile} into ACEScct yet"));
    }
    Ok(profile)
}

/// The `proxy` rule (plan J3): an HD proxy in ACEScct (HEVC Main10) through the original's journey, put into its vault
/// tagged `media:proxy`; the journey it went through as its value.
async fn proxy(job: &Job<'_>, id: &str, name: &str) -> Result<Value, String> {
    let profile = profile_of(job)?;
    let src = source(job.app, job.file("original")?, name);
    let out = work(id)?.join(format!("{}.proxy.mp4", stem(name)));
    let (o, pf, subject, kind) = (out.clone(), profile.clone(), job.subject.clone(), job.kind);
    job.stage("making", 0.0);
    tauri::async_runtime::spawn_blocking(move || {
        objc2::rc::autoreleasepool(|_| {
            let mut told = |done: f64| crate::jobs::stage(kind, &subject, "making", done);
            vault_media::make_proxy(src, &o, &pf, &mut told).map(|_| ()).map_err(|e| format!("{e:#}"))
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    job.stage("bringing it into avenDB", 1.0);
    let entry = job.put(&out, &format!("{}.proxy.mp4", stem(name)), "video/mp4", &["media:proxy"]).await?;
    Ok(json!({ "outputs": [entry], "result": { "profile": profile, "journey": crate::proxies::journey_record(&profile) } }))
}

/// The `still` rule (plan J4): the original's grading still at the hero frame its analysis picked, else its middle: a
/// 4K 16-bit PNG of ACEScct code values (`media:still`) and its preview through ACES 2.0 to Rec.709 (`media:preview`).
async fn still(job: &Job<'_>, id: &str, name: &str) -> Result<Value, String> {
    let profile = profile_of(job)?;
    let seconds = job.value("probe")?["seconds"].as_f64().unwrap_or(1.0);
    let hero = job.param("analysis.hero.t").as_f64();
    let at = hero.unwrap_or(seconds / 2.0).clamp(0.0, seconds.max(0.0));
    let src = source(job.app, job.file("original")?, name);
    let dir = work(id)?;
    let (png, jpg) = (dir.join(format!("{}.grade.png", stem(name))), dir.join(format!("{}.preview.jpg", stem(name))));
    let (p, j, pf) = (png.clone(), jpg.clone(), profile.clone());
    job.stage("making", 0.0);
    let (w, h) = tauri::async_runtime::spawn_blocking(move || {
        objc2::rc::autoreleasepool(|_| {
            let preview = (&*j, crate::proxies::PREVIEW_WIDTH, crate::render::odt() as &dyn vault_render::Output);
            vault_render::grading_still_and_preview(src, &pf, at, crate::proxies::STILL_WIDTH, &p, Some(preview)).map_err(|e| format!("{e:#}"))
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    job.stage("bringing it into avenDB", 1.0);
    let still = job.put(&png, &format!("{}.grade.png", stem(name)), "image/png", &["media:still"]).await?;
    let preview = job.put(&jpg, &format!("{}.preview.jpg", stem(name)), "image/jpeg", &["media:preview"]).await?;
    // one grading still and preview per original: those of the moment before go
    let original = job.task["inputs"][0]["entry"].clone();
    job.retire(|r, _| r["rule"] == "still" && r["inputs"][0]["entry"] == original).await;
    let result = json!({ "t": (at * 1000.0).round() / 1000.0, "marked": hero.is_some(), "width": w, "height": h,
        "still": crate::proxies::STILL, "journey": crate::proxies::journey_record(&profile), "encoding": "16-bit PNG, ACEScct code values" });
    Ok(json!({ "outputs": [still, preview], "result": result }))
}

/// The `transcript` rule (plan J5): the original's words with their times, heard on this Mac by the speech model
/// (vault-asr, the model the legacy vault keeps); none where it has no sound track or no speech. Its value is the
/// transcript as the legacy studio records it (`words`, `utterances`, `language`, `model`, `seconds`, `state`).
async fn transcript(job: &Job<'_>, name: &str) -> Result<Value, String> {
    use tauri::Manager as _;
    let vault = job.app.state::<crate::App>().vault.clone();
    let (subject, kind) = (job.subject.clone(), job.kind);
    let tell = move |stage: &str, done: f64| crate::jobs::stage(kind, &subject, stage, done);
    tell("the speech model", 0.0);
    let models = if crate::transcripts::RECOGNIZER.lock().unwrap_or_else(|p| p.into_inner()).is_none() {
        let told = tell.clone();
        Some(crate::models::ready(&vault, &mut move |stage, done| told(stage, done)).await?)
    } else {
        None
    };
    let src = source(job.app, job.file("original")?, name);
    let t2 = tell.clone();
    let samples = tauri::async_runtime::spawn_blocking(move || {
        objc2::rc::autoreleasepool(|_| vault_media::audio::decode_mono(src, vault_asr::RATE as u32, &mut |d| t2("reading the sound", d)))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))?;
    let at = vault_core::ingest::now_iso();
    let Some(samples) = samples else {
        return Ok(json!({ "outputs": [], "result": { "state": "none: no sound track", "model": vault_asr::MODEL, "at": at } }));
    };
    let seconds = samples.len() as f64 / vault_asr::RATE as f64;
    let t3 = tell.clone();
    let mut record = tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let mut slot = crate::transcripts::RECOGNIZER.lock().unwrap_or_else(|p| p.into_inner());
        if slot.is_none() {
            t3("loading the speech model", 0.0);
            let models = models.as_ref().ok_or("the speech model was let go of while this recording waited: again")?;
            *slot = Some(vault_asr::Recognizer::open_bytes(models).map_err(|e| format!("{e:#}"))?);
        }
        slot.as_mut().expect("loaded").transcribe(&samples, &mut |stage, d| t3(stage, d)).map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    if record["words"].as_array().is_none_or(Vec::is_empty) {
        record = json!({ "state": "none: no speech", "model": vault_asr::MODEL });
    } else {
        record["state"] = json!("done");
    }
    record["at"] = json!(at);
    record["seconds"] = json!((seconds * 1000.0).round() / 1000.0);
    Ok(json!({ "outputs": [], "result": record }))
}

/// The `analysis` rule (plan J6): the original's tags, cues, takes, summary and hero frame, by Prem's Qwen through our
/// API (the app's own key; no model key on a Mac), from frames of its proxy and the words of its transcript; as the
/// legacy studio analyses (analyse/mod.rs `analyse`, whose record shape its value keeps), without the legacy catalog.
/// A pause or a model not set up fails it with why; it is tried again on the next lease, up to the rule's tries.
async fn analysis(job: &Job<'_>, name: &str) -> Result<Value, String> {
    use crate::analyse::{frames, plan, prem::prem};
    use tauri::Manager as _;
    let auth = job.app.state::<crate::auth::Auth>();
    let file = source(job.app, job.made_file("proxy")?, "proxy.mp4");
    let transcript = job.full_value("transcript").await.ok().filter(|t| t["state"] == "done");
    let transcript = transcript.as_ref();
    let original = job.input("original")?;
    let (subject, kind) = (job.subject.clone(), job.kind);
    let tell = move |stage: &str, done: f64| crate::jobs::stage(kind, &subject, stage, done);
    tell("sampling frames", 0.0);
    let f = file.clone();
    let probed = tauri::async_runtime::spawn_blocking(move || objc2::rc::autoreleasepool(|_| vault_media::probe(f)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))?;
    let seconds = probed.seconds;
    let (f, t) = (file.clone(), tell.clone());
    let sampled = tauri::async_runtime::spawn_blocking(move || {
        objc2::rc::autoreleasepool(|_| frames::sample(f, seconds, plan::interval(seconds), plan::EDGE, true, &mut |d| t("sampling frames", d)))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))?;
    let keep = plan::thin(sampled.times.len(), (plan::MAX_FRAMES * 1.5) as usize);
    let times: Vec<f64> = keep.iter().map(|&i| sampled.times[i]).collect();
    let mut all = sampled.jpegs;
    let jpegs: Vec<Vec<u8>> = keep.iter().map(|&i| std::mem::take(&mut all[i])).collect();
    let info = json!({ "name": name, "title": original["title"], "kind": "video", "seconds": seconds,
                       "description": "", "tags": original["tags"] });
    let parts = plan::stretches(&times, seconds);
    let steps = parts.len() + 1;
    let (mut answers, mut picks): (Vec<(f64, f64, Value)>, Vec<(f64, String)>) = (vec![], vec![]);
    let (mut model, mut vocabulary) = (Value::Null, Value::Null);
    for (n, (i, j, a, b)) in parts.iter().enumerate() {
        tell("asking Qwen", n as f64 / steps as f64);
        let frames: Vec<(f64, String)> = (*i..*j).map(|k| ((times[k] * 1000.0).round() / 1000.0, plan::base64(&jpegs[k]))).collect();
        let words = plan::words_in(transcript, *a, *b);
        let before = answers.last().map(|(_, _, p)| p["summary"].clone()).unwrap_or(Value::Null);
        let st = crate::analyse::prem::Stretch { file: &info, s: *a, e: *b, index: n, of: parts.len(), frames: &frames, words: &words, before: &before };
        let answer = prem().frames(&auth, &st).await.map_err(|e| e.to_string())?;
        if model.is_null() {
            model = answer["model"].clone();
            vocabulary = answer["vocabulary"].clone();
        }
        if let Some(idx) = answer["thumbnail"]["index"].as_u64().map(|x| x as usize).filter(|x| i + x < *j) {
            picks.push((times[i + idx], answer["thumbnail"]["why"].as_str().unwrap_or("").to_string()));
        }
        answers.push((*a, *b, answer));
    }
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
    // a failed reduce keeps the stretches' work: only the takes are not grouped across them
    let reduce = prem().reduce(&auth, &info, &json!(stretches), &said).await.ok();
    let mut record = plan::finish(merged, reduce.as_ref());
    let cues = record["cues"].as_array().cloned().unwrap_or_default();
    let t = plan::thumbnail_time(reduce.as_ref(), &picks, &cues, &times, seconds);
    let why = reduce
        .as_ref()
        .and_then(|r| r["thumbnail"]["why"].as_str())
        .map(String::from)
        .or_else(|| picks.iter().find(|(p, _)| (p - t).abs() < 1e-6).map(|(_, w)| w.clone()))
        .unwrap_or_default();
    if let Some(o) = record.as_object_mut() {
        o.remove("thumbnail");
        o.insert("hero".into(), json!({ "t": (t * 1000.0).round() / 1000.0, "why": why }));
        o.insert("state".into(), json!("done"));
        o.insert("version".into(), json!(plan::VERSION));
        o.insert("model".into(), model);
        o.insert("vocabulary".into(), vocabulary);
        o.insert("at".into(), json!(vault_core::ingest::now_iso()));
        o.insert("seconds".into(), json!((seconds * 1000.0).round() / 1000.0));
        o.insert("frames".into(), json!(times.len()));
    }
    Ok(json!({ "outputs": [], "result": record }))
}

/// `aven://localhost/<root>?size=<sealed size>&len=<length>&media=<type>`: an avenDB file's plain bytes for the page's
/// `<video>` and `<img>` (the studio's library, monitors and thumbnails), with Range, read through the device as the
/// player reads them; at most 8 MiB a response, the page asks for the next.
pub async fn serve(app: AppHandle, request: tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{Response, StatusCode, header};
    let reply = |status: StatusCode, body: &str| Response::builder().status(status).body(body.as_bytes().to_vec()).unwrap_or_default();
    let uri = request.uri();
    let root = uri.path().trim_start_matches('/').split(['.', '/']).next().unwrap_or("").to_string();
    let query: std::collections::HashMap<String, String> = uri
        .query()
        .unwrap_or("")
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.replace("%2F", "/").replace("%2f", "/")))
        .collect();
    let num = |k: &str| query.get(k).and_then(|v| v.parse::<u64>().ok());
    let (Some(size), Some(len)) = (num("size"), num("len")) else { return reply(StatusCode::BAD_REQUEST, "size and len, please") };
    if root.len() != 64 || !root.bytes().all(|b| b.is_ascii_hexdigit()) {
        return reply(StatusCode::BAD_REQUEST, "not a root");
    }
    let media = query.get("media").cloned().unwrap_or_else(|| "application/octet-stream".into());
    const MAX: u64 = 8 * 1024 * 1024;
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("bytes="))
        .and_then(|v| {
            let (a, b) = v.split_once('-')?;
            let start: u64 = if a.is_empty() { len.saturating_sub(b.parse().ok()?) } else { a.parse().ok()? };
            let end: u64 = if a.is_empty() || b.is_empty() { len.saturating_sub(1) } else { b.parse().ok()? };
            Some((start, end.min(len.saturating_sub(1))))
        });
    let (start, end, partial) = match range {
        Some((s, e)) if s <= e && s < len => (s, e.min(s + MAX - 1), true),
        Some(_) => {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                .body(Vec::new())
                .unwrap_or_default();
        }
        // a whole file in one answer only while it is small (a still, a preview): a movie is asked for by range
        None => (0, len.saturating_sub(1).min(64 * MAX - 1), false),
    };
    let body = if len == 0 {
        vec![]
    } else {
        match read(&app, &File { root, size, len }, start, end + 1).await {
            Ok(b) => b,
            Err(e) => return reply(StatusCode::NOT_FOUND, &e),
        }
    };
    let mut res = Response::builder()
        .status(if partial { StatusCode::PARTIAL_CONTENT } else { StatusCode::OK })
        .header(header::CONTENT_TYPE, media)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, body.len().to_string())
        .header(header::CACHE_CONTROL, "private, max-age=31536000, immutable")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    if partial {
        res = res.header(header::CONTENT_RANGE, format!("bytes {start}-{}/{len}", (start + body.len() as u64).saturating_sub(1)));
    }
    res.body(body).unwrap_or_default()
}
