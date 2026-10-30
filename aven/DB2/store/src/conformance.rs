//! The conformance suite every backend must pass. What the contract answers is Lean's (`Aven.DB.Store`, README rule
//! 10): the suite replays the model's traces (`db/spec/vectors/store.json`), each on a fresh, empty store, and every
//! call must give the model's result. Beside them stay the mechanics the model doesn't have: ranges over a MiB, so
//! backends that read in chunks cross one; racing writers; readers beside a writer. Cases report instead of
//! panicking, so the same suite runs under `cargo test` and in a browser.

use std::fmt;

use bytes::Bytes;
use futures::future::join_all;
use serde_json::{Value, json};

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

/// The mechanics, beside the model's traces.
pub const CASES: &[&str] = &[
    "blob_range",
    "ref_one_of_racing_writers_wins",
    "ref_never_torn",
    "ref_at_rest_in_either_form",
];

/// A ref's bytes at rest, as a driver keeps them: what one case needs beyond the contract, to see the form a driver
/// writes (Lean `Store.refText`) and to leave a ref in the form another driver wrote (`Store.readRef`).
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
pub trait RefsAtRest {
    /// The ref's bytes as they rest, or `None`.
    async fn ref_bytes(&self, name: &RefName) -> Result<Option<Bytes>, Error>;
    /// Leaves `bytes` as the ref's, as they are.
    async fn put_ref_bytes(&self, name: &RefName, bytes: &[u8]) -> Result<(), Error>;
}

/// Runs every case and every trace of `traces` (the model's `store.json`), each on a fresh store from `fresh`.
pub async fn run<S: Store + RefsAtRest>(mut fresh: impl AsyncFnMut() -> S, traces: &str) -> Report {
    let mut outcomes = Vec::new();
    for &case in CASES {
        let store = fresh().await;
        outcomes.push((case.to_string(), run_case(case, &store).await));
    }
    match serde_json::from_str::<Vec<Value>>(traces) {
        Ok(traces) => {
            for trace in &traces {
                let store = fresh().await;
                let name = format!("trace: {}", trace["name"].as_str().unwrap_or("?"));
                outcomes.push((name, follows(&store, trace).await));
            }
        }
        Err(e) => outcomes.push(("the model's traces".into(), Err(format!("not JSON: {e}")))),
    }
    Report(outcomes)
}

async fn run_case(case: &str, s: &(impl Store + RefsAtRest)) -> Outcome {
    match case {
        "ref_at_rest_in_either_form" => ref_at_rest_in_either_form(s).await,
        "blob_range" => blob_range(s).await,
        "ref_one_of_racing_writers_wins" => ref_one_of_racing_writers_wins(s).await,
        "ref_never_torn" => ref_never_torn(s).await,
        _ => Err(format!("no case {case}")),
    }
}

/// A trace on a fresh store: each call's result must be the model's.
async fn follows(s: &impl Store, trace: &Value) -> Outcome {
    let ops = trace["input"]["ops"]
        .as_array()
        .ok_or("a trace without ops")?;
    let want = trace["expected"]
        .as_array()
        .ok_or("a trace without results")?;
    check!(
        ops.len() == want.len(),
        "{} calls, {} results",
        ops.len(),
        want.len()
    );
    for (at, (op, want)) in ops.iter().zip(want).enumerate() {
        let got = call(s, op).await;
        check!(
            &got == want,
            "call {at}, {op}: {got}, not the model's {want}"
        );
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Option<Bytes> {
    (0..s.len())
        .step_by(2)
        .map(|i| s.get(i..i + 2).and_then(|b| u8::from_str_radix(b, 16).ok()))
        .collect::<Option<Vec<u8>>>()
        .map(Bytes::from)
}

/// The contract's errors in the model's form; any other is a backend's, which no trace expects.
fn error(e: Error) -> Value {
    match e {
        Error::Stale { current } => {
            json!({ "error": "stale", "current": current.map(|h| h.to_hex()) })
        }
        Error::Range { start, end, len } => {
            json!({ "error": "range", "start": start, "end": end, "len": len })
        }
        Error::InvalidName(name) => json!({ "error": "invalidName", "name": name }),
        other => json!({ "error": other.to_string() }),
    }
}

fn ok<T>(result: Result<T, Error>, value: impl FnOnce(T) -> Value) -> Value {
    match result {
        Ok(t) => json!({ "ok": value(t) }),
        Err(e) => error(e),
    }
}

/// One call of a trace (`Aven.DB.Json`) on the store, and its result in the model's form.
pub async fn call(s: &impl Store, op: &Value) -> Value {
    let text = |i: usize| op[i].as_str().unwrap_or_default();
    let hash = |i: usize| text(i).parse::<Hash>();
    let num = |i: usize| op[i].as_u64().unwrap_or_default();
    let bytes = |b: Option<Bytes>| json!(b.map(|b| hex(&b)));
    match text(0) {
        "put" => match unhex(text(1)) {
            Some(b) => ok(s.put(b).await, |h| json!(h.to_hex())),
            None => json!({ "error": "the trace's bytes aren't hex" }),
        },
        "get" => match hash(1) {
            Ok(h) => ok(s.get(&h).await, bytes),
            Err(e) => error(e),
        },
        "getRange" => match hash(1) {
            Ok(h) => ok(s.get_range(&h, num(2)..num(3)).await, bytes),
            Err(e) => error(e),
        },
        "size" => match hash(1) {
            Ok(h) => ok(s.size(&h).await, |n| json!(n)),
            Err(e) => error(e),
        },
        "has" => match hash(1) {
            Ok(h) => ok(s.has(&h).await, |b| json!(b)),
            Err(e) => error(e),
        },
        "list" => ok(s.list().await, |l| {
            json!(l.iter().map(Hash::to_hex).collect::<Vec<_>>())
        }),
        "delete" => match hash(1) {
            Ok(h) => ok(s.delete(&h).await, |()| Value::Null),
            Err(e) => error(e),
        },
        "getRef" => match RefName::new(text(1)) {
            Ok(n) => ok(s.get_ref(&n).await, |h| json!(h.map(|h| h.to_hex()))),
            Err(e) => error(e),
        },
        "setRef" => {
            let expected = match op[2].as_str().map(str::parse::<Hash>).transpose() {
                Ok(e) => e,
                Err(e) => return error(e),
            };
            match (RefName::new(text(1)), hash(3)) {
                (Ok(n), Ok(new)) => ok(s.set_ref(&n, expected, new).await, |()| Value::Null),
                (Err(e), _) | (_, Err(e)) => error(e),
            }
        }
        "deleteRef" => match (RefName::new(text(1)), hash(2)) {
            (Ok(n), Ok(e)) => ok(s.delete_ref(&n, e).await, |()| Value::Null),
            (Err(e), _) | (_, Err(e)) => error(e),
        },
        "listRefs" => ok(s.list_refs().await, |l| {
            json!(l.iter().map(RefName::as_str).collect::<Vec<_>>())
        }),
        other => json!({ "error": format!("no call {other}") }),
    }
}

pub struct Report(pub Vec<(String, Outcome)>);

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

/// A ref rests as its hash and a newline, and reads back, and is changed by compare-and-set, whether it rests so or
/// bare, as the opfs driver of 30 Oct 2026 left it: a browser keeps what every driver wrote.
async fn ref_at_rest_in_either_form(s: &(impl Store + RefsAtRest)) -> Outcome {
    let h = ok!(s.put(Bytes::from_static(b"a ref at rest")).await);
    let next = ok!(s.put(Bytes::from_static(b"the next one")).await);
    let name = RefName::new("at-rest").expect("a name");
    ok!(s.set_ref(&name, None, h).await);
    let stored = ok!(s.ref_bytes(&name).await);
    check!(
        stored.as_deref() == Some(h.ref_text().as_bytes()),
        "a ref rests as {stored:?}, not its hash and a newline"
    );
    for (form, text) in [("with its newline", h.ref_text()), ("bare", h.to_hex())] {
        let name = RefName::new(format!("at-rest-{}", text.len())).expect("a name");
        ok!(s.put_ref_bytes(&name, text.as_bytes()).await);
        check!(ok!(s.get_ref(&name).await) == Some(h), "a ref resting {form} doesn't read back");
        check!(ok!(s.list_refs().await).contains(&name), "a ref resting {form} isn't listed");
        ok!(s.set_ref(&name, Some(h), next).await);
        check!(ok!(s.get_ref(&name).await) == Some(next), "a ref resting {form} isn't changed by compare-and-set");
        let stored = ok!(s.ref_bytes(&name).await);
        check!(stored.as_deref() == Some(next.ref_text().as_bytes()), "rewritten, a ref rests as {stored:?}");
    }
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

/// The real workload, timed by `now` (milliseconds): a chat line (one small blob and its device's head moved, median of
/// 50), a 1 MiB chunk put (median of 50), and catching up 500 lines (each a blob, the head moved once at the end). Each
/// entry is (what, ms); the gates are per engine (`opfs/run.mjs`, store/README.md).
pub async fn workload(
    s: &impl Store,
    now: impl Fn() -> f64,
) -> Result<Vec<(&'static str, f64)>, Error> {
    fn median(mut v: Vec<f64>) -> f64 {
        v.sort_by(f64::total_cmp);
        v[v.len() / 2]
    }
    let head = name("chat-bench");
    let mut at = None;
    let mut lines = Vec::new();
    for i in 0..50 {
        let t = now();
        let h = s.put(noise(200, 5000 + i)).await?;
        s.set_ref(&head, at, h).await?;
        at = Some(h);
        lines.push(now() - t);
    }
    let mut chunks = Vec::new();
    for i in 0..50 {
        let bytes = noise(1 << 20, 6000 + i);
        let t = now();
        s.put(bytes).await?;
        chunks.push(now() - t);
    }
    let caught = name("chat-caught-up");
    let t = now();
    let mut last = None;
    for i in 0..500 {
        last = Some(s.put(noise(200, 7000 + i)).await?);
    }
    if let Some(h) = last {
        s.set_ref(&caught, None, h).await?;
    }
    let catch_up = now() - t;
    Ok(vec![
        ("line", median(lines)),
        ("chunk", median(chunks)),
        ("catch-up", catch_up),
    ])
}
