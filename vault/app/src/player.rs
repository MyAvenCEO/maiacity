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
    let vault = app.vault.clone();
    let t: vault_render::Timeline = serde_json::from_value(timeline).map_err(err)?;
    let s = vault_render::Shape::of(&shape).or_else(|| vault_render::Shape::of("16:9")).ok_or("no such shape")?;
    let w = width.unwrap_or(1280).clamp(320, 1920);
    let h = ((w as f64 * s.render_size().1 as f64 / s.render_size().0 as f64).round() as u32).max(2) & !1;
    let mut clips = Vec::new();
    let mut v1: Vec<&vault_render::Clip> = t.clips.iter().filter(|c| c.track == "V1" && c.hash.is_some() && !c.is_world()).collect();
    v1.sort_by(|a, b| a.start.total_cmp(&b.start));
    for c in v1 {
        let Some(file) = files.get(&c.id) else { continue };
        let hash: iroh_blobs::Hash = file.parse().map_err(err)?;
        let source = crate::blob::source(&vault, hash, &format!("{}.mov", c.id)).await.map_err(|e| format!("{e:#}"))?;
        let profile = profiles.get(&c.id).map(String::as_str).unwrap_or("rec709");
        let journey = vault_media::cst::journey(profile).or_else(|| vault_media::cst::journey("rec709")).ok_or("no journey")?.kernel_args();
        let looks: Vec<Value> = t.looks_for(c).iter().filter_map(|l| serde_json::to_value(l).ok()).collect();
        let grades: Vec<Value> = c.grade.iter().cloned().collect();
        let looks = if looks.is_empty() && grades.is_empty() {
            None
        } else {
            Some(vault_render::Lut3d::from_rgb("looks", 33, crate::proxies::chain_cube(&vault, None, grades, looks, 33).await?).map_err(err)?)
        };
        clips.push(vault_render::player::PlayClip { clip: c.clone(), source, journey, looks });
    }
    let program = Arc::new(vault_render::player::Program { clips, finish: t.finish(), aspect: s.aspect.to_string(), width: w, height: h, output: crate::render::odt().clone() });
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
