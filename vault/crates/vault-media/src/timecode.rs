//! A recording's start timecode, read from the file itself — what ffprobe gave the vault server before (its `timecode`
//! tag): a movie's QuickTime/MP4 timecode track (`tmcd`: its sample description says the rate and drop frame, its one
//! sample the frame count at the first frame), or a sound file's BWF time reference (`bext`: samples since midnight).
//! Read in place through a `Source`, box by box — no ffprobe, nothing copied out.

use std::io::{Read, Seek, SeekFrom};

use anyhow::{Context, Result, bail};

use crate::Source;

/// The fps a sound file's BWF time reference is written in (the studio's cuts land on 30 fps frames).
pub const AUDIO_TC_FPS: f64 = 30.0;

/// A timecode track's description (QuickTime `tmcd` sample entry) and its first sample.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Tmcd {
    /// drop frame (flag 0x1)
    pub drop: bool,
    pub timescale: u32,
    pub frame_duration: u32,
    /// frames per second as the counter counts them (24, 25, 30 …)
    pub quanta: u32,
    /// the frame count at the first frame
    pub frame: u32,
}

impl Tmcd {
    /// The rate the track describes (timescale / frame duration), rounded to three places (23.976).
    pub fn fps(&self) -> f64 {
        if self.frame_duration == 0 {
            return self.quanta as f64;
        }
        (self.timescale as f64 / self.frame_duration as f64 * 1000.0).round() / 1000.0
    }

    /// "HH:MM:SS:FF" — `;` before the frames when drop frame (as ffmpeg writes it).
    pub fn text(&self) -> String {
        frames_to_timecode(self.frame as u64, self.quanta.max(1) as u64, self.drop)
    }
}

/// A frame count → "HH:MM:SS:FF" at `fps` whole frames a second; drop frame (29.97/59.94) skips its numbers the way
/// SMPTE does (ffmpeg's `av_timecode_adjust_ntsc_framenum2`).
pub fn frames_to_timecode(frame: u64, fps: u64, drop: bool) -> String {
    let fps = fps.max(1);
    let mut n = frame;
    let drop_frames = if drop && fps % 30 == 0 { fps / 15 } else { 0 };
    if drop_frames > 0 {
        let per_10 = fps * 600 - drop_frames * 9;
        let (d, m) = (n / per_10, n % per_10);
        n += 9 * drop_frames * d + drop_frames * (m.saturating_sub(drop_frames) / (per_10 / 10));
    }
    let (ff, secs) = (n % fps, n / fps);
    let sep = if drop_frames > 0 { ';' } else { ':' };
    format!("{:02}:{:02}:{:02}{sep}{:02}", secs / 3600 % 24, secs / 60 % 60, secs % 60, ff)
}

/// Seconds since midnight → "HH:MM:SS:FF" at a whole frame rate.
pub fn timecode_of(seconds: f64, fps: f64) -> String {
    let fps_i = fps.round().max(1.0) as u64;
    frames_to_timecode((seconds * fps_i as f64).round() as u64, fps_i, false)
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// The children of a box body: (kind, body start, body end), offsets into `b`.
fn children(b: &[u8]) -> Vec<([u8; 4], usize, usize)> {
    let mut out = Vec::new();
    let mut at = 0;
    while at + 8 <= b.len() {
        let Some(mut size) = be32(b, at).map(|s| s as usize) else { break };
        let kind: [u8; 4] = b[at + 4..at + 8].try_into().unwrap();
        let mut head = 8;
        if size == 1 {
            let Some(big) = b.get(at + 8..at + 16) else { break };
            size = u64::from_be_bytes(big.try_into().unwrap()) as usize;
            head = 16;
        } else if size == 0 {
            size = b.len() - at;
        }
        if size < head || at + size > b.len() {
            break;
        }
        out.push((kind, at + head, at + size));
        at += size;
    }
    out
}

fn child<'a>(b: &'a [u8], want: &[u8; 4]) -> Option<&'a [u8]> {
    children(b).into_iter().find(|(k, _, _)| k == want).map(|(_, s, e)| &b[s..e])
}

/// The timecode track in a `moov` box's body: its description and where its first sample lies (a file offset).
pub fn tmcd_in_moov(moov: &[u8]) -> Option<(Tmcd, u64)> {
    for (kind, s, e) in children(moov) {
        if &kind != b"trak" {
            continue;
        }
        let trak = &moov[s..e];
        let Some(mdia) = child(trak, b"mdia") else { continue };
        // hdlr: version/flags (4), pre-defined or component type (4), handler type (4)
        let is_tmcd = child(mdia, b"hdlr").and_then(|h| h.get(8..12)) == Some(b"tmcd".as_slice());
        if !is_tmcd {
            continue;
        }
        let stbl = child(mdia, b"minf").and_then(|m| child(m, b"stbl"))?;
        // stsd: version/flags (4), entry count (4), then the entry: size (4), format (4), reserved (6), data
        // reference index (2), reserved (4), flags (4), timescale (4), frame duration (4), number of frames (1)
        let stsd = child(stbl, b"stsd")?;
        let entry = stsd.get(8..)?;
        if entry.get(4..8) != Some(b"tmcd".as_slice()) {
            continue;
        }
        let flags = be32(entry, 20)?;
        let (timescale, frame_duration) = (be32(entry, 24)?, be32(entry, 28)?);
        let quanta = *entry.get(32)? as u32;
        let offset = if let Some(stco) = child(stbl, b"stco") {
            be32(stco, 8)? as u64
        } else {
            let co64 = child(stbl, b"co64")?;
            u64::from_be_bytes(co64.get(8..16)?.try_into().ok()?)
        };
        let quanta = if quanta > 0 { quanta } else if frame_duration > 0 { (timescale as f64 / frame_duration as f64).round() as u32 } else { 0 };
        return Some((Tmcd { drop: flags & 1 == 1, timescale, frame_duration, quanta, frame: 0 }, offset));
    }
    None
}

/// A movie's timecode track, read from the file: its description and the frame count of its first sample.
pub fn tmcd<R: Read + Seek>(f: &mut R) -> Result<Option<Tmcd>> {
    let len = f.seek(SeekFrom::End(0))?;
    let mut at = 0u64;
    while at + 8 <= len {
        f.seek(SeekFrom::Start(at))?;
        let mut head = [0u8; 16];
        f.read_exact(&mut head[..8])?;
        let mut size = u32::from_be_bytes(head[0..4].try_into()?) as u64;
        let kind: [u8; 4] = head[4..8].try_into()?;
        let mut header = 8u64;
        if size == 1 {
            f.read_exact(&mut head[8..16])?;
            size = u64::from_be_bytes(head[8..16].try_into()?);
            header = 16;
        } else if size == 0 {
            size = len - at;
        }
        if size < header {
            bail!("a broken box at {at}");
        }
        if &kind == b"moov" {
            anyhow::ensure!(size <= 512 * 1024 * 1024, "a moov of {size} bytes");
            let mut body = vec![0u8; (size - header) as usize];
            f.read_exact(&mut body)?;
            let Some((mut t, offset)) = tmcd_in_moov(&body) else { return Ok(None) };
            f.seek(SeekFrom::Start(offset))?;
            let mut n = [0u8; 4];
            f.read_exact(&mut n).context("the timecode sample")?;
            t.frame = u32::from_be_bytes(n);
            return Ok(Some(t));
        }
        at += size;
    }
    Ok(None)
}

/// A WAV's BWF time reference and sample rate (RIFF `bext` and `fmt `), when it has them.
pub fn bext<R: Read + Seek>(f: &mut R) -> Result<Option<(u64, u32)>> {
    let len = f.seek(SeekFrom::End(0))?;
    f.seek(SeekFrom::Start(0))?;
    let mut riff = [0u8; 12];
    if len < 12 || f.read_exact(&mut riff).is_err() || &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
        return Ok(None);
    }
    let (mut at, mut reference, mut rate) = (12u64, None, None);
    while at + 8 <= len && (reference.is_none() || rate.is_none()) {
        f.seek(SeekFrom::Start(at))?;
        let mut head = [0u8; 8];
        f.read_exact(&mut head)?;
        let size = u32::from_le_bytes(head[4..8].try_into()?) as u64;
        match &head[0..4] {
            b"fmt " => {
                let mut b = [0u8; 8];
                f.read_exact(&mut b)?;
                rate = Some(u32::from_le_bytes(b[4..8].try_into()?));
            }
            b"bext" if size >= 346 => {
                // description (256), originator (32), reference (32), date (10), time (8), then the time reference:
                // two little-endian u32, low first
                f.seek(SeekFrom::Current(338))?;
                let mut b = [0u8; 8];
                f.read_exact(&mut b)?;
                reference = Some(u32::from_le_bytes(b[0..4].try_into()?) as u64 | (u32::from_le_bytes(b[4..8].try_into()?) as u64) << 32);
            }
            _ => {}
        }
        at += 8 + size + (size & 1);
    }
    Ok(match (reference, rate) {
        (Some(r), Some(sr)) if sr > 0 => Some((r, sr)),
        _ => None,
    })
}

/// The start timecode of a movie or a sound file and its frame rate: a movie's tmcd track (at `video_fps` when the
/// movie says its rate — 23.976 — else the track's own), else a WAV's BWF time reference (at AUDIO_TC_FPS).
pub fn start_timecode(src: &Source, video_fps: Option<f64>) -> Result<Option<(String, f64)>> {
    let mut r = src.reader()?;
    if let Some(t) = tmcd(&mut r).unwrap_or(None) {
        let fps = video_fps.filter(|f| *f > 0.0).map(|f| (f * 1000.0).round() / 1000.0).unwrap_or_else(|| t.fps());
        return Ok(Some((t.text(), fps)));
    }
    if video_fps.is_none() {
        if let Some((reference, rate)) = bext(&mut r)? {
            return Ok(Some((timecode_of(reference as f64 / rate as f64, AUDIO_TC_FPS), AUDIO_TC_FPS)));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn boxed(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut b = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        b.extend_from_slice(kind);
        b.extend_from_slice(body);
        b
    }

    /// A movie with only a timecode track: ftyp, the sample (a frame count), then moov.
    fn movie(frame: u32, flags: u32, timescale: u32, duration: u32, quanta: u8) -> Vec<u8> {
        let ftyp = boxed(b"ftyp", b"qt  \0\0\0\0qt  ");
        let mdat = boxed(b"mdat", &frame.to_be_bytes());
        let sample_at = (ftyp.len() + 8) as u32;
        let mut hdlr = vec![0u8; 4];
        hdlr.extend_from_slice(b"mhlr");
        hdlr.extend_from_slice(b"tmcd");
        hdlr.extend_from_slice(&[0u8; 12]);
        let mut entry = Vec::new();
        entry.extend_from_slice(b"tmcd");
        entry.extend_from_slice(&[0u8; 6]);
        entry.extend_from_slice(&1u16.to_be_bytes());
        entry.extend_from_slice(&0u32.to_be_bytes());
        entry.extend_from_slice(&flags.to_be_bytes());
        entry.extend_from_slice(&timescale.to_be_bytes());
        entry.extend_from_slice(&duration.to_be_bytes());
        entry.push(quanta);
        entry.push(0);
        let mut e = ((entry.len() + 4) as u32).to_be_bytes().to_vec();
        e.extend_from_slice(&entry);
        let mut stsd = vec![0u8; 4];
        stsd.extend_from_slice(&1u32.to_be_bytes());
        stsd.extend_from_slice(&e);
        let mut stco = vec![0u8; 4];
        stco.extend_from_slice(&1u32.to_be_bytes());
        stco.extend_from_slice(&sample_at.to_be_bytes());
        let stbl = boxed(b"stbl", &[boxed(b"stsd", &stsd), boxed(b"stco", &stco)].concat());
        let mdia = boxed(b"mdia", &[boxed(b"hdlr", &hdlr), boxed(b"minf", &stbl)].concat());
        let moov = boxed(b"moov", &boxed(b"trak", &mdia));
        [ftyp, mdat, moov].concat()
    }

    #[test]
    fn a_camera_s_timecode_track() {
        // 14:03:22:11 at 24 frames (23.976): 14·3600+3·60+22 = 50602 s → 1_214_448 + 11 frames
        let f = movie(50_602 * 24 + 11, 0, 24000, 1001, 24);
        let t = tmcd(&mut Cursor::new(f.clone())).unwrap().unwrap();
        assert_eq!(t.text(), "14:03:22:11");
        assert_eq!(t.fps(), 23.976);
        assert!(!t.drop);
        // the movie's own rate wins (as ffprobe's avg_frame_rate did)
        let src = Source::Path(std::env::temp_dir().join(format!("vault-tc-{}.mov", std::process::id())));
        std::fs::write(src.path().unwrap(), &f).unwrap();
        assert_eq!(start_timecode(&src, Some(23.976)).unwrap(), Some(("14:03:22:11".into(), 23.976)));
        std::fs::remove_file(src.path().unwrap()).ok();
        // 25 fps, ten o'clock
        let pal = movie(36_000 * 25, 0, 25, 1, 25);
        assert_eq!(tmcd(&mut Cursor::new(pal)).unwrap().unwrap().text(), "10:00:00:00");
        // no timecode track
        assert_eq!(tmcd(&mut Cursor::new(boxed(b"moov", &[]))).unwrap(), None);
    }

    #[test]
    fn drop_frame_counts_as_smpte_does() {
        // 29.97 DF: frame 1800 is 00:01:00;02 (00:01:00;00 and ;01 are dropped)
        assert_eq!(frames_to_timecode(1800, 30, true), "00:01:00;02");
        assert_eq!(frames_to_timecode(17982, 30, true), "00:10:00;00");
        assert_eq!(frames_to_timecode(1799, 30, true), "00:00:59;29");
        let t = tmcd(&mut Cursor::new(movie(1800, 1, 30000, 1001, 30))).unwrap().unwrap();
        assert!(t.drop);
        assert_eq!(t.text(), "00:01:00;02");
        assert_eq!(t.fps(), 29.97);
    }

    #[test]
    fn a_field_recorder_s_time_reference() {
        let mut wav = Vec::new();
        let mut fmt = vec![1u8, 0, 1, 0];
        fmt.extend_from_slice(&48000u32.to_le_bytes());
        fmt.extend_from_slice(&96000u32.to_le_bytes());
        fmt.extend_from_slice(&[2, 0, 16, 0]);
        let mut chunk_bext = vec![0u8; 338];
        chunk_bext.extend_from_slice(&((2_427_840_000u64 & 0xffff_ffff) as u32).to_le_bytes());
        chunk_bext.extend_from_slice(&((2_427_840_000u64 >> 32) as u32).to_le_bytes());
        chunk_bext.extend_from_slice(&[0u8; 256]);
        let chunk = |id: &[u8; 4], b: &[u8]| [id.as_slice(), &(b.len() as u32).to_le_bytes(), b].concat();
        let body = [b"WAVE".as_slice(), &chunk(b"fmt ", &fmt), &chunk(b"bext", &chunk_bext), &chunk(b"data", &[0u8; 4])].concat();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(body.len() as u32).to_le_bytes());
        wav.extend_from_slice(&body);
        assert_eq!(bext(&mut Cursor::new(wav.clone())).unwrap(), Some((2_427_840_000, 48000)));
        let p = std::env::temp_dir().join(format!("vault-tc-{}.wav", std::process::id()));
        std::fs::write(&p, &wav).unwrap();
        assert_eq!(start_timecode(&Source::Path(p.clone()), None).unwrap(), Some(("14:03:00:00".into(), 30.0)));
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn timecodes() {
        assert_eq!(timecode_of(50_602.5, 30.0), "14:03:22:15");
        assert_eq!(timecode_of(0.0, 25.0), "00:00:00:00");
    }

    /// A real camera-like file: ffmpeg writes a MOV with timecode 10:00:00:00 at 25 fps. Skipped without ffmpeg.
    #[test]
    fn ffmpeg_s_timecode_track() {
        let dir = std::env::temp_dir().join(format!("vault-tc-ff-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let movie = dir.join("take.mov");
        let made = std::process::Command::new("ffmpeg")
            .args(["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=25:duration=1", "-c:v", "mpeg4", "-timecode", "10:00:00:00"])
            .arg(&movie)
            .status();
        if !made.is_ok_and(|s| s.success()) {
            eprintln!("no ffmpeg here: skipped");
            return;
        }
        assert_eq!(start_timecode(&Source::Path(movie.clone()), Some(25.0)).unwrap(), Some(("10:00:00:00".into(), 25.0)));
        std::fs::remove_dir_all(&dir).ok();
    }
}
