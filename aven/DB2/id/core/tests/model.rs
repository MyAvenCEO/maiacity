//! aven-id against the running Lean model (README rule 10): random trees, well formed or not, go to `aven-id-model`
//! (`id/spec`), and every answer it gives must be this crate's, the rule a tree breaks included. Set `AVEN_ID_MODEL`
//! to a built model to skip `lake`.

mod common;

use std::cell::{Cell, RefCell};

use aven_id::{Kind, Owner, Vault};
use common::model::Model;
use common::{case, result};
use proptest::prelude::*;
use proptest::test_runner::{Config, TestRunner};
use serde_json::{Value, json};

const KEYS: [&str; 2] = ["k0", "k1"];

/// A raw tree: keys, then vaults with ids `v0`, `v1`, … in a shuffled order. Owners mostly point at earlier vaults,
/// so many trees are well formed; now and then at any vault, an unknown one, an unknown key or a device's key, and
/// now and then a device lacks its key, so many are not. A device's one owner is mostly no coop, a coop's owners are
/// mostly earlier people's or coops' vaults, and now and then a name is empty or two lines (`Aven.ID.Gen`).
fn trees() -> impl Strategy<Value = (Vec<String>, Vec<Vault>)> {
    let vault = (
        0u8..5,
        0u8..4,
        proptest::collection::vec((0u8..40, 0u8..8), 1..4),
        0u8..8,
        0u8..64,
    );
    (1usize..8)
        .prop_flat_map(move |n| (Just(n), proptest::collection::vec(vault.clone(), n)))
        .prop_map(|(n, specs)| {
            let ups: Vec<u8> = specs.iter().map(|s| s.3).collect();
            let kinds: Vec<Kind> = specs
                .iter()
                .map(|s| {
                    [
                        Kind::Person,
                        Kind::Agent,
                        Kind::Coop,
                        Kind::Device,
                        Kind::Person,
                    ][s.0 as usize]
                })
                .collect();
            let devices: Vec<usize> = (0..kinds.len())
                .filter(|&j| kinds[j] == Kind::Device)
                .collect();
            // an earlier vault of a kind that fits: mostly one that may own (not a device)
            let earlier = |i: usize, at: u8, fits: &dyn Fn(Kind) -> bool| {
                let owners: Vec<usize> = (0..i).filter(|&j| fits(kinds[j])).collect();
                owners
                    .get(at as usize % owners.len().max(1))
                    .map(|j| Owner::Vault(format!("v{j}")))
            };
            let vaults: Vec<Vault> = specs
                .into_iter()
                .enumerate()
                .map(|(i, (_, simple, owners, up, named))| {
                    let kind = kinds[i];
                    // a device's one owner: mostly a vault that may hold devices (no device, no coop)
                    let holds = |k: Kind| simple == 1 || !matches!(k, Kind::Device | Kind::Coop);
                    let single = if kind == Kind::Device && simple > 0 {
                        earlier(i, up, &holds)
                    } else {
                        None
                    };
                    let owners = match single {
                        Some(owner) => vec![owner],
                        None if simple == 0 && up == 0 => vec![],
                        None => owners
                            .into_iter()
                            .map(|(tag, at)| match tag {
                                0..12 if kind == Kind::Coop => {
                                    earlier(i, at, &|k| matches!(k, Kind::Person | Kind::Coop))
                                        .unwrap_or(Owner::Key("k0".into()))
                                }
                                0..12 => Owner::Key(KEYS[at as usize % 2].into()),
                                12 => Owner::Key("k9".into()),
                                // a device's key as an owner, which no well-formed tree has
                                13 => devices
                                    .get(at as usize % devices.len().max(1))
                                    .map_or(Owner::Key("k9".into()), |j| {
                                        Owner::Key(format!("v{j}"))
                                    }),
                                14..38 => {
                                    let fits = |k: Kind| {
                                        tag == 14
                                            || if kind == Kind::Coop {
                                                matches!(k, Kind::Person | Kind::Coop)
                                            } else {
                                                k != Kind::Device
                                            }
                                    };
                                    earlier(i, at, &fits).unwrap_or(Owner::Key("k0".into()))
                                }
                                _ => Owner::Vault(format!("v{}", at as usize % (n + 1))),
                            })
                            .collect(),
                    };
                    let name = match named {
                        0 => String::new(),
                        1 => format!("v{i}\nv{i}"),
                        _ => format!("v{i}"),
                    };
                    Vault {
                        id: format!("v{i}"),
                        name,
                        kind,
                        owners,
                    }
                })
                .collect();
            let mut keys: Vec<String> = KEYS.iter().map(|k| k.to_string()).collect();
            keys.extend(
                vaults
                    .iter()
                    .zip(&ups)
                    .filter(|(v, up)| v.kind == Kind::Device && **up != 7)
                    .map(|(v, _)| v.id.clone()),
            );
            (keys, vaults)
        })
        .prop_flat_map(|(keys, vaults)| (Just(keys), Just(vaults).prop_shuffle()))
}

/// Every query on every vault, an unknown one included, and every pair for `mayActOn`: `Tree.everyQuery`.
fn queries(vaults: &[Vault]) -> Vec<Value> {
    let mut ids: Vec<&str> = vaults.iter().map(|v| v.id.as_str()).collect();
    ids.push("nobody");
    let mut out = vec![json!(["accounts", null])];
    for &x in &ids {
        for q in [
            "kind",
            "name",
            "owners",
            "owned",
            "governs",
            "chain",
            "actsFor",
            "actsThrough",
            "accounts",
            "sees",
        ] {
            out.push(json!([q, x]));
        }
        for &y in &ids {
            out.push(json!(["mayActOn", x, y]));
        }
    }
    out
}

#[test]
fn agrees_with_the_lean_model() {
    let model = RefCell::new(Model::start());
    let cases = std::env::var("AVEN_ID_CASES")
        .ok()
        .and_then(|n| n.parse().ok())
        .unwrap_or(2000);
    let mut runner = TestRunner::new(Config {
        cases,
        failure_persistence: None,
        ..Config::default()
    });
    let (formed, total) = (Cell::new(0u32), Cell::new(0u32));
    runner
        .run(&trees(), |(keys, vaults)| {
            let mut ask = case(&keys, &vaults);
            let queries = queries(&vaults);
            ask["queries"] = json!(queries);
            let lean = model.borrow_mut().ask(&ask);
            let ours = result(&keys, &vaults, &queries);
            total.set(total.get() + 1);
            if ours["wf"] == json!(true) {
                formed.set(formed.get() + 1);
            }
            prop_assert_eq!(&ours, &lean, "on {}", ask);
            Ok(())
        })
        .unwrap();
    // both sides must be exercised: enough well-formed trees to query, enough others to refuse
    let (formed, total) = (formed.get(), total.get());
    eprintln!("{formed} of {total} random trees well formed");
    assert!(
        formed * 5 >= total && formed * 10 <= total * 9,
        "{formed} of {total} well formed"
    );
}
