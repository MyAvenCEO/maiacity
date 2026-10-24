/-! Read-only entry projections are not policy state. The concrete gate consumes a standing
owner-approved Snapshot (the existing Snapshot.lean approval rules), a verified ciphertext
root and AEAD body, current reader/key entitlement, matching entry/basis/engine, and no later
removal. Current policy is locally held; unknown revocations are not ruled out. Records are
bounded read-only JSON with an attested frontier, not writable CRDT snapshots. These booleans abstract those concrete checks, not cryptographic proofs. -/
namespace AvenDB.EntryProjection
structure Evidence where
  standingOwnerApproval : Bool
  authenticatedBytes : Bool
  currentReader : Bool
  currentEpoch : Bool
  scopedEntry : Bool
  matchingBasis : Bool
  supportedEngine : Bool
  noLaterRemoval : Bool
  boundedRecords : Bool

def admitted (e : Evidence) : Bool :=
  e.standingOwnerApproval && e.authenticatedBytes && e.currentReader && e.currentEpoch &&
  e.scopedEntry && e.matchingBasis && e.supportedEngine && e.noLaterRemoval && e.boundedRecords

def adopt (e : Evidence) (kernel projection : Nat) : Nat × Option Nat :=
  (kernel, if admitted e then some projection else none)

theorem kernel_unchanged (e : Evidence) (k p : Nat) : (adopt e k p).1 = k := rfl

theorem unreadable_rejected (e : Evidence) (h : e.currentReader = false) (k p : Nat) :
    (adopt e k p).2 = none := by simp [adopt, admitted, h]

theorem revoked_rejected (e : Evidence) (h : e.noLaterRemoval = false) (k p : Nat) :
    (adopt e k p).2 = none := by simp [adopt, admitted, h]

theorem unsigned_rejected (e : Evidence) (h : e.standingOwnerApproval = false) (k p : Nat) :
    (adopt e k p).2 = none := by simp [adopt, admitted, h]
theorem unbounded_rejected (e : Evidence) (h : e.boundedRecords = false) (k p : Nat) :
    (adopt e k p).2 = none := by simp [adopt, admitted, h]
def mutationReady (projectionSelected : Bool) : Bool := !projectionSelected

theorem projected_state_cannot_write : mutationReady true = false := rfl
-- Filtering the existing canonical local collection does not admit any new row.
def typedRows (rows : List α) (matchesType : α → Bool) := rows.filter matchesType

theorem typed_rows_are_canonical (rows : List α) (matchesType : α → Bool) (row : α)
    (h : row ∈ typedRows rows matchesType) : row ∈ rows := by
  exact (List.mem_filter.mp h).1
end AvenDB.EntryProjection
