//! aven-peer-wire against Lean's vectors (README rule 10): every expected value here comes from `peer/spec`, written by
//! `lake exe vectors`; this file writes none of its own.

use std::path::PathBuf;

use aven_peer_wire::presence::Presence;
use aven_peer_wire::wire::{self, Decoder, Frame, Greeting, Incoming, WireError, encode};
use serde_json::{Value, json};

fn vectors(file: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../spec/vectors")
        .join(file);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

#[test]
fn presence_follows_the_vectors() {
    for v in vectors("presence.json") {
        let mut p = Presence::default();
        let told: Vec<Value> = v["input"]["changes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                let peer = c[1].as_u64().unwrap();
                match c[0].as_str().unwrap() {
                    "join" => p.join(peer),
                    "leave" => p.leave(&peer),
                    other => panic!("unknown change {other}"),
                }
                json!(p.present().collect::<Vec<_>>())
            })
            .collect();
        assert_eq!(json!(told), v["expected"], "{}", v["name"]);
        assert_eq!(
            p.count(),
            v["expected"]
                .as_array()
                .unwrap()
                .last()
                .map_or(0, |l| l.as_array().unwrap().len())
        );
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap())
        .collect()
}

/// A frame in the vectors' readable form (`Vectors.lean`'s `Frame.json`): a line's bytes in hex.
fn hexes(hs: &[Vec<u8>]) -> Vec<String> {
    hs.iter().map(|h| hex(h)).collect()
}

fn frame_json(f: &Frame) -> Value {
    match f {
        Frame::Presence { peers } => json!({ "frame": "presence", "peers": peers }),
        Frame::Beat { n } => json!({ "frame": "beat", "n": n }),
        Frame::Claim { statement } => json!({ "frame": "claim", "statement": statement }),
        Frame::SignIn { statement } => json!({ "frame": "sign_in", "statement": statement }),
        Frame::Invite { statement } => json!({ "frame": "invite", "statement": statement }),
        Frame::Withdraw { statement } => json!({ "frame": "withdraw", "statement": statement }),
        Frame::Join { statement } => json!({ "frame": "join", "statement": statement }),
        Frame::Network {
            claimed,
            tree,
            statements,
        } => {
            json!({ "frame": "network", "claimed": claimed, "tree": tree, "statements": statements })
        }
        Frame::Refused { why } => json!({ "frame": "refused", "why": why }),
        Frame::Heads { heads, more } => json!({ "frame": "heads", "heads": heads, "more": more }),
        Frame::CatchUp { holds, only } => {
            json!({ "frame": "catch_up", "have": holds, "only": only })
        }
        Frame::Lines { lines } => {
            json!({ "frame": "lines", "lines": lines.iter().map(|l| hex(l)).collect::<Vec<_>>() })
        }
        Frame::Kept { files } => json!({ "frame": "kept", "files": files }),
        Frame::Prove { doc, key, sig } => {
            json!({ "frame": "prove", "doc": hex(doc), "key": hex(key), "sig": hex(sig) })
        }
        Frame::Proven { doc } => json!({ "frame": "proven", "doc": hex(doc) }),
        Frame::ProveRefused { doc, why } => {
            json!({ "frame": "prove_refused", "doc": hex(doc), "why": why })
        }
        Frame::Fetch { doc, hashes } => {
            json!({ "frame": "fetch", "doc": hex(doc), "hashes": hexes(hashes) })
        }
        Frame::Items {
            doc,
            hash,
            at,
            total,
            bytes,
        } => json!({ "frame": "items", "doc": hex(doc), "hash": hex(hash),
            "at": at, "total": total, "bytes": hex(bytes) }),
        Frame::Missing { doc, hashes } => {
            json!({ "frame": "missing", "doc": hex(doc), "hashes": hexes(hashes) })
        }
        Frame::Fetched { doc, later } => {
            json!({ "frame": "fetched", "doc": hex(doc), "later": hexes(later) })
        }
        Frame::FetchRefused { doc, why } => {
            json!({ "frame": "fetch_refused", "doc": hex(doc), "why": why })
        }
        Frame::KeepAfter { doc, n } => json!({ "frame": "keep_after", "doc": hex(doc), "n": n }),
        Frame::KeepArrived { doc, entries, more } => {
            json!({ "frame": "keep_arrived", "doc": hex(doc),
            "entries": entries.iter().map(|(n, h)| json!({ "n": n, "hash": hex(h) })).collect::<Vec<_>>(),
            "more": more })
        }
        Frame::KeepPut {
            doc,
            hash,
            at,
            total,
            bytes,
            covers,
        } => json!({ "frame": "keep_put", "doc": hex(doc),
            "hash": hex(hash), "at": at, "total": total, "bytes": hex(bytes), "covers": hexes(covers) }),
        Frame::KeepEnd { doc } => json!({ "frame": "keep_end", "doc": hex(doc) }),
        Frame::KeepTook { doc, numbers } => json!({ "frame": "keep_took", "doc": hex(doc),
            "numbers": numbers.iter().map(|(n, h)| json!({ "n": n, "hash": hex(h) })).collect::<Vec<_>>() }),
        Frame::KeepRefused { doc, why } => {
            json!({ "frame": "keep_refused", "doc": hex(doc), "why": why })
        }
    }
}

/// A stream through the decoder, chunk by chunk (`Aven.Peer.WireCbor.read`): its greeting, the frames each chunk
/// completes, and the error that ends it.
fn read(chunks: &[Vec<u8>]) -> Value {
    let mut d = Decoder::default();
    let (mut greeting, mut frames) = (Value::Null, Vec::new());
    let ended = |greeting: &Value, frames: &Vec<Value>, e: WireError| {
        let e = match e {
            WireError::Bad(_) => "bad",
            WireError::TooLong => "tooLong",
        };
        json!({ "greeting": greeting, "frames": frames, "error": e })
    };
    for c in chunks {
        let mut bytes: &[u8] = c;
        if greeting.is_null() {
            match d.greeting(c) {
                Ok(Some(g)) => greeting = g.json(),
                Ok(None) => {
                    frames.push(json!([]));
                    continue;
                }
                Err(e) => return ended(&greeting, &frames, e),
            }
            bytes = &[];
        }
        match d.frames(bytes) {
            Ok(fs) => frames.push(json!(fs.iter().map(frame_json).collect::<Vec<_>>())),
            Err(e) => return ended(&greeting, &frames, e),
        }
    }
    json!({ "greeting": greeting, "frames": frames, "error": null })
}

fn chunks(v: &Value) -> Vec<Vec<u8>> {
    v["input"]["chunks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| unhex(c.as_str().unwrap()))
        .collect()
}

/// Greetings, read from exactly their keys.
#[test]
fn greetings_follow_the_vectors() {
    let all = vectors("wire.json");
    assert!(all.len() >= 9);
    for v in all {
        let got =
            Greeting::parse(v["input"]["line"].as_str().unwrap()).map_or(Value::Null, |g| g.json());
        assert_eq!(got, v["expected"], "{}", v["name"]);
    }
}

/// Streams: the greeting, then frames in CBOR, and what each refuses.
#[test]
fn frames_follow_the_vectors() {
    let all = vectors("frames.json");
    assert!(all.len() >= 30);
    for v in all {
        assert_eq!(read(&chunks(&v)), v["expected"], "{}", v["name"]);
    }
}

/// Every frame the vectors name encodes to the bytes Lean wrote for it.
#[test]
fn frames_encode_as_the_vectors() {
    for v in vectors("frames.json") {
        let name = v["name"].as_str().unwrap();
        if !name.starts_with("a frame: ") {
            continue;
        }
        let bytes = chunks(&v).concat();
        let hello = Greeting::Hello {
            peer: "alice-peer".into(),
            wire: wire::VERSION,
        }
        .line();
        let mut d = Decoder::default();
        let got = d.push(&bytes).unwrap();
        let Some(Incoming::Frame(frame)) = got.get(1) else {
            panic!("{name}")
        };
        assert_eq!([hello, encode(frame)].concat(), bytes, "{name}");
    }
}

/// A hello of each wire version as this peer meets it: carried on, or refused with `update`; whether the hello's peer
/// follows the refusal; and the gossip topic's name per version (`Aven.Peer.Wire`, "The wire version").
#[test]
fn upgrades_follow_the_vectors() {
    let all = vectors("upgrades.json");
    assert!(all.len() >= 8);
    for v in all {
        let (input, expected) = (&v["input"], &v["expected"]);
        if let Some(network) = input["network"].as_str() {
            let name = wire::topic_name(input["wire"].as_u64().unwrap(), network);
            assert_eq!(json!(name), expected["topic"], "{}", v["name"]);
            continue;
        }
        let (mine, theirs) = (
            input["mine"].as_u64().unwrap(),
            input["theirs"].as_u64().unwrap(),
        );
        assert_eq!(
            wire::meet(mine, theirs).map_or(Value::Null, |g| g.json()),
            expected["answer"],
            "{}",
            v["name"]
        );
        assert_eq!(
            json!(wire::follows(theirs, mine)),
            expected["follows"],
            "{}",
            v["name"]
        );
    }
    // this peer's own version is the model's
    let ours: Vec<_> = vectors("upgrades.json")
        .into_iter()
        .filter(|v| v["name"] == "one version: the connection carries on")
        .collect();
    assert_eq!(ours[0]["input"]["mine"], json!(wire::VERSION));
}

/// However a stream is cut, the same greeting and frames arrive: a property of the decoder over the vectors' streams,
/// not an expected value.
#[test]
fn frames_survive_any_split() {
    for v in vectors("frames.json") {
        if !v["expected"]["error"].is_null() {
            continue;
        }
        let bytes = chunks(&v).concat();
        let whole = read(std::slice::from_ref(&bytes));
        let flat = |r: &Value| {
            r["frames"]
                .as_array()
                .unwrap()
                .iter()
                .flat_map(|f| f.as_array().unwrap().clone())
                .collect::<Vec<_>>()
        };
        for cut in 0..bytes.len().min(400) {
            let got = read(&[bytes[..cut].to_vec(), bytes[cut..].to_vec()]);
            assert_eq!(
                got["greeting"], whole["greeting"],
                "{} cut at {cut}",
                v["name"]
            );
            assert_eq!(flat(&got), flat(&whole), "{} cut at {cut}", v["name"]);
        }
    }
}
