//! The diagnostics reports of the person's devices, kept on this Mac where whoever looks into a device reads them
//! (Samuel 2026-10-26: "I don't want to copy paste anything"): the page reads them from avenDB's server by a pass this
//! Mac signs (`POST /feed/diagnostics`, src/lib/avendb/diagnostics-send.js) and hands them here, and each is written,
//! once, as `~/Library/Logs/TheOS/diagnostics/<device>-<at>.json`, the newest `KEEP` of each device kept.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde_json::Value;

/// The most reports kept of one device: the newest.
const KEEP: usize = 20;

/// Where they are kept.
fn folder() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join("Library/Logs/TheOS/diagnostics")
}

/// Keeps `reports`, each `{device, at, report}` as the server answers them: writes those it holds no file of, then lets
/// each device's oldest go past `KEEP`. How many it wrote.
#[tauri::command]
pub fn diagnostics_keep(reports: Vec<Value>) -> crate::Res<usize> {
    let dir = folder();
    std::fs::create_dir_all(&dir).map_err(crate::err)?;
    let mut wrote = 0;
    for r in &reports {
        let (Some(device), Some(at)) = (r["device"].as_str(), r["at"].as_u64()) else { continue };
        if device.len() < 8 || !device.bytes().all(|b| b.is_ascii_hexdigit()) {
            continue;
        }
        let file = dir.join(format!("{}-{at}.json", &device[..16.min(device.len())]));
        if file.exists() {
            continue;
        }
        let bytes = serde_json::to_vec_pretty(r).map_err(crate::err)?;
        std::fs::write(&file, bytes).map_err(crate::err)?;
        wrote += 1;
    }
    // the newest KEEP of each device: names sort by device, then by when
    let mut by: BTreeMap<String, Vec<(u64, PathBuf)>> = BTreeMap::new();
    for entry in std::fs::read_dir(&dir).map_err(crate::err)?.flatten() {
        let path = entry.path();
        let Some(name) = path.file_stem().and_then(|n| n.to_str()) else { continue };
        let Some((device, at)) = name.rsplit_once('-') else { continue };
        let Ok(at) = at.parse::<u64>() else { continue };
        by.entry(device.to_string()).or_default().push((at, path.clone()));
    }
    for files in by.values_mut() {
        files.sort();
        let excess = files.len().saturating_sub(KEEP);
        for (_, path) in files.drain(..excess) {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(wrote)
}
