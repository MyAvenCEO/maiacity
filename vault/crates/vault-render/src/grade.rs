//! The grade — the one place its maths lives (the studio's viewer samples `cube`, baked from it; the render and hero
//! frames run the same maths in Metal, gpu.rs). The balance (white balance, exposure, contrast, highlights, lows,
//! saturation), then the ASC CDL in ACEScct — slope, offset and power per channel (a negative value held at 0 before a
//! power; nothing clipped at 1), then saturation around Rec.709 luma — and the presets. What a saved grade may hold is
//! checked here as color.js checks it for the API (`cleanCdl`, `cleanBalance`). And the hashes that pin every transform
//! in the report (`hashOf` of transforms.js: 16 hex digits of SHA-256 over the canonical JSON).

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

/// Rec.709 luma weights, as the ASC CDL takes its saturation around.
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

    /// One ACEScct pixel through the grade.
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

/// The 3×3 the CDL's saturation is, row by row.
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

// ── the balance: the fixed first nodes of every shot ─────────────────────────────────────────────────────────────

/// One stop in ACEScct's log segment.
pub const STOP: f64 = 1.0 / 17.52;
/// Mid grey (18 %) in ACEScct: the pivot of contrast, the line between lows and highlights.
pub const PIVOT: f64 = 0.4135884;
/// How far from mid grey the highlights and lows reach before they are fully in.
pub const REACH: f64 = 0.35;

/// White balance → exposure → contrast → highlights / lows → saturation, every amount in stops (contrast: the slope
/// around mid grey; saturation: the factor around luma, both minus 1, 0 = as shot). All 0: the picture as shot.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Balance {
    pub temp: f64,
    pub tint: f64,
    pub exposure: f64,
    pub contrast: f64,
    pub highlights: f64,
    pub shadows: f64,
    #[serde(default)]
    pub sat: f64,
}

/// Each balance field with its range (the API clamps a saved balance to the same: color.js `BALANCE_NODES`).
pub const BALANCE_FIELDS: [(&str, f64, f64); 7] = [
    ("temp", -2.0, 2.0),
    ("tint", -2.0, 2.0),
    ("exposure", -4.0, 4.0),
    ("contrast", -0.8, 1.5),
    ("highlights", -3.0, 3.0),
    ("shadows", -3.0, 3.0),
    ("sat", -1.0, 1.0),
];

fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

impl Balance {
    pub fn is_neutral(&self) -> bool {
        *self == Balance::default()
    }

    /// One ACEScct pixel through the balance.
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
        // the lift is the same on every channel: the luma moves with it, the colour around it doesn't
        let (k, m) = (1.0 + self.sat, l + lift);
        [m + k * (r + lift - m), m + k * (g + lift - m), m + k * (b + lift - m)]
    }

    pub fn get(&self, k: &str) -> f64 {
        match k {
            "temp" => self.temp,
            "tint" => self.tint,
            "exposure" => self.exposure,
            "contrast" => self.contrast,
            "highlights" => self.highlights,
            "shadows" => self.shadows,
            "sat" => self.sat,
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
            "sat" => self.sat = v,
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

/// The grade presets of the Grade tab, by name, with what the studio calls them.
pub const PRESETS: [(&str, &str); 6] = [
    ("neutral", "Neutral"),
    ("cold", "Cold (the world as it was)"),
    ("dip", "Dip (sick, heavy)"),
    ("bright", "Bright (the city by day)"),
    ("night", "Night (blue, lifted)"),
    ("warm", "Warm (golden hour)"),
];

/// A clip's whole grade as a 3D LUT over ACEScct 0…1 (`size`³ RGB, red fastest, the .cube order): its balance, then its
/// grades in order (its own CDL, the film's look) — what the studio's viewer samples between the input and the output
/// transforms, so the maths is only here.
pub fn cube(balance: Option<&Balance>, grades: &[Cdl], size: usize) -> Vec<f32> {
    let n = size.max(2);
    let mut out = Vec::with_capacity(n * n * n * 3);
    let at = |i: usize| i as f64 / (n - 1) as f64;
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
                out.extend(px.map(|v| v as f32));
            }
        }
    }
    out
}

/// A preset's CDL (the grade presets of the Grade tab).
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
