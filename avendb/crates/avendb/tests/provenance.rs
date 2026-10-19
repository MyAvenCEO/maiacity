//! Provenance (H2 of maiaCITY's hardening plan, `avendb::provenance`): which code is Maia City's is proven on the
//! device that runs it, never taken on a server's word. Alice's claim founded the seed, so Maia City is hers: its
//! views, a game's config read through the vault's own schema, and a recipe whose versions each bring their file, all
//! public by type; a story beside them, public too, and a private note. Bob is a Viewer of the code, Dave a Suggester
//! of the recipes, and the server keeps the vault (Backup). The server hands out what proves the code (`proof`), and
//! an observer, a device of no vault anchored to Maia City by its id, takes it as any device takes a reply and reads
//! back the rows the feed serves, and nothing else: a forged edit, a write the vault never signed, one by someone its
//! shares don't let write there, or another vault that calls itself Maia City, is in no row it reads, and a file is
//! held to the write that brought it.

use std::collections::BTreeSet;
use std::time::Instant;

use avendb::cast::{self, World};
use avendb::engine;
use avendb::id::{BlobId, EditId, EntryId, SignerId, VaultId};
use avendb::keys::KeyFam;
use avendb::policy::{Action, Kind, Principal, Proposal};
use avendb::provenance::{self, Observer, Unproven, CODE_KINDS, STRANGER};
use avendb::sealed::{seal, Brought, FileKey, FileRoot};
use avendb::sign::Signed;
use avendb::sync;
use avendb::wire::{Reply, Wire as _};
use avendb::world;
use serde_json::{json, Value};

fn run(w: &mut World, d: SignerId, op: &Value) -> Value {
    engine::run(&mut w.lab, d, op)
}

/// What an op answered, which it must have done.
fn ok(answer: Value) -> Value {
    assert!(answer.get("ok").is_some(), "refused: {answer}");
    answer["ok"].clone()
}

fn entry_id(answer: &Value) -> EntryId {
    EntryId::from_hex(answer["entry"].as_str().expect("an entry")).expect("an entry's id")
}

/// A recipe's source, sealed under a key of its own, its root iroh's BLAKE3 of its one sealed piece, as a node's store
/// names it (avendb-net's `Node::store_file`).
fn source(text: &str) -> (Brought, Vec<u8>) {
    let (key, plain) = (FileKey::from_bytes([7; 32]), text.repeat(40).into_bytes());
    let root = *blake3::hash(&seal(&key, &plain)).as_bytes();
    (Brought::new(root, key, plain.len() as u64), plain)
}

/// A view as the app's loader copies one in (game/code/sources/avendb.js `recordOf`).
fn view(title: &str, html: &str) -> Value {
    json!({ "kind": "view", "title": title, "note": "", "form": "html", "source": html,
        "engine": { "host": "view", "version": 2, "hash": "ab".repeat(32) }, "manifest": { "libs": [], "slots": [] } })
}

/// A recipe as the asset box keeps one (src/lib/assets/sources/avendb.js `recipeEntryOf`): its card, its source empty.
fn recipe(label: &str, version: u64) -> Value {
    json!({ "kind": "recipe", "title": label, "note": "", "source": "",
        "engine": { "host": "box", "version": 4, "hash": "cd".repeat(32) }, "manifest": { "libs": ["kit"] },
        "params": [], "contract": { "budgets": { "ms": 20000 }, "invariants": ["hash", "card", "budget"] },
        "card": { "format": "asset-card", "v": 1, "group": "machines", "id": "lamp", "label": label,
            "version": version } })
}

/// The schema of a game's settings, as Maia City holds it (src/lib/avendb/seed.js `CONFIG_V1`).
const CONFIG_V1: &str = concat!(
    r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","title":"Config, v1","type":"object","#,
    r#""properties":{"kind":{"const":"config"},"title":{"type":"string","maxLength":160},"#,
    r#""note":{"type":"string","maxLength":2000,"default":""},"data":{"type":"object"}},"#,
    r#""required":["kind","title","data"]}"#
);

/// Maia City as Alice's claim founded it, holding code.
struct City {
    w: World,
    city: VaultId,
    mac: SignerId,
    /// Two views, a config and a recipe, the code; a story and a note beside them.
    views: [EntryId; 2],
    config: EntryId,
    lamp: EntryId,
    story: EntryId,
    note: EntryId,
    /// The recipe's files, each its root and its bytes: version 1's, version 2's.
    files: Vec<(FileRoot, Vec<u8>)>,
}

/// Maia City, its code public by type, Bob a Viewer of it, Dave a Suggester of its recipes, the server keeping it all.
fn city() -> City {
    let mut w = cast::world();
    let city = world::seed_of(&w.lab, w.mac_a)[0];
    let (mac, c) = (w.mac_a, city.to_hex());
    let code = json!({ "type": ["view", "config", "recipe"] });
    let shares = [
        (json!({ "vault": w.avenceo.to_hex() }), json!("Backup"), Value::Null),
        (json!("everyone"), json!("Public"), code.clone()),
        (json!("everyone"), json!("Public"), json!({ "type": ["story"] })),
        (json!({ "vault": w.bob.to_hex() }), json!("Viewer"), code.clone()),
        (json!({ "vault": w.dave.to_hex() }), json!("Suggester"), json!({ "type": ["recipe"] })),
    ];
    for (who, level, what) in shares {
        let mut op = json!({ "op": "share", "over": c, "who": who, "level": level, "as": c });
        if !what.is_null() {
            op["what"] = what;
        }
        ok(run(&mut w, mac, &op));
    }
    let create = |ty: &str, tags: &[&str], value: Value| {
        json!({ "op": "create", "vault": c, "type": ty, "schema": ty, "tags": tags, "value": value, "as": c })
    };
    let chart = entry_id(&ok(run(&mut w, mac, &create("view", &["ref:views/coop-chart"], view("Chart", "<p>1</p>")))));
    let scene = entry_id(&ok(run(&mut w, mac, &create("view", &["ref:views/scene"], view("Scene", "<p>a</p>")))));
    // a new version of the chart, on main, as an editor of the vault writes one
    let set = json!({ "op": "set", "entry": chart.to_hex(), "path": ["source"], "value": "<p>2</p>", "as": c });
    ok(run(&mut w, mac, &set));
    ok(run(&mut w, mac, &json!({ "op": "create", "vault": c, "type": "schema", "value": CONFIG_V1, "as": c })));
    let settings = json!({ "kind": "config", "title": "Rules", "note": "", "data": { "hearts": 3 } });
    // as the seed writes it: no schema named, the vault's own "Config, v1" reads it (src/lib/avendb/seed.js `seeding`)
    let mut config = create("config", &["ref:configs/sandbox-5/rules", "game:sandbox-5"], settings);
    config.as_object_mut().expect("an op").remove("schema");
    let config = entry_id(&ok(run(&mut w, mac, &config)));
    // the recipe: version 1 created with its file, version 2 a proposal whose one write brings its own, merged
    let (one, one_bytes) = source("export default (kit) => kit.box(1, 1, 1);\n");
    let mut lamp = create("recipe", &["ref:machines/lamp@1"], recipe("Lamp", 1));
    lamp["file"] = json!({ "len": one.len, "name": "lamp.js", "media": "text/javascript" });
    let lamp = entry_id(&ok(engine::put_file(&mut w.lab, mac, &lamp, one.clone())));
    let propose = json!({ "op": "propose", "entry": lamp.to_hex(), "name": "v2", "as": c });
    let line = ok(run(&mut w, mac, &propose))["line"].clone();
    let (two, two_bytes) = source("export default (kit) => kit.box(2, 1, 1);\n");
    let put = json!({ "op": "put_file", "entry": lamp.to_hex(), "line": line, "value": recipe("Lamp", 2),
        "len": two.len, "as": c });
    ok(engine::put_file(&mut w.lab, mac, &put, two.clone()));
    ok(run(&mut w, mac, &json!({ "op": "merge", "entry": lamp.to_hex(), "from": line, "into": null, "as": c })));
    // a story and a note, each a document
    let document = |ty: &str, title: &str| {
        let block = json!({ "id": 1, "type": "paragraph", "text": "." });
        let value = json!({ "kind": "document", "title": title, "blocks": [block] });
        json!({ "op": "create", "vault": c, "type": ty, "value": value, "as": c })
    };
    let story = entry_id(&ok(run(&mut w, mac, &document("story", "A story"))));
    let note = entry_id(&ok(run(&mut w, mac, &document("note", "Private"))));
    w.lab.sync_all(1);
    let files = vec![(one.root, one_bytes), (two.root, two_bytes)];
    City { w, city, mac, views: [chart, scene], config, lamp, story, note, files }
}

impl City {
    /// The code entries of Maia City device `d` reads that everyone may read: what the server's feed lists
    /// (`world::public_entries`).
    fn code(&self, d: SignerId) -> BTreeSet<EntryId> {
        let rows = world::public_entries(&self.w.lab, d, Some(&CODE_KINDS));
        let ours = rows.iter().filter(|r| r["vault"] == self.city.to_hex());
        ours.map(|r| EntryId::from_hex(r["entry"].as_str().expect("an entry")).expect("an id")).collect()
    }

    /// What proves Maia City's code, as device `d` holds it.
    fn proof(&self, d: SignerId) -> Vec<Signed> {
        provenance::proof(&self.w.lab, d, self.city, &self.code(d))
    }
}

/// A row as the feed serves it, less what a stranger names otherwise: the names of its vault and its authors, which
/// it reads off profiles it isn't sent, and the seed, which it doesn't know.
fn shown(mut row: Value) -> Value {
    let fields = row.as_object_mut().expect("a row");
    for name in ["name", "seed", "authors"] {
        fields.remove(name);
    }
    for b in fields.get_mut("brought").and_then(Value::as_array_mut).into_iter().flatten() {
        b.as_object_mut().expect("a version").remove("authors");
    }
    row
}

/// The rows of vault `v`'s code device `d` reads, as `shown`.
fn rows_on(lab: &avendb::lab::Lab, d: SignerId, v: VaultId) -> Vec<Value> {
    let rows = world::public_entries(lab, d, Some(&CODE_KINDS)).into_iter().filter(|r| r["vault"] == v.to_hex());
    rows.map(shown).collect()
}

/// The rows an observer anchored to `v` reads off `edits`.
fn observed(edits: Vec<Signed>, v: VaultId) -> Result<Vec<Value>, Unproven> {
    provenance::verify(&provenance::reply(edits), v, &CODE_KINDS).map(|rows| rows.into_iter().map(shown).collect())
}

/// Each row's entry and its record's source or settings: what a loader runs.
fn sources(rows: &[Value]) -> Vec<(String, Value)> {
    let of = |r: &Value| (r["entry"].as_str().unwrap_or_default().to_string(), r["record"]["source"].clone());
    rows.iter().map(of).collect()
}

/// What the server hands out proves Maia City's code, and the observer reads back exactly the rows the server's feed
/// serves: each view at its newest version, the config read through the vault's own schema, the recipe with both its
/// versions and their files. It is a part of what a stranger that follows Maia City may receive, so no key and nothing
/// private, and of that only the code: no edit of the story's log, nor of the note's.
#[test]
fn the_observer_reads_the_rows_the_feed_serves() {
    let c = city();
    let server = c.w.server;
    let code = c.code(server);
    let want: BTreeSet<EntryId> = [c.views[0], c.views[1], c.config, c.lamp].into_iter().collect();
    assert_eq!(code, want, "the server lists the code alone");
    let proof = c.proof(server);
    let rows = observed(proof.clone(), c.city).expect("it proves the vault");
    assert_eq!(rows, rows_on(&c.w.lab, server, c.city), "the rows the server's feed serves");
    assert_eq!(rows, rows_on(&c.w.lab, c.mac, c.city), "and those Alice reads");
    let chart = rows.iter().find(|r| r["entry"] == c.views[0].to_hex()).expect("the chart");
    assert_eq!(chart["record"]["source"], "<p>2</p>", "its newest version");
    let config = rows.iter().find(|r| r["entry"] == c.config.to_hex()).expect("the config");
    assert_eq!(config["record"]["data"], json!({ "hearts": 3 }), "read through the vault's own schema");
    let lamp = rows.iter().find(|r| r["entry"] == c.lamp.to_hex()).expect("the recipe");
    assert_eq!(lamp["record"]["card"]["version"], 2);
    assert_eq!(lamp["brought"].as_array().map(Vec::len), Some(2), "each version and its file");
    // a part of what a stranger that follows Maia City may receive
    let log = c.w.lab.log(server);
    let stranger: BTreeSet<EditId> = sync::respond(log.edits(), STRANGER, &[c.city]).iter().map(|e| e.id()).collect();
    assert!(proof.iter().all(|s| stranger.contains(&s.edit.id())), "nothing a stranger may not receive");
    let entry_of = |s: &Signed| s.edit.entry();
    assert!(proof.iter().all(|s| entry_of(s) != Some(c.story) && entry_of(s) != Some(c.note)), "the code alone");
    assert!(stranger.iter().any(|&id| c.w.lab.signed_edit(server, id).and_then(entry_of) == Some(c.story)));
    // the same proof from any device that holds it, and named by its edits alone
    let from_alice = c.proof(c.mac);
    assert_eq!(provenance::frontier(&from_alice), provenance::frontier(&proof));
    let mut shuffled = proof.clone();
    shuffled.reverse();
    assert_eq!(provenance::frontier(&shuffled), provenance::frontier(&proof));
    // a proof of one entry alone proves it alone
    let one = provenance::proof(&c.w.lab, server, c.city, &[c.lamp].into_iter().collect());
    let rows = observed(one.clone(), c.city).expect("it proves the vault");
    assert_eq!(rows.iter().map(|r| r["entry"].clone()).collect::<Vec<_>>(), [json!(c.lamp.to_hex())]);
    assert!(one.len() < proof.len());
}

/// A forged edit is refused: one whose signature isn't its signer's, or whose bytes changed after it was signed, never
/// counts, so the row reads as if the server had never handed it out; a forged creation leaves the entry out.
#[test]
fn a_forged_edit_is_refused() {
    let c = city();
    let proof = c.proof(c.w.server);
    let honest = observed(proof.clone(), c.city).expect("it proves the vault");
    // the chart's second version, its signature changed
    let writes: Vec<usize> = (0..proof.len()).filter(|&i| proof[i].edit.entry() == Some(c.views[0])).collect();
    let (first, last) = (writes[0], *writes.last().expect("its writes"));
    let mut forged = proof.clone();
    forged[last].sigs[0].pq[100] ^= 1;
    let rows = observed(forged, c.city).expect("it proves the vault");
    let chart = rows.iter().find(|r| r["entry"] == c.views[0].to_hex()).expect("the chart");
    assert_eq!(chart["record"]["source"], "<p>1</p>", "its first version alone");
    // its ciphertext changed after it was signed: another edit, whose id nobody signed
    let mut changed = proof.clone();
    if let Action::Write { body, .. } = &mut changed[last].edit.action {
        body[40] ^= 1;
    }
    let rows = observed(changed, c.city).expect("it proves the vault");
    let chart = rows.iter().find(|r| r["entry"] == c.views[0].to_hex()).expect("the chart");
    assert_eq!(chart["record"]["source"], "<p>1</p>");
    // its creation forged: no chart at all, and of the rest nothing but what the honest proof proves, though the edits
    // after it that build on it wait for it, as a device holds back what it can't place yet
    let mut forged = proof.clone();
    forged[first].sigs[0].pq[7] ^= 1;
    let rows = observed(forged, c.city).expect("it proves the vault");
    assert!(rows.iter().all(|r| r["entry"] != c.views[0].to_hex()), "no chart");
    assert!(rows.iter().all(|r| honest.contains(r)), "nothing else changed");
}

/// A record the vault never signed counts for nothing. A server that hands out rows of its own making has no
/// signature to hand out with them; one that signs a write into Maia City's chart with its own device, acting for Maia
/// City, which no key of its owners signed, has it refused by the rules every reader applies; and a vault Bob founds
/// and names Maia City, with its own public views, is not the vault the observer is anchored to, whatever it calls
/// itself.
#[test]
fn a_record_the_vault_never_signed_counts_for_nothing() {
    let mut c = city();
    let proof = c.proof(c.w.server);
    let honest = observed(proof.clone(), c.city).expect("it proves the vault");
    // the server's device signs a write into the chart as Maia City's
    let server = c.w.server;
    let city = c.city;
    let unsigned = written(&mut c, server, city);
    assert!(unsigned.verify().is_ok(), "its signature is the server's own");
    let rows = observed([proof.clone(), vec![unsigned]].concat(), c.city).expect("it proves the vault");
    assert_eq!(rows, honest, "it counts for no reader");
    // a coop Bob founds and names Maia City, its views public as the real one's
    let (mac, passkey) = (c.w.mac_b, c.w.passkey_b);
    let owners = vec![Principal::Vault(c.w.bob)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 1, root: None, nonce: 41, seal_to: vec![] };
    let fake = VaultId::from(c.w.lab.submit(mac, &[passkey], genesis).expect("anyone founds a vault"));
    let f = fake.to_hex();
    ok(run(&mut c.w, mac, &json!({ "op": "profile", "vault": f, "name": world::SEED_COOP })));
    let public = json!({ "op": "share", "over": f, "who": "everyone", "level": "Public", "what": { "type": ["view"] },
        "as": f });
    ok(run(&mut c.w, mac, &public));
    let theirs = json!({ "op": "create", "vault": f, "type": "view", "schema": "view", "tags": ["ref:views/coop-chart"],
        "value": view("Chart", "<script>steal()</script>"), "as": f });
    let theirs = entry_id(&ok(run(&mut c.w, mac, &theirs)));
    let fakes = provenance::proof(&c.w.lab, mac, fake, &[theirs].into_iter().collect());
    assert!(!fakes.is_empty());
    let mixed = [proof.clone(), fakes.clone()].concat();
    assert_eq!(observed(mixed.clone(), c.city).expect("it proves the vault"), honest, "Maia City's rows alone");
    assert_eq!(observed(fakes, c.city), Err(Unproven::NoVault), "it proves no Maia City");
    // anchored to Bob's coop, it reads Bob's view: the anchor is the id, never the name
    let theirs_rows = observed(mixed, fake).expect("it proves Bob's coop");
    assert_eq!(sources(&theirs_rows), [(theirs.to_hex(), json!("<script>steal()</script>"))]);
}

/// A write into Maia City's chart on main, signed by device `d` acting for vault `actor`, past every check a device
/// makes before it signs (`Lab::sign_unchecked`): an edit on Maia City's log that its rules alone judge.
fn written(c: &mut City, d: SignerId, actor: VaultId) -> Signed {
    let st = c.w.lab.state(c.mac);
    let en = st.entry(c.views[0]).expect("the chart");
    let epoch = st.epoch(KeyFam::Audience(c.city, en.audience()));
    let write = cast::write(c.city, c.views[0], actor, en.stay(), epoch);
    c.w.lab.sign_unchecked(d, &[d], write).expect("its device signs it")
}

/// A write by someone whose shares don't let them write there counts for nothing, though their own device signed it:
/// Bob, a Viewer, writes the chart on main, which his app refuses and a device of his signs all the same; Dave, a
/// Suggester, merges his own proposal of the recipe into main in a patched app, which no accept of the vault's let
/// through (M2). The server keeps both, as it keeps every edit it may hold, and hands them out; the observer counts
/// neither, as no reader does.
#[test]
fn a_write_without_the_right_counts_for_nothing() {
    let mut c = city();
    let honest = observed(c.proof(c.w.server), c.city).expect("it proves the vault");
    let (bob, dave) = (c.w.mac_b, c.w.mac_d);
    let set = json!({ "op": "set", "entry": c.views[0].to_hex(), "path": ["source"],
        "value": "<script>steal()</script>", "as": c.w.bob.to_hex() });
    let refused = run(&mut c.w, bob, &set);
    assert!(refused.get("refused").is_some(), "a Viewer writes nothing: {refused}");
    let actor = c.w.bob;
    let bobs = written(&mut c, bob, actor);
    let d = c.w.dave.to_hex();
    let line = ok(run(&mut c.w, dave, &json!({ "op": "propose", "entry": c.lamp.to_hex(), "name": "v3", "as": d })));
    let line = line["line"].clone();
    let (three, _) = source("export default (kit) => steal();\n");
    let put = json!({ "op": "put_file", "entry": c.lamp.to_hex(), "line": line, "value": recipe("Lamp", 3),
        "len": three.len, "as": d });
    ok(engine::put_file(&mut c.w.lab, dave, &put, three));
    let merge = json!({ "op": "merge", "entry": c.lamp.to_hex(), "from": line, "into": null, "as": d });
    let made = c.w.lab.patched(|lab| engine::run(lab, dave, &merge));
    assert!(made.get("ok").is_some(), "a patched app merges it all the same: {made}");
    c.w.lab.sync_all(2);
    // the server keeps both, Bob's handed to it as a patched app would
    c.w.lab.receive(c.w.server, vec![bobs.clone()], vec![]);
    let proof = c.proof(c.w.server);
    let ids: BTreeSet<EditId> = proof.iter().map(|s| s.edit.id()).collect();
    assert!(ids.contains(&bobs.edit.id()), "the server hands out Bob's");
    let daves = proof.iter().filter(|s| s.edit.entry() == Some(c.lamp) && s.edit.author == dave).count();
    assert!(daves >= 3, "and Dave's proposal, its write and its merge");
    let rows = observed(proof, c.city).expect("it proves the vault");
    assert_eq!(rows, honest, "and they count for nothing");
    let lamp = rows.iter().find(|r| r["entry"] == c.lamp.to_hex()).expect("the recipe");
    assert_eq!(lamp["record"]["card"]["version"], 2, "version 2 is main's");
}

/// A file is held to the write that brought it: the bytes the vault's counted write sealed to its root pass, and bytes
/// that differ by one, run short, or are of another root, or a root no counted write brought, don't.
#[test]
fn a_file_is_held_to_the_write_that_brought_it() {
    let c = city();
    let mut observer = Observer::new(c.city);
    assert!(observer.take_wire(&provenance::reply(c.proof(c.w.server))).expect("a reply") > 0);
    let [(one, one_bytes), (two, two_bytes)] = [c.files[0].clone(), c.files[1].clone()];
    assert!(observer.holds(&one, &one_bytes) && observer.holds(&two, &two_bytes), "each version's own file");
    let mut changed = two_bytes.clone();
    changed[3] ^= 1;
    assert!(!observer.holds(&two, &changed), "a byte changed");
    assert!(!observer.holds(&two, &two_bytes[..two_bytes.len() - 1]), "one byte short");
    assert!(!observer.holds(&two, &one_bytes), "another version's file");
    let (other, other_bytes) = source("export default () => null;\n");
    assert!(!observer.holds(&other.root, &other_bytes), "a file no write of the vault brought");
    // the rows name each file by its root, as the feed serves it
    let rows = observer.rows(&CODE_KINDS).expect("it proves the vault");
    let lamp = rows.iter().find(|r| r["entry"] == c.lamp.to_hex()).expect("the recipe");
    let roots: Vec<Value> = lamp["files"].as_array().expect("its files").iter().map(|f| f["root"].clone()).collect();
    assert_eq!(roots, [json!(BlobId(one.hash).to_hex()), json!(BlobId(two.hash).to_hex())]);
}

/// The anchor is the vault's id: bytes that are no reply prove nothing, and a reply that holds no vault of that id
/// proves no rows, as one that holds nothing at all.
#[test]
fn what_proves_no_vault_of_its_id_is_refused() {
    let c = city();
    let bytes = provenance::reply(c.proof(c.w.server));
    assert!(matches!(provenance::verify(&bytes[..bytes.len() - 1], c.city, &CODE_KINDS), Err(Unproven::Wire(_))));
    assert!(matches!(provenance::verify(b"{\"code\": []}", c.city, &CODE_KINDS), Err(Unproven::Wire(_))));
    assert_eq!(provenance::verify(&provenance::reply(vec![]), c.city, &CODE_KINDS), Err(Unproven::NoVault));
    assert_eq!(provenance::verify(&bytes, VaultId([5; 32]), &CODE_KINDS), Err(Unproven::NoVault));
    let reply = Reply::from_wire(&bytes).expect("a reply");
    assert!(!reply.more && reply.blobs.is_empty(), "no McEliece key, nothing more to ask for");
}

/// How big a proof of many recipes is, and how long it takes to check: `cargo test -p avendb --release --test
/// provenance -- --ignored --nocapture measure`, `AVENDB_RECIPES` recipes (24 by default), each created with its file
/// and given two more versions as the seed writes them (a proposal, its write, its merge), and a tag.
#[test]
#[ignore = "a measurement, run by hand"]
fn measure() {
    let n: usize = std::env::var("AVENDB_RECIPES").ok().and_then(|n| n.parse().ok()).unwrap_or(24);
    let mut c = city();
    let (mac, cc) = (c.mac, c.city.to_hex());
    let card = |i: usize, v: u64| {
        let mut r = recipe(&format!("Lamp {i}"), v);
        r["card"]["id"] = json!(format!("lamp-{i}"));
        // a card as large as the repo's are, about 3 kB (src/lib/assets/sources/cards.json)
        r["card"]["note"] = json!("x".repeat(3000));
        r
    };
    let t = Instant::now();
    for i in 0..n {
        let (one, _) = source(&format!("export default (kit) => kit.box({i}, 1, 1);\n"));
        let op = json!({ "op": "create", "vault": cc, "type": "recipe", "schema": "recipe", "tags": ["group:machines"],
            "value": card(i, 1), "file": { "len": one.len, "name": "x.js", "media": "text/javascript" }, "as": cc });
        let e = entry_id(&ok(engine::put_file(&mut c.w.lab, mac, &op, one)));
        for v in 2..=3 {
            let line = ok(run(&mut c.w, mac, &json!({ "op": "propose", "entry": e.to_hex(), "name": "v", "as": cc })));
            let (file, _) = source(&format!("export default (kit) => kit.box({i}, {v}, 1);\n"));
            let put = json!({ "op": "put_file", "entry": e.to_hex(), "line": line["line"], "value": card(i, v),
                "len": file.len, "as": cc });
            ok(engine::put_file(&mut c.w.lab, mac, &put, file));
            let merge = json!({ "op": "merge", "entry": e.to_hex(), "from": line["line"], "into": null, "as": cc });
            ok(run(&mut c.w, mac, &merge));
        }
        ok(run(&mut c.w, mac, &json!({ "op": "tag", "entry": e.to_hex(), "add": [format!("ref:machines/lamp-{i}@3")],
            "as": cc })));
    }
    eprintln!("made {n} recipes in {:?}", t.elapsed());
    c.w.lab.sync_all(5);
    let server = c.w.server;
    let rows = world::public_entries(&c.w.lab, server, Some(&["recipe"]));
    let recipes: BTreeSet<EntryId> =
        rows.iter().filter_map(|r| EntryId::from_hex(r["entry"].as_str()?)).collect();
    let feed = serde_json::to_vec(&json!({ "code": rows })).expect("JSON").len();
    let t = Instant::now();
    let proof = provenance::proof(&c.w.lab, server, c.city, &recipes);
    let made = t.elapsed();
    let bytes = provenance::reply(proof.clone());
    let on_main = |s: &&Signed| matches!(s.edit.action, Action::Write { proposal: Proposal::Main, .. });
    let writes = proof.iter().filter(on_main).count();
    let t = Instant::now();
    let rows = provenance::verify(&bytes, c.city, &["recipe"]).expect("it proves the vault");
    let checked = t.elapsed();
    let one = provenance::proof(&c.w.lab, server, c.city, &recipes.iter().take(1).copied().collect());
    let views = provenance::proof(&c.w.lab, server, c.city, &c.views.into_iter().chain([c.config]).collect());
    eprintln!(
        "{} recipes: the feed's JSON {feed} bytes; the proof {} edits ({writes} writes on main), {} bytes, worked out \
         in {made:?}, checked in {checked:?}; one recipe's proof {} edits, {} bytes; the views and config {} edits, \
         {} bytes",
        rows.len(),
        proof.len(),
        bytes.len(),
        one.len(),
        provenance::reply(one.clone()).len(),
        views.len(),
        provenance::reply(views.clone()).len(),
    );
    std::fs::write(std::env::temp_dir().join("avendb-proof.bin"), &bytes).expect("written");
    eprintln!("city {}", c.city.to_hex());
}
