//! Where a file's bytes are: a path on this disk, or a byte source read in place by range — the vault's blob store,
//! by hash, never copied out. Every reader in this crate takes a `Source`: a movie or a sound through AVFoundation
//! (`asset`, a `vaultblob://` URL answered by `blob_asset`), a still's bytes (`read_all`), a tar's members
//! (`reader`). A `&Path` still converts into one, so path callers stay as they were.

use std::{
    fmt,
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Context, Result};
use objc2::rc::Retained;
use objc2_av_foundation::AVURLAsset;
use objc2_foundation::{NSString, NSURL};

/// Bytes read by range, from any thread: the vault's blob store (the app implements it over iroh), a file, memory.
pub trait ByteSource: Send + Sync {
    /// how many bytes it holds
    fn len(&self) -> u64;
    /// Read from `offset` into `buf`: how many bytes were read (0 only at the end).
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<usize>;

    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Fill `buf` from `offset`, or fail with UnexpectedEof.
    fn read_exact_at(&self, mut offset: u64, mut buf: &mut [u8]) -> io::Result<()> {
        while !buf.is_empty() {
            match self.read_at(offset, buf) {
                Ok(0) => return Err(io::ErrorKind::UnexpectedEof.into()),
                Ok(n) => {
                    offset += n as u64;
                    buf = &mut buf[n..];
                }
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(e) => return Err(e),
            }
        }
        Ok(())
    }
}

impl ByteSource for Vec<u8> {
    fn len(&self) -> u64 {
        self.as_slice().len() as u64
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        let start = (offset as usize).min(self.as_slice().len());
        let n = buf.len().min(self.as_slice().len() - start);
        buf[..n].copy_from_slice(&self[start..start + n]);
        Ok(n)
    }
}

/// A file read by range (`pread`): what a path would be, as a byte source.
pub struct FileSource {
    file: File,
    len: u64,
}

impl FileSource {
    pub fn open(path: &Path) -> io::Result<Self> {
        let file = File::open(path)?;
        let len = file.metadata()?.len();
        Ok(Self { file, len })
    }
}

impl ByteSource for FileSource {
    fn len(&self) -> u64 {
        self.len
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        std::os::unix::fs::FileExt::read_at(&self.file, buf, offset)
    }
}

/// A file to read: on this disk, or a byte source (named, for its extension: AVFoundation tells a movie by its type).
#[derive(Clone)]
pub enum Source {
    Path(PathBuf),
    /// `name`: e.g. "<hash>.mov" — its extension says what the bytes are
    Blob { bytes: Arc<dyn ByteSource>, name: String },
}

impl fmt::Debug for Source {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Source::Path(p) => f.debug_tuple("Path").field(p).finish(),
            Source::Blob { bytes, name } => f.debug_struct("Blob").field("name", name).field("len", &bytes.len()).finish(),
        }
    }
}

impl fmt::Display for Source {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Source::Path(p) => write!(f, "{}", p.display()),
            Source::Blob { name, .. } => write!(f, "vaultblob://{name}"),
        }
    }
}

/// No file yet (an empty path).
impl Default for Source {
    fn default() -> Self {
        Source::Path(PathBuf::new())
    }
}

impl From<&Path> for Source {
    fn from(p: &Path) -> Self {
        Source::Path(p.to_path_buf())
    }
}
impl From<&PathBuf> for Source {
    fn from(p: &PathBuf) -> Self {
        Source::Path(p.clone())
    }
}
impl From<PathBuf> for Source {
    fn from(p: PathBuf) -> Self {
        Source::Path(p)
    }
}
impl From<&Source> for Source {
    fn from(s: &Source) -> Self {
        s.clone()
    }
}

impl Source {
    /// Bytes read in place, named `name` (its extension tells their kind).
    pub fn blob(bytes: Arc<dyn ByteSource>, name: impl Into<String>) -> Self {
        Source::Blob { bytes, name: name.into() }
    }

    /// The file on this disk, when it is one.
    pub fn path(&self) -> Option<&Path> {
        match self {
            Source::Path(p) => Some(p),
            Source::Blob { .. } => None,
        }
    }

    /// Its extension, lower case ("" without one).
    pub fn ext(&self) -> String {
        let p = match self {
            Source::Path(p) => p.as_path(),
            Source::Blob { name, .. } => Path::new(name),
        };
        p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
    }

    /// How many bytes.
    pub fn len(&self) -> io::Result<u64> {
        match self {
            Source::Path(p) => Ok(std::fs::metadata(p)?.len()),
            Source::Blob { bytes, .. } => Ok(bytes.len()),
        }
    }

    pub fn is_empty(&self) -> io::Result<bool> {
        Ok(self.len()? == 0)
    }

    /// The AVFoundation asset: a file URL, or a `vaultblob://` URL whose bytes the resource loader reads by range.
    pub fn asset(&self) -> Result<Retained<AVURLAsset>> {
        match self {
            Source::Path(p) => {
                let p = std::fs::canonicalize(p).with_context(|| format!("{} is not there", p.display()))?;
                // SAFETY: a file URL we make; AVURLAsset only reads it.
                Ok(unsafe { AVURLAsset::URLAssetWithURL_options(&NSURL::fileURLWithPath(&NSString::from_str(&p.to_string_lossy())), None) })
            }
            Source::Blob { bytes, name } => crate::blob_asset::blob_asset(bytes.clone(), name),
        }
    }

    /// All of it in memory (a still: Core Image reads it from bytes).
    pub fn read_all(&self) -> io::Result<Vec<u8>> {
        match self {
            Source::Path(p) => std::fs::read(p),
            Source::Blob { bytes, .. } => {
                let mut buf = vec![0u8; bytes.len() as usize];
                bytes.read_exact_at(0, &mut buf)?;
                Ok(buf)
            }
        }
    }

    /// Its first `n` bytes at most (a header).
    pub fn head(&self, n: usize) -> io::Result<Vec<u8>> {
        let mut r = self.reader()?;
        let mut b = Vec::new();
        (&mut r).take(n as u64).read_to_end(&mut b)?;
        Ok(b)
    }

    /// A reader with a position (a tar's members, an MP4's boxes).
    pub fn reader(&self) -> io::Result<SourceReader> {
        Ok(match self {
            Source::Path(p) => SourceReader::File(File::open(p)?),
            Source::Blob { bytes, .. } => SourceReader::Blob { bytes: bytes.clone(), at: 0 },
        })
    }
}

/// `Read + Seek` over a source.
pub enum SourceReader {
    File(File),
    Blob { bytes: Arc<dyn ByteSource>, at: u64 },
}

impl SourceReader {
    pub fn len(&mut self) -> io::Result<u64> {
        match self {
            SourceReader::File(f) => Ok(f.metadata()?.len()),
            SourceReader::Blob { bytes, .. } => Ok(bytes.len()),
        }
    }
}

impl Read for SourceReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            SourceReader::File(f) => f.read(buf),
            SourceReader::Blob { bytes, at } => {
                let n = bytes.read_at(*at, buf)?;
                *at += n as u64;
                Ok(n)
            }
        }
    }
}

impl Seek for SourceReader {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        match self {
            SourceReader::File(f) => f.seek(pos),
            SourceReader::Blob { bytes, at } => {
                let to = match pos {
                    SeekFrom::Start(o) => Some(o),
                    SeekFrom::End(d) => bytes.len().checked_add_signed(d),
                    SeekFrom::Current(d) => at.checked_add_signed(d),
                };
                *at = to.ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "seek before the start"))?;
                Ok(*at)
            }
        }
    }
}
