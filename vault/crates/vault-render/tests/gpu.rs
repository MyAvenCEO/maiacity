//! The picture path on the GPU against the same maths on the CPU: the output transform's 3D LUT, the CDL, a journey
//! into ACEScct, the frame geometry, and the captions drawn.

use vault_render::{
    captions::Captions,
    gpu::{Extent, Gpu},
    grade::preset,
    output::Lut3d,
    timeline::ClipFrame,
};

/// A few hundred test colours, inside and a little outside 0…1.
fn colours() -> Vec<[f64; 3]> {
    let mut out = Vec::new();
    let mut s = 12345u64;
    let mut rnd = || {
        s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((s >> 11) as f64 / (1u64 << 53) as f64) * 1.2 - 0.1
    };
    for _ in 0..256 {
        out.push([rnd(), rnd(), rnd()]);
    }
    out.extend([[0.0, 0.0, 0.0], [1.0, 1.0, 1.0], [0.5, 0.5, 0.5], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]);
    out
}

/// The colours as a 16-pixel-wide picture, and back.
fn through(gpu: &Gpu, px: &[[f64; 3]], f: impl Fn(&Gpu, &objc2_core_image::CIImage) -> vault_render::gpu::Image) -> Vec<[f64; 3]> {
    let w = 16u32;
    let h = px.len().div_ceil(16) as u32;
    let mut rgba = vec![0f32; (w * h * 4) as usize];
    for (i, p) in px.iter().enumerate() {
        rgba[i * 4..i * 4 + 3].copy_from_slice(&p.map(|x| x as f32));
        rgba[i * 4 + 3] = 1.0;
    }
    let img = gpu.from_rgba(&rgba, w, h);
    let out = gpu.read(&f(gpu, &img), w, h);
    // read() gives the top row first, as from_rgba takes it
    (0..px.len()).map(|i| [out[i * 4] as f64, out[i * 4 + 1] as f64, out[i * 4 + 2] as f64]).collect()
}

fn max_diff(a: &[[f64; 3]], b: &[[f64; 3]]) -> f64 {
    a.iter().zip(b).flat_map(|(x, y)| (0..3).map(move |i| (x[i] - y[i]).abs())).fold(0.0, f64::max)
}

#[test]
fn output_lut_on_the_gpu_is_the_cpu_lut() {
    let mut gpu = Gpu::new().unwrap();
    let px = colours();
    // an asymmetric cube: a wrong slice, row or column shows at once
    let lut = Lut3d::bake("test", 33, |[r, g, b]| [r * r, 0.25 + 0.5 * g, b.powf(0.7) * 0.9 + 0.05 * r]);
    gpu.set_output(&lut);
    let got = through(&gpu, &px, |g, i| g.output(i).unwrap());
    let want: Vec<[f64; 3]> = px.iter().map(|p| lut.sample(*p)).collect();
    let d = max_diff(&got, &want);
    assert!(d < 2e-5, "GPU LUT off by {d}");
    // the placeholder output transform changes nothing (inside 0…1)
    gpu.set_output(&Lut3d::identity(129));
    let inside: Vec<[f64; 3]> = px.iter().map(|p| p.map(|x| x.clamp(0.0, 1.0))).collect();
    let got = through(&gpu, &inside, |g, i| g.output(i).unwrap());
    assert!(max_diff(&got, &inside) < 2e-5);
}

#[test]
fn cdl_on_the_gpu_is_color_js() {
    let gpu = Gpu::new().unwrap();
    let px = colours();
    for name in ["cold", "dip", "bright", "night", "warm"] {
        let g = preset(name).unwrap();
        let got = through(&gpu, &px, |gp, i| gp.cdl(i, Some(&g)).unwrap());
        let want: Vec<[f64; 3]> = px.iter().map(|p| g.apply(*p)).collect();
        let d = max_diff(&got, &want);
        assert!(d < 2e-5, "{name}: off by {d}");
    }
}

#[test]
fn journey_on_the_gpu_is_cst() {
    let gpu = Gpu::new().unwrap();
    let px: Vec<[f64; 3]> = colours().into_iter().map(|p| p.map(|x| x.clamp(0.0, 1.0))).collect();
    for profile in ["apple-log-2", "rec709", "srgb", "hlg"] {
        let j = vault_media::cst::journey(profile).unwrap();
        let got = through(&gpu, &px, |g, i| g.journey(i, j.kernel_args()).unwrap());
        let want: Vec<[f64; 3]> = px.iter().map(|p| j.apply(*p)).collect();
        let d = max_diff(&got, &want);
        assert!(d < 5e-5, "{profile}: off by {d}");
    }
}

#[test]
fn frame_geometry_crops_where_the_reframing_says() {
    let gpu = Gpu::new().unwrap();
    // a 64×32 picture: left half red, right half blue; the top row green
    let (w, h) = (64u32, 32u32);
    let mut rgba = vec![0f32; (w * h * 4) as usize];
    for y in 0..h {
        for x in 0..w {
            let i = ((y * w + x) * 4) as usize;
            let c = if y == 0 { [0.0, 1.0, 0.0] } else if x < w / 2 { [1.0, 0.0, 0.0] } else { [0.0, 0.0, 1.0] };
            rgba[i..i + 3].copy_from_slice(&c);
            rgba[i + 3] = 1.0;
        }
    }
    let img = gpu.from_rgba(&rgba, w, h);
    // a square from the far left: all red
    let left = gpu.frame_to(&img, 32, 32, Some(&ClipFrame { x: Some(-1.0), y: None, zoom: None })).unwrap();
    assert_eq!((left.ext().size.width, left.ext().size.height), (32.0, 32.0));
    let px = gpu.read(&left, 32, 32);
    assert!(px[(16 * 32 + 16) * 4] > 0.99 && px[(16 * 32 + 16) * 4 + 2] < 0.01, "{:?}", &px[(16 * 32 + 16) * 4..][..4]);
    // from the far right: all blue, and the top row stays on top
    let right = gpu.frame_to(&img, 32, 32, Some(&ClipFrame { x: Some(1.0), y: None, zoom: None })).unwrap();
    let px = gpu.read(&right, 32, 32);
    assert!(px[(16 * 32 + 16) * 4 + 2] > 0.99);
    assert!(px[16 * 4 + 1] > 0.99, "the top row: {:?}", &px[16 * 4..][..4]);
}

#[test]
fn turned_upright_by_the_track() {
    let gpu = Gpu::new().unwrap();
    // 4×2, the top row green, the rest red
    let (w, h) = (4u32, 2u32);
    let rgba: Vec<f32> = (0..w * h).flat_map(|i| if i < w { [0.0, 1.0, 0.0, 1.0] } else { [1.0, 0.0, 0.0, 1.0] }).collect();
    let img = gpu.from_rgba(&rgba, w, h);
    // an iPhone portrait clip: 90° clockwise (top-down coordinates, as AVFoundation gives it)
    let t = objc2_core_foundation::CGAffineTransform { a: 0.0, b: 1.0, c: -1.0, d: 0.0, tx: h as f64, ty: 0.0 };
    let up = gpu.orient(&img, t);
    assert_eq!((up.ext().origin.x, up.ext().origin.y, up.ext().size.width, up.ext().size.height), (0.0, 0.0, 2.0, 4.0));
    let px = gpu.read(&up, 2, 4);
    for row in 0..4 {
        // the top row is now the right-hand column
        assert!(px[(row * 2 + 1) * 4 + 1] > 0.99 && px[(row * 2) * 4] > 0.99, "row {row}: {:?}", &px[row * 8..row * 8 + 8]);
    }
    // upside down (180°): the top row at the bottom
    let t = objc2_core_foundation::CGAffineTransform { a: -1.0, b: 0.0, c: 0.0, d: -1.0, tx: w as f64, ty: h as f64 };
    let px = gpu.read(&gpu.orient(&img, t), w, h);
    assert!(px[(4 + 1) * 4 + 1] > 0.99 && px[4] > 0.99);
}

#[test]
fn captions_render() {
    let caps = Captions::new(None).unwrap();
    assert_eq!(caps.face_name, "Fraunces");
    let gpu = Gpu::new().unwrap();
    for (w, h) in [(1920u32, 1080u32), (1080, 1920), (3840, 2160)] {
        let band = caps.draw("Here it goes: a caption long enough to wrap onto a second line, surely.", w, h).unwrap();
        assert!(band.height > 0 && band.height <= h);
        let img = gpu.cg_image(&band.image);
        let px = gpu.read(&img, w, band.height);
        let (mut white, mut shadow) = (0, 0);
        for p in px.chunks(4) {
            if p[3] > 0.99 && p[0] > 0.99 {
                white += 1;
            } else if p[3] > 0.05 && p[0] < 0.2 {
                shadow += 1;
            }
        }
        assert!(white > 1000, "{w}×{h}: {white} white pixels");
        assert!(shadow > white, "{w}×{h}: {shadow} shadow pixels");
    }
    assert_eq!(Captions::size(1080, 1920), 36.0);
    assert_eq!(Captions::size(3840, 2160), 90.0);
}
