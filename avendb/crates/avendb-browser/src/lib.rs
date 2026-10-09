//! avenDB's device in a web page (P8d, P8e): a device of its person on avenDB's network, as WebAssembly. A page has
//! no UDP, so its node (`avendb_net::Node`) reaches every peer through the server's relay, which lets a new device in
//! by a pass its person's passkey signs (`avendb::sign::RelayPass`) until it joined.
//!
//! The person's passkey stays in the browser's own authenticator (P8e): WebAuthn with the PRF extension
//! (`js/passkey.js`). The device never holds it, only what one ceremony at a time brings back, an assertion over a
//! challenge and the PRF output on the app's salt (`avendb::sign::Ceremony`). The ceremony that unlocks the device also
//! brings the PRF output on the device's own salt, from which its keys derive (`Unlock`). Then a device starts in one
//! of three ways:
//!
//! - `Device::found`: a new person's first device founds their human vault, its first space and grants avenCEO, the
//!   aven vault the server is a device of, relay on it, in three ceremonies: the unlock, the pass to the relay, and one
//!   that signs the vault's genesis and the op that adds the device together (`avendb_net::Node::found_with`). The
//!   passkey may be one the page just made, its P-256 key in its public key info, or one made before for the same
//!   relying party, maiaCITY's from its sign-up: then its P-256 key is the one key both the unlock's and the pass's
//!   assertions recover to (`sign::passkey_key`). The first person to found their vault through a server nobody has
//!   claimed yet claims it in that same ceremony (P8f): their vault owns avenCEO.
//! - `Device::link`: a device of a person who has one already links through the code it shows
//!   (`avendb_net::Node::link_with`), in four ceremonies (the unlock, the pass, the passkey's hello, the join). The
//!   passkey's P-256 key is the one key both the unlock's and the pass's assertions recover to (`sign::passkey_key`).
//! - `Device::open`: a device the page made before opens again from its store, in the unlock's ceremony alone; the
//!   server's relay knows it.
//!
//! The page keeps what the device holds in IndexedDB (`js/store.js`): its ops in the order it took them and its
//! McEliece keys, as a node keeps them on disk (`avendb_net::Disk`), saved after each change (`Node::changes`).
//!
//! The page shows its person's account (`Device::account`): their human vault, its root passkey and its devices, each
//! by the name on its card. A card is a document tagged `CARD` that the device writes into the first space its vault
//! founded, titled with its name (`Device::card`), so it travels end-to-end encrypted like any note and every device of
//! the vault shows the others by name. Notes leave cards out.
//!
//! Their vault founds and owns more vaults, aven and coop vaults, as real as their own (`Device::found_vaults`): one
//! ceremony of the passkey signs all their geneses, and then the device, acting for each through their vault (the
//! op's `via`), founds its home, the first space it founds, grants avenCEO relay on it, and writes its profile there,
//! a document tagged `PROFILE` titled with its name (`Device::profile`). The device acts for every vault its person's
//! vault owns, so the page enacts each of them: it writes, shares and revokes as that vault, and the rules check each
//! op against that vault's caps, as any peer's would. The page shows the device's whole world (`Device::world`): every
//! vault it knows, whom it acts for and through which owners, and every space with each vault's role on it, the
//! grants in force, the devices that sync it and whether each opens it or only relays its ciphertext, and the notes and
//! todos there with each vault's role on each.
//!
//! The tests run natively (`tests/device.rs`) and in Chromium (`tests/page.rs`, through `scripts/test-browser.sh`),
//! where a virtual authenticator holds the passkey.

use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::Arc;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::cast;
use avendb::doc::Item;
use avendb::id::{BlobId, EntryId, GrantId, OpId, SignerId, SpaceId, VaultId};
use avendb::keys::{self, KeyScope};
use avendb::lab::{Backup, Lab};
use avendb::lens::{DocV2, Status};
use avendb::policy::{Action, Grant, Grantee, Kind, Principal, Refusal, Role, Scope, State, Vault};
use avendb::sign::{self, Assertion, Ceremony, DeviceKey, RelayPass, Signed, SignerKeys, pass_challenge, passkey_key};
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

/// The tag of a device's card: a document in the first space its person's vault founded, titled with the device's
/// name, that the device wrote itself (`Device::card`).
pub const CARD: &str = "avendb:device";

/// The tag of a vault's profile: a document in its home, the first space it founded, titled with the vault's name,
/// written acting for the vault (`Device::profile`).
pub const PROFILE: &str = "avendb:vault";

/// What the ceremony that unlocks a device brings back: the ceremony itself, over a challenge of the page's own, and
/// the PRF output on the device's salt (`sign::device_salt`), which ends in `nonce`, its 32 bytes kept on the device.
pub struct Unlock {
    pub ceremony: Ceremony,
    pub nonce: [u8; 32],
    pub device: Zeroizing<[u8; 32]>,
}

/// Where a device in a page starts: its name, the relay it reaches its peers through, 32 bytes of the browser's
/// randomness and the time, seconds since 1970.
pub struct Start {
    pub name: String,
    pub relay: RelayUrl,
    pub entropy: [u8; 32],
    pub now: u64,
}

/// A device of its person in a browser: its node, its person's passkey, by its id and its P-256 key, and whether it
/// closed.
pub struct Device {
    node: Node,
    passkey: SignerId,
    p256: [u8; 33],
    closed: watch::Sender<bool>,
}

impl Device {
    /// The first device of a new person, whose passkey's P-256 key is `p256` (from its public key info,
    /// `sign::spki_p256`, as the browser made it), or, if the page doesn't know it, the one key the unlock's and the
    /// pass's assertions recover to (`passed`), as for the passkey the person made at maiaCITY's sign-up. Through the
    /// relay, which lets it in by the passkey's pass, it takes the card of the server whose code reads `server`, then
    /// founds the person's human vault with itself in it, in one ceremony of the passkey
    /// (`avendb_net::Node::found_with`); if nobody has claimed the server yet, the same ceremony claims it, and their
    /// vault owns avenCEO, the aven vault the server is a device of. Then it founds their first space, grants avenCEO
    /// relay on it, so the server keeps the space's log and knows the device from then on, and writes its card there
    /// (`Device::card`). The relay honours the pass while it is open to sign-up (`avendb_net::Admission::open`) or
    /// while nobody has claimed the server.
    pub async fn found(
        start: Start,
        server: &Offer,
        p256: Option<[u8; 33]>,
        unlock: Unlock,
        authenticator: &impl Authenticator,
    ) -> Result<Device> {
        let (lab, passkey, me, p256, pass) = passed(&start, p256, &unlock, authenticator).await?;
        let device = Device::spawn(lab, me, (passkey, p256), &start, Some(pass)).await?;
        device.node.know(server.addr.clone());
        let mut tries = 0;
        while let Err(e) = device.node.contact(server.addr.id).await {
            tries += 1;
            if tries == 20 {
                return Err(e.context("the server's card"));
            }
            sleep(Duration::from_millis(500)).await;
        }
        let (vault, avenceo) = device.node.found_with(server, passkey, authenticator).await?;
        let name = start.name.clone();
        let found = move |lab: &mut Lab, me| {
            let space = lab.submit(me, &[me], Action::FoundSpace { actor: vault, nonce: 1, via: vec![] });
            let space = SpaceId::from(space.map_err(|why| anyhow!("the space is refused: {why:?}"))?);
            let relay = cast::grant(Scope::Space(space), Role::Relay, cast::vault(avenceo), vault, None);
            lab.submit(me, &[me], relay).map_err(|why| anyhow!("avenCEO's relay is refused: {why:?}"))?;
            lab.create(me, vault, space, card(&name, me)).map_err(|why| anyhow!("its card is refused: {why:?}"))?;
            Ok::<_, anyhow::Error>(())
        };
        device.node.act(found).await?;
        Ok(device)
    }

    /// A new device of a person who has one already: it links through the device whose code reads `offer`
    /// (`Node::link_with`), its passkey's hello and the op that adds it signed in their ceremonies, and joins its
    /// person's vault. It learns the passkey's P-256 key from the unlock and its pass to the relay (`passed`), so it
    /// needs no ceremony more than these four.
    pub async fn link(
        start: Start,
        offer: &Offer,
        unlock: Unlock,
        authenticator: &impl Authenticator,
    ) -> Result<Device> {
        let (lab, passkey, me, p256, pass) = passed(&start, None, &unlock, authenticator).await?;
        let device = Device::spawn(lab, me, (passkey, p256), &start, Some(pass)).await?;
        device.node.link_with(offer, passkey, authenticator).await?;
        Ok(device)
    }

    /// The device the page made before, opened again from what its store kept (`backup`), unlocked by the ceremony of
    /// the passkey whose P-256 key is `p256`: the relay knows it, so it needs no pass.
    pub async fn open(start: Start, p256: [u8; 33], unlock: Unlock, backup: &Backup) -> Result<Device> {
        let (mut lab, passkey, me) = lab(&start, p256, &unlock)?;
        lab.restore_backup(me, backup);
        if lab.vault_of(me).is_none() {
            bail!("the store holds no vault this device belongs to");
        }
        Device::spawn(lab, me, (passkey, p256), &start, None).await
    }

    /// A node for device `me` of `lab`, of the person whose passkey is `passkey`, which reaches its peers through the
    /// relay alone, let in by `pass` if the relay doesn't know it yet.
    async fn spawn(
        lab: Lab,
        me: SignerId,
        (passkey, p256): (SignerId, [u8; 33]),
        start: &Start,
        pass: Option<RelayPass>,
    ) -> Result<Device> {
        let opts = Options { bind: None, relay: Some(start.relay.clone()), relay_pass: pass, ..Options::local() };
        Ok(Device { node: Node::spawn(lab, me, opts).await?, passkey, p256, closed: watch::Sender::new(false) })
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

    /// The vault it belongs to, by its view.
    pub async fn vault(&self) -> Option<VaultId> {
        self.node.read(|lab, me| lab.vault_of(me)).await
    }

    /// Whether its vault owns avenCEO, by its view: an aven vault with a device, the server, as once its person's vault
    /// claimed the server (`avendb_net::Node::found_with`).
    pub async fn owns_aven(&self) -> bool {
        self.node.read(owns_aven).await
    }

    /// Its person's account by its view (`Account`): `None` while it belongs to no vault.
    pub async fn account(&self) -> Option<Account> {
        self.node
            .read(|lab, me| {
                let vault = lab.state(me).vault(lab.vault_of(me)?)?;
                let mut names = cards(lab, me, vault.id);
                let name = |d: &SignerId| (*d, names.remove(d).map(|(_, _, name)| name));
                let devices = vault.devices.iter().map(name).collect();
                Some(Account { vault: vault.id, root: vault.root, devices, owns_aven: owns_aven(lab, me) })
            })
            .await
    }

    /// Its card reads `name`: written into the first space its vault founded if it has none yet, its title set if it
    /// reads otherwise; its peers are told. Whether it wrote: not while it knows no space of its vault, as a device
    /// just linked until the space arrives, nor if its card reads `name` already.
    pub async fn card(&self, name: String) -> Result<bool> {
        let card = move |lab: &mut Lab, me| {
            let Some(vault) = lab.vault_of(me) else { return Ok(false) };
            if let Some((space, entry, title)) = cards(lab, me, vault).remove(&me) {
                if title == name {
                    return Ok(false);
                }
                lab.edit(me, vault, space, entry, move |item| _ = item.edit_document(|d| d.title = name))?;
                return Ok(true);
            }
            let Some(space) = lab.state(me).spaces().iter().find(|s| s.founder == vault).map(|s| s.id) else {
                return Ok(false);
            };
            lab.create(me, vault, space, card(&name, me)).map(|_| true)
        };
        self.node.act(card).await.map_err(|why: Refusal| anyhow!("the card is refused: {why:?}"))
    }

    /// Its world by its view (`World`): `None` while it belongs to no vault.
    pub async fn world(&self) -> Option<World> {
        self.node.read(world).await
    }

    /// New vaults its person's vault founds and owns alone, each of kind `Kind::Aven` or `Kind::Coop` and named: one
    /// ceremony of the passkey signs all their geneses (`avendb_net::Node::approve_with`); then the device, acting for
    /// each through its own vault, founds its home, grants avenCEO relay on it so the server keeps its log, and writes
    /// its profile there (`Device::profile`). Their ids, in the order named.
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

    /// Vault `vault`'s profile reads `name`, written by this device acting for the vault: in its home, which the device
    /// founds first if the vault has none, and on which it grants avenCEO relay, so the server keeps its log, unless
    /// the vault is avenCEO itself; or, if it has a profile, its title set. Whether it wrote: not if the profile reads
    /// `name` already. Fails if the device doesn't act for the vault.
    pub async fn profile(&self, vault: VaultId, name: String) -> Result<bool> {
        let home = nonce()?;
        let profile = move |lab: &mut Lab, me| {
            let first = firsts(lab.state(me));
            if let Some((space, entry, title)) = profile_of(lab, me, vault, &first) {
                if title == name {
                    return Ok(false);
                }
                lab.edit(me, vault, space, entry, move |item| _ = item.edit_document(|d| d.title = name))?;
                return Ok(true);
            }
            let space = match home_of(lab.state(me), vault) {
                Some(space) => space,
                None => {
                    let found = Action::FoundSpace { actor: vault, nonce: home, via: vec![] };
                    let space = SpaceId::from(lab.submit(me, &[me], found)?);
                    let mine = lab.vault_of(me).ok_or(Refusal::NotActing)?;
                    if let Some(avenceo) = avenceo(lab.state(me), mine).filter(|&a| a != vault) {
                        let relay = cast::grant(Scope::Space(space), Role::Relay, cast::vault(avenceo), vault, None);
                        lab.submit(me, &[me], relay)?;
                    }
                    space
                }
            };
            lab.create(me, vault, space, tagged(&name, PROFILE, me)).map(|_| true)
        };
        self.node.act(profile).await.map_err(|why: Refusal| anyhow!("the profile is refused: {why:?}"))
    }

    /// Writes a new todo titled `title` in space `space`, acting for vault `actor`: its entry.
    pub async fn todo(&self, actor: VaultId, space: SpaceId, title: String) -> Result<EntryId> {
        let todo = move |lab: &mut Lab, me| lab.create(me, actor, space, Item::todo(&title, me));
        self.node.act(todo).await.map_err(|why| anyhow!("the todo is refused: {why:?}"))
    }

    /// Sets the status of todo `entry` in space `space`, acting for vault `actor`; its peers are told.
    pub async fn set_status(&self, actor: VaultId, space: SpaceId, entry: EntryId, status: Status) -> Result<()> {
        let edit = move |lab: &mut Lab, me| lab.edit(me, actor, space, entry, |item| item.set_status(status));
        self.node.act(edit).await.map(|_| ()).map_err(|why| anyhow!("the change is refused: {why:?}"))
    }

    /// Gives `grantee` the role `role` on `scope`, acting for vault `issuer`, which must hold owner on it: as the
    /// space's founder, or by a grant of owner, on which this one then rests. Making someone owner is governance, which
    /// the passkey approves in a ceremony; anything less this device signs alone. The grant's id.
    pub async fn grant(
        &self,
        issuer: VaultId,
        scope: Scope,
        role: Role,
        grantee: Grantee,
        authenticator: &impl Authenticator,
    ) -> Result<GrantId> {
        let parent = move |lab: &Lab, me| parent(lab.state(me), issuer, scope);
        let parent = self.node.read(parent).await;
        let grant = cast::grant(scope, role, grantee, issuer, parent);
        let refused = |why| anyhow!("the grant is refused: {why:?}");
        let id = if role == Role::Owner {
            let passkey = self.passkey;
            let draft = move |drafting: &mut avendb::lab::Drafting<'_>, _| drafting.draft(&[passkey], grant);
            self.node.approve_with(passkey, draft, authenticator).await?
        } else {
            self.node.act(move |lab, me| lab.submit(me, &[me], grant)).await.map_err(refused)?
        };
        Ok(GrantId::from(id))
    }

    /// Ends grant `grant` and every grant resting on it, acting for vault `actor`, which issued it, founded its space,
    /// or may revoke the grant it rests on. Ending an owner's grant is governance, which the passkey approves in a
    /// ceremony.
    pub async fn revoke(&self, actor: VaultId, grant: GrantId, authenticator: &impl Authenticator) -> Result<()> {
        let role = self.node.read(move |lab, me| lab.state(me).grant(grant).map(|g| g.role)).await;
        let revoke = Action::Revoke { grant, actor, keep: vec![], via: vec![] };
        if role.context("no such grant in force")? == Role::Owner {
            let passkey = self.passkey;
            let draft = move |drafting: &mut avendb::lab::Drafting<'_>, _| drafting.draft(&[passkey], revoke);
            self.node.approve_with(passkey, draft, authenticator).await?;
        } else {
            let revoked = self.node.act(move |lab, me| lab.submit(me, &[me], revoke)).await;
            revoked.map_err(|why| anyhow!("the revocation is refused: {why:?}"))?;
        }
        Ok(())
    }

    /// The text of block `block` of entry `entry` in space `space`, as the device reads it: `None` while it can't.
    pub async fn text(&self, space: SpaceId, entry: EntryId, block: u64) -> Option<String> {
        self.node.read(move |lab, me| cast::text(lab, me, space, entry, block)).await
    }

    /// Sets the text of block `block` of entry `entry` in space `space`, acting for vault `actor`; its peers are told.
    pub async fn set_text(
        &self,
        actor: VaultId,
        space: SpaceId,
        entry: EntryId,
        block: u64,
        text: String,
    ) -> Result<()> {
        let edit = move |lab: &mut Lab, me| lab.edit(me, actor, space, entry, |item| item.set_text(block, &text));
        self.node.act(edit).await.map(|_| ()).map_err(|why| anyhow!("the edit is refused: {why:?}"))
    }

    /// Writes a new document titled `title` that reads `body` in space `space`, acting for vault `actor`: its entry.
    pub async fn write(&self, actor: VaultId, space: SpaceId, title: String, body: String) -> Result<EntryId> {
        let write = move |lab: &mut Lab, me| lab.create(me, actor, space, cast::document(&title, &body, me));
        self.node.act(write).await.map_err(|why| anyhow!("the document is refused: {why:?}"))
    }

    /// The spaces it knows, each with the vault that founded it and the documents it reads there, but for the devices'
    /// cards: their entry, title and the text of their first paragraph (block 2), as `cast::document` writes them.
    pub async fn notes(&self) -> Vec<Notes> {
        self.node
            .read(|lab, me| {
                let state = lab.state(me);
                let read = |s: &avendb::policy::Space| {
                    let doc = |&e: &EntryId| Some((e, lab.item(me, s.id, e)?.as_document()?));
                    let docs = s.entries.iter().filter_map(doc).filter(|(_, d)| !is_card(d));
                    let text = |e| cast::text(lab, me, s.id, e, 2).unwrap_or_default();
                    let docs = docs.map(|(e, d)| (e, d.title.clone(), text(e)));
                    Notes { space: s.id, founder: s.founder, docs: docs.collect() }
                };
                state.spaces().iter().map(read).collect()
            })
            .await
    }

    /// The signed ops it holds from the `from`th on, in the order it took them, each as its bytes on the wire; `None`
    /// if it holds fewer than `from`, as some of what the store kept failed their checks: then the store is written
    /// anew from the first.
    pub async fn ops(&self, from: usize) -> Option<Vec<Vec<u8>>> {
        self.node
            .read(move |lab, me| {
                let ids = lab.log(me).ids();
                let wire = |id: &OpId| lab.signed_op(me, *id).expect("an op it holds").to_wire();
                ids.get(from..).map(|ids| ids.iter().map(wire).collect())
            })
            .await
    }

    /// Waits until it holds other than `held`, how many ops and McEliece keys its page's store holds
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

/// The documents of one space, as a device reads them (`Device::notes`): each one's entry, title and text.
pub struct Notes {
    pub space: SpaceId,
    pub founder: VaultId,
    pub docs: Vec<(EntryId, String, String)>,
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

/// Device `device`'s card, titled `name` (`CARD`).
fn card(name: &str, device: SignerId) -> Item {
    tagged(name, CARD, device)
}

/// A document titled `title`, tagged `tag`, made on device `device`.
fn tagged(title: &str, tag: &str, device: SignerId) -> Item {
    let mut item = Item::document(title, device);
    item.edit_document(|d| d.tags.push(tag.into()));
    item
}

fn is_card(doc: &DocV2) -> bool {
    doc.tags.iter().any(|t| t == CARD)
}

fn is_profile(doc: &DocV2) -> bool {
    doc.tags.iter().any(|t| t == PROFILE)
}

/// A device's world by its view (`Device::world`): every vault it knows, in the order they were founded, and every
/// space, in the order they were.
pub struct World {
    /// Its own vault, its person's.
    pub mine: VaultId,
    /// It trusts no curve (`Lab::set_pq_only`): only the writes a checkpoint by their author covers count.
    pub pq_only: bool,
    pub vaults: Vec<VaultView>,
    pub spaces: Vec<SpaceView>,
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
    /// Its home: the first space it founded, where its profile is.
    pub home: Option<SpaceId>,
}

/// A space as a device shows it.
pub struct SpaceView {
    pub space: SpaceId,
    pub founder: VaultId,
    /// Everyone may read it.
    pub public: bool,
    /// The role each vault holds on the whole space, the strongest, of the vaults that hold one: its founder's is
    /// owner.
    pub roles: Vec<(VaultId, Role)>,
    /// The grants in force on it or on one of its entries, each with the vaults that may revoke it.
    pub grants: Vec<(GrantId, Grant, Vec<VaultId>)>,
    /// The devices that receive its ops (`State::reaches`).
    pub syncs: Vec<Syncing>,
    /// Its entries, but the devices' cards and the vaults' profiles.
    pub items: Vec<ItemView>,
}

/// A device that receives a space's ops: the vault it receives them through, and whether it opens any of what they
/// hold, or only relays their ciphertext, as the server for avenCEO.
pub struct Syncing {
    pub device: SignerId,
    pub through: VaultId,
    pub opens: bool,
}

/// An entry as a device shows it.
pub struct ItemView {
    pub entry: EntryId,
    /// The vault its first write acted for.
    pub by: Option<VaultId>,
    /// Everyone may read it.
    pub public: bool,
    /// The role each vault holds on it, the strongest, of the vaults that hold one.
    pub roles: Vec<(VaultId, Role)>,
    pub what: What,
}

/// What an entry holds, as a device reads it.
pub enum What {
    /// A document: its title and the text of its first paragraph (block 2), as `cast::document` writes them.
    Note { title: String, text: String },
    Todo { title: String, status: Status },
    /// What the device holds but can't open.
    Sealed,
}

impl World {
    /// The world as device `me`'s page reads it (`PageDevice::world`): ids in 64 hex digits, kinds, roles and statuses
    /// by their lowercase names, each vault's and each item's roles by vault, a vault's `via` `null` where the device
    /// doesn't act for it, a grant's `grantee` `"public"` for everyone and its `entry` `null` for the whole space.
    pub fn to_json(&self, me: SignerId) -> Value {
        let roles = |roles: &[(VaultId, Role)]| {
            Value::Object(roles.iter().map(|(v, r)| (hex(&v.0), Value::from(role_name(*r)))).collect())
        };
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
                "via": v.via.as_ref().map(|via| via.iter().map(|o| hex(&o.0)).collect::<Vec<_>>()),
                "home": v.home.map(|h| hex(&h.0)),
            })
        };
        let grant = |(id, g, revokers): &(GrantId, Grant, Vec<VaultId>)| {
            let grantee = match g.grantee {
                Grantee::Public => "public".to_string(),
                Grantee::Principal(Principal::Vault(v)) => hex(&v.0),
                Grantee::Principal(Principal::Signer(s)) => hex(&s.0),
            };
            let entry = match g.scope {
                Scope::Space(_) => None,
                Scope::Entry(_, e) => Some(hex(&e.0)),
            };
            json!({
                "id": hex(&id.0),
                "role": role_name(g.role),
                "grantee": grantee,
                "issuer": hex(&g.issuer.0),
                "entry": entry,
                "parent": g.parent.map(|p| hex(&p.0)),
                "revokers": revokers.iter().map(|v| hex(&v.0)).collect::<Vec<_>>(),
            })
        };
        let syncing = |x: &Syncing| {
            json!({ "device": hex(&x.device.0), "through": hex(&x.through.0), "opens": x.opens })
        };
        let item = |i: &ItemView| {
            let (kind, title, text, status) = match &i.what {
                What::Note { title, text } => ("note", Some(title), Some(text), None),
                What::Todo { title, status } => ("todo", Some(title), None, Some(status_name(*status))),
                What::Sealed => ("sealed", None, None, None),
            };
            json!({
                "entry": hex(&i.entry.0),
                "by": i.by.map(|v| hex(&v.0)),
                "public": i.public,
                "roles": roles(&i.roles),
                "kind": kind,
                "title": title,
                "text": text,
                "status": status,
            })
        };
        let space = |s: &SpaceView| {
            json!({
                "id": hex(&s.space.0),
                "founder": hex(&s.founder.0),
                "public": s.public,
                "roles": roles(&s.roles),
                "grants": s.grants.iter().map(grant).collect::<Vec<_>>(),
                "syncs": s.syncs.iter().map(syncing).collect::<Vec<_>>(),
                "items": s.items.iter().map(item).collect::<Vec<_>>(),
            })
        };
        json!({
            "me": hex(&me.0),
            "mine": hex(&self.mine.0),
            "pqOnly": self.pq_only,
            "vaults": self.vaults.iter().map(vault).collect::<Vec<_>>(),
            "spaces": self.spaces.iter().map(space).collect::<Vec<_>>(),
        })
    }
}

fn kind_name(kind: Kind) -> &'static str {
    match kind {
        Kind::Human => "human",
        Kind::Coop => "coop",
        Kind::Aven => "aven",
    }
}

fn role_name(role: Role) -> &'static str {
    match role {
        Role::Relay => "relay",
        Role::Read => "read",
        Role::Write => "write",
        Role::Owner => "owner",
    }
}

fn status_name(status: Status) -> &'static str {
    match status {
        Status::Open => "open",
        Status::Doing => "doing",
        Status::Done => "done",
    }
}

/// Device `me`'s world by its view: `None` while it belongs to no vault.
fn world(lab: &Lab, me: SignerId) -> Option<World> {
    let st = lab.state(me);
    let mine = lab.vault_of(me)?;
    let first = firsts(st);
    let vault = |v: &Vault| {
        let names = cards(lab, me, v.id).into_iter().map(|(d, (_, _, name))| (d, name)).collect();
        let name = profile_of(lab, me, v.id, &first).map(|(_, _, name)| name);
        VaultView { vault: v.clone(), name, names, via: st.via(me, v.id), home: home_of(st, v.id) }
    };
    let vaults = st.vaults().iter().map(vault).collect();
    let devices: Vec<(SignerId, VaultId)> =
        st.vaults().iter().flat_map(|v| v.devices.iter().map(move |&d| (d, v.id))).collect();
    let space = |s: &avendb::policy::Space| {
        let sc = Scope::Space(s.id);
        let revokers = |g: &Grant| st.vaults().iter().map(|v| v.id).filter(|&a| st.may_revoke(a, g)).collect();
        let grants = st.grants().into_iter().filter(|(_, g)| g.scope.space() == s.id);
        let grants = grants.map(|(id, g)| (id, g.clone(), revokers(&g))).collect();
        // a vault receives the space's ops by a cap on it or on one of its entries: the strongest it holds
        let best = |x: VaultId| {
            let on = |sc| [Role::Owner, Role::Write, Role::Read, Role::Relay].into_iter().find(|&r| st.holds(x, sc, r));
            s.entries.iter().filter_map(|&e| on(Scope::Entry(s.id, e))).chain(on(sc)).max()
        };
        let opens = |d: SignerId| {
            st.entitled(d, KeyScope::Space(s.id)) || s.entries.iter().any(|&e| st.entitled(d, KeyScope::Entry(s.id, e)))
        };
        // a device receives them through the vault it acts for that holds the strongest cap, the first of those
        let syncing = |&(d, own): &(SignerId, VaultId)| {
            let acting = st.vaults().iter().filter(|x| st.acts_for(d, x.id));
            let held = acting.filter_map(|x| Some((best(x.id)?, x.id)));
            let stronger = |a: Option<(Role, VaultId)>, b: (Role, VaultId)| match a {
                Some(a) if a.0 >= b.0 => Some(a),
                _ => Some(b),
            };
            let through = held.fold(None, stronger);
            Syncing { device: d, through: through.map_or(own, |(_, v)| v), opens: opens(d) }
        };
        let syncs = devices.iter().filter(|(d, _)| st.reaches(*d, sc)).map(syncing).collect();
        let items = s.entries.iter().filter_map(|&e| item(lab, me, s.id, e, &first)).collect();
        let (public, roles) = (st.is_public(sc), roles(st, sc));
        SpaceView { space: s.id, founder: s.founder, public, roles, grants, syncs, items }
    };
    let spaces = st.spaces().iter().map(space).collect();
    Some(World { mine, pq_only: lab.pq_only(), vaults, spaces })
}

/// Entry `entry` of space `space` as device `me` shows it: `None` for a device's card or a vault's profile.
fn item(lab: &Lab, me: SignerId, space: SpaceId, entry: EntryId, first: &Firsts) -> Option<ItemView> {
    let what = match lab.item(me, space, entry) {
        None => What::Sealed,
        Some(item) => match (item.as_document(), item.as_todo()) {
            (Some(doc), _) if is_card(&doc) || is_profile(&doc) => return None,
            (Some(doc), _) => {
                let text = doc.blocks.iter().find(|b| b.id == 2).map(|b| b.text.clone()).unwrap_or_default();
                What::Note { title: doc.title, text }
            }
            (None, Some(todo)) => What::Todo { title: todo.title, status: todo.status },
            (None, None) => What::Sealed,
        },
    };
    let (st, sc) = (lab.state(me), Scope::Entry(space, entry));
    let by = first.get(&(space, entry)).map(|&(_, actor)| actor);
    Some(ItemView { entry, by, public: st.is_public(sc), roles: roles(st, sc), what })
}

/// The strongest role each vault holds on `sc`, of those that hold one.
fn roles(st: &State, sc: Scope) -> Vec<(VaultId, Role)> {
    let strongest = |v: &Vault| {
        let held = [Role::Owner, Role::Write, Role::Read, Role::Relay].into_iter().find(|&r| st.holds(v.id, sc, r));
        held.map(|r| (v.id, r))
    };
    st.vaults().iter().filter_map(strongest).collect()
}

/// The author and the vault of each entry's first accepted write, by space and entry.
type Firsts = BTreeMap<(SpaceId, EntryId), (SignerId, VaultId)>;

fn firsts(st: &State) -> Firsts {
    let mut first = BTreeMap::new();
    for w in st.all_writes() {
        first.entry((w.space, w.entry)).or_insert((w.author, w.actor));
    }
    first
}

/// Vault `vault`'s home: the first space it founded.
fn home_of(st: &State, vault: VaultId) -> Option<SpaceId> {
    st.spaces().iter().find(|s| s.founder == vault).map(|s| s.id)
}

/// Vault `vault`'s profile as device `me` reads it: the first document tagged `PROFILE` in a space the vault founded
/// whose first write acted for the vault, where it is and the name it reads.
fn profile_of(lab: &Lab, me: SignerId, vault: VaultId, first: &Firsts) -> Option<(SpaceId, EntryId, String)> {
    let st = lab.state(me);
    let founded = st.spaces().iter().filter(|s| s.founder == vault);
    let mut entries = founded.flat_map(|s| s.entries.iter().map(|&e| (s.id, e)));
    entries.find_map(|(s, e)| {
        let doc = lab.item(me, s, e)?.as_document().filter(is_profile)?;
        (first.get(&(s, e))?.1 == vault).then_some((s, e, doc.title))
    })
}

/// avenCEO by this view: the aven vault with a device, the server, that holds relay on the home of vault `mine`, as
/// its person's first device granted it (`Device::found`).
fn avenceo(st: &State, mine: VaultId) -> Option<VaultId> {
    let home = Scope::Space(home_of(st, mine)?);
    let relays = |v: &&Vault| v.kind == Kind::Aven && !v.devices.is_empty() && st.holds(v.id, home, Role::Relay);
    st.vaults().iter().find(relays).map(|v| v.id)
}

/// The grant vault `issuer`'s right to grant on `scope` rests on: none if it founded the space, else a grant of owner
/// to it covering the scope, if it holds one.
fn parent(st: &State, issuer: VaultId, scope: Scope) -> Option<GrantId> {
    if st.founder(scope.space()) == Some(issuer) {
        return None;
    }
    let owner = |g: &Grant| {
        g.grantee == Grantee::Principal(Principal::Vault(issuer)) && g.role == Role::Owner && g.scope.covers(scope)
    };
    st.grants().into_iter().find(|(_, g)| owner(g)).map(|(id, _)| id)
}

/// A nonce of the machine's or the browser's randomness, so that no two vaults or spaces founded alike share an id.
fn nonce() -> Result<u64> {
    let mut bytes = [0; 8];
    getrandom::fill(&mut bytes).map_err(|e| anyhow!("no randomness: {e}"))?;
    Ok(u64::from_le_bytes(bytes))
}

/// The cards in the spaces vault `vault` founded, as device `me` reads them, by the device that wrote each, the author
/// of its entry's first write: where it is and the name it reads. A device's first card counts, should it hold two.
fn cards(lab: &Lab, me: SignerId, vault: VaultId) -> BTreeMap<SignerId, (SpaceId, EntryId, String)> {
    let state = lab.state(me);
    let mut first = BTreeMap::new();
    for w in state.all_writes() {
        first.entry((w.space, w.entry)).or_insert(w.author);
    }
    let mut cards = BTreeMap::new();
    for s in state.spaces().iter().filter(|s| s.founder == vault) {
        for &e in &s.entries {
            let doc = lab.item(me, s.id, e).and_then(Item::as_document).filter(is_card);
            if let (Some(doc), Some(&author)) = (doc, first.get(&(s.id, e))) {
                cards.entry(author).or_insert((s.id, e, doc.title));
            }
        }
    }
    cards
}

/// What a store kept, read back (`js/store.js`): the signed ops, each as its bytes on the wire, in the order the device
/// took them, and its McEliece keys. Reading stops at the first op that doesn't decode, as a store on disk does.
pub fn backup(ops: &[Vec<u8>], keys: Vec<Arc<[u8]>>) -> Backup {
    Backup::new(ops.iter().map_while(|op| Signed::from_wire(op).ok()).collect(), keys)
}

/// A browser's device's Lab: its person's passkey, by its P-256 key and the ceremony that unlocked the device, and the
/// device, its keys from the PRF output on its salt.
fn lab(start: &Start, p256: [u8; 33], unlock: &Unlock) -> Result<(Lab, SignerId, SignerId)> {
    let mut lab = Lab::with_entropy(start.entropy);
    let passkey = lab.web_passkey("the person", p256, &unlock.ceremony);
    let passkey = passkey.context("the unlock's ceremony isn't of the passkey with this P-256 key")?;
    let me = lab.web_device(passkey, &start.name, unlock.nonce, *unlock.device);
    Ok((lab, passkey, me))
}

/// A new device's Lab, its person's passkey and the device, the passkey's P-256 key and its pass to the relay for the
/// device, made in a ceremony. The P-256 key is `p256` if the page knows it, from the public key info of a passkey it
/// just made; else, for a passkey made before (on another device, or at maiaCITY's sign-up, for the same relying
/// party), the one key both the unlock's and the pass's assertions recover to (`sign::passkey_key`).
async fn passed(
    start: &Start,
    p256: Option<[u8; 33]>,
    unlock: &Unlock,
    authenticator: &impl Authenticator,
) -> Result<(Lab, SignerId, SignerId, [u8; 33], RelayPass)> {
    let SignerKeys::Device { ed25519: endpoint, .. } = DeviceKey::from_secret(*unlock.device).keys() else {
        bail!("a device's keys")
    };
    let ceremony = authenticator.ceremony(pass_challenge(&endpoint, start.now), Step::Pass).await?;
    let p256 = match p256 {
        Some(p256) => p256,
        None => passkey_key(&unlock.ceremony.assertion, &ceremony.assertion)
            .context("no one key of a passkey signed both the unlock and the pass")?,
    };
    let (lab, passkey, me) = lab(start, p256, unlock)?;
    let keys = lab.keys_of(passkey).context("the passkey's keys")?;
    let pass = ceremony.pass(keys, endpoint, start.now).context("the passkey's pass to the relay")?;
    Ok((lab, passkey, me, p256, pass))
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
/// signs and what for (`"pass"`, `"found"`, `"hello"`, `"join"`, `"claim"`, `"approve"`), which resolves to the
/// ceremony's `{authenticatorData, clientDataJSON, signature, prf}`, each bytes, `prf` the PRF output on `prfSalt()`.
/// The unlock is one ceremony's result that also holds `devicePrf`, the output on `deviceSalt(nonce)`, and `nonce`.
#[wasm_bindgen(js_name = Device)]
pub struct PageDevice(Rc<Device>);

#[wasm_bindgen(js_class = Device)]
impl PageDevice {
    /// The first device named `name` of a new person, reaching its peers through the relay at `relay` alone, whose
    /// passkey's public key info (SPKI, as `getPublicKey()` gives it) is `spki`, or `undefined` for a passkey made
    /// before, as at maiaCITY's sign-up: it founds their human vault and makes it known to the server whose code reads
    /// `server`, which it claims if nobody has yet (`Device::found`).
    pub async fn found(
        name: String,
        relay: String,
        server: String,
        spki: Option<Vec<u8>>,
        unlock: JsValue,
        ceremony: Function,
    ) -> Result<PageDevice, JsError> {
        let not_p256 = || JsError::new("not a P-256 passkey's public key info");
        let p256 = spki.map(|spki| sign::spki_p256(&spki).ok_or_else(not_p256)).transpose()?;
        let server = Offer::from_text(&server).map_err(js_error)?;
        let ceremonies = Js(ceremony);
        let device = Device::found(starting(name, &relay)?, &server, p256, unlocked(&unlock)?, &ceremonies);
        Ok(PageDevice(Rc::new(device.await.map_err(js_error)?)))
    }

    /// A new device named `name` of a person who has one already, linked through the device whose code reads `offer`
    /// (`Device::link`).
    pub async fn link(
        name: String,
        relay: String,
        offer: String,
        unlock: JsValue,
        ceremony: Function,
    ) -> Result<PageDevice, JsError> {
        let offer = Offer::from_text(&offer).map_err(js_error)?;
        let ceremonies = Js(ceremony);
        let device = Device::link(starting(name, &relay)?, &offer, unlocked(&unlock)?, &ceremonies);
        Ok(PageDevice(Rc::new(device.await.map_err(js_error)?)))
    }

    /// The device named `name` the page made before, opened again: its person's passkey's P-256 key `p256` (in hex,
    /// `passkey()`), and what its store kept, its `ops` in order and its McEliece `keys`, each bytes (`Device::open`).
    pub async fn open(
        name: String,
        relay: String,
        p256: String,
        unlock: JsValue,
        ops: Array,
        keys: Array,
    ) -> Result<PageDevice, JsError> {
        let p256 = hex_bytes(&p256).and_then(|b| <[u8; 33]>::try_from(b).ok());
        let p256 = p256.ok_or_else(|| JsError::new("a passkey's P-256 key is 33 bytes in hex"))?;
        let ops: Vec<Vec<u8>> = ops.iter().map(|op| Uint8Array::new(&op).to_vec()).collect();
        let keys = keys.iter().map(|key| Arc::from(Uint8Array::new(&key).to_vec())).collect();
        let backup = backup(&ops, keys);
        let device = Device::open(starting(name, &relay)?, p256, unlocked(&unlock)?, &backup);
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

    /// The text of block `block` of entry `entry` in space `space` (both in hex), as the device reads it: a promise, of
    /// `undefined` while it can't.
    pub fn text(&self, space: String, entry: String, block: u32) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (space, entry) = (SpaceId(id(&space)?), EntryId(id(&entry)?));
            Ok(device.text(space, entry, block.into()).await.into())
        })
    }

    /// Sets the text of block `block` of entry `entry` in space `space`, acting for vault `actor` (each in hex): a
    /// promise, rejected if the device's view refuses the edit.
    #[wasm_bindgen(js_name = setText)]
    pub fn set_text(&self, actor: String, space: String, entry: String, block: u32, text: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, space, entry) = (VaultId(id(&actor)?), SpaceId(id(&space)?), EntryId(id(&entry)?));
            device.set_text(actor, space, entry, block.into(), text).await.map_err(js_value)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Writes a new document titled `title` that reads `body` in space `space`, acting for vault `actor` (both in
    /// hex): a promise of its entry, in hex.
    pub fn write(&self, actor: String, space: String, title: String, body: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, space) = (VaultId(id(&actor)?), SpaceId(id(&space)?));
            Ok(hex(&device.write(actor, space, title, body).await.map_err(js_value)?.0).into())
        })
    }

    /// The spaces it knows and the documents it reads in each (`Device::notes`): a promise of
    /// `[{space, founder, docs: [{entry, title, text}]}]`, ids in hex.
    pub fn notes(&self) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let spaces = Array::new();
            for notes in device.notes().await {
                let docs = Array::new();
                for (entry, title, text) in notes.docs {
                    let entry = hex(&entry.0).into();
                    docs.push(&object(&[("entry", entry), ("title", title.into()), ("text", text.into())]));
                }
                let (space, founder) = (hex(&notes.space.0).into(), hex(&notes.founder.0).into());
                spaces.push(&object(&[("space", space), ("founder", founder), ("docs", docs.into())]));
            }
            Ok(spaces.into())
        })
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

    /// Writes a new todo titled `title` in space `space`, acting for vault `actor` (both in hex): a promise of its
    /// entry, in hex.
    pub fn todo(&self, actor: String, space: String, title: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, space) = (VaultId(id(&actor)?), SpaceId(id(&space)?));
            Ok(hex(&device.todo(actor, space, title).await.map_err(js_value)?.0).into())
        })
    }

    /// Sets the status (`"open"`, `"doing"` or `"done"`) of todo `entry` in space `space`, acting for vault `actor`
    /// (each in hex): a promise, rejected if the device's view refuses the change.
    #[wasm_bindgen(js_name = setStatus)]
    pub fn set_status(&self, actor: String, space: String, entry: String, status: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, space, entry) = (VaultId(id(&actor)?), SpaceId(id(&space)?), EntryId(id(&entry)?));
            let status = match status.as_str() {
                "open" => Status::Open,
                "doing" => Status::Doing,
                "done" => Status::Done,
                _ => return Err(JsError::new("a todo is open, doing or done").into()),
            };
            device.set_status(actor, space, entry, status).await.map_err(js_value)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Gives `grantee`, a vault's id or `"public"`, the role `role` (`"relay"`, `"read"`, `"write"` or `"owner"`) on
    /// space `space`, or on its entry `entry` if given, acting for vault `issuer` (`Device::grant`): a promise of the
    /// grant's id, after one ceremony for an owner's. Ids in hex.
    pub fn grant(
        &self,
        issuer: String,
        space: String,
        entry: Option<String>,
        role: String,
        grantee: String,
        ceremony: Function,
    ) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (issuer, space) = (VaultId(id(&issuer)?), SpaceId(id(&space)?));
            let scope = match entry {
                Some(entry) => Scope::Entry(space, EntryId(id(&entry)?)),
                None => Scope::Space(space),
            };
            let role = match role.as_str() {
                "relay" => Role::Relay,
                "read" => Role::Read,
                "write" => Role::Write,
                "owner" => Role::Owner,
                _ => return Err(JsError::new("a role is relay, read, write or owner").into()),
            };
            let grantee = match grantee.as_str() {
                "public" => Grantee::Public,
                v => cast::vault(VaultId(id(v)?)),
            };
            let grant = device.grant(issuer, scope, role, grantee, &Js(ceremony)).await.map_err(js_value)?;
            Ok(hex(&grant.0).into())
        })
    }

    /// Ends grant `grant`, acting for vault `actor` (both in hex, `Device::revoke`): a promise, after one ceremony for
    /// an owner's grant.
    pub fn revoke(&self, actor: String, grant: String, ceremony: Function) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, grant) = (VaultId(id(&actor)?), GrantId(id(&grant)?));
            device.revoke(actor, grant, &Js(ceremony)).await.map_err(js_value)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// How many ops and McEliece keys it holds: a pair.
    pub fn size(&self) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (ops, keys) = device.node.read(|lab, me| lab.size(me)).await;
            Ok(Array::of2(&(ops as u32).into(), &(keys as u32).into()).into())
        })
    }

    /// Its signed ops from the `from`th on, in the order it took them, each bytes: a promise, of `undefined` if it
    /// holds fewer than `from` (`Device::ops`).
    pub fn ops(&self, from: u32) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let ops = device.ops(from as usize).await;
            let bytes = |ops: Vec<Vec<u8>>| ops.iter().map(|op| Uint8Array::from(&op[..])).collect::<Array>().into();
            Ok(ops.map_or(JsValue::UNDEFINED, bytes))
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

    /// Waits until it holds other than `ops` ops and `keys` McEliece keys, what the page's store holds: a promise of
    /// true, or of false once the device closed.
    pub fn changed(&self, ops: u32, keys: u32) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move { Ok(device.changed((ops as usize, keys as usize)).await.into()) })
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
        let plain = plain.ok_or_else(|| JsError::new("the sign-in sheet's answer doesn't open here: it answers another ask"))?;
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
    let (data, client, signature) = (field(value, "authenticatorData")?, field(value, "clientDataJSON")?, field(value, "signature")?);
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
            Step::Pass => "pass",
            Step::Found => "found",
            Step::Hello => "hello",
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
    let unlock = || {
        let nonce = field(value, "nonce")?.try_into().map_err(|_| anyhow!("a device's nonce is 32 bytes"))?;
        Ok(Unlock { ceremony: ceremony_of(value)?, nonce, device: prf(value, "devicePrf")? })
    };
    unlock().map_err(js_error)
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
    Ok(Start { name, relay, entropy: *entropy, now: now() })
}

/// The time by the browser's clock, or the machine's: seconds since 1970.
fn now() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// 32 bytes as 64 lowercase hex digits, as the page sees every id.
fn hex(b: &[u8; 32]) -> String {
    BlobId(*b).to_hex()
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
