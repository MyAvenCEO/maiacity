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

/// The prefix of every chain's ref: `chat-<device>`.
pub const REF: &str = "chat-";
/// How long a gap may stay open before the peer catches up from the Aven Peer for the lines before it, in ms.
pub const GAP_WAIT_MS: u64 = 5000;
/// The longest MIME type a file line claims, in bytes.
pub const MAX_TYPE: usize = 255;

/// What a line says: a text, or a file shared in the chat.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Body {
    Text(String),
    File(Announcement),
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
        }
    }

    fn parse(s: &str) -> Result<Body, String> {
        if let Some(t) = s.strip_prefix("text\n") {
            return Ok(Body::Text(t.to_string()));
        }
        let mut parts = s.splitn(4, '\n');
        let mut field = |name: &str| {
            parts
                .next()
                .and_then(|p| p.strip_prefix(name))
                .and_then(|v| v.strip_prefix(' '))
                .map(str::to_string)
                .ok_or_else(|| format!("a body without {name}"))
        };
        let file = field("file")?;
        let size = field("size")?
            .parse()
            .map_err(|_| "a bad size".to_string())?;
        let kind = field("type")?;
        let name = parts.next().ok_or("a file without its name")?.to_string();
        Ok(Body::File(Announcement {
            file,
            size,
            name,
            kind,
        }))
    }

    /// A text or a file's name of 1 to [`MAX_TEXT`] bytes, and a file's hash and type well formed.
    pub fn check(&self) -> Result<(), Refusal> {
        let words = match self {
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

    /// A blob read back, or why it is no line.
    pub fn parse(blob: &[u8]) -> Result<Line, String> {
        let text = std::str::from_utf8(blob).map_err(|_| "a line is UTF-8".to_string())?;
        let mut parts = text.splitn(8, '\n');
        let mut field = |name: &str| -> Result<String, String> {
            let part = parts.next().ok_or_else(|| format!("no {name}"))?;
            part.strip_prefix(name)
                .and_then(|v| v.strip_prefix(' '))
                .map(str::to_string)
                .ok_or_else(|| format!("no {name}"))
        };
        if field("avenDB line")? != "1" {
            return Err("not a line of version 1".into());
        }
        let network = field("network")?;
        let device = field("device")?;
        let seq = field("seq")?.parse().map_err(|_| "a bad seq".to_string())?;
        let prev = match field("prev")? {
            p if p == "none" => None,
            p => Some(p),
        };
        let at = field("at")?.parse().map_err(|_| "a bad at".to_string())?;
        let sig = field("sig")?;
        let body = Body::parse(parts.next().ok_or("no body")?)?;
        Ok(Line {
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
        }
    }
}

/// A line on its own: for `network`, from a device the door admits, signed by it over exactly what it signs
/// (`verify(key, signs, sig)`), its body well formed, and a number that starts at 1 exactly when there is no previous
/// line.
pub fn check(
    network: &str,
    member: impl Fn(&str) -> bool,
    verify: impl Fn(&str, &str, &str) -> bool,
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
        if let Err(why) = check(network, member, verify, &line) {
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

    /// The lines a chat shows: every line held but the forks, ordered by time, then device.
    pub fn shown(&self) -> Vec<&Held> {
        let mut all: Vec<&Held> = self
            .chains
            .values()
            .flatten()
            .chain(self.loose.iter().filter(|h| !self.forks.contains(&h.id)))
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
