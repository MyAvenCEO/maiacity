//! The grade: ASC CDL in ACEScct, exactly as `cdl()` in game/film/color.js — slope, offset and power per channel
//! (a negative value held at 0 before a power; nothing clipped at 1), then saturation around Rec.709 luma. And
//! `cleanCdl`, the presets, and the hashes that pin every transform in the report (`hashOf` of transforms.js:
//! 16 hex digits of SHA-256 over the canonical JSON).

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

/// Rec.709 luma weights, as the ASC CDL takes its saturation around (color.js `LUMA`).
pub const LUMA: [f64; 3] = [0.2126, 0.7152, 0.0722];

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Cdl {
    pub slope: [f64; 3],
    pub offset: [f64; 3],
    pub power: [f64; 3],
    pub sat: f64,
}

pub const NEUTRAL: Cdl = Cdl { slope: [1.0; 3], offset: [0.0; 3], power: [1.0; 3], sat: 1.0 };

impl Cdl {
    pub fn is_neutral(&self) -> bool {
        self.sat == 1.0 && (0..3).all(|i| self.slope[i] == 1.0 && self.offset[i] == 0.0 && self.power[i] == 1.0)
    }

    /// One ACEScct pixel through the grade (color.js `cdl`).
    pub fn apply(&self, rgb: [f64; 3]) -> [f64; 3] {
        let v: [f64; 3] = std::array::from_fn(|i| {
            let y = rgb[i] * self.slope[i] + self.offset[i];
            if self.power[i] == 1.0 { y } else { y.max(0.0).powf(self.power[i]) }
        });
        let l = v[0] * LUMA[0] + v[1] * LUMA[1] + v[2] * LUMA[2];
        v.map(|x| l + self.sat * (x - l))
    }

    pub fn to_json(&self) -> Value {
        json!({ "slope": self.slope, "offset": self.offset, "power": self.power, "sat": self.sat })
    }
}

/// The 3×3 the CDL's saturation is (color.js `satMatrix`), row by row.
pub fn sat_matrix(s: f64) -> [[f64; 3]; 3] {
    std::array::from_fn(|r| std::array::from_fn(|c| (if r == c { s } else { 0.0 }) + (1.0 - s) * LUMA[c]))
}

/// A grade as data, checked (color.js `cleanCdl`): anything missing is neutral, every number finite and in a sane
/// range; None when it changes nothing.
pub fn clean_cdl(g: &Value) -> Option<Cdl> {
    let o = g.as_object()?;
    let num = |v: Option<&Value>| -> Option<f64> {
        let v = v?;
        let n = match v {
            Value::Number(n) => n.as_f64(),
            Value::String(s) => s.trim().parse::<f64>().ok(),
            Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
            Value::Null => Some(0.0),
            _ => None,
        }?;
        n.is_finite().then_some(n)
    };
    let trio = |k: &str, d: f64, lo: f64, hi: f64| -> [f64; 3] {
        let arr = o.get(k);
        std::array::from_fn(|i| num(arr.and_then(|a| a.get(i))).unwrap_or(d).max(lo).min(hi))
    };
    let out = Cdl {
        slope: trio("slope", 1.0, 0.0, 4.0),
        offset: trio("offset", 0.0, -1.0, 1.0),
        power: trio("power", 1.0, 0.1, 4.0),
        sat: num(o.get("sat")).unwrap_or(1.0).clamp(0.0, 4.0),
    };
    (!out.is_neutral()).then_some(out)
}

// ── the balance: the fixed first nodes of every shot (color.js `balance`) ───────────────────────────────────────────

/// One stop in ACEScct's log segment.
pub const STOP: f64 = 1.0 / 17.52;
/// Mid grey (18 %) in ACEScct: the pivot of contrast, the line between lows and highlights.
pub const PIVOT: f64 = 0.4135884;
/// How far from mid grey the highlights and lows reach before they are fully in.
pub const REACH: f64 = 0.35;

/// White balance → exposure → contrast → highlights / lows, every amount in stops (contrast: the slope around mid grey,
/// 0 = as shot). All 0: the picture as shot.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Balance {
    pub temp: f64,
    pub tint: f64,
    pub exposure: f64,
    pub contrast: f64,
    pub highlights: f64,
    pub shadows: f64,
}

/// Each balance field with its range (color.js `BALANCE_NODES`).
pub const BALANCE_FIELDS: [(&str, f64, f64); 6] =
    [("temp", -2.0, 2.0), ("tint", -2.0, 2.0), ("exposure", -4.0, 4.0), ("contrast", -0.8, 1.5), ("highlights", -3.0, 3.0), ("shadows", -3.0, 3.0)];

fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

impl Balance {
    pub fn is_neutral(&self) -> bool {
        *self == Balance::default()
    }

    /// One ACEScct pixel through the balance (color.js `balance`).
    pub fn apply(&self, rgb: [f64; 3]) -> [f64; 3] {
        let [mut r, mut g, mut b] = rgb;
        r += self.temp / 2.0 * STOP;
        b -= self.temp / 2.0 * STOP;
        g -= self.tint * STOP;
        let k = 1.0 + self.contrast;
        let tone = |x: f64| PIVOT + (x + self.exposure * STOP - PIVOT) * k;
        let (r, g, b) = (tone(r), tone(g), tone(b));
        let l = r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
        let lift = (self.highlights * smooth(PIVOT, PIVOT + REACH, l) + self.shadows * (1.0 - smooth(PIVOT - REACH, PIVOT, l))) * STOP;
        [r + lift, g + lift, b + lift]
    }

    pub fn get(&self, k: &str) -> f64 {
        match k {
            "temp" => self.temp,
            "tint" => self.tint,
            "exposure" => self.exposure,
            "contrast" => self.contrast,
            "highlights" => self.highlights,
            "shadows" => self.shadows,
            _ => 0.0,
        }
    }

    pub fn set(&mut self, k: &str, v: f64) {
        let (_, lo, hi) = BALANCE_FIELDS.iter().find(|(f, ..)| *f == k).copied().unwrap_or(("", 0.0, 0.0));
        let v = (v.clamp(lo, hi) * 1000.0).round() / 1000.0;
        match k {
            "temp" => self.temp = v,
            "tint" => self.tint = v,
            "exposure" => self.exposure = v,
            "contrast" => self.contrast = v,
            "highlights" => self.highlights = v,
            "shadows" => self.shadows = v,
            _ => {}
        }
    }
}

/// A balance as data, checked (color.js `cleanBalance`): anything missing is 0, every number in its range; None when
/// it changes nothing.
pub fn clean_balance(v: &Value) -> Option<Balance> {
    let o = v.as_object()?;
    let mut b = Balance::default();
    for (k, ..) in BALANCE_FIELDS {
        if let Some(x) = o.get(k).and_then(|x| x.as_f64()).filter(|x| x.is_finite()) {
            b.set(k, x);
        }
    }
    (!b.is_neutral()).then_some(b)
}

/// The luma percentiles a match compares (render.rs `stats`).
pub const MATCH_AT: [&str; 5] = ["p5", "p25", "p50", "p75", "p95"];

/// The balance that brings a shot (its `stats` as shot) to a target (`stats` of another shot, the scene's average, or
/// neutral): the white balance that gives its middle tones the target's cast, then exposure, contrast, highlights and
/// lows fitted so its luma percentiles land on the target's — exposure and contrast first, the highlights and lows
/// only for what those two cannot do.
pub fn fit(shot: &Value, target: &Value) -> Balance {
    let num = |v: &Value, p: &str| v.pointer(p).and_then(Value::as_f64).unwrap_or(0.0);
    let mut b = Balance::default();
    // the cast after the balance is (the shot's − the white balance) × the contrast's slope: the white balance is
    // solved through the contrast fitted with it
    let white = |b: &mut Balance| {
        let k = (1.0 + b.contrast).max(0.05);
        b.set("temp", num(shot, "/to_grey/temp") - num(target, "/to_grey/temp") / k);
        b.set("tint", num(shot, "/to_grey/tint") - num(target, "/to_grey/tint") / k);
    };
    white(&mut b);
    let have: Vec<f64> = MATCH_AT.iter().map(|p| num(shot, &format!("/luma/{p}"))).collect();
    let want: Vec<f64> = MATCH_AT.iter().map(|p| num(target, &format!("/luma/{p}"))).collect();
    // the pixel the percentile stands for: a grey at that luma, carrying the shot's mid cast (so the white balance's
    // effect on luma is in the fit too)
    let mid = shot.pointer("/mid_rgb").and_then(Value::as_array).map(|a| a.iter().map(|x| x.as_f64().unwrap_or(0.0)).collect::<Vec<_>>()).unwrap_or_default();
    let cast: [f64; 3] = if mid.len() == 3 {
        let l = mid[0] * LUMA[0] + mid[1] * LUMA[1] + mid[2] * LUMA[2];
        [mid[0] - l, mid[1] - l, mid[2] - l]
    } else {
        [0.0; 3]
    };
    let luma_of = |b: &Balance, l: f64| {
        let o = b.apply([l + cast[0], l + cast[1], l + cast[2]]);
        o[0] * LUMA[0] + o[1] * LUMA[1] + o[2] * LUMA[2]
    };
    let cost = |b: &Balance| -> f64 {
        let fit: f64 = have.iter().zip(&want).map(|(h, w)| (luma_of(b, *h) - w).powi(2)).sum();
        // highlights and lows cost a little: the same result by exposure and contrast is the better balance
        fit + 2e-6 * (b.highlights.powi(2) + b.shadows.powi(2))
    };
    // a first guess: the middle by exposure, the spread by contrast
    let spread = (have[4] - have[0]).abs().max(1e-3);
    b.set("contrast", (want[4] - want[0]) / spread - 1.0);
    b.set("exposure", (want[2] - have[2]) / STOP);
    for _ in 0..3 {
        let mut step = 0.5;
        while step > 0.001 {
            let mut better = false;
            for k in ["exposure", "contrast", "highlights", "shadows"] {
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
        white(&mut b);
    }
    b
}

/// The grade presets of the Grade tab (color.js `PRESETS`).
pub fn preset(name: &str) -> Option<Cdl> {
    let c = |slope: [f64; 3], offset: [f64; 3], power: [f64; 3], sat: f64| Cdl { slope, offset, power, sat };
    Some(match name {
        "neutral" => NEUTRAL,
        "cold" => c([0.97, 0.99, 1.05], [-0.004, 0.0, 0.012], [1.0, 1.0, 1.0], 0.5),
        "dip" => c([0.94, 1.0, 1.0], [-0.012, 0.004, 0.006], [1.06, 1.04, 1.04], 0.55),
        "bright" => c([1.02, 1.02, 1.0], [0.004, 0.004, 0.0], [1.0, 1.0, 1.0], 1.14),
        "night" => c([0.98, 1.0, 1.06], [0.01, 0.012, 0.024], [0.96, 0.96, 0.94], 1.08),
        "warm" => c([1.05, 1.0, 0.93], [0.006, 0.002, -0.004], [1.0, 1.0, 1.0], 1.06),
        _ => return None,
    })
}

/// transforms.js `canonical`: JSON with its keys sorted (serde_json's map is sorted already).
pub fn canonical(v: &Value) -> String {
    v.to_string()
}

/// transforms.js `hashOf`: 16 hex digits of SHA-256 over the canonical JSON.
pub fn hash_of(v: &Value) -> String {
    hash_bytes(canonical(v).as_bytes())
}

/// 16 hex digits of SHA-256 over bytes.
pub fn hash_bytes(b: &[u8]) -> String {
    let d = Sha256::digest(b);
    d.iter().take(8).map(|x| format!("{x:02x}")).collect()
}
