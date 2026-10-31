//! The face-runtime's output (`Aven.Runtime.Style`): a tree and its style, typed. A rule is a selector, a descendant
//! chain of one to four compounds (an allowlisted tag, up to four classes), and typed declarations; the CSS text is
//! written from them ([`Rule::css`]), never taken from a runtime. Which rule reaches a node is CSS's cascade: the more
//! classes, then the more tags, then the later rule.
//!
//! A face is accepted ([`face_ok`]) only when the tree passes the applier's check, every interactive node is named,
//! every clickable non-control has a role and a tab stop, every image an `alt`, every rule is in range, every text is
//! at least 9 px where a slide is narrowest (356 px), and every text has WCAG's contrast against what it is drawn on:
//! the nearest background above it, or an earlier sibling layer that covers its whole parent.

use aven_core::Value;
use aven_runtimes_tree::{Node, TreeLimits, check, tag_ok};

use crate::face::{BLACK, Rgb, WHITE, alt_ok, class_ok, interactive, named, reaches, role_ok};

// Values

/// A number's CSS text (`Dec.css`): the shortest decimal of hundredths, no trailing zeros.
fn dec_css(d: i64) -> String {
    let n = d.unsigned_abs();
    let frac = n % 100;
    let sign = if d < 0 { "-" } else { "" };
    let tail = if frac == 0 {
        String::new()
    } else if frac.is_multiple_of(10) {
        format!(".{}", frac / 10)
    } else {
        format!(".{frac:02}")
    };
    format!("{sign}{}{tail}", n / 100)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LenUnit {
    Cqw,
    Pct,
    Px,
    Em,
}

impl LenUnit {
    pub fn name(self) -> &'static str {
        match self {
            LenUnit::Cqw => "cqw",
            LenUnit::Pct => "%",
            LenUnit::Px => "px",
            LenUnit::Em => "em",
        }
    }

    fn of_name(s: &str) -> Option<LenUnit> {
        [LenUnit::Cqw, LenUnit::Pct, LenUnit::Px, LenUnit::Em]
            .into_iter()
            .find(|u| u.name() == s)
    }
}

/// A length: a number in hundredths and its unit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Len {
    pub v: i64,
    pub unit: LenUnit,
}

impl Len {
    pub fn css(self) -> String {
        if self.v == 0 {
            "0".into()
        } else {
            format!("{}{}", dec_css(self.v), self.unit.name())
        }
    }

    /// Within ±10,000 units, in one of `units`.
    fn within(self, units: &[LenUnit]) -> bool {
        units.contains(&self.unit) && self.v.unsigned_abs() <= 1_000_000
    }

    /// The size in hundredths of a pixel where a slide is narrowest (`Len.pxAt`).
    pub fn px_at(self) -> i64 {
        match self.unit {
            LenUnit::Px => self.v,
            LenUnit::Cqw => (self.v * NARROWEST).div_euclid(100),
            _ => 0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    All,
    Top,
    Right,
    Bottom,
    Left,
}

const SIDES: [Side; 5] = [Side::All, Side::Top, Side::Right, Side::Bottom, Side::Left];

impl Side {
    fn suffix(self) -> &'static str {
        match self {
            Side::All => "",
            Side::Top => "-top",
            Side::Right => "-right",
            Side::Bottom => "-bottom",
            Side::Left => "-left",
        }
    }

    fn name(self) -> &'static str {
        match self {
            Side::All => "",
            Side::Top => "top",
            Side::Right => "right",
            Side::Bottom => "bottom",
            Side::Left => "left",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Line {
    Solid,
    Dotted,
}

impl Line {
    fn name(self) -> &'static str {
        match self {
            Line::Solid => "solid",
            Line::Dotted => "dotted",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Display {
    Block,
    InlineBlock,
    Flex,
}

impl Display {
    fn name(self) -> &'static str {
        match self {
            Display::Block => "block",
            Display::InlineBlock => "inline-block",
            Display::Flex => "flex",
        }
    }
}

/// One step of a transform: `rotate` in hundredths of a degree, `scale` in hundredths.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    TranslateX(Len),
    TranslateY(Len),
    Rotate(i64),
    Scale(i64),
}

const BOX: [LenUnit; 3] = [LenUnit::Cqw, LenUnit::Pct, LenUnit::Px];

impl Step {
    fn css(self) -> String {
        match self {
            Step::TranslateX(l) => format!("translateX({})", l.css()),
            Step::TranslateY(l) => format!("translateY({})", l.css()),
            Step::Rotate(d) => format!("rotate({}deg)", dec_css(d)),
            Step::Scale(s) => format!("scale({})", dec_css(s)),
        }
    }

    fn ok(self) -> bool {
        match self {
            Step::TranslateX(l) | Step::TranslateY(l) => l.within(&BOX),
            Step::Rotate(d) => d.unsigned_abs() <= 36000,
            Step::Scale(s) => 0 < s && s <= 1000,
        }
    }
}

// Declarations

/// A declaration, typed: the only properties a face's style has (`Decl`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decl {
    Position(bool),
    Cover,
    Place(Side, Len),
    Width(Len),
    Height(Len),
    Display(Display),
    Aspect(u64, u64),
    Container,
    Clip,
    Margin(Side, Len),
    Padding(Side, Len),
    Gap(Len),
    Radius(Len),
    Border(Side, Len, Line, Rgb),
    Background(Rgb),
    Color(Rgb),
    Sans,
    Size(Len),
    Weight(u64),
    Leading(i64),
    Tracking(Len),
    Upper,
    Center,
    Nowrap,
    Transform(Vec<Step>),
    Origin(Len, Len),
    Arrowhead,
}

impl Decl {
    pub fn css(&self) -> String {
        match self {
            Decl::Position(a) => format!("position:{}", if *a { "absolute" } else { "relative" }),
            Decl::Cover => "inset:0".into(),
            Decl::Place(s, l) => format!("{}:{}", s.name(), l.css()),
            Decl::Width(l) => format!("width:{}", l.css()),
            Decl::Height(l) => format!("height:{}", l.css()),
            Decl::Display(d) => format!("display:{}", d.name()),
            Decl::Aspect(w, h) => format!("aspect-ratio:{w}/{h}"),
            Decl::Container => "container-type:inline-size".into(),
            Decl::Clip => "overflow:hidden".into(),
            Decl::Margin(s, l) => format!("margin{}:{}", s.suffix(), l.css()),
            Decl::Padding(s, l) => format!("padding{}:{}", s.suffix(), l.css()),
            Decl::Gap(l) => format!("gap:{}", l.css()),
            Decl::Radius(l) => format!("border-radius:{}", l.css()),
            Decl::Border(s, w, line, c) => {
                format!(
                    "border{}:{} {} {}",
                    s.suffix(),
                    w.css(),
                    line.name(),
                    c.css()
                )
            }
            Decl::Background(c) => format!("background-color:{}", c.css()),
            Decl::Color(c) => format!("color:{}", c.css()),
            Decl::Sans => "font-family:'Inter Variable',system-ui,sans-serif".into(),
            Decl::Size(l) => format!("font-size:{}", l.css()),
            Decl::Weight(w) => format!("font-weight:{w}"),
            Decl::Leading(h) => format!("line-height:{}", dec_css(*h)),
            Decl::Tracking(l) => format!("letter-spacing:{}", l.css()),
            Decl::Upper => "text-transform:uppercase".into(),
            Decl::Center => "text-align:center".into(),
            Decl::Nowrap => "white-space:nowrap".into(),
            Decl::Transform(ss) => format!(
                "transform:{}",
                ss.iter().map(|s| s.css()).collect::<Vec<_>>().join(" ")
            ),
            Decl::Origin(x, y) => format!("transform-origin:{} {}", x.css(), y.css()),
            Decl::Arrowhead => "clip-path:polygon(0 0,100% 50%,0 100%,25% 50%)".into(),
        }
    }

    /// A declaration's values are in range (`Decl.ok`).
    pub fn ok(&self) -> bool {
        match self {
            Decl::Place(s, l) => *s != Side::All && l.within(&BOX),
            Decl::Width(l) | Decl::Height(l) | Decl::Gap(l) => l.within(&BOX) && l.v >= 0,
            Decl::Aspect(w, h) => (1..=100).contains(w) && (1..=100).contains(h),
            Decl::Margin(_, l) => l.within(&BOX),
            Decl::Padding(_, l) | Decl::Radius(l) => l.within(&BOX) && l.v >= 0,
            Decl::Border(_, w, _, _) => w.within(&[LenUnit::Cqw, LenUnit::Px]) && w.v >= 0,
            Decl::Size(l) => l.within(&[LenUnit::Cqw, LenUnit::Px]) && l.v > 0,
            Decl::Weight(w) => (1..=9).contains(&(w / 100)) && w.is_multiple_of(100),
            Decl::Leading(h) => (50..=300).contains(h),
            Decl::Tracking(l) => l.within(&[LenUnit::Em]) && l.v.unsigned_abs() <= 50,
            Decl::Transform(ss) => !ss.is_empty() && ss.len() <= 4 && ss.iter().all(|s| s.ok()),
            Decl::Origin(x, y) => x.within(&BOX) && y.within(&BOX),
            _ => true,
        }
    }
}

// Selectors and rules

/// One compound: an optional tag and class names.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Compound {
    pub tag: Option<String>,
    pub classes: Vec<String>,
}

fn node_tag(n: &Node) -> Option<&str> {
    match n {
        Node::El { tag, .. } => Some(tag),
        Node::Text(_) => None,
    }
}

/// A node's classes: its `class` attribute split on spaces (`Node.classes`).
fn node_classes(n: &Node) -> Vec<&str> {
    match n {
        Node::El { attrs, .. } => attrs
            .iter()
            .find(|(k, _)| k == "class")
            .map_or("", |(_, v)| v.as_str())
            .split(' ')
            .filter(|c| !c.is_empty())
            .collect(),
        Node::Text(_) => vec![],
    }
}

impl Compound {
    fn ok(&self) -> bool {
        (self.tag.is_some() || !self.classes.is_empty())
            && self.classes.len() <= 4
            && self.classes.iter().all(|c| class_ok(c))
            && self.tag.as_deref().is_none_or(tag_ok)
    }

    fn css(&self) -> String {
        let mut s = self.tag.clone().unwrap_or_default();
        for c in &self.classes {
            s.push('.');
            s.push_str(c);
        }
        s
    }

    fn matches(&self, n: &Node) -> bool {
        let cs = node_classes(n);
        self.tag.as_deref().is_none_or(|t| node_tag(n) == Some(t))
            && self.classes.iter().all(|c| cs.contains(&c.as_str()))
    }
}

/// The compounds before the last, nearest first, matched up the ancestors, nearest first (`ancestorsMatch`).
fn ancestors_match(cs: &[&Compound], ancestors: &[&Node]) -> bool {
    let mut i = 0;
    for a in ancestors {
        if i == cs.len() {
            return true;
        }
        if cs[i].matches(a) {
            i += 1;
        }
    }
    i == cs.len()
}

/// A rule: a selector, compounds from the outermost, and its declarations, in order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rule {
    pub sel: Vec<Compound>,
    pub decls: Vec<Decl>,
}

impl Rule {
    /// A plain selector, values in range (`Rule.ok`).
    pub fn ok(&self) -> bool {
        (1..=4).contains(&self.sel.len())
            && self.sel.iter().all(|c| c.ok())
            && !self.decls.is_empty()
            && self.decls.len() <= 32
            && self.decls.iter().all(|d| d.ok())
    }

    /// The CSS text of a rule, written from its data: the only CSS a face ever gives (`Rule.css`).
    pub fn css(&self) -> String {
        let sel: Vec<String> = self.sel.iter().map(|c| c.css()).collect();
        let decls: Vec<String> = self.decls.iter().map(|d| d.css()).collect();
        format!("{}{{{}}}", sel.join(" "), decls.join(";"))
    }

    /// CSS's specificity: classes first, then tags.
    fn specificity(&self) -> (usize, usize) {
        (
            self.sel.iter().map(|c| c.classes.len()).sum(),
            self.sel.iter().filter(|c| c.tag.is_some()).count(),
        )
    }

    /// Whether the selector picks `n`, its ancestors nearest first.
    fn matches(&self, ancestors: &[&Node], n: &Node) -> bool {
        let mut rev: Vec<&Compound> = self.sel.iter().rev().collect();
        if rev.is_empty() {
            return false;
        }
        let last = rev.remove(0);
        last.matches(n) && ancestors_match(&rev, ancestors)
    }
}

/// The declarations that reach `n`, in the order they apply: matching rules by specificity, the later last among
/// equals, each rule's declarations in order (`cascade`).
fn cascade<'a>(style: &'a [Rule], ancestors: &[&Node], n: &Node) -> Vec<&'a Decl> {
    let mut rules: Vec<&Rule> = style.iter().filter(|r| r.matches(ancestors, n)).collect();
    rules.sort_by_key(|r| r.specificity());
    rules.into_iter().flat_map(|r| r.decls.iter()).collect()
}

/// What a text is drawn with: its colour, what it is drawn on, its size and its weight.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Look {
    pub fg: Rgb,
    pub bg: Rgb,
    pub size: Len,
    pub weight: u64,
}

/// The page a face is drawn on, before any rule.
pub const BASE: Look = Look {
    fg: BLACK,
    bg: WHITE,
    size: Len {
        v: 1600,
        unit: LenUnit::Px,
    },
    weight: 400,
};

/// The width a slide is smallest at, a phone's: `cqw` is measured there.
pub const NARROWEST: i64 = 356;

/// The smallest text, in hundredths of a pixel where a slide is narrowest: 9 px.
pub const MIN_TEXT: i64 = 900;

impl Look {
    fn apply(self, ds: &[&Decl]) -> Look {
        ds.iter().fold(self, |l, d| match d {
            Decl::Color(c) => Look { fg: *c, ..l },
            Decl::Background(c) => Look { bg: *c, ..l },
            Decl::Size(s) => Look { size: *s, ..l },
            Decl::Weight(w) => Look { weight: *w, ..l },
            _ => l,
        })
    }

    /// Large text: at least 24 px, or 18.66 px bold.
    pub fn large(self) -> bool {
        let px = self.size.px_at();
        px >= 2400 || (self.weight >= 700 && px >= 1866)
    }

    pub fn contrast_ok(self) -> bool {
        if self.large() {
            reaches(self.fg, self.bg, 3, 1)
        } else {
            reaches(self.fg, self.bg, 9, 2)
        }
    }

    pub fn size_ok(self) -> bool {
        self.size.px_at() >= MIN_TEXT
    }
}

/// What a layer that covers its whole parent with a background paints (`covers`).
fn covers(ds: &[&Decl]) -> Option<Rgb> {
    if !(ds.contains(&&Decl::Position(true)) && ds.contains(&&Decl::Cover)) {
        return None;
    }
    ds.iter().fold(None, |b, d| match d {
        Decl::Background(c) => Some(*c),
        _ => b,
    })
}

/// Lean's `String.trimAscii.isEmpty`: only white space, or nothing.
fn blank(s: &str) -> bool {
    s.bytes().all(|b| matches!(b, b' ' | b'\t' | b'\n' | b'\r'))
}

/// Every text with what it is drawn with (`textsOf`, `kidsTexts`); `ancestors` nearest first.
fn texts<'a>(
    style: &[Rule],
    ancestors: &mut Vec<&'a Node>,
    l: Look,
    n: &'a Node,
    out: &mut Vec<(Look, String)>,
) {
    match n {
        Node::Text(s) => {
            if !blank(s) {
                out.push((l, s.clone()));
            }
        }
        Node::El { kids, .. } => {
            let near: Vec<&Node> = ancestors.iter().rev().copied().collect();
            let l = l.apply(&cascade(style, &near, n));
            ancestors.push(n);
            let near: Vec<&Node> = ancestors.iter().rev().copied().collect();
            let mut under = l;
            for k in kids {
                texts(style, ancestors, under, k, out);
                if let Node::El { .. } = k
                    && let Some(c) = covers(&cascade(style, &near, k))
                {
                    under = Look { bg: c, ..under };
                }
            }
            ancestors.pop();
        }
    }
}

/// A face: its tree and its style.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FaceOut {
    pub tree: Node,
    pub style: Vec<Rule>,
}

impl FaceOut {
    pub fn texts(&self) -> Vec<(Look, String)> {
        let mut out = Vec::new();
        texts(&self.style, &mut Vec::new(), BASE, &self.tree, &mut out);
        out
    }
}

/// What a face gets wrong, by kind (`Issues`): bad rules by their place in the style.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Issues {
    pub unnamed: usize,
    pub no_role: usize,
    pub no_alt: usize,
    pub bad_rules: Vec<usize>,
    pub small: usize,
    pub low_contrast: usize,
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
    let ts = o.texts();
    Issues {
        unnamed: nodes.iter().filter(|n| interactive(n) && !named(n)).count(),
        no_role: nodes.iter().filter(|n| !role_ok(n)).count(),
        no_alt: nodes.iter().filter(|n| !alt_ok(n)).count(),
        bad_rules: o
            .style
            .iter()
            .enumerate()
            .filter(|(_, r)| !r.ok())
            .map(|(i, _)| i)
            .collect(),
        small: ts.iter().filter(|(l, _)| !l.size_ok()).count(),
        low_contrast: ts.iter().filter(|(l, _)| !l.contrast_ok()).count(),
    }
}

/// A face is accepted (`faceOk`). The tree is checked first, so the walks only ever see a tree within its limits.
pub fn face_ok(l: TreeLimits, o: &FaceOut) -> bool {
    if !check(l, &o.tree) {
        return false;
    }
    let i = issues(o);
    i.unnamed == 0
        && i.no_role == 0
        && i.no_alt == 0
        && i.bad_rules.is_empty()
        && i.small == 0
        && i.low_contrast == 0
}

// As Values

fn text(s: &str) -> Value {
    Value::Text(s.into())
}

/// An integer as the codec writes it (`Value.int`).
fn int(i: i64) -> Value {
    if i >= 0 {
        Value::Uint(i as u64)
    } else {
        Value::Nint(i.unsigned_abs() - 1)
    }
}

fn int_of(v: &Value) -> Option<i64> {
    match v {
        Value::Uint(n) => i64::try_from(*n).ok(),
        Value::Nint(n) => i64::try_from(*n).ok().map(|n| -n - 1),
        _ => None,
    }
}

fn rgb_value(c: Rgb) -> Value {
    Value::Bytes(vec![c.r, c.g, c.b])
}

fn rgb_of(v: &Value) -> Option<Rgb> {
    match v {
        Value::Bytes(b) => match b.as_slice() {
            [r, g, b] => Some(Rgb {
                r: *r,
                g: *g,
                b: *b,
            }),
            _ => None,
        },
        _ => None,
    }
}

fn str_of(v: &Value) -> Option<&str> {
    match v {
        Value::Text(s) => Some(s),
        _ => None,
    }
}

impl Len {
    fn value(self) -> Value {
        Value::Array(vec![int(self.v), text(self.unit.name())])
    }

    fn of_value(v: &Value) -> Option<Len> {
        match v {
            Value::Array(xs) => match xs.as_slice() {
                [n, u] => Some(Len {
                    v: int_of(n)?,
                    unit: LenUnit::of_name(str_of(u)?)?,
                }),
                _ => None,
            },
            _ => None,
        }
    }
}

impl Step {
    fn value(self) -> Value {
        let (n, v) = match self {
            Step::TranslateX(l) => ("translateX", l.value()),
            Step::TranslateY(l) => ("translateY", l.value()),
            Step::Rotate(d) => ("rotate", int(d)),
            Step::Scale(s) => ("scale", int(s)),
        };
        Value::Array(vec![text(n), v])
    }

    fn of_value(v: &Value) -> Option<Step> {
        let Value::Array(xs) = v else { return None };
        let [t, a] = xs.as_slice() else { return None };
        match str_of(t)? {
            "translateX" => Len::of_value(a).map(Step::TranslateX),
            "translateY" => Len::of_value(a).map(Step::TranslateY),
            "rotate" => int_of(a).map(Step::Rotate),
            "scale" => int_of(a).map(Step::Scale),
            _ => None,
        }
    }
}

impl Decl {
    /// A declaration as a Value: its property's name, then its values (`Decl.value`).
    pub fn value(&self) -> Value {
        let t = text;
        let xs = match self {
            Decl::Position(a) => vec![t("position"), t(if *a { "absolute" } else { "relative" })],
            Decl::Cover => vec![t("inset")],
            Decl::Place(s, l) => vec![t(s.name()), l.value()],
            Decl::Width(l) => vec![t("width"), l.value()],
            Decl::Height(l) => vec![t("height"), l.value()],
            Decl::Display(d) => vec![t("display"), t(d.name())],
            Decl::Aspect(w, h) => vec![t("aspect-ratio"), Value::Uint(*w), Value::Uint(*h)],
            Decl::Container => vec![t("container-type")],
            Decl::Clip => vec![t("overflow")],
            Decl::Margin(s, l) => vec![t(&format!("margin{}", s.suffix())), l.value()],
            Decl::Padding(s, l) => vec![t(&format!("padding{}", s.suffix())), l.value()],
            Decl::Gap(l) => vec![t("gap"), l.value()],
            Decl::Radius(l) => vec![t("border-radius"), l.value()],
            Decl::Border(s, w, line, c) => {
                vec![
                    t(&format!("border{}", s.suffix())),
                    w.value(),
                    t(line.name()),
                    rgb_value(*c),
                ]
            }
            Decl::Background(c) => vec![t("background-color"), rgb_value(*c)],
            Decl::Color(c) => vec![t("color"), rgb_value(*c)],
            Decl::Sans => vec![t("font-family")],
            Decl::Size(l) => vec![t("font-size"), l.value()],
            Decl::Weight(w) => vec![t("font-weight"), Value::Uint(*w)],
            Decl::Leading(h) => vec![t("line-height"), int(*h)],
            Decl::Tracking(l) => vec![t("letter-spacing"), l.value()],
            Decl::Upper => vec![t("text-transform")],
            Decl::Center => vec![t("text-align")],
            Decl::Nowrap => vec![t("white-space")],
            Decl::Transform(ss) => vec![
                t("transform"),
                Value::Array(ss.iter().map(|s| s.value()).collect()),
            ],
            Decl::Origin(x, y) => vec![t("transform-origin"), x.value(), y.value()],
            Decl::Arrowhead => vec![t("clip-path")],
        };
        Value::Array(xs)
    }

    /// A declaration from its Value (`Decl.ofValue?`).
    pub fn of_value(v: &Value) -> Option<Decl> {
        let Value::Array(xs) = v else { return None };
        let (n, args) = xs.split_first()?;
        let n = str_of(n)?;
        let len = |i: usize| args.get(i).and_then(Len::of_value);
        let side = |base: &str| {
            SIDES
                .into_iter()
                .find(|s| n == format!("{base}{}", s.suffix()))
        };
        Some(match (n, args.len()) {
            ("position", 1) => match str_of(&args[0])? {
                "absolute" => Decl::Position(true),
                "relative" => Decl::Position(false),
                _ => return None,
            },
            ("inset", 0) => Decl::Cover,
            ("width", 1) => Decl::Width(len(0)?),
            ("height", 1) => Decl::Height(len(0)?),
            ("display", 1) => Decl::Display(match str_of(&args[0])? {
                "block" => Display::Block,
                "inline-block" => Display::InlineBlock,
                "flex" => Display::Flex,
                _ => return None,
            }),
            ("aspect-ratio", 2) => match (&args[0], &args[1]) {
                (Value::Uint(w), Value::Uint(h)) => Decl::Aspect(*w, *h),
                _ => return None,
            },
            ("container-type", 0) => Decl::Container,
            ("overflow", 0) => Decl::Clip,
            ("gap", 1) => Decl::Gap(len(0)?),
            ("border-radius", 1) => Decl::Radius(len(0)?),
            ("background-color", 1) => Decl::Background(rgb_of(&args[0])?),
            ("color", 1) => Decl::Color(rgb_of(&args[0])?),
            ("font-family", 0) => Decl::Sans,
            ("font-size", 1) => Decl::Size(len(0)?),
            ("font-weight", 1) => match &args[0] {
                Value::Uint(w) => Decl::Weight(*w),
                _ => return None,
            },
            ("line-height", 1) => Decl::Leading(int_of(&args[0])?),
            ("letter-spacing", 1) => Decl::Tracking(len(0)?),
            ("text-transform", 0) => Decl::Upper,
            ("text-align", 0) => Decl::Center,
            ("white-space", 0) => Decl::Nowrap,
            ("transform", 1) => match &args[0] {
                Value::Array(ss) => {
                    Decl::Transform(ss.iter().map(Step::of_value).collect::<Option<_>>()?)
                }
                _ => return None,
            },
            ("transform-origin", 2) => Decl::Origin(len(0)?, len(1)?),
            ("clip-path", 0) => Decl::Arrowhead,
            (_, 1) => {
                if let Some(s) = [Side::Top, Side::Right, Side::Bottom, Side::Left]
                    .into_iter()
                    .find(|s| s.name() == n)
                {
                    Decl::Place(s, len(0)?)
                } else if let Some(s) = side("margin") {
                    Decl::Margin(s, len(0)?)
                } else {
                    Decl::Padding(side("padding")?, len(0)?)
                }
            }
            (_, 3) => {
                let line = match str_of(&args[1])? {
                    "solid" => Line::Solid,
                    "dotted" => Line::Dotted,
                    _ => return None,
                };
                Decl::Border(side("border")?, len(0)?, line, rgb_of(&args[2])?)
            }
            _ => return None,
        })
    }
}

impl Rule {
    /// A rule as a Value: `[[compound, …], [declaration, …]]`, a compound `[tag or null, [class, …]]` (`Rule.value`).
    pub fn value(&self) -> Value {
        let compound = |c: &Compound| {
            Value::Array(vec![
                c.tag.as_deref().map_or(Value::Null, text),
                Value::Array(c.classes.iter().map(|s| text(s)).collect()),
            ])
        };
        Value::Array(vec![
            Value::Array(self.sel.iter().map(compound).collect()),
            Value::Array(self.decls.iter().map(|d| d.value()).collect()),
        ])
    }

    pub fn of_value(v: &Value) -> Option<Rule> {
        let Value::Array(xs) = v else { return None };
        let [Value::Array(cs), Value::Array(ds)] = xs.as_slice() else {
            return None;
        };
        let compound = |c: &Value| {
            let Value::Array(xs) = c else { return None };
            let [t, Value::Array(cls)] = xs.as_slice() else {
                return None;
            };
            let tag = match t {
                Value::Null => None,
                t => Some(str_of(t)?.to_string()),
            };
            let classes = cls
                .iter()
                .map(|c| str_of(c).map(String::from))
                .collect::<Option<_>>()?;
            Some(Compound { tag, classes })
        };
        Some(Rule {
            sel: cs.iter().map(compound).collect::<Option<_>>()?,
            decls: ds.iter().map(Decl::of_value).collect::<Option<_>>()?,
        })
    }
}
