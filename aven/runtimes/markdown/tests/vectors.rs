//! markdown-runtime against Lean's vectors (`spec/vectors/markdown.json`): heading ids, links under rules, links
//! resolved against their document, and both together under the brain's rules.

use aven_runtimes_markdown::{Params, link_to, resolve, rewrite, slugs};
use serde_json::Value as Json;

#[test]
fn markdown() {
    let path = format!(
        "{}/../spec/vectors/markdown.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let vs: Vec<Json> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let (mut headings, mut links, mut resolved, mut linked) = (0, 0, 0, 0);
    let rules = |input: &Json| -> Vec<(String, String)> {
        input["rules"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| (r[0].as_str().unwrap().into(), r[1].as_str().unwrap().into()))
            .collect()
    };
    for v in vs {
        let name = v["name"].as_str().unwrap();
        let input = &v["input"];
        if let Some(hs) = input.get("headings") {
            let hs: Vec<&str> = hs
                .as_array()
                .unwrap()
                .iter()
                .map(|h| h.as_str().unwrap())
                .collect();
            let ids: Vec<&str> = v["expected"]["ids"]
                .as_array()
                .unwrap()
                .iter()
                .map(|h| h.as_str().unwrap())
                .collect();
            assert_eq!(slugs(&hs), ids, "{name}");
            headings += 1;
        } else if let Some(want) = v["expected"].get("resolved") {
            let got = resolve(
                input["base"].as_str().unwrap(),
                input["idPrefix"].as_str().unwrap(),
                input["href"].as_str().unwrap(),
            );
            assert_eq!(got, want.as_str().unwrap(), "{name}");
            resolved += 1;
        } else if input.get("base").is_some() {
            let p = Params {
                links: rules(input),
                base: input["base"].as_str().unwrap().into(),
                id_prefix: input["idPrefix"].as_str().unwrap().into(),
            };
            let want = v["expected"]["href"].as_str().map(String::from);
            assert_eq!(link_to(&p, input["href"].as_str().unwrap()), want, "{name}");
            linked += 1;
        } else {
            let want = v["expected"]["href"].as_str().map(String::from);
            assert_eq!(
                rewrite(&rules(input), input["href"].as_str().unwrap()),
                want,
                "{name}"
            );
            links += 1;
        }
    }
    assert_eq!((headings, links, resolved, linked), (8, 10, 15, 6));
}
