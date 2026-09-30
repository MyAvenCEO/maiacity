//! Parakeet TDT 0.6B v3's graph, driven directly through ONNX Runtime — the ONNX export's layout (istupakov's:
//! `nemo128.onnx` the features, `encoder-model.int8.onnx` or `encoder-model.onnx` the encoder, `decoder_joint-model.onnx`
//! the prediction network and joint, `vocab.txt`). Phonon-2 is this graph with Fermion's English weights
//! (vault/tools/phonon2_onnx.py).
//!
//! Not parakeet-rs's `ParakeetTDT`: it gives no token's probability (a word's `c`), and it times a token's end by the
//! next one. Here: NeMo's own preprocessor, the encoder, then greedy TDT — at each encoder
//! frame the joint says a token (or blank) and how many frames to go on (0–4); a token's log-probability is its
//! log-softmax over the vocabulary.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use ndarray::{Array1, Array2, Array3};
use ort::{session::Session, value::Value};

use crate::contract::Token;

/// What the joint's last outputs mean: frames to go on.
const DURATIONS: [usize; 5] = [0, 1, 2, 3, 4];
/// At most this many tokens at one frame (NeMo's max_symbols).
const MAX_SYMBOLS: usize = 10;
/// The prediction network: 2 LSTM layers of 640.
const LAYERS: usize = 2;
const HIDDEN: usize = 640;

pub struct Tdt {
    features: Session,
    encoder: Session,
    joint: Session,
    /// token id → its text, "▁" as a space (a word's start)
    vocab: Vec<String>,
    blank: usize,
}

fn builder(threads: usize) -> Result<ort::session::builder::SessionBuilder> {
    let err = |e: ort::Error<_>| anyhow::anyhow!(e.to_string());
    Ok(Session::builder()?
        .with_intra_threads(threads)
        .map_err(err)?
        .with_inter_threads(1)
        .map_err(err)?
        .with_intra_op_spinning(false)
        .map_err(err)?
        .with_inter_op_spinning(false)
        .map_err(err)?)
}

fn session_bytes(bytes: &[u8], threads: usize, what: &str) -> Result<Session> {
    builder(threads)?.commit_from_memory(bytes).with_context(|| format!("the speech model cannot be loaded: {what}"))
}

fn session(path: &Path, threads: usize) -> Result<Session> {
    let err = |e: ort::Error<_>| anyhow::anyhow!(e.to_string());
    Session::builder()?
        .with_intra_threads(threads)
        .map_err(err)?
        .with_inter_threads(1)
        .map_err(err)?
        .with_intra_op_spinning(false)
        .map_err(err)?
        .with_inter_op_spinning(false)
        .map_err(err)?
        .commit_from_file(path)
        .with_context(|| format!("the speech model cannot be loaded: {}", path.display()))
}

/// The encoder in the folder: int8 when it is there, else fp32 (its weights beside it, `.data`).
pub fn encoder(dir: &Path) -> Option<PathBuf> {
    ["encoder-model.int8.onnx", "encoder-model.onnx"].iter().map(|f| dir.join(f)).find(|p| p.is_file())
}

/// The folder holds what the recognizer needs?
pub fn complete(dir: &Path) -> bool {
    encoder(dir).is_some() && ["nemo128.onnx", "decoder_joint-model.onnx", "vocab.txt"].iter().all(|f| dir.join(f).is_file())
}

fn vocab_of(text: &str) -> Result<(Vec<String>, usize)> {
    let mut vocab = Vec::new();
    for line in text.lines() {
        let Some((token, id)) = line.rsplit_once(' ') else { continue };
        let id: usize = id.parse().with_context(|| format!("vocab.txt: {line}"))?;
        if vocab.len() <= id {
            vocab.resize(id + 1, String::new());
        }
        vocab[id] = token.replace('▁', " ");
    }
    let blank = vocab.iter().position(|t| t == "<blk>").context("vocab.txt has no <blk>")?;
    Ok((vocab, blank))
}

impl Tdt {
    /// From the models' bytes (the vault's store): nothing on disk.
    pub fn from_bytes(features: &[u8], encoder: &[u8], joint: &[u8], vocab: &str) -> Result<Self> {
        let (vocab, blank) = vocab_of(vocab)?;
        Ok(Self {
            features: session_bytes(features, 1, "nemo128.onnx")?,
            encoder: session_bytes(encoder, 4, "encoder-model.int8.onnx")?,
            joint: session_bytes(joint, 1, "decoder_joint-model.onnx")?,
            vocab,
            blank,
        })
    }

    pub fn open(dir: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(dir.join("vocab.txt")).context("vocab.txt")?;
        let mut vocab = Vec::new();
        for line in text.lines() {
            let Some((token, id)) = line.rsplit_once(' ') else { continue };
            let id: usize = id.parse().with_context(|| format!("vocab.txt: {line}"))?;
            if vocab.len() <= id {
                vocab.resize(id + 1, String::new());
            }
            vocab[id] = token.replace('▁', " ");
        }
        let blank = vocab.iter().position(|t| t == "<blk>").context("vocab.txt has no <blk>")?;
        Ok(Self {
            features: session(&dir.join("nemo128.onnx"), 1)?,
            encoder: session(&encoder(dir).context("no encoder-model.onnx")?, 4)?,
            joint: session(&dir.join("decoder_joint-model.onnx"), 1)?,
            vocab,
            blank,
        })
    }

    /// The tokens of a stretch of speech (16 kHz mono), their frames counted from its start (80 ms each).
    pub fn tokens(&mut self, samples: &[f32]) -> Result<Vec<Token>> {
        if samples.is_empty() {
            return Ok(Vec::new());
        }
        // NeMo's log-mel features, normalised per feature over the stretch
        let wave = Array2::from_shape_vec((1, samples.len()), samples.to_vec())?;
        let out = self.features.run(ort::inputs! {
            "waveforms" => Value::from_array(wave)?,
            "waveforms_lens" => Value::from_array(Array1::from_vec(vec![samples.len() as i64]))?
        })?;
        let (shape, data) = out["features"].try_extract_tensor::<f32>()?;
        let features = Array3::from_shape_vec((shape[0] as usize, shape[1] as usize, shape[2] as usize), data.to_vec())?;
        let (_, len) = out["features_lens"].try_extract_tensor::<i64>()?;
        let len = len[0];
        drop(out);

        let out = self.encoder.run(ort::inputs! {
            "audio_signal" => Value::from_array(features)?,
            "length" => Value::from_array(Array1::from_vec(vec![len]))?
        })?;
        let (shape, data) = out["outputs"].try_extract_tensor::<f32>()?;
        let (dim, frames) = (shape[1] as usize, shape[2] as usize);
        let (_, n) = out["encoded_lengths"].try_extract_tensor::<i64>()?;
        let frames = frames.min(n[0].max(0) as usize);
        // [1, dim, frames] → one row per frame
        let encoded = Array2::from_shape_vec((dim, shape[2] as usize), data.to_vec())?;
        drop(out);

        let vocab_size = self.vocab.len();
        let mut state = (Array3::<f32>::zeros((LAYERS, 1, HIDDEN)), Array3::<f32>::zeros((LAYERS, 1, HIDDEN)));
        let mut last = self.blank as i32;
        let mut tokens = Vec::new();
        let (mut t, mut here) = (0, 0);
        while t < frames {
            let frame = encoded.column(t).to_owned().into_shape_with_order((1, dim, 1))?;
            let out = self.joint.run(ort::inputs! {
                "encoder_outputs" => Value::from_array(frame)?,
                "targets" => Value::from_array(Array2::from_shape_vec((1, 1), vec![last])?)?,
                "target_length" => Value::from_array(Array1::from_vec(vec![1i32]))?,
                "input_states_1" => Value::from_array(state.0.clone())?,
                "input_states_2" => Value::from_array(state.1.clone())?
            })?;
            let (_, logits) = out["outputs"].try_extract_tensor::<f32>()?;
            anyhow::ensure!(logits.len() == vocab_size + DURATIONS.len(), "the joint said {} values, not {}", logits.len(), vocab_size + DURATIONS.len());
            let (words, steps) = logits.split_at(vocab_size);
            let token = argmax(words);
            let duration = DURATIONS[argmax(steps)];
            if token != self.blank {
                let max = words[token];
                let logprob = -words.iter().map(|x| (x - max).exp()).sum::<f32>().ln();
                tokens.push(Token { text: self.vocab[token].clone(), logprob, frame: t });
                // the prediction network has read `last`: its state goes on, and it reads the new token next
                let state_of = |name: &str| -> Result<Array3<f32>> {
                    let (_, s) = out[name].try_extract_tensor::<f32>()?;
                    Ok(Array3::from_shape_vec((LAYERS, 1, HIDDEN), s.to_vec())?)
                };
                state = (state_of("output_states_1")?, state_of("output_states_2")?);
                last = token as i32;
                here += 1;
            }
            if duration > 0 {
                t += duration;
                here = 0;
            } else if token == self.blank || here >= MAX_SYMBOLS {
                t += 1;
                here = 0;
            }
        }
        Ok(tokens)
    }
}

fn argmax(xs: &[f32]) -> usize {
    xs.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).map(|(i, _)| i).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_largest() {
        assert_eq!(argmax(&[0.1, 3.0, -1.0, 2.9]), 1);
        assert_eq!(argmax(&[]), 0);
    }

    #[test]
    fn a_folder_is_complete_with_either_encoder() {
        let dir = std::env::temp_dir().join(format!("vault-asr-tdt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for f in ["nemo128.onnx", "decoder_joint-model.onnx", "vocab.txt"] {
            std::fs::write(dir.join(f), b"").unwrap();
        }
        assert!(!complete(&dir));
        std::fs::write(dir.join("encoder-model.int8.onnx"), b"").unwrap();
        assert!(complete(&dir));
        assert_eq!(encoder(&dir).unwrap().file_name().unwrap(), "encoder-model.int8.onnx");
        std::fs::remove_dir_all(&dir).ok();
    }
}
