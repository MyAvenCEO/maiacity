//! A drive's own device (`docs/ARCHITECTURE.md` §3, "A drive's own device"): each external drive the person uses for
//! avenDB is a device of their own vault, as a phone is, on the same sync, shares, copy setting and holdings as every
//! other. Nothing in sync knows it is a drive: it is one more node.
//!
//! - **Where it lives.** Its store is a folder on the drive, `<volume>/.avendb/`, its shelves laid out as the Mac's
//!   folder lays out its own (`avendb_net::disk`): ciphertext, signed edits, public keys, and what opens it again
//!   (`avendb_browser::Meta`). The rest of the drive is the person's and stays as it is.
//! - **Its key.** It has a key of its own, 32 random bytes, never on the drive in plain. Its store keeps them masked by
//!   the PRF output of the person's passkey on the drive's own salt (`Fresh::mask`), as every device keeps its secret:
//!   one ceremony of that passkey opens it on any Mac of theirs. And the shelf of each Mac that hosts it keeps them
//!   wrapped under a key that Mac's device alone derives from its own (`drives/<device>`, `keys::wrap` under
//!   `Lab::own_key`), so that Mac opens it silently while its own device is open: plugging it in asks for nothing.
//! - **Joining** (`join`): one ceremony of the passkey, which unlocks the new device and is its pass, signs the edit
//!   that adds it to the person's vault, as a new phone links (`Node::link_by_pass`), through the Mac's own device.
//!   The drive is a full copy, unless the person picks a light one, and writes its card with its name.
//! - **Hosted.** While it is plugged into a Mac that holds its key, that Mac's device runs it as a second node beside
//!   its own (`Hosted`), on the drive's shelf. The Mac looks at its volumes every few seconds (`LOOK`): macOS mounts
//!   them in `/Volumes` (`VOLUMES`), a test in a folder of its own. A drive unplugged stops its node, and its last
//!   signed statement of what it holds stays with the person's other devices, which show when it checked. Plugged in
//!   again, it is hosted again at once.
//! - **Ejected** (`eject`): the page's Eject stops the drive's node and lets go of every file on it, then has macOS
//!   eject the volume (`diskutil eject`), so Finder never finds it in use. A volume ejected here stays unhosted until
//!   it is unmounted, or opened here again (`open`). macOS's own Eject in Finder isn't heard: the Mac learns of it only
//!   as the volume goes, at its next look.
//! - **Moved** (K3b): a drive made before the key move moves to ML-DSA-65 with the Mac that hosts it, in the same
//!   sheet and touch (`Service::hold_drives`, `Service::moved_drives`): its node stopped, it joins as its next key,
//!   which takes over its copy setting, its old key stays in the vault beside it, its store and the Mac's shelf name
//!   its next key, and the Mac hosts it as that key from then on.
//! - **Removed** like a lost phone: the device is revoked (`{"op": "revoke", "vault", "device"}`), its peers refuse
//!   it from then on, and the Mac hosts it no more.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::id::SignerId;
use avendb::keys::{self, SeededRng, Secret};
use avendb::lab::Lab;
use avendb::sign::DeviceKey;
use avendb::world;
use avendb_browser::{Device, Fresh, Meta, Start, Unlock};
use avendb_net::{Node, Options, Shelf, disk};
use bytes::Bytes;
use iroh::{EndpointId, RelayUrl};
use serde_json::{Value, json};
use tokio::task::JoinHandle;
use zeroize::Zeroizing;

use crate::{Service, Sheets, hex, now, random};

/// The folder on a volume that holds its drive's store.
pub const STORE: &str = ".avendb";

/// Where macOS mounts volumes.
pub const VOLUMES: &str = "/Volumes";

/// How often the Mac looks for drives plugged in and unplugged.
pub const LOOK: Duration = Duration::from_secs(3);

/// How many times the Mac asks macOS to eject a drive, and how long it waits between.
const EJECT_TRIES: usize = 3;
const EJECT_AGAIN: Duration = Duration::from_millis(700);

/// Where the Mac's shelf keeps the key of each drive it hosts, and what it is wrapped under (`Kept`):
/// `drives/<device>`.
const KEY: Kept = Kept { under: "drives/", purpose: "drive key", info: b"avenDB drive " };

/// The key of a device the Mac hosts beside its own, a drive's (`KEY`), as the Mac's shelf keeps it: wrapped under a
/// key the Mac's device alone derives from its own (`Lab::own_key`), so that the Mac opens it silently while its own
/// device is open (`Service::wrap_key`).
pub(crate) struct Kept {
    /// Where on the Mac's shelf, before the device's id in hex: `drives/<device>`.
    pub(crate) under: &'static str,
    /// What the key it is wrapped under is derived for (`Lab::own_key`), beside the device.
    pub(crate) purpose: &'static str,
    /// What it is bound to as it is wrapped, before the device's id.
    pub(crate) info: &'static [u8],
}

impl Kept {
    /// The name on the Mac's shelf of device `device`'s key, wrapped.
    fn name(&self, device: SignerId) -> String {
        format!("{}{}", self.under, device.to_hex())
    }

    /// What device `device`'s key is bound to as it is wrapped.
    fn info(&self, device: SignerId) -> Vec<u8> {
        [self.info, &device.0].concat()
    }

    /// The devices whose keys shelf `shelf` keeps, wrapped.
    pub(crate) async fn on(&self, shelf: &Shelf) -> Result<Vec<SignerId>> {
        let names = shelf.names(self.under).await?;
        Ok(names.iter().filter_map(|n| n.strip_prefix(self.under).and_then(SignerId::from_hex)).collect())
    }
}

/// A Lab for a device the Mac hosts beside its own, a drive's, by its key `secret`, named `name`, which
/// knows the master recovery key, as every device's Lab does (`Start::recovery`): the Lab, and the device: `device`,
/// in its own suite (`Lab::device_as`), or a new one, in the suite new signers are made in. Fails if `secret` is
/// another device's key than `device`'s.
pub(crate) fn lab_of(name: &str, secret: &[u8; 32], device: Option<SignerId>) -> Result<(Lab, SignerId)> {
    let mut lab = Lab::with_entropy(random()?);
    if let Some(key) = Start::recovery() {
        lab.set_recovery(key);
    }
    let me = match device {
        Some(d) => lab.device_as(name, *secret, d).context("the key opens another device than this drive's")?,
        None => lab.device_with(name, *secret),
    };
    Ok((lab, me))
}

/// Node `node`, hosted beside the Mac's own device `d`: each knows where the other is, and they sync at once.
pub(crate) fn beside(d: &Arc<Device>, node: &Node) {
    node.know(d.node().addr());
    d.node().know(node.addr());
    let (mac, endpoint) = (d.clone(), node.id());
    tokio::spawn(async move { mac.node().sync_with(endpoint).await.ok() });
}

/// The store on `volume`.
pub fn store(volume: &Path) -> PathBuf {
    volume.join(STORE)
}

/// The volumes mounted in folder `root` that could be a drive: each folder in it, but a hidden one, the system's own
/// (`com.apple.…`), a link, as macOS links the startup disk there, and one mounted read-only, as an installer's disk
/// image is, which can hold no store; by name.
pub fn volumes(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else { return vec![] };
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            // a link isn't a folder here: the type of the entry itself, not what it leads to
            !name.starts_with('.') && !name.starts_with("com.apple.") && e.file_type().is_ok_and(|t| t.is_dir())
        })
        .map(|e| e.path())
        .filter(|path| !read_only(path))
        .collect();
    found.sort();
    found
}

/// Whether the volume at `path` is mounted read-only, as a disk image an installer comes on is.
#[cfg(unix)]
fn read_only(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt as _;
    let Ok(c) = std::ffi::CString::new(path.as_os_str().as_bytes()) else { return false };
    let mut fs: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `c` is a valid C string, `fs` a statvfs for the call to fill
    if unsafe { libc::statvfs(c.as_ptr(), &mut fs) } != 0 {
        return false;
    }
    (fs.f_flag as u64) & (libc::ST_RDONLY as u64) != 0
}

#[cfg(not(unix))]
fn read_only(_: &Path) -> bool {
    false
}

/// The drives of the Mac's device: the volumes it looked at, and each drive it hosts.
#[derive(Default)]
pub(crate) struct Drives {
    /// Of each volume mounted with a store on it, its shelf and what opens the drive's device, if it holds that.
    seen: Mutex<HashMap<PathBuf, Seen>>,
    /// Each drive hosted now, by its device.
    hosted: Mutex<HashMap<SignerId, Hosted>>,
    /// The volumes a join or an open is under way on, which a look leaves alone.
    busy: Mutex<HashSet<PathBuf>>,
    /// The volumes ejected here, which a look leaves alone until they are unmounted (`eject`).
    ejected: Mutex<HashSet<PathBuf>>,
    /// One look at a time.
    looking: tokio::sync::Mutex<()>,
    /// The task that looks every few seconds while the Mac's device is open.
    task: Mutex<Option<JoinHandle<()>>>,
}

/// A volume with a store on it.
#[derive(Clone)]
struct Seen {
    shelf: Shelf,
    meta: Option<Meta>,
}

/// A drive the Mac hosts: its node on its shelf, the volume it is on, its name, and whether its card is written.
struct Hosted {
    node: Arc<Node>,
    volume: PathBuf,
    name: String,
    carded: Arc<AtomicBool>,
}

/// A drive this Mac hosted as its key move began (K3b, `Service::hold_drives`): its device, its key and its store's
/// shelf.
pub(crate) struct Held {
    device: SignerId,
    secret: Zeroizing<[u8; 32]>,
    shelf: Shelf,
}

/// A volume a join or an open is under way on, until it drops.
struct Busy<'a>(&'a Drives, PathBuf);

impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.busy.lock().expect("busy").remove(&self.1);
    }
}

impl Drives {
    fn busy(&self, volume: &Path) -> Result<Busy<'_>> {
        if !self.busy.lock().expect("busy").insert(volume.to_path_buf()) {
            bail!("something is under way on this drive already");
        }
        Ok(Busy(self, volume.to_path_buf()))
    }

    fn is_busy(&self, volume: &Path) -> bool {
        self.busy.lock().expect("busy").contains(volume)
    }

    fn is_ejected(&self, volume: &Path) -> bool {
        self.ejected.lock().expect("ejected").contains(volume)
    }

    fn hosts(&self, drive: SignerId) -> bool {
        self.hosted.lock().expect("hosted").contains_key(&drive)
    }

    /// Stops looking, and every drive's node: as the Mac's device closes.
    pub(crate) async fn stop(&self) {
        if let Some(task) = self.task.lock().expect("the task").take() {
            task.abort();
        }
        let hosted: Vec<Hosted> = self.hosted.lock().expect("hosted").drain().map(|(_, h)| h).collect();
        for h in hosted {
            h.node.shutdown().await.ok();
        }
        self.seen.lock().expect("seen").clear();
    }
}

/// The XOR of `a` and `b`: a device's secret masked by the PRF output on its salt, or a mask unmasked by it.
fn xor(a: &[u8; 32], b: &[u8; 32]) -> Zeroizing<[u8; 32]> {
    let mut out = Zeroizing::new([0; 32]);
    out.iter_mut().zip(a.iter().zip(b)).for_each(|(o, (a, b))| *o = a ^ b);
    out
}

/// The devices of the vault device `d` belongs to, by its view.
async fn devices(d: &Device) -> HashSet<SignerId> {
    d.node()
        .read(|lab, me| {
            let Some(v) = lab.vault_of(me) else { return HashSet::new() };
            lab.state(me).vault(v).map(|v| v.devices.iter().copied().collect()).unwrap_or_default()
        })
        .await
}

/// What a volume is to the Mac's device, for the page: `free` (no avenDB device on it), `hosted` (one of the person's
/// drives, running here), `locked` (one of their drives whose key this Mac doesn't hold yet: one ceremony opens it),
/// `removed` (a drive taken out of their vault), `other` (another person's), `ejected` (ejected here, its node stopped
/// and nothing on it open, but still mounted) or `busy`.
fn state_of(seen: Option<&Seen>, p256: &[u8; 33], mine: &HashSet<SignerId>, hosted: bool, busy: bool, ejected: bool) -> &'static str {
    match seen.and_then(|s| s.meta.as_ref()) {
        _ if busy => "busy",
        _ if ejected => "ejected",
        None => "free",
        Some(m) if m.p256 != *p256 => "other",
        Some(m) if !mine.contains(&m.device) => "removed",
        Some(_) if hosted => "hosted",
        Some(_) => "locked",
    }
}

impl Service {
    /// Starts looking at the volumes every `LOOK`, while the Mac's device is open, if it looks at any.
    pub(crate) fn watch_drives(self: &Arc<Self>) {
        if self.config.volumes.is_none() {
            return;
        }
        let service: Weak<Service> = Arc::downgrade(self);
        let task = tokio::spawn(async move {
            loop {
                let Some(s) = service.upgrade() else { break };
                if let Err(e) = s.look().await {
                    tracing::warn!("looking at the drives: {e:#}");
                }
                drop(s);
                tokio::time::sleep(LOOK).await;
            }
        });
        if let Some(old) = self.drives.task.lock().expect("the task").replace(task) {
            old.abort();
        }
    }

    /// One look at the volumes: a drive unplugged, or taken out of the vault, stops; a volume with a store on it is
    /// read; a drive of the person's whose key this Mac holds is hosted at once; and each drive hosted settles: its
    /// copy setting, and its card.
    pub(crate) async fn look(self: &Arc<Self>) -> Result<()> {
        let (Some(root), Ok(d)) = (self.config.volumes.clone(), self.device()) else { return Ok(()) };
        let _one = self.drives.looking.lock().await;
        let mounted = volumes(&root);
        let mine = devices(&d).await;
        let gone: Vec<Hosted> = {
            let mut hosted = self.drives.hosted.lock().expect("hosted");
            let out: Vec<SignerId> = hosted
                .iter()
                .filter(|(drive, h)| !mounted.contains(&h.volume) || !store(&h.volume).is_dir() || !mine.contains(drive))
                .map(|(drive, _)| *drive)
                .collect();
            out.iter().filter_map(|drive| hosted.remove(drive)).collect()
        };
        for h in gone {
            tracing::info!("the drive {} is unplugged or removed: its node stops", h.name);
            h.node.shutdown().await.ok();
        }
        self.drives.seen.lock().expect("seen").retain(|volume, _| mounted.contains(volume));
        self.drives.ejected.lock().expect("ejected").retain(|volume| mounted.contains(volume));
        for volume in &mounted {
            let known = self.drives.seen.lock().expect("seen").contains_key(volume);
            let left = self.drives.is_busy(volume) || self.drives.is_ejected(volume);
            if known || left || !store(volume).is_dir() {
                continue;
            }
            let shelf = disk::open(&store(volume))?;
            let meta = Meta::load(&shelf).await.ok().flatten();
            self.drives.seen.lock().expect("seen").insert(volume.clone(), Seen { shelf, meta });
        }
        let seen: Vec<(PathBuf, Seen)> =
            self.drives.seen.lock().expect("seen").iter().map(|(v, s)| (v.clone(), s.clone())).collect();
        for (volume, Seen { shelf, meta }) in seen {
            let Some(meta) = meta else { continue };
            let theirs = meta.p256 == d.p256() && mine.contains(&meta.device);
            let left = self.drives.is_busy(&volume) || self.drives.is_ejected(&volume);
            if !theirs || self.drives.hosts(meta.device) || left {
                continue;
            }
            if let Some(secret) = self.unwrap_key(&d, &KEY, meta.device).await
                && let Err(e) = self.host(&d, volume, shelf, &meta, secret).await
            {
                tracing::warn!("the drive {} isn't hosted: {e:#}", meta.name);
            }
        }
        self.settle(&d).await;
        Ok(())
    }

    /// Each drive hosted, settled: a full copy until the person picks a light one, and its card, so that the
    /// person's devices show it by name, once it holds its vault's key.
    async fn settle(&self, d: &Device) {
        let hosted: Vec<(SignerId, Arc<Node>, String, Arc<AtomicBool>)> = {
            let hosted = self.drives.hosted.lock().expect("hosted");
            hosted.iter().map(|(id, h)| (*id, h.node.clone(), h.name.clone(), h.carded.clone())).collect()
        };
        for (drive, node, name, carded) in hosted {
            let copied = d.node().read(move |lab, me| lab.state(me).copy_of(drive).next().is_some()).await;
            if !copied {
                let full = json!({ "op": "copy", "device": hex(&drive.0), "full": true });
                if let Err(e) = d.op(full).await {
                    tracing::warn!("the drive {name}'s copy setting isn't written: {e:#}");
                }
            }
            if carded.load(Ordering::Relaxed) {
                continue;
            }
            let has = |lab: &Lab, me| lab.vault_of(me).is_some_and(|v| world::cards(lab, me, v).contains_key(&me));
            if node.read(has).await {
                carded.store(true, Ordering::Relaxed);
                continue;
            }
            match node.op(json!({ "op": "card", "name": name })).await {
                Ok(out) if out.get("ok").is_some() => {}
                Ok(out) => tracing::warn!("the drive {name}'s card is refused: {out}"),
                Err(e) => tracing::warn!("the drive {name}'s card isn't written: {e:#}"),
            }
        }
    }

    /// The volumes mounted and the drives joined here, for the page: each volume by its path and name, what it is to
    /// this Mac (`state_of`) and the device on it, if any; each drive whose key this Mac holds and that is a device of
    /// the person's vault still, whether it is plugged in, on which volume, its name there, and when it last checked
    /// what it holds, by its newest signed statement this Mac's device keeps. A drive the key move kept beside its next
    /// key (`Lab::earlier_keys`) is listed once, as its next key, where this Mac holds that.
    pub(crate) async fn drives(self: &Arc<Self>) -> Result<Value> {
        let d = self.device()?;
        let Some(root) = self.config.volumes.clone() else { return Ok(json!({ "volumes": [], "drives": [] })) };
        self.look().await?;
        let mine = devices(&d).await;
        let p256 = d.p256();
        let seen = self.drives.seen.lock().expect("seen").clone();
        let mut volumes_json = vec![];
        for volume in volumes(&root) {
            let s = seen.get(&volume);
            let device = s.and_then(|s| s.meta.as_ref()).map(|m| m.device);
            let hosted = device.is_some_and(|x| self.drives.hosts(x));
            let (busy, ejected) = (self.drives.is_busy(&volume), self.drives.is_ejected(&volume));
            let state = state_of(s, &p256, &mine, hosted, busy, ejected);
            let name = volume.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            volumes_json.push(json!({
                "path": volume.to_string_lossy(),
                "name": name,
                "state": state,
                "device": device.map(|x| hex(&x.0)),
            }));
        }
        let known: Vec<SignerId> = KEY.on(&self.shelf()).await?.into_iter().filter(|id| mine.contains(id)).collect();
        let earlier = {
            let known: BTreeSet<SignerId> = known.iter().copied().collect();
            d.node().read(move |lab, me| lab.earlier_keys(me, &known)).await
        };
        let known = known.iter().copied().filter(|id| earlier.get(id).is_none_or(|next| !known.contains(next)));
        let mut drives_json = vec![];
        for drive in known {
            let on = seen.iter().find(|(_, s)| s.meta.as_ref().is_some_and(|m| m.device == drive));
            let plugged = self.drives.hosts(drive);
            let checked = d.node().statement_of(drive).map(|s| s.checked);
            drives_json.push(json!({
                "device": hex(&drive.0),
                "name": on.and_then(|(_, s)| s.meta.as_ref()).map(|m| m.name.clone()),
                "volume": on.map(|(v, _)| v.to_string_lossy().into_owned()),
                "plugged": plugged,
                "checked": checked,
            }));
        }
        Ok(json!({ "volumes": volumes_json, "drives": drives_json }))
    }

    /// The volume at `path`, if it is one mounted in the volumes' folder.
    fn mounted(&self, path: &str) -> Result<PathBuf> {
        let root = self.config.volumes.as_ref().context("this Mac looks at no drives")?;
        let path = PathBuf::from(path);
        if !volumes(root).contains(&path) {
            bail!("no drive is plugged in at {}", path.display());
        }
        Ok(path)
    }

    /// Uses the drive at volume `path` for avenDB, as a device of the person's vault named `name`, in one ceremony of
    /// their passkey in the sheet: the unlock of its new key, which is its pass and signs the edit that adds it, as a
    /// new phone links (`Node::link_by_pass`), through this Mac's own device. What opens it again goes on its store, its
    /// key masked by the passkey's PRF output on its own salt; its key goes on this Mac's shelf too, wrapped under a key
    /// of this Mac's own (`wrap_key`); and this Mac hosts it from then on. What a drive taken out of the vault held is
    /// put aside on it, never deleted. `{"device"}`. Fails for a drive that is one of the person's devices already, or
    /// another person's.
    pub(crate) async fn join_drive(self: &Arc<Self>, path: &str, name: &str) -> Result<Value> {
        let d = self.device()?;
        let volume = self.mounted(path)?;
        let fallback = volume.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let name = Some(name.trim()).filter(|n| !n.is_empty()).unwrap_or(&fallback).to_string();
        let _busy = self.drives.busy(&volume)?;
        let host = Meta::load(&self.shelf()).await?.context("this Mac holds no avenDB account")?;
        let at = store(&volume);
        if at.is_dir() {
            let shelf = disk::open(&at)?;
            if let Some(meta) = Meta::load(&shelf).await? {
                if meta.p256 != d.p256() {
                    bail!("this drive is another person's avenDB device");
                }
                if devices(&d).await.contains(&meta.device) {
                    bail!("this drive is one of your devices already");
                }
            }
            let held = !shelf.names("").await?.is_empty();
            drop(shelf);
            if held {
                disk::aside(&at)?;
            }
        }
        std::fs::create_dir_all(&at).with_context(|| format!("avenDB's folder on the drive, {}", at.display()))?;
        let shelf = disk::open(&at)?;
        // a new device, its key its own
        let (secret, nonce, now) = (Zeroizing::new(random()?), random()?, now());
        let fresh = Fresh::from_secret(*secret);
        let sheets = Sheets::new(self.clone(), Some(host.credential.clone()));
        let unlock = sheets.unlock("drive", nonce, fresh.challenge(now)).await?;
        let mask = fresh.mask(&unlock);
        let Unlock { ceremony, .. } = unlock;
        let (mut lab, me) = lab_of(&name, &secret, None)?;
        lab.web_passkey("the person", d.p256(), &ceremony).context("the sheet's passkey isn't this Mac's")?;
        // in each suite, as its person's vault may know their passkey in either (the key move)
        let passes = ceremony.passes(fresh.keys(), now);
        anyhow::ensure!(!passes.is_empty(), "the sheet's ceremony isn't over the drive's challenge");
        let relay: RelayUrl = host.relay.parse().map_err(|_| anyhow!("the relay's URL isn't one"))?;
        let opts = Options {
            bind: None,
            direct: self.config.direct,
            relay: Some(relay),
            relay_passes: passes.clone(),
            shelf: Some(shelf.clone()),
            ..Options::local()
        };
        let node = Arc::new(Node::spawn(lab, me, opts).await?);
        if let Err(e) = node.link_by_pass(&d.node().offer(), &passes, ceremony).await {
            node.shutdown().await.ok();
            return Err(e.context("the drive doesn't join your vault"));
        }
        // what opens it again, on its store, as every device keeps it; and its key, wrapped for this Mac
        let (relay, credential) = (host.relay.clone(), host.credential.clone());
        let (p256, follow, query_depth) = (d.p256(), vec![], None);
        let device = me;
        let meta = Meta { name: name.clone(), relay, nonce, mask, credential, p256, device, follow, query_depth, touch: None };
        meta.keep(&shelf).await?;
        self.wrap_key(&d, &KEY, me, &secret).await?;
        let _one = self.drives.looking.lock().await;
        self.drives.seen.lock().expect("seen").insert(volume.clone(), Seen { shelf, meta: Some(meta) });
        self.hosting(&d, volume, name, node);
        drop(_one);
        self.settle(&d).await;
        Ok(json!({ "device": hex(&me.0) }))
    }

    /// Opens the drive at volume `path` on this Mac, one of the person's that another Mac of theirs joined, in one
    /// ceremony of their passkey in the sheet: its PRF output on the drive's salt unmasks the drive's key; then this
    /// Mac wraps it under a key of its own, as for a drive it joined, and hosts it, from then on without a ceremony.
    /// A drive ejected here and still mounted opens again with none. `{"device"}`. Fails for a drive that holds no
    /// device of the person's vault, or whose key the passkey doesn't open.
    pub(crate) async fn open_drive(self: &Arc<Self>, path: &str) -> Result<Value> {
        let d = self.device()?;
        let volume = self.mounted(path)?;
        let _busy = self.drives.busy(&volume)?;
        self.drives.ejected.lock().expect("ejected").remove(&volume);
        let at = store(&volume);
        if !at.is_dir() {
            bail!("this drive holds no avenDB device");
        }
        let shelf = disk::open(&at)?;
        let meta = Meta::load(&shelf).await?.context("this drive holds no avenDB device")?;
        if meta.p256 != d.p256() {
            bail!("this drive is another person's avenDB device");
        }
        if !devices(&d).await.contains(&meta.device) {
            bail!("this drive was taken out of your vault: use it for avenDB again");
        }
        if !self.drives.hosts(meta.device) {
            let secret = match self.unwrap_key(&d, &KEY, meta.device).await {
                Some(secret) => secret,
                None => {
                    let sheets = Sheets::new(self.clone(), Some(meta.credential.clone()));
                    let unlock = sheets.unlock("drive", meta.nonce, random()?).await?;
                    let secret = xor(&meta.mask, &unlock.device);
                    if DeviceKey::of(*secret, meta.device).is_none() {
                        bail!("your passkey doesn't open this drive");
                    }
                    self.wrap_key(&d, &KEY, meta.device, &secret).await?;
                    secret
                }
            };
            let _one = self.drives.looking.lock().await;
            self.host(&d, volume.clone(), shelf.clone(), &meta, secret).await?;
            self.drives.seen.lock().expect("seen").insert(volume, Seen { shelf, meta: Some(meta.clone()) });
        }
        Ok(json!({ "device": hex(&meta.device.0) }))
    }

    /// Ejects the volume at `path`: the node of the drive hosted on it stops and lets go of every file on the drive,
    /// what this Mac read of its store is dropped, and the volume stays unhosted until it is unmounted or opened here
    /// again; then, on a Mac, macOS ejects it (`diskutil eject`), so Finder never finds it in use. The drive's last
    /// signed statement of what it holds stays, and shows when it checked. `{"ejected"}`, the volume. Fails, its node
    /// stopped all the same, if macOS doesn't eject it, as when another app holds a file on it open.
    pub(crate) async fn eject_drive(self: &Arc<Self>, path: &str) -> Result<Value> {
        let volume = self.mounted(path)?;
        let _busy = self.drives.busy(&volume)?;
        {
            // no look in between: what it would host again is ejected first
            let _one = self.drives.looking.lock().await;
            self.drives.ejected.lock().expect("ejected").insert(volume.clone());
            let on: Vec<Hosted> = {
                let mut hosted = self.drives.hosted.lock().expect("hosted");
                let ids: Vec<SignerId> = hosted.iter().filter(|(_, h)| h.volume == volume).map(|(id, _)| *id).collect();
                ids.iter().filter_map(|id| hosted.remove(id)).collect()
            };
            for h in on {
                tracing::info!("the drive {} is ejected: its node stops", h.name);
                h.node.shutdown().await.ok();
            }
            self.drives.seen.lock().expect("seen").remove(&volume);
        }
        eject(&volume).await?;
        Ok(json!({ "ejected": volume.to_string_lossy() }))
    }

    /// The drives hosted now, each held by this Mac's device in each suite (`Lab::device_keys`), so they move with it
    /// in its key move (K3b, `Lab::moves`), once it synced with each, so it holds what each made: their devices, keys
    /// and shelves. A drive whose key this Mac's shelf doesn't open is left as it is.
    pub(crate) async fn hold_drives(&self, d: &Arc<Device>) -> Vec<Held> {
        let hosted: Vec<(SignerId, EndpointId, Option<Shelf>)> = {
            let (hosted, seen) = (self.drives.hosted.lock().expect("hosted"), self.drives.seen.lock().expect("seen"));
            let shelf = |h: &Hosted| seen.get(&h.volume).map(|s| s.shelf.clone());
            hosted.iter().map(|(drive, h)| (*drive, h.node.id(), shelf(h))).collect()
        };
        let mut held = vec![];
        for (device, endpoint, shelf) in hosted {
            d.node().sync_with(endpoint).await.ok();
            let (Some(secret), Some(shelf)) = (self.unwrap_key(d, &KEY, device).await, shelf) else { continue };
            let key = secret.clone();
            d.node().act(move |lab, _| lab.device_keys(device, *key)).await;
            held.push(Held { device, secret, shelf });
        }
        held
    }

    /// The drives of `held` that moved in this Mac's key move, each to its next key among `moves`
    /// (`Device::move_keys`), as its own device's next key is named before it opens again: this Mac's shelf keeps
    /// the drive's key under its next key (`wrap_key`), then the drive's store names that key (`Meta::device`), so
    /// this Mac hosts it as that key from then on, with no ceremony, as it hosts it again (`look`). A drive that moved
    /// already, as in a move cut short, stays as it is.
    pub(crate) async fn moved_drives(
        &self,
        d: &Device,
        held: Vec<Held>,
        moves: Vec<(SignerId, SignerId)>,
    ) -> Result<()> {
        for Held { device, secret, shelf } in held {
            let Some(&(_, next)) = moves.iter().find(|&&(old, _)| old == device) else { continue };
            self.wrap_key(d, &KEY, next, &secret).await?;
            let meta = Meta::load(&shelf).await?.context("the drive's store holds nothing that opens it")?;
            Meta { device: next, ..meta }.keep(&shelf).await?;
        }
        Ok(())
    }

    /// Drive `meta.device` hosted here from now on: its node on its shelf on `volume`, its key `secret`.
    async fn host(&self, d: &Arc<Device>, volume: PathBuf, shelf: Shelf, meta: &Meta, secret: Zeroizing<[u8; 32]>) -> Result<()> {
        let (mut lab, me) = lab_of(&meta.name, &secret, Some(meta.device))?;
        drop(secret);
        lab.follow(me, &meta.follow);
        if let Some(depth) = meta.query_depth {
            lab.set_query_depth(me, depth);
        }
        let relay = meta.relay.parse::<RelayUrl>().ok();
        let opts = Options { bind: None, direct: self.config.direct, relay, shelf: Some(shelf), ..Options::local() };
        let node = Arc::new(Node::spawn(lab, me, opts).await?);
        self.hosting(d, volume, meta.name.clone(), node);
        Ok(())
    }

    /// Drive node `node`, on `volume`, named `name`, hosted from now on: it and the Mac's own device know where each
    /// other is, and sync at once.
    fn hosting(&self, d: &Arc<Device>, volume: PathBuf, name: String, node: Arc<Node>) {
        beside(d, &node);
        let carded = Arc::new(AtomicBool::new(false));
        let hosted = Hosted { node: node.clone(), volume, name, carded };
        self.drives.hosted.lock().expect("hosted").insert(node.device(), hosted);
    }

    /// Keeps device `device`'s key `secret`, a drive's (`Kept`), on this Mac's shelf, wrapped under a key
    /// this Mac's device alone derives from its own (`Lab::own_key`), bound to the device: what opens it here with no
    /// ceremony. One kept already counts.
    pub(crate) async fn wrap_key(&self, d: &Device, kept: &Kept, device: SignerId, secret: &[u8; 32]) -> Result<()> {
        let purpose = kept.purpose;
        let key = d.node().read(move |lab, me| lab.own_key(me, purpose, &device.0)).await;
        let key = key.context("this Mac's device is locked")?;
        let mut rng = SeededRng::new("a hosted device's key, wrapped", &random()?);
        let wrapped = keys::wrap(&Secret::from_bytes(*secret), &key, &kept.info(device), &mut rng);
        match self.shelf().put(&kept.name(device), Bytes::from(wrapped)).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => Ok(()),
            Err(e) => Err(anyhow::Error::from(e).context("keeping the device's key on this Mac")),
        }
    }

    /// Device `device`'s key, as this Mac's shelf keeps it wrapped (`wrap_key`): none if it keeps none, or this Mac's
    /// device doesn't open it.
    pub(crate) async fn unwrap_key(&self, d: &Device, kept: &Kept, device: SignerId) -> Option<Zeroizing<[u8; 32]>> {
        let wrapped = self.shelf().get(&kept.name(device)).await.ok()??;
        let purpose = kept.purpose;
        let key = d.node().read(move |lab, me| lab.own_key(me, purpose, &device.0)).await?;
        let secret = keys::open(&wrapped, &key, &kept.info(device))?;
        Some(Zeroizing::new(secret.bytes()))
    }
}

/// Has macOS eject `volume` (`diskutil eject`), trying a few times while a read or write the drive's node began as
/// it stopped ends. Elsewhere nothing: a test's volume is a folder.
async fn eject(volume: &Path) -> Result<()> {
    if !cfg!(target_os = "macos") {
        return Ok(());
    }
    let mut why = String::new();
    for _ in 0..EJECT_TRIES {
        let at = volume.to_path_buf();
        let out = tokio::task::spawn_blocking(move || std::process::Command::new("diskutil").arg("eject").arg(&at).output())
            .await?
            .context("running diskutil")?;
        if out.status.success() {
            return Ok(());
        }
        why = String::from_utf8_lossy(&out.stderr).trim().to_string();
        tokio::time::sleep(EJECT_AGAIN).await;
    }
    bail!("macOS didn't eject the drive: {why}")
}
