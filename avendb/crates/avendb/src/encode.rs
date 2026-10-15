//! The canonical encoding of an edit: the bytes its id hashes and its signatures sign (through the id). Every value has
//! exactly one encoding and none is a prefix of another of the same type, so two different edits never share bytes:
//! integers are big-endian and fixed-size, sequences carry their length, and every enum starts with a tag. The first
//! byte is the format's version, so a later format can live beside this one.

use crate::keys::{KeyBox, KeyFam, KeyId, KeyName, PublicKey, Recipient};
use crate::policy::{Action, Edit, KeepMode, Kind, Level, Principal, Proposal, Revoking, Setting, Share, Sharing, Who};
use crate::rules::{Grant, On, Op, Proof, Scalar, Step};
use crate::sealed::{Brought, FileRoot};
use crate::slice::{Atom, Body, Header, Select, Selector, Slice, Sym, TagDelta};

/// The version byte every edit starts with: 10 since every id is a BLAKE3 hash, so avenDB starts afresh (9 since every
/// signature on an edit is SLH-DSA alone, a passkey's with its WebAuthn assertion beside it, and checkpoints are gone,
/// 8 since the v8 kinds, 7 since every human vault is founded with the master recovery key among its owners, 6 since
/// shares are named groups of ops, 5 since flat vaults, 4 since the three kinds of vault, 3 since P5, whose writes name
/// the line of history they extend, 2 since P4b, whose ids were SHA-3 hashes until 10).
pub const VERSION: u8 = 10;

/// An edit's id: the BLAKE3 hash of its bytes, the name iroh-blobs gives them (`hash::content`).
pub(crate) fn edit_id(edit: &Edit) -> [u8; 32] {
    crate::hash::content(&bytes(edit))
}

/// An edit's bytes: the version, then its encoding.
pub fn bytes(edit: &Edit) -> Vec<u8> {
    let mut out = Vec::with_capacity(128);
    out.push(VERSION);
    edit.encode(&mut out);
    out
}

/// What a write's ciphertext is bound to: the edit's bytes with an empty body, so the edit can't be moved to another
/// edit, entry, stay or epoch.
pub fn write_context(edit: &Edit) -> Vec<u8> {
    let mut edit = edit.clone();
    if let Action::Write { body, .. } = &mut edit.action {
        body.clear();
    }
    bytes(&edit)
}

/// What a share's sealed slice is bound to: the share with an empty `select`, so the slice can't be moved to another
/// share, another grantee or another level, nor a keep share's to another device or mode.
pub fn share_context(share: &Share) -> Vec<u8> {
    let mut out = vec![VERSION];
    out.extend_from_slice(b"share");
    Share { select: vec![], ..share.clone() }.encode(&mut out);
    out
}

/// What a box of a share's selector key is bound to (`slice::Select`): the share with an empty `select`, the key it
/// holds, and for whom. It opens as no other box, and for no other share.
pub fn share_select_info(share: &Share, id: KeyId, to: &Recipient) -> Vec<u8> {
    let mut out = share_context(share);
    out.extend_from_slice(b"selector key");
    id.encode(&mut out);
    to.encode(&mut out);
    out
}

/// What a box is bound to: which key it holds, and for whom. A box can't be passed off as another key's, nor moved to
/// another recipient.
pub fn box_info(name: KeyName, id: KeyId, to: &Recipient) -> Vec<u8> {
    let mut out = vec![VERSION];
    name.encode(&mut out);
    id.encode(&mut out);
    to.encode(&mut out);
    out
}

pub(crate) trait Encode {
    fn encode(&self, out: &mut Vec<u8>);
}

impl<T: Encode + ?Sized> Encode for &T {
    fn encode(&self, out: &mut Vec<u8>) {
        (**self).encode(out);
    }
}

impl Encode for bool {
    fn encode(&self, out: &mut Vec<u8>) {
        out.push(*self as u8);
    }
}

impl Encode for u32 {
    fn encode(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.to_be_bytes());
    }
}

impl Encode for u64 {
    fn encode(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.to_be_bytes());
    }
}

impl Encode for i64 {
    fn encode(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.to_be_bytes());
    }
}

/// UTF-8 behind its length.
impl Encode for String {
    fn encode(&self, out: &mut Vec<u8>) {
        (self.len() as u32).encode(out);
        out.extend_from_slice(self.as_bytes());
    }
}

impl<const N: usize> Encode for [u8; N] {
    fn encode(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(self);
    }
}

impl<T: Encode> Encode for [T] {
    fn encode(&self, out: &mut Vec<u8>) {
        (self.len() as u32).encode(out);
        for x in self {
            x.encode(out);
        }
    }
}

impl<A: Encode, B: Encode> Encode for (A, B) {
    fn encode(&self, out: &mut Vec<u8>) {
        self.0.encode(out);
        self.1.encode(out);
    }
}

impl Encode for Vec<u8> {
    fn encode(&self, out: &mut Vec<u8>) {
        (self.len() as u32).encode(out);
        out.extend_from_slice(self);
    }
}

impl<T: Encode> Encode for Option<T> {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            None => out.push(0),
            Some(x) => {
                out.push(1);
                x.encode(out);
            }
        }
    }
}

macro_rules! ids {
    ($($t:ty),*) => {$(
        impl Encode for $t {
            fn encode(&self, out: &mut Vec<u8>) {
                self.0.encode(out);
            }
        }
    )*};
}

ids!(
    crate::id::SignerId,
    crate::id::VaultId,
    crate::id::EntryId,
    crate::id::ShareId,
    crate::id::AudienceId,
    crate::id::EditId,
    crate::id::BlobId,
    KeyId
);

impl Encode for PublicKey {
    fn encode(&self, out: &mut Vec<u8>) {
        self.xwing.encode(out);
        self.mceliece.encode(out);
    }
}

impl Encode for KeyFam {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            KeyFam::Seed(v) => {
                out.push(0);
                v.encode(out);
            }
            KeyFam::Share(v, c) => {
                out.push(1);
                v.encode(out);
                c.encode(out);
            }
            KeyFam::Audience(v, x) => {
                out.push(2);
                v.encode(out);
                x.encode(out);
            }
        }
    }
}

impl Encode for KeyName {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            KeyName::Signer(s) => {
                out.push(0);
                s.encode(out);
            }
            KeyName::Scoped(k, epoch) => {
                out.push(1);
                k.encode(out);
                epoch.encode(out);
            }
            KeyName::Entry(e, stay, epoch) => {
                out.push(2);
                e.encode(out);
                stay.encode(out);
                epoch.encode(out);
            }
        }
    }
}

impl Encode for Recipient {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Recipient::Signer(s) => {
                out.push(0);
                s.encode(out);
            }
            Recipient::Key { name, id } => {
                out.push(1);
                name.encode(out);
                id.encode(out);
            }
        }
    }
}

impl Encode for KeyBox {
    fn encode(&self, out: &mut Vec<u8>) {
        self.to.encode(out);
        self.bytes.encode(out);
    }
}

impl Encode for Sym {
    fn encode(&self, out: &mut Vec<u8>) {
        self.0.encode(out);
    }
}

impl Encode for Atom {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Atom::TypeIn(ts) => {
                out.push(0);
                ts.encode(out);
            }
            Atom::AuthorIn(vs) => {
                out.push(1);
                vs.encode(out);
            }
            Atom::EntryIn(es) => {
                out.push(2);
                es.encode(out);
            }
            Atom::CreatedIn(from, to) => {
                out.push(3);
                from.encode(out);
                to.encode(out);
            }
            Atom::TagHas(t) => {
                out.push(4);
                t.encode(out);
            }
            Atom::TagNone(ts) => {
                out.push(5);
                ts.encode(out);
            }
            Atom::TagsWithin(ts) => {
                out.push(6);
                ts.encode(out);
            }
        }
    }
}

impl Encode for Selector {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Selector::All => out.push(0),
            Selector::AnyOf(ds) => {
                out.push(1);
                (ds.len() as u32).encode(out);
                for d in ds {
                    d.encode(out);
                }
            }
        }
    }
}

impl Encode for Slice {
    fn encode(&self, out: &mut Vec<u8>) {
        self.name.encode(out);
        self.select.encode(out);
        self.grant.encode(out);
        self.above.encode(out);
    }
}

impl Encode for Select {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Select::Clear(slice) => {
                out.push(0);
                slice.encode(out);
            }
            Select::Sealed { boxes, slice, commitment } => {
                out.push(1);
                boxes.encode(out);
                slice.encode(out);
                commitment.encode(out);
            }
        }
    }
}

impl Encode for Step {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Step::Field(f) => {
                out.push(0);
                f.encode(out);
            }
            Step::Row(i) => {
                out.push(1);
                i.encode(out);
            }
            Step::Any => out.push(2),
        }
    }
}

impl Encode for On {
    fn encode(&self, out: &mut Vec<u8>) {
        out.push(match self {
            On::Main => 0,
            On::Proposals => 1,
        });
    }
}

impl Encode for Scalar {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Scalar::Null => out.push(0),
            Scalar::Bool(false) => out.push(1),
            Scalar::Bool(true) => out.push(2),
            Scalar::Int(i) => {
                out.push(3);
                i.encode(out);
            }
            Scalar::Text(t) => {
                out.push(4);
                t.encode(out);
            }
        }
    }
}

/// Tagged in the order shares list their ops.
impl Encode for Op {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Op::Relay => out.push(0),
            Op::Backup => out.push(1),
            Op::Read => out.push(2),
            Op::Create => out.push(3),
            Op::Set { path, to, on } => {
                out.push(4);
                path.encode(out);
                to.as_deref().encode(out);
                on.encode(out);
            }
            Op::Insert { path, on } => {
                out.push(5);
                path.encode(out);
                on.encode(out);
            }
            Op::Remove { path, on } => {
                out.push(6);
                path.encode(out);
                on.encode(out);
            }
            Op::Move { path, on } => {
                out.push(7);
                path.encode(out);
                on.encode(out);
            }
            Op::Tag(tags) => {
                out.push(8);
                tags.as_deref().encode(out);
            }
            Op::Propose => out.push(9),
            Op::Merge { on } => {
                out.push(10);
                on.encode(out);
            }
            Op::Share => out.push(11),
        }
    }
}

impl Encode for Grant {
    fn encode(&self, out: &mut Vec<u8>) {
        self.ops.encode(out);
        self.salt.encode(out);
    }
}

impl Encode for Proof {
    fn encode(&self, out: &mut Vec<u8>) {
        self.share.encode(out);
        self.grants.encode(out);
    }
}

impl Encode for Header {
    fn encode(&self, out: &mut Vec<u8>) {
        self.ty.encode(out);
        self.created.encode(out);
    }
}

impl Encode for TagDelta {
    fn encode(&self, out: &mut Vec<u8>) {
        self.add.encode(out);
        self.remove.encode(out);
    }
}

/// Its files come last, and only when it brings some, so every body written before files keeps its bytes.
impl Encode for Body {
    fn encode(&self, out: &mut Vec<u8>) {
        self.header.encode(out);
        self.tags.encode(out);
        self.answers.encode(out);
        self.content.encode(out);
        self.proof.encode(out);
        if !self.files.is_empty() {
            self.files.encode(out);
        }
    }
}

impl Encode for FileRoot {
    fn encode(&self, out: &mut Vec<u8>) {
        self.hash.encode(out);
        self.size.encode(out);
    }
}

impl Encode for Brought {
    fn encode(&self, out: &mut Vec<u8>) {
        self.root.encode(out);
        self.key.bytes().encode(out);
        self.len.encode(out);
    }
}

impl Encode for Kind {
    fn encode(&self, out: &mut Vec<u8>) {
        out.push(match self {
            Kind::Human => 0,
            Kind::Coop => 1,
            Kind::Aven => 2,
        });
    }
}

impl Encode for Principal {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Principal::Signer(s) => {
                out.push(0);
                s.encode(out);
            }
            Principal::Vault(v) => {
                out.push(1);
                v.encode(out);
            }
        }
    }
}

/// Its rank (`Level::rank`): keep 0, then its mode's byte (0 whole, 1 opened, 2 never), relay 1 to owner 5.
impl Encode for Level {
    fn encode(&self, out: &mut Vec<u8>) {
        out.push(self.rank());
        if let Level::Keep(m) = self {
            out.push(match m {
                KeepMode::Whole => 0,
                KeepMode::Opened => 1,
                KeepMode::Never => 2,
            });
        }
    }
}

impl Encode for Who {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Who::Vault(v) => {
                out.push(0);
                v.encode(out);
            }
            Who::Everyone => out.push(1),
            Who::Device(d) => {
                out.push(2);
                d.encode(out);
            }
        }
    }
}

impl Encode for Share {
    fn encode(&self, out: &mut Vec<u8>) {
        self.over.encode(out);
        self.who.encode(out);
        self.level.encode(out);
        self.wide.encode(out);
        self.select.encode(out);
        self.parent.encode(out);
        self.issuer.encode(out);
        self.nonce.encode(out);
    }
}

impl Encode for Proposal {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Proposal::Main => out.push(0),
            Proposal::New => out.push(1),
            Proposal::On(b) => {
                out.push(2);
                b.encode(out);
            }
        }
    }
}

impl Encode for Setting {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Setting::Threshold(n) => {
                out.push(0);
                n.encode(out);
            }
            Setting::Root { root, keep } => {
                out.push(1);
                root.encode(out);
                keep.encode(out);
            }
        }
    }
}

impl Encode for Sharing {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Sharing::Grant(c, via) => {
                out.push(0);
                c.encode(out);
                via.encode(out);
            }
            Sharing::Owner { vault, owner, seal_to } => {
                out.push(1);
                vault.encode(out);
                owner.encode(out);
                seal_to.encode(out);
            }
            Sharing::Device { vault, device, seal_to } => {
                out.push(2);
                vault.encode(out);
                device.encode(out);
                seal_to.encode(out);
            }
        }
    }
}

impl Encode for Revoking {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Revoking::Grant { share, actor, keep, via } => {
                out.push(0);
                share.encode(out);
                actor.encode(out);
                keep.encode(out);
                via.encode(out);
            }
            Revoking::Owner { vault, owner, keep } => {
                out.push(1);
                vault.encode(out);
                owner.encode(out);
                keep.encode(out);
            }
            Revoking::Device { vault, device, keep } => {
                out.push(2);
                vault.encode(out);
                device.encode(out);
                keep.encode(out);
            }
        }
    }
}

/// Each kind by its tag: 0 genesis, 1 settings, 2 share, 3 revoke, 4 write, 5 mark, 6 keys. 7, a checkpoint, went with
/// the classical half of a signature, as every signature is SLH-DSA; 8, a publish into a vault's schema lane, went into
/// the write, as a schema or lens entry; 9, a sync rule, and 10, its end, into the share and the revoke, as a keep
/// share and its revocation; 11, a pick, into the mark. No tag is used again. A settings, share or revoke edit's
/// sub-kind follows in a byte of its own.
impl Encode for Action {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Action::Genesis { kind, owners, threshold, root, nonce, seal_to } => {
                out.push(0);
                kind.encode(out);
                owners.encode(out);
                threshold.encode(out);
                root.encode(out);
                nonce.encode(out);
                seal_to.encode(out);
            }
            Action::Settings { vault, set } => {
                out.push(1);
                vault.encode(out);
                set.encode(out);
            }
            Action::Share(s) => {
                out.push(2);
                s.encode(out);
            }
            Action::Revoke(r) => {
                out.push(3);
                r.encode(out);
            }
            // its files always, none or some, smallest first
            Action::Write { vault, entry, actor, stay, epoch, deps, proposal, via, create, files, body } => {
                out.push(4);
                vault.encode(out);
                entry.encode(out);
                actor.encode(out);
                stay.encode(out);
                epoch.encode(out);
                deps.encode(out);
                proposal.encode(out);
                via.encode(out);
                create.as_deref().encode(out);
                files.encode(out);
                body.encode(out);
            }
            // its audience and its wants, each there or not
            Action::Mark { vault, entry, caps, wants, keep, via } => {
                out.push(5);
                vault.encode(out);
                entry.encode(out);
                caps.as_deref().encode(out);
                wants.as_deref().encode(out);
                keep.encode(out);
                via.encode(out);
            }
            Action::Keys { name, id, public, boxes, clear } => {
                out.push(6);
                name.encode(out);
                id.encode(out);
                public.encode(out);
                boxes.encode(out);
                clear.encode(out);
            }
        }
    }
}

impl Encode for Edit {
    fn encode(&self, out: &mut Vec<u8>) {
        self.parents.encode(out);
        self.depth.encode(out);
        self.author.encode(out);
        self.cosigners.encode(out);
        self.action.encode(out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::id::{EditId, EntryId, ShareId, SignerId, VaultId};

    fn genesis(nonce: u64) -> Edit {
        let owners = vec![Principal::Signer(SignerId::from_u64(1))];
        let action = Action::Genesis { kind: Kind::Human, owners, threshold: 1, root: None, nonce, seal_to: vec![] };
        Edit { parents: vec![], depth: 0, author: SignerId::from_u64(1), cosigners: vec![], action }
    }

    fn write(stay: Option<EditId>, proposal: Proposal, via: Vec<VaultId>, create: Option<Vec<ShareId>>) -> Edit {
        let (vault, entry, actor) = (VaultId::from_u64(1), EntryId::from_u64(1), VaultId::from_u64(1));
        let (deps, files, body) = (vec![], vec![], vec![]);
        let action = Action::Write { vault, entry, actor, stay, epoch: 0, deps, proposal, via, create, files, body };
        Edit { action, ..genesis(0) }
    }

    fn distinct(ids: &[[u8; 32]]) -> bool {
        ids.iter().enumerate().all(|(i, x)| ids[i + 1..].iter().all(|y| x != y))
    }

    #[test]
    fn every_field_changes_the_id() {
        let base = genesis(0);
        let mut others = vec![genesis(1)];
        let mut o = base.clone();
        o.author = SignerId::from_u64(2);
        others.push(o);
        let mut o = base.clone();
        o.cosigners = vec![SignerId::from_u64(3)];
        others.push(o);
        let mut o = base.clone();
        o.parents = vec![EditId::from_u64(9)];
        others.push(o);
        let mut o = base.clone();
        o.depth = 1;
        others.push(o);
        let mut o = base.clone();
        let (vault, device) = (VaultId::from_u64(1), SignerId::from_u64(1));
        o.action = Action::Share(Sharing::Device { vault, device, seal_to: None });
        others.push(o);
        let mut o = base.clone();
        if let Action::Genesis { root, .. } = &mut o.action {
            *root = Some(SignerId::from_u64(1));
        }
        others.push(o);
        for o in &others {
            assert_ne!(edit_id(o), edit_id(&base), "{o:?}");
        }
        assert_eq!(edit_id(&base), edit_id(&genesis(0)));
    }

    #[test]
    fn a_writes_line_stay_and_audience_change_its_id() {
        let (a, b) = (EditId::from_u64(1), EditId::from_u64(2));
        let main = |stay| write(stay, Proposal::Main, vec![], None);
        let ids = [
            edit_id(&main(None)),
            edit_id(&main(Some(a))),
            edit_id(&main(Some(b))),
            edit_id(&write(None, Proposal::New, vec![], None)),
            edit_id(&write(None, Proposal::On(a), vec![], None)),
            edit_id(&write(None, Proposal::On(b), vec![], None)),
            edit_id(&write(None, Proposal::Main, vec![], Some(vec![]))),
            edit_id(&write(None, Proposal::Main, vec![], Some(vec![ShareId::from_u64(1)]))),
        ];
        assert!(distinct(&ids));
    }

    #[test]
    fn the_files_a_write_brings_change_its_id() {
        let with = |files: Vec<FileRoot>| {
            let mut w = write(None, Proposal::Main, vec![], None);
            if let Action::Write { files: f, .. } = &mut w.action {
                *f = files;
            }
            w
        };
        let (a, b) = (FileRoot { hash: [1; 32], size: 16 }, FileRoot { hash: [2; 32], size: 16 });
        let ids = [with(vec![]), with(vec![a]), with(vec![b]), with(vec![a, b]), with(vec![FileRoot { size: 17, ..a }])];
        assert!(distinct(&ids.each_ref().map(edit_id)));
        // a write's tag is 4, whether or not it brings files, which are always there, just before the body
        let (none, one) = (bytes(&ids[0]), bytes(&ids[1]));
        assert_eq!((none[AT], one[AT]), (4, 4));
        assert_eq!(one.len(), none.len() + 40);
    }

    /// Where an edit's action starts, after the version, no parents, the depth, the author and no cosigners.
    const AT: usize = 1 + 4 + 8 + 32 + 4;

    /// The bytes of an edit of the genesis's signers doing `action`, from its tag on.
    fn tagged(action: Action) -> Vec<u8> {
        bytes(&Edit { action, ..genesis(0) })[AT..].to_vec()
    }

    #[test]
    fn each_kind_and_sub_kind_has_its_tag() {
        let (v, e, c, d) = (VaultId::from_u64(1), EntryId::from_u64(2), ShareId::from_u64(3), SignerId::from_u64(4));
        let owner = Principal::Signer(d);
        let share = Share {
            over: v,
            who: Who::Everyone,
            level: Level::Read,
            wide: true,
            select: vec![],
            parent: None,
            issuer: v,
            nonce: 0,
        };
        let root = Setting::Root { root: None, keep: vec![] };
        let keep = Share { who: Who::Device(d), level: Level::Keep(KeepMode::Whole), ..share.clone() };
        let (name, id) = (KeyName::Signer(d), KeyId([0; 32]));
        let keys = Action::Keys { name, id, public: None, boxes: vec![], clear: None };
        let kinds: Vec<(Action, &[u8])> = vec![
            (genesis(0).action, &[0]),
            (Action::Settings { vault: v, set: Setting::Threshold(1) }, &[1]),
            (Action::Settings { vault: v, set: root }, &[1]),
            (Action::Share(Sharing::Grant(share, vec![])), &[2, 0]),
            (Action::Share(Sharing::Grant(keep, vec![])), &[2, 0]),
            (Action::Share(Sharing::Owner { vault: v, owner, seal_to: None }), &[2, 1]),
            (Action::Share(Sharing::Device { vault: v, device: d, seal_to: None }), &[2, 2]),
            (Action::Revoke(Revoking::Grant { share: c, actor: v, keep: vec![], via: vec![] }), &[3, 0]),
            (Action::Revoke(Revoking::Owner { vault: v, owner, keep: vec![] }), &[3, 1]),
            (Action::Revoke(Revoking::Device { vault: v, device: d, keep: vec![] }), &[3, 2]),
            (write(None, Proposal::Main, vec![], None).action, &[4]),
            (Action::Mark { vault: v, entry: e, caps: Some(vec![]), wants: None, keep: vec![], via: vec![] }, &[5]),
            (Action::Mark { vault: v, entry: e, caps: None, wants: Some(vec![]), keep: vec![], via: vec![] }, &[5]),
            (keys, &[6]),
        ];
        for (action, tag) in kinds {
            assert!(tagged(action.clone()).starts_with(tag), "{action:?}");
        }
        // a settings edit names its vault before its sub-kind: 0 a threshold, 1 the root
        let threshold = tagged(Action::Settings { vault: v, set: Setting::Threshold(1) });
        assert_eq!(threshold, [&[1][..], &v.0, &[0], &1u32.to_be_bytes()].concat());
        let root = tagged(Action::Settings { vault: v, set: Setting::Root { root: None, keep: vec![] } });
        assert_eq!(root, [&[1][..], &v.0, &[1, 0], &[0; 4]].concat());
    }

    #[test]
    fn a_marks_audience_and_its_wants_are_each_there_or_not() {
        let (v, e, k) = (VaultId::from_u64(1), EntryId::from_u64(2), EditId::from_u64(5));
        let (a, b) = (ShareId::from_u64(3), ShareId::from_u64(4));
        let mark = |caps: Option<Vec<ShareId>>, wants: Option<Vec<ShareId>>, keep: Vec<EditId>| {
            Action::Mark { vault: v, entry: e, caps, wants, keep, via: vec![] }
        };
        let n = |x: u32| x.to_be_bytes();
        // its tag, its vault, its entry; its audience's shares behind a byte that says whether they are there (1) or
        // not (0), its wants alike; then the edits it keeps and the owners it goes through
        let golden: [(Action, Vec<u8>); 4] = [
            (
                mark(Some(vec![a, b]), None, vec![k]),
                [&[5][..], &v.0, &e.0, &[1], &n(2), &a.0, &b.0, &[0], &n(1), &k.0, &n(0)].concat(),
            ),
            (mark(None, Some(vec![a]), vec![]), [&[5][..], &v.0, &e.0, &[0], &[1], &n(1), &a.0, &n(0), &n(0)].concat()),
            (
                mark(Some(vec![b]), Some(vec![a]), vec![]),
                [&[5][..], &v.0, &e.0, &[1], &n(1), &b.0, &[1], &n(1), &a.0, &n(0), &n(0)].concat(),
            ),
            (mark(None, None, vec![]), [&[5][..], &v.0, &e.0, &[0], &[0], &n(0), &n(0)].concat()),
        ];
        for (action, bytes) in &golden {
            assert_eq!(tagged(action.clone()), *bytes, "{action:?}");
        }
        // an empty audience or no wants is something, and not the same as leaving the part out
        let some = [mark(Some(vec![]), None, vec![]), mark(None, Some(vec![]), vec![]), mark(None, None, vec![])];
        assert!(distinct(&some.map(|action| edit_id(&Edit { action, ..genesis(0) }))));
    }

    #[test]
    fn a_levels_byte_is_its_rank_and_whom_a_share_names_has_a_byte_of_its_own() {
        let level = |l: Level| {
            let mut out = vec![];
            l.encode(&mut out);
            out
        };
        let levels = [Level::Relay, Level::Backup, Level::Read, Level::Write, Level::Owner];
        assert_eq!(levels.map(level), [[1], [2], [3], [4], [5]]);
        // keep is rank 0, and its mode's byte follows: 0 whole, 1 opened, 2 never
        let keeps = [KeepMode::Whole, KeepMode::Opened, KeepMode::Never].map(|m| level(Level::Keep(m)));
        assert_eq!(keeps, [[0, 0], [0, 1], [0, 2]]);
        let (v, d) = (VaultId::from_u64(5), SignerId::from_u64(6));
        let who = |w: Who| {
            let mut out = vec![];
            w.encode(&mut out);
            out
        };
        assert_eq!(who(Who::Vault(v)), [&[0][..], &v.0].concat());
        assert_eq!(who(Who::Everyone), [1]);
        assert_eq!(who(Who::Device(d)), [&[2][..], &d.0].concat());
    }

    #[test]
    fn a_keep_share_is_a_grant_to_a_device_with_its_mode_after_its_rank() {
        let (v, d) = (VaultId::from_u64(1), SignerId::from_u64(2));
        let keep = |mode| {
            let level = Level::Keep(mode);
            let (wide, select, parent) = (false, vec![7], None);
            Share { over: v, who: Who::Device(d), level, wide, select, parent, issuer: v, nonce: 9 }
        };
        let n = |x: u32| x.to_be_bytes();
        // the share's tag and sub-kind, the vault it is over, the device it names, keep's rank and its mode, not wide,
        // its sealed slice, no parent, its issuer and its nonce; then the owners it goes through
        let modes = [(KeepMode::Whole, 0), (KeepMode::Opened, 1), (KeepMode::Never, 2)];
        for (mode, b) in modes {
            let grant = Action::Share(Sharing::Grant(keep(mode), vec![]));
            let nonce = 9u64.to_be_bytes();
            let golden = [&[2, 0][..], &v.0, &[2], &d.0, &[0, b], &[0], &n(1), &[7], &[0], &v.0, &nonce, &n(0)];
            assert_eq!(tagged(grant), golden.concat(), "{mode:?}");
        }
        // each mode is a share of its own
        let id = |m| edit_id(&Edit { action: Action::Share(Sharing::Grant(keep(m), vec![])), ..genesis(0) });
        assert!(distinct(&modes.map(|(m, _)| id(m))));
    }

    #[test]
    fn the_owners_an_act_goes_through_change_its_id() {
        let w = |via: Vec<VaultId>| edit_id(&write(None, Proposal::Main, via, None));
        let (b, g) = (VaultId::from_u64(2), VaultId::from_u64(3));
        assert!(distinct(&[w(vec![]), w(vec![b]), w(vec![g]), w(vec![g, b]), w(vec![b, g])]));
    }

    #[test]
    fn a_shares_slice_and_width_change_its_id() {
        let share = |wide, select: &[u8]| {
            let c = Share {
                over: VaultId::from_u64(1),
                who: Who::Vault(VaultId::from_u64(2)),
                level: Level::Read,
                wide,
                select: select.to_vec(),
                parent: None,
                issuer: VaultId::from_u64(1),
                nonce: 0,
            };
            edit_id(&Edit { action: Action::Share(Sharing::Grant(c, vec![])), ..genesis(0) })
        };
        assert!(distinct(&[share(false, b""), share(true, b""), share(false, b"todos"), share(false, b"notes")]));
    }

    #[test]
    fn a_box_is_bound_to_its_key_and_recipient() {
        let (v, e) = (VaultId::from_u64(1), EntryId::from_u64(1));
        let id = KeyId([7; 32]);
        let seed = KeyName::Scoped(KeyFam::Seed(v), 0);
        let infos = [
            box_info(seed, id, &Recipient::Signer(SignerId::from_u64(1))),
            box_info(seed, id, &Recipient::Signer(SignerId::from_u64(2))),
            box_info(KeyName::Scoped(KeyFam::Seed(v), 1), id, &Recipient::Signer(SignerId::from_u64(1))),
            box_info(KeyName::Entry(e, None, 0), id, &Recipient::Signer(SignerId::from_u64(1))),
            box_info(KeyName::Entry(e, Some(EditId::from_u64(3)), 0), id, &Recipient::Signer(SignerId::from_u64(1))),
            box_info(seed, KeyId([8; 32]), &Recipient::Signer(SignerId::from_u64(1))),
            box_info(seed, id, &Recipient::Key { name: KeyName::Scoped(KeyFam::Seed(v), 1), id }),
        ];
        assert!(infos.iter().enumerate().all(|(i, x)| infos[i + 1..].iter().all(|y| x != y)));
    }

    #[test]
    fn lengths_keep_neighbouring_fields_apart() {
        // the same bytes split differently between the cosigners and the action must not collide
        let a = Edit { cosigners: vec![SignerId::from_u64(5)], ..genesis(0) };
        let b = Edit { cosigners: vec![], ..genesis(0) };
        let (mut ea, mut eb) = (vec![], vec![]);
        a.encode(&mut ea);
        b.encode(&mut eb);
        assert!(!ea.starts_with(&eb) && !eb.starts_with(&ea));
    }
}
