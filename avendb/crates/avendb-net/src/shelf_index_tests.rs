//! The index gate held to the Rust tree: index == rebuild(log) at every step, one root for the same rows however they
//! were written, and the log's index after a crash at any write, a torn slot, a lost page or a rewritten log.

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::sync::atomic::{AtomicI64, Ordering};

use super::*;
use crate::shelf::Call;
use avendb::pages::MOST;
use bao_tree::blake3;

/// What an in-memory shelf holds, and how many more writes it takes before it "crashes": every write after that is
/// refused and holds nothing.
#[derive(Default)]
struct Memory {
    objects: Mutex<HashMap<String, Bytes>>,
    writes_left: AtomicI64,
}

impl Memory {
    fn shelf(self: &Arc<Self>) -> Shelf {
        let (shelf, mut calls) = Shelf::new();
        let me = self.clone();
        tokio::spawn(async move {
            while let Some(call) = calls.recv().await {
                match call {
                    Call::Put { name, bytes, tx } | Call::Keep { name, bytes, tx } => {
                        let answer = if me.writes_left.fetch_sub(1, Ordering::SeqCst) > 0 {
                            let mut objects = me.objects.lock().unwrap();
                            match objects.get(&name) {
                                Some(held) if *held != bytes && !name.starts_with("slots/") => {
                                    Err(io::Error::new(io::ErrorKind::AlreadyExists, "put once"))
                                }
                                _ => {
                                    objects.insert(name, bytes);
                                    Ok(())
                                }
                            }
                        } else {
                            Err(io::Error::other("crashed"))
                        };
                        tx.send(answer).ok();
                    }
                    Call::Get { name, tx } => {
                        tx.send(Ok(me.objects.lock().unwrap().get(&name).cloned()))
                            .ok();
                    }
                    Call::Names { prefix, tx } => {
                        let mut names: Vec<_> = me
                            .objects
                            .lock()
                            .unwrap()
                            .keys()
                            .filter(|n| n.starts_with(&prefix))
                            .cloned()
                            .collect();
                        names.sort();
                        tx.send(Ok(names)).ok();
                    }
                    _ => panic!("an index asks only for named objects"),
                }
            }
        });
        shelf
    }

    fn new() -> Arc<Memory> {
        let m = Memory::default();
        m.writes_left.store(i64::MAX, Ordering::SeqCst);
        Arc::new(m)
    }
}

/// An entry of a test log: a key and the value it sets, or none to clear it.
type Entry = (u32, Option<u32>);

fn rows(e: &Entry) -> Vec<Change> {
    vec![(
        e.0.to_be_bytes().to_vec(),
        e.1.map(|v| v.to_be_bytes().to_vec()),
    )]
}

/// A test log: its entries and the chained hash of each prefix.
struct TestLog {
    entries: Vec<Entry>,
    heads: Vec<Sum>,
}

impl TestLog {
    fn new(salt: &[u8]) -> TestLog {
        TestLog {
            entries: Vec::new(),
            heads: vec![sum(salt)],
        }
    }
    fn push(&mut self, e: Entry) {
        let mut h = blake3::Hasher::new();
        h.update(self.heads.last().unwrap());
        h.update(&e.0.to_be_bytes());
        h.update(&e.1.map_or([0xff; 5], |v| {
            let mut b = [0; 5];
            b[1..].copy_from_slice(&v.to_be_bytes());
            b
        }));
        self.heads.push(*h.finalize().as_bytes());
        self.entries.push(e);
    }
    fn stamp(&self) -> Stamp {
        Stamp {
            at: self.len(),
            head: *self.heads.last().unwrap(),
        }
    }
}

impl Log for TestLog {
    type Entry = Entry;
    fn len(&self) -> u64 {
        self.entries.len() as u64
    }
    fn head_at(&self, n: u64) -> Option<Sum> {
        self.heads.get(n as usize).copied()
    }
    fn entries(&self, from: u64, to: u64) -> Vec<Entry> {
        self.entries[from as usize..to as usize].to_vec()
    }
}

/// A small seeded generator.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn entry(&mut self, keys: u64) -> Entry {
        let k = self.below(keys) as u32;
        let v = (self.below(4) != 0).then(|| self.next() as u32);
        (k, v)
    }
}

async fn all_rows(ix: &ShelfIndex) -> BTreeMap<Vec<u8>, Vec<u8>> {
    ix.scan(&[], usize::MAX)
        .await
        .unwrap()
        .into_iter()
        .collect()
}

/// The root of an index of `rows` written at once on a shelf of its own.
async fn fresh_root(rows: &BTreeMap<Vec<u8>, Vec<u8>>) -> Option<Sum> {
    let mut ix = ShelfIndex::empty(Memory::new().shelf(), "fresh", 1 << 20, [0; 32]).unwrap();
    let changes = rows
        .iter()
        .map(|(k, v)| (k.clone(), Some(v.clone())))
        .collect();
    ix.apply(
        changes,
        Stamp {
            at: 1,
            head: [1; 32],
        },
    )
    .await
    .unwrap();
    ix.root()
}

#[tokio::test]
async fn index_is_the_rebuild_of_its_log_at_every_step() {
    for seed in 1..=6u64 {
        let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15));
        let keys = [40, 2_000, 50_000][seed as usize % 3];
        let mem = Memory::new();
        let mut log = TestLog::new(b"log");
        let (mut ix, how) = ShelfIndex::open(mem.shelf(), "test", 64 << 10, &log, rows)
            .await
            .unwrap();
        assert_eq!(how, Opened::Rebuilt);
        for round in 0..12 {
            let n = 1 + rng.below(if round % 4 == 0 { 3_000 } else { 200 });
            let from = log.len() as usize;
            for _ in 0..n {
                log.push(rng.entry(keys));
            }
            let changes = log.entries[from..].iter().flat_map(rows).collect();
            ix.apply(changes, log.stamp()).await.unwrap();
            let want = derive(&log.entries, rows);
            assert_eq!(
                all_rows(&ix).await,
                want,
                "seed {seed} round {round}: index == rebuild(log)"
            );
            assert_eq!(
                ix.root(),
                fresh_root(&want).await,
                "seed {seed} round {round}: one root for the same rows"
            );
            for _ in 0..20 {
                let k = (rng.below(keys) as u32).to_be_bytes().to_vec();
                assert_eq!(
                    ix.get(&k).await.unwrap(),
                    want.get(&k).cloned(),
                    "seed {seed} round {round}: get"
                );
            }
            let from = (rng.below(keys) as u32).to_be_bytes();
            let scanned = ix.scan(&from, 7).await.unwrap();
            let expected: Vec<Item> = want
                .range(from.to_vec()..)
                .take(7)
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            assert_eq!(scanned, expected, "seed {seed} round {round}: scan");
        }
        // reopened, it is current
        let (again, how) = ShelfIndex::open(mem.shelf(), "test", 64 << 10, &log, rows)
            .await
            .unwrap();
        assert_eq!(how, Opened::Current);
        assert_eq!(again.root(), ix.root());
    }
}

#[tokio::test]
async fn deleting_every_row_leaves_no_root() {
    let mut log = TestLog::new(b"log");
    let (mut ix, _) = ShelfIndex::open(Memory::new().shelf(), "test", 1 << 20, &log, rows)
        .await
        .unwrap();
    for k in 0..5_000 {
        log.push((k, Some(k)));
    }
    ix.apply(log.entries.iter().flat_map(rows).collect(), log.stamp())
        .await
        .unwrap();
    assert!(ix.root().is_some());
    let from = log.entries.len();
    for k in 0..5_000 {
        log.push((k, None));
    }
    ix.apply(
        log.entries[from..].iter().flat_map(rows).collect(),
        log.stamp(),
    )
    .await
    .unwrap();
    assert_eq!(ix.root(), None);
    assert!(all_rows(&ix).await.is_empty());
}

#[tokio::test]
async fn a_crash_at_any_write_opens_the_index_of_the_log() {
    let mut rng = Rng(77);
    let mut base = TestLog::new(b"log");
    for _ in 0..3_000 {
        base.push(rng.entry(1_000));
    }
    let mut more: Vec<Entry> = (0..2_000).map(|_| rng.entry(1_000)).collect();
    more.extend((0..500).map(|_| rng.entry(100_000)));
    // how many writes the whole run takes, uncrashed
    let count = Memory::new();
    let (_, _) = ShelfIndex::open(count.shelf(), "test", 1 << 20, &base, rows)
        .await
        .unwrap();
    let base_writes = i64::MAX - count.writes_left.load(Ordering::SeqCst);
    for crash_after in (0..base_writes + 40).step_by(3) {
        let mem = Memory::new();
        mem.writes_left.store(crash_after, Ordering::SeqCst);
        // the first run: an index of `base` built, then `more` appended in small steps, until the shelf crashes
        let mut log = TestLog::new(b"log");
        log.entries.clone_from(&base.entries);
        log.heads.clone_from(&base.heads);
        if let Ok((mut ix, _)) = ShelfIndex::open(mem.shelf(), "test", 1 << 20, &log, rows).await {
            for step in more.chunks(97) {
                let from = log.entries.len();
                step.iter().for_each(|e| log.push(*e));
                // the log's append is durable whether or not the index's write after it is
                if ix
                    .apply(
                        log.entries[from..].iter().flat_map(rows).collect(),
                        log.stamp(),
                    )
                    .await
                    .is_err()
                {
                    break;
                }
            }
        }
        // a restart: the log as it stands, the shelf whatever the crash left
        mem.writes_left.store(i64::MAX, Ordering::SeqCst);
        let (ix, _) = ShelfIndex::open(mem.shelf(), "test", 1 << 20, &log, rows)
            .await
            .unwrap();
        let want = derive(&log.entries, rows);
        assert_eq!(
            all_rows(&ix).await,
            want,
            "crash after {crash_after} writes"
        );
        assert_eq!(ix.stamp(), log.stamp());
        assert_eq!(ix.root(), fresh_root(&want).await);
    }
}

#[tokio::test]
async fn a_torn_slot_a_lost_page_or_a_rewritten_log_never_reads_as_the_index() {
    let mut rng = Rng(5);
    let mem = Memory::new();
    let mut log = TestLog::new(b"log");
    for _ in 0..2_000 {
        log.push(rng.entry(5_000));
    }
    let (mut ix, _) = ShelfIndex::open(mem.shelf(), "test", 1 << 20, &log, rows)
        .await
        .unwrap();
    let from = log.entries.len();
    for _ in 0..50 {
        log.push(rng.entry(5_000));
    }
    ix.apply(
        log.entries[from..].iter().flat_map(rows).collect(),
        log.stamp(),
    )
    .await
    .unwrap();

    // the newest slot torn: the older one opens, and the rest is stepped on
    let newest = ix.slot_name(ix.kept);
    let torn = {
        let mut objects = mem.objects.lock().unwrap();
        let held = objects.get(&newest).unwrap().clone();
        objects.insert(newest.clone(), held.slice(..held.len() - 3));
        held
    };
    let (open, how) = ShelfIndex::open(mem.shelf(), "test", 1 << 20, &log, rows)
        .await
        .unwrap();
    assert_eq!(how, Opened::CaughtUp(50));
    assert_eq!(all_rows(&open).await, derive(&log.entries, rows));
    mem.objects.lock().unwrap().insert(newest, torn);

    // a lost page: a read that needs it fails, never answering other rows; built again, it is the log's index
    let root = ix.root().unwrap();
    let top = ix.page(root, None).await.unwrap();
    assert!(top.level >= 1, "a tree of more than one page");
    let lost = ix.page_name(&top.items[0].1.as_slice().try_into().unwrap());
    mem.objects.lock().unwrap().remove(&lost).unwrap();
    let (mut open, _) = ShelfIndex::open(mem.shelf(), "test", 0, &log, rows)
        .await
        .unwrap();
    let read = open.scan(&[], usize::MAX).await;
    assert_eq!(read.unwrap_err().kind(), io::ErrorKind::NotFound);
    open.rebuild(&log, rows).await.unwrap();
    assert_eq!(all_rows(&open).await, derive(&log.entries, rows));
    assert_eq!(open.root(), Some(root));
    // a page whose bytes changed: refused as it is read
    mem.objects
        .lock()
        .unwrap()
        .insert(lost, Bytes::from_static(b"avenDB index page 1\nnot a page"));
    let (open, _) = ShelfIndex::open(mem.shelf(), "test", 0, &log, rows)
        .await
        .unwrap();
    let read = open.scan(&[], usize::MAX).await;
    assert_eq!(read.unwrap_err().kind(), io::ErrorKind::InvalidData);

    // a log rewritten from a place (a withdrawal), as long as before: the stamp names no prefix of it
    let mut rewritten = TestLog::new(b"log");
    for e in &log.entries[..1_000] {
        rewritten.push(*e);
    }
    for _ in 1_000..log.entries.len() {
        rewritten.push(rng.entry(5_000));
    }
    let (open, how) = ShelfIndex::open(mem.shelf(), "test", 1 << 20, &rewritten, rows)
        .await
        .unwrap();
    assert_eq!(how, Opened::Rebuilt);
    assert_eq!(all_rows(&open).await, derive(&rewritten.entries, rows));
}

#[tokio::test]
async fn pages_in_memory_stay_within_the_budget() {
    let mut log = TestLog::new(b"log");
    for k in 0..60_000 {
        log.push((k * 7, Some(k)));
    }
    let budget = 64 << 10;
    let (ix, _) = ShelfIndex::open(Memory::new().shelf(), "test", budget, &log, rows)
        .await
        .unwrap();
    for k in (0..60_000).step_by(997) {
        assert_eq!(
            ix.get(&(k * 7u32).to_be_bytes()).await.unwrap(),
            Some(k.to_be_bytes().to_vec())
        );
    }
    let pages = ix.pages.lock().unwrap();
    assert!(
        pages.held <= budget + MOST * 128,
        "{} bytes of pages held",
        pages.held
    );
}

#[test]
fn pages_and_slots_refuse_bytes_that_are_not_one_whole() {
    let items = vec![
        (b"a".to_vec(), b"1".to_vec()),
        (b"b".to_vec(), b"2".to_vec()),
    ];
    let bytes = Node::to_bytes(0, &items);
    assert_eq!(Node::from_bytes(&bytes).unwrap().items, items);
    assert!(Node::from_bytes(&bytes[..bytes.len() - 1]).is_none());
    let mut long = bytes.clone();
    long.push(0);
    assert!(Node::from_bytes(&long).is_none());
    let unsorted = Node::to_bytes(0, &[items[1].clone(), items[0].clone()]);
    assert!(Node::from_bytes(&unsorted).is_none());
    // a page above the rows names children by 32-byte hashes only
    assert!(Node::from_bytes(&Node::to_bytes(1, &items)).is_none());
    assert!(slot_of(b"short").is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn the_macs_folder_shelf_holds_an_index_across_a_restart() {
    let mut n = [0; 8];
    getrandom::fill(&mut n).unwrap();
    let dir = std::env::temp_dir().join(format!("avendb-index-{}", HEXLOWER.encode(&n)));
    let mut rng = Rng(11);
    let mut log = TestLog::new(b"log");
    for _ in 0..3_000 {
        log.push(rng.entry(10_000));
    }
    let owner = crate::disk::open(&dir).unwrap().writer().unwrap();
    let (ix, how) = ShelfIndex::open(owner.shelf(), "test", 1 << 20, &log, rows)
        .await
        .unwrap();
    assert_eq!(how, Opened::Rebuilt);
    let root = ix.root();
    drop(ix);
    owner.shutdown().await.unwrap();
    for _ in 0..10 {
        log.push(rng.entry(10_000));
    }
    let owner = crate::disk::open(&dir).unwrap().writer().unwrap();
    let (ix, how) = ShelfIndex::open(owner.shelf(), "test", 1 << 20, &log, rows)
        .await
        .unwrap();
    assert_eq!(how, Opened::CaughtUp(10));
    assert_ne!(ix.root(), root);
    assert_eq!(all_rows(&ix).await, derive(&log.entries, rows));
    drop(ix);
    owner.shutdown().await.unwrap();
    std::fs::remove_dir_all(&dir).ok();
}
