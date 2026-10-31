import Aven.Core.CborLaws
import Aven.Core.Blake3

/-!
# Hashes, Doc ids and type ids

- A **hash** is BLAKE3's 32 bytes. The model takes the hash function as a parameter, `H : Bytes → Hash`, and a theorem
  that needs it to be collision-free says so with `Injective H`: the assumption every Aven model makes.
- A **Value** is named by the hash of its encoding; a **Doc** by the hash of its signed genesis (docs, "A Doc").
- A **type id** names a version of a type: `<type Doc>/<schema hash>`, the version Record's address in its type Doc
  (Samuel, 30 Oct 2026). It is the one way a version is named anywhere.

In CBOR a hash is a byte string of its 32 bytes; `b3:<hex>` and `d:<hex>` are only the readable form.
-/

namespace Aven.Core

structure Hash where
  bytes : Bytes
  deriving DecidableEq, Repr, Inhabited

/-- A hash function no two inputs collide under. -/
def Injective (H : Bytes → Hash) : Prop := ∀ a b, H a = H b → a = b

/-- A hash has BLAKE3's 32 bytes. -/
def Hash.ok (h : Hash) : Bool := h.bytes.length == 32

def Hash.value (h : Hash) : Value := .bytes h.bytes

/-- A hash read back from its CBOR: a byte string of exactly 32 bytes; anything else is no hash. The one reader of a
hash in CBOR (A45): every id, prev, dep and op is read through it. -/
def Hash.ofValue? : Value → Option Hash
  | .bytes b => if b.length = 32 then some ⟨b⟩ else none
  | _ => none

/-- What `Hash.ofValue?` reads is what `Hash.value` writes. -/
theorem Hash.ofValue?_value {v : Value} {h : Hash} (e : Hash.ofValue? v = some h) : h.value = v := by
  unfold Hash.ofValue? at e
  split at e
  · split at e
    · cases e; rfl
    · cases e
  · cases e

/-- A hash of 32 bytes reads back as itself. -/
theorem Hash.ofValue_value (h : Hash) (ok : h.ok = true) : Hash.ofValue? h.value = some h := by
  obtain ⟨b⟩ := h
  simp only [Hash.ok, beq_iff_eq] at ok
  simp [Hash.ofValue?, Hash.value, ok]

def Hash.text (h : Hash) : String := "b3:" ++ hex h.bytes

/-- BLAKE3 itself, the hash every example and vector uses. -/
def blake3 (bytes : Bytes) : Hash := ⟨Blake3.digest bytes⟩

/-- A Value's name: the hash of its one encoding. -/
def nameOf (H : Bytes → Hash) (v : Value) : Hash := H (encode v)

/-- Two allowed Values with one name are one Value. -/
theorem nameOf_inj {H : Bytes → Hash} (hH : Injective H) {a b : Value} (ha : Canon a = true) (hb : Canon b = true)
    (h : nameOf H a = nameOf H b) : a = b :=
  encode_inj ha hb (hH _ _ h)

/-- A Doc, named by the hash of its signed genesis. -/
structure DocId where
  hash : Hash
  deriving DecidableEq, Repr, Inhabited

def DocId.text (d : DocId) : String := "d:" ++ hex d.hash.bytes

/-- A version of a type: its type Doc and its schema's hash. -/
structure TypeId where
  type : DocId
  schema : Hash
  deriving DecidableEq, Repr, Inhabited

def TypeId.text (t : TypeId) : String := t.type.text ++ "/" ++ t.schema.text

/-- In CBOR, a type id is the pair of its two hashes. -/
def TypeId.value (t : TypeId) : Value := .array [.bytes t.type.hash.bytes, .bytes t.schema.bytes]

def TypeId.ofValue? : Value → Option TypeId
  | .array [d, s] => do
    let d ← Hash.ofValue? d
    let s ← Hash.ofValue? s
    some ⟨⟨d⟩, s⟩
  | _ => none

/-- A type id whose two hashes are 32 bytes reads back as itself; any other length is refused. -/
theorem TypeId.ofValue_value (t : TypeId) (hd : t.type.hash.ok = true) (hs : t.schema.ok = true) :
    TypeId.ofValue? t.value = some t := by
  obtain ⟨⟨d⟩, s⟩ := t
  have hd' := Hash.ofValue_value d hd
  have hs' := Hash.ofValue_value s hs
  simp only [Hash.value] at hd' hs'
  simp [TypeId.ofValue?, TypeId.value, hd', hs']

#guard TypeId.ofValue? (.array [.bytes (List.replicate 31 1), .bytes (List.replicate 32 1)]) == none

end Aven.Core
