//! A peer's status (`Aven.DB.Status`): the phase its link is in (README, rule 7) and the progress counter behind
//! rule 3, "no step without progress". Every clock step without a frame adds one to `idle`; at `limit` the peer is
//! stalled, never live.

/// Clock steps without a frame before a peer is stalled.
pub const STALL_AFTER: u32 = 5;
/// One step of a peer's one clock, in milliseconds. The Aven Peer beats once per step, so a live link always moves.
pub const TICK_MS: u64 = 1000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Starting,
    Connecting,
    Live,
    Offline,
    Stalled,
}

impl Phase {
    /// The phases with a link to watch: a clock step counts against them.
    pub fn active(self) -> bool {
        matches!(self, Phase::Connecting | Phase::Live | Phase::Stalled)
    }

    pub fn name(self) -> &'static str {
        match self {
            Phase::Starting => "starting",
            Phase::Connecting => "connecting",
            Phase::Live => "live",
            Phase::Offline => "offline",
            Phase::Stalled => "stalled",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Event {
    /// a new attempt to reach the network
    Dial,
    /// a frame arrived: progress
    Frame,
    /// one step of the peer's one clock
    Tick,
    /// the link is gone
    Lost,
}

impl Event {
    pub fn name(self) -> &'static str {
        match self {
            Event::Dial => "dial",
            Event::Frame => "frame",
            Event::Tick => "tick",
            Event::Lost => "lost",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Status {
    pub phase: Phase,
    /// the progress counter: frames received, ever
    pub moved: u64,
    /// clock steps since `moved` last moved
    pub idle: u32,
}

impl Status {
    pub fn start() -> Self {
        Status { phase: Phase::Starting, moved: 0, idle: 0 }
    }

    /// One event; `limit` is the number of steps without progress after which a peer is stalled.
    pub fn step(self, limit: u32, event: Event) -> Self {
        match event {
            Event::Dial => Status { phase: Phase::Connecting, idle: 0, ..self },
            Event::Frame if self.phase.active() => Status { phase: Phase::Live, moved: self.moved + 1, idle: 0 },
            Event::Tick if self.phase.active() => {
                let idle = self.idle + 1;
                Status { phase: if idle >= limit { Phase::Stalled } else { self.phase }, idle, ..self }
            }
            Event::Frame | Event::Tick => self,
            Event::Lost => Status { phase: Phase::Offline, idle: 0, ..self },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(events: &[Event]) -> Status {
        events.iter().fold(Status::start(), |s, &e| s.step(3, e))
    }

    #[test]
    fn live_while_frames_arrive() {
        assert_eq!(run(&[Event::Dial, Event::Frame, Event::Tick, Event::Tick]).phase, Phase::Live);
    }

    // `quiet_stalled`: `limit` steps without progress stall a peer with a link
    #[test]
    fn quiet_link_stalls() {
        let quiet = [Event::Dial, Event::Frame, Event::Tick, Event::Tick, Event::Tick];
        assert_eq!(run(&quiet).phase, Phase::Stalled);
        assert_eq!(run(&[Event::Dial, Event::Tick, Event::Tick, Event::Tick]).phase, Phase::Stalled);
    }

    #[test]
    fn a_frame_revives_a_stalled_link() {
        let back = [Event::Dial, Event::Tick, Event::Tick, Event::Tick, Event::Frame];
        assert_eq!(run(&back).phase, Phase::Live);
    }

    #[test]
    fn lost_is_offline_until_the_next_dial() {
        assert_eq!(run(&[Event::Dial, Event::Frame, Event::Lost, Event::Frame, Event::Tick]).phase, Phase::Offline);
    }
}
