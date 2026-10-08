//! The plan's acceptance scenarios on the Lab, numbered as in the plan, each tagged with the phase that turns it green.
//! `vault/spec/VaultSpec/Examples.lean` runs the same scenarios on the Lean model.

mod common;

use common::*;
use vault_db::branch::Repo;
use vault_db::doc::Item;
use vault_db::id::{GrantId, VaultId};
use vault_db::keys::{KeyName, KeyScope};
use vault_db::lab::{Lab, Tamper};
use vault_db::lens::{BlockV1, DocV1, KindV1, Status, TypeV2};
use vault_db::policy::{Action, Grantee, Kind, Principal, Refusal, Role, Scope};
use vault_db::sign::RecoveryCode;

#[test]
fn scenario_01_samuels_vault() {
    let mut lab = Lab::new();
    let (passkey, mac, phone) = (lab.passkey("Samuel"), lab.device("Samuel's Mac"), lab.device("Samuel's iPhone"));
    let samuel = human_on(&mut lab, passkey, &[mac, phone]);
    // the vault id is the hash of its genesis
    let genesis = lab.log(mac).ops()[0].clone();
    assert!(matches!(genesis.action, Action::Genesis { .. }));
    assert_eq!(VaultId::from(genesis.id()), samuel);
    assert_eq!(lab.log(mac).view().vault(samuel).map(|v| v.devices.clone()), Some(vec![mac, phone]));
    // the Mac can't add a device on its own, even one that countersigns
    let other = lab.device("another Mac");
    let add = Action::AddDevice { vault: samuel, device: other, seal_to: None };
    assert_eq!(lab.submit(mac, &[mac, other], add).err(), Some(Refusal::BelowThreshold));
}

#[test]
fn scenario_01_a_new_device_reaches_every_device() {
    let mut w = world();
    let coop = coop_on(&mut w);
    w.lab.sync_all(1);
    // Samuel adds an iPad with his passkey on his Mac, and the iPad countersigns
    let ipad = w.lab.device("Samuel's iPad");
    let add = Action::AddDevice { vault: w.samuel, device: ipad, seal_to: None };
    w.lab.submit(w.mac_s, &[w.passkey_s, ipad], add).unwrap();
    w.lab.sync_all(2);
    // his iPhone, the iPad itself and Bob's Mac (through the coop) all learn of it, and see it act for the coop
    for d in [w.phone_s, ipad, w.mac_b] {
        let v = w.lab.log(d).view();
        assert!(v.vault(w.samuel).is_some_and(|x| x.devices.contains(&ipad)), "{d:?}");
        assert!(v.acts_for(ipad, coop), "{d:?}");
    }
    // Carol, who shares nothing with Samuel yet, keeps the contact card she had
    let carol_knows = w.lab.log(w.mac_c).view().vault(w.samuel).map(|x| x.devices.clone());
    assert_eq!(carol_knows, Some(vec![w.mac_s, w.phone_s]));
}

#[test]
fn scenario_02_bob_carol_and_dave() {
    let w = world();
    for (d, v) in [(w.mac_b, w.bob), (w.mac_c, w.carol), (w.mac_d, w.dave)] {
        let view = w.lab.log(d).view();
        assert!(view.acts_for(d, v));
        assert_eq!(view.vault(v).map(|x| (x.kind, x.owners.len(), x.threshold)), Some((Kind::Human, 1, 1)));
    }
    let mut ids = [w.samuel, w.bob, w.carol, w.dave];
    ids.sort();
    assert!(ids.windows(2).all(|p| p[0] != p[1]));
}

#[test]
fn scenario_03_a_coop_of_two() {
    let mut w = world();
    // Bob has to consent to becoming an owner
    let owners = vec![Principal::Vault(w.samuel), Principal::Vault(w.bob)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 2, root: None, nonce: 0, seal_to: vec![] };
    assert_eq!(w.lab.submit(w.mac_s, &[w.passkey_s], genesis).err(), Some(Refusal::NoConsent));
    let coop = coop_on(&mut w);
    w.lab.sync_all(3);
    // Bob's Mac learns the coop and acts for it through Bob's vault, as both of Samuel's devices do through his
    let v = w.lab.log(w.mac_b).view();
    assert_eq!(v.vault(coop).map(|c| c.threshold), Some(2));
    assert!(v.acts_for(w.mac_b, coop) && v.acts_for(w.mac_s, coop) && v.acts_for(w.phone_s, coop));
    assert!(!v.acts_for(w.mac_c, coop) && !v.acts_for(w.passkey_c, coop));
    // Carol's Mac never even receives the coop's log
    assert!(w.lab.log(w.mac_c).view().vault(coop).is_none());
}

#[test]
#[ignore = "P3: keys"]
fn scenario_03_the_coop_key_opens_only_on_owner_devices() {
    let mut w = world();
    let coop = coop_on(&mut w);
    w.lab.sync_all(3);
    for d in [w.mac_b, w.mac_s, w.phone_s] {
        assert!(w.lab.opens(d, KeyScope::Vault(coop)));
    }
    for d in [w.mac_c, w.mac_d, w.stranger, w.server] {
        assert!(!w.lab.opens(d, KeyScope::Vault(coop)));
    }
}

#[test]
fn scenario_04_spaces() {
    let mut w = world();
    let coop = coop_on(&mut w);
    let handbook = space_on(&mut w, coop);
    let samuel = w.samuel;
    let notes = space_on(&mut w, samuel);
    w.lab.sync_all(4);
    // the Handbook's founding carries the chain Samuel's Mac → Samuel → Maia Coop, and Bob's Mac checked it
    let v = w.lab.log(w.mac_b).view();
    assert_eq!(v.space(handbook).map(|s| s.founder), Some(coop));
    assert!(v.acts_for(w.mac_s, w.samuel) && v.acts_for(w.mac_s, coop) && v.holds(coop, Scope::Space(handbook), Role::Owner));
    // Samuel's Notes are his alone: Bob's Mac doesn't even learn they exist
    assert!(v.space(notes).is_none());
}

#[test]
#[ignore = "P3: keys"]
fn scenario_05_write_and_sync() {
    let mut w = world();
    let h = handbook(&mut w);
    // Bob's Mac fetched Welcome without being asked, and reads it
    assert_eq!(text(&w.lab, w.mac_b, h.space, h.welcome, 2).as_deref(), Some(WELCOME_TEXT));
    // the server holds the edits and the sealed keys, opens none, and the plaintext appears nowhere in its store
    assert!(w.lab.fetched(w.server, h.space, h.welcome) > 0);
    assert!(!w.lab.opens(w.server, KeyScope::Entry(h.space, h.welcome)) && !w.lab.opens(w.server, KeyScope::Space(h.space)));
    assert!(!contains(&w.lab.store(w.server), WELCOME_TEXT));
}

#[test]
#[ignore = "P3: keys"]
fn scenario_06_one_document_via_caps() {
    let mut w = world();
    let h = handbook(&mut w);
    let carol = w.carol;
    w.lab.submit(w.mac_s, &[w.mac_s], grant(Scope::Entry(h.space, h.welcome), Role::Read, vault(carol), h.coop, None)).unwrap();
    w.lab.sync_all(6);
    // Carol's Mac fetches and reads Welcome, and never fetches Onboarding
    assert_eq!(text(&w.lab, w.mac_c, h.space, h.welcome, 2).as_deref(), Some(WELCOME_TEXT));
    assert_eq!(w.lab.fetched(w.mac_c, h.space, h.onboarding), 0);
    // her own Mac refuses her edit of Welcome, and so does every other peer when a patched app sends it anyway
    let edit = w.lab.edit(w.mac_c, carol, h.space, h.welcome, |i| i.set_text(2, "Carol was here"));
    assert_eq!(edit.err(), Some(Refusal::NoCap));
    for d in [w.mac_s, w.mac_b, w.server] {
        let forced = Tamper::Unchecked { signers: vec![w.mac_c], action: write(h.space, h.welcome, carol, 0) };
        assert_eq!(w.lab.tamper(d, forced), Err(Refusal::NoCap));
    }
}

#[test]
#[ignore = "P3: keys"]
fn scenario_07_public() {
    let mut w = world();
    let h = handbook(&mut w);
    let charter = w.lab.create(w.mac_s, h.coop, h.space, document("Charter", CHARTER_TEXT, w.mac_s)).unwrap();
    w.lab.submit(w.mac_s, &[w.mac_s], grant(Scope::Entry(h.space, charter), Role::Read, Grantee::Public, h.coop, None)).unwrap();
    w.lab.sync_all(7);
    w.lab.sync(w.server, w.stranger);
    // the stranger and the server read Charter, and nothing else
    for d in [w.stranger, w.server] {
        assert_eq!(text(&w.lab, d, h.space, charter, 2).as_deref(), Some(CHARTER_TEXT));
        assert!(text(&w.lab, d, h.space, h.welcome, 2).is_none());
    }
    // nobody outside the coop can edit it
    let stranger = w.lab.edit(w.stranger, h.coop, h.space, charter, |i| i.set_text(2, "defaced"));
    assert_eq!(stranger.err(), Some(Refusal::NotActing));
    let carol = w.carol;
    assert_eq!(w.lab.edit(w.mac_c, carol, h.space, charter, |i| i.set_text(2, "defaced")).err(), Some(Refusal::NoCap));
}

#[test]
#[ignore = "P5: branches"]
fn scenario_08_branches() {
    let mut repo = Repo::new(document("Welcome", WELCOME_TEXT, MAC_S));
    repo.commit("main", "Welcome");
    // Bob edits on a branch; main stays unchanged until Samuel merges it
    repo.branch("draft", "main");
    repo.item_mut("draft").set_text(2, "Hello, Bob here");
    repo.commit("draft", "Bob's draft");
    assert_eq!(repo.item("main").as_document().map(|d| d.blocks[1].text.clone()).as_deref(), Some(WELCOME_TEXT));
    repo.merge("draft", "main");
    assert_eq!(repo.item("main").as_document(), repo.item("draft").as_document());
    // a second branch is promoted: main ends with exactly its content
    repo.branch("rewrite", "main");
    repo.item_mut("rewrite").set_text(2, "Welcome to the coop");
    repo.commit("rewrite", "rewrite");
    repo.item_mut("main").push_block(paragraph(3, "an edit on main meanwhile"));
    repo.commit("main", "meanwhile");
    repo.promote("rewrite", "main");
    assert_eq!(repo.item("main").as_document(), repo.item("rewrite").as_document());
    // a bad commit is reverted
    let good = repo.item("main").as_document();
    repo.item_mut("main").set_text(2, "oops");
    let bad = repo.commit("main", "bad");
    repo.revert("main", &bad);
    assert_eq!(repo.item("main").as_document(), good);
    // no version is lost from history
    let log: Vec<String> = repo.log("main").into_iter().map(|c| c.message).collect();
    for m in ["Welcome", "Bob's draft", "rewrite", "meanwhile", "bad"] {
        assert!(log.iter().any(|l| l == m), "{m} missing from {log:?}");
    }
}

#[test]
#[ignore = "P4: schemas"]
fn scenario_09_schema_v2() {
    let block = |id, kind, text: &str| BlockV1 { id, kind, text: text.into() };
    let v1 = DocV1 {
        title: "Welcome".into(),
        blocks: vec![block(1, KindV1::H1, "Welcome"), block(2, KindV1::P, WELCOME_TEXT), block(3, KindV1::Li, "Water the seedlings")],
    };
    // Welcome as an app still on v1 wrote it; v2 apps read it through the lens
    let mut repo = Repo::new(Item::written_v1(&v1, MAC_S));
    let as_v2 = repo.item("main").as_document().unwrap();
    assert_eq!((as_v2.blocks[0].r#type, as_v2.blocks[0].level), (TypeV2::Heading, Some(1)));
    // Samuel migrates Welcome on a branch, checks it and merges
    repo.branch("v2", "main");
    repo.item_mut("v2").migrate();
    repo.commit("v2", "migrate Welcome to v2");
    assert_eq!(repo.item("v2").as_document(), Some(as_v2));
    repo.merge("v2", "main");
    // a v1 app still reads Welcome through the lens, and the round trip leaves the v1 content unchanged
    assert_eq!(repo.item("main").as_document_v1(), Some(v1));
}

#[test]
#[ignore = "P3: keys"]
fn scenario_10_revoke_carol() {
    let mut w = world();
    let h = handbook(&mut w);
    let carol = w.carol;
    let read = grant(Scope::Entry(h.space, h.welcome), Role::Read, vault(carol), h.coop, None);
    let carol_read = GrantId::from(w.lab.submit(w.mac_s, &[w.mac_s], read).unwrap());
    w.lab.sync_all(10);
    let key = KeyScope::Entry(h.space, h.welcome);
    let before = w.lab.log(w.mac_s).view().epoch(key);
    let had = w.lab.fetched(w.mac_c, h.space, h.welcome);
    w.lab.submit(w.mac_s, &[w.mac_s], Action::Revoke { grant: carol_read, actor: h.coop, keep: vec![] }).unwrap();
    w.lab.edit(w.mac_s, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(10);
    // Welcome's key rotated: Carol can't open it, Bob can
    assert_eq!(w.lab.log(w.mac_s).view().epoch(key), before + 1);
    assert!(!w.lab.opens(w.mac_c, key) && w.lab.opens(w.mac_b, key));
    // she keeps what she had, her Mac stopped fetching, and the new edit never reaches her
    assert_eq!(text(&w.lab, w.mac_c, h.space, h.welcome, 2).as_deref(), Some(WELCOME_TEXT));
    assert_eq!(w.lab.fetched(w.mac_c, h.space, h.welcome), had);
    assert!(!contains(&w.lab.store(w.mac_c), AFTER_TEXT));
}

#[test]
#[ignore = "P3: keys"]
fn scenario_11_lost_iphone() {
    let mut w = world();
    let h = handbook(&mut w);
    let keys = [KeyScope::Vault(w.samuel), KeyScope::Vault(h.coop), KeyScope::Space(h.space), KeyScope::Space(h.notes)];
    let before = keys.map(|k| w.lab.log(w.mac_s).view().epoch(k));
    let (samuel, phone) = (w.samuel, w.phone_s);
    w.lab.submit(w.mac_s, &[w.passkey_s], Action::RemoveDevice { vault: samuel, device: phone, keep: vec![] }).unwrap();
    w.lab.edit(w.mac_s, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(11);
    // every key the iPhone could open rotated
    let v = w.lab.log(w.mac_s).view();
    for (k, b) in keys.iter().zip(before) {
        assert_eq!(v.epoch(*k), b + 1, "{k:?}");
    }
    // the iPhone opens nothing written afterwards, while the Mac and Bob's Mac do
    let welcome = KeyScope::Entry(h.space, h.welcome);
    assert!(!w.lab.opens(phone, welcome) && w.lab.opens(w.mac_s, welcome) && w.lab.opens(w.mac_b, welcome));
    assert!(!contains(&w.lab.store(phone), AFTER_TEXT));
    // and its later edits are rejected everywhere
    let forced = Tamper::Unchecked { signers: vec![phone], action: write(h.space, h.welcome, h.coop, 1) };
    assert_eq!(w.lab.tamper(w.mac_b, forced), Err(Refusal::NotActing));
}

#[test]
#[ignore = "P3: keys"]
fn scenario_12_bob_leaves() {
    let mut w = world();
    let h = handbook(&mut w);
    let bobs = w.lab.edit(w.mac_b, h.coop, h.space, h.welcome, |i| i.set_text(2, "Bob's words")).unwrap();
    w.lab.sync_all(12);
    let keys = [KeyScope::Vault(h.coop), KeyScope::Space(h.space)];
    let before = keys.map(|k| w.lab.log(w.mac_s).view().epoch(k));
    // Bob leaves on his own, with his passkey; his removal had seen his edit
    let bob = w.bob;
    let leave = Action::RemoveOwner { vault: h.coop, owner: Principal::Vault(bob), keep: vec![bobs] };
    w.lab.submit(w.mac_b, &[w.passkey_b], leave).unwrap();
    w.lab.edit(w.mac_s, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(12);
    let v = w.lab.log(w.mac_s).view();
    // the threshold drops to 1, and the keys of the coop and the Handbook rotate
    assert_eq!(v.vault(h.coop).map(|c| c.threshold), Some(1));
    assert_eq!(keys.map(|k| v.epoch(k)), before.map(|e| e + 1));
    // Bob can't read new edits
    assert!(!w.lab.opens(w.mac_b, KeyScope::Entry(h.space, h.welcome)));
    assert!(!contains(&w.lab.store(w.mac_b), AFTER_TEXT));
    // his earlier edit stays, attributed to his Mac
    assert!(v.writes(h.space, h.welcome).contains(&bobs));
    let op = w.lab.log(w.mac_s).ops().iter().find(|o| o.id() == bobs).cloned().unwrap();
    assert_eq!(op.author, w.mac_b);
}

#[test]
#[ignore = "P6: offline devices and random delivery orders"]
fn scenario_13_offline_conflicts() {
    for seed in 0..8 {
        let mut w = world();
        let h = handbook(&mut w);
        let carol = w.carol;
        let write_cap = grant(Scope::Entry(h.space, h.welcome), Role::Write, vault(carol), h.coop, None);
        let carol_write = GrantId::from(w.lab.submit(w.mac_s, &[w.mac_s], write_cap).unwrap());
        w.lab.sync_all(seed);
        // Carol edits offline while the coop revokes her
        w.lab.set_online(w.mac_c, false);
        let carols = w.lab.edit(w.mac_c, carol, h.space, h.welcome, |i| i.set_text(2, "Carol, offline")).unwrap();
        w.lab.submit(w.mac_s, &[w.mac_s], Action::Revoke { grant: carol_write, actor: h.coop, keep: vec![] }).unwrap();
        // Samuel and Bob edit the same block at the same moment
        w.lab.set_online(w.mac_b, false);
        w.lab.edit(w.mac_s, h.coop, h.space, h.welcome, |i| i.set_text(2, "Samuel's version")).unwrap();
        w.lab.edit(w.mac_b, h.coop, h.space, h.welcome, |i| i.set_text(2, "Bob's version")).unwrap();
        // everyone comes back and receives everything, in an order drawn from the seed
        w.lab.set_online(w.mac_c, true);
        w.lab.set_online(w.mac_b, true);
        w.lab.sync_all(seed);
        // Carol's unseen edit is dropped everywhere, and every device shows the same Welcome
        for d in [w.mac_s, w.phone_s, w.mac_b, w.mac_c] {
            assert!(!w.lab.log(d).view().writes(h.space, h.welcome).contains(&carols), "seed {seed}");
        }
        let shown = [w.mac_s, w.phone_s, w.mac_b].map(|d| w.lab.item(d, h.space, h.welcome).and_then(|i| i.as_document()));
        assert!(shown.iter().all(|s| s.is_some() && *s == shown[0]), "seed {seed}");
    }
}

#[test]
#[ignore = "P3: keys"]
fn scenario_14_tampering() {
    let mut w = world();
    let h = handbook(&mut w);
    // a forged signature: Samuel's passkey "adding" the stranger's device to his vault
    let forged = Tamper::ForgedSignature { claimed: w.passkey_s, action: Action::AddDevice { vault: w.samuel, device: w.stranger, seal_to: None } };
    assert_eq!(w.lab.tamper(w.mac_b, forged), Err(Refusal::BadSignature));
    // a made-up chain: the stranger's device writing as the coop
    let chain = Tamper::Unchecked { signers: vec![w.stranger], action: write(h.space, h.welcome, h.coop, 0) };
    assert_eq!(w.lab.tamper(w.mac_b, chain), Err(Refusal::NotActing));
    // a changed ciphertext: the author's signature no longer covers it
    let last = *w.lab.log(w.mac_s).view().writes(h.space, h.welcome).last().unwrap();
    assert_eq!(w.lab.tamper(w.mac_b, Tamper::ChangedCiphertext(last)), Err(Refusal::BadSignature));
    // an old sealed key replayed after a revocation opens nothing new
    let carol = w.carol;
    let read = grant(Scope::Entry(h.space, h.welcome), Role::Read, vault(carol), h.coop, None);
    let carol_read = GrantId::from(w.lab.submit(w.mac_s, &[w.mac_s], read).unwrap());
    w.lab.sync_all(14);
    w.lab.submit(w.mac_s, &[w.mac_s], Action::Revoke { grant: carol_read, actor: h.coop, keep: vec![] }).unwrap();
    w.lab.edit(w.mac_s, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(14);
    let old = KeyName::Scoped(KeyScope::Entry(h.space, h.welcome), 0);
    let _ = w.lab.tamper(w.mac_c, Tamper::ReplayedSeal { key: old, to: w.mac_c });
    w.lab.sync_all(14);
    assert!(!w.lab.opens(w.mac_c, KeyScope::Entry(h.space, h.welcome)));
    assert!(!contains(&w.lab.store(w.mac_c), AFTER_TEXT));
}

#[test]
#[ignore = "P3: keys"]
fn scenario_15_social_todo() {
    let mut w = world();
    let t = todos_on(&mut w);
    w.lab.sync_all(15);
    // Bob edits the door todo and checks it off; everyone it is shared with sees it done
    let bob = w.bob;
    w.lab.edit(w.mac_b, bob, t.space, t.door, |i| i.set_status(Status::Done)).unwrap();
    w.lab.sync_all(15);
    for d in [w.mac_s, w.mac_c] {
        assert_eq!(status(&w.lab, d, t.space, t.door), Some(Status::Done));
    }
    // Carol can only read it
    let carol = w.carol;
    assert_eq!(w.lab.edit(w.mac_c, carol, t.space, t.door, |i| i.set_status(Status::Open)).err(), Some(Refusal::NoCap));
    // every coop owner's device can share it further, acting for the coop
    let (dave, phone) = (w.dave, w.phone_s);
    let share = grant(Scope::Entry(t.space, t.door), Role::Read, vault(dave), t.coop, Some(t.coop_owner));
    assert!(w.lab.submit(phone, &[phone], share).is_ok());
    w.lab.sync_all(15);
    assert_eq!(status(&w.lab, w.mac_d, t.space, t.door), Some(Status::Done));
    // and none of them ever receives the other two todos
    for d in [w.mac_b, w.mac_c, w.mac_d] {
        for e in [t.seeds, t.solar] {
            assert_eq!(w.lab.fetched(d, t.space, e), 0);
        }
    }
}

#[test]
#[ignore = "P3: keys"]
fn scenario_16_roles_change_on_one_todo() {
    let mut w = world();
    let t = todos_on(&mut w);
    let door = Scope::Entry(t.space, t.door);
    let key = KeyScope::Entry(t.space, t.door);
    let (carol, dave, samuel) = (w.carol, w.dave, w.samuel);
    w.lab.sync_all(16);
    // acting for the coop, Bob gives Dave read
    w.lab.submit(w.mac_b, &[w.mac_b], grant(door, Role::Read, vault(dave), t.coop, Some(t.coop_owner))).unwrap();
    // Samuel raises Carol to write and takes Bob's own write away
    w.lab.submit(w.mac_s, &[w.mac_s], grant(door, Role::Write, vault(carol), samuel, None)).unwrap();
    w.lab.submit(w.mac_s, &[w.mac_s], Action::Revoke { grant: t.bob_write, actor: samuel, keep: vec![] }).unwrap();
    w.lab.sync_all(16);
    // Bob still reaches the todo through the coop, so its key didn't rotate; Dave reads it, Carol writes it
    let before = w.lab.log(w.mac_s).view().epoch(key);
    assert_eq!(before, 0);
    assert!(w.lab.opens(w.mac_b, key) && w.lab.opens(w.mac_d, key));
    assert!(w.lab.edit(w.mac_b, t.coop, t.space, t.door, |i| i.set_status(Status::Doing)).is_ok());
    assert!(w.lab.edit(w.mac_c, carol, t.space, t.door, |i| i.set_status(Status::Done)).is_ok());
    w.lab.sync_all(16);
    let had = (w.lab.fetched(w.mac_b, t.space, t.door), w.lab.fetched(w.mac_d, t.space, t.door));
    // Samuel's passkey takes the coop's owner cap away, which also ends the read Bob gave Dave
    w.lab.submit(w.mac_s, &[w.passkey_s], Action::Revoke { grant: t.coop_owner, actor: samuel, keep: vec![] }).unwrap();
    w.lab.edit(w.mac_s, samuel, t.space, t.door, |i| i.set_status(Status::Open)).unwrap();
    w.lab.sync_all(16);
    // only now do Bob and Dave lose the todo: its key rotates and their devices stop syncing it
    assert_eq!(w.lab.log(w.mac_s).view().epoch(key), before + 1);
    assert!(!w.lab.opens(w.mac_b, key) && !w.lab.opens(w.mac_d, key));
    assert!(w.lab.opens(w.mac_c, key) && w.lab.opens(w.mac_s, key));
    assert_eq!((w.lab.fetched(w.mac_b, t.space, t.door), w.lab.fetched(w.mac_d, t.space, t.door)), had);
    // and their later edits are rejected
    assert_eq!(w.lab.edit(w.mac_b, t.coop, t.space, t.door, |i| i.set_status(Status::Done)).err(), Some(Refusal::NoCap));
    let forced = Tamper::Unchecked { signers: vec![w.mac_b], action: write(t.space, t.door, t.coop, before + 1) };
    assert_eq!(w.lab.tamper(w.mac_s, forced), Err(Refusal::NoCap));
}

#[test]
#[ignore = "P6: offline devices"]
fn scenario_17_peer_to_peer() {
    let mut w = world();
    let t = todos_on(&mut w);
    // the server is offline; Carol's Mac syncs the todo straight from Samuel's Mac
    w.lab.set_online(w.server, false);
    w.lab.sync(w.mac_s, w.mac_c);
    assert!(status(&w.lab, w.mac_c, t.space, t.door).is_some());
    for e in [t.seeds, t.solar] {
        assert_eq!(w.lab.fetched(w.mac_c, t.space, e), 0);
    }
    // a device without a cap that asks for it gets nothing
    w.lab.sync(w.mac_s, w.stranger);
    assert_eq!(w.lab.fetched(w.stranger, t.space, t.door), 0);
    // Bob edits it on his Mac; Bob's and Carol's Macs then sync directly and show the same todo
    w.lab.sync(w.mac_s, w.mac_b);
    let bob = w.bob;
    w.lab.edit(w.mac_b, bob, t.space, t.door, |i| i.set_status(Status::Doing)).unwrap();
    w.lab.sync(w.mac_b, w.mac_c);
    w.lab.sync(w.mac_c, w.mac_b);
    assert_eq!(status(&w.lab, w.mac_c, t.space, t.door), Some(Status::Doing));
    let todo = |d| w.lab.item(d, t.space, t.door).and_then(|i| i.as_todo());
    assert_eq!(todo(w.mac_c), todo(w.mac_b));
    assert_eq!(w.lab.fetched(w.server, t.space, t.door), 0);
}

#[test]
fn scenario_18_recovery_after_losing_every_device() {
    let mut w = world();
    let coop = coop_on(&mut w);
    let samuel = w.samuel;
    w.lab.sync_all(18);
    // Samuel loses his Mac and his iPhone; his passkey, his vault's root, lives on in his iCloud Keychain
    for s in [w.mac_s, w.phone_s] {
        w.lab.lose(s);
    }
    // on a new Mac, Bob's Mac, which acts for the coop, hands over his vault's log; the passkey adds the new Mac and
    // removes the lost devices
    let new_mac = w.lab.device("Samuel's new Mac");
    w.lab.share_contact(w.mac_b, new_mac, samuel);
    let steps = [
        (vec![w.passkey_s, new_mac], Action::AddDevice { vault: samuel, device: new_mac, seal_to: None }),
        (vec![w.passkey_s], Action::RemoveDevice { vault: samuel, device: w.mac_s, keep: vec![] }),
        (vec![w.passkey_s], Action::RemoveDevice { vault: samuel, device: w.phone_s, keep: vec![] }),
    ];
    for (signers, action) in steps {
        w.lab.submit(new_mac, &signers, action).unwrap();
    }
    // the new Mac shows Bob his vault's log again, as a contact card; from then on they sync as before
    w.lab.share_contact(new_mac, w.mac_b, samuel);
    w.lab.sync_all(19);
    let v = w.lab.log(w.mac_b).view();
    assert!(v.acts_for(new_mac, samuel) && v.acts_for(new_mac, coop));
    assert!(!v.acts_for(w.mac_s, coop) && !v.acts_for(w.phone_s, coop));
    assert!(w.lab.log(new_mac).view().vault(coop).is_some());
}

#[test]
fn scenario_18_a_recovery_code_when_the_passkey_is_lost_too() {
    let mut w = world();
    let coop = coop_on(&mut w);
    let samuel = w.samuel;
    // Samuel writes down a recovery code; its signer becomes a second owner of his vault, never its root
    let code = w.lab.recovery_code();
    let written = code.to_string();
    let recovery = code.signer().id();
    let add = Action::AddOwner { vault: samuel, owner: Principal::Signer(recovery), seal_to: None };
    w.lab.submit(w.mac_s, &[w.passkey_s, recovery], add).unwrap();
    w.lab.sync_all(18);
    // he loses his passkey too, with every device
    for s in [w.passkey_s, w.mac_s, w.phone_s, recovery] {
        w.lab.lose(s);
    }
    // on a new Mac he types the code in, and Bob's Mac hands over his vault's log
    let new_mac = w.lab.device("Samuel's new Mac");
    assert_eq!(w.lab.use_code(&RecoveryCode::parse(&written.to_lowercase()).unwrap()), recovery);
    w.lab.share_contact(w.mac_b, new_mac, samuel);
    // the code adds a new passkey and the new Mac; the new passkey removes the lost devices
    let new_passkey = w.lab.passkey("Samuel's new passkey");
    let steps = [
        (vec![recovery, new_passkey], Action::AddOwner { vault: samuel, owner: Principal::Signer(new_passkey), seal_to: None }),
        (vec![recovery, new_mac], Action::AddDevice { vault: samuel, device: new_mac, seal_to: None }),
        (vec![new_passkey], Action::RemoveDevice { vault: samuel, device: w.mac_s, keep: vec![] }),
        (vec![new_passkey], Action::RemoveDevice { vault: samuel, device: w.phone_s, keep: vec![] }),
    ];
    for (signers, action) in steps {
        w.lab.submit(new_mac, &signers, action).unwrap();
    }
    // only the root hands the root on, so the lost passkey stays the root
    let hand_on = Action::SetRoot { vault: samuel, root: Some(new_passkey), keep: vec![] };
    assert_eq!(w.lab.submit(new_mac, &[recovery, new_passkey], hand_on).err(), Some(Refusal::NotRoot));
    w.lab.share_contact(new_mac, w.mac_b, samuel);
    w.lab.sync_all(19);
    let v = w.lab.log(w.mac_b).view();
    assert!(v.acts_for(new_mac, samuel) && v.acts_for(new_mac, coop));
    assert!(!v.acts_for(w.mac_s, coop) && !v.acts_for(w.phone_s, coop));
    assert!(v.approves(&[recovery], Principal::Vault(samuel)) && v.approves(&[new_passkey], Principal::Vault(samuel)));
    assert_eq!(v.vault(samuel).and_then(|x| x.root), Some(w.passkey_s));
}
