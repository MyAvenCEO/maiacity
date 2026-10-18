//! Colour, for the studio and the rules: the colour journeys into the working space (ACEScct) a proxy or a grading still
//! is made through (vault_media::cst; the `proxy` and `still` rules: aven.rs), the viewer's cubes (`color_lut`,
//! `color_grade`), a clip's whole grade baked for the player (`graded`) and a shot as the film shows it (`color_frame`).
//! Every file is avenDB's, named by its reference (`aven:…`: aven.rs `ref_of`); the legacy vault is not read. The
//! maths is vault-render's and vault-media's alone. And how short of memory the Mac is, which heavy work waits on.

use std::collections::HashMap;

use serde_json::{Value, json};

use vault_render::tools::Stack;


/// Is there a colour journey from this source into ACEScct? (vault_media::cst — verified against OCIO)
pub fn journey(profile: &str) -> bool {
    vault_media::cst::journey(profile).is_some()
}

/// The journey a file made through it records (a proxy, a grading still): its hash, as the render report names it.
pub(crate) fn journey_record(profile: &str) -> Value {
    if journey(profile) { json!(vault_render::journey_hash(profile)) } else { Value::Null }
}

/// The grading still's version: one made by an older one is made again, at the same moment (2: the frame decoded 4:2:2,
/// its colour at full height, as the iPhone records ProRes).
pub(crate) const STILL: u64 = 2;

/// How short of memory the Mac is, as macOS itself says (`kern.memorystatus_vm_pressure_level`): 1 normal, 2 warning,
/// 4 critical. The heavy work waits while it is short (`short_of_memory`).
pub fn pressure() -> u32 {
    let mut level: u32 = 1;
    let mut len = std::mem::size_of::<u32>();
    // SAFETY: sysctlbyname writes at most `len` bytes into `level`; the name is NUL-terminated.
    let ok = unsafe {
        libc::sysctlbyname(c"kern.memorystatus_vm_pressure_level".as_ptr(), (&mut level as *mut u32).cast(), &mut len, std::ptr::null_mut(), 0)
    };
    if ok == 0 { level } else { 1 }
}

/// Too short of memory to start heavy work (a proxy, a render, a transcript): macOS says critical — or warning while
/// less than 15 % of the memory is free. macOS keeps saying "warning" long after memory came back (42 % free and
/// still level 2); waiting on that alone held every job for good.
pub fn short_of_memory() -> bool {
    match pressure() {
        1 => false,
        2 => free_share().is_some_and(|f| f < 15),
        _ => true,
    }
}

/// How much of the memory is free now, in percent (`kern.memorystatus_level`), when macOS says.
fn free_share() -> Option<u32> {
    let mut level: u32 = 0;
    let mut len = std::mem::size_of::<u32>();
    // SAFETY: sysctlbyname writes at most `len` bytes into `level`; the name is NUL-terminated.
    let ok = unsafe { libc::sysctlbyname(c"kern.memorystatus_level".as_ptr(), (&mut level as *mut u32).cast(), &mut len, std::ptr::null_mut(), 0) };
    (ok == 0).then_some(level)
}

/// A LUT for the studio's viewer, baked here from the same maths the proxies and the render use: a profile's journey
/// into ACEScct (`cst`), or `odt-rec709` — the ACES 2.0 output transform, ACEScct to Rec.709 display code values
/// (`aces2`, within 0.07 of a 10-bit code of OCIO). A little-endian u32 size, then size³ RGB f32, red fastest.
#[tauri::command]
pub fn color_lut(profile: String) -> crate::Res<tauri::ipc::Response> {
    crate::gate()?;
    let (size, cube) = if profile == "odt-rec709" {
        (vault_media::aces2::CUBE_SIZE, vault_media::aces2::bake_cube(vault_media::aces2::CUBE_SIZE))
    } else {
        let journey = vault_media::cst::journey(&profile).ok_or_else(|| format!("no colour journey from {profile} into ACEScct"))?;
        (vault_media::cst::CUBE_SIZE, journey.cube(vault_media::cst::CUBE_SIZE))
    };
    let mut out = Vec::with_capacity(4 + cube.len() * 4);
    out.extend_from_slice(&(size as u32).to_le_bytes());
    for v in cube {
        out.extend_from_slice(&v.to_le_bytes());
    }
    Ok(tauri::ipc::Response::new(out))
}

/// A movie's sound for the studio to play and draw (its first sound track, mixed to mono at `rate` Hz, as
/// little-endian f32 samples; empty when it has none). AVFoundation reads it in place from avenDB, so the page never
/// holds the movie itself to get at its sound: a 4K original is a gigabyte or more, and a timeline of footage read
/// whole into the page for its sound ran the Mac out of memory.
#[tauri::command]
pub async fn studio_sound(r: String, name: String, rate: u32) -> crate::Res<tauri::ipc::Response> {
    crate::gate()?;
    let src = source_of(&r, &name)?;
    let rate = rate.clamp(8_000, 96_000);
    let samples = tauri::async_runtime::spawn_blocking(move || objc2::rc::autoreleasepool(|_| vault_media::audio::decode_mono(src, rate, &mut |_| {})))
        .await
        .map_err(|e| format!("{e}"))?
        .map_err(|e| format!("{e:#}"))?
        .unwrap_or_default();
    // 16-bit, half the bytes of the floats decoded (gone before the answer is copied over the bridge): a timeline of
    // footage read as floats held gigabytes on both sides and ran The OS out of memory
    let mut out = Vec::with_capacity(samples.len() * 2);
    for v in samples {
        out.extend_from_slice(&((v.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes());
    }
    Ok(tauri::ipc::Response::new(out))
}

/// The studio's WebGL preview's cube: every colour tool of the stacks given (in order, a balance among them; masks and
/// textures left out — they run on the Mac's frames), 33³ over ACEScct.
#[tauri::command]
pub async fn color_grade(stacks: Vec<serde_json::Value>) -> crate::Res<tauri::ipc::Response> {
    crate::gate()?;
    const SIZE: usize = 33;
    let stacks: Vec<Stack> = stacks.iter().filter_map(vault_render::tools::clean_stack).collect();
    let refs: Vec<&Stack> = stacks.iter().collect();
    let luts = luts_of(&vault_render::tools::luts(&vault_render::tools::compile(&refs, crate::render::odt()))).await?;
    let cube = tauri::async_runtime::spawn_blocking(move || {
        let refs: Vec<&Stack> = stacks.iter().collect();
        vault_render::tools::preview(&refs, &luts, crate::render::odt(), SIZE)
    })
    .await
    .map_err(|e| format!("{e}"))?;
    let mut out = Vec::with_capacity(4 + cube.len() * 4);
    out.extend_from_slice(&(SIZE as u32).to_le_bytes());
    for v in cube {
        out.extend_from_slice(&v.to_le_bytes());
    }
    Ok(tauri::ipc::Response::new(out))
}

/// File `r` of avenDB (its reference, `aven:…`) read in place, `name`'s extension saying what it is. A legacy vault hash
/// is no longer read: its file is brought into avenDB first (the film seed's import, src/lib/studio/importer.js).
pub(crate) fn source_of(r: &str, name: &str) -> crate::Res<vault_media::Source> {
    crate::aven::source_of_ref(r, name).unwrap_or_else(|| Err(format!("{r} is no avenDB file: the legacy vault is not read any more")))
}

/// The creative LUTs named (by their avenDB references), read from avenDB.
async fn luts_of(hashes: &[String]) -> crate::Res<HashMap<String, vault_render::Lut3d>> {
    let mut out = HashMap::new();
    for h in hashes {
        if out.contains_key(h) {
            continue;
        }
        let src = source_of(h, "look.cube")?;
        let text = tauri::async_runtime::spawn_blocking(move || src.read_all()).await.map_err(|e| format!("{e}"))?.map_err(|e| format!("{e:#}"))?;
        out.insert(h.clone(), vault_render::Lut3d::from_cube_str(h, &String::from_utf8_lossy(&text)).map_err(|e| format!("{e:#}"))?);
    }
    Ok(out)
}

/// A clip's whole grade on this timeline (its stacks: base, clip, its scene's, the timeline's, the finishing) as steps,
/// their colour runs baked `size`³ — what the player and the studio's frames run.
pub(crate) async fn graded(t: &vault_render::Timeline, c: &vault_render::Clip, size: usize) -> crate::Res<(Vec<vault_render::tools::Step>, HashMap<String, vault_render::Lut3d>)> {
    let stacks = t.stacks_for(c);
    let refs: Vec<&Stack> = stacks.iter().collect();
    let steps = vault_render::tools::compile(&refs, crate::render::odt());
    let luts = luts_of(&vault_render::tools::luts(&steps)).await?;
    tauri::async_runtime::spawn_blocking(move || -> crate::Res<_> {
        let mut baked = HashMap::new();
        for (key, run) in vault_render::tools::runs(&steps) {
            if !baked.contains_key(&key) {
                let data = vault_render::tools::bake(&run, &luts, crate::render::odt(), size);
                baked.insert(key.clone(), vault_render::Lut3d::from_rgb(&format!("tools-{key}"), size, data).map_err(|e| format!("{e:#}"))?);
            }
        }
        Ok((steps, baked))
    })
    .await
    .map_err(|e| format!("{e}"))?
}

/// A shot as the film will show it, natively, for the studio: its grading still (4K ACEScct, from the original) — or
/// one frame of its proxy or original at `at` seconds of that file, through the file's journey (`profile`) — framed for
/// `shape` (none: the whole still), through its whole grade — its stacks of tools: base, clip, its scene's, the
/// timeline's, the finishing (a window following the face on the face Vision finds) — and
/// the output transform, as a JPEG `width` wide. The Grade viewer and every thumbnail show these: what the render makes.
#[tauri::command]
pub async fn color_frame(
    timeline: serde_json::Value,
    clip: String,
    still: Option<String>,
    file: Option<String>,
    profile: Option<String>,
    at: Option<f64>,
    width: Option<u32>,
    shape: Option<String>,
) -> crate::Res<tauri::ipc::Response> {
    crate::gate()?;
    let t: vault_render::Timeline = serde_json::from_value(timeline).map_err(|e| format!("{e}"))?;
    let c = t.clips.iter().find(|c| c.id == clip).cloned().ok_or("no such clip on this timeline")?;
    // the picture: a grading still (ACEScct already), or one frame of a proxy or an original through its journey
    let (hash, frame) = match (still, file) {
        (Some(h), _) => (h, None),
        (None, Some(f)) => (f, Some((profile.unwrap_or_else(|| "rec709".into()), at.unwrap_or(0.0)))),
        (None, None) => return Err("a still or a file to show".into()),
    };
    let src = source_of(&hash, if frame.is_some() { "frame.mov" } else { "still.png" })?;
    // the clip's whole grade: its stacks as steps, their colour runs baked with their LUTs read from avenDB
    let grade = graded(&t, &c, 33).await?;
    let w = width.unwrap_or(960).clamp(64, 3840);
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let out = std::env::temp_dir().join(format!("maiacity-frame-{}-{}.jpg", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        objc2::rc::autoreleasepool(|_| -> anyhow::Result<Vec<u8>> {
            use vault_render::gpu::Extent;
            let mut gpu = vault_render::gpu::Gpu::new()?;
            gpu.set_output(crate::render::odt());
            let img = match &frame {
                None => gpu.still(src)?,
                Some((profile, at)) => vault_render::render::frame_in_cct(&gpu, src, profile, *at)?,
            };
            let e = img.ext();
            let (aw, ah) = match shape.as_deref().and_then(vault_render::Shape::of) {
                Some(s) => (s.render_size().0 as f64, s.render_size().1 as f64),
                None => (e.size.width, e.size.height),
            };
            let h = ((w as f64 * ah / aw.max(1.0)).round() as u32).max(2);
            let framed = gpu.frame_to(&img, w, h, shape.as_deref().and_then(|s| c.frame_for(s)))?;
            let (steps, luts) = grade;
            let cubes = luts.iter().map(|(k, l)| (k.clone(), gpu.cube(l))).collect();
            let pic = vault_render::render::chain(&gpu, &framed, w, h, &steps, &cubes, 0)?;
            gpu.jpeg(&*gpu.output(&pic)?, w, h, &out)?;
            let bytes = std::fs::read(&out)?;
            std::fs::remove_file(&out).ok();
            Ok(bytes)
        })
    })
    .await
    .map_err(|e| format!("{e}"))?
    .map_err(|e| format!("{e:#}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// How wide a grading still is: 4K UHD.
pub(crate) const STILL_WIDTH: u32 = 3840;

/// How wide a file's preview is, before its graded still takes its place (as wide as that).
pub(crate) const PREVIEW_WIDTH: u32 = 1920;

