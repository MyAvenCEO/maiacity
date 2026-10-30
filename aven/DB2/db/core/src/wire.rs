//! Our one protocol (README, rule 9, `Aven.DB.Wire`), on ALPN `aven/db/1`, as frames: one JSON object per line on one stream each
//! way. Milestone 1 says hello and tells presence, and carries a network's claim and sign-ins (PRODUCTION.md, Part A); the Aven Peer beats once per clock step, so a quiet link still
//! moves, and a link that doesn't is stalled.

use serde::{Deserialize, Serialize};

pub const ALPN: &[u8] = b"aven/db/1";
/// A frame longer than this is refused: no peer needs one.
pub const MAX_FRAME: usize = 64 * 1024;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "frame", rename_all = "snake_case")]
pub enum Frame {
    /// The first frame each side sends: the cast's id of the peer it is.
    Hello { peer: String },
    /// The Aven Peer tells each peer who is connected, itself included, on every change.
    Presence { peers: Vec<String> },
    /// The Aven Peer's clock, once per step.
    Beat { n: u64 },
    /// A browser claims an unclaimed network: the claim code and the claim's statement as JSON text. The code is
    /// never written anywhere.
    Claim { code: String, statement: String },
    /// A browser signs in with the passkey that claimed the network: the sign-in's statement as JSON text.
    SignIn { statement: String },
    /// An Aven Peer that keeps its tree tells each peer whether it is claimed and, to a device of its tree, the tree.
    Network { claimed: bool, tree: Option<String> },
    /// A claim or sign-in the Aven Peer refused, and why.
    Refused { why: String },
}

/// Every frame as itself, but a claim's code, which no log or error may carry.
impl std::fmt::Debug for Frame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Frame::Hello { peer } => f.debug_struct("Hello").field("peer", peer).finish(),
            Frame::Presence { peers } => f.debug_struct("Presence").field("peers", peers).finish(),
            Frame::Beat { n } => f.debug_struct("Beat").field("n", n).finish(),
            Frame::Claim { statement, .. } => f
                .debug_struct("Claim")
                .field("code", &"(hidden)")
                .field("statement", statement)
                .finish(),
            Frame::SignIn { statement } => f.debug_struct("SignIn").field("statement", statement).finish(),
            Frame::Network { claimed, tree } => {
                f.debug_struct("Network").field("claimed", claimed).field("tree", tree).finish()
            }
            Frame::Refused { why } => f.debug_struct("Refused").field("why", why).finish(),
        }
    }
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
