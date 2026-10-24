namespace AvenDB.BootstrapBatch
-- Authorization and canonical ordering are implementation premises.
def advance (budget : Nat) (pending : List α) : List α × List α :=
  (pending.take budget, pending.drop budget)
theorem preserves (n : Nat) (xs : List α) :
    (advance n xs).1 ++ (advance n xs).2 = xs := by simp [advance]
def writable (authorized : Bool) (pending : Nat) : Bool := authorized && (pending == 0)
theorem pending_readonly (a : Bool) (n : Nat) : writable a (n+1) = false := by simp [writable]
end AvenDB.BootstrapBatch
