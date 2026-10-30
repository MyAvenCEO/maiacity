//! Our one protocol (README, rule 9, `Aven.DB.Wire`), on ALPN `aven/db/1`, as frames: one JSON object per line on one
//! stream each way. Milestone 1 says hello and tells presence, and carries a network's claim and sign-ins
//! (PRODUCTION.md, Part A); milestone 2 its invites, withdrawals and joins; the store upgrade catching up on the chat's
//! chains (`Heads`, `CatchUp`, `Lines`), each in pages that stay under the frame's limit however many devices there are. The Aven Peer beats once per clock step, so a quiet link still moves, and a
//! link that doesn't is stalled.

use serde::{Deserialize, Serialize};

pub const ALPN: &[u8] = b"aven/db/1";
/// A frame longer than this is refused: no peer needs one.
pub const MAX_FRAME: usize = 64 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "frame", rename_all = "snake_case")]
pub enum Frame {
    /// The first frame each side sends: the cast's id of the peer it is.
    Hello { peer: String },
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
    /// tree and every statement it holds, so each peer checks the members itself. `statements` absent reads as none.
    Network {
        claimed: bool,
        tree: Option<String>,
        #[serde(default)]
        statements: Option<String>,
    },
    /// A statement the Aven Peer refused, and why.
    Refused { why: String },
    /// The Aven Peer tells a member's peer the head of every chain it keeps (`chain`), once linked, in pages
    /// ([`heads_pages`]): `more` until the last page of one telling.
    Heads {
        heads: Vec<Head>,
        #[serde(default)]
        more: bool,
    },
    /// A peer asks for every line newer than what it holds of each chain. With `only`, a page ([`catch_up_pages`]):
    /// only the chains it names, from the number it names; without, every chain, one it doesn't name from the first.
    CatchUp {
        #[serde(rename = "have")]
        holds: Vec<Have>,
        #[serde(default)]
        only: bool,
    },
    /// Lines as their blobs, oldest first per chain: the Aven Peer's answer to `CatchUp`, or a peer's own lines the
    /// Aven Peer is missing.
    Lines { lines: Vec<String> },
    /// The Aven Peer tells a peer files it holds whole, by their names: each file as it keeps it, to every link; and on
    /// each link the files of that peer's own chain it has kept, in pages ([`kept_pages`]). A sender says "Kept by the
    /// network" only then.
    Kept { files: Vec<String> },
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

/// The most heads or haves in one frame (`Aven.DB.Wire.pageSize`): a page of the longest stays well under
/// [`MAX_FRAME`], however many devices there are.
pub const PAGE: usize = 128;

/// One telling of the heads (`Aven.DB.Wire.headsPages`): pages of at most [`PAGE`], every one but the last with `more`;
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

/// What a peer asks for, in pages of at most [`PAGE`] (`Aven.DB.Wire.catchUpPages`): each `only` for the chains it
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

/// Files kept, in pages of at most [`PAGE`] (`Aven.DB.Wire.keptPages`); none for none.
pub fn kept_pages(files: Vec<String>) -> Vec<Frame> {
    files
        .chunks(PAGE)
        .map(|page| Frame::Kept {
            files: page.to_vec(),
        })
        .collect()
}

pub fn encode(frame: &Frame) -> Vec<u8> {
    let mut line = serde_json::to_vec(frame).expect("frames always encode");
    line.push(b'\n');
    line
}

#[derive(Debug, PartialEq, Eq)]
pub enum WireError {
    TooLong,
    Bad(String),
}

/// Bytes in, whole frames out: the reading half of a stream, without I/O.
#[derive(Default)]
pub struct Decoder {
    buf: Vec<u8>,
}

impl Decoder {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Frame>, WireError> {
        self.buf.extend_from_slice(bytes);
        let mut frames = Vec::new();
        while let Some(end) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=end).collect();
            frames.push(
                serde_json::from_slice(&line[..end]).map_err(|e| WireError::Bad(e.to_string()))?,
            );
        }
        if self.buf.len() > MAX_FRAME {
            return Err(WireError::TooLong);
        }
        Ok(frames)
    }
}
