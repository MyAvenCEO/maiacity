//! A pack's rows (row 17, F4-F5): what a device's log keeps of each edit of a pack its shelf holds, beside where its
//! record lies in the pack, so that an open takes the pack's edits back by their rows, never reading, hashing or
//! decoding one: each is held by place (`policy::edits`) and decoded as it is first read, checked then by the hash of
//! its record and by its id, as a spill checks what it reads back. The log's indexes (`Log::receive_rowed`) and the
//! store's (its spill's slots, its signers, what its checkpoints cover) step on the rows as they step on the edits.
//!
//! A pack's rows are sealed for the device alone (`ShelfKey`), as its stored view is: what they say of an edit is the
//! device's word, as it worked it out when it took the edit and checked its signatures. A pack whose rows don't open,
//! or whose records they don't tile end to end, is read as before.

use crate::encode::Encode;
use crate::id::{AudienceId, BlobId, EditId, EntryId, ShareId, SignerId, VaultId};
use crate::policy::{Action, Edit};
use crate::sign::SignerKeys;
use crate::sync::LogId;
use crate::wire::{Decode, Reader, WireError};

/// What a pack's rows begin with: their format.
const ROWS: &[u8] = b"avenDB pack rows 1\n";

/// One edit of a pack, as its log and store keep it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Row {
    pub id: EditId,
    /// Its record in the pack: its length and the hash of its bytes.
    pub len: u32,
    pub sum: [u8; 32],
    pub depth: u64,
    pub log: Option<LogId>,
    /// The entry it writes, and its rank (`Edit::rank`), for a write.
    pub write: Option<(EntryId, u8)>,
    /// Who signed it, each a place in the rows' keys.
    pub signers: Vec<u32>,
    pub blobs: Vec<BlobId>,
    /// What it covers, for a checkpoint (`lab::covered`).
    pub covers: Vec<EditId>,
}

/// The rows of a pack's edits, in the pack's order, and the keys of who signed them.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LogRows {
    pub(crate) keys: Vec<(SignerId, SignerKeys)>,
    pub(crate) rows: Vec<Row>,
}

impl LogRows {
    /// Its edits' ids, in order.
    pub fn ids(&self) -> impl Iterator<Item = EditId> + '_ {
        self.rows.iter().map(|r| r.id)
    }

    /// The McEliece keys its edits name.
    pub fn blobs(&self) -> impl Iterator<Item = BlobId> + '_ {
        self.rows.iter().flat_map(|r| r.blobs.iter().copied())
    }

    pub fn len(&self) -> usize {
        self.rows.len()
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    /// Where each record lies in a pack of `size` bytes that begins with `prefix` bytes, each behind its 4-byte length:
    /// its place and length, if its rows tile the pack end to end, as the records of the pack they are of do.
    pub fn places(&self, prefix: u64, size: u64) -> Option<Vec<(u64, u32, [u8; 32])>> {
        let mut at = prefix;
        let mut out = Vec::with_capacity(self.rows.len());
        for r in &self.rows {
            at += 4;
            out.push((at, r.len, r.sum));
            at += u64::from(r.len);
        }
        (at == size).then_some(out)
    }

    /// The rows of `self`, then of `more`.
    pub fn extend(&mut self, more: LogRows) {
        let mut seen: std::collections::HashMap<SignerId, u32> =
            self.keys.iter().enumerate().map(|(i, (s, _))| (*s, i as u32)).collect();
        let map: Vec<u32> = more.keys.into_iter().map(|(s, k)| *seen.entry(s).or_insert_with(|| {
            self.keys.push((s, k));
            self.keys.len() as u32 - 1
        })).collect();
        self.rows.extend(more.rows.into_iter().map(|mut r| {
            r.signers.iter_mut().for_each(|i| *i = map[*i as usize]);
            r
        }));
    }

    pub(crate) fn to_bytes(&self) -> Vec<u8> {
        let mut out = ROWS.to_vec();
        (self.keys.len() as u32).encode(&mut out);
        for (s, k) in &self.keys {
            s.encode(&mut out);
            k.encode(&mut out);
        }
        (self.rows.len() as u32).encode(&mut out);
        for r in &self.rows {
            r.id.encode(&mut out);
            r.len.encode(&mut out);
            r.sum.encode(&mut out);
            r.depth.encode(&mut out);
            encode_log(&r.log, &mut out);
            match &r.write {
                None => out.push(0),
                Some((e, rank)) => {
                    out.push(1);
                    e.encode(&mut out);
                    out.push(*rank);
                }
            }
            r.signers[..].encode(&mut out);
            r.blobs[..].encode(&mut out);
            r.covers[..].encode(&mut out);
        }
        out
    }

    pub(crate) fn from_bytes(bytes: &[u8]) -> Option<LogRows> {
        let mut r = Reader::new(bytes.strip_prefix(ROWS)?);
        let rows = (|| -> Result<LogRows, WireError> {
            let n = u32::decode(&mut r)? as usize;
            let mut keys = Vec::with_capacity(n.min(1024));
            for _ in 0..n {
                keys.push((SignerId::decode(&mut r)?, SignerKeys::decode(&mut r)?));
            }
            let n = u32::decode(&mut r)? as usize;
            let mut rows = Vec::with_capacity(n.min(1 << 16));
            for _ in 0..n {
                let (id, len, sum, depth) = (EditId::decode(&mut r)?, u32::decode(&mut r)?, r.array()?, u64::decode(&mut r)?);
                let log = decode_log(&mut r)?;
                let write = match r.u8()? {
                    0 => None,
                    1 => Some((EntryId::decode(&mut r)?, r.u8()?)),
                    _ => return Err(WireError::Unknown),
                };
                let signers: Vec<u32> = r.seq(0)?;
                if signers.iter().any(|&i| i as usize >= keys.len()) {
                    return Err(WireError::Unknown);
                }
                rows.push(Row { id, len, sum, depth, log, write, signers, blobs: r.seq(0)?, covers: r.seq(0)? });
            }
            Ok(LogRows { keys, rows })
        })()
        .ok()?;
        r.done().then_some(rows)
    }
}

/// Edit `edit`'s row, whose id is `id`, its log `log` and its record `record`; who signed it, each by its keys in `keys`.
pub(crate) fn row(edit: &Edit, id: EditId, log: Option<LogId>, record: &[u8], signers: Vec<u32>) -> Row {
    let write = match edit.action {
        Action::Write { entry, .. } => Some((entry, edit.rank())),
        _ => None,
    };
    let covers = crate::policy::covered(std::iter::once(edit)).into_iter().collect();
    Row {
        id,
        len: u32::try_from(record.len()).expect("a record under 4 GB"),
        sum: *blake3::hash(record).as_bytes(),
        depth: edit.depth,
        log,
        write,
        signers,
        blobs: edit.blobs(),
        covers,
    }
}

fn encode_log(log: &Option<LogId>, out: &mut Vec<u8>) {
    match log {
        None => out.push(0),
        Some(LogId::Vault(v)) => {
            out.push(1);
            v.encode(out);
        }
        Some(LogId::Share(s)) => {
            out.push(2);
            s.encode(out);
        }
        Some(LogId::Audience(v, a)) => {
            out.push(3);
            v.encode(out);
            a.encode(out);
        }
        Some(LogId::Entry(e)) => {
            out.push(4);
            e.encode(out);
        }
    }
}

fn decode_log(r: &mut Reader<'_>) -> Result<Option<LogId>, WireError> {
    Ok(match r.u8()? {
        0 => None,
        1 => Some(LogId::Vault(VaultId::decode(r)?)),
        2 => Some(LogId::Share(ShareId::decode(r)?)),
        3 => Some(LogId::Audience(VaultId::decode(r)?, AudienceId::decode(r)?)),
        4 => Some(LogId::Entry(EntryId::decode(r)?)),
        _ => return Err(WireError::Unknown),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_read_back_as_they_went_in_and_tile_their_pack() {
        let row = |n: u8, len: u32| Row {
            id: EditId([n; 32]),
            len,
            sum: [n; 32],
            depth: n as u64,
            log: Some(LogId::Audience(VaultId([n; 32]), AudienceId([n; 32]))),
            write: (n % 2 == 0).then_some((EntryId([n; 32]), 1)),
            signers: vec![],
            blobs: vec![BlobId([n; 32])],
            covers: vec![EditId([n + 1; 32])],
        };
        let rows = LogRows { keys: vec![], rows: vec![row(1, 10), row(2, 20)] };
        assert_eq!(LogRows::from_bytes(&rows.to_bytes()), Some(rows.clone()));
        let places = rows.places(5, 5 + 4 + 10 + 4 + 20).expect("they tile it");
        assert_eq!(places.iter().map(|p| (p.0, p.1)).collect::<Vec<_>>(), vec![(9, 10), (23, 20)]);
        assert!(rows.places(5, 100).is_none(), "rows of other records don't tile the pack");
        let mut bytes = rows.to_bytes();
        bytes.push(0);
        assert!(LogRows::from_bytes(&bytes).is_none(), "trailing bytes");
    }
}
