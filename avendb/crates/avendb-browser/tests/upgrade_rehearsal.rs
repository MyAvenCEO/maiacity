//! Manual release gate on an APFS clone, never the installed store. The helper is
//! built from the app's existing Enclave.swift plus scripts/rehearsal-touch.swift.
//! It only signs with existing Touch ID keys; no account or key is created.
#![cfg(target_os = "macos")]
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
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
    Ok(root)
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
    let ceremony = touch(&meta)?;
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
        })
    };
    let began = Instant::now();
    let first = Device::open_by_touch(start()?, &meta, &ceremony).await?;
    ensure!(
        first.node().device() == meta.device,
        "existing device identity changed"
    );
    ensure!(
        first.node().endpoint().bound_sockets().is_empty(),
        "rehearsal must have no UDP socket"
    );
    let expected = observe(&first).await?;
    check_inventory(&root, &expected)?;
    ensure!(
        !expected.ids.is_empty() && !expected.records.is_empty(),
        "rehearsal did not recover existing data"
    );
    let cold = began.elapsed();
    first.close().await?;
    let began = Instant::now();
    let warm = Device::open_by_touch(start()?, &meta, &ceremony).await?;
    ensure!(
        observe(&warm).await? == expected,
        "clean reopen changed identity, history, keys, policy or visible records"
    );
    let warm_time = began.elapsed();
    warm.close().await?;
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
    let recovered = Device::open_by_touch(start()?, &meta, &ceremony).await?;
    ensure!(
        observe(&recovered).await? == expected,
        "corrupt-slot fallback changed recovered data"
    );
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
