//! Signed holdings (H2): a device signs what it tells each peer it holds, with when it checked (`wire::Statement`), and
//! hands that statement to each peer on a live connection, beside its announcements (`session::STATE`). A statement
//! names its device and proves itself, so unlike an announcement it counts whatever connection brings it: a node keeps
//! the newest statement each device it knows signed (`Shared::keep_statement`), passes it on to each live peer that may know all it
//! says by the node's view, and keeps it on its shelf, so that it outlives the device's connection and the node's own
//! restarts. Synced to lists a device on a live connection by what it announced, and any other by its newest statement,
//! with when it checked (`Shared::synced_to`, `H2_synced_to_at`). Like holdings, statements route and show, and never
//! let anyone fetch anything (T27).
//!
//! A device signs one statement for each set of holdings it tells a peer, once it tells that peer something new, at
//! most every `STATE_EVERY`, and again every `RESTATE` while they stay the same. A node reaches out to nobody for them:
//! it tells only the peers it is connected to.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Result, bail};
use avendb::id::SignerId;
use avendb::wire::{Statement, Wire};
use bytes::Bytes;
use n0_future::task;
use n0_future::time::Instant;

use crate::holdings::{Holdings, MOST};
use crate::{Peer, Reach, Shared, session, unix_now};

/// The least time between two statements a device signs for a peer: what it holds may change many times a second as
/// it syncs, and its peers learn each change from its announcements at once.
const STATE_EVERY: Duration = Duration::from_secs(10);
/// How often a device signs what it holds again while it stays the same, so that its peers know it checked lately.
const RESTATE: Duration = Duration::from_secs(15 * 60);
/// The least time between two statements of a device a node puts on its shelf, when they state other holdings.
const SHELVE_EVERY: Duration = Duration::from_secs(60 * 60);
/// The least time between two statements of a device a node puts on its shelf, when they state the same holdings,
/// for its newer time alone.
const SHELVE_SAME: Duration = Duration::from_secs(24 * 60 * 60);
/// The furthest ahead of the node's clock a statement it keeps may say its device checked: devices' clocks differ.
const AHEAD: u64 = 24 * 60 * 60;
/// Where a node's shelf keeps statements: `stated/<device>/<checked>`, the device's id in hex and when it checked as
/// 16 hex digits, so that each device's newest is its last.
const STATED: &str = "stated/";

/// What a node keeps of signed holdings.
#[derive(Default)]
pub(crate) struct Statements {
    /// Of each other device, the newest statement it signed that the node heard or kept on its shelf, with what it
    /// states.
    kept: HashMap<SignerId, Kept>,
    /// The statements the node's device signed lately: one for each set of holdings it tells a peer, with when.
    mine: Vec<(Kept, Instant)>,
    /// What each peer was told on which connection (`Connection::stable_id`).
    told: HashMap<SignerId, Told>,
    /// Of each device, what its newest statement on the shelf states, and when it went there.
    shelved: HashMap<SignerId, (Kept, Instant)>,
    /// A task is telling the peers now.
    busy: bool,
}

/// A statement and the holdings it states.
#[derive(Clone)]
struct Kept {
    statement: Arc<Statement>,
    holdings: Holdings,
}

impl Kept {
    fn of(statement: Statement) -> Kept {
        let logs = statement.logs.iter().cloned().collect();
        let files = statement.files.iter().cloned().collect();
        Kept { holdings: Holdings { logs, files }, statement: Arc::new(statement) }
    }
}

/// What a peer was told on its connection `on`: of the node's device, what it stated and when it signed that; and of
/// each other device, when its statement passed on checked.
struct Told {
    on: usize,
    mine: Option<(Holdings, Instant)>,
    passed: HashMap<SignerId, u64>,
}

/// The name on a shelf of a statement of `device` checked at `checked`.
fn shelved_as(device: SignerId, checked: u64) -> String {
    format!("{STATED}{}/{checked:016x}", device.to_hex())
}

/// Its device, if `statement` proves it: off the async threads, where it has them, as SLH-DSA takes a millisecond.
async fn verified(statement: Statement) -> Option<(SignerId, Statement)> {
    let work = move || statement.verify().map(|d| (d, statement));
    #[cfg(not(target_arch = "wasm32"))]
    return tokio::task::spawn_blocking(work).await.ok().flatten();
    #[cfg(target_arch = "wasm32")]
    work()
}

/// Whether a peer that may know `reach` by the node's view may know all `holdings` state.
fn may_know(reach: &Reach, holdings: &Holdings) -> bool {
    holdings.logs.keys().all(|l| reach.logs.contains(l)) && holdings.files.keys().all(|f| reach.files.contains(f))
}

impl Shared {
    /// `statement`, from a peer (`session::STATE`) or the node's shelf: kept if it proves its device, another than the
    /// node's own, one the node's device knows (`Reach`) unless it comes from the shelf, and is newer than the one
    /// kept of it; else refused, unless only older. A statement checked more than `AHEAD` past the node's clock, or of
    /// more than `MOST` logs or files, is refused.
    pub(crate) async fn keep_statement(&self, statement: Statement, shelved: bool) -> Result<()> {
        if statement.logs.len() > MOST || statement.files.len() > MOST {
            bail!("a statement of more than {MOST} logs or files");
        }
        if statement.checked > unix_now().saturating_add(AHEAD) {
            bail!("a statement checked in the future");
        }
        let Some((device, statement)) = verified(statement).await else { bail!("a statement no device signed") };
        if device == self.me {
            bail!("a statement of the node's own device");
        }
        if !shelved && !self.reach.lock().expect("reach").contains_key(&device) {
            bail!("a statement of a device the node doesn't know");
        }
        let mut st = self.statements.lock().expect("statements");
        if st.kept.get(&device).is_some_and(|k| k.statement.checked >= statement.checked) {
            return Ok(());
        }
        let kept = Kept::of(statement);
        if shelved {
            st.shelved.insert(device, (kept.clone(), Instant::now()));
        }
        st.kept.insert(device, kept);
        drop(st);
        // so that the announcer passes it on
        self.changed.notify_one();
        Ok(())
    }

    /// The newest statement the node keeps of `device`.
    pub(crate) fn statement_of(&self, device: SignerId) -> Option<Statement> {
        let st = self.statements.lock().expect("statements");
        st.kept.get(&device).map(|k| (*k.statement).clone())
    }

    /// Of each device it keeps a statement of, but those connected to it now, what the newest states and when its device
    /// checked: what Synced to lists them by.
    pub(crate) fn stated(&self) -> BTreeMap<SignerId, (Holdings, u64)> {
        let live: HashSet<SignerId> = {
            let peers = self.peers.lock().expect("peers");
            peers.values().filter(|p| p.conn.close_reason().is_none()).map(|p| p.device).collect()
        };
        let st = self.statements.lock().expect("statements");
        let others = st.kept.iter().filter(|(d, _)| !live.contains(d));
        others.map(|(d, k)| (*d, (k.holdings.clone(), k.statement.checked))).collect()
    }

    /// Tells the live peers of `reach` the statements they are due, on a task of its own, unless one is at it; and puts
    /// on the shelf the statements due there.
    pub(crate) fn state(self: &Arc<Self>, reach: &Arc<BTreeMap<SignerId, Reach>>) {
        let mut st = self.statements.lock().expect("statements");
        if std::mem::replace(&mut st.busy, true) {
            return;
        }
        drop(st);
        let (shared, reach) = (self.clone(), reach.clone());
        task::spawn(async move {
            shared.stating(&reach).await;
            shared.shelve();
            shared.statements.lock().expect("statements").busy = false;
        });
    }

    /// `state`'s task: to each peer of `reach` on a live connection, the statement of what the node's device holds of
    /// what the peer may know (`Holdings::only`), once it is new on that connection or it changed, at most every
    /// `STATE_EVERY`, and again after `RESTATE`; and the newest statement of each other device the node keeps, if the
    /// peer may know all of it by the node's view and wasn't told it yet on that connection. Each signed once for all
    /// the peers it goes to.
    async fn stating(self: &Arc<Self>, reach: &BTreeMap<SignerId, Reach>) {
        let own = self.own.lock().expect("own").holdings.clone();
        let live = |(d, r): (&SignerId, &Reach)| {
            let peer = self.live(r.endpoint).filter(|p| p.device == *d)?;
            Some((peer, own.only(&r.logs, &r.files)))
        };
        let peers: Vec<(Peer, Holdings)> = reach.iter().filter_map(live).collect();
        let now = Instant::now();
        // what to sign: each set of holdings a peer is due, of which the node signed none lately
        let due = |p: &Peer, want: &Holdings, st: &Statements| match st.told.get(&p.device) {
            Some(t) if t.on == p.conn.stable_id() => match &t.mine {
                Some((was, at)) if was == want => now.duration_since(*at) >= RESTATE,
                Some((_, at)) => now.duration_since(*at) >= STATE_EVERY,
                None => true,
            },
            _ => true,
        };
        let fresh = |want: &Holdings, st: &Statements| {
            st.mine.iter().any(|(k, at)| k.holdings == *want && now.duration_since(*at) < RESTATE)
        };
        let mut sign: Vec<Holdings> = Vec::new();
        {
            let st = self.statements.lock().expect("statements");
            for (p, want) in &peers {
                if due(p, want, &st) && !fresh(want, &st) && !sign.contains(want) {
                    sign.push(want.clone());
                }
            }
        }
        if !sign.is_empty() {
            let checked = unix_now();
            let signing = move |lab: &mut avendb::lab::Lab, me| {
                let state = |h: Holdings| {
                    let (logs, files) = (h.logs.into_iter().collect(), h.files.into_iter().collect());
                    lab.statement(me, checked, logs, files)
                };
                sign.into_iter().filter_map(state).collect::<Vec<_>>()
            };
            let signed = self.lab(signing).await;
            let mut st = self.statements.lock().expect("statements");
            for s in signed {
                let kept = Kept::of(s);
                st.mine.retain(|(k, _)| k.holdings != kept.holdings);
                st.mine.push((kept, now));
            }
        }
        // what each peer is told: its own statement, if due, and those of others it may know and wasn't told
        let mut st = self.statements.lock().expect("statements");
        st.mine.retain(|(k, _)| peers.iter().any(|(_, want)| k.holdings == *want));
        let mut sends: Vec<(Peer, Vec<Arc<Statement>>)> = Vec::new();
        for (p, want) in &peers {
            let mut out = Vec::new();
            let on = p.conn.stable_id();
            if due(p, want, &st) {
                if let Some((k, at)) = st.mine.iter().find(|(k, _)| k.holdings == *want).cloned() {
                    let told = st.told.entry(p.device).or_insert_with(|| Told { on, mine: None, passed: HashMap::new() });
                    if told.on != on {
                        *told = Told { on, mine: None, passed: HashMap::new() };
                    }
                    told.mine = Some((k.holdings, at));
                    out.push(k.statement);
                }
            }
            let Some(r) = reach.get(&p.device) else { continue };
            let passing: Vec<(SignerId, Arc<Statement>)> = st
                .kept
                .iter()
                .filter(|(d, k)| **d != p.device && reach.contains_key(d) && may_know(r, &k.holdings))
                .map(|(d, k)| (*d, k.statement.clone()))
                .collect();
            let told = st.told.entry(p.device).or_insert_with(|| Told { on, mine: None, passed: HashMap::new() });
            if told.on != on {
                *told = Told { on, mine: None, passed: HashMap::new() };
            }
            for (d, s) in passing {
                if told.passed.get(&d) != Some(&s.checked) {
                    told.passed.insert(d, s.checked);
                    out.push(s);
                }
            }
            if !out.is_empty() {
                sends.push((p.clone(), out));
            }
        }
        drop(st);
        // each peer on a task of its own, so that a slow one holds up nobody; told even if it refuses them, as a node
        // from before statements does, so that it isn't told again on that connection
        for (peer, out) in sends {
            task::spawn(async move {
                for s in out {
                    if session::exchange(&peer.conn, session::STATE, &s.to_wire(), 0).await.is_err() {
                        break;
                    }
                }
            });
        }
    }

    /// Puts on the shelf, if the node keeps one, the newest statement of each device that is due there: one newer than
    /// the last there, `SHELVE_EVERY` after it if it states other holdings, `SHELVE_SAME` after it if the same, and at
    /// once if none is there.
    fn shelve(self: &Arc<Self>) {
        let Some(shelf) = self.opts.shelf.clone() else { return };
        let now = Instant::now();
        let mut st = self.statements.lock().expect("statements");
        let due = |(d, k): (&SignerId, &Kept)| {
            let shelve = match st.shelved.get(d) {
                None => true,
                Some((was, _)) if was.statement.checked >= k.statement.checked => false,
                Some((was, at)) if was.holdings == k.holdings => now.duration_since(*at) >= SHELVE_SAME,
                Some((_, at)) => now.duration_since(*at) >= SHELVE_EVERY,
            };
            shelve.then(|| (*d, k.clone()))
        };
        let due: Vec<(SignerId, Kept)> = st.kept.iter().filter_map(due).collect();
        for (d, k) in &due {
            st.shelved.insert(*d, (k.clone(), now));
        }
        drop(st);
        for (d, k) in due {
            let shelf = shelf.clone();
            task::spawn(async move {
                let name = shelved_as(d, k.statement.checked);
                match shelf.put(&name, Bytes::from(k.statement.to_wire())).await {
                    // the same device's statement for another peer, checked the same second, is there first
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(e) => tracing::warn!("avendb: {name} doesn't go onto the shelf: {e}"),
                    Ok(()) => {}
                }
            });
        }
    }

    /// Takes back the statements on the node's shelf, if it keeps one: of each device, the newest that proves it.
    pub(crate) async fn unshelve(self: Arc<Self>) {
        let Some(shelf) = self.opts.shelf.clone() else { return };
        let names = match shelf.names(STATED).await {
            Ok(names) => names,
            Err(e) => return tracing::warn!("avendb: the statements on the shelf don't list: {e}"),
        };
        let mut by_device: BTreeMap<&str, Vec<&String>> = BTreeMap::new();
        for name in &names {
            let Some((device, _)) = name.strip_prefix(STATED).and_then(|rest| rest.split_once('/')) else { continue };
            by_device.entry(device).or_default().push(name);
        }
        for (device, names) in by_device {
            // the newest that reads and proves the device its name says, and was checked when its name says
            for name in names.into_iter().rev() {
                let Ok(Some(bytes)) = shelf.get(name).await else { continue };
                let Ok(statement) = Statement::from_wire(&bytes) else { continue };
                if *name != shelved_as(statement.device(), statement.checked) || statement.device().to_hex() != device {
                    continue;
                }
                if self.keep_statement(statement, true).await.is_ok() {
                    break;
                }
            }
        }
    }
}
