//! aven-id against the running Lean model (README rule 10): random trees, well formed or not, go to `aven-id-model`
//! (`id/spec`), and every answer it gives must be this crate's. Set `AVEN_ID_MODEL` to a built model to skip `lake`.

use std::cell::{Cell, RefCell};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::OnceLock;

use aven_id::{Kind, Owner, Tree, Vault};
use proptest::prelude::*;
use proptest::test_runner::{Config, TestRunner};
use serde_json::{Value, json};

/// The built model, built once per run.
static EXE: OnceLock<PathBuf> = OnceLock::new();

struct Model {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Model {
    fn start() -> Model {
        let exe = EXE.get_or_init(|| match std::env::var("AVEN_ID_MODEL") {
            Ok(exe) => PathBuf::from(exe),
            Err(_) => {
                let spec = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec");
                let built = Command::new("lake")
                    .arg("build")
                    .arg("aven-id-model")
                    .current_dir(&spec)
                    .status();
                assert!(
                    built.is_ok_and(|s| s.success()),
                    "lake build aven-id-model failed in {}",
                    spec.display()
                );
                spec.join(".lake/build/bin/aven-id-model")
            }
        });
        let mut child = Command::new(exe)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap_or_else(|e| panic!("can't run {}: {e}", exe.display()));
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Model {
            _child: child,
            stdin,
            stdout,
        }
    }

    fn ask(&mut self, case: &Value) -> Value {
        writeln!(self.stdin, "{case}").unwrap();
        self.stdin.flush().unwrap();
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        let answer: Value =
            serde_json::from_str(&line).unwrap_or_else(|e| panic!("model said {line:?}: {e}"));
        assert!(
            answer.get("error").is_none(),
            "model refused {case}: {answer}"
        );
        answer
    }
}

const KEYS: [&str; 2] = ["k0", "k1"];

/// A raw tree: keys, then vaults with ids `v0`, `v1`, … in a shuffled order. Owners mostly point at earlier vaults,
/// so many trees are well formed; now and then at any vault, an unknown one or an unknown key, so many are not.
fn trees() -> impl Strategy<Value = (Vec<String>, Vec<Vault>)> {
    let vault = (
        0u8..3,
        0u8..4,
        proptest::collection::vec((0u8..40, 0u8..8), 1..4),
        0u8..8,
    );
    (1usize..8)
        .prop_flat_map(move |n| (Just(n), proptest::collection::vec(vault.clone(), n)))
        .prop_map(|(n, specs)| {
            let kinds: Vec<Kind> = specs
                .iter()
                .map(|s| [Kind::Person, Kind::Network, Kind::Device][s.0 as usize])
                .collect();
            // an earlier vault, mostly one that may own (not a device)
            let earlier = |i: usize, at: u8, any: bool| {
                let owners: Vec<usize> = (0..i)
                    .filter(|&j| any || kinds[j] != Kind::Device)
                    .collect();
                owners
                    .get(at as usize % owners.len().max(1))
                    .map(|j| Owner::Vault(format!("v{j}")))
            };
            let vaults: Vec<Vault> = specs
                .into_iter()
                .enumerate()
                .map(|(i, (_, simple, owners, up))| {
                    let kind = kinds[i];
                    let single = if kind == Kind::Device && simple > 0 {
                        earlier(i, up, simple == 1)
                    } else {
                        None
                    };
                    let owners = match single {
                        Some(owner) => vec![owner],
                        None if simple == 0 && up == 0 => vec![],
                        None => owners
                            .into_iter()
                            .map(|(tag, at)| match tag {
                                0..12 => Owner::Key(KEYS[at as usize % 2].into()),
                                12 => Owner::Key("k9".into()),
                                13..38 => {
                                    earlier(i, at, tag == 13).unwrap_or(Owner::Key("k0".into()))
                                }
                                _ => Owner::Vault(format!("v{}", at as usize % (n + 1))),
                            })
                            .collect(),
                    };
                    Vault {
                        id: format!("v{i}"),
                        name: format!("v{i}"),
                        kind,
                        owners,
                    }
                })
                .collect();
            vaults
        })
        .prop_shuffle()
        .prop_map(|vaults| (KEYS.iter().map(|k| k.to_string()).collect(), vaults))
}

/// Every query on every vault, an unknown one included, and every pair for `mayActOn`.
fn queries(vaults: &[Vault]) -> Vec<Value> {
    let mut ids: Vec<&str> = vaults.iter().map(|v| v.id.as_str()).collect();
    ids.push("nobody");
    let mut out = vec![json!(["accounts", null])];
    for &x in &ids {
        for q in [
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

fn answer(t: &Tree, q: &Value) -> Value {
    let arg = |i: usize| q[i].as_str().unwrap_or_default();
    match arg(0) {
        "owned" => json!(t.owned(arg(1))),
        "governs" => json!(t.governs(arg(1))),
        "chain" => json!(t.chain(arg(1))),
        "actsFor" => json!(t.acts_for(arg(1))),
        "actsThrough" => json!(t.acts_through(arg(1))),
        "accounts" => json!(t.accounts(q[1].as_str())),
        "sees" => json!(t.sees(arg(1))),
        "mayActOn" => json!(t.may_act_on(arg(1), arg(2))),
        other => panic!("unknown query {other}"),
    }
}

fn case(keys: &[String], vaults: &[Vault]) -> Value {
    let vaults: Vec<Value> = vaults
        .iter()
        .map(|v| {
            let owners: Vec<String> = v.owners.iter().map(Owner::to_string).collect();
            json!({ "id": v.id, "kind": v.kind.as_str(), "owners": owners })
        })
        .collect();
    json!({ "keys": keys, "vaults": vaults })
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
            let tree = Tree::new(
                keys.iter().map(|k| (k.clone(), String::new())).collect(),
                vaults.clone(),
            );
            prop_assert_eq!(
                lean["wf"].as_bool(),
                Some(tree.is_ok()),
                "well formed? {} {:?}",
                ask,
                tree.err()
            );
            total.set(total.get() + 1);
            if let Ok(tree) = tree {
                formed.set(formed.get() + 1);
                for (q, want) in queries.iter().zip(lean["answers"].as_array().unwrap()) {
                    prop_assert_eq!(&answer(&tree, q), want, "{} on {}", q, ask);
                }
            }
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

#[test]
fn the_cast_agrees_with_the_lean_model() {
    let t = Tree::from_cast(include_str!("../../../sandbox/cast.json")).unwrap();
    let keys: Vec<String> = t.keys().map(|(id, _)| id.to_string()).collect();
    let mut ask = case(&keys, t.vaults());
    let queries = queries(t.vaults());
    ask["queries"] = json!(queries);
    let lean = Model::start().ask(&ask);
    assert_eq!(lean["wf"], json!(true));
    for (q, want) in queries.iter().zip(lean["answers"].as_array().unwrap()) {
        assert_eq!(&answer(&t, q), want, "{q}");
    }
}
