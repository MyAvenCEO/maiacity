//! Fair local Lab admission. A person's write goes first, oldest first, ahead of every
//! read and background turn that waits (`Writes.lean` `Turns`, batch 5 W2): it waits for
//! the turn running when it comes and the writes made before it, nothing else. With no
//! write waiting, foreground may overtake queued background work, but after three
//! foreground grants one waiting background operation gets a turn.
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
    /// A person's write (`Node::try_act`): ahead of every read and background turn.
    Write,
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
    writes: VecDeque<Waiting>,
    foreground: VecDeque<Waiting>,
    background: VecDeque<Waiting>,
}
pub(crate) struct Schedule {
    state: Mutex<State>,
    writes: Arc<Semaphore>,
    foreground: Arc<Semaphore>,
    background: Arc<Semaphore>,
}
impl Default for Schedule {
    fn default() -> Self {
        Self {
            state: Mutex::default(),
            writes: Arc::new(Semaphore::new(256)),
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
        s.writes.retain(|w| w.id != self.id);
        s.foreground.retain(|w| w.id != self.id);
        s.background.retain(|w| w.id != self.id);
    }
}
impl Schedule {
    pub(crate) async fn acquire(self: &Arc<Self>, class: Class) -> Turn {
        let slots = match class {
            Class::Write => &self.writes,
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
                if class != Class::Write {
                    s.burst = usize::from(class == Class::Foreground);
                }
                return Turn {
                    schedule: self.clone(),
                    _slot: slot,
                };
            }
            let id = s.next;
            s.next = s.next.wrapping_add(1);
            let queue = match class {
                Class::Write => &mut s.writes,
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
            // a write first, whatever else waits; it leaves the reads' run against background as it was
            let next = if let Some(write) = s.writes.pop_front() {
                Some(write)
            } else if !s.foreground.is_empty() && (s.background.is_empty() || s.burst < 3) {
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
    /// The order `Writes.lean` (`Turns.grants`) grants waiting turns in, from `vectors/local_writes.json`: every
    /// ticket queued behind a running turn, then each granted turn let go at once.
    #[tokio::test]
    async fn turns_go_in_the_models_order() {
        let vectors: serde_json::Value =
            serde_json::from_str(include_str!("../../../spec/vectors/local_writes.json")).expect("the vectors");
        let cases = vectors["turns"].as_array().expect("turn cases");
        assert!(!cases.is_empty());
        for case in cases {
            let schedule = Arc::new(Schedule::default());
            let active = schedule.acquire(Class::Background).await;
            let tickets = |key: &str| -> Vec<u64> {
                case[key].as_array().unwrap().iter().map(|t| t.as_u64().unwrap()).collect()
            };
            // tickets in the queue of their class, oldest first, as the model holds them
            let mut waiting = Vec::new();
            for (key, class, name) in [
                ("writes", Class::Write, "write"),
                ("reads", Class::Foreground, "read"),
                ("background", Class::Background, "background"),
            ] {
                for t in tickets(key) {
                    let mut turn = Box::pin(schedule.acquire(class));
                    assert!(poll_once(&mut turn).await.is_none());
                    waiting.push((name, t, turn));
                }
            }
            schedule.state.lock().unwrap().burst = case["burst"].as_u64().unwrap() as usize;
            drop(active);
            let mut granted = Vec::new();
            while !waiting.is_empty() {
                let mut next = None;
                for (i, (_, _, turn)) in waiting.iter_mut().enumerate() {
                    if let Some(turn) = poll_once(turn).await {
                        assert!(next.is_none(), "one turn at a time");
                        next = Some((i, turn));
                    }
                }
                let (i, turn) = next.expect("a turn granted");
                let (name, t, _) = waiting.remove(i);
                granted.push(serde_json::json!([name, t]));
                drop(turn);
            }
            assert_eq!(serde_json::Value::Array(granted), case["grants"], "{case}");
        }
    }

    #[tokio::test]
    async fn a_write_overtakes_every_waiting_read_and_background_turn() {
        let schedule = Arc::new(Schedule::default());
        let active = schedule.acquire(Class::Background).await;
        let mut reads: Vec<_> = (0..32).map(|_| Box::pin(schedule.acquire(Class::Foreground))).collect();
        let mut background: Vec<_> = (0..16).map(|_| Box::pin(schedule.acquire(Class::Background))).collect();
        for r in reads.iter_mut().chain(background.iter_mut()) {
            assert!(poll_once(r).await.is_none());
        }
        let mut write = Box::pin(schedule.acquire(Class::Write));
        assert!(poll_once(&mut write).await.is_none());
        drop(active);
        let turn = poll_once(&mut write).await.expect("the write goes next");
        for r in reads.iter_mut().chain(background.iter_mut()) {
            assert!(poll_once(r).await.is_none(), "nothing else while the write runs");
        }
        drop(turn);
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

/// G5 (batch 5, W2): a person's write goes ahead of the reads queued before it while the Lab is busy, as the iPhone's
/// did not on 27 Oct (writes 1.9 s): a catch-up slice running and a page's 32 reads waiting, each turn 20 ms. Before
/// writes had a class of their own a write waited for every read queued ahead of it. Here the order is asserted (no
/// queued read ran before the write); the 50 ms p95 the order buys is a gate of the bench's live shard, on a
/// release-like build, not of a unit test on a loaded machine.
#[cfg(all(test, not(target_arch = "wasm32")))]
mod writes_first {
    use super::*;
    use crate::{Node, Options};
    use avendb::cast::{document, handbook_ready, world};
    use std::time::{Duration, Instant};

    const TURN: Duration = Duration::from_millis(20);

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn a_write_goes_ahead_of_the_queued_reads_and_catch_up() {
        let mut w = world();
        let vault = handbook_ready(&mut w);
        let me = w.mac_a;
        let node = Node::spawn(w.lab.split(me, &[], [193; 32]), me, Options { lazy: true, ..Options::local() })
            .await
            .unwrap();
        let mut behind = Vec::new();
        for round in 0..20 {
            // a catch-up slice holds the Lab, then the page's reads queue; it holds it till the person's write waits too,
            // not for a set time: a 20 ms slice ended before the 32 reads had queued under the full suite's load, they
            // ran, and the wait for 32 queued below never ended (N1, 2026-10-28)
            let shared = node.shared.clone();
            let (entered, entering) = tokio::sync::oneshot::channel();
            let (release, released) = std::sync::mpsc::channel::<()>();
            let slice = tokio::spawn(async move {
                shared.try_lab_class(Class::Background, move |_, _| {
                    entered.send(()).unwrap();
                    released.recv().unwrap();
                }).await.unwrap()
            });
            entering.await.unwrap();
            let ran = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let reads: Vec<_> = (0..32).map(|_| {
                let (shared, ran) = (node.shared.clone(), ran.clone());
                tokio::spawn(async move {
                    shared.read(move |lab, me| {
                        ran.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        std::thread::sleep(TURN);
                        lab.size(me)
                    }).await
                })
            }).collect();
            let more: Vec<_> = (0..4).map(|_| {
                let shared = node.shared.clone();
                tokio::spawn(async move { shared.try_lab_class(Class::Background, |_, _| std::thread::sleep(TURN)).await.unwrap() })
            }).collect();
            // every read queued before the person writes
            while node.shared.lab_schedule.state.lock().unwrap().foreground.len() < 32 {
                tokio::task::yield_now().await;
            }
            let asked = Instant::now();
            let ahead = ran.clone();
            let write = node.try_act(move |lab, me| {
                let reads_before = ahead.load(std::sync::atomic::Ordering::SeqCst);
                (lab.create(me, vault, vault, "doc", &[], document(&format!("Write {round}"), "while busy", me)).unwrap(),
                    reads_before)
            });
            // the slice ends once the write waits behind it, and every read and background turn with it
            let ends = async {
                while node.shared.lab_schedule.state.lock().unwrap().writes.is_empty() {
                    tokio::task::yield_now().await;
                }
                release.send(()).unwrap();
            };
            let (written, ()) = tokio::join!(write, ends);
            let (entry, reads_before) = written.unwrap();
            behind.push(asked.elapsed());
            assert_eq!(reads_before, 0, "round {round}: the write ran after {reads_before} of the 32 queued reads");
            assert!(node.read(move |lab, me| lab.item(me, entry).is_some()).await);
            slice.await.unwrap();
            for r in reads { r.await.unwrap(); }
            for m in more { m.await.unwrap(); }
        }
        behind.sort();
        let p95 = behind[(behind.len() * 95).div_ceil(100) - 1];
        eprintln!("WRITES behind a slice and 32 queued {TURN:?} reads: p50 {:?}, p95 {p95:?}, max {:?}",
            behind[behind.len() / 2], behind[behind.len() - 1]);
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

    /// Any device's rule: a catch-up its pace puts off still comes, so it never answers its peers from a replay behind
    /// its log for good. Left behind with nothing to step it on, a device answered by a replay without the edits it took
    /// since (`Lab::standing`): a peer was never handed the note written while it was away
    /// (the drive test `eves_drive_…` caught it, 2026-10-28).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_put_off_catch_up_still_runs_so_no_peer_is_answered_from_a_stale_replay() {
        let node = behind(40).await;
        assert!(!node.read(|lab, me| lab.replay_current(me)).await, "it took pages it hasn't caught up with");
        *node.shared.paced.lock().unwrap() = Some(crate::time::Instant::now() + std::time::Duration::from_millis(200));
        assert!(!node.shared.catch_up_paced_class(false, Class::Background).await, "put off by its pace");
        avendb_testkit::until("the catch-up it put off", || async { node.read(|lab, me| lab.replay_current(me)).await }).await;
        assert!(node.read(|lab, me| lab.entries(me).len()).await >= 40, "every document it took, shown");
        node.shutdown().await.unwrap();
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
    /// `avendb/tests/all/scale_turns.rs`'s, in a release build.
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
    /// The keys a pull brings after its pages, taken in the middle of the catch-up those pages left (`seal_keys`, a
    /// `receive` that brings it up to date), hold the Lab one step, not the whole catch-up, and a peer's ask of the
    /// device is answered between the catch-up's turns, while most are still to come. An iPhone took them in one turn
    /// of 1.8 min (a whole replay, its key index made again, its bodies): a page's worker runs the Lab and its network
    /// alike, so meanwhile it answered no peer, and every peer's asking of it, through the relay, waited out its
    /// connection (2026-10-28). By the order of events, not by the clock.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn the_keys_a_pull_brings_hold_the_lab_a_step_and_a_peers_ask_is_answered_between() {
        let mut w = world();
        let coop = handbook_ready(&mut w);
        let (sender, receiver) = (w.mac_a, w.phone_a);
        let phone_lab = w.lab.split(receiver, &[], [78; 32]);
        for i in 0..800 {
            let doc = document(&format!("Doc {i}"), "Written while the iPhone was away.", sender);
            w.lab.create(sender, coop, coop, "doc", &[], doc).unwrap();
        }
        let held: std::collections::HashSet<_> = phone_lab.log(receiver).ids().iter().copied().collect();
        let fresh: Vec<_> = w.lab.backup(sender).signed().iter().filter(|s| !held.contains(&s.edit.id())).cloned().collect();
        let mac = Node::spawn(w.lab.split(sender, &[], [79; 32]), sender, Options::local()).await.unwrap();
        // its tasks run, so it answers the Mac's connection
        let phone = Node::spawn(phone_lab, receiver, Options::local()).await.unwrap();
        for page in fresh.chunks(100) {
            let page = page.to_vec();
            phone.shared.try_lab(move |lab, me| lab.receive_whose_now(me, page, vec![], false)).await.unwrap();
        }
        mac.know(phone.addr());
        // the keys, as `seal_keys` takes them after a pull
        phone.shared.try_lab_class(Class::Background, |lab, me| { lab.receive(me, Vec::new(), Vec::new()); }).await.unwrap();
        assert!(!phone.read(|lab, me| lab.replay_current(me)).await, "taking the keys ran the whole catch-up in one turn");
        // then the catch-up, a step a turn, and the Mac asks the iPhone once its first turn ran
        let before = catch_up_turns(&phone);
        let shared = phone.shared.clone();
        let running = tokio::spawn(async move { assert!(shared.catch_up_paced_class(true, Class::Background).await) });
        while catch_up_turns(&phone) == before && !running.is_finished() {
            tokio::task::yield_now().await;
        }
        mac.sync_with(phone.id()).await.unwrap();
        let answered = catch_up_turns(&phone) - before;
        running.await.unwrap();
        let turns = catch_up_turns(&phone) - before;
        eprintln!("KEYS the catch-up after the keys took {turns} turns, the Mac's ask was answered after {answered}");
        assert!(turns >= 8, "the catch-up goes a step a turn: {turns} turns");
        assert!(answered + 4 <= turns, "the Mac's ask waits a slice, not the catch-up: answered after {answered} of {turns}");
        assert!(phone.read(|lab, me| lab.entries(me).len()).await >= 800, "every document it took, shown");
        mac.shutdown().await.unwrap();
        phone.shutdown().await.unwrap();
    }
}

/// A live edit that lands while a long catch-up is showing a backlog is shown by the real judge in the next step of
/// that catch-up, not after the backlog (lab.rs `show_items`: the entries of new writes before those a showing left):
/// what a page needs to draw it at once, no second judge laid over. Batch 5, the live overlay asked of lane 8.
#[cfg(all(test, not(target_arch = "wasm32")))]
mod live_first {
    use avendb::cast::{document, handbook_ready, paragraph, world};
    use avendb::lab::CatchUp;

    #[test]
    fn a_live_edit_is_shown_in_the_next_step_of_a_long_catch_up() {
        let mut w = world();
        let coop = handbook_ready(&mut w);
        let (mac, phone) = (w.mac_a, w.phone_a);
        // the room both had before the backlog
        let room = w.lab.create(mac, coop, coop, "doc", &[], document("Room", "Shared before.", mac)).unwrap();
        w.lab.sync(mac, phone);
        let mut lab = w.lab.split(phone, &[], [79; 32]);
        for i in 0..800 {
            let doc = document(&format!("Doc {i}"), "Written while the iPhone was away.", mac);
            w.lab.create(mac, coop, coop, "doc", &[], doc).unwrap();
        }
        assert!(lab.item(phone, room).is_some(), "the room is shown before");
        let held: std::collections::HashSet<_> = lab.log(phone).ids().iter().copied().collect();
        let backlog: Vec<_> = w.lab.backup(mac).signed().iter().filter(|s| !held.contains(&s.edit.id())).cloned().collect();
        for page in backlog.chunks(100) {
            lab.receive_whose_now(phone, page.to_vec(), vec![], false);
        }
        // the backlog's catch-up, a step a turn, as a pull's; the Mac writes in the room live two steps in
        for _ in 0..2 {
            assert!(matches!(lab.catch_up_step(phone, 48), CatchUp::Stepped));
        }
        let before = lab.log(phone).ids().len();
        w.lab.edit(mac, coop, room, |item| item.push_block(paragraph(9, "Live from the Mac"))).unwrap();
        let live: Vec<_> = w.lab.backup(mac).signed().iter().filter(|s| matches!(&s.edit.action,
            avendb::policy::Action::Write { entry, .. } if *entry == room)).cloned().collect();
        lab.receive_whose_now(phone, live, vec![], false);
        assert!(lab.log(phone).ids().len() > before, "the live edit taken");
        let shows = |lab: &avendb::lab::Lab| {
            lab.item(phone, room).and_then(|i| i.as_document()).is_some_and(|d| format!("{d:?}").contains("Live from the Mac"))
        };
        // its replay steps on a slice a step (`CatchUpBudget.lean`), the live edit's among them: it is shown in the
        // next step or two after the replay reaches it, before the backlog's entries are shown
        let (mut steps, mut shown_at, mut replayed_at) = (0, None, None);
        loop {
            let step = lab.catch_up_step(phone, 48);
            steps += 1;
            if replayed_at.is_none() && lab.replay_current(phone) {
                replayed_at = Some(steps);
            }
            if shown_at.is_none() && shows(&lab) {
                shown_at = Some(steps);
            }
            if matches!(step, CatchUp::Caught(_)) {
                break;
            }
        }
        eprintln!("LIVE a live edit taken mid catch-up was shown after {shown_at:?} of the {steps} steps left, replayed after {replayed_at:?}");
        let replayed_at = replayed_at.expect("replayed");
        assert!(steps >= replayed_at + 8, "the backlog's showing takes many steps after its replay: {steps}");
        assert!(
            shown_at.is_some_and(|s| s <= replayed_at + 2),
            "shown in the next step or two once replayed, not after the backlog: {shown_at:?} of {steps}"
        );
        // and it ends holding the backlog's entries and the live edit, as a whole catch-up does
        let made = w.lab.entries(mac);
        assert!(made.iter().all(|e| lab.entries(phone).contains(e)), "every entry of the backlog shown");
        assert!(shows(&lab));
    }
}

/// How long Lab calls waited for their turn and held the Lab, by the call (its closure's type name), and the slowest of
/// late: what a server says on its public health (`Node::served`), so a slow page names what held the Lab before it.
#[derive(Default)]
pub(crate) struct Turns(Mutex<TurnBook>);

#[derive(Default)]
struct TurnBook {
    by: std::collections::BTreeMap<&'static str, (u64, u64, u64, u64, u64)>,
    slow: VecDeque<(u64, &'static str, u64, u64)>,
}

/// Where in the code a hold of the Lab outside a turn was taken, as its name among the turns: `file:line`, each one
/// made once (a node holds the Lab so from a few places alone).
pub(crate) fn place(at: &'static std::panic::Location<'static>) -> &'static str {
    static PLACES: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<(&'static str, u32), &'static str>>> = std::sync::OnceLock::new();
    let mut places = PLACES.get_or_init(Default::default).lock().expect("places");
    places.entry((at.file(), at.line())).or_insert_with(|| Box::leak(format!("held at {}:{}", at.file(), at.line()).into_boxed_str()))
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
        *t = (t.0 + 1, t.1 + wait_ms, t.2 + hold_ms, t.3.max(hold_ms), t.4.max(wait_ms));
        if hold_ms >= SLOW_MS || wait_ms >= SLOW_MS {
            let at = crate::jobs::now_ms();
            book.slow.push_front((at, what, wait_ms, hold_ms));
            book.slow.truncate(SLOW_KEPT);
        }
    }

    /// `{held_ms, by: {call: {count, wait_ms, hold_ms, max_hold_ms, max_wait_ms}}, slow: [{at, call, wait_ms, hold_ms}]}`, the calls
    /// that held the Lab or waited longest first: a wait of its own with no hold (a page's worker away, `give_way`)
    /// leads as a hold does, rather than falling past the 24 it names (fresh9, 2026-10-29: a 298 s wait named nowhere).
    pub(crate) fn json(&self) -> serde_json::Value {
        let book = self.0.lock().expect("Lab turns");
        let mut by: Vec<_> = book.by.iter().collect();
        by.sort_by_key(|(_, t)| std::cmp::Reverse(t.1.max(t.2)));
        let held: u64 = by.iter().map(|(_, t)| t.2).sum();
        let by: serde_json::Map<String, serde_json::Value> = by
            .into_iter()
            .take(24)
            .map(|(k, t)| (k.to_string(), serde_json::json!({"count": t.0, "wait_ms": t.1, "hold_ms": t.2, "max_hold_ms": t.3, "max_wait_ms": t.4})))
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

    /// A long wait with no hold, a page's worker away (`give_way`), is named with its longest however many calls held
    /// the Lab, and however many slow ones came after it.
    #[test]
    fn a_long_wait_with_no_hold_is_named_past_every_hold() {
        let turns = Turns::default();
        turns.took("worker away", 298_537, 0);
        let calls: Vec<&'static str> = (0..64).map(|i| &*Box::leak(format!("call {i}").into_boxed_str())).collect();
        for &call in &calls {
            turns.took(call, 0, 300);
        }
        let said = turns.json();
        assert_eq!(said["by"]["worker away"]["max_wait_ms"], 298_537, "{said}");
        assert!(!said["slow"].as_array().unwrap().iter().any(|s| s["call"] == "worker away"), "the slow ones moved past it");
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
#[path = "lab_schedule_bench.rs"]
mod bench;
