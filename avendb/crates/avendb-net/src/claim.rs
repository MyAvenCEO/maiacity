//! The one server that writes a bucket (`bucket`): its claim, `writer` beside the generations, sealed as every object
//! is. One server writes a bucket, as its puts are a get, then a put (`bucket`), which two servers at once would race.
//! More servers are peers, each with a bucket of its own (Samuel 2026-10-26), so a second one on the same bucket is a
//! mistake, as a deploy started twice, or a server pointed at another's bucket; it is refused here, before it opens the
//! shelf.
//!
//! - A server claims the bucket as it starts: where no claim is there, or one let go of (`released`), or one not said
//!   alive for `Timing::stale`, or its own from a run before (its folder's `claim` names it), it puts its own, waits a
//!   moment, and reads it back, the one whose claim is there then holding it. Where another's claim is alive, it waits
//!   for it to go stale, then refuses to start.
//! - It says it is alive every `Timing::beat`; a claim it finds another's then is lost (`Claim::lost`), and the server
//!   stops writing: it stops.
//! - It lets go of it as it stops (`Claim::release`), so that the next one starts at once, as at a deploy.
//!
//! Each claim put is a version the bucket keeps 7 days (Object Lock): a hundred-odd bytes a minute.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context as _, Result, bail};
use n0_future::time::{Instant, sleep};
use serde_json::{Value, json};
use tokio::sync::watch;

use crate::bucket::Sealed;

/// The claim's name in the bucket.
const CLAIM: &str = "writer";

/// The file in the server's folder that names its claim, for the next run to take it back at once.
const OWN: &str = "claim";

/// How often a server says its claim is alive, and when a claim not said alive is let go of.
#[derive(Clone, Copy, Debug)]
pub struct Timing {
    pub beat: Duration,
    pub stale: Duration,
    /// How long a server waits after putting its claim before it reads it back.
    pub settle: Duration,
}

impl Default for Timing {
    fn default() -> Timing {
        Timing { beat: Duration::from_secs(60), stale: Duration::from_secs(180), settle: Duration::from_secs(2) }
    }
}

/// A server's claim of its bucket, said alive for as long as it is held.
pub struct Claim {
    bucket: Sealed,
    id: String,
    lost: watch::Receiver<bool>,
    beat: tokio::task::JoinHandle<()>,
    /// How many times it waited for another's claim to go stale before it took it.
    waits: u32,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// The claim in `bucket`, if any: its id, when it was said alive last, and whether it was let go of.
async fn read(bucket: &Sealed) -> Result<Option<(String, u64, bool)>> {
    let Some(bytes) = bucket.get(CLAIM).await? else { return Ok(None) };
    let said: Value = serde_json::from_slice(&bytes).context("the bucket's claim isn't JSON")?;
    let id = said["id"].as_str().context("a claim with no id")?.to_string();
    Ok(Some((id, said["beat"].as_u64().unwrap_or(0), said["released"].as_bool().unwrap_or(false))))
}

async fn say(bucket: &Sealed, id: &str, released: bool) -> Result<()> {
    bucket.put(CLAIM, &serde_json::to_vec(&json!({ "id": id, "beat": now(), "released": released }))?).await
}

impl Claim {
    /// Claims `bucket` for the server whose folder is `data`, as `timing` says: at once where it is free, after
    /// waiting for another's claim to go stale, or not at all, where that one is still alive then.
    pub async fn take(bucket: &Sealed, data: &Path, timing: Timing) -> Result<Claim> {
        let own: PathBuf = data.join(OWN);
        let before = std::fs::read_to_string(&own).ok().map(|s| s.trim().to_string());
        let waited = Instant::now();
        let mut waits = 0;
        loop {
            match read(bucket).await? {
                None => break,
                Some((_, _, true)) => break,
                Some((id, _, _)) if Some(&id) == before.as_ref() => break,
                Some((_, beat, _)) if now().saturating_sub(beat) >= timing.stale.as_secs() => break,
                Some((_, beat, _)) => {
                    if waited.elapsed() > timing.stale + timing.beat {
                        bail!(
                            "another server holds the bucket, said alive {}s ago: one server writes a bucket",
                            now().saturating_sub(beat)
                        );
                    }
                    tracing::warn!("avenDB: another server holds the bucket; waiting for its claim to go stale");
                    waits += 1;
                    sleep(timing.beat.min(timing.stale) / 4).await;
                }
            }
        }
        let id = data_encoding::HEXLOWER.encode(&crate::server::random()?[..16]);
        if let Some(parent) = own.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&own, &id).context("naming its claim in its folder")?;
        say(bucket, &id, false).await?;
        sleep(timing.settle).await;
        match read(bucket).await? {
            Some((there, _, false)) if there == id => {}
            _ => bail!("another server claimed the bucket at the same time: one server writes a bucket"),
        }
        let (tell, lost) = watch::channel(false);
        let (on, me) = (bucket.clone(), id.clone());
        let beat = tokio::spawn(async move {
            loop {
                sleep(timing.beat).await;
                match read(&on).await {
                    Ok(Some((there, _, _))) if there != me => {
                        tracing::error!("avenDB: another server claimed the bucket; this one stops writing it");
                        tell.send(true).ok();
                        return;
                    }
                    Ok(_) => {
                        if let Err(e) = say(&on, &me, false).await {
                            tracing::warn!("avenDB: its claim of the bucket isn't said alive: {e:#}");
                        }
                    }
                    Err(e) => tracing::warn!("avenDB: its claim of the bucket isn't read: {e:#}"),
                }
            }
        });
        Ok(Claim { bucket: bucket.clone(), id, lost, beat, waits })
    }

    /// How many times it waited for another's claim to go stale: none where it took the bucket at once.
    pub fn waits(&self) -> u32 {
        self.waits
    }

    /// Answers once another server's claim is found in its place.
    pub fn lost(&self) -> impl Future<Output = ()> + Send + 'static {
        let mut lost = self.lost.clone();
        async move {
            lost.wait_for(|lost| *lost).await.ok();
        }
    }

    /// Lets go of the claim, so that the next server takes it at once: only where it is still this one's.
    pub async fn release(self) -> Result<()> {
        self.beat.abort();
        match read(&self.bucket).await? {
            Some((there, _, _)) if there == self.id => say(&self.bucket, &self.id, true).await,
            _ => Ok(()),
        }
    }
}

impl Drop for Claim {
    fn drop(&mut self) {
        self.beat.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bucket::Folder;

    fn quick() -> Timing {
        Timing { beat: Duration::from_millis(200), stale: Duration::from_secs(2), settle: Duration::from_millis(50) }
    }

    /// A second server waits, then is refused while the first is alive; and a server finds its claim lost when
    /// another's is in its place. On a paused clock: the waits and the beats are the runtime's, and the wall clock
    /// the claims are said alive by stands still, so the first is alive however loaded the machine is.
    #[tokio::test(start_paused = true)]
    async fn a_second_server_is_refused_and_a_taken_claim_lost() {
        let dir = std::env::temp_dir().join(format!("avendb-claim-paused-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        let bucket = Sealed::new(Folder::new(dir.join("objects")), &[7; 32]);
        let (a, b) = (dir.join("a"), dir.join("b"));

        let first = Claim::take(&bucket, &a, quick()).await.expect("a free bucket is claimed");
        let refused = Claim::take(&bucket, &b, quick()).await;
        assert!(refused.is_err(), "a second server is refused while the first is alive");

        // and a server whose claim is another's now stops writing
        say(&bucket, "another", false).await.expect("said");
        tokio::time::timeout(Duration::from_secs(5), first.lost()).await.expect("its claim lost");
        std::fs::remove_dir_all(dir).ok();
    }

    /// One server holds a bucket: the next takes it at once once the first lets go, or its own claim back, and takes a
    /// claim gone stale. "At once" is counted (`Claim::waits`), never timed.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn one_server_writes_a_bucket() {
        let dir = std::env::temp_dir().join(format!("avendb-claim-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        let bucket = Sealed::new(Folder::new(dir.join("objects")), &[7; 32]);
        let (a, b) = (dir.join("a"), dir.join("b"));

        let first = Claim::take(&bucket, &a, quick()).await.expect("a free bucket is claimed");

        // the first stops as at a deploy: the next takes it at once
        first.release().await.expect("released");
        let second = Claim::take(&bucket, &b, quick()).await.expect("a released claim is taken");
        assert_eq!(second.waits(), 0, "at once");

        // the second is killed, and comes back on its own folder: its own claim, taken back at once
        drop(second);
        let second = Claim::take(&bucket, &b, quick()).await.expect("its own claim, taken back");
        assert_eq!(second.waits(), 0, "at once");

        // killed again: another server, on a folder of its own, takes it once it went stale
        drop(second);
        Claim::take(&bucket, &a, quick()).await.expect("a stale claim is taken");
        std::fs::remove_dir_all(dir).ok();
    }
}
