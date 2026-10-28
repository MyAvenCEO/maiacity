//! A device's start, timed on a real shelf (Step 0 of the performance plan, 2026-10-20): `AVENDB_BENCH_SHELF` names a
//! copy of a device's folder (one that holds `g18/`), never the folder a running device uses. It reads the shelf, then
//! restores a new device of a fresh Lab from it, as `Node::spawn` does, and prints how long each part took and what
//! the Lab measured. Run it by hand: `AVENDB_BENCH_SHELF=<copy> cargo test -p avendb-net --release bench -- --ignored
//! --nocapture`.

use crate::{disk, edits};
use avendb::lab::Lab;
use avendb::wire::Wire;
use std::time::Instant;

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn bench_restore() {
    let Ok(root) = std::env::var("AVENDB_BENCH_SHELF") else {
        return;
    };
    let began = Instant::now();
    let shelf = disk::open(std::path::Path::new(&root)).expect("the shelf");
    let (_edits, (signed, keys, anchors)) = edits::Edits::open(shelf).await.expect("its edits");
    let read = began.elapsed();
    let (count, bytes) = (
        signed.len(),
        signed.iter().map(|s| s.to_wire().len()).sum::<usize>(),
    );
    let mut lab = Lab::new();
    let me = lab.device("bench");
    let began = Instant::now();
    lab.restore_from(me, avendb::lab::Backup::new(signed, keys).with_bootstrap_bytes(&anchors).expect("valid anchor companion"));
    let restored = began.elapsed();
    eprintln!(
        "BENCH edits={count} wire_mb={:.1} read_s={:.2} restore_s={:.2}",
        bytes as f64 / 1e6,
        read.as_secs_f64(),
        restored.as_secs_f64()
    );
    eprintln!("BENCH perf {}", lab.perf(me));
}

/// The rules' replay of the same shelf's edits alone, done `AVENDB_BENCH_ROUNDS` times (3 if unset): what every write
/// and every page of a pull costs today.
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn bench_replay() {
    let Ok(root) = std::env::var("AVENDB_BENCH_SHELF") else {
        return;
    };
    let rounds: usize = std::env::var("AVENDB_BENCH_ROUNDS")
        .ok()
        .and_then(|n| n.parse().ok())
        .unwrap_or(3);
    let shelf = disk::open(std::path::Path::new(&root)).expect("the shelf");
    let (_edits, (signed, _, _)) = edits::Edits::open(shelf).await.expect("its edits");
    let edits: Vec<_> = signed.into_iter().map(|s| s.edit).collect();
    let removals = edits.iter().filter(|e| e.is_removal()).count();
    for _ in 0..rounds {
        let began = Instant::now();
        let r = avendb::policy::replay(&edits);
        eprintln!(
            "BENCH replay edits={} removals={removals} stood={} s={:.3}",
            edits.len(),
            r.stood.iter().filter(|s| **s).count(),
            began.elapsed().as_secs_f64()
        );
    }
}

/// What the shelf's `Keys` edits are: by the kind of key each boxes and how many boxes it carries, and how many share
/// an author and a depth (made in one upkeep).
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn bench_keys() {
    use avendb::keys::{KeyFam, KeyName};
    use avendb::policy::Action;
    use std::collections::BTreeMap;
    let Ok(root) = std::env::var("AVENDB_BENCH_SHELF") else {
        return;
    };
    let shelf = disk::open(std::path::Path::new(&root)).expect("the shelf");
    let (_edits, (signed, _, _)) = edits::Edits::open(shelf).await.expect("its edits");
    let mut kinds: BTreeMap<String, (usize, usize, usize)> = BTreeMap::new();
    let mut batches: BTreeMap<(String, u64), usize> = BTreeMap::new();
    let mut actions: BTreeMap<&'static str, (usize, usize)> = BTreeMap::new();
    for s in &signed {
        let bytes = s.to_wire().len();
        let kind = match &s.edit.action {
            Action::Keys { .. } => "keys",
            Action::Write { .. } => "write",
            Action::Mark { .. } => "mark",
            Action::Share(_) => "share",
            Action::Revoke(_) => "revoke",
            _ => "other",
        };
        let a = actions.entry(kind).or_default();
        a.0 += 1;
        a.1 += bytes;
        if let Action::Keys {
            name,
            boxes,
            public,
            ..
        } = &s.edit.action
        {
            let k = match name {
                KeyName::Signer(_) => "signer".to_string(),
                KeyName::Scoped(KeyFam::Seed(_), _) => "seed".into(),
                KeyName::Scoped(KeyFam::Share(..), _) => "share".into(),
                KeyName::Scoped(KeyFam::Audience(..), _) => "audience".into(),
                KeyName::Entry(..) => "entry".into(),
            };
            let k = format!(
                "{k} boxes={} public={}",
                boxes.len().min(3),
                public.is_some()
            );
            let e = kinds.entry(k).or_default();
            e.0 += 1;
            e.1 += bytes;
            e.2 += s.sigs.len();
            *batches
                .entry((format!("{:?}", s.edit.author), s.edit.depth))
                .or_default() += 1;
        }
    }
    for (k, (n, b)) in &actions {
        eprintln!("BENCH action {k}: {n} edits, {:.1} MB", *b as f64 / 1e6);
    }
    for (k, (n, b, sigs)) in &kinds {
        eprintln!(
            "BENCH keys {k}: {n} edits, {:.1} MB, {sigs} sigs",
            *b as f64 / 1e6
        );
    }
    let mut sizes: BTreeMap<usize, usize> = BTreeMap::new();
    for n in batches.values() {
        *sizes.entry(*n).or_default() += 1;
    }
    eprintln!("BENCH keys per (author, depth): {sizes:?}");
}

/// A release rehearsal's pre-open inventory. Reads authenticated packs/journal without
/// creating any device or opening identity keys. The file contains only set digests
/// and counts; its fixture count must match an independently recorded baseline.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires an explicitly marked disposable release rehearsal copy"]
async fn rehearsal_inventory() -> anyhow::Result<()> {
    use anyhow::{Context, ensure};
    use avendb::{hash, id::BlobId};
    use std::path::PathBuf;
    fn digest(mut ids: Vec<[u8; 32]>, purpose: &str) -> [u8; 32] {
        ids.sort();
        let mut h = hash::Hasher::new(purpose);
        h.update(&(ids.len() as u64).to_be_bytes());
        for id in ids {
            h.update(&id);
        }
        h.finalize()
    }
    let root =
        PathBuf::from(std::env::var_os("AVENDB_REHEARSAL_COPY").context("explicit copy required")?)
            .canonicalize()?;
    ensure!(
        root.starts_with("/private/tmp") && root.join(".avendb-release-rehearsal").is_file(),
        "only a marked disposable copy is accepted"
    );
    let expected: usize = std::env::var("AVENDB_REHEARSAL_EXPECTED_EDITS")
        .context("independent baseline count required")?
        .parse()?;
    let shelf = disk::open(&root)?;
    let (_edits, (signed, keys, anchors)) = edits::Edits::open(shelf).await?;
    ensure!(
        signed.len() == expected,
        "copy differs from independently recorded baseline edit count"
    );
    let value = serde_json::json!({
        "edits": signed.len(),
        "keys": keys.len(),
        "bootstrap_anchor_bytes": anchors.len(),
        "edit_digest": digest(signed.iter().map(|s| s.edit.id().0).collect(), "release rehearsal edit set 1"),
        "key_digest": digest(keys.iter().map(|k| BlobId::of(k).0).collect(), "release rehearsal key set 1"),
    });
    // Create-only: never overwrite a baseline after opening/upgrading the copy.
    use std::io::Write;
    let mut out = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(root.join(".avendb-release-inventory.json"))?;
    out.write_all(&serde_json::to_vec(&value)?)?;
    out.sync_all()?;
    eprintln!(
        "REHEARSAL inventory checked edits={} keys={}",
        signed.len(),
        keys.len()
    );
    Ok(())
}

/// Aggregate-only diagnosis of an explicitly copied store after an attempted upgrade.
/// No identity is unlocked, no files are written, and no ids or records are printed.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "manual disposable release rehearsal diagnosis"]
async fn rehearsal_saved_delta() -> anyhow::Result<()> {
    use anyhow::{Context, ensure};
    use avendb::{
        id::BlobId,
        policy::{self, Action},
    };
    use std::{
        collections::{BTreeMap, BTreeSet},
        path::PathBuf,
    };
    let source = PathBuf::from(
        std::env::var_os("AVENDB_REHEARSAL_SOURCE").context("explicit source copy required")?,
    )
    .canonicalize()?;
    let target = PathBuf::from(
        std::env::var_os("AVENDB_REHEARSAL_COPY").context("explicit target copy required")?,
    )
    .canonicalize()?;
    ensure!(
        source.starts_with("/private/tmp")
            && target.starts_with("/private/tmp")
            && target.join(".avendb-release-rehearsal").is_file(),
        "disposable copies required"
    );
    let from = disk::open(&source)?;
    let to = disk::open(&target)?;
    let (_a, (before, before_keys, _)) = edits::Edits::open(from).await?;
    let (_b, (after, after_keys, _)) = edits::Edits::open(to.clone()).await?;
    let meta = to
        .names("meta/")
        .await?
        .last()
        .cloned()
        .context("Meta absent")?;
    let meta: serde_json::Value =
        serde_json::from_slice(&to.get(&meta).await?.context("Meta missing")?)?;
    let own = meta["device"].as_str().context("Meta device absent")?;
    let a: BTreeSet<_> = before.iter().map(|s| s.edit.id()).collect();
    let b: BTreeSet<_> = after.iter().map(|s| s.edit.id()).collect();
    let fresh: Vec<_> = after.iter().filter(|s| !a.contains(&s.edit.id())).collect();
    let mut actions = BTreeMap::new();
    for signed in &fresh {
        let kind = match signed.edit.action {
            Action::Genesis { .. } => "genesis",
            Action::Share(_) => "share",
            Action::Revoke(_) => "revoke",
            Action::Settings { .. } => "settings",
            Action::Write { .. } => "write",
            Action::Mark { .. } => "mark",
            Action::Claim { .. } => "claim",
            Action::Keys { .. } => "keys",
            Action::Wraps { .. } => "wraps",
            Action::Checkpoint { .. } => "checkpoint",
            Action::Snapshot { .. } => "snapshot",
        };
        *actions.entry(kind).or_insert(0usize) += 1;
    }
    let ka: BTreeSet<_> = before_keys.iter().map(|k| BlobId::of(k)).collect();
    let kb: BTreeSet<_> = after_keys.iter().map(|k| BlobId::of(k)).collect();
    let before_edits: Vec<_> = before.iter().map(|s| s.edit.clone()).collect();
    let before_ids: Vec<_> = before.iter().map(|s| s.edit.id()).collect();
    let replay = policy::replay(&before_edits);
    let roundtrip =
        policy::Replay::from_view(&replay.to_view(before.len()), &before_edits, &before_ids)
            .context("original replay view did not decode")?
            .0;
    eprintln!(
        "REHEARSAL raw view roundtrip replay_equal={} state_equal={} ids_equal={} stood_equal={} tail_equal={}",
        replay == roundtrip,
        replay.state == roundtrip.state,
        replay.ids == roundtrip.ids,
        replay.stood == roundtrip.stood,
        replay.same_tail(&roundtrip)
    );
    eprintln!(
        "REHEARSAL raw view cap_groups_before={} cap_groups_after={} shares_equal={} view_bytes_equal={}",
        replay
            .state
            .shares()
            .iter()
            .filter(|s| s.share.group.is_some())
            .count(),
        roundtrip
            .state
            .shares()
            .iter()
            .filter(|s| s.share.group.is_some())
            .count(),
        replay.state.shares() == roundtrip.state.shares(),
        replay.to_view(before.len()) == roundtrip.to_view(before.len())
    );
    ensure!(
        replay == roundtrip && replay.same_tail(&roundtrip),
        "raw stored-view roundtrip changed replay semantics"
    );
    let sa = replay.state;
    let sb = policy::view(&after.iter().map(|s| s.edit.clone()).collect::<Vec<_>>());
    eprintln!(
        "REHEARSAL delta before={} after={} removed={} added={} own_added={} valid_added={} actions={actions:?} keys_before={} keys_after={} keys_removed={} keys_added={} policy_equal={} vaults_equal={} shares_equal={} entries_equal={}",
        a.len(),
        b.len(),
        a.difference(&b).count(),
        fresh.len(),
        fresh
            .iter()
            .filter(|s| s.edit.author.to_hex() == own)
            .count(),
        fresh.iter().filter(|s| s.verify().is_ok()).count(),
        ka.len(),
        kb.len(),
        ka.difference(&kb).count(),
        kb.difference(&ka).count(),
        sa == sb,
        sa.vaults() == sb.vaults(),
        sa.shares() == sb.shares(),
        sa.entries() == sb.entries()
    );
    Ok(())
}
