//! The colour tools (tools.rs, their maths creative.rs): what each does to a picture as the display shows it, the
//! cube they bake into, the stacks as data, and which stacks a clip goes through.

use std::collections::HashMap;

use serde_json::json;
use vault_render::{
    Lut3d, Output,
    creative::Hues,
    grade::PIVOT,
    look::Disp,
    timeline::Timeline,
    tools::{Stack, Tool, bake, clean_stack, colour, compile, runs},
};

fn odt() -> Lut3d {
    Lut3d::from_rgb("odt-rec709", 33, vault_media::aces2::bake_cube(33)).unwrap()
}

fn stack(v: serde_json::Value) -> Stack {
    clean_stack(&v).expect("a stack with a tool")
}

/// a stack's colour on one pixel
fn on(st: &Stack, p: [f64; 3], hues: &Hues, out: &Lut3d) -> [f64; 3] {
    colour(st, p, hues, out, &HashMap::new())
}

fn shown(out: &Lut3d, p: [f64; 3]) -> Disp {
    Disp::of(out.apply(p))
}

fn hue_gap(a: f64, b: f64) -> f64 {
    ((a - b + 540.0).rem_euclid(360.0) - 180.0).abs()
}

#[test]
fn a_stack_as_data() {
    assert!(clean_stack(&json!({ "tools": [] })).is_none());
    assert!(clean_stack(&json!({ "tools": [{ "tool": "nothing" }] })).is_none());
    let s = stack(json!({ "strength": 3, "tools": [{ "tool": "hue", "sat": 9, "hue": [[400, 200], [10, -5]] }, { "tool": "contrast", "amount": 5, "on": false }] }));
    assert_eq!(s.strength, 1.0);
    let Tool::Hue(h) = &s.tools[0].tool else { panic!() };
    assert_eq!((h.sat, h.hue.clone()), (3.0, vec![[10.0, -5.0], [40.0, 90.0]]));
    assert!(!s.tools[1].on);
    assert!(matches!(s.tools[1].tool, Tool::Contrast { amount, .. } if amount == 1.0));
    // a window holds tools of its own; three deep at most
    let w = stack(json!([{ "tool": "window", "w": 9, "track": "hand", "tools": [{ "tool": "key", "hue": 400, "tools": [{ "tool": "balance", "exposure": 9 }] }] }]));
    let Tool::Window(win) = &w.tools[0].tool else { panic!() };
    assert_eq!((win.w, win.track.as_str()), (4.0, ""));
    let Tool::Key(k) = &win.tools[0].tool else { panic!() };
    assert_eq!(k.hue, 40.0);
    assert!(matches!(k.tools[0].tool, Tool::Balance(b) if b.exposure == 4.0));
}

#[test]
fn the_split_tints_shadows_and_highlights_towards_their_hues() {
    let out = odt();
    let hues = Hues::new(&out);
    let st = stack(json!([{ "tool": "split", "sh_hue": 280, "sh_amount": 0.6, "hi_hue": 130, "hi_amount": 0.6 }]));
    // a grey low and a grey high: each takes its side's hue, the other side's barely
    let low = shown(&out, on(&st, [0.25; 3], &hues, &out));
    let high = shown(&out, on(&st, [0.62; 3], &hues, &out));
    assert!(hue_gap(low.hue(), 280.0) < 15.0 && low.chroma() > 0.01, "shadows {:.1}° {:.3}", low.hue(), low.chroma());
    assert!(hue_gap(high.hue(), 130.0) < 15.0 && high.chroma() > 0.01, "highlights {:.1}° {:.3}", high.hue(), high.chroma());
    // the blacks stay neutral
    let black = shown(&out, on(&st, [0.07; 3], &hues, &out));
    assert!(black.chroma() < 0.002, "black {:.4}", black.chroma());
    // the split keeps each pixel's luma in the log
    let y = |p: [f64; 3]| p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722;
    assert!((y(on(&st, [0.25; 3], &hues, &out)) - 0.25).abs() < 1e-9);
}

#[test]
fn hue_against_hue_moves_one_hue_and_leaves_the_skin() {
    let out = odt();
    let hues = Hues::new(&out);
    // greens (about 200° on the vectorscope) towards teal; nothing asked around the skin line
    let st = stack(json!([{ "tool": "hue", "hue": [[123, 0], [200, 25], [300, 0]] }]));
    let green = [0.36, 0.46, 0.34];
    let (before, after) = (shown(&out, green), shown(&out, on(&st, green, &hues, &out)));
    let moved = ((after.hue() - before.hue() + 540.0).rem_euclid(360.0)) - 180.0;
    assert!(moved > 8.0 && moved < 40.0, "green {:.1}° → {:.1}°", before.hue(), after.hue());
    let skin = [0.47, 0.425, 0.395];
    let (s0, s1) = (shown(&out, skin), shown(&out, on(&st, skin, &hues, &out)));
    assert!(hue_gap(s0.hue(), s1.hue()) < 2.0, "skin {:.1}° → {:.1}°", s0.hue(), s1.hue());
}

#[test]
fn luminance_against_hue_darkens_the_greens_and_leaves_the_skin() {
    let out = odt();
    let hues = Hues::new(&out);
    let st = stack(json!([{ "tool": "hue", "hue_lum": [[123, 0], [200, -0.5], [300, 0]] }]));
    let y = |p: [f64; 3]| p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722;
    // a green down (up to half a stop: 1/17.52 in the log a stop, less as its colour is weaker), a skin tone and a grey
    // as they were
    let green = [0.36, 0.46, 0.34];
    let down = y(green) - y(on(&st, green, &hues, &out));
    assert!(down > 0.15 / 17.52 && down < 0.55 / 17.52, "the green {:.2} stops down", down * 17.52);
    let skin = [0.47, 0.425, 0.395];
    assert!((y(on(&st, skin, &hues, &out)) - y(skin)).abs() < 0.05 / 17.52);
    assert!((y(on(&st, [0.4; 3], &hues, &out)) - 0.4).abs() < 1e-9);
}

#[test]
fn highlight_saturation_whitens_a_tinted_sky_and_leaves_skin() {
    let out = odt();
    let hues = Hues::new(&out);
    let st = stack(json!([{ "tool": "hi_sat", "amount": 0.2 }]));
    // a pinkish clipped sky high up the log, a skin tone in the middle
    let sky = [0.70, 0.66, 0.65];
    let (s0, s1) = (shown(&out, sky), shown(&out, on(&st, sky, &hues, &out)));
    assert!(s1.chroma() < s0.chroma() * 0.4, "the sky's colour {:.4} → {:.4}", s0.chroma(), s1.chroma());
    let skin = [0.47, 0.425, 0.395];
    let (k0, k1) = (shown(&out, skin), shown(&out, on(&st, skin, &hues, &out)));
    assert!((k1.chroma() - k0.chroma()).abs() < 0.002, "skin {:.4} → {:.4}", k0.chroma(), k1.chroma());
}

#[test]
fn contrast_turns_around_the_pivot_and_strength_mixes() {
    let out = odt();
    let hues = Hues::new(&out);
    let st = stack(json!([{ "tool": "contrast", "amount": 0.3 }]));
    assert!((on(&st, [PIVOT; 3], &hues, &out)[0] - PIVOT).abs() < 1e-12);
    assert!((on(&st, [0.6; 3], &hues, &out)[0] - (PIVOT + (0.6 - PIVOT) * 1.3)).abs() < 1e-12);
    let half = stack(json!({ "strength": 0.5, "tools": [{ "tool": "contrast", "amount": 0.3 }] }));
    assert!((on(&half, [0.6; 3], &hues, &out)[0] - (0.6 + (PIVOT + (0.6 - PIVOT) * 1.3 - 0.6) * 0.5)).abs() < 1e-12);
    // a tool switched off does nothing
    let off = stack(json!([{ "tool": "contrast", "amount": 0.3, "on": false }]));
    assert_eq!(on(&off, [0.6; 3], &hues, &out), [0.6; 3]);
}

#[test]
fn the_cube_is_the_chain() {
    let out = odt();
    let st = stack(json!([{ "tool": "hue", "sat": 1.2 }, { "tool": "split", "sh_hue": 280, "sh_amount": 0.4 }]));
    let steps = compile(&[&st], &out);
    let all = runs(&steps);
    assert_eq!(all.len(), 1, "colour tools that follow one another are one cube");
    let n = 17;
    let lut = Lut3d::from_rgb("look", n, bake(&all[0].1, &HashMap::new(), &out, n)).unwrap();
    let hues = Hues::new(&out);
    for p in [[0.3, 0.35, 0.4], [0.5, 0.45, 0.4], [0.2, 0.2, 0.2]] {
        let (a, b) = (lut.sample(p), on(&st, p, &hues, &out));
        assert!((0..3).all(|i| (a[i] - b[i]).abs() < 4e-3), "{p:?}: {a:?} vs {b:?}");
    }
}

#[test]
fn a_clip_goes_through_its_stacks_in_order() {
    let t: Timeline = serde_json::from_value(json!({
        "id": "t", "clips": [
            { "id": "a", "track": "V1", "start": 0, "dur": 2, "hash": "h", "script": { "scene": "INT. BEDROOM — MORNING" },
              "stacks": { "base": { "tools": [{ "tool": "balance", "exposure": 0.5 }] }, "clip": { "tools": [{ "tool": "cdl", "slope": [1.1, 1.1, 1.1] }] } } },
            { "id": "b", "track": "V1", "start": 2, "dur": 2, "hash": "h", "script": { "scene": "EXT. GARDEN — MORNING" } },
            { "id": "c", "track": "V1", "start": 4, "dur": 2, "hash": "h" }
        ],
        "grade": {
            "timeline": { "tools": [{ "tool": "contrast", "amount": 0.2 }] },
            "scenes": { "INT. BEDROOM — MORNING": { "strength": 0.5, "tools": [{ "tool": "hue", "sat": 0.9 }] } },
            "finish": { "tools": [{ "tool": "grain", "amount": 0.1 }] }
        }
    }))
    .unwrap();
    let of = |id: &str| t.stacks_for(t.clips.iter().find(|c| c.id == id).unwrap());
    // base, clip, its scene, the timeline, the finishing
    assert_eq!(of("a").len(), 5);
    assert_eq!(of("b").len(), 2);
    // the colour stacks after the balance are one cube: the clip's CDL, the scene's (half), the timeline's
    let out = odt();
    let st = of("a");
    let refs: Vec<&Stack> = st.iter().collect();
    let steps = compile(&refs, &out);
    assert_eq!(steps.len(), 3, "a balance, one cube, the grain");
    let all = runs(&steps);
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].1.parts.iter().map(|p| p.0).collect::<Vec<_>>(), vec![1.0, 0.5, 1.0]);
}
