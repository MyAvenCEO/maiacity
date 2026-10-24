/- A shelf export has already checked its requested range against a Filling source.
The backend may move that temporary object to the SAME hash between reads. This
model specifies addressing, retry count and error handling only. It assumes that
the source's temporary name and final hash refer to the same blob; it does NOT
prove backend honesty, hash integrity, ciphertext authentication or caller checks. -/
namespace AvenDB.FillingReadFallback
structure Range where
  blob : Nat
  offset : Nat
  length : Nat
  deriving DecidableEq
inductive Location where
  | temporary | final
  deriving DecidableEq
structure Request where
  range : Range
  location : Location
  deriving DecidableEq

def attempts (r : Range) (temporaryFailed : Bool) : List Request :=
  if temporaryFailed then [{range := r, location := .temporary}, {range := r, location := .final}]
  else [{range := r, location := .temporary}]

theorem at_most_two (r : Range) (failed : Bool) : (attempts r failed).length ≤ 2 := by
  cases failed <;> simp [attempts]
theorem same_blob_and_range (r : Range) (failed : Bool) :
    (attempts r failed).map Request.range =
      if failed then [r,r] else [r] := by
  cases failed <;> simp [attempts]

-- Only a successful full-length fallback replaces the original error. Length is
-- not content integrity: the export's ordinary verification remains necessary.
def fallback (length originalError : Nat) (finalRead : Except Nat (List Nat)) : Except Nat (List Nat) :=
  match finalRead with
  | .ok bytes => if bytes.length = length then .ok bytes else .error originalError
  | .error _ => .error originalError

theorem failed_preserves_original (n original finalError : Nat) :
    fallback n original (.error finalError) = .error original := rfl
theorem short_preserves_original (n original : Nat) (bytes : List Nat) (h : bytes.length ≠ n) :
    fallback n original (.ok bytes) = .error original := by simp [fallback,h]
theorem exact_length_only (n original : Nat) (bytes : List Nat) (h : bytes.length = n) :
    fallback n original (.ok bytes) = .ok bytes := by simp [fallback,h]
end AvenDB.FillingReadFallback
