//! The Lean model's test vectors (`vault/spec/vectors/vaults.json`, written by `lake exe vectors`, checked by every
//! `lake build`). A step case's ops, applied one after the other from the empty state, must be accepted or refused
//! exactly as the model says. A view case's ops, each at the depth it claims, must stand or be cut exactly as in the
//! model's view: that is where removals cut what they hadn't seen. Both must end with the same vaults, spaces, grants,
//! writes and key schedule (each family's epoch, every seal, every published key).
//!
//! The model names what an op creates (a vault, a space, a grant) by a number, and an op by its place in the case; the
//! core names them all by hashes, so each number maps to what its op created, and each place to that op's id. A keys
//! op of the model names only where its boxes go; the core's carries the boxes too, which no rule opens, so here they
//! are empty.

use std::collections::HashMap;

use serde_json::Value;
use vault_db::id::{EntryId, GrantId, OpId, SignerId, SpaceId, VaultId};
use vault_db::keys::{KeyBox, KeyId, KeyName, KeyScope, Recipient, Seal};
use vault_db::policy::{replay, Action, Grant, Grantee, Kind, Op, Principal, Role, Scope, Space, State, Vault, Write};

const VECTORS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/vectors/vaults.json");

fn num(v: &Value) -> u64 {
    v.as_u64().unwrap_or_else(|| panic!("a number, not {v}"))
}

fn list(v: &Value) -> &[Value] {
    v.as_array().unwrap_or_else(|| panic!("a list, not {v}"))
}

fn signer(v: &Value) -> SignerId {
    SignerId::from_u64(num(v))
}

fn entry(v: &Value) -> EntryId {
    EntryId::from_u64(num(v))
}

fn kind(v: &Value) -> Kind {
    match v.as_str() {
        Some("human") => Kind::Human,
        Some("coop") => Kind::Coop,
        _ => panic!("a kind, not {v}"),
    }
}

fn role(v: &Value) -> Role {
    match v.as_str() {
        Some("relay") => Role::Relay,
        Some("read") => Role::Read,
        Some("write") => Role::Write,
        Some("owner") => Role::Owner,
        _ => panic!("a role, not {v}"),
    }
}

/// The model's numbers and places, as the core names them.
#[derive(Default)]
struct Names {
    vaults: HashMap<u64, VaultId>,
    spaces: HashMap<u64, SpaceId>,
    grants: HashMap<u64, GrantId>,
    /// Each op's id, by its place in the case.
    ops: Vec<OpId>,
}

impl Names {
    fn vault(&self, v: &Value) -> VaultId {
        let n = num(v);
        self.vaults.get(&n).copied().unwrap_or(VaultId::from_u64(n))
    }

    fn space(&self, v: &Value) -> SpaceId {
        let n = num(v);
        self.spaces.get(&n).copied().unwrap_or(SpaceId::from_u64(n))
    }

    fn grant(&self, v: &Value) -> GrantId {
        let n = num(v);
        self.grants.get(&n).copied().unwrap_or(GrantId::from_u64(n))
    }

    fn op(&self, v: &Value) -> OpId {
        let n = num(v);
        self.ops.get(n as usize).copied().unwrap_or(OpId::from_u64(n))
    }

    fn ops(&self, v: &Value) -> Vec<OpId> {
        list(v).iter().map(|x| self.op(x)).collect()
    }

    fn principal(&self, v: &Value) -> Principal {
        match (v.get("signer"), v.get("vault")) {
            (Some(s), None) => Principal::Signer(signer(s)),
            (None, Some(x)) => Principal::Vault(self.vault(x)),
            _ => panic!("a principal, not {v}"),
        }
    }

    fn scope(&self, v: &Value) -> Scope {
        match v.get("entry") {
            None => Scope::Space(self.space(&v["space"])),
            Some(e) => Scope::Entry(self.space(&v["space"]), entry(e)),
        }
    }

    fn key_scope(&self, v: &Value) -> KeyScope {
        match (v.get("vault"), v.get("entry")) {
            (Some(x), None) => KeyScope::Vault(self.vault(x)),
            (None, None) => KeyScope::Space(self.space(&v["space"])),
            (None, Some(e)) => KeyScope::Entry(self.space(&v["space"]), entry(e)),
            _ => panic!("a key family, not {v}"),
        }
    }

    fn key_name(&self, v: &Value) -> KeyName {
        match v.get("signer") {
            Some(s) => KeyName::Signer(signer(s)),
            None => KeyName::Scoped(self.key_scope(&v["key"]), num(&v["epoch"])),
        }
    }

    /// Whom a box goes to; which of a family's keys doesn't matter to the rules.
    fn recipient(&self, v: &Value) -> Recipient {
        match self.key_name(v) {
            KeyName::Signer(s) => Recipient::Signer(s),
            KeyName::Scoped(key, epoch) => Recipient::Key { key, epoch, id: KeyId([0; 32]) },
        }
    }

    fn grantee(&self, v: &Value) -> Grantee {
        match v.as_str() {
            Some("public") => Grantee::Public,
            _ => Grantee::Principal(self.principal(v)),
        }
    }

    fn grant_of(&self, v: &Value) -> Grant {
        Grant {
            scope: self.scope(&v["scope"]),
            role: role(&v["role"]),
            grantee: self.grantee(&v["grantee"]),
            issuer: self.vault(&v["issuer"]),
            parent: (!v["parent"].is_null()).then(|| self.grant(&v["parent"])),
        }
    }

    fn action(&self, v: &Value) -> Action {
        let (name, x) = v.as_object().and_then(|o| o.iter().next()).unwrap_or_else(|| panic!("an action, not {v}"));
        let vault = || self.vault(&x["vault"]);
        let keep = || self.ops(&x["keep"]);
        match name.as_str() {
            "genesis" => Action::Genesis {
                kind: kind(&x["kind"]),
                owners: list(&x["owners"]).iter().map(|p| self.principal(p)).collect(),
                threshold: num(&x["threshold"]) as u32,
                root: (!x["root"].is_null()).then(|| signer(&x["root"])),
                // the model's number keeps two geneses with the same owners apart, as a nonce does
                nonce: num(&x["vault"]),
                seal_to: vec![],
            },
            "addOwner" => Action::AddOwner { vault: vault(), owner: self.principal(&x["owner"]), seal_to: None },
            "removeOwner" => Action::RemoveOwner { vault: vault(), owner: self.principal(&x["owner"]), keep: keep() },
            "setThreshold" => Action::SetThreshold { vault: vault(), threshold: num(&x["threshold"]) as u32 },
            "addDevice" => Action::AddDevice { vault: vault(), device: signer(&x["device"]), seal_to: None },
            "removeDevice" => Action::RemoveDevice { vault: vault(), device: signer(&x["device"]), keep: keep() },
            "setRoot" => {
                Action::SetRoot { vault: vault(), root: (!x["root"].is_null()).then(|| signer(&x["root"])), keep: keep() }
            }
            "foundSpace" => Action::FoundSpace { actor: self.vault(&x["actor"]), nonce: num(&x["space"]) },
            "grant" => Action::Grant(self.grant_of(x)),
            "revoke" => Action::Revoke { grant: self.grant(&x["grant"]), actor: self.vault(&x["actor"]), keep: keep() },
            "write" => Action::Write {
                space: self.space(&x["space"]),
                entry: entry(&x["entry"]),
                actor: self.vault(&x["actor"]),
                epoch: num(&x["epoch"]),
                deps: self.ops(&x["deps"]),
                body: vec![],
            },
            "keys" => Action::Keys {
                key: self.key_scope(&x["key"]),
                epoch: num(&x["epoch"]),
                id: KeyId([0; 32]),
                public: None,
                boxes: list(&x["to"]).iter().map(|t| KeyBox { to: self.recipient(t), bytes: vec![] }).collect(),
                clear: x["public"].as_bool().unwrap().then_some([0; 32]),
            },
            other => panic!("no action {other}"),
        }
    }

    /// The op at the next place of the case, from its JSON, at `depth`.
    fn op_of(&self, v: &Value, depth: u64) -> Op {
        let cosigners = list(&v["cosigners"]).iter().map(signer).collect();
        Op { parents: vec![], depth, author: signer(&v["author"]), cosigners, action: self.action(&v["action"]) }
    }

    /// Name what `op`, at the next place, creates. A vault's number names the vault only once its genesis is accepted,
    /// as the step cases try one number more than once; spaces and grants have a number each.
    fn created(&mut self, v: &Value, op: &Op, accepted: bool) {
        let (name, x) = v["action"].as_object().and_then(|o| o.iter().next()).expect("an action");
        match name.as_str() {
            "genesis" if accepted => {
                self.vaults.insert(num(&x["vault"]), VaultId::from(op.id()));
            }
            "foundSpace" => {
                self.spaces.insert(num(&x["space"]), SpaceId::from(op.id()));
            }
            "grant" => {
                self.grants.insert(num(&x["id"]), GrantId::from(op.id()));
            }
            _ => {}
        }
        self.ops.push(op.id());
    }

    fn vault_of(&self, v: &Value) -> Vault {
        Vault {
            id: self.vault(&v["id"]),
            kind: kind(&v["kind"]),
            owners: list(&v["owners"]).iter().map(|p| self.principal(p)).collect(),
            threshold: num(&v["threshold"]) as u32,
            devices: list(&v["devices"]).iter().map(signer).collect(),
            root: (!v["root"].is_null()).then(|| signer(&v["root"])),
        }
    }

    fn space_of(&self, v: &Value) -> Space {
        Space { id: self.space(&v["id"]), founder: self.vault(&v["founder"]), entries: list(&v["entries"]).iter().map(entry).collect() }
    }

    fn write_of(&self, v: &Value) -> Write {
        Write {
            op: self.op(&v["op"]),
            author: signer(&v["author"]),
            actor: self.vault(&v["actor"]),
            space: self.space(&v["space"]),
            entry: entry(&v["entry"]),
            epoch: num(&v["epoch"]),
            deps: self.ops(&v["deps"]),
        }
    }

    /// The state a case ends with must be the model's.
    fn check_state(&self, name: &str, case: &Value, st: &State) {
        let vaults: Vec<Vault> = list(&case["vaults"]).iter().map(|v| self.vault_of(v)).collect();
        assert_eq!(st.vaults(), &vaults[..], "{name}: vaults");
        let spaces: Vec<Space> = list(&case["spaces"]).iter().map(|v| self.space_of(v)).collect();
        assert_eq!(st.spaces(), &spaces[..], "{name}: spaces");
        let grants: Vec<(GrantId, Grant)> = list(&case["grants"]).iter().map(|v| (self.grant(&v["id"]), self.grant_of(v))).collect();
        assert_eq!(st.grants(), grants, "{name}: grants");
        let writes: Vec<Write> = list(&case["writes"]).iter().map(|v| self.write_of(v)).collect();
        assert_eq!(st.all_writes(), &writes[..], "{name}: writes");
        let epochs: Vec<(KeyScope, u64)> =
            list(&case["epochs"]).iter().map(|v| (self.key_scope(&v["key"]), num(&v["epoch"]))).collect();
        let ours: Vec<(KeyScope, u64)> =
            st.key_scopes().into_iter().filter(|&k| st.epoch(k) > 0).map(|k| (k, st.epoch(k))).collect();
        assert_eq!(ours, epochs, "{name}: epochs");
        let seals: Vec<Seal> = list(&case["seals"])
            .iter()
            .map(|v| Seal { secret: self.key_name(&v["secret"]), to: self.key_name(&v["to"]) })
            .collect();
        assert_eq!(st.seals(), &seals[..], "{name}: seals");
        let published: Vec<KeyName> = list(&case["published"]).iter().map(|v| self.key_name(v)).collect();
        assert_eq!(st.published(), &published[..], "{name}: published");
    }
}

fn vectors() -> Value {
    let file = std::fs::read_to_string(VECTORS).expect("the vectors: run `lake exe vectors` in vault/spec");
    serde_json::from_str(&file).unwrap()
}

#[test]
fn each_op_is_accepted_or_refused_as_in_the_lean_model() {
    let vectors = vectors();
    let cases = list(&vectors["cases"]);
    assert!(cases.len() >= 8);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let (ops, accepted) = (list(&case["ops"]), list(&case["accepted"]));
        assert_eq!(ops.len(), accepted.len(), "{name}");
        let mut names = Names::default();
        let mut st = State::default();
        for (i, (v, want)) in ops.iter().zip(accepted).enumerate() {
            let op = names.op_of(v, 0);
            let got = st.step(&op);
            assert_eq!(got.is_ok(), want.as_bool().unwrap(), "{name}, op {i}: {v} gave {got:?}", got = got.as_ref().err());
            names.created(v, &op, got.is_ok());
            if let Ok(next) = got {
                st = next;
            }
        }
        names.check_state(name, case, &st);
    }
}

#[test]
fn each_op_stands_or_is_cut_as_in_the_lean_models_view() {
    let vectors = vectors();
    let cases = list(&vectors["views"]);
    assert!(cases.len() >= 8);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let (ops, standing) = (list(&case["ops"]), list(&case["standing"]));
        assert_eq!(ops.len(), standing.len(), "{name}");
        let mut names = Names::default();
        let mut held = vec![];
        for v in ops {
            let op = names.op_of(v, num(&v["depth"]));
            names.created(v, &op, true);
            held.push(op);
        }
        let r = replay(&held);
        let stood = r.standing();
        for (i, (op, want)) in held.iter().zip(standing).enumerate() {
            assert_eq!(stood.contains(&op.id()), want.as_bool().unwrap(), "{name}, op {i}: {}", ops[i]);
        }
        names.check_state(name, case, &r.state);
    }
}
