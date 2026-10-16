//! An agent device, as an MCP server on stdio: `avendb-device agent <harness>`, which an agent harness (Claude Code,
//! Codex, Cursor, Grok, or our own native aven) starts on its person's Mac. Claude Code's is
//! `claude mcp add --scope user avendb -- <the app's avendb-device> agent claude`, the device agentClaude.
//!
//! A person's aven is their one AI identity, a vault their vault owns alone, which holds no devices and acts through
//! its agents. Each agent is a device vault the aven owns (agentClaude, agentCodex, agentCursor, agentGrok, agentAven),
//! the harness's devices its devices, as a person's Mac and phone are devices of their one vault; and each holds sub
//! shares of what the aven reaches, none more than the aven's own, each resting on one the aven holds, so that taking
//! the aven's share back ends its agents' too. So every harness acts as its own device vault by its own key, with the
//! shares its aven passed on to it, and one is taken out by removing its device, or its vault, leaving the others. No
//! token: the device's key is who it is. The harness never names or picks an aven: the person's one aven is the parent,
//! and the agent is added under it.
//!
//! It is a device of its own (`avendb_net::server::open_agent`), in a folder of its own in the agents' folder beside
//! the Mac app's (`<app's folder>-agents/<device>`, which the app's device never clears), which keeps its key and its
//! edits and no file whole of its own accord: it reads its person's files from the Mac's one store, over iroh, so that
//! nothing is kept twice. A file it saves (`put_file`) it seals onto its own shelf, as every device does, and lets go
//! of once the Mac's device holds it whole, as that device's holdings say (`Node::holds_whole`, `Node::let_go`): from
//! then on the Mac's one store keeps it, and a read of it fetches it from there. Where the Mac keeps a light copy, the
//! agent keeps its own, the one copy on the Mac. A reset clears its folder as it does the app's (`disk::open`), and it
//! asks to join again.
//!
//! It asks for access as anyone asks avenDB for it, and its person answers on the page's one consent screen: it leaves
//! an access request for the Mac app (`<app's folder>-agents/<device>.request`, `asking`): who asks, by its device's
//! name and key, the level it asks for, why, and the vaults it names, if any; while it belongs to no vault, its offer
//! too. Its person picks the vaults their aven passes on to it, a level each, and approves or denies. Approving adds
//! the agent under their aven, founding the aven too if they have none yet, named as they say, in one ceremony of their
//! passkey (`Node::add_device_vault_with`): its device vault, named after it, founded under the aven, and its device
//! added to it, or, where the aven has that agent's device vault already, as the same harness has on their other Mac,
//! its device added to that one. Then the aven passes a share on to it for each vault picked, as any share is given
//! (`pass_on`). From then on it acts as its device vault by its own key, as its shares allow, and asks for more with
//! `avendb_request_access`. A no is left for it (`<device>.denied`, the device it said no to), and it asks no more
//! until it asks again.
//!
//! It finds the Mac's device by the offer the app leaves (`<app's folder>-agents/offer.txt`), the device whose key is
//! the offer's endpoint, and reaches it directly.
//!
//! The MCP is JSON-RPC 2.0, a message a line (`initialize`, `tools/list`, `tools/call`, `ping`): `avendb_vaults` tells
//! who it is, its device vault and the aven over it, and the vaults it sees, `avendb_ask` runs a read of the ops
//! engine, `avendb_run` a change, each acting as its device vault, and `avendb_request_access` asks its person for
//! access. A change runs as on every device, the shares its aven passed on deciding: `put_file` too, its bytes those of
//! the file on this Mac the harness names by its `path` beside the op; but not `follow` and `set_limits`, a device's
//! own settings, which an agent keeps nowhere.

use std::io;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::engine;
use avendb::id::{ShareId, SignerId, VaultId};
use avendb::lab::{Lab, NewShare};
use avendb::policy::{Issued, Kind, Level, Principal, State, Vault, Who};
use avendb::rules;
use avendb::slice::Selector;
use avendb::wire::FileHold;
use avendb::world;
use avendb_net::{NoBytes, NoCeremony, Node, Offer, Options, disk, server};
use bytes::{Bytes, BytesMut};
use n0_future::{Stream, stream};
use serde_json::{Value, json};
use tokio::fs::File;
use tokio::io::{AsyncBufReadExt as _, AsyncRead, AsyncReadExt as _, AsyncWrite, AsyncWriteExt as _, BufReader};

/// The MCP version it speaks, unless its client asks for another.
const PROTOCOL: &str = "2025-06-18";

/// How often it looks for the Mac's offer, leaves its own, and lets go of the files the Mac's device holds whole.
pub const LOOK: Duration = Duration::from_secs(3);

/// How many bytes of a file it saves it reads at a time.
const CHUNK: usize = 1 << 20;

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
/// merges, Editor reads and changes. A share at any of them its aven passes on alone, with no ceremony (`pass_on`).
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

/// The file in the agents' folder beside the app's `host` folder that agent `name` writes its device's key to every
/// little while it runs (`LOOK`): the Mac's page knows by it whether the agent is there to be added under its person's
/// aven, which its device cosigns (`online`).
pub fn alive(host: &Path, name: &str) -> PathBuf {
    agents(host).join(format!("{name}.alive"))
}

/// Whether agent `name`'s device `device` runs now: it wrote its key to its `alive` file within the last few looks.
/// An agent harness such as Claude Code starts it with each of its sessions, and it stops with them.
pub fn online(host: &Path, name: &str, device: &str) -> bool {
    let file = alive(host, name);
    let fresh = std::fs::metadata(&file)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age <= LOOK * 5);
    fresh && std::fs::read_to_string(&file).is_ok_and(|d| d.trim() == device)
}

/// The file in the agents' folder beside the app's `host` folder where its person's no to agent `name` is left: the
/// device it said no to.
pub fn denied(host: &Path, name: &str) -> PathBuf {
    agents(host).join(format!("{name}.denied"))
}

/// An access request, as an agent leaves it for its person's page: who asks, agent device `name` by its `device`'s key
/// in hex, its offer while it belongs to no vault, and what it asks for (`Asking`).
pub fn asking(name: &str, device: &str, offer: Option<String>, ask: &Asking) -> Value {
    json!({ "name": name, "kind": "agent", "device": device, "offer": offer, "level": ask.level, "why": ask.why,
        "vaults": ask.vaults })
}

/// What an access request asks for: a level of `LEVELS`; why; and the vaults it names, by their ids, if any.
pub struct Asking {
    pub level: String,
    pub why: String,
    pub vaults: Vec<String>,
}

/// An aven's name, as its person gives it on the consent screen as their first agent joins: some text, at most 64
/// characters. Fails with why not.
pub fn aven_named(name: &str) -> Result<String> {
    let name = name.trim();
    anyhow::ensure!(!name.is_empty() && name.chars().count() <= 64, "{name:?} names no aven: 1 to 64 characters");
    Ok(name.to_string())
}

/// The aven vault `mine` owns, by view `st`: a person's one aven, which their vault owns alone (`Kind::rules`).
pub fn aven_of(st: &State, mine: VaultId) -> Option<VaultId> {
    let ours = |v: &&Vault| v.kind == Kind::Aven && v.owners == [Principal::Vault(mine)];
    st.vaults().iter().find(ours).map(|v| v.id)
}

/// The device vault of agent `name` under aven `aven`, by device `me`'s view: one the aven owns alone whose profile
/// reads the agent's name, as the agent's device vault was named as it was founded.
pub fn agent_vault(lab: &Lab, me: SignerId, aven: VaultId, name: &str) -> Option<VaultId> {
    let st = lab.state(me);
    let under = |v: &&Vault| v.kind == Kind::DeviceVault && v.owners == [Principal::Vault(aven)];
    let named = |v: VaultId| world::profile_of(lab, me, v).is_some_and(|(_, title)| title == name);
    st.vaults().iter().filter(under).map(|v| v.id).find(|&v| named(v))
}

/// The built-in group of level `level`, one of `LEVELS`, and its class (`rules::level_of`). Fails for another.
fn group(level: &str) -> Result<(rules::Group, Level)> {
    let group = rules::groups().into_iter().find(|g| g.name == level && LEVELS.contains(&g.name));
    let group = group.with_context(|| format!("{level:?} isn't a level to give: {LEVELS:?}"))?;
    let class = rules::level_of(&group.ops);
    Ok((group, class))
}

/// Whether the aven `aven` of the person whose vault is `mine`, or, `None`, the one their vault founds for its first
/// agent, can pass a share over vault `over` at `level`, one of `LEVELS`, on to an agent of its, by view `st`, as
/// `pass_on` passes it on: over the aven itself, or over a vault `mine` is or owns, which gives the aven its share
/// first where it lacks it, always; else over a vault that gave the aven a share at that level or more, such as a coop
/// that hired it. Fails with why not, before anything is drafted.
pub fn passable(st: &State, mine: VaultId, aven: Option<VaultId>, over: VaultId, level: &str) -> Result<()> {
    let (_, class) = group(level)?;
    if over == mine || st.owns(mine, over) || aven == Some(over) {
        return Ok(());
    }
    let holds = |aven: VaultId| {
        let at = |cp: &&Issued| {
            cp.share.over == over && st.live(cp.id) && !cp.share.level.is_keep() && cp.share.level.allows(class)
        };
        st.shares_held(aven).any(|cp| at(&cp))
    };
    match aven {
        Some(aven) if holds(aven) => Ok(()),
        _ => {
            let over = over.to_hex();
            bail!("the aven holds no share over {over} at {level} or more to pass on: its owners give it one first")
        }
    }
}

/// Aven `aven` passes a share over vault `over` at `level`, one of `LEVELS`, on to its agent's device vault `vault`, on
/// device `me` of the person whose vault is `mine`, acting as the aven, with no ceremony: a share resting on one the
/// aven holds there that lets it (`world::parent`: the grantee is a vault the aven owns, and it is no higher than its
/// parent, and wide only if it is), so that taking that one back ends it too. Over a vault `mine` is or owns, on one on
/// the whole of it, which `over` gives the aven first, acting as itself, where the aven holds none at `level` or more;
/// over another, as a coop that hired the aven, on the share that vault gave it, on the whole of it if one is, else on
/// the part it gives; over the aven itself, the aven's own. One the aven passed on before stands for it, as for the
/// same harness's device on the person's other Mac. The share. Fails with why not (`passable`).
pub fn pass_on(
    lab: &mut Lab,
    me: SignerId,
    mine: VaultId,
    aven: VaultId,
    vault: VaultId,
    over: VaultId,
    level: &str,
) -> Result<ShareId> {
    let (group, class) = group(level)?;
    let st = lab.state(me);
    let before = |cp: &&Issued| {
        cp.share.over == over && cp.share.issuer == aven && st.live(cp.id)
            && world::group_of(&cp.share, lab.slice(me, cp.id)) == Some(group.name)
    };
    if let Some(cp) = st.shares_held(vault).find(before) {
        return Ok(cp.id);
    }
    let who = Who::Vault(vault);
    let parent = |lab: &Lab, wide| world::parent(lab.state(me), aven, over, who, class, wide);
    let parent = if over == aven {
        None
    } else if over == mine || lab.state(me).owns(mine, over) {
        if parent(lab, true).is_none() {
            let (name, ops, select) = (group.name.to_string(), group.ops.clone(), Selector::All);
            let (who, parent) = (Who::Vault(aven), None);
            let given = NewShare { over, who, name, select, ops, parent, issuer: over, keep: None };
            lab.issue(me, &[me], given).map_err(|why| anyhow!("the aven's {level} share is refused: {why:?}"))?;
        }
        Some(parent(lab, true).context("the aven's share to pass on")?)
    } else {
        passable(lab.state(me), mine, Some(aven), over, level)?;
        let parent = parent(lab, true).or_else(|| parent(lab, false));
        Some(parent.with_context(|| format!("the aven's share over {} lets it pass nothing on", over.to_hex()))?)
    };
    // on the part of the vault its parent gives, unless that is all of it
    let select = match parent {
        Some(p) if !lab.state(me).share(p).is_some_and(|cp| cp.share.wide) => {
            lab.slice(me, p).context("the part of the vault the aven's share gives")?.select.clone()
        }
        _ => Selector::All,
    };
    let (name, ops) = (group.name.to_string(), group.ops);
    let sub = NewShare { over, who, name, select, ops, parent, issuer: aven, keep: None };
    lab.issue(me, &[me], sub).map_err(|why| anyhow!("the agent's {level} share is refused: {why:?}"))
}

/// The file in the agents' folder beside the app's `host` folder where the Mac's device leaves its offer for them.
pub fn host_offer(host: &Path) -> PathBuf {
    agents(host).join("offer.txt")
}

/// Runs harness `harness`'s agent device beside the app's `host` folder, answering MCP on `input` and `output` until
/// `input` ends. Fails if its folder or its node can't be opened.
pub async fn serve(
    host: PathBuf,
    harness: String,
    input: impl AsyncRead + Unpin,
    mut output: impl AsyncWrite + Unpin,
) -> Result<()> {
    named(&harness)?;
    let name = device_name(&harness);
    let dir = folder(&host, &name);
    std::fs::create_dir_all(&dir).with_context(|| format!("the agent's folder {}", dir.display()))?;
    let shelf = disk::open(&dir)?;
    let mac = read_offer(&host_offer(&host));
    let relay = mac.as_ref().and_then(|o| o.addr.relay_urls().next().cloned());
    let opts = Options { bind: None, direct: true, relay, ..Options::local() };
    let node = Arc::new(server::open_agent(shelf, &name, opts).await?);
    let looking = tokio::spawn(look(node.clone(), host.clone(), name.clone()));
    let agent = Agent { node: node.clone(), host, name };
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
/// be added under its person's aven left for the Mac's page, its offer as it is now, unless its person said no to this
/// device; and the files it holds whole that the Mac's device holds whole too, it lets go of (`hand_over`).
async fn look(node: Arc<Node>, host: PathBuf, name: String) {
    let (file, no, mut known) = (request(&host, &name), denied(&host, &name), None);
    let device = hex(&node.device().0);
    loop {
        // that it runs, for the Mac's page (`online`)
        std::fs::write(alive(&host, &name), &device).ok();
        let mac = read_offer(&host_offer(&host));
        if let Some(mac) = &mac
            && known.as_ref() != Some(&mac.to_text())
        {
            known = Some(mac.to_text());
            node.know(mac.addr.clone());
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
                    let ask = Asking { level, why, vaults: vec![] };
                    Some(asking(&name, &device, Some(offer), &ask))
                }
            };
            if let Some(asked) = fresh {
                std::fs::write(&file, asked.to_string()).ok();
            }
        }
        // the Mac's device, the one whose key is the offer's endpoint
        if let Some(mac) = mac.and_then(|mac| node.device_at(mac.addr.id)) {
            hand_over(&node, mac).await;
        }
        tokio::time::sleep(LOOK).await;
    }
}

/// Lets go of each file `node` holds whole that the Mac's device `mac` holds whole too, by its own word
/// (`Node::holds_whole`): the Mac's one store keeps it from then on, and a read of it fetches it from there. Of a file
/// the Mac keeps light, it keeps its own copy, the one on the Mac.
async fn hand_over(node: &Node, mac: SignerId) {
    let held = node.holdings().await.files;
    let both = held.into_iter().filter(|(root, hold)| *hold == FileHold::Whole && node.holds_whole(mac, *root));
    for (root, _) in both {
        if let Err(e) = node.let_go(root).await {
            tracing::warn!("the file {} isn't let go of: {e:#}", hex(&root.hash));
        }
    }
}

/// The agent's device, as its MCP answers.
struct Agent {
    node: Arc<Node>,
    /// the app's folder, beside which it leaves its requests
    host: PathBuf,
    /// its device's name, agentClaude, which its device vault's profile reads too
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
            "{name} is an agent device on this Mac: an avenDB device with a key of its own, a device of {name}, a \
             device vault its person's aven owns. An aven is its person's one AI identity, a vault their vault owns; \
             it acts through its agents, each a device vault under it with the shares the aven passes on to it, none \
             more than the aven's own. Every read and change is one JSON op of avenDB's engine \
             (avendb/docs/ARCHITECTURE.md §8). Call avendb_vaults first: it says who {name} is, its device vault and \
             the aven it is under, once its person added it, and which vaults it sees. Read with avendb_ask; change \
             with avendb_run, which acts as {name}'s device vault by the shares its aven passed on to it: on a vault \
             where it may only suggest, write on a proposal (`propose`, then ops with its `line`), and its person \
             merges it. Save a file of this Mac into a vault with avendb_run: a `put_file` op (`vault`, `name`, and \
             `media` and `tags` if any), and the file's absolute `path` beside the op. It makes a new entry of type \
             file, so only where its shares let it create, as an Editor's do, not where it may only suggest. For \
             access it lacks, ask its person with avendb_request_access, saying why: they answer in The OS app.",
            name = self.name
        )
    }

    /// Tool `name` with `args`: its text.
    async fn call(&self, name: &str, args: &Value) -> Result<String> {
        let vault = self.node.read(|lab, me| lab.vault_of(me)).await;
        if name == "avendb_request_access" {
            return self.ask_access(vault, args).await;
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
                 avenDB shows it, pick the vaults their aven passes on to it, and approve with one touch of their \
                 passkey. Then call this again.",
                self.name
            ));
        };
        match name {
            "avendb_vaults" => {
                let world = self.node.op(json!({ "op": "world" })).await?;
                let world = &world["ok"];
                let all = world["vaults"].as_array().cloned().unwrap_or_default();
                let vaults: Vec<Value> =
                    all.iter().map(|v| json!({ "id": v["id"], "name": v["name"], "kind": v["kind"] })).collect();
                // the aven over its device vault, its one owner, by its name where the agent reads its profile
                let over = move |lab: &Lab, me| match lab.state(me).vault(vault)?.owners[..] {
                    [Principal::Vault(aven)] => Some(aven),
                    _ => None,
                };
                let aven = self.node.read(over).await.map(|a| hex(&a.0));
                let named = |id: &Option<String>| all.iter().find(|v| v["id"].as_str() == id.as_deref());
                let aven_name = named(&aven).map_or(Value::Null, |v| v["name"].clone());
                let me = json!({ "device": self.name, "vault": hex(&vault.0), "aven": aven, "avenName": aven_name,
                    "key": hex(&self.node.device().0) });
                let under = aven_name.as_str().map(String::from).or(aven).unwrap_or_else(|| "no aven".into());
                let who = format!("{} is an agent under the aven {under}, acting as its own device vault", self.name);
                Ok(json!({ "who": who, "me": me, "vaults": vaults }).to_string())
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
                if matches!(op_name(&op), Some("follow" | "set_limits")) {
                    let setting = "a device's own setting, which an agent keeps nowhere";
                    anyhow::bail!("{:?} isn't for an agent: {setting}", op_name(&op));
                }
                // as every device runs it, acting as its device vault, the shares its aven passed on deciding; a
                // file's bytes from the path the harness names
                let path = args.get("path").and_then(Value::as_str).map(PathBuf::from);
                let (answer, _) = match (op_name(&op), path) {
                    (Some("put_file"), Some(path)) => {
                        let (op, bytes) = with_file(op, path).await?;
                        self.node.run(op, Some(bytes), None::<&NoCeremony>).await?
                    }
                    (Some("put_file"), None) => {
                        anyhow::bail!("put_file saves a file of this Mac: give its absolute path beside the op")
                    }
                    (_, Some(_)) => anyhow::bail!("a path goes beside put_file alone"),
                    (_, None) => self.node.run(op, None::<NoBytes>, None::<&NoCeremony>).await?,
                };
                Ok(answer.to_string())
            }
            other => anyhow::bail!("no tool {other:?}"),
        }
    }

    /// Asks its person for the access `args` name, a level of `LEVELS` and why, and the vaults it names, if any. Once
    /// it is a device of its device vault `vault`, as anyone asks: a request its vault writes and shares with the aven
    /// over it, its one owner (the ops engine's `ask`), which sync carries to its person's devices, through the server
    /// too. Before, as it can write nothing yet: a request left for their page, in place of any it left before, with
    /// its offer.
    async fn ask_access(&self, vault: Option<VaultId>, args: &Value) -> Result<String> {
        let level = args["level"].as_str().unwrap_or(ASKS);
        anyhow::ensure!(LEVELS.contains(&level), "{level:?} is no level to ask for: one of {}", LEVELS.join(", "));
        let why = args["why"].as_str().map(str::trim).unwrap_or_default();
        anyhow::ensure!(!why.is_empty(), "say why: its person reads it before they answer");
        let vaults: Vec<String> =
            args["vaults"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect();
        let answers = "Its person sees the request in The OS app and answers it there; avendb_ask with \
                       {\"op\": \"requests\"} shows its answer once it comes, and avendb_vaults what it has.";
        if let Some(vault) = vault {
            let over = move |lab: &Lab, me| match lab.state(me).vault(vault)?.owners[..] {
                [Principal::Vault(aven)] => Some(aven),
                _ => None,
            };
            let aven = self.node.read(over).await.context("its device vault has its aven, its one owner")?;
            let ask = json!({ "op": "ask", "to": hex(&aven.0), "level": level, "why": why, "vaults": vaults });
            let asked = self.node.op(ask).await?;
            if let Some(refused) = asked.get("refused") {
                bail!("the request is refused ({refused}): {}", asked["why"]);
            }
            return Ok(format!("Asked its aven for {level} access, as a request in {}'s vault. {answers}", self.name));
        }
        let (device, offer) = (hex(&self.node.device().0), Some(self.node.offer().to_text()));
        let ask = Asking { level: level.to_string(), why: why.to_string(), vaults };
        let asked = asking(&self.name, &device, offer, &ask);
        std::fs::create_dir_all(agents(&self.host))?;
        std::fs::remove_file(denied(&self.host, &self.name)).ok();
        std::fs::write(request(&self.host, &self.name), asked.to_string())?;
        Ok(format!("Asked for {level} access. {answers}"))
    }
}

/// The tools it offers.
fn tools() -> Value {
    let one = json!({ "type": "object", "description": "One op of avenDB's engine, as JSON" });
    let op = json!({ "type": "object", "properties": { "op": one }, "required": ["op"] });
    let path = "For put_file alone: the absolute path of the file on this Mac it saves";
    let run = json!({
        "type": "object",
        "properties": { "op": one, "path": { "type": "string", "description": path } },
        "required": ["op"],
    });
    json!([
        {
            "name": "avendb_vaults",
            "description": "Who this agent device is (its name, its own device vault, the aven it is under and \
                            its key) and the vaults it sees, each its id, name and kind; or that its person has yet to \
                            answer its request.",
            "inputSchema": { "type": "object", "properties": {} },
        },
        {
            "name": "avendb_ask",
            "description": "Run a read op of avenDB's engine as this agent: query, get, history, schemas, groups, \
                            world, jobs, shares, database, note, creatable, taggable, requests, may.",
            "inputSchema": op,
        },
        {
            "name": "avendb_request_access",
            "description": "Ask this agent's person for access it lacks: a level (Viewer reads, Suggester reads and \
                            writes on proposals they merge, Editor reads and changes), why, and optionally the ids of \
                            the vaults it asks for. Once it is added, a request its vault shares with its aven. They \
                            answer in The OS app, picking the vaults and levels their aven passes on to it.",
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
                            unset, insert, remove, move, tag, propose, merge, restore, undo, variant, batch, \
                            put_file. Where it may only suggest, write on a proposal. put_file saves a file of this \
                            Mac into a vault as a new entry of type file, where the agent may create: the op names \
                            its vault and name, and media and tags if any, and the file's absolute path goes beside \
                            the op as path; its len is the file's size unless the op gives one.",
            "inputSchema": run,
        },
    ])
}

/// Put_file op `op` with the file at `path` on this Mac, which the harness names: its length the file's size where the
/// op gives none, and its bytes as the node reads them (`read_path`). Fails if `path` names no file, or isn't absolute,
/// as the harness's folder needn't be the agent's.
async fn with_file(mut op: Value, path: PathBuf) -> Result<(Value, impl FnMut() -> Chunks + Send)> {
    anyhow::ensure!(path.is_absolute(), "{} isn't an absolute path", path.display());
    let meta = tokio::fs::metadata(&path).await.with_context(|| format!("no file at {}", path.display()))?;
    anyhow::ensure!(meta.is_file(), "{} is no file", path.display());
    if let Some(o) = op.as_object_mut() {
        o.entry("len").or_insert(meta.len().into());
    }
    Ok((op, read_path(path)))
}

/// A pass of a file's bytes, as the node reads it (`avendb_net::Source`).
type Chunks = Pin<Box<dyn Stream<Item = io::Result<Bytes>> + Send>>;

/// The file at `path` as the node reads it (`avendb_net::Source`), twice, for its key and then to seal it: opened
/// again each time and read from its start, a mebibyte at a time.
fn read_path(path: PathBuf) -> impl FnMut() -> Chunks + Send {
    move || -> Chunks {
        let path = path.clone();
        Box::pin(stream::try_unfold(None, move |file: Option<File>| {
            let path = path.clone();
            async move {
                let mut file = match file {
                    Some(file) => file,
                    None => File::open(&path).await?,
                };
                let mut chunk = BytesMut::with_capacity(CHUNK);
                while chunk.len() < CHUNK && file.read_buf(&mut chunk).await? > 0 {}
                Ok::<_, io::Error>((!chunk.is_empty()).then(|| (chunk.freeze(), Some(file))))
            }
        }))
    }
}

/// The name op `op` gives itself, as it is or not.
fn op_name(op: &Value) -> Option<&str> {
    op.get("op").and_then(Value::as_str)
}

/// Bytes in lowercase hex.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
