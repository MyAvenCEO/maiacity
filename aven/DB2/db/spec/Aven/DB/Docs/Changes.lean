import Aven.DB.Docs.Fit

/-!
# What an envelope does to a Doc's Records

The one view of an envelope that every reader verdict about its content reads (architecture, rule 4; the engine and
the docs layer, 30 Oct 2026): one `RecordChange` per Record it touches, with the Record's id, its version (its type Doc, and its schema's hash
unless the type is built in, `Version`), whether it
is new, edited or gone, and the new value of each field it writes. The engine's footprint check reads the ids, the
type and the field names; fit reads the values against the schema the type id names.

A Record id is the id as it sits under the Doc, as bytes (docs, "Records"): ids two writers may create at once meet
on one key, so an id is not always (writer, counter, index); the engine's `NewId` is one way to mint one.

`changesOf` decodes an envelope's body against the version it names (its `prev` and `deps`); the docs layer doesn't
model Loro's decoding, so it is a parameter (`Reading`). The one obligation linking it to the engine's diff of Records
before and after is `ChangesAreDiff`: what an envelope that decodes says it does is, as a set, what a reader sees
change. `Aven.Architecture` carries it as an assumption until a model of Loro's Records can prove it.

What it proves: `fit_records` (a field's merged value fits the schema of the type of the change that wrote it),
`fit_diff` (under `ChangesAreDiff`, fit judged on what the envelope says equals fit judged on the diff).
-/

namespace Aven.DB.Docs

open Aven.Core

/-- The version a Record was written under: its type Doc, and its schema's hash unless the type is built in. -/
structure Version where
  type : DocId
  schema : Option Hash
  deriving DecidableEq, Repr

def Version.value (v : Version) : Value := .array (.bytes v.type.hash.bytes :: (v.schema.map Hash.value).toList)

def Version.ofValue? : Value → Option Version
  | .array [.bytes t] => if t.length == 32 then some ⟨⟨⟨t⟩⟩, none⟩ else none
  | .array [.bytes t, .bytes s] => if t.length == 32 && s.length == 32 then some ⟨⟨⟨t⟩⟩, some ⟨s⟩⟩ else none
  | _ => none

/-- What a change does to its Record. -/
inductive ChangeKind
  | new
  | edited
  | gone
  deriving DecidableEq, Repr

/-- One Record an envelope touches: its id, its type id, the kind, and the fields it writes with their new values:
every field the Record carries when `new`, the fields whose value differs when `edited`, none when `gone`. A field the
envelope removes (a Loro map delete) is written too, with no value: `(f, none)`, and a footprint must cover it like any
other write (the architect, 31 Oct 2026). -/
structure RecordChange where
  id : Bytes
  type : Version
  kind : ChangeKind
  fields : List (Bytes × Option Value)
  deriving DecidableEq

/-- The fields a change writes, without their values: what a footprint reads. -/
def RecordChange.names (c : RecordChange) : List Bytes := c.fields.map Prod.fst

/-- How a reader decodes an envelope against a base version, `none` when it doesn't decode. It lists only the Records
the envelope touches: a Record it leaves alone has no change, not an `edited` one with no fields, as the engine's
`changesFrom` leaves it out. -/
structure Reading (Base : Type) where
  changesOf : Base → Envelope → Option (List RecordChange)

/-- A change fits when each value it writes keeps its type's schema rule for that field. Whether a removal fits (a
required field stays unless its Record goes) is the docs layer's fit. -/
def RecordChange.fits (rule : Version → Bytes → Value → Prop) (c : RecordChange) : Prop :=
  ∀ f ∈ c.fields, ∀ v, f.2 = some v → rule c.type f.1 v

/-- An envelope's changes fit when each one does. -/
def FitsAll (rule : Version → Bytes → Value → Prop) (cs : List RecordChange) : Prop :=
  ∀ c ∈ cs, c.fits rule

/-- Every write of one field of one Record, across envelopes' changes stamped by their envelopes, each with the type
of the change that wrote it; a removal writes no value. -/
def recordWrites (id f : Bytes) (es : List (Nat × List RecordChange)) : List (Write (Version × Option Value)) :=
  es.flatMap fun e => (e.2.filter (·.id = id)).flatMap fun c =>
    (c.fields.filter (·.1 = f)).map fun v => ⟨e.1, (c.type, v.2)⟩

/-- A field's merged value, over envelopes whose changes all fit, fits the schema of the type that wrote it; a field
whose last write removed it has none. -/
theorem fit_records (rule : Version → Bytes → Value → Prop) {es : List (Nat × List RecordChange)}
    (h : ∀ e ∈ es, FitsAll rule e.2) (id f : Bytes) {w : Write (Version × Option Value)}
    (hw : latest (recordWrites id f es) = some w) : ∀ x, w.value.2 = some x → rule w.value.1 f x := by
  have hm := latest_mem hw
  simp only [recordWrites, List.mem_flatMap, List.mem_map, List.mem_filter, decide_eq_true_eq] at hm
  obtain ⟨e, he, c, ⟨hc, _⟩, v, ⟨hv, hf⟩, rfl⟩ := hm
  intro x hx
  exact hf ▸ h e he c hc v hv x hx

/-- The obligation linking a reading to the engine's diff: for an envelope that decodes against a base, its changes
are, as a set, the diff from the base to the version it makes. -/
def ChangesAreDiff {Base : Type} (R : Reading Base) (diff : Base → Base → List RecordChange)
    (after : Base → Envelope → Base) : Prop :=
  ∀ base e cs, R.changesOf base e = some cs → ∀ c, c ∈ cs ↔ c ∈ diff base (after base e)

/-- Under the obligation, fit judged on what an envelope says it does is fit judged on the diff a reader sees. -/
theorem fit_diff {Base : Type} {R : Reading Base} {diff : Base → Base → List RecordChange}
    {after : Base → Envelope → Base} (link : ChangesAreDiff R diff after) (rule : Version → Bytes → Value → Prop)
    {base : Base} {e : Envelope} {cs : List RecordChange} (h : R.changesOf base e = some cs) :
    FitsAll rule cs ↔ FitsAll rule (diff base (after base e)) :=
  ⟨fun hf c hc => hf c ((link base e cs h c).mpr hc), fun hf c hc => hf c ((link base e cs h c).mp hc)⟩

end Aven.DB.Docs
