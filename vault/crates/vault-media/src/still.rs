//! Proxies of what is not a movie: a still, and an EXR frame sequence (a tar of numbered `.exr` frames), in ACEScct
//! like every proxy. Core Image reads the pictures itself (OpenEXR, PNG, JPEG, HEIC, TIFF — nothing to install), each
//! goes through its colour journey on the GPU (`gpu::Grader`), and then:
//!   a still  → a 16-bit PNG, long edge 1920 at most — only for a float still (EXR) or one larger than HD; a small
//!              display still needs none (the viewer takes it through its input LUT);
//!   a sequence → an HEVC Main10 movie through `frames::FrameWriter`, the same file a movie's proxy is.
//! Which colour an EXR is in, its header says (`exr_profile`, the twin of game/film/color.js's exrHeader/exrProfile).

use std::{
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use anyhow::{Context, Result, bail, ensure};

use crate::{frames::FrameWriter, gpu::Grader, proxy::{Proxy, proxy_size}};

/// EXR chromaticities (x, y of red, green, blue, white) of the linear spaces generated footage comes in.
const EXR_PRIMARIES: [(&str, [f32; 8]); 3] = [
    ("aces2065-1", [0.7347, 0.2653, 0.0, 1.0, 0.0001, -0.077, 0.32168, 0.33767]),
    ("acescg", [0.713, 0.293, 0.165, 0.83, 0.128, 0.044, 0.32168, 0.33767]),
    ("linear-rec709", [0.64, 0.33, 0.3, 0.6, 0.15, 0.06, 0.3127, 0.329]),
];

/// The linear profile an OpenEXR header names: an ACES container is ACES2065-1; otherwise by its chromaticities, and
/// with none, Rec.709 primaries (as the OpenEXR specification defines a file without them). Not an EXR, or other
/// primaries: None.
pub fn exr_profile(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() < 8 || u32::from_le_bytes(bytes[0..4].try_into().ok()?) != 20000630 {
        return None;
    }
    let cstr = |at: usize| -> Option<(&[u8], usize)> {
        let end = at + bytes.get(at..)?.iter().position(|&b| b == 0)?;
        Some((&bytes[at..end], end + 1))
    };
    let (mut chroma, mut aces) = (None, false);
    let mut at = 8;
    while let Some((name, a1)) = cstr(at) {
        if name.is_empty() {
            break;
        }
        let (kind, a2) = cstr(a1)?;
        let size = u32::from_le_bytes(bytes.get(a2..a2 + 4)?.try_into().ok()?) as usize;
        let data = bytes.get(a2 + 4..a2 + 4 + size)?;
        if name == b"chromaticities" && kind == b"chromaticities" && size == 32 {
            let mut c = [0f32; 8];
            for (i, v) in c.iter_mut().enumerate() {
                *v = f32::from_le_bytes(data[i * 4..i * 4 + 4].try_into().ok()?);
            }
            chroma = Some(c);
        }
        if name == b"acesImageContainerFlag" && size >= 4 {
            aces = i32::from_le_bytes(data[0..4].try_into().ok()?) == 1;
        }
        at = a2 + 4 + size;
    }
    if aces {
        return Some("aces2065-1");
    }
    let Some(c) = chroma else { return Some("linear-rec709") };
    EXR_PRIMARIES.iter().find(|(_, p)| p.iter().zip(c).all(|(a, b)| (a - b).abs() < 0.002)).map(|(n, _)| *n)
}

/// Does this still get a proxy? A float still (EXR), or one larger than HD.
pub fn still_needs_proxy(exr: bool, width: u32, height: u32) -> bool {
    exr || width.max(height) > crate::proxy::LONG_EDGE
}

/// A still's ACEScct proxy: a 16-bit RGB PNG at `out`, long edge 1920 at most. Returns its size.
pub fn make_still_proxy(src: &Path, out: &Path, profile: &str) -> Result<(u32, u32)> {
    let grader = Grader::for_profile(profile)?.with_context(|| format!("no colour journey from {profile} into ACEScct"))?;
    let bytes = std::fs::read(src).with_context(|| format!("read {}", src.display()))?;
    let image = crate::gpu::load_image(&bytes)?;
    let (sw, sh) = crate::gpu::size_of(&image);
    let (w, h) = proxy_size(sw, sh);
    let rgba = grader.still(&image, w, h)?;
    let mut rgb16 = Vec::with_capacity((w * h * 3) as usize * 2);
    for px in rgba.chunks_exact(4) {
        for v in &px[..3] {
            rgb16.extend_from_slice(&((v.clamp(0.0, 1.0) * 65535.0).round() as u16).to_be_bytes());
        }
    }
    let file = std::fs::File::create(out).with_context(|| format!("create {}", out.display()))?;
    let mut png = png::Encoder::new(std::io::BufWriter::new(file), w, h);
    png.set_color(png::ColorType::Rgb);
    png.set_depth(png::BitDepth::Sixteen);
    // the code values are ACEScct, not sRGB: said in the file (and in the vault's meta), never converted by a reader
    png.add_text_chunk("Comment".into(), "maiacity:color=acescct".into())?;
    let mut writer = png.write_header()?;
    writer.write_image_data(&rgb16)?;
    writer.finish()?;
    Ok((w, h))
}

/// One member of a tar: its name, where its bytes start, how many.
struct Member {
    name: String,
    at: u64,
    size: u64,
}

/// The `.exr` members of a (ustar) tar, in frame order — its numbered names sorted.
fn exr_members(tar: &mut std::fs::File) -> Result<Vec<Member>> {
    let mut out = Vec::new();
    let mut header = [0u8; 512];
    let mut at = 0u64;
    loop {
        tar.seek(SeekFrom::Start(at))?;
        if tar.read_exact(&mut header).is_err() || header.iter().all(|&b| b == 0) {
            break;
        }
        let text = |r: std::ops::Range<usize>| String::from_utf8_lossy(&header[r]).trim_end_matches('\0').trim().to_string();
        let prefix = text(345..500);
        let name = text(0..100);
        let name = if prefix.is_empty() { name } else { format!("{prefix}/{name}") };
        let size = u64::from_str_radix(&text(124..136), 8).unwrap_or(0);
        let kind = header[156];
        // macOS's tar packs each file's AppleDouble metadata beside it as `._<name>`: not a frame
        let base = name.rsplit('/').next().unwrap_or(&name);
        if (kind == b'0' || kind == 0) && name.to_lowercase().ends_with(".exr") && !base.starts_with("._") {
            out.push(Member { name, at: at + 512, size });
        }
        at += 512 + size.div_ceil(512) * 512;
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// An EXR frame sequence packed in a tar, read frame by frame straight from the tar (nothing unpacked): its `.exr`
/// members in their numbered order. Its proxy is made through this, and the final render reads its frames with it.
pub struct Sequence {
    tar: std::fs::File,
    members: Vec<Member>,
}

impl Sequence {
    pub fn open(tar_path: &Path) -> Result<Self> {
        let mut tar = std::fs::File::open(tar_path).with_context(|| format!("open {}", tar_path.display()))?;
        let members = exr_members(&mut tar)?;
        ensure!(!members.is_empty(), "the sequence holds no .exr frames");
        Ok(Self { tar, members })
    }

    /// How many frames it holds (at least one).
    pub fn len(&self) -> usize {
        self.members.len()
    }

    pub fn is_empty(&self) -> bool {
        self.members.is_empty()
    }

    /// Frame `i`'s name in the tar.
    pub fn name(&self, i: usize) -> &str {
        &self.members[i].name
    }

    /// Frame `i`'s bytes (an OpenEXR file).
    pub fn frame(&mut self, i: usize) -> Result<Vec<u8>> {
        let m = self.members.get(i).with_context(|| format!("no frame {i} in a sequence of {}", self.members.len()))?;
        self.tar.seek(SeekFrom::Start(m.at))?;
        let mut bytes = vec![0u8; m.size as usize];
        self.tar.read_exact(&mut bytes)?;
        Ok(bytes)
    }

    /// Which frame is on screen `seconds` into the sequence at `fps` (the last one held after its end).
    pub fn index_at(&self, seconds: f64, fps: f64) -> usize {
        ((seconds.max(0.0) * fps + 1e-6).floor() as usize).min(self.members.len() - 1)
    }
}

/// An EXR sequence's ACEScct proxy movie at `out` (HEVC Main10), at `fps`. `progress` gets 0…1.
pub fn make_sequence_proxy(tar_path: &Path, out: &Path, profile: Option<&str>, fps: f64, progress: &mut dyn FnMut(f64)) -> Result<Proxy> {
    let mut seq = Sequence::open(tar_path)?;
    let first = seq.frame(0)?;
    // the sequence's colour: as it was given (meta), else its first frame's header
    let profile = match profile {
        Some(p) => p.to_string(),
        None => exr_profile(&first).context("its first frame's primaries are not ones the journeys know")?.to_string(),
    };
    let grader = Grader::for_profile(&profile)?.with_context(|| format!("no colour journey from {profile} into ACEScct"))?;
    let (sw, sh) = crate::gpu::size_of(&*crate::gpu::load_image(&first)?);
    let (w, h) = proxy_size(sw, sh);
    let mut writer = FrameWriter::create(out, w, h, fps)?;
    let total = seq.len() as f64;
    let mut packed = vec![0u8; (w * h * 4) as usize];
    for i in 0..seq.len() {
        let bytes = if i == 0 { first.clone() } else { seq.frame(i)? };
        let image = crate::gpu::load_image(&bytes).with_context(|| format!("frame {}", seq.name(i)))?;
        let (fw, fh) = crate::gpu::size_of(&image);
        if (fw, fh) != (sw, sh) {
            bail!("frame {} is {fw}×{fh}, the sequence {sw}×{sh}", seq.name(i));
        }
        let rgba = grader.still(&image, w, h)?;
        // x2bgr10le: red in the low ten bits, then green, then blue — FrameWriter's input
        for (px, dst) in rgba.chunks_exact(4).zip(packed.chunks_exact_mut(4)) {
            let q = |v: f32| (v.clamp(0.0, 1.0) * 1023.0).round() as u32;
            dst.copy_from_slice(&(q(px[0]) | (q(px[1]) << 10) | (q(px[2]) << 20)).to_le_bytes());
        }
        writer.push(&packed)?;
        progress((i + 1) as f64 / total);
    }
    let mut made = writer.finish()?;
    made.profile = crate::proxy::WORKING.to_string();
    Ok(made)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal EXR header: magic, version, the given attributes, the terminating zero.
    fn header(attrs: &[(&str, &str, Vec<u8>)]) -> Vec<u8> {
        let mut b = 20000630u32.to_le_bytes().to_vec();
        b.extend_from_slice(&2u32.to_le_bytes());
        for (name, kind, data) in attrs {
            b.extend_from_slice(name.as_bytes());
            b.push(0);
            b.extend_from_slice(kind.as_bytes());
            b.push(0);
            b.extend_from_slice(&(data.len() as u32).to_le_bytes());
            b.extend_from_slice(data);
        }
        b.push(0);
        b
    }

    #[test]
    fn exr_headers_name_their_profile() {
        let chroma = |c: [f32; 8]| c.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<u8>>();
        assert_eq!(exr_profile(&header(&[])), Some("linear-rec709"));
        assert_eq!(exr_profile(&header(&[("acesImageContainerFlag", "int", 1i32.to_le_bytes().to_vec())])), Some("aces2065-1"));
        assert_eq!(exr_profile(&header(&[("chromaticities", "chromaticities", chroma(EXR_PRIMARIES[1].1))])), Some("acescg"));
        assert_eq!(exr_profile(&header(&[("chromaticities", "chromaticities", chroma([0.68, 0.32, 0.265, 0.69, 0.15, 0.06, 0.3127, 0.329]))])), None);
        assert_eq!(exr_profile(b"not an exr"), None);
    }

    #[test]
    fn a_sequence_is_read_frame_by_frame_in_its_numbered_order() {
        // a ustar tar by hand: frames out of order, macOS's AppleDouble twin, and a file that is no frame
        let mut tar = Vec::new();
        for (name, body) in [("shot/0002.exr", &b"two"[..]), ("shot/._0001.exr", b"apple"), ("shot/0001.exr", b"one!"), ("shot/notes.txt", b"n"), ("shot/0003.exr", b"three")] {
            let mut h = [0u8; 512];
            h[..name.len()].copy_from_slice(name.as_bytes());
            let size = format!("{:011o}\0", body.len());
            h[124..136].copy_from_slice(size.as_bytes());
            h[156] = b'0';
            tar.extend_from_slice(&h);
            tar.extend_from_slice(body);
            tar.resize(tar.len().div_ceil(512) * 512, 0);
        }
        tar.extend_from_slice(&[0u8; 1024]);
        let file = std::env::temp_dir().join(format!("seq-test-{}.tar", std::process::id()));
        std::fs::write(&file, &tar).unwrap();
        let mut seq = Sequence::open(&file).unwrap();
        assert_eq!(seq.len(), 3);
        assert_eq!(seq.name(0), "shot/0001.exr");
        assert_eq!(seq.frame(0).unwrap(), b"one!");
        assert_eq!(seq.frame(2).unwrap(), b"three");
        assert!(seq.frame(3).is_err());
        // at 24 fps: frame 0 until 1/24 s, the last one held after the end
        assert_eq!(seq.index_at(0.0, 24.0), 0);
        assert_eq!(seq.index_at(1.0 / 24.0, 24.0), 1);
        assert_eq!(seq.index_at(0.09, 24.0), 2);
        assert_eq!(seq.index_at(5.0, 24.0), 2);
        std::fs::remove_file(&file).ok();
    }

    #[test]
    fn only_float_or_large_stills_get_a_proxy() {
        assert!(still_needs_proxy(true, 800, 600));
        assert!(still_needs_proxy(false, 4032, 3024));
        assert!(!still_needs_proxy(false, 1920, 1080));
    }
}
