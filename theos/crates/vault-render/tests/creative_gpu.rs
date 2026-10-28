//! Masks and textures on the GPU (tools.rs, the `CREATIVE_KERNELS`): a window and a colour key apply the tools inside
//! them only there, nested they meet; the textures do what they say and only there.

use std::collections::HashMap;

use serde_json::json;
use vault_render::{
    Lut3d,
    gpu::Gpu,
    grade::STOP,
    tools::{Stack, apply, clean_stack, compile, gpu_cubes},
};

const W: u32 = 64;
const H: u32 = 36;

fn odt() -> Lut3d {
    Lut3d::from_rgb("odt", 33, vault_media::aces2::bake_cube(33)).unwrap()
}

fn gpu() -> Gpu {
    let mut g = Gpu::new().unwrap();
    g.set_output(&odt());
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

/// a stack on a picture, as the render runs it
fn run(g: &Gpu, img: &vault_render::gpu::Image, v: serde_json::Value, frame: u64) -> vault_render::gpu::Image {
    let st: Stack = clean_stack(&v).unwrap();
    let out = odt();
    let steps = compile(&[&st], &out);
    let mut cubes = HashMap::new();
    gpu_cubes(g, &steps, &HashMap::new(), &out, &mut cubes).unwrap();
    apply(g, img, &steps, &cubes, W as f64, H as f64, frame, &mut |_, _| Ok(None)).unwrap()
}

#[test]
fn a_window_applies_its_tools_only_inside_itself() {
    let g = gpu();
    let grey = picture(&g, |_, _| [0.4; 3]);
    let out = run(&g, &grey, json!([{ "tool": "window", "shape": "ellipse", "x": 0.5, "y": 0.5, "w": 0.4, "h": 0.5, "feather": 0.2, "tools": [{ "tool": "balance", "exposure": 1 }] }]), 0);
    let (mid, corner) = (at(&g, &out, W / 2, H / 2), at(&g, &out, 1, 1));
    assert!((mid[0] - (0.4 + STOP as f32)).abs() < 2e-3, "inside {mid:?}");
    assert!((corner[0] - 0.4).abs() < 1e-4, "outside {corner:?}");
    // any tool goes in: a contrast inside the window, a colour tool baked into its own cube
    let out = run(&g, &grey, json!([{ "tool": "window", "x": 0.5, "y": 0.5, "w": 0.4, "h": 0.5, "feather": 0.2, "tools": [{ "tool": "cdl", "offset": [0.05, 0.05, 0.05] }] }]), 0);
    assert!((at(&g, &out, W / 2, H / 2)[0] - 0.45).abs() < 3e-3 && (at(&g, &out, 1, 1)[0] - 0.4).abs() < 1e-4);
}

#[test]
fn a_key_takes_only_its_hue_and_nested_in_a_window_only_there() {
    let g = gpu();
    // left: foliage green; right: a warm skin tone
    let pic = picture(&g, |x, _| if x < W / 2 { [0.36, 0.46, 0.34] } else { [0.47, 0.425, 0.395] });
    let key = json!({ "tool": "key", "hue": 123, "width": 50, "sat_lo": 1, "sat_hi": 100, "luma_lo": 10, "luma_hi": 90, "soft": 0.3, "tools": [{ "tool": "balance", "sat": 0.5 }] });
    let out = run(&g, &pic, json!([key.clone()]), 0);
    let (green, skin) = (at(&g, &out, 4, H / 2), at(&g, &out, W - 4, H / 2));
    assert!((green[1] - 0.46).abs() < 1e-3, "green untouched {green:?}");
    assert!(skin[0] - skin[2] > 0.075 * 1.3, "skin more saturated {skin:?}");
    // the same key inside a window over the top half: the skin below it as it was
    let out = run(&g, &pic, json!([{ "tool": "window", "shape": "rect", "x": 0.5, "y": 0.2, "w": 1.2, "h": 0.4, "feather": 0, "tools": [key] }]), 0);
    let (top, bottom) = (at(&g, &out, W - 4, 2), at(&g, &out, W - 4, H - 2));
    assert!(top[0] - top[2] > 0.075 * 1.3, "skin inside the window {top:?}");
    assert!((bottom[0] - 0.47).abs() < 1e-3, "skin outside it {bottom:?}");
}

#[test]
fn the_textures_do_what_they_say_and_only_there() {
    let g = gpu();
    // grey, with one small bright spot
    let pic = picture(&g, |x, y| if (x as i32 - 32).abs() < 2 && (y as i32 - 18).abs() < 2 { [0.9; 3] } else { [0.4; 3] });
    let out = run(&g, &pic, json!([{ "tool": "vignette", "amount": 1, "size": 0.6, "softness": 0.3 }]), 0);
    assert!((at(&g, &out, 26, 18)[0] - 0.4).abs() < 0.02, "the middle keeps its level: {:?}", at(&g, &out, 26, 18));
    assert!(at(&g, &out, 0, 0)[0] < 0.4 - STOP as f32, "a corner a stop darker or more: {:?}", at(&g, &out, 0, 0));
    // halation: red around the spot, more than green
    let out = run(&g, &pic, json!([{ "tool": "halation", "amount": 1, "threshold": 0.5, "radius": 60 }]), 0);
    let near = at(&g, &out, 36, 18);
    // (in the log: red rises most, then green, blue least — red-orange)
    assert!(near[0] > 0.41 && near[0] > near[1] && near[1] > near[2], "halation near the spot {near:?}");
    let far = at(&g, &out, 2, 2);
    assert!((far[0] - 0.4).abs() < 0.01, "and not far from it {far:?}");
    // grain: about zero on average, each pixel moved
    let out = run(&g, &picture(&g, |_, _| [0.4; 3]), json!([{ "tool": "grain", "amount": 0.5 }]), 7);
    let px = g.read(&out, W, H);
    let mean = px.chunks(4).map(|p| p[1] as f64).sum::<f64>() / (W * H) as f64;
    let moved = px.chunks(4).filter(|p| (p[1] - 0.4).abs() > 1e-4).count();
    assert!((mean - 0.4).abs() < 0.003 && moved as f64 > 0.9 * (W * H) as f64, "mean {mean}, moved {moved}");
}

#[test]
fn a_stack_with_a_mask_by_half_is_mixed_on_the_gpu() {
    let g = gpu();
    let grey = picture(&g, |_, _| [0.4; 3]);
    let full = run(&g, &grey, json!([{ "tool": "window", "w": 4, "h": 4, "feather": 0, "tools": [{ "tool": "balance", "exposure": 1 }] }]), 0);
    let half = run(&g, &grey, json!({ "strength": 0.5, "tools": [{ "tool": "window", "w": 4, "h": 4, "feather": 0, "tools": [{ "tool": "balance", "exposure": 1 }] }] }), 0);
    let (f, h) = (at(&g, &full, W / 2, H / 2)[0], at(&g, &half, W / 2, H / 2)[0]);
    assert!((h - (0.4 + (f - 0.4) / 2.0)).abs() < 1e-3, "half of {f} is {h}");
}
