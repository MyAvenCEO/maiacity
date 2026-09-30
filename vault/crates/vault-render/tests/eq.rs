//! A sound clip's EQ (eq.rs): the cookbook's filters do what they say, the spectrum finds where a sound's energy is,
//! and a matching EQ makes one sound's tone the other's.

use serde_json::json;
use vault_render::eq::{Band, Eq, Kind, OCTAVES, clean_eq, matching, spectrum};

const RATE: f64 = 48000.0;

fn sine(f: f64, secs: f64) -> Vec<f32> {
    (0..(secs * RATE) as usize).flat_map(|i| {
        let v = (0.5 * (2.0 * std::f64::consts::PI * f * i as f64 / RATE).sin()) as f32;
        [v, v]
    }).collect()
}

/// White noise (a fixed seed), stereo.
fn noise(secs: f64) -> Vec<f32> {
    let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
    (0..(secs * RATE) as usize).flat_map(|_| {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        let v = ((x >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0) as f32 * 0.3;
        [v, v]
    }).collect()
}

fn rms(x: &[f32]) -> f64 {
    // the second half: the filter settled
    let h = &x[x.len() / 2..];
    (h.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / h.len() as f64).sqrt()
}

#[test]
fn a_peak_lifts_its_frequency_and_leaves_the_rest() {
    let eq = Eq::new(&[Band { kind: Kind::Peaking, f: 1000.0, gain: 6.0, q: 1.0 }], RATE);
    assert!((eq.response(1000.0, RATE) - 6.0).abs() < 0.01);
    assert!(eq.response(100.0, RATE).abs() < 0.3);
    assert!(eq.response(10000.0, RATE).abs() < 0.3);
    // and the samples agree with the response
    let mut x = sine(1000.0, 0.5);
    let before = rms(&x);
    Eq::new(&[Band { kind: Kind::Peaking, f: 1000.0, gain: 6.0, q: 1.0 }], RATE).process(&mut x);
    let db = 20.0 * (rms(&x) / before).log10();
    assert!((db - 6.0).abs() < 0.1, "{db} dB");
}

#[test]
fn a_high_pass_takes_the_rumble_and_shelves_tilt() {
    let hp = Eq::new(&[Band { kind: Kind::Highpass, f: 100.0, gain: 0.0, q: std::f64::consts::FRAC_1_SQRT_2 }], RATE);
    assert!((hp.response(100.0, RATE) + 3.01).abs() < 0.05, "−3 dB at the corner");
    assert!(hp.response(25.0, RATE) < -20.0);
    assert!(hp.response(1000.0, RATE).abs() < 0.1);
    let hs = Eq::new(&[Band { kind: Kind::Highshelf, f: 6000.0, gain: 4.0, q: 1.0 }], RATE);
    assert!((hs.response(18000.0, RATE) - 4.0).abs() < 0.3 && hs.response(300.0, RATE).abs() < 0.1);
    let ls = Eq::new(&[Band { kind: Kind::Lowshelf, f: 200.0, gain: -3.0, q: 1.0 }], RATE);
    assert!((ls.response(30.0, RATE) + 3.0).abs() < 0.3 && ls.response(3000.0, RATE).abs() < 0.1);
    let notch = Eq::new(&[Band { kind: Kind::Notch, f: 50.0, gain: 0.0, q: 8.0 }], RATE);
    assert!(notch.response(50.0, RATE) < -40.0 && notch.response(200.0, RATE).abs() < 0.2);
}

#[test]
fn an_eq_is_checked_like_the_studio_checks_it() {
    let eq = clean_eq(&json!([
        { "type": "highpass", "f": 5 },
        { "type": "peaking", "f": 3000, "gain": 40, "q": 0.01 },
        { "type": "peaking", "f": 400, "gain": 0 },
        { "type": "wobble", "f": 400 },
        { "type": "highshelf", "f": 9000, "gain": 2 }
    ]));
    assert_eq!(eq.len(), 3, "{eq:?}");
    assert_eq!((eq[0].kind, eq[0].f), (Kind::Highpass, 20.0));
    assert_eq!((eq[1].gain, eq[1].q), (24.0, 0.1));
    assert_eq!(eq[2].kind, Kind::Highshelf);
    assert!(clean_eq(&json!("loud")).is_empty());
}

#[test]
fn the_spectrum_finds_where_the_energy_is() {
    let s = spectrum(&sine(1000.0, 1.0), RATE as u32).unwrap();
    let at = |f: f64| s[OCTAVES.iter().position(|o| *o == f).unwrap()];
    assert!(at(1000.0) > -1.5, "{s:?}");
    assert!(at(250.0) < -12.0 && at(4000.0) < -12.0, "{s:?}");
    assert!(spectrum(&vec![0.0; 9600], RATE as u32).is_none());
}

#[test]
fn a_matching_eq_gives_one_sound_the_others_tone() {
    // the reference: the same noise, darker below and brighter in the presence range
    let plain = noise(4.0);
    let mut target = plain.clone();
    Eq::new(&[Band { kind: Kind::Lowshelf, f: 250.0, gain: -4.0, q: 1.0 }, Band { kind: Kind::Peaking, f: 3500.0, gain: 5.0, q: 0.9 }], RATE).process(&mut target);
    let (from, to) = (spectrum(&plain, RATE as u32).unwrap(), spectrum(&target, RATE as u32).unwrap());
    let bands = matching(&from, &to, 100.0, 10000.0, 12.0, RATE);
    assert!(!bands.is_empty());
    let mut matched = plain.clone();
    Eq::new(&bands, RATE).process(&mut matched);
    let got = spectrum(&matched, RATE as u32).unwrap();
    // tone, not level: each octave from 125 Hz to 8 kHz within a dB of the reference's, after their mean
    let inside: Vec<usize> = (1..8).collect();
    let d: Vec<f64> = inside.iter().map(|&i| got[i] - to[i]).collect();
    let mean = d.iter().sum::<f64>() / d.len() as f64;
    for (k, &i) in inside.iter().enumerate() {
        assert!((d[k] - mean).abs() < 1.0, "{} Hz off by {:.2} dB: {bands:?}", OCTAVES[i], d[k] - mean);
    }
}

#[test]
fn the_studio_checks_an_eq_as_the_render_does() {
    // game/film/sound.js `cleanEq` (the API's, the studio playback's) and `clean_eq` agree band for band
    let input = json!([
        { "type": "highpass", "f": 5, "q": 0.5 },
        { "type": "peaking", "f": 3000, "gain": 40, "q": 0.01 },
        { "type": "peaking", "f": 400, "gain": 0 },
        { "type": "wobble", "f": 400 },
        { "type": "lowshelf", "f": 180, "gain": -2.345 },
        { "type": "notch", "f": 50 },
        { "type": "highshelf", "f": 30000, "gain": 2 },
        { "type": "lowpass", "f": 16000 }
    ]);
    let js = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../game/film/sound.js");
    let script = format!("import {{ cleanEq }} from '{js}'; console.log(JSON.stringify(cleanEq({input})))");
    let Ok(out) = std::process::Command::new("bun").args(["-e", &script]).output() else {
        eprintln!("no bun here: the studio's side is not compared");
        return;
    };
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let theirs: Vec<Band> = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(clean_eq(&input), theirs);
}
