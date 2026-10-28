//! Local scheduling only: bounded outgoing pulls/pages and a bounded foreground peer race. These gates never
//! grant access, change a request's scope, or change the edit/cursor protocol. Cancellation releases admission;
//! callers move the page permit into blocking validation so detached work remains charged until it ends.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{Result, anyhow};
use avendb::id::{BlobId, EditId, SignerId};
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
    /// Pages a pull asks ahead of the one it needs next (S6), apart from `pages`: taken only if free, never waited for,
    /// so asking ahead never holds another pull's page back, and bounded, as each holds a page's memory.
    ahead: Arc<Semaphore>,
    recent: Mutex<VecDeque<(EndpointId, Estimate)>>,
    live: Arc<Mutex<LiveBook>>,
    /// A background catch-up runs on for what live pulls left of their views (`live::LIVE_VIEW`): one at a time.
    pub(crate) view_behind: AtomicBool,
    /// For each log a peer's announcement hinted, whether it only repeated it (a witness, `LivePriority.lean`
    /// `inStep`), till a live pull takes it.
    witnesses: Mutex<BTreeMap<SignerId, BTreeMap<LogId, bool>>>,
    /// One asking of each peer at a time (`Budget::one_asking`).
    askings: Mutex<BTreeMap<EndpointId, Arc<tokio::sync::Mutex<()>>>>,
    /// One fetch of each McEliece key at a time (`Budget::fetching`).
    fetches: Mutex<BTreeMap<BlobId, Arc<tokio::sync::Mutex<()>>>>,
    /// The askings running now, each with the edits other pulls took meanwhile, for its next page to name loose
    /// (`Budget::taking`).
    taken: Mutex<Vec<Taken>>,
}

/// What other pulls took while an asking runs (`Budget::taking`), not yet named in its request.
pub(crate) type Taken = Arc<Taking>;

/// An asking that hears what other pulls take: of its peer, any edit; of another peer, the edits of the logs it asks
/// for (`logs`), none where it asks for all.
#[derive(Debug, Default)]
pub(crate) struct Taking {
    peer: Option<SignerId>,
    logs: Option<BTreeSet<LogId>>,
    pub(crate) ids: Mutex<Vec<EditId>>,
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
            Self::new(4, 2, 2, 8, 16, 4)
        } else {
            Self::new(8, 6, 4, 16, 48, 12)
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
        ahead: usize,
    ) -> Self {
        Self {
            active: Arc::new(Semaphore::new(active)),
            background: Arc::new(Semaphore::new(background)),
            foreground_queue: Arc::new(Semaphore::new(foreground_queue)),
            background_queue: Arc::new(Semaphore::new(background_queue)),
            pages: Arc::new(Semaphore::new(pages as usize)),
            background_pages: Arc::new(Semaphore::new(pages.saturating_sub(1).max(1) as usize)),
            page_slots: pages,
            ahead: Arc::new(Semaphore::new(ahead)),
            recent: Mutex::default(),
            live: Arc::default(),
            view_behind: AtomicBool::new(false),
            witnesses: Mutex::default(),
            askings: Mutex::default(),
            fetches: Mutex::default(),
            taken: Mutex::default(),
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

    /// The turn of an asking of `peer`, once no other asking of it runs (F12, `LivePriority.lean`'s `oneAsking`): two at
    /// once named the same holdings in their requests, so the peer sent the second all the first took again (sync_bench
    /// `bench_live`: 1,352 edits pulled for 675 new, an explicit `sync_with` beside the backlog's asking). The second
    /// names what the first took. Taken before admission, so a waiter holds no slot; a live pull takes none
    /// (`Claims::live` keeps the backlog off its logs).
    pub(crate) async fn one_asking(&self, peer: EndpointId) -> tokio::sync::OwnedMutexGuard<()> {
        let turn = {
            let mut askings = self.askings.lock().expect("askings");
            // a peer no asking holds or waits for any more is forgotten, so the book stays as small as the pulls
            askings.retain(|_, turn| Arc::strong_count(turn) > 1);
            askings.entry(peer).or_default().clone()
        };
        turn.lock_owned().await
    }

    /// The turns of fetching `keys` (smallest first, as `bring_keys` lists them), once no other fetch holds any: a live
    /// pull and the backlog brought the same two keys at once, 2 MB each time on a phone's link (`bench_live`). Taken in
    /// order, so two fetches never wait on each other.
    pub(crate) async fn fetching(&self, keys: &[BlobId]) -> Vec<tokio::sync::OwnedMutexGuard<()>> {
        let turns: Vec<_> = {
            let mut fetches = self.fetches.lock().expect("fetches");
            fetches.retain(|_, turn| Arc::strong_count(turn) > 1);
            keys.iter().map(|key| fetches.entry(*key).or_default().clone()).collect()
        };
        let mut held = Vec::with_capacity(turns.len());
        for turn in turns {
            held.push(turn.lock_owned().await);
        }
        held
    }

    /// An asking of `peer` for `logs` (all where `None`) begins: what other pulls take while it runs is added to what it
    /// returns, for each page it asks after to name loose (`LivePriority.lean` `withTaken`). A catch-up asked every page
    /// as it began, so the chat edits a live pull of the same peer brought meanwhile came again on its last page
    /// (`bench_live` phone_bulk at ten a second: 63 of its 94 edits), and so would the edits of its logs another peer
    /// brought once a stalled claim was handed over to it (`Claims::take`). It ends as the asking drops it.
    pub(crate) fn taking(&self, peer: SignerId, logs: Option<BTreeSet<LogId>>) -> Taken {
        let mine = Arc::new(Taking { peer: Some(peer), logs, ids: Mutex::default() });
        let mut taken = self.taken.lock().expect("taken");
        taken.retain(|a| Arc::strong_count(a) > 1);
        taken.push(mine.clone());
        mine
    }

    /// A page of `peer`'s that the asking `by` took brought `ids`, each of its log, which this device holds now: told to
    /// every other asking of `peer`, and to every asking of another peer for the log, as no peer need send them again.
    pub(crate) fn took(&self, peer: SignerId, by: &Taken, ids: &[(EditId, Option<LogId>)]) {
        if ids.is_empty() {
            return;
        }
        let taken = self.taken.lock().expect("taken");
        for other in taken.iter().filter(|a| !Arc::ptr_eq(a, by)) {
            let hears = |log: &Option<LogId>| {
                other.peer == Some(peer) || other.logs.as_ref().is_some_and(|ls| log.is_some_and(|l| ls.contains(&l)))
            };
            let heard = ids.iter().filter(|(_, log)| hears(log)).map(|(id, _)| *id);
            other.ids.lock().expect("taken").extend(heard);
        }
    }

    /// A page asked ahead (S6), if a slot is free now: `None` rather than waiting, so a pull that finds none asks on
    /// one page at a time, as it did. Carried into validation as any page's admission is.
    pub(crate) fn ahead(&self) -> Option<Page> {
        let page = self.ahead.clone().try_acquire_owned().ok()?;
        Some(Page { _background: None, _page: page })
    }

    /// Scheduling hints only, received after the peer's authenticated announcement was admitted. The caller
    /// still intersects these IDs with ordinary authorized differences before asking; a hint grants no access.
    /// Overflow remains on normal reconciliation. Existing workers coalesce up to LIVE_LOGS pending logs.
    /// Notes which logs `peer`'s hint repeated unchanged (witnesses) and which it changed, till a live pull takes them:
    /// a log changed by any hint coalesced into the pull is no witness. A book grown past a few pulls' worth (hints no
    /// pull took) starts again.
    pub(crate) fn note_witnesses(&self, peer: SignerId, hinted: Vec<(LogId, bool)>) {
        let mut book = self.witnesses.lock().expect("live witnesses");
        let of = book.entry(peer).or_default();
        if of.len() > 4 * LIVE_LOGS {
            of.clear();
        }
        for (log, unchanged) in hinted {
            if unchanged {
                of.entry(log).or_insert(true);
            } else {
                of.insert(log, false);
            }
        }
        if of.is_empty() {
            book.remove(&peer);
        }
    }

    /// The witnesses among `logs` for `peer`, each log taken out of the book.
    pub(crate) fn take_witnesses(&self, peer: SignerId, logs: &BTreeSet<LogId>) -> BTreeSet<LogId> {
        let mut book = self.witnesses.lock().expect("live witnesses");
        let Some(of) = book.get_mut(&peer) else { return BTreeSet::new() };
        let taken = logs.iter().filter(|l| of.remove(*l) == Some(true)).copied().collect();
        if of.is_empty() {
            book.remove(&peer);
        }
        taken
    }

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

/// The fewest pages a pull keeps in flight once its peer tells it where they end (`session::CUTS`): the one it takes
/// and the next.
pub(crate) const WINDOW_MIN: usize = 2;
/// The most, unless `Options::window` says fewer: eight 4-MiB pages cover a 5 s round trip at about 50 Mbit/s.
pub(crate) const WINDOW: usize = 8;

/// How many pages a pull keeps in flight (S6): the link's bandwidth × round trip in pages, plus the one being sent,
/// within `WINDOW_MIN..=most`. The round trip is the quickest a `CUTS` answer took (a few hundred bytes, so the link's
/// latency and the peer's turnaround alone); a page's time to send is what a page took beyond it, shared among the
/// pages in flight with it. Local scheduling only: it never changes what a page asks for, nor the order pages are taken.
#[derive(Clone, Debug)]
pub(crate) struct Window {
    most: usize,
    latency: Option<Duration>,
    /// The last pages' (wait, pages in flight when it was asked), the newest last.
    pages: VecDeque<(Duration, usize)>,
}

/// The pages a `Window` reads a page's time to send from: the quickest of them, as the link's bandwidth is the most it
/// carried, so a page that stalled behind something else doesn't close the window.
const WINDOW_SAMPLES: usize = 8;

impl Window {
    pub(crate) fn new(most: usize) -> Window {
        Window { most: most.max(1), latency: None, pages: VecDeque::new() }
    }

    /// A `CUTS` answer that took `wait`.
    pub(crate) fn latency(&mut self, wait: Duration) {
        self.latency = Some(self.latency.map_or(wait, |l| l.min(wait)));
    }

    /// A page that took `wait` from asked to read whole, asked while `flying` pages (itself among them) were in flight.
    pub(crate) fn page(&mut self, wait: Duration, flying: usize) {
        if self.pages.len() == WINDOW_SAMPLES {
            self.pages.pop_front();
        }
        self.pages.push_back((wait, flying.max(1)));
    }

    /// The pages to keep in flight now.
    pub(crate) fn size(&self) -> usize {
        if self.most < WINDOW_MIN {
            return self.most;
        }
        let Some(latency) = self.latency else { return WINDOW_MIN };
        let sending = self.pages.iter().map(|&(wait, flying)| wait.saturating_sub(latency) / flying as u32).min();
        let Some(sending) = sending else { return WINDOW_MIN };
        let sending = sending.max(Duration::from_millis(1));
        let pages = latency.as_micros().div_ceil(sending.as_micros()) as usize + 1;
        pages.clamp(WINDOW_MIN, self.most)
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
        let budget = Budget::new(2, 1, 2, 2, 2, 0);
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
        let budget = Budget::new(2, 1, 2, 4, 4, 0);
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
        let budget = Budget::new(4, 2, 2, 4, 4, 0);
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
        let budget = Budget::new(2, 1, 2, 2, 2, 0);
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
                    // a peer from before S6 refuses page cuts too: the pull asks page after page
                    if matches!(kind, session::RANGES | session::CUTS | crate::transports::control::KIND | crate::blind::OFFER) {
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
    fn what_one_pull_takes_the_askings_of_its_peer_and_of_its_logs_name_loose() {
        // LivePriority.taken_not_sent_again: the catch-up's next page names what the live pull took; an asking of
        // another peer for the same log names it too (the_stalled_asking_sends_none_of_it_again), one for other logs or
        // for all hears nothing; the live pull isn't told of its own page, and an asking that ended is told no more
        let budget = Budget::default();
        let (peer, other) = (SignerId::from_u64(1), SignerId::from_u64(2));
        let (catch_up, live) = (budget.taking(peer, None), budget.taking(peer, Some([log(1)].into())));
        let (same_log, other_log, all) =
            (budget.taking(other, Some([log(1)].into())), budget.taking(other, Some([log(2)].into())), budget.taking(other, None));
        let ids = [(EditId([7; 32]), Some(log(1))), (EditId([8; 32]), Some(log(1)))];
        let just = |ids: &[(EditId, Option<LogId>)]| ids.iter().map(|(id, _)| *id).collect::<Vec<_>>();
        budget.took(peer, &live, &ids);
        assert_eq!(*catch_up.ids.lock().unwrap(), just(&ids));
        assert_eq!(*same_log.ids.lock().unwrap(), just(&ids));
        assert!(live.ids.lock().unwrap().is_empty() && other_log.ids.lock().unwrap().is_empty());
        assert!(all.ids.lock().unwrap().is_empty());
        drop(catch_up);
        let later = budget.taking(peer, None);
        budget.took(peer, &live, &ids[..1]);
        assert_eq!(*later.ids.lock().unwrap(), just(&ids[..1]));
        assert_eq!(budget.taken.lock().unwrap().len(), 5, "the asking that ended is gone");
    }

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
        let budget = Budget::new(2, 1, 2, 4, 4, 0);
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

#[cfg(test)]
mod pipelined_tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn the_window_is_bandwidth_times_round_trip_in_pages_within_its_bounds() {
        // nothing measured yet: the one it takes and the next
        assert_eq!(Window::new(WINDOW).size(), WINDOW_MIN);
        // a window of one asks page after page, measured or not
        let mut one = Window::new(1);
        one.latency(Duration::from_secs(5));
        one.page(Duration::from_secs(5), 1);
        assert_eq!(one.size(), 1);
        // a 5 s round trip, pages that take 5.01 s: latency-bound, as many as allowed
        let mut slow = Window::new(WINDOW);
        slow.latency(Duration::from_secs(5));
        slow.page(Duration::from_millis(5_010), 1);
        assert_eq!(slow.size(), WINDOW);
        // a 4.5 s round trip and a 4-MiB page sending in 6.4 s (5 Mbit/s): two in flight fill the link
        let mut thin = Window::new(WINDOW);
        thin.latency(Duration::from_millis(4_500));
        thin.page(Duration::from_millis(10_900), 1);
        assert_eq!(thin.size(), 2);
        // 1 s to send a page under a 3 s round trip: three to cover the trip, and the one being sent
        let mut mid = Window::new(WINDOW);
        mid.latency(Duration::from_secs(3));
        mid.page(Duration::from_secs(4), 1);
        assert_eq!(mid.size(), 4);
        // a page that queued behind three others shares its wait among them; one stall doesn't close the window
        mid.page(Duration::from_secs(7), 4);
        mid.page(Duration::from_secs(60), 1);
        assert_eq!(mid.size(), 4);
        // a fast local link: the least
        let mut lan = Window::new(WINDOW);
        lan.latency(Duration::from_micros(300));
        lan.page(Duration::from_millis(40), 1);
        assert_eq!(lan.size(), WINDOW_MIN);
    }

    #[test]
    fn cuts_name_exactly_the_pages_a_peer_answers_one_after_the_other() {
        use avendb::cast::{document, handbook_ready, world};
        use avendb::lab::ReplyScope;
        use avendb::sync::LogId;
        let mut w = world();
        let coop = handbook_ready(&mut w);
        let (sender, receiver) = (w.mac_a, w.phone_a);
        let logs: BTreeSet<LogId> = (0..9)
            .map(|i| {
                let body = "x".repeat(3_000 * (i % 3 + 1));
                LogId::Entry(w.lab.create(sender, coop, coop, "doc", &[], document(&format!("D{i}"), &body, sender)).unwrap())
            })
            .collect();
        let scope = ReplyScope::Logs(logs.clone());
        let base = crate::session::only(&w.lab, receiver, w.lab.request(receiver, sender), &logs);
        for page in [1, 10_000, 20_000, 1 << 30] {
            // the pages asked one after the other, each after the last place the one before brought
            let (mut ends, mut after) = (Vec::new(), None);
            loop {
                let request = avendb::wire::Request { after, ..base.clone() };
                let (edits, _, more) = w.lab.reply_in(sender, receiver, &request, page, &scope);
                let Some(last) = edits.iter().map(|s| avendb::sync::place(&s.edit)).max() else { break };
                ends.push(last);
                if !more {
                    break;
                }
                after = Some(last);
            }
            assert!(!ends.is_empty());
            // the cuts, asked a few at a time from wherever the last cuts ended
            let (mut cuts, mut after) = (Vec::new(), None);
            loop {
                let request = avendb::wire::Request { after, ..base.clone() };
                let (got, done) = w.lab.reply_cuts(sender, receiver, &request, page, &scope, 3);
                cuts.extend(got.iter().copied());
                if done {
                    break;
                }
                after = got.last().copied();
                assert!(after.is_some(), "cuts that aren't done name one at least");
            }
            assert_eq!(cuts, ends, "page size {page}");
        }
    }

    /// S6: a pull over a link where every exchange takes `RTT` keeps its pages in flight. Asked one after the other, the
    /// last of `PAGES` pages is asked `PAGES - 1` round trips after the first; asked at the peer's cuts, ceil((PAGES - 1)
    /// / W) round trips after it. Timed where the peer is asked, as that is what the window decides: taking the pages
    /// (signature checks, the Lab) is the device's own work, overlapped with the next round trip one page at a time
    /// and back to back once pages come together, so a pull's whole time on a machine whose cores other tests hold says
    /// how busy the machine was (#1326 CI: 10.8 s with seven pages in flight, 0.8 s on an idle machine).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_pull_over_a_slow_link_keeps_its_pages_in_flight() {
        use crate::{ALPN, Node, Options, exporter, pq_provider, session};
        use avendb::cast::{document, handbook_ready, world};
        use avendb::lab::ReplyScope;
        use avendb::sync::LogId;
        use avendb::wire::{Reply, Request, Wire};
        use iroh::endpoint::presets;
        use iroh::{Endpoint, SecretKey};
        const PAGES: usize = 8;
        const RTT: Duration = Duration::from_millis(400);
        let mut measured = Vec::new();
        for (round, window) in [1usize, WINDOW].into_iter().enumerate() {
            let mut w = world();
            let coop = handbook_ready(&mut w);
            let (sender, receiver) = (w.mac_a, w.phone_a);
            let logs: BTreeSet<LogId> = (0..PAGES)
                .map(|i| LogId::Entry(w.lab.create(sender, coop, coop, "doc", &[], document(&format!("D{i}"), "a page", sender)).unwrap()))
                .collect();
            let raw = Endpoint::builder(presets::Empty)
                .secret_key(SecretKey::from_bytes(&w.lab.endpoint_secret(sender).unwrap()))
                .crypto_provider(pq_provider())
                .clear_ip_transports()
                .bind_addr("127.0.0.1:0")
                .unwrap()
                .bind()
                .await
                .unwrap();
            let seed = [60 + round as u8; 32];
            let options = Options { lazy: true, window, ..Options::local() };
            let phone = Node::spawn(w.lab.split(receiver, &[], seed), receiver, options).await.unwrap();
            let conn = raw.connect(phone.addr(), ALPN).await.unwrap();
            let exporter = exporter(&conn).unwrap();
            let (mut send, mut recv) = conn.open_bi().await.unwrap();
            send.write_all(&w.lab.hello(sender, &exporter, true).unwrap().to_wire()).await.unwrap();
            send.finish().unwrap();
            let hello = avendb::sign::Hello::from_wire(&recv.read_to_end(64 << 10).await.unwrap()).unwrap();
            assert_eq!(hello.verify(&exporter, false, phone.id().as_bytes()), Some(receiver));
            time::timeout(Duration::from_secs(5), async {
                while phone.shared.live(raw.id()).is_none() {
                    time::sleep(Duration::from_millis(1)).await;
                }
            })
            .await
            .unwrap();
            // the peer: answers each message at once, and lets its answer arrive a round trip after it was asked;
            // one edit to a page, so the pull takes PAGES pages
            let (in_flight, most_in_flight) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
            // what the peer was asked and when, for a failure to show where the time went
            let (timeline, start) = (Mutex::new(Vec::<String>::new()), Instant::now());
            // when the peer was asked each page
            let asks = Mutex::new(Vec::<Duration>::new());
            let at = |what: String| timeline.lock().unwrap().push(format!("{:>6}ms {what}", start.elapsed().as_millis()));
            let serving = async {
                let mut answering = FuturesUnordered::new();
                loop {
                    let accepted = future::or(async { Some(conn.accept_bi().await.unwrap()) }, async {
                        match answering.next().await {
                            Some(()) => None,
                            None => future::pending().await,
                        }
                    });
                    let Some((mut send, mut recv)) = accepted.await else { continue };
                    let bytes = recv.read_to_end(session::MESSAGE_LIMIT).await.unwrap();
                    let (&kind, body) = bytes.split_first().unwrap();
                    let cursor = |body: &[u8]| match Request::from_wire(body) {
                        Ok(r) => format!("{:?}", r.after.map(|(depth, id)| (depth, id.to_hex()[..6].to_string()))),
                        Err(_) => "?".into(),
                    };
                    match kind {
                        session::CUTS => at(format!("CUTS x{} after {}", body[1], cursor(&body[2..]))),
                        k if k & !session::PACKED == session::ASK_LOGS => at(format!("ASK_LOGS {k:#x} after {}", cursor(body))),
                        k => at(format!("kind {k}")),
                    }
                    let answer = match kind {
                        session::ANNOUNCE | session::STATE => Some(Vec::new()),
                        session::CUTS => {
                            let (inner, count, body) = (body[0], body[1] as usize, &body[2..]);
                            assert_eq!(inner, session::ASK_LOGS);
                            let request = Request::from_wire(body).unwrap();
                            let scope = ReplyScope::Logs(request.ask.haves.keys().copied().collect());
                            let (cuts, done) = w.lab.reply_cuts(sender, receiver, &request, 1, &scope, count);
                            Some(session::cuts_wire(&cuts, done))
                        }
                        k if k & !session::PACKED == session::ASK_LOGS && k & session::PACKED == 0 => {
                            let request = Request::from_wire(body).unwrap();
                            let scope = ReplyScope::Logs(request.ask.haves.keys().copied().collect());
                            let (edits, _, more) = w.lab.reply_in(sender, receiver, &request, 1, &scope);
                            asks.lock().unwrap().push(start.elapsed());
                            let now = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                            most_in_flight.fetch_max(now, Ordering::SeqCst);
                            Some(Reply { edits, blobs: vec![], more }.to_wire())
                        }
                        // packed replies, ranges and the rest: refused, as a peer that doesn't know them refuses
                        _ => None,
                    };
                    let in_flight = in_flight.clone();
                    answering.push(async move {
                        match answer {
                            Some(answer) => {
                                time::sleep(RTT).await;
                                if kind & !session::PACKED == session::ASK_LOGS {
                                    in_flight.fetch_sub(1, Ordering::SeqCst);
                                }
                                if send.write_all(&answer).await.is_ok() {
                                    let _ = send.finish();
                                }
                            }
                            None => {
                                let _ = send.reset(session::REFUSED);
                            }
                        }
                    });
                }
            };
            // the refused packed request costs no round trip (an immediate reset), so each page is one
            let began = Instant::now();
            let pull = phone.shared.pull(raw.id(), crate::Scope::Logs(logs.clone()), false, None);
            let got = time::timeout(Duration::from_secs(60), future::or(pull, serving)).await.unwrap().unwrap();
            let took = began.elapsed();
            assert_eq!(got, PAGES, "every page's edit is taken, whatever the window");
            let held = phone.read(move |lab, me| logs.iter().all(|l| lab.log(me).logs().contains(&Some(*l)))).await;
            assert!(held, "the edits are the device's, checked and kept");
            let report = phone.shared.traffic.of(&sender).unwrap();
            assert_eq!(report.pages as usize, PAGES);
            let asks = asks.into_inner().unwrap();
            assert_eq!(asks.len(), PAGES, "each page asked once, none dropped and asked again");
            let span = asks[PAGES - 1] - asks[0];
            measured.push((window, took, most_in_flight.load(Ordering::SeqCst), span));
            eprintln!("S6 window {window}: the peer was asked\n{}\nthe phone's pages: {}\n{:?}",
                timeline.lock().unwrap().join("\n"), report.to_json(), phone.shared.traffic.recent());
            assert_eq!(
                phone.shared.pulls.ahead.available_permits(),
                Budget::default().ahead.available_permits(),
                "every page asked ahead gave its slot back"
            );
            conn.close(session::REFUSED, b"test done");
            raw.close().await;
            phone.shutdown().await.unwrap();
        }
        eprintln!("S6 pipelined pages over a {RTT:?} round trip, {PAGES} pages: {measured:?}");
        let (before, after) = (measured[0], measured[1]);
        assert_eq!(before.2, 1, "page after page: one in flight at a time");
        assert!(before.3 >= RTT * (PAGES - 1) as u32, "page after page: each asked a round trip after the last: {before:?}");
        assert!(before.1 >= RTT * PAGES as u32, "page after page takes a round trip a page: {before:?}");
        assert!(after.2 > 1, "asked ahead, pages are in flight together: {after:?}");
        // the first page with its cuts, then the rest W at a time: the last asked ceil((PAGES - 1) / W) round trips on
        let rounds = (PAGES - 1).div_ceil(WINDOW) as u32;
        assert!(after.3 < RTT * (rounds + 1), "pipelined: the last page asked ~ceil(pages / W) round trips on: {after:?}");
    }

    /// A raw peer at `raw`, as device `sender` of `lab`, says its hello to `phone` and waits until the phone knows it.
    async fn greet(raw: &iroh::Endpoint, phone: &crate::Node, lab: &mut avendb::lab::Lab, sender: avendb::id::SignerId) -> iroh::endpoint::Connection {
        use avendb::wire::Wire;
        let conn = raw.connect(phone.addr(), crate::ALPN).await.unwrap();
        let exporter = crate::exporter(&conn).unwrap();
        let (mut send, mut recv) = conn.open_bi().await.unwrap();
        send.write_all(&lab.hello(sender, &exporter, true).unwrap().to_wire()).await.unwrap();
        send.finish().unwrap();
        avendb::sign::Hello::from_wire(&recv.read_to_end(64 << 10).await.unwrap()).unwrap();
        time::timeout(Duration::from_secs(5), async {
            while phone.shared.live(raw.id()).is_none() || phone.shared.live(raw.id()).is_some_and(|p| p.conn.stable_id() != conn.stable_id() && p.conn.close_reason().is_some()) {
                time::sleep(Duration::from_millis(1)).await;
            }
        })
        .await
        .unwrap();
        conn
    }

    /// The peer of `greet`: each page of one edit and the cuts, each answered a round trip `rtt` after it was asked;
    /// it closes the connection once it was asked `close_at` pages, if any. The pages it was asked.
    async fn serve_slow(
        conn: &iroh::endpoint::Connection,
        lab: &mut avendb::lab::Lab,
        sender: avendb::id::SignerId,
        receiver: avendb::id::SignerId,
        rtt: Duration,
        close_at: Option<usize>,
        asked: &AtomicUsize,
    ) {
        use crate::session;
        use avendb::lab::ReplyScope;
        use avendb::wire::{Reply, Request, Wire};
        enum Next<S> {
            Stream(Option<S>),
            Answered,
        }
        let mut answering = FuturesUnordered::new();
        loop {
            let next = future::or(async { Next::Stream(conn.accept_bi().await.ok()) }, async {
                match answering.next().await {
                    Some(()) => Next::Answered,
                    None => future::pending().await,
                }
            });
            let (mut send, mut recv) = match next.await {
                Next::Answered => continue,
                Next::Stream(Some(stream)) => stream,
                Next::Stream(None) => return,
            };
            let Ok(bytes) = recv.read_to_end(session::MESSAGE_LIMIT).await else { return };
            let (&kind, body) = bytes.split_first().unwrap();
            let answer = match kind {
                session::ANNOUNCE | session::STATE => Some(Vec::new()),
                session::CUTS => {
                    let request = Request::from_wire(&body[2..]).unwrap();
                    let scope = ReplyScope::Logs(request.ask.haves.keys().copied().collect());
                    let (cuts, done) = lab.reply_cuts(sender, receiver, &request, 1, &scope, body[1] as usize);
                    Some(session::cuts_wire(&cuts, done))
                }
                session::ASK_LOGS => {
                    if close_at.is_some_and(|n| asked.load(Ordering::SeqCst) >= n) {
                        // the route goes away under the pages in flight, as a closed WebTransport session does
                        conn.close(session::REFUSED, b"route gone");
                        return;
                    }
                    asked.fetch_add(1, Ordering::SeqCst);
                    let request = Request::from_wire(body).unwrap();
                    let scope = ReplyScope::Logs(request.ask.haves.keys().copied().collect());
                    let (edits, _, more) = lab.reply_in(sender, receiver, &request, 1, &scope);
                    Some(Reply { edits, blobs: vec![], more }.to_wire())
                }
                _ => None,
            };
            answering.push(async move {
                match answer {
                    Some(answer) => {
                        time::sleep(rtt).await;
                        if send.write_all(&answer).await.is_ok() {
                            let _ = send.finish();
                        }
                    }
                    None => {
                        let _ = send.reset(session::REFUSED);
                    }
                }
            });
        }
    }

    /// A pipelined pull whose connection closes under its pages in flight ends at once, with an error, and gives back
    /// every slot it held (its admission, its page slots, the slots of the pages it asked ahead); the next pull, on the
    /// connection that replaces it, brings every page. (#1328: after a WebTransport route closed, nothing more was sent.)
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_pull_whose_route_closes_under_its_pages_ends_and_frees_them_for_the_next() {
        use crate::{Node, Options, pq_provider};
        use avendb::cast::{document, handbook_ready, world};
        use avendb::sync::LogId;
        use iroh::endpoint::presets;
        use iroh::{Endpoint, SecretKey};
        const PAGES: usize = 8;
        const RTT: Duration = Duration::from_millis(300);
        let mut w = world();
        let coop = handbook_ready(&mut w);
        let (sender, receiver) = (w.mac_a, w.phone_a);
        let logs: BTreeSet<LogId> = (0..PAGES)
            .map(|i| LogId::Entry(w.lab.create(sender, coop, coop, "doc", &[], document(&format!("D{i}"), "a page", sender)).unwrap()))
            .collect();
        let raw = Endpoint::builder(presets::Empty)
            .secret_key(SecretKey::from_bytes(&w.lab.endpoint_secret(sender).unwrap()))
            .crypto_provider(pq_provider())
            .clear_ip_transports()
            .bind_addr("127.0.0.1:0")
            .unwrap()
            .bind()
            .await
            .unwrap();
        let phone = Node::spawn(w.lab.split(receiver, &[], [77; 32]), receiver, Options { lazy: true, ..Options::local() }).await.unwrap();
        let fresh = Budget::default();
        let slots = |b: &Budget| (b.active.available_permits(), b.pages.available_permits(), b.ahead.available_permits());
        // the route closes once three pages were asked: the cuts are in, and pages are in flight ahead
        let conn = greet(&raw, &phone, &mut w.lab, sender).await;
        let asked = AtomicUsize::new(0);
        let pull = phone.shared.pull(raw.id(), crate::Scope::Logs(logs.clone()), false, None);
        let serving = async {
            serve_slow(&conn, &mut w.lab, sender, receiver, RTT, Some(3), &asked).await;
            future::pending::<()>().await;
        };
        // it ends by its connection's loss, not by a page's wait running out (`PAGE_WAIT`, "no page in time"): the
        // cause, not a wall clock a loaded machine misses (10.3 s once, batch 5); the timeout only stops a hang. The
        // close's reason, "route gone", is in the error whichever call met the closed connection first: a page read
        // under way ("connection lost: closed by peer: …") or the next page's stream ("closed by peer: …", seen under
        // a loaded machine, batch 5 CI)
        let ended = time::timeout(crate::PAGE_WAIT / 6, future::or(async { Some(pull.await) }, async { serving.await; None }))
            .await
            .expect("the pull ends once its connection is gone")
            .expect("the pull, not the peer, ends");
        let why = format!("{:#}", ended.as_ref().expect_err("a pull whose connection closed under it fails"));
        assert!(why.contains("route gone") && !why.contains("no page in time"), "it ends by the route's loss: {why}");
        // its slots come back as its futures drop, the blocking checks of its pages included
        time::timeout(Duration::from_secs(30), async {
            while slots(&phone.shared.pulls) != slots(&fresh) {
                time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("every slot is given back: {:?} of {:?}", slots(&phone.shared.pulls), slots(&fresh)));
        // the route comes back: the next pull, on the new connection, brings what the first didn't
        let conn = greet(&raw, &phone, &mut w.lab, sender).await;
        let asked = AtomicUsize::new(0);
        let pull = phone.shared.pull(raw.id(), crate::Scope::Logs(logs.clone()), false, None);
        let serving = async {
            serve_slow(&conn, &mut w.lab, sender, receiver, RTT, None, &asked).await;
            future::pending::<()>().await;
        };
        let got = time::timeout(Duration::from_secs(20), future::or(async { Some(pull.await) }, async { serving.await; None }))
            .await
            .expect("the next pull ends")
            .expect("the pull, not the peer, ends")
            .unwrap();
        let held = phone.read(move |lab, me| logs.iter().all(|l| lab.log(me).logs().contains(&Some(*l)))).await;
        assert!(held, "after the route came back, every page's edit is the device's ({got} new on the second pull)");
        assert_eq!(slots(&phone.shared.pulls), slots(&fresh), "and the second pull gave its slots back too");
        conn.close(crate::session::REFUSED, b"test done");
        raw.close().await;
        phone.shutdown().await.unwrap();
    }
}
