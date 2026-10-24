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

namespace AvenDB.BootstrapAnchor
/- Journal model assumes the Shelf create-only write returns a complete checksummed
object or recovery rejects it. This is an I/O assumption, not a theorem about disks. -/
structure JournalCommit where
  anchor : Disk
  signedIds : List Nat

def recoverCommit (j : JournalCommit) (whole : Bool) : Option Disk :=
  if whole && j.anchor.suffix.all (fun id => j.signedIds.contains id) then some j.anchor else none

theorem torn_commit_not_adopted (j : JournalCommit) : recoverCommit j false = none := by
  simp [recoverCommit]

theorem commit_retains_anchor (j : JournalCommit) (d : Disk) (whole : Bool)
    (h : recoverCommit j whole = some d) : d = j.anchor := by
  unfold recoverCommit at h
  split at h
  · exact (Option.some.inj h).symm
  · contradiction
end AvenDB.BootstrapAnchor

namespace AvenDB.BootstrapAnchor
/- Fixed-size frontier receipt: collision resistance is represented explicitly as
injectivity over the compared frontiers. This is not a proof of BLAKE3 security.
A receipt proves consistency with a saved log, never owner authorization. -/
def exactFrontier (digest : List Nat → Nat) (saved actual : List Nat) : Prop :=
  saved.length = actual.length ∧ digest saved = digest actual

theorem frontier_match_is_exact (digest : List Nat → Nat)
    (binding : ∀ a b, digest a = digest b → a = b)
    (saved actual : List Nat) (h : exactFrontier digest saved actual) : saved = actual := by
  exact binding saved actual h.2
end AvenDB.BootstrapAnchor
