//! A studio worker (`docs/ARCHITECTURE.md` §3, "A studio worker"): a machine that works on a vault's media for the
//! studio's jobs, as the Mac does as it renders a film or makes a proxy. It is a device vault of its own, owned by the
//! vault whose media it works on, the person's own vault or a coop they own or co-own such as Maia City, with a key of
//! its own and only the shares that vault gives it. So every task it claims and every entry it makes is signed by its
//! own key, and its acting chain shows which machine made it, for which vault (Samuel, 2026-10-16). It never acts with
//! the Mac's own rights.
//!
//! - **Adding one** (`addWorker [vault, name, shares]`): in one ceremony of the person's passkey at most, the Mac
//!   founds a device vault under `vault` and adds a new key to it, by the one flow that adds a device vault
//!   (`Node::add_device_vault_with`, `Place::Under`), and names it by its profile; or, where `vault` has a worker of
//!   that name already, as on the person's other Mac, adds the new key to that one (`Place::Vault`). Then `vault`
//!   gives it each of `shares`, `{name, where, ops}` as every share is written (`slice::spec_of_json`), over `vault`
//!   unless one names another `over` (`pass_on`): one over `vault` itself it issues, resting on none; one over another
//!   vault rests on a share `vault` holds there, as it may pass a share on to a vault it owns (`world::parent`). The
//!   studio composes its own Worker group of ops, and core has no group for it. Each share is checked before the sheet
//!   (`passable`): one above what `vault` holds is refused, as an agent's is. A worker this Mac hosts already takes
//!   only the shares, with no sheet.
//! - **Its key** is 32 random bytes, never on disk in plain: the Mac's shelf keeps them wrapped under a key the Mac's
//!   device alone derives from its own (`workers/<device>`, `drive::Kept`), exactly as it keeps a drive's, so the Mac
//!   opens it silently whenever its own device opens. Its edits and what it makes are on a shelf of its own in a folder
//!   beside the app's (`<app's folder>-workers/<device>`, `folder`), which the app's device never clears.
//! - **Hosted** as a drive is: a second node beside the Mac's own (`Hosted`), a light copy (the `copy` op, `full`
//!   false), which keeps what it makes and reads every other file from the Mac's store, or over the network, as its
//!   shares let it; with its card, named as the worker is. The Mac looks at its workers every few seconds (`LOOK`).
//! - **Removed** like a lost phone: its device revoked from its device vault (`{"op": "revoke", "vault", "device"}`),
//!   its peers refuse it from then on, and the Mac hosts it no more. Its key goes when the Mac forgets its device, with
//!   the shelf that kept it.
//! - **Used** by the studio as the worker: `run [op, node]` runs an op on the worker's node, named by its device, and
//!   `Host::node_of` hands the app's own Rust that node, to read a file by range and post its jobs by the worker's own
//!   rights. `workers` lists those this Mac holds keys of.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::id::{ShareId, SignerId, VaultId};
use avendb::lab::{Lab, NewShare};
use avendb::policy::{Issued, Kind, Principal, State, Who};
use avendb::rules::{self, Op};
use avendb::slice::{self, Selector};
use avendb::world;
use avendb_browser::{Device, Meta};
use avendb_net::{NoBytes, NoCeremony, Node, Options, Place, disk};
use iroh::RelayUrl;
use serde_json::{Value, json};
use tokio::task::JoinHandle;
use zeroize::Zeroizing;

use crate::drive::{Kept, beside, lab_of};
use crate::{Service, agent, hex, random};

/// Where the Mac's shelf keeps the key of each worker it hosts, and what it is wrapped under (`drive::Kept`):
/// `workers/<device>`.
pub(crate) const KEY: Kept = Kept { under: "workers/", purpose: "worker key", info: b"avenDB worker " };

/// How often the Mac looks at the workers it holds keys of: one taken out stops, one not hosted yet is hosted.
pub const LOOK: Duration = Duration::from_secs(3);

/// The longest name a worker takes, in characters.
const NAME: usize = 64;

/// The workers' folder beside the app's `host` folder: `<host>-workers`, outside it, as the app's device clears
/// whatever its own folder holds beside its shelves (`disk::clear`).
pub fn workers(host: &Path) -> PathBuf {
    let mut name = host.file_name().unwrap_or_default().to_os_string();
    name.push("-workers");
    host.with_file_name(name)
}

/// Worker device `device`'s own folder, in the workers' folder beside the app's `host` folder: its shelves.
pub fn folder(host: &Path, device: SignerId) -> PathBuf {
    workers(host).join(device.to_hex())
}

/// A worker's name, as the studio gives it: some text, at most `NAME` characters, trimmed. Fails with why not.
pub fn named(name: &str) -> Result<String> {
    let name = name.trim();
    let fits = !name.is_empty() && name.chars().count() <= NAME;
    anyhow::ensure!(fits, "{name:?} names no worker: 1 to {NAME} characters");
    Ok(name.to_string())
}

/// A share a vault gives its worker: over vault `over`, named `name`, on what `select` picks, with ops `ops`, in
/// order (`rules::normalize`).
#[derive(Clone, Debug)]
pub struct Given {
    pub over: VaultId,
    pub name: String,
    pub select: Selector,
    pub ops: Vec<Op>,
}

/// Share `share` as `addWorker` takes one for a worker of vault `vault`: `{name, where, ops}`, as the page writes every
/// share (`slice::spec_of_json`), over `vault`, or over the vault whose id `over` beside them names. Fails with why
/// not: and for a share with the `share` op, as a worker shares nothing on.
pub fn given(share: &Value, vault: VaultId) -> Result<Given> {
    let spec = share.as_object().cloned();
    let mut spec = spec.with_context(|| format!("a worker's share is {{name, where, ops}}: {share}"))?;
    let over = match spec.remove("over") {
        None | Some(Value::Null) => vault,
        Some(v) => v.as_str().and_then(VaultId::from_hex).with_context(|| format!("over is a vault's id: {share}"))?,
    };
    let (name, select, ops) = slice::spec_of_json(&Value::Object(spec)).map_err(|why| anyhow!("{why}: {share}"))?;
    anyhow::ensure!(!ops.contains(&Op::Share), "a worker shares nothing on: its {name:?} share names no share op");
    Ok(Given { over, name, select, ops })
}

/// Whether vault `vault` may have a worker of its own, by view `st`: a person's own vault or a coop, whose media a
/// worker works on. A worker's device vault under the seed's coop is never taken for its server, which is the coop's
/// first device vault (`world::seeder`). Fails with why not, before any sheet.
pub fn may_have(st: &State, vault: VaultId) -> Result<()> {
    let kind = st.vault(vault).map(|v| v.kind).with_context(|| format!("this Mac knows no vault {}", vault.to_hex()))?;
    anyhow::ensure!(matches!(kind, Kind::Human | Kind::Coop), "a worker works for a person's vault or a coop");
    Ok(())
}

/// Whether vault `vault` can give its worker share `given`, by view `st`, as `pass_on` gives it: over `vault` itself,
/// always; over another vault, where `vault` holds a live share there that it may rest on, at its level or more and on
/// the whole vault if it is (`State::share_parent_ok`, as a vault passes a share on to a vault it owns). Fails with
/// why not, before anything is drafted.
pub fn passable(st: &State, vault: VaultId, given: &Given) -> Result<()> {
    if given.over == vault {
        return Ok(());
    }
    let (class, wide) = (rules::level_of(&given.ops), given.select == Selector::All);
    let rests = |cp: &Issued| {
        cp.share.over == given.over
            && st.live(cp.id)
            && !cp.share.level.is_keep()
            && cp.share.level.allows(class)
            && (!wide || cp.share.wide)
    };
    if st.shares_held(vault).any(rests) {
        return Ok(());
    }
    let (name, over, above) = (&given.name, given.over.to_hex(), "it is above what it holds");
    bail!("the vault holds no share over {over} that its worker's {name:?} share may rest on: {above}")
}

/// Vault `vault` gives its worker's device vault `worker` share `given`, on device `me`, acting as `vault`, with no
/// ceremony: over `vault` itself, issued by it, resting on none; over another vault, resting on a share `vault` holds
/// there that lets it (`world::parent`: the grantee is a vault it owns, and the share is no higher than its parent,
/// and wide only if it is), so that taking that one back ends the worker's too. One `vault` gave it before, of the same
/// name, ops and slice, stands for it, as for the same worker on the person's other Mac. The share. Fails with why not
/// (`passable`).
pub fn pass_on(lab: &mut Lab, me: SignerId, vault: VaultId, worker: VaultId, given: Given) -> Result<ShareId> {
    passable(lab.state(me), vault, &given)?;
    let Given { over, name, select, ops } = given;
    let st = lab.state(me);
    let same = |cp: &&Issued| {
        let slice = lab.slice(me, cp.id);
        cp.share.over == over
            && cp.share.issuer == vault
            && st.live(cp.id)
            && slice.is_some_and(|s| s.name == name && s.select == select && s.grant.ops == ops)
    };
    if let Some(cp) = st.shares_held(worker).find(same) {
        return Ok(cp.id);
    }
    let (who, class, wide) = (Who::Vault(worker), rules::level_of(&ops), select == Selector::All);
    let parent = if over == vault {
        None
    } else {
        let parent = world::parent(st, vault, over, who, class, wide);
        Some(parent.with_context(|| format!("the vault's share over {} lets it pass nothing on", over.to_hex()))?)
    };
    let refused = format!("the worker's {name:?} share is refused");
    let share = NewShare { over, who, name, select, ops, parent, issuer: vault, keep: None };
    lab.issue(me, &[me], share).map_err(|why| anyhow!("{refused}: {why:?}"))
}

/// The device vault that worker device `device` is a device of, by view `st`: none once it is taken out.
fn vault_of(st: &State, device: SignerId) -> Option<VaultId> {
    st.vaults().iter().find(|v| v.kind == Kind::DeviceVault && v.devices.contains(&device)).map(|v| v.id)
}

/// The workers the Mac hosts: each by its device, and one look, one add, at a time.
#[derive(Default)]
pub(crate) struct Workers {
    /// Each worker hosted now, by its device.
    hosted: Mutex<HashMap<SignerId, Hosted>>,
    /// One look at a time.
    looking: tokio::sync::Mutex<()>,
    /// One worker added at a time.
    adding: tokio::sync::Mutex<()>,
    /// The task that looks every few seconds while the Mac's device is open.
    task: Mutex<Option<JoinHandle<()>>>,
}

/// A worker the Mac hosts: its node on its shelf, its device vault, its name, and whether its copy setting and its
/// card are written.
struct Hosted {
    node: Arc<Node>,
    vault: VaultId,
    name: String,
    settled: Arc<AtomicBool>,
}

impl Workers {
    /// The node of worker `device`, if the Mac hosts it.
    pub(crate) fn node(&self, device: SignerId) -> Option<Arc<Node>> {
        self.hosted.lock().expect("hosted").get(&device).map(|h| h.node.clone())
    }

    /// Stops looking, and every worker's node: as the Mac's device closes, or is forgotten.
    pub(crate) async fn stop(&self) {
        if let Some(task) = self.task.lock().expect("the task").take() {
            task.abort();
        }
        let hosted: Vec<Hosted> = self.hosted.lock().expect("hosted").drain().map(|(_, h)| h).collect();
        for h in hosted {
            h.node.shutdown().await.ok();
        }
    }
}

impl Service {
    /// Starts looking at the workers every `LOOK`, while the Mac's device is open: the first look at once, so that each
    /// worker comes back as the device opens.
    pub(crate) fn watch_workers(self: &Arc<Self>) {
        let service: Weak<Service> = Arc::downgrade(self);
        let task = tokio::spawn(async move {
            loop {
                let Some(s) = service.upgrade() else { break };
                if let Err(e) = s.look_workers().await {
                    tracing::warn!("looking at the workers: {e:#}");
                }
                drop(s);
                tokio::time::sleep(LOOK).await;
            }
        });
        if let Some(old) = self.workers.task.lock().expect("the task").replace(task) {
            old.abort();
        }
    }

    /// The worker devices whose keys this Mac's shelf keeps (`wrap_key`).
    async fn kept_workers(&self) -> Result<Vec<SignerId>> {
        KEY.on(&self.shelf()).await
    }

    /// One look at the workers: one taken out of its device vault stops; one whose key this Mac keeps, still a device
    /// of its device vault and not hosted yet, is hosted, named by its vault's profile; and each settles: a light copy,
    /// and its card.
    async fn look_workers(self: &Arc<Self>) -> Result<()> {
        let Ok(d) = self.device() else { return Ok(()) };
        let _one = self.workers.looking.lock().await;
        let kept = self.kept_workers().await?;
        let found = d.node().read(move |lab, me| {
            let st = lab.state(me);
            let name = |v: VaultId| world::profile_of(lab, me, v).map(|(_, name)| name);
            let of = |w: SignerId| vault_of(st, w).map(|v| (w, v, name(v).unwrap_or_else(|| "worker".into())));
            kept.into_iter().filter_map(of).collect::<Vec<(SignerId, VaultId, String)>>()
        });
        let found = found.await;
        let gone: Vec<Hosted> = {
            let mut hosted = self.workers.hosted.lock().expect("hosted");
            let out: Vec<SignerId> = hosted
                .iter()
                .filter(|(w, h)| !found.iter().any(|(f, v, _)| f == *w && *v == h.vault))
                .map(|(w, _)| *w)
                .collect();
            out.iter().filter_map(|w| hosted.remove(w)).collect()
        };
        for h in gone {
            tracing::info!("the worker {} is taken out of its vault: its node stops", h.name);
            h.node.shutdown().await.ok();
        }
        let relay = self.relay().await;
        for (w, vault, name) in found {
            if self.workers.hosted.lock().expect("hosted").contains_key(&w) {
                continue;
            }
            let Some(secret) = self.unwrap_key(&d, &KEY, w).await else { continue };
            match self.spawn_worker(relay.clone(), &name, &secret, false).await {
                Ok((me, node)) if me == w => self.hosting_worker(&d, vault, name, node),
                Ok((_, node)) => {
                    node.shutdown().await.ok();
                    tracing::warn!("the key kept for the worker {name} opens another device");
                }
                Err(e) => tracing::warn!("the worker {name} isn't hosted: {e:#}"),
            }
        }
        self.settle_workers().await;
        Ok(())
    }

    /// Each worker hosted, settled, once its node holds its device vault: a light copy, so that it keeps what it makes
    /// and reads every other file from the Mac's store or over the network as its shares let it; and its card, so that
    /// the person's devices show it by name. Each is written until the worker's own node reads it back, as a card
    /// written before it holds its vault's key reads as none, and each look writes what it doesn't read yet. Its
    /// caller holds the look (`Workers::looking`), so that it writes each once a look.
    async fn settle_workers(&self) {
        let hosted: Vec<(Arc<Node>, String, Arc<AtomicBool>)> = {
            let hosted = self.workers.hosted.lock().expect("hosted");
            hosted.values().map(|h| (h.node.clone(), h.name.clone(), h.settled.clone())).collect()
        };
        for (node, name, settled) in hosted.into_iter().filter(|(_, _, s)| !s.load(Ordering::Relaxed)) {
            let set = |lab: &Lab, me| {
                let v = lab.vault_of(me)?;
                Some((lab.state(me).copy_of(me).next().is_some(), world::cards(lab, me, v).contains_key(&me)))
            };
            let Some((copied, carded)) = node.read(set).await else { continue };
            if copied && carded {
                settled.store(true, Ordering::Relaxed);
                continue;
            }
            let light = json!({ "op": "copy", "full": false });
            let card = json!({ "op": "card", "name": name });
            for op in [(!copied).then_some(light), (!carded).then_some(card)].into_iter().flatten() {
                let out = node.op(op).await;
                if !out.as_ref().is_ok_and(|out| out.get("ok").is_some()) {
                    tracing::warn!("the worker {name}'s copy setting or card isn't written: {out:?}");
                }
            }
        }
    }

    /// The relay this Mac's device reaches its peers through, as what opens it keeps it: its workers' too.
    async fn relay(&self) -> Option<RelayUrl> {
        let meta = Meta::load(&self.shelf()).await.ok().flatten()?;
        meta.relay.parse().ok()
    }

    /// A node for the worker whose key is `secret`, named `name`, on its own shelf in its folder (`folder`), reaching
    /// its peers through `relay` and as directly as the Mac's own: one that answers claims while it belongs to no vault
    /// if `card`, as a new one does until the Mac adds it (`Node::add_device_vault_with`). Its device, and its node.
    async fn spawn_worker(
        &self,
        relay: Option<RelayUrl>,
        name: &str,
        secret: &[u8; 32],
        card: bool,
    ) -> Result<(SignerId, Arc<Node>)> {
        let (lab, me) = lab_of(name, secret)?;
        let dir = folder(&self.config.dir, me);
        std::fs::create_dir_all(&dir).with_context(|| format!("the worker's folder, {}", dir.display()))?;
        let shelf = disk::open(&dir)?;
        let (direct, shelf) = (self.config.direct, Some(shelf));
        let opts = Options { bind: None, direct, relay, shelf, card, ..Options::local() };
        Ok((me, Arc::new(Node::spawn(lab, me, opts).await?)))
    }

    /// Worker node `node`, of device vault `vault`, named `name`, hosted from now on, beside the Mac's own device.
    fn hosting_worker(&self, d: &Arc<Device>, vault: VaultId, name: String, node: Arc<Node>) {
        beside(d, &node);
        let hosted = Hosted { node: node.clone(), vault, name, settled: Arc::new(AtomicBool::new(false)) };
        self.workers.hosted.lock().expect("hosted").insert(node.device(), hosted);
    }

    /// Adds a worker named `name` for vault `vault`, the person's own vault or one it owns, as a coop (`may_have`), and
    /// gives it `shares`, each `{name, where, ops}` and `over` if it isn't over `vault` (`given`), each checked before
    /// anything is signed (`passable`). Where `vault` has no worker of that name, a new key, and its device vault under
    /// `vault`, named by its profile; where it has one this Mac holds no key of, as the person's other Mac added, a
    /// new key added to that one: either in one ceremony of the person's passkey in the sheet, which the worker's new
    /// device cosigns (`Node::add_device_vault_with`). Its key is kept on this Mac's shelf, wrapped (`wrap_key`), and
    /// this Mac hosts it from then on. Where this Mac holds a key of it already, no sheet. Then `vault` gives it each
    /// share, acting as itself, with no ceremony (`pass_on`). `{device, name, vault, for}`: its device, its name, its
    /// device vault, and the vault it works for.
    pub(crate) async fn add_worker(
        self: &Arc<Self>,
        d: &Arc<Device>,
        vault: &str,
        name: &str,
        shares: &[Value],
    ) -> Result<Value> {
        let vault = VaultId::from_hex(vault.trim()).context("the vault a worker works for is a vault's id")?;
        let name = named(name)?;
        let given: Vec<Given> = shares.iter().map(|s| given(s, vault)).collect::<Result<_>>()?;
        let _one = self.workers.adding.lock().await;
        let mine = d.vault().await.context("this Mac belongs to no vault")?;
        let (named_, checked, kept) = (name.clone(), given.clone(), self.kept_workers().await?);
        let found = d.node().read(move |lab, me| {
            let st = lab.state(me);
            let ours = vault == mine || st.owns(mine, vault);
            let worker = agent::agent_vault(lab, me, vault, &named_);
            let here = worker.and_then(|w| kept.into_iter().find(|&k| st.is_device(k, w)));
            let checked = may_have(st, vault).and_then(|()| checked.iter().try_for_each(|g| passable(st, vault, g)));
            (ours, worker, here, checked)
        });
        let (ours, worker, here, checked) = found.await;
        anyhow::ensure!(ours, "vault {} isn't yours: a worker works for your vault or one it owns", vault.to_hex());
        checked?;
        let (worker, device) = match (worker, here) {
            (Some(worker), Some(device)) => (worker, device),
            (worker, _) => {
                let place = worker.map_or(Place::Under(vault), Place::Vault);
                self.join_worker(d, place, &name).await?
            }
        };
        let pass = move |lab: &mut Lab, me| -> Result<()> {
            given.into_iter().try_for_each(|g| pass_on(lab, me, vault, worker, g).map(drop))
        };
        d.node().act(pass).await?;
        let _one = self.workers.looking.lock().await;
        self.settle_workers().await;
        Ok(json!({ "device": hex(&device.0), "name": name, "vault": hex(&worker.0), "for": hex(&vault.0) }))
    }

    /// A new worker device named `name`, its key its own, added to a device vault at `place` in one ceremony of the
    /// person's passkey in the sheet (`Node::add_device_vault_with`), its new vault named by its profile; its key kept
    /// on this Mac's shelf, wrapped, and hosted here from then on. Its device vault, and its device. What its folder
    /// holds, if it isn't added, goes with it, as nothing opens it.
    async fn join_worker(self: &Arc<Self>, d: &Arc<Device>, place: Place, name: &str) -> Result<(VaultId, SignerId)> {
        let secret = Zeroizing::new(random()?);
        let (me, node) = self.spawn_worker(self.relay().await, name, &secret, true).await?;
        let approver = self.approver().await?;
        let (_, worker) = match d.node().add_device_vault_with(&node.offer(), place, d.passkey(), &approver).await {
            Ok(added) => added,
            Err(e) => {
                node.shutdown().await.ok();
                drop(node);
                std::fs::remove_dir_all(folder(&self.config.dir, me)).ok();
                return Err(e.context("the worker isn't added"));
            }
        };
        if matches!(place, Place::Under(_)) {
            let profile = d.node().op(json!({ "op": "profile", "vault": hex(&worker.0), "name": name })).await?;
            if profile.get("ok").is_none() {
                tracing::warn!("the worker {name}'s profile isn't written: {profile}");
            }
        }
        // no look in between: what it would host, it hosts already
        let _one = self.workers.looking.lock().await;
        self.wrap_key(d, &KEY, me, &secret).await?;
        self.hosting_worker(d, worker, name.to_string(), node);
        Ok((worker, me))
    }

    /// The workers this Mac holds keys of that are devices of their device vaults still, for the page and the studio:
    /// each its device, its name (its device vault's profile), its device vault, the vault it works for (its one
    /// owner), and whether this Mac hosts it now.
    pub(crate) async fn workers(self: &Arc<Self>) -> Result<Value> {
        let d = self.device()?;
        self.look_workers().await?;
        let kept = self.kept_workers().await?;
        let found = d.node().read(move |lab, me| {
            let st = lab.state(me);
            let row = |w: SignerId| {
                let v = vault_of(st, w)?;
                let owner = match st.vault(v)?.owners[..] {
                    [Principal::Vault(owner)] => Some(hex(&owner.0)),
                    _ => None,
                };
                let name = world::profile_of(lab, me, v).map(|(_, name)| name);
                Some((w, json!({ "device": hex(&w.0), "name": name, "vault": hex(&v.0), "for": owner })))
            };
            kept.into_iter().filter_map(row).collect::<Vec<_>>()
        });
        let rows = found.await.into_iter().map(|(w, mut row)| {
            row["hosted"] = self.workers.node(w).is_some().into();
            row
        });
        Ok(Value::Array(rows.collect()))
    }

    /// Op `op` run on worker `node`'s node, named by its device in hex, as that worker, by its own key and its shares
    /// alone (`Node::run`), with no ceremony at hand: a change its vault's owners approve answers `approve`, and makes
    /// nothing. Its answer, and for `read_file` the bytes beside. Fails for a worker this Mac doesn't host, and for a
    /// device's own setting (`follow`, `set_limits`), which a worker keeps nowhere.
    pub(crate) async fn run_on_worker(&self, node: &Value, op: Value) -> Result<(Value, Option<Vec<u8>>)> {
        let device = node.as_str().and_then(SignerId::from_hex).context("node is a worker's device, in hex")?;
        let worker = self.workers.node(device).with_context(|| format!("this Mac hosts no worker {}", hex(&device.0)))?;
        if let Some(own @ ("follow" | "set_limits")) = op.get("op").and_then(Value::as_str) {
            bail!("{own:?} isn't for a worker: a device's own setting, which a worker keeps nowhere");
        }
        worker.run(op, None::<NoBytes>, None::<&NoCeremony>).await
    }
}
