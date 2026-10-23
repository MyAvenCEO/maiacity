//! Two fixed encrypted slots for derived authorized edit-set indexes. They are dispensable: a stale binding,
//! corrupt/torn slot, unsupported bounded reader or exhausted memory budget rebuilds the ordinary authorized set.
//! No independent writer or publication task exists. `flush` is called only inside Shared's admitted save lane.
use crate::edit_ranges::{Budget, Charge, SUMMARY_BYTES, Tree};
use crate::{Cursor, shelf::Shelf};
use anyhow::{Result, anyhow, ensure};
use avendb::id::{EditId, SignerId};
use avendb::keys::{self, Secret, SeededRng};
use bytes::Bytes;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
};
use zeroize::Zeroizing;
const MAGIC: &[u8] = b"avenDB authorized edit summary 1\n";
const AAD: &[u8] = b"avenDB local edit summary encryption 1\n";
const OVERHEAD: usize = 72;

/// Exact ordered held history, including the durable journal after its last compacted head. A compacted
/// `Edits::checked` alone is insufficient: another signer's journaled revocation can leave that head and our
/// own published signer root unchanged. Compute once at BEGIN after the entire captured log is durable.
pub(crate) fn history(ids: &[EditId]) -> [u8; 40] {
    let mut hash = bao_tree::blake3::Hasher::new();
    hash.update(b"avenDB authorized edit history 1\n");
    hash.update(&(ids.len() as u64).to_be_bytes());
    for id in ids { hash.update(&id.0); }
    let mut out = [0; 40];
    out[..8].copy_from_slice(&(ids.len() as u64).to_be_bytes());
    out[8..].copy_from_slice(hash.finalize().as_bytes());
    out
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Binding {
    pub(crate) device: SignerId,
    pub(crate) peer: SignerId,
    pub(crate) scope: [u8; 32],
    pub(crate) history: [u8; 40],
    pub(crate) root: [u8; 32],
    pub(crate) engine: [u8; 32],
}
impl Binding {
    fn put(&self, out: &mut Vec<u8>) {
        out.extend(self.device.0);
        out.extend(self.peer.0);
        out.extend(self.scope);
        out.extend(self.history);
        out.extend(self.root);
        out.extend(self.engine);
    }
    fn take(r: &mut Cursor<'_>) -> Result<Self> {
        fn take<const N: usize>(r: &mut Cursor<'_>) -> Result<[u8; N]> {
            r.array()
                .ok_or_else(|| anyhow!("short range summary binding"))
        }
        Ok(Self {
            device: SignerId(take(r)?),
            peer: SignerId(take(r)?),
            scope: take(r)?,
            history: take(r)?,
            root: take(r)?,
            engine: take(r)?,
        })
    }
}
struct Pending {
    sequence: u64,
    bytes: Bytes,
    _charge: Charge,
}
#[derive(Default)]
pub(crate) struct Queue {
    sequence: AtomicU64,
    pending: Mutex<Option<Arc<Pending>>>,
}
fn name(slot: u64) -> String {
    format!("slots/edit-ranges/{}", slot % 2)
}
fn aad(device: SignerId) -> Vec<u8> {
    let mut aad = AAD.to_vec();
    aad.extend(device.0);
    aad.extend(avendb::paged_view::engine());
    aad
}
impl Queue {
    /// The node queues at most one replacement (two disk slots total, not two slots per peer). Old Arc readers keep
    /// their memory charge until an in-flight save finishes, so replacement cannot evade the aggregate budget.
    pub(crate) fn stage(
        &self,
        binding: Binding,
        tree: &Tree,
        key: &Secret,
        budget: &Budget,
    ) -> Result<()> {
        let bound = tree
            .ids()
            .len()
            .checked_mul(256)
            .and_then(|n| n.checked_add(4096))
            .context("range summary size overflow")?;
        ensure!(bound <= SUMMARY_BYTES, "range summary too large");
        let charge = budget.reserve(
            bound
                .checked_mul(3)
                .context("range summary allocation overflow")?,
        )?;
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let mut plain = Zeroizing::new(MAGIC.to_vec());
        plain.extend(sequence.to_be_bytes());
        binding.put(&mut plain);
        plain.extend(tree.encode()?);
        ensure!(
            plain.len() + OVERHEAD <= SUMMARY_BYTES,
            "range summary slot limit"
        );
        let mut seed = Zeroizing::new([0; 32]);
        getrandom::fill(seed.as_mut()).map_err(anyhow::Error::msg)?;
        let mut rng = SeededRng::new("edit range summary nonce 1", seed.as_ref());
        let bytes = Bytes::from(keys::encrypt(key, &plain, &aad(binding.device), &mut rng));
        *self.pending.lock().expect("range summary pending") = Some(Arc::new(Pending {
            sequence,
            bytes,
            _charge: charge,
        }));
        Ok(())
    }
    /// Caller holds the Node's writer activity and edits.book save guard. A failed Keep keeps the pending snapshot.
    /// A successful old write only acknowledges that exact captured Arc, never a newer replacement queued meanwhile.
    pub(crate) async fn flush(&self, shelf: &Shelf) -> Result<bool> {
        let captured = self.pending.lock().expect("range summary pending").clone();
        let Some(captured) = captured else {
            return Ok(false);
        };
        shelf
            .keep(&name(captured.sequence), captured.bytes.clone())
            .await?;
        let mut pending = self.pending.lock().expect("range summary pending");
        if pending.as_ref().is_some_and(|p| Arc::ptr_eq(p, &captured)) {
            *pending = None;
        }
        Ok(true)
    }
    #[cfg(test)]
    pub(crate) fn pending(&self) -> bool {
        self.pending
            .lock()
            .expect("range summary pending")
            .is_some()
    }
    pub(crate) fn discard(&self) {
        *self.pending.lock().expect("range summary pending") = None;
    }
}
use anyhow::Context as _;

fn decode(data: &[u8], binding: &Binding, key: &Secret, budget: &Budget) -> Result<Tree> {
    ensure!(data.len() <= SUMMARY_BYTES, "range summary slot limit");
    let plain = Zeroizing::new(
        keys::decrypt(key, data, &aad(binding.device)).context("unauthenticated range summary")?,
    );
    ensure!(plain.starts_with(MAGIC), "range summary version");
    let mut r = Cursor(&plain[MAGIC.len()..]);
    r.take(8).context("range summary sequence")?;
    ensure!(Binding::take(&mut r)? == *binding, "stale range summary");
    Tree::decode(r.0, budget)
}
/// Uses the bounded read provider, never Shelf::get: a hostile-sized named file cannot allocate before its limit.
/// All read/decrypt/temporary buffers are conservatively charged before attempting either slot.
pub(crate) async fn load(
    shelf: &Shelf,
    binding: &Binding,
    key: &Secret,
    budget: &Budget,
) -> Option<Tree> {
    for slot in 0..2 {
        let _buffers = budget.reserve(SUMMARY_BYTES * 2).ok()?;
        let data = match shelf.get_bounded(&name(slot), SUMMARY_BYTES).await {
            Ok(Some(data)) => data,
            _ => continue,
        };
        if let Ok(tree) = decode(&data, binding, key, budget) {
            return Some(tree);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shelf::Call;
    use avendb::id::EditId;
    fn binding() -> Binding {
        Binding {
            device: SignerId([1; 32]),
            peer: SignerId([2; 32]),
            scope: [3; 32],
            history: [4; 40],
            root: [5; 32],
            engine: avendb::paged_view::engine(),
        }
    }
    fn tree(budget: &Budget) -> Tree {
        Tree::new((0..32).map(EditId::from_u64).collect(), budget).unwrap()
    }
    #[test]
    fn history_binds_journal_appends_withdrawals_and_same_count_replacements() {
        let a = EditId::from_u64(1); let b = EditId::from_u64(2); let c = EditId::from_u64(3);
        assert_ne!(history(&[a]), history(&[a, b]));
        assert_ne!(history(&[a, b]), history(&[a, c]));
        assert_ne!(history(&[a, b]), history(&[b, a]));
        assert_ne!(history(&[a, b]), history(&[b]));
        assert_eq!(history(&[a, b]), history(&[a, b]));
    }
    #[test]
    fn authenticated_slots_bind_scope_peer_root_head_engine_and_canonical_fingerprints() {
        let budget = Budget::new(32 << 20);
        let tree = tree(&budget);
        let key = Secret::from_bytes([6; 32]);
        let queue = Queue::default();
        let binding = binding();
        queue.stage(binding.clone(), &tree, &key, &budget).unwrap();
        let p = queue.pending.lock().unwrap().clone().unwrap();
        assert_eq!(
            decode(&p.bytes, &binding, &key, &budget).unwrap().root(),
            tree.root()
        );
        for field in 0..6 {
            let mut other = binding.clone();
            match field {
                0 => other.device.0[0] ^= 1,
                1 => other.peer.0[0] ^= 1,
                2 => other.scope[0] ^= 1,
                3 => other.history[0] ^= 1,
                4 => other.root[0] ^= 1,
                _ => other.engine[0] ^= 1,
            };
            assert!(decode(&p.bytes, &other, &key, &budget).is_err());
        }
        let mut changed = p.bytes.to_vec();
        let last = changed.len() - 1;
        changed[last] ^= 1;
        assert!(decode(&changed, &binding, &key, &budget).is_err());
        assert!(decode(&p.bytes[..p.bytes.len() - 1], &binding, &key, &budget).is_err());
        assert!(decode(&p.bytes, &binding, &Secret::from_bytes([7; 32]), &budget).is_err());
    }
    #[tokio::test]
    async fn failed_flush_retries_and_old_acknowledgement_does_not_clear_replacement() {
        let budget = Budget::new(32 << 20);
        let tree = tree(&budget);
        let key = Secret::from_bytes([6; 32]);
        let queue = Arc::new(Queue::default());
        let (shelf, mut calls) = Shelf::new();
        queue.stage(binding(), &tree, &key, &budget).unwrap();
        let queued = queue.clone();
        let store = shelf.clone();
        let saving = tokio::spawn(async move { queued.flush(&store).await });
        match calls.recv().await.unwrap() {
            Call::Keep { tx, .. } => {
                tx.send(Err(std::io::Error::other("injected failure"))).ok();
            }
            _ => panic!("only Keep"),
        }
        assert!(saving.await.unwrap().is_err());
        assert!(queue.pending());
        let queued = queue.clone();
        let store = shelf.clone();
        let saving = tokio::spawn(async move { queued.flush(&store).await });
        let call = calls.recv().await.unwrap();
        let mut next = binding();
        next.history[0] ^= 1;
        queue.stage(next, &tree, &key, &budget).unwrap();
        match call {
            Call::Keep { tx, .. } => {
                tx.send(Ok(())).ok();
            }
            _ => panic!("only Keep"),
        }
        assert!(saving.await.unwrap().unwrap());
        assert!(
            queue.pending(),
            "newer snapshot survives old acknowledgement"
        );
        let queued = queue.clone();
        let saving = tokio::spawn(async move { queued.flush(&shelf).await });
        match calls.recv().await.unwrap() {
            Call::Keep { name, tx, .. } => {
                assert!(name.ends_with("/1"));
                tx.send(Ok(())).ok();
            }
            _ => panic!("only Keep"),
        }
        assert!(saving.await.unwrap().unwrap());
        assert!(!queue.pending());
    }
}
