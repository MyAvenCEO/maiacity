//! A timeline rendered into its deliveries — worker.ts `render()`, natively. For every delivery shape the picture
//! track is cut into pieces on the film's clock (`timeline::pieces`); each frame of a piece is its source's frame
//! (the conformed original, a world clip's plate, a still held) through the picture path on the GPU (`gpu`), faded,
//! the captions and the hook on top, rendered into the encoder's buffer; the 16:9 master is 4K HEVC Main10 and its
//! 1080 H.264 copy is made from each master frame as it is rendered (one pass). The sound is mixed once
//! (`sound::mix`) and muxed into every file. Then QC, loudness, and the report the API keeps.

use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use objc2::rc::autoreleasepool;
use serde::Serialize;
use serde_json::{Value, json};

use crate::{
    av::{Codec, VideoReader, VideoSettings, Writer},
    captions::Captions,
    creative::{Finish, Look, Ready, apply_finish, apply_secondaries},
    gpu::{Cube, Gpu, Image},
    grade::{Cdl, hash_of},
    loudness::Loudness,
    output::{Lut3d, Output},
    qc::{Qc, Want, loudness, qc},
    sound::{AudioClip, Sound, Target, mix},
    timeline::{Clip, FPS, HOOK, Phrase, Shape, Timeline, Word, base_name, phrases, pieces, shapes_of},
};

/// A file in the vault's catalog, as far as the render reads it.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize)]
pub struct Media {
    pub hash: String,
    #[serde(default)]
    pub mime: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub meta: Value,
}

/// Where the render finds files: the vault's catalog and the bytes on this disk.
pub trait Library {
    /// what the catalog knows of a file
    fn media(&self, hash: &str) -> Option<Media>;
    /// the file's bytes: read in place from the vault (a blob by hash), or a file on this disk
    fn file(&self, hash: &str) -> Result<vault_media::Source>;
    /// Conform: the original a proxy stands for (its meta.proxy_of; an app with the whole catalog also looks for the
    /// original whose meta.proxy names it, as worker.ts `originalOf`). A file that is no proxy stands for itself.
    fn original_of(&self, hash: &str) -> String {
        self.media(hash).and_then(|m| m.meta.get("proxy_of").and_then(Value::as_str).map(String::from)).unwrap_or_else(|| hash.to_string())
    }
    /// An original's grading stills (files whose meta.grade_still_of names it), each a frame of it at its meta.t.
    fn stills_of(&self, _original: &str) -> Vec<Media> {
        Vec::new()
    }
}

/// A world clip's plate for one shape: an ACEScct movie of the clip's stretch of its shot (clip.in … clip.in + dur),
/// at the shape's render size and 30 fps — rendered by the app's own world. A plate may start later in the clip
/// (`offset`): a hero frame's plate is the one frame it shows.
#[derive(Debug, Clone, Default)]
pub struct Plate {
    /// the plate: a vault file, read in place by hash
    pub file: vault_media::Source,
    /// where the plate starts, in seconds from the clip's in point (0: at the in point)
    pub offset: f64,
    pub key: Option<String>,
    pub fingerprint: Option<String>,
    pub reused: Option<bool>,
}

pub struct Options {
    /// where the deliveries and the work files go
    pub work: PathBuf,
    /// the loudness the sound is levelled to (None: as the worker, measured only)
    pub target: Option<Target>,
    /// the captions' face (None: Fraunces)
    pub font: Option<Vec<u8>>,
    /// the time the files are named by (Unix seconds)
    pub now: u64,
    /// only these shapes ("9:16", …); None: every shape of the timeline, as the worker
    pub shapes: Option<Vec<String>>,
    /// the 4K master alone, at YouTube's best (`YOUTUBE_4K`): no 1080 copy
    pub master_only: bool,
}

impl Options {
    pub fn new(work: impl Into<PathBuf>) -> Self {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        Self { work: work.into(), target: Some(crate::sound::PLATFORMS), font: None, now, shapes: None, master_only: false }
    }
}

/// One file a film is delivered as.
#[derive(Debug, Clone, Serialize)]
pub struct Delivery {
    #[serde(skip)]
    pub file: PathBuf,
    pub name: String,
    pub channels: Vec<String>,
    pub format: String,
    pub aspect: String,
    pub width: u32,
    pub height: u32,
    /// "hevc" or "h264"
    pub codec: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub qc: Qc,
    pub loudness: Loudness,
    /// the vault's hash, once the app has added the file
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Conformed {
    pub clip: String,
    pub proxy: String,
    pub original: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlateUse {
    pub clip: String,
    pub aspect: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reused: Option<bool>,
}

/// The colour of the render, as the report names it.
#[derive(Debug, Clone, Serialize)]
pub struct ColorReport {
    pub working: String,
    pub output: String,
    pub engine: String,
    /// every transform used, by name → the hash of its config
    pub transforms: BTreeMap<String, String>,
    pub look: Option<Cdl>,
}

/// What a render made.
#[derive(Debug, Clone, Serialize)]
pub struct Render {
    pub timeline: String,
    pub seconds: f64,
    pub deliveries: Vec<Delivery>,
    pub color: ColorReport,
    pub conformed: Vec<Conformed>,
    pub plates: Vec<PlateUse>,
    pub warnings: Vec<String>,
    pub sound: Sound,
    /// the title cards delivered with the film, by shape (the card marker's meta.cards)
    #[serde(skip)]
    pub thumbnails: Vec<(String, Media)>,
    /// seconds each shape took to render
    pub timings: BTreeMap<String, f64>,
}

/// A picture source, read once per render.
#[derive(Debug, Clone)]
enum Kind {
    Video,
    Still,
    /// an EXR frame sequence (a tar), its frames at this rate
    Sequence { fps: f64 },
}

/// An EXR frame sequence (packed in one tar)?
fn is_sequence(m: &Media) -> bool {
    m.mime == "application/x-tar" || m.meta.get("sequence").and_then(Value::as_str) == Some("exr")
}

/// A sequence's frame rate (its meta.fps, as its proxy was made; 24 when it names none).
fn sequence_fps(m: &Media) -> f64 {
    m.meta.get("fps").and_then(Value::as_f64).filter(|f| *f > 0.0).unwrap_or(24.0)
}

/// A sequence's profile: the vault's (set by hand, or given when packed), else its first frame's header names it
/// (`vault_media::still::exr_profile`); None when neither knows it.
fn sequence_profile(m: &Media, file: &vault_media::Source) -> Result<(Option<String>, String)> {
    let known = |p: &str| vault_media::cst::journey(p).is_some();
    let c = m.meta.get("color");
    for k in ["override", "profile"] {
        if let Some(p) = c.and_then(|c| c.get(k)).and_then(Value::as_str).filter(|p| known(p)) {
            return Ok((Some(p.to_string()), format!("the vault ({k})")));
        }
    }
    let mut seq = vault_media::still::Sequence::open(file)?;
    let first = seq.frame(0)?;
    Ok(match vault_media::still::exr_profile(&first).filter(|p| known(p)) {
        Some(p) => (Some(p.to_string()), "its first frame's EXR header".into()),
        None => (None, "its first frame's primaries are none the journeys know".into()),
    })
}

/// One frame of a sequence, as Core Image reads the EXR (its own code values, the right way up).
fn sequence_frame(seq: &mut vault_media::still::Sequence, i: usize) -> Result<Image> {
    let bytes = seq.frame(i)?;
    let img = vault_media::gpu::load_image(&bytes).with_context(|| format!("frame {}", seq.name(i)))?;
    Ok(crate::gpu::to_origin(&img))
}

#[derive(Debug, Clone)]
struct Source {
    file: vault_media::Source,
    kind: Kind,
    profile: String,
}

/// The profile a file is treated as (color.js `profileOf`: the hand-set override, else the detected one — each only
/// when known), else detected now from the file itself.
fn profile_of(m: &Media, file: &vault_media::Source, still: bool) -> (String, String) {
    let known = |p: &str| vault_media::color::PROFILES.contains(&p) && p != "legacy" && vault_media::cst::journey(p).is_some();
    let c = m.meta.get("color");
    for k in ["override", "profile"] {
        if let Some(p) = c.and_then(|c| c.get(k)).and_then(Value::as_str).filter(|p| known(p)) {
            return (p.to_string(), format!("the vault ({k})"));
        }
    }
    if still {
        let ext = file.ext();
        return if ext == "exr" { ("linear-rec709".into(), "an EXR without a profile: linear Rec.709".into()) } else { ("srgb".into(), "a still image".into()) };
    }
    match vault_media::probe(file) {
        Ok(p) => {
            let d = vault_media::detect(&p);
            (d.profile, d.from)
        }
        Err(e) => ("unknown".into(), format!("unreadable: {e}")),
    }
}

fn is_still(m: &Media, file: &vault_media::Source) -> bool {
    m.kind == "image" || m.mime.starts_with("image/") || matches!(Some(file.ext().as_str()), Some("png" | "jpg" | "jpeg" | "webp" | "heic" | "tif" | "tiff" | "exr"))
}

/// Everything a render needs, read before the first frame.
struct Plan {
    total: f64,
    pictures: Vec<Clip>,
    look: Option<Cdl>,
    finish: Option<Finish>,
    sources: HashMap<String, Source>,
    card: Option<Clip>,
    hooks: HashMap<String, vault_media::Source>,
    thumbnails: Vec<(String, Media)>,
    phrases: Vec<Phrase>,
    audio: Vec<AudioClip>,
    conformed: Vec<Conformed>,
    warnings: Vec<String>,
}

#[cfg(test)]
mod caption_tests {
    use super::caption_words;
    use serde_json::json;

    #[test]
    fn a_voice_s_captions_are_its_transcript_s_else_its_own_words() {
        let transcript = json!({ "transcript": { "words": [{ "w": "The", "s": 1.0, "e": 1.2, "c": 0.9 }, { "w": "moment", "s": 1.2, "e": 1.6 }] } });
        let w = caption_words(&transcript);
        assert_eq!(w.iter().map(|w| w.word.as_str()).collect::<Vec<_>>(), ["The", "moment"]);
        assert_eq!((w[1].start, w[1].end), (1.2, 1.6));
        // the transcript is the one truth: a stale copy of words beside it is not read
        let mut both = transcript.clone();
        both["words"] = json!([{ "word": "A", "start": 1.0, "end": 1.6 }]);
        assert_eq!(caption_words(&both).len(), 2);
        // no transcript yet (a voice take before the Mac folds its words in): its own words
        let own = json!({ "words": [{ "word": "A", "start": 1.0, "end": 1.6 }] });
        assert_eq!(caption_words(&own).len(), 1);
        assert!(caption_words(&json!({})).is_empty());
    }
}

/// A voice file's caption words: its transcript's (`meta.transcript.words`, `{ w, s, e }` — the one truth: put right by
/// hand in the Script tab, a voice take's own timing folded in), else, until the Mac has folded them in, a voice take's
/// own (`meta.words`) — so every voice has its captions without anyone asking.
pub fn caption_words(meta: &serde_json::Value) -> Vec<Word> {
    if let Some(words) = meta.pointer("/transcript/words").and_then(|w| w.as_array()).filter(|w| !w.is_empty()) {
        return words
            .iter()
            .filter_map(|w| Some(Word { word: w["w"].as_str()?.to_string(), start: w["s"].as_f64()?, end: w["e"].as_f64()? }))
            .collect();
    }
    meta.get("words").cloned().and_then(|w| serde_json::from_value(w).ok()).unwrap_or_default()
}

fn plan(t: &Timeline, lib: &dyn Library) -> Result<Plan> {
    let mut clips: Vec<Clip> = t.clips.iter().filter(|c| if c.is_world() { c.track == "V1" } else { c.hash.as_deref().is_some_and(|h| lib.media(h).is_some()) }).cloned().collect();
    clips.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
    let total = clips.iter().map(Clip::end).fold(0.0, f64::max);
    if total <= 0.0 {
        bail!("the timeline is empty");
    }
    let mut warnings = Vec::new();
    let mut conformed = Vec::new();
    // conform: originals only — a proxy cut into the timeline is swapped for the file it stands for
    let mut files: HashMap<String, (vault_media::Source, Media)> = HashMap::new();
    for c in clips.iter().filter(|c| !c.is_world()) {
        let hash = c.hash.clone().unwrap();
        if files.contains_key(&hash) {
            continue;
        }
        let of = lib.original_of(&hash);
        let m = lib.media(&of).with_context(|| {
            let title = lib.media(&hash).map(|m| m.title).filter(|t| !t.is_empty()).unwrap_or_else(|| hash.clone());
            format!("{title} is a proxy whose original ({of}) the vault does not describe")
        })?;
        if of != hash {
            conformed.push(Conformed { clip: c.id.clone(), proxy: hash.clone(), original: of.clone() });
        }
        files.insert(hash, (lib.file(&of)?, m));
    }
    // the title card's marker on the picture track: where the hook goes, and the day's cards by shape
    let has_cards = |c: &Clip| lib.media(c.hash.as_deref().unwrap_or("")).is_some_and(|m| m.meta.get("cards").is_some_and(|v| v.is_object()));
    let card = clips.iter().find(|c| c.track == "V1" && !c.is_world() && has_cards(c)).cloned();
    let named = card.as_ref().and_then(|c| lib.media(c.hash.as_deref().unwrap())).map(|m| m.meta).unwrap_or(Value::Null);
    let mut hooks = HashMap::new();
    let mut thumbnails = Vec::new();
    for aspect in ["1:1", "16:9", "9:16", "4:5"] {
        let tag = aspect.replace(':', "x");
        if let Some(m) = named.get("cards").and_then(|c| c.get(&tag)).and_then(Value::as_str).and_then(|h| lib.media(h)) {
            thumbnails.push((aspect.to_string(), m));
        }
        if let Some(h) = named.get("hooks").and_then(|c| c.get(&tag)).and_then(Value::as_str).filter(|h| lib.media(h).is_some()) {
            hooks.insert(aspect.to_string(), lib.file(h)?);
        }
    }
    let pictures: Vec<Clip> = clips.iter().filter(|c| c.track == "V1" && Some(c.id.as_str()) != card.as_ref().map(|k| k.id.as_str())).cloned().collect();
    let mut sources = HashMap::new();
    for c in pictures.iter().filter(|c| !c.is_world()) {
        let hash = c.hash.clone().unwrap();
        if sources.contains_key(&hash) {
            continue;
        }
        let (file, m) = files.get(&hash).unwrap().clone();
        let title = if m.title.is_empty() { m.hash.clone() } else { m.title.clone() };
        if is_sequence(&m) {
            // an EXR sequence: its frames read from the tar one by one, at its own rate, through its journey
            let (profile, from) = sequence_profile(&m, &file)?;
            let profile = profile.unwrap_or_else(|| {
                warnings.push(format!("{title}: colour unknown ({from}) — taken as linear Rec.709 (idt-linear-rec709); set it in the studio"));
                "linear-rec709".into()
            });
            sources.insert(hash, Source { file, kind: Kind::Sequence { fps: sequence_fps(&m) }, profile });
            continue;
        }
        let still = is_still(&m, &file);
        let (mut profile, from) = profile_of(&m, &file, still);
        if vault_media::cst::journey(&profile).is_none() {
            warnings.push(format!("{}: colour unknown ({from}) — taken as Rec.709 video (idt-rec709); set it in the studio", if m.title.is_empty() { &m.hash } else { &m.title }));
            profile = "rec709".into();
        }
        sources.insert(hash, Source { file, kind: if still { Kind::Still } else { Kind::Video }, profile });
    }
    let words_of = |c: &Clip| -> Vec<Word> {
        let m = lib.media(c.hash.as_deref().unwrap_or("")).or_else(|| lib.media(&lib.original_of(c.hash.as_deref().unwrap_or(""))));
        m.map(|m| caption_words(&m.meta)).unwrap_or_default()
    };
    let phrases = phrases(t, &words_of);
    // the sound tracks, and a picture's own sound where it plays (a video on V1 at a volume above 0: the studio plays it
    // through its player, so the film has it too — with the other sounds)
    let own_sound = |c: &Clip| c.track == "V1" && c.vol > 0.0 && c.hash.as_ref().is_some_and(|h| sources.get(h).is_some_and(|s: &Source| matches!(s.kind, Kind::Video)));
    let audio = clips
        .iter()
        .filter(|c| (c.track.starts_with('A') || own_sound(c)) && c.hash.is_some())
        .map(|c| AudioClip { clip: c.clone(), file: files.get(c.hash.as_ref().unwrap()).unwrap().0.clone() })
        .collect();
    Ok(Plan { total, pictures, look: t.look(), finish: t.finish(), sources, card, hooks, thumbnails, phrases, audio, conformed, warnings })
}

/// The journey's config, hashed as the report names it.
fn journey_hash(profile: &str) -> String {
    let j = vault_media::cst::journey(profile).unwrap();
    let (curve, scale, m) = j.kernel_args();
    hash_of(&json!({ "kind": "native-journey", "profile": profile, "label": j.label, "curve": curve, "scale": scale, "matrix": m, "to": "acescct" }))
}

fn idt_name(profile: &str) -> String {
    format!("idt-{profile}")
}

/// What each shape is delivered as (worker.ts): the settings of its files, its channels and description.
struct Files {
    master: Option<VideoSettings>,
    copy: Option<VideoSettings>,
}

/// YouTube at its best: the 4K master alone, HEVC Main10 at 80 Mbps (above YouTube's 35–68 recommended, so its own
/// encode starts from the cleanest picture), a keyframe every second, AAC 384 kb/s.
pub const YOUTUBE_4K_BITRATE: u32 = 80_000_000;

fn files_for(s: &Shape, master_only: bool) -> Files {
    let (w, h) = (s.width, s.height);
    let copy = |cap: u32| Some(VideoSettings { codec: Codec::H264, width: w, height: h, fps: FPS, bitrate: cap / 4 * 3, keyframes: 250, audio_bitrate: 192_000 });
    if master_only {
        let (mw, mh) = s.render_size();
        return Files { master: Some(VideoSettings { codec: Codec::Hevc, width: mw, height: mh, fps: FPS, bitrate: YOUTUBE_4K_BITRATE, keyframes: FPS, audio_bitrate: 384_000 }), copy: None };
    }
    if s.master > 1 {
        // YouTube's 4K upload rate (35–68 Mbps recommended): 50 Mbps on average; ffmpeg's VideoToolbox took a keyframe
        // every 12 frames. The 1080 copy for X and LinkedIn ≤ 20 Mbps.
        let (mw, mh) = s.render_size();
        Files {
            master: Some(VideoSettings { codec: Codec::Hevc, width: mw, height: mh, fps: FPS, bitrate: 50_000_000, keyframes: 12, audio_bitrate: 384_000 }),
            copy: copy(20_000_000),
        }
    } else {
        // 9:16 ≤ 12 Mbps (a 3-minute film under Instagram's 300 MB), the feeds ≤ 20 Mbps
        Files { master: None, copy: copy(if s.portrait() { 12_000_000 } else { 20_000_000 }) }
    }
}

/// Render the timeline. `plates` gives each world clip's plate for a shape; `output` is the output transform.
/// `progress` gets 0…1 and what is happening.
pub fn render(
    t: &Timeline,
    lib: &dyn Library,
    plates: &dyn Fn(&Clip, &Shape) -> Result<Option<Plate>>,
    output: &dyn Output,
    opts: &Options,
    progress: &mut dyn FnMut(f64, &str),
) -> Result<Render> {
    let plan = plan(t, lib)?;
    std::fs::create_dir_all(&opts.work)?;
    // every picture clip's grade and looks as one cube, baked once for each different one
    let mut baked: HashMap<String, Lut3d> = HashMap::new();
    let mut cubes: HashMap<String, (Lut3d, String)> = HashMap::new();
    for c in &plan.pictures {
        if let Some((lut, key)) = clip_cube(t, lib, c, output)? {
            let lut = baked.entry(key.clone()).or_insert(lut).clone();
            cubes.insert(c.id.clone(), (lut, key));
        }
    }
    let shapes: Vec<Shape> = shapes_of(t).into_iter().filter(|s| opts.shapes.as_ref().is_none_or(|only| only.iter().any(|a| a == s.aspect))).collect();
    if shapes.is_empty() {
        bail!("no such shape to render");
    }
    // the world clips' plates, one per shape
    let mut plate_files: HashMap<(String, String), (vault_media::Source, f64)> = HashMap::new();
    let mut plates_used = Vec::new();
    for c in plan.pictures.iter().filter(|c| c.is_world()) {
        for s in &shapes {
            let p = plates(c, s)?.with_context(|| format!("world clip {} (shot {} v{}): no plate for {}", c.id, c.shot.as_deref().unwrap_or("?"), c.shot_version.unwrap_or(0), s.aspect))?;
            plate_files.insert((c.id.clone(), s.aspect.to_string()), (p.file.clone(), p.offset));
            plates_used.push(PlateUse { clip: c.id.clone(), aspect: s.aspect.into(), key: p.key, fingerprint: p.fingerprint, reused: p.reused });
        }
    }

    progress(0.01, "mixing the sound");
    let sound = mix(&plan.audio, plan.total, opts.target, &opts.work, &mut |p| progress(0.01 + 0.03 * p, "mixing the sound"))?;

    let mut gpu = Gpu::new()?;
    let lut = output.lut();
    gpu.set_output(&lut);
    let captions = Captions::new(opts.font.as_deref())?;
    let mut used: BTreeMap<String, String> = BTreeMap::new();
    used.insert(output.name().to_string(), output.hash());
    let base = base_name(t, opts.now);
    let mut deliveries = Vec::new();
    let mut timings = BTreeMap::new();
    for (k, s) in shapes.iter().enumerate() {
        let span = 0.9 / shapes.len() as f64;
        let from = 0.05 + k as f64 * span;
        let started = std::time::Instant::now();
        let made = render_shape(&plan, &cubes, s, &gpu, &captions, &plate_files, &sound, &base, &opts.work, opts.master_only, &mut used, &mut |p| {
            progress(from + span * p, &format!("rendering {}", s.aspect))
        })?;
        timings.insert(s.aspect.to_string(), started.elapsed().as_secs_f64());
        deliveries.extend(made);
    }
    progress(0.96, "checking");
    let long = plan.total > 90.0;
    for d in deliveries.iter_mut() {
        let (w, h) = (d.width, d.height);
        let want = Want {
            seconds: plan.total,
            fps: FPS as f64,
            bit_depth: if d.codec == "hevc" { 10 } else { 8 },
            width: w,
            height: h,
            codec: if d.codec == "hevc" { "hevc" } else { "h264" },
            max_bitrate: Some(if d.codec == "hevc" { (YOUTUBE_4K_BITRATE as f64 * 1.35).max(68e6) } else if h > w { 12e6 } else { 25e6 }),
            max_bytes: (d.aspect == "9:16").then_some(300_000_000),
            max_seconds: (d.aspect == "9:16").then_some(180.0),
        };
        d.qc = qc(&d.file, &want)?;
        if !d.qc.ok {
            bail!("QC: {} — {}", d.name, d.qc.errors.join("; "));
        }
        d.loudness = loudness(&d.file)?;
        if d.aspect == "9:16" && long {
            d.note = Some("Instagram Reels take at most 90 s (via Zernio): post it as a feed video, or cut it down".into());
        }
    }
    let _ = std::fs::remove_file(&sound.wav);
    progress(1.0, "done");
    Ok(Render {
        timeline: t.id.clone(),
        seconds: plan.total,
        deliveries,
        color: ColorReport {
            working: "acescct".into(),
            output: output.name().into(),
            engine: format!("vault-render {} (Core Image on Metal, VideoToolbox)", env!("CARGO_PKG_VERSION")),
            transforms: used,
            look: plan.look,
        },
        conformed: plan.conformed,
        plates: plates_used,
        warnings: plan.warnings,
        sound,
        thumbnails: plan.thumbnails,
        timings,
    })
}

/// What the picture of one piece is read from.
enum Reading {
    Gap,
    Video { reader: VideoReader, offset: f64, args: (f32, f32, [[f32; 3]; 3]) },
    Still { image: Image },
    /// an EXR sequence: the frame on screen, kept while it stays (a 24 fps sequence holds for 30 fps frames)
    Sequence { seq: vault_media::still::Sequence, fps: f64, offset: f64, args: (f32, f32, [[f32; 3]; 3]), shown: Option<(usize, Image)> },
}

#[allow(clippy::too_many_arguments)]
fn render_shape(
    plan: &Plan,
    cubes: &HashMap<String, (Lut3d, String)>,
    s: &Shape,
    gpu: &Gpu,
    captions: &Captions,
    plate_files: &HashMap<(String, String), (vault_media::Source, f64)>,
    sound: &Sound,
    base: &str,
    work: &Path,
    master_only: bool,
    used: &mut BTreeMap<String, String>,
    progress: &mut dyn FnMut(f64),
) -> Result<Vec<Delivery>> {
    let (w, h) = s.render_size();
    let (w1, h1) = (s.width, s.height);
    let fps = FPS as f64;
    let total = plan.total;
    let frames = (total * fps).round() as u64;
    let tag = format!("{base}-{}", s.tag());
    let files = files_for(s, master_only);
    let (master_name, name) = (if master_only { format!("{tag}-4k-youtube.mp4") } else { format!("{tag}-4k-hevc.mp4") }, format!("{tag}.mp4"));
    let mut master = match &files.master {
        Some(v) => Some(Writer::create(&work.join(&master_name), v, Some(&sound.wav))?),
        None => None,
    };
    let mut copy = match &files.copy {
        Some(v) => Some(Writer::create(&work.join(&name), v, Some(&sound.wav))?),
        None => None,
    };

    // the hook over the first seconds — in the 1080 copies only (the 4K master stays clean)
    let hook = match (plan.hooks.get(s.aspect), &plan.card) {
        (Some(file), Some(card)) => Some((gpu.resize(&*gpu.still(file)?, w1, h1)?, card.start)),
        _ => None,
    };
    let fade_in = hook.is_none();
    let fade_out_from = (total - 2.5).max(0.0);

    let pictures: Vec<&Clip> = plan.pictures.iter().collect();
    let cut = pieces(&pictures, total);
    // captions drawn when first needed — each phrase once per word lit — dropped when past
    let mut bands: HashMap<(usize, usize), Image> = HashMap::new();
    let comment = "maiacity:render";

    for piece in &cut {
        let clip = piece.clip.map(|i| pictures[i]);
        let mut reading = match clip {
            None => Reading::Gap,
            Some(c) if c.is_world() => {
                let (file, late) = plate_files.get(&(c.id.clone(), s.aspect.to_string())).context("a world clip without its plate")?;
                let args = vault_media::cst::journey("acescct").unwrap().kernel_args();
                used.insert(idt_name("acescct"), journey_hash("acescct"));
                // the plate starts at the clip's in point (or `late` seconds after it)
                let from = piece.a as f64 / fps - c.start - late;
                let until = piece.b as f64 / fps - c.start - late;
                Reading::Video { reader: VideoReader::open(file, from.max(0.0), until + 1.0 / fps)?, offset: -c.start - late, args }
            }
            Some(c) => {
                let src = plan.sources.get(c.hash.as_deref().unwrap()).context("a picture without its source")?;
                let j = vault_media::cst::journey(&src.profile).unwrap();
                used.insert(idt_name(&src.profile), journey_hash(&src.profile));
                match src.kind {
                    Kind::Still => Reading::Still { image: gpu.journey(&*gpu.still(&src.file)?, j.kernel_args())? },
                    Kind::Sequence { fps: rate } => Reading::Sequence {
                        seq: vault_media::still::Sequence::open(&src.file)?,
                        fps: rate,
                        offset: c.in_ - c.start,
                        args: j.kernel_args(),
                        shown: None,
                    },
                    Kind::Video => {
                        let from = c.in_ + (piece.a as f64 / fps - c.start);
                        let until = c.in_ + (piece.b as f64 / fps - c.start);
                        Reading::Video { reader: VideoReader::open(&src.file, from, until + 1.0 / fps)?, offset: c.in_ - c.start, args: j.kernel_args() }
                    }
                }
            }
        };
        if let Some(b) = clip.and_then(|c| c.balance()) {
            used.insert("grade:balance".into(), hash_of(&json!({ "balance": b })));
        }
        // the clip's grade and looks, as the one cube they were baked into (its hash in the report)
        let looks = clip.and_then(|c| cubes.get(&c.id));
        if let (Some((_, key)), Some(c)) = (looks, clip) {
            used.insert(format!("grade:looks:{}", c.id), key.clone());
        }
        let cube: Option<Cube> = looks.map(|(lut, _)| gpu.cube(lut));
        let finish = plan.finish.clone();
        for n in piece.a..piece.b {
            let t = n as f64 / fps;
            autoreleasepool(|_| -> Result<()> {
                // ── the picture, scene-referred to display-referred ──
                let pic: Image = match &mut reading {
                    Reading::Gap => gpu.black(w, h),
                    Reading::Still { image } => picture(gpu, image, s, clip.unwrap(), cube.as_ref(), finish.as_ref(), n)?,
                    Reading::Sequence { seq, fps: rate, offset, args, shown } => {
                        // the sequence's frame on screen half a film frame on, as for a movie
                        let i = seq.index_at(t + *offset + 0.5 / fps - 1e-4, *rate);
                        if shown.as_ref().is_none_or(|(k, _)| *k != i) {
                            let img = gpu.journey(&*sequence_frame(seq, i)?, *args)?;
                            *shown = Some((i, img));
                        }
                        picture(gpu, &shown.as_ref().unwrap().1, s, clip.unwrap(), cube.as_ref(), finish.as_ref(), n)?
                    }
                    Reading::Video { reader, offset, args } => {
                        // the frame on screen half a frame on (ffmpeg's fps filter rounds to the nearest)
                        let at = t + *offset + 0.5 / fps - 1e-4;
                        let turn = reader.info.transform;
                        let pb = reader.at(at)?.context("no frame")?;
                        let img = gpu.journey(&gpu.orient(&gpu.frame(pb), turn), *args)?;
                        picture(gpu, &img, s, clip.unwrap(), cube.as_ref(), finish.as_ref(), n)?
                    }
                };
                // ── fades in display space: up from black (a film without a hook), down to black at the end ──
                let mut k = 1.0f64;
                if fade_in {
                    k *= (t / 1.2).clamp(0.0, 1.0);
                }
                k *= (1.0 - (t - fade_out_from) / 2.5).clamp(0.0, 1.0);
                let mut pic = gpu.gain(&pic, k)?;
                // ── graphics on top, never graded: the captions, each fading in and out on its phrase ──
                for (i, p) in plan.phrases.iter().enumerate() {
                    let a = (p.start - 0.08).max(0.0);
                    let b = (p.end + 0.3).min(total);
                    let d = (b - a).max(0.3);
                    if t < a || t > b {
                        if t > b {
                            bands.retain(|(k, _), _| *k != i);
                        }
                        continue;
                    }
                    let alpha = ((t - a) / 0.25).clamp(0.0, 1.0) * (1.0 - (t - (a + d - 0.25)) / 0.25).clamp(0.0, 1.0);
                    // word by word, as the studio plays it: a word lights up when it is said
                    let lit = p.words.iter().filter(|(_, at)| *at <= t).count();
                    if let std::collections::hash_map::Entry::Vacant(e) = bands.entry((i, lit)) {
                        let words: Vec<String> = p.words.iter().map(|(w, _)| w.clone()).collect();
                        e.insert(gpu.cg_image(&captions.draw_lit(&words, lit, w, h)?.image));
                    }
                    let band = gpu.opacity(&bands[&(i, lit)], alpha)?;
                    pic = gpu.over(&band, &pic);
                }
                let hooked = |pic: &Image| -> Result<Image> {
                    Ok(match &hook {
                        Some((layer, at)) if t >= *at && t <= at + HOOK => gpu.over(layer, pic),
                        _ => pic.clone(),
                    })
                };
                let seed = (n % 9973) as f64;
                match (&mut master, &mut copy) {
                    (Some(m), Some(copy)) => {
                        // the 4K master, 10-bit; the 1080 copy from each master frame: scaled, the hook on top, dithered to 8 bits
                        let buf = m.buffer()?;
                        gpu.render(&pic, &buf, w, h);
                        let small = gpu.resize(&gpu.frame(&buf), w1, h1)?;
                        let small = gpu.dither(&*hooked(&small)?, 1.0 / 219.0, seed)?;
                        let cbuf = copy.buffer()?;
                        gpu.render(&small, &cbuf, w1, h1);
                        m.push(&buf)?;
                        copy.push(&cbuf)?;
                    }
                    (Some(m), None) => {
                        // the 4K master alone, 10-bit
                        let buf = m.buffer()?;
                        gpu.render(&pic, &buf, w, h);
                        m.push(&buf)?;
                    }
                    (None, Some(copy)) => {
                        let out = gpu.dither(&*hooked(&pic)?, 1.0 / 219.0, seed)?;
                        let buf = copy.buffer()?;
                        gpu.render(&out, &buf, w, h);
                        copy.push(&buf)?;
                    }
                    (None, None) => {}
                }
                Ok(())
            })?;
            if n % 15 == 0 {
                progress(n as f64 / frames as f64 * 0.95);
            }
        }
    }
    let mut out = Vec::new();
    let hooked = if hook.is_some() { format!(" · the hook over its first {HOOK} s") } else { String::new() };
    if let Some(m) = master {
        let file = m.finish(comment)?;
        let what = if master_only { format!("4K for YouTube · HEVC 10-bit · {w}×{h} · {} Mb/s", YOUTUBE_4K_BITRATE / 1_000_000) } else { format!("4K master · HEVC 10-bit · {w}×{h}") };
        out.push(delivery(file, master_name, &["youtube"], what, s, w, h, "hevc"));
    }
    let Some(copy) = copy else {
        progress(1.0);
        return Ok(out);
    };
    let file = copy.finish(comment)?;
    let (channels, format): (Vec<&str>, String) = match s.aspect {
        "16:9" => (vec!["x", "linkedin"], format!("H.264 · {w1}×{h1}{hooked}")),
        "9:16" => (
            if total <= 180.0 { vec!["instagram", "youtube"] } else { vec!["instagram"] },
            format!("H.264 · {w1}×{h1} · 30 fps · Reel{}{hooked}", if total <= 180.0 { " and Short" } else { "" }),
        ),
        _ => (vec!["instagram"], format!("H.264 · {w1}×{h1} · feed{hooked}")),
    };
    out.push(delivery(file, name, &channels, format, s, w1, h1, "h264"));
    progress(1.0);
    Ok(out)
}

#[allow(clippy::too_many_arguments)]
fn delivery(file: PathBuf, name: String, channels: &[&str], format: String, s: &Shape, width: u32, height: u32, codec: &str) -> Delivery {
    Delivery {
        file,
        name,
        channels: channels.iter().map(|c| c.to_string()).collect(),
        format,
        aspect: s.aspect.into(),
        width,
        height,
        codec: codec.into(),
        note: None,
        qc: Qc {
            ok: false,
            errors: vec![],
            warnings: vec![],
            frames: 0,
            expected_frames: 0,
            seconds: 0.0,
            pix_fmt: String::new(),
            bit_depth: 0,
            tags: Default::default(),
            bitrate: 0,
            bytes: 0,
        },
        loudness: Loudness::default(),
        hash: None,
    }
}

/// A clip's picture after its journey, framed for the shape, through its whole grade (`chain`).
fn picture(gpu: &Gpu, acescct: &Image, s: &Shape, c: &Clip, looks: Option<&Cube>, finish: Option<&Finish>, frame: u64) -> Result<Image> {
    let (w, h) = s.render_size();
    let framed = gpu.frame_to(acescct, w, h, c.frame_for(s.aspect))?;
    gpu.output(&*chain(gpu, &framed, w, h, c, looks, finish, frame)?)
}

/// A clip's framed picture (ACEScct, `w`×`h`) through its whole grade, still in ACEScct: its balance, its secondaries
/// (a face-tracked window on the face Vision finds in this frame), its grade and looks (one cube: its own CDL, its
/// scene's look, the film's), the film's finishing (frame `frame`: the grain's seed). The output transform is the
/// caller's.
#[allow(clippy::too_many_arguments)]
pub fn chain(gpu: &Gpu, framed: &Image, w: u32, h: u32, c: &Clip, looks: Option<&Cube>, finish: Option<&Finish>, frame: u64) -> Result<Image> {
    chain_with(gpu, framed, w, h, c, looks, finish, frame, &mut |gpu, pic| Ok(crate::look::faces(&*gpu.output(pic)?).first().copied()))
}

/// `chain`, with where the face is found by `face_of` (from the balanced picture, ACEScct) — the player tracks it
/// every few frames on a small copy instead of on every frame.
#[allow(clippy::too_many_arguments)]
pub fn chain_with(
    gpu: &Gpu,
    framed: &Image,
    w: u32,
    h: u32,
    c: &Clip,
    looks: Option<&Cube>,
    finish: Option<&Finish>,
    frame: u64,
    face_of: &mut dyn FnMut(&Gpu, &Image) -> Result<Option<crate::look::Rect>>,
) -> Result<Image> {
    let mut pic = gpu.balance(framed, c.balance().as_ref())?;
    let secs = c.secondaries();
    if !secs.is_empty() {
        let face = if secs.iter().any(|s| s.window.as_ref().is_some_and(|w| w.track.is_some())) { face_of(gpu, &pic)? } else { None };
        pic = apply_secondaries(gpu, &pic, &secs, face, w as f64, h as f64)?;
    }
    if let Some(cube) = looks {
        pic = gpu.apply_cube(&pic, cube)?;
    }
    if let Some(f) = finish {
        pic = apply_finish(gpu, &pic, f, frame, h as f64)?;
    }
    Ok(pic)
}

/// A look's creative LUT, loaded from the vault by its hash.
fn look_lut(lib: &dyn Library, l: &Look) -> Result<Option<Lut3d>> {
    let Some(h) = &l.lut else { return Ok(None) };
    let text = String::from_utf8(lib.file(h)?.read_all()?).context("a creative LUT is text (.cube)")?;
    Ok(Some(Lut3d::from_cube_str(h, &text)?))
}

/// A clip's colour after its balance as one cube (65³, ACEScct in and out): its own CDL, then its scene's look, then
/// the film's — with the hash that names it. None when it has none of them.
pub fn clip_cube(t: &Timeline, lib: &dyn Library, c: &Clip, output: &dyn Output) -> Result<Option<(Lut3d, String)>> {
    let grades: Vec<Cdl> = c.cdl().into_iter().collect();
    let looks = t.looks_for(c);
    if grades.is_empty() && looks.is_empty() {
        return Ok(None);
    }
    let key = hash_of(&json!({ "grades": grades.iter().map(Cdl::to_json).collect::<Vec<_>>(), "looks": looks, "output": output.hash() }));
    let luts = looks.iter().map(|l| look_lut(lib, l)).collect::<Result<Vec<_>>>()?;
    let ready: Vec<Ready> = looks.iter().zip(luts).map(|(l, lut)| Ready::new(l, lut)).collect();
    let data = crate::creative::bake(None, &grades, &ready, output, 65);
    Ok(Some((Lut3d::from_rgb(&format!("look-{key}"), 65, data)?, key)))
}

/// What a shot's picture is like, in ACEScct, as a colourist reads it: its luma (Rec.709 weights, as the balance
/// reads it) at the percentiles, and the colour of its middle tones (the pixels between the 25th and the 75th
/// percentile of luma), measured on `n` frames spread over the clip — before its balance (`as_shot`) and after it.
pub fn measure(t: &Timeline, lib: &dyn Library, c: &Clip, n: usize) -> Result<Value> {
    let s = Shape::of(&t.aspect).or_else(|| Shape::of("16:9")).context("no shape")?;
    let (w, h) = (192u32, (192.0 * s.render_size().1 as f64 / s.render_size().0 as f64).round() as u32);
    let gpu = Gpu::new()?;
    let mut px: Vec<[f64; 3]> = Vec::new();
    let mut at_s = Vec::new();
    // a shot with its grading still (4K ACEScct from the original): measured on that one frame
    let from_still = grade_still_of(lib, c).is_some();
    let n = if from_still { 1 } else { n };
    for i in 0..n.max(1) {
        // frames at the middle of n equal parts of the clip
        let at = c.start + c.dur * (i as f64 + 0.5) / n.max(1) as f64;
        let src = source(&gpu, lib, c, at)?;
        let framed = gpu.frame_to(&src, w, h, c.frame_for(s.aspect))?;
        let f = gpu.read(&framed, w, h);
        px.extend(f.chunks_exact(4).map(|p| [p[0] as f64, p[1] as f64, p[2] as f64]));
        at_s.push((at * 1000.0).round() / 1000.0);
    }
    let bal = c.balance().unwrap_or_default();
    let after: Vec<[f64; 3]> = px.iter().map(|p| bal.apply(*p)).collect();
    Ok(json!({ "clip": c.id, "from": if from_still { "its grading still" } else { "its original (or proxy)" }, "frames_at": at_s, "as_shot": stats(&px), "balanced": stats(&after), "balance": bal }))
}

/// Luma percentiles and the middle tones' colour of ACEScct pixels (see `measure`); the colour also as the white
/// balance that would make the middle tones grey (in the balance's stops).
pub fn stats(px: &[[f64; 3]]) -> Value {
    use crate::grade::{LUMA, STOP};
    let luma = |p: &[f64; 3]| p[0] * LUMA[0] + p[1] * LUMA[1] + p[2] * LUMA[2];
    let mut l: Vec<f64> = px.iter().map(luma).collect();
    l.sort_by(|a, b| a.total_cmp(b));
    let q = |p: f64| if l.is_empty() { 0.0 } else { l[((l.len() - 1) as f64 * p).round() as usize] };
    let (lo, hi) = (q(0.25), q(0.75));
    let mids: Vec<&[f64; 3]> = px.iter().filter(|p| (lo..=hi).contains(&luma(p))).collect();
    let mean: [f64; 3] = std::array::from_fn(|i| mids.iter().map(|p| p[i]).sum::<f64>() / mids.len().max(1) as f64);
    let r3 = |x: f64| (x * 1000.0).round() / 1000.0;
    let pct: serde_json::Map<String, Value> = [1, 5, 25, 50, 75, 95, 99].iter().map(|p| (format!("p{p}"), json!(r3(q(*p as f64 / 100.0))))).collect();
    json!({
        "luma": pct,
        "mid_rgb": mean.map(r3),
        // the white balance that would bring the middle tones to grey: warmer when red is below blue, …
        "to_grey": { "temp": r3((mean[2] - mean[0]) / STOP), "tint": r3((mean[1] - (mean[0] + mean[2]) / 2.0) / STOP) },
        // how far the middle grey of the picture is from 18 % grey, in stops
        "mid_stops": r3((q(0.5) - crate::grade::PIVOT) / STOP),
    })
}

/// How each sound clip of a timeline sounds (BS.1770, as the render's own levelling measures): its loudness (LUFS)
/// and true peak as recorded, over the part the clip plays, through its EQ, and at its volume; its spectrum (octave
/// bands, `eq::spectrum`) to compare its tone with another's; a loudness curve (every 0.5 s, the
/// clip's own clock) to draw; and, per voice clip, how far the music under it sits below it (the render keys the
/// music down about 6 dB while the voice speaks). Read from each file's audio proxy when there is one.
pub fn measure_sound(t: &Timeline, lib: &dyn Library) -> Result<Value> {
    use crate::loudness::measure as loud;
    const STEP: f64 = 0.5;
    const DUCK_DB: f64 = 6.0;
    let db = |v: f64| if v > 0.0 { 20.0 * v.log10() } else { f64::NEG_INFINITY };
    let r2 = |x: f64| (x * 100.0).round() / 100.0;
    let mut out = Vec::new();
    // the sound tracks, and a video's own sound on the picture track where it plays (as the render mixes it)
    let own_sound = |c: &Clip| c.track == "V1" && c.vol > 0.0 && !c.is_world() && c.hash.as_deref().and_then(|h| lib.media(h)).is_some_and(|m| m.kind == "video");
    for c in t.clips.iter().filter(|c| (c.track.starts_with('A') || own_sound(c)) && c.hash.is_some()) {
        let hash = c.hash.as_deref().unwrap();
        let m = lib.media(hash);
        let name = m.as_ref().map(|m| if m.title.is_empty() { m.hash[..10].to_string() } else { m.title.clone() }).unwrap_or_default();
        // the original itself, as the render mixes it: sound has no proxy
        let file = match lib.file(hash) {
            Ok(f) => f,
            Err(e) => {
                out.push(json!({ "clip": c.id, "track": c.track, "name": name, "error": format!("{e:#}") }));
                continue;
            }
        };
        let mut frames: Vec<f32> = Vec::new();
        if let Some(mut r) = crate::av::AudioReader::open(&file, c.in_, c.in_ + c.dur)? {
            while let Some((_, chunk)) = r.next_chunk()? {
                frames.extend(chunk);
            }
        }
        let want = (c.dur * crate::av::RATE as f64).round() as usize * 2;
        frames.truncate(want);
        // through its EQ, as the render mixes it
        let eq = c.eq();
        crate::eq::Eq::new(&eq, crate::av::RATE as f64).process(&mut frames);
        // and along its gain keys
        let keys = c.keys.as_ref().map(crate::sound::clean_keys).unwrap_or_default();
        crate::sound::apply_keys(&mut frames, &keys);
        let whole = loud(&frames, crate::av::RATE, 2);
        let spectrum = crate::eq::spectrum(&frames, crate::av::RATE);
        let block = (STEP * crate::av::RATE as f64) as usize * 2;
        let curve: Vec<Value> = frames.chunks(block).map(|b| loud(b, crate::av::RATE, 2).lufs.map(r2).map(Value::from).unwrap_or(Value::Null)).collect();
        let g = db(c.vol);
        out.push(json!({
            "clip": c.id, "track": c.track, "name": name, "start": c.start, "dur": c.dur, "vol": c.vol, "gain_db": r2(g),
            "fin": c.fin, "fout": c.fout,
            "lufs": whole.lufs.map(r2), "true_peak": whole.true_peak.map(r2),
            "lufs_at_vol": whole.lufs.map(|l| r2(l + g)), "true_peak_at_vol": whole.true_peak.map(|p| r2(p + g)),
            "curve_step": STEP, "curve": curve,
            "eq": eq, "keys": keys, "spectrum": spectrum.map(|s| crate::eq::OCTAVES.iter().zip(s).map(|(f, v)| json!([f, v])).collect::<Vec<_>>()),
        }));
    }
    // the music under each voice clip, at their volumes, the music keyed down while the voice speaks
    let at_vol = |v: &Value, from: f64, to: f64| -> Option<f64> {
        let (start, step, g) = (v["start"].as_f64()?, v["curve_step"].as_f64()?, v["gain_db"].as_f64()?);
        let vals: Vec<f64> = v["curve"].as_array()?.iter().enumerate().filter(|(i, _)| {
            let t = start + *i as f64 * step;
            t >= from && t < to
        }).filter_map(|(_, x)| x.as_f64()).collect();
        if vals.is_empty() {
            return None;
        }
        // loudness of the stretch: the energy mean of its blocks
        let e = vals.iter().map(|l| 10f64.powf(l / 10.0)).sum::<f64>() / vals.len() as f64;
        Some(10.0 * e.log10() + g)
    };
    let mut under = Vec::new();
    for v in out.iter().filter(|v| v["track"] == "A1" && v.get("error").is_none()) {
        let (from, to) = (v["start"].as_f64().unwrap_or(0.0), v["start"].as_f64().unwrap_or(0.0) + v["dur"].as_f64().unwrap_or(0.0));
        let voice = at_vol(v, from, to);
        for m in out.iter().filter(|m| m["track"] == "A2" && m.get("error").is_none()) {
            if let (Some(vo), Some(mu)) = (voice, at_vol(m, from, to)) {
                under.push(json!({ "voice": v["clip"], "music": m["clip"], "voice_lufs": r2(vo), "music_lufs": r2(mu - DUCK_DB), "voice_over_music_lu": r2(vo - (mu - DUCK_DB)) }));
            }
        }
    }
    Ok(json!({ "clips": out, "voice_over_music": under, "duck_db": DUCK_DB, "master": "the render levels the whole mix to −14 LUFS, −1 dBTP",
        "spectrum": "per clip [Hz, dB]: each octave's share of its energy where it speaks, through its EQ" }))
}

/// A clip's original's grading still (its `meta.grade_still`), when the vault has it and its frame is in the part of
/// the file the clip plays (else the clip's own frames are measured: a still of another moment says little).
fn grade_still_of(lib: &dyn Library, c: &Clip) -> Option<Media> {
    let hash = c.hash.as_deref()?;
    let original = lib.media(&lib.original_of(hash)).or_else(|| lib.media(hash))?;
    let mut stills = lib.stills_of(&original.hash);
    if let Some(s) = original.meta.get("grade_still").and_then(Value::as_str).and_then(|h| lib.media(h)) {
        stills.push(s);
    }
    // the one inside the shot nearest its middle (a shot's own still, made for it)
    let mid = c.in_ + c.dur / 2.0;
    let t = |m: &Media| m.meta.get("t").and_then(Value::as_f64);
    stills.into_iter().filter(|m| t(m).is_some_and(|t| t >= c.in_ && t <= c.in_ + c.dur)).min_by(|a, b| (t(a).unwrap() - mid).abs().total_cmp(&(t(b).unwrap() - mid).abs()))
}

/// A shot's grading still: one frame of the original at `at` seconds, through its journey (CST) into ACEScct,
/// scaled (Lanczos) to `width` wide at its own aspect, written as a 16-bit PNG of ACEScct code values — what the
/// balance is measured and set on, at full quality, without reading the whole original again.
pub fn grading_still(file: impl Into<vault_media::Source>, profile: &str, at: f64, width: u32, png: &Path) -> Result<(u32, u32)> {
    grading_still_and_preview(file, profile, at, width, png, None)
}

/// The grading still, and from the same frame a small preview for the lists: `preview` (its JPEG, its width, the
/// output transform) — the frame through ACES 2.0 into Rec.709, as it will look.
pub fn grading_still_and_preview(file: impl Into<vault_media::Source>, profile: &str, at: f64, width: u32, png: &Path, preview: Option<(&Path, u32, &dyn Output)>) -> Result<(u32, u32)> {
    let mut gpu = Gpu::new()?;
    if let Some((_, _, out)) = preview {
        gpu.set_output(&out.lut());
    }
    let img = frame_in_cct(&gpu, file, profile, at)?;
    let e = crate::gpu::Extent::ext(&*img);
    let (sw, sh) = (e.size.width.max(1.0), e.size.height.max(1.0));
    let w = width.min(sw.round() as u32).max(2);
    let h = ((w as f64 * sh / sw).round() as u32).max(2);
    let scaled = gpu.frame_to(&img, w, h, None)?;
    gpu.png(&scaled, w, h, png)?;
    if let Some((jpg, pw, _)) = preview {
        let ph = ((pw as f64 * sh / sw).round() as u32).max(2);
        let small = gpu.frame_to(&img, pw, ph, None)?;
        gpu.jpeg(&*gpu.output(&small)?, pw, ph, jpg)?;
    }
    Ok((w, h))
}

/// One frame of a file at `at` seconds (its own clock), into ACEScct through its journey from `profile`: a grading
/// still's frame, and what the Grade tab shows of a proxy or an original before the clip's chain.
pub fn frame_in_cct(gpu: &Gpu, file: impl Into<vault_media::Source>, profile: &str, at: f64) -> Result<Image> {
    let journey = vault_media::cst::journey(profile).with_context(|| format!("no colour journey from {profile} into ACEScct"))?;
    let mut r = VideoReader::open(file, at, at + 1.0 / FPS as f64)?;
    let turn = r.info.transform;
    let pb = r.at(at + 0.5 / FPS as f64 - 1e-4)?.context("no frame there")?;
    gpu.journey(&gpu.orient(&gpu.frame(pb), turn), journey.kernel_args())
}

/// One frame of a media clip, into ACEScct (the hero frame's reading, without the world) — from the full original,
/// else (its bytes not on this Mac) from its ACEScct proxy.
fn source(gpu: &Gpu, lib: &dyn Library, c: &Clip, at: f64) -> Result<Image> {
    if let Some(still) = grade_still_of(lib, c) {
        if let Ok(file) = lib.file(&still.hash) {
            // ACEScct code values already: no journey
            return gpu.still(&file);
        }
    }
    frame_of(gpu, lib, c, at, true)
}

/// A clip's grading still, when its frame is in the clip (`look`: what the base correction reads first).
pub(crate) fn grade_still_of_clip(lib: &dyn Library, c: &Clip) -> Option<Media> {
    grade_still_of(lib, c)
}

/// One frame of a media clip at `at` on the timeline, into ACEScct, from its original only: an error, never its
/// proxy, when the original isn't on this Mac.
pub(crate) fn original_frame(gpu: &Gpu, lib: &dyn Library, c: &Clip, at: f64) -> Result<Image> {
    frame_of(gpu, lib, c, at, false)
}

fn frame_of(gpu: &Gpu, lib: &dyn Library, c: &Clip, at: f64, proxy_ok: bool) -> Result<Image> {
    let hash = c.hash.as_deref().context("only a clip with a file can be measured")?;
    let of = lib.original_of(hash);
    let original = lib.media(&of).or_else(|| lib.media(hash)).context("the clip's file is not in the vault")?;
    let proxy = original.meta.get("proxy").and_then(Value::as_str).and_then(|p| lib.media(p));
    let (m, file) = match lib.file(&original.hash) {
        Ok(f) => (original, f),
        Err(e) if proxy_ok => {
            let p = proxy.ok_or(e)?;
            let f = lib.file(&p.hash)?;
            (p, f)
        }
        Err(e) => return Err(e.context("the shot's original isn't on this Mac (a proxy is never measured)")),
    };
    let from = c.in_ + (at - c.start);
    if is_sequence(&m) {
        let profile = sequence_profile(&m, &file)?.0.unwrap_or_else(|| "linear-rec709".into());
        let args = vault_media::cst::journey(&profile).or_else(|| vault_media::cst::journey("rec709")).unwrap().kernel_args();
        let mut seq = vault_media::still::Sequence::open(&file)?;
        let i = seq.index_at(from + 0.5 / FPS as f64 - 1e-4, sequence_fps(&m));
        return gpu.journey(&*sequence_frame(&mut seq, i)?, args);
    }
    let still = is_still(&m, &file);
    let profile = profile_of(&m, &file, still).0;
    let profile = if vault_media::cst::journey(&profile).is_some() { profile } else { "rec709".into() };
    let args = vault_media::cst::journey(&profile).unwrap().kernel_args();
    if still {
        return gpu.journey(&*gpu.still(&file)?, args);
    }
    let mut r = VideoReader::open(&file, from, from + 1.0 / FPS as f64)?;
    let turn = r.info.transform;
    let pb = r.at(from + 0.5 / FPS as f64 - 1e-4)?.context("no frame there")?;
    gpu.journey(&gpu.orient(&gpu.frame(pb), turn), args)
}

/// A hero frame (worker.ts `heroFrame`, the `frame` job): the picture of the timeline at `at` seconds in one shape, at
/// that delivery's full resolution, through exactly the chain the render takes — conformed original or world plate →
/// its journey → framing → clip grade → film look → output transform — without the fades and graphics, as a 16-bit
/// PNG. Returns the job's report (`{ t, shape, width, height, clip, what }`).
pub fn hero_frame(
    t: &Timeline,
    lib: &dyn Library,
    plates: &dyn Fn(&Clip, &Shape) -> Result<Option<Plate>>,
    output: &dyn Output,
    at: f64,
    aspect: &str,
    png: &Path,
) -> Result<Value> {
    let s = Shape::of(aspect).with_context(|| format!("no such shape: {aspect}"))?;
    let (w, h) = s.render_size();
    let has_cards = |c: &Clip| lib.media(c.hash.as_deref().unwrap_or("")).is_some_and(|m| m.meta.get("cards").is_some_and(|v| v.is_object()));
    let clip = t
        .clips
        .iter()
        .filter(|c| c.track == "V1" && (c.is_world() || (c.hash.as_deref().is_some_and(|h| lib.media(h).is_some()) && !has_cards(c))))
        .rfind(|c| c.start <= at && at < c.end());
    let mut gpu = Gpu::new()?;
    gpu.set_output(&output.lut());
    let (img, what) = match clip {
        None => (gpu.black(w, h), "a gap: black".to_string()),
        Some(c) => {
            let mut sequence: Option<f64> = None;
            let (file, profile, from, what) = if c.is_world() {
                let p = plates(c, &s)?.with_context(|| format!("world clip {}: no plate for {aspect}", c.id))?;
                (vault_media::Source::from(p.file), "acescct".to_string(), at - c.start - p.offset, format!("world shot {} v{} at {:.3} s", c.shot.as_deref().unwrap_or("?"), c.shot_version.unwrap_or(0), c.in_ + at - c.start))
            } else {
                let hash = c.hash.as_deref().unwrap();
                let of = lib.original_of(hash);
                let m = lib.media(&of).or_else(|| lib.media(hash)).context("the clip's file is not in the vault")?;
                let file = lib.file(&m.hash)?;
                let profile = if is_sequence(&m) {
                    sequence = Some(sequence_fps(&m));
                    sequence_profile(&m, &file)?.0.unwrap_or_else(|| "linear-rec709".into())
                } else {
                    profile_of(&m, &file, is_still(&m, &file)).0
                };
                let profile = if vault_media::cst::journey(&profile).is_some() { profile } else { "rec709".into() };
                let from = c.in_ + (at - c.start);
                let title = if m.title.is_empty() { m.hash.clone() } else { m.title.clone() };
                (file, profile, from, format!("{title} at {from:.3} s"))
            };
            let args = vault_media::cst::journey(&profile).unwrap().kernel_args();
            let m = lib.media(c.hash.as_deref().unwrap_or("")).unwrap_or_default();
            let src = if let Some(rate) = sequence {
                let mut seq = vault_media::still::Sequence::open(&file)?;
                let i = seq.index_at(from + 0.5 / FPS as f64 - 1e-4, rate);
                gpu.journey(&*sequence_frame(&mut seq, i)?, args)?
            } else if !c.is_world() && is_still(&m, &file) {
                gpu.journey(&*gpu.still(&file)?, args)?
            } else {
                let mut r = VideoReader::open(&file, from, from + 1.0 / FPS as f64)?;
                let turn = r.info.transform;
                let pb = r.at(from + 0.5 / FPS as f64 - 1e-4)?.context("no frame there")?;
                gpu.journey(&gpu.orient(&gpu.frame(pb), turn), args)?
            };
            let cube = clip_cube(t, lib, c, output)?.map(|(lut, _)| gpu.cube(&lut));
            (picture(&gpu, &src, &s, c, cube.as_ref(), t.finish().as_ref(), (at * FPS as f64).round() as u64)?, what)
        }
    };
    gpu.png(&img, w, h, png)?;
    Ok(json!({ "t": at, "shape": aspect, "width": w, "height": h, "clip": clip.map(|c| c.id.clone()), "what": what }))
}

/// A file's graded still (the `frame` job of a media clip): its grading still — the ACEScct frame it is graded on —
/// through clip `clip`'s chain as the render takes it (16:9 framing → balance → secondaries → grade and looks →
/// finishing → output transform), `width` wide, as a JPEG: the file's one preview, its thumbnail everywhere. Without
/// its grading still on this Mac, the same moment read from the original (or its proxy). Returns `{ of, t, clip,
/// width, height, what }` — `of` the original, `t` the moment (seconds into it).
pub fn graded_still(t: &Timeline, lib: &dyn Library, output: &dyn Output, clip: &str, width: u32, jpg: &Path) -> Result<Value> {
    let c = t.clips.iter().find(|c| c.id == clip).with_context(|| format!("no clip {clip} on the timeline"))?;
    let hash = c.hash.as_deref().filter(|_| !c.is_world()).context("only a clip with a file has a graded still")?;
    let original = lib.media(&lib.original_of(hash)).or_else(|| lib.media(hash)).context("the clip's file is not in the vault")?;
    let s = Shape::of("16:9").context("no shape 16:9")?;
    let (w, h) = (width, (width as f64 * s.render_size().1 as f64 / s.render_size().0 as f64).round() as u32);
    let mut gpu = Gpu::new()?;
    gpu.set_output(&output.lut());
    let still = original.meta.get("grade_still").and_then(Value::as_str).and_then(|h| lib.media(h));
    let at = still.as_ref().and_then(|m| m.meta.get("t")?.as_f64()).unwrap_or(c.in_ + c.dur / 2.0);
    let (src, what) = match still.as_ref().map(|m| lib.file(&m.hash)) {
        // ACEScct code values already: no journey
        Some(Ok(file)) => (gpu.still(&file)?, "its grading still"),
        _ => (frame_of(&gpu, lib, c, c.start + (at - c.in_), true)?, "the original's frame (no grading still here)"),
    };
    let cube = clip_cube(t, lib, c, output)?.map(|(lut, _)| gpu.cube(&lut));
    let framed = gpu.frame_to(&src, w, h, c.frame_for(s.aspect))?;
    let img = gpu.output(&*chain(&gpu, &framed, w, h, c, cube.as_ref(), t.finish().as_ref(), 0)?)?;
    gpu.jpeg(&img, w, h, jpg)?;
    Ok(json!({ "of": original.hash, "t": at, "clip": c.id, "width": w, "height": h, "what": format!("{} at {at:.3} s, from {what}", if original.title.is_empty() { &original.hash } else { &original.title }) }))
}

// ── the job's result, as the worker hands it to the API ──────────────────────────────────────────────────────────

/// Does the API take this report of a job (`PUT /api/renders/:id`)? What `reportRender` (api/src/renders.ts) checks —
/// a status of rendering, done or failed; progress 0…1; the output named by its hash (64 hex); the report an object —
/// and what the calendar keeps of each delivery (content.ts `Delivery`: channels, the file by its hash, format,
/// aspect, width, height, codec, bytes, seconds; a kind of video or thumbnail). The note may be long: the API keeps
/// its first 300 characters.
pub fn api_accepts(body: &Value) -> Result<()> {
    let hex64 = |v: &Value| v.as_str().is_some_and(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()));
    let field = |k: &str| body.get(k).filter(|v| !v.is_null());
    if let Some(s) = field("status").filter(|s| !matches!(s.as_str(), Some("rendering" | "done" | "failed"))) {
        bail!("a worker reports rendering, done or failed — not {s}");
    }
    if let Some(p) = field("progress").filter(|p| !p.as_f64().is_some_and(|p| (0.0..=1.0).contains(&p))) {
        bail!("progress is 0…1, not {p}");
    }
    if let Some(o) = field("output_hash").filter(|o| !hex64(o)) {
        bail!("a job's output is named by its hash (64 hex), not {o}");
    }
    if field("report").is_some_and(|r| !r.is_object()) {
        bail!("the report is an object");
    }
    if let Some(ds) = body.get("deliveries").filter(|d| !d.is_null()) {
        let ds = ds.as_array().context("the deliveries are a list")?;
        for (i, d) in ds.iter().enumerate() {
            let has = |k: &str, ok: fn(&Value) -> bool| d.get(k).is_some_and(ok);
            let ok = hex64(&d["hash"])
                && has("channels", |v| v.as_array().is_some_and(|a| a.iter().all(Value::is_string)))
                && ["format", "aspect", "codec"].iter().all(|k| has(k, Value::is_string))
                && ["width", "height", "bytes", "seconds"].iter().all(|k| has(k, Value::is_number))
                && d.get("kind").is_none_or(|k| matches!(k.as_str(), Some("video" | "thumbnail")));
            if !ok {
                bail!("delivery {i} is not one the calendar keeps: {d}");
            }
        }
    }
    Ok(())
}

/// What the app writes into the vault for a delivery (worker.ts's `add(o.file, { … })`).
#[derive(Debug, Clone, Serialize)]
pub struct About {
    pub name: String,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub meta: Value,
}

impl Render {
    fn qc_meta(d: &Delivery) -> Value {
        json!({
            "frames": d.qc.frames, "seconds": (d.qc.seconds * 1000.0).round() / 1000.0, "bitDepth": d.qc.bit_depth,
            "tags": d.qc.tags, "bitrate": d.qc.bitrate, "warnings": d.qc.warnings,
        })
    }

    /// How each delivery goes into the vault: its name, title, description, tags and meta, as the worker wrote them.
    pub fn about(&self, t: &Timeline, d: &Delivery) -> About {
        let title = format!("{} {} · {}", t.project.as_deref().unwrap_or(""), t.variant.as_deref().unwrap_or(""), t.name).trim().to_string();
        let mut tags = vec![t.project.clone().unwrap_or_else(|| "film".into()), "role:render".into()];
        if let Some(v) = &t.variant {
            tags.push(format!("cut:{v}"));
        }
        tags.push(format!("aspect:{}", d.aspect));
        tags.push(format!("codec:{}", d.codec));
        About {
            name: d.name.clone(),
            title: format!("{title} · {} {}", d.aspect, d.codec),
            description: format!("{} · for {}", d.format, d.channels.join(", ")),
            tags,
            meta: json!({
                "timeline": t.id, "duration_s": (self.seconds * 100.0).round() / 100.0, "format": d.format,
                "color": self.color_json(), "qc": Self::qc_meta(d), "loudness": d.loudness,
            }),
        }
    }

    fn color_json(&self) -> Value {
        json!({ "working": self.color.working, "output": self.color.output, "engine": self.color.engine, "transforms": self.color.transforms, "look": self.color.look })
    }

    /// The job's result for `PUT /api/renders/:id` once every delivery has its vault hash: `{ output_hash, deliveries,
    /// report }` — the film the studio plays (the 1080 H.264 cut of the timeline's own frame; a render of the 4K master
    /// alone, the master), every delivery with its
    /// thumbnails, and the report (colour, conform, plates, warnings, per delivery QC and loudness, the sound).
    pub fn job_result(&self, t: &Timeline) -> Result<Value> {
        let mut deliveries: Vec<Value> = Vec::new();
        for d in &self.deliveries {
            let hash = d.hash.clone().with_context(|| format!("{} is not in the vault yet", d.name))?;
            let mut v = json!({
                "channels": d.channels, "hash": hash, "mime": "video/mp4", "format": d.format, "aspect": d.aspect,
                "width": d.width, "height": d.height, "codec": d.codec, "bytes": d.qc.bytes,
                "seconds": (self.seconds * 100.0).round() / 100.0, "qc": Self::qc_meta(d), "loudness": d.loudness,
            });
            if let Some(n) = &d.note {
                v["note"] = json!(n);
            }
            deliveries.push(v);
        }
        for (aspect, m) in &self.thumbnails {
            let (w, h) = Shape::of(aspect).map(|s| (s.width, s.height)).unwrap_or((0, 0));
            // each H.264 film of the shape gets one; a render of the 4K master alone, the master
            let of: Vec<&Delivery> = self.deliveries.iter().filter(|d| &d.aspect == aspect).collect();
            let h264 = of.iter().any(|d| d.codec == "h264");
            let films: Vec<Vec<String>> = of.iter().filter(|d| !h264 || d.codec == "h264").map(|d| d.channels.clone()).collect();
            for channels in films {
                deliveries.push(json!({
                    "channels": channels, "hash": m.hash, "mime": m.mime, "format": format!("thumbnail · {w}×{h}"), "aspect": aspect,
                    "width": w, "height": h, "codec": "jpeg", "bytes": m.size, "seconds": 0, "kind": "thumbnail",
                }));
            }
        }
        let own = self
            .deliveries
            .iter()
            .find(|d| d.aspect == t.aspect && d.codec == "h264")
            .or_else(|| self.deliveries.iter().find(|d| d.codec == "h264"))
            .or_else(|| self.deliveries.first())
            .and_then(|d| d.hash.clone())
            .context("no delivery")?;
        let report = json!({
            "color": self.color_json(),
            "conformed": self.conformed,
            "plates": self.plates,
            "warnings": self.warnings,
            "deliveries": self.deliveries.iter().map(|d| json!({ "hash": d.hash, "aspect": d.aspect, "codec": d.codec, "qc": Self::qc_meta(d), "loudness": d.loudness })).collect::<Vec<_>>(),
            "sound": self.sound,
            "timings": self.timings,
        });
        let hashes = self.color.transforms.iter().map(|(k, v)| format!("{k}@{}", &v[..8.min(v.len())])).collect::<Vec<_>>().join(" ");
        let note: String = format!("in the vault and on the calendar: {} files · {hashes}", deliveries.len()).chars().take(300).collect();
        Ok(json!({ "status": "done", "progress": 1, "note": note, "output_hash": own, "deliveries": deliveries, "report": report }))
    }
}
