//! Which of its paths to a peer a node sends on (`Measured`, `PathChoice.lean`): the one that delivers soonest by what
//! it measured, a relay's or a direct one alike. iroh's own choice ranks every direct path above the relay whatever
//! its round trip, and the relay only for while none is up: a Mac's page kept a WebRTC path of a 10.8 s round trip
//! that lost 4 of its 5 askings, with the relay at 715 ms beside it, and took nothing in 10 min (2026-10-28).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use iroh::endpoint::transports::{AddrKind, FourTuple, PathSelection, PathSelectionContext, PathSelector};
use n0_future::time::Instant;

/// A relay's round trip counts this many times over (`cost`): a direct path is kept while it is at most this much
/// slower, as it spares the relay and its hop (as `SLOWER` a claim's landing, `LivePriority.lean`).
pub(crate) const RELAY_SLOWER: u128 = 2;

/// Another path of a cost at least this much lower is taken: less is jitter, and flapping between two paths costs
/// more than it gains.
pub(crate) const STICK: Duration = Duration::from_millis(5);

/// A path that sent since it last received, and received nothing for this many of its round trips, has stopped
/// delivering (`stalled`): its round trip, measured on what it got back, no longer grows, and its losses are counted
/// only once declared, a share of all it ever sent.
pub(crate) const STALL_RTTS: u32 = 3;

/// And for this long at least, as its selector looks again each second (vendor iroh's `PATH_CHECK_INTERVAL`).
pub(crate) const STALL_AT_LEAST: Duration = Duration::from_secs(1);

/// How long a path's last receipt is remembered once it is no longer among any peer's.
const FORGET: Duration = Duration::from_secs(600);

/// What a path measured: its round trip, the datagrams sent on it and lost, and those it received, and whether it
/// stopped delivering (`stalled`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Measure {
    pub rtt: Duration,
    pub sent: u64,
    pub lost: u64,
    pub received: u64,
    pub stalled: bool,
}

/// Whether a path stopped delivering: it sent since it last received, `since` ago, and that is `STALL_RTTS` of its
/// round trips and `STALL_AT_LEAST` past.
pub(crate) fn stalled(sent_since: bool, since: Duration, rtt: Duration) -> bool {
    sent_since && since >= (rtt * STALL_RTTS).max(STALL_AT_LEAST)
}

/// What sending on a path costs, in nanoseconds: its round trip over the share of what it sent that arrived, a
/// relay's `RELAY_SLOWER` times over. None for a path that received nothing yet, whose round trip is a guess, or that
/// lost all it sent, or that stopped delivering.
pub(crate) fn cost(relay: bool, m: Measure) -> Option<u128> {
    if m.received == 0 || m.stalled {
        return None;
    }
    let delivered = m.sent.saturating_sub(m.lost);
    if m.sent > 0 && delivered == 0 {
        return None;
    }
    let rtt = m.rtt.as_nanos();
    let lossy = if m.sent == 0 { rtt } else { rtt.saturating_mul(m.sent as u128) / delivered as u128 };
    Some(if relay { lossy.saturating_mul(RELAY_SLOWER) } else { lossy })
}

/// The path to send on, of `paths` (each with whether it is a relay's and what it measured), `current` the one sent
/// on now: the cheapest measured, once at least `STICK` cheaper than the current; None keeps the current.
pub(crate) fn choose<K: PartialEq + Clone>(current: Option<&K>, paths: impl IntoIterator<Item = (K, bool, Measure)>) -> Option<K> {
    let (mut best, mut now) = (None::<(K, u128)>, None::<u128>);
    for (key, relay, m) in paths {
        let Some(c) = cost(relay, m) else { continue };
        if Some(&key) == current {
            now = Some(now.map_or(c, |n| n.min(c)));
        }
        if best.as_ref().is_none_or(|(_, b)| c < *b) {
            best = Some((key, c));
        }
    }
    let (key, c) = best?;
    match now {
        Some(n) if c.saturating_add(STICK.as_nanos()) > n => None,
        _ => (Some(&key) != current).then_some(key),
    }
}

/// A node's choice among its paths to a peer (`choose`): a relay path, or one of the custom transport `relay_like`
/// stands in for (a simulated network's, `Options::sim`), costs as a relay's. It keeps when each path last received,
/// and what it had sent then, to tell one that stopped delivering (`stalled`).
#[derive(Debug)]
pub(crate) struct Measured {
    relay_like: Option<u64>,
    seen: Mutex<HashMap<FourTuple, Seen>>,
}

/// A path's last receipt: what it had received and sent then, and when.
#[derive(Debug, Clone, Copy)]
struct Seen {
    received: u64,
    sent: u64,
    at: Instant,
}

impl Measured {
    pub(crate) fn new(relay_like: Option<u64>) -> Self {
        Measured { relay_like, seen: Mutex::default() }
    }
}

impl PathSelector for Measured {
    fn select(&self, ctx: &PathSelectionContext<'_>) -> PathSelection {
        let relay = |path: &FourTuple| match path.addr_kind() {
            AddrKind::Relay => true,
            AddrKind::Custom(id) => Some(id) == self.relay_like,
            AddrKind::IpV4 | AddrKind::IpV6 => false,
        };
        let paths: Vec<_> = ctx.paths().filter_map(|data| Some((data.clone(), data.stats()?))).collect();
        // one network path is a path of each connection to the peer: what they sent and received, summed
        let mut sums: HashMap<&FourTuple, (u64, u64)> = HashMap::new();
        for (data, stats) in &paths {
            let sum = sums.entry(data.network_path()).or_default();
            *sum = (sum.0 + stats.udp_tx.datagrams, sum.1 + stats.udp_rx.datagrams);
        }
        let now = Instant::now();
        let stopped: HashMap<&FourTuple, (bool, Duration)> = {
            let mut seen = self.seen.lock().expect("seen");
            seen.retain(|path, s| sums.contains_key(path) || now.duration_since(s.at) < FORGET);
            sums.iter()
                .map(|(path, &(sent, received))| {
                    let s = seen.entry((*path).clone()).or_insert(Seen { received, sent, at: now });
                    // it received since, or a connection of it went and its sums with it
                    if received != s.received || sent < s.sent {
                        *s = Seen { received, sent, at: now };
                    }
                    (*path, (sent > s.sent, now.duration_since(s.at)))
                })
                .collect()
        };
        let measured = paths.iter().map(|(data, stats)| {
            let (sent_since, since) = stopped[data.network_path()];
            let m = Measure {
                rtt: stats.rtt,
                sent: stats.udp_tx.datagrams,
                lost: stats.lost_packets,
                received: stats.udp_rx.datagrams,
                stalled: stalled(sent_since, since, stats.rtt),
            };
            (data.network_path().clone(), relay(data.network_path()), m)
        });
        let mut selection = PathSelection::none();
        if let Some(chosen) = choose(ctx.current(), measured)
            && let Some((data, _)) = paths.iter().find(|(data, _)| *data.network_path() == chosen)
        {
            selection.set(data);
        }
        selection
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(rtt_ms: u64, sent: u64, lost: u64) -> Measure {
        Measure { rtt: Duration::from_millis(rtt_ms), sent, lost, received: sent.saturating_sub(lost).max(1), stalled: false }
    }

    /// The Mac's page of 2026-10-28: a WebRTC path of a 10.8 s round trip that lost 4 of its 5, the relay at 715 ms.
    /// iroh kept the WebRTC path; the relay delivers soonest.
    #[test]
    fn a_slow_lossy_direct_path_loses_to_a_faster_relay() {
        let paths = [("rtc", false, m(10_800, 5, 4)), ("relay", true, m(715, 50, 0))];
        assert_eq!(choose(Some(&"rtc"), paths), Some("relay"));
    }

    /// A direct path is kept while it is at most `RELAY_SLOWER` times as slow as the relay.
    #[test]
    fn a_direct_path_at_most_twice_as_slow_as_the_relay_is_kept() {
        let near = [("rtc", false, m(500, 100, 0)), ("relay", true, m(275, 100, 0))];
        assert_eq!(choose(Some(&"rtc"), near), None, "kept");
        assert_eq!(choose(Some(&"relay"), near), Some("rtc"), "taken");
        let far = [("rtc", false, m(600, 100, 0)), ("relay", true, m(275, 100, 0))];
        assert_eq!(choose(Some(&"rtc"), far), Some("relay"));
    }

    /// A direct path that stops delivering costs more with each datagram it loses, and once it costs more than the
    /// relay the relay is taken; one that lost all it sent is never taken.
    #[test]
    fn a_direct_path_that_stops_delivering_hands_over_to_the_relay() {
        let relay = ("relay", true, m(300, 100, 0));
        assert_eq!(choose(Some(&"rtc"), [("rtc", false, m(100, 100, 0)), relay]), None, "fast and whole");
        // its round trip as it was, but what it sent since was lost
        assert_eq!(choose(Some(&"rtc"), [("rtc", false, m(100, 100, 85)), relay]), Some("relay"));
        assert_eq!(choose(Some(&"rtc"), [("rtc", false, m(100, 100, 100)), relay]), Some("relay"));
        assert_eq!(cost(false, m(100, 100, 100)), None);
        // or it stopped delivering, its losses not declared yet: once it sent and received nothing for three of its
        // round trips, and a second at least, the relay is taken at the selector's next look
        assert!(!stalled(true, Duration::from_millis(900), Duration::from_millis(100)), "under a second");
        assert!(stalled(true, Duration::from_secs(1), Duration::from_millis(100)));
        assert!(!stalled(true, Duration::from_secs(2), Duration::from_millis(800)), "under three round trips");
        assert!(!stalled(false, Duration::from_secs(60), Duration::from_millis(100)), "it sent nothing since: idle, not stalled");
        let quiet = Measure { stalled: stalled(true, Duration::from_secs(1), Duration::from_millis(100)), ..m(100, 10_000, 0) };
        assert_eq!(choose(Some(&"rtc"), [("rtc", false, quiet), relay]), Some("relay"));
    }

    /// A path that received nothing yet has a round trip that is a guess: it is never taken over a measured one.
    #[test]
    fn a_path_with_no_sample_is_never_preferred() {
        let guess = Measure { rtt: Duration::from_millis(1), sent: 3, lost: 0, received: 0, stalled: false };
        assert_eq!(cost(false, guess), None);
        assert_eq!(choose(Some(&"relay"), [("rtc", false, guess), ("relay", true, m(700, 10, 0))]), None);
        assert_eq!(choose(None, [("rtc", false, guess), ("relay", true, m(700, 10, 0))]), Some("relay"));
    }

    /// Of two alike a cost under `STICK` lower is jitter: the current is kept.
    #[test]
    fn a_path_less_than_stick_cheaper_is_not_taken() {
        let paths = [("a", false, m(100, 10, 0)), ("b", false, m(97, 10, 0))];
        assert_eq!(choose(Some(&"a"), paths), None);
        let paths = [("a", false, m(100, 10, 0)), ("b", false, m(94, 10, 0))];
        assert_eq!(choose(Some(&"a"), paths), Some("b"));
    }
}
