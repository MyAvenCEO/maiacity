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
    Mutation,
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
    write_burst: usize,
    mutations: VecDeque<Waiting>,
    foreground: VecDeque<Waiting>,
    background: VecDeque<Waiting>,
}
pub(crate) struct Schedule {
    state: Mutex<State>,
    mutations: Arc<Semaphore>,
    foreground: Arc<Semaphore>,
    background: Arc<Semaphore>,
}
impl Default for Schedule {
    fn default() -> Self {
        Self {
            state: Mutex::default(),
            mutations: Arc::new(Semaphore::new(16)),
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
        s.mutations.retain(|w| w.id != self.id);
        s.foreground.retain(|w| w.id != self.id);
        s.background.retain(|w| w.id != self.id);
    }
}
impl Schedule {
    pub(crate) async fn acquire(self: &Arc<Self>, class: Class) -> Turn {
        let slots = match class {
            Class::Mutation => &self.mutations,
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
                s.burst = usize::from(class != Class::Background);
                s.write_burst = usize::from(class == Class::Mutation);
                return Turn {
                    schedule: self.clone(),
                    _slot: slot,
                };
            }
            let id = s.next;
            s.next = s.next.wrapping_add(1);
            let queue = match class {
                Class::Mutation => &mut s.mutations,
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
            let has_foreground = !s.mutations.is_empty() || !s.foreground.is_empty();
            let next = if has_foreground && (s.background.is_empty() || s.burst < 3) {
                s.burst = s.burst.saturating_add(1);
                if !s.mutations.is_empty() && (s.foreground.is_empty() || s.write_burst < 2) {
                    s.write_burst = s.write_burst.saturating_add(1);
                    s.mutations.pop_front()
                } else {
                    s.write_burst = 0;
                    s.foreground.pop_front()
                }
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
    async fn local_writes_overtake_reads_without_starving_reads_or_history() {
        let schedule = Arc::new(Schedule::default());
        let active = schedule.acquire(Class::Background).await;
        let mut read = Box::pin(schedule.acquire(Class::Foreground));
        let mut history = Box::pin(schedule.acquire(Class::Background));
        assert!(poll_once(&mut read).await.is_none());
        assert!(poll_once(&mut history).await.is_none());
        let mut writes: Vec<_> = (0..3).map(|_| Box::pin(schedule.acquire(Class::Mutation))).collect();
        for write in &mut writes { assert!(poll_once(write).await.is_none()); }
        let mut cancelled = Box::pin(schedule.acquire(Class::Mutation));
        assert!(poll_once(&mut cancelled).await.is_none());
        drop(cancelled);
        drop(active);
        for write in writes.iter_mut().take(2) {
            let turn = poll_once(write).await.expect("local mutation overtakes queued read");
            assert!(poll_once(&mut read).await.is_none());
            assert!(poll_once(&mut history).await.is_none());
            drop(turn);
        }
        let turn = poll_once(&mut read).await.expect("read after two writes");
        assert!(poll_once(&mut writes[2]).await.is_none());
        drop(turn);
        let turn = poll_once(&mut history).await.expect("history after three foreground grants");
        assert!(poll_once(&mut writes[2]).await.is_none());
        drop(turn);
        drop(poll_once(&mut writes[2]).await.expect("remaining mutation resumes"));
        assert!(!schedule.state.lock().unwrap().active);
        assert_eq!(schedule.mutations.available_permits(), 16);
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
