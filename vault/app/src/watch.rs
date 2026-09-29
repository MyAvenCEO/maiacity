//! The watch folder: `~/Movies/maiaCITY Inbox` (or the one chosen in settings.json, `watch_dir`). Whatever lands there
//! is ingested by itself — with the three-hash check, like every ingest — once it has stopped growing, and then moved
//! into `ingested/` beside it (nothing is deleted; the folder shows what is done). A mismatch stays where it is.

use std::{collections::HashMap, path::PathBuf, sync::Arc, time::Duration};

use tauri::{AppHandle, Emitter};
use vault_core::{Vault, Verdict, ingest};

pub fn watch_dir() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    std::fs::read(crate::settings_file())
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| v["watch_dir"].as_str().map(PathBuf::from))
        .unwrap_or_else(|| home.join("Movies/maiaCITY Inbox"))
}

pub async fn run(handle: AppHandle, vault: Arc<Vault>) {
    let dir = watch_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let done = dir.join("ingested");
    // a file is taken once its size stood still across two looks
    let mut last: HashMap<PathBuf, u64> = HashMap::new();
    loop {
        tokio::time::sleep(Duration::from_secs(10)).await;
        if !crate::auth::signed_in() {
            continue;
        }
        let files: Vec<PathBuf> = ingest::walk(&dir).unwrap_or_default().into_iter().filter(|f| !f.starts_with(&done)).collect();
        let mut now = HashMap::new();
        for f in files {
            let Ok(size) = std::fs::metadata(&f).map(|m| m.len()) else { continue };
            if size > 0 && last.get(&f) == Some(&size) {
                let batch = ingest::Batch { session: ingest::now_iso(), tags: vec!["watch folder".into()], ..Default::default() };
                match vault.ingest_file(&f, &batch).await {
                    Ok(o) if o.verdict != Verdict::Mismatch => {
                        let to = done.join(f.strip_prefix(&dir).unwrap_or(&f));
                        if let Some(parent) = to.parent() {
                            std::fs::create_dir_all(parent).ok();
                        }
                        std::fs::rename(&f, &to).ok();
                        if o.verdict == Verdict::Verified && ingest::kind_of(ingest::mime_of(&to)) == "video" {
                            tauri::async_runtime::spawn(crate::proxies::auto_proxy(handle.clone(), vault.clone(), o.hash.clone(), to.clone()));
                        }
                        handle.emit("watch-folder", &o).ok();
                    }
                    Ok(o) => tracing::warn!("watch folder: {} — the hashes disagree, left in place", o.source),
                    Err(e) => tracing::warn!("watch folder: {}: {e:#}", f.display()),
                }
            } else {
                now.insert(f, size);
            }
        }
        last = now;
    }
}
