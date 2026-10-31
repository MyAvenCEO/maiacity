//! markdown-runtime against Lean's vectors (`spec/vectors/markdown.json`): heading ids and links under rules.

use aven_runtimes_markdown::{rewrite, slugs};
use serde_json::Value as Json;

#[test]
fn markdown() {
    let path = format!(
        "{}/../spec/vectors/markdown.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let vs: Vec<Json> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let (mut headings, mut links) = (0, 0);
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
        } else {
            let rules: Vec<(String, String)> = input["rules"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| (r[0].as_str().unwrap().into(), r[1].as_str().unwrap().into()))
                .collect();
            let want = v["expected"]["href"].as_str().map(String::from);
            assert_eq!(
                rewrite(&rules, input["href"].as_str().unwrap()),
                want,
                "{name}"
            );
            links += 1;
        }
    }
    assert_eq!((headings, links), (8, 10));
}
