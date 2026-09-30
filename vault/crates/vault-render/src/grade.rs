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
