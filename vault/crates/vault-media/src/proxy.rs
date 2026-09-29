//! A movie's HD proxy, made by the Mac's own media engine — the native twin of scripts/film/proxy.mjs:
//! long edge 1920 (never larger than the file), HEVC Main10 in hardware (VideoToolbox through AVAssetWriter),
//! BT.709 matrix and TV range, a keyframe every 15 frames for scrubbing, AAC audio, the moov atom up front, and the
//! comment `maiacity:color=acescct`.
//!
//! Every proxy is in ACEScct, the timeline's working space: each frame is decoded to full-range RGB in the source's
//! own encoding, taken through its colour journey (`cst`) and scaled down on the GPU (`gpu::Grader`), and only then
//! encoded. How it is shown — a monitor, a render target — is the viewer's output transform, never the proxy's.

use std::{path::Path, time::Duration};

use anyhow::{Context, Result, bail};
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_core_foundation::CFRetained;
use objc2_av_foundation::{
    AVAssetReader, AVAssetReaderOutput, AVAssetReaderStatus, AVAssetReaderTrackOutput, AVAssetTrack, AVAssetWriter,
    AVAssetWriterInput, AVAssetWriterStatus, AVFileTypeMPEG4, AVMediaTypeAudio, AVMediaTypeVideo, AVURLAsset,
};
use objc2_av_foundation::AVAssetWriterInputPixelBufferAdaptor;
use objc2_core_media::{CMSampleBuffer, CMTime};
use objc2_core_video::{
    CVAttachmentMode, CVPixelBuffer, CVPixelBufferPool, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2,
    kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2, kCVImageBufferYCbCrMatrixKey,
    kCVImageBufferYCbCrMatrix_ITU_R_709_2,
};
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};

use crate::{gpu::Grader, mp4, probe::probe};

/// The working space every proxy is in.
pub const WORKING: &str = "acescct";

pub const LONG_EDGE: u32 = 1920;
pub const GOP: i32 = 15;

/// The proxy's frame: long edge 1920 at most, even sides (proxy.mjs `proxySize`).
pub fn proxy_size(w: u32, h: u32) -> (u32, u32) {
    let k = (LONG_EDGE as f64 / w.max(h) as f64).min(1.0);
    let even = |x: f64| 2 * ((x * k) / 2.0).round() as u32;
    (even(w as f64), even(h as f64))
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Proxy {
    pub width: u32,
    pub height: u32,
    pub seconds: f64,
    pub profile: String,
}

fn key(s: &str) -> Retained<NSString> {
    NSString::from_str(s)
}

/// A settings dictionary from (key, value) pairs.
fn dict(pairs: &[(&NSString, &AnyObject)]) -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys: Vec<&NSString> = pairs.iter().map(|(k, _)| *k).collect();
    let values: Vec<&AnyObject> = pairs.iter().map(|(_, v)| *v).collect();
    NSDictionary::from_slices(&keys, &values)
}

/// Make the ACEScct proxy of the movie at `src` — whose colour is `source` (a profile `cst::journey` knows) — into
/// `out` (an .mp4). `progress` gets 0…1.
pub fn make_proxy(src: &Path, out: &Path, source: &str, progress: &mut dyn FnMut(f64)) -> Result<Proxy> {
    let grader = Grader::for_profile(source)?.with_context(|| format!("no colour journey from {source} into ACEScct"))?;
    let info = probe(src)?;
    let (w, h) = proxy_size(info.width, info.height);
    let _ = std::fs::remove_file(out);
    let src = std::fs::canonicalize(src)?;
    let out_abs = std::path::absolute(out)?;

    // SAFETY: AVFoundation objects we create and own; the loop below only calls them from this thread.
    unsafe {
        let asset = AVURLAsset::URLAssetWithURL_options(&NSURL::fileURLWithPath(&NSString::from_str(&src.to_string_lossy())), None);
        #[allow(deprecated)]
        let video_track: Retained<AVAssetTrack> = Retained::cast_unchecked(
            asset.tracksWithMediaType(AVMediaTypeVideo.context("video")?).firstObject().context("no video track")?,
        );
        #[allow(deprecated)]
        let audio_track: Option<Retained<AVAssetTrack>> =
            asset.tracksWithMediaType(AVMediaTypeAudio.context("audio")?).firstObject().map(|t| Retained::cast_unchecked(t));

        // ── reading: decoded 10-bit 4:2:0 frames (Core Image undoes their YCbCr matrix and range on the GPU — 3× faster
        // than asking the decoder for RGB, and as exact), and PCM audio ──
        let reader = AVAssetReader::assetReaderWithAsset_error(&asset).map_err(|e| anyhow::anyhow!("{e:?}"))?;
        let x420 = NSNumber::new_u32(u32::from_be_bytes(*b"x420")); // kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange
        // decoded straight to the proxy's size: VideoToolbox scales in hardware while it decodes, so the GPU grades a
        // quarter of the pixels (scaled in the source's own encoding — for a proxy, the same picture)
        let (read_w, read_h) = (NSNumber::new_u32(w), NSNumber::new_u32(h));
        let video_read = dict(&[(&key("PixelFormatType"), &x420), (&key("Width"), &read_w), (&key("Height"), &read_h)]);
        let video_out = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(&video_track, Some(&video_read));
        video_out.setAlwaysCopiesSampleData(false);
        reader.addOutput(&video_out);
        let lpcm = NSNumber::new_u32(u32::from_be_bytes(*b"lpcm"));
        let audio_out = audio_track.as_ref().map(|t| {
            let settings = dict(&[(&key("AVFormatIDKey"), &lpcm)]);
            let o = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(t, Some(&settings));
            reader.addOutput(&o);
            o
        });
        if !reader.startReading() {
            bail!("cannot read {}: {:?}", src.display(), reader.error());
        }

        // ── writing: HEVC Main10 in hardware, from the GPU's ACEScct frames — rendered straight into 10-bit 4:2:0 with the
        // BT.709 matrix, which is only the container's: the frames carry the same tags, so nothing converts them ──
        let writer = AVAssetWriter::assetWriterWithURL_fileType_error(
            &NSURL::fileURLWithPath(&NSString::from_str(&out_abs.to_string_lossy())),
            AVFileTypeMPEG4.context("mp4")?,
        )
        .map_err(|e| anyhow::anyhow!("{e:?}"))?;
        // moov last for now: mp4::finish adds the comment and moves moov to the front (AVFoundation drops asset
        // metadata in MPEG-4 files, so it cannot write the comment itself)
        writer.setShouldOptimizeForNetworkUse(false);

        let bt709 = key("ITU_R_709_2");
        let color = dict(&[
            (&key("ColorPrimaries"), &bt709),
            (&key("TransferFunction"), &bt709),
            (&key("YCbCrMatrix"), &bt709),
        ]);
        let (bitrate, gop) = (NSNumber::new_i32(12_000_000), NSNumber::new_i32(GOP));
        let main10 = key("HEVC_Main10_AutoLevel");
        let no_reorder = NSNumber::new_bool(false);
        let compression = dict(&[
            (&key("AverageBitRate"), &bitrate),
            (&key("MaxKeyFrameInterval"), &gop),
            (&key("ProfileLevel"), &main10),
            (&key("AllowFrameReordering"), &no_reorder),
        ]);
        let (width, height) = (NSNumber::new_u32(w), NSNumber::new_u32(h));
        let hevc = key("hvc1");
        let video_write = dict(&[
            (&key("AVVideoCodecKey"), &hevc),
            (&key("AVVideoWidthKey"), &width),
            (&key("AVVideoHeightKey"), &height),
            (&key("AVVideoColorPropertiesKey"), &color),
            (&key("AVVideoCompressionPropertiesKey"), &compression),
        ]);
        let video_in = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(
            AVMediaTypeVideo.context("video")?,
            Some(&video_write),
        );
        video_in.setExpectsMediaDataInRealTime(false);
        video_in.setTransform(video_track.preferredTransform());
        writer.addInput(&video_in);
        let surface = NSDictionary::<NSString, AnyObject>::new();
        let frames = dict(&[
            (&key("PixelFormatType"), &x420),
            (&key("Width"), &width),
            (&key("Height"), &height),
            (&key("IOSurfaceProperties"), &surface),
        ]);
        let adaptor = AVAssetWriterInputPixelBufferAdaptor::assetWriterInputPixelBufferAdaptorWithAssetWriterInput_sourcePixelBufferAttributes(
            &video_in,
            Some(&frames),
        );

        let aac = NSNumber::new_u32(u32::from_be_bytes(*b"aac "));
        let (two, rate, abr) = (NSNumber::new_i32(2), NSNumber::new_f64(48_000.0), NSNumber::new_i32(160_000));
        let audio_in = audio_out.as_ref().map(|_| {
            let settings = dict(&[
                (&key("AVFormatIDKey"), &aac),
                (&key("AVNumberOfChannelsKey"), &two),
                (&key("AVSampleRateKey"), &rate),
                (&key("AVEncoderBitRateKey"), &abr),
            ]);
            let i = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(AVMediaTypeAudio.unwrap(), Some(&settings));
            i.setExpectsMediaDataInRealTime(false);
            writer.addInput(&i);
            i
        });

        if !writer.startWriting() {
            bail!("cannot write {}: {:?}", out.display(), writer.error());
        }
        writer.startSessionAtSourceTime(CMTime { value: 0, timescale: 600, flags: objc2_core_media::CMTimeFlags::Valid, epoch: 0 });
        let pool = adaptor.pixelBufferPool().context("the writer has no frame pool")?;

        // ── interleave: feed whichever input is ready, until both sources run dry ──
        let total = info.seconds.max(0.001);
        let (mut video_done, mut audio_done) = (false, audio_in.is_none());
        let pump = |output: &AVAssetReaderOutput, input: &AVAssetWriterInput| -> Option<Retained<CMSampleBuffer>> {
            if !input.isReadyForMoreMediaData() {
                return None;
            }
            output.copyNextSampleBuffer()
        };
        while !(video_done && audio_done) {
            let mut moved = false;
            if !video_done && video_in.isReadyForMoreMediaData() {
                match pump(&video_out, &video_in) {
                    Some(sample) => {
                        let t = sample.presentation_time_stamp();
                        if t.timescale > 0 {
                            progress((t.value as f64 / t.timescale as f64 / total).min(1.0));
                        }
                        let Some(frame) = sample.image_buffer() else { continue };
                        let graded = graded_frame(&grader, &pool, &frame, w, h)?;
                        if !adaptor.appendPixelBuffer_withPresentationTime(&graded, t) {
                            bail!("video frame refused: {:?}", writer.error());
                        }
                        moved = true;
                    }
                    None => {
                        video_in.markAsFinished();
                        video_done = true;
                    }
                }
            }
            if let (false, Some(out), Some(input)) = (audio_done, audio_out.as_ref(), audio_in.as_ref()) {
                if input.isReadyForMoreMediaData() {
                    match pump(out, input) {
                        Some(sample) => {
                            if !input.appendSampleBuffer(&sample) {
                                bail!("audio refused: {:?}", writer.error());
                            }
                            moved = true;
                        }
                        None => {
                            input.markAsFinished();
                            audio_done = true;
                        }
                    }
                }
            }
            if !moved {
                std::thread::sleep(Duration::from_millis(2));
            }
            if reader.status() == AVAssetReaderStatus::Failed {
                bail!("reading failed: {:?} — underlying: {:?}", reader.error(), reader.error().and_then(|e| e.userInfo().objectForKey(&NSString::from_str("NSUnderlyingError")).map(|u| format!("{u:?}"))));
            }
        }

        #[allow(deprecated)]
        let finished = writer.finishWriting();
        if !finished || writer.status() != AVAssetWriterStatus::Completed {
            bail!("the proxy could not be finished: {:?}", writer.error());
        }
    }
    // the comment the studio reads the proxy's colour from, and moov in front (+faststart)
    mp4::finish(&out_abs, &format!("maiacity:color={WORKING}")).context("finish the mp4")?;
    progress(1.0);
    let made = probe(out).context("probe the proxy")?;
    Ok(Proxy { width: made.width, height: made.height, seconds: made.seconds, profile: WORKING.to_string() })
}

/// One decoded frame through its journey into a fresh buffer from the writer's pool, tagged as the container says.
unsafe fn graded_frame(grader: &Grader, pool: &CVPixelBufferPool, frame: &CVPixelBuffer, w: u32, h: u32) -> Result<CFRetained<CVPixelBuffer>> {
    let mut out: *mut CVPixelBuffer = std::ptr::null_mut();
    // SAFETY: the pool is the writer's, `out` is written by the call and owned (+1) by us after it.
    let status = unsafe { CVPixelBufferPool::create_pixel_buffer(None, pool, std::ptr::NonNull::from(&mut out)) };
    let out = std::ptr::NonNull::new(out).filter(|_| status == 0).with_context(|| format!("no frame from the pool ({status})"))?;
    let out = unsafe { CFRetained::from_raw(out) };
    unsafe {
        for (k, v) in [
            (kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2),
            (kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2),
            (kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2),
        ] {
            out.set_attachment(k, v, CVAttachmentMode::ShouldPropagate);
        }
    }
    grader.frame(frame, &out, w, h)?;
    Ok(out)
}
