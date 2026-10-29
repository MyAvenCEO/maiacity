//! The rows a peer that keeps an index (`Options::index`, the always-on peer's) was told, on its shelf (batch 5, the
//! B1 follow-up; `spec/AvenDB/ToldIndex.lean`): what `avendb::index::Rows` keeps, as a `ShelfIndex` named `told`, so
//! that the peer holds a budget of its pages in memory, not every row of every vault, and opens it by its slot, not by
//! reading every vault's rows. `Rows` stays the model it is held to (`told_index_tests.rs`).
//!
//! Its rows, each vault's apart (every key starts with a kind and the vault):
//!
//! - `V` + vault: a vault it holds rows of;
//! - `G` + vault + device: the digest of the rows the device last told of the vault (`index::digest`);
//! - `D` + vault + device + entry: the device holds a row of the entry, so a tell replaces its rows without the rest;
//! - `R` + vault + entry + device -> the epoch and tokens of the device's row of the entry;
//! - `T` + vault + token + entry + device: the row carries the token, so `find` is a scan of one key range a token,
//!   in the order of the entries' ids.
//!
//! A tell (`take`) changes the rows of one device of one vault, and the rows of the entries it names, each read from
//! the index and changed as `Rows::take` changes them, all applied at once, its slot after its pages: the told rows
//! are the fold of the tells it took (`ToldIndex.T1_fold`). A crash before the slot loses the last tell, and only it:
//! its digest isn't kept, so the device's next offer finds the peer lacking that vault, and tells it again, which gives
//! the same rows as if it had taken it once (`T2_again`).

use std::collections::{BTreeMap, BTreeSet};
use std::io;

use avendb::id::{EntryId, SignerId, VaultId};
use avendb::index::{self, Row, Rows, Token};
use avendb::pages::{Change, Sum};

use crate::shelf::Shelf;
use crate::shelf_index::{ShelfIndex, Stamp};

/// Its name on the shelf: `index/told/<page>`, `slots/index-told-0` and `-1`.
pub(crate) const NAME: &str = "told";
/// The bytes of its pages it holds in memory at most.
const BUDGET: usize = 16 << 20;
/// The rows one scan reads.
const SCAN: usize = 512;

const VAULT: u8 = b'V';
const TOLD: u8 = b'G';
const DEVICE: u8 = b'D';
const ROW: u8 = b'R';
const TOKEN: u8 = b'T';

fn key(kind: u8, parts: &[&[u8]]) -> Vec<u8> {
    let mut out = vec![kind];
    for p in parts {
        out.extend_from_slice(p);
    }
    out
}

/// The stamp of the tells it took: how many, and a hash of each in turn, its device, vault and digest.
fn next_stamp(was: Stamp, device: SignerId, vault: VaultId, digest: &[u8; 32]) -> Stamp {
    let mut h = avendb::hash::Hasher::new("avenDB told index tell 1");
    h.update(&was.head).update(&device.0).update(&vault.0).update(digest);
    Stamp { at: was.at + 1, head: h.finalize() }
}

fn empty_stamp() -> Stamp {
    Stamp { at: 0, head: avendb::hash::Hasher::new("avenDB told index tell 1").finalize() }
}

/// A row's value: its epoch, then its tokens.
fn row_value(epoch: u64, tokens: &[Token]) -> Vec<u8> {
    let mut out = epoch.to_be_bytes().to_vec();
    for t in tokens {
        out.extend_from_slice(t);
    }
    out
}

fn row_of(bytes: &[u8]) -> io::Result<(u64, Vec<Token>)> {
    let (epoch, rest) = bytes.split_at_checked(8).ok_or_else(|| invalid("a row"))?;
    if rest.len() % 16 != 0 || rest.len() / 16 > index::ROW_TOKENS {
        return Err(invalid("a row"));
    }
    let epoch = u64::from_be_bytes(epoch.try_into().expect("8 bytes"));
    Ok((epoch, rest.chunks(16).map(|c| c.try_into().expect("16 bytes")).collect()))
}

fn invalid(what: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, format!("the told index holds {what} that doesn't read"))
}

fn tail<const N: usize>(k: &[u8], from_end: usize) -> [u8; N] {
    k[k.len() - from_end..k.len() - from_end + N].try_into().expect("a key of its kind")
}

/// What a tell reads and changes: the index, and its changes so far over it.
struct Tell<'a> {
    index: &'a ShelfIndex,
    changes: BTreeMap<Vec<u8>, Option<Vec<u8>>>,
}

impl Tell<'_> {
    async fn get(&self, k: &[u8]) -> io::Result<Option<Vec<u8>>> {
        match self.changes.get(k) {
            Some(v) => Ok(v.clone()),
            None => self.index.get(k).await,
        }
    }

    /// Every row under `prefix`, its changes so far applied.
    async fn under(&self, prefix: &[u8]) -> io::Result<BTreeMap<Vec<u8>, Vec<u8>>> {
        let mut out = BTreeMap::new();
        let mut from = prefix.to_vec();
        'scan: loop {
            let got = self.index.scan(&from, SCAN).await?;
            let last = got.len() < SCAN;
            for (k, v) in got {
                if !k.starts_with(prefix) {
                    break 'scan;
                }
                from = [&k[..], &[0]].concat();
                out.insert(k, v);
            }
            if last {
                break;
            }
        }
        for (k, v) in self.changes.range(prefix.to_vec()..).take_while(|(k, _)| k.starts_with(prefix)) {
            match v {
                Some(v) => out.insert(k.clone(), v.clone()),
                None => out.remove(k),
            };
        }
        Ok(out)
    }

    fn set(&mut self, k: Vec<u8>, v: Option<Vec<u8>>) {
        self.changes.insert(k, v);
    }

    /// Device `device`'s row of `entry` taken out (`VaultRows::forget`).
    async fn forget(&mut self, vault: VaultId, device: SignerId, entry: EntryId) -> io::Result<()> {
        let r = key(ROW, &[&vault.0, &entry.0, &device.0]);
        let Some(old) = self.get(&r).await? else { return Ok(()) };
        let (_, tokens) = row_of(&old)?;
        for t in tokens {
            self.set(key(TOKEN, &[&vault.0, &t, &entry.0, &device.0]), None);
        }
        self.set(r, None);
        self.set(key(DEVICE, &[&vault.0, &device.0, &entry.0]), None);
        Ok(())
    }

    /// Device `device`'s row `row` put, in place of the one it had, and the row of the oldest epoch let go where the
    /// entry has rows of more than `ROW_DEVICES` devices (`VaultRows::put`).
    async fn put(&mut self, vault: VaultId, device: SignerId, row: Row) -> io::Result<()> {
        self.forget(vault, device, row.entry).await?;
        for t in &row.tokens {
            self.set(key(TOKEN, &[&vault.0, t, &row.entry.0, &device.0]), Some(vec![]));
        }
        self.set(key(ROW, &[&vault.0, &row.entry.0, &device.0]), Some(row_value(row.epoch, &row.tokens)));
        self.set(key(DEVICE, &[&vault.0, &device.0, &row.entry.0]), Some(vec![]));
        let of = self.under(&key(ROW, &[&vault.0, &row.entry.0])).await?;
        if of.len() > index::ROW_DEVICES {
            // the first of the oldest epoch, in the order of the devices, as `min_by_key` takes it
            let mut oldest: Option<(u64, SignerId)> = None;
            for (k, v) in &of {
                let (epoch, _) = row_of(v)?;
                if oldest.is_none_or(|(e, _)| epoch < e) {
                    oldest = Some((epoch, SignerId(tail(k, 32))));
                }
            }
            let (_, d) = oldest.expect("rows");
            self.forget(vault, d, row.entry).await?;
        }
        Ok(())
    }
}

/// A shelf in this process's memory, of named objects alone, for a unit test's node that keeps an index and no shelf:
/// its told index is what it would be on a shelf, gone as the node goes.
#[cfg(test)]
pub(crate) fn memory_shelf() -> Shelf {
    use crate::shelf::Call;
    let (shelf, mut calls) = Shelf::new();
    n0_future::task::spawn(async move {
        let mut objects: std::collections::HashMap<String, bytes::Bytes> = Default::default();
        while let Some(call) = calls.recv().await {
            match call {
                Call::Put { name, bytes, tx } => {
                    let answer = match objects.get(&name) {
                        Some(held) if *held != bytes => Err(io::Error::new(io::ErrorKind::AlreadyExists, "put once")),
                        _ => Ok(drop(objects.insert(name, bytes))),
                    };
                    tx.send(answer).ok();
                }
                Call::Keep { name, bytes, tx } => {
                    objects.insert(name, bytes);
                    tx.send(Ok(())).ok();
                }
                Call::Get { name, tx } => drop(tx.send(Ok(objects.get(&name).cloned()))),
                Call::Names { prefix, tx } => {
                    let mut names: Vec<String> = objects.keys().filter(|n| n.starts_with(&prefix)).cloned().collect();
                    names.sort();
                    tx.send(Ok(names)).ok();
                }
                Call::List(tx) => drop(tx.send(Ok(vec![]))),
                Call::Read { tx, .. } => drop(tx.send(Err(io::ErrorKind::NotFound.into()))),
                Call::Outboard { tx, .. } => drop(tx.send(Err(io::ErrorKind::NotFound.into()))),
                Call::Write { tx, .. } | Call::Finish { tx, .. } | Call::Drop { tx, .. } => {
                    drop(tx.send(Err(io::Error::other("a memory shelf of an index holds no blobs"))))
                }
            }
        }
    });
    shelf
}

/// The told rows on a peer's shelf, as the module says.
pub(crate) struct ToldIndex {
    index: tokio::sync::Mutex<ShelfIndex>,
}

impl ToldIndex {
    /// The told rows on `shelf`, as its newest slot that opens left them: a slot and a root page read, however many
    /// rows it holds. A shelf with no slot of it yet, but with the rows an older node kept there one vault a blob
    /// (`older`), takes those in first.
    pub(crate) async fn open(shelf: Shelf, older: Option<Rows>) -> io::Result<ToldIndex> {
        let (index, opened) = ShelfIndex::open_kept(shelf, NAME, BUDGET, empty_stamp()).await?;
        let told = ToldIndex { index: tokio::sync::Mutex::new(index) };
        if !opened && let Some(rows) = older {
            told.take_all(&rows).await?;
        }
        Ok(told)
    }

    /// Takes in every row of `rows` at once, each device's of each vault as it told them: what `open` does with an
    /// older node's rows, and a test's rebuild.
    pub(crate) async fn take_all(&self, rows: &Rows) -> io::Result<()> {
        let mut index = self.index.lock().await;
        let mut stamp = index.stamp();
        let mut changes: Vec<Change> = Vec::new();
        for (vault, told, held) in rows.told_rows() {
            changes.push((key(VAULT, &[&vault.0]), Some(vec![])));
            for (device, digest) in told {
                changes.push((key(TOLD, &[&vault.0, &device.0]), Some(digest.to_vec())));
                stamp = next_stamp(stamp, device, vault, &digest);
            }
            for (device, row) in held {
                for t in &row.tokens {
                    changes.push((key(TOKEN, &[&vault.0, t, &row.entry.0, &device.0]), Some(vec![])));
                }
                changes.push((key(ROW, &[&vault.0, &row.entry.0, &device.0]), Some(row_value(row.epoch, &row.tokens))));
                changes.push((key(DEVICE, &[&vault.0, &device.0, &row.entry.0]), Some(vec![])));
            }
        }
        index.apply(changes, stamp).await
    }

    /// The digest of the rows `device` last told of `vault`, if it told any (`Rows::told`).
    pub(crate) async fn told(&self, device: SignerId, vault: VaultId) -> io::Result<Option<[u8; 32]>> {
        let got = self.index.lock().await.get(&key(TOLD, &[&vault.0, &device.0])).await?;
        got.map(|d| d.try_into().map_err(|_| invalid("a digest"))).transpose()
    }

    /// `device` tells all its rows of `vault`, which replace those it told before, `keep` saying which entries it
    /// takes a row of (`Rows::take`): how many it took. Applied at once, on the shelf before it answers.
    pub(crate) async fn take(
        &self,
        device: SignerId,
        vault: VaultId,
        rows: Vec<Row>,
        keep: impl Fn(EntryId) -> bool,
    ) -> io::Result<usize> {
        let mut index = self.index.lock().await;
        let digest = index::digest(vault, &rows);
        let mut tell = Tell { index: &index, changes: BTreeMap::new() };
        tell.set(key(VAULT, &[&vault.0]), Some(vec![]));
        let fresh: BTreeSet<EntryId> = rows.iter().map(|r| r.entry).collect();
        let held = tell.under(&key(DEVICE, &[&vault.0, &device.0])).await?;
        for k in held.keys() {
            let e = EntryId(tail(k, 32));
            if !fresh.contains(&e) {
                tell.forget(vault, device, e).await?;
            }
        }
        let mut taken = 0;
        for mut row in rows {
            if !keep(row.entry) {
                tell.forget(vault, device, row.entry).await?;
                continue;
            }
            row.tokens.truncate(index::ROW_TOKENS);
            tell.put(vault, device, row).await?;
            taken += 1;
        }
        tell.set(key(TOLD, &[&vault.0, &device.0]), Some(digest.to_vec()));
        let changes = tell.changes.into_iter().collect();
        let stamp = next_stamp(index.stamp(), device, vault, &digest);
        index.apply(changes, stamp).await?;
        Ok(taken)
    }

    /// The vaults it holds rows of.
    pub(crate) async fn vaults(&self) -> io::Result<Vec<VaultId>> {
        let index = self.index.lock().await;
        let tell = Tell { index: &index, changes: BTreeMap::new() };
        Ok(tell.under(&[VAULT]).await?.keys().map(|k| VaultId(tail(k, 32))).collect())
    }

    /// The entries of `vault` (of every vault for `None`) whose rows carry one of `tokens`, after `after`, smallest
    /// first, each once, at most `limit`, and whether more are left: the rows `Rows::find` would look at before it
    /// asks which of them the asking device syncs. Each token's rows are one key range, read a page at a time.
    pub(crate) async fn candidates(
        &self,
        vault: Option<VaultId>,
        tokens: &[Token],
        after: Option<EntryId>,
        limit: usize,
    ) -> io::Result<(Vec<EntryId>, bool)> {
        let vaults = match vault {
            Some(v) => vec![v],
            None => self.vaults().await?,
        };
        let index = self.index.lock().await;
        let mut hits = BTreeSet::new();
        let mut cut = false;
        for v in &vaults {
            for t in tokens {
                let prefix = key(TOKEN, &[&v.0, t]);
                let mut from = match after {
                    Some(a) => key(TOKEN, &[&v.0, t, &a.0, &[0xff; 32]]),
                    None => prefix.clone(),
                };
                let mut mine = 0;
                'scan: loop {
                    let got = index.scan(&from, SCAN).await?;
                    let last = got.len() < SCAN;
                    for (k, _) in got {
                        if !k.starts_with(&prefix) {
                            break 'scan;
                        }
                        from = [&k[..], &[0]].concat();
                        let e = EntryId(tail(&k, 64));
                        if after.is_none_or(|a| e > a) && hits.insert(e) {
                            mine += 1;
                        }
                        // no more of this token than the page can hold: the smallest are among them
                        if mine > limit {
                            cut = true;
                            break 'scan;
                        }
                    }
                    if last {
                        break;
                    }
                }
            }
        }
        let more = cut || hits.len() > limit;
        Ok((hits.into_iter().take(limit).collect(), more))
    }

    /// How many rows it holds, of how many entries (`Rows::size`): a scan of every row, for a test or a report.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) async fn size(&self) -> io::Result<(usize, usize)> {
        let index = self.index.lock().await;
        let tell = Tell { index: &index, changes: BTreeMap::new() };
        let rows = tell.under(&[ROW]).await?;
        let entries: BTreeSet<&[u8]> = rows.keys().map(|k| &k[..1 + 64]).collect();
        Ok((rows.len(), entries.len()))
    }

    /// The hash of its root (`ShelfIndex.I4`) and how many tells it took.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) async fn root(&self) -> (Option<Sum>, u64) {
        let index = self.index.lock().await;
        (index.root(), index.stamp().at)
    }

    /// Every row it holds, in key order: what a test compares with a rebuild.
    #[cfg(test)]
    pub(crate) async fn rows(&self) -> io::Result<BTreeMap<Vec<u8>, Vec<u8>>> {
        let index = self.index.lock().await;
        let tell = Tell { index: &index, changes: BTreeMap::new() };
        tell.under(&[]).await
    }
}

#[cfg(test)]
#[path = "told_index_tests.rs"]
mod tests;
