namespace AvenDB.StagedMaterialization
-- Staging owns only a prefix; no prefix is an authoritative item.
def publish (sameLog sameKeys sameLane finished : Bool) :=
  sameLog && sameKeys && sameLane && finished
theorem unfinished_hidden (l k a : Bool) : publish l k a false = false := by
  cases l <;> cases k <;> cases a <;> rfl
theorem stale_log_hidden (k a f : Bool) : publish false k a f = false := rfl
theorem stale_keys_hidden (l a f : Bool) : publish l false a f = false := by cases l <;> rfl
-- The continuation is the same left fold over the same canonical sequence.
theorem resumed_fold (f : σ → α → σ) (s : σ) (a b : List α) :
  (a ++ b).foldl f s = b.foldl f (a.foldl f s) := List.foldl_append
-- A refused pending mutation contributes no signed write.
def mutate (pending : Bool) (before : List α) (write : α) :=
  if pending then before else before ++ [write]
theorem pending_no_commit (s : List α) (w : α) : mutate true s w = s := rfl
end AvenDB.StagedMaterialization
