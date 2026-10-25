//! Accepted-base suffixes are a separate request, never a history-coverage claim.
use super::*;
use avendb::{id::EntryId, wire::Wire};
pub(crate) const KIND: u8 = 22;
pub(crate) const LIMIT: usize = 66 + 32 * 32;
const RESPONSE: usize = 512 << 10;
const DEADLINE: Duration = Duration::from_secs(2);

fn request(bytes: &[u8]) -> Result<(EntryId, EditId, Vec<EditId>)> {
    anyhow::ensure!(bytes.len() >= 66 && bytes.len() <= LIMIT && bytes[0] == 1, "suffix request shape");
    let n = bytes[65] as usize;
    anyhow::ensure!(n <= 32 && bytes.len() == 66 + n * 32, "suffix cursor bound");
    let seen: Vec<_> = bytes[66..].chunks_exact(32).map(|b| EditId(b.try_into().unwrap())).collect();
    anyhow::ensure!(seen.iter().collect::<BTreeSet<_>>().len() == seen.len(), "duplicate suffix cursor");
    Ok((EntryId(bytes[1..33].try_into().unwrap()), EditId(bytes[33..65].try_into().unwrap()), seen))
}
pub(crate) async fn answer(shared: &Arc<Shared>, peer: &Peer, bytes: &[u8],
    permit: Arc<tokio::sync::OwnedSemaphorePermit>) -> Result<Vec<u8>> {
    let (entry, snapshot, seen) = request(bytes)?;
    let requester = peer.device;
    let (revision, reply) = shared.try_lab(move |lab, me| {
        let _permit = permit;
        let revision = lab.log(me).revision();
        (revision, lab.owner_base_suffix_reply(me, requester, entry, snapshot, &seen))
    }).await?;
    let reply = reply.context("suffix base not current or requester unauthorized")?;
    let bytes = reply.to_wire();
    anyhow::ensure!(bytes.len() <= RESPONSE, "suffix response bound");
    anyhow::ensure!(shared.read(move |lab, me| lab.log(me).revision() == revision).await, "suffix authority changed");
    Ok(bytes)
}
impl Shared {
    /// A small independent lane keeps accepted views reactive while ordinary
    /// history callers wait for pull admission. Same-entry hints coalesce.
    pub(crate) fn schedule_owner_suffixes(self: &Arc<Self>, endpoint: EndpointId, device: SignerId, logs: &[LogId]) {
        for log in logs.iter().take(pulls::LIVE_LOGS) {
            let LogId::Entry(entry) = *log else { continue };
            let key = (device, entry);
            let mut running = self.owner_suffix_running.lock().expect("owner suffixes");
            if let Some(dirty) = running.get_mut(&key) { *dirty = true; continue; }
            let Ok(permit) = self.owner_suffixes.clone().try_acquire_owned() else { break };
            let Ok(activity) = self.admit() else { break };
            running.insert(key, false);
            drop(running);
            let shared = self.clone();
            task::spawn(async move {
                let (_permit, _activity) = (permit, activity);
                for _ in 0..4 {
                    if let Some(peer) = shared.live(endpoint).filter(|p| p.device == device) {
                        let _ = time::timeout(Duration::from_secs(4), shared.try_owner_base_suffix(&peer, entry)).await;
                    }
                    let mut running = shared.owner_suffix_running.lock().expect("owner suffixes");
                    if running.get(&key) == Some(&true) { running.insert(key, false); }
                    else { running.remove(&key); return; }
                }
                shared.owner_suffix_running.lock().expect("owner suffixes").remove(&key);
            });
        }
    }
    pub(crate) async fn try_owner_base_suffix(self: &Arc<Self>, peer: &Peer, entry: EntryId) -> Result<bool> {
        let shared = self.clone();
        let base = self.read(move |lab, me| {
            let base = lab.owner_base_scope(me, entry)?;
            let log = lab.log(me);
            let indexed = shared.logs_of(lab, me);
            let seen = indexed.of.get(&LogId::Entry(entry)).map(|l| l.edits.iter().rev().take(32)
                .map(|&at| log.ids()[at]).collect::<Vec<_>>()).unwrap_or_default();
            Some((base, seen))
        }).await;
        let Some((base, seen)) = base else { return Ok(false) };
        let device = peer.device;
        let connection = peer.conn.stable_id();
        let inventory = {
            let _held = self.held.lock().expect("held");
            self.ranges.lock().expect("ranges").complete_inventory(connection, device)
        };
        if inventory.is_none() { return Ok(false); }
        let snapshot = base.snapshot();
        let mut bytes = vec![1]; bytes.extend(entry.0); bytes.extend(snapshot.0); bytes.push(seen.len() as u8);
        for id in &seen { bytes.extend(id.0); }
        let permit = time::timeout(DEADLINE, self.pulls.page(false, true)).await??;
        let reply = time::timeout(DEADLINE, session::exchange(&peer.conn, KIND, &bytes, RESPONSE)).await??;
        let reply = Reply::from_wire(&reply)?;
        anyhow::ensure!(!reply.more && reply.blobs.is_empty() && reply.edits.len() <= 64, "suffix exceeds bounded accepted cut");
        anyhow::ensure!(reply.edits.iter().all(|s| avendb::sync::log_of(&s.edit,s.edit.id()) == Some(LogId::Entry(entry))), "foreign suffix entry");
        let Some(owner) = authority_classes::OwnerEntry::from_base(&base, entry, &reply.edits) else { return Ok(false) };
        #[cfg(not(target_arch = "wasm32"))]
        let (prepared, permit, activity, ()) = self.prepare_received_page(reply.edits, permit, (), #[cfg(test)] None).await?;
        #[cfg(target_arch = "wasm32")]
        let (prepared, permit, activity, ()) = self.prepare_received_page(reply.edits, permit, ()).await?;
        drop(permit);
        let grant_ids = self.held.lock().expect("held").get(&device).map(|h| h.logs.keys().filter_map(|l|
            match l { LogId::Share(id) => Some(*id), _ => None }).collect()).unwrap_or_default();
        let Some(classes) = self.grant_classes(peer, grant_ids).await else { return Ok(false) };
        let (owner, classes) = (Arc::new(owner), Arc::new(classes));
        let mut previous = BTreeSet::new();
        for _ in 0..4 {
            let (shared, owner, classes) = (self.clone(), owner.clone(), classes.clone());
            let missing = self.read(move |lab, me| {
                let held = shared.held.lock().expect("held");
                let current = held.get(&device)?;
                let ranges = shared.ranges.lock().expect("ranges");
                if inventory != ranges.complete_inventory(connection, device) { return None; }
                if lab.owner_base_scope(me,entry)?.snapshot() != snapshot { return None; }
                let log = lab.log(me);
                let indexed = shared.logs_of(lab,me);
                classes.owner_dependencies(&owner, log.edits(), log.ids(), &indexed, current,
                    |id|lab.independently_verified_edit(me,id)).map(|d|d.missing)
            }).await;
            let Some(missing) = missing else { return Ok(false) };
            if missing.is_empty() || missing == previous { break; }
            previous = missing.clone();
            self.pull_expected(peer.endpoint,Scope::Logs(missing),false,None,Some(device)).await?;
        }
        // Existing current dependency closure is the release gate. Missing
        // dependencies remain ordinary authorized work; no base can override it.
        let shared = self.clone();
        let admitted = self.try_lab(move |lab, me| {
            let _activity = activity;
            let held = shared.held.lock().expect("held");
            let Some(current) = held.get(&device) else { return false };
            let ranges = shared.ranges.lock().expect("ranges");
            if inventory != ranges.complete_inventory(connection, device) { return false; }
            let Some(now) = lab.owner_base_scope(me, entry) else { return false };
            // A concurrent local move/write can change the accepted overlay
            // without replacing its original snapshot. Fence the entire bounded
            // dependency summary, not merely that snapshot ID.
            if now != base { return false; }
            let log = lab.log(me);
            let indexed = shared.logs_of(lab, me);
            if classes.owner_scope(&owner, log.edits(), log.ids(), &indexed, current,
                |id| lab.independently_verified_edit(me,id)).is_none() { return false; }
            lab.receive_prepared(me, prepared, true);
            true
        }).await?;
        if admitted { self.bootstrap_due.notify_one(); self.jobs.stir(); }
        Ok(admitted)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn suffix_request_carries_base_separately_and_is_bounded() {
        let mut b = vec![1]; b.extend([7;32]); b.extend([8;32]); b.push(0);
        assert_eq!(request(&b).unwrap(), (EntryId([7;32]),EditId([8;32]),vec![]));
        b[65]=33; assert!(request(&b).is_err());
        b[0]=0; assert!(request(&b).is_err());
    }
}
