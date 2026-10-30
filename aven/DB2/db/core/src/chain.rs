//! The chat's chains (`Aven.DB.Chains`, `store/README.md` "The chat keeps its history"): each device keeps a chain of
//! its own lines, and every peer keeps every chain it hears, the Aven Peer all of them. A [`Line`] is a blob of plain
//! bytes in v1: the network, the device, its sequence number, the hash of its previous line, the time, the signature
//! and its [`Body`], a text or a file, typed so a text is never read as a file. A peer's [`Keeper`] takes each line it
//! hears: known, a fork (kept, not chained, raised), moved (the device's head `chat-<device>` moves forward to it, and
//! to the lines kept earlier that now fit on top), or a gap (kept until the lines before it arrive; a peer catches up
//! for them after [`GAP_WAIT_MS`]). Catching up takes the [`missing`] lines of another peer's chain, oldest first.
//!
//! The core is pure: a line's name (the BLAKE3 of its blob) and the signature check come in from the edge, which
//! stores the blobs and refs.

use std::collections::BTreeMap;

use crate::chat::MAX_TEXT;
use crate::files::Announcement;

mod retract;
pub use retract::{Settled, retracts};

/// The prefix of every chain's ref: `chat-<device>`.
pub const REF: &str = "chat-";
/// How long a gap may stay open before the peer catches up from the Aven Peer for the lines before it, in ms.
pub const GAP_WAIT_MS: u64 = 5000;
/// The longest MIME type a file line claims, in bytes.
pub const MAX_TYPE: usize = 255;

/// What a line says: a text, a file shared in the chat, or a retraction of a line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Body {
    Text(String),
    File(Announcement),
    Retract(Retraction),
    /// A line whose text this peer dropped ([`Keeper::settle`]): never the body of a line heard or written.
    Redacted,
}

/// A delete (`Aven.DB.Chains`, "Deleting a line"): the line it retracts, named by its id, and that line's place, so a
/// peer that never held it keeps its place as a stub.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Retraction {
    pub target: String,
    pub device: String,
    pub seq: u64,
    pub prev: Option<String>,
    pub at: u64,
}

impl Retraction {
    /// The retraction of `line`, named `id`.
    pub fn of(id: &str, line: &Line) -> Retraction {
        Retraction {
            target: id.to_string(),
            device: line.device.clone(),
            seq: line.seq,
            prev: line.prev.clone(),
            at: line.at,
        }
    }
}

impl Body {
    /// As the line's bytes carry it, last: its kind first, the free text (a text, a file's name) last.
    pub fn render(&self) -> String {
        match self {
            Body::Text(t) => format!("text\n{t}"),
            Body::File(f) => format!(
                "file {}\nsize {}\ntype {}\n{}",
                f.file, f.size, f.kind, f.name
            ),
            Body::Retract(r) => format!(
                "retract {}\ndevice {}\nseq {}\nprev {}\nat {}",
                r.target,
                r.device,
                r.seq,
                r.prev.as_deref().unwrap_or("none"),
                r.at
            ),
            Body::Redacted => "redacted".to_string(),
        }
    }

    fn parse(s: &str) -> Option<Body> {
        if let Some(t) = s.strip_prefix("text\n") {
            return Some(Body::Text(t.to_string()));
        }
        if s.starts_with("retract ") {
            let parts: Vec<&str> = s.split('\n').collect();
            let [r, d, q, p, a] = parts[..] else {
                return None;
            };
            let field =
                |s: &str, name: &str| s.strip_prefix(name)?.strip_prefix(' ').map(str::to_string);
            let prev = field(p, "prev")?;
            return Some(Body::Retract(Retraction {
                target: field(r, "retract")?,
                device: field(d, "device")?,
                seq: number(&field(q, "seq")?)?,
                prev: (prev != "none").then_some(prev),
                at: number(&field(a, "at")?)?,
            }));
        }
        let mut parts = s.splitn(4, '\n');
        let mut field = |name: &str| {
            parts
                .next()?
                .strip_prefix(name)?
                .strip_prefix(' ')
                .map(str::to_string)
        };
        let file = field("file")?;
        let size = number(&field("size")?)?;
        let kind = field("type")?;
        let name = parts.next()?.to_string();
        Some(Body::File(Announcement {
            file,
            size,
            name,
            kind,
        }))
    }

    /// A text or a file's name of 1 to [`MAX_TEXT`] bytes, a file's hash and type well formed, and a retraction's
    /// place one: a number from 1, a previous line exactly when it isn't 1, no field empty or breaking the line.
    pub fn check(&self) -> Result<(), Refusal> {
        let words = match self {
            Body::Retract(r) => {
                let field = |f: &str| f.is_empty() || f.contains('\n');
                let bad = field(&r.target)
                    || field(&r.device)
                    || r.seq == 0
                    || (r.seq == 1) != r.prev.is_none()
                    || r.prev.as_deref().is_some_and(field);
                return if bad {
                    Err(Refusal::BadRetract)
                } else {
                    Ok(())
                };
            }
            Body::Redacted => return Err(Refusal::BadRetract),
            Body::Text(t) => t,
            Body::File(f) => {
                let hash = f.file.len() == 64
                    && f.file
                        .bytes()
                        .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
                if !hash || f.kind.is_empty() || f.kind.len() > MAX_TYPE || f.kind.contains('\n') {
                    return Err(Refusal::BadFile);
                }
                if f.size > crate::files::MAX_FILE {
                    return Err(Refusal::BadFile);
                }
                &f.name
            }
        };
        if words.is_empty() {
            return Err(Refusal::Empty);
        }
        if words.len() > MAX_TEXT {
            return Err(Refusal::TooLong);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Line {
    pub network: String,
    /// the writing device's key
    pub device: String,
    /// its place in the device's chain, from 1
    pub seq: u64,
    /// the hash of the line before it, hex
    pub prev: Option<String>,
    /// milliseconds since the epoch
    pub at: u64,
    /// the device's signature over [`Line::signs`], hex
    pub sig: String,
    pub body: Body,
}

impl Line {
    /// What the device signs: every field but the signature, the body last.
    pub fn signs(&self) -> String {
        format!(
            "avenDB line 1\nnetwork {}\ndevice {}\nseq {}\nprev {}\nat {}\n{}",
            self.network,
            self.device,
            self.seq,
            self.prev.as_deref().unwrap_or("none"),
            self.at,
            self.body.render()
        )
    }

    /// The blob: the body with the signature after its `at` line.
    pub fn blob(&self) -> Vec<u8> {
        format!(
            "avenDB line 1\nnetwork {}\ndevice {}\nseq {}\nprev {}\nat {}\nsig {}\n{}",
            self.network,
            self.device,
            self.seq,
            self.prev.as_deref().unwrap_or("none"),
            self.at,
            self.sig,
            self.body.render()
        )
        .into_bytes()
    }

    /// A blob read back, only when its bytes are canonical (`Aven.DB.Chains.read`): exactly what its fields render to,
    /// the device, the previous line and the signature lower-case hex of their length, every number in canonical
    /// decimal. So one signed line has one blob and one name (`Aven.DB.Chains.one_id`); anything else is
    /// [`Refusal::NotCanonical`].
    pub fn parse(blob: &[u8]) -> Result<Line, Refusal> {
        match Line::fields(blob) {
            Some(line) if line.blob() == blob && line.well_formed() => Ok(line),
            _ => Err(Refusal::NotCanonical),
        }
    }

    /// A line this peer kept before lines had to be canonical: read field by field, and whether it is canonical. Only
    /// for what the store already holds (production is never wiped); everything heard goes through [`Line::parse`].
    pub fn read_kept(blob: &[u8]) -> Option<(Line, bool)> {
        let line = Line::fields(blob)?;
        let canonical = line.blob() == blob && line.well_formed();
        Some((line, canonical))
    }

    fn well_formed(&self) -> bool {
        !self.network.contains('\n')
            && lower_hex(&self.device, 64)
            && self.prev.as_deref().is_none_or(|p| lower_hex(p, 64))
            && lower_hex(&self.sig, 128)
            && match &self.body {
                Body::Retract(r) => {
                    lower_hex(&r.target, 64)
                        && lower_hex(&r.device, 64)
                        && r.prev.as_deref().is_none_or(|p| lower_hex(p, 64))
                }
                Body::Redacted => false,
                Body::Text(_) | Body::File(_) => true,
            }
    }

    /// Field by field, lenient: `parse` takes it only when it renders back to the same bytes.
    fn fields(blob: &[u8]) -> Option<Line> {
        let text = std::str::from_utf8(blob).ok()?;
        let mut parts = text.splitn(8, '\n');
        let mut field = |name: &str| -> Option<String> {
            parts
                .next()?
                .strip_prefix(name)?
                .strip_prefix(' ')
                .map(str::to_string)
        };
        if field("avenDB line")? != "1" {
            return None;
        }
        let network = field("network")?;
        let device = field("device")?;
        let seq = number(&field("seq")?)?;
        let prev = match field("prev")? {
            p if p == "none" => None,
            p => Some(p),
        };
        let at = number(&field("at")?)?;
        let sig = field("sig")?;
        let body = Body::parse(parts.next()?)?;
        Some(Line {
            network,
            device,
            seq,
            prev,
            at,
            sig,
            body,
        })
    }
}

/// One or more decimal digits that fit a `u64`; `parse` alone would also take a sign.
fn number(s: &str) -> Option<u64> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// Exactly `n` lower-case hex digits.
fn lower_hex(s: &str, n: usize) -> bool {
    s.len() == n && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    WrongNetwork,
    /// The door doesn't admit the device.
    NotMember,
    BadSignature,
    Empty,
    TooLong,
    /// Not 1 for a first line, or 1 for a line with a previous one.
    BadSeq,
    /// A file line whose hash isn't one, whose type is empty, too long or breaks the line, or whose size is past
    /// [`crate::files::MAX_FILE`].
    BadFile,
    /// A blob that isn't exactly the bytes its line renders to ([`Line::parse`]).
    NotCanonical,
    /// A retraction whose line or place isn't one, or a body only a peer's own record holds ([`Body::Redacted`]).
    BadRetract,
}

impl Refusal {
    pub fn name(self) -> &'static str {
        match self {
            Refusal::WrongNetwork => "wrongNetwork",
            Refusal::NotMember => "notMember",
            Refusal::BadSignature => "badSignature",
            Refusal::Empty => "empty",
            Refusal::TooLong => "tooLong",
            Refusal::BadSeq => "badSeq",
            Refusal::BadFile => "badFile",
            Refusal::NotCanonical => "notCanonical",
            Refusal::BadRetract => "badRetract",
        }
    }
}

/// A line on its own: for `network`, from a device the door admits, signed by it over exactly what it signs
/// (`verify(key, signs, sig)`), its body well formed, and a number that starts at 1 exactly when there is no previous
/// line.
pub fn check(
    network: &str,
    member: &impl Fn(&str) -> bool,
    verify: &impl Fn(&str, &str, &str) -> bool,
    l: &Line,
) -> Result<(), Refusal> {
    if l.network != network {
        return Err(Refusal::WrongNetwork);
    }
    if !member(&l.device) {
        return Err(Refusal::NotMember);
    }
    if !verify(&l.device, &l.signs(), &l.sig) {
        return Err(Refusal::BadSignature);
    }
    l.body.check()?;
    if l.seq == 0 || (l.seq == 1) != l.prev.is_none() {
        return Err(Refusal::BadSeq);
    }
    Ok(())
}

/// A line held, with its name: the hash of its blob.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Held {
    pub id: String,
    pub line: Line,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Answer {
    /// The chain moved forward to these lines, oldest first.
    Moved(Vec<String>),
    Known,
    Gap,
    Fork,
    Refused(Refusal),
}

/// Whether `l` goes right on top of `head`.
fn fits(head: Option<&Held>, l: &Line) -> bool {
    match head {
        None => l.prev.is_none() && l.seq == 1,
        Some(h) => l.prev.as_deref() == Some(h.id.as_str()) && l.seq == h.line.seq + 1,
    }
}

/// What a peer keeps: each device's chain, oldest first, its head the ref `chat-<device>`; the lines kept but not
/// chained, newest first; and the forks raised, newest first.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Keeper {
    chains: BTreeMap<String, Vec<Held>>,
    loose: Vec<Held>,
    forks: Vec<String>,
}

impl Keeper {
    /// What a peer kept before it restarted: each device's chain, oldest first, as its store holds it under
    /// `chat-<device>`. Its lines were checked when they arrived.
    pub fn load(chains: impl IntoIterator<Item = (String, Vec<Held>)>) -> Keeper {
        Keeper {
            chains: chains.into_iter().filter(|(_, c)| !c.is_empty()).collect(),
            ..Keeper::default()
        }
    }

    /// The line that would come next on top of `device`'s chain: its number and previous line.
    pub fn next(&self, device: &str) -> (u64, Option<String>) {
        match self.chain(device).last() {
            Some(h) => (h.line.seq + 1, Some(h.id.clone())),
            None => (1, None),
        }
    }

    /// Whether the peer holds the line named `id` of `device`.
    pub fn holds(&self, device: &str, id: &str) -> bool {
        self.held(device).any(|h| h.id == id)
    }

    /// A device's chain, oldest first.
    pub fn chain(&self, device: &str) -> &[Held] {
        self.chains.get(device).map(Vec::as_slice).unwrap_or(&[])
    }

    /// Each device's head, by device: what its `chat-*` refs hold.
    pub fn heads(&self) -> Vec<(String, String)> {
        self.chains
            .iter()
            .filter_map(|(d, c)| c.last().map(|h| (d.clone(), h.id.clone())))
            .collect()
    }

    pub fn loose(&self) -> &[Held] {
        &self.loose
    }

    pub fn forks(&self) -> &[String] {
        &self.forks
    }

    fn held(&self, device: &str) -> impl Iterator<Item = &Held> {
        self.chain(device)
            .iter()
            .chain(self.loose.iter().filter(move |h| h.line.device == device))
    }

    /// A line as it arrives, named `id`, and what the peer keeps after it. Refused, nothing changes.
    pub fn receive(
        &mut self,
        network: &str,
        member: impl Fn(&str) -> bool,
        verify: impl Fn(&str, &str, &str) -> bool,
        id: String,
        line: Line,
    ) -> Answer {
        if let Err(why) = check(network, &member, &verify, &line) {
            return Answer::Refused(why);
        }
        let device = line.device.clone();
        if self.held(&device).any(|h| h.id == id) {
            return Answer::Known;
        }
        if self.held(&device).any(|h| h.line.seq == line.seq) {
            self.forks.insert(0, id.clone());
            self.loose.insert(0, Held { id, line });
            return Answer::Fork;
        }
        if !fits(self.chain(&device).last(), &line) {
            self.loose.insert(0, Held { id, line });
            return Answer::Gap;
        }
        let mut moved = vec![id.clone()];
        let chain = self.chains.entry(device.clone()).or_default();
        chain.push(Held { id, line });
        // the lines kept earlier that now fit on top, one after another: each takes one (README, rule 3)
        while let Some(at) = self.loose.iter().position(|m| {
            m.line.device == device && fits(chain.last(), &m.line) && !self.forks.contains(&m.id)
        }) {
            let m = self.loose.remove(at);
            moved.push(m.id.clone());
            chain.push(m);
        }
        Answer::Moved(moved)
    }

    /// The lines a chat shows: every line held but the forks and the retractions, ordered by time, then device.
    pub fn shown(&self) -> Vec<&Held> {
        let mut all: Vec<&Held> = self
            .live()
            .filter(|h| !matches!(h.line.body, Body::Retract(_)))
            .collect();
        all.sort_by(|a, b| {
            (a.line.at, &a.line.device, a.line.seq, &a.id).cmp(&(
                b.line.at,
                &b.line.device,
                b.line.seq,
                &b.id,
            ))
        });
        all
    }
}

/// The lines of `src` (a chain, oldest first) newer than the head of `dst`: walking `src` back from its head to what
/// `dst` holds. Oldest first, as they are taken.
pub fn missing<'a>(src: &'a [Held], dst: &[Held]) -> Vec<&'a Held> {
    let have = dst.last().map_or(0, |h| h.line.seq);
    src.iter().filter(|h| h.line.seq > have).collect()
}
