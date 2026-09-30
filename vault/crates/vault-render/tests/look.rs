//! The base correction's maths (look.rs): a shot levelled to its scene's master by the elements a colourist matches,
//! a master's neutrals to grey plus the warmth asked for, and the scope sheet.

use std::collections::BTreeMap;

use serde_json::json;
use vault_render::{
    Lut3d,
    grade::Balance,
    look::{Disp, Look, SKIN_LINE, fit, neutral, predict, scopes, skin_patch, target},
};

fn odt() -> Lut3d {
    Lut3d::from_rgb("odt-rec709", 33, vault_media::aces2::bake_cube(33)).unwrap()
}

/// A shot as its elements' mean ACEScct colours: a little warm, skin on the skin line.
fn master() -> Look {
    let cct: BTreeMap<String, [f64; 3]> = [
        ("blacks", [0.13, 0.13, 0.135]),
        ("mids", [0.41, 0.41, 0.405]),
        ("whites", [0.6, 0.6, 0.59]),
        ("skin", [0.47, 0.425, 0.395]),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect();
    Look { clip: "master".into(), json: json!({}), cct, picture: vec![[0.4, 0.4, 0.4]; 64 * 36], picture_size: (64, 36), boxes: vec![] }
}

fn through(l: &Look, b: &Balance) -> Look {
    Look { clip: "other".into(), cct: l.cct.iter().map(|(k, v)| (k.clone(), b.apply(*v))).collect(), ..master() }
}

#[test]
fn a_shot_is_levelled_to_its_master_by_its_elements() {
    let out = odt();
    let m = master();
    let want = target(&m, &out, &Balance::default());
    // the other shot: under, cooler, a little green, flatter
    let off = Balance { exposure: -0.8, temp: -0.4, tint: -0.15, contrast: -0.1, ..Default::default() };
    let shot = through(&m, &off);
    let (b, used) = fit(&shot, &want, &out, &[]);
    assert_eq!(used, ["blacks", "mids", "skin", "whites"]);
    let got = predict(&shot, &out, &b);
    for (k, w) in &want {
        let ire = got[k]["ire"].as_f64().unwrap();
        assert!((ire - w.y * 100.0).abs() < 1.0, "{k}: {ire} IRE vs {} with {b:?}", w.y * 100.0);
    }
    let skin = Disp::of(vault_render::Output::apply(&out, b.apply(shot.cct["skin"])));
    assert!((skin.hue() - want["skin"].hue()).abs() < 2.0, "skin hue {} vs {}", skin.hue(), want["skin"].hue());
    // the master against itself: nothing to do
    let (same, _) = fit(&m, &want, &out, &[]);
    assert!(same.exposure.abs() < 0.02 && same.temp.abs() < 0.02 && same.tint.abs() < 0.02 && same.sat.abs() < 0.02, "{same:?}");
}

#[test]
fn what_a_shot_has_only_by_content_is_not_matched() {
    let out = odt();
    let m = master();
    let want = target(&m, &out, &Balance::default());
    // a frame without real blacks (a white rug fills it): its darkest pixels are a light grey
    let mut rug = master();
    rug.cct.insert("blacks".into(), [0.42, 0.42, 0.42]);
    let (_, used) = fit(&rug, &want, &out, &[]);
    assert!(!used.contains(&"blacks".to_string()), "{used:?}");
    let (_, used) = fit(&m, &want, &out, &["skin".to_string()]);
    assert!(!used.contains(&"skin".to_string()));
}

#[test]
fn a_master_s_neutrals_go_grey_then_warmer_by_what_was_asked() {
    let out = odt();
    // a cool, green cast on everything
    let cast = Balance { temp: -0.5, tint: -0.2, ..Default::default() };
    let shot = through(&master(), &cast);
    let (b, used) = neutral(&shot, &out, &Balance::default(), 0.0);
    assert_eq!(used, ["whites", "mids"]);
    let w = Disp::of(vault_render::Output::apply(&out, b.apply(shot.cct["whites"])));
    assert!(w.chroma() < 0.004, "the whites are grey: {w:?} with {b:?}");
    let (warm, _) = neutral(&shot, &out, &Balance::default(), 0.5);
    assert!((warm.temp - b.temp - 0.5).abs() < 1e-9 && warm.tint == b.tint, "{warm:?} vs {b:?}");
    // what else the master's balance holds stays
    let now = Balance { exposure: 0.4, contrast: 0.1, ..Default::default() };
    let (kept, _) = neutral(&shot, &out, &now, 0.25);
    assert_eq!((kept.exposure, kept.contrast), (0.4, 0.1));
    // a white named by hand wins over the whites found
    let mut named = shot;
    named.cct.insert("white".into(), [0.62, 0.6, 0.6]);
    let (_, used) = neutral(&named, &out, &Balance::default(), 0.0);
    assert_eq!(used, ["white"]);
}

#[test]
fn skin_sits_on_its_line_and_inside_the_face() {
    assert_eq!(SKIN_LINE, 123.0);
    let p = skin_patch(&[0.4, 0.2, 0.6, 0.6]);
    assert!(p[0] > 0.4 && p[2] < 0.6 && p[1] > 0.2 && p[3] < 0.6, "{p:?}");
    // a warm skin tone sits near the line on the vectorscope
    let d = Disp::of([0.62, 0.48, 0.4]);
    assert!((d.hue() - SKIN_LINE).abs() < 12.0, "{}", d.hue());
}

#[test]
fn the_scope_sheet_has_a_row_per_shot() {
    let (a, b) = (master(), master());
    let (px, w, h) = scopes(&[(&a, "REFERENCE · the master".into()), (&b, "the other".into())]).unwrap();
    assert_eq!(px.len(), (w * h * 3) as usize);
    assert_eq!(w, 640 + 8 + 480 + 8 + 480 + 8 + 360);
    assert_eq!(h, 2 * (26 + 360 + 8));
    // the label is drawn: light pixels in the first band
    assert!(px[..(w * 26 * 3) as usize].iter().any(|v| *v > 200));
}
