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
//!   and what an agent asks of a cut (avendb-device's `avendb_task`, as the legacy studio's MCP did): its shots read
//!           for the base correction (`look_clips`), their scope sheet (`scope_sheet`), balances proposed
//!           (`propose_balances`), its sound levelled (`level_cut`) and matched (`match_sound`), all proposed, none
//!           written into the cut.
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

// ── what an agent asks of a cut (aven.rs `studio_job`: the look, scopes, balance, sound, level and sound-match rules) ──

/// The parts of each shot's frame named by hand, by clip id (`{clip: {white, grey, black, skin}}`, each a box
/// [x0, y0, x1, y1] from the frame's top left, 0…1); none where `v` names none or isn't one.
pub(crate) fn regions_of(v: &Value) -> HashMap<String, vault_render::look::Regions> {
    v.as_object().into_iter().flatten().filter_map(|(k, r)| Some((k.clone(), serde_json::from_value(r.clone()).ok()?))).collect()
}

/// What a V1 clip is called on the sheet: its script's scene and label or description.
fn clip_label(timeline: &Value, id: &str) -> String {
    let c = timeline["clips"].as_array().and_then(|cs| cs.iter().find(|c| c["id"].as_str() == Some(id)));
    let s = |k: &str| c.and_then(|c| c["script"][k].as_str()).filter(|s| !s.is_empty()).map(String::from);
    let what = s("label").or_else(|| s("description")).unwrap_or_default();
    let scene = s("scene").unwrap_or_default();
    [scene, what].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · ")
}

/// The V1 picture clips named (in that order), else every one with a file, as the render reads them.
fn picture_clips(t: &Timeline, ids: &Option<Vec<String>>) -> Res<Vec<Clip>> {
    let v1: Vec<&Clip> = t.clips.iter().filter(|c| c.track == "V1" && c.hash.is_some() && !c.is_world()).collect();
    let clips: Vec<Clip> = match ids {
        Some(ids) => ids.iter().map(|id| v1.iter().find(|c| &c.id == id).map(|c| (*c).clone()).ok_or(format!("no picture clip {id} with a file on this cut"))).collect::<Res<_>>()?,
        None => v1.into_iter().cloned().collect(),
    };
    if clips.is_empty() {
        return Err("no picture clip with a file to read".into());
    }
    Ok(clips)
}

/// Every clip named of `timeline` read for the base correction (vault_render `look`), its files from avenDB as the
/// render reads them (`library`): its elements — blacks, whites, the middle, the skin Vision finds (or the regions
/// named) — as shot and balanced, from its 4K grading still (else its original's frame; never a proxy), through the
/// ACES 2.0 output; with `looks`, through its grade and looks too. `balances` stand in for clips' own (a proposal read
/// before it is written). A clip that can't be read comes back as its error.
pub(crate) async fn look_clips(
    timeline: &Value,
    library: &[Value],
    ids: Option<Vec<String>>,
    regions: HashMap<String, vault_render::look::Regions>,
    balances: HashMap<String, vault_render::grade::Balance>,
    looks: bool,
) -> Res<Vec<Result<vault_render::look::Look, Value>>> {
    let t: Timeline = serde_json::from_value(timeline.clone()).map_err(err)?;
    let clips = picture_clips(&t, &ids)?;
    let lib = Arc::new(Footage::new(library, &t));
    tauri::async_runtime::spawn_blocking(move || {
        clips
            .iter()
            .map(|c| {
                let r = regions.get(&c.id).cloned().unwrap_or_default();
                objc2::rc::autoreleasepool(|_| vault_render::look::look(&t, &*lib, c, odt(), &r, balances.get(&c.id), looks))
                    .map_err(|e| json!({ "clip": c.id, "error": format!("{e:#}") }))
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(err)
}

/// The scope sheet of the clips named (the first the reference), after their balances: each shot's picture with its
/// skin box, its waveform, RGB parade and vectorscope with the skin line — the PNG's bytes and what each row is.
pub(crate) async fn scope_sheet(timeline: &Value, library: &[Value], ids: Vec<String>, regions: HashMap<String, vault_render::look::Regions>, with_looks: bool) -> Res<(Value, Vec<u8>)> {
    let looks = look_clips(timeline, library, Some(ids), regions, HashMap::new(), with_looks).await?;
    let mut rows = Vec::new();
    let mut ok = Vec::new();
    for (i, l) in looks.into_iter().enumerate() {
        match l {
            Ok(l) => {
                let b = &l.json["balanced"];
                let n = |p: &str| b.pointer(p).and_then(Value::as_f64).map(|v| format!("{v}")).unwrap_or_else(|| "–".into());
                let skin = if b["skin"].is_null() { "no face".to_string() } else { format!("skin {} IRE {}° ({:+}°) sat {}", n("/skin/ire"), n("/skin/hue"), b["skin"]["off_skin_line"].as_f64().unwrap_or(0.0), n("/skin/chroma")) };
                let text = format!(
                    "{}{} · {} — blacks {} · mid {} · whites {} IRE · {} · clipped {}%",
                    if i == 0 { "REFERENCE · " } else { "" },
                    clip_label(timeline, &l.clip),
                    &l.clip[..l.clip.len().min(8)],
                    n("/levels/p1"),
                    n("/levels/p50"),
                    n("/levels/p99"),
                    skin,
                    n("/clipped_pct"),
                );
                rows.push(json!({ "clip": l.clip, "label": text, "balance": l.json["balance"], "from": l.json["from"] }));
                ok.push((l, text));
            }
            Err(e) => rows.push(e),
        }
    }
    if ok.is_empty() {
        return Err(format!("no shot could be read: {}", json!(rows)));
    }
    let png = tauri::async_runtime::spawn_blocking(move || {
        let refs: Vec<(&vault_render::look::Look, String)> = ok.iter().map(|(l, t)| (l, t.clone())).collect();
        let (px, w, h) = vault_render::look::scopes(&refs).map_err(err)?;
        let mut out = Vec::new();
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header().and_then(|mut wr| wr.write_image_data(&px)).map_err(err)?;
        Ok::<_, String>(out)
    })
    .await
    .map_err(err)??;
    Ok((json!({ "rows": rows }), png))
}

/// The base correction's balances (colorist `base-correction.md`), proposed from the shots' elements; the cut changes
/// only where they are written into its stacks. `neutral`: each clip's own neutrals to grey, then `warmth` stops
/// warmer (a scene master); else every clip levelled to `reference` as it is balanced now (the scene master), by the
/// blacks, whites, middle and skin both have (less each clip's `skip`).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn propose_balances(
    timeline: &Value,
    library: &[Value],
    ids: Option<Vec<String>>,
    reference: Option<String>,
    neutral: bool,
    warmth: f64,
    regions: HashMap<String, vault_render::look::Regions>,
    skip: HashMap<String, Vec<String>>,
) -> Res<Value> {
    use vault_render::look::{fit, neutral as to_neutral, predict, target};
    let out = odt();
    let r = |b: &vault_render::grade::Balance| serde_json::to_value(b).unwrap_or_default();
    if neutral {
        let looks = look_clips(timeline, library, ids, regions, HashMap::new(), false).await?;
        let shots: Vec<Value> = looks
            .into_iter()
            .map(|l| match l {
                Ok(l) => {
                    let now: vault_render::grade::Balance = serde_json::from_value(l.json["balance"].clone()).unwrap_or_default();
                    let (b, used) = to_neutral(&l, out, &now, warmth);
                    json!({ "clip": l.clip, "balance": r(&b), "neutral_by": used, "warmth": warmth, "as_shot": l.json["as_shot"], "now": l.json["balanced"], "predicted": predict(&l, out, &b) })
                }
                Err(e) => e,
            })
            .collect();
        return Ok(json!({ "target": format!("neutral, then {warmth:+} stops warmer"), "shots": shots }));
    }
    let reference = reference.ok_or("name the scene's master as the reference: shots are matched to it, never to an average")?;
    let mut ids = ids.unwrap_or_else(|| {
        timeline["clips"].as_array().into_iter().flatten().filter(|c| c["track"] == "V1" && c["hash"].is_string() && c["kind"] != "world").filter_map(|c| c["id"].as_str().map(String::from)).collect()
    });
    ids.retain(|id| id != &reference);
    ids.insert(0, reference.clone());
    let mut looks = look_clips(timeline, library, Some(ids), regions, HashMap::new(), false).await?.into_iter();
    let master = looks.next().ok_or("the reference wasn't read")?.map_err(|e| format!("the reference can't be read: {e}"))?;
    let master_balance: vault_render::grade::Balance = serde_json::from_value(master.json["balance"].clone()).unwrap_or_default();
    let want = target(&master, out, &master_balance);
    let shots: Vec<Value> = looks
        .map(|l| match l {
            Ok(l) => {
                let (b, used) = fit(&l, &want, out, skip.get(&l.clip).map(Vec::as_slice).unwrap_or(&[]));
                json!({ "clip": l.clip, "balance": r(&b), "matched_by": used, "as_shot": l.json["as_shot"], "predicted": predict(&l, out, &b) })
            }
            Err(e) => e,
        })
        .collect();
    Ok(json!({ "target": format!("clip {reference} as it is balanced now"), "reference": { "clip": reference, "balance": r(&master_balance), "elements": predict(&master, out, &master_balance) }, "shots": shots }))
}

/// The loudness each kind of sound is levelled to, before the render levels the whole mix to −14 LUFS: the voice
/// clear on top, the music a bed under it (the render keys it down 6 dB more while the voice speaks), the sounds
/// and ambience under both.
pub const SOUND_TARGETS: [(&str, f64); 3] = [("A1", -18.0), ("A2", -26.0), ("A3", -30.0)];

/// Every sound clip levelled to its track's target (or `targets`), its gain within −∞…+12 dB (vol ≤ 4), and fades so
/// nothing clicks: a voice 0.05 s at least, the music 1 s in and 2.5 s out where the film starts or ends, a sound
/// 0.3 s. Each clip's change; it writes nothing.
pub fn level_sound(measured: &Value, clips: &[Value], targets: &[(String, f64)], end: f64) -> Vec<Value> {
    let target = |track: &str| targets.iter().find(|(t, _)| t == track).map(|(_, v)| *v).or_else(|| SOUND_TARGETS.iter().find(|(t, _)| *t == track).map(|(_, v)| *v));
    let mut out = Vec::new();
    for m in measured["clips"].as_array().into_iter().flatten().filter(|m| m.get("error").is_none()) {
        let (Some(id), Some(track)) = (m["clip"].as_str(), m["track"].as_str()) else { continue };
        let Some(c) = clips.iter().find(|c| c["id"].as_str() == Some(id)) else { continue };
        let Some(goal) = target(track) else { continue };
        let mut change = json!({ "clip": id, "track": track, "name": m["name"] });
        if let Some(l) = m["lufs"].as_f64() {
            // the gain that brings it to its target, never more than +12 dB (vol 4); the mix is float, and the render's
            // master limiter holds the peaks
            let vol = (10f64.powf((goal - l).min(12.0) / 20.0) * 1000.0).round() / 1000.0;
            change["vol"] = json!(vol.clamp(0.0, 4.0));
            change["lufs_before"] = json!(m["lufs_at_vol"]);
            change["lufs_after"] = json!(((l + 20.0 * vol.max(1e-6).log10()) * 100.0).round() / 100.0);
        } else {
            change["note"] = json!("silent: left as it is");
        }
        let start = c["start"].as_f64().unwrap_or(0.0);
        let dur = c["dur"].as_f64().unwrap_or(0.0);
        let (fin, fout) = (c["fin"].as_f64().unwrap_or(0.0), c["fout"].as_f64().unwrap_or(0.0));
        let (want_in, want_out) = match track {
            "A1" => (0.05, 0.05),
            "A2" => (if start < 0.5 { 1.0 } else { 0.3 }, if (start + dur - end).abs() < 0.5 { 2.5 } else { 0.5 }),
            _ => (0.3, 0.3),
        };
        change["fin"] = json!(fin.max(want_in).min(dur / 2.0));
        change["fout"] = json!(fout.max(want_out).min(dur / 2.0));
        out.push(change);
    }
    out
}

/// A cut's sound levelled (the `level` rule): measured, then each clip's change to its track's loudness (`level_sound`),
/// proposed; and how far the music sat under each voice before.
pub(crate) async fn level_cut(timeline: &Value, library: &[Value], targets: &[(String, f64)]) -> Res<Value> {
    let measured = measure_sound(timeline, library).await?;
    let clips = timeline["clips"].as_array().cloned().ok_or("the cut has no clips")?;
    let end = clips.iter().map(|c| c["start"].as_f64().unwrap_or(0.0) + c["dur"].as_f64().unwrap_or(0.0)).fold(0.0, f64::max);
    let changes = level_sound(&measured, &clips, targets, end);
    Ok(json!({ "changes": changes, "voice_over_music_before": measured["voice_over_music"] }))
}

/// The tone of sound clips `ids` matched to clip `reference`'s (the `sound-match` rule), as the legacy studio's
/// audio_match did: each clip's spectrum measured without its EQ and the reference's through its own, and the EQ that
/// closes `amount` of the difference (a peaking band per octave from `lo` to `hi`, within ±`limit` dB); with `level`,
/// the gain that makes it play as loud as the reference. Proposed: each clip's `eq` and `vol`, and the spectra.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn match_sound(timeline: &Value, library: &[Value], reference: &str, ids: &[String], lo: f64, hi: f64, limit: f64, amount: f64, level: bool) -> Res<Value> {
    let all = timeline["clips"].as_array().cloned().ok_or("the cut has no clips")?;
    let find = |id: &str| all.iter().find(|c| c["id"] == id).cloned().ok_or_else(|| format!("no clip {id}"));
    let reference_clip = find(reference)?;
    // one clip and the reference measured at a time: nothing else is read
    let measure = |clips: Vec<Value>| {
        let mut one = timeline.clone();
        one["clips"] = json!(clips);
        async move { measure_sound(&one, library).await }
    };
    let spectrum_of = |m: &Value, id: &str| -> Option<(Vec<f64>, Value)> {
        let c = m["clips"].as_array()?.iter().find(|c| c["clip"] == id)?;
        Some((c["spectrum"].as_array()?.iter().filter_map(|p| p[1].as_f64()).collect(), c.clone()))
    };
    let bands_json = |s: &[f64]| vault_render::eq::OCTAVES.iter().zip(s).map(|(f, v)| json!([f, v])).collect::<Vec<_>>();
    let mut out = Vec::new();
    for id in ids {
        let mut plain = find(id)?;
        if !plain["track"].as_str().is_some_and(|tr| tr.starts_with('A')) {
            return Err(format!("clip {id} is not a sound clip"));
        }
        if let Some(o) = plain.as_object_mut() {
            o.remove("eq");
        }
        let m = measure(vec![plain.clone(), reference_clip.clone()]).await?;
        let (from, _) = spectrum_of(&m, id).ok_or_else(|| format!("clip {id}: silent, or its file is not here"))?;
        let (to, r) = spectrum_of(&m, reference).ok_or("the reference is silent, or its file is not here")?;
        let to_scaled: Vec<f64> = from.iter().zip(&to).map(|(f, t)| f + amount * (t - f)).collect();
        let bands = vault_render::eq::matching(&from, &to_scaled, lo, hi, limit, vault_render::av::RATE as f64);
        let eq = serde_json::to_value(&bands).map_err(err)?;
        let mut matched = plain.clone();
        if !bands.is_empty() {
            matched["eq"] = eq.clone();
        }
        let after = measure(vec![matched]).await?;
        let (got, c) = spectrum_of(&after, id).ok_or("measuring it again failed")?;
        let vol = level
            .then(|| {
                let g = r["lufs_at_vol"].as_f64()? - c["lufs"].as_f64()?;
                Some(((10f64.powf(g.clamp(-60.0, 12.0) / 20.0) * 1000.0).round() / 1000.0).clamp(0.0, 4.0))
            })
            .flatten();
        out.push(json!({ "clip": id, "eq": eq, "vol_before": plain["vol"], "vol": vol, "reference_lufs_at_vol": r["lufs_at_vol"],
            "spectrum_before": bands_json(&from), "spectrum_after": bands_json(&got), "reference_spectrum": bands_json(&to) }));
    }
    Ok(json!({ "reference": reference, "clips": out }))
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
