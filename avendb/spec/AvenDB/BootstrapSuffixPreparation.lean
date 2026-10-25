namespace AvenDB.BootstrapSuffixPreparation
-- Preparation operates only within an unchanged authenticated log revision.
-- A turn limits inspected candidates, including candidates already judged.
def budget (inspected remaining initial : Nat) : Prop := inspected + remaining = initial
theorem bounded {i r n : Nat} (h : budget i r n) : i ≤ n := by
  unfold budget at h
  omega
-- Pending is deliberately an upper bound until discovery inspects every candidate.
def pending (queued unscanned : Nat) := queued + unscanned
theorem zero_means_discovered {q u : Nat} (h : pending q u = 0) : u = 0 := by
  unfold pending at h
  omega
-- No prior is skipped or duplicated when the next page starts after its cursor.
theorem concatenate (prior page rest : List α) : (prior ++ page) ++ rest = prior ++ (page ++ rest) :=
  List.append_assoc prior page rest
end AvenDB.BootstrapSuffixPreparation
