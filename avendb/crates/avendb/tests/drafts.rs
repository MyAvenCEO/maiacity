//! The gate of drafts, new entries an AIP proposes (`docs/ARCHITECTURE.md` §8, "Drafts"): a draft is a creation that
//! starts its own line, its main line empty until its vault lands it, merging that line; only the vault lands one.
//! Everything goes through the ops engine (`engine::run`), as the page and an agent send ops, but where a patched app's
//! writes are made (`Lab::patched`). agentClaude, a device vault of hers with a device of its own, is a Suggester of
//! all her vaults and an AIP author of her AIPs, as the page grants it; agentCodex holds a Suggester's share as one
//! was made before drafts; Carol is an Editor of her logic and posts, Bob a Viewer of those and of her AIPs and
//! reviews, and Dave's Mac keeps her vault for her, reading none of it; and two Public shares pick her logic and what
//! is tagged `game:sandbox-7`, as Maia City's do. Every reader of the draft, her Mac and her phone, Bob's Mac, Carol's
//! Mac and the agent's device, reaches the same verdicts on its own.

use std::collections::BTreeSet;

use avendb::cast::{self, World};
use avendb::doc::{Item, Peer};
use avendb::engine;
use avendb::history::MAIN;
use avendb::id::{BlobId, EditId, EntryId, SignerId, VaultId};
use avendb::keys::KeyFam;
use avendb::lens::{self, Schema};
use avendb::policy::{Action, Kind, Principal, Refusal, Sharing, Who};
use avendb::rules;
use avendb::sealed::{Brought, FileKey, seal};
use avendb::slice::SCHEMA_TYPE;
use avendb::world;
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

fn text(v: &Value) -> String {
    v.as_str().unwrap_or_else(|| panic!("not text: {v}")).to_string()
}

fn entry_id(e: &str) -> EntryId {
    EntryId::from_hex(e).expect("an entry's id")
}

fn edit_id(e: &str) -> EditId {
    EditId::from_hex(e).expect("an edit's id")
}

/// A logic entry, a game's rules, titled `title`.
fn logic(title: &str) -> Value {
    json!({
        "kind": "logic", "title": title, "note": "The valley's rules.",
        "source": "// the rules\nexport default (x) => x;",
        "engine": { "host": "logic", "version": 4, "hash": "ab".repeat(32) },
        "manifest": { "hooks": ["tick"], "ops": ["set"] },
        "params": [{ "id": 1, "name": "height", "kind": "number", "range": { "min": 0.2, "max": 2, "step": 0.1 },
            "default": 0.6 }],
        "contract": { "budgets": { "bytes": 200000, "ms": 2000 }, "invariants": ["replay-equal"] },
    })
}

fn set(path: Value, value: Value) -> Value {
    json!({ "op": "set", "path": path, "value": value })
}

/// The tag both Public shares are not alone in picking: Maia City's game tag.
const GAME: &str = "game:sandbox-7";

struct Gate {
    w: World,
    alice: VaultId,
    /// agentClaude's device vault, which her vault owns: a Suggester since drafts, and an AIP author.
    agent: VaultId,
    /// agentCodex's device vault: a Suggester by a share made before drafts.
    old: VaultId,
    carol: VaultId,
    mac: SignerId,
    phone: SignerId,
    claude: SignerId,
    codex: SignerId,
    /// Bob's Mac, a Viewer's.
    bob: SignerId,
    /// Carol's Mac, an Editor's.
    editor: SignerId,
    /// Dave's Mac, which keeps her vault and reads none of it.
    backup: SignerId,
}

fn gate() -> Gate {
    let mut w = cast::world();
    let (alice, mac, passkey) = (w.alice, w.mac_a, w.passkey_a);
    let found = |w: &mut World, kind: Kind, owner: VaultId, nonce: u64| {
        let owners = vec![Principal::Vault(owner)];
        let genesis = Action::Genesis { kind, owners, threshold: 1, root: None, nonce, seal_to: vec![] };
        VaultId::from(w.lab.submit(mac, &[passkey], genesis).expect("her passkey founds it"))
    };
    let device_vault = |w: &mut World, name: &str, nonce: u64| {
        let vault = found(w, Kind::DeviceVault, alice, nonce);
        let device = w.lab.device(name);
        let add = Action::Share(Sharing::Device { vault, device, seal_to: None });
        w.lab.submit(mac, &[passkey, device], add).expect("its device");
        (vault, device)
    };
    let (agent, claude) = device_vault(&mut w, "agentClaude", 6);
    let (old, codex) = device_vault(&mut w, "agentCodex", 7);
    let (a, c, x) = (alice.to_hex(), agent.to_hex(), old.to_hex());
    let share = |w: &mut World, op: Value| ok(run(w, mac, op))["share"].as_str().expect("a share").to_string();
    // a standing Suggester to agentClaude, and an AIP author's share, as the page grants
    share(&mut w, json!({ "op": "share", "over": a, "who": { "vault": c }, "level": "Suggester", "standing": true,
        "as": a }));
    let author = json!({ "name": "AIP author", "ops": [{ "op": "create" }, { "op": "set", "path": [] }] });
    let aips = json!({ "type": ["aip"] });
    share(&mut w, json!({ "op": "share", "over": a, "who": { "vault": c }, "level": author, "what": aips, "as": a }));
    // agentCodex: a Suggester's share as one was made before drafts
    let before = json!({ "name": "Suggester", "ops": rules::ops_to_json(&rules::suggester_before_drafts()) });
    share(&mut w, json!({ "op": "share", "over": a, "who": { "vault": x }, "level": before, "as": a }));
    // Carol an Editor, Bob a Viewer, Dave a Backup of it all
    let (carol, bob, dave) = (w.carol, w.bob.to_hex(), w.dave.to_hex());
    let types = |ts: &[&str]| json!({ "type": ts });
    share(&mut w, json!({ "op": "share", "over": a, "who": { "vault": carol.to_hex() }, "level": "Editor",
        "what": types(&["logic", "post"]) }));
    share(&mut w, json!({ "op": "share", "over": a, "who": { "vault": bob }, "level": "Viewer",
        "what": types(&["logic", "post", "aip", "review"]) }));
    share(&mut w, json!({ "op": "share", "over": a, "who": { "vault": dave }, "level": "Backup" }));
    // and two Public shares, as Maia City's: one by type, one by tag
    share(&mut w, json!({ "op": "share", "over": a, "who": "everyone", "level": "Public", "what": types(&["logic"]) }));
    share(&mut w, json!({ "op": "share", "over": a, "who": "everyone", "level": "Public", "what": { "tag": GAME } }));
    w.lab.sync_all(0);
    let (phone, bob, editor, backup) = (w.phone_a, w.mac_b, w.mac_c, w.mac_d);
    Gate { w, alice, agent, old, carol, mac, phone, claude, codex, bob, editor, backup }
}

impl Gate {
    fn run(&mut self, d: SignerId, op: Value) -> Value {
        run(&mut self.w, d, op)
    }

    /// Every device that reads the drafts: Alice's Mac and phone, Bob's and Carol's Macs, and agentClaude's device.
    fn readers(&self) -> [SignerId; 5] {
        [self.mac, self.phone, self.bob, self.editor, self.claude]
    }

    /// agentClaude drafts an entry of type `ty` tagged `tags` holding `value` in her vault, on its own device: the
    /// entry and its line.
    fn draft(&mut self, ty: &str, tags: &[&str], value: Value) -> (String, String) {
        let op = json!({ "op": "create", "vault": self.alice.to_hex(), "type": ty, "tags": tags, "value": value,
            "draft": true, "as": self.agent.to_hex() });
        let made = ok(self.run(self.claude, op));
        (text(&made["entry"]), text(&made["line"]))
    }

    /// agentClaude writes `ops` on line `line` of entry `e`, in one write.
    fn write(&mut self, e: &str, line: &str, ops: Vec<Value>) {
        let on = |mut op: Value| {
            op["entry"] = json!(e);
            op["line"] = json!(line);
            op
        };
        let ops: Vec<Value> = ops.into_iter().map(on).collect();
        ok(self.run(self.claude, json!({ "op": "batch", "as": self.agent.to_hex(), "ops": ops })));
    }

    /// agentClaude opens an AIP titled `title` over the lines `lines` and promotes it: the AIP and its number.
    fn propose(&mut self, title: &str, lines: &[(&str, &str)]) -> (String, u64) {
        let proposals: Vec<Value> = lines.iter().map(|(e, l)| json!({ "entry": e, "line": l })).collect();
        let op = json!({ "op": "aip_open", "vault": self.alice.to_hex(), "title": title, "proposals": proposals,
            "note": "Why: the valley needs it.\n\nWhat changes: new rules.", "tags": [GAME],
            "as": self.agent.to_hex() });
        let aip = text(&ok(self.run(self.claude, op))["entry"]);
        let op = json!({ "op": "aip_promote", "entry": aip, "as": self.agent.to_hex() });
        let number = ok(self.run(self.claude, op))["number"].as_u64().expect("its number");
        (aip, number)
    }

    /// Her vault's answer to AIP `aip`, `verdict`, at the version `heads` names if it names one: what it answered.
    fn review(&mut self, aip: &str, verdict: &str, heads: Option<Value>) -> Value {
        let as_ = self.alice.to_hex();
        let mut op = json!({ "op": "aip_review", "entry": aip, "verdict": verdict, "text": "", "as": as_ });
        if let Some(heads) = heads {
            op["heads"] = heads;
        }
        self.run(self.mac, op)
    }

    /// AIP `aip` as device `d` reads it.
    fn aip(&mut self, d: SignerId, aip: &str) -> Value {
        ok(self.run(d, json!({ "op": "aip", "entry": aip })))
    }

    /// Entry `e` on line `line` (`null`: main) as device `d` reads it: what `get` answered.
    fn get(&mut self, d: SignerId, e: &str, line: &Value) -> Value {
        self.run(d, json!({ "op": "get", "entry": e, "line": line }))
    }

    /// Each write of entry `e` device `d` shows, as `history` does: none where it shows none.
    fn history(&mut self, d: SignerId, e: &str) -> Vec<Value> {
        let answer = self.run(d, json!({ "op": "history", "entry": e }));
        answer.get("ok").map(|h| list(&h["edits"]).to_vec()).unwrap_or_default()
    }

    /// The writes of entry `e` device `d` counts.
    fn counted(&mut self, d: SignerId, e: &str) -> BTreeSet<String> {
        self.history(d, e).iter().filter(|x| x["counted"] == true).map(|x| text(&x["id"])).collect()
    }

    /// Write `edit` of entry `e` as device `d` shows it.
    fn wrote(&mut self, d: SignerId, e: &str, edit: EditId) -> Value {
        let edits = self.history(d, e);
        edits.into_iter().find(|x| x["id"] == edit.to_hex()).unwrap_or_else(|| panic!("no write {edit:?} on {d:?}"))
    }

    fn landed(&self, d: SignerId, e: &str) -> bool {
        self.w.lab.landed(d, entry_id(e))
    }

    /// Whether everyone reads entry `e` by device `d`'s view: its audience's key is public.
    fn public(&self, d: SignerId, e: &str) -> bool {
        let st = self.w.lab.state(d);
        let en = st.entry(entry_id(e)).expect("the entry");
        st.public_key(KeyFam::Audience(en.vault, en.audience()))
    }

    fn sync(&mut self, seed: u64) {
        self.w.lab.sync_all(seed);
    }
}

/// The part of a diff labelled `label`.
fn part<'a>(diff: &'a Value, label: &str) -> &'a Value {
    list(diff).iter().find(|p| p["label"] == label).unwrap_or_else(|| panic!("no part {label:?} in {diff}"))
}

/// The happy path: agentClaude may draft a logic in her vault, though it creates none on main; it drafts one, writes
/// on its line, and puts it to her in an AIP, AIP-1, whose card shows a new logic, tagged, that goes public on Accept.
/// Her vault accepts the version the card showed, which lands it: every reader then reads it on main, every write of
/// it counts, the AIP reads applied, Dave's Mac lists it though it opens none of it, and the steward makes it public.
#[test]
fn a_suggester_agent_drafts_a_new_logic_and_the_vaults_aip_review_lands_it() {
    let mut g = gate();
    let (a, c) = (g.alice.to_hex(), g.agent.to_hex());
    let creatable = |draft| json!({ "op": "creatable", "vault": a, "type": "logic", "draft": draft, "as": c });
    assert_eq!(ok(g.run(g.claude, creatable(true))), json!({ "tags": [] }), "it may draft a logic");
    assert_eq!(refused(&g.run(g.claude, creatable(false))), "NoCap", "but not create one on main");
    let (e, line) = g.draft("logic", &[GAME], logic("Harvest rules"));
    g.write(&e, &line, vec![set(json!(["note"]), json!("Harvest in autumn."))]);
    let first = &g.history(g.claude, &e)[0];
    assert_eq!((&first["id"], &first["kind"], &first["line"]), (&json!(line), &json!("draft"), &json!(line)));
    let (aip, number) = g.propose("Harvest rules for Sandbox 7", &[(&e, &line)]);
    assert_eq!(number, 1);
    g.sync(1);
    // the card: a new logic, with its tags, which a Public share picks once it lands
    let read = g.aip(g.mac, &aip);
    let l = &read["lines"][0];
    let said = (&l["new"], &l["type"], &l["tags"], &l["public"], &l["merged"]);
    assert_eq!(said, (&json!(true), &json!("logic"), &json!([GAME]), &json!(true), &json!(false)));
    let summary = text(&read["summary"][0]);
    assert!(summary.starts_with("New Logic: Harvest rules (+") && summary.ends_with(" fields)"), "{summary}");
    let title = part(&l["diff"], "Title");
    assert_eq!((&title["old"], &title["new"]), (&Value::Null, &json!("Harvest rules")), "every field is new");
    // before her answer it is on no main line
    for d in g.readers() {
        assert_eq!(refused(&g.get(d, &e, &Value::Null)), "NoEntry", "on {d:?}");
        assert!(!g.landed(d, &e));
    }
    assert!(!g.landed(g.backup, &e));
    // her vault accepts what the card showed
    let answer = ok(g.review(&aip, "accepted", Some(l["heads"].clone())));
    assert_eq!((list(&answer["accepts"]).len(), list(&answer["merges"]).len()), (1, 1));
    g.sync(2);
    for d in g.readers() {
        let read = g.aip(d, &aip);
        let said = (&read["stage"], &read["outcome"], &read["lines"][0]["merged"]);
        assert_eq!(said, (&json!("archived"), &json!("applied"), &json!(true)), "on {d:?}");
        let got = ok(g.get(d, &e, &Value::Null));
        let record = (&got["record"]["title"], &got["record"]["note"]);
        assert_eq!(record, (&json!("Harvest rules"), &json!("Harvest in autumn.")), "on {d:?}");
        assert!(g.history(d, &e).iter().all(|x| x["counted"] == true), "every write counts on {d:?}");
        assert!(g.landed(d, &e));
    }
    // Dave's Mac opens none of it, yet lists it now that her vault took it in
    assert!(g.landed(g.backup, &e));
    let seen = ok(g.run(g.backup, json!({ "op": "world" })));
    assert!(list(&seen["entries"]).iter().any(|x| x["entry"] == e.as_str()), "listed, sealed");
    // and the steward marks it into its whole audience: everyone reads it
    assert!(g.public(g.mac, &e));
    let code = world::public_entries(&g.w.lab, g.mac, Some(&world::CODE_KINDS[..]));
    assert!(code.iter().any(|row| row["entry"] == e.as_str()), "in the feed of code");
}

/// Adversarial: a draft logic and a draft post, each picked by both Public shares, by type and by tag, show on no main
/// read of any device before her vault lands them: not in `query`, `get` on main, `world` (its entries, shares and
/// audiences), `database` (which counts them as drafts), the feed of entries (`/feed/entry` and `/feed/entries`), the
/// posts' feed nor the files'. The steward keeps them out of every audience a share to everyone is in, so no key of
/// theirs is public, and marks nothing more; their line reads where their shares reach. Once her vault lands them, the
/// same shares pick them, and everyone reads them.
#[test]
fn an_unlanded_draft_never_shows_on_main() {
    let mut g = gate();
    let a = g.alice.to_hex();
    let (e, line) = g.draft("logic", &[GAME], logic("Harvest rules"));
    let post = json!({ "kind": "post", "title": "Harvest", "text": "Out now.", "channel": "Devlog" });
    let (p, on_post) = g.draft("post", &[GAME], post);
    g.sync(1);
    let ours = |x: &Value| x == e.as_str() || x == p.as_str();
    let devices: Vec<SignerId> = g.readers().into_iter().chain([g.backup]).collect();
    for &d in &devices {
        assert!(!g.landed(d, &e) && !g.landed(d, &p), "on {d:?}");
        let rows = ok(g.run(d, json!({ "op": "query" })));
        assert!(!list(&rows["rows"]).iter().any(|r| ours(&r["entry"])), "query on {d:?}");
        for x in [&e, &p] {
            assert_eq!(refused(&g.get(d, x, &Value::Null)), "NoEntry", "get main on {d:?}");
        }
        let seen = ok(g.run(d, json!({ "op": "world" })));
        assert!(!list(&seen["entries"]).iter().any(|x| ours(&x["entry"])), "world on {d:?}");
        let listed = |k: &str| list(&seen[k]).iter().flat_map(|s| list(&s["entries"]).to_vec()).collect::<Vec<_>>();
        assert!(!listed("shares").iter().any(ours) && !listed("audiences").iter().any(ours), "on {d:?}");
        let rows = world::public_entries(&g.w.lab, d, None);
        assert!(!rows.iter().any(|r| ours(&r["entry"])), "the feed of entries on {d:?}");
        assert!(!world::public_posts(&g.w.lab, d).iter().any(|r| ours(&r["entry"])), "the posts' feed on {d:?}");
        assert!(world::public_files(&g.w.lab, d).keys().all(|(v, _)| *v != g.alice), "the files' feed on {d:?}");
    }
    let db = ok(g.run(g.mac, json!({ "op": "database", "vault": a })));
    assert!(!list(&db["rows"]).iter().any(|r| ours(&r["entry"])));
    assert_eq!(db["drafts"], 2, "counted as drafts, in none of its tables");
    // the steward keeps them out of what everyone reads, and marks nothing more
    for x in [&e, &p] {
        assert!(g.w.lab.public_once_landed(g.mac, entry_id(x)), "both Public shares pick it once it lands");
        assert!(!g.public(g.mac, x), "no key of it is public");
        let st = g.w.lab.state(g.mac);
        let en = st.entry(entry_id(x)).expect("the draft");
        let shares = st.audience_shares(en.audience()).unwrap_or_default();
        let everyone = |c| st.share(c).is_some_and(|cp| cp.share.who == Who::Everyone);
        assert!(!shares.iter().any(|&c| everyone(c)), "in no audience of a share to everyone");
        let mark = g.w.lab.mark_now(g.mac, entry_id(x)).expect("her Mac may mark it");
        assert!(mark.is_none(), "the steward marks nothing more");
    }
    // their line reads where their shares reach: the agent's, her vault's, Bob's
    for d in [g.claude, g.mac, g.bob] {
        let got = ok(g.get(d, &e, &json!(line)));
        assert_eq!(got["record"]["title"], "Harvest rules", "on {d:?}");
        assert_eq!(ok(g.get(d, &p, &json!(on_post)))["record"]["title"], "Harvest");
    }
    // once her vault lands them, everyone reads them
    for (x, l) in [(&e, &line), (&p, &on_post)] {
        ok(g.run(g.mac, json!({ "op": "merge", "entry": x, "from": l, "as": a })));
    }
    g.sync(2);
    assert!(g.public(g.mac, &e) && g.public(g.mac, &p));
    let rows = world::public_entries(&g.w.lab, g.mac, None);
    assert!(rows.iter().any(|r| r["entry"] == e.as_str()) && rows.iter().any(|r| r["entry"] == p.as_str()));
    assert!(world::public_posts(&g.w.lab, g.mac).iter().any(|r| r["entry"] == p.as_str()));
    let db = ok(g.run(g.mac, json!({ "op": "database", "vault": a })));
    assert_eq!(db["drafts"], 0);
}

/// A Suggester creates nothing on main: its device refuses, `NotAllowed`. The same write from a patched app is made,
/// and counts for no reader, nor does anything built on it.
#[test]
fn a_suggesters_create_on_main_is_refused_and_counts_for_no_reader() {
    let mut g = gate();
    let (a, c) = (g.alice.to_hex(), g.agent.to_hex());
    let op = json!({ "op": "create", "vault": a, "type": "logic", "value": logic("Mine"), "as": c });
    assert_eq!(refused(&g.run(g.claude, op.clone())), "NotAllowed");
    let (claude, agent) = (g.claude, g.agent);
    let made = ok(g.w.lab.patched(|lab| engine::run(lab, claude, &op)));
    let e = text(&made["entry"]);
    let creation = g.w.lab.history(claude, entry_id(&e)).expect("its history").changes()[0].write.edit;
    let built = g.w.lab.patched(|lab| lab.propose(claude, agent, entry_id(&e), &[creation], "More"));
    let built = built.expect("a patched app builds on it");
    g.sync(1);
    for d in g.readers() {
        assert!(g.counted(d, &e).is_empty(), "no write of it counts on {d:?}");
        assert_eq!(refused(&g.get(d, &e, &Value::Null)), "NoEntry");
    }
    assert_eq!(g.w.lab.fetched(g.mac, entry_id(&e)), 2, "her Mac holds both");
    assert_eq!(g.wrote(g.mac, &e, creation)["why"], "ops");
    assert_eq!(g.wrote(g.mac, &e, built)["why"], "builds-on");
}

/// A merge into main of a draft by anyone but its vault counts for no reader, even on top of the vault's accept: a
/// Suggester's, an Editor's merge on top of her vault's review, an Editor's write on main straight. Each is refused on
/// an honest device, `NotLanded`, and counts for no reader from a patched one, which `history` says is `landing`. Her
/// vault's own merge lands it; theirs still count for nobody.
#[test]
fn a_merge_into_main_of_a_draft_by_anyone_but_its_vault_stays_uncounted() {
    let mut g = gate();
    let (a, c, carol) = (g.alice.to_hex(), g.agent.to_hex(), g.carol.to_hex());
    let (e, line) = g.draft("logic", &[], logic("Harvest rules"));
    g.sync(1);
    // her vault's accept of the line, a review of it: the accept an Editor's merge into main counts on top of (M2)
    let review = json!({ "op": "review", "entry": e, "line": line, "verdict": "accepted", "as": a });
    ok(g.run(g.mac, review));
    g.sync(2);
    let merge = |by: &str| json!({ "op": "merge", "entry": e, "from": line, "as": by });
    assert_eq!(refused(&g.run(g.claude, merge(&c))), "NotLanded", "a Suggester's merge");
    assert_eq!(refused(&g.run(g.editor, merge(&carol))), "NotLanded", "an Editor's on top of the accept");
    let (eid, lid) = (entry_id(&e), Some(edit_id(&line)));
    let (claude, agent, editor, by) = (g.claude, g.agent, g.editor, g.carol);
    let straight = move |lab: &mut avendb::lab::Lab| {
        lab.edit_on(editor, by, eid, MAIN, |item| item.put_record(&logic("Mine")))
    };
    assert_eq!(straight(&mut g.w.lab), Err(Refusal::NotLanded), "an Editor's write on main straight");
    // from a patched app, the write on main straight first, as a device drafts it on its own writes' heads
    let none = BTreeSet::new();
    let made = [
        g.w.lab.patched(straight),
        g.w.lab.patched(|lab| lab.merge(claude, agent, eid, lid, MAIN, &none)),
        g.w.lab.patched(|lab| lab.merge(editor, by, eid, lid, MAIN, &none)),
    ]
    .map(|made| made.expect("a patched app makes it"));
    g.sync(3);
    for d in g.readers() {
        for edit in made {
            let x = g.wrote(d, &e, edit);
            assert_eq!((&x["counted"], &x["why"]), (&json!(false), &json!("landing")), "{edit:?} on {d:?}");
        }
        assert!(!g.landed(d, &e), "on {d:?}");
        assert_eq!(refused(&g.get(d, &e, &Value::Null)), "NoEntry");
    }
    assert!(!g.landed(g.backup, &e), "nor by a patched app's writes, to a device that opens none of it");
    // her vault's own merge lands it
    ok(g.run(g.mac, merge(&a)));
    g.sync(4);
    for d in g.readers() {
        assert!(g.landed(d, &e), "on {d:?}");
        assert_eq!(ok(g.get(d, &e, &Value::Null))["record"]["title"], "Harvest rules");
        for edit in made {
            assert_eq!(g.wrote(d, &e, edit)["counted"], false, "{edit:?} on {d:?}");
        }
    }
    assert!(g.landed(g.backup, &e));
}

/// Her vault accepts the draft's line at one version, and the agent writes on after: the review no longer answers the
/// line as it stands. Her vault's merge lands it all the same, as its own merges need no accept. After landing, a later
/// edit on the line that an Editor merges counts only on top of a new accept of her vault's (M2).
#[test]
fn a_write_after_the_accept_needs_a_new_accept() {
    let mut g = gate();
    let (a, carol) = (g.alice.to_hex(), g.carol.to_hex());
    let (e, line) = g.draft("logic", &[], logic("Harvest rules"));
    g.sync(1);
    let review = json!({ "op": "review", "entry": e, "line": line, "verdict": "accepted", "as": a });
    ok(g.run(g.mac, review.clone()));
    let current = |g: &mut Gate| {
        let all = ok(g.run(g.mac, json!({ "op": "aips" })));
        let bare = list(&all).iter().find(|x| x["bare"] == true && x["lines"][0]["entry"] == e.as_str()).cloned();
        bare.expect("the draft, a bare idea")["reviews"][0]["current"].clone()
    };
    assert_eq!(current(&mut g), true, "her review answers the line as it stands");
    g.sync(2);
    g.write(&e, &line, vec![set(json!(["note"]), json!("Harvest in autumn."))]);
    g.sync(3);
    assert_eq!(current(&mut g), false, "the agent wrote on after it");
    let merge = |by: &str| json!({ "op": "merge", "entry": e, "from": line, "as": by });
    ok(g.run(g.mac, merge(&a)));
    g.sync(4);
    for d in g.readers() {
        assert_eq!(ok(g.get(d, &e, &Value::Null))["record"]["note"], "Harvest in autumn.", "landed on {d:?}");
    }
    // landed, a later edit on its line an Editor merges counts on top of a new accept alone
    g.write(&e, &line, vec![set(json!(["note"]), json!("Harvest in spring."))]);
    g.sync(5);
    assert_eq!(refused(&g.run(g.editor, merge(&carol))), "NotAccepted");
    let (editor, by, eid, lid) = (g.editor, g.carol, entry_id(&e), Some(edit_id(&line)));
    let early = g.w.lab.patched(|lab| lab.merge(editor, by, eid, lid, MAIN, &BTreeSet::new())).expect("made");
    ok(g.run(g.mac, review));
    g.sync(6);
    ok(g.run(g.editor, merge(&carol)));
    g.sync(7);
    for d in g.readers() {
        let x = g.wrote(d, &e, early);
        assert_eq!((&x["counted"], &x["why"]), (&json!(false), &json!("policy")), "on {d:?}");
        assert_eq!(ok(g.get(d, &e, &Value::Null))["record"]["note"], "Harvest in spring.", "on {d:?}");
        assert!(g.history(d, &e).iter().filter(|x| x["id"] != early.to_hex()).all(|x| x["counted"] == true));
    }
}

/// The card pins the version it showed (`aip_review`'s `heads`): the agent writes on after the card was drawn, and her
/// Accept of what it showed is refused, the AIP as it was; read again, she accepts what it shows now.
#[test]
fn an_accept_pins_the_version_the_card_showed() {
    let mut g = gate();
    let (e, line) = g.draft("logic", &[GAME], logic("Harvest rules"));
    let (aip, _) = g.propose("Harvest rules", &[(&e, &line)]);
    g.sync(1);
    let shown = g.aip(g.mac, &aip)["lines"][0]["heads"].clone();
    g.write(&e, &line, vec![set(json!(["note"]), json!("Burn the fields."))]);
    g.sync(2);
    let stale = g.review(&aip, "accepted", Some(shown));
    assert_eq!(refused(&stale), "BadOp");
    assert!(text(&stale["why"]).contains("moved since it was shown"), "{stale}");
    assert_eq!(g.aip(g.mac, &aip)["stage"], "proposed", "nothing written");
    assert!(!g.landed(g.mac, &e));
    let now = g.aip(g.mac, &aip)["lines"][0]["heads"].clone();
    ok(g.review(&aip, "accepted", Some(now)));
    g.sync(3);
    for d in g.readers() {
        assert_eq!(ok(g.get(d, &e, &Value::Null))["record"]["note"], "Burn the fields.", "on {d:?}");
    }
}

/// A withdrawn AIP's draft and a declined one's stay unlanded for good, on no main line; the same line named in a new
/// AIP that her vault accepts still lands.
#[test]
fn a_withdrawn_or_declined_draft_stays_unlanded_for_good() {
    let mut g = gate();
    let c = g.agent.to_hex();
    let (withdrawn, on_withdrawn) = g.draft("logic", &[], logic("Old rules"));
    let (first, n) = g.propose("Old rules", &[(&withdrawn, &on_withdrawn)]);
    assert_eq!(n, 1);
    ok(g.run(g.claude, json!({ "op": "aip_withdraw", "entry": first, "why": "Superseded", "as": c })));
    let (declined, on_declined) = g.draft("logic", &[], logic("New rules"));
    let (second, n) = g.propose("New rules", &[(&declined, &on_declined)]);
    assert_eq!(n, 2);
    g.sync(1);
    ok(g.review(&second, "declined", None));
    g.sync(2);
    for d in g.readers() {
        for (aip, e) in [(&first, &withdrawn), (&second, &declined)] {
            // Carol, an Editor of her logic alone, reads none of her reviews
            if d != g.editor {
                let read = g.aip(d, aip);
                let said = (&read["stage"], &read["outcome"]);
                assert_eq!(said, (&json!("archived"), &json!("rejected")), "on {d:?}");
            }
            assert!(!g.landed(d, e), "on {d:?}");
            assert_eq!(refused(&g.get(d, e, &Value::Null)), "NoEntry");
        }
    }
    // the declined draft's line in a new AIP: accepted, with no heads named, as the Proposals app answers, it lands
    let (third, n) = g.propose("New rules, again", &[(&declined, &on_declined)]);
    assert_eq!(n, 3);
    g.sync(3);
    ok(g.review(&third, "accepted", None));
    g.sync(4);
    for d in g.readers() {
        assert!(g.landed(d, &declined) && !g.landed(d, &withdrawn), "on {d:?}");
        assert_eq!(ok(g.get(d, &declined, &Value::Null))["record"]["title"], "New rules");
    }
}

/// What each reader counts of a draft, whether it landed, and how it is marked, as device `d` holds it.
fn verdict(g: &mut Gate, d: SignerId, e: &str) -> (BTreeSet<String>, bool, Vec<String>) {
    let counted = g.counted(d, e);
    let st = g.w.lab.state(d);
    let en = st.entry(entry_id(e)).expect("the draft");
    let marks = st.audience_shares(en.audience()).unwrap_or_default().iter().map(|c| c.to_hex()).collect();
    (counted, g.landed(d, e), marks)
}

/// Readers apart meet the writes of a draft in different orders: an Editor's merge from a patched app on top of the
/// vault's accept, her vault's merge, the agent's next write. Each reaches the same verdict on its own: what counts,
/// whether it landed, and its marks (T11); so does a device that opens none of it, on whether it landed.
#[test]
fn every_reader_reaches_the_same_landing_verdict_offline() {
    let mut g = gate();
    let a = g.alice.to_hex();
    let (e, line) = g.draft("logic", &[GAME], logic("Harvest rules"));
    g.sync(1);
    ok(g.run(g.mac, json!({ "op": "review", "entry": e, "line": line, "verdict": "accepted", "as": a })));
    g.sync(2);
    let (phone, bob, backup) = (g.phone, g.bob, g.backup);
    for d in [phone, bob, backup] {
        g.w.lab.set_online(d, false);
    }
    let (editor, by, eid, lid) = (g.editor, g.carol, entry_id(&e), Some(edit_id(&line)));
    g.w.lab.patched(|lab| lab.merge(editor, by, eid, lid, MAIN, &BTreeSet::new())).expect("made");
    ok(g.run(g.mac, json!({ "op": "merge", "entry": e, "from": line, "as": a })));
    g.write(&e, &line, vec![set(json!(["note"]), json!("Harvest in autumn."))]);
    // her phone hears the Editor first, Bob's Mac her Mac first
    for d in [phone, bob, backup] {
        g.w.lab.set_online(d, true);
    }
    let (mac, claude) = (g.mac, g.claude);
    for from in [editor, mac, claude] {
        g.w.lab.sync(from, phone);
    }
    for from in [claude, mac, editor] {
        g.w.lab.sync(from, bob);
    }
    assert_eq!(g.w.lab.fetched(phone, eid), g.w.lab.fetched(bob, eid), "both hold every write of it");
    let one = verdict(&mut g, phone, &e);
    assert!(one.1, "landed");
    assert_eq!(verdict(&mut g, bob, &e), one, "the same verdict, heard in another order");
    g.sync(3);
    let all = verdict(&mut g, mac, &e);
    for d in g.readers() {
        assert_eq!(verdict(&mut g, d, &e), all, "on {d:?}");
    }
    assert!(g.landed(backup, &e), "a device that opens none of it reads its landing in the clear");
}

/// Neither her vault nor anyone drafts a schema or lens: one is refused, by `create` and `creatable`, as a type needs
/// its schema in the vault's lane first, by the vault's own creation on main. One a patched app drafts joins no lane,
/// nor once her vault lands it.
#[test]
fn a_draft_of_a_schema_or_lens_is_refused_and_joins_no_lane() {
    let mut g = gate();
    let (a, c) = (g.alice.to_hex(), g.agent.to_hex());
    let schema = lens::blobs::POST_V1.replace("Post, v1", "Post, drafted");
    let id = Schema::parse(schema.as_bytes()).expect("a schema").id();
    for (d, by) in [(g.mac, &a), (g.claude, &c)] {
        let op = json!({ "op": "create", "vault": a, "type": "schema", "value": schema, "draft": true, "as": by });
        assert_eq!(refused(&g.run(d, op)), "BadOp");
        let lens = json!({ "op": "create", "vault": a, "type": "lens", "value": "{}", "draft": true, "as": by });
        assert_eq!(refused(&g.run(d, lens)), "BadOp");
        let op = json!({ "op": "creatable", "vault": a, "type": "schema", "draft": true, "as": by });
        assert_eq!(refused(&g.run(d, op)), "BadOp");
    }
    let (mac, alice) = (g.mac, g.alice);
    assert_eq!(
        g.w.lab.create_draft(mac, alice, alice, SCHEMA_TYPE, &[], |_| Some(schema.as_bytes().to_vec())),
        Err(Refusal::NotAView),
        "the Lab refuses one too"
    );
    let drafted = g.w.lab.patched(|lab| {
        lab.create_draft(mac, alice, alice, SCHEMA_TYPE, &[], |_| Some(schema.as_bytes().to_vec()))
    });
    let (e, line) = drafted.expect("a patched app drafts one");
    g.sync(1);
    for d in g.readers() {
        assert!(g.w.lab.lane(d, alice).schema(id).is_none(), "in no lane on {d:?}");
    }
    g.w.lab.patched(|lab| lab.merge(mac, alice, e, Some(line), MAIN, &BTreeSet::new())).expect("her vault lands it");
    g.sync(2);
    assert!(g.w.lab.landed(mac, e));
    for d in g.readers() {
        assert!(g.w.lab.lane(d, alice).schema(id).is_none(), "in no lane once landed, on {d:?}");
        let schemas = ok(g.run(d, json!({ "op": "schemas", "vault": a })));
        assert!(!schemas.to_string().contains(&id.to_hex()), "listed by no device: {d:?}");
    }
}

/// A proposal of a draft not yet landed starts on its line, at its heads, by default, and never from a version that
/// lacks its creation; a variant line so started lands the draft as its own line would.
#[test]
fn a_proposal_of_a_draft_starts_from_its_creation() {
    let mut g = gate();
    let c = g.agent.to_hex();
    let (e, line) = g.draft("logic", &[], logic("Harvest rules"));
    g.write(&e, &line, vec![set(json!(["title"]), json!("Harvest rules, v2"))]);
    let heads = ok(g.get(g.claude, &e, &json!(line)))["heads"].clone();
    let started = ok(g.run(g.claude, json!({ "op": "propose", "entry": e, "name": "Wider", "as": c })));
    let wider = text(&started["line"]);
    assert_eq!(g.wrote(g.claude, &e, edit_id(&wider))["deps"], heads, "from the draft line's heads");
    assert_eq!(ok(g.get(g.claude, &e, &json!(wider)))["record"]["title"], "Harvest rules, v2");
    let bare = json!({ "op": "propose", "entry": e, "from": [], "name": "Bare", "as": c });
    assert_eq!(refused(&g.run(g.claude, bare)), "BadOp", "from no version that holds its creation");
    g.write(&e, &wider, vec![set(json!(["note"]), json!("Wider valleys."))]);
    let (aip, _) = g.propose("Wider harvest rules", &[(&e, &wider)]);
    g.sync(1);
    assert_eq!(g.aip(g.mac, &aip)["lines"][0]["new"], false, "a line of a draft, not its own");
    ok(g.review(&aip, "accepted", None));
    g.sync(2);
    for d in g.readers() {
        assert!(g.landed(d, &e), "on {d:?}");
        let got = ok(g.get(d, &e, &Value::Null));
        let record = (&got["record"]["title"], &got["record"]["note"]);
        assert_eq!(record, (&json!("Harvest rules, v2"), &json!("Wider valleys.")), "on {d:?}");
    }
}

/// A Suggester's share made before drafts still reads as a Suggester's, `drafts` false, and allows all it did; it
/// drafts nothing, as it lacks `create` on proposals. The share made since drafts.
#[test]
fn old_suggester_shares_still_name_suggester_and_draft_nothing() {
    let mut g = gate();
    let (a, x) = (g.alice.to_hex(), g.old.to_hex());
    let seen = world::world(&g.w.lab, g.mac).expect("her world");
    let of = |v: VaultId| seen.shares.iter().find(|s| s.share.who == Who::Vault(v) && s.share.over == g.alice);
    let old = of(g.old).expect("agentCodex's share");
    assert_eq!(world::group_of(&old.share, old.slice.as_ref()), Some("Suggester"));
    assert_eq!(old.drafts(), Some(false));
    let new = of(g.agent).filter(|s| !s.slice.as_ref().is_some_and(|x| x.name == "AIP author")).expect("its share");
    assert_eq!(world::group_of(&new.share, new.slice.as_ref()), Some("Suggester"));
    assert_eq!(new.drafts(), Some(true));
    let shown = ok(g.run(g.mac, json!({ "op": "world" })));
    let row = list(&shown["shares"]).iter().find(|s| s["id"] == old.id.to_hex()).cloned().expect("its row");
    assert_eq!((&row["group"], &row["drafts"]), (&json!("Suggester"), &json!(false)));
    // it drafts nothing
    let op = json!({ "op": "create", "vault": a, "type": "logic", "value": logic("Mine"), "draft": true, "as": x });
    assert_eq!(refused(&g.run(g.codex, op)), "NotAllowed");
    let op = json!({ "op": "creatable", "vault": a, "type": "logic", "draft": true, "as": x });
    assert_eq!(refused(&g.run(g.codex, op)), "NoCap");
    // and still suggests a change to an entry there, as it did
    let made = ok(g.run(g.mac, json!({ "op": "create", "vault": a, "type": "logic", "value": logic("Rules") })));
    g.sync(1);
    let start = json!({ "op": "propose", "entry": made["entry"], "name": "Taller", "as": x });
    let line = ok(g.run(g.codex, start))["line"].clone();
    let height = set(json!(["params", { "id": 1 }, "default"]), json!(0.8));
    let ops = json!([{ "op": "set", "entry": made["entry"], "line": line, "path": height["path"], "value": 0.8 }]);
    ok(g.run(g.codex, json!({ "op": "batch", "as": x, "ops": ops })));
}

/// A draft's creation is written as its author's draft peer of the entry (`doc::Peer::Draft`): its line is named by
/// its own id, which no update can know before it is written. So her Mac drafts an entry, writes on its line, lands it
/// and writes on main and on the line again, her phone on main beside, and agentClaude drafts one too: every write of
/// both counts on every reader, and the creation opens as its draft peer alone.
#[test]
fn a_drafts_creation_uses_its_draft_peer_and_never_collides_with_main() {
    let mut g = gate();
    let a = g.alice.to_hex();
    let op = json!({ "op": "create", "vault": a, "type": "logic", "value": logic("Mine"), "draft": true });
    let made = ok(g.run(g.mac, op));
    let (e, line) = (text(&made["entry"]), text(&made["line"]));
    let (mac, eid, lid) = (g.mac, entry_id(&e), edit_id(&line));
    let body = g.w.lab.history(mac, eid).and_then(|h| h.get(lid)).and_then(|c| c.body.clone()).expect("its body");
    assert!(Item::new(mac).import_as(&body, Peer::Draft(mac, eid)).is_ok(), "its draft peer");
    for peer in [Peer::Line(mac, Some(lid)), Peer::Line(mac, MAIN), Peer::Draft(mac, EntryId([7; 32]))] {
        assert!(Item::new(mac).import_as(&body, peer).is_err(), "not as {peer:?}");
        assert_ne!(peer.id(), Peer::Draft(mac, eid).id());
    }
    let (other, _) = g.draft("logic", &[], logic("Theirs"));
    let on = |line: Value, value: &str| {
        json!({ "op": "set", "entry": e, "line": line, "path": ["note"], "value": value, "as": a })
    };
    ok(g.run(g.mac, on(json!(line), "On its line.")));
    ok(g.run(g.mac, json!({ "op": "merge", "entry": e, "from": line, "as": a })));
    ok(g.run(g.mac, on(Value::Null, "On main.")));
    ok(g.run(g.mac, on(json!(line), "On its line again.")));
    g.sync(1);
    let title = json!({ "op": "set", "entry": e, "path": ["title"], "value": "Ours", "as": a });
    ok(g.run(g.phone, title));
    g.sync(2);
    for d in g.readers() {
        for x in [&e, &other] {
            assert!(g.history(d, x).iter().all(|w| w["counted"] == true), "every write of {x} counts on {d:?}");
        }
        let got = ok(g.get(d, &e, &Value::Null));
        let record = (&got["record"]["title"], &got["record"]["note"]);
        assert_eq!(record, (&json!("Ours"), &json!("On main.")), "on {d:?}");
        assert_eq!(ok(g.get(d, &e, &json!(line)))["record"]["note"], "On its line again.");
    }
}

/// A standing Suggester her page gave before drafts, to her aven and on to agentClaude, and that a coop she owns
/// followed, is given again in the group's form when her page grants it again (`$lib/avendb/vaults.js`
/// `standingOps`): no sheet, a new standing grant each, the agent's resting on the aven's new one, and the coop follows
/// them in that form, resting on what gives all they give; the ones before stand for nothing more. Then agentClaude
/// drafts in the coop.
#[test]
#[ignore = "an aven owns no agent vault any more: agents reach avenMAIA through its server (next PR)"]
fn a_standing_suggester_made_before_drafts_is_granted_again_in_its_new_form() {
    let mut w = cast::world();
    let (alice, mac, passkey) = (w.alice, w.mac_a, w.passkey_a);
    let found = |w: &mut World, kind: Kind, owner: VaultId, nonce: u64| {
        let owners = vec![Principal::Vault(owner)];
        let genesis = Action::Genesis { kind, owners, threshold: 1, root: None, nonce, seal_to: vec![] };
        VaultId::from(w.lab.submit(mac, &[passkey], genesis).expect("her passkey founds it"))
    };
    let ours = found(&mut w, Kind::Coop, alice, 5);
    let aven = found(&mut w, Kind::Aven, ours, 5);
    let agent = found(&mut w, Kind::DeviceVault, aven, 6);
    let claude = w.lab.device("agentClaude");
    let add = Action::Share(Sharing::Device { vault: agent, device: claude, seal_to: None });
    w.lab.submit(mac, &[passkey, claude], add).expect("its device");
    let coop = found(&mut w, Kind::Coop, alice, 7);
    // the standing grants as her page made them before drafts, and the coop following them
    let name = world::standing_name("Suggester");
    let old = |over: VaultId, who: VaultId, parent, issuer| avendb::lab::NewShare {
        name: name.clone(),
        ops: rules::suggester_before_drafts(),
        parent,
        issuer,
        ..cast::share(over, cast::vault(who), avendb::policy::Level::Write, avendb::slice::Selector::All)
    };
    let issue = |w: &mut World, s| w.lab.issue(mac, &[mac], s).expect("as it was");
    let to_aven = issue(&mut w, old(alice, aven, None, alice));
    let to_agent = issue(&mut w, old(alice, agent, Some(to_aven), aven));
    let followed = issue(&mut w, old(coop, aven, None, coop));
    issue(&mut w, old(coop, agent, Some(followed), aven));
    let before: Vec<_> = world::standing(&w.lab, mac, alice).into_iter().map(|s| s.share).collect();
    assert_eq!(before, [to_aven, to_agent]);
    // her page grants them again
    let (a, v, c) = (alice.to_hex(), aven.to_hex(), agent.to_hex());
    let grant = |w: &mut World, who: &str, by: &str| {
        let op = json!({ "op": "share", "over": a, "who": { "vault": who }, "level": "Suggester", "standing": true,
            "as": by });
        avendb::id::ShareId::from_hex(&text(&ok(run(w, mac, op))["share"])).expect("a share")
    };
    let (aven_now, agent_now) = (grant(&mut w, &v, &a), grant(&mut w, &c, &v));
    assert!(aven_now != to_aven && agent_now != to_agent, "given again");
    assert_eq!(w.lab.state(mac).share(agent_now).and_then(|cp| cp.share.parent), Some(aven_now));
    let now: Vec<_> = world::standing(&w.lab, mac, alice).into_iter().map(|s| s.share).collect();
    assert_eq!(now, [aven_now, agent_now], "the ones before stand for nothing more");
    assert_eq!((grant(&mut w, &v, &a), grant(&mut w, &c, &v)), (aven_now, agent_now), "asked again, they stand");
    // the coop follows them in the group's form: the agent drafts there
    let seen = world::world(&w.lab, mac).expect("her world");
    let over = |who: VaultId| {
        let of =
            |s: &&world::ShareView| s.share.over == coop && s.share.who == Who::Vault(who) && s.drafts() == Some(true);
        seen.shares.iter().find(of).map(|s| s.id)
    };
    let (coops, agents) = (over(aven).expect("the aven's"), over(agent).expect("the agent's"));
    assert_eq!(w.lab.state(mac).share(agents).and_then(|cp| cp.share.parent), Some(coops));
    w.lab.sync_all(1);
    let draft = json!({ "op": "create", "vault": coop.to_hex(), "type": "logic", "value": logic("Coop rules"),
        "draft": true, "as": c });
    let made = ok(run(&mut w, claude, draft));
    w.lab.sync_all(2);
    let e = text(&made["entry"]);
    assert!(!w.lab.landed(mac, entry_id(&e)), "a draft of the coop's, on her Mac");
}

/// A logic's source, sealed under a key of its own, as a node's store seals it (`Node::store_file`).
fn source(text: &str) -> Brought {
    let (key, plain) = (FileKey::from_bytes([5; 32]), text.repeat(200).into_bytes());
    let root = avendb::hash::hash("a test file's root", &seal(&key, &plain));
    Brought::new(root, key, plain.len() as u64)
}

/// A draft brings its file in its creation (`create` with `draft` and a `file`), one write that starts its line: every
/// reader of the draft opens the file, as a file of that line alone, and Dave's Mac, which keeps it, opens none. Its
/// main line brings none and the feed lists none until her vault lands it, when the file is main's, as all the line
/// holds, and the feed lists it with the entry. agentClaude brings no file into the draft's main line meanwhile, which
/// holds nothing, nor into main once it landed, which a Suggester never sets.
#[test]
fn a_draft_brings_its_file_on_its_line_and_lands_it_with_the_line() {
    let mut g = gate();
    let (a, c) = (g.alice.to_hex(), g.agent.to_hex());
    let file = source("export default (x) => x;\n");
    let (root, len) = (file.root, file.len);
    let op = json!({ "op": "create", "vault": a, "type": "logic", "tags": [GAME], "value": logic("Harvest rules"),
        "draft": true, "file": { "len": len, "name": "rules.js", "media": "text/javascript" }, "as": c });
    assert_eq!(ok(g.run(g.claude, json!({ "op": "may", "ops": [op] }))), json!([true]), "it may draft one");
    let made = ok(engine::put_file(&mut g.w.lab, g.claude, &op, file));
    let (e, line) = (text(&made["entry"]), text(&made["line"]));
    assert_eq!((&made["root"], &made["size"]), (&json!(BlobId(root.hash).to_hex()), &json!(root.size)));
    let writes = g.history(g.claude, &e);
    assert_eq!(writes.len(), 1, "one write: {writes:?}");
    assert_eq!((&writes[0]["id"], &writes[0]["kind"]), (&json!(line), &json!("draft")));
    g.sync(1);
    let (entry, on) = (entry_id(&e), Some(edit_id(&line)));
    for d in g.readers() {
        assert_eq!(g.w.lab.line_files(d, entry, on), [(root, Some(len))], "its line's, on {d:?}");
        assert!(g.w.lab.line_files(d, entry, MAIN).is_empty(), "none of main's yet, on {d:?}");
        assert_eq!(g.w.lab.file(d, &root).map(|b| b.len), Some(len), "opened on {d:?}");
        let rows = world::public_entries(&g.w.lab, d, None);
        assert!(!rows.iter().any(|r| r["entry"] == e.as_str()), "the feed lists none, on {d:?}");
    }
    assert_eq!(g.w.lab.file(g.backup, &root), None, "kept, never opened");
    let into = json!({ "op": "put_file", "entry": e, "len": 1, "as": c });
    let asked = ok(g.run(g.claude, json!({ "op": "may", "ops": [into] })));
    assert_eq!(refused(&asked[0]), "NoEntry", "its main line holds nothing yet");
    // her vault accepts it: the line lands, and its file is main's
    let (aip, _) = g.propose("Harvest rules, with their source", &[(&e, &line)]);
    g.sync(2);
    let heads = g.aip(g.mac, &aip)["lines"][0]["heads"].clone();
    ok(g.review(&aip, "accepted", Some(heads)));
    g.sync(3);
    for d in g.readers() {
        assert!(g.landed(d, &e), "on {d:?}");
        assert_eq!(g.w.lab.line_files(d, entry, MAIN), [(root, Some(len))], "main's now, on {d:?}");
    }
    let rows = world::public_entries(&g.w.lab, g.mac, Some(&world::CODE_KINDS[..]));
    let row = rows.into_iter().find(|r| r["entry"] == e.as_str()).expect("in the feed of code once landed");
    assert_eq!(row["files"], json!([{ "root": BlobId(root.hash).to_hex(), "size": root.size, "len": len }]));
    let asked = ok(g.run(g.claude, json!({ "op": "may", "ops": [into] })));
    assert_eq!(refused(&asked[0]), "NotAllowed", "a Suggester sets nothing on main");
}
