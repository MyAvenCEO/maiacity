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
end AvenDB.DeferredContentAppend
