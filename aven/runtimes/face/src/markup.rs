//! face-runtime's input: markup (`Aven.Runtime.Markup`). A face's markup is a tree in a small vocabulary with no
//! conditionals: text from a literal, `$` (the face data) or `$$` (the current list item); elements; `$each`, keyed;
//! `$use`, a placement. Drawing it gives nodes and placements: a tag the allowlist refuses is dropped with what is
//! under it, an attribute it refuses is dropped, and `data-on` and `data-place` are the runtime's alone.

use aven_codec::Value;
use aven_runtimes_tree::{Node, attr_ok, tag_ok};

/// A key of a path: a map field or an array index (`Aven.Runtime.Key`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Key {
    Field(String),
    Index(usize),
}

pub type Path = Vec<Key>;

/// A path by its fields.
pub fn path(ks: &[&str]) -> Path {
    ks.iter().map(|k| Key::Field(k.to_string())).collect()
}

/// What is at a path (`get`).
pub fn get<'a>(v: &'a Value, p: &[Key]) -> Option<&'a Value> {
    let Some((k, rest)) = p.split_first() else {
        return Some(v);
    };
    match (v, k) {
        (Value::Map(kvs), Key::Field(f)) => get(&kvs.iter().find(|(k, _)| k == f)?.1, rest),
        (Value::Array(xs), Key::Index(i)) => get(xs.get(*i)?, rest),
        _ => None,
    }
}

/// Where a piece of text comes from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Src {
    Lit(String),
    Data(Path),
    Item(Path),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Markup {
    Text(Src),
    El {
        tag: String,
        attrs: Vec<(String, Src)>,
        on: Option<String>,
        kids: Vec<Markup>,
    },
    Each {
        list: Path,
        key: Path,
        body: Box<Markup>,
    },
    Use {
        place: String,
        component: String,
        props: Vec<(String, Src)>,
    },
}

/// A Value as text (`shown`): text as itself, numbers in decimal, `true` and `false`; anything else is empty.
pub fn shown(v: &Value) -> String {
    match v {
        Value::Text(s) => s.clone(),
        Value::Uint(n) => n.to_string(),
        Value::Nint(n) => format!("-{}", *n as u128 + 1),
        Value::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

impl Src {
    pub fn eval(&self, data: &Value, item: &Value) -> String {
        match self {
            Src::Lit(s) => s.clone(),
            Src::Data(p) => get(data, p).map(shown).unwrap_or_default(),
            Src::Item(p) => get(item, p).map(shown).unwrap_or_default(),
        }
    }
}

/// A placement: the place, the component placed there, and its props.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Placement {
    pub place: String,
    pub component: String,
    pub props: Vec<(String, String)>,
}

/// The items of the list at `p` with their keys, skipping an item whose key repeats an earlier one (`keyed`).
pub fn keyed<'a>(data: &'a Value, p: &[Key], key: &[Key]) -> Vec<(String, &'a Value)> {
    let items: &[Value] = match get(data, p) {
        Some(Value::Array(xs)) => xs,
        _ => &[],
    };
    let mut out: Vec<(String, &Value)> = Vec::new();
    for it in items {
        let k = get(it, key).map(shown).unwrap_or_default();
        if !out.iter().any(|(x, _)| *x == k) {
            out.push((k, it));
        }
    }
    out
}

/// The attributes the runtime writes itself; markup can't set them.
pub const RESERVED: [&str; 2] = ["data-on", "data-place"];

/// An element's attributes: each source evaluated, the event added, and whatever the allowlist refuses dropped.
pub fn attrs_of(
    tag: &str,
    attrs: &[(String, Src)],
    on: &Option<String>,
    data: &Value,
    item: &Value,
) -> Vec<(String, String)> {
    attrs
        .iter()
        .filter(|(k, _)| !RESERVED.contains(&k.as_str()))
        .map(|(k, s)| (k.clone(), s.eval(data, item)))
        .chain(on.iter().map(|e| ("data-on".to_string(), e.clone())))
        .filter(|(k, v)| attr_ok(tag, k, v))
        .collect()
}

/// Markup drawn (`draw`): its nodes and its placements.
pub fn draw(data: &Value, item: &Value, pre: &str, m: &Markup) -> (Vec<Node>, Vec<Placement>) {
    match m {
        Markup::Text(src) => (vec![Node::Text(src.eval(data, item))], vec![]),
        Markup::El {
            tag,
            attrs,
            on,
            kids,
        } => {
            if !tag_ok(tag) {
                return (vec![], vec![]);
            }
            let (mut ns, mut pls) = (vec![], vec![]);
            for k in kids {
                let (n, p) = draw(data, item, pre, k);
                ns.extend(n);
                pls.extend(p);
            }
            (
                vec![Node::El {
                    tag: tag.clone(),
                    attrs: attrs_of(tag, attrs, on, data, item),
                    kids: ns,
                }],
                pls,
            )
        }
        Markup::Each { list, key, body } => {
            let (mut ns, mut pls) = (vec![], vec![]);
            for (kt, it) in keyed(data, list, key) {
                let (n, p) = draw(data, it, &format!("{pre}/{kt}"), body);
                ns.extend(n);
                pls.extend(p);
            }
            (ns, pls)
        }
        Markup::Use {
            place,
            component,
            props,
        } => {
            let at = format!("{pre}/{place}");
            (
                vec![Node::El {
                    tag: "slot".into(),
                    attrs: vec![("data-place".into(), at.clone())],
                    kids: vec![],
                }],
                vec![Placement {
                    place: at,
                    component: component.clone(),
                    props: props
                        .iter()
                        .map(|(k, s)| (k.clone(), s.eval(data, item)))
                        .collect(),
                }],
            )
        }
    }
}

impl Markup {
    /// The events a markup names.
    pub fn events(&self) -> Vec<String> {
        match self {
            Markup::Text(_) | Markup::Use { .. } => vec![],
            Markup::El { on, kids, .. } => on
                .iter()
                .cloned()
                .chain(kids.iter().flat_map(Markup::events))
                .collect(),
            Markup::Each { body, .. } => body.events(),
        }
    }
}
