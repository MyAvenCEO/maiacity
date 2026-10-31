import Aven.Core.Names

/-!
# Signed things (rule 1)

Everything signed is a label plus a Value: the signature covers exactly the encoding of `[label, body]`, so a
signature made for one kind of thing can never be read as another's. A signed thing is named by the hash of its whole
encoding, signature included.

Signatures are taken as sound: the model is parametric in `verify`, and nothing here depends on how it checks.
-/

namespace Aven.Core

/-- What a signer signs: the encoding of its label and body. -/
def signingBytes (label : Bytes) (body : Value) : Bytes := encode (.array [.text label, body])

/-- A signing input names its label and body: one input can't be two. -/
theorem signing_separates {l₁ l₂ : Bytes} {b₁ b₂ : Value} (hl₁ : textOk l₁ = true) (hl₂ : textOk l₂ = true)
    (hb₁ : Canon b₁ = true) (hb₂ : Canon b₂ = true) (h : signingBytes l₁ b₁ = signingBytes l₂ b₂) :
    l₁ = l₂ ∧ b₁ = b₂ := by
  have c₁ : Shape (.array [.text l₁, b₁]) = true := by simp [Shape, ShapeList, hl₁, Canon.shape hb₁, limit]
  have c₂ : Shape (.array [.text l₂, b₂]) = true := by simp [Shape, ShapeList, hl₂, Canon.shape hb₂, limit]
  have := encode_inj_shape c₁ c₂ h
  simp only [Value.array.injEq, List.cons.injEq, Value.text.injEq, and_true] at this
  exact this

/-- A signature scheme: whether `sig` is `key`'s signature over `msg`. -/
abbrev Verify := (key : Bytes) → (msg : Bytes) → (sig : Bytes) → Bool

structure Signed where
  label : Bytes
  body : Value
  signer : Bytes
  sig : Bytes
  deriving Repr

def Signed.valid (verify : Verify) (s : Signed) : Bool := verify s.signer (signingBytes s.label s.body) s.sig

/-- A signed thing as a Value: its keys sorted as the codec sorts them. -/
def Signed.value (s : Signed) : Value :=
  .map [("sig".toUTF8.toList, .bytes s.sig), ("body".toUTF8.toList, s.body),
    ("label".toUTF8.toList, .text s.label), ("signer".toUTF8.toList, .bytes s.signer)]

def Signed.name (H : Bytes → Hash) (s : Signed) : Hash := nameOf H s.value

#guard keysSorted [("sig".toUTF8.toList, .null), ("body".toUTF8.toList, .null), ("label".toUTF8.toList, .null),
  ("signer".toUTF8.toList, .null)]

end Aven.Core
