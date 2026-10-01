//! The studio's playback through the whole grade, natively (vault-render `player`): in the Grade tab an AVPlayer plays
//! the film's composition — every frame through the render's own chain on Metal: balance, secondaries, grade and
//! looks, finishing, the output — and each frame it makes, playing or stopped, goes to the viewer as a picture made
//! exactly as the Grade still is (a JPEG tagged as Rec.709 video, `Gpu::jpeg_bytes`), over a channel. So the still,
//! the frozen frame and the playing one are the same kind of picture, drawn the same way. Muted: the sound stays the
//! studio's (Web Audio, the clock), the player follows it.

use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use objc2::{AnyThread, MainThreadMarker, rc::Retained};
use objc2_av_foundation::{AVPlayer, AVPlayerItem, AVPlayerItemVideoOutput};
use serde_json::Value;
use tauri::{
    AppHandle,
    ipc::{Channel, InvokeResponseBody},
};

use crate::{Res, err};

/// The studio's player. Made and driven off the main thread: made on the main thread, an AVPlayer with no layer of its
/// own renders no video at all (its composition is never asked for a frame, its output hands out nothing); off it,
/// every frame comes (player_stream_check measured both).
struct Native {
    player: Retained<AVPlayer>,
    /// the pump of the item playing now: stopped when another is loaded
    pump: Arc<AtomicBool>,
}

// SAFETY: AVPlayer is thread-safe for what is done with it here (items, seeks, rate), always under the mutex
unsafe impl Send for Native {}

static NATIVE: std::sync::Mutex<Option<Native>> = std::sync::Mutex::new(None);

/// Where the studio last put the player (seconds, as f64 bits) and whether it plays: set again once an item is ready.
static WANT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static WANT_PLAYING: AtomicBool = AtomicBool::new(false);

fn want(t: f64, playing: bool) {
    WANT.store(t.to_bits(), Ordering::Relaxed);
    WANT_PLAYING.store(playing, Ordering::Relaxed);
}

/// The player where the studio wants it (its last play, stop or sync).
fn apply_want() {
    if let Some(native) = NATIVE.lock().unwrap().as_ref() {
        seek(&native.player, f64::from_bits(WANT.load(Ordering::Relaxed)));
        // SAFETY: a plain AVPlayer call
        unsafe { native.player.setRate(if WANT_PLAYING.load(Ordering::Relaxed) { 1.0 } else { 0.0 }) };
    }
}

/// The item and its video output, handed to the pump's thread (AVFoundation makes the output for a display link's
/// thread; the item's clock is read there too).
struct Output(Retained<AVPlayerItemVideoOutput>, Retained<AVPlayerItem>);
// SAFETY: AVPlayerItemVideoOutput's frame methods are made to be called from another thread than the player's, and
// an item's clock can be read from any
unsafe impl Send for Output {}

impl Output {
    /// Taken apart on the pump's thread (a method, so the closure moves the whole, Send, pair).
    fn parts(self) -> (Retained<AVPlayerItemVideoOutput>, Retained<AVPlayerItem>) {
        (self.0, self.1)
    }
}

/// Where the pump's pictures go: false when nobody takes them any more.
type Sink = Box<dyn FnMut(Vec<u8>, u32, u32) -> bool + Send>;

/// Every frame the item's output has, as it has it (playing: each one; stopped: the one sought to), made into the
/// still's kind of picture and handed to `sink` — until `stop`.
fn pump(out: Output, mut sink: Sink, stop: Arc<AtomicBool>, on_ready: Box<dyn FnOnce() + Send>) {
    let spawned = std::thread::Builder::new().name("playback-frames".into()).spawn(move || {
        let (out, item) = out.parts();
        let gpu = match vault_render::gpu::Gpu::new() {
            Ok(g) => g,
            Err(e) => return tracing::warn!("playback: no GPU for the frames: {e:#}"),
        };
        let (started, mut any, mut told) = (std::time::Instant::now(), false, false);
        let mut on_ready = Some(on_ready);
        while !stop.load(Ordering::Relaxed) {
            // ready to play: sought again to where the studio wants it (a seek before that is lost, and the output
            // then never hands a frame out)
            // SAFETY: an item's status can be read from any thread
            if on_ready.is_some() && unsafe { item.status() } == objc2_av_foundation::AVPlayerItemStatus::ReadyToPlay {
                (on_ready.take().unwrap())();
            }
            objc2::rc::autoreleasepool(|_| {
                // SAFETY: the output's and the item's own calls, from the thread the output's are made for
                unsafe {
                    // the item's own clock: where it is, playing or stopped
                    let t = item.currentTime();
                    if !out.hasNewPixelBufferForItemTime(t) {
                        if !any && !told && started.elapsed().as_secs() >= 3 {
                            told = true;
                            let size = item.presentationSize();
                            let tracks = item.tracks().count();
                            let outputs = item.outputs().count();
                            tracing::warn!(
                                "playback: no frame in 3 s (item status {}, at {:.2} s, {:.0}×{:.0}, {tracks} tracks, {outputs} outputs, composition {})",
                                item.status().0,
                                t.seconds(),
                                size.width,
                                size.height,
                                item.videoComposition().is_some()
                            );
                        }
                        return;
                    }
                    any = true;
                    let mut shown = t;
                    let Some(pb) = out.copyPixelBufferForItemTime_itemTimeForDisplay(t, &mut shown) else { return };
                    // stopped, only the frame the studio stopped on: not the item's first one before its seek
                    if !WANT_PLAYING.load(Ordering::Relaxed) && (shown.seconds() - f64::from_bits(WANT.load(Ordering::Relaxed))).abs() > 1.5 / 30.0 {
                        return;
                    }
                    let (w, h) = (objc2_core_video::CVPixelBufferGetWidth(&pb) as u32, objc2_core_video::CVPixelBufferGetHeight(&pb) as u32);
                    match gpu.jpeg_bytes(&gpu.frame(&pb), w, h) {
                        Ok(bytes) => {
                            if !sink(bytes, w, h) {
                                stop.store(true, Ordering::Relaxed);
                            }
                        }
                        Err(e) => tracing::warn!("playback: a frame: {e:#}"),
                    }
                }
            });
            std::thread::sleep(std::time::Duration::from_millis(4));
        }
    });
    if let Err(e) = spawned {
        tracing::warn!("playback: the frames' thread: {e}");
    }
}

/// The frames to the viewer, over its channel (the first one logged).
fn to_viewer(frames: Channel<InvokeResponseBody>) -> Sink {
    let mut sent = 0u64;
    Box::new(move |bytes, w, h| {
        let size = bytes.len();
        if frames.send(InvokeResponseBody::Raw(bytes)).is_err() {
            return false;
        }
        sent += 1;
        if sent == 1 {
            tracing::info!("playback: frames to the viewer, {w}×{h}, {size} bytes the first");
        }
        true
    })
}

/// A player item of `program`'s composition with a video output for the pump.
///
/// # Safety
/// On the main thread.
unsafe fn item_of(program: Arc<vault_render::player::Program>, mtm: MainThreadMarker) -> anyhow::Result<(Retained<AVPlayerItem>, Retained<AVPlayerItemVideoOutput>)> {
    let (comp, video) = vault_render::player::composition(program)?;
    // SAFETY: AVFoundation objects made on the main thread
    unsafe {
        let item = AVPlayerItem::playerItemWithAsset(&comp, mtm);
        item.setVideoComposition(Some(&video));
        let out = AVPlayerItemVideoOutput::initWithPixelBufferAttributes(AVPlayerItemVideoOutput::alloc(), None);
        item.addOutput(&out);
        Ok((item, out))
    }
}

/// What plays: the timeline (the studio's), the shape it is seen in, per clip the file to play (its proxy, else its
/// original) and that file's colour profile (its journey into ACEScct); `frames`, where its pictures go.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn player_load(
    handle: AppHandle,
    app: tauri::State<'_, crate::App>,
    timeline: Value,
    shape: String,
    files: HashMap<String, String>,
    profiles: HashMap<String, String>,
    width: Option<u32>,
    frames: Channel<InvokeResponseBody>,
) -> Res<()> {
    crate::gate()?;
    let t: vault_render::Timeline = serde_json::from_value(timeline).map_err(err)?;
    let program = program(&app.vault, &t, &shape, &files, &profiles, width).await?;
    let _ = handle;
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<()> {
        // SAFETY: AVFoundation's player works off the main thread (see Native); objc2 asks for the marker only to be
        // careful. The output's frames are read on the pump's thread.
        unsafe {
            let mtm = MainThreadMarker::new_unchecked();
            let (item, out) = item_of(program, mtm)?;
            let stop = Arc::new(AtomicBool::new(false));
            {
                let mut n = NATIVE.lock().unwrap();
                match n.as_mut() {
                    Some(native) => {
                        native.pump.store(true, Ordering::Relaxed);
                        native.player.replaceCurrentItemWithPlayerItem(Some(&item));
                        native.pump = stop.clone();
                    }
                    None => {
                        let player = AVPlayer::playerWithPlayerItem(Some(&item), mtm);
                        player.setMuted(true);
                        *n = Some(Native { player, pump: stop.clone() });
                    }
                }
            }
            pump(Output(out, item.clone()), to_viewer(frames), stop, Box::new(apply_want));
        }
        Ok(())
    })
    .await
    .map_err(err)?
    .map_err(|e| format!("playback: {e:#}"))
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

/// Per picture clip, the file the Grade tab plays (its proxy, as Picture: Proxy does; else, or with `originals`, the
/// original) and that file's profile.
async fn files_for(vault: &std::sync::Arc<vault_core::Vault>, tl: &vault_render::Timeline, originals: bool) -> Res<(HashMap<String, String>, HashMap<String, String>)> {
    let all = vault.catalog.list().await.map_err(|e| format!("{e:#}"))?;
    let (mut files, mut profiles) = (HashMap::new(), HashMap::new());
    for c in tl.clips.iter().filter(|c| c.track == "V1" && !c.is_world()) {
        let Some(h) = &c.hash else { continue };
        let proxy = (!originals).then(|| all.iter().find(|m| m.kind == "video" && m.meta.get("role").and_then(Value::as_str) == Some("proxy") && m.meta.get("proxy_of").and_then(Value::as_str) == Some(h.as_str()))).flatten();
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
    Ok((files, profiles))
}


/// The Grade tab's playback, run as the studio runs it but headless, its pictures counted: the same item, output and
/// pump (`item_of`, `pump`), made on the main thread; stopped on `t` at once as the studio does (the frames the pump
/// hands on while stopped), then played two seconds (how many a second). The frozen picture as it would reach the
/// viewer.
pub(crate) async fn stream_check(handle: &AppHandle, vault: &std::sync::Arc<vault_core::Vault>, timeline: Value, t: f64, originals: bool) -> Res<(Value, Option<Vec<u8>>)> {
    let tl: vault_render::Timeline = serde_json::from_value(timeline).map_err(err)?;
    let (files, profiles) = files_for(vault, &tl, originals).await?;
    let program = program(vault, &tl, "16:9", &files, &profiles, Some(1600)).await?;
    let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let first: Arc<std::sync::Mutex<Option<Vec<u8>>>> = Arc::default();
    let (c, f) = (count.clone(), first.clone());
    let stopped_at = Arc::new(std::sync::Mutex::new(0usize));
    let stopped_at2 = stopped_at.clone();
    let (last, frozen) = (first.clone(), Arc::new(std::sync::Mutex::new(None::<Vec<u8>>)));
    let frozen2 = frozen.clone();
    let counted = count.clone();
    let sink: Sink = Box::new(move |bytes, _, _| {
        c.fetch_add(1, Ordering::Relaxed);
        *f.lock().unwrap() = Some(bytes);
        true
    });
    // made and driven off the main thread, as `playback_frames` does (which gets its frames)
    let _ = handle;
    let r = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<()> {
        // SAFETY: AVFoundation's player works off the main thread; objc2 asks for the marker only to be careful
        unsafe {
            let mtm = MainThreadMarker::new_unchecked();
            let (item, out) = item_of(program, mtm)?;
            let player = AVPlayer::playerWithPlayerItem(Some(&item), mtm);
            player.setMuted(true);
            let stop = Arc::new(AtomicBool::new(false));
            pump(Output(out, item.clone()), sink, stop.clone(), Box::new(|| {}));
            let ready = std::time::Instant::now();
            while item.status() != objc2_av_foundation::AVPlayerItemStatus::ReadyToPlay && ready.elapsed().as_secs_f64() < 5.0 {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            want(t, false);
            player.setRate(0.0);
            seek(&player, t);
            std::thread::sleep(std::time::Duration::from_secs(2));
            let stopped = counted.load(Ordering::Relaxed);
            // the picture stopped on t: the one the viewer shows frozen
            *frozen.lock().unwrap() = last.lock().unwrap().clone();
            want(t, true);
            player.setRate(1.0);
            std::thread::sleep(std::time::Duration::from_secs(2));
            want(t, false);
            player.setRate(0.0);
            stop.store(true, Ordering::Relaxed);
            *stopped_at.lock().unwrap() = stopped;
        }
        Ok(())
    })
    .await
    .map_err(err)?;
    let stopped = *stopped_at2.lock().unwrap();
    let played = count.load(Ordering::Relaxed) - stopped;
    let made = std::sync::Mutex::new(r.err().map(|e| format!("{e:#}")));
    let error = made.lock().unwrap().clone();
    let pic = frozen2.lock().unwrap().take();
    Ok((serde_json::json!({ "t": t, "error": error, "frames_while_stopped": stopped, "played_fps": played as f64 / 2.0 }), pic))
}

/// What the Grade tab's playback shows, checked without a screen: the timeline's composition as the player plays it
/// (each picture clip from its proxy, else its original — as the studio chooses), `n` frames from `t` read through it
/// one after another as AVFoundation hands them to the player, each timed; then the composition played by an AVPlayer
/// for two seconds and the frames it hands out counted (30 a second is real time). The first frame as a JPEG (tagged
/// Rec.709, as the Grade viewer's stills are).
pub(crate) async fn playback_frames(vault: &std::sync::Arc<vault_core::Vault>, timeline: Value, t: f64, n: usize, shape: Option<String>, originals: bool) -> Res<(Value, Vec<u8>)> {
    let tl: vault_render::Timeline = serde_json::from_value(timeline).map_err(err)?;
    let (files, profiles) = files_for(vault, &tl, originals).await?;
    let shape = shape.unwrap_or_else(|| "16:9".into());
    let program = program(vault, &tl, &shape, &files, &profiles, Some(1600)).await?;
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
        let mut tags: Option<Value> = None;
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
                    let pb = out.copyPixelBufferForItemTime_itemTimeForDisplay(now, std::ptr::null_mut());
                    if start.elapsed().as_secs_f64() >= settle {
                        delivered += 1;
                    }
                    // what the player's layer is handed: the frame's colour tags, the colour space they name
                    if tags.is_none()
                        && let Some(pb) = pb
                    {
                        let d = objc2_core_video::CVBuffer::attachments(&pb, objc2_core_video::CVAttachmentMode::ShouldPropagate);
                        let space = d.as_ref().and_then(|d| objc2_core_video::CVImageBufferCreateColorSpaceFromAttachments(d));
                        let name = space.as_ref().and_then(|s| objc2_core_graphics::CGColorSpace::name(Some(s))).map(|n| n.to_string());
                        let fmt = objc2_core_video::CVPixelBufferGetPixelFormatType(&pb);
                        tags = Some(serde_json::json!({ "attachments": d.map(|d| format!("{d:?}")), "space": name, "pixel_format": String::from_utf8_lossy(&fmt.to_be_bytes()).to_string() }));
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(3));
            }
            player.setRate(0.0);
            player.replaceCurrentItemWithPlayerItem(None);
            (delivered as f64 / window, tags)
        };
        let (played, tags) = played;
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
                "frame_tags": tags, "files": used }),
            jpg,
        ))
    })
    .await
    .map_err(err)?
    .map_err(|e| format!("{e:#}"))
}

fn seek(player: &AVPlayer, t: f64) {
    let zero = vault_render::av::cmtime(0.0);
    // SAFETY: a plain AVPlayer call on the main thread
    unsafe { player.seekToTime_toleranceBefore_toleranceAfter(vault_render::av::cmtime(t.max(0.0)), zero, zero) }
}

/// Play from `time` (the studio's clock).
#[tauri::command]
pub fn player_play(time: f64) -> Res<()> {
    crate::gate()?;
    want(time, true);
    apply_want();
    Ok(())
}

/// Stop at `time`.
#[tauri::command]
pub fn player_pause(time: f64) -> Res<()> {
    crate::gate()?;
    want(time, false);
    apply_want();
    Ok(())
}

/// Keep up with the studio's clock: put the picture back on `time` when it has drifted more than two frames from it.
#[tauri::command]
pub fn player_sync(time: f64) -> Res<()> {
    crate::gate()?;
    WANT.store(time.to_bits(), Ordering::Relaxed);
    if let Some(native) = NATIVE.lock().unwrap().as_ref() {
        // SAFETY: plain AVPlayer calls (see Native)
        let now = unsafe { native.player.currentTime().seconds() };
        if (now - time).abs() > 2.0 / 30.0 {
            seek(&native.player, time);
        }
    }
    Ok(())
}
