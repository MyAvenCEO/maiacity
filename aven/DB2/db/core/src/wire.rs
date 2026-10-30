//! Our one protocol (README, rule 9), on ALPN `aven/db/1`, as frames: one JSON object per line on one stream each
//! way. Milestone 1 says hello and tells presence; the Aven Peer beats once per clock step, so a quiet link still
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_survive_any_split() {
        let frames = [
            Frame::Hello {
                peer: "alice-peer".into(),
            },
            Frame::Presence {
                peers: vec!["a".into()],
            },
            Frame::Beat { n: 7 },
        ];
        let bytes: Vec<u8> = frames.iter().flat_map(encode).collect();
        for cut in 0..bytes.len() {
            let mut d = Decoder::default();
            let mut got = d.push(&bytes[..cut]).unwrap();
            got.extend(d.push(&bytes[cut..]).unwrap());
            assert_eq!(got, frames);
        }
    }

    #[test]
    fn refuses_endless_lines() {
        assert_eq!(
            Decoder::default().push(&vec![b'x'; MAX_FRAME + 1]),
            Err(WireError::TooLong)
        );
    }
}
