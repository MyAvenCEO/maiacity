//! Optional browser carrier configuration: no deployment or live stores are involved.
use avendb_server::Config;
use std::collections::HashMap;

fn configured() -> HashMap<&'static str, &'static str> {
    HashMap::from([
        ("AVENDB_WT_BIND", "127.0.0.1:0"),
        ("AVENDB_WT_URL", "https://localhost:0/avendb"),
        ("AVENDB_WT_ORIGINS", "[\"https://maia.city\"]"),
    ])
}

#[test]
fn optional_listener_requires_complete_valid_explicit_configuration() {
    assert!(Config::from_vars(|_| None).unwrap().webtransport.is_none());
    let good = configured();
    let config = Config::from_vars(|name| good.get(name).map(|v| v.to_string()))
        .unwrap()
        .webtransport
        .unwrap();
    assert_eq!(config.bind, "127.0.0.1:0".parse().unwrap());
    assert_eq!(config.allowed_origins, ["https://maia.city"]);
    for missing in good.keys() {
        assert!(
            Config::from_vars(|name| (name != *missing)
                .then(|| good.get(name).map(|v| v.to_string()))
                .flatten())
            .is_err()
        );
    }
    for (key, value) in [
        ("AVENDB_WT_BIND", "localhost:7402"),
        ("AVENDB_WT_URL", "http://localhost:7402/avendb"),
        ("AVENDB_WT_URL", "https://user:password@localhost/avendb"),
        ("AVENDB_WT_URL", "https://localhost/avendb?ticket=public"),
        ("AVENDB_WT_ORIGINS", "https://maia.city"),
        ("AVENDB_WT_ORIGINS", "[]"),
        ("AVENDB_WT_ORIGINS", "[\"*\"]"),
        ("AVENDB_WT_ORIGINS", "[\"https://maia.city/app\"]"),
    ] {
        let mut bad = good.clone();
        bad.insert(key, value);
        assert!(
            Config::from_vars(|name| bad.get(name).map(|v| v.to_string())).is_err(),
            "{key} rejected"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn optional_listener_bind_failure_keeps_the_existing_node_and_relay_running() {
    let occupied = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
    let bind = occupied.local_addr().unwrap();
    let mut config = Config::from_vars(|_| None).unwrap();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    config.data =
        std::env::temp_dir().join(format!("avendb-wt-config-{}-{stamp}", std::process::id()));
    config.bind = "127.0.0.1:0".parse().unwrap();
    config.relay_bind = config.bind;
    config.feed_bind = config.bind;
    config.webtransport = Some(avendb_net::transports::WtConfig {
        bind,
        public_url: format!("https://localhost:{}/avendb", bind.port()),
        allowed_origins: vec!["https://maia.city".into()],
    });
    let running = avendb_server::start(&config).await.unwrap();
    assert_eq!(running.node.id(), running.offer.addr.id);
    assert!(
        !running
            .node
            .addr()
            .relay_urls()
            .collect::<Vec<_>>()
            .is_empty()
    );
    drop(occupied);
    running
        .node
        .listen_webtransport(config.webtransport.clone().unwrap())
        .await
        .unwrap();
    assert!(
        running
            .node
            .listen_webtransport(config.webtransport.clone().unwrap())
            .await
            .is_err(),
        "one listener per node"
    );
    running.shutdown().await.unwrap();
    let rebound = std::net::UdpSocket::bind(bind).unwrap();
    drop(rebound);
    std::fs::remove_dir_all(config.data).unwrap();
}
