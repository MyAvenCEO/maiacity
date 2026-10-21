//! What a server takes and keeps at most (`Node::limit`): the bytes of one edit, of one file it keeps whole, and of
//! each person's backup (`avendb::quota`, `Quota.lean`). An edit larger than the most it takes it doesn't take; a file
//! larger than the most it keeps, or one that would take its person's backup past their limit, it doesn't fetch, and
//! says so for each person (`Usage`). It never drops what it kept: a file it holds whole counts as kept, whatever the
//! limit says now. A node told nothing takes and keeps whatever its peers bring, as a person's own devices do.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use avendb::id::VaultId;
use avendb::quota::{Book, Limits as Backup};
use avendb::sealed::FileRoot;
use avendb::sign::Signed;
use avendb::wire::Wire as _;

/// How long the server's book of backups stands before it is worked out again: it weighs every edit it holds.
const BOOK_FRESH: Duration = Duration::from_secs(30);

/// What a server takes and keeps at most.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Limits {
    /// The most bytes of one edit on the wire it takes, if any.
    pub edit: Option<usize>,
    /// The most bytes of one file it keeps whole, if any.
    pub file: Option<u64>,
    /// The most bytes it keeps for each person, by the cap group of Maia City they hold (`avendb::quota::Limits`);
    /// none limits nobody.
    pub backup: Backup,
}

/// What a server keeps for a person, as it last weighed it (`Node::backup`): the bytes of their edits and of the files
/// it keeps whole for them, their limit, the cap group it is by (none for the least, or no limit), and the bytes of
/// the files it didn't keep for them as they would have taken them past it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Usage {
    pub used: u64,
    pub limit: Option<u64>,
    pub group: Option<String>,
    pub refused: u64,
}

impl Usage {
    /// The server keeps no more of their files: it refused some, or they are at their limit.
    pub fn full(&self) -> bool {
        self.refused > 0 || self.limit.is_some_and(|l| self.used >= l)
    }
}

/// The edits of `edits` no larger than `most` bytes on the wire, where `most` says any.
pub(crate) fn sized(edits: &mut Vec<Signed>, most: Option<usize>) {
    if let Some(most) = most {
        let before = edits.len();
        edits.retain(|s| s.to_wire().len() <= most);
        if edits.len() < before {
            tracing::info!("avendb: {} edits over {most} bytes not taken", before - edits.len());
        }
    }
}

/// A server's limits, and its book of what it keeps for each person (`Book`), worked out now and then.
#[derive(Default)]
pub(crate) struct Keeping {
    pub limits: Limits,
    book: Option<(Instant, Arc<Book>)>,
    /// The files it didn't keep whole for each person's limit, by the person, as it last weighed them.
    refused: HashMap<VaultId, HashSet<FileRoot>>,
    /// What it keeps for each person, as it last weighed it.
    usage: HashMap<VaultId, Usage>,
}

impl Keeping {
    /// The book, if it was worked out a moment ago (`BOOK_FRESH`).
    pub fn fresh_book(&self) -> Option<Arc<Book>> {
        self.book.as_ref().filter(|(at, _)| at.elapsed() < BOOK_FRESH).map(|(_, b)| b.clone())
    }

    /// Keeps `book`, just worked out.
    pub fn set_book(&mut self, book: Book) -> Arc<Book> {
        let book = Arc::new(book);
        self.book = Some((Instant::now(), book.clone()));
        book
    }

    /// What it keeps for person `p`, as it last weighed it.
    pub fn usage(&self, p: VaultId) -> Option<Usage> {
        self.usage.get(&p).cloned()
    }
}

/// Weighs the files a server is to keep whole against each person's backup, by `book` (`quota::Ledger`): of
/// `candidates`, the files it doesn't hold whole yet, those it may fetch, smallest first, given `held`, those it holds
/// whole already, which count whatever the limit. Each person's usage, and the files refused, are said in `keeping`.
pub(crate) fn weigh(
    keeping: &mut Keeping,
    book: &Book,
    held: &HashSet<FileRoot>,
    candidates: &[FileRoot],
) -> HashSet<FileRoot> {
    let mut used: HashMap<VaultId, u64> = book.edits.clone();
    for f in held {
        if let Some(Some(p)) = book.files.get(f) {
            *used.entry(*p).or_default() += f.size;
        }
    }
    let mut refused: HashMap<VaultId, HashSet<FileRoot>> = HashMap::new();
    let mut may = HashSet::new();
    for f in candidates {
        if keeping.limits.file.is_some_and(|most| f.size > most) {
            continue;
        }
        let payer = book.files.get(f).copied().flatten();
        match payer.and_then(|p| Some((p, book.limit(p)?))) {
            None => {
                may.insert(*f);
            }
            Some((p, limit)) => {
                let now = used.entry(p).or_default();
                if now.saturating_add(f.size) <= limit {
                    *now += f.size;
                    may.insert(*f);
                } else {
                    refused.entry(p).or_default().insert(*f);
                }
            }
        }
    }
    let persons: HashSet<VaultId> = book.standing.keys().chain(used.keys()).copied().collect();
    keeping.usage = persons
        .into_iter()
        .map(|p| {
            let standing = book.standing.get(&p).cloned().flatten();
            let refused = refused.get(&p).map_or(0, |fs| fs.iter().map(|f| f.size).sum());
            let usage = Usage {
                used: used.get(&p).copied().unwrap_or(0),
                limit: standing.as_ref().map(|(l, _)| *l),
                group: standing.and_then(|(_, g)| g),
                refused,
            };
            (p, usage)
        })
        .collect();
    keeping.refused = refused;
    may
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(n: u8, size: u64) -> FileRoot {
        FileRoot { hash: [n; 32], size }
    }

    #[test]
    fn a_person_over_their_limit_gets_no_new_file_kept_and_nothing_held_is_dropped() {
        let (carol, maia) = (VaultId::from_u64(1), VaultId::from_u64(2));
        let (a, b, c, d, big) = (root(1, 60), root(2, 30), root(3, 20), root(4, 10), root(5, 1000));
        let mut book = Book { home: Some(maia), ..Book::default() };
        book.standing.insert(carol, Some((100, Some("Traveler".into()))));
        book.edits.insert(carol, 5);
        for f in [a, b, c, d] {
            book.files.insert(f, Some(carol));
        }
        // a file of nobody's, as large as it is
        book.files.insert(big, None);
        let limits = Limits { file: Some(500), ..Limits::default() };
        let mut keeping = Keeping { limits, ..Keeping::default() };
        // a held whole already, past what is left: kept, counted
        let held: HashSet<FileRoot> = [a].into();
        let may = weigh(&mut keeping, &book, &held, &[d, c, b, big]);
        // 5 + 60 held, then 10 and 20 fit (95), 30 doesn't; the big one is past the most of one file
        assert_eq!(may, [d, c].into());
        let usage = keeping.usage(carol).expect("weighed");
        assert_eq!(usage, Usage { used: 95, limit: Some(100), group: Some("Traveler".into()), refused: 30 });
        assert!(usage.full());
        // a limit lowered below what it holds: nothing held is dropped, nothing new is fetched
        book.standing.insert(carol, Some((10, Some("Traveler".into()))));
        let held: HashSet<FileRoot> = [a, c, d].into();
        assert!(weigh(&mut keeping, &book, &held, &[b]).is_empty());
        assert_eq!(keeping.usage(carol).map(|u| u.used), Some(95));
    }

    #[test]
    fn a_person_with_no_limit_keeps_every_file() {
        let (owner, maia) = (VaultId::from_u64(1), VaultId::from_u64(2));
        let mut book = Book { home: Some(maia), ..Book::default() };
        book.standing.insert(owner, None);
        let files = [root(1, 1 << 40), root(2, 1 << 41)];
        files.iter().for_each(|f| _ = book.files.insert(*f, Some(owner)));
        let mut keeping = Keeping::default();
        assert_eq!(weigh(&mut keeping, &book, &HashSet::new(), &files), files.into());
        assert!(!keeping.usage(owner).expect("weighed").full());
    }

    #[test]
    fn an_edit_over_the_most_is_not_taken() {
        let w = avendb::cast::world();
        let all: Vec<Signed> = w.lab.backup(w.mac_a).signed().to_vec();
        let sizes: Vec<usize> = all.iter().map(|s| s.to_wire().len()).collect();
        let (least, most) = (*sizes.iter().min().expect("edits"), *sizes.iter().max().expect("edits"));
        assert!(least < most, "edits of several sizes");
        let mut edits = all.clone();
        sized(&mut edits, None);
        assert_eq!(edits.len(), all.len(), "no limit, every edit");
        sized(&mut edits, Some(most));
        assert_eq!(edits.len(), all.len(), "the largest is within the most");
        sized(&mut edits, Some(most - 1));
        assert_eq!(edits.len(), sizes.iter().filter(|&&n| n < most).count(), "the largest is not taken");
        assert!(edits.iter().all(|s| s.to_wire().len() < most));
    }
}
