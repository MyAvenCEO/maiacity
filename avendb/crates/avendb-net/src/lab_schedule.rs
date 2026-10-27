//! Fair local Lab admission. Foreground may overtake queued background work, but
//! after three foreground grants one waiting background operation gets a turn.
//! A granted ticket moves into the real blocking closure, so cancellation cannot
//! release capacity while that closure still runs. This cannot preempt one operation.
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore, oneshot};

// Tests acknowledge the actual queued registration, not the number of unrelated
// Node background tasks. This hook is absent from production builds.
#[cfg(test)]
tokio::task_local! {
    static REGISTERED: std::cell::RefCell<Option<oneshot::Sender<()>>>;
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Class {
    Foreground,
    Background,
}
struct Waiting {
    id: u64,
    send: oneshot::Sender<Turn>,
    slot: OwnedSemaphorePermit,
}
#[derive(Default)]
struct State {
    active: bool,
    next: u64,
    burst: usize,
    foreground: VecDeque<Waiting>,
    background: VecDeque<Waiting>,
}
pub(crate) struct Schedule {
    state: Mutex<State>,
    foreground: Arc<Semaphore>,
    background: Arc<Semaphore>,
}
impl Default for Schedule {
    fn default() -> Self {
        Self {
            state: Mutex::default(),
            foreground: Arc::new(Semaphore::new(32)),
            background: Arc::new(Semaphore::new(16)),
        }
    }
}
pub(crate) struct Turn {
    schedule: Arc<Schedule>,
    _slot: OwnedSemaphorePermit,
}
impl Drop for Turn {
    fn drop(&mut self) {
        self.schedule.release();
    }
}
struct Registration {
    schedule: Arc<Schedule>,
    id: u64,
}
impl Drop for Registration {
    fn drop(&mut self) {
        let mut s = self.schedule.state.lock().expect("Lab schedule");
        s.foreground.retain(|w| w.id != self.id);
        s.background.retain(|w| w.id != self.id);
    }
}
impl Schedule {
    pub(crate) async fn acquire(self: &Arc<Self>, class: Class) -> Turn {
        let slots = match class {
            Class::Foreground => &self.foreground,
            Class::Background => &self.background,
        };
        let slot = slots
            .clone()
            .acquire_owned()
            .await
            .expect("Lab queue never closes");
        let (send, receive) = oneshot::channel();
        let registration = {
            let mut s = self.state.lock().expect("Lab schedule");
            if !s.active {
                s.active = true;
                s.burst = usize::from(class == Class::Foreground);
                return Turn {
                    schedule: self.clone(),
                    _slot: slot,
                };
            }
            let id = s.next;
            s.next = s.next.wrapping_add(1);
            let queue = match class {
                Class::Foreground => &mut s.foreground,
                Class::Background => &mut s.background,
            };
            queue.push_back(Waiting { id, send, slot });
            Registration {
                schedule: self.clone(),
                id,
            }
        };
        #[cfg(test)]
        let _ = REGISTERED.try_with(|notice| {
            if let Some(send) = notice.borrow_mut().take() { let _ = send.send(()); }
        });
        let turn = receive.await.expect("queued Lab turn retains sender");
        drop(registration);
        turn
    }
    fn release(self: &Arc<Self>) {
        let next = {
            let mut s = self.state.lock().expect("Lab schedule");
            let next = if !s.foreground.is_empty() && (s.background.is_empty() || s.burst < 3) {
                s.burst = s.burst.saturating_add(1);
                s.foreground.pop_front()
            } else if !s.background.is_empty() {
                s.burst = 0;
                s.background.pop_front()
            } else {
                None
            };
            if next.is_none() {
                s.active = false;
            }
            next
        };
        if let Some(waiting) = next {
            // Never drop an unclaimed active turn under the state lock: its Drop
            // hands service to the next waiter, including cancellation races.
            let turn = Turn {
                schedule: self.clone(),
                _slot: waiting.slot,
            };
            if let Err(turn) = waiting.send.send(turn) {
                drop(turn);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use n0_future::future::poll_once;
    #[tokio::test]
    async fn foreground_overtakes_but_background_is_not_starved() {
        let schedule = Arc::new(Schedule::default());
        let active = schedule.acquire(Class::Background).await;
        let mut background = Box::pin(schedule.acquire(Class::Background));
        assert!(poll_once(&mut background).await.is_none());
        let mut readers: Vec<_> = (0..4)
            .map(|_| Box::pin(schedule.acquire(Class::Foreground)))
            .collect();
        for r in &mut readers {
            assert!(poll_once(r).await.is_none());
        }
        drop(active);
        for r in readers.iter_mut().take(3) {
            let turn = poll_once(r).await.expect("foreground served");
            assert!(poll_once(&mut background).await.is_none());
            drop(turn);
        }
        let history = poll_once(&mut background)
            .await
            .expect("background after three foreground operations");
        assert!(poll_once(&mut readers[3]).await.is_none());
        drop(history);
        assert!(poll_once(&mut readers[3]).await.is_some());
    }
    #[tokio::test]
    async fn registration_acknowledges_this_waiter_with_unrelated_work_queued() {
        let schedule = Arc::new(Schedule::default());
        let active = schedule.acquire(Class::Background).await;
        let mut unrelated = Box::pin(schedule.acquire(Class::Background));
        assert!(poll_once(&mut unrelated).await.is_none());
        let (notice, registered) = oneshot::channel();
        let mut tracked = Box::pin(REGISTERED.scope(
            std::cell::RefCell::new(Some(notice)), schedule.acquire(Class::Foreground)));
        assert!(poll_once(&mut tracked).await.is_none());
        registered.await.expect("actual tracked registration acknowledged");
        assert_eq!(schedule.state.lock().unwrap().background.len(), 1);
        assert_eq!(schedule.state.lock().unwrap().foreground.len(), 1);
        drop(active);
        let first = poll_once(&mut tracked).await.expect("tracked foreground goes first");
        assert!(poll_once(&mut unrelated).await.is_none());
        drop(first);
        assert!(poll_once(&mut unrelated).await.is_some());
    }

    #[tokio::test]
    async fn cancelled_queue_and_unclaimed_grant_release_capacity() {
        let schedule = Arc::new(Schedule::default());
        let active = schedule.acquire(Class::Background).await;
        for _ in 0..1000 {
            let mut cancelled = Box::pin(schedule.acquire(Class::Background));
            assert!(poll_once(&mut cancelled).await.is_none());
            assert_eq!(schedule.state.lock().unwrap().background.len(), 1);
            drop(cancelled);
            // Reset Tokio's cooperative budget so the next semaphore acquisition
            // really queues; a Pending caused by budget exhaustion is not admission.
            tokio::task::yield_now().await;
        }
        assert!(schedule.state.lock().unwrap().background.is_empty());
        let mut cancelled = Box::pin(schedule.acquire(Class::Foreground));
        let mut next = Box::pin(schedule.acquire(Class::Background));
        assert!(poll_once(&mut cancelled).await.is_none());
        assert!(poll_once(&mut next).await.is_none());
        drop(active);
        drop(cancelled);
        assert!(poll_once(&mut next).await.is_some());
        assert_eq!(schedule.foreground.available_permits(), 32);
        assert_eq!(schedule.background.available_permits(), 16);
    }
}

#[cfg(test)]
mod integration {
    use super::*;
    use crate::{Node, Options};
    use avendb::cast::{document, handbook_ready, world};
    use n0_future::time::{self, Duration};
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn reads_and_mutations_run_ahead_of_queued_history_while_history_finishes() {
        let mut w = world();
        let vault = handbook_ready(&mut w);
        let me = w.mac_a;
        let node = Node::spawn(w.lab.split(me, &[], [191; 32]), me, Options::local())
            .await
            .unwrap();
        let history = Arc::new(AtomicUsize::new(0));
        let (entered, entered_rx) = tokio::sync::oneshot::channel();
        let (release, release_rx) = std::sync::mpsc::channel();
        let shared = node.shared.clone();
        let active = tokio::spawn(async move {
            shared
                .try_lab_class(Class::Background, move |_, _| {
                    entered.send(()).unwrap();
                    release_rx.recv().unwrap();
                })
                .await
                .unwrap()
        });
        entered_rx.await.unwrap();
        let mut registrations = Vec::new();
        // Deliberately queue unrelated maintenance too. Node owns background
        // tasks, so total queue length is not the fixture's task count.
        let (notice, registered) = oneshot::channel();
        registrations.push(registered);
        let shared = node.shared.clone();
        let maintenance = tokio::spawn(REGISTERED.scope(std::cell::RefCell::new(Some(notice)), async move {
            shared.try_lab_class(Class::Background, |_, _| ()).await.unwrap();
        }));
        let mut backlog = Vec::new();
        for _ in 0..8 {
            let shared = node.shared.clone();
            let progress = history.clone();
            let (notice, registered) = oneshot::channel();
            registrations.push(registered);
            backlog.push(tokio::spawn(REGISTERED.scope(std::cell::RefCell::new(Some(notice)), async move {
                shared
                    .try_lab_class(Class::Background, move |lab, me| {
                        lab.catch_up(me);
                        progress.fetch_add(1, Ordering::SeqCst);
                    })
                    .await
                    .unwrap()
            })));
        }
        let shared = node.shared.clone();
        let seen = history.clone();
        let (notice, registered) = oneshot::channel();
        registrations.push(registered);
        let reader = tokio::spawn(REGISTERED.scope(std::cell::RefCell::new(Some(notice)), async move {
            shared
                .read(move |lab, me| {
                    assert!(
                        seen.load(Ordering::SeqCst) < 8,
                        "foreground read must not wait for the whole queued history"
                    );
                    lab.size(me)
                })
                .await
        }));
        let shared = node.shared.clone();
        let seen = history.clone();
        let (notice, registered) = oneshot::channel();
        registrations.push(registered);
        let writer = tokio::spawn(REGISTERED.scope(std::cell::RefCell::new(Some(notice)), async move {
            shared
                .try_lab(move |lab, me| {
                    assert!(
                        seen.load(Ordering::SeqCst) < 8,
                        "foreground write must not wait for the whole queued history"
                    );
                    lab.create(
                        me,
                        vault,
                        vault,
                        "doc",
                        &[],
                        document("Foreground", "during catch-up", me),
                    )
                    .unwrap()
                })
                .await
                .unwrap()
        }));
        time::timeout(Duration::from_secs(5), async {
            for registered in registrations { registered.await.expect("task queued before release"); }
        })
        .await
        .unwrap();
        // Cancelling the async caller must not release its still-running blocking turn.
        active.abort();
        assert!(active.await.unwrap_err().is_cancelled());
        {
            let state = node.shared.lab_schedule.state.lock().unwrap();
            assert!(state.active, "cancellation retains the executing blocking turn");
            assert!(state.background.len() >= 9, "all eight history tasks and maintenance remain queued");
            assert!(state.foreground.len() >= 2, "both foreground tasks remain queued");
        }
        assert_eq!(history.load(Ordering::SeqCst), 0, "no queued history ran before release");
        release.send(()).unwrap();
        reader.await.unwrap();
        let entry = writer.await.unwrap();
        for task in backlog {
            task.await.unwrap();
        }
        maintenance.await.unwrap();
        assert_eq!(
            history.load(Ordering::SeqCst),
            8,
            "background catch-up finishes too"
        );
        assert!(
            node.read(move |lab, me| lab.item(me, entry).is_some())
                .await
        );
        node.shutdown().await.unwrap();
    }
}

#[cfg(test)]
mod slices {
    use super::*;
    use crate::{Node, Options};
    use avendb::cast::{document, handbook_ready, world};

    /// A node of Alice's iPhone holding, not yet caught up, `n` documents her Mac wrote for the coop, as a pull's pages
    /// before its last leave it; its own tasks stopped, so nothing but the test catches it up.
    async fn behind(n: usize) -> Node {
        let mut w = world();
        let coop = handbook_ready(&mut w);
        let (mac, phone) = (w.mac_a, w.phone_a);
        let lab = w.lab.split(phone, &[], [77; 32]);
        for i in 0..n {
            let doc = document(&format!("Doc {i}"), "Written while the iPhone was away.", mac);
            w.lab.create(mac, coop, coop, "doc", &[], doc).unwrap();
        }
        let node = Node::spawn(lab, phone, Options::local()).await.unwrap();
        node.tasks.lock().unwrap().iter().for_each(|task| task.abort());
        let held: std::collections::HashSet<_> = node.read(|lab, me| lab.log(me).ids().to_vec()).await.into_iter().collect();
        let fresh: Vec<_> = w.lab.backup(mac).signed().iter().filter(|s| !held.contains(&s.edit.id())).cloned().collect();
        for page in fresh.chunks(100) {
            let page = page.to_vec();
            node.shared.try_lab(move |lab, me| lab.receive_whose_now(me, page, vec![], false)).await.unwrap();
        }
        node
    }

    /// The turns of the Lab a catch-up took so far, as the node counts them (`Turns`): a whole one is one turn, a paced
    /// one a turn a step.
    fn catch_up_turns(node: &Node) -> u64 {
        let turns = node.shared.lab_turns.json();
        turns["by"].as_object().unwrap().iter()
            .filter(|(call, _)| call.contains("catch_up") && !call.contains("read_between"))
            .map(|(_, t)| t["count"].as_u64().unwrap()).sum()
    }

    /// A page's read, asked once `job` took its first turn of the Lab and answered between two of its turns: the turns
    /// of the catch-up done when it was answered, and in all once the job ended. By the order of events, not by the
    /// clock, so a loaded machine can't make it fail or pass (it failed so on a loaded runner, 2026-10-27).
    async fn read_between(node: &Node, job: impl std::future::Future<Output = ()> + Send + 'static) -> (u64, u64) {
        let before = catch_up_turns(node);
        let running = tokio::spawn(job);
        while catch_up_turns(node) == before && !running.is_finished() {
            tokio::task::yield_now().await;
        }
        node.shared.read(|lab, me| lab.size(me)).await;
        let answered = catch_up_turns(node) - before;
        running.await.unwrap();
        (answered, catch_up_turns(node) - before)
    }

    /// A page's read waits for no whole catch-up of a long backlog: the catch-up goes a short turn of the Lab at a time
    /// (`Lab::catch_up_step`), and a read asked meanwhile takes its turn between two of them, while many are still to
    /// come. As one turn, as before, a read waited the whole of it. How long a turn holds the Lab at a server's size is
    /// `avendb/tests/scale_turns.rs`'s, in a release build.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn a_page_waits_for_one_slice_of_a_catch_up_not_the_whole() {
        let n = 800;
        let whole = behind(n).await;
        let before = catch_up_turns(&whole);
        whole.shared.try_lab_class(Class::Background, |lab, me| { lab.catch_up(me); }).await.unwrap();
        assert_eq!(catch_up_turns(&whole) - before, 1, "a whole catch-up is one turn");
        let sliced = behind(n).await;
        let shared = sliced.shared.clone();
        let (answered, turns) = read_between(&sliced, async move {
            assert!(shared.catch_up_paced_class(true, Class::Background).await);
        }).await;
        eprintln!("SLICES the catch-up took {turns} turns, a read asked after its first was answered after {answered}");
        // answered while most of the catch-up was still to come: a whole one answers it after its one turn, its last
        assert!(turns >= 8, "the catch-up goes a step a turn: {turns} turns");
        assert!(answered + 4 <= turns, "a read waits a slice, not the catch-up: answered after {answered} of {turns} turns");
        // and it brought what one catch-up brings
        let seen = |lab: &avendb::lab::Lab, me| (lab.entries(me), lab.log(me).ids().to_vec());
        assert_eq!(whole.read(seen).await, sliced.read(seen).await);
        whole.shutdown().await.unwrap();
        sliced.shutdown().await.unwrap();
    }
}

/// How long Lab calls waited for their turn and held the Lab, by the call (its closure's type name), and the slowest of
/// late: what a server says on its public health (`Node::served`), so a slow page names what held the Lab before it.
#[derive(Default)]
pub(crate) struct Turns(Mutex<TurnBook>);

#[derive(Default)]
struct TurnBook {
    by: std::collections::BTreeMap<&'static str, (u64, u64, u64, u64)>,
    slow: VecDeque<(u64, &'static str, u64, u64)>,
}

/// Holds and waits at least this long are kept among the slow ones.
const SLOW_MS: u64 = 250;
/// How many slow ones it keeps.
const SLOW_KEPT: usize = 40;

impl Turns {
    /// A Lab call `what` waited `wait_ms` for its turn and held the Lab `hold_ms`.
    pub(crate) fn took(&self, what: &'static str, wait_ms: u64, hold_ms: u64) {
        let what = what.trim_end_matches("::{{closure}}");
        let mut book = self.0.lock().expect("Lab turns");
        let t = book.by.entry(what).or_default();
        *t = (t.0 + 1, t.1 + wait_ms, t.2 + hold_ms, t.3.max(hold_ms));
        if hold_ms >= SLOW_MS || wait_ms >= SLOW_MS {
            let at = crate::jobs::now_ms();
            book.slow.push_front((at, what, wait_ms, hold_ms));
            book.slow.truncate(SLOW_KEPT);
        }
    }

    /// `{held_ms, by: {call: {count, wait_ms, hold_ms, max_hold_ms}}, slow: [{at, call, wait_ms, hold_ms}]}`, the calls
    /// that held the Lab longest first.
    pub(crate) fn json(&self) -> serde_json::Value {
        let book = self.0.lock().expect("Lab turns");
        let mut by: Vec<_> = book.by.iter().collect();
        by.sort_by_key(|(_, t)| std::cmp::Reverse(t.2));
        let held: u64 = by.iter().map(|(_, t)| t.2).sum();
        let by: serde_json::Map<String, serde_json::Value> = by
            .into_iter()
            .take(24)
            .map(|(k, t)| (k.to_string(), serde_json::json!({"count": t.0, "wait_ms": t.1, "hold_ms": t.2, "max_hold_ms": t.3})))
            .collect();
        let slow: Vec<_> = book
            .slow
            .iter()
            .map(|(at, what, wait, hold)| serde_json::json!({"at": at, "call": what, "wait_ms": wait, "hold_ms": hold}))
            .collect();
        serde_json::json!({ "held_ms": held, "by": by, "slow": slow })
    }
}

#[cfg(test)]
mod turn_tests {
    use super::Turns;

    /// A slow call is named among the slow ones and leads the calls by how long they held the Lab.
    #[test]
    fn the_call_that_held_the_lab_longest_leads() {
        let turns = Turns::default();
        turns.took("avendb_net::session::authorized_reply::{{closure}}", 10, 900);
        turns.took("avendb_net::blobs::offer::{{closure}}", 0, 5);
        let said = turns.json();
        assert_eq!(said["held_ms"], 905);
        assert_eq!(said["by"]["avendb_net::session::authorized_reply"]["max_hold_ms"], 900);
        assert_eq!(said["slow"].as_array().map(Vec::len), Some(1), "only the slow one is kept");
        assert_eq!(said["slow"][0]["call"], "avendb_net::session::authorized_reply");
    }
}
