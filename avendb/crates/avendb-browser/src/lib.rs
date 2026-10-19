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
//! - `Device::found`: a new person's first device founds their human vault, gives avenMAIA, the aven the
//!   server is a device of, backup on the whole of it, or relay with backups off, and writes its card there, in two
//!   ceremonies: the unlock, and one that signs the vault's genesis and the edit that adds the device together
//!   (`avendb_net::Node::found_with`). The passkey may be one the page just made, its P-256 key in its public key info,
//!   or one made before for the same relying party, maiaCITY's from its sign-up: then the device drafts it all for each
//!   key the unlock's assertion recovers to, in one batch, and keeps what the second ceremony's assertion verifies
//!   under. The first person to found their vault through a server nobody has claimed yet claims it in that same
//!   ceremony (P8f): their vault owns avenMAIA, through the seed it founds.
//! - `Device::link`: a device of a person who has one already links through the code it shows
//!   (`avendb_net::Node::link_by_pass`), in one ceremony, the unlock, which is its passkey's pass for it and signs the
//!   edit that adds it too: its passkey is the key, of those the unlock's assertion recovers to, whose vault the peer
//!   hands over.
//! - `Device::open`: a device the page made before opens again from its shelf, in the unlock's ceremony alone; the
//!   server's relay knows it.
//!
//! The page keeps what the device holds in the browser's private file system, OPFS, on its node's shelf (v8 phase S,
//! `avendb_net::shelf`), laid out as every place lays out its own: its edits as a journal, packs and heads
//! (`avendb_net` keeps them), its McEliece keys and the pieces of the files it brings or keeps, each a blob, and what
//! opens it again (`Meta`). The page's store (`js/store.js`) only carries the shelf's calls to a worker of its own,
//! which has OPFS's synchronous files and holds the shelf for one tab at a time (`js/store.worker.js`): all that is
//! kept, and how, is the device's (`shelf_of`). A new device, or one forgotten, starts a new generation of a store,
//! and the old stays aside, whole: avenDB is never reset, and nothing clears it (`avendb_net::shelf::FLOOR`).
//!
//! A vault holds its entries itself, flat: each entry has a type (`note`, `todo`, `file`, `card`, `profile`) and tags,
//! all of it inside the entry's encrypted writes. A vault shares what it holds through shares, each on a slice of its
//! entries, whatever its selector picks (`avendb::slice`): every entry of a type, those with a tag, one entry, or the
//! whole vault. Nothing is shared but what a share names: least is the default. A backup share hands out ciphertext and
//! no key, which is how a vault lets avenCEO, the server's vault, keep and pass on its entries: a share on the whole
//! vault; a relay share hands out none of them, and lets the server know the vault's devices.
//!
//! Every read and change the page makes is one op of the ops engine, JSON in and JSON out (`Device::run`,
//! `PageDevice::run`, `avendb::engine`, `docs/ARCHITECTURE.md` §8), which the device runs as the vault it names, and
//! the rules check as they check any peer's edit; the page keeps no rule, and asks `may` before it offers a button.
//! Its whole world (`world`, `avendb::world`): every vault it knows, whom it acts for and as which vault its person
//! acts in each; every share in force, what it reaches and who may revoke it; every audience, with the devices that
//! sync it; every entry, with who reads, writes and shares it on, and the files it brings and where they are synced
//! to. The records of its entries (`query`, `get`, `history`, the record ops), a note's page (`note`), a vault's
//! database (`database`, `avendb::data`) and the database's history (`log`). And its vaults: shares and keep shares
//! and their revocations (`share`, `keep`, `revoke`, `shares`), a vault's settings, new vaults its person's vault
//! founds and owns, each with a profile, an entry of type `profile` titled with its name (`found`, `profile`), files
//! (`put_file`, `read_file`), the server's backup (`back_up`), and the device's card, an entry of type `card` of its
//! person's vault that it writes itself, titled with its name (`card`), so every device of the vault shows the others
//! by name. What its vault's owners approve, the passkey signs in a ceremony the page runs (`ceremony`). The vaults
//! it follows, and how deep its queries read (`set_limits`), the device keeps on its shelf with what opens it again
//! (`Meta::follow`, `Meta::query_depth`).
//!
//! The same device runs natively in the Mac app (`avendb-device`, beside maiaCITY Studio): there its node binds UDP
//! sockets of its own, so it reaches its peers directly and through the relay only where it must, and keeps what it
//! holds on a shelf in a folder on disk (`Start::direct`, `avendb_net::disk`).
//!
//! The tests run natively (`tests/device.rs`) and in Chromium (`tests/page.rs`, through `scripts/test-browser.sh`),
//! where a virtual authenticator holds the passkey.

use std::io;
use std::rc::Rc;
use std::sync::Arc;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::cast;
use avendb::engine;
use avendb::id::{ShareId, SignerId, VaultId};
use avendb::keys;
use avendb::lab::Lab;
use avendb::policy::{Action, Level, Principal, Refusal, Sharing};
use avendb::recovery::{self, RecoveryKey};
use avendb::sign::{self, Assertion, Ceremony, DeviceKey, RelayPass, SignerKeys, pass_challenge};
use avendb::slice::Selector;
use avendb::words::hex;
use avendb::world;
use avendb_net::shelf::hash_of;
use avendb_net::{
    Authenticator, Call, NoBytes, NoCeremony, Node, Offer, Options, Progress, Shelf, Source, Stage, Step, Steps,
};
use bytes::Bytes;
use iroh::RelayUrl;
use js_sys::{Array, Function, Promise, Reflect, Uint8Array};
use n0_future::future::or;
use n0_future::{Stream, stream};
use n0_future::time::{Duration, SystemTime, sleep};
use serde_json::{Value, json};
use tokio::sync::watch;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{JsFuture, future_to_promise};
use zeroize::Zeroizing;

pub use avendb::world::{CARD, DELETED, FILE, FORK, NOTE, PROFILE, TODO};

/// How many bytes of a file the page hands its device at a time (`PageDevice::run`'s `read`, for `put_file` and a
/// `create` that brings a file).
const CHUNK: u64 = 1 << 20;

/// What the ceremony that unlocks a device brings back: the ceremony itself, over a new device's challenge
/// (`Fresh::challenge`) or one of the page's own, and the PRF output on the device's salt (`sign::device_salt`), which
/// masks the secret its keys come from (`Fresh::mask`).
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
/// the time, seconds since 1970, and its shelf (`avendb_net::Options::shelf`): a page's in OPFS (`shelf_of`), the Mac
/// app's in its folder (`avendb_net::disk`), where it keeps what it holds and what opens it again (`Meta`). A device
/// with none, as in a test, keeps nothing past its end. A page binds no socket; a device on a machine, the Mac app's,
/// binds sockets of its own (`direct`, `avendb_net::Options::direct`), so it reaches its peers directly and through
/// the relay only where it must. It marks each step of its start in `progress`, for its person to watch
/// (`avendb_net::Progress`); whoever started it marks the start over. Every human vault it founds adds the master
/// recovery key `recovery` as an owner, avenDB's own (`Start::recovery`) while avenDB is bootstrapped
/// (`avendb::recovery`), and so its person may add it to their vault.
pub struct Start {
    pub name: String,
    pub relay: RelayUrl,
    pub entropy: [u8; 32],
    pub now: u64,
    pub direct: bool,
    pub shelf: Option<Shelf>,
    pub progress: Progress,
    pub recovery: Option<Arc<RecoveryKey>>,
}

impl Start {
    /// The master recovery key a device adds: avenDB's own, built in (`avendb::recovery::master`), if any.
    pub fn recovery() -> Option<Arc<RecoveryKey>> {
        recovery::master()
    }
}

/// What opens a device again, kept on its shelf beside what it holds (`Meta::keep`): its name, the relay it reaches its
/// peers through, its salt's own 32 bytes (`sign::device_salt`), its secret masked by the PRF output on its salt
/// (`Fresh::mask`), the credential of its person's passkey (base64url) and that passkey's P-256 key, compressed, and
/// the device's id, which the unmasked secret must be the key of before the device touches its shelf (`Device::open`);
/// and the vaults the device follows (the `follow` op, `Lab::follow`), which it names in each request it makes, and
/// follows again as it opens; and the most rows and links down its queries read (the `set_limits` op,
/// `Lab::set_query_depth`), none while it reads as deep as any write that counts reaches (`lens::CEILING`). None of it
/// is a secret: only the passkey unmasks the device's. On a Mac, its Touch ID key too, where the person added it
/// (`Touch`, `Device::add_touch`): a touch unmasks it then, as the Mac app starts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Meta {
    pub name: String,
    pub relay: String,
    pub nonce: [u8; 32],
    pub mask: [u8; 32],
    pub credential: String,
    pub p256: [u8; 33],
    pub device: SignerId,
    pub follow: Vec<VaultId>,
    pub query_depth: Option<usize>,
    pub touch: Option<Touch>,
}

/// A Mac's Touch ID key (2026-10-19), an owner of its person's vault beside their passkey, which opens the Mac's device
/// with a touch and no passkey (`Device::open_by_touch`): its ML-DSA-65 public key; the blobs its Secure Enclave made
/// of that key and of its ML-KEM-768 key, which that Enclave alone reads and uses only after a touch; the ML-KEM
/// ciphertext whose secret the touch opens (`sign::Ceremony::enclave`); the device's secret masked by what that secret
/// derives (`sign::Ceremony::device_mask`); and the id of the person's passkey, whose keys its next ceremony brings
/// (`avendb::lab::Lab::take_in`). None of it is a secret: only the Enclave opens the blobs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Touch {
    pub public: Vec<u8>,
    pub key: Vec<u8>,
    pub kem: Vec<u8>,
    pub sealed: Vec<u8>,
    pub mask: [u8; 32],
    pub passkey: SignerId,
}

impl Touch {
    /// As `Meta::to_json` writes it: `{public, key, kem, sealed, mask, passkey}`, each in hex.
    pub fn to_json(&self) -> Value {
        let hexed = |bytes: &[u8]| bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
        json!({
            "public": hexed(&self.public),
            "key": hexed(&self.key),
            "kem": hexed(&self.kem),
            "sealed": hexed(&self.sealed),
            "mask": hex(&self.mask),
            "passkey": hex(&self.passkey.0),
        })
    }

    /// From what `to_json` writes.
    pub fn from_json(v: &Value) -> Result<Touch> {
        let bytes = |k: &str| {
            let field = v.get(k).and_then(Value::as_str);
            field.and_then(hex_bytes).with_context(|| format!("a Touch ID key: no {k} in hex"))
        };
        Ok(Touch {
            public: bytes("public")?,
            key: bytes("key")?,
            kem: bytes("kem")?,
            sealed: bytes("sealed")?,
            mask: bytes("mask")?.try_into().ok().context("a Touch ID key's mask is 32 bytes in hex")?,
            passkey: SignerId(bytes("passkey")?.try_into().ok().context("a passkey's id is 32 bytes in hex")?),
        })
    }
}

/// Where a shelf keeps what opens its device again: each version an object of its own, `meta/0000000000000001` and
/// on, put once, the newest that reads counting.
const META: &str = "meta/";

/// What device `me` keeps with what opens it again beside its keys: the vaults it follows, and the most rows and links
/// down its queries read, none while that is as deep as any write reaches.
fn settings(lab: &Lab, me: SignerId) -> (Vec<VaultId>, Option<usize>) {
    let depth = lab.query_depth(me);
    (lab.follows(me).to_vec(), (depth != avendb::lens::CEILING).then_some(depth))
}

impl Meta {
    /// As the page and the Mac app read it: `{name, relay, nonce, mask, credential, passkey, device, follow,
    /// queryDepth, touch}`, the nonce, the mask, the passkey's P-256 key, the device's id and those of the vaults it
    /// follows in hex, `queryDepth` left out where it names none, `touch` where it keeps no Touch ID key (`Touch`).
    pub fn to_json(&self) -> Value {
        let mut out = json!({
            "name": self.name,
            "relay": self.relay,
            "nonce": hex(&self.nonce),
            "mask": hex(&self.mask),
            "credential": self.credential,
            "passkey": self.p256.iter().map(|b| format!("{b:02x}")).collect::<String>(),
            "device": hex(&self.device.0),
            "follow": self.follow.iter().map(VaultId::to_hex).collect::<Vec<_>>(),
        });
        if let Some(depth) = self.query_depth {
            out["queryDepth"] = depth.into();
        }
        if let Some(touch) = &self.touch {
            out["touch"] = touch.to_json();
        }
        out
    }

    /// From what `to_json` writes; `follow` left out, as before V2 wrote it, follows nothing, and `queryDepth` left
    /// out, as before links were, reads as deep as any write reaches.
    pub fn from_json(v: &Value) -> Result<Meta> {
        let field = |k: &str| v.get(k).and_then(Value::as_str).with_context(|| format!("what opens it: no {k}"));
        let bytes = |k: &str| field(k).map(|f| hex_bytes(f).unwrap_or_default());
        let follow = v.get("follow").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
        let vault = |f: &Value| f.as_str().and_then(VaultId::from_hex).context("a vault it follows is an id in hex");
        Ok(Meta {
            name: field("name")?.into(),
            relay: field("relay")?.into(),
            nonce: bytes("nonce")?.try_into().ok().context("a device's nonce is 32 bytes in hex")?,
            mask: bytes("mask")?.try_into().ok().context("a device's mask is 32 bytes in hex")?,
            credential: field("credential")?.into(),
            p256: bytes("passkey")?.try_into().ok().context("a passkey's P-256 key is 33 bytes in hex")?,
            device: SignerId(bytes("device")?.try_into().ok().context("a device's id is 32 bytes in hex")?),
            follow: follow.iter().map(vault).collect::<Result<_>>()?,
            query_depth: match v.get("queryDepth") {
                None => None,
                Some(d) => Some(d.as_u64().context("a query depth is a count")? as usize),
            },
            touch: v.get("touch").map(Touch::from_json).transpose()?,
        })
    }

    /// What opens the device on `shelf` again: the newest version that reads, or none while the shelf holds none.
    pub async fn load(shelf: &Shelf) -> Result<Option<Meta>> {
        let names = shelf.names(META).await.context("what opens the device")?;
        for name in names.iter().rev() {
            let Some(bytes) = shelf.get(name).await.context("what opens the device")? else { continue };
            // a version that doesn't read counts for nothing, and the one before it counts
            let read = serde_json::from_slice(&bytes).map_err(anyhow::Error::from).and_then(|v| Meta::from_json(&v));
            if let Ok(meta) = read {
                return Ok(Some(meta));
            }
        }
        Ok(None)
    }

    /// Keeps it on `shelf`, as the newest version: done once the shelf holds it.
    pub async fn keep(&self, shelf: &Shelf) -> Result<()> {
        let names = shelf.names(META).await.context("what opens the device")?;
        let number = |name: &String| u64::from_str_radix(name.strip_prefix(META)?, 16).ok();
        let mut n = names.iter().filter_map(number).max().map_or(1, |n| n + 1);
        let bytes = Bytes::from(self.to_json().to_string());
        loop {
            match shelf.put(&format!("{META}{n:016x}"), bytes.clone()).await {
                Ok(()) => return Ok(()),
                // another version took the number first: this one comes after it
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => n += 1,
                Err(e) => return Err(anyhow::Error::from(e).context("keeping what opens the device")),
            }
        }
    }
}

/// A device of its person in a browser: its node, its person's passkey, by its id and its P-256 key, the mask its
/// secret is kept under (`Fresh::mask`), its shelf, if it keeps one (`Start::shelf`), the name and relay it started
/// with, and whether it closed.
pub struct Device {
    node: Node,
    passkey: SignerId,
    p256: [u8; 33],
    mask: [u8; 32],
    shelf: Option<Shelf>,
    name: String,
    relay: RelayUrl,
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
    /// server yet, the same ceremony claims it, and their vault owns avenMAIA, through the seed it founds, the
    /// device vault the server is a device of. Then it gives avenMAIA backup on the whole vault, so the server
    /// keeps their ciphertext and knows the device from then on, or, if `backup` is false, relay alone, so the server
    /// knows the vault's devices, lets them through and helps them find each other, and keeps none of its entries
    /// (`avendb::world::server_level`, the `back_up` op); and writes its card there (the `card` op). The relay honours
    /// the pass while it is open to sign-up (`avendb_net::Admission::open`) or while nobody has claimed the server.
    pub async fn found(
        start: Start,
        server: &Offer,
        p256: Option<[u8; 33]>,
        fresh: Fresh,
        unlock: Unlock,
        authenticator: &impl Authenticator,
        backup: bool,
    ) -> Result<Device> {
        let progress = &start.progress;
        progress.step("keys");
        let (lab, me, passkeys, pass) = passed(&start, p256, &fresh, &unlock)?;
        let mask = fresh.mask(&unlock);
        let node = Device::spawn(lab, me, &start, Some(pass.clone())).await?;
        node.on_relay().await;
        progress.step("server");
        node.know(server.addr.clone());
        let mut tries = 0;
        while let Err(e) = node.contact(server.addr.id).await {
            tries += 1;
            if tries == 20 {
                return Err(e.context("the server's card"));
            }
            sleep(Duration::from_millis(500)).await;
        }
        // one passkey, one human vault: a passkey whose vault the server knows signs in to it, as `link` does
        if let Some((passkey, _)) = node.rejoin_by_pass(server, &pass, unlock.ceremony).await? {
            return Device::of(node, passkey, &passkeys, mask, &start).await;
        }
        let (passkey, vault, avenceo) = node.found_with(server, &passkeys, authenticator).await?;
        progress.step("settle");
        let device = Device::of(node, passkey, &passkeys, mask, &start).await?;
        let name = start.name.clone();
        let found = move |lab: &mut Lab, me| {
            let level = if backup { Level::Backup } else { Level::Relay };
            let server = cast::share(vault, cast::vault(avenceo), level, Selector::All);
            lab.issue(me, &[me], server).map_err(|why| anyhow!("avenCEO's share is refused: {why:?}"))?;
            let card = world::card(&name, me);
            lab.create(me, vault, vault, CARD, &[], card).map_err(|why| anyhow!("its card is refused: {why:?}"))?;
            // the seed its claim founded, if it did, by name from the start (`world::SEED_NAMES`)
            let seed = world::seed_of(lab, me).into_iter().zip(world::SEED_NAMES);
            for (v, name) in seed {
                let op = json!({ "op": "profile", "vault": hex(&v.0), "name": name });
                let out = engine::run(lab, me, &op);
                if out.get("ok").is_none() {
                    bail!("{name}'s profile is refused: {}", out["why"]);
                }
            }
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
        start.progress.step("keys");
        let (lab, me, passkeys, pass) = passed(&start, None, &fresh, &unlock)?;
        let mask = fresh.mask(&unlock);
        let node = Device::spawn(lab, me, &start, Some(pass.clone())).await?;
        let (passkey, _) = node.link_by_pass(offer, &pass, unlock.ceremony).await?;
        Device::of(node, passkey, &passkeys, mask, &start).await
    }

    /// The device made here before, opened again from its shelf (`Start::shelf`) by what the shelf keeps to open it
    /// (`meta`), unlocked by the ceremony of the passkey whose P-256 key it names, its secret kept under the mask it
    /// names (`Fresh::mask`): the relay knows it, so it needs no pass. Its node takes back what the shelf kept
    /// (`avendb_net::Node::spawn`), follows the vaults it followed (`Meta::follow`), and reads as deep in a query as it
    /// did (`Meta::query_depth`). Fails, before it touches the shelf, if the unlock isn't that passkey's or unmasks
    /// another device's secret; and if the device then belongs to no vault, as one taken out of its vault.
    pub async fn open(start: Start, meta: &Meta, unlock: Unlock) -> Result<Device> {
        start.progress.step("keys");
        let (lab, passkey, me) = lab(&start, meta.p256, meta.mask, &unlock)?;
        if me != meta.device {
            bail!("the unlock opens another device than the one this shelf keeps");
        }
        Device::reopen(start, meta, lab, passkey).await
    }

    /// The device made here before, opened again from its shelf as `open` opens it, by its Mac's Touch ID key
    /// (`Meta::touch`) in `ceremony`, one touch, with no passkey: the touch unmasks its secret
    /// (`sign::Ceremony::device_mask`), and its person's passkey comes in with its next ceremony, as for a change only
    /// their vault's root makes (`avendb::lab::Lab::take_in`). Fails, before it touches the shelf, if the shelf keeps no
    /// Touch ID key, the ceremony isn't that key's, or it unmasks another device's secret.
    pub async fn open_by_touch(start: Start, meta: &Meta, ceremony: &Ceremony) -> Result<Device> {
        let touch = meta.touch.as_ref().context("this device keeps no Touch ID key")?;
        start.progress.step("keys");
        let mut lab = Lab::with_entropy(start.entropy);
        start.recovery.clone().map(|key| lab.set_recovery(key));
        let theirs = match ceremony.enclave_keys() {
            Some(SignerKeys::Enclave { mldsa, .. }) => mldsa == sign::enclave_key(&touch.public),
            _ => false,
        };
        let key = lab.web_enclave("the person", ceremony).filter(|_| theirs);
        key.context("the touch's ceremony isn't of this Mac's Touch ID key")?;
        let pad = ceremony.device_mask().context("the touch's ceremony isn't of this Mac's Touch ID key")?;
        let me = lab.device_with(&start.name, *xor(&touch.mask, &pad));
        if me != meta.device {
            bail!("the touch opens another device than the one this shelf keeps");
        }
        Device::reopen(start, meta, lab, touch.passkey).await
    }

    /// Device `me` of `lab`, unlocked as its shelf's `meta` names it, its person's passkey `passkey`, opened again
    /// (`open`, `open_by_touch`): it follows what it followed and reads as deep as it did, its node takes back what the
    /// shelf kept, and it must still belong to a vault.
    async fn reopen(start: Start, meta: &Meta, mut lab: Lab, passkey: SignerId) -> Result<Device> {
        let me = meta.device;
        lab.follow(me, &meta.follow);
        if let Some(depth) = meta.query_depth {
            lab.set_query_depth(me, depth);
        }
        start.progress.step("restore");
        let node = Device::spawn(lab, me, &start, None).await?;
        let (shelf, name, relay) = (start.shelf.clone(), start.name.clone(), start.relay.clone());
        let (p256, mask) = (meta.p256, meta.mask);
        let device = Device { node, passkey, p256, mask, shelf, name, relay, closed: watch::Sender::new(false) };
        start.progress.step("check");
        if device.vault().await.is_none() {
            device.close().await.ok();
            bail!("the store holds no vault this device belongs to");
        }
        Ok(device)
    }

    /// Its Mac's Touch ID key, whose Enclave made `keys` and signed in `made` as it made them, added as an owner of its
    /// person's vault beside their passkey and kept on its shelf (`Meta::touch`), so a touch opens it from then on
    /// (`open_by_touch`) and approves what their vault's owners approve. `sign` makes the ceremonies over the edit that
    /// adds it, given its challenge: the passkey's, which unlocks the device too (`Unlock`, its PRF output on the
    /// device's salt), as the passkey approves the key and the touch masks the device's secret; and the key's own, a
    /// touch, as it consents. The key kept. Fails for a device that keeps no shelf, if `made` isn't the Enclave's, or if
    /// a ceremony isn't its key's or unmasks another device's secret.
    pub async fn add_touch<S: Future<Output = Result<(Unlock, Ceremony)>>>(
        &self,
        made: Ceremony,
        keys: Touch,
        sign: impl FnOnce([u8; 32]) -> S,
    ) -> Result<Touch> {
        let shelf = self.shelf.as_ref().context("this device keeps no shelf")?;
        let mut meta = Meta::load(shelf).await?.context("its shelf holds nothing that opens it")?;
        let theirs = match made.enclave_keys() {
            Some(SignerKeys::Enclave { mldsa, .. }) => mldsa == sign::enclave_key(&keys.public),
            _ => false,
        };
        anyhow::ensure!(theirs, "the Enclave's first ceremony isn't of the key it made");
        let (passkey, vault) = (self.passkey, self.vault().await.context("this device belongs to no vault")?);
        let draft = move |lab: &mut Lab, me| {
            let touch = lab.web_enclave("the person", &made).ok_or(Refusal::BadSignature)?;
            let add = Action::Share(Sharing::Owner { vault, owner: Principal::Signer(touch), seal_to: None });
            Ok::<_, Refusal>((touch, lab.draft(me, &[passkey, touch], add)?))
        };
        let (touch, draft) = self.node.act(draft).await.map_err(|why| anyhow!("the Touch ID key is refused: {why:?}"))?;
        let (unlock, consent) = sign(draft.challenge()).await?;
        let secret = xor(&self.mask, &unlock.device);
        anyhow::ensure!(DeviceKey::from_secret(*secret).id() == meta.device, "the unlock is of another device");
        let pad = consent.device_mask().context("the Touch ID key's ceremony isn't a touch")?;
        let complete = move |lab: &mut Lab, me| lab.complete(me, draft, &[(passkey, &unlock.ceremony), (touch, &consent)]);
        self.node.act(complete).await.map_err(|why| anyhow!("the Touch ID key isn't added: {why:?}"))?;
        let touch = Touch { mask: *xor(&secret, &pad), passkey, ..keys };
        meta.touch = Some(touch.clone());
        meta.keep(shelf).await?;
        Ok(touch)
    }

    /// Forgets its Mac's Touch ID key (`Meta::touch`): a touch opens it no more, and its passkey's unlock does again.
    /// Its place as an owner of their vault is the vault's to end (the `revoke` op). Fails for a device that keeps no
    /// shelf.
    pub async fn forget_touch(&self) -> Result<()> {
        let shelf = self.shelf.as_ref().context("this device keeps no shelf")?;
        let mut meta = Meta::load(shelf).await?.context("its shelf holds nothing that opens it")?;
        if meta.touch.take().is_some() {
            meta.keep(shelf).await?;
        }
        Ok(())
    }

    /// A node for device `me` of `lab`, which reaches its peers through the relay, let in by `pass` if the relay
    /// doesn't know it yet, and directly too if it binds a socket; on its shelf, if it keeps one.
    async fn spawn(lab: Lab, me: SignerId, start: &Start, pass: Option<RelayPass>) -> Result<Node> {
        let (direct, relay, shelf, progress) =
            (start.direct, Some(start.relay.clone()), start.shelf.clone(), start.progress.clone());
        let opts = Options { bind: None, direct, relay, relay_pass: pass, shelf, progress, ..Options::local() };
        Node::spawn(lab, me, opts).await
    }

    /// The new device whose node is `node`, of the person whose passkey turned out to be `passkey`, of `passkeys`,
    /// those its unlock may have been from (`passed`), its secret kept under `mask`, started at `start`: it forgets the
    /// others' keys, which nobody holds.
    async fn of(node: Node, passkey: SignerId, passkeys: &[SignerId], mask: [u8; 32], start: &Start) -> Result<Device> {
        let others: Vec<SignerId> = passkeys.iter().copied().filter(|&p| p != passkey).collect();
        let forget = move |lab: &mut Lab, _| {
            others.into_iter().for_each(|p| lab.lose(p));
            lab.keys_of(passkey)
        };
        let Some(SignerKeys::Passkey { p256, .. }) = node.act(forget).await else { bail!("the passkey's keys") };
        let (shelf, name, relay) = (start.shelf.clone(), start.name.clone(), start.relay.clone());
        Ok(Device { node, passkey, p256, mask, shelf, name, relay, closed: watch::Sender::new(false) })
    }

    /// What opens it again, as it started: its name and relay, its secret's mask, its passkey's P-256 key and its id,
    /// with `nonce`, its salt's own bytes, and `credential`, its passkey's, which the unlock named.
    pub fn meta(&self, nonce: [u8; 32], credential: String) -> Meta {
        let (name, relay, device) = (self.name.trim().to_string(), self.relay.to_string(), self.node.device());
        let (mask, p256) = (self.mask, self.p256);
        Meta { name, relay, nonce, mask, credential, p256, device, follow: vec![], query_depth: None, touch: None }
    }

    /// Keeps `meta` on its shelf, what opens it again (`Meta::keep`), with the vaults it follows now and how deep its
    /// queries read: a device new here keeps it once it started, and its shelf holds it from then on. Fails for a
    /// device that keeps no shelf.
    pub async fn keep(&self, meta: &Meta) -> Result<()> {
        let (follow, query_depth) = self.node.read(settings).await;
        let meta = Meta { follow, query_depth, ..meta.clone() };
        meta.keep(self.shelf.as_ref().context("this device keeps no shelf")?).await
    }

    /// Its name reads `name`: in what opens it again, on its shelf, then on its card (the `card` op). Whether its card
    /// changed.
    pub async fn rename(&self, name: String) -> Result<bool> {
        let name = name.trim().to_string();
        if name.is_empty() {
            bail!("a device has a name");
        }
        let shelf = self.shelf.as_ref().context("this device keeps no shelf")?;
        let mut meta = Meta::load(shelf).await?.context("its shelf holds nothing that opens it")?;
        if meta.name != name {
            meta.name.clone_from(&name);
            meta.keep(shelf).await?;
        }
        let card = self.op(json!({ "op": "card", "name": name })).await.context("its card")?;
        Ok(card["wrote"].as_bool().unwrap_or(false))
    }

    /// Its shelf lacks something it holds: its holdings, as it tells its peers, name only what the shelf holds
    /// (`avendb_net::Node::behind`).
    pub async fn behind(&self) -> bool {
        self.node.behind().await
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

    /// The mask its secret is kept under (`Fresh::mask`): what its shelf keeps, beside its salt's own bytes, to open it
    /// again (`Meta`).
    pub fn mask(&self) -> [u8; 32] {
        self.mask
    }

    /// The vault it belongs to, by its view.
    pub async fn vault(&self) -> Option<VaultId> {
        self.node.read(|lab, me| lab.vault_of(me)).await
    }

    /// Runs op `op` of the ops engine (`avendb::engine`, `docs/ARCHITECTURE.md` §8), as its node does
    /// (`avendb_net::Node::run`): every read and change of the database it holds, whatever their schema, and of its
    /// vaults, as JSON. Its answer, `{"ok": ...}`, `{"refused": ..., "why": ...}`, or for a change its vault's owners
    /// approve with no `authenticator` at hand, `{"approve": ...}`; and for `read_file` the bytes it read, beside.
    /// `put_file`, and a `create` with a `file` (`engine::brings`), reads its bytes from `bytes`, twice
    /// (`avendb_net::Source`). The vaults it follows (`follow`) and how
    /// deep its queries read (`set_limits`) it keeps on its shelf too, in what opens it again (`Meta`), so it follows
    /// them again and reads as deep once it opens.
    pub async fn run<B, A>(
        &self,
        op: Value,
        bytes: Option<B>,
        authenticator: Option<&A>,
    ) -> Result<(Value, Option<Vec<u8>>)>
    where
        B: Source,
        A: Authenticator,
    {
        let kept = matches!(engine::name(&op), Some("follow" | "set_limits"));
        let out = self.node.run(op, bytes, authenticator).await?;
        if kept && out.0.get("ok").is_some() {
            self.keep_settings().await?;
        }
        Ok(out)
    }

    /// Runs op `op` with no bytes beside it and no ceremony at hand (`run`): what it answers `ok`, else why not.
    pub async fn op(&self, op: Value) -> Result<Value> {
        let (out, _) = self.run(op, None::<NoBytes>, None::<&NoCeremony>).await?;
        done(out)
    }

    /// Keeps the vaults it follows and how deep its queries read in what opens it again on its shelf (`Meta::follow`,
    /// `Meta::query_depth`), once that holds any.
    async fn keep_settings(&self) -> Result<()> {
        let Some(shelf) = &self.shelf else { return Ok(()) };
        let Some(meta) = Meta::load(shelf).await? else { return Ok(()) };
        let (follow, query_depth) = self.node.read(settings).await;
        if (&meta.follow, meta.query_depth) != (&follow, query_depth) {
            Meta { follow, query_depth, ..meta }.keep(shelf).await?;
        }
        Ok(())
    }

    /// Waits until it holds other than `held`, how many edits and McEliece keys the page last showed it holding
    /// (`Node::changes`): true, or false once it closed.
    pub async fn changed(&self, held: (usize, usize)) -> bool {
        let (mut changes, mut closed) = (self.node.changes(), self.closed.subscribe());
        let changed = async move { changes.wait_for(|&size| size != held).await.is_ok() };
        or(changed, async move { closed.wait_for(|&closed| closed).await.is_err() }).await
    }

    /// Closes its connections and its endpoint, once its shelf holds what it holds, if it can
    /// (`avendb_net::Node::shutdown`).
    pub async fn close(&self) -> Result<()> {
        self.closed.send_replace(true);
        self.node.shutdown().await
    }
}

/// What an op answered `ok`, or why not.
fn done(out: Value) -> Result<Value> {
    match out.get("ok") {
        Some(ok) => Ok(ok.clone()),
        None => bail!("refused: {}", out.get("why").and_then(Value::as_str).unwrap_or("it needs the vault's approval")),
    }
}

/// A start's steps as the page and the app show them (`avendb_net::Progress`): `{"steps": [{"step", "at", "took"}],
/// "over"}`, each step by its name, when it began and how long it took, in milliseconds since the start began; `took`
/// is null for the step under way.
pub fn steps_json(steps: &Steps) -> Value {
    let stage = |s: &Stage| json!({ "step": s.step, "at": s.at, "took": s.took });
    json!({ "steps": steps.steps.iter().map(stage).collect::<Vec<_>>(), "over": steps.over })
}

/// A browser's device's Lab as it opens again: its person's passkey, by its P-256 key and the ceremony that unlocked
/// the device, and the device, its keys from its secret, which the PRF output on its salt unmasks from `mask`
/// (`Fresh::mask`).
fn lab(start: &Start, p256: [u8; 33], mask: [u8; 32], unlock: &Unlock) -> Result<(Lab, SignerId, SignerId)> {
    let mut lab = Lab::with_entropy(start.entropy);
    start.recovery.clone().map(|key| lab.set_recovery(key));
    let passkey = lab.web_passkey("the person", p256, &unlock.ceremony);
    let passkey = passkey.context("the unlock's ceremony isn't of the passkey with this P-256 key")?;
    let me = lab.device_with(&start.name, *xor(&mask, &unlock.device));
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
    start.recovery.clone().map(|key| lab.set_recovery(key));
    let me = lab.device_with(&start.name, *fresh.secret);
    let recover = || unlock.ceremony.assertion().map(|a| a.recover()).unwrap_or_default();
    let keys = p256.map_or_else(recover, |p256| vec![p256]);
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

/// The device as the page holds it (`Device`), with the page's store its shelf is on (`js/store.js`): every call that
/// waits on the network or on its person is a promise.
///
/// A ceremony is the page's: `ceremony(challenge, step)`, a function the device calls with the 32 bytes the passkey
/// signs and what for (`"found"`, `"join"`, `"claim"`, `"approve"`), which resolves to the ceremony's
/// `{authenticatorData, clientDataJSON, signature, prf}`, each bytes, `prf` the PRF output on `prfSalt()`. The unlock
/// is one ceremony's result that also holds `devicePrf`, the output on `deviceSalt(nonce)`, `nonce` the 32 bytes the
/// device keeps for its salt (`Meta`). A new device asks for it as `unlock(challenge)`, a function that resolves to
/// it, over the challenge that makes it the passkey's pass for the device (`Fresh`).
///
/// A device starting shows the page each step of its start as it begins and ends, if the page passes `steps`: a
/// function it calls with them all so far, each time they change (`steps_json`), until the start is over. It holds the
/// store's shelf for this page alone from its start until it closes: the same device never runs in two tabs.
#[wasm_bindgen(js_name = Device)]
pub struct PageDevice(Rc<Device>, JsValue);

#[wasm_bindgen(js_class = Device)]
impl PageDevice {
    /// The first device named `name` of a new person, reaching its peers through the relay at `relay` alone, whose
    /// passkey's public key info (SPKI, as `getPublicKey()` gives it) is `spki`, or `undefined` for a passkey made
    /// before, as at maiaCITY's sign-up: unlocked by `unlock(challenge)`, it founds their human vault and makes it
    /// known to the server whose code reads `server`, which it claims if nobody has yet (`Device::found`). It keeps
    /// what it holds on the shelf of the page's `store`, which holds no device yet (`new_shelf`).
    #[allow(clippy::too_many_arguments)]
    pub async fn found(
        name: String,
        relay: String,
        server: String,
        spki: Option<Vec<u8>>,
        unlock: Function,
        ceremony: Function,
        backup: Option<bool>,
        steps: Option<Function>,
        store: JsValue,
    ) -> Result<PageDevice, JsError> {
        let not_p256 = || JsError::new("not a P-256 passkey's public key info");
        let p256 = spki.map(|spki| sign::spki_p256(&spki).ok_or_else(not_p256)).transpose()?;
        let server = Offer::from_text(&server).map_err(js_error)?;
        let shelf = new_shelf(&store).await?;
        let found = async {
            let (start, fresh) = (starting(name, &relay, steps, shelf)?, Fresh::new().map_err(js_error)?);
            let _ending = start.progress.ending();
            start.progress.step("unlock");
            let (unlock, ceremonies) = (unlocking(&unlock, fresh.challenge(start.now)).await?, Js(ceremony));
            let device = Device::found(start, &server, p256, fresh, unlock, &ceremonies, backup.unwrap_or(true));
            device.await.map_err(js_error)
        };
        PageDevice::on(found.await, store).await
    }

    /// A new device named `name` of a person who has one already, unlocked by `unlock(challenge)`, linked through the
    /// device whose code reads `offer` (`Device::link`), on the shelf of the page's `store`, which holds no device yet
    /// (`new_shelf`).
    pub async fn link(
        name: String,
        relay: String,
        offer: String,
        unlock: Function,
        steps: Option<Function>,
        store: JsValue,
    ) -> Result<PageDevice, JsError> {
        let offer = Offer::from_text(&offer).map_err(js_error)?;
        let shelf = new_shelf(&store).await?;
        let link = async {
            let (start, fresh) = (starting(name, &relay, steps, shelf)?, Fresh::new().map_err(js_error)?);
            let _ending = start.progress.ending();
            start.progress.step("unlock");
            let unlock = unlocking(&unlock, fresh.challenge(start.now)).await?;
            Device::link(start, &offer, fresh, unlock).await.map_err(js_error)
        };
        PageDevice::on(link.await, store).await
    }

    /// The device the page made before, opened again from the shelf of the page's `store`, by what the shelf keeps to
    /// open it (`Meta`, `storeMeta`) and the unlock, a ceremony the page made itself over the device's salt, so the
    /// steps it is shown begin after it (`Device::open`).
    pub async fn open(unlock: JsValue, steps: Option<Function>, store: JsValue) -> Result<PageDevice, JsError> {
        hold(&store).await?;
        let shelf = shelf_of(store.clone());
        let open = async {
            let meta = Meta::load(&shelf).await.map_err(js_error)?;
            let meta = meta.ok_or_else(|| JsError::new("this browser holds no avenDB account"))?;
            let start = starting(meta.name.clone(), &meta.relay, steps, shelf)?;
            let _ending = start.progress.ending();
            Device::open(start, &meta, unlocked(&unlock)?).await.map_err(js_error)
        };
        PageDevice::on(open.await, store).await
    }

    /// The device a start made on the page's `store`; or, if it failed, the store let go of, for the next start.
    async fn on(device: Result<Device, JsError>, store: JsValue) -> Result<PageDevice, JsError> {
        match device {
            Ok(device) => Ok(PageDevice(Rc::new(device), store)),
            Err(e) => {
                ask_store(&store, "release", &[]).await.ok();
                Err(e)
            }
        }
    }

    /// Keeps what opens it again on its shelf (`Device::keep`), with `nonce`, its salt's own 32 bytes in hex, and
    /// `credential`, its passkey's, which its unlock named: a promise of it, as the page reads it (`Meta::to_json`).
    pub fn keep(&self, nonce: String, credential: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let nonce = hex_bytes(&nonce).and_then(|b| <[u8; 32]>::try_from(b).ok());
            let nonce = nonce.ok_or_else(|| JsError::new("a device's nonce is 32 bytes in hex"))?;
            let meta = device.meta(nonce, credential);
            device.keep(&meta).await.map_err(js_value)?;
            js_sys::JSON::parse(&meta.to_json().to_string())
        })
    }

    /// Its name reads `name`, on its shelf and on its card (`Device::rename`): a promise of whether its card changed.
    pub fn rename(&self, name: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move { Ok(device.rename(name).await.map_err(js_value)?.into()) })
    }

    /// Whether its shelf lacks something it holds (`Device::behind`): a promise.
    pub fn behind(&self) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move { Ok(device.behind().await.into()) })
    }

    /// Its device's id, in hex.
    pub fn id(&self) -> String {
        hex(&self.0.node.device().0)
    }

    /// Its endpoint's id, its device's ed25519 key, in hex.
    pub fn endpoint(&self) -> String {
        hex(self.0.node.id().as_bytes())
    }

    /// Its person's passkey's P-256 key, compressed, in hex: what its shelf keeps to open it again (`Meta`).
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

    /// Claims the invite a link names for its vault, through the server whose code reads `server`
    /// (`avendb_net::Node::claim_invite`): `share`, the invite's id, and `secret`, its key's, each 64 hex digits, as
    /// the link holds them. A promise of the vault, in hex, once the server took it with the claim; rejected if the
    /// server knows no such invite, a vault claimed it already, or the server takes the vault no more.
    pub fn claim_invite(&self, server: String, share: String, secret: String) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let server = Offer::from_text(&server).map_err(js_error)?;
            let share = ShareId::from_hex(&share).ok_or_else(|| JsError::new("an invite's id is 64 hex digits"))?;
            let secret = hex_bytes(&secret).and_then(|b| <[u8; 32]>::try_from(b).ok()).map(Zeroizing::new);
            let secret = secret.ok_or_else(|| JsError::new("an invite's key is 64 hex digits"))?;
            let vault = device.node.claim_invite(&server, share, *secret).await.map_err(js_value)?;
            Ok(hex(&vault.0).into())
        })
    }

    /// Runs op `op`, an object of the ops engine's (`Device::run`, `docs/ARCHITECTURE.md` §8): a promise of its
    /// answer, `{ok}`, `{refused, why}`, or for a change its vault's owners approve when no `ceremony` is passed,
    /// `{approve}`, which makes nothing. `ceremony(challenge, step)` is the passkey's, for such a change, as a start
    /// takes it. `read(at, n)` hands over the bytes of a `put_file`'s file, or of the file a `create` brings (its
    /// `file`, `{len, name?, media?}`), from `at` on, `n` of them, as a promise of a `Uint8Array`, a megabyte at a time
    /// (`CHUNK`), so that a file of any size passes through a little memory; it reads the file twice, from the start
    /// each time, once for its key and once to seal it.
    /// `read_file`'s answer carries the bytes it read beside, as `bytes`, a `Uint8Array`. Rejected only where no answer
    /// comes: a ceremony cancelled, the store or the network failing, a file's bytes more or fewer than its length.
    pub fn run(&self, op: JsValue, ceremony: Option<Function>, read: Option<Function>) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move {
            let op = String::from(js_sys::JSON::stringify(&op)?);
            let op: Value = serde_json::from_str(&op).map_err(|e| JsError::new(&format!("no op: {e}")))?;
            let len = engine::len_of(&op).unwrap_or(0);
            let (bytes, ceremony) = (read.map(|read| move || chunks(read.clone(), len)), ceremony.map(Js));
            let (answer, bytes) = device.run(op, bytes, ceremony.as_ref()).await.map_err(js_value)?;
            let answer = js_sys::JSON::parse(&answer.to_string())?;
            if let Some(bytes) = bytes {
                Reflect::set(&answer, &"bytes".into(), &Uint8Array::from(&bytes[..]))?;
            }
            Ok(answer)
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

    /// Waits until it holds other than `edits` edits and `keys` McEliece keys, as the page last showed it (`size`): a
    /// promise of true, or of false once the device closed.
    pub fn changed(&self, edits: u32, keys: u32) -> Promise {
        let device = self.0.clone();
        future_to_promise(async move { Ok(device.changed((edits as usize, keys as usize)).await.into()) })
    }

    /// Closes its connections and its endpoint, once its shelf holds what it holds, if it can; then lets go of the
    /// page's store, for another tab to hold.
    pub fn close(&self) -> Promise {
        let (device, store) = (self.0.clone(), self.1.clone());
        future_to_promise(async move {
            let closed = device.close().await;
            ask_store(&store, "release", &[]).await.ok();
            closed.map_err(js_value)?;
            Ok(JsValue::UNDEFINED)
        })
    }
}

/// What opens the device on the page's `store` again (`Meta::load`), as the page reads it (`Meta::to_json`): a promise,
/// of `undefined` while the store holds none, as on a browser new to avenDB, or one whose account was forgotten.
#[wasm_bindgen(js_name = storeMeta)]
pub fn store_meta(store: JsValue) -> Promise {
    future_to_promise(async move {
        let meta = Meta::load(&shelf_of(store)).await.map_err(js_value)?;
        meta.map_or(Ok(JsValue::UNDEFINED), |meta| js_sys::JSON::parse(&meta.to_json().to_string()))
    })
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

/// Where a device starts: named `name`, through the relay at `relay`, with the browser's randomness, now; showing the
/// page each step of its start by `steps`, if it watches them; on `shelf`, the page's store's (`shelf_of`).
fn starting(name: String, relay: &str, steps: Option<Function>, shelf: Shelf) -> Result<Start, JsError> {
    let relay: RelayUrl = relay.parse().map_err(|_| JsError::new("the relay's URL isn't one"))?;
    let mut entropy = Zeroizing::new([0; 32]);
    getrandom::fill(&mut *entropy).map_err(|e| JsError::new(&format!("no randomness from the browser: {e}")))?;
    let (progress, shelf, recovery) = (shown(steps), Some(shelf), Start::recovery());
    Ok(Start { name, relay, entropy: *entropy, now: now(), direct: false, shelf, progress, recovery })
}

/// Holds the page's `store` for this page alone, until the device on it closes (`PageDevice::close`): refused while
/// another tab holds it, so the same device never runs in two tabs.
async fn hold(store: &JsValue) -> Result<(), JsError> {
    ask_store(store, "hold", &[]).await.map(|_| ()).map_err(|e| JsError::new(&e.to_string()))
}

/// The shelf of the page's `store` for a new device, held for this page alone (`hold`): refused while it opens a device
/// already, which the page forgets first; and if it holds anything else, as what a start cut short left, a new
/// generation of it, the old put aside.
async fn new_shelf(store: &JsValue) -> Result<Shelf, JsError> {
    hold(store).await?;
    let shelf = shelf_of(store.clone());
    let fresh = async {
        if Meta::load(&shelf).await?.is_some() {
            bail!("this browser holds an avenDB account already: forget it here first");
        }
        if !shelf.names("").await?.is_empty() {
            ask_store(store, "aside", &[]).await?;
        }
        Ok(())
    };
    if let Err(e) = fresh.await {
        ask_store(store, "release", &[]).await.ok();
        return Err(js_error(e));
    }
    Ok(shelf)
}

/// The shelf the page's `store` keeps in OPFS (`js/store.js`, `avendb_net::shelf`), in the generation its worker opened
/// or put in use last: each call answered by the store's method of the same name, which its worker runs on bytes alone,
/// `list`, `read`, `outboard`, `write`, `finish`, `drop`, `put`, `get` and `names`. What the bytes mean, the device
/// reads and writes itself.
fn shelf_of(store: JsValue) -> Shelf {
    let (shelf, mut calls) = Shelf::new();
    wasm_bindgen_futures::spawn_local(async move {
        while let Some(call) = calls.recv().await {
            let store = store.clone();
            wasm_bindgen_futures::spawn_local(async move { answer_call(&store, call).await });
        }
    });
    shelf
}

/// What the page's store answers `method` with, called with `args`.
async fn ask_store(store: &JsValue, method: &str, args: &[JsValue]) -> io::Result<JsValue> {
    let failed = |e: JsValue| io::Error::other(format!("the store's {method} failed: {}", js_text(&e)));
    let f = Reflect::get(store, &method.into()).ok().and_then(|f| f.dyn_into::<Function>().ok());
    let f = f.ok_or_else(|| io::Error::other(format!("the store has no {method}")))?;
    let promise = f.apply(store, &args.iter().collect::<Array>()).map_err(failed)?;
    JsFuture::from(Promise::from(promise)).await.map_err(failed)
}

/// Bytes the store answered with.
fn store_bytes(value: JsValue) -> Bytes {
    Bytes::from(Uint8Array::new(&value).to_vec())
}

/// Answers `call` by the page's store.
async fn answer_call(store: &JsValue, call: Call) {
    let bytes = |b: &[u8]| JsValue::from(Uint8Array::from(b));
    match call {
        Call::List(tx) => {
            let listed = ask_store(store, "list", &[]).await.map(|held| {
                let blob = |b: JsValue| {
                    let b = Array::from(&b);
                    Some((hash_of(&b.get(0).as_string()?)?, b.get(1).as_f64()? as u64))
                };
                Array::from(&held).iter().filter_map(blob).collect()
            });
            tx.send(listed).ok();
        }
        Call::Read { name, at, len, tx } => {
            let args = [name.into(), (at as f64).into(), (len as f64).into()];
            tx.send(ask_store(store, "read", &args).await.map(store_bytes)).ok();
        }
        Call::Outboard { hash, tx } => {
            tx.send(ask_store(store, "outboard", &[hash.to_hex().into()]).await.map(store_bytes)).ok();
        }
        Call::Write { name, at, bytes: written, tx } => {
            let args = [name.into(), (at as f64).into(), bytes(&written)];
            tx.send(ask_store(store, "write", &args).await.map(|_| ())).ok();
        }
        Call::Finish { name, hash, size, outboard, tx } => {
            let args = [name.into(), hash.to_hex().into(), (size as f64).into(), bytes(&outboard)];
            tx.send(ask_store(store, "finish", &args).await.map(|_| ())).ok();
        }
        Call::Drop { name, tx } => {
            tx.send(ask_store(store, "drop", &[name.into()]).await.map(|_| ())).ok();
        }
        Call::Put { name, bytes: put, tx } => {
            let refused = || io::Error::new(io::ErrorKind::AlreadyExists, format!("other bytes are {name} already"));
            let put = ask_store(store, "put", &[name.clone().into(), bytes(&put)]).await;
            tx.send(put.and_then(|done| if done.is_falsy() { Err(refused()) } else { Ok(()) })).ok();
        }
        Call::Get { name, tx } => {
            let got = ask_store(store, "get", &[name.into()]).await;
            tx.send(got.map(|b| (!b.is_undefined() && !b.is_null()).then(|| store_bytes(b)))).ok();
        }
        Call::Names { prefix, tx } => {
            let names = ask_store(store, "names", &[prefix.into()]).await;
            tx.send(names.map(|n| Array::from(&n).iter().filter_map(|n| n.as_string()).collect())).ok();
        }
    }
}

/// What a JavaScript error says.
fn js_text(e: &JsValue) -> String {
    Reflect::get(e, &"message".into()).ok().and_then(|m| m.as_string()).or_else(|| e.as_string()).unwrap_or_default()
}

/// A start's steps, shown to the page by `steps(json)` each time they change (`steps_json`), until the start is over,
/// if the page watches them.
fn shown(steps: Option<Function>) -> Progress {
    let progress = Progress::new();
    let Some(steps) = steps else { return progress };
    let mut changes = progress.watch();
    wasm_bindgen_futures::spawn_local(async move {
        loop {
            let now = changes.borrow_and_update().clone();
            let json = js_sys::JSON::parse(&steps_json(&now).to_string()).unwrap_or(JsValue::NULL);
            // the page's own trouble showing them is no trouble of the start's
            steps.call1(&JsValue::NULL, &json).ok();
            if now.over || changes.changed().await.is_err() {
                break;
            }
        }
    });
    progress
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

/// The `len` bytes of a file as the page's `read(at, n)` hands them over (`PageDevice::run`, for an op that brings a
/// file), a megabyte at a time (`CHUNK`): a chunk of other than `n` bytes, or a read that fails, ends them with an
/// error.
fn chunks(read: Function, len: u64) -> impl Stream<Item = io::Result<Bytes>> + Unpin {
    Box::pin(stream::unfold((0, read), move |(at, read)| async move {
        if at >= len {
            return None;
        }
        let n = (len - at).min(CHUNK);
        let got = match pull(&read, at, n).await {
            Ok(bytes) if bytes.len() as u64 == n => Ok(Bytes::from(bytes)),
            Ok(bytes) => Err(io::Error::other(format!("{} bytes read at {at}, not {n}", bytes.len()))),
            Err(e) => Err(io::Error::other(format!("reading the file failed: {}", js_text(&e)))),
        };
        let next = if got.is_ok() { at + n } else { len };
        Some((got, (next, read)))
    }))
}

/// `n` bytes of a file from `at` on, as the page's `read(at, n)` hands them over (`chunks`).
async fn pull(read: &Function, at: u64, n: u64) -> Result<Vec<u8>, JsValue> {
    let asked = read.call2(&JsValue::NULL, &JsValue::from_f64(at as f64), &JsValue::from_f64(n as f64))?;
    let bytes = JsFuture::from(Promise::resolve(&asked)).await?;
    Ok(Uint8Array::new(&bytes).to_vec())
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
    fn a_device_opens_with_its_secret_unmasked_by_the_prf_output_on_its_salt() {
        let mut passkey = Passkey::from_seed([5; 32]);
        let device = passkey.prf(&device_salt(&[1; 32]));
        let unlock = Unlock { ceremony: passkey.ceremony([0xaa; 32]), device: device.clone() };
        let relay = "http://localhost:3340".parse().expect("a relay's URL");
        let (name, progress) = ("Eve's browser".into(), Progress::new());
        let (entropy, recovery) = ([7; 32], None);
        let start = Start { name, relay, entropy, now: 0, direct: false, shelf: None, progress, recovery };
        // its own secret, kept masked by the PRF output on its salt
        let fresh = Fresh::from_secret([9; 32]);
        let mask = fresh.mask(&unlock);
        assert_ne!(mask, [9; 32], "the mask is no secret of the device's");
        let (_, _, me) = lab(&start, passkey.public(), mask, &unlock).expect("it opens");
        assert_eq!(me, fresh.keys().id());
        // without its mask, the unlock opens some other device, never this one
        let (_, _, other) = lab(&start, passkey.public(), [0; 32], &unlock).expect("some device opens");
        assert_ne!(other, me, "another device's");
        assert_eq!(other, DeviceKey::from_secret(*device).id());
    }

    #[test]
    fn what_opens_a_device_reads_back_as_it_was_written_and_nothing_else_does() {
        let meta = Meta {
            name: "Eve's browser".into(),
            relay: "https://avendb.maia.city/".into(),
            nonce: [1; 32],
            mask: [2; 32],
            credential: "Y3JlZGVudGlhbA".into(),
            p256: [3; 33],
            device: SignerId([4; 32]),
            follow: vec![VaultId([5; 32]), VaultId([6; 32])],
            query_depth: Some(9),
            touch: None,
        };
        assert_eq!(Meta::from_json(&meta.to_json()).expect("it reads"), meta);
        assert_eq!(meta.to_json().get("touch"), None, "a browser keeps no Touch ID key");
        // a Mac's Touch ID key, its Enclave's blobs and its mask, reads back too; a mask cut short doesn't
        let touch = Touch { public: vec![7; 1952], key: vec![8; 9], kem: vec![9; 9], sealed: vec![10; 1088], mask: [11; 32], passkey: SignerId([12; 32]) };
        let mac = Meta { touch: Some(touch), ..meta.clone() };
        assert_eq!(Meta::from_json(&mac.to_json()).expect("it reads"), mac);
        let mut cut = mac.to_json();
        cut["touch"]["mask"] = "0b0b".into();
        assert!(Meta::from_json(&cut).is_err(), "a Touch ID key's mask is 32 bytes");
        // as written before it followed anything, or set how deep its queries read: it follows nothing, and reads as
        // deep as any write reaches
        let mut before = meta.to_json();
        before.as_object_mut().expect("an object").remove("follow");
        before.as_object_mut().expect("an object").remove("queryDepth");
        let before = Meta::from_json(&before).expect("it reads");
        assert_eq!((before.follow, before.query_depth), (vec![], None));
        assert_eq!(Meta { query_depth: None, ..meta.clone() }.to_json().get("queryDepth"), None);
        let mut maskless = meta.to_json();
        maskless.as_object_mut().expect("an object").remove("mask");
        assert!(Meta::from_json(&maskless).is_err(), "a device opens only by its mask");
        let mut short = meta.to_json();
        short["nonce"] = "0101".into();
        assert!(Meta::from_json(&short).is_err(), "a nonce is 32 bytes");
    }
}
