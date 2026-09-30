//! Proxies, always: every video original gets its HD proxy, in the studio's one working space (ACEScct) — its colour
//! told from the file (game/film/color.js's rules), taken through its colour journey into ACEScct, encoded natively
//! (VideoToolbox, HEVC Main10) and put into the vault as the original's proxy: in the same story, class proxy, both
//! described, both synced like everything else. The display transform is never part of a proxy — it belongs to the
//! screen or the delivery. A source whose colour cannot be told, or whose journey is not defined yet, waits and says
//! so; the sweep makes its proxy by itself the day its journey exists.
//!
//! One proxy at a time (the encoder is the Mac's) — a world shot's (world.rs) and a film's render (render.rs) take their
//! turn here too; each says how far it is.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use vault_core::{Meta, Vault, ingest::Batch};

use vault_media::proxy::WORKING;

/// Is there a colour journey from this source into ACEScct? (vault_media::cst — verified against OCIO)
pub fn journey(profile: &str) -> bool {
    vault_media::cst::journey(profile).is_some()
}

/// The colour detection's version: a file told "unknown" by an older one is read again (2: the sample description's
/// log atom — Apple Log 2 from the Blackmagic app and the iPhone).
const DETECTOR: u64 = 2;

/// A proxy being made or waiting its turn, as the studio shows it.
#[derive(Serialize, Clone)]
pub struct Making {
    /// the original's hash
    pub of: String,
    pub name: String,
    /// queued · probing · making · adding
    pub stage: String,
    /// 0…1 while making
    pub done: f64,
}

pub(crate) static NOW: Mutex<Option<HashMap<String, Making>>> = Mutex::new(None);
/// one proxy at a time
pub(crate) static TURN: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

pub(crate) fn set(of: &str, name: &str, stage: &str, done: f64) {
    NOW.lock().unwrap().get_or_insert_with(HashMap::new).insert(of.into(), Making { of: of.into(), name: name.into(), stage: stage.into(), done });
}
pub(crate) fn clear(of: &str) {
    if let Some(m) = NOW.lock().unwrap().as_mut() {
        m.remove(of);
    }
}

/// How often a proxy is tried before it waits for a person (a decode that failed once — the Mac short of memory, a
/// card pulled — usually works the next time).
pub(crate) const TRIES: u64 = 3;

/// What holds this Mac's uploads now: "ingest", "proxy", "render" (empty: nothing — files sync).
#[tauri::command]
pub fn vault_hold(app: tauri::State<'_, crate::App>) -> crate::Res<Vec<String>> {
    crate::gate()?;
    Ok(app.vault.hold.now())
}

/// How short of memory the Mac is, as macOS itself says (`kern.memorystatus_vm_pressure_level`): 1 normal, 2 warning,
/// 4 critical. A proxy starts only at 1.
pub fn pressure() -> u32 {
    let mut level: u32 = 1;
    let mut len = std::mem::size_of::<u32>();
    // SAFETY: sysctlbyname writes at most `len` bytes into `level`; the name is NUL-terminated.
    let ok = unsafe {
        libc::sysctlbyname(c"kern.memorystatus_vm_pressure_level".as_ptr(), (&mut level as *mut u32).cast(), &mut len, std::ptr::null_mut(), 0)
    };
    if ok == 0 { level } else { 1 }
}

/// A LUT for the studio's viewer, baked here from the same maths the proxies and the render use: a profile's journey
/// into ACEScct (`cst`), or `odt-rec709` — the ACES 2.0 output transform, ACEScct to Rec.709 display code values
/// (`aces2`, within 0.07 of a 10-bit code of OCIO). A little-endian u32 size, then size³ RGB f32, red fastest.
#[tauri::command]
pub fn color_lut(profile: String) -> crate::Res<tauri::ipc::Response> {
    crate::gate()?;
    let (size, cube) = if profile == "odt-rec709" {
        (vault_media::aces2::CUBE_SIZE, vault_media::aces2::bake_cube(vault_media::aces2::CUBE_SIZE))
    } else {
        let journey = vault_media::cst::journey(&profile).ok_or_else(|| format!("no colour journey from {profile} into ACEScct"))?;
        (vault_media::cst::CUBE_SIZE, journey.cube(vault_media::cst::CUBE_SIZE))
    };
    let mut out = Vec::with_capacity(4 + cube.len() * 4);
    out.extend_from_slice(&(size as u32).to_le_bytes());
    for v in cube {
        out.extend_from_slice(&v.to_le_bytes());
    }
    Ok(tauri::ipc::Response::new(out))
}

/// A clip's grade for the studio's viewer, baked here from the grade's only maths (vault-render `grade`): its balance,
/// then its grades in order (its own CDL, the film's look), as a cube over ACEScct — the viewer samples it between the
/// input and the output transforms. A little-endian u32 size, then size³ RGB f32, red fastest.
#[tauri::command]
pub async fn color_grade(
    app: tauri::State<'_, crate::App>,
    balance: Option<serde_json::Value>,
    grades: Vec<serde_json::Value>,
    looks: Option<Vec<serde_json::Value>>,
) -> crate::Res<tauri::ipc::Response> {
    crate::gate()?;
    const SIZE: usize = 33;
    let cube = chain_cube(&app.vault, balance, grades, looks.unwrap_or_default(), SIZE).await?;
    let mut out = Vec::with_capacity(4 + cube.len() * 4);
    out.extend_from_slice(&(SIZE as u32).to_le_bytes());
    for v in cube {
        out.extend_from_slice(&v.to_le_bytes());
    }
    Ok(tauri::ipc::Response::new(out))
}

/// The looks named (the scene's, the film's), checked, with their creative LUTs read from the vault.
async fn looks_of(vault: &Vault, looks: &[serde_json::Value]) -> crate::Res<Vec<(vault_render::creative::Look, Option<vault_render::Lut3d>)>> {
    let mut out = Vec::new();
    for l in looks.iter().filter_map(vault_render::creative::clean_look) {
        let lut = match &l.lut {
            Some(h) => {
                let hash: iroh_blobs::Hash = h.parse().map_err(|e| format!("{e}"))?;
                let src = crate::blob::source(vault, hash, "look.cube").await.map_err(|e| format!("{e:#}"))?;
                let text = tauri::async_runtime::spawn_blocking(move || src.read_all()).await.map_err(|e| format!("{e}"))?.map_err(|e| format!("{e:#}"))?;
                Some(vault_render::Lut3d::from_cube_str(h, &String::from_utf8_lossy(&text)).map_err(|e| format!("{e:#}"))?)
            }
            None => None,
        };
        out.push((l, lut));
    }
    Ok(out)
}

/// A clip's whole colour chain (its balance, its grades, its looks) as one cube over ACEScct, `size`³ RGB.
pub(crate) async fn chain_cube(vault: &Vault, balance: Option<serde_json::Value>, grades: Vec<serde_json::Value>, looks: Vec<serde_json::Value>, size: usize) -> crate::Res<Vec<f32>> {
    let b = balance.as_ref().and_then(vault_render::grade::clean_balance);
    let g: Vec<vault_render::grade::Cdl> = grades.iter().filter_map(vault_render::grade::clean_cdl).collect();
    let looks = looks_of(vault, &looks).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let ready: Vec<vault_render::creative::Ready> = looks.iter().map(|(l, lut)| vault_render::creative::Ready::new(l, lut.clone())).collect();
        vault_render::creative::bake(b.as_ref(), &g, &ready, crate::render::odt(), size)
    })
    .await
    .map_err(|e| format!("{e}"))
}

/// A shot as the film will show it, natively, for the studio: its grading still (4K ACEScct, from the original),
/// framed for `shape` (none: the whole still), through its whole grade — balance, secondaries (a face-tracked window on
/// the face Vision finds), its grade and looks (the timeline's: its scene's, the film's), the film's finishing — and
/// the output transform, as a JPEG `width` wide. The Grade viewer and every thumbnail show these: what the render makes.
#[tauri::command]
pub async fn color_frame(
    app: tauri::State<'_, crate::App>,
    timeline: serde_json::Value,
    clip: String,
    still: String,
    width: Option<u32>,
    shape: Option<String>,
) -> crate::Res<tauri::ipc::Response> {
    crate::gate()?;
    let vault = app.vault.clone();
    let t: vault_render::Timeline = serde_json::from_value(timeline).map_err(|e| format!("{e}"))?;
    let c = t.clips.iter().find(|c| c.id == clip).cloned().ok_or("no such clip on this timeline")?;
    let hash: iroh_blobs::Hash = still.parse().map_err(|e| format!("{e}"))?;
    let src = crate::blob::source(&vault, hash, "still.png").await.map_err(|e| format!("{e:#}"))?;
    // the clip's own grade and its looks, baked with the look's LUTs read from the vault (the balance is its own node)
    let looks: Vec<serde_json::Value> = t.looks_for(&c).iter().filter_map(|l| serde_json::to_value(l).ok()).collect();
    let grades: Vec<serde_json::Value> = c.grade.iter().cloned().collect();
    let cube = if looks.is_empty() && grades.is_empty() { None } else { Some(chain_cube(&vault, None, grades, looks, 33).await?) };
    let w = width.unwrap_or(960).clamp(64, 3840);
    let finish = t.finish();
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let out = vault.ingest_dir().join(format!("frame-{}-{}.jpg", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        objc2::rc::autoreleasepool(|_| -> anyhow::Result<Vec<u8>> {
            use vault_render::gpu::Extent;
            let mut gpu = vault_render::gpu::Gpu::new()?;
            gpu.set_output(crate::render::odt());
            let img = gpu.still(src)?;
            let e = img.ext();
            let (aw, ah) = match shape.as_deref().and_then(vault_render::Shape::of) {
                Some(s) => (s.render_size().0 as f64, s.render_size().1 as f64),
                None => (e.size.width, e.size.height),
            };
            let h = ((w as f64 * ah / aw.max(1.0)).round() as u32).max(2);
            let framed = gpu.frame_to(&img, w, h, shape.as_deref().and_then(|s| c.frame_for(s)))?;
            let cube = match cube {
                Some(data) => Some(gpu.cube(&vault_render::Lut3d::from_rgb("chain", 33, data)?)),
                None => None,
            };
            let pic = vault_render::render::chain(&gpu, &framed, w, h, &c, cube.as_ref(), finish.as_ref(), 0)?;
            gpu.jpeg(&*gpu.output(&pic)?, w, h, &out)?;
            let bytes = std::fs::read(&out)?;
            std::fs::remove_file(&out).ok();
            Ok(bytes)
        })
    })
    .await
    .map_err(|e| format!("{e}"))?
    .map_err(|e| format!("{e:#}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// The grade presets (vault-render `grade::PRESETS`): name, what the studio calls it, its CDL.
#[tauri::command]
pub fn color_presets() -> crate::Res<Vec<serde_json::Value>> {
    crate::gate()?;
    Ok(vault_render::grade::PRESETS
        .iter()
        .filter_map(|(name, label)| vault_render::grade::preset(name).map(|c| serde_json::json!({ "name": name, "label": label, "cdl": c.to_json() })))
        .collect())
}

/// The proxies being made or queued right now.
#[tauri::command]
pub fn proxies_now() -> crate::Res<Vec<Making>> {
    crate::gate()?;
    Ok(NOW.lock().unwrap().as_ref().map(|m| m.values().cloned().collect()).unwrap_or_default())
}

/// A film's proxy made again (its colour read again too), from the vault's own copy.
#[tauri::command]
pub async fn vault_proxy(handle: AppHandle, app: tauri::State<'_, crate::App>, hash: String) -> crate::Res<()> {
    crate::gate()?;
    tauri::async_runtime::spawn(auto_proxy(handle, app.vault.clone(), hash, PathBuf::new()));
    Ok(())
}

/// Does this file get a proxy? A video that is an original (not a proxy, not a delivery, not a working file).
pub fn wants_proxy(m: &Meta) -> bool {
    let working = !matches!(m.class.as_str(), "proxy" | "delivery");
    (m.kind == "video" && m.class == "original") || (working && (m.kind == "image" || sequence(m)))
}

/// An EXR frame sequence, packed into one tar (its meta says so when it was packed).
fn sequence(m: &Meta) -> bool {
    m.meta.get("sequence").and_then(|s| s.as_str()) == Some("exr")
}

/// Every original still without its proxy, queued — at the start, and every ten minutes: a journey defined since, a
/// file that came in on another device.
/// Is this the hash of a proxy of ours — ACEScct, made here? (The old render worker's proxies, in their source's own
/// encoding, are not: their originals get a new one.)
fn ours(all: &HashMap<String, &Meta>, hash: &str) -> bool {
    all.get(hash).is_some_and(|p| p.meta.pointer("/color/profile").and_then(|v| v.as_str()) == Some(WORKING))
}

pub async fn sweep(handle: AppHandle, vault: Arc<Vault>) {
    // what a run that ended midway left behind (the app quit, the Mac froze): half-made proxies, exported sources,
    // landing copies — nothing uses them now; the files themselves are taken up again below
    let started = std::time::SystemTime::now();
    for e in std::fs::read_dir(vault.ingest_dir()).into_iter().flatten().flatten() {
        let old = e.metadata().and_then(|m| m.modified()).is_ok_and(|t| t < started);
        let name = e.file_name().to_string_lossy().into_owned();
        if old && (name.contains(".proxy.") || name.contains(".src") || name.contains(".part")) {
            tracing::info!("left from an earlier run, removed: {name}");
            std::fs::remove_file(e.path()).ok();
        }
    }
    loop {
        tokio::time::sleep(Duration::from_secs(20)).await;
        if crate::auth::signed_in() {
            if let Ok(all) = vault.catalog.list_view().await {
                let by_hash: HashMap<String, &Meta> = all.iter().map(|m| (m.hash.clone(), m)).collect();
                for m in all.iter().filter(|m| wants_proxy(m)) {
                    let state = m.meta.get("proxy").and_then(|p| p.as_str()).unwrap_or("");
                    let made = state.len() == 64 && state.bytes().all(|b| b.is_ascii_hexdigit()) && ours(&by_hash, state);
                    let profile = m.meta.pointer("/color/profile").and_then(|p| p.as_str()).unwrap_or("");
                    let detector = m.meta.pointer("/color/detector").and_then(|d| d.as_u64()).unwrap_or(0);
                    let tries = m.meta.get("proxy_tries").and_then(|t| t.as_u64()).unwrap_or(0);
                    // never tried, waiting for a journey that exists now, its colour unknown to an older detector, or
                    // failed fewer than TRIES times (healing by itself)
                    let legacy = state.len() == 64 && !made;
                    let due = state.is_empty()
                        || legacy
                        || (state.starts_with("waiting") && (journey(profile) || (profile == "unknown" && detector < DETECTOR)))
                        || (state.starts_with("failed") && tries < TRIES);
                    let queued = NOW.lock().unwrap().as_ref().is_some_and(|n| n.contains_key(&m.hash));
                    if !made && due && !queued {
                        tauri::async_runtime::spawn(auto_proxy(handle.clone(), vault.clone(), m.hash.clone(), PathBuf::new()));
                    }
                    // a video with its proxy but no grading still yet (made before there were any): its still
                    // (and its preview, made with it)
                    let still = m.meta.get("grade_still").and_then(|p| p.as_str()).is_some_and(|s| s.len() == 64) && m.meta.get("preview").and_then(|p| p.as_str()).is_some_and(|s| s.len() == 64);
                    let still_tries = m.meta.get("grade_still_tries").and_then(|t| t.as_u64()).unwrap_or(0);
                    let still_queued = NOW.lock().unwrap().as_ref().is_some_and(|n| n.contains_key(&format!("still:{}", m.hash)));
                    if made && m.kind == "video" && !sequence(m) && !still && still_tries < TRIES && !still_queued && journey(profile) {
                        tauri::async_runtime::spawn(backfill_still(vault.clone(), m.hash.clone()));
                    } else if made && m.kind == "video" && !sequence(m) && still_tries < TRIES && !still_queued && journey(profile) {
                        // the analysis marked its best frame: the grading still and the preview made of that one
                        if let Some(t) = marked_at(m, &by_hash) {
                            tauri::async_runtime::spawn(backfill_still_at(vault.clone(), m.hash.clone(), Some(t)));
                        }
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(600)).await;
    }
}

pub async fn auto_proxy(handle: AppHandle, vault: Arc<Vault>, hex: String, source: PathBuf) {
    let name = match hex.parse::<iroh_blobs::Hash>() {
        Ok(h) => vault.catalog.meta(h).await.ok().flatten().map(|m| m.original_name).unwrap_or_default(),
        Err(_) => return,
    };
    set(&hex, &name, "queued", 0.0);
    let _turn = TURN.acquire().await;
    // an ingest first: every file in, then the proxies
    vault.hold.free_of("ingest").await;
    // and only while the Mac has memory to spare — macOS's own word for it, not a number of ours
    while pressure() > 1 {
        set(&hex, &name, "waiting for memory", 0.0);
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    let result = {
        let _held = vault.hold.take("proxy");
        make(&vault, &hex, &name, source).await
    };
    clear(&hex);
    handle.emit("vault-proxy", json!({ "of": hex })).ok();
    if result.is_ok() {
        // its proxy is here: its first thumbnail and its analysis (analyse/)
        crate::analyse::wake();
    }
    if let Err(e) = result {
        tracing::warn!("proxy of {hex}: {e}");
        for e in std::fs::read_dir(vault.ingest_dir()).into_iter().flatten().flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            if n.starts_with(&hex) && (n.contains(".proxy.") || n.contains(".src")) {
                std::fs::remove_file(e.path()).ok();
            }
        }
        if let Ok(hash) = hex.parse::<iroh_blobs::Hash>() {
            let tries = vault.catalog.meta(hash).await.ok().flatten().and_then(|m| m.meta.get("proxy_tries").and_then(|t| t.as_u64())).unwrap_or(0) + 1;
            let note = if tries < TRIES { format!("failed: {e} — tried {tries} of {TRIES}, again by itself") } else { format!("failed: {e} — tried {TRIES} times, make it again by hand") };
            vault.catalog.describe(hash, &json!({ "meta": { "proxy": note, "proxy_tries": tries } })).await.ok();
        }
    }
}

async fn make(vault: &Vault, hex: &str, name: &str, source: PathBuf) -> Result<(), String> {
    let hash: iroh_blobs::Hash = hex.parse().map_err(|e| format!("{e}"))?;
    let original = vault.catalog.meta(hash).await.map_err(|e| format!("{e:#}"))?.ok_or("no such file")?;
    set(hex, name, "probing", 0.0);
    // the source while the card is still there; else the vault's own bytes, read in place (never copied out)
    let path: vault_media::Source = if source.exists() {
        source.into()
    } else {
        crate::blob::source(vault, hash, &original.original_name).await.map_err(|e| format!("{e:#}"))?
    };
    let set_by_hand = original.meta.pointer("/color/override").and_then(|v| v.as_str()).map(String::from);
    // what it is: a movie (probed), a still, or an EXR sequence — and its colour, told from the file
    let still = original.kind == "image";
    let seq = sequence(&original);
    let profile = if still || seq {
        let head = path.head(1 << 16);
        // a sequence was given its colour when it was packed; a still's EXR header names its linear space; else sRGB
        let (told, from) = match (seq, original.meta.pointer("/color/profile").and_then(|v| v.as_str())) {
            (true, Some(p)) => (p.to_string(), "given when packed"),
            (true, None) => ("from its frames".to_string(), "its first frame's header"),
            (false, _) => match head.ok().as_deref().and_then(vault_media::still::exr_profile) {
                Some(p) => (p.to_string(), "its EXR header"),
                None => ("srgb".to_string(), "a still (sRGB)"),
            },
        };
        vault
            .catalog
            .describe(hash, &json!({ "meta": { "color": { "profile": told, "from": from, "override": set_by_hand, "detector": DETECTOR } } }))
            .await
            .map_err(|e| format!("{e:#}"))?;
        set_by_hand.clone().unwrap_or(told)
    } else {
        let probe_path = path.clone();
        let probe = tokio::task::spawn_blocking(move || vault_media::probe(probe_path)).await.map_err(|e| e.to_string())?.map_err(|e| format!("{e:#}"))?;
        let told = vault_media::detect(&probe);
        // the start timecode comes from the sound record (sound.rs, this Mac: the tmcd track); one an older probe
        // carries is kept through a new probe
        let mut probe = serde_json::to_value(&probe).map_err(|e| e.to_string())?;
        for k in ["timecode", "timecode_fps"] {
            if let Some(v) = original.meta.pointer(&format!("/probe/{k}")) {
                probe[k] = v.clone();
            }
        }
        vault
            .catalog
            .describe(hash, &json!({ "meta": { "color": { "profile": told.profile, "from": told.from, "override": set_by_hand, "detector": DETECTOR }, "probe": probe } }))
            .await
            .map_err(|e| format!("{e:#}"))?;
        set_by_hand.clone().unwrap_or_else(|| told.profile.clone())
    };
    if profile == "unknown" {
        vault.catalog.describe(hash, &json!({ "meta": { "proxy": "waiting: its colour cannot be told — set it by hand, or add a colour journey for this kind of source" } })).await.ok();
        return Ok(());
    }
    if !journey(&profile) && profile != "from its frames" {
        vault.catalog.describe(hash, &json!({ "meta": { "proxy": format!("waiting: no colour journey from {profile} into ACEScct yet") } })).await.ok();
        return Ok(());
    }

    // a display still at HD or smaller needs none: the viewer takes it through its input LUT as it is
    if still {
        let p = path.clone();
        let (w, h) = tokio::task::spawn_blocking(move || -> anyhow::Result<(u32, u32)> {
            Ok(vault_media::gpu::size_of(&*vault_media::gpu::load_image(&p.read_all()?)?))
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))?;
        let exr = profile != "srgb";
        if !vault_media::still::still_needs_proxy(exr, w, h) {
                vault.catalog.describe(hash, &json!({ "meta": { "proxy": format!("none: a {w}×{h} display still needs none") } })).await.ok();
            return Ok(());
        }
    }

    set(hex, name, "making", 0.0);
    let ext = if still { "png" } else { "mp4" };
    let out = vault.ingest_dir().join(format!("{hex}.proxy.{ext}"));
    let (src, o, of, nm, pf) = (path.clone(), out.clone(), hex.to_string(), name.to_string(), profile.clone());
    let fps = original.meta.get("fps").and_then(|f| f.as_f64()).unwrap_or(24.0);
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        let mut told = |done: f64| set(&of, &nm, "making", done);
        if still {
            vault_media::still::make_still_proxy(src, &o, &pf)?;
        } else if seq {
            vault_media::still::make_sequence_proxy(src, &o, (pf != "from its frames").then_some(pf.as_str()), fps, &mut told)?;
        } else {
            vault_media::make_proxy(src, &o, &pf, &mut told)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))?;
    set(hex, name, "adding", 1.0);
    // the proxy lives beside its original: the same story, class proxy
    let stem = std::path::Path::new(name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| hex[..12].to_string());
    let named = vault.ingest_dir().join(format!("{stem}.proxy.{ext}"));
    std::fs::rename(&out, &named).map_err(|e| e.to_string())?;
    let batch = Batch {
        session: format!("proxy of {hex}"),
        tags: vec!["proxy".into()],
        meta: json!({ "role": "proxy", "proxy_of": hex, "color": { "profile": WORKING, "from": "our own tag", "journey_from": profile } }),
        story: Some(original.story.clone()).filter(|s| !s.is_empty()),
        class: Some("proxy".into()),
        ..Default::default()
    };
    let made = vault.ingest_file(&named, &batch).await.map_err(|e| format!("{e:#}"))?;
    std::fs::remove_file(&named).ok();
    vault.catalog.describe(hash, &json!({ "meta": { "proxy": made.hash } })).await.map_err(|e| format!("{e:#}"))?;
    // and while the original is at hand: its grading still
    if !still && !seq {
        set(hex, name, "grading still", 1.0);
        if let Err(e) = grading_still(vault, hex, name, &path, &profile).await {
            tracing::warn!("grading still of {hex}: {e}");
        }
    }
    Ok(())
}

/// How wide a grading still is: 4K UHD.
const STILL_WIDTH: u32 = 3840;

/// A video original's grading still: its middle frame, through its journey (CST) into ACEScct, 3840 wide, a 16-bit PNG
/// of ACEScct code values (vault_render `grading_still`) — beside its proxy (class proxy, the same story), named on
/// the original as `meta.grade_still`. The balance is measured and judged on it at full quality.
async fn grading_still(vault: &Vault, hex: &str, name: &str, path: &vault_media::Source, profile: &str) -> Result<(), String> {
    grading_still_at(vault, hex, name, path, profile, None).await
}

/// The file's grading still and preview at `at` (the frame the analysis marked as its best), else its middle frame.
async fn grading_still_at(vault: &Vault, hex: &str, name: &str, path: &vault_media::Source, profile: &str, at: Option<f64>) -> Result<(), String> {
    let hash: iroh_blobs::Hash = hex.parse().map_err(|e| format!("{e}"))?;
    let original = vault.catalog.meta(hash).await.map_err(|e| format!("{e:#}"))?.ok_or("no such file")?;
    let seconds = ["/probe/duration", "/duration"].iter().find_map(|p| original.meta.pointer(p).and_then(|d| d.as_f64())).unwrap_or(1.0);
    let marked = at.is_some();
    let at = at.unwrap_or(seconds / 2.0).max(0.0);
    let stem = std::path::Path::new(name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| hex[..12].to_string());
    let out = vault.ingest_dir().join(format!("{stem}.grade.png"));
    let small = vault.ingest_dir().join(format!("{stem}.preview.jpg"));
    let (src, o, pf, sm) = (path.clone(), out.clone(), profile.to_string(), small.clone());
    let (w, h) = tokio::task::spawn_blocking(move || vault_render::grading_still_and_preview(src, &pf, at, STILL_WIDTH, &o, Some((&sm, PREVIEW_WIDTH, crate::render::odt() as &dyn vault_render::Output))))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))?;
    let batch = Batch {
        session: format!("grading still of {hex}"),
        tags: vec!["grade-still".into()],
        title: Some(format!("{stem} · grading still")),
        meta: json!({ "role": "grade-still", "grade_still_of": hex, "t": (at * 1000.0).round() / 1000.0, "width": w, "height": h, "marked": marked,
            "color": { "profile": WORKING, "from": "our own tag", "journey_from": profile }, "encoding": "16-bit PNG, ACEScct code values" }),
        story: Some(original.story.clone()).filter(|s| !s.is_empty()),
        class: Some("proxy".into()),
        ..Default::default()
    };
    let made = vault.ingest_file(&out, &batch).await.map_err(|e| format!("{e:#}"));
    std::fs::remove_file(&out).ok();
    let made = made?;
    // the preview for the lists: the same frame as it will look (ACES 2.0 → Rec.709), small
    let pbatch = Batch {
        session: format!("preview of {hex}"),
        tags: vec!["preview".into()],
        title: Some(format!("{stem} · preview")),
        meta: json!({ "role": "preview", "preview_of": hex, "t": (at * 1000.0).round() / 1000.0, "width": PREVIEW_WIDTH }),
        story: Some(original.story.clone()).filter(|s| !s.is_empty()),
        class: Some("proxy".into()),
        ..Default::default()
    };
    let preview = vault.ingest_file(&small, &pbatch).await.map_err(|e| format!("{e:#}"));
    std::fs::remove_file(&small).ok();
    let preview = preview?;
    vault.catalog.describe(hash, &json!({ "meta": { "grade_still": made.hash, "preview": preview.hash } })).await.map_err(|e| format!("{e:#}"))?;
    // one still and one preview per file: any other of this file's goes
    for m in vault.catalog.list().await.map_err(|e| format!("{e:#}"))? {
        let of = |k: &str| m.meta.get(k).and_then(|v| v.as_str()) == Some(hex);
        if (of("grade_still_of") || of("preview_of")) && m.hash != made.hash && m.hash != preview.hash {
            if let Ok(h) = m.hash.parse::<iroh_blobs::Hash>() {
                vault.catalog.delete_file(h, "replaced by the file's new grading still and preview").await.ok();
            }
        }
    }
    Ok(())
}

/// How wide a list's preview is.
const PREVIEW_WIDTH: u32 = 480;


/// An original with a proxy of ours but no grading still yet (made before there were any): its still, from the
/// vault's copy of the original, one at a time after any proxy.
async fn backfill_still(vault: Arc<Vault>, hex: String) {
    backfill_still_at(vault, hex, None).await
}

/// The frame a file's grading still belongs at — picked by a person (`still_at`) or marked by the analysis as its best
/// (its thumbnail's `t`) — when its grading still is not of it yet.
fn marked_at(m: &Meta, all: &HashMap<String, &Meta>) -> Option<f64> {
    // a person's pick (`still_at`, seconds into the file) before the analysis' thumbnail
    let picked = m.meta.get("still_at").and_then(|t| t.as_f64());
    let t = match picked {
        Some(t) => t,
        None => all.get(m.meta.get("thumbnail")?.as_str()?)?.meta.get("t")?.as_f64()?,
    };
    let still_t = m.meta.get("grade_still").and_then(|h| h.as_str()).and_then(|h| all.get(h)).and_then(|s| s.meta.get("t")?.as_f64());
    still_t.is_none_or(|s| (s - t).abs() > 0.05).then_some(t)
}

async fn backfill_still_at(vault: Arc<Vault>, hex: String, at: Option<f64>) {
    let k = format!("still:{hex}");
    let Ok(hash) = hex.parse::<iroh_blobs::Hash>() else { return };
    let Some(original) = vault.catalog.meta(hash).await.ok().flatten() else { return };
    let name = original.original_name.clone();
    set(&k, &name, "queued", 0.0);
    let _turn = TURN.acquire().await;
    vault.hold.free_of("ingest").await;
    while pressure() > 1 {
        set(&k, &name, "waiting for memory", 0.0);
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    set(&k, &name, "grading still", 0.0);
    let told = |p: &str| original.meta.pointer(p).and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let profile = told("/color/override").or_else(|| told("/color/profile")).unwrap_or("").to_string();
    // the original read in place from the vault's blob store, never copied out
    let r = match crate::blob::source(&vault, hash, &name).await {
        Ok(src) => grading_still_at(&vault, &hex, &name, &src, &profile, at).await,
        Err(e) => Err(format!("{e:#}")),
    };
    clear(&k);
    if let Err(e) = r {
        tracing::warn!("grading still of {hex}: {e}");
        let tries = original.meta.get("grade_still_tries").and_then(|t| t.as_u64()).unwrap_or(0) + 1;
        vault.catalog.describe(hash, &json!({ "meta": { "grade_still_tries": tries } })).await.ok();
    }
}
