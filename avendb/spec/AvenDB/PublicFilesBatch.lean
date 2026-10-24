namespace AvenDB.PublicFilesBatch
-- Replacing a per-entry file lookup with an equal batched lookup preserves
-- each entry's first readable file. Candidate order is kept by the caller.
theorem first_preserved {α : Type} (single grouped : List α) (same : grouped = single) :
    grouped.head? = single.head? := by rw [same]
theorem ordered_projection_preserved {α β : Type} (entries : List α)
    (single grouped : α → β) (same : ∀ e, grouped e = single e) :
    entries.map grouped = entries.map single := by
  induction entries with
  | nil => rfl
  | cons x xs ih => simp only [List.map_cons, same, ih]
end AvenDB.PublicFilesBatch
