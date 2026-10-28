//! Every connection's congestion control: BBR v3 and Cubic side by side, sending at whichever allows more
//! (`LivePriority.lean` `either`).
//!
//! Cubic halves its window at each lost packet, so a phone's link (1 % lost, 40 ms) carried a 20 MB catch-up at 6 % of
//! its rate (`bench_live` phone_bulk: 59.7 s, live p95 6.2 s). BBR v3 paces to the bandwidth and round trip it measures
//! (36.7 %, 9.8 s, live p95 216 ms), but takes a round with more than 2 % lost for too much in flight and cuts toward 4
//! packets, where a single loss is 25 %: under 11 % loss with reordering it stayed there (sim seed 1, no end in 150 s,
//! Cubic 50 s). Each sees every event; the connection's window is the larger, paced as its owner paces it.
//!
//! BBR v3 also takes 7/10 of its short-term rate at every round with a loss outside its probes, and at a phone's 1 %
//! random loss nearly every round has one: its pacing swung between 1.4 and 7.8 MB/s on a 6.25 MB/s link (phone_bulk,
//! 24-60 % of it). So a third member, `Queue`, holds the largest window BBR or Cubic reached in a round with no queue,
//! and gives some of it up only at a round whose least round trip shows a queue past a target, or that lost more than a
//! tenth (`LivePriority.lean` `nextWindow`): a sender that fills a shared queue still backs off, and a loss with nothing
//! queued behind it cuts nothing. The largest window of the three is the connection's (`either3`).

use std::any::Any;
use std::sync::Arc;
use std::time::{Duration, Instant};

use noq_proto::RttEstimator;
use noq_proto::congestion::{Bbr3Config, Controller, ControllerFactory, ControllerMetrics, CubicConfig};

/// The factory iroh's transport config takes (`quic`).
#[derive(Debug, Default)]
pub(crate) struct EitherConfig {
    bbr: Arc<Bbr3Config>,
    cubic: Arc<CubicConfig>,
}

impl ControllerFactory for EitherConfig {
    fn build(self: Arc<Self>, now: Instant, current_mtu: u16) -> Box<dyn Controller> {
        let cubic = self.cubic.clone().build(now, current_mtu);
        let queue = Queue::new(cubic.initial_window(), current_mtu);
        Box::new(Either { bbr: self.bbr.clone().build(now, current_mtu), cubic, queue })
    }
}

#[derive(Debug)]
pub(crate) struct Either {
    bbr: Box<dyn Controller>,
    cubic: Box<dyn Controller>,
    queue: Queue,
}

impl Either {
    /// The controller whose window is the connection's now: the queue member's while it drains, else the largest,
    /// BBR's on a tie, then Cubic's.
    fn leading(&self) -> &dyn Controller {
        let (bbr, cubic, queue) = (self.bbr.window(), self.cubic.window(), self.queue.counts());
        if self.queue.drains() {
            &self.queue
        } else if bbr >= cubic && bbr >= queue {
            &*self.bbr
        } else if cubic >= queue {
            &*self.cubic
        } else {
            &self.queue
        }
    }
}

/// The member that backs off on a queue, not on every loss (`LivePriority.lean` `nextWindow`): it grows a sixteenth a
/// round the window bounded that shows no queue, or to the largest window BBR or Cubic reached in it, which a random
/// loss doesn't take, and gives 3/10 of it up at each round that shows a queue past the target or lost more than a
/// tenth (`grows_only_with_no_queue`).
///
/// A queue is judged against the least round trip, which a flow that starts behind another's standing queue measures
/// with that queue in it: it then never sees the queue it adds (two of ours on one queue split it 0.85 to 0.11). So it
/// learns its least round trip by draining (`drainAck`): every `DRAIN_EVERY` the whole connection sends at most two
/// packets till what it sent before is acknowledged, and then till a packet sent after that is; that packet's round
/// trip is its least. Flows that drain together see the queue empty; one that sees a round trip under its least takes
/// it at once and drains on from then, so the flows of a queue fall into step. Its window counts only once a drain
/// confirmed its least (`counts`).
#[derive(Clone, Debug)]
pub(crate) struct Queue {
    window: u64,
    initial: u64,
    mtu: u64,
    /// Its least round trip, and when it was last drained for or undercut.
    min_rtt: Option<(Duration, Instant)>,
    /// Whether a drain has confirmed `min_rtt`.
    confirmed: bool,
    draining: Option<Drain>,
    /// The larger of BBR's and Cubic's windows now (`Either` sets it before each event).
    others: u64,
    largest_sent: u64,
    /// The round under way: it ends once a packet sent after it began is acknowledged.
    round: Round,
}

#[derive(Clone, Debug, Default)]
struct Round {
    ends: u64,
    /// Its least round trip, and the others' largest window in it.
    rtt: Option<Duration>,
    others: u64,
    sent: u64,
    lost: u64,
    /// Whether the window bounded it: the connection's window was full (`on_cwnd_limited`) while it held no more than
    /// that window, so what it sent reached this member's. A round that sent all it had, or that the CPU or the pacer
    /// held back, shows nothing past it. (`app_limited` is no such sign: the connection clears it at every send.)
    full: bool,
}

/// A drain under way: first till what was sent before it is acknowledged, which empties its own share of the queue,
/// then till a packet sent after that is: the round trip that one measured saw no queue of its own.
#[derive(Clone, Debug)]
struct Drain {
    ends: u64,
    emptied: bool,
}

/// How often a connection drains.
const DRAIN_EVERY: Duration = Duration::from_millis(2500);

impl Queue {
    fn new(initial: u64, mtu: u16) -> Self {
        let mtu = mtu as u64;
        Queue {
            window: initial,
            initial,
            mtu,
            min_rtt: None,
            confirmed: false,
            draining: None,
            others: 0,
            largest_sent: 0,
            round: Round::default(),
        }
    }

    /// Its floor: two packets.
    fn least(&self) -> u64 {
        2 * self.mtu
    }

    /// Whether the connection drains now: then it sends at `least` alone.
    pub(crate) fn drains(&self) -> bool {
        self.draining.is_some()
    }

    /// What its window counts for in the pair: nothing till a drain confirmed its least round trip.
    pub(crate) fn counts(&self) -> u64 {
        if self.confirmed { self.window } else { 0 }
    }

    /// An ack of packet `pn`, sent at `sent`: its round trip as it measures it, a drain's step, a round's end.
    fn acked(&mut self, now: Instant, sent: Instant, pn: u64) {
        // its own sample, the time from sending to this ack: the least of a round's is the one least delayed by acks
        let sample = now.saturating_duration_since(sent);
        if let Some(drain) = &mut self.draining {
            if pn < drain.ends {
                return;
            }
            if !drain.emptied {
                // its own queue is gone: the next packet sent meets none of it
                *drain = Drain { ends: self.largest_sent + 1, emptied: true };
                return;
            }
            // the round trip of a packet sent with its queue gone is its least round trip, from now on
            self.min_rtt = Some((sample, now));
            self.confirmed = true;
            self.draining = None;
            self.round = Round { ends: self.largest_sent, ..Round::default() };
            return;
        }
        // a round trip under its least: the queue emptied, as when the flows beside it drained; it drains on from now
        if self.min_rtt.is_none_or(|(min, _)| sample < min) {
            self.min_rtt = Some((sample, now));
        }
        self.round.rtt = Some(self.round.rtt.map_or(sample, |r| r.min(sample)));
        self.round.others = self.round.others.max(self.others);
        if pn >= self.round.ends {
            self.end_round(now);
        }
    }

    /// The connection's window `window` was full: this round counts as bounded if this member's is no larger, so what
    /// was in flight reached it (`Either` calls it, knowing the connection's window).
    fn window_full(&mut self, window: u64) {
        self.round.full |= self.window <= window;
    }

    /// The round ends: congested where its least round trip lies past the target above the least (a quarter of it,
    /// 2 ms at least) or it lost more than a tenth of what it sent, 7/10 of the window then; else a sixteenth more
    /// if the window bounded the round, or what the others reached in it, if more. A drain begins where its window
    /// leads the others' and its least is unconfirmed or `DRAIN_EVERY` old.
    fn end_round(&mut self, now: Instant) {
        let round = std::mem::take(&mut self.round);
        self.round.ends = self.largest_sent;
        let (Some(rtt), Some((min, at))) = (round.rtt, self.min_rtt) else { return };
        let target = (min / 4).max(Duration::from_millis(2));
        if rtt.saturating_sub(min) > target || round.sent < 10 * round.lost {
            self.window = (self.window * 7 / 10).max(self.least());
        } else {
            // no queue yet: a sixteenth more a round the window bounded, to find where the queue begins, or the
            // others' if more; a round that sent all it had grows it no further than the others
            let grown = if round.full { self.window + self.window / 16 } else { self.window };
            self.window = grown.max(round.others);
        }
        // its least round trip matters only where its window leads: else the connection sends at the others' and a
        // drain would only slow it (`no_drain_unless_it_leads`)
        let stale = !self.confirmed || now.saturating_duration_since(at) >= DRAIN_EVERY;
        if stale && self.window > round.others {
            self.draining = Some(Drain { ends: self.largest_sent, emptied: false });
        }
    }
}

impl Controller for Queue {
    fn on_packet_sent(&mut self, _now: Instant, _bytes: u16, pn: u64) {
        self.largest_sent = self.largest_sent.max(pn);
        self.round.sent += 1;
    }

    fn on_ack(&mut self, now: Instant, sent: Instant, _bytes: u64, pn: u64, _app_limited: bool, _rtt: &RttEstimator) {
        self.acked(now, sent, pn);
    }

    fn on_congestion_event(&mut self, _now: Instant, _sent: Instant, persistent: bool, _ecn: bool, _lost: u64, _pn: u64) {
        // a persistent congestion is no random loss: back to the floor, as every controller goes
        if persistent {
            self.window = self.least();
        }
    }

    fn on_packet_lost(&mut self, _bytes: u16, _pn: u64, _now: Instant) {
        self.round.lost += 1;
    }

    fn on_mtu_update(&mut self, new_mtu: u16) {
        self.mtu = new_mtu as u64;
        self.window = self.window.max(self.least());
    }

    fn window(&self) -> u64 {
        if self.drains() { self.least() } else { self.window }
    }

    /// Its window alone, which the connection paces over the round trip, as it does Cubic's.
    fn metrics(&self) -> ControllerMetrics {
        let mut metrics = ControllerMetrics::default();
        metrics.congestion_window = self.window();
        metrics
    }

    fn clone_box(&self) -> Box<dyn Controller> {
        Box::new(self.clone())
    }

    fn initial_window(&self) -> u64 {
        self.initial
    }

    fn into_any(self: Box<Self>) -> Box<dyn Any> {
        self
    }
}

impl Controller for Either {
    fn on_sent(&mut self, now: Instant, bytes: u64, largest_pn: u64) {
        self.bbr.on_sent(now, bytes, largest_pn);
        self.cubic.on_sent(now, bytes, largest_pn);
    }

    fn on_packet_sent(&mut self, now: Instant, bytes: u16, pn: u64) {
        self.bbr.on_packet_sent(now, bytes, pn);
        self.cubic.on_packet_sent(now, bytes, pn);
        self.queue.on_packet_sent(now, bytes, pn);
    }

    fn on_cwnd_limited(&mut self) {
        self.bbr.on_cwnd_limited();
        self.cubic.on_cwnd_limited();
        self.queue.window_full(self.window());
    }

    fn on_ack(&mut self, now: Instant, sent: Instant, bytes: u64, pn: u64, app_limited: bool, rtt: &RttEstimator) {
        self.bbr.on_ack(now, sent, bytes, pn, app_limited, rtt);
        self.cubic.on_ack(now, sent, bytes, pn, app_limited, rtt);
        self.queue.others = self.bbr.window().max(self.cubic.window());
        self.queue.on_ack(now, sent, bytes, pn, app_limited, rtt);
    }

    fn on_end_acks(&mut self, now: Instant, in_flight: u64, app_limited: bool, largest_packet_num_acked: Option<u64>) {
        self.bbr.on_end_acks(now, in_flight, app_limited, largest_packet_num_acked);
        self.cubic.on_end_acks(now, in_flight, app_limited, largest_packet_num_acked);
    }

    fn on_congestion_event(
        &mut self,
        now: Instant,
        sent: Instant,
        is_persistent_congestion: bool,
        is_ecn: bool,
        lost_bytes: u64,
        largest_lost_pn: u64,
    ) {
        self.bbr.on_congestion_event(now, sent, is_persistent_congestion, is_ecn, lost_bytes, largest_lost_pn);
        self.cubic.on_congestion_event(now, sent, is_persistent_congestion, is_ecn, lost_bytes, largest_lost_pn);
        self.queue.on_congestion_event(now, sent, is_persistent_congestion, is_ecn, lost_bytes, largest_lost_pn);
    }

    fn on_packet_lost(&mut self, lost_bytes: u16, pn: u64, now: Instant) {
        self.bbr.on_packet_lost(lost_bytes, pn, now);
        self.cubic.on_packet_lost(lost_bytes, pn, now);
        self.queue.on_packet_lost(lost_bytes, pn, now);
    }

    fn on_spurious_congestion_event(&mut self) {
        self.bbr.on_spurious_congestion_event();
        self.cubic.on_spurious_congestion_event();
    }

    fn on_mtu_update(&mut self, new_mtu: u16) {
        self.bbr.on_mtu_update(new_mtu);
        self.cubic.on_mtu_update(new_mtu);
        self.queue.on_mtu_update(new_mtu);
    }

    fn on_ack_frequency_update(&mut self, ack_eliciting_threshold: u64, requested_max_ack_delay: Duration) {
        self.bbr.on_ack_frequency_update(ack_eliciting_threshold, requested_max_ack_delay);
        self.cubic.on_ack_frequency_update(ack_eliciting_threshold, requested_max_ack_delay);
    }

    fn window(&self) -> u64 {
        if self.queue.drains() {
            return self.queue.window();
        }
        self.bbr.window().max(self.cubic.window()).max(self.queue.counts())
    }

    /// The leading controller's own: BBR's pacing rate while its window leads, the window paced over the round trip
    /// while Cubic's or the queue member's does.
    fn metrics(&self) -> ControllerMetrics {
        let mut metrics = self.leading().metrics();
        metrics.congestion_window = self.window();
        metrics
    }

    fn clone_box(&self) -> Box<dyn Controller> {
        Box::new(Either { bbr: self.bbr.clone_box(), cubic: self.cubic.clone_box(), queue: self.queue.clone() })
    }

    fn initial_window(&self) -> u64 {
        self.bbr.initial_window().max(self.cubic.initial_window()).max(self.queue.initial_window())
    }

    fn into_any(self: Box<Self>) -> Box<dyn Any> {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pair_sends_at_the_larger_window_and_its_owners_pace() {
        let now = Instant::now();
        let mut pair = Arc::new(EitherConfig::default()).build(now, 1200);
        assert_eq!(pair.window(), pair.initial_window());
        // losses past BBR v3's 2 % rule: each controller cuts its own way, and the pair keeps the larger
        for pn in 0..40u64 {
            pair.on_packet_sent(now, 1200, pn);
        }
        for pn in (0..40u64).step_by(3) {
            pair.on_packet_lost(1200, pn, now);
        }
        pair.on_congestion_event(now, now, false, false, 14 * 1200, 39);
        let either = pair.into_any().downcast::<Either>().expect("the pair");
        assert_eq!(either.window(), either.bbr.window().max(either.cubic.window()));
        assert_eq!(either.metrics().congestion_window, either.window());
        let leads_bbr = either.bbr.window() >= either.cubic.window();
        assert_eq!(either.metrics().pacing_rate.is_some(), leads_bbr, "BBR paces when it leads, Cubic's window otherwise");
    }

    /// `rounds` clean rounds of one packet each, 40 ms, nothing lost: the window bounded each one if `full`.
    fn clean_rounds(queue: &mut Queue, rounds: u64, full: bool) {
        let start = Instant::now();
        for pn in 0..rounds {
            let sent = start + Duration::from_millis(40 * pn);
            queue.on_packet_sent(sent, 1200, pn);
            if full {
                queue.window_full(u64::MAX);
            }
            queue.acked(sent + Duration::from_millis(40), sent, pn);
        }
    }

    /// LivePriority.sent_all_grows_no_further: on a link with no queue and nothing lost (calm, calm_bulk) a window
    /// the connection never filled stays where it is, round after round, where growing on every clean round ran it
    /// past u64 and panicked the connection (`bench_live` calm_bulk).
    #[test]
    fn a_window_never_filled_never_grows() {
        let mut queue = Queue::new(12_000, 1200);
        clean_rounds(&mut queue, 20_000, false);
        assert_eq!(queue.window, 12_000);
    }

    /// LivePriority.grows_a_sixteenth_at_most: a round the window bounded grows it, a sixteenth at most.
    #[test]
    fn a_full_window_grows_a_sixteenth_a_round() {
        let mut queue = Queue::new(12_000, 1200);
        clean_rounds(&mut queue, 40, true);
        assert!(queue.window > 12_000, "it grows: {}", queue.window);
        assert!(queue.window as f64 <= 12_000.0 * (17.0f64 / 16.0).powi(40), "a sixteenth a round at most");
    }
}

/// The pair on the simulated network (`sim`): flows of iroh endpoints, ours and a plain Cubic one, through one
/// congested queue, and ours alone on a phone's lossy link.
#[cfg(all(test, feature = "sim"))]
mod on_the_network {
    use super::*;
    use crate::sim::{Faults, Net};
    use iroh::endpoint::{PortmapperConfig, QuicTransportConfig, presets};
    use iroh::{Endpoint, EndpointAddr, SecretKey};
    use std::sync::atomic::{AtomicU64, Ordering};

    const ALPN: &[u8] = b"avendb/congestion-test";
    /// A cell's or home router's link: 50 Mbit/s, holding at most 100 ms of queue.
    const RATE: u64 = 50_000_000 / 8;
    const BUFFER: Duration = Duration::from_millis(100);
    /// How long each flow sends, and from when on it is measured (past every start-up).
    const RUN: Duration = Duration::from_secs(9);
    const SETTLED: Duration = Duration::from_secs(3);
    /// One flow scenario at a time: they time the network in real time, and two at once share the machine.
    static ONE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    async fn endpoint(net: &Net, seed: u8, factory: Arc<dyn ControllerFactory + Send + Sync>) -> Endpoint {
        let config = QuicTransportConfig::builder().congestion_controller_factory(factory).build();
        let secret = SecretKey::from_bytes(&[seed; 32]);
        Endpoint::builder(presets::Empty)
            .secret_key(secret.clone())
            .crypto_provider(crate::provider())
            .alpns(vec![ALPN.to_vec()])
            .transport_config(config)
            .portmapper_config(PortmapperConfig::Disabled)
            .clear_ip_transports()
            .add_custom_transport(net.transport(secret.public()))
            .bind()
            .await
            .expect("an endpoint")
    }

    /// One flow: `from` sends to `to` as fast as its controller lets it for `RUN`; the bytes `to` took after `SETTLED`.
    async fn flow(from: Endpoint, to: Endpoint) -> u64 {
        let counted = Arc::new(AtomicU64::new(0));
        let receiving = {
            let (to, counted) = (to.clone(), counted.clone());
            tokio::spawn(async move {
                let conn = to.accept().await.expect("incoming").await.expect("a connection");
                let mut stream = conn.accept_uni().await.expect("a stream");
                let began = tokio::time::Instant::now();
                let mut buf = vec![0u8; 64 << 10];
                while let Ok(Some(n)) = stream.read(&mut buf).await {
                    if began.elapsed() >= SETTLED {
                        counted.fetch_add(n as u64, Ordering::Relaxed);
                    }
                }
                conn
            })
        };
        let addr = EndpointAddr::from_parts(to.id(), [crate::sim::addr(to.id())]);
        let conn = from.connect(addr, ALPN).await.expect("connects");
        let mut send = conn.open_uni().await.expect("a stream");
        let chunk = vec![7u8; 64 << 10];
        let end = tokio::time::Instant::now() + RUN;
        while tokio::time::Instant::now() < end {
            send.write_all(&chunk).await.expect("sends");
        }
        let took = counted.load(Ordering::Relaxed);
        receiving.abort();
        from.close().await;
        to.close().await;
        took
    }

    fn ours() -> Arc<dyn ControllerFactory + Send + Sync> {
        Arc::new(EitherConfig::default())
    }

    fn cubic() -> Arc<dyn ControllerFactory + Send + Sync> {
        Arc::new(CubicConfig::default())
    }

    /// The flows `kinds` side by side through one queue at `RATE`: each one's share of the link once settled, and the
    /// queue's waits, µs, in that time.
    async fn share(kinds: Vec<Arc<dyn ControllerFactory + Send + Sync>>) -> (Vec<f64>, Vec<u32>) {
        let _one = ONE.lock().await;
        let net = Net::with(9, Faults { latency: Duration::from_millis(20), ..Faults::CALM });
        let mut pairs = vec![];
        for (k, kind) in kinds.into_iter().enumerate() {
            let k = k as u8;
            pairs.push((endpoint(&net, 10 + 2 * k, kind.clone()).await, endpoint(&net, 11 + 2 * k, kind).await));
        }
        net.bottleneck(RATE, BUFFER, pairs.iter().map(|(from, _)| from.id()));
        let flows: Vec<_> = pairs.into_iter().map(|(from, to)| tokio::spawn(flow(from, to))).collect();
        let mut shares = vec![];
        for f in flows {
            let bytes = f.await.expect("a flow");
            shares.push(bytes as f64 / ((RUN - SETTLED).as_secs_f64() * RATE as f64));
        }
        let (waits, _) = net.queued();
        let settled = waits.len() * SETTLED.as_millis() as usize / RUN.as_millis() as usize;
        (shares, waits[settled..].to_vec())
    }

    fn p95(waits: &[u32]) -> Duration {
        let mut w = waits.to_vec();
        w.sort_unstable();
        Duration::from_micros(w.get(w.len() * 95 / 100).copied().unwrap_or(0) as u64)
    }

    /// LivePriority.a_queue_is_congestion: two of ours and a plain Cubic flow through one congested queue. Ours still
    /// back off, so none starves, and the queue is no fuller than the Cubic flow keeps it.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn ours_and_a_cubic_flow_share_a_congested_queue_and_none_starves() {
        let (shares, waits) = share(vec![ours(), ours(), cubic()]).await;
        let total: f64 = shares.iter().sum();
        assert!(shares.iter().all(|s| *s >= 0.10), "every flow gets a tenth of the link at least: {shares:?}");
        assert!(total >= 0.7, "together they use the link: {shares:?}");
        assert!(p95(&waits) <= BUFFER, "the queue stays within its buffer: p95 {:?}", p95(&waits));
    }

    /// Ours alone keep the shared queue near their target (a quarter of the 40 ms round trip, 10 ms), not at the
    /// buffer's 100 ms as a loss-driven sender does, while using the link.
    /// Two of ours alone share the queue without starving each other and use the link. The pair without the queue
    /// member (BBR v3 beside Cubic) split it 0.83 to 0.12 in 3 runs of 4 here: each flow's BBR model of the other's
    /// standing queue; the drains let each learn its own base round trip.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn two_of_ours_share_a_queue_and_use_the_link() {
        let (shares, waits) = share(vec![ours(), ours()]).await;
        let total: f64 = shares.iter().sum();
        assert!(shares.iter().all(|s| *s >= 0.15), "neither starves the other: {shares:?}");
        assert!(total >= 0.8, "they use the link: {shares:?}");
        assert!(p95(&waits) <= BUFFER, "the queue stays within its buffer: p95 {:?}", p95(&waits));
    }

    /// LivePriority.random_loss_keeps_the_window: on a phone's link (1 % lost at random) one flow of ours uses most
    /// of it, where Cubic alone used 6 % and BBR v3 24-60 % (phone_bulk); and with a queue as deep as can be (10 s),
    /// what it holds is no loss-blind window: the queue stays within a round trip or two.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn random_loss_keeps_the_link_full_and_the_queue_short() {
        let _one = ONE.lock().await;
        let net = Net::with(3, Faults { lose: Faults::PHONE.lose, latency: Faults::PHONE.latency, ..Faults::CALM });
        let (from, to) = (endpoint(&net, 40, ours()).await, endpoint(&net, 41, ours()).await);
        net.bottleneck(Faults::PHONE.rate, Duration::from_secs(10), [from.id()]);
        let share = flow(from, to).await as f64 / ((RUN - SETTLED).as_secs_f64() * Faults::PHONE.rate as f64);
        let (waits, _) = net.queued();
        let settled = &waits[waits.len() * SETTLED.as_millis() as usize / RUN.as_millis() as usize..];
        assert!(share >= 0.7, "a phone's lossy link is used: {share:.2}");
        assert!(p95(settled) <= Duration::from_millis(80), "the queue stays short: p95 {:?}", p95(settled));
    }
}
