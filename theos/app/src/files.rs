//! Files on this Mac's drives, as a card or a folder brings them in (aven.rs `studio_ingest`): every file under a path,
//! the OS's own junk left out, each one's media type from its name, and the time now as the jobs write it. (They were
//! the old media vault's, vault-core's `ingest`, which retired with it: #1112.)

use std::path::{Path, PathBuf};

/// Files the OS leaves on cards and drives — never footage.
fn is_junk(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    name.starts_with("._")
        || matches!(name, ".DS_Store" | ".Spotlight-V100" | ".Trashes" | ".fseventsd" | ".TemporaryItems")
}

/// Every file under `path` (or `path` itself), junk left out, in a stable order.
pub fn walk(path: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    let mut stack = vec![path.to_path_buf()];
    while let Some(p) = stack.pop() {
        if is_junk(&p) {
            continue;
        }
        let md = std::fs::symlink_metadata(&p)?;
        if md.is_dir() {
            for e in std::fs::read_dir(&p)? {
                stack.push(e?.path());
            }
        } else if md.is_file() {
            out.push(p);
        }
    }
    out.sort();
    Ok(out)
}

/// The time now, `2026-10-20T14:05:00Z`.
pub fn now_iso() -> String {
    // seconds since the epoch, formatted without pulling in a date crate
    let s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
    let (days, rem) = (s.div_euclid(86_400), s.rem_euclid(86_400));
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Howard Hinnant's days → civil date.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// A file's media type, from its name.
pub fn mime_of(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("avif") => "image/avif",
        Some("heic") => "image/heic",
        Some("dng") => "image/x-adobe-dng",
        Some("exr") => "image/x-exr",
        Some("mp4") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("m4v") => "video/x-m4v",
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        Some("braw") => "video/x-braw",
        Some("r3d") => "video/x-r3d",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("m4a") => "audio/mp4",
        Some("pdf") => "application/pdf",
        Some("json") => "application/json",
        // an EXR frame sequence or a game build, packed into one file
        Some("tar") => "application/x-tar",
        Some("cube") => "text/plain",
        _ => "application/octet-stream",
    }
}
