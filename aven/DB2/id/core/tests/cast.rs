//! The cast's tree, with every expected value written out by hand from SANDBOX.md's "Vaults own vaults", as
//! `sandbox/check.mjs` does: none computed by the code under test.

use aven_id::{CastError, Invalid, Kind, Tree};

const CAST: &str = include_str!("../../../sandbox/cast.json");

fn cast() -> Tree {
    Tree::from_cast(CAST).expect("the cast is a well-formed tree")
}

const VAULTS: [&str; 7] = [
    "alice",
    "bob",
    "aven",
    "aven-peer",
    "alice-peer",
    "alice-peer-light",
    "bob-peer-light",
];

#[test]
fn kinds() {
    let t = cast();
    assert_eq!(t.kind("alice"), Some(Kind::Person));
    assert_eq!(t.kind("bob"), Some(Kind::Person));
    assert_eq!(t.kind("aven"), Some(Kind::Network));
    for d in [
        "aven-peer",
        "alice-peer",
        "alice-peer-light",
        "bob-peer-light",
    ] {
        assert_eq!(t.kind(d), Some(Kind::Device), "{d}");
    }
    assert_eq!(t.vault("aven-peer").unwrap().name, "Aven Peer");
}

#[test]
fn owned() {
    let t = cast();
    assert_eq!(t.owned("alice"), ["aven", "alice-peer", "alice-peer-light"]);
    assert_eq!(t.owned("aven"), ["aven-peer"]);
    assert_eq!(t.owned("bob"), ["bob-peer-light"]);
    for d in [
        "aven-peer",
        "alice-peer",
        "alice-peer-light",
        "bob-peer-light",
        "nobody",
    ] {
        assert!(t.owned(d).is_empty(), "{d}");
    }
}

#[test]
fn governs() {
    let t = cast();
    assert_eq!(
        t.governs("alice"),
        ["aven", "aven-peer", "alice-peer", "alice-peer-light"]
    );
    assert_eq!(t.governs("aven"), ["aven-peer"]);
    assert_eq!(t.governs("bob"), ["bob-peer-light"]);
    for d in [
        "aven-peer",
        "alice-peer",
        "alice-peer-light",
        "bob-peer-light",
    ] {
        assert!(t.governs(d).is_empty(), "a device governs nothing: {d}");
    }
}

#[test]
fn chain() {
    let t = cast();
    assert_eq!(t.chain("aven-peer"), ["aven", "alice"]);
    assert_eq!(t.chain("aven"), ["alice"]);
    assert_eq!(t.chain("alice-peer-light"), ["alice"]);
    assert_eq!(t.chain("bob-peer-light"), ["bob"]);
    assert!(t.chain("alice").is_empty());
    assert!(t.chain("bob").is_empty());
}

#[test]
fn acts_for_and_through() {
    let t = cast();
    assert_eq!(t.acts_for("aven-peer"), Some("aven"));
    assert_eq!(t.acts_for("alice-peer"), Some("alice"));
    assert_eq!(t.acts_for("alice-peer-light"), Some("alice"));
    assert_eq!(t.acts_for("bob-peer-light"), Some("bob"));
    for v in ["alice", "bob", "aven", "nobody"] {
        assert_eq!(t.acts_for(v), None, "{v} is no device");
    }
    assert_eq!(t.acts_through("alice"), ["alice-peer", "alice-peer-light"]);
    assert_eq!(t.acts_through("aven"), ["aven-peer"]);
    assert_eq!(t.acts_through("bob"), ["bob-peer-light"]);
}

#[test]
fn accounts() {
    let t = cast();
    assert_eq!(t.accounts(None), ["alice", "bob"]);
    assert_eq!(t.accounts(Some("alice-peer-light")), ["alice"]);
    assert_eq!(t.accounts(Some("alice-peer")), ["alice"]);
    assert_eq!(t.accounts(Some("bob-peer-light")), ["bob"]);
    assert!(
        t.accounts(Some("aven-peer")).is_empty(),
        "the Aven Peer serves Aven, which is no account"
    );
    assert!(t.accounts(Some("alice")).is_empty());
}

#[test]
fn sees() {
    let t = cast();
    assert_eq!(
        t.sees("alice"),
        ["aven-peer", "alice-peer", "alice-peer-light"]
    );
    assert_eq!(t.sees("bob"), ["bob-peer-light"]);
    assert_eq!(t.sees("aven"), ["aven-peer"]);
}

#[test]
fn may_act_on() {
    let t = cast();
    // each device, and the vaults it may act on; every other vault is refused
    let may = [
        ("aven-peer", &["aven", "aven-peer"][..]),
        (
            "alice-peer",
            &[
                "alice",
                "aven",
                "aven-peer",
                "alice-peer",
                "alice-peer-light",
            ][..],
        ),
        (
            "alice-peer-light",
            &[
                "alice",
                "aven",
                "aven-peer",
                "alice-peer",
                "alice-peer-light",
            ][..],
        ),
        ("bob-peer-light", &["bob", "bob-peer-light"][..]),
    ];
    for (device, allowed) in may {
        for v in VAULTS {
            assert_eq!(
                t.may_act_on(device, v),
                allowed.contains(&v),
                "{device} on {v}"
            );
        }
    }
    for v in VAULTS {
        assert!(!t.may_act_on("alice", v), "a person's vault is no device");
    }
}

/// A real public half (alice-owner's), so every key in these trees reads as an Ed25519 key.
const K: &str = "0254086bfa6b7557cc22939766aae0cf6314a383264d19c705a936673b677c85";

#[test]
fn refuses_trees_that_are_not_well_formed() {
    let with = |vaults: &str| {
        Tree::from_cast(&format!(
            r#"{{"keys":{{"k":"{K}","d":"{K}"}},"vaults":{{{vaults}}}}}"#
        ))
    };
    let invalid = |vaults: &str| match with(vaults) {
        Err(CastError::Invalid(why)) => why,
        other => panic!("{vaults}: {other:?}"),
    };
    assert!(with(r#""a":{"kind":"person","owners":["key:k"]}"#).is_ok());
    assert_eq!(
        invalid(r#""a":{"kind":"person","owners":[]}"#),
        Invalid::Unowned("a".into())
    );
    assert!(matches!(
        invalid(r#""a":{"kind":"person","owners":["key:x"]}"#),
        Invalid::Unknown { .. }
    ));
    assert!(matches!(
        invalid(r#""a":{"kind":"person","owners":["vault:x"]}"#),
        Invalid::Unknown { .. }
    ));
    assert_eq!(
        invalid(
            r#""a":{"kind":"person","owners":["key:k"]},"d":{"kind":"device","owners":["key:k"]}"#
        ),
        Invalid::DeviceOwners("d".into())
    );
    assert_eq!(
        invalid(
            r#""a":{"kind":"person","owners":["key:k"]},"d":{"kind":"device","owners":["vault:a","vault:a"]}"#
        ),
        Invalid::DeviceOwners("d".into())
    );
    assert!(matches!(
        invalid(
            r#""a":{"kind":"person","owners":["key:k"]},"d":{"kind":"device","owners":["vault:a"]},"e":{"kind":"network","owners":["vault:d"]}"#
        ),
        Invalid::DeviceOwns { .. }
    ));
    assert!(matches!(
        invalid(
            r#""a":{"kind":"person","owners":["vault:b"]},"b":{"kind":"network","owners":["vault:a"]}"#
        ),
        Invalid::Cycle(_)
    ));
    assert!(matches!(
        invalid(r#""a":{"kind":"person","owners":["vault:a"]}"#),
        Invalid::Cycle(_)
    ));
    assert!(matches!(
        with(r#""a":{"kind":"ghost","owners":["key:k"]}"#),
        Err(CastError::Format(_))
    ));
    assert!(matches!(
        with(r#""a":{"kind":"person","owners":["k"]}"#),
        Err(CastError::Format(_))
    ));
    // a device has its own key, the key with its id, and that key owns nothing
    assert_eq!(
        invalid(
            r#""a":{"kind":"person","owners":["key:k"]},"e":{"kind":"device","owners":["vault:a"]}"#
        ),
        Invalid::DeviceKeyless("e".into())
    );
    assert_eq!(
        invalid(
            r#""a":{"kind":"person","owners":["key:k"]},"d":{"kind":"device","owners":["vault:a"]},"b":{"kind":"person","owners":["key:d"]}"#
        ),
        Invalid::DeviceKeyOwns {
            device: "d".into(),
            vault: "b".into()
        }
    );
    assert!(
        with(
            r#""a":{"kind":"person","owners":["key:k"]},"d":{"kind":"device","owners":["vault:a"]}"#
        )
        .is_ok()
    );
    assert!(matches!(
        Tree::from_cast(
            r#"{"keys":{"k":"00"},"vaults":{"a":{"kind":"person","owners":["key:k"]}}}"#
        ),
        Err(CastError::Format(_))
    ));
}
