//! The node-tree allowlist (`Aven.Runtime.Tree`, aven/runtimes/README.md, "Two kinds of output, and the drawers").
//!
//! The one output that becomes DOM: the trees markdown-runtime and face-runtime give. The applier checks every tree
//! against this allowlist again before it writes a node, whoever made the tree. A tree passes when every node does and
//! the whole is within its limits:
//!
//! - **tags** only from the allowlist, never one of `FORBIDDEN`;
//! - **attributes** only from the allowlist, for their tag, never an event handler (`on…`, in any case) or `style`;
//! - **URLs** only where a URL belongs: `src` names a file of the network by its hash (`/files/<64 hex>`), `href` is
//!   `https:`, `mailto:` or a fragment;
//! - **limits** on depth, nodes and text.
//!
//! Every function here is the Lean definition of the same name, and the tests replay the model's vectors
//! (`spec/vectors/tree.json`, `face.json`). No allocation beyond the tree itself, no imports: it builds for wasm32.

#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

use alloc::string::String;
use alloc::vec::Vec;

/// A node: text, or an element with attributes and children.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Node {
    Text(String),
    El {
        tag: String,
        attrs: Vec<(String, String)>,
        kids: Vec<Node>,
    },
}

pub const ALLOWED_TAGS: &[&str] = &[
    "div",
    "span",
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "dl",
    "dt",
    "dd",
    "pre",
    "code",
    "em",
    "strong",
    "b",
    "i",
    "u",
    "s",
    "sub",
    "sup",
    "del",
    "ins",
    "kbd",
    "mark",
    "small",
    "blockquote",
    "hr",
    "br",
    "a",
    "img",
    "table",
    "caption",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "button",
    "input",
    "label",
    "section",
    "article",
    "header",
    "footer",
    "nav",
    "figure",
    "figcaption",
    "details",
    "summary",
    "slot",
];

/// Never allowed, whatever the allowlist says: what runs, styles, frames, submits or leaves the allowlist's world.
pub const FORBIDDEN: &[&str] = &[
    "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "link", "meta",
    "base", "form", "svg", "math", "template", "noscript", "portal", "video", "audio", "source",
    "track", "canvas",
];

pub const GLOBAL_ATTRS: &[&str] = &[
    "class",
    "id",
    "role",
    "title",
    "lang",
    "dir",
    "tabindex",
    "hidden",
    "data-on",
    "data-key",
    "data-place",
];

pub fn tag_attrs(tag: &str) -> &'static [&'static str] {
    match tag {
        "a" => &["href"],
        "img" => &["src", "alt", "width", "height"],
        "td" | "th" => &["colspan", "rowspan", "scope"],
        "input" => &[
            "type",
            "checked",
            "disabled",
            "value",
            "placeholder",
            "name",
        ],
        "button" => &["type", "disabled"],
        "label" => &["for"],
        "ol" => &["start"],
        "li" => &["value"],
        "details" => &["open"],
        _ => &[],
    }
}

fn is_hex(c: char) -> bool {
    c.is_ascii_digit() || ('a'..='f').contains(&c)
}

/// A file of the network, by its hash: `/files/<64 lowercase hex>`.
pub fn is_file_url(v: &str) -> bool {
    v.chars().count() == 71 && v.starts_with("/files/") && v.chars().skip(7).all(is_hex)
}

/// A link a click may follow: `https:`, `mailto:` or a fragment of this page.
pub fn is_link(v: &str) -> bool {
    v.starts_with("https://") || v.starts_with("mailto:") || v.starts_with('#')
}

pub fn value_ok(k: &str, v: &str) -> bool {
    match k {
        "href" => is_link(v),
        "src" => is_file_url(v),
        "tabindex" => v == "0" || v == "-1",
        "type" => ["text", "checkbox", "radio", "number", "search", "button"].contains(&v),
        _ => true,
    }
}

pub fn is_aria(k: &str) -> bool {
    k.starts_with("aria-")
}

/// An event handler's name, in any case: `on…`. Lean's `Char.toLower` lowers ASCII only, as this does.
pub fn is_handler(k: &str) -> bool {
    let mut cs = k.chars().map(|c| c.to_ascii_lowercase());
    cs.next() == Some('o') && cs.next() == Some('n')
}

pub fn attr_ok(tag: &str, k: &str, v: &str) -> bool {
    !is_handler(k)
        && k != "style"
        && (GLOBAL_ATTRS.contains(&k) || is_aria(k) || tag_attrs(tag).contains(&k))
        && value_ok(k, v)
}

pub fn tag_ok(tag: &str) -> bool {
    ALLOWED_TAGS.contains(&tag) && !FORBIDDEN.contains(&tag)
}

/// The per-node check.
pub fn node_ok(n: &Node) -> bool {
    match n {
        Node::Text(_) => true,
        Node::El { tag, attrs, .. } => tag_ok(tag) && attrs.iter().all(|(k, v)| attr_ok(tag, k, v)),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TreeLimits {
    pub depth: usize,
    pub nodes: usize,
    pub text: usize,
}

/// `treeLimits`: 64 deep, 20,000 nodes, 8 MiB of text.
pub const TREE_LIMITS: TreeLimits = TreeLimits {
    depth: 64,
    nodes: 20_000,
    text: 8 * 1_048_576,
};

impl Node {
    /// `Node.depth`: a text is 1 deep, an element one more than its deepest child.
    pub fn depth(&self) -> usize {
        match self {
            Node::Text(_) => 1,
            Node::El { kids, .. } => 1 + kids.iter().map(Node::depth).max().unwrap_or(0),
        }
    }

    /// Every node, in document order (`Node.all`), handed to `f`; stops at the first `false`.
    pub fn all(&self, f: &mut impl FnMut(&Node) -> bool) -> bool {
        if !f(self) {
            return false;
        }
        match self {
            Node::Text(_) => true,
            Node::El { kids, .. } => kids.iter().all(|k| k.all(f)),
        }
    }
}

/// The applier's check (`check`): every node passes, and the tree is within its limits. It walks the tree with a
/// stack of its own, never recursing, and stops at the first node it refuses or the first limit passed: a hostile tree
/// costs no more than its limits, however deep it is.
pub fn check(l: TreeLimits, t: &Node) -> bool {
    let (mut nodes, mut text) = (0usize, 0usize);
    let mut stack: Vec<(&Node, usize)> = Vec::new();
    stack.push((t, 1));
    while let Some((n, depth)) = stack.pop() {
        nodes += 1;
        if depth > l.depth || nodes > l.nodes || !node_ok(n) {
            return false;
        }
        match n {
            Node::Text(s) => {
                text += s.len();
                if text > l.text {
                    return false;
                }
            }
            Node::El { kids, .. } => stack.extend(kids.iter().rev().map(|k| (k, depth + 1))),
        }
    }
    true
}

/// A tree as the Value it crosses in (`Node.value`), in the one codec: text as text, an element as
/// `[tag, [[name, value], …], [child, …]]`. Only text and arrays appear, so this writes them directly.
pub fn encode(n: &Node, out: &mut Vec<u8>) {
    match n {
        Node::Text(s) => text(s, out),
        Node::El { tag, attrs, kids } => {
            head(4, 3, out);
            text(tag, out);
            head(4, attrs.len() as u64, out);
            for (k, v) in attrs {
                head(4, 2, out);
                text(k, out);
                text(v, out);
            }
            head(4, kids.len() as u64, out);
            for k in kids {
                encode(k, out);
            }
        }
    }
}

fn text(s: &str, out: &mut Vec<u8>) {
    head(3, s.len() as u64, out);
    out.extend_from_slice(s.as_bytes());
}

/// A data item's head: its major type and its argument, in the shortest form (`Aven.Core.head`).
fn head(major: u8, n: u64, out: &mut Vec<u8>) {
    let m = major << 5;
    if n < 24 {
        out.push(m | n as u8);
    } else if n < 256 {
        out.extend_from_slice(&[m | 24, n as u8]);
    } else if n < 65_536 {
        out.push(m | 25);
        out.extend_from_slice(&(n as u16).to_be_bytes());
    } else if n < 4_294_967_296 {
        out.push(m | 26);
        out.extend_from_slice(&(n as u32).to_be_bytes());
    } else {
        out.push(m | 27);
        out.extend_from_slice(&n.to_be_bytes());
    }
}
