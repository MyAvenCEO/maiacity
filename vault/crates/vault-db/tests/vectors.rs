//! The Lean model's test vectors (`vault/spec/vectors/vaults.json`, written by `lake exe vectors`, checked by every
//! `lake build`): each case's ops, applied one after the other from the empty state, must be accepted or refused
//! exactly as the model says, and leave the same vaults. The model names vaults by numbers and the core by the hash
//! of their genesis, so each number maps to the vault its accepted genesis created.

use std::collections::HashMap;

use serde_json::Value;
use vault_db::id::{SignerId, VaultId};
use vault_db::policy::{Action, Kind, Op, Principal, State, Vault};

const VECTORS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/vectors/vaults.json");

fn num(v: &Value) -> u64 {
    v.as_u64().unwrap_or_else(|| panic!("a number, not {v}"))
}

fn signer(v: &Value) -> SignerId {
    SignerId::from_u64(num(v))
}

fn kind(v: &Value) -> Kind {
    match v.as_str() {
        Some("human") => Kind::Human,
        Some("coop") => Kind::Coop,
        _ => panic!("a kind, not {v}"),
    }
}

/// The model's vault numbers, as the core names them.
#[derive(Default)]
struct Vaults(HashMap<u64, VaultId>);

impl Vaults {
    fn get(&self, v: &Value) -> VaultId {
        let n = num(v);
        self.0.get(&n).copied().unwrap_or(VaultId::from_u64(n))
    }

    fn principal(&self, v: &Value) -> Principal {
        match (v.get("signer"), v.get("vault")) {
            (Some(s), None) => Principal::Signer(signer(s)),
            (None, Some(x)) => Principal::Vault(self.get(x)),
            _ => panic!("a principal, not {v}"),
        }
    }

    fn action(&self, v: &Value) -> Action {
        let (name, x) = v.as_object().and_then(|o| o.iter().next()).unwrap_or_else(|| panic!("an action, not {v}"));
        let vault = || self.get(&x["vault"]);
        match name.as_str() {
            "genesis" => Action::Genesis {
                kind: kind(&x["kind"]),
                owners: x["owners"].as_array().unwrap().iter().map(|p| self.principal(p)).collect(),
                threshold: num(&x["threshold"]) as u32,
                // the model's number keeps two geneses with the same owners apart, as a nonce does
                nonce: num(&x["vault"]),
            },
            "addOwner" => Action::AddOwner { vault: vault(), owner: self.principal(&x["owner"]) },
            "removeOwner" => Action::RemoveOwner { vault: vault(), owner: self.principal(&x["owner"]), keep: vec![] },
            "setThreshold" => Action::SetThreshold { vault: vault(), threshold: num(&x["threshold"]) as u32 },
            "addDevice" => Action::AddDevice { vault: vault(), device: signer(&x["device"]) },
            "removeDevice" => Action::RemoveDevice { vault: vault(), device: signer(&x["device"]), keep: vec![] },
            other => panic!("no action {other}"),
        }
    }

    fn vault(&self, v: &Value) -> Vault {
        Vault {
            id: self.get(&v["id"]),
            kind: kind(&v["kind"]),
            owners: v["owners"].as_array().unwrap().iter().map(|p| self.principal(p)).collect(),
            threshold: num(&v["threshold"]) as u32,
            devices: v["devices"].as_array().unwrap().iter().map(signer).collect(),
        }
    }
}

#[test]
fn the_vault_rules_answer_as_the_lean_model() {
    let file = std::fs::read_to_string(VECTORS).expect("the vectors: run `lake exe vectors` in vault/spec");
    let vectors: Value = serde_json::from_str(&file).unwrap();
    let cases = vectors["cases"].as_array().unwrap();
    assert!(cases.len() >= 5);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let ops = case["ops"].as_array().unwrap();
        let accepted = case["accepted"].as_array().unwrap();
        assert_eq!(ops.len(), accepted.len(), "{name}");
        let mut vaults = Vaults::default();
        let mut st = State::default();
        for (i, (v, want)) in ops.iter().zip(accepted).enumerate() {
            let cosigners = v["cosigners"].as_array().unwrap().iter().map(signer).collect();
            let op = Op { parents: vec![], depth: 0, author: signer(&v["author"]), cosigners, action: vaults.action(&v["action"]) };
            let got = st.step(&op);
            assert_eq!(got.is_ok(), want.as_bool().unwrap(), "{name}, op {i}: {v} gave {got:?}", got = got.as_ref().err());
            if let Ok(next) = got {
                st = next;
                if let Action::Genesis { nonce, .. } = op.action {
                    vaults.0.insert(nonce, VaultId::from(op.id()));
                }
            }
        }
        let want: Vec<Vault> = case["vaults"].as_array().unwrap().iter().map(|v| vaults.vault(v)).collect();
        assert_eq!(st.vaults(), &want[..], "{name}");
    }
}
