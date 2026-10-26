//! The blind index (P4 of sync v2, `BlindIndex.lean`). A view asks for a type or a tag, both inside an entry's encrypted
//! body; a peer that cannot read the entry, the server above all, finds it by tokens instead.
//!
//! The keys a reader of an entry holds give index keys (`index_key`): its vault's seed at an epoch (every device of the
//! vault holds it) and the key of each share of the entry's audience at an epoch (its grantee holds it). Each index key
//! gives a 16-byte token per audience and label (`token`), the label `type:<t>` or `tag:<g>`: the audience is in the
//! token, so one audience's tokens link to no other's. A device that reads an entry tells the peers that keep an index
//! the tokens of its labels in its audience, under the newest epoch of each of those keys it holds (a row, `Row`). A
//! device that wants the entries of some labels makes their tokens for every audience of the vault it knows of, under
//! the keys it holds (`Lab::find_tokens`), and asks any peer `find`. Audience keys themselves would not do: a device
//! opens an audience's key only once it holds an entry of it, so a new device would find nothing. A peer that reads
//! answers from its own entries (`Lab::find_local`), the server from the rows it keeps (`Rows::find`).
//!
//! What a token tells a peer without the key: which rows of one audience under one key epoch share a label, never the
//! label, and nothing that links a token of one key, epoch or audience to another's (`blind_reveals_equality_only`,
//! `keys_unlinkable`); the audience and epochs of an entry its edits already name in the clear. A row authorizes
//! nothing: `find` names only entries the asking device syncs by the answering peer's view (`find_within_T12`), and the
//! edits and files still come by sync alone (T12, T27).

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::hash::Hasher;
use crate::id::{AudienceId, EntryId, SignerId, VaultId};
use crate::keys::Secret;

/// A token: the first 16 bytes of a hash of the index key and the label.
pub type Token = [u8; 16];

/// The most tokens one row carries: a type and its tags, under each key. A row with more is cut.
pub const ROW_TOKENS: usize = 64;
/// The most tokens one `find` asks for: labels times the keys the asking device holds.
pub const FIND_TOKENS: usize = 512;
/// The most entries one `find` answers with; the device asks on `after` the last for the rest.
pub const FIND_PAGE: usize = 512;
/// The most devices a node keeps rows of for one entry: the readers of an entry tell the same tokens, and a stale one is
/// overtaken by the next epoch.
pub const ROW_DEVICES: usize = 4;
/// The most epochs of a key a device asks under: the newest, which its readers tell rows under, and the one before,
/// for a reader that hasn't taken the newest yet.
pub const FIND_EPOCHS: usize = 2;

/// The label of an entry's type.
pub fn type_label(ty: &str) -> String {
    format!("type:{ty}")
}

/// The label of one of an entry's tags.
pub fn tag_label(tag: &str) -> String {
    format!("tag:{tag}")
}

/// The index key of a vault's seed or a share's key at one epoch: whoever holds that key derives it, nobody else.
pub fn index_key(key: &Secret) -> Secret {
    key.child("avenDB blind index v1", b"")
}

/// The token of `label` in audience `audience` under index key `index`.
pub fn token(index: &Secret, audience: AudienceId, label: &str) -> Token {
    let data = [&audience.0[..], label.as_bytes()].concat();
    let full = index.child("avenDB blind index token", &data).bytes();
    full[..16].try_into().expect("16 of 32 bytes")
}

/// The tokens of `labels` in `audience` under each of `indexes`, smallest first, each once, at most `ROW_TOKENS`.
pub fn tokens(indexes: &[Secret], audience: AudienceId, labels: &[String]) -> Vec<Token> {
    let set: BTreeSet<Token> =
        indexes.iter().flat_map(|ix| labels.iter().map(move |l| token(ix, audience, l))).collect();
    set.into_iter().take(ROW_TOKENS).collect()
}

/// A row: an entry, the epoch of its audience the tokens are under, and the tokens of its labels.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
    pub entry: EntryId,
    pub epoch: u64,
    pub tokens: Vec<Token>,
}

/// The digest of the rows a device tells of one vault: a peer that holds the same has nothing to take.
pub fn digest(vault: VaultId, rows: &[Row]) -> [u8; 32] {
    let mut h = Hasher::new("avenDB blind index rows");
    h.update(&vault.0);
    for r in rows {
        h.update(&r.entry.0).update(&r.epoch.to_be_bytes()).update(&(r.tokens.len() as u32).to_be_bytes());
        for t in &r.tokens {
            h.update(t);
        }
    }
    h.finalize()
}

/// What a node keeps of the rows its peers told it, vault by vault (`Options::index` in avendb-net, the server's).
#[derive(Default, Debug, Clone, PartialEq, Eq)]
pub struct Rows {
    vaults: BTreeMap<VaultId, VaultRows>,
}

#[derive(Default, Debug, Clone, PartialEq, Eq)]
struct VaultRows {
    /// Of each entry, the rows of the devices that told one, newest epoch kept.
    entries: BTreeMap<EntryId, BTreeMap<SignerId, (u64, Vec<Token>)>>,
    /// Of each device, the digest of the rows it last told of the vault.
    told: BTreeMap<SignerId, [u8; 32]>,
    /// Which entries carry each token.
    by_token: HashMap<Token, BTreeSet<EntryId>>,
}

impl VaultRows {
    fn unlink(&mut self, entry: EntryId, tokens: &[Token]) {
        for t in tokens {
            if let Some(set) = self.by_token.get_mut(t) {
                set.remove(&entry);
                if set.is_empty() {
                    self.by_token.remove(t);
                }
            }
        }
    }

    fn put(&mut self, device: SignerId, row: Row) {
        let of = self.entries.entry(row.entry).or_default();
        let mut dropped = of.insert(device, (row.epoch, row.tokens.clone())).map(|(_, t)| t).unwrap_or_default();
        // the devices of the newest epochs stay
        if of.len() > ROW_DEVICES {
            let oldest = of.iter().min_by_key(|(_, (epoch, _))| *epoch).map(|(d, _)| *d).expect("rows");
            dropped.extend(of.remove(&oldest).expect("row").1);
        }
        let still: BTreeSet<Token> = of.values().flat_map(|(_, t)| t.iter().copied()).collect();
        let gone: Vec<Token> = dropped.into_iter().filter(|t| !still.contains(t)).collect();
        self.unlink(row.entry, &gone);
        for t in &row.tokens {
            self.by_token.entry(*t).or_default().insert(row.entry);
        }
    }

    fn forget(&mut self, device: SignerId, entry: EntryId) {
        let Some(of) = self.entries.get_mut(&entry) else { return };
        let Some((_, old)) = of.remove(&device) else { return };
        let still: BTreeSet<Token> = of.values().flat_map(|(_, t)| t.iter().copied()).collect();
        let gone: Vec<Token> = old.into_iter().filter(|t| !still.contains(t)).collect();
        if of.is_empty() {
            self.entries.remove(&entry);
        }
        self.unlink(entry, &gone);
    }
}

impl Rows {
    /// The digest of the rows `device` last told of `vault`, if it told any.
    pub fn told(&self, device: SignerId, vault: VaultId) -> Option<[u8; 32]> {
        self.vaults.get(&vault)?.told.get(&device).copied()
    }

    /// `device` tells all its rows of `vault`: they replace those it told before, an entry it no longer tells losing
    /// its row of the device. `keep` says which entries the node takes a row of from the device: those the device
    /// syncs by the node's view, so nobody indexes what it may not receive.
    pub fn take(&mut self, device: SignerId, vault: VaultId, rows: Vec<Row>, keep: impl Fn(EntryId) -> bool) -> usize {
        let at = self.vaults.entry(vault).or_default();
        let told = digest(vault, &rows);
        let fresh: BTreeSet<EntryId> = rows.iter().map(|r| r.entry).collect();
        let before: Vec<EntryId> =
            at.entries.iter().filter(|(e, of)| of.contains_key(&device) && !fresh.contains(e)).map(|(e, _)| *e).collect();
        for e in before {
            at.forget(device, e);
        }
        let mut taken = 0;
        for mut row in rows {
            if !keep(row.entry) {
                at.forget(device, row.entry);
                continue;
            }
            row.tokens.truncate(ROW_TOKENS);
            at.put(device, row);
            taken += 1;
        }
        at.told.insert(device, told);
        taken
    }

    /// The entries of `vault` (of every vault for `None`) whose rows carry one of `tokens`, after `after`, smallest
    /// first, those `syncs` lets through, at most `FIND_PAGE`; and whether more are left.
    pub fn find(
        &self,
        vault: Option<VaultId>,
        tokens: &[Token],
        after: Option<EntryId>,
        syncs: impl Fn(EntryId) -> bool,
    ) -> (Vec<EntryId>, bool) {
        let mut hits = BTreeSet::new();
        for (_, at) in self.vaults.iter().filter(|(v, _)| vault.is_none_or(|w| **v == w)) {
            for t in tokens {
                if let Some(set) = at.by_token.get(t) {
                    hits.extend(set.iter().copied().filter(|e| after.is_none_or(|a| *e > a)));
                }
            }
        }
        let mut out = Vec::new();
        let mut more = false;
        for e in hits {
            if !syncs(e) {
                continue;
            }
            if out.len() == FIND_PAGE {
                more = true;
                break;
            }
            out.push(e);
        }
        (out, more)
    }

    /// The vaults it keeps rows of.
    pub fn vaults(&self) -> impl Iterator<Item = VaultId> + '_ {
        self.vaults.keys().copied()
    }

    /// How many rows it keeps, of how many entries.
    pub fn size(&self) -> (usize, usize) {
        let entries = self.vaults.values().map(|v| v.entries.len()).sum();
        let rows = self.vaults.values().flat_map(|v| v.entries.values()).map(|of| of.len()).sum();
        (rows, entries)
    }

    /// The rows of `vault` as bytes, for the node's shelf.
    pub fn encode_vault(&self, vault: VaultId) -> Option<Vec<u8>> {
        let at = self.vaults.get(&vault)?;
        let mut out = vec![1u8];
        out.extend_from_slice(&vault.0);
        out.extend_from_slice(&(at.told.len() as u32).to_be_bytes());
        for (d, digest) in &at.told {
            out.extend_from_slice(&d.0);
            out.extend_from_slice(digest);
        }
        let count: usize = at.entries.values().map(|of| of.len()).sum();
        out.extend_from_slice(&(count as u32).to_be_bytes());
        for (e, of) in &at.entries {
            for (d, (epoch, tokens)) in of {
                out.extend_from_slice(&e.0);
                out.extend_from_slice(&d.0);
                out.extend_from_slice(&epoch.to_be_bytes());
                out.push(tokens.len() as u8);
                for t in tokens {
                    out.extend_from_slice(t);
                }
            }
        }
        Some(out)
    }

    /// Takes in a vault's rows as `encode_vault` wrote them; `None` for bytes it didn't write.
    pub fn decode_vault(&mut self, bytes: &[u8]) -> Option<VaultId> {
        let mut r = Reader { bytes, at: 0 };
        if r.take(1)? != [1] {
            return None;
        }
        let vault = VaultId(r.array()?);
        let mut at = VaultRows::default();
        for _ in 0..r.u32()? {
            let d = SignerId(r.array()?);
            at.told.insert(d, r.array()?);
        }
        for _ in 0..r.u32()? {
            let e = EntryId(r.array()?);
            let d = SignerId(r.array()?);
            let epoch = u64::from_be_bytes(r.array()?);
            let n = r.take(1)?[0] as usize;
            let mut tokens = Vec::with_capacity(n.min(ROW_TOKENS));
            for _ in 0..n {
                tokens.push(r.array()?);
            }
            tokens.truncate(ROW_TOKENS);
            at.put(d, Row { entry: e, epoch, tokens });
        }
        (r.at == bytes.len()).then_some(())?;
        self.vaults.insert(vault, at);
        Some(vault)
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.at.checked_add(n)?;
        let out = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(out)
    }
    fn array<const N: usize>(&mut self) -> Option<[u8; N]> {
        self.take(N)?.try_into().ok()
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_be_bytes(self.array()?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(n: u8) -> Secret {
        Secret::from_bytes([n; 32])
    }

    const X: AudienceId = AudienceId([5; 32]);

    #[test]
    fn tokens_differ_by_key_audience_and_label() {
        let (a, b) = (index_key(&key(1)), index_key(&key(2)));
        assert_eq!(token(&a, X, "type:room"), token(&a, X, "type:room"));
        assert_ne!(token(&a, X, "type:room"), token(&a, X, "type:recipe"));
        assert_ne!(token(&a, X, "type:room"), token(&b, X, "type:room"), "another key or epoch links to nothing");
        assert_ne!(token(&a, X, "type:room"), token(&a, AudienceId([6; 32]), "type:room"), "nor another audience");
        assert_eq!(token(&a, X, "tag:x")[..], crate::hash::keyed(&a.bytes(), "avenDB blind index token", &[&X.0[..], b"tag:x"].concat())[..16]);
        assert_ne!(index_key(&key(1)).bytes(), key(1).bytes());
    }

    #[test]
    fn rows_find_by_token_replace_per_device_and_keep_only_what_syncs() {
        let v = VaultId([9; 32]);
        let (e1, e2, e3) = (EntryId([1; 32]), EntryId([2; 32]), EntryId([3; 32]));
        let (mac, phone) = (SignerId([7; 32]), SignerId([8; 32]));
        let ix = index_key(&key(1));
        let (room, recipe) = (token(&ix, X, "type:room"), token(&ix, X, "type:recipe"));
        let mut rows = Rows::default();
        let told = vec![
            Row { entry: e1, epoch: 0, tokens: vec![room] },
            Row { entry: e2, epoch: 0, tokens: vec![recipe] },
            Row { entry: e3, epoch: 0, tokens: vec![room] },
        ];
        assert_eq!(rows.take(mac, v, told.clone(), |e| e != e3), 2, "a row of what the device may not receive is refused");
        assert_eq!(rows.told(mac, v), Some(digest(v, &told)));
        assert_eq!(rows.find(Some(v), &[room], None, |_| true), (vec![e1], false));
        assert_eq!(rows.find(Some(v), &[room, recipe], None, |e| e != e2), (vec![e1], false), "find answers only what syncs");
        assert_eq!(rows.find(Some(VaultId([0; 32])), &[room], None, |_| true).0, vec![]);
        // the phone tells the same entry: a second row; the mac stops telling e1: its row goes, the phone's stays
        rows.take(phone, v, vec![Row { entry: e1, epoch: 1, tokens: vec![room] }], |_| true);
        rows.take(mac, v, vec![Row { entry: e2, epoch: 0, tokens: vec![recipe] }], |_| true);
        assert_eq!(rows.find(Some(v), &[room], None, |_| true).0, vec![e1]);
        rows.take(phone, v, vec![], |_| true);
        assert!(rows.find(Some(v), &[room], None, |_| true).0.is_empty(), "no device tells it: found by nobody");
        // through the shelf and back
        let bytes = rows.encode_vault(v).unwrap();
        let mut back = Rows::default();
        assert_eq!(back.decode_vault(&bytes), Some(v));
        assert_eq!(back, rows);
        assert!(back.decode_vault(&bytes[..bytes.len() - 1]).is_none());
    }

    #[test]
    fn find_pages_after_the_last() {
        let v = VaultId([9; 32]);
        let ix = index_key(&key(1));
        let room = token(&ix, X, "type:room");
        let mut rows = Rows::default();
        let told: Vec<Row> = (0..(FIND_PAGE + 3) as u32)
            .map(|i| {
                let mut e = [0u8; 32];
                e[..4].copy_from_slice(&i.to_be_bytes());
                Row { entry: EntryId(e), epoch: 0, tokens: vec![room] }
            })
            .collect();
        rows.take(SignerId([1; 32]), v, told, |_| true);
        let (first, more) = rows.find(Some(v), &[room], None, |_| true);
        assert_eq!((first.len(), more), (FIND_PAGE, true));
        let (rest, more) = rows.find(Some(v), &[room], first.last().copied(), |_| true);
        assert_eq!((rest.len(), more), (3, false));
    }
}
