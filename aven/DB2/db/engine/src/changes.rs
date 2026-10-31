//! The change view, and the footprint part of every reader's verdict (`Engine.Changes`; ARCHITECTURE.md, rule 4).
//!
//! Every reader's verdict on an envelope is one conjunction: its signature, its chain of caps, its footprint and its
//! fit. The footprint and fit parts read one view of the envelope, [`RecordChange`]s: one per Record it touches, with
//! the Record's id as bytes, its type id, whether it is new, edited or gone, and the new value of each field it
//! writes. [`changes_from`] is that view as a reader computes it from a Doc's Records before and after;
//! [`verdict_footprint`] is the footprint part over it.
//!
//! A merge into main is judged on the whole merge, `changes_from(ver, main, merged)`, not on the commit that settles
//! its conflicts (`merge_steps`).
//!
//! The types are `Aven.DB.Docs.Changes`' in the Lean. They live here, in the pure engine, and the docs layer, which
//! applies the engine's output, uses them from here.

use alloc::string::String;
use alloc::vec::Vec;

use aven_core::{DocId, Step, StepVerb, TypeId, Value};

use crate::footprint::{has_verb, opt_eq, writes};
use crate::mutate::Record;
use crate::query::get;

/// What a change does to its Record (`ChangeKind`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChangeKind {
    New,
    Edited,
    Gone,
}

impl ChangeKind {
    pub fn name(self) -> &'static str {
        match self {
            ChangeKind::New => "new",
            ChangeKind::Edited => "edited",
            ChangeKind::Gone => "gone",
        }
    }
}

/// One Record an envelope touches: its id, its type id, the kind, and the fields it writes with their new values:
/// every field the Record carries when new, the fields whose value differs when edited, none when gone. A field the
/// envelope removes is written too, with no value, `(f, None)` (`RecordChange`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordChange {
    pub id: Vec<u8>,
    pub r#type: TypeId,
    pub kind: ChangeKind,
    pub fields: Vec<(String, Option<Value>)>,
}

impl RecordChange {
    /// The fields a change writes, without their values: what a footprint reads (`RecordChange.names`).
    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.fields.iter().map(|(f, _)| f.as_str())
    }
}

/// The fields an edit writes: those whose value differs, with their new values, then those it removes, with none
/// (`editedFields`).
fn edited_fields(r0: &Record, r: &Record) -> Vec<(String, Option<Value>)> {
    let changed = r
        .fields
        .iter()
        .filter(|(f, _)| !opt_eq(get(&r0.fields, f), get(&r.fields, f)))
        .map(|(f, v)| (f.clone(), Some(v.clone())));
    let removed = r0
        .fields
        .iter()
        .filter(|(f, _)| get(&r.fields, f).is_none())
        .map(|(f, _)| (f.clone(), None));
    changed.chain(removed).collect()
}

/// One Record as an edit, given its type id (`edited`).
fn edited(ver: &impl Fn(&DocId) -> TypeId, r0: &Record, r: &Record) -> RecordChange {
    RecordChange {
        id: r.id.bytes(),
        r#type: ver(&r.r#type),
        kind: ChangeKind::Edited,
        fields: edited_fields(r0, r),
    }
}

/// What a reader sees of one Record after: new, edited, or nothing when it is as it was (`changeOf`).
pub fn change_of(
    ver: &impl Fn(&DocId) -> TypeId,
    s: &[Record],
    r: &Record,
) -> Option<RecordChange> {
    match s.iter().find(|r0| r0.id == r.id) {
        None => Some(RecordChange {
            id: r.id.bytes(),
            r#type: ver(&r.r#type),
            kind: ChangeKind::New,
            fields: r
                .fields
                .iter()
                .map(|(f, v)| (f.clone(), Some(v.clone())))
                .collect(),
        }),
        Some(r0) => {
            let e = edited(ver, r0, r);
            (!(e.fields.is_empty() && r0.r#type == r.r#type)).then_some(e)
        }
    }
}

/// The changes a reader sees from a Doc's Records before to after; `ver` gives the type id each type Doc is written
/// under (`changesFrom`).
pub fn changes_from(
    ver: &impl Fn(&DocId) -> TypeId,
    s: &[Record],
    s2: &[Record],
) -> Vec<RecordChange> {
    s2.iter()
        .filter_map(|r| change_of(ver, s, r))
        .chain(
            s.iter()
                .filter(|r0| !s2.iter().any(|r| r.id == r0.id))
                .map(|r0| RecordChange {
                    id: r0.id.bytes(),
                    r#type: ver(&r0.r#type),
                    kind: ChangeKind::Gone,
                    fields: Vec::new(),
                }),
        )
        .collect()
}

/// The footprint part of the verdict: every change is one the footprint makes (`footprintOk`).
pub fn footprint_ok(fp: &[Step], cs: &[RecordChange]) -> bool {
    cs.iter().all(|c| {
        let ty = &c.r#type.r#type;
        match c.kind {
            ChangeKind::New => {
                has_verb(fp, ty, StepVerb::PutNew) && c.names().all(|f| writes(fp, ty, f))
            }
            ChangeKind::Edited => c.names().all(|f| writes(fp, ty, f)),
            ChangeKind::Gone => has_verb(fp, ty, StepVerb::Remove),
        }
    })
}

/// The verdict's footprint part for a commit: the changes stay within the footprint of the ops it calls
/// (`verdictFootprint`).
pub fn verdict_footprint(fp: &[Step], cs: &[RecordChange]) -> bool {
    footprint_ok(fp, cs)
}

/// A Record's id as a key: the lowercase hex of its bytes, the key the docs layer writes it under in a Doc's `records`
/// map (`idKey`). One encoding: it reads back ([`id_of_key`]), so two ids have two keys.
pub fn id_key(id: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(2 * id.len());
    for b in id {
        s.push(DIGITS[(b >> 4) as usize] as char);
        s.push(DIGITS[(b & 15) as usize] as char);
    }
    s
}

/// A key read back as an id's bytes; `None` for anything but lowercase hex of whole bytes (`idOfKey?`).
pub fn id_of_key(key: &str) -> Option<Vec<u8>> {
    let digit = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    };
    let bytes = key.as_bytes();
    if !bytes.len().is_multiple_of(2) {
        return None;
    }
    bytes
        .chunks(2)
        .map(|p| Some((digit(p[0])? << 4) | digit(p[1])?))
        .collect()
}
