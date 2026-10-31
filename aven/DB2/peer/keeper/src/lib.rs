//! A keeper's arrivals for one Doc (`Aven.Peer.Keeper`; PEERS.md §3 and §4; docs, "Catching up"), pure: no I/O, no
//! clock. A keeper keeps a Doc's sealed bytes for its readers (A22) and reads none of them. Whether it may take an
//! upload or serve a fetch at all is avenID's gate (`Aven.ID.Keep`); this is what it does with what it took.
//!
//! - **Items by their sealed hash, numbered by arrival:** a new item gets the Doc's next number, from 1, never reused;
//!   the same bytes again get no new number, only another uploader.
//! - **Covers, the uploader's own word:** a segment's upload names the loose items it holds, by their sealed hashes. A
//!   cover takes off an item's uploaders only the device that uploaded the segment, and an item no uploader is left
//!   on is dropped. So a reader can't make a keeper drop someone else's envelopes, and a writer that never comes back
//!   leaves its loose envelopes kept (`dropped_covered`, `cover_own`, `gone_writer_kept`).
//! - **Catching up:** [`Arrivals::after`] answers "what came after your number n?" with exactly the items held above
//!   `n`, oldest first, in pages of at most [`PAGE`], none empty (`after_complete`, `after_pages`).
//!
//! The hash type is a parameter: the keeper names items by BLAKE3 over their sealed bytes; the tests by the model's
//! numbers. `tests/vectors.rs` replays `peer/spec/vectors/keeper.json`.

use std::collections::BTreeMap;

pub mod fetch;
pub mod serve;

/// The most entries in one page of "what came after" (`Aven.Peer.pageSize`).
pub const PAGE: usize = 128;

/// An item a keeper holds: its arrival number, the hash of its sealed bytes, their length, and the devices that
/// uploaded it and haven't covered it since, in the order they came.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item<H> {
    pub n: u64,
    pub hash: H,
    pub bytes: u64,
    pub uploaders: Vec<String>,
}

/// One sealed thing in an upload: its hash, its length, and the hashes of the loose items it covers (a segment's;
/// none for a loose envelope).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Put<H> {
    pub hash: H,
    pub bytes: u64,
    pub covers: Vec<H>,
}

/// What a keeper holds of one Doc: the next arrival number, and its items by number, with an index by hash.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Arrivals<H: Ord> {
    next: u64,
    items: BTreeMap<u64, Item<H>>,
    by_hash: BTreeMap<H, u64>,
}

impl<H: Ord> Default for Arrivals<H> {
    fn default() -> Self {
        Self {
            next: 1,
            items: BTreeMap::new(),
            by_hash: BTreeMap::new(),
        }
    }
}

/// What one put did, for the keeper's timeline and its store: the number the item has, whether it is new, and the
/// items its covers dropped.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Took<H> {
    pub n: u64,
    pub new: bool,
    pub dropped: Vec<Item<H>>,
}

impl<H: Ord + Clone> Arrivals<H> {
    /// A Doc's arrivals as a store read them back: its next number and its items. `None` when they can't be a
    /// keeper's (`Store.wf`): numbers not rising, one at or past `next`, a hash twice, or an item without uploaders.
    pub fn restore(next: u64, items: Vec<Item<H>>) -> Option<Self> {
        let mut out = Self {
            next,
            ..Self::default()
        };
        let mut last = 0;
        for i in items {
            if i.n <= last
                || i.n >= next
                || i.uploaders.is_empty()
                || out.by_hash.contains_key(&i.hash)
            {
                return None;
            }
            last = i.n;
            out.by_hash.insert(i.hash.clone(), i.n);
            out.items.insert(i.n, i);
        }
        Some(out)
    }

    /// The number the next new item gets.
    pub fn next(&self) -> u64 {
        self.next
    }

    /// The items held, oldest first.
    pub fn items(&self) -> impl Iterator<Item = &Item<H>> {
        self.items.values()
    }

    /// The item with this sealed hash, if held.
    pub fn get(&self, hash: &H) -> Option<&Item<H>> {
        self.by_hash.get(hash).and_then(|n| self.items.get(n))
    }

    /// Takes `p` from device `d`: holds it (`add`), then applies its covers (`cover`). The item put is held after,
    /// whatever it covers (`put_held`).
    pub fn put(&mut self, d: &str, p: &Put<H>) -> Took<H> {
        let (n, new) = match self.by_hash.get(&p.hash) {
            Some(&n) => {
                let item = self.items.get_mut(&n).expect("the index names a held item");
                if !item.uploaders.iter().any(|u| u == d) {
                    item.uploaders.push(d.to_string());
                }
                (n, false)
            }
            None => {
                let n = self.next;
                self.next += 1;
                self.by_hash.insert(p.hash.clone(), n);
                self.items.insert(
                    n,
                    Item {
                        n,
                        hash: p.hash.clone(),
                        bytes: p.bytes,
                        uploaders: vec![d.to_string()],
                    },
                );
                (n, true)
            }
        };
        let mut dropped = Vec::new();
        for c in &p.covers {
            if *c == p.hash {
                continue;
            }
            let Some(&m) = self.by_hash.get(c) else {
                continue;
            };
            let item = self.items.get_mut(&m).expect("the index names a held item");
            item.uploaders.retain(|u| u != d);
            if item.uploaders.is_empty() {
                let item = self.items.remove(&m).expect("held");
                self.by_hash.remove(&item.hash);
                dropped.push(item);
            }
        }
        Took { n, new, dropped }
    }

    /// Takes an upload from device `d`, its items in order: one write of the Doc's ref at the keeper.
    pub fn upload(&mut self, d: &str, ps: &[Put<H>]) -> Vec<Took<H>> {
        ps.iter().map(|p| self.put(d, p)).collect()
    }

    /// What came after number `n`: the items held numbered above it, by number and hash, oldest first.
    pub fn after_all(&self, n: u64) -> Vec<(u64, H)> {
        self.items
            .range(n.saturating_add(1)..)
            .map(|(&m, i)| (m, i.hash.clone()))
            .collect()
    }

    /// The answer to "what came after your number n?": pages of at most [`PAGE`], none empty; none when nothing came.
    pub fn after(&self, n: u64) -> Vec<Vec<(u64, H)>> {
        self.after_all(n).chunks(PAGE).map(<[_]>::to_vec).collect()
    }

    /// One page of what came after `n`, and whether more follows it: what a keeper answers one `after` frame with.
    pub fn page(&self, n: u64) -> (Vec<(u64, H)>, bool) {
        let mut it = self
            .items
            .range(n.saturating_add(1)..)
            .map(|(&m, i)| (m, i.hash.clone()));
        let page: Vec<_> = it.by_ref().take(PAGE).collect();
        (page, it.next().is_some())
    }
}

/// What a device holds of one Doc from one keeper (`Aven.Peer.Keeper.Reader`): the keeper's number it has caught up to.
/// The hashes it holds are its store's; [`Reader::land`] is told which.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Reader {
    pub at: u64,
}

impl Reader {
    /// The hashes of a page the device lacks, in the page's order: what it fetches, as one request (`lacks`).
    pub fn lacks<H: Clone>(page: &[(u64, H)], held: impl Fn(&H) -> bool) -> Vec<H> {
        page.iter()
            .filter(|(_, h)| !held(h))
            .map(|(_, h)| h.clone())
            .collect()
    }

    /// A page landed in one write: the device is at the page's largest number (`land`). A page that isn't empty, of
    /// numbers above the device's, moves it forward (`land_progress`); one that doesn't is a stall (README, rule 3),
    /// and returns false.
    pub fn land<H>(&mut self, page: &[(u64, H)]) -> bool {
        let to = page.iter().map(|(n, _)| *n).fold(self.at, u64::max);
        let moved = to > self.at;
        self.at = to;
        moved
    }
}
