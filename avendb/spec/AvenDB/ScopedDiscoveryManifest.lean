/- An exhaustive owner statement is scoped to an explicit accepted cut, never
   current remote knowledge. Missing current authority or relevant suffix changes
   prevent negative use even when the old statement is authentic. -/
namespace ScopedDiscoveryManifest
structure Evidence where
  ownerAuthenticated : Bool
  exactScope : Bool
  noTruncation : Bool
  currentReadAuthority : Bool
  allMembersReadable : Bool
  relevantSuffixUnchanged : Bool

def mayUse (e : Evidence) := e.ownerAuthenticated && e.exactScope && e.noTruncation &&
  e.currentReadAuthority && e.allMembersReadable && e.relevantSuffixUnchanged

theorem missing_members_refused (a b c d f : Bool) :
    mayUse ⟨a,b,c,d,false,f⟩ = false := by
  cases a <;> cases b <;> cases c <;> cases d <;> cases f <;> rfl

theorem changed_suffix_refused (a b c d e : Bool) :
    mayUse ⟨a,b,c,d,e,false⟩ = false := by
  cases a <;> cases b <;> cases c <;> cases d <;> cases e <;> rfl

def remoteComplete (_ : Evidence) := false
theorem no_remote_claim (e : Evidence) : remoteComplete e = false := rfl
end ScopedDiscoveryManifest

namespace ScopedDiscoveryManifest
def safeDisclosure (possibleCarrierReaders selectedMemberReaders : List Nat) : Prop :=
  ∀ reader, reader ∈ possibleCarrierReaders → reader ∈ selectedMemberReaders
theorem inherited_reader_must_read_members (carrier members : List Nat)
    (safe : safeDisclosure carrier members) (reader : Nat) (h : reader ∈ carrier) :
    reader ∈ members := safe reader h
end ScopedDiscoveryManifest

namespace ScopedDiscoveryManifest
-- Automatic selection changes scheduling only. Negative proof remains an
-- explicit accepted-cut query; ordinary result completeness is unchanged.
def automaticCompleteness (ordinary : Bool) (_hintSelected : Bool) := ordinary
theorem automatic_hint_does_not_promote_incomplete (selected : Bool) :
    automaticCompleteness false selected = false := rfl
end ScopedDiscoveryManifest

namespace ScopedDiscoveryManifest
-- Satisfied dependencies leave the bounded priority prefix. Remaining missing
-- dependencies keep their relative order; a row list cannot displace them.
def pendingMembers (members visible : List Nat) := members.filter (fun id => !visible.contains id)
theorem satisfied_member_not_pending (members visible : List Nat) (id : Nat)
    (h : id ∈ visible) : id ∉ pendingMembers members visible := by
  simp [pendingMembers, List.mem_filter, h]
end ScopedDiscoveryManifest

namespace ScopedDiscoveryManifest
-- Authenticated descendant depth strictly increases. Random carrier IDs cannot
-- reverse a strict causal publication order; equal-depth cuts remain concurrent.
def newerCausalCut (oldDepth newDepth : Nat) := oldDepth < newDepth
theorem descendant_preferred (depth delta : Nat) : newerCausalCut depth (depth + delta + 1) := by
  unfold newerCausalCut
  omega
end ScopedDiscoveryManifest

namespace ScopedDiscoveryManifest
def fulfilledMember (visible authorized importedAdvertisedHeads : Bool) :=
  visible && authorized && importedAdvertisedHeads
theorem visible_stale_member_not_fulfilled (authorized : Bool) :
    fulfilledMember true authorized false = false := by cases authorized <;> rfl
end ScopedDiscoveryManifest

namespace ScopedDiscoveryManifest
def projectedFulfillment (currentAuthority mainAvailable exactBasis : Bool) :=
  currentAuthority && mainAvailable && exactBasis
theorem unrelated_projection_not_fulfilled (authorized available : Bool) :
    projectedFulfillment authorized available false = false := by
  cases authorized <;> cases available <;> rfl
end ScopedDiscoveryManifest

namespace ScopedDiscoveryManifest
-- An authenticated projected row may render before history. Its rendering never
-- supplies local-history completeness or mutation permission.
def projectionReadOnly (_currentAuthorized : Bool) := true
def projectionLocalComplete (_mainAvailable : Bool) := false
theorem projection_remains_read_only (authorized : Bool) : projectionReadOnly authorized = true := rfl
theorem projection_does_not_complete_history (available : Bool) : projectionLocalComplete available = false := rfl
end ScopedDiscoveryManifest

namespace ScopedDiscoveryManifest
-- A carrier statement is read from its immutable authenticated checkpoint.
-- Later local overlays are not a substitute for the owner's signed cut.
def attestedStatement (checkpoint : Nat) (_overlay : Nat) := checkpoint
theorem overlay_cannot_change_attestation (checkpoint before after : Nat) :
    attestedStatement checkpoint before = attestedStatement checkpoint after := rfl
end ScopedDiscoveryManifest
