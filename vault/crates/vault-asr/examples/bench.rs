//! The speech models side by side on the same recordings: each file read by each model (one model in memory at a
//! time), its words, how long it took, and how surely the model heard the first seconds. One JSON line per file and
//! model.
//!
//!   cargo run --release -p vault-asr --example bench -- <models-dir> <engine,engine,…> <16 kHz WAV>…
//!
//! `<models-dir>` holds each model's folder under its id (phonon-2,
//! nemotron-3.5-asr-streaming-0.6b) and silero_vad.onnx.

use std::{path::PathBuf, time::Instant};

use serde_json::json;
use vault_asr::{Engine, Models, Recognizer, VadParams};

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [dir, engines, wavs @ ..] = &args[..] else {
        anyhow::bail!("bench <models-dir> <engine,engine,…> <wav>…");
    };
    let dir = PathBuf::from(dir);
    for id in engines.split(',') {
        let engine = Engine::from_id(id).ok_or_else(|| anyhow::anyhow!("no engine {id}"))?;
        let models = Models { engine, speech: dir.join(engine.id()), vad: dir.join("silero_vad.onnx") };
        let t0 = Instant::now();
        let mut r = Recognizer::open(&models)?;
        eprintln!("{id}: loaded in {:.1} s", t0.elapsed().as_secs_f64());
        for wav in wavs {
            let samples = vault_asr::read_wav(std::path::Path::new(wav))?;
            let seconds = samples.len() as f64 / vault_asr::RATE as f64;
            let t = Instant::now();
            let stretches = r.speech(&samples, VadParams::default(), &mut |_| {})?;
            let sureness = r.sureness(&samples, &stretches)?;
            let heard = r.language(&samples, &stretches)?;
            let t1 = Instant::now();
            let words = r.read(&samples, &stretches, None, &mut |_, _| {})?;
            let took = t1.elapsed().as_secs_f64();
            let n = words["words"].as_array().map(Vec::len).unwrap_or(0);
            println!(
                "{}",
                json!({ "engine": id, "file": wav, "seconds": seconds, "took": took, "rtf": took / seconds.max(0.1), "gate_took": (t1 - t).as_secs_f64(),
                        "sureness": sureness, "heard": heard, "language": words["language"], "words": n, "text": words["text"] })
            );
            eprintln!("{id} {wav}: {seconds:.0} s in {took:.1} s, sureness {sureness:.3}, {}", words["language"]);
        }
    }
    Ok(())
}
