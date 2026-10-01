//! The pictures the model sees, made natively (it was ffmpeg on the server): a proxy's frames decoded by AVFoundation
//! (read in place from this Mac's store), taken through the ACES 2.0 output transform when they are ACEScct — the
//! model must see what a Rec.709 screen shows, not log code values; the same transform as the previews — scaled by
//! Core Image and JPEG-encoded in memory. A frame every so many seconds, and every picture change on top (a cut, a
//! light switched on), told by how much a small grey copy of each frame differs from the one before.

use anyhow::{Context, Result};
use vault_media::Source;
use vault_render::{av::VideoReader, gpu::{Extent, Gpu}};

use super::plan;

/// The frames of a file: their times (seconds of the file) and their JPEGs.
#[derive(Default)]
pub struct Frames {
    pub times: Vec<f64>,
    pub jpegs: Vec<Vec<u8>>,
}

/// The size a picture of `w`×`h` has with its long edge at `edge` (even sides, at least 2).
pub fn fit(w: f64, h: f64, edge: u32) -> (u32, u32) {
    let k = edge as f64 / w.max(h).max(1.0);
    let even = |x: f64| ((x * k / 2.0).round() as u32 * 2).max(2);
    (even(w), even(h))
}

/// How much two small grey pictures differ: the mean of their pixels' differences (0…1).
pub fn change(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 1.0;
    }
    a.iter().zip(b).map(|(x, y)| (x - y).abs() as f64).sum::<f64>() / a.len() as f64
}

fn gpu(acescct: bool) -> Result<Gpu> {
    let mut gpu = Gpu::new()?;
    if acescct {
        gpu.set_output(crate::render::odt());
    }
    Ok(gpu)
}

/// A picture as the screen shows it, `w`×`h`: scaled, then through the output transform when it is ACEScct.
fn shown(gpu: &Gpu, img: &vault_render::gpu::Image, w: u32, h: u32, acescct: bool) -> Result<vault_render::gpu::Image> {
    let small = gpu.resize(img, w, h)?;
    if acescct { gpu.output(&small) } else { Ok(small) }
}

/// A movie's frames the model sees: one every `every` seconds and every picture change, each `edge` on its long side.
/// `told` hears how far (0…1).
pub fn sample(src: Source, seconds: f64, every: f64, edge: u32, acescct: bool, told: &mut dyn FnMut(f64)) -> Result<Frames> {
    objc2::rc::autoreleasepool(|_| {
        let gpu = gpu(acescct)?;
        let mut r = VideoReader::open(src, 0.0, seconds.max(0.1) + 1.0)?;
        let turn = r.info.transform;
        let mut out = Frames::default();
        let (mut last, mut before): (Option<f64>, Option<Vec<f32>>) = (None, None);
        let mut size = None;
        while let Some((t, pb)) = r.next_frame()? {
            objc2::rc::autoreleasepool(|_| -> Result<()> {
                let img = gpu.orient(&gpu.frame(&pb), turn);
                // a small grey copy, to tell a picture change
                let grey: Vec<f32> = gpu.read(&*shown(&gpu, &img, 32, 18, acescct)?, 32, 18).chunks(4).map(|p| 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]).collect();
                let moved = before.as_deref().map(|b| change(b, &grey)).unwrap_or(0.0);
                before = Some(grey);
                if plan::pick(t, last, moved, every) {
                    let (w, h) = *size.get_or_insert_with(|| {
                        let e = img.ext();
                        fit(e.size.width, e.size.height, edge)
                    });
                    out.jpegs.push(gpu.jpeg_bytes(&*shown(&gpu, &img, w, h, acescct)?, w, h)?);
                    out.times.push((t * 1000.0).round() / 1000.0);
                    last = Some(t);
                }
                Ok(())
            })?;
            if seconds > 0.0 {
                told((t / seconds).clamp(0.0, 1.0));
            }
        }
        anyhow::ensure!(!out.times.is_empty(), "the movie gave no frames");
        Ok(out)
    })
}

/// One frame as a JPEG, `edge` on its long side: a movie's at `at` seconds, or a still.
pub fn one(src: Source, at: Option<f64>, edge: u32, acescct: bool) -> Result<Vec<u8>> {
    objc2::rc::autoreleasepool(|_| {
        let gpu = gpu(acescct)?;
        let img = match at {
            Some(t) => {
                let mut r = VideoReader::open(src, t, t + 0.1)?;
                let turn = r.info.transform;
                let pb = r.at(t)?.context("no frame there")?;
                gpu.orient(&gpu.frame(pb), turn)
            }
            None => gpu.still(src)?,
        };
        let e = img.ext();
        let (w, h) = fit(e.size.width, e.size.height, edge);
        gpu.jpeg_bytes(&*shown(&gpu, &img, w, h, acescct)?, w, h)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_and_changes() {
        assert_eq!(fit(1920.0, 1080.0, 768), (768, 432));
        assert_eq!(fit(1080.0, 1920.0, 640), (360, 640));
        assert_eq!(fit(4.0, 3.0, 768), (768, 576));
        assert_eq!(change(&[0.0, 1.0], &[0.0, 0.5]), 0.25);
        assert_eq!(change(&[], &[]), 1.0);
    }

    /// The real thing on a synthetic ACEScct proxy: frames sampled with their times, the cut found, through the output
    /// transform; one frame for a thumbnail. Skipped where ffmpeg (which only makes the test movie) is not.
    #[test]
    fn samples_frames_through_the_output_transform() {
        let dir = std::env::temp_dir().join(format!("vault-analyse-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // 5 s of grey, then a test pattern from 2.5 s, tagged BT.709 like a proxy
        let movie = dir.join("proxy.mov");
        let made = std::process::Command::new("ffmpeg")
            .args(["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x999999:size=640x360:rate=25:duration=2.5", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=2.5"])
            .args(["-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]", "-c:v", "prores_ks", "-profile:v", "3", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"])
            .arg(&movie)
            .status();
        if !made.is_ok_and(|s| s.success()) {
            eprintln!("no ffmpeg here: skipped");
            return;
        }
        let mut last = 0.0;
        let f = sample(Source::Path(movie.clone()), 5.0, 1.0, plan::EDGE, true, &mut |d| last = d).unwrap();
        // one a second (0…4) and the cut at 2.5
        assert!(f.times.len() >= 5 && f.times.len() <= 7, "{:?}", f.times);
        assert_eq!(f.times[0], 0.0);
        assert!(f.times.windows(2).all(|w| w[1] > w[0]));
        assert!(f.times.iter().any(|t| (t - 2.5).abs() < 0.05), "the cut is sampled: {:?}", f.times);
        assert!(last > 0.9);
        assert_eq!(&f.jpegs[0][..2], &[0xff, 0xd8]);
        let thumb = one(Source::Path(movie.clone()), Some(3.0), plan::PREVIEW_EDGE, true).unwrap();
        assert!(thumb.len() > 1000 && thumb[..2] == [0xff, 0xd8]);
        std::fs::remove_dir_all(&dir).ok();
    }
}
