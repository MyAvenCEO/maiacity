//! The plan's acceptance scenarios on the Lab, numbered as in the plan, each tagged with the phase that turned it
//! green; the flat vaults (F2) added those from 19 on, and turned 4 into a vault's own entries. Each records what it
//! checks, green or red (`Run`): `tests/scenarios.rs` runs every one and fails on any red check. `avendb/spec/AvenDB/
//! Examples.lean` runs the same scenarios on the Lean model.

use std::collections::BTreeSet;
use std::fmt::Debug;

use serde_json::{json, Value};

use crate::cast::*;
use crate::doc::Item;
use crate::history::MAIN;
use crate::id::{CellId, EntryId, SignerId, VaultId};
use crate::keys::{KeyFam, KeyName};
use crate::lab::{Lab, NewCap, Tamper};
use crate::lens::{Status, DOCUMENT_LENS, DOCUMENT_V1, DOCUMENT_V2};
use crate::policy::{mk_cell, Action, Grantee, Kind, Principal, Refusal, Role};
use crate::rules::Rule;
use crate::slice::{Selector, Sym};

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
pub static SCENARIOS: [Scenario; 29] = [
    Scenario { number: "1", title: "Alice's vault", phase: "P1", play: alices_vault },
    Scenario { number: "1b", title: "A new device reaches every device", phase: "P2", play: a_new_device_reaches_all },
    Scenario { number: "2", title: "Bob, Carol and Dave", phase: "P1", play: bob_carol_and_dave },
    Scenario { number: "3", title: "A coop of two", phase: "P1", play: a_coop_of_two },
    Scenario { number: "3b", title: "The coop key opens only on owner devices", phase: "P3", play: the_coop_key },
    Scenario { number: "4", title: "A vault's own entries", phase: "F2", play: own_entries },
    Scenario { number: "5", title: "Write and sync", phase: "P3", play: write_and_sync },
    Scenario { number: "6", title: "One document via caps", phase: "P3", play: one_document_via_caps },
    Scenario { number: "7", title: "Public", phase: "P3", play: public },
    Scenario { number: "8", title: "Proposals", phase: "P5", play: proposals },
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
    Scenario { number: "19", title: "Share every entry of a type", phase: "F2", play: share_a_type },
    Scenario { number: "20", title: "Share by a tag", phase: "F2", play: share_a_tag },
    Scenario { number: "21", title: "A tag moves an entry out of a slice", phase: "F2", play: out_of_a_slice },
    Scenario { number: "22", title: "Asking for a tag", phase: "F2", play: asking_for_a_tag },
    Scenario { number: "23", title: "Creating through a cap", phase: "F2", play: creating_through_a_cap },
    Scenario { number: "24", title: "A cap resting on a cap", phase: "F2", play: a_cap_on_a_cap },
    Scenario { number: "25", title: "Wide caps, relays and Public", phase: "F2", play: wide_caps },
    Scenario { number: "26", title: "A cell that comes back into use moves on", phase: "F2", play: comeback },
];

/// The scenario numbered `number`.
pub fn scenario(number: &str) -> Option<&'static Scenario> {
    SCENARIOS.iter().find(|s| s.number == number)
}

/// A signer by the name the Lab made it with.
fn named(lab: &Lab, s: SignerId) -> String {
    lab.name(s).unwrap_or("a device").to_string()
}

/// The cell entry `e` is in now, by device `d`'s view.
fn cell(lab: &Lab, d: SignerId, e: EntryId) -> Option<CellId> {
    Some(lab.state(d).entry(e)?.cell())
}

/// The key family of the cell entry `e` is in now, by device `d`'s view.
fn cell_key(lab: &Lab, d: SignerId, e: EntryId) -> Option<KeyFam> {
    let en = lab.state(d).entry(e)?;
    Some(KeyFam::Cell(en.vault, en.cell()))
}

/// Device `d` holds the key entry `e` is under now by device `by`'s view. A device that never hears that an entry
/// left its reach still reads it by its own view, as it was then.
fn reads_by(lab: &Lab, by: SignerId, d: SignerId, e: EntryId) -> bool {
    lab.state(by).entry_key(e).is_some_and(|name| lab.holds_key(d, name))
}

/// How many cells entry `e` has been in, by device `d`'s view: one until a steward first moves it.
fn stays(lab: &Lab, d: SignerId, e: EntryId) -> usize {
    lab.state(d).entry(e).map_or(0, |en| en.stays.len())
}

/// The tags of entry `e` as device `d` reads them.
fn tags(lab: &Lab, d: SignerId, e: EntryId) -> Option<Vec<Sym>> {
    Some(lab.meaning(d, e)?.attrs.tags)
}

fn syms(xs: &[&str]) -> Vec<Sym> {
    xs.iter().map(|&x| Sym::new(x)).collect()
}

/// A write of entry `e` for `actor` under the key device `d`'s view says the entry is under now, with a body nobody
/// opens: what a patched app sends.
fn forced(lab: &Lab, d: SignerId, e: EntryId, actor: VaultId) -> Action {
    let st = lab.state(d);
    match st.entry(e) {
        Some(en) => write(en.vault, e, actor, en.stay(), st.epoch(KeyFam::Cell(en.vault, en.cell()))),
        None => write(actor, e, actor, None, 0),
    }
}

fn alices_vault(run: &mut Run) -> Done {
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let (mac, phone) = (lab.device_of(passkey, "Alice's Mac"), lab.device_of(passkey, "Alice's iPhone"));
    let alice = human_on(&mut lab, passkey, &[mac, phone]);
    let genesis = lab.log(mac).edits()[0].clone();
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
        run.check(format!("{} opens the coop's key", named(&w.lab, d)), w.lab.opens(d, KeyFam::Seed(coop)));
    }
    for d in [w.mac_c, w.mac_d, w.stranger, w.server] {
        run.check(format!("{} can't", named(&w.lab, d)), !w.lab.opens(d, KeyFam::Seed(coop)));
    }
    Ok(())
}

fn own_entries(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let (alice, mac) = (w.alice, w.mac_a);
    let diary = w.lab.create(mac, alice, alice, "note", &[], document("Diary", "Dear diary", mac));
    let diary = run.ok("Alice writes a note in her own vault", diary)?;
    w.lab.sync_all(4);
    let v = w.lab.state(w.mac_b);
    let theirs = [h.welcome, h.onboarding].map(|e| v.entry(e).map(|en| en.vault));
    run.same("Bob's Mac knows Welcome and Onboarding, entries of the coop's vault", theirs, [Some(h.coop); 2]);
    let chain = v.acts_for(w.mac_a, w.alice) && v.acts_for(w.mac_a, h.coop) && v.may_write(h.coop, h.welcome);
    let what = "it checked their creation: Alice's Mac acts for Alice, Alice for Maia Coop, whose entries they are";
    run.check(what, chain);
    let meaning = run.some("Bob's Mac reads what Welcome is", w.lab.meaning(w.mac_b, h.welcome))?;
    let what = (meaning.attrs.ty.as_str(), meaning.attrs.author, meaning.attrs.tags.len());
    run.same("a doc, which the coop made, with no tags", what, ("doc", h.coop, 0));
    let none = Some(CellId::of(h.coop, &[]));
    run.same("no cap selects it: it sits in the cell of no caps", cell(&w.lab, w.mac_b, h.welcome), none);
    run.same("which only the coop's devices read: Carol's Mac never receives it", w.lab.fetched(w.mac_c, h.welcome), 0);
    run.check("Alice's diary is Alice's alone: Bob's Mac doesn't even learn it exists", v.entry(diary).is_none());
    let relayed = w.lab.fetched(w.server, diary);
    run.check("nor does the server, which relays the coop's entries and no one else's", relayed == 0);
    Ok(())
}

fn write_and_sync(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let read = text(&w.lab, w.mac_b, h.welcome, 2);
    run.same("Bob's Mac fetched Welcome without being asked, and reads it", read.as_deref(), Some(WELCOME_TEXT));
    run.check("the server holds Welcome's edits", w.lab.fetched(w.server, h.welcome) > 0);
    let key = run.some("Welcome is in a cell of the coop", cell_key(&w.lab, w.server, h.welcome))?;
    let opens = w.lab.reads(w.server, h.welcome) || w.lab.opens(w.server, key);
    run.check("the server opens neither Welcome's key nor its cell's", !opens);
    let meaning = w.lab.meaning(w.server, h.welcome);
    run.check("nor reads what Welcome is: its type and tags travel encrypted", meaning.is_none());
    run.check("Welcome's text appears nowhere in the server's store", !contains(&w.lab.store(w.server), WELCOME_TEXT));
    Ok(())
}

fn one_document_via_caps(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let carol = w.carol;
    let read = cap(h.coop, vault(carol), Role::Read, by_id(h.welcome));
    let read = run.ok("the coop gives Carol read on Welcome only, by its id", w.lab.issue(w.mac_a, &[w.mac_a], read))?;
    w.lab.sync_all(6);
    let moved = cell(&w.lab, w.mac_b, h.welcome);
    let carols = Some(CellId::of(h.coop, &[read]));
    run.same("a steward, Alice's Mac, moved Welcome into the cell of Carol's cap", moved, carols);
    let selects = w.lab.slice(w.mac_c, read).map(|s| s.select.clone());
    run.same("Carol's Mac reads what her cap selects: Welcome", selects, Some(by_id(h.welcome)));
    run.check("the server, which relays the cap, doesn't", w.lab.slice(w.server, read).is_none());
    let shown = text(&w.lab, w.mac_c, h.welcome, 2);
    run.same("Carol's Mac fetches and reads Welcome, written before her cap", shown.as_deref(), Some(WELCOME_TEXT));
    run.same("and never fetches Onboarding", w.lab.fetched(w.mac_c, h.onboarding), 0);
    let edit = w.lab.edit(w.mac_c, carol, h.welcome, |i| i.set_text(2, "Carol was here"));
    run.same("Carol's own Mac refuses the edit of Welcome", edit.err(), Some(Refusal::NoCap));
    for d in [w.mac_a, w.mac_b, w.server] {
        let action = forced(&w.lab, w.mac_c, h.welcome, carol);
        let forced = Tamper::Unchecked { signers: vec![w.mac_c], action };
        let what = format!("{} refuses it when a patched app sends it anyway", named(&w.lab, d));
        run.same(what, w.lab.tamper(d, forced), Err(Refusal::NoCap));
    }
    Ok(())
}

fn public(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let charter = document("Charter", CHARTER_TEXT, w.mac_a);
    let charter = run.ok("the coop writes its Charter", w.lab.create(w.mac_a, h.coop, h.coop, "doc", &[], charter))?;
    let public = cap(h.coop, Grantee::Public, Role::Read, by_id(charter));
    run.ok("and makes it public", w.lab.issue(w.mac_a, &[w.mac_a], public))?;
    w.lab.sync_all(7);
    w.lab.sync(w.server, w.stranger);
    for d in [w.stranger, w.server] {
        let who = named(&w.lab, d);
        let shown = text(&w.lab, d, charter, 2);
        run.same(format!("{who} reads the Charter"), shown.as_deref(), Some(CHARTER_TEXT));
        run.check(format!("{who} reads nothing else, not Welcome"), text(&w.lab, d, h.welcome, 2).is_none());
    }
    let stranger = w.lab.edit(w.stranger, h.coop, charter, |i| i.set_text(2, "defaced"));
    run.same("the stranger can't edit it", stranger.err(), Some(Refusal::NotActing));
    let carol = w.carol;
    let edit = w.lab.edit(w.mac_c, carol, charter, |i| i.set_text(2, "defaced"));
    run.same("nor can Carol, outside the coop", edit.err(), Some(Refusal::NoCap));
    Ok(())
}

fn proposals(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let (coop, welcome) = (h.coop, h.welcome);
    let main_text = |lab: &Lab, d| text(lab, d, welcome, 2);
    let heads = |lab: &Lab, line| lab.state(w.mac_a).heads(welcome, line);
    let first = heads(&w.lab, MAIN);
    let draft = w.lab.propose(w.mac_b, coop, welcome, &first, "Bob's greenhouse draft");
    let draft = run.ok("Bob starts a draft of Welcome", draft)?;
    let edit = w.lab.edit_on(w.mac_b, coop, welcome, Some(draft), |i| i.set_text(2, "Hello, Bob here"));
    run.ok("and edits it there", edit)?;
    w.lab.sync_all(8);
    for d in [w.mac_a, w.phone_a, w.mac_b] {
        let who = named(&w.lab, d);
        run.same(format!("main is unchanged on {who}"), main_text(&w.lab, d).as_deref(), Some(WELCOME_TEXT));
        let on_draft = w.lab.item_on(d, welcome, Some(draft)).and_then(|i| i.as_document());
        let shown = on_draft.and_then(|d| d.blocks.get(1).map(|b| b.text.clone()));
        run.same(format!("{who} shows Bob's edit on the draft"), shown.as_deref(), Some("Hello, Bob here"));
    }
    let name = w.lab.history(w.mac_a, welcome).and_then(|h| h.name(draft));
    run.same(
        "the draft's name travels encrypted, and Alice's Mac reads it",
        name.as_deref(),
        Some("Bob's greenhouse draft"),
    );
    let server = w.lab.store(w.server);
    let blind = !contains(&server, "Bob's greenhouse draft") && !contains(&server, "Hello, Bob here");
    run.check("the server stores the draft and reads neither its name nor its edit", blind);
    let before_merge = heads(&w.lab, MAIN);
    run.ok("Alice merges the draft into main", w.lab.merge(w.mac_a, coop, welcome, Some(draft), MAIN))?;
    w.lab.sync_all(8);
    run.same(
        "Bob's Mac shows the draft's edit on main",
        main_text(&w.lab, w.mac_b).as_deref(),
        Some("Hello, Bob here"),
    );
    // a second proposal is promoted: main ends with exactly its content, though main moved on meanwhile
    let rewrite = w.lab.propose(w.mac_a, coop, welcome, &heads(&w.lab, MAIN), "rewrite");
    let rewrite = Some(run.ok("Alice starts a second proposal, rewrite", rewrite)?);
    let edit = w.lab.edit_on(w.mac_a, coop, welcome, rewrite, |i| i.set_text(2, "Welcome to the coop"));
    run.ok("and rewrites Welcome there", edit)?;
    let meanwhile = w.lab.edit(w.mac_b, coop, welcome, |i| i.push_block(paragraph(3, "an edit on main meanwhile")));
    run.ok("meanwhile Bob edits main", meanwhile)?;
    w.lab.sync_all(8);
    run.ok("Alice promotes the rewrite into main", w.lab.promote(w.mac_a, coop, welcome, rewrite, MAIN))?;
    w.lab.sync_all(8);
    for d in [w.phone_a, w.mac_b] {
        let shown = |line| w.lab.item_on(d, welcome, line).map(|i| i.record());
        run.same(format!("{} shows main exactly as the rewrite", named(&w.lab, d)), shown(MAIN), shown(rewrite));
    }
    let record = run.some("Bob's Mac shows Welcome", w.lab.item(w.mac_b, welcome))?.record().to_string();
    run.check("main no longer holds Bob's edit made meanwhile", !record.contains("meanwhile"));
    // the latest edit is reverted: main goes back to the version it built on
    let good = run.some("Alice's Mac shows Welcome", w.lab.item(w.mac_a, welcome))?.as_document();
    let bad = run.ok("Bob makes a bad edit", w.lab.edit(w.mac_b, coop, welcome, |i| i.set_text(2, "oops")))?;
    w.lab.sync_all(8);
    let latest = w.lab.state(w.mac_a).history(welcome, MAIN).last().map(|w| w.deps.clone());
    let built_on = run.some("main has a latest edit", latest)?;
    run.ok("Alice reverts it", w.lab.restore(w.mac_a, coop, welcome, MAIN, &built_on))?;
    let now = w.lab.item(w.mac_a, welcome).and_then(|i| i.as_document());
    run.same("main is back to the version that edit built on", now, good);
    // an older bad edit is undone by a diff-based restore, which keeps what came after
    let older = w.lab.edit(w.mac_b, coop, welcome, |i| i.set_text(1, "Welcome!!!"));
    let older = run.ok("Bob makes another bad edit", older)?;
    let later = w.lab.edit(w.mac_b, coop, welcome, |i| i.push_block(paragraph(4, "a later, good edit")));
    run.ok("then a good one", later)?;
    w.lab.sync_all(8);
    run.ok("Alice undoes the older bad edit", w.lab.undo(w.mac_a, coop, welcome, MAIN, older))?;
    w.lab.sync_all(8);
    let doc = w.lab.item(w.mac_b, welcome).and_then(|i| i.as_document());
    let doc = run.some("Bob's Mac shows Welcome as a document", doc)?;
    let texts: Vec<&str> = doc.blocks.iter().map(|b| b.text.as_str()).collect();
    run.same(
        "the undo keeps the later, good edit",
        texts,
        vec!["Welcome", "Welcome to the coop", "a later, good edit"],
    );
    // no version is lost from history: every write of Welcome is in main's, and any version opens read-only
    let history = run.some("Bob's Mac holds Welcome's history", w.lab.history(w.mac_b, welcome))?;
    run.same("every write of Welcome is in main's history", history.history(MAIN).len(), history.changes().len());
    run.check("the reverted edit is still there", history.changes().iter().any(|c| c.write.edit == bad));
    let old = history.item_at(&before_merge, w.mac_b, MAIN).as_document();
    let old = old.and_then(|d| d.blocks.get(1).map(|b| b.text.clone()));
    run.same("the version before the merge opens read-only, as it was", old.as_deref(), Some(WELCOME_TEXT));
    let carol = w.carol;
    let read = cap(coop, vault(carol), Role::Read, by_id(welcome));
    run.ok("the coop gives Carol read on Welcome", w.lab.issue(w.mac_a, &[w.mac_a], read))?;
    w.lab.sync_all(8);
    let mine = w.lab.propose(w.mac_c, carol, welcome, &first, "mine").err();
    run.same("Carol, who may only read Welcome, can't start a proposal on it", mine, Some(Refusal::NoCap));
    let copy = w.lab.variant(w.mac_c, carol, welcome, MAIN, carol);
    let copy = run.ok("she makes a variant of it in her own vault", copy)?;
    let record = |e| w.lab.item(w.mac_c, e).map(|i| i.record());
    run.same("the variant holds Welcome's record", record(copy), record(welcome));
    run.same("and none of its history", w.lab.history(w.mac_c, copy).map(|h| h.changes().len()), Some(1));
    let theirs = w.lab.meaning(w.mac_c, copy).map(|m| (m.attrs.ty, m.attrs.author));
    run.same("it is a doc of Carol's own", theirs, Some(("doc".into(), carol)));
    Ok(())
}

fn schema_v2(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let (coop, welcome) = (h.coop, h.welcome);
    let publish = |blob: &[u8]| Action::Publish { vault: coop, actor: coop, via: vec![], blob: blob.to_vec() };
    let v1 = w.lab.submit(w.mac_a, &[w.mac_a], publish(DOCUMENT_V1.bytes()));
    run.ok("Alice publishes v1, the schema Welcome was written under, into the coop's lane", v1)?;
    w.lab.sync_all(9);
    let opened = w.lab.open(w.mac_b, welcome, &DOCUMENT_V2);
    let (seen, read_only) = run.some("a v2 app on Bob's Mac opens Welcome", opened)?;
    run.check("with no lens to v1 yet, it opens it read-only", read_only);
    run.same("and shows what it can", (&seen["title"], &seen["blocks"]), (&json!("Welcome"), &json!([])));
    let tag = |d: &mut Value| d["tags"] = json!(["greenhouse"]);
    run.same("so it can't edit it", w.lab.edit_as(w.mac_b, coop, welcome, &DOCUMENT_V2, tag), Err(Refusal::ReadOnly));
    run.ok("Alice publishes v2", w.lab.submit(w.mac_a, &[w.mac_a], publish(DOCUMENT_V2.bytes())))?;
    run.ok("and the lens from v1 to v2", w.lab.submit(w.mac_a, &[w.mac_a], publish(DOCUMENT_LENS.bytes())))?;
    w.lab.sync_all(9);
    let (seen, read_only) = run.some("Bob's v2 app opens Welcome again", w.lab.open(w.mac_b, welcome, &DOCUMENT_V2))?;
    run.check("and now may edit it", !read_only);
    let heading = json!({"id": 1, "type": "heading", "level": 1, "text": "Welcome"});
    run.same("it reads Welcome's v1 heading through the lens", seen["blocks"][0].clone(), heading);
    let edit = w.lab.edit_as(w.mac_b, coop, welcome, &DOCUMENT_V2, |d| {
        d["tags"] = json!(["greenhouse"]);
        let item = json!({"id": 3, "type": "item", "checked": false, "text": "Water the seedlings"});
        if let Some(blocks) = d["blocks"].as_array_mut() {
            blocks.push(item);
        }
    });
    run.check("it adds a tag and a checklist item", matches!(edit, Ok(Some(_))));
    w.lab.sync_all(9);
    let opened = w.lab.open(w.mac_a, welcome, &DOCUMENT_V1);
    let (seen, read_only) = run.some("a v1 app on Alice's Mac opens Welcome", opened)?;
    run.check("and may edit it", !read_only);
    let v1 = |text: &str| {
        json!({"kind": "document", "title": "Welcome", "blocks": [
            {"id": 1, "kind": "h1", "text": "Welcome"},
            {"id": 2, "kind": "p", "text": text},
            {"id": 3, "kind": "li", "text": "Water the seedlings"}]})
    };
    run.same("it reads its own content as it wrote it, and Bob's item as a list item", seen, v1(WELCOME_TEXT));
    let unchanged = w.lab.edit_as(w.mac_a, coop, welcome, &DOCUMENT_V1, |_| {});
    run.same("its view put back unchanged writes nothing", unchanged, Ok(None));
    let edit = w.lab.edit_as(w.mac_a, coop, welcome, &DOCUMENT_V1, |d| d["blocks"][1]["text"] = json!(AFTER_TEXT));
    run.check("the v1 app edits what it sees", matches!(edit, Ok(Some(_))));
    w.lab.sync_all(9);
    let reread = w.lab.open(w.mac_a, welcome, &DOCUMENT_V1).map(|(v, _)| v);
    run.same("and reads its edit back", reread, Some(v1(AFTER_TEXT)));
    let (seen, _) = run.some("Bob's v2 app opens Welcome", w.lab.open(w.mac_b, welcome, &DOCUMENT_V2))?;
    let kept = (&seen["tags"], &seen["blocks"][2]["checked"]);
    run.same(
        "the v1 edit kept what only v2 says: the tag, the item's checkbox",
        kept,
        (&json!(["greenhouse"]), &json!(false)),
    );
    let item = run.some("Bob's Mac shows Welcome", w.lab.item(w.mac_b, welcome))?;
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
    let read = cap(h.coop, vault(carol), Role::Read, by_id(h.welcome));
    let carol_read = run.ok("the coop gives Carol read on Welcome", w.lab.issue(w.mac_a, &[w.mac_a], read))?;
    w.lab.sync_all(10);
    let key = run.some("a steward moved Welcome into the cell of her cap", cell_key(&w.lab, w.mac_a, h.welcome))?;
    let before = w.lab.state(w.mac_a).epoch(key);
    let had = w.lab.fetched(w.mac_c, h.welcome);
    let revoke = Action::Revoke { cap: carol_read, actor: h.coop, keep: vec![], via: vec![] };
    run.ok("the coop revokes it", w.lab.submit(w.mac_a, &[w.mac_a], revoke))?;
    let edit = w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT));
    run.ok("Alice edits Welcome afterwards", edit)?;
    w.lab.sync_all(10);
    run.same("Welcome stays in its cell: a revocation moves no entry", cell_key(&w.lab, w.mac_a, h.welcome), Some(key));
    run.same("the cell's key rotated", w.lab.state(w.mac_a).epoch(key), before + 1);
    run.check("Carol can't open the new key, Bob can", !w.lab.opens(w.mac_c, key) && w.lab.opens(w.mac_b, key));
    let kept = text(&w.lab, w.mac_c, h.welcome, 2);
    run.same("Carol keeps what was there before", kept.as_deref(), Some(WELCOME_TEXT));
    run.same("Carol's Mac stopped fetching Welcome", w.lab.fetched(w.mac_c, h.welcome), had);
    run.check("the new edit never reaches Carol", !contains(&w.lab.store(w.mac_c), AFTER_TEXT));
    Ok(())
}

fn lost_iphone(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let welcome = run.some("Welcome is in a cell of the coop", cell_key(&w.lab, w.mac_a, h.welcome))?;
    let keys = [
        (KeyFam::Seed(w.alice), "Alice's vault key"),
        (KeyFam::Seed(h.coop), "the coop's key"),
        (welcome, "the key of Welcome's cell"),
    ];
    let before = keys.map(|(k, _)| w.lab.state(w.mac_a).epoch(k));
    let (alice, phone) = (w.alice, w.phone_a);
    let remove = Action::RemoveDevice { vault: alice, device: phone, keep: vec![] };
    run.ok("Alice's passkey removes the iPhone", w.lab.submit(w.mac_a, &[w.passkey_a], remove))?;
    let edit = w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT));
    run.ok("Alice edits Welcome afterwards", edit)?;
    w.lab.sync_all(11);
    let v = w.lab.state(w.mac_a);
    for ((k, name), b) in keys.into_iter().zip(before) {
        run.same(format!("{name} rotated"), v.epoch(k), b + 1);
    }
    run.check("the iPhone can't open the new key of Welcome's cell", !w.lab.opens(phone, welcome));
    run.check("the Mac and Bob's Mac can", w.lab.opens(w.mac_a, welcome) && w.lab.opens(w.mac_b, welcome));
    run.check("the iPhone holds nothing written afterwards", !contains(&w.lab.store(phone), AFTER_TEXT));
    let forced = Tamper::Unchecked { signers: vec![phone], action: forced(&w.lab, phone, h.welcome, h.coop) };
    run.same("its later edits are rejected everywhere", w.lab.tamper(w.mac_b, forced), Err(Refusal::NotActing));
    Ok(())
}

fn bob_leaves(run: &mut Run) -> Done {
    let mut w = world();
    let h = handbook(&mut w);
    let bobs = w.lab.edit(w.mac_b, h.coop, h.welcome, |i| i.set_text(2, "Bob's words"));
    let bobs = run.ok("Bob edits Welcome", bobs)?;
    w.lab.sync_all(12);
    let welcome = run.some("Welcome is in a cell of the coop", cell_key(&w.lab, w.mac_a, h.welcome))?;
    let keys = [KeyFam::Seed(h.coop), welcome];
    let before = keys.map(|k| w.lab.state(w.mac_a).epoch(k));
    let bob = w.bob;
    // the removal had seen Bob's edit
    let leave = Action::RemoveOwner { vault: h.coop, owner: Principal::Vault(bob), keep: vec![bobs] };
    run.ok("Bob leaves the coop, signing with only Bob's passkey", w.lab.submit(w.mac_b, &[w.passkey_b], leave))?;
    // what Alice's Mac wrote before hearing of it would still be under the keys Bob holds
    w.lab.sync(w.mac_b, w.mac_a);
    let edit = w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT));
    run.ok("Alice's Mac hears of it, then edits Welcome", edit)?;
    w.lab.sync_all(12);
    let v = w.lab.state(w.mac_a);
    run.same("the coop's threshold drops to 1", v.vault(h.coop).map(|c| c.threshold), Some(1));
    run.same("the coop's key and Welcome's cell's rotate", keys.map(|k| v.epoch(k)), before.map(|e| e + 1));
    run.check("Bob can't open Welcome's new key", !w.lab.reads(w.mac_b, h.welcome));
    run.check("Bob's Mac holds nothing written afterwards", !contains(&w.lab.store(w.mac_b), AFTER_TEXT));
    run.check("Bob's earlier edit stays", v.writes(h.welcome).contains(&bobs));
    let author = w.lab.log(w.mac_a).edits().iter().find(|o| o.id() == bobs).map(|o| o.author);
    run.same("attributed to Bob's Mac", author, Some(w.mac_b));
    Ok(())
}

fn offline_conflicts(run: &mut Run) -> Done {
    for seed in 0..8 {
        let mut w = world();
        let h = handbook(&mut w);
        let carol = w.carol;
        let write_cap = cap(h.coop, vault(carol), Role::Write, by_id(h.welcome));
        let carol_write = run.must("the coop gives Carol write", w.lab.issue(w.mac_a, &[w.mac_a], write_cap))?;
        w.lab.sync_all(seed);
        // Carol edits offline while the coop revokes Carol
        w.lab.set_online(w.mac_c, false);
        let carols = w.lab.edit(w.mac_c, carol, h.welcome, |i| i.set_text(2, "Carol, offline"));
        let carols = run.must("Carol edits Welcome offline", carols)?;
        let revoke = Action::Revoke { cap: carol_write, actor: h.coop, keep: vec![], via: vec![] };
        run.must("the coop revokes Carol", w.lab.submit(w.mac_a, &[w.mac_a], revoke))?;
        // Alice and Bob edit the same block at the same moment
        w.lab.set_online(w.mac_b, false);
        let alices = w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, "Alice's version"));
        run.must("Alice edits the block", alices)?;
        let bobs = w.lab.edit(w.mac_b, h.coop, h.welcome, |i| i.set_text(2, "Bob's version"));
        run.must("Bob edits the same block", bobs)?;
        // everyone comes back and receives everything, in an order drawn from the seed
        w.lab.set_online(w.mac_c, true);
        w.lab.set_online(w.mac_b, true);
        w.lab.sync_all(seed);
        let devices = [w.mac_a, w.phone_a, w.mac_b, w.mac_c];
        let dropped = devices.iter().all(|&d| !w.lab.state(d).writes(h.welcome).contains(&carols));
        run.check(format!("delivery order {}: every device drops Carol's unseen edit", seed + 1), dropped);
        let shown = [w.mac_a, w.phone_a, w.mac_b].map(|d| w.lab.item(d, h.welcome).and_then(|i| i.as_document()));
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
    let action = forced(&w.lab, w.mac_b, h.welcome, h.coop);
    let chain = Tamper::Unchecked { signers: vec![w.stranger], action };
    run.same(
        "a made-up chain, the stranger writing as the coop, is rejected",
        w.lab.tamper(w.mac_b, chain),
        Err(Refusal::NotActing),
    );
    let writes = w.lab.state(w.mac_a).writes(h.welcome);
    let last = run.some("Welcome has a latest write", writes.last().copied())?;
    let changed = w.lab.tamper(w.mac_b, Tamper::ChangedCiphertext(last));
    run.same(
        "a changed ciphertext is rejected: the author's signature no longer covers it",
        changed,
        Err(Refusal::BadSignature),
    );
    // an old sealed key replayed after a revocation opens nothing new
    let carol = w.carol;
    let read = cap(h.coop, vault(carol), Role::Read, by_id(h.welcome));
    let carol_read = run.ok("the coop gives Carol read on Welcome", w.lab.issue(w.mac_a, &[w.mac_a], read))?;
    w.lab.sync_all(14);
    let key = run.some("a steward moved Welcome into the cell of her cap", cell_key(&w.lab, w.mac_a, h.welcome))?;
    let revoke = Action::Revoke { cap: carol_read, actor: h.coop, keep: vec![], via: vec![] };
    run.ok("and revokes it", w.lab.submit(w.mac_a, &[w.mac_a], revoke))?;
    let edit = w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT));
    run.ok("Alice edits Welcome afterwards", edit)?;
    w.lab.sync_all(14);
    let old = KeyName::Scoped(key, 0);
    let replayed = w.lab.tamper(w.mac_c, Tamper::ReplayedSeal { key: old, to: w.mac_c });
    run.same("the cell's old key, sealed again to Carol and replayed, is refused", replayed, Err(Refusal::Unsealed));
    w.lab.sync_all(14);
    let opens = w.lab.opens(w.mac_c, key) || w.lab.reads(w.mac_c, h.welcome);
    run.check("Carol opens neither the cell's new key nor Welcome's", !opens);
    run.check("nor the edit made after the revocation", !contains(&w.lab.store(w.mac_c), AFTER_TEXT));
    Ok(())
}

fn social_todo(run: &mut Run) -> Done {
    let mut w = world();
    let t = todos_on(&mut w);
    w.lab.sync_all(15);
    let (alice, bob) = (w.alice, w.bob);
    let shared = mk_cell(&[t.bob_write, t.carol_read, t.coop_owner]);
    let moved = cell(&w.lab, w.mac_b, t.door);
    let three = Some(CellId::of(alice, &shared));
    run.same("Alice's Mac moved the door todo into the cell of the three caps", moved, three);
    let done = w.lab.edit(w.mac_b, bob, t.door, |i| i.set_status(Status::Done));
    run.ok("Bob checks the door todo off on Bob's Mac", done)?;
    w.lab.sync_all(15);
    for d in [w.mac_a, w.mac_c] {
        run.same(format!("{} sees it done", named(&w.lab, d)), status(&w.lab, d, t.door), Some(Status::Done));
    }
    let carol = w.carol;
    let edit = w.lab.edit(w.mac_c, carol, t.door, |i| i.set_status(Status::Open));
    run.same("Carol can only read it", edit.err(), Some(Refusal::NoCap));
    let (dave, phone) = (w.dave, w.phone_a);
    let share = cap_on(alice, vault(dave), Role::Read, by_id(t.door), t.coop_owner, t.coop);
    run.ok(
        "acting for the coop, any coop owner's device shares it further: Alice's iPhone with Dave",
        w.lab.issue(phone, &[phone], share),
    )?;
    w.lab.sync_all(15);
    run.same("Dave's Mac sees it done", status(&w.lab, w.mac_d, t.door), Some(Status::Done));
    for d in [w.mac_b, w.mac_c, w.mac_d] {
        let none = [t.seeds, t.solar].iter().all(|&e| w.lab.fetched(d, e) == 0);
        run.check(format!("{} never receives the other two todos", named(&w.lab, d)), none);
    }
    Ok(())
}

fn roles_change(run: &mut Run) -> Done {
    let mut w = world();
    let t = todos_on(&mut w);
    let (carol, dave, alice) = (w.carol, w.dave, w.alice);
    w.lab.sync_all(16);
    let read = cap_on(alice, vault(dave), Role::Read, by_id(t.door), t.coop_owner, t.coop);
    run.ok("acting for the coop, Bob gives Dave read", w.lab.issue(w.mac_b, &[w.mac_b], read))?;
    let write = cap(alice, vault(carol), Role::Write, by_id(t.door));
    run.ok("Alice raises Carol to write", w.lab.issue(w.mac_a, &[w.mac_a], write))?;
    let revoke = Action::Revoke { cap: t.bob_write, actor: alice, keep: vec![], via: vec![] };
    run.ok("and takes Bob's own write away", w.lab.submit(w.mac_a, &[w.mac_a], revoke))?;
    w.lab.sync_all(16);
    let key = run.some("Alice's Mac moved the todo into the cell of the new caps", cell_key(&w.lab, w.mac_a, t.door))?;
    let before = w.lab.state(w.mac_a).epoch(key);
    run.same("Bob still reaches the todo through the coop, so its cell's key never rotated", before, 0);
    run.check("Bob and Dave read it", w.lab.reads(w.mac_b, t.door) && w.lab.reads(w.mac_d, t.door));
    let doing = w.lab.edit(w.mac_b, t.coop, t.door, |i| i.set_status(Status::Doing));
    run.ok("Bob edits it, acting for the coop", doing)?;
    run.ok("Carol edits it", w.lab.edit(w.mac_c, carol, t.door, |i| i.set_status(Status::Done)))?;
    w.lab.sync_all(16);
    let had = (w.lab.fetched(w.mac_b, t.door), w.lab.fetched(w.mac_d, t.door));
    let revoke = Action::Revoke { cap: t.coop_owner, actor: alice, keep: vec![], via: vec![] };
    let what = "Alice's passkey takes the coop's owner cap away, which also ends the read Bob gave Dave";
    run.ok(what, w.lab.submit(w.mac_a, &[w.passkey_a], revoke))?;
    run.ok("Alice edits the todo", w.lab.edit(w.mac_a, alice, t.door, |i| i.set_status(Status::Open)))?;
    w.lab.sync_all(16);
    let now = (cell_key(&w.lab, w.mac_a, t.door), w.lab.state(w.mac_a).epoch(key));
    run.same("the todo stays in its cell, whose key only now rotates", now, (Some(key), before + 1));
    run.check("Bob and Dave can't open it anymore", !w.lab.reads(w.mac_b, t.door) && !w.lab.reads(w.mac_d, t.door));
    run.check("Carol and Alice still do", w.lab.reads(w.mac_c, t.door) && w.lab.reads(w.mac_a, t.door));
    let now = (w.lab.fetched(w.mac_b, t.door), w.lab.fetched(w.mac_d, t.door));
    run.same("Bob's and Dave's devices stopped syncing it", now, had);
    let edit = w.lab.edit(w.mac_b, t.coop, t.door, |i| i.set_status(Status::Done));
    run.same("Bob's later edit is refused on Bob's Mac", edit.err(), Some(Refusal::NoCap));
    let forced = Tamper::Unchecked { signers: vec![w.mac_b], action: forced(&w.lab, w.mac_a, t.door, t.coop) };
    run.same("and rejected when a patched app sends it anyway", w.lab.tamper(w.mac_a, forced), Err(Refusal::NoCap));
    Ok(())
}

fn peer_to_peer(run: &mut Run) -> Done {
    let mut w = world();
    let t = todos_on(&mut w);
    w.lab.set_online(w.server, false);
    w.lab.sync(w.mac_a, w.mac_c);
    let fetched = status(&w.lab, w.mac_c, t.door).is_some();
    run.check("with the server offline, Carol's Mac syncs the door todo straight from Alice's Mac", fetched);
    let none = [t.seeds, t.solar].iter().all(|&e| w.lab.fetched(w.mac_c, e) == 0);
    run.check("and nothing of the other two todos", none);
    w.lab.sync(w.mac_a, w.stranger);
    run.same("a device without a cap that asks for it gets nothing", w.lab.fetched(w.stranger, t.door), 0);
    w.lab.sync(w.mac_a, w.mac_b);
    let bob = w.bob;
    let doing = w.lab.edit(w.mac_b, bob, t.door, |i| i.set_status(Status::Doing));
    run.ok("Bob starts on it on Bob's Mac", doing)?;
    w.lab.sync(w.mac_b, w.mac_c);
    w.lab.sync(w.mac_c, w.mac_b);
    let shown = status(&w.lab, w.mac_c, t.door);
    run.same("Bob's and Carol's Macs sync directly: Carol sees it in progress", shown, Some(Status::Doing));
    let todo = |d| w.lab.item(d, t.door).and_then(|i| i.as_todo());
    run.same("both show the same todo", todo(w.mac_c), todo(w.mac_b));
    run.same("the server never got it", w.lab.fetched(w.server, t.door), 0);
    Ok(())
}

/// What the new Mac must reach after a recovery: Alice's vault and the coop, their keys and the key of Welcome's cell,
/// and Welcome with its history.
fn recovered(run: &mut Run, w: &World, h: &Handbook, new_mac: SignerId) {
    let (coop, alice) = (h.coop, w.alice);
    let v = w.lab.state(w.mac_b);
    run.check(
        "Bob's Mac sees the new Mac act for Alice and for the coop",
        v.acts_for(new_mac, alice) && v.acts_for(new_mac, coop),
    );
    run.check("and the lost devices act for neither", !v.acts_for(w.mac_a, coop) && !v.acts_for(w.phone_a, coop));
    run.check("the new Mac knows the coop", w.lab.state(new_mac).vault(coop).is_some());
    let welcome = cell_key(&w.lab, new_mac, h.welcome);
    let keys = [
        (Some(KeyFam::Seed(alice)), "Alice's vault key"),
        (Some(KeyFam::Seed(coop)), "the coop's key"),
        (welcome, "the key of Welcome's cell"),
    ];
    for (k, name) in keys {
        run.check(format!("the new Mac opens {name}"), k.is_some_and(|k| w.lab.opens(new_mac, k)));
    }
    let shown = text(&w.lab, new_mac, h.welcome, 2);
    run.same("and reads the coop's documents again, history included", shown.as_deref(), Some(WELCOME_TEXT));
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
    let v = w.lab.state(w.mac_b);
    let approve =
        v.approves(&[backup], Principal::Vault(alice)) && v.approves(&[new_passkey], Principal::Vault(alice));
    run.check("the backup and the new passkey each approve for Alice's vault", approve);
    run.same("and the lost passkey is still its root", v.vault(alice).and_then(|x| x.root), Some(w.passkey_a));
    recovered(run, &w, &h, new_mac);
    Ok(())
}

fn share_a_type(run: &mut Run) -> Done {
    let mut w = world();
    let lib = library(&mut w);
    let (alice, bob, mac) = (w.alice, w.bob, w.mac_a);
    let todos = cap(alice, vault(bob), Role::Read, of_type("todo"));
    let todos = run.ok("Alice shares all her todos with Bob, read", w.lab.issue(mac, &[mac], todos))?;
    w.lab.sync_all(19);
    let (theirs, none) = (Some(CellId::of(alice, &[todos])), Some(CellId::of(alice, &[])));
    let cells = lib.all().map(|e| cell(&w.lab, mac, e));
    let moved = [theirs, theirs, theirs, none, none];
    run.same("her Mac moved the three todos into the cap's cell, and left the notes", cells, moved);
    let reads = lib.all().map(|e| w.lab.reads(w.mac_b, e));
    run.same("Bob's Mac reads the three todos and neither note", reads, [true, true, true, false, false]);
    run.same("and never receives the notes", [lib.plan, lib.diary].map(|e| w.lab.fetched(w.mac_b, e)), [0, 0]);
    let selects = w.lab.slice(w.mac_b, todos).map(|s| s.select.clone());
    run.same("it reads what Bob's cap selects: every todo", selects, Some(of_type("todo")));
    let edit = w.lab.edit(w.mac_b, bob, lib.door, |i| i.set_status(Status::Done));
    run.same("Bob writes none of them", edit.err(), Some(Refusal::NoCap));
    let relayed = lib.all().iter().all(|&e| w.lab.fetched(w.server, e) > 0 && !w.lab.reads(w.server, e));
    run.check("the server relays all five and reads none", relayed);
    run.check("nor what Bob's cap selects", w.lab.slice(w.server, todos).is_none());
    let lamp = w.lab.create(mac, alice, alice, "todo", &[], Item::todo("Fix the lamp", mac));
    let lamp = run.ok("Alice adds a todo", lamp)?;
    w.lab.sync_all(19);
    let straight = cell(&w.lab, w.mac_b, lamp) == theirs && stays(&w.lab, w.mac_b, lamp) == 1;
    run.check("her Mac creates it straight in the cap's cell, with no move", straight);
    run.check("and Bob reads it", w.lab.reads(w.mac_b, lamp));
    Ok(())
}

fn share_a_tag(run: &mut Run) -> Done {
    let mut w = world();
    let lib = library(&mut w);
    let (alice, bob, mac) = (w.alice, w.bob, w.mac_a);
    let work = cap(alice, vault(bob), Role::Write, tagged("todo", "work"));
    run.ok("Alice shares her todos tagged work with Bob, write", w.lab.issue(mac, &[mac], work))?;
    w.lab.sync_all(20);
    let reads = lib.all().map(|e| w.lab.reads(w.mac_b, e));
    let what = "Bob's Mac reads the door and the solar panels: not the seeds, at home, nor the plan, a note";
    run.same(what, reads, [true, false, true, false, false]);
    let done = w.lab.edit(w.mac_b, bob, lib.door, |i| i.set_status(Status::Done));
    run.ok("Bob checks the door off", done)?;
    w.lab.sync_all(20);
    run.same("Alice sees it done", status(&w.lab, w.mac_a, lib.door), Some(Status::Done));
    run.same("Bob never even receives the seeds todo", w.lab.fetched(w.mac_b, lib.seeds), 0);
    let forced = Tamper::Unchecked { signers: vec![w.mac_b], action: forced(&w.lab, w.mac_a, lib.seeds, bob) };
    run.same("a patched app's write of it is refused", w.lab.tamper(w.mac_a, forced), Err(Refusal::NoCap));
    Ok(())
}

fn out_of_a_slice(run: &mut Run) -> Done {
    let mut w = world();
    let lib = library(&mut w);
    let (alice, bob, mac) = (w.alice, w.bob, w.mac_a);
    let work = cap(alice, vault(bob), Role::Write, tagged("todo", "work"));
    run.ok("Alice shares her todos tagged work with Bob, write", w.lab.issue(mac, &[mac], work))?;
    w.lab.sync_all(21);
    let doing = w.lab.edit(w.mac_b, bob, lib.solar, |i| i.set_status(Status::Doing));
    run.ok("Bob starts on the solar panels", doing)?;
    w.lab.sync_all(21);
    run.ok("Alice takes the work tag off them", w.lab.tag(mac, alice, lib.solar, &[], &["work"]))?;
    let after = w.lab.edit(mac, alice, lib.solar, |i| {
        i.edit_todo(|t| t.notes = AFTER_TEXT.into());
    });
    run.ok("and writes a note on them afterwards", after)?;
    let late = w.lab.edit(w.mac_b, bob, lib.solar, |i| i.set_status(Status::Done));
    let late = run.ok("Bob, who hasn't heard of it yet, checks them off", late)?;
    w.lab.sync_all(21);
    let none = Some(CellId::of(alice, &[]));
    run.same("her Mac moved them to the cell of no caps", cell(&w.lab, mac, lib.solar), none);
    run.same("and shows them as Bob left them", status(&w.lab, mac, lib.solar), Some(Status::Doing));
    let mine = status(&w.lab, w.mac_b, lib.solar);
    run.same("Bob's Mac, which never hears of the move, still shows his own check", mine, Some(Status::Done));
    let key = run.some("the solar panels are in a cell", cell_key(&w.lab, mac, lib.solar))?;
    let blind = !reads_by(&w.lab, mac, w.mac_b, lib.solar) && !w.lab.opens(w.mac_b, key);
    run.check("Bob opens neither their key now nor their cell's", blind);
    run.check("the note written after they left never reaches Bob", !contains(&w.lab.store(w.mac_b), AFTER_TEXT));
    let dropped = !w.lab.state(mac).writes(lib.solar).contains(&late);
    run.check("Bob's late check is dropped: the move cut what it hadn't seen", dropped);
    let door = w.lab.reads(w.mac_b, lib.door) && w.lab.state(mac).may_write(bob, lib.door);
    run.check("he still reads and writes the door", door);
    Ok(())
}

fn asking_for_a_tag(run: &mut Run) -> Done {
    let mut w = world();
    let lib = library(&mut w);
    let (alice, bob, carol, mac) = (w.alice, w.bob, w.carol, w.mac_a);
    let set = Rule::Set { path: vec![], to: None, on: None };
    let ops = vec![Rule::Read, set, Rule::Tag(Some(syms(&["urgent"])))];
    let work = NewCap { name: "Work".into(), ops, ..cap(alice, vault(bob), Role::Write, tagged("todo", "work")) };
    let what = "Alice shares her todos tagged work with Bob: he edits them and may ask for the urgent tag alone";
    let work = run.ok(what, w.lab.issue(mac, &[mac], work))?;
    let urgent = cap(alice, vault(carol), Role::Read, tagged("todo", "urgent"));
    let urgent = run.ok("and her urgent todos with Carol, read", w.lab.issue(mac, &[mac], urgent))?;
    w.lab.sync_all(22);
    run.check("Carol reads none of them yet", lib.all().iter().all(|&e| !w.lab.reads(w.mac_c, e)));
    let ask = w.lab.tag(w.mac_b, bob, lib.door, &["urgent"], &[]);
    run.ok("Bob tags the door todo urgent, which asks Alice's Mac to", ask)?;
    w.lab.sync_all(22);
    run.same("Alice's Mac grants it", tags(&w.lab, mac, lib.door), Some(syms(&["work", "urgent"])));
    let both = Some(CellId::of(alice, &mk_cell(&[work, urgent])));
    run.same("and moves the todo into the cell of both caps", cell(&w.lab, mac, lib.door), both);
    let both = w.lab.reads(w.mac_c, lib.door) && w.lab.reads(w.mac_b, lib.door);
    run.check("Carol reads it now, and Bob still does", both);
    let granted = Some(syms(&["work", "urgent"]));
    run.same("Bob's Mac reads its tags as Alice's Mac granted them", tags(&w.lab, w.mac_b, lib.door), granted);
    let mac_b = w.mac_b;
    let refused = w.lab.tag(mac_b, bob, lib.solar, &[], &["work"]).err();
    run.same("Bob's app won't take the work tag off the solar todo: his cap", refused, Some(Refusal::NotAllowed));
    let ask = w.lab.patched(|lab| lab.tag(mac_b, bob, lib.solar, &[], &["work"]));
    run.ok("a patched app asks Alice's Mac to all the same", ask)?;
    w.lab.sync_all(22);
    run.same("Alice's Mac counts no such ask, and keeps the tag", tags(&w.lab, mac, lib.solar), Some(syms(&["work"])));
    run.check("so the solar todo stays in Bob's slice", w.lab.reads(w.mac_b, lib.solar));
    run.same("and Bob's own write never counted", tags(&w.lab, w.mac_b, lib.solar), Some(syms(&["work"])));
    Ok(())
}

fn creating_through_a_cap(run: &mut Run) -> Done {
    let mut w = world();
    let lib = library(&mut w);
    let (alice, bob, carol, mac) = (w.alice, w.bob, w.carol, w.mac_a);
    let all = cap(alice, vault(carol), Role::Write, of_type("todo"));
    let all = run.ok("Alice shares all her todos with Carol, write", w.lab.issue(mac, &[mac], all))?;
    let work = cap(alice, vault(bob), Role::Write, tagged("todo", "work"));
    let work = run.ok("and those tagged work with Bob, write", w.lab.issue(mac, &[mac], work))?;
    w.lab.sync_all(23);
    let lamp = w.lab.create(w.mac_b, bob, alice, "todo", &["work"], Item::todo("Fix the lamp", w.mac_b));
    let lamp = run.ok("Bob creates a todo tagged work in Alice's vault", lamp)?;
    let intake = Some(CellId::of(alice, &[work]));
    run.same("in his cap's intake cell: the only cell his Mac can work out", cell(&w.lab, w.mac_b, lamp), intake);
    w.lab.sync(w.mac_b, w.mac_c);
    run.same("Carol's cap selects it too, but her Mac receives none of it there", w.lab.fetched(w.mac_c, lamp), 0);
    w.lab.sync_all(23);
    let both = Some(CellId::of(alice, &mk_cell(&[all, work])));
    run.same("Alice's Mac moved it into the cell of both caps", cell(&w.lab, mac, lamp), both);
    run.check("now Carol reads it, and Bob still does", w.lab.reads(w.mac_c, lamp) && w.lab.reads(w.mac_b, lamp));
    run.ok("and Bob still writes it", w.lab.edit(w.mac_b, bob, lamp, |i| i.set_status(Status::Doing)))?;
    let note = document("Bob's note", "Outside my slice", w.mac_b);
    let refused = w.lab.create(w.mac_b, bob, alice, "note", &["work"], note.clone()).err();
    run.same("Bob's app won't put a note, outside his slice, in Alice's vault", refused, Some(Refusal::NoCap));
    let forced = w.lab.create_in(w.mac_b, bob, alice, vec![work], "note", &["work"], note);
    let note = run.ok("a patched app puts it in his intake cell anyway, which every peer accepts", forced)?;
    w.lab.sync_all(23);
    let none = Some(CellId::of(alice, &[]));
    run.same("Alice's Mac keeps it, in the cell of no caps", cell(&w.lab, mac, note), none);
    let theirs = !reads_by(&w.lab, mac, w.mac_b, note) && w.lab.reads(mac, note);
    run.check("so Bob reads it no more, and Alice does", theirs);
    run.check("nor any other entry: his notes were never his", !w.lab.reads(w.mac_b, lib.plan));
    Ok(())
}

fn a_cap_on_a_cap(run: &mut Run) -> Done {
    let mut w = world();
    let lib = library(&mut w);
    let (alice, carol, dave, mac) = (w.alice, w.carol, w.dave, w.mac_a);
    let owner = cap(alice, vault(carol), Role::Owner, of_type("todo"));
    let refused = w.lab.issue(mac, &[mac], owner.clone()).err();
    run.same("Alice's Mac alone can't make anyone owner", refused, Some(Refusal::BelowThreshold));
    let owner = run.ok("Alice's passkey makes Carol owner of her todos", w.lab.issue(mac, &[w.passkey_a], owner))?;
    w.lab.sync_all(24);
    let home = cap_on(alice, vault(dave), Role::Read, tagged("todo", "home"), owner, carol);
    let home = run.ok("Carol gives Dave the todos tagged home, read", w.lab.issue(w.mac_c, &[w.mac_c], home))?;
    let notes = cap_on(alice, vault(dave), Role::Read, of_type("note"), owner, carol);
    let notes = run.ok("and, claiming more than she holds, the notes", w.lab.issue(w.mac_c, &[w.mac_c], notes))?;
    w.lab.sync_all(24);
    let reads = |lab: &Lab, d| lib.all().map(|e| lab.reads(d, e));
    run.same("Carol reads the three todos", reads(&w.lab, w.mac_c), [true, true, true, false, false]);
    let what = "Dave reads what every cap of his chains selects: the seeds todo, at home, and no note";
    run.same(what, reads(&w.lab, w.mac_d), [false, true, false, false, false]);
    let revoke = Action::Revoke { cap: owner, actor: alice, keep: vec![], via: vec![] };
    run.ok("Alice's passkey revokes Carol's owner cap", w.lab.submit(mac, &[w.passkey_a], revoke))?;
    let after = w.lab.edit(mac, alice, lib.seeds, |i| {
        i.edit_todo(|t| t.notes = AFTER_TEXT.into());
    });
    run.ok("and writes a note on the seeds todo", after)?;
    w.lab.sync_all(24);
    let v = w.lab.state(mac);
    run.check("which ends Dave's caps with it", [owner, home, notes].iter().all(|&c| !v.live(c)));
    let now = (reads(&w.lab, w.mac_c), reads(&w.lab, w.mac_d));
    run.same("neither reads Alice's todos now", now, ([false; 5], [false; 5]));
    let blind = !contains(&w.lab.store(w.mac_c), AFTER_TEXT) && !contains(&w.lab.store(w.mac_d), AFTER_TEXT);
    run.check("nor what Alice wrote afterwards", blind);
    Ok(())
}

fn wide_caps(run: &mut Run) -> Done {
    let mut w = world();
    let lib = library(&mut w);
    let (alice, dave, mac) = (w.alice, w.dave, w.mac_a);
    let backup = cap(alice, vault(dave), Role::Read, Selector::All);
    run.ok("Alice gives Dave, her backup, read on her whole vault", w.lab.issue(mac, &[mac], backup))?;
    w.lab.sync_all(25);
    let none = lib.all().iter().all(|&e| stays(&w.lab, mac, e) == 1);
    run.check("a wide cap splits no cell: no entry moves", none);
    run.check("Dave reads every entry", lib.all().iter().all(|&e| w.lab.reads(w.mac_d, e)));
    let relayed = lib.all().iter().all(|&e| w.lab.fetched(w.server, e) > 0 && !w.lab.reads(w.server, e));
    run.check("the server, through avenCEO's wide relay cap, holds every entry and reads none", relayed);
    let public = cap(alice, Grantee::Public, Role::Read, by_id(lib.plan));
    run.ok("Alice makes her plan public", w.lab.issue(mac, &[mac], public))?;
    w.lab.sync_all(25);
    w.lab.sync(w.server, w.stranger);
    for d in [w.stranger, w.server] {
        let reads = lib.all().map(|e| w.lab.reads(d, e));
        let plan = [false, false, false, true, false];
        run.same(format!("{} reads the plan and nothing else", named(&w.lab, d)), reads, plan);
    }
    Ok(())
}

fn comeback(run: &mut Run) -> Done {
    let mut w = world();
    let lib = library(&mut w);
    let (alice, mac, phone) = (w.alice, w.mac_a, w.phone_a);
    let urgent = cap(alice, vault(w.bob), Role::Read, tagged("todo", "urgent"));
    let urgent = run.ok("Alice shares her urgent todos with Bob, read", w.lab.issue(mac, &[mac], urgent))?;
    let key = KeyFam::Cell(alice, CellId::of(alice, &[urgent]));
    run.ok("and tags the seeds todo urgent", w.lab.tag(mac, alice, lib.seeds, &["urgent"], &[]))?;
    w.lab.sync_all(26);
    run.check("Bob reads it while it is urgent", w.lab.reads(w.mac_b, lib.seeds));
    run.check("and her iPhone holds the cell's key", w.lab.holds_key(phone, KeyName::Scoped(key, 0)));
    run.ok("then she takes the tag off again", w.lab.tag(mac, alice, lib.seeds, &[], &["urgent"]))?;
    w.lab.sync_all(26);
    let gone = !reads_by(&w.lab, mac, w.mac_b, lib.seeds);
    run.check("and Bob no longer reads it: no entry is in his cap's cell now", gone);
    // her Mac, which moved the seeds todo out, drafts the removal: it comes after the move
    let remove = Action::RemoveDevice { vault: alice, device: phone, keep: vec![] };
    run.ok("Alice loses her iPhone, and her passkey removes it", w.lab.submit(mac, &[w.passkey_a], remove))?;
    w.lab.sync_all(26);
    let v = w.lab.state(mac);
    let what = "while the cell was empty, Alice's seed moved on and the cell's key didn't";
    run.same(what, (v.epoch(KeyFam::Seed(alice)), v.epoch(key)), (1, 0));
    run.ok("Alice tags the seeds todo urgent again", w.lab.tag(mac, alice, lib.seeds, &["urgent"], &[]))?;
    let after = w.lab.edit(mac, alice, lib.seeds, |i| {
        i.edit_todo(|t| t.notes = AFTER_TEXT.into());
    });
    run.ok("and writes a note on it", after)?;
    w.lab.sync_all(26);
    run.same("back in use, the cell moves on to a new generation", w.lab.state(mac).epoch(key), 1);
    run.check("which Bob reads", w.lab.reads(w.mac_b, lib.seeds) && w.lab.opens(w.mac_b, key));
    let blind = !w.lab.opens(phone, key) && !contains(&w.lab.store(phone), AFTER_TEXT);
    run.check("and the lost iPhone doesn't, though it held the cell's old key", blind);
    Ok(())
}
