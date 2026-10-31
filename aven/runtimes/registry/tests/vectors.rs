//! The registry against Lean's vectors (README rule 10 of aven/DB2): every decision in `spec/vectors/registry.json`
//! (the examples, then heads cut and changed at random from them, under random claims), and the table itself in
//! `table.json`, entry by entry and signature by signature.

use aven_runtimes_registry::{
    Claim, Decision, Element, FileType, Mode, Output, REGISTRY, SIGNATURES, Serve, Stage, decide_file, headers,
    of_mime,
};
use serde_json::{Value, json};

fn vectors(file: &str) -> Vec<Value> {
    let path = format!("{}/../spec/vectors/{file}", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    serde_json::from_str(&text).unwrap()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// A mode as the vectors write it (`Mode.json`).
fn mode(m: Mode) -> Value {
    match m {
        Mode::Native(e) => json!({ "native": match e {
            Element::Img => "img",
            Element::Audio => "audio",
            Element::Video => "video",
        } }),
        Mode::Frame => json!("frame"),
        Mode::Runtime(name, out, l) => json!({
            "runtime": name,
            "output": match out {
                Output::Tree => "tree",
                Output::Pixels => "pixels",
                Output::Table => "table",
            },
            "limits": { "fuel": l.fuel, "memory": l.memory, "output": l.output },
        }),
        Mode::Download => json!("download"),
    }
}

/// A decision as the vectors write it (`Decision.json`).
fn decision(d: &Decision) -> Value {
    json!({
        "type": d.r#type.name(),
        "mime": d.r#type.mime(),
        "mode": mode(d.mode),
        "serve": match d.serve {
            Serve::Inline(m) => json!({ "inline": m }),
            Serve::Worker => json!("worker"),
            Serve::Attachment => json!("attachment"),
        },
        "headers": headers(d).iter().map(|(k, v)| json!([k, v])).collect::<Vec<_>>(),
    })
}

#[test]
fn decisions() {
    let vs = vectors("registry.json");
    assert!(vs.len() >= 240, "{} vectors", vs.len());
    for v in vs {
        let name = v["name"].as_str().unwrap();
        let i = &v["input"];
        let claim = Claim {
            r#type: i["claim"]["type"].as_str(),
            name: i["claim"]["name"].as_str(),
        };
        let d = decide_file(
            Stage {
                runtimes: i["runtimes"].as_bool().unwrap(),
            },
            &unhex(i["head"].as_str().unwrap()),
            i["size"].as_u64().unwrap(),
            &claim,
        );
        assert_eq!(decision(&d), v["expected"], "{name}");
    }
}

#[test]
fn table() {
    let vs = vectors("table.json");
    let (entries, sigs): (Vec<_>, Vec<_>) = vs.iter().partition(|v| v.get("mode").is_some());
    let mine: Vec<Value> = REGISTRY
        .iter()
        .map(|e| {
            json!({ "type": e.r#type.name(), "mime": e.r#type.mime(), "mode": mode(e.mode), "bytes": e.bytes,
                "pixels": e.pixels })
        })
        .collect();
    assert_eq!(mine, entries.into_iter().cloned().collect::<Vec<_>>());
    let mine: Vec<Value> = SIGNATURES
        .iter()
        .map(|(t, s)| json!({ "type": t.name(), "signature": s.iter().map(|(o, b)| json!([o, hex(b)])).collect::<Vec<_>>() }))
        .collect();
    assert_eq!(mine, sigs.into_iter().cloned().collect::<Vec<_>>());
}

/// What the Peer records for a file it shares: the type its bytes say, whatever its name claims.
#[test]
fn names_never_decide() {
    let mov = [&[0, 0, 0, 20][..], b"ftypqt  ", &[0, 0, 0, 0], b"qt  "].concat();
    for name in ["IMG_0042.MOV", "clip.mp4", "notes.txt", "page.html"] {
        let d = decide_file(
            Stage { runtimes: false },
            &mov,
            300 << 20,
            &Claim {
                r#type: None,
                name: Some(name),
            },
        );
        assert_eq!(d.r#type.mime(), "video/quicktime", "{name}");
        assert_eq!(d.mode, Mode::Native(Element::Video));
    }
    let html = b"<!doctype html><script>alert(1)</script>";
    let d = decide_file(
        Stage { runtimes: true },
        html,
        41,
        &Claim {
            r#type: Some("image/png"),
            name: Some("a.png"),
        },
    );
    assert_eq!((d.mode, d.serve), (Mode::Download, Serve::Attachment));
}

/// Any bytes, under any claim, get a decision: 20,000 random heads, each also cut at every 97th byte, and none panics
/// or shows a scriptable type inline.
#[test]
fn hostile_heads() {
    let mut s: u64 = 0x9e3779b97f4a7c15;
    let mut next = || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        s
    };
    let seeds: [&[u8]; 6] = [
        b"\x89PNG\r\n\x1a\n",
        b"\xff\xd8\xff",
        b"<svg ",
        b"<?xml",
        b"RIFF",
        b"\0\0\0\x18ftyp",
    ];
    for _ in 0..20_000 {
        let len = (next() % 600) as usize;
        let mut h: Vec<u8> = (0..len).map(|_| next() as u8).collect();
        let seed = seeds[(next() % 6) as usize];
        h.splice(0..0, seed.iter().copied());
        for cut in (0..h.len()).step_by(97) {
            let d = decide_file(
                Stage {
                    runtimes: next() % 2 == 0,
                },
                &h[..cut],
                next() % (1 << 40),
                &Claim::default(),
            );
            if let Serve::Inline(m) = d.serve {
                assert!(
                    !m.contains("html") && !m.contains("xml") && !m.contains("svg"),
                    "{m}"
                );
            }
        }
    }
}

/// A claimed type names its type by its essence, whatever its case and parameters; anything else is unknown (the
/// model's `#guard`s on `FileType.ofMime`).
#[test]
fn claimed_types() {
    for e in REGISTRY {
        assert_eq!(of_mime(e.r#type.mime()), e.r#type);
    }
    assert_eq!(of_mime("Video/QuickTime; codecs=hvc1"), FileType::Mov);
    assert_eq!(of_mime("image/x-icon"), FileType::Unknown);
}
