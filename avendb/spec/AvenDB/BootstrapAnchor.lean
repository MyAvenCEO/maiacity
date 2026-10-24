/- Durable anchor model: bytes are reauthenticated after reopen; persisted suffix IDs
are not authority. Kernel replay and all ordinary suffix checks remain independent. -/
namespace AvenDB.BootstrapAnchor
structure Disk where
  snapshot : Nat
  sealedRoot : Nat
  suffix : List Nat
structure Checks where
  ownerStanding : Bool
  scopeValid : Bool
  currentReader : Bool
  removalKnown : Bool
  ciphertextValid : Bool

def reopen (d : Disk) (c : Checks) : Option Disk :=
  if c.ownerStanding && c.scopeValid && c.currentReader && !c.removalKnown && c.ciphertextValid
  then some d else none

theorem removal_invalidates (d : Disk) (c : Checks) (h : c.removalKnown = true) : reopen d c = none := by
  simp [reopen,h]

theorem reopened_exact_anchor (d d' : Disk) (c : Checks) (h : reopen d c = some d') : d' = d := by
  unfold reopen at h
  split at h
  · exact (Option.some.inj h).symm
  · contradiction

/- Receiving the same suffix twice changes no identity frontier. Authorization of its
content is a separate precondition, not supplied by deduplication. -/
def keep (ids : List Nat) (id : Nat) : List Nat := if ids.contains id then ids else ids ++ [id]
theorem keep_twice (ids : List Nat) (id : Nat) : keep (keep ids id) id = keep ids id := by
  unfold keep
  split
  · rfl
  · simp
end AvenDB.BootstrapAnchor
