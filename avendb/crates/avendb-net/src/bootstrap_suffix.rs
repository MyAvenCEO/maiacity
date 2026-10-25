//! Accepted-base suffixes are a separate request, never a history-coverage claim.
use super::*;
use avendb::{id::EntryId, wire::Wire};
pub(crate) const KIND: u8 = 22;
pub(crate) const LIMIT: usize = 66 + 32 * 32;
const RESPONSE: usize = 512 << 10;
const DEADLINE: Duration = Duration::from_secs(2);

const MAX_QUEUED: usize = 32;
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
struct SuffixKey(SignerId, EntryId, Option<(String, u64)>);
#[derive(Clone)]
struct SuffixWork {
    endpoint: EndpointId,
    device: SignerId,
    entry: EntryId,
    origin: Option<crate::demand::Origin>,
}
impl SuffixWork {
    fn key(&self) -> SuffixKey {
        SuffixKey(
            self.device,
            self.entry,
            self.origin.as_ref().map(|o| (o.scope.clone(), o.revision)),
        )
    }
    fn active(&self) -> bool {
        self.origin.as_ref().is_none_or(|o| o.active())
    }
}
struct SuffixJob {
    work: SuffixWork,
    running: bool,
    dirty: bool,
}
#[derive(Default)]
pub(crate) struct SuffixQueue {
    jobs: BTreeMap<SuffixKey, SuffixJob>,
    waiting: std::collections::VecDeque<SuffixKey>,
}
impl SuffixQueue {
    fn enqueue(&mut self, work: SuffixWork) -> bool {
        self.jobs.retain(|_, job| job.running || job.work.active());
        self.waiting.retain(|key| self.jobs.contains_key(key));
        if !work.active() {
            return false;
        }
        let key = work.key();
        if let Some(job) = self.jobs.get_mut(&key) {
            job.dirty |= job.running;
            job.work = work; // renewed lease or replacement connection
            return true;
        }
        // Reserve capacity for actual live announcements independently of views.
        let views = self.jobs.keys().filter(|k| k.2.is_some()).count();
        if self.jobs.len() >= MAX_QUEUED || (key.2.is_some() && views >= MAX_QUEUED / 2) {
            return false;
        }
        self.jobs.insert(
            key.clone(),
            SuffixJob {
                work,
                running: false,
                dirty: false,
            },
        );
        self.waiting.push_back(key);
        true
    }
    fn next(&mut self) -> Option<SuffixWork> {
        while let Some(key) = self.waiting.pop_front() {
            let Some(job) = self.jobs.get_mut(&key) else {
                continue;
            };
            if !job.work.active() {
                self.jobs.remove(&key);
                continue;
            }
            job.running = true;
            return Some(job.work.clone());
        }
        None
    }
    fn finish(&mut self, work: &SuffixWork) {
        let key = work.key();
        if let Some(job) = self.jobs.get_mut(&key) {
            if job.dirty && job.work.active() {
                job.running = false;
                job.dirty = false;
                self.waiting.push_back(key);
                return;
            }
        }
        self.jobs.remove(&key);
    }
}

fn request(bytes: &[u8]) -> Result<(EntryId, EditId, Vec<EditId>)> {
    anyhow::ensure!(
        bytes.len() >= 66 && bytes.len() <= LIMIT && bytes[0] == 1,
        "suffix request shape"
    );
    let n = bytes[65] as usize;
    anyhow::ensure!(n <= 32 && bytes.len() == 66 + n * 32, "suffix cursor bound");
    let seen: Vec<_> = bytes[66..]
        .chunks_exact(32)
        .map(|b| EditId(b.try_into().unwrap()))
        .collect();
    anyhow::ensure!(
        seen.iter().collect::<BTreeSet<_>>().len() == seen.len(),
        "duplicate suffix cursor"
    );
    Ok((
        EntryId(bytes[1..33].try_into().unwrap()),
        EditId(bytes[33..65].try_into().unwrap()),
        seen,
    ))
}
pub(crate) async fn answer(
    shared: &Arc<Shared>,
    peer: &Peer,
    bytes: &[u8],
    permit: Arc<tokio::sync::OwnedSemaphorePermit>,
) -> Result<Vec<u8>> {
    let (entry, snapshot, seen) = request(bytes)?;
    let requester = peer.device;
    let (revision, reply) = shared
        .try_lab(move |lab, me| {
            let _permit = permit;
            let revision = lab.log(me).revision();
            (
                revision,
                lab.owner_base_suffix_reply(me, requester, entry, snapshot, &seen),
            )
        })
        .await?;
    let reply = reply.context("suffix base not current or requester unauthorized")?;
    let bytes = reply.to_wire();
    anyhow::ensure!(bytes.len() <= RESPONSE, "suffix response bound");
    anyhow::ensure!(
        shared
            .read(move |lab, me| lab.log(me).revision() == revision)
            .await,
        "suffix authority changed"
    );
    Ok(bytes)
}
impl Shared {
    /// Every admitted entry is queued, even while both workers are occupied.
    /// Only returned IDs may leave the ordinary fallback lane.
    pub(crate) fn schedule_owner_suffixes(
        self: &Arc<Self>,
        endpoint: EndpointId,
        device: SignerId,
        logs: &[LogId],
        origin: Option<crate::demand::Origin>,
    ) -> BTreeSet<EntryId> {
        let mut queue = self.owner_suffix_queue.lock().expect("owner suffix queue");
        let mut scheduled = BTreeSet::new();
        for log in logs.iter().take(pulls::LIVE_LOGS) {
            let LogId::Entry(entry) = *log else { continue };
            if queue.enqueue(SuffixWork {
                endpoint,
                device,
                entry,
                origin: origin.clone(),
            }) {
                scheduled.insert(entry);
            }
        }
        for _ in 0..2 {
            if queue.waiting.is_empty() {
                break;
            }
            let Ok(permit) = self.owner_suffixes.clone().try_acquire_owned() else {
                break;
            };
            let Ok(activity) = self.admit() else { break };
            let shared = self.clone();
            task::spawn(async move {
                let _activity = activity;
                loop {
                    let work = {
                        let mut queue = shared
                            .owner_suffix_queue
                            .lock()
                            .expect("owner suffix queue");
                        match queue.next() {
                            Some(work) => work,
                            None => {
                                // Release admission while holding the queue lock:
                                // enqueue cannot miss the last worker's exit.
                                drop(permit);
                                return;
                            }
                        }
                    };
                    if let Some(peer) = shared
                        .live(work.endpoint)
                        .filter(|p| p.device == work.device)
                    {
                        let attempt = time::timeout(
                            Duration::from_secs(4),
                            shared.try_owner_base_suffix(&peer, work.entry, work.origin.clone()),
                        );
                        if let Some(origin) = &work.origin {
                            let _ = origin.run(attempt).await;
                        } else {
                            let _ = attempt.await;
                        }
                    }
                    shared
                        .owner_suffix_queue
                        .lock()
                        .expect("owner suffix queue")
                        .finish(&work);
                }
            });
        }
        scheduled
    }
    pub(crate) async fn try_owner_base_suffix(
        self: &Arc<Self>,
        peer: &Peer,
        entry: EntryId,
        origin: Option<crate::demand::Origin>,
    ) -> Result<bool> {
        if origin.as_ref().is_some_and(|o| !o.active()) {
            return Ok(false);
        }
        let shared = self.clone();
        let base = self
            .read(move |lab, me| {
                let base = lab.owner_base_scope(me, entry)?;
                let log = lab.log(me);
                let indexed = shared.logs_of(lab, me);
                let seen = indexed
                    .of
                    .get(&LogId::Entry(entry))
                    .map(|l| {
                        l.edits
                            .iter()
                            .rev()
                            .take(32)
                            .map(|&at| log.ids()[at])
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                Some((base, seen))
            })
            .await;
        let Some((base, seen)) = base else {
            return Ok(false);
        };
        let device = peer.device;
        let connection = peer.conn.stable_id();
        let inventory = {
            let _held = self.held.lock().expect("held");
            self.ranges
                .lock()
                .expect("ranges")
                .complete_inventory(connection, device)
        };
        if inventory.is_none() {
            return Ok(false);
        }
        let snapshot = base.snapshot();
        let mut bytes = vec![1];
        bytes.extend(entry.0);
        bytes.extend(snapshot.0);
        bytes.push(seen.len() as u8);
        for id in &seen {
            bytes.extend(id.0);
        }
        let permit = time::timeout(DEADLINE, self.pulls.page(false, true)).await??;
        let reply = time::timeout(
            DEADLINE,
            session::exchange(&peer.conn, KIND, &bytes, RESPONSE),
        )
        .await??;
        let reply = Reply::from_wire(&reply)?;
        anyhow::ensure!(
            !reply.more && reply.blobs.is_empty() && reply.edits.len() <= 64,
            "suffix exceeds bounded accepted cut"
        );
        anyhow::ensure!(
            reply
                .edits
                .iter()
                .all(|s| avendb::sync::log_of(&s.edit, s.edit.id()) == Some(LogId::Entry(entry))),
            "foreign suffix entry"
        );
        let Some(owner) = authority_classes::OwnerEntry::from_base(&base, entry, &reply.edits)
        else {
            return Ok(false);
        };
        #[cfg(not(target_arch = "wasm32"))]
        let (prepared, permit, activity, ()) = self
            .prepare_received_page(
                reply.edits,
                permit,
                (),
                #[cfg(test)]
                None,
            )
            .await?;
        #[cfg(target_arch = "wasm32")]
        let (prepared, permit, activity, ()) =
            self.prepare_received_page(reply.edits, permit, ()).await?;
        drop(permit);
        let grant_ids = self
            .held
            .lock()
            .expect("held")
            .get(&device)
            .map(|h| {
                h.logs
                    .keys()
                    .filter_map(|l| match l {
                        LogId::Share(id) => Some(*id),
                        _ => None,
                    })
                    .collect()
            })
            .unwrap_or_default();
        let Some(classes) = self.grant_classes(peer, grant_ids).await else {
            return Ok(false);
        };
        let (owner, classes) = (Arc::new(owner), Arc::new(classes));
        let mut previous = BTreeSet::new();
        for _ in 0..4 {
            let (shared, owner, classes) = (self.clone(), owner.clone(), classes.clone());
            let missing = self
                .read(move |lab, me| {
                    let held = shared.held.lock().expect("held");
                    let current = held.get(&device)?;
                    let ranges = shared.ranges.lock().expect("ranges");
                    if inventory != ranges.complete_inventory(connection, device) {
                        return None;
                    }
                    if lab.owner_base_scope(me, entry)?.snapshot() != snapshot {
                        return None;
                    }
                    let log = lab.log(me);
                    let indexed = shared.logs_of(lab, me);
                        let provenance = lab.authority_provenance(me);
                    classes
                        .owner_dependencies_provenance(
                            &owner,
                            log.edits(),
                            log.ids(),
                            &indexed,
                            current,
                            |id| provenance.get(&id).cloned(),
                        )
                        .map(|d| d.missing)
                })
                .await;
            let Some(missing) = missing else {
                return Ok(false);
            };
            if missing.is_empty() || missing == previous {
                break;
            }
            previous = missing.clone();
            self.pull_expected(
                peer.endpoint,
                Scope::Logs(missing),
                false,
                None,
                Some(device),
            )
            .await?;
        }
        // Existing current dependency closure is the release gate. Missing
        // dependencies remain ordinary authorized work; no base can override it.
        let shared = self.clone();
        let admitted = self
            .try_lab(move |lab, me| {
                let _activity = activity;
                let demands = origin
                    .as_ref()
                    .map(|_| shared.demands.lock().expect("demands"));
                if origin
                    .as_ref()
                    .zip(demands.as_ref())
                    .is_some_and(|(o, ds)| {
                        !ds.current(&o.scope, o.revision, n0_future::time::Instant::now())
                    })
                {
                    return false;
                }
                let held = shared.held.lock().expect("held");
                let Some(current) = held.get(&device) else {
                    return false;
                };
                let ranges = shared.ranges.lock().expect("ranges");
                if inventory != ranges.complete_inventory(connection, device) {
                    return false;
                }
                let Some(now) = lab.owner_base_scope(me, entry) else {
                    return false;
                };
                // A concurrent local move/write can change the accepted overlay
                // without replacing its original snapshot. Fence the entire bounded
                // dependency summary, not merely that snapshot ID.
                if now != base {
                    return false;
                }
                let log = lab.log(me);
                let indexed = shared.logs_of(lab, me);
                        let provenance = lab.authority_provenance(me);
                if classes
                    .owner_scope_provenance(&owner, log.edits(), log.ids(), &indexed, current, |id| {
                        provenance.get(&id).cloned()
                    })
                    .is_none()
                {
                    return false;
                }
                lab.receive_prepared(me, prepared, true);
                true
            })
            .await?;
        if admitted {
            self.bootstrap_due.notify_one();
            self.jobs.stir();
        }
        Ok(admitted)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn work(n: u8) -> SuffixWork {
        SuffixWork {
            endpoint: iroh::SecretKey::from_bytes(&[1; 32]).public(),
            device: SignerId([1; 32]),
            entry: EntryId([n; 32]),
            origin: None,
        }
    }
    #[test]
    fn occupied_workers_retain_every_pending_suffix_and_drain_in_order() {
        let mut q = SuffixQueue::default();
        for n in 0..6 {
            assert!(q.enqueue(work(n)));
        }
        let a = q.next().unwrap();
        let b = q.next().unwrap();
        assert_eq!(a.entry, work(0).entry);
        assert_eq!(b.entry, work(1).entry);
        assert!(q.enqueue(work(6)));
        q.finish(&a);
        q.finish(&b);
        for n in 2..7 {
            let w = q.next().unwrap();
            assert_eq!(w.entry, work(n).entry);
            q.finish(&w);
        }
        assert!(q.next().is_none());
        assert!(q.jobs.is_empty());
    }
    #[test]
    fn repeated_running_suffix_moves_behind_older_pending_work() {
        let mut q = SuffixQueue::default();
        assert!(q.enqueue(work(1)));
        let a = q.next().unwrap();
        assert!(q.enqueue(work(2)));
        assert!(q.enqueue(work(1)));
        assert!(q.enqueue(work(1)));
        q.finish(&a);
        let b = q.next().unwrap();
        assert_eq!(b.entry, work(2).entry);
        q.finish(&b);
        let a = q.next().unwrap();
        assert_eq!(a.entry, work(1).entry);
        q.finish(&a);
        assert!(q.next().is_none());
    }
    #[test]
    fn full_suffix_queue_refuses_instead_of_losing_fallback() {
        let mut q = SuffixQueue::default();
        for n in 0..MAX_QUEUED {
            assert!(q.enqueue(work(n as u8)));
        }
        assert!(!q.enqueue(work(99)));
        assert_eq!(q.jobs.len(), MAX_QUEUED);
        let a = q.next().unwrap();
        q.finish(&a);
        assert!(q.enqueue(work(99)));
    }
    #[test]
    fn cancelled_view_suffix_does_not_cancel_same_entry_live_work() {
        let mut d = crate::demand::Demands::default();
        let now = n0_future::time::Instant::now();
        d.replace("view".into(), 1, vec![], now).unwrap();
        let mut view = work(1);
        view.origin = d.origin("view", 1, now);
        let mut q = SuffixQueue::default();
        assert!(q.enqueue(view));
        assert!(q.enqueue(work(1)));
        d.replace("view".into(), 2, vec![], now).unwrap();
        let w = q.next().unwrap();
        assert!(w.origin.is_none());
        q.finish(&w);
        assert!(q.next().is_none());
        assert!(q.jobs.is_empty());
    }
    #[test]
    fn suffix_request_carries_base_separately_and_is_bounded() {
        let mut b = vec![1];
        b.extend([7; 32]);
        b.extend([8; 32]);
        b.push(0);
        assert_eq!(
            request(&b).unwrap(),
            (EntryId([7; 32]), EditId([8; 32]), vec![])
        );
        b[65] = 33;
        assert!(request(&b).is_err());
        b[0] = 0;
        assert!(request(&b).is_err());
    }
}
