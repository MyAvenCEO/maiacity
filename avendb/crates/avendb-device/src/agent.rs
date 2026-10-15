//! An agent device, as an MCP server on stdio: `avendb-device agent <harness> [--aven <name>]`, which an agent harness
//! (Claude Code, Codex, Cursor, Grok, or our own native aven) starts on its person's Mac. Claude Code's is
//! `claude mcp add --scope user avendb -- <the app's avendb-device> agent claude`, the device agentClaude.
//!
//! An aven is an identity, a vault its person's vault owns, which holds the aven's shares; agent devices control it,
//! one for each harness (agentClaude, agentCodex, agentCursor, agentGrok, agentAven), as a person's Mac and phone are
//! devices of their one vault. So every harness of an aven acts with the aven's access, signing by its own key, and
//! one is taken out by removing its device, leaving the others. No token: the device's key is who it is.
//!
//! It is a device of its own (`avendb_net::server::open_agent`), in a folder of its own in the agents' folder beside
//! the Mac app's (`<app's folder>-agents/<device>`, which the app's device never clears), which keeps its key and its
//! edits and no file whole: it reads its person's files from the Mac's one store, over iroh, so that nothing is kept
//! twice. A reset clears its folder as it does the app's (`disk::open`), and it asks to join again.
//!
//! It asks for access as anyone asks avenDB for it, and its person answers on the page's one consent screen: it leaves
//! an access request for the Mac app (`<app's folder>-agents/<device>.request`, `asking`): who asks, by its device's
//! name and key, the aven it would join, if it names one, the level it asks for, why, and the vaults it names, if any;
//! while it belongs to no vault, its offer too. Its person picks the aven it joins, one their vault owns or a new one
//! they name, then every vault they own or only some, a level each, and approves or denies. Approving adds this device
//! to that aven, founding it if it is new, in one ceremony of their passkey (`Node::adopt_with`), as a server is
//! claimed; each vault picked then gives the aven a share at its level, as any share is given. From then on it acts
//! for its aven by its own key, as the aven's shares allow, and asks for more with `avendb_request_access`. A no is
//! left for it (`<device>.denied`, the device it said no to), and it asks no more until it asks again.
//!
//! It finds the Mac's device by the offer the app leaves (`<app's folder>-agents/offer.txt`), and reaches it
//! directly.
//!
//! The MCP is JSON-RPC 2.0, a message a line (`initialize`, `tools/list`, `tools/call`, `ping`): `avendb_vaults`
//! tells who it is and the vaults it sees, `avendb_ask` runs a read of the ops engine, `avendb_run` a change, each
//! acting for its aven vault, and `avendb_request_access` asks its person for access.

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

/// Claude Code, as a harness: its agent device is agentClaude.
pub const CLAUDE: &str = "claude";

/// The name of harness `harness`'s agent device: `agent` and the harness's name, its first letter capital, as
/// agentClaude for `claude`; a name that starts with `agent` already as it is.
pub fn device_name(harness: &str) -> String {
    if harness.starts_with("agent") && harness.len() > "agent".len() {
        return harness.to_string();
    }
    let mut letters = harness.chars();
    let first = letters.next().map(|c| c.to_ascii_uppercase().to_string()).unwrap_or_default();
    format!("agent{first}{}", letters.as_str())
}

/// The command that runs harness `harness`'s agent device, this device's binary `exe` as `agent <harness>` beside the
/// app's folder `host`, which a harness's MCP settings name; for Claude Code, the line that adds it in every folder.
pub fn command(exe: &Path, host: &Path, harness: &str) -> Value {
    let quoted = |p: &Path| format!("'{}'", p.display().to_string().replace('\'', r"'\''"));
    let command = format!("{} agent {harness} --dir {}", quoted(exe), quoted(host));
    let claude = (harness == CLAUDE).then(|| format!("claude mcp add --scope user avendb -- {command}"));
    json!({ "device": device_name(harness), "command": command, "claude": claude })
}

/// Whether `name` names a harness or an agent device: letters, digits, `-` and `_`, as a folder's name beside the
/// app's takes it. Fails with why not.
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

/// The levels an agent asks for, the weakest first: Viewer reads, Suggester reads and writes on proposals its person
/// merges, Editor reads and changes. A share at any of them its person's vault gives alone, with no ceremony.
pub const LEVELS: [&str; 3] = ["Viewer", "Suggester", "Editor"];

/// What an agent asks for until it asks for something else.
const ASKS: &str = "Suggester";

/// Why, until it says why itself.
const WHY: &str = "to work in your vaults as your agent";

/// The file in the agents' folder beside the app's `host` folder where agent `name` leaves its access request
/// (`asking`) until its person answers it.
pub fn request(host: &Path, name: &str) -> PathBuf {
    agents(host).join(format!("{name}.request"))
}

/// The file in the agents' folder beside the app's `host` folder where its person's no to agent `name` is left: the
/// device it said no to.
pub fn denied(host: &Path, name: &str) -> PathBuf {
    agents(host).join(format!("{name}.denied"))
}

/// An access request, as an agent leaves it for its person's page: who asks, agent device `name` by its `device`'s key
/// in hex, its offer while it belongs to no vault, and what it asks for (`Asking`).
pub fn asking(name: &str, device: &str, offer: Option<String>, ask: &Asking) -> Value {
    json!({ "name": name, "kind": "agent", "device": device, "offer": offer, "aven": ask.aven, "level": ask.level,
        "why": ask.why, "vaults": ask.vaults })
}

/// What an access request asks for: the aven it would join, by its name, if it names one; a level of `LEVELS`; why;
/// and the vaults it names, by their ids, if any.
pub struct Asking {
    pub aven: Option<String>,
    pub level: String,
    pub why: String,
    pub vaults: Vec<String>,
}

/// An aven's name an agent may name: some text, at most 64 characters. Fails with why not.
pub fn aven_named(name: &str) -> Result<String> {
    let name = name.trim();
    anyhow::ensure!(!name.is_empty() && name.chars().count() <= 64, "{name:?} names no aven: 1 to 64 characters");
    Ok(name.to_string())
}

/// The file in the agents' folder beside the app's `host` folder where the Mac's device leaves its offer for them.
pub fn host_offer(host: &Path) -> PathBuf {
    agents(host).join("offer.txt")
}

/// Runs harness `harness`'s agent device beside the app's `host` folder, asking to join the aven named `aven`, if
/// named, answering MCP on `input` and `output` until `input` ends. Fails if its folder or its node can't be opened.
pub async fn serve(
    host: PathBuf,
    harness: String,
    aven: Option<String>,
    input: impl AsyncRead + Unpin,
    mut output: impl AsyncWrite + Unpin,
) -> Result<()> {
    named(&harness)?;
    let aven = aven.as_deref().map(aven_named).transpose()?;
    let name = device_name(&harness);
    let dir = folder(&host, &name);
    std::fs::create_dir_all(&dir).with_context(|| format!("the agent's folder {}", dir.display()))?;
    let shelf = disk::open(&dir)?;
    let mac = read_offer(&host_offer(&host));
    let relay = mac.as_ref().and_then(|o| o.addr.relay_urls().next().cloned());
    let opts = Options { bind: None, direct: true, relay, ..Options::local() };
    let node = Arc::new(server::open_agent(shelf, &name, opts).await?);
    let looking = tokio::spawn(look(node.clone(), host.clone(), name.clone(), aven.clone()));
    let agent = Agent { node: node.clone(), host, name, aven };
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

/// The JSON in `file`, if it holds some.
fn read_json(file: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()
}

/// Every little while: the Mac's device where its offer says it is, and, until it belongs to a vault, its request to
/// be adopted left for the Mac's page, its offer as it is now, unless its person said no to this device.
async fn look(node: Arc<Node>, host: PathBuf, name: String, aven: Option<String>) {
    let (file, no, mut known) = (request(&host, &name), denied(&host, &name), None);
    let device = hex(&node.device().0);
    loop {
        if let Some(mac) = read_offer(&host_offer(&host))
            && known.as_ref() != Some(&mac.to_text())
        {
            known = Some(mac.to_text());
            node.know(mac.addr);
        }
        let said_no = std::fs::read_to_string(&no).is_ok_and(|d| d.trim() == device);
        if node.read(|lab, me| lab.vault_of(me)).await.is_none() && !said_no {
            let offer = node.offer().to_text();
            let fresh = match read_json(&file) {
                // as it asked, with its offer as it is now
                Some(mut asked) if asked["device"] == device.as_str() => {
                    (asked["offer"] != offer.as_str()).then(|| {
                        asked["offer"] = offer.into();
                        asked
                    })
                }
                _ => {
                    let (level, why) = (ASKS.to_string(), WHY.to_string());
                    let ask = Asking { aven: aven.clone(), level, why, vaults: vec![] };
                    Some(asking(&name, &device, Some(offer), &ask))
                }
            };
            if let Some(asked) = fresh {
                std::fs::write(&file, asked.to_string()).ok();
            }
        }
        tokio::time::sleep(LOOK).await;
    }
}

/// The agent's device, as its MCP answers.
struct Agent {
    node: Arc<Node>,
    /// the app's folder, beside which it leaves its requests
    host: PathBuf,
    /// its device's name, agentClaude
    name: String,
    /// the aven it asks to join, if it names one
    aven: Option<String>,
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
            "{name} is an agent device on this Mac: an avenDB device with a key of its own, which controls an aven, \
             an identity its person's vault owns, as one of that aven's devices, and acts with the aven's access. \
             Every read and change is one JSON op of avenDB's engine (avendb/docs/ARCHITECTURE.md §8). Call \
             avendb_vaults first: it says which aven {name} is a device of, if any yet, and which vaults it sees. \
             Read with avendb_ask; change with avendb_run, which acts for the aven by its shares: on a vault where it \
             may only suggest, write on a proposal (`propose`, then ops with its `line`), and its person merges it. \
             For access it lacks, ask its person with avendb_request_access, saying why: they answer in The OS app.",
            name = self.name
        )
    }

    /// Tool `name` with `args`: its text.
    async fn call(&self, name: &str, args: &Value) -> Result<String> {
        let vault = self.node.read(|lab, me| lab.vault_of(me)).await;
        if name == "avendb_request_access" {
            return self.ask_access(vault.is_some(), args);
        }
        let Some(vault) = vault else {
            let device = hex(&self.node.device().0);
            if std::fs::read_to_string(denied(&self.host, &self.name)).is_ok_and(|d| d.trim() == device) {
                return Ok(format!(
                    "{}'s person said no to its request. Ask again with avendb_request_access, saying why.",
                    self.name
                ));
            }
            return Ok(format!(
                "{} is waiting for its person to answer its access request: they open The OS app on this Mac, where \
                 avenDB shows it, pick the aven it joins and the vaults that aven may work in, and approve with one \
                 touch of their passkey. Then call this again.",
                self.name
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
                let me = json!({ "device": self.name, "aven": hex(&vault.0), "key": hex(&self.node.device().0) });
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

    /// Asks its person for the access `args` name, a level of `LEVELS` and why, and the vaults it names, if any:
    /// leaves its request for their page, in place of any it left before, with its offer while it belongs to no vault
    /// (`adopted`).
    fn ask_access(&self, adopted: bool, args: &Value) -> Result<String> {
        let level = args["level"].as_str().unwrap_or(ASKS);
        anyhow::ensure!(LEVELS.contains(&level), "{level:?} is no level to ask for: one of {}", LEVELS.join(", "));
        let why = args["why"].as_str().map(str::trim).unwrap_or_default();
        anyhow::ensure!(!why.is_empty(), "say why: its person reads it before they answer");
        let vaults: Vec<String> =
            args["vaults"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect();
        let (device, offer) = (hex(&self.node.device().0), (!adopted).then(|| self.node.offer().to_text()));
        let ask = Asking { aven: self.aven.clone(), level: level.to_string(), why: why.to_string(), vaults };
        let asked = asking(&self.name, &device, offer, &ask);
        std::fs::create_dir_all(agents(&self.host))?;
        std::fs::remove_file(denied(&self.host, &self.name)).ok();
        std::fs::write(request(&self.host, &self.name), asked.to_string())?;
        Ok(format!(
            "Asked for {level} access. {}'s person sees the request in The OS app on this Mac and answers it there; \
             call avendb_vaults to see what it has.",
            self.name
        ))
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
            "description": "Who this agent device is (its name, the aven it controls and its key) and the vaults \
                            it sees, each its id, name and kind; or that its person has yet to answer its request.",
            "inputSchema": { "type": "object", "properties": {} },
        },
        {
            "name": "avendb_ask",
            "description": "Run a read op of avenDB's engine as this agent: query, get, history, schemas, groups, \
                            world, jobs, shares, database, note, creatable, taggable, may.",
            "inputSchema": op,
        },
        {
            "name": "avendb_request_access",
            "description": "Ask this agent's person for access it lacks: a level (Viewer reads, Suggester reads and \
                            writes on proposals they merge, Editor reads and changes), why, and optionally the ids of \
                            the vaults it asks for. They answer in The OS app, picking the vaults and levels.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "level": { "type": "string", "enum": LEVELS },
                    "why": { "type": "string", "description": "Why it asks, for its person to read" },
                    "vaults": { "type": "array", "items": { "type": "string" }, "description": "Vault ids, if any" },
                },
                "required": ["level", "why"],
            },
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
