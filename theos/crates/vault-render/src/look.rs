//! A shot as a colourist reads it for the base correction (colorist `base-correction.md`): the elements that must not
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

/// A picture's tone in three zones (display code values), as a look is compared: the shadows (the lowest 15 % by
/// luma), the middle (40–60 %), the highlights (85–99 %) — each its level, its cast (warm = R − B, green = G − (R + B)/2
/// in IRE), its hue and chroma on the vectorscope — and where its colour lies: the share of its coloured pixels (chroma
/// over 0.04) that are warm (60–180°: red, orange, skin, yellow), green (180–260°) or teal and blue (260–360°, 0–60°).
pub fn zones(px: &[[f32; 3]]) -> Value {
    let r1 = |x: f64| (x * 10.0).round() / 10.0;
    let mut h = Hist::new();
    for p in px {
        h.add(Disp::of([p[0] as f64, p[1] as f64, p[2] as f64]).y);
    }
    // the bounds are bins' centres: a bin's width either side keeps the pixels on them
    let bin = Hist::SPAN / Hist::N as f64;
    let bands = [("shadows", f64::NEG_INFINITY, h.q(0.15) + bin), ("mids", h.q(0.40) - bin, h.q(0.60) + bin), ("highlights", h.q(0.85) - bin, h.q(0.99) + bin)];
    let mut sums = [([0f64; 3], 0usize); 3];
    let (mut warm, mut green, mut teal, mut coloured) = (0usize, 0usize, 0usize, 0usize);
    for p in px {
        let v = [p[0] as f64, p[1] as f64, p[2] as f64];
        let d = Disp::of(v);
        for (i, (_, lo, hi)) in bands.iter().enumerate() {
            if d.y >= *lo && d.y <= *hi {
                (0..3).for_each(|k| sums[i].0[k] += v[k]);
                sums[i].1 += 1;
            }
        }
        if d.chroma() > 0.04 {
            coloured += 1;
            match d.hue() {
                x if (60.0..180.0).contains(&x) => warm += 1,
                x if (180.0..260.0).contains(&x) => green += 1,
                _ => teal += 1,
            }
        }
    }
    let mut out = json!({});
    for (i, (name, ..)) in bands.iter().enumerate() {
        let (s, n) = sums[i];
        if n == 0 {
            continue;
        }
        let m = s.map(|x| x / n as f64);
        let d = Disp::of(m);
        out[*name] = json!({ "ire": r1(d.y * 100.0), "warm": r1((m[0] - m[2]) * 100.0), "green": r1((m[1] - (m[0] + m[2]) / 2.0) * 100.0), "hue": r1(d.hue()), "chroma": r1(d.chroma() * 100.0) });
    }
    let pct = |k: usize| r1(k as f64 / coloured.max(1) as f64 * 100.0);
    out["colour"] = json!({ "coloured_pct": r1(coloured as f64 / px.len().max(1) as f64 * 100.0), "warm_pct": pct(warm), "green_pct": pct(green), "teal_blue_pct": pct(teal) });
    out
}

/// A reference picture (a still of the look to get close to: display code values, as it is shown) read as a look is:
/// its levels, its zones and colour, its saturation, and the skin of the face Vision finds.
pub fn reference(src: vault_media::Source) -> Result<Value> {
    let gpu = Gpu::new()?;
    let img = gpu.still(src)?;
    let e = crate::gpu::Extent::ext(&*img);
    let w = 1280u32.min(e.size.width as u32).max(2);
    let h = ((w as f64 * e.size.height / e.size.width.max(1.0)).round() as u32).max(2);
    let small = gpu.frame_to(&img, w, h, None)?;
    let found = faces(&small);
    let skin = found.first().map(skin_patch);
    let px = rgb(&gpu, &small, w, h);
    let flags = classify(&px, w as usize, h as usize, skin.as_ref(), &Regions::default());
    let mut out = elements(&px, &flags);
    out["faces"] = json!(found.len());
    Ok(out)
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
        "zones": zones(px),
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

/// Read one shot: its elements as shot and after its balance (with `looks`, after its grade and looks as well: the
/// whole chain, as the film will show it), in the timeline's shape at its full render size (4K for 16:9), from the
/// real thing. `balance` overrides the clip's own (a proposal checked before it is written).
pub fn look(t: &Timeline, lib: &dyn Library, c: &Clip, output: &dyn Output, regions: &Regions, balance: Option<&Balance>, looks: bool) -> Result<Look> {
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
    // its base correction: a balance given (a proposal) in its place, else its own
    let base = match balance {
        Some(b) => crate::tools::Stack { strength: 1.0, tools: vec![crate::tools::Item { on: true, tool: crate::tools::Tool::Balance(*b) }] },
        None => c.stack("base").unwrap_or_default(),
    };
    let base_json = serde_json::to_value(&base)?;
    // the base correction's balance (its first balance tool): what grade_match fits and writes
    let bal = base.tools.iter().find_map(|i| if let crate::tools::Tool::Balance(b) = &i.tool { Some(*b) } else { None }).unwrap_or_default();
    let stacks: Vec<crate::tools::Stack> = if looks {
        // the whole chain, as the film shows it, with that base correction
        let mut all = t.stacks_for(c);
        if c.stack("base").is_some() && !all.is_empty() {
            all.remove(0);
        }
        std::iter::once(base).chain(all).collect()
    } else {
        vec![base]
    };
    let grade = crate::render::on_gpu(&gpu, crate::render::stacks_steps(&stacks, lib, output)?);
    let chain = crate::render::chain(&gpu, &framed, w, h, &grade.0, &grade.1, 0)?;
    let after = gpu.output(&chain)?;
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
        "through": if looks { "its stacks: base, clip, scene and timeline" } else { "balance" },
        "balance": bal,
        "base": base_json,
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

/// The balance that levels a shot to `want` by the elements both have, less `skip` — an element (`skin`), or only
/// its level (`skin.level`: a face and feet in one light need not be as bright) or only its colour (`whites.colour`:
/// a cream rug is not a white wall). The balance nodes only, from as shot, white balance and exposure in linear light.
/// White balance and exposure do the levelling; contrast, highlights, lows and saturation cost, so they move only where
/// those cannot.
pub fn fit(shot: &Look, want: &BTreeMap<String, Disp>, output: &dyn Output, skip: &[String]) -> (Balance, Vec<String>) {
    let none = Balance::default();
    let skipped = |k: &str, part: &str| skip.iter().any(|s| s == k || *s == format!("{k}.{part}"));
    let pairs: Vec<(String, [f64; 3], Disp, f64, f64)> = shot
        .cct
        .iter()
        .filter(|(k, _)| weights(k) != (0.0, 0.0))
        .filter_map(|(k, v)| want.get(k).map(|w| (k.clone(), *v, *w)))
        .filter(|(k, v, w)| usable(k, &shown(output, &none, *v)) && usable(k, w))
        .map(|(k, v, w)| {
            let (wl, wc) = weights(&k);
            let (wl, wc) = (if skipped(&k, "level") { 0.0 } else { wl }, if skipped(&k, "colour") { 0.0 } else { wc });
            (k, v, w, wl, wc)
        })
        .filter(|p| p.3 > 0.0 || p.4 > 0.0)
        .collect();
    let used: Vec<String> = pairs
        .iter()
        .map(|p| match (p.3 > 0.0, p.4 > 0.0) {
            (true, true) => p.0.clone(),
            (true, false) => format!("{}.level", p.0),
            _ => format!("{}.colour", p.0),
        })
        .collect();
    let cost = |b: &Balance| -> f64 {
        let fit: f64 = pairs
            .iter()
            .map(|(_, v, w, wl, wc)| {
                let d = shown(output, b, *v);
                wl * (d.y - w.y).powi(2) + wc * ((d.cb - w.cb).powi(2) + (d.cr - w.cr).powi(2))
            })
            .sum();
        // a base correction is white balance and exposure: a stop of highlights or lows costs about what 5 IRE off in
        // the skin does, contrast and saturation more — they move only for what the two cannot do
        fit + 0.003 * (b.highlights.powi(2) + b.shadows.powi(2)) + 0.03 * b.contrast.powi(2) + 0.03 * b.sat.powi(2)
    };
    let mut b = Balance { linear: true, ..Balance::default() };
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

// ── the scopes ──────────────────────────────────────────────────────────────────────────────────────────────────

const PIC: (u32, u32) = (640, 360);
const SCOPE_H: u32 = 360;
const WAVE_W: u32 = 480;
const VEC: u32 = 360;
const GAP: u32 = 8;
const LABEL: u32 = 26;
/// the scopes' vertical range: a little below 0 and above 100 IRE
const LO: f64 = -0.04;
const HI: f64 = 1.06;

struct Canvas {
    w: u32,
    h: u32,
    px: Vec<[f32; 3]>,
}

impl Canvas {
    fn new(w: u32, h: u32) -> Canvas {
        Canvas { w, h, px: vec![[0.07; 3]; (w * h) as usize] }
    }
    fn set(&mut self, x: i64, y: i64, c: [f32; 3]) {
        if x >= 0 && y >= 0 && (x as u32) < self.w && (y as u32) < self.h {
            self.px[(y as u32 * self.w + x as u32) as usize] = c;
        }
    }
    fn fill(&mut self, x0: u32, y0: u32, w: u32, h: u32, c: [f32; 3]) {
        for y in y0..y0 + h {
            for x in x0..x0 + w {
                self.set(x as i64, y as i64, c);
            }
        }
    }
    fn line(&mut self, a: (f64, f64), b: (f64, f64), c: [f32; 3]) {
        let n = ((b.0 - a.0).abs().max((b.1 - a.1).abs()).ceil() as usize).max(1);
        for i in 0..=n {
            let t = i as f64 / n as f64;
            self.set((a.0 + (b.0 - a.0) * t).round() as i64, (a.1 + (b.1 - a.1) * t).round() as i64, c);
        }
    }
    fn rect(&mut self, x0: f64, y0: f64, x1: f64, y1: f64, c: [f32; 3]) {
        for d in 0..2 {
            let d = d as f64;
            self.line((x0 - d, y0 - d), (x1 + d, y0 - d), c);
            self.line((x0 - d, y1 + d), (x1 + d, y1 + d), c);
            self.line((x0 - d, y0 - d), (x0 - d, y1 + d), c);
            self.line((x1 + d, y0 - d), (x1 + d, y1 + d), c);
        }
    }
}

/// A density to a brightness: log, so a few pixels still show.
fn glow(n: f64, max: f64) -> f32 {
    ((1.0 + n).ln() / (1.0 + max).ln()).clamp(0.0, 1.0) as f32
}

fn level_y(v: f64) -> f64 {
    (1.0 - (v - LO) / (HI - LO)) * (SCOPE_H - 1) as f64
}

/// One row of the sheet: the picture with its boxes, the waveform, the RGB parade, the vectorscope.
fn row(cv: &mut Canvas, top: u32, look: &Look) {
    let (sw, sh) = look.picture_size;
    let px = &look.picture;
    let y0 = top + LABEL;
    // the picture
    let (pw, ph) = PIC;
    for y in 0..ph {
        for x in 0..pw {
            let (sx, sy) = ((x * sw / pw).min(sw - 1), (y * sh / ph).min(sh - 1));
            let p = px[(sy * sw + sx) as usize];
            cv.set(x as i64, (y0 + y) as i64, p.map(|v| v.clamp(0.0, 1.0)));
        }
    }
    for (what, r) in &look.boxes {
        let c = match what.as_str() {
            "skin" => [1.0, 0.2, 1.0],
            "white" => [0.2, 1.0, 1.0],
            "grey" => [1.0, 1.0, 0.2],
            _ => [0.3, 0.5, 1.0],
        };
        cv.rect(r[0] * pw as f64, y0 as f64 + r[1] * ph as f64, r[2] * pw as f64, y0 as f64 + r[3] * ph as f64, c);
    }
    // waveform and parade
    let x_wave = pw + GAP;
    let x_par = x_wave + WAVE_W + GAP;
    let mut wave = vec![0f64; (WAVE_W * SCOPE_H) as usize];
    let mut par = vec![[0f64; 3]; (WAVE_W * SCOPE_H) as usize];
    let third = WAVE_W / 3;
    for y in 0..sh {
        for x in 0..sw {
            let p = px[(y * sw + x) as usize];
            let v = [p[0] as f64, p[1] as f64, p[2] as f64];
            let col = (x * WAVE_W / sw).min(WAVE_W - 1);
            let l = Disp::of(v).y;
            let r = (level_y(l).round() as i64).clamp(0, SCOPE_H as i64 - 1) as u32;
            wave[(r * WAVE_W + col) as usize] += 1.0;
            for c in 0..3 {
                let pc = (c as u32 * third + x * third / sw).min(WAVE_W - 1);
                let r = (level_y(v[c]).round() as i64).clamp(0, SCOPE_H as i64 - 1) as u32;
                par[(r * WAVE_W + pc) as usize][c] += 1.0;
            }
        }
    }
    let wmax = wave.iter().cloned().fold(1.0, f64::max);
    let pmax = par.iter().flat_map(|p| p.iter().cloned()).fold(1.0, f64::max);
    cv.fill(x_wave, y0, WAVE_W, SCOPE_H, [0.0; 3]);
    cv.fill(x_par, y0, WAVE_W, SCOPE_H, [0.0; 3]);
    for ire in [0.0, 0.1, 0.5, 0.9, 1.0] {
        let yy = y0 as f64 + level_y(ire);
        let c = if ire == 0.5 { [0.28, 0.28, 0.28] } else { [0.2, 0.2, 0.2] };
        cv.line((x_wave as f64, yy), ((x_wave + WAVE_W - 1) as f64, yy), c);
        cv.line((x_par as f64, yy), ((x_par + WAVE_W - 1) as f64, yy), c);
    }
    for r in 0..SCOPE_H {
        for x in 0..WAVE_W {
            let n = wave[(r * WAVE_W + x) as usize];
            if n > 0.0 {
                let g = glow(n, wmax);
                cv.set((x_wave + x) as i64, (y0 + r) as i64, [0.45 * g + 0.1, g, 0.45 * g + 0.1]);
            }
            let p = par[(r * WAVE_W + x) as usize];
            let c = (x / third).min(2) as usize;
            if p[c] > 0.0 {
                let g = glow(p[c], pmax);
                let mut col = [0.08 * g; 3];
                col[c] = g;
                cv.set((x_par + x) as i64, (y0 + r) as i64, col);
            }
        }
    }
    // the vectorscope: Cb across, Cr up; its edge is chroma 0.25; each spot in the colour of its pixels
    let x_vec = x_par + WAVE_W + GAP;
    let half = VEC as f64 / 2.0;
    let scale = half / 0.25;
    let mut bins = vec![(0f64, [0f64; 3]); (VEC * VEC) as usize];
    for p in px {
        let v = [p[0] as f64, p[1] as f64, p[2] as f64];
        let d = Disp::of(v);
        let (bx, by) = ((half + d.cb * scale).round() as i64, (half - d.cr * scale).round() as i64);
        if bx >= 0 && by >= 0 && (bx as u32) < VEC && (by as u32) < VEC {
            let b = &mut bins[(by as u32 * VEC + bx as u32) as usize];
            b.0 += 1.0;
            (0..3).for_each(|i| b.1[i] += v[i].clamp(0.0, 1.0));
        }
    }
    let vmax = bins.iter().map(|b| b.0).fold(1.0, f64::max);
    cv.fill(x_vec, y0, VEC, VEC, [0.0; 3]);
    let (cx, cy) = (x_vec as f64 + half, y0 as f64 + half);
    for ring in [0.1, 0.2] {
        let r = ring * scale;
        for i in 0..720 {
            let a = (i as f64 / 2.0).to_radians();
            cv.set((cx + r * a.cos()).round() as i64, (cy - r * a.sin()).round() as i64, [0.22; 3]);
        }
    }
    cv.line((cx - half, cy), (cx + half, cy), [0.16; 3]);
    cv.line((cx, cy - half), (cx, cy + half), [0.16; 3]);
    for (i, b) in bins.iter().enumerate() {
        if b.0 > 0.0 {
            let g = glow(b.0, vmax);
            let mean = b.1.map(|v| v / b.0);
            let m = mean.iter().cloned().fold(1e-6, f64::max);
            let col = mean.map(|v| (0.35 + 0.65 * v / m) as f32 * g);
            cv.set((x_vec + i as u32 % VEC) as i64, (y0 + i as u32 / VEC) as i64, col);
        }
    }
    let a = SKIN_LINE.to_radians();
    cv.line((cx, cy), (cx + half * a.cos(), cy - half * a.sin()), [1.0, 0.62, 0.4]);
}

/// The scope sheet: one row per shot (the first is the reference), each its picture after the balance, its waveform,
/// RGB parade and vectorscope with the skin line (rings at chroma 0.1 and 0.2), and a label above. RGB 8-bit.
pub fn scopes(looks: &[(&Look, String)]) -> Result<(Vec<u8>, u32, u32)> {
    let w = PIC.0 + GAP + WAVE_W + GAP + WAVE_W + GAP + VEC;
    let row_h = LABEL + SCOPE_H + GAP;
    let h = row_h * looks.len().max(1) as u32;
    let mut cv = Canvas::new(w, h);
    for (i, (look, _)) in looks.iter().enumerate() {
        row(&mut cv, i as u32 * row_h, look);
    }
    let mut out: Vec<u8> = cv.px.iter().flat_map(|p| p.map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8)).collect();
    for (i, (_, label)) in looks.iter().enumerate() {
        crate::captions::label(&mut out, w, i as u32 * row_h, LABEL, label)?;
    }
    Ok((out, w, h))
}
