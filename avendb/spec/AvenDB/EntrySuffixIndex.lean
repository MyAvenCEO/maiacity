namespace AvenDB.EntrySuffixIndex
-- Index equality to filtered canonical order is an implementation obligation.
-- Excluding already judged IDs does not create authorization or completeness.
def unseen (held : α → Bool) (ordered : List α) := ordered.filter fun x => !held x
theorem excludes (h : α → Bool) (xs : List α) (x : α)
    (member : x ∈ unseen h xs) : h x = false := by
  cases hx : h x <;> simp_all [unseen]
-- Replacement invalidates cursor reuse even if the cardinality is unchanged.
def reuse (sameRevision : Bool) := sameRevision
theorem replaced : reuse false = false := rfl
end AvenDB.EntrySuffixIndex
