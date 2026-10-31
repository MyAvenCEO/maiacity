//! Our one protocol (README, rule 9, `Aven.Peer.Wire`, `Aven.Peer.WireCbor`), on ALPN `aven/db/1`, a frozen name: one
//! stream each way. It opens with a [`Greeting`], a JSON line whose form never changes, so a peer of any version reads
//! another's and refuses it with `update` (PEERS.md §7). Every [`Frame`] after it is a Value in Core's one codec
//! (`aven_core`, A29), sent as its canonical encoding behind a 4-byte big-endian length. A peer sends nothing after its
//! hello until the other's has come.
//!
//! Each frame is read from exactly its keys, none missing, none extra and none defaulted (A42), and bytes that aren't
//! the one encoding of a frame are refused. The answers are Lean's (`wire.json`, `frames.json`, `upgrades.json`).
//! Catching up goes in pages that stay under [`MAX_FRAME`] however many devices there are. The Aven Peer beats once
//! per clock step, so a quiet link still moves, and a link that doesn't is stalled.

use aven_core::Value;
use serde::{Deserialize, Serialize};
use serde_json::json;

pub const ALPN: &[u8] = b"aven/db/1";
/// A frame or a greeting longer than this is refused: no peer needs one.
pub const MAX_FRAME: usize = 64 * 1024;
/// The wire version this peer speaks (`Aven.Peer.Wire.wireVersion`): a number of its own, changed only when a frame's
/// meaning changes, never with an ordinary release. 3: the fetch gate's and keepers' frames ([`Frame::Prove`] …
/// [`Frame::KeepRefused`]) beside 2's; 2 was frames in CBOR (A29), 1 frames as JSON lines, 0 the wire before it had
/// versions.
pub const VERSION: u64 = 3;

/// The first line each side sends (`Aven.Peer.Wire.Greeting`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Greeting {
    /// The cast's id of the peer it is, and the wire version it speaks.
    Hello { peer: String, wire: u64 },
    /// The answer to a hello of another wire version, in its place: update, and the version this peer speaks.
    Update { wire: u64 },
}

impl Greeting {
    pub fn json(&self) -> serde_json::Value {
        match self {
            Greeting::Hello { peer, wire } => {
                json!({ "frame": "hello", "peer": peer, "wire": wire })
            }
            Greeting::Update { wire } => json!({ "frame": "update", "wire": wire }),
        }
    }

    /// Its line on the stream, newline included.
    pub fn line(&self) -> Vec<u8> {
        let mut line = self.json().to_string().into_bytes();
        line.push(b'\n');
        line
    }

    /// A greeting read from exactly its keys.
    pub fn parse(line: &str) -> Option<Greeting> {
        let v: serde_json::Value = serde_json::from_str(line).ok()?;
        let o = v.as_object()?;
        match o.get("frame")?.as_str()? {
            "hello" if o.len() == 3 => Some(Greeting::Hello {
                peer: o.get("peer")?.as_str()?.to_string(),
                wire: o.get("wire")?.as_u64()?,
            }),
            "update" if o.len() == 2 => Some(Greeting::Update {
                wire: o.get("wire")?.as_u64()?,
            }),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Frame {
    /// The Aven Peer tells each peer who is connected, itself included, on every change.
    Presence { peers: Vec<String> },
    /// The Aven Peer's clock, once per step.
    Beat { n: u64 },
    /// A browser signs up first, so claims an unclaimed network: the claim's statement as JSON text.
    Claim { statement: String },
    /// A browser signs in with the passkey that claimed the network: the sign-in's statement as JSON text.
    SignIn { statement: String },
    /// The admin invites (MILESTONE2.md): the invite's statement as JSON text.
    Invite { statement: String },
    /// The admin withdraws an open invite.
    Withdraw { statement: String },
    /// A browser joins with an invite.
    Join { statement: String },
    /// An Aven Peer that keeps its tree tells each peer whether it is claimed and, to a device the door admits, the
    /// tree and every statement it holds, so each peer checks the members itself.
    Network {
        claimed: bool,
        tree: Option<String>,
        statements: Option<String>,
    },
    /// A statement the Aven Peer refused, and why.
    Refused { why: String },
    /// The Aven Peer tells a member's peer the head of every chain it keeps (`chain`), once linked, in pages
    /// ([`heads_pages`]): `more` until the last page of one telling.
    Heads { heads: Vec<Head>, more: bool },
    /// A peer asks for every line newer than what it holds of each chain. With `only`, a page ([`catch_up_pages`]):
    /// only the chains it names, from the number it names; without, every chain, one it doesn't name from the first.
    CatchUp { holds: Vec<Have>, only: bool },
    /// Lines as their blobs' bytes, oldest first per chain: the Aven Peer's answer to `CatchUp`, or a peer's own lines
    /// the Aven Peer is missing.
    Lines { lines: Vec<Vec<u8>> },
    /// The Aven Peer tells a peer files of its own chain it holds whole, by their names: each file as it keeps it, to the
    /// links of the device that shared it; and on each link the files of that peer's own chain it has kept, in pages
    /// ([`kept_pages`]). A sender says "Kept by the network" only then.
    Kept { files: Vec<String> },
    /// The fetch gate (`Aven.Peer.Fetch`): a device proves a Doc's fetch key on this connection, signing the Doc and
    /// this connection's TLS exporter (`Aven.ID.KeepCbor.proofSigned`); only to a peer it knows holds the Doc.
    Prove {
        doc: Vec<u8>,
        key: Vec<u8>,
        sig: Vec<u8>,
    },
    /// The Doc is proven on this connection.
    Proven { doc: Vec<u8> },
    /// The proof isn't the Doc's current fetch key on this connection, or the peer doesn't keep the Doc.
    ProveRefused { doc: Vec<u8>, why: String },
    /// A device asks for sealed items of a proven Doc by their hashes, at most `FETCH_HASHES`.
    Fetch { doc: Vec<u8>, hashes: Vec<Vec<u8>> },
    /// A part of a sealed item, at most `PART_BYTES` from offset `at` of its `total`.
    Items {
        doc: Vec<u8>,
        hash: Vec<u8>,
        at: u64,
        total: u64,
        bytes: Vec<u8>,
    },
    /// Hashes asked for that the peer doesn't hold for that Doc.
    Missing { doc: Vec<u8>, hashes: Vec<Vec<u8>> },
    /// The end of an answer to `Fetch`: the hashes held but not sent, to ask for again.
    Fetched { doc: Vec<u8>, later: Vec<Vec<u8>> },
    /// A fetch refused whole: the Doc isn't proven on this connection, or it asked for too many hashes.
    FetchRefused { doc: Vec<u8>, why: String },
    /// A device asks a keeper what came after its number `n` of a Doc (`Aven.Peer.Keeper`).
    KeepAfter { doc: Vec<u8>, n: u64 },
    /// A page of what came after: arrival numbers and sealed hashes, `more` until the last page.
    KeepArrived {
        doc: Vec<u8>,
        entries: Vec<(u64, Vec<u8>)>,
        more: bool,
    },
    /// A part of a sealed item uploaded to a keeper; its first part (`at` 0) names the loose items it covers, every
    /// later part none.
    KeepPut {
        doc: Vec<u8>,
        hash: Vec<u8>,
        at: u64,
        total: u64,
        bytes: Vec<u8>,
        covers: Vec<Vec<u8>>,
    },
    /// The end of an upload: the keeper takes what came since the last, whole, in one write (`Aven.Peer.Serve`).
    KeepEnd { doc: Vec<u8> },
    /// The keeper took the upload: each item's arrival number and hash.
    KeepTook {
        doc: Vec<u8>,
        numbers: Vec<(u64, Vec<u8>)>,
    },
    /// The keeper refused the upload whole, or an ask for a Doc not proven on this connection.
    KeepRefused { doc: Vec<u8>, why: String },
}

/// A device's chain as a peer holds it: the device's key, its newest line's name, and that line's number.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Head {
    pub device: String,
    pub id: String,
    pub seq: u64,
}

/// How far a peer holds a device's chain: the number of its newest line there.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Have {
    pub device: String,
    pub seq: u64,
}

fn text(s: &str) -> Value {
    Value::Text(s.to_string())
}

fn texts(xs: &[String]) -> Value {
    Value::Array(xs.iter().map(|x| text(x)).collect())
}

fn opt(o: &Option<String>) -> Value {
    o.as_deref().map_or(Value::Null, text)
}

fn map(kvs: Vec<(&str, Value)>) -> Value {
    Value::Map(kvs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// A map's entries as a frame reads them: exactly these keys, each once.
struct Fields<'a>(&'a [(String, Value)]);

impl<'a> Fields<'a> {
    fn exactly(kvs: &'a [(String, Value)], keys: &[&str]) -> Option<Self> {
        (kvs.len() == keys.len() && keys.iter().all(|k| kvs.iter().any(|(key, _)| key == k)))
            .then_some(Fields(kvs))
    }

    fn get(&self, k: &str) -> Option<&'a Value> {
        self.0.iter().find(|(key, _)| key == k).map(|(_, v)| v)
    }

    fn text(&self, k: &str) -> Option<String> {
        match self.get(k)? {
            Value::Text(s) => Some(s.clone()),
            _ => None,
        }
    }

    fn nat(&self, k: &str) -> Option<u64> {
        match self.get(k)? {
            Value::Uint(n) => Some(*n),
            _ => None,
        }
    }

    fn bool(&self, k: &str) -> Option<bool> {
        match self.get(k)? {
            Value::Bool(b) => Some(*b),
            _ => None,
        }
    }

    fn opt(&self, k: &str) -> Option<Option<String>> {
        match self.get(k)? {
            Value::Null => Some(None),
            Value::Text(s) => Some(Some(s.clone())),
            _ => None,
        }
    }

    fn bytes(&self, k: &str) -> Option<Vec<u8>> {
        read_bytes(self.get(k)?)
    }

    fn list<T>(&self, k: &str, read: impl Fn(&Value) -> Option<T>) -> Option<Vec<T>> {
        match self.get(k)? {
            Value::Array(xs) => xs.iter().map(read).collect(),
            _ => None,
        }
    }
}

fn bytes(b: &[u8]) -> Value {
    Value::Bytes(b.to_vec())
}

fn hashes(hs: &[Vec<u8>]) -> Value {
    Value::Array(hs.iter().map(|h| bytes(h)).collect())
}

fn read_bytes(v: &Value) -> Option<Vec<u8>> {
    match v {
        Value::Bytes(b) => Some(b.clone()),
        _ => None,
    }
}

/// An arrival as a keeper tells it (`entryValue`): its number and sealed hash.
fn entry(e: &(u64, Vec<u8>)) -> Value {
    map(vec![("n", Value::Uint(e.0)), ("hash", bytes(&e.1))])
}

fn read_entry(v: &Value) -> Option<(u64, Vec<u8>)> {
    let Value::Map(kvs) = v else { return None };
    let f = Fields::exactly(kvs, &["n", "hash"])?;
    Some((f.nat("n")?, f.bytes("hash")?))
}

fn read_text(v: &Value) -> Option<String> {
    match v {
        Value::Text(s) => Some(s.clone()),
        _ => None,
    }
}

impl Head {
    fn value(&self) -> Value {
        map(vec![
            ("id", text(&self.id)),
            ("seq", Value::Uint(self.seq)),
            ("device", text(&self.device)),
        ])
    }

    fn of_value(v: &Value) -> Option<Head> {
        let Value::Map(kvs) = v else { return None };
        let f = Fields::exactly(kvs, &["device", "id", "seq"])?;
        Some(Head {
            device: f.text("device")?,
            id: f.text("id")?,
            seq: f.nat("seq")?,
        })
    }
}

impl Have {
    fn value(&self) -> Value {
        map(vec![
            ("seq", Value::Uint(self.seq)),
            ("device", text(&self.device)),
        ])
    }

    fn of_value(v: &Value) -> Option<Have> {
        let Value::Map(kvs) = v else { return None };
        let f = Fields::exactly(kvs, &["device", "seq"])?;
        Some(Have {
            device: f.text("device")?,
            seq: f.nat("seq")?,
        })
    }
}

impl Frame {
    /// The frame as a Value (`Aven.Peer.WireCbor.frameValue`).
    pub fn value(&self) -> Value {
        let named = |name: &str| ("frame", text(name));
        match self {
            Frame::Presence { peers } => map(vec![named("presence"), ("peers", texts(peers))]),
            Frame::Beat { n } => map(vec![("n", Value::Uint(*n)), named("beat")]),
            Frame::Claim { statement } => map(vec![named("claim"), ("statement", text(statement))]),
            Frame::SignIn { statement } => {
                map(vec![named("sign_in"), ("statement", text(statement))])
            }
            Frame::Invite { statement } => {
                map(vec![named("invite"), ("statement", text(statement))])
            }
            Frame::Withdraw { statement } => {
                map(vec![named("withdraw"), ("statement", text(statement))])
            }
            Frame::Join { statement } => map(vec![named("join"), ("statement", text(statement))]),
            Frame::Network {
                claimed,
                tree,
                statements,
            } => map(vec![
                ("tree", opt(tree)),
                named("network"),
                ("claimed", Value::Bool(*claimed)),
                ("statements", opt(statements)),
            ]),
            Frame::Refused { why } => map(vec![("why", text(why)), named("refused")]),
            Frame::Heads { heads, more } => map(vec![
                ("more", Value::Bool(*more)),
                named("heads"),
                (
                    "heads",
                    Value::Array(heads.iter().map(Head::value).collect()),
                ),
            ]),
            Frame::CatchUp { holds, only } => map(vec![
                (
                    "have",
                    Value::Array(holds.iter().map(Have::value).collect()),
                ),
                ("only", Value::Bool(*only)),
                named("catch_up"),
            ]),
            Frame::Lines { lines } => map(vec![
                named("lines"),
                (
                    "lines",
                    Value::Array(lines.iter().map(|l| Value::Bytes(l.clone())).collect()),
                ),
            ]),
            Frame::Kept { files } => map(vec![("files", texts(files)), named("kept")]),
            Frame::Prove { doc, key, sig } => map(vec![
                ("doc", bytes(doc)),
                ("key", bytes(key)),
                ("sig", bytes(sig)),
                named("prove"),
            ]),
            Frame::Proven { doc } => map(vec![("doc", bytes(doc)), named("proven")]),
            Frame::ProveRefused { doc, why } => map(vec![
                ("doc", bytes(doc)),
                ("why", text(why)),
                named("prove_refused"),
            ]),
            Frame::Fetch { doc, hashes: hs } => map(vec![
                ("doc", bytes(doc)),
                named("fetch"),
                ("hashes", hashes(hs)),
            ]),
            Frame::Items {
                doc,
                hash,
                at,
                total,
                bytes: b,
            } => map(vec![
                ("at", Value::Uint(*at)),
                ("doc", bytes(doc)),
                ("hash", bytes(hash)),
                ("bytes", bytes(b)),
                named("items"),
                ("total", Value::Uint(*total)),
            ]),
            Frame::Missing { doc, hashes: hs } => map(vec![
                ("doc", bytes(doc)),
                named("missing"),
                ("hashes", hashes(hs)),
            ]),
            Frame::Fetched { doc, later } => map(vec![
                ("doc", bytes(doc)),
                named("fetched"),
                ("later", hashes(later)),
            ]),
            Frame::FetchRefused { doc, why } => map(vec![
                ("doc", bytes(doc)),
                ("why", text(why)),
                named("fetch_refused"),
            ]),
            Frame::KeepAfter { doc, n } => map(vec![
                ("n", Value::Uint(*n)),
                ("doc", bytes(doc)),
                named("keep_after"),
            ]),
            Frame::KeepArrived { doc, entries, more } => map(vec![
                ("doc", bytes(doc)),
                ("more", Value::Bool(*more)),
                named("keep_arrived"),
                ("entries", Value::Array(entries.iter().map(entry).collect())),
            ]),
            Frame::KeepPut {
                doc,
                hash,
                at,
                total,
                bytes: b,
                covers,
            } => map(vec![
                ("at", Value::Uint(*at)),
                ("doc", bytes(doc)),
                ("hash", bytes(hash)),
                ("bytes", bytes(b)),
                named("keep_put"),
                ("total", Value::Uint(*total)),
                ("covers", hashes(covers)),
            ]),
            Frame::KeepEnd { doc } => map(vec![("doc", bytes(doc)), named("keep_end")]),
            Frame::KeepTook { doc, numbers } => map(vec![
                ("doc", bytes(doc)),
                named("keep_took"),
                ("numbers", Value::Array(numbers.iter().map(entry).collect())),
            ]),
            Frame::KeepRefused { doc, why } => map(vec![
                ("doc", bytes(doc)),
                ("why", text(why)),
                named("keep_refused"),
            ]),
        }
    }

    /// A frame read from exactly its keys (`Aven.Peer.WireCbor.frameOf`).
    pub fn of_value(v: &Value) -> Option<Frame> {
        let Value::Map(kvs) = v else { return None };
        let name = kvs
            .iter()
            .find(|(k, _)| k == "frame")
            .and_then(|(_, v)| read_text(v))?;
        let with = |keys: &[&str]| Fields::exactly(kvs, keys);
        let statement = || with(&["frame", "statement"])?.text("statement");
        Some(match name.as_str() {
            "presence" => Frame::Presence {
                peers: with(&["frame", "peers"])?.list("peers", read_text)?,
            },
            "beat" => Frame::Beat {
                n: with(&["frame", "n"])?.nat("n")?,
            },
            "claim" => Frame::Claim {
                statement: statement()?,
            },
            "sign_in" => Frame::SignIn {
                statement: statement()?,
            },
            "invite" => Frame::Invite {
                statement: statement()?,
            },
            "withdraw" => Frame::Withdraw {
                statement: statement()?,
            },
            "join" => Frame::Join {
                statement: statement()?,
            },
            "network" => {
                let f = with(&["frame", "claimed", "tree", "statements"])?;
                Frame::Network {
                    claimed: f.bool("claimed")?,
                    tree: f.opt("tree")?,
                    statements: f.opt("statements")?,
                }
            }
            "refused" => Frame::Refused {
                why: with(&["frame", "why"])?.text("why")?,
            },
            "heads" => {
                let f = with(&["frame", "heads", "more"])?;
                Frame::Heads {
                    heads: f.list("heads", Head::of_value)?,
                    more: f.bool("more")?,
                }
            }
            "catch_up" => {
                let f = with(&["frame", "have", "only"])?;
                Frame::CatchUp {
                    holds: f.list("have", Have::of_value)?,
                    only: f.bool("only")?,
                }
            }
            "lines" => Frame::Lines {
                lines: with(&["frame", "lines"])?.list("lines", |v| match v {
                    Value::Bytes(b) => Some(b.clone()),
                    _ => None,
                })?,
            },
            "kept" => Frame::Kept {
                files: with(&["frame", "files"])?.list("files", read_text)?,
            },
            "prove" => {
                let f = with(&["frame", "doc", "key", "sig"])?;
                Frame::Prove {
                    doc: f.bytes("doc")?,
                    key: f.bytes("key")?,
                    sig: f.bytes("sig")?,
                }
            }
            "proven" => Frame::Proven {
                doc: with(&["frame", "doc"])?.bytes("doc")?,
            },
            "prove_refused" => {
                let f = with(&["frame", "doc", "why"])?;
                Frame::ProveRefused {
                    doc: f.bytes("doc")?,
                    why: f.text("why")?,
                }
            }
            "fetch" => {
                let f = with(&["frame", "doc", "hashes"])?;
                Frame::Fetch {
                    doc: f.bytes("doc")?,
                    hashes: f.list("hashes", read_bytes)?,
                }
            }
            "items" => {
                let f = with(&["frame", "doc", "hash", "at", "total", "bytes"])?;
                Frame::Items {
                    doc: f.bytes("doc")?,
                    hash: f.bytes("hash")?,
                    at: f.nat("at")?,
                    total: f.nat("total")?,
                    bytes: f.bytes("bytes")?,
                }
            }
            "missing" => {
                let f = with(&["frame", "doc", "hashes"])?;
                Frame::Missing {
                    doc: f.bytes("doc")?,
                    hashes: f.list("hashes", read_bytes)?,
                }
            }
            "fetched" => {
                let f = with(&["frame", "doc", "later"])?;
                Frame::Fetched {
                    doc: f.bytes("doc")?,
                    later: f.list("later", read_bytes)?,
                }
            }
            "fetch_refused" => {
                let f = with(&["frame", "doc", "why"])?;
                Frame::FetchRefused {
                    doc: f.bytes("doc")?,
                    why: f.text("why")?,
                }
            }
            "keep_after" => {
                let f = with(&["frame", "doc", "n"])?;
                Frame::KeepAfter {
                    doc: f.bytes("doc")?,
                    n: f.nat("n")?,
                }
            }
            "keep_arrived" => {
                let f = with(&["frame", "doc", "entries", "more"])?;
                Frame::KeepArrived {
                    doc: f.bytes("doc")?,
                    entries: f.list("entries", read_entry)?,
                    more: f.bool("more")?,
                }
            }
            "keep_put" => {
                let f = with(&["frame", "doc", "hash", "at", "total", "bytes", "covers"])?;
                Frame::KeepPut {
                    doc: f.bytes("doc")?,
                    hash: f.bytes("hash")?,
                    at: f.nat("at")?,
                    total: f.nat("total")?,
                    bytes: f.bytes("bytes")?,
                    covers: f.list("covers", read_bytes)?,
                }
            }
            "keep_end" => Frame::KeepEnd {
                doc: with(&["frame", "doc"])?.bytes("doc")?,
            },
            "keep_took" => {
                let f = with(&["frame", "doc", "numbers"])?;
                Frame::KeepTook {
                    doc: f.bytes("doc")?,
                    numbers: f.list("numbers", read_entry)?,
                }
            }
            "keep_refused" => {
                let f = with(&["frame", "doc", "why"])?;
                Frame::KeepRefused {
                    doc: f.bytes("doc")?,
                    why: f.text("why")?,
                }
            }
            _ => return None,
        })
    }
}

/// What a peer speaking `mine` answers a hello of version `theirs` with (`Aven.Peer.Wire.meet`): nothing, and the
/// connection carries on; or `update` with its own version, and the connection closes. No fallback (README rule 9).
pub fn meet(mine: u64, theirs: u64) -> Option<Greeting> {
    (theirs != mine).then_some(Greeting::Update { wire: mine })
}

/// Whether a peer speaking `mine`, refused by one speaking `theirs`, updates (`Aven.Peer.Wire.follows`): only when that
/// one is ahead. Of two peers that differ, exactly one follows, and nobody ever goes back.
pub fn follows(mine: u64, theirs: u64) -> bool {
    mine < theirs
}

/// The gossip topic's name for a network on a wire version (`Aven.Peer.Wire.topicName`): a peer on another version is
/// in another room.
pub fn topic_name(wire: u64, network: &str) -> String {
    format!("avenDB chat 1\nwire {wire}\nnetwork {network}")
}

/// The most heads or haves in one frame (`Aven.Peer.Wire.pageSize`): a page of the longest stays well under
/// [`MAX_FRAME`], however many devices there are.
pub const PAGE: usize = 128;

/// One telling of the heads (`Aven.Peer.Wire.headsPages`): pages of at most [`PAGE`], every one but the last with `more`;
/// no heads is one empty page, so a peer always hears the end of a telling.
pub fn heads_pages(heads: Vec<Head>) -> Vec<Frame> {
    if heads.is_empty() {
        return vec![Frame::Heads { heads, more: false }];
    }
    let n = heads.len().div_ceil(PAGE);
    heads
        .chunks(PAGE)
        .enumerate()
        .map(|(i, page)| Frame::Heads {
            heads: page.to_vec(),
            more: i + 1 < n,
        })
        .collect()
}

/// What a peer asks for, in pages of at most [`PAGE`] (`Aven.Peer.Wire.catchUpPages`): each `only` for the chains it
/// names, so the Aven Peer answers each alone, and the answers together are the answer to all of it.
pub fn catch_up_pages(holds: Vec<Have>) -> Vec<Frame> {
    holds
        .chunks(PAGE)
        .map(|page| Frame::CatchUp {
            holds: page.to_vec(),
            only: true,
        })
        .collect()
}

/// Files kept, in pages of at most [`PAGE`] (`Aven.Peer.Wire.keptPages`); none for none.
pub fn kept_pages(files: Vec<String>) -> Vec<Frame> {
    files
        .chunks(PAGE)
        .map(|page| Frame::Kept {
            files: page.to_vec(),
        })
        .collect()
}

/// A frame on the stream (`Aven.Peer.WireCbor.frameBytes`): its encoding's length, 4 bytes big-endian, then the
/// encoding.
pub fn encode(frame: &Frame) -> Vec<u8> {
    let e = aven_core::encode(&frame.value());
    let mut out = (e.len() as u32).to_be_bytes().to_vec();
    out.extend_from_slice(&e);
    out
}

#[derive(Debug, PartialEq, Eq)]
pub enum WireError {
    TooLong,
    Bad(String),
}

/// What a stream gives: its greeting, then frames.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Incoming {
    Greeting(Greeting),
    Frame(Frame),
}

/// Bytes in, the greeting and whole frames out: the reading half of a stream, without I/O (`Aven.Peer.WireCbor.read`).
/// A peer reads the greeting alone first ([`Decoder::greeting`]): what came after it stays buffered until the peer has
/// met its version, so a peer of another version is answered `update` before anything else it sent is read.
#[derive(Default)]
pub struct Decoder {
    buf: Vec<u8>,
    greeted: bool,
}

impl Decoder {
    /// The greeting, once its line is in (`Aven.Peer.WireCbor.greet`); the bytes after it stay buffered for
    /// [`Decoder::frames`].
    pub fn greeting(&mut self, bytes: &[u8]) -> Result<Option<Greeting>, WireError> {
        self.buf.extend_from_slice(bytes);
        let Some(end) = self.buf.iter().position(|&b| b == b'\n') else {
            return if self.buf.len() > MAX_FRAME {
                Err(WireError::TooLong)
            } else {
                Ok(None)
            };
        };
        if end > MAX_FRAME {
            return Err(WireError::TooLong);
        }
        let line: Vec<u8> = self.buf.drain(..=end).collect();
        let greeting = std::str::from_utf8(&line[..end])
            .ok()
            .and_then(Greeting::parse)
            .ok_or_else(|| WireError::Bad("no greeting".into()))?;
        self.greeted = true;
        Ok(Some(greeting))
    }

    /// Every whole frame after the greeting (`Aven.Peer.WireCbor.push`).
    pub fn frames(&mut self, bytes: &[u8]) -> Result<Vec<Frame>, WireError> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        while self.buf.len() >= 4 {
            let n =
                u32::from_be_bytes([self.buf[0], self.buf[1], self.buf[2], self.buf[3]]) as usize;
            if n > MAX_FRAME {
                return Err(WireError::TooLong);
            }
            if n == 0 {
                return Err(WireError::Bad("a frame of no length".into()));
            }
            if self.buf.len() < 4 + n {
                break;
            }
            let frame = aven_core::decode(&self.buf[4..4 + n])
                .as_ref()
                .and_then(Frame::of_value)
                .ok_or_else(|| WireError::Bad("not a frame".into()))?;
            self.buf.drain(..4 + n);
            out.push(frame);
        }
        Ok(out)
    }

    /// The greeting, then frames, as the stream comes.
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Incoming>, WireError> {
        if self.greeted {
            return Ok(self
                .frames(bytes)?
                .into_iter()
                .map(Incoming::Frame)
                .collect());
        }
        let Some(greeting) = self.greeting(bytes)? else {
            return Ok(vec![]);
        };
        let mut out = vec![Incoming::Greeting(greeting)];
        out.extend(self.frames(&[])?.into_iter().map(Incoming::Frame));
        Ok(out)
    }
}
