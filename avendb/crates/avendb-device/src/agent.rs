//! An agent's own avenDB device, as an MCP server on stdio: `avendb-device agent <name>`, which an agent harness
//! starts on its person's Mac (Claude Code: `claude mcp add avendb -- <the app's avendb-device> agent avenCLAUDE`).
//!
//! It is a device of its own, with a key of its own (`avendb_net::server::open_agent`), in a folder of its own in the
//! agents' folder beside the Mac app's (`<app's folder>-agents/<name>`, which the app's device never clears), which
//! keeps its key and its edits and no file whole: it reads its person's files from the Mac's one store, over iroh, so
//! that nothing is kept twice. No token: its key is who it is. A reset clears its folder as it does the app's
//! (`disk::open`), and it waits to be adopted again.
//!
//! Until it belongs to a vault it leaves its offer for the Mac app (`<app's folder>-agents/<name>.offer`), whose
//! page asks its person to adopt it: one ceremony of their passkey founds the aven vault `name` their vault owns, or
//! takes the one of that name it owns already, and adds this device to it (`Node::adopt_with`), and their vaults it
//! may work on give the aven a Suggester share. From then on it acts for its aven vault by its own key, as the
//! aven's shares allow: it reads, and writes on proposals that its person merges.
//!
//! It finds the Mac's device by the offer the app leaves (`<app's folder>-agents/offer.txt`), and reaches it
//! directly.
//!
//! The MCP is JSON-RPC 2.0, a message a line (`initialize`, `tools/list`, `tools/call`, `ping`): `avendb_vaults`
//! tells who it is and the vaults it sees, `avendb_ask` runs a read of the ops engine, `avendb_run` a change, each
//! acting for its aven vault.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context as _, Result};
use avendb::engine;
use avendb_net::{NoBytes, NoCeremony, Node, Offer, Options, disk, server};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt as _, AsyncRead, AsyncWrite, AsyncWriteExt as _, BufReader};

/// The MCP version it speaks, unless its client asks for another.
const PROTOCOL: &str = "2025-06-18";

/// How often it looks for the Mac's offer and leaves its own.
const LOOK: Duration = Duration::from_secs(3);

/// The agent Claude Code runs as: its name, and its aven vault's.
pub const CLAUDE: &str = "avenCLAUDE";

/// The line that connects Claude Code, in every folder, to agent `name`'s own device: this device's binary `exe`, as
/// `agent <name>` beside the app's folder `host`.
pub fn command(exe: &Path, host: &Path, name: &str) -> String {
    let quoted = |p: &Path| format!("'{}'", p.display().to_string().replace('\'', r"'\''"));
    format!("claude mcp add --scope user avendb -- {} agent {name} --dir {}", quoted(exe), quoted(host))
}

/// Whether `name` names an agent: letters, digits, `-` and `_`, as a folder's name beside the app's takes it. Fails
/// with why not.
pub fn named(name: &str) -> Result<()> {
    let fits = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
    anyhow::ensure!(
        !name.is_empty() && name.len() <= 64 && name.chars().all(fits),
        "{name:?} names no agent: letters, digits, - and _"
    );
    Ok(())
}

/// The agents' folder beside the app's `host` folder: `<host>-agents`, outside it, as the app's device clears whatever
/// its own folder holds beside its shelves (`disk::clear`).
pub fn agents(host: &Path) -> PathBuf {
    let mut name = host.file_name().unwrap_or_default().to_os_string();
    name.push("-agents");
    host.with_file_name(name)
}

/// Agent `name`'s own folder, in the agents' folder beside the app's `host` folder.
pub fn folder(host: &Path, name: &str) -> PathBuf {
    agents(host).join(name)
}

/// The file in the agents' folder beside the app's `host` folder where agent `name` leaves its offer while it waits
/// to be adopted.
pub fn waiting(host: &Path, name: &str) -> PathBuf {
    agents(host).join(format!("{name}.offer"))
}

/// The file in the agents' folder beside the app's `host` folder where the Mac's device leaves its offer for them.
pub fn host_offer(host: &Path) -> PathBuf {
    agents(host).join("offer.txt")
}

/// Runs agent `name`'s device beside the app's `host` folder, answering MCP on `input` and `output` until `input`
/// ends. Fails if its folder or its node can't be opened.
pub async fn serve(
    host: PathBuf,
    name: String,
    input: impl AsyncRead + Unpin,
    mut output: impl AsyncWrite + Unpin,
) -> Result<()> {
    named(&name)?;
    let dir = folder(&host, &name);
    std::fs::create_dir_all(&dir).with_context(|| format!("the agent's folder {}", dir.display()))?;
    let shelf = disk::open(&dir)?;
    let mac = read_offer(&host_offer(&host));
    let relay = mac.as_ref().and_then(|o| o.addr.relay_urls().next().cloned());
    let node = Arc::new(server::open_agent(shelf, &name, Options { bind: None, direct: true, relay, ..Options::local() }).await?);
    let looking = tokio::spawn(look(node.clone(), host.clone(), name.clone()));
    let agent = Agent { node: node.clone(), name };
    let mut lines = BufReader::new(input).lines();
    while let Some(line) = lines.next_line().await? {
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(answer) = agent.answer(&message).await {
            let mut line = answer.to_string();
            line.push('\n');
            output.write_all(line.as_bytes()).await?;
            output.flush().await?;
        }
    }
    looking.abort();
    node.shutdown().await
}

/// The Mac's offer in `file`, if it left one.
fn read_offer(file: &Path) -> Option<Offer> {
    Offer::from_text(std::fs::read_to_string(file).ok()?.trim()).ok()
}

/// Every little while: the Mac's device where its offer says it is, and, until it belongs to a vault, its own offer
/// left for the Mac's page, taken away once it does.
async fn look(node: Arc<Node>, host: PathBuf, name: String) {
    let (file, mut known) = (waiting(&host, &name), None);
    loop {
        if let Some(mac) = read_offer(&host_offer(&host))
            && known.as_ref() != Some(&mac.to_text())
        {
            known = Some(mac.to_text());
            node.know(mac.addr);
        }
        if node.read(|lab, me| lab.vault_of(me)).await.is_none() {
            std::fs::write(&file, node.offer().to_text()).ok();
        } else if file.exists() {
            std::fs::remove_file(&file).ok();
        }
        tokio::time::sleep(LOOK).await;
    }
}

/// The agent's device, as its MCP answers.
struct Agent {
    node: Arc<Node>,
    name: String,
}

impl Agent {
    /// The answer to MCP message `m`: none for a notification.
    async fn answer(&self, m: &Value) -> Option<Value> {
        let id = m.get("id")?.clone();
        let method = m.get("method").and_then(Value::as_str).unwrap_or_default();
        let params = m.get("params").cloned().unwrap_or(Value::Null);
        let result = match method {
            "initialize" => {
                let version = params["protocolVersion"].as_str().unwrap_or(PROTOCOL);
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "avendb", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": self.instructions(),
                })
            }
            "ping" => json!({}),
            "tools/list" => json!({ "tools": tools() }),
            "tools/call" => {
                let name = params["name"].as_str().unwrap_or_default();
                let (text, error) = match self.call(name, &params["arguments"]).await {
                    Ok(text) => (text, false),
                    Err(e) => (format!("{e:#}"), true),
                };
                json!({ "content": [{ "type": "text", "text": text }], "isError": error })
            }
            _ => {
                return Some(
                    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "no method" } }),
                );
            }
        };
        Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
    }

    fn instructions(&self) -> String {
        format!(
            "{name} is an avenDB device of its own on this Mac, acting for the aven vault {name}, which its person's \
             vault owns. Every read and change is one JSON op of avenDB's engine (avendb/docs/ARCHITECTURE.md §8). \
             Call avendb_vaults first: it says whether {name} was adopted yet and which vaults it sees. Read with \
             avendb_ask; change with avendb_run, which acts for {name} by its shares: on a vault where it may only \
             suggest, write on a proposal (`propose`, then ops with its `line`), and its person merges it.",
            name = self.name
        )
    }

    /// Tool `name` with `args`: its text.
    async fn call(&self, name: &str, args: &Value) -> Result<String> {
        let Some(vault) = self.node.read(|lab, me| lab.vault_of(me)).await else {
            return Ok(format!(
                "{} is waiting to be adopted: its person opens The OS app on this Mac, where avenDB asks them to \
                 adopt {} as their aven, with one touch of their passkey. Then call this again.",
                self.name, self.name
            ));
        };
        match name {
            "avendb_vaults" => {
                let world = self.node.op(json!({ "op": "world" })).await?;
                let world = &world["ok"];
                let vaults: Vec<Value> = world["vaults"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|v| json!({ "id": v["id"], "name": v["name"], "kind": v["kind"] }))
                    .collect();
                let me = json!({ "name": self.name, "vault": hex(&vault.0), "device": hex(&self.node.device().0) });
                Ok(json!({ "me": me, "vaults": vaults }).to_string())
            }
            "avendb_ask" => {
                let op = args.get("op").cloned().context("avendb_ask takes an op")?;
                if !(engine::reads(&op) || engine::asks(&op)) || op_name(&op) == Some("read_file") {
                    anyhow::bail!("{:?} is no read: change with avendb_run", engine::name(&op));
                }
                Ok(self.node.op(op).await?.to_string())
            }
            "avendb_run" => {
                let op = args.get("op").cloned().context("avendb_run takes an op")?;
                if engine::reads(&op) || engine::asks(&op) {
                    anyhow::bail!("{:?} only reads: read with avendb_ask", engine::name(&op));
                }
                if matches!(op_name(&op), Some("put_file" | "follow")) {
                    anyhow::bail!("{:?} isn't for an agent yet", op_name(&op));
                }
                let (answer, _) = self.node.run(op, None::<NoBytes>, None::<&NoCeremony>).await?;
                Ok(answer.to_string())
            }
            other => anyhow::bail!("no tool {other:?}"),
        }
    }
}

/// The tools it offers.
fn tools() -> Value {
    let op = json!({
        "type": "object",
        "properties": { "op": { "type": "object", "description": "One op of avenDB's engine, as JSON" } },
        "required": ["op"],
    });
    json!([
        {
            "name": "avendb_vaults",
            "description": "Who this agent is (its aven vault and device) and the vaults it sees, each its id, name \
                            and kind; or that its person has yet to adopt it.",
            "inputSchema": { "type": "object", "properties": {} },
        },
        {
            "name": "avendb_ask",
            "description": "Run a read op of avenDB's engine as this agent: query, get, history, schemas, groups, \
                            world, jobs, shares, database, note, creatable, taggable, may.",
            "inputSchema": op,
        },
        {
            "name": "avendb_run",
            "description": "Run a change op of avenDB's engine as this agent, as its shares allow: create, set, \
                            unset, insert, remove, move, tag, propose, merge, restore, undo, variant, batch. Where it \
                            may only suggest, write on a proposal.",
            "inputSchema": op,
        },
    ])
}

/// The name op `op` gives itself, as it is or not.
fn op_name(op: &Value) -> Option<&str> {
    op.get("op").and_then(Value::as_str)
}

/// Bytes in lowercase hex.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
