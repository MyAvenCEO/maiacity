//! aces2.rs against OpenColorIO 2.5.2 itself (tests/aces2_reference.txt: the ACES studio config's ACEScct → "Rec.1886
//! Rec.709 - Display" / "ACES 2.0 - SDR 100 nits (Rec.709)", on a neutral ramp, random colours and cube nodes), and —
//! when it is on this machine — against the 129³ LUT the render worker baked with OCIO (`cargo test -p vault-media
//! --release --test aces2 -- --ignored`). Errors in 10-bit code values.

use vault_media::aces2::{OutputTransform, bake_cube};

/// input ACEScct, OCIO's display code values
type Row = ([f64; 3], [f64; 3]);

fn reference() -> Vec<Row> {
    include_str!("aces2_reference.txt")
        .lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .map(|l| {
            let v: Vec<f64> = l.split_whitespace().map(|x| x.parse().unwrap()).collect();
            ([v[0], v[1], v[2]], [v[3], v[4], v[5]])
        })
        .collect()
}

/// The largest channel difference, in 10-bit code values.
fn code_values(a: [f64; 3], b: [f64; 3]) -> f64 {
    (0..3).map(|i| (a[i] - b[i]).abs() * 1023.0).fold(0.0, f64::max)
}

/// max, p99, median of a set of errors
fn spread(mut e: Vec<f64>) -> [f64; 3] {
    e.sort_by(f64::total_cmp);
    let at = |q: f64| e[((e.len() - 1) as f64 * q).round() as usize];
    [at(1.0), at(0.99), at(0.5)]
}

#[test]
fn matches_ocio() {
    let t = OutputTransform::sdr_rec709();
    let rows = reference();
    assert!(rows.len() > 3000);
    let errors: Vec<f64> = rows.iter().map(|(i, o)| code_values(t.apply(*i), *o)).collect();
    let [max, p99, median] = spread(errors);
    println!(
        "{} points vs OCIO 2.5.2, 10-bit code values: max {max:.3} · p99 {p99:.3} · median {median:.4}",
        rows.len()
    );
    // measured: max 0.068 · p99 0.008 · median 0.0065 (OCIO's f32 white is 1.0000063)
    assert!(median < 0.02, "median {median}");
    assert!(p99 < 0.05, "p99 {p99}");
    assert!(max < 0.25, "max {max}");
}

#[test]
fn greys_stay_grey_and_land_where_aces_puts_them() {
    let t = OutputTransform::sdr_rec709();
    // black is black, the top of ACEScct (222 linear) is display white
    assert_eq!(t.apply([0.0; 3]), [0.0; 3]);
    assert!(t.apply([1.0; 3]).iter().all(|v| (v - 1.0).abs() < 1e-4));
    // 18 % grey → 10 cd/m² on the screen (the tone scale's 10.013 less its flare), BT.1886 code 0.1^(1/2.4) = 0.3831
    let grey = t.apply([vault_media::cst::to_cct(0.18); 3]);
    assert!(grey.iter().all(|v| (v.powf(2.4) * 100.0 - 10.0).abs() < 0.01), "{grey:?}");
    for i in 0..=20 {
        let v = t.apply([i as f64 / 20.0; 3]);
        assert!((v[0] - v[1]).abs() < 1e-9 && (v[1] - v[2]).abs() < 1e-9, "{v:?}");
    }
}

#[test]
fn the_cube_is_the_maths_at_its_nodes() {
    let t = OutputTransform::sdr_rec709();
    let n = 9;
    let cube = bake_cube(n);
    assert_eq!(cube.len(), n * n * n * 3);
    let (r, g, b) = (2, 5, 7);
    let i = 3 * (r + n * (g + n * b));
    let exact = t.apply([r, g, b].map(|x| x as f64 / (n - 1) as f64));
    assert!((0..3).all(|c| (cube[i + c] as f64 - exact[c]).abs() < 1e-6));
    assert!(cube.iter().all(|v| (0.0..=1.0).contains(v)));
}

/// The worker's baked 129³ `odt-rec709` LUT (bake.py → ~/.cache/maiacity/luts/<hash>.cube, or MAIACITY_ODT_LUT),
/// compared at every one of its own nodes: no interpolation between them.
#[test]
#[ignore = "needs the worker's baked LUT on this machine; run with --release -- --ignored"]
fn matches_the_workers_lut() {
    let path = std::env::var("MAIACITY_ODT_LUT").unwrap_or_else(|_| {
        let dir = std::path::Path::new(&std::env::var("HOME").unwrap()).join(".cache/maiacity/luts");
        std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.path()))
            .find(|p| std::fs::read_to_string(p).is_ok_and(|s| s.starts_with("TITLE \"odt-rec709\"")))
            .expect("no odt-rec709 .cube in ~/.cache/maiacity/luts")
            .to_string_lossy()
            .into_owned()
    });
    let text = std::fs::read_to_string(&path).unwrap();
    let n: usize = text.lines().find_map(|l| l.strip_prefix("LUT_3D_SIZE ")).unwrap().trim().parse().unwrap();
    let rows: Vec<[f64; 3]> = text
        .lines()
        .filter(|l| l.starts_with(|c: char| c.is_ascii_digit() || c == '-'))
        .map(|l| {
            let v: Vec<f64> = l.split_whitespace().map(|x| x.parse().unwrap()).collect();
            [v[0], v[1], v[2]]
        })
        .collect();
    assert_eq!(rows.len(), n * n * n);
    let t = OutputTransform::sdr_rec709();
    let mine = t.cube(n);
    let mut errors = Vec::with_capacity(rows.len());
    let mut worst = (0.0, 0);
    for (i, want) in rows.iter().enumerate() {
        let got = [mine[3 * i] as f64, mine[3 * i + 1] as f64, mine[3 * i + 2] as f64];
        let e = code_values(got, *want);
        if e > worst.0 {
            worst = (e, i);
        }
        if e > 0.5 {
            let at = [i % n, (i / n) % n, i / (n * n)].map(|x| x as f64 / (n - 1) as f64);
            println!("  {e:.2} at ACEScct {at:?}: mine {got:?} · OCIO {want:?}");
        }
        errors.push(e);
    }
    let over = |x: f64| errors.iter().filter(|e| **e > x).count();
    let (o1, o05) = (over(1.0), over(0.5));
    let [max, p99, median] = spread(errors);
    let node = |i: usize| [i % n, (i / n) % n, i / (n * n)].map(|x| x as f64 / (n - 1) as f64);
    println!(
        "{path}: {n}³ nodes, 10-bit code values: max {max:.3} · p99 {p99:.3} · median {median:.4} · {o05} over 0.5 · {o1} over 1"
    );
    println!("  worst at ACEScct {:?}: mine {:?} · OCIO {:?}", node(worst.1), t.apply(node(worst.1)), rows[worst.1]);
    // measured on the 129³ LUT: p99 0.008 · median 0.0064; six nodes over 0.5 — five where a channel ends within 1e-7
    // of linear black and BT.1886's root blows f32 noise up to ~1 code value, and one ([0.961, 0.969, 0.836]) where
    // OCIO's f32 tone scale lands exactly on J = 100 and its gamut compression returns NaN, which the clamp makes black
    assert!(median < 0.02 && p99 < 0.05, "median {median} · p99 {p99}");
    assert!(o05 <= 10, "{o05} nodes over half a code value");
}
