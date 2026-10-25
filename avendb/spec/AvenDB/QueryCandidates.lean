/-! Local query candidate filtering. The concrete selector retains immutable creation
labels and removes mutable tag tests. Soundness assumes creation labels equal those
in the final meaning; the full selector, authorization, record predicates and readiness
checks still execute on every retained candidate. No candidate grants authority.
This theorem concerns extensional results and stable order, not wall-clock timing. -/
namespace AvenDB.QueryCandidates

def selected (rows : List α) (candidate accepted : α → Bool) : List α :=
  (rows.filter candidate).filter accepted

theorem no_false_negative_preserves_result (rows : List α) (candidate accepted : α → Bool)
    (sound : ∀ x, accepted x = true → candidate x = true) :
    selected rows candidate accepted = rows.filter accepted := by
  induction rows with
  | nil => simp [selected]
  | cons x xs ih =>
    cases hc : candidate x <;> cases ha : accepted x <;> simp_all [selected]

theorem pagination_unchanged (rows : List α) (candidate accepted : α → Bool)
    (sound : ∀ x, accepted x = true → candidate x = true) (offset limit : Nat) :
    ((selected rows candidate accepted).drop offset).take limit =
      ((rows.filter accepted).drop offset).take limit := by
  rw [no_false_negative_preserves_result rows candidate accepted sound]

end AvenDB.QueryCandidates
