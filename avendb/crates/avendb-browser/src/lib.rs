//! avenDB's device in a web page (P8d, P8e): a device of its person on avenDB's network, as WebAssembly. A page has
//! no UDP, so its node (`avendb_net::Node`) reaches every peer through the server's relay, which lets a new device in
//! by a pass its person's passkey signs (`avendb::sign::RelayPass`) until it joined.
//!
//! The person's passkey stays in the browser's own authenticator (P8e): WebAuthn with the PRF extension
//! (`js/passkey.js`). The device never holds it, only what one ceremony at a time brings back, an assertion over a
//! challenge and the PRF output on the app's salt (`avendb::sign::Ceremony`). The ceremony that unlocks the device also
//! brings the PRF output on the device's own salt (`Unlock`), which masks the secret its keys come from: a new device
//! makes that secret itself (`Fresh`), so that the ceremony unlocking it names it and is its passkey's pass for it
//! (`avendb::sign::RelayPass`), to the server's relay and to the peer it links through. Then a device starts in one of
//! three ways:
//!
//! - `Device::found`: a new person's first device founds their human vault, gives avenCEO, the aven vault the server
//!   is a device of, relay on the whole of it, and writes its card there, in two ceremonies: the unlock, and one that
//!   signs the vault's genesis and the edit that adds the device together (`avendb_net::Node::found_with`). The
//!   passkey may be one the page just made, its P-256 key in its public key info, or one made before for the same
//!   relying party, maiaCITY's from its sign-up: then the device drafts it all for each key the unlock's assertion
//!   recovers to, in one batch, and keeps what the second ceremony's assertion verifies under. The first person to
//!   found their vault through a server nobody has claimed yet claims it in that same ceremony (P8f): their vault owns
//!   avenCEO.
//! - `Device::link`: a device of a person who has one already links through the code it shows
//!   (`avendb_net::Node::link_by_pass`), in one ceremony, the unlock, which is its passkey's pass for it and signs the
//!   edit that adds it too: its passkey is the key, of those the unlock's assertion recovers to, whose vault the peer
//!   hands over.
//! - `Device::open`: a device the page made before opens again from its store, in the unlock's ceremony alone; the
//!   server's relay knows it.
//!
//! The page keeps what the device holds in IndexedDB (`js/store.js`): its edits in the order it took them and its
//! McEliece keys, as a node keeps them on disk (`avendb_net::Disk`), saved after each change (`Node::changes`).
//!
//! A vault holds its entries itself, flat: each entry has a type (`note`, `todo`, `card`, `profile`) and tags, all of
//! it inside the entry's encrypted writes. A vault shares what it holds by caps (`Device::share`), each on a slice of
//! its entries, whatever its selector picks (`words`): every entry of a type, those with a tag, one entry, or the whole
//! vault. Nothing is shared but what a cap names: least is the default. A relay cap hands out ciphertext and no key,
//! which is how a vault lets avenCEO, the server's vault, keep and pass on its entries: a cap on the whole vault.
//!
//! The page shows its person's account (`Device::account`): their human vault, its root passkey and its devices, each
//! by the name on its card. A card is an entry of type `card` of their vault that the device writes itself, titled
//! with its name (`Device::card`), so it travels end-to-end encrypted like any note and every device of the vault shows
//! the others by name.
//!
//! Their vault founds and owns more vaults, aven and coop vaults, as real as their own (`Device::found_vaults`): one
//! ceremony of the passkey signs all their geneses, and then the device, acting for each through their vault (the
//! edit's `via`), gives avenCEO relay on it and writes its profile, an entry of type `profile` titled with its name
//! (`Device::profile`). The device acts for every vault its person's vault owns, so the page enacts each of them: it
//! writes, tags, shares and revokes as that vault, and the rules check each edit against that vault's caps, as any
//! peer's would. The page shows the device's whole world (`Device::world`): every vault it knows, whom it acts for and
//! through which owners; every cap in force, with its slice where the device reads it, what it reaches and who may
//! revoke it; every cell, the entries the same caps reach and one key opens, with the devices that sync it and whether
//! each opens it or only relays its ciphertext; and every entry, with its type, its tags and each vault's role on it.
//!
//! Every read and change of the entries the device holds, whatever their schema, is one op of the ops engine
//! (`Device::run`, `avendb::engine`, `avendb/docs/OPS.md`): JSON the page writes, which the device runs as the vault it
//! names, and the rules check as they check any peer's edit. Each note opens on its page (`Device::note`): its main
//! line and each proposal (a proposal of its history), and every edit of it, each with what it changed, to edit on any
//! line, retitle, propose, merge, promote, restore, undo or make a variant (a new note with what a line shows, marked
//! with the note it came from), each an op. And each vault's database shows as the device holds it, every entry with
//! its record, its type, its tags, its cell and its edits, and the schemas and lenses the app ships and the vault
//! publishes (`Device::database`, `data`); and the database's history, every signed edit the device holds (the core's
//! edits), each with what it does, who signed it and how, and the vaults it concerns (`Device::history`).
//!
//! The same device runs natively in the Mac app (`avendb-device`, beside maiaCITY Studio): there its node binds UDP
//! sockets of its own, so it reaches its peers directly and through the relay only where it must, and keeps what it
//! holds in a folder on disk (`Start::direct`, `Start::store`).
//!
//! The tests run natively (`tests/device.rs`) and in Chromium (`tests/page.rs`, through `scripts/test-browser.sh`),
//! where a virtual authenticator holds the passkey.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::cast;
use avendb::doc::Item;
use avendb::engine;
use avendb::id::{BlobId, CapId, CellId, EditId, EntryId, SignerId, VaultId};
use avendb::keys::{self, KeyFam};
use avendb::lab::{Backup, Lab, NewCap};
use avendb::lens::{DocV2, Status};
use avendb::policy::{Action, Cap, Grantee, Issued, Kind, Principal, Refusal, Role, State, Vault};
use avendb::rules::Rule;
use avendb::sign::{self, Assertion, Ceremony, DeviceKey, RelayPass, Signed, SignerKeys, pass_challenge};
use avendb::slice::{Selector, Slice};
use avendb::wire::Wire as _;
use avendb_net::{Authenticator, Node, Offer, Options, Step};
use iroh::RelayUrl;
use js_sys::{Array, Function, Promise, Reflect, Uint8Array};
use n0_future::future::or;
use n0_future::time::{Duration, SystemTime, sleep};
use serde_json::{Value, json};
use tokio::sync::watch;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{JsFuture, future_to_promise};
use zeroize::Zeroizing;

mod data;
pub mod words;

use words::{hex, kind_name, role_name, slice_value, status_name};

/// The type of a device's card: an entry of its person's human vault, titled with the device's name, that the device
/// wrote itself (`Device::card`).
pub const CARD: &str = "card";

/// The type of a vault's profile: an entry of the vault, titled with its name, written acting for the vault
/// (`Device::profile`).
pub const PROFILE: &str = "profile";

/// The type of a note: a document, titled, its text in its first paragraph (`cast::document`).
pub const NOTE: &str = "note";

/// The type of a todo.
pub const TODO: &str = "todo";

/// The start of the mark a variant carries among its document's own tags, inside its record: a note made from what
/// one line of another shows (`Device::variant`), marked with that note's entry in hex.
pub const VARIANT: &str = "avendb:variant:";

/// What the ceremony that unlocks a device brings back: the ceremony itself, over a new device's challenge
/// (`Fresh::challenge`) or one of the page's own, and the PRF output on the device's salt (`sign::device_salt`), which
/// masks the secret its keys come from (`Fresh::mask`), or, for a device made before 2026-10-10, is that secret.
pub struct Unlock {
    pub ceremony: Ceremony,
    pub device: Zeroizing<[u8; 32]>,
}

/// A new device before the ceremony that unlocks it (P8e): the secret its keys come from, 32 bytes of the machine's or
/// the browser's randomness, so that its keys are known before that ceremony, whose challenge names the device
/// (`challenge`). Then the unlock is its passkey's pass for it (`sign::RelayPass`), and the device signs up or in with
/// one ceremony more. It keeps the secret masked by the PRF output on its salt (`mask`), which only its passkey
/// computes again.
pub struct Fresh {
    secret: Zeroizing<[u8; 32]>,
    keys: SignerKeys,
}

impl Fresh {
    /// A new device, its secret from the machine's or the browser's randomness.
    pub fn new() -> Result<Fresh> {
        let mut secret = Zeroizing::new([0; 32]);
        getrandom::fill(&mut *secret).map_err(|e| anyhow!("no randomness: {e}"))?;
        let keys = DeviceKey::from_secret(*secret).keys();
        Ok(Fresh { secret, keys })
    }

    /// A new device whose secret is `secret`, as a test makes one.
    pub fn from_secret(secret: [u8; 32]) -> Fresh {
        Fresh { secret: Zeroizing::new(secret), keys: DeviceKey::from_secret(secret).keys() }
    }

    /// Its keys.
    pub fn keys(&self) -> SignerKeys {
        self.keys
    }

    /// The challenge of the ceremony that unlocks it at `now`, seconds since 1970 (`Start::now`), which makes that
    /// ceremony its passkey's pass for it.
    pub fn challenge(&self, now: u64) -> [u8; 32] {
        pass_challenge(self.keys.id(), now)
    }

    /// What it keeps of its secret: the secret masked by the PRF output on its salt that `unlock` brought back.
    pub fn mask(&self, unlock: &Unlock) -> [u8; 32] {
        *xor(&self.secret, &unlock.device)
    }
}

/// The XOR of `a` and `b`: a device's secret masked by the PRF output on its salt, or a mask unmasked by it.
fn xor(a: &[u8; 32], b: &[u8; 32]) -> Zeroizing<[u8; 32]> {
    let mut out = Zeroizing::new([0; 32]);
    out.iter_mut().zip(a.iter().zip(b)).for_each(|(o, (a, b))| *o = a ^ b);
    out
}

/// Where a device starts: its name, the relay it reaches its peers through, 32 bytes of the browser's randomness and
/// the time, seconds since 1970. In a page that is all: it binds no socket, and the page keeps its store. A device on a
/// machine, the Mac app's, binds sockets of its own (`direct`, `avendb_net::Options::direct`), so it reaches its peers
/// directly and through the relay only where it must, and keeps its store in a folder (`store`, `avendb_net::Disk`).
pub struct Start {
    pub name: String,
    pub relay: RelayUrl,
    pub entropy: [u8; 32],
    pub now: u64,
    pub direct: bool,
    pub store: Option<PathBuf>,
}

/// A device of its person in a browser: its node, its person's passkey, by its id and its P-256 key, the mask its
/// secret is kept under (`Fresh::mask`), none for a device made before 2026-10-10, and whether it closed.
pub struct Device {
    node: Node,
    passkey: SignerId,
    p256: [u8; 33],
    mask: Option<[u8; 32]>,
    closed: watch::Sender<bool>,
}

impl Device {
    /// The first device of a new person, `fresh`, unlocked by `unlock`, whose ceremony is over `fresh`'s challenge at
    /// `start.now`, so that it is the passkey's pass for the device. The passkey's P-256 key is `p256` (from its public
    /// key info, `sign::spki_p256`, as the browser made it), or, if the page doesn't know it, one of the keys the
    /// unlock's assertion recovers to (`passed`), as for the passkey the person made at maiaCITY's sign-up. Through the
    /// relay, which lets it in by the pass, it takes the card of the server whose code reads `server`, then founds the
    /// person's human vault with itself in it, in one ceremony of the passkey (`avendb_net::Node::found_with`), drafted
    /// for each of those keys and kept for the one the ceremony's assertion verifies under; if nobody has claimed the
    /// server yet, the same ceremony claims it, and their vault owns avenCEO, the aven vault the server is a device of.
    /// Then it gives avenCEO backup on the whole vault, so the server keeps their ciphertext and knows the device
    /// from then on, or, if `backup` is false, relay alone, so the server knows the vault's devices, lets them through
    /// and helps them find each other, and keeps none of its entries (`server_role`, `Device::back_up`); and writes its
    /// card there (`Device::card`). The relay honours the pass while it is open to sign-up
    /// (`avendb_net::Admission::open`) or while nobody has claimed the server.
    pub async fn found(
        start: Start,
        server: &Offer,
        p256: Option<[u8; 33]>,
        fresh: Fresh,
        unlock: Unlock,
        authenticator: &impl Authenticator,
        backup: bool,
    ) -> Result<Device> {
        let (lab, me, passkeys, pass) = passed(&start, p256, &fresh, &unlock)?;
        let node = Device::spawn(lab, me, &start, Some(pass)).await?;
        node.know(server.addr.clone());
        let mut tries = 0;
        while let Err(e) = node.contact(server.addr.id).await {
            tries += 1;
            if tries == 20 {
                return Err(e.context("the server's card"));
            }
            sleep(Duration::from_millis(500)).await;
        }
        let (passkey, vault, avenceo) = node.found_with(server, &passkeys, authenticator).await?;
        let device = Device::of(node, passkey, &passkeys, Some(fresh.mask(&unlock))).await?;
        let name = start.name.clone();
        let found = move |lab: &mut Lab, me| {
            let role = if backup { Role::Backup } else { Role::Relay };
            let server = cast::cap(vault, cast::vault(avenceo), role, Selector::All);
            lab.issue(me, &[me], server).map_err(|why| anyhow!("avenCEO's cap is refused: {why:?}"))?;
            let card = named(&name, me);
            lab.create(me, vault, vault, CARD, &[], card).map_err(|why| anyhow!("its card is refused: {why:?}"))?;
            Ok::<_, anyhow::Error>(())
        };
        device.node.act(found).await?;
        Ok(device)
    }

    /// A new device of a person who has one already, `fresh`, unlocked by `unlock`, whose ceremony is over `fresh`'s
    /// challenge at `start.now`, so that it is the passkey's pass for the device: it links through the device whose
    /// code reads `offer` (`Node::link_by_pass`), which takes the pass and hands back the vault of the passkey it is
    /// from, and joins its person's vault by the edit that adds it, which the same ceremony signs as that pass: one
    /// ceremony in all. Its passkey is the key, of those the unlock's assertion recovers to, whose vault the peer
    /// handed over.
    pub async fn link(start: Start, offer: &Offer, fresh: Fresh, unlock: Unlock) -> Result<Device> {
        let (lab, me, passkeys, pass) = passed(&start, None, &fresh, &unlock)?;
        let mask = fresh.mask(&unlock);
        let node = Device::spawn(lab, me, &start, Some(pass.clone())).await?;
        let (passkey, _) = node.link_by_pass(offer, &pass, unlock.ceremony).await?;
        Device::of(node, passkey, &passkeys, Some(mask)).await
    }

    /// The device the page made before, opened again from what its store kept (`backup`), unlocked by the ceremony of
    /// the passkey whose P-256 key is `p256`, its secret kept under `mask` (`Fresh::mask`), none for a device made
    /// before 2026-10-10: the relay knows it, so it needs no pass. A device with a folder of its own (`Start::store`)
    /// opens from what the folder holds, or, while it holds nothing, from `backup`, which it then keeps there: so the
    /// Mac app's device moves from its page's store to disk.
    pub async fn open(
        start: Start,
        p256: [u8; 33],
        mask: Option<[u8; 32]>,
        unlock: Unlock,
        backup: &Backup,
    ) -> Result<Device> {
        let (mut lab, passkey, me) = lab(&start, p256, mask, &unlock)?;
        lab.restore_backup(me, backup);
        if start.store.is_none() && lab.vault_of(me).is_none() {
            bail!("the store holds no vault this device belongs to");
        }
        let node = Device::spawn(lab, me, &start, None).await?;
        let device = Device { node, passkey, p256, mask, closed: watch::Sender::new(false) };
        if device.vault().await.is_none() {
            device.close().await.ok();
            bail!("the store holds no vault this device belongs to");
        }
        Ok(device)
    }

    /// A node for device `me` of `lab`, which reaches its peers through the relay, let in by `pass` if the relay
    /// doesn't know it yet, and directly too if it binds a socket; with its store in a folder, if it has one.
    async fn spawn(lab: Lab, me: SignerId, start: &Start, pass: Option<RelayPass>) -> Result<Node> {
        let (direct, relay, store) = (start.direct, Some(start.relay.clone()), start.store.clone());
        let opts = Options { bind: None, direct, relay, relay_pass: pass, store, ..Options::local() };
        Node::spawn(lab, me, opts).await
    }

    /// The new device whose node is `node`, of the person whose passkey turned out to be `passkey`, of `passkeys`,
    /// those its unlock may have been from (`passed`), its secret kept under `mask`: it forgets the others' keys, which
    /// nobody holds.
    async fn of(node: Node, passkey: SignerId, passkeys: &[SignerId], mask: Option<[u8; 32]>) -> Result<Device> {
        let others: Vec<SignerId> = passkeys.iter().copied().filter(|&p| p != passkey).collect();
        let forget = move |lab: &mut Lab, _| {
            others.into_iter().for_each(|p| lab.lose(p));
            lab.keys_of(passkey)
        };
        let Some(SignerKeys::Passkey { p256, .. }) = node.act(forget).await else { bail!("the passkey's keys") };
        Ok(Device { node, passkey, p256, mask, closed: watch::Sender::new(false) })
    }

    /// Its node.
    pub fn node(&self) -> &Node {
        &self.node
    }

    /// Its person's passkey's P-256 key, compressed: what the page keeps to open the device again.
    pub fn p256(&self) -> [u8; 33] {
        self.p256
    }

    /// Its person's passkey.
    pub fn passkey(&self) -> SignerId {
        self.passkey
    }

    /// The mask its secret is kept under (`Fresh::mask`): what the page keeps, beside its salt's own bytes, to open the
    /// device again. None for a device made before 2026-10-10, whose secret is the PRF output on its salt itself.
    pub fn mask(&self) -> Option<[u8; 32]> {
        self.mask
    }

    /// The vault it belongs to, by its view.
    pub async fn vault(&self) -> Option<VaultId> {
        self.node.read(|lab, me| lab.vault_of(me)).await
    }

    /// Whether its vault owns avenCEO, by its view: an aven vault with a device, the server, as once its person's vault
    /// claimed the server (`avendb_net::Node::found_with`).
    pub async fn owns_aven(&self) -> bool {
        self.node.read(owns_aven).await
    }

    /// Whether avenDB's server keeps a backup of its person's vault: avenCEO holds backup on the whole of it
    /// (`server_role`). `None` while it knows no avenCEO.
    pub async fn backs_up(&self) -> Option<bool> {
        self.node
            .read(|lab, me| {
                let mine = lab.vault_of(me)?;
                let st = lab.state(me);
                Some(server_role(st, mine, avenceo(st, mine)?) == Role::Backup)
            })
            .await
    }

    /// Has avenDB's server keep a backup of its person's vault and of every vault the server holds a cap on the whole
    /// of that this device acts for, if `on`, or relay alone, which keeps nothing of their entries from then on: it
    /// gives avenCEO the one role on each, then revokes the caps of the other. What the server kept before, it keeps.
    /// Whether anything changed.
    pub async fn back_up(&self, on: bool) -> Result<bool> {
        let (want, other) = if on { (Role::Backup, Role::Relay) } else { (Role::Relay, Role::Backup) };
        let change = move |lab: &mut Lab, me| {
            let mine = lab.vault_of(me).ok_or(Refusal::NotActing)?;
            let st = lab.state(me);
            let Some(avenceo) = avenceo(st, mine) else { return Ok(false) };
            let to = Grantee::Principal(Principal::Vault(avenceo));
            let server = |cp: &&Issued| cp.cap.wide && cp.cap.grantee == to && st.live(cp.id);
            let mut vaults: Vec<VaultId> = st.caps().iter().filter(server).map(|cp| cp.cap.over).collect();
            vaults.sort();
            vaults.dedup();
            vaults.retain(|&v| st.acts_for(me, v));
            let mut plan = vec![];
            for &v in &vaults {
                let has = st.caps_over(v).any(|cp| server(&cp) && cp.cap.role == want);
                let ends = st.caps_over(v).filter(|cp| server(cp) && cp.cap.role == other).map(|cp| cp.id);
                let ends: Vec<CapId> = ends.collect();
                plan.push((v, has, ends));
            }
            let mut changed = false;
            for (v, has, ends) in plan {
                if !has {
                    lab.issue(me, &[me], cast::cap(v, cast::vault(avenceo), want, Selector::All))?;
                    changed = true;
                }
                for cap in ends {
                    lab.submit(me, &[me], Action::Revoke { cap, actor: v, keep: vec![], via: vec![] })?;
                    changed = true;
                }
            }
            Ok(changed)
        };
        self.node.act(change).await.map_err(|why: Refusal| anyhow!("the server's cap is refused: {why:?}"))
    }

    /// Its person's account by its view (`Account`): `None` while it belongs to no vault.
    pub async fn account(&self) -> Option<Account> {
        self.node
            .read(|lab, me| {
                let vault = lab.state(me).vault(lab.vault_of(me)?)?;
                let mut names = cards(lab, me, vault.id);
                let name = |d: &SignerId| (*d, names.remove(d).map(|(_, name)| name));
                let devices = vault.devices.iter().map(name).collect();
                Some(Account { vault: vault.id, root: vault.root, devices, owns_aven: owns_aven(lab, me) })
            })
            .await
    }

    /// Its card reads `name`: written into its vault if it has none yet, its title set if it reads otherwise; its peers
    /// are told. Whether it wrote: not while it holds no key of its vault's seed yet, as a device just linked until
    /// another device of the vault boxes it one, nor if its card reads `name` already.
    pub async fn card(&self, name: String) -> Result<bool> {
        let card = move |lab: &mut Lab, me| {
            let Some(vault) = lab.vault_of(me) else { return Ok(false) };
            if let Some((entry, title)) = cards(lab, me, vault).remove(&me) {
                if title == name {
                    return Ok(false);
                }
                lab.edit(me, vault, entry, move |item| _ = item.edit_document(|d| d.title = name))?;
                return Ok(true);
            }
            if !lab.holds_key(me, lab.state(me).current(KeyFam::Seed(vault))) {
                return Ok(false);
            }
            lab.create(me, vault, vault, CARD, &[], named(&name, me)).map(|_| true)
        };
        self.node.act(card).await.map_err(|why: Refusal| anyhow!("the card is refused: {why:?}"))
    }

    /// Its world by its view (`World`): `None` while it belongs to no vault.
    pub async fn world(&self) -> Option<World> {
        self.node.read(world).await
    }

    /// New vaults its person's vault founds and owns alone, each of kind `Kind::Aven` or `Kind::Coop` and named: one
    /// ceremony of the passkey signs all their geneses (`avendb_net::Node::approve_with`); then the device, acting for
    /// each through its own vault, gives avenCEO relay on it so the server keeps its entries, and writes its profile
    /// (`Device::profile`). Their ids, in the order named.
    pub async fn found_vaults(
        &self,
        new: Vec<(Kind, String)>,
        authenticator: &impl Authenticator,
    ) -> Result<Vec<VaultId>> {
        if new.is_empty() {
            return Ok(vec![]);
        }
        if new.iter().any(|(kind, name)| *kind == Kind::Human || name.trim().is_empty()) {
            bail!("a vault a vault owns is an aven or a coop vault, and has a name");
        }
        let mine = self.vault().await.context("this device belongs to no vault")?;
        let (passkey, kinds) = (self.passkey, new.iter().map(|(kind, _)| *kind).collect::<Vec<_>>());
        let nonces = kinds.iter().map(|_| nonce()).collect::<Result<Vec<_>>>()?;
        let draft = move |drafting: &mut avendb::lab::Drafting<'_>, _| {
            let genesis = |(kind, nonce)| Action::Genesis {
                kind,
                owners: vec![Principal::Vault(mine)],
                threshold: 1,
                root: None,
                nonce,
                seal_to: vec![],
            };
            let geneses = kinds.into_iter().zip(nonces).map(genesis);
            geneses.map(|g| drafting.draft(&[passkey], g).map(VaultId::from)).collect::<Result<Vec<_>, _>>()
        };
        let vaults = self.node.approve_with(passkey, draft, authenticator).await.context("the new vaults")?;
        for (&vault, (_, name)) in vaults.iter().zip(new) {
            self.profile(vault, name.trim().to_string()).await?;
        }
        Ok(vaults)
    }

    /// Vault `vault`'s profile reads `name`, written by this device acting for the vault; or, if it has a profile, its
    /// title set. A vault that has none yet gives avenCEO relay on the whole of it first, so the server keeps its
    /// entries, unless it is avenCEO itself or does so already. Whether it wrote: not if the profile reads `name`
    /// already. Fails if the device doesn't act for the vault.
    pub async fn profile(&self, vault: VaultId, name: String) -> Result<bool> {
        let profile = move |lab: &mut Lab, me| {
            if let Some((entry, title)) = profile_of(lab, me, vault) {
                if title == name {
                    return Ok(false);
                }
                lab.edit(me, vault, entry, move |item| _ = item.edit_document(|d| d.title = name))?;
                return Ok(true);
            }
            let mine = lab.vault_of(me).ok_or(Refusal::NotActing)?;
            let st = lab.state(me);
            if let Some(avenceo) = avenceo(st, mine).filter(|&a| a != vault && !relays(st, vault, a)) {
                let role = server_role(st, mine, avenceo);
                lab.issue(me, &[me], cast::cap(vault, cast::vault(avenceo), role, Selector::All))?;
            }
            lab.create(me, vault, vault, PROFILE, &[], named(&name, me)).map(|_| true)
        };
        self.node.act(profile).await.map_err(|why: Refusal| anyhow!("the profile is refused: {why:?}"))
    }

    /// Gives `grantee` the role `role` on what `slice` selects of vault `over`, acting for vault `issuer`: the vault
    /// itself, or a vault holding an owner cap over it, on which this one then rests, a wide one for a cap on the whole
    /// vault (`parent`). A cap that writes may carry `rules`: the ops its grantee's writes may make (`avendb::rules`).
    /// Making someone owner is governance, which the passkey approves in a ceremony; anything less this device signs
    /// alone. The cap's slice is sealed to the vault, its grantee and its issuer. The cap's id.
    #[allow(clippy::too_many_arguments)]
    pub async fn share(
        &self,
        issuer: VaultId,
        over: VaultId,
        slice: Slice,
        rules: Option<Vec<Rule>>,
        role: Role,
        grantee: Grantee,
        authenticator: &impl Authenticator,
    ) -> Result<CapId> {
        if rules.is_some() && !role.allows(Role::Write) {
            bail!("only a cap that writes carries rules");
        }
        let wide = slice.select == Selector::All;
        let parent = self.node.read(move |lab, me| parent(lab.state(me), issuer, over, wide)).await;
        let new = NewCap { over, grantee, role, slice, parent, issuer, rules };
        let refused = |why| anyhow!("the cap is refused: {why:?}");
        if role != Role::Owner {
            return self.node.act(move |lab, me| lab.issue(me, &[me], new)).await.map_err(refused);
        }
        let passkey = self.passkey;
        let draft = self.node.act(move |lab, me| lab.draft_cap(me, &[passkey], new)).await.map_err(refused)?;
        let ceremony = authenticator.ceremony(draft.challenge(), Step::Approve).await?;
        let complete = move |lab: &mut Lab, me| lab.complete(me, draft, &[(passkey, &ceremony)]);
        let id = self.node.act(complete).await.map_err(|why| anyhow!("the passkey didn't sign the cap: {why:?}"))?;
        Ok(CapId::from(id))
    }

    /// Ends cap `cap` and every cap resting on it, acting for vault `actor`, which issued it, is the vault it is over,
    /// holds it, or may revoke a cap it rests on. Ending an owner cap is governance, which the passkey approves in a
    /// ceremony.
    pub async fn revoke(&self, actor: VaultId, cap: CapId, authenticator: &impl Authenticator) -> Result<()> {
        let role = move |lab: &Lab, me| {
            let st = lab.state(me);
            st.cap(cap).filter(|cp| st.live(cp.id)).map(|cp| cp.cap.role)
        };
        let revoke = Action::Revoke { cap, actor, keep: vec![], via: vec![] };
        if self.node.read(role).await.context("no such cap in force")? == Role::Owner {
            let passkey = self.passkey;
            let draft = move |drafting: &mut avendb::lab::Drafting<'_>, _| drafting.draft(&[passkey], revoke);
            self.node.approve_with(passkey, draft, authenticator).await?;
        } else {
            let revoked = self.node.act(move |lab, me| lab.submit(me, &[me], revoke)).await;
            revoked.map_err(|why| anyhow!("the revocation is refused: {why:?}"))?;
        }
        Ok(())
    }

    /// Runs op `op` of the ops engine (`avendb::engine`, `avendb/docs/OPS.md`): any read or change of the entries it
    /// holds, whatever their schema, as JSON. Its answer: `{"ok": ...}`, or `{"refused": ..., "why": ...}`. A read
    /// runs on what the device holds; a change is a write of the vault it acts for (`"as"`), and its peers are told;
    /// asking whether changes would be made (`may`) is a dry run, which changes nothing and tells no one.
    pub async fn run(&self, op: Value) -> Value {
        if engine::reads(&op) {
            return self.node.read(move |lab, me| engine::read(lab, me, &op)).await;
        }
        if engine::asks(&op) {
            return self.node.dry(move |lab, me| engine::run(lab, me, &op)).await;
        }
        self.node.act(move |lab, me| engine::run(lab, me, &op)).await
    }

    /// Vault `vault`'s database as the device holds it, for the page's database studio (`data::database`).
    pub async fn database(&self, vault: VaultId) -> Value {
        self.node.read(move |lab, me| data::database(lab, me, vault)).await
    }

    /// Note `entry` as the device holds it, for the page's note page: its main line, its proposals and every edit of it
    /// the device counts (`data::note`). `None` if it counts none.
    pub async fn note(&self, entry: EntryId) -> Option<Value> {
        self.node.read(move |lab, me| data::note(lab, me, entry)).await
    }

    /// The database's history: every signed edit it holds, in the order it took them, for the studio's History view
    /// (`data::history`).
    pub async fn history(&self) -> Value {
        self.node.read(data::history).await
    }

    /// The signed edits it holds from the `from`th on, in the order it took them, each as its bytes on the wire; `None`
    /// if it holds fewer than `from`, as some of what the store kept failed their checks: then the store is written
    /// anew from the first.
    pub async fn edits(&self, from: usize) -> Option<Vec<Vec<u8>>> {
        self.node
            .read(move |lab, me| {
                let ids = lab.log(me).ids();
                let wire = |id: &EditId| lab.signed_edit(me, *id).expect("an edit it holds").to_wire();
                ids.get(from..).map(|ids| ids.iter().map(wire).collect())
            })
            .await
    }

    /// Waits until it holds other than `held`, how many edits and McEliece keys its page's store holds
    /// (`Node::changes`): true, or false once it closed.
    pub async fn changed(&self, held: (usize, usize)) -> bool {
        let (mut changes, mut closed) = (self.node.changes(), self.closed.subscribe());
        let changed = async move { changes.wait_for(|&size| size != held).await.is_ok() };
        or(changed, async move { closed.wait_for(|&closed| closed).await.is_err() }).await
    }

    /// Closes its connections and its endpoint.
    pub async fn close(&self) -> Result<()> {
        self.closed.send_replace(true);
        self.node.shutdown().await
    }

    /// The McEliece keys it holds, each by its id.
    pub async fn key_ids(&self) -> Vec<BlobId> {
        self.node.read(|lab, me| lab.blob_ids(me)).await
    }

    /// McEliece key `id`, if it holds it.
    pub async fn key(&self, id: BlobId) -> Option<Arc<[u8]>> {
        self.node.read(move |lab, me| lab.blob(me, id)).await
    }
}

/// Its person's account as a device shows it (`Device::account`): their human vault, its root passkey, its devices,
/// each with the name on its card if it wrote one, and whether the vault owns avenCEO.
pub struct Account {
    pub vault: VaultId,
    pub root: Option<SignerId>,
    pub devices: Vec<(SignerId, Option<String>)>,
    pub owns_aven: bool,
}

/// Whether device `me`'s vault owns avenCEO, by its view: an aven vault with a device, the server, as once its person's
/// vault claimed the server (`avendb_net::Node::found_with`).
fn owns_aven(lab: &Lab, me: SignerId) -> bool {
    let Some(mine) = lab.vault_of(me).map(Principal::Vault) else { return false };
    let avenceo = |v: &Vault| v.kind == Kind::Aven && v.owners.contains(&mine) && !v.devices.is_empty();
    lab.state(me).vaults().iter().any(avenceo)
}

/// A document titled `title`, made on device `device`: a card's or a profile's record.
fn named(title: &str, device: SignerId) -> Item {
    Item::document(title, device)
}

/// Entry `e` is of type `ty`, as device `me` reads its header.
fn typed(lab: &Lab, me: SignerId, e: EntryId, ty: &str) -> bool {
    lab.meaning(me, e).is_some_and(|m| m.attrs.ty.as_str() == ty)
}

/// A device's world by its view (`Device::world`): every vault it knows, in the order they were founded; every cap in
/// force, in the order they were issued; every cell an entry is in; and every entry, in the order they were created.
pub struct World {
    /// Its own vault, its person's.
    pub mine: VaultId,
    /// It trusts no curve (`Lab::set_pq_only`): only the writes a checkpoint by their author covers count.
    pub pq_only: bool,
    pub vaults: Vec<VaultView>,
    pub caps: Vec<CapView>,
    pub cells: Vec<CellView>,
    pub entries: Vec<EntryView>,
}

/// A vault as a device shows it.
pub struct VaultView {
    pub vault: Vault,
    /// The name on its profile, if it has one (`Device::profile`).
    pub name: Option<String>,
    /// Its devices' names, by their cards, of each that wrote one.
    pub names: BTreeMap<SignerId, String>,
    /// The owners the device acts for it through (`State::via`): none for its own vault, `None` if it doesn't act for
    /// it.
    pub via: Option<Vec<VaultId>>,
}

/// A cap in force as a device shows it.
pub struct CapView {
    pub id: CapId,
    pub cap: Cap,
    /// The caps it rests on, from its root cap down to itself.
    pub chain: Vec<CapId>,
    /// Its slice, if the device reads it: its selector is sealed to the vault it is over, its grantee and its issuer,
    /// so a device acting for none of them sees only that it is there, and what it reaches.
    pub slice: Option<Slice>,
    /// The vaults that may revoke it.
    pub revokers: Vec<VaultId>,
    /// The entries it reaches now: every entry of its vault for a cap on the whole vault, else those in a cell of
    /// caps it is one of.
    pub entries: Vec<EntryId>,
}

/// A cell as a device shows it: the entries of a vault that the same caps reach, under one key.
pub struct CellView {
    pub id: CellId,
    pub vault: VaultId,
    /// The caps that reach it beside the vault's caps on the whole of it: none for the cell of the vault's own entries
    /// that no cap selects.
    pub caps: Vec<CapId>,
    /// Its key's generation: it moves on when a reader may no longer read it.
    pub generation: u64,
    pub entries: Vec<EntryId>,
    /// The vaults that read it: its own, and each vault a cap with read or more that reaches it names.
    pub readers: Vec<VaultId>,
    /// Everyone may read it.
    pub public: bool,
    /// The devices that receive its edits.
    pub syncs: Vec<Syncing>,
}

/// A device that receives a cell's edits: the vault it receives them through, the one of those it acts for that holds
/// the strongest role on the cell, and whether it opens any of what they hold, or only relays their ciphertext, as the
/// server for avenCEO.
pub struct Syncing {
    pub device: SignerId,
    pub through: VaultId,
    pub opens: bool,
}

/// An entry as a device shows it.
pub struct EntryView {
    pub entry: EntryId,
    pub vault: VaultId,
    /// The vault its first write acted for.
    pub by: VaultId,
    /// Its type, its tags now and when it was created, in seconds since 1970, if the device reads them: they travel
    /// inside its encrypted writes.
    pub ty: Option<String>,
    pub tags: Option<Vec<String>>,
    pub created: Option<u64>,
    pub cell: CellId,
    /// Everyone may read it.
    pub public: bool,
    /// The strongest role each vault holds on it: its own vault's is owner.
    pub roles: Vec<(VaultId, Role)>,
    pub what: What,
}

/// What an entry holds, as a device reads it.
pub enum What {
    /// A document: its title and the text of its first paragraph (block 2), as `cast::document` writes them; the note
    /// it is a variant of, if it is one (`Device::variant`); how many edits of it the device counts, and how many
    /// proposals it has.
    Note { title: String, text: String, variant_of: Option<EntryId>, edits: usize, proposals: usize },
    Todo { title: String, status: Status },
    /// What the device holds but can't open.
    Sealed,
}

impl World {
    /// The world as device `me`'s page reads it (`PageDevice::world`): ids in 64 hex digits, kinds, roles and statuses
    /// by their lowercase names, a slice as `words::slice_value` writes it, `null` where the device doesn't read it, a
    /// vault's `via` `null` where the device doesn't act for it, a cap's `grantee` `"public"` for everyone, an
    /// entry's `type`, `tags` and `created` `null` where the device doesn't read them and its `roles` by vault.
    pub fn to_json(&self, me: SignerId) -> Value {
        let ids = |xs: &[VaultId]| xs.iter().map(|v| hex(&v.0)).collect::<Vec<_>>();
        let owner = |p: &Principal| match p {
            Principal::Vault(v) => json!({ "vault": hex(&v.0) }),
            Principal::Signer(s) => json!({ "signer": hex(&s.0) }),
        };
        let vault = |v: &VaultView| {
            let device = |d: &SignerId| json!({ "id": hex(&d.0), "name": v.names.get(d), "me": *d == me });
            json!({
                "id": hex(&v.vault.id.0),
                "kind": kind_name(v.vault.kind),
                "name": v.name,
                "owners": v.vault.owners.iter().map(owner).collect::<Vec<_>>(),
                "threshold": v.vault.threshold,
                "root": v.vault.root.map(|r| hex(&r.0)),
                "devices": v.vault.devices.iter().map(device).collect::<Vec<_>>(),
                "via": v.via.as_deref().map(ids),
            })
        };
        let cap = |c: &CapView| {
            json!({
                "id": hex(&c.id.0),
                "over": hex(&c.cap.over.0),
                "issuer": hex(&c.cap.issuer.0),
                "grantee": grantee_name(c.cap.grantee),
                "role": role_name(c.cap.role),
                "wide": c.cap.wide,
                "parent": c.cap.parent.map(|p| hex(&p.0)),
                "chain": c.chain.iter().map(|x| hex(&x.0)).collect::<Vec<_>>(),
                "slice": c.slice.as_ref().map(slice_value),
                "revokers": ids(&c.revokers),
                "entries": c.entries.iter().map(|e| hex(&e.0)).collect::<Vec<_>>(),
            })
        };
        let syncing = |x: &Syncing| {
            json!({ "device": hex(&x.device.0), "through": hex(&x.through.0), "opens": x.opens })
        };
        let cell = |c: &CellView| {
            json!({
                "id": hex(&c.id.0),
                "vault": hex(&c.vault.0),
                "caps": c.caps.iter().map(|x| hex(&x.0)).collect::<Vec<_>>(),
                "generation": c.generation,
                "entries": c.entries.iter().map(|e| hex(&e.0)).collect::<Vec<_>>(),
                "readers": ids(&c.readers),
                "public": c.public,
                "syncs": c.syncs.iter().map(syncing).collect::<Vec<_>>(),
            })
        };
        let entry = |i: &EntryView| {
            let (kind, title, text, status) = match &i.what {
                What::Note { title, text, .. } => ("note", Some(title), Some(text), None),
                What::Todo { title, status } => ("todo", Some(title), None, Some(status_name(*status))),
                What::Sealed => ("sealed", None, None, None),
            };
            let (variant_of, edits, proposals) = match &i.what {
                What::Note { variant_of, edits, proposals, .. } => (variant_of.map(|e| hex(&e.0)), *edits, *proposals),
                _ => (None, 0, 0),
            };
            let roles: serde_json::Map<String, Value> =
                i.roles.iter().map(|(v, r)| (hex(&v.0), Value::from(role_name(*r)))).collect();
            json!({
                "entry": hex(&i.entry.0),
                "vault": hex(&i.vault.0),
                "by": hex(&i.by.0),
                "type": i.ty,
                "tags": i.tags,
                "created": i.created,
                "cell": hex(&i.cell.0),
                "public": i.public,
                "roles": roles,
                "kind": kind,
                "title": title,
                "text": text,
                "status": status,
                "variantOf": variant_of,
                "edits": edits,
                "proposals": proposals,
            })
        };
        json!({
            "me": hex(&me.0),
            "mine": hex(&self.mine.0),
            "pqOnly": self.pq_only,
            "vaults": self.vaults.iter().map(vault).collect::<Vec<_>>(),
            "caps": self.caps.iter().map(cap).collect::<Vec<_>>(),
            "cells": self.cells.iter().map(cell).collect::<Vec<_>>(),
            "entries": self.entries.iter().map(entry).collect::<Vec<_>>(),
        })
    }
}

/// A cap's grantee as the page names it: `"public"` for everyone, else the vault's id.
fn grantee_name(g: Grantee) -> String {
    match g {
        Grantee::Public => "public".to_string(),
        Grantee::Principal(Principal::Vault(v)) => hex(&v.0),
        Grantee::Principal(Principal::Signer(s)) => hex(&s.0),
    }
}

/// Device `me`'s world by its view: `None` while it belongs to no vault.
fn world(lab: &Lab, me: SignerId) -> Option<World> {
    let st = lab.state(me);
    let mine = lab.vault_of(me)?;
    let vault = |v: &Vault| {
        let names = cards(lab, me, v.id).into_iter().map(|(d, (_, name))| (d, name)).collect();
        let name = profile_of(lab, me, v.id).map(|(_, name)| name);
        VaultView { vault: v.clone(), name, names, via: st.via(me, v.id) }
    };
    let vaults = st.vaults().iter().map(vault).collect();
    let cap = |cp: &Issued| {
        let reaches =
            |en: &&avendb::policy::Entry| en.vault == cp.cap.over && (cp.cap.wide || in_cell(st, en.cell(), cp.id));
        CapView {
            id: cp.id,
            cap: cp.cap.clone(),
            chain: cp.chain.to_vec(),
            slice: lab.slice(me, cp.id).cloned(),
            revokers: st.vaults().iter().map(|v| v.id).filter(|&a| st.may_revoke(a, cp)).collect(),
            entries: st.entries().iter().filter(reaches).map(|en| en.id).collect(),
        }
    };
    let caps = st.caps().iter().filter(|cp| st.live(cp.id)).map(cap).collect();
    let devices: Vec<(SignerId, VaultId)> =
        st.vaults().iter().flat_map(|v| v.devices.iter().map(move |&d| (d, v.id))).collect();
    let mut cells: Vec<CellView> = vec![];
    for en in st.entries() {
        let (v, x) = (en.vault, en.cell());
        if let Some(c) = cells.iter_mut().find(|c| c.id == x) {
            c.entries.push(en.id);
            continue;
        }
        let k = KeyFam::Cell(v, x);
        cells.push(CellView {
            id: x,
            vault: v,
            caps: st.cell_caps(x).unwrap_or_default().to_vec(),
            generation: st.epoch(k),
            entries: vec![en.id],
            readers: st.readers(k),
            public: st.public_key(k),
            syncs: syncing(st, &devices, v, x),
        });
    }
    let entries = st.entries().iter().map(|en| entry(lab, me, en)).collect();
    Some(World { mine, pq_only: lab.pq_only(), vaults, caps, cells, entries })
}

/// Entry `en` as device `me` shows it.
fn entry(lab: &Lab, me: SignerId, en: &avendb::policy::Entry) -> EntryView {
    let what = match lab.item(me, en.id) {
        None => What::Sealed,
        Some(item) => match (item.as_document(), item.as_todo()) {
            (Some(doc), _) => {
                let text = doc.blocks.iter().find(|b| b.id == 2).map(|b| b.text.clone()).unwrap_or_default();
                let history = lab.history(me, en.id);
                let edits = history.map_or(0, |h| h.changes().len());
                let proposals = history.map_or(0, |h| h.lines().len().saturating_sub(1));
                What::Note { title: doc.title.clone(), text, variant_of: variant_of(&doc), edits, proposals }
            }
            (None, Some(todo)) => What::Todo { title: todo.title, status: todo.status },
            (None, None) => What::Sealed,
        },
    };
    let st = lab.state(me);
    let meaning = lab.meaning(me, en.id);
    let (ty, tags, created) = match &meaning {
        Some(m) => {
            let tags = m.attrs.tags.iter().map(|t| t.0.clone()).collect();
            (Some(m.attrs.ty.0.clone()), Some(tags), Some(m.attrs.created))
        }
        None => (None, None, None),
    };
    let (v, x) = (en.vault, en.cell());
    EntryView {
        entry: en.id,
        vault: v,
        by: en.creator,
        ty,
        tags,
        created,
        cell: x,
        public: st.public_key(KeyFam::Cell(v, x)),
        roles: roles(st, v, x),
        what,
    }
}

/// The note a document is a variant of, by its mark (`VARIANT`), if it is one.
fn variant_of(doc: &DocV2) -> Option<EntryId> {
    let of = doc.tags.iter().find_map(|t| t.strip_prefix(VARIANT)).and_then(BlobId::from_hex);
    of.map(|b| EntryId(b.0))
}

/// Cap `cap` is one of the caps of cell `x`.
fn in_cell(st: &State, x: CellId, cap: CapId) -> bool {
    st.cell_caps(x).is_some_and(|caps| caps.contains(&cap))
}

/// The caps in force that reach cell `x` of vault `v`: over the vault, and on the whole of it or among the cell's.
fn reaching(st: &State, v: VaultId, x: CellId) -> impl Iterator<Item = &Issued> {
    st.caps_over(v).filter(move |cp| st.live(cp.id) && (cp.cap.wide || in_cell(st, x, cp.id)))
}

/// The strongest role each vault holds on cell `x` of vault `v`: the vault itself owner, and each vault a cap in force
/// that reaches the cell names, the strongest of those caps.
fn roles(st: &State, v: VaultId, x: CellId) -> Vec<(VaultId, Role)> {
    let mut roles = vec![(v, Role::Owner)];
    for cp in reaching(st, v, x) {
        let Grantee::Principal(Principal::Vault(g)) = cp.cap.grantee else { continue };
        match roles.iter_mut().find(|(a, _)| *a == g) {
            Some((_, r)) => *r = (*r).max(cp.cap.role),
            None => roles.push((g, cp.cap.role)),
        }
    }
    roles
}

/// The devices `devices` (each with its own vault) that receive the edits of cell `x` of vault `v`, as a peer sends
/// them (`avendb::sync`): those acting for the vault, or for a vault a cap that reaches the cell names, or every
/// device, through its own vault, if a cap to everyone reaches it.
fn syncing(st: &State, devices: &[(SignerId, VaultId)], v: VaultId, x: CellId) -> Vec<Syncing> {
    let caps: Vec<&Issued> = reaching(st, v, x).collect();
    let public = caps.iter().any(|cp| cp.cap.grantee == Grantee::Public);
    let through = |d: SignerId, own: VaultId| {
        let mut best: Option<(Role, VaultId)> = st.acts_for(d, v).then_some((Role::Owner, v));
        for cp in &caps {
            let Grantee::Principal(Principal::Vault(g)) = cp.cap.grantee else { continue };
            if st.acts_for(d, g) && best.is_none_or(|(r, _)| cp.cap.role > r) {
                best = Some((cp.cap.role, g));
            }
        }
        best.map(|(_, g)| g).or(public.then_some(own))
    };
    let k = KeyFam::Cell(v, x);
    let sync = |&(d, own): &(SignerId, VaultId)| {
        Some(Syncing { device: d, through: through(d, own)?, opens: st.entitled(d, k) })
    };
    devices.iter().filter_map(sync).collect()
}

/// The cards of vault `vault` as device `me` reads them, by the device that wrote each, the author of its entry's first
/// write: its entry and the name it reads. A device's first card counts, should it hold two.
fn cards(lab: &Lab, me: SignerId, vault: VaultId) -> BTreeMap<SignerId, (EntryId, String)> {
    let st = lab.state(me);
    let mut cards = BTreeMap::new();
    for en in st.entries().iter().filter(|en| en.vault == vault && en.creator == vault) {
        let author = st.write(en.creation).map(|w| w.author);
        let doc = || lab.item(me, en.id).and_then(Item::as_document);
        if let Some(author) = author.filter(|_| typed(lab, me, en.id, CARD))
            && let Some(doc) = doc()
        {
            cards.entry(author).or_insert((en.id, doc.title));
        }
    }
    cards
}

/// Vault `vault`'s profile as device `me` reads it: its first entry of type `PROFILE` that it wrote itself, and the
/// name it reads.
fn profile_of(lab: &Lab, me: SignerId, vault: VaultId) -> Option<(EntryId, String)> {
    let st = lab.state(me);
    let profiles = st.entries().iter().filter(|en| en.vault == vault && en.creator == vault);
    profiles.filter(|en| typed(lab, me, en.id, PROFILE)).find_map(|en| {
        let doc = lab.item(me, en.id)?.as_document()?;
        Some((en.id, doc.title))
    })
}

/// avenCEO by this view: the aven vault with a device, the server, that vault `mine` gives relay on the whole of it, as
/// its person's first device did (`Device::found`).
fn avenceo(st: &State, mine: VaultId) -> Option<VaultId> {
    let server = |v: &&Vault| v.kind == Kind::Aven && !v.devices.is_empty() && relays(st, mine, v.id);
    st.vaults().iter().find(server).map(|v| v.id)
}

/// Vault `to` holds a cap in force on the whole of vault `over`, relay or more.
fn relays(st: &State, over: VaultId, to: VaultId) -> bool {
    st.caps_over(over).any(|cp| cp.cap.wide && st.holds(to, cp, Role::Relay))
}

/// What the server's vault `avenceo` holds on the whole of vault `mine`: backup, if any cap in force there gives it
/// backup or more, else relay alone. The vaults `mine` owns give the server the same.
fn server_role(st: &State, mine: VaultId, avenceo: VaultId) -> Role {
    let backs_up = st.caps_over(mine).any(|cp| cp.cap.wide && st.holds(avenceo, cp, Role::Backup));
    if backs_up { Role::Backup } else { Role::Relay }
}

/// The owner cap vault `issuer`'s right to share a slice of vault `over` rests on: none if it is the vault itself, else
/// one in force over the vault that it holds, a cap on the whole vault first, and only such a one if the new cap is on
/// the whole vault (`wide`), as a cap on the whole vault rests only on another.
fn parent(st: &State, issuer: VaultId, over: VaultId, wide: bool) -> Option<CapId> {
    if issuer == over {
        return None;
    }
    let owner = |cp: &&Issued| cp.cap.over == over && st.holds(issuer, cp, Role::Owner) && (cp.cap.wide || !wide);
    let mut held: Vec<&Issued> = st.caps_held(issuer).filter(owner).collect();
    held.sort_by_key(|cp| !cp.cap.wide);
    held.first().map(|cp| cp.id)
}

/// A nonce of the machine's or the browser's randomness, so that no two vaults founded alike share an id.
fn nonce() -> Result<u64> {
    let mut bytes = [0; 8];
    getrandom::fill(&mut bytes).map_err(|e| anyhow!("no randomness: {e}"))?;
    Ok(u64::from_le_bytes(bytes))
}

/// What a store kept, read back (`js/store.js`): the signed edits, each as its bytes on the wire, in the order the
/// device took them, and its McEliece keys. Reading stops at the first edit that doesn't decode, as a store on disk
/// does.
pub fn backup(edits: &[Vec<u8>], keys: Vec<Arc<[u8]>>) -> Backup {
    Backup::new(edits.iter().map_while(|edit| Signed::from_wire(edit).ok()).collect(), keys)
}

/// A browser's device's Lab as it opens again: its person's passkey, by its P-256 key and the ceremony that unlocked
/// the device, and the device, its keys from its secret, which the PRF output on its salt unmasks from `mask`
/// (`Fresh::mask`), or, for a device made before 2026-10-10, with no mask, is.
fn lab(start: &Start, p256: [u8; 33], mask: Option<[u8; 32]>, unlock: &Unlock) -> Result<(Lab, SignerId, SignerId)> {
    let mut lab = Lab::with_entropy(start.entropy);
    let passkey = lab.web_passkey("the person", p256, &unlock.ceremony);
    let passkey = passkey.context("the unlock's ceremony isn't of the passkey with this P-256 key")?;
    let secret = mask.map_or_else(|| unlock.device.clone(), |mask| xor(&mask, &unlock.device));
    let me = lab.device_with(&start.name, *secret);
    Ok((lab, passkey, me))
}

/// A new device's Lab and the device, `fresh`; the passkeys its person's may be, each with its keys in the Lab; and the
/// passkey's pass for the device, the unlock, whose ceremony is over `fresh`'s challenge at `start.now`. The passkey
/// is the one whose P-256 key is `p256` if the page knows it, from the public key info of a passkey it just made; else,
/// for a passkey made before (on another device, or at maiaCITY's sign-up, for the same relying party), one of the
/// keys the unlock's assertion recovers to (`sign::RelayPass::candidates`), each of them a passkey here.
fn passed(
    start: &Start,
    p256: Option<[u8; 33]>,
    fresh: &Fresh,
    unlock: &Unlock,
) -> Result<(Lab, SignerId, Vec<SignerId>, RelayPass)> {
    let pass = unlock.ceremony.pass(fresh.keys(), start.now);
    let pass = pass.context("the unlock's ceremony isn't over this new device's challenge")?;
    let mut lab = Lab::with_entropy(start.entropy);
    let me = lab.device_with(&start.name, *fresh.secret);
    let keys = p256.map_or_else(|| unlock.ceremony.assertion.recover(), |p256| vec![p256]);
    let passkey = |p256| lab.web_passkey("the person", p256, &unlock.ceremony);
    let passkeys: Vec<SignerId> = keys.into_iter().filter_map(passkey).collect();
    if passkeys.is_empty() {
        bail!("the unlock's ceremony isn't of the passkey with this P-256 key");
    }
    Ok((lab, me, passkeys, pass))
}

/// Report a panic on the page's console: the device can't go on after one, and the page starts over.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(start)]
pub fn start() {
    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_namespace = console)]
        fn error(s: &str);
    }
    std::panic::set_hook(Box::new(|info| error(&format!("avenDB: {info}"))));
}

/// The device as the page holds it (`Device`): every call that waits on the network or on its person is a promise.
///
/// A ceremony is the page's: `ceremony(challenge, step)`, a function the device calls with the 32 bytes the passkey
/// signs and what for (`"found"`, `"join"`, `"claim"`, `"approve"`), which resolves to the ceremony's
/// `{authenticatorData, clientDataJSON, signature, prf}`, each bytes, `prf` the PRF output on `prfSalt()`. The unlock
/// is one ceremony's result that also holds `devicePrf`, the output on `deviceSalt(nonce)`, `nonce` the 32 bytes the
/// page keeps for the device. A new device asks for it as `unlock(challenge)`, a function that resolves to it, over the
/// challenge that makes it the passkey's pass for the device (`Fresh`).
#[wasm_bindgen(js_name = Device)]
pub struct PageDevice(Rc<Device>);

#[wasm_bindgen(js_class = Device)]
impl PageDevice {
    /// The first device named `name` of a new person, reaching its peers through the relay at `relay` alone, whose
    /// passkey's public key info (SPKI, as `getPublicKey()` gives it) is `spki`, or `undefined` for a passkey made
    /// before, as at maiaCITY's sign-up: unlocked by `unlock(challenge)`, it founds their human vault and makes it
    /// known to the server whose code reads `server`, which it claims if nobody has yet (`Device::found`).
    pub async fn found(
        name: String,
        relay: String,
        server: String,
        spki: Option<Vec<u8>>,
        unlock: Function,
        ceremony: Function,
        backup: Option<bool>,
    ) -> Result<PageDevice, JsError> {
        let not_p256 = || JsError::new("not a P-256 passkey's public key info");
        let p256 = spki.map(|spki| sign::spki_p256(&spki).ok_or_else(not_p256)).transpose()?;
        let server = Offer::from_text(&server).map_err(js_error)?;
        let (start, fresh) = (starting(name, &relay)?, Fresh::new().map_err(js_error)?);
        let (unlock, ceremonies) = (unlocking(&unlock, fresh.challenge(start.now)).await?, Js(ceremony));
        let device = Device::found(start, &server, p256, fresh, unlock, &ceremonies, backup.unwrap_or(true));
        Ok(PageDevice(Rc::new(device.await.map_err(js_error)?)))
    }

    /// A new device named `name` of a person who has one already, unlocked by `unlock(challenge)`, linked through the
    /// device whose code reads `offer` (`Device::link`).
    pub async fn link(name: String, relay: String, offer: String, unlock: Function) -> Result<PageDevice, JsError> {
        let offer = Offer::from_text(&offer).map_err(js_error)?;
        let (start, fresh) = (starting(name, &relay)?, Fresh::new().map_err(js_error)?);
        let unlock = unlocking(&unlock, fresh.challenge(start.now)).await?;
        let device = Device::link(start, &offer, fresh, unlock);
        Ok(PageDevice(Rc::new(device.await.map_err(js_error)?)))
    }

    /// The device named `name` the page made before, opened again: its person's passkey's P-256 key `p256` (in hex,
    /// `passkey()`), the mask its secret is kept under (in hex, `mask()`), `undefined` for a device made before
    /// 2026-10-10, and what its store kept, its `edits` in order and its McEliece `keys`, each bytes (`Device::open`).
    pub async fn open(
        name: String,
        relay: String,
        p256: String,
        mask: Option<String>,
        unlock: JsValue,
        edits: Array,
        keys: Array,
    ) -> Result<PageDevice, JsError> {
        let p256 = hex_bytes(&p256).and_then(|b| <[u8; 33]>::try_from(b).ok());
        let p256 = p256.ok_or_else(|| JsError::new("a passkey's P-256 key is 33 bytes in hex"))?;
        let not_mask = || JsError::new("a device's mask is 32 bytes in hex");
        let mask = mask.map(|m| hex_bytes(&m).and_then(|b| <[u8; 32]>::try_from(b).ok()).ok_or_else(not_mask));
        let mask = mask.transpose()?;
        let edits: Vec<Vec<u8>> = edits.iter().map(|edit| Uint8Array::new(&edit).to_vec()).collect();
        let keys = keys.iter().map(|key| Arc::from(Uint8Array::new(&key).to_vec())).collect();
        let backup = backup(&edits, keys);
        let device = Device::open(starting(name, &relay)?, p256, mask, unlocked(&unlock)?, &backup);
        Ok(PageDevice(Rc::new(device.await.map_err(js_error)?)))
    }

    /// Its device's id, in hex.
    pub fn id(&self) -> String {
        hex(&self.0.node.device().0)
    }

    /// Its endpoint's id, its device's ed25519 key, in hex.
    pub fn endpoint(&self) -> String {
        hex(self.0.node.id().as_bytes())
    }

    /// Its person's passkey's P-256 key, compressed, in hex: what the page keeps to open the device again.
    pub fn passkey(&self) -> String {
        self.0.p256.iter().map(|b| format!("{b:02x}")).collect()
    }

    /// The mask its secret is kept under, in hex (`Device::mask`): what the page keeps too, beside its salt's own
    /// bytes, to open the device again; `undefined` for a device made before 2026-10-10.
    pub fn mask(&self) -> Option<String> {
        self.0.mask.map(|mask| hex(&mask))
    }

    /// Its code, for the next device of its person to link through (`Offer::to_text`).
    pub fn offer(&self) -> String {
        self.0.node.offer().to_text()
    }

    /// The vault it belongs to, in hex: a promise, of `undefined` if none.
    pub fn vault(&self) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move { Ok(device.vault().await.map(|v| hex(&v.0)).into()) })
    }

    /// Whether its vault owns avenCEO, the aven vault the server is a device of (`Device::owns_aven`): a promise.
    #[wasm_bindgen(js_name = ownsAven)]
    pub fn owns_aven(&self) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move { Ok(device.owns_aven().await.into()) })
    }

    /// Whether avenDB's server keeps a backup of its person's vault (`Device::backs_up`): a promise of a bool, or of
    /// `undefined` while it knows no avenCEO.
    #[wasm_bindgen(js_name = backsUp)]
    pub fn backs_up(&self) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move { Ok(device.backs_up().await.map_or(JsValue::UNDEFINED, JsValue::from)) })
    }

    /// Has avenDB's server keep a backup of its person's vaults, if `on`, or relay alone (`Device::back_up`): a promise
    /// of whether anything changed.
    #[wasm_bindgen(js_name = backUp)]
    pub fn back_up(&self, on: bool) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move { Ok(device.back_up(on).await.map_err(js_value)?.into()) })
    }

    /// Its person's account (`Device::account`): a promise of `{vault, root, devices: [{id, name, me}], ownsAven}`, ids
    /// in hex, `root` the vault's root passkey, each device's `name` the one on its card, or `undefined` while it wrote
    /// none, and `me` whether it is this one; of `undefined` while it belongs to no vault.
    pub fn account(&self) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let Some(account) = device.account().await else { return Ok(JsValue::UNDEFINED) };
            let devices = Array::new();
            for (d, name) in account.devices {
                let (id, me) = (hex(&d.0).into(), (d == device.node.device()).into());
                let name = name.map_or(JsValue::UNDEFINED, JsValue::from);
                devices.push(&object(&[("id", id), ("name", name), ("me", me)]));
            }
            let (vault, owns) = (hex(&account.vault.0).into(), account.owns_aven.into());
            let root = account.root.map_or(JsValue::UNDEFINED, |r| hex(&r.0).into());
            Ok(object(&[("vault", vault), ("root", root), ("devices", devices.into()), ("ownsAven", owns)]))
        })
    }

    /// Its card reads `name` (`Device::card`): a promise of whether it wrote, rejected if its view refuses the write.
    pub fn card(&self, name: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move { Ok(device.card(name).await.map_err(js_value)?.into()) })
    }

    /// Runs op `op`, an object of the ops engine's (`Device::run`): a promise of its answer, `{ok}` or
    /// `{refused, why}`.
    pub fn run(&self, op: JsValue) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let op = String::from(js_sys::JSON::stringify(&op)?);
            let op = serde_json::from_str(&op).map_err(|e| JsError::new(&format!("no op: {e}")))?;
            js_sys::JSON::parse(&device.run(op).await.to_string())
        })
    }

    /// Vault `vault`'s (in hex) database as the device holds it, for the database studio (`data::database`): a promise
    /// of an object.
    pub fn database(&self, vault: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let vault = VaultId(id(&vault)?);
            js_sys::JSON::parse(&device.database(vault).await.to_string())
        })
    }

    /// Note `entry` (in hex) as the device holds it, for the note page (`data::note`): a promise of an object, of
    /// `undefined` while it counts no edit of it.
    pub fn note(&self, entry: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let Some(note) = device.note(EntryId(id(&entry)?)).await else { return Ok(JsValue::UNDEFINED) };
            js_sys::JSON::parse(&note.to_string())
        })
    }

    /// The database's history, every signed edit it holds, in the order it took them, for the studio's History view
    /// (`data::history`): a promise of an object.
    pub fn history(&self) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move { js_sys::JSON::parse(&device.history().await.to_string()) })
    }

    /// Its world (`Device::world`, as `World::to_json` writes it): a promise of an object, of `undefined` while it
    /// belongs to no vault.
    pub fn world(&self) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let Some(world) = device.world().await else { return Ok(JsValue::UNDEFINED) };
            js_sys::JSON::parse(&world.to_json(device.node.device()).to_string())
        })
    }

    /// New vaults its person's vault owns (`Device::found_vaults`), `vaults` an array of `{kind, name}`, each `kind`
    /// `"aven"` or `"coop"`: a promise of their ids, in hex, in the order named, after one ceremony.
    #[wasm_bindgen(js_name = foundVaults)]
    pub fn found_vaults(&self, vaults: Array, ceremony: Function) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let mut new = vec![];
            for v in vaults.iter() {
                let field = |name: &str| Reflect::get(&v, &name.into()).ok().and_then(|f| f.as_string());
                let kind = match field("kind").as_deref() {
                    Some("aven") => Kind::Aven,
                    Some("coop") => Kind::Coop,
                    _ => return Err(JsError::new("a new vault is an aven or a coop vault").into()),
                };
                new.push((kind, field("name").unwrap_or_default()));
            }
            let vaults = device.found_vaults(new, &Js(ceremony)).await.map_err(js_value)?;
            Ok(vaults.iter().map(|v| JsValue::from(hex(&v.0))).collect::<Array>().into())
        })
    }

    /// Vault `vault`'s (in hex) profile reads `name` (`Device::profile`): a promise of whether it wrote, rejected if
    /// its view refuses it.
    pub fn profile(&self, vault: String, name: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let vault = VaultId(id(&vault)?);
            Ok(device.profile(vault, name).await.map_err(js_value)?.into())
        })
    }

    /// Gives `grantee`, a vault's id or `"public"`, the role `role` (`"relay"`, `"read"`, `"write"` or `"owner"`) on
    /// what `slice` selects of vault `over`, a slice as `words` reads it (`{select, relabel, rules?}`), acting for
    /// vault `issuer` (`Device::share`): a promise of the cap's id, after one ceremony for an owner's. Ids in hex.
    pub fn share(
        &self,
        issuer: String,
        over: String,
        slice: JsValue,
        role: String,
        grantee: String,
        ceremony: Function,
    ) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (issuer, over) = (VaultId(id(&issuer)?), VaultId(id(&over)?));
            let slice = String::from(js_sys::JSON::stringify(&slice)?);
            let slice: Value = serde_json::from_str(&slice).map_err(|e| JsError::new(&format!("no slice: {e}")))?;
            let rules = words::rules_of(&slice).map_err(js_value)?;
            let slice = words::slice_of(&slice).map_err(js_value)?;
            let role = words::role_of(&role).map_err(js_value)?;
            let grantee = match grantee.as_str() {
                "public" => Grantee::Public,
                v => cast::vault(VaultId(id(v)?)),
            };
            let js = Js(ceremony);
            let cap = device.share(issuer, over, slice, rules, role, grantee, &js).await.map_err(js_value)?;
            Ok(hex(&cap.0).into())
        })
    }

    /// Ends cap `cap`, acting for vault `actor` (both in hex, `Device::revoke`): a promise, after one ceremony for an
    /// owner cap.
    pub fn revoke(&self, actor: String, cap: String, ceremony: Function) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, cap) = (VaultId(id(&actor)?), CapId(id(&cap)?));
            device.revoke(actor, cap, &Js(ceremony)).await.map_err(js_value)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// How many edits and McEliece keys it holds: a pair.
    pub fn size(&self) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (edits, keys) = device.node.read(|lab, me| lab.size(me)).await;
            Ok(Array::of2(&(edits as u32).into(), &(keys as u32).into()).into())
        })
    }

    /// Its signed edits from the `from`th on, in the order it took them, each bytes: a promise, of `undefined` if it
    /// holds fewer than `from` (`Device::edits`).
    pub fn edits(&self, from: u32) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let edits = device.edits(from as usize).await;
            let bytes =
                |edits: Vec<Vec<u8>>| edits.iter().map(|edit| Uint8Array::from(&edit[..])).collect::<Array>().into();
            Ok(edits.map_or(JsValue::UNDEFINED, bytes))
        })
    }

    /// The ids of the McEliece keys it holds, in hex: a promise.
    #[wasm_bindgen(js_name = keyIds)]
    pub fn key_ids(&self) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            Ok(device.key_ids().await.iter().map(|b| JsValue::from(b.to_hex())).collect::<Array>().into())
        })
    }

    /// McEliece key `id` (in hex), as bytes: a promise, of `undefined` if it doesn't hold it.
    pub fn key(&self, id: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let key = device.key(BlobId::from_hex(&id).ok_or_else(|| JsError::new("no key's id"))?).await;
            Ok(key.map_or(JsValue::UNDEFINED, |k| Uint8Array::from(&k[..]).into()))
        })
    }

    /// Waits until it holds other than `edits` edits and `keys` McEliece keys, what the page's store holds: a promise
    /// of true, or of false once the device closed.
    pub fn changed(&self, edits: u32, keys: u32) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move { Ok(device.changed((edits as usize, keys as usize)).await.into()) })
    }

    /// Closes its connections and its endpoint.
    pub fn close(&self) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            device.close().await.map_err(js_value)?;
            Ok(JsValue::UNDEFINED)
        })
    }
}

/// The salt of the PRF output a ceremony brings for the passkey's own keys (`sign::PRF_SALT`).
#[wasm_bindgen(js_name = prfSalt)]
pub fn prf_salt() -> Vec<u8> {
    sign::PRF_SALT.to_vec()
}

/// The salt of the device whose own 32 bytes are `nonce` (`sign::device_salt`).
#[wasm_bindgen(js_name = deviceSalt)]
pub fn device_salt(nonce: Vec<u8>) -> Result<Vec<u8>, JsError> {
    let nonce: [u8; 32] = nonce.try_into().map_err(|_| JsError::new("a device's nonce is 32 bytes"))?;
    Ok(sign::device_salt(&nonce))
}

/// `text` as a QR code, an SVG image at least `size` pixels wide: a device's code, or the link that carries it, for the
/// next device's camera. The code's base32 goes in the QR code's compact alphanumeric mode.
#[wasm_bindgen(js_name = qrSvg)]
pub fn qr_svg(text: &str, size: u32) -> Result<String, JsError> {
    let code = qrcode::QrCode::with_error_correction_level(text, qrcode::EcLevel::L);
    let code = code.map_err(|e| JsError::new(&format!("no QR code holds it: {e}")))?;
    Ok(code.render::<qrcode::render::svg::Color>().min_dimensions(size, size).build())
}

/// The key the Mac app's avenDB page holds while its sign-in sheet runs one ceremony (`js/passkey.js`): an X-Wing key
/// pair of the browser's randomness, which never leaves the page's WebAssembly and wipes itself as it is freed. The
/// app's web view may not use maia.city's passkeys, so the sheet, maia.city's own page in a sign-in sheet over the app
/// (vault/app/src/passkey.rs, macOS's ASWebAuthenticationSession), runs the ceremony and seals what it brings back to
/// this key (`sealCeremony`): what crosses from the sheet to the app holds nothing open, the PRF outputs least of all.
#[wasm_bindgen]
pub struct Sheet(keys::Secret);

#[wasm_bindgen]
impl Sheet {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<Sheet, JsError> {
        let mut bytes = Zeroizing::new([0; 32]);
        getrandom::fill(&mut *bytes).map_err(|e| JsError::new(&format!("no randomness from the browser: {e}")))?;
        Ok(Sheet(keys::Secret::from_bytes(*bytes)))
    }

    /// Its public key, which the sheet seals the ceremony to.
    pub fn key(&self) -> Vec<u8> {
        self.0.xwing_public()
    }

    /// The ceremony the sheet sealed to it over `challenge`, as `js/passkey.js` brings one back from the browser's own
    /// authenticator: the credential's id, the assertion and the PRF outputs, each in an array of its own.
    pub fn open(&self, sealed: &[u8], challenge: &[u8]) -> Result<JsValue, JsError> {
        let plain = keys::open_once(sealed, &self.0, &sheet_info(challenge));
        let plain = plain
            .ok_or_else(|| JsError::new("the sign-in sheet's answer doesn't open here: it answers another ask"))?;
        ceremony_value(&plain).map_err(js_error)
    }
}

/// Ceremony `ceremony`, as `js/passkey.js` brought it back, sealed to the Mac app's `Sheet` key `key` and bound to the
/// challenge it is over: what the app's sign-in sheet sends back. Its PRF outputs are wiped from the page as they are
/// sealed.
#[wasm_bindgen(js_name = sealCeremony)]
pub fn seal_ceremony(key: &[u8], challenge: &[u8], ceremony: &JsValue) -> Result<Vec<u8>, JsError> {
    let plain = ceremony_bytes(ceremony).map_err(js_error)?;
    let mut entropy = Zeroizing::new([0; 32]);
    getrandom::fill(&mut *entropy).map_err(|e| JsError::new(&format!("no randomness from the browser: {e}")))?;
    let mut rng = keys::SeededRng::new("sign-in sheet", &*entropy);
    let sealed = keys::seal_once(key, &plain, &sheet_info(challenge), &mut rng);
    sealed.ok_or_else(|| JsError::new("the app's key is no X-Wing key"))
}

/// What a sheet's ceremony is bound to: the challenge it is over.
fn sheet_info(challenge: &[u8]) -> Vec<u8> {
    [&b"avenDB sign-in sheet "[..], challenge].concat()
}

/// A ceremony as the sheet seals it: the credential's id, the assertion's authenticator data, client data and
/// signature, the PRF output on the app's salt and the one on the device's, empty but for an unlock; each behind its
/// length. Made at its full size at once, so no copy of the PRF outputs is left behind in a grown buffer.
fn ceremony_bytes(value: &JsValue) -> Result<Zeroizing<Vec<u8>>> {
    let id = Reflect::get(value, &"id".into()).ok().and_then(|id| id.as_string());
    let id = id.context("the ceremony brought no credential")?;
    let (data, client, signature) =
        (field(value, "authenticatorData")?, field(value, "clientDataJSON")?, field(value, "signature")?);
    let prf_out = prf(value, "prf")?;
    let device = Reflect::get(value, &"devicePrf".into()).map_err(js_anyhow)?;
    let device = if device.is_undefined() || device.is_null() { None } else { Some(prf(value, "devicePrf")?) };
    let parts: [&[u8]; 6] =
        [id.as_bytes(), &data, &client, &signature, &prf_out[..], device.as_ref().map_or(&[][..], |d| &d[..])];
    let mut out = Zeroizing::new(Vec::with_capacity(parts.iter().map(|p| 4 + p.len()).sum()));
    for part in parts {
        out.extend_from_slice(&u32::try_from(part.len())?.to_le_bytes());
        out.extend_from_slice(part);
    }
    Ok(out)
}

/// A ceremony as `ceremony_bytes` wrote it, as `js/passkey.js` brings one back.
fn ceremony_value(mut bytes: &[u8]) -> Result<JsValue> {
    let mut parts = Vec::with_capacity(6);
    while let Some((len, rest)) = bytes.split_first_chunk::<4>() {
        let (part, rest) = rest.split_at_checked(u32::from_le_bytes(*len) as usize).context("a ceremony cut short")?;
        parts.push(part);
        bytes = rest;
    }
    let ([id, data, client, signature, prf, device], []) = (&parts[..], bytes) else { bail!("not a ceremony") };
    let id = std::str::from_utf8(id).context("a credential's id is text")?;
    let array = |bytes: &[u8]| JsValue::from(Uint8Array::from(bytes));
    let mut fields = vec![
        ("id", JsValue::from_str(id)),
        ("authenticatorData", array(data)),
        ("clientDataJSON", array(client)),
        ("signature", array(signature)),
        ("prf", array(prf)),
    ];
    if !device.is_empty() {
        fields.push(("devicePrf", array(device)));
    }
    Ok(object(&fields))
}

/// The page's ceremonies (`PageDevice`'s `ceremony`).
struct Js(Function);

impl Authenticator for Js {
    async fn ceremony(&self, challenge: [u8; 32], step: Step) -> Result<Ceremony> {
        let step = match step {
            Step::Found => "found",
            Step::Join => "join",
            Step::Claim => "claim",
            Step::Approve => "approve",
        };
        let promise = self.0.call2(&JsValue::NULL, &Uint8Array::from(&challenge[..]), &step.into());
        let result = JsFuture::from(Promise::from(promise.map_err(js_anyhow)?)).await;
        ceremony_of(&result.map_err(js_anyhow)?)
    }
}

/// A ceremony as the page brings it back.
fn ceremony_of(value: &JsValue) -> Result<Ceremony> {
    let (authenticator_data, client_data_json) = (field(value, "authenticatorData")?, field(value, "clientDataJSON")?);
    let assertion = Assertion { authenticator_data, client_data_json, signature: field(value, "signature")? };
    Ok(Ceremony::new(assertion, *prf(value, "prf")?))
}

/// The unlock as the page brings it back.
fn unlocked(value: &JsValue) -> Result<Unlock, JsError> {
    let unlock = || Ok(Unlock { ceremony: ceremony_of(value)?, device: prf(value, "devicePrf")? });
    unlock().map_err(js_error)
}

/// The ceremony that unlocks a new device, over `challenge` (`Fresh::challenge`): what the page's `unlock(challenge)`
/// resolves to.
async fn unlocking(unlock: &Function, challenge: [u8; 32]) -> Result<Unlock, JsError> {
    let thrown = |e: JsValue| js_error(js_anyhow(e));
    let promise = unlock.call1(&JsValue::NULL, &Uint8Array::from(&challenge[..])).map_err(thrown)?;
    unlocked(&JsFuture::from(Promise::from(promise)).await.map_err(thrown)?)
}

/// The bytes in field `name` of `value`, as the page holds them: the very array it brought, not a copy, or a view of
/// the buffer it brought.
fn array(value: &JsValue, name: &str) -> Result<Uint8Array> {
    let bytes = Reflect::get(value, &name.into()).map_err(js_anyhow)?;
    if bytes.is_undefined() || bytes.is_null() {
        bail!("the ceremony brought no {name}");
    }
    Ok(bytes.dyn_into::<Uint8Array>().unwrap_or_else(|bytes| Uint8Array::new(&bytes)))
}

/// The bytes in field `name` of `value`.
fn field(value: &JsValue, name: &str) -> Result<Vec<u8>> {
    Ok(array(value, name)?.to_vec())
}

/// The PRF output in field `name` of `value`, wiped from the page once the device holds it: `js/passkey.js` brings it
/// as a view of the very buffer the browser gave, so the page keeps no copy of it.
fn prf(value: &JsValue, name: &str) -> Result<Zeroizing<[u8; 32]>> {
    let array = array(value, name)?;
    if array.length() != 32 {
        bail!("a PRF output is 32 bytes");
    }
    let mut prf = Zeroizing::new([0; 32]);
    array.copy_to(&mut prf[..]);
    array.fill(0, 0, 32);
    Ok(prf)
}

/// An object of the page's, of `fields`.
fn object(fields: &[(&str, JsValue)]) -> JsValue {
    let object = js_sys::Object::new();
    for (name, value) in fields {
        Reflect::set(&object, &(*name).into(), value).expect("a plain object takes a field");
    }
    object.into()
}

/// Where a device starts: named `name`, through the relay at `relay`, with the browser's randomness, now.
fn starting(name: String, relay: &str) -> Result<Start, JsError> {
    let relay: RelayUrl = relay.parse().map_err(|_| JsError::new("the relay's URL isn't one"))?;
    let mut entropy = Zeroizing::new([0; 32]);
    getrandom::fill(&mut *entropy).map_err(|e| JsError::new(&format!("no randomness from the browser: {e}")))?;
    Ok(Start { name, relay, entropy: *entropy, now: now(), direct: false, store: None })
}

/// The time by the browser's clock, or the machine's: seconds since 1970.
fn now() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// Bytes from their lowercase hex digits.
fn hex_bytes(s: &str) -> Option<Vec<u8>> {
    let digit = |c: u8| (c as char).to_digit(16).filter(|_| !c.is_ascii_uppercase()).map(|d| d as u8);
    let pair = |p: &[u8]| Some(digit(p[0])? << 4 | digit(p[1])?);
    s.len().is_multiple_of(2).then(|| s.as_bytes().chunks(2).map(pair).collect()).flatten()
}

/// An id from its 64 lowercase hex digits.
fn id(s: &str) -> Result<[u8; 32], JsValue> {
    BlobId::from_hex(s).map(|b| b.0).ok_or_else(|| JsError::new(&format!("{s:?} is no id")).into())
}

/// An error as the page sees it: the whole chain of what went wrong.
fn js_error(e: anyhow::Error) -> JsError {
    JsError::new(&format!("{e:#}"))
}

/// The same, as a promise rejects with it.
fn js_value(e: anyhow::Error) -> JsValue {
    js_error(e).into()
}

/// What the page threw, as an error.
fn js_anyhow(e: JsValue) -> anyhow::Error {
    anyhow!("{}", e.as_string().or_else(|| js_sys::Error::from(e).message().as_string()).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use avendb::sign::{Passkey, device_salt};

    use super::*;

    #[test]
    fn a_device_opens_with_its_secret_unmasked_or_one_made_before_masks_with_the_prf_output_itself() {
        let mut passkey = Passkey::from_seed([5; 32]);
        let device = passkey.prf(&device_salt(&[1; 32]));
        let unlock = Unlock { ceremony: passkey.ceremony([0xaa; 32]), device: device.clone() };
        let relay = "http://localhost:3340".parse().expect("a relay's URL");
        let start = Start { name: "Eve's browser".into(), relay, entropy: [7; 32], now: 0, direct: false, store: None };
        // a device made since 2026-10-10: its own secret, kept masked by the PRF output on its salt
        let fresh = Fresh::from_secret([9; 32]);
        let mask = fresh.mask(&unlock);
        assert_ne!(mask, [9; 32], "the mask is no secret of the device's");
        let (_, _, me) = lab(&start, passkey.public(), Some(mask), &unlock).expect("it opens");
        assert_eq!(me, fresh.keys().id());
        // one made before: the PRF output is its secret
        let (_, _, me) = lab(&start, passkey.public(), None, &unlock).expect("it opens");
        assert_eq!(me, DeviceKey::from_secret(*device).id());
    }
}
