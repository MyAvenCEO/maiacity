//! AVFoundation for the render: reading a stretch of a movie's frames (decoded in hardware, one or two held at a
//! time), reading a stretch of any file's sound as 48 kHz float, and writing a delivery — HEVC Main10 or H.264 through
//! VideoToolbox, AAC, BT.709 tags — with the sound fed in step with the pictures.

use std::{path::Path, ptr::NonNull, time::Duration};

use vault_media::Source;

use anyhow::{Context, Result, anyhow, bail};
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_av_foundation::{
    AVAssetReader, AVAssetReaderStatus, AVAssetReaderTrackOutput, AVAssetTrack, AVAssetWriter, AVAssetWriterInput,
    AVAssetWriterInputPixelBufferAdaptor, AVAssetWriterStatus, AVFileTypeMPEG4, AVMediaTypeAudio, AVMediaTypeVideo, AVURLAsset,
};
use objc2_core_foundation::{CFRetained, CGAffineTransform};
use objc2_core_media::{CMAudioFormatDescriptionGetStreamBasicDescription, CMFormatDescription, CMSampleBuffer, CMTime, CMTimeFlags, CMTimeRange};
use objc2_core_video::{
    CVAttachmentMode, CVPixelBuffer, CVPixelBufferPool, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2,
    kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2, kCVImageBufferYCbCrMatrixKey,
    kCVImageBufferYCbCrMatrix_ITU_R_709_2,
};
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};

/// The sound's rate everywhere in the render.
pub const RATE: u32 = 48_000;

pub fn key(s: &str) -> Retained<NSString> {
    NSString::from_str(s)
}

pub fn dict(pairs: &[(&NSString, &AnyObject)]) -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys: Vec<&NSString> = pairs.iter().map(|(k, _)| *k).collect();
    let values: Vec<&AnyObject> = pairs.iter().map(|(_, v)| *v).collect();
    NSDictionary::from_slices(&keys, &values)
}

pub fn fourcc(s: &[u8; 4]) -> Retained<NSNumber> {
    NSNumber::new_u32(u32::from_be_bytes(*s))
}

pub fn cmtime(seconds: f64) -> CMTime {
    CMTime { value: (seconds * 600_000.0).round() as i64, timescale: 600_000, flags: CMTimeFlags::Valid, epoch: 0 }
}

pub fn seconds(t: CMTime) -> f64 {
    if t.timescale > 0 && t.flags.contains(CMTimeFlags::Valid) { t.value as f64 / t.timescale as f64 } else { f64::NAN }
}

/// The asset of a file on disk, or of a blob read in place (vault_media's resource loader).
fn asset(src: &Source) -> Result<Retained<AVURLAsset>> {
    src.asset()
}

fn first_track(asset: &AVURLAsset, audio: bool) -> Result<Option<Retained<AVAssetTrack>>> {
    // SAFETY: the synchronous accessor blocks until the tracks are loaded
    unsafe {
        let kind = if audio { AVMediaTypeAudio } else { AVMediaTypeVideo }.context("media type")?;
        #[allow(deprecated)]
        let t = asset.tracksWithMediaType(kind).firstObject();
        Ok(t.map(|t| Retained::cast_unchecked(t)))
    }
}

fn reader_error(reader: &AVAssetReader) -> anyhow::Error {
    // SAFETY: getters
    unsafe {
        let e = reader.error();
        let under = e.as_ref().and_then(|e| e.userInfo().objectForKey(&NSString::from_str("NSUnderlyingError")).map(|u| format!("{u:?}")));
        anyhow!("reading failed: {e:?} — {under:?}")
    }
}

/// A movie's picture track: its frame as stored and how it is meant to be turned.
#[derive(Debug, Clone, Copy)]
pub struct VideoInfo {
    pub width: f64,
    pub height: f64,
    pub fps: f64,
    pub transform: CGAffineTransform,
}

/// A stretch of a movie's frames, decoded to 10-bit 4:2:2 (Core Image reads their matrix and range from the frames'
/// own tags): a ProRes 422 original keeps its full colour at full size — its grading stills, hero frames and the render
/// see every chroma sample the iPhone recorded; a 4:2:0 source is filled out. Holds the frame shown and the one after
/// it, never more.
pub struct VideoReader {
    reader: Retained<AVAssetReader>,
    output: Retained<AVAssetReaderTrackOutput>,
    cur: Option<(f64, CFRetained<CVPixelBuffer>)>,
    next: Option<(f64, CFRetained<CVPixelBuffer>)>,
    done: bool,
    pub info: VideoInfo,
}

impl VideoReader {
    /// Frames from `from` to `until` (seconds of the file).
    pub fn open(src: impl Into<Source>, from: f64, until: f64) -> Result<Self> {
        let src: Source = src.into();
        let asset = asset(&src)?;
        let track = first_track(&asset, false)?.with_context(|| format!("{src} has no picture"))?;
        // SAFETY: AVFoundation objects we create and own, used from this thread only
        unsafe {
            let size = track.naturalSize();
            let info = VideoInfo { width: size.width, height: size.height, fps: track.nominalFrameRate() as f64, transform: track.preferredTransform() };
            let reader = AVAssetReader::assetReaderWithAsset_error(&asset).map_err(|e| anyhow!("{e:?}"))?;
            // kCVPixelFormatType_422YpCbCr10BiPlanarVideoRange
            let x422 = fourcc(b"x422");
            let settings = dict(&[(&key("PixelFormatType"), &x422)]);
            let output = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(&track, Some(&settings));
            output.setAlwaysCopiesSampleData(false);
            reader.addOutput(&output);
            let start = (from - 0.1).max(0.0);
            reader.setTimeRange(CMTimeRange { start: cmtime(start), duration: cmtime((until - start).max(0.0) + 0.2) });
            if !reader.startReading() {
                return Err(reader_error(&reader)).with_context(|| format!("{src}"));
            }
            Ok(Self { reader, output, cur: None, next: None, done: false, info })
        }
    }

    fn pull(&mut self) -> Result<Option<(f64, CFRetained<CVPixelBuffer>)>> {
        loop {
            // SAFETY: as above
            let sample = unsafe { self.output.copyNextSampleBuffer() };
            let Some(sample) = sample else {
                // SAFETY: a getter
                if unsafe { self.reader.status() } == AVAssetReaderStatus::Failed {
                    return Err(reader_error(&self.reader));
                }
                self.done = true;
                return Ok(None);
            };
            // SAFETY: getters of a sample buffer we own
            let (t, image) = unsafe { (seconds(sample.presentation_time_stamp()), sample.image_buffer()) };
            if let Some(image) = image {
                return Ok(Some((t, image)));
            }
        }
    }

    /// Every frame in turn, with its time (seconds of the file): the shot analysis walks a whole proxy this way. Not
    /// to be mixed with `at`.
    pub fn next_frame(&mut self) -> Result<Option<(f64, CFRetained<CVPixelBuffer>)>> {
        if self.done {
            return Ok(None);
        }
        self.pull()
    }

    /// The frame on screen at `t` (seconds of the file): the last one that starts before it, else the first.
    pub fn at(&mut self, t: f64) -> Result<Option<&CVPixelBuffer>> {
        if self.cur.is_none() {
            self.cur = self.pull()?;
        }
        loop {
            if self.next.is_none() && !self.done {
                self.next = self.pull()?;
            }
            match &self.next {
                Some((pts, _)) if *pts <= t => self.cur = self.next.take(),
                _ => break,
            }
        }
        Ok(self.cur.as_ref().map(|(_, pb)| &**pb))
    }
}

impl Drop for VideoReader {
    fn drop(&mut self) {
        // SAFETY: stopping a reader we own
        unsafe {
            if self.reader.status() == AVAssetReaderStatus::Reading {
                self.reader.cancelReading();
            }
        }
    }
}

/// A stretch of a file's sound as interleaved stereo f32 at 48 kHz. Mono comes up to stereo at −3 dB a side, as
/// ffmpeg's `aformat=channel_layouts=stereo` does it.
pub struct AudioReader {
    reader: Retained<AVAssetReader>,
    output: Retained<AVAssetReaderTrackOutput>,
    channels: usize,
    done: bool,
}

impl AudioReader {
    /// None when the file has no sound.
    pub fn open(src: impl Into<Source>, from: f64, until: f64) -> Result<Option<Self>> {
        let src: Source = src.into();
        let asset = asset(&src)?;
        let Some(track) = first_track(&asset, true)? else { return Ok(None) };
        // SAFETY: as VideoReader
        unsafe {
            let mut channels = 2u32;
            if let Some(desc) = track.formatDescriptions().firstObject() {
                let desc: &CMFormatDescription = &*(Retained::as_ptr(&desc) as *const CMFormatDescription);
                let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(desc);
                if !asbd.is_null() {
                    channels = (*asbd).mChannelsPerFrame.max(1);
                }
            }
            let channels = channels.min(2);
            let reader = AVAssetReader::assetReaderWithAsset_error(&asset).map_err(|e| anyhow!("{e:?}"))?;
            let (lpcm, bits, yes, no) = (fourcc(b"lpcm"), NSNumber::new_i32(32), NSNumber::new_bool(true), NSNumber::new_bool(false));
            let (rate, n) = (NSNumber::new_f64(RATE as f64), NSNumber::new_u32(channels));
            let settings = dict(&[
                (&key("AVFormatIDKey"), &lpcm),
                (&key("AVLinearPCMBitDepthKey"), &bits),
                (&key("AVLinearPCMIsFloatKey"), &yes),
                (&key("AVLinearPCMIsBigEndianKey"), &no),
                (&key("AVLinearPCMIsNonInterleaved"), &no),
                (&key("AVSampleRateKey"), &rate),
                (&key("AVNumberOfChannelsKey"), &n),
            ]);
            let output = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(&track, Some(&settings));
            output.setAlwaysCopiesSampleData(false);
            reader.addOutput(&output);
            reader.setTimeRange(CMTimeRange { start: cmtime(from.max(0.0)), duration: cmtime((until - from.max(0.0)).max(0.0)) });
            if !reader.startReading() {
                return Err(reader_error(&reader)).with_context(|| format!("{src}"));
            }
            Ok(Some(Self { reader, output, channels: channels as usize, done: false }))
        }
    }

    /// The next chunk: where it starts (seconds of the file) and its stereo frames; None at the end.
    pub fn next_chunk(&mut self) -> Result<Option<(f64, Vec<f32>)>> {
        if self.done {
            return Ok(None);
        }
        loop {
            // SAFETY: as above
            let Some(sample) = (unsafe { self.output.copyNextSampleBuffer() }) else {
                // SAFETY: a getter
                if unsafe { self.reader.status() } == AVAssetReaderStatus::Failed {
                    return Err(reader_error(&self.reader));
                }
                self.done = true;
                return Ok(None);
            };
            // SAFETY: reading the bytes of a sample buffer we own into a buffer of their size
            unsafe {
                let t = seconds(sample.presentation_time_stamp());
                let Some(block) = sample.data_buffer() else { continue };
                let len = block.data_length();
                let mut raw = vec![0f32; len / 4];
                if len == 0 {
                    continue;
                }
                let status = block.copy_data_bytes(0, raw.len() * 4, NonNull::new(raw.as_mut_ptr().cast()).unwrap());
                if status != 0 {
                    bail!("cannot read the sound ({status})");
                }
                let stereo = if self.channels == 1 {
                    let k = std::f32::consts::FRAC_1_SQRT_2;
                    raw.iter().flat_map(|&x| [x * k, x * k]).collect()
                } else {
                    raw
                };
                return Ok(Some((t, stereo)));
            }
        }
    }
}

/// What a delivery is encoded as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Codec {
    /// HEVC Main10, 10-bit 4:2:0 (the 4K master)
    Hevc,
    /// H.264 High, 8-bit 4:2:0 (the copies)
    H264,
}

#[derive(Debug, Clone)]
pub struct VideoSettings {
    pub codec: Codec,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// average video bit rate
    pub bitrate: u32,
    /// a keyframe at least every this many frames
    pub keyframes: u32,
    /// AAC bit rate
    pub audio_bitrate: u32,
}

/// A delivery being written: pictures pushed one by one, the sound (a float WAV of the whole film) fed in step.
pub struct Writer {
    writer: Retained<AVAssetWriter>,
    video: Retained<AVAssetWriterInput>,
    adaptor: Retained<AVAssetWriterInputPixelBufferAdaptor>,
    pool: Retained<CVPixelBufferPool>,
    audio: Option<(Retained<AVAssetWriterInput>, AudioFeed)>,
    fps: u32,
    frames: u64,
    pub path: std::path::PathBuf,
}

/// The mixed sound, read back as sample buffers for the AAC encoder.
struct AudioFeed {
    reader: Retained<AVAssetReader>,
    output: Retained<AVAssetReaderTrackOutput>,
    pending: Option<Retained<CMSampleBuffer>>,
    done: bool,
}

impl AudioFeed {
    fn open(wav: &Path) -> Result<Self> {
        let asset = asset(&Source::from(wav))?;
        let track = first_track(&asset, true)?.context("the mix has no sound")?;
        // SAFETY: as VideoReader
        unsafe {
            let reader = AVAssetReader::assetReaderWithAsset_error(&asset).map_err(|e| anyhow!("{e:?}"))?;
            let lpcm = fourcc(b"lpcm");
            let settings = dict(&[(&key("AVFormatIDKey"), &lpcm)]);
            let output = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(&track, Some(&settings));
            reader.addOutput(&output);
            if !reader.startReading() {
                return Err(reader_error(&reader));
            }
            Ok(Self { reader, output, pending: None, done: false })
        }
    }

    /// Feed `input` while it takes more and the sound is before `until` (seconds).
    fn pump(&mut self, input: &AVAssetWriterInput, until: f64) -> Result<bool> {
        let mut moved = false;
        // SAFETY: AVFoundation objects we own, this thread only
        unsafe {
            while !self.done && input.isReadyForMoreMediaData() {
                if self.pending.is_none() {
                    self.pending = self.output.copyNextSampleBuffer();
                    if self.pending.is_none() {
                        if self.reader.status() == AVAssetReaderStatus::Failed {
                            return Err(reader_error(&self.reader));
                        }
                        self.done = true;
                        input.markAsFinished();
                        break;
                    }
                }
                let s = self.pending.as_ref().unwrap();
                if seconds(s.presentation_time_stamp()) > until {
                    break;
                }
                if !input.appendSampleBuffer(s) {
                    bail!("the sound was refused");
                }
                self.pending = None;
                moved = true;
            }
        }
        Ok(moved)
    }
}

impl Writer {
    /// A new delivery at `out` (an .mp4); `sound`: the film's mixed sound as a float WAV.
    pub fn create(out: &Path, v: &VideoSettings, sound: Option<&Path>) -> Result<Self> {
        let _ = std::fs::remove_file(out);
        let out_abs = std::path::absolute(out)?;
        // SAFETY: AVFoundation objects we create and own; only this thread calls them
        unsafe {
            let writer = AVAssetWriter::assetWriterWithURL_fileType_error(
                &NSURL::fileURLWithPath(&NSString::from_str(&out_abs.to_string_lossy())),
                AVFileTypeMPEG4.context("mp4")?,
            )
            .map_err(|e| anyhow!("{e:?}"))?;
            // moov last for now: vault_media::mp4::finish moves it to the front (+faststart) and adds the comment
            writer.setShouldOptimizeForNetworkUse(false);

            let bt709 = key("ITU_R_709_2");
            let color = dict(&[(&key("ColorPrimaries"), &bt709), (&key("TransferFunction"), &bt709), (&key("YCbCrMatrix"), &bt709)]);
            let (bitrate, gop, fps) = (NSNumber::new_u32(v.bitrate), NSNumber::new_u32(v.keyframes), NSNumber::new_u32(v.fps));
            let profile = key(match v.codec {
                Codec::Hevc => "HEVC_Main10_AutoLevel",
                Codec::H264 => "H264_High_AutoLevel",
            });
            let compression = dict(&[
                (&key("AverageBitRate"), &bitrate),
                (&key("MaxKeyFrameInterval"), &gop),
                (&key("ProfileLevel"), &profile),
                (&key("ExpectedFrameRate"), &fps),
            ]);
            let (width, height) = (NSNumber::new_u32(v.width), NSNumber::new_u32(v.height));
            let codec = key(match v.codec {
                Codec::Hevc => "hvc1",
                Codec::H264 => "avc1",
            });
            let video_settings = dict(&[
                (&key("AVVideoCodecKey"), &codec),
                (&key("AVVideoWidthKey"), &width),
                (&key("AVVideoHeightKey"), &height),
                (&key("AVVideoColorPropertiesKey"), &color),
                (&key("AVVideoCompressionPropertiesKey"), &compression),
            ]);
            let video_kind = AVMediaTypeVideo.context("video")?;
            if !writer.canApplyOutputSettings_forMediaType(Some(&video_settings), video_kind) {
                bail!("this Mac cannot encode {:?} {}×{} at {} b/s", v.codec, v.width, v.height, v.bitrate);
            }
            let video = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(video_kind, Some(&video_settings));
            video.setExpectsMediaDataInRealTime(false);
            writer.addInput(&video);
            let pixel = fourcc(match v.codec {
                Codec::Hevc => b"x420",
                Codec::H264 => b"420v",
            });
            let surface = NSDictionary::<NSString, AnyObject>::new();
            let frames = dict(&[(&key("PixelFormatType"), &pixel), (&key("Width"), &width), (&key("Height"), &height), (&key("IOSurfaceProperties"), &surface)]);
            let adaptor = AVAssetWriterInputPixelBufferAdaptor::assetWriterInputPixelBufferAdaptorWithAssetWriterInput_sourcePixelBufferAttributes(&video, Some(&frames));

            let audio = match sound {
                None => None,
                Some(wav) => {
                    let audio_kind = AVMediaTypeAudio.context("audio")?;
                    let (aac, two, rate) = (fourcc(b"aac "), NSNumber::new_i32(2), NSNumber::new_f64(RATE as f64));
                    // Apple's AAC encoder takes at most 320 kb/s for 48 kHz stereo (it says yes to more, then fails): a higher ask is taken down to it
                    let mut abr = v.audio_bitrate.min(320_000);
                    let settings = loop {
                        let b = NSNumber::new_u32(abr);
                        let s = dict(&[(&key("AVFormatIDKey"), &aac), (&key("AVNumberOfChannelsKey"), &two), (&key("AVSampleRateKey"), &rate), (&key("AVEncoderBitRateKey"), &b)]);
                        if writer.canApplyOutputSettings_forMediaType(Some(&s), audio_kind) {
                            break s;
                        }
                        if abr <= 128_000 {
                            bail!("this Mac cannot encode AAC stereo at 48 kHz");
                        }
                        abr = if abr > 320_000 { 320_000 } else { abr - 32_000 };
                    };
                    let input = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(audio_kind, Some(&settings));
                    input.setExpectsMediaDataInRealTime(false);
                    writer.addInput(&input);
                    Some((input, AudioFeed::open(wav)?))
                }
            };

            if !writer.startWriting() {
                bail!("cannot write {}: {:?}", out.display(), writer.error());
            }
            writer.startSessionAtSourceTime(CMTime { value: 0, timescale: v.fps as i32, flags: CMTimeFlags::Valid, epoch: 0 });
            let pool = adaptor.pixelBufferPool().context("the writer has no frame pool")?;
            Ok(Self { writer, video, adaptor, pool, audio, fps: v.fps, frames: 0, path: out_abs })
        }
    }

    /// A fresh buffer from the encoder's pool, tagged BT.709 (Core Image renders into it by those tags).
    pub fn buffer(&self) -> Result<CFRetained<CVPixelBuffer>> {
        let mut out: *mut CVPixelBuffer = std::ptr::null_mut();
        // SAFETY: the pool is the writer's; `out` is written by the call and owned (+1) by us after it
        let status = unsafe { CVPixelBufferPool::create_pixel_buffer(None, &self.pool, NonNull::from(&mut out)) };
        let out = NonNull::new(out).filter(|_| status == 0).with_context(|| format!("no frame from the pool ({status})"))?;
        let out = unsafe { CFRetained::from_raw(out) };
        // SAFETY: attaching constant tags to a buffer we own
        unsafe {
            for (k, v) in [
                (kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2),
                (kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2),
                (kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2),
            ] {
                out.set_attachment(k, v, CVAttachmentMode::ShouldPropagate);
            }
        }
        Ok(out)
    }

    fn pump_audio(&mut self, until: f64) -> Result<bool> {
        match &mut self.audio {
            Some((input, feed)) => feed.pump(input, until).map_err(|e| anyhow!("{e}: {:?}", unsafe { self.writer.error() })),
            None => Ok(false),
        }
    }

    /// The next frame of the film.
    pub fn push(&mut self, frame: &CVPixelBuffer) -> Result<()> {
        let t = self.frames as f64 / self.fps as f64;
        // SAFETY: AVFoundation objects we own, this thread only
        unsafe {
            while !self.video.isReadyForMoreMediaData() {
                // the writer waits for sound to interleave: give it what it takes
                if !self.pump_audio(t + 1.0)? {
                    std::thread::sleep(Duration::from_millis(1));
                }
                if self.writer.status() == AVAssetWriterStatus::Failed {
                    bail!("writing failed: {:?}", self.writer.error());
                }
            }
            let at = CMTime { value: self.frames as i64, timescale: self.fps as i32, flags: CMTimeFlags::Valid, epoch: 0 };
            if !self.adaptor.appendPixelBuffer_withPresentationTime(frame, at) {
                bail!("frame {} refused: {:?}", self.frames, self.writer.error());
            }
        }
        self.frames += 1;
        self.pump_audio(t + 0.5)?;
        Ok(())
    }

    pub fn frames(&self) -> u64 {
        self.frames
    }

    /// The last of the sound in, the file closed, moov in front with `comment`.
    pub fn finish(mut self, comment: &str) -> Result<std::path::PathBuf> {
        // SAFETY: AVFoundation objects we own, this thread only
        unsafe {
            self.video.markAsFinished();
            loop {
                let done = match &self.audio {
                    Some((_, feed)) => feed.done,
                    None => true,
                };
                if done {
                    break;
                }
                if !self.pump_audio(f64::INFINITY)? {
                    std::thread::sleep(Duration::from_millis(1));
                }
                if self.writer.status() == AVAssetWriterStatus::Failed {
                    bail!("writing failed: {:?}", self.writer.error());
                }
            }
            #[allow(deprecated)]
            let finished = self.writer.finishWriting();
            if !finished || self.writer.status() != AVAssetWriterStatus::Completed {
                bail!("{} could not be finished: {:?}", self.path.display(), self.writer.error());
            }
        }
        vault_media::mp4::finish(&self.path, comment).context("moov in front")?;
        Ok(self.path.clone())
    }
}
