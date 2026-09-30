//! A movie from frames the app renders itself — a world shot's HD proxy. Sandbox 4's film mode hands each frame over
//! already in ACEScct as 10-bit codes (`__film.capture`: x2bgr10le, top row first, full range); here they become the
//! same file a movie's proxy is (`proxy.rs`): HEVC Main10 in hardware through AVAssetWriter, 4:2:0, the BT.709 matrix
//! and TV range as the container's tags only, a keyframe every 15 frames, moov up front, the comment
//! `maiacity:color=acescct`.
//!
//! RGB → YCbCr is done here, on the CPU, exactly as the render worker's ffmpeg did it (`scale=out_color_matrix=bt709:
//! out_range=tv`, accurate rounding): the codes stay the log codes, 10 bits all the way, nothing converts them again.
//! Chroma is sited left (MPEG-2 style, what HEVC players assume): a [1 2 1] tap across, the two rows averaged.

use std::{path::Path, path::PathBuf, time::Duration};

use anyhow::{Context, Result, bail, ensure};
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_av_foundation::{
    AVAssetWriter, AVAssetWriterInput, AVAssetWriterInputPixelBufferAdaptor, AVAssetWriterStatus, AVFileTypeMPEG4,
    AVMediaTypeVideo,
};
use objc2_core_foundation::CFRetained;
use objc2_core_media::{CMTime, CMTimeFlags};
use objc2_core_video::{
    CVAttachmentMode, CVPixelBuffer, CVPixelBufferGetBaseAddressOfPlane, CVPixelBufferGetBytesPerRowOfPlane,
    CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags, CVPixelBufferPool, CVPixelBufferUnlockBaseAddress,
    kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, kCVImageBufferTransferFunctionKey,
    kCVImageBufferTransferFunction_ITU_R_709_2, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2,
};
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};

use crate::{
    mp4,
    probe::probe,
    proxy::{GOP, Proxy, WORKING},
};

fn key(s: &str) -> Retained<NSString> {
    NSString::from_str(s)
}

fn dict(pairs: &[(&NSString, &AnyObject)]) -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys: Vec<&NSString> = pairs.iter().map(|(k, _)| *k).collect();
    let values: Vec<&AnyObject> = pairs.iter().map(|(_, v)| *v).collect();
    NSDictionary::from_slices(&keys, &values)
}

/// Writes 10-bit ACEScct frames (x2bgr10le) into an HEVC Main10 proxy. Not `Send`: AVFoundation's objects stay on the
/// thread that made them — give it a thread of its own and feed it frames.
pub struct FrameWriter {
    writer: Retained<AVAssetWriter>,
    input: Retained<AVAssetWriterInput>,
    adaptor: Retained<AVAssetWriterInputPixelBufferAdaptor>,
    pool: Retained<CVPixelBufferPool>,
    out: PathBuf,
    width: u32,
    height: u32,
    /// a frame lasts `STEP` in this timescale (fps · 1000, so 29.97 and 24 are exact too)
    timescale: i32,
    frames: i64,
    finished: bool,
}

const STEP: i64 = 1000;

impl FrameWriter {
    /// Start a proxy of `width`×`height` (even sides) at `fps` into `out` (an .mp4, replaced if it is there).
    pub fn create(out: &Path, width: u32, height: u32, fps: f64) -> Result<Self> {
        ensure!(width >= 16 && height >= 16 && width % 2 == 0 && height % 2 == 0, "a proxy's sides are even: {width}×{height}");
        ensure!(fps > 0.0 && fps <= 240.0, "no such frame rate: {fps}");
        let _ = std::fs::remove_file(out);
        let out = std::path::absolute(out)?;
        // SAFETY: AVFoundation objects we create and own, used only from this thread (the type is not Send).
        unsafe {
            let writer = AVAssetWriter::assetWriterWithURL_fileType_error(
                &NSURL::fileURLWithPath(&NSString::from_str(&out.to_string_lossy())),
                AVFileTypeMPEG4.context("mp4")?,
            )
            .map_err(|e| anyhow::anyhow!("{e:?}"))?;
            // moov last: mp4::finish adds the comment and moves it to the front
            writer.setShouldOptimizeForNetworkUse(false);
            let bt709 = key("ITU_R_709_2");
            let color = dict(&[(&key("ColorPrimaries"), &bt709), (&key("TransferFunction"), &bt709), (&key("YCbCrMatrix"), &bt709)]);
            let (bitrate, gop) = (NSNumber::new_i32(12_000_000), NSNumber::new_i32(GOP));
            let main10 = key("HEVC_Main10_AutoLevel");
            let no_reorder = NSNumber::new_bool(false);
            let compression = dict(&[
                (&key("AverageBitRate"), &bitrate),
                (&key("MaxKeyFrameInterval"), &gop),
                (&key("ProfileLevel"), &main10),
                (&key("AllowFrameReordering"), &no_reorder),
            ]);
            let (w, h) = (NSNumber::new_u32(width), NSNumber::new_u32(height));
            let hevc = key("hvc1");
            let settings = dict(&[
                (&key("AVVideoCodecKey"), &hevc),
                (&key("AVVideoWidthKey"), &w),
                (&key("AVVideoHeightKey"), &h),
                (&key("AVVideoColorPropertiesKey"), &color),
                (&key("AVVideoCompressionPropertiesKey"), &compression),
            ]);
            let input = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(AVMediaTypeVideo.context("video")?, Some(&settings));
            input.setExpectsMediaDataInRealTime(false);
            writer.addInput(&input);
            let x420 = NSNumber::new_u32(u32::from_be_bytes(*b"x420")); // kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange
            let surface = NSDictionary::<NSString, AnyObject>::new();
            let frames = dict(&[(&key("PixelFormatType"), &x420), (&key("Width"), &w), (&key("Height"), &h), (&key("IOSurfaceProperties"), &surface)]);
            let adaptor = AVAssetWriterInputPixelBufferAdaptor::assetWriterInputPixelBufferAdaptorWithAssetWriterInput_sourcePixelBufferAttributes(
                &input,
                Some(&frames),
            );
            if !writer.startWriting() {
                bail!("cannot write {}: {:?}", out.display(), writer.error());
            }
            let timescale = (fps * STEP as f64).round() as i32;
            writer.startSessionAtSourceTime(CMTime { value: 0, timescale, flags: CMTimeFlags::Valid, epoch: 0 });
            let pool = adaptor.pixelBufferPool().context("the writer has no frame pool")?;
            Ok(Self { writer, input, adaptor, pool, out, width, height, timescale, frames: 0, finished: false })
        }
    }

    /// How many frames are in so far.
    pub fn frames(&self) -> u64 {
        self.frames as u64
    }

    /// One frame: `width`·`height` little-endian u32 words, R in bits 0–9, G 10–19, B 20–29 (ACEScct codes, full
    /// range), the top row first — what `__film.capture` returns.
    pub fn push(&mut self, x2bgr10: &[u8]) -> Result<()> {
        let (w, h) = (self.width as usize, self.height as usize);
        ensure!(x2bgr10.len() == w * h * 4, "a frame of {} bytes, not {}×{}×4", x2bgr10.len(), w, h);
        // SAFETY: the pool is the writer's; the buffer is ours (+1) and locked while its planes are written, within the
        // sizes CoreVideo gives for them.
        unsafe {
            let mut raw: *mut CVPixelBuffer = std::ptr::null_mut();
            let status = CVPixelBufferPool::create_pixel_buffer(None, &self.pool, std::ptr::NonNull::from(&mut raw));
            let buf = std::ptr::NonNull::new(raw).filter(|_| status == 0).with_context(|| format!("no frame from the pool ({status})"))?;
            let buf = CFRetained::from_raw(buf);
            for (k, v) in [
                (kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2),
                (kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2),
                (kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2),
            ] {
                buf.set_attachment(k, v, CVAttachmentMode::ShouldPropagate);
            }
            ensure!(CVPixelBufferLockBaseAddress(&buf, CVPixelBufferLockFlags(0)) == 0, "cannot lock the frame");
            let (y, y_stride) = (CVPixelBufferGetBaseAddressOfPlane(&buf, 0) as *mut u8, CVPixelBufferGetBytesPerRowOfPlane(&buf, 0));
            let (c, c_stride) = (CVPixelBufferGetBaseAddressOfPlane(&buf, 1) as *mut u8, CVPixelBufferGetBytesPerRowOfPlane(&buf, 1));
            if y.is_null() || c.is_null() {
                CVPixelBufferUnlockBaseAddress(&buf, CVPixelBufferLockFlags(0));
                bail!("the frame has no planes");
            }
            let y_plane = std::slice::from_raw_parts_mut(y, y_stride * h);
            let c_plane = std::slice::from_raw_parts_mut(c, c_stride * (h / 2));
            to_x420(x2bgr10, w, h, y_plane, y_stride, c_plane, c_stride);
            CVPixelBufferUnlockBaseAddress(&buf, CVPixelBufferLockFlags(0));

            // the encoder takes frames as fast as it can: wait for it, never queue more here
            while !self.input.isReadyForMoreMediaData() {
                if self.writer.status() == AVAssetWriterStatus::Failed {
                    bail!("the encoder failed: {:?}", self.writer.error());
                }
                std::thread::sleep(Duration::from_millis(2));
            }
            let t = CMTime { value: self.frames * STEP, timescale: self.timescale, flags: CMTimeFlags::Valid, epoch: 0 };
            if !self.adaptor.appendPixelBuffer_withPresentationTime(&buf, t) {
                bail!("frame {} refused: {:?}", self.frames, self.writer.error());
            }
        }
        self.frames += 1;
        Ok(())
    }

    /// Close the movie: its length is exactly its frames; the comment in, moov up front. The proxy as probed.
    pub fn finish(mut self) -> Result<Proxy> {
        ensure!(self.frames > 0, "no frames");
        self.finished = true;
        // SAFETY: our own writer, from the thread that made it.
        unsafe {
            self.input.markAsFinished();
            self.writer.endSessionAtSourceTime(CMTime { value: self.frames * STEP, timescale: self.timescale, flags: CMTimeFlags::Valid, epoch: 0 });
            #[allow(deprecated)]
            let done = self.writer.finishWriting();
            if !done || self.writer.status() != AVAssetWriterStatus::Completed {
                bail!("the proxy could not be finished: {:?}", self.writer.error());
            }
        }
        mp4::finish(&self.out, &format!("maiacity:color={WORKING}")).context("finish the mp4")?;
        let made = probe(&self.out).context("probe the proxy")?;
        Ok(Proxy { width: made.width, height: made.height, seconds: made.seconds, profile: WORKING.to_string() })
    }
}

impl Drop for FrameWriter {
    /// A proxy given up halfway leaves nothing behind.
    fn drop(&mut self) {
        if !self.finished {
            // SAFETY: our own writer, from the thread that made it.
            unsafe { self.writer.cancelWriting() };
            let _ = std::fs::remove_file(&self.out);
        }
    }
}

// BT.709, as ffmpeg's swscale takes full-range RGB to TV-range YCbCr at 10 bits
const KR: f32 = 0.2126;
const KB: f32 = 0.0722;
const KG: f32 = 1.0 - KR - KB;

/// Full-range 10-bit RGB codes → 10-bit TV-range Y'CbCr (Y 64…940, C 64…960 around 512), unrounded.
#[inline]
fn ycc(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let (r, g, b) = (r / 1023.0, g / 1023.0, b / 1023.0);
    let y = KR * r + KG * g + KB * b;
    (64.0 + 876.0 * y, 512.0 + 896.0 * (b - y) / (2.0 * (1.0 - KB)), 512.0 + 896.0 * (r - y) / (2.0 * (1.0 - KR)))
}

/// A 10-bit code in the high bits of a little-endian u16, as `x420` keeps it.
#[inline]
fn put(plane: &mut [u8], at: usize, v: f32) {
    let code = (v.round() as i32).clamp(0, 1023) as u16;
    plane[at..at + 2].copy_from_slice(&(code << 6).to_le_bytes());
}

/// x2bgr10le (top row first) into the two planes of an `x420` buffer: Y, then Cb Cr interleaved at half size.
pub fn to_x420(src: &[u8], w: usize, h: usize, y_plane: &mut [u8], y_stride: usize, c_plane: &mut [u8], c_stride: usize) {
    let word = |x: usize, y: usize| {
        let o = (y * w + x) * 4;
        u32::from_le_bytes([src[o], src[o + 1], src[o + 2], src[o + 3]])
    };
    // one row pair at a time: each pixel's Cb Cr, then sited and averaged
    let mut cb = vec![[0f32; 2]; w];
    let mut cr = vec![[0f32; 2]; w];
    for pair in 0..h / 2 {
        for k in 0..2 {
            let row = pair * 2 + k;
            for x in 0..w {
                let p = word(x, row);
                let (yy, b, r) = ycc((p & 1023) as f32, ((p >> 10) & 1023) as f32, ((p >> 20) & 1023) as f32);
                put(y_plane, row * y_stride + x * 2, yy);
                cb[x][k] = b;
                cr[x][k] = r;
            }
        }
        for cx in 0..w / 2 {
            let x = cx * 2;
            let (l, rr) = (x.saturating_sub(1), (x + 1).min(w - 1));
            let tap = |c: &[[f32; 2]]| (0.25 * (c[l][0] + c[l][1]) + 0.5 * (c[x][0] + c[x][1]) + 0.25 * (c[rr][0] + c[rr][1])) / 2.0;
            let at = pair * c_stride + cx * 4;
            put(c_plane, at, tap(&cb));
            put(c_plane, at + 2, tap(&cr));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(w: usize, h: usize, rgb: impl Fn(usize, usize) -> [u32; 3]) -> Vec<u8> {
        let mut out = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                let [r, g, b] = rgb(x, y);
                out.extend_from_slice(&(r | (g << 10) | (b << 20)).to_le_bytes());
            }
        }
        out
    }
    fn code(plane: &[u8], at: usize) -> u16 {
        u16::from_le_bytes([plane[at], plane[at + 1]]) >> 6
    }

    #[test]
    fn grey_and_colour_codes_as_ffmpeg_makes_them() {
        let (w, h) = (4, 2);
        // left half white, right half a pure red
        let src = frame(w, h, |x, _| if x < 2 { [1023, 1023, 1023] } else { [1023, 0, 0] });
        let (mut y, mut c) = (vec![0u8; w * h * 2], vec![0u8; w * h]);
        to_x420(&src, w, h, &mut y, w * 2, &mut c, w * 2);
        assert_eq!(code(&y, 0), 940); // white
        assert_eq!(code(&y, 4), (64.0 + 876.0 * KR).round() as u16); // red: 250
        // the first chroma sample sits on white: neutral
        assert_eq!((code(&c, 0), code(&c, 2)), (512, 512));
        // the second on red, with a quarter of white beside it
        let (_, cb, cr) = ycc(1023.0, 0.0, 0.0);
        let mix = |v: f32| (0.25 * 512.0 + 0.75 * v).round() as u16;
        assert_eq!((code(&c, 4), code(&c, 6)), (mix(cb), mix(cr)));
    }

    #[test]
    fn mid_grey_stays_mid_grey() {
        let src = frame(2, 2, |_, _| [512, 512, 512]);
        let (mut y, mut c) = (vec![0u8; 8], vec![0u8; 4]);
        to_x420(&src, 2, 2, &mut y, 4, &mut c, 4);
        assert_eq!(code(&y, 0), (64.0 + 876.0 * 512.0 / 1023.0_f32).round() as u16);
        assert_eq!((code(&c, 0), code(&c, 2)), (512, 512));
    }

    /// The whole path: synthetic frames in, a valid HEVC Main10 proxy out, tagged and decodable, codes kept.
    #[test]
    fn writes_a_proxy_from_frames() {
        let dir = std::env::temp_dir().join(format!("vault-media-frames-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("world.mp4");
        let (w, h, n) = (320usize, 180usize, 12);
        let mut writer = FrameWriter::create(&out, w as u32, h as u32, 30.0).unwrap();
        for k in 0..n {
            // a grey ramp across, moving a little every frame
            writer.push(&frame(w, h, |x, _| {
                let v = ((x * 1023 / w + k * 8) % 1024) as u32;
                [v, v, v]
            }))
            .unwrap();
        }
        assert_eq!(writer.frames(), n as u64);
        let made = writer.finish().unwrap();
        assert_eq!((made.width, made.height), (w as u32, h as u32));
        assert!((made.seconds - n as f64 / 30.0).abs() < 1e-3, "{} s", made.seconds);
        let p = probe(&out).unwrap();
        assert_eq!(p.codec, "hvc1");
        assert_eq!(p.frames, n as u64);
        assert_eq!(p.bits, Some(10));
        assert_eq!(p.matrix.as_deref(), Some("ITU_R_709_2"));
        assert_eq!(p.full_range, Some(false));
        assert!(p.tags.iter().any(|t| t.ends_with("maiacity:color=acescct")), "{:?}", p.tags);
        // decoded again, the first frame's luma is the ramp's: the log codes survived the encoder
        let luma = first_luma(&out);
        for x in [16usize, 80, 160, 240, 300] {
            let v = (x * 1023 / w) as f32;
            let want = ycc(v, v, v).0;
            let got = luma[90 * w + x] as f32;
            assert!((got - want).abs() <= 4.0, "x {x}: {got} for {want}");
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The first frame's Y codes, decoded as `x420`.
    fn first_luma(path: &Path) -> Vec<u16> {
        use objc2_av_foundation::{AVAssetReader, AVAssetReaderTrackOutput, AVAssetTrack, AVURLAsset};
        use objc2_core_video::{CVPixelBufferGetHeight, CVPixelBufferGetWidth};
        unsafe {
            let asset = AVURLAsset::URLAssetWithURL_options(&NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy())), None);
            #[allow(deprecated)]
            let track: Retained<AVAssetTrack> = Retained::cast_unchecked(asset.tracksWithMediaType(AVMediaTypeVideo.unwrap()).firstObject().unwrap());
            let reader = AVAssetReader::assetReaderWithAsset_error(&asset).unwrap();
            let x420 = NSNumber::new_u32(u32::from_be_bytes(*b"x420"));
            let settings = dict(&[(&key("PixelFormatType"), &x420)]);
            let output = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(&track, Some(&settings));
            reader.addOutput(&output);
            assert!(reader.startReading());
            let sample = output.copyNextSampleBuffer().unwrap();
            let buf = sample.image_buffer().unwrap();
            CVPixelBufferLockBaseAddress(&buf, CVPixelBufferLockFlags::ReadOnly);
            let (w, h) = (CVPixelBufferGetWidth(&buf), CVPixelBufferGetHeight(&buf));
            let (base, stride) = (CVPixelBufferGetBaseAddressOfPlane(&buf, 0) as *const u8, CVPixelBufferGetBytesPerRowOfPlane(&buf, 0));
            let plane = std::slice::from_raw_parts(base, stride * h);
            let out = (0..h).flat_map(|y| (0..w).map(move |x| (y, x))).map(|(y, x)| code(plane, y * stride + x * 2)).collect();
            CVPixelBufferUnlockBaseAddress(&buf, CVPixelBufferLockFlags::ReadOnly);
            out
        }
    }

    #[test]
    fn a_writer_given_up_leaves_nothing() {
        let out = std::env::temp_dir().join(format!("vault-media-frames-drop-{}.mp4", std::process::id()));
        let mut writer = FrameWriter::create(&out, 64, 64, 30.0).unwrap();
        writer.push(&frame(64, 64, |_, _| [0, 0, 0])).unwrap();
        assert!(writer.push(&[0u8; 12]).is_err());
        drop(writer);
        assert!(!out.exists());
    }
}
