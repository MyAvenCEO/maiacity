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

namespace AvenDB.BootstrapDependencies
-- Key recovery is an ordering hint on existing authorized logs, never an admission rule.
def keyPriority (active waiting authorized : Bool) : Bool := active && waiting && authorized
theorem keyPriority_requires_authority (a w p : Bool) (h : keyPriority a w p = true) : p = true := by
  simp [keyPriority, Bool.and_eq_true] at h
  exact h.2
theorem releasedView_has_no_key_priority (w p : Bool) : keyPriority false w p = false := by
  simp [keyPriority]
end AvenDB.BootstrapDependencies
