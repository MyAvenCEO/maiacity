//! Secondaries and finishing on the GPU (creative.rs, the `CREATIVE_KERNELS`): what each does where, and where not.

use serde_json::json;
use vault_render::{
    Lut3d,
    creative::{Finish, apply_finish, apply_secondaries, clean_finish, clean_secondaries},
    gpu::Gpu,
    grade::STOP,
};

const W: u32 = 64;
const H: u32 = 36;

fn gpu() -> Gpu {
    let mut g = Gpu::new().unwrap();
    g.set_output(&Lut3d::from_rgb("odt", 33, vault_media::aces2::bake_cube(33)).unwrap());
    g
}

fn picture(g: &Gpu, f: impl Fn(u32, u32) -> [f32; 3]) -> vault_render::gpu::Image {
    let mut px = Vec::with_capacity((W * H * 4) as usize);
    for y in 0..H {
        for x in 0..W {
            px.extend(f(x, y));
            px.push(1.0);
        }
    }
    g.from_rgba(&px, W, H)
}

/// the pixel at (x, y) from the top left
fn at(g: &Gpu, img: &vault_render::gpu::Image, x: u32, y: u32) -> [f32; 3] {
    let px = g.read(img, W, H);
    // read gives the rows from the bottom (Core Image's), as from_rgba took them
    let i = ((y * W + x) * 4) as usize;
    [px[i], px[i + 1], px[i + 2]]
}

#[test]
fn a_window_lifts_only_inside_itself() {
    let g = gpu();
    let grey = picture(&g, |_, _| [0.4; 3]);
    let secs = clean_secondaries(&json!([{ "window": { "shape": "ellipse", "x": 0.5, "y": 0.5, "w": 0.4, "h": 0.5, "feather": 0.2 }, "adjust": { "exposure": 1 } }]));
    assert_eq!(secs.len(), 1);
    let out = apply_secondaries(&g, &grey, &secs, None, W as f64, H as f64).unwrap();
    let (mid, corner) = (at(&g, &out, W / 2, H / 2), at(&g, &out, 1, 1));
    assert!((mid[0] - (0.4 + STOP as f32)).abs() < 2e-3, "inside {mid:?}");
    assert!((corner[0] - 0.4).abs() < 1e-4, "outside {corner:?}");
}

#[test]
fn a_key_takes_only_its_hue() {
    let g = gpu();
    // left: foliage green; right: a warm skin tone
    let pic = picture(&g, |x, _| if x < W / 2 { [0.36, 0.46, 0.34] } else { [0.47, 0.425, 0.395] });
    let secs = clean_secondaries(&json!([{ "key": { "hue": [123, 50], "sat": [1, 100], "luma": [10, 90], "soft": 0.3 }, "adjust": { "sat": 0.5 } }]));
    let out = apply_secondaries(&g, &pic, &secs, None, W as f64, H as f64).unwrap();
    let (green, skin) = (at(&g, &out, 4, H / 2), at(&g, &out, W - 4, H / 2));
    assert!((green[1] - 0.46).abs() < 1e-3, "green untouched {green:?}");
    assert!(skin[0] - skin[2] > 0.075 * 1.3, "skin more saturated {skin:?}");
}

#[test]
fn the_finishing_does_what_it_says_and_only_there() {
    let g = gpu();
    // grey, with one small bright spot
    let pic = picture(&g, |x, y| if (x as i32 - 32).abs() < 2 && (y as i32 - 18).abs() < 2 { [0.9; 3] } else { [0.4; 3] });
    let f: Finish = clean_finish(&json!({ "vignette": { "amount": 1, "size": 0.6, "softness": 0.3 } })).unwrap();
    let out = apply_finish(&g, &pic, &f, 0, H as f64).unwrap();
    assert!((at(&g, &out, 26, 18)[0] - 0.4).abs() < 0.02, "the middle keeps its level: {:?}", at(&g, &out, 26, 18));
    assert!(at(&g, &out, 0, 0)[0] < 0.4 - STOP as f32, "a corner a stop darker or more: {:?}", at(&g, &out, 0, 0));
    // halation: red around the spot, more than green
    let f = clean_finish(&json!({ "halation": { "amount": 1, "threshold": 0.5, "radius": 60 } })).unwrap();
    let out = apply_finish(&g, &pic, &f, 0, H as f64).unwrap();
    let near = at(&g, &out, 36, 18);
    // (in the log: red rises most, then green, blue least — red-orange)
    assert!(near[0] > 0.41 && near[0] > near[1] && near[1] > near[2], "halation near the spot {near:?}");
    let far = at(&g, &out, 2, 2);
    assert!((far[0] - 0.4).abs() < 0.01, "and not far from it {far:?}");
    // grain: about zero on average, each pixel moved
    let f = clean_finish(&json!({ "grain": { "amount": 0.5 } })).unwrap();
    let out = apply_finish(&g, &picture(&g, |_, _| [0.4; 3]), &f, 7, H as f64).unwrap();
    let px = g.read(&out, W, H);
    let mean = px.chunks(4).map(|p| p[1] as f64).sum::<f64>() / (W * H) as f64;
    let moved = px.chunks(4).filter(|p| (p[1] - 0.4).abs() > 1e-4).count();
    assert!((mean - 0.4).abs() < 0.003 && moved as f64 > 0.9 * (W * H) as f64, "mean {mean}, moved {moved}");
}

#[test]
fn secondaries_and_finishing_as_data() {
    assert!(clean_secondaries(&json!([{ "adjust": {} }])).is_empty());
    let s = clean_secondaries(&json!([{ "window": { "shape": "star", "w": 9, "track": "hand" }, "adjust": { "exposure": 0.3 }, "mix": 3 }]));
    let w = s[0].window.as_ref().unwrap();
    assert_eq!((w.shape.as_str(), w.w, w.track.clone(), s[0].mix), ("ellipse", 4.0, None, 1.0));
    assert!(clean_finish(&json!({ "grain": { "amount": 0 } })).is_none());
    assert_eq!(clean_finish(&json!({ "pop": { "amount": 5 } })).unwrap().pop.unwrap().amount, 1.0);
}
