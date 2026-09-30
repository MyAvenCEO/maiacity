//! The output transform: the timeline's ACEScct to the display code values every delivery carries (Rec.709,
//! BT.1886, 0…1 full range, before the YCbCr encoding). The render takes it as an `Output` — anything that maps one
//! ACEScct pixel to display RGB and names itself by a hash — and runs it on the GPU as a 3D LUT (`Lut3d`, 129³ as
//! the worker's `RENDER_LUT_SIZE`, tetrahedral as ffmpeg's `lut3d=interp=tetrahedral`).
//!
//! The ACES 2.0 output transform is being ported natively beside this (`vault_media::aces2`); it plugs in either as
//! its baked cube (`Lut3d::from_rgb("odt-rec709", 129, aces2::bake_cube(129))`) or by implementing `Output` for it.
//! A `.cube` file (the worker's own 129³ bake from OCIO) loads with `Lut3d::from_cube_file`.

use std::path::Path;

use anyhow::{Context, Result, bail};

use crate::grade::hash_bytes;

/// The cube size the final render bakes its output transform at (transforms.js `RENDER_LUT_SIZE`).
pub const RENDER_LUT_SIZE: usize = 129;

/// ACEScct RGB → display RGB.
pub trait Output: Send + Sync {
    /// the transform's name in the report ("odt-rec709")
    fn name(&self) -> &str;
    /// what pins it: a hash of its numbers
    fn hash(&self) -> String;
    /// one pixel, exactly
    fn apply(&self, acescct: [f64; 3]) -> [f64; 3];
    /// the cube the GPU samples (red fastest, over ACEScct 0…1); by default baked from `apply` at 129³
    fn lut(&self) -> Lut3d {
        Lut3d::bake(self.name(), RENDER_LUT_SIZE, |rgb| self.apply(rgb))
    }
}

/// A 3D LUT: `size`³ RGB triples, red changing fastest, then green, then blue (the .cube order), over 0…1.
#[derive(Clone)]
pub struct Lut3d {
    pub name: String,
    pub size: usize,
    pub data: Vec<f32>,
    hash: String,
}

impl std::fmt::Debug for Lut3d {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Lut3d({} {}³ {})", self.name, self.size, self.hash)
    }
}

impl Lut3d {
    pub fn from_rgb(name: &str, size: usize, data: Vec<f32>) -> Result<Self> {
        if size < 2 || data.len() != size * size * size * 3 {
            bail!("a {size}³ cube holds {} numbers, not {}", size * size * size * 3, data.len());
        }
        let bytes: Vec<u8> = data.iter().flat_map(|x| x.to_le_bytes()).collect();
        let hash = hash_bytes(&[format!("lut3d:{size}:").as_bytes(), &bytes].concat());
        Ok(Self { name: name.into(), size, data, hash })
    }

    /// A cube from a function, sampled on the lattice.
    pub fn bake(name: &str, size: usize, f: impl Fn([f64; 3]) -> [f64; 3]) -> Self {
        let at = |i: usize| i as f64 / (size - 1) as f64;
        let mut data = Vec::with_capacity(size * size * size * 3);
        for b in 0..size {
            for g in 0..size {
                for r in 0..size {
                    data.extend(f([at(r), at(g), at(b)]).map(|x| x as f32));
                }
            }
        }
        Self::from_rgb(name, size, data).expect("sized")
    }

    /// The identity: display = ACEScct code values. A placeholder until the ACES 2.0 output transform is in.
    pub fn identity(size: usize) -> Self {
        Self::bake("identity", size, |rgb| rgb)
    }

    /// A Resolve/IRIDAS `.cube` (LUT_3D_SIZE, optional DOMAIN_MIN/MAX of 0…1, red fastest).
    pub fn from_cube_file(name: &str, path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path).with_context(|| format!("{}", path.display()))?;
        let mut size = 0usize;
        let mut data = Vec::new();
        for line in text.lines() {
            let l = line.trim();
            if l.is_empty() || l.starts_with('#') || l.starts_with("TITLE") {
                continue;
            }
            if let Some(n) = l.strip_prefix("LUT_3D_SIZE") {
                size = n.trim().parse()?;
                continue;
            }
            if l.starts_with("DOMAIN_MIN") || l.starts_with("DOMAIN_MAX") {
                let want = if l.starts_with("DOMAIN_MIN") { 0.0 } else { 1.0 };
                let v: Vec<f64> = l.split_whitespace().skip(1).map(|x| x.parse().unwrap_or(f64::NAN)).collect();
                if v.iter().any(|x| (x - want).abs() > 1e-9) {
                    bail!("{}: a domain other than 0…1 is not handled", path.display());
                }
                continue;
            }
            if l.starts_with("LUT_1D_SIZE") {
                bail!("{} is a 1D LUT", path.display());
            }
            if l.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
                continue;
            }
            for x in l.split_whitespace() {
                data.push(x.parse::<f32>().with_context(|| format!("{}: {l}", path.display()))?);
            }
        }
        Self::from_rgb(name, size, data)
    }

    pub fn hash(&self) -> String {
        self.hash.clone()
    }

    fn at(&self, r: usize, g: usize, b: usize) -> [f64; 3] {
        let i = ((b * self.size + g) * self.size + r) * 3;
        [self.data[i] as f64, self.data[i + 1] as f64, self.data[i + 2] as f64]
    }

    /// Tetrahedral interpolation (ffmpeg `lut3d=interp=tetrahedral`), the input clamped to the cube — the same maths
    /// as the GPU kernel.
    pub fn sample(&self, rgb: [f64; 3]) -> [f64; 3] {
        let n = self.size;
        let p = rgb.map(|v| v.clamp(0.0, 1.0) * (n - 1) as f64);
        let i = p.map(|v| (v.floor() as usize).min(n - 2));
        let f = [p[0] - i[0] as f64, p[1] - i[1] as f64, p[2] - i[2] as f64];
        let c = |dr: usize, dg: usize, db: usize| self.at(i[0] + dr, i[1] + dg, i[2] + db);
        let (c000, c111) = (c(0, 0, 0), c(1, 1, 1));
        let mix = |w: [f64; 4], k: [[f64; 3]; 4]| -> [f64; 3] { std::array::from_fn(|ch| (0..4).map(|j| w[j] * k[j][ch]).sum()) };
        let (fr, fg, fb) = (f[0], f[1], f[2]);
        if fr > fg {
            if fg > fb {
                mix([1.0 - fr, fr - fg, fg - fb, fb], [c000, c(1, 0, 0), c(1, 1, 0), c111])
            } else if fr > fb {
                mix([1.0 - fr, fr - fb, fb - fg, fg], [c000, c(1, 0, 0), c(1, 0, 1), c111])
            } else {
                mix([1.0 - fb, fb - fr, fr - fg, fg], [c000, c(0, 0, 1), c(1, 0, 1), c111])
            }
        } else if fb > fg {
            mix([1.0 - fb, fb - fg, fg - fr, fr], [c000, c(0, 0, 1), c(0, 1, 1), c111])
        } else if fb > fr {
            mix([1.0 - fg, fg - fb, fb - fr, fr], [c000, c(0, 1, 0), c(0, 1, 1), c111])
        } else {
            mix([1.0 - fg, fg - fr, fr - fb, fb], [c000, c(0, 1, 0), c(1, 1, 0), c111])
        }
    }
}

impl Output for Lut3d {
    fn name(&self) -> &str {
        &self.name
    }
    fn hash(&self) -> String {
        self.hash.clone()
    }
    fn apply(&self, acescct: [f64; 3]) -> [f64; 3] {
        self.sample(acescct)
    }
    fn lut(&self) -> Lut3d {
        self.clone()
    }
}
