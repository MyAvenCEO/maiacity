/-! An observed row frontier identifies only the authorized result consumed.
It cannot stand in for paint, causal inclusion, or global completeness. -/
namespace AvenDB.ReactiveObservation

def sample (allowed requested : Bool) (heads : List Nat) :=
  if allowed && requested then heads.take 32 else []

theorem unauthorized_has_no_frontier (requested : Bool) (heads : List Nat) :
    sample false requested heads = [] := by simp [sample]

theorem opt_in_only (allowed : Bool) (heads : List Nat) :
    sample allowed false heads = [] := by simp [sample]

theorem bounded (allowed requested : Bool) (heads : List Nat) :
    (sample allowed requested heads).length ≤ 32 := by
  simp only [sample]
  split
  · simp only [List.length_take]; exact Nat.min_le_left _ _
  · simp

def completeness (_emitted : Bool) (verified : Bool) := verified
 theorem emission_is_not_completeness : completeness true false = false := rfl
end AvenDB.ReactiveObservation
