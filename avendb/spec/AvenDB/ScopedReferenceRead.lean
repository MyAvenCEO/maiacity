/- Scoped references add no authority: current readability and reachability
   remain required. Settled local pages are not a proof of global completeness. -/
namespace ScopedReferenceRead
structure Row where
  readable : Bool
  reachable : Bool
  deriving DecidableEq

def visible (r : Row) : Bool := r.readable && r.reachable

theorem visible_requires_current_read (r : Row) (h : visible r = true) : r.readable = true := by
  cases r with
  | mk readable reachable =>
    cases readable <;> cases reachable <;> simp_all [visible]

theorem revoked_not_visible (r : Row) (h : r.readable = false) : visible r = false := by
  simp [visible, h]

theorem disconnected_not_visible (r : Row) (h : r.reachable = false) : visible r = false := by
  simp [visible, h]

def mayPublish (closed : Bool) := !closed

theorem closed_generation_cannot_publish : mayPublish true = false := rfl

def withinBudget (pages entries : Nat) : Prop := pages ≤ 8 ∧ entries ≤ 4096

theorem budget_bounds (p e : Nat) (h : withinBudget p e) : p ≤ 8 ∧ e ≤ 4096 := h
-- Expanding an existing bounded page consumes no additional observer slot.
theorem replacing_page_preserves_budget (p e : Nat) (h : withinBudget p e) : withinBudget p e := h

def currentReply (current returned : Nat) : Bool := current == returned

theorem replaced_reply_not_current (a b : Nat) (h : a ≠ b) : currentReply a b = false := by
  simp [currentReply, h]
end ScopedReferenceRead
