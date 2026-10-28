//! Native-only queue envelopes keep writer guards with the real disk work. A fence
//! shares the work queue, so its acknowledgement follows every previously accepted
//! request, including work whose caller disappeared. Public Shelf::Call is unchanged.
use crate::writer::Guard;
use std::io;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};

pub(crate) enum Request<T> {
    Work(T, Option<Guard>),
    Fence(oneshot::Sender<io::Result<()>>),
}
pub(crate) struct Queue<T> {
    tx: mpsc::Sender<Request<T>>,
}
impl<T> std::fmt::Debug for Queue<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NativeQueue").finish_non_exhaustive()
    }
}
impl<T> Clone for Queue<T> {
    fn clone(&self) -> Self {
        Self { tx: self.tx.clone() }
    }
}
impl<T: Send + 'static> Queue<T> {
    pub(crate) fn start(answer: impl Fn(T) + Send + Sync + 'static) -> Self {
        let (tx, rx) = mpsc::channel(16);
        tokio::spawn(serve(rx, Arc::new(answer)));
        Self { tx }
    }
    pub(crate) async fn send(&self, work: T, guard: Option<Guard>) -> io::Result<()> {
        self.tx.send(Request::Work(work, guard)).await.map_err(|_| gone())
    }
    pub(crate) async fn fence(&self) -> io::Result<()> {
        let (tx, rx) = oneshot::channel();
        self.tx.send(Request::Fence(tx)).await.map_err(|_| gone())?;
        rx.await.map_err(|_| gone())?
    }
}
fn gone() -> io::Error {
    io::Error::new(io::ErrorKind::BrokenPipe, "native shelf queue is gone")
}
async fn serve<T: Send + 'static>(mut rx: mpsc::Receiver<Request<T>>, answer: Arc<impl Fn(T) + Send + Sync + 'static>) {
    let mut active = tokio::task::JoinSet::new();
    let mut panicked = false;
    loop {
        if active.len() >= 16 {
            panicked |= active.join_next().await.is_some_and(|r| r.is_err());
            continue;
        }
        tokio::select! {
            biased;
            done = active.join_next(), if !active.is_empty() => { panicked |= done.is_some_and(|r| r.is_err()); }
            next = rx.recv() => match next {
                Some(Request::Work(work, guard)) => {
                    let answer = answer.clone();
                    active.spawn_blocking(move || { answer(work); drop(guard); });
                }
                Some(Request::Fence(tx)) => {
                    while let Some(done) = active.join_next().await { panicked |= done.is_err(); }
                    let result = if panicked { Err(io::Error::other("native shelf task panicked before its fence")) } else { Ok(()) };
                    let _ = tx.send(result);
                }
                None => break,
            }
        }
    }
    // Closing the queue cannot abort a blocking writer that still owns its guard.
    while active.join_next().await.is_some() {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::writer::Source;
    use std::sync::{Condvar, Mutex};
    #[tokio::test]
    async fn fence_waits_for_cancelled_requests_and_keeps_the_real_writer_lease() {
        let root = std::env::temp_dir().join(format!("avendb-disk-fence-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let source = Source::new(&root);
        let lease = source.claim().unwrap();
        let capability = lease.capability();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let (entered, entered_rx) = oneshot::channel();
        let (answered, answer_rx) = oneshot::channel();
        let queue = Queue::start({
            let gate = gate.clone();
            move |(entered, answered): (oneshot::Sender<()>, oneshot::Sender<()>)| {
                entered.send(()).unwrap();
                let (lock, changed) = &*gate;
                let mut ready = lock.lock().unwrap();
                while !*ready {
                    ready = changed.wait(ready).unwrap();
                }
                let _ = answered.send(());
            }
        });
        queue.send((entered, answered), Some(capability.admit().unwrap())).await.unwrap();
        entered_rx.await.unwrap();
        drop(answer_rx); // aborted caller is no authority to release its disk guard
        drop(lease);
        assert!(source.claim().is_err() && capability.admit().is_err());
        let fence = tokio::spawn({
            let queue = queue.clone();
            async move { queue.fence().await }
        });
        tokio::task::yield_now().await;
        assert!(!fence.is_finished());
        {
            let (lock, changed) = &*gate;
            *lock.lock().unwrap() = true;
            changed.notify_all();
        }
        fence.await.unwrap().unwrap();
        let replacement = source.claim().unwrap();
        drop((replacement, queue));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn a_failed_blocking_task_makes_the_fence_fail_closed() {
        let queue = Queue::start(|()| panic!("injected disk panic"));
        queue.send((), None).await.unwrap();
        assert!(queue.fence().await.is_err());
    }
}
