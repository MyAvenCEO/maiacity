//! The conformance suite on the memory backend.

use aven_db_store::{backend, conformance};

#[tokio::test]
async fn memory_passes_the_suite() {
    let report = conformance::run(async || backend::memory().unwrap()).await;
    println!("{report}");
    assert!(report.passed());
}
