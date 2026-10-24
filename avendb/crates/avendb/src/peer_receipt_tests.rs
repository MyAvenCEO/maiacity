use super::*;
use crate::{
    cast::{todos_on, world},
    policy::Revoking,
};
#[test]
fn peer_policy_observation_requires_current_replay_and_current_permission() {
    let mut w = world();
    let todos = todos_on(&mut w);
    let d = w.mac_a;
    w.lab
        .edit(d, w.alice, todos.door, |item| {
            item.set_text(1, "observed write")
        })
        .unwrap();
    w.lab.catch_up(d);
    let id = *w.lab.log(d).ids().last().unwrap();
    assert_eq!(w.lab.peer_edit_outcome(d, w.mac_c, id), Some(true));
    assert_eq!(w.lab.peer_edit_outcome(d, w.stranger, id), None);
    assert_eq!(w.lab.peer_edit_outcome(d, w.mac_c, EditId([0; 32])), None);
    // A stored signature alone cannot report a policy decision before replay catches up.
    let at = w.lab.at(d);
    let replayed = w.lab.stores[&at].replayed;
    w.lab.stores.get_mut(&at).unwrap().replayed = replayed - 1;
    assert_eq!(w.lab.peer_edit_outcome(d, w.mac_c, id), None);
    w.lab.stores.get_mut(&at).unwrap().replayed = replayed;
    w.lab
        .submit(
            d,
            &[d],
            Action::Revoke(Revoking::Grant {
                share: todos.carol_read,
                actor: w.alice,
                keep: vec![],
                via: vec![],
            }),
        )
        .unwrap();
    w.lab.catch_up(d);
    assert_eq!(w.lab.peer_edit_outcome(d, w.mac_c, id), None);
}
