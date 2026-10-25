use super::*;
fn reference(
    lab: &Lab,
    me: SignerId,
    of: impl Fn(&Entry) -> bool,
) -> BTreeMap<(VaultId, String), PublicFile> {
    let st = lab.state(me);
    let mut files = BTreeMap::new();
    let landed = |en: &&Entry| lab.landed(me, en.id);
    let public = st.entries().iter().filter(landed).filter(|en| of(en) && everyone_reads(st, en));
    for en in public.filter(|en| typed(lab, me, en.id, FILE)) {
        let Some(What::Record { title, record, deleted: false, .. }) = lab.item(me, en.id).map(|i| record(i.record()))
        else {
            continue;
        };
        let media = record.get("media").and_then(Value::as_str).unwrap_or_default().to_string();
        if let Some((root, len)) = lab.entry_files(me, en.id).into_iter().find_map(|(root, len)| Some((root, len?))) {
            files.entry((en.vault, title)).or_insert(PublicFile { root, len, media });
        }
    }
    files
}

#[test]
fn grouped_public_files_match_per_entry_projection_and_first_name_wins() {
    use crate::{cast::{world, share, of_type}, policy::{Who, Level, Action, Revoking}};
    use crate::sealed::{Brought, FileKey};
    let mut w = world();
    let public = w.lab.issue(w.mac_a, &[w.mac_a], share(w.alice, Who::Everyone, Level::Read, of_type(FILE))).unwrap();
    let mut first = None;
    for (index, name) in ["same.bin", "same.bin", "other.bin"].into_iter().enumerate() {
        let brought = Brought::new([index as u8 + 1; 32], FileKey::from_bytes([9;32]), 37);
        if first.is_none() { first = Some(brought.root); }
        let result = crate::engine::put_file(&mut w.lab, w.mac_a, &json!({
            "op":"put_file", "vault":w.alice.to_hex(), "as":w.alice.to_hex(),
            "name":name, "len":37, "media":"application/octet-stream"
        }), brought);
        assert!(result.get("ok").is_some(), "{result}");
    }
    w.lab.sync_all(0);
    let check = |lab: &Lab| {
        for me in [w.mac_a, w.mac_b, w.server, w.stranger] {
            assert_eq!(public_files(lab, me), reference(lab, me, |_| true));
            assert_eq!(files_everyone_reads(lab, me, |en| en.vault == w.alice),
                reference(lab, me, |en| en.vault == w.alice));
            assert!(files_everyone_reads(lab, me, |_| false).is_empty());
        }
    };
    check(&w.lab);
    assert_eq!(public_files(&w.lab,w.mac_a)[&(w.alice,"same.bin".into())].root,first.unwrap());
    let backup = w.lab.backup(w.mac_a);
    w.lab.submit(w.mac_a, &[w.mac_a], Action::Revoke(Revoking::Grant {
        share:public, actor:w.alice, keep:vec![], via:vec![]
    })).unwrap();
    w.lab.sync_all(1);
    check(&w.lab);
    w.lab.restore_backup(w.mac_a, &backup);
    check(&w.lab);
}
