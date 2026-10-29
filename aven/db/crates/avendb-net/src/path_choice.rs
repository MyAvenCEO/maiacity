//! Which of its paths to a peer a node sends on (`Measured`, `PathChoice.lean`): a direct one, which spares the relay
//! its bandwidth and hop, while it delivers about as soon as the relay by what it measured, and the relay once none
//! does. iroh's own choice ranks every direct path above the relay whatever its round trip, and the relay only for
//! while none is up: a Mac's page kept a WebRTC path of a 10.8 s round trip that lost 4 of its 5 askings, with the relay
//! at 715 ms beside it, and took nothing in 10 min (2026-10-28).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use iroh::endpoint::transports::{AddrKind, FourTuple, PathSelection, PathSelectionContext, PathSelector};
use n0_future::time::Instant;

/// A direct path is sent on while its cost is at most this many times the relay's, and `STICK` more (`fit`): it spares
/// the relay its bandwidth and hop (as `SLOWER` a claim's landing, `LivePriority.lean`).
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

/// What sending on a path costs, in nanoseconds: its round trip over the share of what it sent that arrived. None for a
/// path that received nothing yet, whose round trip is a guess, that lost all it sent, or that stopped delivering.
pub(crate) fn cost(m: Measure) -> Option<u128> {
    if m.received == 0 || m.stalled {
        return None;
    }
    let delivered = m.sent.saturating_sub(m.lost);
    if m.sent > 0 && delivered == 0 {
        return None;
    }
    let rtt = m.rtt.as_nanos();
    Some(if m.sent == 0 { rtt } else { rtt.saturating_mul(m.sent as u128) / delivered as u128 })
}

/// Whether a direct path of cost `c` is fit to send on beside the cheapest relay path, `relay`: at most `RELAY_SLOWER`
/// times its cost and `STICK` more.
pub(crate) fn fit(c: u128, relay: Option<u128>) -> bool {
    relay.is_none_or(|r| c <= r.saturating_mul(RELAY_SLOWER).saturating_add(STICK.as_nanos()))
}

/// The path to send on, of `paths` (each with whether it is a relay's and what it measured), `current` the one sent
/// on now; None keeps the current. The cheapest fit direct path (`fit`), else the cheapest relay path; the current is
/// kept while it is fit and of the same kind as that, unless that is `STICK` cheaper.
pub(crate) fn choose<K: PartialEq + Clone>(current: Option<&K>, paths: impl IntoIterator<Item = (K, bool, Measure)>) -> Option<K> {
    let measured: Vec<(K, bool, u128)> = paths.into_iter().filter_map(|(k, relay, m)| Some((k, relay, cost(m)?))).collect();
    let cheapest = |relay: bool| {
        measured.iter().filter(|(_, r, _)| *r == relay).min_by_key(|(_, _, c)| *c).map(|(k, _, c)| (k.clone(), *c))
    };
    let relay = cheapest(true).map(|(_, c)| c);
    let direct = measured.iter().filter(|(_, r, c)| !r && fit(*c, relay)).min_by_key(|(_, _, c)| *c);
    let (best, best_relay, best_cost) = match direct {
        Some((k, _, c)) => (k.clone(), false, *c),
        None => {
            let (k, c) = cheapest(true)?;
            (k, true, c)
        }
    };
    // the current by its cheapest copy: one network path appears once a connection
    let now = measured.iter().filter(|(k, _, _)| Some(k) == current).min_by_key(|(_, _, c)| *c);
    match now {
        Some((_, r, c)) if *r == best_relay && (*r || fit(*c, relay)) && best_cost.saturating_add(STICK.as_nanos()) > *c => None,
        _ => (Some(&best) != current).then_some(best),
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
        assert_eq!(cost(m(100, 100, 100)), None);
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
        assert_eq!(cost(guess), None);
        assert_eq!(choose(Some(&"relay"), [("rtc", false, guess), ("relay", true, m(700, 10, 0))]), None);
        assert_eq!(choose(None, [("rtc", false, guess), ("relay", true, m(700, 10, 0))]), Some("relay"));
    }

    /// On a loopback, as a relay on the same machine, a direct path a few milliseconds slower than the relay is taken:
    /// what they differ by is jitter, and it spares the relay (a late WebRTC path over a local relay, avendb-server's
    /// `transport_activation`).
    #[test]
    fn a_direct_path_a_few_milliseconds_slower_than_a_local_relay_is_taken() {
        let paths = [("rtc", false, m(4, 50, 0)), ("relay", true, m(1, 500, 0))];
        assert_eq!(choose(Some(&"relay"), paths), Some("rtc"));
        assert_eq!(choose(Some(&"rtc"), paths), None);
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
