//! A shot as a colourist reads it for the base correction (story-producer `grading.md`): the elements that must not
//! jump across a cut — the blacks, the whites, the middle, the skin — measured on the real thing (the shot's 4K
//! grading still, else its original's frame; never a proxy) through the output transform, as the Rec.709 display
//! shows them: levels in IRE, casts in IRE (warm = R − B, green = G − (R + B) / 2), skin as its hue on the
//! vectorscope against the skin line, its saturation and its level. Faces are found by Apple's Vision.
//!
//! `fit` levels one shot to another by those elements (the balance nodes only), and `neutral` sets a scene master's
//! white balance to its neutrals plus the warmth asked for. `scopes` draws what a colourist looks at: the picture,
//! the waveform, the RGB parade and the vectorscope with the skin line.

use std::collections::BTreeMap;

use anyhow::{Context, Result, bail};
use objc2::{AnyThread, rc::Retained};
use objc2_core_image::CIImage;
use objc2_foundation::{NSArray, NSDictionary};
use objc2_vision::{VNDetectFaceRectanglesRequest, VNImageRequestHandler, VNRequest};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    Output,
    gpu::Gpu,
    grade::{Balance, LUMA},
    render::{Library, grade_still_of_clip, original_frame},
    timeline::{Clip, Shape, Timeline},
};

/// A box on the frame, 0…1 from its top left: [x0, y0, x1, y1].
pub type Rect = [f64; 4];

/// The skin line on the vectorscope (the I line): where every complexion sits, in degrees from +Cb towards +Cr.
pub const SKIN_LINE: f64 = 123.0;
/// A display code value above this in any channel is clipped.
const CLIP: f32 = 0.985;
/// The middle tones' and the whites' colour is read from pixels less saturated than this (a yellow pillow is content).
const NEUTRALISH: f64 = 0.1;

/// Parts of the frame named by hand, when what the eye knows beats what is found: a white or grey object known to be
/// neutral, a real black, the skin (else the face Vision finds).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Regions {
    /// a white object known to be neutral (a wall, a T-shirt, the rug)
    pub white: Option<Rect>,
    /// a grey object known to be neutral
    pub grey: Option<Rect>,
    /// a real black
    pub black: Option<Rect>,
    /// the skin: the key side of the face, cheeks and forehead (not the beard, not a cap's shadow)
    pub skin: Option<Rect>,
}

/// One element as the display shows it: its level and its colour.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Disp {
    /// luma, 0…1
    pub y: f64,
    /// the vectorscope's axes
    pub cb: f64,
    pub cr: f64,
}

impl Disp {
    pub fn of(rgb: [f64; 3]) -> Disp {
        let y = rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2];
        Disp { y, cb: (rgb[2] - y) / 1.8556, cr: (rgb[0] - y) / 1.5748 }
    }
    pub fn hue(&self) -> f64 {
        self.cr.atan2(self.cb).to_degrees().rem_euclid(360.0)
    }
    pub fn chroma(&self) -> f64 {
        self.cb.hypot(self.cr)
    }
}

/// What a shot is like: the display's elements (as JSON for the agent) and, for fitting, the mean ACEScct colour of
/// each element's pixels as shot.
pub struct Look {
    pub clip: String,
    pub json: Value,
    /// element → its pixels' mean ACEScct colour, as shot
    pub cct: BTreeMap<String, [f64; 3]>,
    /// the picture after the balance, display code values, `SMALL` wide, for the scopes
    pub picture: Vec<[f32; 3]>,
    pub picture_size: (u32, u32),
    /// the boxes drawn on the picture: (what, box)
    pub boxes: Vec<(String, Rect)>,
}

/// The width the scopes are drawn from.
const SMALL: u32 = 960;

/// Faces Vision finds in a picture (display code values), largest first, as boxes from the top left.
pub fn faces(img: &CIImage) -> Vec<Rect> {
    // SAFETY: Vision objects we create and own, used from this thread only
    unsafe {
        let request = VNDetectFaceRectanglesRequest::new();
        let handler = VNImageRequestHandler::initWithCIImage_options(VNImageRequestHandler::alloc(), img, &NSDictionary::new());
        let as_request: Retained<VNRequest> = Retained::into_super(Retained::into_super(request.clone()));
        if handler.performRequests_error(&NSArray::from_retained_slice(&[as_request])).is_err() {
            return Vec::new();
        }
        let mut out: Vec<Rect> = request
            .results()
            .map(|r| r.iter().map(|f| f.boundingBox()).map(|b| [b.origin.x, 1.0 - b.origin.y - b.size.height, b.origin.x + b.size.width, 1.0 - b.origin.y]).collect())
            .unwrap_or_default();
        out.sort_by(|a, b| ((b[2] - b[0]) * (b[3] - b[1])).total_cmp(&((a[2] - a[0]) * (a[3] - a[1]))));
        out
    }
}

/// The skin inside a face Vision found: the cheeks and the lower forehead — below a cap's brim and the hair, above the
/// mouth and a beard.
pub fn skin_patch(face: &Rect) -> Rect {
    let (w, h) = (face[2] - face[0], face[3] - face[1]);
    [face[0] + 0.2 * w, face[1] + 0.12 * h, face[0] + 0.8 * w, face[1] + 0.6 * h]
}

/// A clip's picture, the real thing: its grading still (a 4K frame of the original in ACEScct) when its frame is in
/// the clip, else the original's own frame at the clip's middle. Never a proxy: a shot not on this Mac isn't read.
fn real(gpu: &Gpu, lib: &dyn Library, c: &Clip) -> Result<(crate::gpu::Image, Value)> {
    if let Some(still) = grade_still_of_clip(lib, c)
        && let Ok(file) = lib.file(&still.hash)
    {
        let at = still.meta.get("t").cloned().unwrap_or(Value::Null);
        return Ok((gpu.still(&file)?, json!({ "from": "its grading still (4K ACEScct, from the original)", "still": still.hash, "t": at })));
    }
    let img = original_frame(gpu, lib, c, c.start + c.dur / 2.0)?;
    Ok((img, json!({ "from": "its original's frame (its middle)", "t": ((c.in_ + c.dur / 2.0) * 1000.0).round() / 1000.0 })))
}

/// A picture read back as RGB f32, row by row from the top.
fn rgb(gpu: &Gpu, img: &CIImage, w: u32, h: u32) -> Vec<[f32; 3]> {
    gpu.read(img, w, h).chunks_exact(4).map(|p| [p[0], p[1], p[2]]).collect()
}

/// Luma percentiles from a histogram (4096 bins over −0.1…1.1): fast on 8 million pixels, and exact to a tenth of an IRE.
struct Hist(Vec<u64>, u64);
impl Hist {
    const LO: f64 = -0.1;
    const SPAN: f64 = 1.2;
    const N: usize = 4096;
    fn new() -> Hist {
        Hist(vec![0; Self::N], 0)
    }
    fn add(&mut self, y: f64) {
        let i = (((y - Self::LO) / Self::SPAN) * Self::N as f64).clamp(0.0, (Self::N - 1) as f64) as usize;
        self.0[i] += 1;
        self.1 += 1;
    }
    fn q(&self, p: f64) -> f64 {
        let want = (p * self.1 as f64).ceil().max(1.0) as u64;
        let mut n = 0;
        for (i, c) in self.0.iter().enumerate() {
            n += c;
            if n >= want {
                return Self::LO + (i as f64 + 0.5) / Self::N as f64 * Self::SPAN;
            }
        }
        Self::LO + Self::SPAN
    }
}

const BLACKS: u8 = 1;
const WHITES: u8 = 2;
const MIDS: u8 = 4;
const SKIN: u8 = 8;
const R_WHITE: u8 = 16;
const R_GREY: u8 = 32;
const R_BLACK: u8 = 64;
const ELEMENTS: [(u8, &str); 7] =
    [(BLACKS, "blacks"), (WHITES, "whites"), (MIDS, "mids"), (SKIN, "skin"), (R_WHITE, "white"), (R_GREY, "grey"), (R_BLACK, "black")];

fn inside(r: &Rect, x: usize, y: usize, w: usize, h: usize) -> bool {
    let (fx, fy) = ((x as f64 + 0.5) / w as f64, (y as f64 + 0.5) / h as f64);
    fx >= r[0] && fx < r[2] && fy >= r[1] && fy < r[3]
}

/// The pixels of each element, as flags per pixel, from the picture as shot (display code values).
fn classify(px: &[[f32; 3]], w: usize, h: usize, skin: Option<&Rect>, regions: &Regions) -> Vec<u8> {
    let mut all = Hist::new();
    let mut unclipped = Hist::new();
    for p in px {
        let d = Disp::of([p[0] as f64, p[1] as f64, p[2] as f64]);
        all.add(d.y);
        if p.iter().all(|c| *c <= CLIP) {
            unclipped.add(d.y);
        }
    }
    let (p2, p40, p60) = (all.q(0.02), all.q(0.40), all.q(0.60));
    let top = if unclipped.1 > 0 { unclipped.q(0.98) } else { f64::INFINITY };
    let mut flags = vec![0u8; px.len()];
    for (i, p) in px.iter().enumerate() {
        let d = Disp::of([p[0] as f64, p[1] as f64, p[2] as f64]);
        let (x, y) = (i % w, i / w);
        let mut f = 0;
        if d.y <= p2 {
            f |= BLACKS;
        }
        if d.y >= top && p.iter().all(|c| *c <= CLIP) && d.chroma() < NEUTRALISH {
            f |= WHITES;
        }
        if d.y >= p40 && d.y <= p60 && d.chroma() < NEUTRALISH {
            f |= MIDS;
        }
        if let Some(r) = skin {
            let hue = d.hue();
            if inside(r, x, y, w, h) && (40.0..=170.0).contains(&hue) && d.chroma() > 0.012 && d.y > 0.08 && d.y < 0.97 {
                f |= SKIN;
            }
        }
        for (bit, r) in [(R_WHITE, &regions.white), (R_GREY, &regions.grey), (R_BLACK, &regions.black)] {
            if r.as_ref().is_some_and(|r| inside(r, x, y, w, h)) {
                f |= bit;
            }
        }
        flags[i] = f;
    }
    flags
}

/// The elements of a picture (display code values) over the pixels `flags` names.
fn elements(px: &[[f32; 3]], flags: &[u8]) -> Value {
    let r1 = |x: f64| (x * 10.0).round() / 10.0;
    let ire = |x: f64| r1(x * 100.0);
    let mut all = Hist::new();
    let mut chroma = Hist::new();
    let mut clipped = 0usize;
    let mut sum: BTreeMap<u8, ([f64; 3], usize, Hist)> = ELEMENTS.iter().map(|(b, _)| (*b, ([0.0; 3], 0, Hist::new()))).collect();
    for (p, f) in px.iter().zip(flags) {
        let v = [p[0] as f64, p[1] as f64, p[2] as f64];
        let d = Disp::of(v);
        all.add(d.y);
        chroma.add(d.chroma());
        if p.iter().any(|c| *c > CLIP) {
            clipped += 1;
        }
        for (bit, _) in ELEMENTS {
            if f & bit != 0 {
                let e = sum.get_mut(&bit).unwrap();
                (0..3).for_each(|i| e.0[i] += v[i]);
                e.1 += 1;
                e.2.add(d.y);
            }
        }
    }
    let mut out = json!({
        "levels": { "p1": ire(all.q(0.01)), "p5": ire(all.q(0.05)), "p25": ire(all.q(0.25)), "p50": ire(all.q(0.5)), "p75": ire(all.q(0.75)), "p95": ire(all.q(0.95)), "p99": ire(all.q(0.99)) },
        "contrast": ire(all.q(0.95) - all.q(0.05)),
        "clipped_pct": r1(clipped as f64 / px.len().max(1) as f64 * 100.0),
        "saturation": r1(chroma.q(0.5) * 100.0),
    });
    for (bit, name) in ELEMENTS {
        let (s, n, hist) = &sum[&bit];
        if *n < 64 {
            if bit < R_WHITE {
                out[name] = Value::Null;
            }
            continue;
        }
        let m = s.map(|x| x / *n as f64);
        let d = Disp::of(m);
        let mut e = json!({ "ire": ire(d.y), "warm": ire(m[0] - m[2]), "green": ire(m[1] - (m[0] + m[2]) / 2.0), "px": n });
        if bit == SKIN || bit >= R_WHITE {
            e["ire"] = json!(ire(hist.q(0.5)));
            e["hue"] = json!(r1(d.hue()));
            e["off_skin_line"] = json!(r1((d.hue() - SKIN_LINE + 180.0).rem_euclid(360.0) - 180.0));
            e["chroma"] = json!(r1(d.chroma() * 100.0));
        }
        if bit >= R_WHITE {
            out["regions"][name] = e;
        } else {
            out[name] = e;
        }
    }
    out
}

/// Box-filtered down to `SMALL` wide (the scopes' picture).
fn shrink(px: &[[f32; 3]], w: u32, h: u32) -> (Vec<[f32; 3]>, (u32, u32)) {
    let sw = SMALL.min(w);
    let sh = ((sw as f64 * h as f64 / w as f64).round() as u32).max(1);
    let (fx, fy) = (w as f64 / sw as f64, h as f64 / sh as f64);
    let mut out = vec![[0f32; 3]; (sw * sh) as usize];
    for y in 0..sh {
        let (y0, y1) = ((y as f64 * fy) as u32, (((y + 1) as f64 * fy) as u32).min(h).max((y as f64 * fy) as u32 + 1));
        for x in 0..sw {
            let (x0, x1) = ((x as f64 * fx) as u32, (((x + 1) as f64 * fx) as u32).min(w).max((x as f64 * fx) as u32 + 1));
            let mut s = [0f32; 3];
            let mut n = 0f32;
            for yy in y0..y1 {
                for xx in x0..x1 {
                    let p = px[(yy * w + xx) as usize];
                    (0..3).for_each(|i| s[i] += p[i]);
                    n += 1.0;
                }
            }
            out[(y * sw + x) as usize] = s.map(|v| v / n.max(1.0));
        }
    }
    (out, (sw, sh))
}

/// Read one shot: its elements as shot and after its balance, in the timeline's shape at its full render size (4K
/// for 16:9), from the real thing. `balance` overrides the clip's own (a proposal checked before it is written).
pub fn look(t: &Timeline, lib: &dyn Library, c: &Clip, output: &dyn Output, regions: &Regions, balance: Option<&Balance>) -> Result<Look> {
    if c.is_world() {
        bail!("a world clip is a plate rendered at the end: it is graded by its shot's light, not measured here");
    }
    let s = Shape::of(&t.aspect).or_else(|| Shape::of("16:9")).context("no shape")?;
    let (w, h) = s.render_size();
    let mut gpu = Gpu::new()?;
    gpu.set_output(&output.lut());
    let (src, from) = real(&gpu, lib, c)?;
    let framed = gpu.frame_to(&src, w, h, c.frame_for(s.aspect))?;
    let shot = gpu.output(&framed)?;
    // the faces and the skin: by hand, else the largest face Vision finds
    let found = faces(&shot);
    let skin = regions.skin.or_else(|| found.first().map(skin_patch));
    let (cct, disp) = (rgb(&gpu, &framed, w, h), rgb(&gpu, &shot, w, h));
    let flags = classify(&disp, w as usize, h as usize, skin.as_ref(), regions);
    let as_shot = elements(&disp, &flags);
    drop(disp);
    // each element's mean ACEScct colour, as shot: what the fit moves
    let mut means: BTreeMap<String, [f64; 3]> = BTreeMap::new();
    for (bit, name) in ELEMENTS {
        let (mut s, mut n) = ([0f64; 3], 0usize);
        for (p, f) in cct.iter().zip(&flags) {
            if f & bit != 0 {
                (0..3).for_each(|i| s[i] += p[i] as f64);
                n += 1;
            }
        }
        if n >= 64 {
            means.insert(name.to_string(), s.map(|x| x / n as f64));
        }
    }
    drop(cct);
    let bal = balance.copied().or_else(|| c.balance()).unwrap_or_default();
    let after = gpu.output(&*gpu.balance(&framed, Some(&bal))?)?;
    let disp = rgb(&gpu, &after, w, h);
    let balanced = elements(&disp, &flags);
    let (picture, picture_size) = shrink(&disp, w, h);
    let mut boxes: Vec<(String, Rect)> = Vec::new();
    if let Some(r) = skin {
        boxes.push(("skin".into(), r));
    }
    for (name, r) in [("white", regions.white), ("grey", regions.grey), ("black", regions.black)] {
        if let Some(r) = r {
            boxes.push((name.into(), r));
        }
    }
    let r3 = |r: &Rect| r.map(|v| (v * 1000.0).round() / 1000.0);
    let mut json = json!({
        "clip": c.id,
        "size": [w, h],
        "faces": found.iter().map(r3).collect::<Vec<_>>(),
        "skin_box": skin.as_ref().map(r3),
        "as_shot": as_shot,
        "balanced": balanced,
        "balance": bal,
    });
    if let Some(o) = from.as_object() {
        for (k, v) in o {
            json[k] = v.clone();
        }
    }
    Ok(Look { clip: c.id.clone(), json, cct: means, picture, picture_size, boxes })
}

// ── the fit: a shot levelled to a target by its elements ─────────────────────────────────────────────────────────

/// How much each element weighs in a match: (its level, its colour). Skin most — the eye goes to a face first; the
/// blacks' level next (a black level that wanders jumps out); the whites' colour; the middle's colour least (a
/// garden's middle is green by content).
fn weights(name: &str) -> (f64, f64) {
    match name {
        "skin" => (3.0, 4.0),
        "blacks" => (2.0, 1.0),
        "whites" => (1.0, 2.0),
        "mids" => (1.5, 0.5),
        "white" | "grey" => (1.0, 4.0),
        "black" => (2.0, 1.0),
        _ => (0.0, 0.0),
    }
}

/// An element through a balance and the output transform, as the display shows it.
fn shown(output: &dyn Output, b: &Balance, cct: [f64; 3]) -> Disp {
    Disp::of(output.apply(b.apply(cct)))
}

/// What a shot's elements look like on the display after `b` — the target a match aims for.
pub fn target(look: &Look, output: &dyn Output, b: &Balance) -> BTreeMap<String, Disp> {
    look.cct.iter().map(|(k, v)| (k.clone(), shown(output, b, *v))).collect()
}

/// A shot's elements as the display would show them after `b` (from each element's mean colour: a prediction, checked
/// by reading the shot again with `look`): level, cast and, for skin and named regions, hue and saturation.
pub fn predict(look: &Look, output: &dyn Output, b: &Balance) -> Value {
    let r1 = |x: f64| (x * 10.0).round() / 10.0;
    let mut out = json!({});
    for (k, v) in &look.cct {
        let rgb = output.apply(b.apply(*v));
        let d = Disp::of(rgb);
        let mut e = json!({ "ire": r1(d.y * 100.0), "warm": r1((rgb[0] - rgb[2]) * 100.0), "green": r1((rgb[1] - (rgb[0] + rgb[2]) / 2.0) * 100.0) });
        if !matches!(k.as_str(), "blacks" | "whites" | "mids") {
            e["hue"] = json!(r1(d.hue()));
            e["off_skin_line"] = json!(r1((d.hue() - SKIN_LINE + 180.0).rem_euclid(360.0) - 180.0));
            e["chroma"] = json!(r1(d.chroma() * 100.0));
        }
        out[k] = e;
    }
    out
}

/// Whether an element can be matched in a shot: a frame without real blacks (a white rug filling it) or without real
/// whites has none to match.
fn usable(name: &str, d: &Disp) -> bool {
    match name {
        "blacks" => d.y < 0.15,
        "whites" => d.y > 0.5,
        _ => true,
    }
}

/// The balance that levels a shot to `want` by the elements both have (less `skip`): the balance nodes only, from
/// as shot. Exposure and white balance do the most; contrast, highlights, lows and saturation cost, so they only
/// nudge.
pub fn fit(shot: &Look, want: &BTreeMap<String, Disp>, output: &dyn Output, skip: &[String]) -> (Balance, Vec<String>) {
    let none = Balance::default();
    let pairs: Vec<(String, [f64; 3], Disp)> = shot
        .cct
        .iter()
        .filter(|(k, _)| !skip.contains(k) && weights(k) != (0.0, 0.0))
        .filter_map(|(k, v)| want.get(k).map(|w| (k.clone(), *v, *w)))
        .filter(|(k, v, w)| usable(k, &shown(output, &none, *v)) && usable(k, w))
        .collect();
    let used: Vec<String> = pairs.iter().map(|p| p.0.clone()).collect();
    let cost = |b: &Balance| -> f64 {
        let fit: f64 = pairs
            .iter()
            .map(|(k, v, w)| {
                let (wl, wc) = weights(k);
                let d = shown(output, b, *v);
                wl * (d.y - w.y).powi(2) + wc * ((d.cb - w.cb).powi(2) + (d.cr - w.cr).powi(2))
            })
            .sum();
        // a stop of highlights or lows costs about what 1.6 IRE off does; contrast and saturation a little more
        fit + 0.00025 * (b.highlights.powi(2) + b.shadows.powi(2)) + 0.004 * b.contrast.powi(2) + 0.002 * b.sat.powi(2)
    };
    let mut b = Balance::default();
    if pairs.is_empty() {
        return (b, used);
    }
    for _ in 0..4 {
        let mut step = 0.5;
        while step > 0.001 {
            let mut better = false;
            for k in ["exposure", "temp", "tint", "contrast", "highlights", "shadows", "sat"] {
                for dir in [1.0, -1.0] {
                    let mut t = b;
                    t.set(k, b.get(k) + dir * step);
                    if cost(&t) < cost(&b) - 1e-12 {
                        b = t;
                        better = true;
                    }
                }
            }
            if !better {
                step /= 2.0;
            }
        }
    }
    (b, used)
}

/// A scene master's white balance: its neutrals (the white or grey named by hand, else its whites and middle tones)
/// to grey, then `warmth` stops warmer — the rest of its balance as it is.
pub fn neutral(shot: &Look, output: &dyn Output, now: &Balance, warmth: f64) -> (Balance, Vec<String>) {
    let named: Vec<&str> = ["white", "grey"].into_iter().filter(|k| shot.cct.contains_key(*k)).collect();
    let keys: Vec<(&str, f64)> = if !named.is_empty() {
        named.into_iter().map(|k| (k, 1.0)).collect()
    } else {
        let whites = shot.cct.get("whites").is_some_and(|v| usable("whites", &shown(output, &Balance::default(), *v)));
        [("whites", if whites { 2.0 } else { 0.0 }), ("mids", 0.5)].into_iter().filter(|(k, w)| *w > 0.0 && shot.cct.contains_key(*k)).collect()
    };
    let cost = |b: &Balance| -> f64 {
        keys.iter()
            .map(|(k, w)| {
                let d = shown(output, b, shot.cct[*k]);
                w * (d.cb.powi(2) + d.cr.powi(2))
            })
            .sum()
    };
    let mut b = *now;
    let mut step = 0.5;
    while step > 0.0005 {
        let mut better = false;
        for k in ["temp", "tint"] {
            for dir in [1.0, -1.0] {
                let mut t = b;
                t.set(k, b.get(k) + dir * step);
                if cost(&t) < cost(&b) - 1e-14 {
                    b = t;
                    better = true;
                }
            }
        }
        if !better {
            step /= 2.0;
        }
    }
    b.set("temp", b.temp + warmth);
    (b, keys.iter().map(|(k, _)| k.to_string()).collect())
}
