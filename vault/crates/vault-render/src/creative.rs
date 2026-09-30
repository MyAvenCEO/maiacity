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
