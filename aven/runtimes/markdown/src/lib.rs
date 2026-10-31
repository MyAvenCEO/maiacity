//! markdown-runtime (`Aven.Runtime.Markdown`, README, "The first file runtimes, in order"): GitHub-flavoured Markdown
//! to a node tree that passed the applier's check.
//!
//! - CommonMark with GitHub's tables, task lists and strikethrough, parsed by pulldown-cmark. Raw HTML is text.
//! - Headings get GitHub's ids (`slug`, `slugs`, as Lean has them).
//! - A link the allowlist takes stays; any other is rewritten by the first rule whose prefix it starts with
//!   (`rewrite`), and kept only if the result is one the allowlist takes; otherwise its text stays, without a link.
//! - An image shows only as a file of the network by its hash (`/files/<hash>`); any other image is its alt text.
//! - Building stops and the file is refused as soon as nesting, nodes or text pass the tree's limits, so a hostile
//!   document is never built deeper or larger than a tree may be. Every answer passes `check` (`markdown_ok`).

#![forbid(unsafe_code)]

use aven_core::Value;
use aven_runtimes_contract::Failure;
use aven_runtimes_tree::{Node, TREE_LIMITS, TreeLimits, check, is_file_url, is_link};
use pulldown_cmark::{Alignment, CodeBlockKind, Event, Options, Parser, Tag, TagEnd};

/// The largest file markdown-runtime takes: the registry's limit for Markdown (`entry .markdown`).
pub const MAX_PART: usize = 1_048_576;

/// The runtime's input: the link rules, `{"links": [[prefix, replacement], …]}`, or `{}` for none.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Params {
    pub links: Vec<(String, String)>,
}

impl Params {
    /// `Params.ofValue?`: exactly `{}` or `{"links": [[text, text], …]}`.
    pub fn of_value(v: &Value) -> Option<Params> {
        match v {
            Value::Map(kvs) => match kvs.as_slice() {
                [] => Some(Params::default()),
                [(k, Value::Array(rs))] if k == "links" => rs
                    .iter()
                    .map(|r| match r {
                        Value::Array(ab) => match ab.as_slice() {
                            [Value::Text(a), Value::Text(b)] => Some((a.clone(), b.clone())),
                            _ => None,
                        },
                        _ => None,
                    })
                    .collect::<Option<Vec<_>>>()
                    .map(|links| Params { links }),
                _ => None,
            },
            _ => None,
        }
    }
}

/// Punctuation beyond ASCII: general punctuation, Latin-1's signs, and CJK's symbols and punctuation (`wide`).
fn wide(c: char) -> bool {
    let u = c as u32;
    (0x2000..=0x206F).contains(&u)
        || (0xA0..=0xBF).contains(&u)
        || (0x3000..=0x303F).contains(&u)
        || u == 0xD7
        || u == 0xF7
}

/// A heading's slug (`slug`).
pub fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_uppercase() {
            out.push(c.to_ascii_lowercase());
        } else if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_' {
            out.push(c);
        } else if c == ' ' {
            out.push('-');
        } else if c as u32 >= 128 && !wide(c) {
            out.push(c);
        }
    }
    out
}

/// Every heading's id, in order: its slug, with `-n` where the same slug came `n` times before (`slugs`).
pub fn slugs<S: AsRef<str>>(hs: &[S]) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    hs.iter()
        .map(|h| {
            let s = slug(h.as_ref());
            let n = seen.iter().filter(|x| **x == s).count();
            seen.push(s.clone());
            if n == 0 { s } else { format!("{s}-{n}") }
        })
        .collect()
}

/// A link's target (`rewrite`): kept when the allowlist takes it; otherwise rewritten by the first rule whose prefix
/// it starts with, and kept only if the allowlist takes the result.
pub fn rewrite(rules: &[(String, String)], href: &str) -> Option<String> {
    if is_link(href) {
        return Some(href.to_string());
    }
    let (from, to) = rules.iter().find(|(f, _)| href.starts_with(f.as_str()))?;
    let out = format!(
        "{to}{}",
        href.chars().skip(from.chars().count()).collect::<String>()
    );
    is_link(&out).then_some(out)
}

/// What an open element becomes when it closes.
enum Frame {
    El {
        tag: &'static str,
        attrs: Vec<(String, String)>,
        kids: Vec<Node>,
    },
    /// A link the rules refused: its children go to its parent.
    Bare(Vec<Node>),
    /// An image: its text is its alt.
    Image { src: Option<String>, alt: String },
}

struct Builder {
    stack: Vec<Frame>,
    limits: TreeLimits,
    nodes: usize,
    text: usize,
    /// The alignments of the table being built, and whether its head is open.
    aligns: Vec<Alignment>,
    in_head: bool,
    column: usize,
}

impl Builder {
    fn new(limits: TreeLimits) -> Builder {
        let root = Frame::El {
            tag: "article",
            attrs: vec![("class".into(), "markdown".into())],
            kids: vec![],
        };
        Builder {
            stack: vec![root],
            limits,
            nodes: 1,
            text: 0,
            aligns: vec![],
            in_head: false,
            column: 0,
        }
    }

    fn open(&mut self, tag: &'static str, attrs: Vec<(String, String)>) -> Result<(), Failure> {
        self.open_frame(Frame::El {
            tag,
            attrs,
            kids: vec![],
        })
    }

    /// A new frame, refused once the tree would be deeper than its limit, or hold more nodes.
    fn open_frame(&mut self, f: Frame) -> Result<(), Failure> {
        self.nodes += 1;
        if self.stack.len() + 1 > self.limits.depth || self.nodes > self.limits.nodes {
            return Err(Failure::Refused);
        }
        self.stack.push(f);
        Ok(())
    }

    fn kids(&mut self) -> &mut Vec<Node> {
        match self.stack.last_mut() {
            Some(Frame::El { kids, .. }) | Some(Frame::Bare(kids)) => kids,
            Some(Frame::Image { .. }) | None => unreachable!("text in an image goes to its alt"),
        }
    }

    fn push_text(&mut self, s: &str) -> Result<(), Failure> {
        self.text += s.len();
        if self.text > self.limits.text {
            return Err(Failure::Refused);
        }
        if let Some(Frame::Image { alt, .. }) = self.stack.last_mut() {
            alt.push_str(s);
            return Ok(());
        }
        let kids = self.kids();
        if let Some(Node::Text(t)) = kids.last_mut() {
            t.push_str(s);
            return Ok(());
        }
        kids.push(Node::Text(s.to_string()));
        self.nodes += 1;
        if self.nodes > self.limits.nodes {
            return Err(Failure::Refused);
        }
        Ok(())
    }

    fn leaf(&mut self, tag: &'static str, attrs: Vec<(String, String)>) -> Result<(), Failure> {
        self.nodes += 1;
        if self.nodes > self.limits.nodes || self.stack.len() + 1 > self.limits.depth {
            return Err(Failure::Refused);
        }
        let n = Node::El {
            tag: tag.into(),
            attrs,
            kids: vec![],
        };
        if let Some(Frame::Image { .. }) = self.stack.last() {
            return Ok(());
        }
        self.kids().push(n);
        Ok(())
    }

    /// Closes the innermost frame into its parent.
    fn close(&mut self) {
        let Some(f) = self.stack.pop() else { return };
        let into = |b: &mut Builder, n: Node| {
            if let Some(Frame::Image { alt, .. }) = b.stack.last_mut() {
                text_of(&n, alt);
                return;
            }
            let kids = b.kids();
            match (kids.last_mut(), n) {
                (Some(Node::Text(t)), Node::Text(s)) => t.push_str(&s),
                (_, n) => kids.push(n),
            }
        };
        match f {
            Frame::El { tag, attrs, kids } => into(
                self,
                Node::El {
                    tag: tag.into(),
                    attrs,
                    kids,
                },
            ),
            Frame::Bare(kids) => {
                for k in kids {
                    into(self, k);
                }
            }
            Frame::Image {
                src: Some(src),
                alt,
            } => into(
                self,
                Node::El {
                    tag: "img".into(),
                    attrs: vec![("src".into(), src), ("alt".into(), alt)],
                    kids: vec![],
                },
            ),
            Frame::Image { src: None, alt } => into(self, Node::Text(alt)),
        }
    }

    /// Closes frames up to and including the innermost one with this tag.
    fn close_tag(&mut self, tag: &str) {
        while let Some(f) = self.stack.last() {
            let done = matches!(f, Frame::El { tag: t, .. } if *t == tag);
            self.close();
            if done {
                break;
            }
        }
    }

    fn event(&mut self, e: Event, p: &Params) -> Result<(), Failure> {
        match e {
            Event::Start(t) => self.start(t, p)?,
            Event::End(t) => self.end(t),
            Event::Text(s) | Event::Html(s) | Event::InlineHtml(s) => self.push_text(&s)?,
            Event::Code(s) => {
                self.open("code", vec![])?;
                self.push_text(&s)?;
                self.close();
            }
            Event::SoftBreak => self.push_text("\n")?,
            Event::HardBreak => self.leaf("br", vec![])?,
            Event::Rule => self.leaf("hr", vec![])?,
            Event::TaskListMarker(done) => {
                let mut attrs = vec![
                    ("type".into(), "checkbox".into()),
                    ("disabled".into(), "".into()),
                ];
                if done {
                    attrs.push(("checked".into(), "".into()));
                }
                self.leaf("input", attrs)?;
            }
            // math and footnotes are not enabled; were they, their text would still be text
            Event::InlineMath(s) | Event::DisplayMath(s) | Event::FootnoteReference(s) => {
                self.push_text(&s)?
            }
        }
        Ok(())
    }

    fn start(&mut self, t: Tag, p: &Params) -> Result<(), Failure> {
        match t {
            Tag::Paragraph => self.open("p", vec![]),
            Tag::Heading { level, .. } => self.open(heading(level as usize), vec![]),
            Tag::BlockQuote(_) => self.open("blockquote", vec![]),
            Tag::CodeBlock(kind) => {
                self.open("pre", vec![])?;
                let attrs = match kind {
                    CodeBlockKind::Fenced(info) => match info.split_whitespace().next() {
                        Some(lang) => vec![("class".into(), format!("language-{lang}"))],
                        None => vec![],
                    },
                    CodeBlockKind::Indented => vec![],
                };
                self.open("code", attrs)
            }
            Tag::List(Some(start)) => {
                let attrs = if start == 1 {
                    vec![]
                } else {
                    vec![("start".into(), start.to_string())]
                };
                self.open("ol", attrs)
            }
            Tag::List(None) => self.open("ul", vec![]),
            Tag::Item => self.open("li", vec![]),
            Tag::Table(aligns) => {
                self.aligns = aligns;
                self.open("table", vec![])
            }
            Tag::TableHead => {
                self.in_head = true;
                self.column = 0;
                self.open("thead", vec![])?;
                self.open("tr", vec![])
            }
            Tag::TableRow => {
                self.column = 0;
                if matches!(self.stack.last(), Some(Frame::El { tag: "table", .. })) {
                    self.open("tbody", vec![])?;
                }
                self.open("tr", vec![])
            }
            Tag::TableCell => {
                let attrs = match self.aligns.get(self.column) {
                    Some(Alignment::Left) => vec![("class".into(), "left".into())],
                    Some(Alignment::Center) => vec![("class".into(), "center".into())],
                    Some(Alignment::Right) => vec![("class".into(), "right".into())],
                    _ => vec![],
                };
                self.column += 1;
                self.open(if self.in_head { "th" } else { "td" }, attrs)
            }
            Tag::Emphasis => self.open("em", vec![]),
            Tag::Strong => self.open("strong", vec![]),
            Tag::Strikethrough => self.open("del", vec![]),
            Tag::Superscript => self.open("sup", vec![]),
            Tag::Subscript => self.open("sub", vec![]),
            Tag::Link {
                dest_url, title, ..
            } => match rewrite(&p.links, &dest_url) {
                Some(href) => {
                    let mut attrs = vec![("href".into(), href)];
                    if !title.is_empty() {
                        attrs.push(("title".into(), title.to_string()));
                    }
                    self.open("a", attrs)
                }
                None => self.open_frame(Frame::Bare(vec![])),
            },
            Tag::Image { dest_url, .. } => {
                let src = is_file_url(&dest_url).then(|| dest_url.to_string());
                self.open_frame(Frame::Image {
                    src,
                    alt: String::new(),
                })
            }
            // raw HTML blocks are text in a paragraph; anything else not enabled is a plain block
            Tag::HtmlBlock => self.open("p", vec![]),
            _ => self.open("div", vec![]),
        }
    }

    fn end(&mut self, t: TagEnd) {
        match t {
            TagEnd::CodeBlock => self.close_tag("pre"),
            TagEnd::TableHead => {
                self.close_tag("thead");
                self.in_head = false;
            }
            TagEnd::Table => self.close_tag("table"),
            _ => self.close(),
        }
    }
}

fn heading(level: usize) -> &'static str {
    ["h1", "h2", "h3", "h4", "h5", "h6"][level.clamp(1, 6) - 1]
}

fn text_of(n: &Node, out: &mut String) {
    match n {
        Node::Text(s) => out.push_str(s),
        Node::El { kids, .. } => kids.iter().for_each(|k| text_of(k, out)),
    }
}

fn headings(n: &Node, out: &mut Vec<String>) {
    if let Node::El { tag, kids, .. } = n {
        if tag.len() == 2 && tag.starts_with('h') && tag.as_bytes()[1].is_ascii_digit() {
            let mut s = String::new();
            text_of(n, &mut s);
            out.push(s);
        } else {
            kids.iter().for_each(|k| headings(k, out));
        }
    }
}

fn name_headings(n: &mut Node, ids: &mut std::vec::IntoIter<String>) {
    if let Node::El { tag, attrs, kids } = n {
        if tag.len() == 2 && tag.starts_with('h') && tag.as_bytes()[1].is_ascii_digit() {
            if let Some(id) = ids.next() {
                attrs.push(("id".into(), id));
            }
        } else {
            kids.iter_mut().for_each(|k| name_headings(k, ids));
        }
    }
}

/// Markdown to a tree, within the tree's limits: `None` as soon as it would pass one.
pub fn render(md: &str, p: &Params, limits: TreeLimits) -> Option<Node> {
    let opts = Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS;
    let mut b = Builder::new(limits);
    for e in Parser::new_ext(md, opts) {
        b.event(e, p).ok()?;
    }
    while b.stack.len() > 1 {
        b.close();
    }
    let Frame::El { tag, attrs, kids } = b.stack.pop()? else {
        return None;
    };
    let mut root = Node::El {
        tag: tag.into(),
        attrs,
        kids,
    };
    let mut hs = Vec::new();
    headings(&root, &mut hs);
    name_headings(&mut root, &mut slugs(&hs).into_iter());
    Some(root)
}

/// markdown-runtime's answer (`markdownRuntime`'s `eval`): the part is the file's bytes, which must be UTF-8 and no
/// more than [`MAX_PART`]; the input the link rules. The answer is the tree, only when it passes the applier's check,
/// as its Value. Fuel and memory are the host's to meter.
pub fn eval(part: &Value, input: &Value) -> Result<Value, Failure> {
    let (Value::Bytes(bytes), Some(p)) = (part, Params::of_value(input)) else {
        return Err(Failure::Refused);
    };
    if bytes.len() > MAX_PART {
        return Err(Failure::Refused);
    }
    let md = std::str::from_utf8(bytes).map_err(|_| Failure::Refused)?;
    let t = render(md, &p, TREE_LIMITS).ok_or(Failure::Refused)?;
    if check(TREE_LIMITS, &t) {
        Ok(t.value())
    } else {
        Err(Failure::Refused)
    }
}
