//! A recording's sound as the speech model hears it: AVFoundation decodes the file's first sound track (a movie's or a
//! sound file's — AAC, PCM, whatever it reads) straight to 32-bit float PCM, mono, at the rate asked for (the
//! recognizer's 16 kHz): AVAssetReader resamples and mixes down itself. Nothing to install, no ffmpeg.

use std::path::Path;

use anyhow::{Context, Result, bail};
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_av_foundation::{AVAssetReader, AVAssetReaderTrackOutput, AVAssetTrack, AVMediaTypeAudio, AVURLAsset};
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};

fn key(s: &str) -> Retained<NSString> {
    NSString::from_str(s)
}

fn dict(pairs: &[(&NSString, &AnyObject)]) -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys: Vec<&NSString> = pairs.iter().map(|(k, _)| *k).collect();
    let values: Vec<&AnyObject> = pairs.iter().map(|(_, v)| *v).collect();
    NSDictionary::from_slices(&keys, &values)
}

/// The file's sound, mono, at `rate` Hz, as f32 samples; `progress` gets 0…1 by the time read. None: it has no sound
/// track.
pub fn decode_mono(src: &Path, rate: u32, progress: &mut dyn FnMut(f64)) -> Result<Option<Vec<f32>>> {
    let src = std::fs::canonicalize(src).with_context(|| format!("{} is not there", src.display()))?;
    // SAFETY: AVFoundation objects we create and own, used from this thread only; the block buffer is copied into our
    // own Vec with its length checked.
    unsafe {
        let asset = AVURLAsset::URLAssetWithURL_options(&NSURL::fileURLWithPath(&NSString::from_str(&src.to_string_lossy())), None);
        #[allow(deprecated)]
        let Some(track) = asset.tracksWithMediaType(AVMediaTypeAudio.context("audio")?).firstObject() else { return Ok(None) };
        let track: Retained<AVAssetTrack> = Retained::cast_unchecked(track);
        #[allow(deprecated)]
        let seconds = {
            let d = asset.duration();
            if d.timescale > 0 { d.value as f64 / d.timescale as f64 } else { 0.0 }
        };
        let reader = AVAssetReader::assetReaderWithAsset_error(&asset).map_err(|e| anyhow::anyhow!("{e:?}"))?;
        let (lpcm, sr, one, bits, yes, no) =
            (NSNumber::new_u32(u32::from_be_bytes(*b"lpcm")), NSNumber::new_f64(rate as f64), NSNumber::new_u32(1), NSNumber::new_u32(32), NSNumber::new_bool(true), NSNumber::new_bool(false));
        let settings = dict(&[
            (&key("AVFormatIDKey"), &lpcm),
            (&key("AVSampleRateKey"), &sr),
            (&key("AVNumberOfChannelsKey"), &one),
            (&key("AVLinearPCMBitDepthKey"), &bits),
            (&key("AVLinearPCMIsFloatKey"), &yes),
            (&key("AVLinearPCMIsBigEndianKey"), &no),
            (&key("AVLinearPCMIsNonInterleaved"), &no),
        ]);
        let output = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(&track, Some(&settings));
        output.setAlwaysCopiesSampleData(false);
        reader.addOutput(&output);
        if !reader.startReading() {
            bail!("cannot read the sound of {}: {:?}", src.display(), reader.error());
        }
        let expected = (seconds * rate as f64) as usize;
        let mut out: Vec<f32> = Vec::with_capacity(expected + rate as usize);
        let mut last = 0.0;
        while let Some(sample) = output.copyNextSampleBuffer() {
            let Some(block) = sample.data_buffer() else { continue };
            let len = block.data_length();
            if len == 0 {
                continue;
            }
            let start = out.len();
            out.resize(start + len / 4, 0.0);
            let status = block.copy_data_bytes(0, (len / 4) * 4, std::ptr::NonNull::new(out[start..].as_mut_ptr().cast()).context("no room")?);
            if status != 0 {
                bail!("the sound could not be copied (CoreMedia {status})");
            }
            if expected > 0 {
                let done = (out.len() as f64 / expected as f64).min(1.0);
                if done - last >= 0.01 {
                    last = done;
                    progress(done);
                }
            }
        }
        if reader.status() == objc2_av_foundation::AVAssetReaderStatus::Failed {
            bail!("reading the sound failed: {:?}", reader.error());
        }
        progress(1.0);
        Ok(Some(out))
    }
}
