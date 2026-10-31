//! face-runtime (`Aven.Runtime.FaceRuntime`, `Markup`, `Style`, `Face`): a face's markup and style, with its data, to a
//! tree and a style as typed rules (selectors and declarations), accepted only when the tree passes the applier's check,
//! its a11y holds across both, every rule is in range, and every text is large enough and has enough contrast.
//!
//! The answer carries the style as data, never as CSS text: the drawer writes the CSS itself from rules it has checked
//! ([`Rule::css`]). Every function here is the Lean definition of the same name; the tests replay the model's vectors
//! (`markup.json`, `face.json`, `contrast.json`, `face-runtime.json`).

#![forbid(unsafe_code)]

pub mod face;
pub mod markup;
pub mod style;

use aven_core::Value;
use aven_runtimes_contract::Failure;
use aven_runtimes_tree::{Node, TREE_LIMITS};

pub use face::Rgb;
pub use markup::{Key, Markup, Path, Placement, Src, draw};
pub use style::{Decl, FaceOut, Rule, face_ok};

/// A face part: its markup and its style.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FacePart {
    pub markup: Markup,
    pub style: Vec<Rule>,
}

/// face-runtime (`faceRun`): the tree under one root, its style, and its placements; `None` when the face fails the
/// applier's check or its accessibility, or when two placements share a place.
pub fn face_run(fp: &FacePart, data: &Value) -> Option<(FaceOut, Vec<Placement>)> {
    let (ns, pls) = draw(data, &Value::Null, "", &fp.markup);
    let o = FaceOut {
        tree: Node::El {
            tag: "div".into(),
            attrs: vec![],
            kids: ns,
        },
        style: fp.style.clone(),
    };
    let mut places: Vec<&str> = pls.iter().map(|p| p.place.as_str()).collect();
    places.sort_unstable();
    places.dedup();
    (face_ok(TREE_LIMITS, &o) && places.len() == pls.len()).then_some((o, pls))
}

fn text(s: &str) -> Value {
    Value::Text(s.to_string())
}

/// A path as state-runtime writes one: fields as text, indexes as numbers.
fn path_of(v: &Value) -> Option<Path> {
    let Value::Array(ks) = v else { return None };
    ks.iter()
        .map(|k| match k {
            Value::Text(f) => Some(Key::Field(f.clone())),
            Value::Uint(i) => usize::try_from(*i).ok().map(Key::Index),
            _ => None,
        })
        .collect()
}

fn path_value(p: &Path) -> Value {
    Value::Array(
        p.iter()
            .map(|k| match k {
                Key::Field(f) => text(f),
                Key::Index(i) => Value::Uint(*i as u64),
            })
            .collect(),
    )
}

impl Src {
    pub fn value(&self) -> Value {
        match self {
            Src::Lit(s) => Value::Array(vec![text("lit"), text(s)]),
            Src::Data(p) => Value::Array(vec![text("$"), path_value(p)]),
            Src::Item(p) => Value::Array(vec![text("$$"), path_value(p)]),
        }
    }

    pub fn of_value(v: &Value) -> Option<Src> {
        let Value::Array(xs) = v else { return None };
        match xs.as_slice() {
            [Value::Text(t), Value::Text(s)] if t == "lit" => Some(Src::Lit(s.clone())),
            [Value::Text(t), p] if t == "$" => path_of(p).map(Src::Data),
            [Value::Text(t), p] if t == "$$" => path_of(p).map(Src::Item),
            _ => None,
        }
    }
}

fn named_srcs(v: &Value) -> Option<Vec<(String, Src)>> {
    let Value::Array(xs) = v else { return None };
    xs.iter()
        .map(|x| match x {
            Value::Array(ks) => match ks.as_slice() {
                [Value::Text(k), s] => Some((k.clone(), Src::of_value(s)?)),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

fn named_values(xs: &[(String, Src)]) -> Value {
    Value::Array(
        xs.iter()
            .map(|(k, s)| Value::Array(vec![text(k), s.value()]))
            .collect(),
    )
}

impl Markup {
    pub fn value(&self) -> Value {
        match self {
            Markup::Text(s) => Value::Array(vec![text("text"), s.value()]),
            Markup::El {
                tag,
                attrs,
                on,
                kids,
            } => Value::Array(vec![
                text("el"),
                text(tag),
                named_values(attrs),
                on.as_deref().map_or(Value::Null, text),
                Value::Array(kids.iter().map(Markup::value).collect()),
            ]),
            Markup::Each { list, key, body } => Value::Array(vec![
                text("each"),
                path_value(list),
                path_value(key),
                body.value(),
            ]),
            Markup::Use {
                place,
                component,
                props,
            } => Value::Array(vec![
                text("use"),
                text(place),
                text(component),
                named_values(props),
            ]),
        }
    }

    /// Markup from its Value, no deeper than `fuel` (`Markup.ofValue?`).
    pub fn of_value(fuel: usize, v: &Value) -> Option<Markup> {
        if fuel == 0 {
            return None;
        }
        let Value::Array(xs) = v else { return None };
        match xs.as_slice() {
            [Value::Text(t), s] if t == "text" => Src::of_value(s).map(Markup::Text),
            [
                Value::Text(t),
                Value::Text(tag),
                attrs,
                on,
                Value::Array(kids),
            ] if t == "el" => Some(Markup::El {
                tag: tag.clone(),
                attrs: named_srcs(attrs)?,
                on: match on {
                    Value::Null => None,
                    Value::Text(e) => Some(e.clone()),
                    _ => return None,
                },
                kids: kids
                    .iter()
                    .map(|k| Markup::of_value(fuel - 1, k))
                    .collect::<Option<_>>()?,
            }),
            [Value::Text(t), a, b, c] if t == "each" => Some(Markup::Each {
                list: path_of(a)?,
                key: path_of(b)?,
                body: Box::new(Markup::of_value(fuel - 1, c)?),
            }),
            [
                Value::Text(t),
                Value::Text(place),
                Value::Text(component),
                props,
            ] if t == "use" => Some(Markup::Use {
                place: place.clone(),
                component: component.clone(),
                props: named_srcs(props)?,
            }),
            _ => None,
        }
    }
}

/// How deep a face part's markup may nest: the tree's own limit (`markupDepth`).
pub const MARKUP_DEPTH: usize = TREE_LIMITS.depth;

impl FacePart {
    /// `[markup, [rule, …]]`.
    pub fn value(&self) -> Value {
        Value::Array(vec![
            self.markup.value(),
            Value::Array(self.style.iter().map(Rule::value).collect()),
        ])
    }

    pub fn of_value(v: &Value) -> Option<FacePart> {
        let Value::Array(xs) = v else { return None };
        let [m, Value::Array(rs)] = xs.as_slice() else {
            return None;
        };
        Some(FacePart {
            markup: Markup::of_value(MARKUP_DEPTH, m)?,
            style: rs.iter().map(Rule::of_value).collect::<Option<_>>()?,
        })
    }
}

impl Placement {
    pub fn value(&self) -> Value {
        Value::Array(vec![
            text(&self.place),
            text(&self.component),
            Value::Array(
                self.props
                    .iter()
                    .map(|(k, v)| Value::Array(vec![text(k), text(v)]))
                    .collect(),
            ),
        ])
    }
}

/// face-runtime's answer as a Value (`faceAnswer`): `{"tree", "style", "placements"}`.
pub fn face_answer(o: &FaceOut, pls: &[Placement]) -> Value {
    Value::Map(vec![
        ("tree".into(), o.tree.value()),
        (
            "style".into(),
            Value::Array(o.style.iter().map(Rule::value).collect()),
        ),
        (
            "placements".into(),
            Value::Array(pls.iter().map(Placement::value).collect()),
        ),
    ])
}

/// face-runtime's answer (`faceRuntime`'s `eval`): a part that doesn't read as a face part, or a face `face_run`
/// refuses, is refused. Fuel and memory are the host's to meter.
pub fn eval(part: &Value, data: &Value) -> Result<Value, Failure> {
    let fp = FacePart::of_value(part).ok_or(Failure::Refused)?;
    let (o, pls) = face_run(&fp, data).ok_or(Failure::Refused)?;
    Ok(face_answer(&o, &pls))
}
