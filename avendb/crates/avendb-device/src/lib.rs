//! avenDB's device in the Mac app, maiaCITY Studio: the browser's device (`avendb_browser::Device`) run natively beside
//! the app, as its sidecar. Its node binds UDP sockets of its own on every interface and maps a port on the router
//! where one lets it, so it reaches its peers directly and through the relay only where it must
//! (`avendb_net::Options::direct`); its TLS is aws-lc-rs, X25519MLKEM768 only; and it keeps what it holds on a shelf
//! in a folder on disk (`avendb_net::disk`), not in the web view's store.
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
//! While the device starts (`found`, `link`, `open`), the page asks `steps` for each step of its start so far,
//! with how long it took (`avendb_browser::steps_json`), and shows them as they happen.
//!
//! The app may host the device in its own process instead (`host`): the same calls, each answered as its line would
//! be but with no id around it (`Host::call`), the sheets to show as they come (`Lines`), each answered as its line
//! would be (`Host::answer`), and the open device's node at hand (`Host::node`), so the app's own Rust reads a file's
//! bytes by range and posts its jobs with no JSON and no base64. `serve` is that host behind lines on a pipe: the
//! sidecar and the app's own process run the device one way.
//!
//! The passkey's ceremonies run in the sign-in sheet as the page's do (vault/app/src/passkey.rs,
//! src/routes/app/avendb/sheet/): for each, the device makes an X-Wing key of its own (`keys::Secret`), names it in the
//! sheet's URL, and opens what the sheet's page sealed to it (`keys::open_once`), so nothing crosses the app open.
//!
//! The device keeps no secret. Its folder is its one truth: the shelf in use there holds what it holds and what opens
//! it again (`avendb_browser::Meta`: its name, its relay, its salt's own bytes, its secret masked by the PRF output on
//! its salt, which only its passkey computes again, and its passkey's credential and P-256 key; the vaults it follows,
//! and the query limit the person set in Settings, how deep its queries read, `set_limits`), laid out as a page's
//! shelf in OPFS is; its keys come back at every unlock. A shelf no device opens any more, as one forgotten here, is
//! put aside in the folder, a new generation made beside it (`avendb_net::disk::aside`), and never deleted: avenDB is
//! never reset, and nothing the device finds in its folder beside its shelves is removed (`avendb_net::shelf::FLOOR`).
//!
//! Each external drive the person uses for avenDB is a device of their vault of its own, which the Mac's device hosts
//! as a second node while the drive is plugged in (`drive`): the page lists the volumes and the drives (`drives`), uses
//! a drive for avenDB in one ceremony (`joinDrive`), opens one that another Mac of theirs joined in one more
//! (`openDrive`), and ejects one, its node stopped first, so that Finder never finds it in use (`ejectDrive`).
//!
//! Each studio worker, a machine that works on a vault's media for the studio's jobs, is a device vault of its own,
//! owned by the vault whose media it works on, with a key of its own and only the shares that vault gives it, which
//! the Mac's device hosts as a second node as it hosts a drive (`worker`): the studio adds one in one ceremony at most
//! (`addWorker`), lists those hosted here (`workers`), runs an op as one by naming its device (`run [op, node]`), and
//! its own Rust takes one's node (`Host::node_of`) to read a file by range and post its jobs by the worker's own
//! rights, never the Mac's.

pub mod agent;
pub mod drive;
pub mod worker;

use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::engine;
use avendb::id::SignerId;
use avendb::keys;
use avendb::sign::{self, Assertion, Ceremony};
use avendb_browser::{Device, Fresh, Meta, Start, Unlock, steps_json};
use avendb_net::{Authenticator, Ending, NoBytes, NoCeremony, Node, Offer, Place, Progress, Shelf, Step, disk};
use bytes::Bytes;
use data_encoding::{BASE64, BASE64URL_NOPAD};
use iroh::RelayUrl;
use n0_future::stream;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt as _, AsyncRead, AsyncWrite, AsyncWriteExt as _, BufReader};
use tokio::sync::{mpsc, oneshot, watch};
use zeroize::Zeroizing;

/// The page the sign-in sheet shows for a ceremony: maia.city's, whose passkeys these are.
pub const SHEET: &str = "https://maia.city/app/avendb/sheet/";

/// The longest a call waits for the device to change (`changed`): then it answers `null`, and the page asks again.
const CHANGED: Duration = Duration::from_secs(50);

/// How the device runs: the folder it keeps its account in, on its shelves (`avendb_net::disk`), whether its node
/// reaches its peers directly too (`avendb_net::Options::direct`), as the app's does, where a test's may run on its
/// relay alone; and the folder the system mounts volumes in, whose drives it hosts (`drive`): `/Volumes` on a Mac
/// (`drive::VOLUMES`), a folder of its own in a test, none where it hosts no drive.
pub struct Config {
    pub dir: PathBuf,
    pub direct: bool,
    pub volumes: Option<PathBuf>,
}

/// Runs the device for the app until `input` ends, the app gone: each line of `input` a call or a sheet's answer, each
/// line of `output` an answer or a sheet to show. Then it closes the device. Fails if the folder's shelf can't be
/// opened. It is the host the app may run in its own process (`host`), behind lines: a call's answer is its host's
/// (`Host::call`) with the call's id first, and a sheet is a line as it comes (`Lines`).
pub async fn serve(
    config: Config,
    input: impl AsyncRead + Unpin,
    mut output: impl AsyncWrite + Unpin + Send + 'static,
) -> Result<()> {
    let (host, mut asks) = host(config)?;
    let (answers, mut answered) = mpsc::unbounded_channel::<Value>();
    tokio::spawn(async move {
        loop {
            // what the device asks first, so that a sheet a call asked for goes out before the call's answer
            let line = tokio::select! {
                biased;
                Some(line) = asks.recv() => line,
                Some(line) = answered.recv() => line,
                else => break,
            };
            let line = format!("{line}\n");
            if output.write_all(line.as_bytes()).await.is_err() || output.flush().await.is_err() {
                break;
            }
        }
    });
    let mut lines = BufReader::new(input).lines();
    while let Some(line) = lines.next_line().await? {
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            tracing::warn!("a line from the app that isn't JSON");
            continue;
        };
        if message.get("sheet").is_some_and(Value::is_u64) {
            host.answer(&message);
        } else if let Some(id) = message.get("id").and_then(Value::as_u64) {
            let call = message.get("call").and_then(Value::as_str).unwrap_or_default().to_string();
            let args = message.get("args").and_then(Value::as_array).cloned().unwrap_or_default();
            let (host, answers) = (host.clone(), answers.clone());
            tokio::spawn(async move {
                let mut line = serde_json::Map::from_iter([("id".to_string(), Value::from(id))]);
                if let Value::Object(answer) = host.call(&call, args).await {
                    line.extend(answer);
                }
                let _ = answers.send(Value::Object(line));
            });
        }
    }
    host.close().await;
    Ok(())
}

/// The device, hosted in the app's own process, on the shelf in use in `config`'s folder, as `serve` runs it behind
/// lines: the host the app calls (`Host`), and the lines the device sends the app unprompted (`Lines`). Fails if the
/// folder's shelf can't be opened, or if it isn't called on a tokio runtime.
///
/// It runs on the tokio runtime it is called on. avendb-device's own `main` sets its process up for it; an app that
/// hosts it in its own:
///
/// - calls it on a runtime whose threads have 8 MiB stacks, as `main` builds its own: a Classic McEliece key pair's
///   public matrix, over a megabyte, is made on the stack. Every call runs on that runtime (`Host::call`), whichever
///   runtime asks;
/// - installs its own default TLS provider (rustls's `CryptoProvider::install_default`) before anything of its own
///   speaks TLS, if anything does: the host installs none, where `main` installs avenDB's, and needs none, as avenDB's
///   endpoint names its own, X25519MLKEM768 only (`avendb_net::pq_provider`);
/// - starts no second tracing subscriber for it: the device logs through `tracing`, into the app's own.
pub fn host(config: Config) -> Result<(Host, Lines)> {
    let runtime = tokio::runtime::Handle::try_current().context("avenDB's device is hosted on a tokio runtime")?;
    let (out, asks) = mpsc::unbounded_channel();
    let shelf = Mutex::new(disk::open(&config.dir)?);
    let service = Arc::new(Service {
        config,
        shelf,
        out,
        sheets: Mutex::default(),
        next: AtomicU64::new(1),
        device: Mutex::default(),
        life: tokio::sync::Mutex::default(),
        progress: Mutex::default(),
        files: Mutex::default(),
        drives: drive::Drives::default(),
        workers: worker::Workers::default(),
    });
    Ok((Host { service, runtime }, asks))
}

/// The lines the device sends the app unprompted (`host`), in order, each as `serve` writes it: for now, each a sheet
/// to show, `{"sheet": n, "url": url}`, for the app to answer (`Host::answer`). They end once the host, every clone of
/// it, and every call under way are gone.
pub type Lines = mpsc::UnboundedReceiver<Value>;

/// avenDB's device hosted in the app's own process (`host`): cheap to clone, each clone the same device.
#[derive(Clone)]
pub struct Host {
    service: Arc<Service>,
    /// The runtime it was hosted on, where every call runs.
    runtime: tokio::runtime::Handle,
}

impl Host {
    /// Answers `call` with `args`, as `serve` answers the line `{"id", "call", "args"}`: its answer, that line's answer
    /// with no `id`, `{"ok": value}`, or `{"error": why}`. It runs in a task of its own on the host's runtime, so that
    /// even a panic gets its answer, and goes on if the caller stops waiting for it. The sheets its ceremonies ask for
    /// meanwhile come on the host's `Lines`, and it waits until each is answered (`answer`).
    pub async fn call(&self, call: &str, args: Vec<Value>) -> Value {
        let (service, call) = (self.service.clone(), call.to_string());
        let done = self.runtime.spawn(async move { service.call(&call, Args(&args)).await }).await;
        match done {
            Ok(Ok(value)) => json!({ "ok": value }),
            Ok(Err(e)) => json!({ "error": format!("{e:#}") }),
            Err(e) => json!({ "error": format!("the device failed: {e}") }),
        }
    }

    /// The app's answer to a sheet, as `serve` reads its line: `{"sheet": n, "back": url}`, the URL the sheet's page
    /// sent back, or `{"sheet": n, "error": why}`. One that names no sheet awaited is let go.
    pub fn answer(&self, message: &Value) {
        if let Some(n) = message.get("sheet").and_then(Value::as_u64) {
            self.service.answered(n, message);
        }
    }

    /// The open device's node, for the app's own Rust to read a file's bytes by range (`Node::read_file`) and post its
    /// jobs (`Node::jobs`) with no JSON between: none until a call opens the device (`found`, `link`, `open`), and none
    /// once it is forgotten or closed.
    pub fn node(&self) -> Option<OpenNode> {
        self.service.device.lock().expect("the device").clone().map(|d| OpenNode(Held::Device(d)))
    }

    /// The node of the studio worker whose device is `device`, which this Mac hosts (`worker`), for the studio's own
    /// Rust to read a file by range and post its jobs as that worker, by its own key and its shares alone, never the
    /// Mac's: as `node` hands the Mac's own, and as the call `run [op, node]` runs an op on it. None for a device this
    /// Mac hosts no worker of, the Mac's own among them, and none once the worker is taken out of its vault or the
    /// Mac's device is forgotten or closed.
    pub fn node_of(&self, device: SignerId) -> Option<OpenNode> {
        self.service.workers.node(device).map(|n| OpenNode(Held::Worker(n)))
    }

    /// What `serve` does as its input ends, the app gone: the drives and the workers it hosts stop, the device closes,
    /// its shelf holding what it holds, and every sheet still awaited ends. The app closes it before it quits.
    pub async fn close(&self) {
        let service = self.service.clone();
        if let Err(e) = self.runtime.spawn(async move { service.close().await }).await {
            tracing::warn!("closing the device failed: {e}");
        }
    }
}

/// The node of the device open in a host (`Host::node`), or of a studio worker it hosts (`Host::node_of`): it derefs
/// to the node (`avendb_net::Node`), and keeps the device or the worker it is the node of while it is held. Once the
/// host closes the device, or forgets it, the node is shut down; a worker's too once it is taken out of its vault.
#[derive(Clone)]
pub struct OpenNode(Held);

/// What an open node keeps: the Mac's own device, or a worker's node.
#[derive(Clone)]
enum Held {
    Device(Arc<Device>),
    Worker(Arc<Node>),
}

impl std::ops::Deref for OpenNode {
    type Target = Node;

    fn deref(&self) -> &Node {
        match &self.0 {
            Held::Device(d) => d.node(),
            Held::Worker(node) => node,
        }
    }
}

/// The device and what it waits on.
struct Service {
    config: Config,
    /// The shelf in use in its folder.
    shelf: Mutex<Shelf>,
    /// The lines the device sends the app unprompted, in order (`Lines`).
    out: mpsc::UnboundedSender<Value>,
    /// The sheets the app shows, each awaited by the ceremony that asked for it.
    sheets: Mutex<HashMap<u64, oneshot::Sender<Result<String, String>>>>,
    next: AtomicU64,
    /// The device, once open.
    device: Mutex<Option<Arc<Device>>>,
    /// One start at a time: founding, linking, opening or forgetting the device.
    life: tokio::sync::Mutex<()>,
    /// The steps of the start under way, or of the last, for the page to show (`steps`).
    progress: Mutex<Option<Progress>>,
    /// The files on their way in from the page (`fileStart`), by number.
    files: Mutex<HashMap<u64, Incoming>>,
    /// The drives it hosts, and the volumes it looks at (`drive`).
    drives: drive::Drives,
    /// The studio workers it hosts (`worker`).
    workers: worker::Workers,
}

/// A file on its way in from the page, a chunk at a time (`fileChunk`), into the device's blob store and the write that
/// brings it: a `put_file` op, or a `create` with a `file` (`Device::run`, `avendb::engine::brings`).
struct Incoming {
    /// The chunks of the pass under way, for its stream; none between two passes.
    chunks: Option<mpsc::Sender<io::Result<Bytes>>>,
    /// How many of its bytes the page handed over so far in this pass.
    at: u64,
    /// Each pass's chunks, as the device opens the file again (`avendb_net::Source`); the first one from the start.
    passes: mpsc::UnboundedSender<mpsc::Receiver<io::Result<Bytes>>>,
    /// How many passes the device opened, `DONE` once the op answered.
    opened: watch::Receiver<u8>,
    /// How many passes the page started.
    given: u8,
    /// The op's answer, once the file is in.
    answer: tokio::task::JoinHandle<Result<Value>>,
}

/// What `Incoming::opened` reads once the op answered: no pass more.
const DONE: u8 = u8::MAX;

/// A pass of a file's bytes, as the device reads it (`Service::file_start`).
type Pass = std::pin::Pin<Box<dyn n0_future::Stream<Item = io::Result<Bytes>> + Send>>;

impl Service {
    /// Sends the app line `message` unprompted (`Lines`).
    fn send(&self, message: Value) {
        let _ = self.out.send(message);
    }

    async fn call(self: &Arc<Self>, call: &str, a: Args<'_>) -> Result<Value> {
        tracing::debug!("call {call}");
        match call {
            "status" => self.status().await,
            "steps" => Ok(self.steps()),
            "found" => self.found(a.text(0)?, a.text(1)?, a.text(2)?, a.get(3).as_bool().unwrap_or(true)).await,
            "link" => self.link(a.text(0)?, a.text(1)?, a.text(2)?).await,
            "open" => self.open().await,
            "forget" => self.forget().await.map(|()| Value::Null),
            "rename" => self.rename(a.text(0)?).await.map(Value::from),
            "qrSvg" => qr_svg(&a.text(0)?, u32::try_from(a.count(1)?)?).map(Value::from),
            _ => self.on_device(call, a).await,
        }
    }

    /// A call on the open device, as the page's device answers it: `run` an op (`Device::run`), its answer as the
    /// page's device gives it, a `read_file`'s bytes beside in base64 (`bytes`); a change its vault's owners approve
    /// signed in the passkey's ceremony in the sheet (`approver`). The bytes of a `put_file` op, or of a `create` that
    /// brings a file (`file`), come a chunk at a time: `fileStart [op]` a file's number, `fileChunk [n, at, base64]`
    /// each chunk in order, `fileAgain [n]` once every chunk is in, whether the device reads the file again (once for
    /// its key, once to seal it: the page then hands every chunk over again, from 0), `fileEnd [n]` the op's answer,
    /// `fileDrop [n]` none, the file dropped.
    /// `agents` the access requests the agent devices on this Mac left, `grant [name, device, shares, avenName]` one of
    /// them granted, the agent added under the person's one aven unless it is there already, the aven founded and named
    /// `avenName` if their vault owns none yet, and each of `shares` `{over, level}` a share the aven passes on to it
    /// (`grant`), `deny [name, device]` one denied (`agent`), and `agentCommand [harness?]` the command that runs a
    /// harness's agent device, Claude Code's unless named, and for Claude Code the line that adds it.
    /// `drives` the volumes plugged in and the drives joined here, `joinDrive [volume, name]` a drive used for avenDB as
    /// a device of the person's vault, `openDrive [volume]` one another Mac of theirs joined, opened here, and
    /// `ejectDrive [volume]` one hosted here, its node stopped and the volume ejected (`drive`).
    /// `addWorker [vault, name, shares]` a studio worker added for vault `vault`, the person's or one it owns, named
    /// `name`, and given each of `shares`, `{name, where, ops}` and `over` for one over another vault, in one ceremony
    /// at most, `{device, name, vault, for}`; `workers` those whose keys this Mac keeps, each `{device, name, vault,
    /// for, hosted}`; and `run [op, node]` op `op` run on the node of the worker whose device `node` names, as that
    /// worker, with no ceremony at hand (`worker`).
    async fn on_device(self: &Arc<Self>, call: &str, a: Args<'_>) -> Result<Value> {
        let d = self.device()?;
        let number = |i: usize| a.get(i).as_u64().with_context(|| format!("argument {} is a file's number", i + 1));
        Ok(match call {
            "size" => {
                let (edits, keys) = d.node().read(|lab, me| lab.size(me)).await;
                json!([edits, keys])
            }
            "changed" => {
                let held = (a.count(0)?, a.count(1)?);
                tokio::time::timeout(CHANGED, d.changed(held)).await.map_or(Value::Null, Value::from)
            }
            "run" => {
                let op = a.get(0).clone();
                let (mut answer, bytes) = match a.get(1) {
                    Value::Null => {
                        let asks = engine::reads(&op) || engine::asks(&op);
                        let approver = if asks { None } else { Some(self.approver().await?) };
                        d.run(op, None::<NoBytes>, approver.as_ref()).await?
                    }
                    node => self.run_on_worker(node, op).await?,
                };
                if let (Some(bytes), Some(out)) = (bytes, answer.as_object_mut()) {
                    out.insert("bytes".to_string(), BASE64.encode(&bytes).into());
                }
                answer
            }
            "fileStart" => self.file_start(&d, a.get(0).clone()).into(),
            "fileChunk" => {
                let at = a.get(1).as_u64().context("argument 2 is where the chunk starts")?;
                let chunk = BASE64.decode(a.text(2)?.as_bytes()).context("a chunk in base64")?;
                self.file_chunk(number(0)?, at, chunk).await?;
                Value::Null
            }
            "fileAgain" => self.file_again(number(0)?).await?.into(),
            "agents" => self.agents(&d).await,
            "agentCommand" => {
                let harness = a.get(0).as_str().unwrap_or(agent::CLAUDE);
                agent::named(harness)?;
                agent::command(&std::env::current_exe()?, &self.config.dir, harness)
            }
            "drives" => self.drives().await?,
            "joinDrive" => self.join_drive(&a.text(0)?, a.get(1).as_str().unwrap_or_default()).await?,
            "openDrive" => self.open_drive(&a.text(0)?).await?,
            "ejectDrive" => self.eject_drive(&a.text(0)?).await?,
            "workers" => self.workers().await?,
            "addWorker" => {
                let shares = a.get(2).as_array().cloned().unwrap_or_default();
                self.add_worker(&d, &a.text(0)?, &a.text(1)?, &shares).await?
            }
            "grant" => {
                let shares = a.get(2).as_array().cloned().unwrap_or_default();
                self.grant(&d, &a.text(0)?, &a.text(1)?, &shares, a.get(3).as_str()).await?
            }
            "deny" => {
                self.deny(&a.text(0)?, &a.text(1)?)?;
                Value::Null
            }
            "fileEnd" => {
                let incoming = self.files.lock().expect("the files").remove(&number(0)?);
                let Incoming { chunks, answer, .. } = incoming.context("no such file on its way in")?;
                drop(chunks);
                answer.await.context("bringing the file failed")??
            }
            "fileDrop" => {
                let incoming = self.files.lock().expect("the files").remove(&number(0)?);
                if let Some(Incoming { answer, .. }) = incoming {
                    answer.abort();
                }
                Value::Null
            }
            _ => bail!("no call {call:?}"),
        })
    }

    /// Whether the folder holds an account, what opens it, and the device if it is open.
    async fn status(&self) -> Result<Value> {
        let device = self.device.lock().expect("the device").clone();
        let meta = Meta::load(&self.shelf()).await?.map(|m| m.to_json());
        Ok(json!({ "meta": meta, "open": device.is_some(), "device": device.map(|d| info(&d)) }))
    }

    /// The first device of a new person (`Device::found`), in two ceremonies: the unlock, which is the passkey's pass
    /// for the new device, and one for the vault and the device in it, which also claims the server whose code reads
    /// `server` if nobody has; the server backs the vault up unless `backup` is false, and then only relays.
    async fn found(self: &Arc<Self>, name: String, relay: String, server: String, backup: bool) -> Result<Value> {
        let _life = self.life.lock().await;
        self.fresh().await?;
        let (start, _ending) = self.start(&name, &relay)?;
        let server = Offer::from_text(server.trim())?;
        let (sheets, nonce, new) = (Sheets::new(self.clone(), None), random()?, Fresh::new()?);
        start.progress.step("unlock");
        let unlock = sheets.unlock("unlock", nonce, new.challenge(start.now)).await?;
        let d = Device::found(start, &server, None, new, unlock, &sheets, backup).await?;
        self.started(d, nonce, sheets.credential()?).await
    }

    /// A new device of a person who has one already (`Device::link`), linked through the device or the server whose
    /// code reads `through`, in one ceremony: the unlock, which is the passkey's pass for the new device and signs the
    /// edit that adds it too.
    async fn link(self: &Arc<Self>, name: String, relay: String, through: String) -> Result<Value> {
        let _life = self.life.lock().await;
        self.fresh().await?;
        let (start, _ending) = self.start(&name, &relay)?;
        let through = Offer::from_text(through.trim())?;
        let (sheets, nonce, new) = (Sheets::new(self.clone(), None), random()?, Fresh::new()?);
        start.progress.step("unlock");
        let unlock = sheets.unlock("unlock", nonce, new.challenge(start.now)).await?;
        let d = Device::link(start, &through, new, unlock).await?;
        self.started(d, nonce, sheets.credential()?).await
    }

    /// The device the folder holds, opened again from its shelf in the unlock's ceremony alone (`Device::open`): or
    /// the device already open.
    async fn open(self: &Arc<Self>) -> Result<Value> {
        let _life = self.life.lock().await;
        if let Some(d) = self.device.lock().expect("the device").clone() {
            return Ok(info(&d));
        }
        let meta = Meta::load(&self.shelf()).await?.context("this Mac holds no avenDB account yet")?;
        let (start, _ending) = self.start(&meta.name, &meta.relay)?;
        let sheets = Sheets::new(self.clone(), Some(meta.credential.clone()));
        start.progress.step("unlock");
        let unlock = sheets.unlock("unlock", meta.nonce, random()?).await?;
        let d = Device::open(start, &meta, unlock).await?;
        Ok(self.opened(d))
    }

    /// Forgets the account here: closes the device, and puts its shelf, with what opens it, aside (`aside`).
    async fn forget(&self) -> Result<()> {
        let _life = self.life.lock().await;
        self.drives.stop().await;
        self.workers.stop().await;
        let d = self.device.lock().expect("the device").take();
        if let Some(d) = d {
            d.close().await.ok();
        }
        self.aside()
    }

    /// The device's name reads `name`: kept to open it again, and on its card (`Device::rename`). Whether its card
    /// changed.
    async fn rename(&self, name: String) -> Result<bool> {
        self.device()?.rename(name).await
    }

    /// The app went away: the drives and the workers it hosts stop, the device closes, and every sheet still awaited
    /// ends.
    async fn close(&self) {
        self.drives.stop().await;
        self.workers.stop().await;
        let d = self.device.lock().expect("the device").take();
        if let Some(d) = d {
            d.close().await.ok();
        }
        self.sheets.lock().expect("the sheets").clear();
    }

    /// Op `op` that brings a file under way, a `put_file` or a `create` with a `file` (`Device::run`), its file's
    /// chunks still to come in order (`fileChunk`), then its end (`fileEnd`), which answers the op: the file's number.
    fn file_start(&self, d: &Arc<Device>, op: Value) -> u64 {
        let (chunks, first) = mpsc::channel(2);
        let (passes, waiting) = mpsc::unbounded_channel();
        passes.send(first).expect("its first pass");
        let (open, opened) = watch::channel(0u8);
        let (open, waiting) = (Arc::new(open), Arc::new(tokio::sync::Mutex::new(waiting)));
        // each time the device opens the file, the next pass the page hands over
        let source = {
            let open = open.clone();
            move || -> Pass {
                open.send_modify(|n| *n = n.saturating_add(1).min(DONE - 1));
                let waiting = waiting.clone();
                Box::pin(stream::unfold(None, move |pass: Option<mpsc::Receiver<io::Result<Bytes>>>| {
                    let waiting = waiting.clone();
                    async move {
                        let mut pass = match pass {
                            Some(pass) => pass,
                            None => waiting.lock().await.recv().await?,
                        };
                        let chunk = pass.recv().await?;
                        Some((chunk, Some(pass)))
                    }
                }))
            }
        };
        let d = d.clone();
        let answer = tokio::spawn(async move {
            let answer = d.run(op, Some(source), None::<&NoCeremony>).await;
            open.send_replace(DONE);
            Ok(answer?.0)
        });
        let n = self.next.fetch_add(1, Ordering::Relaxed);
        let incoming = Incoming { chunks: Some(chunks), at: 0, passes, opened, given: 1, answer };
        self.files.lock().expect("the files").insert(n, incoming);
        n
    }

    /// The bytes of file `n` from `at` on (`fileStart`), handed over once the chunks before them are.
    async fn file_chunk(&self, n: u64, at: u64, chunk: Vec<u8>) -> Result<()> {
        let chunks = {
            let mut files = self.files.lock().expect("the files");
            let incoming = files.get_mut(&n).context("no such file on its way in")?;
            if incoming.at != at {
                bail!("the file's bytes from {at} on came before those from {}", incoming.at);
            }
            incoming.at += chunk.len() as u64;
            incoming.chunks.clone().context("the file's pass is over: ask fileAgain")?
        };
        chunks.send(Ok(Bytes::from(chunk))).await.map_err(|_| anyhow!("the file is no longer coming in"))
    }

    /// File `n`'s pass is over (`fileStart`): whether the device reads it again, so that the page hands every chunk
    /// over once more, from 0; else the op answers (`fileEnd`).
    async fn file_again(&self, n: u64) -> Result<bool> {
        let (mut opened, given) = {
            let mut files = self.files.lock().expect("the files");
            let incoming = files.get_mut(&n).context("no such file on its way in")?;
            incoming.chunks = None;
            (incoming.opened.clone(), incoming.given)
        };
        let now = *opened.wait_for(|&o| o > given).await.map_err(|_| anyhow!("the file is no longer coming in"))?;
        if now == DONE {
            return Ok(false);
        }
        let mut files = self.files.lock().expect("the files");
        let incoming = files.get_mut(&n).context("no such file on its way in")?;
        let (chunks, pass) = mpsc::channel(2);
        incoming.passes.send(pass).map_err(|_| anyhow!("the file is no longer coming in"))?;
        (incoming.chunks, incoming.at, incoming.given) = (Some(chunks), 0, given + 1);
        Ok(true)
    }

    fn device(&self) -> Result<Arc<Device>> {
        self.device.lock().expect("the device").clone().context("avenDB isn't open here: unlock it first")
    }

    /// Where a device starts here: named `name`, through the relay at `relay`, with the machine's randomness, now; on
    /// the shelf in use in the folder; its steps for the page to show (`steps`), the start marked over as the guard
    /// drops.
    fn start(&self, name: &str, relay: &str) -> Result<(Start, Ending)> {
        let progress = Progress::new();
        let ending = progress.ending();
        *self.progress.lock().expect("the steps") = Some(progress.clone());
        let relay: RelayUrl = relay.trim().parse().map_err(|_| anyhow!("the relay's URL isn't one"))?;
        let mut entropy = Zeroizing::new([0; 32]);
        getrandom::fill(&mut *entropy).map_err(|e| anyhow!("no randomness: {e}"))?;
        let (name, shelf, direct) = (name.trim().to_string(), Some(self.shelf()), self.config.direct);
        let (entropy, recovery) = (*entropy, Start::recovery());
        Ok((Start { name, relay, entropy, now: now(), direct, shelf, progress, recovery }, ending))
    }

    /// The steps of the start under way, or of the last (`avendb_browser::steps_json`): null before the first.
    fn steps(&self) -> Value {
        let progress = self.progress.lock().expect("the steps");
        progress.as_ref().map_or(Value::Null, |p| steps_json(&p.steps()))
    }

    /// The shelf in use in the folder.
    fn shelf(&self) -> Shelf {
        self.shelf.lock().expect("the shelf").clone()
    }

    /// Ready for a new device: none open and none to open in the folder. A shelf there that holds anything without what
    /// opens it, as a start cut short leaves, is put aside (`aside`).
    async fn fresh(&self) -> Result<()> {
        let (shelf, open) = (self.shelf(), self.device.lock().expect("the device").is_some());
        if open || Meta::load(&shelf).await?.is_some() {
            bail!("this Mac holds an avenDB account already: forget it here first");
        }
        if !shelf.names("").await?.is_empty() {
            self.aside()?;
        }
        Ok(())
    }

    /// Device `d`, new here, runs from here on; its shelf keeps what opens it again (`Device::meta`), with its salt's
    /// own bytes `nonce` and its passkey's credential.
    async fn started(self: &Arc<Self>, d: Device, nonce: [u8; 32], credential: String) -> Result<Value> {
        let meta = d.meta(nonce, credential);
        let info = self.opened(d);
        self.device()?.keep(&meta).await?;
        Ok(info)
    }

    /// Device `d` runs from here on, and hosts the person's drives plugged into this Mac (`drive`) and the studio
    /// workers whose keys it keeps (`worker`).
    fn opened(self: &Arc<Self>, d: Device) -> Value {
        let d = Arc::new(d);
        *self.device.lock().expect("the device") = Some(d.clone());
        self.leave_offer(&d);
        self.watch_drives();
        self.watch_workers();
        info(&d)
    }

    /// Device `d`'s offer, left for the agents on this Mac where one ever started (`agent`), as it is now.
    fn leave_offer(&self, d: &Device) {
        let (file, offer) = (agent::host_offer(&self.config.dir), d.node().offer().to_text());
        let left = std::fs::read_to_string(&file).is_ok_and(|now| now == offer);
        if !left
            && agent::agents(&self.config.dir).is_dir()
            && let Err(e) = std::fs::write(&file, offer)
        {
            tracing::warn!("the offer for this Mac's agents isn't written: {e}");
        }
    }

    /// The access requests the agents on this Mac left (`agent::asking`), each as it asks: its name, its kind, its
    /// device, its offer while it belongs to no vault, the level it asks for, why, and the vaults it names, and whether
    /// it runs now (`online`); this device's own offer left for them as it is now. A request whose device is in a vault
    /// already, by this device's view, its join hadn't reached when it asked: it is taken away, as the agent asks as a
    /// record from then on (`grant`), and the join reaches it from this device (`agent`).
    async fn agents(&self, d: &Device) -> Value {
        self.leave_offer(d);
        let dir = agent::agents(&self.config.dir);
        let mut asking = vec![];
        for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let path = entry.path();
            let name = path.file_stem().and_then(|n| n.to_str()).filter(|n| agent::named(n).is_ok());
            let (Some(name), true) = (name, path.extension().is_some_and(|x| x == "request")) else {
                continue;
            };
            if let Some(asked) = self.request(name) {
                asking.push((name.to_string(), asked));
            }
        }
        let devices: Vec<Option<SignerId>> =
            asking.iter().map(|(_, asked)| asked["device"].as_str().and_then(SignerId::from_hex)).collect();
        let joined = d.node().read(move |lab, me| {
            let st = lab.state(me);
            let member = |d: SignerId| st.vaults().iter().any(|v| v.devices.contains(&d));
            devices.into_iter().map(|d| d.is_some_and(member)).collect::<Vec<bool>>()
        });
        let joined = joined.await;
        let mut open = vec![];
        for ((name, asked), joined) in asking.into_iter().zip(joined) {
            if joined {
                std::fs::remove_file(agent::request(&self.config.dir, &name)).ok();
            } else {
                open.push(asked);
            }
        }
        Value::Array(open)
    }

    /// Agent device `name`'s access request as it left it, checked: its device's key, its offer if any naming that
    /// device, a level of `agent::LEVELS`, why in at most 500 characters, and the vaults it names; or none.
    fn request(&self, name: &str) -> Option<Value> {
        let text = std::fs::read_to_string(agent::request(&self.config.dir, name)).ok()?;
        let asked: Value = serde_json::from_str(&text).ok()?;
        let device = asked["device"].as_str().filter(|d| d.len() == 64 && d.bytes().all(|b| b.is_ascii_hexdigit()))?;
        let offer = match &asked["offer"] {
            Value::String(o) => Some(Offer::from_text(o).ok().filter(|o| hex(&o.device.0) == device)?.to_text()),
            _ => None,
        };
        let level = asked["level"].as_str().filter(|l| agent::LEVELS.contains(l))?.to_string();
        let why: String = asked["why"].as_str().unwrap_or_default().chars().take(500).collect();
        let vaults: Vec<String> =
            asked["vaults"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect();
        let mut asking = agent::asking(name, device, offer, &agent::Asking { level, why, vaults });
        // whether it runs now, to cosign its being added under the aven
        asking["online"] = agent::online(&self.config.dir, name, device).into();
        Some(asking)
    }

    /// Grants agent device `name`'s access request (`agents`), the one its device `device` left. The agent's key joins
    /// its coop's one aven, avenMAIA, which Maia City owns and the seed founded (`agent::aven_of`), as a device of it
    /// beside its server, in one ceremony of their passkey in the sheet, which the agent's device cosigns
    /// (`Node::add_device_vault_with` at `Place::Vault`): from then on it acts as avenMAIA, with avenMAIA's rights, no
    /// more and no less (Samuel 2026-10-18: no agent vaults under an aven, no sub caps; by default a Suggester on Maia
    /// City). One already a device of it, as the same harness asking again, is granted at once. `shares` and
    /// `aven_name` name nothing any more. `{aven, vault}`: the aven both, as the agent acts as the aven itself.
    async fn grant(
        self: &Arc<Self>,
        d: &Arc<Device>,
        name: &str,
        device: &str,
        shares: &[Value],
        _aven_name: Option<&str>,
    ) -> Result<Value> {
        agent::named(name)?;
        let _ = (shares, _aven_name);
        let asked = self.request(name).filter(|a| a["device"] == device);
        let agent = SignerId::from_hex(device).context("a device's key in hex")?;
        let mine = d.vault().await.context("this Mac belongs to no vault")?;
        let found = d.node().read(move |lab, me| {
            let aven = agent::aven_of(lab.state(me), mine);
            (aven, aven.is_some_and(|aven| lab.state(me).is_device(agent, aven)))
        });
        // its coop's one aven, avenMAIA, founded with the seed: the agent's key joins it as a device, next to its
        // server, and acts as it with its rights, no more and no less (Samuel 2026-10-18)
        let (aven, joined) = found.await;
        let Some(aven) = aven else { bail!("your coop has no aven yet: {name} joins its coop's aven, avenMAIA") };
        if !joined {
            // the agent's own device cosigns its being added: say so rather than wait for it in vain
            let asked = asked.context("no such request: it changed")?;
            let offline = "isn't running: open a Claude Code session (or its harness), then approve";
            anyhow::ensure!(asked["online"] == true, "{name} {offline}");
            let offer = asked["offer"].as_str().context("its device is another vault's: it can't join")?;
            let (offer, approver) = (Offer::from_text(offer)?, self.approver().await?);
            d.node().add_device_vault_with(&offer, Place::Vault(aven), d.passkey(), &approver).await?;
        }
        std::fs::remove_file(agent::request(&self.config.dir, name)).ok();
        Ok(json!({ "aven": hex(&aven.0), "vault": hex(&aven.0) }))
    }

    /// Denies agent `name`'s access request, the one its device `device` left: it is taken away, and the no left for
    /// the agent, which asks no more until it asks again (`agent`).
    fn deny(&self, name: &str, device: &str) -> Result<()> {
        agent::named(name)?;
        self.request(name).filter(|a| a["device"] == device).context("no such request: it changed")?;
        std::fs::write(agent::denied(&self.config.dir, name), device)?;
        std::fs::remove_file(agent::request(&self.config.dir, name))?;
        Ok(())
    }

    /// Puts the shelf in use aside, never deleting it, and puts a new one in use, empty (`avendb_net::disk::aside`).
    fn aside(&self) -> Result<()> {
        disk::aside(&self.config.dir)?;
        *self.shelf.lock().expect("the shelf") = disk::open(&self.config.dir)?;
        Ok(())
    }

    /// The passkey's ceremonies for what its vault approves (new vaults, an owner share, its revocation): in the
    /// sheet, with the passkey that opened the device.
    async fn approver(self: &Arc<Self>) -> Result<Sheets> {
        let meta = Meta::load(&self.shelf()).await?.context("this Mac holds no avenDB account")?;
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

    /// The ceremony for `what` that unlocks the device whose salt ends in `nonce` (`sign::device_salt`), over
    /// `challenge`: a new device's, which makes the unlock its passkey's pass for it
    /// (`avendb_browser::Fresh::challenge`), or one of its own: this Mac's, or a drive's (`drive`).
    async fn unlock(&self, what: &str, nonce: [u8; 32], challenge: [u8; 32]) -> Result<Unlock> {
        let brought = self.ask(what, challenge, Some(&nonce)).await?;
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
