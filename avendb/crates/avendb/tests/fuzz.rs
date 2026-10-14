//! Mutation fuzzing (P4b): what a device takes from others (key boxes, encrypted writes, signed edits, schemas, lenses,
//! Loro updates), changed a bit or a byte at a time, cut short, grown or spliced; from P8 every message on the wire
//! (signed edits, hellos, asks, requests, replies, announcements, and from P8c passkeys' hellos and joins); and with
//! flat vaults what only readers read: a share's slice, its selector in the clear or sealed (a keep share's too), and a
//! write's body. Nothing panics; a changed box, write, signed edit or sealed selector is refused, a changed message
//! reads as nothing or as another message whose own bytes these are, and a changed Loro update that is refused leaves
//! the item as it was. Every mutation is drawn from a fixed seed, so a failure replays exactly.

use std::fmt::Debug;
use std::sync::OnceLock;

use serde_json::{json, Map, Value};
use avendb::doc::{Item, Version};
use avendb::encode::{share_context, share_select_info, write_context};
use avendb::id::{AudienceId, BlobId, EditId, EntryId, ShareId, SignerId, VaultId};
use avendb::keys::{self, KeyBox, KeyFam, KeyName, Recipient, SeededRng, Secret};
use avendb::lens::{blobs, BlockV2, Lane, Lens, Schema, TypeV2, View, DOCUMENT_V1, DOCUMENT_V2, TODO_V1, TODO_V2};
use avendb::policy::{Action, Edit, KeepMode, Level, Proposal, Revoking, Share, Sharing, Who};
use avendb::rules::{Grant, On, Op, Proof, Scalar, Step};
use avendb::sign::{Assertion, DeviceKey, Hello, Passkey, RelayPass, Signature, SignerKeys, Signed, WebAuthn};
use avendb::slice::{Atom, Body, Header, Select, Selector, Slice, Sym, TagDelta};
use avendb::sync::{Ask, LogId};
use avendb::sealed::{FileRoot, PIECE};
use avendb::wire::{Announce, Claim, FileHold, Frontier, Join, Reply, Request, Wire};

/// Where and how to mutate: xorshift64*, seeded per test.
struct Gen(u64);

impl Gen {
    fn new(seed: u64) -> Gen {
        Gen(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1)
    }

    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }

    /// One to 32 random bytes.
    fn bytes(&mut self) -> Vec<u8> {
        let n = 1 + self.below(32);
        (0..n).map(|_| self.next() as u8).collect()
    }
}

/// A changed copy of `bytes`, never equal to it: one to three of a bit flipped, a byte replaced, the end cut off,
/// random bytes added at the end or put in anywhere, and a run taken out.
fn mutate(g: &mut Gen, bytes: &[u8]) -> Vec<u8> {
    loop {
        let mut out = bytes.to_vec();
        for _ in 0..1 + g.below(3) {
            let at = g.below(out.len() + 1);
            match g.below(6) {
                0 if !out.is_empty() => {
                    let i = g.below(out.len());
                    out[i] ^= 1 << g.below(8);
                }
                1 if !out.is_empty() => {
                    let i = g.below(out.len());
                    out[i] = g.next() as u8;
                }
                2 => out.truncate(at),
                3 => {
                    let more = g.bytes();
                    out.extend(more);
                }
                4 => {
                    let end = (at + 1 + g.below(64)).min(out.len());
                    out.drain(at.min(end)..end);
                }
                _ => {
                    let more = g.bytes();
                    out.splice(at..at, more);
                }
            }
        }
        if out != bytes {
            return out;
        }
    }
}

#[test]
fn a_changed_box_opens_to_nothing() {
    let mut rng = SeededRng::new("fuzz", b"boxes");
    let (key, to, other) = (Secret::generate(&mut rng), Secret::generate(&mut rng), Secret::generate(&mut rng));
    let info = b"the door's cell key at generation 0, for Alice's vault key";
    let sealed = keys::seal(&key, &to.public(), &to.mceliece_public(), info, &mut rng).expect("a key to seal to");
    let wrapped = keys::wrap(&key, &to, info, &mut rng);
    let opened = |bytes: &[u8], with: &Secret, info: &[u8]| keys::open(bytes, with, info).map(|k| k.id());
    assert_eq!(opened(&sealed, &to, info), Some(key.id()));
    assert_eq!(opened(&wrapped, &to, info), Some(key.id()));
    // not for another key, nor bound to anything else
    assert_eq!(opened(&sealed, &other, info), None);
    assert_eq!(opened(&wrapped, &other, info), None);
    assert_eq!(opened(&sealed, &to, b"the door's cell key at generation 1"), None);
    assert_eq!(opened(&wrapped, &to, b""), None);
    let mut g = Gen::new(1);
    // each try at a sealed box costs both decapsulations, so fewer of them
    for _ in 0..40 {
        let bad = mutate(&mut g, &sealed);
        assert_eq!(opened(&bad, &to, info), None, "{} of {} bytes", bad.len(), sealed.len());
    }
    for _ in 0..4000 {
        let bad = mutate(&mut g, &wrapped);
        assert_eq!(opened(&bad, &to, info), None, "{bad:?}");
        let bad = mutate(&mut g, info);
        assert_eq!(opened(&wrapped, &to, &bad), None, "{bad:?}");
    }
}

/// Alice's and Bob's vaults, and the door todo in Alice's.
const ALICE: VaultId = VaultId::from_u64(100);
const BOB: VaultId = VaultId::from_u64(101);
const DOOR: EntryId = EntryId::from_u64(21);

/// What the sealed parts of `signed_edits` open with: the key of the door in its first stay, under which its writes
/// are encrypted, and the current seeds of Alice's and Bob's vaults, to which the share's selector key is wrapped.
struct Keys {
    door: Secret,
    alice: Secret,
    bob: Secret,
}

fn keys() -> Keys {
    let mut rng = SeededRng::new("fuzz", b"keys");
    Keys { door: Secret::generate(&mut rng), alice: Secret::generate(&mut rng), bob: Secret::generate(&mut rng) }
}

/// What the share of `signed_edits` shares: Alice's work todos, for Bob to edit and ask her stewards for the tag
/// `done`.
fn work_todos() -> Slice {
    let select = Selector::AnyOf(vec![vec![Atom::TypeIn(vec![Sym::new("todo")]), Atom::TagHas(Sym::new("work"))]]);
    let ops = vec![Op::Read, Op::Set { path: vec![], to: None, on: None }, Op::Tag(Some(vec![Sym::new("done")]))];
    Slice { name: "Work todos".into(), select, grant: Grant { ops, salt: [4; 32] }, above: vec![] }
}

/// What the keep share of `signed_edits` picks: Bob's entries tagged `proxy`, granting no op.
fn proxies() -> Slice {
    let select = Selector::AnyOf(vec![vec![Atom::TagHas(Sym::new("proxy"))]]);
    Slice { name: "Proxies".into(), select, grant: Grant { ops: vec![], salt: [6; 32] }, above: vec![] }
}

/// The body of the write that creates the door: its header, its first tags and its content.
fn door_created() -> Body {
    let header = Some(Header { ty: Sym::new("todo"), created: 1_791_500_000 });
    let tags = TagDelta { add: vec![Sym::new("work")], remove: vec![] };
    Body { header, tags, answers: vec![], content: b"Fix the door".to_vec(), proof: None, files: vec![] }
}

/// The body of a write of tags alone, by a steward answering what two writes asked for.
fn door_retagged() -> Body {
    let tags = TagDelta { add: vec![Sym::new("done")], remove: vec![Sym::new("work")] };
    let answers = vec![EditId::from_u64(4), EditId::from_u64(6)];
    Body { header: None, tags, answers, content: vec![], proof: None, files: vec![] }
}

/// Alice's work todos as a narrower share shares them (`rules`): its own ops, to tick a todo done on the main line, add
/// its items, merge proposals in and start them, under the ops of a share above it, which every kind of op, step and
/// value appears in.
fn tick_todos() -> Slice {
    let (done, items) = (Step::Field("done".into()), Step::Field("items".into()));
    let ops = vec![
        Op::Read,
        Op::Set { path: vec![done], to: Some(vec![Scalar::Bool(true)]), on: Some(On::Main) },
        Op::Insert { path: vec![items.clone()], on: None },
        Op::Merge { on: Some(On::Proposals) },
        Op::Propose,
    ];
    let to = vec![Scalar::Null, Scalar::Int(-7), Scalar::Text("ok".into()), Scalar::Bool(false)];
    let above = vec![
        Op::Set { path: vec![items.clone(), Step::Row(-3), Step::Any], to: Some(to), on: None },
        Op::Set { path: vec![], to: None, on: Some(On::Proposals) },
        Op::Remove { path: vec![items.clone()], on: Some(On::Main) },
        Op::Move { path: vec![Step::Any], on: None },
        Op::Merge { on: None },
        Op::Create,
        Op::Tag(None),
        Op::Relay,
        Op::Backup,
        Op::Share,
    ];
    let above = vec![Grant { ops: above, salt: [9; 32] }];
    Slice { name: "Done on main".into(), grant: Grant { ops, salt: [5; 32] }, above, ..work_todos() }
}

/// The write of tags of `door_retagged` by a steward relying on the share of `tick_todos`, with its proof.
fn door_proven() -> Body {
    let proof = Proof { share: ShareId::from_u64(9), grants: tick_todos().grants() };
    Body { proof: Some(proof), ..door_retagged() }
}

/// Who a box of a key for vault `v`'s seed `seed` goes to.
fn to_seed(v: VaultId, seed: &Secret) -> Recipient {
    Recipient::Key { name: KeyName::Scoped(KeyFam::Seed(v), 0), id: seed.id() }
}

/// The `select` of share `of`, holding `slice`, sealed under a key of its own, which is wrapped under the seeds of
/// Alice's vault and of Bob's (the share's issuer and grantee, or the keep share's issuer and the vault it is over),
/// with the commitment to the slice's ops (`slice::Select`).
fn seal_select(of: &Share, slice: &Slice, k: &Keys, rng: &mut SeededRng) -> Vec<u8> {
    let key = Secret::generate(rng);
    let sealed = keys::seal_edit(&key, &slice.to_wire(), &share_context(of), rng);
    let boxes = [(ALICE, &k.alice), (BOB, &k.bob)].map(|(v, seed)| {
        let to = to_seed(v, seed);
        KeyBox { to, bytes: keys::wrap(&key, seed, &share_select_info(of, key.id(), &to), rng) }
    });
    Select::Sealed { boxes: boxes.to_vec(), slice: sealed, commitment: slice.grant.commitment() }.to_wire()
}

/// The slice the selector of `of` holds, opened with vault `v`'s seed `seed` as a reader opens it: in the clear, or
/// through the box for that seed; `None` if it never opens.
fn open_select(of: &Share, v: VaultId, seed: &Secret) -> Option<Slice> {
    let (boxes, sealed) = match Select::from_wire(&of.select).ok()? {
        Select::Clear(slice) => return Some(slice),
        Select::Sealed { boxes, slice, .. } => (boxes, slice),
    };
    let id = keys::edit_key(&sealed)?;
    let b = boxes.iter().find(|b| b.to == to_seed(v, seed))?;
    let key = keys::open(&b.bytes, seed, &share_select_info(of, id, &b.to)).filter(|k| k.id() == id)?;
    Slice::from_wire(&keys::open_edit(&key, &sealed, &share_context(of))?).ok()
}

/// The write `edit`, with `body` encrypted under `key` and bound to the edit (`encode::write_context`).
fn seal_body(mut edit: Edit, body: &Body, key: &Secret, rng: &mut SeededRng) -> Edit {
    let sealed = keys::seal_edit(key, &body.to_wire(), &write_context(&edit), rng);
    if let Action::Write { body, .. } = &mut edit.action {
        *body = sealed;
    }
    edit
}

/// A signed edit of each kind: governance, which both halves sign, by a passkey with the new device consenting; a
/// write creating the door in the audience of two shares, and a write of its tags on a proposal, through the owners it
/// names, which only the classical half signs; a share for Bob to write Alice's work todos, its selector sealed; a
/// steward's mark of the door, taking it to another audience, keeping the writes it had seen, and with the keep shares
/// that pick it; a keep share of Alice's for her device to sync Bob's proxies, its selector sealed, and its revocation;
/// and a steward's mark of the door's wants alone.
struct Edits {
    add: Signed,
    create: Signed,
    write: Signed,
    share: Signed,
    marked: Signed,
    keep: Signed,
    revoked: Signed,
    wanted: Signed,
}

impl Edits {
    fn all(&self) -> [&Signed; 8] {
        [&self.add, &self.create, &self.write, &self.share, &self.marked, &self.keep, &self.revoked, &self.wanted]
    }
}

fn signed_edits() -> Edits {
    let device = DeviceKey::from_secret([7; 32]);
    let mut passkey = Passkey::from_seed([9; 32]);
    let (k, mut rng) = (keys(), SeededRng::new("fuzz", b"edits"));
    let by_device = |edit: Edit| Signed { sigs: vec![device.sign(edit.id())], edit };
    let add = Edit {
        parents: vec![EditId::from_u64(1)],
        depth: 1,
        author: passkey.id(),
        cosigners: vec![device.id()],
        action: Action::Share(Sharing::Device { vault: ALICE, device: device.id(), seal_to: None }),
    };
    let sigs = vec![passkey.sign(add.id()), device.sign(add.id())];
    let add = Signed { edit: add, sigs };
    let author = device.id();
    let edit = |depth: u64, action: Action| Edit { parents: vec![], depth, author, cosigners: vec![], action };
    let (audience, main) = (vec![ShareId::from_u64(8), ShareId::from_u64(9)], Proposal::Main);
    let create = Action::Write {
        vault: ALICE,
        entry: DOOR,
        actor: ALICE,
        stay: None,
        epoch: 1,
        deps: vec![],
        proposal: main,
        via: vec![],
        create: Some(audience),
        files: vec![],
        body: vec![],
    };
    let create = by_device(seal_body(edit(2, create), &door_created(), &k.door, &mut rng));
    let write = Action::Write {
        vault: ALICE,
        entry: DOOR,
        actor: ALICE,
        stay: None,
        epoch: 1,
        deps: vec![create.edit.id()],
        proposal: Proposal::On(create.edit.id()),
        via: vec![VaultId::from_u64(3), VaultId::from_u64(4)],
        create: None,
        files: vec![],
        body: vec![],
    };
    let write = by_device(seal_body(edit(3, write), &door_retagged(), &k.door, &mut rng));
    let (who, level, issuer) = (Who::Vault(BOB), Level::Write, ALICE);
    let mut share = Share { over: ALICE, who, level, wide: false, select: vec![], parent: None, issuer, nonce: 7 };
    share.select = seal_select(&share, &work_todos(), &k, &mut rng);
    let share = by_device(edit(4, Action::Share(Sharing::Grant(share, vec![]))));
    let keep = vec![create.edit.id(), write.edit.id()];
    let (caps, wants) = (Some(vec![ShareId::from_u64(9)]), Some(vec![ShareId::from_u64(5)]));
    let marked = by_device(edit(5, Action::Mark { vault: ALICE, entry: DOOR, caps, wants, keep, via: vec![] }));
    let (who, level) = (Who::Device(device.id()), Level::Keep(KeepMode::Whole));
    let mut keep = Share { over: BOB, who, level, wide: false, select: vec![], parent: None, issuer: ALICE, nonce: 3 };
    keep.select = seal_select(&keep, &proxies(), &k, &mut rng);
    let keep = by_device(edit(6, Action::Share(Sharing::Grant(keep, vec![]))));
    let share_id = ShareId::from(keep.edit.id());
    let revoked = Revoking::Grant { share: share_id, actor: ALICE, keep: vec![], via: vec![] };
    let revoked = by_device(edit(7, Action::Revoke(revoked)));
    let wants = Some(vec![ShareId::from_u64(5), ShareId::from_u64(6)]);
    let wanted = Action::Mark { vault: ALICE, entry: DOOR, caps: None, wants, keep: vec![], via: vec![] };
    let wanted = by_device(edit(8, wanted));
    Edits { add, create, write, share, marked, keep, revoked, wanted }
}

/// `add` signed again, its passkey's assertion in one ceremony over a batch: `add` and another edit drafted with it.
fn batched(add: &Signed) -> Signed {
    let mut passkey = Passkey::from_seed([9; 32]);
    let device = DeviceKey::from_secret([7; 32]);
    let mut batch = vec![add.edit.id(), EditId::from_u64(3)];
    batch.sort();
    let ceremony = passkey.ceremony(avendb::sign::batch_challenge(&batch));
    let sig = ceremony.sign_in(passkey.keys(), add.edit.id(), &batch).expect("an edit of the batch");
    Signed { edit: add.edit.clone(), sigs: vec![sig, device.sign(add.edit.id())] }
}

#[test]
fn a_changed_write_decrypts_to_nothing() {
    // a write's body opens with its entry's key, bound to the write as it is with an empty body: the body changed, or
    // the same body in a write that says anything else, opens to nothing
    let (edits, k) = (signed_edits(), keys());
    let open = |body: &[u8], context: &[u8]| keys::open_edit(&k.door, body, context);
    let mut g = Gen::new(2);
    let mut elsewhere = 0;
    for (signed, plain) in [(&edits.create, door_created()), (&edits.write, door_retagged())] {
        let Action::Write { body, .. } = &signed.edit.action else { unreachable!("a write") };
        let context = write_context(&signed.edit);
        assert_eq!(open(body, &context).map(|b| Body::from_wire(&b)), Some(Ok(plain)));
        for _ in 0..2500 {
            let bad = mutate(&mut g, body);
            assert_eq!(open(&bad, &context), None, "{bad:?}");
            let bad = mutate(&mut g, &context);
            assert_eq!(open(body, &bad), None, "{bad:?}");
            let other = write_context(&mutate_edit(&mut g, &signed.edit));
            if other != context {
                assert_eq!(open(body, &other), None, "{other:?}");
                elsewhere += 1;
            }
        }
    }
    // and the changed writes mostly said something else than their body
    assert!(elsewhere > 2500, "{elsewhere}");
}

/// A passkey's real assertion over another edit: put on a device's signature, it makes it no device's.
fn other_assertion() -> Assertion {
    static ONE: OnceLock<Assertion> = OnceLock::new();
    let sign = || match Passkey::from_seed([3; 32]).sign(EditId::from_u64(4)).webauthn {
        Some(WebAuthn::Edit(a)) => a,
        _ => unreachable!("a passkey's assertion"),
    };
    ONE.get_or_init(sign).clone()
}

/// `sig` with one part changed: a key, a passkey's assertion (changed, left out, or one put on a device's), or the
/// SLH-DSA signature (changed, cut short or made up).
fn mutate_signature(g: &mut Gen, sig: &Signature) -> Signature {
    let mut s = sig.clone();
    match g.below(3) {
        0 => {
            let first = g.below(2) == 0;
            let part: &mut [u8] = match &mut s.keys {
                SignerKeys::Device { ed25519, slh } => if first { ed25519 } else { slh },
                SignerKeys::Passkey { p256, slh } => if first { p256 } else { slh },
            };
            let i = g.below(part.len());
            part[i] ^= 1 << g.below(8);
        }
        1 => match &mut s.webauthn {
            None => s.webauthn = Some(WebAuthn::Edit(other_assertion())),
            Some(_) if g.below(4) == 0 => s.webauthn = None,
            Some(WebAuthn::Edit(a)) => {
                let part = match g.below(3) {
                    0 => &mut a.authenticator_data,
                    1 => &mut a.client_data_json,
                    _ => &mut a.signature,
                };
                *part = mutate(g, part);
            }
            Some(WebAuthn::Batch { assertion, edits }) => match g.below(4) {
                0 => assertion.signature = mutate(g, &assertion.signature),
                1 => assertion.client_data_json = mutate(g, &assertion.client_data_json),
                2 if !edits.is_empty() => {
                    let i = g.below(edits.len());
                    edits.remove(i);
                }
                _ => edits.push(EditId::from_u64(g.next())),
            },
            Some(WebAuthn::Pass { assertion, made }) => match g.below(3) {
                0 => assertion.signature = mutate(g, &assertion.signature),
                1 => assertion.client_data_json = mutate(g, &assertion.client_data_json),
                _ => *made ^= 1 << g.below(64),
            },
        },
        _ => {
            s.pq = match g.below(4) {
                0 => s.pq[..g.below(s.pq.len())].to_vec(),
                1 => g.bytes(),
                _ => mutate(g, &s.pq),
            }
        }
    }
    s
}

/// `edit` with one field changed: of the edit, or of its action, a write's, a share's (a keep share's too), a mark's,
/// a device's or a revocation's.
fn mutate_edit(g: &mut Gen, edit: &Edit) -> Edit {
    let mut o = edit.clone();
    let id = |g: &mut Gen| EditId::from_u64(g.next());
    let share = |g: &mut Gen| ShareId::from_u64(g.next());
    let vault = |g: &mut Gen| VaultId::from_u64(g.next());
    match g.below(5) {
        0 => o.depth ^= 1 << g.below(64),
        1 => o.parents.push(id(g)),
        2 => o.author = SignerId::from_u64(g.next()),
        3 => o.cosigners.push(SignerId::from_u64(g.next())),
        _ => match &mut o.action {
            Action::Share(Sharing::Device { vault: v, device, .. }) => match g.below(2) {
                0 => *v = vault(g),
                _ => *device = SignerId::from_u64(g.next()),
            },
            Action::Write { entry, actor, stay, epoch, deps, proposal, via, create, body, .. } => {
                match g.below(9) {
                    0 => *entry = EntryId::from_u64(g.next()),
                    1 => *actor = vault(g),
                    2 => *stay = if stay.is_some() && g.below(2) == 0 { None } else { Some(id(g)) },
                    3 => *epoch ^= 1 << g.below(64),
                    4 => deps.push(id(g)),
                    5 => {
                        let others = [Proposal::Main, Proposal::New, Proposal::On(id(g))];
                        *proposal = others.into_iter().filter(|p| p != proposal).nth(g.below(2)).expect("another");
                    }
                    6 => via.push(vault(g)),
                    7 => match create {
                        Some(audience) if g.below(2) == 0 => audience.push(share(g)),
                        Some(_) => *create = None,
                        None => *create = Some(vec![]),
                    },
                    _ => *body = mutate(g, body),
                }
            }
            Action::Share(Sharing::Grant(c, via)) => match g.below(9) {
                0 => c.select = mutate(g, &c.select),
                1 => c.over = vault(g),
                2 => {
                    let keeps = [KeepMode::Whole, KeepMode::Opened, KeepMode::Never].map(Level::Keep);
                    let levels = keeps.into_iter().chain([Level::Relay, Level::Backup, Level::Read, Level::Write]);
                    let levels = levels.chain([Level::Owner]).filter(|&r| r != c.level);
                    c.level = levels.collect::<Vec<_>>()[g.below(7)];
                }
                3 => c.wide = !c.wide,
                4 => {
                    c.who = match g.below(3) {
                        0 if c.who != Who::Everyone => Who::Everyone,
                        0 | 1 => Who::Vault(vault(g)),
                        _ => Who::Device(SignerId::from_u64(g.next())),
                    }
                }
                5 => c.parent = if c.parent.is_some() && g.below(2) == 0 { None } else { Some(share(g)) },
                6 => c.issuer = vault(g),
                7 => c.nonce ^= 1 << g.below(64),
                _ => via.push(vault(g)),
            },
            // either part there or not, longer or shorter
            Action::Mark { vault: v, entry, caps, wants, keep, via } => match g.below(6) {
                0 => *v = vault(g),
                1 => *entry = EntryId::from_u64(g.next()),
                2 | 3 => {
                    let part = if g.below(2) == 0 { caps } else { wants };
                    match part {
                        Some(xs) if g.below(3) > 0 => match xs.is_empty() || g.below(2) == 0 {
                            true => xs.push(share(g)),
                            false => drop(xs.pop()),
                        },
                        Some(_) => *part = None,
                        None => *part = Some(vec![]),
                    }
                }
                4 => keep.push(id(g)),
                _ => via.push(vault(g)),
            },
            Action::Revoke(Revoking::Grant { share: c, actor, keep, via }) => match g.below(4) {
                0 => *c = share(g),
                1 => *actor = vault(g),
                2 => keep.push(id(g)),
                _ => via.push(vault(g)),
            },
            other => unreachable!("{other:?}"),
        },
    }
    o
}

#[test]
fn a_changed_signed_edit_is_refused() {
    let edits = signed_edits();
    let batched = batched(&edits.add);
    let mut g = Gen::new(3);
    for signed in edits.all().into_iter().chain([&batched]) {
        assert!(signed.verify().is_ok());
        for _ in 0..300 {
            let mut bad = signed.clone();
            match g.below(4) {
                0 => bad.edit = mutate_edit(&mut g, &bad.edit),
                1 => bad.sigs.reverse(),
                2 => {
                    let i = g.below(bad.sigs.len());
                    bad.sigs[i] = mutate_signature(&mut g, &bad.sigs[i]);
                }
                _ => drop(bad.sigs.pop()),
            }
            if bad != *signed {
                assert!(bad.verify().is_err(), "{bad:?}");
            }
        }
    }
    // without its SLH-DSA signature, nothing is signed: no write, no governance, no share, no mark, no keep share
    for signed in edits.all() {
        let mut curves = signed.clone();
        curves.sigs.iter_mut().for_each(|s| s.pq = vec![]);
        assert!(curves.verify().is_err(), "{curves:?}");
    }
}

#[test]
fn a_changed_selector_opens_to_nothing_or_to_its_own_slice() {
    let (edits, k) = (signed_edits(), keys());
    let Action::Share(Sharing::Grant(share, _)) = &edits.share.edit.action else { unreachable!("a cap") };
    let Action::Share(Sharing::Grant(keep, _)) = &edits.keep.edit.action else { unreachable!("a keep share") };
    let mut g = Gen::new(6);
    for (signed, of, held) in [(&edits.share, share, work_todos()), (&edits.keep, keep, proxies())] {
        // Alice's vault and Bob's open the slice; another vault's seed, or the wrong one, opens nothing
        let readers = [(ALICE, &k.alice), (BOB, &k.bob)];
        for (v, seed) in readers {
            assert_eq!(open_select(of, v, seed).as_ref(), Some(&held));
        }
        assert_eq!(open_select(of, VaultId::from_u64(102), &k.door), None);
        assert_eq!(open_select(of, ALICE, &k.bob), None);
        // the selector's bytes changed: what still reads as a sealed selector opens to nothing, or to the slice it
        // held where the box opened and the sealed slice are as they were
        let (mut sealed, mut same) = (0, 0);
        for _ in 0..3000 {
            let select = mutate(&mut g, &of.select);
            if !matches!(Select::from_wire(&select), Ok(Select::Sealed { .. })) {
                continue;
            }
            sealed += 1;
            let bad = Share { select, ..of.clone() };
            for (v, seed) in readers {
                if let Some(slice) = open_select(&bad, v, seed) {
                    assert_eq!(slice, held, "{slice:?}");
                    same += 1;
                }
            }
        }
        assert!(sealed > 100 && same > 0, "{sealed} still sealed, {same} opened");
        // the same selector in a share that says anything else opens to nothing: it is bound to the vault the share is
        // over, its grantee, level (a keep share's mode too), width, parent, issuer and nonce
        let mut bound = 0;
        for _ in 0..1000 {
            let o = mutate_edit(&mut g, &signed.edit);
            let other = match &o.action {
                Action::Share(Sharing::Grant(other, _)) if other.select == of.select && other != of => other,
                _ => continue,
            };
            for (v, seed) in readers {
                assert_eq!(open_select(other, v, seed), None, "{o:?}");
            }
            bound += 1;
        }
        assert!(bound > 100, "{bound}");
    }
}

/// Mutate the bytes of `value` `n` times: each changed message reads as nothing, or as another value whose own
/// bytes these are, which `also` checks further. It never panics.
fn wire_mutations<T: Wire + PartialEq + Debug>(g: &mut Gen, value: &T, n: usize, also: impl Fn(&T)) -> usize {
    let bytes = value.to_wire();
    assert_eq!(T::from_wire(&bytes).as_ref(), Ok(value));
    let mut read = 0;
    for _ in 0..n {
        let bad = mutate(g, &bytes);
        if let Ok(v) = T::from_wire(&bad) {
            assert_eq!(v.to_wire(), bad, "a message reads back only from its own bytes: {v:?}");
            also(&v);
            read += 1;
        }
    }
    read
}

#[test]
fn a_changed_message_on_the_wire_reads_as_nothing_or_as_its_own_bytes() {
    let edits = signed_edits();
    let mut g = Gen::new(11);
    // a signed edit read from changed bytes is refused, whatever it changed into, its passkey's half by itself or in a
    // batch
    let batched = batched(&edits.add);
    assert!(batched.verify().is_ok());
    for signed in edits.all().into_iter().chain([&batched]) {
        let read = wire_mutations(&mut g, signed, 1500, |s: &Signed| assert!(s.verify().is_err(), "{s:?}"));
        assert!(read > 0, "some changes still read as a signed edit, to be refused");
        wire_mutations(&mut g, &signed.edit, 1000, |o: &Edit| assert_ne!(o, &signed.edit));
    }
    // what only readers read: a slice, a selector in the clear or sealed, and a write's body; a selector only within
    // the bounds a peer accepts
    let bounded = |s: &Slice| assert!(s.select.bounded(), "{s:?}");
    for slice in [work_todos(), tick_todos()] {
        wire_mutations(&mut g, &slice, 3000, bounded);
        wire_mutations(&mut g, &Select::Clear(slice), 3000, |s: &Select| {
            if let Select::Clear(s) = s {
                bounded(s);
            }
        });
    }
    let Action::Share(Sharing::Grant(share, _)) = &edits.share.edit.action else { unreachable!("a cap") };
    let sealed = Select::from_wire(&share.select).expect("a sealed selector");
    let Select::Sealed { boxes, slice, .. } = sealed.clone() else { unreachable!("sealed") };
    let commitment = tick_todos().grant.commitment();
    for select in [sealed, Select::Sealed { boxes, slice, commitment }] {
        wire_mutations(&mut g, &select, 3000, |_| {});
    }
    for body in [door_created(), door_retagged(), door_proven()] {
        let answers = |b: &Body| assert!(b.answers.windows(2).all(|w| w[0] < w[1]), "{b:?}");
        wire_mutations(&mut g, &body, 3000, answers);
    }
    // a hello read from changed bytes proves no device on the connection
    let device = DeviceKey::from_secret([7; 32]);
    let SignerKeys::Device { ed25519: endpoint, .. } = device.keys() else { unreachable!() };
    let exporter = [4; 32];
    let hello = device.hello(&exporter, true);
    assert_eq!(hello.verify(&exporter, true, &endpoint), Some(device.id()));
    wire_mutations(&mut g, &hello, 1000, |h: &Hello| assert_eq!(h.verify(&exporter, true, &endpoint), None));
    // a pass read from changed bytes is the passkey's for no device: a changed signature recovers to other keys,
    // nobody's
    let mut passkey = Passkey::from_seed([6; 32]);
    let pass = passkey.pass(passkey.device([1; 32]).keys(), 1_791_500_000);
    assert!(pass.passkeys(pass.made).contains(&passkey.id()));
    let (now, theirs) = (pass.made, passkey.id());
    wire_mutations(&mut g, &pass, 1500, |p: &RelayPass| assert!(!p.passkeys(now.max(p.made)).contains(&theirs)));
    // a join read from changed bytes carries a refused edit, or the same edit beside other bytes, which the device
    // checks against the ids its edit names
    let add = &edits.add;
    let join = Join { edit: add.clone(), blobs: vec![vec![1; 40], vec![2; 3]] };
    wire_mutations(&mut g, &join, 1500, |j: &Join| assert!(j.edit == *add || j.edit.verify().is_err(), "{j:?}"));
    // a claim read from changed bytes carries edits and signatures that don't verify
    let claim = Claim { card: vec![add.clone()], add: add.edit.clone(), sigs: add.sigs.clone() };
    wire_mutations(&mut g, &claim, 1500, |c: &Claim| {
        assert!(c.card.iter().all(|s| s == add || s.verify().is_err()), "{c:?}");
        let signed = Signed { edit: c.add.clone(), sigs: c.sigs.clone() };
        assert!(signed == *add || signed.verify().is_err(), "{c:?}");
    });
    // the key a server hands for a claim reads back only from its own bytes
    let key = avendb::keys::Secret::from_bytes([5; 32]).public();
    wire_mutations(&mut g, &key, 1000, |_| {});
    // what a sync carries: asks of each kind of log, requests, replies and announcements
    let audience = LogId::Audience(ALICE, AudienceId::of(ALICE, &[ShareId::from_u64(8), ShareId::from_u64(9)]));
    let mut ask = Ask::default();
    ask.haves.insert(LogId::Vault(ALICE), vec![EditId::from_u64(1), EditId::from_u64(2)]);
    ask.haves.insert(LogId::Share(ShareId::from_u64(12)), vec![]);
    ask.haves.insert(audience, vec![EditId::from_u64(4)]);
    ask.haves.insert(LogId::Entry(DOOR), vec![EditId::from_u64(5), EditId::from_u64(6)]);
    ask.loose = vec![EditId::from_u64(7), EditId::from_u64(9)];
    ask.follow = vec![ALICE.min(BOB), ALICE.max(BOB)];
    wire_mutations(&mut g, &ask, 3000, |_| {});
    let (wants, after) = (vec![BlobId::from_u64(3), BlobId::from_u64(4)], Some((9, EditId::from_u64(8))));
    let request = Request { ask, wants, after };
    wire_mutations(&mut g, &request, 3000, |_| {});
    let blobs = vec![(BlobId::from_u64(3), [1; 32]), (BlobId::from_u64(4), [2; 32])];
    let sent: Vec<Signed> = edits.all().into_iter().cloned().collect();
    let reply = Reply { edits: sent.clone(), blobs, more: true };
    wire_mutations(&mut g, &reply, 1500, |r: &Reply| {
        for edit in r.edits.iter().filter(|o| !sent.contains(o)) {
            assert!(edit.verify().is_err(), "{edit:?}");
        }
    });
    let logs = [LogId::Vault(ALICE), LogId::Share(ShareId::from_u64(12)), audience, LogId::Entry(DOOR)];
    let frontier = |n: u64| Frontier { heads: vec![EditId::from_u64(n)], waiting: vec![EditId::from_u64(n + 10)] };
    let logs = logs.into_iter().zip(1..).map(|(l, n)| (l, frontier(n))).collect();
    let (one, film) = (FileRoot { hash: [1; 32], size: 16 }, FileRoot { hash: [2; 32], size: 3 * PIECE });
    let dropped = FileRoot { hash: [3; 32], size: 16 };
    let files = vec![(one, Some(FileHold::Whole)), (film, Some(FileHold::Pieces(vec![0, 2]))), (dropped, None)];
    let announce = Announce { full: true, logs, files };
    wire_mutations(&mut g, &announce, 3000, |_| {});
}

/// `v` with one value somewhere inside replaced: by null, a boolean, a number, a string, an empty or deeply nested
/// list or record, or a copy of another value of `v`.
fn mutate_value(g: &mut Gen, v: &mut Value, all: &Value) {
    let inner = match v {
        Value::Array(xs) if !xs.is_empty() => Some(g.below(xs.len())).map(|i| &mut xs[i]),
        Value::Object(o) if !o.is_empty() => {
            let k = o.keys().nth(g.below(o.len())).cloned().expect("a key");
            o.get_mut(&k)
        }
        _ => None,
    };
    if let Some(inner) = inner
        && g.below(4) > 0
    {
        return mutate_value(g, inner, all);
    }
    *v = match g.below(9) {
        0 => Value::Null,
        1 => json!(g.below(2) == 0),
        2 => json!(g.next() as i64),
        3 => json!(-1.5e300),
        4 => json!(["text", "kind", "type", "level", "checked", "lang", "blocks", "title"][g.below(8)]),
        5 => json!([]),
        6 => Value::Object(Map::new()),
        7 => (0..100).fold(json!("deep"), |x, _| json!([x])),
        _ => {
            // a copy of some other part of the whole
            let mut x = all.clone();
            for _ in 0..g.below(6) {
                x = match x {
                    Value::Array(xs) if !xs.is_empty() => xs[g.below(xs.len())].clone(),
                    Value::Object(o) if !o.is_empty() => o.values().nth(g.below(o.len())).cloned().expect("a value"),
                    x => x,
                };
            }
            x
        }
    };
}

/// Mutated blobs, half of them changed byte by byte, half of them value by value.
fn mutated_blobs(g: &mut Gen, blob: &str, n: usize) -> Vec<Vec<u8>> {
    let v: Value = serde_json::from_str(blob).expect("a JSON blob");
    (0..n)
        .map(|i| {
            if i % 2 == 0 {
                mutate(g, blob.as_bytes())
            } else {
                let mut x = v.clone();
                mutate_value(g, &mut x, &v);
                serde_json::to_vec(&x).expect("JSON")
            }
        })
        .collect()
}

#[test]
fn a_changed_schema_or_lens_never_panics() {
    let mut g = Gen::new(4);
    let docs = [
        json!({"kind": "document", "title": "Welcome", "blocks": [
            {"id": 1, "kind": "h1", "text": "Welcome"},
            {"id": 2, "type": "heading", "level": 4, "text": "Deep"},
            {"id": 3, "type": "item", "checked": true, "text": "Water"}]}),
        json!({"kind": "todo", "title": "Fix the door", "done": true, "status": "doing", "due": "2026-10-10"}),
        json!({"kind": "document", "blocks": [{"id": "x"}, 7, null]}),
    ];
    let pairs = [(&*DOCUMENT_V1, blobs::DOCUMENT_LENS, &*DOCUMENT_V2), (&*TODO_V1, blobs::TODO_LENS, &*TODO_V2)];
    let (mut parsed, mut through) = (0, 0);
    for (from, lens, to) in pairs {
        // a changed schema: parsed or not, it reads and writes without a panic
        for bytes in mutated_blobs(&mut g, std::str::from_utf8(from.bytes()).expect("JSON"), 1500) {
            let Some(schema) = Schema::parse(&bytes) else { continue };
            parsed += 1;
            let view = View::plain(&schema);
            for d in &docs {
                if let Some(seen) = view.get(d) {
                    view.put(d, &seen);
                }
            }
        }
        // a changed lens, between the schemas it names: every app reading through it gets something or nothing
        for bytes in mutated_blobs(&mut g, lens, 5000) {
            let Some(lens) = Lens::parse(&bytes) else { continue };
            parsed += 1;
            for view in [View::through(from, &lens, to), View::through(to, &lens, from)].into_iter().flatten() {
                through += 1;
                for d in &docs {
                    let Some(mut seen) = view.get(d) else { continue };
                    view.put(d, &seen);
                    mutate_value(&mut g, &mut seen, d);
                    view.put(d, &seen);
                }
            }
            // and a lane holding it next to the schemas
            let lane = Lane::new([from.bytes(), to.bytes(), &bytes[..]]);
            assert!(lane.schema(from.id()).is_some() && lane.schema(to.id()).is_some());
        }
    }
    // the mutations reach past the parser, and into apps reading through a lens
    assert!(parsed > 1000 && through > 800, "{parsed} parsed, {through} read through");
}

#[test]
fn a_changed_loro_update_never_panics_and_changes_nothing() {
    let alice = SignerId::from_u64(2);
    let first = Item::document("Welcome", alice);
    let update = first.export(&Version::default());
    let mut next = first.clone();
    let text = "the greenhouse opens at eight".into();
    next.push_block(BlockV2 { id: 2, r#type: TypeV2::Paragraph, level: None, checked: None, lang: None, text });
    let more = next.export(&first.version());
    assert!(!more.is_empty() && next.record() != first.record());
    let mut g = Gen::new(5);
    let mut taken = 0;
    for _ in 0..1500 {
        // into an empty item, and into one holding the first update
        let bad = mutate(&mut g, &update);
        let mut empty = Item::new(SignerId::from_u64(7));
        if empty.import(&bad, alice).is_ok() {
            taken += 1;
        } else {
            assert_eq!(empty.record(), json!({}));
        }
        let bad = mutate(&mut g, &more);
        let mut held = Item::new(SignerId::from_u64(7));
        held.import(&update, alice).expect("the first update");
        let before = held.record();
        if held.import(&bad, alice).is_err() {
            assert_eq!(held.record(), before);
        }
    }
    // Loro checks its updates: almost no change gets through
    assert!(taken < 50, "{taken}");
}
