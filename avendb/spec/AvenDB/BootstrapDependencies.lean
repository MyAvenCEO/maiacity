/- Targeted repair only narrows an existing authorized reply. IDs and peers carry no
additional authority; delivery never replaces ordinary signature/current-policy checks. -/
namespace AvenDB.BootstrapDependencies
def selected (authorized requested sameEntry : Nat → Bool) (id : Nat) : Bool :=
  authorized id && requested id && sameEntry id
theorem selected_authorized (a r e : Nat → Bool) (id : Nat)
    (h : selected a r e id = true) : a id = true := by
  simp [selected, Bool.and_eq_true] at h
  exact h.1.1
theorem unrelated_refused (a r e : Nat → Bool) (id : Nat) (h : e id = false) :
    selected a r e id = false := by simp [selected,h]
end AvenDB.BootstrapDependencies
