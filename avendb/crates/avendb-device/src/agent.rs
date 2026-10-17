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
//! own settings, which an agent keeps nowhere. `get_file`, the mirror of `put_file` and the agent's own op, reads a
//! file of a vault's Library back as the page's Library reads it (`read_file`), a window at a time, from its own shelf
//! or else from the Mac's one store, and writes it to the `path` beside the op, never over a file there unless
//! `overwrite` is beside it too; a small text file comes back inline as well. Two named tools do what an agent does
//! most: `avendb_add_spark` captures a spark as the page's Sparks capture one, the same `create` op run as
//! `avendb_run` runs it, into its person's own vault unless it names another; `avendb_add_artifact` adds a source fact
//! as the page's Artifacts add one, a link or a file of this Mac saved to the Library first, and puts it on a spark's
//! canvas where it names one; and `avendb_read_file` is `get_file`.

use std::io;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::engine;
use avendb::id::{ShareId, SignerId, VaultId};
use avendb::lab::{Lab, NewShare};
use avendb::policy::{Issued, Kind, Level, Principal, State, Vault, Who};
use avendb::rules;
use avendb::slice::{Atom, Selector};
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

/// How many bytes of a file it reads back (`get_file`) it asks its node for at a time, as the page's Library does.
const WINDOW: u64 = 4 << 20;

/// The most bytes of a file read back (`get_file`) that come back inline too, as text: 64 KiB.
const INLINE: u64 = 64 << 10;

/// The type of a spark's entry, and the kind of its record: avenDB's own `spark` schema.
const SPARK: &str = "spark";

/// The longest title a spark takes from the first line of its text, in letters, as the page's Sparks cut one.
const TITLE: usize = 80;

/// The type of an artifact's entry, and the kind of its record: avenDB's own `artifact` schema.
const ARTIFACT: &str = "artifact";

/// The type of a Library file's entry, as put_file makes one.
const FILE: &str = "file";

/// A card on a spark's canvas, as the page's sparks.js lays them out (`CARD`): its height, the gap between cards, and
/// the room around them.
const CARD_H: i64 = 170;
const CARD_GAP: i64 = 24;
const CARD_PAD: i64 = 32;

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
const ASKS: &str = SUGGESTS;

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

/// The level whose agents also open AIPs: a Suggester writes only on proposals, and bundles its lines in an AIP for its
/// person to review (`pass_on_aips`).
pub const SUGGESTS: &str = "Suggester";

/// The name of the group of its own an agent given Suggester over a vault gets there besides (`aip_author`): it opens
/// AIPs, Aven Improvement Proposals, over the proposal lines it wrote, and moves them on as their author.
pub const AIP_AUTHOR: &str = "AIP author";

/// The type of an AIP's entry (avendb's `engine::aips::AIP`).
const AIP: &str = "aip";

/// What an AIP author's share gives (`AIP_AUTHOR`): its ops, adding an entry and setting any of its fields, with a
/// writer's read; and what it is on, the vault's AIPs alone. So an agent that may only suggest elsewhere in the vault
/// opens an AIP over its own proposal lines (the ops engine's `aip_open`), promotes it and withdraws it as its author
/// (`aip_promote`, `aip_withdraw`), and changes nothing else: the vault alone reviews it, and its acceptance merges the
/// lines.
pub fn aip_author() -> (Vec<rules::Op>, Selector) {
    let ops = vec![rules::Op::Read, rules::Op::Create, rules::Op::Set { path: vec![], to: None, on: None }];
    (ops, Selector::AnyOf(vec![vec![Atom::TypeIn(vec![AIP.into()])]]))
}

/// Aven `aven` passes an AIP author's share over vault `over` (`aip_author`) on to its agent's device vault `vault`,
/// beside the Suggester's share `pass_on` passes on to it there, on device `me` of the person whose vault is `mine`,
/// acting as the aven, with no ceremony, as `pass_on` passes a share on: resting on one the aven holds over `over` that
/// gives all it gives and reaches the vault's AIPs, an AIP author's own or one on the whole vault, such as an Editor's
/// (`world::gives`), so that taking that one back ends it too. Over a vault `mine` is or owns, `over` gives the aven an
/// AIP author's share first where it holds none such, always; over the aven itself, the aven's own; over another, as a
/// coop that hired the aven, only where the coop gave it such a share, and none where it didn't, as one gave it a
/// Suggester's alone. One the aven passed on before stands for it. The share, or none where the aven may pass none on.
pub fn pass_on_aips(
    lab: &mut Lab,
    me: SignerId,
    mine: VaultId,
    aven: VaultId,
    vault: VaultId,
    over: VaultId,
) -> Result<Option<ShareId>> {
    let (ops, select) = aip_author();
    let st = lab.state(me);
    let before = |cp: &&Issued| {
        cp.share.over == over && cp.share.issuer == aven && st.live(cp.id)
            && lab.slice(me, cp.id).is_some_and(|s| s.name == AIP_AUTHOR)
    };
    if let Some(cp) = st.shares_held(vault).find(before) {
        return Ok(Some(cp.id));
    }
    let who = Who::Vault(vault);
    // a share of the aven's that gives all it gives, on the vault's AIPs or on the whole vault
    let rests = |lab: &Lab| {
        let st = lab.state(me);
        let reaches = |p: ShareId| {
            st.share(p).is_some_and(|cp| cp.share.wide) || lab.slice(me, p).is_some_and(|s| s.select == select)
        };
        let held = world::parents(st, aven, over, who, rules::level_of(&ops), false);
        held.into_iter().find(|&p| world::gives(lab, me, p, &ops) && reaches(p))
    };
    let parent = if over == aven {
        None
    } else if let Some(p) = rests(lab) {
        Some(p)
    } else if over == mine || lab.state(me).owns(mine, over) {
        let (name, ops, select) = (AIP_AUTHOR.to_string(), ops.clone(), select.clone());
        let given = NewShare { over, who: Who::Vault(aven), name, select, ops, parent: None, issuer: over, keep: None };
        lab.issue(me, &[me], given).map_err(|why| anyhow!("the aven's AIP author share is refused: {why:?}"))?;
        Some(rests(lab).context("the aven's AIP author share to pass on")?)
    } else {
        return Ok(None);
    };
    let sub = NewShare { over, who, name: AIP_AUTHOR.to_string(), select, ops, parent, issuer: aven, keep: None };
    let sub = lab.issue(me, &[me], sub).map_err(|why| anyhow!("the agent's AIP author share is refused: {why:?}"))?;
    Ok(Some(sub))
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
             merges it; where it may merge, its merge into main counts only once the entry's vault accepted the \
             proposal (one of its owners, by a review), and brings in only the version accepted. To put changes to \
             its person, write them on proposals, then bundle those lines in an AIP (an Aven Improvement Proposal) \
             with avendb_run: `aip_open` (`vault`, `title`, a `note` saying why and what changes, and `proposals`, \
             each `{{entry, line}}` of that vault; it makes an entry of type aip, so only where its shares let it \
             create: a Suggester agent may, as its person's grant gives it an AIP author's share on the vault's AIPs \
             beside its Suggester's, and an Editor may), then `aip_promote` (`entry`), which gives it the vault's next \
             number, AIP-n. Only a promoted AIP reaches a person, who answers it whole in The OS app or at \
             /app/aips/?aip=<entry>; an agent never \
             reviews one, since `aip_review` is the vault's own. Read them with avendb_ask, `aips` or `aip` (`entry`, \
             with its diff); after a revise, write again on the same lines and promote it again: it keeps its \
             number. Save a file of this Mac into a vault with avendb_run: a `put_file` op (`vault`, `name`, and \
             `media` and `tags` if any), and the file's absolute `path` beside the op. It makes a new entry of type \
             file, so only where its shares let it create, as an Editor's do, not where it may only suggest. Read a \
             file of a vault back with avendb_read_file, or a `get_file` op on avendb_run: the file entry's `entry`, \
             or a `vault` and the file's `name`, and an absolute `path` on this Mac to write it to, never over a file \
             there unless `overwrite` is true; a text file of at most 64 KiB comes back inline too, as `text`, and \
             with no `path` inline alone. Capture a spark, anything that might become a story (a thought, a quote, a \
             note), with avendb_add_spark: its `text`, and its `title` and `tags` if any (a link or a media file goes \
             in as an artifact of its own); it goes in its person's own vault unless it names another `vault`, and \
             answers its entry. Add a source fact, a link, a YouTube video, a picture or a clip, with \
             avendb_add_artifact: its `url`, or the absolute `path` of a file on this Mac, which it saves to the \
             Library first, or both; its `title`, `note`, `by`, `taken`, `language` and `transcript` if known; and a \
             `spark` to put it on that spark's canvas. For access it lacks, ask its person with \
             avendb_request_access, saying why: they \
             answer in The OS app.",
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
                if matches!(op_name(&op), Some("read_file" | "get_file")) {
                    anyhow::bail!("a file's bytes come back with avendb_read_file, written to a path on this Mac");
                }
                if !(engine::reads(&op) || engine::asks(&op)) {
                    anyhow::bail!("{:?} is no read: change with avendb_run", engine::name(&op));
                }
                Ok(self.node.op(op).await?.to_string())
            }
            "avendb_run" => {
                let op = args.get("op").cloned().context("avendb_run takes an op")?;
                Ok(self.run(op, beside(args)?).await?.to_string())
            }
            "avendb_add_spark" => self.add_spark(vault, args).await,
            "avendb_add_artifact" => self.add_artifact(vault, args).await,
            "avendb_read_file" => {
                let named = ["entry", "vault", "name"];
                let takes = |k: &String| named.contains(&k.as_str()) || k == "path" || k == "overwrite";
                if let Some(k) = args.as_object().into_iter().flatten().map(|(k, _)| k).find(|k| !takes(k)) {
                    anyhow::bail!("avendb_read_file takes no {k:?}: entry, or vault and name; path; overwrite");
                }
                let mut op = json!({ "op": "get_file" });
                for k in named {
                    if let Some(v) = args.get(k).filter(|v| !v.is_null()) {
                        op[k] = v.clone();
                    }
                }
                let answer = self.run(op, beside(args)?).await?;
                match answer.get("ok") {
                    Some(ok) => Ok(ok.to_string()),
                    None => {
                        let (why, refused) = (answer["why"].as_str(), answer["refused"].as_str());
                        anyhow::bail!("{} ({})", why.unwrap_or_default(), refused.unwrap_or_default())
                    }
                }
            }
            other => anyhow::bail!("no tool {other:?}"),
        }
    }

    /// Change op `op` as avendb_run runs it, as every device runs it, acting as its device vault, the shares its aven
    /// passed on deciding: the engine's answer. A put_file's bytes are those of the file at the path beside it; a
    /// get_file, its own op, reads a file back to the path beside it (`get_file`). Fails before anything runs for a
    /// read, which avendb_ask runs, for a device's own setting, which an agent keeps nowhere, and for a path or
    /// `overwrite` beside an op that takes none.
    async fn run(&self, op: Value, beside: Beside) -> Result<Value> {
        let Beside { path, overwrite } = beside;
        if op_name(&op) == Some("get_file") {
            return self.get_file(&op, path, overwrite).await;
        }
        anyhow::ensure!(!overwrite, "overwrite goes beside get_file alone");
        if engine::reads(&op) || engine::asks(&op) {
            anyhow::bail!("{:?} only reads: read with avendb_ask", engine::name(&op));
        }
        if matches!(op_name(&op), Some("follow" | "set_limits")) {
            let setting = "a device's own setting, which an agent keeps nowhere";
            anyhow::bail!("{:?} isn't for an agent: {setting}", op_name(&op));
        }
        let (answer, _) = match (op_name(&op), path) {
            (Some("put_file"), Some(path)) => {
                let (op, bytes) = with_file(op, path).await?;
                self.node.run(op, Some(bytes), None::<&NoCeremony>).await?
            }
            (Some("put_file"), None) => {
                anyhow::bail!("put_file saves a file of this Mac: give its absolute path beside the op")
            }
            (_, Some(_)) => anyhow::bail!("a path goes beside put_file or get_file alone"),
            (_, None) => self.node.run(op, None::<NoBytes>, None::<&NoCeremony>).await?,
        };
        Ok(answer)
    }

    /// `{"op": "get_file", "entry"}` or `{"op": "get_file", "vault", "name"}`, the agent's own op, the mirror of
    /// `put_file`: the file of file entry `entry`, or of the newest file named `name` in vault `vault` that is not
    /// deleted, found among the file entries its world shows, as the page's Library finds them (`file_of`), and read
    /// back as the Library reads it, a window at a time (`read_file`, `Node::read_file`), from its own shelf or else
    /// from a peer that may hand it over, as the Mac's one store, the shares its aven passed on deciding: only a file
    /// of an entry they let it read. Its bytes are written to `path` on this Mac, an absolute path in a folder that is
    /// there, where no file is unless `overwrite`: into a file beside it first, put in its place once whole, so that a
    /// read cut short leaves nothing there. A text file of at most `INLINE` bytes comes back inline too, as `text`; one
    /// with no `path` inline alone. `{"ok": {"entry", "vault", "name", "media", "len", "path"?, "text"?}}`, or the
    /// refusal, as the engine words one. Fails before it reads a byte where it can't write `path`, or where no `path`
    /// is given for a file larger than `INLINE`; and with no `path`, for a file that is no text.
    async fn get_file(&self, op: &Value, path: Option<PathBuf>, overwrite: bool) -> Result<Value> {
        let Found { entry, vault, name, media, root, size, len } = match self.file_of(op).await? {
            Ok(found) => found,
            Err(refused) => return Ok(refused),
        };
        let inline = len <= INLINE;
        if path.is_none() && !inline {
            let most = INLINE >> 10;
            anyhow::bail!("{name} is {len} bytes: give an absolute path beside the op to write it to; it comes back \
                           inline alone only as a text file of at most {most} KiB");
        }
        if let Some(path) = &path {
            writable(path, overwrite).await?;
        }
        let mut part = match &path {
            Some(path) => Some(Part::beside(path).await?),
            None => None,
        };
        let mut text = inline.then(Vec::new);
        let mut at = 0;
        while at < len {
            let to = (at + WINDOW).min(len);
            let read = json!({ "op": "read_file", "root": root, "size": size, "from": at, "to": to });
            let read = self.node.run(read, None::<NoBytes>, None::<&NoCeremony>).await;
            let (answer, bytes) = read.with_context(|| format!("{name} isn't read"))?;
            if answer.get("refused").is_some() {
                return Ok(answer);
            }
            let bytes = bytes.context("read_file brings the file's bytes")?;
            anyhow::ensure!(bytes.len() as u64 == to - at, "{name}'s bytes from {at} on came short");
            if let Some(part) = &mut part {
                part.write(&bytes).await?;
            }
            if let Some(text) = &mut text {
                text.extend_from_slice(&bytes);
            }
            at = to;
        }
        let text = text.and_then(|bytes| String::from_utf8(bytes).ok());
        let mut ok = json!({ "entry": entry, "vault": vault, "name": name, "media": media, "len": len });
        match (part, &path) {
            (Some(part), Some(path)) => {
                part.done(path, overwrite).await?;
                ok["path"] = path.display().to_string().into();
            }
            _ if text.is_none() => {
                anyhow::bail!("{name} is no text: give an absolute path beside the op to write its bytes to")
            }
            _ => {}
        }
        if let Some(text) = text {
            ok["text"] = text.into();
        }
        Ok(json!({ "ok": ok }))
    }

    /// The file get_file op `op` names, among the file entries its device's world shows (the `world` op), as the
    /// page's Library lists them: or a refusal, as the engine words one, where the op names none, the agent reads no
    /// such file entry, or its device opens no write that brings the file.
    async fn file_of(&self, op: &Value) -> Result<Result<Found, Value>> {
        let refused = |name: &str, why: String| Ok(Err(json!({ "refused": name, "why": why })));
        let Some(o) = op.as_object() else { return refused("BadOp", "an op is a JSON object".into()) };
        if let Some(k) = o.keys().find(|k| !["op", "entry", "vault", "name"].contains(&k.as_str())) {
            return refused("BadOp", format!("get_file takes no field {k:?}"));
        }
        let text = |k: &str| o.get(k).and_then(Value::as_str).map(str::trim);
        let world = self.node.op(json!({ "op": "world" })).await?;
        let entries = world["ok"]["entries"].as_array().cloned().unwrap_or_default();
        let me = &self.name;
        let e = match (text("entry"), text("vault"), text("name")) {
            (Some(entry), None, None) => {
                let entry = entry.to_ascii_lowercase();
                let Some(e) = entries.iter().find(|e| e["entry"] == entry.as_str()) else {
                    let none = "none of its shares reaches it, or there is none";
                    return refused("NoEntry", format!("{me} reads no entry {entry}: {none}"));
                };
                if e["kind"] != "file" {
                    let what = "get_file reads a file of a vault's Library, as put_file saves one";
                    let kind = e["kind"].as_str().unwrap_or("sealed");
                    return refused("BadOp", format!("entry {entry} is a {kind}, not a file: {what}"));
                }
                e
            }
            (None, Some(vault), Some(name)) => {
                let vault = vault.to_ascii_lowercase();
                let named = |e: &&Value| {
                    e["kind"] == "file" && e["vault"] == vault.as_str() && e["title"] == name && e["deleted"] != true
                };
                let Some(e) = entries.iter().filter(named).max_by_key(|e| e["created"].as_u64()) else {
                    let none = "none is there, or none of its shares reaches it";
                    return refused("NoEntry", format!("{me} reads no file named {name:?} in vault {vault}: {none}"));
                };
                e
            }
            _ => return refused("BadOp", "get_file names its file: entry, or vault and name".into()),
        };
        let at = |k: &str| e[k].as_str().unwrap_or_default().to_string();
        let (entry, file) = (at("entry"), &e["files"][0]);
        let (Some(root), Some(size)) = (file["root"].as_str(), file["size"].as_u64()) else {
            let why = format!("the write that brings the file of entry {entry} hasn't reached {me} yet");
            return refused("NoEntry", why);
        };
        let Some(len) = file["len"].as_u64() else {
            let no = "no share of its lets it read the write that brings it";
            return refused("NoCap", format!("{me} opens no file of entry {entry}: {no}"));
        };
        let (vault, name, media, root) = (at("vault"), at("title"), at("media"), root.to_string());
        Ok(Ok(Found { entry, vault, name, media, root, size, len }))
    }

    /// Adds a spark (`avendb_add_spark`) as the page's Sparks capture one (src/lib/avendb/sparks.js, `sparkRecord`): a
    /// record of avenDB's own `spark` schema titled `title`, or else by the first line of its `text`, cut at a word
    /// past `TITLE` letters (`title_of`), its opening heading (block 1) the title too and, where the text says more, a
    /// paragraph (block 2) that reads it: its kind, title and blocks alone, which every version of the schema reads
    /// alike; a link or a media file goes in as an artifact of its own. It goes in vault `vault`, else in its person's
    /// own vault, the human vault over its aven (`person_of`), as a new entry of type spark tagged `tags` and the tags
    /// a share it adds through asks for (the `creatable` op), by the op the page runs, `create`, run as avendb_run runs
    /// a change (`run`). `{"entry", "vault", "tags"}`. Fails with why, in words: where it may add no spark, the vaults
    /// it may.
    async fn add_spark(&self, mine: VaultId, args: &Value) -> Result<String> {
        const TAKES: [&str; 4] = ["text", "title", "tags", "vault"];
        if let Some(k) = args.as_object().into_iter().flatten().map(|(k, _)| k).find(|k| !TAKES.contains(&k.as_str())) {
            let artifact = "a link or a media file goes in as an artifact of its own";
            anyhow::bail!("a spark has no {k:?}: it takes {}; {artifact}", TAKES.join(", "));
        }
        let given = |k: &str| args.get(k).filter(|v| !v.is_null());
        let text = given("text").and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty());
        let text = text.context("a spark has its words: text")?;
        let title = match given("title") {
            Some(t) => t.as_str().context("a spark's title is some text")?.trim().to_string(),
            None => title_of(text),
        };
        let mut blocks = vec![json!({ "id": 1, "type": "heading", "level": 1, "text": title })];
        if text != title {
            blocks.push(json!({ "id": 2, "type": "paragraph", "text": text }));
        }
        let value = json!({ "kind": SPARK, "title": title, "blocks": blocks });
        let tags: Vec<String> = match given("tags") {
            None => vec![],
            Some(t) => {
                let texts = t.as_array().and_then(|t| t.iter().map(|x| x.as_str().map(String::from)).collect());
                texts.context("a spark's tags are a list of texts")?
            }
        };
        let named = match given("vault") {
            Some(v) => Some(v.as_str().context("vault is a vault's id, 64 hex digits")?.trim().to_ascii_lowercase()),
            None => None,
        };
        let person = self.node.read(move |lab, me| person_of(lab.state(me), mine)).await;
        let into = named.clone().or(person.map(|p| hex(&p.0)));
        let asked = match &into {
            Some(v) => self.creatable(v, SPARK, &tags).await?,
            None => None,
        };
        let (Some(vault), Some(asked)) = (into.clone(), asked) else {
            let me = &self.name;
            let (vaults, may) = self.creatable_in(mine, SPARK, &tags).await?;
            let what = match (&named, &into) {
                (Some(v), _) => format!("vault {}", label(&vaults, v)),
                (None, Some(v)) => format!("its person's own vault, {}", label(&vaults, v)),
                (None, None) => "its person's own vault, which it doesn't know".into(),
            };
            let may = if may.is_empty() {
                "It may add sparks to no vault: ask its person for Editor access with avendb_request_access".into()
            } else {
                format!("It may add sparks to {}: name one as vault", may.join(", "))
            };
            anyhow::bail!("{me} may add no spark to {what}: no share of its lets it create one there. {may}.");
        };
        let tags = [tags, asked].concat();
        let op = json!({ "op": "create", "vault": vault, "type": SPARK, "tags": tags, "value": value });
        let answer = self.run(op, Beside::default()).await?;
        match (answer["ok"]["entry"].as_str(), answer.get("refused")) {
            (Some(entry), _) => Ok(json!({ "entry": entry, "vault": vault, "tags": tags }).to_string()),
            (None, Some(refused)) => {
                let (why, refused) = (answer["why"].as_str(), refused.as_str());
                anyhow::bail!("the spark isn't added: {} ({})", why.unwrap_or_default(), refused.unwrap_or_default())
            }
            (None, None) => anyhow::bail!("the spark isn't added: its person's passkey would approve it ({answer})"),
        }
    }

    /// Adds an artifact (`avendb_add_artifact`) as the page's Artifacts add one (src/lib/avendb/artifacts.js): a source
    /// fact of avenDB's own `artifact` schema, standing on its own. A `url` makes it what the link is (`look_of`): a
    /// YouTube video, another video or podcast by its host, a picture or a clip by its ending, else a bookmark, on the
    /// site its host is, by the platform we know it as. A `path` names a file of this Mac, saved to the Library first
    /// as a put_file saves it, which the artifact shows (`files`), a picture an image and a film or a sound a video.
    /// Titled `title`, else by its link (`link_title`), else by its file's name; with its `note`, `by`, `taken` and
    /// `language` where given, and its `transcript`, a paragraph a row, each from the time it starts with, if any
    /// (`rows_of`). It goes in vault `vault`, else in its person's own vault, as add_spark's does, as a new entry of
    /// type artifact tagged `tags` and the tags a share it adds through asks for; and where `spark` names a spark, it
    /// is put on that spark's canvas too, under the rest (`put_on`). `{"entry", "vault", "tags", "look", "file"?,
    /// "spark"?}`, `spark` what became of the placing. Fails with why, in words, before it saves anything where it may
    /// add no artifact, or no file, there.
    async fn add_artifact(&self, mine: VaultId, args: &Value) -> Result<String> {
        const TAKES: [&str; 11] =
            ["url", "path", "title", "note", "by", "taken", "language", "transcript", "tags", "vault", "spark"];
        if let Some(k) = args.as_object().into_iter().flatten().map(|(k, _)| k).find(|k| !TAKES.contains(&k.as_str())) {
            anyhow::bail!("an artifact has no {k:?}: it takes {}", TAKES.join(", "));
        }
        let given = |k: &str| args.get(k).filter(|v| !v.is_null());
        let text = |k: &str| -> Result<Option<String>> {
            match given(k) {
                None => Ok(None),
                Some(v) => {
                    let t = v.as_str().with_context(|| format!("an artifact's {k} is some text"))?.trim();
                    Ok((!t.is_empty()).then(|| t.to_string()))
                }
            }
        };
        let url = text("url")?;
        let path = text("path")?.map(PathBuf::from);
        anyhow::ensure!(
            url.is_some() || path.is_some(),
            "an artifact is a link or a file: its url, or the absolute path of a file on this Mac, or both"
        );
        let link = match &url {
            Some(u) => Some(link_of(u).with_context(|| format!("{u:?} is no link: one starts with https://"))?),
            None => None,
        };
        if let Some(path) = &path {
            anyhow::ensure!(path.is_absolute(), "{} isn't an absolute path", path.display());
            let meta = tokio::fs::metadata(path).await.with_context(|| format!("no file at {}", path.display()))?;
            anyhow::ensure!(meta.is_file(), "{} is no file", path.display());
        }
        let by = match given("by") {
            None => None,
            Some(by) => {
                let o = by.as_object().context("an artifact's by is who made it: name, url, image, platform")?;
                let takes = ["name", "url", "image", "platform"];
                if let Some(k) = o.keys().find(|k| !takes.contains(&k.as_str())) {
                    anyhow::bail!("by has no {k:?}: it takes {}", takes.join(", "));
                }
                anyhow::ensure!(o.values().all(Value::is_string), "by's name, url, image and platform are texts");
                Some(o.clone())
            }
        };
        let tags: Vec<String> = match given("tags") {
            None => vec![],
            Some(t) => {
                let texts = t.as_array().and_then(|t| t.iter().map(|x| x.as_str().map(String::from)).collect());
                texts.context("an artifact's tags are a list of texts")?
            }
        };
        let spark = text("spark")?.map(|s| s.to_ascii_lowercase());
        let named = text("vault")?.map(|v| v.to_ascii_lowercase());
        let person = self.node.read(move |lab, me| person_of(lab.state(me), mine)).await;
        let into = named.clone().or(person.map(|p| hex(&p.0)));
        // where it may add the artifact, and its file first, if it brings one
        let mut asked = None;
        if let Some(v) = &into {
            let file = match &path {
                Some(_) => self.creatable(v, FILE, &[]).await?,
                None => Some(vec![]),
            };
            asked = match (file, self.creatable(v, ARTIFACT, &tags).await?) {
                (Some(file), Some(artifact)) => Some((file, artifact)),
                _ => None,
            };
        }
        let (Some(vault), Some((file_tags, asked))) = (into.clone(), asked) else {
            let me = &self.name;
            let (vaults, may) = self.creatable_in(mine, ARTIFACT, &tags).await?;
            let what = match (&named, &into) {
                (Some(v), _) => format!("vault {}", label(&vaults, v)),
                (None, Some(v)) => format!("its person's own vault, {}", label(&vaults, v)),
                (None, None) => "its person's own vault, which it doesn't know".into(),
            };
            let may = if may.is_empty() {
                "It may add artifacts to no vault: ask its person for Editor access with avendb_request_access".into()
            } else {
                format!("It may add artifacts to {}: name one as vault", may.join(", "))
            };
            let file = if path.is_some() { " and its file" } else { "" };
            anyhow::bail!("{me} may add no artifact{file} to {what}: no share of its lets it create one there. {may}.");
        };
        // its file, saved to the Library first
        let mut file = None;
        if let Some(path) = path {
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).context("the path names no file")?;
            let media = media_of(&name);
            let op = json!({ "op": "put_file", "vault": vault, "name": name, "media": media, "tags": file_tags });
            let answer = self.run(op, Beside { path: Some(path), overwrite: false }).await?;
            let Some(entry) = answer["ok"]["entry"].as_str() else {
                let (why, refused) = (answer["why"].as_str(), answer["refused"].as_str());
                anyhow::bail!("its file isn't saved: {} ({})", why.unwrap_or_default(), refused.unwrap_or_default());
            };
            file = Some((entry.to_string(), name, media));
        }
        let look = look_of(link.as_ref(), file.as_ref().map(|(_, _, media)| *media));
        let title = match text("title")? {
            Some(title) => title,
            None => match (&link, &file) {
                (Some(link), _) => link_title(link),
                (None, Some((_, name, _))) => name.clone(),
                (None, None) => unreachable!("a link or a file, as checked"),
            },
        };
        let mut value = json!({ "kind": ARTIFACT, "look": look, "title": title });
        if let (Some(url), Some(link)) = (&url, &link) {
            value["url"] = url.as_str().into();
            value["site"] = link.host.as_str().into();
        }
        let mut by = by.unwrap_or_default();
        if let Some(platform) = link.as_ref().and_then(|l| platform_of(&l.host)) {
            by.entry("platform").or_insert(platform.into());
        }
        if !by.is_empty() {
            value["by"] = by.into();
        }
        for k in ["note", "taken", "language"] {
            if let Some(t) = text(k)? {
                value[k] = t.into();
            }
        }
        if let Some(t) = text("transcript")? {
            value["transcript"] = rows_of(&t).into();
        }
        if let Some((entry, _, _)) = &file {
            value["files"] = json!([{ "vault": vault, "entry": entry }]);
        }
        let tags = [tags, asked].concat();
        let op = json!({ "op": "create", "vault": vault, "type": ARTIFACT, "tags": tags, "value": value });
        let answer = self.run(op, Beside::default()).await?;
        let entry = match (answer["ok"]["entry"].as_str(), answer.get("refused")) {
            (Some(entry), _) => entry.to_string(),
            (None, Some(refused)) => {
                let (why, refused) = (answer["why"].as_str(), refused.as_str());
                anyhow::bail!("the artifact isn't added: {} ({})", why.unwrap_or_default(), refused.unwrap_or_default())
            }
            (None, None) => anyhow::bail!("the artifact isn't added: its person's passkey would approve it ({answer})"),
        };
        let mut made = json!({ "entry": entry, "vault": vault, "tags": tags, "look": look });
        if let Some((file, _, _)) = file {
            made["file"] = file.into();
        }
        if let Some(spark) = spark {
            made["spark"] = match self.put_on(&spark, &vault, &entry).await {
                Ok(()) => json!({ "entry": spark, "placed": true }),
                Err(why) => json!({ "entry": spark, "placed": false, "why": format!("{why:#}") }),
            };
        }
        Ok(made.to_string())
    }

    /// Puts artifact `entry` of vault `vault` on the canvas of spark `spark`, as the page puts a piece there: an item
    /// of its `items` that links to it, under the lowest card, from the left (sparks.js, `placing`), with an id no item
    /// has. Fails with why where it reads no such spark, or may not change it, as where it may only suggest.
    async fn put_on(&self, spark: &str, vault: &str, entry: &str) -> Result<()> {
        let got = self.node.op(json!({ "op": "get", "entry": spark })).await?;
        if let Some(refused) = got["refused"].as_str() {
            bail!("{} reads no spark {spark} ({refused})", self.name);
        }
        let record = &got["ok"]["record"];
        anyhow::ensure!(record["kind"] == SPARK, "entry {spark} is no spark");
        let items = record["items"].as_array().cloned().unwrap_or_default();
        let y = items
            .iter()
            .map(|i| i["y"].as_i64().unwrap_or(0) + i["h"].as_i64().unwrap_or(CARD_H))
            .max()
            .map_or(CARD_PAD, |low| low + CARD_GAP);
        let taken: Vec<u64> = items.iter().filter_map(|i| i["id"].as_u64()).collect();
        let id = loop {
            let mut b = [0u8; 4];
            getrandom::fill(&mut b).map_err(|e| anyhow!("no randomness: {e}"))?;
            let id = 1 + u64::from(u32::from_le_bytes(b) >> 2);
            if !taken.contains(&id) {
                break id;
            }
        };
        let link = json!({ "vault": vault, "entry": entry });
        let item = json!({ "id": id, "what": ARTIFACT, "ref": link, "x": CARD_PAD, "y": y });
        let op = json!({ "op": "insert", "entry": spark, "path": ["items"], "value": item });
        let answer = self.run(op, Beside::default()).await?;
        if let Some(refused) = answer["refused"].as_str() {
            let why = answer["why"].as_str().unwrap_or_default();
            bail!("it isn't on the spark's canvas: {why} ({refused}); where it may only suggest, propose it");
        }
        Ok(())
    }

    /// The tags a new entry of type `kind` tagged `tags` in vault `vault` carries besides, as a share it adds through
    /// asks for (the `creatable` op): none where no share of its lets it create one there. Fails where the vault's id
    /// is none.
    async fn creatable(&self, vault: &str, kind: &str, tags: &[String]) -> Result<Option<Vec<String>>> {
        let ask = json!({ "op": "creatable", "vault": vault, "type": kind, "tags": tags });
        let answer = self.node.op(ask).await?;
        if answer["refused"] == "BadOp" {
            anyhow::bail!("{}", answer["why"].as_str().unwrap_or_default());
        }
        let asked = answer["ok"]["tags"].as_array();
        Ok(asked.map(|t| t.iter().filter_map(|t| t.as_str().map(String::from)).collect()))
    }

    /// The vaults its world shows, and of them, by their names, those but its own device vault `mine` where it may add
    /// an entry of type `kind` tagged `tags` (`creatable`).
    async fn creatable_in(&self, mine: VaultId, kind: &str, tags: &[String]) -> Result<(Vec<Value>, Vec<String>)> {
        let world = self.node.op(json!({ "op": "world" })).await?;
        let vaults = world["ok"]["vaults"].as_array().cloned().unwrap_or_default();
        let mut may = vec![];
        for v in &vaults {
            let Some(id) = v["id"].as_str().filter(|id| *id != hex(&mine.0)) else { continue };
            if self.creatable(id, kind, tags).await?.is_some() {
                may.push(label(&vaults, id));
            }
        }
        Ok((vaults, may))
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
    let path = "For put_file: the absolute path of the file on this Mac it saves; for get_file: the absolute path on \
                this Mac it writes the file it reads to";
    let overwrite = "For get_file alone: true to replace a file at path, which it never does otherwise";
    let run = json!({
        "type": "object",
        "properties": {
            "op": one,
            "path": { "type": "string", "description": path },
            "overwrite": { "type": "boolean", "description": overwrite },
        },
        "required": ["op"],
    });
    let text = |description: &str| json!({ "type": "string", "description": description });
    let spark = json!({
        "type": "object",
        "properties": {
            "text": text("Its words: a thought, a quote, a note. Its first line titles it, cut at a word past 80 \
                          letters, unless title does"),
            "title": text("Its title, if not its text's first line"),
            "tags": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Its tags; those a share it adds through asks for besides are added",
            },
            "vault": text("The id of the vault it goes in (avendb_vaults lists them); left out, its person's own"),
        },
        "required": ["text"],
    });
    let artifact = json!({
        "type": "object",
        "properties": {
            "url": text("Its link: a web page, a YouTube video, a post, a picture or a clip on the web"),
            "path": text("The absolute path of a file on this Mac (a picture, a film, a sound), saved to the \
                          Library first and shown by the artifact"),
            "title": text("Its title; left out, its link's (a YouTube video by its id) or its file's name"),
            "note": text("Our note on it: why it matters"),
            "by": {
                "type": "object",
                "description": "Who made it, where it isn't ours",
                "properties": {
                    "name": { "type": "string" },
                    "url": { "type": "string" },
                    "image": { "type": "string" },
                    "platform": { "type": "string" },
                },
            },
            "taken": text("When it was made or published, as a date"),
            "language": text("Its language, as a code such as en or de"),
            "transcript": text("Its words, as a video's transcript: a paragraph or line a row, each from the time it \
                                starts with, as 1:05 or [1:05], if any"),
            "tags": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Its tags; those a share it adds through asks for besides are added",
            },
            "vault": text("The id of the vault it goes in (avendb_vaults lists them); left out, its person's own"),
            "spark": text("The entry id of a spark to put it on, on that spark's canvas"),
        },
    });
    let file = json!({
        "type": "object",
        "properties": {
            "entry": text("The file's entry id, as put_file answers it and a query or the world shows it"),
            "vault": text("With name: the id of the vault the file is in"),
            "name": text("With vault: the file's name, as put_file named it; the newest of that name"),
            "path": text("The absolute path on this Mac it writes the file to; left out, a text file of at most 64 \
                          KiB comes back inline alone"),
            "overwrite": { "type": "boolean", "description": "true to replace a file at path, which it never does \
                                                             otherwise" },
        },
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
            "description": "Run a change op of avenDB's engine as this agent, as its shares allow: create, set, unset, \
                            insert, remove, move, tag, propose, merge, restore, undo, variant, batch, aip_open, \
                            aip_promote, aip_withdraw, put_file, get_file. Where it may only suggest, write on a \
                            proposal; put proposals to its person in an AIP: aip_open over their lines, then \
                            aip_promote. put_file saves a file of this Mac into a vault as a new entry of type file, \
                            where the agent may create: the op names its vault and name, and media and tags if any, \
                            and the file's absolute path goes beside the op as path; its len is the file's size unless \
                            the op gives one. get_file reads a file of a vault back, as avendb_read_file does: the op \
                            names its entry, or its vault and name, and the absolute path it writes to goes beside the \
                            op, with overwrite: true to replace a file there.",
            "inputSchema": run,
        },
        {
            "name": "avendb_add_spark",
            "description": "Capture a spark as this agent, as the Sparks page captures one: anything that might \
                            become a story (a thought, a quote, a note), one small entry of avenDB's spark schema. \
                            Give its text, and its title and tags, if any. A link or a media file goes in as an \
                            artifact of its own, not on the spark. It goes in its person's own vault, or in the vault \
                            named, where its shares let it create, as an Editor's do; where they don't, it says \
                            which vaults it may add sparks to. Answers the new spark's entry id, its vault and its \
                            tags.",
            "inputSchema": spark,
        },
        {
            "name": "avendb_add_artifact",
            "description": "Add an artifact as this agent, as the Artifacts page adds one: a source fact standing \
                            on its own, a bookmarked link, a YouTube video, a picture or a clip, one entry of \
                            avenDB's artifact schema. Give its url, or the absolute path of a file on this Mac, which \
                            it saves to the Library first, or both; and its title, note, by, taken, language and \
                            transcript if known. It goes in its person's own vault, or in the vault named, where its \
                            shares let it create, as an Editor's do; a spark named puts it on that spark's canvas \
                            too. Answers the new artifact's entry id, its vault, tags and look, its file's entry if \
                            it saved one, and whether it is on the spark.",
            "inputSchema": artifact,
        },
        {
            "name": "avendb_read_file",
            "description": "Read a file of a vault's Library back as this agent, where its shares let it read the \
                            file's entry: by its entry id, or the newest of a name in a vault. Its bytes are written \
                            to the absolute path on this Mac given, never over a file there unless overwrite is \
                            true; a text file of at most 64 KiB comes back inline too, as text, and with no path, \
                            inline alone. Answers its entry, vault, name, media type, length, path and text. The \
                            same as a get_file op on avendb_run.",
            "inputSchema": file,
        },
    ])
}

/// What goes beside an op on avendb_run: an absolute `path` on this Mac, the file put_file saves or where get_file
/// writes the file it reads; and for get_file, whether it may replace a file there (`overwrite`).
#[derive(Default)]
struct Beside {
    path: Option<PathBuf>,
    overwrite: bool,
}

/// What tool arguments `args` give beside their op (`Beside`). Fails for a path that is no text, or an overwrite that
/// is neither true nor false.
fn beside(args: &Value) -> Result<Beside> {
    let path = match args.get("path") {
        None | Some(Value::Null) => None,
        Some(Value::String(path)) => Some(PathBuf::from(path)),
        Some(_) => bail!("path is an absolute path on this Mac, some text"),
    };
    let overwrite = match args.get("overwrite") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(overwrite)) => *overwrite,
        Some(_) => bail!("overwrite is true or false"),
    };
    Ok(Beside { path, overwrite })
}

/// A file get_file reads, as the device's world shows its entry: the entry, its vault, its name and media type, its
/// root in hex and sealed size, and its length.
struct Found {
    entry: String,
    vault: String,
    name: String,
    media: String,
    root: String,
    size: u64,
    len: u64,
}

/// Whether get_file may write a file at `path`: an absolute path that names a file, in a folder that is there, with
/// no file there unless `overwrite`, and never a folder. Fails with why not, before a byte is read.
async fn writable(path: &Path, overwrite: bool) -> Result<()> {
    anyhow::ensure!(path.is_absolute(), "{} isn't an absolute path", path.display());
    let folder = path.parent().filter(|_| path.file_name().is_some());
    let folder = folder.with_context(|| format!("{} names no file", path.display()))?;
    let there = tokio::fs::metadata(folder).await.is_ok_and(|m| m.is_dir());
    anyhow::ensure!(there, "no folder at {}", folder.display());
    match tokio::fs::symlink_metadata(path).await {
        Ok(m) if m.is_dir() => bail!("{} is a folder", path.display()),
        Ok(_) if !overwrite => {
            bail!("a file is at {} already: give overwrite: true beside it to replace it", path.display())
        }
        _ => Ok(()),
    }
}

/// A file get_file writes, into a hidden file beside its place until it is whole (`done`): dropped before, that file
/// is removed, and nothing is left at its place.
struct Part {
    /// the file beside, until it is put in its place
    temp: Option<PathBuf>,
    file: File,
}

impl Part {
    /// A new, empty file beside `path`, named after it.
    async fn beside(path: &Path) -> Result<Part> {
        static MADE: AtomicU64 = AtomicU64::new(0);
        let n = MADE.fetch_add(1, Ordering::Relaxed);
        let name = path.file_name().context("a path that names a file")?.to_string_lossy();
        let temp = path.with_file_name(format!(".{name}.avendb-{}-{n}", std::process::id()));
        let open = tokio::fs::OpenOptions::new().write(true).create_new(true).open(&temp).await;
        let file = open.with_context(|| format!("no file can be written beside {}", path.display()))?;
        Ok(Part { temp: Some(temp), file })
    }

    async fn write(&mut self, bytes: &[u8]) -> Result<()> {
        self.file.write_all(bytes).await.context("writing the file")
    }

    /// The file whole, put in its place at `path`: unless a file came there meanwhile and `overwrite` is false.
    async fn done(mut self, path: &Path, overwrite: bool) -> Result<()> {
        self.file.flush().await?;
        self.file.sync_all().await?;
        if !overwrite && tokio::fs::symlink_metadata(path).await.is_ok() {
            bail!("a file came to {} meanwhile: give overwrite: true beside it to replace it", path.display());
        }
        let temp = self.temp.take().context("the file beside")?;
        if let Err(e) = tokio::fs::rename(&temp, path).await {
            std::fs::remove_file(&temp).ok();
            return Err(anyhow::Error::from(e).context(format!("the file isn't put at {}", path.display())));
        }
        Ok(())
    }
}

impl Drop for Part {
    fn drop(&mut self) {
        if let Some(temp) = self.temp.take() {
            std::fs::remove_file(temp).ok();
        }
    }
}

/// The title a spark takes from its text, as the page's Sparks take one from a line (sparks.js, `fromLine`): its first
/// line, or past `TITLE` letters, as much of it as fits, cut at a word, and an ellipsis.
fn title_of(text: &str) -> String {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or_default();
    if line.chars().count() <= TITLE {
        return line.to_string();
    }
    let cut: String = line.chars().take(TITLE).collect();
    let kept = cut.rfind(char::is_whitespace).map_or(cut.as_str(), |at| cut[..at].trim_end());
    format!("{kept}…")
}

/// Its person's own vault, by view `st`: the human vault that owns the aven that owns agent device vault `vault`, if
/// the device knows them.
fn person_of(st: &State, vault: VaultId) -> Option<VaultId> {
    let [Principal::Vault(aven)] = st.vault(vault)?.owners[..] else { return None };
    let [Principal::Vault(person)] = st.vault(aven)?.owners[..] else { return None };
    Some(person)
}

/// Vault `id` in words, by its name among `vaults`, as the world shows them, if it has one: `"Name" (id)`, else its id.
fn label(vaults: &[Value], id: &str) -> String {
    match vaults.iter().find(|v| v["id"] == id).and_then(|v| v["name"].as_str()).filter(|n| !n.is_empty()) {
        Some(name) => format!("{name:?} ({id})"),
        None => id.to_string(),
    }
}

/// A link, as an artifact reads it: its host without `www.` or `m.`, lower case; its path; and its query.
struct Link {
    host: String,
    path: String,
    query: String,
}

/// Text `url` as a link, where it is one: `http://` or `https://`, a host, and the rest.
fn link_of(url: &str) -> Option<Link> {
    let lower = url.to_ascii_lowercase();
    let rest = lower.strip_prefix("https://").or_else(|| lower.strip_prefix("http://"))?;
    let at = url.len() - rest.len();
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..end];
    let host = authority.rsplit('@').next().unwrap_or_default();
    let host = host.split(':').next().unwrap_or_default();
    let host = host.strip_prefix("www.").or_else(|| host.strip_prefix("m.")).unwrap_or(host).to_string();
    if host.is_empty() || host.contains(char::is_whitespace) {
        return None;
    }
    let tail = &url[at + end..];
    let tail = tail.split('#').next().unwrap_or_default();
    let (path, query) = tail.split_once('?').unwrap_or((tail, ""));
    Some(Link { host, path: path.to_string(), query: query.to_string() })
}

/// Whether host `host` is `domain` or one under it.
fn under(host: &str, domain: &str) -> bool {
    host == domain || host.strip_suffix(domain).is_some_and(|h| h.ends_with('.'))
}

/// The YouTube video link `link` is, by its id, as artifacts.js finds it (`youtubeId`): none for any other link.
fn youtube_id(link: &Link) -> Option<String> {
    let segments: Vec<&str> = link.path.split('/').filter(|s| !s.is_empty()).collect();
    if link.host == "youtu.be" {
        return segments.first().map(|s| s.to_string());
    }
    if !under(&link.host, "youtube.com") {
        return None;
    }
    if link.path == "/watch" {
        return link.query.split('&').find_map(|kv| kv.strip_prefix("v=")).filter(|v| !v.is_empty()).map(String::from);
    }
    match segments[..] {
        [kind, id, ..] if ["shorts", "embed", "live", "v"].contains(&kind) => Some(id.to_string()),
        _ => None,
    }
}

/// The platform we know host `host` as, the name a link's `by` gives, as artifacts.js names them (`PLATFORMS`).
fn platform_of(host: &str) -> Option<&'static str> {
    const PLATFORMS: [(&str, &str); 13] = [
        ("youtu.be", "youtube"),
        ("youtube.com", "youtube"),
        ("twitter.com", "x"),
        ("x.com", "x"),
        ("instagram.com", "instagram"),
        ("threads.net", "threads"),
        ("bsky.app", "bluesky"),
        ("linkedin.com", "linkedin"),
        ("facebook.com", "facebook"),
        ("tiktok.com", "tiktok"),
        ("reddit.com", "reddit"),
        ("vimeo.com", "vimeo"),
        ("spotify.com", "spotify"),
    ];
    PLATFORMS.iter().find(|(h, _)| *h == host).map(|(_, p)| *p)
}

/// What an artifact is (its `look`), as artifacts.js says (`fromLink`, `fromFile`): a YouTube video by its link; a
/// picture or a clip by its file's media type `media`; another video or podcast by its link's host; a picture or a
/// clip by its link's ending; else a link.
fn look_of(link: Option<&Link>, media: Option<&str>) -> &'static str {
    const VIDEOS: [&str; 5] = ["vimeo.com", "twitch.tv", "spotify.com", "podcasts.apple.com", "tiktok.com"];
    if link.is_some_and(|l| youtube_id(l).is_some()) {
        return "youtube";
    }
    match media.map(|m| m.split('/').next().unwrap_or_default()) {
        Some("image") => return "image",
        Some("video" | "audio") => return "video",
        _ => {}
    }
    let Some(link) = link else { return "link" };
    if VIDEOS.iter().any(|v| under(&link.host, v)) {
        return "video";
    }
    match media_of(&link.path).split('/').next() {
        Some("image") => "image",
        Some("video" | "audio") => "video",
        _ => "link",
    }
}

/// The title an artifact takes from link `link` until someone names it, as artifacts.js gives one (`fromLink`): a
/// YouTube video's by its id, any other's by its host and path, `TITLE` letters at most.
fn link_title(link: &Link) -> String {
    if let Some(id) = youtube_id(link) {
        return format!("YouTube · {id}");
    }
    let path = link.path.trim_end_matches('/');
    format!("{}{path}", link.host).chars().take(TITLE).collect()
}

/// The media type of a file named `name`, by its ending, as the Library knows the kinds it shows; else bytes.
fn media_of(name: &str) -> &'static str {
    let ending = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    match ending.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        "heic" => "image/heic",
        "svg" => "image/svg+xml",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "flac" => "audio/flac",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "vtt" => "text/vtt",
        "srt" => "application/x-subrip",
        _ => "application/octet-stream",
    }
}

/// Words as an artifact's transcript, as the page reads pasted words (legacy.js, `rowsOf`): a paragraph a row, or a
/// line a row where the words are timed line by line, each from the time it starts with (`1:05 …`, `[1:05] …`),
/// else from the last row's.
fn rows_of(text: &str) -> Vec<Value> {
    let text = text.replace("\r\n", "\n");
    let timed = |l: &str| clock_of(l).is_some();
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let pieces: Vec<String> = if lines.len() > 1 && lines.iter().filter(|l| timed(l)).count() * 2 > lines.len() {
        // timed line by line, as captions are: each timed line starts a row, the lines after it join it
        let mut rows: Vec<String> = vec![];
        for l in lines {
            match rows.last_mut() {
                Some(last) if !timed(l) => {
                    last.push(' ');
                    last.push_str(l);
                }
                _ => rows.push(l.to_string()),
            }
        }
        rows
    } else {
        text.split("\n\n").map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect()
    };
    let mut t = 0.0;
    pieces
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let words = match clock_of(p) {
                Some((at, rest)) => {
                    t = at;
                    rest
                }
                None => p.as_str(),
            };
            json!({ "id": i + 1, "t": t, "text": words.trim() })
        })
        .collect()
}

/// The time text `p` starts with, `1:05`, `1:02:03` or either in brackets, in seconds, and the words after it.
fn clock_of(p: &str) -> Option<(f64, &str)> {
    let (head, rest) = p.split_once(char::is_whitespace)?;
    let head = head.strip_prefix('[').and_then(|h| h.strip_suffix(']')).unwrap_or(head);
    let parts: Vec<&str> = head.split(':').collect();
    let fits = (2..=3).contains(&parts.len())
        && parts.iter().all(|x| !x.is_empty() && x.len() <= 2 && x.chars().all(|c| c.is_ascii_digit()))
        && parts.last().is_some_and(|s| s.len() == 2);
    if !fits {
        return None;
    }
    let seconds = parts.iter().fold(0.0, |s, x| s * 60.0 + x.parse::<f64>().unwrap_or(0.0));
    Some((seconds, rest))
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
