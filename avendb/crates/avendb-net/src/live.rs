//! Small changes on an established peer connection need not wait for that peer's whole history round. This is
//! local QoS only: the same authenticated differences, request permissions, signed records and receive path apply.
//! Initial/full inventories and overflow retain ordinary reconciliation. Interactive work uses the existing
//! bounded FIFO pull/page admissions; background work has its own bounded queue and cannot be overtaken forever.

use std::collections::BTreeSet;
use std::sync::Arc;

use avendb::id::SignerId;
use avendb::sync::LogId;
use avendb::wire::Announce;
use iroh::EndpointId;
use n0_future::{
    task,
    time::{self, Duration},
};

use crate::{Holdings, Scope, Shared, pulls};

/// Bound one peer's interactive network attempt. An already admitted blocking validation may finish afterward;
/// ordinary ownership fences retain it. Normal reconciliation covers overflow/timeouts and keeps verified records.
const LIVE_WAIT: Duration = Duration::from_secs(10);

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
        let Some(mut work) = self.pulls.live_announced(device, full, logs) else {
            return;
        };
        let Ok(activity) = self.admit() else { return };
        let shared = self.clone();
        task::spawn(async move {
            let _activity = activity;
            let attempt = time::timeout(LIVE_WAIT, async {
                while let Some(logs) = work.next() {
                    shared.pull_live(endpoint, device, logs).await?;
                }
                Ok::<(), anyhow::Error>(())
            })
            .await;
            if !matches!(attempt, Ok(Ok(()))) {
                tracing::debug!(
                    ?attempt,
                    "avendb: live pull continues through normal reconciliation"
                );
            }
            // A timed-out waiter can have accepted a partial page. Materialize it through the ordinary path too.
            shared.materialize_live().await;
            drop(work);
        });
    }

    async fn materialize_live(self: &Arc<Self>) {
        self.catch_up_paced(true).await;
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
    ) -> anyhow::Result<()> {
        let mut missing = self.differ(device).await;
        let rules: BTreeSet<_> = missing
            .iter()
            .filter(|log| !matches!(log, LogId::Entry(_)))
            .take(pulls::LIVE_LOGS + 1)
            .copied()
            .collect();
        // A large authorization catch-up belongs to the existing authority-first backlog scheduler. Never skip
        // it to prioritize a chat or treat the peer's hints as permission to materialize its entry.
        if rules.len() > pulls::LIVE_LOGS {
            return Ok(());
        }
        if !rules.is_empty() {
            self.pull_expected(endpoint, Scope::Logs(rules), false, None, Some(device))
                .await?;
            self.materialize_live().await;
            missing = self.differ(device).await;
            if missing.iter().any(|log| !matches!(log, LogId::Entry(_))) {
                return Ok(());
            }
        }
        let logs = hints
            .intersection(&missing)
            .copied()
            .collect::<BTreeSet<_>>();
        if !logs.is_empty() {
            self.pull_expected(endpoint, Scope::Logs(logs), false, None, Some(device))
                .await?;
            // A single interactive edit must wake reactive subscribers before the unrelated backlog finishes.
            self.materialize_live().await;
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "live_tests.rs"]
mod tests;
