//! The one head of a device's log (`ShelfIndex.lean`, "The log's one head"): the number of its edits and a hash of
//! their ids in one stream, so that the head of a prefix is a function of its edits alone (`ShelfIndex.Sound`), the
//! same in every process and on every device that holds them. Every index of the log is stamped with it
//! (`shelf_index::Stamp` in avendb-net). The log keeps it as edits arrive, hashing each id once (`chain_append`), and
//! keeps the stream's state at every `MARK`th edit, so the head of any prefix goes on from the mark before it
//! (`chain_from_mark`); a log rewritten from a place (`Log::let_go`) works it out again.

use crate::hash::Hasher;
use crate::id::EditId;

/// What the head of a log prefix is a hash of, in one stream: the purpose the shared index stamped its slots with
/// since its third version, kept so that every slot kept so far stays of its log.
const PURPOSE: &str = "avenDB shared index head 3";
/// How many edits apart its marks are: a prefix's head hashes fewer ids than this past its mark.
const MARK: usize = 4096;

/// A log's head: how many of its first edits, and the hash of their ids.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Head {
    pub at: u64,
    pub sum: [u8; 32],
}

/// The head as a log keeps it.
#[derive(Clone)]
pub(crate) struct LogHead {
    /// The stream after each multiple of `MARK` ids, the first after none.
    marks: Vec<Hasher>,
    running: Hasher,
    at: usize,
}

impl Default for LogHead {
    fn default() -> LogHead {
        LogHead { marks: vec![Hasher::new(PURPOSE)], running: Hasher::new(PURPOSE), at: 0 }
    }
}

impl std::fmt::Debug for LogHead {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "LogHead({} edits)", self.at)
    }
}

impl LogHead {
    /// The head of `ids`, worked out from the first.
    pub(crate) fn of(ids: &[EditId]) -> LogHead {
        let mut h = LogHead::default();
        h.on(ids);
        h
    }

    /// The same, `more` ids on, each hashed once, a mark kept at each multiple of `MARK`.
    pub(crate) fn on(&mut self, more: &[EditId]) {
        let mut more = more;
        while !more.is_empty() {
            let n = (MARK - self.at % MARK).min(more.len());
            hash_ids(&mut self.running, &more[..n]);
            (self.at, more) = (self.at + n, &more[n..]);
            if self.at % MARK == 0 {
                self.marks.push(self.running.clone());
            }
        }
    }

    /// The head of all the ids it is of.
    pub(crate) fn now(&self) -> Head {
        Head { at: self.at as u64, sum: self.running.clone().finalize() }
    }

    /// The head of the first `n` of `ids`, the ids it is of, if there are that many: from the mark at or before `n`.
    pub(crate) fn at(&self, n: u64, ids: &[EditId]) -> Option<Head> {
        let n = usize::try_from(n).ok().filter(|&n| n <= self.at)?;
        if n == self.at {
            return Some(self.now());
        }
        let mark = n / MARK;
        let mut h = self.marks[mark].clone();
        hash_ids(&mut h, &ids[mark * MARK..n]);
        Some(Head { at: n as u64, sum: h.finalize() })
    }
}

/// The head of `ids`, hashed from the first: what a log of them keeps.
pub fn head(ids: &[EditId]) -> Head {
    LogHead::of(ids).now()
}

/// `ids` on stream `h`, in runs, so it hashes them as fast as it hashes any bytes.
fn hash_ids(h: &mut Hasher, ids: &[EditId]) {
    #[cfg(test)]
    tests::HASHED.with(|n| n.set(n.get() + ids.len()));
    let mut run = Vec::with_capacity(32 * ids.len().min(MARK));
    for ids in ids.chunks(MARK) {
        run.clear();
        run.extend(ids.iter().flat_map(|id| id.0));
        h.update(&run);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    thread_local! {
        /// How many ids `hash_ids` hashed on this thread.
        pub(super) static HASHED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    }

    fn hashed() -> usize {
        HASHED.with(std::cell::Cell::get)
    }

    fn ids(n: u64) -> Vec<EditId> {
        (0..n).map(|i| EditId(crate::hash::hash("test ids", &i.to_be_bytes()))).collect()
    }

    /// The head of every prefix, gone on to or worked out from a mark, is the head of that prefix hashed from its first
    /// id (`chain_append`, `chain_from_mark`).
    #[test]
    fn the_head_of_a_prefix_is_its_edits_alone() {
        let all = ids(3 * MARK as u64 + 17);
        let mut grown = LogHead::default();
        for part in all.chunks(1000) {
            grown.on(part);
        }
        let whole = LogHead::of(&all);
        assert_eq!(grown.now(), whole.now());
        for n in [0, 1, 999, MARK - 1, MARK, MARK + 1, 2 * MARK + 5, all.len()] {
            let from_first = LogHead::of(&all[..n]).now();
            assert_eq!(grown.at(n as u64, &all), Some(from_first), "the head of the first {n}");
        }
        assert_eq!(grown.at(all.len() as u64 + 1, &all), None);
        assert_ne!(LogHead::of(&all[1..]).now().sum, LogHead::of(&all[..all.len() - 1]).now().sum);
    }

    /// A log that grows hashes each new id once, and the head of any prefix hashes fewer ids than a mark's worth: a
    /// check of an index's stamp never hashes the log from its first edit.
    #[test]
    fn a_head_hashes_each_id_once_and_a_prefix_from_its_mark() {
        let all = ids(5 * MARK as u64 + 3);
        let before = hashed();
        let mut grown = LogHead::default();
        for part in all.chunks(777) {
            grown.on(part);
        }
        assert_eq!(hashed() - before, all.len(), "each id hashed once as the log grew");
        for n in [0, 17, MARK, 3 * MARK - 1, 4 * MARK + 2, all.len()] {
            let before = hashed();
            grown.at(n as u64, &all).expect("a prefix");
            assert!(hashed() - before < MARK, "the head of the first {n}: {} ids hashed", hashed() - before);
        }
    }
}
