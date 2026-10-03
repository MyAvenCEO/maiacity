//! What colour a movie is in — the native twin of `detect()` in game/film/color.js, from what AVFoundation reads:
//! our own comment first ("maiacity:color=…"), then Apple's camera log in the metadata, then the colour tags.
//! Anything that cannot be told is "unknown": the studio asks instead of guessing.

use crate::Probe;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ColorInfo {
    pub profile: String,
    /// what it was told by
    pub from: String,
}

/// The profiles game/film/color.js knows (PROFILES).
pub const PROFILES: [&str; 11] =
    ["acescct", "rec709", "srgb", "legacy", "hlg", "pq", "apple-log", "apple-log-2", "aces2065-1", "acescg", "linear-rec709"];

pub fn detect(p: &Probe) -> ColorInfo {
    let info = |profile: &str, from: &str| ColorInfo { profile: profile.into(), from: from.into() };
    let all = p.tags.join(" ").to_lowercase();
    if let Some(ours) = all.split("maiacity:color=").nth(1).map(|s| s.split(|c: char| !(c.is_ascii_alphanumeric() || c == '-')).next().unwrap_or("")) {
        if PROFILES.contains(&ours) {
            return info(ours, "our own tag");
        }
    }
    let transfer = p.transfer.as_deref().unwrap_or("unknown");
    let primaries = p.primaries.as_deref().unwrap_or("unknown");
    // Apple's camera log: the iPhone writes it into the QuickTime metadata (or, newer, as the transfer function)
    let apple = format!("{all} {}", transfer.to_lowercase());
    // the sample description's `logs` atom, Apple's own identifiers (CoreVideo's kCVImageBufferLogTransferFunction_…):
    // Apple Wide Gamut + the Apple Log curve is Apple Log 2 (iPhone 17 Pro on "Log 2"); Rec.2020 + the Apple Log curve is
    // the first Apple Log (iPhone 15 Pro and 16 Pro, or a 17 Pro left on "Log")
    if apple.contains("com.apple.apple-wide-gamut.apple-log") {
        return info("apple-log-2", "log atom (Apple Wide Gamut · Apple Log)");
    }
    if apple.contains("com.apple.rec2020.apple-log") {
        return info("apple-log", "log atom (Rec.2020 · Apple Log)");
    }
    if apple.contains("logs=com.apple.log") || apple.contains("logtransferfunction=com.apple.log") {
        return info("apple-log", "log atom (Apple Log)");
    }
    if apple.contains("applelog2") || apple.contains("apple log 2") || apple.contains("apple_log_2") {
        return info("apple-log-2", "Apple metadata (Apple Log 2)");
    }
    if apple.contains("applelog") || apple.contains("apple log") || apple.contains("apple_log") {
        return info("apple-log", "Apple metadata (Apple Log)");
    }
    match transfer {
        "ITU_R_2100_HLG" => return info("hlg", "transfer tag (HLG)"),
        "SMPTE_ST_2084_PQ" => return info("pq", "transfer tag (PQ)"),
        "Linear" => {
            return if primaries == "ITU_R_709_2" {
                info("linear-rec709", "colour tags (linear Rec.709)")
            } else {
                info("unknown", "linear light of unknown primaries")
            };
        }
        _ => {}
    }
    if all.contains("apple") && primaries == "ITU_R_2020" && transfer == "unknown" {
        return info("unknown", "Apple camera, BT.2020 without a transfer tag: Apple Log or Apple Log 2 — set it by hand");
    }
    if matches!(transfer, "ITU_R_709_2" | "SMPTE_170M" | "IEC_sRGB" | "UseGamma") || matches!(primaries, "ITU_R_709_2" | "SMPTE_C" | "EBU_3213") {
        return info("rec709", "colour tags (Rec.709)");
    }
    if p.bits.unwrap_or(8) <= 8 && transfer == "unknown" && primaries == "unknown" {
        return info("rec709", "untagged 8-bit video: Rec.709");
    }
    info("unknown", "nothing to tell it by")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with(tags: &[&str], transfer: Option<&str>, primaries: Option<&str>) -> Probe {
        Probe { tags: tags.iter().map(|t| t.to_string()).collect(), transfer: transfer.map(String::from), primaries: primaries.map(String::from), bits: Some(10), ..Default::default() }
    }

    /// Apple's own identifiers, as CoreVideo's kCVImageBufferLogTransferFunction_AppleLog2 / _AppleLog spell them
    #[test]
    fn apple_logs_by_their_identifiers() {
        assert_eq!(detect(&with(&["atom:logs=com.apple.apple-wide-gamut.apple-log"], None, Some("ITU_R_2020"))).profile, "apple-log-2");
        assert_eq!(detect(&with(&["atom:logs=com.apple.rec2020.apple-log"], None, Some("ITU_R_2020"))).profile, "apple-log");
        assert_eq!(detect(&with(&[], Some("com.apple.rec2020.apple-log"), Some("ITU_R_2020"))).profile, "apple-log");
        // an Apple file in BT.2020 with nothing to tell which log: asked, never guessed
        assert_eq!(detect(&with(&["com.apple.quicktime.make=Apple"], None, Some("ITU_R_2020"))).profile, "unknown");
    }
}
