//! The release record (PEERS.md §7, `Aven.ID.Release`): one per release of avenOS, served at `/release.json` and
//! published beside the release (`deploy/release.mjs`). It names the release's version and counter (larger is newer),
//! the wire version it speaks, every file of avenOS's build with its SHA-256 and the build's hash over them
//! ([`os_hash`]), and the SHA-256 of the Peer's binary per platform.
//!
//! [`check`] is what a device does with a record and the files it fetched for it: a Service Worker, through the running
//! Peer-Light, before new code activates; a native Peer before it tells its owner. It stays on what it runs unless the
//! record is newer, refuses one that is malformed, whose build hash isn't its files', that no release signer signed
//! while it wants one, or any of whose files came with other bytes; otherwise the release is ready. The answers are
//! Lean's (`releases.json`). Who signs releases is A15's open question: until it is answered, [`Device::today`] trusts
//! no signer and checks integrity only, and says the release is unsigned.

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

/// What `release.json` says it is.
pub const RECORD: &str = "aven/release/1";

/// A file of avenOS's build: its path from the origin's root, and its bytes' SHA-256, hex.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct File {
    pub path: String,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Release {
    /// avenOS's dated version: `26.10.31`, `26.10.31v2`
    pub version: String,
    /// larger is newer: the release's time in seconds
    pub counter: u64,
    /// the wire version it speaks
    pub wire: u64,
    /// the build's hash as the record states it
    pub os: String,
    /// avenOS's build, `release.json` itself not among them
    pub files: Vec<File>,
    /// the Peer's binary per platform (`linux/amd64`): its SHA-256
    pub peer: Vec<(String, String)>,
}

fn text(v: &Value, key: &str) -> Result<String, String> {
    v[key]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| format!("release.json: no {key}"))
}

fn number(v: &Value, key: &str) -> Result<u64, String> {
    v[key]
        .as_u64()
        .ok_or_else(|| format!("release.json: no {key}"))
}

fn files(v: &Value) -> Result<Vec<File>, String> {
    v.as_array()
        .ok_or("release.json: files are not a list")?
        .iter()
        .map(|f| {
            Ok(File {
                path: text(f, "path")?,
                sha256: text(f, "sha256")?,
            })
        })
        .collect()
}

impl Release {
    /// Reads a release record; one that is not shaped as one is refused here, and one that is but breaks its rules is
    /// refused by [`check`].
    pub fn parse(v: &Value) -> Result<Self, String> {
        if v["record"] != RECORD {
            return Err(format!("release.json: not an {RECORD} record"));
        }
        let peer = v["peer"]
            .as_object()
            .ok_or("release.json: no peer")?
            .iter()
            .map(|(p, h)| {
                h.as_str()
                    .map(|h| (p.clone(), h.to_string()))
                    .ok_or_else(|| format!("release.json: the Peer's hash for {p}"))
            })
            .collect::<Result<_, String>>()?;
        Ok(Release {
            version: text(v, "version")?,
            counter: number(v, "counter")?,
            wire: number(v, "wire")?,
            os: text(v, "os")?,
            files: files(&v["files"])?,
            peer,
        })
    }
}

/// Files as a device lists what it fetched: `[{path, sha256}]`.
pub fn parse_files(v: &Value) -> Result<Vec<File>, String> {
    files(v)
}

fn is_hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The build as `sha256sum` lists it: `<sha256>  <path>` and a newline per file, by path (`Aven.ID.Release.listing`).
pub fn listing(files: &[File]) -> String {
    let mut sorted: Vec<&File> = files.iter().collect();
    sorted.sort_by(|a, b| a.path.cmp(&b.path));
    sorted
        .iter()
        .map(|f| format!("{}  {}\n", f.sha256, f.path))
        .collect()
}

/// avenOS's build as one hash: its listing's SHA-256 (`Aven.ID.Release.osHash`).
pub fn os_hash(files: &[File]) -> String {
    crate::hex::encode(&Sha256::digest(listing(files).as_bytes()))
}

fn distinct<'a>(names: impl Iterator<Item = &'a String>) -> bool {
    let mut seen = std::collections::BTreeSet::new();
    names.into_iter().all(|n| seen.insert(n))
}

fn well_formed(r: &Release) -> bool {
    !r.version.is_empty()
        && !r.files.is_empty()
        && r.files
            .iter()
            .all(|f| f.path.starts_with('/') && is_hash(&f.sha256))
        && distinct(r.files.iter().map(|f| &f.path))
        && r.peer.iter().all(|(p, h)| !p.is_empty() && is_hash(h))
        && distinct(r.peer.iter().map(|(p, _)| p))
}

/// How a device treats a record no release signer signed, while the signers aren't agreed (A15).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unsigned {
    /// it stays on what it runs
    Refuse,
    /// it checks the record's hashes against what it fetched, switches, and says the release is unsigned
    Integrity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Device {
    /// the counter of the release it runs, if it runs one with a record
    pub running: Option<u64>,
    /// the release signers' keys it trusts
    pub signers: Vec<String>,
    pub unsigned: Unsigned,
}

impl Device {
    /// Every device today: no release signer is agreed yet (A15), so it trusts none and checks integrity only.
    pub fn today(running: Option<u64>) -> Self {
        Device {
            running,
            signers: vec![],
            unsigned: Unsigned::Integrity,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Verdict {
    /// nothing newer: the device stays on what it runs
    Stay,
    /// the record or a file is wrong, and why: the device stays, and says so
    Refuse(String),
    /// fetched and checked: the device switches at its next safe point; `signed` by a release signer
    Ready { signed: bool },
}

impl Verdict {
    pub fn json(&self) -> Value {
        match self {
            Verdict::Stay => json!({ "verdict": "stay" }),
            Verdict::Refuse(why) => json!({ "verdict": "refuse", "why": why }),
            Verdict::Ready { signed } => json!({ "verdict": "ready", "signed": signed }),
        }
    }
}

/// What a device does with a record, the keys whose signatures over it verified, and the files it fetched for it
/// (`Aven.ID.Release.check`).
pub fn check(d: &Device, r: &Release, signed_by: &[String], fetched: &[File]) -> Verdict {
    if !well_formed(r) {
        return Verdict::Refuse("malformed".into());
    }
    if r.os != os_hash(&r.files) {
        return Verdict::Refuse("os".into());
    }
    if d.running.is_some_and(|c| r.counter <= c) {
        return Verdict::Stay;
    }
    let signed = signed_by.iter().any(|k| d.signers.contains(k));
    if !signed && d.unsigned == Unsigned::Refuse {
        return Verdict::Refuse("unsigned".into());
    }
    match r.files.iter().find(|f| !fetched.contains(f)) {
        Some(f) => Verdict::Refuse(format!("file {}", f.path)),
        None => Verdict::Ready { signed },
    }
}
