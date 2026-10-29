//! Freshness on every read (`spec/AvenDB/Freshness.lean`, `avendb::engine::coverage::Freshness`): what the node hears
//! now (`Heard`), the logs its live peers hold that its device lacks, and the stamp of its device's last current read,
//! which an offline read is said to be as of.
//!
//! Cost: a read looks the answer up. The walk of what each live peer holds against what the device holds (`differ`,
//! peers x logs they announced) runs once per change of either: a peer's announcement or its going (`moved`), the
//! device's reach (`moved`), the device's own edits (its size), or which peers are live; a read of a scope (a vault, or
//! none) then filters that walk's logs once per change too. 1,000 reads with nothing moving make one walk
//! (`live_tests::a_thousand_reads_walk_once_per_change`).
//!
//! The stamp is the last time the device held everything its live peers announced, every one of them heard. It is
//! kept on the shelf (`slots/fresh`, eight bytes, Unix ms), so a device that opens with no peer says how old what it
//! shows is; a shelf that holds none, or a torn one, says never (0). No decision reads the time now: the stamp is
//! only shown.

use std::collections::{BTreeSet, HashMap};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use avendb::engine::coverage::Heard;
use avendb::id::{SignerId, VaultId};
use avendb::slice::Selector;
use avendb::sync::LogId;
use bytes::Bytes;
use n0_future::task;

use crate::Shared;

/// Where the shelf keeps the stamp.
const SLOT: &str = "slots/fresh";
/// A stamp goes onto the shelf at most once a minute while the device stays current.
const KEEP_EVERY_MS: u64 = 60_000;

/// How fresh the node's reads are: the stamp, and the last walk with the key it stands for.
#[derive(Default)]
pub(crate) struct Fresh {
    /// Bumped whenever what a peer holds, or what the device may hold by its view, changes (`moved`).
    moved: AtomicU64,
    /// How many walks ran, for the count tests.
    pub(crate) walks: AtomicU64,
    stamp: Mutex<Stamp>,
    walk: Mutex<Option<Walk>>,
}

/// The stamp, as the node knows it.
#[derive(Default)]
struct Stamp {
    /// Unix ms of the last current read, 0 for never.
    at: u64,
    /// What the shelf holds.
    kept: u64,
    /// Whether the shelf's was read.
    loaded: bool,
}

/// What a walk stands for: the moves, the device's size, and the live peers.
type Key = (u64, (usize, usize), Vec<SignerId>);

/// One walk: the live peers, how many were not heard, the logs they hold that the device lacks, and of those, per
/// scope read (a vault, or none, and the entries it picks), the ones that may change what it reads.
struct Walk {
    key: Key,
    unheard: usize,
    behind: Arc<BTreeSet<LogId>>,
    scoped: HashMap<(Option<VaultId>, Selector), Arc<Vec<LogId>>>,
}

impl Fresh {
    /// What a peer holds, or what the device may hold, changed: the next read walks again.
    pub(crate) fn moved(&self) {
        self.moved.fetch_add(1, Ordering::Relaxed);
    }

    /// How often it moved, for the count tests.
    #[cfg(test)]
    pub(crate) fn moved_count(&self) -> u64 {
        self.moved.load(Ordering::Relaxed)
    }
}

impl Shared {
    /// What the node hears now for a read of vault `vault` (`None` for every one) that picks entries by `picks`
    /// (`engine::footprint`): its live peers, those of them that have not told what they hold, and its stamp; and the
    /// logs where a live peer holds an edit its device lacks that may change what the read shows (`Lab::may_change`):
    /// the log of an entry it may pick, or of one the device can't place yet, the vault's own log, and any share's or
    /// audience's. Logs of entries the read can't pick, as other types or other entries, never make it behind. A device that holds all its
    /// live peers announced, every one heard, is current now: the stamp moves to now. Whether those logs were worked
    /// out now, for the first read of the scope since what the peers or the device hold changed.
    pub(crate) async fn heard(self: &Arc<Self>, vault: Option<VaultId>, picks: Selector) -> (Heard, Arc<Vec<LogId>>, bool) {
        let live: Vec<SignerId> = {
            let peers = self.peers.lock().expect("peers");
            let set: BTreeSet<SignerId> =
                peers.values().filter(|p| p.conn.close_reason().is_none()).map(|p| p.device).collect();
            set.into_iter().collect()
        };
        let key: Key = (self.fresh.moved.load(Ordering::Relaxed), *self.size.borrow(), live.clone());
        let cached = {
            let walk = self.fresh.walk.lock().expect("walk");
            walk.as_ref().filter(|w| w.key == key).map(|w| (w.unheard, w.behind.clone(), w.scoped.get(&(vault, picks.clone())).cloned()))
        };
        let (unheard, behind, scoped) = match cached {
            Some(found) => found,
            None => {
                self.fresh.walks.fetch_add(1, Ordering::Relaxed);
                let unheard = {
                    let held = self.held.lock().expect("held");
                    live.iter().filter(|d| !held.contains_key(d)).count()
                };
                let mut behind = BTreeSet::new();
                for device in &live {
                    behind.extend(self.differ(*device).await);
                }
                let behind = Arc::new(behind);
                *self.fresh.walk.lock().expect("walk") =
                    Some(Walk { key: key.clone(), unheard, behind: behind.clone(), scoped: HashMap::new() });
                (unheard, behind, None)
            }
        };
        let (scoped, new) = match scoped {
            Some(scoped) => (scoped, false),
            None => {
                let (logs, by) = (behind.clone(), picks.clone());
                let scoped: Arc<Vec<LogId>> = Arc::new(if logs.is_empty() { vec![] } else {
                    self.read(move |lab, me| logs.iter().filter(|log| lab.may_change(me, **log, vault, &by)).copied().collect()).await
                });
                let mut walk = self.fresh.walk.lock().expect("walk");
                if let Some(w) = walk.as_mut().filter(|w| w.key == key) {
                    w.scoped.insert((vault, picks), scoped.clone());
                }
                (scoped, true)
            }
        };
        let current = !live.is_empty() && unheard == 0 && behind.is_empty();
        let as_of = self.stamp(current).await;
        (Heard { live: live.len(), unheard, as_of }, scoped, new)
    }

    /// The stamp, moved to now if the device is `current`, read off the shelf the first time.
    async fn stamp(self: &Arc<Self>, current: bool) -> u64 {
        let loaded = self.fresh.stamp.lock().expect("stamp").loaded;
        if !loaded {
            let kept = match self.opts.shelf.as_ref() {
                Some(shelf) => shelf.get(SLOT).await.ok().flatten()
                    .and_then(|b| <[u8; 8]>::try_from(&b[..]).ok()).map_or(0, u64::from_le_bytes),
                None => 0,
            };
            let mut stamp = self.fresh.stamp.lock().expect("stamp");
            if !stamp.loaded {
                stamp.loaded = true;
                stamp.kept = kept;
                stamp.at = stamp.at.max(kept);
            }
        }
        let (at, keep) = {
            let mut stamp = self.fresh.stamp.lock().expect("stamp");
            if current {
                stamp.at = stamp.at.max(crate::jobs::now_ms());
            }
            let keep = current && stamp.at >= stamp.kept.saturating_add(KEEP_EVERY_MS);
            if keep {
                stamp.kept = stamp.at;
            }
            (stamp.at, keep)
        };
        if let (true, Some(shelf)) = (keep, self.opts.shelf.clone()) {
            task::spawn(async move {
                if let Err(e) = shelf.keep(SLOT, Bytes::copy_from_slice(&at.to_le_bytes())).await {
                    tracing::warn!("avendb: {SLOT} doesn't go onto the shelf: {e}");
                }
            });
        }
        at
    }
}
