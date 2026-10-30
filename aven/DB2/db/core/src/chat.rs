//! The chat (`Aven.DB.Chat`): one room per network on one iroh-gossip topic, among members only. Every message is
//! signed by the device that sends it, and every peer checks every message itself before it shows it or counts its
//! sender present: the network, a sender the door admits, a signature by exactly that sender over exactly this
//! message, a time after the sender's last, and a line of 1 to [`MAX_TEXT`] bytes. Presence is the senders heard within
//! [`TTL_MS`] that have not said goodbye. The room lives in memory only.
//!
//! A member shares a file by announcing it (store/README.md, "How a file travels"): a message of kind `file` carrying
//! an [`Announce`], `{file, size, name, type}`, where `file` is the hash of the file's index. Its hash must be in the
//! store's spelling, and its name and type 1 to [`MAX_NAME`] bytes without a control character, so the body it signs
//! reads back one way only. The room keeps the files announced; the Aven Peer keeps their bytes.
//!
//! The core is pure: the signature check comes in as a function, which the peers give Ed25519 (iroh's keys) and the
//! model takes as sound. On the wire a message is one JSON object, its signature in hex:
//!
//! ```text
//! {"network":"aven","from":"<key>","at":1730000000000,"kind":"say","text":"hi","sig":"…"}
//! ```

use serde::{Deserialize, Serialize};

/// The longest line, in bytes of UTF-8.
pub const MAX_TEXT: usize = 2000;
/// How often each peer says it is here, and how long it counts as present without a word.
pub const EVERY_MS: u64 = 10_000;
pub const TTL_MS: u64 = 30_000;
/// The longest name or type a file is announced with, in bytes of UTF-8.
pub const MAX_NAME: usize = 255;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Here,
    Say,
    Bye,
    File,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Here => "here",
            Kind::Say => "say",
            Kind::Bye => "bye",
            Kind::File => "file",
        }
    }
}

/// A file announced: its index's hash, its size in bytes, and the name and MIME type its sender claims.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Announce {
    pub file: String,
    pub size: u64,
    pub name: String,
    #[serde(rename = "type")]
    pub mime: String,
}

/// 1 to [`MAX_NAME`] bytes, no control character: one line of the body.
fn plain(s: &str) -> bool {
    (1..=MAX_NAME).contains(&s.len()) && s.chars().all(|c| c as u32 >= 32 && c as u32 != 127)
}

impl Announce {
    /// A hash in the store's spelling (64 lowercase hex digits), a name and a type of one line each.
    pub fn valid(&self) -> bool {
        self.file.len() == 64
            && self.file.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
            && plain(&self.name)
            && plain(&self.mime)
    }

    fn body(&self) -> String {
        format!("file {}\nsize {}\nname {}\ntype {}\n", self.file, self.size, self.name, self.mime)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    pub network: String,
    /// the sending device's key
    pub from: String,
    /// its time, in milliseconds since the epoch
    pub at: u64,
    pub kind: Kind,
    #[serde(default)]
    pub text: String,
    /// a `file`'s announcement, and only a `file`'s
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<Announce>,
    /// the sender's signature over [`Message::body`], hex
    #[serde(default)]
    pub sig: String,
}

impl Message {
    /// What its sender signs: every field, the announcement's lines, the line last. A message without an
    /// announcement signs what it signed before announcements were.
    pub fn body(&self) -> String {
        format!(
            "avenDB chat 1\nnetwork {}\nfrom {}\nat {}\nkind {}\n{}{}",
            self.network,
            self.from,
            self.at,
            self.kind.name(),
            self.file.as_ref().map(Announce::body).unwrap_or_default(),
            self.text
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    WrongNetwork,
    /// The door doesn't admit the sender.
    NotMember,
    BadSignature,
    /// Not after the sender's last message.
    Stale,
    Empty,
    TooLong,
    /// A `here`, a `bye` or a `file` with a line, or anything but a `file` with an announcement.
    NotSaid,
    /// A `file` without an announcement, or one whose hash, name or type isn't valid.
    BadFile,
}

impl Refusal {
    pub fn name(self) -> &'static str {
        match self {
            Refusal::WrongNetwork => "wrongNetwork",
            Refusal::NotMember => "notMember",
            Refusal::BadSignature => "badSignature",
            Refusal::Stale => "stale",
            Refusal::Empty => "empty",
            Refusal::TooLong => "tooLong",
            Refusal::NotSaid => "notSaid",
            Refusal::BadFile => "badFile",
        }
    }
}

/// A message on its own: for `network`, from a key the door admits (`member`), signed by it over exactly its body
/// (`verify(key, body, sig)`), its line's size.
pub fn check(
    network: &str,
    member: impl Fn(&str) -> bool,
    verify: impl Fn(&str, &str, &str) -> bool,
    m: &Message,
) -> Result<(), Refusal> {
    if m.network != network {
        return Err(Refusal::WrongNetwork);
    }
    if !member(&m.from) {
        return Err(Refusal::NotMember);
    }
    if !verify(&m.from, &m.body(), &m.sig) {
        return Err(Refusal::BadSignature);
    }
    match (m.kind, &m.file) {
        (Kind::File, None) => Err(Refusal::BadFile),
        (Kind::File, Some(_)) if !m.text.is_empty() => Err(Refusal::NotSaid),
        (Kind::File, Some(a)) if a.valid() => Ok(()),
        (Kind::File, Some(_)) => Err(Refusal::BadFile),
        (_, Some(_)) => Err(Refusal::NotSaid),
        (Kind::Say, None) if m.text.is_empty() => Err(Refusal::Empty),
        (Kind::Say, None) if m.text.len() > MAX_TEXT => Err(Refusal::TooLong),
        (Kind::Say, None) => Ok(()),
        (_, None) if m.text.is_empty() => Ok(()),
        (_, None) => Err(Refusal::NotSaid),
    }
}

/// A sender heard: the time of its last message, when it was heard, and whether it said goodbye.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Seen {
    sender: String,
    last: u64,
    heard: u64,
    gone: bool,
}

/// What a peer holds of the room: each sender heard, and the lines said and the files announced, in the order they
/// came.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Room {
    seen: Vec<Seen>,
    said: Vec<(String, String)>,
    files: Vec<(String, Announce)>,
}

impl Room {
    /// A message as it arrives at `now`: checked, then taken; refused, the room stays as it was. A `bye` takes its
    /// sender out of the room.
    pub fn receive(
        &mut self,
        network: &str,
        member: impl Fn(&str) -> bool,
        verify: impl Fn(&str, &str, &str) -> bool,
        now: u64,
        m: &Message,
    ) -> Result<(), Refusal> {
        check(network, member, verify, m)?;
        if self
            .seen
            .iter()
            .find(|s| s.sender == m.from)
            .is_some_and(|s| m.at <= s.last)
        {
            return Err(Refusal::Stale);
        }
        self.seen.retain(|s| s.sender != m.from);
        self.seen.insert(
            0,
            Seen {
                sender: m.from.clone(),
                last: m.at,
                heard: now,
                gone: m.kind == Kind::Bye,
            },
        );
        if m.kind == Kind::Say {
            self.said.push((m.from.clone(), m.text.clone()));
        }
        if let Some(a) = &m.file {
            self.files.push((m.from.clone(), a.clone()));
        }
        Ok(())
    }

    /// Who is in the room at `now`: each sender heard within [`TTL_MS`] that has not said goodbye, once, in order.
    pub fn present(&self, now: u64) -> Vec<String> {
        let mut out: Vec<String> = self
            .seen
            .iter()
            .filter(|s| !s.gone && now < s.heard + TTL_MS)
            .map(|s| s.sender.clone())
            .collect();
        out.sort();
        out
    }

    /// The lines said, each with its sender, in the order they came.
    pub fn said(&self) -> &[(String, String)] {
        &self.said
    }

    /// The files announced, each with its sender, in the order they came.
    pub fn files(&self) -> &[(String, Announce)] {
        &self.files
    }
}
