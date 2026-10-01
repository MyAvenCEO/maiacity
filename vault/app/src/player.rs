//! The studio's playback through the whole grade, natively (vault-render `player`): in the Grade tab an AVPlayer plays
//! the film's composition — every frame through the render's own chain on Metal: balance, secondaries, grade and
//! looks, finishing, the output — and each frame it makes, playing or stopped, goes to the viewer as a picture made
//! exactly as the Grade still is (a JPEG tagged as Rec.709 video, `Gpu::jpeg_bytes`), over a channel. So the still,
//! the frozen frame and the playing one are the same kind of picture, drawn the same way. Muted: the sound stays the
//! studio's (Web Audio, the clock), the player follows it.
//!
//! How it is driven (`Driver`): its seeks are chased — one at a time, the newest target kept while one is under way
//! and sought the moment it lands (Apple's QA1820) — so a drag shows frames all the way, where a seek for every move
//! cancelled the one before it and showed nothing until the hand stopped. Playing, it keeps to the studio's clock by
//! its rate (up to 15 % faster or slower), and seeks only when it is half a second off, aimed ahead by what a seek
//! takes: a seek costs more than two frames, so seeking whenever it was two frames off kept it seeking — and the
//! picture stuttered or stood still.

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Instant,
};

use block2::RcBlock;
use objc2::{AnyThread, MainThreadMarker, rc::Retained, runtime::Bool};
use objc2_av_foundation::{AVPlayer, AVPlayerItem, AVPlayerItemStatus, AVPlayerItemVideoOutput, AVPlayerStatus};
use serde_json::Value;
use tauri::ipc::{Channel, InvokeResponseBody};
use vault_render::av::cmtime;

use crate::{Res, err};

const FRAME: f64 = 1.0 / vault_render::timeline::FPS as f64;

// ── the player's own thread ─────────────────────────────────────────────────────────────────────────────────────

/// Work for the player's thread.
type Job = Box<dyn FnOnce() + Send>;

/// The player's own thread: made once, never ended, and never running a run loop. Every AVPlayer call is made there —
/// the player and its items made, seeks, rates. Made on a pool thread that was handed back at once, the player made a
/// second or two of frames and then never another (its clock ran on, nothing asked its composition for a picture);
/// made on the main thread, or on this one with its run loop turning, none at all; made and driven on one thread that
/// lives and only waits for work, every frame comes.
static PLAYER_THREAD: std::sync::OnceLock<std::sync::mpsc::Sender<Job>> = std::sync::OnceLock::new();

thread_local! {
    static ON_PLAYER: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Do `job` on the player's thread (at once when already there), not waiting for it.
fn post(job: impl FnOnce() + Send + 'static) {
    if ON_PLAYER.with(|c| c.get()) {
        return job();
    }
    let tx = PLAYER_THREAD.get_or_init(|| {
        let (tx, rx) = std::sync::mpsc::channel::<Job>();
        std::thread::Builder::new()
            .name("player".into())
            .spawn(move || {
                ON_PLAYER.with(|c| c.set(true));
                // never a run loop here: with one turning (as on the main thread) the player makes no frame at all
                while let Ok(job) = rx.recv() {
                    objc2::rc::autoreleasepool(|_| {
                        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(job)).is_err() {
                            tracing::warn!("playback: a job on the player's thread panicked");
                        }
                    });
                }
            })
            .expect("the player's thread");
        tx
    });
    let _ = tx.send(Box::new(job));
}

/// Do `f` on the player's thread and wait for what it gives back.
fn on_player<R: Send + 'static>(f: impl FnOnce() -> R + Send + 'static) -> Option<R> {
    if ON_PLAYER.with(|c| c.get()) {
        return Some(f());
    }
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    post(move || {
        let _ = tx.send(f());
    });
    rx.recv().ok()
}

/// How a player is driven: where the studio wants it, and its seeks.
#[derive(Default)]
struct Drive {
    /// where the studio last put it, and whether it plays
    want: f64,
    playing: bool,
    /// the seek under way (since when, its number), and the newest target asked for meanwhile
    busy: Option<Instant>,
    serial: u64,
    next: Option<f64>,
    /// the target of the seek under way or made last, and the one before: the frames a stopped player shows
    aim: f64,
    before: f64,
    /// what a seek takes lately, seconds: a play, or a seek while playing, aims that much ahead of the clock
    latency: f64,
    /// seeks made (the check counts them)
    seeks: u64,
}

/// A player and its driving. Made and driven off the main thread: made on the main thread, an AVPlayer with no layer of
/// its own renders no video at all (its composition is never asked for a frame, its output hands out nothing); off it,
/// every frame comes (player_stream_check measured both).
struct Driver {
    player: Retained<AVPlayer>,
    drive: Mutex<Drive>,
}

// SAFETY: AVPlayer is thread-safe for what is done with it here (items, seeks, rate, its clock); the driving is under
// its own mutex, never held across a call into AVFoundation (a seek may call the one before it back at once)
unsafe impl Send for Driver {}
unsafe impl Sync for Driver {}

impl Driver {
    fn new(player: Retained<AVPlayer>) -> Arc<Self> {
        Arc::new(Self { player, drive: Mutex::new(Drive { latency: 0.15, ..Default::default() }) })
    }

    /// On the player's thread (see `post`): play, stop, keep to the clock, the item ready.
    fn play(self: &Arc<Self>, t: f64) {
        let me = self.clone();
        post(move || me.play_here(t));
    }
    fn pause(self: &Arc<Self>, t: f64) {
        let me = self.clone();
        post(move || me.pause_here(t));
    }
    fn sync(self: &Arc<Self>, t: f64) {
        let me = self.clone();
        post(move || me.sync_here(t));
    }
    fn ready(self: &Arc<Self>) {
        let me = self.clone();
        post(move || me.ready_here());
    }

    /// Nothing under way any more (a new item; a play): a seek made before lands unheeded.
    fn forget(&self) {
        let mut d = self.drive.lock().unwrap();
        d.serial += 1;
        d.busy = None;
        d.next = None;
        d.aim = d.want;
        d.before = d.want;
    }

    /// Seek to `t`, chased: while one is under way only the newest target is kept, sought as soon as that one lands (a
    /// seek with no word for a second is given up).
    fn seek_here(self: &Arc<Self>, t: f64) {
        let t = t.max(0.0);
        let serial = {
            let mut d = self.drive.lock().unwrap();
            if d.busy.is_some_and(|b| b.elapsed().as_secs_f64() < 1.0) {
                d.next = Some(t);
                return;
            }
            d.serial += 1;
            d.seeks += 1;
            d.busy = Some(Instant::now());
            d.next = None;
            d.before = d.aim;
            d.aim = t;
            d.serial
        };
        let (me, started) = (self.clone(), Instant::now());
        let landed = RcBlock::new(move |finished: Bool| {
            let next = {
                let mut d = me.drive.lock().unwrap();
                if d.serial != serial {
                    return;
                }
                if finished.as_bool() {
                    d.latency = d.latency * 0.7 + started.elapsed().as_secs_f64().min(1.0) * 0.3;
                }
                d.busy = None;
                d.next.take()
            };
            if let Some(n) = next {
                let me = me.clone();
                post(move || me.seek_here(n));
            }
        });
        let zero = cmtime(0.0);
        // SAFETY: a plain AVPlayer call (see Driver); its completion may come on any thread
        unsafe { self.player.seekToTime_toleranceBefore_toleranceAfter_completionHandler(cmtime(t), zero, zero, &landed) };
    }

    /// Play from `t`, the studio's clock: aimed ahead by what a seek takes, so it starts where the clock will be.
    fn play_here(self: &Arc<Self>, t: f64) {
        let ahead = {
            let mut d = self.drive.lock().unwrap();
            d.want = t;
            d.playing = true;
            d.latency
        };
        self.forget();
        self.seek_here(t + ahead);
        // SAFETY: a plain AVPlayer call
        unsafe { self.player.setRate(1.0) };
    }

    /// Stop on `t` (and, stopped, every move of the playhead: a scrub).
    fn pause_here(self: &Arc<Self>, t: f64) {
        {
            let mut d = self.drive.lock().unwrap();
            d.want = t;
            d.playing = false;
        }
        // SAFETY: a plain AVPlayer call
        unsafe { self.player.setRate(0.0) };
        self.seek_here(t);
    }

    /// Playing, keep to the studio's clock `t`: within half a second by the rate (the gap closed in about a second, at
    /// most 15 % faster or slower), beyond it by a seek aimed ahead.
    fn sync_here(self: &Arc<Self>, t: f64) {
        let (playing, ahead, busy) = {
            let mut d = self.drive.lock().unwrap();
            d.want = t;
            (d.playing, d.latency, d.busy.is_some())
        };
        if !playing || busy {
            return;
        }
        // SAFETY: plain AVPlayer calls
        unsafe {
            let gap = t - self.player.currentTime().seconds();
            if gap.abs() > 0.5 {
                self.seek_here(t + ahead);
                self.player.setRate(1.0);
            } else {
                let rate = if gap.abs() < FRAME / 2.0 { 1.0 } else { 1.0 + gap.clamp(-0.15, 0.15) };
                self.player.setRate(rate as f32);
            }
        }
    }

    /// The item is ready: put where the studio wants it (a seek made before that is lost, and the output then never
    /// hands a frame out).
    fn ready_here(self: &Arc<Self>) {
        let (t, playing) = {
            let d = self.drive.lock().unwrap();
            (d.want, d.playing)
        };
        self.forget();
        if playing { self.play_here(t) } else { self.pause_here(t) }
    }

    /// Whether a frame at `t` (the item's time) is one to show: playing, each; stopped, one at a target sought — not
    /// the item's first frame before its seek.
    fn shows(&self, t: f64) -> bool {
        let d = self.drive.lock().unwrap();
        d.playing || [d.aim, d.before, d.want].iter().any(|a| (t - a).abs() <= 1.5 * FRAME)
    }

    /// Where the player is: its clock, rate, whether it plays or waits and why (for the log).
    fn state(&self) -> String {
        // SAFETY: plain AVPlayer getters
        unsafe {
            let p = &self.player;
            let why = p.reasonForWaitingToPlay().map(|r| r.to_string()).unwrap_or_default();
            format!("at {:.2} s, rate {}, control {} {why}", p.currentTime().seconds(), p.rate(), p.timeControlStatus().0)
        }
    }
}

/// The studio's player: its driver, the item playing now and its pump (stopped when another is loaded).
struct Native {
    driver: Arc<Driver>,
    item: Retained<AVPlayerItem>,
    pump: Arc<AtomicBool>,
}

// SAFETY: the item is only read (its status, clock) and replaced under the mutex, as the driver's player is
unsafe impl Send for Native {}

/// What the studio loaded last (`player_stream_check` can play exactly that).
static LAST_LOAD: Mutex<Option<Value>> = Mutex::new(None);

/// Pictures sent to the viewer, all told (`player_state` watches it move).
static SENT: AtomicU64 = AtomicU64::new(0);
/// The pump's rounds, the frames it copied, and the step it is on (0 waiting, 1 asking the output, 2 copying, 3 making
/// the picture, 4 handing it on) — what `player_state` shows of it.
static PUMP_ROUNDS: AtomicU64 = AtomicU64::new(0);
static PUMP_COPIED: AtomicU64 = AtomicU64::new(0);
static PUMP_STEP: AtomicU64 = AtomicU64::new(0);

static NATIVE: Mutex<Option<Native>> = Mutex::new(None);

/// Each load's number: a load overtaken by a newer one (the grade changed again while it was being made) is let go.
static LOADS: AtomicU64 = AtomicU64::new(0);

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

/// Where the pump's pictures go (the picture, its size, the item time it shows): false when nobody takes them any
/// more. An empty picture says the player failed: load it again.
type Sink = Box<dyn FnMut(Vec<u8>, u32, u32, f64) -> bool + Send>;

/// Every frame the item's output has, as it has it (playing: each one; stopped: the ones sought to), made into the
/// still's kind of picture and handed to `sink` — until `stop`. A failed item or player is told to the sink.
fn pump(out: Output, mut sink: Sink, stop: Arc<AtomicBool>, driver: Arc<Driver>) {
    let spawned = std::thread::Builder::new().name("playback-frames".into()).spawn(move || {
        let (out, item) = out.parts();
        let gpu = match vault_render::gpu::Gpu::new() {
            Ok(g) => g,
            Err(e) => return tracing::warn!("playback: no GPU for the frames: {e:#}"),
        };
        let (started, mut any, mut told) = (Instant::now(), false, false);
        let (mut ready, mut last, mut stalled) = (false, Instant::now(), false);
        while !stop.load(Ordering::Relaxed) {
            // SAFETY: an item's and a player's status can be read from any thread
            let (status, failed) = unsafe { (item.status(), driver.player.status() == AVPlayerStatus::Failed) };
            if status == AVPlayerItemStatus::Failed || failed {
                // SAFETY: plain getters
                let e = unsafe { if failed { driver.player.error() } else { item.error() } };
                tracing::warn!("playback: the {} failed: {e:?} — loading it again", if failed { "player" } else { "item" });
                sink(Vec::new(), 0, 0, 0.0);
                return;
            }
            if !ready && status == AVPlayerItemStatus::ReadyToPlay {
                ready = true;
                driver.ready();
            }
            PUMP_ROUNDS.fetch_add(1, Ordering::Relaxed);
            objc2::rc::autoreleasepool(|_| {
                // SAFETY: the output's and the item's own calls, from the thread the output's are made for
                unsafe {
                    // the item's own clock: where it is, playing or stopped
                    let t = item.currentTime();
                    PUMP_STEP.store(1, Ordering::Relaxed);
                    if !out.hasNewPixelBufferForItemTime(t) {
                        PUMP_STEP.store(0, Ordering::Relaxed);
                        if !any && !told && started.elapsed().as_secs() >= 3 {
                            told = true;
                            let size = item.presentationSize();
                            tracing::warn!(
                                "playback: no frame in 3 s (item status {}, {:.0}×{:.0}, {} tracks, player {})",
                                item.status().0,
                                size.width,
                                size.height,
                                item.tracks().count(),
                                driver.state()
                            );
                        }
                        // playing and no frame for a second: why, once a stall
                        if any && !stalled && driver.drive.lock().unwrap().playing && last.elapsed().as_secs_f64() > 1.0 {
                            stalled = true;
                            tracing::warn!("playback: no new frame for a second while playing ({})", driver.state());
                        }
                        return;
                    }
                    let mut shown = t;
                    PUMP_STEP.store(2, Ordering::Relaxed);
                    let Some(pb) = out.copyPixelBufferForItemTime_itemTimeForDisplay(t, &mut shown) else {
                        PUMP_STEP.store(0, Ordering::Relaxed);
                        return;
                    };
                    PUMP_COPIED.fetch_add(1, Ordering::Relaxed);
                    (any, stalled, last) = (true, false, Instant::now());
                    if !driver.shows(shown.seconds()) {
                        PUMP_STEP.store(0, Ordering::Relaxed);
                        return;
                    }
                    let (w, h) = (objc2_core_video::CVPixelBufferGetWidth(&pb) as u32, objc2_core_video::CVPixelBufferGetHeight(&pb) as u32);
                    PUMP_STEP.store(3, Ordering::Relaxed);
                    let made = gpu.jpeg_bytes(&gpu.frame(&pb), w, h);
                    PUMP_STEP.store(4, Ordering::Relaxed);
                    match made {
                        Ok(bytes) => {
                            if !sink(bytes, w, h, shown.seconds()) {
                                tracing::warn!("playback: the viewer's channel is gone: the pump stops");
                                stop.store(true, Ordering::Relaxed);
                            }
                        }
                        Err(e) => tracing::warn!("playback: a frame: {e:#}"),
                    }
                    PUMP_STEP.store(0, Ordering::Relaxed);
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
    Box::new(move |bytes, w, h, _| {
        let size = bytes.len();
        if frames.send(InvokeResponseBody::Raw(bytes)).is_err() {
            return false;
        }
        sent += 1;
        SENT.fetch_add(1, Ordering::Relaxed);
        if sent == 1 && size > 0 {
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

/// A player for `item`, muted (the sound is the studio's), playing as soon as it is told (its files are local: no
/// waiting to buffer).
///
/// # Safety
/// Off the main thread (see Driver).
unsafe fn player_for(item: &AVPlayerItem, mtm: MainThreadMarker) -> Arc<Driver> {
    // SAFETY: as the caller promises
    unsafe {
        let player = AVPlayer::playerWithPlayerItem(Some(item), mtm);
        player.setMuted(true);
        player.setAutomaticallyWaitsToMinimizeStalling(false);
        Driver::new(player)
    }
}

/// What plays: the timeline (the studio's), the shape it is seen in, per clip the file to play (its proxy, else its
/// original) and that file's colour profile (its journey into ACEScct); `frames`, where its pictures go.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn player_load(
    app: tauri::State<'_, crate::App>,
    timeline: Value,
    shape: String,
    files: HashMap<String, String>,
    profiles: HashMap<String, String>,
    width: Option<u32>,
    frames: Channel<InvokeResponseBody>,
) -> Res<()> {
    crate::gate()?;
    let n = LOADS.fetch_add(1, Ordering::Relaxed) + 1;
    *LAST_LOAD.lock().unwrap() = Some(serde_json::json!({ "timeline": timeline, "shape": shape, "files": files, "profiles": profiles, "width": width }));
    let t: vault_render::Timeline = serde_json::from_value(timeline).map_err(err)?;
    let program = program(&app.vault, &t, &shape, &files, &profiles, width).await?;
    let made = tauri::async_runtime::spawn_blocking(move || on_player(move || -> anyhow::Result<()> {
        // SAFETY: AVFoundation's player works off the main thread, on the player's own (see `post`); objc2 asks for
        // the marker only to be careful. The output's frames are read on the pump's thread.
        unsafe {
            let mtm = MainThreadMarker::new_unchecked();
            let (item, out) = item_of(program, mtm)?;
            let stop = Arc::new(AtomicBool::new(false));
            let driver = {
                let mut native = NATIVE.lock().unwrap();
                if LOADS.load(Ordering::Relaxed) != n {
                    return Ok(());
                }
                match native.as_mut() {
                    Some(nv) if nv.driver.player.status() != AVPlayerStatus::Failed => {
                        nv.pump.store(true, Ordering::Relaxed);
                        nv.driver.forget();
                        nv.driver.player.replaceCurrentItemWithPlayerItem(Some(&item));
                        nv.pump = stop.clone();
                        nv.item = item.clone();
                        nv.driver.clone()
                    }
                    _ => {
                        if let Some(old) = native.take() {
                            old.pump.store(true, Ordering::Relaxed);
                        }
                        let driver = player_for(&item, mtm);
                        *native = Some(Native { driver: driver.clone(), item: item.clone(), pump: stop.clone() });
                        driver
                    }
                }
            };
            tracing::info!("playback: load {n} in place");
            pump(Output(out, item), to_viewer(frames), stop, driver);
        }
        Ok(())
    }))
    .await
    .map_err(err)?;
    made.ok_or("playback: the player's thread is gone")?.map_err(|e| format!("playback: {e:#}"))
}

/// The studio's player as it is now: its item's status (and error), its clock, rate, whether it plays or waits and
/// why, the driving (where the studio wants it, the seek under way), the loads made and the pictures sent so far.
pub(crate) fn state() -> Value {
    let Some((driver, item)) = NATIVE.lock().unwrap().as_ref().map(|n| (n.driver.clone(), n.item.clone())) else {
        return serde_json::json!({ "player": null, "loads": LOADS.load(Ordering::Relaxed) });
    };
    let (want, playing, busy, next, aim, seeks, latency) = {
        let d = driver.drive.lock().unwrap();
        (d.want, d.playing, d.busy.map(|b| b.elapsed().as_millis()), d.next, d.aim, d.seeks, d.latency)
    };
    // SAFETY: plain getters
    let (status, error, at, dur, rate, control, why, pstatus) = unsafe {
        let p = &driver.player;
        (
            item.status().0,
            item.error().map(|e| format!("{e:?}")),
            item.currentTime().seconds(),
            item.duration().seconds(),
            p.rate(),
            p.timeControlStatus().0,
            p.reasonForWaitingToPlay().map(|r| r.to_string()),
            p.status().0,
        )
    };
    serde_json::json!({
        "item": { "status": status, "error": error, "at": at, "duration": dur },
        "player": { "status": pstatus, "rate": rate, "control": control, "waiting_for": why },
        "drive": { "want": want, "playing": playing, "busy_ms": busy, "next": next, "aim": aim, "seeks": seeks, "latency_ms": (latency * 1000.0).round() },
        "loads": LOADS.load(Ordering::Relaxed),
        "sent": SENT.load(Ordering::Relaxed),
        "pump": { "rounds": PUMP_ROUNDS.load(Ordering::Relaxed), "copied": PUMP_COPIED.load(Ordering::Relaxed), "step": PUMP_STEP.load(Ordering::Relaxed) },
        "handler": {
            "asked": vault_render::player::ASKED.load(Ordering::Relaxed),
            "made": vault_render::player::MADE.load(Ordering::Relaxed),
            "failed": vault_render::player::FAILED.load(Ordering::Relaxed),
            "last": *vault_render::player::LAST.lock().unwrap(),
        },
    })
}

/// Drive the studio's own player as the viewer does (`play`, `pause`, `sync` at `t`), for checking it.
pub(crate) fn drive(action: &str, t: f64) -> Res<()> {
    let Some(d) = driver() else { return Err("no player loaded: open the program with a filmed shot".into()) };
    match action {
        "play" => d.play(t),
        "pause" => d.pause(t),
        "sync" => d.sync(t),
        _ => return Err(format!("no action {action}: play, pause or sync")),
    }
    Ok(())
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
        let (steps, cubes) = crate::proxies::graded(vault, t, c, 33).await?;
        clips.push(vault_render::player::PlayClip { clip: c.clone(), source, journey, steps, cubes });
    }
    Ok(Arc::new(vault_render::player::Program { clips, aspect: s.aspect.to_string(), width: w, height: h, output: crate::render::odt().clone() }))
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


/// The Grade tab's playback, run as the studio drives it but headless, its pictures counted: the same item, output,
/// pump and driver. Stopped on `t` (how long the frozen frame takes); the playhead dragged from there over two seconds
/// of film in one second, a move every 16 ms (how many pictures came during the drag, how long the last one took once
/// the hand stopped); played three seconds against a clock, kept to it every 250 ms as the studio keeps it (pictures a
/// second, the seeks it took, how far off it was); and, for comparison, played as it was kept before — a seek whenever
/// it was two frames off, once a second. The frozen picture as it would reach the viewer.
pub(crate) async fn stream_check(vault: &std::sync::Arc<vault_core::Vault>, timeline: Value, t: f64, originals: bool, as_studio: bool) -> Res<(Value, Option<Vec<u8>>)> {
    let last = LAST_LOAD.lock().unwrap().clone().filter(|_| as_studio);
    let program = match last {
        // exactly what the studio loaded last: its timeline, shape, files, profiles and width
        Some(l) => {
            let tl: vault_render::Timeline = serde_json::from_value(l["timeline"].clone()).map_err(err)?;
            let files: HashMap<String, String> = serde_json::from_value(l["files"].clone()).map_err(err)?;
            let profiles: HashMap<String, String> = serde_json::from_value(l["profiles"].clone()).map_err(err)?;
            let shape = l["shape"].as_str().unwrap_or("16:9").to_string();
            tracing::info!("player_stream_check: as the studio loaded it — {shape}, {} files: {files:?}", files.len());
            program(vault, &tl, &shape, &files, &profiles, l["width"].as_u64().map(|w| w as u32)).await?
        }
        None => {
            let tl: vault_render::Timeline = serde_json::from_value(timeline).map_err(err)?;
            let (files, profiles) = files_for(vault, &tl, originals).await?;
            program(vault, &tl, "16:9", &files, &profiles, Some(1600)).await?
        }
    };
    let got: Arc<Mutex<Vec<(Instant, f64)>>> = Arc::default();
    let pic: Arc<Mutex<Option<Vec<u8>>>> = Arc::default();
    let (g, p) = (got.clone(), pic.clone());
    let sink: Sink = Box::new(move |bytes, _, _, at| {
        if !bytes.is_empty() {
            g.lock().unwrap().push((Instant::now(), at));
            *p.lock().unwrap() = Some(bytes);
        }
        true
    });
    let r = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<(Value, Option<Vec<u8>>)> {
        let count = |from: Instant, to: Instant| got.lock().unwrap().iter().filter(|(i, _)| *i >= from && *i < to).count();
        // how long from `from` until a picture of `at` came (ms), if within `max` seconds
        let until = |from: Instant, at: f64, max: f64| -> Option<f64> {
            loop {
                if let Some((i, _)) = got.lock().unwrap().iter().find(|(i, x)| *i >= from && (x - at).abs() <= 1.5 * FRAME) {
                    return Some((i.duration_since(from).as_secs_f64() * 1000.0).round());
                }
                if from.elapsed().as_secs_f64() > max {
                    return None;
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        };
        let ms = |s: f64| (s * 1000.0).round();
        let fps_of = |from: Instant, to: Instant| (count(from, to) as f64 / to.duration_since(from).as_secs_f64() * 10.0).round() / 10.0;
        let sleep = |s: f64| std::thread::sleep(std::time::Duration::from_secs_f64(s));
        // made on the player's own thread, as the studio's is (see `post`)
        let made = on_player(move || -> anyhow::Result<(Output, Arc<Driver>)> {
            // SAFETY: AVFoundation's player works off the main thread; objc2 asks for the marker only to be careful
            unsafe {
                let mtm = MainThreadMarker::new_unchecked();
                let (item, out) = item_of(program, mtm)?;
                let driver = player_for(&item, mtm);
                Ok((Output(out, item), driver))
            }
        })
        .ok_or_else(|| anyhow::anyhow!("the player's thread is gone"))??;
        let ((out, item), driver) = (made.0.parts(), made.1);
        // SAFETY: the item's and the player's getters and calls, from this thread as before
        unsafe {
            let stop = Arc::new(AtomicBool::new(false));
            pump(Output(out, item.clone()), sink, stop.clone(), driver.clone());
            let ready = Instant::now();
            while item.status() != AVPlayerItemStatus::ReadyToPlay && ready.elapsed().as_secs_f64() < 5.0 {
                sleep(0.01);
            }
            sleep(0.1);
            let player = &driver.player;
            let seeks = || driver.drive.lock().unwrap().seeks;

            // stopped on t
            let s0 = Instant::now();
            driver.pause(t);
            let stop_ms = until(s0, t, 3.0);
            let frozen = pic.lock().unwrap().clone();

            // a drag: two seconds of film in one, a move every 16 ms
            let (d0, moves) = (Instant::now(), 62);
            let (mut target, mut moved) = (t, Instant::now());
            for k in 1..=moves {
                target = t + 2.0 * k as f64 / moves as f64;
                moved = Instant::now();
                driver.pause(target);
                sleep(0.016);
            }
            let d1 = Instant::now();
            let during = count(d0, d1);
            // from the last move: how long until its picture came
            let last_ms = until(moved, target, 3.0);

            // the same drag as it was before: a seek for every move, each cancelling the one under way
            let zero = cmtime(0.0);
            let old_seek = |at: f64| player.seekToTime_toleranceBefore_toleranceAfter(cmtime(at), zero, zero);
            driver.pause(t);
            sleep(0.5);
            let b0 = Instant::now();
            for k in 1..=moves {
                target = t + 2.0 * k as f64 / moves as f64;
                moved = Instant::now();
                {
                    let mut d = driver.drive.lock().unwrap();
                    (d.want, d.before, d.aim) = (target, target, target);
                }
                old_seek(target);
                sleep(0.016);
            }
            let b1 = Instant::now();
            let old_during = count(b0, b1);
            let old_last_ms = until(moved, target, 3.0);
            driver.pause(t);
            sleep(0.5);

            // played against a clock, kept to it as the studio keeps it
            let latency = driver.drive.lock().unwrap().latency;
            let (k0, p0) = (seeks(), Instant::now());
            driver.play(t);
            let mut gaps = Vec::new();
            while p0.elapsed().as_secs_f64() < 3.0 {
                sleep(0.25);
                let clock = t + p0.elapsed().as_secs_f64();
                driver.sync(clock);
                gaps.push((p0.elapsed().as_secs_f64(), clock - player.currentTime().seconds()));
            }
            let p1 = Instant::now();
            let kept_seeks = seeks() - k0 - 1;
            let worst = gaps.iter().filter(|(at, _)| *at >= 1.0).map(|(_, g)| g.abs()).fold(0.0, f64::max);
            let end_gap = gaps.last().map(|g| g.1).unwrap_or(0.0);
            let rate_end = player.rate();
            driver.pause(t);
            sleep(0.4);

            // the rate nudged (1.1, then 1.0) while playing: does the composition keep making frames?
            let (n0, a0) = (Instant::now(), vault_render::player::ASKED.load(Ordering::Relaxed));
            driver.play(t);
            sleep(0.5);
            player.setRate(1.1);
            sleep(1.0);
            let a1 = vault_render::player::ASKED.load(Ordering::Relaxed);
            let n1 = Instant::now();
            player.setRate(1.0);
            sleep(1.0);
            let n2 = Instant::now();
            let a2 = vault_render::player::ASKED.load(Ordering::Relaxed);
            let nudged = serde_json::json!({ "fps_at_1_1": fps_of(n0 + std::time::Duration::from_millis(500), n1), "fps_back_at_1": fps_of(n1, n2), "asked_at_1_1": a1 - a0, "asked_back_at_1": a2 - a1,
                "can_fast": item.canPlayFastForward(), "can_slow": item.canPlaySlowForward() });
            driver.pause(t);
            sleep(0.4);

            // played as it was kept before: a seek whenever two frames off, once a second
            driver.forget();
            driver.drive.lock().unwrap().playing = true;
            let o0 = Instant::now();
            old_seek(t);
            player.setRate(1.0);
            let mut old_seeks = 0;
            let mut old_gaps = Vec::new();
            while o0.elapsed().as_secs_f64() < 3.0 {
                sleep(1.0);
                let clock = t + o0.elapsed().as_secs_f64();
                let gap = clock - player.currentTime().seconds();
                old_gaps.push(ms(gap));
                if gap.abs() > 2.0 * FRAME {
                    old_seek(clock);
                    old_seeks += 1;
                }
            }
            let o1 = Instant::now();
            player.setRate(0.0);
            stop.store(true, Ordering::Relaxed);
            player.replaceCurrentItemWithPlayerItem(None);

            let fps = |from: Instant, to: Instant| (count(from, to) as f64 / to.duration_since(from).as_secs_f64() * 10.0).round() / 10.0;
            let one = std::time::Duration::from_secs(1);
            Ok((
                serde_json::json!({
                    "t": t,
                    "stopped": { "frame_ms": stop_ms },
                    "drag": { "moves": moves, "film_s": 2, "pictures_during": during, "last_ms": last_ms },
                    "drag_as_before": { "pictures_during": old_during, "last_ms": old_last_ms },
                    "played": { "fps": fps(p0, p1), "fps_after_1s": fps(p0 + one, p1), "seeks": kept_seeks, "gap_end_ms": ms(end_gap), "worst_gap_after_1s_ms": ms(worst), "rate_end": rate_end, "seek_latency_ms": ms(latency) },
                    "nudged": nudged,
                    "played_as_before": { "fps": fps(o0, o1), "fps_after_1s": fps(o0 + one, o1), "seeks": old_seeks, "gaps_ms": old_gaps },
                }),
                frozen,
            ))
        }
    })
    .await
    .map_err(err)?;
    r.map_err(|e| format!("{e:#}"))
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

/// The studio's player, once one is loaded.
fn driver() -> Option<Arc<Driver>> {
    NATIVE.lock().unwrap().as_ref().map(|n| n.driver.clone())
}

/// Play from `time` (the studio's clock).
#[tauri::command]
pub fn player_play(time: f64) -> Res<()> {
    crate::gate()?;
    if let Some(d) = driver() {
        d.play(time);
    }
    Ok(())
}

/// Stop at `time`; stopped, follow the playhead (each move a chased seek).
#[tauri::command]
pub fn player_pause(time: f64) -> Res<()> {
    crate::gate()?;
    if let Some(d) = driver() {
        d.pause(time);
    }
    Ok(())
}

/// Playing, keep to the studio's clock (`time`): by the rate when near, by a seek when half a second off.
#[tauri::command]
pub fn player_sync(time: f64) -> Res<()> {
    crate::gate()?;
    if let Some(d) = driver() {
        d.sync(time);
    }
    Ok(())
}
