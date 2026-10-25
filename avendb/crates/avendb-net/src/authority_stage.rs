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

pub(crate) const MAX_BYTES: usize = 480 << 10;
const MAX_EDITS: usize = 64;
const MAX_AUTHORITY_LOGS: usize = 128;
const MAX_FRONTIER_IDS: usize = 512;

/// A separate two-page staging budget. Never retain the live/background page
/// permit here: authority catch-up must retain admission while these wait.
pub(crate) struct EntryStages(Arc<Semaphore>, #[cfg(test)] std::sync::atomic::AtomicUsize);
impl Default for EntryStages {
    fn default() -> Self { Self(Arc::new(Semaphore::new(2)), #[cfg(test)] std::sync::atomic::AtomicUsize::new(0)) }
}

pub(crate) struct StagedEntry {
    peer: SignerId,
    entry: EntryId,
    announced: BTreeMap<LogId, Frontier>,
    edits: Vec<Signed>,
    owner: Option<crate::authority_classes::OwnerEntry>,
    classes: Option<crate::authority_classes::GrantClasses>,
    inventory: Option<crate::ranges::InventoryReceipt>,
    _permit: OwnedSemaphorePermit,
}

fn relevant(log: &LogId, entry: EntryId) -> bool {
    !matches!(log, LogId::Entry(_)) || *log == LogId::Entry(entry)
}

impl EntryStages {
    /// `announced` must come from this peer's authenticated, complete holdings
    /// snapshot. The caller, not the network payload, supplies that binding.
    pub(crate) fn stage(&self, peer: SignerId, entry: EntryId, announced: &Holdings, bytes: &[u8]) -> Result<StagedEntry> {
        let permit = self.reserve()?;
        self.stage_reserved(permit, peer, entry, announced, bytes)
    }

    pub(crate) fn reserve(&self) -> Result<OwnedSemaphorePermit> {
        self.0.clone().try_acquire_owned().context("entry staging full")
    }

    pub(crate) fn stage_reserved(&self, permit: OwnedSemaphorePermit, peer: SignerId, entry: EntryId, announced: &Holdings, bytes: &[u8]) -> Result<StagedEntry> {
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
            edits: reply.edits, owner: None, classes: None, inventory: None, _permit: permit })
    }
}

impl StagedEntry {
    /// An exact conservative receipt, not proof that a peer knows every global
    /// revocation. Any newly announced, removed or changed authority log rejects
    /// this stage. Exact local equality deliberately rejects ambiguous supersets.
    pub(crate) fn ready(&self, peer: SignerId, announced: &Holdings, local: &Holdings) -> bool {
        self.current(peer, announced)
            && self.announced.iter().filter(|(log, _)| !matches!(log, LogId::Entry(_)))
                .all(|(log, frontier)| local.logs.get(log) == Some(frontier))
    }

    pub(crate) fn current(&self, peer: SignerId, announced: &Holdings) -> bool {
        peer == self.peer && announced.logs.iter().filter(|(log, _)| relevant(log, self.entry)).eq(self.announced.iter())
    }

    // Signature checking owns the immutable bytes; the receipt and staging permit
    // remain alive until the final in-Lab admission fence.
    pub(crate) fn take_for_verification(&mut self) -> Vec<Signed> {
        std::mem::take(&mut self.edits)
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

    #[tokio::test]
    async fn replacing_view_cancels_two_waiting_stages_before_new_view_admission() {
        use crate::demand::Demands;
        use n0_future::time::{Duration, Instant, timeout};
        let stages = EntryStages::default();
        let mut demands = Demands::default();
        let scope = "view".to_owned();
        demands.replace(scope.clone(), 1, vec![LogId::Entry(EntryId([71;32]))], Instant::now()).unwrap();
        let origin = demands.origin(&scope, 1, Instant::now()).unwrap();
        let (started, mut starts) = tokio::sync::mpsc::channel(2);
        let mut workers = Vec::new();
        for _ in 0..2 {
            let permit = stages.reserve().unwrap();
            let origin = origin.clone();
            let started = started.clone();
            workers.push(tokio::spawn(async move {
                origin.run(async move {
                    let _permit = permit;
                    started.send(()).await.unwrap();
                    std::future::pending::<()>().await;
                }).await
            }));
        }
        timeout(Duration::from_secs(2), async {
            starts.recv().await.unwrap(); starts.recv().await.unwrap();
        }).await.expect("both staged waits started");
        assert!(stages.reserve().is_err(), "both old stages hold the entire bound");
        demands.replace(scope.clone(), 2, vec![], Instant::now()).unwrap();
        timeout(Duration::from_secs(2), async {
            for worker in workers { assert!(worker.await.unwrap().is_none()); }
        }).await.expect("closing a view wakes waits immediately, not the15-second stage deadline");
        assert!(!origin.active());
        assert!(origin.run(async { panic!("obsolete stage must not enter admission") }).await.is_none());
        demands.replace(scope.clone(), 3, vec![LogId::Entry(EntryId([72;32]))], Instant::now()).unwrap();
        assert!(demands.origin(&scope, 3, Instant::now()).unwrap().active());
        let first = stages.reserve().expect("new view takes released capacity");
        let second = stages.reserve().expect("both obsolete permits were released");
        drop((first, second));
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

enum Admission {
    Waiting(StagedEntry, avendb::lab::PreparedReceive),
    Applied,
    Discarded,
}

impl crate::Shared {
    pub(crate) fn stage_live_entries(self: &Arc<Self>, endpoint: iroh::EndpointId, device: SignerId, hints: std::collections::BTreeSet<LogId>) {
        self.stage_entries_origin(endpoint, device, hints, None);
    }

    pub(crate) fn stage_entries_origin(self: &Arc<Self>, endpoint: iroh::EndpointId, device: SignerId,
        hints: std::collections::BTreeSet<LogId>, origin: Option<crate::demand::Origin>) {
        if origin.as_ref().is_some_and(|o| !o.active()) { return; }
        let Some(peer) = self.live(endpoint).filter(|peer| peer.device == device) else { return };
        for log in hints {
            let LogId::Entry(entry) = log else { continue };
            let (announced, inventory) = {
                let held = self.held.lock().expect("held");
                let Some(current) = held.get(&device) else { break };
                let selected: Vec<_> = current.logs.iter().filter(|(log, _)| relevant(log, entry)).take(MAX_AUTHORITY_LOGS + 2).collect();
                if selected.len() > MAX_AUTHORITY_LOGS + 1 || !current.logs.contains_key(&LogId::Entry(entry)) { continue; }
                let count = selected.iter().try_fold(0usize, |n, (_, f)| n.checked_add(f.heads.len())?.checked_add(f.waiting.len()));
                if count.is_none_or(|n| n > MAX_FRONTIER_IDS) { continue; }
                let inventory = self.ranges.lock().expect("ranges").complete_inventory(peer.conn.stable_id(), device);
                (Holdings { logs: selected.into_iter().map(|(l,f)|(*l,f.clone())).collect(), files: Default::default() }, inventory)
            };
            let Ok(permit) = self.authority_stages.reserve() else { break };
            let Ok(activity) = self.admit() else { break };
            let (shared, peer, origin) = (self.clone(), peer.clone(), origin.clone());
            n0_future::task::spawn(async move {
                let _activity = activity;
                let work = n0_future::time::timeout(std::time::Duration::from_secs(15),
                    shared.stage_live_entry_origin(peer, entry, announced, inventory, permit, origin.clone()));
                let attempted = match &origin { Some(origin) => origin.run(work).await, None => Some(work.await) };
                if !matches!(attempted, Some(Ok(Ok(())))) {
                    tracing::debug!(?attempted, "staged entry continues through ordinary reconciliation");
                }
            });
        }
    }

    async fn stage_live_entry(self: &Arc<Self>, peer: crate::Peer, entry: EntryId, announced: Holdings, inventory: Option<crate::ranges::InventoryReceipt>, stage_permit: OwnedSemaphorePermit) -> Result<()> {
        self.stage_live_entry_origin(peer, entry, announced, inventory, stage_permit, None).await
    }

    async fn stage_live_entry_origin(self: &Arc<Self>, peer: crate::Peer, entry: EntryId, announced: Holdings,
        inventory: Option<crate::ranges::InventoryReceipt>, stage_permit: OwnedSemaphorePermit,
        origin: Option<crate::demand::Origin>) -> Result<()> {
        ensure!(origin.as_ref().is_none_or(|o| o.active()), "obsolete view stage");
        let device = peer.device;
        let logs = [LogId::Entry(entry)].into_iter().collect();
        let request = self.read(move |lab, me| {
            let mut request = crate::session::only(lab, me, lab.request(me, device), &logs);
            // Auxiliary key blobs remain on normal authority reconciliation.
            request.wants.clear();
            request.to_wire()
        }).await;
        ensure!(request.len() < crate::session::MESSAGE_LIMIT, "staged request too large");
        let page = self.pulls.page(false, false).await?;
        let (reply, _) = self.reply_to(&peer, crate::session::ASK_LOGS, &request, MAX_BYTES).await?;
        let mut stage = self.authority_stages.stage_reserved(stage_permit, device, entry, &announced, &reply.to_wire())?;
        drop(reply); // do not retain a duplicate decoded page during authority wait
        stage.inventory = inventory;
        let shared = self.clone();
        let mut stage = self.read(move |lab, me| {
            if stage.inventory.is_some() {
                let indexed = shared.logs_of(lab, me);
                let places = indexed.of.get(&LogId::Entry(entry)).map(|l| l.edits.as_slice()).unwrap_or(&[]);
                let log = lab.log(me);
                if places.len() <= 64 && places.iter().all(|&at| lab.independently_verified_edit(me, log.ids()[at])) {
                    // Existing target metadata plus the delta closes the cut;
                    // no body clone or whole-target redownload is needed.
                    let local = places.iter().map(|&at| (log.ids()[at], &log.edits()[at]));
                    let incoming = stage.edits.iter().map(|s| (s.edit.id(), &s.edit));
                    stage.owner = crate::authority_classes::OwnerEntry::from_parts(entry, local.chain(incoming), &stage.announced[&LogId::Entry(entry)]);
                }
            }
            stage
        }).await;
        let edits = stage.take_for_verification();
        #[cfg(not(target_arch = "wasm32"))]
        let (prepared, page, activity, mut stage) = self.prepare_received_page(edits, page, stage,
            #[cfg(test)] None,
        ).await?;
        #[cfg(target_arch = "wasm32")]
        let (prepared, page, activity, mut stage) = self.prepare_received_page(edits, page, stage).await?;
        // Dedicated staging capacity remains held, but authority page admission
        // and signature-check admission are free while the local frontier catches up.
        drop(page);
        if let Some(owner) = &stage.owner {
            // Entry creation can introduce its audience-key log after the
            // receiver's prior sync. Fetch these directly known dependencies
            // through ordinary validated transfer; waiting for the broad
            // authority backlog here would defeat scoped admission.
            let mut required = owner.via.iter().copied().map(LogId::Vault).collect::<std::collections::BTreeSet<_>>();
            required.insert(LogId::Vault(owner.vault));
            required.extend(owner.audiences.iter().map(|shares| LogId::Audience(owner.vault, avendb::id::AudienceId::of(owner.vault, shares))));
            let missing = self.differ(device).await;
            required.retain(|id| stage.announced.contains_key(id) && missing.contains(id));
            if !required.is_empty() {
                self.pull_expected(peer.endpoint, crate::Scope::Logs(required), false, None, Some(device)).await?;
            }
        }
        if stage.owner.is_some() {
            let inventory = stage.announced.keys().filter_map(|log| match log { LogId::Share(id) => Some(*id), _ => None }).collect();
            stage.classes = self.grant_classes(&peer, inventory).await;
        }
        // Discover one bounded layer at a time. A missing reader/ancestor log
        // cannot be inspected until normal authorized transfer has admitted it.
        // Fetching is never admission: the final atomic fence below recomputes
        // the entire closure against the current receipt and current Lab.
        let mut previous_missing = None;
        for _ in 0..4 {
            ensure!(origin.as_ref().is_none_or(|o| o.active()), "obsolete dependency request");
            let shared = self.clone();
            let connection = peer.conn.stable_id();
            let (returned, missing) = self.read(move |lab, me| {
                let held = shared.held.lock().expect("held");
                let current = held.get(&device);
                let current_receipt = shared.ranges.lock().expect("ranges").complete_inventory(connection, device);
                let missing = current.filter(|current| stage.current(device, current))
                    .filter(|_| stage.inventory.is_some() && stage.inventory == current_receipt)
                    .and_then(|current| stage.owner.as_ref().zip(stage.classes.as_ref()).and_then(|(owner, classes)| {
                        let log = lab.log(me);
                        let indexed = shared.logs_of(lab, me);
                        classes.owner_dependencies(owner, log.edits(), log.ids(), &indexed, current,
                            |id| lab.independently_verified_edit(me, id)).map(|dependencies| dependencies.missing)
                    }));
                (stage, missing)
            }).await;
            stage = returned;
            let Some(missing) = missing.filter(|missing| !missing.is_empty()) else { break };
            if previous_missing.as_ref() == Some(&missing) { break; }
            previous_missing = Some(missing.clone());
            self.pull_expected(peer.endpoint, crate::Scope::Logs(missing), false, None, Some(device)).await?;
        }
        #[cfg(test)]
        self.authority_stages.1.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let _activity = activity;
        let mut prepared = prepared;
        let mut changes = self.jobs.stirs();
        loop {
            changes.borrow_and_update();
            ensure!(peer.conn.close_reason().is_none(), "staged peer disconnected");
            let shared = self.clone();
            let connection = peer.conn.stable_id();
            let admission_origin = origin.clone();
            let returned = self.try_lab(move |lab, me| {
                // Keep the lease lock through admission, just like holdings.
                // Navigation cannot replace the revision between check and use.
                let demands = admission_origin.as_ref().map(|_| shared.demands.lock().expect("demands"));
                if admission_origin.as_ref().zip(demands.as_ref()).is_some_and(|(o, demands)|
                    !demands.current(&o.scope, o.revision, n0_future::time::Instant::now())) {
                    return Admission::Discarded;
                }
                // All network holdings writes use this mutex. Hold it THROUGH
                // admission while Lab itself is locked; no await occurs here.
                let held = shared.held.lock().expect("held");
                let Some(current) = held.get(&device) else { return Admission::Discarded };
                if !stage.current(device, current) { return Admission::Discarded; }
                let local = Holdings { logs: shared.logs_of(lab, me).frontiers(), files: Default::default() };
                if !stage.ready(device, current, &local) {
                    // Negative classification is valid only for the complete
                    // inventory bound to this exact authenticated connection.
                    let ranges = shared.ranges.lock().expect("ranges");
                    let root_current = stage.inventory.is_some()
                        && stage.inventory == ranges.complete_inventory(connection, device);
                    let scoped = root_current && stage.owner.as_ref().zip(stage.classes.as_ref()).is_some_and(|(owner, classes)| {
                        let log = lab.log(me);
                        let indexed = shared.logs_of(lab, me);
                        classes.owner_scope(owner, log.edits(), log.ids(), &indexed, current,
                            |id| lab.independently_verified_edit(me, id)).is_some()
                    });
                    if !scoped {
                        return Admission::Waiting(stage, prepared);
                    }
                    // held remains locked through receive below; neither the
                    // current root nor any required frontier can change here.
                }
                // Signature and current policy admission are unchanged. The stage
                // receipt grants no authorization even when its frontier matches.
                lab.receive_prepared(me, prepared, true);
                Admission::Applied
            }).await?;
            match returned {
                Admission::Applied => { self.jobs.stir(); return Ok(()); }
                Admission::Discarded => return Ok(()),
                Admission::Waiting(held_stage, held_prepared) => {
                    stage = held_stage;
                    prepared = held_prepared;
                }
            }
            changes.changed().await.context("staged entry change subscription closed")?;
        }
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;
    use avendb::cast::{document, world};
    use crate::{Node, Options};
    use n0_future::time::{self, Duration};

    async fn until(mut check: impl AsyncFnMut() -> bool) {
        time::timeout(Duration::from_secs(20), async {
            while !check().await { time::sleep(Duration::from_millis(5)).await; }
        }).await.expect("staged transport progresses");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn incomplete_inventory_keeps_entry_outside_replay_until_authority_receipt_matches() {
        let mut w = world();
        let (sender, receiver, vault) = (w.mac_a, w.phone_a, w.alice);
        let phone_lab = w.lab.split(receiver, &[], [151; 32]);
        // A real signed authority edit is missing on the receiver, not a mocked
        // completeness flag. Entry content is transferred over the real peer link.
        w.lab.submit(sender, &[w.passkey_a], avendb::policy::Action::Settings {
            vault, set: avendb::policy::Setting::Threshold(1),
        }).unwrap();
        let entry = w.lab.create(sender, vault, vault, "room", &[], document("Staged room", "visible after authority", sender)).unwrap();
        let authority: Vec<_> = w.lab.log(sender).edits().iter().filter(|edit|
            log_of(edit, edit.id()).is_some_and(|log| !matches!(log, LogId::Entry(_))))
            .map(|edit| w.lab.signed_edit(sender, edit.id()).unwrap().clone()).collect();
        let opts = || Options { lazy: true, ..Options::local() };
        let mac = Node::spawn(w.lab.split(sender, &[], [152; 32]), sender, opts()).await.unwrap();
        let phone = Node::spawn(phone_lab, receiver, opts()).await.unwrap();
        phone.know(mac.addr()); mac.know(phone.addr());
        phone.shared.connection(mac.id()).await.unwrap();
        until(async || phone.holdings_of(sender).is_some_and(|h| h.logs.contains_key(&LogId::Entry(entry)))).await;
        // A legacy/incomplete inventory cannot establish a negative scope.
        // Exercise the real transfer with no complete receipt: it must keep
        // the original all-authority fence even for an otherwise owner entry.
        let peer = phone.shared.live(mac.id()).expect("authenticated peer");
        let announced = phone.holdings_of(sender).expect("announced holdings");
        let permit = phone.shared.authority_stages.reserve().unwrap();
        let shared = phone.shared.clone();
        let staged = tokio::spawn(async move { shared.stage_live_entry(peer, entry, announced, None, permit).await });
        until(async || phone.shared.authority_stages.1.load(std::sync::atomic::Ordering::SeqCst) > 0).await;
        assert!(!phone.read(move |lab, me| lab.log(me).edits().iter().any(|edit| log_of(edit,edit.id()) == Some(LogId::Entry(entry)))).await,
            "verified staged bytes do not enter the signed log or visible replay");
        // Simulate completion of ordinary signed authority receive; no entry edits
        // are supplied here. The stage must be the only source of the room bytes.
        phone.act(move |lab, me| lab.receive(me, authority, vec![])).await;
        until(async || phone.read(move |lab, me| lab.log(me).edits().iter().any(|edit| log_of(edit,edit.id()) == Some(LogId::Entry(entry)))).await).await;
        staged.await.unwrap().unwrap();
        mac.shutdown().await.unwrap(); phone.shutdown().await.unwrap();
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn owner_room_and_live_delta_render_while_unrelated_authority_and_history_are_withheld() {
        use avendb::{cast::{handbook, text}, policy::{Action, Setting}};
        let mut w = world();
        let handbook = handbook(&mut w);
        let (sender, receiver, vault) = (w.mac_a, w.phone_a, w.alice);
        w.lab.issue(sender, &[sender], avendb::cast::share(vault, avendb::policy::Who::Vault(w.bob),
            avendb::policy::Level::Read, avendb::slice::Selector::All)).unwrap();
        w.lab.sync_all(0);
        let phone_lab = w.lab.split(receiver, &[], [155; 32]);
        // A known wide reader's newly announced authority must be pulled by
        // dependency scheduling, while unrelated coop authority stays missing.
        let related_reader = w.bob;
        w.lab.submit(sender, &[w.passkey_b], Action::Settings {
            vault: related_reader, set: Setting::Threshold(1),
        }).unwrap();
        let entry = w.lab.create(sender, vault, vault, "room", &[], document("Scoped room", "first", sender)).unwrap();
        let history = w.lab.create(sender, vault, vault, "doc", &[], document("Unrelated", "withheld", sender)).unwrap();
        // The receiver may know this coop's authority, but the personal room's
        // authorization does not depend on it. Keep its newest edit withheld.
        let unrelated_vault = handbook.coop;
        w.lab.submit(sender, &[w.passkey_a, w.passkey_b], Action::Settings {
            vault: unrelated_vault, set: Setting::Threshold(1),
        }).unwrap();
        let opts = || Options { lazy: true, ..Options::local() };
        let mac = Node::spawn(w.lab.split(sender, &[], [156; 32]), sender, opts()).await.unwrap();
        let phone = Node::spawn(phone_lab, receiver, opts()).await.unwrap();
        phone.know(mac.addr()); mac.know(phone.addr());
        phone.shared.connection(mac.id()).await.unwrap();
        until(async || phone.holdings_of(sender).is_some_and(|h| h.logs.contains_key(&LogId::Entry(entry)))).await;
        let initial_missing = phone.shared.differ(sender).await;
        assert!(initial_missing.contains(&LogId::Vault(unrelated_vault)));
        assert!(initial_missing.contains(&LogId::Vault(related_reader)), "related wide reader frontier must start missing");
        let target_audience = LogId::Audience(vault, avendb::id::AudienceId::of(vault, &[]));
        assert!(initial_missing.contains(&target_audience), "creation introduces a related key dependency; do not preseed it");
        phone.shared.stage_live_entries(mac.id(), sender, [LogId::Entry(entry)].into_iter().collect());
        until(async || phone.read(move |lab, me| text(lab, me, entry, 2).as_deref() == Some("first")).await).await;
        assert!(!phone.shared.differ(sender).await.contains(&target_audience), "normal scoped transfer supplies the actual related key frontier");
        assert!(!phone.shared.differ(sender).await.contains(&LogId::Vault(related_reader)), "scoped dependency transfer supplies the reader's new authority without broad catch-up");
        assert!(phone.shared.differ(sender).await.contains(&LogId::Vault(unrelated_vault)));
        assert!(phone.read(move |lab, me| lab.item(me, history).is_none()).await);
        let written = mac.act(move |lab, me| lab.edit(me, vault, entry, |item| item.set_text(2, "live"))).await.unwrap();
        until(async || phone.holdings_of(sender).is_some_and(|h| h.logs.get(&LogId::Entry(entry)).is_some_and(|f| f.heads.contains(&written)))).await;
        phone.shared.stage_live_entries(mac.id(), sender, [LogId::Entry(entry)].into_iter().collect());
        until(async || phone.read(move |lab, me| text(lab, me, entry, 2).as_deref() == Some("live")).await).await;
        assert!(phone.shared.differ(sender).await.contains(&LogId::Vault(unrelated_vault)));
        assert!(phone.read(move |lab, me| lab.item(me, history).is_none()).await);
        mac.shutdown().await.unwrap(); phone.shutdown().await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn moved_shared_audience_room_and_live_owner_edit_skip_unrelated_history() {
        use avendb::{cast::{handbook, text, share, by_id}, policy::{Action, Setting, Who, Level}};
        let mut w = world();
        let handbook = handbook(&mut w);
        let (sender, receiver, vault) = (w.mac_a, w.phone_a, w.alice);
        let phone_lab = w.lab.split(receiver, &[], [161; 32]);
        let entry = w.lab.create(sender, vault, vault, "room", &[], document("Shared room", "first", sender)).unwrap();
        let audience_share = w.lab.issue(sender, &[sender], share(vault, Who::Vault(w.bob), Level::Read, by_id(entry))).unwrap();
        // Ordinary stewardship must really have moved this room; the fixture
        // does not fabricate an audience label or preseed any target evidence.
        assert!(w.lab.log(sender).edits().iter().any(|edit| matches!(&edit.action,
            Action::Mark { entry: e, caps: Some(caps), .. } if *e == entry && caps.contains(&audience_share))));
        let history = w.lab.create(sender, vault, vault, "doc", &[], document("Unrelated", "withheld", sender)).unwrap();
        let unrelated_vault = handbook.coop;
        w.lab.submit(sender, &[w.passkey_a, w.passkey_b], Action::Settings {
            vault: unrelated_vault, set: Setting::Threshold(1),
        }).unwrap();
        let opts = || Options { lazy: true, ..Options::local() };
        let mac = Node::spawn(w.lab.split(sender, &[], [162; 32]), sender, opts()).await.unwrap();
        let phone = Node::spawn(phone_lab, receiver, opts()).await.unwrap();
        phone.know(mac.addr()); mac.know(phone.addr());
        phone.shared.connection(mac.id()).await.unwrap();
        until(async || phone.holdings_of(sender).is_some_and(|h| h.logs.contains_key(&LogId::Entry(entry)))).await;
        let before = phone.shared.differ(sender).await;
        assert!(before.contains(&LogId::Share(audience_share)));
        assert!(before.contains(&LogId::Vault(unrelated_vault)));
        phone.shared.stage_live_entries(mac.id(), sender, [LogId::Entry(entry)].into_iter().collect());
        until(async || phone.read(move |lab, me| text(lab, me, entry, 2).as_deref() == Some("first")).await).await;
        assert!(!phone.shared.differ(sender).await.contains(&LogId::Share(audience_share)));
        assert!(phone.shared.differ(sender).await.contains(&LogId::Vault(unrelated_vault)));
        assert!(phone.read(move |lab, me| lab.item(me, history).is_none()).await);
        let written = mac.act(move |lab, me| lab.edit(me, vault, entry, |item| item.set_text(2, "live"))).await.unwrap();
        until(async || phone.holdings_of(sender).is_some_and(|h| h.logs.get(&LogId::Entry(entry)).is_some_and(|f| f.heads.contains(&written)))).await;
        phone.shared.stage_live_entries(mac.id(), sender, [LogId::Entry(entry)].into_iter().collect());
        until(async || phone.read(move |lab, me| text(lab, me, entry, 2).as_deref() == Some("live")).await).await;
        assert!(phone.shared.differ(sender).await.contains(&LogId::Vault(unrelated_vault)));
        assert!(phone.read(move |lab, me| lab.item(me, history).is_none()).await);
        mac.shutdown().await.unwrap(); phone.shutdown().await.unwrap();
    }

}
