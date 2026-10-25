namespace AvenDB.WarmQueryReceipt
-- Own authenticated snapshot receipts certify translation eligibility at one
-- depth and schema context. Payload predicates never use this shortcut.
structure Receipt where
  basis : Nat
  schema : Nat
  depth : Nat
  visible : Bool

def accepts (r : Receipt) (basis schema depth : Nat) (authorized labelsOnly : Bool) : Prop :=
  r.basis = basis ∧ r.schema = schema ∧ r.depth = depth ∧ authorized = true ∧ labelsOnly = true

theorem stale_rejected (r : Receipt) (basis schema depth : Nat) (h : r.basis ≠ basis) :
    ¬ accepts r basis schema depth true true := by simp [accepts, h]
theorem payload_rejected (r : Receipt) (basis schema depth : Nat) :
    ¬ accepts r basis schema depth true false := by simp [accepts]
theorem revoked_rejected (r : Receipt) (basis schema depth : Nat) :
    ¬ accepts r basis schema depth false true := by simp [accepts]
-- Equality of membership decisions gives identical stable filtering, hence the
-- same count and page before expensive row materialization.
theorem same_page {α : Type} (xs : List α) (a b : α → Bool)
    (h : ∀ x, a x = b x) (offset limit : Nat) :
    ((xs.filter a).drop offset).take limit = ((xs.filter b).drop offset).take limit := by
  have hab : a = b := funext h
  rw [hab]
end AvenDB.WarmQueryReceipt
