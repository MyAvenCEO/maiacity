//! The file registry (`Aven.Runtime.Registry`, aven/runtimes/README.md, "The file registry: one source of truth").
//!
//! One entry per file type, and one function, [`decide_file`], from a file's first bytes, its size and what its sender
//! claims to its decision: what it really is, how it shows, within which limits, and how the Service Worker serves it.
//! The bytes decide; a claim only chooses among the text formats the bytes can't tell apart, and never makes a file
//! shown by the browser. No script is ever shown: HTML and XML download, SVG goes through its runtime. Over a limit is
//! a download.
//!
//! Every function here is the Lean definition of the same name, and the tests replay the model's vectors
//! (`spec/vectors/registry.json`, `table.json`). No allocation, no dependencies: it builds for wasm32.

#![no_std]
#![forbid(unsafe_code)]

/// The first bytes the registry reads: the first 64 KiB of the file's first chunk.
pub const HEAD_MAX: usize = 65536;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileType {
    Png,
    Jpeg,
    Gif,
    Webp,
    Avif,
    Bmp,
    Mp4,
    Mov,
    Webm,
    Ogg,
    Mp3,
    Wav,
    Flac,
    Pdf,
    Svg,
    Html,
    Xml,
    Json,
    Markdown,
    Csv,
    Tsv,
    Text,
    Unknown,
}

impl FileType {
    /// The media type the registry serves a file as: the sniffed one, never the claimed one.
    pub fn mime(self) -> &'static str {
        match self {
            FileType::Png => "image/png",
            FileType::Jpeg => "image/jpeg",
            FileType::Gif => "image/gif",
            FileType::Webp => "image/webp",
            FileType::Avif => "image/avif",
            FileType::Bmp => "image/bmp",
            FileType::Mp4 => "video/mp4",
            FileType::Mov => "video/quicktime",
            FileType::Webm => "video/webm",
            FileType::Ogg => "audio/ogg",
            FileType::Mp3 => "audio/mpeg",
            FileType::Wav => "audio/wav",
            FileType::Flac => "audio/flac",
            FileType::Pdf => "application/pdf",
            FileType::Svg => "image/svg+xml",
            FileType::Html => "text/html",
            FileType::Xml => "application/xml",
            FileType::Json => "application/json",
            FileType::Markdown => "text/markdown",
            FileType::Csv => "text/csv",
            FileType::Tsv => "text/tab-separated-values",
            FileType::Text => "text/plain",
            FileType::Unknown => "application/octet-stream",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            FileType::Png => "png",
            FileType::Jpeg => "jpeg",
            FileType::Gif => "gif",
            FileType::Webp => "webp",
            FileType::Avif => "avif",
            FileType::Bmp => "bmp",
            FileType::Mp4 => "mp4",
            FileType::Mov => "mov",
            FileType::Webm => "webm",
            FileType::Ogg => "ogg",
            FileType::Mp3 => "mp3",
            FileType::Wav => "wav",
            FileType::Flac => "flac",
            FileType::Pdf => "pdf",
            FileType::Svg => "svg",
            FileType::Html => "html",
            FileType::Xml => "xml",
            FileType::Json => "json",
            FileType::Markdown => "markdown",
            FileType::Csv => "csv",
            FileType::Tsv => "tsv",
            FileType::Text => "text",
            FileType::Unknown => "unknown",
        }
    }
}

/// A signature: bytes at offsets, all of which must be there.
pub type Sig = &'static [(usize, &'static [u8])];

/// `ftyp` boxes: an ISO base media file, its major brand at 8. The box is small, so its size's first byte is 0.
macro_rules! ftyp {
    ($brand:expr) => {
        &[(0, &[0x00]), (4, b"ftyp"), (8, $brand)]
    };
}

/// Every binary type's signatures (`signatures`). No two types' signatures can match the same bytes, so the first
/// that matches names the type.
pub const SIGNATURES: &[(FileType, Sig)] = &[
    (
        FileType::Png,
        &[(0, &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
    ),
    (FileType::Jpeg, &[(0, &[0xFF, 0xD8, 0xFF])]),
    (FileType::Gif, &[(0, b"GIF87a")]),
    (FileType::Gif, &[(0, b"GIF89a")]),
    (FileType::Webp, &[(0, b"RIFF"), (8, b"WEBP")]),
    (FileType::Wav, &[(0, b"RIFF"), (8, b"WAVE")]),
    (FileType::Bmp, &[(0, b"BM")]),
    (FileType::Avif, ftyp!(b"avif")),
    (FileType::Avif, ftyp!(b"avis")),
    (FileType::Mp4, ftyp!(b"isom")),
    (FileType::Mp4, ftyp!(b"iso2")),
    (FileType::Mp4, ftyp!(b"mp41")),
    (FileType::Mp4, ftyp!(b"mp42")),
    (FileType::Mp4, ftyp!(b"M4V ")),
    (FileType::Mp4, ftyp!(b"M4A ")),
    (FileType::Mp4, ftyp!(b"dash")),
    (FileType::Mov, ftyp!(b"qt  ")),
    (FileType::Webm, &[(0, &[0x1A, 0x45, 0xDF, 0xA3])]),
    (FileType::Ogg, &[(0, b"OggS")]),
    (FileType::Mp3, &[(0, b"ID3")]),
    (FileType::Mp3, &[(0, &[0xFF, 0xFB])]),
    (FileType::Mp3, &[(0, &[0xFF, 0xF3])]),
    (FileType::Mp3, &[(0, &[0xFF, 0xF2])]),
    (FileType::Flac, &[(0, b"fLaC")]),
    (FileType::Pdf, &[(0, b"%PDF-")]),
];

fn sig_matches(s: Sig, h: &[u8]) -> bool {
    s.iter()
        .all(|&(o, b)| h.get(o..).is_some_and(|rest| rest.starts_with(b)))
}

/// The first binary type whose signature matches (`sniffBinary`).
pub fn sniff_binary(h: &[u8]) -> Option<FileType> {
    SIGNATURES
        .iter()
        .find(|(_, s)| sig_matches(s, h))
        .map(|&(t, _)| t)
}

fn is_cont(b: u8) -> bool {
    b & 0xC0 == 0x80
}

/// Valid UTF-8 without NUL (`textHead`). A sequence cut by the end of the head is accepted, since the head may end
/// mid-character.
pub fn text_head(mut h: &[u8]) -> bool {
    while let Some((&b, rest)) = h.split_first() {
        if b == 0 {
            return false;
        }
        if b < 0x80 {
            h = rest;
            continue;
        }
        let n = if (0xC2..=0xDF).contains(&b) {
            1
        } else if b & 0xF0 == 0xE0 {
            2
        } else if (0xF0..=0xF4).contains(&b) {
            3
        } else {
            return false;
        };
        if !rest.iter().take(n).all(|&c| is_cont(c)) {
            return false;
        }
        if rest.len() < n {
            return true;
        }
        h = &rest[n..];
    }
    true
}

fn is_space(b: u8) -> bool {
    matches!(b, 0x20 | 0x09 | 0x0A | 0x0D | 0x0C)
}

/// Whether `h` starts with `p`, ASCII letters compared in lower case (`p` is lower case).
fn starts_lower(h: &[u8], p: &[u8]) -> bool {
    h.len() >= p.len() && h.iter().zip(p).all(|(&a, &b)| a.to_ascii_lowercase() == b)
}

/// After the first `m`, or nothing when there is none.
fn after_mark<'a>(m: &[u8], h: &'a [u8]) -> &'a [u8] {
    match h.windows(m.len()).position(|w| w == m) {
        Some(i) => &h[i + m.len()..],
        None => &[],
    }
}

/// The bytes after a BOM, white space, comments and an XML prolog: where a markup document's root starts, and
/// whether there was a prolog (`skipLead`).
fn skip_lead(fuel: usize, mut h: &[u8]) -> (&[u8], bool) {
    let mut prolog = false;
    for _ in 0..fuel {
        let mut x = h.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(h);
        while let Some((&b, rest)) = x.split_first() {
            if !is_space(b) {
                break;
            }
            x = rest;
        }
        if starts_lower(x, b"<?xml") {
            prolog = true;
            h = after_mark(b"?>", x);
        } else if x.starts_with(b"<!--") {
            h = after_mark(b"-->", x);
        } else {
            return (x, prolog);
        }
    }
    (h, prolog)
}

/// A tag at the start, followed by a space, `>` or `/`.
fn starts_tag(tag: &[u8], h: &[u8]) -> bool {
    starts_lower(h, tag)
        && h.get(tag.len())
            .is_some_and(|&c| is_space(c) || c == b'>' || c == b'/')
}

/// Bytes the browser would read as HTML (WHATWG's sniffing table, at the root).
fn html_root(h: &[u8]) -> bool {
    const TAGS: [&[u8]; 18] = [
        b"<html",
        b"<head",
        b"<body",
        b"<script",
        b"<iframe",
        b"<frameset",
        b"<object",
        b"<embed",
        b"<style",
        b"<title",
        b"<table",
        b"<div",
        b"<a",
        b"<p",
        b"<br",
        b"<h1",
        b"<font",
        b"<b",
    ];
    starts_lower(h, b"<!doctype html") || TAGS.iter().any(|t| starts_tag(t, h))
}

/// What a sender says: a media type and a file name, either missing.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Claim<'a> {
    pub r#type: Option<&'a str>,
    pub name: Option<&'a str>,
}

/// Trimmed of Lean's white space (`String.trimAscii`): space, tab, CR and LF.
fn trim_ascii(s: &str) -> &str {
    s.trim_matches([' ', '\t', '\r', '\n'])
}

/// Whether a claimed type's essence (before any `;`, trimmed, any case) is `e`.
fn essence_is(t: &str, e: &str) -> bool {
    trim_ascii(t.split(';').next().unwrap_or("")).eq_ignore_ascii_case(e)
}

impl Claim<'_> {
    fn ext_is(&self, e: &str) -> bool {
        self.name
            .and_then(|n| n.rsplit_once('.'))
            .is_some_and(|(_, x)| x.eq_ignore_ascii_case(e))
    }

    /// What a claim chooses among the text formats (`Claim.text`). Only these: a claim never names a binary type,
    /// SVG or a script.
    pub fn text(&self) -> FileType {
        if let Some(t) = self.r#type {
            let is = |e: &str| essence_is(t, e);
            let essence = trim_ascii(t.split(';').next().unwrap_or(""));
            if is("text/html") || is("application/xhtml+xml") {
                return FileType::Html;
            } else if is("image/svg+xml") || is("application/xml") || is("text/xml") {
                return FileType::Xml;
            } else if is("text/markdown") || is("text/x-markdown") {
                return FileType::Markdown;
            } else if is("text/csv") {
                return FileType::Csv;
            } else if is("text/tab-separated-values") {
                return FileType::Tsv;
            } else if is("application/json") || ends_with_ignore_case(essence, "+json") {
                return FileType::Json;
            } else if !essence.is_empty() && !is("text/plain") && !is("application/octet-stream") {
                return FileType::Text;
            }
        }
        let ext = |e: &str| self.ext_is(e);
        if ext("md") || ext("markdown") {
            FileType::Markdown
        } else if ext("csv") {
            FileType::Csv
        } else if ext("tsv") {
            FileType::Tsv
        } else if ext("json") {
            FileType::Json
        } else if ext("html") || ext("htm") || ext("xhtml") {
            FileType::Html
        } else if ext("svg") || ext("xml") {
            FileType::Xml
        } else {
            FileType::Text
        }
    }
}

fn ends_with_ignore_case(s: &str, e: &str) -> bool {
    s.len() >= e.len() && s.as_bytes()[s.len() - e.len()..].eq_ignore_ascii_case(e.as_bytes())
}

/// What the file really is (`sniff`).
pub fn sniff(h: &[u8], c: &Claim) -> FileType {
    if let Some(t) = sniff_binary(h) {
        return t;
    }
    if !text_head(h) {
        return FileType::Unknown;
    }
    let (root, prolog) = skip_lead(8, h);
    if starts_tag(b"<svg", root) {
        FileType::Svg
    } else if html_root(root) {
        FileType::Html
    } else if prolog {
        FileType::Xml
    } else {
        c.text()
    }
}

// Dimensions, read from a native image's header

fn at8(h: &[u8], i: usize) -> Option<u64> {
    h.get(i).map(|&b| b as u64)
}

fn be16(h: &[u8], i: usize) -> Option<u64> {
    Some(at8(h, i)? * 256 + at8(h, i.checked_add(1)?)?)
}

fn le16(h: &[u8], i: usize) -> Option<u64> {
    Some(at8(h, i)? + at8(h, i.checked_add(1)?)? * 256)
}

fn be32(h: &[u8], i: usize) -> Option<u64> {
    Some(be16(h, i)? * 65536 + be16(h, i.checked_add(2)?)?)
}

fn le24(h: &[u8], i: usize) -> Option<u64> {
    Some(le16(h, i)? + at8(h, i.checked_add(2)?)? * 65536)
}

fn le32(h: &[u8], i: usize) -> Option<u64> {
    Some(le16(h, i)? + le16(h, i.checked_add(2)?)? * 65536)
}

/// A signed 32-bit number's size: BMP's height is negative when its rows run top down.
fn abs32(n: u64) -> u64 {
    if n >= 1 << 31 { (1 << 32) - n } else { n }
}

/// JPEG's dimensions, from its first start-of-frame segment (`jpegDims`, with the head's length as its fuel).
fn jpeg_dims(h: &[u8]) -> Option<(u64, u64)> {
    let mut i: usize = 2;
    for _ in 0..h.len() {
        if at8(h, i)? != 0xFF {
            return None;
        }
        let m = at8(h, i + 1)?;
        if m == 0xFF {
            i += 1;
        } else if m == 0xD8 || m == 0x01 || (0xD0..=0xD7).contains(&m) {
            i += 2;
        } else if (0xC0..=0xCF).contains(&m) && m != 0xC4 && m != 0xC8 && m != 0xCC {
            return Some((be16(h, i + 7)?, be16(h, i + 5)?));
        } else {
            i = i.checked_add(2)?.checked_add(be16(h, i + 2)? as usize)?;
        }
    }
    None
}

/// The largest width and height of every `ispe` box in an AVIF's head (`ispes`, folded).
fn avif_dims(h: &[u8]) -> Option<(u64, u64)> {
    let mut best: Option<(u64, u64)> = None;
    let mut i = 0;
    while i + 16 <= h.len() {
        if h[i..].starts_with(b"ispe")
            && let (Some(w), Some(ht)) = (be32(h, i + 8), be32(h, i + 12))
        {
            best = Some(match best {
                Some((w0, h0)) => (w.max(w0), ht.max(h0)),
                None => (w, ht),
            });
        }
        i += 1;
    }
    best
}

/// A native image's width and height, from its header; `None` when the head doesn't say (`dims`).
pub fn dims(t: FileType, h: &[u8]) -> Option<(u64, u64)> {
    match t {
        FileType::Png => {
            if h.get(12..).is_some_and(|r| r.starts_with(b"IHDR")) {
                Some((be32(h, 16)?, be32(h, 20)?))
            } else {
                None
            }
        }
        FileType::Gif => Some((le16(h, 6)?, le16(h, 8)?)),
        FileType::Bmp => Some((abs32(le32(h, 18)?), abs32(le32(h, 22)?))),
        FileType::Jpeg => jpeg_dims(h),
        FileType::Webp => {
            let chunk = h.get(12..16.min(h.len())).unwrap_or(&[]);
            if chunk == b"VP8X" {
                Some((le24(h, 24)? + 1, le24(h, 27)? + 1))
            } else if chunk == b"VP8 " {
                Some((le16(h, 26)? % 16384, le16(h, 28)? % 16384))
            } else if chunk == b"VP8L" {
                let (b0, b1, b2, b3) = (at8(h, 21)?, at8(h, 22)?, at8(h, 23)?, at8(h, 24)?);
                Some((
                    (b1 % 64) * 256 + b0 + 1,
                    (b3 % 16) * 1024 + b2 * 4 + b1 / 64 + 1,
                ))
            } else {
                None
            }
        }
        FileType::Avif => avif_dims(h),
        _ => None,
    }
}

// Entries and decisions

/// A browser element that shows a file natively.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Element {
    Img,
    Audio,
    Video,
}

/// What a file runtime gives back.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Output {
    Tree,
    Pixels,
    Table,
}

/// A runtime's fuel, memory and output limits, as the contract has them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub fuel: u64,
    pub memory: u64,
    pub output: u64,
}

/// How a file shows: its mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Native(Element),
    Frame,
    Runtime(&'static str, Output, Limits),
    Download,
}

impl Mode {
    /// Shown by the browser itself: natively or in a frame.
    pub fn shown(self) -> bool {
        matches!(self, Mode::Native(_) | Mode::Frame)
    }
}

pub const MIB: u64 = 1048576;

/// One type's entry: how it shows and the most bytes it may have; for an image, the most pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Entry {
    pub r#type: FileType,
    pub mode: Mode,
    pub bytes: u64,
    pub pixels: u64,
}

/// Fuel, memory and output for a runtime that parses text into a tree or a table.
pub const TEXT_LIMITS: Limits = Limits {
    fuel: 2_000_000_000,
    memory: 256 * MIB,
    output: 8 * MIB,
};

const fn e(t: FileType, mode: Mode, bytes: u64, pixels: u64) -> Entry {
    Entry {
        r#type: t,
        mode,
        bytes,
        pixels,
    }
}

const IMG: Mode = Mode::Native(Element::Img);
const VIDEO: Mode = Mode::Native(Element::Video);
const AUDIO: Mode = Mode::Native(Element::Audio);

/// The registry, one entry per type.
pub const REGISTRY: &[Entry] = &[
    e(FileType::Png, IMG, 64 * MIB, 64 * MIB),
    e(FileType::Jpeg, IMG, 64 * MIB, 64 * MIB),
    e(FileType::Gif, IMG, 64 * MIB, 64 * MIB),
    e(FileType::Webp, IMG, 64 * MIB, 64 * MIB),
    e(FileType::Avif, IMG, 64 * MIB, 64 * MIB),
    e(FileType::Bmp, IMG, 64 * MIB, 64 * MIB),
    e(FileType::Mp4, VIDEO, 65536 * MIB, 0),
    e(FileType::Mov, VIDEO, 65536 * MIB, 0),
    e(FileType::Webm, VIDEO, 65536 * MIB, 0),
    e(FileType::Ogg, AUDIO, 4096 * MIB, 0),
    e(FileType::Mp3, AUDIO, 4096 * MIB, 0),
    e(FileType::Wav, AUDIO, 4096 * MIB, 0),
    e(FileType::Flac, AUDIO, 4096 * MIB, 0),
    e(FileType::Pdf, Mode::Frame, 256 * MIB, 0),
    e(
        FileType::Svg,
        Mode::Runtime(
            "svg-runtime",
            Output::Pixels,
            Limits {
                fuel: 4_000_000_000,
                memory: 256 * MIB,
                output: 64 * MIB,
            },
        ),
        4 * MIB,
        16 * MIB,
    ),
    e(FileType::Html, Mode::Download, 0, 0),
    e(FileType::Xml, Mode::Download, 0, 0),
    e(
        FileType::Json,
        Mode::Runtime("json-runtime", Output::Tree, TEXT_LIMITS),
        4 * MIB,
        0,
    ),
    e(
        FileType::Markdown,
        Mode::Runtime("markdown-runtime", Output::Tree, TEXT_LIMITS),
        MIB,
        0,
    ),
    e(
        FileType::Csv,
        Mode::Runtime("csv-runtime", Output::Table, TEXT_LIMITS),
        64 * MIB,
        0,
    ),
    e(
        FileType::Tsv,
        Mode::Runtime("csv-runtime", Output::Table, TEXT_LIMITS),
        64 * MIB,
        0,
    ),
    e(
        FileType::Text,
        Mode::Runtime("text-runtime", Output::Tree, TEXT_LIMITS),
        16 * MIB,
        0,
    ),
    e(FileType::Unknown, Mode::Download, 0, 0),
];

/// A type's entry; a type the registry doesn't list downloads.
pub fn entry(t: FileType) -> Entry {
    REGISTRY
        .iter()
        .copied()
        .find(|x| x.r#type == t)
        .unwrap_or(e(t, Mode::Download, 0, 0))
}

/// The type a claimed media type names, by its essence; `Unknown` for any other (`FileType.ofMime`). Only for what a
/// claim may label (the chat's card before the bytes are read): a decision never takes it, since the bytes decide.
pub fn of_mime(m: &str) -> FileType {
    REGISTRY
        .iter()
        .find(|x| essence_is(m, x.r#type.mime()))
        .map_or(FileType::Unknown, |x| x.r#type)
}

/// Where the registry stands: whether the files origin runs file runtimes yet (decision 3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stage {
    pub runtimes: bool,
}

/// How the Service Worker serves a file: inline as its sniffed type, only to the runtime's worker, or as an
/// attachment.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Serve {
    Inline(&'static str),
    Worker,
    Attachment,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Decision {
    pub r#type: FileType,
    pub mode: Mode,
    pub serve: Serve,
}

fn serve_for(t: FileType, m: Mode) -> Serve {
    match m {
        Mode::Native(_) | Mode::Frame => Serve::Inline(t.mime()),
        Mode::Runtime(..) => Serve::Worker,
        Mode::Download => Serve::Attachment,
    }
}

/// A native image is within its pixel limit, by the dimensions its own header declares.
fn img_ok(t: FileType, h: &[u8]) -> bool {
    match dims(t, h) {
        Some((w, ht)) => w > 0 && ht > 0 && w.checked_mul(ht).is_some_and(|p| p <= entry(t).pixels),
        None => false,
    }
}

/// An entry's mode, held to the stage and, for an image, to its dimensions.
fn gate(st: Stage, t: FileType, h: &[u8], m: Mode) -> Mode {
    match m {
        Mode::Native(Element::Img) if !img_ok(t, h) => Mode::Download,
        Mode::Runtime(..) if !st.runtimes => Mode::Download,
        m => m,
    }
}

/// How a file shows, within its entry's limits and the stage.
fn mode_for(st: Stage, t: FileType, h: &[u8], size: u64) -> Mode {
    if size > entry(t).bytes {
        Mode::Download
    } else {
        gate(st, t, h, entry(t).mode)
    }
}

/// The registry's one function: a file's head (only its first `HEAD_MAX` bytes are read), its size and its claim to
/// its decision.
pub fn decide_file(st: Stage, h: &[u8], size: u64, c: &Claim) -> Decision {
    let h = &h[..h.len().min(HEAD_MAX)];
    let t = sniff(h, c);
    let mode = mode_for(st, t, h, size);
    Decision {
        r#type: t,
        mode,
        serve: serve_for(t, mode),
    }
}

/// The sandbox every answer for a file carries.
pub const CSP: &str =
    "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; object-src 'self'";

/// The headers of every answer the Service Worker gives for a file.
pub fn headers(d: &Decision) -> [(&'static str, &'static str); 5] {
    let (ty, disposition) = match d.serve {
        Serve::Inline(m) => (m, "inline"),
        _ => ("application/octet-stream", "attachment"),
    };
    [
        ("Content-Type", ty),
        ("Content-Disposition", disposition),
        ("X-Content-Type-Options", "nosniff"),
        ("Content-Security-Policy", CSP),
        ("Cross-Origin-Resource-Policy", "same-origin"),
    ]
}
