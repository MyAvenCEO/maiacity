//! The server's backups (`docs/BACKUP.md`, `avendb_net::backup`): every day at the time its environment says
//! (`SnapshotsConfig::at`), and whenever it is told to (SIGUSR1, `Backups::now`), it takes a snapshot of every vault
//! it knows into the bucket of snapshots, a folder for each, then lets go of what retention drops (`Keep`), and keeps
//! its device's secret there too. Each run says in the log what it did for each vault, and sums it up at its end.
//!
//! From the bucket alone, without a running server: `drill` rehearses a restore of every vault, each in a node of its
//! own, and says whether each came back whole (B9); `restore` puts the server's shelf aside and restores every vault
//! onto a new one, with its device's secret, so that the server, started again, is the same device, as it was then.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use anyhow::{Context as _, Result, bail};
use avendb::backup::{DAY, Keep};
use avendb::id::VaultId;
use avendb_net::backup::{self, Snapshots};
use avendb_net::bucket::Sealed;
use avendb_net::{Node, Options, Shelf, server};
use tokio::sync::Notify;

use crate::{Abort, Config, SnapshotsConfig, bucket};

/// The bucket of snapshots `config` names, staging in its folder.
pub fn snapshots(config: &SnapshotsConfig) -> Result<Snapshots> {
    let bucket = bucket::S3::new(&config.bucket)?;
    Ok(Snapshots::new(bucket, &config.bucket.seal, &config.dir))
}

/// A vault a run failed, with why.
pub type Failed = (VaultId, String);
/// A vault restored, with the manifest of the snapshot it was restored from.
pub type Restored = (VaultId, backup::Manifest);

/// What a backup did for one vault: as `avendb_net::backup::Backup` says, and what retention let go of.
#[derive(Clone, Debug)]
pub struct Done {
    pub vault: VaultId,
    pub time: u64,
    pub base: Option<u64>,
    pub edits: u64,
    pub news: u64,
    pub files: usize,
    pub put: u64,
    pub bytes: u64,
    pub lacking: usize,
    pub kept: usize,
    pub dropped: usize,
}

/// A run of the backups: when, what it did for each vault, the vaults it failed, with why, and how long it took.
#[derive(Clone, Debug)]
pub struct Run {
    pub time: u64,
    pub done: Vec<Done>,
    pub failed: Vec<Failed>,
    pub took: Duration,
}

/// Backs up every vault `node` knows into `snapshots` at `time`, each made `whole` or built on its newest snapshot,
/// then lets go of what `keep` drops: each vault one at a time, and one that fails doesn't hold up the rest.
pub async fn back_up_all(node: &Node, snapshots: &Snapshots, keep: &Keep, time: u64, whole: bool) -> Run {
    let began = Instant::now();
    let (mut done, mut failed) = (Vec::new(), Vec::new());
    for v in node.vaults().await {
        let backed_up = async {
            let b = node.back_up(snapshots, v, time, whole).await?;
            let retained = snapshots.folder(v).await?.retain(keep, time).await?;
            let m = &b.manifest;
            Ok::<_, anyhow::Error>(Done {
                vault: v,
                time: m.time,
                base: b.base,
                edits: m.edits,
                news: b.news,
                files: m.files.len(),
                put: b.put,
                bytes: b.bytes,
                lacking: b.lacking.len(),
                kept: retained.kept,
                dropped: retained.dropped.len(),
            })
        };
        match backed_up.await {
            Ok(d) => {
                let base = d.base.map_or("nothing, whole".to_string(), |t| t.to_string());
                tracing::info!(
                    "avenDB backups: vault {} at {}: {} edits, {} new, {} files ({} lacking), built on {base}; put {} \
                     blobs, {} bytes; {} snapshots kept, {} let go",
                    v.to_hex(),
                    d.time,
                    d.edits,
                    d.news,
                    d.files,
                    d.lacking,
                    d.put,
                    d.bytes,
                    d.kept,
                    d.dropped
                );
                done.push(d);
            }
            Err(e) => {
                tracing::warn!("avenDB backups: vault {} isn't backed up: {e:#}", v.to_hex());
                failed.push((v, format!("{e:#}")));
            }
        }
    }
    let run = Run { time, done, failed, took: began.elapsed() };
    let bytes: u64 = run.done.iter().map(|d| d.bytes).sum();
    tracing::info!(
        "avenDB backups: {} vaults backed up at {time}, {} failed, {bytes} bytes put, in {:?}",
        run.done.len(),
        run.failed.len(),
        run.took
    );
    run
}

/// The server's backups running: woken at its time each day, or when told to.
pub struct Backups {
    wake: Arc<Notify>,
    _task: Abort,
}

impl Backups {
    /// Backs up every vault `node` knows each day at `config.at`, keeping what `keep` keeps, and its device's secret,
    /// from `shelf`, the server's.
    pub fn spawn(node: Arc<Node>, shelf: Shelf, config: &SnapshotsConfig, keep: Keep) -> Result<Backups> {
        let (snapshots, at, wake) = (snapshots(config)?, config.at, Arc::new(Notify::new()));
        let woken = wake.clone();
        let task = tokio::spawn(async move {
            loop {
                let wait = until(now(), at);
                tokio::select! {
                    () = tokio::time::sleep(Duration::from_secs(wait)) => {}
                    () = woken.notified() => tracing::info!("avenDB backups: told to back up now"),
                }
                match shelf.get(server::SECRET).await {
                    Ok(Some(secret)) => {
                        if let Err(e) = snapshots.keep_secret(&secret).await {
                            tracing::warn!("avenDB backups: the server's secret isn't kept with the snapshots: {e:#}");
                        }
                    }
                    Ok(None) => tracing::warn!("avenDB backups: the server's shelf holds no secret"),
                    Err(e) => tracing::warn!("avenDB backups: the server's secret doesn't read: {e:#}"),
                }
                back_up_all(&node, &snapshots, &keep, now(), false).await;
            }
        });
        Ok(Backups { wake, _task: Abort(task) })
    }

    /// Backs up every vault now, or once the run under way ends.
    pub fn now(&self) {
        self.wake.notify_one();
    }
}

/// Seconds from `now` until the next `at` seconds into a day, in UTC: a whole day if it is that time now.
pub fn until(now: u64, at: u64) -> u64 {
    let into = now % DAY;
    if into < at { at - into } else { DAY - into + at }
}

/// The seconds into a day that `hh_mm`, such as `03:00`, says.
pub fn time_of_day(hh_mm: &str) -> Option<u64> {
    let (h, m) = hh_mm.trim().split_once(':')?;
    let (h, m): (u64, u64) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some(h * 3600 + m * 60)
}

/// The days from 1970-01-01 to `y-m-d`, in the proleptic Gregorian calendar.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((m + 9) % 12) + 2) / 5 + d - 1;
    era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468
}

/// The time `said` says, in seconds since 1970: those seconds, or a day, `YYYY-MM-DD`, to its end, in UTC.
pub fn time_said(said: &str) -> Option<u64> {
    let said = said.trim();
    if let Ok(t) = said.parse() {
        return Some(t);
    }
    let mut parts = said.splitn(3, '-').map(|p| p.parse::<i64>().ok());
    let (y, m, d) = (parts.next()??, parts.next()??, parts.next()??);
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let days = days_from_civil(y, m, d);
    u64::try_from((days + 1) * DAY as i64 - 1).ok()
}

/// Time `t`, in seconds since 1970, as a day and a time of it, in UTC: `2026-10-19 03:00:00`.
pub fn when(t: u64) -> String {
    let (days, into) = ((t / DAY) as i64, t % DAY);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let (d, m) = (doy - (153 * mp + 2) / 5 + 1, if mp < 10 { mp + 3 } else { mp - 9 });
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}", into / 3600, into / 60 % 60, into % 60)
}

/// The time by this machine's clock: seconds since 1970.
fn now() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// What a drill found of one vault: when its snapshot was taken, the rehearsal, and how long it took.
#[derive(Clone, Debug)]
pub struct Drilled {
    pub vault: VaultId,
    pub rehearsal: backup::Rehearsal,
}

/// Rehearses a restore of every vault of `snapshots`, each as its newest snapshot taken at `at` or before, or its
/// newest with `at` unsaid: each into a node of its own, in a folder of its own under `dir`, which it removes after.
/// Each vault's rehearsal, and the vaults whose rehearsal failed, with why.
pub async fn drill(snapshots: &Snapshots, at: Option<u64>, dir: &Path) -> Result<(Vec<Drilled>, Vec<Failed>)> {
    let (mut drilled, mut failed) = (Vec::new(), Vec::new());
    for v in snapshots.vaults().await? {
        let folder = snapshots.folder(v).await?;
        let Some(m) = folder.as_of(at).await? else { continue };
        let into = dir.join(v.to_hex());
        let rehearsed = async {
            let (rehearsal, node) = backup::rehearse(&folder, m.time, &into, Options::local()).await?;
            node.shutdown().await?;
            Ok::<_, anyhow::Error>(rehearsal)
        };
        match rehearsed.await {
            Ok(r) => {
                tracing::info!(
                    "avenDB drill: vault {} at {}: {} of {} edits, {} of {} files, logs {}; restored in {:?}, \
                     started in {:?}",
                    v.to_hex(),
                    m.time,
                    r.edits,
                    r.manifest.edits,
                    r.files,
                    r.manifest.files.len(),
                    if r.same { "as the manifest names them" } else { "NOT as the manifest names them" },
                    r.restore,
                    r.start
                );
                drilled.push(Drilled { vault: v, rehearsal: r });
            }
            Err(e) => {
                tracing::warn!("avenDB drill: vault {} doesn't come back: {e:#}", v.to_hex());
                failed.push((v, format!("{e:#}")));
            }
        }
        std::fs::remove_dir_all(&into).ok();
    }
    Ok((drilled, failed))
}

/// Restores the server `config` says after a disaster, which must not be running: its shelf, its bucket's or its
/// folder's, put aside, and on a new one every vault of `snapshots`, each as its newest snapshot taken at `at` or
/// before, or its newest with `at` unsaid, and the server's device's secret kept with them. Started again, the server
/// is the same device, holding every vault as its snapshot has it; its devices bring it what came after. The vaults
/// restored.
pub async fn restore(config: &Config, snapshots: &Snapshots, at: Option<u64>) -> Result<Vec<Restored>> {
    let Some(secret) = snapshots.secret().await? else {
        bail!("the bucket of snapshots holds no secret of the server's: a restore would make it another device");
    };
    let shelf = match &config.bucket {
        Some(b) => {
            let sealed = Sealed::new(bucket::S3::new(b)?, &b.seal);
            let n = avendb_net::bucket::aside(&sealed).await?;
            tracing::info!("avenDB restore: the server's shelf put aside, generation {n} anew in bucket {}", b.name);
            avendb_net::bucket::shelf(sealed, &config.data, config.cache).await?
        }
        None => {
            let n = avendb_net::disk::aside(&config.data)?;
            let data = config.data.display();
            tracing::info!("avenDB restore: the server's shelf put aside, generation {n} anew in {data}");
            avendb_net::disk::open(&config.data)?
        }
    };
    if !shelf.names("").await?.is_empty() {
        bail!("the server's new shelf isn't empty");
    }
    let restored = backup::restore_all(snapshots, at, &shelf).await?;
    shelf.put(server::SECRET, bytes::Bytes::copy_from_slice(&secret[..])).await.context("the server's secret")?;
    Ok(restored)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn times_read_and_show_as_said() {
        assert_eq!(time_of_day("03:00"), Some(3 * 3600));
        assert_eq!(time_of_day("23:59"), Some(23 * 3600 + 59 * 60));
        assert_eq!((time_of_day("24:00"), time_of_day("3"), time_of_day("03:60")), (None, None, None));
        assert_eq!(time_said("1760000000"), Some(1_760_000_000));
        assert_eq!(time_said("1970-01-01"), Some(DAY - 1));
        assert_eq!(time_said("2026-10-19"), Some(1_792_454_399));
        assert_eq!((time_said("2026-13-01"), time_said("yesterday")), (None, None));
        assert_eq!(when(1_792_454_399), "2026-10-19 23:59:59");
        assert_eq!(when(0), "1970-01-01 00:00:00");
        assert_eq!(when(951_782_400), "2000-02-29 00:00:00");
    }

    #[test]
    fn the_daily_run_waits_for_its_time() {
        let day = 20_000 * DAY;
        assert_eq!(until(day, 3 * 3600), 3 * 3600);
        assert_eq!(until(day + 3 * 3600, 3 * 3600), DAY, "a whole day, at its time");
        assert_eq!(until(day + 4 * 3600, 3 * 3600), 23 * 3600);
    }
}
