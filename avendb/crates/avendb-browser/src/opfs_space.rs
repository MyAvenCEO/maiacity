//! A page's spill (`avendb::lab::Spill::in_space`): the one OPFS file its device's worker holds open to append every
//! signed edit and McEliece key it holds, and the pages of their index, and to read them back at once, through the
//! file's synchronous access handle (`FileSystemSyncAccessHandle`), which a dedicated worker alone may hold. So the
//! page's memory holds the records it read lately and their index's newest changes, a budget's worth, not every edit
//! it holds (an iPhone's page was let go at ~980 MB for 95k edits, 2026-10-27). OPFS only, never IndexedDB.
//!
//! The file is no store of record: the shelf is. Each device's open starts a new one in the folder `SPILL`, the files
//! of older opens removed first, and the device's close removes its own.

use std::io;
use std::sync::{Arc, Mutex};

use avendb::pages::Space;
use js_sys::{Function, Object, Promise, Reflect, Uint8Array};
use wasm_bindgen::{JsCast as _, JsValue};
use wasm_bindgen_futures::JsFuture;

/// The OPFS folder of the spills, beside the store's generations.
const SPILL: &str = "avendb-spill";

/// An OPFS file held open by its synchronous access handle, and how many bytes it holds.
pub struct OpfsSpace {
    handle: JsValue,
    name: String,
    len: Mutex<u64>,
}

// A page's WebAssembly runs on one thread, its worker's: the handle never crosses to another.
unsafe impl Send for OpfsSpace {}
unsafe impl Sync for OpfsSpace {}

impl std::fmt::Debug for OpfsSpace {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OpfsSpace").field("name", &self.name).field("len", &self.len).finish_non_exhaustive()
    }
}

fn get(of: &JsValue, key: &str) -> Result<JsValue, JsValue> {
    Reflect::get(of, &key.into())
}

fn call(of: &JsValue, method: &str, args: &[&JsValue]) -> Result<JsValue, JsValue> {
    let f: Function = get(of, method)?.dyn_into()?;
    let args: js_sys::Array = args.iter().copied().collect();
    f.apply(of, &args)
}

async fn awaited(value: JsValue) -> Result<JsValue, JsValue> {
    JsFuture::from(Promise::resolve(&value)).await
}

fn options(pairs: &[(&str, JsValue)]) -> Result<JsValue, JsValue> {
    let o = Object::new();
    for (k, v) in pairs {
        Reflect::set(&o, &(*k).into(), v)?;
    }
    Ok(o.into())
}

fn io_error(e: JsValue) -> io::Error {
    io::Error::other(format!("OPFS: {}", e.as_string().unwrap_or_else(|| format!("{e:?}"))))
}

impl OpfsSpace {
    /// A new spill file in OPFS, held open; the files older opens left removed first, as far as no other tab holds
    /// them.
    pub async fn open() -> Result<Arc<OpfsSpace>, JsValue> {
        let storage = get(&get(&js_sys::global(), "navigator")?, "storage")?;
        let root = awaited(call(&storage, "getDirectory", &[])?).await?;
        let create = options(&[("create", true.into())])?;
        let dir = awaited(call(&root, "getDirectoryHandle", &[&SPILL.into(), &create])?).await?;
        // the files of older opens: each one this device's, as one tab at a time opens it
        let mut old = Vec::new();
        let names = call(&dir, "keys", &[])?;
        loop {
            let next = awaited(call(&names, "next", &[])?).await?;
            if get(&next, "done")?.as_bool().unwrap_or(true) {
                break;
            }
            if let Some(name) = get(&next, "value")?.as_string() {
                old.push(name);
            }
        }
        for name in old {
            // held by another tab: left for a later open
            awaited(call(&dir, "removeEntry", &[&name.into()])?).await.ok();
        }
        let mut n = [0u8; 8];
        getrandom::fill(&mut n).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let name = format!("spill-{}", n.iter().map(|b| format!("{b:02x}")).collect::<String>());
        let file = awaited(call(&dir, "getFileHandle", &[&name.clone().into(), &create])?).await?;
        let handle = awaited(call(&file, "createSyncAccessHandle", &[])?).await?;
        call(&handle, "truncate", &[&0.into()])?;
        Ok(Arc::new(OpfsSpace { handle, name, len: Mutex::new(0) }))
    }
}

impl Space for OpfsSpace {
    fn append(&self, bytes: &[u8]) -> io::Result<u64> {
        let mut len = self.len.lock().expect("space");
        let at = *len;
        let buffer = Uint8Array::from(bytes);
        let at_opts = options(&[("at", (at as f64).into())]).map_err(io_error)?;
        let wrote = call(&self.handle, "write", &[&buffer, &at_opts]).map_err(io_error)?;
        if wrote.as_f64() != Some(bytes.len() as f64) {
            return Err(io::Error::new(io::ErrorKind::WriteZero, "OPFS took fewer bytes than it was given"));
        }
        *len += bytes.len() as u64;
        Ok(at)
    }

    fn read_at(&self, at: u64, bytes: &mut [u8]) -> io::Result<()> {
        let buffer = Uint8Array::new_with_length(bytes.len() as u32);
        let at_opts = options(&[("at", (at as f64).into())]).map_err(io_error)?;
        let read = call(&self.handle, "read", &[&buffer, &at_opts]).map_err(io_error)?;
        if read.as_f64() != Some(bytes.len() as f64) {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        buffer.copy_to(bytes);
        Ok(())
    }

    fn len(&self) -> u64 {
        *self.len.lock().expect("space")
    }
}

impl Drop for OpfsSpace {
    fn drop(&mut self) {
        // closed, so the next open removes it, if this one doesn't first
        call(&self.handle, "close", &[]).ok();
        let name = self.name.clone();
        wasm_bindgen_futures::spawn_local(async move {
            let Ok(storage) = get(&js_sys::global(), "navigator").and_then(|n| get(&n, "storage")) else { return };
            let Ok(root) = call(&storage, "getDirectory", &[]) else { return };
            let Ok(root) = awaited(root).await else { return };
            let Ok(dir) = call(&root, "getDirectoryHandle", &[&SPILL.into()]) else { return };
            let Ok(dir) = awaited(dir).await else { return };
            if let Ok(removed) = call(&dir, "removeEntry", &[&name.into()]) {
                awaited(removed).await.ok();
            }
        });
    }
}
