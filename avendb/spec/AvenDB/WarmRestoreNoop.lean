/-! Snapshot due-state arithmetic only. Successful decryption, exact history-prefix
validation and current authorization remain Rust implementation premises. -/
namespace AvenDB.WarmRestoreNoop

def viewDue (replayed held saved : Nat) (stale : Bool) : Prop :=
  replayed > 0 ∧ replayed = held ∧ (saved = 0 ∨ stale = true ∨ replayed - saved ≥ 4096)

theorem validatedUnchanged (held : Nat) (nonempty : held > 0) :
    ¬ viewDue held held held false := by
  simp [viewDue]
  omega

theorem missingView (held : Nat) (nonempty : held > 0) :
    viewDue held held 0 false := by
  simp [viewDue, nonempty]

theorem sequentialSlots (step : α → β → α) (initial : α) (first second : List β) :
    (first ++ second).foldl step initial = second.foldl step (first.foldl step initial) := by
  simp
end AvenDB.WarmRestoreNoop
