//! Phonon-2 on recordings: each file's words and how long they took. One JSON line per file.
//!
//!   cargo run --release -p vault-asr --example bench -- <models-dir> <16 kHz WAV>…
//!
//! `<models-dir>` holds phonon-2/ and silero_vad.onnx.

use std::{path::PathBuf, time::Instant};

use serde_json::json;
use vault_asr::{Models, Recognizer};

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [dir, wavs @ ..] = &args[..] else {
        anyhow::bail!("bench <models-dir> <wav>…");
    };
    let dir = PathBuf::from(dir);
    let t0 = Instant::now();
    let mut r = Recognizer::open(&Models { speech: dir.join("phonon-2"), vad: dir.join("silero_vad.onnx") })?;
    eprintln!("loaded in {:.1} s", t0.elapsed().as_secs_f64());
    for wav in wavs {
        let samples = vault_asr::read_wav(std::path::Path::new(wav))?;
        let seconds = samples.len() as f64 / vault_asr::RATE as f64;
        let t = Instant::now();
        let words = r.transcribe(&samples, &mut |_, _| {})?;
        let took = t.elapsed().as_secs_f64();
        let n = words["words"].as_array().map(Vec::len).unwrap_or(0);
        println!("{}", json!({ "file": wav, "seconds": seconds, "took": took, "rtf": took / seconds.max(0.1), "words": n, "text": words["text"] }));
        eprintln!("{wav}: {seconds:.0} s in {took:.1} s, {n} words");
    }
    Ok(())
}
