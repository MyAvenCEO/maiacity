//! The release record against Lean's vectors (`releases.json`, `Aven.ID.Release`): the build's listing and hash, and
//! what a device does with every record and the files it fetched. This file writes no expected value of its own.

mod common;

use aven_id::release::{self, Device, Release, Unsigned};
use common::vectors;
use serde_json::{Value, json};

fn device(v: &Value) -> Device {
    Device {
        running: v["running"].as_u64(),
        signers: v["signers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|k| k.as_str().unwrap().to_string())
            .collect(),
        unsigned: match v["unsigned"].as_str().unwrap() {
            "refuse" => Unsigned::Refuse,
            "integrity" => Unsigned::Integrity,
            other => panic!("unknown policy {other}"),
        },
    }
}

#[test]
fn releases_follow_the_vectors() {
    let all = vectors("releases.json");
    assert!(all.len() >= 15);
    for v in all {
        let (input, expected) = (&v["input"], &v["expected"]);
        if input.get("record").is_none() {
            let files = release::parse_files(&input["files"]).unwrap();
            assert_eq!(
                json!(release::listing(&files)),
                expected["listing"],
                "{}",
                v["name"]
            );
            assert_eq!(
                json!(release::os_hash(&files)),
                expected["os"],
                "{}",
                v["name"]
            );
            continue;
        }
        let record = Release::parse(&input["record"]).unwrap();
        let signed_by: Vec<String> = input["signedBy"]
            .as_array()
            .unwrap()
            .iter()
            .map(|k| k.as_str().unwrap().to_string())
            .collect();
        let fetched = release::parse_files(&input["fetched"]).unwrap();
        let got = release::check(&device(&input["device"]), &record, &signed_by, &fetched);
        assert_eq!(got.json(), *expected, "{}", v["name"]);
    }
}

/// Today's devices trust no release signer and check integrity only, until A15's signers are agreed.
#[test]
fn every_device_today_checks_integrity_only() {
    let today = Device::today(Some(7));
    assert!(today.signers.is_empty());
    assert_eq!(today.unsigned, Unsigned::Integrity);
}
