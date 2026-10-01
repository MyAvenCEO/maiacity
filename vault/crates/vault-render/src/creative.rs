//! The creative grade's colour maths (story-producer `look.md`), scene-referred (ACEScct in, ACEScct out): the
//! vectorscope's axes on the log, a display hue's direction in ACEScct, curves around the circle. The tools that use it
//! — split tone, hue curves, highlight saturation — are `tools.rs`'s; this is their one place.
//!
//! Hues are the vectorscope's, as the display shows them (the angle of Cb/Cr of the Rec.709 picture through the output
//! transform; the skin line at 123°) — the same angles `look.rs` measures — found for each colour through the output
//! transform and moved in ACEScct.

use crate::{Output, grade::{LUMA, PIVOT}, look::Disp};

/// A point on the circle, from points: cosine-eased between neighbours, around 360°. `d` where there are none.
pub fn around(points: &[[f64; 2]], hue: f64, d: f64) -> f64 {
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
pub fn ycc(p: [f64; 3]) -> (f64, f64, f64) {
    let y = p[0] * LUMA[0] + p[1] * LUMA[1] + p[2] * LUMA[2];
    (y, (p[2] - y) / 1.8556, (p[0] - y) / 1.5748)
}

pub fn rgb(y: f64, cb: f64, cr: f64) -> [f64; 3] {
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

pub fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

