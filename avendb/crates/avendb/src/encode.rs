//! The canonical encoding of an edit: the bytes its id hashes and its signatures sign (through the id). Every value has
//! exactly one encoding and none is a prefix of another of the same type, so two different edits never share bytes:
//! integers are big-endian and fixed-size, sequences carry their length, and every enum starts with a tag. The first
//! byte is the format's version, so a later format can live beside this one.

use crate::keys::{KeyBox, KeyFam, KeyId, KeyName, PublicKey, Recipient};
use crate::policy::{Action, Cap, Edit, Grantee, Kind, Principal, Proposal, Role};
use crate::rules::{On, Opening, Proof, Rule, Scalar, Step};
use crate::slice::{Atom, Body, Header, Select, Selector, Slice, Sym, TagDelta};

/// The version byte every edit starts with: 5 since flat vaults, whose caps select slices of a vault and whose entries
/// sit in cells (4 since the three kinds of vault, 3 since P5, whose writes name the line of history they extend, 2
/// since P4b, whose ids are SHA-3 hashes and whose signers sign twice).
pub const VERSION: u8 = 5;

/// An edit's id: the hash of its encoding, for a purpose that keeps an edit's old name, op (`hash::PREFIX`).
pub(crate) fn edit_id(edit: &Edit) -> [u8; 32] {
    crate::hash::hash("op id", &bytes(edit))
}

/// An edit's bytes: the version, then its encoding.
pub fn bytes(edit: &Edit) -> Vec<u8> {
    let mut out = Vec::with_capacity(128);
    out.push(VERSION);
    edit.encode(&mut out);
    out
}

/// What a write's ciphertext is bound to: the edit's bytes with an empty body, so the edit can't be moved to another
/// edit, entry, stay or generation.
pub fn write_context(edit: &Edit) -> Vec<u8> {
    let mut edit = edit.clone();
    if let Action::Write { body, .. } = &mut edit.action {
        body.clear();
    }
    bytes(&edit)
}

/// What a cap's sealed slice is bound to: the cap with an empty `select`, so the slice can't be moved to another cap,
/// another grantee or another role.
pub fn cap_context(cap: &Cap) -> Vec<u8> {
    let mut out = vec![VERSION];
    Cap { select: vec![], ..cap.clone() }.encode(&mut out);
    out
}

/// What a box of a cap's selector key is bound to (`slice::Select`): the cap with an empty `select`, the key it holds,
/// and for whom. It opens as no other box, and for no other cap.
pub fn select_info(cap: &Cap, id: KeyId, to: &Recipient) -> Vec<u8> {
    let mut out = cap_context(cap);
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
    crate::id::CapId,
    crate::id::CellId,
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
            KeyFam::Cap(v, c) => {
                out.push(1);
                v.encode(out);
                c.encode(out);
            }
            KeyFam::Cell(v, x) => {
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
            KeyName::Entry(e, stay, generation) => {
                out.push(2);
                e.encode(out);
                stay.encode(out);
                generation.encode(out);
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

/// A ruled cap's rules and the openings above it follow only where it has them, so a slice without them keeps the
/// bytes it had before caps named ops; a slice is always read from the bytes of its own (`wire`).
impl Encode for Slice {
    fn encode(&self, out: &mut Vec<u8>) {
        self.select.encode(out);
        self.relabel.encode(out);
        if self.rules.is_some() || !self.above.is_empty() {
            self.rules.encode(out);
            self.above.encode(out);
        }
    }
}

/// A sealed slice of a ruled cap carries the commitment to its rules beside it (tag 2), so a sealed slice of a cap
/// without rules keeps the bytes it had before caps named ops (tag 1).
impl Encode for Select {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Select::Clear(slice) => {
                out.push(0);
                slice.encode(out);
            }
            Select::Sealed { boxes, slice, rules: None } => {
                out.push(1);
                boxes.encode(out);
                slice.encode(out);
            }
            Select::Sealed { boxes, slice, rules: Some(commitment) } => {
                out.push(2);
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

impl Encode for Rule {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Rule::Set { path, to, on } => {
                out.push(0);
                path.encode(out);
                to.as_deref().encode(out);
                on.encode(out);
            }
            Rule::Insert { path, on } => {
                out.push(1);
                path.encode(out);
                on.encode(out);
            }
            Rule::Remove { path, on } => {
                out.push(2);
                path.encode(out);
                on.encode(out);
            }
            Rule::Move { path, on } => {
                out.push(3);
                path.encode(out);
                on.encode(out);
            }
            Rule::Merge { on } => {
                out.push(4);
                on.encode(out);
            }
            Rule::Propose => out.push(5),
            Rule::Create => out.push(6),
        }
    }
}

impl Encode for Opening {
    fn encode(&self, out: &mut Vec<u8>) {
        self.rules.encode(out);
        self.salt.encode(out);
    }
}

impl Encode for Proof {
    fn encode(&self, out: &mut Vec<u8>) {
        self.cap.encode(out);
        self.openings.encode(out);
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

/// A write's proof follows only where it carries one, so a body without one keeps the bytes it had before caps named
/// ops; a body is always read from the bytes of its own (`wire`).
impl Encode for Body {
    fn encode(&self, out: &mut Vec<u8>) {
        self.header.encode(out);
        self.tags.encode(out);
        self.answers.encode(out);
        self.content.encode(out);
        if let Some(proof) = &self.proof {
            proof.encode(out);
        }
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

impl Encode for Role {
    fn encode(&self, out: &mut Vec<u8>) {
        out.push(match self {
            Role::Backup => 0,
            Role::Read => 1,
            Role::Write => 2,
            Role::Owner => 3,
            Role::Relay => 4,
        });
    }
}

impl Encode for Grantee {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Grantee::Principal(p) => {
                out.push(0);
                p.encode(out);
            }
            Grantee::Public => out.push(1),
        }
    }
}

impl Encode for Cap {
    fn encode(&self, out: &mut Vec<u8>) {
        self.over.encode(out);
        self.grantee.encode(out);
        self.role.encode(out);
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
            Action::AddOwner { vault, owner, seal_to } => {
                out.push(1);
                vault.encode(out);
                owner.encode(out);
                seal_to.encode(out);
            }
            Action::RemoveOwner { vault, owner, keep } => {
                out.push(2);
                vault.encode(out);
                owner.encode(out);
                keep.encode(out);
            }
            Action::SetThreshold { vault, threshold } => {
                out.push(3);
                vault.encode(out);
                threshold.encode(out);
            }
            Action::AddDevice { vault, device, seal_to } => {
                out.push(4);
                vault.encode(out);
                device.encode(out);
                seal_to.encode(out);
            }
            Action::RemoveDevice { vault, device, keep } => {
                out.push(5);
                vault.encode(out);
                device.encode(out);
                keep.encode(out);
            }
            Action::SetRoot { vault, root, keep } => {
                out.push(6);
                vault.encode(out);
                root.encode(out);
                keep.encode(out);
            }
            Action::Cap(c, via) => {
                out.push(7);
                c.encode(out);
                via.encode(out);
            }
            Action::Revoke { cap, actor, keep, via } => {
                out.push(8);
                cap.encode(out);
                actor.encode(out);
                keep.encode(out);
                via.encode(out);
            }
            Action::Write { vault, entry, actor, stay, generation, deps, proposal, via, create, body } => {
                out.push(9);
                vault.encode(out);
                entry.encode(out);
                actor.encode(out);
                stay.encode(out);
                generation.encode(out);
                deps.encode(out);
                proposal.encode(out);
                via.encode(out);
                create.as_deref().encode(out);
                body.encode(out);
            }
            Action::Move { vault, entry, to, keep, via } => {
                out.push(10);
                vault.encode(out);
                entry.encode(out);
                to.encode(out);
                keep.encode(out);
                via.encode(out);
            }
            Action::Keys { name, id, public, boxes, clear } => {
                out.push(11);
                name.encode(out);
                id.encode(out);
                public.encode(out);
                boxes.encode(out);
                clear.encode(out);
            }
            Action::Publish { vault, actor, via, blob } => {
                out.push(12);
                vault.encode(out);
                actor.encode(out);
                via.encode(out);
                blob.encode(out);
            }
            Action::Checkpoint { entry, covers } => {
                out.push(13);
                entry.encode(out);
                covers.encode(out);
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
    use crate::id::{CapId, EditId, EntryId, SignerId, VaultId};

    fn genesis(nonce: u64) -> Edit {
        let owners = vec![Principal::Signer(SignerId::from_u64(1))];
        let action = Action::Genesis { kind: Kind::Human, owners, threshold: 1, root: None, nonce, seal_to: vec![] };
        Edit { parents: vec![], depth: 0, author: SignerId::from_u64(1), cosigners: vec![], action }
    }

    fn write(stay: Option<EditId>, proposal: Proposal, via: Vec<VaultId>, create: Option<Vec<CapId>>) -> Edit {
        let (vault, entry, actor) = (VaultId::from_u64(1), EntryId::from_u64(1), VaultId::from_u64(1));
        let (deps, body) = (vec![], vec![]);
        let action = Action::Write { vault, entry, actor, stay, generation: 0, deps, proposal, via, create, body };
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
        o.action = Action::AddDevice { vault: VaultId::from_u64(1), device: SignerId::from_u64(1), seal_to: None };
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
    fn a_writes_line_stay_and_cell_change_its_id() {
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
            edit_id(&write(None, Proposal::Main, vec![], Some(vec![CapId::from_u64(1)]))),
        ];
        assert!(distinct(&ids));
    }

    #[test]
    fn the_owners_an_act_goes_through_change_its_id() {
        let w = |via: Vec<VaultId>| edit_id(&write(None, Proposal::Main, via, None));
        let (b, g) = (VaultId::from_u64(2), VaultId::from_u64(3));
        assert!(distinct(&[w(vec![]), w(vec![b]), w(vec![g]), w(vec![g, b]), w(vec![b, g])]));
    }

    #[test]
    fn a_caps_slice_and_width_change_its_id() {
        let cap = |wide, select: &[u8]| {
            let c = Cap {
                over: VaultId::from_u64(1),
                grantee: Grantee::Principal(Principal::Vault(VaultId::from_u64(2))),
                role: Role::Read,
                wide,
                select: select.to_vec(),
                parent: None,
                issuer: VaultId::from_u64(1),
                nonce: 0,
            };
            edit_id(&Edit { action: Action::Cap(c, vec![]), ..genesis(0) })
        };
        assert!(distinct(&[cap(false, b""), cap(true, b""), cap(false, b"todos"), cap(false, b"notes")]));
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
