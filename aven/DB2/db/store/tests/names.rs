//! The contract's two names: a blob's hash and a ref's name.

use aven_db_store::{Hash, RefName};

#[test]
fn a_hash_is_blake3_and_reads_back_from_hex() {
    let hash = Hash::of(b"abc");
    assert_eq!(
        hash.to_hex(),
        "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85"
    );
    assert_eq!(hash.to_hex().parse::<Hash>().unwrap(), hash);
}

#[test]
fn only_the_stores_own_spelling_reads_as_a_hash() {
    let hex = Hash::of(b"abc").to_hex();
    for bad in [
        &hex[..63],
        &hex.to_uppercase(),
        &format!("{hex}0"),
        "",
        &format!("{}g", &hex[..63]),
    ] {
        assert!(bad.parse::<Hash>().is_err(), "{bad:?} parsed");
    }
}

#[test]
fn ref_names_are_flat_and_short() {
    for good in ["head", "doc.3f9a.head", "peer_key-1", &"a".repeat(128)] {
        assert!(RefName::new(good).is_ok(), "{good:?} refused");
    }
    for bad in ["", ".tmp", "a/b", "..", "a b", "ä", &"a".repeat(129)] {
        assert!(RefName::new(bad).is_err(), "{bad:?} accepted");
    }
}
