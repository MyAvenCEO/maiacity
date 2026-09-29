//! Hashing files the way the vault names them: plain BLAKE3 of the bytes — the same value as iroh's `Hash`, `b3sum`
//! or noble-hashes.

use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
};

use anyhow::{Context, Result};

/// Big reads keep a card or an SSD streaming; BLAKE3 spreads each buffer over the cores.
const BUF: usize = 16 * 1024 * 1024;

/// Copy `src` to `dst` while hashing what was read from `src`: the card is read exactly once, and the hash is of the
/// bytes as they came off it. `dst` is flushed to the disk before this returns.
pub fn copy_hashing(src: &Path, dst: &Path) -> Result<(blake3::Hash, u64)> {
    copy_hashing_with(src, dst, &mut |_| {})
}

/// `copy_hashing`, telling `read` the bytes read so far after every buffer.
pub fn copy_hashing_with(src: &Path, dst: &Path, read: &mut dyn FnMut(u64)) -> Result<(blake3::Hash, u64)> {
    let mut from = File::open(src).with_context(|| format!("open {}", src.display()))?;
    let mut to = File::create(dst).with_context(|| format!("create {}", dst.display()))?;
    uncached(&from);
    uncached(&to);
    let mut hasher = blake3::Hasher::new();
    let mut buf = vec![0u8; BUF];
    let mut size = 0u64;
    loop {
        let n = from.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update_rayon(&buf[..n]);
        to.write_all(&buf[..n])?;
        size += n as u64;
        read(size);
    }
    to.sync_all()?;
    Ok((hasher.finalize(), size))
}

/// Hash a file as it is on the disk now — read around the page cache, so a check right after a copy reads the disk,
/// not the memory the copy just went through.
pub fn hash_from_disk(path: &Path) -> Result<blake3::Hash> {
    hash_from_disk_with(path, &mut |_| {})
}

/// `hash_from_disk`, telling `read` the bytes read so far after every buffer.
pub fn hash_from_disk_with(path: &Path, read: &mut dyn FnMut(u64)) -> Result<blake3::Hash> {
    let mut done = 0u64;
    let mut file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    uncached(&file);
    let mut hasher = blake3::Hasher::new();
    let mut buf = vec![0u8; BUF];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update_rayon(&buf[..n]);
        done += n as u64;
        read(done);
    }
    Ok(hasher.finalize())
}

/// macOS: tell the kernel not to keep this file's pages in the cache.
fn uncached(file: &File) {
    #[cfg(target_os = "macos")]
    {
        use std::os::fd::AsRawFd;
        // SAFETY: fcntl on a valid, open descriptor; F_NOCACHE only changes caching.
        unsafe {
            libc::fcntl(file.as_raw_fd(), libc::F_NOCACHE, 1);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = file;
}
