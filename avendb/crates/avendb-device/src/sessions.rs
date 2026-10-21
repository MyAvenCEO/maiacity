//! Agents as sessions (Samuel 2026-10-21, spec `AvenDB.Sessions`): an agent on its person's Mac runs no avenDB node of
//! its own. theOS's device hosts it (`Lab::host`), on a socket in the agents' folder (`socket`), and the agent's process
//! only relays its harness's MCP lines to it (`relay`) and signs what it is asked to, with its own key, which never
//! leaves it. So the Mac keeps one store, one copy of each log and one replay, however many agents work on it; each
//! agent still writes as its own key, a device of its coop's aven, with that aven's rights alone, and reads only what
//! its own key opens.
//!
//! The socket speaks JSON, a message a line. The host opens with a challenge, 32 random bytes; the agent answers with a
//! hello over it from each key it may be (`server::agent_keys`: its next key first, after a key move); the host takes
//! the first that is a device of a vault it holds and hosts it, or refuses, and the agent then runs its own device as
//! before, so that one not approved yet can still ask for access. From then on the agent sends its harness's lines
//! (`{"mcp": line}`) and the host answers each (`{"mcp": answer}`), running it as the session (`Node::acting`); where
//! the session writes, the host asks the agent to sign the edit (`{"sign": id}`), and the agent answers
//! (`{"signed": signature, "id": id}`). The session ends with the connection.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::id::{EditId, SignerId};
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

/// A session hosted now: its harness's agent's name, its key, and since when (Unix seconds).
pub struct Live {
    name: String,
    device: SignerId,
    since: u64,
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
    let proven: Vec<(SignerId, SignerKeys)> = hellos
        .iter()
        .filter_map(|h| Hello::from_wire(&unhex(h.as_str()?)?).ok())
        .filter_map(|h| {
            let SignerKeys::Device { ed25519, .. } = &h.keys else {
                return None;
            };
            Some((h.verify(&challenge, true, ed25519)?, h.keys))
        })
        .collect();
    // the first key that is a device of a vault the host holds, and no device of its own Lab
    let candidates = proven.clone();
    let chosen = node
        .read(move |lab, me| {
            let st = lab.state(me);
            candidates
                .into_iter()
                .find(|(s, _)| st.vaults().iter().any(|v| v.devices.contains(s)) && !lab.devices().contains(s))
        })
        .await;
    let Some((s, keys)) = chosen else {
        send(&mut write, &json!({ "refused": "no key of the agent's is a device of a vault this Mac holds" })).await?;
        bail!("{name}: no key it proved is a device of a vault this Mac holds");
    };
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
    node.act(move |lab, me| lab.host(me, s, keys, sign)).await;
    send(&mut write, &json!({ "hosted": hex(&s.0) })).await?;
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
    let since = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let live = Live { name: name.clone(), device: s, since };
    hosted.lock().expect("the sessions").insert(id, live);
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
    let result = ended.await;
    hosted.lock().expect("the sessions").remove(&id);
    node.act(move |lab, _| lab.unhost(s)).await;
    writer.abort();
    drop(alive);
    // it no longer runs, unless a device of its own, of the same key, still does and says so again
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
/// hosts it no more within `AGAIN`: the agent then runs its own device as before. Else when `input` ended.
pub async fn relay(
    host: &Path,
    name: &str,
    roots: &[PathBuf],
    input: &mut tokio::io::Lines<BufReader<impl AsyncRead + Unpin>>,
    output: &mut (impl AsyncWrite + Unpin),
) -> Result<Option<()>> {
    // its keys, where its shelf opens: else it runs as before, which says what is the matter
    let keys = match disk::open(&agent::folder(host, name)) {
        Ok(shelf) => server::agent_keys(&shelf).await.unwrap_or_default(),
        Err(_) => vec![],
    };
    if keys.is_empty() {
        return Ok(None);
    }
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
                    // theOS closed it, as it restarts: it hosts it again in a moment, or the agent runs its own device
                    tracing::info!("{name}: theOS's device closed its session; it waits for theOS to host it again");
                    let until = tokio::time::Instant::now() + AGAIN;
                    loop {
                        if let Some(again) = hosted_by(host, name, roots, &keys).await.ok().flatten() {
                            hosted = again;
                            break;
                        }
                        if tokio::time::Instant::now() >= until {
                            tracing::info!("{name}: theOS doesn't host it again: it runs its own device");
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
    send(&mut write, &json!({ "name": name, "hellos": hellos, "roots": roots })).await?;
    let Some(said) = from.next_line().await? else { return Ok(None) };
    let said: Value = serde_json::from_str(&said)?;
    let Some(hosted) = said["hosted"].as_str().and_then(unhex) else {
        tracing::info!("{name}: theOS doesn't host it ({}): it runs its own device", said["refused"]);
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
