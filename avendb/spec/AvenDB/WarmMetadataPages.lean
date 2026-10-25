namespace AvenDB.WarmMetadataPages
-- Authenticated metadata pages do not authorize records: every retained entry
-- still requires its current key and canonical judgment fingerprint. Omitting
-- an item snapshot changes only whether content must be reconstructed on demand.
def expose (ownReceipt currentKey canonical : Bool) : Bool := ownReceipt && currentKey && canonical
theorem key_required (r k c : Bool) (h : expose r k c = true) : k = true := by
  cases k <;> simp_all [expose]
theorem invalid_receipt_rebuilds (k c : Bool) : expose false k c = false := rfl
def selected (requested : Bool) (authorized : Bool) : Bool := requested && authorized
theorem selection_not_authority (r : Bool) : selected r false = false := by cases r <;> rfl
-- The page and aggregate budgets are independent: paging never relaxes total
-- receipt bytes/writes, and optional item snapshots keep their separate cap.
def bounded (pageEntries totalWrites bytes snapshots : Nat) : Prop :=
  pageEntries ≤ 256 ∧ totalWrites ≤ 8192 ∧ bytes ≤ 33554432 ∧ snapshots ≤ 256
theorem total_bound {p w b s : Nat} (h : bounded p w b s) : w ≤ 8192 := h.2.1
def admits (used incoming limit : Nat) : Prop := incoming > 0 ∧ used + incoming ≤ limit
theorem admission_preserves_bound {u n l : Nat} (h : admits u n l) : u + n ≤ l := h.2
theorem over_budget_rejected {u n l : Nat} (h : l < u + n) : ¬ admits u n l := by
  intro a
  exact Nat.not_le_of_gt h a.2
end AvenDB.WarmMetadataPages
