//! What a node took from each peer and how (Samuel 2026-10-22: "analysis logs regarding amount of peers and network
//! and sync speeds … how long and where it is being synced from … what comes directly p2p and what via relay"), as its
//! `network` op tells it (`Node::network`) for the Performance page: each device it pulled from, the pages of edits it
//! asked for and how long each took to come (`wait`) and to be taken (`take`), their bytes and edits, and the newest
//! pages, each with the way it came (direct or through a relay, as the connection's selected path was then). The
//! connection's own paths, their round trips and the bytes each carried, are read off the connection as it asks
//! (`Node::network`); this keeps what the connection forgets once it closes.
//!
//! Kept in the node's memory alone, since it started: nothing here is written to a vault or sent to a peer.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use avendb::id::{EditId, SignerId};
use serde_json::{Value, json};

use crate::jobs::now_ms;

/// How many of the newest pages a node keeps, across all its peers.
pub const RECENT: usize = 64;

/// What a node took from one device, since it started.
#[derive(Clone, Debug, Default)]
pub struct Pulled {
    /// Pages of edits it asked for and got, the edits and bytes they brought, and how many edits were new.
    pub pages: u64,
    pub edits: u64,
    pub new: u64,
    pub bytes: u64,
    /// How long it waited for its pages to come, and how long it took to check and take them, in milliseconds: the
    /// request elapsed includes admission, encoding and decoding, not only network wait. The
    /// next page is asked for while one is taken, so the two overlap; and how long its pages took one after the other
    /// (`ms`), from the previous processing/lookahead join (or before the first ask) to the next join.
    /// These are legacy reply pipeline service intervals, excluding request planning, sparse ranges, keys and files.
    /// Concurrent requests can overlap, so their sum is not device wall-clock time.
    pub wait_ms: u64,
    pub take_ms: u64,
    pub ms: u64,
    /// How many askings it made of the device, and how long it took to work out their requests.
    pub askings: u64,
    pub ask_ms: u64,
    /// The pages that came over a direct path and those through a relay, and their bytes.
    pub direct: (u64, u64),
    pub relayed: (u64, u64),
    /// The McEliece keys its pages named that it lacked, fetched after its last page: how many it asked for, how many
    /// came, their bytes, and how long they took.
    pub keys: (u64, u64, u64, u64),
    /// Pages it asked for that never came, or came broken.
    pub failed: u64,
    /// Pages lost in flight (`Lost`): asked and never taken.
    pub lost: u64,
    /// The page budget its last sized asking stated (`session::SIZED`), 0 where its peer was asked unsized.
    pub budget: u64,
    /// When its first and its last page came, in milliseconds since 1970.
    pub first: u64,
    pub last: u64,
}

/// One page, as the newest are kept.
#[derive(Clone, Debug)]
pub struct Page {
    pub device: SignerId,
    pub at: u64,
    pub bytes: u64,
    pub edits: u64,
    pub new: u64,
    pub wait_ms: u64,
    pub take_ms: u64,
    /// Where `take_ms` went: checking its edits (signatures, outside the Lab), the Lab (its turn's wait and keeping
    /// them), and bringing keys and items up to date after it, in milliseconds.
    pub check_ms: u64,
    pub lab_ms: u64,
    pub catch_ms: u64,
    /// Pipeline interval through the processing/lookahead join; not this page's individual latency.
    pub ms: u64,
    /// `direct`, `relay`, or `` where the connection named no selected path.
    pub way: &'static str,
    /// The page budget its asking stated (`session::SIZED`), 0 where it asked unsized.
    pub budget: u64,
}

/// Why a page asked never came (`Lost`), by its error: named, never its text.
pub fn lost_why(error: &anyhow::Error) -> &'static str {
    if crate::session::too_long(error) {
        "too_long"
    } else if error.is::<n0_future::time::Elapsed>() {
        "timeout"
    } else if error.is::<iroh::endpoint::ReadToEndError>()
        || error.is::<iroh::endpoint::ConnectionError>()
        || error.is::<iroh::endpoint::WriteError>()
        || error.is::<iroh::endpoint::ClosedStream>()
    {
        "connection"
    } else {
        "broken"
    }
}

/// The newest pages lost in flight a node keeps, across all its peers.
pub const LOST: usize = 32;

/// A page asked of a device and never taken (S1b): it never came whole in time (`timeout`), came too long for its
/// admission (`too_long`), its connection failed (`connection`), it came broken (`broken`), its asking stopped with
/// it in flight (`stopped`: the asking failed, yielded or was dropped), or it was asked ahead at a cut its peer's pages
/// didn't end at (`missed`). When, how long it had been in flight, the budget its asking stated, and whether it was
/// asked ahead (`session::CUTS`). What a phone loses each time it is hidden or reloaded, as the report reads it.
#[derive(Clone, Debug)]
pub struct Lost {
    pub device: SignerId,
    pub at: u64,
    pub why: &'static str,
    pub flight_ms: u64,
    pub budget: u64,
    pub ahead: bool,
}

/// The askings kept (`Asking`), the newest.
pub const ASKINGS: usize = 32;

/// The logs an asking of a pull put to a device, as `Shared::pull_logs` chose them (`next_asking`): when, its stage
/// (`manifests`, `views` or `rest`), how many logs and the first of them, how many of the logs the open views want it
/// named and how many they want in all, and once it ended, how long it took, what was new, and whether it yielded to a
/// view or failed. Whether a page's room was asked first, and where it waited, as the report reads it.
#[derive(Clone, Debug)]
pub struct Asking {
    pub device: SignerId,
    pub at: u64,
    pub stage: &'static str,
    pub logs: usize,
    pub first: Vec<String>,
    pub wanted: usize,
    pub wants: usize,
    pub ms: u64,
    pub new: u64,
    pub yielded: bool,
    pub failed: bool,
}

/// A log as a report names it: its kind and the first 4 bytes of its id.
pub fn log_name(log: &avendb::sync::LogId) -> String {
    use avendb::sync::LogId;
    let short = |b: &[u8; 32]| b[..4].iter().map(|x| format!("{x:02x}")).collect::<String>();
    match log {
        LogId::Vault(v) => format!("Vault {}", short(&v.0)),
        LogId::Share(s) => format!("Share {}", short(&s.0)),
        LogId::Audience(v, a) => format!("Audience {} {}", short(&v.0), short(&a.0)),
        LogId::Entry(e) => format!("Entry {}", short(&e.0)),
    }
}

#[derive(Default)]
struct Book {
    by: HashMap<SignerId, Pulled>,
    recent: VecDeque<Page>,
    served: Served,
    live: LiveBook,
    trace: VecDeque<Trace>,
    lost: VecDeque<Lost>,
    askings: VecDeque<Asking>,
}

/// One step of a live edit on its way (T1): its id is the trace id on every device, as the edit's id is the same
/// everywhere, so the sender's report and the receiver's join on it. `told` (this node announced it, a head of a
/// small change, to `device`), `heard` (`device` announced it to this node), `taken` (this node's live pull of
/// `device` took it; `left` its view not yet shown within `live::LIVE_VIEW`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Told,
    Heard,
    Taken,
}

impl Stage {
    fn name(self) -> &'static str {
        match self {
            Stage::Told => "told",
            Stage::Heard => "heard",
            Stage::Taken => "taken",
        }
    }
}

#[derive(Clone, Debug)]
struct Trace {
    edit: EditId,
    device: SignerId,
    stage: Stage,
    at: u64,
    left: bool,
}

/// The trace steps kept: a few chat messages' worth, each a handful of steps on each device.
pub const TRACE: usize = 128;

/// How one live pull ended (`live::live_announced`): every log it was told of taken (`done`), given up at `LIVE_WAIT`
/// (`timed_out`), left to the backlog because the device lacked too many rule logs first (`backlog`), or failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LiveEnd {
    Done,
    TimedOut,
    Backlog,
    Failed,
}

impl LiveEnd {
    fn name(self) -> &'static str {
        match self {
            LiveEnd::Done => "done",
            LiveEnd::TimedOut => "timed_out",
            LiveEnd::Backlog => "backlog",
            LiveEnd::Failed => "failed",
        }
    }
}

/// One live pull: a peer announced a few changed logs and this node asked for them at once, beside its backlog. How
/// long its parts took, in milliseconds: working out what differs, the announced logs with the rule logs they rest on
/// (how many of those, `rules`), and bringing its view up to date after; and its whole, from the announcement to its
/// view showing what came.
#[derive(Clone, Debug)]
pub struct Live {
    pub device: SignerId,
    pub at: u64,
    pub logs: u64,
    pub new: u64,
    pub differ_ms: u64,
    pub rules: u64,
    pub pull_ms: u64,
    pub view_ms: u64,
    pub ms: u64,
    pub end: LiveEnd,
    /// Its view was not up to date within `live::LIVE_VIEW`: the background catch-up shows the rest.
    pub left: bool,
}

/// The live pulls, by how they ended, and the newest of them.
#[derive(Default)]
struct LiveBook {
    ends: [u64; 4],
    recent: VecDeque<Live>,
}

/// What a node answered its peers' askings with, page by page (`Traffic::served`): how many pages, edits and bytes,
/// and how long each took it, from the request read to the reply made, waiting for its lab and working it out; the
/// longest; and the newest pages' times, how long its peers wait on it. Never which peer asked: a server says it on its
/// public health (`/feed/health`).
#[derive(Clone, Debug, Default)]
pub struct Served {
    pub pages: u64,
    pub edits: u64,
    pub bytes: u64,
    pub ms: u64,
    pub max_ms: u64,
    pub recent: VecDeque<(u64, u64, u64)>,
}

/// What a node took from its peers, shared by its tasks.
#[derive(Default)]
pub struct Traffic(Mutex<Book>);

impl Traffic {
    /// A page `page` came from its device.
    pub fn page(&self, page: Page) {
        let mut book = self.0.lock().expect("traffic");
        let p = book.by.entry(page.device).or_default();
        p.pages += 1;
        p.edits += page.edits;
        p.new += page.new;
        p.bytes += page.bytes;
        p.wait_ms += page.wait_ms;
        p.take_ms += page.take_ms;
        p.ms += page.ms;
        match page.way {
            "direct" => p.direct = (p.direct.0 + 1, p.direct.1 + page.bytes),
            "relay" => p.relayed = (p.relayed.0 + 1, p.relayed.1 + page.bytes),
            _ => {}
        }
        p.budget = page.budget;
        if p.first == 0 {
            p.first = page.at;
        }
        p.last = page.at;
        book.recent.push_front(page);
        book.recent.truncate(RECENT);
    }

    /// An asking of `device` began, its request worked out in `ms` milliseconds.
    pub fn asked(&self, device: SignerId, ms: u64) {
        let mut book = self.0.lock().expect("traffic");
        let p = book.by.entry(device).or_default();
        p.askings += 1;
        p.ask_ms += ms;
    }

    /// It fetched `got` of the `asked` McEliece keys its pages from `device` named, `bytes` bytes in `ms` milliseconds.
    pub fn keys(&self, device: SignerId, asked: u64, got: u64, bytes: u64, ms: u64) {
        let mut book = self.0.lock().expect("traffic");
        let k = &mut book.by.entry(device).or_default().keys;
        *k = (k.0 + asked, k.1 + got, k.2 + bytes, k.3 + ms);
    }

    /// A page this node answered a peer with: `edits` edits in `bytes` bytes, made in `ms` milliseconds.
    pub fn served(&self, edits: u64, bytes: u64, ms: u64) {
        let mut book = self.0.lock().expect("traffic");
        let s = &mut book.served;
        s.pages += 1;
        s.edits += edits;
        s.bytes += bytes;
        s.ms += ms;
        s.max_ms = s.max_ms.max(ms);
        s.recent.push_front((now_ms(), ms, bytes));
        s.recent.truncate(RECENT);
    }

    /// Edits `edits` reached `stage` with `device` (`Stage`), now.
    pub fn trace(&self, stage: Stage, device: SignerId, edits: impl IntoIterator<Item = EditId>, left: bool) {
        let at = now_ms();
        let mut book = self.0.lock().expect("traffic");
        for edit in edits {
            book.trace.push_front(Trace { edit, device, stage, at, left });
        }
        book.trace.truncate(TRACE);
    }

    /// The trace steps (`Stage`), as the `network` op says them, the newest first: the edit's id in full, the trace id.
    pub fn trace_json(&self) -> Value {
        let book = self.0.lock().expect("traffic");
        Value::Array(book.trace.iter().map(|t| json!({
            "edit": t.edit.to_hex(), "device": t.device.to_hex(), "stage": t.stage.name(), "at": t.at, "left": t.left,
        })).collect())
    }

    /// A live pull ended (`Live`).
    pub fn live(&self, live: Live) {
        tracing::debug!(device = %live.device.to_hex(), logs = live.logs, new = live.new, ms = live.ms,
            differ_ms = live.differ_ms, rules = live.rules, pull_ms = live.pull_ms, view_ms = live.view_ms,
            end = live.end.name(), left = live.left, "avendb: live pull");
        let mut book = self.0.lock().expect("traffic");
        book.live.ends[live.end as usize] += 1;
        book.live.recent.push_front(live);
        book.live.recent.truncate(RECENT);
    }

    /// The live pulls, as the `network` op says them: how many ended each way, and the newest, the newest first.
    pub fn live_json(&self) -> Value {
        let book = self.0.lock().expect("traffic");
        let ends = [LiveEnd::Done, LiveEnd::TimedOut, LiveEnd::Backlog, LiveEnd::Failed];
        let mut by = serde_json::Map::new();
        for end in ends {
            by.insert(end.name().into(), json!(book.live.ends[end as usize]));
        }
        let recent: Vec<Value> = book.live.recent.iter().map(|l| json!({
            "device": l.device.to_hex(), "at": l.at, "logs": l.logs, "new": l.new, "differ_ms": l.differ_ms,
            "rules": l.rules, "pull_ms": l.pull_ms, "view_ms": l.view_ms, "ms": l.ms, "end": l.end.name(),
            "left": l.left,
        })).collect();
        json!({ "ends": by, "recent": recent })
    }

    /// What it answered its peers with, as `/feed/health` and the `network` op say it.
    pub fn served_json(&self) -> Value {
        let book = self.0.lock().expect("traffic");
        let s = &book.served;
        let recent: Vec<Value> = s.recent.iter().map(|(at, ms, bytes)| json!({ "at": at, "ms": ms, "bytes": bytes })).collect();
        json!({
            "pages": s.pages,
            "edits": s.edits,
            "bytes": s.bytes,
            "ms": s.ms,
            "mean_ms": if s.pages == 0 { 0.0 } else { s.ms as f64 / s.pages as f64 },
            "max_ms": s.max_ms,
            "recent": recent,
        })
    }

    /// A page asked of `device` that never came, or came broken.
    pub fn failed(&self, device: SignerId) {
        self.0.lock().expect("traffic").by.entry(device).or_default().failed += 1;
    }

    /// A page asked of its device was lost in flight (`Lost`).
    pub fn lost(&self, lost: Lost) {
        let mut book = self.0.lock().expect("traffic");
        book.by.entry(lost.device).or_default().lost += 1;
        book.lost.push_front(lost);
        book.lost.truncate(LOST);
    }

    /// An asking of a pull ended (`Asking`).
    pub fn asking(&self, asking: Asking) {
        let mut book = self.0.lock().expect("traffic");
        book.askings.push_front(asking);
        book.askings.truncate(ASKINGS);
    }

    /// The newest askings, the newest first.
    pub fn askings_json(&self) -> Vec<Value> {
        let book = self.0.lock().expect("traffic");
        book.askings
            .iter()
            .map(|a| {
                json!({
                    "device": a.device.to_hex(),
                    "at": a.at,
                    "stage": a.stage,
                    "logs": a.logs,
                    "first": a.first,
                    "wanted": a.wanted,
                    "wants": a.wants,
                    "ms": a.ms,
                    "new": a.new,
                    "yielded": a.yielded,
                    "failed": a.failed,
                })
            })
            .collect()
    }

    /// The newest pages lost in flight, the newest first.
    pub fn lost_json(&self) -> Vec<Value> {
        let book = self.0.lock().expect("traffic");
        book.lost
            .iter()
            .map(|l| {
                json!({
                    "device": l.device.to_hex(),
                    "at": l.at,
                    "why": l.why,
                    "flight_ms": l.flight_ms,
                    "budget": l.budget,
                    "ahead": l.ahead,
                })
            })
            .collect()
    }

    /// What it took from `device`, if anything.
    pub fn of(&self, device: &SignerId) -> Option<Pulled> {
        self.0.lock().expect("traffic").by.get(device).cloned()
    }

    /// The devices it took anything from.
    pub fn devices(&self) -> Vec<SignerId> {
        self.0.lock().expect("traffic").by.keys().copied().collect()
    }

    /// The newest pages, the newest first, as the page reads them.
    pub fn recent(&self) -> Vec<Value> {
        let book = self.0.lock().expect("traffic");
        book.recent
            .iter()
            .map(|p| {
                json!({
                    "device": p.device.to_hex(),
                    "at": p.at,
                    "bytes": p.bytes,
                    "edits": p.edits,
                    "new": p.new,
                    "wait_ms": p.wait_ms,
                    "take_ms": p.take_ms,
                    "check_ms": p.check_ms,
                    "lab_ms": p.lab_ms,
                    "catch_ms": p.catch_ms,
                    "ms": p.ms,
                    "way": p.way,
                    "budget": p.budget,
                })
            })
            .collect()
    }
}

impl Pulled {
    /// Compatible legacy JSON: bytes/edits per summed pipeline service second, not transport bandwidth.
    /// `edits - new` includes both already-held and rejected offers; it is not a duplicate count.
    pub fn to_json(&self) -> Value {
        let ms = self.ms.max(1) as f64;
        json!({
            "pages": self.pages,
            "edits": self.edits,
            "new": self.new,
            "bytes": self.bytes,
            "wait_ms": self.wait_ms,
            "take_ms": self.take_ms,
            "ms": self.ms,
            "askings": self.askings,
            "ask_ms": self.ask_ms,
            "bytes_per_s": (self.bytes as f64 * 1000.0 / ms).round(),
            "edits_per_s": ((self.edits as f64 * 1000.0 / ms) * 10.0).round() / 10.0,
            "direct": { "pages": self.direct.0, "bytes": self.direct.1 },
            "relay": { "pages": self.relayed.0, "bytes": self.relayed.1 },
            "keys": { "asked": self.keys.0, "got": self.keys.1, "bytes": self.keys.2, "ms": self.keys.3 },
            "failed": self.failed,
            "lost": self.lost,
            "budget": self.budget,
            "first": self.first,
            "last": self.last,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages_add_up_by_device_and_way_and_the_newest_are_kept() {
        let t = Traffic::default();
        let d = SignerId([7; 32]);
        let page = |way, bytes| Page { device: d, at: 1000, bytes, edits: 10, new: 4, wait_ms: 900, take_ms: 100, check_ms: 0, lab_ms: 0, catch_ms: 0, ms: 1000, way, budget: 0 };
        t.page(page("relay", 4000));
        t.page(page("direct", 1000));
        t.failed(d);
        let p = t.of(&d).expect("pulled");
        assert_eq!((p.pages, p.edits, p.new, p.bytes, p.failed), (2, 20, 8, 5000, 1));
        assert_eq!((p.direct, p.relayed), ((1, 1000), (1, 4000)));
        let j = p.to_json();
        assert_eq!(j["bytes_per_s"], 2500.0);
        assert_eq!(j["edits_per_s"], 10.0);
        assert_eq!(t.recent().len(), 2);
        assert_eq!(t.recent()[0]["way"], "direct");
        for _ in 0..RECENT + 5 {
            t.page(page("relay", 1));
        }
        assert_eq!(t.recent().len(), RECENT);
    }

    #[test]
    fn pages_lost_in_flight_are_counted_by_device_and_the_newest_kept() {
        let t = Traffic::default();
        let d = SignerId([7; 32]);
        let lost = |why, at| Lost { device: d, at, why, flight_ms: 1500, budget: 128 << 10, ahead: true };
        t.lost(lost("stopped", 1));
        t.lost(lost("timeout", 2));
        assert_eq!(t.of(&d).expect("pulled").lost, 2);
        assert_eq!(t.of(&d).expect("pulled").to_json()["lost"], 2);
        let json = t.lost_json();
        assert_eq!((json[0]["why"].as_str(), json[0]["at"].as_u64()), (Some("timeout"), Some(2)));
        assert_eq!((json[1]["flight_ms"].as_u64(), json[1]["budget"].as_u64()), (Some(1500), Some(128 << 10)));
        for at in 0..LOST as u64 + 5 {
            t.lost(lost("missed", at));
        }
        assert_eq!(t.lost_json().len(), LOST);
    }
}
