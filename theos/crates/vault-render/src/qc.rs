//! QC before a delivery goes to the vault — qc.mjs, natively: what the file says it is (BT.709 primaries, transfer and
//! matrix, TV range; the bit depth; the codec; the frame size), that it has every frame of the timeline and runs its
//! length, the platforms' limits — and its loudness, measured from the delivered file's own (AAC) sound. A file that
//! fails a hard check never reaches the vault. The same JSON as qc.mjs's `Qc`, so the studio shows it as before.

use std::path::Path;

use anyhow::{Context, Result, anyhow};
use objc2::rc::Retained;
use objc2_av_foundation::{AVAssetReader, AVAssetReaderTrackOutput, AVAssetTrack, AVMediaTypeVideo, AVURLAsset};
use objc2_core_media::CMFormatDescription;
use objc2_foundation::{NSData, NSDictionary, NSString, NSURL};
use serde::Serialize;

use crate::{
    av::{AudioReader, RATE},
    loudness::{Loudness, Meter},
};

#[derive(Debug, Clone)]
pub struct Want {
    pub seconds: f64,
    pub fps: f64,
    pub bit_depth: u32,
    pub width: u32,
    pub height: u32,
    /// "hevc" or "h264"
    pub codec: &'static str,
    pub max_bitrate: Option<f64>,
    pub max_bytes: Option<u64>,
    pub max_seconds: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Tags {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primaries: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transfer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matrix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Qc {
    pub ok: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub frames: u64,
    pub expected_frames: u64,
    pub seconds: f64,
    pub pix_fmt: String,
    pub bit_depth: u32,
    pub tags: Tags,
    pub bitrate: u64,
    pub bytes: u64,
}

/// CoreMedia's colour names as ffprobe says them.
fn ff_name(cm: Option<&str>) -> Option<String> {
    cm.map(|s| {
        match s {
            "ITU_R_709_2" => "bt709",
            "ITU_R_2020" => "bt2020",
            "ITU_R_601_4" | "SMPTE_170M" => "smpte170m",
            "P3_D65" => "p3d65",
            "ITU_R_2100_HLG" => "arib-std-b67",
            "SMPTE_ST_2084_PQ" => "smpte2084",
            "Linear" => "linear",
            other => other,
        }
        .to_string()
    })
}

/// The picture track's frames (packets, as `ffprobe -count_packets`), and its bit depth from the decoder
/// configuration (hvcC's bitDepthLumaMinus8; avcC's profile).
fn frames_and_depth(path: &Path) -> Result<(u64, u32)> {
    let path = std::fs::canonicalize(path)?;
    // SAFETY: AVFoundation objects we create and own, this thread only
    unsafe {
        let asset = AVURLAsset::URLAssetWithURL_options(&NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy())), None);
        #[allow(deprecated)]
        let track = asset.tracksWithMediaType(AVMediaTypeVideo.context("video")?).firstObject().context("no picture")?;
        let track: Retained<AVAssetTrack> = Retained::cast_unchecked(track);
        let mut depth = 8;
        if let Some(desc) = track.formatDescriptions().firstObject() {
            let desc: &CMFormatDescription = &*(Retained::as_ptr(&desc) as *const CMFormatDescription);
            if let Some(ext) = desc.extensions() {
                let ext: &NSDictionary<NSString, objc2::runtime::AnyObject> = &*(objc2_core_foundation::CFRetained::as_ptr(&ext).as_ptr() as *const _);
                if let Some(atoms) = ext.objectForKey(&NSString::from_str("SampleDescriptionExtensionAtoms")).and_then(|a| a.downcast::<NSDictionary>().ok()) {
                    let atoms: &NSDictionary<NSString, objc2::runtime::AnyObject> = &*(Retained::as_ptr(&atoms) as *const _);
                    if let Some(h) = atoms.objectForKey(&NSString::from_str("hvcC")).and_then(|d| d.downcast::<NSData>().ok()) {
                        let b = h.to_vec();
                        if b.len() > 17 {
                            depth = (b[17] & 7) as u32 + 8;
                        }
                    } else if let Some(a) = atoms.objectForKey(&NSString::from_str("avcC")).and_then(|d| d.downcast::<NSData>().ok()) {
                        let b = a.to_vec();
                        if b.len() > 1 && matches!(b[1], 110 | 122 | 244) {
                            depth = 10;
                        }
                    }
                }
            }
        }
        let reader = AVAssetReader::assetReaderWithAsset_error(&asset).map_err(|e| anyhow!("{e:?}"))?;
        let output = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(&track, None);
        output.setAlwaysCopiesSampleData(false);
        reader.addOutput(&output);
        if !reader.startReading() {
            return Err(anyhow!("cannot read {}: {:?}", path.display(), reader.error()));
        }
        let mut frames = 0u64;
        while let Some(s) = output.copyNextSampleBuffer() {
            frames += s.num_samples().max(0) as u64;
        }
        Ok((frames, depth))
    }
}

/// qc.mjs `qc`.
pub fn qc(file: &Path, want: &Want) -> Result<Qc> {
    let p = vault_media::probe(file)?;
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let range = match p.full_range {
        Some(true) => Some("pc".to_string()),
        Some(false) => Some("tv".to_string()),
        None => None,
    };
    let tags = Tags { primaries: ff_name(p.primaries.as_deref()), transfer: ff_name(p.transfer.as_deref()), matrix: ff_name(p.matrix.as_deref()), range };
    for (k, v, want) in [("primaries", &tags.primaries, "bt709"), ("transfer", &tags.transfer, "bt709"), ("matrix", &tags.matrix, "bt709"), ("range", &tags.range, "tv")] {
        if v.as_deref() != Some(want) {
            errors.push(format!("{k} is tagged {}, not {want}", v.as_deref().unwrap_or("nothing")));
        }
    }
    let (frames, bit_depth) = frames_and_depth(file)?;
    let pix_fmt = if bit_depth == 10 { "yuv420p10le" } else { "yuv420p" }.to_string();
    if bit_depth != want.bit_depth {
        errors.push(format!("{bit_depth}-bit picture ({pix_fmt}), not {}-bit", want.bit_depth));
    }
    let codec = match p.codec.as_str() {
        "hvc1" | "hev1" => "hevc",
        "avc1" | "avc3" => "h264",
        other => other,
    };
    if codec != want.codec {
        errors.push(format!("codec {codec}, not {}", want.codec));
    }
    if p.width != want.width || p.height != want.height {
        errors.push(format!("{}×{}, not {}×{}", p.width, p.height, want.width, want.height));
    }
    let expected_frames = (want.seconds * want.fps).round() as u64;
    if frames.abs_diff(expected_frames) > 1 {
        errors.push(format!("{frames} frames, the timeline has {expected_frames}"));
    }
    let seconds = p.seconds;
    if (seconds - want.seconds).abs() > 2.0 / want.fps + 0.05 {
        errors.push(format!("{seconds:.3} s long, the timeline is {:.3} s", want.seconds));
    }
    if !p.audio {
        errors.push("no sound".into());
    }
    let bytes = std::fs::metadata(file)?.len();
    let bitrate = if p.bit_rate > 0.0 { p.bit_rate } else if seconds > 0.0 { bytes as f64 * 8.0 / seconds } else { 0.0 };
    if let Some(max) = want.max_bitrate.filter(|m| bitrate > m * 1.1) {
        warnings.push(format!("video at {:.1} Mbps, over the {:.0} Mbps the platforms take", bitrate / 1e6, max / 1e6));
    }
    if let Some(max) = want.max_bytes.filter(|m| bytes > *m) {
        warnings.push(format!("{:.0} MB, over the platform's {:.0} MB", bytes as f64 / 1e6, max as f64 / 1e6));
    }
    if let Some(max) = want.max_seconds.filter(|m| seconds > *m) {
        warnings.push(format!("{seconds:.0} s, over the platform's {max} s"));
    }
    Ok(Qc { ok: errors.is_empty(), errors, warnings, frames, expected_frames, seconds, pix_fmt, bit_depth, tags, bitrate: bitrate.round() as u64, bytes })
}

/// qc.mjs `loudness`: the file's sound, decoded and measured (EBU R 128).
pub fn loudness(file: &Path) -> Result<Loudness> {
    let mut meter = Meter::new(RATE, 2);
    if let Some(mut r) = AudioReader::open(file, 0.0, 1e9)? {
        while let Some((_, chunk)) = r.next_chunk()? {
            meter.push(&chunk);
        }
    }
    Ok(meter.result())
}
