//! Bounded origin-side correlation for peer application receipts. Identifiers never
//! enter exported samples. A caller supplies authenticated connection identity and
//! a cryptographically random nonce; an inventory acknowledgement is not a receipt.
use std::collections::VecDeque;

pub const LIMIT: usize = 64;
pub const AGE_MS: u64 = 30_000;
type Id = [u8; 32];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Standing,
    NotStanding,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Sample {
    pub elapsed_ms: u64,
    pub outcome: Outcome,
}
struct Pending {
    nonce: Id,
    peer: Id,
    connection: usize,
    edit: Id,
    began_ms: u64,
}
#[derive(Default)]
pub struct Tracker {
    pending: VecDeque<Pending>,
    samples: VecDeque<Sample>,
}
impl Tracker {
    /// `now_ms` is one origin monotonic clock, never a peer/wall-clock timestamp.
    pub fn begin(&mut self, nonce: Id, peer: Id, connection: usize, edit: Id, now_ms: u64) -> bool {
        self.expire(now_ms);
        if self.pending.len() >= LIMIT || self.pending.iter().any(|p| p.nonce == nonce) {
            return false;
        }
        self.pending.push_back(Pending {
            nonce,
            peer,
            connection,
            edit,
            began_ms: now_ms,
        });
        true
    }
    /// Only matched, fresh application outcomes complete an observation. Waiting,
    /// unknown, unauthorized and unsupported are deliberately not success samples.
    pub fn complete(
        &mut self,
        nonce: Id,
        peer: Id,
        connection: usize,
        edit: Id,
        outcome: Outcome,
        now_ms: u64,
    ) -> bool {
        self.expire(now_ms);
        let Some(at) = self.pending.iter().position(|p| {
            p.nonce == nonce
                && p.peer == peer
                && p.connection == connection
                && p.edit == edit
                && now_ms >= p.began_ms
        }) else {
            return false;
        };
        let p = self.pending.remove(at).expect("matched pending receipt");
        self.samples.push_back(Sample {
            elapsed_ms: now_ms - p.began_ms,
            outcome,
        });
        while self.samples.len() > LIMIT {
            self.samples.pop_front();
        }
        true
    }
    pub fn cancel(&mut self, nonce: Id) {
        self.pending.retain(|p| p.nonce != nonce);
    }
    pub fn disconnect(&mut self, connection: usize) {
        self.pending.retain(|p| p.connection != connection);
    }
    pub fn expire(&mut self, now_ms: u64) {
        self.pending
            .retain(|p| now_ms >= p.began_ms && now_ms - p.began_ms < AGE_MS);
    }
    pub fn samples(&self) -> impl Iterator<Item = &Sample> {
        self.samples.iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn id(n: u8) -> Id {
        [n; 32]
    }
    #[test]
    fn fresh_exact_match_only_and_duplicates_do_not_report_twice() {
        let mut t = Tracker::default();
        assert!(t.begin(id(1), id(2), 3, id(4), 100));
        assert!(!t.complete(id(9), id(2), 3, id(4), Outcome::Standing, 120));
        assert!(!t.complete(id(1), id(9), 3, id(4), Outcome::Standing, 120));
        assert!(!t.complete(id(1), id(2), 9, id(4), Outcome::Standing, 120));
        assert!(!t.complete(id(1), id(2), 3, id(9), Outcome::Standing, 120));
        assert!(t.complete(id(1), id(2), 3, id(4), Outcome::Standing, 120));
        assert!(!t.complete(id(1), id(2), 3, id(4), Outcome::Standing, 121));
        assert_eq!(
            t.samples().copied().collect::<Vec<_>>(),
            vec![Sample {
                elapsed_ms: 20,
                outcome: Outcome::Standing
            }]
        );
    }
    #[test]
    fn bounded_expired_cancelled_reconnected_and_clock_regression() {
        let mut t = Tracker::default();
        for i in 0..LIMIT {
            assert!(t.begin(id(i as u8), id(2), i, id(4), 0));
        }
        assert!(!t.begin(id(99), id(2), 3, id(4), 0));
        assert!(!t.begin(id(1), id(2), 3, id(4), 0));
        t.cancel(id(1));
        t.disconnect(2);
        assert_eq!(t.pending.len(), LIMIT - 2);
        assert!(!t.complete(id(0), id(2), 0, id(4), Outcome::Standing, AGE_MS));
        assert!(t.pending.is_empty());
        assert!(t.begin(id(1), id(2), 3, id(4), 100));
        assert!(!t.complete(id(1), id(2), 3, id(4), Outcome::Standing, 99));
    }
    #[test]
    fn out_of_order_and_negative_policy_results_stay_distinct() {
        let mut t = Tracker::default();
        for i in 0..100 {
            assert!(t.begin(id(i), id(2), 3, id(4), 100));
            assert!(t.complete(id(i), id(2), 3, id(4), Outcome::NotStanding, 110));
        }
        assert_eq!(t.samples().count(), LIMIT);
        assert!(t.samples().all(|s| s.outcome == Outcome::NotStanding));
        assert!(t.begin(id(1), id(2), 3, id(4), 120));
        assert!(t.begin(id(2), id(2), 3, id(4), 121));
        assert!(t.complete(id(2), id(2), 3, id(4), Outcome::Standing, 130));
        assert!(t.complete(id(1), id(2), 3, id(4), Outcome::Standing, 140));
    }
}
