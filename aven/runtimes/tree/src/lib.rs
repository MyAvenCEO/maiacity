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
//! (`spec/vectors/tree.json`, `face.json`). A tree crosses as a Value (`Node::value`), written by aven-codec's one codec;
//! no allocation beyond the tree itself, no imports: it builds for wasm32.

#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

use alloc::string::String;
use alloc::vec::Vec;

use aven_codec::Value;

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

impl Node {
    /// The tree as the Value it crosses in (`Node.value`).
    pub fn value(&self) -> Value {
        match self {
            Node::Text(s) => Value::Text(s.clone()),
            Node::El { tag, attrs, kids } => Value::Array(alloc::vec![
                Value::Text(tag.clone()),
                Value::Array(
                    attrs
                        .iter()
                        .map(|(k, v)| Value::Array(alloc::vec![
                            Value::Text(k.clone()),
                            Value::Text(v.clone())
                        ]))
                        .collect()
                ),
                Value::Array(kids.iter().map(Node::value).collect()),
            ]),
        }
    }

    /// A tree from its Value, no deeper than `depth`: what a drawer reads from a runtime's answer before it checks it.
    /// `None` for anything that isn't a tree's shape.
    pub fn of_value(v: &Value, depth: usize) -> Option<Node> {
        match v {
            Value::Text(s) => Some(Node::Text(s.clone())),
            Value::Array(xs) if depth > 0 => match xs.as_slice() {
                [Value::Text(tag), Value::Array(attrs), Value::Array(kids)] => Some(Node::El {
                    tag: tag.clone(),
                    attrs: attrs
                        .iter()
                        .map(|a| match a {
                            Value::Array(kv) => match kv.as_slice() {
                                [Value::Text(k), Value::Text(v)] => Some((k.clone(), v.clone())),
                                _ => None,
                            },
                            _ => None,
                        })
                        .collect::<Option<Vec<_>>>()?,
                    kids: kids
                        .iter()
                        .map(|k| Node::of_value(k, depth - 1))
                        .collect::<Option<Vec<_>>>()?,
                }),
                _ => None,
            },
            _ => None,
        }
    }
}
