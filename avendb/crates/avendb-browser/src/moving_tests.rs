//! The migration probe skips no-work pulls, but never grants permission or replaces freshness for real work.
use super::*;
use avendb::sign::Suite;

fn modern() -> (Lab, SignerId, SignerId, VaultId) {
    let mut lab = Lab::with_entropy([193; 32]);
    let owner = lab.passkey_from_in("owner", [194; 32], Suite::MlDsa);
    let me = lab.device_with_in("this device", [195; 32], Suite::MlDsa);
    let mine = cast::human_on(&mut lab, owner, &[me]);
    (lab, owner, me, mine)
}

fn browser(node: Node, passkey: SignerId, opener: Vec<SignerId>) -> Device {
    Device {
        node: Arc::new(node), passkey, p256: [0; 33], mask: [0; 32], shelf: None,
        name: "preflight fixture".into(), relay: "https://localhost:1".parse().unwrap(),
        closed: watch::Sender::new(false), opener,
    }
}

async fn pages(node: &Node) -> u64 {
    let network = node.network().await;
    ["peers", "gone"].into_iter().flat_map(|key| network[key].as_array().unwrap())
        .map(|p| p["pulled"]["pages"].as_u64().unwrap_or(0)).sum()
}

#[tokio::test]
async fn no_work_checks_do_not_repeat_full_pulls_from_a_known_peer() {
    let (mut lab, owner, me, mine) = modern();
    let other = lab.device_with_in("other device", [196; 32], Suite::MlDsa);
    lab.submit(me, &[owner, other], Action::Share(Sharing::Device { vault: mine, device: other, seal_to: None })).unwrap();
    lab.sync_all(1);
    let opts = || Options { lazy: true, ..Options::local() };
    let peer = Node::spawn(lab.split(other, &[], [197; 32]), other, opts()).await.unwrap();
    let node = Node::spawn(lab.split(me, &[owner], [198; 32]), me, opts()).await.unwrap();
    node.try_know(peer.endpoint().addr()).unwrap();
    node.sync_with(peer.id()).await.unwrap();
    let device = browser(node, owner, vec![owner]);
    let before = (device.node.sent().0, pages(&device.node).await);
    for _ in 0..3 { assert_eq!(device.moving().await.unwrap(), None); }
    assert_eq!((device.node.sent().0, pages(&device.node).await), before,
        "routine no-work checks neither ask for nor accept another edit page");
    device.close().await.unwrap();
    peer.shutdown().await.unwrap();
}

#[tokio::test]
async fn an_eligible_local_move_still_requires_freshness_while_offline() {
    let mut lab = Lab::with_entropy([201; 32]);
    let old = lab.passkey_from_in("owner", [202; 32], Suite::SlhDsa);
    let next = lab.passkey_from_in("next owner", [202; 32], Suite::MlDsa);
    let me = lab.device_with_in("this device", [203; 32], Suite::MlDsa);
    cast::human_on(&mut lab, old, &[me]);
    assert_eq!(lab.moves(me, None), vec![(old, next)]);
    assert!(local_move_pending(&lab, me, &[old, next], None));
    let node = Node::spawn(lab.split(me, &[old, next], [204; 32]), me,
        Options { lazy: true, ..Options::local() }).await.unwrap();
    let device = browser(node, old, vec![old, next]);
    assert!(device.moving().await.unwrap_err().to_string().contains(NOT_CAUGHT_UP));
    device.close().await.unwrap();
}

#[test]
fn retirement_probe_covers_every_live_peer_subset_and_stays_fail_closed() {
    let (mut lab, owner, me, mine) = modern();
    let old = lab.device_with_in("old server", [205; 32], Suite::SlhDsa);
    let aven = cast::claim_on(&mut lab, me, owner, mine, old);
    let next = lab.device_with_in("new server", [205; 32], Suite::MlDsa);
    lab.submit(me, &[owner, next], Action::Share(Sharing::Device { vault: aven, device: next, seal_to: None })).unwrap();
    assert!(lab.moves(me, None).is_empty());
    assert!(lab.retires(me, &BTreeSet::new()).is_empty());
    assert!(!lab.retires(me, &BTreeSet::from([next])).is_empty());
    // No opener means a checkpoint cannot mask a missed retirement candidate in this probe.
    assert!(local_move_pending(&lab, me, &[], None));
    let old_phone = lab.device_with_in("old phone", [206; 32], Suite::SlhDsa);
    lab.submit(me, &[owner, old_phone], Action::Share(Sharing::Device { vault: mine, device: old_phone, seal_to: None })).unwrap();
    let all = [me, old, next, old_phone];
    let empty = lab.retires(me, &BTreeSet::new());
    let maximal = lab.retires(me, &lab.governed_devices(me));
    for bits in 0..(1 << all.len()) {
        let live: BTreeSet<_> = all.into_iter().enumerate().filter_map(|(i, d)| (bits & (1 << i) != 0).then_some(d)).collect();
        for candidate in lab.retires(me, &live) {
            assert!(empty.contains(&candidate) || maximal.contains(&candidate), "subset {bits}: {candidate:?}");
        }
    }
    // The offline phone is a candidate, never permission to remove it without the governed server's frontier.
    let pending = drafted(&lab, me, &[owner], None, &[], &BTreeMap::new()).unwrap().unwrap();
    assert!(pending.moving.behind);
    assert!(pending.drafts.is_empty());
}

#[test]
fn a_standalone_checkpoint_is_not_hidden_by_the_no_move_probe() {
    let mut lab = Lab::with_entropy([207; 32]);
    let old = lab.passkey_from_in("owner", [208; 32], Suite::SlhDsa);
    let me = lab.device_with_in("this device", [209; 32], Suite::MlDsa);
    let mine = cast::human_on(&mut lab, old, &[me]);
    let next = lab.passkey_from_in("next owner", [208; 32], Suite::MlDsa);
    lab.submit(me, &[old, next], Action::Share(Sharing::Owner { vault: mine, owner: Principal::Signer(next), seal_to: None })).unwrap();
    assert!(lab.moves(me, None).is_empty());
    assert!(lab.governed_devices(me).is_empty());
    assert!(!lab.draft_checkpoint(me, next, false).unwrap().is_empty());
    assert!(local_move_pending(&lab, me, &[next], None));
    assert!(drafted(&lab, me, &[next], None, &[], &BTreeMap::new()).unwrap().unwrap().moving.checkpoint);
}

#[tokio::test]
async fn an_avens_next_key_becoming_available_later_triggers_freshness_then_drafting() {
    let (mut lab, owner, me, mine) = modern();
    let secret = [210; 32];
    let old = lab.device_with_in("old server", secret, Suite::SlhDsa);
    cast::claim_on(&mut lab, me, owner, mine, old);
    assert!(!local_move_pending(&lab, me, &[owner], None));
    let opts = || Options { card: true, lazy: true, ..Options::local() };
    let server = Node::spawn(lab.split(old, &[], [211; 32]), old, opts()).await.unwrap();
    let node = Node::spawn(lab.split(me, &[owner], [212; 32]), me, opts()).await.unwrap();
    node.try_know(server.endpoint().addr()).unwrap();
    node.sync_with(server.id()).await.unwrap();
    let device = browser(node, owner, vec![owner]);
    let before = device.node.sent().0;
    assert_eq!(device.moving().await.unwrap(), None, "the old peer does not yet have a next key");
    assert_eq!(device.node.sent().0, before, "NEXT_KEY discovery does not fetch edit pages");
    server.try_act(move |lab, me| lab.device_keys(me, secret).unwrap()).await.unwrap();
    let moving = device.moving().await.unwrap().unwrap();
    assert_eq!(moving.avens, 1);
    assert!(moving.passkey);
    assert!(device.node.sent().0 > before, "actual work still takes the full freshness path");
    device.close().await.unwrap();
    server.shutdown().await.unwrap();
}
