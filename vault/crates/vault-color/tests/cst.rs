//! cst.rs against two references made outside Rust (tests/cst_reference.txt): OpenColorIO 2.5's ACES studio config
//! and colour-science in float64 — every profile, a neutral ramp from black through grey to the top, and colours.
//! Then the baked cube against the exact maths, as CIColorCube would sample it.

use vault_color::cst::{self, CUBE_SIZE, CubeInput, bake_cube, journey, to_acescct};

const PROFILES: [&str; 10] = ["acescct", "rec709", "srgb", "hlg", "pq", "apple-log", "apple-log-2", "aces2065-1", "acescg", "linear-rec709"];

/// profile, input, OCIO, colour-science
type Row = (String, [f64; 3], [f64; 3], [f64; 3]);

fn reference() -> Vec<Row> {
    include_str!("cst_reference.txt")
        .lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .map(|l| {
            let mut it = l.split_whitespace();
            let p = it.next().unwrap().to_string();
            let v: Vec<f64> = it.map(|x| x.parse().unwrap()).collect();
            (p, [v[0], v[1], v[2]], [v[3], v[4], v[5]], [v[6], v[7], v[8]])
        })
        .collect()
}

fn diff(a: [f64; 3], b: [f64; 3]) -> f64 {
    (0..3).map(|i| (a[i] - b[i]).abs()).fold(0.0, f64::max)
}

/// The journey without its gamut compression: what OCIO's input transforms and colour-science compute.
fn plain(p: &str) -> cst::Journey {
    cst::Journey { compress: false, ..journey(p).unwrap() }
}

#[test]
fn matches_ocio_and_colour_science() {
    let rows = reference();
    for p in PROFILES {
        let j = plain(p);
        let (mut n, mut ocio, mut cs, mut single) = (0, 0f64, 0f64, 0f64);
        for (_, rgb, o, c) in rows.iter().filter(|r| r.0 == p) {
            let out = j.apply(*rgb);
            ocio = ocio.max(diff(out, *o));
            cs = cs.max(diff(out, *c));
            // the f32 API takes the whole journey: where the compression has nothing to do, the same numbers
            if !journey(p).unwrap().compress || cst::gamut_compress(rgb_to_ap1(&j, *rgb)) == rgb_to_ap1(&j, *rgb) {
                let f = to_acescct(p, rgb.map(|x| x as f32)).unwrap().map(f64::from);
                single = single.max(diff(f, *c));
            }
            n += 1;
        }
        println!("{p:14} {n:4} points · max |Δ| ACEScct: OCIO {ocio:.1e} · colour-science {cs:.1e} · f32 API {single:.1e}");
        assert!(n > 20, "{p}: no reference points");
        assert!(ocio < 1e-4, "{p}: {ocio} from OCIO");
        assert!(cs < 1e-6, "{p}: {cs} from colour-science");
        assert!(single < 1e-5, "{p}: f32 API {single}");
    }
}

#[test]
fn no_journey_is_guessed() {
    for p in ["legacy", "unknown", "", "slog3"] {
        assert!(journey(p).is_none() && to_acescct(p, [0.5; 3]).is_none() && bake_cube(p, 5).is_none());
    }
    assert_eq!(journey("apple-log-2").unwrap().label, "Apple Log 2 curve → linear · Apple Wide Gamut → AP1 (Bradford) · ACES gamut compression · ACEScct");
    // the gamut compression where the source's gamut reaches beyond AP1, nowhere else
    let compressed: Vec<&str> = PROFILES.into_iter().filter(|p| journey(p).unwrap().compress).collect();
    assert_eq!(compressed, ["apple-log-2", "aces2065-1"]);
}

/// A pixel's linear AP1 on the way, before the gamut compression and the curve.
fn rgb_to_ap1(j: &cst::Journey, rgb: [f64; 3]) -> [f64; 3] {
    let lin = rgb.map(|v| cst::decode(j.curve, v) * j.scale);
    match &j.matrix {
        Some(m) => [0, 1, 2].map(|r| (0..3).map(|k| m[r][k] * lin[k]).sum()),
        None => lin,
    }
}

/// `gamut_compress` against OpenColorIO's own (tests/rgc_reference.txt: "ACES-LMT - ACES 1.3 Reference Gamut
/// Compression", applied in ACES2065-1 between AP1 → AP0 and back, float32).
#[test]
fn gamut_compression_matches_ocio() {
    let rows: Vec<([f64; 3], [f64; 3])> = include_str!("rgc_reference.txt")
        .lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .map(|l| {
            let v: Vec<f64> = l.split_whitespace().map(|x| x.parse().unwrap()).collect();
            ([v[0], v[1], v[2]], [v[3], v[4], v[5]])
        })
        .collect();
    let mut worst = 0f64;
    for (input, want) in &rows {
        let got = cst::gamut_compress(*input);
        // relative to the pixel's own level, as float32 rounds
        let scale = input.iter().fold(1f64, |m, x| m.max(x.abs()));
        let d = diff(got, *want) / scale;
        worst = worst.max(d);
        assert!(d < 2e-6, "{input:?}: {got:?} vs OCIO {want:?}");
    }
    println!("{} points · max |Δ| / level vs OCIO {worst:.1e}", rows.len());
    assert!(rows.len() > 300);
    // what lies inside every threshold is untouched: grey, skin
    for c in [[0.18, 0.18, 0.18], [0.45, 0.3, 0.22], [2.0, 1.5, 1.1]] {
        assert_eq!(cst::gamut_compress(c), c);
    }
    // a blue LED as the iPhone records it (Apple Wide Gamut) comes out inside AP1
    let led = rgb_to_ap1(&plain("apple-log-2"), [0.02, 0.05, 0.9].map(|lin: f64| {
        // its code values: Apple Log of each linear channel
        (0..=20000).map(|k| k as f64 / 20000.0).min_by(|a, b| (cst::decode(cst::Curve::AppleLog, *a) - lin).abs().total_cmp(&(cst::decode(cst::Curve::AppleLog, *b) - lin).abs())).unwrap()
    }));
    assert!(led[0] < 0.0 && led[1] < 0.0, "outside AP1 as it comes: {led:?}");
    let inside = cst::gamut_compress(led);
    assert!(inside.iter().all(|x| *x > 0.0) && (inside[2] - led[2]).abs() < 1e-12, "{inside:?}");
}

/// The matrices the JS pipeline already uses (color.js REC709_TO_AP1, transforms.js REC2020_TO_AP1, AP0_TO_AP1,
/// AWG_TO_AP0) are the ones derived here from the primaries.
#[test]
fn matrices_match_the_js_pipeline() {
    let m = |p: &str| journey(p).unwrap().matrix.unwrap();
    let close = |a: [[f64; 3]; 3], b: [[f64; 3]; 3], tol: f64| (0..9).all(|i| (a[i / 3][i % 3] - b[i / 3][i % 3]).abs() < tol);
    let rec709 = [[0.6130974, 0.33952314, 0.047379453], [0.07019372, 0.9163539, 0.013452399], [0.020615593, 0.10956977, 0.86981463]];
    assert!(close(m("rec709"), rec709, 1e-7));
    let rec2020 = [
        [0.974894977924419, 0.019599108637005, 0.005505913438576],
        [0.002179562797704, 0.99553546889322, 0.002284968309075],
        [0.004797239683773, 0.024532016634589, 0.970670743681638],
    ];
    assert!(close(m("hlg"), rec2020, 1e-9));
    let ap0 = [[1.4514393161, -0.2365107469, -0.2149285693], [-0.0765537734, 1.1762296998, -0.0996759264], [0.0083161484, -0.0060324498, 0.9977163014]];
    assert!(close(m("aces2065-1"), ap0, 1e-9));
    let awg_to_ap0 = [
        [0.694961049318096, 0.241405268785364, 0.06363368189654],
        [0.047362746414932, 1.004295925054283, -0.051658671469216],
        [-0.021989789359883, -0.028989104971474, 1.050978894331358],
    ];
    let awg = [0, 1, 2].map(|r| [0, 1, 2].map(|c| (0..3).map(|k| ap0[r][k] * awg_to_ap0[k][c]).sum::<f64>()));
    assert!(close(m("apple-log-2"), awg, 1e-8));
}

#[test]
fn the_curve_lands_grey_where_it_should() {
    // 18% grey in linear AP1 is ACEScct 0.4136 (color.js MID_GREY_CCT); HLG 38% and PQ 26 cd/m² are 18% grey
    let grey = cst::to_cct(0.18);
    assert!((grey - 0.413_588_402_492_442_1).abs() < 1e-12);
    assert!((cst::from_cct(grey) - 0.18).abs() < 1e-12);
    for (p, v) in [("hlg", 0.38), ("pq", 0.380_032_274_333_405_6)] {
        let out = journey(p).unwrap().apply([v; 3]);
        assert!(out.iter().all(|x| (x - grey).abs() < 1e-4), "{p}: {out:?}");
    }
}

// ── the cube ──────────────────────────────────────────────────────────────────────────────────────────────────────

fn at(cube: &[f32], n: usize, r: usize, g: usize, b: usize) -> [f64; 3] {
    let i = 3 * (r + n * (g + n * b));
    [cube[i] as f64, cube[i + 1] as f64, cube[i + 2] as f64]
}

/// Where a point falls in the cube: the lower corner and the fractions.
fn cell(n: usize, v: [f64; 3]) -> ([usize; 3], [f64; 3]) {
    let s = v.map(|x| x.clamp(0.0, 1.0) * (n - 1) as f64);
    let i = s.map(|x| (x.floor() as usize).min(n - 2));
    (i, [s[0] - i[0] as f64, s[1] - i[1] as f64, s[2] - i[2] as f64])
}

/// Trilinear, as CIColorCube interpolates.
fn trilinear(cube: &[f32], n: usize, v: [f64; 3]) -> [f64; 3] {
    let ([r, g, b], [fr, fg, fb]) = cell(n, v);
    let mut out = [0.0; 3];
    for (dr, dg, db) in (0..8).map(|k| (k & 1, (k >> 1) & 1, k >> 2)) {
        let w = [1.0 - fr, fr][dr] * [1.0 - fg, fg][dg] * [1.0 - fb, fb][db];
        let c = at(cube, n, r + dr, g + dg, b + db);
        (0..3).for_each(|i| out[i] += w * c[i]);
    }
    out
}

/// Tetrahedral, as OCIO and Resolve interpolate.
fn tetrahedral(cube: &[f32], n: usize, v: [f64; 3]) -> [f64; 3] {
    let (i, f) = cell(n, v);
    let mut order = [0usize, 1, 2];
    order.sort_by(|a, b| f[*b].total_cmp(&f[*a]));
    let mut corner = i;
    let mut out = at(cube, n, corner[0], corner[1], corner[2]).map(|x| x * (1.0 - f[order[0]]));
    for (k, &axis) in order.iter().enumerate() {
        corner[axis] += 1;
        let c = at(cube, n, corner[0], corner[1], corner[2]);
        let w = f[axis] - if k < 2 { f[order[k + 1]] } else { 0.0 };
        (0..3).for_each(|j| out[j] += w * c[j]);
    }
    out
}

/// A plain, repeatable spread of points (no rand dependency).
fn points(count: usize) -> impl Iterator<Item = [f64; 3]> {
    let mut s: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut next = move || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        (s >> 11) as f64 / (1u64 << 53) as f64
    };
    (0..count).map(move |_| [next(), next(), next()])
}

#[test]
fn the_cube_stays_close_to_the_maths() {
    let n = CUBE_SIZE;
    println!("{n}³ cube vs exact maths, max |Δ| ACEScct, trilinear (CIColorCube) / tetrahedral:");
    println!("  all: the whole 0…1 input cube · picture: above the source's black and inside AP1 (no negative light)");
    for p in PROFILES {
        let j = journey(p).unwrap();
        let cube = bake_cube(p, n).unwrap();
        assert_eq!(cube.len(), n * n * n * 3);
        let floor = match (j.cube_input, j.curve) {
            (CubeInput::Acescct, _) => cst::to_cct(0.001),
            (_, cst::Curve::AppleLog) => 0.1505, // Apple Log's black
            _ => 0.06,
        };
        let black = cst::to_cct(0.0);
        let (mut all, mut pic, mut count) = ([0f64; 2], [0f64; 2], 0);
        for v in points(300_000) {
            let exact = match j.cube_input {
                CubeInput::Code => j.apply(v),
                CubeInput::Acescct => j.apply(v.map(cst::from_cct)),
            };
            let e = [diff(trilinear(&cube, n, v), exact), diff(tetrahedral(&cube, n, v), exact)];
            all = [all[0].max(e[0]), all[1].max(e[1])];
            if v.iter().all(|x| *x >= floor) && exact.iter().all(|x| *x >= black) {
                pic = [pic[0].max(e[0]), pic[1].max(e[1])];
                count += 1;
            }
        }
        println!("{p:14} all {:.1e} / {:.1e} · picture {:.1e} / {:.1e} ({count} points)", all[0], all[1], pic[0], pic[1]);
        // where a cube is said to fit, its own interpolation stays within about a 10-bit code value (CIColorCube adds
        // its ~2e-3 on top); through a gamut wider than AP1 it is off by more, even with the gamut compression
        // smoothing the corners (without it: more than 0.05)
        let wide = j.matrix.is_some_and(|m| m.iter().flatten().any(|x| *x < 0.0));
        if j.cube_fits {
            assert!(pic[0] < 1.5e-3, "{p}: the cube is {} off in the picture", pic[0]);
        }
        if wide {
            assert!(pic[0] > 1.5e-3, "{p}: {} off — would a cube fit now?", pic[0]);
        }
        // the lattice points are the maths exactly
        let v = [16.0 / 64.0, 0.5, 0.75];
        let exact = match j.cube_input {
            CubeInput::Code => j.apply(v),
            CubeInput::Acescct => j.apply(v.map(cst::from_cct)),
        };
        assert!(diff(at(&cube, n, 16, 32, 48), exact) < 1e-6);
    }
}

#[test]
fn rgba_for_core_image() {
    let c = cst::rgba(&bake_cube("rec709", 2).unwrap());
    assert_eq!(c.len(), 8 * 4);
    assert!(c.chunks(4).all(|x| x[3] == 1.0));
}
