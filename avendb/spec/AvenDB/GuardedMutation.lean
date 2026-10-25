/- Read assumptions narrow execution, never grant authority. The same check is
   repeated at continuation after owner approval; checking only preparation is insufficient. -/
namespace GuardedMutation

def mayExecute (authorized : Bool) (expected current : Nat) := authorized && decide (expected = current)

theorem changed_cut_refused (a : Bool) (e c : Nat) (h : e ≠ c) : mayExecute a e c = false := by
  simp [mayExecute, h]

theorem no_authority_added (e c : Nat) : mayExecute false e c = false := by
  simp [mayExecute]

theorem execution_requires_current_cut (a : Bool) (e c : Nat) (h : mayExecute a e c = true) : e = c := by
  by_cases same : e = c
  · exact same
  · simp [mayExecute, same] at h
end GuardedMutation

namespace GuardedMutation
-- A continuation failure must preserve the previously accepted result.
def continuation (accepted : Nat) (refresh : Option Nat) : Nat × Bool :=
  (accepted, refresh.isSome)
theorem failed_refresh_preserves_acceptance (accepted : Nat) :
    (continuation accepted none).1 = accepted := rfl
theorem failed_refresh_stops_plan (accepted : Nat) :
    (continuation accepted none).2 = false := rfl
end GuardedMutation

namespace GuardedMutation
-- Positive dependencies require authorized unchanged reads; only negative
-- decisions additionally require complete local domain evidence.
def dependencyReady (authorized unchanged negative complete : Bool) :=
  authorized && unchanged && (!negative || complete)
theorem positive_does_not_require_absence (a u c : Bool) :
    dependencyReady a u false c = (a && u) := by
  cases a <;> cases u <;> cases c <;> rfl
theorem negative_incomplete_refused (a u : Bool) :
    dependencyReady a u true false = false := by
  cases a <;> cases u <;> rfl
end GuardedMutation
