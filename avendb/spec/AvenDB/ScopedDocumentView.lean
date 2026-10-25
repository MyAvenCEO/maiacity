namespace AvenDB.ScopedDocumentView
-- Mounted demand schedules candidates; authorization still gates every returned row.
def visible (authorized selected : Bool) : Bool := authorized && selected
theorem visible_authorized (a m : Bool) (h : visible a m = true) : a = true := by
  simp [visible, Bool.and_eq_true] at h
  exact h.1
-- A local zero-row response is not a proof of peer discovery completeness.
def authoritativeEmpty (rows : Nat) (discoveryProved : Bool) : Bool := rows == 0 && discoveryProved
theorem local_empty_not_authoritative : authoritativeEmpty 0 false = false := rfl
end AvenDB.ScopedDocumentView
