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

/// The most rule logs an asking of an Interest's now tier takes beside its entries (`Shared::ask_now`): with its
/// `LIVE_LOGS` entries, fewer than 64 logs in all, asked before any page of the backlog. More rules than these are the
/// backlog's to bring, as a live pull's are past `LIVE_LOGS`.
const NOW_RULES: usize = 32;

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

/// A `bring`'s Interest (`Shared::bring_now`), dropped with it however the bring ended.
struct Brought {
    shared: Arc<Shared>,
    scope: String,
}

impl Drop for Brought {
    fn drop(&mut self) {
        self.shared.interests_changed(|interests| interests.remove(&self.scope));
    }
}

/// Where one live pull's time went, for `traffic::Live`.
#[derive(Default)]
struct LiveTiming {
    logs: u64,
    new: usize,
    differ_ms: u64,
    rules: u64,
    pull_ms: u64,
    view_ms: u64,
    /// It lacked more rule logs than a live pull takes: the backlog brings them.
    backlog: bool,
    /// Its view was left to the background catch-up at `LIVE_VIEW`.
    left: bool,
    /// The logs its last asking named (`pull_live_logs`), till they are reported.
    asked: Option<BTreeSet<LogId>>,
}

/// What an asking of an Interest's now tier came to (`Shared::ask_now`): how many live peers it asked, how many edits
/// were new, and whether every one of those peers answered whole.
#[derive(Default)]
pub(crate) struct AskedNow {
    pub peers: usize,
    pub new: usize,
    pub whole: bool,
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

/// Of the logs `announce` hints, those whose frontier it repeats unchanged: witnesses (`add_witness_hints`), and how
/// they were, as against those it changed.
pub(crate) fn unchanged(held: &Holdings, announce: &Announce, hinted: &[LogId]) -> Vec<(LogId, bool)> {
    announce.logs.iter().filter(|(log, _)| hinted.contains(log))
        .map(|(log, frontier)| (*log, held.logs.get(log) == Some(frontier))).collect()
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

/// The rules entries `entries` rest on, by `st`: each one's vault's log and those of the vaults that own it, up the
/// chains, the logs of the audiences it stood in and their shares' logs with the shares those rest on, and those of
/// the shares that took it in. An entry `st` doesn't know yet rests on any vault's log it knows: those are few, and an
/// audience's or a share's it names only once its creation came.
pub(crate) fn rests_on(st: &avendb::policy::State, entries: &[LogId]) -> BTreeSet<LogId> {
    let mut out = BTreeSet::new();
    let mut vaults = Vec::new();
    let share = |out: &mut BTreeSet<LogId>, c: avendb::id::ShareId| {
        out.insert(LogId::Share(c));
        if let Some(cp) = st.share(c) {
            out.extend(cp.chain.iter().map(|c| LogId::Share(*c)));
        }
    };
    for log in entries {
        let LogId::Entry(e) = log else { continue };
        let Some(en) = st.entry(*e) else {
            vaults.extend(st.vaults().iter().map(|v| v.id));
            continue;
        };
        vaults.push(en.vault);
        for (_, x) in &en.stays {
            out.insert(LogId::Audience(en.vault, *x));
            for c in st.audience_shares(*x).unwrap_or_default() {
                share(&mut out, *c);
            }
        }
        for c in &en.intake {
            share(&mut out, *c);
        }
    }
    while let Some(v) = vaults.pop() {
        if !out.insert(LogId::Vault(v)) {
            continue;
        }
        if let Some(vt) = st.vault(v) {
            vaults.extend(vt.owners.iter().filter_map(|p| match p {
                avendb::policy::Principal::Vault(o) => Some(*o),
                _ => None,
            }));
        }
    }
    out
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
        let Some(mut work) = self.pulls.live_announced(device, full, logs, &self.views_want()) else {
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
                // what the open views want first, each round (`wanted_go_first`)
                while let Some(logs) = work.next(&shared.views_want()) {
                    claimed.claim(&logs);
                    timing.logs += logs.len() as u64;
                    shared.pull_live(endpoint, device, logs, pulls::LIVE_LOGS, &mut timing).await?;
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
                rules: timing.rules,
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
        // At most LIVE_VIEW of it here, the pages stirred after each step: no step is begun after it (each step one
        // turn of the Lab), and the background catch-up, at most one at a time, goes on from where this one stopped.
        let until = time::Instant::now() + LIVE_VIEW;
        let (_, left) = self.catch_up_steps(true, crate::lab_schedule::Class::Foreground, Some(until)).await;
        if left {
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

    /// An Interest's now tier came to want `logs` (`Shared::change_interests`): asked at once of every live peer that
    /// holds more of them than this device, with the rules they rest on, `LIVE_LOGS` entries an asking, alone and
    /// outside the backlog's turn as a live pull is (`Claims::live`), so a view's own logs come before any bulk page
    /// (Lean `Interest.lean`'s `asksNow`). A peer that holds no more of them is asked nothing. Ends once every such
    /// asking ended. A lazy node asks so only for a `bring`, as it asks its peers only when told.
    pub(crate) async fn ask_now(self: &Arc<Self>, logs: BTreeSet<LogId>) -> AskedNow {
        if logs.is_empty() {
            return AskedNow::default();
        }
        let peers: Vec<(EndpointId, SignerId)> = self.peers.lock().expect("peers").values()
            .filter(|p| p.conn.close_reason().is_none()).map(|p| (p.endpoint, p.device)).collect();
        let mut asks = vec![];
        for (endpoint, device) in peers {
            let Ok(activity) = self.admit() else { break };
            let (shared, logs) = (self.clone(), logs.clone());
            asks.push(task::spawn(async move {
                let _activity = activity;
                shared.ask_now_of(endpoint, device, logs).await
            }));
        }
        let peers = asks.len();
        let (mut new, mut whole) = (0, peers > 0);
        for ask in crate::blind::join_all(asks).await {
            match ask {
                Ok(Ok((got, backlog))) => { new += got; whole &= !backlog; }
                _ => whole = false,
            }
        }
        AskedNow { peers, new, whole }
    }

    /// `device` stated all it holds (a full announcement: it connected): what the views want now is asked of it at once
    /// (`ask_now`), alone and before its backlog's askings (Lean `Interest.lean`'s `asksNow`, of a peer new to the
    /// device): the views' logs then come from it before any bulk page.
    pub(crate) fn ask_now_of_device(self: &Arc<Self>, device: SignerId) {
        if self.opts.lazy { return; }
        let now = self.interests.lock().expect("interests").now();
        let Some(endpoint) = self.endpoint_of(device) else { return };
        if now.is_empty() { return; }
        let Ok(activity) = self.admit() else { return };
        let shared = self.clone();
        task::spawn(async move {
            let _activity = activity;
            let _ = shared.ask_now_of(endpoint, device, now).await;
        });
    }

    /// `ask_now` of the peer at `endpoint`, `device`: how many edits were new, and whether it left rules to the backlog.
    async fn ask_now_of(self: &Arc<Self>, endpoint: EndpointId, device: SignerId, logs: BTreeSet<LogId>) -> anyhow::Result<(usize, bool)> {
        let mut claimed = LiveClaimed::new(self);
        let mut timing = LiveTiming::default();
        let logs: Vec<LogId> = logs.into_iter().collect();
        for chunk in logs.chunks(pulls::LIVE_LOGS) {
            let hints: BTreeSet<LogId> = chunk.iter().copied().collect();
            claimed.claim(&hints);
            let (began, at) = (time::Instant::now(), jobs::now_ms());
            let new = timing.new;
            let got = time::timeout(LIVE_WAIT, self.pull_live(endpoint, device, hints, NOW_RULES, &mut timing)).await
                .unwrap_or_else(|_| Err(anyhow::anyhow!("its now tier took longer than {LIVE_WAIT:?}")));
            if let Some(asked) = timing.asked.take() {
                self.traffic.asking(crate::traffic::Asking {
                    device,
                    at,
                    stage: "now",
                    logs: asked.len(),
                    first: asked.iter().take(8).map(crate::traffic::log_name).collect(),
                    wanted: chunk.len(),
                    wants: logs.len(),
                    ms: ms(began),
                    new: (timing.new - new) as u64,
                    yielded: false,
                    failed: got.is_err(),
                });
            }
            got?;
        }
        Ok((timing.new, timing.backlog))
    }

    /// `bring`: the entries `logs` a page reads now, an Interest of their own on screen now while they are asked
    /// (`ask_now`), dropped once those askings ended.
    pub(crate) async fn bring_now(self: &Arc<Self>, logs: BTreeSet<LogId>) -> AskedNow {
        use std::sync::atomic::Ordering;
        let scope = format!("bring {}", self.brings.fetch_add(1, Ordering::Relaxed));
        let want = crate::interest::Want { tier: crate::interest::Tier::Now, entries: logs.iter().copied().collect(), queries: vec![] };
        // a scope of its own at its first revision, of at most `MOST_BROUGHT` entries: never refused
        let _accepted = self.interests_changed(|interests| interests.replace(scope.clone(), 1, vec![want]));
        let _brought = Brought { shared: self.clone(), scope };
        self.ask_now(logs).await
    }

    /// The hinted `logs` a live pull asks (`LivePriority.lean` `inStep`): every log the announcement changed, and a
    /// witness only if this device holds none of it. A witness is an earlier entry's log, named for its creation alone
    /// (`live_witnesses`); asked of a device that holds that creation, it brought the rest of that log, the backlog, with
    /// the change (`bench_live` phone: one chat edit's pull carried 86 bulk edits, 2.0 s). The backlog asks it once this
    /// pull ends (`Claims::live_done`).
    async fn in_step(self: &Arc<Self>, device: SignerId, logs: BTreeSet<LogId>) -> BTreeSet<LogId> {
        let witnesses = self.pulls.take_witnesses(device, &logs);
        if witnesses.is_empty() {
            return logs;
        }
        let shared = self.clone();
        self.try_lab(move |lab, me| {
            let mine = shared.logs_of(lab, me);
            logs.into_iter().filter(|log| !witnesses.contains(log) || !mine.of.contains_key(log)).collect()
        })
        .await
        .unwrap_or_default()
    }

    async fn pull_live(
        self: &Arc<Self>,
        endpoint: EndpointId,
        device: SignerId,
        hints: BTreeSet<LogId>,
        most_rules: usize,
        timing: &mut LiveTiming,
    ) -> anyhow::Result<()> {
        let at = time::Instant::now();
        let missing = self.differ(device).await;
        timing.differ_ms += ms(at);
        // the rules the hinted entries rest on (`rests_on`), those it lacks: not every rule the device lacks, which a
        // device catching up a history of many grants always lacks more than `LIVE_LOGS` of, so a chat message waited
        // for the whole backlog (24.8 s, 2026-10-28). A hint is no permission: what comes is checked as any edit, and
        // an edit whose authority hasn't come yet doesn't stand till it does.
        let entries: Vec<_> = hints.iter().filter(|log| matches!(log, LogId::Entry(_))).copied().collect();
        let rests = self.read(move |lab, me| rests_on(lab.state(me), &entries)).await;
        let rules: BTreeSet<_> = missing
            .iter()
            .filter(|log| !matches!(log, LogId::Entry(_)) && rests.contains(log))
            .take(most_rules + 1)
            .copied()
            .collect();
        // More rules than a live pull takes belong to the existing authority-first backlog scheduler.
        if rules.len() > most_rules {
            timing.backlog = true;
            return Ok(());
        }
        // the rules and the hinted logs in one asking, which the peer answers in the order the edits came
        // (`sync::place`), each rule before what rests on it: asked first on their own, they were a moving target, a
        // device catching up writing its key upkeep on the very audience logs a chat entry rests on, which the Mac
        // chased 1.3 s and then left the message to the backlog
        let mut logs = self.in_step(device, hints.intersection(&missing).copied().collect()).await;
        timing.rules = rules.len() as u64;
        logs.extend(rules);
        if logs.is_empty() {
            return Ok(());
        }
        self.pull_live_logs(endpoint, device, logs, timing).await
    }

    /// Pulls `logs` of `device` live, and shows what they bring a step at once (`materialize_live`).
    async fn pull_live_logs(
        self: &Arc<Self>,
        endpoint: EndpointId,
        device: SignerId,
        logs: BTreeSet<LogId>,
        timing: &mut LiveTiming,
    ) -> anyhow::Result<()> {
        let at = time::Instant::now();
        timing.asked = Some(logs.clone());
        timing.new += self.pull_expected(endpoint, Scope::Logs(logs), false, None, Some(device), None, None).await?;
        timing.pull_ms += ms(at);
        // A single interactive edit must wake reactive subscribers before the unrelated backlog finishes.
        let at = time::Instant::now();
        self.materialize_live(timing).await;
        timing.view_ms += ms(at);
        Ok(())
    }
}

#[cfg(test)]
#[path = "live_tests.rs"]
mod tests;
