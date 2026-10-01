//! The grade as stackable tools (game/film/grade-tools.js is the same data, checked the same way): every grading
//! tool a self-contained item — balance, CDL, contrast, split tone, hue curves, highlight saturation, a LUT; a window
//! or a colour key (a mask holding tools of its own, applied only inside it, by `mix` — masks nest); pop, halation,
//! bloom, grain, vignette — on stacks that apply in order: a shot's base correct and clip look, its scene's look,
//! the timeline's look (the film's texture last on it). A stack has a strength (how much of it), a tool can be off.
//!
//! A clip's stacks become one list of steps (`compile`): the colour tools that follow one another bake into one cube
//! (`bake`: the viewer and the render sample the same), a balance runs as its own node, a mask and a texture on the
//! GPU between them (`apply`). The colour maths is `creative`'s (one place).

use std::collections::HashMap;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    Lut3d, Output,
    creative::{Hues, around, rgb, smooth, ycc},
    grade::{Balance, Cdl, PIVOT, clean_balance, clean_cdl},
    gpu::{Cube, Gpu, Image},
    look::{Disp, Rect},
};

/// The registry of every tool — its controls, their ranges and defaults (game/film/grade-tools.json, the studio's
/// and the API's too): the MCP describes the tools from it, the tests hold this file's checks to it.
pub const REGISTRY: &str = include_str!("../../../../game/film/grade-tools.json");

const MAX_DEPTH: usize = 3;
const MAX_TOOLS: usize = 24;

fn c(x: f64, lo: f64, hi: f64, d: f64) -> f64 {
    if x.is_finite() { x.clamp(lo, hi) } else { d }
}
fn yes() -> bool {
    true
}
fn pivot() -> f64 {
    PIVOT
}
fn one() -> f64 {
    1.0
}
fn half() -> f64 {
    0.5
}

/// One tool on a stack.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Item {
    /// false: on the stack, but doing nothing
    #[serde(default = "yes", skip_serializing_if = "Clone::clone")]
    pub on: bool,
    #[serde(flatten)]
    pub tool: Tool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "tool", rename_all = "snake_case")]
pub enum Tool {
    Balance(Balance),
    Cdl(CdlTool),
    Contrast {
        #[serde(default)]
        amount: f64,
        #[serde(default = "pivot")]
        pivot: f64,
    },
    Split(Split),
    Hue(Hue),
    HiSat {
        #[serde(default = "one")]
        amount: f64,
        #[serde(default = "pivot")]
        pivot: f64,
    },
    Lut {
        #[serde(default)]
        hash: String,
    },
    Window(Window),
    Key(Key),
    Pop {
        #[serde(default = "pop_amount")]
        amount: f64,
        #[serde(default = "pop_radius")]
        radius: f64,
    },
    Halation(Glow),
    Bloom(Glow),
    Grain {
        #[serde(default = "grain_amount")]
        amount: f64,
        #[serde(default = "one")]
        size: f64,
        #[serde(default)]
        chroma: f64,
    },
    Vignette {
        #[serde(default = "vig_amount")]
        amount: f64,
        #[serde(default = "vig_size")]
        size: f64,
        #[serde(default = "half")]
        softness: f64,
        #[serde(default)]
        roundness: f64,
    },
}
fn pop_radius() -> f64 {
    18.0
}
fn pop_amount() -> f64 {
    0.2
}
fn grain_amount() -> f64 {
    0.12
}
fn vig_amount() -> f64 {
    0.4
}
fn glow_amount() -> f64 {
    0.25
}
fn window_size() -> f64 {
    0.6
}
fn key_hue() -> f64 {
    30.0
}
fn vig_size() -> f64 {
    0.9
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CdlTool {
    #[serde(default = "ones")]
    pub slope: [f64; 3],
    #[serde(default)]
    pub offset: [f64; 3],
    #[serde(default = "ones")]
    pub power: [f64; 3],
    #[serde(default = "one")]
    pub sat: f64,
}
fn ones() -> [f64; 3] {
    [1.0; 3]
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Split {
    #[serde(default = "teal")]
    pub sh_hue: f64,
    #[serde(default)]
    pub sh_amount: f64,
    #[serde(default = "warm")]
    pub hi_hue: f64,
    #[serde(default)]
    pub hi_amount: f64,
    #[serde(default)]
    pub balance: f64,
    #[serde(default = "pivot")]
    pub pivot: f64,
}
fn teal() -> f64 {
    280.0
}
fn warm() -> f64 {
    125.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Hue {
    /// [hue°, shift°]
    #[serde(default)]
    pub hue: Vec<[f64; 2]>,
    /// [hue°, factor]
    #[serde(default)]
    pub hue_sat: Vec<[f64; 2]>,
    /// [hue°, stops]
    #[serde(default)]
    pub hue_lum: Vec<[f64; 2]>,
    #[serde(default = "one")]
    pub sat: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Glow {
    #[serde(default = "glow_amount")]
    pub amount: f64,
    #[serde(default = "glow_threshold")]
    pub threshold: f64,
    #[serde(default = "glow_radius")]
    pub radius: f64,
}
fn glow_threshold() -> f64 {
    0.55
}
fn glow_radius() -> f64 {
    14.0
}

/// A window: a shape on the frame (0…1 from the top left), turned and feathered — and the tools inside it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Window {
    #[serde(default = "ellipse")]
    pub shape: String,
    #[serde(default = "half")]
    pub x: f64,
    #[serde(default = "half")]
    pub y: f64,
    #[serde(default = "window_size")]
    pub w: f64,
    #[serde(default = "window_size")]
    pub h: f64,
    #[serde(default)]
    pub angle: f64,
    #[serde(default = "half")]
    pub feather: f64,
    #[serde(default)]
    pub invert: bool,
    /// "face": it follows the face Vision finds (its size then a multiple of the face's); "" stays put
    #[serde(default)]
    pub track: String,
    #[serde(default = "one")]
    pub mix: f64,
    #[serde(default)]
    pub tools: Vec<Item>,
}
fn ellipse() -> String {
    "ellipse".into()
}

/// A colour key: the colours as the display shows them (the vectorscope's hue, chroma × 100, IRE) — and the tools
/// inside it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Key {
    #[serde(default = "key_hue")]
    pub hue: f64,
    #[serde(default = "key_width")]
    pub width: f64,
    #[serde(default = "sat_lo")]
    pub sat_lo: f64,
    #[serde(default = "hundred")]
    pub sat_hi: f64,
    #[serde(default)]
    pub luma_lo: f64,
    #[serde(default = "hundred")]
    pub luma_hi: f64,
    #[serde(default = "half")]
    pub soft: f64,
    #[serde(default = "one")]
    pub mix: f64,
    #[serde(default)]
    pub tools: Vec<Item>,
}
fn key_width() -> f64 {
    40.0
}
fn sat_lo() -> f64 {
    1.0
}
fn hundred() -> f64 {
    100.0
}

/// A stack: its tools in order, and how much of it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Stack {
    #[serde(default = "one", skip_serializing_if = "is_one")]
    pub strength: f64,
    #[serde(default)]
    pub tools: Vec<Item>,
}
fn is_one(v: &f64) -> bool {
    *v == 1.0
}

// ── checked as the studio checks them (grade-tools.js `cleanTool`) ─────────────────────────────────────────────

fn deg(x: f64) -> f64 {
    c(x, -720.0, 720.0, 0.0).rem_euclid(360.0)
}

fn clean_points(ps: &mut Vec<[f64; 2]>, lo: f64, hi: f64, d: f64) {
    ps.truncate(16);
    for p in ps.iter_mut() {
        p[0] = deg(p[0]);
        p[1] = c(p[1], lo, hi, d);
    }
    ps.sort_by(|a, b| a[0].total_cmp(&b[0]));
}

fn clean_items(items: Vec<Item>, depth: usize) -> Vec<Item> {
    items.into_iter().take(MAX_TOOLS).filter_map(|i| clean_item(i, depth)).collect()
}

fn clean_item(mut it: Item, depth: usize) -> Option<Item> {
    it.tool = match it.tool {
        Tool::Balance(b) => Tool::Balance(clean_balance(&serde_json::to_value(b).ok()?).unwrap_or_default()),
        Tool::Cdl(t) => {
            let cdl = clean_cdl(&serde_json::to_value(t).ok()?).unwrap_or(Cdl { slope: [1.0; 3], offset: [0.0; 3], power: [1.0; 3], sat: 1.0 });
            Tool::Cdl(CdlTool { slope: cdl.slope, offset: cdl.offset, power: cdl.power, sat: cdl.sat })
        }
        Tool::Contrast { amount, pivot } => Tool::Contrast { amount: c(amount, -1.0, 1.0, 0.0), pivot: c(pivot, 0.0, 1.0, PIVOT) },
        Tool::Split(s) => Tool::Split(Split {
            sh_hue: deg(s.sh_hue),
            sh_amount: c(s.sh_amount, 0.0, 1.0, 0.0),
            hi_hue: deg(s.hi_hue),
            hi_amount: c(s.hi_amount, 0.0, 1.0, 0.0),
            balance: c(s.balance, -1.0, 1.0, 0.0),
            pivot: c(s.pivot, 0.0, 1.0, PIVOT),
        }),
        Tool::Hue(mut h) => {
            clean_points(&mut h.hue, -90.0, 90.0, 0.0);
            clean_points(&mut h.hue_sat, 0.0, 3.0, 1.0);
            clean_points(&mut h.hue_lum, -2.0, 2.0, 0.0);
            h.sat = c(h.sat, 0.0, 3.0, 1.0);
            Tool::Hue(h)
        }
        Tool::HiSat { amount, pivot } => Tool::HiSat { amount: c(amount, 0.0, 2.0, 1.0), pivot: c(pivot, 0.0, 1.0, PIVOT) },
        Tool::Lut { hash } => {
            if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                return None;
            }
            Tool::Lut { hash }
        }
        Tool::Window(mut w) => {
            w.shape = if w.shape == "rect" { "rect".into() } else { "ellipse".into() };
            (w.x, w.y) = (c(w.x, -1.0, 2.0, 0.5), c(w.y, -1.0, 2.0, 0.5));
            (w.w, w.h) = (c(w.w, 0.01, 4.0, 0.5), c(w.h, 0.01, 4.0, 0.5));
            w.angle = c(w.angle, -360.0, 360.0, 0.0);
            w.feather = c(w.feather, 0.0, 1.0, 0.5);
            if w.track != "face" {
                w.track.clear();
            }
            w.mix = c(w.mix, 0.0, 1.0, 1.0);
            w.tools = if depth < MAX_DEPTH { clean_items(w.tools, depth + 1) } else { vec![] };
            Tool::Window(w)
        }
        Tool::Key(mut k) => {
            k.hue = deg(k.hue);
            k.width = c(k.width, 1.0, 360.0, 40.0);
            (k.sat_lo, k.sat_hi) = (c(k.sat_lo, 0.0, 100.0, 1.0), c(k.sat_hi, 0.0, 100.0, 100.0));
            (k.luma_lo, k.luma_hi) = (c(k.luma_lo, 0.0, 100.0, 0.0), c(k.luma_hi, 0.0, 100.0, 100.0));
            k.soft = c(k.soft, 0.0, 1.0, 0.5);
            k.mix = c(k.mix, 0.0, 1.0, 1.0);
            k.tools = if depth < MAX_DEPTH { clean_items(k.tools, depth + 1) } else { vec![] };
            Tool::Key(k)
        }
        Tool::Pop { amount, radius } => Tool::Pop { amount: c(amount, -1.0, 1.0, 0.0), radius: c(radius, 2.0, 80.0, 18.0) },
        Tool::Halation(g) => Tool::Halation(clean_glow(g)),
        Tool::Bloom(g) => Tool::Bloom(clean_glow(g)),
        Tool::Grain { amount, size, chroma } => Tool::Grain { amount: c(amount, 0.0, 1.0, 0.0), size: c(size, 0.5, 4.0, 1.0), chroma: c(chroma, 0.0, 1.0, 0.0) },
        Tool::Vignette { amount, size, softness, roundness } => {
            Tool::Vignette { amount: c(amount, 0.0, 1.0, 0.0), size: c(size, 0.2, 2.0, 0.9), softness: c(softness, 0.0, 1.0, 0.5), roundness: c(roundness, 0.0, 1.0, 0.0) }
        }
    };
    Some(it)
}

fn clean_glow(g: Glow) -> Glow {
    Glow { amount: c(g.amount, 0.0, 1.0, 0.0), threshold: c(g.threshold, 0.3, 1.2, 0.55), radius: c(g.radius, 1.0, 120.0, 14.0) }
}

/// A CDL as a tool on a stack (its JSON).
pub fn cdl_tool(c: &Cdl) -> Value {
    json!({ "tool": "cdl", "slope": c.slope, "offset": c.offset, "power": c.power, "sat": c.sat })
}

/// A stack as data, checked: None when it is not one or holds no tool.
pub fn clean_stack(v: &Value) -> Option<Stack> {
    let tools = if v.is_array() { v } else { v.get("tools")? };
    let items: Vec<Item> = tools.as_array()?.iter().filter_map(|t| serde_json::from_value(t.clone()).ok()).collect();
    let tools = clean_items(items, 0);
    if tools.is_empty() {
        return None;
    }
    let strength = c(v.get("strength").and_then(Value::as_f64).unwrap_or(1.0), 0.0, 1.0, 1.0);
    Some(Stack { strength, tools })
}

// ── the colour tools, on one pixel (ACEScct in and out) ───────────────────────────────────────────────────────────

/// A colour tool ready: its LUT read, its CDL resolved.
enum Point<'a> {
    Balance(&'a Balance),
    Cdl(Cdl),
    Contrast(f64, f64),
    Split(&'a Split),
    Hue(&'a Hue),
    HiSat(f64, f64),
    Lut(Option<&'a Lut3d>),
}

impl Point<'_> {
    fn apply(&self, p: [f64; 3], hues: &Hues, output: &dyn Output) -> [f64; 3] {
        match self {
            Point::Balance(b) => b.apply(p),
            Point::Cdl(cdl) => cdl.apply(p),
            Point::Contrast(amount, pivot) => {
                let k = 1.0 + amount;
                p.map(|v| pivot + (v - pivot) * k)
            }
            Point::Split(s) => {
                let (y, mut cb, mut cr) = ycc(p);
                // the shadows fade out above the meeting point, the highlights in; 0.05 of chroma is a strong tint. The
                // blacks stay neutral: the shadows' tint fades out again below about five stops under mid grey
                let at = s.pivot + s.balance * 0.2;
                let lo = (1.0 - smooth(at - 0.25, at + 0.05, y)) * smooth(0.06, 0.2, y);
                let hi = smooth(at - 0.05, at + 0.3, y);
                for (hue, amount, w) in [(s.sh_hue, s.sh_amount, lo), (s.hi_hue, s.hi_amount, hi)] {
                    if amount > 0.0 && w > 0.0 {
                        let (dx, dy) = hues.of(hue);
                        cb += dx * amount * 0.05 * w;
                        cr += dy * amount * 0.05 * w;
                    }
                }
                rgb(y, cb, cr)
            }
            Point::Hue(h) => {
                if h.hue.is_empty() && h.hue_sat.is_empty() && h.hue_lum.is_empty() && h.sat == 1.0 {
                    return p;
                }
                let d = Disp::of(output.apply(p));
                // near grey a hue means little: the curves fade in with the colour
                let w = smooth(0.004, 0.03, d.chroma());
                let (y, cb, cr) = ycc(p);
                let shift = around(&h.hue, d.hue(), 0.0) * w;
                let k = (1.0 + (around(&h.hue_sat, d.hue(), 1.0) - 1.0) * w) * h.sat;
                let (s, co) = shift.to_radians().sin_cos();
                let (cb, cr) = ((cb * co - cr * s) * k, (cb * s + cr * co) * k);
                // a stop is 1/17.52 in ACEScct
                let y = y + around(&h.hue_lum, d.hue(), 0.0) * w / 17.52;
                rgb(y, cb, cr)
            }
            Point::HiSat(amount, pivot) => {
                let (y, cb, cr) = ycc(p);
                let w = smooth(pivot + 0.12, pivot + 0.3, y);
                let k = 1.0 + (amount - 1.0) * w;
                rgb(y, cb * k, cr * k)
            }
            Point::Lut(l) => l.map(|l| l.sample(p)).unwrap_or(p),
        }
    }
}

fn point<'a>(t: &'a Tool, luts: &'a HashMap<String, Lut3d>) -> Option<Point<'a>> {
    Some(match t {
        Tool::Balance(b) => Point::Balance(b),
        Tool::Cdl(t) => Point::Cdl(Cdl { slope: t.slope, offset: t.offset, power: t.power, sat: t.sat }),
        Tool::Contrast { amount, pivot } => Point::Contrast(*amount, *pivot),
        Tool::Split(s) => Point::Split(s),
        Tool::Hue(h) => Point::Hue(h),
        Tool::HiSat { amount, pivot } => Point::HiSat(*amount, *pivot),
        Tool::Lut { hash } => Point::Lut(luts.get(hash)),
        _ => return None,
    })
}

// ── a clip's stacks as steps ──────────────────────────────────────────────────────────────────────────────────

/// A stretch of colour tools that bakes into one cube: each stack's run with its strength.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Run {
    pub parts: Vec<(f64, Vec<Tool>)>,
}

impl Run {
    /// The name its cube goes by: what it is, and the output transform it sees hues through.
    pub fn key(&self, output: &dyn Output) -> String {
        crate::grade::hash_of(&json!({ "run": self, "output": output.hash() }))
    }
}

#[derive(Debug, Clone)]
pub enum Step {
    /// colour tools baked into one cube (by its key)
    Cube { key: String, run: Run },
    /// a balance on its own node (the GPU's exact kernel)
    Balance(Balance),
    /// a mask and the steps inside it
    Mask { window: Option<Window>, key: Option<Key>, mix: f64, inner: Vec<Step> },
    /// a texture of the frame
    Texture(Tool),
    /// a stack with mask or texture tools, by less than all of it
    Mix { strength: f64, inner: Vec<Step> },
}

fn is_colour(t: &Tool) -> bool {
    !matches!(t, Tool::Balance(_) | Tool::Window(_) | Tool::Key(_) | Tool::Pop { .. } | Tool::Halation(_) | Tool::Bloom(_) | Tool::Grain { .. } | Tool::Vignette { .. })
}

/// A list of tools as steps: the colour tools that follow one another as one run.
fn steps_of(items: &[Item], output: &dyn Output) -> Vec<Step> {
    let mut out: Vec<Step> = Vec::new();
    let mut run: Vec<Tool> = Vec::new();
    let flush = |run: &mut Vec<Tool>, out: &mut Vec<Step>| {
        if !run.is_empty() {
            let r = Run { parts: vec![(1.0, std::mem::take(run))] };
            out.push(Step::Cube { key: r.key(output), run: r });
        }
    };
    for it in items.iter().filter(|i| i.on) {
        match &it.tool {
            t if is_colour(t) => run.push(t.clone()),
            Tool::Balance(b) => {
                flush(&mut run, &mut out);
                if !b.is_neutral() {
                    out.push(Step::Balance(*b));
                }
            }
            Tool::Window(w) => {
                flush(&mut run, &mut out);
                out.push(Step::Mask { window: Some(w.clone()), key: None, mix: w.mix, inner: steps_of(&w.tools, output) });
            }
            Tool::Key(k) => {
                flush(&mut run, &mut out);
                out.push(Step::Mask { window: None, key: Some(k.clone()), mix: k.mix, inner: steps_of(&k.tools, output) });
            }
            t => {
                flush(&mut run, &mut out);
                out.push(Step::Texture(t.clone()));
            }
        }
    }
    flush(&mut run, &mut out);
    out
}

/// Stacks (in the order they apply) as one list of steps: a stack of colour tools only goes into the cube of the
/// stacks around it, with its strength; a stack with masks or textures by less than all of it is mixed on the GPU.
pub fn compile(stacks: &[&Stack], output: &dyn Output) -> Vec<Step> {
    let mut out: Vec<Step> = Vec::new();
    for st in stacks {
        let steps = steps_of(&st.tools, output);
        let only_colour = steps.iter().all(|s| matches!(s, Step::Cube { .. }));
        if only_colour {
            let tools: Vec<Tool> = steps.into_iter().flat_map(|s| if let Step::Cube { run, .. } = s { run.parts.into_iter().flat_map(|p| p.1).collect::<Vec<_>>() } else { vec![] }).collect();
            if tools.is_empty() || st.strength == 0.0 {
                continue;
            }
            // joined to the run before it, when there is one
            if let Some(Step::Cube { run, key }) = out.last_mut() {
                run.parts.push((st.strength, tools));
                *key = run.key(output);
            } else {
                let r = Run { parts: vec![(st.strength, tools)] };
                out.push(Step::Cube { key: r.key(output), run: r });
            }
        } else if st.strength >= 1.0 {
            // at full strength its colour runs join the cube before them as well (one cube, sampled once)
            for step in steps {
                match (step, out.last_mut()) {
                    (Step::Cube { run: r, .. }, Some(Step::Cube { run, key })) => {
                        run.parts.extend(r.parts);
                        *key = run.key(output);
                    }
                    (step, _) => out.push(step),
                }
            }
        } else if st.strength > 0.0 {
            out.push(Step::Mix { strength: st.strength, inner: steps });
        }
    }
    out
}

/// Every cube the steps need: its key and its run.
pub fn runs(steps: &[Step]) -> Vec<(String, Run)> {
    let mut out = Vec::new();
    for s in steps {
        match s {
            Step::Cube { key, run } => out.push((key.clone(), run.clone())),
            Step::Mask { inner, .. } | Step::Mix { inner, .. } => out.extend(runs(inner)),
            _ => {}
        }
    }
    out
}

/// The creative LUTs the steps read (by hash): the caller loads them from the vault.
pub fn luts(steps: &[Step]) -> Vec<String> {
    runs(steps)
        .into_iter()
        .flat_map(|(_, r)| r.parts.into_iter().flat_map(|p| p.1))
        .filter_map(|t| if let Tool::Lut { hash } = t { Some(hash) } else { None })
        .collect()
}

fn through(parts: &[(f64, Vec<Point>)], mut px: [f64; 3], hues: &Hues, output: &dyn Output) -> [f64; 3] {
    for (k, ps) in parts {
        let x = px;
        for p in ps {
            px = p.apply(px, hues, output);
        }
        if *k < 1.0 {
            px = std::array::from_fn(|i| x[i] + (px[i] - x[i]) * k);
        }
    }
    px
}

/// A run as one cube over ACEScct (`size`³ RGB, red fastest).
pub fn bake(run: &Run, luts: &HashMap<String, Lut3d>, output: &dyn Output, size: usize) -> Vec<f32> {
    let hues = Hues::new(output);
    let parts: Vec<(f64, Vec<Point>)> = run.parts.iter().map(|(k, ts)| (*k, ts.iter().filter_map(|t| point(t, luts)).collect())).collect();
    let n = size.max(2);
    let at = |i: usize| i as f64 / (n - 1) as f64;
    let mut out = Vec::with_capacity(n * n * n * 3);
    for b in 0..n {
        for g in 0..n {
            for r in 0..n {
                out.extend(through(&parts, [at(r), at(g), at(b)], &hues, output).map(|v| v as f32));
            }
        }
    }
    out
}

/// One ACEScct pixel through a stack's colour tools, a balance among them (masks and textures left out) — what its
/// cube holds there, exactly.
pub fn colour(stack: &Stack, p: [f64; 3], hues: &Hues, output: &dyn Output, luts: &HashMap<String, Lut3d>) -> [f64; 3] {
    let tools: Vec<Point> = stack.tools.iter().filter(|i| i.on).filter_map(|i| point(&i.tool, luts)).collect();
    through(&[(stack.strength, tools)], p, hues, output)
}

/// Every colour tool of the steps as one cube, a balance among them, masks and textures left out — the studio's
/// WebGL preview, which samples one cube (a world shot, an image).
pub fn preview(stacks: &[&Stack], luts: &HashMap<String, Lut3d>, output: &dyn Output, size: usize) -> Vec<f32> {
    let parts: Vec<(f64, Vec<Tool>)> = stacks.iter().map(|s| (s.strength, s.tools.iter().filter(|i| i.on && (is_colour(&i.tool) || matches!(i.tool, Tool::Balance(_)))).map(|i| i.tool.clone()).collect())).collect();
    bake(&Run { parts }, luts, output, size)
}

/// The GPU's cubes for the steps, baked once each (by key).
pub fn gpu_cubes(gpu: &Gpu, steps: &[Step], luts: &HashMap<String, Lut3d>, output: &dyn Output, have: &mut HashMap<String, Cube>) -> Result<()> {
    for (key, run) in runs(steps) {
        if !have.contains_key(&key) {
            let lut = Lut3d::from_rgb(&format!("tools-{key}"), 65, bake(&run, luts, output, 65))?;
            have.insert(key, gpu.cube(&lut));
        }
    }
    Ok(())
}

// ── on the GPU ───────────────────────────────────────────────────────────────────────────────────────────────────

/// The steps on a picture (ACEScct, `w`×`h`), frame `frame` of the film (the grain's seed); `face_of` finds the face
/// a window follows, in the picture as it is at that window.
#[allow(clippy::too_many_arguments)]
pub fn apply(gpu: &Gpu, img: &Image, steps: &[Step], cubes: &HashMap<String, Cube>, w: f64, h: f64, frame: u64, face_of: &mut dyn FnMut(&Gpu, &Image) -> Result<Option<Rect>>) -> Result<Image> {
    let mut cur = img.clone();
    let k = h / 1080.0;
    for s in steps {
        cur = match s {
            Step::Cube { key, .. } => match cubes.get(key) {
                Some(cube) => gpu.apply_cube(&cur, cube)?,
                None => anyhow::bail!("a grade's cube was not baked ({key})"),
            },
            Step::Balance(b) => gpu.balance(&cur, Some(b))?,
            Step::Mask { window, key, mix, inner } => {
                let face = if window.as_ref().is_some_and(|w| w.track == "face") { face_of(gpu, &cur)? } else { None };
                let (win, shape) = match window {
                    None => ([0.0; 4], [0.0; 4]),
                    Some(wd) => {
                        // centre and half size in pixels, Core Image's y from the bottom
                        let (cx, cy, hw, hh) = match face {
                            Some(f) if wd.track == "face" => {
                                let (fw, fh) = ((f[2] - f[0]) * w, (f[3] - f[1]) * h);
                                (((f[0] + f[2]) / 2.0 + (wd.x - 0.5) * (f[2] - f[0])) * w, (1.0 - ((f[1] + f[3]) / 2.0 + (wd.y - 0.5) * (f[3] - f[1]))) * h, fw * wd.w, fh * wd.h)
                            }
                            _ => (wd.x * w, (1.0 - wd.y) * h, wd.w * w / 2.0, wd.h * h / 2.0),
                        };
                        ([cx, cy, hw, hh], [wd.angle.to_radians(), wd.feather, if wd.shape == "rect" { 2.0 } else { 1.0 }, if wd.invert { 1.0 } else { 0.0 }])
                    }
                };
                let (kv, kb) = match key {
                    None => ([0.0; 4], [0.0; 4]),
                    Some(k) => ([k.hue.to_radians(), (k.width / 2.0).to_radians(), k.sat_lo / 100.0, k.sat_hi / 100.0], [k.luma_lo / 100.0, k.luma_hi / 100.0, k.soft, 1.0]),
                };
                let disp = gpu.output(&cur)?;
                let mask = gpu.mask(&disp, win, shape, kv, kb)?;
                let inside = apply(gpu, &cur, inner, cubes, w, h, frame, face_of)?;
                gpu.blend(&cur, &inside, &mask, *mix)?
            }
            Step::Texture(t) => match t {
                Tool::Pop { amount, radius } => gpu.pop(&cur, radius * k, amount * 1.5)?,
                Tool::Halation(g) | Tool::Bloom(g) => {
                    let lin_of = |c: f64| if c <= 0.155251141552511 { (c - 0.0729055341958355) / 10.5402377416545 } else { 2f64.powf(c * 17.52 - 9.72) };
                    let lin = gpu.to_linear(&cur)?;
                    // halation: red spreads widest, green less, blue hardly (film's); bloom: a white glow
                    let (tint, gain) = if matches!(t, Tool::Halation(_)) { ([1.0, 0.28, 0.06], 0.6) } else { ([1.0, 0.97, 0.92], 0.4) };
                    let lin = gpu.glow(&lin, lin_of(g.threshold), g.radius * k, tint, g.amount * gain)?;
                    gpu.to_cct(&lin)?
                }
                Tool::Grain { amount, size, chroma } => gpu.grain(&cur, *amount, size * k, (frame % 997) as f64 * 1.618 + 0.5, *chroma)?,
                Tool::Vignette { amount, size, softness, roundness } => gpu.vignette(&cur, *amount, *size, *softness, *roundness)?,
                _ => cur,
            },
            Step::Mix { strength, inner } => {
                let done = apply(gpu, &cur, inner, cubes, w, h, frame, face_of)?;
                let all = gpu.mask(&cur, [0.0; 4], [0.0; 4], [0.0; 4], [0.0; 4])?;
                gpu.blend(&cur, &done, &all, *strength)?
            }
        };
    }
    Ok(cur)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// a tool of `id` with `fields`, as the Rust checks it, back as JSON
    fn checked(id: &str, fields: Value) -> Value {
        let mut v = json!({ "tool": id });
        if id == "lut" {
            v["hash"] = json!("a".repeat(64));
        }
        for (k, x) in fields.as_object().unwrap() {
            v[k] = x.clone();
        }
        let it: Item = serde_json::from_value(v).unwrap_or_else(|e| panic!("{id}: {e}"));
        serde_json::to_value(clean_item(it, 0).unwrap()).unwrap()
    }

    /// the same value (numbers as numbers: 0 and 0.0 alike)
    fn same(a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Number(x), Value::Number(y)) => (x.as_f64().unwrap() - y.as_f64().unwrap()).abs() < 1e-9,
            (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q)),
            _ => a == b,
        }
    }

    #[test]
    fn the_registry_and_the_rust_agree_on_every_tool() {
        let reg: Value = serde_json::from_str(REGISTRY).unwrap();
        for t in reg["tools"].as_array().unwrap() {
            let id = t["id"].as_str().unwrap();
            let bare = checked(id, json!({}));
            for p in t["params"].as_array().unwrap() {
                let key = p["key"].as_str().unwrap();
                if p["type"] == "hash" {
                    continue;
                }
                // its default
                assert!(same(&bare[key], &p["def"]), "{id}.{key}: the Rust's default {} is not the registry's {}", bare[key], p["def"]);
                // its range: too much and too little come back as the ends
                if p["type"] == "number" {
                    let (lo, hi) = (p["min"].as_f64().unwrap(), p["max"].as_f64().unwrap());
                    let hue = key.ends_with("hue");
                    let up = checked(id, json!({ key: 1e6 }))[key].as_f64().unwrap();
                    let down = checked(id, json!({ key: -1e6 }))[key].as_f64().unwrap();
                    if !hue {
                        assert_eq!((down, up), (lo, hi), "{id}.{key}: the Rust's range is not the registry's");
                    }
                }
            }
        }
        // and no tool the Rust knows is missing from the registry
        let ids: Vec<&str> = reg["tools"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap()).collect();
        for id in ["balance", "cdl", "contrast", "split", "hue", "hi_sat", "lut", "window", "key", "pop", "halation", "bloom", "grain", "vignette"] {
            assert!(ids.contains(&id), "{id} is not in the registry");
        }
    }
}
