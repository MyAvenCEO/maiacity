import Aven.Core.Signed

/-!
# Hybrid signatures (A2; id/caps/README.md, D10 and "Post-quantum")

Where authority lasts, a signer signs with Ed25519 and ML-DSA-65 together, over the same bytes, and a signature holds
only when both halves verify: a quantum computer that breaks Ed25519 still meets ML-DSA-65, and a flaw in the newer
lattice scheme still meets Ed25519. A hybrid key and a hybrid signature are each a Value with exactly three keys, its
suite and its two halves (rule 29: every seal and signature names its suite), so they travel as a `Sig`'s `signer` and
`sig` bytes beside any signed thing, and `hybridVerify` is a `Verify` like any other.

The primitives stay outside Lean, held to their standards' known answers (RFC 8032, FIPS 204) and Wycheproof: the
model is parametric in each half's `verify`, as `Signed` is.
-/

namespace Aven.Core

/-- The hybrid suite: Ed25519 and ML-DSA-65, ML-DSA-65's context empty. -/
def hybridSuite : Nat := 1

def ed25519KeyLen : Nat := 32
def ed25519SigLen : Nat := 64
def mlDsa65KeyLen : Nat := 1952
def mlDsa65SigLen : Nat := 3309

/-- Two halves: a key's, or a signature's. -/
structure Hybrid where
  ed25519 : Bytes
  mlDsa : Bytes
  deriving DecidableEq, Repr

/-- As a Value: its suite and its halves, the keys sorted as the codec sorts them. -/
def Hybrid.value (h : Hybrid) : Value :=
  .map [("mlDsa".toUTF8.toList, .bytes h.mlDsa), ("suite".toUTF8.toList, .uint hybridSuite),
    ("ed25519".toUTF8.toList, .bytes h.ed25519)]

/-- A Value with exactly those keys, the hybrid suite and halves of the given lengths, or nothing. -/
def Hybrid.ofValue? (edLen mlLen : Nat) : Value → Option Hybrid
  | .map [(m, .bytes ml), (s, .uint suite), (e, .bytes ed)] =>
    if m = "mlDsa".toUTF8.toList ∧ s = "suite".toUTF8.toList ∧ e = "ed25519".toUTF8.toList ∧ suite = hybridSuite ∧
      ed.length = edLen ∧ ml.length = mlLen then some ⟨ed, ml⟩ else none
  | _ => none

theorem Hybrid.ofValue_value {h : Hybrid} {edLen mlLen : Nat} (he : h.ed25519.length = edLen)
    (hm : h.mlDsa.length = mlLen) : Hybrid.ofValue? edLen mlLen h.value = some h := by
  simp [Hybrid.value, Hybrid.ofValue?, he, hm]

/-- The hybrid scheme as a `Verify`: `key` and `sig` are the encodings of hybrid Values, and both halves verify `msg`. -/
def hybridVerify (ed mlDsa : Verify) : Verify := fun key msg sig =>
  match (decodeAll key).bind (Hybrid.ofValue? ed25519KeyLen mlDsa65KeyLen),
      (decodeAll sig).bind (Hybrid.ofValue? ed25519SigLen mlDsa65SigLen) with
  | some k, some s => ed k.ed25519 msg s.ed25519 && mlDsa k.mlDsa msg s.mlDsa
  | _, _ => false

/-- **Both halves, always:** a hybrid signature that holds holds for Ed25519 and for ML-DSA-65, over the same bytes. -/
theorem hybrid_needs_both {ed mlDsa : Verify} {key msg sig : Bytes} (h : hybridVerify ed mlDsa key msg sig = true) :
    ∃ k s : Hybrid, ed k.ed25519 msg s.ed25519 = true ∧ mlDsa k.mlDsa msg s.mlDsa = true := by
  unfold hybridVerify at h
  split at h
  · next k s _ _ => exact ⟨k, s, by simpa using h⟩
  · simp at h

/-- A hybrid `Signed` thing holds only when, for each signature beside it, both halves verify its signing bytes. -/
theorem Signed.hybrid_valid {ed mlDsa : Verify} {s : Signed} (h : s.valid (hybridVerify ed mlDsa) = true) :
    ∀ x ∈ s.sigs, ∃ k g : Hybrid, ed k.ed25519 (signingBytes s.label s.body) g.ed25519 = true ∧
      mlDsa k.mlDsa (signingBytes s.label s.body) g.mlDsa = true := by
  intro x m
  simp only [Signed.valid, Bool.and_eq_true, List.all_eq_true] at h
  exact hybrid_needs_both (h.2 x m)

#guard keysSorted (Hybrid.value ⟨[], []⟩ |> fun | .map kvs => kvs | _ => [])
#guard Canon (Hybrid.value ⟨List.replicate 32 1, List.replicate 1952 2⟩)
#guard (decodeAll (encode (Hybrid.value ⟨List.replicate 64 1, List.replicate 3309 2⟩))).bind
  (Hybrid.ofValue? ed25519SigLen mlDsa65SigLen) = some ⟨List.replicate 64 1, List.replicate 3309 2⟩
-- a signature's Value is no key's
#guard (decodeAll (encode (Hybrid.value ⟨List.replicate 64 1, List.replicate 3309 2⟩))).bind
  (Hybrid.ofValue? ed25519KeyLen mlDsa65KeyLen) = none

end Aven.Core
