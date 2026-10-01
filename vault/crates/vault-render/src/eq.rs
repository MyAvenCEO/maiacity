//! A sound clip's EQ, its spectrum, and an EQ that matches one sound's tone to another's.
//!
//! The EQ is a list of bands, each one biquad from the Audio EQ Cookbook (R. Bristow-Johnson): exactly the filters of
//! Web Audio's BiquadFilterNode, so the studio plays what the render mixes (game/film/sound.js holds the schema, the
//! studio makes the same filters from it). `q` is always the plain quality factor; Web Audio reads the high- and
//! low-pass's as dB (the studio converts), and its shelves have a slope of 1 (their `q` is not used).
//!
//! The spectrum is octave bands: each band's share of the sound's energy (dB against the whole), where it speaks
//! (100 ms blocks within 20 dB of its loud ones) — so a pause's room tone does not count. Two sounds' spectra side by
//! side say what an EQ has to do to make one sound like the other: `matching` builds that EQ.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// At most this many bands per clip.
pub const MAX_BANDS: usize = 8;

/// The octave bands the spectrum is read in (their centres, Hz).
pub const OCTAVES: [f64; 9] = [63.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Highpass,
    Lowshelf,
    Peaking,
    Notch,
    Highshelf,
    Lowpass,
}

impl Kind {
    fn of(s: &str) -> Option<Self> {
        Some(match s {
            "highpass" => Self::Highpass,
            "lowshelf" => Self::Lowshelf,
            "peaking" => Self::Peaking,
            "notch" => Self::Notch,
            "highshelf" => Self::Highshelf,
            "lowpass" => Self::Lowpass,
            _ => return None,
        })
    }
}

/// One band: its kind, frequency (Hz), gain (dB, shelves and peaks) and quality factor.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Band {
    #[serde(rename = "type")]
    pub kind: Kind,
    pub f: f64,
    #[serde(default)]
    pub gain: f64,
    #[serde(default = "default_q")]
    pub q: f64,
}

fn default_q() -> f64 {
    std::f64::consts::FRAC_1_SQRT_2
}

/// A clip's EQ as stored, checked as game/film/sound.js checks it: known kinds, 20 Hz – 20 kHz, ±24 dB, q 0.1–18, at
/// most `MAX_BANDS`; bands that change nothing (a peak or shelf at 0 dB) dropped.
pub fn clean_eq(v: &Value) -> Vec<Band> {
    let num = |x: &Value, lo: f64, hi: f64, d: f64| x.as_f64().filter(|v| v.is_finite()).map(|v| v.clamp(lo, hi)).unwrap_or(d);
    v.as_array()
        .into_iter()
        .flatten()
        .filter_map(|b| {
            let kind = Kind::of(b.get("type")?.as_str()?)?;
            let f = b.get("f")?.as_f64().filter(|v| v.is_finite())?.clamp(20.0, 20000.0);
            let gain = num(b.get("gain").unwrap_or(&Value::Null), -24.0, 24.0, 0.0);
            let q = num(b.get("q").unwrap_or(&Value::Null), 0.1, 18.0, if kind == Kind::Peaking || kind == Kind::Notch { 1.0 } else { default_q() });
            let band = Band { kind, f, gain: (gain * 100.0).round() / 100.0, q: (q * 1000.0).round() / 1000.0 };
            (!matches!(kind, Kind::Peaking | Kind::Lowshelf | Kind::Highshelf) || band.gain != 0.0).then_some(band)
        })
        .take(MAX_BANDS)
        .collect()
}

/// One biquad, its coefficients normalised by a0, its state per channel (transposed direct form II).
#[derive(Debug, Clone)]
pub struct Biquad {
    b: [f64; 3],
    a: [f64; 2],
    z: [[f64; 2]; 2],
}

impl Biquad {
    /// The cookbook's filter for `band` at `rate` (the formulas of the Web Audio spec).
    pub fn new(band: &Band, rate: f64) -> Self {
        let w0 = 2.0 * std::f64::consts::PI * band.f.min(rate * 0.49) / rate;
        let (sin, cos) = w0.sin_cos();
        let a = 10f64.powf(band.gain / 40.0);
        let alpha = sin / (2.0 * band.q);
        // shelf slope 1
        let alpha_s = sin / 2.0 * 2f64.sqrt();
        let sa = 2.0 * a.sqrt() * alpha_s;
        let (b, a0, a1, a2) = match band.kind {
            Kind::Lowpass => ([(1.0 - cos) / 2.0, 1.0 - cos, (1.0 - cos) / 2.0], 1.0 + alpha, -2.0 * cos, 1.0 - alpha),
            Kind::Highpass => ([(1.0 + cos) / 2.0, -(1.0 + cos), (1.0 + cos) / 2.0], 1.0 + alpha, -2.0 * cos, 1.0 - alpha),
            Kind::Notch => ([1.0, -2.0 * cos, 1.0], 1.0 + alpha, -2.0 * cos, 1.0 - alpha),
            Kind::Peaking => ([1.0 + alpha * a, -2.0 * cos, 1.0 - alpha * a], 1.0 + alpha / a, -2.0 * cos, 1.0 - alpha / a),
            Kind::Lowshelf => (
                [a * ((a + 1.0) - (a - 1.0) * cos + sa), 2.0 * a * ((a - 1.0) - (a + 1.0) * cos), a * ((a + 1.0) - (a - 1.0) * cos - sa)],
                (a + 1.0) + (a - 1.0) * cos + sa,
                -2.0 * ((a - 1.0) + (a + 1.0) * cos),
                (a + 1.0) + (a - 1.0) * cos - sa,
            ),
            Kind::Highshelf => (
                [a * ((a + 1.0) + (a - 1.0) * cos + sa), -2.0 * a * ((a - 1.0) + (a + 1.0) * cos), a * ((a + 1.0) + (a - 1.0) * cos - sa)],
                (a + 1.0) - (a - 1.0) * cos + sa,
                2.0 * ((a - 1.0) - (a + 1.0) * cos),
                (a + 1.0) - (a - 1.0) * cos - sa,
            ),
        };
        Self { b: [b[0] / a0, b[1] / a0, b[2] / a0], a: [a1 / a0, a2 / a0], z: [[0.0; 2]; 2] }
    }

    /// A band-pass one octave wide around `f` (constant 0 dB peak): the spectrum's bands.
    fn octave(f: f64, rate: f64) -> Self {
        let w0 = 2.0 * std::f64::consts::PI * f.min(rate * 0.45) / rate;
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / (2.0 * 2f64.sqrt());
        let a0 = 1.0 + alpha;
        Self { b: [alpha / a0, 0.0, -alpha / a0], a: [-2.0 * cos / a0, (1.0 - alpha) / a0], z: [[0.0; 2]; 2] }
    }

    #[inline]
    fn run(&mut self, ch: usize, x: f64) -> f64 {
        let z = &mut self.z[ch];
        let y = self.b[0] * x + z[0];
        z[0] = self.b[1] * x - self.a[0] * y + z[1];
        z[1] = self.b[2] * x - self.a[1] * y;
        y
    }

    /// Its gain at `f` Hz, dB.
    pub fn response(&self, f: f64, rate: f64) -> f64 {
        let w = 2.0 * std::f64::consts::PI * f / rate;
        let (c1, s1, c2, s2) = (w.cos(), -w.sin(), (2.0 * w).cos(), -(2.0 * w).sin());
        let num = (self.b[0] + self.b[1] * c1 + self.b[2] * c2, self.b[1] * s1 + self.b[2] * s2);
        let den = (1.0 + self.a[0] * c1 + self.a[1] * c2, self.a[0] * s1 + self.a[1] * s2);
        10.0 * ((num.0 * num.0 + num.1 * num.1) / (den.0 * den.0 + den.1 * den.1)).max(1e-30).log10()
    }
}

/// A clip's EQ at one rate: its bands in order.
#[derive(Debug, Clone, Default)]
pub struct Eq {
    filters: Vec<Biquad>,
}

impl Eq {
    pub fn new(bands: &[Band], rate: f64) -> Self {
        Self { filters: bands.iter().map(|b| Biquad::new(b, rate)).collect() }
    }

    pub fn is_empty(&self) -> bool {
        self.filters.is_empty()
    }

    /// One stereo frame through every band.
    #[inline]
    pub fn frame(&mut self, l: f32, r: f32) -> (f32, f32) {
        let (mut l, mut r) = (l as f64, r as f64);
        for f in &mut self.filters {
            l = f.run(0, l);
            r = f.run(1, r);
        }
        (l as f32, r as f32)
    }

    /// Interleaved stereo frames in place.
    pub fn process(&mut self, frames: &mut [f32]) {
        if self.filters.is_empty() {
            return;
        }
        for f in frames.as_chunks_mut::<2>().0 {
            let (l, r) = self.frame(f[0], f[1]);
            *f = [l, r];
        }
    }

    /// The whole EQ's gain at `f` Hz, dB.
    pub fn response(&self, f: f64, rate: f64) -> f64 {
        self.filters.iter().map(|b| b.response(f, rate)).sum()
    }

    /// What it does to the energy the spectrum reads in the octave around `f` (dB): its power gain averaged over what
    /// that octave's band-pass lets through, a sound flat across the band assumed.
    pub fn octave_gain(&self, f: f64, rate: f64) -> f64 {
        let bp = Biquad::octave(f, rate);
        let (mut num, mut den) = (0.0, 0.0);
        // three octaves either side, 48 steps an octave (log spaced: each step's width ∝ its frequency)
        for k in -144..=144 {
            let x = f * 2f64.powf(k as f64 / 48.0);
            if !(10.0..rate * 0.49).contains(&x) {
                continue;
            }
            let w = 10f64.powf(bp.response(x, rate) / 10.0) * x;
            num += w * 10f64.powf(self.response(x, rate) / 10.0);
            den += w;
        }
        if den > 0.0 { 10.0 * (num / den).log10() } else { 0.0 }
    }
}

/// The spectrum of interleaved stereo `frames`: each octave band's share of the energy where the sound speaks, dB
/// against the whole (`OCTAVES`, in order; None: silent).
pub fn spectrum(frames: &[f32], rate: u32) -> Option<Vec<f64>> {
    let rate_f = rate as f64;
    let block = (rate as usize / 10).max(1);
    let mono: Vec<f64> = frames.as_chunks::<2>().0.iter().map(|f| (f[0] as f64 + f[1] as f64) / 2.0).collect();
    let energy = |x: &[f64]| x.chunks(block).map(|b| b.iter().map(|v| v * v).sum::<f64>() / b.len() as f64).collect::<Vec<f64>>();
    let whole = energy(&mono);
    // where it speaks: blocks within 20 dB of its loud ones (the 95th percentile)
    let mut sorted = whole.clone();
    sorted.sort_by(f64::total_cmp);
    let loud = *sorted.get(((sorted.len() as f64 * 0.95) as usize).min(sorted.len().saturating_sub(1)))?;
    if loud <= 1e-12 {
        return None;
    }
    let keep: Vec<bool> = whole.iter().map(|e| *e >= loud * 0.01).collect();
    let total: f64 = whole.iter().zip(&keep).filter(|(_, k)| **k).map(|(e, _)| e).sum();
    Some(
        OCTAVES
            .iter()
            .map(|&f| {
                if f >= rate_f * 0.45 {
                    return -120.0;
                }
                let mut bp = Biquad::octave(f, rate_f);
                let out: Vec<f64> = mono.iter().map(|&x| bp.run(0, x)).collect();
                let e: f64 = energy(&out).iter().zip(&keep).filter(|(_, k)| **k).map(|(e, _)| e).sum();
                ((10.0 * (e / total).max(1e-12).log10()) * 10.0).round() / 10.0
            })
            .collect(),
    )
}

/// The EQ that makes a sound of spectrum `from` sound like one of spectrum `to` (both `spectrum`'s): a peaking band on
/// every octave from `lo` to `hi` Hz whose difference, smoothed over its neighbours, is worth it (≥ 1 dB), each within ±`limit` dB, solved so what
/// the whole EQ does to each octave (`Eq::octave_gain`: the bands overlap) lands on the differences; a high-pass under `lo` when the reference has
/// clearly less there. The differences are taken against their mean over `lo…hi`: tone only, the level stays the
/// clip's gain's.
pub fn matching(from: &[f64], to: &[f64], lo: f64, hi: f64, limit: f64, rate: f64) -> Vec<Band> {
    let inside: Vec<usize> = OCTAVES.iter().enumerate().filter(|(_, f)| **f >= lo && **f <= hi).map(|(i, _)| i).collect();
    if inside.is_empty() || from.len() != OCTAVES.len() || to.len() != OCTAVES.len() {
        return Vec::new();
    }
    let raw: Vec<f64> = inside.iter().map(|&i| to[i] - from[i]).collect();
    // broad strokes, as a dialogue editor EQs: the differences smoothed over their neighbours (a word more or less of
    // one vowel moves an octave by a dB or two; a mic's colour moves several together)
    let diff: Vec<f64> = (0..raw.len())
        .map(|k| {
            let (a, b) = (raw[k.saturating_sub(1)], raw[(k + 1).min(raw.len() - 1)]);
            0.25 * a + 0.5 * raw[k] + 0.25 * b
        })
        .collect();
    let mean = diff.iter().sum::<f64>() / diff.len() as f64;
    let want: Vec<f64> = diff.iter().map(|d| (d - mean).clamp(-limit, limit)).collect();
    // wide peaking bands (q 1: about an octave and a half), their gains solved by a few rounds of correcting what the
    // whole EQ gives
    let q = 1.0;
    let mut gains = want.clone();
    for _ in 0..12 {
        let bands: Vec<Band> = inside.iter().zip(&gains).map(|(&i, &g)| Band { kind: Kind::Peaking, f: OCTAVES[i], gain: g, q }).collect();
        let eq = Eq::new(&bands, rate);
        for (k, &i) in inside.iter().enumerate() {
            let got = eq.octave_gain(OCTAVES[i], rate);
            gains[k] = (gains[k] + 0.7 * (want[k] - got)).clamp(-limit, limit);
        }
    }
    let mut out: Vec<Band> = Vec::new();
    // under the lowest band: the reference far quieter there (a lav against a camera's rumble) wants a high-pass
    if let Some(&first) = inside.first()
        && first > 0
        && to[first - 1] - from[first - 1] - mean < -6.0
    {
        out.push(Band { kind: Kind::Highpass, f: (OCTAVES[first - 1] * 1.2).round(), gain: 0.0, q: default_q() });
    }
    out.extend(inside.iter().zip(&gains).filter(|(_, g)| g.abs() >= 1.0).map(|(&i, &g)| Band { kind: Kind::Peaking, f: OCTAVES[i], gain: (g * 10.0).round() / 10.0, q }));
    out.truncate(MAX_BANDS);
    out
}
