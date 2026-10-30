//! Our one protocol (README, rule 9, `Aven.DB.Wire`), on ALPN `aven/db/1`, as frames: one JSON object per line on one stream each
//! way. Milestone 1 says hello and tells presence, and carries a network's claim and sign-ins (PRODUCTION.md, Part A); the Aven Peer beats once per clock step, so a quiet link still
//! moves, and a link that doesn't is stalled.

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
    /// An Aven Peer that keeps its tree tells each peer whether it is claimed and, to a device of its tree, the tree.
    Network { claimed: bool, tree: Option<String> },
    /// A claim or sign-in the Aven Peer refused, and why.
    Refused { why: String },
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
