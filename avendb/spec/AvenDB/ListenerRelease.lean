/-! Awaited shutdown includes the detached driver, not just idle connections. -/
namespace AvenDB.ListenerRelease
def complete (stopped retired : Bool) (drivers : Nat) : Prop :=
  stopped = true ∧ retired = true ∧ drivers = 0
theorem completed_has_no_driver (s r : Bool) (n : Nat) (h : complete s r n) : n = 0 := h.2.2
theorem outstanding_not_complete (s r : Bool) (n : Nat) : ¬ complete s r (n + 1) := by
  intro h
  exact Nat.noConfusion h.2.2
theorem ready : complete true true 0 := ⟨rfl, rfl, rfl⟩
end AvenDB.ListenerRelease
