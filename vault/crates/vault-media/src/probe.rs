//! What a file is, read by AVFoundation — the fields the render worker took from ffprobe: codec, frame size and rate,
//! length, bit depth, and the colour tags (primaries, transfer, matrix, range) that decide its input transform.

use anyhow::{Context, Result, bail};
use objc2::rc::Retained;
use objc2_av_foundation::{AVAssetTrack, AVMediaTypeAudio, AVMediaTypeVideo};
use objc2_core_foundation::{CFBoolean, CFNumber, CFRetained, CFString, CFType};
use objc2_core_media::{
    CMFormatDescription, kCMFormatDescriptionExtension_BitsPerComponent, kCMFormatDescriptionExtension_ColorPrimaries,
    kCMFormatDescriptionExtension_Depth, kCMFormatDescriptionExtension_FullRangeVideo,
    kCMFormatDescriptionExtension_TransferFunction, kCMFormatDescriptionExtension_YCbCrMatrix,
};
use objc2_foundation::{NSData, NSDictionary, NSString};
use serde::Serialize;

use crate::Source;

#[derive(Debug, Clone, Serialize, Default)]
pub struct Probe {
    /// the codec's four-character code: "hvc1", "avc1", "apcn" (ProRes 422), "ap4h" (ProRes 4444) …
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub seconds: f64,
    /// frames, from the track's length and rate
    pub frames: u64,
    /// bits per component, when the file says (10 for HEVC Main10, ProRes …)
    pub bits: Option<u32>,
    /// the colour tags as the file carries them (CoreMedia's names: "ITU_R_709_2", "P3_D65", "ITU_R_2100_HLG",
    /// "SMPTE_ST_2084_PQ", "AppleLog" …)
    pub primaries: Option<String>,
    pub transfer: Option<String>,
    pub matrix: Option<String>,
    pub full_range: Option<bool>,
    pub audio: bool,
    pub bit_rate: f64,
    /// the container's metadata as text ("identifier=value"): Apple's camera profile, our own comment, …
    pub tags: Vec<String>,
}

/// Probe a movie file (MOV, MP4, M4V): a path, or a `Source` read in place.
pub fn probe(src: impl Into<Source>) -> Result<Probe> {
    let src: Source = src.into();
    let asset = src.asset()?;
    // SAFETY: plain AVFoundation calls on objects we own; the synchronous accessors block until loaded.
    unsafe {
        let duration = asset.duration();
        let seconds = if duration.timescale > 0 { duration.value as f64 / duration.timescale as f64 } else { 0.0 };

        #[allow(deprecated)]
        let videos = asset.tracksWithMediaType(AVMediaTypeVideo.context("AVMediaTypeVideo")?);
        #[allow(deprecated)]
        let audios = asset.tracksWithMediaType(AVMediaTypeAudio.context("AVMediaTypeAudio")?);
        let Some(track) = videos.firstObject() else { bail!("{src} has no video track") };
        let track: Retained<AVAssetTrack> = Retained::cast_unchecked(track);

        let size = track.naturalSize();
        let fps = track.nominalFrameRate() as f64;
        let mut p = Probe {
            width: size.width.round() as u32,
            height: size.height.round() as u32,
            fps,
            seconds,
            frames: (seconds * fps).round() as u64,
            audio: audios.count() > 0,
            bit_rate: track.estimatedDataRate() as f64,
            ..Default::default()
        };

        for item in asset.metadata().iter() {
            let id = item.identifier().map(|i| i.to_string()).unwrap_or_default();
            if let Some(v) = item.stringValue() {
                // camera metadata can carry NULs and other control characters: text only (Postgres refuses \u0000)
                let v: String = v.to_string().chars().filter(|c| !c.is_control()).collect();
                p.tags.push(format!("{id}={v}"));
            }
        }
        // our own comment (udta ©cmt, written by mp4.rs) — AVFoundation reads it as QuickTime user data
        if let Some(c) = crate::mp4::read_comment_of(&src) {
            p.tags.push(format!("comment={c}"));
        }

        if let Some(desc) = track.formatDescriptions().firstObject() {
            let desc: &CMFormatDescription = &*(Retained::as_ptr(&desc) as *const CMFormatDescription);
            p.codec = fourcc(desc.media_sub_type());
            let text = |key: &CFString| desc.extension(key).and_then(|v| v.downcast::<CFString>().ok()).map(|s| s.to_string());
            let number = |key: &CFString| desc.extension(key).and_then(|v| v.downcast::<CFNumber>().ok()).and_then(|n| n.as_i64());
            p.primaries = text(kCMFormatDescriptionExtension_ColorPrimaries);
            p.transfer = text(kCMFormatDescriptionExtension_TransferFunction);
            p.matrix = text(kCMFormatDescriptionExtension_YCbCrMatrix);
            p.full_range = desc
                .extension(kCMFormatDescriptionExtension_FullRangeVideo)
                .and_then(|v| v.downcast::<CFBoolean>().ok())
                .map(|b| b.as_bool());
            p.bits = number(kCMFormatDescriptionExtension_BitsPerComponent)
                .or_else(|| number(kCMFormatDescriptionExtension_Depth).map(|d| if d > 24 { d / 3 } else { d }))
                .map(|b| b as u32);
            let _: Option<&CFType> = None;
            // the sample description's own atoms: some cameras say their log only there — the Blackmagic app and
            // the iPhone write `logs` = "com.apple.apple-wide-gamut.apple-log" (Apple Log 2) with an unspecified `colr`
            if let Some(ext) = desc.extensions() {
                let ext: &NSDictionary<NSString, objc2::runtime::AnyObject> = &*(CFRetained::as_ptr(&ext).as_ptr() as *const _);
                if let Some(atoms) = ext.objectForKey(&NSString::from_str("SampleDescriptionExtensionAtoms")) {
                    if let Some(atoms) = atoms.downcast_ref::<NSDictionary>() {
                        let atoms: &NSDictionary<NSString, objc2::runtime::AnyObject> = &*(atoms as *const NSDictionary as *const _);
                        for k in atoms.allKeys().iter() {
                            let Some(v) = atoms.objectForKey(&k) else { continue };
                            if let Some(d) = v.downcast_ref::<NSData>() {
                                let text: String = d.to_vec().iter().filter(|b| b.is_ascii_graphic()).map(|&b| b as char).collect();
                                if text.len() >= 4 {
                                    p.tags.push(format!("atom:{k}={text}"));
                                }
                            }
                        }
                    }
                }
                if let Some(v) = ext.objectForKey(&NSString::from_str("LogTransferFunction")).and_then(|v| v.downcast::<NSString>().ok()) {
                    p.tags.push(format!("LogTransferFunction={v}"));
                }
            }
        }
        Ok(p)
    }
}

fn fourcc(code: u32) -> String {
    code.to_be_bytes().iter().map(|&b| if b.is_ascii_graphic() || b == b' ' { b as char } else { '?' }).collect()
}
