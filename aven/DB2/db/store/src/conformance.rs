//! The conformance suite: the contract's behaviour as cases every backend must pass. Each case runs on a fresh,
//! empty store, and reports instead of panicking, so the same suite runs under `cargo test` and in a browser.

use std::fmt;

use bytes::Bytes;
use futures::future::join_all;

use crate::{Error, Hash, RefName, Store};

type Outcome = Result<(), String>;

macro_rules! check {
    ($cond:expr, $($why:tt)+) => {
        if !$cond {
            return Err(format!($($why)+));
        }
    };
}

macro_rules! ok {
    ($result:expr) => {
        $result.map_err(|e| format!("{}: {e}", stringify!($result)))?
    };
}

pub const CASES: &[&str] = &[
    "blob_round_trip",
    "blob_same_bytes_one_blob",
    "blob_empty",
    "blob_missing",
    "blob_range",
    "blob_list_and_delete",
    "blob_never_changes",
    "ref_round_trip",
    "ref_stale_writer_refused",
    "ref_one_of_racing_writers_wins",
    "ref_never_torn",
    "refs_and_blobs_apart",
];

/// Runs every case, each on a fresh store from `fresh`.
pub async fn run<S: Store>(mut fresh: impl AsyncFnMut() -> S) -> Report {
    let mut outcomes = Vec::new();
    for &case in CASES {
        let store = fresh().await;
        outcomes.push((case, run_case(case, &store).await));
    }
    Report(outcomes)
}

async fn run_case(case: &str, s: &impl Store) -> Outcome {
    match case {
        "blob_round_trip" => blob_round_trip(s).await,
        "blob_same_bytes_one_blob" => blob_same_bytes_one_blob(s).await,
        "blob_empty" => blob_empty(s).await,
        "blob_missing" => blob_missing(s).await,
        "blob_range" => blob_range(s).await,
        "blob_list_and_delete" => blob_list_and_delete(s).await,
        "blob_never_changes" => blob_never_changes(s).await,
        "ref_round_trip" => ref_round_trip(s).await,
        "ref_stale_writer_refused" => ref_stale_writer_refused(s).await,
        "ref_one_of_racing_writers_wins" => ref_one_of_racing_writers_wins(s).await,
        "ref_never_torn" => ref_never_torn(s).await,
        "refs_and_blobs_apart" => refs_and_blobs_apart(s).await,
        _ => Err(format!("no case {case}")),
    }
}

pub struct Report(pub Vec<(&'static str, Outcome)>);

impl Report {
    pub fn passed(&self) -> bool {
        self.0.iter().all(|(_, outcome)| outcome.is_ok())
    }
}

impl fmt::Display for Report {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (case, outcome) in &self.0 {
            match outcome {
                Ok(()) => writeln!(f, "ok    {case}")?,
                Err(why) => writeln!(f, "FAIL  {case}: {why}")?,
            }
        }
        let passed = self.0.iter().filter(|(_, o)| o.is_ok()).count();
        write!(f, "{passed} of {} cases passed", self.0.len())
    }
}

/// Bytes that look random, the same on every run.
pub fn noise(len: usize, seed: u64) -> Bytes {
    let mut x = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
    (0..len)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            x as u8
        })
        .collect()
}

fn name(s: &str) -> RefName {
    RefName::new(s).expect("a valid name")
}

async fn blob_round_trip(s: &impl Store) -> Outcome {
    let bytes = Bytes::from_static(b"a sealed blob");
    let hash = ok!(s.put(bytes.clone()).await);
    check!(
        hash == Hash::of(&bytes),
        "put named it {hash}, not by its BLAKE3 hash"
    );
    check!(
        ok!(s.get(&hash).await) == Some(bytes),
        "get returned other bytes"
    );
    check!(ok!(s.has(&hash).await), "has says it's missing");
    Ok(())
}

async fn blob_same_bytes_one_blob(s: &impl Store) -> Outcome {
    let bytes = noise(1000, 1);
    let first = ok!(s.put(bytes.clone()).await);
    let second = ok!(s.put(bytes).await);
    check!(first == second, "the same bytes got two names");
    check!(
        ok!(s.list().await) == vec![first],
        "the same bytes twice aren't one blob"
    );
    Ok(())
}

async fn blob_empty(s: &impl Store) -> Outcome {
    let hash = ok!(s.put(Bytes::new()).await);
    check!(hash == Hash::of(b""), "the empty blob's name is wrong");
    check!(
        ok!(s.get(&hash).await) == Some(Bytes::new()),
        "the empty blob doesn't read back empty"
    );
    check!(
        ok!(s.get_range(&hash, 0..0).await) == Some(Bytes::new()),
        "its empty range isn't empty"
    );
    Ok(())
}

async fn blob_missing(s: &impl Store) -> Outcome {
    let hash = Hash::of(b"never put");
    check!(
        ok!(s.get(&hash).await).is_none(),
        "get found a blob never put"
    );
    check!(
        ok!(s.get_range(&hash, 0..1).await).is_none(),
        "get_range found a blob never put"
    );
    check!(!ok!(s.has(&hash).await), "has found a blob never put");
    ok!(s.delete(&hash).await);
    check!(ok!(s.list().await).is_empty(), "a fresh store lists blobs");
    Ok(())
}

async fn blob_range(s: &impl Store) -> Outcome {
    // Over a MiB, so backends that read in chunks cross a chunk.
    let len = (1 << 20) + 4099;
    let bytes = noise(len, 2);
    let hash = ok!(s.put(bytes.clone()).await);
    let n = len as u64;
    for range in [0..10, 1000..70_000, n - 10..n, 0..n, 7..7, n..n] {
        let want = bytes.slice(range.start as usize..range.end as usize);
        let got = ok!(s.get_range(&hash, range.clone()).await);
        check!(got == Some(want), "range {range:?} read other bytes");
    }
    for (start, end) in [(0, n + 1), (n + 1, n + 2), (5, 3)] {
        let refused = s.get_range(&hash, start..end).await;
        check!(
            refused == Err(Error::Range { start, end, len: n }),
            "range {start}..{end} gave {refused:?}"
        );
    }
    Ok(())
}

async fn blob_list_and_delete(s: &impl Store) -> Outcome {
    let mut hashes = Vec::new();
    for seed in 0..3 {
        hashes.push(ok!(s.put(noise(100, 10 + seed)).await));
    }
    hashes.sort();
    check!(
        ok!(s.list().await) == hashes,
        "list isn't every blob, sorted"
    );
    ok!(s.delete(&hashes[1]).await);
    check!(
        ok!(s.get(&hashes[1]).await).is_none(),
        "a deleted blob still reads"
    );
    check!(
        !ok!(s.has(&hashes[1]).await),
        "a deleted blob is still there"
    );
    check!(
        ok!(s.list().await) == vec![hashes[0], hashes[2]],
        "list still has the deleted blob"
    );
    ok!(s.delete(&hashes[1]).await);
    Ok(())
}

/// No appends: a blob is put once and never changes, whatever is put after it.
async fn blob_never_changes(s: &impl Store) -> Outcome {
    let a = noise(5000, 3);
    let ha = ok!(s.put(a.clone()).await);
    let hb = ok!(s.put(noise(7000, 4)).await);
    ok!(s.put(a.clone()).await);
    check!(ha != hb, "two different blobs share a name");
    check!(
        ok!(s.get(&ha).await) == Some(a),
        "a blob changed after later puts"
    );
    Ok(())
}

async fn ref_round_trip(s: &impl Store) -> Outcome {
    let head = name("doc.3f9a.head");
    let (a, b) = (Hash::of(b"a"), Hash::of(b"b"));
    check!(
        ok!(s.get_ref(&head).await).is_none(),
        "a ref never set reads"
    );
    ok!(s.set_ref(&head, None, a).await);
    check!(
        ok!(s.get_ref(&head).await) == Some(a),
        "a new ref doesn't read back"
    );
    ok!(s.set_ref(&head, Some(a), b).await);
    check!(
        ok!(s.get_ref(&head).await) == Some(b),
        "a moved ref doesn't read back"
    );
    let other = name("peer.key");
    ok!(s.set_ref(&other, None, a).await);
    check!(
        ok!(s.list_refs().await) == vec![head.clone(), other.clone()],
        "list_refs isn't every ref, sorted"
    );
    ok!(s.delete_ref(&head, b).await);
    check!(
        ok!(s.get_ref(&head).await).is_none(),
        "a deleted ref still reads"
    );
    check!(
        ok!(s.list_refs().await) == vec![other],
        "list_refs still has the deleted ref"
    );
    Ok(())
}

/// Compare-and-set: a writer holding a stale value is refused, and the ref keeps what it held.
async fn ref_stale_writer_refused(s: &impl Store) -> Outcome {
    let head = name("head");
    let (a, b, c) = (Hash::of(b"a"), Hash::of(b"b"), Hash::of(b"c"));
    let stale_at_a = Err(Error::Stale { current: Some(a) });
    ok!(s.set_ref(&head, None, a).await);
    check!(
        s.set_ref(&head, None, b).await == stale_at_a,
        "creating over an existing ref wasn't refused"
    );
    check!(
        s.set_ref(&head, Some(b), c).await == stale_at_a,
        "a stale set wasn't refused"
    );
    check!(
        s.delete_ref(&head, b).await == stale_at_a,
        "a stale delete wasn't refused"
    );
    check!(
        ok!(s.get_ref(&head).await) == Some(a),
        "a refused write changed the ref"
    );
    let missing = name("missing");
    let stale_at_none = Err(Error::Stale { current: None });
    check!(
        s.set_ref(&missing, Some(a), b).await == stale_at_none,
        "moving a missing ref wasn't refused"
    );
    check!(
        s.delete_ref(&missing, a).await == stale_at_none,
        "deleting a missing ref wasn't refused"
    );
    check!(
        ok!(s.get_ref(&missing).await).is_none(),
        "a refused write created a ref"
    );
    Ok(())
}

/// The one writer's tasks race: all expect the same value, exactly one moves it.
async fn ref_one_of_racing_writers_wins(s: &impl Store) -> Outcome {
    let head = name("head");
    let start = Hash::of(b"start");
    ok!(s.set_ref(&head, None, start).await);
    let news: Vec<Hash> = (0..8u8).map(|i| Hash::of(&[i])).collect();
    let results = join_all(news.iter().map(|&new| s.set_ref(&head, Some(start), new))).await;
    let winners: Vec<Hash> = news
        .iter()
        .zip(&results)
        .filter(|(_, r)| r.is_ok())
        .map(|(h, _)| *h)
        .collect();
    check!(
        winners.len() == 1,
        "{} of 8 racing writers won",
        winners.len()
    );
    for result in &results {
        check!(
            matches!(result, Ok(()) | Err(Error::Stale { .. })),
            "a racing writer got {result:?}"
        );
    }
    check!(
        ok!(s.get_ref(&head).await) == Some(winners[0]),
        "the ref doesn't hold the winner's value"
    );
    Ok(())
}

/// Readers beside a writer see the old value or the new one, never a torn one.
async fn ref_never_torn(s: &impl Store) -> Outcome {
    let head = name("head");
    let (a, b) = (Hash::of(b"a"), Hash::of(b"b"));
    ok!(s.set_ref(&head, None, a).await);
    let flips = 40;
    let writer = async {
        let mut now = a;
        for _ in 0..flips {
            let next = if now == a { b } else { a };
            s.set_ref(&head, Some(now), next).await?;
            now = next;
        }
        Ok::<_, Error>(())
    };
    let readers = join_all((0..4).map(|_| async {
        let mut seen = Vec::new();
        for _ in 0..flips {
            seen.push(s.get_ref(&head).await);
        }
        seen
    }));
    let (written, seen) = futures::join!(writer, readers);
    ok!(written);
    for read in seen.into_iter().flatten() {
        check!(
            matches!(read, Ok(Some(h)) if h == a || h == b),
            "a reader saw {read:?}"
        );
    }
    Ok(())
}

async fn refs_and_blobs_apart(s: &impl Store) -> Outcome {
    let hash = ok!(s.put(Bytes::from_static(b"x")).await);
    ok!(s.set_ref(&name(&hash.to_hex()), None, hash).await);
    check!(
        ok!(s.list().await) == vec![hash],
        "a ref shows among the blobs"
    );
    check!(
        ok!(s.list_refs().await) == vec![name(&hash.to_hex())],
        "a blob shows among the refs"
    );
    ok!(s.delete(&hash).await);
    check!(
        ok!(s.get_ref(&name(&hash.to_hex())).await) == Some(hash),
        "deleting a blob touched a ref"
    );
    Ok(())
}

/// A small, fixed workload, timed by `now` (milliseconds): what each backend costs, side by side.
pub async fn bench(
    s: &impl Store,
    now: impl Fn() -> f64,
) -> Result<Vec<(&'static str, f64)>, Error> {
    let mut times = Vec::new();
    let small: Vec<Bytes> = (0..200).map(|i| noise(4096, 1000 + i)).collect();
    let t = now();
    let mut hashes = Vec::new();
    for bytes in &small {
        hashes.push(s.put(bytes.clone()).await?);
    }
    times.push(("put 200 × 4 KiB", now() - t));
    let t = now();
    for hash in &hashes {
        s.get(hash).await?;
    }
    times.push(("get 200 × 4 KiB", now() - t));
    let big = noise(8 << 20, 7);
    let t = now();
    let hash = s.put(big).await?;
    times.push(("put 8 MiB", now() - t));
    let t = now();
    s.get(&hash).await?;
    times.push(("get 8 MiB", now() - t));
    let t = now();
    for i in 0..100u64 {
        s.get_range(&hash, i * 4096..(i + 1) * 4096).await?;
    }
    times.push(("100 ranges × 4 KiB of 8 MiB", now() - t));
    let head = name("bench.head");
    let t = now();
    let mut at = None;
    for hash in hashes.iter().take(100) {
        s.set_ref(&head, at, *hash).await?;
        at = Some(*hash);
    }
    times.push(("set_ref 100 ×", now() - t));
    Ok(times)
}
