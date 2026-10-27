//! Freshness on every read (`spec/AvenDB/Freshness.lean`, `avendb::engine::coverage::Freshness`): what the node hears
//! now (`Heard`) and the stamp of its device's last current read, which an offline read is said to be as of.
//!
//! The stamp is the last time the device held everything its live peers announced, every one of them heard. It is
//! kept on the shelf (`slots/fresh`, eight bytes, Unix ms), so a device that opens with no peer says how old what it
//! shows is; a shelf that holds none, or a torn one, says never (0). No decision reads the time now: the stamp is
//! only shown.

use std::collections::BTreeSet;
use std::sync::Arc;

use avendb::engine::coverage::Heard;
use avendb::sync::LogId;
use avendb::id::SignerId;
use bytes::Bytes;
use n0_future::task;

use crate::Shared;

/// Where the shelf keeps the stamp.
const SLOT: &str = "slots/fresh";
/// A stamp goes onto the shelf at most once a minute while the device stays current.
const KEEP_EVERY_MS: u64 = 60_000;

/// The stamp, as the node knows it.
#[derive(Default)]
pub(crate) struct Stamp {
    /// Unix ms of the last current read, 0 for never.
    at: u64,
    /// What the shelf holds.
    kept: u64,
    /// Whether the shelf's was read.
    loaded: bool,
}

impl Shared {
    /// What the node hears now: its live peers, those of them that have not told what they hold, and its stamp; and the
    /// logs where a live peer holds an edit its device lacks (`differ`). A device that holds all its live peers
    /// announced, every one heard, is current now: the stamp moves to now.
    pub(crate) async fn heard(self: &Arc<Self>) -> (Heard, BTreeSet<LogId>) {
        let live: BTreeSet<SignerId> = {
            let peers = self.peers.lock().expect("peers");
            peers.values().filter(|p| p.conn.close_reason().is_none()).map(|p| p.device).collect()
        };
        let unheard = {
            let held = self.held.lock().expect("held");
            live.iter().filter(|d| !held.contains_key(d)).count()
        };
        let mut behind = BTreeSet::new();
        for device in &live {
            behind.extend(self.differ(*device).await);
        }
        let current = !live.is_empty() && unheard == 0 && behind.is_empty();
        let as_of = self.stamp(current).await;
        (Heard { live: live.len(), unheard, as_of }, behind)
    }

    /// The stamp, moved to now if the device is `current`, read off the shelf the first time.
    async fn stamp(self: &Arc<Self>, current: bool) -> u64 {
        let loaded = self.fresh.lock().expect("fresh").loaded;
        if !loaded {
            let kept = match self.opts.shelf.as_ref() {
                Some(shelf) => shelf.get(SLOT).await.ok().flatten()
                    .and_then(|b| <[u8; 8]>::try_from(&b[..]).ok()).map_or(0, u64::from_le_bytes),
                None => 0,
            };
            let mut fresh = self.fresh.lock().expect("fresh");
            if !fresh.loaded {
                fresh.loaded = true;
                fresh.kept = kept;
                fresh.at = fresh.at.max(kept);
            }
        }
        let (at, keep) = {
            let mut fresh = self.fresh.lock().expect("fresh");
            if current {
                fresh.at = fresh.at.max(crate::jobs::now_ms());
            }
            let keep = current && fresh.at >= fresh.kept.saturating_add(KEEP_EVERY_MS);
            if keep {
                fresh.kept = fresh.at;
            }
            (fresh.at, keep)
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
