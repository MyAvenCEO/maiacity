//! A node's store on disk: the signed ops its device holds, appended to `ops` in the order it took them, and the
//! McEliece keys they name, each in `keys/` under its id. No secret is kept here: a person's device derives its keys
//! from its passkey at every unlock and opens the rest again from its ops, and the server keeps its device's secret
//! beside the store (`server`).
//!
//! Each op is one record: its length in 4 bytes, big-endian, then its bytes on the wire. A crash can cut the last
//! record short, so reading stops at the first record that doesn't decode whole, and the file is cut back to the
//! records before it. The device checks every op again as it takes it back (`Lab::restore_backup`); if any fails, the
//! file is written anew without it (`adopt`). A key is written to a file of its own first and then renamed into
//! place, so a key on disk is always whole, and one whose bytes don't hash to its name is dropped.

use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Write as _};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context as _, Result};
use avendb::id::{BlobId, SignerId};
use avendb::lab::{Backup, Lab};
use avendb::sign::Signed;
use avendb::wire::Wire;

const OPS: &str = "ops";
const KEYS: &str = "keys";
/// A key on its way to disk, before it is renamed into place.
const PART: &str = "part";

/// A node's store in a folder of its own.
pub struct Disk {
    dir: PathBuf,
    ops: File,
    /// How many of the device's ops are on disk: the first `written` of its log (`Log::ids`).
    written: usize,
    /// The McEliece keys on disk.
    keys: HashSet<BlobId>,
}

impl Disk {
    /// The store in folder `dir`, made if there is none, and what it holds: the ops in the order they were saved,
    /// every record that decodes whole, and every key that hashes to its name.
    pub fn open(dir: &Path) -> Result<(Disk, Backup)> {
        fs::create_dir_all(dir.join(KEYS)).with_context(|| format!("the store at {}", dir.display()))?;
        let path = dir.join(OPS);
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e.into()),
        };
        let (signed, whole) = records(&bytes);
        let ops = OpenOptions::new().create(true).append(true).open(&path)?;
        if whole < bytes.len() {
            ops.set_len(whole as u64)?;
            ops.sync_all()?;
        }
        let (mut keys, mut held) = (Vec::new(), HashSet::new());
        for entry in fs::read_dir(dir.join(KEYS))? {
            let path = entry?.path();
            let id = path.file_name().and_then(|n| n.to_str()).and_then(BlobId::from_hex);
            let key = id.map(|id| fs::read(&path).map(|bytes| (id, bytes))).transpose()?;
            match key {
                Some((id, bytes)) if BlobId::of(&bytes) == id => {
                    held.insert(id);
                    keys.push(Arc::from(bytes));
                }
                _ => fs::remove_file(&path)?,
            }
        }
        let disk = Disk { dir: dir.to_path_buf(), ops, written: signed.len(), keys: held };
        Ok((disk, Backup::new(signed, keys)))
    }

    /// Takes on device `d` of `lab`, restored from this store (`Lab::restore_backup`) or holding ops the store
    /// doesn't have yet: if it took back fewer ops than the store holds, as some failed their checks, the store is
    /// written anew from what it holds; then whatever else it holds is saved.
    pub fn adopt(&mut self, lab: &Lab, d: SignerId) -> Result<()> {
        self.save(lab, d)?;
        Ok(())
    }

    /// Saves what device `d` of `lab` took since the last save: its new ops at the end of `ops`, and each new
    /// McEliece key in a file of its own. True if there was anything new.
    pub fn save(&mut self, lab: &Lab, d: SignerId) -> Result<bool> {
        if lab.size(d) == (self.written, self.keys.len()) {
            return Ok(false);
        }
        let ids = lab.log(d).ids();
        let rewritten = ids.len() < self.written;
        if rewritten {
            self.rewrite(lab, d)?;
        }
        let new_keys: Vec<BlobId> = lab.blob_ids(d).into_iter().filter(|b| !self.keys.contains(b)).collect();
        for &b in &new_keys {
            self.save_key(b, &lab.blob(d, b).context("a key the device holds")?)?;
        }
        let mut out = Vec::new();
        for id in &ids[self.written..] {
            record(&mut out, lab.signed_op(d, *id).context("an op the device holds")?);
        }
        if !out.is_empty() {
            self.ops.write_all(&out)?;
            self.ops.sync_data()?;
            self.written = ids.len();
        }
        Ok(rewritten || !out.is_empty() || !new_keys.is_empty())
    }

    /// How many ops the store holds.
    pub fn len(&self) -> usize {
        self.written
    }

    /// The store holds no op.
    pub fn is_empty(&self) -> bool {
        self.written == 0
    }

    /// Writes `ops` anew from what device `d` holds, beside it first, then in its place.
    fn rewrite(&mut self, lab: &Lab, d: SignerId) -> Result<()> {
        let ids = lab.log(d).ids();
        let mut out = Vec::new();
        for id in ids {
            record(&mut out, lab.signed_op(d, *id).context("an op the device holds")?);
        }
        let (path, next) = (self.dir.join(OPS), self.dir.join(format!("{OPS}.{PART}")));
        let mut file = File::create(&next)?;
        file.write_all(&out)?;
        file.sync_all()?;
        fs::rename(&next, &path)?;
        self.ops = OpenOptions::new().append(true).open(&path)?;
        self.written = ids.len();
        Ok(())
    }

    /// Writes McEliece key `b`, beside its place first, then renamed into it.
    fn save_key(&mut self, b: BlobId, bytes: &[u8]) -> Result<()> {
        let path = self.dir.join(KEYS).join(b.to_hex());
        let part = path.with_extension(PART);
        let mut file = File::create(&part)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&part, &path)?;
        self.keys.insert(b);
        Ok(())
    }
}

/// One record: the op's length, then its bytes.
fn record(out: &mut Vec<u8>, signed: &Signed) {
    let bytes = signed.to_wire();
    out.extend((bytes.len() as u32).to_be_bytes());
    out.extend(bytes);
}

/// The ops of every record of `bytes` that decodes whole, up to the first that doesn't, and how many bytes they take.
fn records(bytes: &[u8]) -> (Vec<Signed>, usize) {
    let (mut signed, mut at) = (Vec::new(), 0);
    while let Some(len) = bytes.get(at..at + 4) {
        let len = u32::from_be_bytes(len.try_into().expect("4 bytes")) as usize;
        let Some(record) = bytes.get(at + 4..).and_then(|rest| rest.get(..len)) else { break };
        let Ok(op) = Signed::from_wire(record) else { break };
        signed.push(op);
        at += 4 + len;
    }
    (signed, at)
}
