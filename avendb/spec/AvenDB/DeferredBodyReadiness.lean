namespace AvenDB.DeferredBodyReadiness
inductive Readiness where
  | missing | metadata | content | invalid
  deriving DecidableEq
-- Authenticated metadata is not empty content and not a successful body read.
def contentReady : Readiness → Bool
  | .content => true
  | _ => false

theorem metadata_not_content : contentReady .metadata = false := rfl

def mayHydrate (exactBasis currentKey : Bool) : Bool := exactBasis && currentKey

theorem changed_basis_rejects (key : Bool) : mayHydrate false key = false := by
  simp [mayHydrate]
theorem missing_key_rejects (basis : Bool) : mayHydrate basis false = false := by
  simp [mayHydrate]
-- Failure must remain explicit, never be replaced with a valid empty update.
inductive Opened (α : Type) where
  | content (value : α)
  | invalid
end AvenDB.DeferredBodyReadiness
