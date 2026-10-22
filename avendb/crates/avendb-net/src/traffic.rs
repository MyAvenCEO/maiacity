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

use avendb::id::SignerId;
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
    /// next page is asked for while one is taken, so the two overlap; and how long its pages took one after the other
    /// (`ms`), from the end of the one before, or the asking's start, to the end of each.
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
    /// From the end of the page before, or the asking's start, to the end of this one.
    pub ms: u64,
    /// `direct`, `relay`, or `` where the connection named no selected path.
    pub way: &'static str,
}

#[derive(Default)]
struct Book {
    by: HashMap<SignerId, Pulled>,
    recent: VecDeque<Page>,
    served: Served,
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
                    "ms": p.ms,
                    "way": p.way,
                })
            })
            .collect()
    }
}

impl Pulled {
    /// As the page reads it: with how fast its pages came, in bytes and edits a second of the time they took one after
    /// the other.
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
        let page = |way, bytes| Page { device: d, at: 1000, bytes, edits: 10, new: 4, wait_ms: 900, take_ms: 100, ms: 1000, way };
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
}
