//! Mutation fuzzing (P4b): what a device takes from others (key boxes, encrypted edits, signed ops, schemas, lenses,
//! Loro updates), changed a bit or a byte at a time, cut short, grown or spliced, and from P8 every message on the wire
//! (signed ops, hellos, asks, requests, replies, announcements, and from P8c passkeys' hellos and joins). Nothing
//! panics; a changed box, edit or signed op is refused, a changed message reads as nothing or as another message whose
//! own bytes these are, and a changed Loro update that is refused leaves the item as it was. Every mutation is drawn
//! from a fixed seed, so a failure replays exactly.

use std::fmt::Debug;

use serde_json::{json, Map, Value};
use avendb::doc::{Item, Version};
use avendb::id::{BlobId, EntryId, OpId, SignerId, SpaceId, VaultId};
use avendb::keys::{self, SeededRng, Secret};
use avendb::lens::{blobs, BlockV2, Lane, Lens, Schema, TypeV2, View, DOCUMENT_V1, DOCUMENT_V2, TODO_V1, TODO_V2};
use avendb::policy::{Action, Branch, Op};
use avendb::sign::{Classical, DeviceKey, Hello, Passkey, PasskeyHello, Signature, SignerKeys, Signed};
use avendb::sync::{Ask, LogId};
use avendb::wire::{Announce, Join, Reply, Request, Wire};

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
    let info = b"the Handbook's key at epoch 0, for Samuel's vault key";
    let sealed = keys::seal(&key, &to.public(), &to.mceliece_public(), info, &mut rng).expect("a key to seal to");
    let wrapped = keys::wrap(&key, &to, info, &mut rng);
    let opened = |bytes: &[u8], with: &Secret, info: &[u8]| keys::open(bytes, with, info).map(|k| k.id());
    assert_eq!(opened(&sealed, &to, info), Some(key.id()));
    assert_eq!(opened(&wrapped, &to, info), Some(key.id()));
    // not for another key, nor bound to anything else
    assert_eq!(opened(&sealed, &other, info), None);
    assert_eq!(opened(&wrapped, &other, info), None);
    assert_eq!(opened(&sealed, &to, b"the Handbook's key at epoch 1"), None);
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

#[test]
fn a_changed_edit_decrypts_to_nothing() {
    let mut rng = SeededRng::new("fuzz", b"edits");
    let key = Secret::generate(&mut rng);
    let context = b"the write op, with an empty body";
    let body = keys::seal_edit(&key, b"Welcome to Maia Coop: the greenhouse opens at eight.", context, &mut rng);
    assert!(keys::open_edit(&key, &body, context).is_some());
    let mut g = Gen::new(2);
    for _ in 0..5000 {
        let bad = mutate(&mut g, &body);
        assert_eq!(keys::open_edit(&key, &bad, context), None, "{bad:?}");
        let bad = mutate(&mut g, context);
        assert_eq!(keys::open_edit(&key, &body, &bad), None, "{bad:?}");
    }
}

/// `sig` with one part changed: a key, the classical half, or the hash-based half (changed or left out).
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
        1 => match &mut s.classical {
            Classical::Ed25519(bytes) => {
                let i = g.below(64);
                bytes[i] ^= 1 << g.below(8);
            }
            Classical::Passkey(a) => {
                let part = match g.below(3) {
                    0 => &mut a.authenticator_data,
                    1 => &mut a.client_data_json,
                    _ => &mut a.signature,
                };
                *part = mutate(g, part);
            }
        },
        _ => {
            s.pq = match &s.pq {
                Some(bytes) if g.below(4) > 0 => Some(mutate(g, bytes)),
                _ => None,
            }
        }
    }
    s
}

/// `op` with one field changed.
fn mutate_op(g: &mut Gen, op: &Op) -> Op {
    let mut o = op.clone();
    match g.below(5) {
        0 => o.depth ^= 1 << g.below(64),
        1 => o.parents.push(OpId::from_u64(g.next())),
        2 => o.author = SignerId::from_u64(g.next()),
        3 => o.cosigners.push(SignerId::from_u64(g.next())),
        _ => match &mut o.action {
            Action::AddDevice { device, .. } => *device = SignerId::from_u64(g.next()),
            Action::Write { body, branch, .. } => match g.below(3) {
                0 => *branch = [Branch::Main, Branch::New, Branch::On(OpId::from_u64(g.next()))][g.below(3)],
                _ => *body = mutate(g, body),
            },
            other => unreachable!("{other:?}"),
        },
    }
    o
}

/// Two signed ops: governance, which both halves sign, by a passkey with the new device consenting; and a write on a
/// branch, which only the classical half signs.
fn signed_ops() -> (Signed, Signed) {
    let device = DeviceKey::from_secret([7; 32]);
    let mut passkey = Passkey::from_seed([9; 32]);
    let samuel = VaultId::from_u64(100);
    // governance, which both halves sign, by the passkey with the new device consenting
    let add = Op {
        parents: vec![OpId::from_u64(1)],
        depth: 1,
        author: passkey.id(),
        cosigners: vec![device.id()],
        action: Action::AddDevice { vault: samuel, device: device.id(), seal_to: None },
    };
    let sigs = vec![passkey.sign(add.id(), true), device.sign(add.id(), true)];
    let add = Signed { op: add, sigs };
    // and a write on a branch, which only the classical half signs
    let action = Action::Write {
        space: SpaceId::from_u64(10),
        entry: EntryId::from_u64(1),
        actor: samuel,
        epoch: 0,
        deps: vec![OpId::from_u64(5)],
        branch: Branch::On(OpId::from_u64(5)),
        body: vec![1, 2, 3],
    };
    let write = Op { parents: vec![OpId::from_u64(2)], depth: 2, author: device.id(), cosigners: vec![], action };
    let write = Signed { sigs: vec![device.sign(write.id(), false)], op: write };
    (add, write)
}

#[test]
fn a_changed_signed_op_is_refused() {
    let (add, write) = signed_ops();
    let mut g = Gen::new(3);
    for signed in [&add, &write] {
        assert!(signed.verify().is_ok());
        for _ in 0..300 {
            let mut bad = signed.clone();
            match g.below(4) {
                0 => bad.op = mutate_op(&mut g, &bad.op),
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
    // the classical half alone signs no governance
    let mut classical = add.clone();
    classical.sigs.iter_mut().for_each(|s| s.pq = None);
    assert!(classical.verify().is_err());
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
    let (add, write) = signed_ops();
    let mut g = Gen::new(11);
    // a signed op read from changed bytes is refused, whatever it changed into
    for signed in [&add, &write] {
        let read = wire_mutations(&mut g, signed, 1500, |s: &Signed| assert!(s.verify().is_err(), "{s:?}"));
        assert!(read > 0, "some changes still read as a signed op, to be refused");
        wire_mutations(&mut g, &signed.op, 1000, |o: &Op| assert_ne!(o, &signed.op));
    }
    // a hello read from changed bytes proves no device on the connection
    let device = DeviceKey::from_secret([7; 32]);
    let SignerKeys::Device { ed25519: endpoint, .. } = device.keys() else { unreachable!() };
    let exporter = [4; 32];
    let hello = device.hello(&exporter, true);
    assert_eq!(hello.verify(&exporter, true, &endpoint), Some(device.id()));
    wire_mutations(&mut g, &hello, 1000, |h: &Hello| assert_eq!(h.verify(&exporter, true, &endpoint), None));
    // a passkey's hello read from changed bytes proves no passkey for that device on the connection
    let mut passkey = Passkey::from_seed([6; 32]);
    let new = passkey.device([1; 32]).id();
    let hello = passkey.hello(&exporter, true, new);
    assert_eq!(hello.verify(&exporter, true, new), Some(passkey.id()));
    wire_mutations(&mut g, &hello, 1500, |h: &PasskeyHello| assert_eq!(h.verify(&exporter, true, new), None));
    // a join read from changed bytes carries a refused op, or the same op beside other bytes, which the device checks
    // against the ids its op names
    let join = Join { op: add.clone(), blobs: vec![vec![1; 40], vec![2; 3]] };
    wire_mutations(&mut g, &join, 1500, |j: &Join| assert!(j.op == add || j.op.verify().is_err(), "{j:?}"));
    // what a sync carries: asks, requests, replies and announcements
    let log = |n: u64| LogId::Entry(SpaceId::from_u64(10), EntryId::from_u64(n));
    let mut ask = Ask::default();
    ask.haves.insert(LogId::Vault(VaultId::from_u64(100)), vec![OpId::from_u64(1), OpId::from_u64(2)]);
    ask.haves.insert(LogId::Space(SpaceId::from_u64(10)), vec![]);
    ask.haves.insert(log(1), vec![OpId::from_u64(5)]);
    ask.loose = vec![OpId::from_u64(7), OpId::from_u64(9)];
    wire_mutations(&mut g, &ask, 3000, |_| {});
    let request = Request { ask, wants: vec![BlobId::from_u64(3), BlobId::from_u64(4)] };
    wire_mutations(&mut g, &request, 3000, |_| {});
    let blobs = vec![(BlobId::from_u64(3), [1; 32]), (BlobId::from_u64(4), [2; 32])];
    let reply = Reply { ops: vec![add.clone(), write.clone()], blobs };
    let sent = [add.clone(), write.clone()];
    wire_mutations(&mut g, &reply, 1500, |r: &Reply| {
        for op in r.ops.iter().filter(|o| !sent.contains(o)) {
            assert!(op.verify().is_err(), "{op:?}");
        }
    });
    let announce = Announce { digests: vec![(LogId::Vault(VaultId::from_u64(100)), [3; 32]), (log(1), [4; 32])] };
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
    let samuel = SignerId::from_u64(2);
    let first = Item::document("Welcome", samuel);
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
        if empty.import(&bad, samuel).is_ok() {
            taken += 1;
        } else {
            assert_eq!(empty.record(), json!({}));
        }
        let bad = mutate(&mut g, &more);
        let mut held = Item::new(SignerId::from_u64(7));
        held.import(&update, samuel).expect("the first update");
        let before = held.record();
        if held.import(&bad, samuel).is_err() {
            assert_eq!(held.record(), before);
        }
    }
    // Loro checks its updates: almost no change gets through
    assert!(taken < 50, "{taken}");
}
