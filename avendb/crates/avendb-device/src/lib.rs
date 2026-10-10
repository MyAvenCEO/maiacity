//! avenDB's device in the Mac app, maiaCITY Studio: the browser's device (`avendb_browser::Device`) run natively beside
//! the app, as its sidecar. Its node binds UDP sockets of its own on every interface and maps a port on the router
//! where one lets it, so it reaches its peers directly and through the relay only where it must
//! (`avendb_net::Options::direct`); its TLS is aws-lc-rs, X25519MLKEM768 only; and it keeps what it holds in a folder
//! on disk (`avendb_net::Disk`), not in the web view's IndexedDB.
//!
//! The app (vault/app/src/avendb.rs) starts it with the folder it keeps its account in and talks to it in lines of
//! JSON on its stdin and stdout, for the app's avenDB page (src/lib/avendb/native.js):
//!
//! - the app asks `{"id": n, "call": name, "args": [..]}` and the device answers `{"id": n, "ok": value}` or
//!   `{"id": n, "error": why}`, each call as the page's device answers it (`avendb_browser::PageDevice`), ids in hex;
//! - the device asks the app to show the sign-in sheet `{"sheet": n, "url": url}` for each ceremony of its person's
//!   passkey, and the app answers `{"sheet": n, "back": url}`, the URL the sheet's page sent back, or
//!   `{"sheet": n, "error": why}`.
//!
//! The passkey's ceremonies run in the sign-in sheet as the page's do (vault/app/src/passkey.rs,
//! src/routes/app/avendb/sheet/): for each, the device makes an X-Wing key of its own (`keys::Secret`), names it in the
//! sheet's URL, and opens what the sheet's page sealed to it (`keys::open_once`), so nothing crosses the app open.
//!
//! The device keeps no secret. Its folder holds its store and what opens it again (`meta.json`: its name, its relay,
//! its salt's own bytes, its secret masked by the PRF output on its salt, which only its passkey computes again, and
//! its passkey's credential and P-256 key), as the page keeps them; its keys come back at every unlock. A device made
//! before 2026-10-10 keeps no mask: the PRF output on its salt is its secret. The device the page made before moves
//! here as it opens (`adopt`): the store the page read from IndexedDB becomes the folder's. A store that no device
//! opens any more is put aside in the folder, never deleted.

use std::collections::HashMap;
use std::fs;
use std::io::{ErrorKind, Write as _};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::id::{BlobId, CapId, EntryId, VaultId};
use avendb::keys;
use avendb::policy::Kind;
use avendb::sign::{self, Assertion, Ceremony};
use avendb_browser::{Device, Fresh, Start, Unlock, backup, words};
use avendb_net::{Authenticator, Offer, Step};
use data_encoding::{BASE64, BASE64URL_NOPAD};
use iroh::RelayUrl;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt as _, AsyncRead, AsyncWrite, AsyncWriteExt as _, BufReader};
use tokio::sync::{mpsc, oneshot};
use zeroize::Zeroizing;

/// The page the sign-in sheet shows for a ceremony: maia.city's, whose passkeys these are.
pub const SHEET: &str = "https://maia.city/app/avendb/sheet/";

/// What opens the device again, in its folder.
pub const META: &str = "meta.json";

/// Its store, in its folder (`avendb_net::Disk`).
pub const STORE: &str = "store";

/// Where a store no device opens any more is put, under when and why: one the folder held without what opens it, or
/// the one its person forgot here.
pub const ASIDE: &str = "aside";

/// The longest a call waits for the device to change (`changed`): then it answers `null`, and the page asks again.
const CHANGED: Duration = Duration::from_secs(50);

/// How the device runs: the folder it keeps its account in, and whether its node reaches its peers directly too
/// (`avendb_net::Options::direct`), as the app's does; a test's may run on its relay alone.
pub struct Config {
    pub dir: PathBuf,
    pub direct: bool,
}

/// Runs the device for the app until `input` ends, the app gone: each line of `input` a call or a sheet's answer, each
/// line of `output` an answer or a sheet to show. Then it closes the device.
pub async fn serve(
    config: Config,
    input: impl AsyncRead + Unpin,
    mut output: impl AsyncWrite + Unpin + Send + 'static,
) -> Result<()> {
    let (out, mut outgoing) = mpsc::unbounded_channel::<String>();
    tokio::spawn(async move {
        while let Some(mut line) = outgoing.recv().await {
            line.push('\n');
            if output.write_all(line.as_bytes()).await.is_err() || output.flush().await.is_err() {
                break;
            }
        }
    });
    let service = Arc::new(Service {
        config,
        out,
        sheets: Mutex::default(),
        next: AtomicU64::new(1),
        device: Mutex::default(),
        life: tokio::sync::Mutex::default(),
    });
    let mut lines = BufReader::new(input).lines();
    while let Some(line) = lines.next_line().await? {
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            tracing::warn!("a line from the app that isn't JSON");
            continue;
        };
        if let Some(n) = message.get("sheet").and_then(Value::as_u64) {
            service.answered(n, &message);
        } else if let Some(id) = message.get("id").and_then(Value::as_u64) {
            let call = message.get("call").and_then(Value::as_str).unwrap_or_default().to_string();
            let args = message.get("args").and_then(Value::as_array).cloned().unwrap_or_default();
            tokio::spawn(service.clone().run(id, call, args));
        }
    }
    service.close().await;
    Ok(())
}

/// The device and what it waits on.
struct Service {
    config: Config,
    /// Lines to the app, in order.
    out: mpsc::UnboundedSender<String>,
    /// The sheets the app shows, each awaited by the ceremony that asked for it.
    sheets: Mutex<HashMap<u64, oneshot::Sender<Result<String, String>>>>,
    next: AtomicU64,
    /// The device, once open.
    device: Mutex<Option<Arc<Device>>>,
    /// One start at a time: founding, linking, opening, adopting or forgetting the device.
    life: tokio::sync::Mutex<()>,
}

impl Service {
    /// Answers call `id`, `call` with `args`, in a task of its own, so that even a panic gets its answer.
    async fn run(self: Arc<Self>, id: u64, call: String, args: Vec<Value>) {
        let service = self.clone();
        let done = tokio::spawn(async move { service.call(&call, Args(&args)).await }).await;
        let answer = match done {
            Ok(Ok(value)) => json!({ "id": id, "ok": value }),
            Ok(Err(e)) => json!({ "id": id, "error": format!("{e:#}") }),
            Err(e) => json!({ "id": id, "error": format!("the device failed: {e}") }),
        };
        self.send(answer);
    }

    fn send(&self, message: Value) {
        let _ = self.out.send(message.to_string());
    }

    async fn call(self: &Arc<Self>, call: &str, a: Args<'_>) -> Result<Value> {
        tracing::debug!("call {call}");
        match call {
            "status" => Ok(self.status()),
            "found" => self.found(a.text(0)?, a.text(1)?, a.text(2)?, a.get(3).as_bool().unwrap_or(true)).await,
            "link" => self.link(a.text(0)?, a.text(1)?, a.text(2)?).await,
            "open" => self.open().await,
            "adopt" => self.adopt(a.get(0), a.list(1)?, a.list(2)?).await,
            "forget" => self.forget().await.map(|()| Value::Null),
            "rename" => self.rename(a.text(0)?).await.map(Value::from),
            "qrSvg" => qr_svg(&a.text(0)?, u32::try_from(a.count(1)?)?).map(Value::from),
            _ => self.on_device(call, a).await,
        }
    }

    /// A call on the open device, as the page's device answers it.
    async fn on_device(self: &Arc<Self>, call: &str, a: Args<'_>) -> Result<Value> {
        let d = self.device()?;
        let (vault, entry) = (|i| a.id(i).map(VaultId), |i| a.id(i).map(EntryId));
        Ok(match call {
            "size" => {
                let (edits, keys) = d.node().read(|lab, me| lab.size(me)).await;
                json!([edits, keys])
            }
            "changed" => {
                let held = (a.count(0)?, a.count(1)?);
                tokio::time::timeout(CHANGED, d.changed(held)).await.map_or(Value::Null, Value::from)
            }
            "world" => d.world().await.map_or(Value::Null, |w| w.to_json(d.node().device())),
            "card" => json!(d.card(a.text(0)?).await?),
            "profile" => json!(d.profile(vault(0)?, a.text(1)?).await?),
            "backsUp" => d.backs_up().await.map_or(Value::Null, Value::from),
            "backUp" => json!(d.back_up(a.get(0).as_bool().unwrap_or(true)).await?),
            "run" => d.run(a.get(0).clone()).await,
            "database" => d.database(vault(0)?).await,
            "note" => d.note(entry(0)?).await.unwrap_or(Value::Null),
            "history" => d.history().await,
            "foundVaults" => {
                let mut new = vec![];
                for v in a.list(0)? {
                    let kind = match v.get("kind").and_then(Value::as_str) {
                        Some("aven") => Kind::Aven,
                        Some("coop") => Kind::Coop,
                        _ => bail!("a new vault is an aven or a coop vault"),
                    };
                    new.push((kind, v.get("name").and_then(Value::as_str).unwrap_or_default().to_string()));
                }
                let vaults = d.found_vaults(new, &self.approver()?).await?;
                json!(vaults.iter().map(|v| hex(&v.0)).collect::<Vec<_>>())
            }
            "share" => {
                let (issuer, over, grantee) = (vault(0)?, vault(1)?, words::grantee_of(&a.text(3)?)?);
                hex(&d.share(issuer, over, a.get(2), grantee, &self.approver()?).await?.0).into()
            }
            "revoke" => {
                d.revoke(vault(0)?, CapId(a.id(1)?), &self.approver()?).await?;
                Value::Null
            }
            _ => bail!("no call {call:?}"),
        })
    }

    /// Whether the folder holds an account, what opens it, and the device if it is open.
    fn status(&self) -> Value {
        let device = self.device.lock().expect("the device").clone();
        let meta = self.meta().ok().flatten().map(|m| m.to_json());
        json!({ "meta": meta, "open": device.is_some(), "device": device.map(|d| info(&d)) })
    }

    /// The first device of a new person (`Device::found`), in two ceremonies: the unlock, which is the passkey's pass
    /// for the new device, and one for the vault and the device in it, which also claims the server whose code reads
    /// `server` if nobody has; the server backs the vault up unless `backup` is false, and then only relays.
    async fn found(self: &Arc<Self>, name: String, relay: String, server: String, backup: bool) -> Result<Value> {
        let _life = self.life.lock().await;
        self.fresh()?;
        let server = Offer::from_text(server.trim())?;
        let (sheets, nonce, new) = (Sheets::new(self.clone(), None), random()?, Fresh::new()?);
        let start = self.start(&name, &relay)?;
        let unlock = sheets.unlock(nonce, new.challenge(start.now)).await?;
        let d = Device::found(start, &server, None, new, unlock, &sheets, backup).await?;
        self.started(d, (name, relay, nonce, sheets.credential()?))
    }

    /// A new device of a person who has one already (`Device::link`), linked through the device or the server whose
    /// code reads `through`, in one ceremony: the unlock, which is the passkey's pass for the new device and signs the
    /// edit that adds it too.
    async fn link(self: &Arc<Self>, name: String, relay: String, through: String) -> Result<Value> {
        let _life = self.life.lock().await;
        self.fresh()?;
        let through = Offer::from_text(through.trim())?;
        let (sheets, nonce, new) = (Sheets::new(self.clone(), None), random()?, Fresh::new()?);
        let start = self.start(&name, &relay)?;
        let unlock = sheets.unlock(nonce, new.challenge(start.now)).await?;
        let d = Device::link(start, &through, new, unlock).await?;
        self.started(d, (name, relay, nonce, sheets.credential()?))
    }

    /// The device the folder holds, opened again from its store in the unlock's ceremony alone (`Device::open`): or
    /// the device already open.
    async fn open(self: &Arc<Self>) -> Result<Value> {
        let _life = self.life.lock().await;
        if let Some(d) = self.device.lock().expect("the device").clone() {
            return Ok(info(&d));
        }
        let meta = self.meta()?.context("this Mac holds no avenDB account yet")?;
        let sheets = Sheets::new(self.clone(), Some(meta.credential.clone()));
        let unlock = sheets.unlock(meta.nonce, random()?).await?;
        let start = self.start(&meta.name, &meta.relay)?;
        let d = Device::open(start, meta.p256, meta.mask, unlock, &backup(&[], vec![])).await?;
        self.opened(d, &meta)
    }

    /// The device the page made before, moved here: opened in the unlock's ceremony from what the page's store kept,
    /// its signed edits and McEliece keys, each in base64, which become the folder's store; `meta` what opens it, as
    /// the page kept it.
    async fn adopt(self: &Arc<Self>, meta: &Value, edits: &[Value], keys: &[Value]) -> Result<Value> {
        let _life = self.life.lock().await;
        self.fresh()?;
        let meta = Meta::from_json(meta)?;
        let bytes = |v: &Value| v.as_str().and_then(|b| BASE64.decode(b.as_bytes()).ok()).context("bytes in base64");
        let edits = edits.iter().map(bytes).collect::<Result<Vec<_>>>()?;
        let keys = keys.iter().map(|k| bytes(k).map(Arc::from)).collect::<Result<Vec<Arc<[u8]>>>>()?;
        let sheets = Sheets::new(self.clone(), Some(meta.credential.clone()));
        let unlock = sheets.unlock(meta.nonce, random()?).await?;
        let start = self.start(&meta.name, &meta.relay)?;
        let d = Device::open(start, meta.p256, meta.mask, unlock, &backup(&edits, keys)).await?;
        self.opened(d, &meta)
    }

    /// Forgets the account here: closes the device, and puts its store and what opens it aside.
    async fn forget(&self) -> Result<()> {
        let _life = self.life.lock().await;
        let d = self.device.lock().expect("the device").take();
        if let Some(d) = d {
            d.close().await.ok();
        }
        self.aside("forgotten")
    }

    /// The device's name reads `name`: kept to open it again, and on its card (`Device::card`). Whether its card
    /// changed.
    async fn rename(&self, name: String) -> Result<bool> {
        let name = name.trim().to_string();
        if name.is_empty() {
            bail!("a device has a name");
        }
        let d = self.device()?;
        let mut meta = self.meta()?.context("this Mac holds no avenDB account")?;
        meta.name.clone_from(&name);
        self.keep(&meta)?;
        d.card(name).await
    }

    /// The app went away: the device closes, and every sheet still awaited ends.
    async fn close(&self) {
        let d = self.device.lock().expect("the device").take();
        if let Some(d) = d {
            d.close().await.ok();
        }
        self.sheets.lock().expect("the sheets").clear();
    }

    fn device(&self) -> Result<Arc<Device>> {
        self.device.lock().expect("the device").clone().context("avenDB isn't open here: unlock it first")
    }

    /// Where a device starts here: named `name`, through the relay at `relay`, with the machine's randomness, now; its
    /// store in the folder.
    fn start(&self, name: &str, relay: &str) -> Result<Start> {
        let relay: RelayUrl = relay.trim().parse().map_err(|_| anyhow!("the relay's URL isn't one"))?;
        let mut entropy = Zeroizing::new([0; 32]);
        getrandom::fill(&mut *entropy).map_err(|e| anyhow!("no randomness: {e}"))?;
        let (name, store) = (name.trim().to_string(), Some(self.config.dir.join(STORE)));
        Ok(Start { name, relay, entropy: *entropy, now: now(), direct: self.config.direct, store })
    }

    /// Ready for a new device: none open and none to open in the folder; a store left there without what opens it is
    /// put aside, or, if it holds nothing, removed.
    fn fresh(&self) -> Result<()> {
        if self.device.lock().expect("the device").is_some() || self.config.dir.join(META).exists() {
            bail!("this Mac holds an avenDB account already: forget it here first");
        }
        let store = self.config.dir.join(STORE);
        let holds = |name: &str| fs::read_dir(store.join(name)).is_ok_and(|mut d| d.next().is_some());
        let edits = fs::metadata(store.join("ops")).is_ok_and(|m| m.len() > 0);
        if edits || holds("keys") {
            self.aside("unopened")?;
        } else if store.exists() {
            fs::remove_dir_all(&store)?;
        }
        Ok(())
    }

    /// Device `d`, new here, runs from here on; the folder keeps what opens it again: its name, relay, salt's own
    /// bytes, mask and passkey's credential.
    fn started(&self, d: Device, opens: (String, String, [u8; 32], String)) -> Result<Value> {
        let (name, relay, nonce, credential) = opens;
        let (name, relay, mask, p256) = (name.trim().into(), relay.trim().into(), d.mask(), d.p256());
        self.opened(d, &Meta { name, relay, nonce, mask, credential, p256 })
    }

    /// Device `d` runs from here on, opened again by `meta`, which the folder keeps.
    fn opened(&self, d: Device, meta: &Meta) -> Result<Value> {
        let d = Arc::new(d);
        *self.device.lock().expect("the device") = Some(d.clone());
        self.keep(meta)?;
        Ok(info(&d))
    }

    /// What opens the device again, as the folder keeps it, if it does.
    fn meta(&self) -> Result<Option<Meta>> {
        match fs::read(self.config.dir.join(META)) {
            Ok(bytes) => Meta::from_json(&serde_json::from_slice(&bytes).context("what opens the device")?).map(Some),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Keeps `meta` in the folder: written beside it first, then in its place, so it is always whole.
    fn keep(&self, meta: &Meta) -> Result<()> {
        fs::create_dir_all(&self.config.dir)?;
        let (path, part) = (self.config.dir.join(META), self.config.dir.join(format!("{META}.part")));
        let mut file = fs::File::create(&part)?;
        file.write_all(meta.to_json().to_string().as_bytes())?;
        file.sync_all()?;
        fs::rename(&part, &path)?;
        Ok(())
    }

    /// Puts the folder's store and what opens it aside, under the time and `why`.
    fn aside(&self, why: &str) -> Result<()> {
        let to = self.config.dir.join(ASIDE).join(format!("{}-{why}", now()));
        for name in [STORE, META] {
            let from = self.config.dir.join(name);
            if from.exists() {
                fs::create_dir_all(&to)?;
                fs::rename(&from, to.join(name)).with_context(|| format!("putting {name} aside"))?;
            }
        }
        Ok(())
    }

    /// The passkey's ceremonies for what its vault approves (new vaults, an owner cap, its revocation): in the
    /// sheet, with the passkey that opened the device.
    fn approver(self: &Arc<Self>) -> Result<Sheets> {
        let meta = self.meta()?.context("this Mac holds no avenDB account")?;
        Ok(Sheets::new(self.clone(), Some(meta.credential)))
    }

    /// Shows the sign-in sheet at `url` over the app's window: the URL the sheet's page sent back.
    async fn sheet(&self, url: String) -> Result<String> {
        let n = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.sheets.lock().expect("the sheets").insert(n, tx);
        self.send(json!({ "sheet": n, "url": url }));
        match rx.await {
            Ok(Ok(back)) => Ok(back),
            Ok(Err(why)) => Err(anyhow!(why)),
            Err(_) => bail!("the app went away"),
        }
    }

    /// The app's answer to sheet `n`.
    fn answered(&self, n: u64, message: &Value) {
        let Some(tx) = self.sheets.lock().expect("the sheets").remove(&n) else { return };
        let answer = match (message.get("back").and_then(Value::as_str), message.get("error").and_then(Value::as_str)) {
            (Some(back), _) => Ok(back.to_string()),
            (None, Some(why)) => Err(why.to_string()),
            (None, None) => Err("the sign-in sheet ended with nothing".to_string()),
        };
        let _ = tx.send(answer);
    }
}

/// What opens the device again, as the page keeps it: its name, its relay, its salt's own 32 bytes, its secret masked
/// by the PRF output on its salt (`avendb_browser::Fresh::mask`), none for a device made before 2026-10-10, the
/// credential of its person's passkey (base64url) and that passkey's P-256 key, compressed.
#[derive(Clone)]
struct Meta {
    name: String,
    relay: String,
    nonce: [u8; 32],
    mask: Option<[u8; 32]>,
    credential: String,
    p256: [u8; 33],
}

impl Meta {
    /// As the page keeps it: the nonce, the mask, if any, and the P-256 key (`passkey`) in hex.
    fn to_json(&self) -> Value {
        let mut meta = json!({
            "name": self.name,
            "relay": self.relay,
            "nonce": hex(&self.nonce),
            "credential": self.credential,
            "passkey": hex(&self.p256),
        });
        if let Some(mask) = self.mask {
            meta["mask"] = hex(&mask).into();
        }
        meta
    }

    fn from_json(v: &Value) -> Result<Meta> {
        let field =
            |k: &str| v.get(k).and_then(Value::as_str).with_context(|| format!("what opens the device: no {k}"));
        let nonce = unhex(field("nonce")?).and_then(|b| b.try_into().ok());
        let mask = v.get("mask").and_then(Value::as_str).map(|m| unhex(m).and_then(|b| b.try_into().ok()));
        let p256 = unhex(field("passkey")?).and_then(|b| b.try_into().ok());
        Ok(Meta {
            name: field("name")?.into(),
            relay: field("relay")?.into(),
            nonce: nonce.context("a device's nonce is 32 bytes in hex")?,
            mask: mask.map(|m| m.context("a device's mask is 32 bytes in hex")).transpose()?,
            credential: field("credential")?.into(),
            p256: p256.context("a passkey's P-256 key is 33 bytes in hex")?,
        })
    }
}

/// The device as the page shows it, as the page's device gives it (`PageDevice::id`, `endpoint`, `passkey`, `offer`):
/// its id, its endpoint's, its passkey's P-256 key and its code, for the next device of its person to link through;
/// and the UDP sockets its node bound, which a page's has none of.
fn info(d: &Device) -> Value {
    let sockets = d.node().endpoint().bound_sockets();
    json!({
        "id": hex(&d.node().device().0),
        "endpoint": hex(d.node().id().as_bytes()),
        "passkey": hex(&d.p256()),
        "offer": d.node().offer().to_text(),
        "sockets": sockets.iter().map(ToString::to_string).collect::<Vec<_>>(),
    })
}

/// The person's passkey in the app's sign-in sheet: each ceremony the device asks for is one sheet, whose answer only
/// the key the device made for it opens. It asks for the passkey whose credential it knows, or any of its person's
/// until a ceremony names one.
struct Sheets {
    service: Arc<Service>,
    credential: Mutex<Option<String>>,
}

/// A ceremony as the sheet brings it back: the assertion, and the PRF outputs on the app's salt and, for an unlock, on
/// the device's.
struct Brought {
    assertion: Assertion,
    prf: Zeroizing<[u8; 32]>,
    device: Option<Zeroizing<[u8; 32]>>,
}

impl Sheets {
    fn new(service: Arc<Service>, credential: Option<String>) -> Sheets {
        Sheets { service, credential: Mutex::new(credential) }
    }

    /// The credential of the passkey the ceremonies used.
    fn credential(&self) -> Result<String> {
        self.credential.lock().expect("the credential").clone().context("no ceremony named the passkey")
    }

    /// The ceremony that unlocks the device whose salt ends in `nonce` (`sign::device_salt`), over `challenge`: a new
    /// device's, which makes the unlock its passkey's pass for it (`avendb_browser::Fresh::challenge`), or one of its
    /// own.
    async fn unlock(&self, nonce: [u8; 32], challenge: [u8; 32]) -> Result<Unlock> {
        let brought = self.ask("unlock", challenge, Some(&nonce)).await?;
        let device = brought.device.context("the sheet brought no PRF output on the device's salt")?;
        Ok(Unlock { ceremony: Ceremony::new(brought.assertion, *brought.prf), device })
    }

    /// One ceremony in the sheet, for `what`, over `challenge`, with the PRF output on the app's salt and, given
    /// `nonce`, on the salt of the device whose own bytes they are: the sheet's page seals it to an X-Wing key made for
    /// this ceremony alone, bound to the challenge (avendb-browser's `sealCeremony`).
    async fn ask(&self, what: &str, challenge: [u8; 32], nonce: Option<&[u8; 32]>) -> Result<Brought> {
        let mut seed = Zeroizing::new([0; 32]);
        getrandom::fill(&mut *seed).map_err(|e| anyhow!("no randomness: {e}"))?;
        let secret = keys::Secret::from_bytes(*seed);
        let mut asked = vec![
            ("what", what.to_string()),
            ("challenge", BASE64URL_NOPAD.encode(&challenge)),
            ("salt", BASE64URL_NOPAD.encode(sign::PRF_SALT)),
            ("key", BASE64URL_NOPAD.encode(&secret.xwing_public())),
        ];
        if let Some(nonce) = nonce {
            asked.push(("device", BASE64URL_NOPAD.encode(&sign::device_salt(nonce))));
        }
        if let Some(id) = self.credential.lock().expect("the credential").clone() {
            asked.push(("id", id));
        }
        let back = self.service.sheet(format!("{SHEET}#{}", form(&asked))).await?;
        let answer = unform(back.split_once('#').map_or("", |(_, fragment)| fragment));
        let sealed = match (answer.get("sealed"), answer.get("error")) {
            (Some(sealed), _) => sealed,
            (None, Some(why)) => bail!("{why}"),
            (None, None) => bail!("the sign-in sheet brought nothing back"),
        };
        let sealed = BASE64URL_NOPAD.decode(sealed.as_bytes()).context("the sheet's answer")?;
        let info = [&b"avenDB sign-in sheet "[..], &challenge].concat();
        let plain = keys::open_once(&sealed, &secret, &info);
        let plain = plain.context("the sign-in sheet's answer doesn't open here: it answers another ask")?;
        let (id, brought) = brought(&plain)?;
        *self.credential.lock().expect("the credential") = Some(id);
        Ok(brought)
    }
}

impl Authenticator for Sheets {
    async fn ceremony(&self, challenge: [u8; 32], step: Step) -> Result<Ceremony> {
        let what = match step {
            Step::Found => "found",
            Step::Join => "join",
            Step::Claim => "claim",
            Step::Approve => "approve",
        };
        let brought = self.ask(what, challenge, None).await?;
        Ok(Ceremony::new(brought.assertion, *brought.prf))
    }
}

/// A ceremony as the sheet's page seals it (avendb-browser's `ceremony_bytes`): the credential's id, the assertion's
/// authenticator data, client data and signature, the PRF output on the app's salt and the one on the device's, empty
/// but for an unlock; each behind its length, four bytes little-endian.
fn brought(mut bytes: &[u8]) -> Result<(String, Brought)> {
    let mut parts = Vec::with_capacity(6);
    while let Some((len, rest)) = bytes.split_first_chunk::<4>() {
        let (part, rest) = rest.split_at_checked(u32::from_le_bytes(*len) as usize).context("a ceremony cut short")?;
        parts.push(part);
        bytes = rest;
    }
    let ([id, data, client, signature, prf, device], []) = (&parts[..], bytes) else { bail!("not a ceremony") };
    let output = |bytes: &[u8]| -> Result<Zeroizing<[u8; 32]>> {
        let mut out = Zeroizing::new([0; 32]);
        out.copy_from_slice(bytes.get(..32).filter(|_| bytes.len() == 32).context("a PRF output is 32 bytes")?);
        Ok(out)
    };
    let (authenticator_data, client_data_json) = (data.to_vec(), client.to_vec());
    let assertion = Assertion { authenticator_data, client_data_json, signature: signature.to_vec() };
    let device = if device.is_empty() { None } else { Some(output(device)?) };
    let id = std::str::from_utf8(id).context("a credential's id is text")?.to_string();
    Ok((id, Brought { assertion, prf: output(prf)?, device }))
}

/// A call's arguments, as the page passes them.
#[derive(Clone, Copy)]
struct Args<'a>(&'a [Value]);

impl Args<'_> {
    fn get(&self, i: usize) -> &Value {
        self.0.get(i).unwrap_or(&Value::Null)
    }

    fn text(&self, i: usize) -> Result<String> {
        self.get(i).as_str().map(str::to_string).with_context(|| format!("argument {} is text", i + 1))
    }

    fn count(&self, i: usize) -> Result<usize> {
        let n = self.get(i).as_u64().with_context(|| format!("argument {} is a count", i + 1))?;
        Ok(usize::try_from(n)?)
    }

    fn list(&self, i: usize) -> Result<&[Value]> {
        self.get(i).as_array().map(Vec::as_slice).with_context(|| format!("argument {} is a list", i + 1))
    }

    /// An id, from its 64 lowercase hex digits.
    fn id(&self, i: usize) -> Result<[u8; 32]> {
        id(&self.text(i)?)
    }
}

/// `text` as a QR code, an SVG image at least `size` pixels wide, as avendb-browser's `qrSvg` draws it.
fn qr_svg(text: &str, size: u32) -> Result<String> {
    let code = qrcode::QrCode::with_error_correction_level(text, qrcode::EcLevel::L);
    let code = code.map_err(|e| anyhow!("no QR code holds it: {e}"))?;
    Ok(code.render::<qrcode::render::svg::Color>().min_dimensions(size, size).build())
}

/// Pairs as a URL's query or fragment holds them, each value escaped but for the characters a URL leaves as they are.
fn form(pairs: &[(&str, String)]) -> String {
    let escape = |value: &str| -> String {
        let plain = |b: u8| b.is_ascii_alphanumeric() || b"-._~".contains(&b);
        value.bytes().map(|b| if plain(b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
    };
    pairs.iter().map(|(k, v)| format!("{k}={}", escape(v))).collect::<Vec<_>>().join("&")
}

/// The pairs of a URL's query or fragment, as a browser's `URLSearchParams` reads them: `+` a space, `%XX` a byte.
fn unform(text: &str) -> HashMap<String, String> {
    let decode = |part: &str| -> String {
        let (bytes, mut out, mut i) = (part.as_bytes(), Vec::with_capacity(part.len()), 0);
        while i < bytes.len() {
            let hex = bytes.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok());
            let escaped = hex.and_then(|h| u8::from_str_radix(h, 16).ok());
            match (bytes[i], escaped) {
                (b'%', Some(b)) => (out.push(b), i += 3),
                (b'+', _) => (out.push(b' '), i += 1),
                (b, _) => (out.push(b), i += 1),
            };
        }
        String::from_utf8_lossy(&out).into_owned()
    };
    let pair = |p: &str| p.split_once('=').map_or((decode(p), String::new()), |(k, v)| (decode(k), decode(v)));
    text.split('&').filter(|p| !p.is_empty()).map(pair).collect()
}

/// 32 bytes of the machine's randomness.
fn random() -> Result<[u8; 32]> {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).map_err(|e| anyhow!("no randomness: {e}"))?;
    Ok(bytes)
}

/// The time by the machine's clock: seconds since 1970.
fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// Bytes as lowercase hex digits, as the page sees every id.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Bytes from their lowercase hex digits.
fn unhex(s: &str) -> Option<Vec<u8>> {
    let digit = |c: u8| (c as char).to_digit(16).filter(|_| !c.is_ascii_uppercase()).map(|d| d as u8);
    let pair = |p: &[u8]| Some(digit(p[0])? << 4 | digit(p[1])?);
    s.len().is_multiple_of(2).then(|| s.as_bytes().chunks(2).map(pair).collect()).flatten()
}

/// An id from its 64 lowercase hex digits.
fn id(s: &str) -> Result<[u8; 32]> {
    BlobId::from_hex(s).map(|b| b.0).with_context(|| format!("{s:?} is no id"))
}
