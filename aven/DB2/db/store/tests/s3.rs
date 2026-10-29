//! The conformance suite on S3, against the box's server (`bun run up` starts it, the service `s3` in
//! `sandbox/box/compose.yml`). `AVEN_DB_S3_ENDPOINT` points elsewhere; every run writes under a prefix of its own.

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use aven_db_store::backend::{self, S3};
use aven_db_store::{Error, Hash, RefName, Store, conformance};

fn fresh() -> S3 {
    static N: AtomicU32 = AtomicU32::new(0);
    let run = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    S3 {
        endpoint: std::env::var("AVEN_DB_S3_ENDPOINT").unwrap_or_else(|_| "http://127.0.0.1:7070".into()),
        region: "us-east-1".into(),
        bucket: "aven-db-store".into(),
        root: format!("/run-{run}-{}/", N.fetch_add(1, Ordering::Relaxed)),
        access_key_id: "avensandbox".into(),
        secret_access_key: "avensandbox-test-secret".into(),
    }
}

#[tokio::test]
async fn s3_passes_the_suite() {
    let report = conformance::run(async || backend::s3(&fresh()).unwrap()).await;
    println!("{report}");
    assert!(report.passed(), "is the box's S3 server up? `bun run up` starts it");
}

/// S3 refuses a stale ref write itself, with `If-Match` and `If-None-Match`: even two writers on one prefix,
/// which rule 1 rules out, can't overwrite each other unseen. A folder or memory relies on the one writer alone.
#[tokio::test]
async fn s3_refuses_a_second_writers_stale_write() {
    let at = fresh();
    let (one, two) = (backend::s3(&at).unwrap(), backend::s3(&at).unwrap());
    assert!(one.conditional_writes(), "this server doesn't take conditional writes");
    let head = RefName::new("head").unwrap();
    one.set_ref(&head, None, Hash::of(b"start")).await.unwrap();
    for round in 0..10 {
        let now = one.get_ref(&head).await.unwrap();
        // new values every round: S3's ETag is the content's MD5, so rewriting the same bytes keeps the tag
        let (b, c) = (Hash::of(format!("one {round}").as_bytes()), Hash::of(format!("two {round}").as_bytes()));
        let (won_one, won_two) = futures::join!(one.set_ref(&head, now, b), two.set_ref(&head, now, c));
        assert!(won_one.is_ok() != won_two.is_ok(), "both or neither won: {won_one:?} {won_two:?}");
        for lost in [won_one, won_two].into_iter().filter_map(Result::err) {
            assert!(matches!(lost, Error::Stale { .. }), "{lost:?}");
        }
    }
}
