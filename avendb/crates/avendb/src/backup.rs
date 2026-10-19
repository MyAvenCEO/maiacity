//! Backups of each vault (`spec/AvenDB/Backup.lean`, `docs/BACKUP.md`): a vault's snapshot of what a node holds, how a
//! backup of it builds on the newest snapshot of its folder by that snapshot's frontiers, as a device asks a peer, and
//! which snapshots a retention keeps, as Time Machine keeps backups. The folders themselves are `avendb-net`'s
//! (`backup`).
//!
//! - `snapshot`: the edits of the vault's own logs (its entries, its audiences, the shares over it, issued by it or
//!   naming it and those they rest on) and of the logs of the vault and every vault those name, up their owners: what a
//!   restore needs to check every chain without anything else (`Backup.snapshot`). Its files: those its writes bring.
//! - `plan`: whether a backup builds on the newest snapshot (`Bucket.base`), named by its frontiers and loose edits
//!   (`sync::asks_by_frontiers`), and the edits of its one new pack: what lies beyond them, what `respond_since` would
//!   send (`Backup.since`), or the whole snapshot. It builds on none when it is made whole, as it is once the newest
//!   names `MOST_PACKS` packs, or when the newest holds an edit the snapshot lacks.
//! - `keeps`: of snapshots taken at some times, the ones a retention at some moment keeps (`Backup.keeps`).
//!
//! Restored, a snapshot is the vault as it was (B1): the same edits, so the same state (T11), with the frontiers its
//! manifest names (B9).

use std::collections::HashSet;

use crate::id::{EditId, VaultId};
use crate::policy::{Edit, State, Who, view};
use crate::sealed::FileRoot;
use crate::sync::{Ask, LogId, beyond, close_vaults, log_of, logs_of, named_below, vaults_named};

/// Log `l` is vault `v`'s, by the view `st` (`Backup.ofVault`): the log of one of its entries or audiences, or of a
/// share over it, issued by it or naming it, or that such a share rests on. A vault log is taken with the vaults the
/// rest names.
fn of_vault(st: &State, shares: &HashSet<crate::id::ShareId>, v: VaultId, l: LogId) -> bool {
    match l {
        LogId::Entry(e) => st.entry(e).is_some_and(|en| en.vault == v),
        LogId::Audience(u, _) => u == v,
        LogId::Share(c) => shares.contains(&c),
        LogId::Vault(_) => false,
    }
}

/// The places in `edits` of vault `v`'s snapshot, by the view `st` of `edits`: those of its own logs, then those of
/// the logs of the vault and every vault they name, up their owners, each in the order of `edits`.
pub fn snapshot_places(edits: &[Edit], st: &State, v: VaultId) -> Vec<usize> {
    // the shares a share of `v` rests on: every share of the chain of one over it, issued by it or naming it
    let ours = |cp: &&crate::policy::Issued| {
        cp.share.over == v || cp.share.issuer == v || cp.share.who == Who::Vault(v)
    };
    let shares: HashSet<_> = st.shares().iter().filter(ours).flat_map(|cp| cp.chain.iter().copied()).collect();
    let logs: Vec<Option<LogId>> = edits.iter().map(|edit| log_of(edit, edit.id())).collect();
    let items: Vec<usize> =
        (0..edits.len()).filter(|&i| logs[i].is_some_and(|l| of_vault(st, &shares, v, l))).collect();
    let named = std::iter::once(v).chain(items.iter().flat_map(|&i| vaults_named(&edits[i])));
    let vaults: HashSet<VaultId> = close_vaults(st, named.collect()).into_iter().collect();
    let vault_edits = (0..edits.len()).filter(|&i| matches!(logs[i], Some(LogId::Vault(u)) if vaults.contains(&u)));
    items.iter().copied().chain(vault_edits).collect()
}

/// Vault `v`'s snapshot of a node holding `edits` (`Backup.snapshot`).
pub fn snapshot(edits: &[Edit], v: VaultId) -> Vec<Edit> {
    snapshot_places(edits, &view(edits), v).into_iter().map(|i| edits[i].clone()).collect()
}

/// The files the edits `snap` bring, each once, in the order they first come (`Backup.snapshotFiles`).
pub fn files(snap: &[Edit]) -> Vec<FileRoot> {
    let mut seen = HashSet::new();
    snap.iter().flat_map(|edit| edit.files().iter().copied()).filter(|f| seen.insert(*f)).collect()
}

/// What a backup of a snapshot writes into its folder (`Bucket.base`, `Bucket.news`): whether it builds on the newest
/// snapshot, naming its packs again, and the edits of the one pack it adds, by their places among what the node holds;
/// none if empty.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
    pub base: bool,
    pub news: Vec<usize>,
}

/// The most packs a manifest names: once the newest names this many, the next backup is made whole (`mostPacks`), so a
/// restore reads at most this many packs (B8).
pub const MOST_PACKS: usize = 64;

/// The next backup is made whole, the newest snapshot naming `packs` packs (`Bucket.due`).
pub fn due(packs: usize) -> bool {
    packs >= MOST_PACKS
}

/// The plan of a backup of the snapshot at the places `snap` of the edits `edits` a node holds, into a folder whose
/// newest snapshot names `base` (`sync::asks_by_frontiers` of what it restores), if any. It builds on it unless it is
/// made whole (`compact`) or `base` names an edit, at or below its frontiers or loose, that the snapshot lacks; then it
/// adds what of the snapshot lies beyond `base` (`sync::respond_since`'s `beyond`), else the whole snapshot.
pub fn plan(edits: &[Edit], snap: &[usize], base: Option<&Ask>, compact: bool) -> Plan {
    let whole = Plan { base: false, news: snap.to_vec() };
    let Some(base) = base.filter(|_| !compact) else { return whole };
    let ids: Vec<EditId> = edits.iter().map(Edit::id).collect();
    let logs = logs_of(edits, &ids);
    let held: HashSet<EditId> = snap.iter().map(|&i| ids[i]).collect();
    if !named_below(edits, &ids, &logs, base).iter().all(|id| held.contains(id)) {
        return whole;
    }
    Plan { base: true, news: beyond(edits, &ids, &logs, snap, base) }
}

pub const HOUR: u64 = 3600;
pub const DAY: u64 = 24 * HOUR;
pub const WEEK: u64 = 7 * DAY;
/// A month of retention: 30 days.
pub const MONTH: u64 = 30 * DAY;

/// What a vault's backups keep (`Backup.Keep`): every snapshot of the last `recent` seconds, the newest of each day
/// for `days` days, of each week for `weeks` weeks, and of each month for ever. Days, weeks and months are counted
/// from 1970 in UTC.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Keep {
    pub recent: u64,
    pub days: u64,
    pub weeks: u64,
}

impl Default for Keep {
    fn default() -> Keep {
        Keep { recent: 48 * HOUR, days: 30, weeks: 26 }
    }
}

/// `t` is the newest of `times` in its period of `len` seconds (`newestIn`).
fn newest_in(times: &[u64], len: u64, t: u64) -> bool {
    times.iter().all(|&u| u / len != t / len || u <= t)
}

/// At `now`, of snapshots taken at `times`, the one taken at `t` is kept (`Backup.keeps`): the newest of all, one of
/// the last `recent` seconds, or the newest of its day, its week (in their windows) or its month.
pub fn keeps(k: &Keep, now: u64, times: &[u64], t: u64) -> bool {
    let age = now.saturating_sub(t);
    t == times.iter().copied().max().unwrap_or(0)
        || age < k.recent
        || (age < k.days * DAY && newest_in(times, DAY, t))
        || (age < k.weeks * WEEK && newest_in(times, WEEK, t))
        || newest_in(times, MONTH, t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn b8_a_backup_is_made_whole_once_the_newest_names_the_most_packs() {
        assert!(!due(MOST_PACKS - 1));
        assert!(due(MOST_PACKS));
    }

    #[test]
    fn b5_the_newest_snapshot_is_always_kept() {
        let times = [10 * DAY, 400 * DAY, 401 * DAY];
        assert!(keeps(&Keep { recent: 0, days: 0, weeks: 0 }, 9_000 * DAY, &times, 401 * DAY));
    }
}
