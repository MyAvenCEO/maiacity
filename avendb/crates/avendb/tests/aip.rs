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

/// What every AIP here must deliver: the corn ripe by day 120.
const OBJECTIVE: &str = "import AvenDB.Objective\nopen AvenDB.Objective\n\n/-- Ripe by day 120. -/\n\
    def ripe : Metric := metric \"Day the corn is ripe\" (atMost (reading \"ripe_day\") 120)\n";

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

/// Alice's world with her aven, avenALICE, which a coop of hers owns, her vault its one owner: an Editor of her notes,
/// logic and AIPs; Bob a Viewer of those and of her reviews. Her Mac acts for both her vault and her aven, the aven
/// through the coop and her vault; her phone and Bob's Mac read.
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
    let found = |w: &mut World, kind: Kind, owner: VaultId| {
        let owners = vec![Principal::Vault(owner)];
        let genesis = Action::Genesis { kind, owners, threshold: 1, root: None, nonce: 5, seal_to: vec![] };
        VaultId::from(w.lab.submit(mac, &[passkey], genesis).expect("her passkey founds it"))
    };
    let coop = found(&mut w, Kind::Coop, alice);
    let aven = found(&mut w, Kind::Aven, coop);
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
            "objective": OBJECTIVE, "as": self.aven.to_hex() });
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
        (&json!("objective"), &Value::Null, &Value::Null, &json!(key))
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
        // the review names its aven as who started the AIP, and Alice, whose Mac signed it, as who answered it
        let answered: Vec<&Value> = list(&read["reviews"][0]["authors"]).iter().map(|a| &a["vault"]).collect();
        assert_eq!((&read["reviews"][0]["by"], answered), (&json!(g.aven.to_hex()), vec![&json!(g.alice.to_hex())]));
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
    let again = (&json!("objective"), &json!(1), &Value::Null, &Value::Null);
    assert_eq!(said, again, "an idea again, with its number and its objective");
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
/// `standingOps`, and `aipAuthorOps` beside it): her vault gives agentClaude's device vault, which it owns, a standing
/// Suggester; a Suggester alone opens no AIP, which is an entry of its own. Then her vault gives it a share of its own,
/// "AIP author", `create` and `set` on her AIPs alone. On its own device agentClaude opens an AIP over its proposal
/// line and promotes it, AIP-1; it changes no note beyond its proposal, nor reviews its AIP; her vault accepts it, and
/// main holds the proposal on every device. agentCodex, a Viewer, opens none.
#[test]
fn a_suggester_agent_given_an_aip_author_share_opens_aips_and_a_viewer_opens_none() {
    let mut w = cast::world();
    let (alice, mac, passkey) = (w.alice, w.mac_a, w.passkey_a);
    let agent = |w: &mut World, name: &str, nonce: u64| {
        let owners = vec![Principal::Vault(alice)];
        let kind = Kind::DeviceVault;
        let genesis = Action::Genesis { kind, owners, threshold: 1, root: None, nonce, seal_to: vec![] };
        let vault = VaultId::from(w.lab.submit(mac, &[passkey], genesis).expect("her passkey founds it"));
        let device = w.lab.device(name);
        let add = Action::Share(avendb::policy::Sharing::Device { vault, device, seal_to: None });
        w.lab.submit(mac, &[passkey, device], add).expect("its device");
        (vault, device)
    };
    let (claudes, claude) = agent(&mut w, "agentClaude", 6);
    let (codexes, codex) = agent(&mut w, "agentCodex", 7);
    let (a, c, x) = (alice.to_hex(), claudes.to_hex(), codexes.to_hex());
    let share = |w: &mut World, op: Value| ok(run(w, mac, op))["share"].as_str().expect("a share").to_string();
    share(&mut w, json!({ "op": "share", "over": a, "who": { "vault": c }, "level": "Suggester", "standing": true,
        "as": a }));
    share(&mut w, json!({ "op": "share", "over": a, "who": { "vault": x }, "level": "Viewer", "as": a }));
    let n = json!({ "op": "create", "vault": a, "type": "note", "value": note() });
    let n = ok(run(&mut w, mac, n))["entry"].clone();
    w.lab.sync_all(1);
    // agentClaude proposes, on its own device, as its device vault; a Suggester alone opens no AIP over its line
    let line = json!({ "op": "propose", "entry": n, "name": "Earlier", "as": c });
    let line = ok(run(&mut w, claude, line))["line"].clone();
    let title = json!({ "op": "set", "entry": n, "line": line, "path": ["title"], "value": "Corn first" });
    ok(run(&mut w, claude, json!({ "op": "batch", "as": c, "ops": [title] })));
    let open = json!({ "op": "aip_open", "vault": a, "title": "Earlier corn", "note": "Why: it grows earlier.",
        "proposals": [{ "entry": n, "line": line }], "tags": ["game:sandbox-7"], "objective": OBJECTIVE, "as": c });
    refused(&run(&mut w, claude, open.clone()));
    // the AIP author's share, as the page writes it: her vault's to the agent
    let author = json!({ "name": "AIP author", "ops": [{ "op": "create" }, { "op": "set", "path": [] }] });
    let aips = json!({ "type": ["aip"] });
    share(&mut w, json!({ "op": "share", "over": a, "who": { "vault": c }, "level": author, "what": aips, "as": a }));
    w.lab.sync_all(2);
    let aip = ok(run(&mut w, claude, open))["entry"].clone();
    // it measures its own progress while it works: its AIP author's share lets it record readings
    for day in [140, 118] {
        let measure = json!({ "op": "aip_measure", "entry": aip, "name": "ripe_day", "value": day, "as": c });
        ok(run(&mut w, claude, measure));
    }
    let read = ok(run(&mut w, claude, json!({ "op": "aip", "entry": aip })));
    assert_eq!((&read["stage"], &read["objective"]["met"]), (&json!("objective"), &json!(1)));
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

/// The objective stage (`spec/AvenDB/Objective.lean`): an idea holds no objective and is promoted no more until it
/// does; a file that doesn't read is refused with where and why; one that reads makes the idea an objective, whose
/// metrics every `aip` read checks against the readings recorded on it, the first of each name its baseline; it is
/// fixed once proposed, while readings go on; an archived AIP records none; `objective_check` reads a file unsaved.
#[test]
fn an_aip_states_its_objective_in_lean_and_measures_its_progress() {
    let mut g = gate();
    let n = g.create("note", note());
    g.sync(1);
    let line = g.propose(&n, "Earlier", vec![set(json!(["title"]), json!("Corn first"))]);
    let aven = g.aven.to_hex();
    let op = json!({ "op": "aip_open", "vault": g.alice.to_hex(), "title": "Earlier corn", "as": aven,
        "proposals": [{ "entry": n, "line": line }] });
    let aip = ok(run(&mut g.w, g.mac, op))["entry"].as_str().expect("its entry").to_string();
    let read = g.aip(g.mac, &aip);
    assert_eq!((&read["stage"], &read["objective"]), (&json!("idea"), &Value::Null));
    let promote = json!({ "op": "aip_promote", "entry": aip, "as": aven });
    let why = run(&mut g.w, g.mac, promote.clone());
    assert!(why["why"].as_str().unwrap_or_default().contains("no objective"), "{why}");
    // a file that doesn't read: refused, with where
    let bad = json!({ "op": "aip_objective", "entry": aip, "as": aven,
        "lean": "def ripe : Metric := metric \"Ripe\" (atMost (reading \"ripe_day\") -3)" });
    let why = run(&mut g.w, g.mac, bad);
    assert!(why["why"].as_str().unwrap_or_default().contains("line 1"), "{why}");
    // two metrics, the second over two readings
    let lean = format!("{OBJECTIVE}\n/-- More cobs. -/\ndef cobs : Metric := metric \"Cobs a plant\" \
        (atLeast (reading \"cobs\" / reading \"plants\") 2.5)\n");
    let set = ok(run(&mut g.w, g.mac, json!({ "op": "aip_objective", "entry": aip, "lean": lean, "as": aven })));
    assert_eq!(set["metrics"], json!([{ "id": "ripe", "name": "Day the corn is ripe" }, { "id": "cobs", "name": "Cobs a plant" }]));
    let read = g.aip(g.mac, &aip);
    assert_eq!((&read["stage"], &read["objective"]["total"], &read["objective"]["met"]), (&json!("objective"), &json!(2), &json!(0)));
    assert_eq!(read["objective"]["metrics"][0]["note"], "Ripe by day 120.");
    for (name, value) in [("ripe_day", json!(140)), ("cobs", json!(150)), ("plants", json!(100)), ("ripe_day", json!(119.5)), ("cobs", json!(200))] {
        ok(run(&mut g.w, g.mac, json!({ "op": "aip_measure", "entry": aip, "name": name, "value": value, "as": aven })));
    }
    let o = g.aip(g.mac, &aip)["objective"].clone();
    assert_eq!((&o["metrics"][0]["met"], &o["metrics"][0]["value"], &o["metrics"][0]["baseline"]), (&json!(true), &json!(119.5), &json!(140)));
    // cobs a plant: 1.5 at first, 2 now, 2.5 wanted: half way
    assert_eq!((&o["metrics"][1]["met"], &o["metrics"][1]["progress"]), (&json!(false), &json!(0.5)));
    assert_eq!((&o["met"], &o["progress"]), (&json!(1), &json!(0.75)));
    assert_eq!(list(&o["readings"]).len(), 5);
    // every reader reads the same progress
    g.sync(2);
    assert_eq!(g.aip(g.readers[2], &aip)["objective"]["progress"], json!(0.75));
    // not a number: refused
    let nan = json!({ "op": "aip_measure", "entry": aip, "name": "cobs", "value": "many", "as": aven });
    assert_eq!(refused(&run(&mut g.w, g.mac, nan)), "BadOp");
    // proposed: the objective is fixed, the readings go on
    assert_eq!(ok(run(&mut g.w, g.mac, promote))["number"], 1);
    let change = json!({ "op": "aip_objective", "entry": aip, "lean": OBJECTIVE, "as": aven });
    assert_eq!(refused(&run(&mut g.w, g.mac, change)), "BadOp");
    ok(run(&mut g.w, g.mac, json!({ "op": "aip_measure", "entry": aip, "name": "cobs", "value": 250, "as": aven })));
    let o = g.aip(g.mac, &aip)["objective"].clone();
    assert_eq!((&o["met"], &o["progress"]), (&json!(2), &json!(1)));
    // archived: no more readings
    g.review(&aip, "accepted", "Yes");
    let late = json!({ "op": "aip_measure", "entry": aip, "name": "cobs", "value": 1, "as": aven });
    assert_eq!(refused(&run(&mut g.w, g.mac, late)), "BadOp");
    // an editor checks a file as it is typed
    let check = ok(run(&mut g.w, g.mac, json!({ "op": "objective_check", "lean": OBJECTIVE,
        "readings": [{ "name": "ripe_day", "value": 125 }] })));
    assert_eq!((&check["ok"], &check["metrics"][0]["value"]), (&json!(true), &json!(125)));
    let check = ok(run(&mut g.w, g.mac, json!({ "op": "objective_check", "lean": "def x : Metric := 1" })));
    assert_eq!((&check["ok"], &check["line"]), (&json!(false), &json!(1)));
}

/// N1 (`spec/AvenDB/Objectives/Lines.lean`): an objective reads the numbers the AIP's own lines propose, no reading
/// needed. `proposed "path"` is what the lines would put there, its baseline what main holds; `current "path"` what
/// main holds; a path picks the first line whose record holds it, or the line of the entry it names; a field main
/// doesn't hold yet has no baseline; each write on a line moves the progress at once, on every reader; applied, the
/// AIP reads against the version it started from.
#[test]
fn an_objective_reads_the_numbers_its_lines_propose() {
    let mut g = gate();
    let a = g.create("logic", logic());
    let mut tall = logic();
    tall["params"][0]["default"] = json!(1.0);
    let b = g.create("logic", tall);
    g.sync(1);
    let mut engine = logic()["engine"].clone();
    engine["version"] = json!(5);
    let height = |v: f64| set(json!(["params", { "id": 1 }, "default"]), json!(v));
    let on_a = g.propose(&a, "Taller", vec![height(0.7), set(json!(["engine"]), engine)]);
    let water = json!({ "id": 2, "name": "water", "kind": "number", "range": { "min": 0, "max": 50, "step": 1 },
        "default": 15 });
    let insert = json!({ "op": "insert", "path": ["params"], "value": water });
    let on_b = g.propose(&b, "Taller still", vec![height(1.2), insert]);
    let aven = g.aven.to_hex();
    let lean = format!(
        "def height : Metric := metric \"Corn height, m\" (atLeast (proposed \"params.#1.default\") 0.8)\n\
         def step : Expr := proposed \"engine.version\" - current \"engine.version\"\n\
         def engine : Metric := metric \"Engine versions up\" (equals step 1)\n\
         def other : Metric := metric \"The other corn, m\" (atLeast (proposed \"{}/params.#1.default\") 1.4)\n\
         def water : Metric := metric \"Water a week, l\" (between (proposed \"params.#2.default\") 10 20)\n",
        &b[..8]
    );
    let op = json!({ "op": "aip_open", "vault": g.alice.to_hex(), "title": "Taller corn", "as": aven,
        "proposals": [{ "entry": a, "line": on_a }, { "entry": b, "line": on_b }], "objective": lean });
    let aip = ok(run(&mut g.w, g.mac, op))["entry"].as_str().expect("its entry").to_string();
    let o = g.aip(g.mac, &aip)["objective"].clone();
    let m = |o: &Value, i: usize| {
        let m = &o["metrics"][i];
        (m["value"].clone(), m["baseline"].clone(), m["met"].clone(), m["progress"].clone())
    };
    assert_eq!(m(&o, 0), (json!(0.7), json!(0.6), json!(false), json!(0.5)), "{o}");
    assert_eq!(m(&o, 1), (json!(1), json!(0), json!(true), json!(1)));
    assert_eq!(m(&o, 2), (json!(1.2), json!(1), json!(false), json!(0.5)));
    assert_eq!(m(&o, 3), (json!(15), Value::Null, json!(true), json!(1)));
    assert_eq!(o["metrics"][1]["paths"], json!(["engine.version"]));
    let fields = list(&o["fields"]);
    assert_eq!(fields.len(), 4);
    let first = json!({ "path": "params.#1.default", "entry": a, "line": on_a, "proposed": 0.7, "current": 0.6 });
    assert_eq!(fields[0], first);
    assert_eq!((&fields[2]["entry"], &fields[2]["proposed"]), (&json!(b), &json!(1.2)));
    assert_eq!((&fields[3]["line"], &fields[3]["current"]), (&json!(on_b), &Value::Null));
    // the records the paths read, which a Measurer's logic is given: main's and the proposal's, each line's
    let records = ok(run(&mut g.w, g.mac, json!({ "op": "aip_records", "entry": aip })));
    let lines = list(&records["lines"]);
    assert_eq!((lines.len(), &lines[0]["entry"], &lines[0]["line"]), (2, &json!(a), &json!(on_a)));
    assert_eq!(lines[0]["main"]["params"][0]["default"], json!(0.6));
    assert_eq!(lines[0]["proposed"]["params"][0]["default"], json!(0.7));
    let version = |side: &str| lines[0][side]["engine"]["version"].clone();
    assert_eq!((version("main"), version("proposed")), (json!(4), json!(5)));
    assert_eq!(list(&lines[1]["proposed"]["params"]).len(), 2);
    assert_eq!(lines[1]["type"], "logic");
    // a write on the line moves it at once, and every reader reads it alike
    g.write(&a, &on_a, vec![height(0.8)]);
    g.sync(2);
    for d in g.readers {
        let o = g.aip(d, &aip)["objective"].clone();
        assert_eq!(m(&o, 0), (json!(0.8), json!(0.6), json!(true), json!(1)), "on {d:?}");
        assert_eq!((&o["met"], &o["progress"]), (&json!(3), &json!(0.875)), "on {d:?}");
    }
    // applied: main holds the proposal now, and the objective reads against the version it started from
    assert_eq!(ok(run(&mut g.w, g.mac, json!({ "op": "aip_promote", "entry": aip, "as": aven })))["number"], 1);
    g.review(&aip, "accepted", "Yes");
    let read = g.aip(g.mac, &aip);
    assert_eq!(read["outcome"], "applied");
    assert_eq!(m(&read["objective"], 0), (json!(0.8), json!(0.6), json!(true), json!(1)));
    // an editor checks a file as it is typed, with the numbers it names
    let check = ok(run(&mut g.w, g.mac, json!({ "op": "objective_check", "lean": lean,
        "proposed": [{ "path": "params.#1.default", "value": 0.7 }],
        "current": [{ "path": "params.#1.default", "value": 0.6 }] })));
    assert_eq!((&check["ok"], &check["metrics"][0]["progress"]), (&json!(true), &json!(0.5)));
    let bad = json!({ "op": "aip_objective", "entry": aip, "as": aven,
        "lean": "def x : Metric := metric \"x\" (atLeast (proposed \"params..default\") 1)" });
    assert!(run(&mut g.w, g.mac, bad)["why"].as_str().unwrap_or_default().contains("empty field"));
}

/// N3 (`spec/AvenDB/Measurers.lean`, L1 to L3): real Lean's verdict on an AIP's objective is the newest reading a
/// Measurer wrote named for the objective's key: the aven's own "yes" counts for nothing, Alice's vault's counts on
/// every reader, its newest stands, and a new objective has none until it is checked again.
#[test]
fn lean_s_verdict_is_a_measurer_s_reading_on_the_objective_it_holds() {
    let mut g = gate();
    let n = g.create("note", note());
    g.sync(1);
    let line = g.propose(&n, "Earlier", vec![set(json!(["title"]), json!("Corn first"))]);
    let (aven, alice) = (g.aven.to_hex(), g.alice.to_hex());
    let lean = "def fps : Metric := metric \"Frames\" (atLeast (reading \"fps\") 50)\n";
    let op = json!({ "op": "aip_open", "vault": alice, "title": "Faster corn", "as": aven, "objective": lean,
        "proposals": [{ "entry": n, "line": line }] });
    let aip = ok(run(&mut g.w, g.mac, op))["entry"].as_str().expect("its entry").to_string();
    g.sync(2);
    let key = g.aip(g.mac, &aip)["objective"]["key"].as_str().expect("its key").to_string();
    assert_eq!(key, avendb::objective::key(lean));
    assert_eq!(g.aip(g.mac, &aip)["objective"]["verdict"], Value::Null, "unchecked");
    let say = |by: &str, v: u64, note: &str| json!({ "op": "aip_measure", "entry": aip,
        "name": format!("lean:{key}"), "value": v, "note": note, "as": by });
    ok(run(&mut g.w, g.mac, say(&aven, 1, "the author's own")));
    assert_eq!(g.aip(g.mac, &aip)["objective"]["verdict"], Value::Null, "the author's yes counts for nothing");
    ok(run(&mut g.w, g.mac, say(&alice, 0, "lean-4.35.0 abc: 1:1 nope")));
    ok(run(&mut g.w, g.mac, say(&alice, 1, "lean-4.35.0 abc")));
    g.sync(3);
    for d in g.readers {
        let v = g.aip(d, &aip)["objective"]["verdict"].clone();
        assert_eq!((&v["ok"], &v["by"], &v["note"]), (&json!(true), &json!(alice), &json!("lean-4.35.0 abc")), "on {d:?}");
    }
    // a new objective is a new key: no verdict until Lean checks it
    let lean2 = format!("{lean}def more : Metric := metric \"More\" (atLeast (reading \"fps\") 60)\n");
    ok(run(&mut g.w, g.mac, json!({ "op": "aip_objective", "entry": aip, "lean": lean2, "as": aven })));
    let o = g.aip(g.mac, &aip)["objective"].clone();
    assert_ne!(o["key"], json!(key));
    assert_eq!(o["verdict"], Value::Null);
}

/// N2, M4 (`spec/AvenDB/Measurers.lean`): those who accept an AIP measure it themselves, with no share: Alice's vault,
/// as her Mac acts for it, records a reading on the aven's AIP, and it counts as measured on every reader.
#[test]
fn the_vault_that_accepts_an_aip_measures_it_itself() {
    let mut g = gate();
    let n = g.create("note", note());
    g.sync(1);
    let line = g.propose(&n, "Earlier", vec![set(json!(["title"]), json!("Corn first"))]);
    let (aven, alice) = (g.aven.to_hex(), g.alice.to_hex());
    let lean = "def fps : Metric := metric \"Frames, measured\" (atLeast (measured \"fps\") 50)\n";
    let op = json!({ "op": "aip_open", "vault": alice, "title": "Faster corn", "as": aven, "objective": lean,
        "proposals": [{ "entry": n, "line": line }] });
    let aip = ok(run(&mut g.w, g.mac, op))["entry"].as_str().expect("its entry").to_string();
    g.sync(2);
    let measure = |by: &str, v: u64| json!({ "op": "aip_measure", "entry": aip, "name": "fps", "value": v, "as": by });
    ok(run(&mut g.w, g.mac, measure(&aven, 70)));
    ok(run(&mut g.w, g.mac, measure(&alice, 55)));
    g.sync(3);
    for d in g.readers {
        let o = g.aip(d, &aip)["objective"].clone();
        assert_eq!((&o["metrics"][0]["value"], &o["metrics"][0]["met"]), (&json!(55), &json!(true)), "on {d:?}: {o}");
        let rows = list(&o["readings"]);
        let marks: Vec<(&Value, &Value)> = rows.iter().map(|r| (&r["value"], &r["by"])).collect();
        assert_eq!(marks, [(&json!(70), &Value::Null), (&json!(55), &json!(alice))], "the author's reading is its own");
    }
}

/// N2 (`spec/AvenDB/Measurers.lean`): `measured "fps"` counts only the readings a Measurer of the AIP's vault wrote,
/// read off who signed each write, never a typed field. Bob, no Measurer yet, records nothing on the aven's AIP; once
/// Alice hands him her vault's Measurer group, he does, and his readings count as measured on every reader; the aven's
/// own reading counts as a reading alone; and nothing the aven writes makes it a Measurer of its own AIP.
#[test]
fn a_measurer_of_the_vault_measures_an_aip_and_its_author_never_does() {
    let mut g = gate();
    let n = g.create("note", note());
    g.sync(1);
    let line = g.propose(&n, "Earlier", vec![set(json!(["title"]), json!("Corn first"))]);
    let (aven, alice, bob, mac_b) = (g.aven.to_hex(), g.alice.to_hex(), g.w.bob.to_hex(), g.w.mac_b);
    let lean = "def sim : Measure := logic \"valley-sim\"\n\
                /-- The sim, as a Measurer runs it. -/\n\
                def fps : Metric := metric \"Frames, measured\" (atLeast (measured \"fps\") 50)\n\
                def any : Metric := metric \"Frames, any reading\" (atLeast (reading \"fps\") 50)\n";
    let op = json!({ "op": "aip_open", "vault": alice, "title": "Faster corn", "as": aven, "objective": lean,
        "proposals": [{ "entry": n, "line": line }] });
    let aip = ok(run(&mut g.w, g.mac, op))["entry"].as_str().expect("its entry").to_string();
    g.sync(2);
    let measure = |by: &str, v: u64| json!({ "op": "aip_measure", "entry": aip, "name": "fps", "value": v, "as": by });
    assert_eq!(refused(&run(&mut g.w, mac_b, measure(&bob, 30))), "NoCap", "no Measurer yet");
    // Alice's vault's Measurer group: read its AIPs, add readings on their main line; Bob holds it
    let aips = json!({ "type": ["aip"] });
    let group = json!({ "name": "Measurer", "caps": [{ "op": "read", "where": aips },
        { "op": "insert", "path": ["readings"], "on": "main", "where": aips }] });
    let defined = ok(run(&mut g.w, g.mac, json!({ "op": "define_group", "vault": alice, "group": group })));
    let to_bob = json!({ "op": "share_group", "over": alice, "group": defined["entry"], "who": { "vault": bob } });
    ok(run(&mut g.w, g.mac, to_bob));
    ok(run(&mut g.w, g.mac, measure(&aven, 60)));
    g.sync(3);
    ok(run(&mut g.w, mac_b, measure(&bob, 30)));
    ok(run(&mut g.w, mac_b, measure(&bob, 40)));
    g.sync(4);
    for d in g.readers {
        let o = g.aip(d, &aip)["objective"].clone();
        let m = |i: usize| (o["metrics"][i]["value"].clone(), o["metrics"][i]["baseline"].clone());
        assert_eq!(m(0), (json!(40), json!(30)), "Bob's alone count as measured, on {d:?}: {o}");
        assert_eq!(o["metrics"][0]["progress"], json!(0.5));
        assert_eq!(m(1), (json!(40), json!(60)), "every reading counts as a reading");
        assert_eq!(o["metrics"][0]["measured"], json!(["fps"]));
        assert_eq!(o["measures"], json!(["valley-sim"]), "the logic a Measurer runs");
        let rows = list(&o["readings"]);
        let marks: Vec<(&Value, &Value)> = rows.iter().map(|r| (&r["value"], &r["by"])).collect();
        assert_eq!(marks, [(&json!(60), &Value::Null), (&json!(30), &json!(bob)), (&json!(40), &json!(bob))]);
    }
    // the aven gives itself no group, so its readings stay its own
    ok(run(&mut g.w, g.mac, measure(&aven, 70)));
    let o = g.aip(g.mac, &aip)["objective"].clone();
    assert_eq!((&o["metrics"][0]["value"], &o["metrics"][1]["value"]), (&json!(40), &json!(70)));
    // proposed, a Measurer still measures it
    ok(run(&mut g.w, g.mac, json!({ "op": "aip_promote", "entry": aip, "as": aven })));
    g.sync(5);
    ok(run(&mut g.w, mac_b, measure(&bob, 55)));
    g.sync(6);
    let o = g.aip(g.mac, &aip)["objective"].clone();
    assert_eq!((&o["metrics"][0]["met"], &o["met"]), (&json!(true), &json!(2)));
}

/// A cinematic bundle keeps its individual audio and caption entries, beyond V1's 64-head cap.
#[test]
fn large_bundle_can_be_revised_and_accepted_whole() {
    let mut g = gate();
    let mut lines = Vec::new();
    for i in 0..97 {
        let e = g.create("note", note());
        let l = g.propose(&e, "Individual part", vec![json!({"op":"set", "path":["title"], "value":format!("Part {i}")})]);
        lines.push((e, l));
    }
    let refs: Vec<_> = lines.iter().map(|(e,l)| (e.as_str(),l.as_str())).collect();
    let (aip, _) = g.open("97 individual parts", &refs);
    g.promote(g.mac, &aip, g.aven);
    g.review(&aip, "revise", "Correct objective");
    assert_eq!(g.aip(g.mac, &aip)["stage"], "objective");
    g.promote(g.mac, &aip, g.aven);
    let answer = g.review(&aip, "accepted", "Ready");
    assert_eq!(list(&answer["accepts"]).len(), 97);
    assert_eq!(list(&answer["merges"]).len(), 97);
    g.sync(2);
    for d in g.readers {
        let read = g.aip(d, &aip);
        assert_eq!(read["stage"], "archived");
        assert!(list(&read["lines"]).iter().all(|l| l["merged"] == true));
        assert!(list(&read["reviews"]).iter().any(|r| r["verdict"] == "accepted" && r["current"] == true));
    }
}

/// Persisted V1 review records still read through the new default lens and count as current.
#[test]
fn legacy_review_v1_remains_readable_and_current_under_v2() {
    let mut g = gate();
    let entry = g.create("note", note());
    let line = g.propose(&entry, "Earlier planting", vec![set(json!(["title"]), json!("Earlier corn"))]);
    let (aip, _) = g.open("Legacy review", &[(&entry, &line)]);
    g.promote(g.mac, &aip, g.aven);
    let accepted = g.review(&aip, "accepted", "Accepted before the schema upgrade");
    let record = ok(run(&mut g.w, g.mac, json!({"op":"get", "entry":accepted["review"]})))["record"].clone();
    let legacy = ok(run(&mut g.w, g.mac, json!({
        "op":"create", "vault":g.alice.to_hex(), "type":"review",
        "schema":avendb::lens::REVIEW_V1.id().to_hex(), "value":record
    })))["entry"].clone();
    g.sync(2);
    for device in g.readers {
        let got = ok(run(&mut g.w, device, json!({"op":"get", "entry":legacy})));
        assert_eq!(got["record"], record, "V1 record reads unchanged through the default V2 lens");
        let read = g.aip(device, &aip);
        let old = list(&read["reviews"]).iter().find(|r| r["review"] == legacy).expect("legacy review remains listed");
        assert_eq!(old["current"], true);
        assert_eq!(old["verdict"], "accepted");
    }
}
