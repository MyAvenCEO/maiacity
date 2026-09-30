//! The studio's playback through the whole grade, natively (vault-render `player`): while the Grade tab plays, an
//! AVPlayer plays the film's composition — every frame through the render's own chain on Metal, secondaries and
//! finishing too — in a layer laid over the viewer's picture (the webview says where); paused, the layer goes and the
//! webview shows the Mac's still. Muted: the sound stays the studio's (Web Audio, the clock), the player follows it.

use std::{cell::RefCell, collections::HashMap, sync::Arc};

use objc2::{MainThreadMarker, msg_send, rc::Retained, runtime::AnyObject};
use objc2_av_foundation::{AVPlayer, AVPlayerItem, AVPlayerLayer};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::{Res, err};

struct Native {
    player: Retained<AVPlayer>,
    view: Retained<AnyObject>,
    webview: *mut AnyObject,
}

thread_local! {
    /// The player and its view: made, moved and let go on the main thread only.
    static NATIVE: RefCell<Option<Native>> = const { RefCell::new(None) };
}

/// The studio's WKWebView (its address): the picture is laid over it.
static WEBVIEW: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

fn on_main(handle: &AppHandle, f: impl FnOnce() + Send + 'static) -> Res<()> {
    handle.run_on_main_thread(f).map_err(err)
}

/// What plays: the timeline (the studio's), the shape it is seen in, and per clip the file to play (its proxy, else its
/// original) and that file's colour profile (its journey into ACEScct).
#[tauri::command]
pub async fn player_load(
    handle: AppHandle,
    app: tauri::State<'_, crate::App>,
    timeline: Value,
    shape: String,
    files: HashMap<String, String>,
    profiles: HashMap<String, String>,
    width: Option<u32>,
) -> Res<()> {
    crate::gate()?;
    let t: vault_render::Timeline = serde_json::from_value(timeline).map_err(err)?;
    let program = program(&app.vault, &t, &shape, &files, &profiles, width).await?;
    // the webview's address first (wry hands it over on the main thread, before what is queued after it)
    let window = handle.get_webview_window("main").ok_or("no main window")?;
    window.with_webview(|w| WEBVIEW.store(w.inner() as usize, std::sync::atomic::Ordering::SeqCst)).map_err(err)?;
    on_main(&handle, move || {
        let made = (|| -> anyhow::Result<()> {
            let (comp, video) = vault_render::player::composition(program)?;
            let mtm = MainThreadMarker::new().ok_or_else(|| anyhow::anyhow!("not on the main thread"))?;
            // SAFETY: AVFoundation objects made and kept on the main thread
            unsafe {
                let item = AVPlayerItem::playerItemWithAsset(&comp, mtm);
                item.setVideoComposition(Some(&video));
                NATIVE.with(|n| -> anyhow::Result<()> {
                    let mut n = n.borrow_mut();
                    if let Some(native) = n.as_ref() {
                        native.player.replaceCurrentItemWithPlayerItem(Some(&item));
                        return Ok(());
                    }
                    let webview = WEBVIEW.load(std::sync::atomic::Ordering::SeqCst) as *mut AnyObject;
                    if webview.is_null() {
                        anyhow::bail!("no webview to lay the picture over");
                    }
                    let player = AVPlayer::playerWithPlayerItem(Some(&item), mtm);
                    player.setMuted(true);
                    let layer = AVPlayerLayer::playerLayerWithPlayer(Some(&player));
                    let cls = objc2::runtime::AnyClass::get(c"NSView").ok_or_else(|| anyhow::anyhow!("no NSView"))?;
                    let view: *mut AnyObject = msg_send![cls, alloc];
                    let view: *mut AnyObject = msg_send![view, initWithFrame: CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(1.0, 1.0))];
                    let view = Retained::from_raw(view).ok_or_else(|| anyhow::anyhow!("no view"))?;
                    let _: () = msg_send![&*view, setLayer: &*layer];
                    let _: () = msg_send![&*view, setWantsLayer: true];
                    let _: () = msg_send![&*view, setHidden: true];
                    let parent: *mut AnyObject = msg_send![webview, superview];
                    // NSWindowAbove: over the webview, only where the picture is
                    let _: () = msg_send![parent, addSubview: &*view, positioned: 1isize, relativeTo: webview];
                    *n = Some(Native { player, view, webview });
                    Ok(())
                })?;
            }
            Ok(())
        })();
        if let Err(e) = made {
            tracing::warn!("playback: {e:#}");
        }
    })
}

/// The film as it plays: every picture clip on V1 with its file (`files`: its proxy, else its original) and that
/// file's journey (`profiles`), its grade and looks as one cube, the film's finishing, at `width` (320…1920) in `shape`.
pub(crate) async fn program(
    vault: &std::sync::Arc<vault_core::Vault>,
    t: &vault_render::Timeline,
    shape: &str,
    files: &HashMap<String, String>,
    profiles: &HashMap<String, String>,
    width: Option<u32>,
) -> Res<Arc<vault_render::player::Program>> {
    let s = vault_render::Shape::of(shape).or_else(|| vault_render::Shape::of("16:9")).ok_or("no such shape")?;
    let w = width.unwrap_or(1280).clamp(320, 1920);
    let h = ((w as f64 * s.render_size().1 as f64 / s.render_size().0 as f64).round() as u32).max(2) & !1;
    let mut clips = Vec::new();
    let mut v1: Vec<&vault_render::Clip> = t.clips.iter().filter(|c| c.track == "V1" && c.hash.is_some() && !c.is_world()).collect();
    v1.sort_by(|a, b| a.start.total_cmp(&b.start));
    for c in v1 {
        let Some(file) = files.get(&c.id) else { continue };
        let hash: iroh_blobs::Hash = file.parse().map_err(err)?;
        let source = crate::blob::source(vault, hash, &format!("{}.mov", c.id)).await.map_err(|e| format!("{e:#}"))?;
        let profile = profiles.get(&c.id).map(String::as_str).unwrap_or("rec709");
        let journey = vault_media::cst::journey(profile).or_else(|| vault_media::cst::journey("rec709")).ok_or("no journey")?.kernel_args();
        let looks: Vec<Value> = t.looks_for(c).iter().filter_map(|l| serde_json::to_value(l).ok()).collect();
        let grades: Vec<Value> = c.grade.iter().cloned().collect();
        let looks = if looks.is_empty() && grades.is_empty() {
            None
        } else {
            Some(vault_render::Lut3d::from_rgb("looks", 33, crate::proxies::chain_cube(vault, None, grades, looks, 33).await?).map_err(err)?)
        };
        clips.push(vault_render::player::PlayClip { clip: c.clone(), source, journey, looks });
    }
    Ok(Arc::new(vault_render::player::Program { clips, finish: t.finish(), aspect: s.aspect.to_string(), width: w, height: h, output: crate::render::odt().clone() }))
}

/// What the Grade tab's playback shows, checked without a screen: the timeline's composition as the player plays it
/// (each picture clip from its proxy, else its original — as the studio chooses), `n` frames from `t` read through it
/// one after another as AVFoundation hands them to the player, each timed; then the composition played by an AVPlayer
/// for two seconds and the frames it hands out counted (30 a second is real time). The first frame as a JPEG (tagged
/// Rec.709, as the Grade viewer's stills are).
pub(crate) async fn playback_frames(vault: &std::sync::Arc<vault_core::Vault>, timeline: Value, t: f64, n: usize, shape: Option<String>) -> Res<(Value, Vec<u8>)> {
    let tl: vault_render::Timeline = serde_json::from_value(timeline).map_err(err)?;
    let all = vault.catalog.list().await.map_err(|e| format!("{e:#}"))?;
    let (mut files, mut profiles) = (HashMap::new(), HashMap::new());
    for c in tl.clips.iter().filter(|c| c.track == "V1" && !c.is_world()) {
        let Some(h) = &c.hash else { continue };
        let proxy = all.iter().find(|m| m.kind == "video" && m.meta.get("role").and_then(Value::as_str) == Some("proxy") && m.meta.get("proxy_of").and_then(Value::as_str) == Some(h.as_str()));
        match proxy {
            Some(p) => {
                files.insert(c.id.clone(), p.hash.clone());
                profiles.insert(c.id.clone(), "acescct".to_string());
            }
            None => {
                let m = all.iter().find(|m| &m.hash == h);
                files.insert(c.id.clone(), h.clone());
                profiles.insert(c.id.clone(), m.and_then(|m| m.meta.pointer("/color/profile")).and_then(Value::as_str).unwrap_or("rec709").to_string());
            }
        }
    }
    let shape = shape.unwrap_or_else(|| "16:9".into());
    let program = program(vault, &tl, &shape, &files, &profiles, Some(1280)).await?;
    let used: Value = serde_json::json!(files);
    let n = n.clamp(1, 60);
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<(Value, Vec<u8>)> {
        let (comp, video) = vault_render::player::composition(program)?;
        let gpu = vault_render::gpu::Gpu::new()?;
        let mut times = Vec::new();
        let mut first = None;
        // SAFETY: AVFoundation objects we made, used from this thread
        unsafe {
            let g = objc2_av_foundation::AVAssetImageGenerator::assetImageGeneratorWithAsset(&comp);
            g.setVideoComposition(Some(&video));
            g.setRequestedTimeToleranceBefore(vault_render::av::cmtime(0.0));
            g.setRequestedTimeToleranceAfter(vault_render::av::cmtime(0.0));
            for i in 0..n {
                let at = t + i as f64 / vault_render::timeline::FPS as f64;
                let t0 = std::time::Instant::now();
                #[allow(deprecated)]
                let cg = g.copyCGImageAtTime_actualTime_error(vault_render::av::cmtime(at), std::ptr::null_mut()).map_err(|e| anyhow::anyhow!("no frame at {at:.2} s: {e:?}"))?;
                times.push(t0.elapsed().as_secs_f64() * 1000.0);
                if first.is_none() {
                    first = Some(cg);
                }
            }
        }
        // real time, the way the Grade tab plays it: an AVPlayer (no screen) plays the composition from t for two
        // seconds, and the frames it hands out are counted — what it cannot make in time, it drops
        // SAFETY: AVPlayer and its item made and played on this thread (AVFoundation allows it off the main thread;
        // objc2 asks for the marker only to be careful), let go before it returns
        let played = unsafe {
            let mtm = MainThreadMarker::new_unchecked();
            let item = AVPlayerItem::playerItemWithAsset(&comp, mtm);
            item.setVideoComposition(Some(&video));
            let out = objc2_av_foundation::AVPlayerItemVideoOutput::initWithPixelBufferAttributes(<objc2_av_foundation::AVPlayerItemVideoOutput as objc2::AnyThread>::alloc(), None);
            item.addOutput(&out);
            let player = AVPlayer::playerWithPlayerItem(Some(&item), mtm);
            player.setMuted(true);
            let ready = std::time::Instant::now();
            while item.status() != objc2_av_foundation::AVPlayerItemStatus::ReadyToPlay && ready.elapsed().as_secs_f64() < 5.0 {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            let zero = vault_render::av::cmtime(0.0);
            player.seekToTime_toleranceBefore_toleranceAfter(vault_render::av::cmtime(t), zero, zero);
            std::thread::sleep(std::time::Duration::from_millis(300));
            player.setRate(1.0);
            let start = std::time::Instant::now();
            let (settle, window) = (0.3, 2.0);
            let mut delivered = 0usize;
            while start.elapsed().as_secs_f64() < settle + window {
                let now = item.currentTime();
                if out.hasNewPixelBufferForItemTime(now) {
                    let _ = out.copyPixelBufferForItemTime_itemTimeForDisplay(now, std::ptr::null_mut());
                    if start.elapsed().as_secs_f64() >= settle {
                        delivered += 1;
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(3));
            }
            player.setRate(0.0);
            player.replaceCurrentItemWithPlayerItem(None);
            delivered as f64 / window
        };
        let cg = first.ok_or_else(|| anyhow::anyhow!("no frame"))?;
        let img = gpu.cg_image(&cg);
        let e = vault_render::gpu::Extent::ext(&*img);
        let jpg = gpu.jpeg_bytes(&img, e.size.width as u32, e.size.height as u32)?;
        // the first frame pays for the decoder's start and the kernels' compiling: the rest is what playing costs
        let steady: Vec<f64> = times.iter().skip(1).copied().collect();
        let mean = if steady.is_empty() { times[0] } else { steady.iter().sum::<f64>() / steady.len() as f64 };
        let worst = steady.iter().copied().fold(0.0, f64::max);
        let fps = vault_render::timeline::FPS as f64;
        Ok((
            serde_json::json!({ "t": t, "played_fps": (played * 10.0).round() / 10.0, "real_time": played >= fps * 0.95,
                "grabbed": { "frames": n, "first_ms": (times[0] * 10.0).round() / 10.0, "ms_per_frame": (mean * 10.0).round() / 10.0, "worst_ms": (worst * 10.0).round() / 10.0, "note": "each frame sought and decoded on its own: slower than playing" },
                "files": used }),
            jpg,
        ))
    })
    .await
    .map_err(err)?
    .map_err(|e| format!("{e:#}"))
}

/// Where the picture is, in the webview's own pixels from its top left ([x, y, w, h]); none: hide it.
#[tauri::command]
pub fn player_view(handle: AppHandle, rect: Option<[f64; 4]>) -> Res<()> {
    crate::gate()?;
    on_main(&handle, move || {
        NATIVE.with(|n| {
            let n = n.borrow();
            let Some(native) = n.as_ref() else { return };
            // SAFETY: AppKit calls on the main thread, on views that live as long as the window
            unsafe {
                match rect {
                    None => {
                        let _: () = msg_send![&*native.view, setHidden: true];
                    }
                    Some([x, y, w, h]) => {
                        let web: CGRect = msg_send![native.webview, frame];
                        let parent: *mut AnyObject = msg_send![native.webview, superview];
                        let flipped: bool = msg_send![parent, isFlipped];
                        let oy = if flipped { web.origin.y + y } else { web.origin.y + web.size.height - y - h };
                        let frame = CGRect::new(CGPoint::new(web.origin.x + x, oy), CGSize::new(w, h));
                        let _: () = msg_send![&*native.view, setFrame: frame];
                        let _: () = msg_send![&*native.view, setHidden: false];
                    }
                }
            }
        })
    })
}

fn seek(player: &AVPlayer, t: f64) {
    let zero = vault_render::av::cmtime(0.0);
    // SAFETY: a plain AVPlayer call on the main thread
    unsafe { player.seekToTime_toleranceBefore_toleranceAfter(vault_render::av::cmtime(t.max(0.0)), zero, zero) }
}

/// Play from `time` (the studio's clock).
#[tauri::command]
pub fn player_play(handle: AppHandle, time: f64) -> Res<()> {
    crate::gate()?;
    on_main(&handle, move || {
        NATIVE.with(|n| {
            if let Some(native) = n.borrow().as_ref() {
                seek(&native.player, time);
                // SAFETY: a plain AVPlayer call on the main thread
                unsafe { native.player.setRate(1.0) };
            }
        })
    })
}

/// Stop at `time`.
#[tauri::command]
pub fn player_pause(handle: AppHandle, time: f64) -> Res<()> {
    crate::gate()?;
    on_main(&handle, move || {
        NATIVE.with(|n| {
            if let Some(native) = n.borrow().as_ref() {
                // SAFETY: plain AVPlayer calls on the main thread
                unsafe { native.player.setRate(0.0) };
                seek(&native.player, time);
            }
        })
    })
}

/// Keep up with the studio's clock: put the picture back on `time` when it has drifted more than two frames from it.
#[tauri::command]
pub fn player_sync(handle: AppHandle, time: f64) -> Res<()> {
    crate::gate()?;
    on_main(&handle, move || {
        NATIVE.with(|n| {
            if let Some(native) = n.borrow().as_ref() {
                // SAFETY: plain AVPlayer calls on the main thread
                let now = unsafe { native.player.currentTime().seconds() };
                if (now - time).abs() > 2.0 / 30.0 {
                    seek(&native.player, time);
                }
            }
        })
    })
}
