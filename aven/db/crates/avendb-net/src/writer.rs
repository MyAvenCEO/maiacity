//! Native writer ownership, separate from opening a shelf for reads. The lock lives
//! above generations and is never deleted or replaced. Queued disk operations retain
//! a guard until their real blocking work ends, even if the requesting future is gone.
use std::fs::{File, OpenOptions};
use std::io;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Weak};

#[derive(Clone, Debug)]
pub(crate) struct Source {
    path: PathBuf,
    generation: Option<u64>,
}
#[derive(Debug)]
struct Held {
    _file: File,
    open: AtomicBool,
}
/// The single owning capability. A derived shelf holds only a weak capability.
#[derive(Debug)]
pub(crate) struct Lease {
    held: Arc<Held>,
}
#[derive(Clone, Debug)]
pub(crate) struct Capability {
    held: Weak<Held>,
}
#[derive(Debug)]
pub(crate) struct Guard {
    _held: Arc<Held>,
}

impl Source {
    /// No filesystem changes. The caller creates a new root, if necessary, before
    /// acquiring the lock and creating or repairing anything inside its generation.
    pub(crate) fn new(root: &Path) -> Self {
        Self { path: root.join("writer.lock"), generation: None }
    }
    pub(crate) fn for_generation(root: &Path, generation: u64) -> Self {
        Self { path: root.join("writer.lock"), generation: Some(generation) }
    }
    pub(crate) fn claim(&self) -> io::Result<Lease> {
        let file =
            OpenOptions::new().read(true).write(true).create(true).truncate(false).mode(0o600).open(&self.path)?;
        file.try_lock()?;
        if let Some(selected) = self.generation {
            let current = crate::disk::generations(self.path.parent().expect("root"))
                .map_err(|e| io::Error::other(e.to_string()))?
                .last()
                .copied();
            if current != Some(selected) {
                return Err(io::Error::new(io::ErrorKind::InvalidInput, "read-open shelf generation is stale"));
            }
        }
        Ok(Lease { held: Arc::new(Held { _file: file, open: AtomicBool::new(true) }) })
    }
}
impl Lease {
    pub(crate) fn capability(&self) -> Capability {
        Capability { held: Arc::downgrade(&self.held) }
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.held.open.store(false, Ordering::Release);
    }
}
impl Capability {
    /// Call before enqueueing. Move the guard into the queue item, then into its
    /// spawn_blocking closure. Dropping the async waiter cannot release this guard.
    pub(crate) fn admit(&self) -> io::Result<Guard> {
        self.held
            .upgrade()
            .filter(|held| held.open.load(Ordering::Acquire))
            .map(|held| Guard { _held: held })
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "shelf writer is closed"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    struct Root(PathBuf);
    impl Root {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let root = Self(std::env::temp_dir().join(format!(
                "avendb-writer-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            )));
            std::fs::create_dir_all(&root.0).unwrap();
            root
        }
    }
    impl Drop for Root {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn ownership_is_exclusive_per_root_and_read_open_is_inert() {
        let a = Root::new();
        let b = Root::new();
        let source = Source::new(&a.0);
        assert!(!a.0.join("writer.lock").exists());
        let lease = source.claim().unwrap();
        assert!(Source::new(&a.0).claim().is_err());
        let other = Source::new(&b.0).claim().unwrap();
        let capability = lease.capability();
        let queued = capability.admit().unwrap();
        drop(lease);
        assert!(capability.admit().is_err(), "closing stops admission even while queued work holds its guard");
        assert!(source.claim().is_err(), "queued work keeps the real OS lease");
        drop(queued);
        assert!(capability.admit().is_err(), "old shelf cannot use a replacement owner");
        let replacement = source.claim().unwrap();
        assert!(capability.admit().is_err());
        drop((other, replacement));
    }
    #[test]
    fn a_second_process_cannot_claim_until_all_queued_work_finishes() {
        let root = Root::new();
        let source = Source::new(&root.0);
        let lease = source.claim().unwrap();
        let queued = lease.capability().admit().unwrap();
        let child = |locked: bool| {
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "writer::tests::lock_child", "--ignored", "--nocapture"])
                .env("AVENDB_TEST_WRITER_ROOT", &root.0)
                .env("AVENDB_TEST_WRITER_LOCKED", if locked { "1" } else { "0" })
                .status()
                .unwrap();
            assert!(status.success());
        };
        child(true);
        drop(lease);
        child(true);
        drop(queued);
        child(false);
    }
    #[test]
    #[ignore = "subprocess helper; invoked by ownership test"]
    fn lock_child() {
        let root = std::env::var_os("AVENDB_TEST_WRITER_ROOT").expect("only invoked by parent test");
        let locked = std::env::var("AVENDB_TEST_WRITER_LOCKED").unwrap() == "1";
        assert_eq!(Source::new(Path::new(&root)).claim().is_err(), locked);
    }
}
