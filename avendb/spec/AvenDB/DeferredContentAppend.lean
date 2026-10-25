/-! Rebinding an own validated metadata receipt across a strict canonical content
append. The implementation must establish unchanged old ciphertext, metadata,
authorization and keys; no policy/key/removal mutation qualifies. Current key
checks and metadata-vs-decrypted-content validation still run at every demand. -/
namespace AvenDB.DeferredContentAppend
structure Receipt where
  revision : Nat
  metadata : List Nat
  ciphertext : List UInt8
  deriving DecidableEq

def rebind (saved : Receipt) (before after : Nat) : Option Receipt :=
  if saved.revision = before then some { saved with revision := after } else none

theorem staleRejected (saved : Receipt) (before after : Nat) (h : saved.revision ≠ before) :
    rebind saved before after = none := by simp [rebind, h]

theorem preservesBytes (saved result : Receipt) (before after : Nat)
    (h : rebind saved before after = some result) :
    result.metadata = saved.metadata ∧ result.ciphertext = saved.ciphertext := by
  simp only [rebind] at h
  split at h
  · cases h
    exact ⟨rfl, rfl⟩
  · contradiction

-- Many immutable receipts refer to one exact basis; strict content append updates
-- that basis once. The implementation must establish unchanged old ciphertext,
-- authorization and keys before calling this transition.
structure Context where
  revision : Nat
  deriving DecidableEq

def advanceContext (context : Context) (before after : Nat) : Option Context :=
  if context.revision = before then some ⟨after⟩ else none

theorem context_stale_rejected (context : Context) (before after : Nat)
    (h : context.revision ≠ before) : advanceContext context before after = none := by
  simp [advanceContext, h]

def bodyAllowed (context : Context) (current : Nat) (currentKey : Bool) : Prop :=
  context.revision = current ∧ currentKey = true

theorem advanced_context_still_requires_key (context : Context) (current : Nat) :
    ¬ bodyAllowed context current false := by simp [bodyAllowed]

def advanceShared (context : Context) (receipts : List Receipt) (before after : Nat) :
    Option (Context × List Receipt) :=
  (advanceContext context before after).map fun next => (next, receipts)

theorem immutable_receipts_unchanged (context next : Context)
    (receipts result : List Receipt) (before after : Nat)
    (h : advanceShared context receipts before after = some (next, result)) :
    result = receipts := by
  simp only [advanceShared, advanceContext] at h
  split at h
  · simp only [Option.map_some, Option.some.injEq, Prod.mk.injEq] at h
    exact h.2.symm
  · simp at h

end AvenDB.DeferredContentAppend

namespace AvenDB.DeferredContentAppend
-- Visible item state alone does not certify the judgment scratch's causal cut.
structure ScratchCut where
  tip : Nat
  held : List Nat
  authenticated : Bool
  deriving DecidableEq

def resumes (cut : ScratchCut) (dependencies history : List Nat) : Prop :=
  cut.authenticated = true ∧ dependencies = [cut.tip] ∧ cut.held = history

theorem missingAuthenticationRejects (cut : ScratchCut) (deps history : List Nat)
    (h : cut.authenticated = false) : ¬ resumes cut deps history := by
  simp [resumes, h]

theorem differentCutRejects (cut : ScratchCut) (deps history : List Nat)
    (h : cut.held ≠ history) : ¬ resumes cut deps history := by
  simp [resumes, h]

-- Scratch reuse never labels omitted historical bodies as already hydrated.
def retainOmissions (missing : List Nat) : List Nat := missing
 theorem scratchReuseRetainsOmissions (missing : List Nat) :
    retainOmissions missing = missing := rfl
end AvenDB.DeferredContentAppend
