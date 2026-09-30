//! The render end to end on synthetic media made here (AVAssetWriter: a few seconds of flat colours and a tone): the
//! cut (which clip is on top, in points, gaps), the fades, the grade, captions, the mix (fades, ducking, levelling),
//! QC and loudness of the delivered files. The output transform is the identity placeholder (the ACES 2.0 one is
//! being ported beside this), so a delivered pixel is the source's ACEScct, graded and faded.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use anyhow::Result;
use serde_json::{Value, json};
use vault_render::{
    av::{Codec, RATE, VideoReader, VideoSettings, Writer},
    gpu::Gpu,
    grade::preset,
    output::Lut3d,
    render::{Library, Media, Options, Plate, hero_frame, render},
    sound::{AudioClip, Target, mix, write_wav},
    timeline::{Clip, Shape, Timeline},
};

fn scratch(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("vault-render-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn tone(freq: f64, dbfs: f64, seconds: f64) -> Vec<f32> {
    let a = 10f64.powf(dbfs / 20.0);
    (0..(seconds * RATE as f64) as usize)
        .flat_map(|i| {
            let v = (a * (2.0 * std::f64::consts::PI * freq * i as f64 / RATE as f64).sin()) as f32;
            [v, v]
        })
        .collect()
}

/// A movie of flat colours, one per second, with a tone under it: H.264 1280×720 at 30 fps, BT.709.
fn movie(out: &Path, colours: &[[f32; 3]], freq: f64) {
    let seconds = colours.len() as f64;
    let wav = out.with_extension("wav");
    write_wav(&wav, &tone(freq, -20.0, seconds)).unwrap();
    let v = VideoSettings { codec: Codec::H264, width: 1280, height: 720, fps: 30, bitrate: 8_000_000, keyframes: 30, audio_bitrate: 192_000 };
    let mut w = Writer::create(out, &v, Some(&wav)).unwrap();
    let gpu = Gpu::new().unwrap();
    for c in colours {
        let px: Vec<f32> = (0..16).flat_map(|_| [c[0], c[1], c[2], 1.0]).collect();
        let img = gpu.resize(&gpu.from_rgba(&px, 4, 4), 1280, 720).unwrap();
        for _ in 0..30 {
            objc2::rc::autoreleasepool(|_| {
                let buf = w.buffer().unwrap();
                gpu.render(&img, &buf, 1280, 720);
                w.push(&buf).unwrap();
            });
        }
    }
    w.finish("test").unwrap();
    std::fs::remove_file(wav).ok();
}

struct Lib(HashMap<String, (Media, PathBuf)>);

impl Library for Lib {
    fn media(&self, hash: &str) -> Option<Media> {
        self.0.get(hash).map(|x| x.0.clone())
    }
    /// As the app serves them: the bytes read in place (here from memory, through AVFoundation's resource loader),
    /// never the file's path.
    fn file(&self, hash: &str) -> Result<vault_media::Source> {
        let path = self.0.get(hash).map(|x| x.1.clone()).ok_or_else(|| anyhow::anyhow!("no {hash}"))?;
        let ext = path.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default();
        Ok(vault_media::Source::blob(std::sync::Arc::new(std::fs::read(&path)?), format!("{hash}.{ext}")))
    }
}

fn media(hash: &str, kind: &str, meta: Value) -> Media {
    Media { hash: hash.into(), mime: if kind == "video" { "video/mp4".into() } else { "audio/wav".into() }, kind: kind.into(), size: 0, title: hash.into(), meta }
}

/// The centre pixel of the delivered frame at `t`, as display RGB.
fn pixel(file: &Path, t: f64) -> [f64; 3] {
    pixel_at(file, t, 0.5, 0.5)
}

/// The pixel at (fx, fy) of the frame (fractions from the top left).
fn pixel_at(file: &Path, t: f64, fx: f64, fy: f64) -> [f64; 3] {
    let gpu = Gpu::new().unwrap();
    let mut r = VideoReader::open(file, t, t + 0.2).unwrap();
    let pb = r.at(t + 0.001).unwrap().unwrap();
    let img = gpu.frame(pb);
    let e = vault_render::gpu::Extent::ext(&*img);
    let (w, h) = (e.size.width as u32, e.size.height as u32);
    let px = gpu.read(&img, w, h);
    let i = ((((h as f64 * fy) as u32) * w + (w as f64 * fx) as u32) * 4) as usize;
    [px[i] as f64, px[i + 1] as f64, px[i + 2] as f64]
}

/// The brightest pixel (its lowest channel) where a caption sits: between 8.5 % and 20 % above the frame's foot.
fn foot(file: &Path, t: f64) -> f64 {
    let gpu = Gpu::new().unwrap();
    let mut r = VideoReader::open(file, t, t + 0.2).unwrap();
    let pb = r.at(t + 0.001).unwrap().unwrap();
    let img = gpu.frame(pb);
    let e = vault_render::gpu::Extent::ext(&*img);
    let (w, h) = (e.size.width as u32, e.size.height as u32);
    let px = gpu.read(&img, w, h);
    let rows = (h as f64 * 0.80) as u32..(h as f64 * 0.915) as u32;
    let mut best = 0f64;
    for y in rows {
        for x in 0..w {
            let i = ((y * w + x) * 4) as usize;
            best = best.max(px[i].min(px[i + 1]).min(px[i + 2]) as f64);
        }
    }
    best
}

fn near(a: [f64; 3], b: [f64; 3], eps: f64) -> bool {
    (0..3).all(|i| (a[i] - b[i]).abs() <= eps)
}

const RED: [f32; 3] = [0.8, 0.1, 0.1];
const GREEN: [f32; 3] = [0.1, 0.7, 0.2];
const BLUE: [f32; 3] = [0.1, 0.2, 0.8];

fn display(code: [f32; 3], k: f64, grade: Option<&vault_render::grade::Cdl>) -> [f64; 3] {
    let j = vault_media::cst::journey("rec709").unwrap();
    let mut v = j.apply(code.map(f64::from));
    if let Some(g) = grade {
        v = g.apply(v);
    }
    v.map(|x| x.clamp(0.0, 1.0) * k)
}

#[test]
fn the_cut_the_fades_the_captions_and_qc() {
    let dir = scratch("cut");
    let (a, b) = (dir.join("a.mp4"), dir.join("b.mp4"));
    movie(&a, &[RED, GREEN, GREEN], 1000.0);
    movie(&b, &[BLUE, BLUE], 440.0);
    let voice = dir.join("voice.wav");
    write_wav(&voice, &tone(300.0, -18.0, 4.0)).unwrap();
    let words = json!([
        { "word": "The", "start": 0.2, "end": 0.4 }, { "word": "first", "start": 0.45, "end": 0.7 }, { "word": "words.", "start": 0.75, "end": 1.1 },
        { "word": "And", "start": 2.0, "end": 2.2 }, { "word": "the", "start": 2.25, "end": 2.4 }, { "word": "last.", "start": 2.45, "end": 2.9 }
    ]);
    let lib = Lib(HashMap::from([
        ("a".to_string(), (media("a", "video", json!({ "color": { "profile": "rec709" } })), a.clone())),
        // b's colour told from the file itself (its BT.709 tags)
        ("b".to_string(), (media("b", "video", json!({})), b.clone())),
        ("v".to_string(), (media("v", "audio", json!({ "words": words })), voice)),
    ]));
    let warm = preset("warm").unwrap();
    let t: Timeline = serde_json::from_value(json!({
        "id": "t1", "name": "Test", "project": "Day 99", "variant": null, "aspect": "1:1",
        "clips": [
            // a from its second second (green), 0–2 s; b over it 1–3 s, graded warm; a gap 3–4 s
            { "id": "c1", "track": "V1", "start": 0, "in": 1, "dur": 2, "vol": 1, "hash": "a" },
            { "id": "c2", "track": "V1", "start": 1, "in": 0, "dur": 2, "vol": 1, "hash": "b", "grade": warm.to_json() },
            { "id": "c3", "track": "A1", "start": 0, "in": 0, "dur": 4, "vol": 1, "hash": "v" },
            { "id": "c4", "track": "A2", "start": 0, "in": 0, "dur": 3, "vol": 0.5, "hash": "a" }
        ]
    }))
    .unwrap();
    let mut opts = Options::new(dir.join("out"));
    opts.shapes = Some(vec!["1:1".into()]);
    opts.target = Some(Target { lufs: -16.0, true_peak: -1.0 });
    let no_plates = |_: &Clip, _: &Shape| -> Result<Option<Plate>> { Ok(None) };
    let out = render(&t, &lib, &no_plates, &Lut3d::identity(33), &opts, &mut |_, _| {}).unwrap();
    assert_eq!(out.deliveries.len(), 1);
    let d = &out.deliveries[0];
    assert!(d.qc.ok, "{:?}", d.qc);
    assert_eq!((d.qc.frames, d.qc.bit_depth, d.qc.tags.primaries.as_deref(), d.qc.tags.range.as_deref()), (120, 8, Some("bt709"), Some("tv")));
    assert_eq!((d.width, d.height, d.codec.as_str()), (1080, 1080, "h264"));
    assert!(d.name.starts_with("day-99-") && d.name.ends_with("-1x1.mp4"), "{}", d.name);
    // the sound levelled to −16 LUFS (measured from the delivered AAC), under −1 dBTP
    let l = d.loudness;
    assert!((l.lufs.unwrap() + 16.0).abs() < 0.5, "{l:?}");
    assert!(l.true_peak.unwrap() < -0.5, "{l:?}");
    // the transforms named: the journey, the clip's grade, the output transform
    assert!(out.color.transforms.contains_key("idt-rec709") && out.color.transforms.contains_key("grade:clip") && out.color.transforms.contains_key("identity"), "{:?}", out.color.transforms);

    // the picture: a's in point (green, fading up from black), b on top from 1 s, graded; the fade out; the gap
    let f = &d.file;
    let eps = 0.03;
    let p = pixel(f, 0.9);
    assert!(near(p, display(GREEN, 0.9 / 1.2, None), eps), "0.9 s: {p:?} vs {:?}", display(GREEN, 0.75, None));
    let p = pixel(f, 1.3);
    assert!(near(p, display(BLUE, 1.0, Some(&warm)), eps), "1.3 s: {p:?} vs {:?}", display(BLUE, 1.0, Some(&warm)));
    let p = pixel(f, 2.5);
    assert!(near(p, display(BLUE, 1.0 - 1.0 / 2.5, Some(&warm)), eps), "2.5 s: {p:?}");
    let p = pixel(f, 3.5);
    assert!(near(p, [0.0, 0.0, 0.0], 0.01), "3.5 s: {p:?}");
    // the captions: white text at the foot of the frame on their phrase ("The first words." 0.12–1.4 s), none
    // between the phrases ("And the last." from 1.92 s)
    assert!(foot(f, 0.9) > 0.95, "no caption at 0.9 s: {}", foot(f, 0.9));
    assert!(foot(f, 1.7) < 0.8, "a caption at 1.7 s: {}", foot(f, 1.7));
    assert!(foot(f, 2.5) > 0.95, "no caption at 2.5 s");

    // the job's result, once the app has put the file in the vault
    let mut out = out;
    out.deliveries[0].hash = Some("h1".into());
    let job = out.job_result(&t).unwrap();
    assert_eq!(job["output_hash"], "h1");
    assert_eq!(job["report"]["deliveries"][0]["qc"]["frames"], 120);
    assert!(job["report"]["color"]["transforms"]["idt-rec709"].is_string());
    let about = out.about(&t, &out.deliveries[0]);
    assert!(about.tags.contains(&"role:render".to_string()) && about.tags.contains(&"aspect:1:1".to_string()));
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn the_master_and_its_copy() {
    let dir = scratch("master");
    let a = dir.join("a.mp4");
    movie(&a, &[RED], 1000.0);
    let lib = Lib(HashMap::from([("a".to_string(), (media("a", "video", json!({ "color": { "profile": "rec709" } })), a))]));
    let t: Timeline = serde_json::from_value(json!({
        "id": "t2", "name": "Master", "aspect": "16:9",
        "clips": [{ "id": "c1", "track": "V1", "start": 0, "in": 0, "dur": 1, "vol": 1, "hash": "a" }]
    }))
    .unwrap();
    let mut opts = Options::new(dir.join("out"));
    opts.shapes = Some(vec!["16:9".into()]);
    let no_plates = |_: &Clip, _: &Shape| -> Result<Option<Plate>> { Ok(None) };
    let out = render(&t, &lib, &no_plates, &Lut3d::identity(33), &opts, &mut |_, _| {}).unwrap();
    let kinds: Vec<(String, u32, u32, u32)> = out.deliveries.iter().map(|d| (d.codec.clone(), d.width, d.height, d.qc.bit_depth)).collect();
    assert_eq!(kinds, [("hevc".to_string(), 3840, 2160, 10), ("h264".to_string(), 1920, 1080, 8)]);
    for d in &out.deliveries {
        assert!(d.qc.ok, "{}: {:?}", d.name, d.qc);
        assert_eq!(d.qc.frames, 30);
    }
    // the job's result is one the API takes (reportRender, the calendar's deliveries) — once every file has its hash
    let mut out = out;
    assert!(out.job_result(&t).is_err(), "no hashes yet");
    for (i, d) in out.deliveries.iter_mut().enumerate() {
        d.hash = Some(format!("{i}").repeat(64));
    }
    let job = out.job_result(&t).unwrap();
    vault_render::api_accepts(&job).unwrap();
    assert_eq!(job["status"], "done");
    assert_eq!(job["output_hash"], "1".repeat(64), "the studio plays the 1080 H.264 cut");
    assert_eq!(job["deliveries"].as_array().unwrap().len(), 2);
    assert!(job["report"]["color"]["transforms"].is_object() && job["report"]["sound"].is_object());
    for bad in [json!({ "status": "finished" }), json!({ "output_hash": "film" }), json!({ "progress": 2 }), json!({ "report": [] })] {
        assert!(vault_render::api_accepts(&bad).is_err(), "{bad}");
    }
    let mut odd = job.clone();
    odd["deliveries"][0]["width"] = json!("wide");
    assert!(vault_render::api_accepts(&odd).is_err());
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn the_mix_ducks_fades_and_levels() {
    let dir = scratch("mix");
    let (music, voice) = (dir.join("music.wav"), dir.join("voice.wav"));
    write_wav(&music, &tone(440.0, -12.0, 6.0)).unwrap();
    write_wav(&voice, &tone(1000.0, -12.0, 2.0)).unwrap();
    let clip = |id: &str, track: &str, start: f64, dur: f64, vol: f64, fin: Option<f64>| -> Clip {
        serde_json::from_value(json!({ "id": id, "track": track, "start": start, "in": 0, "dur": dur, "vol": vol, "fin": fin, "fout": fin })).unwrap()
    };
    let m = AudioClip { clip: clip("m", "A2", 0.0, 6.0, 1.0, Some(0.0)), file: music.clone().into() };
    let v = AudioClip { clip: clip("v", "A1", 2.0, 2.0, 1.0, Some(0.0)), file: voice.clone().into() };
    let read = |w: &Path| -> Vec<f32> {
        let b = std::fs::read(w).unwrap();
        b[58..].chunks(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect()
    };
    let rms = |x: &[f32], from: f64, to: f64| -> f64 {
        let s = &x[(from * RATE as f64) as usize * 2..(to * RATE as f64) as usize * 2];
        (s.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / s.len() as f64).sqrt()
    };
    let both = mix(&[m.clone(), v.clone()], 6.0, None, &dir.join("both"), &mut |_| {}).unwrap();
    let alone = mix(std::slice::from_ref(&v), 6.0, None, &dir.join("alone"), &mut |_| {}).unwrap();
    let (b, a) = (read(&both.wav), read(&alone.wav));
    assert_eq!(b.len(), 6 * RATE as usize * 2);
    // the music alone: what both minus the voice leaves
    let music_only: Vec<f32> = b.iter().zip(&a).map(|(x, y)| x - y).collect();
    let before = rms(&music_only, 0.5, 1.9);
    let under = rms(&music_only, 3.0, 3.9);
    let after = rms(&music_only, 5.0, 5.9);
    let duck = 20.0 * (under / before).log10();
    // sidechaincompress: a steady key of RMS −15 dBFS is 19 dB over the threshold (0.02, −34 dBFS); ratio 4 takes
    // three quarters of that away (−14.2 dB), a little more as the attack follows the key's peaks faster than the
    // release lets go. A voice at speech level (about −20 dBFS RMS) ducks the music by about 10 dB.
    assert!((-17.0..-13.0).contains(&duck), "the voice ducks the music by {duck:.1} dB");
    assert!(after / before > 0.8, "and lets it back up: {:.2}", after / before);
    // the voice starts at 2 s to the sample, nothing before it
    assert!(rms(&a, 0.0, 1.99) < 1e-6 && rms(&a, 2.01, 3.9) > 0.1);
    // fades: the default on a music clip is 0.8 s up
    let faded = mix(&[AudioClip { clip: clip("m", "A2", 0.0, 6.0, 1.0, None), file: music.clone().into() }], 6.0, None, &dir.join("fade"), &mut |_| {}).unwrap();
    let f = read(&faded.wav);
    assert!(rms(&f, 0.0, 0.2) < 0.5 * rms(&f, 1.0, 1.2));
    // levelled to −23 LUFS, whatever it came in at
    let lv = mix(&[m], 6.0, Some(Target { lufs: -23.0, true_peak: -1.0 }), &dir.join("level"), &mut |_| {}).unwrap();
    assert!((lv.levelled.lufs.unwrap() + 23.0).abs() < 0.1, "{:?}", lv.levelled);
    assert!((lv.gain_db - (-23.0 - lv.mixed.lufs.unwrap())).abs() < 1e-9);
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn world_plates_the_hook_and_a_hero_frame() {
    let dir = scratch("world");
    // the world shot's plate for 1:1: ACEScct code values, its first second red, then green (it starts at clip.in)
    let plate = dir.join("plate-1x1.mp4");
    movie(&plate, &[RED, GREEN], 500.0);
    // the hook layer: transparent, a white square in the top-left quarter
    let gpu = Gpu::new().unwrap();
    let (w, h) = (1080u32, 1080u32);
    let px: Vec<f32> = (0..w * h)
        .flat_map(|i| {
            let (x, y) = (i % w, i / w);
            if (135..405).contains(&x) && (135..405).contains(&y) { [1.0, 1.0, 1.0, 1.0] } else { [0.0, 0.0, 0.0, 0.0] }
        })
        .collect();
    let hook = dir.join("hook.png");
    gpu.png(&gpu.from_rgba(&px, w, h), w, h, &hook).unwrap();
    let bed = dir.join("bed.wav");
    write_wav(&bed, &tone(220.0, -20.0, 6.0)).unwrap();
    let card = json!({ "cards": { "1x1": "thumb" }, "hooks": { "1x1": "hook" } });
    let lib = Lib(HashMap::from([
        ("card".to_string(), (media("card", "video", card), hook.clone())),
        ("hook".to_string(), (Media { hash: "hook".into(), mime: "image/png".into(), kind: "image".into(), ..Default::default() }, hook.clone())),
        ("thumb".to_string(), (Media { hash: "thumb".into(), mime: "image/jpeg".into(), kind: "image".into(), size: 1234, ..Default::default() }, hook)),
        ("bed".to_string(), (media("bed", "audio", json!({})), bed)),
    ]));
    let t: Timeline = serde_json::from_value(json!({
        "id": "t3", "name": "World", "aspect": "1:1",
        "clips": [
            { "id": "k", "track": "V1", "start": 0, "in": 0, "dur": 0.5, "vol": 1, "hash": "card" },
            { "id": "w1", "track": "V1", "start": 1, "in": 5, "dur": 2, "vol": 1, "kind": "world", "shot": "s1", "shotVersion": 3 },
            { "id": "b", "track": "A3", "start": 0, "in": 0, "dur": 6, "vol": 1, "hash": "bed" }
        ]
    }))
    .unwrap();
    let asked = std::cell::RefCell::new(Vec::new());
    let plates = |c: &Clip, s: &Shape| -> Result<Option<Plate>> {
        asked.borrow_mut().push((c.id.clone(), s.aspect.to_string()));
        Ok((c.shot.as_deref() == Some("s1") && s.aspect == "1:1").then(|| Plate { file: plate.clone(), key: Some("k1".into()), fingerprint: Some("f1".into()), reused: Some(false), ..Default::default() }))
    };
    let mut opts = Options::new(dir.join("out"));
    opts.shapes = Some(vec!["1:1".into()]);
    let mut out = render(&t, &lib, &plates, &Lut3d::identity(33), &opts, &mut |_, _| {}).unwrap();
    assert_eq!(*asked.borrow(), [("w1".to_string(), "1:1".to_string())]);
    assert_eq!(out.plates.len(), 1);
    assert!(out.color.transforms.contains_key("idt-acescct"));
    let f = out.deliveries[0].file.clone();
    assert!(out.deliveries[0].qc.ok, "{:?}", out.deliveries[0].qc);
    // the card marker is no picture: black until the world clip, which opens at once (a film with a hook does not
    // fade up); the plate from its start, then its second second
    let code = |c: [f32; 3]| c.map(f64::from);
    assert!(near(pixel(&f, 0.5), [0.0, 0.0, 0.0], 0.01));
    assert!(near(pixel(&f, 1.5), code(RED), 0.03), "{:?}", pixel(&f, 1.5));
    assert!(near(pixel(&f, 2.6), code(GREEN), 0.03), "{:?}", pixel(&f, 2.6));
    // the hook over the first 2.5 s (from the card's start), then gone
    assert!(near(pixel_at(&f, 1.5, 0.25, 0.25), [1.0, 1.0, 1.0], 0.03), "{:?}", pixel_at(&f, 1.5, 0.25, 0.25));
    assert!(near(pixel_at(&f, 2.8, 0.25, 0.25), code(GREEN), 0.03));
    // the title card goes out with the film, for the same channels
    out.deliveries[0].hash = Some("film".into());
    let job = out.job_result(&t).unwrap();
    let thumbs: Vec<&Value> = job["deliveries"].as_array().unwrap().iter().filter(|d| d["kind"] == "thumbnail").collect();
    assert_eq!(thumbs.len(), 1);
    assert_eq!((thumbs[0]["hash"].as_str(), thumbs[0]["bytes"].as_u64()), (Some("thumb"), Some(1234)));
    assert_eq!(job["report"]["plates"][0]["key"], "k1");
    // a hero frame of the world clip: the plate's second second, full precision
    let png = dir.join("frame.png");
    let rep = hero_frame(&t, &lib, &plates, &Lut3d::identity(33), 2.6, "1:1", &png).unwrap();
    assert_eq!(rep["clip"], "w1");
    let still = gpu.still(&png).unwrap();
    let px = gpu.read(&still, 1080, 1080);
    let c = ((540 * 1080 + 540) * 4) as usize;
    assert!(near([px[c] as f64, px[c + 1] as f64, px[c + 2] as f64], code(GREEN), 0.02), "{:?}", &px[c..c + 3]);
    std::fs::remove_dir_all(dir).ok();
}

/// A flat linear colour as an OpenEXR file, written by Core Image (unmanaged: the values as they are).
fn exr_frame(c: [f32; 3]) -> Vec<u8> {
    // a plain OpenEXR file by hand: scanlines, no compression, 32-bit float B, G, R (channels in name order), no
    // chromaticities (so Rec.709 primaries, linear — as the OpenEXR specification reads a file without them)
    let (w, h) = (64i32, 64i32);
    let mut b = 20000630u32.to_le_bytes().to_vec();
    b.extend_from_slice(&2u32.to_le_bytes());
    let mut attr = |name: &str, kind: &str, data: &[u8]| {
        b.extend_from_slice(name.as_bytes());
        b.push(0);
        b.extend_from_slice(kind.as_bytes());
        b.push(0);
        b.extend_from_slice(&(data.len() as u32).to_le_bytes());
        b.extend_from_slice(data);
    };
    let mut ch = Vec::new();
    for n in ["B", "G", "R"] {
        ch.extend_from_slice(n.as_bytes());
        ch.push(0);
        ch.extend_from_slice(&2i32.to_le_bytes()); // FLOAT
        ch.extend_from_slice(&[0, 0, 0, 0]); // pLinear, reserved
        ch.extend_from_slice(&1i32.to_le_bytes());
        ch.extend_from_slice(&1i32.to_le_bytes());
    }
    ch.push(0);
    attr("channels", "chlist", &ch);
    attr("compression", "compression", &[0]);
    let window: Vec<u8> = [0, 0, w - 1, h - 1].iter().flat_map(|v: &i32| v.to_le_bytes()).collect();
    attr("dataWindow", "box2i", &window);
    attr("displayWindow", "box2i", &window);
    attr("lineOrder", "lineOrder", &[0]);
    attr("pixelAspectRatio", "float", &1f32.to_le_bytes());
    attr("screenWindowCenter", "v2f", &[0u8; 8]);
    attr("screenWindowWidth", "float", &1f32.to_le_bytes());
    b.push(0);
    let line = 3 * w as usize * 4;
    let table = b.len() + 8 * h as usize;
    for y in 0..h as usize {
        b.extend_from_slice(&((table + y * (8 + line)) as u64).to_le_bytes());
    }
    for y in 0..h {
        b.extend_from_slice(&y.to_le_bytes());
        b.extend_from_slice(&(line as i32).to_le_bytes());
        for v in [c[2], c[1], c[0]] {
            for _ in 0..w {
                b.extend_from_slice(&v.to_le_bytes());
            }
        }
    }
    b
}

/// A ustar tar of the given members (the reader needs names, sizes and the type flag).
fn tar(members: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut out = Vec::new();
    for (name, body) in members {
        let mut h = [0u8; 512];
        h[..name.len()].copy_from_slice(name.as_bytes());
        h[124..136].copy_from_slice(format!("{:011o}\0", body.len()).as_bytes());
        h[156] = b'0';
        out.extend_from_slice(&h);
        out.extend_from_slice(body);
        out.resize(out.len().div_ceil(512) * 512, 0);
    }
    out.extend_from_slice(&[0u8; 1024]);
    out
}

#[test]
fn an_exr_sequence_plays_at_its_own_rate_through_its_journey() {
    let dir = scratch("sequence");
    let gpu = Gpu::new().unwrap();
    // four frames at 4 fps: red for half a second, then blue — in linear light
    let (red, blue) = ([0.5f32, 0.05, 0.05], [0.05f32, 0.05, 0.5]);
    let frames: Vec<(String, Vec<u8>)> = [red, red, blue, blue].iter().enumerate().map(|(i, c)| (format!("seq/{i:04}.exr"), exr_frame(*c))).collect();
    let back = vault_render::gpu::to_origin(&vault_media::gpu::load_image(&frames[0].1).unwrap());
    let px = gpu.read(&back, 64, 64);
    assert!(near([px[0] as f64, px[1] as f64, px[2] as f64], red.map(f64::from), 0.01), "the EXR reads back as {:?}", &px[..4]);
    let file = dir.join("seq.tar");
    std::fs::write(&file, tar(&frames)).unwrap();
    let m = Media { hash: "s".into(), mime: "application/x-tar".into(), kind: "other".into(), title: "seq".into(), meta: json!({ "sequence": "exr", "fps": 4 }), ..Default::default() };
    let lib = Lib(HashMap::from([("s".to_string(), (m, file))]));
    let t: Timeline = serde_json::from_value(json!({
        "id": "t5", "name": "Sequence", "aspect": "1:1",
        "clips": [{ "id": "c1", "track": "V1", "start": 0, "in": 0, "dur": 1, "vol": 1, "hash": "s" }]
    }))
    .unwrap();
    let mut opts = Options::new(dir.join("out"));
    opts.shapes = Some(vec!["1:1".into()]);
    let no_plates = |_: &Clip, _: &Shape| -> Result<Option<Plate>> { Ok(None) };
    let out = render(&t, &lib, &no_plates, &Lut3d::identity(33), &opts, &mut |_, _| {}).unwrap();
    assert!(out.deliveries[0].qc.ok, "{:?}", out.deliveries[0].qc);
    assert!(out.color.transforms.contains_key("idt-linear-rec709"), "{:?}", out.color.transforms);
    let f = &out.deliveries[0].file;
    let (a, b) = (pixel(f, 0.3), pixel(f, 0.7));
    assert!(a[0] > a[2] + 0.02 && b[2] > b[0] + 0.02, "{a:?} then {b:?}");
    // a hero frame: the frame on screen, exactly through the journey (no fades)
    let j = vault_media::cst::journey("linear-rec709").unwrap();
    for (at, c) in [(0.1, red), (0.8, blue)] {
        let png = dir.join("frame.png");
        hero_frame(&t, &lib, &no_plates, &Lut3d::identity(33), at, "1:1", &png).unwrap();
        let px = gpu.read(&gpu.still(&png).unwrap(), 1080, 1080);
        let i = ((540 * 1080 + 540) * 4) as usize;
        let want = j.apply(c.map(f64::from));
        assert!(near([px[i] as f64, px[i + 1] as f64, px[i + 2] as f64], want, 0.01), "at {at}: {:?} not {want:?}", &px[i..i + 3]);
    }
    std::fs::remove_dir_all(dir).ok();
}
