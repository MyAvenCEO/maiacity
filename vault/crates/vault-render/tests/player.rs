//! Playback through the whole grade (player.rs): a movie made here, laid on the composition's clock, each frame read
//! back as AVFoundation plays it (an AVAssetImageGenerator on the same video composition) — graded where a clip is
//! graded, black in a gap.

use std::{path::PathBuf, sync::Arc};

use serde_json::json;
use vault_render::{
    av::{Codec, VideoSettings, Writer, cmtime},
    gpu::Gpu,
    output::Lut3d,
    player::{PlayClip, Program, composition},
    timeline::Clip,
};

fn scratch(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("vault-player-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// Two seconds of one flat colour: H.264 1280×720 at 30 fps, BT.709, no sound.
fn movie(out: &std::path::Path, c: [f32; 3]) {
    let v = VideoSettings { codec: Codec::H264, width: 1280, height: 720, fps: 30, bitrate: 8_000_000, keyframes: 30, audio_bitrate: 192_000 };
    let mut w = Writer::create(out, &v, None).unwrap();
    let gpu = Gpu::new().unwrap();
    let px: Vec<f32> = (0..16).flat_map(|_| [c[0], c[1], c[2], 1.0]).collect();
    let img = gpu.resize(&gpu.from_rgba(&px, 4, 4), 1280, 720).unwrap();
    for _ in 0..60 {
        objc2::rc::autoreleasepool(|_| {
            let buf = w.buffer().unwrap();
            gpu.render(&img, &buf, 1280, 720);
            w.push(&buf).unwrap();
        });
    }
    w.finish("test").unwrap();
}

/// The centre of the frame the video composition makes at `t`.
fn frame_at(p: Arc<Program>, t: f64) -> [f32; 3] {
    let (comp, video) = composition(p).unwrap();
    // SAFETY: AVFoundation objects we made
    let cg = unsafe {
        let g = objc2_av_foundation::AVAssetImageGenerator::assetImageGeneratorWithAsset(&comp);
        g.setVideoComposition(Some(&video));
        g.setRequestedTimeToleranceBefore(cmtime(0.0));
        g.setRequestedTimeToleranceAfter(cmtime(0.0));
        #[allow(deprecated)]
        g.copyCGImageAtTime_actualTime_error(cmtime(t), std::ptr::null_mut()).unwrap()
    };
    let gpu = Gpu::new().unwrap();
    let img = gpu.cg_image(&cg);
    let e = vault_render::gpu::Extent::ext(&*img);
    let (w, h) = (e.size.width as u32, e.size.height as u32);
    let px = gpu.read(&img, w, h);
    let i = (((h / 2) * w + w / 2) * 4) as usize;
    [px[i], px[i + 1], px[i + 2]]
}

fn program(file: &std::path::Path, clip: serde_json::Value) -> Program {
    let clip: Clip = serde_json::from_value(clip).unwrap();
    let source = vault_media::Source::blob(Arc::new(std::fs::read(file).unwrap()), "a.mp4");
    let journey = vault_media::cst::journey("rec709").unwrap().kernel_args();
    Program {
        clips: vec![PlayClip { clip, source, journey, looks: None }],
        finish: None,
        aspect: "16:9".into(),
        width: 320,
        height: 180,
        output: Lut3d::from_rgb("odt", 33, vault_media::aces2::bake_cube(33)).unwrap(),
    }
}

#[test]
fn every_frame_plays_through_its_grade_and_a_gap_is_black() {
    let dir = scratch("grade");
    let file = dir.join("a.mp4");
    movie(&file, [0.45, 0.45, 0.45]);
    let clip = json!({ "id": "a", "track": "V1", "start": 0.5, "in": 0, "dur": 1.5, "hash": "a" });
    let plain = frame_at(Arc::new(program(&file, clip.clone())), 1.0);
    let mut lifted = clip.clone();
    lifted["balance"] = json!({ "exposure": 1 });
    let brighter = frame_at(Arc::new(program(&file, lifted)), 1.0);
    // the clip's own balance: a stop brighter on the display
    assert!(brighter[1] > plain[1] + 0.05, "plain {plain:?}, a stop up {brighter:?}");
    // before the clip starts, a gap: black
    let gap = frame_at(Arc::new(program(&file, clip)), 0.2);
    assert!(gap.iter().all(|v| *v < 0.02), "the gap {gap:?}");
    std::fs::remove_dir_all(dir).ok();
}

