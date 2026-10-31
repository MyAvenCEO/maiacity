//! What markdown-runtime makes of documents, ordinary and hostile. Every answer must pass the applier's check; a
//! document that can't be drawn within the tree's limits is refused, never built past them.

use aven_core::Value;
use aven_runtimes_contract::Failure;
use aven_runtimes_markdown::{MAX_PART, Params, eval, render};
use aven_runtimes_tree::{Node, TREE_LIMITS, check};

fn el(tag: &str, attrs: &[(&str, &str)], kids: Vec<Node>) -> Node {
    Node::El {
        tag: tag.into(),
        attrs: attrs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        kids,
    }
}

fn t(s: &str) -> Node {
    Node::Text(s.into())
}

fn doc(kids: Vec<Node>) -> Node {
    el("article", &[("class", "markdown")], kids)
}

fn md(s: &str) -> Node {
    let n = render(s, &Params::default(), TREE_LIMITS).expect("drawn");
    assert!(check(TREE_LIMITS, &n), "{s}");
    n
}

fn brain() -> Params {
    Params {
        links: vec![
            ("glossary:".into(), "#/brain/glossary/".into()),
            (
                "aven/".into(),
                "https://github.com/MyAvenCEO/maiacity/blob/main/aven/".into(),
            ),
        ],
        ..Params::default()
    }
}

#[test]
fn blocks_and_inlines() {
    assert_eq!(
        md("# A key owns a vault\n\nSome *text*, **bold**, ~~gone~~ and `code`."),
        doc(vec![
            el(
                "h1",
                &[("id", "a-key-owns-a-vault")],
                vec![t("A key owns a vault")]
            ),
            el(
                "p",
                &[],
                vec![
                    t("Some "),
                    el("em", &[], vec![t("text")]),
                    t(", "),
                    el("strong", &[], vec![t("bold")]),
                    t(", "),
                    el("del", &[], vec![t("gone")]),
                    t(" and "),
                    el("code", &[], vec![t("code")]),
                    t("."),
                ]
            ),
        ])
    );
}

#[test]
fn lists_quotes_code_rules() {
    assert_eq!(
        md(
            "- one\n- two\n  1. nested\n\n> quoted\n\n```rust\nfn main() {}\n```\n\n---\n\n3. three"
        ),
        doc(vec![
            el(
                "ul",
                &[],
                vec![
                    el("li", &[], vec![t("one")]),
                    el(
                        "li",
                        &[],
                        vec![
                            t("two"),
                            el("ol", &[], vec![el("li", &[], vec![t("nested")])])
                        ]
                    ),
                ]
            ),
            el("blockquote", &[], vec![el("p", &[], vec![t("quoted")])]),
            el(
                "pre",
                &[],
                vec![el(
                    "code",
                    &[("class", "language-rust")],
                    vec![t("fn main() {}\n")]
                )]
            ),
            el("hr", &[], vec![]),
            el(
                "ol",
                &[("start", "3")],
                vec![el("li", &[], vec![t("three")])]
            ),
        ])
    );
}

#[test]
fn tables_and_tasks() {
    assert_eq!(
        md("| Term | Means |\n|:-----|------:|\n| vault | an identity |\n\n- [x] done\n- [ ] open"),
        doc(vec![
            el(
                "table",
                &[],
                vec![
                    el(
                        "thead",
                        &[],
                        vec![el(
                            "tr",
                            &[],
                            vec![
                                el(
                                    "th",
                                    &[("scope", "col"), ("class", "left")],
                                    vec![t("Term")]
                                ),
                                el(
                                    "th",
                                    &[("scope", "col"), ("class", "right")],
                                    vec![t("Means")]
                                ),
                            ]
                        )]
                    ),
                    el(
                        "tbody",
                        &[],
                        vec![el(
                            "tr",
                            &[],
                            vec![
                                el("td", &[("class", "left")], vec![t("vault")]),
                                el("td", &[("class", "right")], vec![t("an identity")]),
                            ]
                        )]
                    ),
                ]
            ),
            el(
                "ul",
                &[],
                vec![
                    el(
                        "li",
                        &[],
                        vec![
                            el(
                                "input",
                                &[("type", "checkbox"), ("disabled", ""), ("checked", "")],
                                vec![]
                            ),
                            t("done")
                        ]
                    ),
                    el(
                        "li",
                        &[],
                        vec![
                            el("input", &[("type", "checkbox"), ("disabled", "")], vec![]),
                            t("open")
                        ]
                    ),
                ]
            ),
        ])
    );
}

#[test]
fn headings_get_github_ids() {
    let n = md("## Intro\n\n## Intro\n\n### What's new? (2026)");
    let Node::El { kids, .. } = n else { panic!() };
    let ids: Vec<String> = kids
        .iter()
        .map(|k| match k {
            Node::El { attrs, .. } => attrs.iter().find(|(k, _)| k == "id").unwrap().1.clone(),
            _ => panic!(),
        })
        .collect();
    assert_eq!(ids, ["intro", "intro-1", "whats-new-2026"]);
}

#[test]
fn links_under_rules() {
    let n = render(
        "[the glossary](glossary:vault), [the spec](aven/DB2/README.md), [site](https://maia.city \"Maia\"), \
         [bad](javascript:steal()), [mail](mailto:hi@maia.city), [plain](http://maia.city)",
        &brain(),
        TREE_LIMITS,
    )
    .unwrap();
    assert!(check(TREE_LIMITS, &n));
    assert_eq!(
        n,
        doc(vec![el(
            "p",
            &[],
            vec![
                el(
                    "a",
                    &[("href", "#/brain/glossary/vault")],
                    vec![t("the glossary")]
                ),
                t(", "),
                el(
                    "a",
                    &[(
                        "href",
                        "https://github.com/MyAvenCEO/maiacity/blob/main/aven/DB2/README.md"
                    )],
                    vec![t("the spec")]
                ),
                t(", "),
                el(
                    "a",
                    &[("href", "https://maia.city"), ("title", "Maia")],
                    vec![t("site")]
                ),
                t(", bad, "),
                el("a", &[("href", "mailto:hi@maia.city")], vec![t("mail")]),
                t(", plain"),
            ]
        )])
    );
}

#[test]
fn images_only_by_hash() {
    let hash = format!("/files/{}", "ab".repeat(32));
    assert_eq!(
        md(&format!(
            "![a *dome*]({hash}) ![tracker](https://evil.example/pixel.png)"
        )),
        doc(vec![el(
            "p",
            &[],
            vec![
                el("img", &[("src", &hash), ("alt", "a dome")], vec![]),
                t(" tracker")
            ]
        )])
    );
}

#[test]
fn raw_html_is_text() {
    fn walk(n: &Node, s: &mut String) {
        match n {
            Node::Text(x) => s.push_str(x),
            Node::El { tag, attrs, kids } => {
                assert!(["article", "p"].contains(&tag.as_str()), "{tag}");
                assert!(attrs.iter().all(|(k, _)| k == "class"));
                kids.iter().for_each(|k| walk(k, s));
            }
        }
    }
    let n = md("<script>steal()</script>\n\nhi <img src=x onerror=steal()> <b onclick=x>b</b>");
    let mut s = String::new();
    walk(&n, &mut s);
    assert!(s.contains("<script>steal()</script>") && s.contains("onerror=steal()"));
}

/// Nesting, node and text limits refuse a hostile document while it is read, before it is built.
#[test]
fn hostile_documents_are_refused() {
    let p = Params::default();
    assert!(render(&">".repeat(100_000), &p, TREE_LIMITS).is_none());
    let deep_list: String = (0..2_000)
        .map(|i| format!("{}- x\n", "  ".repeat(i)))
        .collect();
    assert!(render(&deep_list, &p, TREE_LIMITS).is_none());
    assert!(render(&"*a* ".repeat(30_000), &p, TREE_LIMITS).is_none());
    // within the limits, the same kinds draw
    assert!(render(&">".repeat(40), &p, TREE_LIMITS).is_some());
}

#[test]
fn eval_under_the_contract() {
    let part = |s: &str| Value::Bytes(s.as_bytes().to_vec());
    let none = Value::Map(vec![]);
    let o = eval(&part("# Hi"), &none).unwrap();
    assert_eq!(
        Node::of_value(&o, 64).map(|n| check(TREE_LIMITS, &n)),
        Some(true)
    );
    let rules = Value::Map(vec![(
        "links".into(),
        Value::Array(vec![Value::Array(vec![
            Value::Text("glossary:".into()),
            Value::Text("#/g/".into()),
        ])]),
    )]);
    let o = eval(&part("[v](glossary:vault)"), &rules).unwrap();
    assert!(aven_core::encode(&o).windows(8).any(|w| w == b"#/g/vaul"));
    assert_eq!(
        eval(&Value::Bytes(vec![0xC3, 0x28]), &none),
        Err(Failure::Refused)
    );
    assert_eq!(eval(&part("x"), &Value::Null), Err(Failure::Refused));
    assert_eq!(
        eval(&Value::Text("# Hi".into()), &none),
        Err(Failure::Refused)
    );
    assert_eq!(
        eval(&Value::Bytes(vec![b'a'; MAX_PART + 1]), &none),
        Err(Failure::Refused)
    );
}

/// xorshift64, as the specs' property tests draw.
struct Rng(u64);

impl Rng {
    fn below(&mut self, n: u64) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0 % n
    }
}

/// Random documents from Markdown's own pieces: none panics, and every one drawn passes the check.
#[test]
fn random_documents() {
    let pieces = [
        "# ",
        "## ",
        "> ",
        "- ",
        "1. ",
        "* ",
        "**",
        "_",
        "`",
        "```",
        "~~",
        "|",
        "---",
        "\n",
        "\n\n",
        "  ",
        "[",
        "]",
        "(",
        ")",
        "![",
        "<",
        ">",
        "&amp;",
        "javascript:",
        "https://x",
        "glossary:y",
        "\\",
        "x",
        "é",
        "[ ] ",
        "[x] ",
        "<b onclick=x>",
        "\t",
        "|:--|",
        "1)",
        "+ ",
        "#",
        "=",
        "{",
        "}",
    ];
    let mut r = Rng(0x9e3779b97f4a7c15);
    for _ in 0..3000 {
        let n = r.below(80);
        let s: String = (0..n)
            .map(|_| pieces[r.below(pieces.len() as u64) as usize])
            .collect();
        if let Some(t) = render(&s, &brain(), TREE_LIMITS) {
            assert!(check(TREE_LIMITS, &t), "{s:?}");
        }
    }
}

/// 200 KiB of GitHub-flavoured Markdown as docs are written, mostly prose, the plan's gate workload (README,
/// "Performance gates"). Its time is printed; the per-engine gate comes with the wasm host.
#[test]
fn a_large_document() {
    let para = "A vault is an identity that owns things: a person's, a coop's, an agent's or a device's. Its owners act \
        for it k of n, and authority runs only down the tree, never up. ";
    let section = format!(
        "## A section\n\n{}*emphasis*, `code` and a [link](https://maia.city).\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n",
        para.repeat(6)
    );
    let mut s = String::new();
    while s.len() < 200 * 1024 {
        s.push_str(&section);
    }
    let start = std::time::Instant::now();
    let t = render(&s, &Params::default(), TREE_LIMITS).expect("drawn");
    let took = start.elapsed();
    assert!(check(TREE_LIMITS, &t));
    eprintln!("200 KiB of Markdown: {took:?}");
    assert!(took.as_secs() < 5, "{took:?}");
}

/// The tree's limit of 20,000 nodes bounds a document too: 200 KiB with a table, a list and code every 170 bytes
/// would draw about 34,000, and is refused.
#[test]
fn a_dense_document_is_refused() {
    let section = "## A section\n\nA paragraph with *emphasis*, `code` and a [link](https://maia.city).\n\n\
        | a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n\n```\ncode\n```\n\n";
    let s = section.repeat(200 * 1024 / section.len() + 1);
    assert!(render(&s, &Params::default(), TREE_LIMITS).is_none());
}

/// v2: a soft break is a space; heading ids and in-page links carry the document's `idPrefix`; a relative link resolves
/// against the document's `base` before the rules, so the brain's links reach its pages and the repository.
#[test]
fn links_in_their_document() {
    let p = Params {
        links: vec![
            ("glossary:".into(), "#/brain/glossary/".into()),
            ("aven/DB2/brain/id/README.md".into(), "#/brain/id".into()),
            (
                "aven/".into(),
                "https://github.com/MyAvenCEO/maiacity/blob/main/aven/".into(),
            ),
        ],
        base: "aven/DB2/brain/GLOSSARY.md".into(),
        id_prefix: "g-".into(),
    };
    let s = "# Vault\n\nOne\nline. See [it](#vault), [id](id/README.md), [voice](VOICE.md#rules) and [x](../../../../x).";
    let got = render(s, &p, TREE_LIMITS).expect("drawn");
    let gh = "https://github.com/MyAvenCEO/maiacity/blob/main/aven/DB2/brain/VOICE.md#rules";
    assert_eq!(
        got,
        doc(vec![
            el("h1", &[("id", "g-vault")], vec![t("Vault")]),
            el(
                "p",
                &[],
                vec![
                    t("One line. See "),
                    el("a", &[("href", "#g-vault")], vec![t("it")]),
                    t(", "),
                    el("a", &[("href", "#/brain/id")], vec![t("id")]),
                    t(", "),
                    el("a", &[("href", gh)], vec![t("voice")]),
                    t(" and x."),
                ]
            ),
        ])
    );
}

/// The params refuse a key they don't know, a key twice, and a value of the wrong kind.
#[test]
fn params_are_exact() {
    use aven_core::Value;
    let text = |s: &str| Value::Text(s.into());
    assert_eq!(
        Params::of_value(&Value::Map(vec![])),
        Some(Params::default())
    );
    let p = Params::of_value(&Value::Map(vec![
        ("base".into(), text("a/b.md")),
        ("idPrefix".into(), text("g-")),
    ]))
    .unwrap();
    assert_eq!((p.base.as_str(), p.id_prefix.as_str()), ("a/b.md", "g-"));
    for bad in [
        vec![("other".into(), text("x"))],
        vec![("base".into(), text("a")), ("base".into(), text("b"))],
        vec![("base".into(), Value::Uint(1))],
        vec![("links".into(), text("x"))],
    ] {
        assert_eq!(Params::of_value(&Value::Map(bad.clone())), None, "{bad:?}");
    }
}
