import Aven.Core

/-!
# A version's schema, read back

Step 1's schema language, the one `Doc::open` pins by hash (`db/docs/src/schema.rs`): a title, each field with its kind
and whether it is required at a Record's birth, and whether other fields are allowed (`closed`). What it may say is
only what survives a merge (`Aven.DB.Docs.Fit`): a field's kind, an upper bound on a number replaced whole, required
fields, closed or not.

A schema's Value is its one form; its hash is the BLAKE3 of that Value's encoding, the schema half of a type id.
A reader of a pinned schema takes only that form (`Schema.ofValue?`), so what it reads is the schema that was hashed
(`ofValue_value`), and two forms never name one schema:

- **The Value:** `{title: text, closed: bool, fields: [[name: text, kind, required: bool], …]}`, its keys in the codec's
  order, with no field named twice.
- **A kind:** `"any"`, `"bool"`, `"text"`, `"bytes"`, `"hash"`, `["uint", max]` or `["array", kind]`.
-/

namespace Aven.DB.Docs

open Aven.Core

/-! The words of the form, as bytes, so that which one a text is gets decided. -/
def wAny : Bytes := [0x61, 0x6e, 0x79]
def wBool : Bytes := [0x62, 0x6f, 0x6f, 0x6c]
def wText : Bytes := [0x74, 0x65, 0x78, 0x74]
def wBytes : Bytes := [0x62, 0x79, 0x74, 0x65, 0x73]
def wHash : Bytes := [0x68, 0x61, 0x73, 0x68]
def wUint : Bytes := [0x75, 0x69, 0x6e, 0x74]
def wArray : Bytes := [0x61, 0x72, 0x72, 0x61, 0x79]
def wTitle : Bytes := [0x74, 0x69, 0x74, 0x6c, 0x65]
def wClosed : Bytes := [0x63, 0x6c, 0x6f, 0x73, 0x65, 0x64]
def wFields : Bytes := [0x66, 0x69, 0x65, 0x6c, 0x64, 0x73]

#guard wAny = "any".toUTF8.toList
#guard wBool = "bool".toUTF8.toList
#guard wText = "text".toUTF8.toList
#guard wBytes = "bytes".toUTF8.toList
#guard wHash = "hash".toUTF8.toList
#guard wUint = "uint".toUTF8.toList
#guard wArray = "array".toUTF8.toList
#guard wTitle = "title".toUTF8.toList
#guard wClosed = "closed".toUTF8.toList
#guard wFields = "fields".toUTF8.toList

attribute [local simp] wAny wBool wText wBytes wHash wUint wArray wTitle wClosed wFields

/-- What one field may hold, judged on a value replaced whole. -/
inductive FieldKind where
  | any
  | bool
  | text
  | bytes
  /-- A hash: 32 bytes. -/
  | hash
  /-- An unsigned integer, at most this. -/
  | uint (max : Nat)
  /-- Each element of a list. -/
  | array (of : FieldKind)
  deriving DecidableEq, Repr

def FieldKind.value : FieldKind → Value
  | .any => .text (wAny)
  | .bool => .text (wBool)
  | .text => .text (wText)
  | .bytes => .text (wBytes)
  | .hash => .text (wHash)
  | .uint max => .array [.text (wUint), .uint max]
  | .array of => .array [.text (wArray), of.value]

/-- A kind back from its one form, `none` for anything else. -/
def FieldKind.ofValue? : Value → Option FieldKind
  | .text b =>
    if b = wAny then some .any
    else if b = wBool then some .bool
    else if b = wText then some .text
    else if b = wBytes then some .bytes
    else if b = wHash then some .hash
    else none
  | .array [.text b, v] =>
    if b = wUint then (match v with | .uint n => some (.uint n) | _ => none)
    else if b = wArray then (FieldKind.ofValue? v).map .array
    else none
  | _ => none

theorem FieldKind.ofValue_value (f : FieldKind) : FieldKind.ofValue? f.value = some f := by
  induction f with
  | array of ih => simp [FieldKind.value, FieldKind.ofValue?, ih]
  | _ => simp [FieldKind.value, FieldKind.ofValue?]

/-- One version of a Record's shape. -/
structure Schema where
  title : Bytes
  /-- Each field, its kind, and whether it is required at birth. -/
  fields : List (Bytes × FieldKind × Bool)
  /-- `additionalProperties: false`. -/
  closed : Bool
  deriving DecidableEq, Repr

def Schema.fieldValue (f : Bytes × FieldKind × Bool) : Value := .array [.text f.1, f.2.1.value, .bool f.2.2]

/-- The schema's one form. -/
def Schema.value (s : Schema) : Value :=
  .map [(wTitle, .text s.title), (wClosed, .bool s.closed), (wFields, .array (s.fields.map Schema.fieldValue))]

/-- Its hash, the schema half of a type id. -/
def Schema.hash (H : Bytes → Hash) (s : Schema) : Hash := H (encode s.value)

def Schema.field? : Value → Option (Bytes × FieldKind × Bool)
  | .array [.text f, v, .bool r] => (FieldKind.ofValue? v).map fun kd => (f, kd, r)
  | _ => none

/-- A schema back from its one form: exactly the three keys in the codec's order, every field in its form, no field
named twice; `none` for anything else. -/
def Schema.ofValue? : Value → Option Schema
  | .map [(a, .text title), (b, .bool closed), (c, .array fs)] =>
    if a = wTitle ∧ b = wClosed ∧ c = wFields then
      (fs.mapM Schema.field?).bind fun fields =>
        if (fields.map (·.1)).Nodup then some { title, fields, closed } else none
    else none
  | _ => none

theorem Schema.fields_back (fs : List (Bytes × FieldKind × Bool)) :
    (fs.map Schema.fieldValue).mapM Schema.field? = some fs := by
  induction fs with
  | nil => rfl
  | cons f fs ih =>
    obtain ⟨n, kd, r⟩ := f
    simp [Schema.fieldValue, Schema.field?, FieldKind.ofValue_value, ih]

/-- A reader reads back exactly the schema that was hashed, whenever no field is named twice. -/
theorem Schema.ofValue_value (s : Schema) (h : (s.fields.map (·.1)).Nodup) : Schema.ofValue? s.value = some s := by
  simp only [Schema.value, Schema.ofValue?]
  rw [Schema.fields_back]
  simp [h]

theorem FieldKind.value_ofValue {v : Value} {f : FieldKind} (h : FieldKind.ofValue? v = some f) : f.value = v := by
  fun_induction FieldKind.ofValue? v generalizing f <;> simp_all
  all_goals first
    | (subst_vars; rfl)
    | (split at h <;> simp_all [FieldKind.value])
    | (obtain ⟨g, hg, rfl⟩ := h; simp_all [FieldKind.value])

theorem Schema.field_back {v : Value} {f : Bytes × FieldKind × Bool} (h : Schema.field? v = some f) :
    Schema.fieldValue f = v := by
  unfold Schema.field? at h
  split at h
  · obtain ⟨kd, hk, rfl⟩ := Option.map_eq_some_iff.mp h
    simp [Schema.fieldValue, FieldKind.value_ofValue hk]
  · cases h

theorem Schema.fields_of {vs : List Value} {fs : List (Bytes × FieldKind × Bool)}
    (h : vs.mapM Schema.field? = some fs) : fs.map Schema.fieldValue = vs := by
  induction vs generalizing fs with
  | nil => simp at h; simp [h]
  | cons v vs ih =>
    cases hv : Schema.field? v with
    | none => simp [List.mapM_cons, hv] at h
    | some f =>
      cases hr : vs.mapM Schema.field? with
      | none => simp [List.mapM_cons, hv, hr] at h
      | some rest =>
        simp [List.mapM_cons, hv, hr] at h
        subst h
        simp [Schema.field_back hv, ih hr]

/-- One form per schema: a Value read as a schema is that schema's own Value, so no other Value names it. -/
theorem Schema.value_ofValue {v : Value} {s : Schema} (h : Schema.ofValue? v = some s) : s.value = v := by
  unfold Schema.ofValue? at h
  split at h
  · rename_i a title b closed c fs
    split at h
    · rename_i hk
      obtain ⟨rfl, rfl, rfl⟩ := hk
      obtain ⟨fields, hf, h⟩ := Option.bind_eq_some_iff.mp h
      split at h
      · cases h
        simp [Schema.value, Schema.fields_of hf]
      · cases h
    · cases h
  · cases h

end Aven.DB.Docs
