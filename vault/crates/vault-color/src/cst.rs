//! Every source's colour journey into ACEScct, the one working space every proxy is in: its transfer curve decoded
//! to scene-linear light, a 3×3 from its primaries into AP1 (with a Bradford adaptation when its white is not the
//! ACES white), then the ACEScct curve. No output transform: a proxy stays scene-referred. The native twin of the
//! idt-* transforms in game/film/transforms.js, checked against OpenColorIO's ACES studio config and colour-science
//! (tests/cst.rs against tests/cst_reference.txt: within 1e-5 ACEScct of both, every profile).
//!
//! What goes in: one pixel as RGB in the source's own encoding, full range — 0 is the lowest code and 1 the highest,
//! i.e. after YCbCr → RGB with the source's own matrix and its range expanded (video range 64…940 of 1023 becomes
//! 0…1; values outside stay outside). No colour management in between: the code values as the camera wrote them.
//! Linear sources (EXR) go in as their scene-linear floats. What comes out: ACEScct code values (AP1).
//!
//! On the GPU: `METAL_KERNEL` does the exact maths in Core Image (within 1.2e-5 ACEScct of `Journey::apply` on an
//! M1, measured), for every journey. A baked cube under CIColorCube is the fallback and holds only where
//! `Journey::cube_fits`: CIColorCube itself is off by up to 2.1e-3 even with an identity cube, and the journeys
//! through a gamut wider than AP1 (Apple Wide Gamut, AP0) bend hard in bright saturated colours — 0.1–0.4 ACEScct off
//! without the gamut compression, still about 8e-3 with it.
//!
//! Choices, each as the ACES studio config makes it unless said:
//!   rec709 — "Camera Rec.709": the BT.709 camera curve undone (1/0.45 power, 0.099 offset, the linear toe joined
//!            continuously, slope ≈ 4.514 — OCIO's ExponentWithLinear, not BT.709's rounded 4.5 / 0.018, which
//!            differs by at most 2.5e-4 ACEScct at the toe). A Rec.709 video is taken as what a camera saw, not as
//!            what a screen shows (that would be the inverse output transform, idt-rec709 in transforms.js).
//!   srgb   — IEC 61966-2-1 decoded the same way (2.4 power, 0.055 offset, continuous toe; 8e-6 from IEC's 12.92).
//!   hlg    — BT.2100 inverse OETF: scene light, no OOTF (no display, no nits), scaled so 18% grey sits at
//!            BT.2408's 38% signal — `HLG_SCALE` in transforms.js (OCIO's own HLG curve puts grey at 42%).
//!   pq     — ST 2084 EOTF to absolute cd/m², scaled so BT.2408's 26 cd/m² grey is 0.18 — `PQ_SCALE` in
//!            transforms.js (so 100 cd/m² = 0.692; OCIO's own PQ curve is 100 cd/m² = 1.0).
//!   apple-log / apple-log-2 — the same curve (Apple Log Profile white paper), clamped below code 0 at R₀ as OCIO does.
//!   apple-log-2, aces2065-1 — gamuts wider than AP1: after the matrix, the ACES Reference Gamut Compression
//!            (`gamut_compress`, OCIO's "ACES-LMT - ACES 1.3 Reference Gamut Compression") takes their colours inside
//!            AP1 before the ACEScct curve, as ACES applies it right after the input transform. Without it, what lies
//!            beyond AP1 (LEDs, neon, a phone screen, an HSI light) arrives as negative light: every grade cube clamps
//!            it, the grading stills clip it, and it reaches the screen flat and off-hue.

pub(crate) type M3 = [[f64; 3]; 3];
/// Chromaticities x, y of red, green, blue and white.
pub(crate) type Primaries = [[f64; 2]; 4];

const D65: [f64; 2] = [0.3127, 0.3290];
const ACES_WHITE: [f64; 2] = [0.32168, 0.33767];
pub(crate) const REC709: Primaries = [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06], D65];
const REC2020: Primaries = [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046], D65];
/// Apple Wide Gamut, from the Apple Log 2 white paper as OpenColorIO transcribes it (AppleCameras.cpp, PR #2343).
const APPLE_WIDE_GAMUT: Primaries = [[0.725, 0.301], [0.221, 0.814], [0.068, -0.076], D65];
/// ACES AP0 (ACES2065-1) and AP1 (ACEScg, ACEScct): SMPTE ST 2065-1, Academy S-2014-004.
pub(crate) const AP0: Primaries = [[0.7347, 0.2653], [0.0, 1.0], [0.0001, -0.077], ACES_WHITE];
pub(crate) const AP1: Primaries = [[0.713, 0.293], [0.165, 0.830], [0.128, 0.044], ACES_WHITE];

/// The cube size the proxy bakes at: 65³, as the studio's preview LUTs (transforms.js `LUT_SIZE`).
pub const CUBE_SIZE: usize = 65;

/// A transfer curve, from code values to scene-linear light. The numbers are `METAL_KERNEL`'s `curve` argument.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Curve {
    /// already ACEScct: nothing to do
    Acescct = 0,
    /// already linear light
    Linear = 1,
    Rec709 = 2,
    Srgb = 3,
    AppleLog = 4,
    Hlg = 5,
    Pq = 6,
}

/// What a cube baked for a journey takes in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CubeInput {
    /// the source's own code values, 0…1: CIColorCube straight on the decoded RGB
    Code,
    /// linear light first encoded with the ACEScct curve per channel (a shaper): a cube over 0…1 of linear light would
    /// clip every highlight and starve the shadows. Covers linear −0.0069…222. Core Image has no filter for this
    /// curve, so on the GPU linear sources take `METAL_KERNEL`.
    Acescct,
}

/// One source's way into ACEScct.
#[derive(Debug, Clone)]
pub struct Journey {
    pub profile: &'static str,
    /// the steps, for people: "Apple Log curve → linear · Apple Wide Gamut → AP1 · ACEScct"
    pub label: &'static str,
    pub curve: Curve,
    /// linear light × this after the curve (HLG and PQ only)
    pub scale: f64,
    /// linear source RGB → linear AP1; None when it is AP1 already
    pub matrix: Option<M3>,
    pub cube_input: CubeInput,
    /// Its colours taken inside AP1 by the ACES Reference Gamut Compression before the ACEScct curve
    /// (`gamut_compress`): the journeys from a gamut wider than AP1 (Apple Wide Gamut, AP0).
    pub compress: bool,
    /// Can a 65³ cube under CIColorCube carry this journey (within 2.5e-3 ACEScct, about 2½ 10-bit code values, above
    /// the source's black — measured on an M1)? Only when the cube takes code values and the matrix into AP1 has no
    /// negative term. Where it has (Apple Wide Gamut, AP0 — gamuts wider than AP1), bright saturated colours come out
    /// of the matrix as small differences of large values and a cube is off by 0.1–0.4 ACEScct: `METAL_KERNEL` only.
    pub cube_fits: bool,
}

/// The journey of a profile (the ids of color.rs `PROFILES`); None when none is defined — legacy, unknown, new kinds.
pub fn journey(profile: &str) -> Option<Journey> {
    let to_ap1 = |p: &Primaries| Some(conversion(p, &AP1));
    let (profile, label, curve, scale, matrix, cube_input) = match profile {
        "acescct" => ("acescct", "ACEScct already", Curve::Acescct, 1.0, None, CubeInput::Code),
        "rec709" => ("rec709", "Rec.709 camera curve → linear · Rec.709 → AP1 (Bradford) · ACEScct", Curve::Rec709, 1.0, to_ap1(&REC709), CubeInput::Code),
        "srgb" => ("srgb", "sRGB curve → linear · Rec.709 → AP1 (Bradford) · ACEScct", Curve::Srgb, 1.0, to_ap1(&REC709), CubeInput::Code),
        "hlg" => ("hlg", "HLG inverse OETF → scene linear (grey at 38%) · Rec.2020 → AP1 (Bradford) · ACEScct", Curve::Hlg, hlg_scale(), to_ap1(&REC2020), CubeInput::Code),
        "pq" => ("pq", "PQ → cd/m² (26 cd/m² = grey) · Rec.2020 → AP1 (Bradford) · ACEScct", Curve::Pq, 0.18 / 26.0, to_ap1(&REC2020), CubeInput::Code),
        "apple-log" => ("apple-log", "Apple Log curve → linear · Rec.2020 → AP1 (Bradford) · ACEScct", Curve::AppleLog, 1.0, to_ap1(&REC2020), CubeInput::Code),
        "apple-log-2" => ("apple-log-2", "Apple Log 2 curve → linear · Apple Wide Gamut → AP1 (Bradford) · ACES gamut compression · ACEScct", Curve::AppleLog, 1.0, to_ap1(&APPLE_WIDE_GAMUT), CubeInput::Code),
        "aces2065-1" => ("aces2065-1", "linear AP0 → AP1 · ACES gamut compression · ACEScct", Curve::Linear, 1.0, to_ap1(&AP0), CubeInput::Acescct),
        "acescg" => ("acescg", "linear AP1 · ACEScct", Curve::Linear, 1.0, None, CubeInput::Acescct),
        "linear-rec709" => ("linear-rec709", "linear Rec.709 → AP1 (Bradford) · ACEScct", Curve::Linear, 1.0, to_ap1(&REC709), CubeInput::Acescct),
        _ => return None,
    };
    // a gamut wider than AP1 has negative terms in its matrix into it
    let wide = matrix.is_some_and(|m: M3| m.iter().flatten().any(|x| *x < 0.0));
    let cube_fits = cube_input == CubeInput::Code && !wide;
    Some(Journey { profile, label, curve, scale, matrix, cube_input, compress: wide, cube_fits })
}

impl Journey {
    /// One pixel, in the source's encoding, to ACEScct (f64 throughout).
    pub fn apply(&self, rgb: [f64; 3]) -> [f64; 3] {
        if self.curve == Curve::Acescct {
            return rgb;
        }
        let lin = rgb.map(|v| decode(self.curve, v) * self.scale);
        let ap1 = match &self.matrix {
            Some(m) => mul(m, lin),
            None => lin,
        };
        let ap1 = if self.compress { gamut_compress(ap1) } else { ap1 };
        ap1.map(to_cct)
    }

    /// The arguments of `METAL_KERNEL` for this journey, after the image: the curve's number, the scale, the matrix
    /// into AP1 row by row (three CIVectors; the identity when the source is AP1 already), and 1 when it compresses.
    pub fn kernel_args(&self) -> KernelArgs {
        let m = self.matrix.unwrap_or([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]);
        (self.curve as u8 as f32, self.scale as f32, m.map(|r| r.map(|x| x as f32)), if self.compress { 1.0 } else { 0.0 })
    }

    /// The cube (RGB triples, red fastest, as a .cube file lists them) of this journey, `size` points a side.
    pub fn cube(&self, size: usize) -> Vec<f32> {
        let n = size.max(2);
        let at = |i: usize| i as f64 / (n - 1) as f64;
        let mut out = Vec::with_capacity(n * n * n * 3);
        for b in 0..n {
            for g in 0..n {
                for r in 0..n {
                    let v = [at(r), at(g), at(b)];
                    let px = match self.cube_input {
                        CubeInput::Code => self.apply(v),
                        CubeInput::Acescct => self.apply(v.map(from_cct)),
                    };
                    out.extend(px.map(|x| x as f32));
                }
            }
        }
        out
    }
}

/// `METAL_KERNEL`'s arguments after the image: the curve's number, the scale, the matrix rows, the compression (0 or 1).
pub type KernelArgs = (f32, f32, [[f32; 3]; 3], f32);

// ── the gamut compression ─────────────────────────────────────────────────────────────────────────────────────────

/// How far beyond AP1 each distance may reach and still land inside it (cyan, magenta, yellow: the red, green and blue
/// channels' distance from the achromatic axis), where the compression starts (the ColorChecker's colours lie inside),
/// and how hard it bends: ACES 1.3's Reference Gamut Compression, kept in ACES 2.0's look set.
const RGC_LIMIT: [f64; 3] = [1.147, 1.264, 1.312];
const RGC_THRESHOLD: [f64; 3] = [0.815, 0.803, 0.880];
const RGC_POWER: f64 = 1.2;

/// The ACES Reference Gamut Compression (ACES 1.3 `LMT.Academy.ReferenceGamutCompress`, OpenColorIO's "ACES-LMT -
/// ACES 1.3 Reference Gamut Compression"), on linear AP1: each channel's distance from the largest one, relative to
/// it, rolled off past its threshold so that its limit lands on the AP1 boundary. A colour inside every threshold —
/// skin, sky, foliage, the whole ColorChecker — is untouched; a pixel whose largest channel is 0 becomes black, as in
/// the CTL.
pub fn gamut_compress(c: [f64; 3]) -> [f64; 3] {
    let ach = c[0].max(c[1]).max(c[2]);
    if ach == 0.0 {
        return [0.0; 3];
    }
    let a = ach.abs();
    std::array::from_fn(|i| {
        let d = (ach - c[i]) / a;
        let (lim, thr) = (RGC_LIMIT[i], RGC_THRESHOLD[i]);
        if d < thr {
            // inside the threshold: the channel as it is (the CTL recomposes it, the same number but for rounding)
            return c[i];
        }
        let scl = (lim - thr) / (((1.0 - thr) / (lim - thr)).powf(-RGC_POWER) - 1.0).powf(1.0 / RGC_POWER);
        let nd = (d - thr) / scl;
        ach - (thr + scl * nd / (1.0 + nd.powf(RGC_POWER)).powf(1.0 / RGC_POWER)) * a
    })
}

/// One pixel to ACEScct; None when the profile has no journey.
pub fn to_acescct(profile: &str, rgb: [f32; 3]) -> Option<[f32; 3]> {
    Some(journey(profile)?.apply(rgb.map(f64::from)).map(|x| x as f32))
}

/// A 3D LUT from the source's code values to ACEScct, `size` points a side (`CUBE_SIZE`; CIColorCube takes 2…128), as
/// RGB triples with red fastest. For CIColorCube take `rgba()` of it, and let Core Image leave colour alone around it
/// (a CIContext with no working colour space and a float working format): the cube wants the code values as they are.
/// Linear sources want the ACEScct curve applied first (`CubeInput::Acescct`). Check `Journey::cube_fits` first.
pub fn bake_cube(profile: &str, size: usize) -> Option<Vec<f32>> {
    Some(journey(profile)?.cube(size))
}

/// The whole journey as one Core Image colour kernel in Metal, exact where a cube is not: compile it once with
/// `CIKernel.kernels(withMetalString:)` (macOS 12+, a Metal-backed CIContext), take the kernel named "acescct" (a
/// CIColorKernel), and apply it with the image and `Journey::kernel_args()` — the curve and the scale as NSNumbers,
/// the matrix rows as three CIVector(x:y:z:), the compression as an NSNumber. Same maths as `Journey::apply`, in f32 on the GPU. Like the cube, it
/// wants the code values as they are: a CIContext with no working colour space (NSNull) and a float working format.
pub const METAL_KERNEL: &str = r#"#include <CoreImage/CoreImage.h>
using namespace metal;

static float mon_curve(float v, float g, float o) {
    float brk = o / (g - 1.0f);
    if (v >= brk) return precise::pow((v + o) / (1.0f + o), g);
    return v * ((g - 1.0f) / o) * precise::pow(o * g / ((g - 1.0f) * (1.0f + o)), g);
}

static float apple_log(float p) {
    const float r0 = -0.05641088f, c = 47.28711236f, beta = 0.00964052f, gamma = 0.08550479f, delta = 0.69336945f;
    const float pt = c * (0.01f - r0) * (0.01f - r0);
    if (p >= pt) return precise::exp2((p - delta) / gamma) - beta;
    if (p >= 0.0f) return precise::sqrt(p / c) + r0;
    return r0;
}

static float hlg(float v) {
    const float a = 0.17883277f, b = 1.0f - 4.0f * 0.17883277f, c = 0.5f - 0.17883277f * precise::log(4.0f * 0.17883277f);
    if (v <= 0.0f) return 0.0f;
    if (v <= 0.5f) return v * v / 3.0f;
    return (precise::exp((v - c) / a) + b) / 12.0f;
}

static float pq_nits(float v) {
    const float m1 = 2610.0f / 16384.0f, m2 = 2523.0f / 4096.0f * 128.0f;
    const float c1 = 3424.0f / 4096.0f, c2 = 2413.0f / 4096.0f * 32.0f, c3 = 2392.0f / 4096.0f * 32.0f;
    float p = precise::pow(max(v, 0.0f), 1.0f / m2);
    return 10000.0f * precise::pow(max(p - c1, 0.0f) / (c2 - c3 * p), 1.0f / m1);
}

static float decode(int curve, float v) {
    switch (curve) {
        case 2: return mon_curve(v, 1.0f / 0.45f, 0.099f);
        case 3: return mon_curve(v, 2.4f, 0.055f);
        case 4: return apple_log(v);
        case 5: return hlg(v);
        case 6: return pq_nits(v);
        default: return v;
    }
}

static float to_cct(float x) {
    return x <= 0.0078125f ? 10.5402377416545f * x + 0.0729055341958355f : (precise::log2(x) + 9.72f) / 17.52f;
}

// the ACES Reference Gamut Compression, as cst.rs `gamut_compress`
static float rgc(float d, float lim, float thr) {
    const float pwr = 1.2f;
    if (d < thr) return d;
    float scl = (lim - thr) / precise::pow(precise::pow((1.0f - thr) / (lim - thr), -pwr) - 1.0f, 1.0f / pwr);
    float nd = (d - thr) / scl;
    return thr + scl * nd / precise::pow(1.0f + precise::pow(nd, pwr), 1.0f / pwr);
}

static float3 gamut_compress(float3 c) {
    float ach = max(c.r, max(c.g, c.b));
    if (ach == 0.0f) return float3(0.0f);
    float a = fabs(ach);
    float3 d = (ach - c) / a;
    float3 k = float3(rgc(d.x, 1.147f, 0.815f), rgc(d.y, 1.264f, 0.803f), rgc(d.z, 1.312f, 0.880f));
    return select(ach - k * a, c, d < float3(0.815f, 0.803f, 0.880f));
}

extern "C" float4 acescct(coreimage::sample_t s, float curve, float scale, float3 m0, float3 m1, float3 m2, float compress) [[stitchable]] {
    int k = int(curve + 0.5f);
    if (k == 0) return s;
    float3 lin = float3(decode(k, s.r), decode(k, s.g), decode(k, s.b)) * scale;
    float3 ap1 = float3(dot(m0, lin), dot(m1, lin), dot(m2, lin));
    if (compress > 0.5f) ap1 = gamut_compress(ap1);
    return float4(to_cct(ap1.r), to_cct(ap1.g), to_cct(ap1.b), s.a);
}
"#;

/// RGB triples to the RGBA cells CIColorCube takes (alpha 1).
pub fn rgba(cube: &[f32]) -> Vec<f32> {
    cube.as_chunks::<3>().0.iter().flat_map(|c| [c[0], c[1], c[2], 1.0]).collect()
}

// ── the curves ────────────────────────────────────────────────────────────────────────────────────────────────────

/// Code value → linear light, for one channel.
pub fn decode(curve: Curve, v: f64) -> f64 {
    match curve {
        Curve::Acescct => from_cct(v),
        Curve::Linear => v,
        Curve::Rec709 => mon_curve(v, 1.0 / 0.45, 0.099),
        Curve::Srgb => mon_curve(v, 2.4, 0.055),
        Curve::AppleLog => apple_log(v),
        Curve::Hlg => hlg(v),
        Curve::Pq => pq_nits(v),
    }
}

/// A power curve with an offset and a linear toe that meets it smoothly (OCIO's ExponentWithLinearTransform, the
/// "moncurve" of the ACES CTL), encoded → linear. Below 0 the toe carries on straight.
fn mon_curve(v: f64, gamma: f64, offset: f64) -> f64 {
    let brk = offset / (gamma - 1.0);
    if v >= brk {
        ((v + offset) / (1.0 + offset)).powf(gamma)
    } else {
        let slope = ((gamma - 1.0) / offset) * (offset * gamma / ((gamma - 1.0) * (1.0 + offset))).powf(gamma);
        v * slope
    }
}

/// Apple Log → linear, from Apple's "Apple Log Profile" white paper (the same curve in Apple Log 2).
fn apple_log(p: f64) -> f64 {
    const R0: f64 = -0.05641088;
    const RT: f64 = 0.01;
    const C: f64 = 47.28711236;
    const BETA: f64 = 0.00964052;
    const GAMMA: f64 = 0.08550479;
    const DELTA: f64 = 0.69336945;
    let pt = C * (RT - R0) * (RT - R0);
    if p >= pt {
        2f64.powf((p - DELTA) / GAMMA) - BETA
    } else if p >= 0.0 {
        (p / C).sqrt() + R0
    } else {
        R0
    }
}

const HLG_A: f64 = 0.17883277;
const HLG_B: f64 = 1.0 - 4.0 * HLG_A;

/// HLG signal → scene light 0…1 (ITU-R BT.2100 inverse OETF); below 0 held at 0.
fn hlg(v: f64) -> f64 {
    let c = 0.5 - HLG_A * (4.0 * HLG_A).ln();
    if v <= 0.0 {
        0.0
    } else if v <= 0.5 {
        v * v / 3.0
    } else {
        (((v - c) / HLG_A).exp() + HLG_B) / 12.0
    }
}

/// HLG scene light → linear with 18% grey at BT.2408's 38% signal (transforms.js `HLG_SCALE`).
fn hlg_scale() -> f64 {
    0.18 / hlg(0.38)
}

/// PQ signal → cd/m² (SMPTE ST 2084 EOTF); below 0 held at 0.
fn pq_nits(v: f64) -> f64 {
    const M1: f64 = 2610.0 / 16384.0;
    const M2: f64 = 2523.0 / 4096.0 * 128.0;
    const C1: f64 = 3424.0 / 4096.0;
    const C2: f64 = 2413.0 / 4096.0 * 32.0;
    const C3: f64 = 2392.0 / 4096.0 * 32.0;
    let p = v.max(0.0).powf(1.0 / M2);
    10000.0 * ((p - C1).max(0.0) / (C2 - C3 * p)).powf(1.0 / M1)
}

// the ACEScct curve (Academy S-2016-001), as color.js `toCct` / `fromCct`
const CCT_X_BRK: f64 = 0.0078125;
const CCT_Y_BRK: f64 = 0.155251141552511;
const CCT_A: f64 = 10.5402377416545;
const CCT_B: f64 = 0.0729055341958355;

/// Linear AP1 → ACEScct.
pub fn to_cct(lin: f64) -> f64 {
    if lin <= CCT_X_BRK { CCT_A * lin + CCT_B } else { (lin.log2() + 9.72) / 17.52 }
}

/// ACEScct → linear AP1.
pub fn from_cct(cct: f64) -> f64 {
    if cct <= CCT_Y_BRK { (cct - CCT_B) / CCT_A } else { (cct * 17.52 - 9.72).exp2().min(65504.0) }
}

// ── the matrices ──────────────────────────────────────────────────────────────────────────────────────────────────

/// Linear RGB in `from` → linear RGB in `to`, through CIE XYZ, Bradford-adapted when the whites differ (as OCIO's
/// `build_conversion_matrix` and colour-science's `RGB_to_RGB` derive it).
pub fn conversion(from: &Primaries, to: &Primaries) -> M3 {
    let m = rgb_to_xyz(from);
    let m = if from[3] == to[3] { m } else { mul3(&bradford(from[3], to[3]), &m) };
    mul3(&inv(&rgb_to_xyz(to)), &m)
}

fn xyz(xy: [f64; 2]) -> [f64; 3] {
    [xy[0] / xy[1], 1.0, (1.0 - xy[0] - xy[1]) / xy[1]]
}

/// The normalised primary matrix: linear RGB → XYZ, white at Y = 1.
pub(crate) fn rgb_to_xyz(p: &Primaries) -> M3 {
    let cols = [xyz(p[0]), xyz(p[1]), xyz(p[2])];
    let m = [0, 1, 2].map(|r| [cols[0][r], cols[1][r], cols[2][r]]);
    let s = mul(&inv(&m), xyz(p[3]));
    [0, 1, 2].map(|r| [m[r][0] * s[0], m[r][1] * s[1], m[r][2] * s[2]])
}

/// The Bradford chromatic adaptation from one white to another, in XYZ.
fn bradford(from: [f64; 2], to: [f64; 2]) -> M3 {
    const B: M3 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
    let (s, d) = (mul(&B, xyz(from)), mul(&B, xyz(to)));
    let k = [[d[0] / s[0], 0.0, 0.0], [0.0, d[1] / s[1], 0.0], [0.0, 0.0, d[2] / s[2]]];
    mul3(&inv(&B), &mul3(&k, &B))
}

pub(crate) fn mul(m: &M3, v: [f64; 3]) -> [f64; 3] {
    m.map(|r| r[0] * v[0] + r[1] * v[1] + r[2] * v[2])
}

pub(crate) fn mul3(a: &M3, b: &M3) -> M3 {
    [0, 1, 2].map(|r| [0, 1, 2].map(|c| (0..3).map(|k| a[r][k] * b[k][c]).sum()))
}

pub(crate) fn inv(m: &M3) -> M3 {
    let c = |r: usize, k: usize| m[(r + 1) % 3][(k + 1) % 3] * m[(r + 2) % 3][(k + 2) % 3] - m[(r + 1) % 3][(k + 2) % 3] * m[(r + 2) % 3][(k + 1) % 3];
    let det = m[0][0] * c(0, 0) + m[0][1] * c(0, 1) + m[0][2] * c(0, 2);
    [0, 1, 2].map(|r| [0, 1, 2].map(|k| c(k, r) / det))
}
