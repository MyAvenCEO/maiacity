//! The transcript contract, as the catalog keeps it (`transcript/<hash>`; the studio's transcript.js and the MCP read
//! it): `{ model, language, text, words: [{ w, s, e, c }], utterances: [{ s, e, text }] }` — times in seconds of the
//! original file. Pure: the speech stretches from the VAD's probabilities, words from the model's tokens, the language
//! from two trial passes, the whole from the pieces.

use serde_json::{Value, json};

/// 16 kHz: what Silero and Nemotron take.
pub const RATE: usize = 16_000;
/// Silero's window: 512 samples (32 ms).
pub const WINDOW: usize = 512;
/// One Nemotron encoder frame: 8 mel hops of 10 ms — a token's time is known to 80 ms.
pub const FRAME_SECONDS: f64 = 0.08;

/// How speech is told from the rest (Silero's own defaults, as its reference wrapper uses them).
#[derive(Debug, Clone, Copy)]
pub struct VadParams {
    /// a window is speech from this probability …
    pub threshold: f32,
    /// … and speech goes on until it falls below this
    pub negative: f32,
    /// shorter speech is dropped (a click, a breath)
    pub min_speech_ms: usize,
    /// a pause at least this long ends a stretch (and an utterance)
    pub min_silence_ms: usize,
    /// kept around each stretch, so a word's first and last sounds are in it
    pub pad_ms: usize,
    /// a longer stretch is cut at its quietest window (the model reads a stretch at once)
    pub max_speech_s: f64,
}

impl Default for VadParams {
    fn default() -> Self {
        Self { threshold: 0.5, negative: 0.35, min_speech_ms: 250, min_silence_ms: 500, pad_ms: 200, max_speech_s: 30.0 }
    }
}

/// The speech stretches, in samples [start, end), from one probability per WINDOW samples of a sound `len` long.
pub fn speech(probs: &[f32], len: usize, p: VadParams) -> Vec<(usize, usize)> {
    let ms = |m: usize| m * RATE / 1000;
    let mut raw: Vec<(usize, usize)> = Vec::new();
    let mut start: Option<usize> = None;
    let mut quiet_since: Option<usize> = None;
    for (i, &prob) in probs.iter().enumerate() {
        let at = i * WINDOW;
        match start {
            None if prob >= p.threshold => {
                start = Some(at);
                quiet_since = None;
            }
            Some(s) => {
                if prob >= p.threshold {
                    quiet_since = None;
                } else if prob < p.negative {
                    let q = *quiet_since.get_or_insert(at);
                    if at + WINDOW - q >= ms(p.min_silence_ms) {
                        raw.push((s, q));
                        start = None;
                        quiet_since = None;
                    }
                }
            }
            None => {}
        }
    }
    if let Some(s) = start {
        raw.push((s, quiet_since.unwrap_or(len).min(len)));
    }
    // too short: not speech; then padded (never over the neighbour, never outside the sound)
    let raw: Vec<(usize, usize)> = raw.into_iter().filter(|(a, b)| b - a >= ms(p.min_speech_ms)).collect();
    let mut out: Vec<(usize, usize)> = Vec::new();
    for (i, (a, b)) in raw.iter().enumerate() {
        let lo = if i == 0 { 0 } else { (raw[i - 1].1 + a) / 2 };
        let hi = raw.get(i + 1).map(|n| (b + n.0) / 2).unwrap_or(len);
        out.push((a.saturating_sub(ms(p.pad_ms)).max(lo), (b + ms(p.pad_ms)).min(hi).min(len)));
    }
    // a stretch longer than the model reads at once: cut at its quietest window, again and again
    let max = (p.max_speech_s * RATE as f64) as usize;
    let mut cut = Vec::new();
    let mut todo = out;
    todo.reverse();
    while let Some((a, b)) = todo.pop() {
        if b - a <= max {
            cut.push((a, b));
            continue;
        }
        // the quietest window in the middle half of the stretch's allowed length
        let (from, to) = ((a + max / 4) / WINDOW, (a + max) / WINDOW);
        let at = (from..to.min(probs.len())).min_by(|x, y| probs[*x].total_cmp(&probs[*y])).map(|w| w * WINDOW).unwrap_or(a + max).clamp(a + WINDOW, b - WINDOW);
        todo.push((at, b));
        todo.push((a, at));
    }
    cut
}

/// A token as the recognizer gives it: its text (a leading space starts a word), its log-probability, and the encoder
/// frame it came at (counted from the start of the stretch it was read in).
#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub text: String,
    pub logprob: f32,
    pub frame: usize,
}

/// Is this a language tag the multilingual model says (`<en-US>`), not a word?
fn is_tag(t: &str) -> bool {
    let t = t.trim();
    t.starts_with('<') && t.ends_with('>')
}

/// A stretch's tokens as words, with their times in seconds of the file (the stretch starts at `offset`) and their
/// confidence (the mean token probability). A word starts with a token that starts with a space; punctuation joins the
/// word before it.
pub fn words(tokens: &[Token], offset: f64) -> Vec<Value> {
    let mut out: Vec<(String, usize, usize, Vec<f32>)> = Vec::new();
    for t in tokens.iter().filter(|t| !is_tag(&t.text) && !t.text.is_empty()) {
        let starts = t.text.starts_with(' ') || out.is_empty();
        let piece = t.text.trim_start();
        let punct = !piece.is_empty() && piece.chars().all(|c| c.is_ascii_punctuation() || "…«»„“”‚‘’".contains(c));
        if (starts && !punct) || out.is_empty() {
            out.push((piece.to_string(), t.frame, t.frame, vec![t.logprob]));
        } else if let Some(w) = out.last_mut() {
            w.0.push_str(piece);
            w.2 = t.frame;
            w.3.push(t.logprob);
        }
    }
    let r3 = |x: f64| (x * 1000.0).round() / 1000.0;
    out.into_iter()
        .filter(|w| !w.0.trim().is_empty())
        .map(|(w, a, b, lp)| {
            let c = (lp.iter().map(|x| *x as f64).sum::<f64>() / lp.len().max(1) as f64).exp();
            json!({ "w": w, "s": r3(offset + a as f64 * FRAME_SECONDS), "e": r3(offset + (b + 1) as f64 * FRAME_SECONDS), "c": (c * 100.0).round() / 100.0 })
        })
        .collect()
}

/// How sure the model is of a trial pass: the mean log-probability of its word tokens (−∞ when it heard none).
pub fn sureness(tokens: &[Token]) -> f64 {
    let lp: Vec<f64> = tokens.iter().filter(|t| !is_tag(&t.text) && !t.text.trim().is_empty()).map(|t| t.logprob as f64).collect();
    if lp.is_empty() { f64::NEG_INFINITY } else { lp.iter().sum::<f64>() / lp.len() as f64 }
}

/// Of the trial passes (language, tokens), the one the model is surest of — our recordings are English or German.
pub fn pick_language<'a>(trials: &'a [(&'a str, Vec<Token>)]) -> &'a str {
    trials.iter().max_by(|a, b| sureness(&a.1).total_cmp(&sureness(&b.1))).map(|(l, _)| *l).unwrap_or("en-US")
}

/// The whole transcript: its words, one utterance per speech stretch (its words' text), the plain text. `language`
/// is kept short ("en", "de"), as the catalog has it.
pub fn transcript(model: &str, locale: &str, stretches: &[(f64, f64, Vec<Value>)]) -> Value {
    let mut all = Vec::new();
    let mut utterances = Vec::new();
    for (s, e, ws) in stretches {
        if ws.is_empty() {
            continue;
        }
        let text = join(ws);
        let first = ws[0]["s"].as_f64().unwrap_or(*s);
        let last = ws[ws.len() - 1]["e"].as_f64().unwrap_or(*e);
        utterances.push(json!({ "s": first, "e": last, "text": text }));
        all.extend(ws.iter().cloned());
    }
    let text = utterances.iter().filter_map(|u| u["text"].as_str()).collect::<Vec<_>>().join(" ");
    let language = locale.split('-').next().unwrap_or(locale);
    json!({ "model": model, "language": language, "locale": locale, "text": text, "words": all, "utterances": utterances })
}

fn join(words: &[Value]) -> String {
    words.iter().filter_map(|w| w["w"].as_str()).collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tok(text: &str, frame: usize, logprob: f32) -> Token {
        Token { text: text.into(), logprob, frame }
    }

    #[test]
    fn speech_is_told_from_silence() {
        // 1 s quiet, 2 s speech, 1 s quiet, 0.1 s speech (a click), 1 s quiet — in 32 ms windows
        let w = |secs: f64| (secs * RATE as f64 / WINDOW as f64).round() as usize;
        let mut probs = vec![0.02; w(1.0)];
        probs.extend(vec![0.9; w(2.0)]);
        probs.extend(vec![0.02; w(1.0)]);
        probs.extend(vec![0.9; w(0.1)]);
        probs.extend(vec![0.02; w(1.0)]);
        let len = probs.len() * WINDOW;
        let st = speech(&probs, len, VadParams::default());
        assert_eq!(st.len(), 1, "{st:?}");
        let (a, b) = (st[0].0 as f64 / RATE as f64, st[0].1 as f64 / RATE as f64);
        assert!((a - 0.8).abs() < 0.05, "starts {a}");
        assert!((b - 3.2).abs() < 0.05, "ends {b}");
        // a short pause inside speech does not cut it
        let mut talk = vec![0.9; w(2.0)];
        talk.extend(vec![0.1; w(0.3)]);
        talk.extend(vec![0.9; w(2.0)]);
        assert_eq!(speech(&talk, talk.len() * WINDOW, VadParams::default()).len(), 1);
    }

    #[test]
    fn a_long_stretch_is_cut_where_it_is_quietest() {
        let w = |secs: f64| (secs * RATE as f64 / WINDOW as f64).round() as usize;
        let mut probs = vec![0.9; w(50.0)];
        // a dip at 22 s (not long enough to end the stretch)
        for p in &mut probs[w(22.0)..w(22.2)] {
            *p = 0.4;
        }
        let st = speech(&probs, probs.len() * WINDOW, VadParams::default());
        assert_eq!(st.len(), 2, "{st:?}");
        assert!(st.iter().all(|(a, b)| (b - a) as f64 / RATE as f64 <= 30.0));
        let cut = st[0].1 as f64 / RATE as f64;
        assert!((cut - 22.0).abs() < 0.3, "cut at {cut}");
        assert_eq!(st[0].1, st[1].0);
    }

    #[test]
    fn tokens_become_timed_words() {
        let t = [tok("<en-US>", 0, -0.1), tok(" Day", 3, -0.01), tok(" tw", 7, -0.2), tok("enty", 8, -0.3), tok(".", 9, -0.05), tok(" Does", 14, -0.02)];
        let ws = words(&t, 10.0);
        assert_eq!(ws.len(), 3);
        assert_eq!(ws[0], json!({ "w": "Day", "s": 10.24, "e": 10.32, "c": 0.99 }));
        assert_eq!(ws[1]["w"], "twenty.");
        assert_eq!(ws[1]["s"], 10.56);
        assert_eq!(ws[1]["e"], 10.8);
        assert_eq!(ws[2]["w"], "Does");
        // the first token without a space still starts a word
        assert_eq!(words(&[tok("Hallo", 0, 0.0)], 0.0)[0]["w"], "Hallo");
    }

    #[test]
    fn the_language_the_model_is_surest_of() {
        let en = vec![tok(" the", 1, -0.1), tok(" city", 2, -0.2)];
        let de = vec![tok(" die", 1, -1.4), tok(" Stadt", 2, -2.0)];
        assert_eq!(pick_language(&[("en-US", en.clone()), ("de-DE", de.clone())]), "en-US");
        assert_eq!(pick_language(&[("en-US", vec![]), ("de-DE", de)]), "de-DE");
    }

    #[test]
    fn the_whole_transcript() {
        let a = words(&[tok(" Day", 3, 0.0), tok(" twenty.", 8, 0.0)], 1.0);
        let b = words(&[tok(" Does", 0, 0.0), tok(" it", 2, 0.0), tok(" hold?", 4, 0.0)], 6.0);
        let t = transcript("nvidia/nemotron-3.5-asr-streaming-0.6b", "en-US", &[(0.8, 2.0, a), (5.9, 6.6, b), (9.0, 9.5, vec![])]);
        assert_eq!(t["language"], "en");
        assert_eq!(t["text"], "Day twenty. Does it hold?");
        assert_eq!(t["words"].as_array().unwrap().len(), 5);
        assert_eq!(t["utterances"], json!([{ "s": 1.24, "e": 1.72, "text": "Day twenty." }, { "s": 6.0, "e": 6.4, "text": "Does it hold?" }]));
    }
}
