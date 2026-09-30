//! Speech to text on the Mac, on-device — every recording's words with their times, and nothing of them leaves our
//! devices. Silero VAD finds the speech first, so the model reads only speech, a stretch at a time (at most 30 s:
//! bounded memory, whatever the file's length), and every stretch is one utterance.
//!
//! The model: **Phonon-2** — Fermion Research's English re-training of NVIDIA's Parakeet TDT 0.6B v3, its encoder at
//! five values per weight; here as ONNX (vault/tools/phonon2_onnx.py), 654 MB in int8, read natively ([`tdt`]).
//! English: every recording is read as English.
//!
//! Times: the model emits each token at an encoder frame (80 ms), so a word's start and end are known to about 80 ms.
//! The studio cuts on 30 fps frames; for a cut on a word, that is a frame or so.
//!
//! The model files come from our own vault (the Models story, pinned by their BLAKE3 hashes: vault/app models.rs);
//! this crate only reads them from a folder.

pub mod contract;
pub mod tdt;
pub mod vad;

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde_json::Value;

pub use contract::{RATE, Token, VadParams};

/// What the catalog says made the words.
pub const MODEL: &str = "fermionresearch/phonon-2";
/// The language the words are in.
pub const LANGUAGE: &str = "en-US";
/// A stretch is brought up to this peak (at most ×8) before the model reads it — a quiet lavalier is heard too.
pub const TARGET_PEAK: f32 = 0.7;
pub const MAX_GAIN: f32 = 8.0;

/// Where the model files are: Phonon's folder (nemo128.onnx, encoder-model[.int8].onnx, decoder_joint-model.onnx,
/// vocab.txt) and Silero's silero_vad.onnx.
#[derive(Debug, Clone)]
pub struct Models {
    pub speech: PathBuf,
    pub vad: PathBuf,
}

pub struct Recognizer {
    model: tdt::Tdt,
    vad: vad::Vad,
}

/// A stretch brought up to TARGET_PEAK (never more than MAX_GAIN louder).
pub fn normalized(samples: &[f32]) -> Vec<f32> {
    let peak = samples.iter().fold(0.0_f32, |p, s| p.max(s.abs()));
    let gain = (TARGET_PEAK / peak.max(1e-4)).min(MAX_GAIN);
    samples.iter().map(|s| (s * gain).clamp(-1.0, 1.0)).collect()
}

impl Recognizer {
    /// Load both models (a few seconds; ~1 GB of memory).
    pub fn open(models: &Models) -> Result<Self> {
        Ok(Self { model: tdt::Tdt::open(&models.speech)?, vad: vad::Vad::open(&models.vad)? })
    }

    /// Where there is speech: one probability per 32 ms, then the stretches (in samples).
    pub fn speech(&mut self, samples: &[f32], params: VadParams, progress: &mut dyn FnMut(f64)) -> Result<Vec<(usize, usize)>> {
        self.vad.reset();
        let mut probs = Vec::with_capacity(samples.len() / contract::WINDOW + 1);
        let mut window = [0.0_f32; contract::WINDOW];
        let n = samples.len().div_ceil(contract::WINDOW);
        for (i, chunk) in samples.chunks(contract::WINDOW).enumerate() {
            window[..chunk.len()].copy_from_slice(chunk);
            window[chunk.len()..].fill(0.0);
            probs.push(self.vad.predict(&window)?);
            if i % 2000 == 0 {
                progress(i as f64 / n.max(1) as f64);
            }
        }
        Ok(contract::speech(&probs, samples.len(), params))
    }

    /// The whole recording (16 kHz mono): its transcript in the catalog's contract. `progress` gets the stage and 0…1.
    pub fn transcribe(&mut self, samples: &[f32], progress: &mut dyn FnMut(&str, f64)) -> Result<Value> {
        let stretches = self.speech(samples, VadParams::default(), &mut |p| progress("finding speech", p))?;
        let total: usize = stretches.iter().map(|(a, b)| b - a).sum::<usize>().max(1);
        let mut done = 0;
        let mut out = Vec::with_capacity(stretches.len());
        for (a, b) in &stretches {
            progress("transcribing", done as f64 / total as f64);
            let tokens = self.model.tokens(&normalized(&samples[*a..*b]))?;
            let offset = *a as f64 / RATE as f64;
            out.push((offset, *b as f64 / RATE as f64, contract::words(&tokens, offset)));
            done += b - a;
        }
        progress("transcribing", 1.0);
        Ok(contract::transcript(MODEL, LANGUAGE, &out))
    }
}

/// A 16 kHz mono 16-bit or float WAV (the tests' sound).
pub fn read_wav(path: &Path) -> Result<Vec<f32>> {
    let bytes = std::fs::read(path).with_context(|| path.display().to_string())?;
    anyhow::ensure!(bytes.len() > 44 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE", "not a WAV");
    let (mut i, mut fmt, mut data) = (12, None, None);
    while i + 8 <= bytes.len() {
        let id = &bytes[i..i + 4];
        let len = u32::from_le_bytes(bytes[i + 4..i + 8].try_into()?) as usize;
        let body = &bytes[i + 8..(i + 8 + len).min(bytes.len())];
        match id {
            b"fmt " => fmt = Some((u16::from_le_bytes([body[0], body[1]]), u16::from_le_bytes([body[2], body[3]]), u32::from_le_bytes(body[4..8].try_into()?), u16::from_le_bytes([body[14], body[15]]))),
            b"data" => data = Some(body),
            _ => {}
        }
        i += 8 + len + (len & 1);
    }
    let (format, channels, rate, bits) = fmt.context("no fmt chunk")?;
    anyhow::ensure!(rate as usize == RATE, "the WAV is {rate} Hz, not 16 kHz");
    let data = data.context("no data chunk")?;
    let mono = |frames: Vec<f32>| frames.chunks(channels as usize).map(|c| c.iter().sum::<f32>() / c.len() as f32).collect();
    Ok(match (format, bits) {
        // 65534: WAVE_FORMAT_EXTENSIBLE (what afconvert writes), PCM or float by its bits
        (1 | 65534, 16) => mono(data.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect()),
        (3 | 65534, 32) => mono(data.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()),
        _ => anyhow::bail!("a WAV of format {format}, {bits} bits: only 16-bit PCM or 32-bit float"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quiet_stretch_is_brought_up_not_a_loud_one() {
        let quiet = normalized(&[0.05, -0.05]);
        assert!((quiet[0] - 0.4).abs() < 1e-6, "{quiet:?}"); // ×8 at most
        let loud = normalized(&[0.9, -0.5]);
        assert!((loud[0] - 0.7).abs() < 1e-6);
    }

    /// The real models on a spoken sentence (VAULT_ASR_MODELS: a folder with phonon-2/ and silero_vad.onnx;
    /// VAULT_ASR_WAV: a 16 kHz WAV; VAULT_ASR_EXPECT: words it must contain) — skipped without them. Prints the
    /// real-time factor.
    #[test]
    fn transcribes_a_recording_with_the_real_models() {
        let (Some(dir), Some(wav)) = (std::env::var_os("VAULT_ASR_MODELS"), std::env::var_os("VAULT_ASR_WAV")) else {
            eprintln!("no VAULT_ASR_MODELS / VAULT_ASR_WAV: skipped");
            return;
        };
        let dir = PathBuf::from(dir);
        let models = Models { speech: dir.join("phonon-2"), vad: dir.join("silero_vad.onnx") };
        assert!(tdt::complete(&models.speech));
        let samples = read_wav(Path::new(&wav)).unwrap();
        let started = std::time::Instant::now();
        let mut r = Recognizer::open(&models).unwrap();
        let loaded = started.elapsed().as_secs_f64();
        let t0 = std::time::Instant::now();
        let t = r.transcribe(&samples, &mut |_, _| {}).unwrap();
        let took = t0.elapsed().as_secs_f64();
        let seconds = samples.len() as f64 / RATE as f64;
        println!("loaded in {loaded:.1} s; {seconds:.1} s of sound in {took:.1} s — real-time factor {:.3}", took / seconds);
        println!("{}", serde_json::to_string_pretty(&t).unwrap());
        let text = t["text"].as_str().unwrap().to_lowercase();
        if let Ok(expect) = std::env::var("VAULT_ASR_EXPECT") {
            for w in expect.split_whitespace() {
                assert!(text.contains(&w.to_lowercase()), "“{w}” not in “{text}”");
            }
        }
        let words = t["words"].as_array().unwrap();
        assert!(!words.is_empty());
        assert!(words.windows(2).all(|p| p[1]["s"].as_f64() >= p[0]["s"].as_f64()));
        assert!(words.iter().all(|w| w["e"].as_f64().unwrap() <= seconds + 0.2));
    }
}
