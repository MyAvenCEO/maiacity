//! The opfs driver's folder: the origin's private file system through sync access handles, which exist in a dedicated
//! worker in every engine (store/README.md, "What the store asks of the opfs driver"). A write opens its file, writes
//! and closes; closing persists it (the File System Standard's `close()` flushes), and only then does it move, so a
//! separate `flush()` (40% of a small write in Chromium) adds nothing. Reads of blobs keep up to 16 handles open, the least recently used closed first: a movie seeks in
//! one chunk many times. The worker is the one writer under the Web Lock, so no other handle on these files exists.

use std::cell::RefCell;
use std::ops::Range;

use bytes::Bytes;
use js_sys::{Function, Promise, Reflect, Uint8Array};
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::{
    DomException, FileSystemDirectoryHandle, FileSystemFileHandle, FileSystemGetDirectoryOptions,
    FileSystemGetFileOptions, FileSystemReadWriteOptions, FileSystemSyncAccessHandle, WorkerGlobalScope,
};

use crate::folder::Folder;
use crate::{Error, Result};

/// How many blob handles stay open for reading.
const OPEN: usize = 16;
/// How long a handle another worker still holds is waited for, a takeover's old leader closing (2 s).
const WAIT_MS: i32 = 2000;

pub struct OpfsFolder {
    dirs: Vec<(&'static str, FileSystemDirectoryHandle)>,
    /// Open read handles of blobs, the most recently used last.
    open: RefCell<Vec<(String, FileSystemSyncAccessHandle)>>,
}

fn backend(e: JsValue) -> Error {
    match e.dyn_ref::<DomException>() {
        Some(d) if d.name() == "QuotaExceededError" => Error::Backend(format!("OPFS is full: {}", d.message())),
        Some(d) => Error::Backend(format!("OPFS {}: {}", d.name(), d.message())),
        None => Error::Backend(format!("OPFS: {e:?}")),
    }
}

fn named(e: &JsValue, name: &str) -> bool {
    e.dyn_ref::<DomException>().is_some_and(|d| d.name() == name)
}

async fn wait(p: Promise) -> Result<JsValue> {
    JsFuture::from(p).await.map_err(backend)
}

async fn sleep(ms: i32) {
    let p = Promise::new(&mut |done, _| {
        if let Ok(set) = Reflect::get(&js_sys::global(), &"setTimeout".into()).and_then(|f| f.dyn_into::<Function>()) {
            let _ = set.call2(&JsValue::NULL, &done, &ms.into());
        }
    });
    let _ = JsFuture::from(p).await;
}

/// This origin's private file system, from the worker it runs in.
async fn root() -> Result<FileSystemDirectoryHandle> {
    let scope: WorkerGlobalScope = js_sys::global()
        .dyn_into()
        .map_err(|_| Error::Backend("the opfs driver runs in a dedicated worker only".into()))?;
    Ok(wait(scope.navigator().storage().get_directory()).await?.unchecked_into())
}

async fn subdir(dir: &FileSystemDirectoryHandle, name: &str) -> Result<FileSystemDirectoryHandle> {
    let options = FileSystemGetDirectoryOptions::new();
    options.set_create(true);
    Ok(wait(dir.get_directory_handle_with_options(name, &options)).await?.unchecked_into())
}

impl OpfsFolder {
    /// The folder `root` (such as `/store/`) in this origin's private file system, with its `blobs`, `refs` and `tmp`.
    pub async fn open(root_path: &str) -> Result<Self> {
        let mut dir = root().await?;
        for part in root_path.split('/').filter(|p| !p.is_empty()) {
            dir = subdir(&dir, part).await?;
        }
        let mut dirs = Vec::new();
        for name in ["blobs", "refs", "tmp"] {
            dirs.push((name, subdir(&dir, name).await?));
        }
        Ok(Self { dirs, open: RefCell::new(Vec::new()) })
    }

    /// The directory and the file's name in it, for a path such as `blobs/<hash>`.
    fn split<'p>(&self, path: &'p str) -> Result<(&FileSystemDirectoryHandle, &'p str)> {
        let (dir, name) = path.split_once('/').ok_or_else(|| Error::Backend(format!("no folder in {path}")))?;
        let handle = self
            .dirs
            .iter()
            .find(|(n, _)| *n == dir)
            .map(|(_, h)| h)
            .ok_or_else(|| Error::Backend(format!("no folder {dir}")))?;
        Ok((handle, name))
    }

    async fn file(&self, path: &str, create: bool) -> Result<Option<FileSystemFileHandle>> {
        let (dir, name) = self.split(path)?;
        let options = FileSystemGetFileOptions::new();
        options.set_create(create);
        match JsFuture::from(dir.get_file_handle_with_options(name, &options)).await {
            Ok(h) => Ok(Some(h.unchecked_into())),
            Err(e) if named(&e, "NotFoundError") => Ok(None),
            Err(e) => Err(backend(e)),
        }
    }

    /// A sync access handle on the file, waiting up to 2 s while another worker still holds one.
    async fn handle(file: &FileSystemFileHandle) -> Result<FileSystemSyncAccessHandle> {
        let mut waited = 0;
        loop {
            match JsFuture::from(file.create_sync_access_handle()).await {
                Ok(h) => return Ok(h.unchecked_into()),
                Err(e) if named(&e, "NoModificationAllowedError") && waited < WAIT_MS => {
                    sleep(50).await;
                    waited += 50;
                }
                Err(e) => return Err(backend(e)),
            }
        }
    }

    /// The open read handle of a blob, opening it (and closing the least recently used past 16), or `None`.
    async fn cached(&self, path: &str) -> Result<Option<FileSystemSyncAccessHandle>> {
        {
            let mut open = self.open.borrow_mut();
            if let Some(i) = open.iter().position(|(p, _)| p == path) {
                let entry = open.remove(i);
                let h = entry.1.clone();
                open.push(entry);
                return Ok(Some(h));
            }
        }
        let Some(file) = self.file(path, false).await? else {
            return Ok(None);
        };
        let h = Self::handle(&file).await?;
        let mut open = self.open.borrow_mut();
        open.push((path.into(), h.clone()));
        if open.len() > OPEN {
            open.remove(0).1.close();
        }
        Ok(Some(h))
    }

    fn forget(&self, path: &str) {
        let mut open = self.open.borrow_mut();
        if let Some(i) = open.iter().position(|(p, _)| p == path) {
            open.remove(i).1.close();
        }
    }

    /// Closes every open handle: the leader giving up its lock.
    pub fn close(&self) {
        for (_, h) in self.open.borrow_mut().drain(..) {
            h.close();
        }
    }

    /// The file's contents as the browser's `File`, which takes no lock: refs and temporary files, whose places a
    /// move replaces while a reader may be looking.
    async fn snapshot(&self, path: &str) -> Result<Option<web_sys::File>> {
        let Some(file) = self.file(path, false).await? else {
            return Ok(None);
        };
        match JsFuture::from(file.get_file()).await {
            Ok(f) => Ok(Some(f.unchecked_into())),
            Err(e) if named(&e, "NotFoundError") => Ok(None),
            Err(e) => Err(backend(e)),
        }
    }
}

impl Drop for OpfsFolder {
    /// A folder let go closes its handles, so a store opened after it finds its files free.
    fn drop(&mut self) {
        self.close();
    }
}

fn read_at(h: &FileSystemSyncAccessHandle, range: Option<Range<u64>>) -> Result<Bytes> {
    let len = h.get_size().map_err(backend)? as u64;
    let range = range.unwrap_or(0..len);
    let (start, end) = (range.start.min(len), range.end.min(len));
    let mut buf = vec![0u8; (end - start) as usize];
    let options = FileSystemReadWriteOptions::new();
    let mut done = 0;
    while done < buf.len() {
        options.set_at_f64((start + done as u64) as f64);
        let n = h.read_with_u8_array_and_options(&mut buf[done..], &options).map_err(backend)? as usize;
        if n == 0 {
            return Err(Error::Backend(format!("OPFS read stopped at {done} of {} bytes", buf.len())));
        }
        done += n;
    }
    Ok(Bytes::from(buf))
}

#[async_trait::async_trait(?Send)]
impl Folder for OpfsFolder {
    async fn read(&self, path: &str, range: Option<Range<u64>>) -> Result<Option<Bytes>> {
        if path.starts_with("blobs/") {
            return match self.cached(path).await? {
                Some(h) => read_at(&h, range).map(Some),
                None => Ok(None),
            };
        }
        // A move that replaces the file while it is read makes the snapshot stale: the read is refused
        // (`NotFoundError` in Chromium and WebKit, `AbortError` in Firefox), never torn. Read again, at most 8 times.
        let mut tries = 0;
        let all = loop {
            let Some(file) = self.snapshot(path).await? else {
                return Ok(None);
            };
            match JsFuture::from(file.array_buffer()).await {
                Ok(buf) => break Uint8Array::new(&buf).to_vec(),
                Err(e) if tries < 8 && ["NotFoundError", "NotReadableError", "AbortError"].iter().any(|n| named(&e, n)) => {
                    tries += 1;
                }
                Err(e) => return Err(backend(e)),
            }
        };
        let len = all.len() as u64;
        let r = range.unwrap_or(0..len);
        let (start, end) = (r.start.min(len) as usize, r.end.min(len) as usize);
        Ok(Some(Bytes::copy_from_slice(&all[start.min(end)..end])))
    }

    async fn size(&self, path: &str) -> Result<Option<u64>> {
        if path.starts_with("blobs/") {
            return match self.cached(path).await? {
                Some(h) => h.get_size().map(|n| Some(n as u64)).map_err(backend),
                None => Ok(None),
            };
        }
        Ok(self.snapshot(path).await?.map(|f| f.size() as u64))
    }

    async fn write(&self, path: &str, bytes: &[u8]) -> Result<()> {
        self.forget(path);
        let file = self.file(path, true).await?.ok_or_else(|| Error::Backend(format!("{path} can't be made")))?;
        let h = Self::handle(&file).await?;
        let written = (|| {
            h.truncate_with_f64(0.0).map_err(backend)?;
            let options = FileSystemReadWriteOptions::new();
            let mut done = 0;
            while done < bytes.len() {
                options.set_at_f64(done as f64);
                let n = h.write_with_u8_array_and_options(&bytes[done..], &options).map_err(backend)? as usize;
                if n == 0 {
                    return Err(Error::Backend(format!("OPFS write stopped at {done} of {} bytes", bytes.len())));
                }
                done += n;
            }
            Ok(())
        })();
        h.close();
        written
    }

    async fn rename(&self, from: &str, to: &str) -> Result<bool> {
        let file = self.file(from, false).await?.ok_or_else(|| Error::Backend(format!("{from} isn't there to move")))?;
        let Ok(mover) = Reflect::get(&file, &"move".into()).and_then(|f| f.dyn_into::<Function>()) else {
            return Ok(false);
        };
        let (dir, name) = self.split(to)?;
        self.forget(to);
        let p: Promise = mover.call2(&file, dir, &name.into()).map_err(backend)?.unchecked_into();
        match JsFuture::from(p).await {
            Ok(_) => Ok(true),
            // an engine whose move() can't do this: the store copies, and nothing moved
            Err(e) if named(&e, "NotSupportedError") || e.is_instance_of::<js_sys::TypeError>() => Ok(false),
            Err(e) => Err(backend(e)),
        }
    }

    async fn remove(&self, path: &str) -> Result<()> {
        self.forget(path);
        let (dir, name) = self.split(path)?;
        match JsFuture::from(dir.remove_entry(name)).await {
            Ok(_) => Ok(()),
            Err(e) if named(&e, "NotFoundError") => Ok(()),
            Err(e) => Err(backend(e)),
        }
    }

    async fn list(&self, dir: &str) -> Result<Vec<String>> {
        let (handle, _) = self.split(&format!("{dir}/"))?;
        let keys = handle.keys();
        let mut out = Vec::new();
        loop {
            let next = wait(keys.next().map_err(backend)?).await?;
            if Reflect::get(&next, &"done".into()).map_err(backend)?.is_truthy() {
                return Ok(out);
            }
            if let Some(name) = Reflect::get(&next, &"value".into()).map_err(backend)?.as_string() {
                out.push(name);
            }
        }
    }
}
