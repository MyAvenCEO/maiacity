//! avenDB's device in a web page (P8d): a device of its person on avenDB's network, as WebAssembly. A page has no UDP,
//! so its node (`avendb_net::Node`) reaches every peer through the server's relay, which lets a new device in by a pass
//! its person's passkey signs (`avendb::sign::RelayPass`) until it joined. It links as any new device does
//! (`avendb_net::Node::link`): it takes the code another device of its person shows (`avendb_net::Offer`), the passkey
//! says its hello on their connection, the device joins its person's vault, and they sync. Then the page reads its
//! documents and edits them, and shows the device's own code, through which the next device links.
//!
//! In P8d the device holds the passkey as a software passkey, brought in by its secret (`Lab::passkey_from`), as a
//! platform syncs a passkey between its person's devices; the browser's own WebAuthn takes its place next (P8e). Its
//! store is in memory, so a page links again each time it opens.
//!
//! The tests run natively (`tests/device.rs`) and in Chromium (`tests/page.rs`, through `scripts/test-browser.sh`).

use std::rc::Rc;

use anyhow::{Context as _, Result, anyhow};
use avendb::cast;
use avendb::id::{BlobId, EntryId, SignerId, SpaceId, VaultId};
use avendb::lab::Lab;
use avendb_net::{Node, Offer, Options};
use iroh::RelayUrl;
use js_sys::Promise;
use n0_future::time::SystemTime;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;
use zeroize::Zeroizing;

/// A device of its person in a browser: its node, and the passkey it links with.
pub struct Device {
    node: Node,
    passkey: SignerId,
}

impl Device {
    /// A new device named `name` of the person whose passkey's secret is `passkey`: its keys derive from the passkey
    /// on a salt of its own, drawn from `entropy`, 32 bytes of the browser's randomness. It reaches its peers through
    /// `relay` alone, which lets it in by the passkey's pass, made at `now`, seconds since 1970, for ten minutes: it
    /// links within them (`link`), and from then on the server knows it.
    pub async fn new(name: &str, relay: RelayUrl, passkey: &[u8; 32], entropy: [u8; 32], now: u64) -> Result<Device> {
        let mut lab = Lab::with_entropy(entropy);
        let passkey = lab.passkey_from("the person", *passkey);
        let me = lab.device_of(passkey, name);
        let pass = lab.relay_pass(me, passkey, now).context("the passkey's pass to the relay")?;
        let opts = Options { bind: None, relay: Some(relay), relay_pass: Some(pass), ..Options::local() };
        Ok(Device { node: Node::spawn(lab, me, opts).await?, passkey })
    }

    /// Links it to its person's vault through the device whose code reads `offer` (`Offer::to_text`): the vault it
    /// joined.
    pub async fn link(&self, offer: &str) -> Result<VaultId> {
        self.node.link(&Offer::from_text(offer)?, self.passkey).await
    }

    /// Its node.
    pub fn node(&self) -> &Node {
        &self.node
    }

    /// The vault it belongs to, by its view.
    pub async fn vault(&self) -> Option<VaultId> {
        self.node.read(|lab, me| lab.vault_of(me)).await
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

/// The device as the page holds it (`Device`): every call that waits on the network is a promise.
#[wasm_bindgen(js_name = Device)]
pub struct PageDevice(Rc<Device>);

#[wasm_bindgen(js_class = Device)]
impl PageDevice {
    /// A new device named `name` of the person whose passkey's secret is `passkey` (32 bytes), linked through the
    /// device whose code reads `offer`, reaching its peers through the relay at `relay` alone (`Device::new`,
    /// `Device::link`): the device, once it joined its person's vault.
    pub async fn link(name: String, relay: String, offer: String, passkey: Vec<u8>) -> Result<PageDevice, JsError> {
        let passkey = Zeroizing::new(passkey);
        let passkey: &[u8; 32] = passkey[..].try_into().map_err(|_| JsError::new("a passkey's secret is 32 bytes"))?;
        let relay: RelayUrl = relay.parse().map_err(|_| JsError::new("the relay's URL isn't one"))?;
        let mut entropy = Zeroizing::new([0; 32]);
        getrandom::fill(&mut *entropy).map_err(|e| JsError::new(&format!("no randomness from the browser: {e}")))?;
        let device = Device::new(&name, relay, passkey, *entropy, now()).await.map_err(js_error)?;
        device.link(&offer).await.map_err(js_error)?;
        Ok(PageDevice(Rc::new(device)))
    }

    /// Its device's id, in hex.
    pub fn id(&self) -> String {
        hex(&self.0.node.device().0)
    }

    /// Its endpoint's id, its device's ed25519 key, in hex.
    pub fn endpoint(&self) -> String {
        hex(self.0.node.id().as_bytes())
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

    /// How many ops and blobs it holds: a pair.
    pub fn size(&self) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let (ops, blobs) = device.node.read(|lab, me| lab.size(me)).await;
            Ok(js_sys::Array::of2(&(ops as u32).into(), &(blobs as u32).into()).into())
        })
    }

    /// Closes its connections and its endpoint.
    pub fn close(&self) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            device.node.shutdown().await.map_err(js_value)?;
            Ok(JsValue::UNDEFINED)
        })
    }
}

/// The time by the browser's clock, or the machine's: seconds since 1970.
fn now() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// 32 bytes as 64 lowercase hex digits, as the page sees every id.
fn hex(b: &[u8; 32]) -> String {
    BlobId(*b).to_hex()
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
