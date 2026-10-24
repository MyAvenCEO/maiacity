//! Local scheduling only: bounded outgoing pulls/pages and a bounded foreground peer race. These gates never
//! grant access, change a request's scope, or change the edit/cursor protocol. Cancellation releases admission;
//! callers move the page permit into blocking validation so detached work remains charged until it ends.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{Result, anyhow};
use avendb::id::SignerId;
use avendb::sync::LogId;
use iroh::EndpointId;
use n0_future::time::{self, Duration, Instant};
use n0_future::{FuturesUnordered, StreamExt as _, future};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// Four-MiB server pages fit here, with space for their framing. A larger legacy page or indivisible edit is
/// retried under exclusive page admission with the existing protocol ceiling, never silently truncated.
pub(crate) const PAGE_BYTES: usize = 8 << 20;
pub(crate) const FANOUT: usize = if cfg!(target_arch = "wasm32") { 2 } else { 3 };
pub(crate) const CATCH_UP_FANOUT: usize = if cfg!(target_arch = "wasm32") { 4 } else { 8 };
const HISTORY: usize = 128;
/// A small change on an established connection can bypass a backlog round. A full announcement or a large
/// catch-up delta stays on that round; a peer cannot grow the interactive queue without bound.
pub(crate) const LIVE_LOGS: usize = 16;
const LIVE_PEERS: usize = 64;

#[derive(Default)]
struct LiveBook {
    next: u64,
    peers: BTreeMap<SignerId, (u64, BTreeSet<LogId>)>,
}

/// One coalesced worker per authenticated peer. Dropping a cancelled worker releases its queue entry. Sequence
/// fencing prevents its drop from removing a replacement queued after an empty `next`.
pub(crate) struct LiveWork {
    book: Arc<Mutex<LiveBook>>,
    peer: SignerId,
    sequence: u64,
}

impl LiveWork {
    pub(crate) fn next(&mut self) -> Option<BTreeSet<LogId>> {
        let mut book = self.book.lock().expect("live pulls");
        let (sequence, logs) = book.peers.get_mut(&self.peer)?;
        if *sequence != self.sequence { return None; }
        if !logs.is_empty() { return Some(std::mem::take(logs)); }
        book.peers.remove(&self.peer);
        None
    }
}

impl Drop for LiveWork {
    fn drop(&mut self) {
        let mut book = self.book.lock().expect("live pulls");
        if book.peers.get(&self.peer).is_some_and(|(sequence, _)| *sequence == self.sequence) {
            book.peers.remove(&self.peer);
        }
    }
}

pub(crate) struct Budget {
    active: Arc<Semaphore>,
    background: Arc<Semaphore>,
    foreground_queue: Arc<Semaphore>,
    background_queue: Arc<Semaphore>,
    pages: Arc<Semaphore>,
    background_pages: Arc<Semaphore>,
    page_slots: u32,
    recent: Mutex<VecDeque<(EndpointId, Estimate)>>,
    live: Arc<Mutex<LiveBook>>,
}

/// The queue ticket is retained during service too, bounding all outstanding admissions, including waiters.
pub(crate) struct Admission {
    _ticket: OwnedSemaphorePermit,
    _background: Option<OwnedSemaphorePermit>,
    _active: OwnedSemaphorePermit,
}

/// Both permits travel together into validation, including a detached blocking worker.
pub(crate) struct Page {
    _background: Option<OwnedSemaphorePermit>,
    _page: OwnedSemaphorePermit,
}

/// Removal catch-up must distinguish an attempted unreachable peer from one never admitted locally.
pub(crate) struct CatchUp {
    required: usize,
    admitted: AtomicUsize,
    reached: AtomicBool,
}

pub(crate) struct Readiness {
    pub(crate) admitted: bool,
    pub(crate) reached: bool,
}

impl CatchUp {
    pub(crate) fn new(required: usize) -> Self {
        Self {
            required,
            admitted: AtomicUsize::new(0),
            reached: AtomicBool::new(false),
        }
    }
    pub(crate) fn reached(&self) {
        self.reached.store(true, Ordering::Relaxed);
    }
    pub(crate) fn finish(&self) -> Readiness {
        Readiness {
            admitted: self.admitted.load(Ordering::Relaxed) == self.required,
            reached: self.reached.load(Ordering::Relaxed),
        }
    }
}

impl Readiness {
    pub(crate) fn ready(&self) -> bool {
        self.admitted && self.reached
    }
}

#[derive(Clone, Copy)]
struct Estimate {
    micros: u64,
    failed: bool,
}

impl Default for Budget {
    fn default() -> Self {
        if cfg!(target_arch = "wasm32") {
            Self::new(4, 2, 2, 8, 16)
        } else {
            Self::new(8, 6, 4, 16, 48)
        }
    }
}

impl Budget {
    fn new(
        active: usize,
        background: usize,
        pages: u32,
        foreground_queue: usize,
        background_queue: usize,
    ) -> Self {
        Self {
            active: Arc::new(Semaphore::new(active)),
            background: Arc::new(Semaphore::new(background)),
            foreground_queue: Arc::new(Semaphore::new(foreground_queue)),
            background_queue: Arc::new(Semaphore::new(background_queue)),
            pages: Arc::new(Semaphore::new(pages as usize)),
            background_pages: Arc::new(Semaphore::new(pages.saturating_sub(1).max(1) as usize)),
            page_slots: pages,
            recent: Mutex::default(),
            live: Arc::default(),
        }
    }

    /// Acquired before a connection or a Lab request is built. Two active slots stay available to foreground
    /// brings and removal catch-up even while background peers stall. FIFO semaphore queues give admitted peers
    /// turns; a full bounded queue asks the existing retry path to try again later.
    pub(crate) async fn enter(
        &self,
        background: bool,
        catch_up: Option<&CatchUp>,
    ) -> Result<Arc<Admission>> {
        let queue = if background {
            &self.background_queue
        } else {
            &self.foreground_queue
        };
        let ticket = queue
            .clone()
            .try_acquire_owned()
            .map_err(|_| anyhow!("too many pending sync pulls"))?;
        let background = if background {
            Some(self.background.clone().acquire_owned().await?)
        } else {
            None
        };
        let active = self.active.clone().acquire_owned().await?;
        if let Some(catch_up) = catch_up {
            catch_up.admitted.fetch_add(1, Ordering::Relaxed);
        }
        Ok(Arc::new(Admission {
            _ticket: ticket,
            _background: background,
            _active: active,
        }))
    }

    /// No request buffer exists while this waits. Normal pages hold one slot, an exceptional large reply all
    /// slots. The fair semaphore stops normal traffic overtaking a queued large reply forever. The number of page
    /// waiters is bounded by admitted pulls (at most one prefetch per pull). Normal background reads leave one
    /// page slot for foreground/removal; a legitimate oversized retry must still acquire every slot.
    pub(crate) async fn page(&self, large: bool, background: bool) -> Result<Page> {
        let background = if background {
            Some(self.background_pages.clone().acquire_owned().await?)
        } else {
            None
        };
        let page = self
            .pages
            .clone()
            .acquire_many_owned(if large { self.page_slots } else { 1 })
            .await?;
        Ok(Page {
            _background: background,
            _page: page,
        })
    }

    /// Scheduling hints only, received after the peer's authenticated announcement was admitted. The caller
    /// still intersects these IDs with ordinary authorized differences before asking; a hint grants no access.
    /// Overflow remains on normal reconciliation. Existing workers coalesce up to LIVE_LOGS pending logs.
    pub(crate) fn live_announced(&self, peer: SignerId, full: bool, logs: &[LogId]) -> Option<LiveWork> {
        if full || logs.is_empty() || logs.len() > LIVE_LOGS { return None; }
        let mut book = self.live.lock().expect("live pulls");
        if let Some((_, pending)) = book.peers.get_mut(&peer) {
            for log in logs {
                if pending.len() >= LIVE_LOGS { break; }
                pending.insert(*log);
            }
            return None;
        }
        if book.peers.len() >= LIVE_PEERS { return None; }
        book.next = book.next.wrapping_add(1);
        let sequence = book.next;
        book.peers.insert(peer, (sequence, logs.iter().copied().collect()));
        Some(LiveWork { book: self.live.clone(), peer, sequence })
    }

    pub(crate) fn observed(&self, peer: EndpointId, elapsed: Duration, success: bool) {
        let mut recent = self.recent.lock().expect("pull estimates");
        let previous = recent
            .iter()
            .position(|(p, _)| *p == peer)
            .and_then(|i| recent.remove(i))
            .map(|(_, e)| e);
        let micros = elapsed.as_micros().min(u64::MAX as u128) as u64;
        let micros = match (previous, success) {
            (Some(e), true) => e.micros.saturating_mul(3).saturating_add(micros) / 4,
            (Some(e), false) => e.micros,
            _ => micros,
        };
        recent.push_back((
            peer,
            Estimate {
                micros,
                failed: !success,
            },
        ));
        while recent.len() > HISTORY {
            recent.pop_front();
        }
    }

    /// Live peers are ranked first by the caller, then recent successes and observed whole-bring latency. This
    /// history is a routing hint, never evidence that a peer has a complete or authorized view.
    pub(crate) fn rank(&self, peer: EndpointId) -> (bool, u64) {
        self.recent
            .lock()
            .expect("pull estimates")
            .iter()
            .find(|(p, _)| *p == peer)
            .map(|(_, e)| (e.failed, e.micros))
            .unwrap_or((false, 500_000))
    }

    pub(crate) fn hedge_after(&self, peer: EndpointId) -> Duration {
        let (_, micros) = self.rank(peer);
        Duration::from_micros(
            micros
                .saturating_mul(3)
                .saturating_div(2)
                .clamp(250_000, 2_000_000),
        )
    }
}

/// Visit every candidate with bounded fanout; unlike the foreground race, one success does not cancel peers
/// required by a removal check. A shared caller deadline may stop dispatch before all were admitted.
pub(crate) async fn each_bounded<I, F, Fut>(
    peers: impl IntoIterator<Item = I>,
    width: usize,
    mut ask: F,
) where
    F: FnMut(I) -> Fut,
    Fut: Future<Output = ()>,
{
    assert!(width > 0);
    let mut peers = peers.into_iter();
    let mut active = FuturesUnordered::new();
    for peer in peers.by_ref().take(width) {
        active.push(ask(peer));
    }
    while active.next().await.is_some() {
        if let Some(peer) = peers.next() {
            active.push(ask(peer));
        }
    }
}

/// First complete successful candidate, with at most `width` requests alive. Start one, hedge a slow candidate
/// after `delay`, and replace a failed candidate immediately. Dropping this future or finding a success cancels
/// the remaining requests in the caller's task, preserving its task-local acting identity. The caller supplies
/// one total deadline; sequential failures must not each restart it.
pub(crate) async fn hedged<I, T, F, Fut>(
    peers: impl IntoIterator<Item = I>,
    width: usize,
    delay: Duration,
    mut ask: F,
) -> Option<T>
where
    F: FnMut(I) -> Fut,
    Fut: Future<Output = Option<T>>,
{
    assert!(width > 0);
    let mut peers = peers.into_iter().peekable();
    let mut active = FuturesUnordered::new();
    let mut due = Instant::now();
    loop {
        if active.is_empty() {
            active.push(ask(peers.next()?));
            due = Instant::now() + delay;
        }
        enum Event<T> {
            Answer(Option<T>),
            Hedge,
        }
        let event = if active.len() < width && peers.peek().is_some() {
            future::or(
                async { Event::Answer(active.next().await.expect("an active request")) },
                async {
                    time::sleep(due.saturating_duration_since(Instant::now())).await;
                    Event::Hedge
                },
            )
            .await
        } else {
            Event::Answer(active.next().await.expect("an active request"))
        };
        match event {
            Event::Answer(Some(answer)) => return Some(answer),
            Event::Answer(None) | Event::Hedge => {
                if let Some(peer) = peers.next() {
                    active.push(ask(peer));
                    due = Instant::now() + delay;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn admission_bounds_waiters_and_reserves_foreground_then_recovers_on_cancellation() {
        let budget = Budget::new(2, 1, 2, 2, 2);
        let background = budget.enter(true, None).await.unwrap();
        let mut waiting = Box::pin(budget.enter(true, None));
        assert!(matches!(future::poll_once(&mut waiting).await, None));
        assert!(
            budget.enter(true, None).await.is_err(),
            "background tickets include their waiters"
        );
        let foreground = budget.enter(false, None).await.unwrap();
        assert_eq!(budget.active.available_permits(), 0);
        drop(waiting);
        drop(background);
        assert!(
            budget.enter(true, None).await.is_ok(),
            "cancelled waiters return their ticket"
        );
        drop(foreground);
        assert_eq!(budget.active.available_permits(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn removal_catch_up_fails_closed_if_any_peer_never_enters_admission() {
        let budget = Budget::new(2, 1, 2, 4, 4);
        let catch_up = CatchUp::new(12); // More candidates than foreground queue tickets.
        let attempts = each_bounded(0..12, 3, |peer| {
            let (budget, catch_up) = (&budget, &catch_up);
            async move {
                if let Ok(_admission) = budget.enter(false, Some(catch_up)).await {
                    if peer == 0 {
                        catch_up.reached();
                        return;
                    }
                    time::sleep(Duration::from_secs(20)).await;
                }
            }
        });
        assert!(
            time::timeout(Duration::from_secs(5), attempts)
                .await
                .is_err()
        );
        let readiness = catch_up.finish();
        assert!(
            readiness.reached,
            "one peer completed but other required peers were skipped or queued"
        );
        assert!(
            !readiness.admitted && !readiness.ready(),
            "neither catch-up nor removal may treat that as ready"
        );
        assert_eq!(
            budget.active.available_permits(),
            2,
            "timeout returns active admission"
        );
        assert_eq!(
            budget.foreground_queue.available_permits(),
            4,
            "timeout returns waiting tickets"
        );
        let many = CatchUp::new(12);
        each_bounded(0..12, 3, |peer| {
            let (budget, many) = (&budget, &many);
            async move {
                let _admission = budget.enter(false, Some(many)).await.unwrap();
                time::sleep(Duration::from_millis(1)).await;
                if peer == 0 {
                    many.reached();
                }
            }
        })
        .await;
        assert!(
            many.finish().ready(),
            "more healthy candidates than queue tickets still all get a turn"
        );
        let catch_up = CatchUp::new(2);
        for peer in 0..2 {
            let _admission = budget.enter(false, Some(&catch_up)).await.unwrap();
            if peer == 0 {
                catch_up.reached();
            }
        }
        assert!(
            catch_up.finish().ready(),
            "an attempted unreachable peer retains the previous behavior"
        );
    }

    #[tokio::test]
    async fn stalled_background_pages_leave_one_normal_page_for_foreground() {
        let budget = Budget::new(4, 2, 2, 4, 4);
        let background = budget.page(false, true).await.unwrap();
        let mut queued = Box::pin(budget.page(false, true));
        assert!(future::poll_once(&mut queued).await.is_none());
        let foreground = budget.page(false, false).await.unwrap();
        assert_eq!(budget.pages.available_permits(), 0);
        drop(queued);
        drop(background);
        drop(foreground);
        assert_eq!(budget.pages.available_permits(), 2);
        assert_eq!(budget.background_pages.available_permits(), 1);
    }

    #[tokio::test]
    async fn a_large_page_waits_for_all_slots_and_cannot_be_overtaken() {
        let budget = Budget::new(2, 1, 2, 2, 2);
        let first = budget.page(false, false).await.unwrap();
        let mut large = Box::pin(budget.page(true, false));
        assert!(future::poll_once(&mut large).await.is_none());
        let mut next = Box::pin(budget.page(false, false));
        assert!(future::poll_once(&mut next).await.is_none());
        drop(first);
        let large = large.await.unwrap();
        assert!(future::poll_once(&mut next).await.is_none());
        drop(large);
        drop(next.await.unwrap());
        assert_eq!(budget.pages.available_permits(), 2);
    }

    #[tokio::test]
    async fn detached_validation_keeps_its_page_admission_until_it_finishes() {
        let budget = Budget::default();
        let permit = budget.page(true, false).await.unwrap();
        let (release, wait) = std::sync::mpsc::channel();
        let (started, running) = tokio::sync::oneshot::channel();
        let (done, finished) = tokio::sync::oneshot::channel();
        let validation = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            started.send(()).unwrap();
            wait.recv().unwrap();
            drop(_permit);
            done.send(()).unwrap();
        });
        running.await.unwrap();
        validation.abort(); // A running blocking task cannot be aborted; its permit belongs to that task.
        assert_eq!(budget.pages.available_permits(), 0);
        release.send(()).unwrap();
        finished.await.unwrap();
        validation.await.unwrap();
        assert_eq!(budget.pages.available_permits(), budget.page_slots as usize);
    }

    struct Live(Arc<AtomicUsize>);
    impl Drop for Live {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn hedging_bounds_concurrency_replaces_failures_and_cancels_losers() {
        let live = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let started = Arc::new(Mutex::new(Vec::new()));
        let start = Instant::now();
        let answer = hedged(0..20, 3, Duration::from_millis(300), |peer| {
            let (live, peak, started) = (live.clone(), peak.clone(), started.clone());
            async move {
                let now = live.fetch_add(1, Ordering::SeqCst) + 1;
                let _live = Live(live);
                peak.fetch_max(now, Ordering::SeqCst);
                started.lock().unwrap().push((peer, start.elapsed()));
                match peer {
                    0 | 1 => {
                        time::sleep(Duration::from_secs(20)).await;
                        None
                    }
                    2 => None,
                    3 => {
                        time::sleep(Duration::from_millis(20)).await;
                        Some(peer)
                    }
                    _ => panic!("no unnecessary peers"),
                }
            }
        })
        .await;
        assert_eq!(answer, Some(3));
        assert_eq!(peak.load(Ordering::SeqCst), 3);
        assert_eq!(
            live.load(Ordering::SeqCst),
            0,
            "the slower requests were cancelled"
        );
        let started = started.lock().unwrap();
        assert_eq!(started[0], (0, Duration::ZERO));
        assert_eq!(started[1], (1, Duration::from_millis(300)));
        assert_eq!(
            started[2].1, started[3].1,
            "failure is replaced without another hedge wait"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_fast_success_never_starts_a_hedge_and_all_failures_end() {
        let count = AtomicUsize::new(0);
        let answer = hedged(0..10, 2, Duration::from_secs(1), |peer| {
            count.fetch_add(1, Ordering::SeqCst);
            async move { Some(peer) }
        })
        .await;
        assert_eq!((answer, count.load(Ordering::SeqCst)), (Some(0), 1));
        assert_eq!(
            hedged(0..10, 2, Duration::from_secs(1), |_| async {
                None::<usize>
            })
            .await,
            None
        );
        assert_eq!(
            hedged(0..0, 2, Duration::from_secs(1), |_| async { Some(1) }).await,
            None
        );
    }

    #[test]
    fn estimates_adapt_with_bounded_delay_and_bounded_history() {
        let budget = Budget::default();
        let peer = iroh::SecretKey::generate().public();
        assert_eq!(budget.hedge_after(peer), Duration::from_millis(750));
        budget.observed(peer, Duration::from_millis(20), true);
        assert_eq!(budget.hedge_after(peer), Duration::from_millis(250));
        budget.observed(peer, Duration::from_secs(30), false);
        assert!(budget.rank(peer).0);
        budget.observed(peer, Duration::from_secs(30), true);
        assert!(!budget.rank(peer).0);
        assert_eq!(budget.hedge_after(peer), Duration::from_secs(2));
        for _ in 0..HISTORY {
            budget.observed(iroh::SecretKey::generate().public(), Duration::ZERO, true);
        }
        assert_eq!(budget.recent.lock().unwrap().len(), HISTORY);
        assert_eq!(budget.hedge_after(peer), Duration::from_millis(750));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_saturated_node_refuses_removal_even_with_an_up_to_date_live_claim() {
        use crate::{Node, Options};
        use avendb::cast::{handbook_ready, world};
        let mut w = world();
        handbook_ready(&mut w);
        let (sender, receiver) = (w.mac_a, w.phone_a);
        let options = || Options {
            lazy: true,
            ..Options::local()
        };
        let mac = Node::spawn(w.lab.split(sender, &[], [35; 32]), sender, options())
            .await
            .unwrap();
        let phone = Node::spawn(w.lab.split(receiver, &[], [36; 32]), receiver, options())
            .await
            .unwrap();
        phone.know(mac.addr());
        mac.know(phone.addr());
        phone.shared.connection(mac.id()).await.unwrap();
        phone.shared.hear(
            sender,
            avendb::wire::Announce {
                full: true,
                logs: vec![],
                files: vec![],
            },
        );
        let queue = phone.shared.pulls.foreground_queue.clone();
        let _full = queue
            .clone()
            .acquire_many_owned(queue.available_permits() as u32)
            .await
            .unwrap();
        let refusal = phone
            .removal_waits()
            .await
            .expect("a skipped required peer prevents removal");
        assert!(refusal.contains("sync queue is busy"), "{refusal}");
        drop(_full);
        mac.shutdown().await.unwrap();
        phone.shutdown().await.unwrap();
    }

    /// A real single-page exchange whose first admission is held deliberately. This
    /// catches placing the service clock after the first reply (the old bug).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn first_page_service_time_includes_initial_admission_wait() {
        use crate::{Node, Options, Scope};
        use avendb::cast::{handbook_ready, world};
        let mut w = world();
        handbook_ready(&mut w);
        let (sender, receiver) = (w.mac_a, w.phone_a);
        let options = || Options { lazy: true, ..Options::local() };
        let mac = Node::spawn(w.lab.split(sender, &[], [135; 32]), sender, options()).await.unwrap();
        let phone = Node::spawn(w.lab.split(receiver, &[], [136; 32]), receiver, options()).await.unwrap();
        phone.know(mac.addr());
        mac.know(phone.addr());
        phone.shared.connection(mac.id()).await.unwrap();
        let budget = phone.shared.pulls.pages.clone();
        let held = budget.clone().acquire_many_owned(budget.available_permits() as u32).await.unwrap();
        let pull = phone.shared.pull(mac.id(), Scope::Logs(BTreeSet::new()), false, None);
        let release = async {
            while phone.shared.traffic.of(&sender).is_none_or(|p| p.askings == 0) {
                time::sleep(Duration::from_millis(1)).await;
            }
            time::sleep(Duration::from_millis(250)).await;
            drop(held);
        };
        let (result, ()) = time::timeout(Duration::from_secs(15), future::zip(pull, release)).await.unwrap();
        assert_eq!(result.unwrap(), 0);
        let report = phone.shared.traffic.of(&sender).unwrap();
        assert_eq!(report.pages, 1, "one empty authorized reply isolates first-page timing");
        assert!(report.wait_ms >= 200, "the first request really waited at admission: {report:?}");
        assert!(report.ms >= report.wait_ms, "service time must include the entire first request: {report:?}");
        mac.shutdown().await.unwrap();
        phone.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn a_hedged_request_keeps_the_callers_acting_identity() {
        let signer = avendb::id::SignerId::from_u64(987);
        let answer = crate::ACTING
            .scope(
                signer,
                hedged(0..3, 2, Duration::ZERO, |_| async {
                    assert_eq!(crate::acting(), Some(signer));
                    Some(1)
                }),
            )
            .await;
        assert_eq!(answer, Some(1));
        assert_eq!(crate::acting(), None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn real_large_edits_retry_exclusively_with_packed_and_legacy_peers() {
        use crate::{ALPN, Node, Options, exporter, pq_provider, session};
        use avendb::cast::{document, handbook_ready, world};
        use avendb::lab::ReplyScope;
        use avendb::sync::LogId;
        use avendb::wire::{Packed, Reply, Request, Wire};
        use iroh::endpoint::presets;
        use iroh::{Endpoint, SecretKey};
        for legacy in [false, true] {
            let mut w = world();
            let coop = handbook_ready(&mut w);
            let (sender, receiver) = (w.mac_a, w.phone_a);
            let big = w
                .lab
                .create(
                    sender,
                    coop,
                    coop,
                    "doc",
                    &[],
                    document("Big", &"x".repeat(PAGE_BYTES + 4096), sender),
                )
                .unwrap();
            let small = w
                .lab
                .create(
                    sender,
                    coop,
                    coop,
                    "doc",
                    &[],
                    document("After", "The next page", sender),
                )
                .unwrap();
            let raw = Endpoint::builder(presets::Empty)
                .secret_key(SecretKey::from_bytes(
                    &w.lab.endpoint_secret(sender).unwrap(),
                ))
                .crypto_provider(pq_provider())
                .clear_ip_transports()
                .bind_addr("127.0.0.1:0")
                .unwrap()
                .bind()
                .await
                .unwrap();
            let phone = Node::spawn(
                w.lab.split(receiver, &[], [34; 32]),
                receiver,
                Options {
                    lazy: true,
                    ..Options::local()
                },
            )
            .await
            .unwrap();
            let conn = raw.connect(phone.addr(), ALPN).await.unwrap();
            let exporter = exporter(&conn).unwrap();
            let (mut send, mut recv) = conn.open_bi().await.unwrap();
            send.write_all(&w.lab.hello(sender, &exporter, true).unwrap().to_wire())
                .await
                .unwrap();
            send.finish().unwrap();
            let hello =
                avendb::sign::Hello::from_wire(&recv.read_to_end(64 << 10).await.unwrap()).unwrap();
            assert_eq!(
                hello.verify(&exporter, false, phone.id().as_bytes()),
                Some(receiver)
            );
            // Hello FIN can arrive before the listener registers the peer. The raw
            // fixture serves only this connection and cannot accept a reverse dial.
            time::timeout(Duration::from_secs(5), async {
                while phone.shared.live(raw.id()).is_none() {
                    time::sleep(Duration::from_millis(1)).await;
                }
            }).await.expect("the listener registers the authenticated raw peer");
            let seen = Mutex::new(Vec::new());
            let serving = async {
                loop {
                    let (mut send, mut recv) = conn.accept_bi().await.unwrap();
                    let bytes = recv.read_to_end(session::MESSAGE_LIMIT).await.unwrap();
                    let (&kind, body) = bytes.split_first().unwrap();
                    if matches!(kind, session::ANNOUNCE | session::STATE) {
                        send.finish().unwrap();
                        continue;
                    }
                    if matches!(kind, session::RANGES | crate::transports::control::KIND) {
                        send.reset(session::REFUSED).unwrap();
                        continue;
                    }
                    assert_eq!(kind & !session::PACKED, session::ASK_LOGS);
                    seen.lock().unwrap().push((
                        kind,
                        body.to_vec(),
                        phone.shared.pulls.pages.available_permits(),
                    ));
                    if legacy && kind & session::PACKED != 0 {
                        send.reset(session::REFUSED).unwrap();
                        continue;
                    }
                    let request = Request::from_wire(body).unwrap();
                    let scope = ReplyScope::Logs(request.ask.haves.keys().copied().collect());
                    let (edits, _, more) = w.lab.reply_in(sender, receiver, &request, 1, &scope);
                    let reply = Reply {
                        edits,
                        blobs: vec![],
                        more,
                    };
                    let bytes = if kind & session::PACKED != 0 {
                        Packed(reply).to_wire()
                    } else {
                        reply.to_wire()
                    };
                    // An over-budget first attempt is stopped by the receiver; only the admitted retry must finish.
                    if send.write_all(&bytes).await.is_ok() {
                        let _ = send.finish();
                    }
                }
            };
            let pull = phone.shared.pull(
                raw.id(),
                crate::Scope::Logs(
                    [LogId::Entry(big), LogId::Entry(small)]
                        .into_iter()
                        .collect(),
                ),
                legacy,
                None,
            );
            let got = time::timeout(Duration::from_secs(30), future::or(pull, serving))
                .await
                .unwrap()
                .unwrap();
            assert_eq!(
                got, 2,
                "the large indivisible edit and its following page are both received"
            );
            let requests = seen.lock().unwrap();
            let retried = if legacy { 3 } else { 1 };
            assert_eq!(
                requests[0].1, requests[retried].1,
                "retry retains the exact cursor and scope"
            );
            assert!(requests[0].2 > 0, "first request uses normal admission");
            assert_eq!(requests[retried].2, 0, "large retry owns all page slots");
            assert!(
                requests.last().unwrap().2 > 0,
                "the next page cannot deadlock behind its own predecessor"
            );
            if legacy {
                assert_eq!(
                    requests.iter().map(|r| r.0).collect::<Vec<_>>(),
                    vec![
                        session::ASK_LOGS | session::PACKED,
                        session::ASK_LOGS,
                        session::ASK_LOGS | session::PACKED,
                        session::ASK_LOGS,
                        session::ASK_LOGS
                    ]
                );
                assert_eq!(
                    phone.shared.unpacked.lock().unwrap().len(),
                    1,
                    "legacy format is remembered for the next page"
                );
            } else {
                assert!(requests.iter().all(|r| r.0 & session::PACKED != 0));
                assert!(
                    phone.shared.unpacked.lock().unwrap().is_empty(),
                    "size overflow is not a packed-format failure"
                );
            }
            drop(requests);
            assert_eq!(
                phone.shared.pulls.pages.available_permits(),
                phone.shared.pulls.page_slots as usize
            );
            conn.close(session::REFUSED, b"test done");
            raw.close().await;
            phone.shutdown().await.unwrap();
        }
    }
}

#[cfg(test)]
mod live_queue_tests {
    use super::*;
    use avendb::id::EntryId;

    fn log(n: u64) -> LogId { LogId::Entry(EntryId::from_u64(n)) }

    #[test]
    fn live_hints_bound_full_inventories_peers_and_coalesced_logs() {
        // LivePriority.full_is_not_interactive / oversized_is_not_interactive / hints_are_bounded.
        let budget = Budget::default();
        let peer = SignerId::from_u64(1);
        assert!(budget.live_announced(peer, true, &[log(1)]).is_none());
        assert!(budget.live_announced(peer, false, &[]).is_none());
        assert!(budget.live_announced(peer, false, &(0..=LIVE_LOGS as u64).map(log).collect::<Vec<_>>()).is_none());
        let mut first = budget.live_announced(peer, false, &[log(1)]).unwrap();
        assert!(budget.live_announced(peer, false, &(2..=LIVE_LOGS as u64 + 1).map(log).collect::<Vec<_>>()).is_none());
        assert_eq!(first.next().unwrap().len(), LIVE_LOGS);
        let mut workers = vec![first];
        for n in 2..=LIVE_PEERS as u64 {
            workers.push(budget.live_announced(SignerId::from_u64(n), false, &[log(n)]).unwrap());
        }
        assert!(budget.live_announced(SignerId::from_u64(LIVE_PEERS as u64 + 1), false, &[log(1)]).is_none());
        drop(workers);
        assert!(budget.live.lock().unwrap().peers.is_empty(), "cancellation releases every bounded entry");
    }

    #[test]
    fn an_empty_or_cancelled_live_worker_cannot_remove_a_new_generation() {
        // LivePriority.old_worker_keeps_replacement. Empty detection and removal happen atomically.
        let budget = Budget::default();
        let peer = SignerId::from_u64(1);
        let mut old = budget.live_announced(peer, false, &[log(1)]).unwrap();
        assert_eq!(old.next().unwrap(), [log(1)].into());
        assert!(old.next().is_none());
        let mut fresh = budget.live_announced(peer, false, &[log(2)]).unwrap();
        drop(old);
        assert_eq!(fresh.next().unwrap(), [log(2)].into());
        assert!(budget.live_announced(peer, false, &[log(3)]).is_none());
        assert_eq!(fresh.next().unwrap(), [log(3)].into());
        drop(fresh);
        assert!(budget.live_announced(peer, false, &[log(4)]).is_some());
    }

    #[tokio::test]
    async fn later_live_admissions_cannot_overtake_a_queued_background_pull() {
        // LivePriority.later_arrival_cannot_overtake / queued_background_eventually_first.
        let budget = Budget::new(2, 1, 2, 4, 4);
        let first = budget.enter(false, None).await.unwrap();
        let second = budget.enter(false, None).await.unwrap();
        let mut background = Box::pin(budget.enter(true, None));
        assert!(future::poll_once(&mut background).await.is_none());
        let mut later_live = Box::pin(budget.enter(false, None));
        assert!(future::poll_once(&mut later_live).await.is_none());
        drop(first);
        assert!(future::poll_once(&mut later_live).await.is_none());
        let background = background.await.unwrap();
        drop(second);
        let live = later_live.await.unwrap();
        drop((background, live));
        assert_eq!(budget.active.available_permits(), 2);
    }
}
