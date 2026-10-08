//! The canonical encoding of an op: the bytes its id hashes and its signatures sign (through the id). Every value has
//! exactly one encoding and none is a prefix of another of the same type, so two different ops never share bytes:
//! integers are big-endian and fixed-size, sequences carry their length, and every enum starts with a tag. The first
//! byte is the format's version, so a later format can live beside this one.

use crate::keys::{KeyBox, KeyId, KeyScope, PublicKey, Recipient};
use crate::policy::{Action, Branch, Grant, Grantee, Kind, Op, Principal, Role, Scope};

/// The version byte every op starts with: 3 since P5, whose writes name the line of history they extend (2 since P4b,
/// whose ids are SHA-3 hashes and whose signers sign twice).
pub const VERSION: u8 = 3;

pub(crate) fn op_id(op: &Op) -> [u8; 32] {
    crate::hash::hash("op id", &bytes(op))
}

/// An op's bytes: the version, then its encoding.
pub fn bytes(op: &Op) -> Vec<u8> {
    let mut out = Vec::with_capacity(128);
    out.push(VERSION);
    op.encode(&mut out);
    out
}

/// What a write's ciphertext is bound to: the op's bytes with an empty body, so the edit can't be moved to another
/// op, entry or epoch.
pub fn write_context(op: &Op) -> Vec<u8> {
    let mut op = op.clone();
    if let Action::Write { body, .. } = &mut op.action {
        body.clear();
    }
    bytes(&op)
}

/// What a box is bound to: which key it holds, and for whom. A box can't be passed off as another key's, nor moved to
/// another recipient.
pub fn box_info(key: KeyScope, epoch: u64, id: KeyId, to: &Recipient) -> Vec<u8> {
    let mut out = vec![VERSION];
    key.encode(&mut out);
    epoch.encode(&mut out);
    id.encode(&mut out);
    to.encode(&mut out);
    out
}

pub(crate) trait Encode {
    fn encode(&self, out: &mut Vec<u8>);
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

impl Encode for [u8; 32] {
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

ids!(crate::id::SignerId, crate::id::VaultId, crate::id::SpaceId, crate::id::EntryId, crate::id::GrantId, crate::id::OpId, crate::id::BlobId, KeyId);

impl Encode for PublicKey {
    fn encode(&self, out: &mut Vec<u8>) {
        self.xwing.encode(out);
        self.mceliece.encode(out);
    }
}

impl Encode for KeyScope {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            KeyScope::Vault(v) => {
                out.push(0);
                v.encode(out);
            }
            KeyScope::Space(sp) => {
                out.push(1);
                sp.encode(out);
            }
            KeyScope::Entry(sp, e) => {
                out.push(2);
                sp.encode(out);
                e.encode(out);
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
            Recipient::Key { key, epoch, id } => {
                out.push(1);
                key.encode(out);
                epoch.encode(out);
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

impl Encode for Kind {
    fn encode(&self, out: &mut Vec<u8>) {
        out.push(match self {
            Kind::Human => 0,
            Kind::Coop => 1,
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
            Role::Relay => 0,
            Role::Read => 1,
            Role::Write => 2,
            Role::Owner => 3,
        });
    }
}

impl Encode for Scope {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Scope::Space(sp) => {
                out.push(0);
                sp.encode(out);
            }
            Scope::Entry(sp, e) => {
                out.push(1);
                sp.encode(out);
                e.encode(out);
            }
        }
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

impl Encode for Grant {
    fn encode(&self, out: &mut Vec<u8>) {
        self.scope.encode(out);
        self.role.encode(out);
        self.grantee.encode(out);
        self.issuer.encode(out);
        self.parent.encode(out);
    }
}

impl Encode for Branch {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Branch::Main => out.push(0),
            Branch::New => out.push(1),
            Branch::On(b) => {
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
            Action::FoundSpace { actor, nonce } => {
                out.push(6);
                actor.encode(out);
                nonce.encode(out);
            }
            Action::Grant(g) => {
                out.push(7);
                g.encode(out);
            }
            Action::Revoke { grant, actor, keep } => {
                out.push(8);
                grant.encode(out);
                actor.encode(out);
                keep.encode(out);
            }
            Action::Write { space, entry, actor, epoch, deps, branch, body } => {
                out.push(9);
                space.encode(out);
                entry.encode(out);
                actor.encode(out);
                epoch.encode(out);
                deps.encode(out);
                branch.encode(out);
                body.encode(out);
            }
            Action::SetRoot { vault, root, keep } => {
                out.push(10);
                vault.encode(out);
                root.encode(out);
                keep.encode(out);
            }
            Action::Keys { key, epoch, id, public, boxes, clear } => {
                out.push(11);
                key.encode(out);
                epoch.encode(out);
                id.encode(out);
                public.encode(out);
                boxes.encode(out);
                clear.encode(out);
            }
            Action::Publish { space, actor, blob } => {
                out.push(12);
                space.encode(out);
                actor.encode(out);
                blob.encode(out);
            }
            Action::Checkpoint { space, entry, covers } => {
                out.push(13);
                space.encode(out);
                entry.encode(out);
                covers.encode(out);
            }
        }
    }
}

impl Encode for Op {
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
    use crate::id::{SignerId, VaultId};

    fn genesis(nonce: u64) -> Op {
        let owners = vec![Principal::Signer(SignerId::from_u64(1))];
        let action = Action::Genesis { kind: Kind::Human, owners, threshold: 1, root: None, nonce, seal_to: vec![] };
        Op { parents: vec![], depth: 0, author: SignerId::from_u64(1), cosigners: vec![], action }
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
        o.parents = vec![crate::id::OpId::from_u64(9)];
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
            assert_ne!(op_id(o), op_id(&base), "{o:?}");
        }
        assert_eq!(op_id(&base), op_id(&genesis(0)));
    }

    #[test]
    fn a_writes_line_changes_its_id() {
        let write = |branch| {
            let (space, entry) = (crate::id::SpaceId::from_u64(1), crate::id::EntryId::from_u64(1));
            let actor = VaultId::from_u64(1);
            let action = Action::Write { space, entry, actor, epoch: 0, deps: vec![], branch, body: vec![] };
            op_id(&Op { action, ..genesis(0) })
        };
        let (a, b) = (crate::id::OpId::from_u64(1), crate::id::OpId::from_u64(2));
        let ids = [write(Branch::Main), write(Branch::New), write(Branch::On(a)), write(Branch::On(b))];
        assert!(ids.iter().enumerate().all(|(i, x)| ids[i + 1..].iter().all(|y| x != y)));
    }

    #[test]
    fn lengths_keep_neighbouring_fields_apart() {
        // the same bytes split differently between the cosigners and the action must not collide
        let a = Op { cosigners: vec![SignerId::from_u64(5)], ..genesis(0) };
        let b = Op { cosigners: vec![], ..genesis(0) };
        let (mut ea, mut eb) = (vec![], vec![]);
        a.encode(&mut ea);
        b.encode(&mut eb);
        assert!(!ea.starts_with(&eb) && !eb.starts_with(&ea));
    }
}
