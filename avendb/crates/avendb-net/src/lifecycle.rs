//! Admission and cancellation-safe shutdown completion. Once closing begins, every
//! retained handle refuses new mutation. The owned task survives any waiter being
//! dropped. Its caller retains writer ownership until quiescence, save and disk fence
//! all succeed; a failed completion never reopens admission.
use std::future::Future;
use std::io;
use std::sync::{Arc, Mutex};
use tokio::sync::{Notify, watch};

type Completion = Result<(), Arc<str>>;
#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Open,
    Closing,
    Closed,
}
struct State {
    phase: Phase,
    admitted: usize,
}
pub(crate) struct Lifecycle {
    state: Mutex<State>,
    idle: Notify,
    done: watch::Sender<Option<Completion>>,
}
pub(crate) struct Ticket {
    life: Arc<Lifecycle>,
}
pub(crate) struct Quiescence {
    life: Arc<Lifecycle>,
}
pub(crate) struct Finalizer {
    life: Arc<Lifecycle>,
}
impl Finalizer {
    pub(crate) fn is_of(&self, life: &Arc<Lifecycle>) -> bool {
        Arc::ptr_eq(&self.life, life)
    }
}
#[cfg(not(target_arch = "wasm32"))]
pub(crate) trait TaskSafe: Send {}
#[cfg(not(target_arch = "wasm32"))]
impl<T: Send> TaskSafe for T {}
#[cfg(target_arch = "wasm32")]
pub(crate) trait TaskSafe {}
#[cfg(target_arch = "wasm32")]
impl<T> TaskSafe for T {}
struct Completing {
    life: Arc<Lifecycle>,
    completed: bool,
}

impl Lifecycle {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State { phase: Phase::Open, admitted: 0 }),
            idle: Notify::new(),
            done: watch::channel(None).0,
        })
    }
    pub(crate) fn admit(self: &Arc<Self>) -> io::Result<Ticket> {
        let mut state = self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.phase != Phase::Open {
            return Err(io::Error::new(io::ErrorKind::BrokenPipe, "node is closed"));
        }
        state.admitted += 1;
        Ok(Ticket { life: self.clone() })
    }
    /// Exactly one owned finalizer. It must stop producers before waiting for admitted
    /// work, then save, fence the native queue, and only then release writer ownership.
    pub(crate) fn start_close<F, Fut>(self: &Arc<Self>, finish: F) -> bool
    where
        F: FnOnce(Quiescence) -> Fut + TaskSafe + 'static,
        Fut: Future<Output = Completion> + TaskSafe + 'static,
    {
        {
            let mut state = self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            if state.phase != Phase::Open {
                return false;
            }
            state.phase = Phase::Closing;
        }
        let life = self.clone();
        n0_future::task::spawn(async move {
            let done = Completing { life: life.clone(), completed: false };
            let result = finish(Quiescence { life }).await;
            done.finish(result);
        });
        true
    }
    /// Dropping an owner never makes its retained writable handles usable again.
    pub(crate) fn abandon(&self) {
        let mut state = self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.phase == Phase::Open {
            state.phase = Phase::Closed;
            self.done.send_replace(Some(Err("writer dropped without shutdown".into())));
        }
    }
    pub(crate) async fn closed(&self) -> Completion {
        let mut done = self.done.subscribe();
        loop {
            if let Some(result) = done.borrow_and_update().clone() {
                return result;
            }
            if done.changed().await.is_err() {
                return Err("shutdown completion disappeared".into());
            }
        }
    }
}
impl Quiescence {
    pub(crate) async fn wait(&self) -> Finalizer {
        loop {
            let idle = self.life.idle.notified();
            // Register before testing the count: completion may race the mutex read.
            tokio::pin!(idle);
            idle.as_mut().enable();
            if self.life.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner).admitted == 0 {
                return Finalizer { life: self.life.clone() };
            }
            idle.await;
        }
    }
}
impl Drop for Ticket {
    fn drop(&mut self) {
        let mut state = self.life.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        state.admitted -= 1;
        if state.admitted == 0 {
            self.life.idle.notify_waiters();
        }
    }
}
impl Completing {
    fn finish(mut self, result: Completion) {
        self.life.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner).phase = Phase::Closed;
        self.life.done.send_replace(Some(result));
        self.completed = true;
    }
}
impl Drop for Completing {
    fn drop(&mut self) {
        if !self.completed {
            self.life.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner).phase = Phase::Closed;
            self.life.done.send_replace(Some(Err("shutdown task stopped before its durability fence".into())));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[tokio::test]
    async fn closing_rejects_admission_and_survives_cancelled_waiter() {
        let life = Lifecycle::new();
        let admitted = life.admit().unwrap();
        let (finished, mut receipt) = tokio::sync::oneshot::channel();
        assert!(life.start_close(move |quiet| async move {
            quiet.wait().await;
            finished.send(()).unwrap();
            Ok(())
        }));
        assert!(life.admit().is_err());
        let waiter = tokio::spawn({
            let life = life.clone();
            async move { life.closed().await }
        });
        tokio::task::yield_now().await;
        waiter.abort();
        assert!(matches!(receipt.try_recv(), Err(tokio::sync::oneshot::error::TryRecvError::Empty)));
        drop(admitted);
        receipt.await.unwrap();
        assert_eq!(life.closed().await, Ok(()));
        assert!(life.admit().is_err());
    }
    #[tokio::test]
    async fn only_one_finalizer_runs_and_all_waiters_observe_its_failure() {
        let life = Lifecycle::new();
        let count = Arc::new(AtomicUsize::new(0));
        for _ in 0..8 {
            let count = count.clone();
            life.start_close(move |quiet| async move {
                quiet.wait().await;
                count.fetch_add(1, Ordering::SeqCst);
                Err("fence failed".into())
            });
        }
        assert_eq!(life.closed().await, Err("fence failed".into()));
        assert_eq!(life.closed().await, Err("fence failed".into()));
        assert_eq!(count.load(Ordering::SeqCst), 1);
        assert!(life.admit().is_err());
    }
    #[tokio::test]
    async fn a_panicked_finalizer_reports_failure_without_reopening() {
        let life = Lifecycle::new();
        life.start_close(|_| async move {
            panic!("injected finalizer panic");
            #[allow(unreachable_code)]
            Ok(())
        });
        assert_eq!(life.closed().await, Err("shutdown task stopped before its durability fence".into()));
        assert!(life.admit().is_err());
    }
}
