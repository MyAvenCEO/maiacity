namespace AvenDB.IndexedHistoryAdmission
-- Lookup changes representation only: membership in the index is precisely
-- membership in the already admitted heldWrites (not future writes).
theorem indexed_exists_equivalent (heldWrites : List α) (index : κ → List α)
    (key : α → κ) (correct : ∀ k x, x ∈ index k ↔ x ∈ heldWrites ∧ key x = k)
    (k : κ) (predicate : α → Prop) :
    (∃ x ∈ index k, predicate x) ↔ (∃ x ∈ heldWrites, key x = k ∧ predicate x) := by
  constructor
  · rintro ⟨x, member, valid⟩
    obtain ⟨held, same⟩ := (correct k x).mp member
    exact ⟨x, held, same, valid⟩
  · rintro ⟨x, held, same, valid⟩
    exact ⟨x, (correct k x).mpr ⟨held, same⟩, valid⟩
end AvenDB.IndexedHistoryAdmission
