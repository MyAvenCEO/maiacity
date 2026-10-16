//! How avenDB's JSON names what the core says, for every caller of `run` alike (`engine`): kinds, levels and statuses
//! by their lowercase names, ids in 64 lowercase hex digits, a share's who, a vault's owners.
//!
//! A share is a named group of ops on a slice of its vault (`slice::spec_of_json`): `{"name": "Work todos", "where":
//! {"all": [{"type": ["todo"]}, {"tag": "work"}]}, "ops": [{"op": "read"}, {"op": "set", "path": ["status"], "to":
//! ["done"]}]}`, the ops as the docs write them (`rules`, `docs/ARCHITECTURE.md` §8), `where` a query's `where` of
//! labels alone. Its level is the class of its strongest op (`level_name`), which the page reads and never names. A
//! keep share's level is its mode: `keepWhole`, `keepOpened` or `keepNever`.

use serde_json::{Value, json};

use crate::id::BlobId;
use crate::lens::Status;
use crate::policy::{KeepMode, Kind, Level, OwnedBy, Principal, Who};

/// A kind's name: a device vault's is `device`.
pub fn kind_name(kind: Kind) -> &'static str {
    match kind {
        Kind::Human => "human",
        Kind::Coop => "coop",
        Kind::Aven => "aven",
        Kind::DeviceVault => "device",
    }
}

/// A kind by its name (`kind_name`).
pub fn kind_of(name: &str) -> Option<Kind> {
    Kind::ALL.into_iter().find(|&k| kind_name(k) == name)
}

/// The kind table (`Kind::rules`), a row for each kind, as the page reads it: `{"kind": "aven", "ownedBy": ["human"],
/// "most": 1, "devices": false, "each": 1}`, where `ownedBy` is `"signers"` or the names of the kinds whose vaults may
/// own one, `most` how many owners it has at most and `each` how many of it one owner may own, `null` for any number.
/// The model writes the same rows to its vectors (`Vectors.lean`).
pub fn kinds_json() -> Value {
    Kind::ALL
        .into_iter()
        .map(|k| {
            let r = k.rules();
            let owned_by = match r.owned_by {
                OwnedBy::Signers => json!("signers"),
                OwnedBy::Vaults(ks) => ks.iter().map(|&o| kind_name(o)).collect(),
            };
            json!({ "kind": kind_name(k), "ownedBy": owned_by, "most": r.most, "devices": r.devices, "each": r.each })
        })
        .collect()
}

/// The levels, by their names (`level_name`).
const LEVELS: [Level; 8] = [
    Level::Owner,
    Level::Write,
    Level::Read,
    Level::Backup,
    Level::Relay,
    Level::Keep(KeepMode::Whole),
    Level::Keep(KeepMode::Opened),
    Level::Keep(KeepMode::Never),
];

pub fn level_name(level: Level) -> &'static str {
    match level {
        Level::Keep(KeepMode::Whole) => "keepWhole",
        Level::Keep(KeepMode::Opened) => "keepOpened",
        Level::Keep(KeepMode::Never) => "keepNever",
        Level::Relay => "relay",
        Level::Backup => "backup",
        Level::Read => "read",
        Level::Write => "write",
        Level::Owner => "owner",
    }
}

/// A level by its name (`level_name`).
pub fn level_of(name: &str) -> Option<Level> {
    LEVELS.into_iter().find(|&l| level_name(l) == name)
}

pub fn status_name(status: Status) -> &'static str {
    match status {
        Status::Open => "open",
        Status::Doing => "doing",
        Status::Done => "done",
    }
}

/// 32 bytes as 64 lowercase hex digits, as the page sees every id.
pub fn hex(b: &[u8; 32]) -> String {
    BlobId(*b).to_hex()
}

/// A share's grantee as the world names it (`grantee`): `"everyone"` for `Who::Everyone`, else the vault's or the
/// device's id.
pub fn who_name(g: Who) -> String {
    match g {
        Who::Everyone => "everyone".to_string(),
        Who::Vault(v) => hex(&v.0),
        Who::Device(s) => hex(&s.0),
    }
}

/// A share's grantee as the `shares` op and a `share` op write it: `"everyone"`, `{"vault": id}` or `{"device": id}`.
pub fn who_json(g: Who) -> Value {
    match g {
        Who::Everyone => "everyone".into(),
        Who::Vault(v) => json!({ "vault": hex(&v.0) }),
        Who::Device(d) => json!({ "device": hex(&d.0) }),
    }
}

/// An owner as the world shows a vault's owners: `{"signer": id}` or `{"vault": id}`.
pub fn principal_json(p: Principal) -> Value {
    match p {
        Principal::Vault(v) => json!({ "vault": hex(&v.0) }),
        Principal::Signer(s) => json!({ "signer": hex(&s.0) }),
    }
}

#[cfg(test)]
mod tests {
    use crate::id::{SignerId, VaultId};
    use crate::rules::{self, Grant, Op};
    use crate::slice::{Atom, Selector, Slice, spec_of_json};

    use super::*;

    #[test]
    fn a_share_reads_from_its_words() {
        let work = json!({
            "name": "Work todos",
            "where": { "all": [{ "type": ["todo"] }, { "tag": "work" }] },
            "ops": [{ "op": "set", "path": ["status"], "to": ["done"] }, { "op": "merge", "on": "proposals" }],
        });
        let (name, select, ops) = spec_of_json(&work).expect("a share");
        assert_eq!(name, "Work todos");
        assert_eq!(select, Selector::AnyOf(vec![vec![Atom::TypeIn(vec!["todo".into()]), Atom::TagHas("work".into())]]));
        // in order, read beside what writes
        let read_first = json!([{ "op": "read" }, work["ops"][0], work["ops"][1]]);
        assert_eq!(rules::ops_to_json(&ops), read_first);
        // the whole vault where it picks nothing narrower; what the page reads back says the same
        let public = json!({ "name": "Public", "ops": [{ "op": "read" }] });
        let (name, select, ops) = spec_of_json(&public).expect("a share");
        assert_eq!((name.as_str(), &select, &ops[..]), ("Public", &Selector::All, &[Op::Read][..]));
        let above = vec![Grant { ops: Level::Owner.ops(), salt: [3; 32] }];
        let slice = Slice { name, select, grant: Grant { ops, salt: [4; 32] }, above };
        let read = slice.to_json();
        assert_eq!((&read["where"], &read["ops"]), (&json!({ "all": [] }), &json!([{ "op": "read" }])));
        assert_eq!(read["above"][0], rules::ops_to_json(&Level::Owner.ops()));
        let again = spec_of_json(&json!({ "name": read["name"], "where": read["where"], "ops": read["ops"] }));
        assert_eq!(again.expect("its own words").1, Selector::All);
    }

    #[test]
    fn a_share_written_otherwise_is_refused() {
        let ops = json!([{ "op": "read" }]);
        let bad = [
            json!({ "where": { "all": [] }, "ops": ops }),
            json!({ "name": " ", "ops": ops }),
            json!({ "name": "x".repeat(65), "ops": ops }),
            json!({ "name": "None", "ops": [] }),
            json!({ "name": "Fly", "ops": [{ "op": "fly" }] }),
            json!({ "name": "Set", "ops": [{ "op": "set" }] }),
            json!({ "name": "Half", "ops": [{ "op": "set", "path": ["size"], "to": [1.5] }] }),
            json!({ "name": "Colour", "where": { "colour": ["red"] }, "ops": ops }),
            json!({ "name": "Title", "where": { "path": ["title"], "eq": "x" }, "ops": ops }),
            json!({ "name": "Bob", "who": "Bob", "ops": ops }),
            json!({ "name": "Role", "role": "read", "ops": ops }),
        ];
        for share in bad {
            assert!(spec_of_json(&share).is_err(), "{share}");
        }
    }

    #[test]
    fn each_level_and_kind_reads_back_from_its_name_and_nothing_else_does() {
        for level in LEVELS {
            assert_eq!(level_of(level_name(level)), Some(level));
        }
        for kind in Kind::ALL {
            assert_eq!(kind_of(kind_name(kind)), Some(kind));
        }
        assert_eq!((level_of("Owner"), level_of("actsFor"), kind_of("Aven")), (None, None, None));
    }

    #[test]
    fn whom_a_share_names_is_written_by_its_kind() {
        let (v, d) = (VaultId([7; 32]), SignerId([8; 32]));
        assert_eq!(who_json(Who::Everyone), json!("everyone"));
        assert_eq!(who_json(Who::Vault(v)), json!({ "vault": hex(&v.0) }));
        assert_eq!(who_json(Who::Device(d)), json!({ "device": hex(&d.0) }));
        assert_eq!((who_name(Who::Everyone), who_name(Who::Vault(v))), ("everyone".into(), hex(&v.0)));
        assert_eq!(principal_json(Principal::Signer(d)), json!({ "signer": hex(&d.0) }));
    }
}
