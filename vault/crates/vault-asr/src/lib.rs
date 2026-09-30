//! Speech to text on the Mac, on-device — every recording's words with their times, and nothing of them leaves our
//! devices. Silero VAD finds the speech first, so the model reads only speech, a stretch at a time (at most 30 s:
//! bounded memory, whatever the file's length), and every stretch is one utterance. Two models ([`Engine`]):
//!
//! - **Phonon-2** — Fermion Research's English re-training of Parakeet TDT 0.6B v3, its encoder at five values per
//!   weight; here as ONNX (vault/tools/phonon2_onnx.py), 654 MB in int8. English only: German comes out garbled.
//! - **Nemotron 3.5 ASR streaming** — NVIDIA's multilingual streaming model, through parakeet-rs: English or German.
//!   A streaming model says a token a frame or two after its sound: a word's `s` can be late by up to ~0.16 s.
//!
//! The language ([`Recognizer::language`]): English unless told. Phonon reads the first 12 s of speech: what it says
//! in German words is German; what it hears surely ([`PHONON_SURE_ENGLISH`]) otherwise, English. When it is unsure,
//! Nemotron reads them in English and in German, and German is the language only when that pass is the surer and
//! says German words (Nemotron alone took English narration for German, and German it could not follow for English).
//! English is Phonon's to read; German, Nemotron's.
//!
//! Times: every model emits each token at an encoder frame (80 ms), so a word's start and end are known to about 80 ms.
//! The studio cuts on 30 fps frames; for a cut on a word, that is a frame or so.
//!
//! The model files come from our own vault (the Models story, pinned by their BLAKE3 hashes: vault/app models.rs);
//! this crate only reads them from a folder.

pub mod contract;
pub mod tdt;
pub mod vad;

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use parakeet_rs::{ExecutionConfig, Nemotron, NemotronMode};
use serde_json::Value;

pub use contract::{RATE, Token, VadParams};

/// Which model makes the words.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Engine {
    #[default]
    Phonon,
    Nemotron,
}

impl Engine {
    pub const ALL: [Engine; 2] = [Engine::Phonon, Engine::Nemotron];

    /// Its name in the settings, and its folder under `<vault>/models/`.
    pub fn id(self) -> &'static str {
        match self {
            Engine::Phonon => "phonon-2",
            Engine::Nemotron => "nemotron-3.5-asr-streaming-0.6b",
        }
    }

    pub fn from_id(id: &str) -> Option<Engine> {
        Engine::ALL.into_iter().find(|e| e.id() == id)
    }

    /// What the catalog says made the words.
    pub fn model(self) -> &'static str {
        match self {
            Engine::Phonon => "fermionresearch/phonon-2",
            Engine::Nemotron => "nvidia/nemotron-3.5-asr-streaming-0.6b",
        }
    }

    /// Does it hear German? (Phonon does not: it reads everything as English.)
    pub fn multilingual(self) -> bool {
        self != Engine::Phonon
    }

    /// The files its folder must hold.
    pub fn complete(self, dir: &Path) -> bool {
        match self {
            Engine::Nemotron => ["config.json", "encoder.onnx", "encoder.onnx.data", "decoder_joint.onnx", "tokenizer.model"].iter().all(|f| dir.join(f).is_file()),
            _ => tdt::complete(dir),
        }
    }
}

/// Our recordings' languages, as Nemotron names them — English first: Phonon's one, and the one when unsure.
pub const LANGUAGES: [&str; 2] = ["en-US", "de-DE"];
/// Phonon hears English at least this surely (the mean log-probability of its word tokens over the first seconds of
/// speech); below it Nemotron tells the language. Measured with examples/bench.rs: our English recordings −0.005 to
/// −0.048; German it could not follow −0.35 to −0.55 (as English-like syllables); clear German it heard as German.
pub const PHONON_SURE_ENGLISH: f64 = -0.10;

/// A language tag as the catalog keeps it on a file ("en", "de") → its locale.
pub fn locale(tag: &str) -> Option<&'static str> {
    LANGUAGES.into_iter().find(|l| l.split('-').next() == Some(tag))
}
/// Seconds of speech the language is told from.
pub const TRIAL_SECONDS: f64 = 12.0;
/// A stretch is brought up to this peak (at most ×8) before the model reads it — a quiet lavalier is heard too.
pub const TARGET_PEAK: f32 = 0.7;
pub const MAX_GAIN: f32 = 8.0;
/// Silence Nemotron reads before a stretch (one streaming chunk, 0.56 s, a whole number of 80 ms frames) and after
/// it (three).
pub const LEAD: usize = 8_960;
pub const TAIL: usize = 3 * 8_960;

/// Where the model files are: the chosen model's folder (Nemotron: config.json, encoder.onnx, encoder.onnx.data,
/// decoder_joint.onnx, tokenizer.model; Phonon: nemo128.onnx, encoder-model[.int8].onnx, decoder_joint-model.onnx,
/// vocab.txt) and Silero's silero_vad.onnx.
#[derive(Debug, Clone)]
pub struct Models {
    pub engine: Engine,
    pub speech: PathBuf,
    pub vad: PathBuf,
}

enum Asr {
    Nemotron(Nemotron),
    Tdt(tdt::Tdt),
}

pub struct Recognizer {
    engine: Engine,
    model: Asr,
    vad: vad::Vad,
}

/// A stretch brought up to TARGET_PEAK (never more than MAX_GAIN louder).
pub fn normalized(samples: &[f32]) -> Vec<f32> {
    let peak = samples.iter().fold(0.0_f32, |p, s| p.max(s.abs()));
    let gain = (TARGET_PEAK / peak.max(1e-4)).min(MAX_GAIN);
    samples.iter().map(|s| (s * gain).clamp(-1.0, 1.0)).collect()
}

impl Recognizer {
    /// Load both models (a few seconds; Nemotron takes ~2.5 GB of memory, Phonon in int8 ~1 GB).
    pub fn open(models: &Models) -> Result<Self> {
        let model = match models.engine {
            Engine::Nemotron => {
                let execution = ExecutionConfig::default().with_custom_configure(|b| Ok(b.with_intra_op_spinning(false)?.with_inter_op_spinning(false)?));
                let model = Nemotron::from_pretrained(&models.speech, Some(execution)).map_err(|e| anyhow::anyhow!("the speech model cannot be loaded: {e}"))?;
                anyhow::ensure!(model.mode() == NemotronMode::Multilingual, "the multilingual Nemotron model is required");
                Asr::Nemotron(model)
            }
            Engine::Phonon => Asr::Tdt(tdt::Tdt::open(&models.speech)?),
        };
        let vad = vad::Vad::open(&models.vad)?;
        Ok(Self { engine: models.engine, model, vad })
    }

    pub fn engine(&self) -> Engine {
        self.engine
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

    /// The model's tokens for a stretch (its frames counted from the stretch's start). A TDT model reads the stretch
    /// whole. A streaming model hears a stretch's first sounds only with some sound before them, and says its last
    /// words only once more sound follows: the stretch is read with silence around it (LEAD before, TAIL after), and
    /// its frames counted from its own start.
    fn tokens(&mut self, samples: &[f32]) -> Result<Vec<Token>> {
        match &mut self.model {
            Asr::Tdt(model) => model.tokens(&normalized(samples)),
            Asr::Nemotron(model) => {
                let mut padded = vec![0.0_f32; LEAD];
                padded.extend(normalized(samples));
                padded.extend(std::iter::repeat_n(0.0, TAIL));
                let out = model.transcribe_audio_with_tokens(&padded).map_err(|e| anyhow::anyhow!("speech recognition failed: {e}"))?;
                let lead = LEAD / (RATE as f64 * contract::FRAME_SECONDS) as usize;
                Ok(out.into_iter().map(|t| Token { text: t.text, logprob: t.logprob, frame: t.local_frame.saturating_sub(lead) }).collect())
            }
        }
    }

    /// The first TRIAL_SECONDS of speech.
    fn trial(samples: &[f32], stretches: &[(usize, usize)]) -> Vec<f32> {
        let mut trial = Vec::new();
        for (a, b) in stretches {
            trial.extend_from_slice(&samples[*a..*b]);
            if trial.len() as f64 >= TRIAL_SECONDS * RATE as f64 {
                break;
            }
        }
        trial
    }

    /// How surely the model hears the first TRIAL_SECONDS of speech (the mean log-probability of its word tokens) —
    /// for comparing models (examples/bench.rs).
    pub fn sureness(&mut self, samples: &[f32], stretches: &[(usize, usize)]) -> Result<f64> {
        let trial = Self::trial(samples, stretches);
        if trial.is_empty() {
            return Ok(0.0);
        }
        Ok(contract::sureness(&self.tokens(&trial)?))
    }

    /// The language of the first TRIAL_SECONDS of speech: `Some` locale when this model can tell, `None` when Phonon is
    /// unsure (Nemotron tells then). Phonon: German when it says German words, English when it hears surely. Nemotron:
    /// the surer of an English and a German pass — German only when that pass says German words.
    pub fn language(&mut self, samples: &[f32], stretches: &[(usize, usize)]) -> Result<Option<&'static str>> {
        let trial = Self::trial(samples, stretches);
        if trial.is_empty() {
            return Ok(Some(LANGUAGES[0]));
        }
        if let Asr::Tdt(_) = self.model {
            let tokens = self.tokens(&trial)?;
            return Ok(if contract::looks_german(&contract::text(&tokens)) {
                Some(LANGUAGES[1])
            } else if contract::sureness(&tokens) >= PHONON_SURE_ENGLISH {
                Some(LANGUAGES[0])
            } else {
                None
            });
        }
        let mut trials = Vec::new();
        for lang in LANGUAGES {
            self.set_language(lang)?;
            trials.push((lang, self.tokens(&trial)?));
        }
        let pick = contract::pick_language(&trials);
        let german = trials.iter().any(|(l, t)| *l == LANGUAGES[1] && contract::looks_german(&contract::text(t)));
        Ok(Some(if pick == LANGUAGES[1] && german { LANGUAGES[1] } else { LANGUAGES[0] }))
    }

    fn set_language(&mut self, lang: &str) -> Result<()> {
        if let Asr::Nemotron(model) = &mut self.model {
            model.set_target_lang(lang).map_err(|e| anyhow::anyhow!("{e}"))?;
        }
        Ok(())
    }

    /// The whole recording (16 kHz mono): its transcript in the catalog's contract. `progress` gets the stage and 0…1.
    pub fn transcribe(&mut self, samples: &[f32], progress: &mut dyn FnMut(&str, f64)) -> Result<Value> {
        let stretches = self.speech(samples, VadParams::default(), &mut |p| progress("finding speech", p))?;
        self.read(samples, &stretches, None, progress)
    }

    /// The words of these stretches, in `lang` (a locale; none: the language this model tells, English when unsure).
    pub fn read(&mut self, samples: &[f32], stretches: &[(usize, usize)], lang: Option<&str>, progress: &mut dyn FnMut(&str, f64)) -> Result<Value> {
        let lang = match lang {
            Some(l) => LANGUAGES.into_iter().find(|x| *x == l).ok_or_else(|| anyhow::anyhow!("not a language here: {l}"))?,
            None => {
                progress("telling the language", 0.0);
                self.language(samples, stretches)?.unwrap_or(LANGUAGES[0])
            }
        };
        self.set_language(lang)?;
        let total: usize = stretches.iter().map(|(a, b)| b - a).sum::<usize>().max(1);
        let mut done = 0;
        let mut out = Vec::with_capacity(stretches.len());
        for (a, b) in stretches {
            progress("transcribing", done as f64 / total as f64);
            let tokens = self.tokens(&samples[*a..*b])?;
            let offset = *a as f64 / RATE as f64;
            out.push((offset, *b as f64 / RATE as f64, contract::words(&tokens, offset)));
            done += b - a;
        }
        progress("transcribing", 1.0);
        Ok(contract::transcript(self.engine.model(), lang, &out))
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
    fn every_engine_by_its_id() {
        for e in Engine::ALL {
            assert_eq!(Engine::from_id(e.id()), Some(e));
        }
        assert_eq!(Engine::default(), Engine::Phonon);
        assert_eq!(Engine::from_id("whisper"), None);
        assert!(!Engine::Phonon.multilingual() && Engine::Nemotron.multilingual());
        assert_eq!(locale("de"), Some("de-DE"));
        assert_eq!(locale("en"), Some("en-US"));
        assert_eq!(locale("fr"), None);
    }

    #[test]
    fn a_quiet_stretch_is_brought_up_not_a_loud_one() {
        let quiet = normalized(&[0.05, -0.05]);
        assert!((quiet[0] - 0.4).abs() < 1e-6, "{quiet:?}"); // ×8 at most
        let loud = normalized(&[0.9, -0.5]);
        assert!((loud[0] - 0.7).abs() < 1e-6);
    }

    /// The real models on a spoken sentence (VAULT_ASR_MODELS: a folder with the model's folder, named as its id, and
    /// silero_vad.onnx; VAULT_ASR_ENGINE: which, Phonon-2's by default; VAULT_ASR_WAV: a 16 kHz WAV; VAULT_ASR_EXPECT:
    /// words it must contain) — skipped without them. Prints the real-time factor.
    #[test]
    fn transcribes_a_recording_with_the_real_models() {
        let (Some(dir), Some(wav)) = (std::env::var_os("VAULT_ASR_MODELS"), std::env::var_os("VAULT_ASR_WAV")) else {
            eprintln!("no VAULT_ASR_MODELS / VAULT_ASR_WAV: skipped");
            return;
        };
        let dir = PathBuf::from(dir);
        let engine = std::env::var("VAULT_ASR_ENGINE").ok().map(|e| Engine::from_id(&e).expect("an engine's id")).unwrap_or_default();
        let models = Models { engine, speech: dir.join(engine.id()), vad: dir.join("silero_vad.onnx") };
        assert!(engine.complete(&models.speech));
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
