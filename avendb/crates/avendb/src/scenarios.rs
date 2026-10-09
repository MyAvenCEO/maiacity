//! The plan's acceptance scenarios on the Lab, numbered as in the plan, each tagged with the phase that turned it
//! green. Each records what it checks, green or red (`Run`): `tests/scenarios.rs` runs every one and fails on any red
//! check, and the avenDB tile's Lab runs them one by one and shows each check. `avendb/spec/AvenDB/Examples.lean` runs
//! the same scenarios on the Lean model.

use std::collections::BTreeSet;
use std::fmt::Debug;

use serde_json::{json, Value};

use crate::branch::MAIN;
use crate::cast::*;
use crate::id::{GrantId, SignerId, SpaceId, VaultId};
use crate::keys::{KeyName, KeyScope};
use crate::lab::{Lab, Tamper};
use crate::lens::{Status, DOCUMENT_LENS, DOCUMENT_V1, DOCUMENT_V2};
use crate::policy::{Action, Grantee, Kind, Principal, Refusal, Role, Scope};

/// One scenario of the plan.
pub struct Scenario {
    /// As the plan numbers it; a second scenario under the same number gets a letter.
    pub number: &'static str,
    pub title: &'static str,
    /// The phase that turned it green.
    pub phase: &'static str,
    play: fn(&mut Run) -> Done,
}

impl Scenario {
    /// Play it on a Lab of its own.
    pub fn run(&self) -> Run {
        let mut run = Run::default();
        let _ = (self.play)(&mut run);
        run
    }
}

/// One check of a scenario: what it checks, whether it held, and what was found instead where it didn't.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Check {
    pub what: String,
    pub ok: bool,
    pub found: Option<String>,
}

/// What a scenario checked, in order, and the step it stopped at if one it needed was refused.
#[derive(Clone, Debug, Default)]
pub struct Run {
    pub checks: Vec<Check>,
    pub stopped: Option<String>,
}

/// A scenario stopped short: a step it needed was refused, or something it goes on with isn't there.
#[derive(Debug)]
pub struct Stop;

pub type Done = Result<(), Stop>;

impl Run {
    /// Check that something holds.
    pub fn check(&mut self, what: impl Into<String>, ok: bool) -> bool {
        self.checks.push(Check { what: what.into(), ok, found: None });
        ok
    }

    /// Check that what is `found` is what the scenario expects.
    pub fn same<T: PartialEq + Debug>(&mut self, what: impl Into<String>, found: T, want: T) -> bool {
        let ok = found == want;
        self.checks.push(Check { what: what.into(), ok, found: (!ok).then(|| format!("{found:?}, not {want:?}")) });
        ok
    }

    /// A step the scenario takes: what it made, or a stop with the refusal noted.
    pub fn ok<T>(&mut self, what: impl Into<String>, step: Result<T, Refusal>) -> Result<T, Stop> {
        let what = what.into();
        match step {
            Ok(made) => {
                self.check(what, true);
                Ok(made)
            }
            Err(why) => self.stop(what, format!("refused: {why:?}")),
        }
    }

    /// A step taken again and again, noted only if it is refused, which stops the scenario.
    pub fn must<T>(&mut self, what: impl Into<String>, step: Result<T, Refusal>) -> Result<T, Stop> {
        step.or_else(|why| self.stop(what.into(), format!("refused: {why:?}")))
    }

    /// Something the scenario goes on with: it, or a stop where it isn't there.
    pub fn some<T>(&mut self, what: impl Into<String>, found: Option<T>) -> Result<T, Stop> {
        let what = what.into();
        match found {
            Some(x) => {
                self.check(what, true);
                Ok(x)
            }
            None => self.stop(what, "nothing there".into()),
        }
    }

    fn stop<T>(&mut self, what: String, found: String) -> Result<T, Stop> {
        self.checks.push(Check { what: what.clone(), ok: false, found: Some(found) });
        self.stopped = Some(what);
        Err(Stop)
    }

    /// Every check held, and the scenario ran to its end.
    pub fn passed(&self) -> bool {
        self.stopped.is_none() && self.checks.iter().all(|c| c.ok)
    }

    /// Each check that didn't hold, one per line, with what was found instead.
    pub fn failures(&self) -> String {
        let failed = self.checks.iter().filter(|c| !c.ok);
        failed.map(|c| format!("{}: {}", c.what, c.found.as_deref().unwrap_or("no"))).collect::<Vec<_>>().join("\n")
    }
}

/// Every scenario, in the plan's order.
pub static SCENARIOS: [Scenario; 21] = [
    Scenario { number: "1", title: "Alice's vault", phase: "P1", play: alices_vault },
    Scenario { number: "1b", title: "A new device reaches every device", phase: "P2", play: a_new_device_reaches_all },
    Scenario { number: "2", title: "Bob, Carol and Dave", phase: "P1", play: bob_carol_and_dave },
    Scenario { number: "3", title: "A coop of two", phase: "P1", play: a_coop_of_two },
    Scenario { number: "3b", title: "The coop key opens only on owner devices", phase: "P3", play: the_coop_key },
    Scenario { number: "4", title: "Spaces", phase: "P2", play: spaces },
    Scenario { number: "5", title: "Write and sync", phase: "P3", play: write_and_sync },
    Scenario { number: "6", title: "One document via caps", phase: "P3", play: one_document_via_caps },
    Scenario { number: "7", title: "Public", phase: "P3", play: public },
    Scenario { number: "8", title: "Branches", phase: "P5", play: branches },
    Scenario { number: "9", title: "Schema v2", phase: "P4", play: schema_v2 },
    Scenario { number: "10", title: "Revoke Carol", phase: "P3", play: revoke_carol },
    Scenario { number: "11", title: "Lost iPhone", phase: "P3", play: lost_iphone },
    Scenario { number: "12", title: "Bob leaves", phase: "P3", play: bob_leaves },
    Scenario { number: "13", title: "Offline conflicts", phase: "P6", play: offline_conflicts },
    Scenario { number: "14", title: "Tampering", phase: "P3", play: tampering },
    Scenario { number: "15", title: "Social todo", phase: "P3", play: social_todo },
    Scenario { number: "16", title: "Roles change on one todo", phase: "P3", play: roles_change },
    Scenario { number: "17", title: "Peer to peer", phase: "P6", play: peer_to_peer },
    Scenario { number: "18", title: "Recovery after losing every device", phase: "P3", play: recovery },
    Scenario {
        number: "18b",
        title: "A backup passkey, when the passkey is lost too",
        phase: "P4b",
        play: backup_passkey,
    },
];

/// The scenario numbered `number`.
pub fn scenario(number: &str) -> Option<&'static Scenario> {
    SCENARIOS.iter().find(|s| s.number == number)
}

/// A signer by the name the Lab made it with.
fn named(lab: &Lab, s: SignerId) -> String {
    lab.name(s).unwrap_or("a device").to_string()
}

fn alices_vault(run: &mut Run) -> Done {
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let (mac, phone) = (lab.device_of(passkey, "Alice's Mac"), lab.device_of(passkey, "Alice's iPhone"));
    let alice = human_on(&mut lab, passkey, &[mac, phone]);
    let genesis = lab.log(mac).ops()[0].clone();
    let first = matches!(genesis.action, Action::Genesis { .. });
    run.check("Alice's Mac holds the genesis of Alice's vault first", first);
    run.same("the vault's id is the hash of its genesis", VaultId::from(genesis.id()), alice);
    let devices = lab.log(mac).view().vault(alice).map(|v| v.devices.clone());
    run.same("the vault lists the Mac and the iPhone", devices, Some(vec![mac, phone]));
    let other = lab.device_of(passkey, "another Mac");
    let add = Action::AddDevice { vault: alice, device: other, seal_to: None };
    let alone = lab.submit(mac, &[mac, other], add).err();
    run.same("the Mac can't add a device on its own, even one that countersigns", alone, Some(Refusal::BelowThreshold));
    Ok(())
}

fn a_new_device_reaches_all(run: &mut Run) -> Done {
    let mut w = world();
    let coop = coop_on(&mut w);
    w.lab.sync_all(1);
    // the iPad's keys derive from the same passkey, and it countersigns
    let ipad = w.lab.device_of(w.passkey_a, "Alice's iPad");
    let add = Action::AddDevice { vault: w.alice, device: ipad, seal_to: None };
    run.ok("Alice's passkey adds an iPad, on Alice's Mac", w.lab.submit(w.mac_a, &[w.passkey_a, ipad], add))?;
    w.lab.sync_all(2);
    for d in [w.phone_a, ipad, w.mac_b] {
        let v = w.lab.log(d).view();
        let who = named(&w.lab, d);
        run.check(format!("{who} learns of the iPad"), v.vault(w.alice).is_some_and(|x| x.devices.contains(&ipad)));
        run.check(format!("{who} sees it act for the coop"), v.acts_for(ipad, coop));
    }
    let carol_knows = w.lab.log(w.mac_c).view().vault(w.alice).map(|x| x.devices.clone());
    let what = "Carol, who shares nothing with Alice yet, keeps the contact card from before";
    run.same(what, carol_knows, Some(vec![w.mac_a, w.phone_a]));
    Ok(())
}

fn bob_carol_and_dave(run: &mut Run) -> Done {
    let w = world();
    for (d, v, who) in [(w.mac_b, w.bob, "Bob"), (w.mac_c, w.carol, "Carol"), (w.mac_d, w.dave, "Dave")] {
        let view = w.lab.log(d).view();
        run.check(format!("{who}'s Mac acts for {who}'s vault"), view.acts_for(d, v));
        let shape = view.vault(v).map(|x| (x.kind, x.owners.len(), x.threshold));
        run.same(
            format!("{who}'s vault is a human vault with one owner, threshold 1"),
            shape,
            Some((Kind::Human, 1, 1)),
        );
    }
    let mut ids = [w.alice, w.bob, w.carol, w.dave];
    ids.sort();
    run.check("every vault has an id of its own", ids.windows(2).all(|p| p[0] != p[1]));
    Ok(())
}

fn a_coop_of_two(run: &mut Run) -> Done {
    let mut w = world();
    let owners = vec![Principal::Vault(w.alice), Principal::Vault(w.bob)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 2, root: None, nonce: 0, seal_to: vec![] };
    let alone = w.lab.submit(w.mac_a, &[w.passkey_a], genesis).err();
    run.same("Bob has to consent to becoming an owner", alone, Some(Refusal::NoConsent));
    let coop = coop_on(&mut w);
    w.lab.sync_all(3);
    let v = w.lab.log(w.mac_b).view();
    run.same("Bob's Mac learns the coop, with threshold 2", v.vault(coop).map(|c| c.threshold), Some(2));
    let acting = v.acts_for(w.mac_b, coop) && v.acts_for(w.mac_a, coop) && v.acts_for(w.phone_a, coop);
    run.check("Bob's Mac acts for the coop through Bob's vault, Alice's devices through Alice's", acting);
    run.check("Carol's Mac and passkey don't", !v.acts_for(w.mac_c, coop) && !v.acts_for(w.passkey_c, coop));
    run.check("Carol's Mac never even receives the coop's log", w.lab.log(w.mac_c).view().vault(coop).is_none());
    Ok(())
}

fn the_coop_key(run: &mut Run) -> Done {
    let mut w = world();
    let coop = coop_on(&mut w);
    w.lab.sync_all(3);
    for d in [w.mac_b, w.mac_a, w.phone_a] {
        run.check(format!("{} opens the coop's key", named(&w.lab, d)), w.lab.opens(d, KeyScope::Vault(coop)));
    }
    for d in [w.mac_c, w.mac_d, w.stranger, w.server] {
        run.check(format!("{} can't", named(&w.lab, d)), !w.lab.opens(d, KeyScope::Vault(coop)));
    }
    Ok(())
}

fn spaces(run: &mut Run) -> Done {
    let mut w = world();
    let coop = coop_on(&mut w);
    let handbook = space_on(&mut w, coop);
    let alice = w.alice;
    let notes = space_on(&mut w, alice);
    w.lab.sync_all(4);
    let v = w.lab.log(w.mac_b).view();
    run.same("Bob's Mac knows the Handbook, founded by the coop", v.space(handbook).map(|s| s.founder), Some(coop));
    let chain = v.acts_for(w.mac_a, w.alice) && v.acts_for(w.mac_a, coop);
    let what = "Bob's Mac checked its founding: Alice's Mac acts for Alice, Alice for Maia Coop, which owns it";
    run.check(what, chain && v.holds(coop, Scope::Space(handbook), Role::Owner));
    run.check("Alice's Notes are Alice's alone: Bob's Mac doesn't even learn they exist", v.space(notes).is_none());
    Ok(())
}

fn write_and_sync(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let read = text(&w.lab, w.mac_b, h.space, h.welcome, 2);
    run.same("Bob's Mac fetched Welcome without being asked, and reads it", read.as_deref(), Some(WELCOME_TEXT));
    run.check("the server holds Welcome's edits", w.lab.fetched(w.server, h.space, h.welcome) > 0);
    let opens = w.lab.opens(w.server, KeyScope::Entry(h.space, h.welcome))
        || w.lab.opens(w.server, KeyScope::Space(h.space));
    run.check("the server opens neither Welcome's key nor the Handbook's", !opens);
    run.check("Welcome's text appears nowhere in the server's store", !contains(&w.lab.store(w.server), WELCOME_TEXT));
    Ok(())
}

fn one_document_via_caps(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let carol = w.carol;
    let read = grant(Scope::Entry(h.space, h.welcome), Role::Read, vault(carol), h.coop, None);
    run.ok("the coop gives Carol read on Welcome only", w.lab.submit(w.mac_a, &[w.mac_a], read))?;
    w.lab.sync_all(6);
    let shown = text(&w.lab, w.mac_c, h.space, h.welcome, 2);
    run.same("Carol's Mac fetches and reads Welcome", shown.as_deref(), Some(WELCOME_TEXT));
    run.same("and never fetches Onboarding", w.lab.fetched(w.mac_c, h.space, h.onboarding), 0);
    let edit = w.lab.edit(w.mac_c, carol, h.space, h.welcome, |i| i.set_text(2, "Carol was here"));
    run.same("Carol's own Mac refuses the edit of Welcome", edit.err(), Some(Refusal::NoCap));
    for d in [w.mac_a, w.mac_b, w.server] {
        let forced = Tamper::Unchecked { signers: vec![w.mac_c], action: write(h.space, h.welcome, carol, 0) };
        let what = format!("{} refuses it when a patched app sends it anyway", named(&w.lab, d));
        run.same(what, w.lab.tamper(d, forced), Err(Refusal::NoCap));
    }
    Ok(())
}

fn public(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let charter = document("Charter", CHARTER_TEXT, w.mac_a);
    let charter = run.ok("the coop writes its Charter", w.lab.create(w.mac_a, h.coop, h.space, charter))?;
    let public = grant(Scope::Entry(h.space, charter), Role::Read, Grantee::Public, h.coop, None);
    run.ok("and makes it public", w.lab.submit(w.mac_a, &[w.mac_a], public))?;
    w.lab.sync_all(7);
    w.lab.sync(w.server, w.stranger);
    for d in [w.stranger, w.server] {
        let who = named(&w.lab, d);
        let shown = text(&w.lab, d, h.space, charter, 2);
        run.same(format!("{who} reads the Charter"), shown.as_deref(), Some(CHARTER_TEXT));
        run.check(format!("{who} reads nothing else, not Welcome"), text(&w.lab, d, h.space, h.welcome, 2).is_none());
    }
    let stranger = w.lab.edit(w.stranger, h.coop, h.space, charter, |i| i.set_text(2, "defaced"));
    run.same("the stranger can't edit it", stranger.err(), Some(Refusal::NotActing));
    let carol = w.carol;
    let edit = w.lab.edit(w.mac_c, carol, h.space, charter, |i| i.set_text(2, "defaced"));
    run.same("nor can Carol, outside the coop", edit.err(), Some(Refusal::NoCap));
    Ok(())
}

fn branches(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let (coop, item) = (h.coop, (h.space, h.welcome));
    let main_text = |lab: &Lab, d| text(lab, d, h.space, h.welcome, 2);
    let heads = |lab: &Lab, line| lab.state(w.mac_a).heads(h.space, h.welcome, line);
    let first = heads(&w.lab, MAIN);
    let draft = w.lab.branch(w.mac_b, coop, item, &first, "Bob's greenhouse draft");
    let draft = run.ok("Bob starts a draft of Welcome", draft)?;
    let edit = w.lab.edit_on(w.mac_b, coop, h.space, h.welcome, Some(draft), |i| i.set_text(2, "Hello, Bob here"));
    run.ok("and edits it there", edit)?;
    w.lab.sync_all(8);
    for d in [w.mac_a, w.phone_a, w.mac_b] {
        let who = named(&w.lab, d);
        run.same(format!("main is unchanged on {who}"), main_text(&w.lab, d).as_deref(), Some(WELCOME_TEXT));
        let on_draft = w.lab.item_on(d, h.space, h.welcome, Some(draft)).and_then(|i| i.as_document());
        let shown = on_draft.and_then(|d| d.blocks.get(1).map(|b| b.text.clone()));
        run.same(format!("{who} shows Bob's edit on the draft"), shown.as_deref(), Some("Hello, Bob here"));
    }
    let name = w.lab.history(w.mac_a, h.space, h.welcome).and_then(|h| h.name(draft));
    run.same(
        "the draft's name travels encrypted, and Alice's Mac reads it",
        name.as_deref(),
        Some("Bob's greenhouse draft"),
    );
    let server = w.lab.store(w.server);
    let blind = !contains(&server, "Bob's greenhouse draft") && !contains(&server, "Hello, Bob here");
    run.check("the server stores the draft and reads neither its name nor its edit", blind);
    let before_merge = heads(&w.lab, MAIN);
    run.ok("Alice merges the draft into main", w.lab.merge(w.mac_a, coop, item, Some(draft), MAIN))?;
    w.lab.sync_all(8);
    run.same(
        "Bob's Mac shows the draft's edit on main",
        main_text(&w.lab, w.mac_b).as_deref(),
        Some("Hello, Bob here"),
    );
    // a second branch is promoted: main ends with exactly its content, though main moved on meanwhile
    let rewrite = w.lab.branch(w.mac_a, coop, item, &heads(&w.lab, MAIN), "rewrite");
    let rewrite = Some(run.ok("Alice starts a second branch, rewrite", rewrite)?);
    let edit = w.lab.edit_on(w.mac_a, coop, h.space, h.welcome, rewrite, |i| i.set_text(2, "Welcome to the coop"));
    run.ok("and rewrites Welcome there", edit)?;
    let meanwhile =
        w.lab.edit(w.mac_b, coop, h.space, h.welcome, |i| i.push_block(paragraph(3, "an edit on main meanwhile")));
    run.ok("meanwhile Bob edits main", meanwhile)?;
    w.lab.sync_all(8);
    run.ok("Alice promotes the rewrite into main", w.lab.promote(w.mac_a, coop, item, rewrite, MAIN))?;
    w.lab.sync_all(8);
    for d in [w.phone_a, w.mac_b] {
        let shown = |line| w.lab.item_on(d, h.space, h.welcome, line).map(|i| i.record());
        run.same(format!("{} shows main exactly as the rewrite", named(&w.lab, d)), shown(MAIN), shown(rewrite));
    }
    let record = run.some("Bob's Mac shows Welcome", w.lab.item(w.mac_b, h.space, h.welcome))?.record().to_string();
    run.check("main no longer holds Bob's edit made meanwhile", !record.contains("meanwhile"));
    // the latest commit is reverted: main goes back to the version it built on
    let good = run.some("Alice's Mac shows Welcome", w.lab.item(w.mac_a, h.space, h.welcome))?.as_document();
    let bad = run.ok("Bob makes a bad edit", w.lab.edit(w.mac_b, coop, h.space, h.welcome, |i| i.set_text(2, "oops")))?;
    w.lab.sync_all(8);
    let latest = w.lab.state(w.mac_a).history(h.space, h.welcome, MAIN).last().map(|w| w.deps.clone());
    let built_on = run.some("main has a latest commit", latest)?;
    run.ok("Alice reverts it", w.lab.restore(w.mac_a, coop, item, MAIN, &built_on))?;
    let now = w.lab.item(w.mac_a, h.space, h.welcome).and_then(|i| i.as_document());
    run.same("main is back to the version that edit built on", now, good);
    // an older bad commit is undone by a diff-based restore, which keeps what came after
    let older = w.lab.edit(w.mac_b, coop, h.space, h.welcome, |i| i.set_text(1, "Welcome!!!"));
    let older = run.ok("Bob makes another bad edit", older)?;
    let later = w.lab.edit(w.mac_b, coop, h.space, h.welcome, |i| i.push_block(paragraph(4, "a later, good edit")));
    run.ok("then a good one", later)?;
    w.lab.sync_all(8);
    run.ok("Alice undoes the older bad edit", w.lab.undo(w.mac_a, coop, item, MAIN, older))?;
    w.lab.sync_all(8);
    let doc = w.lab.item(w.mac_b, h.space, h.welcome).and_then(|i| i.as_document());
    let doc = run.some("Bob's Mac shows Welcome as a document", doc)?;
    let texts: Vec<&str> = doc.blocks.iter().map(|b| b.text.as_str()).collect();
    run.same(
        "the undo keeps the later, good edit",
        texts,
        vec!["Welcome", "Welcome to the coop", "a later, good edit"],
    );
    // no version is lost from history: every write of Welcome is in main's, and any version opens read-only
    let history = run.some("Bob's Mac holds Welcome's history", w.lab.history(w.mac_b, h.space, h.welcome))?;
    run.same("every write of Welcome is in main's history", history.history(MAIN).len(), history.commits().len());
    run.check("the reverted edit is still there", history.commits().iter().any(|c| c.write.op == bad));
    let old = history.item_at(&before_merge, w.mac_b, MAIN).as_document();
    let old = old.and_then(|d| d.blocks.get(1).map(|b| b.text.clone()));
    run.same("the version before the merge opens read-only, as it was", old.as_deref(), Some(WELCOME_TEXT));
    let carol = w.carol;
    let read = grant(Scope::Entry(h.space, h.welcome), Role::Read, vault(carol), coop, None);
    run.ok("the coop gives Carol read on Welcome", w.lab.submit(w.mac_a, &[w.mac_a], read))?;
    w.lab.sync_all(8);
    let mine = w.lab.branch(w.mac_c, carol, item, &first, "mine").err();
    run.same("Carol, who may only read Welcome, can't start a branch of it", mine, Some(Refusal::NoCap));
    let found = w.lab.submit(w.mac_c, &[w.mac_c], Action::FoundSpace { actor: carol, nonce: 8, via: vec![] });
    let mine = SpaceId::from(run.ok("Carol founds a space of their own", found)?);
    let copy = run.ok("and forks Welcome into it", w.lab.fork(w.mac_c, carol, item, MAIN, mine))?;
    let record = |sp, e| w.lab.item(w.mac_c, sp, e).map(|i| i.record());
    run.same("the fork holds Welcome's record", record(mine, copy), record(h.space, h.welcome));
    run.same("and none of its history", w.lab.history(w.mac_c, mine, copy).map(|h| h.commits().len()), Some(1));
    Ok(())
}

fn schema_v2(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let (coop, sp, welcome) = (h.coop, h.space, h.welcome);
    let publish = |blob: &[u8]| Action::Publish { space: sp, actor: coop, via: vec![], blob: blob.to_vec() };
    let v1 = w.lab.submit(w.mac_a, &[w.mac_a], publish(DOCUMENT_V1.bytes()));
    run.ok("Alice publishes v1, the schema Welcome was written under, into the Handbook's lane", v1)?;
    w.lab.sync_all(9);
    let (seen, read_only) =
        run.some("a v2 app on Bob's Mac opens Welcome", w.lab.open(w.mac_b, sp, welcome, &DOCUMENT_V2))?;
    run.check("with no lens to v1 yet, it opens it read-only", read_only);
    run.same("and shows what it can", (&seen["title"], &seen["blocks"]), (&json!("Welcome"), &json!([])));
    let tag = |d: &mut Value| d["tags"] = json!(["greenhouse"]);
    run.same(
        "so it can't edit it",
        w.lab.edit_as(w.mac_b, coop, sp, welcome, &DOCUMENT_V2, tag),
        Err(Refusal::ReadOnly),
    );
    run.ok("Alice publishes v2", w.lab.submit(w.mac_a, &[w.mac_a], publish(DOCUMENT_V2.bytes())))?;
    run.ok("and the lens from v1 to v2", w.lab.submit(w.mac_a, &[w.mac_a], publish(DOCUMENT_LENS.bytes())))?;
    w.lab.sync_all(9);
    let (seen, read_only) =
        run.some("Bob's v2 app opens Welcome again", w.lab.open(w.mac_b, sp, welcome, &DOCUMENT_V2))?;
    run.check("and now may edit it", !read_only);
    let heading = json!({"id": 1, "type": "heading", "level": 1, "text": "Welcome"});
    run.same("it reads Welcome's v1 heading through the lens", seen["blocks"][0].clone(), heading);
    let edit = w.lab.edit_as(w.mac_b, coop, sp, welcome, &DOCUMENT_V2, |d| {
        d["tags"] = json!(["greenhouse"]);
        let item = json!({"id": 3, "type": "item", "checked": false, "text": "Water the seedlings"});
        if let Some(blocks) = d["blocks"].as_array_mut() {
            blocks.push(item);
        }
    });
    run.check("it adds a tag and a checklist item", matches!(edit, Ok(Some(_))));
    w.lab.sync_all(9);
    let (seen, read_only) =
        run.some("a v1 app on Alice's Mac opens Welcome", w.lab.open(w.mac_a, sp, welcome, &DOCUMENT_V1))?;
    run.check("and may edit it", !read_only);
    let v1 = |text: &str| {
        json!({"kind": "document", "title": "Welcome", "blocks": [
            {"id": 1, "kind": "h1", "text": "Welcome"},
            {"id": 2, "kind": "p", "text": text},
            {"id": 3, "kind": "li", "text": "Water the seedlings"}]})
    };
    run.same("it reads its own content as it wrote it, and Bob's item as a list item", seen, v1(WELCOME_TEXT));
    let unchanged = w.lab.edit_as(w.mac_a, coop, sp, welcome, &DOCUMENT_V1, |_| {});
    run.same("its view put back unchanged writes nothing", unchanged, Ok(None));
    let edit = w.lab.edit_as(w.mac_a, coop, sp, welcome, &DOCUMENT_V1, |d| d["blocks"][1]["text"] = json!(AFTER_TEXT));
    run.check("the v1 app edits what it sees", matches!(edit, Ok(Some(_))));
    w.lab.sync_all(9);
    let reread = w.lab.open(w.mac_a, sp, welcome, &DOCUMENT_V1).map(|(v, _)| v);
    run.same("and reads its edit back", reread, Some(v1(AFTER_TEXT)));
    let (seen, _) = run.some("Bob's v2 app opens Welcome", w.lab.open(w.mac_b, sp, welcome, &DOCUMENT_V2))?;
    let kept = (&seen["tags"], &seen["blocks"][2]["checked"]);
    run.same(
        "the v1 edit kept what only v2 says: the tag, the item's checkbox",
        kept,
        (&json!(["greenhouse"]), &json!(false)),
    );
    let item = run.some("Bob's Mac shows Welcome", w.lab.item(w.mac_b, sp, welcome))?;
    let record = json!({"kind": "document", "title": "Welcome", "tags": ["greenhouse"], "blocks": [
        {"id": 1, "kind": "h1", "text": "Welcome"},
        {"id": 2, "kind": "p", "text": AFTER_TEXT},
        {"id": 3, "type": "item", "checked": false, "text": "Water the seedlings"}]});
    run.same("no default was ever written: each field stays as its app wrote it", item.record(), record);
    run.same(
        "Welcome was written under v1 and v2",
        item.authored(),
        BTreeSet::from([DOCUMENT_V1.id(), DOCUMENT_V2.id()]),
    );
    Ok(())
}

fn revoke_carol(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let carol = w.carol;
    let read = grant(Scope::Entry(h.space, h.welcome), Role::Read, vault(carol), h.coop, None);
    let carol_read =
        GrantId::from(run.ok("the coop gives Carol read on Welcome", w.lab.submit(w.mac_a, &[w.mac_a], read))?);
    w.lab.sync_all(10);
    let key = KeyScope::Entry(h.space, h.welcome);
    let before = w.lab.log(w.mac_a).view().epoch(key);
    let had = w.lab.fetched(w.mac_c, h.space, h.welcome);
    let revoke = Action::Revoke { grant: carol_read, actor: h.coop, keep: vec![], via: vec![] };
    run.ok("the coop revokes it", w.lab.submit(w.mac_a, &[w.mac_a], revoke))?;
    let edit = w.lab.edit(w.mac_a, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT));
    run.ok("Alice edits Welcome afterwards", edit)?;
    w.lab.sync_all(10);
    run.same("Welcome's key rotated", w.lab.log(w.mac_a).view().epoch(key), before + 1);
    run.check("Carol can't open the new key, Bob can", !w.lab.opens(w.mac_c, key) && w.lab.opens(w.mac_b, key));
    let kept = text(&w.lab, w.mac_c, h.space, h.welcome, 2);
    run.same("Carol keeps what was there before", kept.as_deref(), Some(WELCOME_TEXT));
    run.same("Carol's Mac stopped fetching Welcome", w.lab.fetched(w.mac_c, h.space, h.welcome), had);
    run.check("the new edit never reaches Carol", !contains(&w.lab.store(w.mac_c), AFTER_TEXT));
    Ok(())
}

fn lost_iphone(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let keys = [
        (KeyScope::Vault(w.alice), "Alice's vault key"),
        (KeyScope::Vault(h.coop), "the coop's key"),
        (KeyScope::Space(h.space), "the Handbook's key"),
        (KeyScope::Space(h.notes), "the key of Alice's Notes"),
    ];
    let before = keys.map(|(k, _)| w.lab.log(w.mac_a).view().epoch(k));
    let (alice, phone) = (w.alice, w.phone_a);
    let remove = Action::RemoveDevice { vault: alice, device: phone, keep: vec![] };
    run.ok("Alice's passkey removes the iPhone", w.lab.submit(w.mac_a, &[w.passkey_a], remove))?;
    let edit = w.lab.edit(w.mac_a, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT));
    run.ok("Alice edits Welcome afterwards", edit)?;
    w.lab.sync_all(11);
    let v = w.lab.log(w.mac_a).view();
    for ((k, name), b) in keys.into_iter().zip(before) {
        run.same(format!("{name} rotated"), v.epoch(k), b + 1);
    }
    let welcome = KeyScope::Entry(h.space, h.welcome);
    let opens = !w.lab.opens(phone, welcome) && w.lab.opens(w.mac_a, welcome) && w.lab.opens(w.mac_b, welcome);
    run.check("the iPhone can't open Welcome's new key; the Mac and Bob's Mac can", opens);
    run.check("the iPhone holds nothing written afterwards", !contains(&w.lab.store(phone), AFTER_TEXT));
    let forced = Tamper::Unchecked { signers: vec![phone], action: write(h.space, h.welcome, h.coop, 1) };
    run.same("its later edits are rejected everywhere", w.lab.tamper(w.mac_b, forced), Err(Refusal::NotActing));
    Ok(())
}

fn bob_leaves(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let bobs = w.lab.edit(w.mac_b, h.coop, h.space, h.welcome, |i| i.set_text(2, "Bob's words"));
    let bobs = run.ok("Bob edits Welcome", bobs)?;
    w.lab.sync_all(12);
    let keys = [KeyScope::Vault(h.coop), KeyScope::Space(h.space)];
    let before = keys.map(|k| w.lab.log(w.mac_a).view().epoch(k));
    let bob = w.bob;
    // the removal had seen Bob's edit
    let leave = Action::RemoveOwner { vault: h.coop, owner: Principal::Vault(bob), keep: vec![bobs] };
    run.ok("Bob leaves the coop, signing with only Bob's passkey", w.lab.submit(w.mac_b, &[w.passkey_b], leave))?;
    // what Alice's Mac wrote before hearing of it would still be under the keys Bob holds
    w.lab.sync(w.mac_b, w.mac_a);
    let edit = w.lab.edit(w.mac_a, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT));
    run.ok("Alice's Mac hears of it, then edits Welcome", edit)?;
    w.lab.sync_all(12);
    let v = w.lab.log(w.mac_a).view();
    run.same("the coop's threshold drops to 1", v.vault(h.coop).map(|c| c.threshold), Some(1));
    run.same("the keys of the coop and of the Handbook rotate", keys.map(|k| v.epoch(k)), before.map(|e| e + 1));
    run.check("Bob can't open Welcome's new key", !w.lab.opens(w.mac_b, KeyScope::Entry(h.space, h.welcome)));
    run.check("Bob's Mac holds nothing written afterwards", !contains(&w.lab.store(w.mac_b), AFTER_TEXT));
    run.check("Bob's earlier edit stays", v.writes(h.space, h.welcome).contains(&bobs));
    let author = w.lab.log(w.mac_a).ops().iter().find(|o| o.id() == bobs).map(|o| o.author);
    run.same("attributed to Bob's Mac", author, Some(w.mac_b));
    Ok(())
}

fn offline_conflicts(run: &mut Run) -> Done {
    for seed in 0..8 {
        let mut w = world();
        let h = handbook(&mut w);
        let carol = w.carol;
        let write_cap = grant(Scope::Entry(h.space, h.welcome), Role::Write, vault(carol), h.coop, None);
        let carol_write =
            GrantId::from(run.must("the coop gives Carol write", w.lab.submit(w.mac_a, &[w.mac_a], write_cap))?);
        w.lab.sync_all(seed);
        // Carol edits offline while the coop revokes Carol
        w.lab.set_online(w.mac_c, false);
        let carols = w.lab.edit(w.mac_c, carol, h.space, h.welcome, |i| i.set_text(2, "Carol, offline"));
        let carols = run.must("Carol edits Welcome offline", carols)?;
        let revoke = Action::Revoke { grant: carol_write, actor: h.coop, keep: vec![], via: vec![] };
        run.must("the coop revokes Carol", w.lab.submit(w.mac_a, &[w.mac_a], revoke))?;
        // Alice and Bob edit the same block at the same moment
        w.lab.set_online(w.mac_b, false);
        let alices = w.lab.edit(w.mac_a, h.coop, h.space, h.welcome, |i| i.set_text(2, "Alice's version"));
        run.must("Alice edits the block", alices)?;
        let bobs = w.lab.edit(w.mac_b, h.coop, h.space, h.welcome, |i| i.set_text(2, "Bob's version"));
        run.must("Bob edits the same block", bobs)?;
        // everyone comes back and receives everything, in an order drawn from the seed
        w.lab.set_online(w.mac_c, true);
        w.lab.set_online(w.mac_b, true);
        w.lab.sync_all(seed);
        let devices = [w.mac_a, w.phone_a, w.mac_b, w.mac_c];
        let dropped = devices.iter().all(|&d| !w.lab.log(d).view().writes(h.space, h.welcome).contains(&carols));
        run.check(format!("delivery order {}: every device drops Carol's unseen edit", seed + 1), dropped);
        let shown =
            [w.mac_a, w.phone_a, w.mac_b].map(|d| w.lab.item(d, h.space, h.welcome).and_then(|i| i.as_document()));
        let same = shown.iter().all(|s| s.is_some() && *s == shown[0]);
        run.check(format!("delivery order {}: every device shows the same Welcome", seed + 1), same);
    }
    Ok(())
}

fn tampering(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let add = Action::AddDevice { vault: w.alice, device: w.stranger, seal_to: None };
    let forged = Tamper::ForgedSignature { claimed: w.passkey_a, action: add };
    let what = "a forged signature, Alice's passkey adding the stranger's device, is rejected";
    run.same(what, w.lab.tamper(w.mac_b, forged), Err(Refusal::BadSignature));
    let chain = Tamper::Unchecked { signers: vec![w.stranger], action: write(h.space, h.welcome, h.coop, 0) };
    run.same(
        "a made-up chain, the stranger writing as the coop, is rejected",
        w.lab.tamper(w.mac_b, chain),
        Err(Refusal::NotActing),
    );
    let writes = w.lab.log(w.mac_a).view().writes(h.space, h.welcome);
    let last = run.some("Welcome has a latest write", writes.last().copied())?;
    let changed = w.lab.tamper(w.mac_b, Tamper::ChangedCiphertext(last));
    run.same(
        "a changed ciphertext is rejected: the author's signature no longer covers it",
        changed,
        Err(Refusal::BadSignature),
    );
    // an old sealed key replayed after a revocation opens nothing new
    let carol = w.carol;
    let read = grant(Scope::Entry(h.space, h.welcome), Role::Read, vault(carol), h.coop, None);
    let carol_read =
        GrantId::from(run.ok("the coop gives Carol read on Welcome", w.lab.submit(w.mac_a, &[w.mac_a], read))?);
    w.lab.sync_all(14);
    let revoke = Action::Revoke { grant: carol_read, actor: h.coop, keep: vec![], via: vec![] };
    run.ok("and revokes it", w.lab.submit(w.mac_a, &[w.mac_a], revoke))?;
    let edit = w.lab.edit(w.mac_a, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT));
    run.ok("Alice edits Welcome afterwards", edit)?;
    w.lab.sync_all(14);
    let old = KeyName::Scoped(KeyScope::Entry(h.space, h.welcome), 0);
    let _ = w.lab.tamper(w.mac_c, Tamper::ReplayedSeal { key: old, to: w.mac_c });
    w.lab.sync_all(14);
    let opens = w.lab.opens(w.mac_c, KeyScope::Entry(h.space, h.welcome));
    run.check("Welcome's old key, sealed again to Carol and replayed, doesn't open its new key", !opens);
    run.check("nor the edit made after the revocation", !contains(&w.lab.store(w.mac_c), AFTER_TEXT));
    Ok(())
}

fn social_todo(run: &mut Run) -> Done {
    let mut w = world();
    let t = todos_on(&mut w);
    w.lab.sync_all(15);
    let bob = w.bob;
    let done = w.lab.edit(w.mac_b, bob, t.space, t.door, |i| i.set_status(Status::Done));
    run.ok("Bob checks the door todo off on Bob's Mac", done)?;
    w.lab.sync_all(15);
    for d in [w.mac_a, w.mac_c] {
        run.same(format!("{} sees it done", named(&w.lab, d)), status(&w.lab, d, t.space, t.door), Some(Status::Done));
    }
    let carol = w.carol;
    let edit = w.lab.edit(w.mac_c, carol, t.space, t.door, |i| i.set_status(Status::Open));
    run.same("Carol can only read it", edit.err(), Some(Refusal::NoCap));
    let (dave, phone) = (w.dave, w.phone_a);
    let share = grant(Scope::Entry(t.space, t.door), Role::Read, vault(dave), t.coop, Some(t.coop_owner));
    run.ok(
        "acting for the coop, any coop owner's device shares it further: Alice's iPhone with Dave",
        w.lab.submit(phone, &[phone], share),
    )?;
    w.lab.sync_all(15);
    run.same("Dave's Mac sees it done", status(&w.lab, w.mac_d, t.space, t.door), Some(Status::Done));
    for d in [w.mac_b, w.mac_c, w.mac_d] {
        let none = [t.seeds, t.solar].iter().all(|&e| w.lab.fetched(d, t.space, e) == 0);
        run.check(format!("{} never receives the other two todos", named(&w.lab, d)), none);
    }
    Ok(())
}

fn roles_change(run: &mut Run) -> Done {
    let mut w = world();
    let t = todos_on(&mut w);
    let door = Scope::Entry(t.space, t.door);
    let key = KeyScope::Entry(t.space, t.door);
    let (carol, dave, alice) = (w.carol, w.dave, w.alice);
    w.lab.sync_all(16);
    let read = grant(door, Role::Read, vault(dave), t.coop, Some(t.coop_owner));
    run.ok("acting for the coop, Bob gives Dave read", w.lab.submit(w.mac_b, &[w.mac_b], read))?;
    let write_cap = grant(door, Role::Write, vault(carol), alice, None);
    run.ok("Alice raises Carol to write", w.lab.submit(w.mac_a, &[w.mac_a], write_cap))?;
    let revoke = Action::Revoke { grant: t.bob_write, actor: alice, keep: vec![], via: vec![] };
    run.ok("and takes Bob's own write away", w.lab.submit(w.mac_a, &[w.mac_a], revoke))?;
    w.lab.sync_all(16);
    let before = w.lab.log(w.mac_a).view().epoch(key);
    run.same("Bob still reaches the todo through the coop, so its key didn't rotate", before, 0);
    run.check("Bob and Dave open it", w.lab.opens(w.mac_b, key) && w.lab.opens(w.mac_d, key));
    let doing = w.lab.edit(w.mac_b, t.coop, t.space, t.door, |i| i.set_status(Status::Doing));
    run.ok("Bob edits it, acting for the coop", doing)?;
    run.ok("Carol edits it", w.lab.edit(w.mac_c, carol, t.space, t.door, |i| i.set_status(Status::Done)))?;
    w.lab.sync_all(16);
    let had = (w.lab.fetched(w.mac_b, t.space, t.door), w.lab.fetched(w.mac_d, t.space, t.door));
    let revoke = Action::Revoke { grant: t.coop_owner, actor: alice, keep: vec![], via: vec![] };
    let what = "Alice's passkey takes the coop's owner cap away, which also ends the read Bob gave Dave";
    run.ok(what, w.lab.submit(w.mac_a, &[w.passkey_a], revoke))?;
    run.ok("Alice edits the todo", w.lab.edit(w.mac_a, alice, t.space, t.door, |i| i.set_status(Status::Open)))?;
    w.lab.sync_all(16);
    run.same("only now does its key rotate", w.lab.log(w.mac_a).view().epoch(key), before + 1);
    run.check("Bob and Dave can't open it anymore", !w.lab.opens(w.mac_b, key) && !w.lab.opens(w.mac_d, key));
    run.check("Carol and Alice still do", w.lab.opens(w.mac_c, key) && w.lab.opens(w.mac_a, key));
    let now = (w.lab.fetched(w.mac_b, t.space, t.door), w.lab.fetched(w.mac_d, t.space, t.door));
    run.same("Bob's and Dave's devices stopped syncing it", now, had);
    let edit = w.lab.edit(w.mac_b, t.coop, t.space, t.door, |i| i.set_status(Status::Done));
    run.same("Bob's later edit is refused on Bob's Mac", edit.err(), Some(Refusal::NoCap));
    let forced = Tamper::Unchecked { signers: vec![w.mac_b], action: write(t.space, t.door, t.coop, before + 1) };
    run.same("and rejected when a patched app sends it anyway", w.lab.tamper(w.mac_a, forced), Err(Refusal::NoCap));
    Ok(())
}

fn peer_to_peer(run: &mut Run) -> Done {
    let mut w = world();
    let t = todos_on(&mut w);
    w.lab.set_online(w.server, false);
    w.lab.sync(w.mac_a, w.mac_c);
    let fetched = status(&w.lab, w.mac_c, t.space, t.door).is_some();
    run.check("with the server offline, Carol's Mac syncs the door todo straight from Alice's Mac", fetched);
    let none = [t.seeds, t.solar].iter().all(|&e| w.lab.fetched(w.mac_c, t.space, e) == 0);
    run.check("and nothing of the other two todos", none);
    w.lab.sync(w.mac_a, w.stranger);
    run.same("a device without a cap that asks for it gets nothing", w.lab.fetched(w.stranger, t.space, t.door), 0);
    w.lab.sync(w.mac_a, w.mac_b);
    let bob = w.bob;
    let doing = w.lab.edit(w.mac_b, bob, t.space, t.door, |i| i.set_status(Status::Doing));
    run.ok("Bob starts on it on Bob's Mac", doing)?;
    w.lab.sync(w.mac_b, w.mac_c);
    w.lab.sync(w.mac_c, w.mac_b);
    let shown = status(&w.lab, w.mac_c, t.space, t.door);
    run.same("Bob's and Carol's Macs sync directly: Carol sees it in progress", shown, Some(Status::Doing));
    let todo = |d| w.lab.item(d, t.space, t.door).and_then(|i| i.as_todo());
    run.same("both show the same todo", todo(w.mac_c), todo(w.mac_b));
    run.same("the server never got it", w.lab.fetched(w.server, t.space, t.door), 0);
    Ok(())
}

/// What the new Mac must reach after a recovery: Alice's vault and the coop, their keys and the Handbook's, and
/// Welcome with its history.
fn recovered(run: &mut Run, w: &World, h: &Handbook, new_mac: SignerId) {
    let (coop, alice) = (h.coop, w.alice);
    let v = w.lab.log(w.mac_b).view();
    run.check(
        "Bob's Mac sees the new Mac act for Alice and for the coop",
        v.acts_for(new_mac, alice) && v.acts_for(new_mac, coop),
    );
    run.check("and the lost devices act for neither", !v.acts_for(w.mac_a, coop) && !v.acts_for(w.phone_a, coop));
    run.check("the new Mac knows the coop", w.lab.log(new_mac).view().vault(coop).is_some());
    let keys = [
        (KeyScope::Vault(alice), "Alice's vault key"),
        (KeyScope::Vault(coop), "the coop's key"),
        (KeyScope::Space(h.space), "the Handbook's key"),
    ];
    for (k, name) in keys {
        run.check(format!("the new Mac opens {name}"), w.lab.opens(new_mac, k));
    }
    let shown = text(&w.lab, new_mac, h.space, h.welcome, 2);
    run.same("and reads the Handbook again, history included", shown.as_deref(), Some(WELCOME_TEXT));
}

fn recovery(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let alice = w.alice;
    w.lab.sync_all(18);
    // Alice's passkey, the vault's root, lives on in an iCloud Keychain
    for s in [w.mac_a, w.phone_a] {
        w.lab.lose(s);
    }
    // a new Mac derives its keys from the passkey; Bob's Mac, which acts for the coop, hands over the log of Alice's
    // vault
    let new_mac = w.lab.device_of(w.passkey_a, "Alice's new Mac");
    w.lab.share_contact(w.mac_b, new_mac, alice);
    let add = Action::AddDevice { vault: alice, device: new_mac, seal_to: None };
    let what = "Alice loses the Mac and the iPhone; the passkey adds a new Mac";
    run.ok(what, w.lab.submit(new_mac, &[w.passkey_a, new_mac], add))?;
    // the new Mac shows Bob the log of Alice's vault again, as a contact card, and syncs before the passkey removes
    // the lost devices: a removal cuts, for everyone, whatever of theirs its device hadn't seen
    w.lab.share_contact(new_mac, w.mac_b, alice);
    w.lab.sync_all(19);
    for lost in [w.mac_a, w.phone_a] {
        let remove = Action::RemoveDevice { vault: alice, device: lost, keep: vec![] };
        let what = format!("the passkey removes the lost {}", named(&w.lab, lost));
        run.ok(what, w.lab.submit(new_mac, &[w.passkey_a], remove))?;
    }
    w.lab.sync_all(20);
    recovered(run, &w, &h, new_mac);
    Ok(())
}

fn backup_passkey(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let alice = w.alice;
    // on a security key kept in a drawer
    let backup = w.lab.passkey("Alice's backup passkey");
    let add = Action::AddOwner { vault: alice, owner: Principal::Signer(backup), seal_to: None };
    let what = "Alice registers a backup passkey: a second owner of Alice's vault, never its root";
    run.ok(what, w.lab.submit(w.mac_a, &[w.passkey_a, backup], add))?;
    w.lab.sync_all(18);
    for s in [w.passkey_a, w.mac_a, w.phone_a] {
        w.lab.lose(s);
    }
    // Alice makes a new passkey, a new Mac derives its keys from it, and Bob's Mac hands over the vault's log
    let new_passkey = w.lab.passkey("Alice's new passkey");
    let new_mac = w.lab.device_of(new_passkey, "Alice's new Mac");
    w.lab.share_contact(w.mac_b, new_mac, alice);
    let add = Action::AddOwner { vault: alice, owner: Principal::Signer(new_passkey), seal_to: None };
    let what = "Alice loses the passkey too, with every device; the backup adds a new passkey";
    run.ok(what, w.lab.submit(new_mac, &[backup, new_passkey], add))?;
    let add = Action::AddDevice { vault: alice, device: new_mac, seal_to: None };
    run.ok("and a new Mac", w.lab.submit(new_mac, &[backup, new_mac], add))?;
    w.lab.share_contact(new_mac, w.mac_b, alice);
    w.lab.sync_all(19);
    for lost in [w.mac_a, w.phone_a] {
        let remove = Action::RemoveDevice { vault: alice, device: lost, keep: vec![] };
        let what = format!("the new passkey removes the lost {}", named(&w.lab, lost));
        run.ok(what, w.lab.submit(new_mac, &[new_passkey], remove))?;
    }
    let hand_on = Action::SetRoot { vault: alice, root: Some(new_passkey), keep: vec![] };
    let refused = w.lab.submit(new_mac, &[backup, new_passkey], hand_on).err();
    run.same("only the root hands the root on, so the lost passkey stays the root", refused, Some(Refusal::NotRoot));
    w.lab.sync_all(20);
    let v = w.lab.log(w.mac_b).view();
    let approve =
        v.approves(&[backup], Principal::Vault(alice)) && v.approves(&[new_passkey], Principal::Vault(alice));
    run.check("the backup and the new passkey each approve for Alice's vault", approve);
    run.same("and the lost passkey is still its root", v.vault(alice).and_then(|x| x.root), Some(w.passkey_a));
    recovered(run, &w, &h, new_mac);
    Ok(())
}
