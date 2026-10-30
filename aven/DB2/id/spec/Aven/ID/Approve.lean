import Aven.ID.Query

/-! # Approvals

An approval is k of a vault's owners signing one digest, for one act (`id/caps/README.md`, rule 25). The model knows
a signature as avenID's statements do: the key that made it and what it signed, the scheme taken as sound. Every grant
needs its vault's owners' approval (D14): today any one owner is enough, so the threshold is 1 until owners act k of n.

What a person approves is shown from the exact bytes they sign (rule 25, A2): `shown` decodes those bytes and renders
what they hold, never a copy kept beside them. The codec is `Aven.Core`'s deterministic CBOR; here it is any encoding
that decodes what it encodes. -/

namespace Aven.ID

/-- A signature as the model knows one: the key that made it and the digest it signed. -/
structure Sig where
  key : String
  digest : String
  deriving DecidableEq, Repr

theorem nodup_dedup : ∀ (l : List String), (dedup l).Nodup
  | [] => List.nodup_nil
  | x :: xs => by
    simp only [dedup]
    refine List.nodup_cons.mpr ⟨by simp [List.mem_filter], (nodup_dedup xs).filter _⟩

namespace Tree

/-- `k` is one of `vault`'s owner keys. -/
def ownerKey (t : Tree) (vault k : String) : Bool :=
  match t.get? vault with
  | some v => v.ownerKeys.contains k
  | none => false

/-- The owners of `vault` who signed exactly `digest`, each once. -/
def approvers (t : Tree) (vault digest : String) (sigs : List Sig) : List String :=
  dedup ((sigs.filter fun s => s.digest == digest && t.ownerKey vault s.key).map (·.key))

/-- `k` of `vault`'s owners signed exactly `digest`. -/
def approved (t : Tree) (k : Nat) (vault digest : String) (sigs : List Sig) : Bool :=
  decide (k ≤ (t.approvers vault digest sigs).length)

variable {t : Tree}

theorem mem_approvers {vault digest o : String} {sigs : List Sig} :
    o ∈ t.approvers vault digest sigs ↔ ⟨o, digest⟩ ∈ sigs ∧ t.ownerKey vault o = true := by
  simp only [approvers, mem_dedup, List.mem_map, List.mem_filter, Bool.and_eq_true, beq_iff_eq]
  constructor
  · rintro ⟨s, ⟨m, d, k⟩, rfl⟩
    exact ⟨by cases s; simp_all, k⟩
  · rintro ⟨m, k⟩
    exact ⟨⟨o, digest⟩, ⟨m, rfl, k⟩, rfl⟩

/-- An approval holds only with `k` distinct owners of the vault, each having signed exactly this digest. -/
theorem approval_exact {k : Nat} {vault digest : String} {sigs : List Sig} (h : t.approved k vault digest sigs = true) :
    ∃ owners : List String, owners.Nodup ∧ k ≤ owners.length ∧
      ∀ o ∈ owners, ⟨o, digest⟩ ∈ sigs ∧ t.ownerKey vault o = true :=
  ⟨t.approvers vault digest sigs, nodup_dedup _, by simpa [approved] using h, fun _ m => mem_approvers.mp m⟩

/-- A signature over another digest never counts toward this one. -/
theorem approvers_other {vault digest : String} {sigs : List Sig} {s : Sig} (other : s.digest ≠ digest) :
    t.approvers vault digest (s :: sigs) = t.approvers vault digest sigs := by
  simp [approvers, other]

end Tree

/-- Any encoding that decodes what it encodes. `Aven.Core`'s deterministic CBOR is one (A2). -/
structure Codec (α : Type) where
  encode : α → List UInt8
  decode : List UInt8 → Option α
  roundtrip : ∀ a, decode (encode a) = some a

/-- What avenOS shows for the bytes a passkey is asked to sign: those bytes, decoded and rendered. -/
def shown {α : Type} (c : Codec α) (render : α → String) (bytes : List UInt8) : Option String :=
  (c.decode bytes).map render

/-- What is shown is what is signed: for the bytes of an act, avenOS shows exactly that act. -/
theorem shown_is_signed {α : Type} (c : Codec α) (render : α → String) (a : α) :
    shown c render (c.encode a) = some (render a) := by
  simp [shown, c.roundtrip]

end Aven.ID
