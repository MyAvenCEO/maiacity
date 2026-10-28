//! The told index held to its model, `avendb::index::Rows` (`ToldIndex.lean`): after every tell it says what `Rows`
//! says (the digests, and `find` page by page), and holds the rows a rebuild from `Rows` holds, with the same root; a
//! crash at any write of a tell loses that tell alone, which the device's next offer brings again.

use std::sync::atomic::Ordering;

use super::*;
use crate::shelf_index::tests::Memory;

/// A small generator of numbers, seeded.
struct Seq(u64);

impl Seq {
    fn next(&mut self, n: u64) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0 % n
    }
}

fn device(n: u64) -> SignerId {
    SignerId([n as u8 + 1; 32])
}

fn vault(n: u64) -> VaultId {
    VaultId([n as u8 + 100; 32])
}

fn entry(n: u64) -> EntryId {
    let mut id = [0; 32];
    id[24..].copy_from_slice(&n.to_be_bytes());
    EntryId(id)
}

fn token(n: u64) -> Token {
    [n as u8; 16]
}

/// A tell: a device's rows of a vault, and which entries the peer takes a row of.
fn tell(seq: &mut Seq) -> (SignerId, VaultId, Vec<Row>, u64) {
    let rows = (0..seq.next(12))
        .map(|_| Row {
            entry: entry(seq.next(30)),
            epoch: seq.next(4),
            tokens: (0..seq.next(4)).map(|_| token(seq.next(8))).collect(),
        })
        .collect();
    (device(seq.next(7)), vault(seq.next(2)), rows, seq.next(5))
}

/// `Rows::find`, as `Shared::answer_find` reads it off the told index: stretches of candidates, each held to `syncs`.
async fn find(
    told: &ToldIndex,
    v: Option<VaultId>,
    tokens: &[Token],
    after: Option<EntryId>,
    syncs: impl Fn(EntryId) -> bool,
) -> (Vec<EntryId>, bool) {
    let (mut out, mut at) = (Vec::new(), after);
    loop {
        let (got, more) = told.candidates(v, tokens, at, 2 * index::FIND_PAGE).await.unwrap();
        at = got.last().copied().or(at);
        out.extend(got.into_iter().filter(|e| syncs(*e)));
        if out.len() > index::FIND_PAGE || !more {
            break;
        }
    }
    let more = out.len() > index::FIND_PAGE;
    out.truncate(index::FIND_PAGE);
    (out, more)
}

async fn same(told: &ToldIndex, model: &Rows, seq: &mut Seq, at: &str) {
    for d in 0..7 {
        for v in 0..2 {
            assert_eq!(told.told(device(d), vault(v)).await.unwrap(), model.told(device(d), vault(v)), "{at}");
        }
    }
    assert_eq!(told.size().await.unwrap(), model.size(), "{at}");
    for _ in 0..4 {
        let tokens: Vec<Token> = (0..1 + seq.next(3)).map(|_| token(seq.next(8))).collect();
        let v = (seq.next(3) < 2).then(|| vault(seq.next(2)));
        let after = (seq.next(2) == 0).then(|| entry(seq.next(30)));
        let odd = seq.next(2) == 0;
        let syncs = |e: EntryId| !odd || e.0[31] % 2 == 1;
        assert_eq!(find(told, v, &tokens, after, syncs).await, model.find(v, &tokens, after, syncs), "{at}");
    }
    // a rebuild from the model: the same rows, the same root
    let rebuilt = ToldIndex::open(Memory::new().shelf(), Some(model.clone())).await.unwrap();
    assert_eq!(told.rows().await.unwrap(), rebuilt.rows().await.unwrap(), "{at}");
    assert_eq!(told.root().await.0, rebuilt.root().await.0, "{at}");
}

#[tokio::test]
async fn after_every_tell_the_index_says_what_rows_says_and_is_its_rebuild() {
    let mut seq = Seq(0x2545_f491_4f6c_dd1d);
    let told = ToldIndex::open(Memory::new().shelf(), None).await.unwrap();
    let mut model = Rows::default();
    for n in 0..120 {
        let (d, v, rows, skip) = tell(&mut seq);
        let keep = |e: EntryId| e.0[31] as u64 % 5 != skip;
        let a = model.take(d, v, rows.clone(), keep);
        let b = told.take(d, v, rows, keep).await.unwrap();
        assert_eq!(a, b, "tell {n} takes as many");
        same(&told, &model, &mut seq, &format!("after tell {n}")).await;
    }
    assert!(model.size().0 > 20, "the rows pile up: {:?}", model.size());
}

#[tokio::test]
async fn a_crash_at_any_write_loses_that_tell_alone_which_comes_again() {
    let mut lost = 0;
    for crash_after in 0..10 {
        let mut seq = Seq(0x9e37_79b9 + crash_after as u64);
        let memory = Memory::new();
        let told = ToldIndex::open(memory.shelf(), None).await.unwrap();
        let mut model = Rows::default();
        for _ in 0..20 {
            let (d, v, rows, _) = tell(&mut seq);
            model.take(d, v, rows.clone(), |_| true);
            told.take(d, v, rows, |_| true).await.unwrap();
        }
        let (d, v, mut rows, _) = tell(&mut seq);
        rows.push(Row { entry: entry(31), epoch: 9, tokens: vec![token(1)] });
        memory.writes_left.store(crash_after, Ordering::SeqCst);
        let crashed = told.take(d, v, rows.clone(), |_| true).await;
        memory.writes_left.store(i64::MAX, Ordering::SeqCst);
        // the peer starts again from its newest slot that opens
        let told = ToldIndex::open(memory.shelf(), None).await.unwrap();
        let digest = index::digest(v, &rows);
        match crashed {
            // its slot went down: the tell is in
            Ok(_) => assert_eq!(told.told(d, v).await.unwrap(), Some(digest)),
            // else the peer holds the rows of before it, and its offer's answer asks for the vault again
            Err(_) => {
                lost += 1;
                assert_ne!(told.told(d, v).await.unwrap(), Some(digest), "a lost tell is asked for again");
                same(&told, &model, &mut seq, &format!("before the tell, crash after {crash_after}")).await;
                told.take(d, v, rows.clone(), |_| true).await.unwrap();
            }
        }
        model.take(d, v, rows, |_| true);
        same(&told, &model, &mut seq, &format!("crash after {crash_after}: {crashed:?}")).await;
    }
    assert!(lost > 0, "some crashes came before the slot");
}

/// The scale of the told index (batch 5): what the always-on peer holds in memory of `AVENDB_TOLD_N` rows (1M if
/// unset), told by 100 devices of one vault, how long it takes to open them, and a find, on a folder shelf.
///
///   cargo test --release -p avendb-net --features test-fixtures --lib -- --ignored --nocapture told_index::tests::bench_told
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore]
async fn bench_told() {
    use std::time::Instant;
    let n: u64 = std::env::var("AVENDB_TOLD_N").ok().and_then(|n| n.parse().ok()).unwrap_or(1_000_000);
    let dir = std::env::temp_dir().join(format!("avendb-told-bench-{}", std::process::id()));
    let owner = crate::disk::open(&dir).unwrap().writer().unwrap();
    let shelf = owner.shelf();
    let told = ToldIndex::open(shelf.clone(), None).await.unwrap();
    let devices = 100;
    let per = n / devices;
    let t = Instant::now();
    for d in 0..devices {
        let rows = (0..per)
            .map(|k| Row { entry: entry(d * per + k), epoch: 1, tokens: vec![token(k % 16), token(16 + d % 4)] })
            .collect();
        told.take(SignerId([d as u8; 32]), vault(0), rows, |_| true).await.unwrap();
    }
    let build = t.elapsed();
    drop(told);
    let rss = || {
        std::fs::read_to_string("/proc/self/status")
            .ok()
            .and_then(|s| s.lines().find(|l| l.starts_with("VmRSS:")).map(|l| l.to_string()))
            .unwrap_or_default()
    };
    let before = rss();
    let t = Instant::now();
    let told = ToldIndex::open(shelf.clone(), None).await.unwrap();
    let open = t.elapsed();
    let t = Instant::now();
    let (found, more) = told.candidates(Some(vault(0)), &[token(3)], None, index::FIND_PAGE).await.unwrap();
    let first_find = t.elapsed();
    let t = Instant::now();
    let again = told.candidates(Some(vault(0)), &[token(3)], found.last().copied(), index::FIND_PAGE).await.unwrap();
    let next_find = t.elapsed();
    let t = Instant::now();
    let one = told.told(SignerId([7; 32]), vault(0)).await.unwrap();
    let digest = t.elapsed();
    println!(
        "BENCH {}",
        serde_json::json!({ "bench": "told_index", "rows": devices * per, "build_s": build.as_secs_f64(),
            "open_ms": open.as_secs_f64() * 1e3, "first_find_ms": first_find.as_secs_f64() * 1e3,
            "next_find_ms": next_find.as_secs_f64() * 1e3, "digest_ms": digest.as_secs_f64() * 1e3,
            "pages_budget_mb": BUDGET >> 20, "found": found.len(), "more": more, "again": again.0.len(),
            "told": one.is_some(), "rss_before_open": before, "rss_after_finds": rss() })
    );
    owner.shutdown().await.ok();
    std::fs::remove_dir_all(&dir).ok();
}
