//! The ACES 2.0 output transform, natively: the timeline's ACEScct to what a Rec.709 screen shows — the view
//! "ACES 2.0 - SDR 100 nits (Rec.709)" on the display "Rec.1886 Rec.709 - Display" of OpenColorIO's ACES studio
//! config (studio-config-v4.0.0_aces-v2.0_ocio-v2.5), the `odt-rec709` transform in game/film/transforms.js. The
//! native twin of what the render worker baked with OCIO (scripts/film/color/bake.py), so the Mac bakes the viewer's
//! and the render's output LUT itself.
//!
//! The steps, as the ACES 2.0 CTL and OCIO's ACES2 fixed-function ops (ops/fixedfunction/ACES2) take them:
//!   1. ACEScct → linear AP1, clamped to 0…8·r_hit (no negative light into the model), → AP0 (ACES2065-1).
//!   2. AP0 → JMh: the Hellwig 2022 colour appearance model as ACES 2.0 tunes it — CAM16's sharpened cone space from
//!      the "primaries" below, the illuminant discounted completely, L_A 100 cd/m², Y_b 20, dim surround, the
//!      non-linearity without its +0.1, and the achromatic weights 2 · 1 · 0.05.
//!   3. The Daniele tone scale (peak 100 cd/m², grey 0.18 → 10.013 cd/m²) on the achromatic lightness: J → Y, tone
//!      scale, → J. Colourfulness follows lightness, then the chroma compression squeezes it towards a hue-dependent
//!      norm, bounded by the reach of AP1 at peak (the reach table).
//!   4. The gamut compression into Rec.709 at 100 cd/m²: along lines bending towards a focus on the lightness axis,
//!      against the hull the hull table describes (the Rec.709 cube's cusp and the upper hull's gamma, hue by hue),
//!      compressing only what lies beyond 75 % of the way to the hull, so that the reach of AP1 lands on the hull.
//!   5. JMh → linear Rec.709 (D65), clamped to 0…1 (peak / 100 cd/m²), → BT.1886: the 2.4 power undone (x^(1/2.4)).
//!
//! Where OCIO 2.5 differs from the ACES 2.0 CTL as first published, this follows OCIO 2.5 — each found by measuring
//! against OCIO 2.5.2's own ACES2 fixed functions stage by stage, not guessed: the hull table sampled at hues that
//! include every corner of the limiting cube and of AP1 exactly (not an HSV sweep), with the cusp found on the cube's
//! edges and the gamma tested at the widened cusp and interpolated as 1/gamma; the reach boundary taken on the same
//! compression line as the gamut boundary; the focus gain above its threshold log10(…)² + 1 (not ^(1/0.55)).
//!
//! What goes in: ACEScct code values (AP1). What comes out: Rec.709 display code values, 0…1, full range. Everything
//! in f64 (OCIO works in f32); the tables are built once, when an `OutputTransform` is made (about a millisecond).
//! Within 0.07 of a 10-bit code value of OCIO 2.5.2 everywhere measured (tests/aces2.rs, tests/aces2_reference.txt).

use crate::cst::{AP0, AP1, M3, Primaries, REC709, conversion, from_cct, inv, mul, mul3, rgb_to_xyz};

/// The cube size the viewer's LUTs bake at (transforms.js `LUT_SIZE`), as `cst::CUBE_SIZE`.
pub const CUBE_SIZE: usize = 65;
/// The cube size the render bakes at (transforms.js `RENDER_LUT_SIZE`).
pub const RENDER_CUBE_SIZE: usize = 129;

// ── the constants of ACES 2.0 ─────────────────────────────────────────────────────────────────────────────────────

/// 1.0 of scene and display light is this many cd/m².
const REFERENCE_LUMINANCE: f64 = 100.0;
/// adapting field luminance and background luminance factor
const L_A: f64 = 100.0;
const Y_B: f64 = 20.0;
/// the dim surround: F, c, N_c
const SURROUND: [f64; 3] = [0.9, 0.59, 0.9];
/// the achromatic response's weights of the red and blue post-adaptation signals (green is 1)
const RA: f64 = 2.0;
const BA: f64 = 0.05;
/// CAM16's sharpened cone space, as ACES 2.0 defines it by primaries and a white
const CAM16: Primaries = [[0.8336, 0.1735], [2.3854, -1.4659], [0.087, -0.125], [0.333, 0.333]];

// chroma compression
const CHROMA_COMPRESS: f64 = 2.4;
const CHROMA_COMPRESS_FACT: f64 = 3.3;
const CHROMA_EXPAND: f64 = 1.3;
const CHROMA_EXPAND_FACT: f64 = 0.69;
const CHROMA_EXPAND_THR: f64 = 0.5;

// gamut compression
const SMOOTH_CUSPS: f64 = 0.12;
const SMOOTH_M: f64 = 0.27;
/// the cusp's M widened for the smooth minimum between the lower and the upper hull
const CUSP_WIDEN: f64 = 1.0 + SMOOTH_M * SMOOTH_CUSPS;
const CUSP_MID_BLEND: f64 = 1.3;
const FOCUS_GAIN_BLEND: f64 = 0.3;
const FOCUS_DISTANCE: f64 = 1.35;
const FOCUS_DISTANCE_SCALING: f64 = 1.75;
const COMPRESSION_THRESHOLD: f64 = 0.75;

/// the hue tables hold one entry per degree
const TABLE_SIZE: usize = 360;

// ── the colour appearance model ───────────────────────────────────────────────────────────────────────────────────

/// Hellwig 2022 JMh for one set of RGB primaries (and their white), as ACES 2.0 sets it up.
#[derive(Debug, Clone)]
struct Cam {
    /// the luminance-level adaptation factor
    f_l: f64,
    /// the base exponential nonlinearity
    z: f64,
    /// the achromatic response of the white
    a_w: f64,
    /// the post-adaptation response of an achromatic 100 cd/m² (J ↔ Y for greys)
    a_w_j: f64,
    /// linear RGB (1.0 = 100 cd/m²) → the discounted cone signals: D_RGB · M16 · NPM · 100
    to_cone: M3,
    from_cone: M3,
    /// the post-adaptation cone signals from (A, a, b)
    from_opponent: M3,
}

/// (A, a, b) from the post-adaptation cone signals, and back.
const OPPONENT: M3 = [[RA, 1.0, BA], [1.0, -12.0 / 11.0, 1.0 / 11.0], [1.0 / 9.0, 1.0 / 9.0, -2.0 / 9.0]];

impl Cam {
    fn new(p: &Primaries) -> Cam {
        let npm = rgb_to_xyz(p);
        let m16 = inv(&rgb_to_xyz(&CAM16));
        let xyz_w = mul(&npm, [REFERENCE_LUMINANCE; 3]);
        let y_w = xyz_w[1];
        let rgb_w = mul(&m16, xyz_w);
        let k = 1.0 / (5.0 * L_A + 1.0);
        let k4 = k.powi(4);
        let f_l = 0.2 * k4 * (5.0 * L_A) + 0.1 * (1.0 - k4).powi(2) * (5.0 * L_A).cbrt();
        let z = 1.48 + (Y_B / y_w).sqrt();
        // the illuminant discounted completely (D = 1)
        let d_rgb = rgb_w.map(|c| y_w / c);
        let rgb_a_w = [0, 1, 2].map(|i| panlrc_fwd(d_rgb[i] * rgb_w[i], f_l));
        let a_w = RA * rgb_a_w[0] + rgb_a_w[1] + BA * rgb_a_w[2];
        let a_w_j = panlrc_fwd(REFERENCE_LUMINANCE, f_l);
        let d = [[d_rgb[0], 0.0, 0.0], [0.0, d_rgb[1], 0.0], [0.0, 0.0, d_rgb[2]]];
        let scale = [[REFERENCE_LUMINANCE, 0.0, 0.0], [0.0, REFERENCE_LUMINANCE, 0.0], [0.0, 0.0, REFERENCE_LUMINANCE]];
        let to_cone = mul3(&d, &mul3(&m16, &mul3(&npm, &scale)));
        Cam { f_l, z, a_w, a_w_j, to_cone, from_cone: inv(&to_cone), from_opponent: inv(&OPPONENT) }
    }

    /// Linear RGB (1.0 = 100 cd/m²) → J, M, h (degrees, 0…360).
    fn jmh(&self, rgb: [f64; 3]) -> [f64; 3] {
        let c = mul(&self.to_cone, rgb).map(|v| panlrc_fwd(v, self.f_l));
        let [a_ach, a, b] = mul(&OPPONENT, c);
        let j = 100.0 * spow(a_ach / self.a_w, SURROUND[1] * self.z);
        let m = if j == 0.0 { 0.0 } else { 43.0 * SURROUND[2] * (a * a + b * b).sqrt() };
        [j, m, wrap_360(b.atan2(a).to_degrees())]
    }

    /// J, M, h → linear RGB (1.0 = 100 cd/m²).
    fn rgb(&self, jmh: [f64; 3]) -> [f64; 3] {
        let [j, m, h] = jmh;
        let hr = h.to_radians();
        let a_ach = self.a_w * spow(j / 100.0, 1.0 / (SURROUND[1] * self.z));
        let (a, b) = (m * hr.cos() / (43.0 * SURROUND[2]), m * hr.sin() / (43.0 * SURROUND[2]));
        let c = mul(&self.from_opponent, [a_ach, a, b]).map(|v| panlrc_inv(v, self.f_l));
        mul(&self.from_cone, c)
    }

    /// The lightness J of an achromatic luminance Y (100 = 100 cd/m²).
    fn y_to_j(&self, y: f64) -> f64 {
        100.0 * spow(panlrc_fwd(y, self.f_l) / self.a_w_j, SURROUND[1] * self.z)
    }

    /// The luminance Y of an achromatic lightness J.
    fn j_to_y(&self, j: f64) -> f64 {
        panlrc_inv(self.a_w_j * spow(j / 100.0, 1.0 / (SURROUND[1] * self.z)), self.f_l)
    }
}

/// The post-adaptation non-linear response compression (ACES 2.0 drops CAM16's +0.1).
fn panlrc_fwd(v: f64, f_l: f64) -> f64 {
    let f = (f_l * v.abs() / 100.0).powf(0.42);
    v.signum() * 400.0 * f / (27.13 + f)
}

fn panlrc_inv(v: f64, f_l: f64) -> f64 {
    let a = v.abs();
    v.signum() * 100.0 / f_l * (27.13 * a / (400.0 - a)).powf(1.0 / 0.42)
}

/// A power that keeps the sign.
fn spow(x: f64, p: f64) -> f64 {
    x.signum() * x.abs().powf(p)
}

fn wrap_360(h: f64) -> f64 {
    let y = h % 360.0;
    if y < 0.0 { y + 360.0 } else { y }
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + t * (b - a)
}

// ── the tone scale ────────────────────────────────────────────────────────────────────────────────────────────────

/// The Daniele tone scale for one peak luminance.
#[derive(Debug, Clone)]
struct ToneScale {
    n_r: f64,
    g: f64,
    t_1: f64,
    /// display grey (relative to n_r)
    c_t: f64,
    s_2: f64,
    m_2: f64,
    /// the scene value where linear AP1 is clamped: 8 · r_hit
    forward_limit: f64,
    /// log10 of peak / 100 cd/m²
    log_peak: f64,
}

impl ToneScale {
    fn new(peak: f64) -> ToneScale {
        let n = peak;
        let n_r = 100.0;
        let g = 1.15;
        let c = 0.18;
        let c_d = 10.013;
        let w_g = 0.14;
        let t_1 = 0.04;
        let (r_hit_min, r_hit_max) = (128.0, 896.0);
        let r_hit = r_hit_min + (r_hit_max - r_hit_min) * ((n / n_r).ln() / (10000f64 / 100.0).ln());
        let m_0 = n / n_r;
        let m_1 = 0.5 * (m_0 + (m_0 * (m_0 + 4.0 * t_1)).sqrt());
        let u = ((r_hit / m_1) / ((r_hit / m_1) + 1.0)).powf(g);
        let m = m_1 / u;
        let w_i = (n / 100.0).log2();
        let c_t = c_d / n_r * (1.0 + w_i * w_g);
        let g_ip = 0.5 * (c_t + (c_t * (c_t + 4.0 * t_1)).sqrt());
        let g_ipp2 = -(m_1 * (g_ip / m).powf(1.0 / g)) / ((g_ip / m).powf(1.0 / g) - 1.0);
        let w_2 = c / g_ipp2;
        let s_2 = w_2 * m_1;
        let u_2 = ((r_hit / m_1) / ((r_hit / m_1) + w_2)).powf(g);
        let m_2 = m_1 / u_2;
        ToneScale { n_r, g, t_1, c_t, s_2, m_2, forward_limit: 8.0 * r_hit, log_peak: (n / n_r).log10() }
    }

    /// Scene luminance (1.0 = 100 cd/m²) → display luminance in cd/m².
    fn apply(&self, x: f64) -> f64 {
        let f = self.m_2 * (x.max(0.0) / (x + self.s_2)).powf(self.g);
        (f * f / (f + self.t_1)).max(0.0) * self.n_r
    }
}

// ── the output transform ──────────────────────────────────────────────────────────────────────────────────────────

/// The ACES 2.0 output transform for one display: its model parameters and hue tables, built once.
#[derive(Debug, Clone)]
pub struct OutputTransform {
    /// the peak luminance, cd/m²
    peak: f64,
    input: Cam,
    limit: Cam,
    ts: ToneScale,
    limit_j_max: f64,
    mid_j: f64,
    model_gamma: f64,
    sat: f64,
    sat_thr: f64,
    compr: f64,
    chroma_compress_scale: f64,
    focus_dist: f64,
    lower_hull_gamma: f64,
    /// the most colourful M of AP1 at peak lightness, per degree of hue
    reach_m: Vec<f64>,
    /// the hull of the limiting gamut round the hue circle: h, the cusp's J and M, 1 / the upper hull's gamma —
    /// ordered by h, one wrapped entry at each end (`hull_table`)
    hull: Vec<[f64; 4]>,
    ap1_to_ap0: M3,
}

impl OutputTransform {
    /// "ACES 2.0 - SDR 100 nits (Rec.709)" on "Rec.1886 Rec.709 - Display": Rec.709 limiting primaries, D65 white,
    /// 100 cd/m² peak, BT.1886 (2.4) encoding. The `odt-rec709` transform.
    pub fn sdr_rec709() -> OutputTransform {
        OutputTransform::new(100.0, &REC709)
    }

    fn new(peak: f64, limiting: &Primaries) -> OutputTransform {
        let input = Cam::new(&AP0);
        let limit = Cam::new(limiting);
        let ts = ToneScale::new(peak);
        let limit_j_max = input.y_to_j(peak);
        let mid_j = input.y_to_j(ts.c_t * 100.0);
        let model_gamma = 1.0 / (SURROUND[1] * (1.48 + (Y_B / L_A).sqrt()));
        let reach = Cam::new(&AP1);
        let reach_m = reach_table(&reach, limit_j_max);
        let hues = hue_samples(&corners(&limit, peak), &reach_corner_hues(&reach, limit_j_max, ts.forward_limit));
        let mut t = OutputTransform {
            peak,
            input,
            limit,
            limit_j_max,
            mid_j,
            model_gamma,
            sat: (CHROMA_EXPAND - CHROMA_EXPAND * CHROMA_EXPAND_FACT * ts.log_peak).max(0.2),
            sat_thr: CHROMA_EXPAND_THR / peak,
            compr: CHROMA_COMPRESS + CHROMA_COMPRESS * CHROMA_COMPRESS_FACT * ts.log_peak,
            chroma_compress_scale: (0.03379 * peak).powf(0.30596) - 0.45135,
            focus_dist: FOCUS_DISTANCE + FOCUS_DISTANCE * FOCUS_DISTANCE_SCALING * ts.log_peak,
            lower_hull_gamma: 1.14 + 0.07 * ts.log_peak,
            ts,
            reach_m,
            hull: Vec::new(),
            ap1_to_ap0: conversion(&AP1, &AP0),
        };
        t.hull = t.hull_table(&hues);
        t
    }

    /// One pixel, ACEScct → display code values (f64 throughout).
    pub fn apply(&self, acescct: [f64; 3]) -> [f64; 3] {
        self.apply_ap1(acescct.map(from_cct))
    }

    /// One pixel of scene-linear AP1 (ACEScg) → display code values: the transform after the ACEScct curve.
    pub fn apply_ap1(&self, ap1: [f64; 3]) -> [f64; 3] {
        // the model sees no light outside AP1, nor beyond where the tone scale has long reached the peak
        let ap0 = mul(&self.ap1_to_ap0, ap1.map(|v| v.clamp(0.0, self.ts.forward_limit)));
        let jmh = self.input.jmh(ap0);
        let jmh = self.tonescale_chroma_compress(jmh);
        let jmh = self.gamut_compress(jmh);
        let peak = self.peak / REFERENCE_LUMINANCE;
        self.limit.rgb(jmh).map(|v| v.clamp(0.0, peak).powf(1.0 / 2.4))
    }

    /// The cube (RGB triples, red fastest, as a .cube file lists them) over ACEScct 0…1, `size` points a side —
    /// the layout of `cst::Journey::cube` and bake.py's LUTs (65³ for the viewer, 129³ for the render).
    pub fn cube(&self, size: usize) -> Vec<f32> {
        let n = size.max(2);
        let at = |i: usize| i as f64 / (n - 1) as f64;
        let mut out = Vec::with_capacity(n * n * n * 3);
        for b in 0..n {
            for g in 0..n {
                for r in 0..n {
                    out.extend(self.apply([at(r), at(g), at(b)]).map(|x| x as f32));
                }
            }
        }
        out
    }

    // ── tone scale and chroma compression ──

    fn tonescale_chroma_compress(&self, jmh: [f64; 3]) -> [f64; 3] {
        let [j, m, h] = jmh;
        let y = self.input.j_to_y(j);
        let j_ts = self.input.y_to_j(self.ts.apply(y / REFERENCE_LUMINANCE));
        if m == 0.0 || j == 0.0 {
            return [j_ts, 0.0, h];
        }
        let nj = j_ts / self.limit_j_max;
        let snj = (1.0 - nj).max(0.0);
        let norm = self.chroma_compress_norm(h);
        let limit = spow(nj, self.model_gamma) * self.reach_m(h) / norm;
        let mut mc = m * spow(j_ts / j, self.model_gamma) / norm;
        mc = limit - toe(limit - mc, limit - 0.001, snj * self.sat, (nj * nj + self.sat_thr).sqrt());
        mc = toe(mc, limit, nj * self.compr, snj);
        [j_ts, mc * norm, h]
    }

    /// The hue-dependent norm the chroma compression divides M by.
    fn chroma_compress_norm(&self, h: f64) -> f64 {
        let hr = h.to_radians();
        let (a, b) = (hr.cos(), hr.sin());
        let (cos2, sin2) = (a * a - b * b, 2.0 * a * b);
        let (cos3, sin3) = (4.0 * a * a * a - 3.0 * a, 3.0 * b - 4.0 * b * b * b);
        let m =
            11.34072 * a + 16.46899 * cos2 + 7.88380 * cos3 + 14.66441 * b - 6.37224 * sin2 + 9.19364 * sin3 + 77.12896;
        m * self.chroma_compress_scale
    }

    fn reach_m(&self, h: f64) -> f64 {
        per_degree(&self.reach_m, h)
    }

    // ── gamut compression ──

    fn gamut_compress(&self, jmh: [f64; 3]) -> [f64; 3] {
        let [j, m, h] = jmh;
        if j <= 0.0 {
            return [0.0, 0.0, h];
        }
        if m <= 0.0 || j > self.limit_j_max {
            return [j, 0.0, h];
        }
        let [cusp_j, cusp_m, gamma_top_inv] = self.hull_at(h);
        let cusp = [cusp_j, cusp_m];
        let focus_j = self.focus_j(cusp_j);
        let slope_gain = self.slope_gain(j, cusp_j);
        let line = self.line(j, m, focus_j, slope_gain);
        let bm = self.boundary_m(&line, cusp, focus_j, slope_gain, gamma_top_inv);
        if bm <= 0.0 {
            return [j, 0.0, h];
        }
        // how far AP1 reaches along the same line: the ratio sets how hard the compression bends
        let reach = self.reach_m(h);
        let j_max = self.limit_j_max;
        let reach_m = j_max * (line.j_axis / j_max).powf(self.model_gamma) * reach / (j_max - line.slope * reach);
        let difference = (reach_m / bm).max(1.0001);
        let threshold = COMPRESSION_THRESHOLD.max(1.0 / difference);
        let mc = bm * compression(m / bm, threshold, difference);
        [line.j_axis + line.slope * mc, mc, h]
    }

    /// Where the compression aims: between the cusp's lightness and the mid grey's, on the lightness axis.
    fn focus_j(&self, cusp_j: f64) -> f64 {
        lerp(cusp_j, self.mid_j, (CUSP_MID_BLEND - cusp_j / self.limit_j_max).min(1.0))
    }

    /// How steeply the compression lines bend: flatter towards the peak, above 30 % of the way from the cusp's
    /// lightness to it — there by (log10 of how much closer to the peak) squared, as OCIO 2.5 does.
    fn slope_gain(&self, j: f64, cusp_j: f64) -> f64 {
        let j_max = self.limit_j_max;
        let thr = lerp(cusp_j, j_max, FOCUS_GAIN_BLEND);
        let gain = if j > thr {
            let adjust = ((j_max - thr) / (j_max - j.min(j_max)).max(0.0001)).log10();
            adjust * adjust + 1.0
        } else {
            1.0
        };
        j_max * self.focus_dist * gain
    }

    /// The compression line through (J, M): where it meets the lightness axis, and its slope dJ/dM.
    fn line(&self, j: f64, m: f64, focus_j: f64, slope_gain: f64) -> Line {
        let j_max = self.limit_j_max;
        let j_axis = solve_j_intersect(j, m, focus_j, j_max, slope_gain);
        let slope = if j_axis < focus_j {
            j_axis * (j_axis - focus_j) / (focus_j * slope_gain)
        } else {
            (j_max - j_axis) * (j_axis - focus_j) / (focus_j * slope_gain)
        };
        Line { j_axis, slope }
    }

    /// Where the line meets the gamut's hull, as M: the lower hull (black to the cusp, gamma 1.14) and the upper hull
    /// (the cusp to the peak's white, 1 / `gamma_top_inv`), joined by a smooth minimum at the cusp — whose M is widened
    /// by 3.24 % for it.
    fn boundary_m(&self, line: &Line, cusp: [f64; 2], focus_j: f64, slope_gain: f64, gamma_top_inv: f64) -> f64 {
        let j_max = self.limit_j_max;
        let cusp = [cusp[0], cusp[1] * CUSP_WIDEN];
        let cusp_axis = solve_j_intersect(cusp[0], cusp[1], focus_j, j_max, slope_gain);
        let (ja, slope) = (line.j_axis, line.slope);
        let lower = cusp_axis * (ja / cusp_axis).powf(1.0 / self.lower_hull_gamma) / (cusp[0] / cusp[1] - slope);
        let upper = cusp[1] * (j_max - cusp_axis) * ((j_max - ja) / (j_max - cusp_axis)).powf(gamma_top_inv)
            / (slope * cusp[1] + j_max - cusp[0]);
        cusp[1] * smin(lower / cusp[1], upper / cusp[1], SMOOTH_CUSPS)
    }

    /// The cusp's J and M and 1 / the upper hull's gamma at hue h, interpolated between the table's neighbours.
    fn hull_at(&self, h: f64) -> [f64; 3] {
        let t = &self.hull;
        // the first entry whose hue is not below h (the wrapped ends bracket every h in 0…360)
        let hi = t.partition_point(|e| e[0] < h).clamp(1, t.len() - 1);
        let (lo, hi) = (t[hi - 1], t[hi]);
        let f = (h - lo[0]) / (hi[0] - lo[0]);
        [lerp(lo[1], hi[1], f), lerp(lo[2], hi[2], f), lerp(lo[3], hi[3], f)]
    }

    /// The hull table at the given hues (`hue_samples`): h, the cusp found exactly on the limiting cube's edges (J,
    /// M), and 1 / the smallest upper-hull gamma that keeps three test points — 1 %, 50 % and 99 % of the way from the
    /// cusp's lightness up to the peak's, at the cusp's widened M — outside the cube once projected onto the
    /// approximated hull: bracketed in steps of 0.4 below 5, then halved down to 1e-5. The reciprocal is what gets
    /// interpolated between hues, as OCIO does (measured: interpolating the gamma itself is up to 0.002 M off).
    /// One wrapped entry added at each end.
    fn hull_table(&self, hues: &[f64]) -> Vec<[f64; 4]> {
        const POSITIONS: [f64; 3] = [0.01, 0.5, 0.99];
        const STEP: f64 = 0.4;
        const ACCURACY: f64 = 1e-5;
        let corners = corners(&self.limit, self.peak);
        let mut t: Vec<[f64; 4]> = hues
            .iter()
            .map(|&hue| {
                let [cusp_j, cusp_m, _] = cusp_on_edges(&self.limit, &corners, hue);
                let tests = POSITIONS.map(|p| [cusp_j + (self.limit_j_max - cusp_j) * p, cusp_m * CUSP_WIDEN]);
                let fits = |gamma: f64| self.gamma_fits([cusp_j, cusp_m], hue, &tests, 1.0 / gamma);
                let (mut low, mut high) = (0.0, STEP);
                while !fits(high) && high < 5.0 {
                    low = high;
                    high += STEP;
                }
                while high - low > ACCURACY {
                    let mid = (high + low) / 2.0;
                    if fits(mid) { high = mid } else { low = mid }
                }
                [hue, cusp_j, cusp_m, 1.0 / high]
            })
            .collect();
        let (first, last) = (t[0], t[t.len() - 1]);
        t.insert(0, [last[0] - 360.0, last[1], last[2], last[3]]);
        t.push([first[0] + 360.0, first[1], first[2], first[3]]);
        t
    }

    /// Do all test points, projected onto the hull with this gamma, land outside the limiting cube?
    fn gamma_fits(&self, cusp: [f64; 2], hue: f64, tests: &[[f64; 2]; 3], gamma_inv: f64) -> bool {
        let focus_j = self.focus_j(cusp[0]);
        tests.iter().all(|&[j, m]| {
            let slope_gain = self.slope_gain(j, cusp[0]);
            let line = self.line(j, m, focus_j, slope_gain);
            let bm = self.boundary_m(&line, cusp, focus_j, slope_gain, gamma_inv);
            let rgb = self.limit.rgb([line.j_axis + line.slope * bm, bm, hue]);
            rgb.iter().any(|v| v * REFERENCE_LUMINANCE / self.peak > 1.0)
        })
    }
}

/// A compression line in the J–M plane: J = j_axis + slope · M.
struct Line {
    j_axis: f64,
    slope: f64,
}

/// A table with one entry per degree, linearly interpolated round the circle.
fn per_degree(t: &[f64], h: f64) -> f64 {
    let h = wrap_360(h);
    let i = (h as usize).min(TABLE_SIZE - 1);
    lerp(t[i], t[(i + 1) % TABLE_SIZE], h - i as f64)
}

/// The J where the line from (J, M) towards the focus meets the lightness axis (a quadratic: the line bends).
fn solve_j_intersect(j: f64, m: f64, focus_j: f64, max_j: f64, slope_gain: f64) -> f64 {
    let a = m / (focus_j * slope_gain);
    if j < focus_j {
        let b = 1.0 - m / slope_gain;
        let c = -j;
        2.0 * c / (-b - (b * b - 4.0 * a * c).sqrt())
    } else {
        let b = -(1.0 + m / slope_gain + max_j * m / (focus_j * slope_gain));
        let c = max_j * m / slope_gain + j;
        2.0 * c / (-b + (b * b - 4.0 * a * c).sqrt())
    }
}

/// A smooth minimum.
fn smin(a: f64, b: f64, s: f64) -> f64 {
    let h = (s - (a - b).abs()).max(0.0) / s;
    a.min(b) - h * h * h * s / 6.0
}

/// The toe that the chroma compression bends M with (forward).
fn toe(x: f64, limit: f64, k1_in: f64, k2_in: f64) -> f64 {
    if x > limit {
        return x;
    }
    let k2 = k2_in.max(0.001);
    let k1 = (k1_in * k1_in + k2 * k2).sqrt();
    let k3 = (limit + k1) / (limit + k2);
    0.5 * (k3 * x - k1 + ((k3 * x - k1) * (k3 * x - k1) + 4.0 * k2 * k3 * x).sqrt())
}

/// The gamut compression's curve: identity below the threshold, then rolling off so `lim` lands on 1.
fn compression(v: f64, thr: f64, lim: f64) -> f64 {
    if v < thr || lim <= 1.0001 {
        return v;
    }
    let s = (lim - thr) * (1.0 - thr) / (lim - 1.0);
    let nd = (v - thr) / s;
    thr + s * nd / (1.0 + nd)
}

// ── the tables ────────────────────────────────────────────────────────────────────────────────────────────────────

/// For every degree of hue, how colourful the reach gamut (AP1) gets at the peak's lightness before a channel goes
/// negative: stepped out by 50 below 1300, then halved down to 0.01 (the outside end kept).
fn reach_table(reach: &Cam, j: f64) -> Vec<f64> {
    let outside = |m: f64, h: f64| reach.rgb([j, m, h]).iter().any(|v| *v < 0.0);
    (0..TABLE_SIZE)
        .map(|i| {
            let hue = i as f64;
            let (mut low, mut high) = (0.0, 50.0);
            while !outside(high, hue) && high < 1300.0 {
                low = high;
                high += 50.0;
            }
            while high - low > 1e-2 {
                let mid = (high + low) / 2.0;
                if outside(mid, hue) { high = mid } else { low = mid }
            }
            high
        })
        .collect()
}

/// The unit cube's six colourful corners, red, yellow, green, cyan, blue, magenta: its most colourful edges join them.
const CUBE_CORNERS: [[f64; 3]; 6] =
    [[1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0], [0.0, 1.0, 1.0], [0.0, 0.0, 1.0], [1.0, 0.0, 1.0]];

/// The limiting cube's corners at peak as (RGB, JMh), ordered by hue, with the last wrapped in front (h − 360) and
/// the first behind (h + 360): eight entries, so every hue lies between two neighbours.
fn corners(limit: &Cam, peak: f64) -> Vec<([f64; 3], [f64; 3])> {
    let mut c: Vec<([f64; 3], [f64; 3])> = CUBE_CORNERS
        .iter()
        .map(|k| {
            let rgb = k.map(|v| v * peak / REFERENCE_LUMINANCE);
            (rgb, limit.jmh(rgb))
        })
        .collect();
    c.sort_by(|a, b| a.1[2].total_cmp(&b.1[2]));
    let (first, last) = (c[0], c[5]);
    c.insert(0, (last.0, [last.1[0], last.1[1], last.1[2] - 360.0]));
    c.push((first.0, [first.1[0], first.1[1], first.1[2] + 360.0]));
    c
}

/// The cusp at a hue: on the cube edge between the two corners around it, halving the step along the edge until it
/// is within 1e-7 of the edge's length.
fn cusp_on_edges(limit: &Cam, corners: &[([f64; 3], [f64; 3])], hue: f64) -> [f64; 3] {
    let upper = (1..corners.len()).find(|&i| corners[i].1[2] > hue).unwrap_or(corners.len() - 1);
    let lower = upper - 1;
    if corners[lower].1[2] == hue {
        return corners[lower].1;
    }
    let (a, b) = (corners[lower], corners[upper]);
    let at = |t: f64| limit.jmh([0, 1, 2].map(|i| lerp(a.0[i], b.0[i], t)));
    let (mut lo, mut hi) = (0.0, 1.0);
    while hi - lo > 1e-7 {
        let t = (lo + hi) / 2.0;
        let h = at(t)[2];
        // a sample whose hue falls outside the edge's range has wrapped round 0/360
        if h < a.1[2] {
            hi = t;
        } else if h >= b.1[2] || h <= hue {
            lo = t;
        } else {
            hi = t;
        }
    }
    at((lo + hi) / 2.0)
}

/// The hues of the reach gamut's (AP1's) corners, each scaled up until it reaches the peak's lightness.
fn reach_corner_hues(reach: &Cam, limit_j_max: f64, forward_limit: f64) -> Vec<f64> {
    let mut hues: Vec<f64> = CUBE_CORNERS
        .iter()
        .map(|k| {
            let (mut lo, mut hi) = (0.0, forward_limit);
            while hi - lo > 1e-7 * forward_limit {
                let s = (lo + hi) / 2.0;
                if reach.jmh(k.map(|v| v * s))[0] < limit_j_max { lo = s } else { hi = s }
            }
            reach.jmh(k.map(|v| v * hi))[2]
        })
        .collect();
    hues.sort_by(f64::total_cmp);
    hues
}

/// The hull table's hues: 360 of them from 0, as evenly spread as they can be while every corner of the limiting cube
/// and of the reach gamut is one of them exactly — each corner at the index its hue rounds to (pushed on by one when
/// two would share it), the hues between two corners evenly spaced.
fn hue_samples(limit: &[([f64; 3], [f64; 3])], reach: &[f64]) -> Vec<f64> {
    let mut corners: Vec<f64> = limit[1..=6].iter().map(|c| c.1[2]).chain(reach.iter().copied()).collect();
    corners.sort_by(f64::total_cmp);
    corners.dedup();
    let n = TABLE_SIZE as i64;
    // the table index of every corner
    let mut index: Vec<i64> = Vec::with_capacity(corners.len());
    let mut last = -1;
    let mut min_index = if corners[0] == 0.0 { 0 } else { 1 };
    for (k, h) in corners.iter().enumerate() {
        let mut i = ((h * n as f64 / 360.0).round() as i64).max(min_index).min(n - 1);
        if i == last {
            if k > 1 && index[k - 2] != index[k - 1] - 1 {
                index[k - 1] -= 1;
            } else {
                i += 1;
            }
        }
        index.push(i.min(n - 1));
        last = i;
        min_index = i;
    }
    let mut hues = Vec::with_capacity(TABLE_SIZE);
    let mut span =
        |count: i64, from: f64, to: f64| hues.extend((0..count).map(|i| from + i as f64 * (to - from) / count as f64));
    span(index[0], 0.0, corners[0]);
    for k in 1..corners.len() {
        span(index[k] - index[k - 1], corners[k - 1], corners[k]);
    }
    span(n - index[corners.len() - 1], corners[corners.len() - 1], 360.0);
    hues
}

/// The `odt-rec709` cube over ACEScct 0…1, `size` points a side, RGB triples with red fastest (bake.py's layout;
/// `cst::rgba` makes CIColorCube cells of it). Builds the tables each call: keep an `OutputTransform` to bake more.
pub fn bake_cube(size: usize) -> Vec<f32> {
    OutputTransform::sdr_rec709().cube(size)
}
