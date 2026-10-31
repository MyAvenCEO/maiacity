import Aven.Core.Names

/-!
# Signed things (rule 1)

Everything signed is a label plus a Value: the signature covers exactly the encoding of `[label, body]`, so a
signature made for one kind of thing can never be read as another's. A signed thing is named by the hash of exactly
those bytes, its signatures beside it (A30): a set of them, `sigs`, one per signer, sorted by signer, which only grows
(`addSig`). Passkey and ML-DSA signatures are randomized, so signing one act twice gives two signatures, but never two
names, and adding a signature, by the same signer or another, never renames the act (`Signed.name_sigs`): the others
are approvals over the same bytes (caps' `Approve`, k of a vault's owners signing one digest; a sign-in's passkey with
the owner's hybrid key).

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

/-- A signature scheme: whether `sig` is `key`'s signature over `msg`. Suites live inside `sig` (`Hybrid`). -/
abbrev Verify := (key : Bytes) → (msg : Bytes) → (sig : Bytes) → Bool

/-- One signature beside a name: who signed and the signature, both opaque bytes. -/
structure Sig where
  signer : Bytes
  sig : Bytes
  deriving DecidableEq, Repr

/-- A signature as it travels: `{"sig", "signer"}`, keys in the codec's order. -/
def Sig.value (x : Sig) : Value := .map [("sig".toUTF8.toList, .bytes x.sig), ("signer".toUTF8.toList, .bytes x.signer)]

/-- `x` is a signature by its signer over `msg`. -/
def Sig.valid (verify : Verify) (msg : Bytes) (x : Sig) : Bool := verify x.signer msg x.sig

/-- A set of signatures in its one form: strictly sorted by signer, so one per signer. -/
def sigsOk (xs : List Sig) : Bool := strictlySorted (xs.map Sig.signer)

/-- Adds a signature to a set: in its place by signer, or, when that signer has signed already, the set unchanged. A
set only grows. -/
def addSig (x : Sig) : List Sig → List Sig
  | [] => [x]
  | y :: ys =>
    if lexLt x.signer y.signer then x :: y :: ys
    else if x.signer == y.signer then y :: ys
    else y :: addSig x ys

/-- Adding never drops a signature. -/
theorem addSig_mono (x : Sig) : ∀ (xs : List Sig), ∀ y ∈ xs, y ∈ addSig x xs
  | [], _, h => by simp at h
  | z :: zs, y, h => by
    simp only [addSig]
    split
    · exact List.mem_cons_of_mem _ h
    · split
      · exact h
      · rcases List.mem_cons.mp h with rfl | h
        · exact List.mem_cons_self
        · exact List.mem_cons_of_mem _ (addSig_mono x zs y h)

/-- After adding, the set holds a signature by that signer. -/
theorem addSig_signed (x : Sig) : ∀ (xs : List Sig), ∃ y ∈ addSig x xs, y.signer = x.signer
  | [] => ⟨x, by simp [addSig]⟩
  | z :: zs => by
    simp only [addSig]
    split
    · exact ⟨x, List.mem_cons_self, rfl⟩
    · split
      · rename_i h
        exact ⟨z, List.mem_cons_self, (beq_iff_eq.mp h).symm⟩
      · obtain ⟨y, m, e⟩ := addSig_signed x zs
        exact ⟨y, List.mem_cons_of_mem _ m, e⟩

structure Signed where
  label : Bytes
  body : Value
  sigs : List Sig
  deriving Repr

def Signed.signing (s : Signed) : Bytes := signingBytes s.label s.body

/-- Every signature beside it is its signer's over its signing bytes, and it has one at least. -/
def Signed.valid (verify : Verify) (s : Signed) : Bool := !s.sigs.isEmpty && s.sigs.all (Sig.valid verify s.signing)

/-- `key` signed it: one of its signatures is by `key` and verifies. -/
def Signed.signedBy (verify : Verify) (key : Bytes) (s : Signed) : Bool :=
  s.sigs.any fun x => x.signer == key && x.valid verify s.signing

/-- A signed thing as a Value, its signatures with it, as it travels: its keys sorted as the codec sorts them. -/
def Signed.value (s : Signed) : Value :=
  .map [("body".toUTF8.toList, s.body), ("sigs".toUTF8.toList, .array (s.sigs.map Sig.value)),
    ("label".toUTF8.toList, .text s.label)]

/-- A signed thing's name: the hash of its label and body, exactly what its signers sign (A30). -/
def Signed.name (H : Bytes → Hash) (s : Signed) : Hash := H (signingBytes s.label s.body)

/-- Its signatures never touch its name: signing again, by anyone, keeps it. -/
theorem Signed.name_sigs (H : Bytes → Hash) (s : Signed) (sigs : List Sig) :
    ({ s with sigs } : Signed).name H = s.name H := rfl

theorem Signed.name_addSig (H : Bytes → Hash) (s : Signed) (x : Sig) :
    ({ s with sigs := addSig x s.sigs } : Signed).name H = s.name H := rfl

/-- Adding a signature keeps every signature that verified. -/
theorem Signed.signedBy_addSig {verify : Verify} {key : Bytes} {s : Signed} (x : Sig)
    (h : s.signedBy verify key = true) : ({ s with sigs := addSig x s.sigs } : Signed).signedBy verify key = true := by
  simp only [Signed.signedBy, List.any_eq_true] at h ⊢
  obtain ⟨y, m, hy⟩ := h
  exact ⟨y, addSig_mono x _ y m, hy⟩

/-- Two well-formed signed things with one name, under a hash nothing collides under, have one label and one body:
they differ at most in who signed and how. -/
theorem Signed.name_inj {H : Bytes → Hash} (hH : Injective H) {s t : Signed} (hl : textOk s.label = true)
    (hl' : textOk t.label = true) (hb : Canon s.body = true) (hb' : Canon t.body = true) (h : s.name H = t.name H) :
    s.label = t.label ∧ s.body = t.body :=
  signing_separates hl hl' hb hb' (hH _ _ h)

#guard keysSorted [("body".toUTF8.toList, .null), ("sigs".toUTF8.toList, .null), ("label".toUTF8.toList, .null)]
#guard keysSorted [("sig".toUTF8.toList, .null), ("signer".toUTF8.toList, .null)]
#guard addSig ⟨[2], [0]⟩ (addSig ⟨[1], [0]⟩ (addSig ⟨[2], [9]⟩ [])) = [⟨[1], [0]⟩, ⟨[2], [9]⟩]

end Aven.Core
