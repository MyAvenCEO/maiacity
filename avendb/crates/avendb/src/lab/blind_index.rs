//! The blind index on a device (`index`, `BlindIndex.lean`): the rows it tells of the entries it reads, the tokens it
//! asks for, and its own answer to `find` as a peer that reads.
use super::*;
use crate::id::AudienceId;
use crate::index::{self, FIND_EPOCHS, Row, Token};
use crate::sync::Syncing;

impl Lab {
    /// The epochs of family `fam` device `d` holds a key of, the newest first, at most `n`, with their index keys.
    fn index_keys_of(&self, d: SignerId, fam: KeyFam, n: usize) -> Vec<(u64, Secret)> {
        let keys = &self.held(d).keys;
        let Some(epochs) = keys.epochs.get(&fam) else { return vec![] };
        epochs
            .iter()
            .rev()
            .filter_map(|e| keys.first(KeyName::Scoped(fam, *e)).map(|k| (*e, index::index_key(k))))
            .take(n)
            .collect()
    }

    /// The index keys device `d` asks `find` under for vault `vault`: of the vault's seed and of each share over it it
    /// holds a key of, at their newest `FIND_EPOCHS` epochs, each with the one audience it is of where it is an
    /// audience's own key (`KeyFam::Audience`), whose tokens are of that audience alone.
    fn index_keys(&self, d: SignerId, vault: VaultId) -> Vec<(Option<AudienceId>, Secret)> {
        let fams: Vec<KeyFam> = self
            .held(d)
            .keys
            .epochs
            .keys()
            .filter(|fam| matches!(fam, KeyFam::Seed(v) | KeyFam::Share(v, _) | KeyFam::Audience(v, _) if *v == vault))
            .copied()
            .collect();
        fams.into_iter()
            .flat_map(|fam| {
                let of = match fam {
                    KeyFam::Audience(_, x) => Some(x),
                    _ => None,
                };
                self.index_keys_of(d, fam, FIND_EPOCHS).into_iter().map(move |(_, k)| (of, k))
            })
            .collect()
    }

    /// The audiences of vault `vault` device `d` knows of: the owners' own, each held share's own, those an entry it
    /// holds was ever in, and those whose keys' edits it holds, which a new device takes before any entry of them.
    fn index_audiences(&self, d: SignerId, vault: VaultId) -> BTreeSet<AudienceId> {
        let store = self.held(d);
        let mut out: BTreeSet<AudienceId> = store
            .view()
            .audiences()
            .filter(|(x, shares)| AudienceId::of(vault, shares) == *x)
            .map(|(x, _)| x)
            .collect();
        // the owners' audience and each held share's own are known by their keys alone
        out.insert(AudienceId::of(vault, &[]));
        for fam in store.keys.epochs.keys() {
            if let KeyFam::Share(v, c) = fam
                && *v == vault
            {
                out.insert(AudienceId::of(vault, &[*c]));
            }
        }
        // and each audience whose own key it holds
        for fam in store.keys.epochs.keys() {
            if let KeyFam::Audience(v, x) = fam
                && *v == vault
            {
                out.insert(*x);
            }
        }
        // the audiences whose key edits it holds, as its log keeps them (`Log::audience_logs`), not a walk of its edits
        out.extend(store.log.audience_logs(vault));
        out
    }

    /// The labels of entry `en` device `d` reads: its type and its tags now. `None` where it doesn't read its header.
    fn labels(&self, d: SignerId, en: &crate::policy::Entry) -> Option<Vec<String>> {
        let store = self.held(d);
        let st = store.view();
        let mut attrs = st.first_attrs(en, &store.readings)?;
        for w in &en.retags {
            if let Some(delta) = store.readings.tags.get(w) {
                attrs.tags = delta.apply(&attrs.tags);
            }
        }
        let mut labels = vec![index::type_label(attrs.ty.as_str())];
        labels.extend(attrs.tags.iter().map(|t| index::tag_label(t.as_str())));
        // the entries it links to, as its main line reads now
        if let Some(item) = self.item(d, en.id) {
            let mut to = BTreeSet::new();
            links_in(&item.record(), &mut to);
            labels.extend(to.into_iter().filter(|e| *e != en.id).map(index::link_label));
        }
        Some(labels)
    }

    /// The rows of entry `e` in device `d`'s shared index (`index::shared`, `SharedIndex.rows`): none where it holds
    /// no row of it to tell (`row`), as for an entry that fell or one not landed.
    pub fn shared_of(&self, d: SignerId, e: EntryId) -> Option<index::shared::Of> {
        let store = self.held(d);
        let en = store.view().entry(e)?;
        if !self.landed(d, e) {
            return None;
        }
        let row = self.row(d, en)?;
        let created = store.log.entry_write(en.creation).map(|c| c.depth)?;
        Some(index::shared::Of { entry: e, audience: en.audience(), epoch: row.epoch, created, tokens: row.tokens })
    }

    /// Device `d`'s shared index lists every entry of vault `vault` it reads: each it has landed and reads the header of
    /// has a row (`shared_of`), as none is read by an entry's own key alone. Where it does, a view of the vault may list
    /// off the index alone; else it must look at the entries the index lacks too. A walk of the vault's entries: a
    /// caller keeps the answer while `Log::revision` stays.
    pub fn index_complete(&self, d: SignerId, vault: VaultId) -> bool {
        self.held(d)
            .view()
            .entries()
            .iter()
            .filter(|en| en.vault == vault && self.landed(d, en.id))
            .all(|en| self.labels(d, en).is_none() || self.row(d, en).is_some())
    }

    /// Entry `e`'s type as its creation's header says it, and its creation (the depth of its creation edit, the order
    /// the shared index keeps): what a page of posts orders its candidates by (`world::post_keys`, `PostsPage.lean`),
    /// without working out what the entry means. `None` where device `d` doesn't see it or reads no header of it.
    pub fn creation_of(&self, d: SignerId, e: EntryId) -> Option<(crate::slice::Sym, u64)> {
        if !self.sees(d, e) {
            return None;
        }
        let store = self.held(d);
        let en = store.view().entry(e)?;
        let ty = store.readings.headers.get(&en.creation)?.ty.clone();
        Some((ty, store.log.entry_write(en.creation)?.depth))
    }

    /// Every entry device `d` may hold rows of in its shared index: those its edits say exist, in the order created.
    pub fn shared_entries(&self, d: SignerId) -> Vec<EntryId> {
        self.held(d).view().entries().iter().map(|en| en.id).collect()
    }

    /// The entries whose rows in device `d`'s shared index its edits from place `from` on may have changed: those they
    /// are of, where each is of an entry's log; `None`, every entry, where one is of another log (a key, a share, a
    /// vault's settings), which may change the rows of any, or where `from` is past its log.
    pub fn shared_touched(&self, d: SignerId, from: usize) -> Option<BTreeSet<EntryId>> {
        let log = &self.held(d).log;
        let (edits, ids) = (log.edits().get(from..)?, &log.ids()[from..]);
        let mut out = BTreeSet::new();
        for (edit, id) in edits.iter().zip(ids) {
            match crate::sync::log_of(edit, *id) {
                Some(LogId::Entry(e)) => {
                    out.insert(e);
                }
                _ => return None,
            }
        }
        Some(out)
    }

    /// Device `d` worked out everything its edits say, its keys opened, read and shown: what its shared index is of
    /// is what they say, so a save may step the index on (`shared_of`).
    pub fn settled(&self, d: SignerId) -> bool {
        let store = self.held(d);
        self.replay_current(d) && !store.behind && store.showing.is_none()
    }

    /// The row of entry `en` device `d` tells: its labels' tokens in the audience it is in, under the newest epoch it
    /// holds of its vault's seed and of each share of that audience. `None` where `d` reads no header of it or holds none
    /// of those keys. Its epoch is the newest of theirs.
    fn row(&self, d: SignerId, en: &crate::policy::Entry) -> Option<Row> {
        let x = en.audience();
        let mut fams = vec![KeyFam::Seed(en.vault)];
        fams.extend(self.held(d).view().audience_shares(x).unwrap_or_default().iter().map(|c| KeyFam::Share(en.vault, *c)));
        let mut keys: Vec<(u64, Secret)> = fams.into_iter().flat_map(|fam| self.index_keys_of(d, fam, 1)).collect();
        // else the audience's own key: what a device reading it by no seed or share holds (a DM in a friend's vault, a
        // coop's room read by a share of another), whose tokens a device finds by that key alone
        if keys.is_empty() {
            keys = self.index_keys_of(d, KeyFam::Audience(en.vault, x), 1);
        }
        let epoch = keys.iter().map(|(e, _)| *e).max()?;
        let labels = self.labels(d, en)?;
        let indexes: Vec<Secret> = keys.into_iter().map(|(_, k)| k).collect();
        Some(Row { entry: en.id, epoch, tokens: index::tokens(&indexes, x, &labels) })
    }

    /// The rows device `d` tells of vault `vault`: one for each entry of it that `d` reads and has landed, smallest
    /// entry first. A locked device holds no key, and tells none.
    pub fn index_rows(&self, d: SignerId, vault: VaultId) -> Vec<Row> {
        let mut rows: Vec<Row> = self
            .held(d)
            .view()
            .entries()
            .iter()
            .filter(|en| en.vault == vault && self.landed(d, en.id))
            .filter_map(|en| self.row(d, en))
            .collect();
        rows.sort_by_key(|r| r.entry);
        rows
    }

    /// What the tokens device `d` finds under stand on: how many epochs it holds of each vault seed and share, and
    /// how many audiences of those vaults it knows of. A new device takes its keys after it asked `find`; once this
    /// changes, the tokens it asked under are stale and its views find again.
    pub fn index_mark(&self, d: SignerId) -> usize {
        let keys = &self.held(d).keys;
        let epochs: usize = keys
            .epochs
            .iter()
            .filter(|(fam, _)| matches!(fam, KeyFam::Seed(_) | KeyFam::Share(_, _) | KeyFam::Audience(_, _)))
            .map(|(_, e)| e.len())
            .sum();
        epochs + self.index_vaults(d).into_iter().map(|v| self.index_audiences(d, v).len()).sum::<usize>()
    }

    /// The vaults device `d` may tell rows of and find in: those it holds a seed, a share or an audience key of.
    pub fn index_vaults(&self, d: SignerId) -> Vec<VaultId> {
        let keys = &self.held(d).keys;
        let vaults: BTreeSet<VaultId> = keys.epochs.keys().map(|fam| fam.vault()).collect();
        vaults.into_iter().collect()
    }

    /// The tokens device `d` asks `find` for, for the entries of vault `vault` with one of `labels`: each label's, in
    /// every audience of the vault it knows of, under each index key it holds of the vault (`tokensFor`). The caller
    /// asks for them `FIND_TOKENS` at a time.
    pub fn find_tokens(&self, d: SignerId, vault: VaultId, labels: &[String]) -> Vec<Token> {
        let keys = self.index_keys(d, vault);
        let mut out = BTreeSet::new();
        for x in self.index_audiences(d, vault) {
            for (_, ix) in keys.iter().filter(|(of, _)| of.is_none_or(|of| of == x)) {
                for l in labels {
                    out.insert(index::token(ix, x, l));
                }
            }
        }
        out.into_iter().collect()
    }

    /// The tokens of `labels` that device `d`'s own shared index keys the rows of vault `vault`'s entries by: each
    /// label's in each audience of the vault its view holds (`index_audiences` without the walk of the log for the key
    /// edits of audiences it holds no entry of yet: a row is of an entry it holds), under each index key it holds of
    /// the vault. A read of its own index (`avendb-net`'s `posts_page`) asks for these, at no cost per edit held.
    pub fn held_tokens(&self, d: SignerId, vault: VaultId, labels: &[String]) -> Vec<Token> {
        let keys = self.index_keys(d, vault);
        let store = self.held(d);
        let mut audiences: BTreeSet<AudienceId> = store
            .view()
            .audiences()
            .filter(|(x, shares)| AudienceId::of(vault, shares) == *x)
            .map(|(x, _)| x)
            .collect();
        audiences.insert(AudienceId::of(vault, &[]));
        let mut out = BTreeSet::new();
        for x in audiences {
            for (_, ix) in keys.iter().filter(|(of, _)| of.is_none_or(|of| of == x)) {
                for l in labels {
                    out.insert(index::token(ix, x, l));
                }
            }
        }
        out.into_iter().collect()
    }

    /// Of `entries`, those device `asker`, which follows `follow`, syncs by device `me`'s view: what `me` may name to it
    /// in answer to `find` (`find_within_T12`). Its newest view, so a revocation it received counts at once.
    pub fn syncs_entries(&self, me: SignerId, asker: SignerId, follow: &[VaultId], entries: &[EntryId]) -> Vec<EntryId> {
        let st = self.latest(me);
        let syncing = Syncing::new(st, asker, follow);
        entries.iter().copied().filter(|e| syncing.log(LogId::Entry(*e))).collect()
    }

    /// Which logs device `asker`, which follows `follow`, syncs by device `me`'s newest view: what a peer keeping an
    /// index may name to it from its rows (`find_within_T12`).
    pub fn syncing(&self, me: SignerId, asker: SignerId, follow: &[VaultId]) -> Syncing<'_> {
        Syncing::new(self.latest(me), asker, follow)
    }

    /// Device `me`'s own answer to `find` from `asker`, as a peer that reads: the entries of `vault` it reads whose row
    /// carries one of `tokens`, after `after`, that `asker` syncs by its view, at most `FIND_PAGE`, and whether more are
    /// left (`BlindIndex.find`).
    pub fn find_local(
        &self,
        me: SignerId,
        asker: SignerId,
        follow: &[VaultId],
        vault: Option<VaultId>,
        tokens: &[Token],
        after: Option<EntryId>,
    ) -> (Vec<EntryId>, bool) {
        let wanted: HashSet<&Token> = tokens.iter().collect();
        let st = self.held(me).view();
        let mut hits: Vec<EntryId> = st
            .entries()
            .iter()
            .filter(|en| vault.is_none_or(|v| en.vault == v) && after.is_none_or(|a| en.id > a))
            .filter(|en| self.row(me, en).is_some_and(|r| r.tokens.iter().any(|t| wanted.contains(t))))
            .map(|en| en.id)
            .collect();
        hits.sort();
        let mut found = self.syncs_entries(me, asker, follow, &hits);
        let more = found.len() > index::FIND_PAGE;
        found.truncate(index::FIND_PAGE);
        (found, more)
    }
}

/// The entries `v` links to, anywhere in it (`ops::Link`), into `out`, at most `index::ROW_TOKENS`.
fn links_in(v: &Value, out: &mut BTreeSet<EntryId>) {
    if out.len() >= index::ROW_TOKENS {
        return;
    }
    if let Some(link) = crate::ops::Link::of_json(v) {
        out.insert(link.entry);
        return;
    }
    match v {
        Value::Array(xs) => xs.iter().for_each(|x| links_in(x, out)),
        Value::Object(o) => o.values().for_each(|x| links_in(x, out)),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use crate::cast::{document, relay_on, world};
    use crate::index::{Rows, type_label};

    #[test]
    fn a_reader_tells_rows_a_blind_peer_finds_by_and_answers_find_itself() {
        let mut w = world();
        let room = w.lab.create(w.mac_a, w.alice, w.alice, "room", &["chat"], document("Room", "Hi", w.mac_a)).unwrap();
        let note = w.lab.create(w.mac_a, w.alice, w.alice, "note", &[], document("Note", "x", w.mac_a)).unwrap();
        let rows = w.lab.index_rows(w.mac_a, w.alice);
        assert_eq!(rows.len(), 2);
        let tokens = w.lab.find_tokens(w.mac_a, w.alice, &[type_label("room")]);
        assert!(!tokens.is_empty());
        // the blind server keeps the rows and finds by tokens it cannot read
        let mut blind = Rows::default();
        blind.take(w.mac_a, w.alice, rows, |_| true);
        let (found, more) = blind.find(Some(w.alice), &tokens, None, |_| true);
        assert_eq!((found, more), (vec![room], false));
        let tags = w.lab.find_tokens(w.mac_a, w.alice, &[crate::index::tag_label("chat")]);
        assert_eq!(blind.find(Some(w.alice), &tags, None, |_| true).0, vec![room]);
        // a reading peer answers itself, only to a device that syncs the entry
        assert_eq!(w.lab.find_local(w.mac_a, w.phone_a, &[], Some(w.alice), &tokens, None).0, vec![room]);
        assert!(w.lab.find_local(w.mac_a, w.mac_b, &[], Some(w.alice), &tokens, None).0.is_empty());
        assert!(w.lab.find_local(w.mac_a, w.stranger, &[], None, &tokens, None).0.is_empty());
        assert!(w.lab.syncs_entries(w.mac_a, w.stranger, &[], &[room, note]).is_empty());
        // a relay-only server gets no key, so it tells no rows of its own
        let alice = w.alice;
        relay_on(&mut w, alice);
        assert!(w.lab.index_rows(w.server, w.alice).is_empty());
        assert!(w.lab.find_tokens(w.server, w.alice, &[type_label("room")]).is_empty());
    }

    #[test]
    fn an_entry_is_found_by_the_entries_it_links_to_in_the_order_created() {
        use crate::index::{link_label, shared};
        use serde_json::json;
        let mut w = world();
        let (mac, alice) = (w.mac_a, w.alice);
        let room = w.lab.create(mac, alice, alice, "room", &["chat"], document("Room", "Hi", mac)).unwrap();
        let link = json!({ "vault": alice.to_hex(), "entry": room.to_hex() });
        let schema = r#"{ "title": "Message", "type": "object", "properties": { "kind": { "const": "message" },
            "text": { "type": "string", "default": "" }, "room": { "x-link": "newest" } }, "required": ["kind"] }"#;
        let made = crate::engine::run(&mut w.lab, mac, &json!({ "op": "create", "vault": alice.to_hex(), "type": "schema", "value": schema }));
        assert!(made.get("ok").is_some(), "{made}");
        let mut said = vec![];
        for n in 0..3 {
            let value = json!({ "kind": "message", "text": format!("message {n}"), "room": link });
            let made = crate::engine::run(&mut w.lab, mac, &json!({ "op": "create", "vault": alice.to_hex(), "type": "note", "value": value }));
            said.push(crate::id::EntryId::from_hex(made["ok"]["entry"].as_str().unwrap_or_else(|| panic!("{made}"))).unwrap());
        }
        let tokens = w.lab.find_tokens(mac, alice, &[link_label(room)]);
        let of: Vec<shared::Of> = said.iter().map(|e| w.lab.shared_of(mac, *e).expect("a row")).collect();
        for o in &of {
            assert!(o.tokens.iter().any(|t| tokens.contains(t)), "a message carries its room's link");
            assert_eq!(shared::Of::from_bytes(o.entry, &o.to_bytes()).as_ref(), Some(o));
            assert!(o.keys().iter().all(|k| shared::owner(k) == Some(o.entry)), "every key names its entry");
        }
        // each was made after the one before, so its key under the link's token sorts before it, the newest first
        assert!(of.windows(2).all(|p| p[0].created < p[1].created));
        let room_of = w.lab.shared_of(mac, room).expect("the room's row");
        assert!(!room_of.tokens.iter().any(|t| tokens.contains(t)), "the room links to no room");
        assert!(w.lab.shared_touched(mac, 0).is_none(), "a vault's own edits are of other logs");
        let n = w.lab.log(mac).ids().len();
        w.lab.tag(mac, alice, room, &["pinned"], &[]).unwrap();
        assert_eq!(w.lab.shared_touched(mac, n), Some([room].into_iter().collect()));
        assert_ne!(w.lab.shared_of(mac, room), Some(room_of), "a tag added changes its rows");
    }

    #[test]
    fn a_device_holding_no_entry_of_an_audience_finds_by_its_vault_keys() {
        use crate::cast::handbook_ready;
        use crate::sync::{LogId, log_of};
        let mut w = world();
        let coop = handbook_ready(&mut w);
        let room = w.lab.create(w.mac_a, coop, coop, "room", &[], document("Room", "Hi", w.mac_a)).unwrap();
        // the phone takes every log that is no entry's, as a new device does first: the audience's key edit too, which
        // it can't open while it holds no entry of the audience
        let log = w.lab.log(w.mac_a);
        let ids: Vec<_> = log.edits().iter().zip(log.ids())
            .filter(|(e, id)| !matches!(log_of(e, **id), Some(LogId::Entry(_)))).map(|(_, id)| *id).collect();
        let (signed, blobs) = w.lab.outgoing(w.mac_a, &ids);
        let phone = w.phone_a;
        w.lab.deliver(phone, signed, &blobs);
        assert!(w.lab.history(phone, room).is_none());
        let mut blind = Rows::default();
        blind.take(w.mac_a, coop, w.lab.index_rows(w.mac_a, coop), |_| true);
        let tokens = w.lab.find_tokens(phone, coop, &[type_label("room")]);
        assert_eq!(blind.find(Some(coop), &tokens, None, |_| true).0, vec![room]);
        assert!(blind.find(Some(coop), &w.lab.find_tokens(phone, coop, &[type_label("note")]), None, |_| true).0.is_empty());
    }

    /// Every device that reads an entry has a row of it in its shared index, whatever key it reads it by: a device of
    /// Bob's or Carol's reads Alice's door by the share she gave, the coop's by the share she gave the coop, and each
    /// finds it by its type under the keys it holds.
    #[test]
    fn every_entry_a_device_reads_has_its_row() {
        use crate::cast::todos_on;
        let mut w = world();
        let todos = todos_on(&mut w);
        let (alice, mac_a) = (w.alice, w.mac_a);
        for to in [w.mac_b, w.mac_c, w.server] {
            w.lab.sync(mac_a, to);
        }
        let mut reads = 0;
        for d in [w.mac_a, w.mac_b, w.mac_c, w.server] {
            for v in [alice, todos.coop] {
                assert!(w.lab.index_complete(d, v), "{d:?} lists every entry it reads of {v:?}");
            }
            if w.lab.labels(d, w.lab.held(d).view().entry(todos.door).unwrap()).is_some() {
                reads += 1;
                let row = w.lab.shared_of(d, todos.door).expect("a row of the door it reads");
                let tokens = w.lab.find_tokens(d, alice, &[type_label("todo")]);
                assert!(row.tokens.iter().any(|t| tokens.contains(t)), "{d:?} finds the door by its type");
            }
        }
        assert!(reads >= 3, "Alice's, Bob's and Carol's devices read the door: {reads}");
    }
}
