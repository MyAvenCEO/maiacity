//! Playback through the whole grade, natively: the film's picture clips laid on one video track of an
//! AVMutableComposition (each clip's file — its proxy, a log picture tagged BT.709 — at its place on the clock), and a
//! video composition whose Core Image handler takes every frame through exactly the render's chain (`render::chain`):
//! its journey into ACEScct, its framing, balance, secondaries, grade and looks (one cube), the film's finishing, the
//! output transform. An AVPlayer (the app's) plays it; an AVAssetImageGenerator reads single frames of it (the tests).

use std::{ptr::NonNull, sync::Arc};

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
    creative::Finish,
    gpu::{Cube, Gpu},
    timeline::{Clip, FPS},
};

/// One picture clip as it plays: the clip, its file (read in place), its journey into ACEScct (the kernel's
/// arguments), and its grade and looks as one cube (none: it has none).
pub struct PlayClip {
    pub clip: Clip,
    pub source: vault_media::Source,
    pub journey: (f32, f32, [[f32; 3]; 3]),
    pub looks: Option<Lut3d>,
}

/// What plays: the picture clips, the film's finishing, the shape (for the framing) and the size frames are made at.
pub struct Program {
    pub clips: Vec<PlayClip>,
    pub finish: Option<Finish>,
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

type Handler = (Gpu, std::collections::HashMap<String, Cube>, std::collections::HashMap<String, Track>);

thread_local! {
    /// The GPU of the thread AVFoundation calls the handler on (its kernels compiled once), with each clip's cube and
    /// where its face is.
    static GPU: std::cell::RefCell<Option<Handler>> = const { std::cell::RefCell::new(None) };
}

impl Program {
    /// The clip on screen at `t` seconds of the film.
    fn at(&self, t: f64) -> Option<&PlayClip> {
        self.clips.iter().find(|p| t >= p.clip.start - 1e-6 && t < p.clip.start + p.clip.dur - 1e-6)
    }

    /// One frame: the source frame the composition decoded (its file's code values), through the whole chain.
    fn frame(&self, src: &objc2_core_image::CIImage, t: f64) -> Result<(crate::gpu::Image, Retained<objc2_core_image::CIContext>)> {
        GPU.with(|cell| {
            let mut cell = cell.borrow_mut();
            if cell.is_none() {
                let mut g = Gpu::new()?;
                g.set_output(&self.output);
                *cell = Some((g, std::collections::HashMap::new(), std::collections::HashMap::new()));
            }
            let (gpu, cubes, tracks) = cell.as_mut().unwrap();
            let (w, h) = (self.width, self.height);
            let Some(p) = self.at(t) else {
                return Ok((gpu.black(w, h), gpu.context()));
            };
            let cct = gpu.journey(src, p.journey)?;
            let framed = gpu.frame_to(&cct, w, h, p.clip.frame_for(&self.aspect))?;
            if let Some(lut) = &p.looks
                && !cubes.contains_key(&p.clip.id)
            {
                cubes.insert(p.clip.id.clone(), gpu.cube(lut));
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
            let pic = crate::render::chain_with(gpu, &framed, w, h, &p.clip, cubes.get(&p.clip.id), self.finish.as_ref(), n, &mut face_of)?;
            Ok((gpu.output(&pic)?, gpu.context()))
        })
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
        for p in &program.clips {
            let asset = p.source.asset()?;
            #[allow(deprecated)]
            let tracks = asset.tracksWithMediaType(media);
            let Some(src) = tracks.firstObject() else { continue };
            let range = CMTimeRange { start: cmtime(p.clip.in_), duration: cmtime(p.clip.dur) };
            track.insertTimeRange_ofTrack_atTime_error(range, &src, cmtime(p.clip.start)).map_err(|e| anyhow::anyhow!("clip {}: {e:?}", p.clip.id))?;
        }
        let prog = program.clone();
        let handler = RcBlock::new(move |req: NonNull<AVAsynchronousCIImageFilteringRequest>| {
            let req = req.as_ref();
            let t = req.compositionTime().seconds();
            let src = req.sourceImage();
            objc2::rc::autoreleasepool(|_| match prog.frame(&src, t) {
                Ok((img, ctx)) => req.finishWithImage_context(&img, Some(&ctx)),
                Err(e) => {
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
