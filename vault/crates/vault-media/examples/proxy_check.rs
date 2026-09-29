//! Make a movie's ACEScct proxy and check it against the reference maths: `cargo run --release -p vault-media
//! --example proxy_check -- <movie> [out.mp4]`. The first frame of the source goes through `cst::Journey::apply` on
//! the CPU (f64), block-averaged to the proxy's size; the proxy's first frame is decoded back; the two are compared.

use std::{path::Path, time::Instant};

use anyhow::{Context, Result};
use objc2::rc::Retained;
use objc2_av_foundation::{AVAssetReader, AVAssetReaderTrackOutput, AVAssetTrack, AVMediaTypeVideo, AVURLAsset};
use objc2_core_video::{
    CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow, CVPixelBufferGetHeight, CVPixelBufferGetWidth,
    CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags, CVPixelBufferUnlockBaseAddress,
};
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};
use vault_media::{cst, detect, make_proxy, probe};

fn f16(b: u16) -> f32 {
    let (s, e, m) = ((b >> 15) as u32, ((b >> 10) & 31) as u32, (b & 1023) as u32);
    let v = match e {
        0 => (m as f32) * 2f32.powi(-24),
        31 => f32::INFINITY,
        _ => f32::from_bits((e + 112) << 23 | m << 13),
    };
    if s == 1 { -v } else { v }
}

/// The first frame, decoded to full-range RGB half floats as the proxy renderer reads it.
fn first_frame(path: &Path) -> Result<(usize, usize, Vec<[f32; 3]>)> {
    unsafe {
        let asset = AVURLAsset::URLAssetWithURL_options(&NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy())), None);
        #[allow(deprecated)]
        let track: Retained<AVAssetTrack> =
            Retained::cast_unchecked(asset.tracksWithMediaType(AVMediaTypeVideo.unwrap()).firstObject().context("no video")?);
        let reader = AVAssetReader::assetReaderWithAsset_error(&asset).map_err(|e| anyhow::anyhow!("{e:?}"))?;
        let fmt = NSNumber::new_u32(u32::from_be_bytes(*b"RGhA"));
        let settings = NSDictionary::<NSString, objc2::runtime::AnyObject>::from_slices(&[&*NSString::from_str("PixelFormatType")], &[&**fmt as &objc2::runtime::AnyObject]);
        let out = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(&track, Some(&settings));
        reader.addOutput(&out);
        reader.startReading();
        let sample = out.copyNextSampleBuffer().context("no frame")?;
        let buf = sample.image_buffer().context("no image")?;
        CVPixelBufferLockBaseAddress(&buf, CVPixelBufferLockFlags::ReadOnly);
        let (w, h, row) = (CVPixelBufferGetWidth(&buf), CVPixelBufferGetHeight(&buf), CVPixelBufferGetBytesPerRow(&buf));
        let base = CVPixelBufferGetBaseAddress(&buf) as *const u8;
        let mut px = Vec::with_capacity(w * h);
        for y in 0..h {
            let line = std::slice::from_raw_parts(base.add(y * row) as *const u16, w * 4);
            for x in 0..w {
                px.push([f16(line[x * 4]), f16(line[x * 4 + 1]), f16(line[x * 4 + 2])]);
            }
        }
        CVPixelBufferUnlockBaseAddress(&buf, CVPixelBufferLockFlags::ReadOnly);
        reader.cancelReading();
        Ok((w, h, px))
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let src = Path::new(args.get(1).context("usage: proxy_check <movie> [out.mp4]")?);
    let out = args.get(2).map(String::from).unwrap_or_else(|| "/tmp/proxy_check.mp4".into());
    let info = probe(src)?;
    let colour = detect(&info);
    println!("{} · {}×{} · {:.1} s · {} ({})", info.codec, info.width, info.height, info.seconds, colour.profile, colour.from);
    let journey = cst::journey(&colour.profile).context("no journey for this profile")?;
    println!("journey: {}", journey.label);

    let t = Instant::now();
    let made = make_proxy(src, Path::new(&out), &colour.profile, &mut |_| {})?;
    let took = t.elapsed().as_secs_f64();
    println!("proxy {}×{} · {:.1} s of film in {took:.1} s ({:.1}× real time) → {out}", made.width, made.height, made.seconds, made.seconds / took);

    let (sw, sh, source) = first_frame(src)?;
    let (pw, ph, proxy) = first_frame(Path::new(&out))?;
    // the reference: every source pixel through the journey, then box-averaged into the proxy's grid
    let mut sum = vec![[0f64; 3]; pw * ph];
    let mut n = vec![0u32; pw * ph];
    for y in 0..sh {
        for x in 0..sw {
            let p = source[y * sw + x];
            let c = journey.apply([p[0] as f64, p[1] as f64, p[2] as f64]);
            let i = (y * ph / sh) * pw + x * pw / sw;
            for k in 0..3 {
                sum[i][k] += c[k];
            }
            n[i] += 1;
        }
    }
    let (mut mean_ref, mut mean_proxy, mut abs, mut worst) = ([0f64; 3], [0f64; 3], [0f64; 3], 0f64);
    for i in 0..pw * ph {
        for k in 0..3 {
            let r = sum[i][k] / n[i].max(1) as f64;
            let p = proxy[i][k] as f64;
            mean_ref[k] += r;
            mean_proxy[k] += p;
            abs[k] += (r - p).abs();
            worst = worst.max((r - p).abs());
        }
    }
    let px = (pw * ph) as f64;
    let f = |v: [f64; 3]| format!("{:.4} {:.4} {:.4}", v[0] / px, v[1] / px, v[2] / px);
    println!("mean ACEScct   reference {}   proxy {}", f(mean_ref), f(mean_proxy));
    println!("mean |error|   {}   (worst pixel {worst:.4}; 10-bit step is 0.0010)", f(abs));
    Ok(())
}
