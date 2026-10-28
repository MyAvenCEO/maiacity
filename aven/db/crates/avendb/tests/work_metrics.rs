//! Startup observation reads accumulated metrics without doing policy diagnostics.
use avendb::cast::world;

#[test]
fn work_metrics_are_stable_and_match_full_diagnostics() {
    let w = world();
    let lab = w.lab;
    let device = w.mac_a;
    let history = lab.log(device).ids().to_vec();
    let policy = lab.state(device).clone();
    let entries = lab.entries(device);
    let metrics = lab.work_metrics(device);
    assert_eq!(metrics.as_object().unwrap().len(), 2);
    assert!(metrics["timers"].as_object().is_some_and(|t| !t.is_empty()));
    for _ in 0..10 {
        assert_eq!(lab.work_metrics(device), metrics);
    }
    let diagnostics = lab.perf(device);
    assert_eq!(metrics["timers"], diagnostics["timers"]);
    assert_eq!(metrics["counts"], diagnostics["counts"]);
    assert_eq!(lab.log(device).ids(), history);
    assert!(lab.state(device) == &policy);
    assert_eq!(lab.entries(device), entries);
    assert_eq!(lab.work_metrics(device), metrics);
}
