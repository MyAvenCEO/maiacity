//! The node actor (sync v2, P7; `spec/AvenDB/NodeActor.lean`): one task owns the node's outreach to its peers, the
//! telling of its holdings and the asking for theirs, which used to sit behind four shared locks (`telling`,
//! `unreached`, `asking`, `owed`) and an announcer that looked every `retry`. Callers send it messages and never wait
//! on it; it starts each attempt on a task of its own, which reports back when it ends; and it sleeps until the
//! earliest lane is due, never polling.
//!
//! A lane's steps (`Lane::wake`, `finish`, `tick`, `reach`) are the Lean model's, over the milliseconds since the
//! actor started, so they are a function of the messages a lane takes and the time it took them at.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use avendb::id::SignerId;
use iroh::EndpointId;
use n0_future::task;
use n0_future::time::{self, Instant};
use tokio::sync::mpsc;

use crate::{BACKOFF_MAX, Shared};

/// One peer's lane: an attempt in flight, a wake owed to it, a wake waiting for the backoff, the failures in a row and
/// the moment (ms) the lane may try again (`NodeActor.Lane`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Lane {
    pub busy: bool,
    pub owed: bool,
    pub pending: bool,
    pub failures: u32,
    pub due_at: u64,
}

/// After `n` failures in a row, `retry` doubled `n` times (16 at most), `BACKOFF_MAX` at most (`NodeActor.wait`).
pub(crate) fn wait(retry: Duration, n: u32) -> u64 {
    let max = BACKOFF_MAX.as_millis() as u64;
    (retry.as_millis() as u64).saturating_mul(1 << n.min(16)).min(max)
}

impl Lane {
    /// A wake at `now`: whether an attempt starts; else it is owed to the one in flight, or waits for the backoff.
    pub fn wake(&mut self, now: u64) -> bool {
        if self.busy {
            self.owed = true;
            false
        } else if now < self.due_at {
            self.pending = true;
            false
        } else {
            (self.busy, self.owed, self.pending) = (true, false, false);
            true
        }
    }

    /// The attempt in flight ended at `now`: a success clears the backoff, a failure waits longer, and the lane wakes
    /// again by the timer if a wake was owed or the attempt failed.
    pub fn finish(&mut self, now: u64, retry: Duration, ok: bool) {
        let due_at = if ok { now } else { now.saturating_add(wait(retry, self.failures)) };
        *self = Lane {
            busy: false,
            owed: false,
            pending: self.owed || !ok,
            failures: if ok { 0 } else { self.failures.saturating_add(1) },
            due_at,
        };
    }

    /// The timer at `now`: a waiting lane whose wait is over wakes.
    pub fn tick(&mut self, now: u64) -> bool {
        if self.pending && self.due_at <= now {
            self.pending = false;
            self.wake(now)
        } else {
            false
        }
    }

    /// The peer was reached another way (a connection whose hello proved it): no more waiting.
    pub fn reach(&mut self) {
        (self.failures, self.due_at) = (0, 0);
    }

    /// When the actor must wake next for this lane, if at all.
    pub fn due(&self) -> Option<u64> {
        (self.pending && !self.busy).then_some(self.due_at)
    }

    /// Nothing in flight, nothing waiting and no backoff: the lane can go.
    fn idle(&self) -> bool {
        !self.busy && !self.pending && self.failures == 0
    }
}

/// What the actor is told.
#[derive(Debug)]
pub(crate) enum Msg {
    /// Tell `device`, at `endpoint`, of the node's holdings (the announcer found them due).
    Tell { device: SignerId, endpoint: EndpointId },
    /// The telling of `device` ended.
    Told { device: SignerId, ok: bool },
    /// Ask `endpoint` for what it holds that the node lacks (`Shared::ask_soon`).
    Ask { endpoint: EndpointId },
    /// The asking of `endpoint` ended.
    Asked { endpoint: EndpointId, ok: bool },
    /// A connection's hello proved `device`.
    Reached { device: SignerId },
    /// A test's look at the lanes.
    #[cfg(test)]
    Look(tokio::sync::oneshot::Sender<Look>),
}

/// The lanes as a test sees them.
#[cfg(test)]
#[derive(Debug, Clone, Default)]
pub(crate) struct Look {
    pub tells: BTreeMap<SignerId, Lane>,
    pub asks: BTreeMap<EndpointId, Lane>,
}

/// Where callers send the actor messages. Sending never waits; a message to an actor that ended is dropped, as the
/// node is shutting down.
#[derive(Clone, Debug)]
pub(crate) struct Outreach(mpsc::UnboundedSender<Msg>);

impl Outreach {
    pub fn send(&self, msg: Msg) {
        let _ = self.0.send(msg);
    }

    #[cfg(test)]
    pub async fn look(&self) -> Look {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.send(Msg::Look(tx));
        rx.await.unwrap_or_default()
    }
}

/// The actor's two ends: the handle for `Shared`, and the inbox its task takes.
pub(crate) fn outreach() -> (Outreach, mpsc::UnboundedReceiver<Msg>) {
    let (tx, rx) = mpsc::unbounded_channel();
    (Outreach(tx), rx)
}

/// The actor's state: a lane per device told and per endpoint asked, with where each telling goes.
#[derive(Default)]
struct Lanes {
    tells: BTreeMap<SignerId, (Lane, EndpointId)>,
    asks: BTreeMap<EndpointId, Lane>,
}

impl Lanes {
    /// The earliest moment a lane is due, if any is waiting.
    fn next(&self) -> Option<u64> {
        let tells = self.tells.values().filter_map(|(lane, _)| lane.due());
        tells.chain(self.asks.values().filter_map(Lane::due)).min()
    }

    /// Forget lanes with nothing left, so the maps hold only peers in flight, waiting or backing off.
    fn tidy(&mut self) {
        self.tells.retain(|_, (lane, _)| !lane.idle());
        self.asks.retain(|_, lane| !lane.idle());
    }
}

/// What woke the actor.
enum Step {
    Msg(Msg),
    Tick,
}

/// The actor's task: one message at a time, then the lanes whose wait is over, then sleep until the next is due or a
/// message comes. The node aborts it as it shuts down (`Node::begin_close`), between two steps.
pub(crate) async fn run(shared: Arc<Shared>, mut inbox: mpsc::UnboundedReceiver<Msg>) {
    let (start, retry) = (Instant::now(), shared.opts.retry);
    let mut lanes = Lanes::default();
    loop {
        let step = match lanes.next() {
            Some(at) => match time::timeout((start + Duration::from_millis(at)).saturating_duration_since(Instant::now()), inbox.recv()).await {
                Ok(Some(msg)) => Step::Msg(msg),
                Ok(None) => return,
                Err(_) => Step::Tick,
            },
            None => match inbox.recv().await {
                Some(msg) => Step::Msg(msg),
                None => return,
            },
        };
        let now = start.elapsed().as_millis() as u64;
        match step {
            Step::Msg(Msg::Tell { device, endpoint }) => {
                let (lane, at) = lanes.tells.entry(device).or_insert((Lane::default(), endpoint));
                *at = endpoint;
                if lane.wake(now) {
                    tell(&shared, device, endpoint);
                }
            }
            Step::Msg(Msg::Told { device, ok }) => {
                if let Some((lane, _)) = lanes.tells.get_mut(&device) {
                    lane.finish(now, retry, ok);
                }
            }
            Step::Msg(Msg::Ask { endpoint }) => {
                if lanes.asks.entry(endpoint).or_default().wake(now) {
                    ask(&shared, endpoint);
                }
            }
            Step::Msg(Msg::Asked { endpoint, ok }) => {
                if let Some(lane) = lanes.asks.get_mut(&endpoint) {
                    lane.finish(now, retry, ok);
                }
            }
            Step::Msg(Msg::Reached { device }) => {
                if let Some((lane, _)) = lanes.tells.get_mut(&device) {
                    lane.reach();
                }
            }
            #[cfg(test)]
            Step::Msg(Msg::Look(answer)) => {
                let tells = lanes.tells.iter().map(|(d, (lane, _))| (*d, *lane)).collect();
                let _ = answer.send(Look { tells, asks: lanes.asks.clone() });
            }
            Step::Tick => {}
        }
        // every lane whose wait is over, at this step's moment
        for (device, (lane, endpoint)) in lanes.tells.iter_mut() {
            if lane.tick(now) {
                tell(&shared, *device, *endpoint);
            }
        }
        for (endpoint, lane) in lanes.asks.iter_mut() {
            if lane.tick(now) {
                ask(&shared, *endpoint);
            }
        }
        lanes.tidy();
    }
}

/// Tell `device` at `endpoint` what it may know of the node's holdings, as they are when the attempt starts, on a
/// task of its own that reports back (`Msg::Told`).
fn tell(shared: &Arc<Shared>, device: SignerId, endpoint: EndpointId) {
    let Ok(activity) = shared.admit() else { return };
    let shared = shared.clone();
    task::spawn(async move {
        let _activity = activity;
        let ok = match shared.want_of(device) {
            Some(want) => shared.tell(device, endpoint, want).await.is_ok(),
            // the device may know nothing of the node any more: nothing to tell
            None => true,
        };
        shared.outreach.send(Msg::Told { device, ok });
    });
}

/// Ask `endpoint` for the logs where it holds what the node lacks, on a task of its own that reports back
/// (`Msg::Asked`).
fn ask(shared: &Arc<Shared>, endpoint: EndpointId) {
    let Ok(activity) = shared.admit() else { return };
    let shared = shared.clone();
    task::spawn(async move {
        let _activity = activity;
        let ok = shared.ask_differing(endpoint).await.is_ok();
        shared.outreach.send(Msg::Asked { endpoint, ok });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const RETRY: Duration = Duration::from_millis(1000);

    /// A held tell takes a new frontier's wake and tells it as soon as it ends, not after `retry` (was the live test
    /// `held_announcement_coalesces_new_entry_wake_without_waiting_for_retry`, over the four locks).
    #[test]
    fn one_attempt_in_flight_and_a_wake_meanwhile_is_owed() {
        let mut lane = Lane::default();
        assert!(lane.wake(0));
        assert!(!lane.wake(1), "one_in_flight");
        assert!(lane.owed, "wake_kept");
        lane.finish(5, RETRY, true);
        assert!(lane.pending && lane.due_at == 5, "owed_wakes_again, success_clears");
        assert!(lane.tick(5), "tick_starts");
        lane.finish(6, RETRY, true);
        assert!(!lane.pending && lane.due().is_none(), "a success with nothing owed starts no loop");
    }

    #[test]
    fn a_failure_waits_doubling_up_to_a_minute_and_is_tried_again() {
        let mut lane = Lane::default();
        let mut now = 0;
        for n in 0..20 {
            assert!(lane.wake(now) || lane.tick(now), "due again at {now}");
            lane.finish(now, RETRY, false);
            assert!(lane.pending, "failure_tried_again");
            assert_eq!(lane.due_at, now + wait(RETRY, n));
            assert_eq!(lane.due(), Some(lane.due_at), "waiting_has_timer");
            assert!(!lane.wake(now) && !lane.tick(now), "not before its wait");
            now = lane.due_at;
        }
        assert_eq!(wait(RETRY, 30), BACKOFF_MAX.as_millis() as u64, "wait_capped");
        lane.reach();
        assert!(lane.tick(now), "reached: due at once");
    }
}
