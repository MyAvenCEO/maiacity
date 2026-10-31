//! The chat (`Aven.DB.Chat`): one room per network on one iroh-gossip topic, among members only. Every message is
//! signed by the device that sends it, and every peer checks every message itself before it shows it or counts its
//! sender present: the network, a sender the door admits, a signature by exactly that sender over exactly this
//! message, a time after the sender's last, and a line of 1 to [`MAX_TEXT`] bytes. Presence is the senders heard within
//! [`TTL_MS`] that have not said goodbye. The room lives in memory only.
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Here,
    Say,
    Bye,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Here => "here",
            Kind::Say => "say",
            Kind::Bye => "bye",
        }
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
    /// the sender's signature over [`Message::body`], hex
    #[serde(default)]
    pub sig: String,
}

impl Message {
    /// What its sender signs: every field, the line last.
    pub fn body(&self) -> String {
        format!(
            "avenDB chat 1\nnetwork {}\nfrom {}\nat {}\nkind {}\n{}",
            self.network,
            self.from,
            self.at,
            self.kind.name(),
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
    /// A `here` or a `bye` with a line.
    NotSaid,
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
    match m.kind {
        Kind::Say if m.text.is_empty() => Err(Refusal::Empty),
        Kind::Say if m.text.len() > MAX_TEXT => Err(Refusal::TooLong),
        Kind::Say => Ok(()),
        _ if m.text.is_empty() => Ok(()),
        _ => Err(Refusal::NotSaid),
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

/// What a peer holds of the room: each sender heard, and the lines said, in the order they came.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Room {
    seen: Vec<Seen>,
    said: Vec<(String, String)>,
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
}
