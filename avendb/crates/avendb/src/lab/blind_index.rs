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
    /// holds a key of, at their newest `FIND_EPOCHS` epochs.
    fn index_keys(&self, d: SignerId, vault: VaultId) -> Vec<Secret> {
        let fams: Vec<KeyFam> = self
            .held(d)
            .keys
            .epochs
            .keys()
            .filter(|fam| matches!(fam, KeyFam::Seed(v) | KeyFam::Share(v, _) if *v == vault))
            .copied()
            .collect();
        fams.into_iter().flat_map(|fam| self.index_keys_of(d, fam, FIND_EPOCHS)).map(|(_, k)| k).collect()
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
        for edit in store.log.edits() {
            if let crate::policy::Action::Keys { name: KeyName::Scoped(KeyFam::Audience(v, x), _), .. } = &edit.action
                && *v == vault
            {
                out.insert(*x);
            }
        }
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
        Some(labels)
    }

    /// The row of entry `en` device `d` tells: its labels' tokens in the audience it is in, under the newest epoch it
    /// holds of its vault's seed and of each share of that audience. `None` where `d` reads no header of it or holds none
    /// of those keys. Its epoch is the newest of theirs.
    fn row(&self, d: SignerId, en: &crate::policy::Entry) -> Option<Row> {
        let x = en.audience();
        let mut fams = vec![KeyFam::Seed(en.vault)];
        fams.extend(self.held(d).view().audience_shares(x).unwrap_or_default().iter().map(|c| KeyFam::Share(en.vault, *c)));
        let keys: Vec<(u64, Secret)> = fams.into_iter().flat_map(|fam| self.index_keys_of(d, fam, 1)).collect();
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
            .filter(|(fam, _)| matches!(fam, KeyFam::Seed(_) | KeyFam::Share(_, _)))
            .map(|(_, e)| e.len())
            .sum();
        epochs + self.index_vaults(d).into_iter().map(|v| self.index_audiences(d, v).len()).sum::<usize>()
    }

    /// The vaults device `d` may tell rows of and find in: those it holds a seed or a share key of.
    pub fn index_vaults(&self, d: SignerId) -> Vec<VaultId> {
        let keys = &self.held(d).keys;
        let vaults: BTreeSet<VaultId> = keys
            .epochs
            .keys()
            .filter_map(|fam| match fam {
                KeyFam::Seed(v) | KeyFam::Share(v, _) => Some(*v),
                _ => None,
            })
            .collect();
        vaults.into_iter().collect()
    }

    /// The tokens device `d` asks `find` for, for the entries of vault `vault` with one of `labels`: each label's, in
    /// every audience of the vault it knows of, under each index key it holds of the vault (`tokensFor`). The caller
    /// asks for them `FIND_TOKENS` at a time.
    pub fn find_tokens(&self, d: SignerId, vault: VaultId, labels: &[String]) -> Vec<Token> {
        let keys = self.index_keys(d, vault);
        let mut out = BTreeSet::new();
        for x in self.index_audiences(d, vault) {
            for ix in &keys {
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
}
