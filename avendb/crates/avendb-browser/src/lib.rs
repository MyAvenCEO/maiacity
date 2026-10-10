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
//! - `Device::found`: a new person's first device founds their human vault, gives avenCEO, the aven vault the server
//!   is a device of, relay on the whole of it, and writes its card there, in three ceremonies: the unlock, the pass to
//!   the relay, and one that signs the vault's genesis and the edit that adds the device together
//!   (`avendb_net::Node::found_with`). The passkey may be one the page just made, its P-256 key in its public key info,
//!   or one made before for the same relying party, maiaCITY's from its sign-up: then its P-256 key is the one key both
//!   the unlock's and the pass's assertions recover to (`sign::passkey_key`). The first person to found their vault
//!   through a server nobody has claimed yet claims it in that same ceremony (P8f): their vault owns avenCEO.
//! - `Device::link`: a device of a person who has one already links through the code it shows
//!   (`avendb_net::Node::link_with`), in four ceremonies (the unlock, the pass, the passkey's hello, the join). The
//!   passkey's P-256 key is the one key both the unlock's and the pass's assertions recover to (`sign::passkey_key`).
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
//! Each note opens on its page (`Device::note`): its main line and each proposal (a proposal of its history), and every
//! edit of it, each with what it changed, to edit on any line, retitle, propose, merge, promote, restore, undo or make
//! a variant (a new note with what a line shows, marked with the note it came from), acting for a vault as any edit
//! does (`Device::set_text_on`, `set_title_on`, `propose`, `merge`, `restore`, `undo`, `variant`). And each vault's
//! database shows as the device holds it, every entry with its record, its type, its tags, its cell and its edits, and
//! the schemas and lenses the app ships and the vault publishes (`Device::database`, `data`); and the database's
//! history, every signed edit the device holds (the core's edits), each with what it does, who signed it and how, and
//! the vaults it concerns (`Device::history`).
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
use avendb::id::{BlobId, CapId, CellId, EditId, EntryId, SignerId, VaultId};
use avendb::keys::{self, KeyFam};
use avendb::lab::{Backup, Lab, NewCap};
use avendb::lens::{DocV2, Status, TypeV2};
use avendb::policy::{Action, Cap, Grantee, Issued, Kind, Line, Principal, Refusal, Role, State, Vault};
use avendb::sign::{self, Assertion, Ceremony, DeviceKey, RelayPass, Signed, SignerKeys, pass_challenge, passkey_key};
use avendb::slice::{Selector, Slice, Sym};
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

/// What the ceremony that unlocks a device brings back: the ceremony itself, over a challenge of the page's own, and
/// the PRF output on the device's salt (`sign::device_salt`), which ends in `nonce`, its 32 bytes kept on the device.
pub struct Unlock {
    pub ceremony: Ceremony,
    pub nonce: [u8; 32],
    pub device: Zeroizing<[u8; 32]>,
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
    /// vault owns avenCEO, the aven vault the server is a device of. Then it gives avenCEO relay on the whole vault, so
    /// the server keeps its entries and knows the device from then on, and writes its card there (`Device::card`). The
    /// relay honours the pass while it is open to sign-up (`avendb_net::Admission::open`) or while nobody has claimed
    /// the server.
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
            let relay = cast::cap(vault, cast::vault(avenceo), Role::Relay, Selector::All);
            lab.issue(me, &[me], relay).map_err(|why| anyhow!("avenCEO's relay is refused: {why:?}"))?;
            let card = named(&name, me);
            lab.create(me, vault, vault, CARD, &[], card).map_err(|why| anyhow!("its card is refused: {why:?}"))?;
            Ok::<_, anyhow::Error>(())
        };
        device.node.act(found).await?;
        Ok(device)
    }

    /// A new device of a person who has one already: it links through the device whose code reads `offer`
    /// (`Node::link_with`), its passkey's hello and the edit that adds it signed in their ceremonies, and joins its
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
    /// the passkey whose P-256 key is `p256`: the relay knows it, so it needs no pass. A device with a folder of its
    /// own (`Start::store`) opens from what the folder holds, or, while it holds nothing, from `backup`, which it then
    /// keeps there: so the Mac app's device moves from its page's store to disk.
    pub async fn open(start: Start, p256: [u8; 33], unlock: Unlock, backup: &Backup) -> Result<Device> {
        let (mut lab, passkey, me) = lab(&start, p256, &unlock)?;
        lab.restore_backup(me, backup);
        if start.store.is_none() && lab.vault_of(me).is_none() {
            bail!("the store holds no vault this device belongs to");
        }
        let device = Device::spawn(lab, me, (passkey, p256), &start, None).await?;
        if device.vault().await.is_none() {
            device.close().await.ok();
            bail!("the store holds no vault this device belongs to");
        }
        Ok(device)
    }

    /// A node for device `me` of `lab`, of the person whose passkey is `passkey`, which reaches its peers through the
    /// relay, let in by `pass` if the relay doesn't know it yet, and directly too if it binds a socket; with its store
    /// in a folder, if it has one.
    async fn spawn(
        lab: Lab,
        me: SignerId,
        (passkey, p256): (SignerId, [u8; 33]),
        start: &Start,
        pass: Option<RelayPass>,
    ) -> Result<Device> {
        let (direct, relay, store) = (start.direct, Some(start.relay.clone()), start.store.clone());
        let opts = Options { bind: None, direct, relay, relay_pass: pass, store, ..Options::local() };
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
                lab.issue(me, &[me], cast::cap(vault, cast::vault(avenceo), Role::Relay, Selector::All))?;
            }
            lab.create(me, vault, vault, PROFILE, &[], named(&name, me)).map(|_| true)
        };
        self.node.act(profile).await.map_err(|why: Refusal| anyhow!("the profile is refused: {why:?}"))
    }

    /// Writes a new todo titled `title` with tags `tags` into vault `vault`, acting for vault `actor`, the vault itself
    /// or one holding a cap with write or more on a slice that holds it: its entry.
    pub async fn todo(&self, actor: VaultId, vault: VaultId, title: String, tags: Vec<String>) -> Result<EntryId> {
        let todo = move |lab: &mut Lab, me| lab.create(me, actor, vault, TODO, &strs(&tags), Item::todo(&title, me));
        self.node.act(todo).await.map_err(|why| anyhow!("the todo is refused: {why:?}"))
    }

    /// Sets the status of todo `entry`, acting for vault `actor`; its peers are told.
    pub async fn set_status(&self, actor: VaultId, entry: EntryId, status: Status) -> Result<()> {
        let edit = move |lab: &mut Lab, me| lab.edit(me, actor, entry, |item| item.set_status(status));
        self.node.act(edit).await.map(|_| ()).map_err(|why| anyhow!("the change is refused: {why:?}"))
    }

    /// Adds the tags `add` to entry `entry` and removes the tags `remove`, acting for vault `actor`; its peers are told.
    /// They count at once when `actor` is the entry's vault; anyone else asks the vault's stewards, its devices, who
    /// answer with what the caps it holds let it ask for (`Lab::tag`). A tag that takes an entry into or out of a
    /// cap's slice moves it to the cell those caps reach.
    pub async fn tag(&self, actor: VaultId, entry: EntryId, add: Vec<String>, remove: Vec<String>) -> Result<()> {
        let tag = move |lab: &mut Lab, me| lab.tag(me, actor, entry, &strs(&add), &strs(&remove));
        self.node.act(tag).await.map(|_| ()).map_err(|why| anyhow!("the tags are refused: {why:?}"))
    }

    /// Gives `grantee` the role `role` on what `slice` selects of vault `over`, acting for vault `issuer`: the vault
    /// itself, or a vault holding an owner cap over it, on which this one then rests, a wide one for a cap on the whole
    /// vault (`parent`). Making someone owner is governance, which the passkey approves in a ceremony; anything less
    /// this device signs alone. The cap's slice is sealed to the vault, its grantee and its issuer. The cap's id.
    pub async fn share(
        &self,
        issuer: VaultId,
        over: VaultId,
        slice: Slice,
        role: Role,
        grantee: Grantee,
        authenticator: &impl Authenticator,
    ) -> Result<CapId> {
        let wide = slice.select == Selector::All;
        let parent = self.node.read(move |lab, me| parent(lab.state(me), issuer, over, wide)).await;
        let new = NewCap { over, grantee, role, slice, parent, issuer };
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

    /// The text of block `block` of entry `entry`, as the device reads it: `None` while it can't.
    pub async fn text(&self, entry: EntryId, block: u64) -> Option<String> {
        self.node.read(move |lab, me| cast::text(lab, me, entry, block)).await
    }

    /// Sets the text of block `block` of entry `entry`, acting for vault `actor`; its peers are told.
    pub async fn set_text(&self, actor: VaultId, entry: EntryId, block: u64, text: String) -> Result<()> {
        let edit = move |lab: &mut Lab, me| lab.edit(me, actor, entry, |item| item.set_text(block, &text));
        self.node.act(edit).await.map(|_| ()).map_err(|why| anyhow!("the edit is refused: {why:?}"))
    }

    /// Writes a new note titled `title` that reads `body`, with tags `tags`, into vault `vault`, acting for vault
    /// `actor`: its entry.
    pub async fn write(
        &self,
        actor: VaultId,
        vault: VaultId,
        (title, body): (String, String),
        tags: Vec<String>,
    ) -> Result<EntryId> {
        let write = move |lab: &mut Lab, me| {
            lab.create(me, actor, vault, NOTE, &strs(&tags), cast::document(&title, &body, me))
        };
        self.node.act(write).await.map_err(|why| anyhow!("the note is refused: {why:?}"))
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

    /// Sets the text of block `block` of entry `entry` on line `line` of its history, acting for vault `actor`; its
    /// peers are told.
    pub async fn set_text_on(&self, actor: VaultId, entry: EntryId, line: Line, block: u64, text: String) -> Result<()> {
        let edit = move |lab: &mut Lab, me| lab.edit_on(me, actor, entry, line, |item| item.set_text(block, &text));
        self.node.act(edit).await.map(|_| ()).map_err(|why| anyhow!("the edit is refused: {why:?}"))
    }

    /// Retitles document `entry` on line `line` of its history, and its opening heading with it, acting for vault
    /// `actor`; its peers are told. Refused if it isn't a document.
    pub async fn set_title_on(&self, actor: VaultId, entry: EntryId, line: Line, title: String) -> Result<()> {
        let edit = move |lab: &mut Lab, me| {
            if lab.item_on(me, entry, line).and_then(Item::as_document).is_none() {
                return Ok(None);
            }
            // the heading a note opens with (`cast::document`'s block 1) is its title too
            let retitle = |item: &mut Item| {
                _ = item.edit_document(|d| {
                    if let Some(h) = d.blocks.iter_mut().find(|b| b.id == 1 && b.r#type == TypeV2::Heading) {
                        h.text.clone_from(&title);
                    }
                    d.title = title;
                });
            };
            lab.edit_on(me, actor, entry, line, retitle).map(Some)
        };
        let made = self.node.act(edit).await.map_err(|why| anyhow!("the edit is refused: {why:?}"))?;
        made.map(|_| ()).context("only a document has a title")
    }

    /// Proposes a change to entry `entry`: a proposal named `name`, a line of its own that starts from version `from`,
    /// acting for vault `actor` (`Lab::propose`): the new line, named by its first edit.
    pub async fn propose(&self, actor: VaultId, entry: EntryId, from: Vec<EditId>, name: String) -> Result<EditId> {
        let propose = move |lab: &mut Lab, me| lab.propose(me, actor, entry, &from, &name);
        self.node.act(propose).await.map_err(|why| anyhow!("the proposal is refused: {why:?}"))
    }

    /// Merges line `from` of entry `entry` into line `into`, acting for vault `actor`; with `promote`, `into` then shows
    /// exactly what `from` does (`Lab::merge`, `Lab::promote`).
    pub async fn merge(
        &self,
        actor: VaultId,
        entry: EntryId,
        (from, into): (Line, Line),
        promote: bool,
    ) -> Result<EditId> {
        let merge = move |lab: &mut Lab, me| match promote {
            true => lab.promote(me, actor, entry, from, into),
            false => lab.merge(me, actor, entry, from, into),
        };
        self.node.act(merge).await.map_err(|why| anyhow!("the merge is refused: {why:?}"))
    }

    /// Puts the record of version `version` of entry `entry` back on line `line`, acting for vault `actor`
    /// (`Lab::restore`).
    pub async fn restore(&self, actor: VaultId, entry: EntryId, line: Line, version: Vec<EditId>) -> Result<EditId> {
        let restore = move |lab: &mut Lab, me| lab.restore(me, actor, entry, line, &version);
        self.node.act(restore).await.map_err(|why| anyhow!("the restore is refused: {why:?}"))
    }

    /// Undoes write `edit` of entry `entry` on line `line`, keeping every change made since, acting for vault `actor`
    /// (`Lab::undo`).
    pub async fn undo(&self, actor: VaultId, entry: EntryId, line: Line, edit: EditId) -> Result<EditId> {
        let undo = move |lab: &mut Lab, me| lab.undo(me, actor, entry, line, edit);
        self.node.act(undo).await.map_err(|why| anyhow!("the undo is refused: {why:?}"))
    }

    /// Makes a variant of entry `entry`: a new entry of vault `into` with what its line `line` shows and none of its
    /// history, of its type and with its tags, its document marked `VARIANT` with the entry it came from in place of
    /// any such mark it had, acting for vault `actor`: the new entry.
    pub async fn variant(&self, actor: VaultId, entry: EntryId, line: Line, into: VaultId) -> Result<EntryId> {
        let variant = move |lab: &mut Lab, me| {
            let mut copy = lab.item_on(me, entry, line).ok_or(Refusal::ReadOnly)?.copy(me);
            let m = lab.meaning(me, entry).ok_or(Refusal::ReadOnly)?;
            copy.edit_document(|d| {
                d.tags.retain(|t| !t.starts_with(VARIANT));
                d.tags.push(format!("{VARIANT}{}", hex(&entry.0)));
            });
            let tags: Vec<&str> = m.attrs.tags.iter().map(Sym::as_str).collect();
            lab.create(me, actor, into, m.attrs.ty.as_str(), &tags, copy)
        };
        self.node.act(variant).await.map_err(|why| anyhow!("the variant is refused: {why:?}"))
    }

    /// The notes it reads, by their vault, of each vault that has one: each note's entry, title and the text of its
    /// first paragraph (block 2), as `cast::document` writes them.
    pub async fn notes(&self) -> Vec<Notes> {
        self.node
            .read(|lab, me| {
                let st = lab.state(me);
                let read = |v: &Vault| {
                    let notes = st.entries().iter().filter(|en| en.vault == v.id && typed(lab, me, en.id, NOTE));
                    let doc = |e: EntryId| Some((e, lab.item(me, e)?.as_document()?));
                    let docs = notes.filter_map(|en| doc(en.id));
                    let docs = docs.map(|(e, d)| (e, d.title, cast::text(lab, me, e, 2).unwrap_or_default()));
                    Notes { vault: v.id, docs: docs.collect() }
                };
                st.vaults().iter().map(read).filter(|n| !n.docs.is_empty()).collect()
            })
            .await
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

/// The notes of one vault, as a device reads them (`Device::notes`): each one's entry, title and text.
pub struct Notes {
    pub vault: VaultId,
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

/// A document titled `title`, made on device `device`: a card's or a profile's record.
fn named(title: &str, device: SignerId) -> Item {
    Item::document(title, device)
}

/// Entry `e` is of type `ty`, as device `me` reads its header.
fn typed(lab: &Lab, me: SignerId, e: EntryId, ty: &str) -> bool {
    lab.meaning(me, e).is_some_and(|m| m.attrs.ty.as_str() == ty)
}

/// Tags as the Lab takes them.
fn strs(tags: &[String]) -> Vec<&str> {
    tags.iter().map(String::as_str).collect()
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
    /// Its type and its tags now, if the device reads them: they travel inside its encrypted writes.
    pub ty: Option<String>,
    pub tags: Option<Vec<String>>,
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
    /// entry's `type` and `tags` `null` where the device doesn't read them and its `roles` by vault.
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
        let reaches = |en: &&avendb::policy::Entry| en.vault == cp.cap.over && (cp.cap.wide || in_cell(st, en.cell(), cp.id));
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
    let (ty, tags) = match &meaning {
        Some(m) => (Some(m.attrs.ty.0.clone()), Some(m.attrs.tags.iter().map(|t| t.0.clone()).collect())),
        None => (None, None),
    };
    let (v, x) = (en.vault, en.cell());
    EntryView {
        entry: en.id,
        vault: v,
        by: en.creator,
        ty,
        tags,
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
    let sync = |&(d, own): &(SignerId, VaultId)| Some(Syncing { device: d, through: through(d, own)?, opens: st.entitled(d, k) });
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
    /// `passkey()`), and what its store kept, its `edits` in order and its McEliece `keys`, each bytes
    /// (`Device::open`).
    pub async fn open(
        name: String,
        relay: String,
        p256: String,
        unlock: JsValue,
        edits: Array,
        keys: Array,
    ) -> Result<PageDevice, JsError> {
        let p256 = hex_bytes(&p256).and_then(|b| <[u8; 33]>::try_from(b).ok());
        let p256 = p256.ok_or_else(|| JsError::new("a passkey's P-256 key is 33 bytes in hex"))?;
        let edits: Vec<Vec<u8>> = edits.iter().map(|edit| Uint8Array::new(&edit).to_vec()).collect();
        let keys = keys.iter().map(|key| Arc::from(Uint8Array::new(&key).to_vec())).collect();
        let backup = backup(&edits, keys);
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

    /// The text of block `block` of entry `entry` (in hex), as the device reads it: a promise, of `undefined` while it
    /// can't.
    pub fn text(&self, entry: String, block: u32) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move { Ok(device.text(EntryId(id(&entry)?), block.into()).await.into()) })
    }

    /// Sets the text of block `block` of entry `entry`, acting for vault `actor` (each in hex): a promise, rejected if
    /// the device's view refuses the edit.
    #[wasm_bindgen(js_name = setText)]
    pub fn set_text(&self, actor: String, entry: String, block: u32, text: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, entry) = (VaultId(id(&actor)?), EntryId(id(&entry)?));
            device.set_text(actor, entry, block.into(), text).await.map_err(js_value)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Writes a new note titled `title` that reads `body`, with the tags `tags`, an array of names, into vault `vault`,
    /// acting for vault `actor` (both in hex): a promise of its entry, in hex.
    pub fn write(&self, actor: String, vault: String, title: String, body: String, tags: Array) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, vault, tags) = (VaultId(id(&actor)?), VaultId(id(&vault)?), names(&tags)?);
            Ok(hex(&device.write(actor, vault, (title, body), tags).await.map_err(js_value)?.0).into())
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

    /// Sets the text of block `block` of entry `entry` on line `line` of its history, acting for vault `actor`
    /// (`Device::set_text_on`): a promise. Ids in hex; a line is `null` for the main line, else its proposal's.
    #[wasm_bindgen(js_name = setTextOn)]
    pub fn set_text_on(&self, actor: String, entry: String, line: Option<String>, block: u32, text: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, entry, line) = (VaultId(id(&actor)?), EntryId(id(&entry)?), line_of(line)?);
            device.set_text_on(actor, entry, line, block.into(), text).await.map_err(js_value)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Retitles document `entry` on line `line`, acting for vault `actor` (`Device::set_title_on`): a promise. Ids in
    /// hex; a line is `null` for the main line, else its proposal's.
    #[wasm_bindgen(js_name = setTitleOn)]
    pub fn set_title_on(&self, actor: String, entry: String, line: Option<String>, title: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, entry, line) = (VaultId(id(&actor)?), EntryId(id(&entry)?), line_of(line)?);
            device.set_title_on(actor, entry, line, title).await.map_err(js_value)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Proposes a change to entry `entry`: a proposal named `name` from the version `from`, an array of its edits,
    /// acting for vault `actor` (`Device::propose`): a promise of the new line, its first edit's id. Ids in hex.
    pub fn propose(&self, actor: String, entry: String, from: Array, name: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, entry, from) = (VaultId(id(&actor)?), EntryId(id(&entry)?), edit_ids(&from)?);
            Ok(hex(&device.propose(actor, entry, from, name).await.map_err(js_value)?.0).into())
        })
    }

    /// Merges line `from` of entry `entry` into line `into`, acting for vault `actor`; with `promote`, `into` then
    /// shows exactly what `from` does (`Device::merge`): a promise of the merge's edit. Ids in hex; a line is `null`
    /// for the main line.
    pub fn merge(
        &self,
        actor: String,
        entry: String,
        from: Option<String>,
        into: Option<String>,
        promote: bool,
    ) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, entry, lines) = (VaultId(id(&actor)?), EntryId(id(&entry)?), (line_of(from)?, line_of(into)?));
            Ok(hex(&device.merge(actor, entry, lines, promote).await.map_err(js_value)?.0).into())
        })
    }

    /// Puts the record of version `version`, an array of edits, of entry `entry` back on line `line`, acting for vault
    /// `actor` (`Device::restore`): a promise of the edit that does. Ids in hex.
    pub fn restore(&self, actor: String, entry: String, line: Option<String>, version: Array) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, entry, line, version) =
                (VaultId(id(&actor)?), EntryId(id(&entry)?), line_of(line)?, edit_ids(&version)?);
            Ok(hex(&device.restore(actor, entry, line, version).await.map_err(js_value)?.0).into())
        })
    }

    /// Undoes edit `edit` of entry `entry` on line `line`, keeping every change since, acting for vault `actor`
    /// (`Device::undo`): a promise of the edit that does. Ids in hex.
    pub fn undo(&self, actor: String, entry: String, line: Option<String>, edit: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, entry, line, edit) =
                (VaultId(id(&actor)?), EntryId(id(&entry)?), line_of(line)?, EditId(id(&edit)?));
            Ok(hex(&device.undo(actor, entry, line, edit).await.map_err(js_value)?.0).into())
        })
    }

    /// Makes a variant of entry `entry`: a new entry of vault `into` with what line `line` shows, acting for vault
    /// `actor` (`Device::variant`): a promise of the new entry. Ids in hex.
    pub fn variant(&self, actor: String, entry: String, line: Option<String>, into: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, entry, line, into) =
                (VaultId(id(&actor)?), EntryId(id(&entry)?), line_of(line)?, VaultId(id(&into)?));
            Ok(hex(&device.variant(actor, entry, line, into).await.map_err(js_value)?.0).into())
        })
    }

    /// The notes it reads, by vault (`Device::notes`): a promise of `[{vault, docs: [{entry, title, text}]}]`, ids in
    /// hex.
    pub fn notes(&self) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let vaults = Array::new();
            for notes in device.notes().await {
                let docs = Array::new();
                for (entry, title, text) in notes.docs {
                    let entry = hex(&entry.0).into();
                    docs.push(&object(&[("entry", entry), ("title", title.into()), ("text", text.into())]));
                }
                vaults.push(&object(&[("vault", hex(&notes.vault.0).into()), ("docs", docs.into())]));
            }
            Ok(vaults.into())
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

    /// Writes a new todo titled `title`, with the tags `tags`, an array of names, into vault `vault`, acting for vault
    /// `actor` (both in hex): a promise of its entry, in hex.
    pub fn todo(&self, actor: String, vault: String, title: String, tags: Array) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, vault, tags) = (VaultId(id(&actor)?), VaultId(id(&vault)?), names(&tags)?);
            Ok(hex(&device.todo(actor, vault, title, tags).await.map_err(js_value)?.0).into())
        })
    }

    /// Sets the status (`"open"`, `"doing"` or `"done"`) of todo `entry`, acting for vault `actor` (both in hex): a
    /// promise, rejected if the device's view refuses the change.
    #[wasm_bindgen(js_name = setStatus)]
    pub fn set_status(&self, actor: String, entry: String, status: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, entry) = (VaultId(id(&actor)?), EntryId(id(&entry)?));
            let status = words::status_of(&status).map_err(js_value)?;
            device.set_status(actor, entry, status).await.map_err(js_value)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Adds the tags `add` to entry `entry` and removes the tags `remove`, each an array of names, acting for vault
    /// `actor` (both in hex, `Device::tag`): a promise.
    pub fn tag(&self, actor: String, entry: String, add: Array, remove: Array) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (actor, entry) = (VaultId(id(&actor)?), EntryId(id(&entry)?));
            device.tag(actor, entry, names(&add)?, names(&remove)?).await.map_err(js_value)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Gives `grantee`, a vault's id or `"public"`, the role `role` (`"relay"`, `"read"`, `"write"` or `"owner"`) on
    /// what `slice` selects of vault `over`, a slice as `words` reads it (`{select, relabel}`), acting for vault
    /// `issuer` (`Device::share`): a promise of the cap's id, after one ceremony for an owner's. Ids in hex.
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
            let slice = serde_json::from_str(&slice).map_err(|e| JsError::new(&format!("no slice: {e}")))?;
            let slice = words::slice_of(&slice).map_err(js_value)?;
            let role = words::role_of(&role).map_err(js_value)?;
            let grantee = match grantee.as_str() {
                "public" => Grantee::Public,
                v => cast::vault(VaultId(id(v)?)),
            };
            let cap = device.share(issuer, over, slice, role, grantee, &Js(ceremony)).await.map_err(js_value)?;
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

/// Names, types or tags, from an array of them.
fn names(xs: &Array) -> Result<Vec<String>, JsValue> {
    xs.iter().map(|x| x.as_string().ok_or_else(|| JsError::new("a name is text").into())).collect()
}

/// A line of an entry's history as the page names it: `null`, `undefined` or `""` for the main line, else the id of
/// the write that started its proposal.
fn line_of(line: Option<String>) -> Result<Line, JsValue> {
    line.filter(|l| !l.is_empty()).map(|l| id(&l).map(EditId)).transpose()
}

/// Writes, from an array of their ids.
fn edit_ids(edits: &Array) -> Result<Vec<EditId>, JsValue> {
    edits.iter().map(|edit| id(&edit.as_string().unwrap_or_default()).map(EditId)).collect()
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
