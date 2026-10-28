//! Playback through the whole grade, natively: the film's picture clips laid on one video track of an
//! AVMutableComposition (each clip's file — its proxy, a log picture tagged BT.709 — at its place on the clock), and a
//! video composition whose Core Image handler takes every frame through exactly the render's chain (`render::chain`):
//! its journey into ACEScct, its framing, balance, secondaries, grade and looks (one cube), the film's finishing, the
//! output transform. An AVPlayer (the app's) plays it; an AVAssetImageGenerator reads single frames of it (the tests).

use std::{collections::HashMap, ptr::NonNull, sync::Arc};

use anyhow::{Context, Result};
use block2::RcBlock;
use objc2::rc::Retained;
use objc2_av_foundation::{
    AVAsynchronousCIImageFilteringRequest, AVMediaTypeVideo, AVMutableComposition, AVMutableVideoComposition, AVVideoColorPrimaries_ITU_R_709_2,
    AVVideoTransferFunction_ITU_R_709_2, AVVideoYCbCrMatrix_ITU_R_709_2,
};
use objc2_core_foundation::CGSize;
use objc2_core_media::CMTimeRange;

use crate::{
    Lut3d,
    av::cmtime,
    gpu::{Cube, Gpu},
    timeline::{Clip, FPS},
    tools::Step,
};

/// One picture clip as it plays: the clip, its file (read in place), its journey into ACEScct (the kernel's
/// arguments), and its grade: its stacks' steps (tools.rs) and their colour runs' cubes, by key.
pub struct PlayClip {
    pub clip: Clip,
    pub source: vault_media::Source,
    pub journey: vault_media::cst::KernelArgs,
    pub steps: Vec<Step>,
    pub cubes: HashMap<String, Lut3d>,
}

/// What plays: the picture clips (each with its whole grade, the finishing too), the shape (for the framing) and the
/// size frames are made at.
pub struct Program {
    pub clips: Vec<PlayClip>,
    pub aspect: String,
    pub width: u32,
    pub height: u32,
    pub output: Lut3d,
}

/// Where a clip's face was last found: the frame it was looked for on, and the face (a box from the top left).
#[derive(Clone, Copy)]
struct Track {
    at: u64,
    face: Option<crate::look::Rect>,
}

/// Look for the face again every this many frames (5 a second), on a copy this wide: Vision on every full frame
/// costs playing in real time; a face moves little in a fifth of a second.
const TRACK_EVERY: u64 = 6;
const TRACK_WIDTH: f64 = 480.0;

/// One composition's handler state: its GPU (the kernels compiled once, the output cube loaded), each clip's cubes and
/// where its face is. Made once with the composition, before it plays: AVFoundation calls the handler on whichever of
/// its worker threads is free, and state kept per thread was made again on every new one — the output cube, most of a
/// second each time, and playback stood still for it. A new composition (the grade changed: every load is one) has its
/// own — kept by clip alone, a clip played its first grade for ever.
struct Handler {
    gpu: Gpu,
    cubes: HashMap<String, Cube>,
    tracks: HashMap<String, Track>,
    /// per clip, its picture when its file is a still (a PNG, a JPEG …): a still is no movie, so the composition has
    /// nothing of it on its track and the handler is handed an empty frame there — the clip's own picture is used
    stills: Vec<Option<Retained<objc2_core_image::CIImage>>>,
}

/// Whether a file's first bytes are a still's: PNG, JPEG, TIFF, OpenEXR, HEIC/AVIF.
fn is_still(head: &[u8]) -> bool {
    head.starts_with(b"\x89PNG")
        || head.starts_with(&[0xFF, 0xD8, 0xFF])
        || head.starts_with(b"II*\0")
        || head.starts_with(b"MM\0*")
        || head.starts_with(&[0x76, 0x2F, 0x31, 0x01])
        || (head.len() >= 12 && &head[4..8] == b"ftyp" && matches!(&head[8..12], b"heic" | b"heix" | b"mif1" | b"avif"))
}

impl Handler {
    /// The state for `program`: the GPU, the output cube and every clip's cubes, made now.
    fn new(program: &Program) -> Result<Self> {
        let mut gpu = Gpu::new()?;
        gpu.set_output(&program.output);
        let mut cubes = HashMap::new();
        for p in &program.clips {
            for (key, lut) in &p.cubes {
                cubes.entry(key.clone()).or_insert_with(|| gpu.cube(lut));
            }
        }
        let stills = program
            .clips
            .iter()
            .map(|p| match p.source.head(12) {
                Ok(head) if is_still(&head) => p.source.read_all().ok().and_then(|b| vault_media::gpu::load_image(&b).ok()),
                _ => None,
            })
            .collect();
        Ok(Self { gpu, cubes, tracks: HashMap::new(), stills })
    }
}

/// The handler's state, shared by the threads AVFoundation calls it on — one at a time (the composition's queue is
/// serial), so the lock is never waited on.
struct Shared(std::sync::Mutex<Handler>);
// SAFETY: Core Image's context and kernels are thread-safe; the rest is ours, and only touched under the lock
unsafe impl Send for Shared {}
unsafe impl Sync for Shared {}

/// Each composition's number (the studio's `player_state` reads which one the last frame was for).
static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// Frames the handlers were asked for, made, and failed, all told; and the last one's composition and time (the
/// studio's `player_state` reads them).
pub static ASKED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
pub static MADE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
pub static FAILED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
pub static LAST: std::sync::Mutex<(u64, f64)> = std::sync::Mutex::new((0, 0.0));

impl Program {
    /// One frame: the source frame the composition decoded (its file's code values), turned upright by its file's own
    /// transform (`turns`, per clip: the composition hands frames over as they are stored), through the whole chain.
    fn frame(&self, st: &mut Handler, src: &objc2_core_image::CIImage, t: f64, turns: &[objc2_core_foundation::CGAffineTransform]) -> Result<(crate::gpu::Image, Retained<objc2_core_image::CIContext>)> {
        {
            let Handler { gpu, cubes, tracks, stills } = st;
            let (w, h) = (self.width, self.height);
            let Some((i, p)) = self.clips.iter().enumerate().find(|(_, p)| t >= p.clip.start - 1e-6 && t < p.clip.start + p.clip.dur - 1e-6) else {
                return Ok((gpu.black(w, h), gpu.context()));
            };
            // a still's own picture; and no picture at all (an empty frame: nothing of this clip on the track) is black,
            // never a scale of nothing
            let src: &objc2_core_image::CIImage = match stills.get(i).and_then(Option::as_deref) {
                Some(still) => still,
                None => src,
            };
            let ext = crate::gpu::Extent::ext(src);
            if !(ext.size.width > 0.0 && ext.size.height > 0.0 && ext.size.width.is_finite() && ext.size.height.is_finite()) {
                return Ok((gpu.black(w, h), gpu.context()));
            }
            let upright = match turns.get(i) {
                Some(turn) => gpu.orient(src, *turn),
                None => objc2::Message::retain(src),
            };
            let cct = gpu.journey(&upright, p.journey)?;
            let framed = gpu.frame_to(&cct, w, h, p.clip.frame_for(&self.aspect))?;
            // its runs' cubes, once each (by key: two clips of one grade share them)
            for (key, lut) in &p.cubes {
                if !cubes.contains_key(key) {
                    cubes.insert(key.clone(), gpu.cube(lut));
                }
            }
            let n = (t * FPS as f64).round() as u64;
            let id = p.clip.id.clone();
            let mut face_of = |gpu: &Gpu, pic: &crate::gpu::Image| -> Result<Option<crate::look::Rect>> {
                let last = tracks.get(&id).copied();
                if let Some(l) = last
                    && n.abs_diff(l.at) < TRACK_EVERY
                {
                    return Ok(l.face);
                }
                let small = gpu.resize(&*gpu.output(pic)?, TRACK_WIDTH as u32, ((TRACK_WIDTH * h as f64 / w as f64).round() as u32).max(2))?;
                let found = crate::look::faces(&small).first().copied();
                // eased towards where it is now, so the window glides; a face lost for a moment keeps its place
                let face = match (last.and_then(|l| l.face), found) {
                    (Some(a), Some(b)) => Some(std::array::from_fn(|i| a[i] * 0.4 + b[i] * 0.6)),
                    (a, None) => a,
                    (None, b) => b,
                };
                tracks.insert(id.clone(), Track { at: n, face });
                Ok(face)
            };
            let pic = crate::render::chain_with(gpu, &framed, w, h, &p.steps, cubes, n, &mut face_of)?;
            Ok((gpu.output(&pic)?, gpu.context()))
        }
    }
}

/// The film as one composition and its video composition: every picture clip's file on one video track at its place,
/// every frame through the whole grade. Its colour pinned to BT.709 (the proxies' tags: nothing converted on the way in;
/// the display code values out tagged as what they are).
pub fn composition(program: Arc<Program>) -> Result<(Retained<AVMutableComposition>, Retained<AVMutableVideoComposition>)> {
    // SAFETY: AVFoundation objects we create; the handler's program lives as long as the block (an Arc it owns)
    unsafe {
        let comp = AVMutableComposition::composition();
        let media = AVMediaTypeVideo.context("no video media type")?;
        let track = comp.addMutableTrackWithMediaType_preferredTrackID(media, 0).context("no video track")?;
        // each clip's file's own transform (a camera held upside down writes a turn, not turned pixels)
        let mut turns = Vec::with_capacity(program.clips.len());
        // each clip's asset, kept as long as the composition: the composition does not hold its sources' assets, and
        // a vault file's asset carries the delegate that reads its bytes (blob_asset) — held only by an autorelease
        // pool, it went when the pool drained, and the player made no frame again (on the main thread: never one)
        let mut assets = Vec::with_capacity(program.clips.len());
        for p in &program.clips {
            let asset = p.source.asset()?;
            assets.push(asset.clone());
            #[allow(deprecated)]
            let tracks = asset.tracksWithMediaType(media);
            let Some(src) = tracks.firstObject() else {
                turns.push(objc2_core_foundation::CGAffineTransform { a: 1.0, b: 0.0, c: 0.0, d: 1.0, tx: 0.0, ty: 0.0 });
                continue;
            };
            turns.push(src.preferredTransform());
            let range = CMTimeRange { start: cmtime(p.clip.in_), duration: cmtime(p.clip.dur) };
            track.insertTimeRange_ofTrack_atTime_error(range, &src, cmtime(p.clip.start)).map_err(|e| anyhow::anyhow!("clip {}: {e:?}", p.clip.id))?;
        }
        let prog = program.clone();
        let generation = GENERATION.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let state = Arc::new(Shared(std::sync::Mutex::new(Handler::new(&program)?)));
        let handler = RcBlock::new(move |req: NonNull<AVAsynchronousCIImageFilteringRequest>| {
            let _sources = &assets;
            let req = req.as_ref();
            let t = req.compositionTime().seconds();
            let src = req.sourceImage();
            // once: the format AVFoundation decodes the files into for the grade (8 or 10 bits a channel)
            static TOLD: std::sync::Once = std::sync::Once::new();
            TOLD.call_once(|| {
                let fmt = src.pixelBuffer().map(|pb| objc2_core_video::CVPixelBufferGetPixelFormatType(&pb));
                eprintln!("playback: source frames decoded as {}", fmt.map(|f| String::from_utf8_lossy(&f.to_be_bytes()).to_string()).unwrap_or_else(|| "(no pixel buffer)".into()));
            });
            ASKED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            *LAST.lock().unwrap() = (generation, t);
            let mut st = state.0.lock().unwrap_or_else(|e| e.into_inner());
            objc2::rc::autoreleasepool(|_| match prog.frame(&mut st, &src, t, &turns) {
                Ok((img, ctx)) => {
                    MADE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    req.finishWithImage_context(&img, Some(&ctx))
                }
                Err(e) => {
                    FAILED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    tracing_warn(&format!("playback at {t:.2} s: {e:#}"));
                    req.finishWithImage_context(&src, None);
                }
            });
        });
        #[allow(deprecated)]
        let video = AVMutableVideoComposition::videoCompositionWithAsset_applyingCIFiltersWithHandler(&comp, &handler);
        video.setRenderSize(CGSize { width: program.width as f64, height: program.height as f64 });
        video.setFrameDuration(objc2_core_media::CMTime { value: 1, timescale: FPS as i32, flags: objc2_core_media::CMTimeFlags::Valid, epoch: 0 });
        video.setColorPrimaries(AVVideoColorPrimaries_ITU_R_709_2);
        video.setColorTransferFunction(AVVideoTransferFunction_ITU_R_709_2);
        video.setColorYCbCrMatrix(AVVideoYCbCrMatrix_ITU_R_709_2);
        Ok((comp, video))
    }
}

fn tracing_warn(msg: &str) {
    eprintln!("{msg}");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn program(look: Option<Lut3d>) -> Program {
        let clip: Clip = serde_json::from_value(serde_json::json!({ "id": "a", "track": "V1", "start": 0, "in": 0, "dur": 2, "hash": "a" })).unwrap();
        let source = vault_media::Source::blob(Arc::new(Vec::new()), "a.mp4");
        let journey = vault_media::cst::journey("acescct").unwrap().kernel_args();
        // a look as one cube step (its key), else no grade
        let (steps, cubes) = match look {
            Some(l) => (vec![Step::Cube { key: "look".into(), run: crate::tools::Run { parts: vec![] } }], HashMap::from([("look".to_string(), l)])),
            None => (vec![], HashMap::new()),
        };
        Program { clips: vec![PlayClip { clip, source, journey, steps, cubes }], aspect: "16:9".into(), width: 64, height: 36, output: Lut3d::identity(17) }
    }

    fn centre(img: &crate::gpu::Image) -> [f32; 3] {
        let gpu = Gpu::new().unwrap();
        let px = gpu.read(img, 64, 36);
        let i = ((18 * 64 + 32) * 4) as usize;
        [px[i], px[i + 1], px[i + 2]]
    }

    #[test]
    fn each_composition_grades_with_its_own_cubes() {
        // each composition grades with its own state: a clip graded red in one, then with no look in the next, is red
        // only in the first (kept by clip alone, it played its first grade for ever)
        let gpu = Gpu::new().unwrap();
        let px: Vec<f32> = (0..64 * 36).flat_map(|_| [0.4, 0.4, 0.4, 1.0]).collect();
        let src = gpu.from_rgba(&px, 64, 36);
        let red: Vec<f32> = (0..8).flat_map(|_| [0.6f32, 0.3, 0.2]).collect();
        let graded = program(Some(Lut3d::from_rgb("red", 2, red).unwrap()));
        let (a, _) = graded.frame(&mut Handler::new(&graded).unwrap(), &src, 1.0, &[]).unwrap();
        let warm = centre(&a);
        let plain = program(None);
        let (b, _) = plain.frame(&mut Handler::new(&plain).unwrap(), &src, 1.0, &[]).unwrap();
        let after = centre(&b);
        assert!(warm[0] > warm[2] + 0.2, "the look plays: {warm:?}");
        assert!((after[0] - after[2]).abs() < 0.02, "the next composition has no look, and shows none: {after:?}");
    }
}
