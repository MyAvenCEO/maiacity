//! The creative grade, after every shot's balance (story-producer `look.md`): the looks — the film's, and each
//! scene's under it — colour-only, scene-referred (ACEScct in, ACEScct out), so a clip's whole colour chain bakes into
//! one cube the studio's viewer and the render sample alike. The maths lives only here.
//!
//! A look, in the order it applies:
//!   cdl / preset   an ASC CDL of its own, or a preset's
//!   contrast       around a pivot (mid grey by default), in the log
//!   split          toning: a hue added to the shadows and another to the highlights (teal under, warm over)
//!   hue            hue against hue: where a hue moves to, points around the circle (the skin line kept by leaving it out)
//!   hue_sat        saturation against hue
//!   sat            saturation, around luma
//!   lut            a creative .cube from the vault (ACEScct in and out), by its hash
//!   strength       how much of all that, 0…1
//!
//! Hues are the vectorscope's, as the display shows them (the angle of Cb/Cr of the Rec.709 picture through the output
//! transform; the skin line at 123°) — the same angles `look.rs` measures — found for each colour through the output
//! transform and moved in ACEScct.

use serde::{Deserialize, Serialize};

use crate::{
    Lut3d, Output,
    grade::{Cdl, LUMA, PIVOT, clean_cdl, preset},
    look::Disp,
};

/// One side of the split: a hue on the vectorscope and how much of it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Tone {
    /// degrees on the vectorscope (the skin line 123°, teal about 280°)
    #[serde(default)]
    pub hue: f64,
    /// 0…1 (1: a strong tint)
    #[serde(default)]
    pub amount: f64,
}

/// Split toning: the shadows towards one hue, the highlights towards another.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Split {
    #[serde(default)]
    pub shadows: Tone,
    #[serde(default)]
    pub highlights: Tone,
    /// where the two meet, −1 (low) … 1 (high); 0 at the pivot
    #[serde(default)]
    pub balance: f64,
}

fn one() -> f64 {
    1.0
}
fn pivot() -> f64 {
    PIVOT
}

/// A look: the film's or a scene's.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Look {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cdl: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset: Option<String>,
    /// −1…1: the slope around the pivot minus 1
    #[serde(default)]
    pub contrast: f64,
    #[serde(default = "pivot")]
    pub pivot: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split: Option<Split>,
    /// [hue°, shift°] points around the circle
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hue: Vec<[f64; 2]>,
    /// [hue°, saturation factor] points around the circle (1: as it is)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hue_sat: Vec<[f64; 2]>,
    #[serde(default = "one")]
    pub sat: f64,
    /// a creative .cube in the vault (ACEScct in and out), by its hash
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lut: Option<String>,
    #[serde(default = "one")]
    pub strength: f64,
}

impl Default for Look {
    fn default() -> Self {
        Look { cdl: None, preset: None, contrast: 0.0, pivot: PIVOT, split: None, hue: vec![], hue_sat: vec![], sat: 1.0, lut: None, strength: 1.0 }
    }
}

/// A look as data, checked (the API's `cleanLook`): numbers in their ranges; None when it changes nothing.
pub fn clean_look(v: &serde_json::Value) -> Option<Look> {
    let mut l: Look = serde_json::from_value(v.clone()).ok()?;
    let c = |x: f64, lo: f64, hi: f64, d: f64| if x.is_finite() { x.clamp(lo, hi) } else { d };
    l.contrast = c(l.contrast, -1.0, 1.0, 0.0);
    l.pivot = c(l.pivot, 0.0, 1.0, PIVOT);
    l.sat = c(l.sat, 0.0, 3.0, 1.0);
    l.strength = c(l.strength, 0.0, 1.0, 1.0);
    l.cdl = l.cdl.as_ref().and_then(clean_cdl).map(|c| c.to_json());
    l.preset = l.preset.filter(|p| p != "neutral" && preset(p).is_some());
    if let Some(s) = &mut l.split {
        for t in [&mut s.shadows, &mut s.highlights] {
            t.hue = c(t.hue, -720.0, 720.0, 0.0).rem_euclid(360.0);
            t.amount = c(t.amount, 0.0, 1.0, 0.0);
        }
        s.balance = c(s.balance, -1.0, 1.0, 0.0);
        if s.shadows.amount == 0.0 && s.highlights.amount == 0.0 {
            l.split = None;
        }
    }
    let points = |ps: &mut Vec<[f64; 2]>, lo: f64, hi: f64, d: f64| {
        ps.truncate(16);
        for p in ps.iter_mut() {
            p[0] = c(p[0], -720.0, 720.0, 0.0).rem_euclid(360.0);
            p[1] = c(p[1], lo, hi, d);
        }
        ps.sort_by(|a, b| a[0].total_cmp(&b[0]));
    };
    points(&mut l.hue, -90.0, 90.0, 0.0);
    points(&mut l.hue_sat, 0.0, 3.0, 1.0);
    l.lut = l.lut.filter(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()));
    (!l.is_neutral()).then_some(l)
}

impl Look {
    pub fn is_neutral(&self) -> bool {
        self.strength == 0.0
            || (self.cdl.is_none()
                && self.preset.is_none()
                && self.contrast == 0.0
                && self.split.is_none()
                && self.hue.iter().all(|p| p[1] == 0.0)
                && self.hue_sat.iter().all(|p| p[1] == 1.0)
                && self.sat == 1.0
                && self.lut.is_none())
    }

    /// Its CDL: its own, else its preset's.
    pub fn cdl(&self) -> Option<Cdl> {
        self.cdl.as_ref().and_then(clean_cdl).or_else(|| self.preset.as_deref().and_then(preset).filter(|c| !c.is_neutral()))
    }
}

/// A point on the circle, from points: cosine-eased between neighbours, around 360°. `d` where there are none.
fn around(points: &[[f64; 2]], hue: f64, d: f64) -> f64 {
    match points.len() {
        0 => d,
        1 => points[0][1],
        n => {
            let h = hue.rem_euclid(360.0);
            let i = points.iter().position(|p| p[0] > h).unwrap_or(n);
            let (a, b) = (points[(i + n - 1) % n], points[i % n]);
            let (a0, mut b0) = (a[0], b[0]);
            let mut x = h;
            if b0 <= a0 {
                b0 += 360.0;
            }
            if x < a0 {
                x += 360.0;
            }
            let t = ((x - a0) / (b0 - a0).max(1e-9)).clamp(0.0, 1.0);
            let t = (1.0 - (std::f64::consts::PI * t).cos()) / 2.0;
            a[1] + (b[1] - a[1]) * t
        }
    }
}

/// Luma and the chroma plane of an ACEScct pixel (the vectorscope's axes, on the log values).
fn ycc(p: [f64; 3]) -> (f64, f64, f64) {
    let y = p[0] * LUMA[0] + p[1] * LUMA[1] + p[2] * LUMA[2];
    (y, (p[2] - y) / 1.8556, (p[0] - y) / 1.5748)
}

fn rgb(y: f64, cb: f64, cr: f64) -> [f64; 3] {
    let r = y + 1.5748 * cr;
    let b = y + 1.8556 * cb;
    [r, (y - LUMA[0] * r - LUMA[2] * b) / LUMA[1], b]
}

/// Where a display hue lies in ACEScct's chroma plane: for each degree on the vectorscope, the direction to move a
/// grey at the pivot in, found through the output transform.
pub struct Hues {
    dir: Vec<(f64, f64)>,
}

impl Hues {
    pub fn new(output: &dyn Output) -> Hues {
        // the display hue of a small step from grey in each of 720 directions; each degree then takes the nearest
        let steps: Vec<(f64, (f64, f64))> = (0..720)
            .map(|i| {
                let a = (i as f64 / 2.0).to_radians();
                let (cb, cr) = (a.cos() * 0.02, a.sin() * 0.02);
                (Disp::of(output.apply(rgb(PIVOT, cb, cr))).hue(), (a.cos(), a.sin()))
            })
            .collect();
        let dist = |a: f64, b: f64| ((a - b + 540.0).rem_euclid(360.0) - 180.0).abs();
        let dir = (0..360)
            .map(|deg| steps.iter().min_by(|x, y| dist(x.0, deg as f64).total_cmp(&dist(y.0, deg as f64))).unwrap().1)
            .collect();
        Hues { dir }
    }

    /// The ACEScct chroma direction of a display hue.
    pub fn of(&self, hue: f64) -> (f64, f64) {
        self.dir[(hue.rem_euclid(360.0).round() as usize) % 360]
    }
}

fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// A look ready to apply: its CDL resolved, its LUT loaded, the display hues found.
pub struct Ready<'a> {
    look: &'a Look,
    cdl: Option<Cdl>,
    lut: Option<Lut3d>,
}

impl<'a> Ready<'a> {
    /// `lut`: the look's creative LUT, loaded by the caller from the vault (by `look.lut`).
    pub fn new(look: &'a Look, lut: Option<Lut3d>) -> Self {
        Ready { look, cdl: look.cdl(), lut }
    }

    /// One ACEScct pixel through the look.
    pub fn apply(&self, x: [f64; 3], hues: &Hues, output: &dyn Output) -> [f64; 3] {
        let l = self.look;
        let mut p = x;
        if let Some(c) = &self.cdl {
            p = c.apply(p);
        }
        if l.contrast != 0.0 {
            let k = 1.0 + l.contrast;
            p = p.map(|v| l.pivot + (v - l.pivot) * k);
        }
        if let Some(s) = &l.split {
            let (y, mut cb, mut cr) = ycc(p);
            // the shadows fade out above the meeting point, the highlights in; 0.05 of chroma is a strong tint
            let at = l.pivot + s.balance * 0.2;
            let lo = 1.0 - smooth(at - 0.25, at + 0.05, y);
            let hi = smooth(at - 0.05, at + 0.3, y);
            for (t, w) in [(s.shadows, lo), (s.highlights, hi)] {
                if t.amount > 0.0 && w > 0.0 {
                    let (dx, dy) = hues.of(t.hue);
                    cb += dx * t.amount * 0.05 * w;
                    cr += dy * t.amount * 0.05 * w;
                }
            }
            p = rgb(y, cb, cr);
        }
        if !l.hue.is_empty() || !l.hue_sat.is_empty() || l.sat != 1.0 {
            let d = Disp::of(output.apply(p));
            // near grey a hue means little: the curves fade in with the colour
            let w = smooth(0.004, 0.03, d.chroma());
            let (y, cb, cr) = ycc(p);
            let shift = around(&l.hue, d.hue(), 0.0) * w;
            let k = (1.0 + (around(&l.hue_sat, d.hue(), 1.0) - 1.0) * w) * l.sat;
            let (s, c) = shift.to_radians().sin_cos();
            let (cb, cr) = ((cb * c - cr * s) * k, (cb * s + cr * c) * k);
            p = rgb(y, cb, cr);
        }
        if let Some(lut) = &self.lut {
            p = lut.sample(p);
        }
        if l.strength < 1.0 {
            p = std::array::from_fn(|i| x[i] + (p[i] - x[i]) * l.strength);
        }
        p
    }
}

/// A clip's colour chain as one cube over ACEScct (`size`³ RGB, red fastest): its balance, its own grades in order,
/// then its looks in order (its scene's, the film's) — what the studio's viewer samples and the render applies.
pub fn bake(balance: Option<&crate::grade::Balance>, grades: &[Cdl], looks: &[Ready], output: &dyn Output, size: usize) -> Vec<f32> {
    let hues = Hues::new(output);
    let n = size.max(2);
    let at = |i: usize| i as f64 / (n - 1) as f64;
    let mut out = Vec::with_capacity(n * n * n * 3);
    for b in 0..n {
        for g in 0..n {
            for r in 0..n {
                let mut px = [at(r), at(g), at(b)];
                if let Some(bal) = balance {
                    px = bal.apply(px);
                }
                for c in grades {
                    px = c.apply(px);
                }
                for l in looks {
                    px = l.apply(px, &hues, output);
                }
                out.extend(px.map(|v| v as f32));
            }
        }
    }
    out
}

// ── secondaries: a part of one shot, given its own balance ───────────────────────────────────────────────────────

/// A key: the colours a secondary takes, as the display shows them (the same units `look.rs` measures).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Key {
    /// [centre°, width°] on the vectorscope (the skin line 123°)
    pub hue: [f64; 2],
    /// [low, high] chroma × 100 (as `look.rs` reports it)
    #[serde(default = "sat_all")]
    pub sat: [f64; 2],
    /// [low, high] IRE
    #[serde(default = "luma_all")]
    pub luma: [f64; 2],
    /// 0…1: how soft its edges are
    #[serde(default = "half_soft")]
    pub soft: f64,
}
fn sat_all() -> [f64; 2] {
    [1.0, 100.0]
}
fn luma_all() -> [f64; 2] {
    [0.0, 100.0]
}
fn half_soft() -> f64 {
    0.5
}

/// A window: a shape on the frame (0…1 from the top left), turned and feathered; `track: "face"` follows the face
/// Vision finds in each frame (its size then a multiple of the face's).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Window {
    /// "ellipse" or "rect"
    #[serde(default = "ellipse")]
    pub shape: String,
    #[serde(default = "mid")]
    pub x: f64,
    #[serde(default = "mid")]
    pub y: f64,
    /// width and height, as parts of the frame's (or, tracking a face, of the face's)
    #[serde(default = "mid")]
    pub w: f64,
    #[serde(default = "mid")]
    pub h: f64,
    /// degrees
    #[serde(default)]
    pub angle: f64,
    /// 0…1
    #[serde(default = "mid")]
    pub feather: f64,
    #[serde(default)]
    pub invert: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track: Option<String>,
}
fn ellipse() -> String {
    "ellipse".into()
}
fn mid() -> f64 {
    0.5
}

/// A secondary: its key inside its window (either alone), given its own balance (`adjust`: temp, tint, exposure,
/// contrast, highlights, shadows, sat) by `mix`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Secondary {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<Key>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<Window>,
    #[serde(default)]
    pub adjust: crate::grade::Balance,
    #[serde(default = "one")]
    pub mix: f64,
}

/// A shot's secondaries as data, checked: at most 4, numbers in their ranges; those that change nothing left out.
pub fn clean_secondaries(v: &serde_json::Value) -> Vec<Secondary> {
    let Some(list) = v.as_array() else { return vec![] };
    let c = |x: f64, lo: f64, hi: f64, d: f64| if x.is_finite() { x.clamp(lo, hi) } else { d };
    list.iter()
        .take(4)
        .filter_map(|s| serde_json::from_value::<Secondary>(s.clone()).ok())
        .filter_map(|mut s| {
            s.adjust = s.adjust_clean()?;
            s.mix = c(s.mix, 0.0, 1.0, 1.0);
            if let Some(k) = &mut s.key {
                k.hue = [c(k.hue[0], -720.0, 720.0, 0.0).rem_euclid(360.0), c(k.hue[1], 1.0, 360.0, 40.0)];
                k.sat = [c(k.sat[0], 0.0, 100.0, 1.0), c(k.sat[1], 0.0, 100.0, 100.0)];
                k.luma = [c(k.luma[0], 0.0, 100.0, 0.0), c(k.luma[1], 0.0, 100.0, 100.0)];
                k.soft = c(k.soft, 0.0, 1.0, 0.5);
            }
            if let Some(w) = &mut s.window {
                w.shape = if w.shape == "rect" { "rect".into() } else { "ellipse".into() };
                (w.x, w.y) = (c(w.x, -1.0, 2.0, 0.5), c(w.y, -1.0, 2.0, 0.5));
                (w.w, w.h) = (c(w.w, 0.01, 4.0, 0.5), c(w.h, 0.01, 4.0, 0.5));
                w.angle = c(w.angle, -360.0, 360.0, 0.0);
                w.feather = c(w.feather, 0.0, 1.0, 0.5);
                w.track = w.track.take().filter(|t| t == "face");
            }
            (s.mix > 0.0).then_some(s)
        })
        .collect()
}

impl Secondary {
    /// Its adjustment, checked; None when it changes nothing.
    fn adjust_clean(&self) -> Option<crate::grade::Balance> {
        crate::grade::clean_balance(&serde_json::to_value(self.adjust).ok()?)
    }
}

// ── finishing: the film's texture, after its looks ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Pop {
    /// −1…1: local contrast (negative softens)
    pub amount: f64,
    /// pixels at 1080 lines
    #[serde(default = "pop_radius")]
    pub radius: f64,
}
fn pop_radius() -> f64 {
    18.0
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Glow {
    /// 0…1
    pub amount: f64,
    /// ACEScct: the light above it glows (0.55 is about 1.3 stops over mid grey)
    #[serde(default = "glow_threshold")]
    pub threshold: f64,
    /// pixels at 1080 lines
    #[serde(default = "glow_radius")]
    pub radius: f64,
}
fn glow_threshold() -> f64 {
    0.55
}
fn glow_radius() -> f64 {
    14.0
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Grain {
    /// 0…1 (0.25 is felt rather than seen)
    pub amount: f64,
    /// its size in pixels at 1080 lines
    #[serde(default = "one")]
    pub size: f64,
    /// 0 luma only … 1 colour grain
    #[serde(default)]
    pub chroma: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Vignette {
    /// 0…1 (1: 1.5 stops at the corners)
    pub amount: f64,
    /// where it begins: 1 the frame's edge
    #[serde(default = "vig_size")]
    pub size: f64,
    #[serde(default = "mid")]
    pub softness: f64,
    /// 0 the frame's own shape … 1 a circle
    #[serde(default)]
    pub roundness: f64,
}
fn vig_size() -> f64 {
    0.9
}

/// The film's finishing, after its looks and before the output transform: contrast pop, halation, bloom, grain,
/// vignette — each subtle ("a kiss", Cullen Kelly).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Finish {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pop: Option<Pop>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub halation: Option<Glow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bloom: Option<Glow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grain: Option<Grain>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vignette: Option<Vignette>,
}

/// The finishing as data, checked; None when it adds nothing.
pub fn clean_finish(v: &serde_json::Value) -> Option<Finish> {
    let mut f: Finish = serde_json::from_value(v.clone()).ok()?;
    let c = |x: f64, lo: f64, hi: f64, d: f64| if x.is_finite() { x.clamp(lo, hi) } else { d };
    f.pop = f.pop.map(|p| Pop { amount: c(p.amount, -1.0, 1.0, 0.0), radius: c(p.radius, 2.0, 80.0, 18.0) }).filter(|p| p.amount != 0.0);
    let glow = |g: Glow| Glow { amount: c(g.amount, 0.0, 1.0, 0.0), threshold: c(g.threshold, 0.3, 1.2, 0.55), radius: c(g.radius, 1.0, 120.0, 14.0) };
    f.halation = f.halation.map(glow).filter(|g| g.amount > 0.0);
    f.bloom = f.bloom.map(glow).filter(|g| g.amount > 0.0);
    f.grain = f.grain.map(|g| Grain { amount: c(g.amount, 0.0, 1.0, 0.0), size: c(g.size, 0.5, 4.0, 1.0), chroma: c(g.chroma, 0.0, 1.0, 0.0) }).filter(|g| g.amount > 0.0);
    f.vignette = f
        .vignette
        .map(|v| Vignette { amount: c(v.amount, 0.0, 1.0, 0.0), size: c(v.size, 0.2, 2.0, 0.9), softness: c(v.softness, 0.0, 1.0, 0.5), roundness: c(v.roundness, 0.0, 1.0, 0.0) })
        .filter(|v| v.amount > 0.0);
    (f != Finish::default()).then_some(f)
}

// ── on the GPU ───────────────────────────────────────────────────────────────────────────────────────────────────

/// A shot's secondaries on its balanced picture (ACEScct, `w`×`h`): each a mask (its key read on the display picture,
/// its window placed, or on the face given) blending in the picture under its own balance.
pub fn apply_secondaries(gpu: &crate::gpu::Gpu, img: &crate::gpu::Image, secs: &[Secondary], face: Option<crate::look::Rect>, w: f64, h: f64) -> anyhow::Result<crate::gpu::Image> {
    if secs.is_empty() {
        return Ok(img.clone());
    }
    let disp = gpu.output(img)?;
    let mut cur = img.clone();
    for s in secs {
        let (win, shape) = match &s.window {
            None => ([0.0; 4], [0.0; 4]),
            Some(wd) => {
                // centre and half size in pixels, Core Image's y from the bottom
                let (cx, cy, hw, hh) = match (&wd.track, face) {
                    (Some(_), Some(f)) => {
                        let (fw, fh) = ((f[2] - f[0]) * w, (f[3] - f[1]) * h);
                        (((f[0] + f[2]) / 2.0 + (wd.x - 0.5) * (f[2] - f[0])) * w, (1.0 - ((f[1] + f[3]) / 2.0 + (wd.y - 0.5) * (f[3] - f[1]))) * h, fw * wd.w, fh * wd.h)
                    }
                    _ => (wd.x * w, (1.0 - wd.y) * h, wd.w * w / 2.0, wd.h * h / 2.0),
                };
                ([cx, cy, hw, hh], [wd.angle.to_radians(), wd.feather, if wd.shape == "rect" { 2.0 } else { 1.0 }, if wd.invert { 1.0 } else { 0.0 }])
            }
        };
        let (key, keyb) = match &s.key {
            None => ([0.0; 4], [0.0; 4]),
            Some(k) => ([k.hue[0].to_radians(), (k.hue[1] / 2.0).to_radians(), k.sat[0] / 100.0, k.sat[1] / 100.0], [k.luma[0] / 100.0, k.luma[1] / 100.0, k.soft, 1.0]),
        };
        let mask = gpu.mask(&disp, win, shape, key, keyb)?;
        let adjusted = gpu.balance(&cur, Some(&s.adjust))?;
        cur = gpu.blend(&cur, &adjusted, &mask, s.mix)?;
    }
    Ok(cur)
}

/// The film's finishing on a picture after its looks (ACEScct, `h` lines high), frame `frame` of the film (the
/// grain's seed): pop, then halation and bloom in linear light, then grain, then the vignette.
pub fn apply_finish(gpu: &crate::gpu::Gpu, img: &crate::gpu::Image, f: &Finish, frame: u64, h: f64) -> anyhow::Result<crate::gpu::Image> {
    let k = h / 1080.0;
    let mut cur = img.clone();
    if let Some(p) = &f.pop {
        cur = gpu.pop(&cur, p.radius * k, p.amount * 1.5)?;
    }
    if f.halation.is_some() || f.bloom.is_some() {
        let lin_of = |c: f64| if c <= 0.155251141552511 { (c - 0.0729055341958355) / 10.5402377416545 } else { 2f64.powf(c * 17.52 - 9.72) };
        let mut lin = gpu.to_linear(&cur)?;
        if let Some(g) = &f.halation {
            // red spreads widest, green less, blue hardly: film's halation
            lin = gpu.glow(&lin, lin_of(g.threshold), g.radius * k, [1.0, 0.28, 0.06], g.amount * 0.6)?;
        }
        if let Some(g) = &f.bloom {
            lin = gpu.glow(&lin, lin_of(g.threshold), g.radius * k, [1.0, 0.97, 0.92], g.amount * 0.4)?;
        }
        cur = gpu.to_cct(&lin)?;
    }
    if let Some(g) = &f.grain {
        cur = gpu.grain(&cur, g.amount, g.size * k, (frame % 997) as f64 * 1.618 + 0.5, g.chroma)?;
    }
    if let Some(v) = &f.vignette {
        cur = gpu.vignette(&cur, v.amount, v.size, v.softness, v.roundness)?;
    }
    Ok(cur)
}
