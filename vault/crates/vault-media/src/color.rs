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

/// The profile a file's proxy is encoded in (color.js `proxyProfileOf`): camera log stays its log, display video
/// stays as it is, HDR and linear light go to ACEScct.
pub fn proxy_profile(p: &str) -> &'static str {
    match p {
        "acescct" | "hlg" | "pq" | "aces2065-1" | "acescg" | "linear-rec709" => "acescct",
        "rec709" => "rec709",
        "srgb" => "srgb",
        "legacy" => "legacy",
        "apple-log" => "apple-log",
        "apple-log-2" => "apple-log-2",
        _ => "unknown",
    }
}

/// Does making this file's proxy need a colour transform (into ACEScct)? Those wait for the native transforms.
pub fn proxy_needs_transform(p: &str) -> bool {
    proxy_profile(p) == "acescct" && p != "acescct"
}

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
