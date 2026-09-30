//! The creative looks (creative.rs): what each part does to a picture as the display shows it, the cube they bake into,
//! and which looks a clip goes through.

use serde_json::json;
use vault_render::{
    Lut3d, Output,
    creative::{Hues, Look, Ready, bake, clean_look},
    grade::PIVOT,
    look::Disp,
    timeline::Timeline,
};

fn odt() -> Lut3d {
    Lut3d::from_rgb("odt-rec709", 33, vault_media::aces2::bake_cube(33)).unwrap()
}

fn look(v: serde_json::Value) -> Look {
    clean_look(&v).expect("a look that changes something")
}

fn shown(out: &Lut3d, p: [f64; 3]) -> Disp {
    Disp::of(out.apply(p))
}

fn hue_gap(a: f64, b: f64) -> f64 {
    ((a - b + 540.0).rem_euclid(360.0) - 180.0).abs()
}

#[test]
fn a_look_that_changes_nothing_is_none() {
    assert!(clean_look(&json!({})).is_none());
    assert!(clean_look(&json!({ "sat": 1, "contrast": 0, "strength": 1 })).is_none());
    assert!(clean_look(&json!({ "sat": 1.3, "strength": 0 })).is_none());
    assert!(clean_look(&json!({ "split": { "shadows": { "hue": 280, "amount": 0 } } })).is_none());
    let l = look(json!({ "contrast": 5, "sat": 9, "hue": [[400, 200], [10, -5]] }));
    assert_eq!((l.contrast, l.sat), (1.0, 3.0));
    assert_eq!(l.hue, vec![[10.0, -5.0], [40.0, 90.0]]);
}

#[test]
fn the_split_tints_shadows_and_highlights_towards_their_hues() {
    let out = odt();
    let hues = Hues::new(&out);
    let l = look(json!({ "split": { "shadows": { "hue": 280, "amount": 0.6 }, "highlights": { "hue": 130, "amount": 0.6 } } }));
    let r = Ready::new(&l, None);
    // a grey low and a grey high: each takes its side's hue, the other side's barely
    let low = shown(&out, r.apply([0.25; 3], &hues, &out));
    let high = shown(&out, r.apply([0.62; 3], &hues, &out));
    assert!(hue_gap(low.hue(), 280.0) < 15.0 && low.chroma() > 0.01, "shadows {:.1}° {:.3}", low.hue(), low.chroma());
    assert!(hue_gap(high.hue(), 130.0) < 15.0 && high.chroma() > 0.01, "highlights {:.1}° {:.3}", high.hue(), high.chroma());
    // the split keeps each pixel's luma in the log
    let y = |p: [f64; 3]| p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722;
    assert!((y(r.apply([0.25; 3], &hues, &out)) - 0.25).abs() < 1e-9);
}

#[test]
fn hue_against_hue_moves_one_hue_and_leaves_the_skin() {
    let out = odt();
    let hues = Hues::new(&out);
    // greens (about 200° on the vectorscope) towards teal; nothing asked around the skin line
    let l = look(json!({ "hue": [[123, 0], [200, 25], [300, 0]] }));
    let r = Ready::new(&l, None);
    let green = [0.36, 0.46, 0.34];
    let (before, after) = (shown(&out, green), shown(&out, r.apply(green, &hues, &out)));
    let moved = ((after.hue() - before.hue() + 540.0).rem_euclid(360.0)) - 180.0;
    assert!(moved > 8.0 && moved < 40.0, "green {:.1}° → {:.1}°", before.hue(), after.hue());
    let skin = [0.47, 0.425, 0.395];
    let (s0, s1) = (shown(&out, skin), shown(&out, r.apply(skin, &hues, &out)));
    assert!(hue_gap(s0.hue(), s1.hue()) < 2.0, "skin {:.1}° → {:.1}°", s0.hue(), s1.hue());
}

#[test]
fn luminance_against_hue_darkens_the_greens_and_leaves_the_skin() {
    let out = odt();
    let hues = Hues::new(&out);
    let l = look(json!({ "hue_lum": [[123, 0], [200, -0.5], [300, 0]] }));
    let r = Ready::new(&l, None);
    let y = |p: [f64; 3]| p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722;
    // a green down (up to half a stop: 1/17.52 in the log a stop, less as its colour is weaker), a skin tone and a grey
    // as they were
    let green = [0.36, 0.46, 0.34];
    let down = y(green) - y(r.apply(green, &hues, &out));
    assert!(down > 0.15 / 17.52 && down < 0.55 / 17.52, "the green {:.2} stops down", down * 17.52);
    let skin = [0.47, 0.425, 0.395];
    assert!((y(r.apply(skin, &hues, &out)) - y(skin)).abs() < 0.05 / 17.52);
    assert!((y(r.apply([0.4; 3], &hues, &out)) - 0.4).abs() < 1e-9);
    assert!(clean_look(&json!({ "hue_lum": [[200, 0]] })).is_none());
    assert_eq!(look(json!({ "hue_lum": [[200, -9]] })).hue_lum, vec![[200.0, -2.0]]);
}

#[test]
fn contrast_turns_around_the_pivot_and_strength_mixes() {
    let out = odt();
    let hues = Hues::new(&out);
    let l = look(json!({ "contrast": 0.3 }));
    let r = Ready::new(&l, None);
    assert!((r.apply([PIVOT; 3], &hues, &out)[0] - PIVOT).abs() < 1e-12);
    assert!((r.apply([0.6; 3], &hues, &out)[0] - (PIVOT + (0.6 - PIVOT) * 1.3)).abs() < 1e-12);
    let half = look(json!({ "contrast": 0.3, "strength": 0.5 }));
    let h = Ready::new(&half, None);
    assert!((h.apply([0.6; 3], &hues, &out)[0] - (0.6 + (PIVOT + (0.6 - PIVOT) * 1.3 - 0.6) * 0.5)).abs() < 1e-12);
}

#[test]
fn the_cube_is_the_chain() {
    let out = odt();
    let l = look(json!({ "sat": 1.2, "split": { "shadows": { "hue": 280, "amount": 0.4 } } }));
    let r = Ready::new(&l, None);
    let n = 17;
    let cube = bake(None, &[], &[r], &out, n);
    let lut = Lut3d::from_rgb("look", n, cube).unwrap();
    let hues = Hues::new(&out);
    let r = Ready::new(&l, None);
    for p in [[0.3, 0.35, 0.4], [0.5, 0.45, 0.4], [0.2, 0.2, 0.2]] {
        let (a, b) = (lut.sample(p), r.apply(p, &hues, &out));
        assert!((0..3).all(|i| (a[i] - b[i]).abs() < 4e-3), "{p:?}: {a:?} vs {b:?}");
    }
}

#[test]
fn a_clip_goes_through_its_scene_s_look_then_the_film_s() {
    let t: Timeline = serde_json::from_value(json!({
        "id": "t", "clips": [
            { "id": "a", "track": "V1", "start": 0, "dur": 2, "hash": "h", "script": { "scene": "INT. BEDROOM — MORNING" } },
            { "id": "b", "track": "V1", "start": 2, "dur": 2, "hash": "h", "script": { "scene": "EXT. GARDEN — MORNING" } },
            { "id": "c", "track": "V1", "start": 4, "dur": 2, "hash": "h" }
        ],
        "grade": { "film": { "contrast": 0.2 }, "scenes": { "INT. BEDROOM — MORNING": { "sat": 0.9 } } }
    }))
    .unwrap();
    let looks = |id: &str| t.looks_for(t.clips.iter().find(|c| c.id == id).unwrap());
    assert_eq!(looks("a").len(), 2);
    assert_eq!((looks("a")[0].sat, looks("a")[1].contrast), (0.9, 0.2));
    assert_eq!(looks("b").len(), 1);
    assert_eq!(looks("c").len(), 1);
    // the plain CDL from before is the film's look
    let old: Timeline = serde_json::from_value(json!({ "id": "t", "clips": [], "grade": { "look": null, "preset": "warm" } })).unwrap();
    assert_eq!(old.film_look().and_then(|l| l.preset), Some("warm".into()));
}
