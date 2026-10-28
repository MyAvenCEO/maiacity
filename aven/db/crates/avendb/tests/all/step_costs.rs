//! What a step costs, as `vectors/step_costs.json` (`StepCostVectors.lean`) says: the entry keys a device derives
//! (`KeyDerivation.lean`, P2) and the cap group writes a show judges (`CapGroupsOnce.lean`, P1), counted, not timed.
#![cfg(debug_assertions)]

use avendb::cast::{document, human_on, paragraph};
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::keys::{KeyFam, KeyName};
use avendb::lab::{CatchUp, Lab};
use avendb::policy::{Action, Sharing};
use avendb::rules::{Cap, CapGroup, Op};
use avendb::slice::Selector;
use serde_json::Value;

fn vectors() -> Value {
    let text = include_str!("../../../../spec/vectors/step_costs.json");
    serde_json::from_str(text).expect("the step cost vectors")
}

fn n(v: &Value, k: &str) -> u64 {
    v[k].as_u64().unwrap_or_else(|| panic!("{k} in {v}"))
}

fn count(lab: &Lab, d: SignerId, k: &str) -> u64 {
    lab.perf(d)["counts"][k].as_u64().unwrap_or(0)
}

/// A catch-up of `d` a step at a time, with a small budget, so that it shows over many calls.
fn catch_up(lab: &mut Lab, d: SignerId) {
    for _ in 0..100_000 {
        if matches!(lab.catch_up_step(d, 1), CatchUp::Caught(_)) {
            return;
        }
    }
    panic!("a catch-up ends");
}

/// Alice's vault on her Mac, her phone and `writers` devices of hers, each added before any writes.
fn vault(writers: usize) -> (Lab, SignerId, SignerId, VaultId, Vec<SignerId>) {
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let phone = lab.device_of(passkey, "Alice's phone");
    let alice = human_on(&mut lab, passkey, &[mac, phone]);
    let ws: Vec<SignerId> = (0..writers).map(|i| lab.device_of(passkey, &format!("Alice's writer {i}"))).collect();
    for &w in &ws {
        let add = Action::Share(Sharing::Device { vault: alice, device: w, seal_to: None });
        lab.submit(mac, &[passkey, w], add).expect("a writer added");
        lab.sync(mac, w);
    }
    (lab, mac, phone, alice, ws)
}

/// Each writer writes `entries` entries, three writes each, before it syncs with any other device, so that each makes
/// its own key of the vault's audience; the phone takes them all and catches up. The keys it derives lie between what
/// the model says where the first audience key is a writer's and where it is none of theirs, and it holds `held` keys of
/// the audience, every one of which the rule before derived every entry's key under.
#[test]
fn a_device_derives_the_keys_its_edits_are_under() {
    for case in vectors()["keys"].as_array().expect("key cases") {
        let (writers, per) = (n(case, "writers") as usize, n(case, "entries") as usize);
        let (mut lab, mac, phone, alice, ws) = vault(writers);
        let derived = |lab: &Lab| count(lab, phone, "keys derived") + count(lab, phone, "keys derived for a body or box");
        let before = derived(&lab);
        let mut first: Option<EntryId> = None;
        for (i, &w) in ws.iter().enumerate() {
            for e in 0..per {
                let doc = document(&format!("Doc {i}.{e}"), "Before.", w);
                let entry = lab.create(w, alice, alice, "doc", &[], doc).expect("a document");
                first.get_or_insert(entry);
                for k in 0..2 {
                    lab.edit(w, alice, entry, |it| it.push_block(paragraph(100 + k, "More."))).expect("an edit");
                }
            }
        }
        let held = n(case, "held") as usize;
        // a case whose vault holds a key of its own beside the writers': the Mac writes before them
        if held > writers {
            let doc = document("The Mac's", "Before.", mac);
            lab.create(mac, alice, alice, "doc", &[], doc).expect("the Mac's document");
            lab.sync(mac, phone);
        }
        for &w in &ws {
            lab.sync(w, phone);
        }
        catch_up(&mut lab, phone);
        let derived = derived(&lab) - before;
        let st = lab.state(phone);
        let en = st.entry(first.expect("an entry")).expect("the phone reads it");
        let audience = KeyName::Scoped(KeyFam::Audience(alice, en.audience()), 0);
        let name = case["name"].as_str().unwrap_or_default();
        assert_eq!(lab.keys_held(phone, audience), held, "{name}: keys of the audience");
        let mac_entry = (held > writers) as u64;
        let (least, most) = (n(case, "least"), n(case, "most"));
        assert!((least..=most).contains(&derived), "{name}: {derived} keys derived, the model says {least}..={most}");
        assert!(derived < n(case, "before") || held == 1, "{name}: fewer than the {} before", n(case, "before"));
        // and it reads every entry
        assert_eq!(lab.entries(phone).iter().filter(|e| lab.item(phone, **e).is_some()).count(), writers * per + mac_entry as usize);
    }
}

fn group(name: &str, k: usize) -> CapGroup {
    let read = Cap { op: Op::of_json(&serde_json::json!({ "op": "read" })).expect("an op"), slice: Selector::All };
    CapGroup { name: format!("{name} {k}"), caps: vec![read], includes: vec![] }
}

/// Two cap groups of `writes` writes in all; the phone catches up over many shows and judges them once; a write to a
/// group, and it judges them once more.
#[test]
fn a_show_judges_unchanged_cap_groups_once() {
    for case in vectors()["caps"].as_array().expect("cap cases") {
        let writes = n(case, "writes") as usize;
        let (mut lab, mac, phone, alice, _) = vault(0);
        let a = lab.define_group(mac, alice, group("A", 0)).expect("group A");
        let b = lab.define_group(mac, alice, group("B", 0)).expect("group B");
        for k in 2..writes {
            let (g, name) = if k % 2 == 0 { (a, "A") } else { (b, "B") };
            lab.redefine_group(mac, alice, g, group(name, k)).expect("a new version");
        }
        for e in 0..20 {
            lab.create(mac, alice, alice, "doc", &[], document(&format!("Doc {e}"), "Before.", mac)).expect("a document");
        }
        let before = count(&lab, phone, "show: cap group writes judged");
        lab.sync(mac, phone);
        catch_up(&mut lab, phone);
        assert_eq!(lab.groups(phone, alice).len(), 2, "the phone reads both groups");
        lab.redefine_group(mac, alice, a, group("A", writes)).expect("one more version");
        lab.sync(mac, phone);
        catch_up(&mut lab, phone);
        let judged = count(&lab, phone, "show: cap group writes judged") - before;
        let name = case["name"].as_str().unwrap_or_default();
        assert_eq!(judged, n(case, "judged"), "{name}: cap group writes judged");
        assert_eq!(lab.group(phone, alice, a), Some(&group("A", writes)), "{name}: the version in force");
    }
}
