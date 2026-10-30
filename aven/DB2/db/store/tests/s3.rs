//! The conformance suite on S3, against the box's server (`bun run up` starts it, the service `s3` in
//! `sandbox/box/compose.yml`). `AVEN_DB_S3_ENDPOINT` points elsewhere; every run writes under a prefix of its own.

#![cfg(not(target_arch = "wasm32"))]

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// The model's traces (`lake exe vectors` in db/spec), which the suite replays.
const TRACES: &str = include_str!("../../spec/vectors/store.json");

use aven_db_store::backend::{self, Conditions, S3};
use aven_db_store::{Error, Hash, RefName, Store, conformance};

fn fresh() -> S3 {
    static N: AtomicU32 = AtomicU32::new(0);
    let run = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    S3 {
        endpoint: std::env::var("AVEN_DB_S3_ENDPOINT")
            .unwrap_or_else(|_| "http://127.0.0.1:7070".into()),
        region: "us-east-1".into(),
        bucket: "aven-db-store".into(),
        root: format!("/run-{run}-{}/", N.fetch_add(1, Ordering::Relaxed)),
        access_key_id: "avensandbox".into(),
        secret_access_key: "avensandbox-test-secret".into(),
        conditions: Conditions::On,
    }
}

/// The same, without the server's conditional writes (`--s3-conditions off`).
fn unconditional() -> S3 {
    S3 {
        conditions: Conditions::Off,
        ..fresh()
    }
}

/// The same, with `If-None-Match: *` on creates only, as on Hetzner (`--s3-conditions create`).
fn creates_only() -> S3 {
    S3 {
        conditions: Conditions::Create,
        ..fresh()
    }
}

#[tokio::test]
async fn s3_passes_the_suite() {
    let report = conformance::run(async || backend::s3(&fresh()).unwrap(), TRACES).await;
    println!("{report}");
    bench(&backend::s3(&fresh()).unwrap()).await;
    assert!(
        report.passed(),
        "is the box's S3 server up? `bun run up` starts it"
    );
}

/// Without the server's conditional writes, the suite passes all the same: the store's lock and the one writer
/// refuse a stale write (a second writer could overwrite unseen, as on a folder).
#[tokio::test]
async fn s3_without_conditions_passes_the_suite() {
    let report = conformance::run(async || backend::s3(&unconditional()).unwrap(), TRACES).await;
    println!("{report}");
    assert!(!backend::s3(&unconditional()).unwrap().conditional_writes());
    assert!(report.passed(), "{report}");
}

/// S3 refuses a stale ref write itself, with `If-Match` and `If-None-Match`: even two writers on one prefix,
/// which rule 1 rules out, can't overwrite each other unseen. A folder or memory relies on the one writer alone.
#[tokio::test]
async fn s3_refuses_a_second_writers_stale_write() {
    let at = fresh();
    let (one, two) = (backend::s3(&at).unwrap(), backend::s3(&at).unwrap());
    assert!(
        one.conditional_writes(),
        "this server doesn't take conditional writes"
    );
    let head = RefName::new("head").unwrap();
    one.set_ref(&head, None, Hash::of(b"start")).await.unwrap();
    for round in 0..10 {
        let now = one.get_ref(&head).await.unwrap();
        // new values every round: S3's ETag is the content's MD5, so rewriting the same bytes keeps the tag
        let (b, c) = (
            Hash::of(format!("one {round}").as_bytes()),
            Hash::of(format!("two {round}").as_bytes()),
        );
        let (won_one, won_two) =
            futures::join!(one.set_ref(&head, now, b), two.set_ref(&head, now, c));
        assert!(
            won_one.is_ok() != won_two.is_ok(),
            "both or neither won: {won_one:?} {won_two:?}"
        );
        for lost in [won_one, won_two].into_iter().filter_map(Result::err) {
            assert!(matches!(lost, Error::Stale { .. }), "{lost:?}");
        }
    }
}

/// The bench's times, printed beside the suite's report (`-- --nocapture` shows them).
async fn bench(store: &impl aven_db_store::Store) {
    let start = std::time::Instant::now();
    let times = conformance::bench(store, || start.elapsed().as_secs_f64() * 1000.0)
        .await
        .unwrap();
    for (what, ms) in times {
        println!("bench {what}: {ms:.1} ms");
    }
}

/// With conditions on creates only, the suite passes: a create is refused on the server, a change leans on the lock.
#[tokio::test]
async fn s3_with_creates_only_passes_the_suite() {
    let report = conformance::run(async || backend::s3(&creates_only()).unwrap(), TRACES).await;
    println!("{report}");
    assert_eq!(
        backend::s3(&creates_only()).unwrap().conditions(),
        Conditions::Create
    );
    assert!(report.passed(), "{report}");
}

/// Two writers racing to create one ref, each with its own lock (two stores on one prefix, which rule 1 rules out):
/// with conditions on creates only, the server still keeps exactly one, and the other is told it is stale.
#[tokio::test]
async fn s3_with_creates_only_keeps_one_of_two_racing_creates() {
    for round in 0..10 {
        let at = creates_only();
        let (one, two) = (backend::s3(&at).unwrap(), backend::s3(&at).unwrap());
        let name = RefName::new(format!("joined-{round}")).unwrap();
        let (b, c) = (
            Hash::of(format!("one {round}").as_bytes()),
            Hash::of(format!("two {round}").as_bytes()),
        );
        let (won_one, won_two) =
            futures::join!(one.set_ref(&name, None, b), two.set_ref(&name, None, c));
        assert!(
            won_one.is_ok() != won_two.is_ok(),
            "both or neither won: {won_one:?} {won_two:?}"
        );
        let lost = [won_one, won_two]
            .into_iter()
            .find_map(Result::err)
            .unwrap();
        assert!(matches!(lost, Error::Stale { .. }), "{lost:?}");
        let kept = one.get_ref(&name).await.unwrap();
        assert!(kept == Some(b) || kept == Some(c));
    }
}
