//! Files against Lean's vectors (`db/spec/vectors/files.json`, README rule 10): each chunk's bounds and hash, the
//! index, the file's name, and the chunks each range touches with the bytes read from them alone are the model's.

use std::path::PathBuf;

use aven_gen1::files::{
    self, CHUNK, MAX_BLOB, MAX_FILE, bounds, count, fits, read, split, touches,
};
use serde_json::{Value, json};

fn vectors(file: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../db/spec/vectors")
        .join(file);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap())
        .collect()
}

#[test]
fn files_follow_the_vectors() {
    let all: Vec<Value> = vectors("files.json")
        .into_iter()
        .filter(|v| v["input"].get("chunk").is_some())
        .collect();
    assert!(all.len() >= 60, "{} files", all.len());
    for v in all {
        let input = &v["input"];
        let c = input["chunk"].as_u64().unwrap();
        let bytes = input["bytes"].as_str().map(unhex);
        let n = bytes
            .as_ref()
            .map_or_else(|| input["size"].as_u64().unwrap(), |b| b.len() as u64);
        let ranges: Vec<(u64, u64)> = input["ranges"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| (r[0].as_u64().unwrap(), r[1].as_u64().unwrap()))
            .collect();
        let reads: Vec<Value> = ranges
            .iter()
            .map(|&(a, e)| {
                if a > e || e > n {
                    return json!({ "error": "range" });
                }
                let touched: Vec<u64> = touches(c, a..e).collect();
                match &bytes {
                    Some(b) => {
                        let chunks: Vec<&[u8]> = split(c, b).collect();
                        let got: Vec<&[u8]> = touched.iter().map(|&i| chunks[i as usize]).collect();
                        json!({ "touches": touched, "bytes": hex(&read(c, n, a..e, &got).unwrap()) })
                    }
                    None => json!({ "touches": touched }),
                }
            })
            .collect();
        let mut got = json!({
            "count": count(c, n),
            "bounds": (0..count(c, n)).map(|i| { let r = bounds(c, n, i); json!([r.start, r.end]) }).collect::<Vec<_>>(),
            "reads": reads,
        });
        if let Some(b) = &bytes {
            let chunks: Vec<[u8; 32]> = split(c, b).map(|x| *blake3::hash(x).as_bytes()).collect();
            let index = files::index(chunks.clone());
            assert_eq!(files::hashes(&index).unwrap(), chunks);
            got["chunks"] = json!(chunks.iter().map(|h| hex(h)).collect::<Vec<_>>());
            got["index"] = json!(hex(&index));
            got["file"] = json!(blake3::hash(&index).to_hex().to_string());
        }
        assert_eq!(got, v["expected"], "{}", v["name"]);
    }
}

/// A chunk cut as it must be, and the limits, as Lean says (`Aven.DB.Files.fits`, `maxBlob`, `maxFile`).
#[test]
fn chunks_fit_as_the_vectors_say() {
    let all = vectors("files.json");
    let limits = all
        .iter()
        .find(|v| v["name"] == "limits")
        .expect("the limits");
    assert_eq!(
        json!({ "chunk": CHUNK, "maxBlob": MAX_BLOB, "maxFile": MAX_FILE }),
        limits["expected"]
    );
    let fitting: Vec<&Value> = all
        .iter()
        .filter(|v| v["input"].get("fits").is_some())
        .collect();
    assert!(fitting.len() >= 10);
    for v in fitting {
        let f = &v["input"]["fits"];
        let n = |k: &str| f[k].as_u64().unwrap();
        assert_eq!(
            json!({ "fits": fits(n("chunk"), n("size"), n("i"), n("len")) }),
            v["expected"],
            "{}",
            v["name"]
        );
    }
}
