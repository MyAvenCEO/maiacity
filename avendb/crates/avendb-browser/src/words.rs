//! How the page names what the core says (JSON): kinds, roles and statuses by their lowercase names, ids in 64 hex
//! digits, a cap's grantee, and a cap itself. The Mac app's device takes the same words (`avendb-device`).
//!
//! A cap is a named group of ops on a slice of its vault (`avendb::slice::spec_of_json`): `{"name": "Work todos",
//! "where": {"all": [{"type": ["todo"]}, {"tag": "work"}]}, "ops": [{"op": "read"}, {"op": "set", "path": ["status"],
//! "to": ["done"]}]}`, the ops as the docs write them (`avendb::rules`, `avendb/docs/OPS.md`), `where` a query's
//! `where` of labels alone, left out for the whole vault. Its role is the class of its strongest op, which the page
//! reads and never names. A cap the page reads carries, as `above`, the ops of the caps it rests on too, which narrow
//! it further (`avendb::slice::Slice::to_json`). The built-in groups the page offers come from the core (`{"op":
//! "groups"}`, `avendb::rules::groups`).

use anyhow::{Result, anyhow, bail};
use avendb::id::{BlobId, VaultId};
use avendb::lens::Status;
use avendb::policy::{Grantee, Kind, Principal, Role};
use avendb::rules::Rule;
use avendb::slice::{self, Selector};
use serde_json::Value;

pub fn kind_name(kind: Kind) -> &'static str {
    match kind {
        Kind::Human => "human",
        Kind::Coop => "coop",
        Kind::Aven => "aven",
    }
}

pub fn role_name(role: Role) -> &'static str {
    match role {
        Role::Relay => "relay",
        Role::Backup => "backup",
        Role::Read => "read",
        Role::Write => "write",
        Role::Owner => "owner",
    }
}

pub fn status_name(status: Status) -> &'static str {
    match status {
        Status::Open => "open",
        Status::Doing => "doing",
        Status::Done => "done",
    }
}

/// A todo's status by its name: `"open"`, `"doing"` or `"done"`.
pub fn status_of(name: &str) -> Result<Status> {
    Ok(match name {
        "open" => Status::Open,
        "doing" => Status::Doing,
        "done" => Status::Done,
        _ => bail!("a todo is open, doing or done"),
    })
}

/// 32 bytes as 64 lowercase hex digits, as the page sees every id.
pub fn hex(b: &[u8; 32]) -> String {
    BlobId(*b).to_hex()
}

/// An id from its 64 lowercase hex digits.
pub fn id_of(s: &str) -> Result<[u8; 32]> {
    BlobId::from_hex(s).map(|b| b.0).ok_or_else(|| anyhow!("{s:?} is no id"))
}

/// A cap's grantee as the page names it: `"everyone"` for Public, else the vault's id.
pub fn grantee_name(g: Grantee) -> String {
    match g {
        Grantee::Public => "everyone".to_string(),
        Grantee::Principal(Principal::Vault(v)) => hex(&v.0),
        Grantee::Principal(Principal::Signer(s)) => hex(&s.0),
    }
}

/// A cap's grantee from what the page wrote (`grantee_name`): `"everyone"`, or a vault's id.
pub fn grantee_of(name: &str) -> Result<Grantee> {
    Ok(match name {
        "everyone" => Grantee::Public,
        v => Grantee::Principal(Principal::Vault(VaultId(id_of(v)?))),
    })
}

/// A new cap's name, selector and ops from what the page wrote (`avendb::slice::spec_of_json`).
pub fn spec_of(v: &Value) -> Result<(String, Selector, Vec<Rule>)> {
    slice::spec_of_json(v).map_err(|why| anyhow!(why))
}

#[cfg(test)]
mod tests {
    use avendb::rules::{self, Grant};
    use avendb::slice::{Atom, Slice};
    use serde_json::json;

    use super::*;

    #[test]
    fn a_cap_reads_from_its_words() {
        let work = json!({
            "name": "Work todos",
            "where": { "all": [{ "type": ["todo"] }, { "tag": "work" }] },
            "ops": [{ "op": "set", "path": ["status"], "to": ["done"] }, { "op": "merge", "on": "proposals" }],
        });
        let (name, select, ops) = spec_of(&work).expect("a cap");
        assert_eq!(name, "Work todos");
        assert_eq!(select, Selector::AnyOf(vec![vec![Atom::TypeIn(vec!["todo".into()]), Atom::TagHas("work".into())]]));
        // in order, read beside what writes
        let read_first = json!([{ "op": "read" }, work["ops"][0], work["ops"][1]]);
        assert_eq!(rules::ops_to_json(&ops), read_first);
        // the whole vault where it picks nothing narrower; what the page reads back says the same
        let public = json!({ "name": "Public", "ops": [{ "op": "read" }] });
        let (name, select, ops) = spec_of(&public).expect("a cap");
        assert_eq!((name.as_str(), &select, &ops[..]), ("Public", &Selector::All, &[Rule::Read][..]));
        let above = vec![Grant { ops: Role::Owner.ops(), salt: [3; 32] }];
        let slice = Slice { name, select, grant: Grant { ops, salt: [4; 32] }, above };
        let read = slice.to_json();
        assert_eq!((&read["where"], &read["ops"]), (&json!({ "all": [] }), &json!([{ "op": "read" }])));
        assert_eq!(read["above"][0], rules::ops_to_json(&Role::Owner.ops()));
        let again = spec_of(&json!({ "name": read["name"], "where": read["where"], "ops": read["ops"] }));
        assert_eq!(again.expect("its own words").1, Selector::All);
    }

    #[test]
    fn a_cap_written_otherwise_is_refused() {
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
        for cap in bad {
            assert!(spec_of(&cap).is_err(), "{cap}");
        }
    }

    #[test]
    fn a_grantee_reads_back_from_its_name() {
        for g in [Grantee::Public, Grantee::Principal(Principal::Vault(VaultId([7; 32])))] {
            assert_eq!(grantee_of(&grantee_name(g)).expect("its own name"), g);
        }
        assert!(grantee_of("public").is_err() && grantee_of("beef").is_err());
    }
}
