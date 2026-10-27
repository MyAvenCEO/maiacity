//! Small changes on an established peer connection need not wait for that peer's whole history round. This is
//! local QoS only: the same authenticated differences, request permissions, signed records and receive path apply.
//! Initial/full inventories and overflow retain ordinary reconciliation. Interactive work uses the existing
//! bounded FIFO pull/page admissions; background work has its own bounded queue and cannot be overtaken forever.

use std::collections::BTreeSet;
use std::sync::Arc;

use avendb::id::{EditId, SignerId};
use avendb::sync::LogId;
use avendb::wire::Announce;
use iroh::EndpointId;
use n0_future::{
    task,
    time::{self, Duration},
};

use crate::traffic::{Live, LiveEnd, Stage};
use crate::{Holdings, Scope, Shared, jobs, pulls};

/// Bound one peer's interactive network attempt. An already admitted blocking validation may finish afterward;
/// ordinary ownership fences retain it. Normal reconciliation covers overflow/timeouts and keeps verified records.
const LIVE_WAIT: Duration = Duration::from_secs(10);

/// How long a live pull steps its view up to date (`materialize_live`) before it leaves the rest to the background
/// catch-up (`LivePriority.lean`'s `liveSteps`): it drained the whole pending catch-up, so during a bulk catch-up, or
/// one that never settled (batch 4's upkeep loop), the live lane never ended and held its peer's slot.
pub(crate) const LIVE_VIEW: Duration = Duration::from_millis(400);

/// A live pull's logs, claimed so that no backlog asking names them meanwhile (`Claims::live`, F12), and released as
/// it drops, however the pull ended: the peers its claim held back are asked again then.
struct LiveClaimed {
    shared: Arc<Shared>,
    logs: BTreeSet<LogId>,
}

impl LiveClaimed {
    fn new(shared: &Arc<Shared>) -> Self {
        LiveClaimed { shared: shared.clone(), logs: BTreeSet::new() }
    }

    fn claim(&mut self, logs: &BTreeSet<LogId>) {
        let fresh: BTreeSet<LogId> = logs.difference(&self.logs).copied().collect();
        if fresh.is_empty() { return; }
        self.shared.claims.lock().expect("claims").live(&fresh);
        self.logs.extend(fresh);
    }
}

impl Drop for LiveClaimed {
    fn drop(&mut self) {
        let again = self.shared.claims.lock().map(|mut c| c.live_done(&self.logs)).unwrap_or_default();
        for endpoint in again {
            self.shared.outreach.send(crate::node_loop::Msg::Ask { endpoint });
        }
    }
}

/// Where one live pull's time went, for `traffic::Live`.
#[derive(Default)]
struct LiveTiming {
    logs: u64,
    new: usize,
    differ_ms: u64,
    rules_ms: u64,
    pull_ms: u64,
    view_ms: u64,
    /// It lacked too many rule logs, or some still after taking them: the backlog brings the rest.
    backlog: bool,
    /// Its view was left to the background catch-up at `LIVE_VIEW`.
    left: bool,
}

fn ms(since: time::Instant) -> u64 {
    since.elapsed().as_millis() as u64
}

/// An unchanged frontier can be a causal witness accompanying a new edit. A duplicate-only frame must not
/// manufacture priority, and both changed logs and witnesses share the same bounded admission.
pub(crate) fn announced_hints(held: &Holdings, announce: &Announce) -> Vec<LogId> {
    if announce.full || announce.logs.len() > pulls::LIVE_LOGS
        || !announce.logs.iter().any(|(log, frontier)| held.logs.get(log) != Some(frontier))
    {
        return Vec::new();
    }
    announce.logs.iter().map(|(log, _)| *log).collect()
}

fn add_witness_hints(announce: &mut Announce, want: &Holdings, witnesses: impl IntoIterator<Item = LogId>) {
    if announce.full || announce.logs.is_empty() || announce.logs.len() >= pulls::LIVE_LOGS {
        return;
    }
    let mut named: BTreeSet<_> = announce.logs.iter().map(|(log, _)| *log).collect();
    for witness in witnesses {
        if announce.logs.len() >= pulls::LIVE_LOGS { break; }
        let Some(frontier) = want.logs.get(&witness) else { continue };
        if named.insert(witness) { announce.logs.push((witness, frontier.clone())); }
    }
    // Announce decoding requires canonical LogId order. Creation order does not order hashes;
    // move complete pairs so authorized frontiers and the bounded hint set remain unchanged.
    announce.logs.sort_by_key(|(log, _)| *log);
}

impl Shared {
    /// A first audience key can precede the newly announced entry while depending on an earlier creation in
    /// that audience. Repeat that creation's authorized frontier as a hint, so a live read needn't wait for all
    /// unrelated entries. Legacy peers accept the redundant frontier normally. Complex moved-audience histories
    /// still reconcile normally; this does not claim a general cross-log causal closure.
    pub(crate) async fn live_witnesses(self: &Arc<Self>, announce: &mut Announce, want: &Holdings) {
        if announce.full || announce.logs.len() >= pulls::LIVE_LOGS { return; }
        let entries: Vec<_> = announce.logs.iter().filter_map(|(log, _)| match log {
            LogId::Entry(entry) => Some(*entry),
            _ => None,
        }).collect();
        if entries.is_empty() { return; }
        let witnesses = self.read(move |lab, me| {
            let state = lab.state(me);
            let mut audiences: BTreeSet<_> = entries.iter().filter_map(|entry| {
                let en = state.entry(*entry)?;
                (en.stays.len() == 1).then_some((en.vault, en.audience()))
            }).collect();
            let mut witnesses = Vec::new();
            // This reads existing materialized metadata, never signed history or a new replay. Entries are in
            // creation order; stop as soon as each small hinted audience has its first creation witness.
            for en in state.entries() {
                if audiences.is_empty() { break; }
                let Some((_, original)) = en.stays.first() else { continue };
                if audiences.remove(&(en.vault, *original)) { witnesses.push(LogId::Entry(en.id)); }
            }
            witnesses
        }).await;
        // Permission-redacted outgoing holdings remain the only source of any disclosed witness frontier.
        add_witness_hints(announce, want, witnesses);
    }

    /// Called only after an authenticated announcement passed the existing holdings size gate. A full snapshot
    /// is backlog, not evidence of a newly edited log. The hints below are never copied into an authorization set.
    pub(crate) fn live_announced(self: &Arc<Self>, device: SignerId, full: bool, logs: &[LogId]) {
        if self.opts.lazy {
            return;
        }
        let Some(endpoint) = self.endpoint_of(device) else {
            return;
        };
        let Ok(activity) = self.admit() else { return };
        let Some(mut work) = self.pulls.live_announced(device, full, logs) else {
            return;
        };
        // claimed now, before the caller stirs the backlog, which would ask for the same logs (F12)
        let mut claimed = LiveClaimed::new(self);
        claimed.claim(&logs.iter().copied().collect());
        let shared = self.clone();
        task::spawn(async move {
            let _activity = activity;
            let began = time::Instant::now();
            let mut timing = LiveTiming::default();
            let attempt = time::timeout(LIVE_WAIT, async {
                while let Some(logs) = work.next() {
                    claimed.claim(&logs);
                    timing.logs += logs.len() as u64;
                    shared.pull_live(endpoint, device, logs, &mut timing).await?;
                }
                Ok::<(), anyhow::Error>(())
            })
            .await;
            let end = match &attempt {
                Ok(Ok(())) if timing.backlog => LiveEnd::Backlog,
                Ok(Ok(())) => LiveEnd::Done,
                Err(_) => LiveEnd::TimedOut,
                Ok(Err(_)) => LiveEnd::Failed,
            };
            if end != LiveEnd::Done {
                tracing::debug!(
                    ?attempt,
                    "avendb: live pull continues through normal reconciliation"
                );
            }
            // A timed-out waiter can have accepted a partial page. Materialize it through the ordinary path too.
            let viewing = time::Instant::now();
            shared.materialize_live(&mut timing).await;
            timing.view_ms += ms(viewing);
            shared.trace_taken(device, &claimed.logs, timing.left).await;
            drop(work);
            drop(claimed);
            shared.traffic.live(Live {
                device,
                at: jobs::now_ms(),
                logs: timing.logs,
                new: timing.new as u64,
                differ_ms: timing.differ_ms,
                rules_ms: timing.rules_ms,
                pull_ms: timing.pull_ms,
                view_ms: timing.view_ms,
                ms: ms(began),
                end,
                left: timing.left,
            });
        });
    }

    /// T1: the heads `device` announced of `logs` that this device holds now, traced as taken (`traffic::Stage`).
    async fn trace_taken(self: &Arc<Self>, device: SignerId, logs: &BTreeSet<LogId>, left: bool) {
        let heads: Vec<(LogId, EditId)> = {
            let held = self.held.lock().expect("held");
            let Some(theirs) = held.get(&device) else { return };
            logs.iter()
                .filter_map(|log| Some((log, theirs.logs.get(log)?)))
                .flat_map(|(log, frontier)| frontier.heads.iter().map(move |head| (*log, *head)))
                .collect()
        };
        if heads.is_empty() { return; }
        let taken = self.read(move |lab, me| {
            let log = lab.log(me);
            let (by, ids) = (log.by_log(), log.ids());
            heads.into_iter()
                .filter(|(l, e)| by.get(l).is_some_and(|at| at.iter().any(|&i| ids.get(i) == Some(e))))
                .map(|(_, e)| e)
                .collect::<Vec<_>>()
        }).await;
        self.traffic.trace(Stage::Taken, device, taken, left);
    }

    async fn materialize_live(self: &Arc<Self>, timing: &mut LiveTiming) {
        // At most LIVE_VIEW of it here; a step cut short is the Lab's own (each step one turn of it), so the background
        // catch-up, at most one at a time, goes on from where this one stopped.
        if time::timeout(LIVE_VIEW, self.catch_up_paced(true)).await.is_err() {
            timing.left = true;
            if !self.pulls.view_behind.swap(true, std::sync::atomic::Ordering::AcqRel)
                && let Ok(activity) = self.admit()
            {
                let shared = self.clone();
                task::spawn(async move {
                    let _activity = activity;
                    shared.catch_up_paced_class(true, crate::lab_schedule::Class::Background).await;
                    shared.pulls.view_behind.store(false, std::sync::atomic::Ordering::Release);
                    shared.jobs.stir();
                });
            }
        }
        // Receive can wake a subscriber before replay. pull_expected may then apply that replay before this
        // barrier, making this catch-up return false. Publish after the barrier in either case, so an earlier
        // receive wake cannot be the consumer's last notification of the newly materialized view.
        self.jobs.stir();
    }

    async fn pull_live(
        self: &Arc<Self>,
        endpoint: EndpointId,
        device: SignerId,
        hints: BTreeSet<LogId>,
        timing: &mut LiveTiming,
    ) -> anyhow::Result<()> {
        let at = time::Instant::now();
        let mut missing = self.differ(device).await;
        timing.differ_ms += ms(at);
        let rules: BTreeSet<_> = missing
            .iter()
            .filter(|log| !matches!(log, LogId::Entry(_)))
            .take(pulls::LIVE_LOGS + 1)
            .copied()
            .collect();
        // A large authorization catch-up belongs to the existing authority-first backlog scheduler. Never skip
        // it to prioritize a chat or treat the peer's hints as permission to materialize its entry.
        if rules.len() > pulls::LIVE_LOGS {
            timing.backlog = true;
            return Ok(());
        }
        if !rules.is_empty() {
            let at = time::Instant::now();
            timing.new += self.pull_expected(endpoint, Scope::Logs(rules), false, None, Some(device), None, None)
                .await?;
            self.materialize_live(timing).await;
            missing = self.differ(device).await;
            timing.rules_ms += ms(at);
            if missing.iter().any(|log| !matches!(log, LogId::Entry(_))) {
                timing.backlog = true;
                return Ok(());
            }
        }
        let logs = hints
            .intersection(&missing)
            .copied()
            .collect::<BTreeSet<_>>();
        if !logs.is_empty() {
            let at = time::Instant::now();
            timing.new += self.pull_expected(endpoint, Scope::Logs(logs), false, None, Some(device), None, None)
                .await?;
            timing.pull_ms += ms(at);
            // A single interactive edit must wake reactive subscribers before the unrelated backlog finishes.
            let at = time::Instant::now();
            self.materialize_live(timing).await;
            timing.view_ms += ms(at);
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "live_tests.rs"]
mod tests;
