//! A stored view retains cap-group bindings, both the sealed selector context and the restrictions of a
//! plain selector. Restoring an unchanged journal must not manufacture stewardship edits or change access.

use avendb::cast::{document, world};
use avendb::id::{BlobId, EditId, EntryId, SignerId};
use avendb::lab::{GroupShare, Lab, Warm};
use avendb::policy::{Level, State, Who};
use avendb::rules::{Cap, CapGroup, Op};
use avendb::slice::{Atom, Select, Selector};
use avendb::wire::Wire;
use serde_json::Value;

struct Observed {
    ids: Vec<EditId>,
    blobs: Vec<BlobId>,
    state: State,
    records: Vec<(EntryId, Value)>,
}

impl Observed {
    fn of(lab: &Lab, device: SignerId) -> Self {
        let records = lab
            .entries(device)
            .into_iter()
            .filter_map(|entry| lab.item(device, entry).map(|item| (entry, item.record())))
            .collect();
        Self {
            ids: lab.log(device).ids().to_vec(),
            blobs: lab.blob_ids(device),
            state: lab.state(device).clone(),
            records,
        }
    }

    fn assert_same(&self, lab: &Lab, device: SignerId) {
        let now = Self::of(lab, device);
        assert_eq!(
            now.ids, self.ids,
            "unchanged restore must not generate upkeep edits"
        );
        assert_eq!(
            now.blobs, self.blobs,
            "unchanged restore must not generate key blobs"
        );
        assert!(
            now.state == self.state,
            "the restored policy must be identical"
        );
        assert_eq!(
            now.records, self.records,
            "the same records must remain visible"
        );
    }
}

fn count(lab: &Lab, device: SignerId, key: &str) -> u64 {
    lab.perf(device)["counts"][key].as_u64().unwrap_or(0)
}

fn restore_unchanged(lab: &mut Lab, device: SignerId) {
    // Begin with a cold open, as a production upgrade does when its old derived view has another engine.
    let backup = lab.backup(device);
    let before = Observed::of(lab, device);
    lab.restore_backup(device, &backup);
    before.assert_same(lab, device);
    let held = lab.log(device).ids().len();
    let checked = [17; 40];
    let receipt = lab
        .warming(device, held, Some(checked))
        .expect("a cold open has a derived view to save");
    assert!(receipt.view.is_some());
    let warm = Warm {
        keys: receipt.keys.clone().into_iter().collect(),
        views: receipt.view.clone().into_iter().collect(),
    };
    lab.warmed(device, receipt);
    let used = count(lab, device, "replay: from its stored view");
    lab.restore_warm(device, backup.clone(), Some((checked, held)), &warm);
    assert_eq!(count(lab, device, "replay: from its stored view"), used + 1);
    before.assert_same(lab, device);

    // Invalid derived bytes fall back to the same authoritative journal and opened-key cache.
    let mut broken = warm;
    *broken.views[0].last_mut().expect("an encrypted view") ^= 1;
    let absent = count(lab, device, "stored view: none that opens");
    lab.restore_warm(device, backup, Some((checked, held)), &broken);
    assert_eq!(count(lab, device, "replay: from its stored view"), used + 1);
    assert_eq!(
        count(lab, device, "stored view: none that opens"),
        absent + 1
    );
    before.assert_same(lab, device);
}

fn group_roundtrip(public: bool) {
    let w = world();
    let (mut lab, mac_a, alice, mac_b, bob) = (w.lab, w.mac_a, w.alice, w.mac_b, w.bob);
    let inside = lab
        .create(
            mac_a,
            alice,
            alice,
            "document",
            &["shared"],
            document("Shared", "Before.", mac_a),
        )
        .unwrap();
    let outside = lab
        .create(
            mac_a,
            alice,
            alice,
            "document",
            &[],
            document("Private", "Must stay private.", mac_a),
        )
        .unwrap();
    let definition = CapGroup {
        name: "Tagged reader".into(),
        caps: vec![Cap {
            op: Op::Read,
            slice: Selector::AnyOf(vec![vec![Atom::TagHas("shared".into())]]),
        }],
        includes: vec![],
    };
    let group = lab.define_group(mac_a, alice, definition.clone()).unwrap();
    let who = if public {
        Who::Everyone
    } else {
        Who::Vault(bob)
    };
    let share = lab
        .issue_group(
            mac_a,
            &[mac_a],
            GroupShare {
                over: alice,
                who,
                name: "Read tagged documents".into(),
                select: Selector::All,
                group,
                level: Level::Read,
                parent: None,
                issuer: alice,
            },
        )
        .unwrap();
    let issued = &lab.state(mac_a).share(share).unwrap().share;
    assert_eq!(issued.group, Some(group));
    assert_eq!(
        matches!(Select::from_wire(&issued.select).unwrap(), Select::Clear(_)),
        public
    );
    if public {
        // Public shares are fetched only from vaults the reader follows; direct grants establish interest themselves.
        lab.follow(mac_b, &[alice]);
    }
    lab.sync(mac_a, mac_b);
    assert!(lab.reads(mac_b, inside));
    assert!(!lab.reads(mac_b, outside));
    let expected = lab.item(mac_b, inside).unwrap().record();

    restore_unchanged(&mut lab, mac_a);
    restore_unchanged(&mut lab, mac_b);
    for device in [mac_a, mac_b] {
        assert_eq!(
            lab.state(device).share(share).unwrap().share.group,
            Some(group)
        );
        assert_eq!(lab.group(device, alice, group), Some(&definition));
    }
    assert_eq!(lab.item(mac_b, inside).unwrap().record(), expected);
    assert!(lab.reads(mac_b, inside));
    assert!(
        !lab.reads(mac_b, outside),
        "the plain selector must not shed its cap-group restriction"
    );

    // A restored owner can still write and sync through the unchanged audience and selector binding.
    lab.edit(mac_a, alice, inside, |item| {
        item.set_text(2, "After warm restore.")
    })
    .unwrap();
    lab.sync(mac_a, mac_b);
    assert_eq!(
        lab.item(mac_b, inside).unwrap().record(),
        lab.item(mac_a, inside).unwrap().record()
    );
    assert!(!lab.reads(mac_b, outside));
}

#[test]
fn sealed_group_share_warm_restore_keeps_selector_context_and_generates_no_upkeep() {
    group_roundtrip(false);
}

#[test]
fn plain_group_share_warm_restore_keeps_restrictions_and_generates_no_upkeep() {
    group_roundtrip(true);
}
