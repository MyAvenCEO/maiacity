//! The render's maths without a GPU: the grade (the one place its maths lives: fixed vectors, the viewer's cube), the
//! cut against worker.ts, the frame geometry against picture.mjs, captions' phrases, the loudness meter against the
//! EBU's own test signals (Tech 3341), the 3D LUT.

use serde_json::json;
use vault_render::{
    gpu::geometry,
    grade::{Balance, NEUTRAL, clean_balance, clean_cdl, preset, sat_matrix},
    loudness::{Meter, measure},
    output::{Lut3d, Output},
    timeline::{Clip, ClipFrame, Piece, Timeline, Word, base_name, phrases, pieces, shapes_of},
};

fn close(a: f64, b: f64, eps: f64) -> bool {
    (a - b).abs() <= eps
}

#[test]
fn balance_maths() {
    let b = clean_balance(&json!({ "temp": -0.4, "tint": 0.2, "exposure": 0.7, "contrast": -0.2, "highlights": 0.5, "shadows": -0.6 })).unwrap();
    for (px, want) in [
        ([0.2, 0.3, 0.4], [0.261209014, 0.341209014, 0.439473854]),
        ([0.41, 0.41, 0.41], [0.433852368, 0.433852368, 0.452117209]),
        ([0.7, 0.6, 0.5], [0.68098028, 0.60098028, 0.539245121]),
    ] {
        let got = b.apply(px);
        assert!((0..3).all(|i| close(got[i], want[i], 1e-8)), "{px:?}: {got:?}");
    }
    assert!(clean_balance(&json!({})).is_none());
    assert_eq!(clean_balance(&json!({ "exposure": 9, "temp": "x" })).unwrap().exposure, 4.0);
    assert_eq!(Balance::default().apply([0.2, 0.3, 0.4]), [0.2, 0.3, 0.4]);
    // saturation last, around the pixel's luma; a grey stays grey
    let s = Balance { sat: 0.3, ..b };
    for (px, want) in [
        ([0.2, 0.3, 0.4], [0.240182998, 0.344182998, 0.47192729]),
        ([0.41, 0.41, 0.41], [0.433456752, 0.433456752, 0.457201044]),
        ([0.7, 0.6, 0.5], [0.701215064, 0.597215064, 0.516959356]),
    ] {
        let got = s.apply(px);
        assert!((0..3).all(|i| close(got[i], want[i], 1e-8)), "{px:?}: {got:?}");
    }
    let grey = Balance { sat: 0.8, ..Default::default() }.apply([0.3; 3]);
    assert!(grey.iter().all(|x| close(*x, 0.3, 1e-12)), "{grey:?}");
    assert_eq!(clean_balance(&json!({ "sat": 3 })).unwrap().sat, 1.0);
}

#[test]
fn linear_balance_is_a_gain_in_light() {
    use vault_media::cst::{from_cct, to_cct};
    let log = Balance { temp: 0.53, tint: -0.15, exposure: 0.6, contrast: 0.15, highlights: -0.4, shadows: -0.3, sat: 0.1, linear: false };
    let lin = Balance { linear: true, ..log };
    // above the toe (ACEScct 0.155) a gain is the log offset exactly: the same numbers, the same picture
    for px in [[0.2, 0.3, 0.4], [0.41, 0.41, 0.41], [0.7, 0.6, 0.5], [0.9, 0.95, 1.0]] {
        let (a, b) = (log.apply(px), lin.apply(px));
        assert!((0..3).all(|i| close(a[i], b[i], 1e-9)), "{px:?}: {a:?} vs {b:?}");
    }
    // in the toe it scales: black stays black, a shadow is lifted by its gain, not by a fixed amount
    let up = Balance { exposure: 0.6, linear: true, ..Default::default() };
    let black = to_cct(0.0);
    assert!(up.apply([black; 3]).iter().all(|x| close(*x, black, 1e-12)));
    let deep = to_cct(0.002);
    let got = from_cct(up.apply([deep; 3])[0]);
    assert!(close(got, 0.002 * 0.6f64.exp2(), 1e-12), "{got}");
    assert!(Balance { exposure: 0.6, ..Default::default() }.apply([black; 3])[0] > black + 0.03, "the log offset lifts the black");
    // white balance as gains: a neutral black stays neutral
    let warm = Balance { temp: 0.8, tint: -0.3, linear: true, ..Default::default() }.apply([black; 3]);
    assert!(warm.iter().all(|x| close(*x, black, 1e-12)), "{warm:?}");
    // linear and nothing else changes nothing; the flag survives the checks
    assert!(Balance { linear: true, ..Default::default() }.is_neutral());
    assert!(clean_balance(&json!({ "linear": true })).is_none());
    assert!(clean_balance(&json!({ "linear": true, "exposure": 0.3 })).unwrap().linear);
    assert!(!clean_balance(&json!({ "exposure": 0.3 })).unwrap().linear);
    assert_eq!(serde_json::from_value::<Balance>(json!({ "exposure": 0.3 })).unwrap().linear, false);
}

#[test]
fn cdl_maths() {
    assert_eq!(preset("neutral").unwrap().apply([0.2, 0.4, 0.6]), [0.2, 0.4, 0.6]);
    let g = clean_cdl(&json!({ "slope": [2, 1, 1], "offset": [0.1, 0, 0], "power": [1, 2, 1], "sat": 1 })).unwrap();
    let [r, gg, _] = g.apply([0.2, 0.5, 0.5]);
    assert!(close(r, 0.5, 1e-12), "{r}");
    assert!(close(gg, 0.25, 1e-12), "{gg}");
    // negatives held at 0 before a power
    let g = clean_cdl(&json!({ "slope": [1, 1, 1], "offset": [-0.5, 0, 0], "power": [2, 1, 1], "sat": 1 })).unwrap();
    assert_eq!(g.apply([0.2, 0.0, 0.0])[0], 0.0);
    // without a power, nothing is held: the log keeps what is below 0 and above 1
    let g = clean_cdl(&json!({ "slope": [1.5, 1, 1], "offset": [-0.2, 0, 0] })).unwrap();
    assert!(close(g.apply([0.1, 1.2, 0.0])[0], -0.05, 1e-12));
    assert!(clean_cdl(&json!({})).is_none());
    assert_eq!(clean_cdl(&json!({ "slope": [9, 1, 1] })).unwrap().slope[0], 4.0);
    assert_eq!(clean_cdl(&json!({ "power": [0, 1, 1] })).unwrap().power[0], 0.1);
    assert!(clean_cdl(&json!(null)).is_none());
    for p in ["neutral", "cold", "dip", "bright", "night", "warm"] {
        let c = preset(p).unwrap();
        assert_eq!(clean_cdl(&c.to_json()).is_none(), c.is_neutral(), "{p}");
    }
    // saturation around Rec.709 luma: a grey stays grey, sat 0 is luma, and the matrix is the same maths
    let cold = preset("cold").unwrap();
    let grey = cold.apply([0.4, 0.4, 0.4]);
    let lin = [0.4 * 0.97 - 0.004, 0.4 * 0.99, 0.4 * 1.05 + 0.012];
    let m = sat_matrix(0.5);
    for i in 0..3 {
        let want: f64 = (0..3).map(|j| m[i][j] * lin[j]).sum();
        assert!(close(grey[i], want, 1e-12));
    }
    let bw = vault_render::grade::Cdl { sat: 0.0, ..NEUTRAL }.apply([1.0, 0.0, 0.0]);
    assert!(bw.iter().all(|x| close(*x, 0.2126, 1e-12)));
    // warm (a hand-worked vector): slope, offset, then sat 1.06 around luma
    let w = preset("warm").unwrap().apply([0.5, 0.4, 0.3]);
    let v = [0.5 * 1.05 + 0.006, 0.4 + 0.002, 0.3 * 0.93 - 0.004];
    let l = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    for i in 0..3 {
        assert!(close(w[i], l + 1.06 * (v[i] - l), 1e-12));
    }
}

#[test]
fn the_shapes_a_timeline_is_delivered_in() {
    // 16:9, 9:16, 1:1 and the timeline's own
    let t: Timeline = serde_json::from_value(json!({ "id": "t", "aspect": "4:5", "clips": [] })).unwrap();
    assert_eq!(shapes_of(&t).iter().map(|s| s.aspect).collect::<Vec<_>>(), ["16:9", "9:16", "1:1", "4:5"]);
    let t: Timeline = serde_json::from_value(json!({ "id": "t", "aspect": "9:16", "clips": [] })).unwrap();
    assert_eq!(shapes_of(&t).len(), 3);
    assert_eq!(shapes_of(&t)[0].render_size(), (3840, 2160));
}

fn clip(id: &str, start: f64, dur: f64) -> Clip {
    serde_json::from_value(json!({ "id": id, "track": "V1", "start": start, "in": 0, "dur": dur, "vol": 1, "hash": id })).unwrap()
}

#[test]
fn the_cut_as_the_worker_cuts_it() {
    // a gap, an overlap (the later clip on top), clip edges between frames
    let a = clip("a", 0.0, 2.0);
    let b = clip("b", 1.5, 1.0); // over a from 1.5 to 2.5
    let c = clip("c", 3.0, 1.01); // a gap 2.5–3.0; ends between frames (4.01 s → frame 120)
    let pics = [&a, &b, &c];
    let p = pieces(&pics, 4.01);
    assert_eq!(
        p,
        vec![
            Piece { clip: Some(0), a: 0, b: 45 },
            Piece { clip: Some(1), a: 45, b: 75 },
            Piece { clip: None, a: 75, b: 90 },
            Piece { clip: Some(2), a: 90, b: 120 },
        ]
    );
    // one clip split by nothing stays one piece
    let long = clip("x", 0.0, 10.0);
    assert_eq!(pieces(&[&long], 10.0), vec![Piece { clip: Some(0), a: 0, b: 300 }]);
}

#[test]
fn geometry_as_picture_mjs() {
    // 4K into 1080 portrait: cover by height, the middle
    let g = geometry(3840.0, 2160.0, 1080, 1920, None);
    assert_eq!((g.w, g.h, g.x, g.y), (3414, 1920, 1167, 0));
    // reframed to the left edge, zoomed
    let f = ClipFrame { x: Some(-1.0), y: Some(0.5), zoom: Some(1.5) };
    let g = geometry(1920.0, 1080.0, 1920, 1080, Some(&f));
    assert_eq!((g.w, g.h), (2880, 1620));
    assert_eq!((g.x, g.y), (0, 405));
    // the same frame: nothing to do
    let g = geometry(3840.0, 2160.0, 3840, 2160, None);
    assert_eq!((g.w, g.h, g.x, g.y), (3840, 2160, 0, 0));
}

#[test]
fn phrases_as_the_worker_breaks_them() {
    let t: Timeline = serde_json::from_value(json!({ "id": "t", "clips": [
        { "id": "v", "track": "A1", "start": 10, "in": 1, "dur": 5, "vol": 1, "hash": "voice" }
    ] }))
    .unwrap();
    let words = |_: &Clip| -> Vec<Word> {
        [("skipped", 0.5, 0.9), ("Hello", 1.0, 1.2), ("there,", 1.3, 1.5), ("my", 1.6, 1.7), ("friend.", 1.8, 2.1), ("Here", 2.2, 2.4), ("it", 2.5, 2.6), ("goes:", 2.7, 3.0), ("late", 6.5, 6.8)]
            .iter()
            .map(|(w, s, e)| Word { word: w.to_string(), start: *s, end: *e })
            .collect()
    };
    let p = phrases(&t, &words);
    assert_eq!(p.iter().map(|x| x.text.as_str()).collect::<Vec<_>>(), ["Hello there, my friend.", "Here it goes:"]);
    assert!(close(p[0].start, 10.0, 1e-9) && close(p[0].end, 11.1, 1e-9));
    let t2: Timeline = serde_json::from_value(json!({ "id": "t", "project": "Day 19", "variant": "Reel", "clips": [] })).unwrap();
    // 2026-09-30 01:02 UTC
    assert_eq!(base_name(&t2, 1_790_730_120), "day-19-reel-202609300102");
}

fn sine(freq: f64, amp: f64, seconds: f64, rate: u32, phase: f64) -> Vec<f32> {
    let n = (seconds * rate as f64) as usize;
    let mut out = Vec::with_capacity(n * 2);
    for i in 0..n {
        let v = (amp * (2.0 * std::f64::consts::PI * freq * i as f64 / rate as f64 + phase).sin()) as f32;
        out.push(v);
        out.push(v);
    }
    out
}

fn db(x: f64) -> f64 {
    10f64.powf(x / 20.0)
}

#[test]
fn loudness_ebu_tech_3341() {
    // case 1: a stereo 1 kHz sine at −23 dBFS reads −23.0 LUFS (±0.1)
    let l = measure(&sine(1000.0, db(-23.0), 20.0, 48_000, 0.0), 48_000, 2);
    assert!(close(l.lufs.unwrap(), -23.0, 0.1), "{l:?}");
    // case 2: at −33 dBFS, −33.0
    let l = measure(&sine(1000.0, db(-33.0), 20.0, 48_000, 0.0), 48_000, 2);
    assert!(close(l.lufs.unwrap(), -33.0, 0.1), "{l:?}");
    // case 3: −36 / −23 / −36 dBFS for 10 / 60 / 10 s — the relative gate leaves −23.0
    let mut m = Meter::new(48_000, 2);
    m.push(&sine(1000.0, db(-36.0), 10.0, 48_000, 0.0));
    m.push(&sine(1000.0, db(-23.0), 60.0, 48_000, 0.0));
    m.push(&sine(1000.0, db(-36.0), 10.0, 48_000, 0.0));
    assert!(close(m.result().lufs.unwrap(), -23.0, 0.1), "{:?}", m.result());
    // case 5: −26 / −20 / −26 dBFS for 20 / 20.1 / 20 s — −23.0
    let mut m = Meter::new(48_000, 2);
    m.push(&sine(1000.0, db(-26.0), 20.0, 48_000, 0.0));
    m.push(&sine(1000.0, db(-20.0), 20.1, 48_000, 0.0));
    m.push(&sine(1000.0, db(-26.0), 20.0, 48_000, 0.0));
    assert!(close(m.result().lufs.unwrap(), -23.0, 0.1), "{:?}", m.result());
    // the same at 44.1 kHz (the K-weighting derived for the rate)
    let l = measure(&sine(1000.0, db(-23.0), 20.0, 44_100, 0.0), 44_100, 2);
    assert!(close(l.lufs.unwrap(), -23.0, 0.1), "{l:?}");
    // silence: nothing to measure
    assert_eq!(measure(&vec![0.0; 96_000], 48_000, 2).lufs, None);
}

#[test]
fn loudness_range_ebu_tech_3342() {
    // Tech 3342 case 1: −20 then −30 dBFS, 20 s each: LRA 10 LU (±1)
    let mut m = Meter::new(48_000, 2);
    m.push(&sine(1000.0, db(-20.0), 20.0, 48_000, 0.0));
    m.push(&sine(1000.0, db(-30.0), 20.0, 48_000, 0.0));
    assert!(close(m.result().lra.unwrap(), 10.0, 1.0), "{:?}", m.result());
    // case 2: −20 then −15: 5 LU
    let mut m = Meter::new(48_000, 2);
    m.push(&sine(1000.0, db(-20.0), 20.0, 48_000, 0.0));
    m.push(&sine(1000.0, db(-15.0), 20.0, 48_000, 0.0));
    assert!(close(m.result().lra.unwrap(), 5.0, 1.0), "{:?}", m.result());
}

#[test]
fn true_peak_between_samples() {
    // a sine at a quarter of the rate, 45° off the samples: every sample is 3 dB under the peak between them
    let s = sine(12_000.0, 0.5, 2.0, 48_000, std::f64::consts::FRAC_PI_4);
    let l = measure(&s, 48_000, 2);
    assert!(close(l.sample_peak.unwrap(), 20.0 * (0.5f64 * 0.5f64.sqrt()).log10(), 0.01), "{l:?}");
    assert!(close(l.true_peak.unwrap(), 20.0 * 0.5f64.log10(), 0.2), "{l:?}");
    // an ordinary 1 kHz sine: the true peak is its amplitude
    let l = measure(&sine(997.0, db(-6.0), 2.0, 48_000, 0.3), 48_000, 2);
    assert!(close(l.true_peak.unwrap(), -6.0, 0.05), "{l:?}");
}

#[test]
fn lut3d_tetrahedral() {
    let id = Lut3d::identity(17);
    for rgb in [[0.0, 0.0, 0.0], [0.13, 0.77, 0.5], [1.0, 0.2, 0.93], [0.999, 0.001, 0.5]] {
        let o = id.apply(rgb);
        for i in 0..3 {
            assert!(close(o[i], rgb[i], 1e-6), "{rgb:?} → {o:?}");
        }
    }
    // clamped outside 0…1
    assert_eq!(id.apply([-0.5, 1.5, 0.5]).map(|x| (x * 1e6).round() / 1e6), [0.0, 1.0, 0.5]);
    // a curve is carried within the lattice's error
    let f = |v: [f64; 3]| v.map(|x| x.powf(1.0 / 2.4));
    let lut = Lut3d::bake("gamma", 65, f);
    let got = lut.apply([0.3, 0.6, 0.9]);
    let want = f([0.3, 0.6, 0.9]);
    for i in 0..3 {
        assert!(close(got[i], want[i], 2e-4), "{got:?} vs {want:?}");
    }
    // a .cube round trip
    let dir = std::env::temp_dir().join(format!("vault-render-cube-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("g.cube");
    let mut text = String::from("TITLE \"g\"\nLUT_3D_SIZE 5\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n");
    let small = Lut3d::bake("gamma", 5, f);
    for c in small.data.chunks(3) {
        text += &format!("{} {} {}\n", c[0], c[1], c[2]);
    }
    std::fs::write(&file, text).unwrap();
    let back = Lut3d::from_cube_file("odt", &file).unwrap();
    assert_eq!(back.data, small.data);
    assert_eq!(back.hash(), small.hash());
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn the_viewer_s_cube_is_the_grade() {
    use vault_render::grade::{PRESETS, cube};
    let b = Balance { temp: 0.35, tint: -0.1, exposure: 0.6, contrast: 0.15, highlights: -0.4, shadows: 0.2, sat: 0.25, linear: false };
    let g = [preset("warm").unwrap()];
    let n = 33;
    let c = cube(Some(&b), &g, n);
    assert_eq!(c.len(), n * n * n * 3);
    // on its nodes, exactly the maths (red fastest)
    let (r, gg, bl) = (5, 17, 30);
    let at = |i: usize| i as f64 / (n - 1) as f64;
    let want = g[0].apply(b.apply([at(r), at(gg), at(bl)]));
    let i = ((bl * n + gg) * n + r) * 3;
    assert!((0..3).all(|k| (c[i + k] as f64 - want[k]).abs() < 1e-6));
    // between them, trilinear, within a thousandth of the maths over the working range
    let lut = vault_render::Lut3d::from_rgb("grade", n, c).unwrap();
    let mut worst: f64 = 0.0;
    for k in 0..2000 {
        let t = k as f64 / 2000.0;
        let px = [0.1 + 0.8 * t, 0.1 + 0.8 * ((t * 7.3) % 1.0), 0.1 + 0.8 * ((t * 3.7) % 1.0)];
        let want = g[0].apply(b.apply(px));
        let got = lut.sample(px);
        worst = worst.max((0..3).map(|k| (got[k] - want[k]).abs()).fold(0.0, f64::max));
    }
    assert!(worst < 1e-3, "off by {worst}");
    // no grade: the identity
    let id = cube(None, &[], 3);
    assert_eq!(&id[..6], &[0.0, 0.0, 0.0, 0.5, 0.0, 0.0]);
    assert!(PRESETS.iter().all(|(p, _)| preset(p).is_some()));
}

