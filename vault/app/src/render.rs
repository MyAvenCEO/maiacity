//! Films and frames of a cut of avenDB, rendered on this Mac — the `render` and `frame` rules (aven.rs `studio_job`
//! calls `render_cut` and `frame_cut`, and puts what they make into the cut's vault) — natively with `vault-render`:
//! Core Image on Metal, VideoToolbox, AVFoundation, Core Text; no bun, no ffmpeg, no Chrome.
//!
//!   render  a cut into every delivery (16:9 4K master + 1080 copy, 9:16, 1:1, 4:5), levelled to `LOUDNESS`; with
//!           delivery "youtube-4k", the 16:9 4K master for YouTube alone. World clips are rendered first as ACEScct
//!           plates at each shape's size, in the app's own unseen world (world.rs, cached on this Mac by what they
//!           are made of).
//!   frame   of a media clip (named, or the one on screen at `at`): its file's graded still — the grading still
//!           through the clip's whole chain, 1920×1080, a JPEG. Of a world clip or a gap: a hero frame at `at` in a
//!           shape, a 16-bit PNG.
//!
//! Every file is read in place from avenDB (`Footage`); the legacy vault and the old API's render queue are not used.
//! `vault_render::render` runs on one blocking thread: its GPU and AVFoundation objects are not `Send`. And the
//! Audio tab's measures (`sound_measure`, `eq_response`).

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

use anyhow::Context;
use serde_json::{Value, json};
use tauri::AppHandle;
use vault_render::{
    Library, Lut3d, Media, Options, Plate, Target,
    output::RENDER_LUT_SIZE,
    timeline::{Clip, FPS, Shape, Timeline, shapes_of},
};

use crate::{Res, err, world};

/// The loudness every film is levelled to: −14 LUFS integrated, the true peak at most −1 dBTP — what YouTube,
/// Instagram and TikTok play at (and room for their AAC encoders). Change it here.
pub const LOUDNESS: Target = Target { lufs: -14.0, true_peak: -1.0 };

/// The one delivery the studio renders for now: the 16:9 4K master for YouTube (HEVC 10-bit, 80 Mb/s, AAC 384 kb/s).
pub const YOUTUBE_4K: &str = "youtube-4k";

/// The output transform every render and hero frame takes: ACES 2.0 to Rec.709 (`vault_media::aces2`), baked once at
/// 129³ (a few seconds, on the first render's thread).
static ODT: OnceLock<Lut3d> = OnceLock::new();

pub(crate) fn odt() -> &'static Lut3d {
    ODT.get_or_init(|| {
        Lut3d::from_rgb("odt-rec709", RENDER_LUT_SIZE, vault_media::aces2::bake_cube(RENDER_LUT_SIZE)).expect("aces2 bakes a whole cube")
    })
}

/// Whoever hears how far a render is (0…1) and what it is doing: a task's stage in the Mac's jobs (aven.rs).
pub(crate) type Told = Arc<dyn Fn(f64, &str) + Send + Sync>;

// ── avenDB's footage, as the render reads it ───────────────────────────────────────────────────────────────────

/// The footage a cut plays: the studio's library items for it the page named (src/lib/studio/aven.js `libraryOf`),
/// each by its avenDB reference (`aven:…`), and any other reference a clip names, told from the reference alone (its
/// media type rides on it: src/lib/studio/avenref.js). Every file's bytes are read in place from avenDB's device
/// (aven.rs); the legacy vault is not read.
struct Footage {
    rt: tokio::runtime::Handle,
    media: HashMap<String, Media>,
    ext: HashMap<String, String>,
    /// an original's proxy (its meta.proxy) → the original: conform finds it from either side
    originals: HashMap<String, String>,
    /// each file as it is read: in place, from avenDB's device (never copied out)
    files: Mutex<HashMap<String, vault_media::Source>>,
}

impl Footage {
    fn new(items: &[Value], t: &Timeline) -> Self {
        let mut lib = Self { rt: tokio::runtime::Handle::current(), media: HashMap::new(), ext: HashMap::new(), originals: HashMap::new(), files: Mutex::new(HashMap::new()) };
        for v in items {
            let Ok(m) = serde_json::from_value::<Media>(v.clone()) else { continue };
            lib.add(m);
        }
        // a clip's file the page named no item for: what its reference says
        for h in t.clips.iter().filter(|c| !c.is_world()).filter_map(|c| c.hash.as_deref()) {
            if lib.media.contains_key(h) {
                continue;
            }
            let Some(Ok(f)) = crate::aven::file_of_ref(h) else { continue };
            let mime = h.splitn(5, ':').nth(4).map(percent_decode).unwrap_or_default();
            let kind = mime.split('/').next().filter(|k| ["video", "audio", "image"].contains(k)).unwrap_or("other").to_string();
            lib.add(Media { hash: h.to_string(), mime, kind, size: f.len, title: String::new(), meta: Value::Null });
        }
        lib
    }

    fn add(&mut self, m: Media) {
        if crate::aven::file_of_ref(&m.hash).is_none() {
            return;
        }
        if let Some(p) = m.meta.get("proxy").and_then(Value::as_str).filter(|_| m.meta.get("role").and_then(Value::as_str) != Some("proxy")) {
            self.originals.insert(p.to_string(), m.hash.clone());
        }
        self.ext.insert(m.hash.clone(), extension(&m.title, &m.mime, &m.meta));
        self.media.insert(m.hash.clone(), m);
    }
}

/// "%2F" and the like back to their bytes (a reference's media type is percent-encoded).
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("zz"), 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A file's extension on disk: the one its name has, else its type's.
fn extension(name: &str, mime: &str, meta: &Value) -> String {
    if meta.get("sequence").and_then(Value::as_str) == Some("exr") {
        return "tar".into();
    }
    if let Some(e) = Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).filter(|e| !e.is_empty() && e.len() <= 5) {
        return e;
    }
    match mime {
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "video/x-m4v" => "m4v",
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/heic" => "heic",
        "image/x-exr" => "exr",
        "image/tiff" => "tif",
        "audio/wav" => "wav",
        "audio/mpeg" => "mp3",
        "audio/mp4" => "m4a",
        "application/x-tar" => "tar",
        _ => "bin",
    }
    .into()
}

impl Library for Footage {
    fn media(&self, hash: &str) -> Option<Media> {
        self.media.get(hash).cloned()
    }

    fn file(&self, hash: &str) -> anyhow::Result<vault_media::Source> {
        if let Some(s) = self.files.lock().unwrap().get(hash) {
            return Ok(s.clone());
        }
        let m = self.media.get(hash).with_context(|| format!("{hash} is no avenDB file the cut names"))?;
        let name = if m.title.is_empty() { "file".to_string() } else { m.title.clone() };
        let ext = self.ext.get(hash).map(String::as_str).unwrap_or("bin");
        let f = crate::aven::file_of_ref(hash).with_context(|| format!("{hash} is no avenDB file"))?.map_err(anyhow::Error::msg)?;
        let src = crate::aven::source_on(&self.rt, f, &format!("{name}.{ext}")).map_err(anyhow::Error::msg)?;
        self.files.lock().unwrap().insert(hash.to_string(), src.clone());
        Ok(src)
    }

    fn original_of(&self, hash: &str) -> String {
        let named = self.media.get(hash).and_then(|m| m.meta.get("proxy_of").and_then(Value::as_str).map(String::from));
        named.or_else(|| self.originals.get(hash).cloned()).unwrap_or_else(|| hash.to_string())
    }

    fn stills_of(&self, original: &str) -> Vec<Media> {
        self.media.values().filter(|m| m.meta.get("grade_still_of").and_then(Value::as_str) == Some(original)).cloned().collect()
    }
}

/// How each sound clip of a timeline sounds (vault_render `measure_sound`): loudness, true peak, a curve to draw, the
/// music under each voice clip.
pub async fn measure_sound(timeline: &Value, library: &[Value]) -> Res<Value> {
    let t: Timeline = serde_json::from_value(timeline.clone()).map_err(err)?;
    let lib = Arc::new(Footage::new(library, &t));
    let out = tauri::async_runtime::spawn_blocking(move || vault_render::measure_sound(&t, &*lib)).await.map_err(err)?.map_err(err);
    out
}

/// A sound clip's EQ as the mix makes it (vault-render `eq`, the same biquads), for the inspector to draw: its gain in
/// dB at `n` frequencies from 20 Hz to 20 kHz, spaced evenly on the octaves; and the bands as the mix takes them.
#[tauri::command]
pub fn eq_response(eq: Value, n: Option<usize>) -> Res<Value> {
    crate::gate()?;
    let bands = vault_render::eq::clean_eq(&eq);
    let rate = vault_render::av::RATE as f64;
    let e = vault_render::eq::Eq::new(&bands, rate);
    let n = n.unwrap_or(160).clamp(16, 1024);
    let curve: Vec<[f64; 2]> = (0..n)
        .map(|i| {
            let f = 20.0 * 1000f64.powf(i as f64 / (n - 1) as f64);
            [(f * 10.0).round() / 10.0, (e.response(f, rate) * 100.0).round() / 100.0]
        })
        .collect();
    Ok(json!({ "bands": bands, "curve": curve }))
}

/// The Audio tab: how the timeline on screen sounds, clip by clip (to draw; it changes nothing). `library`: the studio's
/// library items of its footage (src/lib/studio/aven.js `libraryOf`), else each clip's reference says what it is.
#[tauri::command]
pub async fn sound_measure(timeline: Value, library: Option<Vec<Value>>) -> Res<Value> {
    crate::gate()?;
    measure_sound(&timeline, library.as_deref().unwrap_or_default()).await
}

// ── world plates ────────────────────────────────────────────────────────────────────────────────────────────────

/// A world clip's shot record's spec, at the version the clip names: avenDB's (`shot:<entry>`, world.rs `aven_shot`).
async fn spec_of(handle: &AppHandle, c: &Clip) -> Res<(String, Value)> {
    let shot = c.shot.clone().ok_or_else(|| format!("world clip {} names no shot", c.id))?;
    if !shot.starts_with("shot:") {
        return Err(format!("world clip {} names shot {shot} of the old API: a cut's world clips name avenDB's shots (shot:<entry>)", c.id));
    }
    let version = c.shot_version.ok_or_else(|| format!("world clip {} names no version of its shot", c.id))?;
    // named by its entry alone: the name goes into file and run labels
    Ok((shot.trim_start_matches("shot:").to_string(), world::aven_shot(handle, &shot, version as u64).await?.1))
}

/// Every world clip's plate for every shape: `frames` of its stretch (clip.in … clip.in + dur, a frame over), at the
/// shape's render size and the film's rate.
async fn plates_for(handle: &AppHandle, t: &Timeline, shapes: &[Shape], told: &Told, span: (f64, f64)) -> Res<HashMap<(String, String), Plate>> {
    let clips: Vec<&Clip> = t.clips.iter().filter(|c| c.is_world() && c.track == "V1").collect();
    let mut out = HashMap::new();
    if clips.is_empty() {
        return Ok(out);
    }
    let fps = FPS as f64;
    let frames_of = |c: &Clip| ((c.dur * fps).ceil() as u32 + 1).max(2);
    let total: f64 = clips.iter().map(|c| frames_of(c) as f64 * shapes.len() as f64).sum();
    let mut done = 0.0;
    told(span.0, "rendering world plates");
    for c in clips {
        let (shot, spec) = spec_of(handle, c).await?;
        let version = c.shot_version.unwrap_or(0);
        for s in shapes {
            let (width, height) = s.render_size();
            let frames = frames_of(c);
            let ask = world::Frames { spec: spec.clone(), shape: s.aspect, width, height, fps, from: c.in_, frames, bitrate: Some(world::plate_bitrate(width, height, fps)) };
            let (p, base, of) = (told.clone(), done, frames as f64);
            let told = move |x: f64| p(span.0 + (span.1 - span.0) * (base + x * of) / total, "rendering world plates");
            let label = format!("plate-{}-v{version}-{}", &shot[..8.min(shot.len())], s.tag());
            let made = world::plate(handle, &label, &ask, told)
                .await
                .map_err(|e| format!("world clip {} (shot {shot} v{version}), its {} plate: {e}", c.id, s.aspect))?;
            tracing::info!("plate of shot {shot} v{version} {}–{} s · {} {width}×{height}: {}", c.in_, c.in_ + c.dur, s.aspect, if made.reused { "from the cache" } else { "rendered" });
            out.insert(
                (c.id.clone(), s.aspect.to_string()),
                Plate { file: made.file, offset: 0.0, key: Some(made.key), fingerprint: Some(made.fingerprint), reused: Some(made.reused) },
            );
            done += of;
        }
    }
    Ok(out)
}

// ── the jobs ────────────────────────────────────────────────────────────────────────────────────────────────────

/// Timeline `t` rendered into `out` from library `lib`, every delivery, or with `delivery` "youtube-4k" the 16:9 4K
/// master for YouTube alone: what it made, its files still on the disk (the caller puts them where they go).
async fn render_into(handle: &AppHandle, t: &Timeline, lib: Arc<Footage>, delivery: Option<&str>, out: PathBuf, told: &Told) -> Res<vault_render::Render> {
    let youtube = delivery == Some(YOUTUBE_4K);
    let shapes: Vec<Shape> = shapes_of(t).into_iter().filter(|s| !youtube || s.aspect == "16:9").collect();
    let plates = plates_for(handle, t, &shapes, told, (0.03, 0.3)).await?;
    let (from, span) = if plates.is_empty() { (0.03, 0.9) } else { (0.3, 0.63) };

    let (t2, p) = (t.clone(), told.clone());
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<vault_render::Render> {
        let mut opts = Options::new(out);
        opts.target = Some(LOUDNESS);
        if youtube {
            opts.shapes = Some(vec!["16:9".into()]);
            opts.master_only = true;
        }
        let plate = |c: &Clip, s: &Shape| -> anyhow::Result<Option<Plate>> { Ok(plates.get(&(c.id.clone(), s.aspect.to_string())).cloned()) };
        vault_render::render(&t2, &*lib, &plate, odt(), &opts, &mut |x, what| p(from + span * x, what))
    })
    .await
    .map_err(err)?
    .map_err(err)
}

/// How wide a file's graded still is (16:9, so 1920×1080).
const GRADED_WIDTH: u32 = 1920;

/// What a `frame` made, still on the disk: a file's graded still (`rep.of` the file), or a hero frame.
pub(crate) enum Framed {
    Graded { file: PathBuf, rep: Value, clip: String },
    Hero { file: PathBuf, rep: Value, at: f64, aspect: String, width: u32, height: u32 },
}

/// A frame of timeline `t` made into `work` from library `lib`: of media clip `clip`, or of the one on screen at `at`,
/// its file's graded still; of a world clip or a gap, a hero frame at `at` in shape `aspect`.
async fn frame_into(handle: &AppHandle, t: &Timeline, lib: Arc<Footage>, clip: Option<&str>, at: f64, aspect: &str, work: &Path, told: &Told) -> Res<Framed> {
    let s = Shape::of(aspect).ok_or_else(|| format!("no such shape: {aspect}"))?;
    // the clip on screen, as hero_frame picks it: a world clip gets a plate of that one frame
    let has_cards = |c: &Clip| lib.media(c.hash.as_deref().unwrap_or("")).is_some_and(|m| m.meta.get("cards").is_some_and(Value::is_object));
    let named = clip.map(|id| t.clips.iter().find(|c| c.id == id).ok_or_else(|| format!("no clip {id} on the timeline any more")));
    let clip = match named {
        Some(c) => Some(c?),
        None => t
            .clips
            .iter()
            .filter(|c| c.track == "V1" && (c.is_world() || (c.hash.as_deref().is_some_and(|h| lib.media(h).is_some()) && !has_cards(c))))
            .rfind(|c| c.start <= at && at < c.end()),
    };
    if let Some(c) = clip.filter(|c| !c.is_world()) {
        told(0.3, "rendering the graded still");
        let file = work.join(format!("graded-{}.jpg", c.id));
        let (t2, f2, c2) = (t.clone(), file.clone(), c.id.clone());
        let rep = tauri::async_runtime::spawn_blocking(move || vault_render::graded_still(&t2, &*lib, odt(), &c2, GRADED_WIDTH, &f2))
            .await
            .map_err(err)?
            .map_err(err)?;
        return Ok(Framed::Graded { file, rep, clip: c.id.clone() });
    }
    let mut plates = HashMap::new();
    if let Some(c) = clip.filter(|c| c.is_world()) {
        told(0.1, "rendering world plates");
        let (shot, spec) = spec_of(handle, c).await?;
        let (width, height) = s.render_size();
        let fps = FPS as f64;
        let ask = world::Frames { spec, shape: s.aspect, width, height, fps, from: c.in_ + (at - c.start), frames: 1, bitrate: Some(world::plate_bitrate(width, height, fps)) };
        let label = format!("frame-{}-{}", &shot[..8.min(shot.len())], s.tag());
        let made = world::plate(handle, &label, &ask, |_| {}).await.map_err(|e| format!("world clip {}: its frame: {e}", c.id))?;
        plates.insert((c.id.clone(), aspect.to_string()), Plate { file: made.file, offset: at - c.start, key: Some(made.key), fingerprint: Some(made.fingerprint), reused: Some(made.reused) });
    }
    told(0.5, "rendering the frame");
    let file = work.join(format!("frame-{at:.2}s-{}.png", s.tag()));
    let (t2, f2, shape) = (t.clone(), file.clone(), aspect.to_string());
    let rep = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<Value> {
        let plate = |c: &Clip, s: &Shape| -> anyhow::Result<Option<Plate>> { Ok(plates.get(&(c.id.clone(), s.aspect.to_string())).cloned()) };
        vault_render::hero_frame(&t2, &*lib, &plate, odt(), at, &shape, &f2)
    })
    .await
    .map_err(err)?
    .map_err(err)?;
    let (width, height) = s.render_size();
    Ok(Framed::Hero { file, rep, at, aspect: aspect.to_string(), width, height })
}

// ── cuts of avenDB (Jobs and studio 2.0, J12-J13: aven.rs `studio_job`) ────────────────────────────────────────

/// Cut `t` of avenDB rendered into `out` (every delivery, or `delivery` "youtube-4k" alone), its files read from avenDB
/// (`aven`, the page's library items of its footage): what it made, its files still on the disk for aven.rs to put
/// into the cut's vault.
pub(crate) async fn render_cut(handle: &AppHandle, t: &Timeline, aven: &[Value], delivery: Option<&str>, out: PathBuf, told: Told) -> Res<vault_render::Render> {
    told(0.02, "fetching files");
    let lib = Arc::new(Footage::new(aven, t));
    let made = {
        let _awake = world::Awake::begin("rendering a film");
        let _kept = world::keep();
        render_into(handle, t, lib, delivery, out, &told).await
    };
    world::close_if_idle(handle);
    made
}

/// A frame of cut `t` of avenDB made into `work` (`frame_into`), its files read as `render_cut` reads them.
pub(crate) async fn frame_cut(handle: &AppHandle, t: &Timeline, aven: &[Value], clip: Option<&str>, at: f64, aspect: &str, work: &Path, told: Told) -> Res<Framed> {
    told(0.05, "fetching files");
    let lib = Arc::new(Footage::new(aven, t));
    let made = {
        let _awake = world::Awake::begin("rendering a frame");
        let _kept = world::keep();
        frame_into(handle, t, lib, clip, at, aspect, work, &told).await
    };
    world::close_if_idle(handle);
    made
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_loudness_is_the_platforms() {
        assert_eq!((LOUDNESS.lufs, LOUDNESS.true_peak), (vault_render::PLATFORMS.lufs, vault_render::PLATFORMS.true_peak));
    }

    #[test]
    fn a_file_is_exported_with_its_own_extension() {
        let m = |name: &'static str, mime: &'static str, meta: Value| (name, mime, meta);
        let extension = |(name, mime, meta): (&str, &str, Value)| extension(name, mime, &meta);
        assert_eq!(extension(m("A001.MOV", "video/quicktime", Value::Null)), "mov");
        assert_eq!(extension(m("", "video/mp4", Value::Null)), "mp4");
        assert_eq!(extension(m("shot_010", "application/x-tar", json!({ "sequence": "exr" }))), "tar");
        assert_eq!(extension(m("take.wav", "audio/wav", Value::Null)), "wav");
        assert_eq!(extension(m("", "application/octet-stream", Value::Null)), "bin");
    }
}
