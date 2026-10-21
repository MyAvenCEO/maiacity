//! Agents as sessions (Samuel 2026-10-21, spec `AvenDB.Sessions`): an agent on its person's Mac runs no avenDB node of
//! its own. theOS's device hosts it (`Lab::host`), on a socket in the agents' folder (`socket`), and the agent's process
//! only relays its harness's MCP lines to it (`relay`) and signs what it is asked to, with its own key, which never
//! leaves it. So the Mac keeps one store, one copy of each log and one replay, however many agents work on it; each
//! agent still writes as its own key, a device of its coop's aven, with that aven's rights alone, and reads only what
//! its own key opens.
//!
//! The socket speaks JSON, a message a line. The host opens with a challenge, 32 random bytes; the agent answers with a
//! hello over it from each key it may be (`server::agent_keys`: its next key first, after a key move), each with the
//! key it is sealed to; the host takes the first that is a device of a vault it holds, else the first, as an agent not
//! approved yet, which asks for access through it and whose join it signs over the session once its person approves
//! (`Node::add_hosted_device`); never a device of its own. From then on the agent sends its harness's lines
//! (`{"mcp": line}`) and the host answers each (`{"mcp": answer}`), running it as the session (`Node::acting`); where
//! the session writes, the host asks the agent to sign the edit (`{"sign": id}`), and the agent answers
//! (`{"signed": signature, "id": id}`). The session ends with the connection.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::id::{BlobId, EditId, SignerId};
use avendb::keys::PublicKey;
use avendb::lab::Remote;
use avendb::sign::{DeviceKey, Hello, Signature, SignerKeys};
use avendb::wire::Wire;
use avendb_net::{Node, disk, server};
use n0_future::task::AbortOnDropHandle;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt as _, AsyncRead, AsyncWrite, AsyncWriteExt as _, BufReader};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc;

use crate::agent::{self, Agent};

/// How long the host waits for an agent to sign an edit, its Lab held: an agent signs at once, so one that doesn't is
/// gone.
const SIGNING: Duration = Duration::from_secs(10);

/// The socket theOS's device hosts its person's agents on, in the agents' folder beside its `host` folder.
pub fn socket(host: &Path) -> PathBuf {
    agent::agents(host).join("sessions.sock")
}

/// The sessions theOS's device hosts now, by a number of their own: what Settings lists (`list`).
pub type Hosted = Arc<Mutex<BTreeMap<u64, Live>>>;

/// A session hosted now: its harness's agent's name, its key, since when (Unix seconds), and the key it handed to seal
/// to, should it join its aven (`seal_of`).
pub struct Live {
    name: String,
    device: SignerId,
    since: u64,
    seal: Option<Seal>,
    /// its key and how it signs, for another session of the same key to sign by once this one ends
    keys: SignerKeys,
    sign: Remote,
}

/// What an agent's key is sealed to, as it handed it: the public key, and the McEliece key that names, whose id it
/// matches (`seal_in`).
pub type Seal = (PublicKey, Arc<[u8]>);

/// The key session `device`, hosted now, handed to seal to: what its join to its aven names (`Node::add_hosted_device`).
/// None where it isn't hosted now, or handed none.
pub fn seal_of(hosted: &Hosted, device: SignerId) -> Option<Seal> {
    let hosted = hosted.lock().expect("the sessions");
    hosted.values().find(|l| l.device == device).and_then(|l| l.seal.clone())
}

/// The key to seal to an agent's hello names, `{seal, mceliece}`, each in hex: the public key, and the McEliece key whose
/// id it names. None where it names none, or one that doesn't match.
fn seal_in(said: &Value) -> Option<Seal> {
    let key = PublicKey::from_wire(&unhex(said["seal"].as_str()?)?).ok()?;
    let mceliece: Arc<[u8]> = unhex(said["mceliece"].as_str()?)?.into();
    (BlobId::of(&mceliece) == key.mceliece).then_some((key, mceliece))
}

/// The sessions `hosted` holds now, each `{id, name, device, since}`, the oldest first.
pub fn list(hosted: &Hosted) -> Value {
    let hosted = hosted.lock().expect("the sessions");
    let rows = hosted.iter().map(|(id, l)| json!({ "id": id, "name": l.name, "device": hex(&l.device.0), "since": l.since }));
    Value::Array(rows.collect())
}

/// Hosts its person's agents on `node`, theOS's device, at the socket in the agents' folder beside its `host` folder,
/// each connection a session of its own, until the task is dropped.
pub async fn serve(node: Arc<Node>, host: PathBuf, hosted: Hosted) -> Result<()> {
    let sock = socket(&host);
    std::fs::create_dir_all(agent::agents(&host)).ok();
    // a socket left there is one of an app that ran before: this one hosts from now on
    std::fs::remove_file(&sock).ok();
    let listener = UnixListener::bind(&sock).with_context(|| format!("the agents' socket {}", sock.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&sock, std::fs::Permissions::from_mode(0o600)).ok();
    }
    let mut next = 0u64;
    loop {
        let (stream, _) = listener.accept().await?;
        let (node, host, hosted) = (node.clone(), host.clone(), hosted.clone());
        next += 1;
        let id = next;
        tokio::spawn(async move {
            if let Err(e) = session(stream, node, host, (id, hosted)).await {
                tracing::info!("avendb: an agent's session ended: {e:#}");
            }
        });
    }
}

/// The edits a session's agent was asked to sign, by their ids, each with where its signature goes.
type Pending = Arc<Mutex<HashMap<EditId, std::sync::mpsc::Sender<Option<Signature>>>>>;

/// One agent's session on `stream`, hosted by `node`: its hello, then its lines, until it goes.
async fn session(stream: UnixStream, node: Arc<Node>, host: PathBuf, (id, hosted): (u64, Hosted)) -> Result<()> {
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();
    let challenge = *server::random()?;
    send(&mut write, &json!({ "challenge": hex(&challenge) })).await?;
    let said: Value = serde_json::from_str(&lines.next_line().await?.context("the agent said no hello")?)?;
    let name = said["name"].as_str().unwrap_or_default().to_string();
    // a name the files beside it are named by: one of a folder elsewhere it never takes
    agent::named(&name)?;
    let roots: Vec<PathBuf> =
        said["roots"].as_array().into_iter().flatten().filter_map(|r| Some(PathBuf::from(r.as_str()?))).collect();
    let hellos = said["hellos"].as_array().cloned().unwrap_or_default();
    let seals = said["seals"].as_array().cloned().unwrap_or_default();
    let proven: Vec<(SignerId, SignerKeys, Option<Seal>)> = hellos
        .iter()
        .enumerate()
        .filter_map(|(i, h)| {
            let h = Hello::from_wire(&unhex(h.as_str()?)?).ok()?;
            let SignerKeys::Device { ed25519, .. } = &h.keys else {
                return None;
            };
            Some((h.verify(&challenge, true, ed25519)?, h.keys, seals.get(i).and_then(seal_in)))
        })
        .collect();
    // the first key that is a device of a vault the host holds, else the first it may ask for access by, which no vault
    // holds yet; never a device of its own Lab
    let candidates: Vec<(SignerId, SignerKeys, bool)> = proven.iter().map(|(s, k, _)| (*s, k.clone(), false)).collect();
    let chosen = node
        .read(move |lab, me| {
            let st = lab.state(me);
            let member = |s: &SignerId| st.vaults().iter().any(|v| v.devices.contains(s));
            let theirs = candidates.into_iter().filter(|(s, ..)| !lab.devices().contains(s));
            let theirs: Vec<_> = theirs.map(|(s, k, _)| (s, k, member(&s))).collect();
            let joined = theirs.iter().position(|(.., m)| *m);
            joined.or((!theirs.is_empty()).then_some(0)).map(|i| theirs[i].clone())
        })
        .await;
    let Some((s, keys, member)) = chosen else {
        send(&mut write, &json!({ "refused": "no key of the agent's is one this Mac may host" })).await?;
        bail!("{name}: no key it proved is one this Mac may host");
    };
    let seal = proven.into_iter().find(|(p, ..)| *p == s).and_then(|(.., seal)| seal);
    if !member {
        // it asks for access as it starts, until its person answers (`agent::ask_by_default`)
        agent::ask_by_default(&host, &name, &hex(&s.0));
    }
    // what it writes, it signs: the host asks it on the socket and waits, its Lab held, a moment at most
    let (out, mut outgoing) = mpsc::unbounded_channel::<Value>();
    let pending: Pending = Arc::default();
    let sign: Remote = {
        let (out, pending) = (out.clone(), pending.clone());
        Arc::new(move |id: EditId| {
            let (tx, rx) = std::sync::mpsc::channel();
            pending.lock().expect("the pending signatures").insert(id, tx);
            out.send(json!({ "sign": id.to_hex() })).ok()?;
            let signed = rx.recv_timeout(SIGNING).ok().flatten();
            pending.lock().expect("the pending signatures").remove(&id);
            signed.filter(|sig| sig.keys.id() == s)
        })
    };
    // listed before it is hosted, so that another session of its key that ends meanwhile leaves it hosted
    let since = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let live = Live { name: name.clone(), device: s, since, seal, keys, sign: sign.clone() };
    hosted.lock().expect("the sessions").insert(id, live);
    node.act(move |lab, me| lab.host(me, s, keys, sign)).await;
    let greeted = send(&mut write, &json!({ "hosted": hex(&s.0) })).await;
    tracing::info!("avendb: {name} {s:?} works as a session of this Mac's device");
    // that it runs, for the Mac's page, as an agent running its own device says it (`agent::online`)
    let alive_file = agent::alive(&host, &name, &hex(&s.0));
    let alive = {
        let (file, device) = (alive_file.clone(), hex(&s.0));
        AbortOnDropHandle::new(tokio::spawn(async move {
            loop {
                std::fs::write(&file, &device).ok();
                tokio::time::sleep(agent::LOOK).await;
            }
        }))
    };
    let writer = tokio::spawn(async move {
        while let Some(m) = outgoing.recv().await {
            if send(&mut write, &m).await.is_err() {
                break;
            }
        }
    });
    let agent = Agent::session(node.clone(), host, name.clone(), roots);
    let ended = async {
        while let Some(line) = lines.next_line().await? {
            let m: Value = serde_json::from_str(&line).unwrap_or_default();
            if let (Some(id), Some(sig)) = (m["id"].as_str(), m["signed"].as_str()) {
                let id = EditId::from_hex(id).ok_or_else(|| anyhow!("a signature for no edit's id"))?;
                let sig = unhex(sig).and_then(|b| Signature::from_wire(&b).ok());
                if let Some(tx) = pending.lock().expect("the pending signatures").remove(&id) {
                    tx.send(sig).ok();
                }
            } else if let Some(line) = m["mcp"].as_str() {
                // each line on its own, so that a write waiting on its signature doesn't hold up the next line, the
                // signature among them
                let (node, agent, out, line) = (node.clone(), agent.clone(), out.clone(), line.to_string());
                tokio::spawn(async move {
                    if let Some(answer) = node.acting(s, agent::answer_line(&agent, &line)).await {
                        out.send(json!({ "mcp": answer.trim_end() })).ok();
                    }
                });
            }
        }
        anyhow::Ok(())
    };
    let result = match greeted {
        Ok(()) => ended.await,
        Err(e) => Err(e),
    };
    // another session of the same key, as a second session of its harness, signs from now on; else it is forgotten
    let other = {
        let mut hosted = hosted.lock().expect("the sessions");
        hosted.remove(&id);
        hosted.values().find(|l| l.device == s).map(|l| (l.keys, l.sign.clone()))
    };
    node.act(move |lab, me| {
        lab.unhost(s);
        if let Some((keys, sign)) = other {
            lab.host(me, s, keys, sign);
        }
    })
    .await;
    writer.abort();
    drop(alive);
    // it no longer runs, unless another session of the same key still does, and says so again
    std::fs::remove_file(&alive_file).ok();
    tracing::info!("avendb: {name}'s session ended");
    result
}

/// How long an agent whose session theOS's device closed, as theOS restarts after an update, waits for it to host it
/// again, before it runs its own device.
const AGAIN: Duration = Duration::from_secs(60);

/// Relays harness `name`'s MCP lines on `input` and `output` to theOS's device on the socket beside the app's `host`
/// folder, its harness's files inside `roots` alone, signing with the key on the agent's own shelf what it is asked to
/// (`session`). `None` where nothing hosts it there, or the host refuses each of its keys, or it closed the session and
/// hosts it no more within `AGAIN`: the agent then says theOS doesn't run, until it does. Else when `input` ended.
pub async fn relay(
    host: &Path,
    name: &str,
    roots: &[PathBuf],
    input: &mut tokio::io::Lines<BufReader<impl AsyncRead + Unpin>>,
    output: &mut (impl AsyncWrite + Unpin),
) -> Result<Option<()>> {
    // where theOS runs, its keys, on its own shelf, a new one made where it has none yet
    if !socket(host).exists() {
        return Ok(None);
    }
    let shelf = disk::open(&agent::folder(host, name))?;
    let keys = server::agent_keys(&shelf).await?;
    anyhow::ensure!(!keys.is_empty(), "{name}'s shelf holds no key");
    let Some(mut hosted) = hosted_by(host, name, roots, &keys).await? else { return Ok(None) };
    tracing::info!("{name}: works as a session of theOS's device");
    loop {
        let (from, write, key) = &mut hosted;
        tokio::select! {
            line = input.next_line() => match line? {
                Some(line) => send(write, &json!({ "mcp": line })).await?,
                None => return Ok(Some(())),
            },
            m = from.next_line() => {
                let Some(m) = m.ok().flatten() else {
                    // theOS closed it, as it restarts: it hosts it again in a moment
                    tracing::info!("{name}: theOS's device closed its session; it waits for theOS to host it again");
                    let until = tokio::time::Instant::now() + AGAIN;
                    loop {
                        if let Some(again) = hosted_by(host, name, roots, &keys).await.ok().flatten() {
                            hosted = again;
                            break;
                        }
                        if tokio::time::Instant::now() >= until {
                            tracing::info!("{name}: theOS doesn't host it again");
                            return Ok(None);
                        }
                        tokio::time::sleep(Duration::from_millis(500)).await;
                    }
                    continue;
                };
                let m: Value = serde_json::from_str(&m)?;
                if let Some(id) = m["sign"].as_str().and_then(EditId::from_hex) {
                    send(write, &json!({ "id": id.to_hex(), "signed": hex(&keys[*key].sign(id).to_wire()) })).await?;
                } else if let Some(answer) = m["mcp"].as_str() {
                    output.write_all(format!("{answer}\n").as_bytes()).await?;
                    output.flush().await?;
                }
            }
        }
    }
}

/// The session theOS's device on the socket beside `host` hosts agent `name` in, by the first of `keys` it takes: the
/// lines it sends, where the agent writes, and which of `keys` it signs with. None where nothing answers there, or the host
/// refuses each key.
async fn hosted_by(
    host: &Path,
    name: &str,
    roots: &[PathBuf],
    keys: &[DeviceKey],
) -> Result<Option<(tokio::io::Lines<BufReader<OwnedReadHalf>>, OwnedWriteHalf, usize)>> {
    let Ok(stream) = UnixStream::connect(socket(host)).await else { return Ok(None) };
    let (read, mut write) = stream.into_split();
    let mut from = BufReader::new(read).lines();
    let Some(first) = from.next_line().await? else { return Ok(None) };
    let first: Value = serde_json::from_str(&first)?;
    let challenge: [u8; 32] = first["challenge"]
        .as_str()
        .and_then(unhex)
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| anyhow!("the host sent no challenge"))?;
    let hellos: Vec<String> = keys.iter().map(|k| hex(&k.hello(&challenge, true).to_wire())).collect();
    // the key each is sealed to, should it join its aven as theOS hosts it: the agent never hands its secret
    let seals: Vec<Value> = keys
        .iter()
        .map(|k| {
            let secret = k.seal_secret();
            json!({ "seal": hex(&secret.public().to_wire()), "mceliece": hex(&secret.mceliece_public()) })
        })
        .collect();
    send(&mut write, &json!({ "name": name, "hellos": hellos, "seals": seals, "roots": roots })).await?;
    let Some(said) = from.next_line().await? else { return Ok(None) };
    let said: Value = serde_json::from_str(&said)?;
    let Some(hosted) = said["hosted"].as_str().and_then(unhex) else {
        tracing::info!("{name}: theOS doesn't host it ({})", said["refused"]);
        return Ok(None);
    };
    let key = keys.iter().position(|k| k.id().0[..] == hosted[..]).context("the host hosts a key it wasn't offered")?;
    Ok(Some((from, write, key)))
}

async fn send(write: &mut (impl AsyncWrite + Unpin), m: &Value) -> Result<()> {
    write.write_all(format!("{m}\n").as_bytes()).await?;
    write.flush().await?;
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok()).collect()
}
