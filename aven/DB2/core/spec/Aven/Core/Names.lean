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
  | .array [.bytes d, .bytes s] => some ⟨⟨⟨d⟩⟩, ⟨s⟩⟩
  | _ => none

theorem TypeId.ofValue_value (t : TypeId) : TypeId.ofValue? t.value = some t := by
  cases t; rfl

end Aven.Core
