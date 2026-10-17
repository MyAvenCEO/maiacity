//! The gate of A1, AIPs for every vault (`docs/ARCHITECTURE.md` §8, "AIPs"; the AIP plan's milestone A1): a vault
//! holds an AIP whose diff is derived from its lines, never typed. Everything goes through the ops engine
//! (`engine::run`), as the page and an aven send ops: Alice's aven, an Editor of her notes, logic and AIPs, proposes
//! changes to entries of two types, opens one AIP over both lines and promotes it to AIP-1; `aip` derives what each
//! line changes from its entry's schema; only Alice's vault reviews it, and its acceptance applies both lines in one
//! review, on her Mac, her phone and Bob's Mac alike, Bob a Viewer. A decline and a withdrawal archive an AIP as
//! rejected and merge nothing; a revision sends it back to idea with its number; two devices apart that promote at
//! once give one number twice, and every reader labels the two alike; a proposal no AIP names shows as a bare idea.

use avendb::cast::{self, World};
use avendb::engine;
use avendb::id::{SignerId, VaultId};
use avendb::policy::{Action, Kind, Level, Principal};
use avendb::slice::{Atom, Selector};
use serde_json::{Value, json};

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

/// A logic entry, a game's rules: its title and note, its source, its engine and manifest, a param and a contract.
fn logic() -> Value {
    json!({
        "kind": "logic", "title": "Valley rules", "note": "The valley's rules.", "tags": ["code"],
        "source": "// the rules\nexport default (x) => x;",
        "engine": { "host": "logic", "version": 4, "hash": "ab".repeat(32) },
        "manifest": { "hooks": ["tick"], "ops": ["set"] },
        "params": [{ "id": 1, "name": "height", "kind": "number", "range": { "min": 0.2, "max": 2, "step": 0.1 },
            "default": 0.6 }],
        "contract": { "budgets": { "bytes": 200000, "ms": 2000 }, "invariants": ["replay-equal"] },
    })
}

/// A note: a Markdown document, its title and one paragraph.
fn note() -> Value {
    let block = json!({ "id": 1, "type": "paragraph", "text": "Plant in May." });
    json!({ "kind": "document", "title": "Corn", "blocks": [block] })
}

fn set(path: Value, value: Value) -> Value {
    json!({ "op": "set", "path": path, "value": value })
}

/// Alice's world with her aven, avenALICE, which her vault owns: an Editor of her notes, logic and AIPs; Bob a Viewer
/// of those and of her reviews. Her Mac acts for both her vault and her aven; her phone and Bob's Mac read.
struct Gate {
    w: World,
    alice: VaultId,
    aven: VaultId,
    mac: SignerId,
    phone: SignerId,
    readers: [SignerId; 3],
}

fn gate() -> Gate {
    let mut w = cast::world();
    let (alice, bob, mac, passkey) = (w.alice, w.bob, w.mac_a, w.passkey_a);
    let owners = vec![Principal::Vault(alice)];
    let genesis = Action::Genesis { kind: Kind::Aven, owners, threshold: 1, root: None, nonce: 5, seal_to: vec![] };
    let aven = VaultId::from(w.lab.submit(mac, &[passkey], genesis).expect("avenALICE"));
    let types = |ts: &[&str]| Selector::AnyOf(vec![vec![Atom::TypeIn(ts.iter().map(|&t| t.into()).collect())]]);
    let editor = cast::share(alice, cast::vault(aven), Level::Write, types(&["note", "logic", "aip"]));
    w.lab.issue(mac, &[mac], editor).expect("an editor");
    let viewer = cast::share(alice, cast::vault(bob), Level::Read, types(&["note", "logic", "aip", "review"]));
    w.lab.issue(mac, &[mac], viewer).expect("a viewer");
    w.lab.sync_all(0);
    let phone = w.phone_a;
    let readers = [mac, phone, w.mac_b];
    Gate { w, alice, aven, mac, phone, readers }
}

impl Gate {
    /// Alice writes an entry of type `ty` holding `value` in her vault.
    fn create(&mut self, ty: &str, value: Value) -> String {
        let op = json!({ "op": "create", "vault": self.alice.to_hex(), "type": ty, "value": value });
        ok(run(&mut self.w, self.mac, op))["entry"].as_str().expect("its id").to_string()
    }

    /// Her aven proposes `ops` on entry `e`, a proposal named `name`: its line.
    fn propose(&mut self, e: &str, name: &str, ops: Vec<Value>) -> String {
        let start = json!({ "op": "propose", "entry": e, "name": name, "as": self.aven.to_hex() });
        let line = ok(run(&mut self.w, self.mac, start))["line"].as_str().expect("its line").to_string();
        self.write(e, &line, ops);
        line
    }

    /// Her aven writes `ops` on line `line` of entry `e`, in one write.
    fn write(&mut self, e: &str, line: &str, ops: Vec<Value>) {
        let on = |mut op: Value| {
            op["entry"] = json!(e);
            op["line"] = json!(line);
            op
        };
        let ops: Vec<Value> = ops.into_iter().map(on).collect();
        ok(run(&mut self.w, self.mac, json!({ "op": "batch", "as": self.aven.to_hex(), "ops": ops })));
    }

    /// Her aven opens an AIP titled `title` over the lines `lines` of her vault, on her Mac: its entry and its key.
    fn open(&mut self, title: &str, lines: &[(&str, &str)]) -> (String, String) {
        let proposals: Vec<Value> = lines.iter().map(|(e, l)| json!({ "entry": e, "line": l })).collect();
        let op = json!({ "op": "aip_open", "vault": self.alice.to_hex(), "title": title, "proposals": proposals,
            "note": "Why: the corn grows earlier.\n\nWhat changes: the dates.", "tags": ["game:sandbox-7"],
            "as": self.aven.to_hex() });
        let made = ok(run(&mut self.w, self.mac, op));
        (made["entry"].as_str().expect("its entry").into(), made["key"].as_str().expect("its key").into())
    }

    /// AIP `aip` promoted by device `d` acting for `as`: its number.
    fn promote(&mut self, d: SignerId, aip: &str, by: VaultId) -> u64 {
        let op = json!({ "op": "aip_promote", "entry": aip, "as": by.to_hex() });
        ok(run(&mut self.w, d, op))["number"].as_u64().expect("its number")
    }

    /// Alice's vault's review of AIP `aip`: its answer.
    fn review(&mut self, aip: &str, verdict: &str, text: &str) -> Value {
        let op =
            json!({ "op": "aip_review", "entry": aip, "verdict": verdict, "text": text, "as": self.alice.to_hex() });
        ok(run(&mut self.w, self.mac, op))
    }

    /// AIP `aip` as device `d` reads it, with each line's diff.
    fn aip(&mut self, d: SignerId, aip: &str) -> Value {
        ok(run(&mut self.w, d, json!({ "op": "aip", "entry": aip })))
    }

    /// Every AIP device `d` reads, and every bare proposal.
    fn aips(&mut self, d: SignerId) -> Vec<Value> {
        list(&ok(run(&mut self.w, d, json!({ "op": "aips" })))).to_vec()
    }

    /// The record line `line` of entry `e` stores (`null`: main), as device `d` reads it, in its bytes.
    fn stored(&mut self, d: SignerId, e: &str, line: &Value) -> Vec<u8> {
        let got = ok(run(&mut self.w, d, json!({ "op": "get", "entry": e, "line": line, "schema": "stored" })));
        serde_json::to_vec(&got["record"]).expect("its bytes")
    }

    /// Whether device `d` counts every write of entry `e`, and how many it holds.
    fn counted(&mut self, d: SignerId, e: &str) -> (bool, usize) {
        let history = ok(run(&mut self.w, d, json!({ "op": "history", "entry": e })));
        let edits = list(&history["edits"]);
        (edits.iter().all(|x| x["counted"] == true), edits.len())
    }

    fn sync(&mut self, seed: u64) {
        self.w.lab.sync_all(seed);
    }
}

/// The part of a diff labelled `label`.
fn part<'a>(diff: &'a Value, label: &str) -> &'a Value {
    list(diff).iter().find(|p| p["label"] == label).unwrap_or_else(|| panic!("no part {label:?} in {diff}"))
}

/// A1's gate: the aven's changes to a note and a logic entry, two proposals no AIP names yet and so bare ideas, become
/// one AIP, AIP-1, and a second gets AIP-2; `aip` labels each change of both with old and new and sums each part up
/// in a line; the aven can't review it, nor merge a line before the vault's review; Alice's accepted review applies
/// both lines in one go, and on every reader the AIP reads archived and applied, main holds each proposal's record
/// byte for byte, and every write counts.
#[test]
fn one_aip_over_two_types_derives_its_diff_and_one_review_applies_every_line() {
    let mut g = gate();
    let n = g.create("note", note());
    let l = g.create("logic", logic());
    g.sync(1);
    let text = "Plant in April.\n\nWater it weekly.";
    let on_note = g.propose(
        &n,
        "Earlier",
        vec![set(json!(["title"]), json!("Corn first")), set(json!(["blocks", { "id": 1 }, "text"]), json!(text))],
    );
    let mut engine = logic()["engine"].clone();
    engine["version"] = json!(5);
    let on_logic = g.propose(
        &l,
        "Taller",
        vec![set(json!(["params", { "id": 1 }, "default"]), json!(0.8)), set(json!(["engine"]), engine)],
    );
    // before any AIP names them, the two proposals are ideas of their own, by their names
    let bare: Vec<Value> = g.aips(g.mac).into_iter().filter(|a| a["bare"] == true).collect();
    let titles: Vec<&str> = bare.iter().filter_map(|a| a["title"].as_str()).collect();
    assert_eq!(titles.len(), 2, "{bare:?}");
    assert!(titles.contains(&"Earlier") && titles.contains(&"Taller"));
    assert!(bare.iter().all(|a| a["stage"] == "idea" && a["entry"].is_null() && list(&a["lines"]).len() == 1));
    // one AIP over both, an idea with a random key and no number
    let (aip, key) = g.open("Earlier, taller corn", &[(&n, &on_note), (&l, &on_logic)]);
    assert!(key.len() == 8 && key.chars().all(|c| c.is_ascii_alphanumeric()), "{key}");
    let all = g.aips(g.mac);
    assert!(all.iter().all(|a| a["bare"] == false), "no line is bare once an AIP names it: {all:?}");
    let idea = &all[0];
    assert_eq!(
        (&idea["stage"], &idea["label"], &idea["number"], &idea["key"]),
        (&json!("idea"), &Value::Null, &Value::Null, &json!(key))
    );
    assert_eq!((&idea["tags"], &idea["author"]), (&json!(["game:sandbox-7"]), &json!(g.aven.to_hex())));
    // promoted, it is AIP-1, and a second AIP is AIP-2
    assert_eq!(g.promote(g.mac, &aip, g.aven), 1);
    let on_logic_too = g.propose(&l, "Noted", vec![set(json!(["note"]), json!("The valley's rules, noted."))]);
    let (second, _) = g.open("A note on the rules", &[(&l, &on_logic_too)]);
    assert_eq!(g.promote(g.mac, &second, g.aven), 2);
    // what it changes, derived from each entry's schema, labelled, old and new
    let read = g.aip(g.mac, &aip);
    assert_eq!((&read["label"], &read["stage"], &read["outcome"]), (&json!("AIP-1"), &json!("proposed"), &Value::Null));
    let lines = list(&read["lines"]);
    assert_eq!(lines.len(), 2);
    assert_eq!((&lines[0]["type"], &lines[1]["type"]), (&json!("note"), &json!("logic")));
    let title = part(&lines[0]["diff"], "Title");
    assert_eq!((&title["kind"], &title["old"], &title["new"]), (&json!("set"), &json!("Corn"), &json!("Corn first")));
    let words = part(&lines[0]["diff"], "Blocks › #1 › Text");
    assert_eq!((&words["kind"], &words["old"], &words["new"]), (&json!("text"), &json!("Plant in May."), &json!(text)));
    let height = part(&lines[1]["diff"], "Params › height › Default");
    assert_eq!((&height["kind"], &height["old"], &height["new"]), (&json!("set"), &json!(0.6), &json!(0.8)));
    assert_eq!(height["path"], json!(["params", { "id": 1 }, "default"]));
    let version = part(&lines[1]["diff"], "Engine › Version");
    assert_eq!((&version["old"], &version["new"]), (&json!(4), &json!(5)));
    let summary: Vec<&str> = list(&read["summary"]).iter().filter_map(Value::as_str).collect();
    assert_eq!(
        summary,
        ["Markdown document: Title: Corn → Corn first (+1 more)", "Logic: Engine › Version: 4 → 5 (+1 more)"]
    );
    assert_eq!(read["signatures"], json!({ "have": 0, "need": 1, "of": "owners" }));
    // the aven reviews nothing, and merges no line before the vault's review
    let as_aven = json!({ "op": "aip_review", "entry": aip, "verdict": "accepted", "as": g.aven.to_hex() });
    assert_eq!(refused(&run(&mut g.w, g.mac, as_aven)), "NoCap");
    let merge = json!({ "op": "merge", "entry": n, "from": on_note, "as": g.aven.to_hex() });
    assert_eq!(refused(&run(&mut g.w, g.mac, merge)), "NotAccepted");
    // the page asks first: her vault may, by a dry run that makes nothing
    let ask = json!({ "op": "aip_review", "entry": aip, "verdict": "accepted" });
    let may = ok(run(&mut g.w, g.mac, json!({ "op": "may", "ops": [ask], "as": g.alice.to_hex() })));
    assert_eq!(may, json!([true]));
    assert_eq!(g.aip(g.mac, &aip)["stage"], "proposed", "the dry run made nothing");
    // Alice accepts it: both lines applied in one review
    let wanted = [g.stored(g.mac, &n, &json!(on_note)), g.stored(g.mac, &l, &json!(on_logic))];
    let writes = [g.counted(g.mac, &n).1, g.counted(g.mac, &l).1];
    let accepted = g.review(&aip, "accepted", "Ship it");
    let (accepts, merges) = (list(&accepted["accepts"]), list(&accepted["merges"]));
    assert_eq!((accepts.len(), merges.len()), (2, 2), "an accept and a merge per line");
    let review = ok(run(&mut g.w, g.mac, json!({ "op": "get", "entry": accepted["review"] })))["record"].clone();
    let mut heads: Vec<Value> = accepts.to_vec();
    heads.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
    let want = json!({ "kind": "review", "entry": aip, "line": "", "heads": heads, "by": g.aven.to_hex(),
        "verdict": "accepted", "text": "Ship it", "at": 0 });
    assert_eq!(review, want, "one review over every line, naming every accept");
    g.sync(2);
    for d in g.readers {
        let read = g.aip(d, &aip);
        let said = (&read["stage"], &read["outcome"], &read["label"]);
        assert_eq!(said, (&json!("archived"), &json!("applied"), &json!("AIP-1")), "on {d:?}");
        assert!(list(&read["lines"]).iter().all(|l| l["merged"] == true));
        assert_eq!(read["signatures"]["have"], 1, "her review covers every line's heads");
        assert_eq!(
            (&read["reviews"][0]["verdict"], &read["reviews"][0]["current"]),
            (&json!("accepted"), &json!(true))
        );
        assert_eq!(g.stored(d, &n, &Value::Null), wanted[0], "the note's main holds the proposal, byte for byte");
        assert_eq!(g.stored(d, &l, &Value::Null), wanted[1], "the logic's main holds the proposal, byte for byte");
        for (e, before) in [(&n, writes[0]), (&l, writes[1])] {
            let (all, now) = g.counted(d, e);
            assert!(all, "every write of {e} counts on {d:?}");
            assert_eq!(now, before + 2, "an accept and a merge more");
        }
        let all = g.aips(d);
        let other = all.iter().find(|a| a["entry"] == second.as_str()).expect("AIP-2");
        assert_eq!((&other["label"], &other["stage"]), (&json!("AIP-2"), &json!("proposed")), "on {d:?}");
    }
}

/// A declined AIP is archived and rejected, and merges nothing; it is promoted and reviewed no more. A withdrawn one
/// is archived and rejected with its reason; nobody but its author or its vault withdraws it.
#[test]
fn declined_or_withdrawn_aips_are_rejected_and_merge_nothing() {
    let mut g = gate();
    let n = g.create("note", note());
    let l = g.create("logic", logic());
    g.sync(1);
    let line = g.propose(&n, "Earlier", vec![set(json!(["title"]), json!("Corn first"))]);
    // one vault per AIP: a line of an entry of her aven's vault is no line of an AIP of hers
    let aven = g.aven.to_hex();
    let elsewhere = json!({ "op": "create", "vault": aven, "type": "note", "value": note(), "as": aven });
    let elsewhere = ok(run(&mut g.w, g.mac, elsewhere))["entry"].as_str().expect("its id").to_string();
    let away = g.propose(&elsewhere, "Away", vec![set(json!(["title"]), json!("Away"))]);
    let op = json!({ "op": "aip_open", "vault": g.alice.to_hex(), "title": "Both", "as": aven,
        "proposals": [{ "entry": n, "line": line }, { "entry": elsewhere, "line": away }] });
    assert_eq!(refused(&run(&mut g.w, g.mac, op)), "BadOp");
    let (declined, _) = g.open("Earlier corn", &[(&n, &line)]);
    assert_eq!(g.promote(g.mac, &declined, g.aven), 1);
    let before = g.stored(g.mac, &n, &Value::Null);
    let heads = ok(run(&mut g.w, g.mac, json!({ "op": "get", "entry": n, "line": line })))["heads"].clone();
    let answer = g.review(&declined, "declined", "Not now");
    assert_eq!((list(&answer["accepts"]).len(), list(&answer["merges"]).len()), (0, 0));
    let record = ok(run(&mut g.w, g.mac, json!({ "op": "get", "entry": answer["review"] })))["record"].clone();
    assert_eq!((&record["verdict"], &record["heads"]), (&json!("declined"), &heads), "the version it declined");
    let again = json!({ "op": "aip_promote", "entry": declined, "as": g.aven.to_hex() });
    assert_eq!(refused(&run(&mut g.w, g.mac, again)), "BadOp", "an archived AIP is promoted no more");
    let review = json!({ "op": "aip_review", "entry": declined, "verdict": "accepted", "as": g.alice.to_hex() });
    assert_eq!(refused(&run(&mut g.w, g.mac, review)), "BadOp", "nor reviewed");
    // withdrawn by its author, with why
    let other = g.propose(&l, "Taller", vec![set(json!(["params", { "id": 1 }, "default"]), json!(0.8))]);
    let (withdrawn, _) = g.open("Taller corn", &[(&l, &other)]);
    assert_eq!(g.promote(g.mac, &withdrawn, g.aven), 2);
    g.sync(2);
    let by_bob = json!({ "op": "aip_withdraw", "entry": withdrawn, "why": "Mine now" });
    assert_eq!(refused(&run(&mut g.w, g.readers[2], by_bob)), "NoCap", "Bob is neither its author nor its vault");
    let op = json!({ "op": "aip_withdraw", "entry": withdrawn, "why": "Superseded", "as": g.aven.to_hex() });
    ok(run(&mut g.w, g.mac, op));
    g.sync(3);
    for d in g.readers {
        let read = g.aip(d, &declined);
        assert_eq!((&read["stage"], &read["outcome"]), (&json!("archived"), &json!("rejected")), "on {d:?}");
        assert_eq!(read["reviews"][0]["verdict"], "declined");
        assert!(list(&read["lines"]).iter().all(|l| l["merged"] == false), "nothing merged");
        assert_eq!(g.stored(d, &n, &Value::Null), before, "main as Alice wrote it");
        let read = g.aip(d, &withdrawn);
        let said = (&read["stage"], &read["outcome"], &read["why"], &read["label"]);
        assert_eq!(said, (&json!("archived"), &json!("rejected"), &json!("Superseded"), &json!("AIP-2")));
        assert_eq!(read["lines"][0]["merged"], false);
    }
}

/// Revise sends the AIP back to idea, keeping its number; the aven writes again on its line and promotes it, AIP-1
/// still; Alice accepts the new version, which main then holds.
#[test]
fn a_revised_aip_keeps_its_number_and_is_accepted_once_written_again() {
    let mut g = gate();
    let l = g.create("logic", logic());
    g.sync(1);
    let height = |v: f64| set(json!(["params", { "id": 1 }, "default"]), json!(v));
    let line = g.propose(&l, "Taller", vec![height(1.4)]);
    let (aip, _) = g.open("Taller corn", &[(&l, &line)]);
    assert_eq!(g.promote(g.mac, &aip, g.aven), 1);
    let revised = g.review(&aip, "revise", "Not so tall");
    assert_eq!(list(&revised["accepts"]).len(), 0);
    let read = g.aip(g.mac, &aip);
    let said = (&read["stage"], &read["number"], &read["label"], &read["outcome"]);
    assert_eq!(said, (&json!("idea"), &json!(1), &Value::Null, &Value::Null), "an idea again, with its number");
    assert_eq!(
        (&read["reviews"][0]["verdict"], &read["reviews"][0]["text"]),
        (&json!("revise"), &json!("Not so tall"))
    );
    let review = json!({ "op": "aip_review", "entry": aip, "verdict": "accepted", "as": g.alice.to_hex() });
    assert_eq!(refused(&run(&mut g.w, g.mac, review)), "BadOp", "an idea is not reviewed");
    // the aven writes again, and promotes it: the same number
    g.write(&l, &line, vec![height(0.9)]);
    assert_eq!(g.promote(g.mac, &aip, g.aven), 1);
    let read = g.aip(g.mac, &aip);
    assert_eq!((&read["stage"], &read["label"]), (&json!("proposed"), &json!("AIP-1")));
    assert_eq!(read["reviews"][0]["current"], false, "the revision answered an older version");
    let height = part(&read["lines"][0]["diff"], "Params › height › Default");
    assert_eq!((&height["old"], &height["new"]), (&json!(0.6), &json!(0.9)));
    let wanted = g.stored(g.mac, &l, &json!(line));
    g.review(&aip, "accepted", "");
    g.sync(2);
    for d in g.readers {
        let read = g.aip(d, &aip);
        let said = (&read["stage"], &read["outcome"], &read["label"]);
        assert_eq!(said, (&json!("archived"), &json!("applied"), &json!("AIP-1")), "on {d:?}");
        assert_eq!(list(&read["reviews"]).len(), 2);
        assert_eq!(g.stored(d, &l, &Value::Null), wanted, "main holds the version she accepted");
        assert!(g.counted(d, &l).0);
    }
}

/// Alice's Mac and her phone each promote an AIP while apart: both take number 1. Once they sync, every reader labels
/// them alike, `AIP-1` the one whose number-setting write comes first in the one order, `AIP-1.2` the other; the next
/// AIP promoted is AIP-2.
#[test]
fn two_devices_apart_give_one_number_twice_and_every_reader_labels_them_alike() {
    let mut g = gate();
    let l = g.create("logic", logic());
    g.sync(1);
    let first = g.propose(&l, "Taller", vec![set(json!(["params", { "id": 1 }, "default"]), json!(0.8))]);
    let second = g.propose(&l, "Noted", vec![set(json!(["note"]), json!("Noted."))]);
    let (a, _) = g.open("Taller corn", &[(&l, &first)]);
    let (b, _) = g.open("A note on the rules", &[(&l, &second)]);
    g.sync(2);
    let (mac, phone, aven, alice) = (g.mac, g.phone, g.aven, g.alice);
    g.w.lab.set_online(phone, false);
    assert_eq!(g.promote(mac, &a, aven), 1, "the Mac's");
    assert_eq!(g.promote(phone, &b, alice), 1, "the phone's: it holds no number yet");
    g.w.lab.set_online(phone, true);
    g.sync(3);
    let labels = |g: &mut Gate, d| {
        let all = g.aips(d);
        let of = |e: &str| all.iter().find(|x| x["entry"] == e).map(|x| (x["number"].clone(), x["label"].clone()));
        (of(&a).expect("a"), of(&b).expect("b"))
    };
    let seen = labels(&mut g, mac);
    assert_eq!((&seen.0.0, &seen.1.0), (&json!(1), &json!(1)), "both hold number 1");
    let mut both = [seen.0.1.as_str().unwrap_or_default(), seen.1.1.as_str().unwrap_or_default()];
    both.sort();
    assert_eq!(both, ["AIP-1", "AIP-1.2"]);
    for d in g.readers {
        assert_eq!(labels(&mut g, d), seen, "the same labels on {d:?}");
    }
    let third = g.propose(&l, "Wider", vec![set(json!(["title"]), json!("Wider rules"))]);
    let (c, _) = g.open("Wider rules", &[(&l, &third)]);
    assert_eq!(g.promote(mac, &c, aven), 2);
}

/// An agent its person makes a Suggester of all her vaults, as the page grants it (`$lib/avendb/vaults.js`
/// `standingOps`, and `aipAuthorOps` beside it): her vault gives her aven a standing Suggester, and the aven passes it
/// on to agentClaude's device vault; a Suggester alone opens no AIP, which is an entry of its own. Then her vault gives
/// the aven a share of its own, "AIP author", `create` and `set` on her AIPs alone, and the aven passes that on too,
/// resting on it rather than on the standing Suggester the aven holds beside it, which would add nothing
/// (`world::parent_giving`). On its own device agentClaude opens an AIP over its proposal line and promotes it, AIP-1;
/// it changes no note beyond its proposal, nor reviews its AIP; her vault accepts it, and main holds the proposal on
/// every device. agentCodex, a Viewer, opens none.
#[test]
fn a_suggester_agent_given_an_aip_author_share_opens_aips_and_a_viewer_opens_none() {
    let mut w = cast::world();
    let (alice, mac, passkey) = (w.alice, w.mac_a, w.passkey_a);
    let found = |w: &mut World, kind: Kind, owner: VaultId, nonce: u64| {
        let owners = vec![Principal::Vault(owner)];
        let genesis = Action::Genesis { kind, owners, threshold: 1, root: None, nonce, seal_to: vec![] };
        VaultId::from(w.lab.submit(mac, &[passkey], genesis).expect("her passkey founds it"))
    };
    let aven = found(&mut w, Kind::Aven, alice, 5);
    let agent = |w: &mut World, name: &str, nonce: u64| {
        let vault = found(w, Kind::DeviceVault, aven, nonce);
        let device = w.lab.device(name);
        let add = Action::Share(avendb::policy::Sharing::Device { vault, device, seal_to: None });
        w.lab.submit(mac, &[passkey, device], add).expect("its device");
        (vault, device)
    };
    let (claudes, claude) = agent(&mut w, "agentClaude", 6);
    let (codexes, codex) = agent(&mut w, "agentCodex", 7);
    let (a, v, c, x) = (alice.to_hex(), aven.to_hex(), claudes.to_hex(), codexes.to_hex());
    let share = |w: &mut World, op: Value| ok(run(w, mac, op))["share"].as_str().expect("a share").to_string();
    share(&mut w, json!({ "op": "share", "over": a, "who": { "vault": v }, "level": "Suggester", "standing": true,
        "as": a }));
    share(&mut w, json!({ "op": "share", "over": a, "who": { "vault": c }, "level": "Suggester", "standing": true,
        "as": v }));
    share(&mut w, json!({ "op": "share", "over": a, "who": { "vault": x }, "level": "Viewer", "as": v }));
    let n = json!({ "op": "create", "vault": a, "type": "note", "value": note() });
    let n = ok(run(&mut w, mac, n))["entry"].clone();
    w.lab.sync_all(1);
    // agentClaude proposes, on its own device, as its device vault; a Suggester alone opens no AIP over its line
    let line = json!({ "op": "propose", "entry": n, "name": "Earlier", "as": c });
    let line = ok(run(&mut w, claude, line))["line"].clone();
    let title = json!({ "op": "set", "entry": n, "line": line, "path": ["title"], "value": "Corn first" });
    ok(run(&mut w, claude, json!({ "op": "batch", "as": c, "ops": [title] })));
    let open = json!({ "op": "aip_open", "vault": a, "title": "Earlier corn", "note": "Why: it grows earlier.",
        "proposals": [{ "entry": n, "line": line }], "tags": ["game:sandbox-7"], "as": c });
    refused(&run(&mut w, claude, open.clone()));
    // the AIP author's shares, as the page writes them: her vault's to the aven, then the aven's to its agent
    let author = json!({ "name": "AIP author", "ops": [{ "op": "create" }, { "op": "set", "path": [] }] });
    let aips = json!({ "type": ["aip"] });
    let given = share(&mut w, json!({ "op": "share", "over": a, "who": { "vault": v }, "level": author, "what": aips,
        "as": a }));
    let passed = share(&mut w, json!({ "op": "share", "over": a, "who": { "vault": c }, "level": author,
        "what": aips, "as": v }));
    let rests = w.lab.state(mac).share(avendb::id::ShareId::from_hex(&passed).expect("its id")).map(|s| s.share.parent);
    assert_eq!(
        rests.flatten().map(|p| p.to_hex()),
        Some(given),
        "the agent's rests on the aven's AIP author share, not on its standing Suggester"
    );
    w.lab.sync_all(2);
    let aip = ok(run(&mut w, claude, open))["entry"].clone();
    let promoted = ok(run(&mut w, claude, json!({ "op": "aip_promote", "entry": aip, "as": c })));
    assert_eq!(promoted["number"], 1);
    // it may change its AIP, but no note on main, and reviews nothing
    let main = json!({ "op": "set", "entry": n, "path": ["title"], "value": "Mine", "as": c });
    refused(&run(&mut w, claude, main));
    let review = json!({ "op": "aip_review", "entry": aip, "verdict": "accepted", "as": c });
    assert_eq!(refused(&run(&mut w, claude, review)), "NoCap");
    // agentCodex, a Viewer, opens none
    w.lab.sync_all(3);
    let by_codex = json!({ "op": "aip_open", "vault": a, "title": "Mine", "proposals": [{ "entry": n, "line": line }],
        "as": x });
    refused(&run(&mut w, codex, by_codex));
    // her vault accepts it: main holds the proposal on every device
    let review = json!({ "op": "aip_review", "entry": aip, "verdict": "accepted", "text": "Yes", "as": a });
    ok(run(&mut w, mac, review));
    w.lab.sync_all(4);
    for d in [mac, w.phone_a, claude] {
        let read = ok(run(&mut w, d, json!({ "op": "aip", "entry": aip })));
        let said = (&read["stage"], &read["outcome"], &read["label"], &read["author"]);
        assert_eq!(said, (&json!("archived"), &json!("applied"), &json!("AIP-1"), &json!(c)), "on {d:?}");
        let record = ok(run(&mut w, d, json!({ "op": "get", "entry": n })))["record"].clone();
        assert_eq!(record["title"], "Corn first", "on {d:?}");
    }
}
