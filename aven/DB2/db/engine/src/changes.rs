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
/// every field the Record carries when new, the fields whose value differs when edited, none when gone
/// (`RecordChange`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordChange {
    pub id: Vec<u8>,
    pub r#type: TypeId,
    pub kind: ChangeKind,
    pub fields: Vec<(alloc::string::String, Value)>,
}

impl RecordChange {
    /// The fields a change writes, without their values: what a footprint reads (`RecordChange.names`).
    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.fields.iter().map(|(f, _)| f.as_str())
    }
}

/// One Record as an edit, given its type id (`edited`).
fn edited(ver: &impl Fn(&DocId) -> TypeId, r0: &Record, r: &Record) -> RecordChange {
    RecordChange {
        id: r.id.bytes(),
        r#type: ver(&r.r#type),
        kind: ChangeKind::Edited,
        fields: r
            .fields
            .iter()
            .filter(|(f, _)| !opt_eq(get(&r0.fields, f), get(&r.fields, f)))
            .cloned()
            .collect(),
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
            fields: r.fields.clone(),
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
