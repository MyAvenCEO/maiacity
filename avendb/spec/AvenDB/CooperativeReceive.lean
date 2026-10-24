/-!
Browser signature verification advances through an immutable preparation. Each step examines at most
eight edits; no partial preparation can be committed. Runtime yields between unfinished steps must be
actual event-loop tasks, not microtasks. One edit's cryptographic check remains indivisible, so the
step bound is not a wall-clock latency theorem. Current admission is still checked at final commit.
-/
namespace AvenDB.CooperativeReceive

def advance (checked total : Nat) : Nat := min total (checked + 8)

theorem step_bounded (checked total : Nat) : advance checked total ≤ checked + 8 :=
  Nat.min_le_right _ _

theorem never_past_end (checked total : Nat) : advance checked total ≤ total :=
  Nat.min_le_left _ _

def commitReady (checked total : Nat) : Bool := decide (checked = total)

theorem incomplete_cannot_commit (checked total : Nat) (h : checked ≠ total) :
    commitReady checked total = false := by simp [commitReady, h]

theorem completed_can_commit (total : Nat) : commitReady total total = true := by
  simp [commitReady]

end AvenDB.CooperativeReceive
