/-! Local scheduling cannot grant authority or change an admitted operation.
A waiting background turn follows at most three additional foreground grants.
This bounds queue overtaking, not the duration of one atomic core operation. -/
namespace AvenDB.LabScheduling

def foreground (backgroundWaiting : Bool) (burst : Nat) : Bool :=
  !backgroundWaiting || decide (burst < 3)

theorem background_after_burst (burst : Nat) (h : 3 ≤ burst) :
    foreground true burst = false := by simp [foreground, Nat.not_lt.mpr h]

def execute (operation : α → β) (state : α) (_priority : Bool) : β := operation state

theorem priority_preserves_result (operation : α → β) (state : α) :
    execute operation state true = execute operation state false := rfl
-- Time spent queued behind foreground work is not catch-up execution cost.
def cooldown (work multiplier : Nat) (_queued : Nat) : Nat := work * multiplier

theorem waiting_does_not_extend_cooldown (work multiplier q1 q2 : Nat) :
    cooldown work multiplier q1 = cooldown work multiplier q2 := rfl
end AvenDB.LabScheduling
