//! Render a timeline JSON natively, as the render worker would.
//!
//!   cargo run --release -p vault-render --example render_timeline -- <timeline.json> <out.mp4> [options]
//!   cargo run --release -p vault-render --example render_timeline -- --probe <file>…
//!
//! The timeline is the API's JSON (`GET /api/timelines/:id`). Its clips name files by hash; without the vault, the
//! JSON may carry `"files": { "<hash>": "/path/to/file" }` and `"media": { "<hash>": { "kind", "title", "meta" } }`
//! beside the timeline's own fields (a hash that is itself a path to a file works too).
//!
//! Options:
//!   --shape 9:16     the shape to render (default: the timeline's own); --all: every shape, as the worker
//!   --cube odt.cube  the output transform from a .cube (the worker's 129³ bake)
//!   --aces2          the output transform from vault_media::aces2 (baked 129³ here)
//!   (neither: the identity placeholder — the picture comes out as its ACEScct code values)
//!   --no-level       leave the sound as mixed (the worker's behaviour); default: −14 LUFS, −1 dBTP
//!   --snap 1.5,4     write PNGs of the delivered frames at these seconds beside the output

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::Instant,
};

use anyhow::{Context, Result, bail};
use serde_json::Value;
use vault_render::{
    av::VideoReader,
    gpu::{Extent, Gpu},
    output::{Lut3d, Output},
    render::{Library, Media, Options, Plate, render},
    timeline::{Clip, Shape, Timeline},
};

struct Local {
    files: HashMap<String, PathBuf>,
    media: HashMap<String, Media>,
}

impl Library for Local {
    fn media(&self, hash: &str) -> Option<Media> {
        if let Some(m) = self.media.get(hash) {
            return Some(m.clone());
        }
        let file = self.files.get(hash).cloned().or_else(|| Path::new(hash).is_file().then(|| PathBuf::from(hash)))?;
        let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        let kind = match ext.as_str() {
            "mov" | "mp4" | "m4v" => "video",
            "wav" | "mp3" | "m4a" | "aac" | "aif" | "aiff" => "audio",
            _ => "image",
        };
        Some(Media { hash: hash.into(), kind: kind.into(), title: file.file_name().unwrap().to_string_lossy().into(), ..Default::default() })
    }
    fn file(&self, hash: &str) -> Result<vault_media::Source> {
        let p = self.files.get(hash).cloned().or_else(|| Path::new(hash).is_file().then(|| PathBuf::from(hash))).with_context(|| format!("no file for {hash}"))?;
        Ok(p.into())
    }
}

fn snapshot(file: &Path, t: f64, png: &Path) -> Result<()> {
    let gpu = Gpu::new()?;
    let mut r = VideoReader::open(file, t, t + 0.2)?;
    let pb = r.at(t + 0.001)?.context("no frame")?;
    let img = gpu.frame(pb);
    let e = img.ext();
    let (w, h) = (e.size.width as u32, e.size.height as u32);
    let px = gpu.read(&img, w, h);
    // a plain 8-bit PNG, written by hand (no image crate): stored deflate blocks
    let mut raw = Vec::with_capacity((w * h * 3 + h) as usize);
    for y in 0..h {
        raw.push(0u8);
        for x in 0..w {
            let i = ((y * w + x) * 4) as usize;
            for c in 0..3 {
                raw.push((px[i + c].clamp(0.0, 1.0) * 255.0).round() as u8);
            }
        }
    }
    std::fs::write(png, png_bytes(w, h, &raw))?;
    Ok(())
}

fn png_bytes(w: u32, h: u32, raw: &[u8]) -> Vec<u8> {
    fn crc(data: &[u8]) -> u32 {
        let mut c = 0xffff_ffffu32;
        for &b in data {
            c ^= b as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xedb8_8320 ^ (c >> 1) } else { c >> 1 };
            }
        }
        !c
    }
    fn chunk(out: &mut Vec<u8>, kind: &[u8], data: &[u8]) {
        out.extend((data.len() as u32).to_be_bytes());
        let mut body = kind.to_vec();
        body.extend(data);
        out.extend(&body);
        out.extend(crc(&body).to_be_bytes());
    }
    let mut z = vec![0x78, 0x01];
    let (mut a, mut b) = (1u32, 0u32);
    for &x in raw {
        a = (a + x as u32) % 65521;
        b = (b + a) % 65521;
    }
    let blocks: Vec<&[u8]> = raw.chunks(65535).collect();
    for (i, blk) in blocks.iter().enumerate() {
        z.push(if i + 1 == blocks.len() { 1 } else { 0 });
        z.extend((blk.len() as u16).to_le_bytes());
        z.extend((!(blk.len() as u16)).to_le_bytes());
        z.extend(*blk);
    }
    z.extend(((b << 16) | a).to_be_bytes());
    let mut out = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    let mut ihdr = Vec::new();
    ihdr.extend(w.to_be_bytes());
    ihdr.extend(h.to_be_bytes());
    ihdr.extend([8, 2, 0, 0, 0]);
    chunk(&mut out, b"IHDR", &ihdr);
    chunk(&mut out, b"IDAT", &z);
    chunk(&mut out, b"IEND", &[]);
    out
}

/// vault_media::aces2 as the render's output transform.
struct Aces2(Lut3d);

impl Output for Aces2 {
    fn name(&self) -> &str {
        "odt-rec709"
    }
    fn hash(&self) -> String {
        self.0.hash()
    }
    fn apply(&self, acescct: [f64; 3]) -> [f64; 3] {
        self.0.sample(acescct)
    }
    fn lut(&self) -> Lut3d {
        self.0.clone()
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--probe") {
        for f in &args[1..] {
            match vault_media::probe(Path::new(f)) {
                Ok(p) => println!("{f}\n  {}×{} {:.3} fps {:.2} s {} bits {:?} {:?}/{:?}/{:?} audio {} → {:?} · turned {:?}", p.width, p.height, p.fps, p.seconds, p.codec, p.bits, p.primaries, p.transfer, p.matrix, p.audio, vault_media::detect(&p), VideoReader::open(Path::new(f), 0.0, 0.1).map(|r| r.info.transform).ok()),
                Err(e) => println!("{f}: {e}"),
            }
        }
        return Ok(());
    }
    let (Some(json), Some(out)) = (args.first(), args.get(1)) else { bail!("usage: render_timeline <timeline.json> <out.mp4> [--shape 9:16 | --all] [--cube f | --aces2] [--no-level] [--snap 1,2]") };
    let flag = |k: &str| args.iter().any(|a| a == k);
    let value = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let raw: Value = serde_json::from_str(&std::fs::read_to_string(json)?)?;
    let t: Timeline = serde_json::from_value(raw.clone())?;
    let base = Path::new(json).parent().unwrap_or(Path::new("."));
    let files = raw
        .get("files")
        .and_then(Value::as_object)
        .map(|o| o.iter().filter_map(|(k, v)| v.as_str().map(|p| (k.clone(), base.join(p)))).collect())
        .unwrap_or_default();
    let media = raw
        .get("media")
        .and_then(Value::as_object)
        .map(|o| {
            o.iter()
                .filter_map(|(k, v)| {
                    let mut v = v.clone();
                    v["hash"] = Value::String(k.clone());
                    serde_json::from_value::<Media>(v).ok().map(|m| (k.clone(), m))
                })
                .collect()
        })
        .unwrap_or_default();
    let lib = Local { files, media };
    let out = PathBuf::from(out);
    let work = out.with_extension("render");
    let mut opts = Options::new(&work);
    if !flag("--all") {
        opts.shapes = Some(vec![value("--shape").unwrap_or_else(|| t.aspect.clone())]);
    }
    if flag("--no-level") {
        opts.target = None;
    }
    let output: Box<dyn Output> = if let Some(c) = value("--cube") {
        Box::new(Lut3d::from_cube_file("odt-rec709", Path::new(&c))?)
    } else if flag("--aces2") {
        let started = Instant::now();
        let cube = vault_media::aces2::bake_cube(129);
        eprintln!("ACES 2.0 output transform baked at 129³ in {:.1} s", started.elapsed().as_secs_f64());
        Box::new(Aces2(Lut3d::from_rgb("odt-rec709", 129, cube)?))
    } else {
        eprintln!("output transform: the identity placeholder (ACEScct code values out)");
        Box::new(Lut3d::identity(129))
    };
    let no_plates = |c: &Clip, s: &Shape| -> Result<Option<Plate>> {
        // world clips' plates: "<shot>-<shape>.mp4" beside the timeline, when there
        let f = base.join(format!("{}-{}.mp4", c.shot.as_deref().unwrap_or(&c.id), s.tag()));
        Ok(f.is_file().then(|| Plate { file: f, ..Default::default() }))
    };
    let started = Instant::now();
    let mut last = -1.0;
    let r = render(&t, &lib, &no_plates, output.as_ref(), &opts, &mut |p, what| {
        if p - last >= 0.05 || p >= 1.0 {
            last = p;
            eprintln!("{:5.1}% {what} ({:.1} s)", p * 100.0, started.elapsed().as_secs_f64());
        }
    })?;
    let took = started.elapsed().as_secs_f64();
    // the timeline's own H.264 cut → out.mp4; the rest beside it
    let mut r = r;
    for d in r.deliveries.iter_mut() {
        let dest = if d.codec == "h264" && (opts.shapes.is_some() || d.aspect == t.aspect) {
            out.clone()
        } else {
            out.with_file_name(&d.name)
        };
        std::fs::rename(&d.file, &dest)?;
        d.file = dest;
        d.hash = Some(d.name.clone());
    }
    if let Some(s) = value("--snap") {
        for (i, at) in s.split(',').filter_map(|x| x.parse::<f64>().ok()).enumerate() {
            for d in &r.deliveries {
                let png = d.file.with_extension(format!("{i}.png"));
                snapshot(&d.file, at, &png)?;
                eprintln!("snapshot {} at {at} s → {}", d.name, png.display());
            }
        }
    }
    println!("{}", serde_json::to_string_pretty(&r.job_result(&t)?)?);
    eprintln!("rendered {:.2} s of film in {took:.1} s ({:.2}× real time)", r.seconds, r.seconds / took);
    let _ = std::fs::remove_dir_all(&work);
    Ok(())
}
