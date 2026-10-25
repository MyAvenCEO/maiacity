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
-- Rebinding to a newer log is permitted only after recomputing all inputs of
-- an owner-only MAIN judgment. Empty shares make State.lets independent of
-- share-policy changes; exact print/tip covers admitted edits, bodies and lane.
-- These Booleans are implementation obligations, not hash-collision proofs.
def rebind (samePrint sameTip sameKeys sameWarm ownerOnly : Bool) :=
  samePrint && sameTip && sameKeys && sameWarm && ownerOnly
theorem rebind_requires_inputs (p t k w o : Bool) (h : rebind p t k w o = true) :
    p = true ∧ t = true ∧ k = true ∧ w = true ∧ o = true := by
  cases p <;> cases t <;> cases k <;> cases w <;> cases o <;> simp_all [rebind]
-- A validated rebind preserves the actual judged prefix, rather than restarting it.
def retainPrefix (valid : Bool) (prior : List α) := if valid then prior else []
theorem unrelated_rebind_retains_prefix (p : List α) : retainPrefix true p = p := rfl
end AvenDB.StagedMaterialization
