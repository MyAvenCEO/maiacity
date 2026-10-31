//! The face-runtime's output (`Aven.Runtime.Face`): a tree and a style that is data, accepted only when the tree
//! passes the applier's check and a11y holds across markup and style: every interactive node named, every clickable
//! non-control given a role and a tab stop, every image an `alt`, every text WCAG's contrast against the background
//! the style resolves under it, and every class a plain name. Contrast is exact: one table of integers (`LINEAR`).

use aven_runtimes_tree::{Node, TreeLimits, check};

/// sRGB's 8-bit channel to linear light, × 10⁷, rounded (`linear`).
pub const LINEAR: [u64; 256] = [
    0, 3035, 6071, 9106, 12141, 15176, 18212, 21247, 24282, 27317, 30353, 33465, 36765, 40247,
    43914, 47770, 51815, 56054, 60488, 65121, 69954, 74990, 80232, 85681, 91341, 97212, 103298,
    109601, 116122, 122865, 129830, 137021, 144438, 152085, 159963, 168074, 176420, 185002, 193824,
    202886, 212190, 221739, 231534, 241576, 251869, 262412, 273209, 284260, 295568, 307134, 318960,
    331048, 343398, 356013, 368895, 382044, 395462, 409152, 423114, 437350, 451862, 466651, 481718,
    497066, 512695, 528606, 544803, 561285, 578054, 595112, 612461, 630100, 648033, 666259, 684782,
    703601, 722719, 742136, 761854, 781874, 802198, 822827, 843762, 865005, 886556, 908417, 930590,
    953075, 975873, 998987, 1022417, 1046165, 1070231, 1094617, 1119324, 1144354, 1169707, 1195384,
    1221388, 1247718, 1274377, 1301365, 1328683, 1356333, 1384316, 1412633, 1441285, 1470273,
    1499598, 1529262, 1559265, 1589608, 1620294, 1651322, 1682694, 1714411, 1746474, 1778884,
    1811642, 1844750, 1878208, 1912017, 1946178, 1980693, 2015563, 2050787, 2086369, 2122308,
    2158605, 2195262, 2232280, 2269659, 2307400, 2345506, 2383976, 2422811, 2462013, 2501583,
    2541521, 2581829, 2622507, 2663556, 2704978, 2746773, 2788943, 2831487, 2874408, 2917706,
    2961383, 3005438, 3049873, 3094689, 3139887, 3185468, 3231432, 3277781, 3324515, 3371636,
    3419144, 3467041, 3515326, 3564001, 3613068, 3662526, 3712377, 3762621, 3813260, 3864294,
    3915725, 3967552, 4019778, 4072402, 4125426, 4178851, 4232677, 4286905, 4341536, 4396572,
    4452012, 4507858, 4564110, 4620770, 4677838, 4735315, 4793202, 4851499, 4910208, 4969330,
    5028865, 5088813, 5149177, 5209956, 5271151, 5332764, 5394795, 5457245, 5520114, 5583404,
    5647115, 5711248, 5775804, 5840784, 5906188, 5972018, 6038273, 6104956, 6172066, 6239604,
    6307571, 6375969, 6444797, 6514056, 6583748, 6653873, 6724432, 6795425, 6866853, 6938718,
    7011019, 7083758, 7156935, 7230551, 7304607, 7379104, 7454042, 7529422, 7605245, 7681511,
    7758222, 7835378, 7912979, 7991027, 8069523, 8148466, 8227858, 8307699, 8387990, 8468732,
    8549926, 8631572, 8713671, 8796224, 8879231, 8962694, 9046612, 9130987, 9215819, 9301109,
    9386857, 9473065, 9559734, 9646862, 9734453, 9822506, 9911021, 10000000,
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

pub const BLACK: Rgb = Rgb { r: 0, g: 0, b: 0 };
pub const WHITE: Rgb = Rgb {
    r: 255,
    g: 255,
    b: 255,
};

impl Rgb {
    /// Relative luminance × 10¹¹.
    pub fn luminance(self) -> u64 {
        2126 * LINEAR[self.r as usize]
            + 7152 * LINEAR[self.g as usize]
            + 722 * LINEAR[self.b as usize]
    }

    /// `#rrggbb`.
    pub fn css(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }
}

/// 0.05 at the luminance's scale.
pub const FLARE: u64 = 5_000_000_000;

/// Whether two colours reach a ratio of `num / den`, in integers (`reaches`).
pub fn reaches(a: Rgb, b: Rgb, num: u64, den: u64) -> bool {
    let (la, lb) = (a.luminance(), b.luminance());
    let (hi, lo) = (la.max(lb), la.min(lb));
    den * (hi + FLARE) >= num * (lo + FLARE)
}

/// One style rule: a class and typed values.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rule {
    pub cls: String,
    pub color: Option<Rgb>,
    pub background: Option<Rgb>,
    pub size: Option<u64>,
    pub bold: Option<bool>,
}

/// A class name: lowercase letters, digits and `-`, so it can't close a rule or start another.
pub fn class_ok(c: &str) -> bool {
    !c.is_empty()
        && c.chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

impl Rule {
    /// The CSS text of a rule, generated: the only CSS a face ever gives (`Rule.css`).
    pub fn css(&self) -> String {
        let mut decls = Vec::new();
        if let Some(c) = self.color {
            decls.push(format!("color:{}", c.css()));
        }
        if let Some(c) = self.background {
            decls.push(format!("background-color:{}", c.css()));
        }
        if let Some(n) = self.size {
            decls.push(format!("font-size:{n}px"));
        }
        if let Some(b) = self.bold {
            decls.push(format!("font-weight:{}", if b { "700" } else { "400" }));
        }
        format!(".{}{{{}}}", self.cls, decls.join(";"))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FaceOut {
    pub tree: Node,
    pub style: Vec<Rule>,
}

/// What a text is drawn with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ctx {
    pub fg: Rgb,
    pub bg: Rgb,
    pub size: u64,
    pub bold: bool,
}

/// The page a face is drawn on, before any rule.
pub const BASE: Ctx = Ctx {
    fg: BLACK,
    bg: WHITE,
    size: 16,
    bold: false,
};

fn attr<'a>(n: &'a Node, k: &str) -> Option<&'a str> {
    match n {
        Node::El { attrs, .. } => attrs.iter().find(|(a, _)| a == k).map(|(_, v)| v.as_str()),
        Node::Text(_) => None,
    }
}

fn tag(n: &Node) -> Option<&str> {
    match n {
        Node::El { tag, .. } => Some(tag),
        Node::Text(_) => None,
    }
}

fn classes(n: &Node) -> Vec<&str> {
    attr(n, "class")
        .unwrap_or("")
        .split(' ')
        .filter(|c| !c.is_empty())
        .collect()
}

impl Ctx {
    /// The rules for a node's classes, in the style's order, the later winning (`Ctx.apply`).
    pub fn apply(self, style: &[Rule], n: &Node) -> Ctx {
        let cs = classes(n);
        style.iter().fold(self, |c, r| {
            if cs.contains(&r.cls.as_str()) {
                Ctx {
                    fg: r.color.unwrap_or(c.fg),
                    bg: r.background.unwrap_or(c.bg),
                    size: r.size.unwrap_or(c.size),
                    bold: r.bold.unwrap_or(c.bold),
                }
            } else {
                c
            }
        })
    }

    /// Large text: at least 24 px, or 19 px bold.
    pub fn large(self) -> bool {
        self.size >= 24 || (self.bold && self.size >= 19)
    }

    /// Enough contrast: 4.5:1, or 3:1 for large text.
    pub fn contrast_ok(self) -> bool {
        if self.large() {
            reaches(self.fg, self.bg, 3, 1)
        } else {
            reaches(self.fg, self.bg, 9, 2)
        }
    }
}

/// Lean's `String.trimAscii.isEmpty`: only ASCII white space, or nothing.
fn blank(s: &str) -> bool {
    s.bytes()
        .all(|b| matches!(b, b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c))
}

/// Every text with what it is drawn with (`Node.texts`).
pub fn texts(style: &[Rule], c: Ctx, n: &Node, out: &mut Vec<(Ctx, String)>) {
    match n {
        Node::Text(s) => {
            if !blank(s) {
                out.push((c, s.clone()));
            }
        }
        Node::El { kids, .. } => {
            let c = c.apply(style, n);
            kids.iter().for_each(|k| texts(style, c, k, out));
        }
    }
}

fn content(n: &Node, out: &mut String) {
    match n {
        Node::Text(s) => out.push_str(s),
        Node::El { kids, .. } => kids.iter().for_each(|k| content(k, out)),
    }
}

const NATIVE: [&str; 4] = ["a", "button", "input", "summary"];
const ROLES: [&str; 8] = [
    "button", "link", "checkbox", "switch", "radio", "tab", "menuitem", "option",
];

pub fn interactive(n: &Node) -> bool {
    match tag(n) {
        Some(t) => {
            NATIVE.contains(&t) || attr(n, "data-on").is_some() || attr(n, "tabindex").is_some()
        }
        None => false,
    }
}

/// An accessible name: `aria-label`, `title` or text inside.
pub fn named(n: &Node) -> bool {
    let non_empty = |k| attr(n, k).is_some_and(|v| !blank(v));
    let mut s = String::new();
    content(n, &mut s);
    non_empty("aria-label") || non_empty("title") || !blank(&s)
}

/// A node that takes clicks without being a native control has a role and a tab stop.
pub fn role_ok(n: &Node) -> bool {
    match tag(n) {
        Some(t) => {
            NATIVE.contains(&t)
                || attr(n, "data-on").is_none()
                || (attr(n, "role").is_some_and(|r| ROLES.contains(&r))
                    && attr(n, "tabindex").is_some())
        }
        None => true,
    }
}

pub fn alt_ok(n: &Node) -> bool {
    tag(n) != Some("img") || attr(n, "alt").is_some()
}

/// What a face's output gets wrong, by kind (`Issues`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Issues {
    pub unnamed: usize,
    pub no_role: usize,
    pub no_alt: usize,
    pub low_contrast: Vec<(Ctx, String)>,
    pub bad_class: usize,
}

fn all<'a>(n: &'a Node, out: &mut Vec<&'a Node>) {
    out.push(n);
    if let Node::El { kids, .. } = n {
        kids.iter().for_each(|k| all(k, out));
    }
}

pub fn issues(o: &FaceOut) -> Issues {
    let mut nodes = Vec::new();
    all(&o.tree, &mut nodes);
    let mut ts = Vec::new();
    texts(&o.style, BASE, &o.tree, &mut ts);
    Issues {
        unnamed: nodes.iter().filter(|n| interactive(n) && !named(n)).count(),
        no_role: nodes.iter().filter(|n| !role_ok(n)).count(),
        no_alt: nodes.iter().filter(|n| !alt_ok(n)).count(),
        low_contrast: ts.into_iter().filter(|(c, _)| !c.contrast_ok()).collect(),
        bad_class: o.style.iter().filter(|r| !class_ok(&r.cls)).count(),
    }
}

/// The face-runtime's output is accepted (`faceOk`). The tree is checked first, so the walks for a11y only ever see a
/// tree within its limits.
pub fn face_ok(l: TreeLimits, o: &FaceOut) -> bool {
    if !check(l, &o.tree) {
        return false;
    }
    let i = issues(o);
    i.unnamed == 0
        && i.no_role == 0
        && i.no_alt == 0
        && i.low_contrast.is_empty()
        && i.bad_class == 0
}
