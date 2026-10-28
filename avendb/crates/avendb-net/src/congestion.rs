//! Every connection's congestion control: BBR v3 and Cubic side by side, sending at whichever allows more
//! (`LivePriority.lean` `either`).
//!
//! Cubic halves its window at each lost packet, so a phone's link (1 % lost, 40 ms) carried a 20 MB catch-up at 6 % of
//! its rate (`bench_live` phone_bulk: 59.7 s, live p95 6.2 s). BBR v3 paces to the bandwidth and round trip it measures
//! (36.7 %, 9.8 s, live p95 216 ms), but takes a round with more than 2 % lost for too much in flight and cuts toward 4
//! packets, where a single loss is 25 %: under 11 % loss with reordering it stayed there (sim seed 1, no end in 150 s,
//! Cubic 50 s). Each sees every event; the connection's window is the larger, paced as its owner paces it.

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
        Box::new(Either {
            bbr: self.bbr.clone().build(now, current_mtu),
            cubic: self.cubic.clone().build(now, current_mtu),
        })
    }
}

#[derive(Debug)]
pub(crate) struct Either {
    bbr: Box<dyn Controller>,
    cubic: Box<dyn Controller>,
}

impl Either {
    /// The controller whose window is the larger now: BBR's on a tie.
    fn leading(&self) -> &dyn Controller {
        if self.bbr.window() >= self.cubic.window() { &*self.bbr } else { &*self.cubic }
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
    }

    fn on_cwnd_limited(&mut self) {
        self.bbr.on_cwnd_limited();
        self.cubic.on_cwnd_limited();
    }

    fn on_ack(&mut self, now: Instant, sent: Instant, bytes: u64, pn: u64, app_limited: bool, rtt: &RttEstimator) {
        self.bbr.on_ack(now, sent, bytes, pn, app_limited, rtt);
        self.cubic.on_ack(now, sent, bytes, pn, app_limited, rtt);
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
    }

    fn on_packet_lost(&mut self, lost_bytes: u16, pn: u64, now: Instant) {
        self.bbr.on_packet_lost(lost_bytes, pn, now);
        self.cubic.on_packet_lost(lost_bytes, pn, now);
    }

    fn on_spurious_congestion_event(&mut self) {
        self.bbr.on_spurious_congestion_event();
        self.cubic.on_spurious_congestion_event();
    }

    fn on_mtu_update(&mut self, new_mtu: u16) {
        self.bbr.on_mtu_update(new_mtu);
        self.cubic.on_mtu_update(new_mtu);
    }

    fn on_ack_frequency_update(&mut self, ack_eliciting_threshold: u64, requested_max_ack_delay: Duration) {
        self.bbr.on_ack_frequency_update(ack_eliciting_threshold, requested_max_ack_delay);
        self.cubic.on_ack_frequency_update(ack_eliciting_threshold, requested_max_ack_delay);
    }

    fn window(&self) -> u64 {
        self.bbr.window().max(self.cubic.window())
    }

    /// The leading controller's own: BBR's pacing rate while its window leads, Cubic's window paced over the round
    /// trip while Cubic's does.
    fn metrics(&self) -> ControllerMetrics {
        let mut metrics = self.leading().metrics();
        metrics.congestion_window = self.window();
        metrics
    }

    fn clone_box(&self) -> Box<dyn Controller> {
        Box::new(Either { bbr: self.bbr.clone_box(), cubic: self.cubic.clone_box() })
    }

    fn initial_window(&self) -> u64 {
        self.bbr.initial_window().max(self.cubic.initial_window())
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
}
