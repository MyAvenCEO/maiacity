//! face-runtime against hostile parts and data: random markup and data from the grammar's own pieces, none of which
//! may panic, and every answer a face that passes `faceOk`.

use aven_core::Value;
use aven_runtimes_face::{FaceOut, Key, Markup, Rgb, Rule, Src, eval, face_ok};
use aven_runtimes_tree::{Node, TREE_LIMITS};

/// xorshift64, as the specs' property tests draw.
struct Rng(u64);

impl Rng {
    fn below(&mut self, n: u64) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0 % n
    }

    fn pick<'a>(&mut self, xs: &[&'a str]) -> &'a str {
        xs[self.below(xs.len() as u64) as usize]
    }
}

const TAGS: [&str; 12] = [
    "div", "p", "span", "button", "input", "img", "a", "script", "iframe", "li", "svg", "h2",
];
const ATTRS: [&str; 12] = [
    "class",
    "aria-label",
    "href",
    "src",
    "onclick",
    "style",
    "data-on",
    "role",
    "tabindex",
    "alt",
    "title",
    "type",
];
const TEXTS: [&str; 8] = [
    "",
    " ",
    "hi",
    "javascript:x()",
    "https://maia.city",
    "0",
    "checkbox",
    "row",
];

fn src(r: &mut Rng) -> Src {
    match r.below(3) {
        0 => Src::Lit(r.pick(&TEXTS).into()),
        1 => Src::Data(vec![Key::Field(r.pick(&["a", "b", "list"]).into())]),
        _ => Src::Item(vec![Key::Field("k".into())]),
    }
}

fn markup(r: &mut Rng, depth: u32) -> Markup {
    match if depth == 0 { 0 } else { r.below(6) } {
        0 => Markup::Text(src(r)),
        1 => Markup::Each {
            list: vec![Key::Field("list".into())],
            key: vec![Key::Field("k".into())],
            body: Box::new(markup(r, depth - 1)),
        },
        2 => Markup::Use {
            place: r.pick(&["x", "y"]).into(),
            component: "c".into(),
            props: vec![("p".into(), src(r))],
        },
        _ => Markup::El {
            tag: r.pick(&TAGS).into(),
            attrs: (0..r.below(4))
                .map(|_| (r.pick(&ATTRS).to_string(), src(r)))
                .collect(),
            on: (r.below(3) == 0).then(|| "go".to_string()),
            kids: (0..r.below(4)).map(|_| markup(r, depth - 1)).collect(),
        },
    }
}

fn data(r: &mut Rng) -> Value {
    let item = |r: &mut Rng| Value::Map(vec![("k".into(), Value::Text(r.pick(&TEXTS).into()))]);
    Value::Map(vec![
        ("a".into(), Value::Text(r.pick(&TEXTS).into())),
        ("b".into(), Value::Uint(r.below(10))),
        (
            "list".into(),
            Value::Array((0..r.below(4)).map(|_| item(r)).collect()),
        ),
    ])
}

#[test]
fn random_faces() {
    let mut r = Rng(0x9e3779b97f4a7c15);
    let (mut drawn, mut refused) = (0, 0);
    for _ in 0..5000 {
        let style = vec![Rule {
            cls: r.pick(&["row", "x}y", ""]).into(),
            color: Some(Rgb {
                r: r.below(256) as u8,
                g: 0,
                b: 0,
            }),
            background: None,
            size: Some(r.below(40)),
            bold: Some(r.below(2) == 0),
        }];
        let part = aven_runtimes_face::FacePart {
            markup: markup(&mut r, 5),
            style,
        }
        .value();
        match eval(&part, &data(&mut r)) {
            Ok(Value::Map(kvs)) => {
                let tree =
                    Node::of_value(&kvs.iter().find(|(k, _)| k == "tree").unwrap().1, 64).unwrap();
                let style = match &kvs.iter().find(|(k, _)| k == "style").unwrap().1 {
                    Value::Array(rs) => rs.iter().map(|x| Rule::of_value(x).unwrap()).collect(),
                    _ => panic!(),
                };
                assert!(face_ok(TREE_LIMITS, &FaceOut { tree, style }));
                drawn += 1;
            }
            Ok(_) => panic!("an answer that isn't a face"),
            Err(_) => refused += 1,
        }
    }
    assert!(
        drawn > 100 && refused > 100,
        "{drawn} drawn, {refused} refused"
    );
}

/// Markup deeper than a tree may be is refused while it is read, and so is a part that isn't one. The deep part is
/// built as a hostile one arrives, as nested Values, and taken apart without recursing.
#[test]
fn deep_and_broken_parts() {
    let t = |s: &str| Value::Text(s.into());
    let mut m = Value::Array(vec![t("text"), Value::Array(vec![t("lit"), t("deep")])]);
    for _ in 0..100_000 {
        m = Value::Array(vec![
            t("el"),
            t("div"),
            Value::Array(vec![]),
            Value::Null,
            Value::Array(vec![m]),
        ]);
    }
    let part = Value::Array(vec![m, Value::Array(vec![])]);
    assert!(eval(&part, &Value::Null).is_err());
    assert!(eval(&Value::Array(vec![t("no")]), &Value::Null).is_err());
    let mut stack = vec![part];
    while let Some(x) = stack.pop() {
        if let Value::Array(xs) = x {
            stack.extend(xs);
        }
    }
}
