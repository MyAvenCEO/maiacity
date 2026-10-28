//! What the Proposals page's first read costs a device the size of Samuel's Mac (Goal 7, 2026-10-28: theOS caught up
//! sat on "Reading the AIPs of your vaults…"): `aips` over a vault of many notes, each with a few versions, and AIPs
//! over proposal lines of them at every stage, some applied by a review, some bare proposals no AIP names. Each read
//! run on its own, on the Lab alone, so that it is the read's own cost. An `AIPS_SCALE {...}` line per run.
//!
//!   AIPS_SCALE_AIPS=60 AIPS_SCALE_NOTES=2000 cargo test --release -p avendb --test all aips_scale:: -- --ignored --nocapture
//!
//! And the Assets page's first read (Goal 7, 2026-10-28: on the iPhone the first asset took long to show): `database`
//! and `entry_views` of the vault's recipes, each an asset of a few versions, each a proposal whose one write is its
//! record and its file, merged into main, and a variant beside main, as the seed writes them. An `ASSETS_SCALE {...}`
//! line per run.
//!
//!   ASSETS_SCALE_RECIPES=200 ASSETS_SCALE_VERSIONS=6 cargo test --release -p avendb --test all aips_scale::measure_assets -- --ignored --nocapture
#![cfg(not(debug_assertions))]

use std::time::{Duration, Instant};

use avendb::cast;
use avendb::lab::Lab;
use avendb::engine;
use avendb::id::{SignerId, VaultId};
use avendb::policy::{Action, Kind, Level, Principal, Sharing};
use avendb::sealed::{Brought, FileKey, seal};
use avendb::slice::{Atom, Selector};
use avendb_testkit::ok;
use serde_json::{Value, json};

/// What every AIP here must deliver.
const OBJECTIVE: &str = "import AvenDB.Objective\nopen AvenDB.Objective\n\n/-- Ripe by day 120. -/\n\
    def ripe : Metric := metric \"Day the corn is ripe\" (atMost (reading \"ripe_day\") 120)\n";

fn env(name: &str, default: usize) -> usize {
    std::env::var(name).ok().and_then(|n| n.parse().ok()).unwrap_or(default)
}

fn note(i: usize) -> Value {
    let block = json!({ "id": 1, "type": "paragraph", "text": format!("Plant field {i} in May.") });
    json!({ "kind": "document", "title": format!("Field {i}"), "blocks": [block] })
}

fn set(path: Value, value: Value) -> Value {
    json!({ "op": "set", "path": path, "value": value })
}

struct Fixture {
    lab: Lab,
    alice: VaultId,
    aven: VaultId,
    mac: SignerId,
}

/// Alice's vault, made by her passkey, her Mac one of its devices, and her aven, which a coop of hers owns: an Editor
/// of her notes and AIPs, as `tests/all/aip.rs` sets them up (`cast::world` is a debug build's alone).
fn fixture() -> Fixture {
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let genesis = |kind: Kind, owners: Vec<Principal>, root: Option<SignerId>, nonce: u64| Action::Genesis {
        kind, owners, threshold: 1, root, nonce, seal_to: vec![],
    };
    let alice = VaultId::from(lab.submit(mac, &[passkey], genesis(Kind::Human, vec![Principal::Signer(passkey)], Some(passkey), 0)).expect("a vault"));
    let add = Action::Share(Sharing::Device { vault: alice, device: mac, seal_to: None });
    lab.submit(mac, &[passkey, mac], add).expect("her Mac added");
    let coop = VaultId::from(lab.submit(mac, &[passkey], genesis(Kind::Coop, vec![Principal::Vault(alice)], None, 5)).expect("a coop"));
    let aven = VaultId::from(lab.submit(mac, &[passkey], genesis(Kind::Aven, vec![Principal::Vault(coop)], None, 5)).expect("an aven"));
    let types = |ts: &[&str]| Selector::AnyOf(vec![vec![Atom::TypeIn(ts.iter().map(|&t| t.into()).collect())]]);
    let editor = cast::share(alice, cast::vault(aven), Level::Write, types(&["note", "aip"]));
    lab.issue(mac, &[mac], editor).expect("an editor");
    Fixture { lab, alice, aven, mac }
}

impl Fixture {
    fn run(&mut self, op: Value) -> Value {
        ok(engine::run(&mut self.lab, self.mac, &op))
    }

    fn create(&mut self, i: usize) -> String {
        let op = json!({ "op": "create", "vault": self.alice.to_hex(), "type": "note", "value": note(i) });
        self.run(op)["entry"].as_str().expect("its id").to_string()
    }

    /// Her aven proposes `writes` writes on entry `e`, a proposal named `name`: its line.
    fn propose(&mut self, e: &str, name: &str, writes: usize) -> String {
        let start = json!({ "op": "propose", "entry": e, "name": name, "as": self.aven.to_hex() });
        let line = self.run(start)["line"].as_str().expect("its line").to_string();
        for k in 0..writes {
            let op = set(json!(["blocks", { "id": 1 }, "text"]), json!(format!("Plant in April, take {k}.")));
            let ops = vec![json!({ "entry": e, "line": line, "op": op["op"], "path": op["path"], "value": op["value"] })];
            self.run(json!({ "op": "batch", "as": self.aven.to_hex(), "ops": ops }));
        }
        line
    }
}

fn timed(f: &mut Fixture, op: &Value, runs: usize) -> Value {
    let mut took: Vec<Duration> = (0..runs)
        .map(|_| {
            let at = Instant::now();
            let answer = engine::read(&f.lab, f.mac, op);
            let took = at.elapsed();
            assert!(answer.get("ok").is_some(), "{op} answers: {answer}");
            took
        })
        .collect();
    took.sort();
    let ms = |d: Duration| (d.as_secs_f64() * 1e4).round() / 10.0;
    json!({ "min": ms(took[0]), "median": ms(took[runs / 2]), "max": ms(took[runs - 1]) })
}

#[test]
#[ignore]
fn measure_aips_read() {
    let (aips, notes, versions, bare) =
        (env("AIPS_SCALE_AIPS", 60), env("AIPS_SCALE_NOTES", 2000), env("AIPS_SCALE_VERSIONS", 4), env("AIPS_SCALE_BARE", 30));
    let runs = env("AIPS_SCALE_RUNS", 5).max(1);
    let began = Instant::now();
    let mut f = fixture();
    let entries: Vec<String> = (0..notes).map(|i| f.create(i)).collect();
    // each note a few versions on main
    for (i, e) in entries.iter().enumerate() {
        for k in 1..versions {
            let op = set(json!(["blocks", { "id": 1 }, "text"]), json!(format!("Plant field {i}, version {k}.")));
            f.run(json!({ "op": "batch", "ops": [json!({ "entry": e, "op": op["op"], "path": op["path"], "value": op["value"] })] }));
        }
    }
    // AIPs over one line each: an idea, an objective, proposed, and applied by Alice's review, in turn
    for a in 0..aips {
        let e = entries[a % entries.len()].clone();
        let line = f.propose(&e, &format!("Earlier {a}"), 3);
        let open = json!({ "op": "aip_open", "vault": f.alice.to_hex(), "title": format!("AIP {a}"),
            "proposals": [{ "entry": e, "line": line }], "note": "Why: earlier corn.",
            "objective": if a % 4 == 0 { Value::Null } else { json!(OBJECTIVE) }, "as": f.aven.to_hex() });
        let aip = f.run(open)["entry"].as_str().expect("its entry").to_string();
        if a % 4 >= 2 {
            f.run(json!({ "op": "aip_promote", "entry": aip, "as": f.aven.to_hex() }));
        }
        if a % 4 == 3 {
            f.run(json!({ "op": "aip_review", "entry": aip, "verdict": "accepted", "text": "Ship it", "as": f.alice.to_hex() }));
        }
    }
    // proposals no AIP names
    for b in 0..bare {
        let e = entries[(aips + b) % entries.len()].clone();
        f.propose(&e, &format!("Bare {b}"), 2);
    }
    let edits = f.lab.log(f.mac).edits().len();
    eprintln!("AIPS_SCALE fixture: {edits} edits, {notes} notes, {aips} AIPs, {bare} bare, in {:.1?}", began.elapsed());
    // a room of Alice's vault with `AIPS_SCALE_MESSAGES` messages, as the Chat app reads its last 50
    let messages = env("AIPS_SCALE_MESSAGES", 500);
    let value = json!({ "kind": "room", "look": "group", "name": "Garden" });
    let room = f.run(json!({ "op": "create", "vault": f.alice.to_hex(), "type": "room", "value": value }))["entry"]
        .as_str().expect("its id").to_string();
    for m in 0..messages {
        let post = json!({ "id": m as i64 + 1, "text": format!("Message {m}"), "at": 1_700_000_000_000_i64 + m as i64 });
        f.run(json!({ "op": "insert", "entry": room, "path": ["messages"], "value": post }));
    }
    let untyped = f.lab.untyped_of(f.mac, Some(f.alice)).len();
    let at = Instant::now();
    for _ in 0..100 { std::hint::black_box(avendb::world::profile_of(&f.lab, f.mac, f.alice)); }
    eprintln!("AIPS_SCALE profile_of: {:.3} ms each, {untyped} entries untyped", at.elapsed().as_secs_f64() * 10.0);
    let room_ms = timed(&mut f, &json!({ "op": "room", "entry": room }), runs);
    let all = json!({ "op": "aips" });
    let vault = json!({ "op": "aips", "vault": f.alice.to_hex() });
    let answer = engine::read(&f.lab, f.mac, &all);
    let listed = answer["ok"].as_array().map_or(0, Vec::len);
    let out = json!({
        "edits": edits, "notes": notes, "aips": aips, "bare": bare, "listed": listed,
        "aips_ms": timed(&mut f, &all, runs),
        "aips_vault_ms": timed(&mut f, &vault, runs),
        "messages": messages, "room_ms": room_ms,
    });
    println!("AIPS_SCALE {out}");
}

/// A recipe's source, sealed under a key of its own, as a node's store seals it (`Node::store_file`).
fn source(text: &str) -> Brought {
    let (key, plain) = (FileKey::from_bytes([7; 32]), text.repeat(300).into_bytes());
    let root = avendb::hash::hash("a test file's root", &seal(&key, &plain));
    Brought::new(root, key, plain.len() as u64)
}

/// Recipe `label` at version `version`, as the asset thread keeps one: its card and its engine, its source in its file.
fn recipe(label: &str, version: usize) -> Value {
    json!({
        "kind": "recipe", "title": label, "note": "Built in its parts.", "tags": [format!("ref:machines/{label}@{version}")],
        "source": "", "engine": { "host": "box", "version": 4, "hash": "ab".repeat(32) },
        "manifest": { "kit": ["box"], "presets": ["brass"], "controls": ["slider"] },
        "card": { "format": "asset-card", "v": 1, "group": "machines", "label": label, "version": version },
    })
}

#[test]
#[ignore]
fn measure_assets_read() {
    let (recipes, versions, notes) = (env("ASSETS_SCALE_RECIPES", 200), env("ASSETS_SCALE_VERSIONS", 6), env("ASSETS_SCALE_NOTES", 1000));
    let runs = env("AIPS_SCALE_RUNS", 5).max(1);
    let began = Instant::now();
    let mut f = fixture();
    let alice = f.alice.to_hex();
    for i in 0..notes {
        f.create(i);
    }
    for r in 0..recipes {
        let label = format!("Lamp {r}");
        let first = source(&format!("{label} v1 "));
        let create = json!({ "op": "create", "vault": alice, "type": "recipe", "value": recipe(&label, 1),
            "file": { "len": first.len, "name": format!("{label}.js"), "media": "text/javascript" } });
        let e = ok(engine::put_file(&mut f.lab, f.mac, &create, first))["entry"].as_str().expect("its id").to_string();
        for v in 2..=versions {
            let line = f.run(json!({ "op": "propose", "entry": e, "name": format!("v{v}") }))["line"].clone();
            let file = source(&format!("{label} v{v} "));
            let put = json!({ "op": "put_file", "entry": e, "line": line, "value": recipe(&label, v), "len": file.len });
            ok(engine::put_file(&mut f.lab, f.mac, &put, file));
            f.run(json!({ "op": "merge", "entry": e, "from": line, "into": null }));
        }
        let variant = f.run(json!({ "op": "variant", "entry": e, "name": "brass" }))["line"].clone();
        let file = source(&format!("{label} brass "));
        let put = json!({ "op": "put_file", "entry": e, "line": variant, "value": recipe(&label, versions), "len": file.len });
        ok(engine::put_file(&mut f.lab, f.mac, &put, file));
    }
    let edits = f.lab.log(f.mac).edits().len();
    eprintln!("ASSETS_SCALE fixture: {edits} edits, {recipes} recipes of {versions} versions, {notes} notes, in {:.1?}", began.elapsed());
    let database = json!({ "op": "database", "vault": alice, "types": ["recipe"] });
    let views = json!({ "op": "entry_views", "vault": alice, "types": ["recipe"] });
    let answer = engine::read(&f.lab, f.mac, &database);
    let rows = answer["ok"]["rows"].as_array().map_or(0, Vec::len);
    let brought = answer["ok"]["rows"].as_array().map_or(0, |r| r.iter().map(|r| r["brought"].as_array().map_or(0, Vec::len)).sum());
    assert_eq!(rows, recipes, "every recipe a row");
    let out = json!({
        "edits": edits, "recipes": recipes, "versions": versions, "rows": rows, "brought": brought,
        "database_ms": timed(&mut f, &database, runs),
        "entry_views_ms": timed(&mut f, &views, runs),
    });
    println!("ASSETS_SCALE {out}");
}
