//! The conformance suite on the memory backend.

#![cfg(not(target_arch = "wasm32"))]

use aven_db_store::{backend, conformance};

#[tokio::test]
async fn memory_passes_the_suite() {
    let report = conformance::run(async || backend::memory().unwrap()).await;
    println!("{report}");
    bench(&backend::memory().unwrap()).await;
    assert!(report.passed());
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
