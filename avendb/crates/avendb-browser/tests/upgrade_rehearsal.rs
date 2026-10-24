//! Manual release gate on an APFS clone, never the installed store. The helper is
//! built from the app's existing Enclave.swift plus scripts/rehearsal-touch.swift.
//! It only signs with existing Touch ID keys; no account or key is created.
#![cfg(target_os = "macos")]
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::os::unix::fs::MetadataExt;
use std::process::{Command, Stdio};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, ensure};
use avendb::{
    hash,
    id::{BlobId, EditId, EntryId, SignerId, VaultId},
    policy::State,
    sign::{self, Ceremony},
};
use avendb_browser::{Device, Meta, Start};
use avendb_net::{Progress, disk};
use serde_json::json;
use zeroize::Zeroizing;

fn copy_root() -> Result<PathBuf> {
    let root = PathBuf::from(
        std::env::var_os("AVENDB_REHEARSAL_COPY").context("explicit rehearsal copy required")?,
    )
    .canonicalize()?;
    ensure!(
        root.starts_with("/private/tmp") && root.join(".avendb-release-rehearsal").is_file(),
        "only a marked disposable copy is accepted"
    );
    if let Some(home) = std::env::var_os("HOME") {
        ensure!(
            root != PathBuf::from(home).join("avenDB/mac").canonicalize()?,
            "live store is forbidden"
        );
    }
    isolated_tree(&root)?;
    Ok(root)
}

/// Validate every descendant before opening a writer or damaging derived slots.
/// APFS copy-on-write clones have independent inodes; hard links do not.
fn isolated_tree(path: &Path) -> Result<()> {
    let meta = std::fs::symlink_metadata(path)?;
    ensure!(!meta.file_type().is_symlink(), "rehearsal tree contains a symlink");
    if meta.is_dir() {
        for entry in std::fs::read_dir(path)? {
            isolated_tree(&entry?.path())?;
        }
    } else {
        ensure!(meta.is_file(), "rehearsal tree contains a non-regular object");
        ensure!(meta.nlink() == 1, "rehearsal file has multiple hard links");
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn unbase64(text: &str) -> Result<Zeroizing<Vec<u8>>> {
    sign::unbase64url(
        &text
            .trim_end_matches('=')
            .replace('+', "-")
            .replace('/', "_"),
    )
    .map(Zeroizing::new)
    .context("malformed enclave result")
}
fn touch(meta: &Meta) -> Result<Ceremony> {
    let touch = meta
        .touch
        .as_ref()
        .context("copy has no Touch ID key; an actual passkey unlock is required")?;
    let helper =
        std::env::var_os("AVENDB_REHEARSAL_TOUCH_HELPER").context("Touch ID helper required")?;
    let mut challenge = [0; 32];
    getrandom::fill(&mut challenge).map_err(|_| anyhow::anyhow!("random challenge unavailable"))?;
    let request = json!({"sign": hex(&challenge), "key": hex(&touch.key), "kem": hex(&touch.kem), "sealed": hex(&touch.sealed)});
    eprintln!("REHEARSAL waiting for Touch ID to unlock only the marked disposable copy");
    let mut child = Command::new(helper)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    child
        .stdin
        .take()
        .context("helper input")?
        .write_all(request.to_string().as_bytes())?;
    let answer = child.wait_with_output()?;
    ensure!(
        answer.status.success(),
        "Touch ID helper failed or was cancelled"
    );
    let raw = Zeroizing::new(answer.stdout);
    let mut value: serde_json::Value =
        serde_json::from_slice(&raw).context("invalid Touch ID helper answer")?;
    ensure!(
        value.get("error").is_none(),
        "Touch ID did not authorize the existing key; no rehearsal unlock occurred"
    );
    let sig = unbase64(value["sig"].as_str().context("signature absent")?)?;
    let encoded = Zeroizing::new(
        match value
            .as_object_mut()
            .context("helper object")?
            .remove("secret")
        {
            Some(serde_json::Value::String(value)) => value,
            _ => anyhow::bail!("opened secret absent"),
        },
    );
    let secret = unbase64(&encoded)?;
    let secret = Zeroizing::new(
        <[u8; 32]>::try_from(secret.as_slice())
            .map_err(|_| anyhow::anyhow!("opened secret has wrong size"))?,
    );
    Ok(Ceremony::enclave(
        touch.public.clone(),
        sig.to_vec(),
        challenge,
        *secret,
    ))
}
fn immutable_files(root: &Path) -> Result<BTreeMap<PathBuf, [u8; 32]>> {
    fn visit(root: &Path, dir: &Path, out: &mut BTreeMap<PathBuf, [u8; 32]>) -> Result<()> {
        for e in std::fs::read_dir(dir)? {
            let e = e?;
            ensure!(
                !e.file_type()?.is_symlink(),
                "rehearsal stores must contain no symlinks"
            );
            if e.file_type()?.is_dir() {
                visit(root, &e.path(), out)?;
            } else {
                out.insert(
                    e.path().strip_prefix(root)?.to_path_buf(),
                    hash::content(&std::fs::read(e.path())?),
                );
            }
        }
        Ok(())
    }
    let mut out = BTreeMap::new();
    for generation in disk::generations(root)? {
        for name in ["meta", "heads", "journal"] {
            let dir = root.join(format!("g{generation}")).join(name);
            if dir.exists() {
                visit(root, &dir, &mut out)?;
            }
        }
    }
    Ok(out)
}
#[derive(PartialEq, Eq)]
struct Observed {
    device: SignerId,
    vault: VaultId,
    ids: Vec<EditId>,
    keys: Vec<BlobId>,
    state: State,
    records: Vec<(EntryId, [u8; 32])>,
}
async fn observe(device: &Device) -> Result<Observed> {
    device
        .node()
        .read(|lab, me| {
            let vault = lab.vault_of(me).context("original device has no vault")?;
            let records = lab
                .entries(me)
                .into_iter()
                .filter_map(|entry| {
                    lab.history(me, entry).map(|history| {
                        (
                            entry,
                            hash::content(
                                &serde_json::to_vec(&history.record(None, me))
                                    .expect("record JSON"),
                            ),
                        )
                    })
                })
                .collect();
            Ok(Observed {
                device: me,
                vault,
                ids: lab.log(me).ids().to_vec(),
                keys: lab.blob_ids(me),
                state: lab.state(me).clone(),
                records,
            })
        })
        .await
}
fn compare(stage: &str, expected: &Observed, actual: &Observed) -> bool {
    let same_set = set_digest(
        expected.ids.iter().map(|id| id.0).collect(),
        "release rehearsal edit set 1",
    ) == set_digest(
        actual.ids.iter().map(|id| id.0).collect(),
        "release rehearsal edit set 1",
    );
    let a: BTreeMap<_, _> = expected.records.iter().copied().collect();
    let b: BTreeMap<_, _> = actual.records.iter().copied().collect();
    eprintln!(
        "REHEARSAL {stage} device={} vault={} edits_before={} edits_after={} ids_order={} ids_set={} keys_before={} keys_after={} keys_equal={} policy_equal={} vaults_equal={} shares_equal={} entries_equal={} records_before={} records_after={} records_order={} records_by_id={}",
        expected.device == actual.device,
        expected.vault == actual.vault,
        expected.ids.len(),
        actual.ids.len(),
        expected.ids == actual.ids,
        same_set,
        expected.keys.len(),
        actual.keys.len(),
        expected.keys == actual.keys,
        expected.state == actual.state,
        expected.state.vaults() == actual.state.vaults(),
        expected.state.shares() == actual.state.shares(),
        expected.state.entries() == actual.state.entries(),
        expected.records.len(),
        actual.records.len(),
        expected.records == actual.records,
        a == b
    );
    expected == actual
}
fn set_digest(mut ids: Vec<[u8; 32]>, purpose: &str) -> [u8; 32] {
    ids.sort();
    let mut h = hash::Hasher::new(purpose);
    h.update(&(ids.len() as u64).to_be_bytes());
    for id in ids {
        h.update(&id);
    }
    h.finalize()
}
fn check_inventory(root: &Path, observed: &Observed) -> Result<()> {
    let baseline: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join(".avendb-release-inventory.json"))?)?;
    ensure!(
        baseline["edits"].as_u64() == Some(observed.ids.len() as u64),
        "first restore did not preserve pre-upgrade edit count"
    );
    ensure!(
        baseline["keys"].as_u64() == Some(observed.keys.len() as u64),
        "first restore did not preserve pre-upgrade key count"
    );
    ensure!(
        baseline["edit_digest"]
            == json!(set_digest(
                observed.ids.iter().map(|id| id.0).collect(),
                "release rehearsal edit set 1"
            )),
        "first restore did not preserve the complete pre-upgrade edit-ID set"
    );
    ensure!(
        baseline["key_digest"]
            == json!(set_digest(
                observed.keys.iter().map(|id| id.0).collect(),
                "release rehearsal key set 1"
            )),
        "first restore did not preserve the complete pre-upgrade key-ID set"
    );
    Ok(())
}

const COUNT_LABELS: &[&str] = &[
    "replay: from its stored view",
    "stored view: none that opens",
    "refresh rounds",
    "edits offered",
    "edits checked",
    "keys from the shelf",
    "keys opened",
    "replay whole: a checkpoint came",
    "replay whole: a checkpoint it held covers a new edit",
    "replay whole: a move among its last edits kept a new edit out",
    "replay whole: a move among its last edits stood not",
    "replay whole: a move it held stood not",
    "replay whole: a move keeps not every write of its entry",
    "replay whole: a new edit as deep as a new move",
    "replay whole: a new edit builds on another new one as deep",
    "replay whole: a new edit sorts before its place",
    "replay whole: a new grant rests on one a revocation names",
    "replay whole: a removal came",
    "replay whole: a snapshot came",
    "replay whole: an edit it held builds on a new one",
    "replay whole: fewer edits than it held",
    "replay whole: its removals rank otherwise",
    "replay whole: its tail ran out",
    "replay whole: no base to resolve on",
    "replay whole: no place to step on from",
    "replay whole: the first since it opened",
];

/// Only numeric engine metrics with fixed source labels leave the disposable fixture.
/// Timers are nested (refresh includes replay/read/etc.); do not sum them as wall time.
fn startup_metrics(perf: &serde_json::Value) -> serde_json::Value {
    let mut out = json!({"timers": {}, "counts": {}});
    for label in ["check", "open view", "replay", "open keys", "read", "show items", "upkeep", "refresh"] {
        for field in ["count", "total_ms", "max_ms"] {
            if let Some(value) = perf["timers"][label][field].as_f64().filter(|n| n.is_finite() && *n >= 0.0) {
                out["timers"][label][field] = json!(value);
            }
        }
    }
    for label in COUNT_LABELS {
        out["counts"][*label] = json!(perf["counts"][*label].as_u64().unwrap_or(0));
    }
    out
}

/// A delta is valid only within one open device. Never subtract independent reopen counters.
fn startup_delta(before: &serde_json::Value, after: &serde_json::Value) -> serde_json::Value {
    let mut out = json!({"timers": {}, "counts": {}});
    for section in ["timers", "counts"] {
        for (label, value) in after[section].as_object().into_iter().flatten() {
            if section == "counts" {
                out[section][label] = json!(value.as_u64().unwrap_or(0).checked_sub(before[section][label].as_u64().unwrap_or(0)));
            } else {
                for field in ["count", "total_ms"] {
                    let a = value[field].as_f64().unwrap_or(0.0);
                    let b = before[section][label][field].as_f64().unwrap_or(0.0);
                    out[section][label][field] = if a >= b { json!(a - b) } else { serde_json::Value::Null };
                }
            }
        }
    }
    out
}

async fn open_timed(label: &str, start: Start, meta: &Meta, ceremony: &Ceremony) -> Result<(Device, serde_json::Value)> {
    let progress = start.progress.clone();
    let began = Instant::now();
    let device = Device::open_by_touch(start, meta, ceremony).await?;
    let open_ms = began.elapsed().as_secs_f64() * 1000.0;
    progress.end();
    let capture = Instant::now();
    let metrics = device.node().read(|lab, me| startup_metrics(&lab.work_metrics(me))).await;
    eprintln!("REHEARSAL_STARTUP {}", json!({"phase": label, "open_ms": open_ms,
        "metric_capture_ms": capture.elapsed().as_secs_f64() * 1000.0,
        "steps": avendb_browser::steps_json(&progress.steps()), "metrics": metrics}));
    Ok((device, metrics))
}

async fn observe_timed(label: &str, device: &Device, before: &serde_json::Value) -> Result<Observed> {
    let began = Instant::now();
    let observed = observe(device).await?;
    let observe_ms = began.elapsed().as_secs_f64() * 1000.0;
    let after = device.node().read(|lab, me| startup_metrics(&lab.work_metrics(me))).await;
    eprintln!("REHEARSAL_OBSERVE {}", json!({"phase": label, "observe_ms": observe_ms,
        "metrics_delta": startup_delta(before, &after)}));
    Ok(observed)
}

async fn run() -> Result<()> {
    let root = copy_root()?;
    ensure!(
        root.join(".avendb-release-inventory.json").is_file(),
        "pre-open inventory required"
    );
    let immutable = immutable_files(&root)?;
    let shelf = disk::open(&root)?;
    let meta = Meta::load(&shelf)
        .await?
        .context("existing Meta required")?;
    let auth_started = Instant::now();
    let ceremony = touch(&meta)?;
    eprintln!("REHEARSAL_AUTH ceremony_ms={:.3}", auth_started.elapsed().as_secs_f64() * 1000.0);
    // An unused loopback TCP listener prevents accidental use of any real relay.
    // direct=false creates no UDP transport; no discovery provider is installed.
    let guard = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let relay: iroh::RelayUrl = format!("http://{}/", guard.local_addr()?).parse()?;
    let start = || -> Result<Start> {
        let mut entropy = [0; 32];
        getrandom::fill(&mut entropy).map_err(|_| anyhow::anyhow!("entropy unavailable"))?;
        Ok(Start {
            name: meta.name.clone(),
            relay: relay.clone(),
            entropy,
            now: SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
            direct: false,
            shelf: Some(shelf.clone()),
            progress: Progress::new(),
            recovery: None,
            on_node: None,
        })
    };
    let began = Instant::now();
    let (first, first_metrics) = open_timed("cold", start()?, &meta, &ceremony).await?;
    ensure!(
        first.node().device() == meta.device,
        "existing device identity changed"
    );
    ensure!(
        first.node().endpoint().bound_sockets().is_empty(),
        "rehearsal must have no UDP socket"
    );
    let expected = observe_timed("cold", &first, &first_metrics).await?;
    check_inventory(&root, &expected)?;
    ensure!(
        !expected.ids.is_empty() && !expected.records.is_empty(),
        "rehearsal did not recover existing data"
    );
    let cold = began.elapsed();
    eprintln!(
        "REHEARSAL cold inventory verified edits={} keys={} visible_records={} seconds={:.3}",
        expected.ids.len(),
        expected.keys.len(),
        expected.records.len(),
        cold.as_secs_f64()
    );
    first.close().await?;
    let stable_close = compare("closed", &expected, &observe(&first).await?);
    let began = Instant::now();
    let (warm, warm_metrics) = open_timed("warm-1", start()?, &meta, &ceremony).await?;
    ensure!(
        warm_metrics["counts"]["replay: from its stored view"].as_u64() == Some(1),
        "clean reopen did not exercise its stored view"
    );
    let stable_warm = compare("warm", &expected, &observe_timed("warm-1", &warm, &warm_metrics).await?);
    let warm_time = began.elapsed();
    warm.close().await?;
    // A second reopen of the same binary and shelf separates first-upgrade invalidation
    // from repeated same-build work. Each fresh Lab has independent counters.
    let (warm2, warm2_metrics) = open_timed("warm-2", start()?, &meta, &ceremony).await?;
    ensure!(warm2_metrics["counts"]["replay: from its stored view"].as_u64() == Some(1),
        "second same-build reopen did not exercise its stored view");
    let stable_warm2 = compare("warm-2", &expected, &observe_timed("warm-2", &warm2, &warm2_metrics).await?);
    warm2.close().await?;
    // Both derived views and opened-key slots are disposable. Simulate an interrupted
    // replacement on this clone and require full authenticated history recovery.
    let generation = *disk::generations(&root)?
        .last()
        .context("generation absent")?;
    let mut damaged = 0;
    for name in ["view-0", "view-1", "keys-0", "keys-1"] {
        let path = root.join(format!("g{generation}/slots/{name}"));
        if path.exists() {
            std::fs::write(path, b"interrupted derived snapshot")?;
            damaged += 1;
        }
    }
    ensure!(damaged != 0, "no persisted derived slots exercised");
    let began = Instant::now();
    let (recovered, recovery_metrics) = open_timed("recovery", start()?, &meta, &ceremony).await?;
    ensure!(
        recovery_metrics["counts"]["replay: from its stored view"].as_u64().unwrap_or(0) == 0,
        "corrupted-slot reopen did not exercise full replay fallback"
    );
    let stable_recovered = compare("recovered", &expected, &observe_timed("recovery", &recovered, &recovery_metrics).await?);
    let recovery = began.elapsed();
    recovered.close().await?;
    ensure!(
        Meta::load(&shelf).await?.is_some_and(|m| m == meta),
        "account metadata changed"
    );
    for (name, sum) in immutable {
        ensure!(
            hash::content(&std::fs::read(root.join(name))?) == sum,
            "pre-existing immutable history or metadata changed"
        );
    }
    ensure!(
        stable_close && stable_warm && stable_warm2 && stable_recovered,
        "reopen/recovery differed; see aggregate component checks"
    );
    eprintln!(
        "REHEARSAL passed identity=true metadata=true immutable_history=true edits={} keys={} visible_records={} damaged_slots={} cold_s={:.3} warm_s={:.3} recovery_s={:.3}",
        expected.ids.len(),
        expected.keys.len(),
        expected.records.len(),
        damaged,
        cold.as_secs_f64(),
        warm_time.as_secs_f64(),
        recovery.as_secs_f64()
    );
    Ok(())
}
#[test]
#[ignore = "requires a marked APFS copy and the owner's real Touch ID; never run against the live store"]
fn existing_mac_identity_survives_upgrade_reopen_and_interrupted_derived_slots() {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .thread_stack_size(8 << 20)
        .enable_all()
        .build()
        .unwrap()
        .block_on(run())
        .unwrap();
}


#[cfg(test)]
mod isolation_tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "avendb-rehearsal-isolation-{}-{}-{}",
                std::process::id(),
                SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),
                NEXT.fetch_add(1, Ordering::Relaxed),
            ));
            std::fs::create_dir(&path).unwrap();
            std::fs::create_dir_all(path.join("copy/g0/slots")).unwrap();
            std::fs::write(path.join("outside"), b"untouched").unwrap();
            Self(path)
        }
        fn root(&self) -> PathBuf { self.0.join("copy") }
        fn slot(&self) -> PathBuf { self.root().join("g0/slots/view-0") }
        fn outside(&self) -> PathBuf { self.0.join("outside") }
    }
    impl Drop for Fixture {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn independent_tree_is_accepted() {
        let fixture = Fixture::new();
        std::fs::write(fixture.slot(), b"independent").unwrap();
        isolated_tree(&fixture.root()).unwrap();
    }

    #[test]
    fn nested_slot_symlink_is_refused_without_touching_target() {
        let fixture = Fixture::new();
        symlink(fixture.outside(), fixture.slot()).unwrap();
        let error = isolated_tree(&fixture.root()).unwrap_err();
        assert!(error.to_string().contains("symlink"));
        assert_eq!(std::fs::read(fixture.outside()).unwrap(), b"untouched");
    }

    #[test]
    fn nested_slot_hardlink_is_refused_without_touching_target() {
        let fixture = Fixture::new();
        std::fs::hard_link(fixture.outside(), fixture.slot()).unwrap();
        let error = isolated_tree(&fixture.root()).unwrap_err();
        assert!(error.to_string().contains("hard links"));
        assert_eq!(std::fs::read(fixture.outside()).unwrap(), b"untouched");
    }
}

#[cfg(test)]
mod startup_metrics_tests {
    use super::*;

    #[test]
    fn only_fixed_numeric_metrics_are_reported() {
        let report = startup_metrics(&json!({
            "secret": "never report", "counts": {"refresh rounds": 3, "private label": 7},
            "timers": {"replay": {"count": 2, "total_ms": 4.5, "max_ms": 3.0, "secret": 1},
                "private stage": {"total_ms": 99}, "read": {"total_ms": "sensitive"}}
        }));
        assert_eq!(report["counts"]["refresh rounds"], 3);
        assert_eq!(report["timers"]["replay"]["total_ms"], 4.5);
        assert!(report["timers"]["read"].is_null());
        let text = report.to_string();
        for forbidden in ["private", "secret", "sensitive", "never report"] {
            assert!(!text.contains(forbidden));
        }
    }

    #[test]
    fn observe_delta_excludes_startup_work_and_nonadditive_maximum() {
        let before = startup_metrics(&json!({"counts": {"refresh rounds": 4},
            "timers": {"replay": {"count": 3, "total_ms": 15.0, "max_ms": 12.0}}}));
        let after = startup_metrics(&json!({"counts": {"refresh rounds": 6},
            "timers": {"replay": {"count": 4, "total_ms": 17.5, "max_ms": 12.0}}}));
        let delta = startup_delta(&before, &after);
        assert_eq!(delta["counts"]["refresh rounds"], 2);
        assert_eq!(delta["timers"]["replay"]["total_ms"], 2.5);
        assert_eq!(delta["timers"]["replay"]["count"], 1.0);
        assert!(delta["timers"]["replay"]["max_ms"].is_null());
    }

    #[test]
    fn reset_counters_are_invalid_deltas_not_fake_zero_work() {
        let before = startup_metrics(&json!({"counts": {"refresh rounds": 9},
            "timers": {"replay": {"count": 4, "total_ms": 12.0}}}));
        let after = startup_metrics(&json!({"counts": {"refresh rounds": 1},
            "timers": {"replay": {"count": 1, "total_ms": 3.0}}}));
        let delta = startup_delta(&before, &after);
        assert!(delta["counts"]["refresh rounds"].is_null());
        assert!(delta["timers"]["replay"]["count"].is_null());
        assert!(delta["timers"]["replay"]["total_ms"].is_null());
    }
}
