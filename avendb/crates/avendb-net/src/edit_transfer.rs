//! Optional own-signer payload transfer. The final legacy reconciliation is always required.
//! The signed ledger is append-only, but the offered edit set is captured from current permissions and exact
//! durable held history. Neither an old ledger leaf nor a matching fingerprint authorizes a withdrawn record.
use crate::edit_ranges::{self as ranges, Budget, Charge, Round, Tree};
use crate::edit_ranges_wire::{self as wire, Binding, Offer, Request};
use crate::signers::Published;
use crate::{Peer, Shared, pulls, session};
use anyhow::{Context as _, Result, ensure};
use avendb::id::SignerId;
use avendb::lab::ReplyScope;
use avendb::policy::LogRevision;
use avendb::sync::LogId;
use avendb::wire::Request as Asking;
use bao_tree::blake3;
use n0_future::time::Instant;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use std::time::Duration;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

const STAGES: usize = if cfg!(target_arch = "wasm32") { 2 } else { 4 };
const RESPONSES: usize = if cfg!(target_arch = "wasm32") { 1 } else { 2 };
const AGE: Duration = Duration::from_secs(90);
pub(crate) const DEADLINE: Duration = Duration::from_secs(20);
// A reset may mean an old peer, a transient undurable head, or an empty authorized scope.
// It is never evidence that all later scopes on this connection are unsupported.
const RETRY_HINT: Duration = Duration::from_secs(30);
const CANDIDATES: usize = ranges::RETAINED_BYTES / 1024;
/// One permit permits at most one bounded frame and its write-only decoded representation plus serialization
/// scratch (conservatively four FETCH_BYTES). It is acquired before reading a kind16 body, with no queued waiters.
/// The same Arc is retained by blocking Lab workers and by the response through write_all/drop.
pub(crate) struct Serving {
    _permit: OwnedSemaphorePermit,
}
pub(crate) struct Runtime {
    budget: Budget,
    pub(crate) summaries: crate::edit_summaries::Queue,
    response: Arc<Semaphore>,
    stages: Mutex<BTreeMap<[u8; 16], Arc<Stage>>>,
    // Only a small retry hint. Evicting it retries capability discovery; no correctness state is lost.
    unsupported: Mutex<BTreeMap<usize, Instant>>,
}
impl Default for Runtime {
    fn default() -> Self {
        Self {
            budget: Budget::default(),
            summaries: Default::default(),
            response: Arc::new(Semaphore::new(RESPONSES)),
            stages: Default::default(),
            unsupported: Default::default(),
        }
    }
}
struct Used {
    queries: usize,
    control: usize,
    fetch: usize,
}
struct Stage {
    peer: SignerId,
    generation: usize,
    binding: Binding,
    asking: Asking,
    scope: ReplyScope,
    revision: LogRevision,
    published: Published,
    tree: Arc<Tree>,
    began: Instant,
    active: AtomicBool,
    used: Mutex<Used>,
    _charge: Charge,
}
impl Stage {
    fn reserve(&self, control: usize, fetch: usize, queries: usize) -> Result<()> {
        ensure!(
            self.active.load(Ordering::Acquire) && self.began.elapsed() < AGE,
            "expired edit range stage"
        );
        let mut used = self.used.lock().expect("edit range quota");
        let next = Used {
            queries: used
                .queries
                .checked_add(queries)
                .context("range query overflow")?,
            control: used
                .control
                .checked_add(control)
                .context("range byte overflow")?,
            fetch: used
                .fetch
                .checked_add(fetch)
                .context("range fetch overflow")?,
        };
        ensure!(
            next.queries <= ranges::MAX_QUERIES
                && next.control <= ranges::ROUND_CONTROL_BYTES
                && next.fetch <= ranges::ROUND_FETCH_BYTES,
            "edit range cumulative budget"
        );
        *used = next;
        Ok(())
    }
}
impl Runtime {
    pub(crate) fn serving(&self) -> Result<Arc<Serving>> {
        Ok(Arc::new(Serving {
            _permit: self
                .response
                .clone()
                .try_acquire_owned()
                .context("edit range responses busy")?,
        }))
    }
    /// After quiescence, a retained closed Node keeps no staged peer inventory or pending derived write.
    pub(crate) fn close(&self) {
        let mut stages = self.stages.lock().expect("edit range stages");
        for stage in stages.values() { stage.active.store(false, Ordering::Release); }
        stages.clear();
        drop(stages);
        self.unsupported.lock().expect("edit range support").clear();
        self.summaries.discard();
    }
    fn unavailable(&self, generation: usize) -> bool {
        let now = Instant::now();
        let mut hints = self.unsupported.lock().expect("edit range support");
        hints.retain(|_, until| *until > now);
        hints.contains_key(&generation)
    }
    fn refused(&self, generation: usize) {
        let now = Instant::now();
        let mut hints = self.unsupported.lock().expect("edit range support");
        hints.retain(|_, until| *until > now);
        if hints.len() >= 64 { hints.pop_first(); }
        hints.insert(generation, now + RETRY_HINT);
    }
    pub(crate) fn expire(&self) {
        let now = Instant::now();
        self.unsupported.lock().expect("edit range support").retain(|_, until| *until > now);
        self.stages
            .lock()
            .expect("edit range stages")
            .retain(|_, s| {
                let keep = s.active.load(Ordering::Acquire) && s.began.elapsed() < AGE;
                if !keep {
                    s.active.store(false, Ordering::Release);
                }
                keep
            });
    }
    pub(crate) fn gone(&self, generation: usize) {
        self.stages
            .lock()
            .expect("edit range stages")
            .retain(|_, s| {
                let keep = s.generation != generation;
                if !keep {
                    s.active.store(false, Ordering::Release);
                }
                keep
            });
        self.unsupported
            .lock()
            .expect("edit range support")
            .remove(&generation);
    }
    fn retire(&self, peer: &Peer) {
        self.stages
            .lock()
            .expect("edit range stages")
            .retain(|_, s| {
                let keep = s.generation != peer.conn.stable_id() || s.peer != peer.device;
                if !keep {
                    s.active.store(false, Ordering::Release);
                }
                keep
            });
    }
    fn stage(&self, peer: &Peer, binding: Binding) -> Result<Arc<Stage>> {
        self.expire();
        let stage = self
            .stages
            .lock()
            .expect("edit range stages")
            .get(&binding.token)
            .cloned()
            .context("unknown edit range stage")?;
        ensure!(
            stage.peer == peer.device
                && stage.generation == peer.conn.stable_id()
                && stage.binding == binding,
            "foreign edit range stage"
        );
        Ok(stage)
    }
    fn install(&self, stage: Arc<Stage>) -> Result<()> {
        self.expire();
        let mut stages = self.stages.lock().expect("edit range stages");
        stages.retain(|_, old| {
            let keep = old.peer != stage.peer || old.generation != stage.generation;
            if !keep {
                old.active.store(false, Ordering::Release);
            }
            keep
        });
        ensure!(stages.len() < STAGES, "edit range stage limit");
        ensure!(
            !stages.contains_key(&stage.binding.token),
            "edit range token collision"
        );
        stages.insert(stage.binding.token, stage);
        Ok(())
    }
}
fn selected(shared: &Shared, peer: &Peer) -> bool {
    shared
        .live(peer.endpoint)
        .is_some_and(|p| p.device == peer.device && p.conn.stable_id() == peer.conn.stable_id())
}
async fn current(
    shared: &Arc<Shared>,
    peer: &Peer,
    stage: &Arc<Stage>,
    permit: &Arc<Serving>,
) -> Result<()> {
    ensure!(
        selected(shared, peer) && stage.active.load(Ordering::Acquire),
        "replaced edit range connection"
    );
    let (shared2, stage2, permit) = (shared.clone(), stage.clone(), permit.clone());
    let valid = shared
        .read(move |lab, me| {
            let _permit = permit;
            shared2.edits.as_ref().is_some_and(|e| {
                e.held(lab, me) == lab.log(me).edits().len()
            }) && lab.log(me).revision() == stage2.revision
        })
        .await;
    ensure!(
        valid && selected(shared, peer) && stage.active.load(Ordering::Acquire),
        "stale edit range scope or durable head"
    );
    Ok(())
}

/// This function runs only after kind16 receive admission. Legacy serving retains its historical admission rules.
pub(crate) async fn handle(
    shared: &Arc<Shared>,
    peer: &Peer,
    body: &[u8],
    permit: Arc<Serving>,
) -> Result<Vec<u8>> {
    let _activity = shared.admit()?;
    let result = n0_future::time::timeout(DEADLINE, handle_inner(shared, peer, body, permit))
        .await
        .context("edit range response deadline")
        .and_then(|v| v);
    if result.is_err() {
        shared.edit_transfer.retire(peer);
    }
    result
}
async fn handle_inner(
    shared: &Arc<Shared>,
    peer: &Peer,
    body: &[u8],
    permit: Arc<Serving>,
) -> Result<Vec<u8>> {
    ensure!(selected(shared, peer), "unselected edit range connection");
    let signers = shared
        .signers
        .as_ref()
        .context("durable signer roots unavailable")?;
    match Request::decode(body)? {
        Request::Begin { asking, known } => {
            // A root is disclosed only with a nonempty currently authorized eligible set, exactly as root
            // evidence attached to authorized legacy records. No raw global signer-index inventory is exposed.
            let published = signers.published().context("no published signer root")?;
            let scope = ReplyScope::Logs(asking.ask.haves.keys().copied().collect());
            let charge = shared.edit_transfer.budget.reserve(64 << 10)?;
            let shared2 = shared.clone();
            let permit2 = permit.clone();
            let (revision, history, key) = shared
                .read(move |lab, me| {
                    let _permit = permit2;
                    let edits = shared2.edits.as_ref()?;
                    if edits.held(lab, me) != lab.log(me).edits().len() {
                        return None;
                    }
                    Some((
                        lab.log(me).revision(),
                        crate::edit_summaries::history(lab.log(me).ids()),
                        lab.own_key(me, "edit range summaries 1", &[]),
                    ))
                })
                .await
                .context("edit range durable context unavailable")?;
            let who = peer.device;
            let mut token = [0; 16];
            getrandom::fill(&mut token).map_err(anyhow::Error::msg)?;
            let binding = Binding {
                token,
                scope: wire::scope(&asking),
                root: *blake3::hash(&published.root().root.message()).as_bytes(),
            };
            let persisted = crate::edit_summaries::Binding {
                device: shared.me,
                peer: who,
                scope: binding.scope,
                history,
                root: binding.root,
                engine: avendb::paged_view::engine(),
            };
            let loaded = match (shared.opts.shelf.as_ref(), key.as_ref()) {
                (Some(shelf), Some(key)) => {
                    crate::edit_summaries::load(
                        shelf,
                        &persisted,
                        key,
                        &shared.edit_transfer.budget,
                    )
                    .await
                }
                _ => None,
            };
            let fresh = loaded.is_none();
            let tree = match loaded {
                Some(tree) => Arc::new(tree),
                None => {
                    let input = shared
                        .edit_transfer
                        .budget
                        .reserve(CANDIDATES * 32 + 1024)?;
                    let (shared2, asking2, scope2, permit2) = (
                        shared.clone(),
                        asking.clone(),
                        scope.clone(),
                        permit.clone(),
                    );
                    let captured_revision = revision.clone();
                    let (mut ids, input) = shared
                        .read(move |lab, me| {
                            let _permit = permit2;
                            let edits = shared2.edits.as_ref()?;
                            if edits.held(lab, me) != lab.log(me).edits().len()
                                || lab.log(me).revision() != captured_revision
                            {
                                return None;
                            }
                            let (_, ids) = lab.range_inventory(
                                me,
                                who,
                                me,
                                &asking2,
                                &scope2,
                                CANDIDATES,
                                wire::PAYLOAD_BYTES,
                            )?;
                            Some((ids, input))
                        })
                        .await
                        .context("edit range inventory changed")?;
                    ids.retain(|id| signers.published_contains(*id, &published));
                    let tree = Arc::new(Tree::new(ids, &shared.edit_transfer.budget)?);
                    drop(input);
                    tree
                }
            };
            ensure!(
                tree.root().count > 0,
                "no authorized durable range payloads"
            );
            if fresh {
                if let Some(key) = key.as_ref() {
                    if shared
                        .edit_transfer
                        .summaries
                        .stage(persisted, &tree, key, &shared.edit_transfer.budget)
                        .is_ok()
                    {
                        if let Some(edits) = &shared.edits {
                            edits.due.notify_one();
                        }
                    }
                }
            }
            let prefix = known
                .map(|n| {
                    signers
                        .prefix_at(n, published.root().root.length)
                        .context("unavailable pinned consistency prefix")
                })
                .transpose()?
                .unwrap_or_default();
            let offer = Offer {
                binding,
                tree: tree.root(),
                root: published.root().clone(),
                prefix,
            };
            let stage = Arc::new(Stage {
                peer: who,
                generation: peer.conn.stable_id(),
                binding,
                asking,
                scope,
                revision,
                published,
                tree,
                began: Instant::now(),
                active: AtomicBool::new(true),
                used: Mutex::new(Used {
                    queries: 1,
                    control: body.len() + ROOT_BYTES_BOUND,
                    fetch: 0,
                }),
                _charge: charge,
            });
            current(shared, peer, &stage, &permit).await?;
            shared.edit_transfer.install(stage)?;
            offer.encode()
        }
        Request::Nodes { binding, prefixes } => {
            let stage = shared.edit_transfer.stage(peer, binding)?;
            stage.reserve(body.len() + prefixes.len() * 704 + 128, 0, prefixes.len())?;
            current(shared, peer, &stage, &permit).await?;
            let nodes = prefixes
                .into_iter()
                .map(|p| stage.tree.block(&p).map(|b| (p, b)))
                .collect::<Result<Vec<_>>>()?;
            wire::encode_nodes(binding, &nodes)
        }
        Request::Fetch { binding, ids } => {
            let stage = shared.edit_transfer.stage(peer, binding)?;
            stage.reserve(body.len(), wire::FETCH_BYTES, 1)?;
            ensure!(
                ids.iter().all(|id| stage.tree.contains(*id)),
                "fetch outside offered set"
            );
            current(shared, peer, &stage, &permit).await?;
            let (shared2, stage2, permit2) = (shared.clone(), stage.clone(), permit.clone());
            let selection = shared
                .read(move |lab, me| {
                    let _permit = permit2;
                    let edits = shared2.edits.as_ref()?;
                    if edits.held(lab, me) != lab.log(me).edits().len()
                    {
                        return None;
                    }
                    lab.range_select(
                        me,
                        stage2.peer,
                        me,
                        &stage2.asking,
                        &stage2.scope,
                        &stage2.revision,
                        &ids,
                        ranges::FETCH_IDS,
                        wire::PAYLOAD_BYTES,
                    )
                })
                .await
                .context("range payload scope changed")?;
            ensure!(
                selected(shared, peer) && stage.active.load(Ordering::Acquire),
                "range connection changed during selection"
            );
            let (edits, more) = selection;
            let mut records = Vec::with_capacity(edits.len());
            for signed in edits {
                let proof = signers
                    .proof_at(signed.edit.id(), &stage.published)
                    .context("range proof unavailable")?;
                records.push((signed, proof.path));
            }
            wire::encode_fetch(binding, &records, more)
        }
        Request::End { binding } => {
            let stage = shared.edit_transfer.stage(peer, binding)?;
            stage.active.store(false, Ordering::Release);
            shared
                .edit_transfer
                .stages
                .lock()
                .expect("edit range stages")
                .remove(&binding.token);
            Ok(Vec::new())
        }
    }
}
const ROOT_BYTES_BOUND: usize = wire::ROOT_BYTES + (avendb::batch::MOST_STEPS + 1) * 32 + 256;

/// Counts acceptance where it actually happens, inside the admitted Lab worker. The last owner publishes the
/// count, so a round timeout cannot report early while a cancelled waiter's blocking validation still runs.
struct Accepted {
    new: AtomicUsize,
    done: Option<tokio::sync::oneshot::Sender<usize>>,
}
impl Accepted {
    fn channel() -> (Arc<Self>, tokio::sync::oneshot::Receiver<usize>) {
        let (done, received) = tokio::sync::oneshot::channel();
        (Arc::new(Self { new: AtomicUsize::new(0), done: Some(done) }), received)
    }
}
impl Drop for Accepted {
    fn drop(&mut self) {
        if let Some(done) = self.done.take() {
            let _ = done.send(self.new.load(Ordering::Relaxed));
        }
    }
}

/// Call only for background entry batches after ask_differing's authority-first batch. Every outcome retains the
/// number of edits already accepted; even an error MUST be followed by a reconstructed ordinary legacy request.
/// Network deadlines stop further requests. Already admitted blocking validation is awaited before returning its
/// count, just as shutdown waits for the actual worker; that work cannot be preempted by dropping its waiter.
pub(crate) async fn receive(
    shared: &Arc<Shared>,
    peer: &Peer,
    logs: &BTreeSet<LogId>,
    admission: Arc<pulls::Admission>,
) -> (usize, Result<()>) {
    let (accepted, done) = Accepted::channel();
    let result = receive_attempt(shared, peer, logs, admission, accepted.clone()).await;
    drop(accepted);
    let new = done.await.expect("last range validation publishes its accepted count");
    (new, result)
}

async fn receive_attempt(
    shared: &Arc<Shared>,
    peer: &Peer,
    logs: &BTreeSet<LogId>,
    admission: Arc<pulls::Admission>,
    accepted: Arc<Accepted>,
) -> Result<()> {
    let _activity = shared.admit()?;
    ensure!(
        !logs.is_empty() && logs.iter().all(|l| matches!(l, LogId::Entry(_))),
        "range transfer requires entry-only batch"
    );
    ensure!(
        shared.signers.is_some(),
        "range evidence persistence unavailable"
    );
    ensure!(
        !shared.edit_transfer.unavailable(peer.conn.stable_id()),
        "peer range support unavailable"
    );
    // The whole attempt is time-bounded as well as every request. A timed-out server stage is reclaimed by
    // periodic maintenance even if this client cannot send END after cancellation.
    n0_future::time::timeout(AGE, receive_inner(shared, peer, logs, admission, accepted))
        .await
        .context("edit range round deadline")?
}
async fn receive_inner(
    shared: &Arc<Shared>,
    peer: &Peer,
    logs: &BTreeSet<LogId>,
    admission: Arc<pulls::Admission>,
    accepted: Arc<Accepted>,
) -> Result<()> {
    let who = peer.device;
    let logs = logs.clone();
    let input = shared
        .edit_transfer
        .budget
        .reserve(CANDIDATES * 32 + 1024)?;
    let preparing = admission.clone();
    let (asking, ids, input) = shared
        .read(move |lab, me| {
            let _preparing = preparing;
            let mut asking = lab.request(me, who);
            asking.after = None;
            asking.wants.clear();
            asking.ask.loose.clear();
            asking.ask.haves = logs.iter().map(|l| (*l, Vec::new())).collect();
            let scope = ReplyScope::Logs(logs);
            let (_, ids) = lab.range_inventory(
                me,
                who,
                who,
                &asking,
                &scope,
                CANDIDATES,
                wire::PAYLOAD_BYTES,
            )?;
            Some((asking, ids, input))
        })
        .await
        .context("local range inventory unavailable")?;
    wire::validate_asking(&asking)?;
    let local = Tree::new(ids, &shared.edit_transfer.budget)?;
    drop(input);
    let known = shared.signers.as_ref().expect("checked").known(who).await;
    let begin = Request::Begin {
        asking: asking.clone(),
        known,
    }
    .encode()?;
    let permit = shared.pulls.page(false, true).await?;
    let offered = n0_future::time::timeout(
        DEADLINE,
        session::exchange(&peer.conn, ranges::KIND, &begin, ranges::CONTROL_BYTES),
    )
    .await
    .context("range offer deadline")?;
    let offered = match offered {
        Ok(bytes) => bytes,
        Err(error) => {
            shared.edit_transfer.refused(peer.conn.stable_id());
            return Err(error);
        }
    };
    let offer = Offer::decode(&offered)?;
    ensure!(
        offer.binding.scope == wire::scope(&asking) && offer.root.root.log == who,
        "range offer belongs to another scope/signer"
    );
    ensure!(
        shared
            .signers
            .as_ref()
            .expect("checked")
            .admit((*offer.root).clone(), &offer.prefix)
            .await?,
        "range root evidence not admitted"
    );
    drop(permit);
    let binding = offer.binding;
    let transfer = async {
        let mut control = begin.len() + offered.len();
        let mut fetch = 0usize;
        let mut queries = 1usize;
        let mut round = Round::new(offer.tree, &shared.edit_transfer.budget)?;
        loop {
            let prefixes = round.next(&local)?;
            if prefixes.is_empty() {
                break;
            }
            let request = Request::Nodes { binding, prefixes }.encode()?;
            queries += 1;
            let permit = shared.pulls.page(false, true).await?;
            let answer = n0_future::time::timeout(
                DEADLINE,
                session::exchange(&peer.conn, ranges::KIND, &request, ranges::CONTROL_BYTES),
            )
            .await
            .context("range node deadline")??;
            control = control
                .checked_add(request.len() + answer.len())
                .context("range control overflow")?;
            ensure!(
                control <= ranges::ROUND_CONTROL_BYTES && queries <= ranges::MAX_QUERIES,
                "range client control budget"
            );
            for (prefix, block) in wire::decode_nodes(&answer, binding)? {
                round.accept(prefix, block, &local)?;
            }
            drop(permit);
        }
        let missing = round.finish()?;
        let mut cursor = None;
        loop {
            let ids: BTreeSet<_> = missing
                .ids()
                .iter()
                .filter(|id| cursor.is_none_or(|last| **id > last))
                .take(ranges::FETCH_IDS)
                .copied()
                .collect();
            if ids.is_empty() {
                break;
            }
            let next = ids.last().copied();
            let mut remaining = ids;
            while !remaining.is_empty() {
                queries += 1;
                ensure!(
                    queries <= ranges::MAX_QUERIES
                        && fetch + wire::FETCH_BYTES <= ranges::ROUND_FETCH_BYTES,
                    "range client fetch budget"
                );
                let request = Request::Fetch {
                    binding,
                    ids: remaining.clone(),
                }
                .encode()?;
                control = control
                    .checked_add(request.len())
                    .context("range request overflow")?;
                ensure!(
                    control <= ranges::ROUND_CONTROL_BYTES,
                    "range client control budget"
                );
                let permit = shared.pulls.page(false, true).await?;
                let answer = n0_future::time::timeout(
                    DEADLINE,
                    session::exchange(&peer.conn, ranges::KIND, &request, wire::FETCH_BYTES),
                )
                .await
                .context("range fetch deadline")??;
                fetch += answer.len();
                let (mut edits, _) =
                    wire::decode_fetch(&answer, binding, &offer.root, who, &remaining)?;
                ensure!(
                    edits.iter().all(
                        |signed| avendb::sync::log_of(&signed.edit, signed.edit.id())
                            .is_some_and(|log| asking.ask.haves.contains_key(&log))
                    ),
                    "fetched edit outside requested logs"
                );
                // No trust elevation: immutable signatures are checked outside the Lab mutex,
                // then current-state admission runs on the whole page under that mutex.
                for signed in &edits {
                    remaining.remove(&signed.edit.id());
                }
                shared.sized(&mut edits);
                let owner = (admission.clone(), accepted.clone());
                #[cfg(not(target_arch = "wasm32"))]
                let (prepared, permit, activity, (admitted, accepted)) = shared
                    .prepare_received_page(edits, permit, owner, #[cfg(test)] None)
                    .await?;
                #[cfg(target_arch = "wasm32")]
                let (prepared, permit, activity, (admitted, accepted)) = shared
                    .prepare_received_page(edits, permit, owner)
                    .await?;
                shared.admit_received_batches(prepared,permit,activity,(admitted,accepted),
                    crate::lab_schedule::Class::Background, |(_,accepted),new| {
                        accepted.new.fetch_add(new,Ordering::Relaxed);
                    }).await?;
            }
            cursor = next;
        }
        Ok::<_, anyhow::Error>(())
    }
    .await;
    // Best effort; bounded maintenance owns eventual cleanup on every cancellation/error path.
    if let Ok(end) = (Request::End { binding }).encode() {
        let _ = n0_future::time::timeout(
            Duration::from_secs(1),
            session::exchange(&peer.conn, ranges::KIND, &end, 64),
        )
        .await;
    }
    transfer
}

#[cfg(all(test, not(target_arch = "wasm32")))]
#[path = "edit_transfer_tests.rs"]
mod tests;
