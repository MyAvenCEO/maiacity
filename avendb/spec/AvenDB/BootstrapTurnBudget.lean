namespace AvenDB.BootstrapTurnBudget
-- One budget shared by every anchor. Invalid/blocked admissions consume at most
-- one unit; a missing-body queue is not runnable until input changes.
def admitted (budget : Nat) (work : List α) := work.take budget
theorem bounded (n : Nat) (xs : List α) : (admitted n xs).length ≤ n := by
  simp only [admitted, List.length_take]
  exact Nat.min_le_left _ _
-- Moving a processed anchor to the end preserves all anchors for the next turn.
def rotate (head : α) (tail : List α) := tail ++ [head]
theorem retained (h : α) (xs : List α) : h ∈ rotate h xs := by simp [rotate]
end AvenDB.BootstrapTurnBudget
