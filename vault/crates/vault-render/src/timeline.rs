//! The timeline as the API and the studio write it (contract C1, `Timeline` / `TimelineClip` in src/lib/auth/client.ts),
//! and what the render worker (scripts/film/worker.ts) reads out of it: which clips take part, the film's length, the
//! delivery shapes, the picture track cut into pieces on the film's clock, the captions' phrases, the files' names.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::tools::{Stack, clean_stack};

/// The film's clock: every delivery runs at 30 frames a second (worker.ts `FPS`).
pub const FPS: u32 = 30;
/// The hook: the title over the first seconds of the moving film, in the social copies (worker.ts `HOOK`).
pub const HOOK: f64 = 2.5;

/// A media clip's framing in one shape: x, y in −1…1 of the room the picture has to move in; zoom ≥ 1.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ClipFrame {
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
    #[serde(default)]
    pub zoom: Option<f64>,
}

/// One clip on the timeline (contract C1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Clip {
    pub id: String,
    pub track: String,
    pub start: f64,
    #[serde(rename = "in", default)]
    pub in_: f64,
    pub dur: f64,
    #[serde(default = "one")]
    pub vol: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fin: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fout: Option<f64>,
    /// "media" (or absent) or "world"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shot: Option<String>,
    #[serde(rename = "shotVersion", default, skip_serializing_if = "Option::is_none")]
    pub shot_version: Option<u32>,
    /// a V1 clip's grade as stacks of tools (tools.rs): `base` (its base correction), then `clip` (its own look)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stacks: Option<Value>,
    /// a line (a line of the script not recorded yet, on A1): its words
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// reframing per delivery shape, keyed "16:9" (or "16x9")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame: Option<BTreeMap<String, ClipFrame>>,
    /// a V1 clip's script: its scene (`scene`) chooses the scene's look
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<Value>,
    /// a sound clip's EQ (eq::Band, in order)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eq: Option<Value>,
    /// a sound clip's gain keys ([seconds into the clip, dB], sound::clean_keys)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keys: Option<Value>,
}

fn one() -> f64 {
    1.0
}

impl Clip {
    pub fn is_world(&self) -> bool {
        self.kind.as_deref() == Some("world")
    }
    pub fn end(&self) -> f64 {
        self.start + self.dur
    }
    /// One of its stacks ("base", "clip"), checked.
    pub fn stack(&self, which: &str) -> Option<Stack> {
        self.stacks.as_ref()?.get(which).and_then(clean_stack)
    }
    /// A line of the script not recorded yet (A1, words and no file).
    pub fn is_line(&self) -> bool {
        self.kind.as_deref() == Some("line")
    }
    /// Its EQ, checked (empty: none).
    pub fn eq(&self) -> Vec<crate::eq::Band> {
        self.eq.as_ref().map(crate::eq::clean_eq).unwrap_or_default()
    }
    /// The scene it belongs to (its script's), the key of its scene's look.
    pub fn scene(&self) -> Option<&str> {
        self.script.as_ref()?.get("scene")?.as_str().filter(|s| !s.is_empty())
    }
    pub fn frame_for(&self, aspect: &str) -> Option<&ClipFrame> {
        let f = self.frame.as_ref()?;
        f.get(aspect).or_else(|| f.get(&aspect.replace(':', "x")))
    }
}

/// The film's grade above its shots' own, as stacks of tools (tools.rs): each scene's look (keyed by the scene its
/// clips name), the timeline's look, the finishing.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FilmGrade {
    #[serde(default)]
    pub scenes: BTreeMap<String, Value>,
    #[serde(default)]
    pub timeline: Option<Value>,
    #[serde(default)]
    pub finish: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Timeline {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub variant: Option<String>,
    #[serde(default = "sixteen_nine")]
    pub aspect: String,
    #[serde(default)]
    pub clips: Vec<Clip>,
    #[serde(default)]
    pub grade: Option<FilmGrade>,
    #[serde(default)]
    pub version: Option<u32>,
}

fn sixteen_nine() -> String {
    "16:9".into()
}

impl Timeline {
    /// A clip's stacks in the order they apply: its base correction, its clip look, its scene's look, the timeline's
    /// look, the finishing.
    pub fn stacks_for(&self, c: &Clip) -> Vec<Stack> {
        let g = self.grade.as_ref();
        let scene = c.scene().and_then(|s| g?.scenes.get(s)).and_then(clean_stack);
        [c.stack("base"), c.stack("clip"), scene, g.and_then(|g| g.timeline.as_ref()).and_then(clean_stack), g.and_then(|g| g.finish.as_ref()).and_then(clean_stack)]
            .into_iter()
            .flatten()
            .collect()
    }
}

/// One delivery shape and the frame it is rendered at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shape {
    pub aspect: &'static str,
    /// the 1080-based frame (worker.ts `FRAME`)
    pub width: u32,
    pub height: u32,
    /// 2 for the 16:9 4K master, else 1 (worker.ts `masterOf`)
    pub master: u32,
}

impl Shape {
    pub fn of(aspect: &str) -> Option<Shape> {
        let (aspect, width, height) = match aspect {
            "1:1" => ("1:1", 1080, 1080),
            "16:9" => ("16:9", 1920, 1080),
            "9:16" => ("9:16", 1080, 1920),
            "4:5" => ("4:5", 1080, 1350),
            _ => return None,
        };
        Some(Shape { aspect, width, height, master: if aspect == "16:9" { 2 } else { 1 } })
    }
    /// The frame the picture is rendered at: 3840×2160 for the 16:9 master, else the 1080-based frame.
    pub fn render_size(&self) -> (u32, u32) {
        (self.width * self.master, self.height * self.master)
    }
    pub fn portrait(&self) -> bool {
        self.height > self.width
    }
    /// "16x9"
    pub fn tag(&self) -> String {
        self.aspect.replace(':', "x")
    }
}

/// Every shape a film is delivered in: 16:9, 9:16, 1:1 and the timeline's own frame (4:5) — worker.ts `shapes`.
pub fn shapes_of(t: &Timeline) -> Vec<Shape> {
    let own = if Shape::of(&t.aspect).is_some() { t.aspect.as_str() } else { "16:9" };
    let mut out: Vec<Shape> = Vec::new();
    for a in ["16:9", "9:16", "1:1", own] {
        let s = Shape::of(a).expect("known shape");
        if !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

/// A piece of the picture track: one clip (or a gap, None) over frames `a..b` of the film's clock.
#[derive(Debug, Clone, PartialEq)]
pub struct Piece {
    /// index into the pictures given to `pieces`
    pub clip: Option<usize>,
    pub a: u64,
    pub b: u64,
}

/// The picture track cut into pieces, exactly as worker.ts cuts it: every clip edge rounded to a frame, between two
/// edges the clip on top at the middle (the later one in start order), neighbouring stretches of one clip joined, a
/// gap black. `pictures` must be sorted by start (stable), as the worker sorts them.
pub fn pieces(pictures: &[&Clip], total: f64) -> Vec<Piece> {
    let fps = FPS as f64;
    let frame = |t: f64| (t.max(0.0).min(total) * fps).round() as u64;
    let mut edges: Vec<u64> = vec![frame(0.0), frame(total)];
    for c in pictures {
        edges.push(frame(c.start));
        edges.push(frame(c.end()));
    }
    edges.sort_unstable();
    edges.dedup();
    let mut out: Vec<Piece> = Vec::new();
    for w in edges.windows(2) {
        let (a, b) = (w[0], w[1]);
        let mid = (a + b) as f64 / 2.0 / fps;
        let top = pictures.iter().rposition(|c| c.start <= mid && mid < c.end());
        match out.last_mut() {
            Some(prev) if prev.clip == top && prev.b == a => prev.b = b,
            _ => out.push(Piece { clip: top, a, b }),
        }
    }
    out
}

/// A caption: a phrase of a voice clip's words, on the film's clock.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Phrase {
    pub text: String,
    pub start: f64,
    pub end: f64,
    /// each word and when it is said, on the timeline: it lights up then (as the studio's player shows it)
    pub words: Vec<(String, f64)>,
}

/// A caption word's timing (a voice file's transcript words, `render::caption_words`).
#[derive(Debug, Clone, Deserialize)]
pub struct Word {
    pub word: String,
    pub start: f64,
    pub end: f64,
}

fn ends_with_any(s: &str, set: &str) -> bool {
    s.chars().last().is_some_and(|c| set.contains(c))
}

/// The voice clips' words, in short phrases broken at the punctuation (worker.ts `phrasesOf`): a phrase ends at a
/// word ending in punctuation once it has three words (or at once on a full stop, a colon, …), or when it passes 34
/// characters. `words_of` gives a clip's word timings (its file's transcript); a line of the script not recorded yet
/// gets its words spread over its length (`line_words`).
pub fn phrases(t: &Timeline, words_of: &dyn Fn(&Clip) -> Vec<Word>) -> Vec<Phrase> {
    let mut out = Vec::new();
    for c in t.clips.iter().filter(|c| c.track == "A1" && (c.hash.is_some() || c.is_line())) {
        let words = if c.is_line() { line_words(c) } else { words_of(c) };
        let mut cur: Vec<&Word> = Vec::new();
        let flush = |cur: &Vec<&Word>, out: &mut Vec<Phrase>| {
            if let (Some(first), Some(last)) = (cur.first(), cur.last()) {
                out.push(Phrase {
                    text: cur.iter().map(|w| w.word.as_str()).collect::<Vec<_>>().join(" "),
                    start: c.start + first.start - c.in_,
                    end: c.start + last.end - c.in_,
                    words: cur.iter().map(|w| (w.word.clone(), c.start + w.start - c.in_)).collect(),
                });
            }
        };
        for w in words.iter().filter(|w| w.start >= c.in_ && w.start < c.in_ + c.dur) {
            cur.push(w);
            let text = cur.iter().map(|x| x.word.as_str()).collect::<Vec<_>>().join(" ");
            // JavaScript's length counts UTF-16 units
            let len = text.encode_utf16().count();
            if (ends_with_any(&w.word, ".,;:!?…") && (cur.len() >= 3 || ends_with_any(&w.word, ".;:!?…"))) || len > 34 {
                flush(&cur, &mut out);
                cur.clear();
            }
        }
        flush(&cur, &mut out);
    }
    out
}

/// A line's words on its own clock (from its `in`): its length shared by the words, each by its letters and one more
/// (transcript.js `lineWords`).
pub fn line_words(c: &Clip) -> Vec<Word> {
    let words: Vec<&str> = c.text.as_deref().unwrap_or("").split_whitespace().collect();
    let weight = |w: &str| w.chars().count() as f64 + 1.0;
    let total: f64 = words.iter().map(|w| weight(w)).sum();
    let mut at = c.in_;
    words
        .iter()
        .map(|w| {
            let len = c.dur * weight(w) / total;
            let word = Word { word: w.to_string(), start: (at * 1000.0).round() / 1000.0, end: ((at + len) * 1000.0).round() / 1000.0 };
            at += len;
            word
        })
        .collect()
}

/// The files' common name: `<project>-<variant>-<yyyymmddhhmm>` in UTC (worker.ts `base`).
pub fn base_name(t: &Timeline, unix_seconds: u64) -> String {
    let project: String = t.project.clone().unwrap_or_else(|| "film".into()).to_lowercase();
    let project = project.split_whitespace().collect::<Vec<_>>().join("-");
    let variant = t.variant.as_ref().map(|v| format!("-{}", v.to_lowercase())).unwrap_or_default();
    format!("{project}{variant}-{}", utc_stamp(unix_seconds))
}

/// yyyymmddhhmm of a Unix time, UTC.
pub fn utc_stamp(unix_seconds: u64) -> String {
    let days = (unix_seconds / 86_400) as i64;
    let secs = unix_seconds % 86_400;
    // civil from days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}{m:02}{d:02}{:02}{:02}", secs / 3600, (secs % 3600) / 60)
}
