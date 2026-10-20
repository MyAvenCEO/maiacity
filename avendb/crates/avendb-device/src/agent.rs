//! An agent device, as an MCP server on stdio: `avendb-device agent <harness>`, which an agent harness (Claude Code,
//! Codex, Cursor, Grok, or our own native aven) starts on its person's Mac. Claude Code's is
//! `claude mcp add --scope user avendb -- <the app's avendb-device> agent claude`, the device agentClaude.
//!
//! A coop's aven is its one AI identity, avenMAIA for Maia City: a vault the coop owns alone, which lives on its
//! server, its device, and owns nothing (Samuel 2026-10-18: one aven per coop, none per person, no agent vaults under
//! an aven and no sub caps). Each harness is an agent of its own, agentClaude, agentCodex, agentCursor, agentGrok,
//! agentAven, a device with a key of its own; approved, its key joins avenMAIA as a device beside its server, and it
//! acts as avenMAIA, with avenMAIA's rights, no more and no less. Maia City decides what avenMAIA holds: given
//! Suggester and an AIP author's share, an agent proposes, drafts and opens AIPs, which a human of Maia City accepts.
//! One is taken out by removing its device from avenMAIA. No token: the device's key is who it is. The harness never
//! names or picks an aven: its person's coop's one aven is it.
//!
//! It is a device of its own (`avendb_net::server::open_agent`), in a folder of its own in the agents' folder beside
//! the Mac app's (`<app's folder>-agents/<device>`, which the app's device never clears), which keeps its key and its
//! edits and no file whole of its own accord: it reads its person's files from the Mac's one store, over iroh, so that
//! nothing is kept twice. A file it saves (`put_file`) it seals onto its own shelf, as every device does, and lets go
//! of once the Mac's device holds it whole, as that device's holdings say (`Node::holds_whole`, `Node::let_go`): from
//! then on the Mac's one store keeps it, and a read of it fetches it from there. Where the Mac keeps a light copy, the
//! agent keeps its own, the one copy on the Mac. avenDB is never reset: its folder, like the app's, keeps what it holds
//! (`disk::open`).
//!
//! It asks for access as anyone asks avenDB for it, and its person answers on the page's one consent screen: it leaves
//! an access request for the Mac app (`<app's folder>-agents/<device>.request`, `asking`): who asks, by its device's
//! name and key, why, and while it belongs to no vault, its offer. Approving adds its key to avenMAIA in one ceremony of
//! their passkey (`Node::add_device_vault_with` at `Place::Vault`), which the agent's device cosigns; from then on it
//! acts as avenMAIA by its own key. A no is left for it (`<device>.denied`, the device it said no to), and it asks no
//! more until it asks again.
//!
//! It finds the Mac's device by the offer the app leaves (`<app's folder>-agents/offer.txt`), the device whose key is
//! the offer's endpoint, and reaches it directly. While it belongs to no vault it asks that device for what it may
//! hold, so that a join it missed, as one made while it didn't run, reaches it, and it asks no more.
//!
//! However many sessions of its harness run on the Mac, each starting it, one process runs its device: the one that
//! holds its lock file (`<app's folder>-agents/<device>.lock`), which answers the others on its socket beside it
//! (`<device>.sock`), each of which relays its harness's lines (`serve`). One device is one node, one shelf and one
//! endpoint, never two of the same key at once. When it goes away, one of the others takes its place, and asks it
//! again whatever it left unanswered; when a session of a newer build of it starts, as after the Mac app was rebuilt,
//! the older makes way, and answers its harness through the newer from then on.
//!
//! A Claude Code session in Anthropic's cloud runs no Mac: `avendb-device agent cloud` (`serve_cloud`), the device
//! agentCloud, whose key its person's Mac made and added to avenMAIA in one ceremony (The OS app's "Add a cloud agent",
//! `add_cloud_agent` in this crate), showed once, and keeps no copy of; its person puts it in the cloud environment's
//! secrets (`KEY_VAR`). Every session holding the key acts as that one device, reaching the server alone through the
//! environment's HTTP proxy, on the server's relay, which lets in only devices it knows: so a key no Mac added gets
//! nowhere. It opens its device at its first tool call and closes it once no tool called it for a while (`IDLE`), so
//! that sessions of one key rarely run its device at the same time; two at once knock each other off the relay.
//! Removing its device from avenMAIA ends it. It asks the server for nothing on its own (`Options::lazy`): before each
//! call it brings the vaults the call touches alone (`Agent::touches`, `Bringing`), the vaults it names, by their
//! ids or by the entries it names, else its aven's coop, Maia City, with every vault's log and share, which say who may
//! do what; one pull at a time, which no call's wait cuts short, so a fresh session never pulls all avenMAIA may hold,
//! and a big vault's first pull runs once, to its end, however many calls wait on it.
//!
//! The MCP is JSON-RPC 2.0, a message a line (`initialize`, `tools/list`, `tools/call`, `ping`): `avendb_vaults` tells
//! who it is, its device vault and the aven over it, and the vaults it sees, `avendb_ask` runs a read of the ops
//! engine, `avendb_run` a change, each acting as its device vault, and `avendb_request_access` asks its person for
//! access. A change runs as on every device, the shares its aven passed on deciding: `put_file` too, and a `create`
//! that brings a file (`file`), its bytes those of the file on this Mac the harness names by its `path` beside the op,
//! a draft's too, so an agent proposes a new entry with its file; but not `follow` and `set_limits`, a device's
//! own settings, which an agent keeps nowhere. `get_file`, the mirror of `put_file` and the agent's own op, reads a
//! file of a vault's Library back as the page's Library reads it (`read_file`), a window at a time, from its own shelf
//! or else from the Mac's one store, and writes it to the `path` beside the op, never over a file there unless
//! `overwrite` is beside it too; a small text file comes back inline as well. Two named tools do what an agent does
//! most: `avendb_add_spark` captures a spark as the page's Sparks capture one, the same `create` op run as
//! `avendb_run` runs it; `avendb_add_artifact` adds a source fact as the page's Artifacts add one, a link or a file of
//! this Mac saved to the Library first, and puts it on a spark's canvas where it names one. Each goes in the vault it
//! names, else in its aven's coop, Maia City (`homes`), where all sparks and artifacts are seeded, where the aven's
//! shares let it add or draft one there. Where they let
//! it only suggest, as a Suggester's do, which an agent is on Maia City by its standing rule, it is a draft, and its
//! file a draft Library file of its own that brings it in its creation, which the vault's owners land by accepting an
//! AIP the agent opens over them. `avendb_read_file` is `get_file`. No path in a folder that keeps this Mac's keys is
//! read or written, whatever its harness names (`fenced`): an agent acts through its aven's vault caps alone.

use std::collections::BTreeSet;
use std::io;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, UNIX_EPOCH};

use anyhow::{Context as _, Result, anyhow, bail};
use avendb::engine;
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::lab::Lab;
use avendb::policy::{Kind, Principal, State, Vault};
use avendb::rules;
use avendb::slice::{Atom, Selector};
use avendb::sync::LogId;
use avendb::wire::FileHold;
use avendb::world;
use avendb_net::{NoBytes, NoCeremony, Node, Offer, Options, disk, server};
use bytes::{Bytes, BytesMut};
use iroh::EndpointId;
use n0_future::task::AbortOnDropHandle;
use n0_future::{Stream, stream};
use serde_json::{Value, json};
use tokio::fs::File;
use tokio::io::{AsyncBufReadExt as _, AsyncRead, AsyncReadExt as _, AsyncWrite, AsyncWriteExt as _, BufReader, Lines};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{Notify, watch};
use tokio::task::JoinSet;

/// The MCP version it speaks, unless its client asks for another.
const PROTOCOL: &str = "2025-06-18";

/// How often it looks for the Mac's offer, leaves its own, and lets go of the files the Mac's device holds whole.
pub const LOOK: Duration = Duration::from_secs(3);

/// How long a session waits for the one that runs its agent's device to answer on its socket, as it starts or as
/// another takes its place (`serve`).
const WAIT: Duration = Duration::from_secs(30);

/// How long a session that made way for a newer build leaves the lock to it, rather than take it back at once.
const YIELD: Duration = Duration::from_secs(5);

/// The key of a session's first line to the one that runs its agent's device: the build it runs (`built`).
const HELLO: &str = "avendb-agent";

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

/// The agents' folder beside the app's `host` folder: `<host>-agents`, outside it, so the app's own folder holds its
/// shelves alone.
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

/// The file in the agents' folder beside the app's `host` folder that agent `name`'s device `device`, its key in hex,
/// writes its key to every little while it runs (`LOOK`): the Mac's page knows by it whether the agent is there to be
/// added under its person's aven, which its device cosigns (`online`). One a device, so that another device of the
/// agent, as an older build's, never stands in for it.
pub fn alive(host: &Path, name: &str, device: &str) -> PathBuf {
    agents(host).join(format!("{name}.{device}.alive"))
}

/// Whether agent `name`'s device `device` runs now: it wrote its key to its `alive` file within the last few looks.
/// An agent harness such as Claude Code starts it with each of its sessions, and it stops with the last of them.
pub fn online(host: &Path, name: &str, device: &str) -> bool {
    let file = alive(host, name, device);
    let fresh = std::fs::metadata(&file)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age <= LOOK * 5);
    fresh && std::fs::read_to_string(&file).is_ok_and(|d| d.trim() == device)
}

/// The file in the agents' folder beside the app's `host` folder that the one session running agent `name`'s device
/// holds locked while it does (`serve`).
fn lock(host: &Path, name: &str) -> PathBuf {
    agents(host).join(format!("{name}.lock"))
}

/// The socket in the agents' folder beside the app's `host` folder on which the one session running agent `name`'s
/// device answers the others (`serve`).
fn socket(host: &Path, name: &str) -> PathBuf {
    agents(host).join(format!("{name}.sock"))
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


/// The aven a person whose vault is `mine` runs agents under, by view `st`: their seed coop's one aven, avenMAIA, which
/// Maia City owns alone (`world::seed_coop`, `world::aven_of`; Samuel 2026-10-18: one aven per coop, none per person).
pub fn aven_of(st: &State, mine: VaultId) -> Option<VaultId> {
    world::seed_coop(st, mine).and_then(|coop| world::aven_of(st, coop))
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
/// opens an AIP over its own proposal lines (the ops engine's `aip_open`), states its objective and records readings
/// on it (`aip_objective`, `aip_measure`, sets and inserts on its own AIP), promotes it and withdraws it as its author
/// (`aip_promote`, `aip_withdraw`), and changes nothing else: the vault alone reviews it, and its acceptance merges the
/// lines.
pub fn aip_author() -> (Vec<rules::Op>, Selector) {
    let set = rules::Op::Set { path: vec![], to: None, on: None };
    let ops = vec![rules::Op::Read, rules::Op::Create { on: None }, set];
    (ops, Selector::AnyOf(vec![vec![Atom::TypeIn(vec![AIP.into()])]]))
}


/// The file in the agents' folder beside the app's `host` folder where the Mac's device leaves its offer for them.
pub fn host_offer(host: &Path) -> PathBuf {
    agents(host).join("offer.txt")
}

/// Runs harness `harness`'s agent device beside the app's `host` folder, answering MCP on `input` and `output` until
/// `input` ends: as the one session that runs it, where none does yet, or else through that one. Fails if its folder or
/// its node can't be opened, or the session that runs it doesn't answer.
pub async fn serve(
    host: PathBuf,
    harness: String,
    input: impl AsyncRead + Unpin,
    output: impl AsyncWrite + Unpin,
) -> Result<()> {
    serve_built(host, harness, input, output, built()).await
}

/// `serve`, as a session of a build made at `built` (`built`). Of the sessions of one agent, the one that holds its
/// lock file runs its device and answers the others on its socket, its own harness's lines as theirs; each other one
/// says its build first, then relays its harness's lines, keeping those not answered yet. Where the one running it
/// goes away, one of them takes its place, and answers those first. A session of a newer build than the one running
/// it takes its place at once: the older makes way, as it reads its first line, and goes on through it.
pub async fn serve_built(
    host: PathBuf,
    harness: String,
    input: impl AsyncRead + Unpin,
    mut output: impl AsyncWrite + Unpin,
    built: u64,
) -> Result<()> {
    named(&harness)?;
    let name = device_name(&harness);
    let dir = folder(&host, &name);
    std::fs::create_dir_all(&dir).with_context(|| format!("the agent's folder {}", dir.display()))?;
    let (mut lines, mut waiting, mut since) = (BufReader::new(input).lines(), Waiting::default(), None);
    // until when it leaves the lock to the newer build it made way for
    let mut yields: Option<Instant> = None;
    loop {
        if yields.is_none_or(|until| Instant::now() >= until)
            && let Some(held) = hold(&lock(&host, &name))?
        {
            since = None;
            let session = Session { host: &host, name: &name, built };
            if session.run(held, &mut lines, &mut waiting, &mut output).await? {
                return Ok(());
            }
            yields = Some(Instant::now() + YIELD);
            continue;
        }
        match through(&socket(&host, &name), built, &mut lines, &mut waiting, &mut output).await? {
            Some(true) => return Ok(()),
            Some(false) => since = None,
            None => {}
        }
        // none answers yet: the one that runs it starts, or makes way, or went away
        let waited = since.get_or_insert_with(Instant::now).elapsed();
        anyhow::ensure!(waited < WAIT, "another session runs {name}, and doesn't answer on its socket");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// A cloud session's agent, as its harness names it: `avendb-device agent cloud`, the device agentCloud.
pub const CLOUD: &str = "cloud";

/// The environment variable a cloud session's agent reads its key from: 66 hex digits, its suite's byte and then its
/// secret, or the 64 of the secret alone for a key in SLH-DSA, made before the key move (`sign::kept_secret`), as The
/// OS app showed them once when it added the key to avenMAIA (`add_cloud_agent`), which its person keeps in the
/// environment's secrets.
pub const KEY_VAR: &str = "AVENDB_AGENT_KEY";

/// The environment variable that names the server a cloud session's agent reaches, by its offer, where it isn't
/// avenDB's own (`SERVER`).
pub const SERVER_VAR: &str = "AVENDB_SERVER";

/// avenDB's server's offer, the same as long as its shelf keeps its device's key, as the site's
/// src/lib/avendb/server.js has it: avendb.maia.city, its relay.
pub const SERVER: &str = "AVENDB1UAYTJU2GDDXXNHWO5YZJOJJBYJFXCKVEPNGILCF6ORDFGRZQXIYOKZOGNSNV64ZIP4VEW4HJPYXUPWZBQJWGRT75JV4CAO3N25TOCMYBAS6PKHZODTUQCGLIOR2HA4Z2F4XWC5TFNZSGELTNMFUWCLTDNF2HSLY";

/// How long a cloud session's agent keeps its device open after its last tool call: then it closes it, and opens it
/// again at the next, so that sessions of one key that don't use avenDB at the same time never run its device at once.
const IDLE: Duration = Duration::from_secs(300);

/// How long a cloud session's agent waits for the server's card.
const SYNC: Duration = Duration::from_secs(60);

/// How long a cloud session's agent's tool call waits for what it brings (`Bringing`), before it answers that it is
/// still bringing it: well below the minute its harness waits for a tool call.
const BRING: Duration = Duration::from_secs(40);

/// Runs a cloud session's agent, agentCloud, answering MCP on `input` and `output` until `input` ends, its folder in
/// `dir`. A cloud session runs no Mac and no The OS: its key is one its person made in The OS app, which added it to
/// their coop's aven, avenMAIA, as a device beside its server, and which they keep in the environment's secrets
/// (`KEY_VAR`), so every session of the environment acts as that one device. It reaches nobody but the server
/// (`SERVER`, or the one `SERVER_VAR` names), through its relay alone, by way of the environment's HTTP proxy
/// (`Options::proxy`), and brings from it the vaults each call touches alone (`Bringing`), so that what it reads is
/// the server's latest and a change builds on what another session wrote; a file it reads comes from the server, and
/// one it saves it lets go of once the server holds it whole. Its device opens at the first tool call, not as it
/// starts, and closes once no call came for a while (`IDLE`): a session that never uses avenDB never runs it, and two
/// sessions run it at once only while both use it, when each knocks the other off the server's relay now and then, as
/// one device of two places does. Fails only where `input` or `output` does: a missing key, or a server that doesn't
/// let it in, its tool calls answer, saying what to do.
pub async fn serve_cloud(cloud: Cloud, input: impl AsyncRead + Unpin, mut output: impl AsyncWrite + Unpin) -> Result<()> {
    let name = device_name(CLOUD);
    let mut lines = BufReader::new(input).lines();
    let mut open: Option<Opened> = None;
    loop {
        let until = open.as_ref().map(|o| o.used + IDLE);
        let idle = async move {
            match until {
                Some(until) => tokio::time::sleep_until(until).await,
                None => std::future::pending().await,
            }
        };
        tokio::select! {
            line = lines.next_line() => {
                let Some(line) = line? else { break };
                let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
                let (cloud, named, opened) = (&cloud, &name, &mut open);
                let call = move |tool: String, args: Value| async move {
                    cloud.open(named, opened).await?.call(&tool, &args).await
                };
                if let Some(answer) = answer(&message, || instructions(&name, true), call).await {
                    output.write_all(format!("{answer}\n").as_bytes()).await?;
                    output.flush().await?;
                }
            }
            () = idle => close(open.take()).await,
        }
    }
    close(open.take()).await;
    Ok(())
}

/// A cloud session's agent: the folder it keeps its own in, its key in hex as its environment holds it (`KEY_VAR`), the
/// server's offer, and whether it reaches the server through the environment's HTTP proxy (`Options::proxy`).
pub struct Cloud {
    pub dir: PathBuf,
    pub key: zeroize::Zeroizing<String>,
    pub server: String,
    pub proxy: bool,
}

impl Cloud {
    /// A cloud session's agent in folder `dir`, as its environment says: its key (`KEY_VAR`), the server where one is
    /// named (`SERVER_VAR`), else avenDB's own (`SERVER`), through the environment's proxy.
    pub fn from_env(dir: PathBuf) -> Cloud {
        let key = zeroize::Zeroizing::new(std::env::var(KEY_VAR).unwrap_or_default());
        let server = std::env::var(SERVER_VAR).ok().filter(|s| !s.trim().is_empty());
        Cloud { dir, key, server: server.unwrap_or_else(|| SERVER.into()), proxy: true }
    }
}

/// A cloud session's agent's device, open: as its MCP answers, its look (`look_cloud`), and when a tool last called it.
struct Opened {
    agent: Arc<Agent>,
    _looking: AbortOnDropHandle<()>,
    used: tokio::time::Instant,
}

impl Cloud {
    /// Its device, open now, or opened: by its key (`KEY_VAR`), in a folder of its own in `dir` named by the key, on
    /// the server's relay through the environment's proxy, asking it for nothing on its own (`Options::lazy`): each
    /// call brings what it touches (`Agent::bring_for`). Fails, saying what to do, where the key is missing or isn't
    /// one, the server's offer isn't one, or the relay doesn't let it in.
    async fn open(&self, name: &str, open: &mut Option<Opened>) -> Result<Arc<Agent>> {
        if let Some(o) = open {
            o.used = tokio::time::Instant::now();
            return Ok(o.agent.clone());
        }
        let (secret, suite) = cloud_key(&self.key)?;
        let server = Offer::from_text(self.server.trim()).with_context(|| format!("{SERVER_VAR} is no server's offer"))?;
        // a folder of the key's own, by a hash of it that tells nothing of it, so that another key never opens it
        let mark = avendb::hash::hash("a cloud agent's folder", &*secret);
        let folder = self.dir.join(format!("{name}-{}", hex(&mark[..8])));
        std::fs::create_dir_all(&folder).with_context(|| format!("the agent's folder {}", folder.display()))?;
        let shelf = disk::open(&folder)?;
        let relay = server.addr.relay_urls().next().cloned();
        let opts = Options { bind: None, direct: false, relay, proxy: self.proxy, lazy: true, ..Options::local() };
        let mut node = Arc::new(server::open_agent_with(Some(shelf.clone()), name, &secret, suite, opts.clone()).await?);
        let at = server.addr.id;
        // a folder of its own lasts as long as its session's machine: a new one learns from the server's card that its
        // key moved (K3c), names its next key there, and opens again as it
        for again in [false, true] {
            node.know(server.addr.clone());
            if !node.on_relay().await {
                node.shutdown().await.ok();
                let host = server.addr.relay_urls().next().map_or("the server".into(), |r| r.to_string());
                bail!(
                    "{host} doesn't let {name} in: its key may not be a device of avenMAIA yet (its person adds one in \
                     The OS app, Settings, Agents, Add a cloud agent), or this environment's network doesn't allow \
                     avendb.maia.city"
                );
            }
            if alone(&node).await
                && let Ok(Err(e)) = tokio::time::timeout(SYNC, node.contact(at)).await
            {
                tracing::warn!("the server's card isn't read: {e:#}");
            }
            if again || !server::follow(&node).await {
                break;
            }
            node.shutdown().await.ok();
            node = Arc::new(server::open_agent_with(Some(shelf.clone()), name, &secret, suite, opts.clone()).await?);
        }
        drop(secret);
        let looking = AbortOnDropHandle::new(tokio::spawn(look_cloud(node.clone(), server)));
        let cloud = Some(Arc::new(Bringing::new(at)));
        let agent = Arc::new(Agent { node, host: folder, name: name.to_string(), cloud });
        let used = tokio::time::Instant::now();
        *open = Some(Opened { agent: agent.clone(), _looking: looking, used });
        Ok(agent)
    }
}

/// A cloud session's agent's key and its suite, `text` as its environment holds it (`KEY_VAR`): 66 hex digits, or 64
/// for a key made before the key move (`sign::kept_secret`). Fails, saying where it comes from.
fn cloud_key(text: &str) -> Result<(zeroize::Zeroizing<[u8; 32]>, avendb::sign::Suite)> {
    let text = text.trim();
    anyhow::ensure!(
        !text.is_empty(),
        "{KEY_VAR} isn't set: its person adds a cloud agent in The OS app (Settings, Agents, Add a cloud agent), which \
         shows its key once, and puts it in this environment's {KEY_VAR}; a new session reads it"
    );
    let wrong = || anyhow!("{KEY_VAR} holds no key: 66 hex digits, as The OS app shows it");
    anyhow::ensure!(text.len() % 2 == 0 && text.is_ascii(), wrong());
    let mut bytes = zeroize::Zeroizing::new(vec![0u8; text.len() / 2]);
    for (i, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&text[2 * i..2 * i + 2], 16).map_err(|_| wrong())?;
    }
    avendb::sign::kept_secret_of(&bytes).ok_or_else(wrong)
}

/// Closes a cloud session's agent's device, if it is open.
async fn close(open: Option<Opened>) {
    let Some(Opened { agent, _looking, .. }) = open else { return };
    drop(_looking);
    if let Err(e) = agent.node.shutdown().await {
        tracing::warn!("{} doesn't close: {e:#}", agent.name);
    }
}

/// Every little while, a cloud session's agent: while its key belongs to no vault, the server's card, which tells it
/// of a join made meanwhile; and the files it holds whole that the server holds whole too, it lets go of
/// (`hand_over`), as the server keeps them.
async fn look_cloud(node: Arc<Node>, server: Offer) {
    loop {
        tokio::time::sleep(LOOK).await;
        if alone(&node).await
            && let Ok(Err(e)) = tokio::time::timeout(LOOK, node.contact(server.addr.id)).await
        {
            tracing::debug!("the server's card isn't read: {e:#}");
        }
        hand_over(&node, server.device).await;
    }
}

/// When the build this process runs was made: its program's time on disk as it starts, in nanoseconds since 1970;
/// none where it can't tell.
fn built() -> u64 {
    let made = std::env::current_exe().and_then(std::fs::metadata).and_then(|m| m.modified());
    made.ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos() as u64)
}

/// Lock file `file`, held, where no other session holds it; none where one does.
fn hold(file: &Path) -> Result<Option<std::fs::File>> {
    let opened = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(file);
    let held = opened.with_context(|| format!("the agent's lock file {}", file.display()))?;
    match held.try_lock() {
        Ok(()) => Ok(Some(held)),
        Err(std::fs::TryLockError::WouldBlock) => Ok(None),
        Err(std::fs::TryLockError::Error(e)) => Err(e).context("the agent's lock file"),
    }
}

/// The one session that runs an agent's device: the app's `host` folder, the agent's `name`, and the `built` of its
/// build.
struct Session<'a> {
    host: &'a Path,
    name: &'a str,
    built: u64,
}

impl Session<'_> {
    /// Runs the agent's device while it holds its lock file, `held`: its node on its shelf, and its looks (`look`); it
    /// answers on its socket the other sessions (`others`), and here, the lines its harness left `waiting` first, then
    /// each of `lines`. Whether `lines` ended, once no other session goes on through it, or as it made way for a newer
    /// build; false where it made way with `lines` going on, to answer through that one from then on.
    async fn run(
        &self,
        held: std::fs::File,
        lines: &mut Lines<BufReader<impl AsyncRead + Unpin>>,
        waiting: &mut Waiting,
        output: &mut (impl AsyncWrite + Unpin),
    ) -> Result<bool> {
        let (host, name) = (self.host, self.name);
        let shelf = disk::open(&folder(host, name))?;
        let mac = read_offer(&host_offer(host));
        let relay = mac.as_ref().and_then(|o| o.addr.relay_urls().next().cloned());
        let opts = Options { bind: None, direct: true, relay, ..Options::local() };
        let node = Arc::new(server::open_agent(shelf, name, opts).await?);
        let looking = AbortOnDropHandle::new(tokio::spawn(look(node.clone(), host.to_path_buf(), name.to_string())));
        let agent =
            Arc::new(Agent { node: node.clone(), host: host.to_path_buf(), name: name.to_string(), cloud: None });
        let (newer, count) = (Arc::new(Notify::new()), watch::channel(0));
        let sock = socket(host, name);
        // it holds the lock: a socket there is a session's before it, gone
        std::fs::remove_file(&sock).ok();
        let listener = UnixListener::bind(&sock).with_context(|| format!("the agent's socket {}", sock.display()))?;
        let others = others(listener, agent.clone(), self.built, newer.clone(), count.0);
        let others = AbortOnDropHandle::new(tokio::spawn(others));
        for line in waiting.take() {
            reply(&agent, &line, output).await?;
        }
        let (mut count, mut ended) = (count.1, false);
        loop {
            tokio::select! {
                biased;
                () = newer.notified() => break,
                line = lines.next_line(), if !ended => match line? {
                    Some(line) => reply(&agent, &line, output).await?,
                    // the others' sessions go on through it, until they end too
                    None => ended = true,
                },
                () = async { _ = count.wait_for(|n| *n == 0).await; }, if ended => break,
            }
        }
        drop(others);
        drop(looking);
        std::fs::remove_file(alive(host, name, &hex(&node.device().0))).ok();
        drop(agent);
        node.shutdown().await?;
        drop(held);
        Ok(ended)
    }
}

/// The other sessions of an agent, on `listener`, each as it comes, which `agent` answers (`other`), however many at
/// once, as many as `count` says; one of a newer build than `built` it lets know of through `newer`.
async fn others(listener: UnixListener, agent: Arc<Agent>, built: u64, newer: Arc<Notify>, count: watch::Sender<usize>) {
    let mut sessions = JoinSet::new();
    loop {
        tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) => {
                    sessions.spawn(other(stream, agent.clone(), built, newer.clone()));
                }
                Err(e) => {
                    tracing::warn!("a session of {} isn't taken: {e}", agent.name);
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            },
            Some(_) = sessions.join_next(), if !sessions.is_empty() => {}
        }
        count.send_replace(sessions.len());
    }
}

/// Another session of an agent on `stream`: its first line says its build (`HELLO`); one newer than `built` it lets
/// know of through `newer`, and answers nothing, as it takes this one's place; any other, `agent` answers line by line.
async fn other(stream: UnixStream, agent: Arc<Agent>, built: u64, newer: Arc<Notify>) {
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();
    let Ok(Some(hello)) = lines.next_line().await else { return };
    let Some(theirs) = serde_json::from_str::<Value>(&hello).ok().and_then(|h| h[HELLO].as_u64()) else {
        return;
    };
    if theirs > built {
        newer.notify_one();
        return;
    }
    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(answer) = answer_line(&agent, &line).await
            && write.write_all(answer.as_bytes()).await.is_err()
        {
            return;
        }
    }
}

/// Answers its harness through the session that runs its agent's device, on socket `sock`: its build first, `built`,
/// then the lines `waiting` holds, then each of `lines`, and each answer back on `output`. Whether `lines` ended, once
/// every answer due came (true), or the connection did first (false); none where nothing answers on `sock`.
async fn through(
    sock: &Path,
    built: u64,
    lines: &mut Lines<BufReader<impl AsyncRead + Unpin>>,
    waiting: &mut Waiting,
    output: &mut (impl AsyncWrite + Unpin),
) -> Result<Option<bool>> {
    let Ok(stream) = UnixStream::connect(sock).await else { return Ok(None) };
    let (read, mut write) = stream.into_split();
    let mut answers = BufReader::new(read).lines();
    let mut first = format!("{}\n", json!({ HELLO: built }));
    for line in waiting.lines() {
        first.push_str(line);
        first.push('\n');
    }
    if write.write_all(first.as_bytes()).await.is_err() {
        return Ok(Some(false));
    }
    let mut ended = false;
    loop {
        tokio::select! {
            line = lines.next_line(), if !ended => match line? {
                Some(line) => {
                    waiting.sent(&line);
                    if write.write_all(format!("{line}\n").as_bytes()).await.is_err() {
                        return Ok(Some(false));
                    }
                }
                None => {
                    ended = true;
                    write.shutdown().await.ok();
                }
            },
            answer = answers.next_line() => match answer {
                Ok(Some(answer)) => {
                    waiting.answered(&answer);
                    output.write_all(format!("{answer}\n").as_bytes()).await?;
                    output.flush().await?;
                }
                _ => return Ok(Some(ended)),
            },
        }
        if ended && waiting.is_empty() {
            return Ok(Some(true));
        }
    }
}

/// The requests a session's harness sent that are not answered yet, each its id in JSON and its line, the oldest
/// first: those it asks again of the session that takes the place of one that went away.
#[derive(Default)]
struct Waiting(Vec<(String, String)>);

impl Waiting {
    /// Line `line` is sent on: a request, one with a method and an id, waits for its answer.
    fn sent(&mut self, line: &str) {
        let Ok(m) = serde_json::from_str::<Value>(line) else { return };
        if let (Some(_), Some(id)) = (m.get("method"), m.get("id")) {
            self.0.push((id.to_string(), line.to_string()));
        }
    }

    /// Line `line` came back: an answer, one with an id and no method, answers the request of that id.
    fn answered(&mut self, line: &str) {
        let Ok(m) = serde_json::from_str::<Value>(line) else { return };
        if let (None, Some(id)) = (m.get("method"), m.get("id")) {
            let id = id.to_string();
            self.0.retain(|(waits, _)| *waits != id);
        }
    }

    /// The lines waiting, the oldest first.
    fn lines(&self) -> impl Iterator<Item = &str> {
        self.0.iter().map(|(_, line)| line.as_str())
    }

    /// The lines waiting, taken, to answer now.
    fn take(&mut self) -> Vec<String> {
        std::mem::take(&mut self.0).into_iter().map(|(_, line)| line).collect()
    }

    fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// `agent`'s answer to MCP line `line`, on `output`: none to a notification, or to a line that isn't JSON.
async fn reply(agent: &Agent, line: &str, output: &mut (impl AsyncWrite + Unpin)) -> Result<()> {
    if let Some(answer) = answer_line(agent, line).await {
        output.write_all(answer.as_bytes()).await?;
        output.flush().await?;
    }
    Ok(())
}

/// `agent`'s answer to MCP line `line`, a line of JSON ending in a newline: none to a notification, or to a line that
/// isn't JSON.
async fn answer_line(agent: &Agent, line: &str) -> Option<String> {
    let message = serde_json::from_str::<Value>(line).ok()?;
    let mut answer = agent.answer(&message).await?.to_string();
    answer.push('\n');
    Some(answer)
}

/// The Mac's offer in `file`, if it left one.
fn read_offer(file: &Path) -> Option<Offer> {
    Offer::from_text(std::fs::read_to_string(file).ok()?.trim()).ok()
}

/// The JSON in `file`, if it holds some.
fn read_json(file: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()
}

/// Every little while: the Mac's device where its offer says it is, and, until it belongs to a vault, what that device
/// may tell it, as a join it missed, then its request to be added under its person's aven left for the Mac's page, its
/// offer as it is now, unless its person said no to this device; and the files it holds whole that the Mac's device
/// holds whole too, it lets go of (`hand_over`).
async fn look(node: Arc<Node>, host: PathBuf, name: String) {
    let (file, no, mut known) = (request(&host, &name), denied(&host, &name), None);
    let device = hex(&node.device().0);
    loop {
        // that it runs, for the Mac's page (`online`)
        std::fs::write(alive(&host, &name, &device), &device).ok();
        let mac = read_offer(&host_offer(&host));
        if let Some(mac) = &mac
            && known.as_ref() != Some(&mac.to_text())
        {
            known = Some(mac.to_text());
            node.know(mac.addr.clone());
        }
        // a join made while it didn't run, or whose answer it lost, reaches it from the Mac's device
        if let Some(mac) = &mac
            && alone(&node).await
            && let Ok(Err(e)) = tokio::time::timeout(LOOK, node.sync_with(mac.addr.id)).await
        {
            tracing::debug!("the Mac's device isn't asked: {e:#}");
        }
        let said_no = std::fs::read_to_string(&no).is_ok_and(|d| d.trim() == device);
        if alone(&node).await && !said_no {
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

/// Whether `node`'s device belongs to no vault yet.
async fn alone(node: &Node) -> bool {
    node.read(|lab, me| lab.vault_of(me).is_none()).await
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

/// What an agent named `name` tells its harness of itself as it starts (MCP's `instructions`): on its person's Mac,
/// or in a cloud session (`cloud`).
fn instructions(name: &str, cloud: bool) -> String {
    let (who, here) = match cloud {
        false => (
            "an agent device on this Mac: an avenDB device with a key of its own, which joins its coop's one aven, \
             avenMAIA for Maia City, as a device beside its server, once its person approves it",
            "this Mac",
        ),
        true => (
            "an agent device in this cloud session: an avenDB device whose key its person made in The OS app and keeps \
             in this environment's secrets, a device of its coop's one aven, avenMAIA for Maia City, beside its server, \
             which it reaches through avendb.maia.city. It brings from there only the vaults a call names, by their \
             ids or by the entries it names, else its aven's coop, Maia City; the first call on a big vault may \
             answer that it is still bringing it: then call again in a moment",
            "this machine",
        ),
    };
    format!(
            "{name} is {who}. An aven is a \
             coop's one AI identity, a vault the coop owns; {name} acts as it, with its rights, no more and no less. \
             Every read and change is one JSON op of avenDB's engine (avendb/docs/ARCHITECTURE.md §8). Call \
             avendb_vaults first: it says who {name} is, the aven it acts as, once its person approved it, and which \
             vaults it sees. Read with avendb_ask; change with avendb_run, which acts as the aven by its shares: on a vault \
             where it may only suggest, write on a proposal (`propose`, then ops with its `line`), and its person \
             merges it; where it may merge, its merge into main counts only once the entry's vault accepted the \
             proposal (one of its owners, by a review), and brings in only the version accepted. To put changes to \
             its person, write them on proposals, then bundle those lines in an AIP (an Aven Improvement Proposal) \
             with avendb_run: `aip_open` (`vault`, `title`, a `note` saying why and what changes, and `proposals`, \
             each `{{entry, line}}` of that vault; it makes an entry of type aip, so only where its shares let it \
             create: a Suggester may, as its coop gives its aven an AIP author's share on the vault's AIPs beside \
             its Suggester's, and an Editor may). Before it is proposed, an AIP states its objective, what it must \
             deliver: one or more measurable metrics in Lean, `objective` on `aip_open` or `aip_objective` \
             (`entry`, `lean`), a file such as `def fps : Metric := metric \"Frames per second\" (atLeast (reading \
             \"fps\") 50)`, goals atLeast, atMost, between and equals over readings, numbers, + - * /, min and \
             max, a doc comment above a metric its note (avendb/spec/AvenDB/Objective.lean); a metric may also \
             read the proposal itself, no reading needed: `proposed \"params.#1.default\"` is the number its lines \
             would put at that path (field names split by dots, `#n` the row whose id is n, an entry's first 8 hex \
             digits and a slash first to pick its line), its baseline what main holds there, and `current \"path\"` \
             what main holds, so `atLeast (proposed \"params.#1.default\") 0.8` reads its progress from every \
             write on its lines; `measured \"fps\"` reads only the readings a Measurer of the vault wrote, its \
             measuring job, never its author, so an agent's own reading counts as a `reading` alone; the \
             objective names the measuring logic that job runs, `def sim : Measure := logic \"valley-sim\"`, a \
             logic module on the vault's main line tagged `ref:logic/measures/valley-sim` that exports \
             `measure(input)`, given `{{lines}}`, each line's `entry`, `type`, `tags` and `record` on one side \
             (`aip_records` (`entry`) reads both, `main` and `proposed`), and hands back named numbers; a file that \
             doesn't read is refused with its line and column, and `objective_check` (`lean`, `readings`, \
             `measured`, `proposed` and `current`, each `{{path, value}}`) checks one unsaved. While it works, \
             it measures (a test, a count, a run) and records each reading with \
             `aip_measure` (`entry`, `name`, `value`, `note`): `aip` answers its `objective`, each metric met or \
             not and its progress from its first reading toward its target, so it reads its own progress in its \
             loop. Then `aip_promote` (`entry`), refused until it holds an objective, which gives it the vault's \
             next number, AIP-n. To propose a new entry where it may only suggest, draft it: `create` with `draft: true` \
             (`vault`, `type`, `tags`, `value`) answers its `entry` and `line`, a line of its own; write on that line \
             as on any proposal, then name it in `aip_open`'s `proposals` as `{{entry, line}}` with its `objective` \
             and `aip_promote`. A \
             draft shows nowhere on the vault's main line, nor to everyone, until its person accepts the AIP; a \
             schema or lens is never a draft. Only a promoted AIP reaches a person, who answers it whole in The OS \
             app or at /app/aips/?aip=<entry>; an agent never \
             reviews one, since `aip_review` is the vault's own. Read them with avendb_ask, `aips` or `aip` (`entry`, \
             with its diff); after a revise, write again on the same lines and promote it again: it keeps its \
             number. Save a file of {here} into a vault with avendb_run: a `put_file` op (`vault`, `name`, and \
             `media` and `tags` if any), and the file's absolute `path` beside the op. It makes a new entry of type \
             file, so only where its shares let it create, as an Editor's do, not where it may only suggest. Any \
             entry brings its file in its creation, one write: `create` with `file` (an object, `name` and `media` \
             if any) and the `path` beside it, a draft too, so where it may only suggest a Library file is a draft \
             of type file (`value` `{{kind: \"file\", title, media}}`); `put_file` with `entry` brings a file into \
             an entry it may edit on main. Read a \
             file of a vault back with avendb_read_file, or a `get_file` op on avendb_run: the file entry's `entry`, \
             or a `vault` and the file's `name`, and an absolute `path` on {here} to write it to, never over a file \
             there unless `overwrite` is true; a text file of at most 64 KiB comes back inline too, as `text`, and \
             with no `path` inline alone. Capture a spark, anything that might become a story (a thought, a quote, a \
             note), with avendb_add_spark: its `text`, and its `title` and `tags` if any (a link or a media file goes \
             in as an artifact of its own), and answers its entry. Add a source fact, a link, a YouTube video, a \
             picture or a clip, with avendb_add_artifact: its `url`, or the absolute `path` of a file on {here}, \
             which it saves to the Library first, or both; its `title`, `note`, `by`, `taken`, `language` and \
             `transcript` if known; and a `spark` to put it on that spark's canvas. Each goes in the `vault` it names, \
             else in its aven's coop, {coop}, where all sparks and artifacts are seeded, where the aven's shares \
             let it add or draft one there. Where it may only suggest, \
             as a Suggester, which an agent is on {coop}, it is a draft, its file a draft Library file of its own: \
             the answer says `draft: true`, and gives its `line` and the `proposals` to name in `aip_open`, then \
             `aip_promote`; the vault's owners land it by accepting the AIP. Studio 2, the film studio, keeps its \
             cuts as entries of type cut in {coop}: a cut's record holds its name, project, variant, stage and \
             version, and its whole timeline as one JSON text, `timeline` (its clips by track, each picture clip's \
             grade `stacks`, the scenes' looks in `grade`, each sound clip's `vol`, `eq` and fades). Read cuts with \
             avendb_ask, `world`; propose a timeline edit as any other: `propose` on the cut, then `set` \
             `[\"timeline\"]` with the whole timeline changed and `[\"at\"]` with the time on its `line`, and an AIP; a \
             new cut is a draft `create` of type cut. Renders, hero frames, graded stills and proxies are entries of \
             type task the studio's rules make for the Mac's worker: `render` and `frame` of a cut, `world-proxy` of \
             a shot version, asked in the studio, and `probe`, `proxy`, `still`, `transcript` and `analysis` of every \
             file tagged media:original, by themselves; where it may only suggest, its AIP's note names what to \
             make once it lands, and the person asks it. A done task's `outputs` are file entries, read with \
             avendb_read_file. For access it lacks, ask its person with avendb_request_access, saying why: they \
             answer in The OS app.",
            coop = world::SEED_COOP,
        )
}

/// The answer to MCP message `m`, by an agent whose instructions `instructions` makes and whose tools `call` answers,
/// each by its name and arguments: none for a notification.
async fn answer<F: Future<Output = Result<String>>>(
    m: &Value,
    instructions: impl FnOnce() -> String,
    call: impl FnOnce(String, Value) -> F,
) -> Option<Value> {
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
                "instructions": instructions(),
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools() }),
        "tools/call" => {
            let name = params["name"].as_str().unwrap_or_default().to_string();
            let (text, error) = match call(name, params["arguments"].clone()).await {
                Ok(text) => (text, false),
                Err(e) => (format!("{e:#}"), true),
            };
            json!({ "content": [{ "type": "text", "text": text }], "isError": error })
        }
        _ => {
            return Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "no method" } }));
        }
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

/// What a cloud session's agent asks the server for before a call (`Agent::bring_for`): the entries of the vaults it
/// names, with every log that is no entry's (`Node::bring`), or the logs it names alone (`Node::bring_logs`).
#[derive(Clone)]
enum Wanted {
    Vaults(BTreeSet<VaultId>),
    Logs(BTreeSet<LogId>),
}

impl Wanted {
    /// Whether a pull of it brings all `other` asks for.
    fn covers(&self, other: &Wanted) -> bool {
        match (self, other) {
            (Wanted::Vaults(a), Wanted::Vaults(b)) => b.is_subset(a),
            (Wanted::Logs(a), Wanted::Logs(b)) => b.is_subset(a),
            _ => false,
        }
    }
}

/// How a pull of a cloud session's agent ended: `None` while it runs, then why it failed, if it did.
type Ended = Option<Result<(), String>>;

/// What a cloud session's agent brings from the server, its endpoint `server`: one pull at a time, each in a task of
/// its own that no call's wait cuts short (`BRING`), so that a big vault's first pull runs once, to its end, however
/// many calls wait on it, and the server never answers the same pull twice at once, nor one dropped half way and asked
/// again from the start.
struct Bringing {
    server: EndpointId,
    /// The pull under way, if one is: what it brings, and how it ended, once it did.
    under_way: std::sync::Mutex<Option<(Wanted, watch::Receiver<Ended>)>>,
}

impl Bringing {
    fn new(server: EndpointId) -> Bringing {
        Bringing { server, under_way: std::sync::Mutex::new(None) }
    }

    /// Brings `wanted` from the server onto `node`: by the pull under way where it brings that too, else by a pull of
    /// its own once that one ended. Fails where the pull does, and where it isn't over by `until`, which leaves it
    /// running.
    async fn bring(self: &Arc<Self>, node: &Arc<Node>, wanted: Wanted, until: tokio::time::Instant) -> Result<()> {
        loop {
            let (ours, mut end) = {
                let mut under_way = self.under_way.lock().expect("under way");
                match &*under_way {
                    Some((what, end)) => (what.covers(&wanted), end.clone()),
                    None => {
                        let (tell, end) = watch::channel(None);
                        *under_way = Some((wanted.clone(), end.clone()));
                        let (this, node, what) = (self.clone(), node.clone(), wanted.clone());
                        tokio::spawn(async move {
                            let brought = match what {
                                Wanted::Vaults(vaults) => node.bring(this.server, vaults).await,
                                Wanted::Logs(logs) => node.bring_logs(this.server, logs).await,
                            };
                            *this.under_way.lock().expect("under way") = None;
                            tell.send_replace(Some(brought.map(drop).map_err(|e| format!("{e:#}"))));
                        });
                        (true, end)
                    }
                }
            };
            let waited = tokio::time::timeout_at(until, end.wait_for(Option::is_some)).await;
            let ended: Option<Ended> = waited.ok().map(|ended| match ended {
                Ok(ended) => ended.clone(),
                Err(_) => Some(Err("it stopped half way".into())),
            });
            // a pull whose task ended without a word, as one the runtime dropped, is over too
            if matches!(ended, Some(Some(Err(_)))) {
                let mut under_way = self.under_way.lock().expect("under way");
                if under_way.as_ref().is_some_and(|(_, e)| e.same_channel(&end)) {
                    *under_way = None;
                }
            }
            let ended = match ended {
                Some(ended) => ended,
                None => {
                    let (held, _) = node.read(|lab, me| lab.size(me)).await;
                    bail!(
                        "avenDB is still bringing what this call touches from the server, one pull at a time, as a \
                         vault's first call does ({held} edits here so far): nothing was read or changed yet, so call \
                         again in a moment"
                    );
                }
            };
            if ours {
                let ended = ended.unwrap_or(Ok(()));
                return ended.map_err(|why| anyhow!("avenDB can't bring this call's vaults from the server: {why}"));
            }
        }
    }
}

/// The vaults and the entries tool call args `args` name by their ids, anywhere in them: as a `vault`, `over`, `to` or
/// `as`, or among `vaults`; as an `entry` or a `spark`, or among `entries`. What is no id names nothing.
fn names_in(args: &Value) -> (BTreeSet<VaultId>, BTreeSet<EntryId>) {
    let (mut vaults, mut entries) = (BTreeSet::new(), BTreeSet::new());
    let id = |v: &Value| v.as_str().map(|t| t.trim().to_ascii_lowercase());
    let mut left = vec![args];
    while let Some(value) = left.pop() {
        match value {
            Value::Object(fields) => {
                for (key, v) in fields {
                    match key.as_str() {
                        "vault" | "over" | "to" | "as" => vaults.extend(id(v).and_then(|t| VaultId::from_hex(&t))),
                        "entry" | "spark" => entries.extend(id(v).and_then(|t| EntryId::from_hex(&t))),
                        "vaults" => {
                            let each = v.as_array().into_iter().flatten().filter_map(id);
                            vaults.extend(each.filter_map(|t| VaultId::from_hex(&t)));
                        }
                        "entries" => {
                            let each = v.as_array().into_iter().flatten().filter_map(id);
                            entries.extend(each.filter_map(|t| EntryId::from_hex(&t)));
                        }
                        _ => left.push(v),
                    }
                }
            }
            Value::Array(items) => left.extend(items),
            _ => {}
        }
    }
    (vaults, entries)
}

/// The agent's device, as its MCP answers.
struct Agent {
    node: Arc<Node>,
    /// the app's folder, beside which it leaves its requests; a cloud session's agent's own folder
    host: PathBuf,
    /// its device's name, agentClaude, which its device vault's profile reads too
    name: String,
    /// a cloud session's agent's: what it brings from the server, before each call (`bring_for`)
    cloud: Option<Arc<Bringing>>,
}

impl Agent {
    /// The answer to MCP message `m`: none for a notification.
    async fn answer(&self, m: &Value) -> Option<Value> {
        answer(m, || self.instructions(), |name, args| async move { self.call(&name, &args).await }).await
    }

    fn instructions(&self) -> String {
        instructions(&self.name, self.cloud.is_some())
    }

    /// A cloud session's agent, before tool `name` with `args`: who it is, while it doesn't know yet, by every
    /// vault's log and share it may hold; then the vaults the call touches (`touches`), their entries as the server
    /// holds them now, so that a read shows the latest and a change builds on what another session of the same key
    /// wrote meanwhile. Nothing on a Mac, whose agent's device is one process and syncs with the Mac as ever. Fails,
    /// saying so, where the server can't be asked, or while what it brings takes longer than a call waits (`BRING`).
    async fn bring_for(&self, name: &str, args: &Value) -> Result<()> {
        let Some(cloud) = &self.cloud else { return Ok(()) };
        let until = tokio::time::Instant::now() + BRING;
        if self.node.read(|lab, me| lab.vault_of(me)).await.is_none() {
            cloud.bring(&self.node, Wanted::Vaults(BTreeSet::new()), until).await?;
        }
        // an entry it holds nothing of yet: its log first, which says whose it is
        let (vaults, entries) = names_in(args);
        let named = entries.clone();
        let unplaced = move |lab: &Lab, me| -> BTreeSet<LogId> {
            let unplaced = named.into_iter().filter(|e| lab.vault_of_entry(me, *e).is_none());
            unplaced.map(LogId::Entry).collect()
        };
        let unplaced = self.node.read(unplaced).await;
        if !unplaced.is_empty() {
            cloud.bring(&self.node, Wanted::Logs(unplaced), until).await?;
        }
        let touched = self.touches(name, vaults, entries).await;
        cloud.bring(&self.node, Wanted::Vaults(touched), until).await
    }

    /// The vaults tool `name` touches, by the vaults `vaults` and entries `entries` its args name (`names_in`): those,
    /// and the vaults of those entries, of the ones this device knows; where it names none, but to say who it is
    /// (`avendb_vaults`), its aven's coop, Maia City (`homes`), as a spark goes there. And its own device vault and its
    /// aven, always.
    async fn touches(&self, name: &str, vaults: BTreeSet<VaultId>, entries: BTreeSet<EntryId>) -> BTreeSet<VaultId> {
        let alone = name == "avendb_vaults";
        self.node
            .read(move |lab, me| {
                let st = lab.state(me);
                let mut touched: BTreeSet<VaultId> = vaults.into_iter().filter(|v| st.vault(*v).is_some()).collect();
                touched.extend(entries.into_iter().filter_map(|e| lab.vault_of_entry(me, e)));
                let Some(mine) = lab.vault_of(me) else { return touched };
                if touched.is_empty() && !alone {
                    touched.extend(homes(st, mine));
                }
                touched.insert(mine);
                let v = st.vault(mine);
                touched.extend(v.filter(|v| v.kind != Kind::Aven).and_then(owner_of));
                touched
            })
            .await
    }

    /// Why a cloud session's agent whose key belongs to no vault does nothing.
    fn unjoined(&self) -> String {
        let key = hex(&self.node.device().0);
        format!(
            "{name}'s key ({key}) isn't a device of avenMAIA: its person adds one in The OS app (Settings, Agents, Add a \
             cloud agent), which shows the key once, and puts it in this environment's {KEY_VAR}; a new session uses \
             it. Where they did so just now, the server may not have it yet: call again in a moment.",
            name = self.name
        )
    }

    /// Tool `name` with `args`: its text.
    async fn call(&self, name: &str, args: &Value) -> Result<String> {
        self.bring_for(name, args).await?;
        let vault = self.node.read(|lab, me| lab.vault_of(me)).await;
        if name == "avendb_request_access" {
            return self.ask_access(vault, args).await;
        }
        let Some(vault) = vault else {
            if self.cloud.is_some() {
                bail!("{}", self.unjoined());
            }
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
                let mut all = world["vaults"].as_array().cloned().unwrap_or_default();
                // a seed's vault whose profile it doesn't hold, as a cloud session's agent before it brings the coop,
                // by the name the seed gives it
                let seed = self.node.read(|lab, me| world::seed_of(lab, me)).await;
                for v in all.iter_mut().filter(|v| v["name"].is_null()) {
                    let at = seed.iter().position(|s| v["id"].as_str() == Some(hex(&s.0).as_str()));
                    if let Some(name) = at.and_then(|i| world::SEED_NAMES.get(i)) {
                        v["name"] = (*name).into();
                    }
                }
                let vaults: Vec<Value> =
                    all.iter().map(|v| json!({ "id": v["id"], "name": v["name"], "kind": v["kind"] })).collect();
                // the aven it acts as: the vault its key is a device of, avenMAIA (an older agent's device vault's
                // owner, the aven over it)
                let over = move |lab: &Lab, me| {
                    let v = lab.state(me).vault(vault)?;
                    if v.kind == Kind::Aven { Some(vault) } else { owner_of(v) }
                };
                let aven = self.node.read(over).await.map(|a| hex(&a.0));
                let named = |id: &Option<String>| all.iter().find(|v| v["id"].as_str() == id.as_deref());
                let aven_name = named(&aven).map_or(Value::Null, |v| v["name"].clone());
                let me = json!({ "device": self.name, "vault": hex(&vault.0), "aven": aven, "avenName": aven_name,
                    "key": hex(&self.node.device().0) });
                let under = aven_name.as_str().map(String::from).or(aven).unwrap_or_else(|| "no aven".into());
                let who = format!("{} is a device of the aven {under}, acting as it with its rights", self.name);
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
    /// passed on deciding: the engine's answer. The bytes of a put_file, or of a create with a `file`
    /// (`engine::brings`), are those of the file at the path beside it; a get_file, its own op, reads a file back to
    /// the path beside it (`get_file`). Fails before anything runs for a read, which avendb_ask runs, for a device's
    /// own setting, which an agent keeps nowhere, and for a path or `overwrite` beside an op that takes none.
    async fn run(&self, op: Value, beside: Beside) -> Result<Value> {
        let Beside { path, overwrite } = beside;
        if let Some(path) = &path {
            outside(&self.host, path)?;
        }
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
        let (answer, _) = match (engine::brings(&op), path) {
            (true, Some(path)) => {
                let (op, bytes) = with_file(op, path).await?;
                self.node.run(op, Some(bytes), None::<&NoCeremony>).await?
            }
            (true, None) => {
                let what = op_name(&op).unwrap_or_default();
                anyhow::bail!("{what} saves a file of this Mac here: give its absolute path beside the op")
            }
            (false, Some(_)) => anyhow::bail!("a path goes beside put_file, a create with a file or get_file alone"),
            (false, None) => self.node.run(op, None::<NoBytes>, None::<&NoCeremony>).await?,
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
    /// alike; a link or a media file goes in as an artifact of its own. It goes in vault `vault`, else in the first of
    /// its `homes` its shares let it add one to or draft one in (`adding`): its aven's coop, Maia City. A new entry of type spark tagged `tags` and the tags a share
    /// it adds through asks for (the `creatable` op), by the op the page runs, `create`, run as avendb_run runs one
    /// (`run`): on main where its shares let it create one there, else, where they let it only suggest, as a draft
    /// (`create` with `draft`), which the vault's owners land by accepting an AIP that names it (`lands`).
    /// `{"entry", "vault", "tags"}`, and for a draft `"draft": true`, its `line` and the `proposals` to name in an AIP.
    /// Fails with why, in words: where it may add no spark, the vaults it may, and those it may draft one in.
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
        let homes = self.homes(mine).await;
        let into = named.clone().map_or_else(|| homes.clone(), |v| vec![v]);
        let Some(Adding { vault, draft, asked }) = self.adding(&into, &[(SPARK, &tags)]).await? else {
            anyhow::bail!("{}", self.nowhere(mine, (SPARK, "sparks"), "", &tags, named.as_deref(), &homes).await?);
        };
        let tags = [tags, asked.into_iter().flatten().collect()].concat();
        let op = json!({ "op": "create", "vault": vault, "type": SPARK, "tags": tags, "value": value, "draft": draft });
        let answer = self.run(op, Beside::default()).await?;
        match (answer["ok"]["entry"].as_str(), answer.get("refused")) {
            (Some(entry), _) => {
                let mut made = json!({ "entry": entry, "vault": vault, "tags": tags });
                if draft {
                    lands(&mut made, &[&answer["ok"]]);
                }
                Ok(made.to_string())
            }
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
    /// (`rows_of`). It goes in vault `vault`, else where add_spark's goes, the first of its `homes` its shares let it
    /// add it and its file to or draft them in (`adding`), as a new entry of type artifact tagged `tags` and the tags a
    /// share it adds through asks for; and where `spark` names a spark, it is put on that spark's canvas too, under
    /// the rest (`put_on`). Where its shares let it only suggest there, the artifact is a draft, as add_spark's is, and
    /// its file a draft Library file of its own, which brings it in its creation (`create` with `draft` and `file`), as
    /// `put_file`, which makes a file entry on main, may not; the artifact links it as it links any, so once the AIP
    /// that names both lands them, it shows its file as one the page saved. It puts one on a spark, a draft or not,
    /// only where it may change the spark's main line: not on a draft spark its vault hasn't landed, nor where it may
    /// only suggest, where it says it didn't, and why. `{"entry", "vault", "tags", "look", "file"?, "spark"?}`, `spark`
    /// what became of the placing; and for a draft `"draft": true`, its `line`, its file's `fileLine`, and the
    /// `proposals` to name in an AIP, both. Fails with why, in words, before it saves anything where it may add no
    /// artifact, or no file, there.
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
            outside(&self.host, path)?;
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
        let homes = self.homes(mine).await;
        let into = named.clone().map_or_else(|| homes.clone(), |v| vec![v]);
        // where it may add the artifact, and its file first, if it brings one
        let none: &[String] = &[];
        let kinds = [(ARTIFACT, &tags[..]), (FILE, none)];
        let kinds = if path.is_some() { &kinds[..] } else { &kinds[..1] };
        let Some(Adding { vault, draft, asked }) = self.adding(&into, kinds).await? else {
            let with = if path.is_some() { " and its file" } else { "" };
            let nowhere = self.nowhere(mine, (ARTIFACT, "artifacts"), with, &tags, named.as_deref(), &homes).await?;
            anyhow::bail!("{nowhere}");
        };
        let mut asked = asked.into_iter();
        let (asked, file_tags) = (asked.next().unwrap_or_default(), asked.next().unwrap_or_default());
        // its file, saved to the Library first: a file entry on main, as put_file makes one; or, where it may only
        // suggest, a draft file entry, which brings it in its creation, as put_file's next write would
        let mut file = None;
        if let Some(path) = path {
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).context("the path names no file")?;
            let media = media_of(&name);
            let op = if draft {
                let value = json!({ "kind": FILE, "title": name, "media": media });
                let file = json!({ "name": name, "media": media });
                json!({ "op": "create", "vault": vault, "type": FILE, "tags": file_tags, "value": value, "draft": true,
                    "file": file })
            } else {
                json!({ "op": "put_file", "vault": vault, "name": name, "media": media, "tags": file_tags })
            };
            let answer = self.run(op, Beside { path: Some(path), overwrite: false }).await?;
            let Some(entry) = answer["ok"]["entry"].as_str() else {
                let (why, refused) = (answer["why"].as_str(), answer["refused"].as_str());
                anyhow::bail!("its file isn't saved: {} ({})", why.unwrap_or_default(), refused.unwrap_or_default());
            };
            file = Some((entry.to_string(), name, media, answer["ok"].clone()));
        }
        let look = look_of(link.as_ref(), file.as_ref().map(|(_, _, media, _)| *media));
        let title = match text("title")? {
            Some(title) => title,
            None => match (&link, &file) {
                (Some(link), _) => link_title(link),
                (None, Some((_, name, _, _))) => name.clone(),
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
        if let Some((entry, _, _, _)) = &file {
            value["files"] = json!([{ "vault": vault, "entry": entry }]);
        }
        let tags = [tags, asked].concat();
        let op =
            json!({ "op": "create", "vault": vault, "type": ARTIFACT, "tags": tags, "value": value, "draft": draft });
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
        if let Some((file, _, _, _)) = &file {
            made["file"] = file.as_str().into();
        }
        if draft {
            let saved = file.as_ref().map(|(_, _, _, saved)| saved);
            lands(&mut made, &[&answer["ok"]].into_iter().chain(saved).collect::<Vec<_>>());
            if let Some(saved) = saved {
                made["fileLine"] = saved["line"].clone();
            }
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
    /// has, on the spark's main line. Fails with why where it reads no such spark there, as a draft its vault hasn't
    /// landed, which holds nothing on main yet, or may not change it, as where it may only suggest.
    async fn put_on(&self, spark: &str, vault: &str, entry: &str) -> Result<()> {
        let got = self.node.op(json!({ "op": "get", "entry": spark })).await?;
        if let Some(refused) = got["refused"].as_str() {
            let none = "none is there, none of its shares reaches it, or it is a draft its vault hasn't landed";
            bail!("{} reads no spark {spark} on its main line ({refused}): {none}", self.name);
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
    /// asks for (the `creatable` op), on main, or with `draft`, as a draft: none where no share of its lets it create
    /// one there, or draft one. Fails where the vault's id is none.
    async fn creatable(&self, vault: &str, kind: &str, tags: &[String], draft: bool) -> Result<Option<Vec<String>>> {
        let ask = json!({ "op": "creatable", "vault": vault, "type": kind, "tags": tags, "draft": draft });
        let answer = self.node.op(ask).await?;
        if answer["refused"] == "BadOp" {
            anyhow::bail!("{}", answer["why"].as_str().unwrap_or_default());
        }
        let asked = answer["ok"]["tags"].as_array();
        Ok(asked.map(|t| t.iter().filter_map(|t| t.as_str().map(String::from)).collect()))
    }

    /// The vaults its new entries go in where it names none (`homes`), by their ids: its aven's coop, as the view of
    /// the aven `mine` it is a device of knows it.
    async fn homes(&self, mine: VaultId) -> Vec<String> {
        let homes = self.node.read(move |lab, me| homes(lab.state(me), mine)).await;
        homes.iter().map(|v| hex(&v.0)).collect()
    }

    /// How it adds a new entry of each of `kinds`, a type and its tags, to the first of the vaults `into`, by their
    /// ids, where its shares let it: on main where they let it create every one there; else as drafts, where they let
    /// it only suggest, as a Suggester's do, where they let it draft every one; each with the tags a share it adds
    /// through asks for besides (`creatable`). None where they let it do neither in any of them.
    async fn adding(&self, into: &[String], kinds: &[(&str, &[String])]) -> Result<Option<Adding>> {
        for vault in into {
            for draft in [false, true] {
                let mut asked = vec![];
                for (kind, tags) in kinds {
                    match self.creatable(vault, kind, tags, draft).await? {
                        Some(tags) => asked.push(tags),
                        None => break,
                    }
                }
                if asked.len() == kinds.len() {
                    return Ok(Some(Adding { vault: vault.clone(), draft, asked }));
                }
            }
        }
        Ok(None)
    }

    /// Why, in words, it may add no entry of type `kind` tagged `tags`, its type its word for one too and `kinds` for
    /// several, `with` after it, as " and its file", to the vault it `named`, or to any of its `homes`, where it names
    /// none: and of the vaults its world shows but its own device vault `mine`, the ones it may add one to
    /// (`creatable`), and the ones it may only draft one in, by their names.
    async fn nowhere(
        &self,
        mine: VaultId,
        (kind, kinds): (&str, &str),
        with: &str,
        tags: &[String],
        named: Option<&str>,
        homes: &[String],
    ) -> Result<String> {
        let world = self.node.op(json!({ "op": "world" })).await?;
        let vaults = world["ok"]["vaults"].as_array().cloned().unwrap_or_default();
        let (mut may, mut drafts) = (vec![], vec![]);
        for v in &vaults {
            let Some(id) = v["id"].as_str().filter(|id| *id != hex(&mine.0)) else { continue };
            if self.creatable(id, kind, tags, false).await?.is_some() {
                may.push(label(&vaults, id));
            } else if self.creatable(id, kind, tags, true).await?.is_some() {
                drafts.push(label(&vaults, id));
            }
        }
        let to = match (named, homes) {
            (Some(v), _) => format!("vault {}", label(&vaults, v)),
            (None, [coop, ..]) => format!("its aven's coop, {}", label(&vaults, coop)),
            (None, _) => "its aven's coop, which it doesn't know".into(),
        };
        let (me, may, drafts) = (&self.name, may.join(", "), drafts.join(", "));
        let can = match (may.is_empty(), drafts.is_empty()) {
            (true, true) => format!(
                "It may add {kinds} to no vault, nor draft one: ask its person for access with avendb_request_access, \
                 Suggester to draft them or Editor to add them"
            ),
            (false, true) => format!("It may add {kinds} to {may}: name one as vault"),
            (true, false) => format!("It may draft {kinds} in {drafts}, where it may only suggest: name one as vault"),
            (false, false) => format!("It may add {kinds} to {may}, and draft them in {drafts}: name one as vault"),
        };
        Ok(format!("{me} may add no {kind}{with} to {to}: no share of its lets it create or draft one there. {can}."))
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
            // acting as the aven, it asks the coop that owns it, which decides what the aven holds
            let over = move |lab: &Lab, me| {
                let v = lab.state(me).vault(vault)?;
                let aven = if v.kind == Kind::Aven { v } else { lab.state(me).vault(owner_of(v)?)? };
                owner_of(aven)
            };
            let coop = self.node.read(over).await.context("its aven has its coop, its one owner")?;
            let ask = json!({ "op": "ask", "to": hex(&coop.0), "level": level, "why": why, "vaults": vaults });
            let asked = self.node.op(ask).await?;
            if let Some(refused) = asked.get("refused") {
                bail!("the request is refused ({refused}): {}", asked["why"]);
            }
            return Ok(format!("Asked its aven's coop for {level} access, as a request of the aven. {answers}"));
        }
        if self.cloud.is_some() {
            bail!("{}", self.unjoined());
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

/// How an agent adds new entries to a vault (`Agent::adding`): the vault, by its id; whether as drafts, where it may
/// only suggest there; and the tags a share it adds through asks for besides, for each entry in turn.
struct Adding {
    vault: String,
    draft: bool,
    asked: Vec<Vec<String>>,
}

/// What the answer of avendb_add_spark or avendb_add_artifact says of a draft it made, beside its line and the
/// proposals to name in an AIP (`lands`).
const LANDS: &str = "A draft, on a line of its own: it shows nowhere on the vault's main line until the vault's owners \
                     land it, accepting an AIP that names it. Put it to them with avendb_run: aip_open (vault, title, \
                     a note saying why, proposals, these, with any other drafts and proposals of that vault, and an \
                     objective, its metrics in Lean), then aip_promote (entry).";

/// The answer `made` of a draft avendb_add_spark or avendb_add_artifact made, the create answers `drafted` of its
/// entry and of the drafts it brought, its file's, each `{entry, line}`: with `"draft": true`, its `line`, the
/// `proposals` to name in `aip_open`, and how its vault's owners land it (`LANDS`).
fn lands(made: &mut Value, drafted: &[&Value]) {
    let proposals: Vec<Value> = drafted.iter().map(|d| json!({ "entry": d["entry"], "line": d["line"] })).collect();
    made["draft"] = true.into();
    made["line"] = drafted.first().map_or(Value::Null, |d| d["line"].clone());
    made["proposals"] = proposals.into();
    made["lands"] = LANDS.into();
}

/// What a new spark's or artifact's `vault` says, in avendb_add_spark's and avendb_add_artifact's schemas.
const HOME: &str = "The id of the vault it goes in (avendb_vaults lists them); left out, its aven's coop, Maia \
                    City, where it may add or draft one there";

/// The tools it offers.
fn tools() -> Value {
    let one = json!({ "type": "object", "description": "One op of avenDB's engine, as JSON" });
    let op = json!({ "type": "object", "properties": { "op": one }, "required": ["op"] });
    let path = "For put_file, or a create with a file: the absolute path of the file on this Mac it saves; for \
                get_file: the absolute path on this Mac it writes the file it reads to";
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
            "vault": text(HOME),
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
            "vault": text(HOME),
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
                            insert, remove, move, tag, propose, variant, merge, restore, undo, fork, batch, aip_open, \
                            aip_objective, aip_measure, aip_promote, aip_withdraw, put_file, get_file. Where it may \
                            only suggest, write on a proposal, or draft a new entry: create with draft: true, which \
                            answers its entry and the line it starts; put proposals and drafts to its person in an \
                            AIP: aip_open over their lines with its objective, what it must deliver as metrics in \
                            Lean (or aip_objective after), record readings with aip_measure (entry, name, value, note) \
                            as it works, its progress in the aip read, then aip_promote, which needs the objective. put_file saves a file of this Mac into a vault as a new entry of \
                            type file, where the agent may create: the op names its vault and name, and media and tags \
                            if any, and the file's absolute path goes beside the op as path; its len is the file's \
                            size unless the op gives one. A create with file (an object, name and media if any) and \
                            a path beside it brings that file in the new entry's creation, a draft's too; put_file \
                            with entry in place of vault and name brings the file into that entry, where the agent \
                            may edit it on main. get_file reads a file of a vault back, as avendb_read_file \
                            does: the op names its entry, or its vault and name, and the absolute path it writes to \
                            goes beside the op, with overwrite: true to replace a file there.",
            "inputSchema": run,
        },
        {
            "name": "avendb_add_spark",
            "description": "Capture a spark as this agent, as the Sparks page captures one: anything that might \
                            become a story (a thought, a quote, a note), one small entry of avenDB's spark schema. \
                            Give its text, and its title and tags, if any. A link or a media file goes in as an \
                            artifact of its own, not on the spark. It goes in the vault named, else in its aven's \
                            coop, Maia City, where the aven's shares let it add or draft one there. Where they let \
                            it create there, as an Editor's do, on the \
                            vault's main line; where they let it only suggest, as a Suggester's, which an agent is on \
                            Maia City, as a draft, which the vault's owners land by accepting an AIP: the answer says \
                            draft: true and gives its line and the proposals to name in aip_open, then aip_promote. \
                            Where they let it do neither, it says which vaults it may add or draft sparks in. Answers \
                            the new spark's entry id, its vault and its tags.",
            "inputSchema": spark,
        },
        {
            "name": "avendb_add_artifact",
            "description": "Add an artifact as this agent, as the Artifacts page adds one: a source fact standing \
                            on its own, a bookmarked link, a YouTube video, a picture or a clip, one entry of \
                            avenDB's artifact schema. Give its url, or the absolute path of a file on this Mac, which \
                            it saves to the Library first, or both; and its title, note, by, taken, language and \
                            transcript if known. It goes where avendb_add_spark's goes: in the vault named, else in \
                            its aven's coop, Maia City; on main where the aven's \
                            shares let it create, else, where they let it only suggest, as a draft, its file a draft \
                            Library file of its own, both landed by the vault's owners accepting an AIP that names \
                            them (the answer's proposals). A spark named puts it on that spark's canvas too, where \
                            the agent may change the spark on main. Answers the new artifact's entry id, its vault, \
                            tags and look, its file's entry if it saved one, whether it is on the spark, and for a \
                            draft, draft: true, its line, its file's fileLine and the proposals.",
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

/// What goes beside an op on avendb_run: an absolute `path` on this Mac, the file put_file, or a create with a file,
/// saves, or where get_file writes the file it reads; and for get_file, whether it may replace a file there
/// (`overwrite`).
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

/// The folders an agent never reads a file from or writes one to, whatever path its harness names: those that keep
/// this Mac's keys. The app's avenDB folder `host` and its agents' beside it (each device's key, offer, lock and
/// socket), The OS's own folder (its API key and settings) and its media vault's, the terminals' keys, and the
/// person's SSH, GPG, cloud and Keychain folders. Its harness may reach them by tools of its own; the MCP never
/// carries their bytes into a vault, nor writes over them (Samuel 2026-10-19: an agent acts through vault caps alone).
fn fenced(host: &Path) -> Vec<PathBuf> {
    let mut out = vec![host.to_path_buf(), agents(host)];
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        let kept = [
            "Library/Application Support/city.maia.studio",
            "Library/Application Support/city.maia.vault",
            "Library/Keychains",
            ".config/maiacity",
            ".ssh",
            ".gnupg",
            ".aws",
        ];
        out.extend(kept.iter().map(|k| home.join(k)));
    }
    out
}

/// Fails where `path` is in a folder that keeps this Mac's keys (`fenced`), as the file system resolves it: its links
/// followed, and for a file not there yet, its folder's. A path whose folder can't be resolved is left to the caller,
/// which says it isn't there.
fn outside(host: &Path, path: &Path) -> Result<()> {
    let real = std::fs::canonicalize(path).ok().or_else(|| {
        let name = path.file_name()?;
        Some(std::fs::canonicalize(path.parent()?).ok()?.join(name))
    });
    let Some(real) = real else { return Ok(()) };
    for kept in fenced(host) {
        let kept = std::fs::canonicalize(&kept).unwrap_or(kept);
        if real.starts_with(&kept) {
            bail!("{} is in {}, which keeps this Mac's keys: an agent reads and writes no file there", path.display(), kept.display());
        }
    }
    Ok(())
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

/// The coop an agent acting as vault `vault` works for, by view `st`: the coop that owns the aven it is a device of
/// (`vault` itself, as an agent's key is a device of avenMAIA), or, for an older agent's device vault, the coop over
/// the aven that owns it; if the device knows them.
fn person_of(st: &State, vault: VaultId) -> Option<VaultId> {
    let v = st.vault(vault)?;
    let aven = if v.kind == Kind::Aven { vault } else { owner_of(v)? };
    owner_of(st.vault(aven)?)
}

/// Vault `v`'s one owner, where a vault alone owns it.
fn owner_of(v: &Vault) -> Option<VaultId> {
    let [Principal::Vault(owner)] = v.owners[..] else { return None };
    Some(owner)
}

/// The vaults a new spark or artifact of agent device vault `vault` goes in where it names none, by view `st`, in the
/// order it tries them, the first its shares let it add one to or draft one in taking it (`Agent::adding`): the coop
/// over its aven (`person_of`), Maia City, where all sparks and artifacts are seeded (Samuel 2026-10-18: one aven per
/// coop, none per person, and no person's own vault gets them). None it doesn't know.
pub fn homes(st: &State, vault: VaultId) -> Vec<VaultId> {
    person_of(st, vault).into_iter().collect()
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

/// Op `op`, a put_file or a create with a `file` (`engine::brings`), with the file at `path` on this Mac, which the
/// harness names: its length the file's size where the op gives none, and its bytes as the node reads them
/// (`read_path`). Fails if `path` names no file, or isn't absolute, as the harness's folder needn't be the agent's.
async fn with_file(mut op: Value, path: PathBuf) -> Result<(Value, impl FnMut() -> Chunks + Send)> {
    anyhow::ensure!(path.is_absolute(), "{} isn't an absolute path", path.display());
    let meta = tokio::fs::metadata(&path).await.with_context(|| format!("no file at {}", path.display()))?;
    anyhow::ensure!(meta.is_file(), "{} is no file", path.display());
    // its length the file's size unless the op gives one: put_file's own, a create's in its file
    let create = op_name(&op) == Some("create");
    let at = if create { op.get_mut("file") } else { Some(&mut op) };
    if let Some(o) = at.and_then(Value::as_object_mut) {
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
