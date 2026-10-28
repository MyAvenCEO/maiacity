//! Differential correspondence to the previous wire-compatible scoped-reply implementation.
use avendb::cast::*;
use avendb::id::{BlobId, EntryId, SignerId};
use avendb::lab::{Lab, ReplyScope};
use avendb::sync::{log_of, place, LogId};
use avendb::wire::{Request, Wire};

fn legacy(lab: &Lab, device: SignerId, mut request: Request, scope: &ReplyScope) -> Request {
    let log = lab.log(device);
    for (edit, id) in log.edits().iter().zip(log.ids()) {
        let lg = log_of(edit, *id);
        let outside = match scope {
            ReplyScope::All => false,
            ReplyScope::Logs(logs) => lg.is_none_or(|l| !logs.contains(&l)),
            ReplyScope::Vaults(vaults) => match lg {
                Some(LogId::Entry(entry)) => lab.vault_of_entry(device, entry).is_none_or(|v| !vaults.contains(&v)),
                _ => false,
            },
        };
        if outside { request.ask.loose.push(*id); }
    }
    request
}

fn check(lab: &mut Lab, from: SignerId, to: SignerId, scope: &ReplyScope, page: usize) {
    let mut wants = lab.blob_ids(from);
    wants.push(BlobId([255; 32]));
    wants.sort(); wants.dedup();
    let mut request = Request { wants, ..Request::default() };
    // The next page changes only its cursor, so the fast path must retain the correct scope in its cache key.
    for _ in 0..1000 {
        let old = legacy(lab, from, request.clone(), scope);
        let expected = lab.reply(from, to, &old, page);
        let actual = lab.reply_in(from, to, &request, page, scope);
        assert_eq!(actual.0.iter().map(Wire::to_wire).collect::<Vec<_>>(), expected.0.iter().map(Wire::to_wire).collect::<Vec<_>>());
        assert_eq!((&actual.1, actual.2), (&expected.1, expected.2));
        if !actual.2 { return; }
        request.after = actual.0.iter().map(|s| place(&s.edit)).max();
        assert!(request.after.is_some(), "a nonfinal page advances");
    }
    panic!("paging did not finish");
}

#[test]
fn scoped_pages_match_the_old_filter_for_members_relays_and_strangers() {
    let mut w = world();
    let h = handbook(&mut w);
    let scopes = [
        ReplyScope::All,
        ReplyScope::Logs(Default::default()),
        ReplyScope::Logs([LogId::Entry(h.welcome), LogId::Entry(EntryId([255; 32]))].into()),
        ReplyScope::Vaults([h.coop].into()),
        ReplyScope::Vaults(Default::default()),
    ];
    for to in [w.mac_b, w.server, w.stranger] {
        for scope in &scopes {
            for page in [1, 8192, usize::MAX] { check(&mut w.lab, w.mac_a, to, scope, page); }
        }
    }
    // Appending a write must invalidate cached page plans, including plans for another scope.
    w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    for scope in &scopes { check(&mut w.lab, w.mac_a, w.mac_b, scope, 8192); }
}
