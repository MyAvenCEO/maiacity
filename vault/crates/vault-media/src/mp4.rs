//! Two finishing touches on an MP4 that AVFoundation will not do for us:
//!
//! - a comment: AVAssetWriter drops asset metadata in MPEG-4 files, so the `maiacity:color=<profile>` tag
//!   (read by game/film/color.js `detect`) goes in as a QuickTime user-data box, `moov/udta/©cmt`, which ffmpeg,
//!   ffprobe and our own probe read as the file's comment;
//! - faststart: the index (`moov`) moves in front of the media (`mdat`) so a player can start before the whole file
//!   has arrived — every chunk offset in `stco`/`co64` is shifted by what now sits in front of the media.
//!
//! The input must have its `moov` after the media (AVAssetWriter with network optimisation off). The media is copied
//! in blocks, never held in memory.

use std::{
    fs::File,
    io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write},
    path::Path,
};

use anyhow::{Context, Result, bail};

struct TopBox {
    kind: [u8; 4],
    start: u64,
    size: u64,
}

fn top_boxes<F: Read + Seek>(f: &mut F) -> Result<Vec<TopBox>> {
    let len = f.seek(SeekFrom::End(0))?;
    let mut out = Vec::new();
    let mut at = 0u64;
    while at + 8 <= len {
        f.seek(SeekFrom::Start(at))?;
        let mut head = [0u8; 16];
        f.read_exact(&mut head[..8])?;
        let mut size = u32::from_be_bytes(head[0..4].try_into()?) as u64;
        let kind: [u8; 4] = head[4..8].try_into()?;
        if size == 1 {
            f.read_exact(&mut head[8..16])?;
            size = u64::from_be_bytes(head[8..16].try_into()?);
        } else if size == 0 {
            size = len - at;
        }
        if size < 8 {
            bail!("a broken box at {at}");
        }
        out.push(TopBox { kind, start: at, size });
        at += size;
    }
    Ok(out)
}

const CONTAINERS: [&[u8; 4]; 6] = [b"moov", b"trak", b"mdia", b"minf", b"stbl", b"edts"];

/// Shift every chunk offset inside `moov` (its box bytes, header included) by `delta`.
fn shift_offsets(moov: &mut [u8], delta: u64) -> Result<()> {
    fn walk(buf: &mut [u8], delta: u64) -> Result<()> {
        let mut at = 0usize;
        while at + 8 <= buf.len() {
            let size = u32::from_be_bytes(buf[at..at + 4].try_into()?) as usize;
            let kind: [u8; 4] = buf[at + 4..at + 8].try_into()?;
            if size < 8 || at + size > buf.len() {
                bail!("a broken box inside moov");
            }
            let body = &mut buf[at + 8..at + size];
            if CONTAINERS.iter().any(|c| **c == kind) {
                walk(body, delta)?;
            } else if &kind == b"stco" {
                let n = u32::from_be_bytes(body[4..8].try_into()?) as usize;
                for i in 0..n {
                    let p = 8 + i * 4;
                    let v = u32::from_be_bytes(body[p..p + 4].try_into()?) as u64 + delta;
                    let v: u32 = v.try_into().context("an offset grew past 4 GB in stco")?;
                    body[p..p + 4].copy_from_slice(&v.to_be_bytes());
                }
            } else if &kind == b"co64" {
                let n = u32::from_be_bytes(body[4..8].try_into()?) as usize;
                for i in 0..n {
                    let p = 8 + i * 8;
                    let v = u64::from_be_bytes(body[p..p + 8].try_into()?) + delta;
                    body[p..p + 8].copy_from_slice(&v.to_be_bytes());
                }
            }
            at += size;
        }
        Ok(())
    }
    walk(&mut moov[8..], delta)
}

/// `udta` with one QuickTime text atom `©cmt`.
fn udta_comment(text: &str) -> Vec<u8> {
    let t = text.as_bytes();
    let cmt_size = 8 + 4 + t.len();
    let mut b = Vec::with_capacity(8 + cmt_size);
    b.extend_from_slice(&((8 + cmt_size) as u32).to_be_bytes());
    b.extend_from_slice(b"udta");
    b.extend_from_slice(&(cmt_size as u32).to_be_bytes());
    b.extend_from_slice(&[0xA9, b'c', b'm', b't']);
    b.extend_from_slice(&(t.len() as u16).to_be_bytes());
    b.extend_from_slice(&0x55C4u16.to_be_bytes()); // language: "und"
    b.extend_from_slice(t);
    b
}

/// The file's own comment (`moov/udta/©cmt`), if it has one — e.g. "maiacity:color=apple-log-2".
pub fn read_comment(path: &Path) -> Option<String> {
    read_comment_of(&crate::Source::from(path))
}

/// The comment of a file on disk or read in place.
pub fn read_comment_of(src: &crate::Source) -> Option<String> {
    let mut f = src.reader().ok()?;
    let boxes = top_boxes(&mut f).ok()?;
    let moov = boxes.iter().find(|b| &b.kind == b"moov")?;
    if moov.size > 512 * 1024 * 1024 {
        return None;
    }
    let mut buf = vec![0u8; moov.size as usize];
    f.seek(SeekFrom::Start(moov.start)).ok()?;
    f.read_exact(&mut buf).ok()?;
    // children of moov → udta → ©cmt
    let child = |b: &[u8], want: &[u8; 4]| -> Option<(usize, usize)> {
        let mut at = 0;
        while at + 8 <= b.len() {
            let size = u32::from_be_bytes(b[at..at + 4].try_into().ok()?) as usize;
            if size < 8 || at + size > b.len() {
                return None;
            }
            if &b[at + 4..at + 8] == want {
                return Some((at + 8, at + size));
            }
            at += size;
        }
        None
    };
    let (us, ue) = child(&buf[8..], b"udta").map(|(s, e)| (s + 8, e + 8))?;
    let (cs, ce) = child(&buf[us..ue], &[0xA9, b'c', b'm', b't']).map(|(s, e)| (s + us, e + us))?;
    let body = &buf[cs..ce];
    let len = u16::from_be_bytes(body.get(0..2)?.try_into().ok()?) as usize;
    String::from_utf8(body.get(4..4 + len)?.to_vec()).ok()
}

/// Rewrite `path` in place: `moov` (with the comment added) in front of the media.
pub fn finish(path: &Path, comment: &str) -> Result<()> {
    let mut f = File::open(path)?;
    let boxes = top_boxes(&mut f)?;
    let moov_i = boxes.iter().position(|b| &b.kind == b"moov").context("no moov")?;
    let first_mdat = boxes.iter().position(|b| &b.kind == b"mdat").context("no mdat")?;
    if moov_i < first_mdat {
        bail!("moov is already in front; write with network optimisation off");
    }
    let moov_box = &boxes[moov_i];
    if moov_box.size > 512 * 1024 * 1024 {
        bail!("moov too large to rewrite in memory");
    }
    let mut moov = vec![0u8; moov_box.size as usize];
    f.seek(SeekFrom::Start(moov_box.start))?;
    f.read_exact(&mut moov)?;
    if u32::from_be_bytes(moov[0..4].try_into()?) == 1 {
        bail!("a 64-bit moov header is not handled");
    }

    // the comment, appended as the last child of moov
    moov.extend_from_slice(&udta_comment(comment));
    let new_size = moov.len() as u32;
    moov[0..4].copy_from_slice(&new_size.to_be_bytes());

    // everything before the first mdat stays in front; moov goes right after it, so the media moves by moov's size
    shift_offsets(&mut moov, new_size as u64)?;

    let tmp = path.with_extension("faststart.part");
    {
        let mut out = BufWriter::with_capacity(8 << 20, File::create(&tmp)?);
        let mut src = BufReader::with_capacity(8 << 20, File::open(path)?);
        let copy = |src: &mut BufReader<File>, out: &mut BufWriter<File>, b: &TopBox| -> Result<()> {
            src.seek(SeekFrom::Start(b.start))?;
            std::io::copy(&mut src.by_ref().take(b.size), out)?;
            Ok(())
        };
        for b in &boxes[..first_mdat] {
            copy(&mut src, &mut out, b)?;
        }
        out.write_all(&moov)?;
        for (i, b) in boxes.iter().enumerate().skip(first_mdat) {
            if i != moov_i {
                copy(&mut src, &mut out, b)?;
            }
        }
        out.flush()?;
        out.get_ref().sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}
