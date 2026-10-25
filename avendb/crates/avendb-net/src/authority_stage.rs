//! Bounded staging foundation, not yet a scoped-authority bypass.
//! Bytes stay outside Lab until a caller rechecks authenticated holdings. Release
//! returns Signed edits for ordinary signature/current-policy admission, never a
//! readable record. All non-entry frontiers remain required until dependency
//! tracking can prove a smaller complete set.
use std::{collections::BTreeMap, sync::Arc};
use anyhow::{ensure, Context, Result};
use avendb::{id::{EntryId, SignerId}, sign::Signed, sync::{log_of, LogId}, wire::{Frontier, Reply, Wire}};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use crate::Holdings;

const MAX_BYTES: usize = 480 << 10;
const MAX_EDITS: usize = 64;
const MAX_AUTHORITY_LOGS: usize = 128;
const MAX_FRONTIER_IDS: usize = 512;

/// A separate two-page staging budget. Never retain the live/background page
/// permit here: authority catch-up must retain admission while these wait.
pub(crate) struct EntryStages(Arc<Semaphore>);
impl Default for EntryStages {
    fn default() -> Self { Self(Arc::new(Semaphore::new(2))) }
}

pub(crate) struct StagedEntry {
    peer: SignerId,
    entry: EntryId,
    announced: BTreeMap<LogId, Frontier>,
    edits: Vec<Signed>,
    _permit: OwnedSemaphorePermit,
}

fn relevant(log: &LogId, entry: EntryId) -> bool {
    !matches!(log, LogId::Entry(_)) || *log == LogId::Entry(entry)
}

impl EntryStages {
    /// `announced` must come from this peer's authenticated, complete holdings
    /// snapshot. The caller, not the network payload, supplies that binding.
    pub(crate) fn stage(&self, peer: SignerId, entry: EntryId, announced: &Holdings, bytes: &[u8]) -> Result<StagedEntry> {
        let permit = self.0.clone().try_acquire_owned().context("entry staging full")?;
        ensure!(bytes.len() <= MAX_BYTES, "staged entry byte limit");
        ensure!(announced.logs.contains_key(&LogId::Entry(entry)), "entry not announced");
        let selected: Vec<_> = announced.logs.iter().filter(|(log, _)| relevant(log, entry)).collect();
        ensure!(selected.len() <= MAX_AUTHORITY_LOGS + 1, "staged authority log limit");
        let count = selected.iter().try_fold(0usize, |total, (_, f)| {
            total.checked_add(f.heads.len())?.checked_add(f.waiting.len())
        }).context("staged frontier overflow")?;
        ensure!(count <= MAX_FRONTIER_IDS, "staged authority frontier limit");
        let reply = Reply::from_wire(bytes)?;
        ensure!(!reply.edits.is_empty() && reply.edits.len() <= MAX_EDITS && reply.blobs.is_empty(), "staged entry shape");
        ensure!(reply.edits.iter().all(|s| log_of(&s.edit, s.edit.id()) == Some(LogId::Entry(entry))), "staged entry scope");
        let vaults: std::collections::BTreeSet<_> = reply.edits.iter().filter_map(|s| match s.edit.action {
            avendb::policy::Action::Write { vault, .. } | avendb::policy::Action::Mark { vault, .. } => Some(vault),
            _ => None,
        }).collect();
        ensure!(!vaults.is_empty() && vaults.iter().all(|vault| announced.logs.contains_key(&LogId::Vault(*vault))), "staged owning authority missing");
        Ok(StagedEntry { peer, entry,
            announced: selected.into_iter().map(|(log, frontier)| (*log, frontier.clone())).collect(),
            edits: reply.edits, _permit: permit })
    }
}

impl StagedEntry {
    /// An exact conservative receipt, not proof that a peer knows every global
    /// revocation. Any newly announced, removed or changed authority log rejects
    /// this stage. Exact local equality deliberately rejects ambiguous supersets.
    pub(crate) fn ready(&self, peer: SignerId, announced: &Holdings, local: &Holdings) -> bool {
        peer == self.peer
            && announced.logs.iter().filter(|(log, _)| relevant(log, self.entry))
                .eq(self.announced.iter())
            && self.announced.iter().filter(|(log, _)| !matches!(log, LogId::Entry(_)))
                .all(|(log, frontier)| local.logs.get(log) == Some(frontier))
    }

    /// The integration must fence these snapshots against updates through the
    /// admission boundary. A failed check retains the owned stage for retry.
    pub(crate) fn release(self, peer: SignerId, announced: &Holdings, local: &Holdings) -> std::result::Result<Vec<Signed>, Self> {
        if self.ready(peer, announced, local) { Ok(self.edits) } else { Err(self) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use avendb::{cast::{document, world}, id::{EditId, VaultId}, policy::Action};

    fn fixture() -> (SignerId, EntryId, Holdings, Vec<u8>) {
        let mut w = world();
        let entry = w.lab.create(w.mac_a, w.alice, w.alice, "room", &[], document("Room", "held outside replay", w.mac_a)).unwrap();
        let signed = w.lab.log(w.mac_a).edits().iter().find(|edit|
            matches!(edit.action, Action::Write { entry: e, create: Some(_), .. } if e == entry))
            .and_then(|edit| w.lab.signed_edit(w.mac_a, edit.id())).unwrap().clone();
        let mut announced = Holdings::default();
        announced.logs.insert(LogId::Entry(entry), Frontier { heads: vec![signed.edit.id()], waiting: vec![] });
        announced.logs.insert(LogId::Vault(w.alice), Frontier { heads: vec![EditId([9; 32])], waiting: vec![] });
        let bytes = Reply { edits: vec![signed], blobs: vec![], more: false }.to_wire();
        (w.mac_a, entry, announced, bytes)
    }

    #[test]
    fn missing_changed_or_omitted_authority_cannot_release_staged_bytes() {
        let (peer, entry, announced, bytes) = fixture();
        let stages = EntryStages::default();
        let stage = stages.stage(peer, entry, &announced, &bytes).unwrap();
        assert!(!stage.ready(peer, &announced, &Holdings::default()));
        assert!(!stage.ready(SignerId([8; 32]), &announced, &announced));
        let mut revoked = announced.clone();
        revoked.logs.insert(LogId::Vault(VaultId([7; 32])), Frontier { heads: vec![EditId([6; 32])], waiting: vec![] });
        assert!(!stage.ready(peer, &revoked, &revoked), "new authority requires restaging even when locally present");
        let mut changed = announced.clone();
        let (_, frontier) = changed.logs.iter_mut().find(|(log, _)| !matches!(log, LogId::Entry(_))).unwrap();
        frontier.heads = vec![EditId([5; 32])];
        assert!(!stage.ready(peer, &changed, &changed), "a changed revocation frontier invalidates the receipt");
        let omitted = Holdings { logs: announced.logs.iter().filter(|(log, _)| matches!(log, LogId::Entry(_))).map(|(l,f)|(*l,f.clone())).collect(), files: Default::default() };
        assert!(!stage.ready(peer, &omitted, &announced));
        assert!(stages.stage(peer, entry, &omitted, &bytes).is_err(), "missing owning authority cannot make an empty receipt ready");
        assert!(stage.release(peer, &announced, &announced).is_ok(), "only releases Signed bytes for ordinary admission");
    }

    #[test]
    fn staging_is_bounded_and_cancellation_reclaims_capacity() {
        let (peer, entry, announced, bytes) = fixture();
        let stages = EntryStages::default();
        let one = stages.stage(peer, entry, &announced, &bytes).unwrap();
        let two = stages.stage(peer, entry, &announced, &bytes).unwrap();
        assert!(stages.stage(peer, entry, &announced, &bytes).is_err());
        drop(one);
        assert!(stages.stage(peer, entry, &announced, &bytes).is_ok());
        drop(two);
        assert!(stages.stage(peer, EntryId([3; 32]), &announced, &bytes).is_err());
        assert!(stages.stage(peer, entry, &announced, &vec![0; MAX_BYTES + 1]).is_err());
    }
}
