//! The gate of C4b, code entries in avenDB (`docs/ARCHITECTURE.md` §9 and §10; the Scion plan's phases A, B and I):
//! prepared, and loaded by no app yet. One entry of each kind of code, a recipe, a view, a logic and a function, goes
//! the whole way through the ops engine (`engine::run`), as the page and an aven send ops: Alice's aven proposes a
//! change to an entry of Alice's vault, which an Editor share lets it write; Alice accepts it by a review; the aven
//! merges it into main; and what main reads back is the record the proposal held when she accepted it, byte for byte,
//! on every device that reads the entry. A decline and a request to revise accept nothing; a merge on top of no accept
//! the aven's device refuses, and the one a patched app makes all the same counts for no reader (M2).

use avendb::cast::{self, World};
use avendb::engine;
use avendb::id::{SignerId, VaultId};
use avendb::policy::{Action, Kind, Level, Principal};
use avendb::slice::{Atom, Selector};
use serde_json::{json, Value};

fn run(w: &mut World, d: SignerId, op: Value) -> Value {
    engine::run(&mut w.lab, d, &op)
}

/// What an op answered, which it must have done.
fn ok(answer: Value) -> Value {
    assert!(answer.get("ok").is_some(), "refused: {answer}");
    answer["ok"].clone()
}

/// Why an op was refused, which it must have been.
fn refused(answer: &Value) -> &str {
    answer["refused"].as_str().unwrap_or_else(|| panic!("not refused: {answer}"))
}

fn list(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or_default()
}

/// The kinds of code entry, as the entries' types and their records' kinds.
const KINDS: [&str; 4] = ["recipe", "view", "logic", "function"];

/// A code entry of kind `kind`, as JSON: its title, note and tags, its source, its engine and manifest, its params,
/// its contract, and for a recipe its card; a function, of v2, its name and code beside its engine and manifest.
fn code_entry(kind: &str) -> Value {
    let (host, manifest) = match kind {
        "recipe" => ("box", json!({ "kit": ["box", "cylinder"], "presets": ["brass"], "controls": ["slider"] })),
        "view" => ("view", json!({ "messages": ["state", "resize"], "slots": ["panel"], "libs": ["d3"] })),
        "function" => ("logic", json!({ "ops": ["tag", "set"] })),
        _ => ("logic", json!({ "hooks": ["tick", "trade"], "ops": ["set"] })),
    };
    let engine = json!({ "host": host, "version": 4, "hash": "ab".repeat(32) });
    if kind == "function" {
        return json!({ "kind": kind, "name": "Tidy", "code": "return [];", "engine": engine, "manifest": manifest });
    }
    let mut entry = json!({
        "kind": kind, "title": format!("A {kind}"), "note": "Made for the gate.", "tags": ["code"],
        "source": format!("// the {kind}\nexport default (x) => x;"), "engine": engine, "manifest": manifest,
        "params": [{ "id": 1, "name": "height", "kind": "number", "range": { "min": 0.2, "max": 2, "step": 0.1 },
            "default": 0.6 }],
        "contract": { "budgets": { "bytes": 200000, "ms": 2000 }, "invariants": ["replay-equal"] },
    });
    if kind == "recipe" {
        entry["card"] = json!({ "format": "asset-card", "v": 1, "group": "machines", "label": "Lamp" });
    }
    entry
}

/// The change an aven proposes to a code entry of kind `kind`, as record ops on the proposal: new code, a tuned param
/// and an engine of the next version, and for a recipe a new card.
fn change(kind: &str) -> Vec<Value> {
    let set = |path: Value, value: Value| json!({ "op": "set", "path": path, "value": value });
    // the engine and the card are objects, each one value, set whole
    let mut engine = code_entry(kind)["engine"].clone();
    engine["version"] = json!(5);
    let engine = set(json!(["engine"]), engine);
    if kind == "function" {
        return vec![set(json!(["code"]), json!("return [{ op: 'tag' }];")), engine];
    }
    let mut ops = vec![
        set(json!(["source"]), json!(format!("// the {kind}, tuned\nexport default (x) => 2 * x;"))),
        set(json!(["params", { "id": 1 }, "default"]), json!(0.8)),
        engine,
    ];
    if kind == "recipe" {
        let mut card = code_entry(kind)["card"].clone();
        card["label"] = json!("Brass lamp");
        ops.push(set(json!(["card"]), card));
    }
    ops
}

/// Alice's world with her aven, avenALICE, which her vault owns: Alice makes it an Editor of her code entries, and
/// Bob a Viewer of them. Her Mac acts for both her vault and her aven; her phone and Bob's Mac read what they write.
struct Gate {
    w: World,
    alice: VaultId,
    aven: VaultId,
    mac: SignerId,
    readers: [SignerId; 3],
}

fn gate() -> Gate {
    let mut w = cast::world();
    let (alice, bob, mac, passkey) = (w.alice, w.bob, w.mac_a, w.passkey_a);
    let owners = vec![Principal::Vault(alice)];
    let genesis = Action::Genesis { kind: Kind::Aven, owners, threshold: 1, root: None, nonce: 5, seal_to: vec![] };
    let aven = VaultId::from(w.lab.submit(mac, &[passkey], genesis).expect("avenALICE"));
    let code = Selector::AnyOf(vec![vec![Atom::TypeIn(KINDS.iter().map(|&k| k.into()).collect())]]);
    w.lab.issue(mac, &[mac], cast::share(alice, cast::vault(aven), Level::Write, code.clone())).expect("an editor");
    w.lab.issue(mac, &[mac], cast::share(alice, cast::vault(bob), Level::Read, code)).expect("a viewer");
    w.lab.sync_all(0);
    let readers = [mac, w.phone_a, w.mac_b];
    Gate { w, alice, aven, mac, readers }
}

impl Gate {
    /// Alice writes a code entry of kind `kind` in her vault.
    fn create(&mut self, kind: &str) -> String {
        let op = json!({ "op": "create", "vault": self.alice.to_hex(), "type": kind, "value": code_entry(kind) });
        let made = ok(run(&mut self.w, self.mac, op));
        made["entry"].as_str().expect("its id").to_string()
    }

    /// Her aven proposes `ops` on entry `e`: the proposal's line.
    fn propose(&mut self, e: &str, ops: Vec<Value>) -> Value {
        let aven = self.aven.to_hex();
        let start = json!({ "op": "propose", "entry": e, "name": "Tuned", "as": aven });
        let line = ok(run(&mut self.w, self.mac, start))["line"].clone();
        self.write(e, &line, ops);
        line
    }

    /// Her aven writes `ops` on line `line` of entry `e`, in one write.
    fn write(&mut self, e: &str, line: &Value, ops: Vec<Value>) {
        let on = |mut op: Value| {
            op["entry"] = json!(e);
            op["line"] = line.clone();
            op
        };
        let ops: Vec<Value> = ops.into_iter().map(on).collect();
        let batch = json!({ "op": "batch", "as": self.aven.to_hex(), "ops": ops });
        ok(run(&mut self.w, self.mac, batch));
    }

    /// Her aven's merge of line `line` of entry `e` into main.
    fn merge(&self, e: &str, line: &Value) -> Value {
        json!({ "op": "merge", "entry": e, "from": line, "as": self.aven.to_hex() })
    }

    /// Her vault's review of proposal `line` of entry `e`: its answer.
    fn review(&mut self, e: &str, line: &Value, verdict: &str, text: &str) -> Value {
        let op = json!({ "op": "review", "entry": e, "line": line, "verdict": verdict, "text": text,
            "as": self.alice.to_hex() });
        ok(run(&mut self.w, self.mac, op))
    }

    /// The record line `line` of entry `e` stores, as device `d` reads it, in its bytes.
    fn stored(&mut self, d: SignerId, e: &str, line: &Value) -> Vec<u8> {
        let got = ok(run(&mut self.w, d, json!({ "op": "get", "entry": e, "line": line, "schema": "stored" })));
        serde_json::to_vec(&got["record"]).expect("its bytes")
    }

    /// The record main holds of entry `e`, as device `d` reads it through the app's schema of `kind`.
    fn main(&mut self, d: SignerId, e: &str, kind: &str) -> Value {
        ok(run(&mut self.w, d, json!({ "op": "get", "entry": e, "schema": kind })))["record"].clone()
    }

    /// The writes of entry `e` device `d` holds: each one's id, kind, whether it counts and why not.
    fn edits(&mut self, d: SignerId, e: &str) -> Vec<(String, String, bool, Value)> {
        let history = ok(run(&mut self.w, d, json!({ "op": "history", "entry": e })));
        let edit = |x: &Value| {
            let id = x["id"].as_str().expect("an id").to_string();
            (id, x["kind"].as_str().expect("a kind").to_string(), x["counted"] == true, x["why"].clone())
        };
        list(&history["edits"]).iter().map(edit).collect()
    }

    fn sync(&mut self, seed: u64) {
        self.w.lab.sync_all(seed);
    }
}

/// C4b's gate: a recipe, a view, a logic and a function each go propose, accept review, merge, and read back the
/// accepted proposal's record byte for byte on main, on Alice's Mac and phone and on Bob's Mac alike; the aven's merge
/// before the accept its device refuses. The aven links the four proposals in a bundle of its own.
#[test]
fn each_kind_of_code_round_trips_propose_accept_merge_byte_for_byte() {
    let mut g = gate();
    let mut proposals = vec![];
    for (i, kind) in KINDS.into_iter().enumerate() {
        let e = g.create(kind);
        g.sync(1);
        let line = g.propose(&e, change(kind));
        // what it proposes is the proposal's alone; main holds the entry as Alice wrote it
        let main = g.main(g.mac, &e, kind);
        assert_eq!(main["engine"]["version"], 4, "{kind}: main is as it was");
        let merge = g.merge(&e, &line);
        assert_eq!(refused(&run(&mut g.w, g.mac, merge.clone())), "NotAccepted", "{kind}: nobody accepted it yet");
        let accepted = g.review(&e, &line, "accepted", "Ship it");
        let accept = accepted["accept"].as_str().expect("her accept").to_string();
        let review = ok(run(&mut g.w, g.mac, json!({ "op": "get", "entry": accepted["review"] })))["record"].clone();
        let want = json!({ "kind": "review", "entry": e, "line": line, "heads": [accept], "by": g.aven.to_hex(),
            "verdict": "accepted", "text": "Ship it", "at": 0 });
        assert_eq!(review, want, "{kind}: the review names the version she accepted, and who proposed it");
        let wanted = g.stored(g.mac, &e, &line);
        g.sync(2);
        ok(run(&mut g.w, g.mac, merge));
        g.sync(3);
        for d in g.readers {
            assert_eq!(g.stored(d, &e, &Value::Null), wanted, "{kind}: main reads back what she accepted");
            let edits = g.edits(d, &e);
            assert!(edits.iter().all(|x| x.2), "{kind}: every reader counts every write: {edits:?}");
            assert!(edits.iter().any(|x| x.0 == accept && x.1 == "accept"), "{kind}: her accept, as such");
            assert_eq!(edits.last().map(|x| x.1.as_str()), Some("merge"));
        }
        let main = g.main(g.readers[2], &e, kind);
        assert_eq!(main["engine"]["version"], 5, "{kind}: Bob reads it through the app's schema too");
        let link = json!({ "vault": g.alice.to_hex(), "entry": e });
        proposals.push(json!({ "id": i + 1, "entry": link, "line": line }));
    }
    // the aven bundles them, a record of its own vault that links each
    let bundle = json!({ "kind": "bundle", "title": "Brighter lamps", "proposals": proposals });
    let aven = g.aven.to_hex();
    let op = json!({ "op": "create", "vault": aven, "type": "bundle", "value": bundle, "as": aven });
    let made = ok(run(&mut g.w, g.mac, op))["entry"].clone();
    let got = ok(run(&mut g.w, g.mac, json!({ "op": "get", "entry": made })))["record"].clone();
    assert_eq!(got["proposals"], json!(proposals), "the bundle links the four proposals");
}

/// The cases that accept nothing: a decline, and a request to revise, after which the aven writes again and Alice
/// accepts the new version; what the aven writes after her accept needs her accept again; only her vault reviews; and
/// a merge on top of no accept, which a patched app makes all the same, counts for no reader, so main keeps its bytes.
#[test]
fn a_declined_or_revised_proposal_merges_nothing_until_the_vault_accepts() {
    let mut g = gate();
    let kind = "logic";
    let e = g.create(kind);
    g.sync(1);
    let line = g.propose(&e, change(kind));
    let before = g.stored(g.mac, &e, &Value::Null);
    let heads = ok(run(&mut g.w, g.mac, json!({ "op": "get", "entry": e, "line": line })))["heads"].clone();
    // only Alice's vault answers: her aven's review, or one of the main line, the engine refuses
    let as_aven = json!({ "op": "review", "entry": e, "line": line, "verdict": "accepted", "as": g.aven.to_hex() });
    assert_eq!(refused(&run(&mut g.w, g.mac, as_aven)), "NoCap");
    // she declines: the review names the version she declined, and accepts nothing
    let declined = g.review(&e, &line, "declined", "Not now");
    assert_eq!(declined["accept"], Value::Null);
    let record = ok(run(&mut g.w, g.mac, json!({ "op": "get", "entry": declined["review"] })))["record"].clone();
    let said = (&record["verdict"], &record["heads"], &record["text"]);
    assert_eq!(said, (&json!("declined"), &heads, &json!("Not now")));
    let merge = g.merge(&e, &line);
    assert_eq!(refused(&run(&mut g.w, g.mac, merge.clone())), "NotAccepted");
    // a patched app merges all the same: no reader counts it, and main keeps its bytes
    let patched = g.w.lab.patched(|lab| engine::run(lab, g.mac, &merge));
    let patched = ok(patched)["edit"].as_str().expect("its id").to_string();
    g.sync(2);
    for d in g.readers {
        let edits = g.edits(d, &e);
        let merged = edits.iter().find(|x| x.0 == patched).expect("the patched merge");
        assert_eq!((merged.1.as_str(), merged.2, &merged.3), ("merge", false, &json!("policy")));
        assert_eq!(g.stored(d, &e, &Value::Null), before, "main as Alice wrote it");
    }
    // she asks it to revise; the aven does, and she accepts the new version, which it merges
    let revise = g.review(&e, &line, "revise", "Keep the old height");
    assert_eq!(revise["accept"], Value::Null);
    let record = ok(run(&mut g.w, g.mac, json!({ "op": "get", "entry": revise["review"] })))["record"].clone();
    assert_eq!((&record["verdict"], &record["text"]), (&json!("revise"), &json!("Keep the old height")));
    g.sync(3);
    assert_eq!(refused(&run(&mut g.w, g.mac, merge.clone())), "NotAccepted");
    let height = json!({ "op": "set", "path": ["params", { "id": 1 }, "default"], "value": 0.6 });
    g.write(&e, &line, vec![height]);
    g.review(&e, &line, "accepted", "");
    // what the aven writes on the proposal after her accept, its merge can't bring in
    let later = json!({ "op": "set", "path": ["note"], "value": "Tuned after the accept." });
    g.write(&e, &line, vec![later]);
    assert_eq!(refused(&run(&mut g.w, g.mac, merge.clone())), "NotAccepted");
    g.review(&e, &line, "accepted", "And the note");
    let wanted = g.stored(g.mac, &e, &line);
    ok(run(&mut g.w, g.mac, merge));
    g.sync(4);
    for d in g.readers {
        assert_eq!(g.stored(d, &e, &Value::Null), wanted, "main reads back the version she accepted last");
        let main = g.main(d, &e, kind);
        assert_eq!((&main["params"][0]["default"], &main["note"]), (&json!(0.6), &json!("Tuned after the accept.")));
        let counted: Vec<bool> = g.edits(d, &e).iter().filter(|x| x.0 != patched).map(|x| x.2).collect();
        assert!(counted.iter().all(|c| *c), "every write but the patched merge counts");
    }
}
